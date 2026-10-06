/**
 * WebAssembly traffic core: the numeric phases of TrafficSystem (src/sim/infra/traffic.ts at commit 24f8609) run by
 * wasm/sim-kernels/src/traffic.rs, with the searches (search.rs roadSearch / transitSearch) called inside wasm, so a
 * whole phase is one boundary crossing. Implements TrafficCoreApi (trafficLayout.ts) exactly like the fair JS core
 * (src/wasm/js/trafficCore.ts) with bit-identical results.
 *
 * Memory model (the architect's: arrays live in wasm memory, used in place):
 *  - every array of TRAFFIC_ARRAYS is a view of ONE pinned arena block in the instance's WasmHeap; the arena is laid
 *    out from the capacity classes and reallocated only in ensure(), i.e. at prep / prepTransit, the step boundaries
 *    where the driver grows capacities. A reallocation moves the contents out to JS first and frees the old block, so
 *    the heap never holds two arenas (peak = one arena: the pre-sized 64 MiB memory never has to grow for it).
 *    Kernels never grow memory.
 *  - a context block ([F: f64][U: u32], layout read from the binary: traffic_names) holds counts, capacities, the
 *    array offsets and the constants; the kernels take one pointer.
 *  - wasm memory growth (any binding's reserve) detaches views: the heap's onGrow listener re-creates the views from
 *    the (unchanged) offsets and notifies the driver (onMove), which re-points the TrafficSystem fields. Views are
 *    also re-checked at every kernel call.
 *  - graph arrays are copied into the arena once per graph version (and validated there: traffic_check_graph);
 *    the traffic / congestion / network layers are used in place when they live in this heap (adoptLayers), else
 *    staged per call (prepNodes: traffic in; finalize: traffic + network in, traffic + congestion out).
 *  - Math.exp / Math.log inside the kernels are the engine's own functions (imports env.js_exp / env.js_log, wired by
 *    the loader: simWasmImports()), so they equal the JS original's on every engine by construction; a wiring
 *    self-test at first use (trafficMathSelfTest) guards against a binary / loader mismatch.
 * Fallbacks — the call runs the fair JS kernel on the same arrays (bit-identical by construction):
 *  - no instance / 'traffic:js' / the binary lacks the exports / layout mismatch / the math self-test fails / a graph
 *    that fails validation;
 *  - a kernel code returned BEFORE any state change: -2 input outside the kernel domain, -3 invalid transit net, -4 a
 *    search capacity, -6 counts beyond capacities, or a buffer still too small after 4 growth retries.
 * Traps (a kernel bug: a bounds check fails; the kernel may already have written state): the trap is reported
 * (`onError`, default simWasmCallFailed: wasm off for the session, or rethrown in forced 'wasm' mode), this core stops
 * using wasm for good, and the call is recovered exactly where that is cheap:
 *  - redo      kernels whose outputs depend only on inputs they do not write (prepNodes, prepOrigins, clusters,
 *              prepStops, transfers, transit, roundSearch): the JS kernel simply runs again;
 *  - snapshot  kernels with a few read-modify-write arrays (inboundCached / inbound / freight / addCached: volNew;
 *              shop: volNew + sLoad; finalize: the traffic layer + railNew): copied before the call (≈ 0.1 MiB each,
 *              tens of µs per cycle), restored after a trap, then the JS kernel runs;
 *  - abort     roundMatch / commute (read-modify-write of ~20 per-origin / per-cluster / per-node arrays, ~0.8 MiB per
 *              call — too much to copy on every call): the call throws TrafficCycleAbortError and the driver
 *              (trafficDriver.ts) discards the cycle and restarts it from prep, in JS. Nothing persistent was touched:
 *              the per-id scatters (prices, inbound, freight) run only after a kernel returned.
 *
 * No simulation imports (constants come in through TrafficParams), so benchmarks can bind a frozen tree.
 */
import { kernelSlot, simWasmCallFailed, simWasmPreference, type SimWasmInstance } from '../simWasm';
import { WasmHeapFullError, type WasmHeap } from '../heap';
import type { FairSearch } from '../js/roadTransitSearch';
import {
  ALL_CLASSES, arrLen, bindEnvViews, ensureSortScratch, fairKernels, growCap, newEnv, zeroCaps, type Arrs, type KernelEnv,
} from '../js/trafficCore';
import {
  BYTES, COUNT_NAMES, CTOR, TRAFFIC_ARRAYS, newArraysObject, type ArrDef, type Cls, type GridGraphLike, type LayersLike, type RoadGraphLike,
  type TrafficArrays, type TrafficCoreApi, type TrafficParams,
} from './trafficLayout';

/** traffic.rs LAYOUT */
export const TRAFFIC_LAYOUT = 1;

export const TRAFFIC_EXPORTS = [
  'traffic_layout', 'traffic_names', 'traffic_prep_nodes', 'traffic_prep_origins', 'traffic_clusters', 'traffic_prep_stops',
  'traffic_transfers', 'traffic_transit', 'traffic_round_search', 'traffic_round_match', 'traffic_commute', 'traffic_inbound_cached',
  'traffic_inbound', 'traffic_shop', 'traffic_freight', 'traffic_add_cached', 'traffic_finalize', 'traffic_check_graph', 'traffic_counts_check',
  'traffic_exp', 'traffic_log', 'traffic_math_batch',
] as const;

