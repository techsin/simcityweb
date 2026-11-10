/** T058: title Settings recommends the detected graphics tier while preserving the stored choice. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/region/settings';
import { openSettings } from '../../src/region/ui/dialogs';
import { setUiRoot, type Modal } from '../../src/region/ui/modal';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const KEY = 'metropolis.settings';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141';
const MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile';
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

function qualityOptions(): FEl[] {
  dialog = openSettings();
  const field = root.querySelectorAll('.field').find((el) => textOf(el.querySelector('label')!) === 'Default quality');
  if (!field) throw new Error('no graphics quality field');
  return field.querySelectorAll('.seg-item');
}
const title = (option: FEl) => textOf(option.querySelector('.si-t')!);
const isRecommended = (option: FEl) => {
  const sub = option.querySelector('.si-s');
  return sub !== null && textOf(sub) === 'Recommended';
};

describe('title Settings detected graphics recommendation (T058)', () => {
  it.each([
    [4, DESKTOP, 'Medium'],
    [8, DESKTOP, 'High'],
    [16, DESKTOP, 'High'],
    [8, MOBILE, 'Low'],
  ] as const)('%i cores with %s recommends %s without changing saved Ultra', (cores, userAgent, recommended) => {
    vi.stubGlobal('navigator', { hardwareConcurrency: cores, userAgent });
    const saved = JSON.stringify({ ...DEFAULT_SETTINGS, quality: 'ultra' });
    store.set(KEY, saved);
    const options = qualityOptions();
    expect(options.filter(isRecommended).map(title)).toEqual([recommended]);
    expect(options.filter((option) => option.classList.contains('on')).map(title)).toEqual(['Ultra']);
    expect(store.get(KEY)).toBe(saved);
  });
});
