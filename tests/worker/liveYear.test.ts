/**
 * T077 (WORKER_DESIGN §3.6, hazard 19): New Year's batch test reads the host's liveYear, not the days since the last
 * drawn frame. The same days, played on the local host, through the loopback and from the loopback's recorded packet
 * stream, get the same decision at every year end: at 1x, at ultra, and when a hidden tab's backlog of packets is
 * replayed in one burst (more than 8 days after the last frame, which the frame-gap rule read as a batch). A real batch
 * of days stays a batch on every host, and a packet without the flag is decided by the frame-gap rule, as before.
 *
 * The page is modelled as CityScene.loop runs it: a frame posts its tick (host.frame), then draws (the celebration's
 * frame). On the local host the tick's days run inside host.frame. On a packet host they run in the tick's task, after
 * the frame was drawn, and reach the page as packets.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { NewYearCelebration } from '../../src/game/NewYear';
import { DEFAULT_SETTINGS, type GameSettings } from '../../src/game/settings';
import type { CityObjectsViewApi, WorldViewApi } from '../../src/render/contracts';
import { clearRecoveryBase } from '../../src/save/cities';
import { MemoryKV, setKV } from '../../src/save/db';
import { serializeCity } from '../../src/save/serialize';
import type { SimSystem } from '../../src/sim/Simulation';
import { LocalSimHost, type SimHost } from '../../src/worker/SimHost';
import { LoopbackSimHost, PacketSimHost } from '../../src/worker/LoopbackSimHost';
import { EntryType, type Packet, type W2M } from '../../src/worker/protocol';
import { ACK_WINDOW } from '../../src/worker/workerProtocol';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { newState } from '../infra/cityGen';
import { bootNode, inProcess, waitFor, within } from './workerHarness';

const YEAR = 360;
/** one year end: what the host said, what the celebration did, and how many days had passed since the last drawn frame
 *  (what the frame-gap rule looked at) */
interface Decision { year: number; live: boolean | undefined; party: boolean; gap: number }
const verdicts = (decisions: Decision[]) => decisions.map(({ year, live, party }) => ({ year, live, party }));
type Trace = { draw: [dt: number, now: number] } | { msg: W2M };

function city(day: number) {
  const st = newState(16);
  st.day = day; st.stats.population = 1200;
  return st;
}

/** The page's New Year around a host, wired as CityScene wires it (the host's year events, its liveYear). Every year
 *  that is no batch gets its toast, show or not ('everyYear' pacing). */
function page(host: SimHost) {
  const settings: GameSettings = { ...DEFAULT_SETTINGS, newYear: 'fireworks', newYearPacing: 'everyYear' };
  const decisions: Decision[] = [];
  let toasts = 0, drawn = host.state.day, open: Omit<Decision, 'party'> & { toasts: number } | null = null;
  // around the celebration's own listener, in registration order
  const before = host.events.on('year', (year) => { open = { year, live: host.liveYear, gap: host.state.day - drawn, toasts }; });
  const ny = new NewYearCelebration({
    sim: host.sim, world: () => ({ timeOfDay: 12, autoTime: true }) as unknown as WorldViewApi,
    objects: () => ({}) as unknown as CityObjectsViewApi, settings: () => settings,
    toast: () => { toasts++; }, liveYear: () => host.liveYear,
  });
  // (the fireworks' audio module stays out of this suite)
  (ny as unknown as { loadAudio(): void }).loadAudio = () => undefined;
  const after = host.events.on('year', () => {
    const { toasts: had, ...rest } = open!;
    decisions.push({ ...rest, party: toasts > had });
  });
  return {
    decisions,
    /** a frame's draw: CityScene.loop calls the celebration's frame after host.frame */
    draw(dt: number, now: number) { ny.frame(dt, now); drawn = host.state.day; },
    dispose() { before(); after(); ny.dispose(); },
  };
}

interface Driver {
  host: SimHost;
  pg: ReturnType<typeof page>;
  /** the authority's day (a replica's lags by its packets) */
  day(): number;
  /** one frame: its tick, its draw, then the tick's task */
  frame(dt: number): Promise<void>;
  speed(v: number): Promise<void>;
  /** the page stops reading its messages (a hidden or frozen tab), then reads the backlog in one burst */
  hold(on: boolean): void;
  dispose(): Promise<void>;
}

