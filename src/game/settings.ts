/** Player settings (persisted in localStorage). */
import type { QualityLevel } from '../render/contracts';

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
}

export type NewYearMode = 'cinematic' | 'fireworks' | 'off';

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
  showGrid: true,
  showFps: false,
  autosaveMonths: 6,
  pauseWhenHidden: true,
  toasts: true,
  newYear: 'cinematic',
};

const KEY = 'metropolis.settings.v1';

export function loadSettings(overrides: Partial<GameSettings> = {}): GameSettings {
  let stored: Partial<GameSettings> = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) stored = JSON.parse(raw) as Partial<GameSettings>;
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS, ...stored, ...overrides };
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
