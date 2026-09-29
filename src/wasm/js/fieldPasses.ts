/**
 * Field passes — restructured JavaScript ("fair JS" A/B baseline of the WebAssembly port, and its JS fallback).
 *
 * Same algorithms and BIT-IDENTICAL results as the field work of src/sim/infra/nimby.ts (rebuildNimby: splatAdd over the
 * kernel tables, the landfill 2×2 blocks, the highway / rail corridor splatMax, the 1 − exp(−x) pass) and
 * src/sim/infra/pollution.ts (stageCells' cell loop + freight rail + landfill regions, saturate, stageB after the blur,
 * the soil stock loop of stageFlags) at commit 24f8609, as stand-alone kernels over typed arrays with the same signature
 * as the wasm bindings (src/wasm/kernels/fieldPassesBind.ts), so an A/B measures the language / runtime and not a
 * restructuring. The algorithmic changes of the fair baseline, applied to the JS and the wasm arms alike (the first two
 * are the architect's control; the third was added when the diffusion turned out to be the pass's largest cost on maps
 * with water, and is kept in both arms so the A/B still isolates the language / runtime):
 *  1. the corridor `line` raster is CACHED between rebuilds while the corridor class map (per cell: none / highway /
 *     highway bridge / rail; tunnels are none) is unchanged — compared cell by cell, so no hash collision can serve a
 *     stale raster; the per-rebuild work is one scan of network / netFlags instead of ~30 splatMax touches per corridor
 *     cell. `force` rebuilds it every time (the original behaviour, for the A/B);
 *  2. each source's kernel table is resolved ONCE per pass, while the source list is built (the building walk stays
 *     JS), instead of inside every splatAdd call;
 *  3. the water diffusion's loop invariants (each water cell's land inflow term and water-neighbour list) are computed
 *     once per call instead of in each of the 8 iterations, with fixed 4-slot neighbour lists padded by −0.0 (waterJs).
 * Kernel tables are stored as ROW RUNS (dz, dx0, len) + weights in entry order (the wasm layout), so a splat clips a
 * whole row once instead of bounds-checking every entry. saturate and the soil loop are the original loops (already
 * tight typed-array loops); the water diffusion hoists its loop invariants (see waterJs) — in both arms.
 * Float semantics are the original's: f64 in the JS order, f32 exactly where the original stores into a Float32Array,
 * Math.min / Math.max with their NaN / ±0 behaviour.
 *
 * This file imports nothing from src/sim: src/wasm/kernels/fieldPasses.ts binds the live constants / modules (falloff,
 * params, the building walk, the PollutionSystem method overrides).
 */

/** pollution.ts SAT table: 1 − exp(−x) on [0, 16) in SAT_N steps (f32[SAT_N + 1]) */
export const SAT_N = 4096;
export const SAT_MAX = 16;
export function buildSat(): Float32Array {
  const sat = new Float32Array(SAT_N + 1);
  for (let i = 0; i <= SAT_N; i++) sat[i] = 1 - Math.exp(-(i / SAT_N) * SAT_MAX);
  return sat;
}
export const SAT_TABLE: Float32Array = buildSat();

// ================================================================================================= NIMBY
/** a splat kernel of nimby.ts (offsets from the footprint min corner + weights), plus its row runs */
export interface NimbyTable {
  /** registry id (index in NimbyTables.list) */
  readonly id: number;
  readonly key: number;
  /** entries (nimby.ts kernelOf order: z-major, x increasing) */
  readonly dx: Int16Array;
  readonly dz: Int16Array;
  readonly w: Float32Array;
  readonly n: number;
  /** row runs: (dz, dx0, len) per run; the entries of a run are consecutive cells of one row, in entry order */
  readonly runs: Int32Array;
  readonly nRuns: number;
}

export type FalloffFn = (d: number, R: number) => number;

