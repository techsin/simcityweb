/**
 * Population system: construction progress, daily aggregation of residents / jobs / cohorts (→ CityStats),
 * employment, the time-sliced occupancy pass (building health, fill / vacancy, hiring, demographics, abandonment,
 * recovery, rubble cleanup) and — with sim-infra services — the monthly EQ / HQ update (SIM_DEPTH_SPEC WP1).
 *
 * Flag ownership for GROWABLES: sim-core always owns NoRoad, Abandoned, Constructing, NeedsUnmet. Powered / Watered
 * (utilities), NoJobs (traffic), Polluted (pollution), Crime (crime) and NoGarbage / Congested are owned by sim-infra
 * when its systems are present; without infra sim-core sets Powered|Watered on every building and derives NoJobs /
 * Polluted / Crime itself.
 *
 * CONDITION (health target, conditionBreakdown explains it): 0.5 + 0.5 × desirability − no power / no water (when
 * required) / no road / no garbage pickup − can't reach jobs (traffic) − unmet cohort needs (demographics, capped) −
 * night noise (sleep) + piped water bonus for low-density homes − unsafe tap water. Homes that need water and have
 * none count as unhappy (abandon after ABANDON_DAYS).
 *
 * ONE EMPLOYMENT LEDGER (WP1-1): C / I / civic buildings post b.hire × capacity job slots (hire = demand × condition ×
 * power × water); traffic matches pop × b.wf workers against those slots; b.jobs → slots × traffic jobFill (the
 * analytic global fill only until traffic has assessed the building); employed = EMA(Σ pop × wf × workerAccess) incl.
 * regional jobs, so stats.unemployment, traffic's access and the filled jobs agree. Without traffic the analytic model
 * (local jobs + regional commuters, systemData.regionJobs when the region layer provides it) is used.
 * buildingChanged is emitted when flags change, construction reaches 25/50/75/100 %, or a building
 * becomes (un)occupied — not for every resident moving in.
 */
import type { SimSystem, Simulation } from '../Simulation';
import { BF, type Building, type CityState } from '../CityState';
import type { BuildingDef } from '../catalogTypes';
import { hash2 } from '../../core/rng';
import { DevType, zoneDensity } from '../../core/types';
import { DAYS_PER_MONTH } from '../../core/constants';
import {
  ABANDON_DAYS, COARSE, CONSTRUCT_DAYS_BASE, CONSTRUCT_DAYS_PER_STAGE, CONSTRUCT_RAND, DEMOGRAPHICS_EVENT_DAYS,
  EMPLOYED_EMA, FILL_RATE, HEALTH_SMOOTH, JOB_ACCESS_MIN, NOISE_SLEEP, NOISE_SLEEP_START, OCC_PERIOD, PENALTY_NO_GARBAGE,
  PENALTY_NO_JOB_ACCESS, PENALTY_NO_POWER, PENALTY_NO_ROAD, PENALTY_NO_WATER, RECOVER_RATE, REGION_COMMUTERS_BASE,
  REGION_COMMUTERS_FRAC, REGION_COMMUTERS_ISOLATED, REGION_COMMUTERS_MAX_SHARE, REGION_JOBS_FOR_RESIDENTS,
  RUBBLE_CLEAR_DAYS, TAP_PENALTY, TAP_SAFE, TRAFFIC_JOBFILL_WEIGHT, UNHAPPY_DEMAND, UNHAPPY_DEMAND_HEALTH,
  UNHAPPY_HEALTH, VACANCY_K, VACANCY_MIN, VACANCY_START, WATER_BONUS_LOW, WATER_REQUIRED_STAGE, WORKFORCE_EMA,
  WORKFORCE_MAX, WORKFORCE_MIN, WORKFORCE_RATIO, COHORT_BASE, NEEDS_ABANDON_SHARE,
} from './tuning';
import { type EconRuntime, type InfraFlags, infraFlags } from './runtime';
import { frontHasRoad, removeBuilding } from './buildings';
import { ordinanceEffect } from './ordinances';
import type { FactorTerm } from '../explain';
import { getDef } from '../catalog';
import {
  type DemographicsCtx, DemographicsCache, bindDemographics, demographicsCtx, demographicsData, demographicsSim, evaluateNeeds, needsOf,
  updateDemographics, updateEqHq,
} from './demographics';

