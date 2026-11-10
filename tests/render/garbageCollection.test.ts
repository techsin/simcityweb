/** The collection deadline includes the pollution flag's decay, rather than starting at a synthetic flag flip. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { CELL_SIZE, DAYS_PER_MONTH } from '../../src/core/constants';
import { Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { PollutionSystem, POLL_PERIOD } from '../../src/sim/infra/pollution';
import { TileCuller } from '../../src/render/city/common/batch';
import { PropRenderer } from '../../src/render/city/props/PropRenderer';
import { newState, place, roadLine } from '../infra/cityGen';

registerAllModels();

describe('kerbside garbage after landfill connection', () => {
  it('removes at least 90% within two months even when a saturated district needs three pollution passes', () => {
    const st = newState(64);
    roadLine(st, 2, 32, 60, 32, Network.Road);
    const homes = Array.from({ length: 48 }, (_, i) => place(st, 't_r2', i + 8, 33, { pop: 60 }));
    for (let z = 20; z < 24; z++) for (let x = 8; x < 16; x++) st.zone[st.idx(x, z)] = Zone.Landfill;
    st.stats.population = homes.length * 60;
    // Keep the real scheduled pollution path, with no growth or other systems changing the test district.
    const pollution = new PollutionSystem();
    const sim = new Simulation(st, [pollution]);
    sim.runDays(12 * DAYS_PER_MONTH);
    expect(homes.every((b) => (b.flags & BF.NoGarbage) !== 0)).toBe(true);
    expect(homes.every((b) => st.garbage[st.idx(b.x, b.z)] === 1)).toBe(true);
    expect(pollution.garbageSummary().landfillCapT).toBe(0);

    const props = new PropRenderer(new TileCuller(st.size, CELL_SIZE, 16));
    const camera = new THREE.Vector3(32 * CELL_SIZE, 300, 40 * CELL_SIZE);
    const surface = { terrain: () => 5 };
    const connectedAt = st.day;
    const clearedAt = new Map<number, number>();
    const unsubscribe = sim.events.on('buildingChanged', (b) => {
      // Copy the payload just as a worker packet does; renderer input has no reference into the simulation.
      props.garbageBuildingChanged({ ...b }, st.day);
      if (!(b.flags & BF.NoGarbage) && !clearedAt.has(b.id)) clearedAt.set(b.id, st.day - connectedAt);
    });
    try {
      props.resetGarbage(homes.map((b) => ({ ...b })), st.day);
      props.updateGarbage(st.day, camera, surface);
      const before = props.garbage.count;
      expect(before).toBeGreaterThanOrEqual(homes.length);
      expect(before).toBeLessThanOrEqual(4 * homes.length);
      const byLot = new Map<number, number>(), matrix = new THREE.Matrix4();
      for (let i = 0; i < before; i++) {
        props.garbage.getMatrixAt(i, matrix);
        const x = Math.floor(matrix.elements[12] / CELL_SIZE);
        byLot.set(x, (byLot.get(x) ?? 0) + 1);
      }
      expect([...byLot.keys()].sort((a, b) => a - b)).toEqual(homes.map((b) => b.x));
      expect(new Set(byLot.values())).toEqual(new Set([1, 2, 3, 4]));

      // This road is the first connection between the district and the landfill's perimeter.
      roadLine(st, 7, 20, 7, 32, Network.Road);
      sim.events.emit('networkChanged', { x0: 7, z0: 20, x1: 8, z1: 33 });
      expect(homes.every((b) => (b.flags & BF.NoGarbage) !== 0)).toBe(true);
      let previous = before;
      for (let elapsed = 1; elapsed <= 2 * DAYS_PER_MONTH; elapsed++) {
        sim.advanceDay();
        props.updateGarbage(st.day, camera, surface);
        expect(props.garbage.count, `day +${elapsed}`).toBeLessThanOrEqual(previous);
        previous = props.garbage.count;
        if (elapsed === POLL_PERIOD) {
          expect(pollution.garbageInfo(homes[0].id)?.collected).toBe(true);
          expect(st.garbage[st.idx(homes[0].x, homes[0].z)]).toBeCloseTo(0.65, 5);
          expect(homes.every((b) => (b.flags & BF.NoGarbage) !== 0)).toBe(true);
          expect(props.garbage.count).toBe(before);
        }
        if (elapsed === 2 * POLL_PERIOD) {
          expect(st.garbage[st.idx(homes[0].x, homes[0].z)]).toBeCloseTo(0.65 ** 2, 5);
          expect(clearedAt.size).toBe(0);
        }
        if (elapsed === 3 * POLL_PERIOD + 20) {
          expect(props.garbage.count).toBe(0);
          expect(props.garbage.visible).toBe(false);
        }
      }
      expect(clearedAt.size).toBe(homes.length);
      expect(new Set(clearedAt.values())).toEqual(new Set([3 * POLL_PERIOD]));
      expect(pollution.garbageSummary().landfillCapT).toBeGreaterThan(pollution.garbageSummary().producedT);
      expect(props.garbage.count).toBeLessThanOrEqual(before * 0.1);
    } finally {
      unsubscribe();
      props.dispose();
    }
  });
});
