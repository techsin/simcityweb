/**
 * Terrain masks derived from the water layer (SIM_DEPTH_SPEC WP3 C3; also used by WP4 waterfront / tourism).
 *
 *  seaMask(st)    1 on SEA water cells: a water component that covers more than SEA_MIN_SHARE of the map, is wide
 *                 somewhere (a cell >= SEA_MIN_DEPTH cells from land) and runs along a map edge for at least
 *                 SEA_MIN_EDGE_SHARE of that side (coasts >= ~80 %, islands 100 %) — so edge-to-edge rivers (a
 *                 river mouth covers <= ~12 % of any side, however wide the river is) and lakes stay fresh water.
 *                 Sea pumps are brackish, desalination needs the sea.
 *  shoreCells(st) land cells 4-adjacent to any water cell (ascending cell index).
 *  waterDepth(st) per water cell: 4-neighbour distance (cells) to the nearest land cell (0 on land).
 *
 * Cached per CityState and validated with a cheap checksum of state.water on every call (O(cells), ~0.1 ms on 256²),
 * so terraforming never leaves them stale. Call once per pass, not per building. Headless: no DOM / three.js.
 *
 * SeaMaskRun (B2 G4, docs/dev/B2_DESIGN.md §7): seaMask in pieces for the utilities pass. On a 1M-cell map the checksum
 * costs ~1 ms and a rebuild (after a meteor, a quake or terraforming changed the water layer) 11-13 ms in one call.
 */
import type { CityState } from '../CityState';
import { SEA_MIN_DEPTH, SEA_MIN_EDGE_SHARE, SEA_MIN_SHARE } from './params';

interface MaskCache {
  cells: number;
  sum: number;
  count: number;
  sea: Uint8Array;
  shore: Int32Array;
  depth: Uint16Array;
  seaCells: number;
}
const cache = new WeakMap<CityState, MaskCache>();

function checksum(w: Uint8Array): [number, number] {
  let s = 0, n = 0;
  for (let i = 0; i < w.length; i++) if (w[i]) { s += i + 1; n++; }
  return [s, n];
}

function build(st: CityState): MaskCache {
  const N = st.size, C = st.cells, wm = st.water;
  const [sum, count] = checksum(wm);
  const depth = new Uint16Array(C);
  const sea = new Uint8Array(C);
  const queue = new Int32Array(C);
  // distance of water cells to land (multi-source BFS from land cells next to water)
  let qh = 0, qt = 0;
  const shoreList: number[] = [];
  for (let i = 0; i < C; i++) {
    if (wm[i]) { depth[i] = 0xffff; continue; }
    const x = i % N;
    const nb = (x > 0 && wm[i - 1]) || (x < N - 1 && wm[i + 1]) || (i >= N && wm[i - N]) || (i + N < C && wm[i + N]);
    if (nb) { shoreList.push(i); queue[qt++] = i; }
  }
  while (qh < qt) {
    const i = queue[qh++];
    const d = depth[i] + 1;
    const x = i % N;
    if (x > 0 && depth[i - 1] > d) { depth[i - 1] = d; queue[qt++] = i - 1; }
    if (x < N - 1 && depth[i + 1] > d) { depth[i + 1] = d; queue[qt++] = i + 1; }
    if (i >= N && depth[i - N] > d) { depth[i - N] = d; queue[qt++] = i - N; }
    if (i + N < C && depth[i + N] > d) { depth[i + N] = d; queue[qt++] = i + N; }
  }
  for (let i = 0; i < C; i++) if (depth[i] === 0xffff) depth[i] = Math.min(0xfffe, N); // all-water map
  // water components: sea if large, wide and running along a map edge (edge cells counted per side)
  const comp = new Int32Array(C).fill(-1);
  let seaCells = 0;
  const minSize = SEA_MIN_SHARE * C;
  const minEdge = SEA_MIN_EDGE_SHARE * N;
  for (let s = 0; s < C; s++) {
    if (!wm[s] || comp[s] >= 0) continue;
    qh = 0; qt = 0;
    queue[qt++] = s;
    comp[s] = s;
    let eN = 0, eS = 0, eW = 0, eE = 0, maxDepth = 0;
    while (qh < qt) {
      const i = queue[qh++];
      const x = i % N, z = (i - x) / N;
      if (z === 0) eN++;
      if (z === N - 1) eS++;
      if (x === 0) eW++;
      if (x === N - 1) eE++;
      if (depth[i] > maxDepth) maxDepth = depth[i];
      if (x > 0 && wm[i - 1] && comp[i - 1] < 0) { comp[i - 1] = s; queue[qt++] = i - 1; }
      if (x < N - 1 && wm[i + 1] && comp[i + 1] < 0) { comp[i + 1] = s; queue[qt++] = i + 1; }
      if (z > 0 && wm[i - N] && comp[i - N] < 0) { comp[i - N] = s; queue[qt++] = i - N; }
      if (z < N - 1 && wm[i + N] && comp[i + N] < 0) { comp[i + N] = s; queue[qt++] = i + N; }
    }
    if (qt > minSize && maxDepth >= SEA_MIN_DEPTH && Math.max(eN, eS, eW, eE) >= minEdge) {
      for (let q = 0; q < qt; q++) sea[queue[q]] = 1;
      seaCells += qt;
    }
  }
  return { cells: C, sum, count, sea, shore: Int32Array.from(shoreList), depth, seaCells };
}

