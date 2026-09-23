/**
 * Terrain generation for a city from its config (presets) — headless-safe (no DOM / three.js).
 * Produces corner heights (meters, sea level = 0), water mask and tree densities.
 *
 * Presets (config.terrain): flat, plains, hills, mountains, river, coast, islands, lakes
 * ('region' without a sampler falls back to 'hills').
 * Region-derived terrain instead passes an explicit height sampler (opts.sampler) — the sampler output is used
 * verbatim (no non-local post processing) so neighbouring cities sampled from one region match at their edges.
 *
 * Pipeline for presets: domain-warped fbm base -> preset shaping (river/coast/lake/island carving) ->
 * erosion-like smoothing (valley sediment fill + thermal talus relaxation) -> cliffs (mountains) -> beach shaping.
 * Features are defined in normalized map coordinates of the LOGICAL map size, so a low resolution preview
 * (opts.logicalSize) looks like the full-size map.
 */
import { Noise2D, RNG, clamp, hash2, lerp, smoothstep } from '../core/rng';
import { CityState } from './CityState';
import type { CityConfigData } from './config';
import { CELL_SIZE } from '../core/constants';

export interface TerrainOptions {
  /** optional custom height sampler in normalized city coords u,v in [0,1] -> meters */
  sampler?: (u: number, v: number) => number;
  /** optional forest density sampler (u,v in [0,1]) -> 0..1 (region-consistent forests). Overrides the noise field. */
  forestSampler?: (u: number, v: number) => number;
  /**
   * Shape the terrain as if the map had `logicalSize` cells per side while generating at state.size resolution
   * (used for fast low-res previews of a bigger map). Default: state.size.
   */
  logicalSize?: number;
  /** skip the tree pass (call scatterTrees(state, opts) afterwards, e.g. to show loading progress) */
  skipTrees?: boolean;
}

export function generateTerrain(state: CityState, opts: TerrainOptions = {}): void {
  const N = state.size;
  const N1 = N + 1;
  const H = state.heights;
  if (opts.sampler) {
    const s = opts.sampler;
    for (let z = 0; z <= N; z++) for (let x = 0; x <= N; x++) H[z * N1 + x] = s(x / N, z / N);
  } else {
    presetHeights(state.config, N, opts.logicalSize ?? N, H);
  }
  computeWater(state);
  // presets only (non-local): drop tiny inland puddles left by noise. Region samplers are used verbatim.
  if (!opts.sampler && removePuddles(state, Math.max(3, Math.round(10 * (N / (opts.logicalSize ?? N)) ** 2)))) computeWater(state);
  if (!opts.skipTrees) scatterTrees(state, opts);
}

