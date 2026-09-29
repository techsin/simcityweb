/**
 * FROZEN ORIGINAL (arm A of the population aggregate probe): `populationSystem → aggregate(sim, first)` of
 * src/sim/economy/population.ts at commit 24f8609 (the frozen copy in the profiler's snapshot; WP6a owns the live file),
 * lines 246–360 VERBATIM — the zeroing, the growables loop, the coarse 3×3 blur and the demographics blurCoarse — with
 * the closure state of populationSystem (coh, popWRaw, skillRaw, kidsRaw, skillBlur, cache) kept as closure state here.
 * Left out, identical JS in every arm and outside the probed kernel: the plopped (civic jobs) loop, `t.growables` /
 * `t.population`, and the O(1) employment / demographics / stats tail (lines 361–422). The constants and the two helpers
 * the lines call (infraFlags, demographicsData) are frozen copies too, so a change of the live sim cannot change arm A.
 *
 * Used by tests/wasm/populationAggregateProbe.test.ts and tools/bench/populationAggregateProbe/* (over the sim's real
 * EconRuntime / DemographicsCache / traffic system, or over test doubles with the same members).
 */

// ------------------------------------------------------------------------------------------------ frozen constants
/** CityState.ts BF (the bits the lines use) */
const BF = { Abandoned: 1 << 2, Burnt: 1 << 4, Constructing: 1 << 7 } as const;
/** core/types.ts DevType (the member the lines use) */
const DevType = { R3: 2 } as const;
/** economy/tuning.ts */
const COARSE = 8;
const OCC_PERIOD = 4;
const WORKFORCE_RATIO = 0.55;
const COHORT_BASE: readonly [number, number, number, number, number] = [0.13, 0.07, 0.1, 0.55, 0.15];
/** population.ts */
const DEMO_AGG_DAYS = 8 * OCC_PERIOD;

export const ORIGINAL_CONSTANTS = { BF, DevType, COARSE, OCC_PERIOD, WORKFORCE_RATIO, COHORT_BASE, DEMO_AGG_DAYS, DEV_TYPE_COUNT: 12 } as const;

// ------------------------------------------------------------------------------------------------ structural types
export interface OrigBuilding {
  id: number;
  def: string;
  x: number;
  z: number;
  w: number;
  d: number;
  pop: number;
  jobs: number;
  capacity: number;
  wealth: number;
  flags: number;
  kids?: number;
  teens?: number;
  yad?: number;
  srs?: number;
  edu?: number;
}
export interface OrigDef {
  devType?: number;
}
export interface OrigTotals {
  pop: number[];
  resCapAll: number[];
  resCapBuilt: number[];
  jobs: number[];
  jobCapAll: number[];
  jobCapBuilt: number[];
  countByDev: number[];
  civicJobCap: number;
  civicJobs: number;
  abandoned: number;
  constructing: number;
}
/** the EconRuntime members aggregate() touches */
export interface OrigRuntime {
  growables: OrigBuilding[];
  defOf(b: OrigBuilding): OrigDef | undefined;
  totals: OrigTotals;
  cw: number;
  coarsePopRaw: Float32Array;
  coarseWealthRaw: Float32Array;
  coarseCountRaw: Float32Array;
  coarsePop: Float32Array;
  coarseWealth: Float32Array;
  coarsePopW: Float32Array[];
  coarseSkill: Float32Array;
  coarseKids: Float32Array;
}
/** the DemographicsCache members aggregate() touches */
export interface OrigCache {
  wf: Float32Array;
  ensure(id: number): void;
}
interface TrafficApi {
  workerAccess?: (id: number) => number;
  accessById?: Float32Array;
}
export interface OrigSim {
  state: { day: number; nextBuildingId: number; systemData: Record<string, unknown> };
  getSystem(name: string): unknown;
}
interface InfraFlags {
  any: boolean;
  utilities: boolean;
  traffic: boolean;
  pollution: boolean;
  services: boolean;
}
interface DemographicsData {
  v: number;
  eduMean: number;
  wfRatio: number;
  empRatio: number;
}

// ------------------------------------------------------------------------------------------------ frozen helpers
/** economy/runtime.ts infraFlags @ 24f8609 */
function infraFlags(st: OrigSim['state']): InfraFlags {
  const any = st.systemData.infraVersion !== undefined;
  const layers = st.systemData.infraLayers as Partial<Record<'utilities' | 'traffic' | 'pollution' | 'services', boolean>> | undefined;
  return {
    any,
    utilities: any && (layers?.utilities ?? true),
    traffic: any && (layers?.traffic ?? true),
    pollution: any && (layers?.pollution ?? true),
    services: any && (layers?.services ?? true),
  };
}
/** economy/demographics.ts demographicsData @ 24f8609 */
function demographicsData(st: OrigSim['state']): DemographicsData {
  let d = st.systemData.demographics as DemographicsData | undefined;
  if (!d || d.v !== 1) {
    d = { v: 1, eduMean: -1, wfRatio: WORKFORCE_RATIO, empRatio: -1 };
    st.systemData.demographics = d;
  }
  return d;
}

/** what the lines leave in their locals (the inputs of the tail) */
export interface OrigResult {
  sample: boolean;
  demo: boolean;
  W: number;
  eduSum: number;
  eduPop: number;
  accE: number;
  accW: number;
  unW: number;
}

export interface OriginalAggregate {
  aggregate(sim: OrigSim, first: boolean): OrigResult;
  /** the closure state (for comparisons) */
  readonly coh: Float64Array;
  readonly popWRaw: Float32Array[];
  readonly skillRaw: Float32Array;
  readonly kidsRaw: Float32Array;
  readonly skillBlur: Float32Array;
}

/** populationSystem's closure around aggregate() (rt and the DemographicsCache as the system holds them; `cohArr` =
 *  the system's own coh when the lines run inside a copy of the system) */
export function makeOriginalAggregate(rt: OrigRuntime, cache: OrigCache, cohArr?: Float64Array): OriginalAggregate {
  const coh = cohArr ?? new Float64Array(15);
  let popWRaw: Float32Array[] = [];
  let skillRaw = new Float32Array(0), kidsRaw = new Float32Array(0), skillBlur = new Float32Array(0);
  const res: OrigResult = { sample: false, demo: false, W: 0, eduSum: 0, eduPop: 0, accE: 0, accW: 0, unW: 0 };

  // ------------------------------------------------------------- population.ts @ 24f8609, lines 246–327 + 335–360
  const aggregate = (sim: OrigSim, first: boolean): OrigResult => {
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
    // (lines 328–334: the plopped loop, t.growables, t.population — not part of the probe)
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
    res.sample = sample; res.demo = demo; res.W = W; res.eduSum = eduSum; res.eduPop = eduPop;
    res.accE = accE; res.accW = accW; res.unW = unW;
    return res;
  };

  return {
    aggregate,
    coh,
    get popWRaw() { return popWRaw; },
    get skillRaw() { return skillRaw; },
    get kidsRaw() { return kidsRaw; },
    get skillBlur() { return skillBlur; },
  };
}

/** population.ts @ 24f8609 lines 197–214: 3×3 blur (centre 1, neighbours 0.5) of a coarse grid */
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
