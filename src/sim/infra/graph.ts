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

// ---------------------------------------------------------------------------------------------- B2 piecewise builds
/** netFlags bit 5: rail level crossing on a road cell (the rail graph's cells: Rail or a crossing; traffic.ts) */
const NETFLAG_CROSSING_G = 1 << 5;
/**
 * estimated warm µs per unit of the piecewise build stages (GraphBuildRun; dense1m, B2 G1 fit): road numbering per cell,
 * road attributes / edges / components per node, rail and subway numbering per cell (typed masks) and edges /
 * components per node, the publish copies per cell and per node
 */
export const GRAPH_BUILD_US = {
  roadCell: 0.0045, roadAttr: 0.006, roadEdge: 0.034, roadComp: 0.022,
  gridCell: 0.0025, gridEdge: 0.012, gridComp: 0.012,
  pubCell: 0.0012, pubNode: 0.006,
} as const;

/** a grid graph under construction (GraphBuildRun's rail / subway part) */
class GridBuild {
  nodeOf: Int32Array<ArrayBuffer> = new Int32Array(0);
  cellOf: Int32Array<ArrayBuffer> = new Int32Array(0);
  adj: Int32Array<ArrayBuffer> = new Int32Array(0);
  comp: Int32Array<ArrayBuffer> = new Int32Array(0);
  stack: Int32Array<ArrayBuffer> = new Int32Array(0);
  n = 0;
  nComp = 0;
}

const growInt = (a: Int32Array<ArrayBuffer>, n: number): Int32Array<ArrayBuffer> => {
  if (a.length >= n) return a;
  const b = new Int32Array(Math.max(n, 2 * a.length, 64));
  b.set(a);
  return b;
};

/**
 * B2 (docs/dev/B2_DESIGN.md §2.5 / §3 rebuild): traffic's road, rail and subway graphs built in pieces from a private
 * copy of the network / netFlags / subway grids taken at begin(), into private scratch graphs, then written into the live
 * RoadGraph / GridGraph objects by publish() exactly as RoadGraph.build() / GridGraph.build() write them (same array
 * allocations and tails, version + 1 each; the objects are kept: emergency holds the RoadGraph and checks its version).
 * The graphs are a pure function of the grids, so the result is byte-identical to build() on the grids of begin(); a
 * component DFS resumed from its saved stack visits nodes in the same order, so component ids are identical too. The
 * rail and subway node masks are typed (Rail or a level crossing; subway != 0), not per-cell closures.
 * run(budgetUs) does at least one unit of work and at most ~budgetUs estimated µs (GRAPH_BUILD_US); true when done.
 */
export class GraphBuildRun {
  N = 0;
  C = 0;
  /** 0 road numbering, 1 road attributes, 2 road edges, 3 road components, 4-6 rail (numbering, edges, components),
   *  7-9 subway, 10 done; -1 idle */
  stage = -1;
  private cur = 0;
  private sp = 0;
  private nc = 0;
  private net: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private flags: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private sub: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  // road scratch graph
  private rNodeOf: Int32Array<ArrayBuffer> = new Int32Array(0);
  private rCellOf: Int32Array<ArrayBuffer> = new Int32Array(0);
  private rType: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private rT0: Float32Array<ArrayBuffer> = new Float32Array(0);
  private rCap: Float32Array<ArrayBuffer> = new Float32Array(0);
  private rFwd: Int32Array<ArrayBuffer> = new Int32Array(0);
  private rRev: Int32Array<ArrayBuffer> = new Int32Array(0);
  private rComp: Int32Array<ArrayBuffer> = new Int32Array(0);
  private rStack: Int32Array<ArrayBuffer> = new Int32Array(0);
  private rN = 0;
  private rNComp = 0;
  private readonly rail = new GridBuild();
  private readonly subway = new GridBuild();

