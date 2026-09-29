/**
 * Growth: turns demand into buildings (SC4 style).
 *  - Each day a capacity ALLOWANCE per DevType = positive absolute demand × GROWTH_RESPONSE (min / throughput caps).
 *  - Candidate front cells (zoned, empty, 4-adjacent to a road) are sampled; for each: pick a DevType of the zone
 *    weighted by desirability^PICK_DES_EXP × allowance^PICK_ALLOW_EXP, the max stage from zone density ∧ population
 *    milestone ∧ desirability ∧ (stage ≥ DOWNTOWN_STAGE) distance to the commercial core, then a def (preferring the
 *    highest allowed stage; hotels while visitors lack rooms) and carve a lot of its rotated footprint whose whole front
 *    edge touches the road (building faces the road). DEEP BLOCKS: the lot may extend up to INFILL_MAX_EXTRA rows into
 *    the block's interior (cells with no road next to them), so the middle of deep blocks fills with yards. Power is
 *    required; water for stage ≥ 3 or medium/high zones.
 *  - Redevelopment: random existing growables are replaced by higher-stage (bigger) buildings when demand and
 *    desirability allow, merging adjacent small lots — this is how skylines emerge. Abandoned lots get rebuilt.
 *  - Gentrification / filtering (every growable once per SWAP_SCAN_DAYS): a live building swaps to a richer DevType of
 *    its zone at the same stage when that DevType's desirability is SWAP_MIN_GAIN higher (and at least SWAP_MIN_DES)
 *    and it has demand; an R$$$
 *    home below FILTER_DES for FILTER_DAYS becomes R$$ (timers in systemData.growth, keyed by building id).
 *  - Model variants: growth keeps its one rng draw, then steps to the next variant while a building within
 *    VARIANT_SPREAD cells has the same def + variant (no identical twins side by side).
 *  - New buildings start with BF.Constructing (population system advances construction).
 */
import type { SimSystem, Simulation } from '../Simulation';
import { BF, type Building, type CityState } from '../CityState';
import { hash2, smoothstep } from '../../core/rng';
import { DevType, Network, Zone, zoneDensity } from '../../core/types';
import { DEV_WEALTH, ZONE_DEVTYPES, devFamily, getDef, growablesForZone, rotatedFootprint } from '../catalog';
import type { BuildingDef } from '../catalogTypes';
import { MANIFEST_BY_ID } from '../../assets/manifest';
import {
  COARSE, DOWNTOWN_MIN, DOWNTOWN_MIN_JOBS, DOWNTOWN_R0, DOWNTOWN_R1, DOWNTOWN_STAGE, FILTER_DAYS, FILTER_DES,
  GROW_MAX_SLOPE, GROW_MAX_SLOPE_PER_CELL, GROW_MIN_DESIR, GROWTH_ATTEMPTS_BASE, GROWTH_ATTEMPTS_MAX, GROWTH_ATTEMPTS_PER100,
  GROWTH_BANK_DAYS, GROWTH_BANK_MIN_FRAC, GROWTH_MAX_BASE, GROWTH_MAX_FRAC, GROWTH_MAX_SCALE, GROWTH_MIN_ALLOW,
  GROWTH_OVERSHOOT_SLACK, GROWTH_RESPONSE, GROWTH_SIZE_DEMAND, HOTEL_PREF_MAX, INFILL_MAX_EXTRA, PICK_ALLOW_EXP, PICK_DES_EXP,
  REDEVELOP_CHECKS, REDEVELOP_MIN_AGE, REDEVELOP_MIN_GAIN, STAGE_DES_D0, STAGE_DES_D1, STAGE_POP, STAGE_PREF, SWAP_LOCK_DAYS,
  SWAP_MIN_AGE, SWAP_MIN_CAP, SWAP_MIN_DEMAND, SWAP_MIN_DES, SWAP_MIN_GAIN, SWAP_SCAN_DAYS, VARIANT_SPREAD, WATER_REQUIRED_STAGE,
  ZONE_MAX_STAGE, isGrowZone,
} from './tuning';
import { type EconRuntime, econData, infraFlags } from './runtime';
import { levelLot, lotAverageHeight, lotSlope, placeBuilding, removeBuilding } from './buildings';
import { HOTEL_ROOMS_PER_JOB } from './tourism';

const isRoadN = (n: number) => n >= Network.Street && n <= Network.Highway;
const DX = [0, 1, 0, -1];
const DZ = [1, 0, -1, 0];

export function popMaxStage(pop: number): number {
  let s = STAGE_POP[0].stage;
  for (const m of STAGE_POP) if (pop >= m.pop) s = m.stage;
  return s;
}
export function desirMaxStage(des: number): number {
  const t = (des - STAGE_DES_D0) / (STAGE_DES_D1 - STAGE_DES_D0);
  return 1 + Math.floor(7 * Math.max(0, Math.min(1, t)));
}

// ------------------------------------------------------------------------------------------------ persistent data
/** systemData.growth (structured-clone friendly; keys are building ids) */
export interface GrowthData {
  v: 1;
  /** building id -> first day it may swap wealth again (anti-oscillation) */
  lock: Record<string, number>;
  /** R$$$ building id -> days its desirability has been below FILTER_DES */
  low: Record<string, number>;
  /** gentrification swaps / filter-downs so far (stats, tests) */
  swaps: number;
  filtered: number;
  /** position of the swap scan in the growables list (a loaded city continues where it stopped) */
  cursor: number;
  /** commercial core of the last monthly update (null: none yet) */
  core: { x: number; z: number; jobs: number } | null;
}
export function growthData(st: CityState): GrowthData {
  let d = st.systemData.growth as GrowthData | undefined;
  if (!d || d.v !== 1) {
    d = { v: 1, lock: {}, low: {}, swaps: 0, filtered: 0, cursor: 0, core: null };
    st.systemData.growth = d;
  }
  d.lock ??= {}; d.low ??= {}; d.swaps ??= 0; d.filtered ??= 0; d.cursor ??= 0; d.core ??= null;
  return d;
}