/** the kernel slot (A/B flag `traffic`, e.g. ?simwasm=auto,traffic:js) */
export const TRAFFIC_KERNEL = kernelSlot('traffic', TRAFFIC_EXPORTS);

/**
 * Thrown by roundMatch / commute of a wasm core when the kernel TRAPPED after it may have written cycle state (the
 * trap was already reported through `onError`): the cycle's state is inconsistent and must be rebuilt from prep. The
 * traffic driver catches it in step() and restarts the cycle (in JS: the core stops using wasm after a trap).
 */
export class TrafficCycleAbortError extends Error {
  readonly kernel: string;
  readonly trap: unknown;
  constructor(kernel: string, trap: unknown) {
    super(`traffic kernel ${kernel} trapped after writing cycle state; the cycle restarts (${trap instanceof Error ? trap.message : String(trap)})`);
    this.name = 'TrafficCycleAbortError';
    this.kernel = kernel;
    this.trap = trap;
  }
}

/** how a kernel call is recovered after a trap (see the header) */
type Recovery = 'redo' | 'snapshot' | 'abort';

interface TrafficExports {
  memory: WebAssembly.Memory;
  traffic_layout(f: number, u: number, h: number): number;
  traffic_names(which: number, len: number): number;
  traffic_prep_nodes(ctx: number): number;
  traffic_prep_origins(ctx: number): number;
  traffic_clusters(ctx: number): number;
  traffic_prep_stops(ctx: number): number;
  traffic_transfers(ctx: number): number;
  traffic_transit(ctx: number): number;
  traffic_round_search(ctx: number, round: number): number;
  traffic_round_match(ctx: number, round: number): number;
  traffic_commute(ctx: number): number;
  traffic_inbound_cached(ctx: number): number;
  traffic_inbound(ctx: number): number;
  traffic_shop(ctx: number): number;
  traffic_freight(ctx: number): number;
  traffic_add_cached(ctx: number, which: number): number;
  traffic_finalize(ctx: number): number;
  traffic_check_graph(ctx: number): number;
  traffic_counts_check(ctx: number): number;
  traffic_exp(x: number): number;
  traffic_log(x: number): number;
  traffic_math_batch(x: number, out: number, n: number, which: number): void;
}

/** the F slots the binding writes from TrafficParams (the rest are per-call scalars / outputs) */
const PARAM_SLOTS: [string, (P: TrafficParams) => number][] = [
  ['bprAlpha', (P) => P.bprAlpha], ['bprMax', (P) => P.bprMax], ['busTimeFactor', (P) => P.busTimeFactor], ['stopWalkT', (P) => P.stopWalkT],
  ['priceMax', (P) => P.priceMax], ['maxCommute', (P) => P.maxCommute], ['carOverhead', (P) => P.carOverhead], ['walkT', (P) => P.walkT],
  ['modeBeta', (P) => P.modeBeta], ['carBias0', (P) => P.carBias[0]], ['carBias1', (P) => P.carBias[1]], ['carBias2', (P) => P.carBias[2]],
  ['trBias0', (P) => P.trBias[0]], ['trBias1', (P) => P.trBias[1]], ['trBias2', (P) => P.trBias[2]], ['walkBias', (P) => P.walkBias],
  ['busPcu', (P) => P.busPcu], ['stepMin', (P) => P.stepMin], ['stepRel', (P) => P.stepRel], ['regionalTime', (P) => P.regionalTime],
  ['regionalFill', (P) => P.regionalFill], ['cw0', (P) => P.connWorkers[0]], ['cw1', (P) => P.connWorkers[1]], ['cw2', (P) => P.connWorkers[2]],
  ['cw3', (P) => P.connWorkers[3]], ['cw4', (P) => P.connWorkers[4]], ['cw5', (P) => P.connWorkers[5]], ['cw6', (P) => P.connWorkers[6]],
  ['invCarOcc', (P) => P.invCarOcc], ['shopPcu', (P) => P.shopPcu], ['shopTrips', (P) => P.shopTrips], ['truckPcu', (P) => P.truckPcu],
  ['railCap', (P) => P.railCap], ['limTransit', (P) => P.limTransit], ['limRound', (P) => P.limRound], ['limInbound', (P) => P.limInbound],
  ['limShop', (P) => P.limShop], ['limFreight', (P) => P.limFreight], ['invQ', (P) => P.invQ], ['invQT', (P) => P.invQT],
  ['rampPen', (P) => P.rampPen], ['railTime', (P) => P.railTime], ['subTime', (P) => P.subTime],
];
const INT_SLOTS: [string, (P: TrafficParams) => number][] = [
  ['hw', (P) => P.hw], ['street', (P) => P.street], ['rail', (P) => P.rail], ['stopR', (P) => P.stopR], ['walkMax', (P) => P.walkMax],
  ['propRounds', (P) => P.propRounds], ['headLen', (P) => P.headLen],
];
const SCALAR_SLOTS = ['propFactor', 'carPcu', 'trBonus', 'alpha', 'growth', 'regionWorkerCap'] as const;
const CAP_SLOTS: [string, Cls, number][] = [
  ['capN', 'N', 0], ['capT', 'T', 0], ['capRail', 'R', 0], ['capSub', 'B', 0], ['capO', 'O', 0], ['capJ', 'J', 0], ['capQ', 'Q', 0],
  ['capS', 'S', 0], ['capF', 'F', 0], ['capK', 'K', 0], ['capStop', 'P', 0], ['capAtt', 'A', 0], ['capBin', 'G', 0], ['capTr', 'E', 0],
  ['capEnt', 'NT', 0], ['capSeed', 'SD', 0], ['capComp', 'C', 0], ['capQent', 'QE', 0], ['capCells', 'L', 0],
];