/** no systems: the calendar alone */
async function local(day: number): Promise<Driver & { host: LocalSimHost }> {
  const host = new LocalSimHost(city(day), { initialSpeed: 1 });
  await host.start({});
  const pg = page(host);
  let now = 1000;
  return {
    host, pg, day: () => host.state.day,
    async frame(dt) { now += dt * 1000; host.frame(dt); pg.draw(dt, now); },
    async speed(v) { host.setSpeed(v, 'keyboard'); },
    hold() {},
    async dispose() { pg.dispose(); await host.dispose(); },
  };
}

async function loopback(day: number, cadence: 'live' | 'design' = 'live'): Promise<Driver & { host: LoopbackSimHost; trace: Trace[]; errors: unknown[] }> {
  const trace: Trace[] = [], held: W2M[] = [], errors: unknown[] = [];
  let holding = false, now = 1000;
  const host = new LoopbackSimHost(city(day), { initialSpeed: 1, loopback: { cadence, modules: {} }, errors: { report: (...e) => errors.push(e) } });
  const deliver = host.receive.bind(host);
  // the recorded stream: every message as the page read it, between its draws
  const read = (m: W2M) => { trace.push({ msg: structuredClone(m) }); deliver(m); };
  (host as { receive(m: W2M): void }).receive = (m) => { if (holding) held.push(m); else read(m); };
  await host.start();
  const pg = page(host);
  return {
    host, pg, trace, errors, day: () => host.harness.primary.day,
    async frame(dt) {
      now += dt * 1000; host.frame(dt);
      trace.push({ draw: [dt, now] }); pg.draw(dt, now);
      await host.drain();
    },
    async speed(v) { host.setSpeed(v, 'keyboard'); await host.drain(); },
    hold(on) { holding = on; if (!on) for (const m of held.splice(0)) read(m); },
    async dispose() { pg.dispose(); await host.dispose(); },
  };
}

/** The recorded stream on a fresh packet host with no authority behind it: the same messages between the same draws.
 *  `strip`: without the clock's `live` flag, as a packet from before T077 would be. */
function replay(trace: Trace[], strip = false) {
  const first = trace[0], errors: unknown[] = [];
  if (!('msg' in first) || first.msg.t !== 'ready') throw new Error('the stream starts with its Ready');
  const host = new PacketSimHost('loopback', structuredClone(first.msg), { errors: { report: (...e) => errors.push(e) } });
  host.connect(() => {});
  const pg = page(host);
  for (const step of trace.slice(1)) {
    if ('draw' in step) { pg.draw(...step.draw); continue; }
    const m = structuredClone(step.msg);
    if (strip && m.t === 'pkt') delete m.p.clock.live;
    host.receive(m);
  }
  return { host, pg, errors, async dispose() { pg.dispose(); await host.dispose(); } };
}

/** Three year ends: one at 1x, one at ultra, and one in the frames whose packets a hidden tab reads late. Returns the
 *  authority's day after each tick. */
async function play(d: Driver): Promise<number[]> {
  const days: number[] = [];
  const frame = async (dt: number) => { await d.frame(dt); days.push(d.day()); };
  await d.speed(1);
  while (d.day() < YEAR + 3) await frame(0.1);
  // ultra: four days a frame
  await d.speed(3);
  while (d.day() < 3 * YEAR - 16) await frame(0.25);
  // The tab is hidden with frames' packets still on their way: the page drew those frames, and reads their packets in
  // one burst when it comes back. The local host ran the same ticks' days inside its frames.
  d.hold(true);
  while (d.day() < 3 * YEAR + 2) await frame(0.25);
  d.hold(false);
  for (let i = 0; i < 4; i++) await frame(0.25);
  return days;
}
/** the days the tick that reached `day` ran */
const tickAt = (days: number[], day: number) => { const i = days.findIndex((d) => d >= day); return days[i] - days[i - 1]; };

