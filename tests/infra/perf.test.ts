import { describe, it, expect } from 'vitest';
import { stressCity, newSim } from './cityGen';
import { getTraffic } from '../../src/sim/systems/infra';

describe('infra perf (256x256 stress city)', () => {
  it('traffic assignment timing', () => {
    const t0 = performance.now();
    const city = stressCity(256);
    const tGen = performance.now() - t0;
    const t1 = performance.now();
    const sim = newSim(city.st);
    const tInit = performance.now() - t1;
    const tr = getTraffic(sim)!;
    const times: number[] = [];
    for (let k = 0; k < 4; k++) {
      tr.invalidate();
      const a = performance.now();
      tr.runCycleSync(sim);
      times.push(performance.now() - a);
    }
    console.log(`stress city: roads=${city.roadCells} buildings=${city.buildings} pop=${city.pop} jobs=${city.jobs} gen=${tGen.toFixed(0)}ms init=${tInit.toFixed(0)}ms`);
    console.log(`cycles ms: ${times.map((t) => t.toFixed(1)).join(', ')} phases: ${Array.from(tr.phaseMs).map((t) => t.toFixed(1)).join(' / ')}`);
    const s = city.st.stats;
    console.log(`commute=${s.avgCommute.toFixed(1)} traffic=${s.avgTraffic.toFixed(2)} car=${s.tripsCar} transit=${s.tripsTransit} walk=${s.tripsWalk}`);
    expect(city.buildings).toBeGreaterThan(15000);
  });
});
