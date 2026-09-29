/**
 * WebAssembly bindings of the field-pass kernels (wasm/sim-kernels/src/fields.rs), built around a JS implementation:
 * makeFieldKernels(js) returns the same FieldKernels (same signatures, bit-identical results) running the Rust kernels
 * when the 'fields' kernel slot is active and the arguments are in the supported domain, and `js` otherwise (in practice
 * the restructured JS of src/wasm/js/fieldPasses.ts).
 *
 * Memory: every array argument is either RESIDENT (it lives in the kernels' WebAssembly.Memory — CityState layers moved
 * there with adoptLayers(), PollutionSystem arrays adopted the same way: its own offset is passed, zero copy) or STAGED
 * (a plain typed array: copied into a scratch block before the call; outputs are copied back after it). Mixed calls
 * are fine. Kernel-owned state lives in wasm memory and is addressed by offsets kept here: the NIMBY accumulators
 * (stigma / prestige / campus / corridor line f32[C]) and the corridor class map (u8[C]) per NimbyCtx, the kernel tables
 * (row runs, uploaded once per table and instance) and the SAT table. Allocation happens before any write, so a full
 * heap (WasmHeapFullError: views are pinned and memory may not grow) makes that call run JS with nothing modified.
 *
 * Domain (anything else runs `js`): integer sizes (N in 1..32767, C = N² for NIMBY), arrays of the expected types and
 * lengths, outputs not overlapping any other argument, source coordinates |x|, |z| < 2^30, table ids of the given
 * registry, SAT scale > 0 and finite, network codes < 8 for the cell loop. The kernels themselves cannot trap on such
 * arguments (scatter lists skip out-of-range indices exactly like the JS stores do; the water kernel checks its lists
 * before writing and reports 1, then the call runs JS).
 * Math: the kernels use the fdlibm ports of V8's Math.exp / Math.log (fdlibm.rs). Before the first call per instance a
 * self-test compares them bit for bit with this engine's Math.exp / Math.log on the arguments of these passes
 * (exp(−x), x in (0, 60] and specials; log(1 − a), a in [0, 0.95]); any difference makes every call run JS.
 * NIMBY must be called with all phases at once (PH_ALL) by the sim: the JS fallback recomputes a whole rebuild.
 *
 * This file does not import src/sim (src/wasm/kernels/fieldPasses.ts binds the live modules), so tests and benchmarks
 * can swap it into the systems without an import cycle.
 */
import { kernelSlot, simWasmCallFailed } from '../simWasm';
import { scratchSlot, type WasmHeap } from '../heap';
import { gridOk, overlaps } from '../bind';
import {
  PH_ALL, SAT_N, SAT_TABLE, WATER_CLEAN, WATER_DIFFUSE_KEEP, WATER_INFLOW, WATER_ITERS, SAT_MAX,
  type CellsArgs, type FieldKernels, type NimbyArgs, type NimbyCtx, type NimbyResult, type NimbyTables, type WaterArgs,
} from '../js/fieldPasses';

/** parameter-block layout version (fields.rs LAYOUT) */
export const FIELDS_LAYOUT = 1;

export interface FieldsExports {
  memory: WebAssembly.Memory;
  fields_layout(): number;
  fields_nimby(ip: number, fp: number, phases: number): number;
  fields_cells(ip: number, fp: number): number;
  fields_saturate(ip: number, fp: number): number;
  fields_water(ip: number, fp: number): number;
  fields_soil(soil: number, src: number, c: number, grow: number, keep: number): number;
  fields_math_batch(x: number, out: number, n: number, which: number): void;
}

export const FIELDS_KERNEL = kernelSlot('fields', ['fields_layout', 'fields_nimby', 'fields_cells', 'fields_saturate', 'fields_water', 'fields_soil', 'fields_math_batch']);

/** an explicit kernel instance (benchmarks: scalar / SIMD builds); default: the loader's instance */
export interface FieldsWasm {
  ex: FieldsExports;
  heap: WasmHeap;
}

/** per-binding counters (benchmarks / tests) */
export interface FieldsBindStats {
  wasmCalls: number;
  jsCalls: number;
  /** bytes copied into / out of wasm memory by staging */
  bytesIn: number;
  bytesOut: number;
}

// ------------------------------------------------------------------------------------------------ fields.rs ix / fx
// fields_nimby
const N_N = 0, N_NSRC = 1, N_SRC = 2, N_AMT = 3, N_STIG = 4, N_PRES = 5, N_CAMP = 6, N_LINE = 7, N_ZONE = 8, N_FILL = 9, N_LF_CODE = 10,
  N_LF_TAB = 11, N_NET = 12, N_FLAGS = 13, N_CLS = 14, N_VALID = 15, N_FORCE = 16, N_TAB_H = 17, N_TAB_R = 18, N_HIGHWAY = 19, N_RAIL = 20,
  N_S = 21, N_P = 22, N_K = 23, N_OUT_LF = 24, N_OUT_CHANGED = 25, N_OUT_NH = 26, N_OUT_NR = 27, N_TABS = 28, N_NTABS = 29, N_LEN = 30;
