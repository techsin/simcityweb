// @ts-nocheck — dev tool, bundled with rolldown (not type-checked by design; keeps `tsc --noEmit` independent of it)
/**
 * dense1m — synthetic ~1M-resident 256² city built from REAL catalog defs (no test defs), for profiling.
 *
 *   node out/dense1m/dense1m.js <outDir> [targetPop=1000000] [warmDays=120] [seed=7]
 *
 * Layout: flat terrain, road lines every 5 cells (4x4 blocks; avenues every 20 cells, a highway cross through the
 * centre, avenues / highways reach the map edges = neighbour connections), streets / roads in between.
 * Land use by distance from the centre: CBD offices + luxury towers, high-density residential ring, medium ring,
 * low / medium outer ring, industry in the east, a service block lattice (police, fire, clinics, hospitals, schools,
 * high schools, libraries, parks), utility blocks (coal / gas plants, water treatment + pumps, incinerators), bus
 * stops every ~10 road cells, a subway grid under the avenues with stations every 10 cells.
 * Growables are written directly (built, occupied at ~88 %); ploppables go through CityActions.plop (sandbox while
 * generating). The city is then saved, re-loaded into a fresh Simulation (all systems init from scratch) and warmed
 * up for `warmDays` days before the fixture is written.
 *
 * Output: <outDir>/dense1m_s<seed>.metropolis (gzip'd city bundle; load with deserializeCity(await unpackFile(bytes)))
 */
import { writeFileSync } from 'node:fs';
import { createCityState } from '../../../../src/sim/terrainGen';
import { defaultCityConfig } from '../../../../src/sim/config';
import { Simulation } from '../../../../src/sim/Simulation';
import { createSystems } from '../../../../src/sim/systems/index';
import { CityActions, lPath } from '../../../../src/sim/actions';
import { Network, Zone } from '../../../../src/core/types';
import { CATALOG, getDef } from '../../../../src/sim/catalog';
import { BF, type Building, type CityState } from '../../../../src/sim/CityState';
import { placeBuilding } from '../../../../src/sim/economy/buildings';
import { deserializeCity, serializeCity } from '../../../../src/save/serialize';
import { packFile } from '../../../../src/save/bundle';

const outDir = process.argv[2] ?? '.';
const targetPop = +(process.argv[3] ?? 1_000_000);
const warmDays = +(process.argv[4] ?? 120);
const seed = +(process.argv[5] ?? 7);
const N = 256, G = 5, OFF = 3; // road lines at OFF + k*G
const LINES: number[] = [];
for (let v = OFF; v < N - 1; v += G) LINES.push(v);
const NB = LINES.length - 1; // blocks per axis
const CB = NB / 2;

let rs = seed >>> 0 || 1;
const rnd = () => {
  rs = (rs + 0x6d2b79f5) >>> 0;
  let t = rs;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length) % a.length];

type Kind = 'R' | 'C' | 'I';
interface Plan { def: string; x: number; z: number; rot: 0 | 1 | 2 | 3; zone: Zone; kind: Kind | 'P'; }

// ------------------------------------------------------------------------------------------------ def tables
const R_TOWER = ['res_tower.r2.6', 'res_tower.r2.7', 'res_condo.r3.5', 'res_tower.r2.7', 'res_tower.r2.6', 'res_condo.r3.5'];
const R_MED2 = ['res_apartment.r2.4', 'res_condo.r3.4', 'res_condo.r3.5', 'res_apartment.r2.4', 'res_condo.r3.5', 'res_condo.r3.4', 'res_tenement.r1.5'];
const R_LOW1 = ['res_cottage.r2.1', 'res_cottage.r2.1', 'res_walkup.r1.3', 'res_cottage.r2.1', 'res_walkup.r1.4'];
const R_LUX3 = ['res_luxury_tower.r3.7', 'res_luxury_tower.r3.6'];
const C_OFFICE2 = ['com_office_tower.co2.6', 'com_office_tower.co2.7', 'com_office_tower.co3.6', 'com_office_block.co3.5', 'com_office_block.co2.4'];
const C_SHOP2 = ['com_department_store.cs3.4', 'com_hotel.cs2.4', 'com_hotel.cs1.5', 'com_office_small.co2.3', 'com_office_small.co3.3'];
const C_SHOP1 = ['com_shops_apartments.cs1.3', 'com_boutique.cs3.1', 'com_corner_store.cs1.1', 'com_diner.cs1.1'];
const I_BLOCK4 = ['ind_refinery.id.5', 'ind_refinery.id.4'];
const I_43 = ['ind_assembly_plant.im.4', 'ind_assembly_plant.im.5'];
const I_2 = ['ind_lab.iht.2', 'ind_depot.im.2', 'ind_workshop.id.1', 'ind_workshop.im.1', 'ind_lab.iht.2'];
const I_3 = ['ind_tech_campus.iht.4', 'ind_tech_campus.iht.5', 'ind_tech_campus.iht.6'];

