/**
 * Region data contract (serializable, structured-clone friendly). Stored in IndexedDB store 'regions'.
 * The region heightmap is NOT stored: it is regenerated deterministically from (seed, preset, genVersion).
 */
import type { Climate, Difficulty } from '../core/types';

export type RegionPresetId = 'greenvale' | 'azure-coast' | 'twin-rivers' | 'highlands' | 'archipelago' | 'desert-basin' | 'random';

/** tile size in region units: 1 = small (64 cells), 2 = medium (128), 4 = large (256) */
export type TileSize = 1 | 2 | 4;

export interface RegionCitySummary {
  name: string;
  mayor: string;
  population: number;
  /** residents */
  r: number;
  /** commercial jobs */
  c: number;
  /** industrial jobs */
  i: number;
  funds: number;
  /** top-down thumbnail (data URL, from WorldViewApi.capture or the 2D fallback renderer) */
  thumbnail?: string;
  /** Date.now() of the last session */
  lastPlayed: number;
  /** Date.now() when founded */
  founded: number;
  difficulty: Difficulty;
  /** in-game year when last saved */
  year?: number;
  /**
   * coarse skyline grid (base64 Uint8Array, side = tileSize*8, row-major): approximate building height / 2 (m)
   * per 8x8-cell block. Drives the extruded "skyline hints" in the region view.
   */
  skyline?: string;
}

export interface RegionTile {
  /** stable key "x_z" (region units) — also the IndexedDB city key suffix */
  key: string;
  x: number;
  z: number;
  size: TileSize;
  city?: RegionCitySummary;
}

export interface RegionTotals {
  population: number;
  cities: number;
  r: number;
  c: number;
  i: number;
}

export interface RegionData {
  format: 'metropolis-region';
  version: number;
  /** terrain generator version the tiles were founded with */
  genVersion: number;
  id: string;
  name: string;
  seed: number;
  preset: RegionPresetId;
  climate: Climate;
  tiles: RegionTile[];
  totals: RegionTotals;
  created: number;
  lastPlayed: number;
  /** small overview image (data URL) for the load dialog */
  preview?: string;
}

export const TILE_SIZE_LABEL: Record<TileSize, string> = { 1: 'Small', 2: 'Medium', 4: 'Large' };
export const TILE_CELLS: Record<TileSize, number> = { 1: 64, 2: 128, 4: 256 };
