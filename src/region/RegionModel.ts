/**
 * RegionModel — seeded region generation (headless-safe: no DOM / three.js).
 *
 *  - Tile layout: REGION_W x REGION_H units packed with large (4x4), medium (2x2) and small (1x1) city tiles,
 *    deterministic from the seed (quadtree split, large tiles favoured on land).
 *  - Region-wide heightmap (REGION_RES^2 samples, 32 m apart) shaped per preset: continents / coasts, rivers that
 *    widen towards the sea, mountains, lakes, mesas; then erosion-like smoothing.
 *  - Every city's terrain is sampled from ONE global height function (bilinear grid + deterministic detail noise +
 *    shore shaping, all functions of global position) so neighbouring cities match exactly at their shared edges.
 */
import { Noise2D, RNG, clamp, hash2, lerp, smoothstep } from '../core/rng';
import { CELL_SIZE, REGION_H, REGION_UNIT_CELLS, REGION_W } from '../core/constants';
import type { Climate } from '../core/types';
import { defaultCityConfig, type CityConfigData } from '../sim/config';
import { shapeShoreHeight } from '../sim/terrainGen';
import type { RegionData, RegionPresetId, RegionTile, TileSize } from './types';
import { randomRegionName } from './names';

export const REGION_FORMAT_VERSION = 1;
/** bump when the terrain generator changes in a way that alters existing regions */
export const REGION_GEN_VERSION = 1;
/** samples per region unit edge (unit = 64 cells = 1024 m) -> 32 m spacing */
export const REGION_SAMPLES_PER_UNIT = 32;
export const REGION_SIZE_X_M = REGION_W * REGION_UNIT_CELLS * CELL_SIZE;
export const REGION_SIZE_Z_M = REGION_H * REGION_UNIT_CELLS * CELL_SIZE;
export const UNIT_M = REGION_UNIT_CELLS * CELL_SIZE;

export interface RegionPresetInfo {
  id: RegionPresetId;
  name: string;
  blurb: string;
  climate: Climate;
}

export const REGION_PRESETS: RegionPresetInfo[] = [
  { id: 'greenvale', name: 'Greenvale Valley', blurb: 'Rolling green hills cut by a winding river that meets the sea.', climate: 'temperate' },
  { id: 'azure-coast', name: 'Azure Coast', blurb: 'A long sheltered coastline of bays, headlands and islands.', climate: 'temperate' },
  { id: 'twin-rivers', name: 'Twin Rivers', blurb: 'Fertile lowlands where two great rivers merge into an estuary.', climate: 'temperate' },
  { id: 'highlands', name: 'Highlands', blurb: 'Dramatic peaks, ribbon lakes and deep glacial valleys.', climate: 'alpine' },
  { id: 'archipelago', name: 'Archipelago', blurb: 'A turquoise sea scattered with islands large and small.', climate: 'tropical' },
  { id: 'desert-basin', name: 'Desert Basin', blurb: 'Sun-baked mesas around a river oasis and a salt lake.', climate: 'desert' },
  { id: 'random', name: 'Random', blurb: 'Roll the dice: any landscape, any climate.', climate: 'temperate' },
];
export const PRESET_BY_ID: Record<RegionPresetId, RegionPresetInfo> = Object.fromEntries(REGION_PRESETS.map((p) => [p.id, p])) as Record<RegionPresetId, RegionPresetInfo>;

export interface RegionTerrain {
  /** samples along x / z */
  resX: number;
  resZ: number;
  /** meters between samples */
  spacing: number;
  /** raw (pre shore-shaping) heights, meters, row-major z*resX+x */
  heights: Float32Array;
  /** forest density 0..1 per sample */
  forest: Float32Array;
  /** effective preset (random resolved) */
  preset: Exclude<RegionPresetId, 'random'>;
  climate: Climate;
}