/** duck-typed view of sim-infra's TrafficSystem (optional methods; -1 = not assessed yet) */
interface TrafficApi {
  jobFill?: (id: number) => number;
  workerAccess?: (id: number) => number;
  /** residential worker access by building id (-1 = not assessed) — read directly in the daily aggregate */
  accessById?: Float32Array;
}
/** duck-typed view of sim-infra's UtilitiesSystem (WP3-5 per-network tap-water quality) */
interface UtilitiesApi {
  waterQualityAt?: (sim: Simulation, cell: number) => number;
}

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

// ------------------------------------------------------------------------------------------------ condition
interface CondCtx {
  st: CityState;
  inf: InfraFlags;
  sim?: Simulation;
  tAccess?: TrafficApi;
  util?: UtilitiesApi;
  demo: DemographicsCtx;
  /** home access records (occupancy loop); absent for UI queries */
  cache?: DemographicsCache;
}
/** result of condition() (shared scratch) */
interface Cond {
  target: number;
  powered: boolean;
  watered: boolean;
  needWater: boolean;
  road: boolean;
  needsUnmet: boolean;
  /** needs part of the health-target reduction (vacancies; only NEEDS_ABANDON_SHARE of it counts toward abandonment) */
  needsPenalty: number;
}
const COND: Cond = { target: 0, powered: true, watered: true, needWater: false, road: true, needsUnmet: false, needsPenalty: 0 };

/**
 * health target of a growable at cell i (+ the flags it depends on). With `terms` every contribution is listed
 * (conditionBreakdown); the hot occupancy loop passes null.
 */
