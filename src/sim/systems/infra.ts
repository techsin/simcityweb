/**
 * Infrastructure systems (owned by the sim-infrastructure agent), in execution order:
 *   utilities -> traffic -> pollution -> services (incl. transit coverage) -> crime -> fire -> emergency -> disasters
 *   -> justice
 * (emergency: WP8, justice: WP7 — registered here in Phase 0 so no package edits this list)
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
import { EmergencySystem } from '../infra/emergency';
import { JusticeSystem } from '../infra/justice';

export function infraSystems(): SimSystem[] {
  return [
    new UtilitiesSystem(),
    new TrafficSystem(),
    new PollutionSystem(),
    new ServicesSystem(),
    new CrimeSystem(),
    new FireSystem(),
    new EmergencySystem(),
    new DisastersSystem(),
    new JusticeSystem(),
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
export { UtilitiesSystem, PollutionSystem, ServicesSystem, CrimeSystem, FireSystem, DisastersSystem, EmergencySystem, JusticeSystem };
export { emergencyOf, emergencyVehicles, responseAt, uncoveredHotspots } from '../infra/emergency';
export { justiceFactors, getJustice } from '../infra/justice';
export { removeBuilding, readEffects, type OrdEffects } from '../infra/common';
