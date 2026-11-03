/**
 * FH-11: the New City dialog's starting choices, per profile (localStorage through loadPref / savePref).
 *
 * - **Difficulty.** A profile's first city preselects Easy; later dialogs preselect the last difficulty founded with
 *   ('metropolis.ui.newCity'). A profile that founded cities before FH-11 has no record: its first dialog in a region
 *   that already has a city keeps today's Medium.
 * - **Guided start and "I've played city builders before".** Both live in the guide's profile pref
 *   ('metropolis.ui.onboarding', read by src/ui/Onboarding.ts), so the dialog and the in-city guide agree: Guided start
 *   off (or the veteran box) records the guide as dismissed, so the founding steps do not open; Guided start on clears
 *   that. `dismissed` is today's key and `dismissedAll` the per-profile key of the guide framework (FH-22), which reads
 *   an old record's `dismissed` as `dismissedAll`; both are written. `veteran` is FH-18's key for the briefing.
 */
import type { Difficulty } from '../core/types';
import { loadPref, savePref } from '../game/settings';

const NEW_CITY = 'newCity';
const GUIDE = 'onboarding';
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'sandbox'];

export interface NewCityChoice {
  difficulty: Difficulty;
  /** open the city with the guide's founding steps */
  guided: boolean;
  /** skip the founding steps (FH-18 shows its veteran briefing instead) */
  veteran: boolean;
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** the dialog's preselection; `regionHasCity`: the region already holds a city (an existing player, see the header) */
export function newCityDefaults(regionHasCity = false): NewCityChoice {
  const last = record(loadPref<unknown>(NEW_CITY, null)).difficulty;
  const guide = record(loadPref<unknown>(GUIDE, null));
  const veteran = guide.veteran === true;
  const difficulty = DIFFICULTIES.includes(last as Difficulty) ? (last as Difficulty) : regionHasCity ? 'medium' : 'easy';
  return { difficulty, guided: !veteran && guide.dismissed !== true && guide.dismissedAll !== true, veteran };
}

/** remember a founded city's choices: the next dialog's preselection, and whether the new city's guide opens */
export function rememberNewCity(c: NewCityChoice): void {
  savePref(NEW_CITY, { difficulty: c.difficulty });
  const off = !c.guided || c.veteran;
  savePref(GUIDE, { ...record(loadPref<unknown>(GUIDE, null)), dismissed: off, dismissedAll: off, veteran: c.veteran });
}