/**
 * The kernel cache of nimby.ts kernelOf: same radius quantisation (round(R·4)/4 clamped to [0, 60]), same key
 * ((r·4)·4096 + min(63, w)·64 + min(63, d)) and the same "first request builds the table" semantics (footprints wider
 * than 63 share the key of 63), same construction (offsets from floor(c − Rt) to ceil(c + Rt), d = max(0, hypot − half),
 * keep d < r with falloff > 0).
 */
export class NimbyTables {
  readonly list: NimbyTable[] = [];
  private map = new Map<number, NimbyTable>();
  constructor(readonly falloff: FalloffFn) {}

  of(R: number, bw: number, bd: number): NimbyTable {
    const r = Math.max(0, Math.min(60, Math.round(R * 4) / 4));
    const key = (r * 4) * 4096 + Math.min(63, bw) * 64 + Math.min(63, bd);
    const k = this.map.get(key);
    if (k) return k;
    const falloff = this.falloff;
    const cx = bw / 2 - 0.5, cz = bd / 2 - 0.5;
    const half = Math.max(bw, bd) / 2;
    const Rt = Math.ceil(r + half);
    const dx: number[] = [], dz: number[] = [], w: number[] = [];
    for (let z = Math.floor(cz - Rt); z <= Math.ceil(cz + Rt); z++) for (let x = Math.floor(cx - Rt); x <= Math.ceil(cx + Rt); x++) {
      const d = Math.max(0, Math.hypot(x - cx, z - cz) - half);
      if (d >= r) continue;
      const v = falloff(d, r);
      if (v <= 0) continue;
      dx.push(x); dz.push(z); w.push(v);
    }
    const t = makeTable(this.list.length, key, Int16Array.from(dx), Int16Array.from(dz), Float32Array.from(w));
    this.list.push(t);
    this.map.set(key, t);
    return t;
  }
}

function makeTable(id: number, key: number, dx: Int16Array, dz: Int16Array, w: Float32Array): NimbyTable {
  const n = w.length;
  const runs: number[] = [];
  for (let q = 0; q < n;) {
    let e = q + 1;
    while (e < n && dz[e] === dz[q] && dx[e] === dx[e - 1] + 1) e++;
    runs.push(dz[q], dx[q], e - q);
    q = e;
  }
  return { id, key, dx, dz, w, n, runs: Int32Array.from(runs), nRuns: runs.length / 3 };
}

/** splat targets */
export const T_STIGMA = 0, T_PRESTIGE = 1, T_CAMPUS = 2;

/**
 * The compact source list of one rebuild (buildingList order, then nothing else: the landfill blocks and corridors are
 * kernel phases): per source bx, bz, target, table id (Int32 ×4) and the amount (f64).
 */
export class NimbySources {
  n = 0;
  rec = new Int32Array(4 * 256);
  amt = new Float64Array(256);
  constructor(readonly tables: NimbyTables) {}

  reset(): void {
    this.n = 0;
  }

  /**
   * nimby.ts splatAdd(out, N, bx, bz, bw, bd, amount, R) as a list entry: nothing (0 touches) unless amount > 0 and
   * R > 0; else the table is resolved now and its entry count returned (the original's `touches`)
   */
  add(bx: number, bz: number, bw: number, bd: number, amount: number, R: number, target: number): number {
    if (!(amount > 0) || !(R > 0)) return 0;
    const t = this.tables.of(R, bw, bd);
    let n = this.n;
    if (n >= this.amt.length) {
      const rec = new Int32Array(this.rec.length * 2);
      rec.set(this.rec);
      this.rec = rec;
      const amt = new Float64Array(this.amt.length * 2);
      amt.set(this.amt);
      this.amt = amt;
    }
    const o = 4 * n;
    this.rec[o] = bx; this.rec[o + 1] = bz; this.rec[o + 2] = target; this.rec[o + 3] = t.id;
    this.amt[n] = amount;
    this.n = n + 1;
    return t.n;
  }
}

