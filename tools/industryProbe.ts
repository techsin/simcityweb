/**
 * NOTE-048 LG-07 mechanism check: zone one vacant 6×6 high-tech block near existing schools in a y43 checkpoint,
 * then run the complete simulation for 24 months. No mayor automation, new services, quality edits or job injection.
 *
 * npx tsx tools/industryProbe.ts --city <y43.city.metropolis> --out <result.json>
 * A one-city region export also works; --tile selects a city from a multi-city export. --site x,z replays a chosen
 * rectangle; otherwise the deterministic scan prefers isolated sites, then viable I-HT stage and desirability.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { DAYS_PER_MONTH } from '../src/core/constants';
import type { CellRect } from '../src/core/events';
import { DevType, Network, Zone, isRoad } from '../src/core/types';
import { BF, type CityState } from '../src/sim/CityState';
import { CityActions } from '../src/sim/actions';
import { getDef, growablesForZone, rotatedFootprint } from '../src/sim/catalog';
import { Simulation } from '../src/sim/Simulation';
import { createSystems } from '../src/sim/systems';
import { economyRuntime } from '../src/sim/systems/economy';
import { countFront, lotSlope, lotTouchesRoad } from '../src/sim/economy/buildings';
import { desirabilityBreakdown } from '../src/sim/economy/desirability';
import { lotCell } from '../src/sim/economy/factors';
import { desirMaxStage, popMaxStage, towerLot } from '../src/sim/economy/growth';
import type { EconData, EconRuntime } from '../src/sim/economy/runtime';
import { COARSE, DOWNTOWN_STAGE, GROW_MAX_SLOPE, GROW_MAX_SLOPE_PER_CELL, GROW_MIN_DESIR } from '../src/sim/economy/tuning';
import { decodeBundle, isGzip } from '../src/save/bundle';
import { CITY_SAVE_FORMAT, deserializeCity, type SerializedCity } from '../src/save/serialize';
import type { RegionFile } from '../src/save';

export const INDUSTRY_PROBE_SIZE = 6;
export const INDUSTRY_PROBE_MONTHS = 24;
const SCHOOL_RADIUS = 24;

interface School { id: number; def: string; tier: 'elementary' | 'high' | 'college'; x: number; z: number; jobs: number; capacity: number; seats: number }
interface Fit { def: string; stage: number; capacity: number; geometric: number; serviced: number; eligible: number; bestDesirability: number | null }
export interface IndustrySite {
  rect: CellRect;
  school: School & { distance: number };
  fits: Fit[];
  maxStage: number;
  desirability: number;
  isolated: boolean;
}

/** Read a city export or one selected city of a region export, using the game's own bundle and migration code. */
export function loadIndustryCity(bytes: Uint8Array, tile?: string): CityState {
  const value = decodeBundle(isGzip(bytes) ? new Uint8Array(gunzipSync(bytes)) : bytes) as SerializedCity | RegionFile;
  if ('format' in value && value.format === CITY_SAVE_FORMAT) {
    if (tile) throw new Error('--tile only applies to region exports');
    return deserializeCity(value);
  }
  if ('kind' in value && value.kind === 'metropolis-region-file') {
    const keys = Object.keys(value.cities).sort();
    const key = tile ?? (keys.length === 1 ? keys[0] : undefined);
    if (!key || !value.cities[key]) throw new Error(`Select --tile from: ${keys.join(', ')}`);
    return deserializeCity(value.cities[key]);
  }
  throw new Error('Expected a Metropolis city or region export');
}

function schools(st: CityState): School[] {
  const out: School[] = [];
  for (const b of st.buildings.values()) {
    const def = getDef(b.def);
    if (!def || def.category !== 'education' || b.built < 1 || !(b.flags & BF.Powered) || b.flags & (BF.Burnt | BF.Abandoned | BF.Constructing)) continue;
    const tier = def.coverage?.tier;
    if (tier !== 'elementary' && tier !== 'high' && tier !== 'college') continue;
    if (!lotTouchesRoad(st, b.x, b.z, b.w, b.d)) continue;
    out.push({ id: b.id, def: b.def, tier, x: b.x + (b.w - 1) / 2, z: b.z + (b.d - 1) / 2, jobs: b.jobs, capacity: b.capacity, seats: def.coverage?.capacity ?? 0 });
  }
  return out.sort((a, b) => a.id - b.id);
}

function frontCells(st: CityState, x: number, z: number, w: number, d: number, rot: number): number[] {
  const out: number[] = [];
  if (rot === 0 || rot === 2) {
    const fz = rot === 0 ? z + d : z - 1;
    if (fz >= 0 && fz < st.size) for (let xx = x; xx < x + w; xx++) out.push(fz * st.size + xx);
  } else {
    const fx = rot === 1 ? x + w : x - 1;
    if (fx >= 0 && fx < st.size) for (let zz = z; zz < z + d; zz++) out.push(zz * st.size + fx);
  }
  return out;
}

