/**
 * Browser-side checks shared by the page (main thread) and its worker: bit-exact equivalence of the wasm blur bindings
 * with the JS original on random fields, plus a small interleaved A/B (wall clock: browsers have no CPU-time clock).
 */
import * as js from '../../src/sim/infra/blur';
import { makeBlurKernels } from '../../src/wasm/kernels/blurBind';
import { BLUR_KERNEL } from '../../src/wasm/kernels/blurBind';
import { adoptLayers } from '../../src/wasm/layers';
import { simWasmInstance } from '../../src/wasm/simWasm';
import { runAB, type AbResult } from './ab';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const field = (n: number, seed: number, sparse = false) => {
  const r = rng(seed);
  return Float32Array.from({ length: n }, () => (sparse ? (r() < 0.03 ? r() * 40 : 0) : r() * 3 - 1));
};
function sameBits(a: Float32Array, b: Float32Array): boolean {
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.length), ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i] && !(a[i] !== a[i] && b[i] !== b[i])) return false;
  return true;
}

export interface EquivalenceReport {
  checks: number;
  failures: string[];
  wasmActive: boolean;
}

export function equivalence(): EquivalenceReport {
  const wb = makeBlurKernels(js);
  const failures: string[] = [];
  let checks = 0;
  const check = (label: string, a: Float32Array, b: Float32Array) => {
    checks++;
    if (!sameBits(a, b)) failures.push(label);
  };
  for (const N of [1, 7, 64, 256]) {
    for (const r of [0, 1, 2, 5]) {
      const src = field(N * N, N + r);
      const o1 = new Float32Array(N * N), o2 = new Float32Array(N * N);
      js.boxH(src, o1, N, r); wb.boxH(src, o2, N, r); check(`boxH ${N} ${r}`, o1, o2);
      js.boxV(src, o1, N, r); wb.boxV(src, o2, N, r); check(`boxV ${N} ${r}`, o1, o2);
      const a1 = src.slice(), a2 = src.slice();
      js.blur3(a1, new Float32Array(N * N), N, r); wb.blur3(a2, new Float32Array(N * N), N, r); check(`blur3 ${N} ${r}`, a1, a2);
      js.boxAverage(src, o1, new Float32Array(N * N), N, r); wb.boxAverage(src, o2, new Float32Array(N * N), N, r); check(`boxAverage ${N} ${r}`, o1, o2);
    }
    for (const f of [2, 4]) {
      const M = Math.ceil(N / f), src = field(N * N, 3 * N + f, true);
      const c1 = new Float32Array(M * M), c2 = new Float32Array(M * M);
      js.blurDown(src, N, f, 1, c1, new Float32Array(M * M)); wb.blurDown(src, N, f, 1, c2, new Float32Array(M * M)); check(`blurDown ${N} ${f}`, c1, c2);
      const a1 = field(N * N, 5), a2 = a1.slice();
      js.upsampleAdd(c1, a1, N, f, 0.5, 0.7, -1.6); wb.upsampleAdd(c1, a2, N, f, 0.5, 0.7, -1.6); check(`upsampleAdd ${N} ${f}`, a1, a2);
      js.blurDownAdd(src, a1, N, f, 2, 12, c1, new Float32Array(M * M), -0.5, 2); wb.blurDownAdd(src, a2, N, f, 2, 12, c2, new Float32Array(M * M), -0.5, 2); check(`blurDownAdd ${N} ${f}`, a1, a2);
    }
    const s = field(N * N, 9), d1 = new Float32Array(N * N), d2 = new Float32Array(N * N);
    js.shiftPlume(s, d1, N, 1.3, -2.25); wb.shiftPlume(s, d2, N, 1.3, -2.25); check(`shiftPlume ${N}`, d1, d2);
  }
  return { checks, failures, wasmActive: BLUR_KERNEL.instance() !== null };
}

/** A/B in this realm: JS vs wasm (copy and zero-copy) for the crime blur and one pollution-style call chain */
export function browserAB(quick: boolean): AbResult[] {
  const w = simWasmInstance();
  if (!w) return [];
  const wb = makeBlurKernels(js);
  const N = 256, nn = N * N;
  const P = { a: field(nn, 1), t: new Float32Array(nn), src: field(nn, 2, true), acc: field(nn, 3), c: new Float32Array(128 * 128), ct: new Float32Array(128 * 128) };
  const Q = { a: P.a.slice(), t: new Float32Array(nn), src: P.src.slice(), acc: P.acc.slice(), c: new Float32Array(128 * 128), ct: new Float32Array(128 * 128) };
  const H = { a: P.a.slice(), t: new Float32Array(nn), src: P.src.slice(), acc: P.acc.slice(), c: new Float32Array(128 * 128), ct: new Float32Array(128 * 128) };
  const adopted = adoptLayers(H, w.heap);
  const opts = { reps: quick ? 15 : 31, warmupMs: quick ? 150 : 300, minSampleMs: 10, clockName: 'wall' };
  const chain = (b: typeof js, X: typeof P) => {
    b.blurDown(X.src, N, 2, 1, X.c, X.ct);
    b.upsampleAdd(X.c, X.acc, N, 2, 0.5, 0.35, -0.8);
    b.blurDownAdd(X.src, X.acc, N, 4, 2, 60, X.c, X.ct);
    b.boxAverage(X.src, X.t, X.a, N, 2);
  };
  const out = [
    runAB({ name: 'browser blur3 r=1 256² copy', aLabel: 'js', bLabel: 'wasm', a: () => js.blur3(P.a, P.t, N, 1), b: () => wb.blur3(Q.a, Q.t, N, 1) }, opts),
    runAB({ name: 'browser blur3 r=1 256² zero-copy', aLabel: 'js', bLabel: 'wasm', a: () => js.blur3(P.a, P.t, N, 1), b: () => wb.blur3(H.a, H.t, N, 1) }, opts),
    runAB({ name: 'browser pollution chain 256² copy', aLabel: 'js', bLabel: 'wasm', a: () => chain(js, P), b: () => chain(wb, Q) }, opts),
    runAB({ name: 'browser pollution chain 256² zero-copy', aLabel: 'js', bLabel: 'wasm', a: () => chain(js, P), b: () => chain(wb, H) }, opts),
  ];
  adopted.release();
  return out;
}