  /** copy the grids and reset the cursors (the first piece of a rebuild) */
  begin(state: CityState): void {
    const N = state.size, C = N * N;
    this.N = N;
    this.C = C;
    if (this.net.length !== C) { this.net = new Uint8Array(C); this.flags = new Uint8Array(C); this.sub = new Uint8Array(C); }
    this.net.set(state.network.subarray(0, C));
    this.flags.set(state.netFlags.subarray(0, C));
    this.sub.set(state.subway.subarray(0, C));
    if (this.rNodeOf.length !== C) this.rNodeOf = new Int32Array(C);
    for (const g of [this.rail, this.subway]) if (g.nodeOf.length !== C) g.nodeOf = new Int32Array(C);
    this.stage = 0;
    this.cur = 0;
    this.sp = 0;
    this.nc = 0;
    this.rN = 0;
  }

  /** a build is in progress (begin() ran, publish() not yet) */
  get active(): boolean {
    return this.stage >= 0;
  }

  /** forget an unfinished build (its scratch is reused by the next begin) */
  cancel(): void {
    this.stage = -1;
  }

  /** estimated µs left (all stages; the numbering stages assume the previous build's node counts) */
  remainingUs(): number {
    const U = GRAPH_BUILD_US, C = this.C, st = this.stage;
    if (st < 0 || st >= 10) return 0;
    const nR = st >= 1 ? this.rN : Math.max(this.rN, C >> 2), nRail = this.rail.n, nSub = this.subway.n;
    let us = 0;
    if (st <= 0) us += (C - this.cur) * U.roadCell;
    if (st <= 1) us += nR * U.roadAttr;
    if (st <= 2) us += nR * U.roadEdge;
    if (st <= 3) us += nR * U.roadComp;
    us += (st <= 4 ? C : 0) * U.gridCell + (st <= 7 ? C : 0) * U.gridCell;
    us += (st <= 6 ? nRail * (U.gridEdge + U.gridComp) : 0) + (st <= 9 ? nSub * (U.gridEdge + U.gridComp) : 0);
    return us;
  }

  /** run at most about budgetUs estimated µs of the build (at least one unit); true when every graph is built */
  run(budgetUs: number): boolean {
    let left = budgetUs;
    let first = true;
    while (this.stage >= 0 && this.stage < 10) {
      const U = GRAPH_BUILD_US;
      const st = this.stage;
      const coef = st === 0 ? U.roadCell : st === 1 ? U.roadAttr : st === 2 ? U.roadEdge : st === 3 ? U.roadComp
        : st === 4 || st === 7 ? U.gridCell : st === 5 || st === 8 ? U.gridEdge : U.gridComp;
      let units = Math.floor(left / coef);
      if (units < 1) { if (!first) return false; units = 1; }
      first = false;
      const used = this.stageRun(units);
      left -= used * coef;
      if (left <= 0 && this.stage === st) return false;
    }
    return this.stage >= 10;
  }

  /** at most `units` units of the current stage; returns the units used (the stage advances when complete) */
  private stageRun(units: number): number {
    switch (this.stage) {
      case 0: return this.roadNumber(units);
      case 1: return this.roadAttr(units);
      case 2: return this.roadEdges(units);
      case 3: return this.roadComps(units);
      case 4: return this.gridNumber(this.rail, units, true);
      case 5: return this.gridEdges(this.rail, units);
      case 6: return this.gridComps(this.rail, units);
      case 7: return this.gridNumber(this.subway, units, false);
      case 8: return this.gridEdges(this.subway, units);
      default: return this.gridComps(this.subway, units);
    }
  }

  private next(): void {
    this.stage++;
    this.cur = 0;
    this.sp = 0;
    this.nc = 0;
  }

  private roadNumber(units: number): number {
    const C = this.C, net = this.net, nodeOf = this.rNodeOf;
    const i0 = this.cur, i1 = Math.min(C, i0 + units);
    let n = this.rN;
    if (this.rCellOf.length < n + (i1 - i0)) this.rCellOf = growInt(this.rCellOf, n + (i1 - i0));
    const cellOf = this.rCellOf;
    for (let i = i0; i < i1; i++) {
      if (isRoad(net[i] as Network)) { cellOf[n] = i; nodeOf[i] = n++; } else nodeOf[i] = -1;
    }
    this.rN = n;
    this.cur = i1;
    if (i1 >= C) {
      const cap = n + (n >> 3) + 16;
      if (this.rType.length < n) {
        this.rType = new Uint8Array(cap); this.rT0 = new Float32Array(cap); this.rCap = new Float32Array(cap);
        this.rFwd = new Int32Array(cap * 4); this.rRev = new Int32Array(cap * 4); this.rComp = new Int32Array(cap); this.rStack = new Int32Array(cap);
      }
      this.next();
    }
    return i1 - i0;
  }

