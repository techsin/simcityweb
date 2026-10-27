/** Serializable guide progress. The host owns the saved copy; the card only edits its own snapshot. */
import { loadPref, savePref } from '../../game/settings';

export const FOUNDING_IDS = ['road', 'zones', 'power', 'water', 'play'] as const;
export const GOAL_IDS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10'] as const;
export type FoundingId = typeof FOUNDING_IDS[number];
export type GoalId = typeof GOAL_IDS[number];
export type GuideId = FoundingId | GoalId;

export interface GuideProgress {
  version: 1;
  phase: 'founding' | 'year' | 'complete';
  completed: GuideId[];
  started: GoalId[];
  startDay: number;
  dismissed: boolean;
  minimised: boolean;
  budgetOpened: boolean;
  solventMonths: number;
  lastBudgetMonth: number | null;
  whyOpened: boolean;
  powerMarginSince: number | null;
  lastExplainerDay: number | null;
}

export interface GuideProfile {
  version: 1;
  veteran: boolean;
  tips: boolean;
  min: boolean;
  dismissedAll: boolean;
  seenExplainers: string[];
}

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const day = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function newProgress(startDay: number): GuideProgress {
  return { version: 1, phase: 'founding', completed: [], started: [], startDay, dismissed: false, minimised: false,
    budgetOpened: false, solventMonths: 0, lastBudgetMonth: null, whyOpened: false, powerMarginSince: null, lastExplainerDay: null };
}

/** Missing / future versions keep the old-save behaviour; never repair a replica in place. */
export function readProgress(value: unknown, now: number): GuideProgress | null {
  const v = record(value);
  if (v.version !== 1 || (v.phase !== 'founding' && v.phase !== 'year' && v.phase !== 'complete')) return null;
  const out = newProgress(day(v.startDay) ? Math.min(v.startDay, now) : now);
  out.phase = v.phase;
  out.completed = [...new Set(Array.isArray(v.completed) ? v.completed.filter((id): id is GuideId => [...FOUNDING_IDS, ...GOAL_IDS].includes(id)) : [])];
  out.started = [...new Set(Array.isArray(v.started) ? v.started.filter((id): id is GoalId => GOAL_IDS.includes(id)) : [])];
  for (const key of ['dismissed', 'minimised', 'budgetOpened', 'whyOpened'] as const) out[key] = v[key] === true;
  for (const key of ['powerMarginSince', 'lastExplainerDay'] as const) out[key] = day(v[key]) && v[key] <= now ? v[key] : null;
  out.solventMonths = day(v.solventMonths) ? Math.min(2, Math.floor(v.solventMonths)) : 0;
  out.lastBudgetMonth = day(v.lastBudgetMonth) ? Math.floor(v.lastBudgetMonth) : null;
  return out;
}

export function loadGuideProfile(): GuideProfile {
  const v = record(loadPref<unknown>('onboarding', {}));
  return { version: 1, veteran: v.veteran === true, tips: v.tips !== false, min: v.min === true,
    // The old global dismissal stays global for existing profiles.
    dismissedAll: v.dismissedAll === true || (v.version !== 1 && v.dismissed === true),
    seenExplainers: [...new Set(Array.isArray(v.seenExplainers) ? v.seenExplainers.filter((id): id is string => typeof id === 'string') : [])] };
}

export function saveGuideProfile(profile: GuideProfile): void {
  savePref('onboarding', profile);
}
