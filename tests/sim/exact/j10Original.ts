// Frozen population.ts, demographics.ts and utilities.ts from 614609f; only import paths and names differ.
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
 * CONDITION (health target, conditionBreakdownOriginal explains it): 0.5 + 0.5 × desirability − no power / no water (when
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
import type { SimSystem, Simulation } from '../../../src/sim/Simulation';
import { BF, type Building, type CityState } from '../../../src/sim/CityState';
import type { BuildingDef } from '../../../src/sim/catalogTypes';
import { hash2, smoothstep } from '../../../src/core/rng';
import { DevType, zoneDensity } from '../../../src/core/types';
import { DAYS_PER_MONTH } from '../../../src/core/constants';
import { ABANDON_DAYS, COARSE, CONSTRUCT_DAYS_BASE, CONSTRUCT_DAYS_PER_STAGE, CONSTRUCT_RAND, DEMOGRAPHICS_EVENT_DAYS, EMPLOYED_EMA, FILL_RATE, HEALTH_SMOOTH, JOB_ACCESS_MIN, NOISE_SLEEP, NOISE_SLEEP_START, OCC_PERIOD, PENALTY_NO_GARBAGE, PENALTY_NO_JOB_ACCESS, PENALTY_NO_POWER, PENALTY_NO_ROAD, PENALTY_NO_WATER, RECOVER_RATE, REGION_COMMUTERS_BASE, REGION_COMMUTERS_FRAC, REGION_COMMUTERS_ISOLATED, REGION_COMMUTERS_MAX_SHARE, REGION_JOBS_FOR_RESIDENTS, RUBBLE_CLEAR_DAYS, TAP_PENALTY, TAP_SAFE, TRAFFIC_JOBFILL_WEIGHT, UNHAPPY_DEMAND, UNHAPPY_DEMAND_HEALTH, UNHAPPY_HEALTH, VACANCY_K, VACANCY_MIN, VACANCY_START, WATER_BONUS_LOW, WATER_REQUIRED_STAGE, WORKFORCE_EMA, WORKFORCE_MAX, WORKFORCE_MIN, WORKFORCE_RATIO, COHORT_BASE, NEEDS_ABANDON_SHARE, NEEDS_PENALTY_MAX, NEEDS_UNMET_PEOPLE, EQ_FLOOR, EQ_SPAN_STOCK, OUTAGE_EXIT_DAYS, RENT_CONDITION_MIN } from '../../../src/sim/economy/tuning';
import { type EconRuntime, type InfraFlags, GROWABLE_SLICES, infraFlags } from '../../../src/sim/economy/runtime';
import { frontHasRoad, removeBuilding } from '../../../src/sim/economy/buildings';
import { ordinanceEffect } from '../../../src/sim/economy/ordinances';
import { conditionDesirability, garbageFade, lotCell } from '../../../src/sim/economy/factors';
import type { FactorTerm } from '../../../src/sim/explain';
import { getDef } from '../../../src/sim/catalog';


/** duck-typed view of sim-infra's TrafficSystem (optional methods; -1 = not assessed yet) */
interface TrafficApi {
  jobFill?: (id: number) => number;
  workerAccess?: (id: number) => number;
  /** residential worker access by building id (-1 = not assessed) — read directly in the daily aggregate */
  accessById?: Float32Array;
}
/** duck-typed view of sim-infra's UtilitiesSystemOriginal (WP3-5 per-network tap-water quality) */
interface UtilitiesApi {
  waterQualityAt?: (sim: Simulation, cell: number) => number;
}

export function constructionDaysOriginal(b: Building, stage: number): number {
  return CONSTRUCT_DAYS_BASE + CONSTRUCT_DAYS_PER_STAGE * stage + Math.floor(hash2(b.id, 17) * CONSTRUCT_RAND);
}

/** true when the building has power (infra flags / layer, or always without the utilities system) */
export function buildingPoweredOriginal(st: CityState, b: Building, hasUtilities: boolean): boolean {
  if (!hasUtilities) return true;
  if (b.flags & BF.Powered) return true;
  return st.powered[b.z * st.size + b.x] === 1 || st.powered[(b.z + b.d - 1) * st.size + b.x + b.w - 1] === 1;
}
export function buildingWateredOriginal(st: CityState, b: Building, hasUtilities: boolean): boolean {
  if (!hasUtilities) return true;
  if (b.flags & BF.Watered) return true;
  return st.watered[b.z * st.size + b.x] === 1 || st.watered[(b.z + b.d - 1) * st.size + b.x + b.w - 1] === 1;
}

// ------------------------------------------------------------------------------------------------ outages
/**
 * systemData.outages (final fixes F7; tuning OUTAGE_EXIT_DAYS): per home in an outage (no power, or no piped water it
 * needs) the first day of the outage and its residents then — keyed by building id, dropped when the outage ends,
 * pruned monthly when the building is gone. The outage penalties ramp in with its age (outageRampOriginal), so residents wait
 * for the repair instead of half of them leaving within ten days; approval weighs outages by the residents a home had
 * when it went dark (approval.ts residentSurvey).
 */
export interface OutageDataOriginal { v: 1; start: Record<string, number>; pop: Record<string, number> }
export function outageDataOriginal(st: CityState): OutageDataOriginal {
  let d = st.systemData.outages as OutageDataOriginal | undefined;
  if (!d || d.v !== 1 || !d.start || !d.pop) {
    d = { v: 1, start: {}, pop: {} };
    st.systemData.outages = d;
  }
  return d;
}
/** days a home has been in its current outage (-1 = none) */
export function outageDaysOriginal(st: CityState, b: Building): number {
  const d = st.systemData.outages as OutageDataOriginal | undefined;
  const s = d?.start?.[b.id];
  return s === undefined ? -1 : Math.max(0, st.day - s);
}
/** 0..1: how far a home's outage penalties have ramped in (smoothstep(0, OUTAGE_EXIT_DAYS, days); 0 = none yet) */
export function outageRampOriginal(st: CityState, b: Building): number {
  const days = outageDaysOriginal(st, b);
  return days < 0 ? 0 : smoothstep(0, OUTAGE_EXIT_DAYS, days);
}

// ------------------------------------------------------------------------------------------------ condition
interface CondCtx {
  st: CityState;
  inf: InfraFlags;
  sim?: Simulation;
  tAccess?: TrafficApi;
  util?: UtilitiesApi;
  demo: DemographicsCtxOriginal;
  /** home access records (occupancy loop); absent for UI queries (live layers) */
  cache?: DemographicsCacheOriginal;
  /** garbage fade 0..1 (penalty for no garbage pickup fades in with the town) */
  gFade: number;
}
/**
 * result of condition() (shared scratch): the clamped health target, the flags it depends on and each of its terms
 * (penalties as positive amounts, 0 when absent). conditionBreakdownOriginal turns the terms into FactorTerms, so the inspector
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
  needsPenaltyOriginal: number;
  /** desirability at the building for its condition (target starts at 0.5 + 0.5 × des): the stored desirability with
   *  its RENT share capped at RENT_CONDITION_MIN (factors.conditionDesirability) */
  des: number;
  /** stored desirability (before the rent cap) */
  desStored: number;
  /** garbage fade 0..1 of the no-pickup penalty (factors.garbageFade) */
  gFade: number;
  noPower: number;
  noWater: number;
  /** homes: how far the outage penalties have ramped in (outageRampOriginal; 1 for businesses and homes without an outage) */
  ramp: number;
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
  target: 0, powered: true, watered: true, needWater: false, road: true, needsUnmet: false, needsPenaltyOriginal: 0, des: 0, desStored: 0, gFade: 0,
  noPower: 0, noWater: 0, ramp: 1, waterBonus: 0, tap: 0, tapQ: 1, noRoad: 0, noGarbage: 0, jobs: 0, jobAccess: -1, sleep: 0, noise: 0,
};

/** health target of a growable at cell i (+ the flags and terms it depends on, see Cond) */
function condition(c: CondCtx, b: Building, def: BuildingDef, i: number): Cond {
  const st = c.st, inf = c.inf, K = COND;
  const dev = def.devType!;
  const isR = dev <= DevType.R3;
  const powered = buildingPoweredOriginal(st, b, inf.utilities);
  const needWater = (def.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(st.zone[i]) >= 2;
  const watered = buildingWateredOriginal(st, b, inf.utilities);
  const road = frontHasRoad(st, b);
  const desStored = st.desirability[dev][i];
  const des = conditionDesirability(st, dev, i, desStored);
  // homes: an outage's penalties ramp in with its age (residents wait for the repair; final fixes F7)
  const ramp = isR && (!powered || (needWater && !watered)) ? outageRampOriginal(st, b) : 1;
  const noPower = powered ? 0 : PENALTY_NO_POWER * ramp;
  let noWater = 0, waterBonus = 0, tap = 0, tapQ = 1;
  if (needWater && !watered) noWater = PENALTY_NO_WATER * ramp;
  else if (isR && inf.utilities && watered) {
    if (!needWater) waterBonus = WATER_BONUS_LOW;
    // per-network tap-water quality (WP1-3; a small contaminated network is unsafe even when the city mean is fine)
    if (c.util) {
      tapQ = c.util.waterQualityAt!(c.sim!, i);
      if (tapQ < TAP_SAFE) tap = (TAP_PENALTY * (TAP_SAFE - tapQ)) / TAP_SAFE;
    }
  }
  const noRoad = road ? 0 : PENALTY_NO_ROAD;
  const gFade = c.gFade;
  const noGarbage = b.flags & BF.NoGarbage ? PENALTY_NO_GARBAGE * gFade : 0;
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
        const raw = f[o + REC_RAWOriginal];
        needsPen = (raw < NEEDS_PENALTY_MAX ? raw : NEEDS_PENALTY_MAX) * c.demo.expectation;
        needsUnmet = b.pop * f[o + REC_UNMETOriginal] >= NEEDS_UNMET_PEOPLE;
      }
      noise = f[o + REC_NOISEOriginal];
    } else {
      const nd = evaluateNeedsOriginal(st, b, i, def, c.demo);
      needsPen = nd.penalty;
      needsUnmet = nd.unmet;
      noise = st.noise[i];
    }
    if (noise > NOISE_SLEEP_START) sleep = NOISE_SLEEP * (noise - NOISE_SLEEP_START);
  }
  // (same order of operations as the terms list of conditionBreakdownOriginal; absent terms subtract an exact 0)
  const target = 0.5 + 0.5 * des - noPower - noWater + waterBonus - tap - noRoad - noGarbage - jobs - needsPen - sleep;
  K.target = target < 0 ? 0 : target > 1 ? 1 : target;
  K.powered = powered; K.watered = watered; K.needWater = needWater; K.road = road;
  K.needsUnmet = needsUnmet; K.needsPenaltyOriginal = needsPen;
  K.des = des; K.desStored = desStored; K.gFade = gFade; K.noPower = noPower; K.noWater = noWater; K.ramp = ramp; K.waterBonus = waterBonus; K.tap = tap; K.tapQ = tapQ;
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
    demo: demographicsCtxOriginal(st),
    gFade: garbageFade(st),
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

/**
 * The last demographics sample (coarse grids desirability reads — residents by wealth, education, kids — and the cohort
 * shares), kept in systemData.popGrids: a loaded city reads the saved game's sample until its next one. Rebuilt at load,
 * its shops / offices read customers up to DEMO_AGG_DAYS fresher than the game it continues (grownCity's save / load
 * divergence doubled); summing the grids daily instead cost +0.6 ms/day on the 256² stress city.
 */
interface PopGrids { v: 1; popW: Float32Array[]; skill: Float32Array; kids: Float32Array; coh: Float64Array }
function savedGrids(st: CityState, cc: number): PopGrids | null {
  const g = st.systemData.popGrids as PopGrids | undefined;
  if (!g || g.v !== 1 || !Array.isArray(g.popW) || g.popW.length !== 3 || g.popW.some((a) => !(a instanceof Float32Array) || a.length !== cc)) return null;
  if (!(g.skill instanceof Float32Array) || g.skill.length !== cc || !(g.kids instanceof Float32Array) || g.kids.length !== cc) return null;
  return g.coh instanceof Float64Array && g.coh.length === 15 ? g : null;
}
function storeGrids(st: CityState, rt: EconRuntime, coh: Float64Array): void {
  const cc = rt.cw * rt.cw;
  const g = savedGrids(st, cc) ?? {
    v: 1, popW: [new Float32Array(cc), new Float32Array(cc), new Float32Array(cc)], skill: new Float32Array(cc), kids: new Float32Array(cc),
    coh: new Float64Array(15),
  };
  for (let w = 0; w < 3; w++) g.popW[w].set(rt.coarsePopW[w]);
  g.skill.set(rt.coarseSkill);
  g.kids.set(rt.coarseKids);
  g.coh.set(coh);
  st.systemData.popGrids = g;
}

/** day of the month of the EQ / HQ update (off the month tick; the commercial core runs on day 20, freight on 15) */
const EQHQ_DAY = 25;

/** EMPLOYED_EMA per day compounded over one OCC_PERIOD (the traffic ledger is sampled every OCC_PERIOD days) */
const EMPLOYED_EMA_PERIOD = 1 - Math.pow(1 - EMPLOYED_EMA, OCC_PERIOD);

export function populationSystemOriginal(rt: EconRuntime): SimSystem & { rt: EconRuntime } {
  let cursor = 0;
  const burntSince = new Map<number, number>();
  const defOf = (b: Building): BuildingDef | undefined => rt.defOf(b);
  /** EQ / HQ's daily slice: the runtime's bucket (when the slicings agree, as they do: both DAYS_PER_MONTH) */
  const sliceOf = EQHQ_SLICESOriginal === GROWABLE_SLICES ? (k: number) => rt.growablesOfSlice(k) : undefined;
  // home access records (demographics.ts): refilled after every services pass (monthly without the services system)
  let cache = new DemographicsCacheOriginal();
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
    // population at the sampled shares. A loaded city takes the saved sample (systemData.popGrids, see PopGrids)
    const sample = first || st.day % OCC_PERIOD === 0;
    const demo = first || st.day % DEMO_AGG_DAYS === 0;
    const saved = first && st.day > 0 && rt.coarsePopW[0].length === cc ? savedGrids(st, cc) : null;
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
    const dd = demographicsDataOriginal(st);
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
    // demographics coarse grids (WP6 desirability terms): residents by wealth, education, kids (a loaded city: the saved
    // sample)
    if (saved) {
      for (let w = 0; w < 3; w++) rt.coarsePopW[w].set(saved.popW[w]);
      rt.coarseKids.set(saved.kids);
      rt.coarseSkill.set(saved.skill);
    } else if (demo && rt.coarsePopW[0].length === cc) {
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
    // regional exchange: the region layer (src/region/regionEffects.ts) provides systemData.regionJobs (sized from the
    // neighbours' connected job surplus); the share cap and the isolation factor apply to it as to the default volume
    // (final fixes F1: the region number used to bypass both)
    const regionVol = typeof sd.regionJobs === 'number' ? Math.max(0, sd.regionJobs as number) : REGION_COMMUTERS_BASE + REGION_COMMUTERS_FRAC * W;
    const regional = Math.min(jobCap * REGION_COMMUTERS_MAX_SHARE, regionVol) * (connected ? 1 : REGION_COMMUTERS_ISOLATED);
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
    if (saved) cohShare.set(saved.coh);
    else if (demo) {
      // cohort shares per wealth at the sample (reference mix where a wealth class has no residents yet)
      for (let w = 0; w < 3; w++) {
        const pw = coh[w * 5] + coh[w * 5 + 1] + coh[w * 5 + 2] + coh[w * 5 + 3] + coh[w * 5 + 4];
        for (let c = 0; c < 5; c++) cohShare[w * 5 + c] = pw > 0 ? coh[w * 5 + c] / pw : COHORT_BASE[c];
      }
      if (rt.coarsePopW[0].length === cc) storeGrids(st, rt, cohShare);
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
      b.built = Math.min(1, b.built + 1 / constructionDaysOriginal(b, stage));
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
    const outages = inf.utilities ? outageDataOriginal(st) : null;
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
        cache.refresh(st, b, lotCell(b, N), svc, def);
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
      // (the lot's front row: a deep-infill lot's centre is a yard cell whose coverage dips during a services pass)
      const i = lotCell(b, N);
      // ---- conditions
      if (!inf.utilities) b.flags |= BF.Powered | BF.Watered;
      const cd = condition(ctx, b, def, i);
      const powered = cd.powered, watered = cd.watered, needWater = cd.needWater, road = cd.road;
      // homes: the current outage's start day (and residents then) — its penalties ramp in from the next visit on
      if (isR && outages) {
        const key = b.id;
        if (!powered || (needWater && !watered)) {
          if (outages.start[key] === undefined) { outages.start[key] = st.day; outages.pop[key] = b.pop; }
        } else if (outages.start[key] !== undefined) { delete outages.start[key]; delete outages.pop[key]; }
      }
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
      const hA = b.health + (1 - NEEDS_ABANDON_SHARE) * cd.needsPenaltyOriginal;
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
        if (isR) {
          // an outage cuts occupancy (× 0.25 dark, × 0.5 dry): a home never fills above the cut, but its residents
          // leave only as the outage ramps in (cd.ramp; OUTAGE_EXIT_DAYS) — identical to one goal without an outage
          let up = occ, down = occ;
          if (!powered) { up *= 0.25; down *= 1 - 0.75 * cd.ramp; }
          if (needWater && !watered) { up *= 0.5; down *= 1 - 0.5 * cd.ramp; }
          const gUp = b.capacity * up, gDown = b.capacity * down;
          const goal = b.pop < gUp ? gUp : b.pop > gDown ? gDown : b.pop;
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
              updateDemographicsOriginal(st, b, def, i, dt, last < 0 ? b.pop : cache.lastPop(id), ctx.demo, cache);
            }
            cache.setNextDay(id, st.day + (last < 0 ? Math.floor(hash2(id, 211) * DEMO_UPDATE_DAYS) : DEMO_UPDATE_DAYS - 1));
          }
        } else {
          if (!powered) occ *= 0.25;
          if (needWater && !watered) occ *= 0.5;
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
      b.age += 1; // plopped buildings age too (one visit per day; QA item 7)
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
        if ((def.powerUse ?? 0) > 0 && !buildingPoweredOriginal(st, b, true)) hire *= 0.25;
        if ((def.waterUse ?? 0) > 0 && !buildingWateredOriginal(st, b, true)) hire *= 0.5;
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
      bindDemographicsOriginal(sim);
      // a save from before WP1 (no education stock yet): the residents it already has keep the saved EQ's education
      // level instead of the first-settler EDU_NEWCOMER (EQ, CO / I-HT demand and the EQ rewards would otherwise
      // slide toward EQ_FLOOR + EQ_SPAN_STOCK × EDU_NEWCOMER for years)
      const dd0 = demographicsDataOriginal(sim.state);
      if (dd0.eduMean < 0 && sim.state.stats.population > 0) {
        let wp1 = false; // (a WP1 save from its first days: the init aggregate below takes the homes' own mean)
        for (const b of sim.state.buildings.values()) if (b.edu !== undefined) { wp1 = true; break; }
        if (!wp1) dd0.eduMean = Math.max(0, Math.min(1, (sim.state.stats.eq - EQ_FLOOR) / EQ_SPAN_STOCK));
      }
      cache = new DemographicsCacheOriginal();
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
      cursor = Math.max(0, demographicsDataOriginal(sim.state).cursor ?? 0); // a loaded city keeps its visiting order
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
      demographicsDataOriginal(sim.state).cursor = cursor;
      if (sim.state.day % DEMOGRAPHICS_EVENT_DAYS === 0) sim.events.emit('layerUpdated', 'demographics');
      // (monthly, off the month tick) outage records of buildings that are gone
      if (sim.state.day % DAYS_PER_MONTH === 7) pruneOutages(sim.state);
      // EQ / HQ from the residents' education stock and health access, once a month (with sim-infra services; approval
      // keeps the legacy coverage lag in sim-core-only runs) — on day EQHQ_DAY of the month, not on the month tick,
      // which already carries every system's monthly work; the homes are read in daily slices (a loop over all homes
      // on one day: ~8 ms at 900k residents; final fixes V5)
      // (today's homes from the runtime's id % 30 bucket, in list order: final fixes SE-3)
      if (infraFlags(sim.state).services) eqHqDailyOriginal(sim.state, rt.growables, EQHQ_DAY, DAYS_PER_MONTH, sim, defOf, sliceOf);
      rt.timing.population = performance.now() - t0;
    },

  };
}

