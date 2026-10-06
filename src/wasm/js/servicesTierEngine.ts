/**
 * Services tier engine — restructured JavaScript ("fair JS" A/B baseline of the WebAssembly port, and its JS fallback).
 *
 * Same algorithm and bit-identical results as ServicesSystem.tierWork (src/sim/infra/services.ts at commit 24f8609:
 * reachOf, splatUnion, allocSeats, reportDemand, finalizeTier, footprints, the legacy-combo loop of finish,
 * finishTransit) and the catchments.ts reach kernels (reachRaw -> reachRoad / reachEuclid / nearField / falloff), with
 * the algorithmic changes of the Rust port (wasm/sim-kernels/src/catch.rs), so that an A/B against the wasm kernels
 * measures the language / runtime and not the restructuring:
 *  1. no per-slot `new Map()` / CacheEnt objects: typed per-facility cache records (start, end, bbox, key, valid, road,
 *     pass stamp) per tier slot, looked up by building id through a typed table;
 *  2. a valid cached reach is read IN PLACE from the slot's persistent pool (the original copies every cached reach into
 *     the next pass's pool: 1.28M entries ~ 10 MB per pass on the dense 1M city); fresh / invalid reaches are appended,
 *     the pool is compacted when dead segments exceed 50 %;
 *  3. allocSeats: the wasm port caches e = min(u, a) per entry in loop 1 (cells are unique within one reach, so loop 2
 *     would recompute exactly the same e); in JS that store / load is slower than recomputing (0.91x), so the JS kernel
 *     keeps the original two loops (allocEcacheJS is the e-cache form) — each side runs its faster exact variant;
 *  4. infoOf(st, b) is hoisted into per-facility strength / radius / metric arrays (a building's def never changes);
 *  5. every phase runs as a batch over facilities with the scheduler's work accounting (U_SEARCH / U_COPY / U_ENTRY,
 *     WORK_PER_STEP) done in the kernel in the JS order, so each scheduler step stops at exactly the same facility.
 * The alloc / union / report / finalize loop bodies keep the original arithmetic and loop order.
 *
 * Data layout: every array lives in a `Space` — plain JS typed arrays here, WebAssembly linear memory for the wasm
 * backend (src/wasm/kernels/servicesBind.ts implements `TierKernels` on the same layout; if a wasm allocation ever
 * fails the engine migrates its state into a JS space and keeps going on these kernels).
 *
 * This file imports nothing from src/sim (only types): src/wasm/kernels/services.ts installs the engine into a live
 * ServicesSystem instance and passes the live constants in.
 */

// ------------------------------------------------------------------------------------------------ replicated constants
/** services.ts @ 24f8609 (module-private there): work units per step, per cell searched / cached entry / entry used */
export const WORK_PER_STEP = 120000;
export const U_SEARCH = 3.6;
export const U_COPY = 0.1;
export const U_ENTRY = 0.25;

// ------------------------------------------------------------------------------------------------ memory spaces
export type TA = Int32Array | Float32Array | Float64Array | Uint8Array;
export interface TACtor<T extends TA> {
  new (n: number): T;
  new (buffer: ArrayBuffer, byteOffset: number, length: number): T;
  readonly BYTES_PER_ELEMENT: number;
}

/** a typed array owned by the engine: `ptr` >= 0 = byte offset in wasm memory, -1 = plain JS array */
export class Buf<T extends TA> {
  private cached: T;
  constructor(readonly ctor: TACtor<T>, readonly n: number, readonly ptr: number, private readonly mem: WebAssembly.Memory | null, arr: T) {
    this.cached = arr;
  }
  /**
   * current view (re-created after wasm memory growth, which detaches the old view: its length reads 0 — cheaper to
   * test than comparing buffers); never keep it across an allocation
   */
  get v(): T {
    const c = this.cached;
    if (c.length !== this.n && this.mem !== null) return (this.cached = new this.ctor(this.mem.buffer, this.ptr, this.n));
    return c;
  }
}

export interface Space {
  readonly wasm: boolean;
  /** the linear memory of a wasm space */
  readonly memory?: WebAssembly.Memory;
  /** zero-filled array of n elements */
  alloc<T extends TA>(ctor: TACtor<T>, n: number): Buf<T>;
  free(b: Buf<TA>): void;
  /** bytes held by live blocks of this space (wasm spaces; 0 for JS memory) */
  liveBytes?(): number;
  /** free every block still allocated through this space (engine disposal; the space stays usable) */
  freeAll?(): void;
}

export const jsSpace: Space = {
  wasm: false,
  alloc<T extends TA>(ctor: TACtor<T>, n: number): Buf<T> {
    return new Buf(ctor, n, -1, null, new ctor(Math.max(0, n)));
  },
  free(): void { /* GC */ },
};

// ------------------------------------------------------------------------------------------------ JS Math (as used)
/** catchments.ts falloff: full strength up to 35 % of R, smoothstep drop to 0 at R */
export function falloff(d: number, R: number): number {
  const a = 0.35 * R;
  if (d <= a) return 1;
  if (d >= R) return 0;
  const t = (d - a) / (R - a);
  return 1 - t * t * (3 - 2 * t);
}

// ------------------------------------------------------------------------------------------------ reach
/** catchments / params constants of the reach kernels (validated integers where the Dial queue needs them) */
export interface ReachConsts {
  /** WALK_COST / DRIVE_COST indexed by Network code */
  walk: Int32Array;
  drive: Int32Array;
  /** RAMP_COST, Network.Highway, Network.Street */
  ramp: number;
  hw: number;
  street: number;
  /** CATCH_NEAR_FIELD, ROAD_RADIUS_FACTOR */
  nearField: number;
  roadFactor: number;
}

/** search scratch (catchments.ts ReachEngine + near-field buffers), sized for C cells */
export interface ReachScratch {
  visit: Int32Array;
  dstamp: Int32Array;
  dist: Int32Array;
  touched: Int32Array;
  best: Float32Array;
  head: Int32Array;
  enode: Int32Array;
  enext: Int32Array;
  fall: Float32Array;
  nfSeen: Uint8Array;
  nfQueue: Int32Array;
  stamp: number;
}

/** entries of enode / enext a search may need: 4 per settled cell + the seed ring */
export const enodeCap = (N: number): number => 4 * N * N + 8 * N + 64;
/** fall table entries (maxQ <= 8000, reads up to maxQ + 8) */
export const FALL_CAP = 8032;

function nextStamp(R: ReachScratch): number {
  if (R.stamp >= 0x7ffffff0) { R.stamp = 0; R.visit.fill(0); R.dstamp.fill(0); }
  return ++R.stamp;
}

/** catchments.reachRaw: touched[0..n) with weights best[cell]; metric 0 walk, 1 drive, 2 euclid */
export function reachRawJS(N: number, net: Uint8Array, water: Uint8Array, K: ReachConsts, R: ReachScratch,
  bx: number, bz: number, bw: number, bd: number, radius: number, metric: number): number {
  if (!(radius > 0)) return 0;
  return metric === 2 ? reachEuclidJS(N, R, bx, bz, bw, bd, radius) : reachRoadJS(N, net, water, K, R, bx, bz, bw, bd, radius, metric);
}

function reachEuclidJS(N: number, R: ReachScratch, bx: number, bz: number, bw: number, bd: number, Rad: number): number {
  const stamp = nextStamp(R);
  const visit = R.visit, best = R.best, touched = R.touched;
  const cx = bx + bw / 2 - 0.5, cz = bz + bd / 2 - 0.5;
  const half = Math.max(bw, bd) / 2;
  const Rt = Rad + half;
  const x0 = Math.max(0, Math.floor(cx - Rt)), x1 = Math.min(N - 1, Math.ceil(cx + Rt));
  const z0 = Math.max(0, Math.floor(cz - Rt)), z1 = Math.min(N - 1, Math.ceil(cz + Rt));
  let n = 0;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.max(0, Math.hypot(x - cx, z - cz) - half);
      if (d > Rad) continue;
      const v = falloff(d, Rad);
      if (v <= 0) continue;
      const i = z * N + x;
      if (visit[i] !== stamp) { visit[i] = stamp; touched[n++] = i; }
      best[i] = v;
    }
  }
  return n;
}

