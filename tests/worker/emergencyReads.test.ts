/** W0.3b: display watches keep the system's options, including same-day fleet changes. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Network } from '../../src/core/types';
import { emergencyOf } from '../../src/sim/infra/emergency';
import type { SimSystem } from '../../src/sim/Simulation';
import { DispatchOptionsWatches } from '../../src/ui/dispatchOptions';
import { LocalSimHost } from '../../src/worker/SimHost';
import { QUERY_HANDLERS } from '../../src/worker/queries';
import { newState, place, roadLine } from '../infra/cityGen';

afterEach(() => vi.restoreAllMocks());

describe('W0.3b emergency display reads', () => {
  it('shares banner/panel watches and reflects a paused dispatch immediately, inside the 5 Hz cap', async () => {
    let now = 0;
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    const clinic = place(st, 't_clinic', 8, 19);
    const homes = [place(st, 't_r2', 50, 21, { pop: 60 }), place(st, 't_r2', 60, 21, { pop: 60 })];
    const host = new LocalSimHost(st, { initialSpeed: 0, now: () => now });
    const abort = new AbortController(), reads = new DispatchOptionsWatches(host, abort.signal);
    const panel = new DispatchOptionsWatches(host, abort.signal);
    try {
      await host.start();
      host.act('setSettings', [{ emergencyUncovered: 'ignore', emergencyAlerts: 'major', emergencyLiveSlowmo: 3 }]);
      const em = emergencyOf(host.sim)!;
      const ids = homes.map((b) => em.spawn(host.sim, 'medical', b.x, b.z, { buildingId: b.id, major: true }));
      const direct = ids.map((id) => em.dispatchOptions(host.sim, id));
      const handler = vi.spyOn(QUERY_HANDLERS, 'dispatchOptions');
      const a = reads.get(ids[0]), b = reads.get(ids[1]);
      expect(panel.get(ids[1])).toBe(b);
      expect(reads.get(ids[0])).toBe(a);
      expect(a.value).toEqual(direct[0]);
      expect(b.value).toEqual(direct[1]);
      expect(a.value).not.toBe(b.value);
      expect(b.value?.find((o) => o.stationId === clinic.id)?.free).toBe(1);
      expect(handler).toHaveBeenCalledTimes(2);

      expect((await host.act('dispatch', [ids[0], clinic.id, 1]).done).ok).toBe(true);
      expect(b.value?.find((o) => o.stationId === clinic.id)?.free).toBe(0);
      now = 199; host.frame(0);
      expect(b.value?.find((o) => o.stationId === clinic.id)?.free).toBe(0);
      now = 200; host.frame(0);
      expect(b.value).toEqual(em.dispatchOptions(host.sim, ids[1]));
      expect(b.value?.find((o) => o.stationId === clinic.id)?.free).toBe(0);
      expect(st.day).toBe(0);

      reads.retain(new Set());
      expect(a.value).toBeUndefined();
      expect(b.value).toEqual(em.dispatchOptions(host.sim, ids[1]));
      abort.abort('dispose');
      now = 600; host.frame(0);
      expect(b.value).toBeUndefined();
      const count = handler.mock.calls.length;
      reads.dispose(); panel.dispose();
      now = 1000; st.day++; host.frame(0);
      expect(handler).toHaveBeenCalledTimes(count);
    } finally {
      reads.dispose(); panel.dispose(); abort.abort('dispose'); await host.dispose();
    }
  });

  it('uses constant-time fleet revisions and preserves the requested monthly policy', async () => {
    let now = 0;
    const st = newState(32), host = new LocalSimHost(st, { initialSpeed: 0, now: () => now });
    const incidents = Array.from({ length: 20 }, (_, id) => ({ id, state: 'uncovered', units: [] as number[] }));
    const vehicles = [{ id: 1 }, { id: 2 }];
    const em = {
      name: 'emergency', stVer: 0, gEpoch: 0,
      incident: (id: number) => incidents[id], vehicles: () => vehicles,
      stationList: vi.fn(() => { throw new Error('signature enumerated stations'); }),
      dispatchOptions: vi.fn(() => []),
    };
    host.sim.systems.push(em as unknown as SimSystem);
    const watches = incidents.map(({ id }) => host.watch('dispatchOptions', { incidentId: id }, 'monthly'));
    const refresh = () => { now += 200; host.frame(0); };
    try {
      expect(em.dispatchOptions).toHaveBeenCalledTimes(20);
      for (let day = 1; day < 30; day++) { st.day = day; refresh(); }
      expect(em.dispatchOptions).toHaveBeenCalledTimes(20);
      st.day = 30; refresh();
      expect(em.dispatchOptions).toHaveBeenCalledTimes(40);
      // Same-day fleet completions, replacements, capacity/graph updates and incident assignments invalidate.
      vehicles.pop(); refresh(); expect(em.dispatchOptions).toHaveBeenCalledTimes(60);
      vehicles[0] = { id: 3 }; refresh(); expect(em.dispatchOptions).toHaveBeenCalledTimes(80);
      em.stVer++; refresh(); expect(em.dispatchOptions).toHaveBeenCalledTimes(100);
      em.gEpoch++; refresh(); expect(em.dispatchOptions).toHaveBeenCalledTimes(120);
      incidents[0].units.push(3); refresh(); expect(em.dispatchOptions).toHaveBeenCalledTimes(121);
      incidents[0].units[0] = 4; refresh(); expect(em.dispatchOptions).toHaveBeenCalledTimes(122);
      incidents[0].state = 'dispatched'; refresh(); expect(em.dispatchOptions).toHaveBeenCalledTimes(123);
      host.act('setCamera', [{ x: 0, z: 0, distance: 500 }]);
      expect(watches[1].value).toEqual([]); // command invalidation bypasses the cap without advancing time
      expect(em.stationList).not.toHaveBeenCalled();
    } finally { for (const w of watches) w.dispose(); await host.dispose(); }
  });
});
