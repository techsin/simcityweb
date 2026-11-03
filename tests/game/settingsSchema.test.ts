/**
 * T036 (docs/POLISH_PLAN.md §7.5): the settings schema. Every new key with its default, a round trip of every key, the
 * settings today's builds stored loading unchanged, unknown keys ignored, and the shared keys between app and city.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS as APP_DEFAULTS,
  SETTINGS_VERSION,
  SHARED_KEYS,
  UI_SCALE,
  cityOverrides,
  loadSettings as loadAppSettings,
  resolveMotion,
  saveSettings as saveAppSettings,
  takeCityChanges,
  type AppSettings,
} from '../../src/region/settings';
import {
  DEFAULT_SETTINGS as GAME_DEFAULTS,
  PAN_SPEED,
  loadSettings as loadGameSettings,
  saveSettings as saveGameSettings,
  type GameSettings,
} from '../../src/game/settings';

const APP = 'metropolis.settings';
const GAME = 'metropolis.settings.v1';
let store: Map<string, string>;
const put = (key: string, v: unknown) => store.set(key, JSON.stringify(v));
const read = (key: string) => JSON.parse(store.get(key) ?? 'null') as Record<string, unknown> | null;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

/** every in-game key away from its default */
const CHANGED: GameSettings = {
  quality: 'low', autoTime: false, fixedHour: 20.25, edgeScroll: true, uiScale: 1.3,
  masterVolume: 0.35, musicVolume: 0.2, sfxVolume: 0.45, ambienceVolume: 0.1, musicPauses: false, muteInBackground: false,
  showGrid: false, showFps: true, autosaveMonths: 12, pauseWhenHidden: false, toasts: false, newYear: 'fireworks', newYearCamera: false,
  emergencyUncovered: 'pause', emergencyAlerts: 'all', emergencyLiveSlowmo: 4.5,
  motion: 'reduced', textSize: 20, colourVision: 'red-green', tips: false, cameraMoments: false, newYearPacing: 'everyYear',
  problemIcons: 'always', yearReview: false, panSpeed: 1.6, invertOrbit: true, keyBindings: { bulldoze: 'KeyX', 'zone:1': 'KeyR' },
};
/** the in-game keys before the polish schema: what today's builds store in 'metropolis.settings.v1' */
const TODAY_KEYS = [
  'quality', 'autoTime', 'fixedHour', 'edgeScroll', 'uiScale', 'masterVolume', 'musicVolume', 'sfxVolume', 'ambienceVolume',
  'musicPauses', 'muteInBackground', 'showGrid', 'showFps', 'autosaveMonths', 'pauseWhenHidden', 'toasts', 'newYear',
  'newYearCamera', 'emergencyUncovered', 'emergencyAlerts', 'emergencyLiveSlowmo',
] as const;
const today = (): Partial<GameSettings> => Object.fromEntries(TODAY_KEYS.map((k) => [k, CHANGED[k]]));