/** the arguments of one rebuild (the building walk has filled `src`) */
export interface NimbyArgs {
  N: number;
  src: NimbySources;
  /** landfill blocks: zone layer, st.landfillFill (null = none), the landfill zone code, the (lfR, 2, 2) table (null = no
   *  splats: lfR not > 0), the per-block amount and NIMBY_LANDFILL_IDLE */
  zone: Uint8Array;
  fill: Float32Array | null;
  lfCode: number;
  lfTable: NimbyTable | null;
  lfA: number;
  lfIdle: number;
  /** corridors: network / netFlags, the network codes, the (R, 1, 1) tables and amounts of highway / bridge / rail */
  net: Uint8Array;
  flags: Uint8Array;
  highway: number;
  rail: number;
  tabH: NimbyTable;
  tabR: NimbyTable;
  aH: number;
  aHB: number;
  aR: number;
  /** rebuild the corridor raster even when the class map is unchanged (the original behaviour) */
  force: boolean;
  /** outputs: st.stigma / st.prestige / st.campus */
  S: Float32Array;
  P: Float32Array;
  K: Float32Array;
}

export interface NimbyResult {
  /** landfill blocks splatted (touches: × lfTable.n) */
  lf: number;
  /** the corridor raster was rebuilt */
  changed: boolean;
  /** corridor cells: highway (not tunnel), rail (touches: × tabH.n / tabR.n) */
  nh: number;
  nr: number;
}

/** rebuildNimby phases */
export const PH_SPLAT = 1, PH_LANDFILL = 2, PH_CORRIDOR = 4, PH_FINAL = 8, PH_ALL = 15;

/** per-state rebuild buffers of one implementation (accumulators + the corridor cache) */
export interface NimbyJsBuffers {
  C: number;
  stig: Float32Array;
  pres: Float32Array;
  camp: Float32Array;
  line: Float32Array;
  cls: Uint8Array;
  /** the class map / line raster belong to a completed corridor pass of this size */
  valid: boolean;
}

/** per-state NIMBY context: each implementation keeps its buffers here (the wasm binding adds its own) */
export interface NimbyCtx {
  js?: NimbyJsBuffers;
  [k: string]: unknown;
}

function jsBuffers(ctx: NimbyCtx, C: number): NimbyJsBuffers {
  let b = ctx.js;
  if (!b || b.C !== C) {
    b = { C, stig: new Float32Array(C), pres: new Float32Array(C), camp: new Float32Array(C), line: new Float32Array(C), cls: new Uint8Array(C), valid: false };
    ctx.js = b;
  }
  return b;
}

/** splatAdd over one table (row runs, clipped per row) */
function splatAddRuns(out: Float32Array, N: number, bx: number, bz: number, t: NimbyTable, amount: number): void {
  const runs = t.runs, w = t.w;
  let wi = 0;
  for (let r = 0, nr = t.nRuns * 3; r < nr; r += 3) {
    const len = runs[r + 2];
    const z = bz + runs[r];
    if (z >= 0 && z < N) {
      const x0 = bx + runs[r + 1];
      const xa = x0 > 0 ? x0 : 0;
      const x1 = x0 + len;
      const xb = x1 < N ? x1 : N;
      const row = z * N, off = wi - x0;
      for (let x = xa; x < xb; x++) out[row + x] += amount * w[off + x];
    }
    wi += len;
  }
}

/** splatMax over one table */
function splatMaxRuns(out: Float32Array, N: number, bx: number, bz: number, t: NimbyTable, amount: number): void {
  const runs = t.runs, w = t.w;
  let wi = 0;
  for (let r = 0, nr = t.nRuns * 3; r < nr; r += 3) {
    const len = runs[r + 2];
    const z = bz + runs[r];
    if (z >= 0 && z < N) {
      const x0 = bx + runs[r + 1];
      const xa = x0 > 0 ? x0 : 0;
      const x1 = x0 + len;
      const xb = x1 < N ? x1 : N;
      const row = z * N, off = wi - x0;
      for (let x = xa; x < xb; x++) {
        const i = row + x;
        const v = amount * w[off + x];
        if (v > out[i]) out[i] = v;
      }
    }
    wi += len;
  }
}

