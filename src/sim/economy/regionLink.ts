/**
 * How well a city reaches its founded neighbours (SIM_DEPTH_SPEC WP4-1): the edge factor of a shared edge segment and
 * the neighbours' job / worker surpluses. One source for the demand model (demand.ts regionInputs re-exports these)
 * and the region layer's commuter exchange (src/region/regionEffects.ts applyRegionEffects: the regional jobs / workers
 * traffic and the employment ledger use are sized from the same connected surpluses as the regional demand terms).
 * Pure functions, no simulation imports (the region screen bundles this module).
 */
import type { CityState } from '../CityState';
import type { RegionNeighbor } from '../../region/regionEffects';
import { EDGE_CONN, EDGE_NONE } from './tuning';

/**
 * How well this city reaches neighbour `n`: the best EDGE_CONN of our neighbour connections on the shared edge segment
 * (the along-edge coordinate x for n / s, z for e / w inside [n.from, n.to)), EDGE_NONE without a connection.
 */
export function edgeFactor(st: CityState, n: Pick<RegionNeighbor, 'edge' | 'from' | 'to'>): number {
  let f = 0;
  for (const c of st.neighborConnections) {
    if (c.edge !== n.edge) continue;
    const a = n.edge === 'n' || n.edge === 's' ? c.x : c.z;
    if (a < n.from || a >= n.to) continue;
    const e = EDGE_CONN[c.type] ?? 0;
    if (e > f) f = e;
  }
  return f > 0 ? f : EDGE_NONE;
}

/** the best EDGE_CONN over all of the city's neighbour connections (any edge), EDGE_NONE without one — how well the
 *  city reaches the cities beyond its neighbours (their commuters pass a neighbour's tile) */
export function bestConnection(st: CityState): number {
  let f = 0;
  for (const c of st.neighborConnections) {
    const e = EDGE_CONN[c.type] ?? 0;
    if (e > f) f = e;
  }
  return f > 0 ? f : EDGE_NONE;
}

/**
 * The founded neighbour tiles of a region context, each once with its best-connected shared edge segment and that
 * segment's edge factor (edgeFactor), in the neighbours' order.
 */
export function connectedNeighbours(st: CityState, neighbors: readonly RegionNeighbor[]): { n: RegionNeighbor; f: number }[] {
  // one entry per shared edge segment; a tile is counted once with its best-connected segment
  const best = new Map<string, { n: RegionNeighbor; f: number }>();
  for (const n of neighbors) {
    if (!n.founded) continue;
    const f = edgeFactor(st, n);
    const cur = best.get(n.tileKey);
    if (!cur || f > cur.f) best.set(n.tileKey, { n, f });
  }
  return [...best.values()];
}

/** a neighbour's job surplus (jobs its own residents leave open: max(0, jobs − workers)) and worker surplus
 *  (max(0, workers − jobs)), before the edge factor */
export function neighbourSurplus(n: Pick<RegionNeighbor, 'jobs' | 'workers'>): { jobs: number; workers: number } {
  const jobs = Math.max(0, n.jobs || 0), workers = Math.max(0, n.workers || 0);
  return { jobs: Math.max(0, jobs - workers), workers: Math.max(0, workers - jobs) };
}