/** drop the outage records of buildings that no longer exist */
function pruneOutages(st: CityState): void {
  const d = st.systemData.outages as OutageDataOriginal | undefined;
  if (!d?.start) return;
  for (const k in d.start) {
    if (st.buildings.has(+k)) continue;
    delete d.start[k];
    delete d.pop[k];
  }
}

/**
 * "Why?" breakdown of a building's condition (health target terms, WP5 inspector; SIM_DEPTH_SPEC WP1): the terms sum
 * to the unclamped target; abandonInDays = days until abandonment while the building is unhappy (null otherwise).
 * Plopped / unknown buildings: no terms, target = current health.
 */
export function conditionBreakdownOriginal(st: CityState, b: Building): { terms: FactorTerm[]; target: number; abandonInDays: number | null } {
  const def = getDef(b.def);
  if (!def || def.devType === undefined || b.flags & BF.Plopped) return { terms: [], target: b.health, abandonInDays: null };
  const N = st.size;
  const i = lotCell(b, N); // (where the occupancy loop evaluates it)
  const ctx = condCtx(st, demographicsSimOriginal(st));
  const cd = condition(ctx, b, def, i);
  // terms in the order condition() sums them (they add up to the unclamped target); desirability in the inspector's
  // points (+39), like the desirability section
  const pts = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))}`;
  const rentCapped = Math.abs(cd.des - cd.desStored) > 1e-6;
  const terms: FactorTerm[] = [{
    id: 'desirability', label: 'Desirability', value: 0.5 + 0.5 * cd.des,
    detail: rentCapped ? `desirability ${pts(cd.desStored)} (rent counts at most ${pts(RENT_CONDITION_MIN)} for tenants already here: ${pts(cd.des)})` : `desirability ${pts(cd.des)}`,
  }];
  // (homes: an outage's penalty ramps in — residents wait for the repair before they leave; final fixes F7)
  const od = outageDaysOriginal(st, b);
  const waitNote = cd.ramp < 1 && od >= 0 ? `out for ${od} day${od === 1 ? '' : 's'}: residents wait for the repair, then leave over ~${OUTAGE_EXIT_DAYS} days` : undefined;
  if (!cd.powered) terms.push({ id: 'power', label: 'No power', value: -cd.noPower, detail: waitNote });
  if (cd.needWater && !cd.watered) terms.push({ id: 'water', label: 'No water', value: -cd.noWater, detail: waitNote ? `this building needs piped water; ${waitNote}` : 'this building needs piped water' });
  if (cd.waterBonus) terms.push({ id: 'waterBonus', label: 'Piped water', value: cd.waterBonus });
  if (cd.tap) terms.push({ id: 'tapWater', label: 'Unsafe tap water', value: -cd.tap, detail: `water quality ${Math.round(cd.tapQ * 100)}%` });
  if (!cd.road) terms.push({ id: 'road', label: 'No road access', value: -cd.noRoad });
  if (cd.noGarbage) terms.push({ id: 'garbage', label: 'Garbage not collected', value: -cd.noGarbage, detail: cd.gFade < 1 ? `counts ${Math.round(cd.gFade * 100)}% (fades in from 2k to 20k residents)` : undefined });
  if (cd.jobs) terms.push({ id: 'jobs', label: "Can't reach jobs", value: -cd.jobs, detail: `${Math.round(cd.jobAccess * 100)}% of workers reach a job` });
  if (cd.needsPenaltyOriginal > 0) {
    const pen = cd.needsPenaltyOriginal;
    const miss = needsOfOriginal(st, b).filter((r) => !r.met && r.kind !== 'jobs' && r.kind !== 'water').map((r) => r.label);
    terms.push({ id: 'needs', label: 'Unmet needs', value: -pen, detail: miss.length ? miss.join(', ') : undefined });
  }
  if (cd.sleep) terms.push({ id: 'noise', label: 'Noise at night', value: -cd.sleep, detail: `noise ${Math.round(cd.noise * 100)}%` });
  // the target is clamped to 0…100 %: the clamp is a term too, so the terms always add up to the target (an abandoned
  // home with every penalty would otherwise list −1 % for a 0 % target)
  let sum = 0;
  for (const t of terms) sum += t.value;
  if (Math.abs(cd.target - sum) > 1e-9) terms.push({ id: 'clamp', label: sum < cd.target ? 'Floored at 0%' : 'Capped at 100%', value: cd.target - sum });
  const dmd = st.stats.demand[def.devType] ?? 0;
  const hA = b.health + (1 - NEEDS_ABANDON_SHARE) * cd.needsPenaltyOriginal;
  const unhappy = hA < UNHAPPY_HEALTH || (dmd < UNHAPPY_DEMAND && hA < UNHAPPY_DEMAND_HEALTH) || !cd.powered || !cd.road
    || (cd.needWater && !cd.watered);
  let abandonInDays: number | null = null;
  if (b.flags & BF.Abandoned || b.flags & BF.Historic) abandonInDays = null;
  else if (unhappy) abandonInDays = Math.max(0, ABANDON_DAYS - b.unhappy);
  return { terms, target: cd.target, abandonInDays };
}

/**
 * Demographics core (SIM_DEPTH_SPEC WP1): who lives in a residential building, what they need, and how that feeds
 * back into the city. Headless: no DOM / three.js.
 *
 * COHORTS (per residential building, stored as Float32 fields b.kids / teens / yad / srs; adults = 1 − the sum):
 *   target t = normalize(HOUSEHOLD_PROFILE[form] ⊙ COHORT_WEALTH_MUL[w] ⊙ LIFE(building age) ⊙ PULL ⊙ VAR)
 *   form     house / apartment / tower (def.household, else HOUSEHOLD_BY_MODEL, else by stage)
 *   LIFE     new suburbs are full of children, 30 years later they are full of seniors (damped for apartments / towers)
 *   PULL     families move where schools / playgrounds are (famScore), students near colleges and transit (studScore),
 *            seniors near clinics, gardens, shops and quiet streets (senScore: noise above QUIET_NOISE pushes them away,
 *            SEN_NOISE; × city HQ). Floor PULL_MIN.
 *   VAR      ±COHORT_VAR per building (deterministic hash of the id).
 *   A new building is seeded with t; afterwards shares move toward t with the turnover rate + the newcomer share.
 * WORKFORCE (b.wf) = adults × PART_ADULT[w] × (.94 + .06 min(1, HQ/100)) + young adults × (.7 working / .25 studying,
 *   study = college coverage × COLLEGE_WILL[w]) + teens × .06 + seniors × .10. Reference mix ≈ 0.55, house ≈ 0.49,
 *   tower ≈ 0.6. traffic uses pop × workerShareOriginal(b) as the building's commuting workers (one source of truth).
 * EDUCATION (b.edu, adults' attainment 0..1) drifts toward EDU_BASE + .35 elementary + .33 high + .20 college coverage at
 *   the home (time constant EDU_TAU_YEARS); newcomers bring the city mean. EQ = EQ_FLOOR + EQ_SPAN_STOCK × pop-avg(edu)
 *   (population system, monthly) — a closed school fades over years, not in one services pass.
 * NEEDS (needsOfOriginal / needsPenaltyOriginal / evaluateNeedsOriginal): per cohort access 0..1 from the WP2 catchment layers (elementary →
 *   kids, high school → teens, college → young adults, clinics / hospitals → seniors, playgrounds → kids + teens, green,
 *   shops, transit for the car-less, quiet for seniors, jobs from traffic, tap water from utilities). Unmet needs lower
 *   the building's health target (capped NEEDS_PENALTY_MAX, scaled by needsExpectationOriginal: a town below NEEDS_POP_START
 *   expects little, a NEEDS_POP_FULL city a school on every street → vacancies; on their own never abandonment,
 *   NEEDS_ABANDON_SHARE) and set BF.NeedsUnmet when children / teens / seniors lack a school / clinic (gap >= 0.5,
 *   >= 3 people; also below NEEDS_POP_START, where it is information only: needsExpectationOriginal(st) === 0).
 * Without the services system (sim-core-only runs) coverage is COVERAGE_FALLBACK everywhere and there is no needs
 * penalty; buildings the demographics update never visited use the reference mix COHORT_BASE (cohortSharesOriginal) so
 * infra-only simulations stay at the calibration mix.
 */




import { Zone } from '../../../src/core/types';



import { CARLESS_EFF, COHORT_VAR, COHORT_WEALTH_MUL, COLLEGE_WILL, COVERAGE_FALLBACK, EDU_BASE, EDU_NEWCOMER, EDU_TAU_YEARS, EDU_W, EQ_SMOOTH_MONTHS, HOUSEHOLD_BY_MODEL, HOUSEHOLD_PROFILE, HQ_AIR, HQ_FLOOR, HQ_LAG_YEARS, HQ_NOISE, HQ_SPAN_ACCESS, HQ_TAP, LIFE_DAMP, NEEDS_POP_FULL, NEEDS_POP_START, NEEDS_UNMET_GAP, NEED_OK, NEED_W, PART_ADULT, PART_SENIOR, PART_TEEN, PART_YAD_STUDY, PART_YAD_WORK, PATIENT_W, PULL_MIN, QUIET_NOISE, QUIET_SPAN, SEN_NOISE, SEN_QUIET, TURNOVER_PER_YEAR } from '../../../src/sim/economy/tuning';

/** 0 kids 0-11, 1 teens 12-17, 2 young adults 18-24, 3 adults 25-64, 4 seniors 65+ */
export type CohortOriginal = 0 | 1 | 2 | 3 | 4;
export const COHORT_LABELSOriginal: readonly string[] = ['Children', 'Teens', 'Young adults', 'Adults', 'Seniors'];
export type HouseholdFormOriginal = 'house' | 'apartment' | 'tower';

// ------------------------------------------------------------------------------------------------ persistent data
/** demographics data persisted in state.systemData.demographics (plain numbers, save / load exact) */
export interface DemographicsDataOriginal {
  v: 1;
  /** population-weighted mean education stock of residents (newcomers bring it) */
  eduMean: number;
  /** smoothed workforce / population ratio (demand, WP4) */
  wfRatio: number;
  /** smoothed traffic-based employment ratio (-1 = not set yet) */
  empRatio: number;
  /** workforce / population at the last OCC_PERIOD aggregation (daily workforce in between) */
  wfNow?: number;
  /** occupancy slice cursor: a loaded city continues the same visiting order (save / load continuity) */
  cursor?: number;
  /** the month's EQ / HQ sums gathered in daily slices (eqHqDailyOriginal; final fixes V5) */
  eqhq?: EqHqAccOriginal;
}
/** EQ / HQ slice sums: m = the month they belong to (eqHqMonth), done = slices done (bit k = slice k), s = EQHQ_S sums */
export interface EqHqAccOriginal { m: number; done: number; s: number[] }
export function demographicsDataOriginal(st: CityState): DemographicsDataOriginal {
  let d = st.systemData.demographics as DemographicsDataOriginal | undefined;
  if (!d || d.v !== 1) {
    d = { v: 1, eduMean: -1, wfRatio: WORKFORCE_RATIO, empRatio: -1 };
    st.systemData.demographics = d;
  }
  return d;
}

/** the simulation driving a state (set by the population system; lets UI queries read traffic / utilities) */
const simOfState = new WeakMap<CityState, Simulation>();
export function bindDemographicsOriginal(sim: Simulation): void {
  simOfState.set(sim.state, sim);
}
export function demographicsSimOriginal(st: CityState): Simulation | undefined {
  const s = simOfState.get(st);
  return s && s.state === st ? s : undefined;
}

// ------------------------------------------------------------------------------------------------ household form
const MODEL_FORM = new Map<string, HouseholdFormOriginal>();
for (const f of ['house', 'apartment', 'tower'] as const) for (const m of HOUSEHOLD_BY_MODEL[f]) MODEL_FORM.set(m, f);
const formCache = new WeakMap<BuildingDef, HouseholdFormOriginal>();

/** household form of a residential def: def.household, else HOUSEHOLD_BY_MODEL, else by stage (<= 3 house, 4-5
 *  apartment, >= 6 tower), else by zone density */
export function householdFormOriginal(def?: BuildingDef, zone?: Zone): HouseholdFormOriginal {
  if (def) {
    const c = formCache.get(def);
    if (c) return c;
    let f: HouseholdFormOriginal | undefined = def.household;
    if (!f && def.model) f = MODEL_FORM.get(def.model.startsWith('res_') ? def.model.slice(4) : def.model);
    if (!f && def.stage !== undefined) f = def.stage <= 3 ? 'house' : def.stage <= 5 ? 'apartment' : 'tower';
    if (f) { formCache.set(def, f); return f; }
  }
  const d = zone !== undefined ? zoneDensity(zone) : 1;
  return d >= 3 ? 'tower' : d === 2 ? 'apartment' : 'house';
}

function wealthIdx(w: number): number {
  return w >= 3 ? 2 : w <= 1 ? 0 : 1;
}

/** normalised cohort shares [5] of a household form and wealth 1..3 (profile × wealth; used by WP6 for empty lots) */
export function profileSharesOriginal(form: HouseholdFormOriginal, wealth: number, out: Float32Array = new Float32Array(5)): Float32Array {
  const P = HOUSEHOLD_PROFILE[form] ?? HOUSEHOLD_PROFILE.apartment;
  const M = COHORT_WEALTH_MUL[wealthIdx(wealth)];
  let s = 0;
  for (let c = 0; c < 5; c++) s += P[c] * M[c];
  for (let c = 0; c < 5; c++) out[c] = (P[c] * M[c]) / s;
  return out;
}

/** cohort shares [5] of a building: its fields when set, else the reference mix COHORT_BASE (never visited by the
 *  demographics update: infra-only simulations, the first days after loading an old save) */
export function cohortSharesOriginal(b: Building, out: Float32Array = new Float32Array(5)): Float32Array {
  if (b.kids !== undefined && b.teens !== undefined && b.yad !== undefined && b.srs !== undefined) {
    out[0] = b.kids; out[1] = b.teens; out[2] = b.yad; out[4] = b.srs;
    out[3] = Math.max(0, 1 - b.kids - b.teens - b.yad - b.srs);
    return out;
  }
  for (let c = 0; c < 5; c++) out[c] = COHORT_BASE[c];
  return out;
}

/** workforce share of a building's residents (b.wf ?? WORKFORCE_RATIO) — traffic's commuting workers = pop × this */
export function workerShareOriginal(b: Building): number {
  return b.wf ?? WORKFORCE_RATIO;
}

/** WP1-4: share of residents without a car (poorer, young adults and seniors); WP7 charges them extra on car trips */
export function carlessShareOriginal(b: Building): number {
  return carlessOf(b.wealth, b.yad ?? COHORT_BASE[2], b.srs ?? COHORT_BASE[4]);
}
function carlessOf(wealth: number, yad: number, srs: number): number {
  const w = Math.max(1, Math.min(3, wealth || 1));
  return CARLESS_EFF[w - 1] * (0.5 + yad + srs);
}

/**
 * Give a building every optional WP1 field (undefined until written) in one fixed order. V8 gives objects one hidden
 * class per property set and order: if WP1 added kids..edu to homes and hire to businesses as it first writes them,
 * every creation site would split into three classes and every loop over buildings (all systems) would turn
 * polymorphic / megamorphic (on the 256² stress city that cost the population system alone 0.2-0.4 ms/day). A
 * self-assignment adds a missing field (value undefined: "derive from the profile") and is a no-op for present ones.
 */
export function ensureDemographicsFieldsOriginal(b: Building): void {
  b.kids = b.kids; b.teens = b.teens; b.yad = b.yad; b.srs = b.srs; b.wf = b.wf; b.edu = b.edu; b.hire = b.hire;
}

/** true when the building needs piped water (growables at stage >= WATER_REQUIRED_STAGE or zone density >= 2;
 *  plopped buildings with def.waterUse > 0) */
export function waterRequiredOriginal(st: CityState, b: Building): boolean {
  const def = getDef(b.def);
  if (!def) return false;
  if (def.category !== 'growable') return (def.waterUse ?? 0) > 0;
  const N = st.size;
  const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
  return (def.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(st.zone[i] as Zone) >= 2;
}

// ------------------------------------------------------------------------------------------------ local appeal
/** true when sim-infra's services system writes the coverage layers (else COVERAGE_FALLBACK everywhere) */
function servicesOn(st: CityState): boolean {
  if (st.systemData.infraVersion === undefined) return false;
  const l = st.systemData.infraLayers as { services?: boolean } | undefined;
  return l?.services ?? true;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smoothstepDemographicsOriginal(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** coverage / access values at a cell (scratch; COVERAGE_FALLBACK without the services system) */
interface Access { elem: number; high: number; college: number; health: number; play: number; green: number; shop: number; transit: number; crime: number; noise: number }
const ACC: Access = { elem: 0, high: 0, college: 0, health: 0, play: 0, green: 0, shop: 0, transit: 0, crime: 0, noise: 0 };
function accessAt(st: CityState, i: number, svc: boolean, out: Access = ACC): Access {
  if (svc) {
    out.elem = st.eduElemCov[i]; out.high = st.eduHighCov[i]; out.college = st.eduCollegeCov[i]; out.health = st.healthCov[i];
    out.play = st.playCov[i]; out.green = st.greenCov[i]; out.shop = st.shopAccess[i]; out.transit = st.transitCov[i];
  } else {
    const f = COVERAGE_FALLBACK;
    out.elem = out.high = out.college = out.health = out.play = out.green = out.shop = out.transit = f;
  }
  out.crime = st.crime[i];
  out.noise = st.noise[i];
  return out;
}
function famScore(a: Access): number {
  return clamp01(0.45 * a.elem + 0.2 * a.high + 0.2 * a.play + 0.15 * (1 - a.crime) - 0.1 * Math.max(0, a.noise - 0.3));
}
function studScore(a: Access): number {
  return clamp01(0.6 * a.college + 0.2 * a.transit + 0.2 * a.shop);
}
function senScore(a: Access): number {
  return clamp01(0.45 * a.health + 0.2 * a.green + 0.2 * a.shop + SEN_QUIET - SEN_NOISE * quietGap(a.noise));
}

/** appeal 0..1 of cell i for families (schools, playgrounds, safety, quiet) — WP5 overlay variant, WP6 */
export function familyScoreAtOriginal(st: CityState, i: number): number {
  return famScore(accessAt(st, i, servicesOn(st)));
}
/** appeal 0..1 of cell i for seniors (clinics / hospitals, gardens, shops, quiet: SEN_QUIET − SEN_NOISE × quiet gap) */
export function seniorScoreAtOriginal(st: CityState, i: number): number {
  return senScore(accessAt(st, i, servicesOn(st)));
}
/** appeal 0..1 of cell i for students / young adults (college, transit, shops) */
export function studentScoreAtOriginal(st: CityState, i: number): number {
  return studScore(accessAt(st, i, servicesOn(st)));
}

// ------------------------------------------------------------------------------------------------ needs
export type NeedKindOriginal = 'elementary' | 'high' | 'college' | 'health' | 'play' | 'green' | 'shops' | 'jobs' | 'transit' | 'quiet' | 'water';
export interface NeedReportOriginal {
  /** cohort with the need, -1 = whole household */
  cohort: CohortOriginal | -1;
  kind: NeedKindOriginal;
  /** e.g. "Elementary school", "Unsafe tap water" */
  label: string;
  /** people with this need in the building */
  people: number;
  /** access 0..1 */
  access: number;
  met: boolean;
  /** serving facility (building id), when known */
  providerId?: number;
}

const PLAY_TEEN = 0.7;
const REF_PLAY = COHORT_BASE[0] + PLAY_TEEN * COHORT_BASE[1];
const REF_GREEN = 0.8 + 1.2 * COHORT_BASE[4];
const REF_CARLESS = COHORT_BASE[2] + COHORT_BASE[4];

// (reciprocals: the access records are refilled for every home after each services pass, divisions dominated them)
const INV_NEED_OK = 1 / NEED_OK;
const INV_QUIET_SPAN = 1 / QUIET_SPAN;
function gap(a: number): number {
  return a >= NEED_OK ? 0 : (NEED_OK - a) * INV_NEED_OK;
}
function quietGap(noise: number): number {
  return clamp01((noise - QUIET_NOISE) * INV_QUIET_SPAN);
}

/** how much residents expect their needs to be met 0..1 (grows with the city: smoothstepDemographicsOriginal over population) */
export function needsExpectationOriginal(st: CityState): number {
  return smoothstepDemographicsOriginal(NEEDS_POP_START, NEEDS_POP_FULL, st.stats.population);
}

/**
 * per-day context of the demographics hot paths (population occupancy reads it once per day; the public functions
 * build a scratch one per call)
 */
export interface DemographicsCtxOriginal {
  /** services system writes the coverage layers */
  svc: boolean;
  /** needsExpectationOriginal */
  expectation: number;
  /** city mean education (newcomers) */
  eduMean: number;
  /** HQ terms: senior pull factor, adult participation factor */
  hqPull: number;
  hqPart: number;
}
export function demographicsCtxOriginal(st: CityState, out: DemographicsCtxOriginal = { svc: false, expectation: 0, eduMean: 0, hqPull: 1, hqPart: 1 }): DemographicsCtxOriginal {
  const hq = Math.max(0, st.stats.hq);
  const d = demographicsDataOriginal(st);
  out.svc = servicesOn(st);
  out.expectation = needsExpectationOriginal(st);
  out.eduMean = d.eduMean >= 0 ? d.eduMean : EDU_NEWCOMER;
  out.hqPull = 0.85 + 0.3 * Math.min(1, hq / 150);
  out.hqPart = 0.94 + 0.06 * Math.min(1, hq / 100);
  return out;
}
const CTX_TMP: DemographicsCtxOriginal = { svc: false, expectation: 0, eduMean: 0, hqPull: 1, hqPart: 1 };

/** per-def constants of the cohort model (profile × wealth, life-cycle damping, wealth index) */
interface DefDemo { pm: Float64Array; damp: number; wi: number }
const defDemo = new Map<BuildingDef, DefDemo>();
function demoOf(def: BuildingDef): DefDemo {
  let d = defDemo.get(def);
  if (!d) {
    const wi = wealthIdx((def.devType ?? DevType.R2) + 1);
    const form = householdFormOriginal(def);
    const P = HOUSEHOLD_PROFILE[form], M = COHORT_WEALTH_MUL[wi];
    const pm = new Float64Array(5);
    for (let c = 0; c < 5; c++) pm[c] = P[c] * M[c];
    d = { pm, damp: LIFE_DAMP[form], wi };
    defDemo.set(def, d);
  }
  return d;
}

// ------------------------------------------------------------------------------------------------ access cache
/**
 * Access record of a home at its cell: the need gaps and amenity scores derived from the ~11 coverage / crime / noise
 * layers. The public functions compute it on the fly; the population system keeps them in a DemographicsCacheOriginal (one
 * record per building id) that is refilled after every services pass and monthly instead of re-reading the layers on
 * every occupancy visit.
 */
interface AccessRec {
  gE: number; gH: number; gC: number; gS: number; gP: number; gG: number; gSh: number; gT: number; gQ: number;
  fam: number; stud: number; sen: number; eduT: number; col: number; noise: number;
}
const REC: AccessRec = { gE: 0, gH: 0, gC: 0, gS: 0, gP: 0, gG: 0, gSh: 0, gT: 0, gQ: 0, fam: 0, stud: 0, sen: 0, eduT: 0, col: 0, noise: 0 };
function accessRecord(st: CityState, i: number, svc: boolean, r: AccessRec = REC): AccessRec {
  const a = accessAt(st, i, svc);
  r.gE = gap(a.elem); r.gH = gap(a.high); r.gC = gap(a.college); r.gS = gap(a.health);
  r.gP = gap(a.play); r.gG = gap(a.green); r.gSh = gap(a.shop); r.gT = gap(a.transit); r.gQ = quietGap(a.noise);
  r.fam = famScore(a); r.stud = studScore(a); r.sen = senScore(a);
  r.eduT = clamp01(EDU_BASE + EDU_W[0] * a.elem + EDU_W[1] * a.high + EDU_W[2] * a.college);
  r.col = clamp01(a.college);
  r.noise = a.noise;
  return r;
}
/** raw needs penalty of a record for wealth index w and cohort shares */
function needsRaw(r: AccessRec, w: number, k0: number, k1: number, k2: number, k4: number): number {
  return NW_ELEM[w] * k0 * r.gE + NW_HIGH[w] * k1 * r.gH + NW_COLL[w] * k2 * r.gC + NW_HEALTH[w] * k4 * r.gS
    + NW_PLAY[w] * (k0 + PLAY_TEEN * k1) * r.gP + NW_GREEN[w] * (0.8 + 1.2 * k4) * r.gG + NW_SHOPS[w] * r.gSh
    + NW_TRANSIT[w] * (k2 + k4) * r.gT + NW_QUIET[w] * k4 * r.gQ;
}
/** largest cohort share among the kids / teens / seniors needs with a gap >= NEEDS_UNMET_GAP (0 = none): BF.NeedsUnmet
 *  when pop × this >= NEEDS_UNMET_PEOPLE */
function unmetShare(r: AccessRec, k0: number, k1: number, k4: number): number {
  let m = 0;
  if (r.gE >= NEEDS_UNMET_GAP && k0 > m) m = k0;
  if (r.gH >= NEEDS_UNMET_GAP && k1 > m) m = k1;
  if (r.gS >= NEEDS_UNMET_GAP && k4 > m) m = k4;
  return m;
}

/** DemographicsCacheOriginal record layout (16 × 32 bit per building id = one 64-byte cache line) */
const C_STRIDE = 16;
const C_VER = 0, C_RAW = 1, C_UNMET = 2, C_NOISE = 3, C_LASTDAY = 4, C_LASTPOP = 5, C_HIRE = 6, C_FAM = 7, C_STUD = 8,
  C_SEN = 9, C_EDUT = 10, C_COL = 11, C_SEEN = 12, C_NEXT = 13;
/** record fields the population system reads after DemographicsCacheOriginal.refresh (offset + REC_*): the raw needs penalty
 *  (folded with the cohort shares; × needsExpectationOriginal, capped), the unmet-needs share (BF.NeedsUnmet when
 *  pop × share >= NEEDS_UNMET_PEOPLE) and the night noise at the home */
export const REC_RAWOriginal = C_RAW, REC_UNMETOriginal = C_UNMET, REC_NOISEOriginal = C_NOISE;

/**
 * Per-simulation cache of the population system (never saved; rebuilt lazily):
 *  - one record per building id: needs penalty terms folded with the cohort shares at fill time, NeedsUnmet population
 *    threshold, night noise, amenity scores / education target / college coverage for the cohort targets — refilled
 *    after every services pass (invalidate; monthly without the services system: crime / noise drift), so the ~11
 *    coverage layers are read about once per fortnight per home instead of on every occupancy visit;
 *  - last demographics update day / population (update cadence, newcomer share) and the last written b.hire (the
 *    building's property store is only touched when the hiring factor changes);
 *  - a seen marker: the first time the population system meets a building it gets every optional WP1 field
 *    (ensureDemographicsFieldsOriginal: one hidden class per creation site);
 *  - wf: compact mirror of b.wf by id for the employment sampling (NaN = not set).
 */
export class DemographicsCacheOriginal {
  version = 1;
  f = new Float32Array(0);
  i32 = new Int32Array(this.f.buffer);
  wf = new Float32Array(0);

  /** the coverage layers changed: every access record is refilled on its next use */
  invalidate(): void {
    this.version++;
  }
  ensure(id: number): void {
    const n0 = this.wf.length;
    if (id < n0) return;
    const n = Math.max(id + 1, n0 * 2, 1024);
    const f = new Float32Array(n * C_STRIDE);
    f.set(this.f);
    const i32 = new Int32Array(f.buffer);
    for (let k = n0; k < n; k++) { const o = k * C_STRIDE; i32[o + C_VER] = 0; i32[o + C_LASTDAY] = -1; f[o + C_HIRE] = NaN; }
    this.f = f;
    this.i32 = i32;
    const w = new Float32Array(n).fill(NaN);
    w.set(this.wf);
    this.wf = w;
  }
  /** seed the per-building bookkeeping from a (loaded) building and give it every optional WP1 field */
  sync(b: Building): void {
    this.ensure(b.id);
    const o = b.id * C_STRIDE;
    ensureDemographicsFieldsOriginal(b);
    this.i32[o + C_SEEN] = 1;
    this.f[o + C_LASTPOP] = b.pop;
    this.f[o + C_HIRE] = b.hire ?? NaN;
    this.wf[b.id] = b.wf ?? NaN;
  }
  /** first sight of a building (new since the cache was built): sync it; a no-op afterwards */
  touch(b: Building): void {
    const id = b.id;
    if (id >= this.wf.length || this.i32[id * C_STRIDE + C_SEEN] === 0) this.sync(b);
  }
  /** make building b's access record current (cell i; def: wealth for the needs weights); returns the record offset */
  refresh(st: CityState, b: Building, i: number, svc: boolean, def: BuildingDef): number {
    const id = b.id;
    this.ensure(id);
    const o = id * C_STRIDE;
    if (this.i32[o + C_VER] === this.version) return o;
    const r = accessRecord(st, i, svc);
    const w = def.devType ?? DevType.R2;
    const wi = w < 0 ? 0 : w > 2 ? 2 : w;
    const k0 = b.kids ?? COHORT_BASE[0], k1 = b.teens ?? COHORT_BASE[1], k2 = b.yad ?? COHORT_BASE[2], k4 = b.srs ?? COHORT_BASE[4];
    const f = this.f;
    f[o + C_RAW] = needsRaw(r, wi, k0, k1, k2, k4);
    f[o + C_UNMET] = unmetShare(r, k0, k1, k4);
    f[o + C_NOISE] = r.noise;
    f[o + C_FAM] = r.fam; f[o + C_STUD] = r.stud; f[o + C_SEN] = r.sen; f[o + C_EDUT] = r.eduT; f[o + C_COL] = r.col;
    this.i32[o + C_VER] = this.version;
    return o;
  }
  /** last demographics update day (-1 = none since this cache was built), the population then, and the day the next
   *  update is due (population system schedule) */
  lastDay(id: number): number {
    return id < this.wf.length ? this.i32[id * C_STRIDE + C_LASTDAY] : -1;
  }
  lastPop(id: number): number {
    return this.f[id * C_STRIDE + C_LASTPOP];
  }
  nextDay(id: number): number {
    return this.i32[id * C_STRIDE + C_NEXT];
  }
  /** a home that already carries its demographics (loaded save): start the update bookkeeping without an update */
  markUpdated(b: Building, day: number): void {
    this.touch(b);
    const o = b.id * C_STRIDE;
    this.i32[o + C_LASTDAY] = day;
    this.f[o + C_LASTPOP] = b.pop;
    this.wf[b.id] = b.wf ?? NaN;
  }
  setNextDay(id: number, day: number): void {
    this.ensure(id);
    this.i32[id * C_STRIDE + C_NEXT] = day;
  }
  /** write b.hire (1/256 steps) only when it changed; returns the hiring factor */
  setHire(b: Building, occ: number): number {
    const q = Math.fround(Math.round(Math.max(0, Math.min(1, occ)) * 256) / 256);
    const id = b.id;
    this.ensure(id);
    const o = id * C_STRIDE;
    if (this.f[o + C_HIRE] !== q) {
      if (this.i32[o + C_SEEN] === 0) this.sync(b); // first WP1 write: every optional field first (one hidden class)
      b.hire = q;
      this.f[o + C_HIRE] = q;
    }
    return q;
  }
}

/** result of evaluateNeedsOriginal (shared scratch — copy what you keep) */
export interface NeedsEvalOriginal {
  /** health-target penalty 0..NEEDS_PENALTY_MAX (capped raw × needsExpectationOriginal) */
  penalty: number;
  /** uncapped sum of the need terms (before the city-size expectation) */
  raw: number;
  /** BF.NeedsUnmet condition: kids / teens / seniors lack a school / clinic (gap >= 0.5, >= 3 people) */
  unmet: boolean;
}
const EVAL: NeedsEvalOriginal = { penalty: 0, raw: 0, unmet: false };
const SH = new Float32Array(5);

/**
 * needs penalty + NeedsUnmet condition of a residential building at cell i (0 / false without the services system or
 * for non-residential buildings). Returns a shared scratch object. ctx: the population system's per-day context.
 */
export function evaluateNeedsOriginal(st: CityState, b: Building, i: number, def: BuildingDef | undefined = getDef(b.def), ctx?: DemographicsCtxOriginal, cache?: DemographicsCacheOriginal): NeedsEvalOriginal {
  EVAL.penalty = 0; EVAL.raw = 0; EVAL.unmet = false;
  if (!def || def.devType === undefined || def.devType > DevType.R3) return EVAL;
  const c = ctx ?? demographicsCtxOriginal(st, CTX_TMP);
  if (!c.svc) return EVAL;
  let raw: number, share: number;
  if (cache) {
    // cached: needs terms folded with the cohort shares at fill time (refilled after every services pass and after
    // the home's own demographics update)
    const o = cache.refresh(st, b, i, true, def);
    raw = cache.f[o + C_RAW];
    share = cache.f[o + C_UNMET];
  } else {
    const r = accessRecord(st, i, true);
    const k0 = b.kids ?? COHORT_BASE[0], k1 = b.teens ?? COHORT_BASE[1], k2 = b.yad ?? COHORT_BASE[2], k4 = b.srs ?? COHORT_BASE[4];
    raw = needsRaw(r, def.devType, k0, k1, k2, k4);
    share = unmetShare(r, k0, k1, k4);
  }
  EVAL.raw = raw;
  EVAL.penalty = (raw < NEEDS_PENALTY_MAX ? raw : NEEDS_PENALTY_MAX) * c.expectation;
  EVAL.unmet = b.pop * share >= NEEDS_UNMET_PEOPLE;
  return EVAL;
}
/** NEED_W folded with the reference-share normalisation (weight / reference share of the cohort) */
const NW_ELEM = NEED_W.elementary.map((v) => v / COHORT_BASE[0]);
const NW_HIGH = NEED_W.high.map((v) => v / COHORT_BASE[1]);
const NW_COLL = NEED_W.college.map((v) => v / COHORT_BASE[2]);
const NW_HEALTH = NEED_W.health.map((v) => v / COHORT_BASE[4]);
const NW_PLAY = NEED_W.play.map((v) => v / REF_PLAY);
const NW_GREEN = NEED_W.green.map((v) => v / REF_GREEN);
const NW_SHOPS = NEED_W.shops;
const NW_TRANSIT = NEED_W.transit.map((v) => v / REF_CARLESS);
const NW_QUIET = NEED_W.quiet.map((v) => v / COHORT_BASE[4]);

/** health-target penalty 0..NEEDS_PENALTY_MAX from unmet cohort needs at cell i */
export function needsPenaltyOriginal(st: CityState, b: Building, i: number): number {
  return evaluateNeedsOriginal(st, b, i).penalty;
}

/** duck-typed optional infra queries */
interface TrafficQ { workerAccess?: (id: number) => number }
interface UtilitiesQ { waterQualityAt?: (sim: Simulation, cell: number) => number }

/** tap-water quality 0..1 at a cell (utilities per-network quality, else stats.tapWater) */
export function tapWaterAtOriginal(sim: Simulation | undefined, st: CityState, cell: number): number {
  const u = sim?.getSystem('utilities') as unknown as UtilitiesQ | undefined;
  if (sim && u && typeof u.waterQualityAt === 'function') return u.waterQualityAt(sim, cell);
  return st.stats.tapWater ?? 1;
}

function buildingHasWater(st: CityState, b: Building): boolean {
  if (st.systemData.infraVersion === undefined) return true;
  const l = st.systemData.infraLayers as { utilities?: boolean } | undefined;
  if (!(l?.utilities ?? true)) return true;
  if (b.flags & BF.Watered) return true;
  return st.watered[b.z * st.size + b.x] === 1 || st.watered[(b.z + b.d - 1) * st.size + b.x + b.w - 1] === 1;
}

/**
 * needs of a residential building (WP5 inspector): every need with its cohort, people, access and met flag.
 * [] for non-residential buildings and without the services system (coverage unknown).
 */
export function needsOfOriginal(st: CityState, b: Building): NeedReportOriginal[] {
  const def = getDef(b.def);
  if (!def || def.devType === undefined || def.devType > DevType.R3 || !servicesOn(st)) return [];
  const N = st.size;
  const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
  const w = def.devType;
  const s = cohortSharesOriginal(b, new Float32Array(5));
  const a = accessAt(st, i, true, { ...ACC });
  const p = b.pop;
  const out: NeedReportOriginal[] = [];
  const add = (cohort: CohortOriginal | -1, kind: NeedKindOriginal, label: string, people: number, access: number, met = access >= NEED_OK) => {
    if (people < 0.5) return;
    out.push({ cohort, kind, label, people: Math.round(people), access: clamp01(access), met });
  };
  add(0, 'elementary', 'Elementary school', p * s[0], a.elem);
  add(1, 'high', 'High school', p * s[1], a.high);
  add(2, 'college', 'College / library', p * s[2] * COLLEGE_WILL[w], a.college);
  add(4, 'health', 'Clinic / hospital', p * s[4], a.health);
  add(0, 'play', 'Playground / sports', p * (s[0] + s[1]), a.play);
  add(-1, 'green', 'Parks & gardens', p, a.green);
  add(-1, 'shops', 'Shops within reach', p, a.shop);
  const carless = p * carlessOf(b.wealth, s[2], s[4]);
  add(-1, 'transit', 'Transit (car-less residents)', carless, a.transit);
  const qg = quietGap(a.noise);
  add(4, 'quiet', qg > 0 ? 'Quiet streets (too noisy)' : 'Quiet streets', p * s[4], 1 - qg, qg < NEEDS_UNMET_GAP);
  const sim = demographicsSimOriginal(st);
  const tr = sim?.getSystem('traffic') as unknown as TrafficQ | undefined;
  if (tr && typeof tr.workerAccess === 'function') {
    const acc = tr.workerAccess(b.id);
    if (acc >= 0) add(3, 'jobs', 'Jobs within commute', p * workerShareOriginal(b), acc, acc >= 0.9);
  }
  const needWater = waterRequiredOriginal(st, b);
  const watered = buildingHasWater(st, b);
  if (!watered && needWater) add(-1, 'water', 'No water supply', p, 0, false);
  else if (watered && st.systemData.infraVersion !== undefined) {
    const q = tapWaterAtOriginal(sim, st, i);
    add(-1, 'water', q < TAP_SAFE ? 'Unsafe tap water' : 'Tap water', p, q, q >= TAP_SAFE);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ per-building update
const INV_EDU_TAU_DAYS = 1 / (360 * EDU_TAU_YEARS);
const T = new Float32Array(5);
const LIFE = new Float32Array(5);

/** life-cycle multipliers [5] of a household form at building age A (years), damped per form */
export function lifeCycleOriginal(form: HouseholdFormOriginal, ageYears: number, out: Float32Array = new Float32Array(5)): Float32Array {
  return lifeInto(LIFE_DAMP[form], ageYears, out);
}
/** smoothstepDemographicsOriginal(a, a + 1 / inv, x) with a precomputed reciprocal span */
function ssInv(a: number, inv: number, x: number): number {
  const t = clamp01((x - a) * inv);
  return t * t * (3 - 2 * t);
}
function lifeInto(damp: number, A: number, out: Float32Array): Float32Array {
  const late = ssInv(40, 1 / 20, A); // smoothstepDemographicsOriginal(40, 60, A)
  const k = 1.35 - 0.7 * ssInv(8, 1 / 22, A) + 0.3 * ssInv(35, 1 / 20, A);
  const t = 1.1 - 0.4 * ssInv(15, 1 / 20, A) + 0.2 * late;
  const s = 0.55 + 0.95 * ssInv(10, 1 / 25, A) - 0.3 * late;
  out[0] = 1 + (k - 1) * damp;
  out[1] = 1 + (t - 1) * damp;
  out[2] = 1;
  out[3] = 1;
  out[4] = 1 + (s - 1) * damp;
  return out;
}

/**
 * target cohort shares [5] of a residential building at cell i (profile × wealth × life cycle × amenity pull ×
 * per-building variation, normalised)
 */
export function targetSharesOriginal(st: CityState, b: Building, def: BuildingDef, i: number, out: Float32Array = new Float32Array(5), ctx?: DemographicsCtxOriginal): Float32Array {
  const c = ctx ?? demographicsCtxOriginal(st, CTX_TMP);
  const r = accessRecord(st, i, c.svc);
  return targetFrom(b, def, r.fam, r.stud, r.sen, c, out);
}
function targetFrom(b: Building, def: BuildingDef, fam: number, stud: number, sen: number, c: DemographicsCtxOriginal, out: Float32Array): Float32Array {
  const dd = demoOf(def);
  const pm = dd.pm;
  lifeInto(dd.damp, b.age / 360, LIFE);
  const pullF = Math.max(PULL_MIN, 0.7 + 0.6 * fam);
  const pullY = Math.max(PULL_MIN, 0.7 + 0.6 * stud);
  const pullS = Math.max(PULL_MIN, (0.8 + 0.4 * sen) * c.hqPull);
  const id = b.id;
  const v0 = pm[0] * LIFE[0] * pullF * (1 + COHORT_VAR * (2 * hash2(id, 101) - 1));
  const v1 = pm[1] * LIFE[1] * pullF * (1 + COHORT_VAR * (2 * hash2(id, 102) - 1));
  const v2 = pm[2] * pullY * (1 + COHORT_VAR * (2 * hash2(id, 103) - 1));
  const v3 = pm[3] * (1 + COHORT_VAR * (2 * hash2(id, 104) - 1));
  const v4 = pm[4] * LIFE[4] * pullS * (1 + COHORT_VAR * (2 * hash2(id, 105) - 1));
  const inv = 1 / (v0 + v1 + v2 + v3 + v4);
  out[0] = v0 * inv; out[1] = v1 * inv; out[2] = v2 * inv; out[3] = v3 * inv; out[4] = v4 * inv;
  return out;
}

/** workforce share of a cohort mix at wealth 1..3 with college coverage and city HQ */
export function workforceShareOriginal(s: ArrayLike<number>, wealth: number, collegeCov: number, hq: number): number {
  return wfShare(s[1], s[2], s[3], s[4], wealthIdx(wealth), collegeCov, 0.94 + 0.06 * Math.min(1, Math.max(0, hq) / 100));
}
function wfShare(teens: number, yad: number, adults: number, srs: number, wi: number, collegeCov: number, hqPart: number): number {
  const study = clamp01(collegeCov) * COLLEGE_WILL[wi];
  return adults * PART_ADULT[wi] * hqPart + yad * (PART_YAD_WORK * (1 - study) + PART_YAD_STUDY * study) + teens * PART_TEEN + srs * PART_SENIOR;
}

/** education target 0..1 at cell i (EDU_BASE + weighted school coverage) */
export function educationTargetOriginal(st: CityState, i: number): number {
  const a = accessAt(st, i, servicesOn(st));
  return clamp01(EDU_BASE + EDU_W[0] * a.elem + EDU_W[1] * a.high + EDU_W[2] * a.college);
}

/**
 * per-building cohort / workforce / education update (runs in the occupancy slice every dtDays after the pop update).
 * pop0 = residents before this update (newcomers pull the mix toward the target and bring the city's mean education).
 * Fields are written as Math.fround so save / load (Float32 columns) is exact. ctx: the population system's per-day
 * context (built per call when omitted).
 */
export function updateDemographicsOriginal(st: CityState, b: Building, def: BuildingDef, i: number, dtDays: number, pop0 = b.pop, ctx?: DemographicsCtxOriginal, cache?: DemographicsCacheOriginal): void {
  const dev = def.devType;
  if (dev === undefined || dev > DevType.R3) return;
  const c = ctx ?? demographicsCtxOriginal(st, CTX_TMP);
  const id = b.id;
  let fam: number, stud: number, sen: number, eduT: number, col: number;
  if (cache) {
    cache.touch(b); // (first write: every optional WP1 field first, one hidden class)
    const o = cache.refresh(st, b, i, c.svc, def);
    const f = cache.f;
    fam = f[o + C_FAM]; stud = f[o + C_STUD]; sen = f[o + C_SEN]; eduT = f[o + C_EDUT]; col = f[o + C_COL];
  } else {
    const r = accessRecord(st, i, c.svc);
    fam = r.fam; stud = r.stud; sen = r.sen; eduT = r.eduT; col = r.col;
  }
  const t = targetFrom(b, def, fam, stud, sen, c, T);
  const pop1 = b.pop;
  let k0: number, k1: number, k2: number, k4: number;
  if (b.kids === undefined || b.teens === undefined || b.yad === undefined || b.srs === undefined) {
    k0 = t[0]; k1 = t[1]; k2 = t[2]; k4 = t[4];
  } else {
    const k = Math.min(1, (TURNOVER_PER_YEAR / 360) * dtDays + Math.max(0, pop1 - pop0) / Math.max(1, pop1));
    k0 = b.kids + (t[0] - b.kids) * k;
    k1 = b.teens + (t[1] - b.teens) * k;
    k2 = b.yad + (t[2] - b.yad) * k;
    k4 = b.srs + (t[4] - b.srs) * k;
  }
  b.kids = k0 = Math.fround(k0); b.teens = k1 = Math.fround(k1); b.yad = k2 = Math.fround(k2); b.srs = k4 = Math.fround(k4);
  const adults = Math.max(0, 1 - k0 - k1 - k2 - k4);
  const wf = (b.wf = Math.fround(wfShare(k1, k2, adults, k4, demoOf(def).wi, col, c.hqPart)));
  // education stock
  const mean = c.eduMean;
  let edu: number;
  if (b.edu === undefined) edu = mean;
  else {
    edu = b.edu + (eduT - b.edu) * Math.min(1, dtDays * INV_EDU_TAU_DAYS);
    if (pop1 > pop0 && pop1 > 0) edu = (edu * Math.max(0, pop0) + mean * (pop1 - pop0)) / pop1;
  }
  b.edu = Math.fround(clamp01(edu));
  if (cache) {
    const o = id * C_STRIDE;
    cache.i32[o + C_LASTDAY] = st.day;
    cache.f[o + C_LASTPOP] = pop1;
    cache.wf[id] = wf;
    cache.i32[o + C_VER] = 0; // the needs terms are folded with the shares: refill on the next visit
  }
}

// ------------------------------------------------------------------------------------------------ EQ / HQ
/** city context for the HQ target (pop-weighted at homes; tapWater per network via utilities when available) */
export interface HqInputsOriginal { patientAccess: number; air: number; noise: number; tapWater: number; medScore: number }

/** smoothed city education stock (pop-avg b.edu) → EQ target 0..150 */
export function eqTargetOriginal(avgEdu: number): number {
  return Math.max(0, Math.min(150, EQ_FLOOR + EQ_SPAN_STOCK * avgEdu));
}
/** HQ target 0..150 from patient-weighted health access, environment at homes and emergency medicine (WP1-2) */
export function hqTargetOriginal(h: HqInputsOriginal): number {
  const env = Math.max(0, 1 - HQ_AIR * h.air - HQ_NOISE * h.noise - HQ_TAP * (1 - h.tapWater));
  const med = 0.85 + 0.15 * Math.max(0, Math.min(1, h.medScore));
  return Math.max(0, Math.min(150, (HQ_FLOOR + HQ_SPAN_ACCESS * clamp01(h.patientAccess)) * env * med));
}

const HQ_IN: HqInputsOriginal = { patientAccess: 0, air: 0, noise: 0, tapWater: 1, medScore: 1 };
const defByName = (b: Building): BuildingDef | undefined => getDef(b.def);
/** EQ / HQ sums: pop, Σ pop × edu, patients, patient-weighted access, Σ pop × air, Σ pop × noise, piped pop, Σ piped × tap */
const EQHQ_S = 8;
const EQHQ_SCRATCH = new Float64Array(EQHQ_S);
/** the slices of the monthly EQ / HQ pass: homes with id % EQHQ_SLICESOriginal === k are read on the days ≡ k */
export const EQHQ_SLICESOriginal = DAYS_PER_MONTH;
const EQHQ_ALL = (2 ** EQHQ_SLICESOriginal) - 1;

/** add the homes of `slice` (−1 = every home) of `list` to the EQ / HQ sums `out` */
function eqHqSums(st: CityState, list: readonly Building[], slice: number, sim: Simulation | undefined,
  defOf: (b: Building) => BuildingDef | undefined, out: Float64Array | number[]): void {
  const N = st.size;
  let pop = 0, edu = 0, patients = 0, pAcc = 0, air = 0, noise = 0, tapW = 0, tap = 0;
  const hasUtil = st.systemData.infraVersion !== undefined && ((st.systemData.infraLayers as { utilities?: boolean } | undefined)?.utilities ?? true);
  const util = sim?.getSystem('utilities') as unknown as UtilitiesQ | undefined;
  const wq = sim && util && typeof util.waterQualityAt === 'function' ? util : undefined;
  const meanTap = st.stats.tapWater ?? 1;
  const wat = st.watered;
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    if (slice >= 0 && b.id % EQHQ_SLICESOriginal !== slice) continue;
    if (b.pop <= 0 || b.edu === undefined || b.flags & (BF.Abandoned | BF.Burnt)) continue;
    const def = defOf(b);
    if (!def || def.devType === undefined || def.devType > DevType.R3) continue;
    const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
    const p = b.pop;
    const s = cohortSharesOriginal(b, SH);
    const pw = p * (PATIENT_W[0] * s[0] + PATIENT_W[1] * s[1] + PATIENT_W[2] * s[2] + PATIENT_W[3] * s[3] + PATIENT_W[4] * s[4]);
    pop += p;
    edu += p * b.edu;
    patients += pw;
    pAcc += pw * Math.min(1, st.healthCov[i]);
    air += p * st.airPollution[i];
    noise += p * st.noise[i];
    // piped water (as buildingHasWater, with the infra checks hoisted out of the loop)
    if (hasUtil && (b.flags & BF.Watered || wat[b.z * N + b.x] === 1 || wat[(b.z + b.d - 1) * N + b.x + b.w - 1] === 1)) {
      tap += p * (wq ? wq.waterQualityAt!(sim!, i) : meanTap);
      tapW += p;
    }
  }
  out[0] += pop; out[1] += edu; out[2] += patients; out[3] += pAcc; out[4] += air; out[5] += noise; out[6] += tapW; out[7] += tap;
}

/** the EQ / HQ step over dtDays from the sums (false: no resident carries b.edu yet — nothing written) */
function applyEqHq(st: CityState, sums: ArrayLike<number>, dtDays: number): boolean {
  const pop = sums[0];
  if (pop <= 0) return false;
  const edu = sums[1], patients = sums[2], pAcc = sums[3], air = sums[4], noise = sums[5], tapW = sums[6], tap = sums[7];
  const s = st.stats;
  HQ_IN.patientAccess = patients > 0 ? pAcc / patients : 0;
  HQ_IN.air = air / pop;
  HQ_IN.noise = noise / pop;
  HQ_IN.tapWater = tapW > 0 ? tap / tapW : s.tapWater ?? 1;
  HQ_IN.medScore = s.emergency?.medScore ?? 1;
  const eqT = eqTargetOriginal(edu / pop);
  const hqT = hqTargetOriginal(HQ_IN);
  if (dtDays > 0) {
    s.eq += (eqT - s.eq) * (1 - Math.exp(-dtDays / (30 * EQ_SMOOTH_MONTHS)));
    s.hq += (hqT - s.hq) * (1 - Math.exp(-dtDays / (360 * HQ_LAG_YEARS)));
  }
  return true;
}

/** the month of the EQ / HQ slices of `day`: the days after one step day up to (and with) the next one */
const eqHqMonth = (day: number, stepDay: number): number => Math.ceil((day - stepDay) / EQHQ_SLICESOriginal);

/**
 * EQ / HQ in daily slices (population system, every day with sim-infra services; final fixes V5 — one pass over every
 * home on the step day cost ~8 ms at 900k residents): today's slice of the homes is added to the month's sums
 * (systemData.demographics.eqhq), and on the step day (day ≡ stepDay mod EQHQ_SLICESOriginal) the step over dtDays is taken
 * from the month's sums once every slice is in — else (a new or loaded city before its first full month) from one full
 * pass, as updateEqHqOriginal. Returns updateEqHqOriginal's result on the step day, null on the other days. `slice` (final fixes SE-3,
 * optional): the homes of `list` with id % EQHQ_SLICESOriginal === k in list order (EconRuntime.growablesOfSlice) — today's
 * slice is read from it instead of scanning the whole list (the same homes in the same order: the same sums).
 */
export function eqHqDailyOriginal(st: CityState, list: readonly Building[], stepDay: number, dtDays: number, sim?: Simulation,
  defOf: (b: Building) => BuildingDef | undefined = defByName, slice?: (k: number) => readonly Building[]): boolean | null {
  const d = demographicsDataOriginal(st);
  const day = st.day;
  const m = eqHqMonth(day, stepDay);
  let a = d.eqhq;
  if (!a || !Array.isArray(a.s) || a.s.length !== EQHQ_S) d.eqhq = a = { m, done: 0, s: new Array<number>(EQHQ_S).fill(0) };
  // (a month whose step was skipped starts over: no slice counts twice)
  if (a.m !== m) { a.m = m; a.done = 0; a.s.fill(0); }
  const k = day % EQHQ_SLICESOriginal;
  if (!(a.done & (1 << k))) {
    if (slice) eqHqSums(st, slice(k), -1, sim, defOf, a.s);
    else eqHqSums(st, list, k, sim, defOf, a.s);
    a.done |= 1 << k;
  }
  if (day % EQHQ_SLICESOriginal !== stepDay % EQHQ_SLICESOriginal) return null;
  const r = a.done === EQHQ_ALL ? applyEqHq(st, a.s, dtDays) : updateEqHqOriginal(st, list, dtDays, sim, defOf);
  // the next month's slices start with the day after the step
  a.m = m + 1; a.done = 0; a.s.fill(0);
  return r;
}

/**
 * EQ / HQ step over dtDays (population system, monthly; only with the services system): EQ follows the residents'
 * education stock, HQ the patient-weighted health coverage at homes × air / noise / tap water × emergency medicine.
 * Returns false (nothing written) while no resident carries b.edu yet (services' legacy fallback keeps EQ / HQ).
 * defOf: def lookup (the population system passes its per-id cache; default getDef).
 */
export function updateEqHqOriginal(st: CityState, list: readonly Building[], dtDays: number, sim?: Simulation, defOf: (b: Building) => BuildingDef | undefined = defByName): boolean {
  EQHQ_SCRATCH.fill(0);
  eqHqSums(st, list, -1, sim, defOf, EQHQ_SCRATCH);
  return applyEqHq(st, EQHQ_SCRATCH, dtDays);
}

/**
 * Utilities system: power grid + water network.
 *
 * POWER
 *  - Conductors: any network cell (roads, rail, bridges), power-line cells, building-covered cells.
 *  - Each connected conductor component shares the output of the power plants it contains (def.powerOut, reduced when
 *    utilities funding < 100 %). Demand = def.powerUse (scaled by occupancy) or derived from capacity.
 *  - Plant output (SIM_DEPTH_SPEC WP3 E): thermal plants (category power + waterUse) x THERMAL_UNWATERED without water
 *    (last pass); wind turbines x (0.6 + 0.8 smoothstep(10, 60, height above the local mean)); solar x season x
 *    climate; nuclear x ordinanceEffect 'power.nuclear' (nuclear-free zone shuts plants down); the incinerator x its
 *    garbage burn share (PollutionSystem.incineratorShare, previous pass). plantLoad(id) = component demand / supply.
 *  - Brownout: when demand > supply, critical loads (health, police, fire, water producers) are served first, then a
 *    multi-source BFS from the plants serves consumers in distance order; once the supply is exhausted every farther
 *    consumer loses power (farthest first).
 *  - Empty zoned cells 4-adjacent to a powered conductor are marked powered (for growth).
 *  - Writes state.powered, BF.Powered (buildingChanged on flip), stats.powerSupply / powerDemand.
 * WATER
 *  - Pipes run automatically under every road cell; road-connected components form water networks.
 *  - Producers (def.waterOut) feed the road component they touch (<= 1 cell). Pumps within 2 cells of FRESH water
 *    +50 % (sea only: brackish x 0.6, terrainMasks.seaMask); desalination away from the sea x 0.2; intakes lose
 *    output with the intake pollution max(ground, adjacent water body) (less with a treatment plant in the city).
 *  - Tap water quality per network = 1 - supply-weighted intake pollution x (1 - 0.7 sewageTreated) (treatment and
 *    desalination output is clean): waterQualityAt(sim, cell); stats.tapWater = demand-weighted city mean.
 *  - Buildings 4-adjacent to a watered road get water; same brownout ordering by BFS from producers.
 *  - Writes state.watered, BF.Watered, stats.waterSupply / waterDemand / tapWater. Shortage / blackout news
 *    (30-day cooldown). Final fixes N1: a pass that cuts OCCUPIED buildings off because their grid / pipe network lost
 *    its producer (a bulldozed road, line, plant or pump — not the brownout's deliberate farthest-first cut) posts
 *    "Power cut" / "Water cut" news at once with the counts and the biggest building's place (UTIL_CUT_NEWS_DAYS).
 * SCHEDULING (InfraScheduler; every step <= ~2.3 measured ms on the 256² stress city, estimates in stepCost):
 *    uses (+ local label patch) -> [labels: full passes / a new building bridging two grids] -> power sums + loads
 *    (+ results when no grid is short) -> [brownout: critical-first + distance-ordered BFS, only when a grid is
 *    short] -> water sums (+ results, flags) -> [water brownout BFS + results, flags: only when a network is short].
 *  - full pass (relabel components): network / power-line / plopped-building changes (urgent, next scheduler slot)
 *    and every UTIL_FULL_DAYS days;
 *  - soft pass (labels patched locally for growables added / removed, sums + brownout + flags): within
 *    UTIL_SOFT_DAYS of a growth change / zone change and every UTIL_REFRESH_DAYS days (demand drifts with pop).
 */
import { Network, isRoad } from '../../../src/core/types';





import { Fam, type DefInfo, activeJobs, detectJobsUnknown, ensureIdArray, ensureIdFloat, fundingFactor, infoOf, readEffects, setFlagQuiet, nowMs, buildingList } from '../../../src/sim/infra/common';
import { DESAL_INLAND_OUT, POWER_MIN_PLOPPED, POWER_PER_CIVIC_JOB, POWER_PER_JOB_C, POWER_PER_JOB_I, POWER_PER_RES, PUMP_POLL_LOSS, PUMP_TREATED_LOSS, PUMP_WATER_BONUS, PUMP_WATER_DIST, SEA_PUMP_OUT, SHORTAGE_NEWS_DAYS, SOLAR_CLIMATE, SOLAR_SUMMER, SOLAR_WINTER, TAP_TREATMENT_CLEAN, THERMAL_UNWATERED, UTIL_BASE_SHARE, UTIL_CUT_NEWS_DAYS, UTIL_FULL_DAYS, UTIL_REFRESH_DAYS, UTIL_SOFT_DAYS, WATER_PER_CIVIC_JOB, WATER_PER_JOB_C, WATER_PER_JOB_I, WATER_PER_RES, WIND_TURBINE_BASE, WIND_TURBINE_GAIN, WIND_TURBINE_H0, WIND_TURBINE_H1, WIND_TURBINE_RADIUS } from '../../../src/sim/infra/params';
import { schedulerOf, sizeFactors } from '../../../src/sim/infra/scheduler';

import { seaMask, waterNear } from '../../../src/sim/infra/terrainMasks';

import type { PollutionSystem } from '../../../src/sim/infra/pollution';

const IND_KEYS = ['IA', 'ID', 'IM', 'IHT'] as const;

/** a multiplicative factor on a producer's output, for the inspector ("Flat site 60 %") */
export interface OutputFactorOriginal {
  label: string;
  mul: number;
}
/** power plant / water producer output breakdown (last utilities pass) */
export interface ProducerInfoOriginal {
  kind: 'power' | 'water';
  /** def output at 100 % (MW or kL/day) */
  nominal: number;
  /** output this pass */
  output: number;
  factors: OutputFactorOriginal[];
  /** power: share of the plant's grid supply in use 0..1 (-1 unknown); water: intake pollution 0..1 */
  load: number;
}

type ProducerKind = 0 | 2 | 3 | 4 | 5;
const PK_OTHER = 0, PK_NUCLEAR = 2, PK_WIND = 3, PK_SOLAR = 4, PK_INCIN = 5;
function powerKind(inf: DefInfo): ProducerKind {
  if (inf.isIncinerator) return PK_INCIN;
  const s = inf.id + ' ' + inf.model;
  if (s.includes('nuclear')) return PK_NUCLEAR;
  if (s.includes('wind')) return PK_WIND;
  if (s.includes('solar')) return PK_SOLAR;
  return PK_OTHER;
}
function isDesal(inf: DefInfo): boolean {
  return (inf.id + ' ' + inf.model).includes('desal');
}
/** loads served first in a brownout */
function isCritical(inf: DefInfo): boolean {
  return inf.waterOut > 0 || inf.service === 'health' || inf.service === 'police' || inf.service === 'fire';
}

/** pass steps (see SCHEDULING above); the brownout steps run only when a grid / network is short */
const U_USES = 0, U_LABEL = 1, U_POWER = 2, U_BROWN = 3, U_WATER = 4, U_WATER_BROWN = 5;

/** append v at index n of a growable id list; returns the (possibly new) array */
function pushId(a: Int32Array<ArrayBuffer>, n: number, v: number): Int32Array<ArrayBuffer> {
  if (n >= a.length) {
    const b = new Int32Array(Math.max(64, a.length * 2));
    b.set(a);
    a = b;
  }
  a[n] = v;
  return a;
}

function occupancy(inf: DefInfo, b: Building, jobsUnknown: boolean): number {
  if (b.capacity <= 0) return 1;
  if (inf.fam === Fam.R) return Math.min(1, b.pop / b.capacity);
  if (inf.fam === Fam.C || inf.fam === Fam.I) return Math.min(1, activeJobs(inf, b, jobsUnknown) / b.capacity);
  return 1;
}

/** full-occupancy utility use of a building (power MW or water kL/day) */
function fullUse(inf: DefInfo, b: Building, power: boolean): number {
  const explicit = power ? inf.powerUse : inf.waterUse;
  if (explicit >= 0) return explicit;
  const cap = b.capacity;
  switch (inf.fam) {
    case Fam.R: return cap * (power ? POWER_PER_RES : WATER_PER_RES);
    case Fam.C: return cap * (power ? POWER_PER_JOB_C : WATER_PER_JOB_C);
    case Fam.I: {
      const k = IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))];
      return cap * (power ? POWER_PER_JOB_I[k] : WATER_PER_JOB_I[k]);
    }
    default: {
      const jobs = inf.civicJobs;
      const perJob = power ? POWER_PER_CIVIC_JOB : WATER_PER_CIVIC_JOB;
      // parks without an explicit powerUse / waterUse draw nothing (lawns and benches); staffed ones by their jobs
      return Math.max(inf.isPark ? 0 : POWER_MIN_PLOPPED, jobs * perJob);
    }
  }
}

export function buildingPowerUseOriginal(inf: DefInfo, b: Building, jobsUnknown: boolean): number {
  if (inf.powerOut > 0) return 0;
  if (b.built < 1 || (b.flags & (BF.Burnt | BF.Abandoned)) !== 0) return 0;
  const occ = occupancy(inf, b, jobsUnknown);
  return fullUse(inf, b, true) * (UTIL_BASE_SHARE + (1 - UTIL_BASE_SHARE) * occ);
}
export function buildingWaterUseOriginal(inf: DefInfo, b: Building, jobsUnknown: boolean): number {
  if (inf.waterOut > 0) return 0;
  if (b.built < 1 || (b.flags & (BF.Burnt | BF.Abandoned)) !== 0) return 0;
  const occ = occupancy(inf, b, jobsUnknown);
  return fullUse(inf, b, false) * (UTIL_BASE_SHARE + (1 - UTIL_BASE_SHARE) * occ);
}

function plantEfficiency(state: CityState): number {
  const f = fundingFactor(state, 'utilities');
  return f >= 1 ? 1 : 0.4 + 0.6 * f;
}

export interface GridInfoOriginal {
  supply: number;
  demand: number;
  /** true when demand > supply (brownout) */
  shortage: boolean;
}

export class UtilitiesSystemOriginal implements SimSystem {
  readonly name = 'utilities';
  /** power topology changed (network / power lines / plopped buildings) -> relabel + urgent */
  private dirtyFull = true;
  /** water topology changed (roads) */
  private dirtyWater = true;
  /** growables added / removed, zones changed -> soft refresh within UTIL_SOFT_DAYS */
  private soft = false;
  private added: Building[] = [];
  private removed: Building[] = [];
  private lastServe = -1e9;
  private lastFull = -1e9;
  /** pass step: -1 idle, else the next step (U_*) */
  private stepIdx = -1;
  private passFull = false;
  /** this pass relabels the power grid (full pass, or a new building bridges two grids) */
  private relabelPower = false;
  /** power producers and critical consumers of this pass (building ids; lists built by the uses step) */
  private plantIds = new Int32Array(64);
  private nPlants = 0;
  private critIds = new Int32Array(256);
  private nCrit = 0;
  /** water producers delivering water this pass (brownout BFS seeds) */
  private wSeedIds = new Int32Array(64);
  private nWSeeds = 0;
  /** stamps of this pass's power / water results in bOk (the brownout steps run after the sums steps) */
  private powerStamp = 0;
  private waterStamp = 0;
  private exhaustedP = new Uint8Array(256);
  private exhaustedW = new Uint8Array(256);
  /** per water network: supplied and not short (the power grid's okComp is separate) */
  private okW = new Uint8Array(256);
  private unsub: (() => void)[] = [];
  private stamp = 0;
  // per cell
  private pComp = new Int32Array(0);
  private wComp = new Int32Array(0);
  private queue = new Int32Array(0);
  private visit = new Int32Array(0);
  // per building id
  private bUse = new Float32Array(1024);
  private bOk = new Int32Array(1024);
  private bWComp = new Int32Array(1024);
  /** per building id: water use (>= 0) or -(output) - tiny for producers */
  private bWUse = new Float32Array(1024);
  /** water producers that need power to pump (def powerUse > 0) */
  private bNeedPow = new Uint8Array(1024);
  private bPow = new Uint8Array(1024);
  private bWat = new Uint8Array(1024);
  // per component
  private cSupply = new Float64Array(256);
  private cDemand = new Float64Array(256);
  private cLeft = new Float64Array(256);
  private wSupply = new Float64Array(256);
  private wDemand = new Float64Array(256);
  private wLeft = new Float64Array(256);
  private nPComp = 0;
  private okComp = new Uint8Array(256);
  private nWComp = 0;
  /** per water component: supply-weighted intake pollution sum, tap water quality 0..1 */
  private wPoll = new Float64Array(256);
  private wQual = new Float32Array(256);
  /** per building id: plant load 0..1 (-1 unknown) and last water result (0 unknown, 1 watered, 2 dry) */
  private loadById = new Float32Array(1024).fill(-1);
  private watSeen = new Uint8Array(1024);
  /** per producer id: output breakdown of the last pass; intake pollution per water producer id */
  private producers = new Map<number, ProducerInfoOriginal>();
  private intakeById = new Float32Array(1024);
  private wasShort = false;
  private lastShortNotify = -1e9;
  private wasWaterShort = false;
  private lastWaterNotify = -1e9;
  /** power supply of the last pass (blackout news when it drops to 0 under demand) */
  private lastSupply = 0;
  private lastBlackoutNotify = -1e9;
  /** nuclear plants shut down by the nuclear-free-zone ordinance: announced once per enactment */
  private nuclearOffAnnounced = false;
  /** last "Power cut" / "Water cut" news (final fixes N1); no such news for the init / load pass */
  private lastCutNews = -1e9;
  private cutQuiet = false;
  private simRef: Simulation | null = null;
  /** duration (ms) of the last step / last full synchronous compute */
  lastMs = 0;

  init(sim: Simulation): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    const ev = sim.events;
    const full = () => { this.dirtyFull = true; };
    const net = () => { this.dirtyFull = true; this.dirtyWater = true; };
    // growables appearing / vanishing: local label patch + soft refresh; plopped buildings (plants!): full + urgent
    const markAdd = (b: Building) => {
      if (b.flags & BF.Plopped || infoOf(sim.state, b).fam === Fam.Plop) this.dirtyFull = true;
      else { this.soft = true; this.added.push(b); }
    };
    const markRem = (b: Building) => {
      if (b.flags & BF.Plopped || infoOf(sim.state, b).fam === Fam.Plop) this.dirtyFull = true;
      else { this.soft = true; this.removed.push(b); }
    };
    this.unsub.push(ev.on('networkChanged', net), ev.on('buildingAdded', markAdd), ev.on('buildingRemoved', markRem),
      ev.on('powerLinesChanged', full), ev.on('zoneChanged', () => { this.soft = true; }), ev.on('reset', net));
    sim.state.systemData.infraLayers = { utilities: true, traffic: true, pollution: true, services: true };
    sim.state.systemData.infraVersion = 1;
    this.simRef = sim;
    // an ordinance already in force when a city is loaded is not news
    this.nuclearOffAnnounced = ordinanceEffect(sim.state, 'power.nuclear') < 0.5;
    this.dirtyFull = true;
    this.dirtyWater = true;
    this.added = [];
    this.removed = [];
    this.stepIdx = -1;
    this.lastSupply = 0;
    this.lastShortNotify = this.lastWaterNotify = this.lastBlackoutNotify = this.lastCutNews = -1e9;
    this.wasShort = this.wasWaterShort = false;
    this.loadById.fill(-1);
    this.producers.clear();
    this.rememberCoolingWater(sim.state);
    // (flags a loaded / new city's first pass flips are not news)
    this.cutQuiet = true;
    try { this.compute(sim); } finally { this.cutQuiet = false; }
    const self = this;
    schedulerOf(sim).register({
      name: 'utilities',
      due: (s) => self.due(s),
      urgent: () => self.dirtyFull || self.stepIdx >= 0 && self.passFull,
      cost: (s) => self.stepCost(s),
      step: (s) => self.step(s),
    });
  }

  daily(sim: Simulation): void {
    schedulerOf(sim).tickDay(sim);
  }

  frame(sim: Simulation, _dt: number): void {
    schedulerOf(sim).tickFrame(sim, this);
  }

  /** mark for a full recompute as soon as possible */
  invalidate(): void {
    this.dirtyFull = true;
  }

  private due(sim: Simulation): boolean {
    if (this.stepIdx >= 0) return true;
    const d = sim.state.day;
    return this.dirtyFull || (this.soft && d - this.lastServe >= UTIL_SOFT_DAYS) || d - this.lastServe >= UTIL_REFRESH_DAYS || d - this.lastFull >= UTIL_FULL_DAYS;
  }

  /**
   * estimated ms of the next step (~1.3-1.5x the minimum measured on the 256² stress city with 20k buildings under
   * load; every step <= 3.0). The brownout steps only run when a grid / network is short, so their cost is known.
   */
  private stepCost(sim: Simulation): number {
    const { cells, bld } = sizeFactors(sim);
    const waterLabel = this.dirtyWater || this.wComp.length !== sim.state.cells ? 0.5 * cells : 0;
    switch (this.stepIdx < 0 ? U_USES : this.stepIdx) {
      case U_USES: return 2.0 * bld + 0.1 * cells;
      case U_LABEL: return (this.relabelPower ? 1.1 * cells : 0) + waterLabel + 0.05;
      case U_POWER: return 0.5 * cells + 0.7 * bld;
      case U_BROWN: return 1.9 * cells + 0.8 * bld;
      case U_WATER: return waterLabel + 0.5 * cells + 0.8 * bld;
      default: return 1.9 * cells + 0.8 * bld;
    }
  }

  /** run one step of a (full or soft) refresh pass */
  step(sim: Simulation): void {
    const t0 = nowMs();
    const st = sim.state;
    if (this.stepIdx < 0) {
      this.stepIdx = U_USES;
      this.passFull = this.dirtyFull || st.day - this.lastFull >= UTIL_FULL_DAYS || this.pComp.length !== st.cells;
    }
    switch (this.stepIdx) {
      case U_USES: {
        this.ensure(st);
        const fx = readEffects(st);
        this.prepareUses(st, fx.powerDemand, fx.waterDemand, detectJobsUnknown(st));
        let relabel = this.passFull;
        if (this.passFull) this.dirtyFull = false;
        else if (!this.patchPower(st)) relabel = true; // a new building bridges two grids: relabel in the next step
        this.relabelPower = relabel;
        this.added.length = 0;
        this.removed.length = 0;
        this.soft = false;
        this.stepIdx = relabel || this.dirtyWater || this.wComp.length !== st.cells ? U_LABEL : U_POWER;
        break;
      }
      case U_LABEL:
        if (this.relabelPower) {
          this.labelPower(st);
          if (this.passFull) this.lastFull = st.day;
        }
        if (this.dirtyWater || this.wComp.length !== st.cells) { this.labelWater(st); this.dirtyWater = false; }
        this.stepIdx = U_POWER;
        break;
      case U_POWER:
        this.ensureIds(st);
        this.stepIdx = this.powerSums(st) ? U_BROWN : U_WATER;
        break;
      case U_BROWN:
        this.ensureIds(st);
        this.powerBrownout(st);
        this.stepIdx = U_WATER;
        break;
      case U_WATER:
        this.ensureIds(st);
        // a road edit landed mid-pass: relabel the water networks before using them
        if (this.dirtyWater || this.wComp.length !== st.cells) { this.labelWater(st); this.dirtyWater = false; }
        if (this.waterSums(st)) this.stepIdx = U_WATER_BROWN;
        else this.endPass(sim);
        break;
      default:
        this.ensureIds(st);
        this.waterBrownout(st);
        this.endPass(sim);
        break;
    }
    this.lastMs = nowMs() - t0;
  }

  private endPass(sim: Simulation): void {
    this.finish(sim);
    this.stepIdx = -1;
    this.lastServe = sim.state.day;
  }

  /** full synchronous recompute (init / tests / UI) */
  compute(sim: Simulation): void {
    const t0 = nowMs();
    this.stepIdx = -1;
    this.dirtyFull = true;
    do this.step(sim); while (this.stepIdx >= 0);
    this.lastMs = nowMs() - t0;
  }

  /** power grid info at a cell (conductor or building) or null if not on a grid */
  gridInfo(sim: Simulation, x: number, z: number): GridInfoOriginal | null {
    const st = sim.state;
    if (!st.inBounds(x, z) || this.pComp.length !== st.cells) return null;
    const c = this.pComp[z * st.size + x];
    if (c < 0 || c >= this.nPComp) return null;
    return { supply: this.cSupply[c], demand: this.cDemand[c], shortage: this.cDemand[c] > this.cSupply[c] };
  }
  /** water network info at a road cell / building */
  waterInfo(sim: Simulation, x: number, z: number): GridInfoOriginal | null {
    const st = sim.state;
    if (!st.inBounds(x, z) || this.wComp.length !== st.cells) return null;
    let c = this.wComp[z * st.size + x];
    if (c < 0) {
      const b = st.buildingAt(x, z);
      if (b && b.id < this.bWComp.length) c = this.bWComp[b.id] - 1;
    }
    if (c < 0 || c >= this.nWComp) return null;
    return { supply: this.wSupply[c], demand: this.wDemand[c], shortage: this.wDemand[c] > this.wSupply[c] };
  }

  private ensure(st: CityState): void {
    const C = st.cells;
    if (this.pComp.length !== C) {
      this.pComp = new Int32Array(C).fill(-1);
      this.wComp = new Int32Array(C).fill(-1);
      this.queue = new Int32Array(C);
      this.visit = new Int32Array(C);
      this.passFull = true;
      this.dirtyWater = true;
    }
    this.ensureIds(st);
  }

  /** per-building-id arrays cover every id (buildings may appear between the steps of a pass) */
  private ensureIds(st: CityState): void {
    if (this.bOk.length >= st.nextBuildingId + 1 && this.bPow.length >= this.bOk.length) return;
    this.bOk = ensureIdArray(this.bOk, st);
    this.bUse = ensureIdFloat(this.bUse, st);
    this.bWComp = ensureIdArray(this.bWComp, st);
    this.bWUse = ensureIdFloat(this.bWUse, st);
    this.intakeById = ensureIdFloat(this.intakeById, st);
    if (this.loadById.length < this.bOk.length) {
      const l = new Float32Array(this.bOk.length).fill(-1);
      l.set(this.loadById);
      this.loadById = l;
    }
    if (this.bPow.length < this.bOk.length) {
      const grow = (a: Uint8Array) => { const b = new Uint8Array(this.bOk.length); b.set(a.subarray(0, Math.min(a.length, b.length))); return b; };
      this.bPow = grow(this.bPow);
      this.bWat = grow(this.bWat);
      this.bNeedPow = grow(this.bNeedPow);
      this.watSeen = grow(this.watSeen);
    }
  }

  /**
   * After a load: thermal plants that were simulated before (BF.Powered set by an earlier pass) take their cooling
   * water state from the saved BF.Watered flag, so an unwatered plant does not deliver full output for one pass
   * (which ended and restarted brownouts, re-firing shortage news after every load). Never-simulated plants (fresh
   * test / sandbox states) stay unknown = assumed watered.
   */
  private rememberCoolingWater(st: CityState): void {
    this.watSeen.fill(0);
    this.ensureIds(st);
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      if ((b.flags & BF.Powered) === 0) continue;
      const inf = infoOf(st, b);
      if (inf.powerOut > 0 && inf.waterUse > 0) this.watSeen[b.id] = (b.flags & BF.Watered) !== 0 ? 1 : 2;
    }
  }

  /** share 0..1 of the plant's grid supply in use (last pass; -1 = unknown / not a plant) */
  plantLoad(id: number): number {
    return id >= 0 && id < this.loadById.length ? this.loadById[id] : -1;
  }

  /** output breakdown of a power plant / water producer (last pass), null if not a producer */
  producerInfo(id: number): ProducerInfoOriginal | null {
    return this.producers.get(id) ?? null;
  }

  /**
   * tap-water quality 0..1 (1 = clean) at a cell: quality of the water network serving the road cell / building there
   * (supply-weighted intake pollution with treatment applied). Falls back to the city mean stats.tapWater.
   */
  waterQualityAt(sim: Simulation, cell: number): number {
    const st = sim.state;
    const mean = st.stats.tapWater ?? 1;
    if (cell < 0 || cell >= st.cells || this.wComp.length !== st.cells) return mean;
    let c = this.wComp[cell];
    if (c < 0) {
      const bid = st.building[cell];
      if (bid >= 0 && bid < this.bWComp.length) c = this.bWComp[bid] - 1;
    }
    if (c < 0) {
      const N = st.size, x = cell % N;
      if (x > 0 && this.wComp[cell - 1] >= 0) c = this.wComp[cell - 1];
      else if (x < N - 1 && this.wComp[cell + 1] >= 0) c = this.wComp[cell + 1];
      else if (cell >= N && this.wComp[cell - N] >= 0) c = this.wComp[cell - N];
      else if (cell + N < st.cells && this.wComp[cell + N] >= 0) c = this.wComp[cell + N];
    }
    if (c < 0 || c >= this.nWComp || !(this.wSupply[c] > 0)) return mean;
    return this.wQual[c];
  }

  /** apply flags, news, events */
  private finish(sim: Simulation): void {
    const st = sim.state;
    const changed: Building[] = [];
    const bPow = this.bPow, bWat = this.bWat;
    const watSeen = this.watSeen;
    const cut = this.cut;
    cut.pN = cut.pRes = cut.pJobs = cut.wN = cut.wRes = cut.wJobs = 0;
    cut.at = null;
    cut.atPeople = 0;
    cut.pPlant = false;
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const wasP = (b.flags & BF.Powered) !== 0, wasW = (b.flags & BF.Watered) !== 0;
      const f1 = setFlagQuiet(b, BF.Powered, bPow[b.id] === 1);
      const f2 = setFlagQuiet(b, BF.Watered, bWat[b.id] === 1);
      watSeen[b.id] = bWat[b.id] === 1 ? 1 : 2;
      if (f1 || f2) {
        changed.push(b);
        if ((wasP && f1) || (wasW && f2)) this.tallyCut(st, b, wasP && f1, wasW && f2);
      }
    }
    for (const b of changed) sim.events.emit('buildingChanged', b);
    this.cutNews(sim);
    const short = st.stats.powerDemand > st.stats.powerSupply * 1.0001 && st.stats.powerSupply > 0;
    if (short && !this.wasShort && st.day - this.lastShortNotify > SHORTAGE_NEWS_DAYS) {
      this.lastShortNotify = st.day;
      sim.notify(`Power shortage: demand ${Math.round(st.stats.powerDemand)} MW exceeds supply ${Math.round(st.stats.powerSupply)} MW. Brownouts in outlying areas.`, 'warning', undefined, undefined, 'utilities');
    }
    this.wasShort = short;
    // the grid went dark (every plant lost, burnt or shut down by ordinance) while buildings still need power
    if (st.stats.powerSupply <= 0 && this.lastSupply > 0 && st.stats.powerDemand > 0 && st.day - this.lastBlackoutNotify > SHORTAGE_NEWS_DAYS) {
      this.lastBlackoutNotify = st.day;
      sim.notify(`Blackout: no power plant is supplying the grid (demand ${Math.round(st.stats.powerDemand).toLocaleString('en-US')} MW). Build or repair a power plant.`, 'warning', undefined, undefined, 'utilities');
    }
    this.lastSupply = st.stats.powerSupply;
    const wShort = st.stats.waterDemand > st.stats.waterSupply * 1.0001 && st.stats.waterSupply > 0;
    if (wShort && !this.wasWaterShort && st.day - this.lastWaterNotify > SHORTAGE_NEWS_DAYS) {
      this.lastWaterNotify = st.day;
      sim.notify(`Water shortage: demand ${Math.round(st.stats.waterDemand).toLocaleString('en-US')} kL/day exceeds supply ${Math.round(st.stats.waterSupply).toLocaleString('en-US')} kL/day. Taps run dry in outlying areas.`, 'warning', undefined, undefined, 'utilities');
    }
    this.wasWaterShort = wShort;
    sim.events.emit('layerUpdated', 'utilities');
  }

  /**
   * occupied buildings this pass cut off because their grid / pipe network lost every producer (a bulldozed road,
   * power line, plant or pump; not the brownout's deliberate farthest-first cut, whose grid still has supply):
   * counts for the "Power cut" / "Water cut" news (final fixes N1)
   */
  private cut = { pN: 0, pRes: 0, pJobs: 0, wN: 0, wRes: 0, wJobs: 0, at: null as Building | null, atPeople: 0, pPlant: false };
  private tallyCut(st: CityState, b: Building, lostPower: boolean, lostWater: boolean): void {
    if (this.cutQuiet || !(b.pop > 0 || b.jobs > 0) || (b.flags & (BF.Abandoned | BF.Burnt)) !== 0) return;
    const N = st.size, cut = this.cut;
    let counted = false;
    const s = st.stats;
    if (lostPower && !(infoOf(st, b).powerOut > 0)) {
      const c = this.pComp[b.z * N + b.x];
      const none = c < 0 || c >= this.nPComp || !(this.cSupply[c] > 0);
      // a grid split off with too little supply of its own while the city as a whole has enough: also an edit's cut
      const split = !none && this.cDemand[c] > this.cSupply[c] && s.powerSupply >= s.powerDemand;
      if (none || split) {
        cut.pN++; cut.pRes += b.pop; cut.pJobs += b.jobs;
        counted = true;
        // a plant stands on the dark grid but produces nothing (ordinance, idle incinerator ...): say so, not "reconnect"
        if (none && !cut.pPlant && c >= 0) for (let q = 0; q < this.nPlants; q++) {
          const p = st.buildings.get(this.plantIds[q]);
          if (p && this.pComp[p.z * N + p.x] === c) { cut.pPlant = true; break; }
        }
      }
    }
    if (lostWater && needsWater(st, b)) {
      const c = this.bWComp[b.id] - 1;
      const none = c < 0 || c >= this.nWComp || !(this.wSupply[c] > 0);
      const split = !none && this.wDemand[c] > this.wSupply[c] && s.waterSupply >= s.waterDemand;
      if (none || split) {
        cut.wN++; cut.wRes += b.pop; cut.wJobs += b.jobs;
        counted = true;
      }
    }
    if (counted && b.pop + b.jobs > cut.atPeople) { cut.at = b; cut.atPeople = b.pop + b.jobs; }
  }

  /** "Power cut" / "Water cut" news right after the pass that cut occupied buildings off (location: the biggest one) */
  private cutNews(sim: Simulation): void {
    const st = sim.state, c = this.cut;
    if ((c.pN === 0 && c.wN === 0) || !c.at || st.day - this.lastCutNews < UTIL_CUT_NEWS_DAYS) return;
    // (a city-wide blackout has its own news)
    if (c.pN > 0 && c.wN === 0 && st.stats.powerSupply <= 0) return;
    this.lastCutNews = st.day;
    const n = (v: number) => Math.round(v).toLocaleString('en-US');
    const who = (k: number, res: number, jobs: number) => {
      const p = [res > 0 ? `${n(res)} resident${Math.round(res) === 1 ? '' : 's'}` : '', jobs > 0 ? `${n(jobs)} job${Math.round(jobs) === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
      return `${n(k)} building${k === 1 ? '' : 's'}${p ? ` (${p})` : ''}`;
    };
    const x = c.at.x + (c.at.w >> 1), z = c.at.z + (c.at.d >> 1);
    let text: string;
    if (c.pN > 0 && c.wN > 0) {
      text = c.pN === c.wN
        ? `Power and water cut: ${who(c.pN, c.pRes, c.pJobs)} lost power and water — reconnect ${c.pN === 1 ? 'it' : 'them'} to the grid and to the pipes under the roads (Power and Water data views).`
        : `Power and water cut: ${who(c.pN, c.pRes, c.pJobs)} lost power and ${who(c.wN, c.wRes, c.wJobs)} lost water — reconnect them to the grid and to the pipes under the roads (Power and Water data views).`;
    } else if (c.pN > 0) {
      text = c.pPlant
        ? `Power cut: ${who(c.pN, c.pRes, c.pJobs)} lost power — the plant on ${c.pN === 1 ? 'its' : 'their'} grid produces nothing (click it to see why; Power data view).`
        : `Power cut: ${who(c.pN, c.pRes, c.pJobs)} lost power — reconnect ${c.pN === 1 ? 'it' : 'them'} to the grid with a road or power line (Power data view).`;
    } else {
      text = `Water cut: ${who(c.wN, c.wRes, c.wJobs)} lost water — connect ${c.wN === 1 ? 'its road' : 'their roads'} to a road with a working water pump; pipes run under roads (Water data view).`;
    }
    sim.notify(text, 'warning', x, z, 'utilities');
  }

  /** one pass over buildings: power use / plant output (bUse) and water use / producer output (bWUse) */
  private prepareUses(st: CityState, pMul: number, wMul: number, jobsUnknown: boolean): void {
    const eff = plantEfficiency(st);
    const bUse = this.bUse, bWUse = this.bWUse;
    const list = buildingList(st);
    let hasTreatment = false;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const inf = infoOf(st, b);
      if (inf.isTreatment && b.built >= 1 && (b.flags & BF.Burnt) === 0) { hasTreatment = true; break; }
    }
    const producers = this.producers;
    producers.clear();
    const nuclearMul = Math.max(0, ordinanceEffect(st, 'power.nuclear'));
    let nuclearLost = 0;
    const pollution = this.simRef?.getSystem<PollutionSystem>('pollution');
    let sea: Uint8Array | null = null;
    const season = 0.5 * (SOLAR_WINTER + SOLAR_SUMMER) - 0.5 * (SOLAR_SUMMER - SOLAR_WINTER) * Math.cos((2 * Math.PI * ((st.day % 360) + 15)) / 360);
    const climate = SOLAR_CLIMATE[st.config.climate] ?? 1;
    let nPlants = 0, nCrit = 0;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const inf = infoOf(st, b);
      const ok = b.built >= 1 && (b.flags & (BF.Burnt | BF.Abandoned)) === 0;
      if (inf.powerOut <= 0 && isCritical(inf)) this.critIds = pushId(this.critIds, nCrit++, b.id);
      if (inf.powerOut > 0) {
        this.plantIds = pushId(this.plantIds, nPlants++, b.id);
        let out = 0;
        const factors: OutputFactorOriginal[] = [];
        if (ok) {
          out = inf.powerOut * eff;
          if (eff < 1) factors.push({ label: 'Utilities funding', mul: eff });
          // thermal plants (coal / oil / gas / nuclear: category power with a water use) need cooling water; last pass's
          // result (unknown for a brand-new plant -> assume watered)
          if (inf.category === 'power' && inf.waterUse > 0 && this.watSeen[b.id] === 2) {
            out *= THERMAL_UNWATERED;
            factors.push({ label: 'No cooling water', mul: THERMAL_UNWATERED });
          }
          switch (powerKind(inf)) {
            case PK_NUCLEAR:
              if (nuclearMul < 1) { nuclearLost += out * (1 - nuclearMul); out *= nuclearMul; factors.push({ label: 'Nuclear-free zone', mul: nuclearMul }); }
              break;
            case PK_WIND: {
              const m = WIND_TURBINE_BASE + WIND_TURBINE_GAIN * smoothstep(WIND_TURBINE_H0, WIND_TURBINE_H1, relativeHeight(st, b));
              out *= m;
              factors.push({ label: m < 1 ? 'Sheltered site' : 'Windy hilltop', mul: m });
              break;
            }
            case PK_SOLAR:
              out *= season * climate;
              factors.push({ label: 'Season', mul: season });
              if (climate !== 1) factors.push({ label: 'Climate', mul: climate });
              break;
            case PK_INCIN: {
              const share = pollution?.incineratorShare(b.id) ?? -1;
              if (share >= 0) { out *= share; factors.push({ label: 'Garbage burned', mul: share }); }
              break;
            }
          }
        }
        bUse[b.id] = -out;
        producers.set(b.id, { kind: 'power', nominal: inf.powerOut, output: out, factors, load: this.loadById[b.id] ?? -1 });
      } else bUse[b.id] = buildingPowerUseOriginal(inf, b, jobsUnknown) * pMul;
      if (inf.waterOut > 0) {
        let out = 0, intake = 0;
        const factors: OutputFactorOriginal[] = [];
        if (ok) {
          out = inf.waterOut * eff;
          if (eff < 1) factors.push({ label: 'Utilities funding', mul: eff });
          if (sea === null) sea = seaMask(st);
          const near = waterNear(st, b.x, b.z, b.w, b.d, PUMP_WATER_DIST, sea);
          if (isDesal(inf)) {
            if (!near.sea) { out *= DESAL_INLAND_OUT; factors.push({ label: 'No sea water', mul: DESAL_INLAND_OUT }); }
          } else {
            if (inf.isPump) {
              if (near.fresh) { out *= 1 + PUMP_WATER_BONUS; factors.push({ label: 'Fresh water nearby', mul: 1 + PUMP_WATER_BONUS }); }
              else if (near.sea) { out *= SEA_PUMP_OUT; factors.push({ label: 'Brackish sea water', mul: SEA_PUMP_OUT }); }
            }
            // intake pollution: ground water under the intake or the adjacent water body, whichever is worse
            intake = Math.min(1, intakePollution(st, b, PUMP_WATER_DIST));
            if (intake > 0.001) {
              const m = 1 - PUMP_POLL_LOSS * intake * (hasTreatment ? PUMP_TREATED_LOSS : 1);
              out *= m;
              factors.push({ label: 'Polluted intake', mul: m });
            }
          }
        }
        // treatment plants and desalination deliver clean water; pumps / towers deliver what they draw
        this.intakeById[b.id] = inf.isTreatment || isDesal(inf) ? 0 : intake;
        bWUse[b.id] = -out - 1e-9;
        this.bNeedPow[b.id] = inf.powerUse > 0 ? 1 : 0;
        producers.set(b.id, { kind: 'water', nominal: inf.waterOut, output: out, factors, load: intake });
      } else {
        bWUse[b.id] = buildingWaterUseOriginal(inf, b, jobsUnknown) * wMul;
        this.bNeedPow[b.id] = 0;
      }
    }
    this.nPlants = nPlants;
    this.nCrit = nCrit;
    if (nuclearLost > 0 && !this.nuclearOffAnnounced && this.simRef) {
      this.simRef.notify(`Nuclear plant shut down by ordinance (−${Math.round(nuclearLost).toLocaleString('en-US')} MW)`, 'warning', undefined, undefined, 'utilities');
    }
    this.nuclearOffAnnounced = nuclearMul < 0.5;
  }

  // ------------------------------------------------------------------------------------------ power
  /** label conductor components (network cells, power lines, building cells) */
  private labelPower(st: CityState): void {
    const N = st.size, C = st.cells;
    const net = st.network, lines = st.powerLines, bld = st.building;
    const comp = this.pComp, queue = this.queue;
    comp.fill(-1);
    let nc = 0;
    for (let s = 0; s < C; s++) {
      if (comp[s] >= 0) continue;
      if (net[s] === 0 && lines[s] === 0 && bld[s] < 0) continue;
      let qh = 0, qt = 0;
      queue[qt++] = s;
      comp[s] = nc;
      while (qh < qt) {
        const i = queue[qh++];
        const x = i % N;
        let j = i - 1;
        if (x > 0 && comp[j] < 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0)) { comp[j] = nc; queue[qt++] = j; }
        j = i + 1;
        if (x < N - 1 && comp[j] < 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0)) { comp[j] = nc; queue[qt++] = j; }
        j = i - N;
        if (j >= 0 && comp[j] < 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0)) { comp[j] = nc; queue[qt++] = j; }
        j = i + N;
        if (j < C && comp[j] < 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0)) { comp[j] = nc; queue[qt++] = j; }
      }
      nc++;
    }
    this.nPComp = nc;
    if (nc > this.cSupply.length) this.growPower(nc);
  }

  /**
   * Incremental label update for growables added / removed since the last pass (no full BFS): a new building joins
   * the component of its neighbours; removed buildings' cells stop conducting (a possible split is picked up by the
   * next full pass, at most UTIL_FULL_DAYS later). Returns false when a new building bridges two components (the
   * caller relabels everything in the next step).
   */
  private patchPower(st: CityState): boolean {
    const N = st.size;
    const net = st.network, lines = st.powerLines, bld = st.building;
    const comp = this.pComp;
    for (const b of this.removed) {
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        if (bld[i] < 0 && net[i] === 0 && lines[i] === 0) comp[i] = -1;
      }
    }
    for (const b of this.added) {
      if (!st.buildings.has(b.id)) continue;
      let c0 = -1, multi = false;
      for (let z = b.z - 1; z <= b.z + b.d && !multi; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const inside = x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d;
        const corner = (x < b.x || x >= b.x + b.w) && (z < b.z || z >= b.z + b.d);
        if (inside || corner) continue;
        const c = comp[z * N + x];
        if (c < 0) continue;
        if (c0 < 0) c0 = c;
        else if (c !== c0) { multi = true; break; }
      }
      if (multi) return false;
      if (c0 < 0) {
        c0 = this.nPComp++;
        if (this.nPComp > this.cSupply.length) this.growPower(this.nPComp);
      }
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        if (bld[i] === b.id) comp[i] = c0;
      }
    }
    return true;
  }

  /**
   * Power step 1: per-component supply / demand, plant loads, stats. No short grid: powered cells and building results
   * right away (returns false). A short grid: critical loads (health, police, fire, water producers) reserve their
   * share first and the distance-ordered BFS runs in the brownout step (returns true).
   */
  private powerSums(st: CityState): boolean {
    const N = st.size;
    const comp = this.pComp;
    const nc = this.nPComp;
    const bUse = this.bUse;
    const cSupply = this.cSupply, cDemand = this.cDemand, cLeft = this.cLeft;
    const list = buildingList(st);
    cSupply.fill(0, 0, nc);
    cDemand.fill(0, 0, nc);
    let supplyTot = 0, demandTot = 0;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const c = comp[b.z * N + b.x];
      if (c < 0) continue;
      const u = bUse[b.id];
      if (u < 0) { cSupply[c] -= u; supplyTot -= u; }
      else { cDemand[c] += u; demandTot += u; }
    }
    const okComp = this.okComp.length >= nc ? this.okComp : (this.okComp = new Uint8Array(nc * 2 + 16));
    let anyShort = false;
    for (let c = 0; c < nc; c++) {
      cLeft[c] = cSupply[c];
      const sup = cSupply[c] > 0;
      okComp[c] = sup && cDemand[c] <= cSupply[c] ? 1 : 0;
      if (sup && cDemand[c] > cSupply[c]) anyShort = true;
    }
    // plant load (share of the component's supply in use): pollution activity, WP2 plant stigma, inspector; a plant
    // delivering nothing (shut down by ordinance, burnt) has load 0
    const loadById = this.loadById, plants = this.plantIds, producers = this.producers;
    for (let q = 0; q < this.nPlants; q++) {
      const id = plants[q];
      const b = st.buildings.get(id);
      if (!b) continue;
      const c = comp[b.z * N + b.x];
      const sup = c >= 0 ? cSupply[c] : 0;
      const load = bUse[id] < 0 && sup > 0 ? Math.min(1, cDemand[c] / sup) : 0;
      loadById[id] = load;
      const pi = producers.get(id);
      if (pi) pi.load = load;
    }
    st.stats.powerSupply = supplyTot;
    st.stats.powerDemand = demandTot;
    const stampNo = (this.powerStamp = ++this.stamp);
    if (!anyShort) {
      this.powerResults(st, false);
      return false;
    }
    // brownout: critical loads are served first (in their short component, while its supply lasts)
    const served = this.bOk, crit = this.critIds;
    for (let q = 0; q < this.nCrit; q++) {
      const id = crit[q];
      const u = bUse[id];
      if (!(u > 0)) continue;
      const b = st.buildings.get(id);
      if (!b) continue;
      const c = comp[b.z * N + b.x];
      if (c < 0 || !(cDemand[c] > cSupply[c])) continue;
      if (cLeft[c] >= u) { cLeft[c] -= u; served[id] = stampNo; }
    }
    return true;
  }

  /**
   * Power step 2 (only when a component is short): multi-source BFS from the plants of short components serves
   * consumers in distance order; once the supply is exhausted every farther consumer loses power.
   */
  private powerBrownout(st: CityState): void {
    const N = st.size, C = st.cells;
    const bld = st.building;
    const comp = this.pComp, queue = this.queue, visit = this.visit;
    const bUse = this.bUse, served = this.bOk, stampNo = this.powerStamp;
    const cSupply = this.cSupply, cDemand = this.cDemand, cLeft = this.cLeft;
    const nc = this.nPComp;
    const powered = st.powered, okComp = this.okComp;
    for (let i = 0; i < C; i++) {
      const c = comp[i];
      powered[i] = c >= 0 ? okComp[c] : 0;
    }
    let qh = 0, qt = 0;
    const plants = this.plantIds;
    for (let q = 0; q < this.nPlants; q++) {
      const id = plants[q];
      if (!(bUse[id] < 0)) continue; // delivers nothing: not a source
      const b = st.buildings.get(id);
      if (!b) continue;
      const c = comp[b.z * N + b.x];
      if (c < 0 || !(cDemand[c] > cSupply[c])) continue;
      for (let z: number = b.z; z < b.z + b.d; z++) for (let x: number = b.x; x < b.x + b.w; x++) {
        const i = z * N + x;
        if (visit[i] === stampNo || comp[i] !== c) continue;
        visit[i] = stampNo;
        queue[qt++] = i;
      }
    }
    if (this.exhaustedP.length < nc) this.exhaustedP = new Uint8Array(nc * 2 + 16);
    const exhausted = this.exhaustedP;
    exhausted.fill(0, 0, nc);
    while (qh < qt) {
      const i = queue[qh++];
      const c = comp[i];
      const bid = bld[i];
      if (bid >= 0) {
        const sv = served[bid];
        if (sv !== stampNo && sv !== -stampNo) {
          const u = bUse[bid];
          if (u < 0) served[bid] = stampNo; // plant
          else if (exhausted[c] === 0 && cLeft[c] >= u) { cLeft[c] -= u; served[bid] = stampNo; }
          else { exhausted[c] = 1; served[bid] = -stampNo; }
        }
      }
      powered[i] = exhausted[c] ? 0 : 1;
      // neighbours in DX / DZ order (+x, +z, -x, -z), same component
      const x = i % N;
      let j = i + 1;
      if (x < N - 1 && visit[j] !== stampNo && comp[j] === c) { visit[j] = stampNo; queue[qt++] = j; }
      j = i + N;
      if (j < C && visit[j] !== stampNo && comp[j] === c) { visit[j] = stampNo; queue[qt++] = j; }
      j = i - 1;
      if (x > 0 && visit[j] !== stampNo && comp[j] === c) { visit[j] = stampNo; queue[qt++] = j; }
      j = i - N;
      if (j >= 0 && visit[j] !== stampNo && comp[j] === c) { visit[j] = stampNo; queue[qt++] = j; }
    }
    this.powerResults(st, true);
  }

  /** building results (bPow + footprint cells) and powered empty zoned cells; `brownout`: cells already written */
  private powerResults(st: CityState, brownout: boolean): void {
    const N = st.size, C = st.cells;
    const bld = st.building, zone = st.zone;
    const comp = this.pComp, powered = st.powered;
    const cSupply = this.cSupply, cDemand = this.cDemand;
    const served = this.bOk, stampNo = this.powerStamp;
    if (!brownout) {
      const okComp = this.okComp;
      for (let i = 0; i < C; i++) {
        const c = comp[i];
        powered[i] = c >= 0 ? okComp[c] : 0;
      }
    }
    const result = this.bPow;
    const list = buildingList(st);
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const c = comp[b.z * N + b.x];
      let on = false;
      if (c >= 0 && cSupply[c] > 0) on = cDemand[c] <= cSupply[c] ? true : served[b.id] === stampNo;
      const v = on ? 1 : 0;
      result[b.id] = v;
      if (b.w * b.d === 1) { powered[b.z * N + b.x] = v; continue; }
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        const i = z * N + x;
        if (bld[i] === b.id) powered[i] = v;
      }
    }
    // empty zoned cells adjacent to a powered conductor
    for (let i = 0; i < C; i++) {
      if (zone[i] === 0 || comp[i] >= 0) continue;
      const x = i % N;
      powered[i] = (x > 0 && powered[i - 1] === 1 && comp[i - 1] >= 0) || (x < N - 1 && powered[i + 1] === 1 && comp[i + 1] >= 0) ||
        (i >= N && powered[i - N] === 1 && comp[i - N] >= 0) || (i + N < C && powered[i + N] === 1 && comp[i + N] >= 0) ? 1 : 0;
    }
  }

  private growPower(n: number): void {
    const size = Math.max(n + 64, this.cSupply.length * 2);
    const g = (a: Float64Array) => { const b = new Float64Array(size); b.set(a); return b; };
    this.cSupply = g(this.cSupply);
    this.cDemand = g(this.cDemand);
    this.cLeft = g(this.cLeft);
  }
  private growWater(n: number): void {
    const size = Math.max(n + 64, this.wSupply.length * 2);
    const g = (a: Float64Array) => { const b = new Float64Array(size); b.set(a); return b; };
    this.wSupply = g(this.wSupply);
    this.wDemand = g(this.wDemand);
    this.wLeft = g(this.wLeft);
  }

  // ------------------------------------------------------------------------------------------ water
  /** road-connected components (pipes run under every road) */
  private labelWater(st: CityState): void {
    const N = st.size, C = st.cells;
    const net = st.network;
    const comp = this.wComp, queue = this.queue;
    comp.fill(-1);
    let nc = 0;
    for (let s = 0; s < C; s++) {
      if (comp[s] >= 0 || net[s] < 1 || net[s] > 5) continue;
      let qh = 0, qt = 0;
      queue[qt++] = s;
      comp[s] = nc;
      while (qh < qt) {
        const i = queue[qh++];
        const x = i % N;
        let j = i - 1;
        if (x > 0 && comp[j] < 0 && net[j] >= 1 && net[j] <= 5) { comp[j] = nc; queue[qt++] = j; }
        j = i + 1;
        if (x < N - 1 && comp[j] < 0 && net[j] >= 1 && net[j] <= 5) { comp[j] = nc; queue[qt++] = j; }
        j = i - N;
        if (j >= 0 && comp[j] < 0 && net[j] >= 1 && net[j] <= 5) { comp[j] = nc; queue[qt++] = j; }
        j = i + N;
        if (j < C && comp[j] < 0 && net[j] >= 1 && net[j] <= 5) { comp[j] = nc; queue[qt++] = j; }
      }
      nc++;
    }
    this.nWComp = nc;
    if (nc > this.wSupply.length) this.growWater(nc);
  }

  /**
   * Water step 1: per-network supply (pumps / treatment plants need power) and demand, intake pollution, tap quality.
   * No short network: results right away (returns false). A short network: the brownout step serves buildings in
   * road distance order from the producers (returns true).
   */
  private waterSums(st: CityState): boolean {
    const N = st.size;
    const comp = this.wComp;
    const nc = this.nWComp;
    const wSupply = this.wSupply, wDemand = this.wDemand, wLeft = this.wLeft;
    wSupply.fill(0, 0, nc);
    wDemand.fill(0, 0, nc);
    if (this.wPoll.length < nc) { this.wPoll = new Float64Array(nc * 2 + 16); this.wQual = new Float32Array(nc * 2 + 16); }
    const wPoll = this.wPoll;
    wPoll.fill(0, 0, nc);
    const bComp = this.bWComp; // per-building component (+1), 0 = none
    const bUse = this.bWUse, bNeedPow = this.bNeedPow, bPow = this.bPow, intake = this.intakeById;
    const list = buildingList(st);
    let supplyTot = 0, demandTot = 0, nSeeds = 0;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const c = adjacentComp(comp, N, b);
      bComp[b.id] = c + 1;
      if (c < 0) continue;
      const u = bUse[b.id];
      if (u < 0) {
        // pumps / treatment plants need power to run
        const out = bNeedPow[b.id] && !bPow[b.id] ? 0 : -u - 1e-9;
        wSupply[c] += out;
        wPoll[c] += out * intake[b.id];
        supplyTot += out;
        if (out > 0) this.wSeedIds = pushId(this.wSeedIds, nSeeds++, b.id);
      } else {
        wDemand[c] += u;
        demandTot += u;
      }
    }
    this.nWSeeds = nSeeds;
    const okW = this.okW.length >= nc ? this.okW : (this.okW = new Uint8Array(nc * 2 + 16));
    let anyShort = false;
    for (let c = 0; c < nc; c++) {
      wLeft[c] = wSupply[c];
      const sup = wSupply[c] > 0;
      okW[c] = sup && wDemand[c] <= wSupply[c] ? 1 : 0;
      if (sup && wDemand[c] > wSupply[c]) anyShort = true;
    }
    st.stats.waterSupply = supplyTot;
    st.stats.waterDemand = demandTot;
    this.waterStamp = ++this.stamp;
    this.tapQuality(st);
    if (!anyShort) {
      this.waterResults(st, false);
      return false;
    }
    return true;
  }

  /** Water step 2 (only when a network is short): BFS over the pipes from the producers, nearest buildings first */
  private waterBrownout(st: CityState): void {
    const N = st.size, C = st.cells;
    const bld = st.building;
    const comp = this.wComp, queue = this.queue, visit = this.visit;
    const watered = st.watered, okW = this.okW;
    const nc = this.nWComp;
    const bComp = this.bWComp, bUse = this.bWUse, served = this.bOk, stamp = this.waterStamp;
    const wSupply = this.wSupply, wDemand = this.wDemand, wLeft = this.wLeft;
    for (let i = 0; i < C; i++) {
      const c = comp[i];
      watered[i] = c >= 0 ? okW[c] : 0;
    }
    if (this.exhaustedW.length < nc) this.exhaustedW = new Uint8Array(nc * 2 + 16);
    const exhausted = this.exhaustedW;
    exhausted.fill(0, 0, nc);
    let qh = 0, qt = 0;
    const seeds = this.wSeedIds;
    for (let q = 0; q < this.nWSeeds; q++) {
      const id = seeds[q];
      const b = st.buildings.get(id);
      if (!b) continue;
      const c = bComp[id] - 1;
      if (c < 0 || !(wDemand[c] > wSupply[c])) continue;
      for (const i of perimeterRoadCells(st, comp, b)) if (visit[i] !== stamp) { visit[i] = stamp; queue[qt++] = i; }
    }
    while (qh < qt) {
      const i = queue[qh++];
      const c = comp[i];
      watered[i] = exhausted[c] ? 0 : 1;
      const x = i % N;
      // neighbours in DX / DZ order (+x, +z, -x, -z): serve adjacent buildings of this network, continue along pipes
      for (let k = 0; k < 4; k++) {
        let j: number;
        if (k === 0) { if (x >= N - 1) continue; j = i + 1; }
        else if (k === 1) { j = i + N; if (j >= C) continue; }
        else if (k === 2) { if (x === 0) continue; j = i - 1; }
        else { j = i - N; if (j < 0) continue; }
        const bid = bld[j];
        if (bid >= 0) {
          const sv = served[bid];
          if (sv !== stamp && sv !== -stamp && bComp[bid] - 1 === c) {
            const u = bUse[bid];
            if (u < 0) served[bid] = stamp;
            else if (exhausted[c] === 0 && wLeft[c] >= u) { wLeft[c] -= u; served[bid] = stamp; }
            else { exhausted[c] = 1; served[bid] = -stamp; }
          }
        }
        if (visit[j] === stamp || comp[j] !== c) continue;
        visit[j] = stamp;
        queue[qt++] = j;
      }
    }
    this.waterResults(st, true);
  }

  /** building results (bWat + footprint cells) and watered empty zoned cells; `brownout`: road cells already written */
  private waterResults(st: CityState, brownout: boolean): void {
    const N = st.size, C = st.cells;
    const zone = st.zone, bld = st.building;
    const comp = this.wComp, watered = st.watered;
    const bComp = this.bWComp, served = this.bOk, stamp = this.waterStamp;
    const wSupply = this.wSupply, wDemand = this.wDemand;
    if (!brownout) {
      const okW = this.okW;
      for (let i = 0; i < C; i++) {
        const c = comp[i];
        watered[i] = c >= 0 ? okW[c] : 0;
      }
    }
    const result = this.bWat;
    const list = buildingList(st);
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const c = bComp[b.id] - 1;
      let on = false;
      if (c >= 0 && wSupply[c] > 0) on = wDemand[c] <= wSupply[c] ? true : served[b.id] === stamp;
      const v = on ? 1 : 0;
      result[b.id] = v;
      if (b.w * b.d === 1) { watered[b.z * N + b.x] = v; continue; }
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        const i = z * N + x;
        if (bld[i] === b.id) watered[i] = v;
      }
    }
    // empty zoned cells within 1 cell of a watered road
    for (let i = 0; i < C; i++) {
      if (zone[i] === 0 || bld[i] >= 0 || comp[i] >= 0) continue;
      const x = i % N;
      watered[i] = (x > 0 && comp[i - 1] >= 0 && watered[i - 1] === 1) || (x < N - 1 && comp[i + 1] >= 0 && watered[i + 1] === 1) ||
        (i >= N && comp[i - N] >= 0 && watered[i - N] === 1) || (i + N < C && comp[i + N] >= 0 && watered[i + N] === 1) ? 1 : 0;
    }
  }

  /** tap water quality per network: supply-weighted intake pollution, cleaned by sewage treatment (pollution pass) */
  private tapQuality(st: CityState): void {
    const nc = this.nWComp;
    const treated = Math.max(0, Math.min(1, st.stats.sewageTreated || 0));
    const clean = 1 - TAP_TREATMENT_CLEAN * treated;
    const wQual = this.wQual, wPoll = this.wPoll, wSupply = this.wSupply, wDemand = this.wDemand;
    let qSum = 0, qW = 0;
    for (let c = 0; c < nc; c++) {
      const sup = wSupply[c];
      const q = sup > 0 ? Math.max(0, Math.min(1, 1 - (wPoll[c] / sup) * clean)) : 1;
      wQual[c] = q;
      const used = Math.min(sup, wDemand[c]);
      if (used > 0) { qSum += used * q; qW += used; }
    }
    st.stats.tapWater = qW > 0 ? qSum / qW : 1;
  }
}