// ------------------------------------------------------------------------------------------------ commercial core
/** day of the month the commercial core is recomputed */
const CORE_DAY = 20;
/** job-weighted centroid of CS / CO jobs (monthly; null below DOWNTOWN_MIN_JOBS) */
interface Core { x: number; z: number; jobs: number; day: number }
const cores = new WeakMap<CityState, Core | null>();

function computeCore(st: CityState, list: readonly Building[], defOf: (b: Building) => BuildingDef | undefined): Core | null {
  // per coarse block first (the job-weighted centroid over coarse blocks), then their centroid
  const N = st.size, cw = Math.ceil(N / COARSE);
  const jobs = new Float64Array(cw * cw);
  let tot = 0;
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    if (b.jobs <= 0 || b.flags & (BF.Abandoned | BF.Burnt)) continue;
    const dv = defOf(b)?.devType;
    if (dv === undefined || dv < DevType.CS1 || dv > DevType.CO3) continue;
    const blk = (((b.z + (b.d >> 1)) / COARSE) | 0) * cw + (((b.x + (b.w >> 1)) / COARSE) | 0);
    jobs[blk] += b.jobs;
    tot += b.jobs;
  }
  if (tot < DOWNTOWN_MIN_JOBS) return null;
  let sx = 0, sz = 0;
  for (let q = 0; q < jobs.length; q++) {
    const j = jobs[q];
    if (!j) continue;
    sx += j * ((q % cw) * COARSE + COARSE / 2);
    sz += j * (((q / cw) | 0) * COARSE + COARSE / 2);
  }
  return { x: sx / tot, z: sz / tot, jobs: tot, day: st.day };
}

/** the commercial core of the city (growth system, monthly), null when the town has none yet */
export function commercialCore(st: CityState): { x: number; z: number; jobs: number } | null {
  return cores.get(st) ?? null;
}

/** 0..1 weight of stage ≥ DOWNTOWN_STAGE growth at cell (x, z) (1 without a core) */
export function downtownWeight(st: CityState, x: number, z: number): number {
  const c = cores.get(st);
  if (!c) return 1;
  const d = Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z) / st.size;
  return Math.max(DOWNTOWN_MIN, 1 - smoothstep(DOWNTOWN_R0, DOWNTOWN_R1, d));
}

/** true when the lot at (x, z) may carry a tower: its fixed position hash < the downtown weight (no rng draw) */
export function towerLot(st: CityState, x: number, z: number): boolean {
  const w = downtownWeight(st, x, z);
  return w >= 1 || hash2(x, z, 911) < w;
}

/** max stage at cell i after the downtown weight (a fixed per-lot partition: the far lots that lost keep losing) */
function downtownCap(st: CityState, i: number, maxStage: number): number {
  if (maxStage < DOWNTOWN_STAGE) return maxStage;
  const N = st.size;
  return towerLot(st, i % N, (i / N) | 0) ? maxStage : DOWNTOWN_STAGE - 1;
}

// ------------------------------------------------------------------------------------------------ model variants
/**
 * variant of a new building: start from v0 and step to the next variant while a building within VARIANT_SPREAD cells of
 * the lot has the same def and variant; when every variant is taken nearby, the one whose nearest same-def twin is
 * farthest away (ties: the first in stepping order from v0) — identical twins never stand side by side unless a def has
 * fewer variants than same-def neighbours touching the lot
 */
export function spreadVariant(st: CityState, defId: string, x0: number, z0: number, w: number, d: number, v0: number, variants: number): number {
  if (variants <= 1) return 0;
  const N = st.size, R = VARIANT_SPREAD;
  const xa = Math.max(0, x0 - R), xb = Math.min(N - 1, x0 + w - 1 + R);
  const za = Math.max(0, z0 - R), zb = Math.min(N - 1, z0 + d - 1 + R);
  // nearest same-def building per variant (Chebyshev distance lot to lot; manifests have < 32 variants)
  const near = VNEAR;
  for (let v = 0; v < variants && v < 32; v++) near[v] = Infinity;
  let last = -1;
  for (let z = za; z <= zb; z++) {
    for (let x = xa; x <= xb; x++) {
      const id = st.building[z * N + x];
      if (id < 0 || id === last) continue;
      last = id;
      const o = st.buildings.get(id);
      if (!o || o.def !== defId || o.variant >= 32 || o.variant < 0) continue;
      const dx = x < x0 ? x0 - x : x > x0 + w - 1 ? x - (x0 + w - 1) : 0;
      const dz = z < z0 ? z0 - z : z > z0 + d - 1 ? z - (z0 + d - 1) : 0;
      const dist = dx > dz ? dx : dz;
      if (dist < near[o.variant]) near[o.variant] = dist;
    }
  }
  const start = ((v0 % variants) + variants) % variants;
  let best = start, bd = -1;
  for (let k = 0; k < variants; k++) {
    const v = (start + k) % variants;
    const dv = v < 32 ? near[v] : Infinity;
    if (dv === Infinity) return v;
    if (dv > bd) { bd = dv; best = v; }
  }
  return best;
}
const VNEAR = new Float64Array(32);

/** deterministic start variant of a plopped building: ((x·73856093) ^ (z·19349663)) >>> 0 mod variants */
export function positionVariant(x: number, z: number, variants: number): number {
  if (variants <= 1) return 0;
  return ((Math.imul(x, 73856093) ^ Math.imul(z, 19349663)) >>> 0) % variants;
}

