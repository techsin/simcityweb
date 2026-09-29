/**
 * Population aggregate probe — shared core of the benchmarks and the equivalence test (environment-agnostic: node
 * worker, browser Web Worker, vitest; no src/sim imports, so it runs against any tree).
 *
 *   ProbeWorld      what the arms read: a Simulation-like `sim` (state.day / nextBuildingId / systemData,
 *                   getSystem('traffic')), the EconRuntime-like `rt` (growables = Building objects, defOf, totals, coarse
 *                   grids), the population system's DemographicsCache-like `cache` (wf, ensure) and a def resolver.
 *                   Either the real objects of a loaded fixture (tools/bench/populationAggregateProbe/node.ts,
 *                   browser.ts) or rebuilt from a capture (worldFromCapture).
 *   makeArms()      the probe's arms over one world (see ARM_INFO); each arm runs one aggregate call for the current
 *                   sim day and can snapshot its outputs.
 *   checkArms()     every arm bit-exact against arm A (f64 / f32 bit patterns, NaN == NaN) over a sequence of days.
 *   capture codec   encodeCapture / decodeCapture: a world's inputs as a binary file (the real fixtures for the test).
 */
import {
  DefIndex, GATHER_DEMO, GATHER_ID, PopAggSoA, aggregateObjects, aggregateSoA, gatherNeed, gatherSoA, newGrids, newResult, newTotals,
  recreateStable,
  type PopAggBuilding, type PopAggConstants, type PopAggDef, type PopAggGrids, type PopAggInput, type PopAggResult, type PopAggTotals,
} from '../../../src/wasm/js/populationAggregateProbe';
import { makePopAggKernels, type PopAggBindStats, type PopAggSoAFn, type PopAggWasm } from '../../../src/wasm/kernels/populationAggregateProbeBind';
import { WasmHeap, type HeapArrayCtor } from '../../../src/wasm/heap';
import {
  ORIGINAL_CONSTANTS, makeOriginalAggregate, type OrigBuilding, type OrigCache, type OrigRuntime, type OrigSim, type OrigTotals,
} from '../../../tests/wasm/populationAggregateOriginal';

// ------------------------------------------------------------------------------------------------ constants / days
/** the 24f8609 constants of the probed loop */
export const PROBE_CONSTANTS: PopAggConstants = {
  COARSE: ORIGINAL_CONSTANTS.COARSE,
  WORKFORCE_RATIO: ORIGINAL_CONSTANTS.WORKFORCE_RATIO,
  COHORT_BASE: ORIGINAL_CONSTANTS.COHORT_BASE,
  DEV_TYPE_COUNT: ORIGINAL_CONSTANTS.DEV_TYPE_COUNT,
  R_MAX: ORIGINAL_CONSTANTS.DevType.R3,
  MASK_SKIP: ORIGINAL_CONSTANTS.BF.Abandoned | ORIGINAL_CONSTANTS.BF.Burnt,
  MASK_CONSTR: ORIGINAL_CONSTANTS.BF.Constructing,
};
const OCC_PERIOD = ORIGINAL_CONSTANTS.OCC_PERIOD;
const DEMO_AGG_DAYS = ORIGINAL_CONSTANTS.DEMO_AGG_DAYS;

/** plain: no sample; sample: employment sample only (day % 4 == 0); demo: employment + demographics sample (day % 32 == 0) */
export type DayKind = 'plain' | 'sample' | 'demo';
export const DAY_KINDS: DayKind[] = ['plain', 'sample', 'demo'];
/** share of each kind over one 32-day demographics period (24 plain, 7 sample-only, 1 demo) */
export const DAY_WEIGHTS: Record<DayKind, number> = { plain: 24 / 32, sample: 7 / 32, demo: 1 / 32 };

export function kindOf(day: number): DayKind {
  return day % DEMO_AGG_DAYS === 0 ? 'demo' : day % OCC_PERIOD === 0 ? 'sample' : 'plain';
}
/** the first day >= day0 of that kind */
export function dayOfKind(day0: number, kind: DayKind): number {
  let d = day0;
  while (kindOf(d) !== kind) d++;
  return d;
}

// ------------------------------------------------------------------------------------------------ world
export interface TrafficLike {
  workerAccess?: (id: number) => number;
  accessById?: Float32Array;
}
export interface ProbeWorld {
  name: string;
  sim: OrigSim;
  rt: OrigRuntime;
  cache: OrigCache;
  /** catalog lookup of a def id (getDef) */
  resolveDef(id: string): PopAggDef | undefined;
  population: number;
}

