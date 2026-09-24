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
  WORKFORCE_MAX, WORKFORCE_MIN, WORKFORCE_RATIO, COHORT_BASE, NEEDS_ABANDON_SHARE, NEEDS_PENALTY_MAX, NEEDS_UNMET_PEOPLE,
  EQ_FLOOR, EQ_SPAN_STOCK,
} from './tuning';
import { type EconRuntime, type InfraFlags, infraFlags } from './runtime';
import { frontHasRoad, removeBuilding } from './buildings';
import { ordinanceEffect } from './ordinances';
import type { FactorTerm } from '../explain';
import { getDef } from '../catalog';
import {
  type DemographicsCtx, DemographicsCache, REC_NOISE, REC_RAW, REC_UNMET, bindDemographics, demographicsCtx,
  demographicsData, demographicsSim, evaluateNeeds, needsOf, updateDemographics, updateEqHq,
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
  /** home access records (occupancy loop); absent for UI queries (live layers) */
  cache?: DemographicsCache;
}
/**
 * result of condition() (shared scratch): the clamped health target, the flags it depends on and each of its terms
 * (penalties as positive amounts, 0 when absent). conditionBreakdown turns the terms into FactorTerms, so the inspector
 * explains exactly the arithmetic of the occupancy loop.
 */
interface Cond {
  target: number;
  powered: boolean;
  watered: boolean;
  needWater: boolean;
  road: boolean;
  needsUnmet: boolean;
  /** needs part of the health-target reduction (vacancies; only NEEDS_ABANDON_SHARE of it counts toward abandonment) */
  needsPenalty: number;
  /** desirability at the building (target starts at 0.5 + 0.5 × des) */
  des: number;
  noPower: number;
  noWater: number;
  /** + piped water for low-density homes */
  waterBonus: number;
  /** unsafe tap water (per-network quality tapQ) */
  tap: number;
  tapQ: number;
  noRoad: number;
  noGarbage: number;
  /** can't reach jobs (traffic worker access jobAccess; -1 = not assessed) */
  jobs: number;
  jobAccess: number;
  /** noise at night (noise at the home) */
  sleep: number;
  noise: number;
}
const COND: Cond = {
  target: 0, powered: true, watered: true, needWater: false, road: true, needsUnmet: false, needsPenalty: 0, des: 0,
  noPower: 0, noWater: 0, waterBonus: 0, tap: 0, tapQ: 1, noRoad: 0, noGarbage: 0, jobs: 0, jobAccess: -1, sleep: 0, noise: 0,
};

