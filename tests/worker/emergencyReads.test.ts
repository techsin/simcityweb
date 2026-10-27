/** W0.3b: display watches keep the system's options, including same-day fleet changes. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Network } from '../../src/core/types';
import { emergencyOf } from '../../src/sim/infra/emergency';
import { DispatchOptionsWatches, LocalSimHost } from '../../src/worker/SimHost';
import { QUERY_HANDLERS } from '../../src/worker/queries';
import { newState, place, roadLine } from '../infra/cityGen';

afterEach(() => vi.restoreAllMocks());

describe('W0.3b emergency display reads', () => {
  it('matches direct options per incident and refreshes paused dispatches and returns within the 5 Hz cap', async () => {
    let now = 0;
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    const clinic = place(st, 't_clinic', 8, 19);
    const homes = [place(st, 't_r2', 50, 21, { pop: 60 }), place(st, 't_r2', 60, 21, { pop: 60 })];
    const host = new LocalSimHost(st, { initialSpeed: 0, now: () => now });
    const abort = new AbortController(), reads = new DispatchOptionsWatches(host, abort.signal);
    try {
      await host.start();
      host.act('setSettings', [{ emergencyUncovered: 'ignore', emergencyAlerts: 'major', emergencyLiveSlowmo: 3 }]);
      const em = emergencyOf(host.sim)!;
      const ids = homes.map((b) => em.spawn(host.sim, 'medical', b.x, b.z, { buildingId: b.id, major: true }));
      const direct = ids.map((id) => em.dispatchOptions(host.sim, id));
      const handler = vi.spyOn(QUERY_HANDLERS, 'dispatchOptions');
      const a = reads.get(ids[0]), b = reads.get(ids[1]);
      expect(reads.get(ids[0])).toBe(a);
      expect(a.value).toEqual(direct[0]);
      expect(b.value).toEqual(direct[1]);
      expect(a.value).not.toBe(b.value);
      expect(b.value?.find((o) => o.stationId === clinic.id)?.free).toBe(1);
      expect(handler).toHaveBeenCalledTimes(2);

      expect((await host.act('dispatch', [ids[0], clinic.id, 1]).done).ok).toBe(true);
      now = 199; host.frame(0);
      expect(b.value?.find((o) => o.stationId === clinic.id)?.free).toBe(1);
      now = 200; host.frame(0);
      expect(b.value).toEqual(em.dispatchOptions(host.sim, ids[1]));
      expect(b.value?.find((o) => o.stationId === clinic.id)?.free).toBe(0);
      expect(st.day).toBe(0);

      // A returning unit changes availability without a player command, also while paused.
      (em as unknown as { out: Map<number, number> }).out.set(clinic.id, 0);
      now = 400; host.frame(0);
      expect(b.value?.find((o) => o.stationId === clinic.id)?.free).toBe(1);
      reads.retain(new Set([ids[1]]));
      expect(a.value).toBeUndefined();
      abort.abort('dispose');
      now = 600; host.frame(0);
      expect(b.value).toBeUndefined();
      const count = handler.mock.calls.length;
      reads.dispose();
      now = 1000; st.day++; host.frame(0);
      expect(handler).toHaveBeenCalledTimes(count);
    } finally {
      reads.dispose(); abort.abort('dispose'); await host.dispose();
    }
  });
});