/** frozen copies of infraFlags / demographicsData (the per-call inputs every arm derives like the original does) */
function trafficOf(sim: OrigSim): TrafficLike | undefined {
  const sd = sim.state.systemData;
  const any = sd.infraVersion !== undefined;
  const layers = sd.infraLayers as { traffic?: boolean } | undefined;
  return any && (layers?.traffic ?? true) ? (sim.getSystem('traffic') as TrafficLike | undefined) : undefined;
}
function eduMeanOf(sim: OrigSim): number {
  const sd = sim.state.systemData;
  let d = sd.demographics as { v: number; eduMean: number } | undefined;
  if (!d || d.v !== 1) {
    d = { v: 1, eduMean: -1, wfRatio: ORIGINAL_CONSTANTS.WORKFORCE_RATIO, empRatio: -1 } as { v: number; eduMean: number };
    sd.demographics = d;
  }
  return d.eduMean;
}

/**
 * The per-call inputs of the B / C / D arms, derived from the world exactly as the original derives them (first =
 * false): sample / demo from the day, cache.ensure on sample days, the traffic system's access, the education fallback.
 * `resident` replaces mWf / accessById by copies in wasm memory (the architect's memory model).
 */
export class InputDeriver {
  readonly inp: PopAggInput = { cw: 0, sample: false, demo: false, mWf: new Float32Array(0), tAcc: false, accArr: undefined, workerAccess: undefined, eduFallback: 0 };
  private wa: ((id: number) => number) | undefined;
  private waOf: TrafficLike | undefined;
  constructor(private readonly world: ProbeWorld, private readonly resident: { mWf: Float32Array; acc: Float32Array | undefined } | null = null) {}
  derive(): PopAggInput {
    const w = this.world, st = w.sim.state, inp = this.inp;
    inp.cw = w.rt.cw;
    inp.sample = st.day % OCC_PERIOD === 0;
    inp.demo = st.day % DEMO_AGG_DAYS === 0;
    if (inp.sample) w.cache.ensure(st.nextBuildingId);
    const traffic = trafficOf(w.sim);
    const tAcc = typeof traffic?.workerAccess === 'function';
    inp.tAcc = tAcc;
    inp.accArr = tAcc && traffic!.accessById instanceof Float32Array ? traffic!.accessById : undefined;
    if (tAcc && this.waOf !== traffic) { this.waOf = traffic; this.wa = (id) => traffic!.workerAccess!(id); }
    inp.workerAccess = tAcc ? this.wa : undefined;
    inp.mWf = w.cache.wf;
    const em = eduMeanOf(w.sim);
    inp.eduFallback = em >= 0 ? em : 0;
    if (this.resident) {
      inp.mWf = this.resident.mWf;
      if (inp.accArr) inp.accArr = this.resident.acc;
    }
    return inp;
  }
}

// ------------------------------------------------------------------------------------------------ wasm instances
export function instantiate(mod: WebAssembly.Module, reserveBytes = 32 << 20): PopAggWasm {
  const inst = new WebAssembly.Instance(mod, {});
  const ex = inst.exports as unknown as PopAggWasm['ex'] & { __heap_base: WebAssembly.Global };
  if (typeof ex.popagg_aggregate !== 'function') throw new Error('the wasm binary has no popagg_aggregate export (npm run build:wasm)');
  const heap = new WasmHeap(ex.memory, Number(ex.__heap_base.value));
  heap.reserve(reserveBytes);
  return { ex, heap };
}

// ------------------------------------------------------------------------------------------------ snapshots
export interface ProbeSnapshot {
  /** f64 values: totals, results, coh (bit patterns compared) */
  f64: Float64Array;
  /** f32 grids, in GRID_NAMES order */
  grids: Float32Array[];
}
export const GRID_NAMES = ['coarsePopRaw', 'coarseWealthRaw', 'coarseCountRaw', 'coarsePop', 'coarseWealth', 'popWRaw0', 'popWRaw1', 'popWRaw2',
  'skillRaw', 'kidsRaw', 'coarsePopW0', 'coarsePopW1', 'coarsePopW2', 'coarseKids', 'skillBlur', 'coarseSkill'] as const;
export const F64_NAMES: string[] = [
  ...['pop', 'resCapAll', 'resCapBuilt'].flatMap((k) => [0, 1, 2].map((d) => `${k}[${d}]`)),
  ...['jobs', 'jobCapAll', 'jobCapBuilt', 'countByDev'].flatMap((k) => Array.from({ length: 12 }, (_, d) => `${k}[${d}]`)),
  'abandoned', 'constructing', 'W', 'accE', 'accW', 'unW', 'eduSum', 'eduPop', ...Array.from({ length: 15 }, (_, q) => `coh[${q}]`),
];