function condition(c: CondCtx, b: Building, def: BuildingDef, i: number, terms: FactorTerm[] | null): Cond {
  const st = c.st, inf = c.inf;
  const dev = def.devType!;
  const isR = dev <= DevType.R3;
  const powered = buildingPowered(st, b, inf.utilities);
  const needWater = (def.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(st.zone[i]) >= 2;
  const watered = buildingWatered(st, b, inf.utilities);
  const road = frontHasRoad(st, b);
  const des = st.desirability[dev][i];
  let target = 0.5 + 0.5 * des;
  if (terms) terms.push({ id: 'desirability', label: 'Desirability', value: target, detail: `desirability ${des.toFixed(2)}` });
  if (!powered) {
    target -= PENALTY_NO_POWER;
    if (terms) terms.push({ id: 'power', label: 'No power', value: -PENALTY_NO_POWER });
  }
  if (needWater && !watered) {
    target -= PENALTY_NO_WATER;
    if (terms) terms.push({ id: 'water', label: 'No water', value: -PENALTY_NO_WATER, detail: 'this building needs piped water' });
  } else if (isR && inf.utilities && watered) {
    if (!needWater) {
      target += WATER_BONUS_LOW;
      if (terms) terms.push({ id: 'waterBonus', label: 'Piped water', value: WATER_BONUS_LOW });
    }
    if (c.sim && c.util && typeof c.util.waterQualityAt === 'function') {
      const q = c.util.waterQualityAt(c.sim, i);
      if (q < TAP_SAFE) {
        const p = (TAP_PENALTY * (TAP_SAFE - q)) / TAP_SAFE;
        target -= p;
        if (terms) terms.push({ id: 'tapWater', label: 'Unsafe tap water', value: -p, detail: `water quality ${Math.round(q * 100)}%` });
      }
    }
  }
  if (!road) {
    target -= PENALTY_NO_ROAD;
    if (terms) terms.push({ id: 'road', label: 'No road access', value: -PENALTY_NO_ROAD });
  }
  if (b.flags & BF.NoGarbage) {
    target -= PENALTY_NO_GARBAGE;
    if (terms) terms.push({ id: 'garbage', label: 'Garbage not collected', value: -PENALTY_NO_GARBAGE });
  }
  let needsUnmet = false, needsPen = 0;
  if (isR) {
    if (c.tAccess) {
      const a = c.tAccess.workerAccess!(b.id);
      if (a >= 0 && a < JOB_ACCESS_MIN) {
        const p = (JOB_ACCESS_MIN - a) * PENALTY_NO_JOB_ACCESS;
        target -= p;
        if (terms) terms.push({ id: 'jobs', label: "Can't reach jobs", value: -p, detail: `${Math.round(a * 100)}% of workers reach a job` });
      }
    }
    if (c.cache) c.cache.refresh(st, b, i, c.demo.svc, def);
    const nd = evaluateNeeds(st, b, i, def, c.demo, c.cache);
    needsUnmet = nd.unmet;
    needsPen = nd.penalty;
    if (nd.penalty > 0) {
      target -= nd.penalty;
      if (terms) {
        const miss = needsOf(st, b).filter((r) => !r.met && r.kind !== 'jobs' && r.kind !== 'water').map((r) => r.label);
        terms.push({ id: 'needs', label: 'Unmet needs', value: -nd.penalty, detail: miss.length ? miss.join(', ') : undefined });
      }
    }
    const noise = c.cache ? c.cache.noiseOf(b.id) : st.noise[i];
    if (noise > NOISE_SLEEP_START) {
      const p = NOISE_SLEEP * (noise - NOISE_SLEEP_START);
      target -= p;
      if (terms) terms.push({ id: 'noise', label: 'Noise at night', value: -p, detail: `noise ${Math.round(noise * 100)}%` });
    }
  }
  COND.target = target < 0 ? 0 : target > 1 ? 1 : target;
  COND.powered = powered;
  COND.watered = watered;
  COND.needWater = needWater;
  COND.road = road;
  COND.needsUnmet = needsUnmet;
  COND.needsPenalty = needsPen;
  return COND;
}

function condCtx(st: CityState, sim?: Simulation): CondCtx {
  const inf = infraFlags(st);
  const traffic = sim && inf.traffic ? (sim.getSystem('traffic') as unknown as TrafficApi | undefined) : undefined;
  // per-network tap water is only worse than the (demand-weighted) city mean when the mean itself is below 1
  const util = sim && inf.utilities && (st.stats.tapWater ?? 1) < 0.999 ? (sim.getSystem('utilities') as unknown as UtilitiesApi | undefined) : undefined;
  return {
    st, inf, sim,
    tAccess: typeof traffic?.workerAccess === 'function' ? traffic : undefined,
    util: typeof util?.waterQualityAt === 'function' ? util : undefined,
    demo: demographicsCtx(st),
  };
}

/** 3×3 blur (centre 1, neighbours 0.5) of a coarse grid */
function blurCoarse(raw: Float32Array, out: Float32Array, cw: number): void {
  for (let bz = 0; bz < cw; bz++) {
    for (let bx = 0; bx < cw; bx++) {
      let s = 0;
      for (let dz = -1; dz <= 1; dz++) {
        const z = bz + dz;
        if (z < 0 || z >= cw) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx;
          if (x < 0 || x >= cw) continue;
          s += raw[z * cw + x] * (dx === 0 && dz === 0 ? 1 : 0.5);
        }
      }
      out[bz * cw + bx] = s;
    }
  }
}

/** homes update their cohorts / workforce / education every DEMO_UPDATE_DAYS (every 8th occupancy visit: the mix
 *  drifts ~1 % per update at the 12 %/year turnover; newcomers are counted from the population at the last update, a
 *  new home is seeded on its first visit) */
const DEMO_UPDATE_DAYS = 8 * OCC_PERIOD;

/** EMPLOYED_EMA per day compounded over one OCC_PERIOD (the traffic ledger is sampled every OCC_PERIOD days) */
const EMPLOYED_EMA_PERIOD = 1 - Math.pow(1 - EMPLOYED_EMA, OCC_PERIOD);

