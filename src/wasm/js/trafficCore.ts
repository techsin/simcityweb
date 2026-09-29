/**
 * FAIR optimised-JS baseline of the traffic core (benchmark control, and the wasm binding's fallback). The numeric
 * phases of TrafficSystem (src/sim/infra/traffic.ts at commit 24f8609) as plain JS kernels with the SAME algorithm,
 * data layout and restructuring as the Rust port (wasm/sim-kernels/src/traffic.rs), so an A/B against the wasm core
 * isolates the language:
 *  - the candidate sort is an LSD radix sort (11-bit digits, trivial passes skipped) on k = floor(max(0, g) * q),
 *    stable over the candidates in origin order — the same order as traffic.ts's Float64Array.prototype.sort of the
 *    packed keys k * M + o (distinct integers < 2^50); keys are held as two Uint32 halves;
 *  - stop x / z are precomputed once per cycle (no % and / per stop and query);
 *  - the sampled car pieces of a round go to preallocated Int32 / Float64 buffers of 256 (Float64: the weights feed
 *    the cumulative sum of the route sampling, so they must stay exact);
 *  - poolRemaining / inbound / shopping reuse scratch arrays instead of allocating per cycle; seeds are built straight
 *    into typed arrays; the forest walks (accumulate) are inlined like in Rust; the transfer CSR is built without the
 *    intermediate JS arrays (the edge sequence is generated twice).
 * Arithmetic and loop orders are the original ones: they carry the bit-exactness (tests/wasm/trafficCore.test.ts).
 * Searches: the fair optimised-JS road / transit searches (src/wasm/js/roadTransitSearch.ts).
 */
import type { FairSearch } from './roadTransitSearch';
import {
  BYTES, CTOR, HIST_WORDS, ROUTE_MAX, TRAFFIC_ARRAYS, newArraysObject, newCounts,
  type ArrDef, type Cls, type GridGraphLike, type LayersLike, type RoadGraphLike, type TrafficArrays, type TrafficCoreApi, type TrafficCounts,
  type TrafficParams, type TrafficScalars,
} from '../kernels/trafficLayout';

/** the arrays with their types (see TRAFFIC_ARRAYS) */
export interface Arrs {
  subwayRiders: Float32Array;
  nodeTime: Float32Array; volNew: Float32Array; acc: Float32Array; busTime: Float32Array; volInbound: Float32Array; volShop: Float32Array;
  volFreight: Float32Array; nodeQ: Int32Array;
  tAcc: Float32Array; nodeStop: Int32Array; trStart: Int32Array; railNew: Float32Array; subNew: Float32Array;
  saDist: Float64Array; saSrc: Int32Array; saNext: Int32Array; saOrder: Int32Array; saHops: Uint16Array; saDone: Uint8Array;
  stDist: Float64Array; stSrc: Int32Array; stNext: Int32Array; stOrder: Int32Array; stHops: Uint16Array; stDone: Uint8Array;
  sbDist: Float64Array; sbSrc: Int32Array; sbNext: Int32Array; sbOrder: Int32Array; sbHops: Uint16Array; sbDone: Uint8Array;
  seedNode: Int32Array; seedLabel: Float64Array; seedId: Int32Array;
  oBid: Int32Array; oW: Float32Array; oPop: Float32Array; oWealth: Uint8Array; oEntS: Int32Array; oEntC: Uint8Array; oCell: Int32Array;
  oHalf: Uint8Array; oCarNode: Int32Array; oBoard: Int32Array; oShC: Float32Array; oShT: Float32Array; oShW: Float32Array; oTime: Float32Array;
  oEmp: Float32Array; oJobT: Int32Array; oU: Float32Array; oAsg: Float32Array; oTimeSum: Float32Array; oCarW: Float32Array; oTrW: Float32Array;
  oWalkW: Float32Array; oTrT: Float32Array; oBoardStop: Int32Array; oLastD: Float32Array; candNode: Int32Array; sortA: Int32Array; sortB: Int32Array;
  jBid: Int32Array; jSlots: Float32Array; jNoise: Float32Array; jAsg: Float32Array; jCapP: Float32Array; jPrice: Float32Array; jQ: Int32Array;
  jBase: Float32Array; jEntS: Int32Array; jEntC: Uint8Array; jCell: Int32Array; jHalf: Uint8Array; jRailNode: Int32Array; jConnType: Uint8Array;
  jTimeSum: Float32Array; jInbound: Float32Array; jTmp: Float32Array; desire: Float32Array; bestNode: Int32Array; inCand: Int32Array;
  conns: Int32Array; scale: Float32Array; connSum: Float64Array;
  qNode: Int32Array; qSlots: Float32Array; qCapP: Float32Array; qAsg: Float32Array; qPrice: Float32Array; qProp: Float32Array; qBase: Float32Array;
  qNoise: Float32Array; qTimeSum: Float32Array;
  sBid: Int32Array; sEntS: Int32Array; sEntC: Uint8Array; sLoad: Float32Array;
  fBid: Int32Array; fTrucks: Float32Array; fEntS: Int32Array; fEntC: Uint8Array; fAcc: Float32Array; fNode: Int32Array;
  kEntS: Int32Array; kEntC: Uint8Array; kLabel: Float32Array;
  stCell: Int32Array; stX: Int32Array; stZ: Int32Array; stMode: Uint8Array; stAttS: Int32Array; stAttC: Uint8Array; stAtt: Int32Array;
  stWait: Float32Array; stLoad: Float32Array; stopBins: Int32Array; stopBinStart: Int32Array; binFill: Int32Array; nsIdx: Int32Array;
  nsDist: Float32Array; trTo: Int32Array; trCost: Float32Array; trEFrom: Int32Array; trETo: Int32Array; trECost: Float32Array;
  ent: Int32Array; poolU: Float64Array; poolO: Float64Array; routeCand: Int32Array; routeW: Float64Array;
}

/**
 * A search whose arrays are the core's arrays (the fair searches call reset() / write the fields). Capacity is the
 * core's responsibility: reset() of a too-small view throws instead of reallocating.
 */
