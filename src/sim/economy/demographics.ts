/**
 * Demographics core (SIM_DEPTH_SPEC WP1) — PHASE 0 STUB with the final signatures.
 *
 * WP1 replaces the bodies: household profiles x wealth x life cycle x amenity pull -> per-building cohort shares
 * (b.kids / teens / yad / srs), workforce share (b.wf), education stock (b.edu), needs and the needs penalty.
 * Until then everything returns the reference cohort mix / legacy values, so nothing changes numerically:
 *   cohortShares = COHORT_BASE (unless the building already carries fields), workerShare = WORKFORCE_RATIO,
 *   needsOf = [], needsPenalty = 0, updateDemographics = no-op, *ScoreAt = 0.5.
 * Headless: no DOM / three.js.
 */
import type { Building, CityState } from '../CityState';
import type { BuildingDef } from '../catalogTypes';
import { Zone, zoneDensity } from '../../core/types';
import { getDef } from '../catalog';
import { COHORT_BASE, WATER_REQUIRED_STAGE, WORKFORCE_RATIO } from './tuning';

/** 0 kids 0-11, 1 teens 12-17, 2 young adults 18-24, 3 adults 25-64, 4 seniors 65+ */
export type Cohort = 0 | 1 | 2 | 3 | 4;
export const COHORT_LABELS: readonly string[] = ['Children', 'Teens', 'Young adults', 'Adults', 'Seniors'];
export type HouseholdForm = 'house' | 'apartment' | 'tower';

/** household form of a residential def: def.household, else by stage (<= 3 house, 4-5 apartment, >= 6 tower), else by
 *  zone density (WP1 adds the per-model table HOUSEHOLD_BY_MODEL) */
export function householdForm(def?: BuildingDef, zone?: Zone): HouseholdForm {
  if (def?.household) return def.household;
  const stage = def?.stage;
  if (stage !== undefined) return stage <= 3 ? 'house' : stage <= 5 ? 'apartment' : 'tower';
  const d = zone !== undefined ? zoneDensity(zone) : 1;
  return d >= 3 ? 'tower' : d === 2 ? 'apartment' : 'house';
}

/** normalised cohort shares [5] of a household form and wealth 1..3 (used by WP6 for empty lots). STUB: reference mix */
export function profileShares(_form: HouseholdForm, _wealth: number, out: Float32Array = new Float32Array(5)): Float32Array {
  for (let c = 0; c < 5; c++) out[c] = COHORT_BASE[c];
  return out;
}

/** cohort shares [5] of a building: its fields when set, else the profile fallback (STUB: reference mix) */
export function cohortShares(b: Building, out: Float32Array = new Float32Array(5)): Float32Array {
  if (b.kids !== undefined && b.teens !== undefined && b.yad !== undefined && b.srs !== undefined) {
    out[0] = b.kids; out[1] = b.teens; out[2] = b.yad; out[4] = b.srs;
    out[3] = Math.max(0, 1 - b.kids - b.teens - b.yad - b.srs);
    return out;
  }
  for (let c = 0; c < 5; c++) out[c] = COHORT_BASE[c];
  return out;
}

/** workforce share of a building's residents (b.wf ?? WORKFORCE_RATIO) — final */
export function workerShare(b: Building): number {
  return b.wf ?? WORKFORCE_RATIO;
}

/** WP1-4: share of residents without a car (car-less workers pay extra on car / park & ride options in WP7) */
const CARLESS_EFF = [0.2, 0.05, 0];
export function carlessShare(b: Building): number {
  const w = Math.max(1, Math.min(3, b.wealth || 1));
  const yad = b.yad ?? COHORT_BASE[2], srs = b.srs ?? COHORT_BASE[4];
  return CARLESS_EFF[w - 1] * (0.5 + yad + srs);
}

/** true when the building needs piped water (legacy rule: growables at stage >= WATER_REQUIRED_STAGE or zone density
 *  >= 2; plopped buildings with def.waterUse > 0) — final */
export function waterRequired(st: CityState, b: Building): boolean {
  const def = getDef(b.def);
  if (!def) return false;
  if (def.category !== 'growable') return (def.waterUse ?? 0) > 0;
  const N = st.size;
  const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
  return (def.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(st.zone[i] as Zone) >= 2;
}

/** appeal 0..1 of cell i for families / seniors / students (WP5 desirability overlay variants). STUB: 0.5 */
export function familyScoreAt(_st: CityState, _i: number): number {
  return 0.5;
}
export function seniorScoreAt(_st: CityState, _i: number): number {
  return 0.5;
}
export function studentScoreAt(_st: CityState, _i: number): number {
  return 0.5;
}

export type NeedKind = 'elementary' | 'high' | 'college' | 'health' | 'play' | 'green' | 'shops' | 'jobs' | 'transit' | 'quiet' | 'water';
export interface NeedReport {
  /** cohort with the need, -1 = whole household */
  cohort: Cohort | -1;
  kind: NeedKind;
  /** e.g. "Elementary school", "Unsafe tap water" */
  label: string;
  /** people with this need in the building */
  people: number;
  /** access 0..1 */
  access: number;
  met: boolean;
  /** serving facility (building id), when known */
  providerId?: number;
}

/** needs of a residential building (WP5 inspector). STUB: [] */
export function needsOf(_st: CityState, _b: Building): NeedReport[] {
  return [];
}

/** health-target penalty 0..NEEDS_PENALTY_MAX from unmet cohort needs at cell i. STUB: 0 */
export function needsPenalty(_st: CityState, _b: Building, _i: number): number {
  return 0;
}

/** per-building cohort / workforce / education update (runs in the occupancy slice every dtDays). STUB: no-op */
export function updateDemographics(_st: CityState, _b: Building, _def: BuildingDef, _i: number, _dtDays: number): void {
  // WP1
}