function zoneFor(defId: string, dens: number): Zone {
  const d = getDef(defId)!;
  const zs = d.zones ?? [];
  // pick the allowed zone closest to the requested density (1 low .. 3 high) within the def's family
  let best = zs[0], bd = 99;
  for (const z of zs) {
    const zd = z === Zone.ResLow || z === Zone.ComLow ? 1 : z === Zone.ResMed || z === Zone.ComMed || z === Zone.IndMed ? 2 : z === Zone.IndAg ? 1 : 3;
    if (Math.abs(zd - dens) < bd) { bd = Math.abs(zd - dens); best = z; }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------ block plans
const G_BLOCKS = new Set(['9,9', '24,9', '39,9', '9,24', '39,24', '9,39', '24,39', '39,39']);
function blockUse(bx: number, bz: number): 'S' | 'U' | 'G' | 'I' | 'CBD' | 'RH' | 'RM' | 'RL' {
  const dx = bx + 0.5 - CB, dz = bz + 0.5 - CB;
  const d = Math.hypot(dx, dz) / CB;
  if (bx >= NB - 3 && bz >= NB - 9) return 'U';
  if (G_BLOCKS.has(bx + ',' + bz)) return 'G';
  if (bx % 3 === 1 && bz % 3 === 1) return 'S';
  if (bx >= NB - 10) return 'I';
  if (d < 0.2) return 'CBD';
  if (d < 0.45) return 'RH';
  if (d < 0.75) return 'RM';
  return 'RL';
}

function planBlock(bx: number, bz: number, towerP: number, medP: number, out: Plan[]): void {
  const x0 = LINES[bx] + 1, z0 = LINES[bz] + 1; // 4x4 interior x0..x0+3
  const use = blockUse(bx, bz);
  const quad = (defs: readonly string[], kind: Kind, dens: number) => {
    for (let q = 0; q < 4; q++) {
      const def = pick(defs);
      out.push({ def, x: x0 + (q & 1) * 2, z: z0 + (q >> 1) * 2, rot: q < 2 ? 2 : 0, zone: zoneFor(def, dens), kind });
    }
  };
  const ring1 = (defs: readonly string[], kind: Kind, dens: number, centre?: string) => {
    for (let zz = 0; zz < 4; zz++) for (let xx = 0; xx < 4; xx++) {
      const edge = xx === 0 || zz === 0 || xx === 3 || zz === 3;
      if (!edge) continue;
      const rot: 0 | 1 | 2 | 3 = zz === 0 ? 2 : zz === 3 ? 0 : xx === 0 ? 3 : 1;
      const def = pick(defs);
      out.push({ def, x: x0 + xx, z: z0 + zz, rot, zone: zoneFor(def, dens), kind });
    }
    if (centre) out.push({ def: centre, x: x0 + 1, z: z0 + 1, rot: 0, zone: Zone.None, kind: 'P' });
  };
  switch (use) {
    case 'CBD': {
      const r = rnd();
      if (r < 0.05) out.push({ def: 'com_megatower.co3.8', x: x0, z: z0, rot: 0, zone: Zone.ComHigh, kind: 'C' });
      else if (r < 0.12) { // 3x3 skyscraper / luxury tower + 1x1 shops on the L
        const big = rnd() < 0.5 ? 'com_skyscraper.co3.7' : pick(R_LUX3);
        const kind: Kind = big.startsWith('com') ? 'C' : 'R';
        out.push({ def: big, x: x0, z: z0, rot: 2, zone: kind === 'C' ? Zone.ComHigh : Zone.ResHigh, kind });
        for (let k = 0; k < 4; k++) out.push({ def: pick(C_SHOP1), x: x0 + 3, z: z0 + k, rot: 1, zone: Zone.ComHigh, kind: 'C' });
        for (let k = 0; k < 3; k++) out.push({ def: pick(C_SHOP1), x: x0 + k, z: z0 + 3, rot: 0, zone: Zone.ComHigh, kind: 'C' });
      } else if (r < 0.75) quad(C_OFFICE2, 'C', 3);
      else quad(rnd() < towerP ? R_TOWER : R_MED2, 'R', 3);
      break;
    }
    case 'RH': {
      const r = rnd();
      if (r < 0.24) quad(rnd() < 0.5 ? C_SHOP2 : C_OFFICE2, 'C', 3);
      else if (r < 0.24 + towerP) quad(R_TOWER, 'R', 3);
      else quad(R_MED2, 'R', 3);
      break;
    }
    case 'RM': {
      const r = rnd();
      if (r < 0.18) quad(C_SHOP2, 'C', 2);
      else if (r < 0.18 + medP) quad(R_MED2, 'R', 2);
      else ring1(R_LOW1, 'R', 2, rnd() < 0.5 ? 'park_plaza' : undefined);
      break;
    }
    case 'RL': {
      const r = rnd();
      if (r < 0.06) ring1(C_SHOP1, 'C', 1, 'park_plaza');
      else if (r < 0.06 + medP * 0.4) quad(R_MED2, 'R', 2);
      else ring1(R_LOW1, 'R', 1, rnd() < 0.35 ? 'park_plaza' : undefined);
      break;
    }
    case 'I': {
      const r = rnd();
      if (r < 0.3) out.push({ def: pick(I_BLOCK4), x: x0, z: z0, rot: 0, zone: Zone.IndMed, kind: 'I' });
      else if (r < 0.55) out.push({ def: pick(I_43), x: x0, z: z0, rot: 2, zone: Zone.IndHigh, kind: 'I' });
      else if (r < 0.75) {
        out.push({ def: pick(I_3), x: x0, z: z0, rot: 2, zone: Zone.IndHigh, kind: 'I' });
      } else quad(I_2, 'I', 2);
      break;
    }
    default: break; // S / U: ploppables later
  }
}

// ------------------------------------------------------------------------------------------------ build
function capOf(p: Plan): number { return getDef(p.def)?.capacity ?? 0; }

function makePlan(towerP: number, medP: number): Plan[] {
  rs = seed >>> 0 || 1;
  const out: Plan[] = [];
  for (let bz = 0; bz < NB; bz++) for (let bx = 0; bx < NB; bx++) planBlock(bx, bz, towerP, medP, out);
  return out;
}
function resCap(pl: Plan[]): number { let s = 0; for (const p of pl) if (p.kind === 'R') s += capOf(p); return s; }
function jobCap(pl: Plan[]): number { let s = 0; for (const p of pl) if (p.kind === 'C' || p.kind === 'I') s += capOf(p); return s; }

const OCC = 0.88;
// binary search the tower share for the target population
let lo = 0.0, hi = 0.9, towerP = 0.3, medP = 0.45;
for (let it = 0; it < 18; it++) {
  towerP = (lo + hi) / 2;
  const pop = resCap(makePlan(towerP, medP)) * OCC;
  if (pop > targetPop) hi = towerP; else lo = towerP;
}
const plan = makePlan(towerP, medP);
console.log(`plan: towerP=${towerP.toFixed(3)} growables=${plan.length} resCap=${resCap(plan)} jobCap=${jobCap(plan)} expected pop=${Math.round(resCap(plan) * OCC)}`);

for (const d of CATALOG) void d;
const cfg = defaultCityConfig({
  size: N, seed, name: 'Megalopolis', mayor: 'Profiler', terrain: 'flat', waterAmount: 0, hilliness: 0, treeDensity: 0.15,
  difficulty: 'medium', disasters: false,
});
const st0 = createCityState(cfg);
let water = 0;
for (let i = 0; i < st0.cells; i++) water += st0.water[i];
console.log(`terrain: water cells ${water}`);
st0.config.sandbox = true;
st0.funds = 1e9;
const sim0 = new Simulation(st0, createSystems());
const A = new CityActions(sim0);
const st = sim0.state;

// roads
const lineType = (k: number): Network => {
  const v = LINES[k];
  if (v === LINES[Math.round(NB / 2)]) return Network.Highway;
  if (k % 4 === 0) return Network.Avenue;
  return k % 2 === 1 ? Network.Street : Network.Road;
};
let netFail = 0;
const failWhy: Record<string, number> = {};
for (let k = 0; k < LINES.length; k++) {
  const t = lineType(k);
  const reach = t === Network.Highway || t === Network.Avenue;
  const a = reach ? 0 : LINES[0], b = reach ? N - 1 : LINES[LINES.length - 1];
  const v = LINES[k];
  // horizontal (z = v) and vertical (x = v), in 50-cell pieces (bridges / costs are irrelevant on flat land)
  // streets cannot touch the highway: the 5 cells around the crossing become a road
  const hw = LINES[Math.round(NB / 2)];
  const cuts = t === Network.Street ? [a, hw - 2, hw + 2, b] : [a, b];
  for (let c = 0; c + 1 < cuts.length; c++) for (let s = cuts[c]; s < cuts[c + 1]; s += 50) {
    const e = Math.min(cuts[c + 1], s + 50);
    const t = c === 1 ? Network.Road : lineType(k);
    const r1 = A.buildNetwork(lPath({ x: s, z: v }, { x: e, z: v }), t);
    if (!r1.ok) { netFail++; failWhy[r1.reason ?? '?'] = (failWhy[r1.reason ?? '?'] ?? 0) + 1; }
    const r2 = A.buildNetwork(lPath({ x: v, z: s }, { x: v, z: e }), t);
    if (!r2.ok) { netFail++; failWhy[r2.reason ?? '?'] = (failWhy[r2.reason ?? '?'] ?? 0) + 1; }
  }
}
let roadCells = 0;
for (let i = 0; i < st.cells; i++) if (st.network[i] >= Network.Street && st.network[i] <= Network.Highway) roadCells++;
console.log(`roads: ${roadCells} cells, ${netFail} failed segments`, JSON.stringify(failWhy));

// growables (direct placement, built and occupied)
const zoneRects = new Map<Zone, number>();
let placed = 0, skipped = 0;
for (const p of plan) {
  const def = getDef(p.def)!;
  let [w, d] = def.footprint;
  if (p.rot === 1 || p.rot === 3) [w, d] = [d, w];
  let free = true;
  for (let zz = p.z; zz < p.z + d && free; zz++) for (let xx = p.x; xx < p.x + w; xx++) {
    const i = zz * N + xx;
    if (st.building[i] >= 0 || st.network[i] !== Network.None || st.water[i]) { free = false; break; }
  }
  if (!free) { skipped++; continue; }
  if (p.kind === 'P') {
    const r = A.plop(p.def, p.x, p.z, p.rot);
    if (r.ok) placed++; else skipped++;
    continue;
  }
  for (let zz = p.z; zz < p.z + d; zz++) for (let xx = p.x; xx < p.x + w; xx++) { st.zone[zz * N + xx] = p.zone; st.trees[zz * N + xx] = 0; }
  zoneRects.set(p.zone, (zoneRects.get(p.zone) ?? 0) + w * d);
  const cap = def.capacity ?? 0;
  const id = st.nextBuildingId++;
  const b: Building = {
    id, def: def.id, x: p.x, z: p.z, w, d, rot: p.rot, variant: Math.floor(rnd() * 3), pop: 0, jobs: 0, capacity: cap,
    wealth: def.devType === 0 || def.devType === 3 ? 1 : def.devType === 2 || def.devType === 5 || def.devType === 7 ? 3 : 2,
    built: 1, age: 400 + Math.floor(rnd() * 2000), flags: BF.Powered | BF.Watered, baseY: st.cellHeight(p.x, p.z), health: 0.8, unhappy: 0,
  };
  if (p.kind === 'R') b.pop = Math.round(cap * (OCC - 0.06 + rnd() * 0.12));
  else b.jobs = Math.round(cap * 0.8);
  placeBuilding(sim0, b);
  placed++;
}
sim0.events.emit('zoneChanged', { x0: 0, z0: 0, x1: N, z1: N });
console.log(`growables placed ${placed}, skipped ${skipped}`);

// ploppables: service lattice + utilities
for (const d of CATALOG) if (d.requires) st.unlocked.add(d.requires);
const plopAt = (defId: string, x: number, z: number, rot: 0 | 1 | 2 | 3 = 0): boolean => {
  const r = A.plop(defId, x, z, rot);
  if (!r.ok) { plopFail[defId] = (plopFail[defId] ?? 0) + 1; }
  else plopOk[defId] = (plopOk[defId] ?? 0) + 1;
  return r.ok;
};
const plopFail: Record<string, number> = {}, plopOk: Record<string, number> = {};
let sIdx = 0;
const S_KIND = ['quad', 'school', 'high', 'lq', 'school', 'hospital', 'quad', 'school', 'high', 'lq', 'school', 'park', 'quad', 'hospital', 'high', 'school'];
for (let bz = 0; bz < NB; bz++) for (let bx = 0; bx < NB; bx++) {
  if (blockUse(bx, bz) !== 'S') continue;
  const x0 = LINES[bx] + 1, z0 = LINES[bz] + 1;
  const k = S_KIND[sIdx++ % S_KIND.length];
  if (k === 'quad') {
    const four = ['civ_police_station', 'civ_fire_station', 'civ_clinic', 'civ_clinic'];
    for (let q = 0; q < 4; q++) plopAt(four[q], x0 + (q & 1) * 2, z0 + (q >> 1) * 2, q < 2 ? 2 : 0);
  } else if (k === 'lq') {
    const four = ['civ_library', 'civ_clinic', 'park_plaza', 'park_garden'];
    for (let q = 0; q < 4; q++) plopAt(four[q], x0 + (q & 1) * 2, z0 + (q >> 1) * 2, q < 2 ? 2 : 0);
  } else if (k === 'school' || k === 'hospital') {
    plopAt(k === 'school' ? 'civ_elementary_school' : 'civ_hospital', x0, z0, 2);
    for (let t = 0; t < 4; t++) plopAt(pick(['park_small', 'park_playground', 'park_basketball']), x0 + 3, z0 + t, 1);
    for (let t = 0; t < 3; t++) plopAt(pick(['park_small', 'park_playground']), x0 + t, z0 + 3, 0);
  } else if (k === 'high') plopAt('civ_high_school', x0, z0, 2);
  else if (k === 'park') plopAt('park_large', x0, z0, 0);
  else if (k === 'college') plopAt(sIdx % 2 ? 'civ_medical_center' : 'civ_high_school', x0, z0, 2);
}
// bus stops every ~10 road cells on roads / avenues (not highways)
let stops = 0;
for (let k = 0; k < LINES.length; k++) {
  const v = LINES[k];
  for (let s = LINES[0] + 2; s < N - 4; s += 10) {
    for (const i of [v * N + s, s * N + v]) {
      const t = st.network[i];
      if (t >= Network.Street && t <= Network.Avenue) { st.netFlags[i] |= 1 << 4; stops++; }
    }
  }
}
sim0.events.emit('networkChanged', { x0: 0, z0: 0, x1: N, z1: N });
console.log(`bus stops ${stops}`);

// subway grid under avenue lines (every 4th line, both directions) with stations every 10 cells
let stations = 0;
for (let k = 0; k < LINES.length; k += 4) {
  const v = LINES[k];
  for (let t = LINES[0]; t <= LINES[LINES.length - 1]; t++) { st.subway[v * N + t] = 1; st.subway[t * N + v] = 1; }
  for (let t = LINES[0] + 3; t < LINES[LINES.length - 1] - 2; t += 10) {
    for (const [sx, sz] of [[t, v + 1], [v + 1, t]] as const) {
      const i = sz * N + sx;
      if (st.network[i] !== Network.None) continue;
      const old = st.building[i];
      if (old >= 0) {
        const ob = st.buildings.get(old)!;
        if (ob.flags & BF.Plopped) continue;
        // growable in the way: remove it
        for (let zz = ob.z; zz < ob.z + ob.d; zz++) for (let xx = ob.x; xx < ob.x + ob.w; xx++) st.building[zz * N + xx] = -1;
        st.buildings.delete(old);
      }
      st.zone[i] = Zone.None;
      if (plopAt('tr_subway_station', sx, sz, 0)) { st.subway[i] = 1; stations++; }
    }
  }
}
sim0.events.emit('subwayChanged', { x0: 0, z0: 0, x1: N, z1: N });
console.log(`subway stations ${stations}`);

// utilities: compute demand, then fill the utility blocks (east / south-east corner) with plants
const util = sim0.getSystem('utilities') as unknown as { compute(s: Simulation): void };
util.compute(sim0);
const pol = sim0.getSystem('pollution') as unknown as { compute?(s: Simulation, f: boolean): void };
pol.compute?.(sim0, true);
let pd = st.stats.powerDemand, wd = st.stats.waterDemand, gp = st.stats.garbageProduced;
console.log(`demand before utilities: power ${pd.toFixed(0)} MW, water ${wd.toFixed(0)} kL, garbage ${gp.toFixed(0)} t`);
const uBlocks: [number, number][] = [];
for (let bz = 0; bz < NB; bz++) for (let bx = 0; bx < NB; bx++) if (blockUse(bx, bz) === 'U') uBlocks.push([LINES[bx] + 1, LINES[bz] + 1]);
let pOut = 0, wOut = 0, gCap = 0, ub = 0;
// garbage: an incinerator (3x3) + small parks in each garbage block (spread over the map: truck range)
for (let bz = 0; bz < NB; bz++) for (let bx = 0; bx < NB; bx++) {
  if (blockUse(bx, bz) !== 'G') continue;
  const x0 = LINES[bx] + 1, z0 = LINES[bz] + 1;
  if (plopAt('util_incinerator', x0, z0, 2)) gCap += 12000;
  for (let t = 0; t < 4; t++) plopAt('park_small', x0 + 3, z0 + t, 1);
  for (let t = 0; t < 3; t++) plopAt('park_small', x0 + t, z0 + 3, 0);
}
while (pOut < pd * 1.3 + 200 && ub < uBlocks.length) { const [x, z] = uBlocks[ub++]; if (plopAt('util_coal_plant', x, z, 0)) pOut += 400; }
while (wOut < wd * 1.3 + 5000 && ub < uBlocks.length) {
  const [x, z] = uBlocks[ub++];
  if (plopAt('util_water_treatment', x, z, 2)) wOut += 50000;
  for (let t = 0; t < 4; t++) if (plopAt('util_water_pump', x + 3, z + t, 1)) wOut += 5000;
  for (let t = 0; t < 3; t++) if (plopAt('util_water_pump', x + t, z + 3, 0)) wOut += 5000;
}
while (gCap < gp * 1.4 + 2000 && ub < uBlocks.length) { const [x, z] = uBlocks[ub++]; if (plopAt('util_incinerator', x, z, 2)) gCap += 12000; }
console.log(`utilities: power ${pOut} MW, water ${wOut} kL, garbage ${gCap} t/month, utility blocks used ${ub}/${uBlocks.length}`);
console.log('plopped', JSON.stringify(plopOk), 'failed', JSON.stringify(plopFail));

// finalize config
st.config.sandbox = false;
st.funds = 5_000_000;
st.day = 360 * 30 + 1; // year 2030
let pop = 0, bl = 0;
for (const b of st.buildings.values()) { pop += b.pop; bl++; }
st.stats.population = pop;
console.log(`generated: buildings ${bl} residents ${pop}`);

// save -> reload into a fresh simulation (systems init from scratch) -> warm up
const t0 = performance.now();
const reload = (s: CityState) => deserializeCity(serializeCity(s, { copy: true }));
const sim = new Simulation(reload(st), createSystems());
console.log(`reload + init ${(performance.now() - t0).toFixed(0)} ms; pop ${sim.state.stats.population}`);
const t1 = performance.now();
for (let d = 0; d < warmDays; d++) {
  sim.advanceDay();
  if ((d + 1) % 30 === 0) {
    const s = sim.state.stats;
    let p = 0; for (const b of sim.state.buildings.values()) p += b.pop;
    console.log(`warm day ${d + 1}: pop ${s.population} (sum ${p}) buildings ${sim.state.buildings.size} unemployment ${(s.unemployment * 100).toFixed(1)}% power ${s.powerSupply.toFixed(0)}/${s.powerDemand.toFixed(0)} water ${s.waterSupply.toFixed(0)}/${s.waterDemand.toFixed(0)} garbage ${s.garbageProduced.toFixed(0)}/${s.garbageCapacity.toFixed(0)} commute ${s.avgCommute.toFixed(1)} funds ${Math.round(sim.state.funds)} ${((performance.now() - t1) / 1000).toFixed(0)}s`);
  }
}
const bytes = await packFile(serializeCity(sim.state, { copy: true }), true);
const file = `${outDir}/dense1m_s${seed}.metropolis`;
writeFileSync(file, bytes);
console.log(`saved ${file} ${(bytes.length / 1e6).toFixed(2)} MB; pop ${sim.state.stats.population} buildings ${sim.state.buildings.size} day ${sim.state.day}`);
