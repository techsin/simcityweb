/**
 * Label-setting shortest path searches (exact multi-source Dijkstra with Dial bucket queues on typed arrays).
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

/**
 * Dial bucket queue for road searches. Bucket width Q <= the minimum edge cost, so every node popped from the
 * current bucket already has its final label (relaxations always land in later buckets) -> exact Dijkstra with O(1)
 * push / pop. Entries are linked lists in typed arrays; stale entries are skipped via the done[] flags.
 */
class BucketQueue {
  head: Int32Array<ArrayBuffer> = new Int32Array(0);
  enext: Int32Array<ArrayBuffer> = new Int32Array(0);
  enode: Int32Array<ArrayBuffer> = new Int32Array(0);
  en = 0;
  reset(buckets: number, entries: number): void {
    if (this.head.length < buckets) this.head = new Int32Array(buckets + 64);
    this.head.fill(-1, 0, buckets);
    if (this.enext.length < entries) {
      this.enext = new Int32Array(entries);
      this.enode = new Int32Array(entries);
    }
    this.en = 0;
  }
  push(b: number, v: number): void {
    let e = this.en++;
    if (e >= this.enext.length) {
      const c = this.enext.length * 2 + 16;
      const a = new Int32Array(c); a.set(this.enext); this.enext = a;
      const n = new Int32Array(c); n.set(this.enode); this.enode = n;
    }
    this.enode[e] = v;
    this.enext[e] = this.head[b];
    this.head[b] = e;
  }
}
const bq = new BucketQueue();
/** bucket width: min free-flow edge cost on roads (highway 0.04 min) */
let Q = 0.04 * 0.999;
export function setRoadBucketWidth(minEdgeCost: number): void {
  Q = minEdgeCost * 0.999;
}

/**
 * Road graph search. adj = g.fwd (forward search from seeds = origins) or g.rev (reverse search: distances TO the
 * seeds = destinations). Edge a->b cost = (time[a] + time[b]) / 2 (+ ramp penalty on highway <-> road).
 * `limit` stops the search once labels exceed it (unsettled nodes are unreachable).
 */
export function roadSearch(g: RoadGraph, adj: Int32Array, time: Float32Array, S: Search, _heap: MinHeap, seeds: Seeds, limit = 400): void {
  const n = g.n;
  S.reset(n);
  S.graphVersion = g.version;
  const dist = S.dist, src = S.src, next = S.next, hops = S.hops, order = S.order, done = S.done;
  if (!(limit < 2000)) limit = 2000;
  const invQ = 1 / Q;
  const nb = Math.ceil(limit * invQ) + 2;
  bq.reset(nb, n * 2 + seeds.n + 16);
  for (let s = 0; s < seeds.n; s++) {
    const v = seeds.node[s];
    const l = seeds.label[s];
    if (v < 0 || v >= n || !(l <= limit)) continue;
    if (l < dist[v]) {
      dist[v] = l;
      src[v] = seeds.id[s];
      next[v] = -1;
      hops[v] = 0;
      bq.push((l * invQ) | 0, v);
    }
  }
  const type = g.type;
  const HW = Network.Highway;
  const head = bq.head;
  let cnt = 0;
  for (let b = 0; b < nb; b++) {
    let e = head[b];
    while (e >= 0) {
      const u = bq.enode[e];
      e = bq.enext[e];
      if (done[u] === 1) continue;
      done[u] = 1;
      order[cnt++] = u;
      const key = dist[u];
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
        if (nd < dist[v] && nd <= limit) {
          dist[v] = nd;
          src[v] = su;
          next[v] = u;
          hops[v] = hp > 65535 ? 65535 : hp;
          const bi = (nd * invQ) | 0;
          // bi > b always holds (edge cost >= Q); guard against float edge cases
          bq.push(bi > b ? bi : b + 1, v);
        }
      }
    }
    head[b] = -1;
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

/** bucket width for the transit net: min in-vehicle edge cost (subway 0.03 min/cell) */
let QT = 0.03 * 0.999;
export function setTransitBucketWidth(minEdgeCost: number): void {
  QT = minEdgeCost * 0.999;
}

export function transitSearch(T: TransitNet, S: Search, _heap: MinHeap, seeds: Seeds, limit = 400): void {
  const n = T.total;
  S.reset(n);
  const dist = S.dist, src = S.src, next = S.next, hops = S.hops, order = S.order, done = S.done;
  if (!(limit < 2000)) limit = 2000;
  const invQ = 1 / QT;
  const nb = Math.ceil(limit * invQ) + 2;
  bq.reset(nb, n * 2 + seeds.n + 16);
  for (let s = 0; s < seeds.n; s++) {
    const v = seeds.node[s];
    const l = seeds.label[s];
    if (v < 0 || v >= n || !(l <= limit)) continue;
    if (l < dist[v]) {
      dist[v] = l;
      src[v] = seeds.id[s];
      next[v] = -1;
      hops[v] = 0;
      bq.push((l * invQ) | 0, v);
    }
  }
  const nR = T.nR, nRR = T.nR + T.nRail;
  const roadAdj = T.roadAdj, busTime = T.busTime, railAdj = T.railAdj, subAdj = T.subAdj;
  const trStart = T.trStart, trTo = T.trTo, trCost = T.trCost;
  const railTime = T.railTime, subTime = T.subTime;
  const head = bq.head;
  let cnt = 0;
  for (let b = 0; b < nb; b++) {
    let e = head[b];
    while (e >= 0) {
      const u = bq.enode[e];
      e = bq.enext[e];
      if (done[u] === 1) continue;
      done[u] = 1;
      order[cnt++] = u;
      const key = dist[u];
      const su = src[u];
      const hp = Math.min(65535, hops[u] + 1);
      for (let k = 0; k < 4; k++) {
        let v: number, c: number;
        if (u < nR) {
          v = roadAdj[u * 4 + k];
          if (v < 0) continue;
          c = 0.5 * (busTime[u] + busTime[v]);
        } else if (u < nRR) {
          const a = railAdj[(u - nR) * 4 + k];
          if (a < 0) continue;
          v = a + nR;
          c = railTime;
        } else {
          const a = subAdj[(u - nRR) * 4 + k];
          if (a < 0) continue;
          v = a + nRR;
          c = subTime;
        }
        if (done[v] === 1) continue;
        const nd = key + c;
        if (nd < dist[v] && nd <= limit) {
          dist[v] = nd; src[v] = su; next[v] = u; hops[v] = hp;
          const bi = (nd * invQ) | 0;
          bq.push(bi > b ? bi : b + 1, v);
        }
      }
      for (let t = trStart[u], t1 = trStart[u + 1]; t < t1; t++) {
        const v = trTo[t];
        if (done[v] === 1) continue;
        const nd = key + trCost[t];
        if (nd < dist[v] && nd <= limit) {
          dist[v] = nd; src[v] = su; next[v] = u; hops[v] = hp;
          const bi = (nd * invQ) | 0;
          bq.push(bi > b ? bi : b + 1, v);
        }
      }
    }
    head[b] = -1;
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