function nearFieldJS(N: number, net: Uint8Array, water: Uint8Array, R: ReachScratch, bx: number, bz: number, bw: number, bd: number,
  near: number, cost: Int32Array, stamp: number): number {
  const visit = R.visit, best = R.best, touched = R.touched;
  const x0 = Math.max(0, bx - near), x1 = Math.min(N - 1, bx + bw - 1 + near);
  const z0 = Math.max(0, bz - near), z1 = Math.min(N - 1, bz + bd - 1 + near);
  if (x1 < x0 || z1 < z0) return 0;
  const W = x1 - x0 + 1, H = z1 - z0 + 1;
  const seen = R.nfSeen, queue = R.nfQueue;
  seen.fill(0, 0, W * H);
  let qt = 0;
  for (let z = Math.max(bz, z0); z <= Math.min(bz + bd - 1, z1); z++) {
    for (let x = Math.max(bx, x0); x <= Math.min(bx + bw - 1, x1); x++) {
      const l = (z - z0) * W + (x - x0);
      seen[l] = 1;
      queue[qt++] = l;
    }
  }
  let n = 0;
  for (let qh = 0; qh < qt; qh++) {
    const l = queue[qh];
    const lx = l % W, lz = (l - lx) / W;
    const i = (z0 + lz) * N + x0 + lx;
    if (visit[i] !== stamp) { visit[i] = stamp; touched[n++] = i; }
    best[i] = 1;
    for (let k = 0; k < 4; k++) {
      let m: number, j: number;
      if (k === 0) { if (lx === 0) continue; m = l - 1; j = i - 1; }
      else if (k === 1) { if (lx === W - 1) continue; m = l + 1; j = i + 1; }
      else if (k === 2) { if (lz === 0) continue; m = l - W; j = i - N; }
      else { if (lz === H - 1) continue; m = l + W; j = i + N; }
      if (seen[m]) continue;
      seen[m] = 1;
      const t = net[j];
      if (cost[t] === 0 && (t !== 0 || water[j] !== 0)) continue; // barrier
      queue[qt++] = m;
    }
  }
  return n;
}

function reachRoadJS(N: number, net: Uint8Array, water: Uint8Array, K: ReachConsts, R: ReachScratch,
  bx: number, bz: number, bw: number, bd: number, radius: number, metric: number): number {
  const cost = metric === 0 ? K.walk : K.drive;
  const drive = metric === 1;
  const stamp = nextStamp(R);
  const visit = R.visit, best = R.best, touched = R.touched, dist = R.dist, dstamp = R.dstamp;
  const roadR = radius * K.roadFactor;
  const maxQ = Math.min(8000, Math.ceil(roadR * 4));
  const fall = R.fall;
  for (let q = 0; q <= maxQ + 8; q++) fall[q] = falloff(q / 4, roadR);
  let n = nearFieldJS(N, net, water, R, bx, bz, bw, bd, Math.min(K.nearField, Math.floor(radius)), cost, stamp);
  const head = R.head, enode = R.enode, enext = R.enext;
  head.fill(-1);
  let en = 0;
  let pending = 0;
  for (let z = bz - 1; z <= bz + bd; z++) {
    if (z < 0 || z >= N) continue;
    for (let x = bx - 1; x <= bx + bw; x++) {
      if (x < 0 || x >= N) continue;
      if (x >= bx && x < bx + bw && z >= bz && z < bz + bd) continue;
      const i = z * N + x;
      if (cost[net[i]] === 0 || dstamp[i] === stamp) continue;
      dstamp[i] = stamp;
      dist[i] = 0;
      enode[en] = i; enext[en] = head[0]; head[0] = en++;
      pending++;
    }
  }
  const HW = K.hw, STREET = K.street, RAMP = K.ramp;
  for (let cur = 0; pending > 0; cur++) {
    const slot = cur & 7;
    let e = head[slot];
    head[slot] = -1;
    while (e >= 0) {
      const u = enode[e];
      e = enext[e];
      pending--;
      if (dist[u] !== cur) continue;
      const v = fall[cur];
      const x = u % N, z = (u - x) / N;
      if (v > 0) {
        const v1 = fall[cur + 4];
        const zz0 = z > 0 ? z - 1 : 0, zz1 = z < N - 1 ? z + 1 : N - 1;
        const xx0 = x > 0 ? x - 1 : 0, xx1 = x < N - 1 ? x + 1 : N - 1;
        for (let zz = zz0; zz <= zz1; zz++) {
          const row = zz * N;
          for (let xx = xx0; xx <= xx1; xx++) {
            const j = row + xx;
            const w = j === u ? v : v1;
            if (visit[j] !== stamp) { visit[j] = stamp; best[j] = w; touched[n++] = j; }
            else if (w > best[j]) best[j] = w;
          }
        }
      }
      const tu = net[u];
      const hu = tu === HW;
      for (let k = 0; k < 4; k++) {
        let j: number;
        if (k === 0) { if (x === 0) continue; j = u - 1; }
        else if (k === 1) { if (x === N - 1) continue; j = u + 1; }
        else if (k === 2) { if (z === 0) continue; j = u - N; }
        else { if (z === N - 1) continue; j = u + N; }
        const tj = net[j];
        let c = cost[tj];
        if (c === 0) continue;
        if (drive && hu !== (tj === HW)) {
          if (tu === STREET || tj === STREET) continue;
          c += RAMP;
        }
        const nd = cur + c;
        if (nd > maxQ) continue;
        if (dstamp[j] !== stamp || nd < dist[j]) {
          dstamp[j] = stamp;
          dist[j] = nd;
          const s = nd & 7;
          enode[en] = j; enext[en] = head[s]; head[s] = en++;
          pending++;
        }
      }
    }
  }
  return n;
}

// ------------------------------------------------------------------------------------------------ phase kernels
/** state of one P_SEARCH batch (catch_search parameter block); scalars are updated in place */
export interface SearchArgs {
  /** tier slot (the wasm backend finds the slot's record / pool buffers through it) */
  k: number;
  N: number;
  net: Uint8Array;
  water: Uint8Array;
  K: ReachConsts;
  R: ReachScratch;
  nFac: number;
  geo: Int32Array;
  radius: Float64Array;
  metric: Int32Array;
  str: Float64Array;
  op: Float64Array;
  cap: Float64Array;
  key: Float64Array;
  rec: Int32Array;
  alive: Uint8Array;
  fs: Int32Array;
  fe: Int32Array;
  D: Float64Array;
  served: Float64Array;
  recStart: Int32Array;
  recEnd: Int32Array;
  recBox: Int32Array;
  recKey: Float64Array;
  recValid: Uint8Array;
  recRoad: Uint8Array;
  recStamp: Int32Array;
  pass: number;
  idx: Int32Array;
  w: Float32Array;
  poolCap: number;
  top: number;
  dead: number;
  splat: boolean;
  need: Float32Array;
  A: Float32Array;
  cov: Float32Array;
  cursor: number;
  nFresh: number;
  nCached: number;
  work: number;
  left: number;
  limit: number;
}

/** splatUnion over pool[q0, q1) (services.ts 24f8609); returns D, served via out[0..2) */
function splatUnionJS(idx: Int32Array, pw: Float32Array, q0: number, q1: number, s: number, op: number, S: number,
  needL: Float32Array, A: Float32Array, cov: Float32Array, out: Float64Array): void {
  let D = 0;
  for (let q = q0; q < q1; q++) { const i = idx[q]; const w = pw[q]; D += needL[i] * w; A[i] += w; }
  const r = S < Infinity && D > S ? op * (S / D) : op;
  const eff = s * r;
  let served = 0;
  if (eff > 0) {
    for (let q = q0; q < q1; q++) {
      const i = idx[q];
      let v = pw[q] * eff;
      if (v > 1) v = 1;
      served += needL[i] * v;
      cov[i] = 1 - (1 - cov[i]) * (1 - v);
    }
  }
  out[0] = D;
  out[1] = served;
}

const splatOut = new Float64Array(2);

