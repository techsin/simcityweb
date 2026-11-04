/**
 * T061 item 2 (T047's QA, N2; WORKER_DESIGN §3.5): the packet hosts' sim clock across day boundaries. It used to cap its
 * prediction at day + 0.999 until the next day's packet came, and that packet comes late by the day's own work (on the
 * worker's thread, or on the loopback's microtask after the frame): at LIVE every emergency vehicle stopped there, then
 * leapt (about 4.7 m, 5-9 px). The clock now runs on past the day's end, at most one packet interval past the last
 * packet, never back, and is nudged towards each packet's time. Shared by WorkerSimHost (PacketSimHost.simTime).
 *
 * The page here is modelled as the browser runs it: frames 1/60 s apart on a fake clock; each frame posts its tick, then
 * draws (reads simTime), then the tick runs. The day's packet reaches the page DAY_WORK_MS late, as a day's work holds it
 * (about a 1M city's day, WASM_PLAN M3); the packets behind it wait for it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { emergencyOf, vehiclePosition, type EmergencyVehicle } from '../../src/sim/infra/emergency';
import { clearRecoveryBase } from '../../src/save/cities';
import { MemoryKV, setKV } from '../../src/save/db';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import type { W2M } from '../../src/worker/protocol';
import { newState, place, roadLine } from '../infra/cityGen';

const FRAME_MS = 1000 / 60, DAY_WORK_MS = 40;
const tasks = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => { clearRecoveryBase(); setKV(new MemoryKV()); });

/** a clinic at one end of a long road and a home at the other; the loopback on a fake clock, its packets through a
 *  transport that delivers a day's packet `late` ms after it was sent and the rest in order behind it */
async function rig(late = DAY_WORK_MS) {
  const st = newState(128); roadLine(st, 2, 20, 126, 20);
  const clinic = place(st, 't_clinic', 4, 19), home = place(st, 't_r2', 120, 21, { pop: 60 });
  let clock = 1000, day = st.day, hold = false;
  const host = new LoopbackSimHost(st, { initialSpeed: 0, now: () => clock });
  await host.start();
  const queue: { at: number; m: W2M }[] = [], deliver = host.receive.bind(host);
  const due = () => { while (!hold && queue.length && queue[0].at <= clock) deliver(queue.shift()!.m); };
  (host as { receive(m: W2M): void }).receive = (m) => {
    const newDay = m.t === 'pkt' && m.p.clock.day !== day;
    if (m.t === 'pkt') day = m.p.clock.day;
    queue.push({ at: Math.max(clock + (newDay ? late : 0), queue.at(-1)?.at ?? 0), m }); due();
  };
  const sim = host.harness.core.sim, em = emergencyOf(sim)!;
  /** one browser frame: the tick, the draw (the returned sim time), then the tick's task */
  const frame = async () => {
    clock += FRAME_MS; due();
    host.frame(FRAME_MS / 1000);
    const t = host.simTime();
    await tasks();
    return t;
  };
  return { host, sim, em, clinic, home, frame, get clock() { return clock; }, set clock(v: number) { clock = v; },
    hold(on: boolean) { hold = on; due(); }, queue };
}

