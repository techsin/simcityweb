/**
 * Procedural models for the 'industrial' group. See src/assets/manifest.ts for ids, footprints and descriptions,
 * and src/assets/ModelBuilder.ts for the modeling API. Implementation is split into ind_*.ts helper modules.
 *
 * Extra exports for the renderer:
 *  - smokeEmitters[id](variant)  -> stack-top positions (model space) where smoke particles should spawn.
 *  - steamEmitters[id](variant)  -> subset of the above that should render as white steam (not dark smoke).
 */
import type { ModelBuilders } from '../registry';
import { agriModels } from './ind_agri';
import { dirtyModels } from './ind_dirty';
import { manuModels } from './ind_manu';
import { techModels } from './ind_tech';
import { makeEmitterMaps } from './ind_kit';

export const models: ModelBuilders = {
  ...agriModels,
  ...dirtyModels,
  ...manuModels,
  ...techModels,
};

const EMITTER_IDS = ['ind_greenhouse', 'ind_workshop', 'ind_smokestack_factory', 'ind_refinery', 'ind_assembly_plant', 'ind_datacenter'];
const maps = makeEmitterMaps(models, EMITTER_IDS);
export const smokeEmitters: Record<string, (variant: number) => [number, number, number][]> = maps.smoke;
export const steamEmitters: Record<string, (variant: number) => [number, number, number][]> = maps.steam;
