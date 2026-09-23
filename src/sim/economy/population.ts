/**
 * Population system: construction progress, daily aggregation of residents / jobs (→ CityStats),
 * employment, and the time-sliced occupancy pass (building health, fill / vacancy, abandonment, recovery,
 * rubble cleanup).
 *
 * Flag ownership for GROWABLES (sim-core): NoRoad, NoJobs, Polluted, Crime, Abandoned, Constructing.
 * Powered / Watered are owned by sim-infra's utilities system when present (read from flags OR the
 * powered/watered layers); without infra sim-core sets them on every building.
 * buildingChanged is emitted when flags change, construction reaches 25/50/75/100 %, or a building
 * becomes (un)occupied — not for every resident moving in.
 */
import type { SimSystem, Simulation } from '../Simulation';
import { BF, type Building, type CityState } from '../CityState';
import { hash2 } from '../../core/rng';
import { DevType, zoneDensity } from '../../core/types';
import { getDef } from '../catalog';
import {
  ABANDON_DAYS, COARSE, CONSTRUCT_DAYS_BASE, CONSTRUCT_DAYS_PER_STAGE, CONSTRUCT_RAND, FILL_RATE, HEALTH_SMOOTH, OCC_PERIOD,
  PENALTY_NO_GARBAGE, PENALTY_NO_POWER, PENALTY_NO_ROAD, PENALTY_NO_WATER, RECOVER_RATE, REGION_COMMUTERS_BASE,
  REGION_COMMUTERS_FRAC, REGION_COMMUTERS_ISOLATED, REGION_COMMUTERS_MAX_SHARE, RUBBLE_CLEAR_DAYS, UNHAPPY_DEMAND,
  UNHAPPY_HEALTH, WATER_REQUIRED_STAGE, WORKFORCE_RATIO,
} from './tuning';
import { type EconRuntime, infraFlags } from './runtime';
import { frontHasRoad, removeBuilding } from './buildings';
import { ordinanceEffect } from './ordinances';

export function constructionDays(b: Building, stage: number): number {
  return CONSTRUCT_DAYS_BASE + CONSTRUCT_DAYS_PER_STAGE * stage + Math.floor(hash2(b.id, 17) * CONSTRUCT_RAND);
}

/** true when the building has power (infra flags / layer, or always without the utilities system) */
export function buildingPowered(st: CityState, b: Building, hasUtilities: boolean): boolean {
  if (!hasUtilities) return true;
  if (b.flags & BF.Powered) return true;
  return st.powered[b.z * st.size + b.x] === 1 || st.powered[(b.z + b.d - 1) * st.size + b.x + b.w - 1] === 1;
}
export function buildingWatered(st: CityState, b: Building, hasUtilities: boolean): boolean {
  if (!hasUtilities) return true;
  if (b.flags & BF.Watered) return true;
  return st.watered[b.z * st.size + b.x] === 1 || st.watered[(b.z + b.d - 1) * st.size + b.x + b.w - 1] === 1;
}