/** health target of a growable at cell i (+ the flags and terms it depends on, see Cond) */
function condition(c: CondCtx, b: Building, def: BuildingDef, i: number): Cond {
  const st = c.st, inf = c.inf, K = COND;
  const dev = def.devType!;
  const isR = dev <= DevType.R3;
  const powered = buildingPowered(st, b, inf.utilities);
  const needWater = (def.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(st.zone[i]) >= 2;
  const watered = buildingWatered(st, b, inf.utilities);
  const road = frontHasRoad(st, b);
  const des = st.desirability[dev][i];
  const noPower = powered ? 0 : PENALTY_NO_POWER;
  let noWater = 0, waterBonus = 0, tap = 0, tapQ = 1;
  if (needWater && !watered) noWater = PENALTY_NO_WATER;
  else if (isR && inf.utilities && watered) {
    if (!needWater) waterBonus = WATER_BONUS_LOW;
    // per-network tap-water quality (WP1-3; a small contaminated network is unsafe even when the city mean is fine)
    if (c.util) {
      tapQ = c.util.waterQualityAt!(c.sim!, i);
      if (tapQ < TAP_SAFE) tap = (TAP_PENALTY * (TAP_SAFE - tapQ)) / TAP_SAFE;
    }
  }
  const noRoad = road ? 0 : PENALTY_NO_ROAD;
  const noGarbage = b.flags & BF.NoGarbage ? PENALTY_NO_GARBAGE : 0;
  let jobs = 0, jobAccess = -1, needsPen = 0, needsUnmet = false, sleep = 0, noise = 0;
  if (isR) {
    if (c.tAccess) {
      jobAccess = c.tAccess.workerAccess!(b.id);
      if (jobAccess >= 0 && jobAccess < JOB_ACCESS_MIN) jobs = (JOB_ACCESS_MIN - jobAccess) * PENALTY_NO_JOB_ACCESS;
    }
    const cache = c.cache;
    if (cache) {
      // the home's access record (refilled after every services pass): needs terms folded with the cohort shares,
      // the NeedsUnmet population threshold and the night noise
      const o = cache.refresh(st, b, i, c.demo.svc, def);
      const f = cache.f;
      if (c.demo.svc) {
        const raw = f[o + REC_RAW];
        needsPen = (raw < NEEDS_PENALTY_MAX ? raw : NEEDS_PENALTY_MAX) * c.demo.expectation;
        needsUnmet = b.pop * f[o + REC_UNMET] >= NEEDS_UNMET_PEOPLE;
      }
      noise = f[o + REC_NOISE];
    } else {
      const nd = evaluateNeeds(st, b, i, def, c.demo);
      needsPen = nd.penalty;
      needsUnmet = nd.unmet;
      noise = st.noise[i];
    }
    if (noise > NOISE_SLEEP_START) sleep = NOISE_SLEEP * (noise - NOISE_SLEEP_START);
  }
  // (same order of operations as the terms list of conditionBreakdown; absent terms subtract an exact 0)
  const target = 0.5 + 0.5 * des - noPower - noWater + waterBonus - tap - noRoad - noGarbage - jobs - needsPen - sleep;
  K.target = target < 0 ? 0 : target > 1 ? 1 : target;
  K.powered = powered; K.watered = watered; K.needWater = needWater; K.road = road;
  K.needsUnmet = needsUnmet; K.needsPenalty = needsPen;
  K.des = des; K.noPower = noPower; K.noWater = noWater; K.waterBonus = waterBonus; K.tap = tap; K.tapQ = tapQ;
  K.noRoad = noRoad; K.noGarbage = noGarbage; K.jobs = jobs; K.jobAccess = jobAccess; K.sleep = sleep; K.noise = noise;
  return K;
}

function condCtx(st: CityState, sim?: Simulation): CondCtx {
  const inf = infraFlags(st);
  const traffic = sim && inf.traffic ? (sim.getSystem('traffic') as unknown as TrafficApi | undefined) : undefined;
  const util = sim && inf.utilities ? (sim.getSystem('utilities') as unknown as UtilitiesApi | undefined) : undefined;
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

/** homes update their cohorts / workforce / education every DEMO_UPDATE_DAYS (every 16th occupancy visit: the mix
 *  drifts ~2 % per update at the 12 %/year turnover, education ~3 % of its gap; newcomers are counted from the
 *  population at the last update, a new home is seeded on its first visit, its second update comes at a per-building
 *  phase within the period) */
const DEMO_UPDATE_DAYS = 16 * OCC_PERIOD;
/** the city-wide cohort / education / coarse-grid sample (aggregate) runs every DEMO_AGG_DAYS */
const DEMO_AGG_DAYS = 8 * OCC_PERIOD;

/** EMPLOYED_EMA per day compounded over one OCC_PERIOD (the traffic ledger is sampled every OCC_PERIOD days) */
const EMPLOYED_EMA_PERIOD = 1 - Math.pow(1 - EMPLOYED_EMA, OCC_PERIOD);

export function populationSystem(rt: EconRuntime): SimSystem & { rt: EconRuntime } {
  let cursor = 0;
  const burntSince = new Map<number, number>();
  const defOf = (b: Building): BuildingDef | undefined => rt.defOf(b);
  // home access records (demographics.ts): refilled after every services pass (monthly without the services system)
  let cache = new DemographicsCache();
  let unsubLayers: (() => void) | null = null;
  /** days left in which occupancy refills today's slice of access records in a pre-pass (after an invalidation) */
  let refillDays = 0;
  const invalidate = () => { cache.invalidate(); refillDays = OCC_PERIOD; };
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
    // grids / city mean education: every DEMO_AGG_DAYS (the fields change slowly) — the cohort stats follow the daily
    // population at the sampled shares
    const sample = first || st.day % OCC_PERIOD === 0;
    const demo = first || st.day % DEMO_AGG_DAYS === 0;
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
      cache.touch(b); // a new growable: every optional WP1 field from its first day (one hidden class)
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
    // after a services pass: refill the access records of today's slice in a tight pre-pass (about half the cost of
    // refilling them one by one inside the visit loop; a home the pre-pass misses is refilled on its visit)
    if (refillDays > 0) {
      refillDays--;
      const svc = ctx.demo.svc;
      let cur = cursor;
      for (let c = 0; c < slice; c++) {
        if (cur >= n) cur = 0;
        const b = list[cur++];
        if (b.flags & (BF.Burnt | BF.Constructing)) continue;
        const def = rt.defOf(b);
        if (!def || def.devType === undefined || def.devType > DevType.R3) continue;
        cache.refresh(st, b, (b.z + (b.d >> 1)) * N + b.x + (b.w >> 1), svc, def);
      }
    }
    for (let c = 0; c < slice; c++) {
      if (cursor >= list.length) cursor = 0;
      const b = list[cursor++];
      if (!st.buildings.has(b.id)) continue;
      b.age += OCC_PERIOD;
      const flags0 = b.flags;
      const occupied0 = b.pop + b.jobs > 0;
      if (b.flags & BF.Burnt) {
        b.pop = 0; b.jobs = 0;
        // rubble has no residents: the needs chip must not outlive the fire
        if (b.flags & BF.NeedsUnmet) { b.flags &= ~BF.NeedsUnmet; sim.events.emit('buildingChanged', b); }
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
      const cd = condition(ctx, b, def, i);
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
          // demographics every DEMO_UPDATE_DAYS (cohorts drift slowly); a new home is seeded on its first visit and then
          // updated at a per-building phase, so a city loaded or generated at once spreads its updates over the period
          const id = b.id; // (condition() already made the cache record current)
          const last = cache.lastDay(id);
          if (last < 0 || st.day >= cache.nextDay(id)) {
            if (last < 0 && b.kids !== undefined) cache.markUpdated(b, st.day); // loaded with its demographics
            else {
              const dt = last < 0 ? OCC_PERIOD : Math.min(2 * DEMO_UPDATE_DAYS, st.day - last);
              updateDemographics(st, b, def, i, dt, last < 0 ? b.pop : cache.lastPop(id), ctx.demo, cache);
            }
            cache.setNextDay(id, st.day + (last < 0 ? Math.floor(hash2(id, 211) * DEMO_UPDATE_DAYS) : DEMO_UPDATE_DAYS - 1));
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
      cache.touch(b);
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
      // a save from before WP1 (no education stock yet): the residents it already has keep the saved EQ's education
      // level instead of the first-settler EDU_NEWCOMER (EQ, CO / I-HT demand and the EQ rewards would otherwise
      // slide toward EQ_FLOOR + EQ_SPAN_STOCK × EDU_NEWCOMER for years)
      const dd0 = demographicsData(sim.state);
      if (dd0.eduMean < 0 && sim.state.stats.population > 0) {
        let wp1 = false; // (a WP1 save from its first days: the init aggregate below takes the homes' own mean)
        for (const b of sim.state.buildings.values()) if (b.edu !== undefined) { wp1 = true; break; }
        if (!wp1) dd0.eduMean = Math.max(0, Math.min(1, (sim.state.stats.eq - EQ_FLOOR) / EQ_SPAN_STOCK));
      }
      cache = new DemographicsCache();
      refillDays = OCC_PERIOD; // every record starts stale
      cache.ensure(sim.state.nextBuildingId);
      for (const b of sim.state.buildings.values()) cache.sync(b);
      if (layersSim !== sim) {
        unsubLayers?.();
        unsubLayers = sim.events.on('layerUpdated', (name) => {
          if (name === 'services') invalidate();
        });
        layersSim = sim;
      }
      cursor = Math.max(0, demographicsData(sim.state).cursor ?? 0); // a loaded city keeps its visiting order
      burntSince.clear();
      rt.ensureLists();
      aggregate(sim, true);
    },
    daily(sim) {
      const t0 = performance.now();
      rt.ensureLists();
      // every services pass refills the access records (15 days); without the services system crime / noise still drift
      if (!infraFlags(sim.state).services && sim.state.day % DAYS_PER_MONTH === 0) invalidate();
      construction(sim);
      occupancy(sim);
      rt.ensureLists();
      aggregate(sim, false);
      demographicsData(sim.state).cursor = cursor;
      if (sim.state.day % DEMOGRAPHICS_EVENT_DAYS === 0) sim.events.emit('layerUpdated', 'demographics');
      rt.timing.population = performance.now() - t0;
    },
    monthly(sim) {
      // EQ / HQ from the residents' education stock and health access (with sim-infra services; approval keeps the
      // legacy coverage lag in sim-core-only runs)
      if (!infraFlags(sim.state).services) return;
      updateEqHq(sim.state, rt.growables, DAYS_PER_MONTH, sim, defOf);
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
  const cd = condition(ctx, b, def, i);
  // terms in the order condition() sums them (they add up to the unclamped target)
  const terms: FactorTerm[] = [{ id: 'desirability', label: 'Desirability', value: 0.5 + 0.5 * cd.des, detail: `desirability ${cd.des.toFixed(2)}` }];
  if (!cd.powered) terms.push({ id: 'power', label: 'No power', value: -cd.noPower });
  if (cd.noWater) terms.push({ id: 'water', label: 'No water', value: -cd.noWater, detail: 'this building needs piped water' });
  if (cd.waterBonus) terms.push({ id: 'waterBonus', label: 'Piped water', value: cd.waterBonus });
  if (cd.tap) terms.push({ id: 'tapWater', label: 'Unsafe tap water', value: -cd.tap, detail: `water quality ${Math.round(cd.tapQ * 100)}%` });
  if (!cd.road) terms.push({ id: 'road', label: 'No road access', value: -cd.noRoad });
  if (cd.noGarbage) terms.push({ id: 'garbage', label: 'Garbage not collected', value: -cd.noGarbage });
  if (cd.jobs) terms.push({ id: 'jobs', label: "Can't reach jobs", value: -cd.jobs, detail: `${Math.round(cd.jobAccess * 100)}% of workers reach a job` });
  if (cd.needsPenalty > 0) {
    const pen = cd.needsPenalty;
    const miss = needsOf(st, b).filter((r) => !r.met && r.kind !== 'jobs' && r.kind !== 'water').map((r) => r.label);
    terms.push({ id: 'needs', label: 'Unmet needs', value: -pen, detail: miss.length ? miss.join(', ') : undefined });
  }
  if (cd.sleep) terms.push({ id: 'noise', label: 'Noise at night', value: -cd.sleep, detail: `noise ${Math.round(cd.noise * 100)}%` });
  const dmd = st.stats.demand[def.devType] ?? 0;
  const hA = b.health + (1 - NEEDS_ABANDON_SHARE) * cd.needsPenalty;
  const unhappy = hA < UNHAPPY_HEALTH || (dmd < UNHAPPY_DEMAND && hA < UNHAPPY_DEMAND_HEALTH) || !cd.powered || !cd.road
    || (cd.needWater && !cd.watered);
  let abandonInDays: number | null = null;
  if (b.flags & BF.Abandoned || b.flags & BF.Historic) abandonInDays = null;
  else if (unhappy) abandonInDays = Math.max(0, ABANDON_DAYS - b.unhappy);
  return { terms, target: cd.target, abandonInDays };
}