export class SearchView {
  n = 0;
  settled = 0;
  graphVersion = -1;
  dist: Float64Array = new Float64Array(0);
  src: Int32Array = new Int32Array(0);
  next: Int32Array = new Int32Array(0);
  hops: Uint16Array = new Uint16Array(0);
  order: Int32Array = new Int32Array(0);
  done: Uint8Array = new Uint8Array(0);
  ensure(n: number): void {
    if (this.dist.length < n) throw new Error(`SearchView: capacity ${this.dist.length} < ${n}`);
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

/** everything a kernel reads: arrays, counts, scalars, outputs, constants, graphs, layers, searches, scratch */
export interface KernelEnv {
  A: Arrs;
  c: TrafficCounts;
  s: TrafficScalars;
  out: Float64Array;
  P: TrafficParams;
  road: RoadGraphLike;
  rail: GridGraphLike;
  sub: GridGraphLike;
  layers: LayersLike;
  search: FairSearch;
  SA: SearchView;
  ST: SearchView;
  SB: SearchView;
  /** radix sort scratch (key halves ping-pong, histograms) */
  sort: { lo: Uint32Array; hi: Uint32Array; lo2: Uint32Array; hi2: Uint32Array; hist: Int32Array; packed: Float64Array };
  /** seeds object handed to the fair searches (arrays = the seed arrays) */
  seeds: { n: number; node: Int32Array; label: Float64Array; id: Int32Array };
}

/** point the search views / seeds object at the current arrays (after a reallocation) */
export function bindEnvViews(e: KernelEnv): void {
  const A = e.A;
  const set = (S: SearchView, p: 'sa' | 'st' | 'sb') => {
    const a = A as unknown as Record<string, Float64Array & Int32Array & Uint16Array & Uint8Array>;
    S.dist = a[p + 'Dist']; S.src = a[p + 'Src']; S.next = a[p + 'Next']; S.hops = a[p + 'Hops']; S.order = a[p + 'Order']; S.done = a[p + 'Done'];
  };
  set(e.SA, 'sa'); set(e.ST, 'st'); set(e.SB, 'sb');
  e.seeds.node = A.seedNode; e.seeds.label = A.seedLabel; e.seeds.id = A.seedId;
}

// ------------------------------------------------------------------------------------------------ helpers
/** traffic.ts nearStops on precomputed stop x / z: count of stops within R of (x, z) -> nsIdx / nsDist */
function nearStops(A: Arrs, nb: number, x: number, z: number, R: number): number {
  const bx0 = Math.max(0, ((x - R) / 8) | 0), bx1 = Math.min(nb - 1, ((x + R) / 8) | 0);
  const bz0 = Math.max(0, ((z - R) / 8) | 0), bz1 = Math.min(nb - 1, ((z + R) / 8) | 0);
  const R2 = R * R;
  const sx = A.stX, sz = A.stZ, bins = A.stopBins, start = A.stopBinStart, idx = A.nsIdx, dist = A.nsDist;
  let c = 0;
  for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) {
    const bi = bz * nb + bx;
    for (let p = start[bi], p1 = start[bi + 1]; p < p1; p++) {
      const s = bins[p];
      const dx = sx[s] - x, dz = sz[s] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > R2) continue;
      idx[c] = s;
      dist[c] = Math.sqrt(d2);
      c++;
    }
  }
  return c;
}

/**
 * forest walk (accumulate without sink) of search SA (`sa`) or SB over acc, then volNew += acc on the settled nodes.
 * The settled count comes from the counts (the wasm core's searches update c, not the views' `settled`).
 */
function flowsIntoVol(e: KernelEnv, sa: boolean, reset: boolean, cache: Float32Array | null): void {
  const S = sa ? e.SA : e.SB;
  const order = S.order, next = S.next, acc = e.A.acc, vol = e.A.volNew;
  const settled = sa ? e.c.saSettled : e.c.sbSettled;
  for (let k = settled - 1; k >= 0; k--) {
    const v = order[k];
    const f = acc[v];
    if (f === 0) continue;
    const nx = next[v];
    if (nx >= 0) acc[nx] += f;
  }
  if (reset) {
    for (let k = 0; k < settled; k++) {
      const v = order[k];
      const f = acc[v];
      if (f !== 0) { vol[v] += f; acc[v] = 0; }
    }
  } else {
    const cc = cache!;
    for (let k = 0; k < settled; k++) { const v = order[k]; vol[v] += acc[v]; cc[v] = acc[v]; }
  }
}

/** stable LSD radix sort of idx by the keys (lo, hi) (11-bit digits); returns true when the result is in (lo2, hi2, idx2) */
function radixSort(nc: number, maxK: number, lo: Uint32Array, hi: Uint32Array, lo2: Uint32Array, hi2: Uint32Array, idx: Int32Array, idx2: Int32Array, hist: Int32Array): boolean {
  const mHi = Math.floor(maxK / 4294967296), mLo = maxK >>> 0;
  const bits = mHi > 0 ? 64 - Math.clz32(mHi) : 32 - Math.clz32(mLo);
  const passes = Math.ceil(bits / 11);
  hist.fill(0, 0, passes * 2048);
  for (let k = 0; k < nc; k++) {
    const l = lo[k], h = hi[k];
    hist[l & 2047]++;
    if (passes > 1) hist[2048 + ((l >>> 11) & 2047)]++;
    if (passes > 2) hist[4096 + (((l >>> 22) | (h << 10)) & 2047)]++;
    if (passes > 3) hist[6144 + ((h >>> 1) & 2047)]++;
    if (passes > 4) hist[8192 + ((h >>> 12) & 2047)]++;
  }
  let swapped = false;
  for (let p = 0; p < passes; p++) {
    const row = p * 2048;
    const sLo = swapped ? lo2 : lo, sHi = swapped ? hi2 : hi, sIdx = swapped ? idx2 : idx;
    const dLo = swapped ? lo : lo2, dHi = swapped ? hi : hi2, dIdx = swapped ? idx : idx2;
    const s = 11 * p;
    const dig0 = nc > 0 ? (s + 11 <= 32 ? (sLo[0] >>> s) & 2047 : s >= 32 ? (sHi[0] >>> (s - 32)) & 2047 : ((sLo[0] >>> s) | (sHi[0] << (32 - s))) & 2047) : 0;
    if (hist[row + dig0] === nc) continue;
    let sum = 0;
    for (let b = 0; b < 2048; b++) { const t = hist[row + b]; hist[row + b] = sum; sum += t; }
    if (s + 11 <= 32) {
      for (let k = 0; k < nc; k++) { const l = sLo[k]; const pos = hist[row + ((l >>> s) & 2047)]++; dLo[pos] = l; dHi[pos] = sHi[k]; dIdx[pos] = sIdx[k]; }
    } else if (s >= 32) {
      const t = s - 32;
      for (let k = 0; k < nc; k++) { const h = sHi[k]; const pos = hist[row + ((h >>> t) & 2047)]++; dLo[pos] = sLo[k]; dHi[pos] = h; dIdx[pos] = sIdx[k]; }
    } else {
      const t = 32 - s;
      for (let k = 0; k < nc; k++) { const l = sLo[k], h = sHi[k]; const pos = hist[row + (((l >>> s) | (h << t)) & 2047)]++; dLo[pos] = l; dHi[pos] = h; dIdx[pos] = sIdx[k]; }
    }
    swapped = !swapped;
  }
  return swapped;
}

// ------------------------------------------------------------------------------------------------ kernels
/**
 * The kernels (1:1 with traffic.rs). Return values: >= 0 done; -need when a buffer class is too small (no state
 * changed; the core grows and calls again). Outputs go to e.out / e.c like the Rust ones.
 */
