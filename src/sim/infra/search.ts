/**
 * Label-setting shortest path searches (multi-source Dijkstra with a binary heap on typed arrays).
 * Search results are stored in a reusable Search object: dist, src (seed id), next (tree pointer toward the seed),
 * hops (cells from the seed) and order (settle order, increasing distance) so flows can be accumulated along the
 * shortest-path forest in O(n) by walking `order` backwards.
 */
import { Network } from '../../core/types';
import { MinHeap } from './heap';
import type { RoadGraph } from './graph';
import { RAMP_PENALTY } from './params';

export class Search {
  n = 0;
  dist: Float64Array<ArrayBuffer> = new Float64Array(0);
  src: Int32Array<ArrayBuffer> = new Int32Array(0);
  next: Int32Array<ArrayBuffer> = new Int32Array(0);
  hops: Uint16Array<ArrayBuffer> = new Uint16Array(0);
  order: Int32Array<ArrayBuffer> = new Int32Array(0);
  done: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  settled = 0;
  /** version of the graph this search ran on */
  graphVersion = -1;

  ensure(n: number): void {
    if (this.dist.length < n) {
      const c = n + (n >> 2) + 16;
      this.dist = new Float64Array(c);
      this.src = new Int32Array(c);
      this.next = new Int32Array(c);
      this.hops = new Uint16Array(c);
      this.order = new Int32Array(c);
      this.done = new Uint8Array(c);
    }
    this.n = n;
  }

  reset(n: number): void {
    this.ensure(n);
    this.dist.fill(Infinity, 0, n);
    this.src.fill(-1, 0, n);
    this.next.fill(-1, 0, n);
    this.done.fill(0, 0, n);
    this.settled = 0;
  }
}

export class Seeds {
  n = 0;
  node: Int32Array<ArrayBuffer> = new Int32Array(256);
  label: Float64Array<ArrayBuffer> = new Float64Array(256);
  id: Int32Array<ArrayBuffer> = new Int32Array(256);
  clear(): void {
    this.n = 0;
  }
  push(node: number, label: number, id: number): void {
    if (this.n >= this.node.length) {
      const c = this.node.length * 2;
      const a = new Int32Array(c); a.set(this.node); this.node = a;
      const b = new Float64Array(c); b.set(this.label); this.label = b;
      const d = new Int32Array(c); d.set(this.id); this.id = d;
    }
    this.node[this.n] = node;
    this.label[this.n] = label;
    this.id[this.n] = id;
    this.n++;
  }
}

function seed(S: Search, heap: MinHeap, seeds: Seeds): void {
  const dist = S.dist, src = S.src, next = S.next, hops = S.hops;
  heap.clear();
  for (let s = 0; s < seeds.n; s++) {
    const v = seeds.node[s];
    const l = seeds.label[s];
    if (v < 0 || v >= S.n) continue;
    if (l < dist[v]) {
      dist[v] = l;
      src[v] = seeds.id[s];
      next[v] = -1;
      hops[v] = 0;
      heap.push(v, l);
    }
  }
}

/**
 * Road graph search. adj = g.fwd (forward search from seeds = origins) or g.rev (reverse search: distances TO the
 * seeds = destinations). Edge a->b cost = (time[a] + time[b]) / 2 (+ ramp penalty on highway <-> road).
 * `limit` stops the search once labels exceed it (unsettled nodes are unreachable).
 */
export function roadSearch(g: RoadGraph, adj: Int32Array, time: Float32Array, S: Search, heap: MinHeap, seeds: Seeds, limit = Infinity): void {
  const n = g.n;
  S.reset(n);
  S.graphVersion = g.version;
  heap.reserve(n * 2 + seeds.n + 16);
  seed(S, heap, seeds);
  const dist = S.dist, src = S.src, next = S.next, hops = S.hops, order = S.order, done = S.done;
  const type = g.type;
  const HW = Network.Highway;
  let cnt = 0;
  while (heap.size > 0) {
    const key = heap.topKey();
    const u = heap.pop();
    if (done[u] === 1 || key > dist[u]) continue;
    if (key > limit) break;
    done[u] = 1;
    order[cnt++] = u;
    const tu = time[u];
    const hu = type[u] === HW;
    const su = src[u];
    const hp = hops[u] + 1;
    const base = u * 4;
    for (let k = 0; k < 4; k++) {
      const v = adj[base + k];
      if (v < 0 || done[v] === 1) continue;
      let c = 0.5 * (tu + time[v]);
      if (hu !== (type[v] === HW)) c += RAMP_PENALTY;
      const nd = key + c;
      if (nd < dist[v]) {
        dist[v] = nd;
        src[v] = su;
        next[v] = u;
        hops[v] = hp > 65535 ? 65535 : hp;
        heap.push(v, nd);
      }
    }
  }
  S.settled = cnt;
}