describe('app settings (metropolis.settings): the accessibility keys', () => {
  it('defaults: every key, the new ones with their §7.5 defaults', () => {
    expect(SETTINGS_VERSION).toBe(3);
    expect(APP_DEFAULTS).toEqual({
      quality: 'high', autosaveMonths: 3, edgeScroll: false, showFps: false,
      uiScale: 1, textSize: 0, motion: 'system', colourVision: 'standard', v: SETTINGS_VERSION,
    });
    expect(loadAppSettings()).toEqual(APP_DEFAULTS);
    expect(loadAppSettings()).not.toBe(APP_DEFAULTS);
  });

  it("motion's default follows prefers-reduced-motion, asked on each call", () => {
    let reduce = true;
    const asked: string[] = [];
    vi.stubGlobal('matchMedia', (q: string) => (asked.push(q), { matches: reduce }));
    expect(resolveMotion(APP_DEFAULTS.motion)).toBe('reduced');
    reduce = false;
    expect(resolveMotion('system')).toBe('full');
    expect(asked).toEqual(['(prefers-reduced-motion: reduce)', '(prefers-reduced-motion: reduce)']);
    reduce = true;
    expect(resolveMotion('full')).toBe('full');
    reduce = false;
    expect(resolveMotion('reduced')).toBe('reduced');
    vi.stubGlobal('matchMedia', undefined);
    expect(resolveMotion('system')).toBe('full');
  });

  it('round-trips every key', () => {
    const s: AppSettings = { quality: 'ultra', autosaveMonths: 12, edgeScroll: true, showFps: true, uiScale: 1.35, textSize: 30, motion: 'reduced', colourVision: 'blue-yellow', v: SETTINGS_VERSION };
    for (const k of Object.keys(APP_DEFAULTS) as (keyof AppSettings)[]) if (k !== 'v') expect(s[k], k).not.toEqual(APP_DEFAULTS[k]);
    saveAppSettings(s);
    expect(read(APP)).toEqual(s);
    expect(loadAppSettings()).toEqual(s);
  });

  it("loads today's stored settings unchanged, the new keys at their defaults", () => {
    const stored = { quality: 'medium', autosaveMonths: 12, edgeScroll: true, showFps: true, v: 2 };
    put(APP, stored);
    expect(loadAppSettings()).toEqual({ ...APP_DEFAULTS, ...stored, v: SETTINGS_VERSION });
    // a v2 store's 6 months was the player's choice
    put(APP, { ...stored, autosaveMonths: 6 });
    expect(loadAppSettings().autosaveMonths).toBe(6);
  });

  it('keeps the earlier migrations: v1 autosave 6 -> 3, v0 autosaveMinutes dropped', () => {
    put(APP, { quality: 'low', autosaveMonths: 6, edgeScroll: false, showFps: true });
    expect(loadAppSettings()).toEqual({ ...APP_DEFAULTS, quality: 'low', showFps: true, autosaveMonths: 3 });
    put(APP, { quality: 'low', autosaveMonths: 12, edgeScroll: false, showFps: false });
    expect(loadAppSettings().autosaveMonths).toBe(12);
    put(APP, { quality: 'high', autosaveMinutes: 5, edgeScroll: true, showFps: false });
    const v0 = loadAppSettings();
    expect(v0).not.toHaveProperty('autosaveMinutes');
    expect(v0).toEqual({ ...APP_DEFAULTS, edgeScroll: true });
  });

  it('carries a UI scale set in the city (the in-game store) over until the app store has its own', () => {
    put(GAME, { ...today(), uiScale: 1.25 });
    expect(loadAppSettings().uiScale).toBe(1.25);
    put(APP, { quality: 'high', autosaveMonths: 3, edgeScroll: false, showFps: false, v: 2 });
    expect(loadAppSettings().uiScale).toBe(1.25);
    put(APP, { ...APP_DEFAULTS, uiScale: 0.9 });
    expect(loadAppSettings().uiScale).toBe(0.9);
    store.delete(APP);
    put(GAME, { uiScale: 'big' });
    expect(loadAppSettings().uiScale).toBe(1);
  });

  it('ignores unknown keys, wrong types and invalid accessibility values', () => {
    put(APP, { quality: 'low', bogus: 1, retired: { on: true }, showFps: 'yes', autosaveMonths: null, textSize: 25, motion: 'off', colourVision: 'protanopia', uiScale: '120%' });
    const s = loadAppSettings();
    expect(s).not.toHaveProperty('bogus');
    expect(s).not.toHaveProperty('retired');
    expect(s).toEqual({ ...APP_DEFAULTS, quality: 'low' });
  });

  it('clamps a UI scale outside the slider range', () => {
    put(APP, { ...APP_DEFAULTS, uiScale: 9 });
    expect(loadAppSettings().uiScale).toBe(UI_SCALE.max);
    put(APP, { ...APP_DEFAULTS, uiScale: 0.1 });
    expect(loadAppSettings().uiScale).toBe(UI_SCALE.min);
  });

  it('falls back to the defaults on corrupt JSON or unavailable storage', () => {
    store.set(APP, '{not json');
    expect(loadAppSettings()).toEqual(APP_DEFAULTS);
    store.set(APP, '[1,2]');
    expect(loadAppSettings()).toEqual(APP_DEFAULTS);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(loadAppSettings()).toEqual(APP_DEFAULTS);
    expect(() => saveAppSettings(APP_DEFAULTS)).not.toThrow();
  });

  it('hands the shared keys to the city, which opens with them, and takes valid changes back', () => {
    const app: AppSettings = { ...APP_DEFAULTS, quality: 'low', uiScale: 1.2, textSize: 20, motion: 'reduced', colourVision: 'red-green' };
    const o = cityOverrides(app);
    expect(Object.keys(o).sort()).toEqual([...SHARED_KEYS].sort());
    expect(o).toEqual({ quality: 'low', autosaveMonths: 3, edgeScroll: false, showFps: false, uiScale: 1.2, textSize: 20, motion: 'reduced', colourVision: 'red-green' });
    put(GAME, { ...today(), uiScale: 0.8, quality: 'ultra' });
    const city = loadGameSettings(o);
    expect(city).toMatchObject(o);
    const changed = { ...city, uiScale: 1.45, showFps: true, textSize: 30, colourVision: 'purple' };
    takeCityChanges(app, changed);
    expect(app).toEqual({ ...APP_DEFAULTS, quality: 'low', showFps: true, uiScale: 1.45, textSize: 30, motion: 'reduced', colourVision: 'red-green' });
    expect(app).not.toHaveProperty('toasts');
  });

  it('main.ts passes the shared keys to CityScene and takes the in-game panel changes back', () => {
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('settings: cityOverrides(this.settings),');
    expect(main).toMatch(/onSettingsChange: \(gs\) => \{[^}]*takeCityChanges\(this\.settings, gs\);\s*saveSettings\(this\.settings\);/);
  });
});

