/**
 * W1.2's transport (T034): the worker loop's units (§3.1), backpressure and acks outside ticks (§2.10, T032 minor 8),
 * resyncs with Ready.lost on the real worker, liveness on visible time and failing fast (R11), and the O7 live flag.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DevType } from '../../src/core/types';
import { clearRecoveryBase } from '../../src/save/cities';
import { MemoryKV, setKV } from '../../src/save/db';
import type { Simulation, SimSystem } from '../../src/sim/Simulation';
import { schedulerOf } from '../../src/sim/infra/scheduler';
import { DisastersSystem } from '../../src/sim/infra/disasters';
import { bootWorkerSimHost, HostCrashed } from '../../src/worker/WorkerSimHost';
import { ACK_WINDOW, WorkerLiveness, type WorkerOutput, type WorkerPort } from '../../src/worker/workerProtocol';
import { CommandOutcomeLost, EntryType, PROTOCOL_VERSION } from '../../src/worker/protocol';
import { exactDigest } from '../../src/worker/queries';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { bootNode, inProcess, initialCity, send, waitFor, within } from './workerHarness';

beforeAll(async () => { await buildWorkerTest(); }, 60000);
afterEach(() => { clearRecoveryBase(); setKV(new MemoryKV()); });

/** a microtask between any two days or scheduler steps: each ran in a task of its own */
function unitProbe() {
  const faults: string[] = [];
  let busy = false;
  return { faults, unit(what: string) {
    if (busy) faults.push(`two units in one task (${what})`);
    busy = true; queueMicrotask(() => { busy = false; });
  } };
}
const fatal = (messages: WorkerOutput[]) => messages.filter((m) => m.t === 'fatal' || (m.t === 'pkt' && m.p.replies?.some((r) => r.t === 'error')));

