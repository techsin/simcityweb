/** FH-25: profile bindings, conflicts, live Help labels and the draft editor without a browser. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BINDINGS, bindingConflicts, bindingLabel, cameraCode, isCameraCode, matchesBinding, shortcutKeys, type KeyBindings } from '../../src/game/bindings';
import type { GameContext } from '../../src/game/context';
import { loadSettings, saveSettings } from '../../src/game/settings';
import { KeyBindingsPanel } from '../../src/ui/panels/KeyBindingsPanel';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const key = (code: string, printed = code, extra: Record<string, unknown> = {}): KeyboardEvent => ({
  code, key: printed, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...extra,
}) as KeyboardEvent;

describe('FH-25 binding resolution', () => {
  it('keeps physical camera positions and aliases, independently of the printed character', () => {
    expect(cameraCode('KeyW')).toBe('KeyW');
    expect(cameraCode('ArrowUp')).toBe('KeyW');
    expect(cameraCode('NumpadEqual')).toBe('Equal');
    expect(matchesBinding('panForward', key('KeyW', 'z'))).toBe(true);
    expect(matchesBinding('panForward', key('KeyZ', 'w'))).toBe(false);
    expect(isCameraCode('KeyZ')).toBe(false);
    const bindings = { panForward: 'KeyZ' };
    expect(cameraCode('KeyZ', bindings)).toBe('KeyW');
    expect(cameraCode('KeyW', bindings)).toBeNull();
    expect(cameraCode('ArrowUp', bindings)).toBe('KeyW');
    expect(cameraCode('ArrowUp', { panForward: '' })).toBeNull();
  });

  it('keeps default character shortcuts and uses physical codes for explicit overrides', () => {
    expect(matchesBinding('residential', key('KeyZ', 'r'))).toBe(true);
    expect(matchesBinding('residential', key('KeyR', 'p'))).toBe(false);
    expect(matchesBinding('residential', key('KeyZ', 'r'), { residential: 'KeyR' })).toBe(false);
    expect(matchesBinding('residential', key('KeyR', 'p'), { residential: 'KeyR' })).toBe(true);
    expect(matchesBinding('bulldoze', key('', 'Delete'))).toBe(true);
    expect(matchesBinding('bulldoze', key('', 'Backspace'), { bulldoze: 'KeyF' })).toBe(true);
    expect(matchesBinding('bulldoze', key('', 'Delete', { shiftKey: true }))).toBe(true);
    expect(matchesBinding('bulldoze', key('Delete', 'Delete'), { bulldoze: '' })).toBe(false);
    expect(matchesBinding('speed2', key('Digit2', 'é'))).toBe(true);
    expect(matchesBinding('speed2', key('Numpad2', 'ArrowDown'))).toBe(true);
    expect(matchesBinding('speed1', key('Digit1', '!', { shiftKey: true }))).toBe(true);
  });

  it('respects modifiers, retains question-mark Help and separates Save from ordinary S', () => {
    expect(matchesBinding('save', key('KeyS', 's'))).toBe(false);
    expect(matchesBinding('save', key('KeyS', 's', { ctrlKey: true }))).toBe(true);
    expect(matchesBinding('save', key('KeyS', 's', { metaKey: true }))).toBe(true);
    expect(matchesBinding('save', key('KeyJ', 's', { ctrlKey: true }), { save: 'KeyJ' })).toBe(true);
    expect(matchesBinding('bulldoze', key('KeyB', 'b', { ctrlKey: true }))).toBe(false);
    expect(matchesBinding('bulldoze', key('KeyB', 'B', { shiftKey: true }))).toBe(false);
    expect(matchesBinding('rotateBuilding', key('KeyR', 'R', { shiftKey: true }))).toBe(true);
    expect(matchesBinding('help', key('Slash', '?', { shiftKey: true }))).toBe(true);
    expect(matchesBinding('help', key('Slash', '?', { shiftKey: true }), { help: 'F2' })).toBe(false);
  });

  it('flags Bulldoze on X against De-zone, aliases and reserved keys', () => {
    expect(bindingConflicts()).toEqual([]);
    expect(bindingConflicts({ bulldoze: 'KeyX' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'KeyX', ids: ['dezone', 'bulldoze'], message: expect.stringContaining('De-zone') }),
    ]));
    expect(bindingConflicts({ query: 'ArrowUp' }).some((c) => c.ids.includes('panForward'))).toBe(true);
    expect(bindingConflicts({ bulldoze: 'Escape' })[0].message).toContain('reserved');
    expect(bindingConflicts({ bulldoze: 'Tab' })[0].message).toContain('reserved');
    expect(bindingConflicts({ bulldoze: 'ControlLeft' })[0].message).toContain('reserved');
    expect(bindingConflicts({ save: 'KeyM' })).toEqual([]);
    expect(bindingConflicts({ residential: '', rotateBuilding: 'KeyR' })).toEqual([]);
    expect(new Set(BINDINGS.map((b) => b.id)).size).toBe(BINDINGS.length);
  });

  it('shows live keys in Help while preserving pointer gestures and default copy', () => {
    expect(shortcutKeys('Bulldoze', ['B'], { bulldoze: 'KeyF' })).toEqual(['F']);
    expect(shortcutKeys('De-zone', ['X'], { bulldoze: 'KeyF' })).toEqual(['X']);
    expect(shortcutKeys('Pan', ['W', 'A', 'S', 'D'], { panForward: 'KeyZ' })).toEqual(['Z', 'A', 'S', 'D']);
    expect(shortcutKeys('Orbit', ['Right-drag'], { panForward: 'KeyZ' })).toEqual(['Right-drag']);
    expect(shortcutKeys('Zoom', ['Wheel'], { zoomIn: 'Insert' })).toEqual(['Wheel', 'Insert', '−']);
    expect(shortcutKeys('Save city', ['Ctrl', 'S'], { save: 'KeyJ' })).toEqual(['Ctrl / ⌘ + J']);
    expect(bindingLabel('bulldoze', { bulldoze: '' })).toBe('Unbound');
  });
});

let store: Map<string, string>;
const lifetimes: AbortController[] = [];
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
});
afterEach(() => {
  for (const ac of lifetimes.splice(0)) ac.abort('dispose');
  vi.unstubAllGlobals();
});

function panel(initial: KeyBindings = {}) {
  const abort = new AbortController();
  lifetimes.push(abort);
  const settings = loadSettings({ keyBindings: initial });
  const applySettings = vi.fn((patch: Partial<typeof settings>) => { Object.assign(settings, patch); saveSettings(settings); });
  const ctx = { settings, signal: abort.signal, applySettings, sound: vi.fn() } as unknown as GameContext;
  const panel = new KeyBindingsPanel(ctx);
  panel.body = new FEl('div') as unknown as HTMLDivElement;
  (panel as unknown as { build(): void }).build();
  const body = panel.body as unknown as FEl;
  const input = (id: string) => body.querySelectorAll('input').find((e) => e.getAttribute('aria-label') === `${BINDINGS.find((b) => b.id === id)!.label} key`)!;
  const button = (label: string) => body.querySelectorAll('button').find((e) => textOf(e) === label)!;
  return { panel, body, abort, settings, applySettings, input, button };
}

describe('FH-25 key bindings panel', () => {
  it('keeps edits in a draft, blocks conflicts and saves an accepted binding per profile', () => {
    const f = panel();
    f.input('bulldoze').fire('keydown', key('KeyX', 'x') as unknown as Record<string, unknown>);
    expect(textOf(f.body)).toContain('De-zone conflicts with Bulldoze');
    expect(f.button('Apply').disabled).toBe(true);
    f.button('Apply').click();
    expect(f.applySettings).not.toHaveBeenCalled();
    f.input('bulldoze').fire('keydown', key('KeyF', 'f') as unknown as Record<string, unknown>);
    expect(f.button('Apply').disabled).toBe(false);
    expect(f.settings.keyBindings).toEqual({});
    f.button('Apply').click();
    expect(f.applySettings).toHaveBeenCalledExactlyOnceWith({ keyBindings: { bulldoze: 'KeyF' } });
    expect(loadSettings().keyBindings).toEqual({ bulldoze: 'KeyF' });
    expect(f.input('bulldoze').value).toBe('F');
  });

  it('resets defaults, discards an unapplied draft on reopen and releases every listener on abort', () => {
    const f = panel({ bulldoze: 'KeyF' });
    f.input('bulldoze').fire('keydown', key('KeyZ', 'z') as unknown as Record<string, unknown>);
    f.panel.onOpen();
    expect(f.input('bulldoze').value).toBe('F');
    f.button('Reset defaults').click();
    expect(f.input('bulldoze').value).toBe('B');
    f.button('Apply').click();
    expect(loadSettings().keyBindings).toEqual({});
    const interactive = f.body.all().filter((e) => e.tagName === 'input' || e.tagName === 'button');
    expect(interactive.some((e) => e.listenerCount() > 0)).toBe(true);
    f.abort.abort('dispose');
    expect(interactive.every((e) => e.listenerCount() === 0)).toBe(true);
  });

  it('lets Tab navigate and Escape cancel capture, and rejects modifier-only keys', () => {
    const f = panel();
    const input = f.input('bulldoze');
    let prevented = 0;
    input.fire('keydown', { ...key('Tab', 'Tab'), preventDefault: () => prevented++ });
    input.fire('keydown', { ...key('Escape', 'Escape'), preventDefault: () => prevented++ });
    expect(prevented).toBe(1);
    input.fire('keydown', key('ShiftLeft', 'Shift') as unknown as Record<string, unknown>);
    expect(textOf(f.body)).toContain('modifier keys stay reserved');
    expect(input.value).toBe('B');
  });
});
