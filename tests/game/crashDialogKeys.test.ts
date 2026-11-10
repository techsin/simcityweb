/**
 * T089 round 2 (NOTE-092): the keys of the worker crash dialog. The dialog opens by itself in the middle of play, and
 * since T089 "Restart from autosave" and "Continue on the main thread" delete the recovery copy. So no key press may
 * choose them:
 * - with a recovery copy, Recover is the default button (primary, the one the Modal focuses, the last of the row), and
 *   Enter chooses it wherever the focus is: that is the region Modal's convention, Enter is the default button;
 * - Space, the city's pause key, chooses nothing on any button, down or up (the convention of the HUD's confirm dialog,
 *   src/ui/Modals.ts), and it goes no further;
 * - without a copy the default stays "Restart from autosave", as before.
 *
 * The keys run through the real handlers, all on one window (a real EventTarget, so the listeners run in the order they
 * were added, and stopImmediatePropagation and preventDefault are the platform's): CityScene's onKey, added as its
 * constructor adds it and before any dialog exists, then the real Modal's and the dialog's own. The city's listener
 * runs first, so only its own check (modal.ts modalOpen, beside confirmOpen and storageDialogOpen) keeps Space from its
 * pause handler; the dialog's listener keeps the key from everything added after it and from the focused button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CityScene } from '../../src/game/CityScene';
import { openSimCrashDialog, type SimCrashChoice } from '../../src/region/ui/dialogs';
import { confirmDialog, modalOpen, setUiRoot } from '../../src/region/ui/modal';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';

installFakeDom();

let root: FEl;
/** the focused element, as the page has it (the stand-in elements do not track focus themselves) */
const page = () => document as unknown as { activeElement: FEl | null };
/** The page's window: one EventTarget. Node's removeEventListener (22.12) takes a boolean `capture` for false, so a
 *  listener added with `true` would stay after its removal: the boolean is spelled out, as a browser reads it. */