const NF_LF_A = 0, NF_LF_IDLE = 1, NF_A_H = 2, NF_A_HB = 3, NF_A_R = 4, NF_LEN = 5;
// fields_cells
const C_C = 0, C_GARBAGE = 1, C_BUILDING = 2, C_SOIL = 3, C_NET = 4, C_TRAFFIC = 5, C_CONG = 6, C_FLAGS = 7, C_A0 = 8, C_W0 = 9, C_N0 = 10,
  C_SOIL_SRC = 11, C_FREIGHT = 12, C_NFREIGHT = 13, C_LF_ORDER = 14, C_LF_ORDER_LEN = 15, C_NREG = 16, C_REG = 17, C_REG_F = 18,
  C_HIGHWAY = 19, C_RAIL = 20, C_LEN = 21;
const CF_SMELL = 0, CF_WATER_K = 1, CF_SOIL_GW = 2, CF_TRAFFIC_AIR = 3, CF_TUNNEL_AIR = 4, CF_CONG_DAMP = 5, CF_CROSSING = 6,
  CF_NOISE_PER_TRIP = 7, CF_TUNNEL_NOISE = 8, CF_BRIDGE_NOISE = 9, CF_TN = 10, CF_FREIGHT_S = 11, CF_PER_TRIP = 12, CF_BASE = 20, CF_LEN = 28;
// fields_saturate
const S_C = 0, S_FIELD = 1, S_L = 2, S_MASK = 3, S_BUF1 = 4, S_BUF2 = 5, S_SAT = 6, S_LEN = 7;
const SF_SCALE = 0, SF_ALPHA = 1, SF_K1 = 2, SF_K2 = 3, SF_LEN = 4;
// fields_water
const W_C = 0, W_TMP = 1, W_TMP2 = 2, W_L = 3, W_GROUND = 4, W_WATER = 5, W_SAT = 6, W_CELLS = 7, W_NW = 8, W_NB = 9, W_BANK = 10,
  W_BANK_SRC = 11, W_NBANK = 12, W_ITERS = 13, W_INFL = 14, W_NDIV = 15, W_WLIST = 16, W_CUR = 17, W_NXT = 18, W_LEN = 19;
const WF_SCALE = 0, WF_ALPHA = 1, WF_KEEP = 2, WF_INFLOW = 3, WF_CLEAN = 4, WF_BANK = 5, WF_LEN = 6;

// staging / scratch slots of this module (bindings never run concurrently: the kernels share them)
const SL_IP = scratchSlot(), SL_FP = scratchSlot();
const SL_ARR: number[] = Array.from({ length: 12 }, () => scratchSlot());
const SL_SRC = scratchSlot(), SL_AMT = scratchSlot(), SL_LIST1 = scratchSlot(), SL_LIST2 = scratchSlot(), SL_LIST3 = scratchSlot(),
  SL_LIST4 = scratchSlot(), SL_W1 = scratchSlot(), SL_W2 = scratchSlot(), SL_W3 = scratchSlot(), SL_W4 = scratchSlot(), SL_W5 = scratchSlot();

type Arr = Float32Array | Uint8Array | Int32Array;
const isInt = (v: number): boolean => v === (v | 0);

// ------------------------------------------------------------------------------------------------ per instance
interface InstState {
  ok: boolean;
  /** SAT table block */
  sat: number;
  /** uploaded kernel tables per registry: offsets by id + the directory block */
  tables: Map<NimbyTables, { offsets: number[]; dir: number; dirCap: number; dirLen: number }>;
}
const insts = new WeakMap<FieldsExports, InstState>();

