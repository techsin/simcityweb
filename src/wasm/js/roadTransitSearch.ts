/**
 * FAIR optimised-JS baseline for the road / transit searches (benchmark control; the game runs
 * src/sim/infra/search.ts or its wasm binding). Same algorithm and bit-identical results as search.ts, with every
 * restructuring the Rust port (wasm/sim-kernels/src/search.rs) uses, written as fast plain JS:
 *  - the Dial bucket queue is inlined: head / entry arrays in local variables, no BucketQueue method calls, no
 *    `this.` loads per push / pop;
 *  - the entry capacity (seeds + 4 x nodes [+ transfers] pushes at most) is reserved before the loop, so the push
 *    has no growth check;
 *  - entries are (node, next) pairs in ONE Int32Array (the Rust layout; measured faster than two arrays in wasm —
 *    tools/bench/roadTransitSearch.bench.mjs reports the JS side of that choice as well);
 *  - constants (1 / Q, the highway id, the ramp penalty) hoisted; the transit mode test hoisted out of the 4-slot loop.
 * If wasm only beat the original search.ts, part of the gain could be this restructuring; wasm must beat THIS.
 *
 * Supports the live search.ts extensions (per-node `ramp` minutes, ferry nodes) like the Rust kernels.
 */
import type * as JsSearch from '../../sim/infra/search';
import type { RoadGraph } from '../../sim/infra/graph';
import type { SearchParams } from '../kernels/searchBind';

type Search = JsSearch.Search;
type Seeds = JsSearch.Seeds;
type TransitNet = JsSearch.TransitNet;

export interface FairSearch {
  roadSearch(g: RoadGraph, adj: Int32Array, time: Float32Array, S: Search, heap: unknown, seeds: Seeds, limit?: number, ramp?: Float32Array | null): void;
  transitSearch(T: TransitNet, S: Search, heap: unknown, seeds: Seeds, limit?: number): void;
  accumulate(S: Search, acc: Float32Array | Float64Array, onSink?: (seedId: number, flow: number, node: number) => void): void;
  /** variant with the JS BucketQueue's layout (separate node / next arrays) for the layout comparison */
  roadSearchSplit(g: RoadGraph, adj: Int32Array, time: Float32Array, S: Search, heap: unknown, seeds: Seeds, limit?: number): void;
}