export const fairKernels = {
  /** node times from the smoothed volumes (BPR), volNew / railNew / subNew = 0 */
  prepNodes(e: KernelEnv): void {
    const A = e.A, c = e.c, P = e.P, g = e.road;
    const n = c.n;
    const traffic = e.layers.traffic, cellOf = g.cellOf, cap = g.cap, t0 = g.t0, nodeTime = A.nodeTime;
    const alpha = P.bprAlpha, maxf = P.bprMax;
    for (let v = 0; v < n; v++) {
      const r = traffic[cellOf[v]] / cap[v];
      let f = 1 + alpha * r * r * r * r;
      if (f > maxf) f = maxf;
      nodeTime[v] = t0[v] * f;
    }
    A.volNew.fill(0, 0, n);
    A.railNew.fill(0, 0, c.nRail);
    A.subNew.fill(0, 0, c.nSub);
  },

  /** regional sums (out0 workers, out1 city slots, out2 connection slots) + per-cycle origin initialisation */
  prepOrigins(e: KernelEnv): void {
    const A = e.A, c = e.c;
    const oN = c.oN, jN = c.jN, jB = c.jB;
    const oW = A.oW, jSlots = A.jSlots;
    let workers = 0, citySlots = 0, connSlots = 0;
    for (let o = 0; o < oN; o++) workers += oW[o];
    for (let j = 0; j < jB; j++) citySlots += jSlots[j];
    for (let j = jB; j < jN; j++) connSlots += jSlots[j];
    const oU = A.oU, oAsg = A.oAsg, oTimeSum = A.oTimeSum, oCarW = A.oCarW, oTrW = A.oTrW, oWalkW = A.oWalkW, oCarNode = A.oCarNode, oLastD = A.oLastD;
    for (let o = 0; o < oN; o++) {
      oU[o] = oW[o];
      oAsg[o] = 0; oTimeSum[o] = 0; oCarW[o] = 0; oTrW[o] = 0; oWalkW[o] = 0;
      oCarNode[o] = -1;
      oLastD[o] = -1;
    }
    e.out[0] = workers; e.out[1] = citySlots; e.out[2] = connSlots;
  },

  /** jCapP = jSlots x propFactor, then buildClusters -> qN */
  clusters(e: KernelEnv): void {
    const A = e.A, c = e.c;
    const jN = c.jN, n = c.n;
    const jSlots = A.jSlots, jCapP = A.jCapP, pf = e.s.propFactor;
    for (let j = 0; j < jN; j++) jCapP[j] = jSlots[j] * pf;
    const ent = A.ent, jEntS = A.jEntS, jEntC = A.jEntC, jBid = A.jBid, jQ = A.jQ, jPrice = A.jPrice, jBase = A.jBase, jNoise = A.jNoise;
    const qNode = A.qNode, qSlots = A.qSlots, qCapP = A.qCapP, qAsg = A.qAsg, qPrice = A.qPrice, qProp = A.qProp, qBase = A.qBase, qNoise = A.qNoise, qTimeSum = A.qTimeSum;
    const nodeQ = A.nodeQ;
    nodeQ.fill(-1, 0, n);
    let qN = 0;
    for (let j = 0; j < jN; j++) {
      jQ[j] = -1;
      if (jEntC[j] === 0) continue;
      let node = ent[jEntS[j]];
      for (let q = jEntS[j] + 1, q1 = jEntS[j] + jEntC[j]; q < q1; q++) if (ent[q] < node) node = ent[q];
      const isConn = jBid[j] < 0;
      let q = isConn ? -1 : nodeQ[node];
      if (q < 0) {
        q = qN++;
        if (!isConn) nodeQ[node] = q;
        qNode[q] = node;
        qSlots[q] = 0; qCapP[q] = 0; qAsg[q] = 0; qPrice[q] = 0; qProp[q] = 0; qTimeSum[q] = 0;
        qBase[q] = jBase[j];
        qNoise[q] = jNoise[j];
      }
      jQ[j] = q;
      qSlots[q] += jSlots[j];
      qCapP[q] += jCapP[j];
      qPrice[q] += jPrice[j] * jSlots[j];
    }
    for (let q = 0; q < qN; q++) if (qSlots[q] > 0) qPrice[q] /= qSlots[q];
    c.qN = qN;
  },

  /** stop x / z and the 8x8 stop bins (stCell / stMode filled by the driver); the core sizes class G first */
  prepStops(e: KernelEnv): void {
    const A = e.A, c = e.c;
    const sn = c.stopN, N = c.mapN;
    const nb = Math.ceil(N / 8);
    c.binN = nb;
    const cell = A.stCell, sx = A.stX, sz = A.stZ;
    for (let s = 0; s < sn; s++) { const x = cell[s] % N; sx[s] = x; sz[s] = (cell[s] - x) / N; }
    const start = A.stopBinStart;
    start.fill(0, 0, nb * nb + 1);
    for (let s = 0; s < sn; s++) start[((sz[s] / 8) | 0) * nb + ((sx[s] / 8) | 0) + 1]++;
    for (let i = 0; i < nb * nb; i++) start[i + 1] += start[i];
    const fill = A.binFill, bins = A.stopBins;
    fill.fill(0, 0, nb * nb);
    for (let s = 0; s < sn; s++) {
      const bi = ((sz[s] / 8) | 0) * nb + ((sx[s] / 8) | 0);
      bins[start[bi] + fill[bi]++] = s;
    }
  },

  /**
   * transfer CSR between stops of different modes + bus times; returns the edge count or -need (class E). One
   * nearStops pass records the edges in push order (from, to, cost as the f32 the CSR stores), then the original's
   * counting fill with the decrementing cursor.
   */
  transfers(e: KernelEnv): number {
    const A = e.A, c = e.c, P = e.P;
    const sn = c.stopN, total = c.total, nb = c.binN, R = P.stopR;
    const mode = A.stMode, attC = A.stAttC, attS = A.stAttS, att = A.stAtt, wait = A.stWait, sx = A.stX, sz = A.stZ;
    const idx = A.nsIdx, dist = A.nsDist;
    const eFrom = A.trEFrom, eTo = A.trETo, eCost = A.trECost, cap = eFrom.length;
    const wt = P.stopWalkT;
    let ne = 0;
    for (let s = 0; s < sn; s++) {
      if (attC[s] === 0) continue;
      const cnt = nearStops(A, nb, sx[s], sz[s], R);
      for (let q = 0; q < cnt; q++) {
        const s2 = idx[q];
        if (s2 <= s || mode[s2] === mode[s] || attC[s2] === 0) continue;
        if (ne + 2 <= cap) {
          const a = att[attS[s]], b = att[attS[s2]];
          const cst = dist[q] * wt + 0.5 * (wait[s] + wait[s2]);
          eFrom[ne] = a; eTo[ne] = b; eCost[ne] = cst;
          eFrom[ne + 1] = b; eTo[ne + 1] = a; eCost[ne + 1] = cst;
        }
        ne += 2;
      }
    }
    if (ne > cap) return -ne;
    const trStart = A.trStart, to = A.trTo, cost = A.trCost;
    trStart.fill(0, 0, total + 1);
    for (let k = 0; k < ne; k++) trStart[eFrom[k] + 1]++;
    for (let i = 0; i < total; i++) trStart[i + 1] += trStart[i];
    for (let k = 0; k < ne; k++) {
      const p = --trStart[eFrom[k] + 1];
      to[p] = eTo[k];
      cost[p] = eCost[k];
    }
    for (let i = 1; i < total; i++) trStart[i] = trStart[i + 1];
    trStart[total] = ne;
    c.nTr = ne;
    const n = c.n, bt = A.busTime, nt = A.nodeTime, f = P.busTimeFactor;
    for (let v = 0; v < n; v++) bt[v] = nt[v] * f;
    return ne;
  },

  /** transit(): seeds, transit search into ST, originTransit; -need (class SD) when the seed arrays are too small */
  transit(e: KernelEnv): number {
    const A = e.A, c = e.c, P = e.P;
    const total = c.total, sn = c.stopN;
    if (sn === 0) {
      e.ST.reset(total);
      c.stSettled = 0;
      originTransit(e);
      return 0;
    }
    const jN = c.jN, nR = c.n, N = c.mapN, nb = c.binN, R0 = P.stopR, wt = P.stopWalkT;
    const jBase = A.jBase, jNoise = A.jNoise, jRail = A.jRailNode, jBid = A.jBid, jCell = A.jCell, jHalf = A.jHalf;
    const attS = A.stAttS, attC = A.stAttC, att = A.stAtt, idx = A.nsIdx, dist = A.nsDist;
    const cap = A.seedNode.length;
    const sNode = A.seedNode, sLabel = A.seedLabel, sId = A.seedId;
    let ns = 0;
    for (let j = 0; j < jN; j++) {
      const label0 = jBase[j] + jNoise[j];
      if (jRail[j] >= 0) {
        if (ns < cap) { sNode[ns] = nR + jRail[j]; sLabel[ns] = label0; sId[ns] = j; }
        ns++;
        continue;
      }
      if (jBid[j] < 0) continue;
      const cl = jCell[j], x = cl % N, z = (cl - x) / N;
      const half = jHalf[j];
      const cnt = nearStops(A, nb, x, z, R0 + half);
      for (let q = 0; q < cnt; q++) {
        const s = idx[q];
        const walk = Math.max(0, dist[q] - half) * wt;
        for (let a = attS[s], a1 = a + attC[s]; a < a1; a++) {
          if (ns < cap) { sNode[ns] = att[a]; sLabel[ns] = label0 + walk; sId[ns] = j; }
          ns++;
        }
      }
    }
    if (ns > cap) return -ns;
    const seeds = e.seeds;
    seeds.n = ns;
    const T = {
      nR, nRail: c.nRail, nSub: c.nSub, total, roadAdj: e.road.rev, busTime: A.busTime, railAdj: e.rail.adj, subAdj: e.sub.adj,
      railTime: P.railTime, subTime: P.subTime, trStart: A.trStart, trTo: A.trTo, trCost: A.trCost,
    };
    e.search.transitSearch(T as never, e.ST as never, null, seeds as never, P.limTransit);
    c.stSettled = e.ST.settled;
    originTransit(e);
    return 0;
  },

  /** roundSearch(): clusters with open capacity >= 0.5 seed a reverse road search into SA */
  roundSearch(e: KernelEnv, round: number): void {
    const A = e.A, c = e.c, P = e.P;
    const qN = c.qN;
    const prop = round < P.propRounds;
    const capP = A.qCapP, slots = A.qSlots, asg = A.qAsg, base = A.qBase, noise = A.qNoise, price = A.qPrice, qNode = A.qNode;
    const sNode = A.seedNode, sLabel = A.seedLabel, sId = A.seedId;
    const pmax = P.priceMax;
    let ns = 0;
    for (let q = 0; q < qN; q++) {
      if ((prop ? capP[q] : slots[q]) - asg[q] < 0.5) continue;
      sNode[ns] = qNode[q];
      sLabel[ns] = pmax + base[q] + noise[q] + price[q];
      sId[ns] = q;
      ns++;
    }
    e.seeds.n = ns;
    e.search.roadSearch(e.road as never, e.road.rev, A.nodeTime, e.SA as never, null, e.seeds as never, P.limRound);
    c.saSettled = e.SA.settled;
  },

  /**
   * roundMatch() up to the round control flow: out0 accepted, out1 carRound, out2 left (Σ oU in origin order);
   * c.outNc candidates, c.outRoutes sampled car pieces (routeCand / routeW)
   */
  roundMatch(e: KernelEnv, round: number): void {
    const A = e.A, c = e.c, P = e.P, SA = e.SA;
    const dist = SA.dist, src = SA.src, hops = SA.hops, done = SA.done;
    const oN = c.oN;
    const ent = A.ent, oEntS = A.oEntS, oEntC = A.oEntC, oU = A.oU, cnode = A.candNode, oTrT = A.oTrT;
    const order = A.sortA;
    let nc = 0;
    let maxD = 1;
    for (let o = 0; o < oN; o++) {
      if (oU[o] < 0.01) continue;
      let best = -1, bd = Infinity;
      for (let q = oEntS[o], q1 = q + oEntC[o]; q < q1; q++) {
        const v = ent[q];
        if (done[v] === 1 && dist[v] < bd) { bd = dist[v]; best = v; }
      }
      if (best < 0) continue;
      cnode[o] = best;
      order[nc++] = o;
      if (bd > maxD) maxD = bd;
    }
    let M = 1;
    while (M < oN) M *= 2;
    const qq = Math.max(1, Math.floor(2 ** 50 / (M * (maxD + 1))));
    const qN0 = A.qNoise, qP0 = A.qPrice;
    const pmax = P.priceMax, carOver = P.carOverhead;
    const S = e.sort;
    const lo = S.lo, hi = S.hi;
    let maxK = 0, packedFallback = false;
    for (let k = 0; k < nc; k++) {
      const o = order[k];
      const node = cnode[o];
      let g = dist[node];
      const trT = oTrT[o];
      if (trT < Infinity) {
        const cq = src[node];
        const carPure = g - pmax - qN0[cq] - qP0[cq] + carOver;
        if (trT < carPure) g -= carPure - trT;
      }
      const kf = Math.floor(Math.max(0, g) * qq);
      if (!(kf >= 0 && kf < 9007199254740992)) { packedFallback = true; break; }
      const l = kf >>> 0;
      lo[k] = l;
      hi[k] = (kf - l) / 4294967296;
      if (kf > maxK) maxK = kf;
    }
    let sorted: Int32Array;
    if (packedFallback) {
      // non-finite keys (NaN inputs only): the original packing + native sort
      const key = S.packed;
      for (let k = 0; k < nc; k++) {
        const o = order[k];
        const node = cnode[o];
        let g = dist[node];
        const trT = oTrT[o];
        if (trT < Infinity) {
          const cq = src[node];
          const carPure = g - pmax - qN0[cq] - qP0[cq] + carOver;
          if (trT < carPure) g -= carPure - trT;
        }
        key[k] = Math.floor(Math.max(0, g) * qq) * M + o;
      }
      const sk = key.subarray(0, nc).sort();
      sorted = A.sortB;
      for (let k = 0; k < nc; k++) sorted[k] = sk[k] % M;
    } else {
      sorted = radixSort(nc, maxK, lo, hi, S.lo2, S.hi2, A.sortA, A.sortB, S.hist) ? A.sortB : A.sortA;
    }
    const carPcu = e.s.carPcu, trBonus = e.s.trBonus;
    const acc = A.acc, tAcc = A.tAcc, stLoad = A.stLoad;
    const qAsg = A.qAsg, qBase = A.qBase, qNoise = A.qNoise, qPrice = A.qPrice, qTimeSum = A.qTimeSum, qCapP = A.qCapP, qSlots = A.qSlots;
    if (round === 0) {
      const qProp = A.qProp;
      for (let k = 0; k < nc; k++) {
        const o = sorted[k];
        qProp[src[cnode[o]]] += oU[o];
      }
    }
    const prop = round < P.propRounds;
    const oLastD = A.oLastD, oAsg = A.oAsg, oTimeSum = A.oTimeSum, oCarW = A.oCarW, oTrW = A.oTrW, oWalkW = A.oWalkW, oCarNode = A.oCarNode;
    const oWealth = A.oWealth, oBoard = A.oBoard, oBoardStop = A.oBoardStop;
    const routeCand = A.routeCand, routeW = A.routeW;
    const maxC = P.maxCommute, walkMax = P.walkMax, walkTpc = P.walkT, beta = P.modeBeta, walkBias = P.walkBias;
    const CAR_BIAS = P.carBias, TRANSIT_BIAS = P.trBias;
    let accepted = 0, carRound = 0, rn = 0;
    for (let k = 0; k < nc; k++) {
      const o = sorted[k];
      const node = cnode[o];
      const q = src[node];
      const d = dist[node] - pmax - qNoise[q] - qPrice[q];
      oLastD[o] = d;
      const open = (prop ? qCapP[q] : qSlots[q]) - qAsg[q];
      if (open < 0.01) continue;
      const take = Math.min(oU[o], open);
      // mode split for this piece
      const carT = d + carOver;
      const carOk = d <= maxC;
      const walkT = qBase[q] === 0 && hops[node] <= walkMax ? (hops[node] + 1) * walkTpc : Infinity;
      const trT = oTrT[o];
      const wl = oWealth[o] - 1;
      const uc = carOk ? -beta * carT + CAR_BIAS[wl] : -Infinity;
      const ut = trT < Infinity ? -beta * trT + TRANSIT_BIAS[wl] + trBonus : -Infinity;
      const uw = walkT < Infinity ? -beta * walkT + walkBias : -Infinity;
      const um = Math.max(uc, ut, uw);
      if (um === -Infinity) continue;
      const ec = uc > -Infinity ? Math.exp(uc - um) : 0;
      const et = ut > -Infinity ? Math.exp(ut - um) : 0;
      const ew = uw > -Infinity ? Math.exp(uw - um) : 0;
      const tot = ec + et + ew;
      const sc = ec / tot, st = et / tot, sw = ew / tot;
      const time = sc * (sc > 0 ? carT : 0) + st * (st > 0 ? trT : 0) + sw * (sw > 0 ? walkT : 0);
      // commit
      oU[o] -= take;
      oAsg[o] += take;
      oTimeSum[o] += take * time;
      oCarW[o] += take * sc;
      oTrW[o] += take * st;
      oWalkW[o] += take * sw;
      if (oCarNode[o] < 0) oCarNode[o] = node;
      qAsg[q] += take;
      qTimeSum[q] += take * time;
      accepted += take;
      if (sc > 0) {
        const f = take * sc;
        acc[node] += f * carPcu;
        carRound += f;
        if (rn < ROUTE_MAX) { routeCand[rn] = node; routeW[rn] = f; rn++; }
      }
      if (st > 0) {
        tAcc[oBoard[o]] += take * st;
        stLoad[oBoardStop[o]] += take * st;
      }
    }
    if (carRound > 0) flowsIntoVol(e, true, true, null);
    let left = 0;
    for (let o = 0; o < oN; o++) left += oU[o];
    e.out[0] = accepted; e.out[1] = carRound; e.out[2] = left;
    c.outNc = nc;
    c.outRoutes = rn;
  },

  /** commuteEnd() incl. poolRemaining, without the per-id price scatter: out0..4 = trips car / transit / walk, Σ time, Σ workers */
  commute(e: KernelEnv): void {
    poolRemaining(e);
    const A = e.A, c = e.c, P = e.P;
    const oN = c.oN, qN = c.qN, jN = c.jN;
    const oAsg = A.oAsg, oTimeSum = A.oTimeSum;
    let tw = 0, tt = 0;
    for (let o = 0; o < oN; o++) { tw += oAsg[o]; tt += oTimeSum[o]; }
    const avgT = tw > 0 ? tt / tw - P.carOverhead : 5;
    const stepP = Math.max(P.stepMin, P.stepRel * avgT);
    const qProp = A.qProp, qCapP = A.qCapP, qPrice = A.qPrice, qSlots = A.qSlots, qAsg = A.qAsg, qTimeSum = A.qTimeSum;
    let propSum = 0, capSum = 0;
    for (let q = 0; q < qN; q++) { propSum += qProp[q]; capSum += Math.max(1, qCapP[q]); }
    const mean = propSum > 0 && capSum > 0 ? propSum / capSum : 1;
    const pmax = P.priceMax;
    for (let q = 0; q < qN; q++) {
      const cap = Math.max(1, qCapP[q]);
      const r = Math.max(0.25, Math.min(8, qProp[q] / cap / mean));
      const p = qPrice[q] + stepP * Math.log(r);
      qPrice[q] = p < -pmax ? -pmax : p > pmax ? pmax : p;
    }
    const jQ = A.jQ, jSlots = A.jSlots, jAsg = A.jAsg, jTimeSum = A.jTimeSum;
    for (let j = 0; j < jN; j++) {
      const q = jQ[j];
      if (q < 0) { jAsg[j] = 0; jTimeSum[j] = 0; continue; }
      const share = qSlots[q] > 0 ? jSlots[j] / qSlots[q] : 0;
      jAsg[j] = qAsg[q] * share;
      jTimeSum[j] = qTimeSum[q] * share;
    }
    // transit riders along the transit forest (stop sink), bus PCU on roads, rail / subway riders
    const ST = e.ST, order = ST.order, next = ST.next, settled = c.stSettled;
    const tAcc = A.tAcc, nodeStop = A.nodeStop, stLoad = A.stLoad;
    for (let k = settled - 1; k >= 0; k--) {
      const v = order[k];
      const f = tAcc[v];
      if (f === 0) continue;
      const nx = next[v];
      if (nx >= 0) tAcc[nx] += f;
      else { const s = nodeStop[v]; if (s >= 0) stLoad[s] += f; }
    }
    const nR = c.n, nRail = c.nRail, volNew = A.volNew, railNew = A.railNew, subNew = A.subNew, busPcu = P.busPcu;
    for (let k = 0; k < settled; k++) {
      const v = order[k];
      const f = tAcc[v];
      if (f === 0) continue;
      if (v < nR) volNew[v] += f * busPcu;
      else if (v < nR + nRail) railNew[v - nR] += f;
      else subNew[v - nR - nRail] += f;
    }
    // per-origin outputs and trip statistics
    const oW = A.oW, oCarW = A.oCarW, oTrW = A.oTrW, oWalkW = A.oWalkW, oEmp = A.oEmp, oTime = A.oTime, oShC = A.oShC, oShT = A.oShT, oShW = A.oShW;
    let tripsC = 0, tripsT = 0, tripsW = 0, cSum = 0, cW = 0;
    for (let o = 0; o < oN; o++) {
      const a = oAsg[o];
      const W = oW[o];
      oEmp[o] = W > 0 ? Math.min(1, a / W) : 0;
      if (a > 0) {
        oTime[o] = oTimeSum[o] / a;
        oShC[o] = oCarW[o] / a;
        oShT[o] = oTrW[o] / a;
        oShW[o] = oWalkW[o] / a;
        cSum += oTimeSum[o];
        cW += a;
      } else {
        oTime[o] = 0;
        oShC[o] = oShT[o] = oShW[o] = 0;
      }
      tripsC += oCarW[o];
      tripsT += oTrW[o];
      tripsW += oWalkW[o];
    }
    e.out[0] = tripsC; e.out[1] = tripsT; e.out[2] = tripsW; e.out[3] = cSum; e.out[4] = cW;
  },

  /** inbound() cached branch (jTmp[j] = inboundById[jBid[j]] from the driver): out0 = trips; volNew += volInbound */
  inboundCached(e: KernelEnv): void {
    const A = e.A, c = e.c;
    const jB = c.jB, jSlots = A.jSlots, jAsg = A.jAsg, jInbound = A.jInbound, tmp = A.jTmp;
    let tot = 0;
    for (let j = 0; j < jB; j++) {
      const spare = jSlots[j] - Math.min(jSlots[j], jAsg[j]);
      const v = Math.min(spare, tmp[j]);
      jInbound[j] = v > 0 ? v : 0;
      tot += jInbound[j];
    }
    fairKernels.addCached(e, 0);
    e.out[0] = tot;
  },

  /** inbound() recompute branch: 1 = searched (out0 trips, c.outCand candidates in inCand), 0 = no connections; -need */
  inbound(e: KernelEnv): number {
    const A = e.A, c = e.c, P = e.P, g = e.road;
    const n = c.n, jN = c.jN, jB = c.jB;
    const jEntS = A.jEntS, jEntC = A.jEntC, ent = A.ent;
    let ns = 0;
    for (let j = jB; j < jN; j++) if (jEntC[j] !== 0) ns++;
    if (ns > A.seedNode.length) return -ns;
    A.volInbound.fill(0, 0, n);
    e.out[0] = 0;
    c.outCand = 0;
    if (ns === 0) return 0;
    const sNode = A.seedNode, sLabel = A.seedLabel, sId = A.seedId, conns = A.conns;
    const rt = P.regionalTime;
    let k = 0;
    for (let j = jB; j < jN; j++) {
      if (jEntC[j] === 0) continue;
      sNode[k] = ent[jEntS[j]]; sLabel[k] = rt; sId[k] = k; conns[k] = j;
      k++;
    }
    e.seeds.n = ns;
    const S = e.SB;
    e.search.roadSearch(g as never, g.fwd, A.nodeTime, S as never, null, e.seeds as never, P.limInbound);
    c.sbSettled = S.settled;
    const dist = S.dist, src = S.src, done = S.done;
    const jSlots = A.jSlots, jAsg = A.jAsg, jInbound = A.jInbound, jType = A.jConnType;
    const desire = A.desire, bestNode = A.bestNode, connSum = A.connSum, scale = A.scale;
    desire.fill(0, 0, jB);
    bestNode.fill(-1, 0, jB);
    connSum.fill(0, 0, ns);
    const fillF = P.regionalFill;
    for (let j = 0; j < jB; j++) {
      const spare = jSlots[j] - Math.min(jSlots[j], jAsg[j]);
      if (spare <= 0) continue;
      let bd = Infinity, bn = -1;
      for (let q = jEntS[j], q1 = q + jEntC[j]; q < q1; q++) {
        const v = ent[q];
        if (done[v] === 1 && dist[v] < bd) { bd = dist[v]; bn = v; }
      }
      if (bn < 0) continue;
      const f = Math.max(0.2, Math.min(1, 1.3 - bd / 60));
      desire[j] = spare * fillF * f;
      bestNode[j] = bn;
      connSum[src[bn]] += desire[j];
    }
    const CW = P.connWorkers, growth = e.s.growth;
    let capSum = 0;
    for (let q = 0; q < ns; q++) capSum += CW[jType[conns[q]]] * growth;
    const rwc = e.s.regionWorkerCap;
    const capMul = capSum > rwc ? rwc / capSum : 1;
    for (let q = 0; q < ns; q++) {
      const capW = CW[jType[conns[q]]] * growth * capMul;
      scale[q] = connSum[q] > capW ? capW / connSum[q] : 1;
    }
    const acc = A.acc;
    acc.fill(0, 0, n);
    const carPcu = P.invCarOcc;
    const cand = A.inCand;
    let tot = 0, nc = 0;
    for (let j = 0; j < jB; j++) {
      const bn = bestNode[j];
      if (bn < 0) continue;
      const inflow = desire[j] * scale[src[bn]];
      jInbound[j] = inflow;
      acc[bn] += inflow * carPcu;
      tot += inflow;
      if (inflow > 0) cand[nc++] = j;
    }
    flowsIntoVol(e, false, false, A.volInbound);
    e.out[0] = tot;
    c.outCand = nc;
    return 1;
  },

  /** shopping() recompute branch: out0 = trips; returns 1 when searched; -need */
  shop(e: KernelEnv): number {
    const A = e.A, c = e.c, P = e.P, g = e.road;
    const n = c.n, sN = c.sN, oN = c.oN;
    const sEntS = A.sEntS, sEntC = A.sEntC, ent = A.ent;
    let ns = 0;
    for (let s = 0; s < sN; s++) ns += sEntC[s];
    if (ns > A.seedNode.length) return -ns;
    A.volShop.fill(0, 0, n);
    e.out[0] = 0;
    if (ns === 0) return 0;
    const sNode = A.seedNode, sLabel = A.seedLabel, sId = A.seedId;
    let k = 0;
    for (let s = 0; s < sN; s++) for (let q = sEntS[s], q1 = q + sEntC[s]; q < q1; q++) { sNode[k] = ent[q]; sLabel[k] = 0; sId[k] = s; k++; }
    e.seeds.n = ns;
    const S = e.SB;
    e.search.roadSearch(g as never, g.rev, A.nodeTime, S as never, null, e.seeds as never, P.limShop);
    c.sbSettled = S.settled;
    const dist = S.dist, src = S.src, done = S.done;
    const acc = A.acc;
    acc.fill(0, 0, n);
    const pcu = P.shopPcu, perRes = P.shopTrips;
    const oEntS = A.oEntS, oEntC = A.oEntC, oPop = A.oPop, oShC = A.oShC, oShT = A.oShT, oShW = A.oShW, sLoad = A.sLoad;
    let tot = 0;
    for (let o = 0; o < oN; o++) {
      let bd = Infinity, bn = -1;
      for (let q = oEntS[o], q1 = q + oEntC[o]; q < q1; q++) {
        const v = ent[q];
        if (done[v] === 1 && dist[v] < bd) { bd = dist[v]; bn = v; }
      }
      if (bn < 0) continue;
      const trips = oPop[o] * perRes * Math.exp(-Math.max(0, bd - 8) / 20);
      const carShare = oShC[o] + oShW[o] + oShT[o] > 0 ? oShC[o] : 0.7;
      const walkish = bd < 3 ? 0.6 : 0;
      acc[bn] += trips * carShare * (1 - walkish) * pcu;
      sLoad[src[bn]] += trips;
      tot += trips;
    }
    flowsIntoVol(e, false, false, A.volShop);
    e.out[0] = tot;
    return 1;
  },

  /** freight() recompute branch: fAcc / fNode per source, out0 = trucks; 0 = no sinks, 1 = searched; -need */
  freight(e: KernelEnv): number {
    const A = e.A, c = e.c, P = e.P, g = e.road;
    const n = c.n, kN = c.kN, fN = c.fN;
    const kEntS = A.kEntS, kEntC = A.kEntC, kLabel = A.kLabel, ent = A.ent;
    let ns = 0;
    for (let k = 0; k < kN; k++) ns += kEntC[k];
    if (ns > A.seedNode.length) return -ns;
    A.volFreight.fill(0, 0, n);
    e.out[0] = 0;
    const fAcc = A.fAcc, fNode = A.fNode;
    if (ns === 0) {
      fAcc.fill(0.15, 0, fN);
      fNode.fill(-1, 0, fN);
      return 0;
    }
    const sNode = A.seedNode, sLabel = A.seedLabel, sId = A.seedId;
    let q = 0;
    for (let k = 0; k < kN; k++) for (let r = kEntS[k], r1 = r + kEntC[k]; r < r1; r++) { sNode[q] = ent[r]; sLabel[q] = kLabel[k]; sId[q] = k; q++; }
    e.seeds.n = ns;
    const S = e.SB;
    e.search.roadSearch(g as never, g.rev, A.nodeTime, S as never, null, e.seeds as never, P.limFreight);
    c.sbSettled = S.settled;
    const dist = S.dist, done = S.done;
    const acc = A.acc;
    acc.fill(0, 0, n);
    const fEntS = A.fEntS, fEntC = A.fEntC, fTrucks = A.fTrucks, truckPcu = P.truckPcu;
    let tot = 0;
    for (let f = 0; f < fN; f++) {
      let bd = Infinity, bn = -1;
      for (let r = fEntS[f], r1 = r + fEntC[f]; r < r1; r++) {
        const v = ent[r];
        if (done[v] === 1 && dist[v] < bd) { bd = dist[v]; bn = v; }
      }
      if (bn < 0) { fAcc[f] = 0.15; fNode[f] = -1; continue; }
      fAcc[f] = Math.max(0.3, Math.min(1, 1.25 - bd / 60));
      const trucks = fTrucks[f];
      acc[bn] += trucks * truckPcu;
      tot += trucks;
      fNode[f] = bn;
    }
    flowsIntoVol(e, false, false, A.volFreight);
    e.out[0] = tot;
    return 1;
  },

  /** volNew += cached volumes (0 inbound, 1 shop, 2 freight) */
  addCached(e: KernelEnv, which: number): void {
    const A = e.A;
    const v = which === 0 ? A.volInbound : which === 1 ? A.volShop : A.volFreight;
    const vol = A.volNew, n = e.c.n;
    for (let i = 0; i < n; i++) vol[i] += v[i];
  },

  /** finalize(): MSA blend into acc, traffic / congestion / rail layers, subway riders; out0 congSum, out1 congN */
  finalize(e: KernelEnv): void {
    const A = e.A, c = e.c, P = e.P, g = e.road;
    const L = e.layers;
    const n = c.n, traffic = L.traffic, congestion = L.congestion, net = L.network;
    const alpha = e.s.alpha;
    const blended = A.acc, cellOf = g.cellOf, volNew = A.volNew;
    for (let v = 0; v < n; v++) {
      const cc = cellOf[v];
      blended[v] = traffic[cc] * (1 - alpha) + volNew[v] * alpha;
    }
    const railN = c.nRail, railCell = e.rail.cellOf, railNew = A.railNew;
    for (let v = 0; v < railN; v++) railNew[v] = traffic[railCell[v]] * (1 - alpha) + railNew[v] * alpha;
    traffic.fill(0);
    congestion.fill(0);
    const street = P.street, hw = P.hw, rail = P.rail, cap = g.cap;
    let congSum = 0, congN = 0;
    for (let v = 0; v < n; v++) {
      const cc = cellOf[v];
      if (!(net[cc] >= street && net[cc] <= hw)) continue;
      const vol = blended[v];
      traffic[cc] = vol;
      const r = vol / cap[v];
      congestion[cc] = r;
      if (vol > 1) { congSum += r > 1 ? 1 : r; congN++; }
    }
    const railCap = P.railCap;
    for (let v = 0; v < railN; v++) {
      const cc = railCell[v];
      if (net[cc] !== rail) continue;
      traffic[cc] = railNew[v];
      congestion[cc] = traffic[cc] / railCap;
    }
    const riders = A.subwayRiders, subCell = e.sub.cellOf, subNew = A.subNew;
    riders.fill(0, 0, c.cells);
    for (let v = 0; v < c.nSub; v++) riders[subCell[v]] = subNew[v];
    e.out[0] = congSum;
    e.out[1] = congN;
  },
};

