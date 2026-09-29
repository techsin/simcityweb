/// <reference lib="webworker" />
/**
 * Services tier engine A/B — headless-Chromium entry, runs inside a dedicated Web Worker (where the sim would run in
 * the game). Driven by tools/bench/servicesTierEngine.bench.mjs, which serves this bundle, the two wasm binaries and a
 * fixture. Clock: performance.now() (wall clock — browsers expose no CPU-time clock; samples are interleaved and
 * order-alternated like in node, but under machine load wall time also counts descheduled time).
 * Cases: replay (phase kernels, original JS vs fair JS vs wasm SIMD / scalar) and the full services pass (original vs
 * wasm, fair JS vs wasm), each checked bit-exact first.
 */
import { deserializeCity, type SerializedCity } from '../../src/save/serialize';
import { unpackFile } from '../../src/save/bundle';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import type { ServicesSystem } from '../../src/sim/infra/services';
import { infoOf } from '../../src/sim/infra/common';
import { WasmHeap } from '../../src/wasm/heap';
import type { CatchWasm } from '../../src/wasm/kernels/servicesBind';
import { installServicesTierEngine } from '../../src/wasm/kernels/services';
import { runAB, type AbResult } from './ab';
import { captureSlots, checkImpl, fairImpl, origImpl, replayAB, wasmImpl } from './servicesTierEngine.core';

interface Job {
  fixture: string;
  simd: string;
  scalar: string | null;
  reps: number;
}

async function instance(url: string, reserve: number): Promise<CatchWasm> {
  const bytes = await (await fetch(url)).arrayBuffer();
  const { instance: inst } = await WebAssembly.instantiate(bytes, {});
  const ex = inst.exports as unknown as CatchWasm['ex'] & { memory: WebAssembly.Memory; __heap_base: WebAssembly.Global };
  const heap = new WasmHeap(ex.memory, Number(ex.__heap_base.value));
  heap.reserve(reserve);
  return { ex, memory: ex.memory, heap };
}

self.onmessage = async (ev: MessageEvent<Job>) => {
  const job = ev.data;
  const log: string[] = [];
  const say = (s: string) => { log.push(s); (self as unknown as Worker).postMessage({ log: s }); };
  try {
    const opts = { reps: job.reps, warmupMs: 600, minSampleMs: 10, clock: () => performance.now(), clockName: 'wall' };
    const bytes = new Uint8Array(await (await fetch(job.fixture)).arrayBuffer());
    const load = async () => deserializeCity((await unpackFile(bytes)) as SerializedCity);
    const simd = await instance(job.simd, 128 << 20);
    const scalar = job.scalar ? await instance(job.scalar, 128 << 20) : null;
    say(`# ${navigator.userAgent}; fixture ${job.fixture}; ${job.reps} pairs, wall clock in a worker`);
    // ---- replay
    const st = await load();
    const sim = new Simulation(st, createSystems());
    const svc = sim.getSystem<ServicesSystem>('services')!;
    svc.compute(sim, false);
    const slots = captureSlots(svc, st.cells, (k, b) => (k === 8 ? infoOf(st, b as never).covStrength : infoOf(st, b as never).tierStrength));
    say(`# pop ${st.stats.population}; ${slots.length} slots, ${slots.reduce((p, s) => p + s.entries, 0)} pool entries`);
    const O = origImpl(slots), J = fairImpl(slots), W = wasmImpl(simd, slots, 'wasm SIMD');
    const WS = scalar ? wasmImpl(scalar, slots, 'wasm scalar') : null;
    for (const x of [J, W, ...(WS ? [WS] : [])]) {
      const bad = checkImpl(O, x);
      if (bad.length) throw new Error(`replay ${x.label} differs: ${bad.slice(0, 4).join('; ')}`);
    }
    say('replay outputs bit-exact (fair JS, wasm SIMD' + (WS ? ', wasm scalar' : '') + ')');
    const replay: AbResult[] = [...replayAB(O, W, slots, opts, say), ...replayAB(J, W, slots, opts, say)];
    if (WS) replay.push(...replayAB(WS, W, slots, opts, say));
    // ---- full passes
    const mk = async (arm: 'orig' | 'js' | 'wasm') => {
      const s2 = await load();
      const systems = createSystems();
      const sv = systems.find((x) => x.name === 'services') as ServicesSystem;
      if (arm !== 'orig') installServicesTierEngine(sv, { backend: arm, wasm: arm === 'wasm' ? await instance(job.simd, 160 << 20) : undefined });
      const sm = new Simulation(s2, systems);
      return { sim: sm, svc: sv };
    };
    const A = await mk('orig'), Jn = await mk('js'), Wn = await mk('wasm');
    const pass = (x: { sim: Simulation; svc: ServicesSystem }) => () => x.svc.compute(x.sim, false);
    for (const x of [A, Jn, Wn]) for (let i = 0; i < 2; i++) pass(x)();
    const passes: AbResult[] = [];
    for (const [name, x, y, la, lb] of [['full pass: orig vs wasm', A, Wn, 'orig', 'wasm'], ['full pass: fair js vs wasm', Jn, Wn, 'js', 'wasm']] as const) {
      const r = runAB({ name, a: pass(x), b: pass(y), aLabel: la, bLabel: lb }, { ...opts, minSampleMs: 20 });
      passes.push(r);
      say(`${name}: ${r.a.median.toFixed(2)} vs ${r.b.median.toFixed(2)} ms, speedup ${r.speedup.median.toFixed(2)}x [${r.speedup.lo.toFixed(2)}, ${r.speedup.hi.toFixed(2)}]; ` +
        `least-disturbed samples ${r.a.min.toFixed(2)} vs ${r.b.min.toFixed(2)} ms = ${(r.a.min / r.b.min).toFixed(2)}x`);
    }
    // the three cities must still be bit-identical after all timed passes
    const diff = (p: Simulation, q: Simulation): string[] => {
      const out: string[] = [];
      for (const [k, v] of Object.entries(p.state)) {
        const w = (q.state as unknown as Record<string, unknown>)[k];
        if (!ArrayBuffer.isView(v) || !ArrayBuffer.isView(w)) continue;
        const x = new Uint8Array(v.buffer, v.byteOffset, v.byteLength), y = new Uint8Array(w.buffer, w.byteOffset, w.byteLength);
        if (x.length !== y.length) { out.push(k); continue; }
        for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { out.push(k); break; }
      }
      if (JSON.stringify(p.state.stats) !== JSON.stringify(q.state.stats)) out.push('stats');
      return out;
    };
    const identical = diff(A.sim, Wn.sim).length === 0 && diff(A.sim, Jn.sim).length === 0;
    say(`cities bit-identical after the timed passes (orig / fair JS / wasm): ${identical}`);
    if (!identical) throw new Error(`browser cities differ: wasm ${diff(A.sim, Wn.sim).slice(0, 4)} js ${diff(A.sim, Jn.sim).slice(0, 4)}`);
    (self as unknown as Worker).postMessage({ done: true, result: { userAgent: navigator.userAgent, replay, passes, identical, log } });
  } catch (e) {
    (self as unknown as Worker).postMessage({ done: true, error: e instanceof Error ? e.stack ?? e.message : String(e), log });
  }
};