/** the kernels' exp / log against this engine's Math.exp / Math.log, bit for bit (see the file comment) */
export function fieldsMathSelfTest(w: FieldsWasm, n = 12000): boolean {
  const h = w.heap, ex = w.ex;
  const p = h.alloc(16 * n + 64, 16);
  try {
    const X = new Float64Array(h.memory.buffer, p, n);
    let s = 0x2545f491;
    const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const special = [0, -0, 1, -1, 0.5, -0.5, 2, Infinity, -Infinity, NaN, 1e-300, 5e-324, -5e-324, -1e-45, -1.401298464324817e-45,
      -709.78, -709.79, -745.13, -745.14, 0.05, 0.95, 0.9985, 1 - 0.95, -0.35, -0.3466, -60, -16, -1e-9, -3.4028234663852886e38];
    const same = (a: number, b: number) => Object.is(a, b) || (a !== a && b !== b);
    for (const which of [0, 1]) {
      for (let i = 0; i < n; i++) {
        const m = i % 4;
        if (i < special.length) X[i] = special[i];
        else if (which === 0) X[i] = m === 0 ? -r() * 60 : m === 1 ? -r() * 2 : m === 2 ? -Math.fround(r() * 8) : -(r() ** 6) * 20;
        // log(1 - a): a = min(0.95, |I|), I = SOIL_GROUNDWATER · soil (f32 soil), catalog intensities
        else X[i] = m === 0 ? 1 - Math.min(0.95, 0.3 * Math.fround(r())) : m === 1 ? 1 - r() * 0.95 : m === 2 ? 0.05 + r() * 0.95 : 1 - Math.min(0.95, Math.fround(r() * 1.2));
      }
      const O = p + 8 * n;
      ex.fields_math_batch(p, O, n, which);
      const R = new Float64Array(h.memory.buffer, O, n), Xv = new Float64Array(h.memory.buffer, p, n);
      const f = which ? Math.log : Math.exp;
      for (let i = 0; i < n; i++) if (!same(f(Xv[i]), R[i])) return false;
    }
    return true;
  } finally {
    h.free(p);
  }
}

function instState(w: FieldsWasm): InstState | null {
  let s = insts.get(w.ex);
  if (s === undefined) {
    let ok = false;
    let sat = 0;
    try {
      ok = typeof w.ex.fields_layout === 'function' && w.ex.fields_layout() === FIELDS_LAYOUT;
      if (!ok) console.warn(`[simWasm] fields kernels: parameter layout ${String(w.ex.fields_layout?.())} != ${FIELDS_LAYOUT} (stale binary? npm run build:wasm), running JS`);
      else if (!fieldsMathSelfTest(w)) {
        ok = false;
        console.warn("[simWasm] fields kernels: this engine's Math.exp / Math.log differ from the kernels' fdlibm, running JS");
      } else {
        sat = w.heap.alloc((SAT_N + 1) * 4, 16);
        w.heap.F32.set(SAT_TABLE, sat >> 2);
      }
    } catch {
      // WasmHeapFullError etc.: decide again next time
      return null;
    }
    s = { ok, sat, tables: new Map() };
    insts.set(w.ex, s);
  }
  return s.ok ? s : null;
}

/** upload the registry's tables that are not in this instance yet; returns the directory (offsets by id) */
function tableDir(w: FieldsWasm, s: InstState, reg: NimbyTables): { dir: number; len: number } {
  let t = s.tables.get(reg);
  if (!t) s.tables.set(reg, (t = { offsets: [], dir: 0, dirCap: 0, dirLen: 0 }));
  const h = w.heap;
  const list = reg.list;
  if (t.offsets.length < list.length) {
    // allocate every missing block first (allocation may grow memory, or throw WasmHeapFullError: then nothing leaks
    // and nothing was written), then write
    const start = t.offsets.length;
    const ptrs: number[] = [];
    let dir = t.dir;
    const grow = t.dirCap < list.length;
    const cap = grow ? Math.max(64, list.length * 2) : t.dirCap;
    try {
      for (let id = start; id < list.length; id++) {
        const tb = list[id];
        ptrs.push(h.alloc(8 + 12 * tb.nRuns + 4 * tb.n, 16));
      }
      if (grow) dir = h.alloc(cap * 4, 16);
    } catch (e) {
      for (const p of ptrs) h.free(p);
      throw e;
    }
    if (grow) {
      if (t.dir) h.free(t.dir);
      t.dir = dir;
      t.dirCap = cap;
    }
    const I32 = h.I32, F32 = h.F32;
    for (let k = 0; k < ptrs.length; k++) {
      const tb = list[start + k], p = ptrs[k];
      I32[p >> 2] = tb.nRuns;
      I32[(p >> 2) + 1] = tb.n;
      I32.set(tb.runs, (p >> 2) + 2);
      F32.set(tb.w, (p >> 2) + 2 + 3 * tb.nRuns);
      t.offsets.push(p);
    }
    I32.set(t.offsets, dir >> 2);
    t.dirLen = t.offsets.length;
  } else if (t.dirLen !== t.offsets.length) {
    h.I32.set(t.offsets, t.dir >> 2);
    t.dirLen = t.offsets.length;
  }
  return { dir: t.dir, len: t.offsets.length };
}

/** NIMBY buffers of one context in one instance (kernel-owned: offsets only) */
interface WasmNimbyBuf {
  ex: FieldsExports;
  heap: WasmHeap;
  C: number;
  block: number;
  stig: number;
  pres: number;
  camp: number;
  line: number;
  cls: number;
  valid: boolean;
}

/** free the kernel-owned NIMBY buffers of a context (city unload / replaceState); the JS buffers are GC'd with it */
export function releaseNimbyCtx(ctx: NimbyCtx): void {
  const b = ctx.wasm as WasmNimbyBuf | undefined;
  if (b) {
    b.heap.free(b.block);
    ctx.wasm = undefined;
  }
}