/** each origin's best transit option from the transit forest (+ acc / tAcc cleared) */
function originTransit(e: KernelEnv): void {
  const A = e.A, c = e.c, P = e.P;
  const oN = c.oN, N = c.mapN, nb = c.binN, R0 = P.stopR, wt = P.stopWalkT, maxC = P.maxCommute;
  const ST = e.ST, distT = ST.dist, srcT = ST.src, doneT = ST.done;
  const hasStops = c.stopN > 0;
  const oTrT = A.oTrT, oBoard = A.oBoard, oBoardStop = A.oBoardStop, oJobT = A.oJobT, oCell = A.oCell, oHalf = A.oHalf;
  const attS = A.stAttS, attC = A.stAttC, att = A.stAtt, wait = A.stWait, idx = A.nsIdx, dist = A.nsDist, jNoise = A.jNoise;
  for (let o = 0; o < oN; o++) {
    oTrT[o] = Infinity;
    oBoard[o] = -1;
    oBoardStop[o] = -1;
    oJobT[o] = -1;
    if (!hasStops) continue;
    const cl = oCell[o], x = cl % N, z = (cl - x) / N;
    const half = oHalf[o];
    const cnt = nearStops(A, nb, x, z, R0 + half);
    let best = Infinity, board = -1, boardStop = -1;
    for (let q = 0; q < cnt; q++) {
      const s = idx[q];
      const walk = Math.max(0, dist[q] - half) * wt + wait[s];
      for (let a = attS[s], a1 = a + attC[s]; a < a1; a++) {
        const v = att[a];
        if (doneT[v] !== 1) continue;
        const g = walk + distT[v];
        if (g < best) { best = g; board = v; boardStop = s; }
      }
    }
    if (board < 0) continue;
    const jT = srcT[board];
    const t = best - jNoise[jT];
    if (t > maxC) continue;
    oTrT[o] = t;
    oBoard[o] = board;
    oBoardStop[o] = boardStop;
    oJobT[o] = jT;
  }
  A.acc.fill(0, 0, c.n);
  A.tAcc.fill(0, 0, c.total);
}

