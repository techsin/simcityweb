/**
 * Attraction, tourism, hotels and attractiveness (SIM_DEPTH_SPEC WP4) — PHASE 0 STUB with the final signatures.
 *
 * WP4 implements: the ATTRACTIONS venue table (no catalog edits), beaches / historic buildings, visits capped by
 * venue capacity, hotels, tourism jobs (econData.tourism), venue income, st.visitors (monthly AND in init(), since the
 * layer is derived / not saved), attractiveness 0..100 (+ per wealth) and its breakdown.
 * The stub system is registered in systems/economy.ts (after population, before demand) and does nothing, so
 * WP4 does not need to edit the system list. Headless: no DOM / three.js.
 */
import type { CityState } from '../CityState';
import type { SimSystem } from '../Simulation';
import type { FactorTerm } from '../explain';
import type { EconRuntime } from './runtime';

export interface AttractionDef {
  kind: 'landmark' | 'culture' | 'sport' | 'entertainment' | 'nature' | 'business' | 'transport';
  /** visitors / day at attractiveness 60 */
  draw: number;
  /** max visitors / day */
  capacity: number;
}

/** def id -> venue (WP4 fills the table). STUB: empty */
export const ATTRACTIONS: Readonly<Record<string, AttractionDef>> = {};

/** the tourism system (monthly venue loop, visitor splat, attractiveness). STUB: no hooks */
export function tourismSystem(rt: EconRuntime): SimSystem & { rt: EconRuntime } {
  return { name: 'economy.tourism', rt };
}

/** visits / capacity of a venue building. STUB: null */
export function venueVisits(_st: CityState, _buildingId: number): { visits: number; capacity: number } | null {
  return null;
}

/** attractiveness terms (culture, parks, safety, clean, quiet, services, jobs, connect). STUB: [] */
export function attractivenessBreakdown(_st: CityState): FactorTerm[] {
  return [];
}

/** P2 hook for a traffic VISIT phase: visitor trips per venue. STUB: [] */
export function tourismTrips(_st: CityState): { buildingId: number; tripsPerDay: number }[] {
  return [];
}
