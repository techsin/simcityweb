import assert from 'node:assert/strict';
import { installSimWorker } from '../../../src/worker/simWorker';
import { WorkerSimHost, HostCrashed } from '../../../src/worker/WorkerSimHost';
import { WorkerLiveness, type WorkerInput, type WorkerOutput, type WorkerPort } from '../../../src/worker/workerProtocol';
import { EntryType, PROTOCOL_VERSION } from '../../../src/worker/protocol';
import { CityActions } from '../../../src/sim/actions';
import type { Simulation } from '../../../src/sim/Simulation';
import { schedulerOf } from '../../../src/sim/infra/scheduler';
import { DisastersSystem } from '../../../src/sim/infra/disasters';
import { MemoryKV } from '../../../src/save/db';
import { initialCity } from './hostChecks';
import { nodeWorkerPort } from './nodePort';

export function livenessChecks(): void {
  let now = 0; const life = new WorkerLiveness(() => now);
  now = 60000; assert.equal(life.poll().timeout, false, 'download has no hello timer');
  life.scriptLoaded(); now += 9999; assert.equal(life.poll().timeout, false);
  now++; assert.equal(life.poll().timeout, true);
  life.received('hello'); now += 19000; assert.equal(life.poll().timeout, false);
  life.received('boot'); now += 19999; assert.equal(life.poll().timeout, false);
  now++; assert.equal(life.poll().timeout, true, '20 s without boot progress');
  life.received('ready');
  for (let i = 0; i < 10; i++) { now += 100; life.received('pkt'); }
  assert.equal(life.poll().ping, true, 'regular packets do not suppress the 1 Hz ping');
  life.reset(false); now += 15000; assert.equal(life.poll().timeout, false);
  life.reset(true); assert.equal(life.poll().timeout, false, 'visibility/resume/pageshow reset');
  now += 9999; assert.equal(life.poll().timeout, false);
  now++; assert.equal(life.poll().timeout, true, '10 visible seconds without a packet');
}

