import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CityScene } from '../../src/game/CityScene';
import type { GameContext } from '../../src/game/context';
import { DEFAULT_SETTINGS, loadSettings, resolveMotion, saveSettings, watchMotionPreference } from '../../src/game/settings';
import { A11Y_WIRED, cityOverrides, loadSettings as loadAppSettings, saveSettings as saveAppSettings, takeCityChanges } from '../../src/region/settings';
import { SettingsPanel } from '../../src/ui/panels/SettingsPanel';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
let media: FEl & { matches: boolean };
let store: Map<string, string>;
let abort: AbortController;

beforeEach(() => {
  media = Object.assign(new FEl('media'), { matches: true });
  store = new Map();
  abort = new AbortController();
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
});
afterEach(() => {
  abort.abort();
  vi.unstubAllGlobals();
});

describe('FEEL-21 motion setting', () => {
  it('enables the existing title row and safely loads old or invalid settings with the device default', () => {
    expect(A11Y_WIRED.motion).toBe(true);
    for (const old of [{ quality: 'medium' }, { motion: 'invalid' }]) {
      store.set('metropolis.settings', JSON.stringify(old));
      store.set('metropolis.settings.v1', JSON.stringify(old));
      expect(loadAppSettings().motion).toBe('system');
      expect(loadSettings().motion).toBe('system');
      expect(resolveMotion(loadSettings().motion)).toBe('reduced');
    }
  });

  it('persists explicit choices in both stores, and system keeps following later OS changes', () => {
    for (const motion of ['full', 'reduced', 'system'] as const) {
      const city = { ...DEFAULT_SETTINGS, motion };
      saveSettings(city);
      const app = loadAppSettings();
      takeCityChanges(app, city);
      saveAppSettings(app);
      expect(loadSettings().motion).toBe(motion);
      expect(loadSettings(cityOverrides(loadAppSettings())).motion).toBe(motion);
    }
    expect(resolveMotion('system')).toBe('reduced');
    media.matches = false;
    expect(resolveMotion('system')).toBe('full');
    expect(resolveMotion('reduced')).toBe('reduced');
    media.matches = true;
    expect(resolveMotion('full')).toBe('full');
  });

  it('removes device listeners with the city, including an already aborted city', () => {
    const changed = vi.fn();
    watchMotionPreference(abort.signal, changed);
    media.fire('change');
    expect(changed).toHaveBeenCalledTimes(1);
    abort.abort();
    expect(media.listenerCount('change')).toBe(0);
    media.fire('change');
    watchMotionPreference(abort.signal, changed);
    expect(media.listenerCount('change')).toBe(0);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('shows Reduced for the OS default in its own section, applies and saves choices immediately', () => {
    const settings = loadSettings();
    const applySettings = vi.fn((patch) => {
      Object.assign(settings, patch);
      saveSettings(settings);
    });
    const panel = new SettingsPanel({ settings, applySettings, signal: abort.signal, mods: {}, sound: () => undefined } as unknown as GameContext);
    panel.mount(() => undefined, () => undefined, () => undefined);
    const body = panel.body as unknown as FEl;
    expect(body.querySelectorAll('.sec-title').find((el) => el.dataset.sec === 'accessibility')?.textContent).toContain('motion & flashing');
    expect(textOf(body)).toContain('Reduced (your device)');
    const control = body.querySelectorAll('.ui-seg').find((el) => el.children.map(textOf).join(',') === 'System,Full,Reduced')!;
    control.children[1].click();
    expect(applySettings).toHaveBeenLastCalledWith({ motion: 'full' });
    expect(loadSettings().motion).toBe('full');
    control.children[0].click();
    media.matches = false;
    media.fire('change');
    expect(textOf(body)).toContain('Full (your device)');
    expect(loadSettings().motion).toBe('system');
  });
});

describe('FEEL-21 live scene effects', () => {
  it('applies to every host without mutating simulation state, and restores full effects', () => {
    const applyMotion = (CityScene.prototype as unknown as { applyMotion: (this: unknown) => void }).applyMotion;
    for (const host of ['local', 'loopback', 'worker']) {
      const uiRoot = new FEl('div');
      uiRoot.className = 'mp-ui';
      const cancel = vi.fn();
      Object.assign(uiRoot, { getAnimations: () => [{ cancel }] });
      const setFlashStrength = vi.fn();
      const showMotion = vi.fn();
      const settings = { ...DEFAULT_SETTINGS };
      const self = { host, uiRoot, settings, world: { controls: { reducedMotion: false } }, objects: { fireworks: { setFlashStrength } }, newYear: { applyMotion: showMotion } };
      applyMotion.call(self);
      expect(uiRoot.classList.contains('reduced-motion')).toBe(true);
      expect(self.world.controls.reducedMotion).toBe(true);
      expect(setFlashStrength).toHaveBeenLastCalledWith(0.5);
      expect(cancel).toHaveBeenCalledTimes(1);
      applyMotion.call(self);
      expect(cancel).toHaveBeenCalledTimes(1);
      settings.motion = 'full';
      applyMotion.call(self);
      expect(uiRoot.classList.contains('reduced-motion')).toBe(false);
      expect(uiRoot.classList.contains('full-motion')).toBe(true);
      expect(self.world.controls.reducedMotion).toBe(false);
      expect(setFlashStrength).toHaveBeenLastCalledWith(1);
      expect(showMotion).toHaveBeenCalledTimes(3);
      expect(self.host).toBe(host);
    }
  });
});