export function populationSystem(rt: EconRuntime): SimSystem {
  let cursor = 0;
  const burntSince = new Map<number, number>();

  const aggregate = (sim: Simulation) => {
    const st = sim.state;
    const t = rt.totals;
    t.pop[0] = t.pop[1] = t.pop[2] = 0;
    t.resCapAll[0] = t.resCapAll[1] = t.resCapAll[2] = 0;
    t.resCapBuilt[0] = t.resCapBuilt[1] = t.resCapBuilt[2] = 0;
    t.jobs.fill(0); t.jobCapAll.fill(0); t.jobCapBuilt.fill(0); t.countByDev.fill(0);
    t.civicJobCap = t.civicJobs = t.abandoned = t.constructing = 0;
    rt.coarsePopRaw.fill(0); rt.coarseWealthRaw.fill(0); rt.coarseCountRaw.fill(0);
    const cw = rt.cw;
    const list = rt.growables;
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      const def = getDef(b.def);
      if (!def || def.devType === undefined) continue;
      const dev = def.devType;
      const blk = (((b.z + (b.d >> 1)) / COARSE) | 0) * cw + (((b.x + (b.w >> 1)) / COARSE) | 0);
      if (b.flags & (BF.Abandoned | BF.Burnt)) { t.abandoned++; continue; }
      t.countByDev[dev]++;
      const constructing = (b.flags & BF.Constructing) !== 0;
      if (constructing) t.constructing++;
      if (dev <= DevType.R3) {
        t.pop[dev] += b.pop;
        t.resCapAll[dev] += b.capacity;
        if (!constructing) t.resCapBuilt[dev] += b.capacity;
        rt.coarsePopRaw[blk] += b.pop;
      } else {
        t.jobs[dev] += b.jobs;
        t.jobCapAll[dev] += b.capacity;
        if (!constructing) t.jobCapBuilt[dev] += b.capacity;
      }
      rt.coarseWealthRaw[blk] += b.wealth - 2;
      rt.coarseCountRaw[blk]++;
    }
    for (const b of rt.plopped) {
      if (b.flags & BF.Burnt) continue;
      t.civicJobCap += b.capacity;
      t.civicJobs += b.jobs;
    }
    t.growables = list.length;
    t.population = t.pop[0] + t.pop[1] + t.pop[2];
    // blur coarse grids (3×3)
    for (let bz = 0; bz < cw; bz++) {
      for (let bx = 0; bx < cw; bx++) {
        let sp = 0, sw = 0, sc = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const z = bz + dz;
          if (z < 0 || z >= cw) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const x = bx + dx;
            if (x < 0 || x >= cw) continue;
            const b = z * cw + x;
            const wgt = dx === 0 && dz === 0 ? 1 : 0.5;
            sp += rt.coarsePopRaw[b] * wgt; sw += rt.coarseWealthRaw[b] * wgt; sc += rt.coarseCountRaw[b] * wgt;
          }
        }
        rt.coarsePop[bz * cw + bx] = sp;
        rt.coarseWealth[bz * cw + bx] = sc > 0 ? sw / sc : 0;
      }
    }
    // employment
    const P = t.population;
    const W = P * WORKFORCE_RATIO;
    let jobCap = t.civicJobCap;
    for (let d = DevType.CS1; d <= DevType.IHT; d++) jobCap += t.jobCapBuilt[d];
    const connected = st.neighborConnections.length > 0;
    const regional = Math.min(jobCap * REGION_COMMUTERS_MAX_SHARE, REGION_COMMUTERS_BASE + REGION_COMMUTERS_FRAC * W) * (connected ? 1 : REGION_COMMUTERS_ISOLATED);
    const fillable = Math.min(jobCap, W + regional);
    rt.jobFill = jobCap > 0 ? fillable / jobCap : 0;
    const employed = Math.min(W, jobCap);
    rt.employedRatio = W > 0 ? employed / W : 1;
    // stats
    const s = st.stats;
    s.population = Math.round(P);
    s.residents[0] = Math.round(t.pop[0]); s.residents[1] = Math.round(t.pop[1]); s.residents[2] = Math.round(t.pop[2]);
    for (let d = 0; d < 12; d++) { s.jobsByDev[d] = Math.round(t.jobs[d]); s.jobCapByDev[d] = t.jobCapBuilt[d]; }
    s.workforce = Math.round(W);
    s.employed = Math.round(employed);
    s.unemployment = W > 0 ? Math.max(0, 1 - employed / W) : 0;
    s.buildingCount = st.buildings.size;
  };

  const construction = (sim: Simulation) => {
    const list = rt.constructing;
    for (let k = list.length - 1; k >= 0; k--) {
      const b = list[k];
      if (!sim.state.buildings.has(b.id) || !(b.flags & BF.Constructing)) { list[k] = list[list.length - 1]; list.pop(); continue; }
      const stage = getDef(b.def)?.stage ?? 1;
      const q0 = Math.floor(b.built * 4);
      b.built = Math.min(1, b.built + 1 / constructionDays(b, stage));
      if (b.built >= 0.999) {
        b.built = 1;
        b.flags &= ~BF.Constructing;
        list[k] = list[list.length - 1];
        list.pop();
        sim.events.emit('buildingChanged', b);
      } else if (Math.floor(b.built * 4) !== q0) sim.events.emit('buildingChanged', b);
    }
  };

  const occupancy = (sim: Simulation) => {
    const st = sim.state;
    const inf = infraFlags(st);
    const list = rt.growables;
    const n = list.length;
    if (!n) return;
    const slice = Math.ceil(n / OCC_PERIOD);
    const N = st.size;
    const demand = st.stats.demand;
    const cleanup = ordinanceEffect(st, 'add.rubble.cleanup') > 0;
    const fillK = Math.min(1, FILL_RATE * OCC_PERIOD);
    const jobFill = rt.jobFill;
    const unemp = st.stats.unemployment;
    for (let c = 0; c < slice; c++) {
      if (cursor >= list.length) cursor = 0;
      const b = list[cursor++];
      if (!st.buildings.has(b.id)) continue;
      b.age += OCC_PERIOD;
      const flags0 = b.flags;
      const occupied0 = b.pop + b.jobs > 0;
      if (b.flags & BF.Burnt) {
        b.pop = 0; b.jobs = 0;
        let since = burntSince.get(b.id);
        if (since === undefined) burntSince.set(b.id, (since = st.day));
        if (cleanup && st.day - since >= RUBBLE_CLEAR_DAYS) { burntSince.delete(b.id); removeBuilding(sim, b); }
        continue;
      }
      if (b.flags & BF.Constructing) continue;
      const def = getDef(b.def);
      if (!def || def.devType === undefined) continue;
      const dev = def.devType;
      const isR = dev <= DevType.R3;
      const i = (b.z + (b.d >> 1)) * N + b.x + (b.w >> 1);
      // ---- conditions
      if (!inf.utilities) b.flags |= BF.Powered | BF.Watered;
      const powered = buildingPowered(st, b, inf.utilities);
      const needWater = (def.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(st.zone[i]) >= 2;
      const watered = buildingWatered(st, b, inf.utilities);
      const road = frontHasRoad(st, b);
      if (road) b.flags &= ~BF.NoRoad; else b.flags |= BF.NoRoad;
      const des = st.desirability[dev][i];
      let target = 0.5 + 0.5 * des;
      if (!powered) target -= PENALTY_NO_POWER;
      if (needWater && !watered) target -= PENALTY_NO_WATER;
      if (!road) target -= PENALTY_NO_ROAD;
      if (b.flags & BF.NoGarbage) target -= PENALTY_NO_GARBAGE;
      target = Math.max(0, Math.min(1, target));
      b.health += (target - b.health) * HEALTH_SMOOTH;
      // complaint flags
      if (st.airPollution[i] > 0.45 && isR) b.flags |= BF.Polluted; else b.flags &= ~BF.Polluted;
      if (st.crime[i] > 0.5) b.flags |= BF.Crime; else b.flags &= ~BF.Crime;
      if (isR && unemp > 0.15) b.flags |= BF.NoJobs; else b.flags &= ~BF.NoJobs;
      // ---- unhappiness / abandonment
      const dmd = demand[dev];
      const unhappy = b.health < UNHAPPY_HEALTH || dmd < UNHAPPY_DEMAND || !powered || !road;
      if (unhappy) b.unhappy += OCC_PERIOD;
      else b.unhappy = Math.max(0, b.unhappy - RECOVER_RATE * OCC_PERIOD);
      if (!(b.flags & BF.Abandoned) && b.unhappy >= ABANDON_DAYS && !(b.flags & BF.Historic)) {
        b.flags |= BF.Abandoned;
        b.pop = 0; b.jobs = 0;
      } else if (b.flags & BF.Abandoned && b.unhappy === 0) {
        b.flags &= ~BF.Abandoned;
      }
      if (b.flags & (BF.Abandoned | BF.OnFire)) {
        b.pop = 0; b.jobs = 0;
      } else {
        // ---- occupancy
        const demandFactor = Math.max(0.3, Math.min(1, 1 + 0.5 * Math.min(0, dmd)));
        let occ = demandFactor * (0.6 + 0.4 * b.health);
        if (!powered) occ *= 0.25;
        if (needWater && !watered) occ *= 0.5;
        if (isR) {
          const goal = b.capacity * occ;
          b.pop = Math.round(b.pop + (goal - b.pop) * fillK);
          if (b.pop === 0 && goal > 0.5) b.pop = 1;
        } else {
          const goal = b.capacity * occ * jobFill;
          b.jobs = Math.round(b.jobs + (goal - b.jobs) * fillK);
          if (b.jobs === 0 && goal > 0.5) b.jobs = 1;
        }
      }
      if (b.flags !== flags0 || occupied0 !== b.pop + b.jobs > 0) sim.events.emit('buildingChanged', b);
    }
    // civic buildings: jobs filled from the workforce
    for (const b of rt.plopped) b.jobs = Math.round(b.capacity * jobFill);
  };

  return {
    name: 'economy.population',
    init(sim) {
      rt.attach(sim);
      cursor = 0;
      burntSince.clear();
      rt.ensureLists();
      aggregate(sim);
    },
    daily(sim) {
      const t0 = performance.now();
      rt.ensureLists();
      construction(sim);
      occupancy(sim);
      rt.ensureLists();
      aggregate(sim);
      rt.timing.population = performance.now() - t0;
    },
  };
}
