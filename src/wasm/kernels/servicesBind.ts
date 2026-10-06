/**
 * WebAssembly backend of the services tier engine (src/wasm/js/servicesTierEngine.ts): `TierKernels` implemented by
 * the Rust exports of wasm/sim-kernels/src/catch.rs, on the same data layout as the JS kernels.
 *
 * Memory model (docs: wasm/README.md "Memory model"):
 *  - every engine array (reach scratch, A / unseated share / coverage accumulators, the facility table, the per-slot
 *    cache records and reach POOLS) is allocated in the kernels' linear memory through `wasmSpace()` and lives there
 *    for the life of the city: kernels use it in place, cached reaches are read in place, nothing is copied per pass;
 *  - inputs owned by the sim are used in place when they live in wasm memory (adoptLayers) and STAGED otherwise:
 *      need rasters     copied once per pass (services writes them only in prep; TierEngine.beginPass),
 *      network / water  copied at most once per scheduler step (every installed step method calls beginStep(), and the
 *                       sim edits these arrays in place only between steps), and only when a fresh reach needs them
 *                       (catch_search status 3); the access-field chamfer (accessLand) re-copies the network on every
 *                       call — it runs in steps of its own (S_ACC_LAND, S_SHOP_B), after a possible road edit,
 *      layers / fields  copied in (when read) and out per call;
 *    every staging buffer is allocated up front in `prepare()` (engine.ensure), so a kernel call never allocates;
 *    `release()` frees them (re-prepare, migration to JS memory, TierEngine.dispose);
 *  - the engine's space (wasmSpace) tracks its blocks: TierEngine.dispose() returns all of them to the WasmHeap;
 *  - scalars go through two small parameter blocks (i32 + f64) at fixed indices (CATCH_LAYOUT, mirrored from catch.rs).
 * Fallbacks: no instance (wasm unavailable, or preference 'js' for kernel 'services') -> the JS kernels run on the same
 * buffers (views of wasm memory); a network code outside the cost tables -> catch_search returns status 2 and the rest
 * of the batch runs in JS (nothing was mutated for that facility); a staging buffer too small -> that call runs in JS;
 * a wasm allocation failure -> the engine migrates to JS memory (TierEngine.migrateToJs). A trap (a bug) disables wasm
 * for the session (simWasmCallFailed) and is rethrown as a TierEngineFault: the installer restores the original
 * ServicesSystem methods.
 *
 * This file does not import the live sim modules (see kernels/services.ts), so tests / benchmarks can swap it in.
 */
import { kernelSlot, simWasmCallFailed } from '../simWasm';
import type { WasmHeap } from '../heap';
import {
  Buf, allocJS, jsKernels, reportJS, searchJS, unionJS, type PhaseArgs, type SearchArgs, type Space, type StopArgs, type TA, type TACtor,
  type TierEngine, type TierKernels,
} from '../js/servicesTierEngine';

/** parameter-block layout version (catch.rs LAYOUT) */
export const CATCH_LAYOUT = 3;

export const CATCH_EXPORTS = [
  'catch_layout', 'catch_search', 'catch_union', 'catch_alloc', 'catch_report', 'catch_finalize', 'catch_transit_cov', 'catch_footprints',
  'catch_combo', 'catch_access_land', 'catch_box3', 'catch_block_sum', 'catch_shop_taps', 'catch_reach_raw', 'catch_hypot',
] as const;

export const SERVICES_KERNEL = kernelSlot('services', CATCH_EXPORTS);

export interface CatchExports {
  catch_layout(): number;
  catch_search(ip: number, fp: number): number;
  catch_union(ip: number, fp: number): number;
  catch_alloc(ip: number, fp: number): number;
  catch_report(ip: number, fp: number): number;
  catch_finalize(ip: number, fp: number): number;
  catch_transit_cov(ip: number, fp: number): number;
  catch_footprints(ip: number): number;
  catch_combo(ip: number, fp: number): number;
  catch_access_land(ip: number, fp: number): number;
  catch_box3(ip: number): number;
  catch_block_sum(ip: number): number;
  catch_shop_taps(ip: number, fp: number): number;
  catch_reach_raw(ip: number, fp: number): number;
  catch_hypot(a: number, b: number): number;
}

/** a kernel instance: exports + its memory + the JS heap over it */
export interface CatchWasm {
  readonly ex: CatchExports;
  readonly memory: WebAssembly.Memory;
  readonly heap: WasmHeap;
}

/** the shared instance of the loader (null: unavailable, or preference 'js' for 'services'; throws when forced) */
export function catchWasmFromSlot(): CatchWasm | null {
  const i = SERVICES_KERNEL.instance();
  if (!i) return null;
  return { ex: i.exports as unknown as CatchExports, memory: i.memory, heap: i.heap };
}

/**
 * A Space in the kernels' linear memory (blocks from the WasmHeap; views re-created after growth). One space per engine:
 * it tracks its live blocks, so `freeAll()` (TierEngine.dispose) returns everything the engine allocated to the heap.
 */