describe('the packet hosts\' clock across day boundaries (T061 item 2)', () => {
  it('a vehicle steps evenly across 3 day boundaries at LIVE on the loopback, within 1.5x the median step', { timeout: 60000 }, async () => {
    const r = await rig();
    try {
      const id = r.em.spawn(r.sim, 'medical', r.home.x, r.home.z, { buildingId: r.home.id, major: true });
      const sent = r.host.post('dispatch', [id, r.clinic.id, 1]); await r.host.drain(); expect((await sent.done).ok).toBe(true);
      r.host.setSpeed(1, 'keyboard'); await r.host.drain();
      // the uncovered major incident engages LIVE (speed 1, slowed 3x: a day is 1.5 s); a second's settling after it
      for (let i = 0; i < 600 && r.host.liveSlowdown <= 1; i++) await r.frame();
      expect(r.host.liveSlowdown).toBe(3);
      for (let i = 0; i < 60; i++) await r.frame();
      const day0 = r.host.state.day, steps: number[] = [], times: number[] = [];
      let last: { x: number; z: number } | null = null;
      while (r.host.state.day < day0 + 4) {
        const t = await r.frame();
        const v = r.host.emergency.vehicles()[0] as EmergencyVehicle | undefined;
        expect(v?.state, 'the unit is still on its way').toBe('outbound');
        const p = vehiclePosition(v!, t, 128);
        if (last) steps.push(Math.hypot(p.x - last.x, p.z - last.z));
        last = { x: p.x, z: p.z }; times.push(t);
        expect(steps.length).toBeLessThan(600);
      }
      expect(r.host.liveSlowdown, 'LIVE held through the window').toBe(3);
      // three boundaries crossed in the window, each by the day's late packet
      expect(Math.floor(times.at(-1)!) - Math.floor(times[0])).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      const median = [...steps].sort((a, b) => a - b)[steps.length >> 1];
      expect(median).toBeGreaterThan(0);
      const worst = { max: Math.max(...steps) / median, min: Math.min(...steps) / median };
      expect(worst.max, `steps ${JSON.stringify(worst)}`).toBeLessThanOrEqual(1.5);
      expect(worst.min, `steps ${JSON.stringify(worst)}`).toBeGreaterThanOrEqual(1 / 1.5);
    } finally { await r.host.dispose(); }
  });

  it('never runs more than one packet interval past the last packet, and never back', { timeout: 30000 }, async () => {
    const r = await rig(0);
    try {
      r.host.setSpeed(1, 'keyboard'); await r.host.drain();
      for (let i = 0; i < 30; i++) await r.frame();
      // the transport stops: the clock may run on one packet interval (500 ms: one day at 1x) past the last packet, no more
      r.hold(true);
      const c = r.host.replica.clock, base = c.day + c.frac;
      let t = 0;
      for (let i = 0; i < 120; i++) { const next = await r.frame(); expect(next).toBeGreaterThanOrEqual(t); t = next; }
      expect(t).toBeLessThanOrEqual(base + 1 + 1e-9);
      expect(t).toBeGreaterThan(base + 0.9); // it did run on past the day's end, where the old cap stopped it
      // the packets come again: the clock does not go back, and follows the authority from there (drawn a frame before
      // the frame's tick runs: 1/30 of a day behind it at 1x)
      r.hold(false);
      for (let i = 0; i < 120; i++) { const next = await r.frame(); expect(next).toBeGreaterThanOrEqual(t); t = next; }
      expect(Math.abs(t - r.sim.simTime())).toBeLessThan(0.1);
    } finally { await r.host.dispose(); }
  });

  it('stays in its day while the page holds the calendar (NOTE-041), before the authority\'s held packet arrives', { timeout: 30000 }, async () => {
    const r = await rig(0);
    try {
      r.host.setSpeed(1, 'keyboard'); await r.host.drain();
      for (let i = 0; i < 10; i++) await r.frame();
      const day = r.host.state.day;
      r.host.act('holdCalendar', [true]);
      r.hold(true); // the hold's own packets are late
      let t = 0;
      for (let i = 0; i < 90; i++) t = await r.frame();
      expect(t).toBeLessThanOrEqual(day + 1);
      expect(t).toBeGreaterThan(day + 0.9);
      r.hold(false);
      for (let i = 0; i < 30; i++) t = await r.frame();
      expect(r.host.state.day, 'the authority held its day').toBe(day);
      expect(r.host.replica.clock.frac).toBe(1);
      expect(t).toBeLessThanOrEqual(day + 1);
      r.host.act('holdCalendar', [false]);
      for (let i = 0; i < 60 && r.host.state.day === day; i++) t = await r.frame();
      expect(r.host.state.day).toBe(day + 1);
      t = await r.frame();
      expect(t).toBeGreaterThan(day + 1);
    } finally { await r.host.dispose(); }
  });

  it('starts from the adopted clock after a resync', { timeout: 30000 }, async () => {
    const r = await rig(0);
    try {
      r.host.setSpeed(1, 'keyboard'); await r.host.drain();
      for (let i = 0; i < 45; i++) await r.frame();
      r.host.harness.resync();
      const c = r.host.replica.clock;
      expect(r.host.simTime()).toBeCloseTo(c.day + c.frac, 9);
      expect(r.host.sim.dayFraction).toBeCloseTo(c.frac, 9);
    } finally { await r.host.dispose(); }
  });
});
