/**
 * Ferries (WP7-9, owner WP7b): links between ferry terminals over water. Headless: no DOM / three.js.
 *
 *  front water cells  the cells just beyond the terminal's front edge (Building.rot: 0 +Z, 1 +X, 2 -Z, 3 -X) that are
 *                     water; a terminal whose front misses the water uses any water cell 4-adjacent to its footprint.
 *  links              a 4-neighbour BFS over water cells from each terminal's front cells, at most FERRY_MAX_CELLS
 *                     steps, finds its FERRY_PARTNERS nearest partner terminals (a partner's front cell reached) — so
 *                     only terminals on the same water body link, and bridges (road cells over water) do not block
 *                     boats. Links are symmetric (a picks b or b picks a). Crossing time = steps x FERRY_TIME_PER_CELL.
 *  cache              computeFerryNet is pure; traffic keeps the result and recomputes it only when the terminal set or
 *                     the water layer changes (ferryKey).
 * The link path (cell indices, a -> b) is kept for the renderer (ferry boats, render team) and the inspector.
 */
import type { CityState } from '../CityState';
import { FERRY_MAX_CELLS, FERRY_PARTNERS, FERRY_TIME_PER_CELL } from './params';

export interface FerryTerminal {
  id: number;
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
}

export interface FerryLink {
  /** terminal building ids (a < b) */
  a: number;
  b: number;
  /** water cells a -> b (cell indices, travel order) */
  cells: Uint32Array;
  /** BFS steps between the two terminals' front cells */
  steps: number;
  /** crossing minutes */
  minutes: number;
}

export interface FerryPartner {
  id: number;
  minutes: number;
}

export interface FerryNet {
  links: FerryLink[];
  /** partners per terminal id (nearest first) */
  partners: Map<number, FerryPartner[]>;
}

/** front water cells of a footprint (falls back to any 4-adjacent water cell); returns the count written to out */
export function frontWaterCells(st: CityState, x0: number, z0: number, w: number, d: number, rot: number, out: number[]): number {
  const N = st.size, water = st.water;
  out.length = 0;
  const push = (x: number, z: number) => {
    if (x < 0 || z < 0 || x >= N || z >= N) return;
    const i = z * N + x;
    if (water[i]) out.push(i);
  };
  if (rot === 0 || rot === 2) {
    const z = rot === 0 ? z0 + d : z0 - 1;
    for (let x = x0; x < x0 + w; x++) push(x, z);
  } else {
    const x = rot === 1 ? x0 + w : x0 - 1;
    for (let z = z0; z < z0 + d; z++) push(x, z);
  }
  if (out.length > 0) return out.length;
  for (let x = x0; x < x0 + w; x++) { push(x, z0 - 1); push(x, z0 + d); }
  for (let z = z0; z < z0 + d; z++) { push(x0 - 1, z); push(x0 + w, z); }
  return out.length;
}

// BFS scratch (single-threaded; sized per map)
let dist = new Int32Array(0);
let par = new Int32Array(0);
let queue = new Int32Array(0);
let owner = new Int32Array(0);
function ensure(C: number): void {
  if (dist.length >= C) return;
  dist = new Int32Array(C).fill(-1);
  par = new Int32Array(C);
  queue = new Int32Array(C);
  owner = new Int32Array(C).fill(-1);
}

interface Hit { t: number; steps: number; cell: number }

/**
 * BFS over water from `starts`, stopping after `maxHits` terminals (other than `self`) were reached or beyond
 * FERRY_MAX_CELLS steps. owner[] marks the front cells of the terminals (index into the terminal list). Every touched
 * cell is in queue[0, visited): resetTouched(visited) clears the marks in O(visited).
 */
function bfs(st: CityState, starts: readonly number[], self: number, maxHits: number): { hits: Hit[]; visited: number } {
  const N = st.size, water = st.water;
  let qh = 0, qt = 0;
  for (const s of starts) {
    if (dist[s] >= 0) continue;
    dist[s] = 0;
    par[s] = -1;
    queue[qt++] = s;
  }
  const hits: Hit[] = [];
  const seen = new Set<number>();
  while (qh < qt && hits.length < maxHits) {
    const u = queue[qh++];
    const du = dist[u];
    const o = owner[u];
    if (o >= 0 && o !== self && !seen.has(o)) {
      seen.add(o);
      hits.push({ t: o, steps: du, cell: u });
      if (hits.length >= maxHits) break;
    }
    if (du >= FERRY_MAX_CELLS) continue;
    const x = u % N, z = (u - x) / N;
    for (let k = 0; k < 4; k++) {
      const nx = k === 0 ? x + 1 : k === 2 ? x - 1 : x;
      const nz = k === 1 ? z + 1 : k === 3 ? z - 1 : z;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const v = nz * N + nx;
      if (!water[v] || dist[v] >= 0) continue;
      dist[v] = du + 1;
      par[v] = u;
      queue[qt++] = v;
    }
  }
  return { hits, visited: qt };
}