export function wasmSpace(w: CatchWasm): Space {
  const live = new Map<number, number>();
  return {
    wasm: true,
    memory: w.memory,
    alloc<T extends TA>(ctor: TACtor<T>, n: number): Buf<T> {
      const bytes = Math.max(16, n * ctor.BYTES_PER_ELEMENT);
      const ptr = w.heap.alloc(bytes, 16);
      live.set(ptr, Math.ceil(bytes / 16) * 16); // the heap's block size (16-byte granules)
      const v = new ctor(w.memory.buffer, ptr, n);
      v.fill(0);
      return new Buf(ctor, n, ptr, w.memory, v);
    },
    free(b: Buf<TA>): void {
      if (b.ptr >= 0 && live.delete(b.ptr)) w.heap.free(b.ptr);
    },
    liveBytes(): number {
      let s = 0;
      for (const v of live.values()) s += v;
      return s;
    },
    freeAll(): void {
      for (const p of live.keys()) w.heap.free(p);
      live.clear();
    },
  };
}

/** a kernel trapped (a bug): wasm is disabled, the installer restores the original JS methods */
export class TierEngineFault extends Error {
  constructor(msg: string, readonly inner?: unknown) {
    super(msg);
    this.name = 'TierEngineFault';
  }
}

// ------------------------------------------------------------------------------------------------ parameter blocks
// catch.rs rx / sx / ax index constants
const R_N = 0, R_NET = 1, R_WATER = 2, R_WALK = 3, R_DRIVE = 4, R_NCOST = 5, R_RAMP = 6, R_HW = 7, R_STREET = 8, R_VISIT = 9, R_DSTAMP = 10,
  R_DIST = 11, R_TOUCHED = 12, R_BEST = 13, R_HEAD = 14, R_ENODE = 15, R_ENEXT = 16, R_EN_CAP = 17, R_FALL = 18, R_FALL_CAP = 19, R_NF_SEEN = 20,
  R_NF_QUEUE = 21, R_NF_CAP = 22, R_STAMP = 23, R_BX = 24, R_BZ = 25, R_BW = 26, R_BD = 27, R_METRIC = 28;
const S_N_FAC = 24, S_GEO = 25, S_RADIUS = 26, S_METRIC = 27, S_STR = 28, S_OP = 29, S_CAP = 30, S_KEY = 31, S_REC = 32, S_ALIVE = 33, S_FS = 34,
  S_FE = 35, S_D = 36, S_SERVED = 37, S_REC_START = 38, S_REC_END = 39, S_REC_BOX = 40, S_REC_KEY = 41, S_REC_VALID = 42, S_REC_ROAD = 43,
  S_REC_STAMP = 44, S_N_REC = 45, S_PASS = 46, S_IDX = 47, S_W = 48, S_POOL_CAP = 49, S_TOP = 50, S_DEAD = 51, S_SPLAT = 52, S_NEED = 53,
  S_A = 54, S_COV = 55, S_CURSOR = 56, S_N_FRESH = 57, S_N_CACHED = 58;
const SF_NEAR = 0, SF_ROADF = 1, SF_WORK = 2, SF_LEFT = 3, SF_LIMIT = 4, SF_USEARCH = 5, SF_UCOPY = 6, SF_UENTRY = 7;
const A_N_FAC = 0, A_CURSOR = 1, A_ORDER = 2, A_FS = 3, A_FE = 4, A_STR = 5, A_OP = 6, A_CAP = 7, A_IDX = 8, A_W = 9, A_POOL_CAP = 10, A_NEED = 11,
  A_U = 12, A_A = 13, A_COV = 14, A_C = 15, A_O1 = 16, A_O2 = 17, A_O3 = 18, A_EC = 19, A_EC_CAP = 20;
const AF_WORK = 0, AF_LEFT = 1, AF_LIMIT = 2, AF_UENTRY = 3;

/** general f32 staging buffers (layers, combo inputs / outputs, small grids) */
const N_F32_STAGE = 12;
/** need rasters staged per pass (7 services rasters + a provider raster) */
const N_NEED_STAGE = 8;

/** per-engine backend state: parameter blocks, cost tables, staging buffers (+ what they hold) */
interface Stage {
  w: CatchWasm;
  ip: Buf<Int32Array>;
  fp: Buf<Float64Array>;
  walk: Buf<Int32Array>;
  drive: Buf<Int32Array>;
  u8a: Buf<Uint8Array>;
  u8b: Buf<Uint8Array>;
  i32: Buf<Int32Array>;
  i32b: Buf<Int32Array>;
  i32c: Buf<Int32Array>;
  f32: Buf<Float32Array>[];
  need: Buf<Float32Array>[];
  needSrc: (Float32Array | null)[];
  needPass: number[];
  step: number;
  netSrc: Uint8Array | null;
  netStep: number;
  waterSrc: Uint8Array | null;
  waterStep: number;
  /** calls that ran JS although the engine is on wasm (instance missing / status 2 / staging too small) */
  jsCalls: number;
  wasmCalls: number;
}

function ptrIn(w: CatchWasm, a: ArrayBufferView): number {
  return a.buffer === w.memory.buffer ? a.byteOffset : -1;
}

