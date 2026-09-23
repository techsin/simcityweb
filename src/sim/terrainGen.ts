/**
 * Terrain generation for a city from its config (presets) — headless-safe.
 * Produces corner heights (meters, sea level = 0), water mask and tree densities.
 * Region-derived terrain can instead pass an explicit height sampler (see generateTerrain opts.sampler).
 */
import { Noise2D, RNG, clamp, smoothstep } from '../core/rng';
import { CityState } from './CityState';
import type { CityConfigData } from './config';

export interface TerrainOptions {
  /** optional custom height sampler in normalized city coords u,v in [0,1] -> meters */
  sampler?: (u: number, v: number) => number;
}

export function generateTerrain(state: CityState, opts: TerrainOptions = {}): void {
  const cfg = state.config;
  const N = state.size;
  const N1 = N + 1;
  const noise = new Noise2D(cfg.seed);
  const noise2 = new Noise2D(cfg.seed + 17);
  const rng = new RNG(cfg.seed + 5);
  const hill = cfg.hilliness;
  const water = cfg.waterAmount;
  // scale: features relative to a 256-cell (4 km) reference so small maps look like crops of big terrain
  const scale = N / 256;
  const H = state.heights;

  // river params
  const riverAngle = rng.range(0, Math.PI);
  const riverOffset = rng.range(-0.15, 0.15);
  const coastSide = rng.int(0, 3);

  for (let z = 0; z <= N; z++) {
    for (let x = 0; x <= N; x++) {
      const u = x / N, v = z / N;
      let h: number;
      if (opts.sampler) {
        h = opts.sampler(u, v);
      } else {
        const nx = u * 3.2 * scale, nz = v * 3.2 * scale;
        const base = noise.fbm(nx, nz, 5) * 0.5 + 0.5; // 0..1
        const ridge = noise2.ridged(nx * 0.8 + 11, nz * 0.8 - 7, 5);
        const detail = noise2.fbm(nx * 4, nz * 4, 3) * 0.5;
        switch (cfg.terrain) {
          case 'flat':
            h = 4 + detail * 1.5;
            break;
          case 'plains':
            h = 3 + base * 18 * (0.4 + hill) + detail * 2;
            break;
          case 'hills':
            h = 2 + base * 55 * (0.3 + hill) + detail * 3;
            break;
          case 'mountains':
            h = 5 + base * 40 * (0.4 + hill) + ridge * ridge * 180 * (0.3 + hill) + detail * 4;
            break;
          case 'river': {
            h = 6 + base * 35 * (0.3 + hill) + detail * 2;
            // meandering river through the middle
            const cx = u - 0.5, cz = v - 0.5;
            const along = cx * Math.cos(riverAngle) + cz * Math.sin(riverAngle);
            const across = -cx * Math.sin(riverAngle) + cz * Math.cos(riverAngle) - riverOffset;
            const meander = noise.noise(along * 3 + 3, 1.7) * 0.08;
            const d = Math.abs(across - meander);
            const width = 0.03 + water * 0.05;
            const bank = smoothstep(width, width + 0.08, d);
            h = h * bank + (-6) * (1 - bank);
            break;
          }
          case 'coast': {
            h = 3 + base * 40 * (0.3 + hill) + detail * 2;
            const t = [u, v, 1 - u, 1 - v][coastSide];
            const warp = noise.noise(u * 4 + 9, v * 4 - 3) * 0.08;
            const coast = smoothstep(0.1 + water * 0.35 + warp, 0.3 + water * 0.35 + warp, t);
            h = h * coast - 18 * (1 - coast);
            break;
          }
          case 'islands': {
            const cx = u - 0.5, cz = v - 0.5;
            const r = Math.sqrt(cx * cx + cz * cz);
            const land = base * 1.2 - r * (0.9 + water) + 0.25;
            h = land * 70 * (0.5 + hill) + detail * 2;
            if (h < 0) h = h * 0.6 - 3;
            break;
          }
          case 'lakes': {
            h = 5 + base * 30 * (0.3 + hill) + detail * 2;
            const lake = noise2.noise(u * 2.5 * scale + 40, v * 2.5 * scale + 40);
            if (lake > 0.45 - water * 0.4) h -= (lake - (0.45 - water * 0.4)) * 60;
            break;
          }
          default:
            h = 2 + base * 45 * (0.3 + hill) + detail * 3;
        }
        // generic sea-level offset from water amount for non-special presets
        if (cfg.terrain === 'hills' || cfg.terrain === 'plains' || cfg.terrain === 'mountains') {
          h -= water * 22 * (cfg.terrain === 'plains' ? 0.5 : 1);
        }
      }
      H[z * N1 + x] = h;
    }
  }

  // shape beaches: flatten gently near sea level
  for (let i = 0; i < H.length; i++) {
    const h = H[i];
    if (h > -1.5 && h < 2.5) H[i] = h > 0 ? 0.6 + (h - 0) * 0.55 : h * 0.9 - 0.4;
  }
  computeWater(state);
  scatterTrees(state);
}

/** a cell is water if its average corner height is below sea level */
export function computeWater(state: CityState, x0 = 0, z0 = 0, x1 = state.size, z1 = state.size): void {
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) state.water[z * state.size + x] = state.cellHeight(x, z) < 0 ? 1 : 0;
}

export function scatterTrees(state: CityState): void {
  const cfg = state.config;
  const N = state.size;
  const noise = new Noise2D(cfg.seed + 99);
  const rng = new RNG(cfg.seed + 101);
  const density = cfg.treeDensity;
  const climateFactor = cfg.climate === 'desert' ? 0.25 : cfg.climate === 'tropical' ? 1.1 : 1;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (state.water[i]) continue;
      const h = state.cellHeight(x, z);
      if (h < 1.2) continue; // beach
      const n = noise.fbm((x / 256) * 6, (z / 256) * 6, 4) * 0.5 + 0.5;
      const t = n * 1.3 - (1 - density) * 0.95;
      const slope = state.cellSlope(x, z);
      let d = clamp(t * 4.5, 0, 4) * climateFactor;
      if (h > 170) d *= 0.4;
      if (slope > 12) d *= 0.6;
      if (rng.chance(0.02 * density)) d = Math.max(d, 1);
      state.trees[i] = Math.round(clamp(d, 0, 4));
    }
  }
}

/** Create a fresh city state (terrain + trees) from a config. */
export function createCityState(cfg: CityConfigData, opts: TerrainOptions = {}): CityState {
  const st = new CityState(cfg);
  generateTerrain(st, opts);
  return st;
}
