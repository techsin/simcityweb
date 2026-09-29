/**
 * Shared machinery of the search bindings (searchBind.ts, catchSearchBind.ts, emergencySearchBind.ts): the 'search'
 * kernel slot, memory reservation, cached staging blocks, resident arrays (typed-array views of pinned heap blocks
 * that are re-pointed when wasm memory grows and freed when their owner is garbage collected) and the road-graph
 * cache. No simulation imports.
 */
import { kernelSlot, type SimWasmInstance } from '../simWasm';
import { WasmHeapFullError, type WasmHeap } from '../heap';

/** one slot (A/B flag `search`) for every export of the Rust `search` module */
export const SEARCH_KERNEL = kernelSlot('search', [
  'search_road', 'search_transit', 'search_accumulate', 'search_check_adj', 'search_road_time_multi', 'search_road_dist_multi',
  'search_chunk_start', 'search_chunk_step', 'search_dispatch',
]);

/** explicit memory reservations (growth) done by the search bindings */
export const searchMemStats = { reserves: 0, graphCopies: 0, blocks: 0 };

/** head room added whenever a search binding has to reserve (grow) memory itself */
const GROW_SLACK = 4 << 20;

/**
 * run an allocation; when it fails because pinned views block implicit growth, reserve (grow) explicitly and retry.
 * Growth happens only here (at the start of a binding call or an ensure / start / run): the onGrow listeners re-point
 * every resident object (and adoptLayers' layers) before any caller reads them again.
 */
export function withRoom<T>(h: WasmHeap, bytes: number, f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (!(e instanceof WasmHeapFullError)) throw e;
    searchMemStats.reserves++;
    h.reserve(bytes + GROW_SLACK);
    return f();
  }
}

/** cached scratch block of >= bytes for `slot` (16-aligned, contents undefined) */
export function block(h: WasmHeap, slot: number, bytes: number): number {
  return withRoom(h, bytes, () => h.scratch(slot, Math.max(16, bytes), 16));
}

/**
 * like block(), but never grows memory while pinned views exist: -1 instead (the caller runs JS for that call). For
 * calls that callers typically make while holding local aliases of search arrays (accumulate right after a search);
 * the search calls pre-size these blocks, so in practice this never fails.
 */
export function blockNoGrow(h: WasmHeap, slot: number, bytes: number): number {
  try {
    return h.scratch(slot, Math.max(16, bytes), 16);
  } catch (e) {
    if (e instanceof WasmHeapFullError) return -1;
    throw e;
  }
}

export type Staged = Int32Array | Float32Array | Float64Array | Uint8Array | Uint16Array | Uint32Array;

/** copy a[0, len) into wasm memory at byte offset p */
export function put(h: WasmHeap, p: number, a: Staged, len: number): void {
  if (len <= 0) return;
  const src = a.length === len ? a : a.subarray(0, len);
  const buf = h.memory.buffer;
  if (a instanceof Float64Array) new Float64Array(buf, p, len).set(src as Float64Array);
  else if (a instanceof Float32Array) new Float32Array(buf, p, len).set(src as Float32Array);
  else if (a instanceof Int32Array) new Int32Array(buf, p, len).set(src as Int32Array);
  else if (a instanceof Uint32Array) new Uint32Array(buf, p, len).set(src as Uint32Array);
  else if (a instanceof Uint16Array) new Uint16Array(buf, p, len).set(src as Uint16Array);
  else new Uint8Array(buf, p, len).set(src as Uint8Array);
}

/** pointer of a[0, len) in wasm memory: its own offset when it lives there (zero copy), else a staged copy in `slot` */
export function stage(h: WasmHeap, slot: number, a: Staged, len: number): number {
  const own = h.ptrOf(a);
  if (own >= 0 && own % a.BYTES_PER_ELEMENT === 0) return own;
  const p = block(h, slot, len * a.BYTES_PER_ELEMENT);
  put(h, p, a, len);
  return p;
}

// ------------------------------------------------------------------------------------------------ resident arrays
/** a pinned heap block owned by a resident object (referenced by the FinalizationRegistry, never pointing back) */
export interface Holder {
  heap: WasmHeap | null;
  blk: Uint8Array | null;
}

export function freeHolder(x: Holder): void {
  if (x.heap && x.blk) {
    try {
      x.heap.free(x.blk);
    } catch {
      /* already freed / foreign heap */
    }
  }
  x.heap = null;
  x.blk = null;
}

const finalizer = typeof FinalizationRegistry !== 'undefined' ? new FinalizationRegistry<Holder[]>((hs) => hs.forEach(freeHolder)) : null;

/** an object whose typed-array fields are views of its holders' blocks */
export interface Resident {
  readonly _holds: Holder[];
  /** re-create the fields' views from the holders' (current) blocks */
  _bindViews(): void;
  _ref?: WeakRef<Resident>;
  _fin?: boolean;
}

const residents = new WeakMap<WasmHeap, Set<WeakRef<Resident>>>();