/** Exact task boundaries, independent of CPU speed: a microtask must finish between every day / step. */
export async function unitChecks(): Promise<void> {
  let receive!: (m: WorkerInput) => void, readyEpoch = 0, allowAck = false, busy = false;
  let pressurePackets = -1, steps = 0, liveDays = 0, phase: 'design' | 'live' = 'design';
  const messages: WorkerOutput[] = [], faults: string[] = [];
  const waits = new Set<{ test: (m: WorkerOutput) => boolean; resolve(m: WorkerOutput): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const until = (test: (m: WorkerOutput) => boolean): Promise<WorkerOutput> => {
    const old = messages.find(test); if (old) return Promise.resolve(old);
    return new Promise((resolve, reject) => {
      const waiter = { test, resolve, reject, timer: setTimeout(() => { waits.delete(waiter); reject(new Error('Worker unit check timed out')); }, 5000) };
      waits.add(waiter);
    });
  };
  function oneUnit(): void {
    if (busy) faults.push('multiple day / step units in one task');
    busy = true; queueMicrotask(() => { busy = false; });
  }
  const system = {
    name: 'unit-test',
    init(sim: Simulation) {
      const scheduler = schedulerOf(sim);
      scheduler.register({ name: 'test-step', due: () => phase === 'live' && steps < 3, urgent: () => false, cost: () => 0,
        step: () => { oneUnit(); steps++; } });
    },
    frame(sim: Simulation) { schedulerOf(sim).tickFrame(sim, system); },
    daily(sim: Simulation) {
      oneUnit();
      if (phase === 'design' && sim.state.day === 8) {
        pressurePackets = messages.filter((m) => m.t === 'pkt').length;
        allowAck = true;
        queueMicrotask(() => receive({ t: 'ping', n: 7, ack: 5, epoch: readyEpoch }));
      }
      if (phase === 'live') {
        liveDays++;
        // A player pause posted during a day must be observed before another day of this tick.
        receive({ t: 'cmd', seq: 1, op: 'setSpeed', args: [0, 'pause'] });
      }
    },
  };
  const runtime = installSimWorker({
    listen(fn) { receive = fn; },
    postMessage(message) {
      const m = structuredClone(message); messages.push(m);
      if (m.t === 'ready') readyEpoch = m.epoch;
      if (m.t === 'pkt' && allowAck) receive({ t: 'ack', ack: m.p.seq, epoch: m.epoch });
      for (const w of waits) if (w.test(m)) { clearTimeout(w.timer); waits.delete(w); w.resolve(m); }
    },
  }, { createSystems: () => [system], CityActions });
  const city = initialCity();
  try {
    receive({ t: 'init', v: PROTOCOL_VERSION, city: { kind: 'serialized', regionId: 'units', tileKey: '0', savedAt: 1, city },
      persistence: 'main', rctx: null, initialSpeed: 3, settings: { emergencyUncovered: 'ignore', emergencyLiveSlowmo: 3, emergencyAlerts: 'all' },
      flags: { simwasm: null, dev: true } });
    await until((m) => m.t === 'ready');
    receive({ t: 'run', id: 1, days: 12 });
    await until((m) => m.t === 'pkt' && !!m.p.replies?.some((r) => r.t === 'ran' && r.id === 1));
    assert.equal(pressurePackets, 5, 'seq - ack > 4 suppresses flushes while the recorder merges');
    const packets = messages.filter((m) => m.t === 'pkt');
    const days = packets.flatMap((m) => m.p.log.filter((e) => e[0] === EntryType.Day).map((e) => e[1]));
    assert.deepEqual(days, Array.from({ length: 12 }, (_, i) => i + 1));
    assert.ok(packets.some((m) => m.p.log.filter((e) => e[0] === EntryType.Day).length >= 3));
    assert.ok(packets.some((m) => m.p.pong === 7));
    phase = 'live';
    receive({ t: 'tick', seq: 1, dt: 0.25, ack: packets.at(-1)!.p.seq, epoch: readyEpoch });
    await until((m) => m.t === 'pkt' && m.p.cmd === 1);
    assert.equal(steps, 3); assert.equal(liveDays, 1); assert.deepEqual(faults, []);
    assert.equal(messages.some((m) => m.t === 'fatal' || (m.t === 'pkt' && m.p.replies?.some((r) => r.t === 'error'))), false);
  } finally {
    runtime.dispose();
    for (const w of waits) { clearTimeout(w.timer); w.reject(new Error('Disposed')); } waits.clear();
  }
}

export async function resyncAndCrash(url: URL): Promise<void> {
  const raw = nodeWorkerPort(url), city = initialCity();
  let corrupt = true, kill = false;
  const port: WorkerPort = {
    postMessage(m) { if (kill && (m.t === 'cmd' || m.t === 'query')) { void raw.terminate(); return; } raw.postMessage(m); },
    listen(receive, fail, signal) { raw.listen((m) => {
      if (m.t === 'pkt' && m.p.cmd === 1 && corrupt) { corrupt = false; m.p.seq++; }
      receive(m);
    }, fail, signal); },
    terminate: () => raw.terminate(),
  };
  const host = new WorkerSimHost({ kind: 'serialized', regionId: 'resync', tileKey: '0', savedAt: 1, city }, { port, kv: new MemoryKV(), deterministic: true });
  try {
    await host.ready;
    const before = host.state;
    await host.act('setTax', [0, 12]).done;
    assert.notEqual(host.state, before, 'resync adopts a fresh state');
    assert.equal(host.state.budget.taxRates[0], 12, 'the lost ack settles from ready');
    kill = true;
    const ticket = host.act('setTax', [0, 13]), query = host.query('verify', {});
    await Promise.all([assert.rejects(ticket.done, HostCrashed), assert.rejects(query, HostCrashed)]);
  } finally { await host.dispose(); }
}

export async function bootFailures(): Promise<void> {
  for (const failure of ['script error', 'messageerror', 'version'] as const) {
    let receive!: (m: WorkerOutput) => void, fail!: (e: unknown) => void, terminated = false;
    const port: WorkerPort = { postMessage() {}, listen(r, f) { receive = r; fail = f; }, terminate() { terminated = true; } };
    const city = initialCity();
    const host = new WorkerSimHost({ kind: 'serialized', regionId: 'failed', tileKey: '0', savedAt: 1, city }, { port });
    const rejected = assert.rejects(host.ready, HostCrashed);
    if (failure === 'version') receive({ t: 'hello', v: PROTOCOL_VERSION + 1 }); else fail(new Error(failure));
    await rejected; assert.equal(terminated, true); await host.dispose();
  }
}

export function explicitLiveChecks(): void {
  const disasters = new DisastersSystem();
  // No wall-clock sleeps: an explicit flag wins over either stale or recent frame timestamps.
  const sim = { state: { day: 1 } } as Simulation;
  const scheduler = schedulerOf(sim);
  scheduler.live = true; assert.equal(scheduler.framesActive, true);
  scheduler.live = false; scheduler.tickFrame(sim, {}); assert.equal(scheduler.framesActive, false);
  disasters.live = true;
  const tornado = { kind: 'tornado' as const, x: 1, z: 1, daysLeft: 4, heading: 0, magnitude: 1 };
  disasters.active.push(tornado); disasters.daily(sim);
  assert.equal(tornado.daysLeft, 4, 'a stale frame timestamp cannot advance a live tornado by a whole day');
}
