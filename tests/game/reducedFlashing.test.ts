import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, reducedFlashing, saveSettings } from '../../src/game/settings';

let reduce: boolean;
let store: Map<string, string>;
const KEY = 'metropolis.settings.v1';

beforeEach(() => {
  reduce = true;
  store = new Map();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduce })));
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void store.set(key, value)),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('FEEL-21 live flashing preference', () => {
  it('follows the OS default on each read without reloading the settings', () => {
    const settings = loadSettings();
    expect(settings.motion).toBe('system');
    expect(reducedFlashing(settings)).toBe(true);
    reduce = false;
    expect(reducedFlashing(settings)).toBe(false);
    reduce = true;
    expect(reducedFlashing(settings)).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('applies explicit choices immediately and lets them override the OS', () => {
    const settings = { ...DEFAULT_SETTINGS };
    settings.motion = 'full';
    expect(reducedFlashing(settings)).toBe(false);
    reduce = false;
    settings.motion = 'reduced';
    expect(reducedFlashing(settings)).toBe(true);
    expect(matchMedia).not.toHaveBeenCalled();
  });

  it('loads old settings safely and persists only the existing motion key', () => {
    for (const old of [{ quality: 'medium' }, { motion: 'invalid' }]) {
      store.set(KEY, JSON.stringify(old));
      const settings = loadSettings();
      expect(settings.motion).toBe('system');
      expect(reducedFlashing(settings)).toBe(true);
      settings.motion = 'reduced';
      saveSettings(settings);
      const stored = JSON.parse(store.get(KEY)!);
      expect(stored.motion).toBe('reduced');
      expect(stored).not.toHaveProperty('reducedFlashing');
      expect(reducedFlashing(loadSettings())).toBe(true);
    }
  });

  it('only reads its input and does not read or write storage', () => {
    const settings = Object.freeze({ motion: 'system' as const });
    expect(reducedFlashing(settings)).toBe(true);
    expect(settings).toEqual({ motion: 'system' });
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('uses full flashing when the OS preference cannot be read', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(reducedFlashing({ motion: 'system' })).toBe(false);
    vi.stubGlobal('matchMedia', () => { throw new Error('unavailable'); });
    expect(reducedFlashing({ motion: 'system' })).toBe(false);
    expect(reducedFlashing({ motion: 'reduced' })).toBe(true);
  });
});
