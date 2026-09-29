/**
 * WebAssembly bindings for src/sim/infra/blur.ts, built around a JS implementation: makeBlurKernels(js) returns the
 * same API (same signatures, bit-identical results) that runs the Rust kernels (wasm/sim-kernels/src/blur.rs) when
 * the 'blur' kernel slot is active and the arguments are in the supported domain (integer grid size / radius / factor,
 * arrays long enough, no overlapping arrays), and `js` otherwise. Arrays allocated with heap.allocArray() are used in
 * place (zero copy); plain typed arrays are staged through scratch blocks.
 *
 * This file does not import the JS original (kernels/blur.ts binds it), so tests and benchmarks can swap the bound
 * API in for src/sim/infra/blur.ts itself (vi.mock / a bundler alias) without an import cycle.
 *
 * Scratch arguments (`tmp` of blur3 / boxAverage, `coarseTmp`): in JS they end up holding intermediate values; the wasm
 * copy path leaves them untouched (in-place arrays get the same intermediate values as JS). No caller reads them.
 */
import type * as JsBlur from '../../sim/infra/blur';
import { kernelSlot, simWasmCallFailed } from '../simWasm';
import { scratchSlot } from '../heap';
import { gridOk, overlaps, scratchF64, scratchWords, stageF32, unstageF32 } from '../bind';

/** the API of src/sim/infra/blur.ts */
export type BlurApi = typeof JsBlur;

interface BlurExports {
  blur_box_h(src: number, dst: number, n: number, r: number): void;
  blur_box_v(src: number, dst: number, col: number, n: number, r: number): void;
  blur_blur3(a: number, tmp: number, col: number, n: number, r: number): void;
  blur_box_average(src: number, dst: number, tmp: number, col: number, n: number, r: number): void;
  blur_down(src: number, n: number, f: number, r: number, coarse: number, coarseTmp: number, col: number): number;
  blur_upsample_add(coarse: number, acc: number, n: number, f: number, gain: number, dx: number, dz: number, tables: number): void;
  blur_down_add(src: number, acc: number, n: number, f: number, r: number, gain: number, coarse: number, coarseTmp: number, col: number, dx: number, dz: number, tables: number): void;
  blur_shift_field(src: number, dst: number, n: number, dx: number, dz: number): void;
  blur_shift_plume(src: number, dst: number, n: number, dx: number, dz: number): void;
}

export const BLUR_KERNEL = kernelSlot('blur', [
  'blur_box_h', 'blur_box_v', 'blur_blur3', 'blur_box_average', 'blur_down', 'blur_upsample_add', 'blur_down_add',
  'blur_shift_field', 'blur_shift_plume',
]);

// staging / scratch slots shared by the functions of this module
const S_A = scratchSlot(), S_B = scratchSlot(), S_C = scratchSlot(), S_D = scratchSlot(), S_COL = scratchSlot(), S_TAB = scratchSlot();

const isInt = (v: number) => v === (v | 0);
/** Math.ceil(N / f) for the validated integer domain */
const coarseSize = (N: number, f: number) => Math.ceil(N / f);

