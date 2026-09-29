/**
 * WebAssembly binding of the population aggregate PROBE kernel (wasm/sim-kernels/src/popagg.rs, arm D of
 * tools/bench/populationAggregateProbe.bench.mjs; benchmark only). makePopAggKernels(c, js) returns a function with the
 * signature of the JS SoA loop (src/wasm/js/populationAggregateProbe.ts aggregateSoA, bound to the constants), with
 * bit-identical results, that runs the Rust kernel when the 'popagg' kernel slot is active and the arguments are in the
 * supported domain, and `js` otherwise.
 *
 * Memory, per argument: RESIDENT (the array lives in the kernel memory — e.g. the SoA allocated with heap.allocArray,
 * the DemographicsCache.wf / accessById / rt grids in the architect's one-Memory-per-Simulation model: its own offset is
 * passed, zero copy) or STAGED (a plain typed array: inputs copied into a scratch block before the call, written grids
 * copied back after it). Staged traffic per call: the SoA (58 B per growable), mWf (4 B per building id, sample days)
 * and accessById (sample days with traffic), out: 5 grids (+ 11 on demo days) of 4·cw² bytes. `stats` counts them.
 *
 * Domain (anything else runs `js`): integer cw in 1..4096, n <= every SoA column, SoA columns of the documented types,
 * mWf a Float32Array, traffic access given as an accessById Float32Array (a workerAccess() callback needs JS), every
 * written grid a Float32Array with >= cw² cells, written grids not overlapping each other or any input,
 * DEV_TYPE_COUNT in 3..16, R_MAX = 2, int32 masks. A dev code >= DEV_TYPE_COUNT (other than 255) makes the kernel stop
 * (return 1) and the call reruns in JS, which rewrites every output.
 *
 * This file does not import src/sim (src/wasm/kernels/populationAggregateProbe.ts binds the live constants).
 */
import { kernelSlot, simWasmCallFailed } from '../simWasm';
import { scratchSlot, type HeapArray, type WasmHeap } from '../heap';
import { overlaps } from '../bind';
import type {
  PopAggConstants, PopAggGrids, PopAggInput, PopAggResult, PopAggSoA, PopAggTotals,
} from '../js/populationAggregateProbe';

/** parameter-block layout version (popagg.rs LAYOUT) */
export const POPAGG_LAYOUT = 1;
/** dev capacity of the kernel (popagg.rs DEV_MAX) */
export const POPAGG_DEV_MAX = 16;

export interface PopAggExports {
  memory: WebAssembly.Memory;
  popagg_layout(): number;
  popagg_aggregate(ip: number, fp: number): number;
}

export const POPAGG_KERNEL = kernelSlot('popagg', ['popagg_layout', 'popagg_aggregate']);

/** an explicit kernel instance (benchmarks: scalar / SIMD builds); default: the loader's instance */
export interface PopAggWasm {
  ex: PopAggExports;
  heap: WasmHeap;
}

export interface PopAggBindStats {
  wasmCalls: number;
  jsCalls: number;
  /** bytes copied into / out of wasm memory by staging */
  bytesIn: number;
  bytesOut: number;
}

/** the SoA loop's signature (aggregateSoA with the constants bound) */
export type PopAggSoAFn = (soa: PopAggSoA, inp: PopAggInput, g: PopAggGrids, t: PopAggTotals, coh: Float64Array, out: PopAggResult) => void;

// ------------------------------------------------------------------------------------------------ popagg.rs ix / fx
const I_N = 0, I_CW = 1, I_FLAGS = 2, I_DEVS = 3, I_MASK_SKIP = 4, I_MASK_CONSTR = 5;
const I_DEV = 8, I_BLK = 9, I_BFLAGS = 10, I_POP = 11, I_CAP = 12, I_JOBS = 13, I_WEALTH = 14, I_ID = 15, I_KIDS = 16,
  I_TEENS = 17, I_YAD = 18, I_SRS = 19, I_EDU = 20, I_MWF = 21, I_MWF_LEN = 22, I_ACC = 23, I_ACC_LEN = 24;
const I_C_POP_RAW = 25, I_C_WEALTH_RAW = 26, I_C_COUNT_RAW = 27, I_C_POP = 28, I_C_WEALTH = 29, I_POPW_RAW = 30,
  I_SKILL_RAW = 33, I_KIDS_RAW = 34, I_C_POPW = 35, I_C_KIDS = 38, I_SKILL_BLUR = 39, I_C_SKILL = 40;
