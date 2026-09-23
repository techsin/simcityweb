/**
 * Emergency dispatch (SIM_DEPTH_SPEC WP8) — PHASE 0 STUB with the final signatures.
 *
 * WP8 implements: fleets per station, response-slack layers st.respFire / respPolice / respMedical (scheduler task
 * 'emergency.response', also computed in init() since the layers are derived / not saved), deterministic incident
 * generation (own RNG, saved in systemData.emergency), auto dispatch when a station with a free unit is within range,
 * 'uncovered' alerts + manual dispatch otherwise, outcomes into stats.emergency, and the fire.ts rewrite
 * (fire.ts calls emergencyOf(sim)?.onFire(); when it returns false the legacy fire path runs).
 *
 * The stub system is registered in systems/infra.ts (after fire, before disasters) and is inert: `active` is false,
 * onFire returns false (legacy fire behaviour), no incidents, no vehicles, responseAt = null. Headless: no DOM / three.
 */
import type { Building, EmergencyStats, IncidentKind, Responder } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';

export type IncidentState = 'queued' | 'uncovered' | 'dispatched' | 'onScene' | 'resolved' | 'failed';
export type UncoveredReason = 'noStation' | 'outOfRange' | 'busy';

export interface Incident {
  id: number;
  kind: IncidentKind;
  /** site cell */
  x: number;
  z: number;
  /** building at the site, -1 = none */
  buildingId: number;
  major: boolean;
  state: IncidentState;
  /** sim time (days, fractional) the incident started, and its deadline */
  start: number;
  deadline: number;
  /** kind-specific severity (fire heat, riot radius, injured, ...) */
  severity: number;
  /** units needed per responder */
  need: Partial<Record<Responder, number>>;
  /** assigned vehicle ids */
  units: number[];
  reason?: UncoveredReason;
  manualPossible: boolean;
  /** expected arrival of the first unit (game minutes) */
  etaMin?: number;
}

export type EmergencyVehicleModel = 'fire_truck' | 'car_police' | 'ambulance';
export interface EmergencyVehicle {
  id: number;
  responder: Responder;
  model: EmergencyVehicleModel;
  stationId: number;
  incidentId: number;
  state: 'outbound' | 'onScene' | 'returning';
  /** route cells (i = z*N + x) from the station to the site (<= 400); returning drives it backwards */
  path: number[];
  /** cumulative game minutes at each path cell (rounded to 0.01) */
  times: number[];
  /** sim time (days, fractional) the current leg started; position = interpolate(times, (simTime - legStart) / EMERG_DAYS_PER_MIN) */
  legStart: number;
}

export interface StationFleet {
  type: Responder;
  total: number;
  free: number;
  out: number;
}
export interface DispatchOption {
  stationId: number;
  name: string;
  responder: Responder;
  free: number;
  etaMin: number;
  etaDays: number;
}
export interface DispatchResult {
  ok: boolean;
  reason?: string;
  etaMin?: number;
}
export interface SpawnOptions {
  major?: boolean;
  buildingId?: number;
  severity?: number;
}

/** units per station def (effective units scale with funding: 0 below 25 %, else max(1, round(units x min(1.2, f)))) */
export const FLEET: Readonly<Record<string, { responder: Responder; units: number }>> = {
  civ_fire_station: { responder: 'fire', units: 2 },
  civ_fire_hq: { responder: 'fire', units: 5 },
  civ_police_kiosk: { responder: 'police', units: 1 },
  civ_police_station: { responder: 'police', units: 2 },
  civ_police_hq: { responder: 'police', units: 6 },
  civ_clinic: { responder: 'medical', units: 1 },
  civ_hospital: { responder: 'medical', units: 3 },
  civ_medical_center: { responder: 'medical', units: 6 },
};

