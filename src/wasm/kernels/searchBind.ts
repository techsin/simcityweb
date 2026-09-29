/**
 * WebAssembly bindings for src/sim/infra/search.ts (Rust: wasm/sim-kernels/src/search.rs), built around a JS
 * implementation: makeSearchKernels(js, params) returns the same API — Search, Seeds, roadSearch, transitSearch,
 * accumulate — with bit-identical results, running the wasm kernels when the 'search' kernel slot is active and the
 * arguments are in the supported domain, and `js` otherwise (unusual arguments, wasm unavailable, ?simwasm=search:js).
 *
 * Search objects: `new Search()` of this API is a WasmSearch (a subclass of the JS Search). Its dist (f64), src,
 * next, order (i32), hops (u16) and done (u8) arrays are VIEWS INTO WASM MEMORY (one pinned heap block per search),
 * so the kernels write them in place and every JS consumer (traffic's roundMatch, commuteEnd, inbound, shopping,
 * freight, tracePath, findPath's scratch use ...) reads them unchanged: zero copies per search. The views are plain
 * fields; when wasm memory grows, every live WasmSearch re-points its fields (heap onGrow), so code that reads
 * `S.dist` after the growth sees the new views. (Local aliases held across a growth would be stale: growth happens
 * only inside Search.ensure / reset and the bindings' own staging, never while a caller of this module iterates.)
 * Under the 'js' preference a WasmSearch keeps plain JS arrays (exactly the original object) and migrates into wasm
 * memory (contents copied) the first time it is reset while the kernel is active.
 * A plain JS Search (from the original module) is also accepted: the kernel then writes staging blocks and the binding
 * copies the outputs into the Search's arrays ("copy mode", used by the benchmarks to price the marshalling).
 *
 * Inputs: the road graph's adjacency and node types are copied into wasm memory once per (array, graph version) and
 * validated there (every neighbour id < n); node times, seeds, ramp minutes and the transit tables are staged per
 * call (tens of µs against a multi-millisecond search). The Dial bucket queue lives in reserved scratch blocks: its
 * entry capacity is 2 x (seeds + 4n [+ transfers]) i32, so the kernels never grow memory.
 *
 * accumulate: wasm walks the forest and writes one sink record (seed id, flow, node) per root reached, in walk order;
 * the binding then replays onSink in that order (commuteEnd's f32 stLoad additions are order-sensitive). Callbacks
 * therefore run after the walk: an onSink that reads or writes acc / S during the walk would see the final state
 * instead (no caller does; the JS originals' callbacks only touch their own arrays).
 *
 * Differences from JS that no caller can observe: the JS module-level BucketQueue keeps its (grown) arrays; the wasm
 * path uses its own scratch. Search.order past `settled` and hops of unreached nodes are stale in both, but not
 * necessarily with the same stale values when JS and wasm calls are mixed on one Search (consumers never read them).
 *
 * This file does not import the JS module (kernels/search.ts binds the live one), so tests and benchmarks can swap
 * the bound API in for src/sim/infra/search.ts (vi.mock / a bundler plugin) without an import cycle.
 */
import type * as JsSearch from '../../sim/infra/search';
import type { RoadGraph } from '../../sim/infra/graph';
import type { MinHeap } from '../../sim/infra/heap';
import { simWasmCallFailed, type SimWasmInstance } from '../simWasm';
import { scratchSlot, type WasmHeap } from '../heap';
import {
  SEARCH_KERNEL, allocHolder, block, blockNoGrow, cachedGraphArray, clearSearchGraphCache, freeHolder, liveBlock, put, searchMemStats, stage,
  type Holder, type Resident,
} from './searchShared';

export { SEARCH_KERNEL, clearSearchGraphCache, searchMemStats };

/** the API of src/sim/infra/search.ts */
export type SearchApi = typeof JsSearch;
type Search = JsSearch.Search;
type Seeds = JsSearch.Seeds;
type TransitNet = JsSearch.TransitNet;

/** the constants search.ts reads from params.ts / core/types.ts (passed in, so a frozen JS copy can be bound too) */
export interface SearchParams {
  NET_TIME: readonly number[];
  RAMP_PENALTY: number;
  SUBWAY_TIME: number;
  BUS_TIME_FACTOR: number;
  /** Network.Highway */
  HIGHWAY: number;
}