function snap(t: PopAggTotals | OrigTotals, r: PopAggResult, coh: Float64Array, grids: Float32Array[]): ProbeSnapshot {
  const v: number[] = [...t.pop, ...t.resCapAll, ...t.resCapBuilt];
  for (const a of [t.jobs, t.jobCapAll, t.jobCapBuilt, t.countByDev]) for (let d = 0; d < 12; d++) v.push(a[d]);
  v.push(t.abandoned, t.constructing, r.W, r.accE, r.accW, r.unW, r.eduSum, r.eduPop, ...coh);
  return { f64: Float64Array.from(v), grids: grids.map((g) => g.slice()) };
}
function gridList(g: PopAggGrids): Float32Array[] {
  return [g.coarsePopRaw, g.coarseWealthRaw, g.coarseCountRaw, g.coarsePop, g.coarseWealth, g.popWRaw[0], g.popWRaw[1], g.popWRaw[2], g.skillRaw,
    g.kidsRaw, g.coarsePopW[0], g.coarsePopW[1], g.coarsePopW[2], g.coarseKids, g.skillBlur, g.coarseSkill];
}

/** first difference between two snapshots (null = bit-identical; NaN == NaN, +0 != -0) */
export function diffSnapshots(a: ProbeSnapshot, b: ProbeSnapshot): string | null {
  const ua = new BigUint64Array(a.f64.buffer, a.f64.byteOffset, a.f64.length), ub = new BigUint64Array(b.f64.buffer, b.f64.byteOffset, b.f64.length);
  for (let k = 0; k < a.f64.length; k++) {
    if (ua[k] !== ub[k] && !(a.f64[k] !== a.f64[k] && b.f64[k] !== b.f64[k])) return `${F64_NAMES[k]}: ${a.f64[k]} vs ${b.f64[k]}`;
  }
  for (let g = 0; g < a.grids.length; g++) {
    const x = a.grids[g], y = b.grids[g];
    if (x.length !== y.length) return `${GRID_NAMES[g]}: length ${x.length} vs ${y.length}`;
    const ux = new Uint32Array(x.buffer, x.byteOffset, x.length), uy = new Uint32Array(y.buffer, y.byteOffset, y.length);
    for (let i = 0; i < x.length; i++) if (ux[i] !== uy[i] && !(x[i] !== x[i] && y[i] !== y[i])) return `${GRID_NAMES[g]}[${i}]: ${x[i]} vs ${y[i]}`;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ arms
export type ArmName = 'A' | 'B' | 'B0' | 'C' | 'D' | 'Dstaged' | 'Dscalar' | 'DscalarBlur' | 'E' | 'DE' | 'CE';
export const ARM_INFO: Record<ArmName, string> = {
  A: 'A as-is (verbatim 24f8609 loop over the Building objects, rt.defOf)',
  B: 'B stable-shape objects + def index (fair JS without data migration)',
  B0: 'B0 the sim\'s own objects + def index (the def-index change alone)',
  C: 'C JS over the SoA snapshot',
  D: 'D wasm (SIMD build) over the SoA, resident',
  Dstaged: 'D wasm (SIMD build), SoA / mWf / accessById / grids staged per call',
  Dscalar: 'D wasm scalar build (no simd128), resident',
  DscalarBlur: 'D wasm SIMD build with the scalar blur, resident',
  E: 'E gather: Building objects -> SoA (in wasm memory)',
  DE: 'D+E gather + wasm (buildings stay objects)',
  CE: 'C+E gather + JS SoA loop',
};

export interface Arm {
  name: ArmName;
  label: string;
  /** one aggregate call for the world's current day */
  run(): void;
  /** its outputs (after run); null for the gather-only arm */
  snapshot(): ProbeSnapshot | null;
  /** the SoA it gathered (arms E / DE / CE), for checks */
  soa?: PopAggSoA;
  stats?: PopAggBindStats;
  dispose(): void;
}

export interface ArmOptions {
  simd: PopAggWasm;
  scalar?: PopAggWasm | null;
  arms?: ArmName[];
}

/** SoA allocated in a heap (resident) */
export function residentSoA(w: PopAggWasm): PopAggSoA {
  const h = w.heap;
  const alloc = (ctor: HeapArrayCtor, n: number) => h.allocArray(ctor, n);
  return new PopAggSoA(alloc as unknown as ConstructorParameters<typeof PopAggSoA>[0], (a) => h.free(a));
}
/**
 * an arm's grids: cw² cells, except the rt-owned demographics grids (coarsePopW, coarseKids, coarseSkill), which get
 * the world rt's lengths — the original only blurs into them when rt.coarsePopW[0].length === cw²
 */
function armGrids(rt: OrigRuntime, alloc: (n: number) => Float32Array = (n) => new Float32Array(n)): PopAggGrids {
  const g = newGrids(rt.cw, alloc);
  const cc = rt.cw * rt.cw;
  const fit = (a: Float32Array, len: number) => (a.length === len ? a : alloc(len));
  g.coarsePopW = g.coarsePopW.map((a, w) => fit(a, rt.coarsePopW[w].length));
  g.coarseKids = fit(g.coarseKids, rt.coarseKids.length);
  g.coarseSkill = fit(g.coarseSkill, rt.coarseSkill.length);
  void cc;
  return g;
}
function residentGrids(w: PopAggWasm, rt: OrigRuntime, frees: ArrayBufferView[]): PopAggGrids {
  return armGrids(rt, (n) => { const a = w.heap.allocArray(Float32Array, n); frees.push(a); return a; });
}
function residentCopy(w: PopAggWasm, src: Float32Array, frees: ArrayBufferView[]): Float32Array {
  const a = w.heap.allocArray(Float32Array, src.length);
  a.set(src);
  frees.push(a);
  return a;
}

/** Build the arms over `world` (all of them by default). The world must not change while they are used. */
export function makeArms(world: ProbeWorld, o: ArmOptions): Record<string, Arm> {
  const want = new Set<ArmName>(o.arms ?? (Object.keys(ARM_INFO) as ArmName[]));
  if (!o.scalar) want.delete('Dscalar');
  const c = PROBE_CONSTANTS;
  const rt = world.rt;
  const cw = rt.cw;
  const list = rt.growables as unknown as PopAggBuilding[];
  const arms: Record<string, Arm> = {};
  const jsSoA: PopAggSoAFn = (soa, inp, g, t, coh, out) => aggregateSoA(soa, c, inp, g, t, coh, out);
  const deriver = new InputDeriver(world);

  if (want.has('A')) {
    const orig = makeOriginalAggregate(rt, world.cache);
    let r: PopAggResult = newResult();
    arms.A = {
      name: 'A', label: ARM_INFO.A,
      run() { r = orig.aggregate(world.sim, false); },
      snapshot() {
        return snap(rt.totals, r, orig.coh, [rt.coarsePopRaw, rt.coarseWealthRaw, rt.coarseCountRaw, rt.coarsePop, rt.coarseWealth,
          ...(orig.popWRaw.length ? orig.popWRaw : [new Float32Array(0), new Float32Array(0), new Float32Array(0)]), orig.skillRaw, orig.kidsRaw,
          rt.coarsePopW[0], rt.coarsePopW[1], rt.coarsePopW[2], rt.coarseKids, orig.skillBlur, rt.coarseSkill]);
      },
      dispose() {},
    };
  }
  /** a JS arm with its own outputs (B / B0 / C / CE) */
  const jsArm = (name: ArmName, body: (inp: PopAggInput, g: PopAggGrids, t: PopAggTotals, coh: Float64Array, out: PopAggResult) => void, extra: Partial<Arm> = {}): Arm => {
    const g = armGrids(rt), t = newTotals(12), coh = new Float64Array(15), out = newResult();
    return {
      name, label: ARM_INFO[name],
      run() { body(deriver.derive(), g, t, coh, out); },
      snapshot() { return snap(t, out, coh, gridList(g)); },
      dispose() {},
      ...extra,
    };
  };
  if (want.has('B')) {
    const objs = recreateStable(list);
    const defs = new DefIndex(world.resolveDef, c.DEV_TYPE_COUNT);
    arms.B = jsArm('B', (inp, g, t, coh, out) => aggregateObjects(objs, defs, c, inp, g, t, coh, out));
  }
  if (want.has('B0')) {
    const defs = new DefIndex(world.resolveDef, c.DEV_TYPE_COUNT);
    arms.B0 = jsArm('B0', (inp, g, t, coh, out) => aggregateObjects(rt.growables as unknown as PopAggBuilding[], defs, c, inp, g, t, coh, out));
  }
  // one resident SoA snapshot (gathered once) shared by C and the resident wasm arms of the SIMD instance
  const frees: { w: PopAggWasm; a: ArrayBufferView }[] = [];
  const track = (w: PopAggWasm) => {
    const list0: ArrayBufferView[] = [];
    return { list: list0, done: () => { for (const a of list0) frees.push({ w, a }); } };
  };
  let shared: PopAggSoA | null = null;
  const defsShared = new DefIndex(world.resolveDef, c.DEV_TYPE_COUNT);
  const sharedSoA = (): PopAggSoA => {
    if (shared) return shared;
    shared = residentSoA(o.simd);
    if (!gatherSoA(list, defsShared, c, cw, shared)) throw new Error(`${world.name}: the gather rejected a value (cannot build the SoA)`);
    return shared;
  };
  if (want.has('C')) {
    const soa = sharedSoA();
    arms.C = jsArm('C', (inp, g, t, coh, out) => jsSoA(soa, inp, g, t, coh, out));
  }
  /** a wasm arm over `soa` with resident mWf / accessById copies and resident grids in `w`'s memory */
  const wasmArm = (name: ArmName, w: PopAggWasm, soaOf: () => PopAggSoA, before: ((soa: PopAggSoA, inp: PopAggInput) => void) | null, scalarBlur = false): Arm => {
    const tr = track(w);
    const probe = deriver.derive();
    const resident = { mWf: residentCopy(w, world.cache.wf, tr.list), acc: probe.accArr ? residentCopy(w, probe.accArr, tr.list) : undefined };
    const dv = new InputDeriver(world, resident);
    const g = residentGrids(w, rt, tr.list);
    tr.done();
    const t = newTotals(12), coh = new Float64Array(15), out = newResult();
    const stats: PopAggBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
    const never: PopAggSoAFn = () => { throw new Error(`${name}: the wasm kernel fell back to JS`); };
    const k = makePopAggKernels(c, never, { wasm: w, stats, scalarBlur });
    const soa = soaOf();
    return {
      name, label: ARM_INFO[name], soa, stats,
      run() { const inp = dv.derive(); if (before) before(soa, inp); k(soa, inp, g, t, coh, out); },
      snapshot() { return snap(t, out, coh, gridList(g)); },
      dispose() {},
    };
  };
  if (want.has('D')) arms.D = wasmArm('D', o.simd, sharedSoA, null);
  if (want.has('DscalarBlur')) arms.DscalarBlur = wasmArm('DscalarBlur', o.simd, sharedSoA, null, true);
  if (want.has('Dscalar') && o.scalar) {
    const sc = o.scalar;
    const soaS = residentSoA(sc);
    if (!gatherSoA(list, new DefIndex(world.resolveDef, c.DEV_TYPE_COUNT), c, cw, soaS)) throw new Error('gather rejected');
    arms.Dscalar = wasmArm('Dscalar', sc, () => soaS, null);
  }
  if (want.has('Dstaged')) {
    // everything in JS memory: a plain SoA copy, the real mWf / accessById, plain grids -> staged every call
    const soaJ = new PopAggSoA();
    if (!gatherSoA(list, new DefIndex(world.resolveDef, c.DEV_TYPE_COUNT), c, cw, soaJ)) throw new Error('gather rejected');
    const g = armGrids(rt), t = newTotals(12), coh = new Float64Array(15), out = newResult();
    const stats: PopAggBindStats = { wasmCalls: 0, jsCalls: 0, bytesIn: 0, bytesOut: 0 };
    const never: PopAggSoAFn = () => { throw new Error('Dstaged: the wasm kernel fell back to JS'); };
    const k = makePopAggKernels(c, never, { wasm: o.simd, stats });
    arms.Dstaged = {
      name: 'Dstaged', label: ARM_INFO.Dstaged, soa: soaJ, stats,
      run() { k(soaJ, deriver.derive(), g, t, coh, out); },
      snapshot() { return snap(t, out, coh, gridList(g)); },
      dispose() {},
    };
  }
  if (want.has('E')) {
    const soaE = residentSoA(o.simd);
    const defs = new DefIndex(world.resolveDef, c.DEV_TYPE_COUNT);
    const dv = new InputDeriver(world);
    arms.E = {
      name: 'E', label: ARM_INFO.E, soa: soaE,
      run() {
        const inp = dv.derive();
        if (!gatherSoA(list, defs, c, cw, soaE, gatherNeed(inp.sample, inp.demo))) throw new Error('E: gather rejected a value');
      },
      snapshot() { return null; },
      dispose() { soaE.dispose(); },
    };
  }
  if (want.has('DE')) {
    const soaDE = residentSoA(o.simd);
    const defs = new DefIndex(world.resolveDef, c.DEV_TYPE_COUNT);
    arms.DE = wasmArm('DE', o.simd, () => soaDE, (soa, inp) => {
      if (!gatherSoA(list, defs, c, cw, soa, gatherNeed(inp.sample, inp.demo))) throw new Error('DE: gather rejected a value');
    });
  }
  if (want.has('CE')) {
    const soaCE = new PopAggSoA();
    const defs = new DefIndex(world.resolveDef, c.DEV_TYPE_COUNT);
    arms.CE = jsArm('CE', (inp, g, t, coh, out) => {
      if (!gatherSoA(list, defs, c, cw, soaCE, gatherNeed(inp.sample, inp.demo))) throw new Error('CE: gather rejected a value');
      jsSoA(soaCE, inp, g, t, coh, out);
    }, { soa: soaCE });
  }
  const disposeAll = () => {
    for (const { w, a } of frees.splice(0)) w.heap.free(a);
    shared?.dispose();
  };
  // (the last arm's dispose frees the shared blocks)
  const names = Object.keys(arms);
  if (names.length) {
    const last = arms[names[names.length - 1]];
    const d0 = last.dispose;
    last.dispose = () => { d0(); disposeAll(); };
  }
  return arms;
}

/**
 * Run every arm on each day of `days` (sim.state.day set per call, restored after) and compare each arm's outputs with
 * arm A after every call (same call sequence for all arms, so the state kept across calls — coh and the demographics
 * grids on non-demo days — is compared too). Also checks that the gathers produced the same SoA. Throws on the first
 * difference; returns the number of comparisons.
 */
export function checkArms(world: ProbeWorld, arms: Record<string, Arm>, days: number[]): number {
  const st = world.sim.state;
  const day0 = st.day;
  const ref = arms.A;
  if (!ref) throw new Error('checkArms needs arm A');
  let n = 0;
  try {
    for (const day of days) {
      st.day = day;
      ref.run();
      const want = ref.snapshot()!;
      for (const a of Object.values(arms)) {
        if (a === ref) continue;
        a.run();
        const got = a.snapshot();
        if (got) {
          const d = diffSnapshots(want, got);
          if (d) throw new Error(`${world.name} day ${day} (${kindOf(day)}): arm ${a.name} differs from A: ${d}`);
          n++;
        }
      }
      // gathered SoAs identical (E / DE / CE vs the first one), on the columns this day's gather fills; rows the loop
      // skips (dev 255) only carry the dev code
      const soas = Object.values(arms).filter((a) => a.soa).map((a) => a.soa!);
      const need = gatherNeed(day % ORIGINAL_CONSTANTS.OCC_PERIOD === 0, day % ORIGINAL_CONSTANTS.DEMO_AGG_DAYS === 0);
      const cols = [0, 1, 2, 3, 4, 5, 6, ...(need & GATHER_ID ? [7] : []), ...(need & GATHER_DEMO ? [8, 9, 10, 11, 12] : [])];
      for (let k = 1; k < soas.length; k++) {
        const x = soas[0], y = soas[k];
        if (x.n !== y.n) throw new Error(`${world.name}: SoA sizes differ`);
        if (x.n === 0) continue;
        const xa = x.arrays(), ya = y.arrays();
        for (let i = 0; i < x.n; i++) if (x.dev[i] !== y.dev[i]) throw new Error(`${world.name}: SoA dev differs at ${i}`);
        for (const q of cols) {
          if (q === 0) continue;
          const bpe = (xa[q] as Uint8Array).BYTES_PER_ELEMENT;
          const bx = new Uint8Array(xa[q].buffer, xa[q].byteOffset, x.n * bpe);
          const by = new Uint8Array(ya[q].buffer, ya[q].byteOffset, y.n * bpe);
          for (let i = 0; i < bx.length; i++) if (bx[i] !== by[i] && x.dev[(i / bpe) | 0] !== 255) throw new Error(`${world.name}: SoA column ${q} differs at byte ${i}`);
        }
      }
    }
  } finally {
    st.day = day0;
  }
  return n;
}

// ------------------------------------------------------------------------------------------------ capture
/**
 * A world's inputs as bytes: 'PAGC' u32 version, u32 json length, JSON header, then 8-aligned raw columns.
 * Buildings: id / x / z / w / d / pop / jobs / capacity / wealth / flags as f64, the def as u16 index into header.defs,
 * kids / teens / yad / srs / edu / wf / hire as f64 + a presence byte each (so NaN / undefined stay distinguishable).
 */
export interface ProbeCapture {
  name: string;
  day: number;
  nextBuildingId: number;
  cw: number;
  population: number;
  systemData: { infraVersion?: unknown; infraLayers?: unknown; eduMean: number };
  /** traffic present with workerAccess (tAcc) / with accessById */
  traffic: { access: boolean; array: boolean };
  defs: [string, number | null][];
  n: number;
  cols: Record<string, Float64Array | Uint8Array | Uint16Array>;
  mWf: Float32Array;
  acc: Float32Array | null;
}
const NUM_COLS = ['id', 'x', 'z', 'w', 'd', 'pop', 'jobs', 'capacity', 'wealth', 'flags'] as const;
const OPT_COLS = ['kids', 'teens', 'yad', 'srs', 'edu', 'wf', 'hire'] as const;

export function captureWorld(world: ProbeWorld): ProbeCapture {
  const list = world.rt.growables as unknown as Record<string, unknown>[];
  const n = list.length;
  const defs: [string, number | null][] = [];
  const defIdx = new Map<string, number>();
  const cols: ProbeCapture['cols'] = {};
  for (const k of NUM_COLS) cols[k] = new Float64Array(n);
  for (const k of OPT_COLS) { cols[k] = new Float64Array(n); cols[k + '?'] = new Uint8Array(n); }
  const defCol = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const b = list[i];
    const id = b.def as string;
    let di = defIdx.get(id);
    if (di === undefined) {
      di = defs.length;
      const d = world.resolveDef(id);
      defs.push([id, d === undefined ? -1 : d.devType === undefined ? null : d.devType]);
      defIdx.set(id, di);
    }
    defCol[i] = di;
    for (const k of NUM_COLS) (cols[k] as Float64Array)[i] = b[k] as number;
    for (const k of OPT_COLS) {
      const v = b[k];
      if (v !== undefined) { (cols[k] as Float64Array)[i] = v as number; (cols[k + '?'] as Uint8Array)[i] = 1; }
    }
  }
  cols.def = defCol;
  const traffic = trafficOf(world.sim);
  const access = typeof traffic?.workerAccess === 'function';
  const array = access && traffic!.accessById instanceof Float32Array;
  const sd = world.sim.state.systemData;
  return {
    name: world.name, day: world.sim.state.day, nextBuildingId: world.sim.state.nextBuildingId, cw: world.rt.cw, population: world.population,
    systemData: { infraVersion: sd.infraVersion, infraLayers: sd.infraLayers, eduMean: eduMeanOf(world.sim) },
    traffic: { access, array }, defs, n, cols, mWf: world.cache.wf.slice(), acc: array ? traffic!.accessById!.slice() : null,
  };
}

export function encodeCapture(c: ProbeCapture): Uint8Array {
  const parts: { name: string; arr: ArrayBufferView }[] = [];
  for (const [k, v] of Object.entries(c.cols)) parts.push({ name: 'col:' + k, arr: v });
  parts.push({ name: 'mWf', arr: c.mWf });
  if (c.acc) parts.push({ name: 'acc', arr: c.acc });
  const layout: Record<string, { type: string; offset: number; length: number }> = {};
  let off = 0;
  for (const p of parts) {
    off = (off + 7) & ~7;
    layout[p.name] = { type: p.arr.constructor.name, offset: off, length: (p.arr as Uint8Array).length };
    off += p.arr.byteLength;
  }
  const header = { name: c.name, day: c.day, nextBuildingId: c.nextBuildingId, cw: c.cw, population: c.population, systemData: c.systemData,
    traffic: c.traffic, defs: c.defs, n: c.n, layout };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const base = (12 + json.length + 7) & ~7;
  const out = new Uint8Array(base + off);
  const dv = new DataView(out.buffer);
  out.set([0x50, 0x41, 0x47, 0x43], 0); // 'PAGC'
  dv.setUint32(4, 1, true);
  dv.setUint32(8, json.length, true);
  out.set(json, 12);
  for (const p of parts) out.set(new Uint8Array(p.arr.buffer, p.arr.byteOffset, p.arr.byteLength), base + layout[p.name].offset);
  return out;
}

export function decodeCapture(bytes: Uint8Array): ProbeCapture {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x41 || bytes[2] !== 0x47 || bytes[3] !== 0x43 || dv.getUint32(4, true) !== 1) throw new Error('not a PAGC v1 capture');
  const jl = dv.getUint32(8, true);
  const h = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + jl)));
  const base = (12 + jl + 7) & ~7;
  const ctors: Record<string, new (b: ArrayBuffer, o: number, l: number) => ArrayBufferView> = { Float64Array, Float32Array, Uint8Array, Uint16Array };
  const get = (name: string): ArrayBufferView => {
    const l = h.layout[name];
    const C = ctors[l.type];
    const bpe = (C as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
    const copy = bytes.slice(base + l.offset, base + l.offset + l.length * bpe);
    return new C(copy.buffer, 0, l.length);
  };
  const cols: ProbeCapture['cols'] = {};
  for (const k of Object.keys(h.layout)) if (k.startsWith('col:')) cols[k.slice(4)] = get(k) as Float64Array;
  return {
    name: h.name, day: h.day, nextBuildingId: h.nextBuildingId, cw: h.cw, population: h.population, systemData: h.systemData, traffic: h.traffic,
    defs: h.defs, n: h.n, cols, mWf: get('mWf') as Float32Array, acc: h.layout.acc ? (get('acc') as Float32Array) : null,
  };
}