describe('the worker loop (in-process)', () => {
  it('runs one day per task, stops flushing past the ack window while the recorder merges, and answers ping', async () => {
    const probe = unitProbe();
    let w!: ReturnType<typeof inProcess>, blockedAt = -1;
    const system: SimSystem = { name: 'units', daily(sim) {
      probe.unit('day');
      if (sim.state.day === 8) blockedAt = w.packets().length;
    } };
    w = inProcess([system], { deterministic: true, ack: false });
    try {
      await w.until((m) => m.t === 'ready', 'ready');
      w.send({ t: 'cmd', seq: 1, op: 'debug.runDays', args: [12] });
      // nothing acks: days 6 on merge into the recorder, behind the window
      await waitFor(() => blockedAt >= 0, 'day 8');
      expect(blockedAt).toBe(ACK_WINDOW + 1);
      w.send({ t: 'ack', ack: ACK_WINDOW + 1, epoch: 1 }); w.send({ t: 'ping', n: 7 });
      const done = await w.until((m) => m.t === 'pkt' && m.p.log.some((e) => e[0] === EntryType.Ack && e[3] === 1), 'the run\'s Ack');
      if (done.t !== 'pkt') throw new Error('unreachable');
      expect(done.p.acks).toEqual([12]); // the day reached
      const packets = w.packets(), days = packets.flatMap((p) => p.log.filter((e) => e[0] === EntryType.Day).map((e) => e[1]));
      expect(days).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
      expect(packets.some((p) => p.log.filter((e) => e[0] === EntryType.Day).length >= 3), 'a merged packet').toBe(true);
      expect(packets.some((p) => p.pong === 7)).toBe(true);
      expect(packets.every((p) => !p.clock.live), 'deterministic days are not frame-paced').toBe(true);
      expect(probe.faults).toEqual([]); expect(fatal(w.messages)).toEqual([]);
    } finally { w.dispose(); }
  });

  it('a frame is its hooks, one scheduler step per task, then one day per task; a pause posted in a day ends it', async () => {
    const probe = unitProbe();
    let w!: ReturnType<typeof inProcess>, steps = 0, days = 0, hooks = 0;
    const system: SimSystem = {
      name: 'frames',
      init(sim) {
        schedulerOf(sim).register({ name: 'three-steps', due: () => steps < 3, urgent: () => false, cost: () => 0,
          step: () => { probe.unit('step'); steps++; } });
      },
      frame(sim) { hooks++; schedulerOf(sim).tickFrame(sim, system); },
      daily() {
        probe.unit('day'); days++;
        // the player pauses during the first day: the frame's remaining days must not run (§3.2)
        if (days === 1) w.send({ t: 'cmd', seq: 1, op: 'setSpeed', args: [0, 'pause'] });
      },
    };
    w = inProcess([system], { initialSpeed: 3 });
    try {
      const ready = await w.until((m) => m.t === 'ready', 'ready');
      if (ready.t !== 'ready') throw new Error('unreachable');
      expect(ready.clock.live).toBe(true);
      // 0.25 s at ultra is five days, four by maxDaysPerFrame
      w.send({ t: 'tick', seq: 1, dt: 0.25, ack: 0 });
      await w.until((m) => m.t === 'pkt' && m.p.cmd === 1, 'the pause');
      await waitFor(() => w.packets().some((p) => p.clock.speed === 0), 'the paused clock');
      expect({ hooks, steps, days }).toEqual({ hooks: 1, steps: 3, days: 1 });
      expect(w.packets().some((p) => p.clock.live)).toBe(true);
      expect(probe.faults).toEqual([]); expect(fatal(w.messages)).toEqual([]);
    } finally { w.dispose(); }
  });

  it('honours maxDaysPerFrame: 0 holds the calendar while frame hooks run; the cap then works as Simulation.update', async () => {
    let sim!: Simulation, hooks = 0, days = 0;
    const system: SimSystem = { name: 'hold', init(s) { sim = s; s.maxDaysPerFrame = 0; }, frame() { hooks++; }, daily() { days++; } };
    const w = inProcess([system], { initialSpeed: 3 });
    // a zero-day run waits for the frame in progress, so its Ack marks that frame's end
    let seq = 0;
    const frameEnded = async () => {
      w.send({ t: 'cmd', seq: ++seq, op: 'debug.runDays', args: [0] });
      await w.until((m) => m.t === 'pkt' && m.p.cmd === seq, `the barrier ${seq}`);
    };
    try {
      await w.until((m) => m.t === 'ready', 'ready');
      // NOTE-041: holdCalendar sets maxDaysPerFrame through SimCore's command path; a frame starts after the last ended
      for (let tick = 1; tick <= 2; tick++) {
        w.send({ t: 'tick', seq: tick, dt: 0.25, ack: 0 });
        await waitFor(() => hooks === tick, `frame ${tick}`);
      }
      await frameEnded();
      expect(days).toBe(0);
      sim.maxDaysPerFrame = 4;
      w.send({ t: 'tick', seq: 3, dt: 0.25, ack: 0 });
      await waitFor(() => hooks === 3, 'frame 3');
      await frameEnded();
      // the held frames capped the backlog at one day (0.05 s); with 0.25 s more, four days by the cap
      expect(days).toBe(4);
      expect(fatal(w.messages)).toEqual([]);
    } finally { w.dispose(); }
  });

  it('a resync lists the replies main may have dropped, and ignores tick acks of the old numbering until main acks the new epoch', async () => {
    const w = inProcess([], { deterministic: true, ack: false });
    try {
      await w.until((m) => m.t === 'ready', 'ready');
      w.send({ t: 'query', id: 5, name: 'verify', args: {} });
      w.send({ t: 'cmd', seq: 1, op: 'debug.runDays', args: [3] });
      await w.until((m) => m.t === 'pkt' && m.p.cmd === 1, 'the run');
      w.send({ t: 'resync' });
      const ready = await w.until((m) => m.t === 'ready' && m.cmd === 1, 'the second Ready');
      if (ready.t !== 'ready') throw new Error('unreachable');
      expect(ready.lost).toEqual([5]);
      const before = w.messages.length;
      // posted before main adopted the new Ready: an ack of the old numbering, past the new one
      w.send({ t: 'tick', seq: 9, dt: 0, ack: 4 });
      w.send({ t: 'ack', ack: 0, epoch: 2 });
      w.send({ t: 'cmd', seq: 2, op: 'debug.runDays', args: [2] });
      const next = await w.until((m) => m.t === 'pkt' && m.p.cmd === 2, 'a run after the resync');
      if (next.t !== 'pkt') throw new Error('unreachable');
      expect(w.messages.slice(before).filter((m) => m.t === 'pkt').map((m) => m.t === 'pkt' && m.p.seq)[0]).toBe(1);
      expect(fatal(w.messages)).toEqual([]);
    } finally { w.dispose(); }
  });
});

