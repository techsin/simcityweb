/**
 * Helpers for kernel bindings (src/wasm/kernels/*.ts): move typed arrays into / out of wasm memory.
 *
 * Every argument array is either
 *  - ZERO-COPY: it already lives in the kernel memory (allocated with heap.allocArray) -> its own byte offset is
 *    passed, nothing is copied; or
 *  - STAGED: a plain JS typed array -> copied into a cached scratch block before the call (inputs) and copied back
 *    after it (outputs).
 * Call order inside a binding: (1) all stage*() calls (they may allocate, i.e. grow memory), (2) the export call,
 * (3) unstage*() for outputs. Never hold a whole-memory view (heap.F32 …) across step (1).
 */
import type { WasmHeap } from './heap';

type F32 = Float32Array;

/** byte ranges of two views intersect (same buffer, overlapping bytes) */
export function overlaps(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.buffer !== b.buffer) return false;
  return a.byteOffset < b.byteOffset + b.byteLength && b.byteOffset < a.byteOffset + a.byteLength;
}

/** N is a usable grid size for the wasm kernels (integer 1..32767, so N*N*8 stays far below 2^32) */
export function gridOk(N: number): boolean {
  return N === (N | 0) && N >= 1 && N <= 32767;
}

/**
 * pointer for a Float32 argument of `len` elements: its own offset when it lives in wasm memory, else a scratch block
 * (`slot`), filled from `v` when `copyIn`
 */
export function stageF32(h: WasmHeap, slot: number, v: F32, len: number, copyIn: boolean): number {
  const p = h.ptrOf(v);
  if (p >= 0 && (p & 3) === 0) return p;
  const s = h.scratch(slot, len * 4);
  if (copyIn) h.F32.set(len === v.length ? v : v.subarray(0, len), s >> 2);
  return s;
}

/** copy a staged output back into `v` (no-op for zero-copy arguments, i.e. when ptr is v's own offset) */
export function unstageF32(h: WasmHeap, v: F32, ptr: number, len: number): void {
  if (h.ptrOf(v) === ptr) return;
  const o = ptr >> 2;
  v.set(h.F32.subarray(o, o + len));
}

/** scratch block of `words` 4-byte words (tables etc.; contents undefined) */
export function scratchWords(h: WasmHeap, slot: number, words: number): number {
  return h.scratch(slot, words * 4);
}

/** scratch block of `n` f64 (8-byte aligned; contents undefined) */
export function scratchF64(h: WasmHeap, slot: number, n: number): number {
  return h.scratch(slot, n * 8, 16);
}
