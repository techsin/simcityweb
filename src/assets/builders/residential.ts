/**
 * Procedural models for the 'residential' group (owned by the residential asset agent).
 * Implementation is split by density:
 *   res_houses.ts  low density (shack, cottage, townhouses, suburban, ranch, villa, mansion)
 *   res_mid.ts     medium density (walk-up, tenement, rowhouses, apartment, condo, courtyard block)
 *   res_high.ts    high density (projects, slab, towers, twin towers, luxury tower, supertall)
 *   res_util.ts    shared residential modeling helpers
 */
import type { ModelBuilders } from '../registry';
import { houseModels } from './res_houses';
import { estateModels } from './res_estates';
import { midModelsA } from './res_mid';

export const models: ModelBuilders = {
  ...houseModels,
  ...estateModels,
  ...midModelsA,
};