export interface RegionTerrainOptions {
  /** samples per region unit (default 32 = full res). Lower for quick previews (e.g. 8). */
  samplesPerUnit?: number;
  /** sink the region borders below the sea (menu background: an island in an endless ocean) */
  islandFalloff?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Region data creation
// ---------------------------------------------------------------------------------------------------------------

export function newRegionId(): string {
  return 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

/** Effective preset + climate for a (seed, preset) pair ('random' resolves deterministically). */
export function resolvePreset(seed: number, preset: RegionPresetId): { preset: Exclude<RegionPresetId, 'random'>; climate: Climate } {
  if (preset !== 'random') return { preset, climate: PRESET_BY_ID[preset].climate };
  const rng = new RNG((seed ^ 0x5bd1e995) >>> 0);
  const p = rng.pick(['greenvale', 'azure-coast', 'twin-rivers', 'highlands', 'archipelago', 'desert-basin'] as const);
  const climate = rng.chance(0.6) ? PRESET_BY_ID[p].climate : rng.pick(['temperate', 'desert', 'tropical', 'alpine'] as const);
  return { preset: p, climate };
}

export function createRegionData(
  opts: { seed?: number; preset?: RegionPresetId; name?: string; climate?: Climate; id?: string; terrain?: RegionTerrain } = {},
): { data: RegionData; model: RegionModel } {
  const seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const preset = opts.preset ?? 'greenvale';
  const resolved = resolvePreset(seed, preset);
  const climate = opts.climate ?? resolved.climate;
  const terrain = opts.terrain ?? generateRegionTerrain(seed, preset, {}, climate);
  const rng = new RNG(seed + 77);
  const now = Date.now();
  const data: RegionData = {
    format: 'metropolis-region',
    version: REGION_FORMAT_VERSION,
    genVersion: REGION_GEN_VERSION,
    id: opts.id ?? newRegionId(),
    name: opts.name ?? (preset === 'random' ? randomRegionName(rng) : PRESET_BY_ID[preset].name),
    seed,
    preset,
    climate,
    tiles: layoutTiles(seed, terrain),
    totals: { population: 0, cities: 0, r: 0, c: 0, i: 0 },
    created: now,
    lastPlayed: now,
  };
  return { data, model: new RegionModel(data, terrain) };
}

/** Deterministic SC4-like tile packing: quadtree over 4x4 blocks, large tiles favoured on land-rich blocks. */
export function layoutTiles(seed: number, terrain?: RegionTerrain): RegionTile[] {
  const rng = new RNG((seed ^ 0x2545f491) >>> 0);
  const tiles: RegionTile[] = [];
  const land = (ux: number, uz: number, size: number): number => {
    if (!terrain) return 0.7;
    const spu = (terrain.resX - 1) / REGION_W;
    let n = 0, l = 0;
    for (let z = uz * spu; z <= (uz + size) * spu; z += 2)
      for (let x = ux * spu; x <= (ux + size) * spu; x += 2) {
        n++;
        if (terrain.heights[Math.min(terrain.resZ - 1, z) * terrain.resX + Math.min(terrain.resX - 1, x)] > 0.5) l++;
      }
    return n ? l / n : 0;
  };
  const add = (x: number, z: number, size: TileSize) => tiles.push({ key: `${x}_${z}`, x, z, size });
  // choose large tiles: the most land-rich 4x4 blocks (with some randomness), 3..6 of them
  const blocks: { bx: number; bz: number; score: number }[] = [];
  for (let bz = 0; bz + 4 <= REGION_H; bz += 4) for (let bx = 0; bx + 4 <= REGION_W; bx += 4) blocks.push({ bx, bz, score: land(bx, bz, 4) + rng.next() * 0.55 });
  blocks.sort((a, b) => b.score - a.score);
  const nLarge = Math.min(blocks.length, rng.int(3, 6));
  const large = new Set(blocks.slice(0, nLarge).filter((b) => b.score > 0.35).map((b) => b.bx + ',' + b.bz));
  for (let bz = 0; bz < REGION_H; bz += 4) {
    for (let bx = 0; bx < REGION_W; bx += 4) {
      if (large.has(bx + ',' + bz)) {
        add(bx, bz, 4);
        continue;
      }
      for (let mz = bz; mz < Math.min(bz + 4, REGION_H); mz += 2) {
        for (let mx = bx; mx < Math.min(bx + 4, REGION_W); mx += 2) {
          const fits = mx + 2 <= REGION_W && mz + 2 <= REGION_H;
          const ml = land(mx, mz, 2);
          if (fits && rng.chance(ml < 0.1 ? 0.4 : 0.66)) add(mx, mz, 2);
          else
            for (let sz = mz; sz < Math.min(mz + 2, REGION_H); sz++)
              for (let sx = mx; sx < Math.min(mx + 2, REGION_W); sx++) add(sx, sz, 1);
        }
      }
    }
  }
  return tiles;
}

// ---------------------------------------------------------------------------------------------------------------
// RegionModel
// ---------------------------------------------------------------------------------------------------------------

export class RegionModel {
  readonly data: RegionData;
  readonly terrain: RegionTerrain;
  private detail: Noise2D;
  private tileIndex: Int16Array;

  constructor(data: RegionData, terrain?: RegionTerrain) {
    this.data = data;
    this.terrain = terrain ?? generateRegionTerrain(data.seed, data.preset, {}, data.climate);
    this.detail = new Noise2D((data.seed + 4242) >>> 0);
    this.tileIndex = new Int16Array(REGION_W * REGION_H).fill(-1);
    this.reindex();
  }

  reindex(): void {
    this.tileIndex.fill(-1);
    this.data.tiles.forEach((t, k) => {
      for (let z = t.z; z < t.z + t.size; z++) for (let x = t.x; x < t.x + t.size; x++) if (x < REGION_W && z < REGION_H) this.tileIndex[z * REGION_W + x] = k;
    });
  }

  get sizeX(): number {
    return REGION_SIZE_X_M;
  }
  get sizeZ(): number {
    return REGION_SIZE_Z_M;
  }

  /** bilinear raw grid height at region meters (no detail, no shore shaping) */
  gridHeight(x: number, z: number): number {
    return sampleGrid(this.terrain.heights, this.terrain, x, z);
  }

  /** forest density 0..1 at region meters */
  forestAt(x: number, z: number): number {
    return sampleGrid(this.terrain.forest, this.terrain, x, z);
  }

  /**
   * THE global terrain height function (meters) at region position (meters). City terrains are sampled from it,
   * so it must depend on global position only.
   */
  heightAt(x: number, z: number): number {
    const g = this.gridHeight(x, z);
    // city-scale detail: stronger in rough / high terrain, none close to the shoreline (no stray puddles)
    const amp = (1.3 + 0.022 * Math.max(g, 0)) * smoothstep(2, 9, g);
    let h = g;
    if (amp > 0) h += this.detail.fbm(x / 420, z / 420, 3) * amp;
    return shapeShoreHeight(h);
  }

  /** height sampler for a tile's city terrain: (u,v) in [0,1] over the tile -> meters */
  samplerForTile(tile: RegionTile): (u: number, v: number) => number {
    const x0 = tile.x * UNIT_M, z0 = tile.z * UNIT_M, s = tile.size * UNIT_M;
    return (u, v) => this.heightAt(x0 + u * s, z0 + v * s);
  }

  forestSamplerForTile(tile: RegionTile): (u: number, v: number) => number {
    const x0 = tile.x * UNIT_M, z0 = tile.z * UNIT_M, s = tile.size * UNIT_M;
    return (u, v) => this.forestAt(x0 + u * s, z0 + v * s);
  }

  tileAtUnit(ux: number, uz: number): RegionTile | undefined {
    if (ux < 0 || uz < 0 || ux >= REGION_W || uz >= REGION_H) return undefined;
    const k = this.tileIndex[Math.floor(uz) * REGION_W + Math.floor(ux)];
    return k >= 0 ? this.data.tiles[k] : undefined;
  }

  tileIndexOf(tile: RegionTile): number {
    return this.data.tiles.indexOf(tile);
  }

  tileByKey(key: string): RegionTile | undefined {
    return this.data.tiles.find((t) => t.key === key);
  }

  /** deterministic per-tile city seed */
  citySeed(tile: RegionTile): number {
    return Math.floor(hash2(tile.x * 131 + 7, tile.z * 197 + 3, this.data.seed) * 2 ** 31);
  }

  /** fraction of water in a tile (from the grid) */
  tileWaterFraction(tile: RegionTile): number {
    let n = 0, w = 0;
    const s = tile.size * UNIT_M;
    for (let k = 0; k < 16; k++)
      for (let j = 0; j < 16; j++) {
        n++;
        if (this.heightAt(tile.x * UNIT_M + ((j + 0.5) / 16) * s, tile.z * UNIT_M + ((k + 0.5) / 16) * s) < 0) w++;
      }
    return w / n;
  }

  /** default city config for founding a city on this tile (region terrain) */
  cityConfigFor(tile: RegionTile, partial: Partial<CityConfigData> = {}): CityConfigData {
    return defaultCityConfig({
      size: tile.size * REGION_UNIT_CELLS,
      seed: this.citySeed(tile),
      climate: this.data.climate,
      terrain: 'region',
      waterAmount: 0.3,
      hilliness: 0.4,
      treeDensity: 0.5,
      regionId: this.data.id,
      tileX: tile.x,
      tileZ: tile.z,
      ...partial,
    });
  }

  recomputeTotals(): void {
    const t = { population: 0, cities: 0, r: 0, c: 0, i: 0 };
    for (const tile of this.data.tiles) {
      if (!tile.city) continue;
      t.cities++;
      t.population += tile.city.population;
      t.r += tile.city.r;
      t.c += tile.city.c;
      t.i += tile.city.i;
    }
    this.data.totals = t;
  }
}

function sampleGrid(arr: Float32Array, t: RegionTerrain, x: number, z: number): number {
  const fx = clamp(x / t.spacing, 0, t.resX - 1.0001);
  const fz = clamp(z / t.spacing, 0, t.resZ - 1.0001);
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const i = iz * t.resX + ix;
  const a = arr[i], b = arr[i + 1], c = arr[i + t.resX], d = arr[i + t.resX + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

// ---------------------------------------------------------------------------------------------------------------
// Terrain generation
// ---------------------------------------------------------------------------------------------------------------

interface RiverPath {
  /** polyline in normalized region coords (u,v), flowing from pts[0] (source) to the end (mouth) */
  pts: number[];
  /** half widths (m) at source / mouth */
  hw0: number;
  hw1: number;
  /** valley half width (m) */
  valley: number;
}

/**
 * Generate the region heightmap + forest field. Resolution-independent: `samplesPerUnit` only changes sampling
 * density (previews), shapes stay the same.
 */
export function generateRegionTerrain(seed: number, presetId: RegionPresetId, opts: RegionTerrainOptions = {}, climateOverride?: Climate): RegionTerrain {
  const { preset, climate: presetClimate } = resolvePreset(seed, presetId);
  const climate = climateOverride ?? presetClimate;
  const spu = opts.samplesPerUnit ?? REGION_SAMPLES_PER_UNIT;
  const resX = REGION_W * spu + 1, resZ = REGION_H * spu + 1;
  const spacing = UNIT_M / spu;
  const H = new Float32Array(resX * resZ);
  const F = new Float32Array(resX * resZ);
  const rng = new RNG((seed * 2654435761) >>> 0 || 3);
  const nC = new Noise2D(seed + 1);
  const nH = new Noise2D(seed + 2);
  const nR = new Noise2D(seed + 3);
  const nW = new Noise2D(seed + 4);
  const nF = new Noise2D(seed + 5);
  const nM = new Noise2D(seed + 6);
  const aspect = REGION_H / REGION_W;

  // random orientation so presets don't always face the same way
  const flipU = rng.chance(0.5), flipV = rng.chance(0.5), swap = rng.chance(0.5);
  const orient = (u: number, v: number): [number, number] => {
    let a = flipU ? 1 - u : u, b = flipV ? 1 - v : v;
    if (swap) [a, b] = [b, a];
    return [a, b];
  };
  /** inverse of orient for placing polyline points designed in canonical space */
  const unorient = (a: number, b: number): [number, number] => {
    if (swap) [a, b] = [b, a];
    return [flipU ? 1 - a : a, flipV ? 1 - b : b];
  };

  const rivers: RiverPath[] = [];
  const lakes: { u: number; v: number; r: number; depth: number }[] = [];
  const islands: { u: number; v: number; r: number; h: number }[] = [];

  // ---- preset feature planning (canonical space: sea / outflow tends to be at +u / +v) -----------------------
  switch (preset) {
    case 'greenvale': {
      const src: [number, number] = [rng.range(0.05, 0.35), -0.02];
      const mouth: [number, number] = [0.88, 0.88];
      rivers.push(makePath(rng, unorient(...src), unorient(...mouth), 40, 105, 900, 0.26));
      rivers.push(makePath(rng, unorient(-0.02, rng.range(0.35, 0.7)), pointAlong(rivers[0].pts, rng.range(0.45, 0.62)), 22, 40, 600, 0.3));
      if (rng.chance(0.7)) rivers.push(makePath(rng, unorient(rng.range(0.55, 0.85), -0.02), pointAlong(rivers[0].pts, rng.range(0.3, 0.45)), 18, 32, 500, 0.3));
      for (let k = rng.int(1, 2); k > 0; k--) lakes.push({ ...pick2(rng, unorient, 0.2, 0.7), r: rng.range(0.025, 0.045), depth: 7 });
      break;
    }
    case 'azure-coast': {
      // sea on +u side; river from the inland edge into a bay
      const mouthV = rng.range(0.3, 0.7);
      rivers.push(makePath(rng, unorient(-0.02, rng.range(0.2, 0.8)), unorient(0.72, mouthV), 30, 85, 700, 0.24));
      for (let k = rng.int(3, 6); k > 0; k--) islands.push({ ...pick2(rng, unorient, 0.78, 0.97, 0.05, 0.95), r: rng.range(0.018, 0.05), h: rng.range(15, 60) });
      break;
    }
    case 'twin-rivers': {
      const conf: [number, number] = [rng.range(0.42, 0.58), rng.range(0.5, 0.62)];
      const main = makePath(rng, unorient(...conf), unorient(rng.range(0.4, 0.6), 1.02), 110, 170, 1000, 0.18);
      const a = makePath(rng, unorient(rng.range(0.1, 0.4), -0.02), unorient(...conf), 55, 110, 900, 0.22);
      const b = makePath(rng, unorient(1.02, rng.range(0.1, 0.4)), unorient(...conf), 50, 105, 900, 0.22);
      rivers.push(main, a, b);
      if (rng.chance(0.6)) lakes.push({ ...pick2(rng, unorient, 0.15, 0.35, 0.55, 0.85), r: rng.range(0.03, 0.05), depth: 6 });
      break;
    }
    case 'highlands': {
      // one long glacial valley with ribbon lakes, a side valley
      const valley = makePath(rng, unorient(-0.02, rng.range(0.2, 0.45)), unorient(1.02, rng.range(0.55, 0.8)), 35, 80, 1500, 0.2);
      rivers.push(valley);
      rivers.push(makePath(rng, unorient(rng.range(0.25, 0.75), 1.02), pointAlong(valley.pts, rng.range(0.4, 0.7)), 22, 40, 1000, 0.25));
      for (let k = 0; k < 3; k++) {
        const t = 0.2 + k * 0.28 + rng.range(-0.05, 0.05);
        const [u, v] = pointAlong(valley.pts, t);
        lakes.push({ u, v, r: rng.range(0.03, 0.05), depth: 9 });
      }
      break;
    }
    case 'archipelago': {
      islands.push({ u: rng.range(0.35, 0.65), v: rng.range(0.35, 0.65), r: rng.range(0.2, 0.25), h: rng.range(90, 150) });
      for (let tries = 0; tries < 400 && islands.length < 16; tries++) {
        const r = islands.length < 5 ? rng.range(0.08, 0.13) : rng.range(0.025, 0.07);
        const u = rng.range(0.06, 0.94), v = rng.range(0.06, 0.94);
        if (islands.every((o) => Math.hypot(o.u - u, o.v - v) > (o.r + r) * 1.05)) islands.push({ u, v, r, h: rng.range(20, 90) * (r / 0.1 + 0.4) });
      }
      break;
    }
    case 'desert-basin': {
      const lake = { u: rng.range(0.55, 0.7), v: rng.range(0.55, 0.7), r: rng.range(0.06, 0.08), depth: 5 };
      const [lu, lv] = unorient(lake.u, lake.v);
      lakes.push({ u: lu, v: lv, r: lake.r, depth: lake.depth });
      rivers.push(makePath(rng, unorient(-0.02, rng.range(0.15, 0.5)), [lu, lv], 45, 90, 700, 0.24));
      break;
    }
  }

  // ---- base height field ----------------------------------------------------------------------------------------
  for (let z = 0; z < resZ; z++) {
    const v0 = z / (resZ - 1);
    for (let x = 0; x < resX; x++) {
      const u0 = x / (resX - 1);
      const i = z * resX + x;
      const [u, v] = orient(u0, v0);
      // world-ish noise coords (region units), same for any orientation
      const px = u0 * REGION_W, pz = v0 * REGION_W * aspect;
      const wx = nW.noise(px * 0.09 + 3.1, pz * 0.09 - 1.7);
      const wz = nW.noise(px * 0.09 - 7.3, pz * 0.09 + 5.2);
      // hills fbm: warped low octaves + unwarped high octaves (no streaks)
      const hp = px * 0.6, hq = pz * 0.6;
      const hpw = hp + wx * 0.7, hqw = hq + wz * 0.7;
      const hills =
        (nH.noise(hpw, hqw) + 0.5 * nH.noise(hpw * 2 + 5.2, hqw * 2 - 1.3) + 0.25 * nH.noise(hp * 4 - 3.7, hq * 4 + 8.1) + 0.125 * nH.noise(hp * 8 + 1.1, hq * 8 + 4.4) + 0.0625 * nH.noise(hp * 16, hq * 16)) / 1.9375;
      const hills01 = hills * 0.5 + 0.5;
      const coastWarp = nC.fbm(px * 0.16 + 11, pz * 0.16 - 4, 5) * 0.09 + nC.noise(px * 0.6, pz * 0.6) * 0.012;
      let h = 0;
      switch (preset) {
        case 'greenvale': {
          // land everywhere with a sea in the +u+v corner, a hill range on the far side from the sea
          const sea = (u + v) * 0.5 - 0.8 - coastWarp * 1.6;
          const range = smoothstep(0.35, 0.05, Math.min(u, v) + coastWarp);
          const ridge = nR.ridged(px * 0.28 + wx * 0.1, pz * 0.28 + wz * 0.1, 5);
          const land = 10 + Math.pow(hills01, 1.35) * 78 + ridge * ridge * 150 * range + (1 - (u + v) * 0.5) * 25;
          h = lerp(land, -4 - 30 * smoothstep(0, 0.12, sea), smoothstep(-0.04, 0.02, sea));
          break;
        }
        case 'azure-coast': {
          const sd = 0.62 - u + coastWarp * 1.8; // > 0 land
          const inland = smoothstep(0, 0.6, sd);
          const ridge = nR.ridged(px * 0.3 + wx * 0.1, pz * 0.3 + wz * 0.1, 5);
          const land = 3 + Math.pow(hills01, 1.25) * 55 + inland * 70 + ridge * ridge * 90 * smoothstep(0.35, 0.7, sd);
          const sea = -3 - 40 * smoothstep(0, 0.25, -sd);
          h = lerp(sea, land, smoothstep(-0.012, 0.045, sd));
          break;
        }
        case 'twin-rivers': {
          const sd = 0.93 - v + coastWarp * 1.2; // estuary sea at +v
          const land = 5 + Math.pow(hills01, 1.6) * 42 + (1 - v) * 22 + smoothstep(0.35, 0.0, Math.min(u, 1 - u)) * 20 * hills01;
          const sea = -3 - 25 * smoothstep(0, 0.1, -sd);
          h = lerp(sea, land, smoothstep(-0.01, 0.04, sd));
          break;
        }
        case 'highlands': {
          const ridge = nR.ridged(px * 0.3 + wx * 0.12, pz * 0.3 + wz * 0.12, 6);
          const mass = smoothstep(0.2, 0.75, nM.fbm(px * 0.12 + 3, pz * 0.12 - 9, 3) * 0.5 + 0.5);
          h = 30 + hills01 * 60 + ridge * ridge * (90 + 170 * mass);
          break;
        }
        case 'archipelago': {
          h = -34 + hills * 6;
          break;
        }
        case 'desert-basin': {
          // basin floor rising to rims at the edges, mesas on the slopes
          const du = u - 0.55, dv = v - 0.58;
          const rad = Math.sqrt(du * du + dv * dv) + coastWarp * 0.8;
          const rim = smoothstep(0.3, 0.72, rad);
          const ridge = nR.ridged(px * 0.25 + wx * 0.1, pz * 0.25 + wz * 0.1, 5);
          let base = 8 + Math.pow(hills01, 1.5) * 35 + rim * (70 + ridge * ridge * 120);
          // mesas: flat-topped buttes with steep cliffs
          const m = nM.fbm(px * 0.4 + 7, pz * 0.4 + 2, 4) * 0.5 + 0.5;
          const mesa = smoothstep(0.57, 0.6, m) * (0.55 + rim);
          base += mesa * (45 + 35 * smoothstep(0.6, 0.75, m));
          // dunes
          base += Math.abs(nR.noise(px * 2.2 + wx, pz * 0.9)) * 4 * (1 - rim);
          h = base;
          break;
        }
      }
      // islands (archipelago, coast)
      for (const is of islands) {
        const d0 = Math.hypot(u0 - is.u, (v0 - is.v) * aspect) / is.r;
        if (d0 > 2.5) continue;
        const ws = 1 / (is.r * 4);
        const iwx = nC.noise(u0 * ws + is.u * 13, v0 * ws - 5), iwz = nC.noise(u0 * ws - 9, v0 * ws + is.v * 17);
        const du = u0 - is.u + iwx * is.r * 0.45, dv = v0 - is.v + iwz * is.r * 0.45;
        const d = Math.sqrt(du * du + dv * dv * aspect * aspect) / is.r + nC.fbm(u0 * ws * 2.5 + 3, v0 * ws * 2.5 - 3, 4) * 0.42 + coastWarp * 1.5 + (hills - 0.2) * 0.2;
        if (d < 1.6) {
          const shape = 1 - d;
          const ih = shape > 0 ? 2 + Math.pow(shape, 0.9) * is.h * (0.55 + hills01 * 0.7) : -3 + shape * 45;
          if (ih > h) h = lerp(h, ih, smoothstep(1.6, 0.9, d));
        }
      }
      if (opts.islandFalloff) {
        const e = Math.max(Math.abs(u0 - 0.5), Math.abs(v0 - 0.5));
        h = lerp(h, -30, smoothstep(0.33, 0.49, e + coastWarp * 0.5));
      }
      H[i] = h;
    }
  }

  // ---- post: smoothing, lakes, rivers ---------------------------------------------------------------------
  const res = spu / REGION_SAMPLES_PER_UNIT;
  sediment(H, resX, resZ, Math.max(1, Math.round(2 * res * res)), preset === 'highlands' ? 0.3 : 0.5, preset === 'highlands' ? 90 : 55);
  thermal(H, resX, resZ, Math.max(1, Math.round(4 * res)), 0.75 * spacing, 0.4);
  for (const l of lakes) carveLake(H, resX, resZ, l, nW, aspect);
  for (const r of rivers) carvePath(H, resX, resZ, r, spacing);
  if (preset === 'desert-basin') {
    // terraces / cliffs on high ground
    const step = 22;
    for (let i = 0; i < H.length; i++) {
      const h = H[i];
      if (h < 45) continue;
      const f = h / step, fl = Math.floor(f);
      H[i] = lerp(h, (fl + smoothstep(0.55, 0.9, f - fl)) * step, (preset === 'desert-basin' ? 0.6 : 0.35) * smoothstep(45, 80, h));
    }
  }
  for (let i = 0; i < H.length; i++) if (H[i] > 262) H[i] = 262 - (H[i] - 262) * 0.2;

  // ---- forests ----------------------------------------------------------------------------------------------
  const treeLine = climate === 'alpine' ? 165 : 190;
  const base = climate === 'desert' ? 0.08 : climate === 'tropical' ? 0.62 : climate === 'alpine' ? 0.5 : 0.5;
  for (let z = 0; z < resZ; z++) {
    for (let x = 0; x < resX; x++) {
      const i = z * resX + x;
      const h = H[i];
      if (h < 1.2) { F[i] = 0; continue; }
      const px = (x / (resX - 1)) * REGION_W, pz = (z / (resZ - 1)) * REGION_W * aspect;
      const n = nF.fbm(px * 0.55, pz * 0.55, 5) * 0.5 + 0.5;
      const hx = H[z * resX + Math.min(resX - 1, x + 1)] - H[z * resX + Math.max(0, x - 1)];
      const hz = H[Math.min(resZ - 1, z + 1) * resX + x] - H[Math.max(0, z - 1) * resX + x];
      const slope = Math.sqrt(hx * hx + hz * hz) / (2 * spacing);
      let f = smoothstep(0.78 - base * 0.6, 0.9 - base * 0.5, n + slope * 0.6);
      f *= 1 - smoothstep(treeLine - 20, treeLine + 30, h);
      if (slope > 0.9) f *= 0.4;
      F[i] = clamp(f, 0, 1);
    }
  }

  return { resX, resZ, spacing, heights: H, forest: F, preset, climate };
}

function pick2(rng: RNG, unorient: (a: number, b: number) => [number, number], a0: number, a1: number, b0 = a0, b1 = a1): { u: number; v: number } {
  const [u, v] = unorient(rng.range(a0, a1), rng.range(b0, b1));
  return { u, v };
}

/** meandering path (midpoint displacement + Chaikin), normalized coords */
function makePath(rng: RNG, a: [number, number], b: [number, number], hw0: number, hw1: number, valley: number, meander: number): RiverPath {
  let pts: number[] = [a[0], a[1], b[0], b[1]];
  let amp = meander;
  for (let level = 0; level < 7; level++) {
    const next: number[] = [];
    for (let k = 0; k < pts.length - 2; k += 2) {
      const x0 = pts[k], z0 = pts[k + 1], x1 = pts[k + 2], z1 = pts[k + 3];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz) || 1e-6;
      const off = rng.range(-1, 1) * amp * len;
      next.push(x0, z0, (x0 + x1) / 2 - (dz / len) * off, (z0 + z1) / 2 + (dx / len) * off);
    }
    next.push(pts[pts.length - 2], pts[pts.length - 1]);
    pts = next;
    amp *= level < 2 ? 0.75 : 0.58;
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
  return { pts, hw0, hw1, valley };
}

function pointAlong(pts: number[], t: number): [number, number] {
  const n = pts.length / 2 - 1;
  const f = clamp(t, 0, 1) * n;
  const k = Math.min(n - 1, Math.floor(f));
  const s = f - k;
  return [lerp(pts[2 * k], pts[2 * k + 2], s), lerp(pts[2 * k + 1], pts[2 * k + 3], s)];
}

function carvePath(H: Float32Array, resX: number, resZ: number, r: RiverPath, spacing: number): void {
  const pts = r.pts;
  const nSeg = pts.length / 2 - 1;
  const cum = new Float32Array(nSeg + 1);
  const W = resX - 1, Hh = resZ - 1;
  for (let k = 0; k < nSeg; k++) cum[k + 1] = cum[k] + Math.hypot((pts[2 * k + 2] - pts[2 * k]) * W, (pts[2 * k + 3] - pts[2 * k + 1]) * Hh);
  const total = cum[nSeg] || 1;
  const bankM = 40;
  const maxR = r.hw1 + bankM + r.valley;
  const rad = Math.ceil(maxR / spacing) + 1;
  const dist = new Float32Array(resX * resZ).fill(1e9);
  const tpar = new Float32Array(resX * resZ);
  for (let k = 0; k < nSeg; k++) {
    const ax = pts[2 * k] * W, az = pts[2 * k + 1] * Hh, bx = pts[2 * k + 2] * W, bz = pts[2 * k + 3] * Hh;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx)) - rad), x1 = Math.min(W, Math.ceil(Math.max(ax, bx)) + rad);
    const z0 = Math.max(0, Math.floor(Math.min(az, bz)) - rad), z1 = Math.min(Hh, Math.ceil(Math.max(az, bz)) + rad);
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    const segLen = cum[k + 1] - cum[k];
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        let s = ((x - ax) * dx + (z - az) * dz) / l2;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
        const ex = ax + dx * s - x, ez = az + dz * s - z;
        const d = Math.sqrt(ex * ex + ez * ez) * spacing;
        const i = z * resX + x;
        if (d < dist[i]) {
          dist[i] = d;
          tpar[i] = (cum[k] + segLen * s) / total;
        }
      }
    }
  }
  for (let i = 0; i < H.length; i++) {
    const d = dist[i];
    if (d > maxR) continue;
    const h = H[i];
    if (h < -1) continue;
    const t = tpar[i];
    const hw = lerp(r.hw0, r.hw1, Math.pow(t, 1.2));
    let nh: number;
    if (d < hw) {
      const q = d / hw;
      nh = -2 - (3 + 5 * t) * (1 - q * q);
    } else {
      const flood = 1.4 + Math.min(Math.max(h - 1.4, 0), 60) * 0.06;
      const sb = (d - hw) / bankM;
      if (sb < 1) nh = lerp(-2, flood, smoothstep(0, 1, sb));
      else nh = lerp(flood, h, Math.pow(smoothstep(0, 1, (d - hw - bankM) / r.valley), 0.9));
    }
    if (nh < h) H[i] = nh;
  }
}