/** P_SEARCH batch (see catch_search): returns 0 (limit / list end) or 1 (pool too full for a fresh reach) */
export function searchJS(a: SearchArgs): number {
  const N = a.N, C = N * N;
  const nf = a.nFac;
  const geo = a.geo, radius = a.radius, metric = a.metric, str = a.str, op = a.op, cap = a.cap, key = a.key, recOf = a.rec, alive = a.alive;
  const fs = a.fs, fe = a.fe, Dout = a.D, servedOut = a.served;
  const recStart = a.recStart, recEnd = a.recEnd, recBox = a.recBox, recKey = a.recKey, recValid = a.recValid, recRoad = a.recRoad, recStamp = a.recStamp;
  const pass = a.pass, idx = a.idx, pw = a.w, poolCap = a.poolCap;
  const splat = a.splat, need = a.need, A = a.A, cov = a.cov;
  const R = a.R, net = a.net, water = a.water, K = a.K;
  let top = a.top, dead = a.dead, cursor = a.cursor, nFresh = a.nFresh, nCached = a.nCached;
  let work = a.work, left = a.left;
  const limit = a.limit;
  let status = 0;
  while (cursor < nf) {
    const c = cursor;
    if (alive[c] === 0) { fs[c] = fe[c] = top; cursor++; continue; }
    const rec = recOf[c];
    let ureach: number;
    if (recValid[rec] !== 0 && recKey[rec] === key[c]) {
      const q0 = recStart[rec], q1 = recEnd[rec];
      fs[c] = q0; fe[c] = q1;
      recStamp[rec] = pass;
      nCached++;
      ureach = (q1 - q0) * U_COPY + 8;
    } else {
      if (poolCap - top < C) { status = 1; break; }
      const m0 = metric[c];
      const n = reachRawJS(N, net, water, K, R, geo[4 * c], geo[4 * c + 1], geo[4 * c + 2], geo[4 * c + 3], radius[c], m0);
      const touched = R.touched, best = R.best;
      const off = top;
      let m = off, x0 = N, z0 = N, x1 = -1, z1 = -1;
      for (let t = 0; t < n; t++) {
        const i = touched[t];
        const w = best[i];
        if (w <= 0) continue;
        idx[m] = i; pw[m] = w; m++;
        const x = i % N, z = (i - x) / N;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
      top = m;
      dead += recEnd[rec] - recStart[rec];
      recStart[rec] = off; recEnd[rec] = m;
      recBox[4 * rec] = x0; recBox[4 * rec + 1] = z0; recBox[4 * rec + 2] = x1; recBox[4 * rec + 3] = z1;
      recKey[rec] = key[c]; recValid[rec] = 1; recRoad[rec] = m0 !== 2 ? 1 : 0; recStamp[rec] = pass;
      fs[c] = off; fe[c] = m;
      nFresh++;
      ureach = n * (m0 === 2 ? U_SEARCH / 2 : U_SEARCH) + 16;
    }
    let u: number;
    if (splat) {
      const q0 = fs[c], q1 = fe[c];
      splatUnionJS(idx, pw, q0, q1, str[c], op[c], cap[c], need, A, cov, splatOut);
      Dout[c] = splatOut[0]; servedOut[c] = splatOut[1];
      u = ureach + ((q1 - q0) * U_ENTRY * 2 + 8);
    } else u = ureach + 0;
    work += u; left -= u;
    cursor++;
    if (!(work < limit)) break;
  }
  a.top = top; a.dead = dead; a.cursor = cursor; a.nFresh = nFresh; a.nCached = nCached; a.work = work; a.left = left;
  return status;
}

/** batch state of union / alloc / report (catch_union / catch_alloc / catch_report parameter blocks) */
export interface PhaseArgs {
  k: number;
  nFac: number;
  cursor: number;
  order: Int32Array;
  fs: Int32Array;
  fe: Int32Array;
  str: Float64Array;
  op: Float64Array;
  cap: Float64Array;
  idx: Int32Array;
  w: Float32Array;
  need: Float32Array;
  u: Float32Array;
  A: Float32Array;
  cov: Float32Array;
  /** alloc: sig / seated / D out; union: D / served out (o3 unused); report: sig / seated in, dem out (o3) */
  o1: Float64Array;
  o2: Float64Array;
  o3: Float64Array;
  /** alloc: e-cache */
  ec: Float64Array;
  /** report: dem computed flags */
  ok: Uint8Array;
  work: number;
  left: number;
  limit: number;
}

/** splatUnion for facilities [cursor, n) in list order (replay of the union phase with given pool ranges) */
export function unionJS(a: PhaseArgs): void {
  const nf = a.nFac, fs = a.fs, fe = a.fe, str = a.str, op = a.op, cap = a.cap;
  let cursor = a.cursor, work = a.work, left = a.left;
  const limit = a.limit;
  while (cursor < nf) {
    const c = cursor;
    const q0 = fs[c], q1 = fe[c];
    splatUnionJS(a.idx, a.w, q0, q1, str[c], op[c], cap[c], a.need, a.A, a.cov, splatOut);
    a.o1[c] = splatOut[0]; a.o2[c] = splatOut[1];
    const u = (q1 - q0) * U_ENTRY * 2 + 8;
    work += u; left -= u;
    cursor++;
    if (!(work < limit)) break;
  }
  a.cursor = cursor; a.work = work; a.left = left;
}

/**
 * allocSeats for facilities order[cursor..n) while work < limit (arithmetic and loop order of services.ts 24f8609).
 * JS keeps the original two loops: loop 2 RECOMPUTES e = min(u, a) — the same value loop 1 used, since a reach's cells
 * are unique (u[i] changes once per facility). The wasm port caches e in loop 1 instead (1.08x there); in JS the extra
 * f64 store / load per entry measured 0.91x [0.89, 0.92] (dense1m replay, protector intact), so each side runs its own
 * faster exact variant. `allocEcacheJS` below is the e-cache form (tests / benchmarks).
 */
export function allocJS(a: PhaseArgs): void {
  const nf = a.nFac, order = a.order, fs = a.fs, fe = a.fe, str = a.str, op = a.op, cap = a.cap;
  const pIdx = a.idx, pW = a.w, needL = a.need, u = a.u, A = a.A, cov = a.cov, sigO = a.o1, seatO = a.o2, DO = a.o3;
  let cursor = a.cursor, work = a.work, left = a.left;
  const limit = a.limit;
  while (cursor < nf) {
    const c = order[cursor++];
    const s0 = fs[c], s1 = fe[c];
    sigO[c] = 1; seatO[c] = 0;
    let uw: number;
    if (s1 <= s0) { DO[c] = 0; uw = 4; }
    else {
      const s = str[c];
      let D = 0;
      for (let q = s0; q < s1; q++) {
        const i = pIdx[q];
        const aq = pW[q] * s;
        A[i] += aq;
        const ui = u[i];
        D += needL[i] * (ui < aq ? ui : aq);
      }
      const S = cap[c];
      const sig = S < Infinity && D > S ? S / D : 1;
      const rho = sig * op[c];
      if (sig > 0) {
        for (let q = s0; q < s1; q++) {
          const i = pIdx[q];
          const aq = pW[q] * s;
          const ui = u[i];
          const e = ui < aq ? ui : aq;
          if (!(e > 0)) continue;
          const lf = ui - e * sig;
          u[i] = lf > 0 ? lf : 0;
          cov[i] += e * rho;
        }
      }
      sigO[c] = sig; seatO[c] = D * sig; DO[c] = D;
      uw = 2 * (s1 - s0) * U_ENTRY + 8;
    }
    work += uw; left -= uw;
    if (!(work < limit)) break;
  }
  a.cursor = cursor; a.work = work; a.left = left;
}

/** allocSeats, e-cache form (the structure of catch_alloc): loop 1 stores e = min(u, a) per entry, loop 2 reads it */
export function allocEcacheJS(a: PhaseArgs): void {
  const nf = a.nFac, order = a.order, fs = a.fs, fe = a.fe, str = a.str, op = a.op, cap = a.cap;
  const pIdx = a.idx, pW = a.w, needL = a.need, u = a.u, A = a.A, cov = a.cov, sigO = a.o1, seatO = a.o2, DO = a.o3, ec = a.ec;
  let cursor = a.cursor, work = a.work, left = a.left;
  const limit = a.limit;
  while (cursor < nf) {
    const c = order[cursor++];
    const s0 = fs[c], s1 = fe[c];
    sigO[c] = 1; seatO[c] = 0;
    let uw: number;
    if (s1 <= s0) { DO[c] = 0; uw = 4; }
    else {
      const s = str[c];
      let D = 0;
      for (let q = s0; q < s1; q++) {
        const i = pIdx[q];
        const aq = pW[q] * s;
        A[i] += aq;
        const ui = u[i];
        const e = ui < aq ? ui : aq;
        ec[q - s0] = e;
        D += needL[i] * e;
      }
      const S = cap[c];
      const sig = S < Infinity && D > S ? S / D : 1;
      const rho = sig * op[c];
      if (sig > 0) {
        for (let q = s0; q < s1; q++) {
          const e = ec[q - s0];
          if (!(e > 0)) continue;
          const i = pIdx[q];
          const lf = u[i] - e * sig;
          u[i] = lf > 0 ? lf : 0;
          cov[i] += e * rho;
        }
      }
      sigO[c] = sig; seatO[c] = D * sig; DO[c] = D;
      uw = 2 * (s1 - s0) * U_ENTRY + 8;
    }
    work += uw; left -= uw;
    if (!(work < limit)) break;
  }
  a.cursor = cursor; a.work = work; a.left = left;
}

/** reportDemand for facilities [cursor, n) while work < limit: dem (o3) + flag (ok) for crowded non-empty ones */
export function reportJS(a: PhaseArgs): void {
  const nf = a.nFac, fs = a.fs, fe = a.fe, str = a.str, sig = a.o1, seat = a.o2, dem = a.o3, ok = a.ok;
  const pIdx = a.idx, pW = a.w, needL = a.need, u = a.u, A = a.A;
  let cursor = a.cursor, work = a.work, left = a.left;
  const limit = a.limit;
  while (cursor < nf) {
    const c = cursor++;
    const s0 = fs[c], s1 = fe[c];
    let uw: number;
    if (s1 <= s0 || !(sig[c] < 1)) { ok[c] = 0; uw = 2; }
    else {
      const s = str[c];
      let lf = 0;
      for (let q = s0; q < s1; q++) {
        const i = pIdx[q];
        const n = needL[i];
        if (!(n > 0)) continue;
        const ui = u[i];
        if (!(ui > 0)) continue;
        const aq = pW[q] * s;
        const Ai = A[i];
        lf += n * (ui < aq ? ui : aq) * (Ai > aq ? aq / Ai : 1);
      }
      dem[c] = seat[c] + lf;
      ok[c] = 1;
      uw = (s1 - s0) * U_ENTRY + 8;
    }
    work += uw; left -= uw;
    if (!(work < limit)) break;
  }
  a.cursor = cursor; a.work = work; a.left = left;
}

/** finalizeTier: layer = min(cov, 1); unless transit: [need, served, unreached] sums into out */
export function finalizeJS(C: number, cov: Float32Array, layer: Float32Array, transit: boolean, needL: Float32Array, A: Float32Array, out: Float64Array): void {
  for (let i = 0; i < C; i++) { const v = cov[i]; layer[i] = v < 1 ? v : 1; }
  if (transit) return;
  let need = 0, served = 0, unreached = 0;
  for (let i = 0; i < C; i++) {
    const n = needL[i];
    if (n <= 0) continue;
    need += n;
    served += n * layer[i];
    if (A[i] <= 0) unreached += n;
  }
  out[0] = need; out[1] = served; out[2] = unreached;
}

/**
 * stop list for transitCovJS, per stop computed in JS from the live stop rules (transit.ts): centre cell, integer
 * radius, strength factor (Bus 0.75, else 1; strength = factor x funding) and a skip flag (def coverage / not serving)
 */
export interface StopArgs {
  n: number;
  cell: Int32Array;
  R: Int32Array;
  factor: Float64Array;
  skip: Uint8Array;
}

/** transit.ts computeTransitCoverage into tmp + services finishTransit combine into T */
export function transitCovJS(N: number, s: StopArgs, funding: number, tmp: Float32Array, T: Float32Array): void {
  const out = tmp;
  out.fill(0);
  for (let k = 0; k < s.n; k++) {
    if (s.skip[k] !== 0) continue;
    const R = s.R[k];
    const c = s.cell[k];
    const cx = c % N, cz = (c - cx) / N;
    const R2 = (R + 0.5) * (R + 0.5);
    const strength = s.factor[k] * funding;
    for (let z = Math.max(0, cz - R); z <= Math.min(N - 1, cz + R); z++) {
      const dz = z - cz;
      for (let x = Math.max(0, cx - R); x <= Math.min(N - 1, cx + R); x++) {
        const dx = x - cx;
        const d2 = dx * dx + dz * dz;
        if (d2 > R2) continue;
        const d = Math.sqrt(d2) / (R + 0.5);
        const v = strength * (1 - d * d * 0.7);
        const i = z * N + x;
        const cur = out[i];
        out[i] = cur + v * (1 - cur);
      }
    }
  }
  const C = N * N;
  for (let i = 0; i < C; i++) { const t = tmp[i]; if (t > 0) T[i] = 1 - (1 - T[i]) * (1 - Math.min(1, t)); }
}

/** footprints: per layer, per building box (x, z, w, d) in list order: max over the clipped footprint, then fill */
export function footprintsJS(N: number, nB: number, boxes: Int32Array, layers: readonly Float32Array[]): void {
  for (const L of layers) {
    for (let q = 0; q < nB; q++) {
      const bx = boxes[4 * q], bz = boxes[4 * q + 1], bw = boxes[4 * q + 2], bd = boxes[4 * q + 3];
      const x0 = Math.max(0, bx), z0 = Math.max(0, bz), x1 = Math.min(N, bx + bw), z1 = Math.min(N, bz + bd);
      let m = 0;
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { const v = L[z * N + x]; if (v > m) m = v; }
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) L[z * N + x] = m;
    }
  }
}