export const INCIDENT_LABEL: Readonly<Record<IncidentKind, string>> = {
  fire: 'Fire',
  industrial: 'Industrial accident',
  spill: 'Hazardous spill',
  crime: 'Crime spree',
  riot: 'Riot',
  medical: 'Medical emergency',
  collapse: 'Building collapse',
  prisonRiot: 'Prison riot',
};
export const INCIDENT_COLOR: Readonly<Record<IncidentKind, string>> = {
  fire: '#e8542c',
  industrial: '#e89a2c',
  spill: '#8fbf2a',
  crime: '#3d6fd8',
  riot: '#9b3dd8',
  medical: '#e8e8e8',
  collapse: '#a08060',
  prisonRiot: '#5a3dd8',
};

/** pollution source of an active incident (spills, industrial fires) — splatted by pollution.ts like plopped emitters */
export interface EmergencyPollutionSource {
  x: number;
  z: number;
  air: number;
  water: number;
  radius: number;
}
/** crime boost of an active / failed incident (riots, unresolved crime) — splatted by crime.ts into raw crime */
export interface CrimeBoost {
  x: number;
  z: number;
  radius: number;
  amount: number;
}

export class EmergencySystem implements SimSystem {
  readonly name = 'emergency';
  /** false while the stub is installed: fire.ts keeps its legacy path, nothing is generated */
  readonly active: boolean = false;
  protected sim: Simulation | null = null;

  init(sim: Simulation): void {
    this.sim = sim;
  }

  /** active incidents */
  incidents(): readonly Incident[] {
    return [];
  }
  /** vehicles on the road / on scene */
  vehicles(): readonly EmergencyVehicle[] {
    return [];
  }
  /** fleet of a station building, null when it is not an emergency station */
  stationFleet(_buildingId: number): StationFleet | null {
    return null;
  }
  /** player dispatch options for an incident (full-map search, cached 3 days) */
  dispatchOptions(_sim: Simulation, _incidentId: number): DispatchOption[] {
    return [];
  }
  /** send `units` free units of a station to an incident */
  dispatch(_sim: Simulation, _incidentId: number, _stationId: number, _units = 1): DispatchResult {
    return { ok: false, reason: 'Emergency dispatch is not available' };
  }
  /** dispatch from the best (fastest) station with a free unit (bot / "Send nearest") */
  dispatchBest(_sim: Simulation, _incidentId: number): DispatchResult {
    return { ok: false, reason: 'Emergency dispatch is not available' };
  }
  /** create an incident (disasters, justice prison riots, sandbox, tests); returns its id or -1 */
  spawn(_sim: Simulation, _kind: IncidentKind, _x: number, _z: number, _opts?: SpawnOptions): number {
    return -1;
  }
  /** the active incident at / covering cell (x, z), if any (inspector) */
  report(_sim: Simulation, _x: number, _z: number): Incident | null {
    return null;
  }
  /** outcome statistics (stats.emergency) */
  stats(sim: Simulation): EmergencyStats {
    return sim.state.stats.emergency;
  }
  /** a building ignited (fire.ts). true = the emergency system handles it; false = legacy fire path */
  onFire(_sim: Simulation, _b: Building, _spread: boolean): boolean {
    return false;
  }
}

export function emergencyOf(sim: Simulation): EmergencySystem | undefined {
  return sim.getSystem<EmergencySystem>('emergency');
}

/** vehicles for the renderer (EmergencyVehicles.ts) */
export function emergencyVehicles(sim: Simulation): readonly EmergencyVehicle[] {
  return emergencyOf(sim)?.vehicles() ?? [];
}

/** auto-dispatch reach of responder r at a cell: slack >= 0 = covered. STUB: null (unknown) */
export function responseAt(_sim: Simulation, _cell: number, _r: Responder): { slackMin: number; covered: boolean } | null {
  return null;
}

/** coarse 8x8 blocks with the most residents outside responder r's auto-dispatch reach (top n). STUB: [] */
export function uncoveredHotspots(_sim: Simulation, _r: Responder, _n = 5): { x: number; z: number; people: number }[] {
  return [];
}

/** pollution sources of active incidents. STUB: [] */
export function emergencyPollution(_sim: Simulation): EmergencyPollutionSource[] {
  return [];
}

/** crime boosts of active / failed incidents. STUB: [] */
export function emergencyCrimeBoosts(_sim: Simulation): CrimeBoost[] {
  return [];
}
