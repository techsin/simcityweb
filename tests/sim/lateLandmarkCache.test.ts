import { describe, expect, it } from 'vitest';
import { BF } from '../../src/sim/CityState';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import { Simulation } from '../../src/sim/Simulation';
import { populationSystem } from '../../src/sim/economy/population';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { newState, place } from '../infra/cityGen';

function cache(rt: EconRuntime): BuildingDef[] {
  return (rt as unknown as { defCache: BuildingDef[] }).defCache;
}

function civicCity() {
  const st = newState(16);
  place(st, 't_r1', 1, 1, { id: 2, pop: 12 });
  place(st, 't_school', 4, 1, { id: 1024, flags: BF.Plopped });
  place(st, 't_park', 6, 1, { id: 2048, flags: BF.Plopped });
  place(st, 't_clinic', 8, 1, { id: 4096, flags: BF.Plopped | BF.Abandoned });
  place(st, 't_clinic', 10, 1, { id: 8192, flags: BF.Plopped | BF.Burnt });
  st.nextBuildingId = 8193;
  return st;
}

describe('late landmarks: legacy definition cache', () => {
  it('keeps sparse civic definitions uncached until staffed occupancy reads them, including after a reset', () => {
    const rt = new EconRuntime();
    const sim = new Simulation(civicCity(), [populationSystem(rt)]);
    expect(Object.keys(cache(rt))).toEqual(['2']);
    expect(cache(rt)).toHaveLength(3);
    for (let run = 0; run < 2; run++) {
      sim.advanceDay();
      expect(Object.keys(cache(rt))).toEqual(['2', '1024']);
      expect(cache(rt)).toHaveLength(1025);
      expect(cache(rt)[1024].id).toBe('t_school');
      if (run === 0) {
        sim.replaceState(civicCity());
        expect(cache(rt)).toHaveLength(0);
      }
    }
  });
});
