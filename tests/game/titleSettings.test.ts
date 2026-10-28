/**
 * T036 (§7.5, FH-23): the title screen's Settings gets an "Accessibility & interface" section. Its controls show the stored
 * app settings, write each change to the store at once, and "Reset to defaults" restores only their four keys.
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
let reduce = false;
let dialog: Modal | null = null;

beforeEach(() => {
  store = new Map();
  reduce = false;
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('Node', FNode);
  vi.stubGlobal('window', new FEl('window'));
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q === '(prefers-reduced-motion: reduce)' }));
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
function option(sec: FEl, title: string): FEl {
  const b = sec.querySelectorAll('.seg-item').find((e) => textOf(e.querySelector('.si-t')!) === title);
  if (!b) throw new Error(`no option "${title}"`);
  return b;
}
/** the selected option of the field labelled `label` */
function selected(sec: FEl, label: string): string {
  const field = sec.querySelectorAll('.field').find((f) => textOf(f.querySelector('label')!) === label);
  const on = field?.querySelectorAll('.seg-item.on') ?? [];
  expect(on).toHaveLength(1);
  return textOf(on[0].querySelector('.si-t')!);
}
const stored = () => JSON.parse(store.get(KEY) ?? 'null') as Record<string, unknown> | null;

describe('title screen Settings: Accessibility & interface', () => {
  it('sits between Graphics and Gameplay and shows the stored values', () => {
    store.set(KEY, JSON.stringify({ ...DEFAULT_SETTINGS, uiScale: 1.2, textSize: 20, motion: 'reduced', colourVision: 'blue-yellow' }));
    const sec = openSection();
    expect(sec.querySelectorAll('label').map((e) => textOf(e))).toEqual(['Text size', 'Motion', 'Colour vision']);
    const slider = sec.querySelector('.slider')!;
    expect(textOf(slider.querySelector('.field-label')!)).toBe('UI scale120%');
    expect([scaleInput(sec).min, scaleInput(sec).max, scaleInput(sec).step]).toEqual([UI_SCALE.min, UI_SCALE.max, UI_SCALE.step].map(String));
    expect(scaleInput(sec).value).toBe('1.2');
    expect(sec.querySelectorAll('.seg-item').map((e) => textOf(e.querySelector('.si-t')!))).toEqual([
      'Default', '+10%', '+20%', '+30%', 'System', 'Full', 'Reduced', 'Standard', 'Red-green safe', 'Blue-yellow safe',
    ]);
    expect(selected(sec, 'Text size')).toBe('+20%');
    expect(selected(sec, 'Motion')).toBe('Reduced');
    expect(selected(sec, 'Colour vision')).toBe('Blue-yellow safe');
    expect(store.get(KEY)).toBe(JSON.stringify({ ...DEFAULT_SETTINGS, uiScale: 1.2, textSize: 20, motion: 'reduced', colourVision: 'blue-yellow' }));
  });

  it('opens on the defaults on a fresh profile and writes nothing until a control is used', () => {
    const sec = openSection();
    expect(scaleInput(sec).value).toBe('1');
    expect(selected(sec, 'Text size')).toBe('Default');
    expect(selected(sec, 'Motion')).toBe('System');
    expect(selected(sec, 'Colour vision')).toBe('Standard');
    expect(store.has(KEY)).toBe(false);
  });

  it('writes each change to the store at once and reports it; the next city opens with them', () => {
    const onChange = vi.fn();
    const sec = openSection(onChange);
    const input = scaleInput(sec);
    input.value = '1.25';
    input.fire('input');
    expect(stored()).toMatchObject({ uiScale: 1.25 });
    expect(textOf(sec.querySelector('.fl-val')!)).toBe('125%');
    option(sec, '+30%').click();
    expect(stored()).toMatchObject({ textSize: 30 });
    option(sec, 'Reduced').click();
    expect(stored()).toMatchObject({ motion: 'reduced' });
    option(sec, 'Red-green safe').click();
    expect(stored()).toEqual({ ...DEFAULT_SETTINGS, uiScale: 1.25, textSize: 30, motion: 'reduced', colourVision: 'red-green' });
    expect(selected(sec, 'Colour vision')).toBe('Red-green safe');
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(onChange.mock.lastCall?.[0]).toEqual(stored());
    const app = loadSettings();
    expect(app).toMatchObject({ uiScale: 1.25, textSize: 30, motion: 'reduced', colourVision: 'red-green' });
    expect(loadGameSettings(cityOverrides(app))).toMatchObject({ uiScale: 1.25, textSize: 30, motion: 'reduced', colourVision: 'red-green' });
  });

  it('Reset to defaults restores the four keys and leaves the other settings alone', () => {
    store.set(KEY, JSON.stringify({ ...DEFAULT_SETTINGS, quality: 'low', autosaveMonths: 12, showFps: true, uiScale: 1.4, textSize: 10, motion: 'full', colourVision: 'red-green' }));
    const onChange = vi.fn();
    const sec = openSection(onChange);
    const reset = sec.querySelectorAll('button').find((b) => textOf(b) === 'Reset to defaults');
    expect(reset?.title).toBe('UI scale, text size, motion and colour vision');
    reset!.click();
    expect(stored()).toEqual({ ...DEFAULT_SETTINGS, quality: 'low', autosaveMonths: 12, showFps: true });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(scaleInput(sec).value).toBe('1');
    expect(textOf(sec.querySelector('.fl-val')!)).toBe('100%');
    expect(selected(sec, 'Text size')).toBe('Default');
    expect(selected(sec, 'Motion')).toBe('System');
    expect(selected(sec, 'Colour vision')).toBe('Standard');
  });

  it.each([[true, 'reduced'], [false, 'full']])('names the device preference under "System" (reduced motion on: %s)', (on, word) => {
    reduce = on;
    const sec = openSection();
    expect(textOf(option(sec, 'System').querySelector('.si-s')!)).toBe(`Your device: ${word}`);
    expect(selected(sec, 'Motion')).toBe('System');
  });
});