/** Prospective fits ignore demand/allowance but use growth's actual footprint, full frontage, slope and utility rules. */
function siteFits(st: CityState, rect: CellRect, desir: (i: number) => number): Fit[] {
  const out: Fit[] = [];
  for (const def of growablesForZone(Zone.IndHigh)) {
    if (def.devType !== DevType.IHT) continue;
    const f: Fit = { def: def.id, stage: def.stage ?? 1, capacity: def.capacity ?? 0, geometric: 0, serviced: 0, eligible: 0, bestDesirability: null };
    for (let rot = 0; rot < 4; rot++) {
      const [w, d] = rotatedFootprint(def, rot);
      for (let z = rect.z0; z + d <= rect.z1; z++) for (let x = rect.x0; x + w <= rect.x1; x++) {
        let free = true;
        for (let zz = z; zz < z + d && free; zz++) for (let xx = x; xx < x + w; xx++) {
          const i = zz * st.size + xx;
          if (st.building[i] >= 0 || st.network[i] !== Network.None || st.water[i] || st.powerLines[i]) { free = false; break; }
        }
        if (!free) continue;
        const front = frontCells(st, x, z, w, d, rot);
        if (!front.length || front.some((i) => !isRoad(st.network[i] as Network))) continue;
        if (lotSlope(st, x, z, w, d) > GROW_MAX_SLOPE + GROW_MAX_SLOPE_PER_CELL * Math.max(w, d)) continue;
        f.geometric++;
        let power = false, water = false;
        for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) {
          const i = zz * st.size + xx;
          power ||= st.powered[i] !== 0; water ||= st.watered[i] !== 0;
        }
        for (const i of front) { power ||= st.powered[i] !== 0; water ||= st.watered[i] !== 0; }
        if (!(power && water)) continue;
        f.serviced++;
        const i = lotCell({ x, z, w, d, rot }, st.size), v = desir(i);
        let maxStage = Math.min(8, popMaxStage(st.stats.population), desirMaxStage(v));
        if (maxStage >= DOWNTOWN_STAGE && !towerLot(st, i % st.size, (i / st.size) | 0)) maxStage = DOWNTOWN_STAGE - 1;
        if (v <= GROW_MIN_DESIR || maxStage < f.stage) continue;
        f.eligible++;
        if (f.bestDesirability === null || v > f.bestDesirability) f.bestDesirability = v;
      }
    }
    out.push(f);
  }
  return out;
}

/** No RNG or state edits: select once from the initialized checkpoint, without trying multiple simulated outcomes. */
export function selectIndustrySite(st: CityState, rt: EconRuntime, radius = SCHOOL_RADIUS, origin?: { x: number; z: number }): { site: IndustrySite | null; candidates: number } {
  const near = schools(st), cache = new Map<number, number>();
  const desir = (i: number) => {
    let v = cache.get(i);
    if (v === undefined) { v = Math.max(-1, Math.min(1, desirabilityBreakdown(st, rt, DevType.IHT, i).raw)); cache.set(i, v); }
    return v;
  };
  let site: IndustrySite | null = null, candidates = 0;
  const firstX = origin?.x ?? 0, lastX = origin?.x ?? st.size - INDUSTRY_PROBE_SIZE;
  const firstZ = origin?.z ?? 0, lastZ = origin?.z ?? st.size - INDUSTRY_PROBE_SIZE;
  for (let z = firstZ; z <= lastZ; z++) for (let x = firstX; x <= lastX; x++) {
    const rect = { x0: x, z0: z, x1: x + INDUSTRY_PROBE_SIZE, z1: z + INDUSTRY_PROBE_SIZE };
    if (x < 0 || z < 0 || rect.x1 > st.size || rect.z1 > st.size) continue;
    let free = true;
    for (let zz = z; zz < rect.z1 && free; zz++) for (let xx = x; xx < rect.x1; xx++) {
      const i = zz * st.size + xx;
      if (st.building[i] >= 0 || st.network[i] !== Network.None || st.powerLines[i] || st.water[i] || st.zone[i] === Zone.IndHigh) { free = false; break; }
    }
    if (!free) continue;
    let school: IndustrySite['school'] | null = null;
    for (const s of near) {
      const distance = Math.hypot(s.x - (x + 2.5), s.z - (z + 2.5));
      if (distance <= radius && (!school || distance < school.distance)) school = { ...s, distance };
    }
    if (!school) continue;
    const fits = siteFits(st, rect, desir), eligible = fits.filter((f) => f.eligible > 0);
    if (!eligible.length) continue;
    candidates++;
    const maxStage = Math.max(...eligible.map((f) => f.stage));
    const quality = Math.max(...eligible.filter((f) => f.stage === maxStage).map((f) => f.bestDesirability!));
    let isolated = true;
    for (let xx = x; xx < rect.x1; xx++) for (const zz of [z - 1, rect.z1]) {
      if (zz >= 0 && zz < st.size && st.zone[zz * st.size + xx] === Zone.IndHigh) isolated = false;
    }
    for (let zz = z; zz < rect.z1; zz++) for (const xx of [x - 1, rect.x1]) {
      if (xx >= 0 && xx < st.size && st.zone[zz * st.size + xx] === Zone.IndHigh) isolated = false;
    }
    const next = { rect, school, fits, maxStage, desirability: quality, isolated };
    if (!site || isolated && !site.isolated || isolated === site.isolated && (maxStage > site.maxStage || maxStage === site.maxStage && (quality > site.desirability || quality === site.desirability && school.distance < site.school.distance))) site = next;
  }
  return { site, candidates };
}