function carveLake(H: Float32Array, resX: number, resZ: number, l: { u: number; v: number; r: number; depth: number }, n: Noise2D, aspect: number): void {
  const W = resX - 1, Hh = resZ - 1;
  const rr = l.r * 2.3;
  const x0 = Math.max(0, Math.floor((l.u - rr) * W)), x1 = Math.min(W, Math.ceil((l.u + rr) * W));
  const z0 = Math.max(0, Math.floor((l.v - rr / aspect) * Hh)), z1 = Math.min(Hh, Math.ceil((l.v + rr / aspect) * Hh));
  const o = l.u * 91 + l.v * 37;
  for (let z = z0; z <= z1; z++) {
    for (let x = x0; x <= x1; x++) {
      const du = x / W - l.u, dv = (z / Hh - l.v) * aspect;
      const wob = 1 + 0.35 * n.fbm(du / l.r * 0.6 + o, dv / l.r * 0.6 - o, 3);
      const dd = Math.sqrt(du * du + dv * dv) / (l.r * wob);
      if (dd > 2.2) continue;
      const i = z * resX + x;
      const bed = dd < 1 ? -l.depth + (l.depth + 2) * dd * dd : 2 + (dd - 1) * 14;
      const nh = lerp(bed, H[i], smoothstep(0.9, 2.15, dd));
      if (nh < H[i]) H[i] = nh;
    }
  }
}

