/**
 * Browser suite of the trafficCore A/B (headless Chromium via tools/bench/trafficCore.bench.mjs browser): the fixture
 * is fetched and deserialized once per arm (the tree's own save code), the arms (orig / fair / wasm SIMD / wasm scalar)
 * run TrafficSystem.runCycleSync interleaved with a rotating order after warm-up cycles. Browsers have no CPU clock:
 * wall-clock (performance.now), median / min and the 95% bootstrap CI of the paired ratio. Runs on the main thread and
 * in a module Worker (browserPage.ts / browserWorker.ts).
 */
import { unpackFile } from '../../../src/save/bundle';
import { deserializeCity } from '../../../src/save/serialize';
import { registerTestDefs } from '../../../tests/infra/cityGen';
import { initSimWasmSync, simWasmStatus, type SimWasmInstance } from '../../../src/wasm/simWasm';
import { WasmHeap } from '../../../src/wasm/heap';
import { adoptLayers } from '../../../src/wasm/layers';
import { simWasmInstance } from '../../../src/wasm/simWasm';
import { bootstrapMedianCI } from '../ab';
import { makeArm, PHASE_NAMES, runCycle, type Arm, type ArmKind } from './arms';
import { diffCity, diffTraffic } from './compare';

const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };

export function instanceFrom(bytes: ArrayBuffer, label: string): SimWasmInstance {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
  const ex = inst.exports as unknown as SimWasmInstance['exports'];
  const heap = new WasmHeap(ex.memory, Number(ex.__heap_base.value));
  heap.reserve(4 << 20);
  const f = ex.sk_features();
  return {
    exports: ex, memory: ex.memory, heap, source: label, bytes: bytes.byteLength, initMs: 0,
    features: { simd128: (f & 1) !== 0, std: (f & 2) !== 0, bulkMemory: (f & 4) !== 0, nontrappingFptoint: (f & 8) !== 0, signExt: (f & 16) !== 0, atomics: (f & 32) !== 0 },
  };
}

export interface BrowserOpts {
  fixture: string;
  testdefs: boolean;
  pairs: number;
  warm: number;
  resident: boolean;
  where: string;
  log: (s: string) => void;
}

export async function runBrowserTraffic(o: BrowserOpts): Promise<unknown> {
  const t0 = performance.now();
  const wasmBytes = await (await fetch('/sim_kernels.wasm')).arrayBuffer();
  if (!initSimWasmSync(wasmBytes)) throw new Error('wasm init failed: ' + simWasmStatus().error);
  const sres = await fetch('/scalar.wasm');
  const scalar = sres.ok ? instanceFrom(await sres.arrayBuffer(), 'scalar') : null;
  const file = new Uint8Array(await (await fetch('/fixture.metropolis')).arrayBuffer());
  if (o.testdefs) registerTestDefs();
  const kinds: ArmKind[] = scalar ? ['orig', 'fair', 'wasm', 'wasm-scalar'] : ['orig', 'fair', 'wasm'];
  const arms: Arm[] = [];
  for (const k of kinds) {
    const st = deserializeCity((await unpackFile(file)) as Parameters<typeof deserializeCity>[0]);
    if (o.resident && k.startsWith('wasm')) adoptLayers(st, (k === 'wasm' ? simWasmInstance()! : scalar!).heap, { reserveExtra: 32 << 20 });
    arms.push(makeArm(k, st, { 'wasm-scalar': () => scalar }));
  }
  o.log(`[${o.where}] ${o.fixture}: pop ${arms[0].st.stats.population}, road nodes ${arms[0].tr.road.n}; setup ${(performance.now() - t0).toFixed(0)} ms; arms ${kinds.join(', ')}`);
  for (let k = 0; k < o.warm; k++) for (const a of arms) runCycle(a);
  const cyc: number[][] = arms.map(() => []);
  const ph: number[][][] = arms.map(() => PHASE_NAMES.map(() => []));
  for (let k = 0; k < o.pairs; k++) {
    for (let q = 0; q < arms.length; q++) {
      const i = (q + k) % arms.length;
      cyc[i].push(runCycle(arms[i]));
      for (let p = 0; p < PHASE_NAMES.length; p++) ph[i][p].push(arms[i].phaseCpu[p]);
    }
    // let the event loop breathe (worker messages, page liveness)
    await new Promise((r) => setTimeout(r, 0));
  }
  const vs = (i: number, j: number) => {
    const r = cyc[i].map((x, k) => cyc[j][k] / x);
    const ci = bootstrapMedianCI(r);
    return { speedup: 1 / median(r), lo: 1 / ci.hi, hi: 1 / ci.lo };
  };
  const idx = (k: ArmKind) => kinds.indexOf(k);
  const ratios: Record<string, ReturnType<typeof vs>> = {};
  for (const [x, y] of [['orig', 'fair'], ['orig', 'wasm'], ['fair', 'wasm'], ['wasm-scalar', 'wasm']] as [ArmKind, ArmKind][]) {
    if (idx(x) < 0 || idx(y) < 0) continue;
    ratios[`${x}->${y}`] = vs(idx(x), idx(y));
    const r = ratios[`${x}->${y}`];
    o.log(`[${o.where}] ${x} -> ${y}: cycle ${r.speedup.toFixed(3)}x [${r.lo.toFixed(3)}, ${r.hi.toFixed(3)}] (wall clock, ${o.pairs} pairs)`);
  }
  const arm = arms.map((a, i) => ({
    kind: a.kind, cycleMs: median(cyc[i]), cycleMin: Math.min(...cyc[i]),
    phases: Object.fromEntries(PHASE_NAMES.map((n, p) => [n, median(ph[i][p])])),
  }));
  for (const a of arm) o.log(`[${o.where}] ${a.kind.padEnd(12)} cycle median ${a.cycleMs.toFixed(1)} ms, min ${a.cycleMin.toFixed(1)} ms; ${PHASE_NAMES.map((n) => `${n} ${a.phases[n].toFixed(1)}`).join(', ')}`);
  const identity = Object.fromEntries(arms.slice(1).map((a) => [a.kind, [...diffTraffic(arms[0].tr, a.tr), ...diffCity(arms[0].st, a.st)]]));
  o.log(`[${o.where}] identical to orig after ${o.warm + o.pairs} cycles: ${Object.entries(identity).map(([k, d]) => `${k} ${d.length ? 'NO ' + d.slice(0, 2).join('; ') : 'yes'}`).join(', ')}`);
  return { where: o.where, fixture: o.fixture, pairs: o.pairs, arms: arm, ratios, identity, simd: simWasmStatus().features?.simd128 ?? null };
}
