/**
 * T034b (NOTE-048, T061 item 1): a speed change the worker makes by itself (the emergency policy's urgent pause) reaches
 * main as a speedChanged in a packet's log. The replica replays that log before PacketSimHost's clock hook moves its speed
 * mirror to the packet's clock, so a handler that re-reads host.speed inside the event read the old speed (T048's QA: after
 * an urgent pause the LIVE duck never engaged). WorkerSimHost reads the packet's speed while the packet is applied.
 * LoopbackSimHost has the same order; T061 fixes it there.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { clearRecoveryBase } from '../../src/save/cities';
import { MemoryKV, setKV } from '../../src/save/db';
import { serializeCity } from '../../src/save/serialize';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { newState, place, roadLine } from '../infra/cityGen';
import { bootNode, send, waitFor, within } from './workerHarness';

beforeAll(async () => { await buildWorkerTest(); }, 60000);
afterEach(() => { clearRecoveryBase(); setKV(new MemoryKV()); });

/** a fire station at one end of a road and a home far down it: a fire there is uncovered, and a unit can be sent */
function uncoveredCity() {
  const st = newState(64); st.config.seed = 7; st.funds = 1e6;
  roadLine(st, 2, 20, 62, 20, Network.Road);
  place(st, 't_fire', 4, 19);
  const home = place(st, 't_r2', 40, 21, { pop: 60 });
  const city = serializeCity(st, { copy: true }); city.savedAt = 1;
  return { city, home };
}

describe('WorkerSimHost speed', () => {
  it('a handler that re-reads host.speed inside the worker\'s own speedChanged (an urgent pause) reads the new speed', { timeout: 30000 }, async () => {
    const { city, home } = uncoveredCity();
    const host = await bootNode(city, { kv: new MemoryKV(), initialSpeed: 3 });
    const frames = async (n: number) => { for (let i = 0; i < n; i++) { host.frame(0.25); await new Promise((r) => setTimeout(r, 5)); } };
    try {
      expect(host.speed).toBe(3);
      await within(send(host, 'setSettings', [{ emergencyUncovered: 'pause', emergencyAlerts: 'all', emergencyLiveSlowmo: 3 }]));
      const seen: { event: number; speed: number }[] = [];
      const off = host.events.on('speedChanged', (event) => seen.push({ event, speed: host.speed }));
      await within(send(host, 'triggerDisaster', ['fire', home.x, home.z]));
      for (let i = 0; i < 40 && !seen.some((s) => s.event === 0); i++) await frames(1);
      await waitFor(() => seen.some((s) => s.event === 0), 'the urgent pause');
      off();
      expect(host.speed).toBe(0);
      // the worker paused the city by itself: no speed command of the page's is pending, so the event is the speed
      expect(seen).toEqual([{ event: 0, speed: 0 }]);
    } finally { await host.dispose(); }
  });

  it('while a newer speed command of the page is pending, a packet\'s speedChanged reads that command\'s speed (the mirror)', { timeout: 30000 }, async () => {
    const { city, home } = uncoveredCity();
    let hold: (() => void) | null = null;
    const held: unknown[] = [];
    // the page's setSpeed is held back on its way to the worker, so its packet carries the worker's pause before it
    const host = await bootNode(city, { kv: new MemoryKV(), initialSpeed: 3, wrap: (port) => ({ ...port, postMessage(m) {
      if (hold && m.t === 'cmd' && m.op === 'setSpeed') { held.push(m); return; }
      port.postMessage(m);
    }, }) });
    const frames = async (n: number) => { for (let i = 0; i < n; i++) { host.frame(0.25); await new Promise((r) => setTimeout(r, 5)); } };
    try {
      await within(send(host, 'setSettings', [{ emergencyUncovered: 'pause', emergencyAlerts: 'all', emergencyLiveSlowmo: 3 }]));
      hold = () => {};
      const seen: { event: number; speed: number }[] = [];
      const off = host.events.on('speedChanged', (event) => seen.push({ event, speed: host.speed }));
      await within(send(host, 'triggerDisaster', ['fire', home.x, home.z]));
      host.setSpeed(2, 'keyboard'); // optimistic: speedChanged(2) at once, then the worker's pause (0) in a packet
      for (let i = 0; i < 40 && !seen.some((s) => s.event === 0); i++) await frames(1);
      await waitFor(() => seen.some((s) => s.event === 0), 'the urgent pause');
      off();
      expect(held.length).toBe(1);
      // the pending setSpeed(2) is newer than the packet: the mirror keeps it, inside the event and after it
      expect(seen).toEqual([{ event: 2, speed: 2 }, { event: 0, speed: 2 }]);
      expect(host.speed).toBe(2);
    } finally { await host.dispose(); }
  });
});
