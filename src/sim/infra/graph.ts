/**
 * Compact graphs built from CityState grids (flat typed arrays, 4 fixed neighbour slots per node).
 *
 *  RoadGraph: nodes = road cells (Street/Road/Avenue/OneWay/Highway, bridges & tunnels included).
 *    Directed edges a -> b between 4-adjacent road cells when allowed:
 *      - OneWay direction = netFlags bits 2-3 (0:+x 1:+z 2:-x 3:-z): no move against the flow out of / into a one-way
 *        cell; entering/leaving sideways (turning) is allowed.
 *      - Highway connects to Highway / Avenue / Road / OneWay (adjacency = automatic ramp, small time penalty);
 *        Highway <-> Street is NOT connected.
 *  GridGraph: undirected 4-neighbour graph for rail cells (Network.Rail) or subway cells (state.subway).
 *
 * Neighbour connections: road / rail cells on the map border (+ state.neighborConnections entries).
 */
import { Network, isRoad } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { DX, DZ } from './common';
import { NET_CAPACITY, NET_TIME } from './params';

export class RoadGraph {
  N = 0;
  C = 0;
  n = 0;
  nodeOfCell = new Int32Array(0);
  cellOf = new Int32Array(0);
  type = new Uint8Array(0);
  /** fwd[n*4+k]: node reached by moving from n in direction k (or -1) */
  fwd = new Int32Array(0);
  /** rev[n*4+k]: neighbour node m in direction k from n such that m -> n is allowed (or -1) */
  rev = new Int32Array(0);
  t0 = new Float32Array(0);
  cap = new Float32Array(0);
  /** weakly-connected component id per node */
  comp = new Int32Array(0);
  nComp = 0;
  /** incremented on every rebuild */
  version = 0;

  build(state: CityState): void {
    const N = state.size;
    const C = N * N;
    if (this.nodeOfCell.length !== C) this.nodeOfCell = new Int32Array(C);
    this.N = N;
    this.C = C;
    const net = state.network;
    const nodeOfCell = this.nodeOfCell;
    let n = 0;
    for (let i = 0; i < C; i++) {
      if (isRoad(net[i] as Network)) nodeOfCell[i] = n++;
      else nodeOfCell[i] = -1;
    }
    this.n = n;
    if (this.cellOf.length < n) {
      const cap = Math.max(n, 16) + (n >> 3);
      this.cellOf = new Int32Array(cap);
      this.type = new Uint8Array(cap);
      this.fwd = new Int32Array(cap * 4);
      this.rev = new Int32Array(cap * 4);
      this.t0 = new Float32Array(cap);
      this.cap = new Float32Array(cap);
      this.comp = new Int32Array(cap);
    }
    const cellOf = this.cellOf, type = this.type, fwd = this.fwd, rev = this.rev, t0 = this.t0, capA = this.cap;
    const flags = state.netFlags;
    for (let i = 0, k = 0; i < C; i++) {
      if (nodeOfCell[i] < 0) continue;
      cellOf[k] = i;
      const t = net[i];
      type[k] = t;
      t0[k] = NET_TIME[t];
      capA[k] = NET_CAPACITY[t];
      k++;
    }
    fwd.fill(-1, 0, n * 4);
    rev.fill(-1, 0, n * 4);
    for (let a = 0; a < n; a++) {
      const ci = cellOf[a];
      const x = ci % N;
      const z = (ci - x) / N;
      const ta = type[a];
      const dirA = (flags[ci] >> 2) & 3;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], nz = z + DZ[k];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const cj = nz * N + nx;
        const b = nodeOfCell[cj];
        if (b < 0) continue;
        const tb = type[b];
        if (!roadsConnect(ta, tb)) continue;
        const opp = (k + 2) & 3;
        if (ta === Network.OneWay && k === ((dirA + 2) & 3)) continue;
        if (tb === Network.OneWay && k === ((((flags[cj] >> 2) & 3) + 2) & 3)) continue;
        fwd[a * 4 + k] = b;
        rev[b * 4 + opp] = a;
      }
    }
    // weakly connected components (undirected over fwd|rev)
    const comp = this.comp;
    comp.fill(-1, 0, n);
    let nc = 0;
    const stack = scratchInt(n);
    for (let s = 0; s < n; s++) {
      if (comp[s] >= 0) continue;
      let sp = 0;
      stack[sp++] = s;
      comp[s] = nc;
      while (sp > 0) {
        const a = stack[--sp];
        for (let k = 0; k < 4; k++) {
          let b = fwd[a * 4 + k];
          if (b >= 0 && comp[b] < 0) { comp[b] = nc; stack[sp++] = b; }
          b = rev[a * 4 + k];
          if (b >= 0 && comp[b] < 0) { comp[b] = nc; stack[sp++] = b; }
        }
      }
      nc++;
    }
    this.nComp = nc;
    this.version++;
  }

  /** collect road nodes 4-adjacent to the building footprint into out (returns count, max out.length) */
  entryNodes(b: Building, out: Int32Array, offset = 0, max = out.length - offset): number {
    return perimeterNodes(this.nodeOfCell, this.N, b, out, offset, max);
  }
}

