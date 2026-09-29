/**
 * Memory-model study for the architect:  npm run bench:wasm -- memory [--json out.json] [--quick]
 *  (a) per-call overhead of JS -> wasm calls (trivial exports) and of the binding layer
 *  (b) cost of copying a 256² Float32Array into / out of wasm memory
 *  (c) one-pass kernels in place (layers living in wasm memory) vs copy-in / copy-out vs plain JS
 *  (d) view creation / memory.buffer / memory.grow costs
 *  (e) sizing: bytes of every typed-array layer of a real 256² CityState and of all systems' typed arrays on a grown
 *      stress city; adoptLayers() of the real CityState + a save / load round trip on wasm-backed layers
 */
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { createSystems } from '../../src/sim/systems';
import { Simulation } from '../../src/sim/Simulation';
import { DERIVED_LAYERS, deserializeCity, serializeCity } from '../../src/save/serialize';
import * as js from '../../src/sim/infra/blur';
import { makeBlurKernels } from '../../src/wasm/kernels/blurBind';
import { adoptLayers } from '../../src/wasm/layers';
import { initSimWasmSync, simWasmInstance } from '../../src/wasm/simWasm';
import { stressCity } from '../../tests/infra/cityGen';
import { formatResult, runAB, type AbResult } from './ab';
import { benchMain, cpuMs } from './node';

type Ex = Record<string, (...a: number[]) => number>;

/** median per-call CPU time (ms) of fn over `reps` samples of `inner` calls (after a warm-up) */
function timeOp(fn: () => void, inner: number, reps = 21): { median: number; min: number } {
  for (let i = 0; i < inner * 3; i++) fn();
  const xs: number[] = [];
  for (let k = 0; k < reps; k++) {
    const t0 = cpuMs();
    for (let i = 0; i < inner; i++) fn();
    xs.push((cpuMs() - t0) / inner);
  }
  xs.sort((a, b) => a - b);
  return { median: xs[xs.length >> 1], min: xs[0] };
}

const ns = (ms: number) => `${(ms * 1e6).toFixed(1)} ns`;
const us = (ms: number) => `${(ms * 1e3).toFixed(1)} µs`;
const mb = (b: number) => `${(b / 1048576).toFixed(2)} MiB`;

