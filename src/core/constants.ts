/**
 * Global constants shared by simulation, rendering and UI.
 * World units are METERS. One grid cell is CELL_SIZE x CELL_SIZE meters (like SC4's 16m tiles).
 * Grid index convention: i = z * size + x   (x = column / east, z = row / south)
 * Cell (x,z) covers world rect [x*CELL, (x+1)*CELL] x [z*CELL, (z+1)*CELL]; +Y is up.
 * Height map has (size+1)^2 corner samples: hIndex = z * (size+1) + x.
 */
export const CELL_SIZE = 16;

export const CITY_SIZES = {
  small: 64,
  medium: 128,
  large: 256,
} as const;
export type CitySizeName = keyof typeof CITY_SIZES;

/** Region grid: a region is REGION_W x REGION_H "region units"; small city = 1x1 unit, medium 2x2, large 4x4. */
export const REGION_W = 16;
export const REGION_H = 16;
export const REGION_UNIT_CELLS = 64; // cells per region unit

/** Default sea level in meters. Terrain below this is water. */
export const SEA_LEVEL = 0;

/** Max height of terrain in meters. */
export const MAX_TERRAIN_HEIGHT = 250;

/** Simulation calendar. */
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const START_YEAR = 2000;

/** Real seconds per simulated day at each speed setting (index = speed). 0 = paused. */
export const SECONDS_PER_DAY = [Infinity, 0.5, 0.2, 0.05];

/** Maximum distance (cells) from a road for a zoned lot to count as having road access. */
export const ROAD_ACCESS_DIST = 1;