/** a building needs piped water: a growable from stage WATER_REQUIRED_STAGE or on a medium / high density zone (the
 *  rule growth and population apply), a plopped one when its def uses water */
function needsWater(st: CityState, b: Building): boolean {
  const def = getDef(b.def);
  if (!def) return false;
  if (def.category !== 'growable') return (def.waterUse ?? 0) > 0;
  return (def.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(st.zone[b.z * st.size + b.x]) >= 2;
}

function adjacentComp(comp: Int32Array, N: number, b: Building): number {
  const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d;
  for (let x = x0; x < x1; x++) {
    if (x < 0 || x >= N) continue;
    if (z0 > 0) { const c = comp[(z0 - 1) * N + x]; if (c >= 0) return c; }
    if (z1 < N) { const c = comp[z1 * N + x]; if (c >= 0) return c; }
  }
  for (let z = z0; z < z1; z++) {
    if (z < 0 || z >= N) continue;
    if (x0 > 0) { const c = comp[z * N + x0 - 1]; if (c >= 0) return c; }
    if (x1 < N) { const c = comp[z * N + x1]; if (c >= 0) return c; }
  }
  return -1;
}

function perimeterRoadCells(st: CityState, comp: Int32Array, b: Building): number[] {
  const N = st.size;
  const out: number[] = [];
  for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    const inside = x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d;
    const corner = (x < b.x || x >= b.x + b.w) && (z < b.z || z >= b.z + b.d);
    if (inside || corner) continue;
    const i = z * N + x;
    if (comp[i] >= 0) out.push(i);
  }
  return out;
}

