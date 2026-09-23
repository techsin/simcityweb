/**
 * Infrastructure systems (owned by the sim-infrastructure agent), in execution order:
 *   utilities -> traffic -> pollution -> services (incl. transit coverage) -> crime -> fire -> disasters
 * Each is a SimSystem; get instances with sim.getSystem(name) or the typed helpers below.
 */
import type { SimSystem, Simulation } from '../Simulation';
import { UtilitiesSystem } from '../infra/utilities';
import { TrafficSystem } from '../infra/traffic';
import { PollutionSystem } from '../infra/pollution';
import { ServicesSystem } from '../infra/services';
import { CrimeSystem } from '../infra/crime';
import { FireSystem } from '../infra/fire';
import { DisastersSystem } from '../infra/disasters';

export function infraSystems(): SimSystem[] {
  return [
    new UtilitiesSystem(),
    new TrafficSystem(),
    new PollutionSystem(),
    new ServicesSystem(),
    new CrimeSystem(),
    new FireSystem(),
    new DisastersSystem(),
  ];
}

export function getUtilities(sim: Simulation): UtilitiesSystem | undefined {
  return sim.getSystem<UtilitiesSystem>('utilities');
}
export function getFire(sim: Simulation): FireSystem | undefined {
  return sim.getSystem<FireSystem>('fire');
}

export { getTraffic, TrafficSystem, type SampleRoute, type RouteInfo, type RouteKind } from '../infra/traffic';
export { triggerDisaster, activeDisasters, type DisasterKind, type ActiveDisaster } from '../infra/disasters';
export { overlayLayer, overlayValue, type OverlayLayer } from '../infra/overlays';
export { UtilitiesSystem, PollutionSystem, ServicesSystem, CrimeSystem, FireSystem, DisastersSystem };
export { removeBuilding, ORDINANCE_ALIASES } from '../infra/common';
