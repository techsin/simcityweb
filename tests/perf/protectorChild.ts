/**
 * Bundled in memory by protector.test.ts; the same entry runs in the child and its worker isolate.
 * Only node builtins load before the probe. Simulation imports and even wasm init happen afterwards (R10).
 */
import { constants, setPriority } from 'node:os';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import type { Fault, ProtectorReport, WorkerReport } from './protectorResult';

/** makeProbe from tools/bench/baselines/pi1Day.ts; fail closed if natives / optimisation are unavailable. */
function makeProbe(): (() => boolean) | null {
  try {
    const ta = new Float32Array(64);
    const probe = new Function('a', 'let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s;');
    const prep = new Function('f', 'a', '%PrepareFunctionForOptimization(f); f(a); f(a); %OptimizeFunctionOnNextCall(f); f(a);');
    const status = new Function('f', 'return %GetOptimizationStatus(f);');
    prep(probe, ta);
    const s0 = status(probe) as number;
    if (!(s0 & 16)) return null; // an unoptimised loop cannot observe invalidation
    let intact = true;
    return () => { probe(ta); intact = intact && status(probe) === s0; return intact; };
  } catch { return null; }
}

const probe = makeProbe();
if (!probe) throw new Error('protector probe unavailable: run node with --allow-natives-syntax');
const initial = probe();

const mode = process.env.SIM_WASM!;
if (mode !== 'js' && mode !== 'wasm') throw new Error(`unexpected kernel mode: ${mode}`);
const { initSimWasmSync, simWasmInstance, simWasmStatus } = await import('../../src/wasm/simWasm');
if (mode === 'wasm' && !initSimWasmSync()) throw new Error(`wasm init failed: ${simWasmStatus().error}`);
const wasm = mode === 'wasm' ? simWasmInstance()! : null;

if (isMainThread) {
  setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
  const source = (globalThis as { __s1Source?: string }).__s1Source;
  if (!source) throw new Error('missing bundled worker source');
  // V8 flags are process-wide. Do not put them in Worker.execArgv (ERR_WORKER_INVALID_EXEC_ARGV).
  const worker = new Worker(new URL(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
  let daysReceived = 0, bytesReceived = 0;
  let result: WorkerReport | undefined;
  let messageError: Error | undefined;
  const done = new Promise<void>((resolve, reject) => {
    worker.on('error', reject);
    worker.on('messageerror', reject);
    worker.on('message', (m) => {
      if (m.t === 'day') {
        daysReceived++;
        if (m.day !== daysReceived || !(m.traffic instanceof Float32Array) || !(m.crime instanceof Float32Array)) {
          messageError = new Error('missing / unordered simulation results');
        } else {
          bytesReceived += m.traffic.byteLength + m.crime.byteLength;
          if ([m.traffic, m.crime].some((a) => a.byteOffset !== 0 || a.byteLength !== a.buffer.byteLength)) {
            messageError = new Error('a result view does not own its buffer');
          }
        }
      } else if (m.t === 'done') result = m.report as WorkerReport;
      else if (m.t !== 'control') messageError = new Error('unexpected worker message');
      probe(); // sticky: a later JIT re-optimisation cannot hide an earlier detach
    });
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited with ${code}`));
      else if (messageError) reject(messageError);
      else if (!result) reject(new Error('worker exited without its protector report'));
      else resolve();
    });
  });
  // Exercise clone-only traffic in both directions, including an actual owned typed array.
  worker.postMessage({ t: 'run', bytes: new Uint8Array([1, 2, 3]) });
  try {
    await done;
    const report: ProtectorReport = { main: { initial, intact: probe() }, worker: result!, daysReceived, bytesReceived };
    console.log(`S1_PROTECTOR_REPORT=${JSON.stringify(report)}`);
  } finally { await worker.terminate(); }
} else {
  const port = parentPort!;
  port.once('message', async (m) => {
    if (m.t !== 'run' || m.bytes?.[2] !== 3) throw new Error('bad clone-only start message');
    const { SimCore } = await import('../../src/worker/SimCore');
    const { createSystems } = await import('../../src/sim/systems/index');
    const { CityActions } = await import('../../src/sim/actions');
    const { stressCity } = await import('../infra/cityGen');
    const memoryBefore = wasm?.memory.buffer.byteLength ?? null;
    let memoryStable = true;
    const { st } = stressCity(128);
    // The host's flag picks the kernels: in wasm mode the simulation's own blur calls run the wasm drop-in.
    const core = new SimCore(st, undefined, { simwasm: mode });
    core.boot(null, { createSystems, CityActions });
    const sim = core.sim;
    const afterBoot = probe();
    const { transferOnce, growOnce } = await import('../worker/protectorFaults');
    const fault = (process.env.S1_PROTECTOR_FAULT ?? 'none') as Fault;
    if (fault === 'transfer') transferOnce(port);
    else if (fault === 'grow') {
      if (!wasm) throw new Error('grow negative control requires SIM_WASM=wasm');
      growOnce(wasm.memory);
    } else if (fault !== 'none') throw new Error(`unknown negative control: ${fault}`);
    for (let day = 0; day < 60; day++) {
      sim.advanceDay();
      // W1.1: replace these result snapshots with recorder packets (owned buffers, no transfer list).
      port.postMessage({ t: 'day', day: st.day, stats: st.stats, traffic: st.traffic.slice(), crime: st.crime.slice() });
      memoryStable = memoryStable && (wasm?.memory.buffer.byteLength ?? null) === memoryBefore;
      probe();
    }
    const status = simWasmStatus();
    const report: WorkerReport = {
      initial, afterBoot, intact: probe(), days: st.day, mode,
      blurActive: status.kernels.blur?.active ?? false,
      memoryBefore, memoryAfter: wasm?.memory.buffer.byteLength ?? null, memoryStable,
      loaderGrows: wasm?.heap.grows ?? 0,
    };
    port.postMessage({ t: 'done', report });
    port.close();
  });
}