/** backend statistics of an engine (tests / benchmarks) */
export function servicesBackendStats(e: TierEngine): { wasmCalls: number; jsCalls: number } | null {
  const s = e.stage as Stage | null;
  return s ? { wasmCalls: s.wasmCalls, jsCalls: s.jsCalls } : null;
}

/**
 * TierKernels on the Rust exports. `get` returns the instance to use per call (the loader's slot by default; the
 * benchmarks pass explicit scalar / SIMD instances). The engine must use `wasmSpace(get())` as its space.
 */
export function makeWasmTierKernels(get: () => CatchWasm | null = catchWasmFromSlot, name = 'wasm'): TierKernels {
  /** the stage when the engine's buffers live in the memory of the instance to use now, else null (run JS) */
  function ready(e: TierEngine): Stage | null {
    const st = e.stage as Stage | null;
    if (!st) return null;
    const w = get();
    if (!w || w.memory !== st.w.memory) { st.jsCalls++; return null; }
    return st;
  }

  function fault(err: unknown): never {
    try {
      simWasmCallFailed('services', err);
    } catch { /* forced 'wasm' mode rethrows: we throw below anyway */ }
    throw new TierEngineFault(`services wasm kernel failed: ${err instanceof Error ? err.message : String(err)}`, err);
  }

  /**
   * network / water: in place when resident, else copied at most once per scheduler step (`force`: copy now). The
   * sim mutates these arrays in place between steps (road tools, terraforming), so a copy is only reused within the
   * step that made it: every installed step method calls beginStep() first.
   */
  function stageU8(st: Stage, src: Uint8Array, which: 'net' | 'water', force = false): number {
    const p = ptrIn(st.w, src);
    if (p >= 0) return p;
    const buf = which === 'net' ? st.u8a : st.u8b;
    if (src.length > buf.n) return -1;
    if (which === 'net') {
      if (force || st.netSrc !== src || st.netStep !== st.step) { buf.v.set(src); st.netSrc = src; st.netStep = st.step; }
    } else if (force || st.waterSrc !== src || st.waterStep !== st.step) { buf.v.set(src); st.waterSrc = src; st.waterStep = st.step; }
    return buf.ptr;
  }
  /** a need raster: in place when resident, else copied once per pass */
  function stageNeed(e: TierEngine, st: Stage, src: Float32Array): number {
    const p = ptrIn(st.w, src);
    if (p >= 0) return p;
    for (let j = 0; j < N_NEED_STAGE; j++) if (st.needSrc[j] === src && st.needPass[j] === e.pass) return st.need[j].ptr;
    let q = -1;
    for (let j = 0; j < N_NEED_STAGE && q < 0; j++) if (st.needPass[j] !== e.pass) q = j;
    if (q < 0 || src.length > st.need[q].n) return -1;
    st.need[q].v.set(src);
    st.needSrc[q] = src;
    st.needPass[q] = e.pass;
    return st.need[q].ptr;
  }
  /** per-call f32 staging buffer `slot` (inputs copied in when copyIn); -1 when too small */
  function stageF32(st: Stage, src: Float32Array, slot: number, copyIn: boolean): number {
    const p = ptrIn(st.w, src);
    if (p >= 0) return p;
    const buf = st.f32[slot];
    if (src.length > buf.n) return -1;
    if (copyIn) buf.v.set(src);
    return buf.ptr;
  }
  function unstageF32(st: Stage, dst: Float32Array, p: number): void {
    if (ptrIn(st.w, dst) === p) return;
    dst.set(new Float32Array(st.w.memory.buffer, p, dst.length));
  }
  function stageI32(st: Stage, src: Int32Array, buf: Buf<Int32Array>, copyIn: boolean): number {
    const p = ptrIn(st.w, src);
    if (p >= 0) return p;
    if (src.length > buf.n) return -1;
    if (copyIn) buf.v.set(src);
    return buf.ptr;
  }

  function writeReach(st: Stage, I: Int32Array, F: Float64Array, e: TierEngine, N: number, pNet: number, pWater: number, ib: number, fb: number): void {
    I[ib + R_N] = N; I[ib + R_NET] = pNet; I[ib + R_WATER] = pWater; I[ib + R_WALK] = st.walk.ptr; I[ib + R_DRIVE] = st.drive.ptr;
    I[ib + R_NCOST] = st.walk.n; I[ib + R_RAMP] = e.K.ramp; I[ib + R_HW] = e.K.hw; I[ib + R_STREET] = e.K.street;
    I[ib + R_VISIT] = e.visit.ptr; I[ib + R_DSTAMP] = e.dstamp.ptr; I[ib + R_DIST] = e.dist.ptr; I[ib + R_TOUCHED] = e.touched.ptr;
    I[ib + R_BEST] = e.best.ptr; I[ib + R_HEAD] = e.head.ptr; I[ib + R_ENODE] = e.enode.ptr; I[ib + R_ENEXT] = e.enext.ptr;
    I[ib + R_EN_CAP] = e.enode.n; I[ib + R_FALL] = e.fall.ptr; I[ib + R_FALL_CAP] = e.fall.n; I[ib + R_NF_SEEN] = e.nfSeen.ptr;
    I[ib + R_NF_QUEUE] = e.nfQueue.ptr; I[ib + R_NF_CAP] = Math.min(e.nfSeen.n, e.nfQueue.n); I[ib + R_STAMP] = e.stamp;
    F[fb + SF_NEAR] = e.K.nearField; F[fb + SF_ROADF] = e.K.roadFactor;
  }

  /** one catch_search call with the given network / water pointers (0 = not staged) */
  function searchCall(e: TierEngine, st: Stage, a: SearchArgs, pNet: number, pWater: number, pNeed: number): number {
    const S = e.slots[a.k];
    const I = st.w.heap.I32, F = st.w.heap.F64;
    const ib = st.ip.ptr >> 2, fb = st.fp.ptr >> 3;
    writeReach(st, I, F, e, a.N, pNet, pWater, ib, fb);
    I[ib + S_N_FAC] = a.nFac; I[ib + S_GEO] = e.geo.ptr; I[ib + S_RADIUS] = e.radius.ptr; I[ib + S_METRIC] = e.metric.ptr;
    I[ib + S_STR] = e.str.ptr; I[ib + S_OP] = e.op.ptr; I[ib + S_CAP] = e.capv.ptr; I[ib + S_KEY] = e.key.ptr; I[ib + S_REC] = e.rec.ptr;
    I[ib + S_ALIVE] = e.alive.ptr; I[ib + S_FS] = e.fs.ptr; I[ib + S_FE] = e.fe.ptr; I[ib + S_D] = e.D.ptr; I[ib + S_SERVED] = e.served.ptr;
    I[ib + S_REC_START] = S.recStart.ptr; I[ib + S_REC_END] = S.recEnd.ptr; I[ib + S_REC_BOX] = S.recBox.ptr; I[ib + S_REC_KEY] = S.recKey.ptr;
    I[ib + S_REC_VALID] = S.recValid.ptr; I[ib + S_REC_ROAD] = S.recRoad.ptr; I[ib + S_REC_STAMP] = S.recStamp.ptr; I[ib + S_N_REC] = S.cap;
    I[ib + S_PASS] = a.pass; I[ib + S_IDX] = S.idx.ptr; I[ib + S_W] = S.w.ptr; I[ib + S_POOL_CAP] = S.poolCap; I[ib + S_TOP] = a.top;
    I[ib + S_DEAD] = a.dead; I[ib + S_SPLAT] = a.splat ? 1 : 0; I[ib + S_NEED] = pNeed; I[ib + S_A] = e.A.ptr; I[ib + S_COV] = e.cov.ptr;
    I[ib + S_CURSOR] = a.cursor; I[ib + S_N_FRESH] = a.nFresh; I[ib + S_N_CACHED] = a.nCached;
    F[fb + SF_WORK] = a.work; F[fb + SF_LEFT] = a.left; F[fb + SF_LIMIT] = a.limit;
    F[fb + SF_USEARCH] = 3.6; F[fb + SF_UCOPY] = 0.1; F[fb + SF_UENTRY] = 0.25;
    let status = 0;
    try {
      status = st.w.ex.catch_search(st.ip.ptr, st.fp.ptr);
    } catch (err) {
      fault(err);
    }
    const I2 = st.w.heap.I32, F2 = st.w.heap.F64;
    a.cursor = I2[ib + S_CURSOR]; a.top = I2[ib + S_TOP]; a.dead = I2[ib + S_DEAD]; a.nFresh = I2[ib + S_N_FRESH]; a.nCached = I2[ib + S_N_CACHED];
    a.R.stamp = I2[ib + R_STAMP];
    e.stamp = a.R.stamp;
    a.work = F2[fb + SF_WORK]; a.left = F2[fb + SF_LEFT];
    st.wasmCalls++;
    if (status === 2) {
      // a network code outside the cost tables: JS semantics (undefined costs) for the rest of this batch
      st.jsCalls++;
      return searchJS(a);
    }
    return status;
  }

  /** union / alloc / report parameter block (o1..o3, ec: the phase's outputs / cache) */
  function phaseCall(e: TierEngine, st: Stage, a: PhaseArgs, pNeed: number, o1: number, o2: number, o3: number, ec: number, ecCap: number,
    fn: (ip: number, fp: number) => number): void {
    const S = e.slots[a.k];
    const I = st.w.heap.I32, F = st.w.heap.F64;
    const ib = st.ip.ptr >> 2, fb = st.fp.ptr >> 3;
    I[ib + A_N_FAC] = a.nFac; I[ib + A_CURSOR] = a.cursor; I[ib + A_ORDER] = e.order.ptr; I[ib + A_FS] = e.fs.ptr; I[ib + A_FE] = e.fe.ptr;
    I[ib + A_STR] = e.str.ptr; I[ib + A_OP] = e.op.ptr; I[ib + A_CAP] = e.capv.ptr; I[ib + A_IDX] = S.idx.ptr; I[ib + A_W] = S.w.ptr;
    I[ib + A_POOL_CAP] = S.poolCap; I[ib + A_NEED] = pNeed; I[ib + A_U] = e.u.ptr; I[ib + A_A] = e.A.ptr; I[ib + A_COV] = e.cov.ptr; I[ib + A_C] = e.C;
    I[ib + A_O1] = o1; I[ib + A_O2] = o2; I[ib + A_O3] = o3; I[ib + A_EC] = ec; I[ib + A_EC_CAP] = ecCap;
    F[fb + AF_WORK] = a.work; F[fb + AF_LEFT] = a.left; F[fb + AF_LIMIT] = a.limit; F[fb + AF_UENTRY] = 0.25;
    try {
      fn(st.ip.ptr, st.fp.ptr);
    } catch (err) {
      fault(err);
    }
    const I2 = st.w.heap.I32, F2 = st.w.heap.F64;
    a.cursor = I2[ib + A_CURSOR]; a.work = F2[fb + AF_WORK]; a.left = F2[fb + AF_LEFT];
    st.wasmCalls++;
  }

  /** staging buffers + parameter blocks of an engine (allocation may throw when the heap is full) */
  function prepareStage(e: TierEngine, w: CatchWasm): void {
    const C = e.C, N = e.N;
    const sp = e.space;
    const alloc = <T extends TA>(ctor: TACtor<T>, n: number): Buf<T> => sp.alloc(ctor, n);
    const f32: Buf<Float32Array>[] = [], need: Buf<Float32Array>[] = [];
    for (let q = 0; q < N_F32_STAGE; q++) f32.push(alloc(Float32Array, Math.max(C, 4096)));
    for (let q = 0; q < N_NEED_STAGE; q++) need.push(alloc(Float32Array, C));
    const st: Stage = {
      w, ip: alloc(Int32Array, 64), fp: alloc(Float64Array, 16), walk: alloc(Int32Array, e.K.walk.length), drive: alloc(Int32Array, e.K.drive.length),
      u8a: alloc(Uint8Array, C), u8b: alloc(Uint8Array, C), i32: alloc(Int32Array, C), i32b: alloc(Int32Array, Math.max(N, 4096)),
      i32c: alloc(Int32Array, Math.max(N, 4096)), f32, need, needSrc: new Array<Float32Array | null>(N_NEED_STAGE).fill(null),
      needPass: new Array<number>(N_NEED_STAGE).fill(-1), step: 1, netSrc: null, netStep: 0, waterSrc: null, waterStep: 0, jsCalls: 0, wasmCalls: 0,
    };
    st.walk.v.set(e.K.walk);
    st.drive.v.set(e.K.drive);
    e.stage = st;
  }

  /** free an engine's staging buffers + parameter blocks (they live in the engine's space) */
  function releaseStage(e: TierEngine): void {
    const st = e.stage as Stage | null;
    e.stage = null;
    if (!st) return;
    const sp = e.space;
    for (const b of [st.ip, st.fp, st.walk, st.drive, st.u8a, st.u8b, st.i32, st.i32b, st.i32c, ...st.f32, ...st.need] as Buf<TA>[]) sp.free(b);
  }

  return {
    name,

    prepare(e: TierEngine): void {
      releaseStage(e);
      const w = get();
      if (!w || e.space.memory !== w.memory) return;
      try {
        prepareStage(e, w);
      } catch {
        // no room for the staging buffers (heap full while views are pinned): run on JS memory + JS kernels
        e.migrateToJs();
      }
    },

    release(e: TierEngine): void {
      releaseStage(e);
    },

    beginStep(e: TierEngine): void {
      const st = e.stage as Stage | null;
      if (st) st.step++;
    },

    search(e: TierEngine, a: SearchArgs): number {
      const st = ready(e);
      if (!st) return searchJS(a);
      const pNeed = a.splat ? stageNeed(e, st, a.need) : 0;
      if (pNeed < 0) { st.jsCalls++; return searchJS(a); }
      // network / water in place when resident; staged (once per step) only when a fresh reach needs them (status 3)
      let pNet = ptrIn(st.w, a.net), pWater = ptrIn(st.w, a.water);
      if (pNet < 0) pNet = st.netSrc === a.net && st.netStep === st.step ? st.u8a.ptr : 0;
      if (pWater < 0) pWater = st.waterSrc === a.water && st.waterStep === st.step ? st.u8b.ptr : 0;
      for (;;) {
        const status = searchCall(e, st, a, pNet, pWater, pNeed);
        if (status !== 3) return status;
        pNet = stageU8(st, a.net, 'net');
        pWater = stageU8(st, a.water, 'water');
        if (pNet < 0 || pWater < 0) { st.jsCalls++; return searchJS(a); }
      }
    },

    union(e: TierEngine, a: PhaseArgs): void {
      const st = ready(e);
      const pNeed = st ? stageNeed(e, st, a.need) : -1;
      if (!st || pNeed < 0) { if (st) st.jsCalls++; return unionJS(a); }
      phaseCall(e, st, a, pNeed, e.D.ptr, e.served.ptr, e.dem.ptr, e.ec.ptr, e.ec.n, st.w.ex.catch_union);
    },

    alloc(e: TierEngine, a: PhaseArgs): void {
      const st = ready(e);
      const pNeed = st ? stageNeed(e, st, a.need) : -1;
      if (!st || pNeed < 0) { if (st) st.jsCalls++; return allocJS(a); }
      phaseCall(e, st, a, pNeed, e.sig.ptr, e.seat.ptr, e.D.ptr, e.ec.ptr, e.ec.n, st.w.ex.catch_alloc);
    },

    report(e: TierEngine, a: PhaseArgs): void {
      const st = ready(e);
      const pNeed = st ? stageNeed(e, st, a.need) : -1;
      if (!st || pNeed < 0) { if (st) st.jsCalls++; return reportJS(a); }
      phaseCall(e, st, a, pNeed, e.sig.ptr, e.seat.ptr, e.dem.ptr, e.demOk.ptr, e.demOk.n, st.w.ex.catch_report);
    },

    finalize(e: TierEngine, cov: Float32Array, layer: Float32Array, transit: boolean, needL: Float32Array, A: Float32Array, out: Float64Array): void {
      const st = ready(e);
      const pNeed = st && !transit ? stageNeed(e, st, needL) : 0;
      const pLayer = st ? stageF32(st, layer, 0, false) : -1;
      if (!st || pNeed < 0 || pLayer < 0 || ptrIn(st.w, cov) < 0 || ptrIn(st.w, A) < 0) {
        if (st) st.jsCalls++;
        return jsKernels.finalize(e, cov, layer, transit, needL, A, out);
      }
      const I = st.w.heap.I32;
      const ib = st.ip.ptr >> 2, fb = st.fp.ptr >> 3;
      I[ib] = e.C; I[ib + 1] = cov.byteOffset; I[ib + 2] = pLayer; I[ib + 3] = transit ? 1 : 0; I[ib + 4] = pNeed; I[ib + 5] = A.byteOffset;
      try {
        st.w.ex.catch_finalize(st.ip.ptr, st.fp.ptr);
      } catch (err) {
        fault(err);
      }
      unstageF32(st, layer, pLayer);
      if (!transit) { const F = st.w.heap.F64; out[0] = F[fb]; out[1] = F[fb + 1]; out[2] = F[fb + 2]; }
      st.wasmCalls++;
    },

    transitCov(e: TierEngine, N: number, s: StopArgs, funding: number, tmp: Float32Array, T: Float32Array): void {
      const st = ready(e);
      const own = !!st && ptrIn(st.w, tmp) >= 0 && ptrIn(st.w, s.cell) >= 0 && ptrIn(st.w, s.R) >= 0 && ptrIn(st.w, s.factor) >= 0 && ptrIn(st.w, s.skip) >= 0;
      const pT = st && own ? stageF32(st, T, 0, true) : -1;
      if (!st || pT < 0) { if (st) st.jsCalls++; return jsKernels.transitCov(e, N, s, funding, tmp, T); }
      const I = st.w.heap.I32;
      const ib = st.ip.ptr >> 2, fb = st.fp.ptr >> 3;
      I[ib] = N; I[ib + 1] = s.n; I[ib + 2] = s.cell.byteOffset; I[ib + 3] = s.R.byteOffset; I[ib + 4] = s.factor.byteOffset;
      I[ib + 5] = s.skip.byteOffset; I[ib + 6] = tmp.byteOffset; I[ib + 7] = pT;
      st.w.heap.F64[fb] = funding;
      try {
        st.w.ex.catch_transit_cov(st.ip.ptr, st.fp.ptr);
      } catch (err) {
        fault(err);
      }
      unstageF32(st, T, pT);
      st.wasmCalls++;
    },

    footprints(e: TierEngine, N: number, nB: number, boxes: Int32Array, layers: readonly Float32Array[]): void {
      const st = ready(e);
      if (!st || layers.length > N_F32_STAGE - 1 || ptrIn(st.w, boxes) < 0) { if (st) st.jsCalls++; return jsKernels.footprints(e, N, nB, boxes, layers); }
      const ptrs: number[] = [];
      for (let l = 0; l < layers.length; l++) {
        const p = stageF32(st, layers[l], l, true);
        if (p < 0) { st.jsCalls++; return jsKernels.footprints(e, N, nB, boxes, layers); }
        ptrs.push(p);
      }
      // the layer pointer list goes into the last f32 staging buffer (as i32)
      const lp = st.f32[N_F32_STAGE - 1];
      const I = st.w.heap.I32;
      for (let l = 0; l < ptrs.length; l++) I[(lp.ptr >> 2) + l] = ptrs[l];
      const ib = st.ip.ptr >> 2;
      I[ib] = N; I[ib + 1] = nB; I[ib + 2] = boxes.byteOffset; I[ib + 3] = ptrs.length; I[ib + 4] = lp.ptr;
      try {
        st.w.ex.catch_footprints(st.ip.ptr);
      } catch (err) {
        fault(err);
      }
      for (let l = 0; l < layers.length; l++) unstageF32(st, layers[l], ptrs[l]);
      st.wasmCalls++;
    },

    combo(e: TierEngine, C: number, E: Float32Array, H: Float32Array, K: Float32Array, P: Float32Array, G: Float32Array, edu: Float32Array,
      park: Float32Array, we: number, wh: number, wc: number): void {
      const st = ready(e);
      if (!st || edu === park) return jsKernels.combo(e, C, E, H, K, P, G, edu, park, we, wh, wc);
      const pe = stageF32(st, E, 0, true), ph = stageF32(st, H, 1, true), pk = stageF32(st, K, 2, true), pp = stageF32(st, P, 3, true);
      const pg = stageF32(st, G, 4, true), pEdu = stageF32(st, edu, 5, false), pPark = stageF32(st, park, 6, false);
      if (pe < 0 || ph < 0 || pk < 0 || pp < 0 || pg < 0 || pEdu < 0 || pPark < 0) {
        st.jsCalls++;
        return jsKernels.combo(e, C, E, H, K, P, G, edu, park, we, wh, wc);
      }
      const I = st.w.heap.I32, F = st.w.heap.F64;
      const ib = st.ip.ptr >> 2, fb = st.fp.ptr >> 3;
      I[ib] = C; I[ib + 1] = pe; I[ib + 2] = ph; I[ib + 3] = pk; I[ib + 4] = pp; I[ib + 5] = pg; I[ib + 6] = pEdu; I[ib + 7] = pPark;
      F[fb] = we; F[fb + 1] = wh; F[fb + 2] = wc;
      try {
        st.w.ex.catch_combo(st.ip.ptr, st.fp.ptr);
      } catch (err) {
        fault(err);
      }
      unstageF32(st, edu, pEdu);
      unstageF32(st, park, pPark);
      st.wasmCalls++;
    },

    accessLand(e: TierEngine, N: number, net: Uint8Array, dist: Int32Array, v: Float32Array, out: Float32Array | null, scaled: boolean, scale: number,
      step: number, inf: number, unreached: number): void {
      const st = ready(e);
      // always a fresh copy (64 KiB at 256²): accessCommuteLand / shopLand are scheduler steps of their own, and a road
      // edit between the last tier step and these would otherwise leave the chamfer on a stale network
      const pNet = st ? stageU8(st, net, 'net', true) : -1;
      const pDist = st ? stageI32(st, dist, st.i32, true) : -1;
      const pOut = st && out ? stageF32(st, out, 0, false) : 0;
      if (!st || pNet < 0 || pDist < 0 || pOut < 0 || ptrIn(st.w, v) < 0) {
        if (st) st.jsCalls++;
        return jsKernels.accessLand(e, N, net, dist, v, out, scaled, scale, step, inf, unreached);
      }
      const I = st.w.heap.I32, F = st.w.heap.F64;
      const ib = st.ip.ptr >> 2, fb = st.fp.ptr >> 3;
      I[ib] = N; I[ib + 1] = pNet; I[ib + 2] = pDist; I[ib + 3] = v.byteOffset; I[ib + 4] = out ? pOut : 0; I[ib + 5] = scaled ? 1 : 0;
      F[fb] = scale; F[fb + 1] = step; F[fb + 2] = inf; F[fb + 3] = unreached;
      try {
        st.w.ex.catch_access_land(st.ip.ptr, st.fp.ptr);
      } catch (err) {
        fault(err);
      }
      if (out) unstageF32(st, out, pOut);
      st.wasmCalls++;
    },

    box3(e: TierEngine, a: Float32Array, n: number, t: Float32Array): void {
      const st = ready(e);
      const pa = st ? stageF32(st, a, 0, true) : -1;
      const pt = st ? stageF32(st, t, 1, false) : -1;
      if (!st || pa < 0 || pt < 0 || a.length < n * n || t.length < n * n) { if (st) st.jsCalls++; return jsKernels.box3(e, a, n, t); }
      const I = st.w.heap.I32;
      const ib = st.ip.ptr >> 2;
      I[ib] = n; I[ib + 1] = pa; I[ib + 2] = pt;
      try {
        st.w.ex.catch_box3(st.ip.ptr);
      } catch (err) {
        fault(err);
      }
      unstageF32(st, a, pa);
      unstageF32(st, t, pt);
      st.wasmCalls++;
    },

    blockSum(e: TierEngine, N: number, B: number, nb: number, res: Float32Array, pop: Float32Array): void {
      const st = ready(e);
      const pr = st ? stageF32(st, res, 0, true) : -1;
      const pp = st ? stageF32(st, pop, 1, true) : -1;
      if (!st || pr < 0 || pp < 0 || !(B >= 1) || B !== (B | 0) || pop.length < nb * nb || Math.ceil(N / B) > nb || res.length < N * N) {
        if (st) st.jsCalls++;
        return jsKernels.blockSum(e, N, B, nb, res, pop);
      }
      const I = st.w.heap.I32;
      const ib = st.ip.ptr >> 2;
      I[ib] = N; I[ib + 1] = B; I[ib + 2] = nb; I[ib + 3] = pr; I[ib + 4] = pp;
      try {
        st.w.ex.catch_block_sum(st.ip.ptr);
      } catch (err) {
        fault(err);
      }
      unstageF32(st, pop, pp);
      st.wasmCalls++;
    },

    shopTaps(e: TierEngine, N: number, nb: number, B: number, v: Float32Array, ratio: Float32Array, lut: Float32Array, cx0: Int32Array, cx1: Int32Array,
      ct: Float32Array, out: Float32Array, capQ: number, base: number): void {
      const st = ready(e);
      const ok = !!st && ptrIn(st.w, v) >= 0 && B >= 1 && B === (B | 0) && lut.length >= Math.floor(capQ) + 1 && ratio.length >= nb * nb &&
        cx0.length >= N && cx1.length >= N && ct.length >= N;
      const pr = ok ? stageF32(st!, ratio, 1, true) : -1, pl = ok ? stageF32(st!, lut, 2, true) : -1, pt = ok ? stageF32(st!, ct, 3, true) : -1;
      const p0 = ok ? stageI32(st!, cx0, st!.i32b, true) : -1, p1 = ok ? stageI32(st!, cx1, st!.i32c, true) : -1;
      const po = ok ? stageF32(st!, out, 0, false) : -1;
      if (!st || !ok || pr < 0 || pl < 0 || pt < 0 || p0 < 0 || p1 < 0 || po < 0) {
        if (st) st.jsCalls++;
        return jsKernels.shopTaps(e, N, nb, B, v, ratio, lut, cx0, cx1, ct, out, capQ, base);
      }
      const I = st.w.heap.I32, F = st.w.heap.F64;
      const ib = st.ip.ptr >> 2, fb = st.fp.ptr >> 3;
      I[ib] = N; I[ib + 1] = nb; I[ib + 2] = B; I[ib + 3] = v.byteOffset; I[ib + 4] = pr; I[ib + 5] = pl; I[ib + 6] = lut.length; I[ib + 7] = p0;
      I[ib + 8] = p1; I[ib + 9] = pt; I[ib + 10] = po;
      F[fb] = capQ; F[fb + 1] = base;
      try {
        st.w.ex.catch_shop_taps(st.ip.ptr, st.fp.ptr);
      } catch (err) {
        fault(err);
      }
      unstageF32(st, out, po);
      st.wasmCalls++;
    },
  };
}

