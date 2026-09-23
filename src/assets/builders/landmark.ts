/**
 * Procedural models for the 'landmark' group. See src/assets/manifest.ts for ids, footprints and descriptions,
 * and src/assets/ModelBuilder.ts for the modeling API. Towers live in ./lm_towers.ts, buildings in ./lm_halls.ts,
 * shared helpers in ./lm_lib.ts and ./park_lib.ts.
 */
import type { ModelBuilders } from '../registry';
import { lotModels } from './park_lib';
import { towerModels } from './lm_towers';
import { hallModels } from './lm_halls';

export const models: ModelBuilders = lotModels({
  ...towerModels,
  ...hallModels,
});