/** typed arrays reachable from `root` (own fields, arrays, Maps, nested objects; depth-limited); `exclude`: skip these objects */
function typedArrayBytes(root: unknown, maxDepth = 5, exclude: Set<unknown> = new Set()): { bytes: number; arrays: number; byCtor: Record<string, number>; seen: Set<unknown> } {
  const seen = new Set<unknown>(exclude);
  const byCtor: Record<string, number> = {};
  let bytes = 0, arrays = 0;
  const visit = (v: unknown, d: number): void => {
    if (v === null || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (ArrayBuffer.isView(v)) {
      bytes += v.byteLength;
      arrays++;
      byCtor[v.constructor.name] = (byCtor[v.constructor.name] ?? 0) + v.byteLength;
      return;
    }
    if (d >= maxDepth) return;
    if (v instanceof Map) { for (const x of v.values()) visit(x, d + 1); return; }
    if (v instanceof Set) return;
    if (Array.isArray(v)) { for (const x of v) visit(x, d + 1); return; }
    for (const k of Object.keys(v as object)) visit((v as Record<string, unknown>)[k], d + 1);
  };
  visit(root, 0);
  return { bytes, arrays, byCtor, seen };
}

benchMain(({ args, log }) => {
  const quick = args.includes('--quick');
  if (!initSimWasmSync()) throw new Error('wasm init failed');
  const w = simWasmInstance()!;
  const ex = w.exports as unknown as Ex;
  const h = w.heap;
  const out: Record<string, unknown> = {};
  const abOpts = { clock: cpuMs, clockName: 'cpu', reps: quick ? 15 : 31, warmupMs: quick ? 150 : 300, minSampleMs: 8 };
  const results: AbResult[] = [];
  const ab = (c: Parameters<typeof runAB>[0]) => { const r = runAB(c, abOpts); results.push(r); log(formatResult(r)); return r; };

  // ------------------------------------------------------------------ (a) call overhead
  log('## (a) per-call overhead');
  const noop = ex.sk_noop, args5 = ex.sk_args5;
  let sink = 0;
  const jsFn = [(a: number, b: number) => a + b, (a: number, b: number) => a - b]; // megamorphic-safe, not inlined away
  const tNoop = timeOp(() => { noop(); }, 200000);
  const tArgs = timeOp(() => { sink += args5(1, 2, 3, 4, 5.5); }, 200000);
  const tJs = timeOp(() => { sink += jsFn[sink & 1](1, 2); }, 200000);
  log(`wasm sk_noop(): ${ns(tNoop.median)} / call; sk_args5(5 args, f64 result): ${ns(tArgs.median)}; JS indirect call: ${ns(tJs.median)}`);
  // binding layer overhead on a tiny grid (N = 2): wrapper checks + staging vs the raw export
  const wb = makeBlurKernels(js);
  const t4 = new Float32Array(4), tt = new Float32Array(4);
  const pa = h.alloc(16), pt = h.alloc(16), pc = h.alloc(16);
  const tRaw = timeOp(() => { ex.blur_blur3(pa, pt, pc, 2, 1); }, 50000);
  const tBind = timeOp(() => { wb.blur3(t4, tt, 2, 1); }, 50000);
  const tJsTiny = timeOp(() => { js.blur3(t4, tt, 2, 1); }, 50000);
  log(`blur3 on a 2x2 grid: raw export ${ns(tRaw.median)}, binding (copy mode) ${ns(tBind.median)}, JS ${ns(tJsTiny.median)} -> binding overhead ~${ns(tBind.median - tRaw.median)} per call`);
  out.callOverhead = { noopNs: tNoop.median * 1e6, args5Ns: tArgs.median * 1e6, jsCallNs: tJs.median * 1e6, rawTinyNs: tRaw.median * 1e6, bindingTinyNs: tBind.median * 1e6, jsTinyNs: tJsTiny.median * 1e6 };

  // ------------------------------------------------------------------ (b) copies
  log('## (b) copying one 256² layer');
  const N = 256, nn = N * N;
  const layer = Float32Array.from({ length: nn }, (_, i) => Math.sin(i));
  const back = new Float32Array(nn);
  const pl = h.alloc(nn * 4);
  const tIn = timeOp(() => { h.F32.set(layer, pl >> 2); }, 200);
  const tOut = timeOp(() => { back.set(h.F32.subarray(pl >> 2, (pl >> 2) + nn)); }, 200);
  const u8 = new Uint8Array(nn), pu = h.alloc(nn);
  const tU8 = timeOp(() => { h.U8.set(u8, pu); }, 400);
  const tJsCopy = timeOp(() => { back.set(layer); }, 200);
  log(`Float32Array 256² (256 KiB): copy in ${us(tIn.median)}, copy out ${us(tOut.median)} (JS->JS .set ${us(tJsCopy.median)}); Uint8Array 256² (64 KiB) in ${us(tU8.median)}`);
  out.copy256 = { inUs: tIn.median * 1e3, outUs: tOut.median * 1e3, jsSetUs: tJsCopy.median * 1e3, u8InUs: tU8.median * 1e3 };

  // ------------------------------------------------------------------ (c) in place vs copy vs JS
  log('## (c) one-pass kernel (dst = src * k): JS vs wasm in place vs wasm with copies');
  const hs = h.allocArray(Float32Array, nn), hd = h.allocArray(Float32Array, nn);
  hs.set(layer);
  const jsd = new Float32Array(nn);
  const jsScale = (s: Float32Array, d: Float32Array, k: number) => { for (let i = 0; i < s.length; i++) d[i] = s[i] * k; };
  const scaleIn = () => { ex.sk_scale_f32(hs.byteOffset, hd.byteOffset, nn, 1.0001); };
  const pS = h.alloc(nn * 4), pD = h.alloc(nn * 4);
  const scaleCopy = () => { h.F32.set(layer, pS >> 2); ex.sk_scale_f32(pS, pD, nn, 1.0001); jsd.set(h.F32.subarray(pD >> 2, (pD >> 2) + nn)); };
  ab({ name: 'scale 256²: JS -> wasm in place', aLabel: 'js', bLabel: 'wasm', a: () => jsScale(layer, jsd, 1.0001), b: scaleIn });
  ab({ name: 'scale 256²: JS -> wasm copy in/out', aLabel: 'js', bLabel: 'wasm', a: () => jsScale(layer, jsd, 1.0001), b: scaleCopy });
  ab({ name: 'blur3 r=1 256²: copy -> in place (wasm)', aLabel: 'copy', bLabel: 'inplace', a: () => wb.blur3(layer, back, N, 1), b: () => wb.blur3(hs, hd, N, 1) });
  h.free(hs); h.free(hd);

  // ------------------------------------------------------------------ (d) views and growth
  log('## (d) views, memory.buffer, memory.grow');
  const mem = w.memory;
  const tBuf = timeOp(() => { sink += mem.buffer.byteLength & 1; }, 200000);
  const tView = timeOp(() => { sink += new Float32Array(mem.buffer, pl, nn).length & 1; }, 20000);
  const cap0 = mem.buffer.byteLength;
  const g0 = cpuMs();
  mem.grow(256); // +16 MiB (views of the old buffer are now detached)
  const tGrow = cpuMs() - g0;
  log(`memory.buffer getter ${ns(tBuf.median)}; new Float32Array(memory.buffer, off, 65536) ${ns(tView.median)}; memory.grow(+16 MiB from ${mb(cap0)}) ${tGrow.toFixed(3)} ms CPU`);
  out.views = { bufferGetterNs: tBuf.median * 1e6, newViewNs: tView.median * 1e6, grow16MiBMs: tGrow };

  // ------------------------------------------------------------------ (e) sizing + CityState in wasm memory
  log('## (e) memory sizing (256² map)');
  const st = new CityState(defaultCityConfig({ size: 256, seed: 7 }));
  const stBytes = typedArrayBytes(st, 2);
  log(`CityState(256) typed-array layers: ${stBytes.arrays} arrays, ${mb(stBytes.bytes)} (${Object.entries(stBytes.byCtor).map(([k, v]) => `${k} ${mb(v)}`).join(', ')})`);
  const city = stressCity(256);
  const sim = new Simulation(city.st, createSystems());
  for (let d = 0; d < (quick ? 20 : 60); d++) sim.advanceDay();
  const stressLayers = typedArrayBytes(city.st, 2);
  // systems' own typed arrays (CityState layers they reference are excluded)
  const sysBytes = typedArrayBytes(sim.systems, 6, stressLayers.seen);
  log(`grown stress city (${city.buildings} buildings, pop ${city.pop}): CityState ${mb(stressLayers.bytes)} + systems ${sysBytes.arrays} typed arrays ${mb(sysBytes.bytes)} (${Object.entries(sysBytes.byCtor).map(([k, v]) => `${k} ${mb(v)}`).join(', ')})`);
  const topBefore = h.stats().top;
  const tA0 = cpuMs();
  const adopted = adoptLayers(city.st, h);
  const tAdopt = cpuMs() - tA0;
  log(`adoptLayers(stress CityState): ${adopted.arrays} arrays / ${mb(adopted.bytes)} moved into wasm memory in ${tAdopt.toFixed(2)} ms; heap top ${mb(topBefore)} -> ${mb(h.stats().top)}, memory ${mb(h.capacity)}`);
  // the sim keeps running on wasm-backed layers (systems re-read st.* fields each step)
  for (let d = 0; d < 5; d++) sim.advanceDay();
  // save / load round trip
  const tS0 = cpuMs();
  const saved = serializeCity(city.st, { copy: true });
  const tSer = cpuMs() - tS0;
  const standalone = Object.values(saved.layers).flat().every((a) => (a as ArrayBufferView).buffer !== mem.buffer);
  const back2 = deserializeCity(saved);
  let same = true;
  let compared = 0;
  for (const k of adopted.keys) {
    if (DERIVED_LAYERS.has(k)) continue; // not saved by design (recomputed by their systems on load)
    compared++;
    const a = (city.st as unknown as Record<string, unknown>)[k], b = (back2 as unknown as Record<string, unknown>)[k];
    if (Array.isArray(a)) { if (!(a as Float32Array[]).every((x, i) => x.every((v, j) => Object.is(v, (b as Float32Array[])[i][j])))) same = false; }
    else if (!(a as Float32Array).every((v, j) => Object.is(v, (b as Float32Array)[j]))) same = false;
  }
  // the gotcha: structured-cloning views (serializeCity without copy) clones the WHOLE wasm memory buffer
  const live = serializeCity(city.st);
  const c0 = cpuMs();
  const cloned = structuredClone(live);
  const tClone = cpuMs() - c0;
  const clonedBuf = (Object.values(cloned.layers)[0] as ArrayBufferView).buffer.byteLength;
  const c1 = cpuMs();
  structuredClone(saved);
  const tCloneCopy = cpuMs() - c1;
  log(`serializeCity({copy:true}) ${tSer.toFixed(2)} ms, standalone buffers: ${standalone}; deserialize round trip of ${compared} saved layers identical: ${same}`);
  log(`structuredClone(serializeCity(st)) with wasm views clones a ${mb(clonedBuf)} buffer (${tClone.toFixed(1)} ms) vs ${tCloneCopy.toFixed(1)} ms for the copy:true object`);
  out.sizing = {
    cityStateArrays: stBytes.arrays, cityStateBytes: stBytes.bytes, cityStateByCtor: stBytes.byCtor,
    stressCityStateBytes: stressLayers.bytes, systemsArrays: sysBytes.arrays, systemsBytes: sysBytes.bytes, systemsByCtor: sysBytes.byCtor,
    adoptMs: tAdopt, adoptedArrays: adopted.arrays, adoptedBytes: adopted.bytes, memoryAfterAdopt: h.capacity,
    serializeCopyMs: tSer, standalone, roundTripIdentical: same, cloneViewsBufferBytes: clonedBuf, cloneViewsMs: tClone, cloneCopyMs: tCloneCopy,
  };
  adopted.release();
  out.ab = results;
  if (sink === 42.5) log('');
  return out;
});
