/**
 * Ordered system list. Infrastructure systems run first (utilities -> traffic -> pollution -> services),
 * then economy systems (land value / desirability -> demand -> growth -> budget -> rewards / advisors).
 */
import type { SimSystem } from '../Simulation';
import { infraSystems } from './infra';
import { economySystems } from './economy';

export function createSystems(): SimSystem[] {
  return [...infraSystems(), ...economySystems()];
}
