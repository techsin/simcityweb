/** Player settings (persisted in localStorage). */
import type { QualityLevel } from '../render/contracts';
import { ACCESSIBILITY_CHECKS, DEFAULT_SETTINGS as APP_DEFAULTS, type ColourVision, type MotionPref, type SettingCheck, type TextSize } from '../region/settings';

export { UI_SCALE, resolveMotion, type ColourVision, type MotionPref, type TextSize } from '../region/settings';

export interface GameSettings {
  quality: QualityLevel;
  /** time of day follows the simulation clock */
  autoTime: boolean;
  /** hour 0..24 used when autoTime = false */
  fixedHour: number;
  /** scroll the camera when the mouse touches the screen edge */
  edgeScroll: boolean;
  /** UI scale multiplier (applied on top of automatic resolution scaling) */
  uiScale: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  /** 15-40 second rests between songs in the city */
  musicPauses: boolean;
  /** fade and suspend audio while the browser tab is hidden */
  muteInBackground: boolean;
  /** show the cell grid while zoning / building */
  showGrid: boolean;
  /** show frames-per-second counter */
  showFps: boolean;
  /** autosave interval in game months (0 = off) */
  autosaveMonths: number;
  /** pause when the browser tab is hidden */
  pauseWhenHidden: boolean;
  /** show toast notifications */
  toasts: boolean;
  /** New Year celebration on January 1st: fireworks after a time-lapse to midnight / fireworks only / off */
  newYear: NewYearMode;
  /** Cinematic New Year: the camera eases to a skyline view of the show and back (any camera input takes over) */
  newYearCamera: boolean;
  /** emergency no station can answer (the player must dispatch): drop to LIVE speed / pause / keep the speed */
  emergencyUncovered: EmergencyPolicy;
  /** emergency banners for major incidents only, or for every incident that needs the player */
  emergencyAlerts: 'major' | 'all';
  /** LIVE mode slow-motion at 1x (1 = plain 1x, 3 = 1.5 s per game day) */
  emergencyLiveSlowmo: number;
  // Polish schema (docs/POLISH_PLAN.md §7.5); each consumer lands with its item. uiScale, textSize, motion and colourVision
  // are app-level settings (src/region/settings.ts): the app passes them in as overrides, so these are the city's copies.
  /** motion and flashing (FEEL-21); resolveMotion turns 'system' into full or reduced */
  motion: MotionPref;
  /** text size: +0, +10, +20 or +30 % (FH-23) */
  textSize: TextSize;
  /** colour vision palette (FH-20) */
  colourVision: ColourVision;
  /** first-time tips and explainers (§4.1 "Tips on/off") */
  tips: boolean;
  /** spotlight camera for the city's firsts (FEEL-07) */
  cameraMoments: boolean;
  /** New Year show: a full show for milestones only, or every year (today's pacing) — FEEL-02a, D17 */
  newYearPacing: NewYearPacing;
  /** problem icons over troubled buildings: off / with the Query tool / always (FEEL-28) */
  problemIcons: ProblemIcons;
  /** the Year in review card after New Year (LG-21) */
  yearReview: boolean;
  /** camera pan speed multiplier (FH-19) */
  panSpeed: number;
  /** invert the orbit (rotate) drag (FH-19) */
  invertOrbit: boolean;
  /** rebound keys: action id -> KeyboardEvent.code; empty = the default keys (FH-25) */
  keyBindings: Record<string, string>;
}

/** what the game does when an emergency needs a player dispatch (src/ui/EmergencyBanner.ts speedPolicy) */
export type EmergencyPolicy = 'live' | 'pause' | 'ignore';

export type NewYearMode = 'cinematic' | 'fireworks' | 'off';

export type NewYearPacing = 'milestones' | 'everyYear';
export const NEW_YEAR_PACINGS: readonly NewYearPacing[] = ['milestones', 'everyYear'];

export type ProblemIcons = 'off' | 'query' | 'always';
export const PROBLEM_ICONS: readonly ProblemIcons[] = ['off', 'query', 'always'];

/** the pan speed multiplier's range (FH-19's row) */
export const PAN_SPEED = { min: 0.5, max: 2, step: 0.1 } as const;

export const DEFAULT_SETTINGS: GameSettings = {
  quality: 'high',
  autoTime: true,
  fixedHour: 14,
  edgeScroll: false,
  uiScale: 1,
  masterVolume: 0.8,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  ambienceVolume: 0.6,
  musicPauses: true,
  muteInBackground: true,
  showGrid: true,
  showFps: false,
  autosaveMonths: 6,
  pauseWhenHidden: true,
  toasts: true,
  newYear: 'cinematic',
  newYearCamera: true,
  emergencyUncovered: 'live',
  emergencyAlerts: 'major',
  emergencyLiveSlowmo: 3,
  motion: APP_DEFAULTS.motion,
  textSize: APP_DEFAULTS.textSize,
  colourVision: APP_DEFAULTS.colourVision,
  tips: true,
  cameraMoments: true,
  newYearPacing: 'milestones',
  problemIcons: 'query',
  yearReview: true,
  panSpeed: 1,
  invertOrbit: false,
  // (frozen: a loaded settings object gets its own copy)
  keyBindings: Object.freeze({}) as Record<string, string>,
};

const KEY = 'metropolis.settings.v1';

const oneOf = (list: readonly unknown[]): SettingCheck => (v) => (list.includes(v) ? v : undefined);
/** keyBindings: a plain object of strings (other entries are dropped), always a fresh copy */
const bindings: SettingCheck = (v) =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, code]) => typeof code === 'string')) : undefined;
/** checks for the §7.5 keys; every older key only needs the default's type, which is what earlier builds stored */
const CHECKS: Partial<Record<keyof GameSettings, SettingCheck>> = {
  ...ACCESSIBILITY_CHECKS,
  newYearPacing: oneOf(NEW_YEAR_PACINGS),
  problemIcons: oneOf(PROBLEM_ICONS),
  panSpeed: (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(PAN_SPEED.max, Math.max(PAN_SPEED.min, v)) : undefined),
  keyBindings: bindings,
};
const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof GameSettings)[];

export function loadSettings(overrides: Partial<GameSettings> = {}): GameSettings {
  let stored: Record<string, unknown> = {};
  try {
    const raw = localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object' && !Array.isArray(v)) stored = v as Record<string, unknown>;
  } catch {
    /* storage unavailable */
  }
  // known keys only (unknown ones are ignored)
  const s: GameSettings = { ...DEFAULT_SETTINGS, keyBindings: {} };
  for (const k of KEYS) {
    if (stored[k] === undefined) continue;
    const check = CHECKS[k];
    const v = check ? check(stored[k]) : typeof stored[k] === typeof DEFAULT_SETTINGS[k] ? stored[k] : undefined;
    if (v !== undefined) (s as unknown as Record<string, unknown>)[k] = v;
  }
  return { ...s, ...overrides };
}

export function saveSettings(s: GameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** tiny per-viewer UI prefs (panel positions etc.) */
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem('metropolis.ui.' + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, v: unknown): void {
  try {
    localStorage.setItem('metropolis.ui.' + key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
