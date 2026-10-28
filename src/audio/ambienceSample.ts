import { CELL_SIZE } from '../core/constants';
import type { Climate } from '../core/types';

/** Read-only inputs; the sampler also accepts the worker's city replica. */
export interface AmbienceCity {
  readonly size: number;
  readonly water: ArrayLike<number>;
  readonly month: number;
  readonly config: { readonly climate: Climate };
  readonly stats: { readonly population: number };
}

export function ambienceZoom(distance: number, size: number): number {
  return Math.max(0, Math.min(1, (distance - 60) / (size * CELL_SIZE)));
}

/** Water share in the 9x9 cells around the target (meters). At edges, count only cells inside the map. */
export function sampleAmbienceWater(water: ArrayLike<number>, size: number, worldX: number, worldZ: number): number {
  const x = Math.floor(worldX / CELL_SIZE), z = Math.floor(worldZ / CELL_SIZE);
  const x0 = Math.max(0, x - 4), x1 = Math.min(size - 1, x + 4);
  const z0 = Math.max(0, z - 4), z1 = Math.min(size - 1, z + 4);
  let wet = 0, count = 0;
  for (let zz = z0; zz <= z1; zz++) {
    const row = zz * size;
    for (let xx = x0; xx <= x1; xx++) {
      if (water[row + xx] === 1) wet++;
      count++;
    }
  }
  return count ? wet / count : 0;
}