export function populationSystem(rt: EconRuntime): SimSystem & { rt: EconRuntime } {
  let cursor = 0;
  const burntSince = new Map<number, number>();
  // home access records (demographics.ts): refilled after every services pass and at least monthly
  let cache = new DemographicsCache();
  let unsubLayers: (() => void) | null = null;
  let layersSim: Simulation | null = null;
  // demographics accumulators (per aggregation)
  const coh = new Float64Array(15);
  /** cohort shares per wealth [w * 5 + c] at the last demographics sample */
  const cohShare = new Float64Array(15);
  for (let q = 0; q < 15; q++) cohShare[q] = COHORT_BASE[q % 5];
  let popWRaw: Float32Array[] = [];
  let skillRaw = new Float32Array(0), kidsRaw = new Float32Array(0), skillBlur = new Float32Array(0);

  const aggregate = (sim: Simulation, first: boolean) => {
    const st = sim.state;
    const inf = infraFlags(st);
    const t = rt.totals;
    t.pop[0] = t.pop[1] = t.pop[2] = 0;
    t.resCapAll[0] = t.resCapAll[1] = t.resCapAll[2] = 0;
    t.resCapBuilt[0] = t.resCapBuilt[1] = t.resCapBuilt[2] = 0;
    t.jobs.fill(0); t.jobCapAll.fill(0); t.jobCapBuilt.fill(0); t.countByDev.fill(0);
    t.civicJobCap = t.civicJobs = t.abandoned = t.constructing = 0;
    rt.coarsePopRaw.fill(0); rt.coarseWealthRaw.fill(0); rt.coarseCountRaw.fill(0);
    const cw = rt.cw;
    const cc = cw * cw;
    // employment sample (workforce x traffic access): every OCC_PERIOD days; cohort shares / coarse demographics
    // grids / city mean education: every DEMO_UPDATE_DAYS (the fields change once per update period) — the cohort
    // stats follow the daily population at the sampled shares
    const sample = first || st.day % OCC_PERIOD === 0;
    const demo = first || st.day % DEMO_UPDATE_DAYS === 0;
    if (sample) cache.ensure(st.nextBuildingId);
    const mWf = cache.wf;
    if (demo) {
      if (skillRaw.length !== cc) {
        popWRaw = [new Float32Array(cc), new Float32Array(cc), new Float32Array(cc)];
        skillRaw = new Float32Array(cc); kidsRaw = new Float32Array(cc); skillBlur = new Float32Array(cc);
      } else {
        popWRaw[0].fill(0); popWRaw[1].fill(0); popWRaw[2].fill(0); skillRaw.fill(0); kidsRaw.fill(0);
      }
      coh.fill(0);
    }
    const dd = demographicsData(st);
    const eduFallback = dd.eduMean >= 0 ? dd.eduMean : 0;
    let W = 0, eduSum = 0, eduPop = 0;
    // traffic job access of the workers (assessed / not yet assessed)
    const traffic = inf.traffic ? (sim.getSystem('traffic') as unknown as TrafficApi | undefined) : undefined;
    const tAcc = typeof traffic?.workerAccess === 'function' ? traffic : undefined;
    const accArr = tAcc && traffic!.accessById instanceof Float32Array ? traffic!.accessById : undefined;
    let accE = 0, accW = 0, unW = 0;
    const list = rt.growables;
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      const def = rt.defOf(b);
      if (!def || def.devType === undefined) continue;
      const dev: number = def.devType;
      const blk = (((b.z + (b.d >> 1)) / COARSE) | 0) * cw + (((b.x + (b.w >> 1)) / COARSE) | 0);
      if (b.flags & (BF.Abandoned | BF.Burnt)) { t.abandoned++; continue; }
      t.countByDev[dev]++;
      const constructing = (b.flags & BF.Constructing) !== 0;
      if (constructing) t.constructing++;
      if (dev <= DevType.R3) {
        const p = b.pop;
        t.pop[dev] += p;
        t.resCapAll[dev] += b.capacity;
        if (!constructing) t.resCapBuilt[dev] += b.capacity;
        rt.coarsePopRaw[blk] += p;
        if (p > 0 && sample) {
          const id = b.id;
          const wv = mWf[id];
          const wk = p * (wv === wv ? wv : WORKFORCE_RATIO);
          W += wk;
          if (tAcc) {
            const a = accArr ? (id < accArr.length ? accArr[id] : -1) : tAcc.workerAccess!(id);
            if (a >= 0) { accE += wk * (a < 1 ? a : 1); accW += wk; } else unW += wk;
          }
        }
        if (p > 0 && demo) {
          const k0 = b.kids ?? COHORT_BASE[0], k1 = b.teens ?? COHORT_BASE[1], k2 = b.yad ?? COHORT_BASE[2], k4 = b.srs ?? COHORT_BASE[4];
          const k3 = Math.max(0, 1 - k0 - k1 - k2 - k4);
          const o = dev * 5;
          coh[o] += p * k0; coh[o + 1] += p * k1; coh[o + 2] += p * k2; coh[o + 3] += p * k3; coh[o + 4] += p * k4;
          const e = b.edu;
          if (e !== undefined) { eduSum += p * e; eduPop += p; }
          popWRaw[dev][blk] += p;
          skillRaw[blk] += p * (e ?? eduFallback);
          kidsRaw[blk] += p * k0;
        }
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
    // demographics coarse grids (WP6 desirability terms): residents by wealth, education, kids
    if (demo && rt.coarsePopW[0].length === cc) {
      for (let w = 0; w < 3; w++) blurCoarse(popWRaw[w], rt.coarsePopW[w], cw);
      blurCoarse(kidsRaw, rt.coarseKids, cw);
      blurCoarse(skillRaw, skillBlur, cw);
      for (let q = 0; q < cc; q++) rt.coarseSkill[q] = rt.coarsePop[q] > 0 ? skillBlur[q] / rt.coarsePop[q] : 0;
    }
    // ---- employment (workforce and traffic access are summed every OCC_PERIOD days; in between the workforce follows
    // the population at the last measured ratio)
    const P = t.population;
    // (a loaded save keeps its stored ratio so the days until the next sample match the uninterrupted run)
    if (sample && !(first && dd.wfNow !== undefined)) dd.wfNow = P > 0 ? W / P : WORKFORCE_RATIO;
    else W = P * (dd.wfNow ?? WORKFORCE_RATIO);
    const sd = st.systemData;
    let jobCap = t.civicJobCap;
    for (let d = DevType.CS1; d <= DevType.IHT; d++) jobCap += t.jobCapBuilt[d];
    const connected = st.neighborConnections.length > 0;
    // regional exchange: the region layer (src/region/regionEffects.ts) provides systemData.regionJobs
    const regional = typeof sd.regionJobs === 'number'
      ? Math.max(0, sd.regionJobs as number)
      : Math.min(jobCap * REGION_COMMUTERS_MAX_SHARE, REGION_COMMUTERS_BASE + REGION_COMMUTERS_FRAC * W) * (connected ? 1 : REGION_COMMUTERS_ISOLATED);
    const fillable = Math.min(jobCap, W + regional);
    rt.jobFill = jobCap > 0 ? fillable / jobCap : 0;
    // analytic model: filled local jobs (civic + C/I, some held by regional commuters) + jobs in the region
    let filled = t.civicJobs;
    for (let d = DevType.CS1; d <= DevType.IHT; d++) filled += t.jobs[d];
    const inbound = Math.max(0, Math.min(regional, fillable - W));
    let employed = Math.max(0, Math.min(W, filled - inbound + regional * REGION_JOBS_FOR_RESIDENTS));
    if (tAcc) {
      // traffic ledger: workers matched to a job (local or regional); buildings not assessed yet at the assessed mean
      const mean = accW > 0 ? accE / accW : W > 0 ? employed / W : 1;
      const target = W > 0 ? (accE + unW * mean) / W : 1;
      if (!sample && dd.empRatio < 0) dd.empRatio = W > 0 ? employed / W : 1;
      if (sample) {
        if (dd.empRatio < 0) dd.empRatio = target;
        else if (!first) dd.empRatio += EMPLOYED_EMA_PERIOD * (target - dd.empRatio);
        rt.accessAvg = accW > 0 ? accE / accW : -1;
      }
      employed = W * Math.max(0, dd.empRatio);
    } else {
      dd.empRatio = -1;
      rt.accessAvg = -1;
    }
    rt.employedRatio = W > 0 ? employed / W : 1;
    // ---- demographics
    if (demo && eduPop > 0 && (!first || dd.eduMean < 0)) dd.eduMean = eduSum / eduPop;
    const ratio = P > 0 ? W / P : WORKFORCE_RATIO;
    if (!first) dd.wfRatio += WORKFORCE_EMA * (ratio - dd.wfRatio);
    rt.workforceRatio = Math.max(WORKFORCE_MIN, Math.min(WORKFORCE_MAX, dd.wfRatio));
    // ---- stats
    const s = st.stats;
    s.population = Math.round(P);
    s.residents[0] = Math.round(t.pop[0]); s.residents[1] = Math.round(t.pop[1]); s.residents[2] = Math.round(t.pop[2]);
    for (let d = 0; d < 12; d++) { s.jobsByDev[d] = Math.round(t.jobs[d]); s.jobCapByDev[d] = t.jobCapBuilt[d]; }
    s.workforce = Math.round(W);
    s.employed = Math.round(employed);
    s.unemployment = W > 0 ? Math.max(0, 1 - employed / W) : 0;
    s.workforceRatio = ratio;
    if (demo) {
      // cohort shares per wealth at the sample (reference mix where a wealth class has no residents yet)
      for (let w = 0; w < 3; w++) {
        const pw = coh[w * 5] + coh[w * 5 + 1] + coh[w * 5 + 2] + coh[w * 5 + 3] + coh[w * 5 + 4];
        for (let c = 0; c < 5; c++) cohShare[w * 5 + c] = pw > 0 ? coh[w * 5 + c] / pw : COHORT_BASE[c];
      }
    }
    const sc = s.cohorts, sw = s.cohortsByWealth;
    for (let q = 0; q < 15; q++) sw[q] = Math.round(t.pop[(q / 5) | 0] * cohShare[q]);
    for (let c = 0; c < 5; c++) sc[c] = Math.round(t.pop[0] * cohShare[c] + t.pop[1] * cohShare[5 + c] + t.pop[2] * cohShare[10 + c]);
    s.buildingCount = st.buildings.size;
  };

  const construction = (sim: Simulation) => {
    const list = rt.constructing;
    for (let k = list.length - 1; k >= 0; k--) {
      const b = list[k];
      if (!sim.state.buildings.has(b.id) || !(b.flags & BF.Constructing)) { list[k] = list[list.length - 1]; list.pop(); continue; }
      const stage = rt.defOf(b)?.stage ?? 1;
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
    const ctx = condCtx(st, sim);
    ctx.cache = cache;
    const inf = ctx.inf;
    const list = rt.growables;
    const n = list.length;
    const N = st.size;
    const demand = st.stats.demand;
    const cleanup = ordinanceEffect(st, 'add.rubble.cleanup') > 0;
    const fillK = Math.min(1, FILL_RATE * OCC_PERIOD);
    const jobFill = rt.jobFill;
    const unemp = st.stats.unemployment;
    const traffic = inf.traffic ? (sim.getSystem('traffic') as unknown as TrafficApi | undefined) : undefined;
    const tJobFill = typeof traffic?.jobFill === 'function' ? traffic : undefined;
    const slice = n ? Math.ceil(n / OCC_PERIOD) : 0;
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
      const def = rt.defOf(b);
      if (!def || def.devType === undefined) continue;
      const dev = def.devType;
      const isR = dev <= DevType.R3;
      const i = (b.z + (b.d >> 1)) * N + b.x + (b.w >> 1);
      // ---- conditions
      if (!inf.utilities) b.flags |= BF.Powered | BF.Watered;
      const cd = condition(ctx, b, def, i, null);
      const powered = cd.powered, watered = cd.watered, needWater = cd.needWater, road = cd.road;
      if (road) b.flags &= ~BF.NoRoad; else b.flags |= BF.NoRoad;
      if (isR) { if (cd.needsUnmet) b.flags |= BF.NeedsUnmet; else b.flags &= ~BF.NeedsUnmet; }
      b.health += (cd.target - b.health) * HEALTH_SMOOTH;
      // complaint flags (only when sim-infra doesn't own them)
      if (!inf.pollution) { if (st.airPollution[i] > 0.45 && isR) b.flags |= BF.Polluted; else b.flags &= ~BF.Polluted; }
      if (!inf.services) { if (st.crime[i] > 0.5) b.flags |= BF.Crime; else b.flags &= ~BF.Crime; }
      if (!inf.traffic) { if (isR && unemp > 0.15) b.flags |= BF.NoJobs; else b.flags &= ~BF.NoJobs; }
      // ---- unhappiness / abandonment (no water where it is required now counts too). Unmet needs empty homes
      // (vacancies) but on their own never drive a building to abandonment: only NEEDS_ABANDON_SHARE of the needs
      // penalty counts against the abandonment thresholds
      const dmd = demand[dev];
      const hA = b.health + (1 - NEEDS_ABANDON_SHARE) * cd.needsPenalty;
      const unhappy = hA < UNHAPPY_HEALTH || (dmd < UNHAPPY_DEMAND && hA < UNHAPPY_DEMAND_HEALTH) || !powered || !road
        || (needWater && !watered);
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
        const demandFactor = Math.max(VACANCY_MIN, Math.min(1, 1 + VACANCY_K * Math.min(0, dmd - VACANCY_START)));
        // homes: unhappy buildings have vacancies; businesses run near capacity unless they are doing badly
        let occ = demandFactor * (isR ? 0.6 + 0.4 * b.health : 0.8 + 0.2 * b.health);
        if (!powered) occ *= 0.25;
        if (needWater && !watered) occ *= 0.5;
        if (isR) {
          const goal = b.capacity * occ;
          b.pop = Math.round(b.pop + (goal - b.pop) * fillK);
          if (b.pop === 0 && goal > 0.5) b.pop = 1;
          // demographics every DEMO_UPDATE_DAYS (cohorts drift slowly); a new home is seeded on its first visit
          const id = b.id; // (condition() already made the cache record current)
          const last = cache.lastDay(id);
          if (last < 0 || st.day - last >= DEMO_UPDATE_DAYS - 1 || b.kids === undefined) {
            const dt = last < 0 ? OCC_PERIOD : Math.min(2 * DEMO_UPDATE_DAYS, st.day - last);
            updateDemographics(st, b, def, i, dt, last < 0 ? b.pop : cache.lastPop(id), ctx.demo, cache);
          }
        } else {
          // job slots posted to traffic = capacity × hire (1/256 steps: the field is only rewritten when it changes);
          // filled by the workers who actually arrive
          const hire = cache.setHire(b, occ);
          let jf = jobFill;
          if (tJobFill) { const f = tJobFill.jobFill!(b.id); if (f >= 0) jf = (1 - TRAFFIC_JOBFILL_WEIGHT) * jobFill + TRAFFIC_JOBFILL_WEIGHT * Math.min(1, f); }
          const goal = b.capacity * hire * jf;
          b.jobs = Math.round(b.jobs + (goal - b.jobs) * fillK);
          if (b.jobs === 0 && goal > 0.5) b.jobs = 1;
        }
      }
      if (b.flags !== flags0 || occupied0 !== b.pop + b.jobs > 0) sim.events.emit('buildingChanged', b);
    }
    // civic buildings: staff hired (power / water gated when the def uses them) and filled by the workforce
    for (const b of rt.plopped) {
      if (!inf.utilities && (b.flags & (BF.Powered | BF.Watered)) !== (BF.Powered | BF.Watered)) {
        b.flags |= BF.Powered | BF.Watered;
        sim.events.emit('buildingChanged', b);
      }
      if (b.capacity <= 0) { b.jobs = 0; continue; }
      if (b.flags & (BF.Burnt | BF.Abandoned)) { b.jobs = 0; continue; }
      const def = rt.defOf(b);
      let hire = 1;
      if (inf.utilities && def) {
        if ((def.powerUse ?? 0) > 0 && !buildingPowered(st, b, true)) hire *= 0.25;
        if ((def.waterUse ?? 0) > 0 && !buildingWatered(st, b, true)) hire *= 0.5;
      }
      const h = cache.setHire(b, hire);
      let jf = jobFill;
      if (tJobFill) { const f = tJobFill.jobFill!(b.id); if (f >= 0) jf = (1 - TRAFFIC_JOBFILL_WEIGHT) * jobFill + TRAFFIC_JOBFILL_WEIGHT * Math.min(1, f); }
      b.jobs = Math.round(b.capacity * h * jf);
    }
  };

  return {
    name: 'economy.population',
    rt,
    init(sim) {
      rt.attach(sim);
      bindDemographics(sim);
      cache = new DemographicsCache();
      cache.ensure(sim.state.nextBuildingId);
      for (const b of sim.state.buildings.values()) cache.sync(b);
      if (layersSim !== sim) {
        unsubLayers?.();
        unsubLayers = sim.events.on('layerUpdated', (name) => {
          if (name === 'services') cache.invalidate();
        });
        layersSim = sim;
      }
      cursor = 0;
      burntSince.clear();
      rt.ensureLists();
      aggregate(sim, true);
    },
    daily(sim) {
      const t0 = performance.now();
      rt.ensureLists();
      if (sim.state.day % DAYS_PER_MONTH === 0) cache.invalidate(); // crime / noise drift
      construction(sim);
      occupancy(sim);
      rt.ensureLists();
      aggregate(sim, false);
      if (sim.state.day % DEMOGRAPHICS_EVENT_DAYS === 0) sim.events.emit('layerUpdated', 'demographics');
      rt.timing.population = performance.now() - t0;
    },
    monthly(sim) {
      // EQ / HQ from the residents' education stock and health access (with sim-infra services; approval keeps the
      // legacy coverage lag in sim-core-only runs)
      if (!infraFlags(sim.state).services) return;
      updateEqHq(sim.state, rt.growables, DAYS_PER_MONTH, sim);
    },
  };
}

