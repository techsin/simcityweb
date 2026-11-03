/** The optional, clone-only per-city guide record shared by the card and simulation host. */
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

export const ONBOARDING_MAX_BYTES = 2048;
const KEYS = ['version', 'phase', 'completed', 'started', 'startDay', 'dismissed', 'minimised', 'budgetOpened',
  'solventMonths', 'lastBudgetMonth', 'whyOpened', 'powerMarginSince', 'lastExplainerDay'] as const;
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
const nullable = (v: unknown): boolean => v === null || natural(v);
const ids = (v: unknown, allowed: readonly string[]): boolean => Array.isArray(v) && v.length <= allowed.length
  && Object.keys(v).length === v.length
  && [...v].every((id) => typeof id === 'string' && allowed.includes(id)) && new Set(v).size === v.length;

/** Commands accept complete v1 records; tolerant old-save reading belongs to the UI, never to the replica. */
export function copyOnboardingProgress(value: unknown): GuideProgress | null {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const v = value as Record<string, unknown>, keys = Object.keys(v);
  if (keys.length !== KEYS.length || keys.some((key) => !KEYS.includes(key as typeof KEYS[number]))) return null;
  if (v.version !== 1 || (v.phase !== 'founding' && v.phase !== 'year' && v.phase !== 'complete')
    || !ids(v.completed, [...FOUNDING_IDS, ...GOAL_IDS]) || !ids(v.started, GOAL_IDS) || !natural(v.startDay)
    || !['dismissed', 'minimised', 'budgetOpened', 'whyOpened'].every((key) => typeof v[key] === 'boolean')
    || !natural(v.solventMonths) || !Number.isInteger(v.solventMonths) || v.solventMonths > 2
    || !nullable(v.lastBudgetMonth) || (v.lastBudgetMonth !== null && !Number.isInteger(v.lastBudgetMonth))
    || !nullable(v.powerMarginSince) || !nullable(v.lastExplainerDay)) return null;
  // Every permitted field is ASCII, so this is also its UTF-8 byte size. The shape bounds work before allocation.
  if (JSON.stringify(v).length > ONBOARDING_MAX_BYTES) return null;
  return structuredClone(v) as unknown as GuideProgress;
}
