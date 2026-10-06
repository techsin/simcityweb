/**
 * One benchmark arm in its OWN V8 isolate (worker thread): no inline-cache / JIT feedback is shared with the other
 * arms (in one isolate the original's prototype methods and the shared sim helpers would see every arm's objects and
 * go polymorphic, skewing all arms), and each arm has its own ArrayBuffer-detaching protector (protector.ts): intact
 * unless the arm's kind ends in '-inv'. The coordinator (insitu.ts / e2e.ts) interleaves the arms by message; while one
 * arm runs, every other thread of the process is blocked, so process CPU time measured here is this arm's.
 * Commands: init, cycle (optionally after a network edit: a dead-end road cell bulldozed / rebuilt alternately,
 * identical in every arm), days, digest, save.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { initSimWasmSync, simWasmInstance, simWasmStatus, type SimWasmInstance } from '../../../src/wasm/simWasm';
import { trafficWasmStats, type TrafficWasmCore } from '../../../src/wasm/kernels/trafficBind';
import { adoptLayers } from '../../../src/wasm/layers';
import { schedulerOf } from '../../../src/sim/infra/scheduler';
import { serializeCity } from '../../../src/save/serialize';
import { fixtureDir, loadCity } from './fixtures';
import { baseKind, cpuMs, makeArm, runCycle, searchModeFor, type Arm, type ArmKind } from './arms';
import { digestTraffic } from './compare';
import { instanceFromFile } from './instances';
import { invalidateProtector, makeProtectorProbe } from './protector';
import { editToggle } from './edit';

interface Init { kind: ArmKind; fixture: string; args: string[]; resident: boolean; scalar?: string; fdlibm?: string }
const init = workerData as Init;
let arm: Arm | null = null;
let inst: SimWasmInstance | null = null;
let probe: (() => boolean) | null = null;

function saveHash(a: Arm): string {
  const s = serializeCity(a.st, { copy: true }) as unknown as Record<string, unknown>;
  const h = createHash('sha256');
  const walk = (v: unknown, path: string) => {
    if (ArrayBuffer.isView(v)) { h.update(path); h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)); return; }
    if (v === null || typeof v !== 'object') { h.update(path + '=' + String(v) + ';'); return; }
    if (v instanceof Map) { for (const [k, x] of v) walk(x, `${path}<${String(k)}>`); return; }
    for (const k of Object.keys(v as object)) if (k !== 'savedAt') walk((v as Record<string, unknown>)[k], `${path}.${k}`);
  };
  walk(s, '$');
  return h.digest('hex');
}

/** state that proves what the arm ran on: protector, wasm heap growth, JS fallbacks of the traffic core */
function armState(): Record<string, unknown> {
  const w = arm?.core as TrafficWasmCore | null;
  return {
    protector: probe ? probe() : null,
    heap: inst ? inst.heap.stats() : null,
    jsCalls: trafficWasmStats.jsCalls, wasmCalls: trafficWasmStats.wasmCalls, traps: trafficWasmStats.traps,
    lastJsReason: w && 'lastJsReason' in w ? w.lastJsReason : null,
  };
}

parentPort!.on('message', async (m: { cmd: string; n?: number; flush?: boolean; edit?: boolean }) => {
  try {
    if (m.cmd === 'init') {
      // the probe first (it can only see an invalidation that happens after it was optimized; needs natives syntax),
      // then '-inv' arms invalidate the protector before any sim code is optimized
      probe = makeProtectorProbe();
      if (init.kind.endsWith('-inv')) invalidateProtector();
      if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
      const instances: Partial<Record<ArmKind, () => SimWasmInstance | null>> = {};
      const base = baseKind(init.kind);
      if (base === 'wasm-scalar') { if (!init.scalar) throw new Error('wasm-scalar needs --scalar'); const i = instanceFromFile(init.scalar, 'scalar'); instances[base] = () => i; }
      if (base === 'wasm-fdlibm') { if (!init.fdlibm) throw new Error('wasm-fdlibm needs --fdlibm'); const i = instanceFromFile(init.fdlibm, 'fdlibm'); instances[base] = () => i; }
      inst = base.startsWith('wasm') || base === 'orig-ws' ? (instances[base]?.() ?? simWasmInstance()) : null;
      const st = (await loadCity(init.fixture, fixtureDir(init.args))).st;
      if (init.resident && base.startsWith('wasm')) adoptLayers(st, inst!.heap, { reserveExtra: 32 << 20 });
      arm = makeArm(init.kind, st, instances);
      parentPort!.postMessage({ ok: true, pop: st.stats.population, day: st.day, nodes: arm.tr.road.n, total: arm.tr.road.n + arm.tr.rail.n + arm.tr.subway.n, oN: arm.tr.oN, jN: arm.tr.jN, stops: arm.tr.stops.n, initMs: arm.initMs, ...armState() });
    } else if (m.cmd === 'cycle') {
      if (m.edit) editToggle(arm!);
      const j0 = trafficWasmStats.jsCalls;
      const ms = runCycle(arm!);
      parentPort!.postMessage({ ms, phases: Array.from(arm!.phaseCpu), steps: Array.from(arm!.phaseSteps), jsCalls: trafficWasmStats.jsCalls - j0 });
    } else if (m.cmd === 'days') {
      const a = arm!;
      searchModeFor(a.kind);
      a.phaseCpu.fill(0);
      const sch = schedulerOf(a.sim);
      const t0 = cpuMs();
      for (let d = 0; d < m.n!; d++) { a.sim.advanceDay(); if (m.flush) sch.flush(a.sim); }
      const ms = (cpuMs() - t0) / m.n!;
      searchModeFor('orig');
      let tr = 0;
      for (let p = 0; p < a.phaseCpu.length; p++) tr += a.phaseCpu[p];
      parentPort!.postMessage({ ms, traffic: tr / m.n! });
    } else if (m.cmd === 'digest') {
      const w = arm!.core as TrafficWasmCore | null;
      parentPort!.postMessage({ digest: digestTraffic(arm!.tr, arm!.st), stats: { ...trafficWasmStats }, arena: w && 'arenaBytes' in w ? w.arenaBytes : 0, pop: arm!.st.stats.population, ...armState() });
    } else if (m.cmd === 'save') {
      parentPort!.postMessage({ hash: saveHash(arm!), pop: arm!.st.stats.population, day: arm!.st.day });
    }
  } catch (e) {
    parentPort!.postMessage({ error: e instanceof Error ? e.stack ?? e.message : String(e) });
  }
});