/**
 * Rebuild a world from a capture: Building objects created like deserializeBuildings creates them (the 18-field
 * literal, then all seven optional fields when any is set), an rt with EconRuntime.defOf's per-id cache, a cache with
 * wf / ensure, and a traffic double (accessById + workerAccess).
 */
export function worldFromCapture(c: ProbeCapture): ProbeWorld {
  const defTab = new Map<string, PopAggDef | undefined>();
  for (const [id, dt] of c.defs) defTab.set(id, dt === -1 ? undefined : dt === null ? {} : { devType: dt });
  const col = (k: string) => c.cols[k] as Float64Array;
  const has = (k: string) => c.cols[k + '?'] as Uint8Array;
  const defCol = c.cols.def as Uint16Array;
  const list: OrigBuilding[] = [];
  for (let i = 0; i < c.n; i++) {
    const b: Record<string, unknown> = {
      id: col('id')[i], def: c.defs[defCol[i]][0], x: col('x')[i], z: col('z')[i], w: col('w')[i], d: col('d')[i], rot: 0, variant: 0,
      pop: col('pop')[i], jobs: col('jobs')[i], capacity: col('capacity')[i], wealth: col('wealth')[i], built: 1, age: 0,
      flags: col('flags')[i], baseY: 0, health: 1, unhappy: 0,
    };
    let any = false;
    for (const k of OPT_COLS) if (has(k)[i]) any = true;
    if (any) for (const k of OPT_COLS) b[k] = has(k)[i] ? col(k)[i] : undefined;
    list.push(b as unknown as OrigBuilding);
  }
  const cw = c.cw, cc = cw * cw;
  const defCache: (PopAggDef & { id?: string })[] = [];
  const rt: OrigRuntime = {
    growables: list,
    defOf(b) {
      const d = defCache[b.id] as (PopAggDef & { __id: string }) | undefined;
      if (d !== undefined && d.__id === b.def) return d;
      const r = defTab.get(b.def);
      if (r) { const e = Object.assign({ __id: b.def }, r); defCache[b.id] = e; return e; }
      return r;
    },
    totals: { pop: [0, 0, 0], resCapAll: [0, 0, 0], resCapBuilt: [0, 0, 0], jobs: new Array(12).fill(0), jobCapAll: new Array(12).fill(0),
      jobCapBuilt: new Array(12).fill(0), countByDev: new Array(12).fill(0), civicJobCap: 0, civicJobs: 0, abandoned: 0, constructing: 0 },
    cw,
    coarsePopRaw: new Float32Array(cc), coarseWealthRaw: new Float32Array(cc), coarseCountRaw: new Float32Array(cc),
    coarsePop: new Float32Array(cc), coarseWealth: new Float32Array(cc),
    coarsePopW: [new Float32Array(cc), new Float32Array(cc), new Float32Array(cc)], coarseSkill: new Float32Array(cc), coarseKids: new Float32Array(cc),
  };
  const cache: OrigCache = {
    wf: c.mWf,
    ensure(id: number) {
      if (id < this.wf.length) return;
      const n = Math.max(id + 1, this.wf.length * 2, 1024);
      const w = new Float32Array(n).fill(NaN);
      w.set(this.wf);
      this.wf = w;
    },
  };
  const acc = c.acc;
  const traffic: TrafficLike | undefined = c.traffic.access
    ? { workerAccess: (id: number) => (acc && id >= 0 && id < acc.length ? acc[id] : -1), accessById: c.traffic.array && acc ? acc : undefined }
    : undefined;
  const systemData: Record<string, unknown> = { demographics: { v: 1, eduMean: c.systemData.eduMean, wfRatio: 0.55, empRatio: -1 } };
  if (c.systemData.infraVersion !== undefined) systemData.infraVersion = c.systemData.infraVersion;
  if (c.systemData.infraLayers !== undefined) systemData.infraLayers = c.systemData.infraLayers;
  const sim: OrigSim = {
    state: { day: c.day, nextBuildingId: c.nextBuildingId, systemData },
    getSystem: (name: string) => (name === 'traffic' ? traffic : undefined),
  };
  return { name: c.name, sim, rt, cache, resolveDef: (id) => defTab.get(id), population: c.population };
}

/** the days checkArms runs: every kind `rounds` times, interleaved demo, plain, sample, demo, … from `day0` (a demo day
 *  first, like the system's init call: the original allocates its demographics grids on its first demo day) */
export function checkDays(day0: number, rounds = 2): number[] {
  const out: number[] = [];
  let d = day0;
  for (let r = 0; r < rounds; r++) {
    for (const k of ['demo', 'plain', 'sample'] as DayKind[]) {
      d = dayOfKind(d, k);
      out.push(d);
      d++;
    }
  }
  return out;
}