/** finish's legacy combos: eduCov = min(1, we E + wh H + wc K), parkCov = 1 - (1 - P)(1 - G) */
export function comboJS(C: number, E: Float32Array, H: Float32Array, K: Float32Array, P: Float32Array, G: Float32Array,
  edu: Float32Array, park: Float32Array, we: number, wh: number, wc: number): void {
  for (let i = 0; i < C; i++) {
    const e = we * E[i] + wh * H[i] + wc * K[i];
    edu[i] = e < 1 ? e : 1;
    park[i] = 1 - (1 - P[i]) * (1 - G[i]);
  }
}

/** services.ts chamfer (two passes, 4-neighbour, over non-road cells) */
export function chamferJS(v: Float32Array, N: number, net: Uint8Array, step: number, inf: number): void {
  for (let z = 0; z < N; z++) {
    const row = z * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
      const t = net[i];
      if (t >= 1 && t <= 5) continue;
      let m = v[i];
      if (x > 0) { const a = v[i - 1] + step; if (a < m) m = a; }
      if (z > 0) { const a = v[i - N] + step; if (a < m) m = a; }
      if (x < N - 1) { const t2 = net[i + 1]; if (t2 >= 1 && t2 <= 5) { const a = v[i + 1] + step; if (a < m) m = a; } }
      if (z < N - 1) { const t2 = net[i + N]; if (t2 >= 1 && t2 <= 5) { const a = v[i + N] + step; if (a < m) m = a; } }
      v[i] = m < inf ? m : inf;
    }
  }
  for (let z = N - 1; z >= 0; z--) {
    const row = z * N;
    for (let x = N - 1; x >= 0; x--) {
      const i = row + x;
      const t = net[i];
      if (t >= 1 && t <= 5) continue;
      let m = v[i];
      if (x < N - 1) { const a = v[i + 1] + step; if (a < m) m = a; }
      if (z < N - 1) { const a = v[i + N] + step; if (a < m) m = a; }
      v[i] = m < inf ? m : inf;
    }
  }
}

/** accessCommuteLand / shopLand numeric part (see catch_access_land) */
export function accessLandJS(N: number, net: Uint8Array, dist: Int32Array, v: Float32Array, out: Float32Array | null, scaled: boolean,
  scale: number, step: number, inf: number, unreached: number): void {
  const C = N * N;
  for (let i = 0; i < C; i++) {
    const t = net[i];
    v[i] = t >= 1 && t <= 5 && dist[i] >= 0 ? (scaled ? dist[i] * scale : dist[i]) : inf;
  }
  chamferJS(v, N, net, step, inf);
  if (out) for (let i = 0; i < C; i++) out[i] = v[i] < inf * 0.5 ? v[i] : unreached;
}

/** services.ts box3 (3x3 box blur, zero boundary) with caller scratch */
export function box3JS(a: Float32Array, n: number, t: Float32Array): void {
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    let s = a[z * n + x];
    if (x > 0) s += a[z * n + x - 1];
    if (x < n - 1) s += a[z * n + x + 1];
    t[z * n + x] = s / 3;
  }
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    let s = t[z * n + x];
    if (z > 0) s += t[(z - 1) * n + x];
    if (z < n - 1) s += t[(z + 1) * n + x];
    a[z * n + x] = s / 3;
  }
}

/** shopLand block sums of the residents raster */
export function blockSumJS(N: number, B: number, nb: number, res: Float32Array, pop: Float32Array): void {
  for (let z = 0; z < N; z++) { const bz = (z / B) | 0; for (let x = 0; x < N; x++) { const r = res[z * N + x]; if (r > 0) pop[bz * nb + ((x / B) | 0)] += r; } }
}

/** shopLand main loop (bilinear taps of the coarse ratio grid x distance LUT) */
export function shopTapsJS(N: number, nb: number, B: number, v: Float32Array, ratio: Float32Array, lut: Float32Array, cx0: Int32Array,
  cx1: Int32Array, ct: Float32Array, out: Float32Array, capQ: number, base: number): void {
  for (let z = 0; z < N; z++) {
    const fz = Math.min(nb - 1, Math.max(0, (z + 0.5) / B - 0.5));
    const z0 = Math.floor(fz), tz = fz - z0;
    const r0 = z0 * nb, r1 = Math.min(nb - 1, z0 + 1) * nb;
    const row = z * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
      const q = v[i];
      if (!(q <= capQ)) { out[i] = 0; continue; }
      const tx = ct[x], a = cx0[x], c = cx1[x];
      const r = (ratio[r0 + a] + (ratio[r0 + c] - ratio[r0 + a]) * tx) * (1 - tz) + (ratio[r1 + a] + (ratio[r1 + c] - ratio[r1 + a]) * tx) * tz;
      out[i] = lut[q | 0] * (base + (1 - base) * r);
    }
  }
}