/**
 * "Why?" breakdown of a building's condition (health target terms, WP5 inspector; SIM_DEPTH_SPEC WP1): the terms sum
 * to the unclamped target; abandonInDays = days until abandonment while the building is unhappy (null otherwise).
 * Plopped / unknown buildings: no terms, target = current health.
 */
export function conditionBreakdown(st: CityState, b: Building): { terms: FactorTerm[]; target: number; abandonInDays: number | null } {
  const def = getDef(b.def);
  if (!def || def.devType === undefined || b.flags & BF.Plopped) return { terms: [], target: b.health, abandonInDays: null };
  const N = st.size;
  const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
  const ctx = condCtx(st, demographicsSim(st));
  const terms: FactorTerm[] = [];
  const cd = condition(ctx, b, def, i, terms);
  const dmd = st.stats.demand[def.devType] ?? 0;
  const hA = b.health + (1 - NEEDS_ABANDON_SHARE) * cd.needsPenalty;
  const unhappy = hA < UNHAPPY_HEALTH || (dmd < UNHAPPY_DEMAND && hA < UNHAPPY_DEMAND_HEALTH) || !cd.powered || !cd.road
    || (cd.needWater && !cd.watered);
  let abandonInDays: number | null = null;
  if (b.flags & BF.Abandoned || b.flags & BF.Historic) abandonInDays = null;
  else if (unhappy) abandonInDays = Math.max(0, ABANDON_DAYS - b.unhappy);
  return { terms, target: cd.target, abandonInDays };
}