/**
 * the rebuild's raster work, by phase: PH_SPLAT (clear the stigma / prestige / campus accumulators, then the source list
 * in order), PH_LANDFILL (2×2 blocks into stigma), PH_CORRIDOR (class map compare, line raster rebuilt when changed or
 * forced), PH_FINAL (1 − exp(−x) into S / P / K). A rebuild is one call with PH_ALL.
 */
export function nimbyJs(ctx: NimbyCtx, a: NimbyArgs, phases = PH_ALL): NimbyResult {
  const N = a.N, C = N * N;
  const b = jsBuffers(ctx, C);
  const { stig, pres, camp, line, cls } = b;
  const res: NimbyResult = { lf: 0, changed: false, nh: 0, nr: 0 };
  if (phases & PH_SPLAT) {
    stig.fill(0); pres.fill(0); camp.fill(0);
    const src = a.src, rec = src.rec, amt = src.amt, list = src.tables.list;
    for (let s = 0, n = src.n; s < n; s++) {
      const o = 4 * s;
      const tg = rec[o + 2];
      splatAddRuns(tg === T_STIGMA ? stig : tg === T_PRESTIGE ? pres : camp, N, rec[o], rec[o + 1], list[rec[o + 3]], amt[s]);
    }
  }
  if (phases & PH_LANDFILL) {
    const t = a.lfTable;
    if (t !== null) {
      const zone = a.zone, lfFill = a.fill, code = a.lfCode, lfA = a.lfA, idle = a.lfIdle;
      let count = 0;
      for (let z = 0; z < N; z += 2) for (let x = 0; x < N; x += 2) {
        let cnt = 0, fill = 0;
        for (let dz = 0; dz < 2 && z + dz < N; dz++) for (let dx = 0; dx < 2 && x + dx < N; dx++) {
          const i = (z + dz) * N + x + dx;
          if (zone[i] !== code) continue;
          cnt++;
          const f = lfFill ? lfFill[i] : 0;
          fill += f > 0 ? (f < 1 ? f : 1) : 0;
        }
        if (cnt > 0) {
          const amount = lfA * (idle + (1 - idle) * (fill / cnt)) * cnt / 4;
          if (amount > 0) { splatAddRuns(stig, N, x, z, t, amount); count++; }
        }
      }
      res.lf = count;
    }
  }
  if (phases & PH_CORRIDOR) {
    const net = a.net, flags = a.flags, hw = a.highway, rail = a.rail;
    let changed = !b.valid || a.force;
    let nh = 0, nr = 0;
    for (let i = 0; i < C; i++) {
      const t = net[i];
      let k = 0;
      if (t === hw) {
        const f = flags[i];
        if ((f & 2) === 0) { nh++; k = (f & 1) !== 0 ? 2 : 1; }
      } else if (t === rail) { nr++; k = 3; }
      if (cls[i] !== k) { cls[i] = k; changed = true; }
    }
    if (changed) {
      b.valid = false;
      line.fill(0);
      const tabH = a.tabH, tabR = a.tabR, aH = a.aH, aHB = a.aHB, aR = a.aR;
      for (let i = 0; i < C; i++) {
        const k = cls[i];
        if (k === 0) continue;
        const x = i % N, z = (i / N) | 0;
        if (k === 1) splatMaxRuns(line, N, x, z, tabH, aH);
        else if (k === 2) splatMaxRuns(line, N, x, z, tabH, aHB);
        else splatMaxRuns(line, N, x, z, tabR, aR);
      }
      b.valid = true;
    }
    res.changed = changed; res.nh = nh; res.nr = nr;
  }
  if (phases & PH_FINAL) {
    const S = a.S, P = a.P, K = a.K;
    for (let i = 0; i < C; i++) {
      const v = stig[i] + line[i];
      S[i] = v > 0 ? 1 - Math.exp(-v) : 0;
      const p = pres[i];
      P[i] = p > 0 ? 1 - Math.exp(-p) : 0;
      const c = camp[i];
      K[i] = c > 0 ? 1 - Math.exp(-c) : 0;
    }
  }
  return res;
}