// ------------------------------------------------------------------------------------------------ kernel backends
/** the kernels the engine calls; `jsKernels` below, the wasm ones in src/wasm/kernels/servicesBind.ts */
export interface TierKernels {
  readonly name: string;
  search(e: TierEngine, a: SearchArgs): number;
  union(e: TierEngine, a: PhaseArgs): void;
  alloc(e: TierEngine, a: PhaseArgs): void;
  report(e: TierEngine, a: PhaseArgs): void;
  finalize(e: TierEngine, cov: Float32Array, layer: Float32Array, transit: boolean, needL: Float32Array, A: Float32Array, out: Float64Array): void;
  transitCov(e: TierEngine, N: number, s: StopArgs, funding: number, tmp: Float32Array, T: Float32Array): void;
  footprints(e: TierEngine, N: number, nB: number, boxes: Int32Array, layers: readonly Float32Array[]): void;
  combo(e: TierEngine, C: number, E: Float32Array, H: Float32Array, K: Float32Array, P: Float32Array, G: Float32Array, edu: Float32Array, park: Float32Array, we: number, wh: number, wc: number): void;
  accessLand(e: TierEngine, N: number, net: Uint8Array, dist: Int32Array, v: Float32Array, out: Float32Array | null, scaled: boolean, scale: number, step: number, inf: number, unreached: number): void;
  box3(e: TierEngine, a: Float32Array, n: number, t: Float32Array): void;
  blockSum(e: TierEngine, N: number, B: number, nb: number, res: Float32Array, pop: Float32Array): void;
  shopTaps(e: TierEngine, N: number, nb: number, B: number, v: Float32Array, ratio: Float32Array, lut: Float32Array, cx0: Int32Array, cx1: Int32Array, ct: Float32Array, out: Float32Array, capQ: number, base: number): void;
  /** start of a scheduler step: staged copies of mutable inputs (network, water) are stale */
  beginStep?(e: TierEngine): void;
  /** allocate backend state for an engine sized for its map (called by ensure(); kernels themselves never allocate) */
  prepare?(e: TierEngine): void;
  /** free the backend state of an engine (re-prepare, migration to JS, disposal) */
  release?(e: TierEngine): void;
}

export const jsKernels: TierKernels = {
  name: 'js',
  search: (_e, a) => searchJS(a),
  union: (_e, a) => unionJS(a),
  alloc: (_e, a) => allocJS(a),
  report: (_e, a) => reportJS(a),
  finalize: (_e, cov, layer, transit, needL, A, out) => finalizeJS(cov.length, cov, layer, transit, needL, A, out),
  transitCov: (_e, N, s, funding, tmp, T) => transitCovJS(N, s, funding, tmp, T),
  footprints: (_e, N, nB, boxes, layers) => footprintsJS(N, nB, boxes, layers),
  combo: (_e, C, E, H, K, P, G, edu, park, we, wh, wc) => comboJS(C, E, H, K, P, G, edu, park, we, wh, wc),
  accessLand: (_e, N, net, dist, v, out, scaled, scale, step, inf, un) => accessLandJS(N, net, dist, v, out, scaled, scale, step, inf, un),
  box3: (_e, a, n, t) => box3JS(a, n, t),
  blockSum: (_e, N, B, nb, res, pop) => blockSumJS(N, B, nb, res, pop),
  shopTaps: (_e, N, nb, B, v, ratio, lut, cx0, cx1, ct, out, capQ, base) => shopTapsJS(N, nb, B, v, ratio, lut, cx0, cx1, ct, out, capQ, base),
};

// ------------------------------------------------------------------------------------------------ engine
/** what the engine needs to know about a facility (a Building of the sim) */
export interface FacilityRef {
  readonly id: number;
  readonly def: string;
  readonly x: number;
  readonly z: number;
  readonly w: number;
  readonly d: number;
}

/** per-facility reach parameters hoisted from infoOf (radius, metric, strength of the slot) */
export interface FacilityParams {
  radius: number;
  metric: number;
  strength: number;
}

/** persistent state of one tier slot: cache records + reach pool */
class SlotState {
  cap = 0;
  recStart!: Buf<Int32Array>;
  recEnd!: Buf<Int32Array>;
  recBox!: Buf<Int32Array>;
  recKey!: Buf<Float64Array>;
  recValid!: Buf<Uint8Array>;
  recRoad!: Buf<Uint8Array>;
  recStamp!: Buf<Int32Array>;
  /** building id of each record (-1 = free) — JS only */
  recId = new Int32Array(0);
  free: number[] = [];
  live = 0;
  poolCap = 0;
  idx!: Buf<Int32Array>;
  w!: Buf<Float32Array>;
  top = 0;
  dead = 0;
}

export interface TierEngineStats {
  fresh: number;
  cached: number;
  compactions: number;
  poolGrows: number;
  /** entries held by all slot pools (live + dead) */
  poolEntries: number;
  deadEntries: number;
  /** the wasm backend failed to allocate and the engine moved to JS kernels */
  migratedToJs: boolean;
}

const defNums = new Map<string, number>();
function defNum(id: string): number {
  let n = defNums.get(id);
  if (n === undefined) defNums.set(id, (n = defNums.size + 1));
  return n;
}
/** cache key: def + footprint (services.ts keyOf; own numbering of defs — keys are only compared with each other) */
export function keyOf(b: FacilityRef): number {
  return (((defNum(b.def) * 4096 + b.x) * 4096 + b.z) * 64 + (b.w & 63)) * 64 + (b.d & 63);
}

/**
 * The tier engine state of one ServicesSystem: reach scratch, cell accumulators (A, unseated share, coverage), the
 * per-facility table of the slot being processed and the per-slot cache records + pools. `kernels` runs the phases.
 */
export class TierEngine {
  kernels: TierKernels;
  space: Space;
  readonly K: ReachConsts;
  N = 0;
  C = 0;
  // reach scratch + cell accumulators
  visit!: Buf<Int32Array>;
  dstamp!: Buf<Int32Array>;
  dist!: Buf<Int32Array>;
  touched!: Buf<Int32Array>;
  best!: Buf<Float32Array>;
  head!: Buf<Int32Array>;
  enode!: Buf<Int32Array>;
  enext!: Buf<Int32Array>;
  fall!: Buf<Float32Array>;
  nfSeen!: Buf<Uint8Array>;
  nfQueue!: Buf<Int32Array>;
  stamp = 0;
  A!: Buf<Float32Array>;
  u!: Buf<Float32Array>;
  cov!: Buf<Float32Array>;
  ec!: Buf<Float64Array>;
  tmp!: Buf<Float32Array>;
  // facility table of the current slot
  fcap = 0;
  nFac = 0;
  geo!: Buf<Int32Array>;
  radius!: Buf<Float64Array>;
  metric!: Buf<Int32Array>;
  str!: Buf<Float64Array>;
  op!: Buf<Float64Array>;
  capv!: Buf<Float64Array>;
  key!: Buf<Float64Array>;
  rec!: Buf<Int32Array>;
  alive!: Buf<Uint8Array>;
  fs!: Buf<Int32Array>;
  fe!: Buf<Int32Array>;
  sig!: Buf<Float64Array>;
  seat!: Buf<Float64Array>;
  D!: Buf<Float64Array>;
  served!: Buf<Float64Array>;
  dem!: Buf<Float64Array>;
  demOk!: Buf<Uint8Array>;
  order!: Buf<Int32Array>;
  // transit stops (finishTransit) and footprint boxes (footprints)
  stopCap = 0;
  stopCell!: Buf<Int32Array>;
  stopR!: Buf<Int32Array>;
  stopFactor!: Buf<Float64Array>;
  stopSkip!: Buf<Uint8Array>;
  boxCap = 0;
  boxes!: Buf<Int32Array>;
  /** backend-owned state (wasm staging buffers + parameter blocks) */
  stage: unknown = null;
  // per slot
  slots: SlotState[] = [];
  /** building id -> slot (-1 none) and record index */
  slotOfId = new Int8Array(0);
  recOfId = new Int32Array(0);
  pass = 0;
  readonly stats: TierEngineStats = { fresh: 0, cached: 0, compactions: 0, poolGrows: 0, poolEntries: 0, deadEntries: 0, migratedToJs: false };
  /** scratch for finalize sums */
  readonly fin = new Float64Array(3);
  private readonly sa: SearchArgs;
  private readonly pa: PhaseArgs;

  /** smallest pool a slot allocates / grows to (entries; tests shrink it to exercise compaction and growth) */
  readonly minPool: number;

