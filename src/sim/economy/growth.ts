/**
 * Growth: turns demand into buildings (SC4 style).
 *  - Each day a capacity ALLOWANCE per DevType = positive absolute demand × GROWTH_RESPONSE (min / throughput caps).
 *  - Candidate front cells (zoned, empty, 4-adjacent to a road) are sampled; for each: pick a DevType of the zone
 *    weighted by desirability × allowance, the max stage from zone density ∧ population milestone ∧ desirability,
 *    then a def (preferring the highest allowed stage) and carve a lot of its rotated footprint whose whole front
 *    edge touches the road (building faces the road). Power is required; water for stage ≥ 3 or medium/high zones.
 *  - Redevelopment: random existing growables are replaced by higher-stage (bigger) buildings when demand and
 *    desirability allow, merging adjacent small lots — this is how skylines emerge. Abandoned lots get rebuilt.
 *  - New buildings start with BF.Constructing (population system advances construction).
 */
import type { SimSystem, Simulation } from '../Simulation';
import { BF, type Building, type CityState } from '../CityState';
import { Network, Zone, zoneDensity } from '../../core/types';
import { DEV_WEALTH, ZONE_DEVTYPES, devFamily, getDef, growablesForZone, rotatedFootprint } from '../catalog';
import type { BuildingDef } from '../catalogTypes';
import { MANIFEST_BY_ID } from '../../assets/manifest';
import {
  GROW_MAX_SLOPE, GROW_MAX_SLOPE_PER_CELL, GROW_MIN_DESIR, GROWTH_ATTEMPTS_BASE, GROWTH_ATTEMPTS_MAX, GROWTH_ATTEMPTS_PER100,
  GROWTH_BANK_DAYS, GROWTH_BANK_MIN_FRAC, GROWTH_MAX_BASE, GROWTH_MAX_FRAC, GROWTH_MAX_SCALE, GROWTH_MIN_ALLOW,
  GROWTH_OVERSHOOT_SLACK, GROWTH_RESPONSE, GROWTH_SIZE_DEMAND,
  REDEVELOP_CHECKS, REDEVELOP_MIN_AGE, REDEVELOP_MIN_GAIN, STAGE_DES_D0, STAGE_DES_D1, STAGE_POP, STAGE_PREF,
  WATER_REQUIRED_STAGE, ZONE_MAX_STAGE, isGrowZone,
} from './tuning';
import { type EconRuntime, econData, infraFlags } from './runtime';
import { levelLot, lotAverageHeight, lotSlope, placeBuilding, removeBuilding } from './buildings';

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

export function growthSystem(rt: EconRuntime): SimSystem {
  const allow = new Float64Array(12);
  const capLimit = new Float64Array(12);
  const devW = new Float64Array(12);
  const defPick: BuildingDef[] = [];
  const defW: number[] = [];
  const replaced: Building[] = [];
  let lastRebuildDay = -1;

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
      devW[k] = (des - GROW_MIN_DESIR + 0.05) * Math.sqrt(allow[d]);
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

  /** collect candidate defs into defPick/defW; returns count */
  const collectDefs = (zone: number, dev: number, minStage: number, maxStage: number, capMax: number, capMin: number): number => {
    defPick.length = 0;
    defW.length = 0;
    const list = growablesForZone(zone as Zone);
    let top = 0;
    for (const d of list) {
      if (d.devType !== dev) continue;
      const s = d.stage ?? 1, c = d.capacity ?? 0;
      if (s < minStage || s > maxStage || c > capMax || c < capMin) continue;
      defPick.push(d);
      if (s > top) top = s;
    }
    for (const d of defPick) defW.push(Math.exp(STAGE_PREF * ((d.stage ?? 1) - top)));
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

  const create = (sim: Simulation, def: BuildingDef, x0: number, z0: number, W: number, D: number, rot: number, hasUtil: boolean): Building => {
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
    const b: Building = {
      id, def: def.id, x: x0, z: z0, w: W, d: D, rot: rot as 0 | 1 | 2 | 3, variant: sim.rng.int(0, variants - 1),
      pop: 0, jobs: 0, capacity: def.capacity ?? 0, wealth: DEV_WEALTH[def.devType ?? 0], built: 0, age: 0,
      flags: BF.Constructing | (hasUtil ? 0 : BF.Powered | BF.Watered), baseY, health: 0.6, unhappy: 0,
    };
    placeBuilding(sim, b);
    const rect = { x0, z0, x1: x0 + W, z1: z0 + D };
    if (trees) sim.events.emit('treesChanged', rect);
    if (changed) sim.events.emit('terrainChanged', changed);
    return b;
  };

  /** try to fit `def` facing road side `rot` with cell (cx,cz) on the front row; returns [x0,z0] or null */
  const fitNew = (st: CityState, def: BuildingDef, rot: number, cx: number, cz: number, zone: number, hasUtil: boolean, rng: Simulation['rng']): [number, number] | null => {
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
      return [x0, z0];
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
    const maxStage = Math.min(ZONE_MAX_STAGE[zoneDensity(zone as Zone)], popMaxStage(pop), desirMaxStage(des));
    const capMax = capMaxFor(dev);
    if (!collectDefs(zone, dev, 1, maxStage, capMax, 0)) return false;
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
        const [W, D] = rotatedFootprint(def, rot);
        create(sim, def, pos[0], pos[1], W, D, rot, hasUtil);
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
    const maxStage = Math.min(ZONE_MAX_STAGE[zoneDensity(zone as Zone)], popMaxStage(pop), desirMaxStage(des));
    const minStage = dead ? 1 : stage0 + 1;
    if (maxStage < minStage) return false;
    const oldCapAlive = dead ? 0 : b.capacity;
    const capMax = oldCapAlive + capMaxFor(dev);
    if (!collectDefs(zone, dev, minStage, maxStage, capMax, dead ? 0 : b.capacity * REDEVELOP_MIN_GAIN)) return false;
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
        create(sim, def, x0, z0, W, D, rot, hasUtil);
        allow[dev] -= (def.capacity ?? 0) - oldCap;
        return true;
      }
    }
    return false;
  };

  return {
    name: 'economy.growth',
    init(sim) {
      rt.attach(sim);
      rebuildCandidates(sim.state);
    },
    daily(sim) {
      const t0 = performance.now();
      const st = sim.state;
      rt.ensureLists();
      if (rt.candidatesDirty || st.day - lastRebuildDay >= 10 || lastRebuildDay > st.day) rebuildCandidates(st);
      computeAllowance(st);
      let any = false;
      for (let d = 0; d < 12; d++) if (allow[d] > 0) { any = true; break; }
      if (any) {
        const hasUtil = infraFlags(st).utilities;
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
            if (!st.buildings.has(b.id)) continue;
            tryRedevelop(sim, b, hasUtil, pop);
          }
        }
      }
      settleBank(st);
      rt.timing.growth = performance.now() - t0;
    },
  };
}