/** Raise small enclosed water bodies (< minCells cells, not touching the map edge) just above sea level. */
function removePuddles(state: CityState, minCells: number): boolean {
  const N = state.size, N1 = N + 1;
  const seen = new Uint8Array(N * N);
  const stack: number[] = [];
  const comp: number[] = [];
  let changed = false;
  for (let s = 0; s < N * N; s++) {
    if (!state.water[s] || seen[s]) continue;
    comp.length = 0;
    stack.push(s);
    seen[s] = 1;
    let edge = false;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % N, z = (i / N) | 0;
      if (x === 0 || z === 0 || x === N - 1 || z === N - 1) edge = true;
      if (x > 0 && state.water[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
      if (x < N - 1 && state.water[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
      if (z > 0 && state.water[i - N] && !seen[i - N]) { seen[i - N] = 1; stack.push(i - N); }
      if (z < N - 1 && state.water[i + N] && !seen[i + N]) { seen[i + N] = 1; stack.push(i + N); }
    }
    if (edge || comp.length >= minCells) continue;
    changed = true;
    for (const i of comp) {
      const x = i % N, z = (i / N) | 0;
      for (const c of [z * N1 + x, z * N1 + x + 1, (z + 1) * N1 + x, (z + 1) * N1 + x + 1]) if (state.heights[c] < 0.35) state.heights[c] = 0.35;
    }
  }
  return changed;
}

/** a cell is water if its average corner height is below sea level */
export function computeWater(state: CityState, x0 = 0, z0 = 0, x1 = state.size, z1 = state.size): void {
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) state.water[z * state.size + x] = state.cellHeight(x, z) < 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Preset height fields
// ---------------------------------------------------------------------------------------------------------------

interface River {
  /** polyline in normalized coords */
  pts: number[];
  /** half width (m) at source / mouth */
  hw0: number;
  hw1: number;
  /** valley half width beyond the banks (m) */
  valley: number;
}

function presetHeights(cfg: CityConfigData, N: number, L: number, H: Float32Array): void {
  const N1 = N + 1;
  const preset = cfg.terrain === 'region' ? 'hills' : cfg.terrain;
  const hill = clamp(cfg.hilliness, 0, 1);
  const wat = clamp(cfg.waterAmount, 0, 1);
  const seed = cfg.seed >>> 0;
  const nA = new Noise2D(seed);
  const nB = new Noise2D(seed + 17);
  const nW = new Noise2D(seed + 31);
  const rng = new RNG(seed + 5);
  /** base feature frequency (cycles across the map); small maps are not just crops of a big map */
  const fs = 3.2 * Math.sqrt(L / 256);
  const sizeM = L * CELL_SIZE;
  const cellM = sizeM / N; // meters between corner samples at this resolution

  // --- shared noise fields ----------------------------------------------------------------------------------
  const base = new Float32Array(N1 * N1); // 0..1
  const ridge = new Float32Array(N1 * N1); // 0..1
  const detail = new Float32Array(N1 * N1); // ~-1..1
  const needRidge = preset === 'mountains' || preset === 'hills';
  for (let z = 0; z <= N; z++) {
    const v = z / N;
    for (let x = 0; x <= N; x++) {
      const u = x / N;
      const p = u * fs, q = v * fs;
      // domain warp (low octaves only — warping high octaves stretches them into streaks)
      const wx = nW.noise(p * 0.45 + 3.1, q * 0.45 - 1.7);
      const wz = nW.noise(p * 0.45 - 7.3, q * 0.45 + 5.2);
      const pw = p + wx * 0.5, qw = q + wz * 0.5;
      const i = z * N1 + x;
      const lo = nA.noise(pw, qw) + 0.5 * nA.noise(pw * 2 + 5.2, qw * 2 - 1.3);
      const hi = 0.25 * nA.noise(p * 4 - 3.7, q * 4 + 8.1) + 0.125 * nA.noise(p * 8 + 1.1, q * 8 + 4.4) + 0.0625 * nA.noise(p * 16 - 9.9, q * 16 - 2.2);
      base[i] = (lo + hi) / 1.9375 * 0.5 + 0.5;
      // ridges use a much lighter warp (heavy warps stretch ridges into swirly streaks)
      if (needRidge) ridge[i] = nB.ridged(u * fs * 0.75 + wx * 0.12 + 11, v * fs * 0.75 + wz * 0.12 - 7, 5);
      detail[i] = nB.fbm(u * fs * 4.2 + 50, v * fs * 4.2 - 20, 3);
    }
  }

  const rivers: River[] = [];
  // side vectors: 0 = north (v=0), 1 = east (u=1), 2 = south (v=1), 3 = west (u=0)
  const edgePoint = (side: number, t: number): [number, number] => {
    switch (side & 3) {
      case 0: return [t, -0.02];
      case 1: return [1.02, t];
      case 2: return [t, 1.02];
      default: return [-0.02, t];
    }
  };

  switch (preset) {
    case 'flat': {
      for (let i = 0; i < H.length; i++) H[i] = 3.5 + (base[i] - 0.5) * 2.5 * (0.4 + hill) + detail[i] * 0.5;
      if (wat > 0.55) {
        // a small pond
        carveLakes(H, N, rng, nW, 1, 0.06 + (wat - 0.55) * 0.2, sizeM);
      }
      break;
    }
    case 'plains': {
      for (let i = 0; i < H.length; i++) {
        const b = base[i];
        H[i] = 3 + Math.pow(b, 1.35) * 24 * (0.35 + hill) + detail[i] * 1.1 - wat * 7;
      }
      if (wat > 0.25) {
        const s = rng.int(0, 3);
        rivers.push(makeRiver(rng, edgePoint(s, rng.range(0.2, 0.8)), edgePoint(s + 2, rng.range(0.2, 0.8)), 10 + wat * 18, 1.7, 140 + hill * 80));
      }
      break;
    }
    case 'hills': {
      for (let i = 0; i < H.length; i++) {
        const b = base[i];
        // soft plateaus: compress mid heights so hills have gentle tops and valley floors
        const shaped = plateau(Math.pow(b, 1.3), 3, 0.3);
        H[i] = 4 + shaped * 100 * (0.3 + hill) + ridge[i] * ridge[i] * 26 * hill + detail[i] * 2.2 - wat * 30;
      }
      if (wat > 0.45 && rng.chance(0.6)) {
        const s = rng.int(0, 3);
        rivers.push(makeRiver(rng, edgePoint(s, rng.range(0.25, 0.75)), edgePoint(s + 2, rng.range(0.25, 0.75)), 9 + wat * 12, 1.6, 120 + hill * 120));
      }
      break;
    }
    case 'mountains': {
      for (let i = 0; i < H.length; i++) {
        const b = base[i];
        const r = ridge[i];
        const massif = smoothstep(0.25, 0.75, b);
        H[i] = 6 + b * 45 * (0.4 + hill) + r * r * massif * 210 * (0.35 + hill * 0.9) + detail[i] * 4 - wat * 20;
      }
      break;
    }
    case 'river': {
      // terrain slopes gently down towards the downstream edge
      const s = rng.int(0, 3);
      const a = edgePoint(s, rng.range(0.2, 0.8));
      const b = edgePoint(s + 2, rng.range(0.25, 0.75));
      const tilt = 10 + 14 * hill;
      for (let z = 0; z <= N; z++) {
        for (let x = 0; x <= N; x++) {
          const i = z * N1 + x;
          const u = x / N, v = z / N;
          const along = ((u - a[0]) * (b[0] - a[0]) + (v - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
          H[i] = 6 + plateau(Math.pow(base[i], 1.25), 3, 0.25) * 55 * (0.3 + hill) + detail[i] * 1.8 + (1 - clamp(along, 0, 1)) * tilt;
        }
      }
      rivers.push(makeRiver(rng, a, b, 26 + wat * 34, 2.1, 170 + hill * 150));
      // occasional tributary joining from the side
      if (rng.chance(0.55 + wat * 0.3)) {
        const main = rivers[0];
        const k = Math.floor((main.pts.length / 2) * rng.range(0.35, 0.7)) * 2;
        const jx = main.pts[k], jz = main.pts[k + 1];
        const side = rng.chance(0.5) ? s + 1 : s + 3;
        rivers.push(makeRiver(rng, edgePoint(side, rng.range(0.2, 0.8)), [jx, jz], 10 + wat * 12, 1.6, 90 + hill * 80));
      }
      break;
    }
    case 'coast': {
      const diag = rng.chance(0.35);
      const side = rng.int(0, 3);
      const shoreAt = 0.16 + wat * 0.34;
      for (let z = 0; z <= N; z++) {
        for (let x = 0; x <= N; x++) {
          const i = z * N1 + x;
          const u = x / N, v = z / N;
          // t = distance from the sea side (0 at the sea edge)
          let t: number;
          if (diag) {
            const cu = side & 1 ? 1 - u : u, cv = side & 2 ? 1 - v : v;
            t = (cu + cv) * 0.5 / 1.6;
          } else t = [v, 1 - u, 1 - v, u][side];
          const warp = nW.fbm(u * 2.6 * fs * 0.4 + 9, v * 2.6 * fs * 0.4 - 3, 4) * 0.11;
          const sd = t - shoreAt - warp; // < 0 = sea
          const land = 3 + plateau(Math.pow(base[i], 1.2), 3, 0.25) * 60 * (0.3 + hill) + detail[i] * 1.8 + smoothstep(0, 0.6, sd) * 14 * hill;
          const sea = -1.2 - 26 * smoothstep(0, 0.32, -sd);
          const k = smoothstep(-0.015, 0.09 + hill * 0.05, sd);
          H[i] = lerp(sea, land, k);
        }
      }
      if (rng.chance(0.5 + wat * 0.3)) {
        // a river flowing out to the sea
        const src = diag ? edgePoint(side + 2, rng.range(0.3, 0.7)) : edgePoint(side + 2, rng.range(0.25, 0.75));
        let mouth: [number, number];
        if (diag) {
          const mu = side & 1 ? 1 : 0, mv = side & 2 ? 1 : 0;
          mouth = [lerp(mu, 0.5, 0.15), lerp(mv, 0.5, 0.15)];
        } else mouth = edgePoint(side, rng.range(0.3, 0.7));
        rivers.push(makeRiver(rng, src, mouth, 12 + wat * 16, 2.3, 120 + hill * 100));
      }
      break;
    }
    case 'islands': {
      const cx = rng.range(0.42, 0.58), cz = rng.range(0.42, 0.58);
      const islets: [number, number, number][] = [];
      const nIslets = rng.int(2, 5);
      for (let k = 0; k < nIslets; k++) {
        const a = (k / nIslets) * Math.PI * 2 + rng.range(-0.5, 0.5), r = rng.range(0.34, 0.42);
        islets.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, rng.range(0.045, 0.1)]);
      }
      for (let z = 0; z <= N; z++) {
        for (let x = 0; x <= N; x++) {
          const i = z * N1 + x;
          const u = x / N, v = z / N;
          const du = u - cx, dv = v - cz;
          const warp = nW.fbm(u * 3 + 4, v * 3 - 8, 4) * 0.12;
          const r = Math.sqrt(du * du + dv * dv) + warp;
          let land = base[i] * 0.9 + 0.62 - r * (2.5 + wat * 3);
          for (const [ix, iz, ir] of islets) {
            const d = Math.hypot(u - ix, v - iz) + warp * 0.5;
            land = Math.max(land, (ir - d) / ir * 0.35 + (base[i] - 0.5) * 0.2);
          }
          let h = land * 70 * (0.45 + hill) + detail[i] * 1.5;
          if (h < 0) h = h * 0.7 - 1.5;
          H[i] = Math.max(h, -30);
        }
      }
      break;
    }
    case 'lakes': {
      for (let i = 0; i < H.length; i++) H[i] = 5 + plateau(base[i], 3, 0.25) * 45 * (0.3 + hill) + detail[i] * 1.8;
      carveLakes(H, N, rng, nW, rng.int(2, 3) + Math.round(wat * 3), 0.07 + wat * 0.09, sizeM);
      break;
    }
    default:
      for (let i = 0; i < H.length; i++) H[i] = 4 + base[i] * 50 * (0.3 + hill) + detail[i] * 2.5;
  }

  // --- erosion-like smoothing -------------------------------------------------------------------------------
  // passes scale with (resolution / logical size)^2 so a low-res preview smooths the same physical distance
  const res = N / L;
  const sedimentPasses = Math.max(1, Math.round(3 * res * res));
  sedimentFill(H, N, sedimentPasses, preset === 'mountains' ? 0.25 : 0.55, preset === 'mountains' ? 70 : 45);
  thermalErosion(H, N, Math.max(1, Math.round(6 * res)), 0.6 * cellM, 0.35);

  // --- rivers carved after smoothing to keep banks crisp ----------------------------------------------------
  for (const r of rivers) carveRiver(H, N, r, cellM, sizeM);

  // --- cliffs & benches in mountains ----------------------------------------------------------------------------
  if (preset === 'mountains') {
    const step = 26 + 12 * (1 - hill);
    for (let i = 0; i < H.length; i++) {
      const h = H[i];
      if (h < 50) continue;
      const f = h / step;
      const fl = Math.floor(f);
      const ter = (fl + smoothstep(0.6, 0.9, f - fl)) * step;
      H[i] = lerp(h, ter, 0.4 * smoothstep(50, 90, h));
    }
  }

  // --- beaches: gentle slope close to the shoreline, crisp water edge -------------------------------------------
  shapeShores(H);
}

/** soft terracing: flattens `steps` bands of a 0..1 value by `amount` */
function plateau(v: number, steps: number, amount: number): number {
  const f = v * steps;
  const fl = Math.floor(f);
  const fr = f - fl;
  const s = fr * fr * (3 - 2 * fr);
  const t = (fl + s * s * (3 - 2 * s)) / steps;
  return lerp(v, t, amount);
}

export function shapeShoreHeight(h: number): number {
  if (h > 0 && h < 3) return 3 * Math.pow(h / 3, 1.5) + 0.3 * (1 - h / 3);
  if (h <= 0 && h > -3) return h - 0.3 * (1 + h / 3);
  return h;
}
function shapeShores(H: Float32Array): void {
  for (let i = 0; i < H.length; i++) H[i] = shapeShoreHeight(H[i]);
}

/** Meandering river polyline between two points via midpoint displacement + Chaikin smoothing. */
function makeRiver(rng: RNG, a: [number, number], b: [number, number], hwMeters: number, widen: number, valley: number): River {
  let pts: number[] = [a[0], a[1], b[0], b[1]];
  let amp = 0.3;
  for (let level = 0; level < 6; level++) {
    const next: number[] = [];
    for (let k = 0; k < pts.length - 2; k += 2) {
      const x0 = pts[k], z0 = pts[k + 1], x1 = pts[k + 2], z1 = pts[k + 3];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      const off = rng.range(-1, 1) * amp * len;
      next.push(x0, z0, (x0 + x1) / 2 - (dz / (len || 1)) * off, (z0 + z1) / 2 + (dx / (len || 1)) * off);
    }
    next.push(pts[pts.length - 2], pts[pts.length - 1]);
    pts = next;
    amp *= 0.6;
  }
  for (let it = 0; it < 2; it++) {
    const s: number[] = [pts[0], pts[1]];
    for (let k = 0; k < pts.length - 2; k += 2) {
      const x0 = pts[k], z0 = pts[k + 1], x1 = pts[k + 2], z1 = pts[k + 3];
      s.push(x0 * 0.75 + x1 * 0.25, z0 * 0.75 + z1 * 0.25, x0 * 0.25 + x1 * 0.75, z0 * 0.25 + z1 * 0.75);
    }
    s.push(pts[pts.length - 2], pts[pts.length - 1]);
    pts = s;
  }
  return { pts, hw0: hwMeters, hw1: hwMeters * widen, valley };
}

/** Carve a river channel (below sea level, widening downstream) with banks and a flat flood plain. */
function carveRiver(H: Float32Array, N: number, r: River, cellM: number, sizeM: number): void {
  const N1 = N + 1;
  const pts = r.pts;
  const nSeg = pts.length / 2 - 1;
  // cumulative length for the downstream parameter t
  const cum = new Float32Array(nSeg + 1);
  for (let k = 0; k < nSeg; k++) cum[k + 1] = cum[k] + Math.hypot(pts[2 * k + 2] - pts[2 * k], pts[2 * k + 3] - pts[2 * k + 1]);
  const total = cum[nSeg] || 1;
  const dist = new Float32Array(N1 * N1).fill(1e9);
  const tpar = new Float32Array(N1 * N1);
  const bankM = Math.max(24, cellM * 1.5);
  const maxR = r.hw1 + bankM + r.valley;
  const rad = Math.ceil(maxR / cellM) + 1;
  for (let k = 0; k < nSeg; k++) {
    const ax = pts[2 * k] * N, az = pts[2 * k + 1] * N, bx = pts[2 * k + 2] * N, bz = pts[2 * k + 3] * N;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx)) - rad), x1 = Math.min(N, Math.ceil(Math.max(ax, bx)) + rad);
    const z0 = Math.max(0, Math.floor(Math.min(az, bz)) - rad), z1 = Math.min(N, Math.ceil(Math.max(az, bz)) + rad);
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    const segLen = cum[k + 1] - cum[k];
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        let s = ((x - ax) * dx + (z - az) * dz) / l2;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
        const ex = ax + dx * s - x, ez = az + dz * s - z;
        const d = Math.sqrt(ex * ex + ez * ez) * cellM;
        const i = z * N1 + x;
        if (d < dist[i]) {
          dist[i] = d;
          tpar[i] = (cum[k] + segLen * s) / total;
        }
      }
    }
  }
  void sizeM;
  for (let i = 0; i < H.length; i++) {
    const d = dist[i];
    if (d > maxR) continue;
    const h = H[i];
    if (h < -0.5) continue; // already sea / lake: no channel through open water
    const t = tpar[i];
    const hw = lerp(r.hw0, r.hw1, Math.pow(t, 1.15));
    let nh: number;
    if (d < hw) {
      const q = d / hw;
      nh = -1.6 - (3 + 4 * t) * (1 - q * q);
    } else {
      const flood = 1.1 + Math.min(Math.max(h - 1.1, 0), 40) * 0.07;
      const sb = (d - hw) / bankM;
      if (sb < 1) nh = lerp(-1.6, flood, smoothstep(0, 1, sb));
      else {
        const k = smoothstep(0, 1, (d - hw - bankM) / r.valley);
        nh = lerp(flood, h, Math.pow(k, 0.85));
      }
    }
    if (nh < h) H[i] = nh;
  }
}

