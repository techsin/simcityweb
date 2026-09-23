/**
 * Terrain masks derived from the water layer (SIM_DEPTH_SPEC WP3 C3; also used by WP4 waterfront / tourism).
 *
 *  seaMask(st)    1 on SEA water cells: a water component that touches the map edge, covers more than
 *                 SEA_MIN_SHARE of the map and is wide somewhere (a cell >= SEA_MIN_DEPTH cells from land) — so
 *                 edge-to-edge rivers and lakes stay fresh water. Sea pumps are brackish, desalination needs the sea.
 *  shoreCells(st) land cells 4-adjacent to any water cell (ascending cell index).
 *  waterDepth(st) per water cell: 4-neighbour distance (cells) to the nearest land cell (0 on land).
 *
 * Cached per CityState and validated with a cheap checksum of state.water on every call (O(cells), ~0.1 ms on 256²),
 * so terraforming never leaves them stale. Call once per pass, not per building. Headless: no DOM / three.js.
 */
import type { CityState } from '../CityState';
import { SEA_MIN_DEPTH, SEA_MIN_SHARE } from './params';

interface MaskCache {
  cells: number;
  sum: number;
  count: number;
  sea: Uint8Array;
  shore: Int32Array;
  depth: Uint16Array;
  seaCells: number;
}
const cache = new WeakMap<CityState, MaskCache>();

function checksum(w: Uint8Array): [number, number] {
  let s = 0, n = 0;
  for (let i = 0; i < w.length; i++) if (w[i]) { s += i + 1; n++; }
  return [s, n];
}

function build(st: CityState): MaskCache {
  const N = st.size, C = st.cells, wm = st.water;
  const [sum, count] = checksum(wm);
  const depth = new Uint16Array(C);
  const sea = new Uint8Array(C);
  const queue = new Int32Array(C);
  // distance of water cells to land (multi-source BFS from land cells next to water)
  let qh = 0, qt = 0;
  const shoreList: number[] = [];
  for (let i = 0; i < C; i++) {
    if (wm[i]) { depth[i] = 0xffff; continue; }
    const x = i % N;
    const nb = (x > 0 && wm[i - 1]) || (x < N - 1 && wm[i + 1]) || (i >= N && wm[i - N]) || (i + N < C && wm[i + N]);
    if (nb) { shoreList.push(i); queue[qt++] = i; }
  }
  while (qh < qt) {
    const i = queue[qh++];
    const d = depth[i] + 1;
    const x = i % N;
    if (x > 0 && depth[i - 1] > d) { depth[i - 1] = d; queue[qt++] = i - 1; }
    if (x < N - 1 && depth[i + 1] > d) { depth[i + 1] = d; queue[qt++] = i + 1; }
    if (i >= N && depth[i - N] > d) { depth[i - N] = d; queue[qt++] = i - N; }
    if (i + N < C && depth[i + N] > d) { depth[i + N] = d; queue[qt++] = i + N; }
  }
  for (let i = 0; i < C; i++) if (depth[i] === 0xffff) depth[i] = Math.min(0xfffe, N); // all-water map
  // water components: sea if edge-touching, large and wide
  const comp = new Int32Array(C).fill(-1);
  let seaCells = 0;
  const minSize = SEA_MIN_SHARE * C;
  for (let s = 0; s < C; s++) {
    if (!wm[s] || comp[s] >= 0) continue;
    qh = 0; qt = 0;
    queue[qt++] = s;
    comp[s] = s;
    let edge = false, maxDepth = 0;
    while (qh < qt) {
      const i = queue[qh++];
      const x = i % N, z = (i - x) / N;
      if (x === 0 || z === 0 || x === N - 1 || z === N - 1) edge = true;
      if (depth[i] > maxDepth) maxDepth = depth[i];
      if (x > 0 && wm[i - 1] && comp[i - 1] < 0) { comp[i - 1] = s; queue[qt++] = i - 1; }
      if (x < N - 1 && wm[i + 1] && comp[i + 1] < 0) { comp[i + 1] = s; queue[qt++] = i + 1; }
      if (z > 0 && wm[i - N] && comp[i - N] < 0) { comp[i - N] = s; queue[qt++] = i - N; }
      if (z < N - 1 && wm[i + N] && comp[i + N] < 0) { comp[i + N] = s; queue[qt++] = i + N; }
    }
    if (edge && qt > minSize && maxDepth >= SEA_MIN_DEPTH) {
      for (let q = 0; q < qt; q++) sea[queue[q]] = 1;
      seaCells += qt;
    }
  }
  return { cells: C, sum, count, sea, shore: Int32Array.from(shoreList), depth, seaCells };
}

function masks(st: CityState): MaskCache {
  const c = cache.get(st);
  if (c && c.cells === st.cells) {
    const [sum, count] = checksum(st.water);
    if (sum === c.sum && count === c.count) return c;
  }
  const m = build(st);
  cache.set(st, m);
  return m;
}

/** 1 = sea water cell */
export function seaMask(st: CityState): Uint8Array {
  return masks(st).sea;
}

/** land cells 4-adjacent to water */
export function shoreCells(st: CityState): Int32Array {
  return masks(st).shore;
}

/** per cell: distance (cells) from a water cell to the nearest land cell; 0 on land */
export function waterDepth(st: CityState): Uint16Array {
  return masks(st).depth;
}

/** number of sea cells (0 = landlocked map) */
export function seaCellCount(st: CityState): number {
  return masks(st).seaCells;
}

/**
 * Water within `d` cells (Chebyshev) of the footprint [x0, x0 + w) x [z0, z0 + h): { fresh, sea } flags.
 * `sea` may be passed in (from seaMask) to avoid the checksum when called in a loop.
 */
export function waterNear(st: CityState, x0: number, z0: number, w: number, h: number, d: number, sea: Uint8Array = seaMask(st)): { fresh: boolean; sea: boolean } {
  const N = st.size, wm = st.water;
  let fresh = false, salt = false;
  for (let z = z0 - d; z < z0 + h + d; z++) {
    if (z < 0 || z >= N) continue;
    for (let x = x0 - d; x < x0 + w + d; x++) {
      if (x < 0 || x >= N) continue;
      const i = z * N + x;
      if (!wm[i]) continue;
      if (sea[i]) salt = true;
      else fresh = true;
      if (fresh && salt) return { fresh, sea: salt };
    }
  }
  return { fresh, sea: salt };
}