/**
 * catchments.reachRaw on the wasm kernel (tests / micro-benchmarks): touched[0..n) / best[] in the engine scratch.
 * Returns n, or -1 when a network code is outside the cost tables (or the engine is not on wasm).
 */
export function reachRawWasm(e: TierEngine, N: number, net: Uint8Array, water: Uint8Array, bx: number, bz: number, bw: number, bd: number,
  radius: number, metric: number): number {
  const st = e.stage as Stage | null;
  if (!st || N * N > st.u8a.n) return -1;
  const pNet = ptrIn(st.w, net) >= 0 ? net.byteOffset : (st.u8a.v.set(net), st.u8a.ptr);
  const pWater = ptrIn(st.w, water) >= 0 ? water.byteOffset : (st.u8b.v.set(water), st.u8b.ptr);
  st.netSrc = null;
  st.waterSrc = null;
  const I = st.w.heap.I32, F = st.w.heap.F64;
  const ib = st.ip.ptr >> 2, fb = st.fp.ptr >> 3;
  I[ib + R_N] = N; I[ib + R_NET] = pNet; I[ib + R_WATER] = pWater; I[ib + R_WALK] = st.walk.ptr; I[ib + R_DRIVE] = st.drive.ptr;
  I[ib + R_NCOST] = st.walk.n; I[ib + R_RAMP] = e.K.ramp; I[ib + R_HW] = e.K.hw; I[ib + R_STREET] = e.K.street;
  I[ib + R_VISIT] = e.visit.ptr; I[ib + R_DSTAMP] = e.dstamp.ptr; I[ib + R_DIST] = e.dist.ptr; I[ib + R_TOUCHED] = e.touched.ptr;
  I[ib + R_BEST] = e.best.ptr; I[ib + R_HEAD] = e.head.ptr; I[ib + R_ENODE] = e.enode.ptr; I[ib + R_ENEXT] = e.enext.ptr;
  I[ib + R_EN_CAP] = e.enode.n; I[ib + R_FALL] = e.fall.ptr; I[ib + R_FALL_CAP] = e.fall.n; I[ib + R_NF_SEEN] = e.nfSeen.ptr;
  I[ib + R_NF_QUEUE] = e.nfQueue.ptr; I[ib + R_NF_CAP] = Math.min(e.nfSeen.n, e.nfQueue.n); I[ib + R_STAMP] = e.stamp;
  I[ib + R_BX] = bx; I[ib + R_BZ] = bz; I[ib + R_BW] = bw; I[ib + R_BD] = bd; I[ib + R_METRIC] = metric;
  F[fb] = e.K.nearField; F[fb + 1] = e.K.roadFactor; F[fb + 2] = radius;
  const n = st.w.ex.catch_reach_raw(st.ip.ptr, st.fp.ptr);
  e.stamp = st.w.heap.I32[ib + R_STAMP];
  return n;
}
