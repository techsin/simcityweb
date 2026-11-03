/** NEW-04: persistence needs the actual Found click's user activation, before its promise resumes in App. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModalOptions } from '../../src/region/ui/modal';
import { openNewCityDialog } from '../../src/region/NewCityDialog';
import { requestPersistentStorage } from '../../src/save/db';
import { FEl, installFakeDom } from '../game/fakeDom';

const dialogs = vi.hoisted(() => ({ current: null as ModalOptions | null }));
vi.mock('../../src/audio', () => ({ audio: { play: vi.fn() } }));
vi.mock('../../src/region/mapPreview', () => ({ drawCityMap: vi.fn() }));
vi.mock('../../src/region/newCityPrefs', () => ({
  newCityDefaults: () => ({ difficulty: 'easy', guided: true, veteran: false }),
  rememberNewCity: vi.fn(),
}));
vi.mock('../../src/region/ui/dom', async () => {
  const { FEl, FNode } = await import('../game/fakeDom');
  const h = (tag: string, attrs: Record<string, unknown> = {}, ...children: unknown[]) => {
    const el = new FEl(tag);
    Object.assign(el, attrs);
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof FNode ? child : String(child));
    }
    return el;
  };
  return {
    h,
    icon: () => new FEl('i'),
    button: (label: string, opts: { onClick?: () => void } = {}) => {
      const el = h('button', {}, label);
      el.addEventListener('click', () => opts.onClick?.());
      return el;
    },
  };
});
vi.mock('../../src/region/ui/modal', async () => {
  const { FEl } = await import('../game/fakeDom');
  return {
    Modal: class {
      private closed = false;
      constructor(private opts: ModalOptions) { dialogs.current = opts; }
      close(): void {
        if (this.closed) return;
        this.closed = true;
        this.opts.onClose?.();
      }
    },
    segmented: () => ({ el: new FEl('div') }),
    slider: () => ({ el: new FEl('div') }),
    toggle: () => {
      const el = new FEl('label');
      el.append(new FEl('input'));
      return el;
    },
  };
});

installFakeDom();
beforeEach(() => {
  dialogs.current = null;
  const prefs = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => prefs.get(key) ?? null,
    setItem: (key: string, value: string) => { prefs.set(key, value); },
    removeItem: (key: string) => { prefs.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

const footerButton = (label: string): FEl => {
  const buttons = dialogs.current!.footer! as unknown as FEl[];
  return buttons.find((b) => b.tagName === 'button' && b.textContent === label)!;
};

describe('Found click persistence', () => {
  it('does not request persistence while opening or cancelling the dialog', async () => {
    const persist = vi.fn(() => Promise.resolve(false));
    vi.stubGlobal('navigator', { storage: { persist } });
    const choice = openNewCityDialog({ onFound: () => { void requestPersistentStorage(); } });
    expect(persist).not.toHaveBeenCalled();
    footerButton('Cancel').click();
    expect(await choice).toBeNull();
    expect(persist).not.toHaveBeenCalled();
  });

  it('calls persist once synchronously inside Found, before App can resume, even on a repeated click', async () => {
    let inFoundClick = false;
    const persist = vi.fn(() => {
      expect(inFoundClick).toBe(true);
      return Promise.resolve(false);
    });
    vi.stubGlobal('navigator', { storage: { persist } });
    const choice = openNewCityDialog({ onFound: () => { void requestPersistentStorage(); } });
    let appResumed = false;
    void choice.then(() => { appResumed = true; });
    const found = footerButton('Found City');
    expect(persist).not.toHaveBeenCalled();
    inFoundClick = true;
    found.click();
    found.click();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(appResumed).toBe(false);
    inFoundClick = false;
    expect((await choice)?.name).toBeTruthy();
    expect(appResumed).toBe(true);
  });
});