function track(h: WasmHeap, s: Resident): void {
  let set = residents.get(h);
  if (!set) {
    const fresh = new Set<WeakRef<Resident>>();
    residents.set(h, (set = fresh));
    h.onGrow((heap) => {
      for (const r of fresh) {
        const x = r.deref();
        if (!x || !x._holds.some((q) => q.heap === heap)) {
          fresh.delete(r);
          continue;
        }
        for (const q of x._holds) if (q.heap === heap && q.blk) q.blk = heap.refresh(q.blk);
        x._bindViews();
      }
    });
  }
  if (!s._ref) s._ref = new WeakRef<Resident>(s);
  set.add(s._ref);
  if (finalizer && !s._fin) {
    s._fin = true;
    finalizer.register(s, s._holds);
  }
}

/**
 * give holder `x` of `owner` a fresh zero-filled pinned block of `bytes` in heap `h` (the previous block is NOT freed:
 * the caller copies what it needs and then calls freeHolder on a copy of the old holder). Returns false when the
 * memory cannot be had (the caller runs JS on plain arrays).
 */
export function allocHolder(h: WasmHeap, x: Holder, bytes: number, owner: Resident): boolean {
  let blk: Uint8Array;
  try {
    blk = withRoom(h, bytes, () => h.allocArray(Uint8Array, Math.max(16, bytes), 16));
  } catch (e) {
    if (e instanceof WasmHeapFullError || e instanceof RangeError) return false;
    throw e;
  }
  searchMemStats.blocks++;
  x.heap = h;
  x.blk = blk;
  track(h, owner);
  return true;
}

/** the holder's block re-pointed to the current buffer (a growth that happened before tracking) */
export function liveBlock(x: Holder): Uint8Array | null {
  if (!x.heap || !x.blk) return null;
  if (x.blk.buffer !== x.heap.memory.buffer) x.blk = x.heap.refresh(x.blk);
  return x.blk;
}

// ------------------------------------------------------------------------------------------------ graph cache
/**
 * Road-graph arrays (adjacency, node types) copied into wasm memory once per (array object, graph version, length).
 * RoadGraph rebuilds reuse their arrays and bump `version`, so (identity, version) identifies the contents; an array
 * mutated in place WITHOUT a version bump would be served stale (no RoadGraph code does that).
 */
export interface CacheEntry {
  arr: ArrayBufferView;
  ver: number;
  len: number;
  /** adjacency: node count the values were validated against (-1 = not an adjacency) */
  n: number;
  ptr: number;
  owned: boolean;
  ok: boolean;
  used: number;
}
const CACHE_MAX = 8;
const caches = new WeakMap<WasmHeap, { ents: CacheEntry[]; clock: number }>();

export function cachedGraphArray(w: SimWasmInstance, arr: Int32Array | Uint8Array, ver: number, len: number, adjN: number): CacheEntry {
  const h = w.heap;
  let c = caches.get(h);
  if (!c) caches.set(h, (c = { ents: [], clock: 0 }));
  c.clock++;
  for (const e of c.ents) {
    if (e.arr === arr && e.ver === ver && e.len === len && e.n === adjN && (e.owned || h.ptrOf(arr) === e.ptr)) {
      e.used = c.clock;
      return e;
    }
  }
  // older versions of the same array are dead (its contents changed): free them first, so the new copy can reuse the
  // block instead of growing memory
  for (let k = c.ents.length - 1; k >= 0; k--) {
    const e = c.ents[k];
    if (e.arr === arr && e.len === len && e.ver !== ver) {
      c.ents.splice(k, 1);
      if (e.owned) h.free(e.ptr);
    }
  }
  if (c.ents.length >= CACHE_MAX) {
    let lru = 0;
    for (let k = 1; k < c.ents.length; k++) if (c.ents[k].used < c.ents[lru].used) lru = k;
    const old = c.ents.splice(lru, 1)[0];
    if (old.owned) h.free(old.ptr);
  }
  const bpe = arr instanceof Int32Array ? 4 : 1;
  const bytes = Math.max(16, len * bpe);
  const own = h.ptrOf(arr);
  let ptr: number, owned: boolean;
  if (own >= 0 && own % bpe === 0) {
    ptr = own;
    owned = false;
  } else {
    ptr = withRoom(h, bytes, () => h.alloc(bytes));
    owned = true;
    put(h, ptr, arr, len);
    searchMemStats.graphCopies++;
  }
  let ok = true;
  if (adjN >= 0) ok = (w.exports as unknown as { search_check_adj(p: number, l: number, n: number): number }).search_check_adj(ptr, len, adjN) === 1;
  const e: CacheEntry = { arr, ver, len, n: adjN, ptr, owned, ok, used: c.clock };
  c.ents.push(e);
  return e;
}

/** drop every cached graph copy of this heap (tests / benchmarks, e.g. after mutating a graph in place) */
export function clearSearchGraphCache(h: WasmHeap): void {
  const c = caches.get(h);
  if (!c) return;
  for (const e of c.ents) if (e.owned) h.free(e.ptr);
  c.ents.length = 0;
}