function nimbyBuf(ctx: NimbyCtx, w: FieldsWasm, C: number): WasmNimbyBuf {
  let b = ctx.wasm as WasmNimbyBuf | undefined;
  if (b && b.ex === w.ex && b.C === C) return b;
  if (b) releaseNimbyCtx(ctx);
  const f = Math.ceil((C * 4) / 16) * 16, u = Math.ceil(C / 16) * 16;
  const block = w.heap.alloc(4 * f + u, 16);
  b = { ex: w.ex, heap: w.heap, C, block, stig: block, pres: block + f, camp: block + 2 * f, line: block + 3 * f, cls: block + 4 * f, valid: false };
  ctx.wasm = b;
  return b;
}

// ------------------------------------------------------------------------------------------------ staging
interface Staging {
  h: WasmHeap;
  stats?: FieldsBindStats;
  /** staged outputs to copy back: [array, ptr, len] */
  outs: [Arr, number, number][];
  slot: number;
}

const residentPtr = (h: WasmHeap, a: Arr): number => {
  const p = h.ptrOf(a);
  return p >= 0 && p % a.BYTES_PER_ELEMENT === 0 ? p : -1;
};

/** pointer of an array argument: its own offset (resident) or a scratch block (copied in when `input`) */
function stage(g: Staging, a: Arr, len: number, input: boolean, output: boolean, slot = -1): number {
  const h = g.h;
  const p0 = residentPtr(h, a);
  if (p0 >= 0) return p0;
  const s = slot >= 0 ? slot : SL_ARR[g.slot++];
  const bytes = len * a.BYTES_PER_ELEMENT;
  const p = h.scratch(s, Math.max(16, bytes), 16);
  if (input && len > 0) {
    const src = a.length === len ? a : a.subarray(0, len);
    if (a instanceof Float32Array) h.F32.set(src as Float32Array, p >> 2);
    else if (a instanceof Int32Array) h.I32.set(src as Int32Array, p >> 2);
    else h.U8.set(src as Uint8Array, p);
    if (g.stats) g.stats.bytesIn += bytes;
  }
  if (output) g.outs.push([a, p, len]);
  return p;
}

function unstage(g: Staging): void {
  const h = g.h;
  for (const [a, p, len] of g.outs) {
    if (len === 0) continue;
    if (a instanceof Float32Array) a.set(h.F32.subarray(p >> 2, (p >> 2) + len));
    else if (a instanceof Int32Array) a.set(h.I32.subarray(p >> 2, (p >> 2) + len));
    else a.set(h.U8.subarray(p, p + len));
    if (g.stats) g.stats.bytesOut += len * a.BYTES_PER_ELEMENT;
  }
  g.outs.length = 0;
}

/** outputs must not overlap each other or any input (resident arrays share one buffer) */
function disjoint(outs: Arr[], ins: (Arr | null)[]): boolean {
  for (let a = 0; a < outs.length; a++) {
    for (const b of ins) if (b !== null && overlaps(outs[a], b)) return false;
    for (let b = a + 1; b < outs.length; b++) if (overlaps(outs[a], outs[b])) return false;
  }
  return true;
}

const f32ok = (a: unknown, n: number): a is Float32Array => a instanceof Float32Array && a.length >= n;
const u8ok = (a: unknown, n: number): a is Uint8Array => a instanceof Uint8Array && a.length >= n;
const i32ok = (a: unknown, n: number): a is Int32Array => a instanceof Int32Array && a.length >= n;

/** an ArrayLike<number> as int32 values: typed int arrays as they are; else the integer entries (others are no-ops in JS) */
function intList(v: ArrayLike<number>): Int32Array {
  if (v instanceof Int32Array) return v;
  const out = new Int32Array(v.length);
  let n = 0;
  for (let k = 0; k < v.length; k++) {
    const x = v[k];
    // a non-integer index is a no-op store in the JS (and so is one outside int32: always >= C)
    if (x === Math.floor(x) && x >= -2147483648 && x <= 2147483647) out[n++] = x;
  }
  return n === v.length ? out : out.subarray(0, n);
}