// ================================================================================================= pollution
/** stageCells' field work (the constants are the per-pass values stageCells computes before its loop) */
export interface CellsArgs {
  C: number;
  garbage: Float32Array;
  building: Int32Array;
  soil: Float32Array;
  network: Uint8Array;
  traffic: Float32Array;
  congestion: Float32Array;
  netFlags: Uint8Array;
  /** class-0 source fields air[0] / waterS[0] / noiseS[0] and soilSrc (in / out) */
  A0: Float32Array;
  W0: Float32Array;
  N0: Float32Array;
  soilSrc: Float32Array;
  /** traffic.freightRailCells() (null / empty = none) */
  freight: ArrayLike<number> | null;
  /** landfill regions: lfOrder, their count, per region start / count and the per-cell adds (air, water, noise, soil) */
  lfOrder: Int32Array;
  nReg: number;
  regStart: ArrayLike<number>;
  regCount: ArrayLike<number>;
  regAdd: Float64Array;
  /** areaSource(GARBAGE_SMELL, AIR_K) · fx.air */
  smell: number;
  /** srcScale(WATER_K), SOIL_GROUNDWATER */
  waterK: number;
  soilGW: number;
  /** AIR_PER_TRIP · fx.air, TUNNEL_AIR, NOISE_CONG_DAMP */
  trafficAir: number;
  tunnelAir: number;
  congDamp: number;
  /** intensityToSource(NOISE_CROSSING, noiseK) · tn, NOISE_PER_TRIP, TUNNEL_NOISE, BRIDGE_NOISE, fx3.noiseTraffic */
  crossing: number;
  noisePerTrip: number;
  tunnelNoise: number;
  bridgeNoise: number;
  tn: number;
  /** intensityToSource(NOISE_FREIGHT_RAIL, noiseK) · tn */
  freightS: number;
  /** NOISE_PER_TRIP_NET, baseNoiseSources(noiseK) (a Float32Array), by network code */
  perTrip: ArrayLike<number>;
  base: ArrayLike<number>;
  highway: number;
  rail: number;
}

/** `used` bits of the cell loop: anyA (used[0]), anyN (used[5]), anyW (used[3]) */
export const USED_A = 1, USED_N = 2, USED_W = 4;

/** pollution.ts intensityToSource */
export function intensityToSource(I: number, scale: number): number {
  if (I === 0) return 0;
  const a = Math.min(0.95, Math.abs(I));
  const v = -Math.log(1 - a) * scale;
  return I < 0 ? -v : v;
}

