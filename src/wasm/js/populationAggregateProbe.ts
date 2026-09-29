/**
 * Population aggregate PROBE — the fair, optimised JS arms of the "layout vs language" decision probe (benchmark only;
 * not wired into the sim). The probed code is `populationSystem → aggregate(sim, first)` of commit 24f8609
 * (src/sim/economy/population.ts lines ~250–360: the daily loop over `rt.growables` that sums rt.totals, the coarse
 * population / wealth / count grids, the employment sample (workforce × traffic access) and the demographics sample
 * (cohorts, education, per-wealth / skill / kids grids), then the coarse 3×3 blur and `blurCoarse`). The verbatim
 * original (arm A) is tests/wasm/populationAggregateOriginal.ts; the wasm kernel (arm D) is
 * wasm/sim-kernels/src/popagg.rs via src/wasm/kernels/populationAggregateProbeBind.ts.
 *
 * Arms implemented here (tools/bench/populationAggregateProbe.bench.mjs measures them):
 *   B  aggregateObjects(list, defs, …)  the same loop over Building objects, with a per-id def-index cache (DefIndex:
 *      Int16Array id -> def index -> devType) instead of rt.defOf(b) (a Map-free lookup, no def-string compare, no
 *      BuildingDef property load). Run over objects re-created with one stable shape (recreateStable) = arm B, over
 *      the sim's own objects = arm B0 (the def-index change alone).
 *   E  gatherSoA(list, defs, cw, soa)    Building objects -> struct-of-arrays snapshot (the daily cost if buildings
 *      stay objects). Returns false when a value cannot be represented exactly (then use the object path).
 *   C  aggregateSoA(soa, …)              the loop over the SoA in JS (what a building SoA table gives without wasm).
 *   blurGrids(…)                         the coarse 3×3 blur + blurCoarse + coarseSkill, restructured (interior
 *      blocks unrolled; every block still sums its terms in the JS (dz, dx) order starting from +0).
 *
 * SoA layout (arm C and the wasm kernel read the same arrays): dev u8 (255 = no def / no devType: skipped), blk i32
 * (coarse block by the JS formula), flags i32 (ToInt32(b.flags): the loop only tests bits), pop / capacity / jobs f64,
 * wealth u8, id i32, kids / teens / yad / srs / edu f32 with NaN = undefined. mWf (the population system's
 * DemographicsCache.wf) and traffic.accessById stay arrays read by building id, as today.
 *
 * Every arm is bit-identical to the original for any input the gather accepts (tests/wasm/populationAggregateProbe.test.ts):
 * the same f64 operations in the same order per accumulator, Float32Array grids rounded on every store, `?? COHORT_BASE`
 * substituting the f64 constant, Math.max(0, x), `mWf[id]` = undefined (wk = NaN) outside the array, `accArr[id]` with
 * the JS out-of-range rules. No imports from src/sim: constants come in a PopAggConstants object (see
 * src/wasm/kernels/populationAggregateProbe.ts for the live values).
 */

/** the constants the loop needs (24f8609 values: COARSE 8, WORKFORCE_RATIO 0.55, COHORT_BASE [.13 .07 .1 .55 .15]) */
export interface PopAggConstants {
  COARSE: number;
  WORKFORCE_RATIO: number;
  /** cohort reference shares kids, teens, young adults, adults, seniors */
  COHORT_BASE: readonly number[];
  /** length of the per-dev totals (DEV_TYPE_COUNT = 12) */
  DEV_TYPE_COUNT: number;
  /** residential devs are 0..R_MAX (DevType.R3 = 2) */
  R_MAX: number;
  /** BF.Abandoned | BF.Burnt */
  MASK_SKIP: number;
  /** BF.Constructing */
  MASK_CONSTR: number;
}