const IP_LEN = 48;
const F_EDU_FALLBACK = 0, F_WORKFORCE_RATIO = 1, F_COHORT_BASE = 2, F_W = 8, F_ACC_E = 9, F_ACC_W = 10, F_UN_W = 11,
  F_EDU_SUM = 12, F_EDU_POP = 13, F_ABANDONED = 14, F_CONSTRUCTING = 15, F_POP = 16, F_RES_CAP_ALL = 19, F_RES_CAP_BUILT = 22,
  F_JOBS = 25, F_JOB_CAP_ALL = 25 + POPAGG_DEV_MAX, F_JOB_CAP_BUILT = 25 + 2 * POPAGG_DEV_MAX, F_COUNT_BY_DEV = 25 + 3 * POPAGG_DEV_MAX,
  F_COH = 25 + 4 * POPAGG_DEV_MAX;
const FP_LEN = F_COH + 15;
const FL_SAMPLE = 1, FL_DEMO = 2, FL_TACC = 4, FL_DEMO_GRIDS = 8, FL_SCALAR_BLUR = 16;

// staging / scratch slots of this module
const S_IP = scratchSlot(), S_FP = scratchSlot();
const S_SOA: number[] = Array.from({ length: 13 }, () => scratchSlot());
const S_MWF = scratchSlot(), S_ACC = scratchSlot();
const S_GRID: number[] = Array.from({ length: 16 }, () => scratchSlot());
const SOA_IX = [I_DEV, I_BLK, I_BFLAGS, I_POP, I_CAP, I_JOBS, I_WEALTH, I_ID, I_KIDS, I_TEENS, I_YAD, I_SRS, I_EDU];

const isInt = (v: number): boolean => v === (v | 0);

/** the binary's parameter-block layout matches these bindings (checked once per instance; a stale binary runs JS) */
const layouts = new WeakMap<object, boolean>();
function layoutOk(ex: PopAggExports): boolean {
  let ok = layouts.get(ex);
  if (ok === undefined) {
    ok = typeof ex.popagg_layout === 'function' && ex.popagg_layout() === POPAGG_LAYOUT;
    if (!ok) console.warn(`[simWasm] popagg kernel: parameter layout ${String(ex.popagg_layout?.())} != ${POPAGG_LAYOUT} (stale binary? npm run build:wasm), running JS`);
    layouts.set(ex, ok);
  }
  return ok;
}

/** the kernel's domain of a constant set (validated once) */
function constantsSupported(c: PopAggConstants): boolean {
  return isInt(c.DEV_TYPE_COUNT) && c.DEV_TYPE_COUNT >= 3 && c.DEV_TYPE_COUNT <= POPAGG_DEV_MAX && c.R_MAX === 2 &&
    isInt(c.MASK_SKIP) && isInt(c.MASK_CONSTR) && c.COHORT_BASE.length >= 5;
}

function soaTyped(s: PopAggSoA, n: number): boolean {
  return s.dev instanceof Uint8Array && s.blk instanceof Int32Array && s.flags instanceof Int32Array && s.pop instanceof Float64Array &&
    s.capacity instanceof Float64Array && s.jobs instanceof Float64Array && s.wealth instanceof Uint8Array && s.id instanceof Int32Array &&
    s.kids instanceof Float32Array && s.teens instanceof Float32Array && s.yad instanceof Float32Array && s.srs instanceof Float32Array &&
    s.edu instanceof Float32Array &&
    s.dev.length >= n && s.blk.length >= n && s.flags.length >= n && s.pop.length >= n && s.capacity.length >= n && s.jobs.length >= n &&
    s.wealth.length >= n && s.id.length >= n && s.kids.length >= n && s.teens.length >= n && s.yad.length >= n && s.srs.length >= n &&
    s.edu.length >= n;
}

/** SIMD blur on/off (benchmarks: explicit f64x2 blur vs the scalar blur of the same binary) */
export interface PopAggKernelOptions {
  wasm?: PopAggWasm;
  stats?: PopAggBindStats;
  /** force the scalar blur (FL_SCALAR_BLUR) */
  scalarBlur?: boolean;
}