// ------------------------------------------------------------------------------------------------ the kernels
/** field-pass kernels that run the wasm kernels when possible and `js` otherwise */
export function makeFieldKernels(js: FieldKernels, opts: { wasm?: FieldsWasm; stats?: FieldsBindStats; onError?: (e: unknown) => void; label?: string } = {}): FieldKernels {
  const stats = opts.stats;
  const onError = opts.onError ?? ((e: unknown) => simWasmCallFailed('fields', e));

  const instance = (): { w: FieldsWasm; s: InstState } | null => {
    let w: FieldsWasm | null = opts.wasm ?? null;
    if (!w) {
      const inst = FIELDS_KERNEL.instance();
      if (inst === null) return null;
      w = { ex: inst.exports as unknown as FieldsExports, heap: inst.heap };
    }
    const s = instState(w);
    return s ? { w, s } : null;
  };
  const toJs = () => { if (stats) stats.jsCalls++; };
  const done = () => { if (stats) stats.wasmCalls++; };

  // ---------------------------------------------------------------------------------------------- NIMBY
  const nimbyDomain = (a: NimbyArgs): boolean => {
    const N = a.N;
    if (!gridOk(N)) return false;
    const C = N * N;
    if (!u8ok(a.zone, C) || !u8ok(a.net, C) || !u8ok(a.flags, C) || !f32ok(a.S, C) || !f32ok(a.P, C) || !f32ok(a.K, C)) return false;
    if (a.fill !== null && !f32ok(a.fill, C)) return false;
    if (!isInt(a.lfCode) || a.lfCode < 0 || a.lfCode > 255 || !isInt(a.highway) || !isInt(a.rail) || a.highway < 0 || a.highway > 255 || a.rail < 0 || a.rail > 255) return false;
    // (the SIMD class scan gives a code that is both highway and rail two classes)
    if (a.highway === a.rail) return false;
    const reg = a.src.tables, nt = reg.list.length;
    if (reg.list[a.tabH.id] !== a.tabH || reg.list[a.tabR.id] !== a.tabR || (a.lfTable !== null && reg.list[a.lfTable.id] !== a.lfTable)) return false;
    const rec = a.src.rec;
    for (let s = 0, n = a.src.n; s < n; s++) {
      const o = 4 * s;
      const x = rec[o], z = rec[o + 1], t = rec[o + 2], id = rec[o + 3];
      if (x < -0x40000000 || x > 0x40000000 || z < -0x40000000 || z > 0x40000000 || t < 0 || t > 2 || id < 0 || id >= nt) return false;
    }
    return disjoint([a.S, a.P, a.K], [a.zone, a.fill, a.net, a.flags]);
  };

  const nimby = (ctx: NimbyCtx, a: NimbyArgs, phases = PH_ALL): NimbyResult => {
    const inst = instance();
    if (inst === null || !nimbyDomain(a)) { toJs(); return js.nimby(ctx, a, phases); }
    const { w, s } = inst;
    const h = w.heap, ex = w.ex;
    const N = a.N, C = N * N;
    let buf: WasmNimbyBuf | null = null;
    try {
      // allocations first (may grow memory / throw WasmHeapFullError before anything is written)
      buf = nimbyBuf(ctx, w, C);
      const dir = tableDir(w, s, a.src.tables);
      const g: Staging = { h, stats, outs: [], slot: 0 };
      const ns = a.src.n;
      const ip = h.scratch(SL_IP, N_LEN * 4, 16), fp = h.scratch(SL_FP, NF_LEN * 8, 16);
      const src = h.scratch(SL_SRC, Math.max(16, 16 * ns), 16), amt = h.scratch(SL_AMT, Math.max(16, 8 * ns), 16);
      const pZone = (phases & 2) ? stage(g, a.zone, C, true, false) : 0;
      const pFill = (phases & 2) && a.fill !== null ? stage(g, a.fill, C, true, false) : 0;
      const pNet = (phases & 4) ? stage(g, a.net, C, true, false) : 0;
      const pFlags = (phases & 4) ? stage(g, a.flags, C, true, false) : 0;
      const pS = (phases & 8) ? stage(g, a.S, C, false, true) : 0;
      const pP = (phases & 8) ? stage(g, a.P, C, false, true) : 0;
      const pK = (phases & 8) ? stage(g, a.K, C, false, true) : 0;
      const I32 = h.I32, F64 = h.F64;
      if (ns > 0) {
        I32.set(a.src.rec.subarray(0, 4 * ns), src >> 2);
        F64.set(a.src.amt.subarray(0, ns), amt >> 3);
        if (stats) stats.bytesIn += 24 * ns;
      }
      const o = ip >> 2;
      I32.fill(0, o, o + N_LEN);
      I32[o + N_N] = N; I32[o + N_NSRC] = ns; I32[o + N_SRC] = src; I32[o + N_AMT] = amt;
      I32[o + N_STIG] = buf.stig; I32[o + N_PRES] = buf.pres; I32[o + N_CAMP] = buf.camp; I32[o + N_LINE] = buf.line;
      I32[o + N_ZONE] = pZone; I32[o + N_FILL] = pFill; I32[o + N_LF_CODE] = a.lfCode; I32[o + N_LF_TAB] = a.lfTable ? a.lfTable.id : -1;
      I32[o + N_NET] = pNet; I32[o + N_FLAGS] = pFlags; I32[o + N_CLS] = buf.cls; I32[o + N_VALID] = buf.valid ? 1 : 0;
      I32[o + N_FORCE] = a.force ? 1 : 0; I32[o + N_TAB_H] = a.tabH.id; I32[o + N_TAB_R] = a.tabR.id;
      I32[o + N_HIGHWAY] = a.highway; I32[o + N_RAIL] = a.rail;
      I32[o + N_S] = pS; I32[o + N_P] = pP; I32[o + N_K] = pK;
      I32[o + N_TABS] = dir.dir; I32[o + N_NTABS] = dir.len;
      const f = fp >> 3;
      F64[f + NF_LF_A] = a.lfA; F64[f + NF_LF_IDLE] = a.lfIdle; F64[f + NF_A_H] = a.aH; F64[f + NF_A_HB] = a.aHB; F64[f + NF_A_R] = a.aR;
      if (phases & 4) buf.valid = false;
      ex.fields_nimby(ip, fp, phases);
      const I = h.I32;
      const res: NimbyResult = { lf: I[o + N_OUT_LF], changed: I[o + N_OUT_CHANGED] !== 0, nh: I[o + N_OUT_NH], nr: I[o + N_OUT_NR] };
      if (phases & 4) buf.valid = true;
      unstage(g);
      done();
      return res;
    } catch (e) {
      if (buf) buf.valid = false;
      onError(e);
      toJs();
      return js.nimby(ctx, a, phases);
    }
  };

  // ---------------------------------------------------------------------------------------------- cells
  const cells = (p: CellsArgs): number => {
    const inst = instance();
    const C = p.C;
    const ok = inst !== null && C === (C | 0) && C >= 0 &&
      f32ok(p.garbage, C) && i32ok(p.building, C) && f32ok(p.soil, C) && u8ok(p.network, C) && f32ok(p.traffic, C) && f32ok(p.congestion, C) &&
      u8ok(p.netFlags, C) && f32ok(p.A0, C) && f32ok(p.W0, C) && f32ok(p.N0, C) && f32ok(p.soilSrc, C) && p.lfOrder instanceof Int32Array &&
      isInt(p.highway) && isInt(p.rail) && p.highway >= 0 && p.highway < 8 && p.rail >= 0 && p.rail < 8 && isInt(p.nReg) && p.nReg >= 0 &&
      p.regStart.length >= p.nReg && p.regCount.length >= p.nReg && p.regAdd.length >= 4 * p.nReg &&
      disjoint([p.A0, p.W0, p.N0, p.soilSrc], [p.garbage, p.building, p.soil, p.network, p.traffic, p.congestion, p.netFlags, p.lfOrder]);
    if (!ok) { toJs(); return js.cells(p); }
    // region starts / counts must be integers (else the JS indexes lfOrder with a non-integer: undefined, no-op stores)
    const nReg = p.nReg;
    for (let r = 0; r < nReg; r++) if (!isInt(p.regStart[r]) || !isInt(p.regCount[r])) { toJs(); return js.cells(p); }
    const { w } = inst!;
    const h = w.heap, ex = w.ex;
    try {
      const g: Staging = { h, stats, outs: [], slot: 0 };
      const fr = p.freight && p.freight.length > 0 ? intList(p.freight) : null;
      const ip = h.scratch(SL_IP, C_LEN * 4, 16), fp = h.scratch(SL_FP, CF_LEN * 8, 16);
      const pG = stage(g, p.garbage, C, true, false), pB = stage(g, p.building, C, true, false), pSo = stage(g, p.soil, C, true, false);
      const pNet = stage(g, p.network, C, true, false), pT = stage(g, p.traffic, C, true, false), pCg = stage(g, p.congestion, C, true, false);
      const pNf = stage(g, p.netFlags, C, true, false);
      const pA = stage(g, p.A0, C, true, true), pW = stage(g, p.W0, C, true, true), pN = stage(g, p.N0, C, true, true);
      const pSs = nReg > 0 ? stage(g, p.soilSrc, C, true, true) : 0;
      const pFr = fr ? stage(g, fr, fr.length, true, false, SL_LIST1) : 0;
      const pOrd = nReg > 0 ? stage(g, p.lfOrder, p.lfOrder.length, true, false, SL_LIST2) : 0;
      const pReg = nReg > 0 ? h.scratch(SL_LIST3, 8 * nReg, 16) : 0;
      const pRegF = nReg > 0 ? h.scratch(SL_LIST4, 32 * nReg, 16) : 0;
      const I32 = h.I32, F64 = h.F64;
      for (let r = 0; r < nReg; r++) { I32[(pReg >> 2) + 2 * r] = p.regStart[r]; I32[(pReg >> 2) + 2 * r + 1] = p.regCount[r]; }
      if (nReg > 0) F64.set(p.regAdd.subarray(0, 4 * nReg), pRegF >> 3);
      const o = ip >> 2;
      I32[o + C_C] = C; I32[o + C_GARBAGE] = pG; I32[o + C_BUILDING] = pB; I32[o + C_SOIL] = pSo; I32[o + C_NET] = pNet; I32[o + C_TRAFFIC] = pT;
      I32[o + C_CONG] = pCg; I32[o + C_FLAGS] = pNf; I32[o + C_A0] = pA; I32[o + C_W0] = pW; I32[o + C_N0] = pN; I32[o + C_SOIL_SRC] = pSs;
      I32[o + C_FREIGHT] = pFr; I32[o + C_NFREIGHT] = fr ? fr.length : 0; I32[o + C_LF_ORDER] = pOrd; I32[o + C_LF_ORDER_LEN] = nReg > 0 ? p.lfOrder.length : 0;
      I32[o + C_NREG] = nReg; I32[o + C_REG] = pReg; I32[o + C_REG_F] = pRegF; I32[o + C_HIGHWAY] = p.highway; I32[o + C_RAIL] = p.rail;
      const f = fp >> 3;
      F64[f + CF_SMELL] = p.smell; F64[f + CF_WATER_K] = p.waterK; F64[f + CF_SOIL_GW] = p.soilGW; F64[f + CF_TRAFFIC_AIR] = p.trafficAir;
      F64[f + CF_TUNNEL_AIR] = p.tunnelAir; F64[f + CF_CONG_DAMP] = p.congDamp; F64[f + CF_CROSSING] = p.crossing;
      F64[f + CF_NOISE_PER_TRIP] = p.noisePerTrip; F64[f + CF_TUNNEL_NOISE] = p.tunnelNoise; F64[f + CF_BRIDGE_NOISE] = p.bridgeNoise;
      F64[f + CF_TN] = p.tn; F64[f + CF_FREIGHT_S] = p.freightS;
      for (let k = 0; k < 8; k++) {
        // slots the JS never reads for a valid code (n <= highway, or rail) hold 0
        F64[f + CF_PER_TRIP + k] = k < p.perTrip.length ? p.perTrip[k] : 0;
        F64[f + CF_BASE + k] = k < p.base.length ? p.base[k] : 0;
      }
      const bits = ex.fields_cells(ip, fp);
      unstage(g);
      done();
      return bits;
    } catch (e) {
      onError(e);
      toJs();
      return js.cells(p);
    }
  };

  // ---------------------------------------------------------------------------------------------- saturate
  const saturate: FieldKernels['saturate'] = (field, L, C, invK, alpha, mask, buf1 = null, k1 = 0, buf2 = null, k2 = 0) => {
    const inst = instance();
    const scale = (invK * SAT_N) / SAT_MAX;
    const ok = inst !== null && C === (C | 0) && C >= 0 && f32ok(field, C) && f32ok(L, C) && scale > 0 && scale < Infinity &&
      (mask === null || u8ok(mask, C)) && (buf1 === null || f32ok(buf1, C)) && (buf2 === null || buf1 === null || f32ok(buf2, C)) &&
      disjoint([L], [field, mask, buf1, buf1 === null ? null : buf2]);
    if (!ok) { toJs(); js.saturate(field, L, C, invK, alpha, mask, buf1, k1, buf2, k2); return; }
    const { w, s } = inst!;
    const h = w.heap, ex = w.ex;
    try {
      const g: Staging = { h, stats, outs: [], slot: 0 };
      const ip = h.scratch(SL_IP, S_LEN * 4, 16), fp = h.scratch(SL_FP, SF_LEN * 8, 16);
      const pF = stage(g, field, C, true, false), pL = stage(g, L, C, true, true);
      const pM = mask !== null ? stage(g, mask, C, true, false) : 0;
      const pB1 = buf1 !== null ? stage(g, buf1, C, true, false) : 0;
      const pB2 = buf1 !== null && buf2 !== null ? stage(g, buf2, C, true, false) : 0;
      const I32 = h.I32, F64 = h.F64;
      const o = ip >> 2;
      I32[o + S_C] = C; I32[o + S_FIELD] = pF; I32[o + S_L] = pL; I32[o + S_MASK] = pM; I32[o + S_BUF1] = pB1; I32[o + S_BUF2] = pB2; I32[o + S_SAT] = s.sat;
      const f = fp >> 3;
      F64[f + SF_SCALE] = scale; F64[f + SF_ALPHA] = alpha; F64[f + SF_K1] = k1; F64[f + SF_K2] = k2;
      ex.fields_saturate(ip, fp);
      unstage(g);
      done();
    } catch (e) {
      onError(e);
      toJs();
      js.saturate(field, L, C, invK, alpha, mask, buf1, k1, buf2, k2);
    }
  };

  // ---------------------------------------------------------------------------------------------- water
  const water = (p: WaterArgs): void => {
    const inst = instance();
    const C = p.C, nW = p.nW;
    const scale = (p.invK * SAT_N) / SAT_MAX;
    const ok = inst !== null && C === (C | 0) && C >= 0 && nW === (nW | 0) && nW >= 0 && nW <= C &&
      f32ok(p.tmp, C) && f32ok(p.tmp2, C) && f32ok(p.L, C) && f32ok(p.ground, C) && u8ok(p.water, C) && scale > 0 && scale < Infinity &&
      i32ok(p.waterCells, nW) && i32ok(p.waterNb, 4 * nW) && p.bankCells instanceof Int32Array && i32ok(p.bankSrc, p.bankCells.length) &&
      disjoint([p.tmp, p.tmp2, p.L, p.ground], [p.water, p.waterCells, p.waterNb, p.bankCells, p.bankSrc]);
    if (!ok) { toJs(); js.water(p); return; }
    const { w, s } = inst!;
    const h = w.heap, ex = w.ex;
    let r = 1;
    try {
      const g: Staging = { h, stats, outs: [], slot: 0 };
      const nB = p.bankCells.length;
      const ip = h.scratch(SL_IP, W_LEN * 4, 16), fp = h.scratch(SL_FP, WF_LEN * 8, 16);
      const pTmp = stage(g, p.tmp, C, true, true), pTmp2 = stage(g, p.tmp2, C, true, true);
      const pL = stage(g, p.L, C, true, true), pG = stage(g, p.ground, C, true, true), pW = stage(g, p.water, C, true, false);
      const pCells = stage(g, p.waterCells, nW, true, false, SL_LIST1), pNb = stage(g, p.waterNb, 4 * nW, true, false, SL_LIST2);
      const pBank = stage(g, p.bankCells, nB, true, false, SL_LIST3), pBsrc = stage(g, p.bankSrc, nB, true, false, SL_LIST4);
      const pInfl = h.scratch(SL_W1, Math.max(16, 8 * nW), 16), pDiv = h.scratch(SL_W2, Math.max(16, 8 * nW), 16), pList = h.scratch(SL_W3, Math.max(16, 16 * nW), 16);
      const pCur = h.scratch(SL_W4, 4 * nW + 16, 16), pNxt = h.scratch(SL_W5, 4 * nW + 16, 16);
      const I32 = h.I32, F64 = h.F64;
      const o = ip >> 2;
      I32[o + W_C] = C; I32[o + W_TMP] = pTmp; I32[o + W_TMP2] = pTmp2; I32[o + W_L] = pL; I32[o + W_GROUND] = pG; I32[o + W_WATER] = pW;
      I32[o + W_SAT] = s.sat; I32[o + W_CELLS] = pCells; I32[o + W_NW] = nW; I32[o + W_NB] = pNb; I32[o + W_BANK] = pBank;
      I32[o + W_BANK_SRC] = pBsrc; I32[o + W_NBANK] = nB; I32[o + W_ITERS] = WATER_ITERS;
      I32[o + W_INFL] = pInfl; I32[o + W_NDIV] = pDiv; I32[o + W_WLIST] = pList; I32[o + W_CUR] = pCur; I32[o + W_NXT] = pNxt;
      const f = fp >> 3;
      F64[f + WF_SCALE] = scale; F64[f + WF_ALPHA] = p.alpha; F64[f + WF_KEEP] = WATER_DIFFUSE_KEEP; F64[f + WF_INFLOW] = WATER_INFLOW;
      F64[f + WF_CLEAN] = WATER_CLEAN; F64[f + WF_BANK] = p.bankCoupling;
      r = ex.fields_water(ip, fp);
      if (r === 0) {
        unstage(g);
        done();
        return;
      }
      g.outs.length = 0;
    } catch (e) {
      onError(e);
    }
    // r = 1: a list index out of range (nothing was written): the JS has its own semantics for those
    toJs();
    js.water(p);
  };

  // ---------------------------------------------------------------------------------------------- soil
  const soil = (soilL: Float32Array, src: Float32Array, C: number, grow: number, keep: number): void => {
    const inst = instance();
    const ok = inst !== null && C === (C | 0) && C >= 0 && f32ok(soilL, C) && f32ok(src, C) && disjoint([soilL], [src]);
    if (!ok) { toJs(); js.soil(soilL, src, C, grow, keep); return; }
    const { w } = inst!;
    const h = w.heap, ex = w.ex;
    try {
      const g: Staging = { h, stats, outs: [], slot: 0 };
      const pS = stage(g, soilL, C, true, true), pQ = stage(g, src, C, true, false);
      ex.fields_soil(pS, pQ, C, grow, keep);
      unstage(g);
      done();
    } catch (e) {
      onError(e);
      toJs();
      js.soil(soilL, src, C, grow, keep);
    }
  };

  return { kind: opts.label ?? 'wasm', nimby, cells, saturate, water, soil };
}