/** poolRemaining(): unmatched workers take the remaining open capacity of their road component proportionally */
function poolRemaining(e: KernelEnv): void {
  const A = e.A, c = e.c, P = e.P, g = e.road;
  const comp = g.comp, nc = c.nComp;
  if (nc === 0) return;
  const oN = c.oN, qN = c.qN, n = c.n;
  const U = A.poolU, O = A.poolO;
  U.fill(0, 0, nc);
  O.fill(0, 0, nc);
  const oU = A.oU, oLastD = A.oLastD, oEntS = A.oEntS, ent = A.ent;
  let any = false;
  for (let o = 0; o < oN; o++) {
    if (oU[o] < 0.01 || oLastD[o] < 0) continue;
    U[comp[ent[oEntS[o]]]] += oU[o];
    any = true;
  }
  if (!any) return;
  const qSlots = A.qSlots, qAsg = A.qAsg, qNode = A.qNode, qTimeSum = A.qTimeSum;
  for (let q = 0; q < qN; q++) {
    const cc = qSlots[q] - qAsg[q];
    if (cc > 0.5) O[comp[qNode[q]]] += cc;
  }
  const oAsg = A.oAsg, oTimeSum = A.oTimeSum, oCarW = A.oCarW, oTrW = A.oTrW, oTrT = A.oTrT, oWealth = A.oWealth, oBoard = A.oBoard;
  const oBoardStop = A.oBoardStop, candNode = A.candNode, tAcc = A.tAcc, stLoad = A.stLoad, acc = A.acc, saDone = e.SA.done;
  let tw = 0, tt = 0;
  for (let o = 0; o < oN; o++) { tw += oAsg[o]; tt += oTimeSum[o]; }
  const avgT = tw > 0 ? tt / tw : 15;
  const carPcu = e.s.carPcu, maxC = P.maxCommute, carOver = P.carOverhead, beta = P.modeBeta;
  const CAR_BIAS = P.carBias, TRANSIT_BIAS = P.trBias;
  let flows = false;
  for (let o = 0; o < oN; o++) {
    const u = oU[o];
    if (u < 0.01 || oLastD[o] < 0) continue;
    const cc = comp[ent[oEntS[o]]];
    if (O[cc] <= 0) continue;
    const take = u * Math.min(1, O[cc] / U[cc]);
    const carT = Math.min(maxC, Math.max(avgT + 5, 1.3 * (oLastD[o] + carOver)));
    const trT = oTrT[o];
    let st = 0;
    if (trT < Infinity) {
      const wl = oWealth[o] - 1;
      const d = (-beta * trT + TRANSIT_BIAS[wl]) - (-beta * carT + CAR_BIAS[wl]);
      st = 1 / (1 + Math.exp(-d));
    }
    const sc = 1 - st;
    oU[o] -= take;
    oAsg[o] += take;
    oTimeSum[o] += take * (sc * carT + st * (trT < Infinity ? trT : 0));
    oCarW[o] += take * sc;
    if (st > 0) {
      oTrW[o] += take * st;
      tAcc[oBoard[o]] += take * st;
      stLoad[oBoardStop[o]] += take * st;
    }
    const node = candNode[o];
    if (sc > 0 && node >= 0 && node < n && saDone[node] === 1) { acc[node] += take * sc * carPcu; flows = true; }
  }
  for (let q = 0; q < qN; q++) {
    const open = qSlots[q] - qAsg[q];
    if (open <= 0.5) continue;
    const cc = comp[qNode[q]];
    if (O[cc] <= 0) continue;
    const add = open * Math.min(1, U[cc] / O[cc]);
    qAsg[q] += add;
    qTimeSum[q] += add * Math.max(avgT + 5, 20);
  }
  if (flows) flowsIntoVol(e, true, true, null);
}