function blockMetrics(sim: Simulation, rt: EconRuntime, rect: CellRect) {
  const st = sim.state, ids = new Set<number>();
  const sum = { air: 0, water: 0, noise: 0, soil: 0, landValue: 0, campus: 0, schools: 0, college: 0, skill: 0, imDesirability: 0, ihtDesirability: 0 };
  let powered = 0, watered = 0, highCells = 0;
  for (let z = rect.z0; z < rect.z1; z++) for (let x = rect.x0; x < rect.x1; x++) {
    const i = z * st.size + x, c = ((z / COARSE) | 0) * rt.cw + ((x / COARSE) | 0);
    if (st.building[i] >= 0) ids.add(st.building[i]);
    if (st.powered[i]) powered++; if (st.watered[i]) watered++;
    if (st.zone[i] === Zone.IndHigh) highCells++;
    sum.air += st.airPollution[i]; sum.water += st.waterPollution[i]; sum.noise += st.noise[i]; sum.soil += st.soil[i];
    sum.landValue += st.landValue[i]; sum.campus += st.campus[i]; sum.schools += st.eduCov[i]; sum.college += st.eduCollegeCov[i]; sum.skill += rt.coarseSkill[c];
    sum.imDesirability += Math.max(-1, Math.min(1, desirabilityBreakdown(st, rt, DevType.IM, i).raw));
    sum.ihtDesirability += Math.max(-1, Math.min(1, desirabilityBreakdown(st, rt, DevType.IHT, i).raw));
  }
  const buildings = [...ids].sort((a, b) => a - b).map((id) => st.buildings.get(id)!).filter(Boolean);
  const byDev = Object.fromEntries([DevType.IA, DevType.ID, DevType.IM, DevType.IHT].map((d) => [DevType[d], { jobs: 0, capacity: 0, constructingCapacity: 0 }]));
  const intersectingByDev = Object.fromEntries([DevType.IA, DevType.ID, DevType.IM, DevType.IHT].map((d) => [DevType[d], { jobs: 0, capacity: 0, constructingCapacity: 0 }]));
  const details = buildings.map((b) => {
    const def = getDef(b.def), dv = def?.devType;
    const contained = b.x >= rect.x0 && b.z >= rect.z0 && b.x + b.w <= rect.x1 && b.z + b.d <= rect.z1;
    if (dv !== undefined && byDev[DevType[dv]]) {
      const records = [intersectingByDev[DevType[dv]]];
      if (contained) records.push(byDev[DevType[dv]]);
      for (const a of records) {
        a.jobs += b.jobs; a.capacity += b.capacity;
        if (b.flags & BF.Constructing) a.constructingCapacity += b.capacity;
      }
    }
    return { id: b.id, def: b.def, dev: dv === undefined ? null : DevType[dv], stage: def?.stage, x: b.x, z: b.z, w: b.w, d: b.d, jobs: b.jobs, capacity: b.capacity, built: b.built, flags: b.flags, contained };
  });
  const jobs = Object.values(byDev).reduce((a, b) => a + b.jobs, 0);
  const intersectingJobs = Object.values(intersectingByDev).reduce((a, b) => a + b.jobs, 0);
  const data = st.systemData.economy as EconData;
  return {
    day: st.day, cityPopulation: st.stats.population, eq: st.stats.eq, cityAir: st.stats.avgAir, cityApproval: st.stats.approval,
    highCells, powered, watered, means: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v / 36])),
    frontage: [0, 1, 2, 3].map((r) => countFront(st, rect.x0, rect.z0, 6, 6, r, (i) => isRoad(st.network[i] as Network)).hit),
    jobs, ihtJobs: byDev.IHT.jobs, ihtShare: jobs > 0 ? byDev.IHT.jobs / jobs : 0, byDev, buildings: details,
    intersectingJobs, intersectingIHTJobs: intersectingByDev.IHT.jobs,
    intersectingIHTShare: intersectingJobs > 0 ? intersectingByDev.IHT.jobs / intersectingJobs : 0,
    intersectingByDev, crossingJobs: intersectingJobs - jobs, crossingIHTJobs: intersectingByDev.IHT.jobs - byDev.IHT.jobs,
    demand: { raw: data.rawTarget.slice(DevType.IA), target: data.target.slice(DevType.IA), absolute: data.demandAbs.slice(DevType.IA), carry: data.carry.slice(DevType.IA), normalized: st.stats.demand.slice(DevType.IA), labour: data.labour },
    fits: siteFits(st, rect, (i) => Math.max(-1, Math.min(1, desirabilityBreakdown(st, rt, DevType.IHT, i).raw))),
  };
}

