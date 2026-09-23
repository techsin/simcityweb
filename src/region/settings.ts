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
}

const KEY = 'metropolis.settings';
export const DEFAULT_SETTINGS: AppSettings = { quality: 'high', autosaveMonths: 6, edgeScroll: false, showFps: false };

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const { autosaveMinutes: _old, ...rest } = JSON.parse(raw) as Partial<AppSettings> & { autosaveMinutes?: number };
      void _old;
      return { ...DEFAULT_SETTINGS, ...rest };
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