describe('in-game settings (metropolis.settings.v1): the other §7.5 keys', () => {
  it('defaults: the new keys with their §7.5 defaults; the accessibility copies match the app defaults', () => {
    expect(loadGameSettings()).toEqual(GAME_DEFAULTS);
    expect(GAME_DEFAULTS).toMatchObject({
      tips: true, cameraMoments: true, musicPauses: true, muteInBackground: true, newYearPacing: 'milestones', uiScale: 1,
      problemIcons: 'query', yearReview: true, panSpeed: 1, invertOrbit: false, keyBindings: {},
    });
    expect(GAME_DEFAULTS).toMatchObject({ motion: APP_DEFAULTS.motion, textSize: APP_DEFAULTS.textSize, colourVision: APP_DEFAULTS.colourVision, uiScale: APP_DEFAULTS.uiScale });
  });

  it('round-trips every key', () => {
    expect(Object.keys(CHANGED).sort()).toEqual(Object.keys(GAME_DEFAULTS).sort());
    for (const k of Object.keys(GAME_DEFAULTS) as (keyof GameSettings)[]) expect(CHANGED[k], k).not.toEqual(GAME_DEFAULTS[k]);
    saveGameSettings(CHANGED);
    expect(loadGameSettings()).toEqual(CHANGED);
  });

  it("loads today's stored settings unchanged, the new keys at their defaults", () => {
    put(GAME, today());
    expect(loadGameSettings()).toEqual({ ...GAME_DEFAULTS, ...today() });
  });

  it("loads an older build's settings (before T008's audio flags) with those flags on", () => {
    const { musicPauses: _p, muteInBackground: _m, ...older } = today();
    put(GAME, older);
    expect(loadGameSettings()).toEqual({ ...GAME_DEFAULTS, ...older });
    expect(loadGameSettings()).toMatchObject({ musicPauses: true, muteInBackground: true });
  });

  it('ignores unknown keys, wrong types and invalid values of the new keys', () => {
    put(GAME, {
      musicPauses: false, bogus: 1, uiSounds: false, quality: 7, toasts: 'no', tips: 'on', newYearPacing: 'sometimes', problemIcons: true,
      panSpeed: 'fast', textSize: 15, motion: 'none', colourVision: 'deuteranopia', keyBindings: 'KeyX',
    });
    const s = loadGameSettings();
    expect(s).not.toHaveProperty('bogus');
    expect(s).not.toHaveProperty('uiSounds');
    expect(s).toEqual({ ...GAME_DEFAULTS, musicPauses: false });
  });

  it('clamps the pan speed into its range and keeps only string key bindings', () => {
    put(GAME, { panSpeed: 7, keyBindings: { bulldoze: 'KeyX', rotate: 3, zone: null } });
    expect(loadGameSettings()).toMatchObject({ panSpeed: PAN_SPEED.max, keyBindings: { bulldoze: 'KeyX' } });
    expect(loadGameSettings().keyBindings).toEqual({ bulldoze: 'KeyX' });
    put(GAME, { panSpeed: 0, keyBindings: ['KeyX'] });
    expect(loadGameSettings()).toMatchObject({ panSpeed: PAN_SPEED.min, keyBindings: {} });
  });

  it("lets the app-level overrides win over the stored values (CityScene's settings option)", () => {
    put(GAME, { ...today(), quality: 'ultra', uiScale: 0.8 });
    expect(loadGameSettings({ quality: 'medium', uiScale: 1.2, motion: 'reduced' })).toMatchObject({ quality: 'medium', uiScale: 1.2, motion: 'reduced' });
  });

  it('gives every loaded settings object its own key bindings', () => {
    put(GAME, { keyBindings: { bulldoze: 'KeyX' } });
    const a = loadGameSettings(), b = loadGameSettings();
    a.keyBindings.rotate = 'KeyT';
    expect(b.keyBindings).toEqual({ bulldoze: 'KeyX' });
    store.clear();
    loadGameSettings().keyBindings.rotate = 'KeyT';
    expect(GAME_DEFAULTS.keyBindings).toEqual({});
    expect(Object.isFrozen(GAME_DEFAULTS.keyBindings)).toBe(true);
  });
});
