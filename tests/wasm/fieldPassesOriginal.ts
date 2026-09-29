/**
 * FROZEN originals of the field passes at commit 24f8609 — the reference of tests/wasm/fieldPasses.test.ts and the
 * "as-is" arm of the capture benchmarks (tools/bench/fieldPasses), for inputs that do not come from a Simulation:
 *  - nimby.ts: kernelOf / splatAdd / splatMax (verbatim, with their own kernel cache) and the raster part of
 *    rebuildNimby (landfill blocks, corridors, the 1 − exp(−x) pass) over an explicit list of splatAdd calls (the calls
 *    the building walk makes, in its order);
 *  - pollution.ts: saturate (verbatim, its own SAT table), stageCells' loops, stageB after the blur, the soil loop of
 *    stageFlags — each the method body with `this.x` turned into an argument.
 * Only the plumbing differs (arguments instead of `this` / `sim`); every expression is the original's.
 */
import { Network, Zone } from '../../src/core/types';

// =================================================================================================== nimby.ts
interface Kernel { dx: Int16Array; dz: Int16Array; w: Float32Array; n: number }

/** one splatAdd call of the building walk (splatAdd(target, N, x, z, w, d, amount, R)) */
export interface OrigSplat { x: number; z: number; w: number; d: number; amount: number; R: number; target: 0 | 1 | 2 }

export interface OrigNimbyInput {
  N: number;
  splats: OrigSplat[];
  zone: Uint8Array;
  landfillFill: Float32Array | null;
  network: Uint8Array;
  netFlags: Uint8Array;
  /** the landfill def's stigma (amount, radius) */
  lfA: number;
  lfR: number;
  NIMBY_LANDFILL_IDLE: number;
  NIMBY_HIGHWAY: { amount: number; radius: number };
  NIMBY_HIGHWAY_BRIDGE: number;
  NIMBY_RAIL: { amount: number; radius: number };
  stigma: Float32Array;
  prestige: Float32Array;
  campus: Float32Array;
}

/** nimby.ts's rasters with its own module state (kernel cache + scratch); returns the rebuild's `touches` */
export function makeOriginalNimby(falloff: (d: number, R: number) => number): (inp: OrigNimbyInput) => number {
  const kernels = new Map<number, Kernel>();
  function kernelOf(R: number, bw: number, bd: number): Kernel {
    const r = Math.max(0, Math.min(60, Math.round(R * 4) / 4));
    const key = (r * 4) * 4096 + Math.min(63, bw) * 64 + Math.min(63, bd);
    let k = kernels.get(key);
    if (k) return k;
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
    k = { dx: Int16Array.from(dx), dz: Int16Array.from(dz), w: Float32Array.from(w), n: w.length };
    kernels.set(key, k);
    return k;
  }
  function splatAdd(out: Float32Array, N: number, bx: number, bz: number, bw: number, bd: number, amount: number, R: number): number {
    if (!(amount > 0) || !(R > 0)) return 0;
    const k = kernelOf(R, bw, bd);
    for (let q = 0; q < k.n; q++) {
      const x = bx + k.dx[q], z = bz + k.dz[q];
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      out[z * N + x] += amount * k.w[q];
    }
    return k.n;
  }
  function splatMax(out: Float32Array, N: number, x0: number, z0: number, amount: number, R: number): number {
    const k = kernelOf(R, 1, 1);
    for (let q = 0; q < k.n; q++) {
      const x = x0 + k.dx[q], z = z0 + k.dz[q];
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const i = z * N + x;
      const v = amount * k.w[q];
      if (v > out[i]) out[i] = v;
    }
    return k.n;
  }
  let scratch = { C: 0, stig: new Float32Array(0), line: new Float32Array(0), pres: new Float32Array(0), camp: new Float32Array(0) };
  return (inp: OrigNimbyInput): number => {
    const N = inp.N, C = N * N;
    if (scratch.C !== C) scratch = { C, stig: new Float32Array(C), line: new Float32Array(C), pres: new Float32Array(C), camp: new Float32Array(C) };
    const { stig, line, pres, camp } = scratch;
    stig.fill(0); line.fill(0); pres.fill(0); camp.fill(0);
    let touches = 0;
    for (const s of inp.splats) touches += splatAdd(s.target === 0 ? stig : s.target === 1 ? pres : camp, N, s.x, s.z, s.w, s.d, s.amount, s.R);
    const lfA = inp.lfA, lfR = inp.lfR, NIMBY_LANDFILL_IDLE = inp.NIMBY_LANDFILL_IDLE;
    const zone = inp.zone, net = inp.network, flags = inp.netFlags, lfFill = inp.landfillFill;
    for (let z = 0; z < N; z += 2) for (let x = 0; x < N; x += 2) {
      let cnt = 0, fill = 0;
      for (let dz = 0; dz < 2 && z + dz < N; dz++) for (let dx = 0; dx < 2 && x + dx < N; dx++) {
        const i = (z + dz) * N + x + dx;
        if (zone[i] !== Zone.Landfill) continue;
        cnt++;
        const f = lfFill ? lfFill[i] : 0;
        fill += f > 0 ? (f < 1 ? f : 1) : 0;
      }
      if (cnt > 0) touches += splatAdd(stig, N, x, z, 2, 2, lfA * (NIMBY_LANDFILL_IDLE + (1 - NIMBY_LANDFILL_IDLE) * (fill / cnt)) * cnt / 4, lfR);
    }
    const { NIMBY_HIGHWAY, NIMBY_HIGHWAY_BRIDGE, NIMBY_RAIL } = inp;
    for (let i = 0; i < C; i++) {
      const t = net[i];
      if (t === Network.Highway) {
        const f = flags[i];
        if (f & 2) continue; // tunnel
        touches += splatMax(line, N, i % N, (i / N) | 0, f & 1 ? NIMBY_HIGHWAY_BRIDGE : NIMBY_HIGHWAY.amount, NIMBY_HIGHWAY.radius);
      } else if (t === Network.Rail) {
        touches += splatMax(line, N, i % N, (i / N) | 0, NIMBY_RAIL.amount, NIMBY_RAIL.radius);
      }
    }
    const S = inp.stigma, P = inp.prestige, K = inp.campus;
    for (let i = 0; i < C; i++) {
      const a = stig[i] + line[i];
      S[i] = a > 0 ? 1 - Math.exp(-a) : 0;
      const p = pres[i];
      P[i] = p > 0 ? 1 - Math.exp(-p) : 0;
      const c = camp[i];
      K[i] = c > 0 ? 1 - Math.exp(-c) : 0;
    }
    return touches;
  };
}