describe('New Year batching from the host\'s liveYear (T077)', () => {
  let a: Awaited<ReturnType<typeof local>>, b: Awaited<ReturnType<typeof loopback>>;
  let daysA: number[], daysB: number[], start: number;
  beforeAll(async () => {
    a = await local(YEAR - 5); b = await loopback(YEAR - 5);
    start = a.host.state.config.startYear;
    daysA = await play(a); daysB = await play(b);
  }, 60000);
  afterAll(async () => { await a?.dispose(); await b?.dispose(); });

  it('the same days get the same decision on the local host and through the loopback: 1x, ultra and a hidden tab\'s backlog', () => {
    expect(daysB, 'the same days, tick by tick').toEqual(daysA);
    expect(a.host.state.day).toBe(b.host.state.day);
    // the scenario: a day's tick at 1x, four days a tick at ultra
    expect(tickAt(daysA, YEAR)).toBe(1); expect(tickAt(daysA, 2 * YEAR)).toBe(4);
    const live = [1, 2, 3].map((n) => ({ year: start + n, live: true, party: true }));
    expect(verdicts(a.pg.decisions)).toEqual(live);
    expect(verdicts(b.pg.decisions)).toEqual(live);
    // On the local host a year never turns more than a tick's days after a drawn frame. The loopback's third year
    // turned inside the backlog, more than 8 days after the last drawn frame: the frame-gap rule called that a batch.
    expect(a.pg.decisions.map((d) => d.gap <= 4)).toEqual([true, true, true]);
    expect(b.pg.decisions.map((d) => d.gap > 8)).toEqual([false, false, true]);
    // the flag belongs to the packet being replayed
    expect(b.host.liveYear).toBeUndefined();
    expect(b.errors).toEqual([]); expect(b.host.replica.diverged).toBe(false);
  });

  it('the recorded packet stream gives the same decisions on a fresh packet host', async () => {
    const c = replay(b.trace);
    try {
      expect(c.pg.decisions).toEqual(b.pg.decisions);
      expect(c.host.state.day).toBe(b.host.state.day);
      expect(c.errors).toEqual([]); expect(c.host.replica.diverged).toBe(false);
      // every packet of a frame-paced session says so, and the flag is the clock's alone: no save carries it
      const packets = b.trace.flatMap((s) => 'msg' in s && s.msg.t === 'pkt' ? [s.msg.p] : []);
      expect(packets.length).toBeGreaterThan(100);
      expect(packets.every((p) => p.clock.live === true)).toBe(true);
      const ready = b.trace[0];
      if (!('msg' in ready) || ready.msg.t !== 'ready') throw new Error('unreachable');
      for (const saved of [ready.msg.snapshot, serializeCity(a.host.sim.state, { copy: true })]) {
        expect(JSON.stringify(saved.data.systemData)).not.toMatch(/live/i);
        expect(Object.keys(saved.scalars).filter((k) => /live/i.test(k))).toEqual([]);
        expect(saved).not.toHaveProperty('clock');
      }
    } finally { await c.dispose(); }
  });

  it('a packet without the flag is decided by the frame-gap rule, as before: the backlog reads as a batch', async () => {
    const old = replay(b.trace, true);
    try {
      expect(verdicts(old.pg.decisions)).toEqual([
        { year: start + 1, live: undefined, party: true },
        { year: start + 2, live: undefined, party: true },
        { year: start + 3, live: undefined, party: false },
      ]);
      expect(old.errors).toEqual([]); expect(old.host.replica.diverged).toBe(false);
    } finally { await old.dispose(); }
  });

  it('a batch of days is a batch on every host, however short', async () => {
    // local: sim.runDays, outside the host's own tick. A frame was drawn 3 days before the year end, so the frame-gap
    // rule let this one pass as play.
    const l = await local(YEAR - 3);
    // loopback at design cadence: its days come from runDays, as a deterministic worker's
    const d = await loopback(YEAR - 3, 'design');
    try {
      await l.frame(0.1); l.host.sim.runDays(5);
      await d.frame(0.1); d.host.harness.runDays(5); await d.host.drain();
      const r = replay(d.trace);
      try {
        for (const decisions of [l.pg.decisions, d.pg.decisions, r.pg.decisions]) {
          expect(decisions).toEqual([{ year: start + 1, live: false, party: false, gap: 3 }]);
        }
        expect(l.host.state.day).toBe(YEAR + 2); expect(d.host.state.day).toBe(YEAR + 2); expect(r.host.state.day).toBe(YEAR + 2);
        expect([...d.errors, ...r.errors]).toEqual([]);
      } finally { await r.dispose(); }
    } finally { await l.dispose(); await d.dispose(); }
  });
});

describe('LocalSimHost.liveYear', () => {
  it('is true only in the days of its own tick, and comes back when a listener throws', async () => {
    const host = new LocalSimHost(city(YEAR - 2), { initialSpeed: 3 });
    await host.start({});
    const seen: [number, boolean | undefined][] = [], start = host.state.config.startYear;
    const off = host.events.on('year', (year) => seen.push([year, host.liveYear]));
    try {
      expect(host.liveYear).toBe(false);
      host.frame(0.25); // four days at ultra, the year end among them
      expect(seen).toEqual([[start + 1, true]]);
      expect(host.liveYear).toBe(false);
      host.sim.runDays(YEAR);
      expect(seen).toEqual([[start + 1, true], [start + 2, false]]);
      // the local emitter does not isolate its listeners: the tick fails, and the flag does not stay set
      const stop = host.events.on('day', () => { throw new Error('view'); });
      expect(() => host.frame(0.25)).toThrow('view');
      stop();
      expect(host.liveYear).toBe(false);
    } finally { off(); await host.dispose(); }
  });
});

