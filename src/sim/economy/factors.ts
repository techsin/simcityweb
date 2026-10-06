/**
 * Shared WP6 factor helpers (SIM_DEPTH_SPEC WP6, docs/SIM_DEPTH_PART_B.md §5 WP6a): the pieces of the desirability,
 * land value and condition formulas that more than one of them uses, so each formula exists once.
 *  - commute: the city-relative commute ramp (desirability COMMUTE term, land value commute score)
 *  - garbage: the population fade of the garbage terms (desirability, land value, condition's no-pickup penalty)
 *  - rent:    the RENT term (desirability) and its capped share in a building's condition target
 *  - lotCell: the cell a growable is evaluated at (its front row)
 * Headless (no DOM / three.js).
 */
import type { CityState } from '../CityState';
import { smoothstep } from '../../core/rng';
import {
  COMMUTE_AVG_DAYS, COMMUTE_BAD, COMMUTE_FALLBACK, COMMUTE_GOOD, COMMUTE_GOOD_MIN, COMMUTE_REL_BAD, COMMUTE_REL_GOOD,
  COMMUTE_SPAN_MIN, DESIR_WEIGHTS, GARBAGE_FADE_POP0, GARBAGE_FADE_POP1, RENT_CONDITION_MIN, RENT_LV0, RENT_LV1,
} from './tuning';
import { ACCESS_UNREACHED } from '../infra/params';

/** commute ramp of the city: minutes at which the score starts to drop (good) and reaches 0 (bad); avg = the city's
 *  average commute (smoothed, see advanceCommuteAvg; fallback COMMUTE_FALLBACK before traffic has measured one);
 *  unreached = the minutes of a cell the services pass found no road route from (see commuteMinutes) */
export interface CommuteRamp { avg: number; good: number; bad: number; unreached: number }

/** systemData.commuteAvg: the smoothed city-average commute (minutes) and the day it was last advanced */
interface CommuteAvg { v: number; day: number }

/**
 * Advance the city-average commute the ramp follows to today (once a day, by the economy before its bands; a second
 * call the same day does nothing): traffic's stats.avgCommute smoothed over COMMUTE_AVG_DAYS. Saved with the city, so a
 * loaded game keeps its ramp while traffic re-measures from scratch.
 */
export function advanceCommuteAvg(st: CityState): void {
  const raw = st.stats.avgCommute;
  if (!(raw > 0)) return;
  const d = st.systemData.commuteAvg as CommuteAvg | undefined;
  if (!d || !(d.v > 0) || !(d.day <= st.day)) { st.systemData.commuteAvg = { v: raw, day: st.day }; return; }
  if (d.day === st.day) return;
  d.v += (raw - d.v) * (1 - Math.exp(-(st.day - d.day) / COMMUTE_AVG_DAYS));
  d.day = st.day;
}

export function commuteRamp(st: CityState, out: CommuteRamp = { avg: 0, good: 0, bad: 0, unreached: 0 }): CommuteRamp {
  const sm = (st.systemData.commuteAvg as CommuteAvg | undefined)?.v ?? 0;
  const avg = sm > 0 ? sm : st.stats.avgCommute > 0 ? st.stats.avgCommute : COMMUTE_FALLBACK;
  const g0 = COMMUTE_REL_GOOD * avg;
  const good = g0 < COMMUTE_GOOD_MIN ? COMMUTE_GOOD_MIN : g0 > COMMUTE_GOOD ? COMMUTE_GOOD : g0;
  const b0 = COMMUTE_REL_BAD * avg, bLo = good + COMMUTE_SPAN_MIN;
  const bad = b0 < bLo ? bLo : b0 > COMMUTE_BAD ? Math.max(COMMUTE_BAD, bLo) : b0;
  out.avg = avg; out.good = good; out.bad = bad;
  // services writes ACCESS_UNREACHED × the average for cells without a road route, but 0 while traffic has no average
  // yet (early game): once the layer is live, a 0 means "unreachable", not "unknown"
  out.unreached = accessCommuteLive(st) ? ACCESS_UNREACHED * avg : avg;
  return out;
}

/** accessCommute has been written (some cell > 0) — checked once a day per state */
const accessLive = new WeakMap<CityState, { day: number; live: boolean }>();
function accessCommuteLive(st: CityState): boolean {
  const c = accessLive.get(st);
  if (c && c.day === st.day && c.live) return true;
  if (c && c.day === st.day) return false;
  const a = st.accessCommute;
  let live = false;
  for (let i = 0; i < a.length; i++) if (a[i] > 0) { live = true; break; }
  accessLive.set(st, { day: st.day, live });
  return live;
}

/**
 * commute minutes of cell i: WP2's accessCommute (every cell), else traffic's residential commute, else `unreached`
 * (CommuteRamp.unreached: the average while the layer is not live yet, a long commute for a cell with no road route)
 */
export function commuteMinutes(st: CityState, traffic: boolean, i: number, avg: number, unreached = avg): number {
  if (!traffic) return avg;
  const a = st.accessCommute[i];
  if (a > 0) return a;
  const c = st.commute[i];
  return c > 0 ? c : unreached;
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

/**
 * the cell a growable is evaluated at (condition, needs access, redevelopment, wealth swaps): the middle of its front
 * (road-side) row. The centre of a deep-infill lot is a yard cell that the services pass reaches only in its footprint
 * step, so its coverage dips for days every pass; the front row touches the road and is always reached per cell.
 */
export function lotCell(b: { x: number; z: number; w: number; d: number; rot: number }, N: number): number {
  let x = b.x + (b.w >> 1), z = b.z + (b.d >> 1);
  if (b.rot === 0) z = b.z + b.d - 1;
  else if (b.rot === 2) z = b.z;
  else if (b.rot === 1) x = b.x + b.w - 1;
  else x = b.x;
  return (z < 0 ? 0 : z > N - 1 ? N - 1 : z) * N + (x < 0 ? 0 : x > N - 1 ? N - 1 : x);
}
