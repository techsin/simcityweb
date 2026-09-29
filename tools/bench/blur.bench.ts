/**
 * A/B: JS blur (src/sim/infra/blur.ts, live) vs the Rust/wasm port (src/wasm/kernels/blurBind.ts), 256² unless noted.
 *   npm run bench:wasm -- blur [--json out.json] [--quick]
 * Cases: copy mode (plain arrays staged through wasm memory: the cost of moving data in / out is included),
 * zero-copy (arrays allocated in wasm memory), a JS control with the same restructuring as the Rust code
 * (tools/bench/blurJsOpt.ts), one full pollution + crime pass worth of blur calls, bigger maps, and binary variants
 * (SIMD vs scalar vs MVP, 4-row vs 1-row boxH). Every case is checked bit-exact before it is timed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as js from '../../src/sim/infra/blur';
import { makeBlurKernels } from '../../src/wasm/kernels/blurBind';
import { WasmHeap } from '../../src/wasm/heap';
import { adoptLayers } from '../../src/wasm/layers';
import { initSimWasmSync, simWasmInstance, simWasmStatus } from '../../src/wasm/simWasm';
import { type AbCase, type AbResult, formatResult, runAB } from './ab';
import { blur3Opt } from './blurJsOpt';
import { benchMain, cpuMs } from './node';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const dense = (n: number, seed: number) => { const r = rng(seed); return Float32Array.from({ length: n }, () => r() * 2 - 0.3); };
const sparse = (n: number, seed: number) => { const r = rng(seed); return Float32Array.from({ length: n }, () => (r() < 0.03 ? r() * 40 : 0)); };

function sameBits(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  const ua = new Uint32Array(a.buffer, a.byteOffset, a.length), ub = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i] && !(a[i] !== a[i] && b[i] !== b[i])) return false;
  return true;
}

interface RawKernels {
  heap: WasmHeap;
  ex: Record<string, (...a: number[]) => number>;
  features: number;
}
function loadVariant(file: string): RawKernels | null {
  if (!existsSync(file)) return null;
  const inst = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(file)), {});
  const ex = inst.exports as unknown as Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory; __heap_base: WebAssembly.Global };
  const heap = new WasmHeap(ex.memory, Number(ex.__heap_base.value));
  heap.reserve(8 << 20);
  return { heap, ex, features: ex.sk_features() };
}

benchMain(({ args, log }) => {
  const quick = args.includes('--quick');
  const opts = { clock: cpuMs, clockName: 'cpu', reps: quick ? 15 : 41, warmupMs: quick ? 150 : 400, minSampleMs: quick ? 4 : 8 };
  if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
  const w = simWasmInstance()!;
  const st = simWasmStatus();
  log(`# wasm: ${st.source} (${st.bytes} B, simd=${st.features?.simd128}, init ${st.initMs.toFixed(2)} ms)`);
  const wb = makeBlurKernels(js);
  const N = 256, nn = N * N, M2 = 128, M4 = 64;

  // plain arrays (copy mode) and heap arrays (zero copy), identical contents
  const base = dense(nn, 1), srcS = sparse(nn, 2), srcS2 = sparse(nn, 3);
  const P = {
    a: base.slice(), t: new Float32Array(nn), o: new Float32Array(nn), src: srcS.slice(), src2: srcS2.slice(), acc: dense(nn, 4), field: new Float32Array(nn),
    c: new Float32Array(M2 * M2), ct: new Float32Array(M2 * M2), cacc: dense(M2 * M2, 5),
  };
  const Q = { a: base.slice(), t: new Float32Array(nn), o: new Float32Array(nn), src: srcS.slice(), src2: srcS2.slice(), acc: P.acc.slice(), field: new Float32Array(nn), c: new Float32Array(M2 * M2), ct: new Float32Array(M2 * M2), cacc: P.cacc.slice() };
  const H = { a: base.slice(), t: new Float32Array(nn), o: new Float32Array(nn), src: srcS.slice(), src2: srcS2.slice(), acc: P.acc.slice(), field: new Float32Array(nn), c: new Float32Array(M2 * M2), ct: new Float32Array(M2 * M2), cacc: P.cacc.slice() };
  // room for the copy-mode staging of the 512² / 1024² cases: once views are pinned the heap no longer grows implicitly
  adoptLayers(H, w.heap, { reserveExtra: 24 << 20 });

  /** a full pollution + crime pass worth of blur calls (pollution.ts stageAirNear / stageAir / noise / water, crime.ts) */
  const pollutionPass = (b: typeof js, X: typeof P) => {
    const g = 0.37;
    X.field.fill(0);
    X.cacc.fill(0);
    b.blurDown(X.src, N, 2, 1, X.c, X.ct);
    for (let m = 0; m < M2 * M2; m++) X.cacc[m] += X.c[m] * g;
    b.blurDown(X.src2, N, 2, 2, X.c, X.ct);
    for (let m = 0; m < M2 * M2; m++) X.cacc[m] += X.c[m] * g;
    b.upsampleAdd(X.cacc, X.field, N, 2, 0.5, 0.35, -0.8);
    b.upsampleAdd(X.cacc, X.field, N, 2, 0.5, 0.7, -1.6);
    b.blurDown(X.src2, N, 4, 2, X.c, X.ct);
    b.upsampleAdd(X.c, X.field, N, 4, 0.5, 1.5, -3);
    b.upsampleAdd(X.c, X.field, N, 4, 0.5, 3, -6);
    for (let k = 0; k < 2; k++) {
      X.o.fill(0);
      b.blurDownAdd(X.src, X.o, N, 2, 1, 5.1, X.c, X.ct);
      b.blurDownAdd(X.src2, X.o, N, 4, 2, 60.3, X.c, X.ct);
    }
    X.t.set(X.a);
    b.blur3(X.t, X.acc, N, 1);
  };

  type Case = AbCase & { check?: () => boolean };
  const cases: Case[] = [];
  const keys = Object.keys(P) as (keyof typeof P)[];
  const init = Object.fromEntries(keys.map((k) => [k, P[k].slice()])) as typeof P;
  const reset = () => { for (const X of [P, Q, H]) for (const k of keys) X[k].set(init[k]); };
  /** case whose A runs on P and B on X (Q = plain arrays, H = heap arrays); `outs` = the output arrays to compare */
  const add = (c: AbCase, X: typeof P | null, outs: (keyof typeof P)[]) =>
    cases.push({ ...c, check: X ? () => { reset(); c.a(); c.b(); return outs.every((k) => sameBits(P[k], X[k])); } : () => true });

  add({ name: 'blur3 r=1 (crime) copy', aLabel: 'js', bLabel: 'wasm', a: () => js.blur3(P.a, P.t, N, 1), b: () => wb.blur3(Q.a, Q.t, N, 1) }, Q, ['a']);
  add({ name: 'blur3 r=1 (crime) zero-copy', aLabel: 'js', bLabel: 'wasm', a: () => js.blur3(P.a, P.t, N, 1), b: () => wb.blur3(H.a, H.t, N, 1) }, H, ['a', 't']);
  add({ name: 'blur3 r=1 JS restructured (control)', aLabel: 'js', bLabel: 'js-opt', a: () => js.blur3(P.a, P.t, N, 1), b: () => blur3Opt(Q.a, Q.t, N, 1) }, Q, ['a', 't']);
  add({ name: 'blur3 r=1 wasm zero-copy vs js-opt', aLabel: 'js-opt', bLabel: 'wasm', a: () => blur3Opt(P.a, P.t, N, 1), b: () => wb.blur3(H.a, H.t, N, 1) }, H, ['a', 't']);
  add({ name: 'blur3 r=4 zero-copy', aLabel: 'js', bLabel: 'wasm', a: () => js.blur3(P.a, P.t, N, 4), b: () => wb.blur3(H.a, H.t, N, 4) }, H, ['a']);
  add({ name: 'boxAverage r=2 (tree cover) copy', aLabel: 'js', bLabel: 'wasm', a: () => js.boxAverage(P.src, P.o, P.t, N, 2), b: () => wb.boxAverage(Q.src, Q.o, Q.t, N, 2) }, Q, ['o']);
  add({ name: 'boxAverage r=2 (tree cover) zero-copy', aLabel: 'js', bLabel: 'wasm', a: () => js.boxAverage(P.src, P.o, P.t, N, 2), b: () => wb.boxAverage(H.src, H.o, H.t, N, 2) }, H, ['o', 't']);
  add({ name: 'blurDown f=2 r=1 (air near) copy', aLabel: 'js', bLabel: 'wasm', a: () => js.blurDown(P.src, N, 2, 1, P.c, P.ct), b: () => wb.blurDown(Q.src, N, 2, 1, Q.c, Q.ct) }, Q, ['c']);
  add({ name: 'blurDown f=4 r=2 (air far) copy', aLabel: 'js', bLabel: 'wasm', a: () => js.blurDown(P.src, N, 4, 2, P.c, P.ct), b: () => wb.blurDown(Q.src, N, 4, 2, Q.c, Q.ct) }, Q, ['c']);
  add({ name: 'upsampleAdd f=2 plume shift copy', aLabel: 'js', bLabel: 'wasm', a: () => js.upsampleAdd(P.cacc, P.field, N, 2, 0.5, 0.7, -1.6), b: () => wb.upsampleAdd(Q.cacc, Q.field, N, 2, 0.5, 0.7, -1.6) }, Q, ['field']);
  add({ name: 'upsampleAdd f=2 plume shift zero-copy', aLabel: 'js', bLabel: 'wasm', a: () => js.upsampleAdd(P.cacc, P.field, N, 2, 0.5, 0.7, -1.6), b: () => wb.upsampleAdd(H.cacc, H.field, N, 2, 0.5, 0.7, -1.6) }, H, ['field']);
  add({ name: 'blurDownAdd f=4 r=2 (noise / water) copy', aLabel: 'js', bLabel: 'wasm', a: () => js.blurDownAdd(P.src2, P.o, N, 4, 2, 60.3, P.c, P.ct), b: () => wb.blurDownAdd(Q.src2, Q.o, N, 4, 2, 60.3, Q.c, Q.ct) }, Q, ['o', 'c']);
  add({ name: 'pollution+crime pass (13 calls) copy', aLabel: 'js', bLabel: 'wasm', a: () => pollutionPass(js, P), b: () => pollutionPass(wb, Q) }, Q, ['field', 'o', 't', 'cacc']);
  add({ name: 'pollution+crime pass (13 calls) zero-copy', aLabel: 'js', bLabel: 'wasm', a: () => pollutionPass(js, P), b: () => pollutionPass(wb, H) }, H, ['field', 'o', 't', 'cacc']);
  for (const big of quick ? [512] : [512, 1024]) {
    const a1 = dense(big * big, 9), a2 = a1.slice(), t1 = new Float32Array(big * big), t2 = new Float32Array(big * big);
    cases.push({
      name: `blur3 r=2 N=${big} copy`, aLabel: 'js', bLabel: 'wasm', a: () => js.blur3(a1, t1, big, 2), b: () => wb.blur3(a2, t2, big, 2),
      check: () => { js.blur3(a1, t1, big, 2); wb.blur3(a2, t2, big, 2); return sameBits(a1, a2); },
    });
  }

  // binary variants, raw exports, zero copy in each instance's own memory
  const tdir = (v: string) => join(process.cwd(), 'wasm', 'sim-kernels', 'target', v, 'wasm32-unknown-unknown', 'release', 'sim_kernels.wasm');
  const simd = loadVariant(tdir('simd')), scalar = loadVariant(tdir('scalar')), mvp = loadVariant(tdir('mvp'));
  const rawBlur3 = (k: RawKernels) => {
    const a = k.heap.alloc(nn * 4), t = k.heap.alloc(nn * 4), col = k.heap.alloc(N * 8);
    k.heap.F32.set(base, a >> 2);
    return () => { k.ex.blur_blur3(a, t, col, N, 1); };
  };
  if (simd && scalar) cases.push({ name: 'blur3 r=1 raw: scalar -> simd binary', aLabel: 'scalar', bLabel: 'simd', a: rawBlur3(scalar), b: rawBlur3(simd) });
  if (scalar && mvp) cases.push({ name: 'blur3 r=1 raw: mvp -> scalar (generic) binary', aLabel: 'mvp', bLabel: 'generic', a: rawBlur3(mvp), b: rawBlur3(scalar) });
  if (simd) {
    const s = simd.heap.alloc(nn * 4), d = simd.heap.alloc(nn * 4);
    simd.heap.F32.set(base, s >> 2);
    cases.push({ name: 'boxH r=1 raw simd: 1-row -> 4-row interleave', aLabel: '1-row', bLabel: '4-row', a: () => { simd.ex.blur_box_h_1row(s, d, N, 1); }, b: () => { simd.ex.blur_box_h(s, d, N, 1); } });
  }

  const results: AbResult[] = [];
  for (const c of cases) {
    // correctness first: A and B on identical inputs must give identical bits
    if (c.check && !c.check()) throw new Error(`${c.name}: A and B outputs differ — not benchmarking a broken port`);
    const r = runAB(c, opts);
    results.push(r);
    log(formatResult(r));
  }
  const heapFull = simWasmStatus().kernels.blur?.heapFullCalls ?? 0;
  if (heapFull > 0) log(`WARNING: ${heapFull} blur calls fell back to JS (heap full) — those numbers are not wasm`);
  return { wasm: { bytes: st.bytes, features: st.features, source: st.source }, heapFullCalls: heapFull, results };
});
