/** NOTE-042: the guide profile owns tips, including the Settings switch. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { DEFAULT_SETTINGS, loadSettings } from '../../src/game/settings';
import { loadGuideProfile, saveGuideProfile } from '../../src/ui/guide/progress';
import { getGuideTips, setGuideTips, watchGuideTips } from '../../src/ui/guide/tips';
import { SettingsPanel } from '../../src/ui/panels/SettingsPanel';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const lifetimes: AbortController[] = [];
let stored: Map<string, string>;
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
});
afterEach(() => {
  for (const lifetime of lifetimes.splice(0)) lifetime.abort();
  vi.unstubAllGlobals();
});
const lifetime = () => { const abort = new AbortController(); lifetimes.push(abort); return abort; };

function settings() {
  const abort = lifetime(), applySettings = vi.fn();
  const ctx = { settings: loadSettings(), applySettings, signal: abort.signal, mods: {}, world: { timeOfDay: 12 } } as unknown as GameContext;
  const panel = new SettingsPanel(ctx);
  panel.mount(() => {}, () => {}, () => {});
  const el = panel.el as unknown as FEl;
  const row = el.querySelectorAll('.set-row').find((r) => textOf(r.querySelector('.sr-l')!) === 'Tips')!;
  return { abort, panel, applySettings, toggle: row.querySelector('.ui-switch')! };
}

describe('guide tips profile API', () => {
  it('defaults on and ignores the retired game-settings key', () => {
    stored.set('metropolis.settings.v1', JSON.stringify({ tips: false, quality: 'low' }));
    expect(DEFAULT_SETTINGS).not.toHaveProperty('tips');
    expect(loadSettings()).not.toHaveProperty('tips');
    expect(loadSettings().quality).toBe('low');
    expect(getGuideTips()).toBe(true);
    stored.set('metropolis.ui.onboarding', JSON.stringify({ tips: false }));
    expect(getGuideTips()).toBe(false);
  });

  it('preserves fresh profile fields when changing tips', () => {
    const profile = { ...loadGuideProfile(), veteran: true, min: true, dismissedAll: true, seenExplainers: ['E7', 'E12'] };
    saveGuideProfile(profile);
    setGuideTips(false);
    expect(loadGuideProfile()).toEqual({ ...profile, tips: false });
    const newer = { ...loadGuideProfile(), seenExplainers: [...profile.seenExplainers, 'E8'] };
    saveGuideProfile(newer);
    setGuideTips(true);
    expect(loadGuideProfile()).toEqual({ ...newer, tips: true });
  });

  it('notifies active subscribers only on a change and releases each subscription independently', () => {
    const first = lifetime(), second = lifetime(), notify = vi.fn();
    const off = watchGuideTips(notify, first.signal);
    watchGuideTips(notify, second.signal);
    setGuideTips(false);
    expect(notify.mock.calls).toEqual([[false], [false]]);
    setGuideTips(false);
    expect(notify).toHaveBeenCalledTimes(2);
    off(); setGuideTips(true);
    expect(notify.mock.calls.at(-1)).toEqual([true]);
    expect(notify).toHaveBeenCalledTimes(3);
    second.abort(); setGuideTips(false);
    expect(notify).toHaveBeenCalledTimes(3);
    watchGuideTips(notify, second.signal); setGuideTips(true);
    expect(notify).toHaveBeenCalledTimes(3);
  });
});

describe('Settings tips switch', () => {
  it('reads and changes the profile without writing GameSettings, and follows same-page changes', () => {
    setGuideTips(false);
    const f = settings();
    expect(f.toggle.classList.contains('on')).toBe(false);
    expect(f.toggle.getAttribute('aria-checked')).toBe('false');
    f.toggle.click();
    expect(getGuideTips()).toBe(true);
    expect(f.applySettings).not.toHaveBeenCalled();
    expect(stored.has('metropolis.settings.v1')).toBe(false);
    setGuideTips(false);
    expect(f.toggle.classList.contains('on')).toBe(false);
    expect(f.toggle.getAttribute('aria-checked')).toBe('false');
    setGuideTips(true);
    expect(f.toggle.classList.contains('on')).toBe(true);
    expect(f.toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('removes the switch listener and profile subscription with the city signal', () => {
    const f = settings();
    f.abort.abort();
    expect(f.toggle.listenerCount('click')).toBe(0);
    setGuideTips(false);
    expect(f.toggle.classList.contains('on')).toBe(true);
    f.toggle.click();
    expect(getGuideTips()).toBe(false);
  });
});