/** the Building fields the probe reads */
export interface PopAggBuilding {
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

/** rt.totals members the loop writes (JS arrays / numbers, like EconRuntime.totals) */
export interface PopAggTotals {
  pop: number[];
  resCapAll: number[];
  resCapBuilt: number[];
  jobs: number[];
  jobCapAll: number[];
  jobCapBuilt: number[];
  countByDev: number[];
  abandoned: number;
  constructing: number;
}

/** grids (Float32Array[cw²]) the call writes: raw sums, the blurred rt grids, the demographics grids (demo days) */
export interface PopAggGrids {
  coarsePopRaw: Float32Array;
  coarseWealthRaw: Float32Array;
  coarseCountRaw: Float32Array;
  coarsePop: Float32Array;
  coarseWealth: Float32Array;
  /** population.ts closure grids (zeroed + summed on demo days) */
  popWRaw: Float32Array[];
  skillRaw: Float32Array;
  kidsRaw: Float32Array;
  skillBlur: Float32Array;
  /** rt grids blurred on demo days when rt.coarsePopW[0].length === cw² */
  coarsePopW: Float32Array[];
  coarseKids: Float32Array;
  coarseSkill: Float32Array;
}

/** per-call inputs */
export interface PopAggInput {
  /** rt.cw (coarse grid width) */
  cw: number;
  /** employment sample day (first || st.day % OCC_PERIOD === 0) */
  sample: boolean;
  /** demographics sample day (first || st.day % DEMO_AGG_DAYS === 0) */
  demo: boolean;
  /** DemographicsCache.wf: workforce share by building id (NaN = WORKFORCE_RATIO; outside the array: wk = NaN) */
  mWf: Float32Array;
  /** the traffic system gives worker access (tAcc) */
  tAcc: boolean;
  /** traffic.accessById (by building id; -1 / NaN = not assessed). Absent: workerAccess(id) (JS arms only) */
  accArr?: Float32Array;
  workerAccess?: (id: number) => number;
  /** demographicsData(st).eduMean >= 0 ? eduMean : 0 */
  eduFallback: number;
}

/** the loop's scalar results (population.ts locals) */
export interface PopAggResult {
  W: number;
  accE: number;
  accW: number;
  unW: number;
  eduSum: number;
  eduPop: number;
}

export function newResult(): PopAggResult {
  return { W: 0, accE: 0, accW: 0, unW: 0, eduSum: 0, eduPop: 0 };
}

export function newTotals(devs = 12): PopAggTotals {
  return {
    pop: [0, 0, 0], resCapAll: [0, 0, 0], resCapBuilt: [0, 0, 0], jobs: new Array(devs).fill(0), jobCapAll: new Array(devs).fill(0),
    jobCapBuilt: new Array(devs).fill(0), countByDev: new Array(devs).fill(0), abandoned: 0, constructing: 0,
  };
}

/** grids of cw² cells (optionally allocated by `alloc`, e.g. in wasm memory) */
export function newGrids(cw: number, alloc: (n: number) => Float32Array = (n) => new Float32Array(n)): PopAggGrids {
  const cc = cw * cw;
  return {
    coarsePopRaw: alloc(cc), coarseWealthRaw: alloc(cc), coarseCountRaw: alloc(cc), coarsePop: alloc(cc), coarseWealth: alloc(cc),
    popWRaw: [alloc(cc), alloc(cc), alloc(cc)], skillRaw: alloc(cc), kidsRaw: alloc(cc), skillBlur: alloc(cc),
    coarsePopW: [alloc(cc), alloc(cc), alloc(cc)], coarseKids: alloc(cc), coarseSkill: alloc(cc),
  };
}

/** the original's zeroing of the totals the loop writes (civicJobCap / civicJobs belong to the plopped loop) */
export function resetTotals(t: PopAggTotals): void {
  t.pop[0] = t.pop[1] = t.pop[2] = 0;
  t.resCapAll[0] = t.resCapAll[1] = t.resCapAll[2] = 0;
  t.resCapBuilt[0] = t.resCapBuilt[1] = t.resCapBuilt[2] = 0;
  t.jobs.fill(0); t.jobCapAll.fill(0); t.jobCapBuilt.fill(0); t.countByDev.fill(0);
  t.abandoned = t.constructing = 0;
}

// ------------------------------------------------------------------------------------------------ def index
/** a def as the probe sees it (catalog BuildingDef) */
export interface PopAggDef {
  devType?: number;
}

/** SoA dev code: skip (no def / no devType) */
export const DEV_SKIP = 255;
/** DefIndex.code of a def whose devType the SoA cannot hold (not an integer in [0, DEV_TYPE_COUNT)) */
export const DEV_UNSUPPORTED = 254;
const UNKNOWN = -2;
/** def-index capacity (Int16Array ids) */
const MAX_DEFS = 32767;

/**
 * Per-building-id def index (arm B's replacement for rt.defOf(b)): idx[id] = index of the building's def, or -1 when
 * the loop skips the building (no def, or a def without devType), -2 = not looked up yet; devOf[di] = the def's
 * devType, code[di] = its SoA dev code (DEV_UNSUPPORTED when the SoA cannot hold it). Filled lazily on first sight of an
 * id; a building's def never changes for its id in the sim (redevelopment = remove + add with a new id), so the index
 * never goes stale. Ids outside [0, 2^30) are resolved on every call (exact, slow; never in the sim).
 */
export class DefIndex {
  idx = new Int16Array(0);
  /** per def index (fixed size, never reallocated: loops may hoist these) */
  readonly devOf = new Float64Array(MAX_DEFS);
  readonly code = new Uint8Array(MAX_DEFS);
  readonly defs: string[] = [];
  private map = new Map<string, number>();
  constructor(private readonly resolve: (defId: string) => PopAggDef | undefined, private readonly devCount: number) {}

