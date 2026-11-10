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
  /**
   * LG-12: tile key of the city this one was founded from as its sister city. citySummary.ts copies it from the city's
   * own save (systemData.sisterOf), so it survives every summary refresh; absent for any other city.
   */
  sisterOf?: string;
}

/**
 * LG-12: one sister-city founding in the region's ledger (RegionData.endowments). The entry IS the transfer: it is
 * stored by the region write that first names the new city, and each of the two cities books its side from it the next
 * time it is opened, once (regionEffects.ts dueEndowments → budget.ts bookEndowments). A tab killed at any moment
 * therefore leaves a whole transfer or none.
 */
export interface SisterEndowment {
  /** unique per founding; a city remembers the ids it has booked (systemData.sisterBooks) */
  id: string;
  /** tile keys of the parent and of the new city */
  from: string;
  to: string;
  /** § the parent gave the new city (0: founded without an endowment) */
  amount: number;
  /** the parent's game day at the founding: the 10-year rule and the parent's approval bonus count from it */
  day: number;
  /** the two cities' RegionCitySummary.founded: a city founded later on the parent's tile owes nothing */
  fromFounded: number;
  toFounded: number;
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
  /** what `preview` was drawn from (regionPreviewKey): regenerated only when this changes */
  previewKey?: string;
  /** LG-12: the sister-city foundings and their endowments, oldest first (absent in a region saved before LG-12) */
  endowments?: SisterEndowment[];
}

export const TILE_SIZE_LABEL: Record<TileSize, string> = { 1: 'Small', 2: 'Medium', 4: 'Large' };
export const TILE_CELLS: Record<TileSize, number> = { 1: 64, 2: 128, 4: 256 };