// =================================================================================================== pollution.ts
const SAT_N = 4096, SAT_MAX = 16;
const SAT = new Float32Array(SAT_N + 1);
for (let i = 0; i <= SAT_N; i++) SAT[i] = 1 - Math.exp(-(i / SAT_N) * SAT_MAX);

export function origSaturate(field: Float32Array, L: Float32Array, C: number, invK: number, alpha: number, mask: Uint8Array | null,
  buf1: Float32Array | null = null, k1 = 0, buf2: Float32Array | null = null, k2 = 0): void {
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

function intensityToSource(I: number, scale: number): number {
  if (I === 0) return 0;
  const a = Math.min(0.95, Math.abs(I));
  const v = -Math.log(1 - a) * scale;
  return I < 0 ? -v : v;
}

/** stageCells' inputs (the state layers, the class-0 sources, `this` fields and the per-pass values it computes) */
export interface OrigCellsInput {
  C: number;
  traffic: Float32Array; congestion: Float32Array; network: Uint8Array; netFlags: Uint8Array; building: Int32Array; garbage: Float32Array; soil: Float32Array;
  A0: Float32Array; W0: Float32Array; N0: Float32Array; soilSrc: Float32Array; used: Uint8Array;
  trafficAir: number; tn: number; perTrip: readonly number[]; base: Float32Array; crossing: number; smell: number; waterK: number;
  SOIL_GROUNDWATER: number; TUNNEL_AIR: number; NOISE_CONG_DAMP: number; NOISE_PER_TRIP: number; TUNNEL_NOISE: number; BRIDGE_NOISE: number;
  /** freight rail cells and intensityToSource(NOISE_FREIGHT_RAIL, noiseK) · tn */
  fr: ArrayLike<number> | null;
  freightS: number;
  /** landfill regions (this.nReg / regStart / regCount / regCap / regUsed / lfOrder) and the per-pass landfill numbers */
  nReg: number; regStart: number[]; regCount: number[]; regCap: number[]; regUsed: number[]; lfOrder: Int32Array;
  lfAir: number; lfWater: number; lfNoise: number;
  LANDFILL_IDLE_EMIT: number; LANDFILL_SIZE_REF: number; SOIL_SRC_LANDFILL: number;
}

/** stageCells from the cell loop to the landfill regions (the tree cover / park buffer are blur calls, not ported) */
export function origStageCells(p: OrigCellsInput): void {
  const C = p.C;
  const traffic = p.traffic, cong = p.congestion, net = p.network, nf = p.netFlags, bld = p.building;
  const A0 = p.A0, W0 = p.W0, N0 = p.N0;
  const used = p.used;
  const trafficAir = p.trafficAir;
  const tn = p.tn;
  const perTrip = p.perTrip, base = p.base;
  const crossing = p.crossing;
  const { SOIL_GROUNDWATER, TUNNEL_AIR, NOISE_CONG_DAMP, NOISE_PER_TRIP, TUNNEL_NOISE, BRIDGE_NOISE, waterK } = p;
  let anyA = false, anyN = false, anyW = false;
  const G = p.garbage, soil = p.soil;
  const smell = p.smell;
  for (let i = 0; i < C; i++) {
    const g = G[i];
    if (g > 0.02 && bld[i] >= 0) { A0[i] += smell * g; anyA = true; }
    const so = soil[i];
    if (so > 0.005) { W0[i] += intensityToSource(SOIL_GROUNDWATER * so, waterK); anyW = true; }
    const n = net[i];
    if (n === 0) continue;
    const t = traffic[i];
    const f = nf[i];
    let nz = 0;
    if (n <= Network.Highway) {
      if (t > 0) {
        const c = cong[i];
        A0[i] += t * trafficAir * (1 + (c < 2 ? c : 2)) * ((f & 2) !== 0 ? TUNNEL_AIR : 1);
        anyA = true;
        const damp = c > 1 ? 1 - NOISE_CONG_DAMP * (c < 2 ? c - 1 : 1) : 1;
        nz = t * perTrip[n] * damp;
      }
      nz += base[n];
      if ((f & 0x20) !== 0) nz += crossing;
    } else if (n === Network.Rail) nz = t * NOISE_PER_TRIP * 0.2 + base[Network.Rail];
    if (nz > 0) {
      if ((f & 2) !== 0) nz *= TUNNEL_NOISE;
      else if ((f & 1) !== 0) nz *= BRIDGE_NOISE;
      N0[i] += nz * tn;
      anyN = true;
    }
  }
  const fr = p.fr;
  if (fr && fr.length > 0) {
    const s = p.freightS;
    for (let k = 0; k < fr.length; k++) { const i = fr[k]; if (i >= 0 && i < C) N0[i] += s; }
    anyN = true;
  }
  if (anyA) used[0] = 1;
  if (anyN) used[5] = 1;
  if (anyW) used[3] = 1;
  const { lfAir, lfWater, lfNoise, LANDFILL_IDLE_EMIT, LANDFILL_SIZE_REF, SOIL_SRC_LANDFILL } = p;
  const soilSrc = p.soilSrc;
  for (let r = 0; r < p.nReg; r++) {
    const s = p.regStart[r], n = p.regCount[r];
    const use = p.regCap[r] > 0 ? Math.min(1, p.regUsed[r] / p.regCap[r]) : 0;
    const act = LANDFILL_IDLE_EMIT + (1 - LANDFILL_IDLE_EMIT) * use;
    const m = act / Math.sqrt(Math.max(1, n / LANDFILL_SIZE_REF));
    for (let q = 0; q < n; q++) {
      const i = p.lfOrder[s + q];
      A0[i] += lfAir * m; W0[i] += lfWater * m; N0[i] += lfNoise * m;
      soilSrc[i] += SOIL_SRC_LANDFILL * act;
    }
    if (n > 0) { used[0] = 1; used[3] = 1; used[5] = 1; }
  }
}

export interface OrigWaterInput {
  C: number;
  tmp: Float32Array; tmp2: Float32Array; L: Float32Array; ground: Float32Array; wm: Uint8Array;
  alpha: number; WATER_K: number; BANK_COUPLING: number;
  nW: number; waterCells: Int32Array; waterNb: Int32Array; bankCells: Int32Array; bankSrc: Int32Array;
}

/** stageB after `this.blurPair(this.waterS, 3, tmp, N)` (ensureWaterList has run) */
export function origStageBAfterBlur(p: OrigWaterInput): void {
  const C = p.C;
  const tmp = p.tmp, tmp2 = p.tmp2;
  const alpha = p.alpha;
  const L = p.L, ground = p.ground;
  const wm = p.wm;
  for (let i = 0; i < C; i++) if (wm[i] && tmp[i] < 0) L[i] = Math.max(0, L[i] + tmp[i] * 0.05);
  origSaturate(tmp, ground, C, 1 / p.WATER_K, alpha, wm);
  const nW = p.nW, wc = p.waterCells, wnb = p.waterNb;
  const cur = tmp2, nxt = tmp;
  for (let q = 0; q < nW; q++) cur[q] = L[wc[q]];
  const iters = 8;
  for (let it = 0; it < iters; it++) {
    for (let q = 0; q < nW; q++) {
      let s = cur[q], n = 1, inflow = 0;
      const b = q * 4;
      for (let k = 0; k < 4; k++) {
        const t = wnb[b + k];
        if (t === 0x7fffffff) continue;
        if (t >= 0) { s += cur[t]; n++; }
        else { const lv = ground[-t - 1]; if (lv > inflow) inflow = lv; }
      }
      const v = (s / n) * 0.975 + inflow * 0.12;
      nxt[q] = v > 1 ? 1 : v;
    }
    for (let q = 0; q < nW; q++) cur[q] = nxt[q];
  }
  for (let q = 0; q < nW; q++) L[wc[q]] = cur[q];
  for (let i = 0; i < C; i++) if (!wm[i]) L[i] = ground[i];
  const bank = p.bankCells, src = p.bankSrc;
  for (let k = 0; k < bank.length; k++) {
    const v = p.BANK_COUPLING * L[src[k]];
    const i = bank[k];
    if (v > L[i]) L[i] = v;
  }
}

/** ensureWaterList (verbatim; DX / DZ of common.ts) */
export function origWaterList(N: number, wm: Uint8Array, BANK_DIST: number, DX: readonly number[], DZ: readonly number[]):
  { nWater: number; waterCells: Int32Array; waterNb: Int32Array; bankCells: Int32Array; bankSrc: Int32Array } {
  const C = N * N;
  let n = 0;
  const idx = new Int32Array(C).fill(-1);
  for (let i = 0; i < C; i++) if (wm[i]) idx[i] = n++;
  const waterCells = new Int32Array(n);
  const waterNb = new Int32Array(n * 4);
  for (let i = 0, q = 0; i < C; i++) {
    if (!wm[i]) continue;
    waterCells[q] = i;
    const x = i % N, z = (i - x) / N;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k], nz = z + DZ[k];
      let t = 0x7fffffff;
      if (nx >= 0 && nz >= 0 && nx < N && nz < N) {
        const j = nz * N + nx;
        t = wm[j] ? idx[j] : -j - 1;
      }
      waterNb[q * 4 + k] = t;
    }
    q++;
  }
  const src = new Int32Array(C).fill(-1);
  const dist = new Uint8Array(C);
  const queue = new Int32Array(C);
  let qh = 0, qt = 0;
  for (let i = 0; i < C; i++) if (wm[i]) { src[i] = i; queue[qt++] = i; }
  const bank: number[] = [], bankSrc: number[] = [];
  while (qh < qt) {
    const i = queue[qh++];
    const d = dist[i];
    if (d >= BANK_DIST) continue;
    const x = i % N;
    const nb = [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, i >= N ? i - N : -1, i + N < C ? i + N : -1];
    for (const j of nb) {
      if (j < 0 || src[j] >= 0) continue;
      src[j] = src[i];
      dist[j] = d + 1;
      queue[qt++] = j;
      bank.push(j);
      bankSrc.push(src[i]);
    }
  }
  return { nWater: n, waterCells, waterNb, bankCells: Int32Array.from(bank), bankSrc: Int32Array.from(bankSrc) };
}

/** stageFlags' soil stock (dt > 0) */
export function origSoil(soil: Float32Array, src: Float32Array, C: number, dt: number, soilDecay: number, SOIL_RATE: number, SOIL_DECAY: number): void {
  const grow = SOIL_RATE * dt, keep = Math.max(0, 1 - SOIL_DECAY * dt * soilDecay);
  for (let i = 0; i < C; i++) {
    let s = soil[i];
    const q = src[i];
    if (s === 0 && q === 0) continue;
    if (q > 0) s += grow * Math.min(1, q) * (1 - s);
    s *= keep;
    soil[i] = s < 1e-4 ? 0 : s;
  }
}
