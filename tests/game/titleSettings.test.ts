/**
 * T036 (§7.5, FH-23): the title screen's Settings gets an "Accessibility & interface" section. Its controls show the stored
 * app settings, write each change to the store at once, and "Reset to defaults" restores only what the section shows.
 * NOTE-042: text size, motion and colour vision stay hidden until each one works (FH-23, FEEL-21, FH-20); their keys,
 * defaults and stored values stay, and still reach the city.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSettings as loadGameSettings } from '../../src/game/settings';
import { DEFAULT_SETTINGS, UI_SCALE, cityOverrides, loadSettings, type AppSettings } from '../../src/region/settings';
import { openSettings } from '../../src/region/ui/dialogs';
import { setUiRoot, type Modal } from '../../src/region/ui/modal';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const KEY = 'metropolis.settings';
let store: Map<string, string>;
let root: FEl;
let dialog: Modal | null = null;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('Node', FNode);
  vi.stubGlobal('window', new FEl('window'));
  root = new FEl('div');
  setUiRoot(root as unknown as HTMLElement);
});
afterEach(() => {
  dialog?.close(true);
  dialog = null;
  vi.unstubAllGlobals();
});

/** open the title screen's Settings and return its "Accessibility & interface" section */
function openSection(onChange?: (s: AppSettings) => void): FEl {
  dialog = openSettings(onChange);
  expect(root.querySelectorAll('.section-title').map((e) => textOf(e))).toEqual(['Audio', 'Graphics', 'Accessibility & interface', 'Gameplay']);
  const sec = root.querySelector('.a11y-settings');
  if (!sec) throw new Error('no accessibility section');
  return sec;
}
const scaleInput = (sec: FEl): FEl => sec.querySelector('.slider')!.querySelector('input')!;
const resetButton = (sec: FEl): FEl => {
  const b = sec.querySelectorAll('button').find((e) => textOf(e) === 'Reset to defaults');
  if (!b) throw new Error('no reset button');
  return b;
};
/** the section holds the UI scale slider and Reset only: no text size, motion or colour vision control */
function expectOnlyUiScale(sec: FEl): void {
  expect(sec.querySelectorAll('.slider')).toHaveLength(1);
  expect(sec.querySelectorAll('label')).toEqual([]);
  expect(sec.querySelectorAll('.seg-item')).toEqual([]);
  expect(sec.querySelectorAll('button').map((b) => textOf(b))).toEqual(['Reset to defaults']);
  expect(textOf(sec)).not.toMatch(/Text size|Motion|Colour vision/);
}
const stored = () => JSON.parse(store.get(KEY) ?? 'null') as Record<string, unknown> | null;
/** a profile that set the hidden keys in a step-1 build */
const HIDDEN_SET = { textSize: 20, motion: 'reduced', colourVision: 'blue-yellow' } as const;

describe('title screen Settings: Accessibility & interface', () => {
  it('sits between Graphics and Gameplay and shows the stored UI scale; text size, motion and colour vision are hidden (NOTE-042)', () => {
    store.set(KEY, JSON.stringify({ ...DEFAULT_SETTINGS, uiScale: 1.2, ...HIDDEN_SET }));
    const sec = openSection();
    expectOnlyUiScale(sec);
    const slider = sec.querySelector('.slider')!;
    expect(textOf(slider.querySelector('.field-label')!)).toBe('UI scale120%');
    expect([scaleInput(sec).min, scaleInput(sec).max, scaleInput(sec).step]).toEqual([UI_SCALE.min, UI_SCALE.max, UI_SCALE.step].map(String));
    expect(scaleInput(sec).value).toBe('1.2');
    // opening the dialog writes nothing
    expect(store.get(KEY)).toBe(JSON.stringify({ ...DEFAULT_SETTINGS, uiScale: 1.2, ...HIDDEN_SET }));
  });

  it('opens on the defaults on a fresh profile and writes nothing until a control is used', () => {
    const sec = openSection();
    expectOnlyUiScale(sec);
    expect(scaleInput(sec).value).toBe('1');
    expect(store.has(KEY)).toBe(false);
  });

  it('writes a UI scale change to the store at once and reports it; the next city opens with it and the hidden keys', () => {
    store.set(KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...HIDDEN_SET }));
    const onChange = vi.fn();
    const sec = openSection(onChange);
    const input = scaleInput(sec);
    input.value = '1.25';
    input.fire('input');
    expect(stored()).toEqual({ ...DEFAULT_SETTINGS, ...HIDDEN_SET, uiScale: 1.25 });
    expect(textOf(sec.querySelector('.fl-val')!)).toBe('125%');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.lastCall?.[0]).toEqual(stored());
    const app = loadSettings();
    expect(app).toMatchObject({ uiScale: 1.25, ...HIDDEN_SET });
    expect(loadGameSettings(cityOverrides(app))).toMatchObject({ uiScale: 1.25, ...HIDDEN_SET });
  });

  it('Reset to defaults restores the UI scale and leaves the hidden keys and the other settings alone', () => {
    const before = { ...DEFAULT_SETTINGS, quality: 'low', autosaveMonths: 12, showFps: true, uiScale: 1.4, ...HIDDEN_SET };
    store.set(KEY, JSON.stringify(before));
    const onChange = vi.fn();
    const sec = openSection(onChange);
    const reset = resetButton(sec);
    expect(reset.title).toBe('UI scale');
    reset.click();
    expect(stored()).toEqual({ ...before, uiScale: DEFAULT_SETTINGS.uiScale });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(scaleInput(sec).value).toBe('1');
    expect(textOf(sec.querySelector('.fl-val')!)).toBe('100%');
  });
});