interface SearchExports {
  search_road(
    n: number, adj: number, time: number, typ: number, hw: number, ramp: number, rampPen: number, sNode: number, sLabel: number, sId: number, ns: number,
    limit: number, invQ: number, dist: number, src: number, next: number, hops: number, order: number, done: number, head: number, headLen: number,
    ent: number, ecap: number,
  ): number;
  search_transit(
    nR: number, nRail: number, nSub: number, total: number, roadAdj: number, busTime: number, railAdj: number, subAdj: number, railTime: number,
    subTime: number, trStart: number, trTo: number, trCost: number, nTr: number, sNode: number, sLabel: number, sId: number, ns: number, limit: number,
    invQ: number, dist: number, src: number, next: number, hops: number, order: number, done: number, head: number, headLen: number, ent: number, ecap: number,
  ): number;
  search_accumulate(order: number, next: number, src: number, n: number, settled: number, acc: number, accLen: number, f64acc: number, sinks: number): number;
}

/** calls per path since the last reset (tests / benchmarks: prove which path ran) */
export interface SearchWasmStats {
  roadWasm: number;
  roadCopy: number;
  roadJs: number;
  transitWasm: number;
  transitCopy: number;
  transitJs: number;
  accWasm: number;
  accJs: number;
}
export const searchWasmStats: SearchWasmStats = { roadWasm: 0, roadCopy: 0, roadJs: 0, transitWasm: 0, transitCopy: 0, transitJs: 0, accWasm: 0, accJs: 0 };
export function resetSearchWasmStats(): void {
  for (const k of Object.keys(searchWasmStats) as (keyof SearchWasmStats)[]) searchWasmStats[k] = 0;
}

/** largest node count the kernels take (keeps every byte size far below 2^31) */
const MAX_NODES = 1 << 25;
const isInt = (v: number) => v === (v | 0);

// staging slots of this module (calls never interleave)
const S_TIME = scratchSlot(), S_RAMP = scratchSlot(), S_SN = scratchSlot(), S_SL = scratchSlot(), S_SI = scratchSlot(), S_HEAD = scratchSlot();
const S_ENT = scratchSlot(), S_OUT = scratchSlot(), S_BUS = scratchSlot(), S_RAIL = scratchSlot(), S_SUB = scratchSlot(), S_TRS = scratchSlot();
const S_TRT = scratchSlot(), S_TRC = scratchSlot(), S_RADJ = scratchSlot(), S_ACC = scratchSlot(), S_SINK = scratchSlot(), S_AORD = scratchSlot();
const S_ANXT = scratchSlot(), S_ASRC = scratchSlot();

/** the graph an adjacency array belongs to (transitSearch reuses roadSearch's cached copy of g.rev) */
const graphOfAdj = new WeakMap<Int32Array, RoadGraph>();

/** bytes of the one block holding a search's six arrays of capacity c: dist 8 | src 4 | next 4 | order 4 | hops 2 | done 1 */
const searchBytes = (c: number) => 23 * c;

export interface SearchKernelOptions {
  /** instance provider (default: the global 'search' kernel slot); benchmarks pass a second binary (e.g. scalar) */
  instance?: () => SimWasmInstance | null;
  /** failure handler (default: simWasmCallFailed('search', e), which falls back to JS or rethrows when forced) */
  onError?: (e: unknown) => void;
}