describe('the real worker (node worker_threads)', () => {
  it('still replies with the tab hidden: no ticks, so main acks outside them', { timeout: 30000 }, async () => {
    const posted: string[] = [];
    const host = await bootNode(initialCity(), { kv: new MemoryKV(), wrap: (port) => ({ ...port, postMessage(m) { posted.push(m.t); port.postMessage(m); } }) });
    try {
      // neither frame() nor a tick: as with requestAnimationFrame stopped
      for (let i = 0; i < 2 * ACK_WINDOW; i++) expect(await within(host.query('verify', {}))).toBe(exactDigest(host.state));
      expect((await within(host.save('hidden'))).cmd).toBe(0);
      expect(posted).toContain('ack');
      expect(posted).not.toContain('tick');
    } finally { await host.dispose(); }
  });

  it('resyncs after a corrupted packet: only the dropped reads reject, the applied command settles as applied', { timeout: 30000 }, async () => {
    let corrupt = false;
    const resyncs: number[] = [];
    const host = await bootNode(initialCity(), { kv: new MemoryKV(), onResync: (cmd) => resyncs.push(cmd), wrap: (port) => ({
      ...port,
      listen(receive, fail, signal) {
        port.listen((m) => {
          if (corrupt && m.t === 'pkt' && m.p.acks?.length) { corrupt = false; m.p.seq++; }
          receive(m);
        }, fail, signal);
      },
    }) });
    try {
      const before = host.state;
      corrupt = true;
      // the packet with the Ack fails to apply, and main drops the reply's packet (the same one, or a later one)
      const ticket = host.post('setHistoric', [-1, true]), read = host.query('verify', {});
      await expect(within(ticket.done)).rejects.toBeInstanceOf(CommandOutcomeLost);
      await expect(within(read)).rejects.toThrow(/interrupted by resync/);
      expect(host.state).not.toBe(before);
      expect(resyncs).toEqual([ticket.seq]);
      // the new epoch: later reads and commands reply, and the replica keeps the worker's state
      expect(await within(host.query('verify', {}))).toBe(exactDigest(host.state));
      await within(send(host, 'setTax', [DevType.R1, 12]));
      expect(host.state.budget.taxRates[DevType.R1]).toBe(12);
      expect(await within(host.query('verify', {}))).toBe(exactDigest(host.state));
    } finally { await host.dispose(); }
  });

  it('a crash rejects outstanding tickets and reads with HostCrashed and takes the crash path', { timeout: 30000 }, async () => {
    let kill = false;
    const crashes: [string, boolean][] = [];
    const host = await bootNode(initialCity(), { kv: new MemoryKV(), onCrash: (e, boot) => crashes.push([e.name, boot]), wrap: (port) => ({
      ...port,
      // the worker dies instead of receiving them
      postMessage(m) { if (kill && (m.t === 'cmd' || m.t === 'query')) void port.terminate(); else port.postMessage(m); },
    }) });
    try {
      kill = true;
      const ticket = host.post('setHistoric', [-1, true]), read = host.query('verify', {});
      await Promise.all([expect(within(ticket.done)).rejects.toBeInstanceOf(HostCrashed), expect(within(read)).rejects.toBeInstanceOf(HostCrashed)]);
      expect(crashes).toEqual([['HostCrashed', false]]);
      expect(() => host.post('setTax', [DevType.R1, 9])).toThrow(/disposed/);
    } finally { await host.dispose(); }
  });

  it('a fatal message from the worker after ready takes the crash path', { timeout: 30000 }, async () => {
    let raw!: WorkerPort;
    const crashes: boolean[] = [];
    const host = await bootNode(initialCity(), { kv: new MemoryKV(), onCrash: (_e, boot) => crashes.push(boot), wrap: (port) => (raw = port) });
    try {
      const read = host.query('verify', {});
      raw.postMessage({ t: 'tick', seq: 1, dt: -1, ack: 0 }); // the worker refuses it: Invalid tick
      await expect(within(read)).rejects.toBeInstanceOf(HostCrashed);
      expect(crashes).toEqual([false]);
    } finally { await host.dispose(); }
  });

  it('R11: pings once per visible second, and 10 visible seconds without a packet are a crash', { timeout: 30000 }, async () => {
    let now = 0, drop = false;
    const posted: string[] = [];
    const host = await bootNode(initialCity(), { kv: new MemoryKV(), now: () => now, wrap: (port) => ({
      ...port,
      postMessage(m) { posted.push(m.t); port.postMessage(m); },
      listen(receive, fail, signal) { port.listen((m) => { if (!drop) receive(m); }, fail, signal); },
    }) });
    try {
      now += 1000;
      await waitFor(() => posted.includes('ping'), 'a ping');
      drop = true; // the worker goes silent
      const read = host.query('verify', {});
      now += 10000;
      await expect(within(read)).rejects.toThrow(/stopped responding/);
    } finally { await host.dispose(); }
  });
});