function sediment(H: Float32Array, W: number, Hh: number, passes: number, strength: number, fade: number): void {
  const tmp = new Float32Array(H.length);
  for (let p = 0; p < passes; p++) {
    for (let z = 0; z < Hh; z++) {
      const zm = z > 0 ? z - 1 : z, zp = z < Hh - 1 ? z + 1 : z;
      for (let x = 0; x < W; x++) {
        const xm = x > 0 ? x - 1 : x, xp = x < W - 1 ? x + 1 : x;
        const i = z * W + x;
        const avg = (H[zm * W + x] + H[zp * W + x] + H[z * W + xm] + H[z * W + xp]) * 0.15 + (H[zm * W + xm] + H[zm * W + xp] + H[zp * W + xm] + H[zp * W + xp]) * 0.075 + H[i] * 0.1;
        const h = H[i];
        const k = strength * (1 - smoothstep(0, fade, h)) * (h < -2 ? 0.5 : 1);
        tmp[i] = h + (avg - h) * k;
      }
    }
    H.set(tmp);
  }
}

function thermal(H: Float32Array, W: number, Hh: number, iters: number, talus: number, rate: number): void {
  for (let it = 0; it < iters; it++) {
    // alternate scan direction to avoid directional artifacts
    const rev = it & 1;
    for (let zz = 1; zz < Hh - 1; zz++) {
      const z = rev ? Hh - 1 - zz : zz;
      for (let xx = 1; xx < W - 1; xx++) {
        const x = rev ? W - 1 - xx : xx;
        const i = z * W + x;
        const h = H[i];
        let maxD = 0, j = -1;
        let d = h - H[i - 1]; if (d > maxD) { maxD = d; j = i - 1; }
        d = h - H[i + 1]; if (d > maxD) { maxD = d; j = i + 1; }
        d = h - H[i - W]; if (d > maxD) { maxD = d; j = i - W; }
        d = h - H[i + W]; if (d > maxD) { maxD = d; j = i + W; }
        if (j >= 0 && maxD > talus) {
          const m = (maxD - talus) * 0.5 * rate;
          H[i] -= m;
          H[j] += m;
        }
      }
    }
  }
}