  constructor(nSlots: number, K: ReachConsts, kernels: TierKernels = jsKernels, space: Space = jsSpace, opts: { minPool?: number } = {}) {
    this.minPool = Math.max(1, Math.floor(opts.minPool ?? 65536));
    this.K = K;
    this.kernels = kernels;
    this.space = space;
    for (let k = 0; k < nSlots; k++) this.slots.push(new SlotState());
    const e32 = new Int32Array(0), f32 = new Float32Array(0), f64 = new Float64Array(0), u8 = new Uint8Array(0);
    this.sa = {
      k: 0, N: 0, net: u8, water: u8, K, R: null as unknown as ReachScratch, nFac: 0, geo: e32, radius: f64, metric: e32, str: f64, op: f64, cap: f64,
      key: f64, rec: e32, alive: u8, fs: e32, fe: e32, D: f64, served: f64, recStart: e32, recEnd: e32, recBox: e32, recKey: f64,
      recValid: u8, recRoad: u8, recStamp: e32, pass: 0, idx: e32, w: f32, poolCap: 0, top: 0, dead: 0, splat: false, need: f32,
      A: f32, cov: f32, cursor: 0, nFresh: 0, nCached: 0, work: 0, left: 0, limit: 0,
    };
    this.pa = { k: 0, nFac: 0, cursor: 0, order: e32, fs: e32, fe: e32, str: f64, op: f64, cap: f64, idx: e32, w: f32, need: f32, u: f32, A: f32, cov: f32, o1: f64, o2: f64, o3: f64, ec: f64, ok: u8, work: 0, left: 0, limit: 0 };
  }

  /** allocate through the space; a failing wasm allocation moves the whole engine to a JS space (+ JS kernels) */
  private alloc<T extends TA>(ctor: TACtor<T>, n: number): Buf<T> {
    try {
      return this.space.alloc(ctor, n);
    } catch (err) {
      if (!this.space.wasm) throw err;
      this.migrateToJs();
      return this.space.alloc(ctor, n);
    }
  }

  private realloc<T extends TA>(b: Buf<T> | undefined, ctor: TACtor<T>, n: number, keep: number): Buf<T> {
    const nb = this.alloc(ctor, n);
    if (b) {
      // `nb` may be in a new space after a migration: `b` was migrated too (views read the current buffers)
      const src = this.bufOf(b);
      nb.v.set(src.v.subarray(0, Math.min(keep, src.n)));
      if (src.ptr >= 0) this.space.free(src as unknown as Buf<TA>);
    }
    return nb;
  }

  /** after a migration, old Bufs are replaced: resolve a possibly stale Buf to the current one */
  private bufOf<T extends TA>(b: Buf<T>): Buf<T> {
    return (this.migrated.get(b as unknown as Buf<TA>) as unknown as Buf<T> | undefined) ?? b;
  }
  private migrated = new Map<Buf<TA>, Buf<TA>>();

  /** free a block of the current space (no-op for JS memory / undefined) */
  private drop(b: Buf<TA> | undefined): void {
    if (b && b.ptr >= 0) this.space.free(b);
  }

  /** move every array into plain JS memory and switch to the JS kernels (results are identical) */
  migrateToJs(): void {
    if (!this.space.wasm) return;
    const old = this.space;
    // the backend's staging buffers / parameter blocks live in the old space too
    this.kernels.release?.(this);
    this.space = jsSpace;
    this.kernels = jsKernels;
    this.stats.migratedToJs = true;
    const move = <T extends TA>(b: Buf<T> | undefined): Buf<T> => {
      if (!b || b.ptr < 0) return b as Buf<T>;
      const nb = jsSpace.alloc(b.ctor, b.n);
      nb.v.set(b.v);
      old.free(b as unknown as Buf<TA>);
      this.migrated.set(b as unknown as Buf<TA>, nb as unknown as Buf<TA>);
      return nb;
    };
    this.stage = null;
    const keys: (keyof TierEngine)[] = ['visit', 'dstamp', 'dist', 'touched', 'best', 'head', 'enode', 'enext', 'fall', 'nfSeen', 'nfQueue', 'A', 'u', 'cov', 'ec', 'tmp',
      'geo', 'radius', 'metric', 'str', 'op', 'capv', 'key', 'rec', 'alive', 'fs', 'fe', 'sig', 'seat', 'D', 'served', 'dem', 'demOk', 'order',
      'stopCell', 'stopR', 'stopFactor', 'stopSkip', 'boxes'];
    const self = this as unknown as Record<string, Buf<TA> | undefined>;
    for (const k of keys) self[k as string] = move(self[k as string]);
    for (const s of this.slots) {
      if (s.cap > 0) {
        s.recStart = move(s.recStart); s.recEnd = move(s.recEnd); s.recBox = move(s.recBox); s.recKey = move(s.recKey);
        s.recValid = move(s.recValid); s.recRoad = move(s.recRoad); s.recStamp = move(s.recStamp);
      }
      if (s.poolCap > 0) { s.idx = move(s.idx); s.w = move(s.w); }
    }
    // anything else the old space still holds (nothing should be left: every engine array was moved above)
    old.freeAll?.();
  }

  /** engine fields holding cell-sized arrays (reach scratch + accumulators) */
  private static readonly CELL_KEYS = ['visit', 'dstamp', 'dist', 'touched', 'best', 'head', 'enode', 'enext', 'fall', 'nfSeen', 'nfQueue', 'A', 'u', 'cov',
    'ec', 'tmp'] as const;
  /** engine fields holding the per-facility table of the current slot */
  private static readonly FAC_KEYS = ['geo', 'radius', 'metric', 'str', 'op', 'capv', 'key', 'rec', 'alive', 'fs', 'fe', 'sig', 'seat', 'D', 'served', 'dem',
    'demOk', 'order'] as const;
  private static readonly STOP_KEYS = ['stopCell', 'stopR', 'stopFactor', 'stopSkip'] as const;

  /**
   * free the arrays of these engine fields and clear the fields (before re-allocating them: a migration to JS memory
   * triggered by the next allocation must not see — and free again — a block that was already freed)
   */
  private dropKeys(keys: readonly string[]): void {
    const self = this as unknown as Record<string, Buf<TA> | undefined>;
    for (const k of keys) { this.drop(self[k]); self[k] = undefined; }
  }

  /**
   * Free everything the engine holds (city unload, uninstall, a kernel fault): every array, the slot pools and records,
   * the backend's staging buffers. The engine is empty afterwards (ensure() would allocate again); in a wasm space the
   * blocks return to the shared WasmHeap (linear memory never shrinks, but the next engine reuses them).
   */
  dispose(): void {
    this.kernels.release?.(this);
    this.stage = null;
    this.dropKeys(TierEngine.CELL_KEYS);
    this.dropKeys(TierEngine.FAC_KEYS);
    this.dropKeys(TierEngine.STOP_KEYS);
    this.dropKeys(['boxes']);
    for (const s of this.slots) {
      if (s.cap > 0) for (const b of [s.recStart, s.recEnd, s.recBox, s.recKey, s.recValid, s.recRoad, s.recStamp] as Buf<TA>[]) this.drop(b);
      if (s.poolCap > 0) { this.drop(s.idx as Buf<TA>); this.drop(s.w as Buf<TA>); }
    }
    // anything left in a wasm space (nothing should be: every block is owned by one of the fields above)
    this.space.freeAll?.();
    this.slots = this.slots.map(() => new SlotState());
    this.slotOfId = new Int8Array(0);
    this.recOfId = new Int32Array(0);
    this.migrated.clear();
    this.N = 0; this.C = 0; this.fcap = 0; this.nFac = 0; this.stopCap = 0; this.boxCap = 0; this.stamp = 0;
    this.disposed = true;
  }
  /** dispose() ran (the engine holds no memory) */
  disposed = false;

  /** (re)size the cell-sized state for an N x N map; drops every cache record */
  ensure(N: number): void {
    if (this.N === N && this.visit) return;
    // a new map size: the old cell arrays (and the backend's staging buffers, re-prepared below) are freed first
    this.dropKeys(TierEngine.CELL_KEYS);
    this.disposed = false;
    this.N = N;
    const C = (this.C = N * N);
    this.visit = this.alloc(Int32Array, C);
    this.dstamp = this.alloc(Int32Array, C);
    this.dist = this.alloc(Int32Array, C);
    this.touched = this.alloc(Int32Array, C);
    this.best = this.alloc(Float32Array, C);
    this.head = this.alloc(Int32Array, 8);
    this.enode = this.alloc(Int32Array, enodeCap(N));
    this.enext = this.alloc(Int32Array, enodeCap(N));
    this.fall = this.alloc(Float32Array, FALL_CAP);
    this.nfSeen = this.alloc(Uint8Array, C);
    this.nfQueue = this.alloc(Int32Array, C);
    this.stamp = 0;
    this.A = this.alloc(Float32Array, C);
    this.u = this.alloc(Float32Array, C);
    this.cov = this.alloc(Float32Array, C);
    this.ec = this.alloc(Float64Array, C);
    this.tmp = this.alloc(Float32Array, C);
    this.reset();
    this.kernels.prepare?.(this);
  }

