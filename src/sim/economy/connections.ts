/**
 * Neighbor connections: road / rail / highway runs that touch the map edge.
 * One connection per contiguous run of network cells along an edge (type = best network in the run). A run counts only
 * when it LEADS somewhere: the network cells reachable from it (4-adjacent, any network type) number at least
 * CONN_MIN_CELLS and reach at least CONN_MIN_DEPTH cells in from the edge — a one-cell road stub at the map edge (or a
 * short dead-end spur) is not a neighbour connection (no demand bonus, no regional terms, no "New neighbor
 * connection!" notice) — and when that network is the CITY's: its component holds at least CONN_MAIN_SHARE of the
 * largest network component's cells (final fixes V6: 12 unconnected six-cell highway stubs at the map edges were 12
 * connections, and their cap relief stacked: industrial cap relief 16k → 256k for §8,680). A second town of its own
 * size still counts; a stub that leads nowhere does not. (demand.ts also gives further connections on one edge less
 * cap relief each: CONN_EDGE_DECAY.)
 */
import type { CityState } from '../CityState';
import { Network } from '../../core/types';

const RANK: Record<number, number> = {
  [Network.None]: 0, [Network.Street]: 1, [Network.Rail]: 2, [Network.OneWay]: 3, [Network.Road]: 4, [Network.Avenue]: 5, [Network.Highway]: 6,
};
/** a connection's network must hold this many cells ... */
export const CONN_MIN_CELLS = 6;
/** ... and reach this many cells in from the edge (0 = the edge cell itself) */
export const CONN_MIN_DEPTH = 3;
/** ... and its network component must hold at least this share of the cells of the largest one (the city's network) */
export const CONN_MAIN_SHARE = 0.25;

/** network component label per cell (4-adjacent, any network type; -1 = no network) and each component's cell count */
let compLabel = new Int32Array(0);
let compQueue = new Int32Array(0);
function labelComponents(st: CityState): { label: Int32Array; sizes: number[]; max: number } {
  const N = st.size, C = st.cells, net = st.network;
  if (compLabel.length < C) { compLabel = new Int32Array(C); compQueue = new Int32Array(C); }
  const label = compLabel, q = compQueue;
  label.fill(-1, 0, C);
  const sizes: number[] = [];
  let max = 0;
  for (let s = 0; s < C; s++) {
    if (net[s] === Network.None || label[s] >= 0) continue;
    const id = sizes.length;
    let head = 0, tail = 0;
    label[s] = id; q[tail++] = s;
    while (head < tail) {
      const i = q[head++], x = i % N;
      if (x > 0 && net[i - 1] !== Network.None && label[i - 1] < 0) { label[i - 1] = id; q[tail++] = i - 1; }
      if (x < N - 1 && net[i + 1] !== Network.None && label[i + 1] < 0) { label[i + 1] = id; q[tail++] = i + 1; }
      if (i >= N && net[i - N] !== Network.None && label[i - N] < 0) { label[i - N] = id; q[tail++] = i - N; }
      if (i + N < C && net[i + N] !== Network.None && label[i + N] < 0) { label[i + N] = id; q[tail++] = i + N; }
    }
    sizes.push(tail);
    if (tail > max) max = tail;
  }
  return { label, sizes, max };
}

/** true when the network reachable from the edge run cells[0..n) is more than a stub (bounded flood fill) */
function leadsInward(st: CityState, run: number[], edge: 'n' | 's' | 'e' | 'w'): boolean {
  const N = st.size, net = st.network;
  const seen = new Set<number>();
  const queue: number[] = [];
  for (const i of run) { seen.add(i); queue.push(i); }
  const depthOf = (i: number) => {
    const x = i % N, z = (i / N) | 0;
    return edge === 'n' ? z : edge === 's' ? N - 1 - z : edge === 'w' ? x : N - 1 - x;
  };
  let deep = false;
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h];
    if (!deep && depthOf(i) >= CONN_MIN_DEPTH) deep = true;
    if (deep && seen.size >= CONN_MIN_CELLS) return true;
    const x = i % N;
    const nb = [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, i - N, i + N];
    for (const j of nb) {
      if (j < 0 || j >= st.cells || seen.has(j) || net[j] === Network.None) continue;
      seen.add(j);
      queue.push(j);
    }
    // bounded: a real road leaves the edge quickly
    if (seen.size > 256) break;
  }
  return deep && seen.size >= CONN_MIN_CELLS;
}

/** Recompute state.neighborConnections. Returns true if the set of connections changed. */
export function updateNeighborConnections(st: CityState): boolean {
  const N = st.size;
  const out: CityState['neighborConnections'] = [];
  const run: number[] = [];
  // (components only when some edge cell holds a network: a city's first road is its main network)
  let comp: ReturnType<typeof labelComponents> | null = null;
  const onMain = (cell: number): boolean => {
    comp ??= labelComponents(st);
    return comp.sizes[comp.label[cell]] >= Math.max(CONN_MIN_CELLS, CONN_MAIN_SHARE * comp.max);
  };
  const scan = (edge: 'n' | 's' | 'e' | 'w') => {
    let runStart = -1, best = 0;
    run.length = 0;
    for (let k = 0; k <= N; k++) {
      let t = 0, cell = -1;
      if (k < N) {
        const x = edge === 'w' ? 0 : edge === 'e' ? N - 1 : k;
        const z = edge === 'n' ? 0 : edge === 's' ? N - 1 : k;
        cell = z * N + x;
        t = st.network[cell];
      }
      if (t !== Network.None) {
        if (runStart < 0) { runStart = k; best = t; run.length = 0; }
        else if (RANK[t] > RANK[best]) best = t;
        run.push(cell);
      } else if (runStart >= 0) {
        const mid = (runStart + k - 1) >> 1;
        const x = edge === 'w' ? 0 : edge === 'e' ? N - 1 : mid;
        const z = edge === 'n' ? 0 : edge === 's' ? N - 1 : mid;
        if (leadsInward(st, run, edge) && onMain(run[0])) out.push({ edge, x, z, type: best as Network });
        runStart = -1;
        run.length = 0;
      }
    }
  };
  scan('n'); scan('s'); scan('w'); scan('e');
  const prev = st.neighborConnections;
  const same = prev.length === out.length && prev.every((c, i) => c.edge === out[i].edge && c.x === out[i].x && c.z === out[i].z && c.type === out[i].type);
  st.neighborConnections = out;
  return !same;
}