// ------------------------------------------------------------------------------------------------ system
export function growthSystem(rt: EconRuntime): SimSystem {
  const allow = new Float64Array(12);
  const capLimit = new Float64Array(12);
  const devW = new Float64Array(12);
  const defPick: BuildingDef[] = [];
  const defW: number[] = [];
  const replaced: Building[] = [];
  let lastRebuildDay = -1;
  let sub: Simulation | null = null;
  let unsub: (() => void) | null = null;

  const rebuildCandidates = (st: CityState) => {
    const N = st.size;
    const cand = rt.candidates;
    let n = 0;
    rt.emptyZoned.fill(0);
    rt.emptyFront.fill(0);
    const zone = st.zone, bld = st.building, net = st.network;
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        const zn = zone[i];
        if (zn < Zone.ResLow || zn > Zone.IndHigh) continue;
        if (bld[i] >= 0 || net[i] !== Network.None || st.water[i] || st.powerLines[i]) continue;
        rt.emptyZoned[zn]++;
        if ((x > 0 && isRoadN(net[i - 1])) || (x < N - 1 && isRoadN(net[i + 1])) || (z > 0 && isRoadN(net[i - N])) || (z < N - 1 && isRoadN(net[i + N]))) {
          cand[n++] = i;
          rt.emptyFront[zn]++;
        }
      }
    }
    rt.candidateCount = n;
    rt.candidatesDirty = false;
    lastRebuildDay = st.day;
  };

  /** allowance per DevType for today */
  const computeAllowance = (st: CityState) => {
    const data = econData(st);
    const t = rt.totals;
    const famCap = { R: t.resCapAll[0] + t.resCapAll[1] + t.resCapAll[2], C: 0, I: 0 };
    for (let d = 3; d <= 7; d++) famCap.C += t.jobCapAll[d];
    for (let d = 8; d <= 11; d++) famCap.I += t.jobCapAll[d];
    const famSum = { R: 0, C: 0, I: 0 };
    for (let d = 0; d < 12; d++) {
      const abs = data.demandAbs[d];
      const fam = devFamily(d);
      if (abs <= 0 || st.stats.demand[d] <= 0.01) { allow[d] = 0; continue; }
      allow[d] = Math.max(abs * GROWTH_RESPONSE, Math.min(abs, GROWTH_MIN_ALLOW[fam]));
      famSum[fam] += allow[d];
    }
    for (let d = 0; d < 12; d++) {
      const fam = devFamily(d);
      const c = famCap[fam];
      const max = GROWTH_MAX_BASE[fam] + (GROWTH_MAX_FRAC * c) / Math.sqrt(1 + c / GROWTH_MAX_SCALE);
      if (famSum[fam] > max) allow[d] *= max / famSum[fam];
    }
    // bank the daily allowance (so big buildings become possible when throughput is capped); building size is
    // limited by the absolute demand, and a building may start once the bank covers GROWTH_BANK_MIN_FRAC of it
    const bank = data.carry;
    for (let d = 0; d < 12; d++) {
      const daily = allow[d];
      if (daily > 0) bank[d] = Math.min(bank[d] + daily, daily * GROWTH_BANK_DAYS);
      else bank[d] = bank[d] > 0 ? bank[d] * 0.8 : bank[d] * 0.97;
      allow[d] = daily > 0 ? bank[d] : 0;
      capLimit[d] = Math.max(GROWTH_OVERSHOOT_SLACK, data.demandAbs[d] * GROWTH_SIZE_DEMAND);
    }
  };

  /** largest capacity a new building of dev may have right now */
  const capMaxFor = (dev: number) => Math.min(capLimit[dev], allow[dev] / GROWTH_BANK_MIN_FRAC);

  /** write the spent allowance back into the bank */
  const settleBank = (st: CityState) => {
    const bank = econData(st).carry;
    for (let d = 0; d < 12; d++) if (allow[d] !== 0 || bank[d] > 0) bank[d] = Math.min(bank[d], allow[d]);
  };

  /** weighted DevType pick for cell i in zone; -1 if none */
  const pickDev = (st: CityState, i: number, zone: number, rng: Simulation['rng']): number => {
    const devs = ZONE_DEVTYPES[zone];
    let tot = 0;
    for (let k = 0; k < devs.length; k++) {
      const d = devs[k];
      devW[k] = 0;
      if (allow[d] <= 0) continue;
      const des = st.desirability[d][i];
      if (des <= GROW_MIN_DESIR) continue;
      const a = des - GROW_MIN_DESIR + 0.05;
      devW[k] = (PICK_DES_EXP === 1 ? a : Math.pow(a, PICK_DES_EXP))
        * (PICK_ALLOW_EXP === 0.5 ? Math.sqrt(allow[d]) : Math.pow(allow[d], PICK_ALLOW_EXP));
      tot += devW[k];
    }
    if (tot <= 0) return -1;
    let r = rng.next() * tot;
    for (let k = 0; k < devs.length; k++) {
      r -= devW[k];
      if (r <= 0 && devW[k] > 0) return devs[k];
    }
    return devs[devs.length - 1];
  };

  /** the growable defs of a zone per DevType (perf: collectDefs scans only its DevType's defs; rebuilt when the catalog
   *  index changes) */
  const zoneDevDefs: { src: readonly BuildingDef[]; byDev: BuildingDef[][] }[] = [];
  const defsOf = (zone: number, dev: number): readonly BuildingDef[] => {
    const src = growablesForZone(zone as Zone);
    let e = zoneDevDefs[zone];
    if (!e || e.src !== src) {
      e = { src, byDev: Array.from({ length: 12 }, () => [] as BuildingDef[]) };
      for (const d of src) if (d.devType !== undefined && d.devType >= 0 && d.devType < 12) e.byDev[d.devType].push(d);
      zoneDevDefs[zone] = e;
    }
    return e.byDev[dev] ?? [];
  };
  /** collect candidate defs into defPick/defW; returns count */
  const collectDefs = (st: CityState, zone: number, dev: number, minStage: number, maxStage: number, capMax: number, capMin: number): number => {
    defPick.length = 0;
    defW.length = 0;
    const list = defsOf(zone, dev);
    let top = 0;
    for (const d of list) {
      const s = d.stage ?? 1, c = d.capacity ?? 0;
      if (s < minStage || s > maxStage || c > capMax || c < capMin) continue;
      defPick.push(d);
      if (s > top) top = s;
    }
    const shortage = econData(st).hotelShortage;
    for (const d of defPick) {
      let w = Math.exp(STAGE_PREF * ((d.stage ?? 1) - top));
      // hotels while visitors lack rooms (tourism.ts hotel shortage, WP6)
      const rpj = shortage > 0 ? HOTEL_ROOMS_PER_JOB[d.model] : undefined;
      if (rpj !== undefined) {
        const rooms = rpj * (d.capacity ?? 0);
        if (rooms > 0) w *= 1 + Math.min(HOTEL_PREF_MAX, shortage / rooms);
      }
      defW.push(w);
    }
    return defPick.length;
  };

  /** pop a weighted random def from defPick */
  const takeDef = (rng: Simulation['rng']): BuildingDef | null => {
    let tot = 0;
    for (const w of defW) tot += w;
    if (tot <= 0) return null;
    let r = rng.next() * tot;
    for (let k = 0; k < defPick.length; k++) {
      r -= defW[k];
      if (r <= 0) { const d = defPick[k]; defW[k] = 0; return d; }
    }
    const k = defW.findIndex((w) => w > 0);
    if (k < 0) return null;
    defW[k] = 0;
    return defPick[k];
  };

  /** lot checks shared by growth / redevelopment. Returns false if any lot cell is unusable. */
  const utilitiesOk = (st: CityState, x0: number, z0: number, W: number, D: number, rot: number, needWater: boolean, hasUtil: boolean): boolean => {
    if (!hasUtil) return true;
    const N = st.size;
    let p = false, w = !needWater;
    for (let z = z0; z < z0 + D && !(p && w); z++) {
      for (let x = x0; x < x0 + W; x++) {
        const i = z * N + x;
        if (st.powered[i]) p = true;
        if (st.watered[i]) w = true;
      }
    }
    if (!(p && w)) {
      // front (road) cells may carry the utility
      const fx = rot === 1 ? x0 + W : rot === 3 ? x0 - 1 : -1;
      const fz = rot === 0 ? z0 + D : rot === 2 ? z0 - 1 : -1;
      if (fz >= 0 && fz < N) for (let x = x0; x < x0 + W; x++) { const i = fz * N + x; if (st.powered[i]) p = true; if (st.watered[i]) w = true; }
      if (fx >= 0 && fx < N) for (let z = z0; z < z0 + D; z++) { const i = z * N + fx; if (st.powered[i]) p = true; if (st.watered[i]) w = true; }
    }
    return p && w;
  };

  /** every cell just outside the front edge must be a road */
  const frontAllRoad = (st: CityState, x0: number, z0: number, W: number, D: number, rot: number): boolean => {
    const N = st.size;
    if (rot === 0 || rot === 2) {
      const z = rot === 0 ? z0 + D : z0 - 1;
      if (z < 0 || z >= N) return false;
      for (let x = x0; x < x0 + W; x++) if (!isRoadN(st.network[z * N + x])) return false;
    } else {
      const x = rot === 1 ? x0 + W : x0 - 1;
      if (x < 0 || x >= N) return false;
      for (let z = z0; z < z0 + D; z++) if (!isRoadN(st.network[z * N + x])) return false;
    }
    return true;
  };

  /** interior cell: free zoned cell of `zone` with no road 4-adjacent (unreachable for a frontage lot of its own) */
  const interiorFree = (st: CityState, x: number, z: number, zone: number): boolean => {
    const N = st.size;
    if (x < 0 || z < 0 || x >= N || z >= N) return false;
    const i = z * N + x;
    if (st.zone[i] !== zone || st.building[i] >= 0 || st.network[i] !== Network.None || st.water[i] || st.powerLines[i]) return false;
    const net = st.network;
    return !((x > 0 && isRoadN(net[i - 1])) || (x < N - 1 && isRoadN(net[i + 1])) || (z > 0 && isRoadN(net[i - N])) || (z < N - 1 && isRoadN(net[i + N])));
  };

  /**
   * DEEP BLOCKS: extend a fitted lot away from its road by up to INFILL_MAX_EXTRA rows of interior cells (the whole row
   * across the lot's width must be free interior of the same zone). Returns the (possibly) extended lot.
   */
  const extendInward = (st: CityState, x0: number, z0: number, W: number, D: number, rot: number, zone: number, maxSlope: number): [number, number, number, number] => {
    let ex = 0;
    for (let e = 1; e <= INFILL_MAX_EXTRA; e++) {
      let ok = true;
      if (rot === 0 || rot === 2) {
        const z = rot === 0 ? z0 - e : z0 + D - 1 + e;
        for (let x = x0; x < x0 + W && ok; x++) ok = interiorFree(st, x, z, zone);
      } else {
        const x = rot === 1 ? x0 - e : x0 + W - 1 + e;
        for (let z = z0; z < z0 + D && ok; z++) ok = interiorFree(st, x, z, zone);
      }
      if (!ok) break;
      ex = e;
    }
    if (ex === 0) return [x0, z0, W, D];
    let nx = x0, nz = z0, nW = W, nD = D;
    if (rot === 0) { nz = z0 - ex; nD = D + ex; }
    else if (rot === 2) nD = D + ex;
    else if (rot === 1) { nx = x0 - ex; nW = W + ex; }
    else nW = W + ex;
    if (lotSlope(st, nx, nz, nW, nD) > maxSlope) return [x0, z0, W, D];
    return [nx, nz, nW, nD];
  };

  /** a new growable; `hashVariant` (new code paths: wealth swaps) starts from a position hash instead of the one rng
   *  draw of the phase-0 growth paths, so the rng stream of those paths is unchanged */
  const create = (sim: Simulation, def: BuildingDef, x0: number, z0: number, W: number, D: number, rot: number, hasUtil: boolean, hashVariant = false): Building => {
    const st = sim.state;
    const N = st.size;
    let trees = false;
    for (let z = z0; z < z0 + D; z++) for (let x = x0; x < x0 + W; x++) { const i = z * N + x; if (st.trees[i]) { st.trees[i] = 0; trees = true; } }
    const id = st.nextBuildingId++;
    let baseY: number;
    let changed = null;
    if (lotSlope(st, x0, z0, W, D) > 1.0) {
      const lv = levelLot(st, x0, z0, W, D, id, true);
      baseY = lv.baseY;
      changed = lv.changed;
    } else baseY = Math.max(0.3, lotAverageHeight(st, x0, z0, W, D));
    const variants = MANIFEST_BY_ID[def.model]?.variants ?? 1;
    const v0 = hashVariant ? positionVariant(x0, z0, variants) : sim.rng.int(0, variants - 1);
    const b: Building = {
      id, def: def.id, x: x0, z: z0, w: W, d: D, rot: rot as 0 | 1 | 2 | 3, variant: spreadVariant(st, def.id, x0, z0, W, D, v0, variants),
      pop: 0, jobs: 0, capacity: def.capacity ?? 0, wealth: DEV_WEALTH[def.devType ?? 0], built: 0, age: 0,
      flags: BF.Constructing | (hasUtil ? 0 : BF.Powered | BF.Watered), baseY, health: 0.6, unhappy: 0,
      // WP1 fields in their fixed order (one hidden class for every building; demographics ensureDemographicsFields)
      kids: undefined, teens: undefined, yad: undefined, srs: undefined, wf: undefined, edu: undefined, hire: undefined,
    };
    placeBuilding(sim, b);
    const rect = { x0, z0, x1: x0 + W, z1: z0 + D };
    if (trees) sim.events.emit('treesChanged', rect);
    if (changed) sim.events.emit('terrainChanged', changed);
    return b;
  };

  /** try to fit `def` facing road side `rot` with cell (cx,cz) on the front row; returns [x0,z0,W,D] or null */
  const fitNew = (st: CityState, def: BuildingDef, rot: number, cx: number, cz: number, zone: number, hasUtil: boolean, rng: Simulation['rng']): [number, number, number, number] | null => {
    const N = st.size;
    const [W, D] = rotatedFootprint(def, rot);
    const along = rot === 0 || rot === 2 ? W : D;
    const start = rng.int(0, along - 1);
    const needWater = (def.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(zone as Zone) >= 2;
    const maxSlope = GROW_MAX_SLOPE + GROW_MAX_SLOPE_PER_CELL * Math.max(W, D);
    for (let s = 0; s < along; s++) {
      const k = (start + s) % along;
      let x0: number, z0: number;
      if (rot === 0) { z0 = cz - D + 1; x0 = cx - k; }
      else if (rot === 2) { z0 = cz; x0 = cx - k; }
      else if (rot === 1) { x0 = cx - W + 1; z0 = cz - k; }
      else { x0 = cx; z0 = cz - k; }
      if (x0 < 0 || z0 < 0 || x0 + W > N || z0 + D > N) continue;
      let ok = true;
      for (let z = z0; z < z0 + D && ok; z++) {
        for (let x = x0; x < x0 + W; x++) {
          const i = z * N + x;
          if (st.zone[i] !== zone || st.building[i] >= 0 || st.network[i] !== Network.None || st.water[i] || st.powerLines[i]) { ok = false; break; }
        }
      }
      if (!ok) continue;
      if (!frontAllRoad(st, x0, z0, W, D, rot)) continue;
      if (lotSlope(st, x0, z0, W, D) > maxSlope) continue;
      if (!utilitiesOk(st, x0, z0, W, D, rot, needWater, hasUtil)) continue;
      return extendInward(st, x0, z0, W, D, rot, zone, maxSlope + GROW_MAX_SLOPE_PER_CELL * INFILL_MAX_EXTRA);
    }
    return null;
  };

  const tryGrow = (sim: Simulation, i: number, hasUtil: boolean, pop: number): boolean => {
    const st = sim.state;
    const N = st.size;
    const zone = st.zone[i];
    const x = i % N, z = (i / N) | 0;
    const dev = pickDev(st, i, zone, sim.rng);
    if (dev < 0) return false;
    const des = st.desirability[dev][i];
    const maxStage = downtownCap(st, i, Math.min(ZONE_MAX_STAGE[zoneDensity(zone as Zone)], popMaxStage(pop), desirMaxStage(des)));
    const capMax = capMaxFor(dev);
    if (!collectDefs(st, zone, dev, 1, maxStage, capMax, 0)) return false;
    // road sides (random start)
    const r0 = sim.rng.int(0, 3);
    for (let tries = 0; tries < 3; tries++) {
      const def = takeDef(sim.rng);
      if (!def) break;
      for (let rr = 0; rr < 4; rr++) {
        const rot = (r0 + rr) & 3;
        const nx = x + DX[rot], nz = z + DZ[rot];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N || !isRoadN(st.network[nz * N + nx])) continue;
        const pos = fitNew(st, def, rot, x, z, zone, hasUtil, sim.rng);
        if (!pos) continue;
        create(sim, def, pos[0], pos[1], pos[2], pos[3], rot, hasUtil);
        allow[dev] -= def.capacity ?? 0;
        return true;
      }
    }
    return false;
  };

  /** replace building b (and small neighbours in the new lot) by a bigger / higher-stage one */
  const tryRedevelop = (sim: Simulation, b: Building, hasUtil: boolean, pop: number): boolean => {
    const st = sim.state;
    if (b.flags & (BF.Plopped | BF.Historic | BF.Constructing | BF.OnFire)) return false;
    const def0 = getDef(b.def);
    if (!def0 || def0.devType === undefined) return false;
    const dead = (b.flags & (BF.Abandoned | BF.Burnt)) !== 0;
    if (b.flags & BF.Burnt) return false; // rubble must be bulldozed (or auto-cleared by ordinance)
    if (!dead && b.age < REDEVELOP_MIN_AGE) return false;
    const N = st.size;
    const ci = (b.z + (b.d >> 1)) * N + b.x + (b.w >> 1);
    const zone = st.zone[ci];
    if (!isGrowZone(zone)) return false;
    const dev = pickDev(st, ci, zone, sim.rng);
    if (dev < 0) return false;
    const stage0 = def0.stage ?? 1;
    const des = st.desirability[dev][ci];
    const maxStage = downtownCap(st, ci, Math.min(ZONE_MAX_STAGE[zoneDensity(zone as Zone)], popMaxStage(pop), desirMaxStage(des)));
    const minStage = dead ? 1 : stage0 + 1;
    if (maxStage < minStage) return false;
    const oldCapAlive = dead ? 0 : b.capacity;
    const capMax = oldCapAlive + capMaxFor(dev);
    if (!collectDefs(st, zone, dev, minStage, maxStage, capMax, dead ? 0 : b.capacity * REDEVELOP_MIN_GAIN)) return false;
    const rot = b.rot;
    for (let tries = 0; tries < 3; tries++) {
      const def = takeDef(sim.rng);
      if (!def) break;
      const [W, D] = rotatedFootprint(def, rot);
      const newStage = def.stage ?? 1;
      const needWater = newStage >= WATER_REQUIRED_STAGE || zoneDensity(zone as Zone) >= 2;
      const maxSlope = GROW_MAX_SLOPE + GROW_MAX_SLOPE_PER_CELL * Math.max(W, D);
      // candidate origins: same front line, overlapping the old lot
      const alongMin = rot === 0 || rot === 2 ? b.x - W + 1 : b.z - D + 1;
      const alongMax = rot === 0 || rot === 2 ? b.x + b.w - 1 : b.z + b.d - 1;
      const span = alongMax - alongMin + 1;
      const start = sim.rng.int(0, span - 1);
      for (let s = 0; s < span; s++) {
        const a = alongMin + ((start + s) % span);
        let x0: number, z0: number;
        if (rot === 0) { z0 = b.z + b.d - D; x0 = a; }
        else if (rot === 2) { z0 = b.z; x0 = a; }
        else if (rot === 1) { x0 = b.x + b.w - W; z0 = a; }
        else { x0 = b.x; z0 = a; }
        if (x0 < 0 || z0 < 0 || x0 + W > N || z0 + D > N) continue;
        replaced.length = 0;
        let oldCap = 0, ok = true;
        for (let z = z0; z < z0 + D && ok; z++) {
          for (let x = x0; x < x0 + W; x++) {
            const i = z * N + x;
            if (st.zone[i] !== zone || st.network[i] !== Network.None || st.water[i] || st.powerLines[i]) { ok = false; break; }
            const bid = st.building[i];
            if (bid < 0) continue;
            const o = st.buildings.get(bid);
            if (!o) continue;
            if (replaced.includes(o)) continue;
            if (o.flags & (BF.Plopped | BF.Historic | BF.Constructing | BF.OnFire | BF.Burnt)) { ok = false; break; }
            const od = getDef(o.def);
            const oDead = (o.flags & BF.Abandoned) !== 0;
            if (!oDead && (od?.stage ?? 1) >= newStage) { ok = false; break; }
            if (replaced.length >= 6) { ok = false; break; }
            replaced.push(o);
            if (!oDead) oldCap += o.capacity;
          }
        }
        if (!ok) continue;
        if (oldCap > 0 && (def.capacity ?? 0) < oldCap * REDEVELOP_MIN_GAIN) continue;
        if (!frontAllRoad(st, x0, z0, W, D, rot)) continue;
        if (lotSlope(st, x0, z0, W, D) > maxSlope) continue;
        if (!utilitiesOk(st, x0, z0, W, D, rot, needWater, hasUtil)) continue;
        for (const o of replaced) removeBuilding(sim, o);
        // (the yards of the replaced lots stay with the new building: deep blocks keep their interior filled)
        const lot = extendInward(st, x0, z0, W, D, rot, zone, maxSlope + GROW_MAX_SLOPE_PER_CELL * INFILL_MAX_EXTRA);
        create(sim, def, lot[0], lot[1], lot[2], lot[3], rot, hasUtil);
        allow[dev] -= (def.capacity ?? 0) - oldCap;
        return true;
      }
    }
    return false;
  };

  // ---------------------------------------------------------------------------------------------- wealth swaps
  /** same-stage def of DevType dev whose model fits lot b (same rotation) with capacity ≥ capMin; the closest footprint
   *  to the lot first, then the larger capacity (deterministic: no rng draw) */
  const sameStageDef = (zone: number, dev: number, stage: number, b: Building, capMin: number): BuildingDef | null => {
    let best: BuildingDef | null = null, bScore = Infinity;
    for (const d of growablesForZone(zone as Zone)) {
      if (d.devType !== dev || (d.stage ?? 1) !== stage || (d.capacity ?? 0) < capMin) continue;
      const [W, D] = rotatedFootprint(d, b.rot);
      if (W > b.w || D > b.d) continue;
      const score = (b.w * b.d - W * D) * 10000 - (d.capacity ?? 0);
      if (score < bScore) { bScore = score; best = d; }
    }
    return best;
  };

  /** replace b by `def` on the same lot (a renovation: construction starts again) */
  const swapTo = (sim: Simulation, b: Building, def: BuildingDef, hasUtil: boolean): Building | null => {
    const st = sim.state;
    const zone = st.zone[(b.z + (b.d >> 1)) * st.size + b.x + (b.w >> 1)];
    const needWater = (def.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(zone as Zone) >= 2;
    if (!utilitiesOk(st, b.x, b.z, b.w, b.d, b.rot, needWater, hasUtil)) return null;
    const { x, z, w, d, rot } = b;
    removeBuilding(sim, b);
    return create(sim, def, x, z, w, d, rot, hasUtil, true);
  };

  /** gentrification / filtering down for one building (called for every growable once per SWAP_SCAN_DAYS) */
  const checkSwap = (sim: Simulation, b: Building, hasUtil: boolean, gd: GrowthData): void => {
    const st = sim.state;
    if (b.flags & (BF.Plopped | BF.Historic | BF.Constructing | BF.OnFire | BF.Burnt | BF.Abandoned)) return;
    const def0 = rt.defOf(b);
    const dev = def0?.devType;
    if (!def0 || dev === undefined || dev >= DevType.IA) return;
    const N = st.size;
    const ci = (b.z + (b.d >> 1)) * N + b.x + (b.w >> 1);
    const zone = st.zone[ci];
    if (!isGrowZone(zone)) return;
    const key = b.id; // (integer keys: no string per building)
    const stage = def0.stage ?? 1;
    const desOld = st.desirability[dev][ci];
    // filtering down: the rich leave a declining neighbourhood, the middle class moves in
    if (dev === DevType.R3) {
      if (desOld < FILTER_DES) {
        const days = (gd.low[key] ?? 0) + SWAP_SCAN_DAYS;
        if (days >= FILTER_DAYS) {
          const def = sameStageDef(zone, DevType.R2, stage, b, 0);
          const nb = def ? swapTo(sim, b, def, hasUtil) : null;
          if (nb) { delete gd.low[key]; gd.lock[nb.id] = st.day + SWAP_LOCK_DAYS; gd.filtered++; return; }
        }
        gd.low[key] = days;
      } else if (gd.low[key] !== undefined) delete gd.low[key];
    }
    // gentrification: a richer DevType of the same family and kind (R / CS / CO) outbids the current one
    if (dev === DevType.R3 || dev === DevType.CS3 || dev === DevType.CO3) return; // (nothing richer of its kind)
    if (b.age < SWAP_MIN_AGE || (gd.lock[key] ?? -1) > st.day) return;
    const devs = ZONE_DEVTYPES[zone];
    const kind = dev <= DevType.R3 ? 0 : dev <= DevType.CS3 ? 1 : 2;
    let best = -1, bGain = SWAP_MIN_GAIN;
    for (let k = 0; k < devs.length; k++) {
      const d2 = devs[k];
      const k2 = d2 <= DevType.R3 ? 0 : d2 <= DevType.CS3 ? 1 : d2 <= DevType.CO3 ? 2 : 3;
      if (k2 !== kind || DEV_WEALTH[d2] <= DEV_WEALTH[dev]) continue;
      if (!(st.stats.demand[d2] > SWAP_MIN_DEMAND) || allow[d2] <= 0) continue;
      const desNew = st.desirability[d2][ci];
      if (!(desNew >= SWAP_MIN_DES)) continue;
      const gain = desNew - desOld;
      if (gain >= bGain) { bGain = gain; best = d2; }
    }
    if (best < 0) return;
    const def = sameStageDef(zone, best, stage, b, b.capacity * SWAP_MIN_CAP);
    if (!def) return;
    const nb = swapTo(sim, b, def, hasUtil);
    if (!nb) return;
    delete gd.low[key];
    gd.lock[nb.id] = st.day + SWAP_LOCK_DAYS;
    gd.swaps++;
    allow[best] -= def.capacity ?? 0;
  };

  const swapScan = (sim: Simulation, hasUtil: boolean) => {
    const list = rt.growables;
    const n = list.length;
    if (!n) return;
    const gd = growthData(sim.state);
    const slice = Math.ceil(n / SWAP_SCAN_DAYS);
    for (let c = 0; c < slice; c++) {
      if (gd.cursor >= list.length || gd.cursor < 0) gd.cursor = 0;
      if (!list.length) break;
      const b = list[gd.cursor++];
      if (sim.state.building[b.z * sim.state.size + b.x] !== b.id) continue; // (removed: its cells are cleared)
      checkSwap(sim, b, hasUtil, gd);
    }
  };

  return {
    name: 'economy.growth',
    init(sim) {
      rt.attach(sim);
      if (sub !== sim) {
        unsub?.();
        // timers are keyed by building id: prune them with the building
        unsub = sim.events.on('buildingRemoved', (b) => {
          const gd = sim.state.systemData.growth as GrowthData | undefined;
          if (!gd) return;
          const k = b.id;
          if (gd.lock?.[k] !== undefined) delete gd.lock[k];
          if (gd.low?.[k] !== undefined) delete gd.low[k];
        });
        sub = sim;
      }
      const st = sim.state;
      const gd = growthData(st);
      rt.ensureLists();
      // (a loaded city keeps the core of its last monthly update: the downtown weights continue unchanged)
      if (!gd.core && st.day > 0) gd.core = computeCore(st, rt.growables, (b) => rt.defOf(b));
      cores.set(st, gd.core ? { ...gd.core, day: st.day } : null);
      rebuildCandidates(st);
    },
    daily(sim) {
      const t0 = performance.now();
      const st = sim.state;
      rt.ensureLists();
      if (rt.candidatesDirty || st.day - lastRebuildDay >= 10 || lastRebuildDay > st.day) rebuildCandidates(st);
      computeAllowance(st);
      let any = false;
      for (let d = 0; d < 12; d++) if (allow[d] > 0) { any = true; break; }
      const hasUtil = infraFlags(st).utilities;
      if (any) {
        const pop = st.stats.population;
        const n = rt.candidateCount;
        const attempts = Math.min(GROWTH_ATTEMPTS_MAX, GROWTH_ATTEMPTS_BASE + Math.floor((GROWTH_ATTEMPTS_PER100 * n) / 100), n * 2);
        const cand = rt.candidates;
        const rng = sim.rng;
        for (let a = 0; a < attempts; a++) {
          const i = cand[rng.int(0, n - 1)];
          if (st.building[i] >= 0 || !isGrowZone(st.zone[i]) || st.network[i] !== Network.None) continue;
          tryGrow(sim, i, hasUtil, pop);
          let left = false;
          for (let d = 0; d < 12; d++) if (allow[d] > 0) { left = true; break; }
          if (!left) break;
        }
        // redevelopment with what is left
        const list = rt.growables;
        if (list.length) {
          const checks = REDEVELOP_CHECKS + Math.floor(list.length / 100);
          for (let c = 0; c < checks; c++) {
            const b = list[rng.int(0, list.length - 1)];
            if (st.building[b.z * st.size + b.x] !== b.id) continue; // (removed: its cells are cleared)
            tryRedevelop(sim, b, hasUtil, pop);
          }
        }
      }
      // gentrification / filtering down (no rng: the order of the growables list and the desirability layers decide)
      rt.ensureLists();
      swapScan(sim, hasUtil);
      // the commercial core, once a month (mid-month: away from the month-tick spike)
      if (st.day % 30 === CORE_DAY) {
        const c = computeCore(st, rt.growables, (b) => rt.defOf(b));
        growthData(st).core = c ? { x: c.x, z: c.z, jobs: c.jobs } : null;
        cores.set(st, c);
      }
      settleBank(st);
      rt.timing.growth = performance.now() - t0;
    },

  };
}