/** Highway <-> Street not connected; everything else between road types is. */
export function roadsConnect(ta: number, tb: number): boolean {
  if (ta === Network.Highway) return tb !== Network.Street;
  if (tb === Network.Highway) return ta !== Network.Street;
  return true;
}

/** undirected 4-neighbour graph of a cell mask (rail or subway) */
export class GridGraph {
  N = 0;
  n = 0;
  nodeOfCell = new Int32Array(0);
  cellOf = new Int32Array(0);
  adj = new Int32Array(0);
  comp = new Int32Array(0);
  nComp = 0;
  version = 0;

  build(N: number, isNode: (i: number) => boolean): void {
    const C = N * N;
    if (this.nodeOfCell.length !== C) this.nodeOfCell = new Int32Array(C);
    this.N = N;
    const nodeOfCell = this.nodeOfCell;
    let n = 0;
    for (let i = 0; i < C; i++) nodeOfCell[i] = isNode(i) ? n++ : -1;
    this.n = n;
    if (this.cellOf.length < n) {
      const cap = Math.max(n, 16) + (n >> 3);
      this.cellOf = new Int32Array(cap);
      this.adj = new Int32Array(cap * 4);
      this.comp = new Int32Array(cap);
    }
    const cellOf = this.cellOf, adj = this.adj;
    for (let i = 0, k = 0; i < C; i++) if (nodeOfCell[i] >= 0) cellOf[k++] = i;
    adj.fill(-1, 0, n * 4);
    for (let a = 0; a < n; a++) {
      const ci = cellOf[a];
      const x = ci % N, z = (ci - x) / N;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], nz = z + DZ[k];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const b = nodeOfCell[nz * N + nx];
        if (b >= 0) adj[a * 4 + k] = b;
      }
    }
    const comp = this.comp;
    comp.fill(-1, 0, n);
    let nc = 0;
    const stack = scratchInt(n);
    for (let s = 0; s < n; s++) {
      if (comp[s] >= 0) continue;
      let sp = 0;
      stack[sp++] = s;
      comp[s] = nc;
      while (sp > 0) {
        const a = stack[--sp];
        for (let k = 0; k < 4; k++) {
          const b = adj[a * 4 + k];
          if (b >= 0 && comp[b] < 0) { comp[b] = nc; stack[sp++] = b; }
        }
      }
      nc++;
    }
    this.nComp = nc;
    this.version++;
  }

  perimeterNodes(b: Building, out: Int32Array, offset = 0, max = out.length - offset, includeInside = false): number {
    let c = perimeterNodes(this.nodeOfCell, this.N, b, out, offset, max);
    if (includeInside) {
      const N = this.N;
      for (let z = b.z; z < b.z + b.d && c < max; z++)
        for (let x = b.x; x < b.x + b.w && c < max; x++) {
          if (x < 0 || z < 0 || x >= N || z >= N) continue;
          const nd = this.nodeOfCell[z * N + x];
          if (nd >= 0) out[offset + c++] = nd;
        }
    }
    return c;
  }
}