function pageWindow() {
  const target = new EventTarget();
  const options = <T extends EventListenerOptions>(o?: boolean | T) => (typeof o === 'boolean' ? { capture: o } : o);
  return {
    addEventListener: (type: string, f: EventListener, o?: boolean | AddEventListenerOptions) => target.addEventListener(type, f, options(o)),
    removeEventListener: (type: string, f: EventListener, o?: boolean | EventListenerOptions) => target.removeEventListener(type, f, options(o)),
    dispatchEvent: (e: Event) => target.dispatchEvent(e),
  };
}
beforeEach(() => {
  vi.stubGlobal('Node', FNode);
  vi.stubGlobal('window', pageWindow());
  // every stand-in element counts as a button (CityScene blurs a focused button on Space) and none as a text area
  vi.stubGlobal('HTMLButtonElement', FEl);
  vi.stubGlobal('HTMLTextAreaElement', class {});
  page().activeElement = null;
  root = new FEl('div');
  setUiRoot(root as unknown as HTMLElement);
  // the Modal's query for the control it focuses lists two selectors; the stand-in DOM knows single ones
  const all = FEl.prototype.querySelectorAll;
  vi.spyOn(FEl.prototype, 'querySelectorAll').mockImplementation(function (this: FEl, sel: string) {
    return all.call(this, sel === 'input[type=text], .autofocus' ? '.autofocus' : sel);
  });
  vi.spyOn(FEl.prototype, 'focus').mockImplementation(function (this: FEl) { page().activeElement = this; });
  vi.spyOn(FEl.prototype, 'blur').mockImplementation(function (this: FEl) { if (page().activeElement === this) page().activeElement = null; });
});
afterEach(() => {
  // a dialog a failed test left open would stay the top Modal of the next test
  for (const b of root.querySelectorAll('button')) if (b.classList.contains('primary')) b.click();
  expect(modalOpen()).toBe(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function key(char: string, code: string, type: 'keydown' | 'keyup' = 'keydown', init: Record<string, unknown> = {}): Event {
  const e = Object.assign(new Event(type, { cancelable: true }), { key: char, code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });
  window.dispatchEvent(e);
  return e;
}
const space = (type: 'keydown' | 'keyup' = 'keydown') => key(' ', 'Space', type);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** the open dialog's buttons, in the order of its row (a closed dialog stays in the page for its 180 ms fade) */
const buttons = () => root.querySelectorAll('.modal-back').at(-1)!.querySelectorAll('.modal-foot')[0].querySelectorAll('button');
const button = (label: string) => buttons().find((b) => textOf(b) === label)!;
const RECOVER = 'Recover unsaved progress', RESTART = 'Restart from autosave', LOCAL = 'Continue on the main thread';

/** The dialog, once the Modal has focused its default button (60 ms after it opens): what had the focus as it opened,
 *  and what the dialog has resolved with so far (null: nothing chosen, it is open). */
async function open(recoverable: boolean) {
  const seen: { choice: SimCrashChoice | null } = { choice: null };
  const choice = openSimCrashDialog({ cityName: 'Testville', message: 'Invalid tick', recoverable });
  void choice.then((c) => { seen.choice = c; });
  const focusAtOpen = page().activeElement;
  await new Promise((resolve) => setTimeout(resolve, 80));
  const chosen = async () => { await tick(); return seen.choice; };
  return { choice, chosen, focusAtOpen };
}

/** CityScene's key handling on a stand-in scene (as cameraControls.test.ts), added to the window as the constructor adds
 *  it: in the capture phase, when the city opens. Call it before the dialog opens. */
function cityKeys() {
  const sim = { speed: 1 };
  const host = { sim, speed: 1, setSpeed: vi.fn() };
  const scene = Object.assign(Object.create(CityScene.prototype) as { onKey(e: KeyboardEvent): void }, {
    disposed: false, host, lastSpeed: 1, sound: vi.fn(), save: vi.fn(),
    pause: { isOpen: false, open: vi.fn(), close: vi.fn() },
    tools: { key: vi.fn(() => false), select: vi.fn(), cancelDrag: vi.fn(() => false), activeId: null },
    toolbar: { flyoutOpen: false }, topBar: { closePopover: () => false }, panels: { toggle: vi.fn(), closeTop: () => false },
  });
  window.addEventListener('keydown', (e) => scene.onKey(e as KeyboardEvent), { capture: true });
  return { scene, host };
}

describe('the worker crash dialog with a recovery copy: no key deletes the copy (T089, NOTE-092)', () => {
  it('Recover is the default button: primary, the one the Modal focuses, the last of the row; Restart is a plain button', async () => {
    const { choice, focusAtOpen } = await open(true);
    expect(buttons().map((b) => textOf(b))).toEqual([LOCAL, RESTART, RECOVER]);
    expect(buttons().filter((b) => b.classList.contains('primary')).map((b) => textOf(b))).toEqual([RECOVER]);
    expect(button(RESTART).className.split(/\s+/).filter(Boolean).sort()).toEqual(['btn', 'lg']);
    // the Modal moves the focus to it (it looks for the class while it is built, and focuses 60 ms later)
    expect(focusAtOpen).toBeNull();
    expect(page().activeElement).toBe(button(RECOVER));
    // a click is a choice, on any button
    button(RESTART).click();
    await expect(choice).resolves.toBe('restart');
  });

  it('Enter chooses Recover, wherever the focus is; a held Enter chooses nothing', async () => {
    for (const focused of [RECOVER, RESTART, LOCAL, null]) {
      const { choice, chosen } = await open(true);
      page().activeElement = focused ? button(focused) : null;
      // (a key held since before the dialog opened repeats into it)
      expect(key('Enter', 'Enter', 'keydown', { repeat: true }).defaultPrevented, `held, focus on ${focused}`).toBe(true);
      expect(await chosen()).toBeNull();
      // the Modal takes the key: the browser does not click the focused button as well
      expect(key('Enter', 'Enter').defaultPrevented, `focus on ${focused}`).toBe(true);
      await expect(choice, `focus on ${focused}`).resolves.toBe('recover');
      expect(modalOpen()).toBe(false);
    }
  });

  it('Space chooses nothing, on any button, down or up, and the key goes no further', async () => {
    const { choice, chosen } = await open(true);
    // listeners added after the dialog's: the camera's, a panel's
    const later = vi.fn();
    window.addEventListener('keydown', later);
    window.addEventListener('keyup', later);
    for (const focused of [RECOVER, RESTART, LOCAL, null]) {
      page().activeElement = focused ? button(focused) : null;
      // prevented, down and up: a browser clicks the focused button on one or the other
      expect([space().defaultPrevented, space('keyup').defaultPrevented], `focus on ${focused}`).toEqual([true, true]);
      expect(await chosen(), `focus on ${focused}`).toBeNull();
      expect(page().activeElement, 'the focus stays').toBe(focused ? button(focused) : null);
    }
    expect(later).not.toHaveBeenCalled();
    expect(modalOpen()).toBe(true);
    expect(root.querySelectorAll('.modal-back')).toHaveLength(1);
    // another key is not the dialog's to stop
    key('a', 'KeyA');
    expect(later).toHaveBeenCalledTimes(1);
    // the dialog still takes its choice, and gives the keys back
    button(RECOVER).click();
    await expect(choice).resolves.toBe('recover');
    later.mockClear();
    expect(space().defaultPrevented).toBe(false);
    expect(later).toHaveBeenCalledTimes(1);
  });
});

describe('the worker crash dialog without a recovery copy (T089, NOTE-092)', () => {
  it('the default stays Restart from autosave: primary, focused, and Enter\'s; Space chooses nothing', async () => {
    const { choice, chosen } = await open(false);
    expect(buttons().map((b) => textOf(b))).toEqual([LOCAL, RESTART]);
    expect(buttons().filter((b) => b.classList.contains('primary')).map((b) => textOf(b))).toEqual([RESTART]);
    expect(page().activeElement).toBe(button(RESTART));
    expect([space().defaultPrevented, space('keyup').defaultPrevented]).toEqual([true, true]);
    expect(await chosen()).toBeNull();
    expect(key('Enter', 'Enter').defaultPrevented).toBe(true);
    await expect(choice).resolves.toBe('restart');
  });
});

describe('behind the worker crash dialog, the city gets no key (T089, NOTE-092)', () => {
  it('Space does not reach the pause handler, nor Esc, a speed, a tool, a panel or Ctrl+S theirs; the keys are the city\'s again once the dialog has its choice', async () => {
    const { scene, host } = cityKeys();
    // the control: in a city, Space is the pause key
    expect(space().defaultPrevented).toBe(true);
    expect(host.setSpeed).toHaveBeenCalledExactlyOnceWith(0, 'keyboard');
    expect(scene.sound).toHaveBeenCalledExactlyOnceWith('speed1');

    for (const recoverable of [true, false]) {
      host.setSpeed.mockClear();
      scene.sound.mockClear();
      scene.tools.key.mockClear();
      const { choice, chosen } = await open(recoverable);
      const dflt = button(recoverable ? RECOVER : RESTART);
      expect(page().activeElement).toBe(dflt);
      const down = space(), up = space('keyup');
      expect(host.setSpeed, 'the city\'s pause handler').not.toHaveBeenCalled();
      expect(scene.sound).not.toHaveBeenCalled();
      expect(page().activeElement, 'the pause handler blurs a focused button').toBe(dflt);
      expect([down.defaultPrevented, up.defaultPrevented]).toEqual([true, true]);
      // nor the other keys of the city: Esc (its pause menu), a speed, a tool, a panel, Ctrl+S
      for (const [char, code, ctrlKey] of [['Escape', 'Escape', false], ['3', 'Digit3', false], ['b', 'KeyB', false], ['m', 'KeyM', false], ['s', 'KeyS', true]] as const) key(char, code, 'keydown', { ctrlKey });
      expect(scene.pause.open).not.toHaveBeenCalled();
      expect(host.setSpeed).not.toHaveBeenCalled();
      expect(scene.tools.select).not.toHaveBeenCalled();
      expect(scene.panels.toggle).not.toHaveBeenCalled();
      expect(scene.save).not.toHaveBeenCalled();
      expect(scene.tools.key, 'no key reaches the tools').not.toHaveBeenCalled();
      expect(await chosen()).toBeNull();
      // Enter is the dialog's, and then the keys are the city's again
      key('Enter', 'Enter');
      await expect(choice).resolves.toBe(recoverable ? 'recover' : 'restart');
      page().activeElement = null;
      space();
      expect(host.setSpeed, 'after the dialog').toHaveBeenCalledExactlyOnceWith(0, 'keyboard');
    }
  });

  it('the rule is the Modal\'s: under any region-screen Modal the city leaves the keys to it', async () => {
    const { scene, host } = cityKeys();
    const answer = confirmDialog({ title: 'Delete region?', message: 'A dialog of the region screen.' });
    space();
    key('3', 'Digit3');
    expect(host.setSpeed).not.toHaveBeenCalled();
    // Esc is that dialog's (it closes), not the city's (its pause menu)
    key('Escape', 'Escape');
    await expect(answer).resolves.toBe(false);
    expect(scene.pause.open).not.toHaveBeenCalled();
    expect(modalOpen()).toBe(false);
    key('Escape', 'Escape');
    expect(scene.pause.open).toHaveBeenCalledTimes(1);
  });
});