/** stageCells: cell loop, freight rail cells, landfill regions; returns the USED_* bits of the cell loop */
export function cellsJs(p: CellsArgs): number {
  const C = p.C;
  const G = p.garbage, bld = p.building, soil = p.soil, net = p.network, traffic = p.traffic, cong = p.congestion, nf = p.netFlags;
  const A0 = p.A0, W0 = p.W0, N0 = p.N0;
  const smell = p.smell, waterK = p.waterK, soilGW = p.soilGW, trafficAir = p.trafficAir, tunnelAir = p.tunnelAir, congDamp = p.congDamp;
  const crossing = p.crossing, npt = p.noisePerTrip, tunnelNoise = p.tunnelNoise, bridgeNoise = p.bridgeNoise, tn = p.tn;
  const perTrip = p.perTrip, base = p.base, HW = p.highway, RAIL = p.rail;
  let anyA = false, anyN = false, anyW = false;
  for (let i = 0; i < C; i++) {
    const g = G[i];
    if (g > 0.02 && bld[i] >= 0) { A0[i] += smell * g; anyA = true; }
    const so = soil[i];
    if (so > 0.005) { W0[i] += intensityToSource(soilGW * so, waterK); anyW = true; }
    const n = net[i];
    if (n === 0) continue;
    const t = traffic[i];
    const f = nf[i];
    let nz = 0;
    if (n <= HW) {
      if (t > 0) {
        const c = cong[i];
        A0[i] += t * trafficAir * (1 + (c < 2 ? c : 2)) * ((f & 2) !== 0 ? tunnelAir : 1);
        anyA = true;
        const damp = c > 1 ? 1 - congDamp * (c < 2 ? c - 1 : 1) : 1;
        nz = t * perTrip[n] * damp;
      }
      nz += base[n];
      if ((f & 0x20) !== 0) nz += crossing;
    } else if (n === RAIL) nz = t * npt * 0.2 + base[RAIL];
    if (nz > 0) {
      if ((f & 2) !== 0) nz *= tunnelNoise;
      else if ((f & 1) !== 0) nz *= bridgeNoise;
      N0[i] += nz * tn;
      anyN = true;
    }
  }
  const fr = p.freight;
  if (fr && fr.length > 0) {
    const s = p.freightS;
    for (let k = 0; k < fr.length; k++) { const i = fr[k]; if (i >= 0 && i < C) N0[i] += s; }
  }
  const order = p.lfOrder, soilSrc = p.soilSrc, add = p.regAdd;
  for (let r = 0; r < p.nReg; r++) {
    const s = p.regStart[r], n = p.regCount[r];
    const aa = add[4 * r], wa = add[4 * r + 1], na = add[4 * r + 2], sa = add[4 * r + 3];
    for (let q = 0; q < n; q++) {
      const i = order[s + q];
      A0[i] += aa; W0[i] += wa; N0[i] += na;
      soilSrc[i] += sa;
    }
  }
  return (anyA ? USED_A : 0) | (anyN ? USED_N : 0) | (anyW ? USED_W : 0);
}

/**
 * pollution.ts saturate (verbatim): L[i] += (sat(field[i] · invK) × buffer(i) − L[i]) · alpha, skipping mask[i] != 0;
 * buffer(i) = 1 − k1 buf1[i] − k2 buf2[i]
 */
export function saturateJs(field: Float32Array, L: Float32Array, C: number, invK: number, alpha: number, mask: Uint8Array | null,
  buf1: Float32Array | null = null, k1 = 0, buf2: Float32Array | null = null, k2 = 0): void {
  const SAT = SAT_TABLE;
  const scale = (invK * SAT_N) / SAT_MAX;
  for (let i = 0; i < C; i++) {
    if (mask !== null && mask[i] !== 0) continue;
    const f = field[i];
    let t = 0;
    if (f > 0) {
      const u = f * scale;
      if (u >= SAT_N) t = 1;
      else { const k = u | 0; const a = SAT[k]; t = a + (SAT[k + 1] - a) * (u - k); }
      if (buf1 !== null) {
        let m = 1 - k1 * buf1[i];
        if (buf2 !== null) m -= k2 * buf2[i];
        t *= m > 0 ? m : 0;
      }
    }
    L[i] += (t - L[i]) * alpha;
  }
}

/** stageB after the blur (the blurred water sources are in `tmp`) */
export interface WaterArgs {
  C: number;
  tmp: Float32Array;
  tmp2: Float32Array;
  /** st.waterPollution (in / out), the ground-water level of land cells (in / out), st.water */
  L: Float32Array;
  ground: Float32Array;
  water: Uint8Array;
  /** the water list (ensureWaterList): water cells, 4 neighbour slots each, bank cells and their water cell */
  waterCells: Int32Array;
  nW: number;
  waterNb: Int32Array;
  bankCells: Int32Array;
  bankSrc: Int32Array;
  /** 1 / WATER_K, the smoothing (first ? 1 : POLL_SMOOTH), BANK_COUPLING */
  invK: number;
  alpha: number;
  bankCoupling: number;
}
/** stageB's fixed numbers: iterations, share kept per iteration (WATER_DIFFUSE_KEEP), inflow gain, cleaning gain */
export const WATER_ITERS = 8, WATER_DIFFUSE_KEEP = 0.975, WATER_INFLOW = 0.12, WATER_CLEAN = 0.05;