/** nodes (from a nodeOfCell map) 4-adjacent to a building footprint; de-duplicated, returns count */
export function perimeterNodes(nodeOfCell: Int32Array, N: number, b: Building, out: Int32Array, offset: number, max: number): number {
  let c = 0;
  const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d;
  for (let x = x0; x < x1 && c < max; x++) {
    if (x < 0 || x >= N) continue;
    if (z0 - 1 >= 0) { const nd = nodeOfCell[(z0 - 1) * N + x]; if (nd >= 0) out[offset + c++] = nd; }
    if (z1 < N && c < max) { const nd = nodeOfCell[z1 * N + x]; if (nd >= 0) out[offset + c++] = nd; }
  }
  for (let z = z0; z < z1 && c < max; z++) {
    if (z < 0 || z >= N) continue;
    if (x0 - 1 >= 0) { const nd = nodeOfCell[z * N + x0 - 1]; if (nd >= 0) out[offset + c++] = nd; }
    if (x1 < N && c < max) { const nd = nodeOfCell[z * N + x1]; if (nd >= 0) out[offset + c++] = nd; }
  }
  return c;
}

let scratch = new Int32Array(1024);
/** shared scratch Int32Array of at least n entries (single-threaded use only) */
export function scratchInt(n: number): Int32Array<ArrayBuffer> {
  if (scratch.length < n) scratch = new Int32Array(Math.max(n, scratch.length * 2));
  return scratch;
}

// ---------------------------------------------------------------------------------------------- connections
export interface NeighborConn {
  cell: number;
  x: number;
  z: number;
  type: Network;
  edge: 'n' | 's' | 'e' | 'w';
}

/**
 * Neighbour connections: road / rail runs on the map border lead off-map. Consecutive border cells of the same
 * network type form one run = one connection (placed at the run's middle cell), so a road running ALONG the edge
 * counts once. Explicit state.neighborConnections entries on matching network cells are added too (deduplicated).
 */
export function findNeighborConnections(state: CityState): NeighborConn[] {
  const N = state.size;
  const out: NeighborConn[] = [];
  const seen = new Set<number>();
  const net = state.network;
  const edges: { edge: NeighborConn['edge']; cell: (t: number) => number }[] = [
    { edge: 'n', cell: (t) => t },
    { edge: 's', cell: (t) => (N - 1) * N + t },
    { edge: 'w', cell: (t) => t * N },
    { edge: 'e', cell: (t) => t * N + N - 1 },
  ];
  for (const e of edges) {
    let t = 0;
    while (t < N) {
      const type = net[e.cell(t)];
      if (type === Network.None) { t++; continue; }
      let t1 = t;
      while (t1 + 1 < N && net[e.cell(t1 + 1)] === type) t1++;
      const mid = e.cell((t + t1) >> 1);
      let dup = false;
      for (let q = t; q <= t1; q++) if (seen.has(e.cell(q))) dup = true;
      for (let q = t; q <= t1; q++) seen.add(e.cell(q));
      if (!dup) out.push({ cell: mid, x: mid % N, z: Math.floor(mid / N), type: type as Network, edge: e.edge });
      t = t1 + 1;
    }
  }
  for (const c of state.neighborConnections ?? []) {
    if (c.x < 0 || c.z < 0 || c.x >= N || c.z >= N) continue;
    const i = c.z * N + c.x;
    if (seen.has(i) || net[i] === Network.None) continue;
    seen.add(i);
    out.push({ cell: i, x: c.x, z: c.z, type: net[i] as Network, edge: c.edge });
  }
  return out;
}
