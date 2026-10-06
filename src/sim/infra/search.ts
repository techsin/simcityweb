/**
 * Label-setting shortest path searches (exact multi-source Dijkstra with Dial bucket queues on typed arrays).
 * Search results are stored in a reusable Search object: dist, src (seed id), next (tree pointer toward the seed),
 * hops (cells from the seed) and order (settle order, increasing distance) so flows can be accumulated along the
 * shortest-path forest in O(n) by walking `order` backwards.
 */
import { Network } from '../../core/types';
import { MinHeap } from './heap';
import type { RoadGraph } from './graph';
import { BUS_TIME_FACTOR, NET_TIME, RAMP_BY_NET, RAMP_PENALTY, SUBWAY_TIME } from './params';

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
/** min free-flow time of any road cell: every road edge costs at least this (BPR factor >= 1) */
const MIN_ROAD_T = Math.min(NET_TIME[1], NET_TIME[2], NET_TIME[3], NET_TIME[4], NET_TIME[5]);
/** bucket width for road searches (must be <= the minimum edge cost for exactness) */
const Q = MIN_ROAD_T * 0.999;

/**
 * Road graph search. adj = g.fwd (forward search from seeds = origins) or g.rev (reverse search: distances TO the
 * seeds = destinations). Edge a->b cost = (time[a] + time[b]) / 2 (+ ramp penalty on highway <-> road).
 * `limit` stops the search once labels exceed it (unsettled nodes are unreachable).
 * `ramp` (WP7-10, traffic's own searches): per-node interchange minutes; a highway <-> non-highway move then costs
 * ramp[non-highway node] (its ramp class x congestion) instead of the flat RAMP_PENALTY (other systems' searches).
 */