function masks(st: CityState): MaskCache {
  const c = cache.get(st);
  if (c && c.cells === st.cells) {
    const [sum, count] = checksum(st.water);
    if (sum === c.sum && count === c.count) return c;
  }
  const m = build(st);
  cache.set(st, m);
  return m;
}

/** 1 = sea water cell */
export function seaMask(st: CityState): Uint8Array {
  return masks(st).sea;
}

/** land cells 4-adjacent to water */
export function shoreCells(st: CityState): Int32Array {
  return masks(st).shore;
}

/** per cell: distance (cells) from a water cell to the nearest land cell; 0 on land */
export function waterDepth(st: CityState): Uint16Array {
  return masks(st).depth;
}

/** number of sea cells (0 = landlocked map) */
export function seaCellCount(st: CityState): number {
  return masks(st).seaCells;
}

/**
 * Water within `d` cells (Chebyshev) of the footprint [x0, x0 + w) x [z0, z0 + h): { fresh, sea } flags.
 * `sea` may be passed in (from seaMask) to avoid the checksum when called in a loop.
 */
export function waterNear(st: CityState, x0: number, z0: number, w: number, h: number, d: number, sea: Uint8Array = seaMask(st)): { fresh: boolean; sea: boolean } {
  const N = st.size, wm = st.water;
  let fresh = false, salt = false;
  for (let z = z0 - d; z < z0 + h + d; z++) {
    if (z < 0 || z >= N) continue;
    for (let x = x0 - d; x < x0 + w + d; x++) {
      if (x < 0 || x >= N) continue;
      const i = z * N + x;
      if (!wm[i]) continue;
      if (sea[i]) salt = true;
      else fresh = true;
      if (fresh && salt) return { fresh, sea: salt };
    }
  }
  return { fresh, sea: salt };
}

// ------------------------------------------------------------------------------------------------ B2 (G4): in pieces
const P_SUM = 0, P_COPY = 1, P_SCAN = 2, P_DEPTH = 3, P_FIX = 4, P_COMP = 5;
const PHASE_NAMES = ['sum', 'copy', 'scan', 'depth', 'fix', 'comp'];
/** work units of one dequeued BFS cell (four neighbour tests) against one cell of a scan loop */
export const SEA_POP_UNITS = 4;

/**
 * seaMask(st) in pieces (B2 G4). `run(st, sumUnits, buildUnits)` does a checksum piece of `sumUnits` cells, or a rebuild
 * piece of about `buildUnits` work units (a cell of a scan loop = 1, a dequeued BFS cell = SEA_POP_UNITS), and returns
 * the sea mask when it is done (the run is then idle again). The checksum runs every pass (warm); a rebuild only after a
 * water edit, so its loops run cold (interpreted at first: ~0.1 µs per cell at dense1m), hence the two sizes:
 *  sum    the checksum of st.water by cell ranges, against the cache: a hit returns the cached mask (masks());
 *  copy   a miss: a private copy of the water layer (one piece), which every later piece reads;
 *  scan   the land / shore scan (+ the copy's checksum), depth   the distance BFS (pieces of dequeued cells),
 *  fix    the all-water fix-up, comp   the water components and the sea marking;
 *  then the result goes into the cache (unless another caller rebuilt it meanwhile) as build() would put it.
 * The loops are build()'s, in its order, so a run whose pieces follow each other with nothing in between returns exactly
 * seaMask(st) and leaves exactly the same cache. A water edit between two pieces: a checksum that spans it misses (or
 * hits an older entry, as a checksum can); a rebuild reads its copy, so its masks are those of the water at the copy.
 */