/** blur API that runs the wasm kernels when possible and `js` otherwise */
export function makeBlurKernels(js: BlurApi): BlurApi {
  function boxH(src: Float32Array, dst: Float32Array, N: number, r: number): void {
    const w = BLUR_KERNEL.instance();
    const nn = N * N;
    if (w === null || !gridOk(N) || !isInt(r) || r < 0 || src.length < nn || dst.length < nn || overlaps(src, dst)) return js.boxH(src, dst, N, r);
    const h = w.heap, ex = w.exports as unknown as BlurExports;
    try {
      const ps = stageF32(h, S_A, src, nn, true);
      const pd = stageF32(h, S_B, dst, nn, false);
      ex.blur_box_h(ps, pd, N, r);
      unstageF32(h, dst, pd, nn);
    } catch (e) {
      simWasmCallFailed('blur', e);
      js.boxH(src, dst, N, r);
    }
  }

  function boxV(src: Float32Array, dst: Float32Array, N: number, r: number): void {
    const w = BLUR_KERNEL.instance();
    const nn = N * N;
    if (w === null || !gridOk(N) || !isInt(r) || r < 0 || src.length < nn || dst.length < nn || overlaps(src, dst)) return js.boxV(src, dst, N, r);
    const h = w.heap, ex = w.exports as unknown as BlurExports;
    try {
      const pc = scratchF64(h, S_COL, N);
      const ps = stageF32(h, S_A, src, nn, true);
      const pd = stageF32(h, S_B, dst, nn, false);
      ex.blur_box_v(ps, pd, pc, N, r);
      unstageF32(h, dst, pd, nn);
    } catch (e) {
      simWasmCallFailed('blur', e);
      js.boxV(src, dst, N, r);
    }
  }

  function blur3(a: Float32Array, tmp: Float32Array, N: number, r: number): void {
    if (r <= 0) return;
    const w = BLUR_KERNEL.instance();
    const nn = N * N;
    if (w === null || !gridOk(N) || !isInt(r) || a.length < nn || tmp.length < nn || overlaps(a, tmp)) return js.blur3(a, tmp, N, r);
    const h = w.heap, ex = w.exports as unknown as BlurExports;
    try {
      const pc = scratchF64(h, S_COL, N);
      const pa = stageF32(h, S_A, a, nn, true);
      const pt = stageF32(h, S_B, tmp, nn, false);
      ex.blur_blur3(pa, pt, pc, N, r);
      unstageF32(h, a, pa, nn);
    } catch (e) {
      simWasmCallFailed('blur', e);
      js.blur3(a, tmp, N, r);
    }
  }

  function boxAverage(src: Float32Array, dst: Float32Array, tmp: Float32Array, N: number, r: number): void {
    const w = BLUR_KERNEL.instance();
    const nn = N * N;
    if (
      w === null || !gridOk(N) || !isInt(r) || r < 0 || src.length < nn || dst.length < nn || tmp.length < nn ||
      overlaps(tmp, src) || overlaps(tmp, dst)
    ) return js.boxAverage(src, dst, tmp, N, r);
    const h = w.heap, ex = w.exports as unknown as BlurExports;
    try {
      const pc = scratchF64(h, S_COL, N);
      const ps = stageF32(h, S_A, src, nn, true);
      const pd = src === dst ? ps : stageF32(h, S_B, dst, nn, false);
      const pt = stageF32(h, S_C, tmp, nn, false);
      ex.blur_box_average(ps, pd, pt, pc, N, r);
      unstageF32(h, dst, pd, nn);
    } catch (e) {
      simWasmCallFailed('blur', e);
      js.boxAverage(src, dst, tmp, N, r);
    }
  }

  function blurDown(src: Float32Array, N: number, f: number, r: number, coarse: Float32Array, coarseTmp: Float32Array): number {
    const w = BLUR_KERNEL.instance();
    const nn = N * N;
    const M = coarseSize(N, f);
    const mm = M * M;
    if (
      w === null || !gridOk(N) || !isInt(f) || f < 1 || !isInt(r) || src.length < nn || coarse.length < mm || coarseTmp.length < mm ||
      overlaps(src, coarse) || overlaps(src, coarseTmp) || overlaps(coarse, coarseTmp)
    ) return js.blurDown(src, N, f, r, coarse, coarseTmp);
    const h = w.heap, ex = w.exports as unknown as BlurExports;
    try {
      const pc = scratchF64(h, S_COL, M);
      const ps = stageF32(h, S_A, src, nn, true);
      const pk = stageF32(h, S_B, coarse, mm, false);
      const pt = stageF32(h, S_C, coarseTmp, mm, false);
      const m = ex.blur_down(ps, N, f, r, pk, pt, pc);
      unstageF32(h, coarse, pk, mm);
      return m;
    } catch (e) {
      simWasmCallFailed('blur', e);
      return js.blurDown(src, N, f, r, coarse, coarseTmp);
    }
  }

  function upsampleAdd(coarse: Float32Array, acc: Float32Array, N: number, f: number, gain: number, dx = 0, dz = 0): void {
    const w = BLUR_KERNEL.instance();
    const nn = N * N;
    const M = coarseSize(N, f);
    const mm = M * M;
    if (w === null || !gridOk(N) || !isInt(f) || f < 1 || coarse.length < mm || acc.length < nn || overlaps(coarse, acc)) {
      return js.upsampleAdd(coarse, acc, N, f, gain, dx, dz);
    }
    const h = w.heap, ex = w.exports as unknown as BlurExports;
    try {
      const pt = scratchWords(h, S_TAB, 8 * N + M);
      const pk = stageF32(h, S_B, coarse, mm, true);
      const pa = stageF32(h, S_A, acc, nn, true);
      ex.blur_upsample_add(pk, pa, N, f, +gain, +dx, +dz, pt);
      unstageF32(h, acc, pa, nn);
    } catch (e) {
      simWasmCallFailed('blur', e);
      js.upsampleAdd(coarse, acc, N, f, gain, dx, dz);
    }
  }

  function blurDownAdd(
    src: Float32Array, acc: Float32Array, N: number, f: number, r: number, gain: number, coarse: Float32Array, coarseTmp: Float32Array, dx = 0, dz = 0,
  ): void {
    const w = BLUR_KERNEL.instance();
    const nn = N * N;
    const M = coarseSize(N, f);
    const mm = M * M;
    if (
      w === null || !gridOk(N) || !isInt(f) || f < 1 || !isInt(r) || src.length < nn || acc.length < nn || coarse.length < mm ||
      coarseTmp.length < mm || overlaps(src, coarse) || overlaps(src, coarseTmp) || overlaps(coarse, coarseTmp) || overlaps(acc, coarse) ||
      overlaps(acc, coarseTmp)
    ) return js.blurDownAdd(src, acc, N, f, r, gain, coarse, coarseTmp, dx, dz);
    const h = w.heap, ex = w.exports as unknown as BlurExports;
    try {
      const pc = scratchF64(h, S_COL, M);
      const ptab = scratchWords(h, S_TAB, 8 * N + M);
      const ps = stageF32(h, S_A, src, nn, true);
      // src and acc may be the same array in JS (src is fully read before acc is written): share the staging block
      const pa = acc === src ? ps : stageF32(h, S_D, acc, nn, true);
      const pk = stageF32(h, S_B, coarse, mm, false);
      const pt = stageF32(h, S_C, coarseTmp, mm, false);
      ex.blur_down_add(ps, pa, N, f, r, +gain, pk, pt, pc, +dx, +dz, ptab);
      unstageF32(h, coarse, pk, mm);
      unstageF32(h, acc, pa, nn);
    } catch (e) {
      simWasmCallFailed('blur', e);
      js.blurDownAdd(src, acc, N, f, r, gain, coarse, coarseTmp, dx, dz);
    }
  }

  function shiftField(src: Float32Array, dst: Float32Array, N: number, dx: number, dz: number): void {
    const w = BLUR_KERNEL.instance();
    const nn = N * N;
    if (w === null || !gridOk(N) || src.length < nn || dst.length < nn || overlaps(src, dst)) return js.shiftField(src, dst, N, dx, dz);
    const h = w.heap, ex = w.exports as unknown as BlurExports;
    try {
      const ps = stageF32(h, S_A, src, nn, true);
      const pd = stageF32(h, S_B, dst, nn, false);
      ex.blur_shift_field(ps, pd, N, +dx, +dz);
      unstageF32(h, dst, pd, nn);
    } catch (e) {
      simWasmCallFailed('blur', e);
      js.shiftField(src, dst, N, dx, dz);
    }
  }

  function shiftPlume(src: Float32Array, dst: Float32Array, N: number, dx: number, dz: number): void {
    const w = BLUR_KERNEL.instance();
    const nn = N * N;
    if (w === null || !gridOk(N) || src.length < nn || dst.length < nn || overlaps(src, dst)) return js.shiftPlume(src, dst, N, dx, dz);
    const h = w.heap, ex = w.exports as unknown as BlurExports;
    try {
      const ps = stageF32(h, S_A, src, nn, true);
      const pd = stageF32(h, S_B, dst, nn, false);
      ex.blur_shift_plume(ps, pd, N, +dx, +dz);
      unstageF32(h, dst, pd, nn);
    } catch (e) {
      simWasmCallFailed('blur', e);
      js.shiftPlume(src, dst, N, dx, dz);
    }
  }

  return { ...js, boxH, boxV, blur3, boxAverage, blurDown, upsampleAdd, blurDownAdd, shiftField, shiftPlume };
}
