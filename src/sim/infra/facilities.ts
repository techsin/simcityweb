/**
 * Facility completeness (SIM_DEPTH_SPEC WP7) — PHASE 0 STUB with the final signatures.
 *
 * WP7 implements: the per-facility report rendered generically by the inspector (WP5 does not hand-code facility
 * strings), staffing (facilityOpFactor: 0.6 + 0.4 x staff, BF.Understaffed below 60 %), and use factors of airports /
 * seaports (facilityUseFactor: 0.6 + 0.4 x smoothstep(0, 0.5, use), applied to cap relief, freight boost and income).
 * Until then: no report, factors 1. Headless: no DOM / three.js.
 */
import type { Building, CityState } from '../CityState';
import type { Simulation } from '../Simulation';

export interface FacilityLine {
  /** stable id ('patrolLoad', 'beds', 'riders', ...) */
  key: string;
  label: string;
  /** formatted value, e.g. "18,400 / 30,000 (61%)" */
  value: string;
  /** 0..1+ fill for a bar (omit = no bar) */
  ratio?: number;
  status?: 'ok' | 'warn' | 'bad';
  /** short advice ("workers can't reach it") */
  hint?: string;
}
export interface FacilityReport {
  title: string;
  /** one line: what this facility does */
  role: string;
  lines: FacilityLine[];
  warnings: string[];
}

/** inspector report of a facility (any plopped building). STUB: null */
export function facilityReport(_sim: Simulation, _buildingId: number): FacilityReport | null {
  return null;
}

/** staffing operating factor of a service building (multiplies op_f in the tier engine). STUB: 1 */
export function facilityOpFactor(_st: CityState, _b: Building): number {
  return 1;
}

/** use factor 0.6..1 of an airport / seaport / venue (cap relief, freight boost, income). STUB: 1 */
export function facilityUseFactor(_st: CityState, _b: Building): number {
  return 1;
}