export function roadSearch(g: RoadGraph, adj: Int32Array, time: Float32Array, S: Search, _heap: MinHeap, seeds: Seeds, limit = 400,
  ramp: Float32Array | null = null): void {
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
        if (hu !== (type[v] === HW)) c += ramp === null ? RAMP_PENALTY : ramp[hu ? v : u];
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
 *  node ids [0,nR) road nodes (bus riding), [nR,nR+nRail) rail nodes, [nR+nRail,nR+nRail+nSub) subway nodes,
 *  [nR+nRail+nSub,total) ferry nodes (one per linked ferry terminal, WP7-9: no grid adjacency, only transfers),
 *  plus transfer edges (CSR) between stops of different modes and the ferry links (ferry node <-> ferry node).
 */
export interface TransitNet {
  nR: number;
  nRail: number;
  nSub: number;
  /** ferry nodes (linked terminals) */
  nFerry: number;
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

/** bucket width for the transit net: min in-vehicle edge cost (subway / rail / bus-on-road; transfers cost more) */
const QT = Math.min(SUBWAY_TIME, NET_TIME[6], MIN_ROAD_T * BUS_TIME_FACTOR) * 0.999;

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
  const nR = T.nR, nRR = T.nR + T.nRail, nGrid = nRR + T.nSub;
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
      // ferry nodes (>= nGrid) have no grid adjacency: only transfers / ferry links below
      for (let k = u < nGrid ? 0 : 4; k < 4; k++) {
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

// ---------------------------------------------------------------------------------------------- K-label search (WP7b)
/**
 * K-label road search (WP7b park & ride): like roadSearch (adj = g.rev: minutes TO the seeds; per-node `time`, interchange
 * minutes `ramp` — null: the free-flow RAMP_BY_NET of the non-highway cell), but every node settles the best labels of
 * up to K distinct seed groups (groupOf[seed id]; a pooled garage group counts once) — the options a commuter has when a
 * garage is full; a label more than `margin` minutes behind the node's best is dropped (an option nobody would take:
 * gaps only grow along a path, so this prunes exactly, like the K limit — K better groups at a node are K better groups
 * at every node whose path runs through it). A move whose free-flow minutes (g.t0, interchange RAMP_BY_NET) from the
 * seed would exceed ffMax is dropped (the car leg limit), so a node's labels come from garages within reach. Along each
 * label's path the search also adds up `time2` / `ramp2` (alt: park & ride ranks by free-flow minutes — options that do
 * not move with congestion — and chooses by the congested minutes alt; refreshAlt() renews them on a kept forest, or
 * markAlt() + altAt() on demand along the parent chains of the states used). Dial
 * buckets with the entry payload; labels within one bucket width (< 0.04 min) may settle in either order. Resumable:
 * start() then run(maxStates) until it returns true (the caller spreads a big search over scheduler steps; nothing the
 * search reads may change between).
 * Result: state s = K v + k (k = settle order at v: k = 0 is the node's best), dist (minutes incl. the seed label), src
 * (seed id), grp (its group), next (parent state toward the seed, -1 at a seed), ff (free-flow minutes to the seed), alt
 * (time2 minutes to the seed; 0 without time2); cnt[v] = settled labels of v; order = settled states in label order
 * (flows: walk it backwards).
 */
export class SearchK {
  /** labels per node (1..8) */
  readonly K: number;
  n = 0;
  dist: Float32Array<ArrayBuffer> = new Float32Array(0);
  src: Int32Array<ArrayBuffer> = new Int32Array(0);
  grp: Int32Array<ArrayBuffer> = new Int32Array(0);
  next: Int32Array<ArrayBuffer> = new Int32Array(0);
  ff: Float32Array<ArrayBuffer> = new Float32Array(0);
  alt: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** node of each settled state (= floor(s / K); kept so passes over the states need no division) */
  node: Int32Array<ArrayBuffer> = new Int32Array(0);
  cnt: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  order: Int32Array<ArrayBuffer> = new Int32Array(0);
  settled = 0;
  /** version of the graph this search ran on */
  graphVersion = -1;
  /** a started search has buckets left (run() continues it) */
  running = false;
  /** lazy alt: the states whose alt is of the current time2 / ramp2 (= altTick; settling stamps them), a chain buffer */
  private altStamp: Int32Array<ArrayBuffer> = new Int32Array(0);
  private altTick = 0;
  private altPath: Int32Array<ArrayBuffer> = new Int32Array(64);
  /** tentative best labels of K distinct groups per node (K v .. K v + K - 1, ascending): pruning */
  private tb: Float32Array<ArrayBuffer> = new Float32Array(0);
  private tg: Int32Array<ArrayBuffer> = new Int32Array(0);
  // queue: bucket heads, entries (next in bucket, node, seed id, parent state, label, free-flow minutes, time2 minutes)
  private head: Int32Array<ArrayBuffer> = new Int32Array(0);
  private enext: Int32Array<ArrayBuffer> = new Int32Array(0);
  private enode: Int32Array<ArrayBuffer> = new Int32Array(0);
  private esrc: Int32Array<ArrayBuffer> = new Int32Array(0);
  private epar: Int32Array<ArrayBuffer> = new Int32Array(0);
  private elab: Float32Array<ArrayBuffer> = new Float32Array(0);
  private eff: Float32Array<ArrayBuffer> = new Float32Array(0);
  private ealt: Float32Array<ArrayBuffer> = new Float32Array(0);
  private en = 0;
  // run state
  private g: RoadGraph | null = null;
  private adj: Int32Array = new Int32Array(0);
  private time: Float32Array = new Float32Array(0);
  private ramp: Float32Array | null = null;
  private time2: Float32Array | null = null;
  private ramp2: Float32Array | null = null;
  private groupOf: ArrayLike<number> = [];
  private limit = 0;
  private ffMax = 0;
  private margin = 0;
  private nb = 0;
  private b = 0;
  /** entry to continue with in bucket b (-2 = bucket not opened yet) */
  private e = -2;

  constructor(K = 2) {
    this.K = Math.max(1, Math.min(8, K | 0));
  }

  private reset(n: number): void {
    const K = this.K;
    if (this.cnt.length < n) {
      const c = n + (n >> 2) + 16;
      this.dist = new Float32Array(K * c); this.src = new Int32Array(K * c); this.grp = new Int32Array(K * c);
      this.next = new Int32Array(K * c); this.ff = new Float32Array(K * c); this.alt = new Float32Array(K * c); this.order = new Int32Array(K * c);
      this.node = new Int32Array(K * c);
      this.altStamp = new Int32Array(K * c);
      this.tb = new Float32Array(K * c); this.tg = new Int32Array(K * c);
      this.cnt = new Uint8Array(c);
    }
    // (released by releaseScratch)
    if (this.tb.length < K * n) { this.tb = new Float32Array(this.dist.length); this.tg = new Int32Array(this.dist.length); }
    this.n = n;
    this.cnt.fill(0, 0, n);
    this.tb.fill(Infinity, 0, K * n);
    this.tg.fill(-1, 0, K * n);
    this.settled = 0;
  }

  private growQ(c: number): void {
    const g32 = (a: Int32Array<ArrayBuffer>) => { const b = new Int32Array(c); b.set(a.subarray(0, Math.min(a.length, c))); return b; };
    const gf = (a: Float32Array<ArrayBuffer>) => { const b = new Float32Array(c); b.set(a.subarray(0, Math.min(a.length, c))); return b; };
    this.enext = g32(this.enext); this.enode = g32(this.enode); this.esrc = g32(this.esrc); this.epar = g32(this.epar);
    this.elab = gf(this.elab); this.eff = gf(this.eff); this.ealt = gf(this.ealt);
  }

  /**
   * a label nd of group gr reaching node v: within the margin of the node's (tentative) best, and among the K best
   * distinct-group labels offered so far? (keeps the tentative list sorted)
   */
  private offer(v: number, nd: number, gr: number): boolean {
    const K = this.K, tb = this.tb, tg = this.tg, b = K * v;
    if (nd > tb[b] + this.margin) return false;
    let i = 0;
    while (i < K && tg[b + i] !== gr && tg[b + i] >= 0) i++;
    let j: number;
    if (i < K && tg[b + i] === gr) {
      // the group's own entry: an improvement moves it up
      if (!(nd < tb[b + i])) return false;
      j = i;
    } else {
      // a new group: better than the K-th (or a free slot); the last entry drops out
      if (!(nd < tb[b + K - 1])) return false;
      j = K - 1;
    }
    while (j > 0 && tb[b + j - 1] > nd) { tb[b + j] = tb[b + j - 1]; tg[b + j] = tg[b + j - 1]; j--; }
    tb[b + j] = nd;
    tg[b + j] = gr;
    return true;
  }

  private push(bi: number, v: number, q: number, par: number, lab: number, ff: number, alt: number): void {
    const x = this.en++;
    if (x >= this.enext.length) this.growQ(this.enext.length * 2 + 16);
    this.enode[x] = v; this.esrc[x] = q; this.epar[x] = par; this.elab[x] = lab; this.eff[x] = ff; this.ealt[x] = alt;
    this.enext[x] = this.head[bi];
    this.head[bi] = x;
  }

  /** reset and seed a search (see the class); run() does the work */
  start(g: RoadGraph, adj: Int32Array, time: Float32Array, seeds: Seeds, groupOf: ArrayLike<number>, limit: number,
    ramp: Float32Array | null, ffMax: number, margin: number, time2: Float32Array | null = null, ramp2: Float32Array | null = null): void {
    const n = g.n;
    this.reset(n);
    this.graphVersion = g.version;
    this.g = g; this.adj = adj; this.time = time; this.ramp = ramp; this.groupOf = groupOf;
    this.time2 = time2; this.ramp2 = ramp2;
    this.limit = limit < 2000 ? limit : 2000;
    this.ffMax = ffMax;
    this.margin = margin;
    const invQ = 1 / Q;
    this.nb = Math.ceil(this.limit * invQ) + 2;
    if (this.head.length < this.nb) this.head = new Int32Array(this.nb + 64);
    this.head.fill(-1, 0, this.nb);
    const want = (this.K + 1) * n + seeds.n + 16;
    if (this.enext.length < want) this.growQ(want);
    this.en = 0;
    this.b = 0;
    this.e = -2;
    for (let s = 0; s < seeds.n; s++) {
      const v = seeds.node[s], l = seeds.label[s], id = seeds.id[s];
      if (v < 0 || v >= n || !(l <= this.limit)) continue;
      if (this.offer(v, l, groupOf[id])) this.push((l * invQ) | 0, v, id, -1, l, 0, 0);
    }
    this.running = true;
    this.nextAltTick();
  }

  /** settle at most maxStates more states; true = the search is complete */
  run(maxStates: number): boolean {
    if (!this.running) return true;
    const K = this.K, g = this.g!, adj = this.adj, time = this.time, ramp = this.ramp, groupOf = this.groupOf;
    const time2 = this.time2, ramp2 = this.ramp2;
    const limit = this.limit, ffMax = this.ffMax, margin = this.margin, nb = this.nb, invQ = 1 / Q;
    const dist = this.dist, src = this.src, grp = this.grp, next = this.next, ff = this.ff, alt = this.alt, cnt = this.cnt, order = this.order;
    const snode = this.node, altStamp = this.altStamp, altTick = this.altTick;
    const type = g.type, t0 = g.t0, HW = Network.Highway, head = this.head;
    let m = this.settled, b = this.b, e = this.e;
    const stop = m + maxStates;
    for (; b < nb; b++, e = -2) {
      if (e === -2) e = head[b];
      while (e >= 0) {
        if (m >= stop) { this.b = b; this.e = e; this.settled = m; return false; }
        const u = this.enode[e], q = this.esrc[e], par = this.epar[e], key = this.elab[e], fu = this.eff[e], au = this.ealt[e];
        e = this.enext[e];
        const c0 = cnt[u];
        if (c0 >= K) continue;
        const gr = groupOf[q], bu = K * u;
        if (c0 > 0) {
          if (key > dist[bu] + margin) continue;
          let dup = false;
          for (let k = 0; k < c0; k++) if (grp[bu + k] === gr) { dup = true; break; }
          if (dup) continue;
        }
        const s = bu + c0;
        cnt[u] = c0 + 1;
        dist[s] = key; src[s] = q; grp[s] = gr; next[s] = par; ff[s] = fu; alt[s] = au; snode[s] = u; altStamp[s] = altTick;
        order[m++] = s;
        const tu = time[u], fu0 = t0[u], tu2 = time2 !== null ? time2[u] : 0;
        const hu = type[u] === HW;
        const base = u * 4;
        for (let k = 0; k < 4; k++) {
          const v = adj[base + k];
          if (v < 0 || cnt[v] >= K) continue;
          // (a group settled at v is never offered again: its tentative entry there is at most its settled label,
          // which is below anything reaching v later — offer() rejects it)
          let c = 0.5 * (tu + time[v]), cf = 0.5 * (fu0 + t0[v]), c2 = time2 !== null ? 0.5 * (tu2 + time2[v]) : 0;
          if (hu !== (type[v] === HW)) {
            const r = hu ? v : u, rf = RAMP_BY_NET[type[r]] ?? RAMP_PENALTY;
            c += ramp === null ? rf : ramp[r];
            cf += rf;
            if (time2 !== null) c2 += ramp2 === null ? rf : ramp2[r];
          }
          const nd = key + c, nf = fu + cf;
          if (!(nd <= limit) || nf > ffMax) continue;
          if (!this.offer(v, nd, gr)) continue;
          const bi = (nd * invQ) | 0;
          this.push(bi > b ? bi : b + 1, v, q, s, nd, nf, au + c2);
        }
      }
      head[b] = -1;
    }
    this.b = nb;
    this.e = -2;
    this.settled = m;
    this.running = false;
    return true;
  }

  /** recompute alt along the kept forest from new time2 / ramp2 (parents settle before their children: one pass) */
  refreshAlt(time2: Float32Array, ramp2: Float32Array | null): void {
    const g = this.g;
    if (!g || this.running) return;
    const order = this.order, next = this.next, alt = this.alt, snode = this.node, type = g.type, HW = Network.Highway;
    this.time2 = time2; this.ramp2 = ramp2;
    this.nextAltTick();
    const altStamp = this.altStamp, tick = this.altTick;
    for (let k = 0, n = this.settled; k < n; k++) altStamp[order[k]] = tick;
    for (let k = 0, n = this.settled; k < n; k++) {
      const s = order[k], p = next[s];
      if (p < 0) { alt[s] = 0; continue; }
      const v = snode[s], u = snode[p];
      let c = alt[p] + 0.5 * (time2[u] + time2[v]);
      const tu = type[u], tv = type[v];
      if ((tu === HW) !== (tv === HW)) { const r = tu === HW ? v : u; c += ramp2 === null ? (RAMP_BY_NET[type[r]] ?? RAMP_PENALTY) : ramp2[r]; }
      alt[s] = c;
    }
  }

  /** a complete search kept for its result only (a cache of forests): drop the queue and the tentative labels (about
   *  half its memory); start() allocates them again */
  releaseScratch(): void {
    if (this.running) return;
    this.tb = new Float32Array(0); this.tg = new Int32Array(0); this.head = new Int32Array(0);
    this.enext = new Int32Array(0); this.enode = new Int32Array(0); this.esrc = new Int32Array(0); this.epar = new Int32Array(0);
    this.elab = new Float32Array(0); this.eff = new Float32Array(0); this.ealt = new Float32Array(0);
  }

  /** new time2 / ramp2 for alt on a kept forest, renewed on demand (altAt): a caller that reads few states' alt skips
   *  refreshAlt's pass over the whole forest */
  markAlt(time2: Float32Array, ramp2: Float32Array | null): void {
    if (!this.g || this.running) return;
    this.time2 = time2; this.ramp2 = ramp2;
    this.nextAltTick();
  }

  /** alt of settled state s with the time2 / ramp2 of the last search, refreshAlt or markAlt (its parent chain renewed
   *  up to the first current state; the same sums as refreshAlt) */
  altAt(s: number): number {
    const altStamp = this.altStamp, tick = this.altTick, alt = this.alt;
    if (altStamp[s] === tick) return alt[s];
    const g = this.g!, next = this.next, snode = this.node, type = g.type, HW = Network.Highway, time2 = this.time2, ramp2 = this.ramp2;
    // (the chain from s up to a current state or a seed, then down again)
    let path = this.altPath, n = 0, x = s;
    while (x >= 0 && altStamp[x] !== tick) {
      if (n >= path.length) { const b = new Int32Array(path.length * 2); b.set(path); path = this.altPath = b; }
      path[n++] = x;
      x = next[x];
    }
    for (let i = n - 1; i >= 0; i--) {
      const t = path[i], p = next[t];
      if (p < 0 || time2 === null) { alt[t] = 0; altStamp[t] = tick; continue; }
      const v = snode[t], u = snode[p];
      let c = alt[p] + 0.5 * (time2[u] + time2[v]);
      const tu = type[u], tv = type[v];
      if ((tu === HW) !== (tv === HW)) { const r = tu === HW ? v : u; c += ramp2 === null ? (RAMP_BY_NET[type[r]] ?? RAMP_PENALTY) : ramp2[r]; }
      alt[t] = c;
      altStamp[t] = tick;
    }
    return alt[s];
  }

  private nextAltTick(): void {
    if (++this.altTick >= 0x3fffffff) { this.altStamp.fill(0); this.altTick = 1; }
  }
}

/** a complete K-label search in one call (SearchK.start + run) */
export function roadSearchK(g: RoadGraph, adj: Int32Array, time: Float32Array, S: SearchK, seeds: Seeds, groupOf: ArrayLike<number>,
  limit: number, ramp: Float32Array | null, ffMax: number, margin: number): void {
  S.start(g, adj, time, seeds, groupOf, limit, ramp, ffMax, margin);
  S.run(Infinity);
}