  /** room for n transit stops (call before building StopArgs) */
  ensureStops(n: number): void {
    if (n <= this.stopCap && this.stopCap > 0) return;
    const cap = Math.max(n, this.stopCap * 2, 256);
    // the old arrays are refilled by the caller: free them (no copy)
    this.dropKeys(TierEngine.STOP_KEYS);
    this.stopCell = this.alloc(Int32Array, cap);
    this.stopR = this.alloc(Int32Array, cap);
    this.stopFactor = this.alloc(Float64Array, cap);
    this.stopSkip = this.alloc(Uint8Array, cap);
    this.stopCap = cap;
  }

  /** room for n footprint boxes */
  ensureBoxes(n: number): void {
    if (n <= this.boxCap && this.boxCap > 0) return;
    const cap = Math.max(n, this.boxCap * 2, 1024);
    this.dropKeys(['boxes']);
    this.boxes = this.alloc(Int32Array, 4 * cap);
    this.boxCap = cap;
  }

  /** drop every cache record (new city / map size / services init) */
  reset(): void {
    for (let k = 0; k < this.slots.length; k++) this.dropSlot(k);
    this.slotOfId.fill(-1);
    this.recOfId.fill(-1);
  }

  private ensureFac(n: number): void {
    if (n <= this.fcap) return;
    const cap = Math.max(n, this.fcap * 2, 256);
    // initSlot refills the whole table: the old arrays are freed, not copied
    this.dropKeys(TierEngine.FAC_KEYS);
    this.fcap = cap;
    this.geo = this.alloc(Int32Array, 4 * cap);
    this.radius = this.alloc(Float64Array, cap);
    this.metric = this.alloc(Int32Array, cap);
    this.str = this.alloc(Float64Array, cap);
    this.op = this.alloc(Float64Array, cap);
    this.capv = this.alloc(Float64Array, cap);
    this.key = this.alloc(Float64Array, cap);
    this.rec = this.alloc(Int32Array, cap);
    this.alive = this.alloc(Uint8Array, cap);
    this.fs = this.alloc(Int32Array, cap);
    this.fe = this.alloc(Int32Array, cap);
    this.sig = this.alloc(Float64Array, cap);
    this.seat = this.alloc(Float64Array, cap);
    this.D = this.alloc(Float64Array, cap);
    this.served = this.alloc(Float64Array, cap);
    this.dem = this.alloc(Float64Array, cap);
    this.demOk = this.alloc(Uint8Array, cap);
    this.order = this.alloc(Int32Array, cap);
  }

  private ensureIds(maxId: number): void {
    if (this.recOfId.length > maxId) return;
    const n = Math.max(maxId + 1, this.recOfId.length * 2, 1024);
    const s = new Int8Array(n).fill(-1), r = new Int32Array(n).fill(-1);
    s.set(this.slotOfId); r.set(this.recOfId);
    this.slotOfId = s; this.recOfId = r;
  }

  private ensureRecs(S: SlotState, n: number): void {
    if (n <= S.cap) return;
    const cap = Math.max(n, S.cap * 2, 64);
    const keep = S.cap;
    S.recStart = this.realloc(S.cap ? S.recStart : undefined, Int32Array, cap, keep);
    S.recEnd = this.realloc(S.cap ? S.recEnd : undefined, Int32Array, cap, keep);
    S.recBox = this.realloc(S.cap ? S.recBox : undefined, Int32Array, 4 * cap, 4 * keep);
    S.recKey = this.realloc(S.cap ? S.recKey : undefined, Float64Array, cap, keep);
    S.recValid = this.realloc(S.cap ? S.recValid : undefined, Uint8Array, cap, keep);
    S.recRoad = this.realloc(S.cap ? S.recRoad : undefined, Uint8Array, cap, keep);
    S.recStamp = this.realloc(S.cap ? S.recStamp : undefined, Int32Array, cap, keep);
    const ids = new Int32Array(cap).fill(-1);
    ids.set(S.recId);
    S.recId = ids;
    for (let r = cap - 1; r >= keep; r--) S.free.push(r);
    // new records never match: key NaN, invalid
    S.recKey.v.fill(NaN, keep);
    S.cap = cap;
  }

  private ensurePool(S: SlotState, need: number): void {
    if (need <= S.poolCap) return;
    const cap = Math.max(need, S.poolCap * 2, this.minPool);
    S.idx = this.realloc(S.poolCap ? S.idx : undefined, Int32Array, cap, S.top);
    S.w = this.realloc(S.poolCap ? S.w : undefined, Float32Array, cap, S.top);
    S.poolCap = cap;
    this.stats.poolGrows++;
  }

  private freeRec(S: SlotState, k: number, r: number): void {
    const id = S.recId[r];
    if (id < 0) return;
    const start = S.recStart.v, end = S.recEnd.v;
    S.dead += end[r] - start[r];
    start[r] = 0; end[r] = 0;
    S.recValid.v[r] = 0;
    S.recKey.v[r] = NaN;
    S.recId[r] = -1;
    S.free.push(r);
    S.live--;
    if (id < this.slotOfId.length && this.slotOfId[id] === k) { this.slotOfId[id] = -1; this.recOfId[id] = -1; }
  }

  /** empty slot (services.ts: cache[k] = null): drop its records and pool contents */
  dropSlot(k: number): void {
    const S = this.slots[k];
    if (S.cap > 0) for (let r = 0; r < S.cap; r++) if (S.recId[r] >= 0) this.freeRec(S, k, r);
    S.top = 0;
    S.dead = 0;
  }

  /** start of a services pass (prep) */
  beginPass(): void {
    this.pass = (this.pass % 0x3fffffff) + 1;
  }

  /**
   * Move the live segments of slot k down (each segment keeps its order: the touched order is the contract; the order
   * ACROSS facilities is free) when dead entries exceed 50 % (`force`: whenever there are dead entries). Returns true
   * when it compacted. Only the record ranges are rewritten: the caller fixes the facility table (see search()).
   */
  private compact(S: SlotState, force = false): boolean {
    if (!(S.dead > 0 && (force || S.dead * 2 > S.top))) return false;
    const n = S.cap, ids = S.recId;
    const live: number[] = [];
    const start = S.recStart.v, end = S.recEnd.v;
    for (let r = 0; r < n; r++) if (ids[r] >= 0 && end[r] > start[r]) live.push(r);
    live.sort((a, b) => start[a] - start[b]);
    const idx = S.idx.v, w = S.w.v;
    let top = 0;
    for (const r of live) {
      const s0 = start[r], len = end[r] - s0;
      if (s0 !== top) { idx.copyWithin(top, s0, s0 + len); w.copyWithin(top, s0, s0 + len); }
      start[r] = top; end[r] = top + len;
      top += len;
    }
    for (let r = 0; r < n; r++) if (ids[r] >= 0 && end[r] <= start[r]) { start[r] = top; end[r] = top; }
    S.top = top;
    S.dead = 0;
    this.stats.compactions++;
    return true;
  }

  /**
   * P_INIT of a non-empty slot: accumulators reset (A = 0, cov = 0, unseated share = 1 for shared slots), facility
   * table of `list` (reach parameters, op, capacity, key, cache record), dead segments compacted.
   */
  initSlot(k: number, list: readonly FacilityRef[], ops: readonly number[], caps: readonly number[], shared: boolean,
    params: (b: FacilityRef, i: number) => FacilityParams, maxId: number, alive: (b: FacilityRef) => boolean): void {
    const n = list.length;
    this.ensureFac(n);
    this.ensureIds(maxId);
    const S = this.slots[k];
    this.ensureRecs(S, S.live + n);
    if (S.poolCap === 0) this.ensurePool(S, this.minPool);
    this.compact(S);
    this.A.v.fill(0);
    this.cov.v.fill(0);
    if (shared) this.u.v.fill(1);
    const geo = this.geo.v, rad = this.radius.v, met = this.metric.v, str = this.str.v, op = this.op.v, cap = this.capv.v, key = this.key.v, rec = this.rec.v, al = this.alive.v;
    const slotOf = this.slotOfId, recOf = this.recOfId;
    for (let c = 0; c < n; c++) {
      const b = list[c];
      const p = params(b, c);
      geo[4 * c] = b.x; geo[4 * c + 1] = b.z; geo[4 * c + 2] = b.w; geo[4 * c + 3] = b.d;
      rad[c] = p.radius; met[c] = p.metric; str[c] = p.strength;
      op[c] = ops[c]; cap[c] = caps[c];
      key[c] = keyOf(b);
      const id = b.id;
      let r = -1;
      if (alive(b)) {
        if (slotOf[id] === k) r = recOf[id];
        else {
          if (slotOf[id] >= 0) this.freeRec(this.slots[slotOf[id]], slotOf[id], recOf[id]);
          r = S.free.pop()!;
          S.recId[r] = id;
          S.live++;
          slotOf[id] = k; recOf[id] = r;
        }
      }
      rec[c] = r;
      al[c] = r >= 0 ? 1 : 0;
    }
    this.nFac = n;
  }