/**
 * What limits growth of DevType `dev` on cell i: max stage allowed by desirability / city population / zone density,
 * and whether the lot is rejected (WP5 inspector; SIM_DEPTH_SPEC WP6). Optional fields: `downtown` (how likely a tower
 * lot here is built at full height, by distance to the commercial core) when towers are otherwise allowed.
 */
export function growthLimits(st: CityState, i: number, dev: number): { desStage: number; popStage: number; zoneStage: number; rejected: boolean; reason?: string; downtown?: string; wealth?: string } {
  const des = st.desirability[dev]?.[i] ?? 0;
  const desStage = desirMaxStage(des);
  const popStage = popMaxStage(st.stats.population);
  const zoneStage = ZONE_MAX_STAGE[zoneDensity(st.zone[i] as Zone)] ?? 0;
  let reason: string | undefined;
  if (zoneStage <= 0) reason = 'Not zoned for growth';
  else if (des <= GROW_MIN_DESIR) reason = 'Desirability too low';
  const out: { desStage: number; popStage: number; zoneStage: number; rejected: boolean; reason?: string; downtown?: string; wealth?: string } =
    reason ? { desStage, popStage, zoneStage, rejected: true, reason } : { desStage, popStage, zoneStage, rejected: false };
  // gentrification / filtering down (same-stage wealth swaps) — why a building may change hands
  const zone = st.zone[i];
  if (dev >= 0 && dev <= DevType.CO3 && isGrowZone(zone)) {
    const kind = dev <= DevType.R3 ? 0 : dev <= DevType.CS3 ? 1 : 2;
    let best = -1, gain = SWAP_MIN_GAIN;
    for (const d2 of ZONE_DEVTYPES[zone]) {
      const k2 = d2 <= DevType.R3 ? 0 : d2 <= DevType.CS3 ? 1 : d2 <= DevType.CO3 ? 2 : 3;
      if (k2 !== kind || DEV_WEALTH[d2] <= DEV_WEALTH[dev]) continue;
      const dn = st.desirability[d2]?.[i] ?? 0;
      if (!(dn >= SWAP_MIN_DES)) continue;
      const g = dn - des;
      if (g >= gain) { gain = g; best = d2; }
    }
    const tier = (d: number) => '$'.repeat(DEV_WEALTH[d]);
    if (best >= 0) out.wealth = `gentrifying: ${tier(best)} outbids ${tier(dev)} here (+${gain.toFixed(2)}): renovated for richer tenants`;
    else if (dev === DevType.R3 && des < FILTER_DES) out.wealth = `declining: wealthy residents leave after ${FILTER_DAYS} days below ${FILTER_DES} desirability`;
  }
  if (Math.min(desStage, popStage, zoneStage) >= DOWNTOWN_STAGE) {
    const N = st.size, x = i % N, z = (i / N) | 0;
    const c = commercialCore(st);
    const w = downtownWeight(st, x, z);
    if (c) {
      const d = Math.round(Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z));
      out.downtown = w >= 0.999 ? `downtown (${d} tiles from the core): towers welcome`
        : towerLot(st, x, z) ? `${d} tiles from downtown: a tower may still rise here (${Math.round(w * 100)}% of lots this far)`
          : `${d} tiles from downtown: too far for a tower (stage 5 at most here)`;
    }
  }
  return out;
}
