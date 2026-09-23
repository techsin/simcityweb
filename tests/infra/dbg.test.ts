import { it } from 'vitest';
import { stressCity, newSim } from './cityGen';
import { getTraffic } from '../../src/sim/systems/infra';
it('dbg', () => {
  const city = stressCity(256);
  const sim = newSim(city.st);
  const tr = getTraffic(sim)!;
  for (let k = 0; k < 6; k++) { tr.invalidate(); tr.runCycleSync(sim); const s = city.st.stats; console.log(Array.from(tr.phaseMs).map((t) => t.toFixed(1)).join(' / '), `commute=${s.avgCommute.toFixed(1)} traffic=${s.avgTraffic.toFixed(2)} car=${s.tripsCar} transit=${s.tripsTransit} walk=${s.tripsWalk}`); }
  const ms = (sim.systems as any[]).map((x) => `${x.name}:${(x.lastMs ?? 0).toFixed(1)}`).join(' ');
  console.log(ms);
});
