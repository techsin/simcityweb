/** FH-25: profile bindings, conflicts, live Help labels and the draft editor without a browser. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BINDINGS, bindingConflicts, bindingLabel, cameraCode, changedBindings, isBoundCode, isCameraCode, keyHint, matchesBinding, sanitizeBindings, shortcutKeys, titleWithKey, validBindingCode, type KeyBindings } from '../../src/game/bindings';
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

  // QA B12: [ ] and Enter could be bound without a word ([ stayed the brush key while terraforming, Enter answers dialogs)
  it('reserves Enter and the brush keys with Escape, Tab and the modifiers', () => {
    for (const code of ['Enter', 'NumpadEnter', 'BracketLeft', 'BracketRight', 'Escape', 'Tab', 'ShiftLeft', 'ControlRight', 'AltLeft', 'MetaLeft', '']) expect(validBindingCode(code), code).toBe(false);
    for (const code of ['KeyX', 'Digit0', 'Numpad5', 'NumpadAdd', 'F1', 'F12', 'Space', 'Delete', 'Backslash', 'Semicolon', 'ArrowUp', 'Home']) expect(validBindingCode(code), code).toBe(true);
    for (const code of ['Enter', 'BracketLeft', 'BracketRight']) expect(bindingConflicts({ bulldoze: code })[0].message, code).toContain('reserved');
  });

  // QA B12: a stored table was used as it came: photo on "Escape" made Escape toggle photo mode
  it('a stored table is used only as far as the model allows it', () => {
    expect(sanitizeBindings({ photo: 'Escape', bulldoze: 'KeyF', 'zone:1': 'KeyR', rotate: 3, dezone: '', roads: 'Enter', power: 'BracketLeft', query: null })).toEqual({ bulldoze: 'KeyF', dezone: '' });
    // an entry in conflict with another action goes back to its default; both sides of a stored clash do
    expect(sanitizeBindings({ bulldoze: 'KeyX' })).toEqual({});
    expect(sanitizeBindings({ query: 'ArrowUp', subway: 'Digit7' })).toEqual({ subway: 'Digit7' });
    expect(sanitizeBindings({ bulldoze: 'KeyF', subway: 'KeyF', budget: 'KeyZ' })).toEqual({ budget: 'KeyZ' });
    // what the editor may store passes unchanged, as a copy: a swap, an unbound action, Save on another letter
    const stored = { bulldoze: 'KeyX', dezone: 'KeyB', photo: '', save: 'KeyW', panForward: 'KeyZ' };
    expect(sanitizeBindings(stored)).toEqual(stored);
    expect(sanitizeBindings(stored)).not.toBe(stored);
    expect(bindingConflicts(sanitizeBindings(stored))).toEqual([]);
    for (const damaged of [null, undefined, 'KeyX', 7, ['KeyX'], true]) expect(sanitizeBindings(damaged)).toEqual({});
  });

  it('gives badges and titles the live key, and none for an action without one (QA B11)', () => {
    expect(keyHint('bulldoze')).toBe('B');
    expect(keyHint('bulldoze', { bulldoze: 'KeyX' })).toBe('X');
    expect(keyHint('bulldoze', { bulldoze: '' })).toBe('');
    expect(keyHint('save')).toBe('Ctrl S');
    expect(keyHint('save', { save: 'KeyJ' })).toBe('Ctrl J');
    expect(keyHint('help')).toBe('F1');
    expect(keyHint('pause')).toBe('Space');
    expect(keyHint('nothing')).toBe('');
    expect(titleWithKey('Budget', 'budget')).toBe('Budget (M)');
    expect(titleWithKey('Budget', 'budget', { budget: 'KeyZ' })).toBe('Budget (Z)');
    expect(titleWithKey('Budget', 'budget', { budget: '' })).toBe('Budget');
    expect(titleWithKey('Pause', 'pause')).toBe('Pause (Space)');
    expect(titleWithKey('Help & shortcuts', 'help', { help: 'F2' })).toBe('Help & shortcuts (F2)');
  });

  it('knows which keys carry an action in this profile, alternatives included', () => {
    expect(isBoundCode('F1')).toBe(true);
    expect(isBoundCode('F1', { help: 'KeyJ' })).toBe(false);
    expect(isBoundCode('F5')).toBe(false);
    expect(isBoundCode('F5', { bulldoze: 'F5' })).toBe(true);
    expect(isBoundCode('Delete')).toBe(true);
    expect(isBoundCode('Delete', { bulldoze: '' })).toBe(false);
    expect(isBoundCode('ArrowUp')).toBe(true);
    expect(isBoundCode('KeyZ')).toBe(false);
  });

  it('names the actions a draft changes against the applied table', () => {
    expect(changedBindings({}, {})).toEqual([]);
    expect(changedBindings({ bulldoze: 'KeyF' }, {})).toEqual(['bulldoze']);
    expect(changedBindings({}, { bulldoze: 'KeyF' })).toEqual(['bulldoze']);
    expect(changedBindings({ bulldoze: '' }, { bulldoze: '' })).toEqual([]);
    expect(changedBindings({ bulldoze: 'KeyF', budget: 'KeyZ' }, { bulldoze: 'KeyG', budget: 'KeyZ' })).toEqual(['bulldoze']);
    expect(changedBindings({ roads: 'KeyF', pause: 'KeyP', bulldoze: '' }, {}).sort()).toEqual(['bulldoze', 'pause', 'roads']);
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

/** `shell`: the panel as PanelManager mounts it (its element around the scrolling body); without, a bare body */
function panel(initial: KeyBindings = {}, shell = false) {
  const abort = new AbortController();
  lifetimes.push(abort);
  const settings = loadSettings({ keyBindings: initial });
  const applySettings = vi.fn((patch: Partial<typeof settings>) => { Object.assign(settings, patch); saveSettings(settings); });
  const root = new FEl('div'), toast = vi.fn(), sound = vi.fn();
  const panels = { open: vi.fn((_id: string) => { panel.isOpen = true; panel.onOpen(); }) };
  const ctx = { settings, signal: abort.signal, applySettings, sound, toast, panels, root, tip: { hide: vi.fn() } } as unknown as GameContext;
  const panel = new KeyBindingsPanel(ctx);
  panel.body = new FEl('div') as unknown as HTMLDivElement;
  const body = panel.body as unknown as FEl, el = new FEl('div');
  if (shell) {
    el.appendChild(body);
    panel.el = el as unknown as HTMLDivElement;
  }
  (panel as unknown as { build(): void }).build();
  const all = shell ? el : body;
  const input = (id: string) => body.querySelectorAll('input').find((e) => e.getAttribute('aria-label') === `${BINDINGS.find((b) => b.id === id)!.label} key`)!;
  const button = (label: string) => all.querySelectorAll('button').find((e) => textOf(e) === label)!;
  const press = (id: string, code: string) => input(id).fire('keydown', key(code, code) as unknown as Record<string, unknown>);
  /** the row of an action: its name, its note and its key box */
  const row = (id: string) => body.querySelectorAll('.set-row').find((r) => r.all().includes(input(id)))!;
  /** close as the panel manager does */
  const close = () => { panel.isOpen = false; panel.onClose(); };
  /** the open question's button */
  const answer = (label: string) => root.querySelectorAll('button').find((e) => textOf(e) === label)!;
  return { panel, body, el, abort, settings, applySettings, toast, sound, panels, root, input, button, press, row, close, answer };
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

// QA B7: the conflict line and Apply were the last rows of a 2,388 px scroller with 678 px on screen; closing without
// Apply dropped the draft without a word
describe('FH-25 key bindings panel: the footer, the marked rows and closing (QA B7)', () => {
  beforeEach(() => vi.stubGlobal('window', new EventTarget()));
  const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

  it('keeps the conflict line, Reset and Apply in a footer outside the scrolling list', () => {
    const f = panel({}, true);
    expect(f.el.children).toHaveLength(2);
    const [scroller, foot] = f.el.children;
    expect(scroller).toBe(f.body);
    expect(foot.classList.contains('panel-foot')).toBe(true);
    expect(foot.querySelectorAll('button').map(textOf)).toEqual(['Reset defaults', 'Apply']);
    expect(f.body.querySelectorAll('button').every((b) => textOf(b) === 'Clear')).toBe(true);
    expect(f.body.querySelectorAll('input')).toHaveLength(BINDINGS.length);
    const status = foot.all().find((e) => e.getAttribute('role') === 'status')!;
    expect(textOf(status)).toBe('No key conflicts.');
    f.press('bulldoze', 'KeyX');
    expect(textOf(status)).toBe('X: De-zone conflicts with Bulldoze.');
    expect(textOf(f.body)).not.toContain('conflicts with');
    expect(f.button('Apply').disabled).toBe(true);
    f.press('bulldoze', 'KeyF');
    expect(textOf(status)).toBe('1 change not applied yet.');
    f.press('roads', 'KeyZ');
    expect(textOf(status)).toBe('2 changes not applied yet.');
    f.button('Apply').click();
    expect(textOf(status)).toBe('Key bindings saved for this profile.');
  });

  it('marks both rows of a conflict, and clears the marks when it is resolved', () => {
    const f = panel();
    for (const id of ['bulldoze', 'dezone', 'roads']) expect(f.input(id).getAttribute('aria-invalid'), id).toBe('false');
    f.press('bulldoze', 'KeyX');
    expect(f.input('bulldoze').getAttribute('aria-invalid')).toBe('true');
    expect(f.input('dezone').getAttribute('aria-invalid')).toBe('true');
    expect(f.input('roads').getAttribute('aria-invalid')).toBe('false');
    expect(f.input('bulldoze').style.borderColor).toBe('var(--bad)');
    expect(textOf(f.row('bulldoze'))).toContain('Same key as De-zone');
    expect(textOf(f.row('dezone'))).toContain('Same key as Bulldoze');
    expect(textOf(f.row('roads'))).toBe('RoadsClear');
    // a third action on the same key names both of the others
    f.press('roads', 'KeyX');
    expect(textOf(f.row('roads'))).toContain('Same key as De-zone · Same key as Bulldoze');
    f.press('roads', 'KeyT');
    f.press('bulldoze', 'KeyB');
    for (const id of ['bulldoze', 'dezone', 'roads']) {
      expect(f.input(id).getAttribute('aria-invalid'), id).toBe('false');
      expect(f.input(id).style.borderColor, id).toBe('');
    }
    expect(textOf(f.row('bulldoze'))).toBe('BulldozeClear');
  });

  it('lists two conflicts in the footer and counts the rest', () => {
    const f = panel();
    f.press('bulldoze', 'KeyX');
    f.press('roads', 'KeyC');
    f.press('power', 'KeyI');
    const text = textOf(f.body);
    expect(text).toContain('C: Commercial zone conflicts with Roads.');
    expect(text).toContain('I: Industrial / farms conflicts with Power line.');
    expect(text).not.toContain('De-zone conflicts with Bulldoze.');
    expect(text).toContain('and 1 more: the rows in red');
    expect(f.input('bulldoze').getAttribute('aria-invalid')).toBe('true');
  });

  it('refuses Enter and the brush keys in a key box, with the reason', () => {
    const f = panel();
    for (const code of ['Enter', 'BracketLeft', 'BracketRight']) {
      f.press('bulldoze', code);
      expect(f.input('bulldoze').value, code).toBe('B');
      expect(textOf(f.body), code).toContain('Enter, the brush keys [ ] and modifier keys stay reserved');
    }
    expect(changedBindings((f.panel as unknown as { draft: KeyBindings }).draft, f.settings.keyBindings)).toEqual([]);
  });

  it('closing with changes that can be applied keeps them, and says so', () => {
    const f = panel({ bulldoze: 'KeyF' });
    f.press('roads', 'KeyZ');
    f.press('budget', 'Digit7');
    expect(f.settings.keyBindings).toEqual({ bulldoze: 'KeyF' });
    f.close();
    expect(f.applySettings).toHaveBeenCalledExactlyOnceWith({ keyBindings: { bulldoze: 'KeyF', roads: 'KeyZ', budget: 'Digit7' } });
    expect(loadSettings().keyBindings).toEqual({ bulldoze: 'KeyF', roads: 'KeyZ', budget: 'Digit7' });
    expect(f.toast).toHaveBeenCalledExactlyOnceWith('Your 2 key changes are saved for this profile.', 'info', undefined, 'Key bindings');
    expect(f.root.children).toHaveLength(0);
    // (the panel's own close sound is the sound; nothing asks, nothing is pending)
    expect(f.sound).not.toHaveBeenCalled();
    f.close();
    expect(f.applySettings).toHaveBeenCalledOnce();
    expect(f.toast).toHaveBeenCalledOnce();
  });

  it('closing an untouched or an applied panel does nothing', () => {
    const f = panel({ bulldoze: 'KeyF' });
    f.close();
    f.press('roads', 'KeyZ');
    f.button('Apply').click();
    f.close();
    expect(f.applySettings).toHaveBeenCalledOnce();
    expect(f.toast).not.toHaveBeenCalled();
    expect(f.root.children).toHaveLength(0);
  });

  it('closing with a conflict asks: "Keep editing" (also Escape, the cancel of the dialog) reopens the editor with the draft', async () => {
    const f = panel();
    f.press('bulldoze', 'KeyX');
    f.press('roads', 'KeyZ');
    f.close();
    expect(f.applySettings).not.toHaveBeenCalled();
    expect(f.toast).not.toHaveBeenCalled();
    expect(textOf(f.root)).toContain('Discard key changes?');
    expect(textOf(f.root)).toContain('X: De-zone conflicts with Bulldoze. Two actions cannot share a key, so these changes cannot be applied.');
    window.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    await settle();
    expect(f.panels.open).toHaveBeenCalledExactlyOnceWith('keybindings');
    expect(f.input('bulldoze').value).toBe('X');
    expect(f.input('roads').value).toBe('Z');
    expect(f.button('Apply').disabled).toBe(true);
    expect(f.settings.keyBindings).toEqual({});
    // resolved and closed again: kept, with no further question
    f.press('bulldoze', 'KeyB');
    f.close();
    expect(f.applySettings).toHaveBeenCalledExactlyOnceWith({ keyBindings: { bulldoze: 'KeyB', roads: 'KeyZ' } });
    // (an ordinary reopen starts from the applied table again)
    f.press('pause', 'KeyP');
    f.panel.onOpen();
    expect(f.input('pause').value).toBe('Space');
  });

  it('"Discard" drops the draft: nothing is applied, and the next open shows the applied keys', async () => {
    const f = panel({ roads: 'KeyZ' });
    f.press('bulldoze', 'KeyX');
    f.close();
    f.answer('Discard').click();
    await settle();
    expect(f.applySettings).not.toHaveBeenCalled();
    expect(f.panels.open).not.toHaveBeenCalled();
    expect(loadSettings().keyBindings).toEqual({});
    f.panel.onOpen();
    expect(f.input('bulldoze').value).toBe('B');
    expect(f.input('roads').value).toBe('Z');
    f.close();
    expect(f.applySettings).not.toHaveBeenCalled();
  });

  it('leaving the city: a draft in conflict goes without its question, one that can be applied is kept by the close', () => {
    const conflict = panel();
    conflict.press('bulldoze', 'KeyX');
    conflict.panel.leave();
    conflict.close();
    expect(conflict.root.children).toHaveLength(0);
    expect(conflict.applySettings).not.toHaveBeenCalled();
    const fine = panel();
    fine.press('bulldoze', 'KeyF');
    fine.panel.leave();
    fine.close();
    expect(fine.applySettings).toHaveBeenCalledExactlyOnceWith({ keyBindings: { bulldoze: 'KeyF' } });
  });

  it('a city that is gone asks and applies nothing', () => {
    const f = panel();
    f.press('bulldoze', 'KeyF');
    f.abort.abort('dispose');
    f.close();
    expect(f.applySettings).not.toHaveBeenCalled();
    expect(f.toast).not.toHaveBeenCalled();
  });
});