/** Organic lake basins with gently sloping shores. radius in normalized units. */
function carveLakes(H: Float32Array, N: number, rng: RNG, warpNoise: Noise2D, count: number, radius: number, sizeM: number): void {
  const N1 = N + 1;
  void sizeM;
  const lakes: [number, number, number, number][] = [];
  for (let k = 0; k < count; k++) {
    let cx = 0.5, cz = 0.5, r = radius;
    for (let tries = 0; tries < 12; tries++) {
      cx = rng.range(0.15, 0.85);
      cz = rng.range(0.15, 0.85);
      r = radius * rng.range(0.7, 1.35);
      if (lakes.every(([x, z, rr]) => Math.hypot(x - cx, z - cz) > (rr + r) * 1.25)) break;
    }
    lakes.push([cx, cz, r, rng.range(0, 100)]);
  }
  for (let z = 0; z <= N; z++) {
    for (let x = 0; x <= N; x++) {
      const u = x / N, v = z / N;
      const i = z * N1 + x;
      let h = H[i];
      for (const [cx, cz, r, o] of lakes) {
        const du = u - cx, dv = v - cz;
        const wobble = 1 + 0.32 * warpNoise.fbm(du / r * 0.55 + o, dv / r * 0.55 - o, 3);
        const dd = Math.sqrt(du * du + dv * dv) / (r * wobble);
        if (dd > 2.2) continue;
        // bowl: water inside dd < ~0.85, gentle shore band, blends into terrain by dd ~ 2
        const bed = dd < 1 ? -6.5 + 8.5 * dd * dd : 2 + (dd - 1) * 10;
        const k = smoothstep(0.9, 2.1, dd);
        const nh = lerp(bed, h, k);
        if (nh < h) h = nh;
      }
      H[i] = h;
    }
  }
}