/** layout of one binary (slot indices by name); null when the binary does not match these bindings */
interface Layout {
  nF: number;
  nU: number;
  f: Map<string, number>;
  u: Map<string, number>;
}
const layouts = new WeakMap<SimWasmInstance, Layout | null>();

function readLayout(w: SimWasmInstance): Layout | null {
  if (layouts.has(w)) return layouts.get(w)!;
  let res: Layout | null = null;
  try {
    const ex = w.exports as unknown as TrafficExports;
    const h = w.heap;
    const p = h.alloc(64);
    try {
      const ver = ex.traffic_layout(p, p + 4, p + 8);
      const U32 = new Uint32Array(h.memory.buffer, p, 4);
      const nF = U32[0], nU = U32[1];
      const names = (which: number) => {
        const q = ex.traffic_names(which, p + 12);
        const len = new Uint32Array(h.memory.buffer, p + 12, 1)[0];
        return new TextDecoder().decode(new Uint8Array(h.memory.buffer, q, len)).trim().split(' ');
      };
      const fn = names(0), un = names(1);
      if (ver === TRAFFIC_LAYOUT && fn.length === nF && un.length === nU) {
        const f = new Map(fn.map((n, i) => [n, i]));
        const u = new Map(un.map((n, i) => [n, i]));
        const need = [...TRAFFIC_ARRAYS.map((a) => a.name), ...COUNT_NAMES, ...INT_SLOTS.map((s) => s[0]), ...CAP_SLOTS.map((s) => s[0])];
        const needF = [...PARAM_SLOTS.map((s) => s[0]), ...SCALAR_SLOTS, 'out0', 'out7'];
        if (need.every((n) => u.has(n)) && needF.every((n) => f.has(n))) res = { nF, nU, f, u };
      }
    } finally {
      h.free(p);
    }
  } catch {
    res = null;
  }
  layouts.set(w, res);
  return res;
}

/**
 * The kernels' exp / log against this engine's Math.exp / Math.log, bit for bit, on arguments covering the traffic
 * phases' ranges (utility differences <= 0, logistic arguments, shop decay, price ratios in [0.25, 8]) and special
 * values. The kernels call the imported engine functions (env.js_exp / env.js_log), so this is a WIRING check (a
 * binary built without the imports, or a loader passing other functions, fails it). Cached per instance; a mismatch
 * makes every traffic call run JS (reported in trafficWasmInfo()).
 */
const mathOk = new WeakMap<SimWasmInstance, boolean>();
export function trafficMathSelfTest(w: SimWasmInstance, n = 20000): boolean {
  const k = mathOk.get(w);
  if (k !== undefined) return k;
  let ok = false;
  try {
    const ex = w.exports as unknown as TrafficExports;
    const h = w.heap;
    const p = h.alloc(16 * n + 64, 16);
    try {
      const X = new Float64Array(h.memory.buffer, p, n);
      let s = 0x9e3779b9;
      const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
      const special = [0, -0, 1, -1, 0.5, -0.5, 2, Infinity, -Infinity, NaN, 1e-300, 5e-324, 709.78, 709.79, -745.13, -745.14, 1e-9, -1e-9, 0.25, 8];
      for (let i = 0; i < n; i++) {
        const m = i % 5;
        X[i] = i < special.length ? special[i] : m === 0 ? -r() * 40 : m === 1 ? (r() - 0.5) * 60 : m === 2 ? -r() * 5 : m === 3 ? 0.25 + r() * 7.75 : (r() - 0.5) * 1500;
      }
      const O = p + 8 * n;
      const same = (a: number, b: number) => Object.is(a, b) || (a !== a && b !== b);
      ok = true;
      for (const which of [0, 1]) {
        ex.traffic_math_batch(p, O, n, which);
        const R = new Float64Array(h.memory.buffer, O, n), Xv = new Float64Array(h.memory.buffer, p, n);
        const f = which ? Math.log : Math.exp;
        for (let i = 0; i < n && ok; i++) if (!same(f(Xv[i]), R[i])) ok = false;
      }
    } finally {
      h.free(p);
    }
  } catch {
    ok = false;
  }
  mathOk.set(w, ok);
  return ok;
}

/** statistics of all wasm traffic cores (tests / benchmarks: prove which path ran) */
export const trafficWasmStats = {
  wasmCalls: 0, jsCalls: 0, fallbacks: 0, reallocs: 0, graphCopies: 0, stagedCalls: 0, reserves: 0, bytes: 0,
  /** traps caught (each disables its core), snapshot restores after a trap, cycles aborted (TrafficCycleAbortError) */
  traps: 0, restores: 0, aborts: 0,
};
export function resetTrafficWasmStats(): void {
  for (const k of Object.keys(trafficWasmStats) as (keyof typeof trafficWasmStats)[]) trafficWasmStats[k] = 0;
}

