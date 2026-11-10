/**
 * FH-08 on the real worker (?simworker=1): the worker's LivePolicy latches the first-emergency lesson, and its
 * ChangeRecorder must carry `policy.teaching` to the page. simWorker.ts builds its own recorder projection beside
 * loopbackCore.ts's; when it dropped `teaching`, E1a paused the city with no card (the page never saw the lesson, so it
 * could not show it or acknowledge it).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { clearRecoveryBase } from '../../src/save/cities';
import { MemoryKV, setKV } from '../../src/save/db';
import { serializeCity } from '../../src/save/serialize';
import type { PolicySnapshot, SimSettings } from '../../src/worker/SimHost';
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

const armed: SimSettings = { emergencyUncovered: 'live', emergencyAlerts: 'all', emergencyLiveSlowmo: 3, teachFirst: true, teachTooFar: true };

describe('FH-08 teaching on WorkerSimHost (the real worker)', () => {
  it('the worker\'s lesson reaches host.policy and the subscription, and its acknowledgement clears it', { timeout: 30000 }, async () => {
    const { city, home } = uncoveredCity();
    const host = await bootNode(city, { kv: new MemoryKV(), initialSpeed: 3 });
    const ac = new AbortController();
    const frames = async (n: number) => { for (let i = 0; i < n; i++) { host.frame(0.25); await new Promise((r) => setTimeout(r, 5)); } };
    try {
      let snapshot: PolicySnapshot = { alerts: [], live: false };
      host.policy.subscribe((p) => { snapshot = structuredClone(p); }, ac.signal);
      await within(send(host, 'setSettings', [armed]));
      await within(send(host, 'triggerDisaster', ['fire', home.x, home.z]));
      for (let i = 0; i < 80 && !host.policy.teaching; i++) await frames(1);
      await waitFor(() => !!host.policy.teaching, 'the worker\'s FH-08 lesson on the page');
      // the fire is savable by hand: E1a, and the worker pauses the city once for its card
      const lesson = { ...host.policy.teaching! };
      expect(lesson.variant).toBe('E1a');
      expect(snapshot.teaching).toEqual(lesson);
      expect(snapshot.alerts.map((a) => a.id)).toContain(lesson.id);
      expect(host.speed).toBe(0);

      // Got it: the acknowledgement clears the lesson on the page, and the worker releases the pause into LIVE
      await within(send(host, 'setSettings', [{ ...armed, teachingAck: lesson.id }]));
      for (let i = 0; i < 40 && (host.policy.teaching || host.speed === 0); i++) await frames(1);
      await waitFor(() => !host.policy.teaching && host.speed === 1, 'the acknowledged lesson to clear on the page');
      expect(snapshot.teaching).toBeUndefined();
      expect(host.policy.live).toBe(true);
    } finally { ac.abort(); await host.dispose(); }
  });
});