/**
 * Sediment fill: repeated blur whose strength grows at low elevation (valley floors flatten and widen,
 * ridges keep their shape). Leaves underwater areas mostly alone.
 */
function sedimentFill(H: Float32Array, N: number, passes: number, strength: number, fadeHeight: number): void {
  const N1 = N + 1;
  const tmp = new Float32Array(H.length);
  for (let p = 0; p < passes; p++) {
    for (let z = 0; z <= N; z++) {
      const zm = z > 0 ? z - 1 : z, zp = z < N ? z + 1 : z;
      for (let x = 0; x <= N; x++) {
        const xm = x > 0 ? x - 1 : x, xp = x < N ? x + 1 : x;
        const i = z * N1 + x;
        const avg =
          (H[zm * N1 + x] + H[zp * N1 + x] + H[z * N1 + xm] + H[z * N1 + xp]) * 0.15 +
          (H[zm * N1 + xm] + H[zm * N1 + xp] + H[zp * N1 + xm] + H[zp * N1 + xp]) * 0.075 +
          H[i] * 0.1;
        const h = H[i];
        const k = strength * (1 - smoothstep(0, fadeHeight, h)) * (h < -1 ? 0.3 : 1);
        tmp[i] = h + (avg - h) * k;
      }
    }
    H.set(tmp);
  }
}