describe('the worker\'s clock.live (in-process)', () => {
  /** the production worker loop at ultra, its calendar starting on `day` (by default 4 days before a year end);
   *  `days`: each day it ran. With `ack` false nothing acks its packets, as from a page that has stopped reading them. */
  function worker(ack: boolean, day = YEAR - 4) {
    const days: number[] = [];
    const calendar: SimSystem = { name: 'calendar', init(sim) { sim.state.day = day; }, daily(sim) { days.push(sim.state.day); } };
    return { days, w: inProcess([calendar], { initialSpeed: 3, ack }) };
  }
  /** the worker's messages on a packet host: what liveYear read at each year end */
  async function yearsOf(messages: W2M[]): Promise<[number, boolean | undefined][]> {
    const ready = messages.find((m) => m.t === 'ready'), errors: unknown[] = [];
    if (ready?.t !== 'ready') throw new Error('no Ready');
    const host = new PacketSimHost('worker', structuredClone(ready), { errors: { report: (...e) => errors.push(e) } });
    host.connect(() => {});
    const seen: [number, boolean | undefined][] = [];
    host.events.on('year', (year) => seen.push([year, host.liveYear]));
    try {
      for (const m of messages) if (m.t === 'pkt') host.receive(structuredClone(m));
      expect(errors).toEqual([]); expect(host.replica.diverged).toBe(false);
      return seen;
    } finally { await host.dispose(); }
  }
  const has = (p: Packet, type: EntryType) => p.log.some((e) => e[0] === type);
  const daysIn = (p: Packet) => p.log.filter((e) => e[0] === EntryType.Day).map((e) => e[1]);

  it('a tick\'s days are live; every day of a debug.runDays run is not, its last day included', async () => {
    const { w } = worker(true);
    try {
      const ready = await w.until((m) => m.t === 'ready', 'ready');
      if (ready.t !== 'ready') throw new Error('unreachable');
      const start = ready.snapshot.config.startYear;
      // 0.25 s at ultra: four days, the year end the last of them
      w.send({ t: 'tick', seq: 1, dt: 0.25, ack: 0 });
      await w.until((m) => m.t === 'pkt' && has(m.p, EntryType.Year), 'the first year end');
      const ticked = w.packets().filter((p) => daysIn(p).length);
      expect(ticked.flatMap(daysIn)).toEqual([YEAR - 3, YEAR - 2, YEAR - 1, YEAR]);
      expect(ticked.every((p) => p.clock.live === true)).toBe(true);
      // a headless year in the same session: its last day is the next year end, flushed once the run has ended
      w.send({ t: 'cmd', seq: 1, op: 'debug.runDays', args: [YEAR] });
      const done = await w.until((m) => m.t === 'pkt' && m.p.log.some((e) => e[0] === EntryType.Ack && e[3] === 1), 'the run\'s Ack');
      if (done.t !== 'pkt') throw new Error('unreachable');
      expect(has(done.p, EntryType.Year), 'the run\'s last day and its Ack share a packet').toBe(true);
      const ran = w.packets().filter((p) => daysIn(p).some((d) => d > YEAR));
      expect(ran.flatMap(daysIn)).toEqual(Array.from({ length: YEAR }, (_, i) => YEAR + 1 + i));
      expect(ran.every((p) => p.clock.live === false)).toBe(true);
      expect(await yearsOf(w.messages)).toEqual([[start + 1, true], [start + 2, false]]);
      // frames after the run are live again
      w.send({ t: 'tick', seq: 2, dt: 0.25, ack: 0 });
      await w.until((m) => m.t === 'pkt' && daysIn(m.p).includes(2 * YEAR + 4), 'a frame after the run');
      expect(w.packets().filter((p) => daysIn(p).some((d) => d > 2 * YEAR)).every((p) => p.clock.live === true)).toBe(true);
    } finally { w.dispose(); }
  });

  it('run days merged behind the ack window stay a batch when their packet goes out after the run', async () => {
    const { w, days } = worker(false);
    try {
      const ready = await w.until((m) => m.t === 'ready', 'ready');
      if (ready.t !== 'ready') throw new Error('unreachable');
      const start = ready.snapshot.config.startYear;
      // nothing acks: the run's days merge in the recorder, the second year end among them
      w.send({ t: 'cmd', seq: 1, op: 'debug.runDays', args: [YEAR + 10] });
      await waitFor(() => days.at(-1) === 2 * YEAR + 6, 'the end of the run');
      const sent = w.packets();
      expect(sent.length).toBe(ACK_WINDOW + 1);
      expect(sent.flatMap(daysIn).at(-1)).toBeLessThan(2 * YEAR);
      w.send({ t: 'ack', ack: sent.at(-1)!.seq, epoch: 1 });
      const tail = await w.until((m) => m.t === 'pkt' && m.p.log.some((e) => e[0] === EntryType.Ack && e[3] === 1), 'the merged tail');
      if (tail.t !== 'pkt') throw new Error('unreachable');
      expect(daysIn(tail.p).length, 'a merged packet').toBeGreaterThan(YEAR - 10);
      expect(daysIn(tail.p)).toContain(2 * YEAR);
      expect(tail.p.clock.live).toBe(false);
      expect(w.packets().filter((p) => daysIn(p).length).every((p) => p.clock.live === false)).toBe(true);
      expect(await yearsOf(w.messages)).toEqual([[start + 1, false], [start + 2, false]]);
    } finally { w.dispose(); }
  });

  it('ticks\' days merged behind the ack window stay live: a stalled page\'s backlog is no batch (hazard 19)', async () => {
    const { w, days } = worker(false, YEAR - 12);
    try {
      const ready = await w.until((m) => m.t === 'ready', 'ready');
      if (ready.t !== 'ready') throw new Error('unreachable');
      const start = ready.snapshot.config.startYear;
      // four frames of four days, each run to its end; the page reads none of their packets
      for (let tick = 1; tick <= 4; tick++) {
        w.send({ t: 'tick', seq: tick, dt: 0.25, ack: 0 });
        await waitFor(() => days.length === 4 * tick, `frame ${tick}`);
      }
      expect(days.at(-1)).toBe(YEAR + 4);
      const sent = w.packets();
      expect(sent.length).toBe(ACK_WINDOW + 1);
      expect(sent.flatMap(daysIn).every((d) => d < YEAR), 'the year end waits in the recorder').toBe(true);
      // the page comes back: one packet with the rest of those days, the year end among them
      w.send({ t: 'ack', ack: sent.at(-1)!.seq, epoch: 1 });
      const backlog = await w.until((m) => m.t === 'pkt' && daysIn(m.p).includes(YEAR), 'the backlog');
      if (backlog.t !== 'pkt') throw new Error('unreachable');
      expect(daysIn(backlog.p).length, 'more days in one packet than the frame-gap rule allowed').toBeGreaterThan(8);
      expect(backlog.p.clock.live).toBe(true);
      expect(await yearsOf(w.messages)).toEqual([[start + 1, true]]);
    } finally { w.dispose(); }
  });
});