describe('boot (R11)', () => {
  /** a port that never runs a worker: the test plays its side */
  function fakePort() {
    let receive!: (m: WorkerOutput) => void, fail!: (e: unknown) => void, terminated = false;
    const port: WorkerPort = { postMessage() {}, listen(r, f) { receive = r; fail = f; }, terminate() { terminated = true; } };
    return { port, receive: (m: WorkerOutput) => receive(m), fail: (e: unknown) => fail(e), terminated: () => terminated };
  }
  const source = () => { const city = initialCity(); return { kind: 'serialized' as const, regionId: 'boot', tileKey: '0', savedAt: 1, city }; };

  it('fails fast on a script error, messageerror, a version mismatch and a fatal message, and calls onCrash', async () => {
    for (const failure of ['script error', 'messageerror', 'version', 'fatal'] as const) {
      const fake = fakePort(), crashes: boolean[] = [];
      const booting = bootWorkerSimHost(source(), { port: fake.port, onCrash: (_e, boot) => crashes.push(boot) });
      if (failure === 'version') fake.receive({ t: 'hello', v: PROTOCOL_VERSION + 1 });
      else if (failure === 'fatal') { fake.receive({ t: 'hello', v: PROTOCOL_VERSION }); fake.receive({ t: 'fatal', message: 'boot failed' }); }
      else fake.fail(new Error(failure));
      await expect(booting, failure).rejects.toBeInstanceOf(HostCrashed);
      expect(fake.terminated(), failure).toBe(true);
      expect(crashes, failure).toEqual([true]);
    }
  });

  it('reports boot phases, and times out after 20 visible seconds without one; the hello deadline waits for the script', async () => {
    let now = 0;
    const fake = fakePort(), phases: string[] = [];
    let loaded!: () => void;
    const scriptLoaded = new Promise<void>((resolve) => { loaded = resolve; });
    const booting = bootWorkerSimHost(source(), { port: fake.port, now: () => now, scriptLoaded, onBoot: (phase) => phases.push(phase) });
    let settled = false;
    void booting.catch(() => {}).finally(() => { settled = true; });
    now += 60000; // a slow download is not a hang
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    loaded(); await Promise.resolve();
    fake.receive({ t: 'hello', v: PROTOCOL_VERSION });
    fake.receive({ t: 'boot', phase: 'systems', pct: 0.5 });
    now += 19000;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    expect(phases).toEqual(['systems']);
    now += 1000;
    await expect(booting).rejects.toThrow(/did not boot in time/);
    expect(fake.terminated()).toBe(true);
  });

  it('counts visible, unfrozen time only (the watchdog)', () => {
    let now = 0;
    const life = new WorkerLiveness(() => now);
    now = 60000; expect(life.poll().timeout, 'no hello deadline during the download').toBe(false);
    life.scriptLoaded(); now += 9999; expect(life.poll().timeout).toBe(false);
    now++; expect(life.poll().timeout).toBe(true);
    life.received('hello'); now += 19000; expect(life.poll().timeout).toBe(false);
    life.received('boot'); now += 19999; expect(life.poll().timeout).toBe(false);
    now++; expect(life.poll().timeout, '20 s without boot progress').toBe(true);
    life.received('ready');
    for (let i = 0; i < 10; i++) { now += 100; life.received('pkt'); }
    expect(life.poll().ping, 'packets do not suppress the 1 Hz ping').toBe(true);
    life.reset(false); now += 15000; expect(life.poll().timeout, 'hidden time').toBe(false);
    life.reset(true); expect(life.poll().timeout).toBe(false);
    now += 9999; expect(life.poll().timeout).toBe(false);
    now++; expect(life.poll().timeout, '10 visible seconds without a packet').toBe(true);
  });
});

describe('O7', () => {
  it('an explicit live flag wins over the 750 ms inference, either way', () => {
    const disasters = new DisastersSystem();
    const sim = { state: { day: 1 } } as Simulation;
    const scheduler = schedulerOf(sim);
    scheduler.live = true; expect(scheduler.framesActive).toBe(true);
    scheduler.live = false; scheduler.tickFrame(sim, {}); expect(scheduler.framesActive).toBe(false);
    disasters.live = true;
    const tornado = { kind: 'tornado' as const, x: 1, z: 1, daysLeft: 4, heading: 0, magnitude: 1 };
    disasters.active.push(tornado); disasters.daily(sim);
    expect(tornado.daysLeft, 'a stale frame stamp cannot advance a live tornado by a whole day').toBe(4);
  });
});
