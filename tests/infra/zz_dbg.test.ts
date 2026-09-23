import { it } from 'vitest';
import { Network } from '../../src/core/types';
import { getTraffic } from '../../src/sim/systems/infra';
import { newSim, newState, place, roadLine } from './cityGen';
it('dbg', () => {
  const st = newState(64);
  roadLine(st, 14, 4, 14, 46, Network.Road);
  roadLine(st, 40, 4, 40, 46, Network.Road);
  roadLine(st, 15, 25, 39, 25, Network.Street);
  for (let z = 4; z <= 46; z++) place(st, 't_r2', 13, z, { pop: 60, wealth: 2 });
  for (let z = 4; z <= 44; z += 4) place(st, 't_co', 41, z, { jobs: 300 });
  for (let x = 17; x <= 37; x++) st.network[st.idx(x, 40)] = Network.Rail;
  roadLine(st, 27, 36, 27, 44, Network.Street);
  st.netFlags[st.idx(27, 40)] |= 1 << 5;
  place(st, 't_train', 15, 40); place(st, 't_train', 38, 40);
  const sim = newSim(st);
  const tr = getTraffic(sim)! as any;
  for (let k = 0; k < 8; k++) { tr.invalidate(); tr.runCycleSync(sim); }
  console.log('stops', tr.stops.n, 'transit', st.stats.tripsTransit, 'car', st.stats.tripsCar, 'rail n', tr.rail.n, 'riders', st.traffic[st.idx(30, 40)], 'conns', tr.conns.length, tr.conns.map((c: any) => `${c.x},${c.z},${c.type}`).join(' '));
  let tr0 = 0; for (let o = 0; o < tr.oN; o++) if (tr.oTrT[o] < Infinity) tr0++;
  console.log('origins with transit option', tr0, '/', tr.oN, 'attach', Array.from(tr.stAttC.subarray(0, tr.stops.n)).join(','));
});
