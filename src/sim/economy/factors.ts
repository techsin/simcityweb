/**
 * Shared WP6 factor helpers (SIM_DEPTH_SPEC WP6, docs/SIM_DEPTH_PART_B.md §5 WP6a): the pieces of the desirability,
 * land value and condition formulas that more than one of them uses, so each formula exists once.
 *  - commute: the city-relative commute ramp (desirability COMMUTE term, land value commute score)
 *  - garbage: the population fade of the garbage terms (desirability, land value, condition's no-pickup penalty)
 *  - rent:    the RENT term (desirability) and its capped share in a building's condition target
 * Headless (no DOM / three.js).
 */
import type { CityState } from '../CityState';
import { smoothstep } from '../../core/rng';
import {
  COMMUTE_BAD, COMMUTE_FALLBACK, COMMUTE_GOOD, COMMUTE_GOOD_MIN, COMMUTE_REL_BAD, COMMUTE_REL_GOOD, COMMUTE_SPAN_MIN,
  DESIR_WEIGHTS, GARBAGE_FADE_POP0, GARBAGE_FADE_POP1, RENT_CONDITION_MIN, RENT_LV0, RENT_LV1,
} from './tuning';

/** commute ramp of the city: minutes at which the score starts to drop (good) and reaches 0 (bad); avg = the city's
 *  average commute (fallback COMMUTE_FALLBACK before traffic has measured one) */
export interface CommuteRamp { avg: number; good: number; bad: number }

export function commuteRamp(st: CityState, out: CommuteRamp = { avg: 0, good: 0, bad: 0 }): CommuteRamp {
  const avg = st.stats.avgCommute > 0 ? st.stats.avgCommute : COMMUTE_FALLBACK;
  const g0 = COMMUTE_REL_GOOD * avg;
  const good = g0 < COMMUTE_GOOD_MIN ? COMMUTE_GOOD_MIN : g0 > COMMUTE_GOOD ? COMMUTE_GOOD : g0;
  const b0 = COMMUTE_REL_BAD * avg, bLo = good + COMMUTE_SPAN_MIN;
  const bad = b0 < bLo ? bLo : b0 > COMMUTE_BAD ? Math.max(COMMUTE_BAD, bLo) : b0;
  out.avg = avg; out.good = good; out.bad = bad;
  return out;
}

/** commute minutes of cell i: WP2's accessCommute (every cell), else traffic's residential commute, else the average */
export function commuteMinutes(st: CityState, traffic: boolean, i: number, avg: number): number {
  if (!traffic) return avg;
  const a = st.accessCommute[i];
  if (a > 0) return a;
  const c = st.commute[i];
  return c > 0 ? c : avg;
}

/** commute score 0..1 (1 = at or below the city's good commute) */
export function commuteScore(r: CommuteRamp, minutes: number): number {
  return 1 - smoothstep(r.good, r.bad, minutes);
}

/** 0..1 weight of the garbage terms: fades in over GARBAGE_FADE_POP0..1 residents */
export function garbageFade(st: CityState): number {
  const p = st.stats.population;
  return p > 0 ? smoothstep(GARBAGE_FADE_POP0, GARBAGE_FADE_POP1, p) : 0;
}

/** RENT weight per DevType (DESIR_WEIGHTS[d].rent; condition's per-building fast path) */
const RENT_W = Float64Array.from(DESIR_WEIGHTS, (w) => w.rent ?? 0);

/** RENT input 0..1 at a land value */
export function rentLevel(landValue: number): number {
  return smoothstep(RENT_LV0, RENT_LV1, landValue);
}

/**
 * desirability of DevType `dev` for its condition target: the stored desirability with its RENT contribution capped at
 * RENT_CONDITION_MIN (existing homes gentrify through growth's wealth swap instead of turning unhappy when land value
 * rises; PART_B item 36). Returns the input when the DevType ignores rent.
 */
export function conditionDesirability(st: CityState, dev: number, i: number, des: number): number {
  const w = dev >= 0 && dev < RENT_W.length ? RENT_W[dev] : 0;
  if (w >= 0) return des;
  const lv = st.landValue[i];
  if (lv <= RENT_LV0) return des; // (no rent pressure: the common case, one read per building and day)
  const c = w * rentLevel(lv);
  if (c >= RENT_CONDITION_MIN) return des;
  const v = des - c + RENT_CONDITION_MIN;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
