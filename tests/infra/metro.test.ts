/**
 * Metropolis sanity check (~1M residents on 256²): the commute / traffic model must not collapse, and congestion
 * must be solvable with better networks: streets/roads only -> + avenues & highways -> + subway grid.
 * Prints the numbers; assertions are about the direction of change and plausible ranges.
 */
import { describe, expect, it } from 'vitest';
import type { CityState } from '../../src/sim/CityState';
import { getTraffic } from '../../src/sim/systems/infra';
import { newSim, stressCity, type StressOptions } from './cityGen';

interface Result { pop: number; commute: number; traffic: number; gridlock: number; car: number; transit: number; walk: number; access: number }

function run(opts: StressOptions): Result {
  const city = stressCity(256, 7, { popScale: 1.8, segregated: true, jobsPerWorker: 0.95, withTransit: false, ...opts });
  const sim = newSim(city.st);
  const tr = getTraffic(sim)!;
  for (let k = 0; k < 10; k++) { tr.invalidate(); tr.runCycleSync(sim); }
  const st: CityState = city.st;
  let used = 0, jam = 0;
  for (let i = 0; i < st.cells; i++) {
    if (st.network[i] < 1 || st.network[i] > 5 || st.traffic[i] < 1) continue;
    used++;
    if (st.congestion[i] > 1.5) jam++;
  }
  let acc = 0, w = 0;
  for (const b of st.buildings.values()) {
    if (b.pop <= 0) continue;
    const a = tr.workerAccess(b.id);
    if (a < 0) continue;
    acc += a * b.pop;
    w += b.pop;
  }
  const s = st.stats;
  return { pop: city.pop, commute: s.avgCommute, traffic: s.avgTraffic, gridlock: jam / Math.max(1, used), car: s.tripsCar, transit: s.tripsTransit, walk: s.tripsWalk, access: acc / w };
}

const fmt = (r: Result) =>
  `pop=${r.pop} commute=${r.commute.toFixed(1)}min avgV/C=${r.traffic.toFixed(2)} roads>1.5xcap=${(r.gridlock * 100).toFixed(1)}% car=${r.car} transit=${r.transit} walk=${r.walk} access=${r.access.toFixed(2)}`;

describe('metropolis (~1M residents)', () => {
  it('commutes stay plausible and better networks relieve congestion', { timeout: 300000 }, () => {
    const basic = run({ arterials: false });
    const arterial = run({ arterials: true });
    const metro = run({ arterials: true, subwayGrid: true, withTransit: true });
    console.log(`streets/roads only : ${fmt(basic)}`);
    console.log(`+ avenues/highways : ${fmt(arterial)}`);
    console.log(`+ subway grid, bus : ${fmt(metro)}`);
    expect(basic.pop).toBeGreaterThan(850000);
    // no collapse: everyone still reaches jobs (jobs ~ workers) with bounded commutes
    for (const r of [basic, arterial, metro]) {
      expect(r.access).toBeGreaterThan(0.85);
      expect(r.commute).toBeLessThan(90);
    }
    // arterials relieve congestion; transit relieves it further and carries a real share
    expect(arterial.gridlock).toBeLessThan(basic.gridlock);
    expect(arterial.commute).toBeLessThan(basic.commute);
    expect(metro.gridlock).toBeLessThanOrEqual(arterial.gridlock);
    expect(metro.commute).toBeLessThan(arterial.commute);
    expect(metro.transit).toBeGreaterThan(0.15 * (metro.car + metro.transit + metro.walk));
  });
});
