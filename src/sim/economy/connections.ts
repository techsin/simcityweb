/**
 * Neighbor connections: road / rail / highway runs that touch the map edge.
 * One connection per contiguous run of network cells along an edge (type = best network in the run).
 */
import type { CityState } from '../CityState';
import { Network } from '../../core/types';

const RANK: Record<number, number> = {
  [Network.None]: 0, [Network.Street]: 1, [Network.Rail]: 2, [Network.OneWay]: 3, [Network.Road]: 4, [Network.Avenue]: 5, [Network.Highway]: 6,
};

/** Recompute state.neighborConnections. Returns true if the set of connections changed. */
export function updateNeighborConnections(st: CityState): boolean {
  const N = st.size;
  const out: CityState['neighborConnections'] = [];
  const scan = (edge: 'n' | 's' | 'e' | 'w') => {
    let runStart = -1, best = 0;
    for (let k = 0; k <= N; k++) {
      let t = 0;
      if (k < N) {
        const x = edge === 'w' ? 0 : edge === 'e' ? N - 1 : k;
        const z = edge === 'n' ? 0 : edge === 's' ? N - 1 : k;
        t = st.network[z * N + x];
      }
      if (t !== Network.None) {
        if (runStart < 0) { runStart = k; best = t; }
        else if (RANK[t] > RANK[best]) best = t;
      } else if (runStart >= 0) {
        const mid = (runStart + k - 1) >> 1;
        const x = edge === 'w' ? 0 : edge === 'e' ? N - 1 : mid;
        const z = edge === 'n' ? 0 : edge === 's' ? N - 1 : mid;
        out.push({ edge, x, z, type: best as Network });
        runStart = -1;
      }
    }
  };
  scan('n'); scan('s'); scan('w'); scan('e');
  const prev = st.neighborConnections;
  const same = prev.length === out.length && prev.every((c, i) => c.edge === out[i].edge && c.x === out[i].x && c.z === out[i].z && c.type === out[i].type);
  st.neighborConnections = out;
  return !same;
}
