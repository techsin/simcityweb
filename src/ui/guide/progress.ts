/** Serializable guide progress. The host owns the saved copy; the card only edits its own snapshot. */
import { loadPref, savePref } from '../../game/settings';
import { FOUNDING_IDS, GOAL_IDS, type GoalId, type GuideId, type GuideProgress } from '../../core/onboarding';
export { FOUNDING_IDS, GOAL_IDS, type FoundingId, type GoalId, type GuideId, type GuideProgress } from '../../core/onboarding';

export interface GuideProfile {
  version: 1;
  veteran: boolean;
  tips: boolean;
  min: boolean;
  dismissedAll: boolean;
  seenExplainers: string[];
  emergencyTeaching: EmergencyTeachingSeen;
}

export interface EmergencyTeachingSeen { E1a: boolean; E1b: boolean; E2: boolean; E3: boolean }
const TEACHING_IDS = ['E1a', 'E1b', 'E2', 'E3'] as const;
const teachingSeen = (value: unknown): EmergencyTeachingSeen => {
  const v = record(value);
  return { E1a: v.E1a === true, E1b: v.E1b === true, E2: v.E2 === true, E3: v.E3 === true };
};

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
  const legacy = Object.hasOwn(v, 'emergencyTeaching') ? null : loadPref<unknown>('emergencyTeaching', null);
  const profile: GuideProfile = { version: 1, veteran: v.veteran === true, tips: v.tips !== false, min: v.min === true,
    // The old global dismissal stays global for existing profiles.
    dismissedAll: v.dismissedAll === true || (v.version !== 1 && v.dismissed === true),
    seenExplainers: [...new Set(Array.isArray(v.seenExplainers) ? v.seenExplainers.filter((id): id is string => typeof id === 'string') : [])],
    emergencyTeaching: teachingSeen(legacy ?? v.emergencyTeaching) };
  // The nested field also marks migration complete; the retired pref is never consulted again.
  if (legacy !== null) savePref('onboarding', profile);
  return profile;
}

export function saveGuideProfile(profile: GuideProfile): void {
  // The guide retains its snapshot while emergency lessons can be remembered independently.
  const current = loadGuideProfile().emergencyTeaching;
  for (const id of TEACHING_IDS) profile.emergencyTeaching[id] ||= current[id];
  savePref('onboarding', profile);
}

export function markEmergencyTeachingSeen(id: keyof EmergencyTeachingSeen): EmergencyTeachingSeen {
  const profile = loadGuideProfile();
  profile.emergencyTeaching[id] = true;
  saveGuideProfile(profile);
  return profile.emergencyTeaching;
}