describe('WorkerSimHost.liveYear (the real worker, node worker_threads)', () => {
  beforeAll(async () => { await buildWorkerTest(); }, 60000);
  afterEach(() => { clearRecoveryBase(); setKV(new MemoryKV()); });
  const saved = () => { const save = serializeCity(city(YEAR - 2), { copy: true }); save.savedAt = 1; return save; };

  it('a year end reached by frames reads live on the page; one reached by a deterministic run reads as a batch', { timeout: 30000 }, async () => {
    const played = await bootNode(saved(), { kv: new MemoryKV(), initialSpeed: 3 });
    const seen: [number, boolean | undefined][] = [], start = played.state.config.startYear;
    try {
      played.events.on('year', (year) => seen.push([year, played.liveYear]));
      // frames at ultra until the year turns, two days on
      for (let i = 0; i < 40 && !seen.length; i++) { played.frame(0.25); await new Promise((resolve) => setTimeout(resolve, 20)); }
      await waitFor(() => seen.length > 0, 'the year end');
      expect(seen).toEqual([[start + 1, true]]);
      expect(played.liveYear, 'outside a replay').toBeUndefined();
    } finally { await played.dispose(); }
    const run = await bootNode(saved(), { kv: new MemoryKV(), deterministic: true });
    const batch: [number, boolean | undefined][] = [];
    try {
      run.events.on('year', (year) => batch.push([year, run.liveYear]));
      expect(await within(run.runDays(4))).toBe(YEAR + 2);
      expect(batch).toEqual([[start + 1, false]]);
    } finally { await run.dispose(); }
  });
});
