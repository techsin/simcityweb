/**
 * Procedural models for the 'utility' group. See src/assets/manifest.ts for ids, footprints and descriptions,
 * and src/assets/ModelBuilder.ts for the modeling API. Implementation is split into util_*.ts helper modules.
 *
 * Extra exports for the renderer:
 *  - smokeEmitters[id](variant) -> stack / cooling-tower top positions (model space) where plumes should spawn.
 *  - steamEmitters[id](variant) -> subset of smokeEmitters that should render as white water vapour (cooling towers,
 *    mechanical-draft cells) instead of grey smoke.
 *  - pylonWireAttach -> util_power_pylon insulator attachment points (model space, arms along X; wires run along Z).
 */
import type { ModelBuilders } from '../registry';
import { powerModels, pylonWireAttach as PYLON_ATTACH } from './util_power';
import { waterModels } from './util_water';
import { wasteModels } from './util_waste';
import { makeEmitterMaps } from './ind_kit';

export const models: ModelBuilders = {
  ...powerModels,
  ...waterModels,
  ...wasteModels,
};

const EMITTER_IDS = ['util_coal_plant', 'util_gas_plant', 'util_oil_plant', 'util_nuclear_plant', 'util_incinerator'];
const maps = makeEmitterMaps(models, EMITTER_IDS);
export const smokeEmitters: Record<string, (variant: number) => [number, number, number][]> = maps.smoke;
export const steamEmitters: Record<string, (variant: number) => [number, number, number][]> = maps.steam;

/** Wire attachment points (insulator bottoms) of util_power_pylon, model space. 6 points: 3 per side (x<0 / x>0). */
export const pylonWireAttach: [number, number, number][] = PYLON_ATTACH;
