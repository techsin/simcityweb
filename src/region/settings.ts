/** App-level settings (persisted in localStorage 'metropolis.settings'), passed to CityScene as `settings`. */
import type { QualityLevel } from '../render/contracts';

export interface AppSettings {
  /** default graphics quality */
  quality: QualityLevel;
  /** autosave interval in GAME months (0 = off) — performed by CityScene (GameSettings.autosaveMonths) */
  autosaveMonths: number;
  /** scroll the camera when the mouse touches the screen edge */
  edgeScroll: boolean;
  /** show an FPS counter */
  showFps: boolean;
  /** settings format version (2: autosave default 6 -> 3 months) */
  v?: number;
}

const KEY = 'metropolis.settings';
export const SETTINGS_VERSION = 2;
export const DEFAULT_SETTINGS: AppSettings = { quality: 'high', autosaveMonths: 3, edgeScroll: false, showFps: false, v: SETTINGS_VERSION };

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const { autosaveMinutes: _old, ...rest } = JSON.parse(raw) as Partial<AppSettings> & { autosaveMinutes?: number };
      void _old;
      // v1 stored the old default (6 months) whether or not the player chose it: move it to the new default
      if ((rest.v ?? 1) < 2 && rest.autosaveMonths === 6) rest.autosaveMonths = DEFAULT_SETTINGS.autosaveMonths;
      return { ...DEFAULT_SETTINGS, ...rest, v: SETTINGS_VERSION };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