function resetTouched(n: number): void {
  for (let k = 0; k < n; k++) dist[queue[k]] = -1;
}

function pathTo(cell: number): number[] {
  const out: number[] = [];
  for (let v = cell, guard = 0; v >= 0 && guard < 1 << 20; v = par[v], guard++) out.push(v);
  return out; // cell -> start
}

/** ferry links between the given terminals (pure; deterministic in the terminal order) */
export function computeFerryNet(st: CityState, terminals: readonly FerryTerminal[]): FerryNet {
  const C = st.cells;
  ensure(C);
  const fronts: number[][] = [];
  const tmp: number[] = [];
  for (let t = 0; t < terminals.length; t++) {
    const f = terminals[t];
    frontWaterCells(st, f.x, f.z, f.w, f.d, f.rot, tmp);
    fronts.push(tmp.slice());
    for (const c of tmp) if (owner[c] < 0) owner[c] = t;
  }
  const pairs = new Map<string, FerryLink>();
  for (let t = 0; t < terminals.length; t++) {
    if (fronts[t].length === 0) continue;
    const { hits, visited } = bfs(st, fronts[t], t, FERRY_PARTNERS);
    for (const h of hits) {
      const A = terminals[t].id, B = terminals[h.t].id;
      const key = A < B ? `${A}:${B}` : `${B}:${A}`;
      const prev = pairs.get(key);
      if (prev && prev.steps <= h.steps) continue;
      // path: from the hit cell back to this terminal's front
      const back = pathTo(h.cell); // hit -> start (terminal t)
      const cells = A < B ? back.reverse() : back; // a -> b
      pairs.set(key, { a: Math.min(A, B), b: Math.max(A, B), cells: Uint32Array.from(cells), steps: h.steps, minutes: Math.max(FERRY_TIME_PER_CELL, h.steps * FERRY_TIME_PER_CELL) });
    }
    resetTouched(visited);
  }
  for (let t = 0; t < terminals.length; t++) for (const c of fronts[t]) owner[c] = -1;
  const links = [...pairs.values()].sort((p, q) => p.a - q.a || p.b - q.b);
  const partners = new Map<number, FerryPartner[]>();
  for (const f of terminals) partners.set(f.id, []);
  for (const l of links) {
    partners.get(l.a)?.push({ id: l.b, minutes: l.minutes });
    partners.get(l.b)?.push({ id: l.a, minutes: l.minutes });
  }
  for (const list of partners.values()) list.sort((p, q) => p.minutes - q.minutes || p.id - q.id);
  return { links, partners };
}

/**
 * partners a terminal placed at (x, z, w, d, rot) would link to (plop preview): up to FERRY_PARTNERS existing terminals
 * on the same water body within FERRY_MAX_CELLS, nearest first
 */
export function ferryPartnersAt(st: CityState, terminals: readonly FerryTerminal[], x: number, z: number, w: number, d: number, rot: number): FerryPartner[] {
  ensure(st.cells);
  const tmp: number[] = [];
  for (let t = 0; t < terminals.length; t++) {
    const f = terminals[t];
    frontWaterCells(st, f.x, f.z, f.w, f.d, f.rot, tmp);
    for (const c of tmp) if (owner[c] < 0) owner[c] = t;
  }
  const own: number[] = [];
  frontWaterCells(st, x, z, w, d, rot, own);
  let hits: Hit[] = [];
  if (own.length > 0) {
    const r = bfs(st, own, -1, FERRY_PARTNERS);
    hits = r.hits;
    resetTouched(r.visited);
  }
  for (let t = 0; t < terminals.length; t++) {
    const f = terminals[t];
    frontWaterCells(st, f.x, f.z, f.w, f.d, f.rot, tmp);
    for (const c of tmp) owner[c] = -1;
  }
  return hits.map((h) => ({ id: terminals[h.t].id, minutes: Math.max(FERRY_TIME_PER_CELL, h.steps * FERRY_TIME_PER_CELL) }));
}

/** cheap key of the water layer (terraforming moves shores): checksum of the water cells */
export function waterKey(st: CityState): number {
  const w = st.water;
  let h = 2166136261 >>> 0, n = 0;
  for (let i = 0; i < w.length; i++) if (w[i]) { h = Math.imul(h ^ i, 16777619) >>> 0; n++; }
  return (h ^ n) >>> 0;
}