/** intake pollution of a water producer: max(ground water at its centre, water bodies within d cells) */
function intakePollution(st: CityState, b: Building, d: number): number {
  const N = st.size, wm = st.water, L = st.waterPollution;
  const cx = Math.min(N - 1, b.x + (b.w >> 1)), cz = Math.min(N - 1, b.z + (b.d >> 1));
  let p = L[cz * N + cx] || 0;
  for (let z = b.z - d; z < b.z + b.d + d; z++) {
    if (z < 0 || z >= N) continue;
    for (let x = b.x - d; x < b.x + b.w + d; x++) {
      if (x < 0 || x >= N) continue;
      const i = z * N + x;
      if (wm[i] && L[i] > p) p = L[i];
    }
  }
  return p;
}

/** height (m) of a building's site above the mean terrain height within WIND_TURBINE_RADIUS cells */
function relativeHeight(st: CityState, b: Building): number {
  const N = st.size, H = st.heights, W = N + 1;
  const cx = Math.min(N, b.x + (b.w >> 1)), cz = Math.min(N, b.z + (b.d >> 1));
  const h = H[cz * W + cx];
  const R = WIND_TURBINE_RADIUS;
  let s = 0, n = 0;
  for (let z = Math.max(0, cz - R); z <= Math.min(N, cz + R); z += 4) for (let x = Math.max(0, cx - R); x <= Math.min(N, cx + R); x += 4) {
    s += H[z * W + x];
    n++;
  }
  return n > 0 ? h - s / n : 0;
}

/**
 * Tap-water quality 0..1 (1 = clean) at a cell: supply-weighted intake quality of the water network component serving
 * it, with treatment applied (SIM_DEPTH_SPEC WP3-5; consumed by WP1-3). Falls back to the city mean stats.tapWater
 * (cells off the network, or no utilities system).
 */
export function waterQualityAtOriginal(sim: Simulation, cell: number): number {
  const u = sim.getSystem<UtilitiesSystemOriginal>('utilities');
  return u ? u.waterQualityAt(sim, cell) : sim.state.stats.tapWater ?? 1;
}

/** plant load 0..1 of a power plant (-1 unknown / no utilities system) */
export function plantLoadOfOriginal(sim: Simulation, id: number): number {
  return sim.getSystem<UtilitiesSystemOriginal>('utilities')?.plantLoad(id) ?? -1;
}