// ------------------------------------------------------------------------------------------------ the fair core
/** capacity policy shared with the wasm core: grow to need + 1/8 + 16 (at least x1.25); L / H / X are exact */
export function growCap(cls: Cls, cur: number, need: number): number {
  if (cls === 'L' || cls === 'H' || cls === 'X') return need;
  if (need <= cur) return cur;
  return Math.max(need + (need >> 3) + 16, Math.ceil(cur * 1.25));
}

/** element count of an array for class capacities `caps` */
export function arrLen(a: ArrDef, caps: Record<Cls, number>): number {
  return a.cls === 'X' ? a.mult : caps[a.cls] * a.mult;
}

export const ALL_CLASSES: readonly Cls[] = ['N', 'T', 'T1', 'R', 'B', 'O', 'J', 'Q', 'S', 'F', 'K', 'P', 'A', 'G', 'E', 'NT', 'SD', 'C', 'QE', 'L', 'H', 'X'];

export function zeroCaps(): Record<Cls, number> {
  const c = {} as Record<Cls, number>;
  for (const k of ALL_CLASSES) c[k] = 0;
  return c;
}

/** a kernel environment with empty arrays (the cores fill A and call bindEnvViews) */
export function newEnv(P: TrafficParams, search: FairSearch, A: Arrs): KernelEnv {
  const e: KernelEnv = {
    A, c: newCounts(), s: { propFactor: 1, carPcu: 1, trBonus: 0, alpha: 1, growth: 1, regionWorkerCap: 0 }, out: new Float64Array(8), P,
    road: null as unknown as RoadGraphLike, rail: null as unknown as GridGraphLike, sub: null as unknown as GridGraphLike,
    layers: null as unknown as LayersLike, search, SA: new SearchView(), ST: new SearchView(), SB: new SearchView(),
    sort: { lo: new Uint32Array(0), hi: new Uint32Array(0), lo2: new Uint32Array(0), hi2: new Uint32Array(0), hist: new Int32Array(HIST_WORDS), packed: new Float64Array(0) },
    seeds: { n: 0, node: A.seedNode, label: A.seedLabel, id: A.seedId },
  };
  bindEnvViews(e);
  return e;
}

