/** W0.5: LocalSimHost's view surface keeps the existing system values and clock. */
import { describe, expect, it, vi } from 'vitest';
import { Network, Overlay } from '../../src/core/types';
import { serializeCity } from '../../src/save/serialize';
import type { EmergencySystem } from '../../src/sim/infra/emergency';
import type { TrafficSystem } from '../../src/sim/infra/traffic';
import type { UtilitiesSystem } from '../../src/sim/infra/utilities';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState, place, roadLine } from '../infra/cityGen';

describe('W0.5 LocalSimHost views', () => {
  it('stable empty readers follow lazy boot, incidents, fleets, routes, utilities and the host clock', async () => {
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    const clinic = place(st, 't_clinic', 8, 19);
    const home = place(st, 't_r2', 50, 21, { pop: 60 });
    const host = new LocalSimHost(st);
    const { emergency, traffic, utilities } = host;
    try {
      expect(emergency.active).toBe(false);
      expect(emergency.layersReady).toBe(false);
      expect(emergency.incidents()).toEqual([]);
      expect(emergency.incident(1)).toBeUndefined();
      expect(emergency.vehicles()).toEqual([]);
      expect(emergency.stationList()).toEqual([]);
      expect(emergency.stationFleet(1)).toBeNull();
      expect(emergency.stationName(1)).toBe('Station');
      expect(traffic.sampleRoutes(1024)).toEqual([]);
      expect(traffic.truckVolume()).toBeNull();
      expect(utilities.waterQualityAt(host.sim, 0)).toBe(st.stats.tapWater ?? 1);
      await host.start();
      expect(host.emergency).toBe(emergency);
      expect(host.traffic).toBe(traffic);
      expect(host.utilities).toBe(utilities);
      st.stats.population = 5000;
      const em = host.sim.getSystem<EmergencySystem>('emergency')!;
      const id = em.spawn(host.sim, 'medical', home.x, home.z, { buildingId: home.id, major: true });
      expect(emergency.incident(id)).toBe(em.incident(id));
      expect(emergency.incidents()).toBe(em.incidents());
      expect(emergency.active).toBe(em.active);
      expect(emergency.layersReady).toBe(em.layersReady);
      const result = await host.act('dispatch', [id, clinic.id, 1]).done;
      expect(result.ok).toBe(true);
      expect(emergency.vehicles().length).toBeGreaterThan(0);
      expect(emergency.vehicles()).toBe(em.vehicles());
      expect(emergency.stationList()).toEqual(em.stationList());
      expect(emergency.stationFleet(clinic.id)).toEqual(em.stationFleet(clinic.id));
      expect(emergency.stationName(clinic.id)).toBe(em.stationName(clinic.id));
      const tr = host.sim.getSystem<TrafficSystem>('traffic')!;
      for (const max of [0, 1, 1024]) expect(traffic.sampleRoutes(max)).toEqual(tr.getSampleRoutes(max));
      expect(traffic.truckVolume()).toBe(tr.truckVolume());
      const u = host.sim.getSystem<UtilitiesSystem>('utilities')!;
      for (const cell of [0, st.idx(home.x, home.z), st.cells - 1]) {
        expect(utilities.waterQualityAt(host.sim, cell)).toBe(u.waterQualityAt(host.sim, cell));
      }
      host.frame(0.02);
      expect(host.simTime()).toBe(host.sim.simTime());
      expect(host.secondsPerDay()).toBe(host.sim.secondsPerDay());
      expect('dispatch' in emergency).toBe(false);
      expect('routeInfo' in traffic).toBe(false);
      expect('gridInfo' in utilities).toBe(false);
    } finally {
      await host.dispose();
    }
  });

  it('view reads and subscriptions leave the authoritative save and RNG unchanged', async () => {
    const host = new LocalSimHost(newState(32));
    // the save's savedAt is Date.now(): pinned, so two saves taken a millisecond apart still compare
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      await host.start();
      host.sim.runDays(2);
      const before = serializeCity(host.sim.state, { copy: true });
      host.setView({ overlay: Overlay.Water, variant: 1, panels: ['emergencies'], focus: [] });
      host.emergency.incidents(); host.emergency.vehicles(); host.emergency.stationList();
      host.emergency.stationFleet(1); host.emergency.stationName(1);
      host.traffic.sampleRoutes(1024); host.traffic.truckVolume();
      host.utilities.waterQualityAt(host.sim, 0);
      host.simTime(); host.secondsPerDay();
      expect(serializeCity(host.sim.state, { copy: true })).toEqual(before);
      const next = newState(32);
      host.sim.replaceState(next);
      expect(host.emergency.incidents()).toEqual([]);
      expect(host.utilities.waterQualityAt(host.sim, 0)).toBe(next.stats.tapWater ?? 1);
    } finally {
      now.mockRestore();
      await host.dispose();
    }
  });
});
