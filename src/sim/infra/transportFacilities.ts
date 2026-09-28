/**
 * Transport-facility hook (docs/SIM_DEPTH_PART_B.md, owner WP7b) — PART-B STUB with the final signatures.
 *
 * WP7a's facilityReport (facilities.ts) calls transportFacilityReport(sim, b) for every building and merges the part it
 * returns (lines and warnings appended, role used when WP7a has none), so WP7a and WP7b never edit the same hunk.
 * WP7b fills it in for tr_bus_stop, civ_bus_depot, tr_subway_station, tr_train_station, tr_freight_station,
 * tr_parking_garage and tr_ferry_terminal (the airport / seaport "use" lines are WP7a's), plus the getters below.
 * Headless: no DOM / three.js.
 */
import type { Building, CityState } from '../CityState';
import type { Simulation } from '../Simulation';
import type { FacilityLine } from './facilities';

export interface TransportFacilityPart {
  /** one-line role when the transport part defines it ("Bus depot: runs the buses of stops within 90 road tiles") */
  role?: string;
  lines: FacilityLine[];
  warnings: string[];
}

/** transport part of a facility's inspector report; null = not a transport facility. STUB: null */
export function transportFacilityReport(_sim: Simulation, _b: Building): TransportFacilityPart | null {
  return null;
}

/** trucks per day reaching a freight sink building (seaport, freight station); -1 = unknown (no traffic data). STUB: -1 */
export function freightSinkTrucks(_sim: Simulation, _buildingId: number): number {
  return -1;
}

/** trucks per day per road cell of the last traffic cycle (Traffic overlay "Trucks" variant, WP5); null = no data. STUB */
export function truckVolumeOf(_st: CityState): Float32Array | null {
  return null;
}

/**
 * City-level effect metric per transport def for the facilities matrix test (tests/infra/facilities.test.ts, WP7a): the
 * test compares the value after 60 days with and without the facility and asserts that it changes. STUB: {} (until WP7b
 * fills it, the matrix checks the report lines of transport defs only)
 */
export const TRANSPORT_EFFECT_METRICS: Readonly<Record<string, (sim: Simulation) => number>> = {};