export function makeFairSearch(p: SearchParams): FairSearch {
  const MIN_ROAD_T = Math.min(p.NET_TIME[1], p.NET_TIME[2], p.NET_TIME[3], p.NET_TIME[4], p.NET_TIME[5]);
  const Q = MIN_ROAD_T * 0.999;
  const QT = Math.min(p.SUBWAY_TIME, p.NET_TIME[6], MIN_ROAD_T * p.BUS_TIME_FACTOR) * 0.999;
  const RAMP_PENALTY = p.RAMP_PENALTY;
  const HW = p.HIGHWAY;
  let head = new Int32Array(1024);
  let ent = new Int32Array(1024);
  let enode = new Int32Array(1024);
  let enext = new Int32Array(1024);

  function roadSearch(g: RoadGraph, adj: Int32Array, time: Float32Array, S: Search, _heap: unknown, seeds: Seeds, limit = 400, ramp: Float32Array | null = null): void {
    const n = g.n;
    S.reset(n);
    S.graphVersion = g.version;
    const dist = S.dist, src = S.src, next = S.next, hops = S.hops, order = S.order, done = S.done;
    if (!(limit < 2000)) limit = 2000;
    const invQ = 1 / Q;
    const nb = Math.ceil(limit * invQ) + 2;
    if (head.length < nb) head = new Int32Array(nb + 64);
    const H = head;
    H.fill(-1, 0, nb);
    const ns = seeds.n;
    const need = 2 * (ns + 4 * n) + 16;
    if (ent.length < need) ent = new Int32Array(need + (need >> 2));
    const E = ent;
    let en = 0;
    const sNode = seeds.node, sLabel = seeds.label, sId = seeds.id;
    for (let s = 0; s < ns; s++) {
      const v = sNode[s];
      const l = sLabel[s];
      if (v < 0 || v >= n || !(l <= limit)) continue;
      if (l < dist[v]) {
        dist[v] = l;
        src[v] = sId[s];
        next[v] = -1;
        hops[v] = 0;
        const b = (l * invQ) | 0;
        if (b >= 0 && b < nb) { E[2 * en] = v; E[2 * en + 1] = H[b]; H[b] = en++; }
      }
    }
    const type = g.type;
    const useRamp = ramp !== null;
    const rp = ramp ?? time;
    let cnt = 0;
    for (let b = 0; b < nb; b++) {
      let e = H[b];
      while (e >= 0) {
        const u = E[2 * e];
        e = E[2 * e + 1];
        if (done[u] === 1) continue;
        done[u] = 1;
        order[cnt++] = u;
        const key = dist[u];
        const tu = time[u];
        const hu = type[u] === HW;
        const su = src[u];
        let hp = hops[u] + 1;
        if (hp > 65535) hp = 65535;
        const base = u * 4;
        for (let k = 0; k < 4; k++) {
          const v = adj[base + k];
          if (v < 0 || done[v] === 1) continue;
          let c = 0.5 * (tu + time[v]);
          if (hu !== (type[v] === HW)) c += useRamp ? rp[hu ? v : u] : RAMP_PENALTY;
          const nd = key + c;
          if (nd < dist[v] && nd <= limit) {
            dist[v] = nd;
            src[v] = su;
            next[v] = u;
            hops[v] = hp;
            const bi = (nd * invQ) | 0;
            const bb = bi > b ? bi : b + 1;
            if (bb < nb) { E[2 * en] = v; E[2 * en + 1] = H[bb]; H[bb] = en++; }
          }
        }
      }
      H[b] = -1;
    }
    S.settled = cnt;
  }

  function roadSearchSplit(g: RoadGraph, adj: Int32Array, time: Float32Array, S: Search, _heap: unknown, seeds: Seeds, limit = 400): void {
    const n = g.n;
    S.reset(n);
    S.graphVersion = g.version;
    const dist = S.dist, src = S.src, next = S.next, hops = S.hops, order = S.order, done = S.done;
    if (!(limit < 2000)) limit = 2000;
    const invQ = 1 / Q;
    const nb = Math.ceil(limit * invQ) + 2;
    if (head.length < nb) head = new Int32Array(nb + 64);
    const H = head;
    H.fill(-1, 0, nb);
    const ns = seeds.n;
    const need = ns + 4 * n + 16;
    if (enode.length < need) { enode = new Int32Array(need + (need >> 2)); enext = new Int32Array(need + (need >> 2)); }
    const EN = enode, EX = enext;
    let en = 0;
    for (let s = 0; s < ns; s++) {
      const v = seeds.node[s];
      const l = seeds.label[s];
      if (v < 0 || v >= n || !(l <= limit)) continue;
      if (l < dist[v]) {
        dist[v] = l; src[v] = seeds.id[s]; next[v] = -1; hops[v] = 0;
        const b = (l * invQ) | 0;
        if (b >= 0 && b < nb) { EN[en] = v; EX[en] = H[b]; H[b] = en++; }
      }
    }
    const type = g.type;
    let cnt = 0;
    for (let b = 0; b < nb; b++) {
      let e = H[b];
      while (e >= 0) {
        const u = EN[e];
        e = EX[e];
        if (done[u] === 1) continue;
        done[u] = 1;
        order[cnt++] = u;
        const key = dist[u], tu = time[u], hu = type[u] === HW, su = src[u];
        let hp = hops[u] + 1;
        if (hp > 65535) hp = 65535;
        const base = u * 4;
        for (let k = 0; k < 4; k++) {
          const v = adj[base + k];
          if (v < 0 || done[v] === 1) continue;
          let c = 0.5 * (tu + time[v]);
          if (hu !== (type[v] === HW)) c += RAMP_PENALTY;
          const nd = key + c;
          if (nd < dist[v] && nd <= limit) {
            dist[v] = nd; src[v] = su; next[v] = u; hops[v] = hp;
            const bi = (nd * invQ) | 0;
            const bb = bi > b ? bi : b + 1;
            if (bb < nb) { EN[en] = v; EX[en] = H[bb]; H[bb] = en++; }
          }
        }
      }
      H[b] = -1;
    }
    S.settled = cnt;
  }

  function transitSearch(T: TransitNet, S: Search, _heap: unknown, seeds: Seeds, limit = 400): void {
    const n = T.total;
    S.reset(n);
    const dist = S.dist, src = S.src, next = S.next, hops = S.hops, order = S.order, done = S.done;
    if (!(limit < 2000)) limit = 2000;
    const invQ = 1 / QT;
    const nb = Math.ceil(limit * invQ) + 2;
    if (head.length < nb) head = new Int32Array(nb + 64);
    const H = head;
    H.fill(-1, 0, nb);
    const ns = seeds.n;
    const nTr = T.trStart[n] | 0;
    const need = 2 * (ns + 4 * n + nTr) + 16;
    if (ent.length < need) ent = new Int32Array(need + (need >> 2));
    const E = ent;
    let en = 0;
    const sNode = seeds.node, sLabel = seeds.label, sId = seeds.id;
    for (let s = 0; s < ns; s++) {
      const v = sNode[s];
      const l = sLabel[s];
      if (v < 0 || v >= n || !(l <= limit)) continue;
      if (l < dist[v]) {
        dist[v] = l; src[v] = sId[s]; next[v] = -1; hops[v] = 0;
        const b = (l * invQ) | 0;
        if (b >= 0 && b < nb) { E[2 * en] = v; E[2 * en + 1] = H[b]; H[b] = en++; }
      }
    }
    const nR = T.nR, nRR = T.nR + T.nRail, nGrid = nRR + T.nSub;
    const roadAdj = T.roadAdj, busTime = T.busTime, railAdj = T.railAdj, subAdj = T.subAdj;
    const trStart = T.trStart, trTo = T.trTo, trCost = T.trCost;
    const railTime = T.railTime, subTime = T.subTime;
    let cnt = 0;
    for (let b = 0; b < nb; b++) {
      let e = H[b];
      while (e >= 0) {
        const u = E[2 * e];
        e = E[2 * e + 1];
        if (done[u] === 1) continue;
        done[u] = 1;
        order[cnt++] = u;
        const key = dist[u];
        const su = src[u];
        const hp = Math.min(65535, hops[u] + 1);
        if (u < nR) {
          const tu = busTime[u];
          for (let k = 0; k < 4; k++) {
            const v = roadAdj[u * 4 + k];
            if (v < 0 || done[v] === 1) continue;
            const nd = key + 0.5 * (tu + busTime[v]);
            if (nd < dist[v] && nd <= limit) {
              dist[v] = nd; src[v] = su; next[v] = u; hops[v] = hp;
              const bi = (nd * invQ) | 0;
              const bb = bi > b ? bi : b + 1;
              if (bb < nb) { E[2 * en] = v; E[2 * en + 1] = H[bb]; H[bb] = en++; }
            }
          }
        } else if (u < nRR) {
          const nd = key + railTime;
          const base = (u - nR) * 4;
          for (let k = 0; k < 4; k++) {
            const a = railAdj[base + k];
            if (a < 0) continue;
            const v = a + nR;
            if (done[v] === 1) continue;
            if (nd < dist[v] && nd <= limit) {
              dist[v] = nd; src[v] = su; next[v] = u; hops[v] = hp;
              const bi = (nd * invQ) | 0;
              const bb = bi > b ? bi : b + 1;
              if (bb < nb) { E[2 * en] = v; E[2 * en + 1] = H[bb]; H[bb] = en++; }
            }
          }
        } else if (u < nGrid) {
          const nd = key + subTime;
          const base = (u - nRR) * 4;
          for (let k = 0; k < 4; k++) {
            const a = subAdj[base + k];
            if (a < 0) continue;
            const v = a + nRR;
            if (done[v] === 1) continue;
            if (nd < dist[v] && nd <= limit) {
              dist[v] = nd; src[v] = su; next[v] = u; hops[v] = hp;
              const bi = (nd * invQ) | 0;
              const bb = bi > b ? bi : b + 1;
              if (bb < nb) { E[2 * en] = v; E[2 * en + 1] = H[bb]; H[bb] = en++; }
            }
          }
        }
        for (let t = trStart[u], t1 = trStart[u + 1]; t < t1; t++) {
          const v = trTo[t];
          if (done[v] === 1) continue;
          const nd = key + trCost[t];
          if (nd < dist[v] && nd <= limit) {
            dist[v] = nd; src[v] = su; next[v] = u; hops[v] = hp;
            const bi = (nd * invQ) | 0;
            const bb = bi > b ? bi : b + 1;
            if (bb < nb) { E[2 * en] = v; E[2 * en + 1] = H[bb]; H[bb] = en++; }
          }
        }
      }
      H[b] = -1;
    }
    S.settled = cnt;
  }

  /** the forest walk has nothing to restructure (search.ts is already a tight typed-array loop); split by onSink */
  function accumulate(S: Search, acc: Float32Array | Float64Array, onSink?: (seedId: number, flow: number, node: number) => void): void {
    const order = S.order, next = S.next, src = S.src;
    if (!onSink) {
      for (let k = S.settled - 1; k >= 0; k--) {
        const v = order[k];
        const f = acc[v];
        if (f === 0) continue;
        const nx = next[v];
        if (nx >= 0) acc[nx] += f;
      }
      return;
    }
    for (let k = S.settled - 1; k >= 0; k--) {
      const v = order[k];
      const f = acc[v];
      if (f === 0) continue;
      const nx = next[v];
      if (nx >= 0) acc[nx] += f;
      else onSink(src[v], f, v);
    }
  }

  return { roadSearch, transitSearch, accumulate, roadSearchSplit };
}