/**
 * Multimodal transit network (reverse search from destination stops):
 *  node ids [0,nR) road nodes (bus riding), [nR,nR+nRail) rail nodes, [nR+nRail,total) subway nodes,
 *  plus transfer edges (CSR) between stops of different modes.
 */
export interface TransitNet {
  nR: number;
  nRail: number;
  nSub: number;
  total: number;
  /** reverse road adjacency (g.rev) */
  roadAdj: Int32Array;
  /** bus in-vehicle time per road node */
  busTime: Float32Array;
  railAdj: Int32Array;
  subAdj: Int32Array;
  railTime: number;
  subTime: number;
  trStart: Int32Array;
  trTo: Int32Array;
  trCost: Float32Array;
}

export function transitSearch(T: TransitNet, S: Search, heap: MinHeap, seeds: Seeds, limit = Infinity): void {
  const n = T.total;
  S.reset(n);
  heap.reserve(n * 2 + seeds.n + 16);
  seed(S, heap, seeds);
  const dist = S.dist, src = S.src, next = S.next, hops = S.hops, order = S.order, done = S.done;
  const nR = T.nR, nRR = T.nR + T.nRail;
  const roadAdj = T.roadAdj, busTime = T.busTime, railAdj = T.railAdj, subAdj = T.subAdj;
  const trStart = T.trStart, trTo = T.trTo, trCost = T.trCost;
  let cnt = 0;
  while (heap.size > 0) {
    const key = heap.topKey();
    const u = heap.pop();
    if (done[u] === 1 || key > dist[u]) continue;
    if (key > limit) break;
    done[u] = 1;
    order[cnt++] = u;
    const su = src[u];
    const hp = Math.min(65535, hops[u] + 1);
    if (u < nR) {
      const tu = busTime[u];
      const base = u * 4;
      for (let k = 0; k < 4; k++) {
        const v = roadAdj[base + k];
        if (v < 0 || done[v] === 1) continue;
        const nd = key + 0.5 * (tu + busTime[v]);
        if (nd < dist[v]) { dist[v] = nd; src[v] = su; next[v] = u; hops[v] = hp; heap.push(v, nd); }
      }
    } else if (u < nRR) {
      const base = (u - nR) * 4;
      for (let k = 0; k < 4; k++) {
        const a = railAdj[base + k];
        if (a < 0) continue;
        const v = a + nR;
        if (done[v] === 1) continue;
        const nd = key + T.railTime;
        if (nd < dist[v]) { dist[v] = nd; src[v] = su; next[v] = u; hops[v] = hp; heap.push(v, nd); }
      }
    } else {
      const base = (u - nRR) * 4;
      for (let k = 0; k < 4; k++) {
        const a = subAdj[base + k];
        if (a < 0) continue;
        const v = a + nRR;
        if (done[v] === 1) continue;
        const nd = key + T.subTime;
        if (nd < dist[v]) { dist[v] = nd; src[v] = su; next[v] = u; hops[v] = hp; heap.push(v, nd); }
      }
    }
    for (let e = trStart[u], e1 = trStart[u + 1]; e < e1; e++) {
      const v = trTo[e];
      if (done[v] === 1) continue;
      const nd = key + trCost[e];
      if (nd < dist[v]) { dist[v] = nd; src[v] = su; next[v] = u; hops[v] = hp; heap.push(v, nd); }
    }
  }
  S.settled = cnt;
}

/**
 * Accumulate flows injected in `acc` (per node) along the search forest toward the seeds.
 * After the call acc[v] = total flow through v. `onSink(seedId, flow)` receives flow reaching a seed.
 */
export function accumulate(S: Search, acc: Float32Array | Float64Array, onSink?: (seedId: number, flow: number, node: number) => void): void {
  const order = S.order, next = S.next, src = S.src;
  for (let k = S.settled - 1; k >= 0; k--) {
    const v = order[k];
    const f = acc[v];
    if (f === 0) continue;
    const nx = next[v];
    if (nx >= 0) acc[nx] += f;
    else if (onSink) onSink(src[v], f, v);
  }
}
