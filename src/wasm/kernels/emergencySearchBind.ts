/**
 * WebAssembly bindings for the road searches of src/sim/infra/emergency.ts (Rust: search.rs chunk_* / dispatch_*):
 *
 *  - ChunkedSearch (exported by emergency.ts): resumable forward multi-source search for the response layers (roadSearch's
 *    labels, settled in chunks of maxSettle nodes). Public API: dist, settled, start(n, seeds, limit), step(g, adj, time,
 *    maxSettle) -> done.
 *  - DispatchSearch (private to emergency.ts): reverse search from the incident's nodes with an early exit; at settled
 *    nodes with station entries (stHead[u] >= 0) the kernel YIELDS to JS, the visitor runs in JS and may lower `stop`,
 *    then the kernel resumes (or stops when the visitor returns true). Public API: dist, next, stop, settled, d(v),
 *    nx(v), run(g, tm, seeds, ns, limit, stHead, visit).
 *
 * Both classes keep ALL their state in typed arrays that live in wasm memory (pinned heap blocks, re-pointed when memory
 * grows) or in plain arrays when wasm is unavailable, and every start / step / run executes either in wasm or through
 * the exact JS port below on the same arrays — so the choice can change from call to call without changing results.
 * DispatchSearch mirrors the JS capacities (n + n/4 + 16 node arrays, nb + 64 bucket heads, 1.25 x (4n + ns + 64)
 * entries, zeroed / -1 on growth) and its stamps exactly: the JS class carries state across runs (stamps, bucket heads
 * of the last bucket), and the port reproduces even that. ChunkedSearch fully resets its queue in start(), so its
 * queue uses the (node, next) pair layout of the other kernels.
 *
 * No emergency.ts import (the benchmark plugin swaps these classes into the real system with a source transform).
 */
import type { RoadGraph } from '../../sim/infra/graph';
import type { Seeds } from '../../sim/infra/search';
import { simWasmCallFailed, type SimWasmInstance } from '../simWasm';
import { scratchSlot, type WasmHeap } from '../heap';
import { SEARCH_KERNEL, allocHolder, block, cachedGraphArray, freeHolder, liveBlock, stage, type Holder, type Resident } from './searchShared';

export interface EmergencySearchParams {
  NET_TIME: readonly number[];
  RAMP_PENALTY: number;
  /** Network.Highway */
  HIGHWAY: number;
}

interface EmExports {
  search_chunk_start(st: number, sNode: number, sLabel: number, ns: number, limit: number, invQ: number, dist: number, done: number, head: number, ent: number): number;
  search_chunk_step(st: number, adj: number, time: number, typ: number, hw: number, rampPen: number, maxSettle: number, dist: number, done: number, head: number, ent: number): number;
  search_dispatch(op: number, st: number, seeds: number, adj: number, time: number, typ: number, hw: number, rampPen: number, stHead: number,
    dist: number, next: number, mark: number, done: number, cap: number, head: number, enode: number, enext: number): number;
}

export const emergencySearchStats = { chunkWasm: 0, chunkJs: 0, dispatchWasm: 0, dispatchJs: 0, yields: 0 };

const S_CST = scratchSlot(), S_DST = scratchSlot(), S_TM = scratchSlot(), S_STH = scratchSlot(), S_SEEDN = scratchSlot(), S_SEEDL = scratchSlot();
const isInt = (v: number) => v === (v | 0);

export interface EmergencySearchKernels {
  ChunkedSearch: new () => ChunkedSearchLike;
  DispatchSearch: new () => DispatchSearchLike;
}
export interface ChunkedSearchLike {
  dist: Float64Array;
  settled: number;
  start(n: number, seeds: Seeds, limit: number): void;
  step(g: RoadGraph, adj: Int32Array, time: Float32Array, maxSettle: number): boolean;
}
export interface DispatchSearchLike {
  dist: Float64Array;
  next: Int32Array;
  stop: number;
  settled: number;
  d(v: number): number;
  nx(v: number): number;
  run(g: RoadGraph, tm: Float32Array, seeds: Int32Array, ns: number, limit: number, stHead: Int32Array | null, visit: ((u: number, d: number) => boolean) | null): void;
}