  /** refresh the alive flags of facilities [from, n) (a building removed between steps is skipped, like the JS) */
  refreshAlive(list: readonly FacilityRef[], from: number, alive: (b: FacilityRef) => boolean): void {
    const al = this.alive.v, rec = this.rec.v;
    for (let c = from; c < this.nFac; c++) al[c] = rec[c] >= 0 && alive(list[c]) ? 1 : 0;
  }

  /** P_SEARCH batch; returns the updated cursor / work / workLeft through the result object */
  search(k: number, cursor: number, work: number, left: number, limit: number, splat: boolean, N: number, net: Uint8Array, water: Uint8Array,
    needL: Float32Array): { cursor: number; work: number; left: number } {
    const S = this.slots[k];
    const a = this.sa;
    for (;;) {
      a.k = k; a.N = N; a.net = net; a.water = water;
      a.R = this.scratch();
      a.nFac = this.nFac; a.geo = this.geo.v; a.radius = this.radius.v; a.metric = this.metric.v; a.str = this.str.v; a.op = this.op.v;
      a.cap = this.capv.v; a.key = this.key.v; a.rec = this.rec.v; a.alive = this.alive.v; a.fs = this.fs.v; a.fe = this.fe.v;
      a.D = this.D.v; a.served = this.served.v;
      a.recStart = S.recStart.v; a.recEnd = S.recEnd.v; a.recBox = S.recBox.v; a.recKey = S.recKey.v; a.recValid = S.recValid.v;
      a.recRoad = S.recRoad.v; a.recStamp = S.recStamp.v; a.pass = this.pass;
      a.idx = S.idx.v; a.w = S.w.v; a.poolCap = S.poolCap; a.top = S.top; a.dead = S.dead;
      a.splat = splat; a.need = needL; a.A = this.A.v; a.cov = this.cov.v;
      a.cursor = cursor; a.nFresh = 0; a.nCached = 0; a.work = work; a.left = left; a.limit = limit;
      const status = this.kernels.search(this, a);
      this.stamp = a.R.stamp;
      S.top = a.top; S.dead = a.dead;
      this.stats.fresh += a.nFresh; this.stats.cached += a.nCached;
      cursor = a.cursor; work = a.work; left = a.left;
      if (status !== 1) break;
      // the pool has no room for a fresh reach: reclaim the dead segments first when they amount to at least one map's
      // worth (a cold pass re-searches every road reach, so half the pool turns dead mid-pass; the threshold keeps the
      // number of compactions per pass low), grow only if that is not enough. Compaction moves segments: the ranges of
      // the facilities searched so far in this slot are re-read from their records (same entries, same order).
      if (S.dead >= this.C && this.compact(S, true)) {
        const fs = this.fs.v, fe = this.fe.v, rec = this.rec.v, al = this.alive.v, rs = S.recStart.v, re = S.recEnd.v;
        for (let c = 0; c < cursor; c++) {
          if (al[c] !== 0 && rec[c] >= 0) { fs[c] = rs[rec[c]]; fe[c] = re[rec[c]]; } else { fs[c] = 0; fe[c] = 0; }
        }
        if (S.poolCap - S.top >= this.C) continue;
      }
      this.ensurePool(S, S.top + 2 * this.C);
    }
    return { cursor, work, left };
  }

  /** the reach scratch as a ReachScratch view (valid until the next allocation) */
  scratch(): ReachScratch {
    const r = this.rs;
    r.visit = this.visit.v; r.dstamp = this.dstamp.v; r.dist = this.dist.v; r.touched = this.touched.v; r.best = this.best.v;
    r.head = this.head.v; r.enode = this.enode.v; r.enext = this.enext.v; r.fall = this.fall.v; r.nfSeen = this.nfSeen.v;
    r.nfQueue = this.nfQueue.v; r.stamp = this.stamp;
    return r;
  }
  private rs: ReachScratch = {} as ReachScratch;

  private phaseArgs(k: number, cursor: number, work: number, left: number, limit: number, needL: Float32Array): PhaseArgs {
    const S = this.slots[k];
    const a = this.pa;
    a.k = k; a.nFac = this.nFac; a.cursor = cursor; a.order = this.order.v; a.fs = this.fs.v; a.fe = this.fe.v; a.str = this.str.v; a.op = this.op.v;
    a.cap = this.capv.v; a.idx = S.idx.v; a.w = S.w.v; a.need = needL; a.u = this.u.v; a.A = this.A.v; a.cov = this.cov.v;
    a.ec = this.ec.v; a.ok = this.demOk.v; a.work = work; a.left = left; a.limit = limit;
    return a;
  }

  /** P_ALLOC batch over order[cursor..) */
  alloc2(k: number, cursor: number, work: number, left: number, limit: number, needL: Float32Array): PhaseArgs {
    const a = this.phaseArgs(k, cursor, work, left, limit, needL);
    a.o1 = this.sig.v; a.o2 = this.seat.v; a.o3 = this.D.v;
    this.kernels.alloc(this, a);
    return a;
  }

  /** P_REPORT batch over [cursor..) */
  report2(k: number, cursor: number, work: number, left: number, limit: number, needL: Float32Array): PhaseArgs {
    const a = this.phaseArgs(k, cursor, work, left, limit, needL);
    a.o1 = this.sig.v; a.o2 = this.seat.v; a.o3 = this.dem.v;
    this.kernels.report(this, a);
    return a;
  }

  /** union splats over [cursor..) with the current ranges (replay / tests; P_SEARCH does them inline) */
  union2(k: number, cursor: number, work: number, left: number, limit: number, needL: Float32Array): PhaseArgs {
    const a = this.phaseArgs(k, cursor, work, left, limit, needL);
    a.o1 = this.D.v; a.o2 = this.served.v; a.o3 = this.dem.v;
    this.kernels.union(this, a);
    return a;
  }

  /** P_FINAL: the layer + [need, served, unreached] (this.fin) */
  finalize(layer: Float32Array, transit: boolean, needL: Float32Array): Float64Array {
    this.kernels.finalize(this, this.cov.v, layer, transit, needL, this.A.v, this.fin);
    return this.fin;
  }

  /** end of slot k's pass: records of facilities not processed this pass are dropped (services.ts cache swap) */
  finishSlot(k: number): void {
    const S = this.slots[k];
    const st = S.recStamp.v, ids = S.recId, pass = this.pass;
    for (let r = 0; r < S.cap; r++) if (ids[r] >= 0 && st[r] !== pass) this.freeRec(S, k, r);
  }

  /** set the seat order (facility indices) of the current shared slot */
  setOrder(order: Int32Array, n: number): void {
    this.order.v.set(order.subarray(0, n));
  }

  /** a road change inside (or next to, +2) a road reach's bounding box invalidates it; no rect = every road reach */
  invalidate(r: { x0: number; z0: number; x1: number; z1: number } | undefined): void {
    for (const S of this.slots) {
      if (S.cap === 0) continue;
      const ids = S.recId, valid = S.recValid.v, road = S.recRoad.v, box = S.recBox.v;
      for (let q = 0; q < S.cap; q++) {
        if (ids[q] < 0 || !road[q] || !valid[q]) continue;
        if (!r || (r.x0 - 2 <= box[4 * q + 2] && r.x1 + 2 >= box[4 * q] && r.z0 - 2 <= box[4 * q + 3] && r.z1 + 2 >= box[4 * q + 1])) valid[q] = 0;
      }
    }
  }

  /**
   * cached record of building `id` in slot k with this key (the prep work estimate): -1 when none, else
   * 2 x (reach entries) + (valid ? 1 : 0)
   */
  recordOf(k: number, id: number, key: number): number {
    if (id >= this.slotOfId.length || this.slotOfId[id] !== k) return -1;
    const S = this.slots[k], r = this.recOfId[id];
    if (S.recKey.v[r] !== key) return -1;
    return 2 * (S.recEnd.v[r] - S.recStart.v[r]) + (S.recValid.v[r] !== 0 ? 1 : 0);
  }

  /** pool bookkeeping for status / tests */
  poolInfo(): { entries: number; dead: number; capacity: number } {
    let entries = 0, dead = 0, capacity = 0;
    for (const S of this.slots) { entries += S.top; dead += S.dead; capacity += S.poolCap; }
    this.stats.poolEntries = entries;
    this.stats.deadEntries = dead;
    return { entries, dead, capacity };
  }

  /** the pool segment of facility c of the current slot (tests: compare with the original's pool) */
  segmentOf(k: number, c: number): { idx: Int32Array; w: Float32Array } {
    const S = this.slots[k];
    const q0 = this.fs.v[c], q1 = this.fe.v[c];
    return { idx: S.idx.v.slice(q0, q1), w: S.w.v.slice(q0, q1) };
  }
}