  private roadAttr(units: number): number {
    const n = this.rN, net = this.net, cellOf = this.rCellOf, type = this.rType, t0 = this.rT0, capA = this.rCap;
    const k0 = this.cur, k1 = Math.min(n, k0 + units);
    for (let k = k0; k < k1; k++) {
      const t = net[cellOf[k]];
      type[k] = t;
      t0[k] = NET_TIME[t];
      capA[k] = NET_CAPACITY[t];
    }
    this.cur = k1;
    if (k1 >= n) { this.next(); this.rFwd.fill(-1, 0, n * 4); this.rRev.fill(-1, 0, n * 4); }
    return Math.max(1, k1 - k0);
  }

  private roadEdges(units: number): number {
    const n = this.rN, N = this.N, flags = this.flags, nodeOfCell = this.rNodeOf, cellOf = this.rCellOf, type = this.rType;
    const fwd = this.rFwd, rev = this.rRev;
    const a0 = this.cur, a1 = Math.min(n, a0 + units);
    for (let a = a0; a < a1; a++) {
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
    this.cur = a1;
    if (a1 >= n) { this.next(); this.rComp.fill(-1, 0, n); }
    return Math.max(1, a1 - a0);
  }

  private roadComps(units: number): number {
    const n = this.rN, comp = this.rComp, stack = this.rStack, fwd = this.rFwd, rev = this.rRev;
    let s = this.cur, sp = this.sp, nc = this.nc, used = 0;
    while (used < units) {
      if (sp === 0) {
        while (s < n && comp[s] >= 0) s++;
        if (s >= n) break;
        stack[sp++] = s;
        comp[s] = nc;
      }
      const a = stack[--sp];
      for (let k = 0; k < 4; k++) {
        let b = fwd[a * 4 + k];
        if (b >= 0 && comp[b] < 0) { comp[b] = nc; stack[sp++] = b; }
        b = rev[a * 4 + k];
        if (b >= 0 && comp[b] < 0) { comp[b] = nc; stack[sp++] = b; }
      }
      used++;
      if (sp === 0) nc++;
    }
    this.cur = s; this.sp = sp; this.nc = nc;
    if (sp === 0 && s >= n) { this.rNComp = nc; this.next(); }
    return Math.max(1, used);
  }

  private gridNumber(g: GridBuild, units: number, rail: boolean): number {
    const C = this.C, net = this.net, flags = this.flags, sub = this.sub, nodeOf = g.nodeOf;
    const i0 = this.cur, i1 = Math.min(C, i0 + units);
    if (i0 === 0) g.n = 0;
    let n = g.n;
    if (g.cellOf.length < n + (i1 - i0)) g.cellOf = growInt(g.cellOf, n + (i1 - i0));
    const cellOf = g.cellOf, RAIL = Network.Rail;
    if (rail) {
      for (let i = i0; i < i1; i++) {
        if (net[i] === RAIL || (flags[i] & NETFLAG_CROSSING_G) !== 0) { cellOf[n] = i; nodeOf[i] = n++; } else nodeOf[i] = -1;
      }
    } else {
      for (let i = i0; i < i1; i++) {
        if (sub[i] !== 0) { cellOf[n] = i; nodeOf[i] = n++; } else nodeOf[i] = -1;
      }
    }
    g.n = n;
    this.cur = i1;
    if (i1 >= C) {
      if (g.adj.length < n * 4) { const cap = n + (n >> 3) + 16; g.adj = new Int32Array(cap * 4); g.comp = new Int32Array(cap); g.stack = new Int32Array(cap); }
      g.adj.fill(-1, 0, n * 4);
      this.next();
    }
    return i1 - i0;
  }

  private gridEdges(g: GridBuild, units: number): number {
    const n = g.n, N = this.N, nodeOf = g.nodeOf, cellOf = g.cellOf, adj = g.adj;
    const a0 = this.cur, a1 = Math.min(n, a0 + units);
    for (let a = a0; a < a1; a++) {
      const ci = cellOf[a];
      const x = ci % N, z = (ci - x) / N;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], nz = z + DZ[k];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const b = nodeOf[nz * N + nx];
        if (b >= 0) adj[a * 4 + k] = b;
      }
    }
    this.cur = a1;
    if (a1 >= n) { this.next(); g.comp.fill(-1, 0, n); }
    return Math.max(1, a1 - a0);
  }

  private gridComps(g: GridBuild, units: number): number {
    const n = g.n, comp = g.comp, stack = g.stack, adj = g.adj;
    let s = this.cur, sp = this.sp, nc = this.nc, used = 0;
    while (used < units) {
      if (sp === 0) {
        while (s < n && comp[s] >= 0) s++;
        if (s >= n) break;
        stack[sp++] = s;
        comp[s] = nc;
      }
      const a = stack[--sp];
      for (let k = 0; k < 4; k++) {
        const b = adj[a * 4 + k];
        if (b >= 0 && comp[b] < 0) { comp[b] = nc; stack[sp++] = b; }
      }
      used++;
      if (sp === 0) nc++;
    }
    this.cur = s; this.sp = sp; this.nc = nc;
    if (sp === 0 && s >= n) { g.nComp = nc; this.next(); }
    return Math.max(1, used);
  }

  /** estimated µs of publish() */
  publishUs(): number {
    const U = GRAPH_BUILD_US;
    return 3 * this.C * U.pubCell + (this.rN + this.rail.n + this.subway.n) * U.pubNode;
  }

  /** write the built graphs into the live ones exactly as RoadGraph.build / GridGraph.build would (version + 1 each) */
  publish(road: RoadGraph, rail: GridGraph, subway: GridGraph): void {
    const N = this.N, C = this.C, n = this.rN;
    if (road.nodeOfCell.length !== C) road.nodeOfCell = new Int32Array(C);
    road.N = N;
    road.C = C;
    road.nodeOfCell.set(this.rNodeOf.subarray(0, C));
    road.n = n;
    if (road.cellOf.length < n) {
      const cap = Math.max(n, 16) + (n >> 3);
      road.cellOf = new Int32Array(cap);
      road.type = new Uint8Array(cap);
      road.fwd = new Int32Array(cap * 4);
      road.rev = new Int32Array(cap * 4);
      road.t0 = new Float32Array(cap);
      road.cap = new Float32Array(cap);
      road.comp = new Int32Array(cap);
    }
    road.cellOf.set(this.rCellOf.subarray(0, n));
    road.type.set(this.rType.subarray(0, n));
    road.t0.set(this.rT0.subarray(0, n));
    road.cap.set(this.rCap.subarray(0, n));
    road.fwd.set(this.rFwd.subarray(0, n * 4));
    road.rev.set(this.rRev.subarray(0, n * 4));
    road.comp.set(this.rComp.subarray(0, n));
    road.nComp = this.rNComp;
    road.version++;
    this.publishGrid(this.rail, rail);
    this.publishGrid(this.subway, subway);
    this.stage = -1;
  }

  private publishGrid(b: GridBuild, g: GridGraph): void {
    const N = this.N, C = this.C, n = b.n;
    if (g.nodeOfCell.length !== C) g.nodeOfCell = new Int32Array(C);
    g.N = N;
    g.nodeOfCell.set(b.nodeOf.subarray(0, C));
    g.n = n;
    if (g.cellOf.length < n) {
      const cap = Math.max(n, 16) + (n >> 3);
      g.cellOf = new Int32Array(cap);
      g.adj = new Int32Array(cap * 4);
      g.comp = new Int32Array(cap);
    }
    g.cellOf.set(b.cellOf.subarray(0, n));
    g.adj.set(b.adj.subarray(0, n * 4));
    g.comp.set(b.comp.subarray(0, n));
    g.nComp = b.nComp;
    g.version++;
  }
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