/**
 * A dispatch run usually stops after a few station nodes (dense1m: ~100 of 23k nodes settled, 8 µs in JS); the wasm
 * path's fixed per-run cost (staging the node times and station heads, 2 x 4n bytes) is larger than that, so the run
 * goes to wasm only while recent runs settled at least this many nodes on average (breakeven measured at ~300; runs
 * that search the whole graph are 1.45x faster in wasm). Both paths are bit-identical, so the choice is unobservable.
 */
export const DISPATCH_WASM_MIN_SETTLED = 1000;

export function makeEmergencySearchKernels(
  p: EmergencySearchParams, opts: { instance?: () => SimWasmInstance | null; dispatchMinSettled?: number } = {},
): EmergencySearchKernels {
  const inst = opts.instance ?? (() => SEARCH_KERNEL.instance());
  const dispatchMin = opts.dispatchMinSettled ?? DISPATCH_WASM_MIN_SETTLED;
  const MIN_T = Math.min(p.NET_TIME[1], p.NET_TIME[2], p.NET_TIME[3], p.NET_TIME[4], p.NET_TIME[5]);
  const QB = MIN_T * 0.999;
  const HW = p.HIGHWAY, RP = p.RAMP_PENALTY;
  const qOk = Number.isFinite(1 / QB) && 1 / QB > 0 && 1 / QB < 1e6;

  /** graph inputs in wasm memory for n nodes, or null (JS then runs the call) */
  function graphIn(w: SimWasmInstance, g: RoadGraph, adj: Int32Array, time: Float32Array, n: number): [number, number, number] | null {
    if (!qOk || !(adj instanceof Int32Array) || adj.length < 4 * n || !(time instanceof Float32Array) || time.length < n || !(g.type instanceof Uint8Array) || g.type.length < n) return null;
    const a = cachedGraphArray(w, adj, g.version, 4 * n, n);
    if (!a.ok) return null;
    const t = cachedGraphArray(w, g.type, g.version, n, -1);
    return [a.ptr, stage(w.heap, S_TM, time, n), t.ptr];
  }

  // ============================================================================================== ChunkedSearch
  class WasmChunkedSearch implements ChunkedSearchLike, Resident {
    dist: Float64Array<ArrayBuffer> = new Float64Array(0);
    private done: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    private head: Int32Array<ArrayBuffer> = new Int32Array(0);
    /** (node, next) pairs */
    private ent: Int32Array<ArrayBuffer> = new Int32Array(0);
    private en = 0;
    private b = 0;
    private nb = 0;
    private limit = 0;
    private n = 0;
    settled = 0;
    /** capacities: dist / done (JS policy n + n/8 + 16), head, entry pairs */
    private cap = 0;
    private hcap = 0;
    private ecap = 0;
    readonly _holds: Holder[] = [{ heap: null, blk: null }, { heap: null, blk: null }];
    _ref?: WeakRef<Resident>;
    _fin?: boolean;

    _bindViews(): void {
      const [a, q] = this._holds;
      if (a.blk) {
        const buf = a.blk.buffer as ArrayBuffer, o = a.blk.byteOffset;
        this.dist = new Float64Array(buf, o, this.cap);
        this.done = new Uint8Array(buf, o + 8 * this.cap, this.cap);
      }
      if (q.blk) {
        const buf = q.blk.buffer as ArrayBuffer, o = q.blk.byteOffset;
        this.head = new Int32Array(buf, o, this.hcap);
        this.ent = new Int32Array(buf, o + 4 * this.hcap, 2 * this.ecap);
      }
    }

    /** ensure capacities (JS policy for dist / done; queue: nb heads, `entries` pairs); resident in h when given */
    private ensureCap(n: number, nb: number, entries: number, h: WasmHeap | null): boolean {
      const cap = this.dist.length < n ? n + (n >> 3) + 16 : this.dist.length;
      const hcap = this.head.length < nb ? nb + 64 : this.head.length;
      const ecap = this.ent.length < 2 * entries ? entries + (entries >> 2) : this.ent.length >> 1;
      const [a, q] = this._holds;
      if (h === null) {
        // plain arrays (JS only); fresh arrays where the capacity grew
        if (cap !== this.dist.length || a.blk) {
          const d = new Float64Array(cap), dn = new Uint8Array(cap);
          if (cap === this.dist.length) { d.set(this.dist); dn.set(this.done); }
          this.dist = d; this.done = dn;
        }
        if (hcap !== this.head.length || q.blk) { const hh = new Int32Array(hcap); if (hcap === this.head.length) hh.set(this.head); this.head = hh; }
        if (2 * ecap !== this.ent.length || q.blk) { const e = new Int32Array(2 * ecap); if (2 * ecap === this.ent.length) e.set(this.ent); this.ent = e; }
        freeHolder(a); freeHolder(q);
        this.cap = cap; this.hcap = hcap; this.ecap = ecap;
        return true;
      }
      const needA = a.heap !== h || !a.blk || cap !== this.cap || this.dist.length !== cap;
      const needQ = q.heap !== h || !q.blk || hcap !== this.hcap || ecap !== this.ecap || this.head.length !== hcap;
      if (!needA && !needQ) {
        liveBlock(a); liveBlock(q);
        if (this.dist.buffer !== h.memory.buffer) this._bindViews();
        return true;
      }
      const prev = { dist: this.dist, done: this.done, head: this.head, ent: this.ent };
      const oldA: Holder = { ...a }, oldQ: Holder = { ...q };
      if (needA && !allocHolder(h, a, 9 * cap, this)) { Object.assign(a, oldA); return false; }
      if (needQ && !allocHolder(h, q, 4 * hcap + 8 * ecap, this)) { Object.assign(q, oldQ); return false; }
      this.cap = cap; this.hcap = hcap; this.ecap = ecap;
      this._bindViews();
      // keep contents where JS would keep them (same capacity); new capacity = zeroed arrays, as in JS
      if (needA && prev.dist.length === cap) { this.dist.set(prev.dist); this.done.set(prev.done); }
      if (needQ && prev.head.length === hcap) this.head.set(prev.head);
      if (needQ && prev.ent.length === 2 * ecap) this.ent.set(prev.ent);
      if (needA) freeHolder(oldA);
      if (needQ) freeHolder(oldQ);
      return true;
    }

    start(n: number, seeds: Seeds, limit: number): void {
      this.n = n;
      if (!(limit < 2000)) limit = 2000;
      const invQ = 1 / QB;
      const nb = Math.ceil(limit * invQ) + 2;
      const w = inst();
      const ns = seeds.n;
      const useWasm = w !== null && qOk && isInt(n) && n >= 0 && n <= 1 << 25 && isInt(ns) && ns >= 0 && seeds.node instanceof Int32Array &&
        seeds.label instanceof Float64Array && seeds.node.length >= ns && seeds.label.length >= ns && nb <= 1 << 26;
      if (!this.ensureCap(n, Math.max(0, nb) + 1, 4 * n + ns + 64, useWasm ? w!.heap : null) || !useWasm) {
        if (useWasm) this.ensureCap(n, Math.max(0, nb) + 1, 4 * n + ns + 64, null);
        emergencySearchStats.chunkJs++;
        return this.startJs(n, seeds, limit, nb);
      }
      const h = w!.heap, ex = w!.exports as unknown as EmExports;
      try {
        const pSt = block(h, S_CST, 48);
        const pN = stage(h, S_SEEDN, seeds.node, ns), pL = stage(h, S_SEEDL, seeds.label, ns);
        const I = new Int32Array(h.memory.buffer, pSt, 12);
        I[0] = n; I[5] = this.hcap; I[6] = 2 * this.ecap;
        const r = ex.search_chunk_start(pSt, pN, pL, ns, limit, invQ, this.dist.byteOffset, this.done.byteOffset, this.head.byteOffset, this.ent.byteOffset);
        if (r < 0) throw new Error(`search_chunk_start returned ${r}`);
        this.readState(h, pSt);
        emergencySearchStats.chunkWasm++;
      } catch (e) {
        simWasmCallFailed('search', e);
        emergencySearchStats.chunkJs++;
        this.startJs(n, seeds, limit, nb);
      }
    }

    private readState(h: WasmHeap, pSt: number): void {
      const I = new Int32Array(h.memory.buffer, pSt, 12), F = new Float64Array(h.memory.buffer, pSt + 32, 2);
      this.nb = I[1]; this.b = I[2]; this.en = I[3]; this.settled = I[4]; this.limit = F[0];
    }

    /** ChunkedSearch.start of emergency.ts (queue in the pair layout) */
    private startJs(n: number, seeds: Seeds, limit: number, nb: number): void {
      this.dist.fill(Infinity, 0, n);
      this.done.fill(0, 0, n);
      this.limit = limit;
      const invQ = 1 / QB;
      this.nb = nb;
      this.head.fill(-1, 0, nb);
      this.en = 0;
      this.b = 0;
      this.settled = 0;
      const dist = this.dist, head = this.head, E = this.ent;
      for (let s = 0; s < seeds.n; s++) {
        const v = seeds.node[s];
        const l = seeds.label[s];
        if (v < 0 || v >= n || !(l <= limit)) continue;
        if (l < dist[v]) {
          dist[v] = l;
          const bi = (l * invQ) | 0;
          if (bi >= 0 && bi < nb) { E[2 * this.en] = v; E[2 * this.en + 1] = head[bi]; head[bi] = this.en++; }
        }
      }
    }

    step(g: RoadGraph, adj: Int32Array, time: Float32Array, maxSettle: number): boolean {
      const w = inst();
      const n = this.n;
      const resident = w !== null && this._holds[0].heap === w.heap && this._holds[1].heap === w.heap;
      const gi = resident && isInt(maxSettle) ? graphIn(w!, g, adj, time, n) : null;
      if (gi === null) {
        emergencySearchStats.chunkJs++;
        return this.stepJs(g, adj, time, maxSettle);
      }
      const h = w!.heap, ex = w!.exports as unknown as EmExports;
      try {
        const pSt = block(h, S_CST, 48);
        liveBlock(this._holds[0]); liveBlock(this._holds[1]);
        if (this.dist.buffer !== h.memory.buffer) this._bindViews();
        const I = new Int32Array(h.memory.buffer, pSt, 12), F = new Float64Array(h.memory.buffer, pSt + 32, 2);
        I[0] = n; I[1] = this.nb; I[2] = this.b; I[3] = this.en; I[4] = this.settled; I[5] = this.hcap; I[6] = 2 * this.ecap;
        F[0] = this.limit; F[1] = 1 / QB;
        const r = ex.search_chunk_step(pSt, gi[0], gi[1], gi[2], HW, RP, maxSettle, this.dist.byteOffset, this.done.byteOffset, this.head.byteOffset, this.ent.byteOffset);
        this.readState(h, pSt);
        emergencySearchStats.chunkWasm++;
        return r === 1;
      } catch (e) {
        simWasmCallFailed('search', e);
        emergencySearchStats.chunkJs++;
        return this.stepJs(g, adj, time, maxSettle);
      }
    }

    /** ChunkedSearch.step of emergency.ts (queue in the pair layout) */
    private stepJs(g: RoadGraph, adj: Int32Array, time: Float32Array, maxSettle: number): boolean {
      const nb = this.nb, limit = this.limit, n = this.n;
      const dist = this.dist, done = this.done, head = this.head, E = this.ent;
      const invQ = 1 / QB;
      const type = g.type;
      let en = this.en;
      let cnt = this.settled;
      const stopAt = cnt + maxSettle;
      let b = this.b;
      outer: for (; b < nb; b++) {
        let e = head[b];
        while (e >= 0) {
          if (cnt >= stopAt) { head[b] = e; break outer; }
          const u = E[2 * e];
          e = E[2 * e + 1];
          if (u >= n || done[u] === 1) continue;
          done[u] = 1;
          cnt++;
          const key = dist[u];
          const tu = time[u];
          const hu = type[u] === HW;
          const base = u * 4;
          for (let k = 0; k < 4; k++) {
            const v = adj[base + k];
            if (v < 0 || done[v] === 1) continue;
            let c = 0.5 * (tu + time[v]);
            if (hu !== (type[v] === HW)) c += RP;
            const nd = key + c;
            if (nd < dist[v] && nd <= limit) {
              dist[v] = nd;
              const bi = (nd * invQ) | 0;
              const bb = bi > b ? bi : b + 1;
              if (bb < nb) { E[2 * en] = v; E[2 * en + 1] = head[bb]; head[bb] = en++; }
            }
          }
        }
        head[b] = -1;
      }
      this.b = b;
      this.en = en;
      this.settled = cnt;
      return b >= nb;
    }
  }

  // ============================================================================================== DispatchSearch
  class WasmDispatchSearch implements DispatchSearchLike, Resident {
    dist: Float64Array<ArrayBuffer> = new Float64Array(0);
    next: Int32Array<ArrayBuffer> = new Int32Array(0);
    private mark: Uint32Array<ArrayBuffer> = new Uint32Array(0);
    private done: Uint32Array<ArrayBuffer> = new Uint32Array(0);
    private stampV = 0;
    private head: Int32Array<ArrayBuffer> = new Int32Array(0);
    private enext: Int32Array<ArrayBuffer> = new Int32Array(0);
    private enode: Int32Array<ArrayBuffer> = new Int32Array(0);
    stop = Infinity;
    settled = 0;
    /** moving average of the settled nodes per run (drives the JS / wasm choice, see DISPATCH_WASM_MIN_SETTLED) */
    private avgSettled = 0;
    /** holders: node arrays [dist | next | mark | done], bucket heads, entries [enode | enext] */
    readonly _holds: Holder[] = [{ heap: null, blk: null }, { heap: null, blk: null }, { heap: null, blk: null }];
    _ref?: WeakRef<Resident>;
    _fin?: boolean;
    private cap = 0;
    private hcap = 0;
    private ecap = 0;

    d(v: number): number {
      return this.mark[v] === this.stampV ? this.dist[v] : Infinity;
    }
    nx(v: number): number {
      return this.mark[v] === this.stampV ? this.next[v] : -1;
    }

    _bindViews(): void {
      const [a, hh, q] = this._holds;
      const c = this.cap;
      if (a.blk) {
        const buf = a.blk.buffer as ArrayBuffer, o = a.blk.byteOffset;
        this.dist = new Float64Array(buf, o, c);
        this.next = new Int32Array(buf, o + 8 * c, c);
        this.mark = new Uint32Array(buf, o + 12 * c, c);
        this.done = new Uint32Array(buf, o + 16 * c, c);
      }
      if (hh.blk) this.head = new Int32Array(hh.blk.buffer as ArrayBuffer, hh.blk.byteOffset, this.hcap);
      if (q.blk) {
        const buf = q.blk.buffer as ArrayBuffer, o = q.blk.byteOffset;
        this.enode = new Int32Array(buf, o, this.ecap);
        this.enext = new Int32Array(buf, o + 4 * this.ecap, this.ecap);
      }
    }

    /** move the current arrays (same capacities, same contents) into heap h; false when memory cannot be had */
    private makeResident(h: WasmHeap): boolean {
      const [a, hh, q] = this._holds;
      if (a.heap === h && hh.heap === h && q.heap === h && a.blk && hh.blk && q.blk) {
        liveBlock(a); liveBlock(hh); liveBlock(q);
        if (this.dist.buffer !== h.memory.buffer) this._bindViews();
        return true;
      }
      const prev = { dist: this.dist, next: this.next, mark: this.mark, done: this.done, head: this.head, enode: this.enode, enext: this.enext };
      const olds = this._holds.map((x) => ({ ...x }));
      this.cap = this.dist.length; this.hcap = this.head.length; this.ecap = this.enext.length;
      const ok = allocHolder(h, a, 20 * this.cap, this) && allocHolder(h, hh, 4 * this.hcap, this) && allocHolder(h, q, 8 * this.ecap, this);
      if (!ok) {
        this._holds.forEach((x, i) => { if (x.blk !== olds[i].blk) freeHolder(x); Object.assign(x, olds[i]); });
        return false;
      }
      this._bindViews();
      this.dist.set(prev.dist); this.next.set(prev.next); this.mark.set(prev.mark); this.done.set(prev.done);
      this.head.set(prev.head); this.enode.set(prev.enode); this.enext.set(prev.enext);
      olds.forEach(freeHolder);
      return true;
    }

    /** replace one array group by fresh arrays (JS growth semantics), resident in h when the object is */
    private regrow(group: 0 | 1 | 2, size: number, h: WasmHeap | null): boolean {
      const x = this._holds[group];
      if (h !== null && x.heap === h) {
        const old = { ...x };
        const bytes = group === 0 ? 20 * size : group === 1 ? 4 * size : 8 * size;
        if (!allocHolder(h, x, bytes, this)) { Object.assign(x, old); return false; }
        if (group === 0) this.cap = size; else if (group === 1) this.hcap = size; else this.ecap = size;
        this._bindViews();
        if (group === 1) this.head.fill(-1);
        freeHolder(old);
        return true;
      }
      if (group === 0) {
        this.dist = new Float64Array(size); this.next = new Int32Array(size); this.mark = new Uint32Array(size); this.done = new Uint32Array(size);
      } else if (group === 1) this.head = new Int32Array(size).fill(-1);
      else { this.enext = new Int32Array(size); this.enode = new Int32Array(size); }
      return true;
    }

    run(g: RoadGraph, tm: Float32Array, seeds: Int32Array, ns: number, limit: number, stHead: Int32Array | null, visit: ((u: number, d: number) => boolean) | null): void {
      this.runInner(g, tm, seeds, ns, limit, stHead, visit);
      this.avgSettled += 0.25 * (this.settled - this.avgSettled);
    }

    private runInner(g: RoadGraph, tm: Float32Array, seeds: Int32Array, ns: number, limit: number, stHead: Int32Array | null, visit: ((u: number, d: number) => boolean) | null): void {
      const n = g.n;
      const w = this.avgSettled >= dispatchMin ? inst() : null;
      let h: WasmHeap | null = null;
      if (w !== null && qOk && isInt(n) && n >= 0 && n <= 1 << 25 && this.makeResident(w.heap)) h = w.heap;
      // the JS class's capacity management, verbatim
      if (this.dist.length < n) {
        const c = n + (n >> 2) + 16;
        if (!this.regrow(0, c, h)) h = null;
        this.stampV = 0;
      }
      if (++this.stampV >= 0xfffffff0) {
        this.mark.fill(0);
        this.done.fill(0);
        this.stampV = 1;
      }
      this.settled = 0;
      if (!(limit < 2000)) limit = 2000;
      const invQ = 1 / QB;
      const nb = Math.ceil(limit * invQ) + 2;
      if (this.head.length < nb && !this.regrow(1, nb + 64, h)) h = null;
      const cap = 4 * n + ns + 64;
      if (this.enext.length < cap && !this.regrow(2, cap + (cap >> 2), h)) h = null;
      if (h !== null && (h !== w!.heap || !this._holds.every((x) => x.heap === h))) h = null;
      const okArgs = h !== null && seeds instanceof Int32Array && isInt(ns) && ns >= 0 && ns <= seeds.length && (stHead === null || (stHead instanceof Int32Array && stHead.length >= n)) &&
        (visit === null || typeof visit === 'function') && nb <= this.head.length + 1;
      const gi = okArgs ? graphIn(w!, g, g.rev, tm, n) : null;
      if (gi === null) {
        emergencySearchStats.dispatchJs++;
        return this.runJs(g, tm, seeds, ns, limit, stHead, visit, nb);
      }
      const ex = w!.exports as unknown as EmExports;
      const H = h!;
      let yielded = 0;
      try {
        const pSt = block(H, S_DST, 96);
        const pSeed = stage(H, S_SEEDN, seeds, ns);
        const pSth = stHead === null ? 0 : stage(H, S_STH, stHead, n);
        for (const x of this._holds) liveBlock(x);
        if (this.dist.buffer !== H.memory.buffer) this._bindViews();
        const I = new Int32Array(H.memory.buffer, pSt, 14), U = new Uint32Array(H.memory.buffer, pSt, 14), F = new Float64Array(H.memory.buffer, pSt + 56, 4);
        I[0] = n; I[1] = ns; I[2] = Math.max(0, Math.min(nb, 2 ** 31 - 1)); I[9] = visit ? 1 : 0; U[10] = this.stampV; I[11] = this.head.length; I[12] = this.enext.length;
        F[0] = limit; F[1] = invQ; F[2] = this.stop;
        const call = (op: number) => ex.search_dispatch(op, pSt, pSeed, gi[0], gi[1], gi[2], HW, RP, pSth, this.dist.byteOffset, this.next.byteOffset,
          this.mark.byteOffset, this.done.byteOffset, this.cap, this.head.byteOffset, this.enode.byteOffset, this.enext.byteOffset);
        let r = call(0);
        while (r === 1) {
          emergencySearchStats.yields++;
          yielded++;
          const u = I[8], key = F[3];
          if (visit!(u, key)) {
            call(2);
            break;
          }
          // the visitor may have lowered `stop` (and cannot have grown memory: it runs no kernel that allocates)
          new Float64Array(H.memory.buffer, pSt + 56, 4)[2] = this.stop;
          r = call(1);
        }
        this.settled = new Int32Array(H.memory.buffer, pSt, 14)[7];
        emergencySearchStats.dispatchWasm++;
      } catch (e) {
        // a trap (never expected: inputs are validated) leaves this run's arrays partly updated. Before the visitor ran,
        // the run is redone in JS under a fresh stamp (older marks become invalid, exactly like a new run); after it
        // ran, redoing would repeat the visitor's side effects, so the error propagates.
        simWasmCallFailed('search', e);
        if (yielded > 0) throw e;
        emergencySearchStats.dispatchJs++;
        if (++this.stampV >= 0xfffffff0) {
          this.mark.fill(0);
          this.done.fill(0);
          this.stampV = 1;
        }
        this.runJs(g, tm, seeds, ns, limit, stHead, visit, nb);
      }
    }

    /** DispatchSearch.run of emergency.ts after the capacity management (verbatim loop) */
    private runJs(g: RoadGraph, tm: Float32Array, seeds: Int32Array, ns: number, limit: number, stHead: Int32Array | null, visit: ((u: number, d: number) => boolean) | null, nb: number): void {
      const n = g.n;
      const S = this.stampV;
      const dist = this.dist, next = this.next, mark = this.mark, done = this.done;
      const invQ = 1 / QB;
      const head = this.head;
      const enext = this.enext, enode = this.enode;
      let en = 0;
      let maxB = 0;
      for (let s = 0; s < ns; s++) {
        const v = seeds[s];
        if (v < 0 || v >= n || (mark[v] === S && dist[v] === 0)) continue;
        mark[v] = S;
        dist[v] = 0;
        next[v] = -1;
        enode[en] = v;
        enext[en] = head[0];
        head[0] = en++;
      }
      const adj = g.rev, type = g.type;
      let cnt = 0;
      let b = 0;
      outer: for (; b < nb; b++) {
        let e = head[b];
        while (e >= 0) {
          const u = enode[e];
          e = enext[e];
          if (done[u] === S) continue;
          const key = dist[u];
          if (key > this.stop) break outer;
          done[u] = S;
          cnt++;
          if (visit && (!stHead || stHead[u] >= 0) && visit(u, key)) break outer;
          const tu = tm[u];
          const hu = type[u] === HW;
          const base = u * 4;
          for (let k = 0; k < 4; k++) {
            const v = adj[base + k];
            if (v < 0 || done[v] === S) continue;
            let c = 0.5 * (tu + tm[v]);
            if (hu !== (type[v] === HW)) c += RP;
            const nd = key + c;
            if ((mark[v] !== S || nd < dist[v]) && nd <= limit) {
              mark[v] = S;
              dist[v] = nd;
              next[v] = u;
              const bi = (nd * invQ) | 0;
              const bb = bi > b ? bi : b + 1;
              if (bb > maxB) maxB = bb;
              enode[en] = v;
              enext[en] = head[bb];
              head[bb] = en++;
            }
          }
        }
        head[b] = -1;
      }
      for (let q = b; q <= maxB && q < nb; q++) head[q] = -1;
      this.settled = cnt;
    }
  }

  return { ChunkedSearch: WasmChunkedSearch, DispatchSearch: WasmDispatchSearch };
}
