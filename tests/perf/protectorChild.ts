/**
 * Bundled in memory by protector.test.ts; the same entry runs in the child and its worker isolate.
 * Only node builtins load before the probe. Simulation imports and even wasm init happen afterwards (R10).
 */
import { constants, setPriority } from 'node:os';
import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import type { Fault, ProtectorReport, WorkerReport } from './protectorResult';
import type { WorkerInput, WorkerOutput } from '../../src/worker/workerProtocol';

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
      if (m.t === 'ready') worker.postMessage({ t: 'run', id: 1, days: 60 } satisfies WorkerInput);
      else if (m.t === 'pkt') {
        try {
          assertOwnedBuffers(m);
          for (const e of m.p.log) if (e[0] === EntryType.Day) {
            daysReceived++;
            if (e[1] !== daysReceived) throw new Error('missing / unordered simulation results');
          }
          bytesReceived += cloneBytes(m);
          worker.postMessage({ t: 'ack', epoch: m.epoch, ack: m.p.seq } satisfies WorkerInput);
        } catch (e) { messageError = e as Error; }
      } else if (m.t === 'done') result = m.report as WorkerReport;
      else if (m.t === 'fatal') messageError = new Error(m.message);
      else if (!['control', 'hello', 'boot'].includes(m.t)) messageError = new Error('unexpected worker message');
      probe(); // sticky: a later JIT re-optimisation cannot hide an earlier detach
    });
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited with ${code}`));
      else if (messageError) reject(messageError);
      else if (!result) reject(new Error('worker exited without its protector report'));
      else resolve();
    });
  });
  const { assertOwnedBuffers, cloneBytes, EntryType, PROTOCOL_VERSION } = await import('../../src/worker/protocol');
  const { stressCity } = await import('../infra/cityGen');
  const { serializeCity } = await import('../../src/save/serialize');
  const city = serializeCity(stressCity(128).st, { copy: true });
  worker.postMessage({ t: 'init', v: PROTOCOL_VERSION, city: { kind: 'serialized', regionId: 'protector', tileKey: '0', savedAt: city.savedAt, city },
    rctx: null, initialSpeed: 1, settings: { emergencyUncovered: 'ignore', emergencyLiveSlowmo: 3, emergencyAlerts: 'all' },
    flags: { simwasm: mode, dev: true }, persistence: 'main', deterministic: true } satisfies WorkerInput);
  try {
    await done;
    const report: ProtectorReport = { main: { initial, intact: probe() }, worker: result!, daysReceived, bytesReceived };
    console.log(`S1_PROTECTOR_REPORT=${JSON.stringify(report)}`);
  } finally { await worker.terminate(); }
} else {
  const port = parentPort!;
  const { installSimWorker } = await import('../../src/worker/simWorker');
  const { registerTestDefs } = await import('../infra/cityGen');
  const { transferOnce, growOnce } = await import('../worker/protectorFaults');
  registerTestDefs();
  const memoryBefore = wasm?.memory.buffer.byteLength ?? null;
  let memoryStable = true, afterBoot = false;
  const runtime = installSimWorker({
    postMessage(m: WorkerOutput) {
      if (m.t === 'ready') {
        afterBoot = probe();
        const fault = (process.env.S1_PROTECTOR_FAULT ?? 'none') as Fault;
        if (fault === 'transfer') transferOnce(port);
        else if (fault === 'grow') { if (!wasm) throw new Error('grow requires wasm'); growOnce(wasm.memory); }
        else if (fault !== 'none') throw new Error(`unknown negative control: ${fault}`);
      }
      memoryStable = memoryStable && (wasm?.memory.buffer.byteLength ?? null) === memoryBefore;
      probe();
      port.postMessage(m);
      if (m.t === 'pkt' && m.p.replies?.some((r) => r.t === 'ran')) {
        const status = simWasmStatus();
        const report: WorkerReport = { initial, afterBoot, intact: probe(), days: m.p.clock.day, mode,
          blurActive: status.kernels.blur?.active ?? false, memoryBefore, memoryAfter: wasm?.memory.buffer.byteLength ?? null,
          memoryStable, loaderGrows: wasm?.heap.grows ?? 0 };
        port.postMessage({ t: 'done', report });
        queueMicrotask(() => runtime.dispose());
      }
    },
    listen(receive, fail, signal) {
      port.on('message', receive); port.on('messageerror', fail);
      process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
      signal.addEventListener('abort', () => {
        port.off('message', receive); port.off('messageerror', fail);
        process.off('uncaughtException', fail); process.off('unhandledRejection', fail); port.close();
      }, { once: true });
    },
  });
}