export function runIndustryProbe(st: CityState, opts: { schoolRadius?: number; site?: { x: number; z: number } } = {}) {
  const source = { day: st.day, year: st.year, size: st.size, population: st.stats.population, eq: st.stats.eq, seed: st.config.seed, rng: st.systemData.simRng };
  const systems = createSystems(), sim = new Simulation(st, systems), rt = economyRuntime(systems)!;
  const radius = opts.schoolRadius ?? SCHOOL_RADIUS, selected = selectIndustrySite(st, rt, radius, opts.site);
  if (!selected.site) return { pass: false, source, schoolRadius: radius, candidates: selected.candidates, error: 'No vacant 6×6 site near an operating school has an accessible, serviced, desirability-eligible I-HT footprint. No actions applied.' };
  const site = selected.site, before = blockMetrics(sim, rt, site.rect), rng = sim.rng.state;
  const action = new CityActions(sim).zone(site.rect, Zone.IndHigh);
  if (!action.ok || action.affected !== 36 || action.demolished?.length) throw new Error(`Expected exactly 36 newly zoned empty cells: ${JSON.stringify(action)}`);
  if (sim.rng.state !== rng) throw new Error('Zoning unexpectedly consumed simulation RNG');
  const months = [blockMetrics(sim, rt, site.rect)];
  for (let month = 0; month < INDUSTRY_PROBE_MONTHS; month++) { sim.runDays(DAYS_PER_MONTH); months.push(blockMetrics(sim, rt, site.rect)); }
  const final = months.at(-1)!;
  const founded = typeof st.systemData.foundedDay === 'number' ? st.systemData.foundedDay : 0;
  const checkpointY43 = source.size === 256 && source.day - founded === 43 * 360;
  return {
    pass: checkpointY43 && final.jobs > 0 && final.ihtShare >= 0.25 && final.intersectingIHTShare >= 0.25,
    checkpointY43, source, schoolRadius: radius, candidates: selected.candidates, site, action, before,
    elapsedDays: st.day - source.day, elapsedMonths: INDUSTRY_PROBE_MONTHS, final, months,
    notes: 'Both wholly contained and all-intersecting filled-job shares must reach 25%; crossing jobs are explicit. Selection prefers a perimeter without existing IndHigh, then highest viable stage/desirability, and runs once before zoning. Fits measure geometric/service/quality opportunity, not disjoint packing or growth allowance. No bot actions run during the 24 months.',
  };
}

function main(args: string[]) {
  const opts: { city?: string; out?: string; tile?: string; schoolRadius?: number; site?: { x: number; z: number } } = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i], value = args[++i];
    if (!value) throw new Error(`Missing value for ${key}`);
    if (key === '--city') opts.city = value;
    else if (key === '--out') opts.out = value;
    else if (key === '--tile') opts.tile = value;
    else if (key === '--school-radius') { opts.schoolRadius = Number(value); if (!(opts.schoolRadius > 0 && Number.isFinite(opts.schoolRadius))) throw new Error('Invalid school radius'); }
    else if (key === '--site') { const [x, z] = value.split(',').map(Number); if (!Number.isInteger(x) || !Number.isInteger(z)) throw new Error('Expected --site x,z'); opts.site = { x, z }; }
    else throw new Error(`Unknown option ${key}`);
  }
  if (!opts.city) throw new Error('Usage: industryProbe --city <y43.city.metropolis> [--out result.json] [--tile key] [--site x,z] [--school-radius 24]');
  const bytes = new Uint8Array(readFileSync(opts.city)), st = loadIndustryCity(bytes, opts.tile);
  const result = { input: { path: resolve(opts.city), sha256: createHash('sha256').update(bytes).digest('hex'), tile: opts.tile }, ...runIndustryProbe(st, opts) };
  const json = JSON.stringify(result, null, 2) + '\n';
  if (opts.out) writeFileSync(opts.out, json, 'utf8'); else process.stdout.write(json);
  console.error(result.pass ? 'Industry mechanism probe passed' : 'Industry mechanism probe failed');
  if (!result.pass) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main(process.argv.slice(2));