/** grow the radix sort scratch to the origin capacity */
export function ensureSortScratch(e: KernelEnv, oCap: number): void {
  const S = e.sort;
  if (S.lo.length >= oCap) return;
  S.lo = new Uint32Array(oCap); S.hi = new Uint32Array(oCap); S.lo2 = new Uint32Array(oCap); S.hi2 = new Uint32Array(oCap);
  S.packed = new Float64Array(oCap);
}

/** the fair optimised-JS traffic core: plain typed arrays, the kernels above, the fair searches */
export function makeFairTrafficCore(P: TrafficParams, search: FairSearch): TrafficCoreApi & { readonly env: KernelEnv } {
  const caps = zeroCaps();
  const defs = TRAFFIC_ARRAYS.filter((a) => !a.wasmOnly);
  const A = newArraysObject() as unknown as Record<string, Float32Array | Float64Array | Int32Array | Uint8Array | Uint16Array | Uint32Array>;
  for (const a of defs) A[a.name] = new (CTOR[a.type] as unknown as new (n: number) => Float32Array)(arrLen(a, caps));
  const e = newEnv(P, search, A as unknown as Arrs);
  const moved: (() => void)[] = [];
  const calls: Record<string, number> = {};
  const count = (k: string) => { calls[k] = (calls[k] ?? 0) + 1; };

  function ensure(need: Partial<Record<Cls, number>>): boolean {
    const changed = new Set<Cls>();
    for (const k of Object.keys(need) as Cls[]) {
      const v = need[k]!;
      if (k === 'T') { if (v + 1 > caps.T1) need.T1 = Math.max(need.T1 ?? 0, v + 1); }
      if (k === 'J') { if (v + 1 > caps.Q) need.Q = Math.max(need.Q ?? 0, v + 1); }
    }
    for (const k of Object.keys(need) as Cls[]) {
      const v = need[k]!;
      const nc = k === 'L' ? v : growCap(k, caps[k], v);
      if (nc !== caps[k] && (k === 'L' || v > caps[k])) { caps[k] = nc; changed.add(k); }
    }
    if (changed.size === 0) return false;
    for (const a of defs) {
      if (!changed.has(a.cls)) continue;
      const len = arrLen(a, caps);
      const old = A[a.name];
      const nw = new (CTOR[a.type] as unknown as new (n: number) => Float32Array)(len);
      nw.set((old.length <= len ? old : old.subarray(0, len)) as Float32Array);
      A[a.name] = nw;
    }
    if (changed.has('O')) ensureSortScratch(e, caps.O);
    bindEnvViews(e);
    for (const cb of moved) cb();
    return true;
  }

  const core = {
    kind: 'fair',
    env: e,
    A: A as unknown as TrafficArrays,
    c: e.c,
    s: e.s,
    out: e.out,
    P,
    calls,
    ensure,
    onMove(cb: () => void) { moved.push(cb); },
    bindGraphs(road: RoadGraphLike, rail: GridGraphLike, sub: GridGraphLike) {
      e.road = road; e.rail = rail; e.sub = sub;
      e.c.n = road.n; e.c.nRail = rail.n; e.c.nSub = sub.n; e.c.nComp = road.nComp; e.c.mapN = road.N;
      e.c.total = road.n + rail.n + sub.n;
    },
    bindLayers(st: LayersLike) { e.layers = st; e.c.cells = st.cells; },
    prepNodes() { count('prepNodes'); fairKernels.prepNodes(e); },
    prepOrigins() { count('prepOrigins'); fairKernels.prepOrigins(e); },
    clusters() { count('clusters'); fairKernels.clusters(e); },
    prepStops() { count('prepStops'); ensure({ G: Math.ceil(e.c.mapN / 8) ** 2 + 1 }); fairKernels.prepStops(e); },
    transfers() {
      count('transfers');
      for (;;) { const r = fairKernels.transfers(e); if (r >= 0) return; ensure({ E: -r }); }
    },
    transit() {
      count('transit');
      for (;;) { const r = fairKernels.transit(e); if (r >= 0) return; ensure({ SD: -r }); }
    },
    roundSearch(round: number) { count('roundSearch'); ensure({ SD: e.c.qN }); fairKernels.roundSearch(e, round); },
    roundMatch(round: number) { count('roundMatch'); fairKernels.roundMatch(e, round); },
    commute() { count('commute'); fairKernels.commute(e); },
    inboundCached() { count('inboundCached'); fairKernels.inboundCached(e); },
    inbound() { count('inbound'); for (;;) { const r = fairKernels.inbound(e); if (r >= 0) return r; ensure({ SD: -r }); } },
    shop() { count('shop'); for (;;) { const r = fairKernels.shop(e); if (r >= 0) return r; ensure({ SD: -r }); } },
    freight() { count('freight'); for (;;) { const r = fairKernels.freight(e); if (r >= 0) return r; ensure({ SD: -r }); } },
    addCached(which: 0 | 1 | 2) { count('addCached'); fairKernels.addCached(e, which); },
    finalize() { count('finalize'); fairKernels.finalize(e); },
  };
  return core;
}

/** bytes of the arrays of a table subset for class capacities (both cores report their footprint) */
export function footprint(defs: readonly ArrDef[], caps: Record<Cls, number>): number {
  let b = 0;
  for (const a of defs) b += arrLen(a, caps) * BYTES[a.type];
  return b;
}