/** diffusion state (reused buffers): inflow term, divisor, padded water-neighbour list per water cell, cur / nxt */
let wInfl = new Float64Array(0), wDiv = new Float64Array(0), wList = new Int32Array(0), wCur = new Float32Array(0), wNxt = new Float32Array(0);

/**
 * stageB after the blurPair call. The diffusion is restructured (identically in the wasm kernel, fields.rs):
 *  - loop invariants hoisted: `ground` is final before the iterations, so each water cell's land inflow term
 *    (max over its land slots in slot order, × WATER_INFLOW) and its water neighbours (slot order) are computed once
 *    per call instead of in each of the WATER_ITERS iterations;
 *  - each neighbour list is padded to 4 slots with the index nW of an extra cell holding −0.0, the exact additive
 *    identity (x + (−0) = x for every x, ±0 included), so a cell adds cur[q] and its 4 slots in slot order — the same
 *    values in the same order as the original `s += cur[t]` over its water slots — without a data-dependent loop;
 *  - private ping-pong buffers replace the per-iteration copy; afterwards tmp2 (`cur`) and, if an iteration ran, tmp
 *    (`nxt`) hold the final values, as in the original.
 * Lists that are not ensureWaterList output (an index out of range) take the original loops verbatim.
 */
export function waterJs(p: WaterArgs): void {
  const C = p.C, tmp = p.tmp, tmp2 = p.tmp2, L = p.L, ground = p.ground, wm = p.water;
  // negative sources (treatment plants) also clean nearby water bodies
  for (let i = 0; i < C; i++) if (wm[i] && tmp[i] < 0) L[i] = Math.max(0, L[i] + tmp[i] * WATER_CLEAN);
  // ground water of land cells
  saturateJs(tmp, ground, C, p.invK, p.alpha, wm);
  const nW = p.nW, wc = p.waterCells, wnb = p.waterNb;
  if (!waterListOk(C, nW, wc, wnb)) {
    waterDiffuseVerbatim(p);
  } else {
    if (wInfl.length < nW) { wInfl = new Float64Array(nW); wDiv = new Float64Array(nW); wList = new Int32Array(4 * nW); }
    if (wCur.length < nW + 1) { wCur = new Float32Array(nW + 1); wNxt = new Float32Array(nW + 1); }
    const infl = wInfl, div = wDiv, list = wList;
    let a = wCur, b = wNxt;
    for (let q = 0; q < nW; q++) a[q] = L[wc[q]];
    a[nW] = -0; b[nW] = -0;
    for (let q = 0; q < nW; q++) {
      let inflow = 0, cnt = 0;
      const bq = q * 4;
      for (let k = 0; k < 4; k++) {
        const t = wnb[bq + k];
        if (t === 0x7fffffff) continue;
        if (t >= 0) list[bq + cnt++] = t;
        else { const lv = ground[-t - 1]; if (lv > inflow) inflow = lv; }
      }
      for (let j = cnt; j < 4; j++) list[bq + j] = nW;
      infl[q] = inflow * WATER_INFLOW;
      div[q] = cnt + 1;
    }
    for (let it = 0; it < WATER_ITERS; it++) {
      for (let q = 0; q < nW; q++) {
        const bq = q * 4;
        const s = a[q] + a[list[bq]] + a[list[bq + 1]] + a[list[bq + 2]] + a[list[bq + 3]];
        const v = (s / div[q]) * WATER_DIFFUSE_KEEP + infl[q];
        b[q] = v > 1 ? 1 : v;
      }
      const t = a; a = b; b = t;
    }
    tmp2.set(a.subarray(0, nW));
    if (WATER_ITERS > 0) tmp.set(a.subarray(0, nW));
    for (let q = 0; q < nW; q++) L[wc[q]] = a[q];
  }
  // land = ground water, raised on the banks of polluted water bodies
  for (let i = 0; i < C; i++) if (!wm[i]) L[i] = ground[i];
  const bank = p.bankCells, src = p.bankSrc, coupling = p.bankCoupling;
  for (let k = 0; k < bank.length; k++) {
    const v = coupling * L[src[k]];
    const i = bank[k];
    if (v > L[i]) L[i] = v;
  }
}