/** Thermal erosion: material slides down where the slope to a neighbour exceeds the talus threshold. */
function thermalErosion(H: Float32Array, N: number, iters: number, talus: number, rate: number): void {
  const N1 = N + 1;
  for (let it = 0; it < iters; it++) {
    for (let z = 1; z < N; z++) {
      for (let x = 1; x < N; x++) {
        const i = z * N1 + x;
        const h = H[i];
        let maxD = 0, j = -1;
        let d = h - H[i - 1]; if (d > maxD) { maxD = d; j = i - 1; }
        d = h - H[i + 1]; if (d > maxD) { maxD = d; j = i + 1; }
        d = h - H[i - N1]; if (d > maxD) { maxD = d; j = i - N1; }
        d = h - H[i + N1]; if (d > maxD) { maxD = d; j = i + N1; }
        if (j >= 0 && maxD > talus) {
          const m = (maxD - talus) * 0.5 * rate;
          H[i] -= m;
          H[j] += m;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------------------------------------------

/**
 * Tree densities 0..4 per cell. Respects config.treeDensity and climate:
 * temperate: mixed forests on hills + riparian strips; desert: sparse, mostly oases near water;
 * tropical: lush, also on beaches; alpine: dense conifers below the tree line.
 */
export function scatterTrees(state: CityState, opts: TerrainOptions = {}): void {
  const cfg = state.config;
  const N = state.size;
  const L = opts.logicalSize ?? N;
  const noise = new Noise2D((cfg.seed >>> 0) + 99);
  const seed = (cfg.seed >>> 0) + 101;
  const density = clamp(cfg.treeDensity, 0, 1);
  const climate = cfg.climate;
  const fsT = 2.8 * Math.sqrt(L / 256);
  const thr = lerp(0.74, 0.3, density);
  const nearWater = waterDistance(state, Math.max(2, Math.round((6 * N) / L)));
  const wScale = N / L; // corner-distance units -> logical cells
  const treeLine = climate === 'alpine' ? 150 : climate === 'desert' ? 200 : 175;
  const fsampler = opts.forestSampler;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      state.trees[i] = 0;
      if (state.water[i]) continue;
      const h = state.cellHeight(x, z);
      const u = (x + 0.5) / N, v = (z + 0.5) / N;
      const wd = nearWater[i] / wScale; // logical cells to water
      if (h < 1.0 && climate !== 'tropical') continue; // beach
      let f: number;
      if (fsampler) f = fsampler(u, v);
      else {
        const n = noise.fbm(u * fsT, v * fsT, 5) * 0.5 + 0.5;
        f = smoothstep(thr - 0.03, thr + 0.12, n);
      }
      // riparian strip
      if (wd > 0 && wd < 5) f = Math.max(f, (1 - wd / 5) * (0.35 + density * 0.5));
      const slope = state.cellSlope(x, z) * (L / N);
      let d = f * 4.3;
      switch (climate) {
        case 'desert':
          d = wd < 7 ? d * 0.8 * (1 - wd / 8) + (wd < 3 ? 1 : 0) : d * 0.1;
          break;
        case 'tropical':
          d *= 1.2;
          if (h < 1.5) d = Math.max(d * 0.6, hash2(x, z, seed) < 0.18 ? 1 : 0);
          break;
        case 'alpine':
          d *= h > 20 ? 1.15 : 0.85;
          break;
      }
      if (h > treeLine) d *= Math.max(0, 1 - (h - treeLine) / 50);
      if (slope > 10) d *= 0.65;
      // scattered solitary trees
      const r = hash2(x, z, seed);
      if (d < 1 && r < 0.025 * density * (climate === 'desert' ? 0.3 : 1)) d = 1;
      // break up the edges a little
      d += (hash2(z, x, seed + 7) - 0.5) * 0.9;
      state.trees[i] = Math.round(clamp(d, 0, 4));
    }
  }
}

/** Chamfer distance (in cells, capped) from each cell to the nearest water cell. 0 = water. */
function waterDistance(state: CityState, cap: number): Uint8Array {
  const N = state.size;
  const d = new Uint8Array(N * N);
  const INF = Math.min(255, cap + 1);
  for (let i = 0; i < d.length; i++) d[i] = state.water[i] ? 0 : INF;
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      let v = d[i];
      if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
      if (z > 0 && d[i - N] + 1 < v) v = d[i - N] + 1;
      d[i] = v;
    }
  for (let z = N - 1; z >= 0; z--)
    for (let x = N - 1; x >= 0; x--) {
      const i = z * N + x;
      let v = d[i];
      if (x < N - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1;
      if (z < N - 1 && d[i + N] + 1 < v) v = d[i + N] + 1;
      d[i] = v;
    }
  return d;
}

/** Create a fresh city state (terrain + trees) from a config. */
export function createCityState(cfg: CityConfigData, opts: TerrainOptions = {}): CityState {
  const st = new CityState(cfg);
  generateTerrain(st, opts);
  return st;
}

/** Quick terrain statistics (used by previews / tests): fractions of water and of flat buildable land. */
export function terrainStats(state: CityState, maxSlope = 2.5): { water: number; buildable: number; forest: number; maxHeight: number } {
  const N = state.size;
  let w = 0, b = 0, f = 0, mh = -1e9;
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (state.water[i]) { w++; continue; }
      if (state.cellSlope(x, z) <= maxSlope) b++;
      if (state.trees[i] > 0) f++;
      const h = state.cellHeight(x, z);
      if (h > mh) mh = h;
    }
  const C = N * N;
  return { water: w / C, buildable: b / C, forest: f / C, maxHeight: mh };
}