export interface TrafficWasmOptions {
  /** instance provider (default: the global 'traffic' kernel slot); benchmarks pass a second binary (e.g. scalar) */
  instance?: () => SimWasmInstance | null;
  /**
   * failure handler for traps (default: simWasmCallFailed('traffic', e): wasm off for the session, or rethrow when
   * forced). Whatever it does, the core itself runs JS after a trap (see the header).
   */
  onError?: (e: unknown) => void;
  /** the fair JS searches for the JS fallback path (required: every call can fall back) */
  search: FairSearch;
  /** label reported in `kind` */
  label?: string;
}

export interface TrafficWasmCore extends TrafficCoreApi {
  readonly env: KernelEnv;
  /** why the last call ran JS ('' = wasm) */
  readonly lastJsReason: string;
  /** the trap that switched this core to JS for good ('' = none) */
  readonly trapped: string;
  /** arena bytes */
  readonly arenaBytes: number;
  /** free the arena and the context (the core then runs JS) */
  dispose(): void;
}

const HEADROOM = 4 << 20;

/** the wasm traffic core */
export function makeWasmTrafficCore(P: TrafficParams, opts: TrafficWasmOptions): TrafficWasmCore {
  const inst = opts.instance ?? (() => TRAFFIC_KERNEL.instance());
  const failed = opts.onError ?? ((e: unknown) => simWasmCallFailed('traffic', e));
  const caps = zeroCaps();
  caps.H = P.headLen;
  // the "+1" classes hold one element even for an empty city (the kernels read stAttS[stopN], qNode[jN], trStart[total])
  caps.P = 1; caps.Q = 1; caps.T1 = 1; caps.G = 1;
  /** capacities the current arena was laid out with (caps = the target while a reallocation runs) */
  let arenaCaps = { ...caps };
  const A = newArraysObject() as unknown as Record<string, Float32Array | Float64Array | Int32Array | Uint8Array | Uint16Array | Uint32Array | BigUint64Array>;
  const offs = new Map<string, number>();
  const fairDefs = TRAFFIC_ARRAYS.filter((a) => !a.wasmOnly);
  // until the first allocation the arrays are empty plain arrays (JS path)
  for (const a of TRAFFIC_ARRAYS) A[a.name] = new (CTOR[a.type] as unknown as new (n: number) => Float32Array)(arrLen(a, caps));
  const e = newEnv(P, opts.search, A as unknown as Arrs);
  const moved: (() => void)[] = [];
  const calls: Record<string, number> = {};
  let heap: WasmHeap | null = null;
  let w0: SimWasmInstance | null = null;
  let lay: Layout | null = null;
  let arena: Uint8Array | null = null;
  let arenaBytes = 0;
  let ctxPtr = 0;
  let ctxF: Float64Array = new Float64Array(0), ctxU: Int32Array = new Int32Array(0);
  let unsub: (() => void) | null = null;
  let graphKey = '';
  let graphOk = false;
  let graphObjs: [RoadGraphLike | null, GridGraphLike | null, GridGraphLike | null] = [null, null, null];
  const gk = new Float64Array(7);
  let layers: LayersLike | null = null;
  let resident = { traffic: -1, congestion: -1, network: -1 };
  let lastJsReason = 'not initialised';
  let disposed = false;
  /** set by the first trap: this core runs JS from then on */
  let trapped = '';
  /** reusable copies for the snapshot recovery (see the header) */
  const snapBufs: Float32Array[] = [];

  const layoutOf = (cs: Record<Cls, number>) => {
    const out: { def: ArrDef; off: number; len: number }[] = [];
    let off = 0;
    for (const a of TRAFFIC_ARRAYS) {
      const len = arrLen(a, cs);
      out.push({ def: a, off, len });
      off += Math.ceil(Math.max(16, len * BYTES[a.type]) / 16) * 16;
    }
    return { entries: out, bytes: off };
  };

  /** (re)create every view from the arena block (after allocation or memory growth) */
  function bindViews(): void {
    if (!arena || !heap) return;
    if (arena.buffer !== heap.memory.buffer) arena = heap.refresh(arena);
    const buf = arena.buffer as ArrayBuffer, base = arena.byteOffset;
    for (const { def, off, len } of layoutOf(arenaCaps).entries) {
      A[def.name] = new (CTOR[def.type] as unknown as new (b: ArrayBuffer, o: number, n: number) => Float32Array)(buf, base + off, len);
      offs.set(def.name, base + off);
    }
    ctxF = new Float64Array(buf, ctxPtr, lay!.nF);
    ctxU = new Int32Array(buf, ctxPtr + 8 * lay!.nF, lay!.nU);
    bindEnvViews(e);
    if (layers) bindLayerPtrs();
  }

  function notify(): void {
    for (const cb of moved) cb();
  }

  /** run an allocation; reserve (grow) explicitly when pinned views block implicit growth */
  function withRoom<T>(bytes: number, f: () => T): T {
    try {
      return f();
    } catch (err) {
      if (!(err instanceof WasmHeapFullError) || !heap) throw err;
      trafficWasmStats.reserves++;
      heap.reserve(bytes + HEADROOM);
      return f();
    }
  }

  /** the instance if the wasm path can run, else null (and lastJsReason) */
  function live(): SimWasmInstance | null {
    if (disposed) { lastJsReason = 'disposed'; return null; }
    if (trapped) { lastJsReason = `wasm off after a trap (${trapped})`; return null; }
    let w: SimWasmInstance | null;
    try {
      w = inst();
    } catch (err) {
      throw err; // forced 'wasm' but unavailable
    }
    if (!w) { lastJsReason = 'no wasm instance (preference js or wasm unavailable)'; return null; }
    const forced = !opts.instance && simWasmPreference('traffic') === 'wasm';
    if (w0 && w !== w0) { lastJsReason = 'instance changed'; return null; }
    if (!w0) {
      const l = readLayout(w);
      if (!l) {
        lastJsReason = 'binary layout does not match the bindings (npm run build:wasm)';
        if (forced) throw new Error(`[simWasm] kernel 'traffic' forced to wasm: ${lastJsReason}`);
        return null;
      }
      if (!trafficMathSelfTest(w)) {
        lastJsReason = "the kernels' exp / log are not this engine's Math.exp / Math.log (binary built without the env imports?)";
        if (forced) throw new Error(`[simWasm] kernel 'traffic' forced to wasm: ${lastJsReason}`);
        return null;
      }
      w0 = w;
      lay = l;
      heap = w.heap;
      ctxPtr = withRoom(8 * l.nF + 4 * l.nU + 64, () => heap!.alloc(8 * l.nF + 4 * l.nU + 64, 16));
      const buf = heap.memory.buffer;
      ctxF = new Float64Array(buf, ctxPtr, l.nF);
      ctxU = new Int32Array(buf, ctxPtr + 8 * l.nF, l.nU);
      ctxF.fill(0);
      ctxU.fill(0);
      for (const [k, g] of PARAM_SLOTS) ctxF[l.f.get(k)!] = g(P);
      for (const [k, g] of INT_SLOTS) ctxU[l.u.get(k)!] = g(P);
      unsub = heap.onGrow(() => { bindViews(); notify(); });
      // move the (JS) arrays into an arena of the current capacities
      allocate(true);
    }
    if (!arena) { lastJsReason = 'no arena'; return null; }
    if (arena.buffer !== heap!.memory.buffer) { bindViews(); notify(); }
    return w;
  }

  /**
   * allocate the arena for `caps` and copy the current contents; `migrate` = the old arrays are plain JS arrays.
   * The old arena's contents move out to JS copies and its block is freed BEFORE the new one is allocated, so the heap
   * never holds two arenas (the first-fit heap reuses the freed range; no memory growth for a reallocation that fits).
   */
  function allocate(migrate: boolean): void {
    const L = layoutOf(caps);
    if (!migrate && arena) {
      for (const a of TRAFFIC_ARRAYS) A[a.name] = (A[a.name] as unknown as Float32Array).slice();
      heap!.free(arena);
      arena = null;
    }
    // A holds plain JS arrays now (copies, or the original arrays when migrating): a memory growth inside the
    // allocation (onGrow -> bindViews) finds no arena and leaves them alone
    const blk = withRoom(L.bytes, () => heap!.allocArray(Uint8Array, Math.max(16, L.bytes), 16));
    const buf = heap!.memory.buffer as ArrayBuffer, base = blk.byteOffset;
    for (const { def, off, len } of L.entries) {
      const nv = new (CTOR[def.type] as unknown as new (b: ArrayBuffer, o: number, n: number) => Float32Array)(buf, base + off, len);
      const pv = A[def.name] as unknown as Float32Array;
      const keep = Math.min(len, pv.length);
      if (keep > 0) nv.set(pv.subarray(0, keep));
      A[def.name] = nv;
      offs.set(def.name, base + off);
    }
    arena = blk;
    arenaCaps = { ...caps };
    arenaBytes = L.bytes;
    trafficWasmStats.bytes = Math.max(trafficWasmStats.bytes, L.bytes);
    ctxF = new Float64Array(buf, ctxPtr, lay!.nF);
    ctxU = new Int32Array(buf, ctxPtr + 8 * lay!.nF, lay!.nU);
    for (const a of TRAFFIC_ARRAYS) ctxU[lay!.u.get(a.name)!] = offs.get(a.name)!;
    for (const [slot, cls] of CAP_SLOTS) ctxU[lay!.u.get(slot)!] = caps[cls];
    ensureSortScratch(e, caps.O);
    bindEnvViews(e);
    if (layers) bindLayerPtrs();
    trafficWasmStats.reallocs++;
  }

  function ensure(need: Partial<Record<Cls, number>>): boolean {
    const want = { ...need };
    if (want.T !== undefined) want.T1 = Math.max(want.T1 ?? 0, want.T + 1);
    if (want.J !== undefined) want.Q = Math.max(want.Q ?? 0, want.J + 1);
    let changed = false;
    for (const k of Object.keys(want) as Cls[]) {
      const v = want[k]!;
      if (k === 'L' ? v !== caps.L : v > caps[k]) {
        caps[k] = k === 'L' ? v : growCap(k, caps[k], v);
        changed = true;
      }
    }
    // the bucket queue must hold 2 x (seeds + 4 transit nodes + transfers) + 16 entries
    const qe = 2 * (caps.SD + 4 * Math.max(caps.T, caps.N) + caps.E) + 16;
    if (qe > caps.QE) { caps.QE = growCap('QE', caps.QE, qe); changed = true; }
    if (!changed) return false;
    if (heap && arena && !disposed) {
      allocate(false);
    } else {
      // no wasm (yet): plain arrays, like the fair core
      for (const a of TRAFFIC_ARRAYS) {
        const len = arrLen(a, caps);
        const old = A[a.name] as unknown as Float32Array;
        if (old.length === len) continue;
        const nv = new (CTOR[a.type] as unknown as new (n: number) => Float32Array)(len);
        nv.set(old.length <= len ? old : old.subarray(0, len));
        A[a.name] = nv;
      }
      ensureSortScratch(e, caps.O);
      bindEnvViews(e);
    }
    notify();
    return true;
  }

  // ---------------------------------------------------------------------------------------------- graphs / layers
  function copyInto(name: string, src: ArrayLike<number> & { subarray?: unknown }, len: number): void {
    const dst = A[name] as unknown as Float32Array;
    if (len > dst.length) throw new Error(`trafficBind: ${name} capacity ${dst.length} < ${len}`);
    dst.set((src as Float32Array).subarray(0, len));
  }

  function bindGraphs(road: RoadGraphLike, rail: GridGraphLike, sub: GridGraphLike): void {
    e.road = road; e.rail = rail; e.sub = sub;
    const c = e.c;
    c.n = road.n; c.nRail = rail.n; c.nSub = sub.n; c.nComp = road.nComp; c.mapN = road.N;
    c.total = road.n + rail.n + sub.n;
    // graph objects rebuild in place and bump `version`: (object, version, n) identifies the contents
    if (graphObjs[0] !== road || graphObjs[1] !== rail || graphObjs[2] !== sub) graphKey = '';
    graphObjs = [road, rail, sub];
  }

  /**
   * copy the graphs into the arena when their version changed (lazy: at the first kernel call of a cycle) and validate
   * them. The verdict is cached per graph version only when it is about the graph itself (valid, or invalid content):
   * a count / capacity mismatch (-6) is re-checked at the next call instead of pinning this graph to JS.
   */
  function syncGraphs(w: SimWasmInstance): boolean {
    const road = e.road, rail = e.rail, sub = e.sub;
    if (graphKey !== '' && gk[0] === road.version && gk[1] === road.n && gk[2] === rail.version && gk[3] === rail.n && gk[4] === sub.version && gk[5] === sub.n && gk[6] === road.nComp) return graphOk;
    const key = `${road.version}:${road.n}:${rail.version}:${rail.n}:${sub.version}:${sub.n}:${road.nComp}`;
    const n = road.n;
    ensure({ N: n, R: rail.n, B: sub.n, C: road.nComp, T: n + rail.n + sub.n });
    copyInto('rev', road.rev, 4 * n); copyInto('fwd', road.fwd, 4 * n); copyInto('typ', road.type, n); copyInto('cellOf', road.cellOf, n);
    copyInto('cap', road.cap, n); copyInto('t0', road.t0, n); copyInto('comp', road.comp, n);
    copyInto('railAdj', rail.adj, 4 * rail.n); copyInto('railCellOf', rail.cellOf, rail.n);
    copyInto('subAdj', sub.adj, 4 * sub.n); copyInto('subCellOf', sub.cellOf, sub.n);
    trafficWasmStats.graphCopies++;
    syncCounts();
    const ex = w.exports as unknown as TrafficExports;
    const r = ex.traffic_check_graph(ctxPtr);
    graphOk = r === 0;
    if (r === -6) {
      // counts beyond capacities (a binding bug): not a property of the graph — validate again at the next call
      lastJsReason = `counts exceed capacities (condition ${ex.traffic_counts_check(ctxPtr)})`;
      graphKey = '';
      return false;
    }
    if (!graphOk) lastJsReason = `graph failed validation (${r})`;
    gk[0] = road.version; gk[1] = road.n; gk[2] = rail.version; gk[3] = rail.n; gk[4] = sub.version; gk[5] = sub.n; gk[6] = road.nComp;
    graphKey = key;
    return graphOk;
  }

  function bindLayerPtrs(): void {
    if (!layers || !heap || !lay) return;
    const own = (v: ArrayBufferView, bpe: number) => { const p = heap!.ptrOf(v); return p >= 0 && p % bpe === 0 ? p : -1; };
    resident = { traffic: own(layers.traffic, 4), congestion: own(layers.congestion, 4), network: own(layers.network, 1) };
    ctxU[lay.u.get('traffic')!] = resident.traffic >= 0 ? resident.traffic : offs.get('traffic')!;
    ctxU[lay.u.get('congestion')!] = resident.congestion >= 0 ? resident.congestion : offs.get('congestion')!;
    ctxU[lay.u.get('network')!] = resident.network >= 0 ? resident.network : offs.get('network')!;
  }

  function bindLayers(st: LayersLike): void {
    e.layers = st;
    layers = st;
    e.c.cells = st.cells;
    ensure({ L: st.cells });
    bindLayerPtrs();
  }

  // ---------------------------------------------------------------------------------------------- calls
  function syncCounts(): void {
    const c = e.c as unknown as Record<string, number>, u = lay!.u;
    for (const k of COUNT_NAMES) ctxU[u.get(k)!] = c[k];
  }
  function readCounts(): void {
    const c = e.c as unknown as Record<string, number>, u = lay!.u;
    for (const k of COUNT_NAMES) c[k] = ctxU[u.get(k)!];
    const f = lay!.f;
    for (let i = 0; i < 8; i++) e.out[i] = ctxF[f.get('out' + i)!];
  }
  function syncScalars(): void {
    const f = lay!.f, s = e.s as unknown as Record<string, number>;
    for (const k of SCALAR_SLOTS) ctxF[f.get(k)!] = s[k];
    // outputs a kernel does not write keep their values (as in the JS core, also after a call that ran in JS)
    for (let i = 0; i < 8; i++) ctxF[f.get('out' + i)!] = e.out[i];
  }

  /** the class a "too small" code refers to */
  const needCls: Record<number, Cls> = { [-1]: 'SD', [-5]: 'QE', [-7]: 'E', [-8]: 'G' };
  /** codes a kernel returns BEFORE changing any state (the call then runs JS) */
  const CODE: Record<number, string> = {
    [-1]: 'seed buffer too small', [-2]: 'input outside the kernel domain', [-3]: 'invalid transit net', [-4]: 'search capacity',
    [-5]: 'bucket queue too small', [-6]: 'counts exceed capacities', [-7]: 'transfer buffer too small', [-8]: 'stop bins too small',
  };

  /**
   * copies of the read-modify-write arrays of a 'snapshot' kernel (`names`: core arrays with their live lengths;
   * `layer`: the traffic layer too). Returns the restore function.
   */
  function takeSnapshot(names: readonly (readonly [string, number])[], layer: boolean): () => void {
    const parts: [Float32Array, Float32Array][] = [];
    const keep = (v: Float32Array, len: number) => {
      const k = parts.length;
      if (!snapBufs[k] || snapBufs[k].length < len) snapBufs[k] = new Float32Array(Math.max(len, 1024));
      const b = snapBufs[k].subarray(0, len);
      b.set(v.subarray(0, len));
      parts.push([v, b]);
    };
    for (const [nm, len] of names) { const v = A[nm] as Float32Array; keep(v, Math.min(len, v.length)); }
    if (layer && layers) keep(layers.traffic, layers.traffic.length);
    return () => {
      // restore into the CURRENT views (a retry may have reallocated the arena; capacities only grow)
      let k = 0;
      for (const [nm] of names) (A[nm] as Float32Array).set(parts[k++][1]);
      if (layer && layers) layers.traffic.set(parts[k][1]);
      trafficWasmStats.restores++;
    };
  }

  /** a trap (or an error in the binding around the call): report, switch this core to JS for good */
  function onTrap(name: string, err: unknown): void {
    trapped = `${name}: ${err instanceof Error ? err.message : String(err)}`;
    lastJsReason = `trap in ${trapped}`;
    trafficWasmStats.traps++;
    failed(err);
  }

  /**
   * one kernel call: wasm when possible (retrying after growth for "too small" codes), else / on a code returned before
   * any state change the JS kernel; traps are recovered per `rec` (see the header). `snap`: the arrays a 'snapshot'
   * kernel reads and writes (+ the traffic layer). `stageIn` / `stageOut`: layers the call reads / writes when staged.
   */
  function run(
    name: string, wasm: (ex: TrafficExports) => number, js: () => number, rec: Recovery,
    snap: () => readonly (readonly [string, number])[] = () => [], snapLayer = false,
    stageIn: ('traffic' | 'network')[] = [], stageOut: ('traffic' | 'congestion')[] = [],
  ): number {
    calls[name] = (calls[name] ?? 0) + 1;
    const w = live();
    let ok = false;
    if (w !== null) {
      try {
        ok = syncGraphs(w);
      } catch (err) {
        // a heap that cannot grow for the graph copies (WasmHeapFullError: that call runs JS), or a trap in
        // traffic_check_graph (reads only)
        if (err instanceof WasmHeapFullError) { lastJsReason = `${name}: ${err.message}`; failed(err); }
        else onTrap(`${name} (graph check)`, err);
        ok = false;
      }
    }
    if (!ok) {
      trafficWasmStats.jsCalls++;
      return js();
    }
    const ex = w!.exports as unknown as TrafficExports;
    let restore: (() => void) | null = null;
    try {
      let staged = false;
      for (const k of stageIn) {
        if (resident[k] >= 0) continue;
        (A[k] as Float32Array).set(layers![k] as Float32Array);
        staged = true;
      }
      if (rec === 'snapshot') restore = takeSnapshot(snap(), snapLayer);
      for (let tries = 0; ; tries++) {
        syncCounts();
        syncScalars();
        const r = wasm(ex);
        readCounts();
        const cls = needCls[r];
        if (cls !== undefined && tries < 4) {
          ensure({ [cls]: Math.max(e.c.outNeed, 1) });
          if (!live()) { trafficWasmStats.jsCalls++; return js(); }
          continue;
        }
        if (r < 0) {
          // returned before changing any state: this call runs JS on the same arrays (bit-identical by construction)
          lastJsReason = `${name}: ${CODE[r] ?? `code ${r}`}${r === -6 ? ` (condition ${ex.traffic_counts_check(ctxPtr)})` : ''}`;
          trafficWasmStats.fallbacks++;
          trafficWasmStats.jsCalls++;
          return js();
        }
        for (const k of stageOut) {
          if (resident[k] >= 0) continue;
          (layers![k] as Float32Array).set((A[k] as Float32Array).subarray(0, layers!.cells));
          staged = true;
        }
        if (staged) trafficWasmStats.stagedCalls++;
        trafficWasmStats.wasmCalls++;
        lastJsReason = '';
        return r;
      }
    } catch (err) {
      if (err instanceof WasmHeapFullError) {
        // growth for a retry failed: thrown before the retried kernel ran (no state change) -> JS for this call
        lastJsReason = `${name}: ${err.message}`;
        failed(err);
        trafficWasmStats.jsCalls++;
        return js();
      }
      onTrap(name, err);
      if (rec === 'abort') {
        trafficWasmStats.aborts++;
        throw new TrafficCycleAbortError(name, err);
      }
      restore?.();
      trafficWasmStats.jsCalls++;
      return js();
    }
  }

  const K = fairKernels;
  /** the read-modify-write arrays of the 'snapshot' kernels (live lengths) */
  const volSnap = () => [['volNew', e.c.n]] as const;
  const shopSnap = () => [['volNew', e.c.n], ['sLoad', e.c.sN]] as const;
  const railSnap = () => [['railNew', e.c.nRail]] as const;
  /** the JS fallbacks retry like the fair core (they report -need too) */
  const jsRetry = (f: () => number, cls: Cls): number => {
    for (;;) {
      const r = f();
      if (r >= 0) return r;
      ensure({ [cls]: -r });
    }
  };

  const core: TrafficWasmCore = {
    get kind() { return opts.label ?? 'wasm'; },
    env: e,
    A: A as unknown as TrafficArrays,
    c: e.c,
    s: e.s,
    out: e.out,
    P,
    calls,
    get lastJsReason() { return lastJsReason; },
    get trapped() { return trapped; },
    get arenaBytes() { return arenaBytes; },
    ensure,
    onMove(cb: () => void) { moved.push(cb); },
    bindGraphs,
    bindLayers,
    prepNodes() { run('prepNodes', (ex) => ex.traffic_prep_nodes(ctxPtr), () => (K.prepNodes(e), 0), 'redo', undefined, false, ['traffic']); },
    prepOrigins() { run('prepOrigins', (ex) => ex.traffic_prep_origins(ctxPtr), () => (K.prepOrigins(e), 0), 'redo'); },
    clusters() { run('clusters', (ex) => ex.traffic_clusters(ctxPtr), () => (K.clusters(e), 0), 'redo'); },
    prepStops() {
      ensure({ G: Math.ceil(e.c.mapN / 8) ** 2 + 1 });
      run('prepStops', (ex) => ex.traffic_prep_stops(ctxPtr), () => (K.prepStops(e), 0), 'redo');
    },
    transfers() { run('transfers', (ex) => ex.traffic_transfers(ctxPtr), () => jsRetry(() => K.transfers(e), 'E'), 'redo'); },
    transit() { run('transit', (ex) => ex.traffic_transit(ctxPtr), () => jsRetry(() => K.transit(e), 'SD'), 'redo'); },
    roundSearch(round: number) {
      ensure({ SD: e.c.qN });
      run('roundSearch', (ex) => ex.traffic_round_search(ctxPtr, round), () => (K.roundSearch(e, round), 0), 'redo');
    },
    roundMatch(round: number) { run('roundMatch', (ex) => ex.traffic_round_match(ctxPtr, round), () => (K.roundMatch(e, round), 0), 'abort'); },
    commute() { run('commute', (ex) => ex.traffic_commute(ctxPtr), () => (K.commute(e), 0), 'abort'); },
    inboundCached() { run('inboundCached', (ex) => ex.traffic_inbound_cached(ctxPtr), () => (K.inboundCached(e), 0), 'snapshot', volSnap); },
    inbound() { return run('inbound', (ex) => ex.traffic_inbound(ctxPtr), () => jsRetry(() => K.inbound(e), 'SD'), 'snapshot', volSnap); },
    shop() { return run('shop', (ex) => ex.traffic_shop(ctxPtr), () => jsRetry(() => K.shop(e), 'SD'), 'snapshot', shopSnap); },
    freight() { return run('freight', (ex) => ex.traffic_freight(ctxPtr), () => jsRetry(() => K.freight(e), 'SD'), 'snapshot', volSnap); },
    addCached(which: 0 | 1 | 2) { run('addCached', (ex) => ex.traffic_add_cached(ctxPtr, which), () => (K.addCached(e, which), 0), 'snapshot', volSnap); },
    finalize() {
      run('finalize', (ex) => ex.traffic_finalize(ctxPtr), () => (K.finalize(e), 0), 'snapshot', railSnap, true, ['traffic', 'network'], ['traffic', 'congestion']);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsub?.();
      // back to plain arrays (contents kept) so a driver can keep running on the JS kernels
      for (const a of TRAFFIC_ARRAYS) {
        const v = A[a.name] as unknown as Float32Array;
        A[a.name] = v.slice();
      }
      bindEnvViews(e);
      if (heap && arena) heap.free(arena);
      if (heap && ctxPtr) heap.free(ctxPtr);
      arena = null;
      ctxPtr = 0;
      notify();
    },
  };
  void fairDefs;
  void ALL_CLASSES;
  return core;
}

/** description of the kernel state for status reports */
export function trafficWasmInfo(core: TrafficWasmCore): { kind: string; arenaBytes: number; lastJsReason: string; calls: Record<string, number> } {
  return { kind: core.kind, arenaBytes: core.arenaBytes, lastJsReason: core.lastJsReason, calls: { ...core.calls } };
}
