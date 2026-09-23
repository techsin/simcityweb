/**
 * Procedural models for the 'commercial' group. See src/assets/manifest.ts for ids, footprints and descriptions,
 * and src/assets/ModelBuilder.ts for the modeling API.
 *
 * Implementation is split across helper modules owned by the commercial builder:
 *   com_kit.ts  — shared cheap primitives (storefronts, awnings, neon letters, pylons, parking, lofts, beacons...)
 *   com_low.ts  — low density: corner store, gas station, diner, strip mall, restaurant, boutique
 *   com_mid.ts  — medium: shops+apartments, motel, supermarket, hotel, department store, offices, mall
 *   com_high.ts — high: hotel tower, office tower, skyscraper, megatower
 */
import type { ModelBuilders } from '../registry';
import { lowModels } from './com_low';
import { midModels } from './com_mid';
import { highModels } from './com_high';

export const models: ModelBuilders = {
  ...lowModels,
  ...midModels,
  ...highModels,
};
