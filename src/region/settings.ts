/**
 * App-level settings (persisted in localStorage 'metropolis.settings'), passed to CityScene as `settings`.
 * The accessibility keys (uiScale, textSize, motion, colourVision: docs/POLISH_PLAN.md §7.5) live here, so the title, region
 * and New City screens can apply them before any city exists; a city reads them with the other shared keys (cityOverrides)
 * and hands its changes back (takeCityChanges). The other §7.5 keys are in-game settings (src/game/settings.ts), except
 * disasterRate and crises (per-city config, src/sim/config.ts, with LG-15 and LG-25) and the first-run quality (FH-21).
 */
import type { QualityLevel } from '../render/contracts';

/** extra text size in percent, on top of the UI zoom (FH-23) */
export type TextSize = 0 | 10 | 20 | 30;
/** animation and flashing: as the device asks (prefers-reduced-motion), or always full / reduced (FEEL-21) */
export type MotionPref = 'system' | 'full' | 'reduced';
/** colour-blind safe palettes (FH-20); the names match EmergencyColourVision in src/render/world/overlays.ts */
export type ColourVision = 'standard' | 'red-green' | 'blue-yellow';

export const TEXT_SIZES: readonly TextSize[] = [0, 10, 20, 30];
export const MOTION_PREFS: readonly MotionPref[] = ['system', 'full', 'reduced'];
export const COLOUR_VISIONS: readonly ColourVision[] = ['standard', 'red-green', 'blue-yellow'];
/** the UI scale slider (title screen and in-city panel) */
export const UI_SCALE = { min: 0.7, max: 1.5, step: 0.05 } as const;

export interface AppSettings {
  /** default graphics quality */
  quality: QualityLevel;
  /** autosave interval in GAME months (0 = off) — performed by CityScene (GameSettings.autosaveMonths) */
  autosaveMonths: number;
  /** scroll the camera when the mouse touches the screen edge */
  edgeScroll: boolean;
  /** show an FPS counter */
  showFps: boolean;
  /** UI scale multiplier on top of the automatic resolution scaling (FH-23; before v3 only in the in-game settings) */
  uiScale: number;
  /** text size: +0, +10, +20 or +30 % (FH-23) */
  textSize: TextSize;
  /** motion and flashing (FEEL-21); 'system' follows prefers-reduced-motion (resolveMotion) */
  motion: MotionPref;
  /** colour vision palette (FH-20) */
  colourVision: ColourVision;
  /** settings format version (2: autosave default 6 -> 3 months; 3: the accessibility keys, uiScale moved here) */
  v?: number;
}

/** the keys a city has too: CityScene takes them as overrides of its stored in-game settings and reports changes back */
export const SHARED_KEYS = ['quality', 'autosaveMonths', 'edgeScroll', 'showFps', 'uiScale', 'textSize', 'motion', 'colourVision'] as const;
export type SharedKey = (typeof SHARED_KEYS)[number];

const KEY = 'metropolis.settings';
/** where uiScale was stored before v3: the in-game settings (src/game/settings.ts) */
const LEGACY_UI_SCALE_KEY = 'metropolis.settings.v1';
export const SETTINGS_VERSION = 3;
export const DEFAULT_SETTINGS: AppSettings = {
  quality: 'high', autosaveMonths: 3, edgeScroll: false, showFps: false,
  uiScale: 1, textSize: 0, motion: 'system', colourVision: 'standard', v: SETTINGS_VERSION,
};

/** a stored value to keep, or undefined to use the default */
export type SettingCheck = (v: unknown) => unknown;
const oneOf = (list: readonly unknown[]): SettingCheck => (v) => (list.includes(v) ? v : undefined);
const within = (min: number, max: number): SettingCheck => (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
/** the accessibility keys' checks (GameSettings checks its copies of them the same way) */
export const ACCESSIBILITY_CHECKS: Readonly<Record<'uiScale' | 'textSize' | 'motion' | 'colourVision', SettingCheck>> = {
  uiScale: within(UI_SCALE.min, UI_SCALE.max),
  textSize: oneOf(TEXT_SIZES),
  motion: oneOf(MOTION_PREFS),
  colourVision: oneOf(COLOUR_VISIONS),
};

type Key = Exclude<keyof AppSettings, 'v'>;
const KEYS = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'v') as Key[];
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** set `key` from a stored value: the accessibility keys must pass their check, the older ones have the default's type */
function assign(s: AppSettings, key: Key, v: unknown): void {
  if (v === undefined) return;
  const check = (ACCESSIBILITY_CHECKS as Partial<Record<Key, SettingCheck>>)[key];
  const ok = check ? check(v) : typeof v === typeof DEFAULT_SETTINGS[key] ? v : undefined;
  if (ok !== undefined) (s as unknown as Record<string, unknown>)[key] = ok;
}

function legacyUiScale(): unknown {
  try {
    const raw = localStorage.getItem(LEGACY_UI_SCALE_KEY);
    return raw ? record(JSON.parse(raw)).uiScale : undefined;
  } catch {
    return undefined;
  }
}

export function loadSettings(): AppSettings {
  let stored: Record<string, unknown> | null = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) stored = record(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  const s: AppSettings = { ...DEFAULT_SETTINGS };
  if (stored) {
    // known keys only: unknown ones (v0's autosaveMinutes among them) are ignored
    for (const k of KEYS) assign(s, k, stored[k]);
    // v1 stored the old default (6 months) whether or not the player chose it: move it to the new default
    if (Number(stored.v ?? 1) < 2 && stored.autosaveMonths === 6) s.autosaveMonths = DEFAULT_SETTINGS.autosaveMonths;
  }
  // uiScale moved here in v3: a scale set in the city before keeps applying
  if (stored?.uiScale === undefined) assign(s, 'uiScale', legacyUiScale());
  s.v = SETTINGS_VERSION;
  return s;
}

export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** the shared keys for CityScene's `settings` (they win over its stored in-game settings) */
export function cityOverrides(s: AppSettings): Pick<AppSettings, SharedKey> {
  const o: Partial<Record<SharedKey, unknown>> = {};
  for (const k of SHARED_KEYS) o[k] = s[k];
  return o as Pick<AppSettings, SharedKey>;
}

/** take the shared keys back from the city's settings after a change in the in-game panel (invalid values are ignored) */
export function takeCityChanges(s: AppSettings, city: Partial<Record<SharedKey, unknown>>): void {
  for (const k of SHARED_KEYS) assign(s, k, city[k]);
}

/** 'system' resolved with the device's prefers-reduced-motion (asked on each call: it can change while the game runs) */
export function resolveMotion(m: MotionPref): 'full' | 'reduced' {
  if (m !== 'system') return m;
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
  } catch {
    return 'full';
  }
}