export class SeaMaskRun {
  /** the current phase (P_*) */
  phase = P_SUM;
  /** the cell cursor of the range phases (sum, scan, fix, comp) */
  i = 0;
  private sum = 0;
  private count = 0;
  /** the cache entry when the rebuild started (installed over only if nobody replaced it) */
  private c0: MaskCache | undefined = undefined;
  private wm: Uint8Array | null = null;
  private depth: Uint16Array | null = null;
  private sea: Uint8Array | null = null;
  private vis: Uint8Array | null = null;
  private queue: Int32Array | null = null;
  private shore: Int32Array | null = null;
  private qh = 0;
  private qt = 0;
  private nShore = 0;
  private inBfs = false;
  /** the sea marking cursor of a finished component (-1: none) */
  private mq = -1;
  private eN = 0;
  private eS = 0;
  private eW = 0;
  private eE = 0;
  private maxDepth = 0;
  private seaCells = 0;

  /** back to idle; the build buffers are released */
  reset(): void {
    this.phase = P_SUM;
    this.i = this.sum = this.count = this.qh = this.qt = this.nShore = this.seaCells = 0;
    this.eN = this.eS = this.eW = this.eE = this.maxDepth = 0;
    this.inBfs = false;
    this.mq = -1;
    this.c0 = undefined;
    this.wm = this.depth = this.sea = this.vis = this.queue = this.shore = null;
  }

  /** the phase's name (the step tools' labels) */
  get phaseName(): string {
    return PHASE_NAMES[this.phase];
  }

  /**
   * the estimated µs of the next piece (the cost model: O(1)): the checksum at `sumUs` per cell, the copy at `copyUs` per
   * cell, the rebuild at `buildUs` per work unit (the BFS phases count a full piece)
   */
  nextUs(cells: number, sumUnits: number, buildUnits: number, sumUs: number, copyUs: number, buildUs: number): number {
    switch (this.phase) {
      case P_SUM: return Math.max(0, Math.min(sumUnits, cells - this.i)) * sumUs;
      case P_COPY: return cells * copyUs;
      case P_SCAN: case P_FIX: return Math.max(0, Math.min(buildUnits, cells - this.i)) * buildUs;
      default: return buildUnits * buildUs;
    }
  }

  /** one piece (a checksum piece of `sumUnits` cells, a rebuild piece of `buildUnits`); the sea mask when the run is done */
  run(st: CityState, sumUnits: number, buildUnits = sumUnits): Uint8Array | null {
    const C = st.cells, N = st.size, units = buildUnits;
    switch (this.phase) {
      case P_SUM: {
        const w = st.water, end = Math.min(C, this.i + Math.max(1, sumUnits));
        let s = this.sum, n = this.count;
        for (let i = this.i; i < end; i++) if (w[i]) { s += i + 1; n++; }
        this.sum = s; this.count = n; this.i = end;
        if (end < C) return null;
        const c = cache.get(st);
        if (c && c.cells === C && s === c.sum && n === c.count) { this.reset(); return c.sea; }
        this.c0 = c;
        this.phase = P_COPY;
        return null;
      }
      case P_COPY:
        this.wm = st.water.slice(0, C);
        this.depth = new Uint16Array(C);
        this.sea = new Uint8Array(C);
        this.queue = new Int32Array(C);
        this.i = this.qt = this.sum = this.count = 0;
        this.phase = P_SCAN;
        return null;
      case P_SCAN: {
        // (build(): the checksum loop and the land / shore loop, fused: each visits the cells in ascending order)
        const wm = this.wm!, depth = this.depth!, queue = this.queue!, end = Math.min(C, this.i + Math.max(1, units));
        let qt = this.qt, s = this.sum, n = this.count;
        for (let i = this.i; i < end; i++) {
          if (wm[i]) { s += i + 1; n++; depth[i] = 0xffff; continue; }
          const x = i % N;
          const nb = (x > 0 && wm[i - 1]) || (x < N - 1 && wm[i + 1]) || (i >= N && wm[i - N]) || (i + N < C && wm[i + N]);
          if (nb) queue[qt++] = i;
        }
        this.qt = qt; this.sum = s; this.count = n; this.i = end;
        if (end >= C) { this.nShore = qt; this.qh = 0; this.phase = P_DEPTH; }
        return null;
      }
      case P_DEPTH: {
        const depth = this.depth!, queue = this.queue!;
        let qh = this.qh, qt = this.qt, pops = Math.max(1, Math.floor(units / SEA_POP_UNITS));
        while (qh < qt && pops-- > 0) {
          const i = queue[qh++];
          const d = depth[i] + 1;
          const x = i % N;
          if (x > 0 && depth[i - 1] > d) { depth[i - 1] = d; queue[qt++] = i - 1; }
          if (x < N - 1 && depth[i + 1] > d) { depth[i + 1] = d; queue[qt++] = i + 1; }
          if (i >= N && depth[i - N] > d) { depth[i - N] = d; queue[qt++] = i - N; }
          if (i + N < C && depth[i + N] > d) { depth[i + N] = d; queue[qt++] = i + N; }
        }
        this.qh = qh; this.qt = qt;
        if (qh >= qt) {
          // (the shore cells are the BFS sources: the queue's head, in build()'s shoreList order)
          this.shore = queue.slice(0, this.nShore);
          this.i = 0;
          this.phase = P_FIX;
        }
        return null;
      }
      case P_FIX: {
        const depth = this.depth!, end = Math.min(C, this.i + Math.max(1, units)), all = Math.min(0xfffe, N);
        for (let i = this.i; i < end; i++) if (depth[i] === 0xffff) depth[i] = all; // all-water map
        this.i = end;
        if (end >= C) { this.i = 0; this.vis = new Uint8Array(C); this.inBfs = false; this.mq = -1; this.seaCells = 0; this.phase = P_COMP; }
        return null;
      }
      default:
        return this.compPiece(st, C, N, units);
    }
  }