/** every list index in range (water cells < C, water slots < nW, land slots < C; nW <= C and the arrays long enough) */
function waterListOk(C: number, nW: number, wc: Int32Array, wnb: Int32Array): boolean {
  if (nW > C || wc.length < nW || wnb.length < 4 * nW) return false;
  for (let q = 0; q < nW; q++) { const i = wc[q]; if (!(i >= 0 && i < C)) return false; }
  for (let k = 0, n = 4 * nW; k < n; k++) {
    const t = wnb[k];
    if (t === 0x7fffffff) continue;
    if (t >= 0 ? t >= nW : -t - 1 >= C) return false;
  }
  return true;
}

/** the original diffusion loops (pollution.ts @24f8609) */
function waterDiffuseVerbatim(p: WaterArgs): void {
  const L = p.L, ground = p.ground, nW = p.nW, wc = p.waterCells, wnb = p.waterNb;
  const cur = p.tmp2, nxt = p.tmp;
  for (let q = 0; q < nW; q++) cur[q] = L[wc[q]];
  for (let it = 0; it < WATER_ITERS; it++) {
    for (let q = 0; q < nW; q++) {
      let s = cur[q], n = 1, inflow = 0;
      const b = q * 4;
      for (let k = 0; k < 4; k++) {
        const t = wnb[b + k];
        if (t === 0x7fffffff) continue;
        if (t >= 0) { s += cur[t]; n++; }
        else { const lv = ground[-t - 1]; if (lv > inflow) inflow = lv; }
      }
      const v = (s / n) * WATER_DIFFUSE_KEEP + inflow * WATER_INFLOW;
      nxt[q] = v > 1 ? 1 : v;
    }
    for (let q = 0; q < nW; q++) cur[q] = nxt[q];
  }
  for (let q = 0; q < nW; q++) L[wc[q]] = cur[q];
}

/** stageFlags' soil stock (verbatim; grow = SOIL_RATE · dt, keep = max(0, 1 − SOIL_DECAY · dt · soil.decay)) */
export function soilJs(soil: Float32Array, src: Float32Array, C: number, grow: number, keep: number): void {
  for (let i = 0; i < C; i++) {
    let s = soil[i];
    const q = src[i];
    if (s === 0 && q === 0) continue;
    if (q > 0) s += grow * Math.min(1, q) * (1 - s);
    s *= keep;
    soil[i] = s < 1e-4 ? 0 : s;
  }
}

// ================================================================================================= kernel set
/** the kernels, as the wasm binding exposes them (makeFieldKernels(fieldKernelsJs) has the same shape) */
export interface FieldKernels {
  readonly kind: string;
  nimby(ctx: NimbyCtx, a: NimbyArgs, phases?: number): NimbyResult;
  cells(p: CellsArgs): number;
  saturate(field: Float32Array, L: Float32Array, C: number, invK: number, alpha: number, mask: Uint8Array | null,
    buf1?: Float32Array | null, k1?: number, buf2?: Float32Array | null, k2?: number): void;
  water(p: WaterArgs): void;
  soil(soil: Float32Array, src: Float32Array, C: number, grow: number, keep: number): void;
}

export const fieldKernelsJs: FieldKernels = {
  kind: 'fair JS',
  nimby: nimbyJs,
  cells: cellsJs,
  saturate: saturateJs,
  water: waterJs,
  soil: soilJs,
};