/** the SoA loop running the wasm kernel when possible and `js` otherwise */
export function makePopAggKernels(c: PopAggConstants, js: PopAggSoAFn, opts: PopAggKernelOptions = {}): PopAggSoAFn {
  const supported = constantsSupported(c);
  const stats = opts.stats;
  const devs = c.DEV_TYPE_COUNT;
  // written-grids-vs-arguments overlap check, cached for the last argument set (identical arrays -> same answer)
  let lastArgs: ArrayBufferView[] | null = null, lastNw = 0, lastOk = false;

  const instance = (): PopAggWasm | null => {
    if (!supported) return null;
    let w: PopAggWasm | null = opts.wasm ?? null;
    if (!w) {
      const inst = POPAGG_KERNEL.instance();
      if (inst === null) return null;
      w = { ex: inst.exports as unknown as PopAggExports, heap: inst.heap };
    }
    return layoutOk(w.ex) ? w : null;
  };

  const noOverlap = (args: ArrayBufferView[], nWritten: number): boolean => {
    let same = lastArgs !== null && lastArgs.length === args.length && lastNw === nWritten;
    for (let k = 0; same && k < args.length; k++) if (lastArgs![k] !== args[k]) same = false;
    if (same) return lastOk;
    let ok = true;
    // args[0 .. nWritten) are written: none may overlap any other argument
    for (let a = 0; ok && a < nWritten; a++) {
      for (let b = 0; b < args.length; b++) {
        if (a === b) continue;
        if (args[a] === args[b] || overlaps(args[a], args[b])) { ok = false; break; }
      }
    }
    lastArgs = args; lastNw = nWritten; lastOk = ok;
    return ok;
  };

  /** pointer of an input array: its own offset (resident) or a scratch block filled with elements [0, len) */
  const input = (h: WasmHeap, slot: number, a: HeapArray, len: number): number => {
    const bpe = a.BYTES_PER_ELEMENT;
    const p = h.ptrOf(a);
    if (p >= 0 && p % bpe === 0) return p;
    const s = h.scratch(slot, Math.max(1, len) * bpe, 16);
    if (len > 0) {
      const src = len === a.length ? a : a.subarray(0, len);
      if (bpe === 1) h.U8.set(src as Uint8Array, s);
      else if (a instanceof Float64Array) h.F64.set(src as Float64Array, s >> 3);
      else if (a instanceof Float32Array) h.F32.set(src as Float32Array, s >> 2);
      else h.I32.set(src as Int32Array, s >> 2);
      if (stats) stats.bytesIn += len * bpe;
    }
    return s;
  };
  /** pointer of a written grid: its own offset (resident) or a scratch block (copied back by output()) */
  const grid = (h: WasmHeap, slot: number, a: Float32Array, cc: number): number => {
    const p = h.ptrOf(a);
    if (p >= 0 && (p & 3) === 0) return p;
    return h.scratch(slot, cc * 4, 16);
  };
  const output = (h: WasmHeap, a: Float32Array, p: number, cc: number): void => {
    if (h.ptrOf(a) === p) return;
    a.set(h.F32.subarray(p >> 2, (p >> 2) + cc));
    if (stats) stats.bytesOut += cc * 4;
  };

  return function aggregateSoAWasm(soa, inp, g, t, coh, out): void {
    const w = instance();
    const cw = inp.cw, n = soa.n;
    if (w === null || !(isInt(cw) && cw >= 1 && cw <= 4096) || !(isInt(n) && n >= 0) || !soaTyped(soa, n) || !(inp.mWf instanceof Float32Array) ||
      (inp.tAcc && !(inp.accArr instanceof Float32Array)) || !(coh instanceof Float64Array) || coh.length < 15) {
      if (stats) stats.jsCalls++;
      return js(soa, inp, g, t, coh, out);
    }
    const cc = cw * cw;
    const sample = inp.sample, demo = inp.demo;
    const demoGrids = demo && g.coarsePopW[0].length === cc;
    // written grids first, then the inputs
    const written: Float32Array[] = [g.coarsePopRaw, g.coarseWealthRaw, g.coarseCountRaw, g.coarsePop, g.coarseWealth];
    if (demo) written.push(g.popWRaw[0], g.popWRaw[1], g.popWRaw[2], g.skillRaw, g.kidsRaw);
    if (demoGrids) written.push(g.coarsePopW[0], g.coarsePopW[1], g.coarsePopW[2], g.coarseKids, g.skillBlur, g.coarseSkill);
    let ok = true;
    for (const a of written) if (!(a instanceof Float32Array) || a.length < cc) { ok = false; break; }
    if (ok) {
      const args: ArrayBufferView[] = [...written, ...soa.arrays(), inp.mWf];
      if (inp.tAcc) args.push(inp.accArr!);
      ok = noOverlap(args, written.length);
    }
    if (!ok) {
      if (stats) stats.jsCalls++;
      return js(soa, inp, g, t, coh, out);
    }
    const h = w.heap;
    try {
      // (1) pointers (scratch allocations may grow memory; staged inputs are copied as they are placed)
      const ip = h.scratch(S_IP, IP_LEN * 4, 16), fp = h.scratch(S_FP, FP_LEN * 8, 16);
      const cols = soa.arrays() as HeapArray[];
      const pSoa: number[] = [];
      for (let k = 0; k < cols.length; k++) pSoa.push(n > 0 ? input(h, S_SOA[k], cols[k], n) : 0);
      const mWf = inp.mWf;
      const pMwf = sample && mWf.length > 0 ? input(h, S_MWF, mWf, mWf.length) : 0;
      const acc = inp.tAcc ? inp.accArr! : null;
      const pAcc = sample && acc && acc.length > 0 ? input(h, S_ACC, acc, acc.length) : 0;
      const pGrid: number[] = [];
      for (let k = 0; k < written.length; k++) pGrid.push(grid(h, S_GRID[k], written[k], cc));
      // (2) parameter blocks
      const I = h.I32, o = ip >> 2;
      I.fill(0, o, o + IP_LEN);
      I[o + I_N] = n; I[o + I_CW] = cw;
      I[o + I_FLAGS] = (sample ? FL_SAMPLE : 0) | (demo ? FL_DEMO : 0) | (inp.tAcc ? FL_TACC : 0) | (demoGrids ? FL_DEMO_GRIDS : 0) |
        (opts.scalarBlur ? FL_SCALAR_BLUR : 0);
      I[o + I_DEVS] = devs; I[o + I_MASK_SKIP] = c.MASK_SKIP; I[o + I_MASK_CONSTR] = c.MASK_CONSTR;
      for (let k = 0; k < SOA_IX.length; k++) I[o + SOA_IX[k]] = pSoa[k];
      I[o + I_MWF] = pMwf; I[o + I_MWF_LEN] = sample ? mWf.length : 0;
      I[o + I_ACC] = pAcc; I[o + I_ACC_LEN] = sample && acc ? acc.length : 0;
      I[o + I_C_POP_RAW] = pGrid[0]; I[o + I_C_WEALTH_RAW] = pGrid[1]; I[o + I_C_COUNT_RAW] = pGrid[2];
      I[o + I_C_POP] = pGrid[3]; I[o + I_C_WEALTH] = pGrid[4];
      if (demo) {
        I[o + I_POPW_RAW] = pGrid[5]; I[o + I_POPW_RAW + 1] = pGrid[6]; I[o + I_POPW_RAW + 2] = pGrid[7];
        I[o + I_SKILL_RAW] = pGrid[8]; I[o + I_KIDS_RAW] = pGrid[9];
      }
      if (demoGrids) {
        I[o + I_C_POPW] = pGrid[10]; I[o + I_C_POPW + 1] = pGrid[11]; I[o + I_C_POPW + 2] = pGrid[12];
        I[o + I_C_KIDS] = pGrid[13]; I[o + I_SKILL_BLUR] = pGrid[14]; I[o + I_C_SKILL] = pGrid[15];
      }
      const F = h.F64, f = fp >> 3;
      F[f + F_EDU_FALLBACK] = inp.eduFallback;
      F[f + F_WORKFORCE_RATIO] = c.WORKFORCE_RATIO;
      for (let q = 0; q < 5; q++) F[f + F_COHORT_BASE + q] = c.COHORT_BASE[q];
      for (let q = 0; q < 15; q++) F[f + F_COH + q] = coh[q];
      // (3) the kernel
      const rc = w.ex.popagg_aggregate(ip, fp);
      if (rc === 0) {
        // (4) results
        const G = h.F64;
        const tp = t.pop, ta = t.resCapAll, tb = t.resCapBuilt;
        for (let d = 0; d < 3; d++) { tp[d] = G[f + F_POP + d]; ta[d] = G[f + F_RES_CAP_ALL + d]; tb[d] = G[f + F_RES_CAP_BUILT + d]; }
        const tj = t.jobs, tja = t.jobCapAll, tjb = t.jobCapBuilt, tc = t.countByDev;
        for (let d = 0; d < devs; d++) {
          tj[d] = G[f + F_JOBS + d]; tja[d] = G[f + F_JOB_CAP_ALL + d]; tjb[d] = G[f + F_JOB_CAP_BUILT + d]; tc[d] = G[f + F_COUNT_BY_DEV + d];
        }
        t.abandoned = G[f + F_ABANDONED]; t.constructing = G[f + F_CONSTRUCTING];
        out.W = G[f + F_W]; out.accE = G[f + F_ACC_E]; out.accW = G[f + F_ACC_W]; out.unW = G[f + F_UN_W];
        out.eduSum = G[f + F_EDU_SUM]; out.eduPop = G[f + F_EDU_POP];
        if (demo) for (let q = 0; q < 15; q++) coh[q] = G[f + F_COH + q];
        for (let k = 0; k < written.length; k++) output(h, written[k], pGrid[k], cc);
        if (stats) stats.wasmCalls++;
        return;
      }
    } catch (e) {
      simWasmCallFailed('popagg', e);
    }
    // rc 1 (a dev code outside the totals: the JS rerun rewrites every output), rc 2 (outside the kernel's domain:
    // nothing written) or a failed call
    if (stats) stats.jsCalls++;
    js(soa, inp, g, t, coh, out);
  };
}