  /** def index of `b` (-1: the loop skips it: no def / no devType) */
  of(b: PopAggBuilding): number {
    const id = b.id;
    const x = this.idx;
    if (id >= 0 && id < x.length) {
      const d = x[id];
      if (d !== UNKNOWN) return d;
    }
    return this.fill(b);
  }

  private defIndex(defId: string): number {
    let di = this.map.get(defId);
    if (di !== undefined) return di;
    const def = this.resolve(defId);
    if (!def || def.devType === undefined) di = -1;
    else {
      di = this.defs.length;
      if (di >= MAX_DEFS) throw new Error(`DefIndex: more than ${MAX_DEFS} defs`);
      this.defs.push(defId);
      const dt = def.devType;
      this.devOf[di] = dt;
      this.code[di] = dt === (dt | 0) && dt >= 0 && dt < this.devCount && dt < DEV_UNSUPPORTED ? dt : DEV_UNSUPPORTED;
    }
    this.map.set(defId, di);
    return di;
  }

  private fill(b: PopAggBuilding): number {
    const id = b.id;
    const di = this.defIndex(b.def);
    if (!(id >= 0 && id < 0x40000000 && id === Math.floor(id))) return di;
    if (id >= this.idx.length) {
      const n = Math.max(id + 1, this.idx.length * 2, 1024);
      const x = new Int16Array(n).fill(UNKNOWN);
      x.set(this.idx);
      this.idx = x;
    }
    this.idx[id] = di;
    return di;
  }
}

/** arm B's objects: copies of the growables with ONE hidden class (every optional WP1 field declared, undefined
 *  where absent), in list order */
export function recreateStable<T extends PopAggBuilding>(list: readonly T[]): PopAggBuilding[] {
  const out: PopAggBuilding[] = new Array(list.length);
  for (let k = 0; k < list.length; k++) {
    const b = list[k] as T & Record<string, unknown>;
    out[k] = {
      id: b.id, def: b.def, x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, variant: b.variant, pop: b.pop, jobs: b.jobs,
      capacity: b.capacity, wealth: b.wealth, built: b.built, age: b.age, flags: b.flags, baseY: b.baseY, health: b.health,
      unhappy: b.unhappy, kids: b.kids, teens: b.teens, yad: b.yad, srs: b.srs, wf: b.wf, edu: b.edu, hire: b.hire,
    } as PopAggBuilding;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ arm B: objects
/**
 * Arm B / B0: the original loop over Building objects with the def index. Writes t, the raw grids (and on demo days
 * coh + the demographics raw grids), then blurGrids. `coh` keeps its values on non-demo days (like the closure).
 */
export function aggregateObjects(
  list: readonly PopAggBuilding[], defs: DefIndex, c: PopAggConstants, inp: PopAggInput, g: PopAggGrids, t: PopAggTotals,
  coh: Float64Array, out: PopAggResult,
): void {
  resetTotals(t);
  const cw = inp.cw;
  const cpr = g.coarsePopRaw, cwr = g.coarseWealthRaw, ccr = g.coarseCountRaw;
  cpr.fill(0); cwr.fill(0); ccr.fill(0);
  const sample = inp.sample, demo = inp.demo;
  const popWRaw = g.popWRaw, skillRaw = g.skillRaw, kidsRaw = g.kidsRaw;
  if (demo) {
    popWRaw[0].fill(0); popWRaw[1].fill(0); popWRaw[2].fill(0); skillRaw.fill(0); kidsRaw.fill(0);
    coh.fill(0);
  }
  const COARSE = c.COARSE, R_MAX = c.R_MAX, SKIP = c.MASK_SKIP, CONSTR = c.MASK_CONSTR, WR = c.WORKFORCE_RATIO;
  const CB0 = c.COHORT_BASE[0], CB1 = c.COHORT_BASE[1], CB2 = c.COHORT_BASE[2], CB4 = c.COHORT_BASE[4];
  const mWf = inp.mWf, tAcc = inp.tAcc, accArr = inp.accArr, eduFallback = inp.eduFallback;
  const tPop = t.pop, tCapAll = t.resCapAll, tCapBuilt = t.resCapBuilt, tJobs = t.jobs, tJobCapAll = t.jobCapAll,
    tJobCapBuilt = t.jobCapBuilt, tCount = t.countByDev;
  let W = 0, eduSum = 0, eduPop = 0, accE = 0, accW = 0, unW = 0, abandoned = 0, constructingN = 0;
  const devOf = defs.devOf;
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    const di = defs.of(b);
    if (di < 0) continue;
    const dev = devOf[di];
    const blk = (((b.z + (b.d >> 1)) / COARSE) | 0) * cw + (((b.x + (b.w >> 1)) / COARSE) | 0);
    const f = b.flags;
    if (f & SKIP) { abandoned++; continue; }
    tCount[dev]++;
    const constructing = (f & CONSTR) !== 0;
    if (constructing) constructingN++;
    if (dev <= R_MAX) {
      const p = b.pop;
      const cap = b.capacity;
      tPop[dev] += p;
      tCapAll[dev] += cap;
      if (!constructing) tCapBuilt[dev] += cap;
      cpr[blk] += p;
      if (p > 0 && sample) {
        const id = b.id;
        const wv = mWf[id];
        const wk = p * (wv === wv ? wv : WR);
        W += wk;
        if (tAcc) {
          const a = accArr ? (id < accArr.length ? accArr[id] : -1) : inp.workerAccess!(id);
          if (a >= 0) { accE += wk * (a < 1 ? a : 1); accW += wk; } else unW += wk;
        }
      }
      if (p > 0 && demo) {
        const k0 = b.kids ?? CB0, k1 = b.teens ?? CB1, k2 = b.yad ?? CB2, k4 = b.srs ?? CB4;
        const x3 = 1 - k0 - k1 - k2 - k4;
        const k3 = x3 > 0 || x3 !== x3 ? x3 : 0; // Math.max(0, x3)
        const o = dev * 5;
        coh[o] += p * k0; coh[o + 1] += p * k1; coh[o + 2] += p * k2; coh[o + 3] += p * k3; coh[o + 4] += p * k4;
        const e = b.edu;
        if (e !== undefined) { eduSum += p * e; eduPop += p; }
        popWRaw[dev][blk] += p;
        skillRaw[blk] += p * (e ?? eduFallback);
        kidsRaw[blk] += p * k0;
      }
    } else {
      const cap = b.capacity;
      tJobs[dev] += b.jobs;
      tJobCapAll[dev] += cap;
      if (!constructing) tJobCapBuilt[dev] += cap;
    }
    cwr[blk] += b.wealth - 2;
    ccr[blk]++;
  }
  t.abandoned = abandoned;
  t.constructing = constructingN;
  out.W = W; out.accE = accE; out.accW = accW; out.unW = unW; out.eduSum = eduSum; out.eduPop = eduPop;
  blurGrids(g, cw, demo);
}

// ------------------------------------------------------------------------------------------------ SoA
/** struct-of-arrays snapshot of the growables (arm C / the wasm kernel); `alloc` places the arrays (JS heap or wasm) */
export class PopAggSoA {
  n = 0;
  cap = 0;
  dev = new Uint8Array(0);
  blk = new Int32Array(0);
  flags = new Int32Array(0);
  pop = new Float64Array(0);
  capacity = new Float64Array(0);
  jobs = new Float64Array(0);
  wealth = new Uint8Array(0);
  id = new Int32Array(0);
  kids = new Float32Array(0);
  teens = new Float32Array(0);
  yad = new Float32Array(0);
  srs = new Float32Array(0);
  edu = new Float32Array(0);

  constructor(
    private readonly alloc: <T extends ArrayBufferView>(ctor: new (n: number) => T, n: number) => T = (ctor, n) => new ctor(n),
    private readonly release: (a: ArrayBufferView) => void = () => {},
  ) {}

  /** capacity for n buildings (reallocates, contents lost, when it grows: call before filling) */
  ensure(n: number): void {
    if (n <= this.cap) return;
    const cap = Math.max(n, Math.ceil(this.cap * 1.25), 256);
    for (const a of this.arrays()) this.release(a);
    const A = this.alloc;
    this.dev = A(Uint8Array, cap); this.blk = A(Int32Array, cap); this.flags = A(Int32Array, cap);
    this.pop = A(Float64Array, cap); this.capacity = A(Float64Array, cap); this.jobs = A(Float64Array, cap);
    this.wealth = A(Uint8Array, cap); this.id = A(Int32Array, cap);
    this.kids = A(Float32Array, cap); this.teens = A(Float32Array, cap); this.yad = A(Float32Array, cap); this.srs = A(Float32Array, cap);
    this.edu = A(Float32Array, cap);
    this.cap = cap;
  }

  arrays(): ArrayBufferView[] {
    return this.cap === 0 ? [] : [this.dev, this.blk, this.flags, this.pop, this.capacity, this.jobs, this.wealth, this.id, this.kids, this.teens,
      this.yad, this.srs, this.edu];
  }

  dispose(): void {
    for (const a of this.arrays()) this.release(a);
    this.cap = 0;
    this.n = 0;
  }
}

/** gatherSoA column sets: the id column (read on employment-sample days), the cohort / education columns (demo days) */
export const GATHER_ID = 1;
export const GATHER_DEMO = 2;
export const GATHER_ALL = GATHER_ID | GATHER_DEMO;
/** the columns a day needs */
export function gatherNeed(sample: boolean, demo: boolean): number {
  return (sample ? GATHER_ID : 0) | (demo ? GATHER_DEMO : 0);
}

/**
 * Arm E: fill `soa` from the Building objects (list order). `need` selects the optional columns (the loop reads id only
 * on sample days and kids / teens / yad / srs / edu only on demo days; the other columns are always filled). Returns
 * false (soa content undefined) when a value would not survive the SoA exactly: a def whose devType is not an integer
 * in [0, DEV_TYPE_COUNT), a wealth outside u8, a non-int32 id, a pop / capacity / jobs that is not a number, a cohort /
 * education share that is not an f32 number (NaN, null, a value Math.fround changes). The sim writes f32 shares
 * (Math.fround) and integer ids / wealth, so this never fails on a real city; the caller then runs the object path.
 */
export function gatherSoA(list: readonly PopAggBuilding[], defs: DefIndex, c: PopAggConstants, cw: number, soa: PopAggSoA, need = GATHER_ALL): boolean {
  const n = list.length;
  soa.ensure(n);
  soa.n = n;
  const D = soa.dev, BLK = soa.blk, FL = soa.flags, P = soa.pop, CAP = soa.capacity, J = soa.jobs, WE = soa.wealth, ID = soa.id;
  const K0 = soa.kids, K1 = soa.teens, K2 = soa.yad, K4 = soa.srs, ED = soa.edu;
  const code = defs.code;
  const COARSE = c.COARSE;
  const needId = (need & GATHER_ID) !== 0, needDemo = (need & GATHER_DEMO) !== 0;
  let ok = true;
  for (let k = 0; k < n; k++) {
    const b = list[k];
    const di = defs.of(b);
    const dc = di < 0 ? DEV_SKIP : code[di];
    D[k] = dc;
    if (dc === DEV_SKIP) continue;
    if (dc === DEV_UNSUPPORTED) { ok = false; continue; }
    BLK[k] = (((b.z + (b.d >> 1)) / COARSE) | 0) * cw + (((b.x + (b.w >> 1)) / COARSE) | 0);
    FL[k] = b.flags;
    const p = b.pop, cp = b.capacity, jb = b.jobs, w = b.wealth;
    P[k] = p; CAP[k] = cp; J[k] = jb; WE[k] = w;
    // (NaN is fine in the f64 columns: it behaves the same in every use)
    if ((P[k] !== p && p === p) || (CAP[k] !== cp && cp === cp) || (J[k] !== jb && jb === jb) || WE[k] !== w) ok = false;
    if (needId) { const id = b.id; ID[k] = id; if (ID[k] !== id) ok = false; }
    if (needDemo) {
      const k0 = b.kids, k1 = b.teens, k2 = b.yad, k4 = b.srs, e = b.edu;
      if (k0 === undefined) K0[k] = NaN; else { K0[k] = k0; if (K0[k] !== k0) ok = false; }
      if (k1 === undefined) K1[k] = NaN; else { K1[k] = k1; if (K1[k] !== k1) ok = false; }
      if (k2 === undefined) K2[k] = NaN; else { K2[k] = k2; if (K2[k] !== k2) ok = false; }
      if (k4 === undefined) K4[k] = NaN; else { K4[k] = k4; if (K4[k] !== k4) ok = false; }
      if (e === undefined) ED[k] = NaN; else { ED[k] = e; if (ED[k] !== e) ok = false; }
    }
  }
  return ok;
}

/** Arm C: the loop over the SoA (JS), then blurGrids. Same outputs as aggregateObjects. */
export function aggregateSoA(soa: PopAggSoA, c: PopAggConstants, inp: PopAggInput, g: PopAggGrids, t: PopAggTotals, coh: Float64Array, out: PopAggResult): void {
  resetTotals(t);
  const cw = inp.cw;
  const cpr = g.coarsePopRaw, cwr = g.coarseWealthRaw, ccr = g.coarseCountRaw;
  cpr.fill(0); cwr.fill(0); ccr.fill(0);
  const sample = inp.sample, demo = inp.demo;
  const popWRaw = g.popWRaw, skillRaw = g.skillRaw, kidsRaw = g.kidsRaw;
  if (demo) {
    popWRaw[0].fill(0); popWRaw[1].fill(0); popWRaw[2].fill(0); skillRaw.fill(0); kidsRaw.fill(0);
    coh.fill(0);
  }
  const R_MAX = c.R_MAX, SKIP = c.MASK_SKIP, CONSTR = c.MASK_CONSTR, WR = c.WORKFORCE_RATIO;
  const CB0 = c.COHORT_BASE[0], CB1 = c.COHORT_BASE[1], CB2 = c.COHORT_BASE[2], CB4 = c.COHORT_BASE[4];
  const mWf = inp.mWf, tAcc = inp.tAcc, accArr = inp.accArr, eduFallback = inp.eduFallback;
  const D = soa.dev, BLK = soa.blk, FL = soa.flags, P = soa.pop, CAP = soa.capacity, J = soa.jobs, WE = soa.wealth, ID = soa.id;
  const K0 = soa.kids, K1 = soa.teens, K2 = soa.yad, K4 = soa.srs, ED = soa.edu;
  const tPop = t.pop, tCapAll = t.resCapAll, tCapBuilt = t.resCapBuilt, tJobs = t.jobs, tJobCapAll = t.jobCapAll,
    tJobCapBuilt = t.jobCapBuilt, tCount = t.countByDev;
  let W = 0, eduSum = 0, eduPop = 0, accE = 0, accW = 0, unW = 0, abandoned = 0, constructingN = 0;
  const n = soa.n;
  for (let k = 0; k < n; k++) {
    const dev = D[k];
    if (dev === DEV_SKIP) continue;
    const blk = BLK[k];
    const f = FL[k];
    if (f & SKIP) { abandoned++; continue; }
    tCount[dev]++;
    const constructing = (f & CONSTR) !== 0;
    if (constructing) constructingN++;
    if (dev <= R_MAX) {
      const p = P[k];
      const cap = CAP[k];
      tPop[dev] += p;
      tCapAll[dev] += cap;
      if (!constructing) tCapBuilt[dev] += cap;
      cpr[blk] += p;
      if (p > 0 && sample) {
        const id = ID[k];
        const wv = mWf[id];
        const wk = p * (wv === wv ? wv : WR);
        W += wk;
        if (tAcc) {
          const a = accArr ? (id < accArr.length ? accArr[id] : -1) : inp.workerAccess!(id);
          if (a >= 0) { accE += wk * (a < 1 ? a : 1); accW += wk; } else unW += wk;
        }
      }
      if (p > 0 && demo) {
        let k0 = K0[k], k1 = K1[k], k2 = K2[k], k4 = K4[k];
        if (k0 !== k0) k0 = CB0;
        if (k1 !== k1) k1 = CB1;
        if (k2 !== k2) k2 = CB2;
        if (k4 !== k4) k4 = CB4;
        const x3 = 1 - k0 - k1 - k2 - k4;
        const k3 = x3 > 0 || x3 !== x3 ? x3 : 0; // Math.max(0, x3)
        const o = dev * 5;
        coh[o] += p * k0; coh[o + 1] += p * k1; coh[o + 2] += p * k2; coh[o + 3] += p * k3; coh[o + 4] += p * k4;
        const e = ED[k];
        if (e === e) { eduSum += p * e; eduPop += p; }
        popWRaw[dev][blk] += p;
        skillRaw[blk] += p * (e === e ? e : eduFallback);
        kidsRaw[blk] += p * k0;
      }
    } else {
      const cap = CAP[k];
      tJobs[dev] += J[k];
      tJobCapAll[dev] += cap;
      if (!constructing) tJobCapBuilt[dev] += cap;
    }
    cwr[blk] += WE[k] - 2;
    ccr[blk]++;
  }
  t.abandoned = abandoned;
  t.constructing = constructingN;
  out.W = W; out.accE = accE; out.accW = accW; out.unW = unW; out.eduSum = eduSum; out.eduPop = eduPop;
  blurGrids(g, cw, demo);
}

// ------------------------------------------------------------------------------------------------ blurs
/**
 * population.ts "blur coarse grids (3×3)" (coarsePop, coarseWealth = sc > 0 ? sw / sc : 0) and, on demo days when
 * coarsePopW[0].length === cw², blurCoarse of popWRaw[0..3] / kidsRaw / skillRaw and coarseSkill. Interior blocks are
 * unrolled; each block's sum is 0 + t(−1,−1) + t(0,−1) + … in the JS (dz, dx) order (terms × 1 / 0.5 are exact).
 */
export function blurGrids(g: PopAggGrids, cw: number, demo: boolean): void {
  const pr = g.coarsePopRaw, wr = g.coarseWealthRaw, cr = g.coarseCountRaw, cpop = g.coarsePop, cwe = g.coarseWealth;
  for (let bz = 0; bz < cw; bz++) {
    const up = bz > 0, dn = bz < cw - 1;
    const r0 = (bz - 1) * cw, r1 = bz * cw, r2 = (bz + 1) * cw;
    for (let bx = 0; bx < cw; bx++) {
      let sp = 0, sw = 0, sc = 0;
      if (bx > 0 && bx < cw - 1 && up && dn) {
        const a = r0 + bx, m = r1 + bx, z = r2 + bx;
        sp += pr[a - 1] * 0.5; sp += pr[a] * 0.5; sp += pr[a + 1] * 0.5; sp += pr[m - 1] * 0.5; sp += pr[m]; sp += pr[m + 1] * 0.5;
        sp += pr[z - 1] * 0.5; sp += pr[z] * 0.5; sp += pr[z + 1] * 0.5;
        sw += wr[a - 1] * 0.5; sw += wr[a] * 0.5; sw += wr[a + 1] * 0.5; sw += wr[m - 1] * 0.5; sw += wr[m]; sw += wr[m + 1] * 0.5;
        sw += wr[z - 1] * 0.5; sw += wr[z] * 0.5; sw += wr[z + 1] * 0.5;
        sc += cr[a - 1] * 0.5; sc += cr[a] * 0.5; sc += cr[a + 1] * 0.5; sc += cr[m - 1] * 0.5; sc += cr[m]; sc += cr[m + 1] * 0.5;
        sc += cr[z - 1] * 0.5; sc += cr[z] * 0.5; sc += cr[z + 1] * 0.5;
      } else {
        for (let dz = -1; dz <= 1; dz++) {
          const z = bz + dz;
          if (z < 0 || z >= cw) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const x = bx + dx;
            if (x < 0 || x >= cw) continue;
            const b = z * cw + x;
            const wgt = dx === 0 && dz === 0 ? 1 : 0.5;
            sp += pr[b] * wgt; sw += wr[b] * wgt; sc += cr[b] * wgt;
          }
        }
      }
      cpop[r1 + bx] = sp;
      cwe[r1 + bx] = sc > 0 ? sw / sc : 0;
    }
  }
  const cc = cw * cw;
  if (demo && g.coarsePopW[0].length === cc) {
    for (let w = 0; w < 3; w++) blurCoarseFast(g.popWRaw[w], g.coarsePopW[w], cw);
    blurCoarseFast(g.kidsRaw, g.coarseKids, cw);
    blurCoarseFast(g.skillRaw, g.skillBlur, cw);
    const cs = g.coarseSkill, sb = g.skillBlur;
    for (let q = 0; q < cc; q++) cs[q] = cpop[q] > 0 ? sb[q] / cpop[q] : 0;
  }
}

/** blurCoarse (3×3, centre 1, neighbours 0.5) with the interior unrolled */
export function blurCoarseFast(raw: Float32Array, out: Float32Array, cw: number): void {
  for (let bz = 0; bz < cw; bz++) {
    const up = bz > 0, dn = bz < cw - 1;
    const r0 = (bz - 1) * cw, r1 = bz * cw, r2 = (bz + 1) * cw;
    for (let bx = 0; bx < cw; bx++) {
      let s = 0;
      if (bx > 0 && bx < cw - 1 && up && dn) {
        const a = r0 + bx, m = r1 + bx, z = r2 + bx;
        s += raw[a - 1] * 0.5; s += raw[a] * 0.5; s += raw[a + 1] * 0.5; s += raw[m - 1] * 0.5; s += raw[m]; s += raw[m + 1] * 0.5;
        s += raw[z - 1] * 0.5; s += raw[z] * 0.5; s += raw[z + 1] * 0.5;
      } else {
        for (let dz = -1; dz <= 1; dz++) {
          const z = bz + dz;
          if (z < 0 || z >= cw) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const x = bx + dx;
            if (x < 0 || x >= cw) continue;
            s += raw[z * cw + x] * (dx === 0 && dz === 0 ? 1 : 0.5);
          }
        }
      }
      out[r1 + bx] = s;
    }
  }
}