  /** the water components (build()'s comp loop: a visited flag for its comp ids, which only mark visits) */
  private compPiece(st: CityState, C: number, N: number, units: number): Uint8Array | null {
    const wm = this.wm!, depth = this.depth!, queue = this.queue!, vis = this.vis!, sea = this.sea!;
    const minSize = SEA_MIN_SHARE * C;
    const minEdge = SEA_MIN_EDGE_SHARE * N;
    let budget = Math.max(1, units);
    while (budget > 0) {
      if (this.mq >= 0) {
        const qt = this.qt, end = Math.min(qt, this.mq + budget);
        for (let q = this.mq; q < end; q++) sea[queue[q]] = 1;
        budget -= end - this.mq;
        this.mq = end;
        if (end >= qt) { this.seaCells += qt; this.mq = -1; }
        continue;
      }
      if (this.inBfs) {
        let qh = this.qh, qt = this.qt, eN = this.eN, eS = this.eS, eW = this.eW, eE = this.eE, maxDepth = this.maxDepth;
        while (qh < qt && budget > 0) {
          budget -= SEA_POP_UNITS;
          const i = queue[qh++];
          const x = i % N, z = (i - x) / N;
          if (z === 0) eN++;
          if (z === N - 1) eS++;
          if (x === 0) eW++;
          if (x === N - 1) eE++;
          if (depth[i] > maxDepth) maxDepth = depth[i];
          if (x > 0 && wm[i - 1] && !vis[i - 1]) { vis[i - 1] = 1; queue[qt++] = i - 1; }
          if (x < N - 1 && wm[i + 1] && !vis[i + 1]) { vis[i + 1] = 1; queue[qt++] = i + 1; }
          if (z > 0 && wm[i - N] && !vis[i - N]) { vis[i - N] = 1; queue[qt++] = i - N; }
          if (z < N - 1 && wm[i + N] && !vis[i + N]) { vis[i + N] = 1; queue[qt++] = i + N; }
        }
        this.qh = qh; this.qt = qt; this.eN = eN; this.eS = eS; this.eW = eW; this.eE = eE; this.maxDepth = maxDepth;
        if (qh >= qt) {
          this.inBfs = false;
          if (qt > minSize && maxDepth >= SEA_MIN_DEPTH && Math.max(eN, eS, eW, eE) >= minEdge) this.mq = 0;
        }
        continue;
      }
      if (this.i >= C) {
        const m: MaskCache = { cells: C, sum: this.sum, count: this.count, sea, shore: this.shore!, depth, seaCells: this.seaCells };
        if (cache.get(st) === this.c0) cache.set(st, m);
        this.reset();
        return sea;
      }
      const s = this.i++;
      budget--;
      if (!wm[s] || vis[s]) continue;
      this.qh = 0; this.qt = 0;
      queue[this.qt++] = s;
      vis[s] = 1;
      this.eN = this.eS = this.eW = this.eE = this.maxDepth = 0;
      this.inBfs = true;
    }
    return null;
  }
}

/** test hook (B2 G4): the cached masks of a city, if any */
export function cachedMasksForTest(st: CityState): { sea: Uint8Array; shore: Int32Array; depth: Uint16Array; seaCells: number; sum: number; count: number } | undefined {
  return cache.get(st);
}