/** search API that runs the wasm kernels when possible and `js` otherwise */
export function makeSearchKernels(js: SearchApi, p: SearchParams, opts: SearchKernelOptions = {}): SearchApi {
  const inst = opts.instance ?? (() => SEARCH_KERNEL.instance());
  const failed = opts.onError ?? ((e: unknown) => simWasmCallFailed('search', e));
  const MIN_ROAD_T = Math.min(p.NET_TIME[1], p.NET_TIME[2], p.NET_TIME[3], p.NET_TIME[4], p.NET_TIME[5]);
  // exactly search.ts: Q = MIN_ROAD_T * 0.999, invQ = 1 / Q; QT likewise
  const INV_Q = 1 / (MIN_ROAD_T * 0.999);
  const INV_QT = 1 / (Math.min(p.SUBWAY_TIME, p.NET_TIME[6], MIN_ROAD_T * p.BUS_TIME_FACTOR) * 0.999);
  const RAMP_PENALTY = p.RAMP_PENALTY;
  const HW = p.HIGHWAY;
  const qOk = Number.isFinite(INV_Q) && INV_Q > 0 && Number.isFinite(INV_QT) && INV_QT > 0 && INV_Q < 1e6 && INV_QT < 1e6;
  /** head capacity: bucket count of the largest limit (2000) for either queue */
  const HEAD_LEN = qOk ? Math.max(Math.ceil(2000 * INV_Q), Math.ceil(2000 * INV_QT)) + 8 : 0;

  class WasmSearch extends js.Search implements Resident {
    readonly _holds: Holder[] = [{ heap: null, blk: null }];
    _ref?: WeakRef<Resident>;
    _fin?: boolean;
    /** capacity of the resident block's arrays */
    _cap = 0;

    /** re-create the six views over the block (after allocation / memory growth) */
    _bindViews(): void {
      const b = this._holds[0].blk;
      if (!b) return;
      const buf = b.buffer as ArrayBuffer, o = b.byteOffset, c = this._cap;
      this.dist = new Float64Array(buf, o, c);
      this.src = new Int32Array(buf, o + 8 * c, c);
      this.next = new Int32Array(buf, o + 12 * c, c);
      this.order = new Int32Array(buf, o + 16 * c, c);
      this.hops = new Uint16Array(buf, o + 20 * c, c);
      this.done = new Uint8Array(buf, o + 22 * c, c);
    }

    /** byte offset of the block when this search is resident in heap `h` with capacity >= n, else -1 */
    _ptr(h: WasmHeap, n: number): number {
      const x = this._holds[0];
      if (x.heap !== h || this.dist.length < n || !x.blk) return -1;
      if (x.blk.buffer !== h.memory.buffer) {
        liveBlock(x);
        this._bindViews();
      }
      return x.blk!.byteOffset;
    }

    /**
     * make the arrays resident in heap `h` with capacity >= n (JS semantics: a too-small search gets fresh zeroed
     * arrays of capacity n + n/4 + 16; a big-enough one keeps its contents). Returns the block offset, or -1 when
     * the memory cannot be had (the caller then runs JS).
     */
    _resident(h: WasmHeap, n: number): number {
      const have = this._ptr(h, n);
      if (have >= 0) return have;
      const keep = this.dist.length >= n;
      const c = keep ? this.dist.length : n + (n >> 2) + 16;
      const x = this._holds[0];
      const old: Holder = { heap: x.heap, blk: x.blk };
      const prev = { dist: this.dist, src: this.src, next: this.next, order: this.order, hops: this.hops, done: this.done };
      if (!allocHolder(h, x, searchBytes(c), this)) {
        x.heap = old.heap;
        x.blk = old.blk;
        return -1;
      }
      this._cap = c;
      this._bindViews();
      if (keep) {
        // migrate (plain arrays or another heap's block): same capacity, same contents (stale hops / order included)
        this.dist.set(prev.dist.subarray(0, c)); this.src.set(prev.src.subarray(0, c)); this.next.set(prev.next.subarray(0, c));
        this.order.set(prev.order.subarray(0, c)); this.hops.set(prev.hops.subarray(0, c)); this.done.set(prev.done.subarray(0, c));
      }
      freeHolder(old);
      return x.blk!.byteOffset;
    }

    override ensure(n: number): void {
      const w = inst();
      if (w !== null && isInt(n) && n >= 0 && n <= MAX_NODES && this._resident(w.heap, n) >= 0) {
        this.n = n;
        return;
      }
      if (this.dist.length < n) freeHolder(this._holds[0]); // plain arrays, exactly Search.ensure
      super.ensure(n);
    }

    override reset(n: number): void {
      this.ensure(n);
      this.dist.fill(Infinity, 0, n);
      this.src.fill(-1, 0, n);
      this.next.fill(-1, 0, n);
      this.done.fill(0, 0, n);
      this.settled = 0;
    }
  }

  // ---------------------------------------------------------------------------------------------- output staging
  interface OutPtrs {
    dist: number;
    src: number;
    next: number;
    order: number;
    hops: number;
    done: number;
    /** copy mode: outputs must be copied into S after the call */
    copy: boolean;
  }
  /** pointers of S's arrays for n nodes (resident WasmSearch: in place; any other Search: a staging block) */
  function outputs(h: WasmHeap, S: Search, n: number): OutPtrs | null {
    if (S instanceof WasmSearch) {
      const b = S._resident(h, n);
      if (b < 0) return null;
      const c = S.dist.length;
      return { dist: b, src: b + 8 * c, next: b + 12 * c, order: b + 16 * c, hops: b + 20 * c, done: b + 22 * c, copy: false };
    }
    S.ensure(n);
    if (!(S.dist.length >= n && S.src.length >= n && S.next.length >= n && S.order.length >= n && S.hops.length >= n && S.done.length >= n)) return null;
    const c = n + 1;
    const b = block(h, S_OUT, searchBytes(c) + 16);
    // hops is not reset by a search: carry S's values in so unreached nodes keep them (as in JS)
    put(h, b + 20 * c, S.hops, n);
    return { dist: b, src: b + 8 * c, next: b + 12 * c, order: b + 16 * c, hops: b + 20 * c, done: b + 22 * c, copy: true };
  }
  function copyBack(h: WasmHeap, S: Search, o: OutPtrs, n: number, settled: number): void {
    const buf = h.memory.buffer;
    S.dist.set(new Float64Array(buf, o.dist, n));
    S.src.set(new Int32Array(buf, o.src, n));
    S.next.set(new Int32Array(buf, o.next, n));
    S.hops.set(new Uint16Array(buf, o.hops, n));
    S.done.set(new Uint8Array(buf, o.done, n));
    if (settled > 0) S.order.set(new Int32Array(buf, o.order, settled));
  }

  /**
   * size accumulate's scratch for searches of n nodes now (a search call is a safe point to grow memory): accumulate
   * runs while callers hold local aliases of the search arrays, so it must never grow memory itself
   */
  function reserveAccumulate(h: WasmHeap, n: number): void {
    block(h, S_ACC, 8 * n);
    block(h, S_SINK, 16 * n);
    block(h, S_AORD, 4 * n);
    block(h, S_ANXT, 4 * n);
    block(h, S_ASRC, 4 * n);
  }

  function seedPtrs(h: WasmHeap, seeds: Seeds): [number, number, number, number] | null {
    const ns = seeds.n;
    if (!isInt(ns) || ns < 0 || seeds.node.length < ns || seeds.label.length < ns || seeds.id.length < ns) return null;
    if (!(seeds.node instanceof Int32Array && seeds.label instanceof Float64Array && seeds.id instanceof Int32Array)) return null;
    return [stage(h, S_SN, seeds.node, ns), stage(h, S_SL, seeds.label, ns), stage(h, S_SI, seeds.id, ns), ns];
  }

  // ---------------------------------------------------------------------------------------------- roadSearch
  function roadSearch(g: RoadGraph, adj: Int32Array, time: Float32Array, S: Search, heap: MinHeap, seeds: Seeds, limit = 400, ramp: Float32Array | null = null): void {
    const w = inst();
    const n = g.n;
    if (
      w === null || !qOk || !isInt(n) || n < 0 || n > MAX_NODES || typeof limit !== 'number' || !(adj instanceof Int32Array) || adj.length < 4 * n ||
      !(time instanceof Float32Array) || time.length < n || !(g.type instanceof Uint8Array) || g.type.length < n ||
      (ramp !== null && !(ramp instanceof Float32Array && ramp.length >= n))
    ) {
      searchWasmStats.roadJs++;
      return (js.roadSearch as (...a: unknown[]) => void)(g, adj, time, S, heap, seeds, limit, ramp);
    }
    const h = w.heap, ex = w.exports as unknown as SearchExports;
    try {
      // allocations first (any of them may grow memory), then the call
      const o = outputs(h, S, n);
      const ga = o && cachedGraphArray(w, adj, g.version, 4 * n, n);
      const gt = ga && ga.ok ? cachedGraphArray(w, g.type, g.version, n, -1) : null;
      const sp = gt ? seedPtrs(h, seeds) : null;
      if (o === null || ga === null || !ga.ok || gt === null || sp === null) {
        searchWasmStats.roadJs++;
        return (js.roadSearch as (...a: unknown[]) => void)(g, adj, time, S, heap, seeds, limit, ramp);
      }
      graphOfAdj.set(adj, g);
      reserveAccumulate(h, n);
      const [pN, pL, pI, ns] = sp;
      const ecap = 2 * (ns + 4 * n) + 16;
      const pHead = block(h, S_HEAD, HEAD_LEN * 4);
      const pEnt = block(h, S_ENT, ecap * 4);
      const pTime = stage(h, S_TIME, time, n);
      const pRamp = ramp === null ? 0 : stage(h, S_RAMP, ramp, n);
      const k = ex.search_road(
        n, ga.ptr, pTime, gt.ptr, HW, pRamp, RAMP_PENALTY, pN, pL, pI, ns, limit, INV_Q,
        o.dist, o.src, o.next, o.hops, o.order, o.done, pHead, HEAD_LEN, pEnt, ecap,
      );
      if (k < 0) throw new Error(`search_road returned ${k}`);
      if (o.copy) {
        copyBack(h, S, o, n, k);
        searchWasmStats.roadCopy++;
      } else searchWasmStats.roadWasm++;
      S.n = n;
      S.settled = k;
      S.graphVersion = g.version;
    } catch (e) {
      failed(e);
      searchWasmStats.roadJs++;
      (js.roadSearch as (...a: unknown[]) => void)(g, adj, time, S, heap, seeds, limit, ramp);
    }
  }

  // ---------------------------------------------------------------------------------------------- transitSearch
  function transitSearch(T: TransitNet, S: Search, heap: MinHeap, seeds: Seeds, limit = 400): void {
    const w = inst();
    const { nR, nRail, nSub, total } = T;
    const ints = isInt(nR) && isInt(nRail) && isInt(nSub) && isInt(total) && nR >= 0 && nRail >= 0 && nSub >= 0 && total <= MAX_NODES && nR + nRail + nSub <= total;
    const nTr = ints && T.trStart instanceof Int32Array && T.trStart.length > total ? T.trStart[total] : -1;
    if (
      w === null || !qOk || !ints || typeof limit !== 'number' || !(T.roadAdj instanceof Int32Array) || T.roadAdj.length < 4 * nR ||
      !(T.busTime instanceof Float32Array) || T.busTime.length < nR || !(T.railAdj instanceof Int32Array) || T.railAdj.length < 4 * nRail ||
      !(T.subAdj instanceof Int32Array) || T.subAdj.length < 4 * nSub || !(nTr >= 0) || !(T.trTo instanceof Int32Array) || T.trTo.length < nTr ||
      !(T.trCost instanceof Float32Array) || T.trCost.length < nTr || typeof T.railTime !== 'number' || typeof T.subTime !== 'number'
    ) {
      searchWasmStats.transitJs++;
      return js.transitSearch(T, S, heap, seeds, limit);
    }
    const h = w.heap, ex = w.exports as unknown as SearchExports;
    try {
      const o = outputs(h, S, total);
      const sp = o ? seedPtrs(h, seeds) : null;
      if (o === null || sp === null) {
        searchWasmStats.transitJs++;
        return js.transitSearch(T, S, heap, seeds, limit);
      }
      reserveAccumulate(h, total);
      const [pN, pL, pI, ns] = sp;
      // road adjacency: reuse roadSearch's cached copy while the road graph is unchanged (it is g.rev)
      const g = graphOfAdj.get(T.roadAdj);
      const pRoad = g !== undefined && g.n === nR ? cachedGraphArray(w, T.roadAdj, g.version, 4 * nR, nR).ptr : stage(h, S_RADJ, T.roadAdj, 4 * nR);
      const ecap = 2 * (ns + 4 * total + nTr) + 16;
      const pHead = block(h, S_HEAD, HEAD_LEN * 4);
      const pEnt = block(h, S_ENT, ecap * 4);
      const pBus = stage(h, S_BUS, T.busTime, nR);
      const pRail = stage(h, S_RAIL, T.railAdj, 4 * nRail);
      const pSub = stage(h, S_SUB, T.subAdj, 4 * nSub);
      const pTrS = stage(h, S_TRS, T.trStart, total + 1);
      const pTrT = stage(h, S_TRT, T.trTo, nTr);
      const pTrC = stage(h, S_TRC, T.trCost, nTr);
      const k = ex.search_transit(
        nR, nRail, nSub, total, pRoad, pBus, pRail, pSub, T.railTime, T.subTime, pTrS, pTrT, pTrC, nTr, pN, pL, pI, ns, limit, INV_QT,
        o.dist, o.src, o.next, o.hops, o.order, o.done, pHead, HEAD_LEN, pEnt, ecap,
      );
      if (k === -3) {
        // the net failed validation in wasm (an index out of range): JS semantics for it
        searchWasmStats.transitJs++;
        return js.transitSearch(T, S, heap, seeds, limit);
      }
      if (k < 0) throw new Error(`search_transit returned ${k}`);
      if (o.copy) {
        copyBack(h, S, o, total, k);
        searchWasmStats.transitCopy++;
      } else searchWasmStats.transitWasm++;
      S.n = total;
      S.settled = k;
    } catch (e) {
      failed(e);
      searchWasmStats.transitJs++;
      js.transitSearch(T, S, heap, seeds, limit);
    }
  }

  // ---------------------------------------------------------------------------------------------- accumulate
  function accumulate(S: Search, acc: Float32Array | Float64Array, onSink?: (seedId: number, flow: number, node: number) => void): void {
    const w = inst();
    const k = S.settled, n = S.n;
    const f64 = acc instanceof Float64Array;
    if (
      w === null || !isInt(k) || !isInt(n) || k <= 0 || n > MAX_NODES || k > n || !(f64 || acc instanceof Float32Array) || acc.length < n ||
      !(S.order.length >= k && S.next.length >= n && S.src.length >= n) || (onSink !== undefined && typeof onSink !== 'function')
    ) {
      searchWasmStats.accJs++;
      return js.accumulate(S, acc, onSink);
    }
    const h = w.heap, ex = w.exports as unknown as SearchExports;
    try {
      // no memory growth here (see reserveAccumulate): a block that does not fit -> JS for this call
      const bpe = f64 ? 8 : 4;
      const own = h.ptrOf(acc);
      const pAcc = own >= 0 && own % bpe === 0 ? own : blockNoGrow(h, S_ACC, n * bpe);
      const pSink = onSink ? blockNoGrow(h, S_SINK, 16 * k) : 0;
      let pO: number, pNx: number, pS: number;
      const r = S instanceof WasmSearch ? S._ptr(h, n) : -1;
      if (r >= 0) {
        const c = S.dist.length;
        pO = r + 16 * c;
        pNx = r + 12 * c;
        pS = r + 8 * c;
      } else {
        const own2 = (a: Int32Array) => { const q = h.ptrOf(a); return q >= 0 && (q & 3) === 0 ? q : -2; };
        pO = own2(S.order) !== -2 ? own2(S.order) : blockNoGrow(h, S_AORD, 4 * k);
        pNx = own2(S.next) !== -2 ? own2(S.next) : blockNoGrow(h, S_ANXT, 4 * n);
        pS = own2(S.src) !== -2 ? own2(S.src) : blockNoGrow(h, S_ASRC, 4 * n);
        if (pO >= 0 && pO !== own2(S.order)) put(h, pO, S.order, k);
        if (pNx >= 0 && pNx !== own2(S.next)) put(h, pNx, S.next, n);
        if (pS >= 0 && pS !== own2(S.src)) put(h, pS, S.src, n);
      }
      if (pAcc < 0 || pSink < 0 || pO < 0 || pNx < 0 || pS < 0) {
        searchWasmStats.accJs++;
        return js.accumulate(S, acc, onSink);
      }
      if (pAcc !== own) put(h, pAcc, acc, n);
      const ns = ex.search_accumulate(pO, pNx, pS, n, k, pAcc, n, f64 ? 1 : 0, pSink);
      if (ns < 0) throw new Error(`search_accumulate returned ${ns}`);
      if (pAcc !== own) {
        if (f64) acc.set(new Float64Array(h.memory.buffer, pAcc, n));
        else acc.set(new Float32Array(h.memory.buffer, pAcc, n));
      }
      searchWasmStats.accWasm++;
      if (onSink && ns > 0) {
        // replay in walk order (records copied out first: a callback may call into the kernels again)
        const F = new Float64Array(h.memory.buffer, pSink, 2 * ns).slice(), I = new Int32Array(h.memory.buffer, pSink, 4 * ns).slice();
        for (let q = 0; q < ns; q++) onSink(I[4 * q + 2], F[2 * q], I[4 * q + 3]);
      }
    } catch (e) {
      failed(e);
      searchWasmStats.accJs++;
      js.accumulate(S, acc, onSink);
    }
  }

  return { ...js, Search: WasmSearch, roadSearch, transitSearch, accumulate } as SearchApi;
}

/** true when `S` is a search of a makeSearchKernels API whose arrays live in wasm memory */
export function isResidentSearch(S: object): boolean {
  const x = (S as { _holds?: Holder[] })._holds?.[0];
  return !!x && x.heap !== null && x.blk !== null;
}
