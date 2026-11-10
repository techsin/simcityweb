import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CELL_SIZE } from '../../src/core/constants';
import { Emitter } from '../../src/core/events';
import type { GameContext } from '../../src/game/context';
import { FoundingFlyIn } from '../../src/game/cameraStart';
import { NewYearCelebration } from '../../src/game/NewYear';
import { FirstCameraMoments, ShowCamera, type ShowControls, type ShowRules, type ShowView } from '../../src/game/ShowCamera';
import { DEFAULT_SETTINGS, type GameSettings } from '../../src/game/settings';
import type { CityObjectsViewApi, WorldViewApi } from '../../src/render/contracts';
import type { Simulation } from '../../src/sim/Simulation';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();
const lifetimes: AbortController[] = [];
const DEG = Math.PI / 180;

class Controls implements ShowControls {
  enabled = true;
  edgeScroll = true;
  target = { x: 580, z: 792 };
  distance = 1173;
  yaw = 350;
  tilt = 47;
  calls: ShowView[] = [];
  get yawAngle() { return this.yaw * DEG; }
  get baseTilt() { return this.tilt * DEG; }
  get tiltAngle() { return (this.tilt + 15) * DEG; }
  setView(x: number, z: number, d: number, tilt = this.tilt, yaw = this.yaw): void {
    this.target.x = x; this.target.z = z; this.distance = d; this.tilt = tilt; this.yaw = yaw;
    this.calls.push({ x, z, d, tilt, yaw });
  }
  view(): ShowView { return { ...this.target, d: this.distance, tilt: this.tilt, yaw: this.yaw }; }
}

/** the map canvas, a HUD element and a text box, as event targets */
const canvas = new EventTarget(), hud = new EventTarget();
const textBox = { tagName: 'INPUT', type: 'text' };
const targets: Record<string, unknown> = { canvas, hud, input: textBox, slider: { tagName: 'INPUT', type: 'range' } };
type Init = Record<string, unknown> & { target?: string };

/** dispatch on the window, as the browser's capture phase would; `init.target`: where the event happened */
function input(type: string, code = 'Escape', init: Init = {}): Event {
  const event = new Event(type, { cancelable: true });
  const { target, ...rest } = init;
  Object.assign(event, { code, key: code, ...rest });
  if (target) Object.defineProperty(event, 'target', { value: targets[target] });
  window.dispatchEvent(event);
  return event;
}

/** what a listener behind the show camera (the tools, the camera, the HUD) still receives */
function behind(...types: string[]) {
  const got = vi.fn();
  for (const type of types) window.addEventListener(type, (e) => got(e.type));
  return got;
}

function expectView(actual: ShowView, expected: ShowView): void {
  for (const key of ['x', 'z', 'd', 'tilt', 'yaw'] as const) expect(actual[key], key).toBeCloseTo(expected[key], 8);
}

/** the rules of the spotlight and the fly-in in the game: the map canvas and the camera keys */
const PLAY: ShowRules = { canvas: () => canvas, cameraKey: (e) => e.code === 'KeyW', gameKey: (e) => e.code === 'F1' };
/** the New Year show's */
const NEW_YEAR: ShowRules = { ...PLAY, cameraOnly: true };
const TRAVEL: ShowView = { x: 100, z: 200, d: 360, tilt: 30, yaw: 340 };

function setup() {
  const abort = new AbortController();
  lifetimes.push(abort);
  const controls = new Controls(), initial = controls.view();
  let now = 0, current: ShowControls | null = controls;
  const show = new ShowCamera(() => current, abort.signal, () => now);
  /** a session 0.75 s into its travel */
  const travelling = (rules: ShowRules = PLAY) => {
    expect(show.begin(rules)).toBe(true);
    show.moveTo(TRAVEL, 2);
    show.frame(0.75);
    return { interrupted: controls.view(), calls: controls.calls.length };
  };
  return { abort, controls, initial, show, travelling, now: (ms: number) => { now = ms; }, current: (c: ShowControls | null) => { current = c; } };
}

function momentsSetup() {
  const t = setup(), events = new Emitter<Record<string, unknown>>();
  const root = new FEl('div'), settings: GameSettings = { ...DEFAULT_SETTINGS, motion: 'full' };
  const policy = { live: false }, busy = { value: false };
  const tip = { hide: vi.fn() }, tools = { refresh: vi.fn() };
  const ctx = { root, canvas, tip, tools, host: { events, policy }, settings, signal: t.abort.signal } as unknown as GameContext;
  const moments = new FirstCameraMoments(ctx, t.show, () => busy.value);
  const first = (key = 'stage:6', x = 18, z = 31, text = 'The first tower opens') => {
    events.emit('news', { day: 1, kind: 'good', x, z, text, ref: { first: key } });
  };
  const advance = (seconds: number, dt = 0.25) => {
    for (let remaining = seconds; remaining > 1e-9;) {
      const step = Math.min(dt, remaining);
      moments.frame(step);
      remaining -= step;
    }
  };
  const caption = () => root.querySelector('.show-caption');
  const start = () => { t.now(4000); moments.frame(0); };
  return { ...t, events, root, settings, policy, busy, tip, tools, moments, first, advance, caption, start };
}

beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => {
  for (const abort of lifetimes.splice(0)) abort.abort();
  vi.unstubAllGlobals();
});

describe('ShowCamera', () => {
  it('interpolates position, logarithmic distance and the shortest yaw, then returns exactly to the base view', () => {
    const t = setup(), c = t.controls;
    expect(t.show.begin()).toBe(true);
    expect(c.edgeScroll).toBe(false);
    expect(t.show.saved?.tilt).toBeCloseTo(47, 10);
    t.show.moveTo({ x: 180, z: 392, d: 360, tilt: 30, yaw: 10 }, 2);
    t.show.frame(1);
    expect(c.target).toEqual({ x: 380, z: 592 });
    expect(c.distance).toBeCloseTo(Math.sqrt(1173 * 360), 8);
    expect(c.tilt).toBeCloseTo(38.5, 8);
    expect(c.yaw).toBeCloseTo(360, 8);
    t.show.frame(1);
    expect(c.target).toEqual({ x: 180, z: 392 });
    expect(c.distance).toBe(360);
    expect(c.tilt).toBe(30);
    expect(c.yaw).toBeCloseTo(370, 8);
    t.show.back(2.5);
    t.show.frame(1.25);
    expect(t.show.active).toBe(true);
    expect(c.distance).toBeCloseTo(Math.sqrt(1173 * 360), 8);
    t.show.frame(1.25);
    expect(t.show.active).toBe(false);
    expectView(c.view(), t.initial);
    expect(c.edgeScroll).toBe(true);
  });

  it('does not begin on disabled controls, during another show, or while a pointer or key is held', () => {
    const t = setup();
    t.controls.enabled = false;
    expect(t.show.begin()).toBe(false);
    t.controls.enabled = true;
    input('pointerdown');
    t.now(10000);
    expect(t.show.idle).toBe(false);
    expect(t.show.begin()).toBe(false);
    input('pointerup');
    expect(t.show.idle).toBe(false);
    t.now(13999);
    expect(t.show.idle).toBe(false);
    t.now(14000);
    expect(t.show.idle).toBe(true);
    input('keydown', 'KeyW');
    t.now(24000);
    expect(t.show.idle).toBe(false);
    expect(t.show.begin()).toBe(false);
    input('keyup', 'KeyW');
    t.now(28000);
    expect(t.show.idle).toBe(true);
    expect(t.show.begin()).toBe(true);
    expect(t.show.begin()).toBe(false);
  });

  // QA B2: only camera input leaves the camera at the show; QA B1 / B8: the input that ends a show does nothing else
  it.each<[string, string, string, Init]>([
    ['a camera key', 'keydown', 'KeyW', {}],
    ['the wheel on the map', 'wheel', '', { target: 'canvas' }],
    ['a right press on the map', 'pointerdown', '', { target: 'canvas', button: 2 }],
    ['a middle press on the map', 'pointerdown', '', { target: 'canvas', button: 1 }],
  ])('%s takes the camera where it is, and the camera gets the event', (_name, type, code, init) => {
    const t = setup(), s = t.travelling(), got = behind(type);
    const e = input(type, code, init);
    expect(t.show.active).toBe(false);
    expect(t.controls.edgeScroll).toBe(true);
    expect(e.defaultPrevented).toBe(false);
    expect(got).toHaveBeenCalledOnce();
    t.show.frame(30);
    expect(t.controls.view()).toEqual(s.interrupted);
    expect(t.controls.calls.length).toBe(s.calls);
  });

  it.each<[string, string, string, Init]>([
    ['Escape', 'keydown', 'Escape', {}],
    ['a hotkey', 'keydown', 'KeyB', {}],
    ['Space', 'keydown', 'Space', { key: ' ' }],
    ['a left press on the map', 'pointerdown', '', { target: 'canvas', button: 0 }],
    ['a press on the HUD', 'pointerdown', '', { target: 'hud', button: 0 }],
    ['a right press on the HUD', 'pointerdown', '', { target: 'hud', button: 2 }],
  ])('%s ends the show at the saved view and does nothing else', (_name, type, code, init) => {
    const t = setup();
    t.travelling();
    const got = behind(type), e = input(type, code, init);
    expect(t.show.active).toBe(false);
    expect(t.controls.edgeScroll).toBe(true);
    expectView(t.controls.view(), t.initial);
    expect(e.defaultPrevented).toBe(true);
    expect(got).not.toHaveBeenCalled();
    // (and only that one: the same input a moment later is the player's)
    expect(input(type, code, init).defaultPrevented).toBe(false);
    expect(got).toHaveBeenCalledOnce();
  });

  it.each<[string, string, string, Init]>([
    ['a chord', 'keydown', 'KeyS', { ctrlKey: true }],
    ['a camera key in a chord', 'keydown', 'KeyW', { altKey: true }],
    ['a bare modifier', 'keydown', 'ShiftLeft', { key: 'Shift' }],
    ['a key typed into a text box', 'keydown', 'KeyB', { target: 'input' }],
    ['a camera key typed into a text box', 'keydown', 'KeyW', { target: 'input' }],
    ['the wheel over the HUD', 'wheel', '', { target: 'hud' }],
    ['a touch', 'touchstart', '', { target: 'canvas' }],
    ['the window losing focus', 'blur', '', {}],
  ])('%s ends the show at the saved view and keeps its own job', (_name, type, code, init) => {
    const t = setup();
    t.travelling();
    const got = behind(type), e = input(type, code, init);
    expect(t.show.active).toBe(false);
    expectView(t.controls.view(), t.initial);
    expect(e.defaultPrevented).toBe(false);
    expect(got).toHaveBeenCalledOnce();
  });

  it.each(['F5', 'F11', 'F12', 'AudioVolumeUp', 'MediaPlayPause', 'PrintScreen'])('%s is the browser\'s or the system\'s key: the show plays on, the key passes and is not counted as held', (code) => {
    const t = setup(), s = t.travelling(), got = behind('keydown');
    const e = input('keydown', code);
    expect(t.show.active).toBe(true);
    expect(e.defaultPrevented).toBe(false);
    expect(got).toHaveBeenCalledOnce();
    expect(t.controls.calls.length).toBe(s.calls);
    // (the release of PrintScreen or of the key that opened the developer tools never arrives: nothing waits for it)
    t.show.cancel(true);
    t.now(60000);
    expect(t.show.idle).toBe(true);
  });

  it('a function key the game has an action on (F1, Help) skips like any other key', () => {
    const t = setup();
    t.travelling();
    const got = behind('keydown');
    expect(input('keydown', 'F1').defaultPrevented).toBe(true);
    expect(got).not.toHaveBeenCalled();
    expect(t.show.active).toBe(false);
    expectView(t.controls.view(), t.initial);
  });

  it('a camera key pressed on a slider moves no camera (the controller ignores it there): the view comes back', () => {
    const t = setup();
    t.travelling();
    const got = behind('keydown'), e = input('keydown', 'KeyW', { target: 'slider' });
    expect(t.show.active).toBe(false);
    expectView(t.controls.view(), t.initial);
    expect(e.defaultPrevented).toBe(true);
    expect(got).not.toHaveBeenCalled();
  });

  it('the key that ends a show takes its repeats and its release with it (QA B8)', () => {
    const t = setup();
    t.travelling();
    const got = behind('keydown', 'keyup');
    expect(input('keydown', 'Space', { key: ' ' }).defaultPrevented).toBe(true);
    // held on: the repeats are still the skip (the Plop tool's rotate key would spin the building)
    expect(input('keydown', 'Space', { key: ' ', repeat: true }).defaultPrevented).toBe(true);
    // (Space clicks a focused button on its release)
    expect(input('keyup', 'Space', { key: ' ' }).defaultPrevented).toBe(true);
    expect(got).not.toHaveBeenCalled();
    // the next press of the same key is the player's own, from its press to its release
    expect(input('keydown', 'Space', { key: ' ' }).defaultPrevented).toBe(false);
    expect(input('keydown', 'Space', { key: ' ', repeat: true }).defaultPrevented).toBe(false);
    expect(input('keyup', 'Space', { key: ' ' }).defaultPrevented).toBe(false);
    expect(got).toHaveBeenCalledTimes(3);
  });

  it('another key going down, or the window losing focus, ends the wait for a swallowed release', () => {
    const t = setup();
    t.travelling();
    expect(input('keydown', 'KeyB').defaultPrevented).toBe(true);
    input('keydown', 'KeyM');
    expect(input('keyup', 'KeyB').defaultPrevented).toBe(false);
    input('keyup', 'KeyM');
    t.travelling();
    expect(input('keydown', 'KeyB').defaultPrevented).toBe(true);
    input('blur', '');
    expect(input('keyup', 'KeyB').defaultPrevented).toBe(false);
  });

  it.each(['pointermove', 'pointerup', 'pointercancel', 'keyup', 'touchend', 'touchcancel', 'click'])('%s does not end a show, and counts as activity only', (type) => {
    const t = setup(), s = t.travelling(), got = behind(type);
    t.now(9000);
    const e = input(type, 'KeyW', { target: 'canvas' });
    expect(t.show.active).toBe(true);
    expect(e.defaultPrevented).toBe(false);
    expect(got).toHaveBeenCalledOnce();
    expect(t.controls.view()).toEqual(s.interrupted);
    t.show.frame(1.25);
    expectView(t.controls.view(), TRAVEL);
    // (it still restarts the idle clock: no show begins within four seconds of a pointer move)
    t.show.cancel(true);
    t.now(20000);
    expect(t.show.idle).toBe(true);
    input(type, 'KeyW', { target: 'canvas' });
    expect(t.show.idle).toBe(type === 'click');
    t.now(24000);
    expect(t.show.idle).toBe(true);
  });

  it('the press that ends a show takes its release and its click with it, and nothing after them (QA B1)', () => {
    const t = setup();
    t.travelling();
    const got = behind('pointerdown', 'pointerup', 'click');
    const press = { target: 'canvas', button: 0, pointerId: 7 };
    t.now(1000);
    expect(input('pointerdown', '', press).defaultPrevented).toBe(true);
    // another pointer's release in between is not this gesture's
    expect(input('pointerup', '', { ...press, pointerId: 8 }).defaultPrevented).toBe(false);
    t.now(1180);
    expect(input('pointerup', '', press).defaultPrevented).toBe(true);
    expect(input('click', '', press).defaultPrevented).toBe(true);
    expect(got.mock.calls).toEqual([['pointerup']]);
    // the next gesture is the player's own, from its press to its click
    for (const type of ['pointerdown', 'pointerup', 'click']) expect(input(type, '', press).defaultPrevented).toBe(false);
    expect(got.mock.calls.map(([type]) => type)).toEqual(['pointerup', 'pointerdown', 'pointerup', 'click']);
  });

  it('an element losing focus is not the window losing it: the show plays on, and a swallowed press stays swallowed', () => {
    const t = setup(), s = t.travelling();
    // (a capture listener on the window sees every element's blur: a HUD button blurs itself after its click)
    input('blur', '', { target: 'hud' });
    expect(t.show.active).toBe(true);
    expect(t.controls.calls.length).toBe(s.calls);
    const press = { target: 'hud', button: 0, pointerId: 2 };
    expect(input('pointerdown', '', press).defaultPrevented).toBe(true);
    input('blur', '', { target: 'hud' });
    expect(input('pointerup', '', press).defaultPrevented).toBe(true);
    expect(input('click', '', press).defaultPrevented).toBe(true);
    // and it resets nothing the idle rule counts on: a key held through it is still held
    input('keydown', 'KeyW');
    input('blur', '', { target: 'hud' });
    t.now(60000);
    expect(t.show.idle).toBe(false);
    input('blur', '');
    t.now(120000);
    expect(t.show.idle).toBe(true);
  });

  it('a click that comes late, after a cancelled press or after a new press is not swallowed', () => {
    const t = setup(), press = { target: 'canvas', button: 0, pointerId: 3 };
    t.travelling();
    t.now(1000);
    input('pointerdown', '', press);
    input('pointerup', '', press);
    t.now(1501);
    expect(input('click', '', press).defaultPrevented).toBe(false);
    t.travelling();
    input('pointerdown', '', press);
    expect(input('pointercancel', '', press).defaultPrevented).toBe(true);
    expect(input('click', '', press).defaultPrevented).toBe(false);
    t.travelling();
    input('pointerdown', '', press);
    input('pointerup', '', press);
    expect(input('pointerdown', '', press).defaultPrevented).toBe(false);
    expect(input('click', '', press).defaultPrevented).toBe(false);
  });

  // QA B3: the New Year show keeps the base game's rule (NewYear.ts listenForUser on dev 51ec328)
  it.each<[string, string, string, Init]>([
    ['a pointer move', 'pointermove', '', { target: 'canvas' }],
    ['a press on the HUD', 'pointerdown', '', { target: 'hud', button: 0 }],
    ['a release', 'pointerup', '', { target: 'canvas' }],
    ['Escape', 'keydown', 'Escape', {}],
    ['a hotkey', 'keydown', 'KeyM', {}],
    ['a key release', 'keyup', 'KeyW', {}],
    ['the wheel over the HUD', 'wheel', '', { target: 'hud' }],
    ['a touch on the HUD', 'touchstart', '', { target: 'hud' }],
    ['the window losing focus', 'blur', '', {}],
  ])('New Year rules: %s leaves the show running and passes untouched', (_name, type, code, init) => {
    const t = setup(), s = t.travelling(NEW_YEAR), got = behind(type);
    const e = input(type, code, init);
    expect(t.show.active).toBe(true);
    expect(e.defaultPrevented).toBe(false);
    expect(got).toHaveBeenCalledOnce();
    expect(t.controls.calls.length).toBe(s.calls);
    t.show.frame(1.25);
    expectView(t.controls.view(), TRAVEL);
  });

  it.each<[string, string, string, Init]>([
    ['a press on the map', 'pointerdown', '', { target: 'canvas', button: 0 }],
    ['a right press on the map', 'pointerdown', '', { target: 'canvas', button: 2 }],
    ['the wheel on the map', 'wheel', '', { target: 'canvas' }],
    ['a touch on the map', 'touchstart', '', { target: 'canvas' }],
    ['a camera key', 'keydown', 'KeyW', {}],
    ['a camera key in a chord', 'keydown', 'KeyW', { ctrlKey: true }],
  ])('New Year rules: %s hands the camera over where it is, and the event goes on', (_name, type, code, init) => {
    const t = setup(), s = t.travelling(NEW_YEAR), got = behind(type, 'pointerup', 'click');
    const e = input(type, code, init);
    expect(t.show.active).toBe(false);
    expect(e.defaultPrevented).toBe(false);
    expect(t.controls.view()).toEqual(s.interrupted);
    expect(t.controls.calls.length).toBe(s.calls);
    expect(input('pointerup', '', init).defaultPrevented).toBe(false);
    expect(input('click', '', init).defaultPrevented).toBe(false);
    expect(got).toHaveBeenCalledTimes(3);
  });

  it('New Year rules: the show begins although a key or a pointer on the HUD is held, as in the base game', () => {
    const t = setup();
    input('pointerdown', '', { target: 'hud', button: 0 });
    input('keydown', 'ShiftLeft', { key: 'Shift' });
    expect(t.show.begin(PLAY)).toBe(false);
    expect(t.show.begin(NEW_YEAR)).toBe(true);
  });

  it('the Command key going up ends the keys pressed with it: macOS sends those no release, and Cmd+S blocked every later show', () => {
    const t = setup();
    // (an ordinary held key blocks a show until its own release, whatever else goes up meanwhile)
    input('keydown', 'KeyD', { key: 'd' });
    input('keydown', 'ShiftLeft', { key: 'Shift' });
    input('keyup', 'ShiftLeft', { key: 'Shift' });
    t.now(60000);
    expect(t.show.idle).toBe(false);
    expect(t.show.begin(PLAY)).toBe(false);
    input('keyup', 'KeyD', { key: 'd' });
    // (Cmd+S on macOS: S goes down, and only Command comes up)
    input('keydown', 'MetaLeft', { key: 'Meta', metaKey: true });
    input('keydown', 'KeyS', { key: 's', metaKey: true });
    t.now(120000);
    expect(t.show.idle).toBe(false);
    input('keyup', 'MetaLeft', { key: 'Meta' });
    t.now(124000);
    expect(t.show.idle).toBe(true);
    expect(t.show.begin(PLAY)).toBe(true);
  });

  it('is idle again only four seconds after a show ended (QA B10)', () => {
    const t = setup();
    t.now(10000);
    expect(t.show.idle).toBe(true);
    t.show.begin(PLAY);
    t.now(20000);
    t.show.cancel(true);
    expect(t.show.idle).toBe(false);
    t.now(23999);
    expect(t.show.idle).toBe(false);
    t.now(24000);
    expect(t.show.idle).toBe(true);
    // (ending nothing is not an end)
    t.show.cancel();
    expect(t.show.idle).toBe(true);
  });

  it('cancels when the controls change or become disabled and supports an explicit restore', () => {
    const t = setup();
    t.show.begin();
    t.show.moveTo({ x: 100, z: 200, d: 360, tilt: 30, yaw: 15 }, 2);
    t.show.frame(1);
    t.show.cancel(true);
    expectView(t.controls.view(), t.initial);
    t.show.begin();
    t.current(null);
    t.show.frame(1);
    expect(t.show.active).toBe(false);
    expect(t.controls.edgeScroll).toBe(true);
    t.current(t.controls);
    t.show.begin();
    t.controls.enabled = false;
    t.show.frame(1);
    expect(t.show.active).toBe(false);
  });

  it('aborts travel, restores edge scrolling, removes input listeners and cannot begin again', () => {
    const t = setup();
    t.show.begin();
    t.show.moveTo({ x: 100, z: 200, d: 360, tilt: 30, yaw: 15 }, 2);
    t.show.frame(1);
    const interrupted = t.controls.view();
    t.abort.abort();
    expect(t.show.active).toBe(false);
    expect(t.controls.edgeScroll).toBe(true);
    expect(t.show.begin()).toBe(false);
    t.show.frame(10);
    expect(t.controls.view()).toEqual(interrupted);
    t.now(9000);
    input('pointerdown');
    expect(t.show.idle).toBe(true);
  });
});

describe('FirstCameraMoments', () => {
  it('waits four seconds, arrives in two, orbits 25 degrees in four and returns within 8.5 seconds', () => {
    const t = momentsSetup();
    t.first();
    t.now(3999);
    t.moments.frame(0);
    expect(t.show.active).toBe(false);
    t.start();
    expect(t.show.active).toBe(true);
    expect(t.caption()?.textContent).toBe('The first tower opens');
    t.advance(2);
    expect(t.controls.target).toEqual({ x: 18.5 * CELL_SIZE, z: 31.5 * CELL_SIZE });
    expect(t.controls.distance).toBe(360);
    expect(t.controls.tilt).toBe(30);
    expect(t.controls.yaw).toBeCloseTo(t.initial.yaw, 8);
    t.advance(4);
    expect(t.controls.yaw).toBeCloseTo(t.initial.yaw + 25, 8);
    expect(t.controls.distance).toBe(360);
    t.advance(2.5);
    expect(t.show.active).toBe(false);
    const final = t.controls.view();
    expect(Math.hypot(final.x - t.initial.x, final.z - t.initial.z)).toBeLessThan(1);
    expect(Math.abs(final.d / t.initial.d - 1)).toBeLessThan(0.01);
    expect(final.tilt).toBeCloseTo(t.initial.tilt, 8);
    expect(final.yaw).toBeCloseTo(t.initial.yaw, 8);
    expect(t.caption()).toBeNull();
    expect(t.controls.edgeScroll).toBe(true);
  });

  it('does not start during a held drag, and starts only four seconds after release', () => {
    const t = momentsSetup();
    t.first();
    input('pointerdown');
    t.now(10000);
    t.moments.frame(0);
    expect(t.show.active).toBe(false);
    input('pointermove');
    t.now(20000);
    t.moments.frame(0);
    expect(t.show.active).toBe(false);
    input('pointerup');
    t.now(23999);
    t.moments.frame(0);
    expect(t.show.active).toBe(false);
    t.now(24000);
    t.moments.frame(0);
    expect(t.show.active).toBe(true);
  });

  it('finishes on time when one frame crosses both phase boundaries', () => {
    const t = momentsSetup();
    t.first();
    t.start();
    t.moments.frame(8.5);
    expect(t.show.active).toBe(false);
    expectView(t.controls.view(), t.initial);
    expect(t.caption()).toBeNull();
  });

  // QA B2: an emergency turned the game LIVE 2.5 s into a spotlight, with no input, and the camera stayed there
  it.each(['setting', 'motion', 'live', 'busy', 'hidden'] as const)('while %s forbids travel no show starts, and one that is running gives the player\'s view back', (gate) => {
    const t = momentsSetup();
    const blocked = (on: boolean) => {
      if (gate === 'setting') t.settings.cameraMoments = !on;
      if (gate === 'motion') t.settings.motion = on ? 'reduced' : 'full';
      if (gate === 'live') t.policy.live = on;
      if (gate === 'busy') t.busy.value = on;
      if (gate === 'hidden') Object.assign(document, { hidden: on });
    };
    try {
      blocked(true);
      t.first();
      t.start();
      expect(t.show.active).toBe(false);
      expect(t.caption()).toBeNull();
      blocked(false);
      // (a first that came while the player had the moments off is not kept; one that only had to wait is)
      t.first('stage:7');
      t.moments.frame(0);
      expect(t.show.active).toBe(true);
      expect(t.caption()?.textContent).toBe('The first tower opens');
      t.advance(2.5);
      expect(t.controls.distance).toBeCloseTo(360, 6);
      blocked(true);
      t.moments.frame(0);
      expect(t.show.active).toBe(false);
      expect(t.caption()).toBeNull();
      expectView(t.controls.view(), t.initial);
      expect(t.controls.edgeScroll).toBe(true);
    } finally { blocked(false); }
  });

  it('Escape ends the spotlight at the player\'s view within the event, and the next first waits for idle', () => {
    const t = momentsSetup();
    t.first('stage:6');
    t.first('stage:7');
    t.start();
    t.advance(1);
    const e = input('keydown');
    expect(t.show.active).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    expectView(t.controls.view(), t.initial);
    t.moments.frame(1 / 60);
    expect(t.caption()).toBeNull();
    expect(t.moments.playing).toBe(false);
    input('keyup');
    t.now(7999);
    t.moments.frame(0);
    expect(t.show.active).toBe(false);
    t.now(8000);
    t.moments.frame(0);
    expect(t.show.active).toBe(true);
  });

  it('a bare pointer move does not end a spotlight; a camera key hands the camera over where it is (QA B2)', () => {
    const t = momentsSetup();
    t.first();
    t.start();
    t.advance(1);
    input('pointermove', '', { target: 'canvas' });
    t.advance(1);
    expect(t.show.active).toBe(true);
    expect(t.controls.distance).toBe(360);
    expect(t.caption()).not.toBeNull();
    t.advance(1);
    const orbiting = t.controls.view(), calls = t.controls.calls.length;
    expect(input('keydown', 'KeyW').defaultPrevented).toBe(false);
    expect(t.show.active).toBe(false);
    t.moments.frame(1 / 60);
    expect(t.controls.view()).toEqual(orbiting);
    expect(t.controls.calls.length).toBe(calls);
    expect(t.caption()).toBeNull();
  });

  it('a click on the map during a spotlight never reaches the tool (QA B1)', () => {
    const t = momentsSetup(), tool = behind('pointerdown', 'pointerup', 'click');
    t.first();
    t.start();
    t.advance(3);
    for (const type of ['pointerdown', 'pointerup', 'click']) input(type, '', { target: 'canvas', button: 0, pointerId: 1 });
    expect(tool).not.toHaveBeenCalled();
    expect(t.show.active).toBe(false);
    expectView(t.controls.view(), t.initial);
  });

  it('holds the hover while it plays: the tip goes at the start, and the tools read the pointer again at the end (QA B14)', () => {
    const t = momentsSetup();
    t.first();
    expect(t.moments.playing).toBe(false);
    t.start();
    expect(t.moments.playing).toBe(true);
    expect(t.tip.hide).toHaveBeenCalledOnce();
    expect(t.tools.refresh).not.toHaveBeenCalled();
    t.advance(8.5);
    expect(t.moments.playing).toBe(false);
    expect(t.tools.refresh).toHaveBeenCalledOnce();
    t.advance(1);
    expect(t.tools.refresh).toHaveBeenCalledOnce();
  });

  it('leaves four seconds between two queued firsts (QA B10)', () => {
    const t = momentsSetup();
    t.first('stage:6');
    t.first('stage:7', 40, 41, 'The second tower opens');
    t.start();
    t.advance(8.5);
    expect(t.show.active).toBe(false);
    t.moments.frame(0.036);
    expect(t.show.active).toBe(false);
    t.now(7999);
    t.moments.frame(0);
    expect(t.show.active).toBe(false);
    t.now(8000);
    t.moments.frame(0);
    expect(t.show.active).toBe(true);
    expect(t.caption()?.textContent).toBe('The second tower opens');
  });

  it('switching Camera moments off drops what was waiting: switching it on plays no old first (QA B10)', () => {
    const t = momentsSetup();
    t.first('stage:6');
    t.settings.cameraMoments = false;
    t.moments.frame(0);
    t.first('stage:7');
    t.settings.cameraMoments = true;
    t.now(60000);
    t.moments.frame(0);
    expect(t.show.active).toBe(false);
    // (neither comes back when it is announced again; a new first plays)
    t.first('stage:6');
    t.first('stage:7');
    t.moments.frame(0);
    expect(t.show.active).toBe(false);
    t.first('stage:8', 22, 23, 'The first skyscraper opens');
    t.moments.frame(0);
    expect(t.caption()?.textContent).toBe('The first skyscraper opens');
  });

  it('does not cancel a New Year session that preempts the spotlight', () => {
    const t = momentsSetup();
    t.first();
    t.start();
    t.advance(1);
    t.show.cancel();
    expect(t.show.begin()).toBe(true);
    t.show.moveTo({ x: 300, z: 400, d: 600, tilt: 30, yaw: 120 }, 2);
    t.busy.value = true;
    t.moments.frame(0);
    expect(t.caption()).toBeNull();
    expect(t.show.active).toBe(true);
    t.show.frame(2);
    expect(t.controls.target).toEqual({ x: 300, z: 400 });
    expect(t.controls.distance).toBe(600);
  });

  it('requires a positioned first ref and deduplicates its stable key while queued and after completion', () => {
    const t = momentsSetup();
    t.events.emit('news', { kind: 'good', text: 'The first tower opens', x: 18, z: 31 });
    t.events.emit('news', { kind: 'good', text: 'Missing position', ref: { first: 'stage:6' } });
    t.events.emit('news', { kind: 'good', text: 'Other first', x: 18, z: 31, ref: { first: 'stage:5' } });
    t.start();
    expect(t.show.active).toBe(false);
    t.first('stage:6');
    t.first('stage:6', 40, 41, 'Duplicate with changed text');
    t.moments.frame(0);
    expect(t.caption()?.textContent).toBe('The first tower opens');
    t.advance(9);
    t.now(60000);
    t.first('stage:6');
    t.moments.frame(0);
    expect(t.show.active).toBe(false);
    t.first('unique:civ_city_hall', 22, 23, 'City Hall opens');
    t.moments.frame(0);
    expect(t.show.active).toBe(true);
    expect(t.caption()?.textContent).toBe('City Hall opens');
  });

  it('removes the caption and subscription on abort', () => {
    const t = momentsSetup();
    t.first();
    t.start();
    t.advance(1);
    t.abort.abort();
    expect(t.show.active).toBe(false);
    expect(t.caption()).toBeNull();
    expect(t.controls.edgeScroll).toBe(true);
    expect(t.tools.refresh).not.toHaveBeenCalled();
    const calls = t.controls.calls.length;
    t.first('stage:7');
    t.advance(10);
    expect(t.show.active).toBe(false);
    expect(t.caption()).toBeNull();
    expect(t.controls.calls.length).toBe(calls);
  });
});

describe('shared New Year camera ownership', () => {
  const fireworks = () => ({ active: true, timeScale: 1, centre: { x: 300, z: 400 }, start: vi.fn(), stop: vi.fn(), fastForward: vi.fn(), midnight: 2.8, onSound: null });

  it('New Year cancellation follows rebound camera codes, keeping unrelated keys alone', () => {
    const t = setup();
    const settings = { ...DEFAULT_SETTINGS, keyBindings: { panForward: 'KeyZ' } };
    const world = { controls: t.controls, autoTime: true, timeOfDay: 12, timeScale: 2 };
    const ny = new NewYearCelebration({
      sim: { events: new Emitter(), state: { year: 2001, stats: { population: 1200 } } } as unknown as Simulation,
      signal: t.abort.signal, showCamera: t.show, world: () => world as unknown as WorldViewApi,
      objects: () => ({ fireworks: fireworks() }) as unknown as CityObjectsViewApi, settings: () => settings, toast: vi.fn(),
    });
    try {
      ny.celebrate({ instant: true, camera: true, quiet: true });
      ny.frame(0);
      input('keydown', 'KeyW');
      expect(ny.cameraActive).toBe(true);
      input('keyup', 'KeyW');
      expect(ny.cameraActive).toBe(true);
      input('keydown', 'KeyZ');
      expect(ny.cameraActive).toBe(false);
    } finally { ny.dispose(); }
  });

  // QA B3 (a regression against dev 51ec328): any mouse move, a click on the HUD or Escape ended the show's camera and
  // left the view 162 m off at tilt 25
  it('the New Year show keeps the base game\'s pointer rule: only input on the city hands the camera over', () => {
    const t = setup();
    const settings = { ...DEFAULT_SETTINGS };
    // (the renderer's canvas is the map: NewYear reads it from the world, as the base game did)
    const world = { controls: t.controls, renderer: { domElement: canvas }, autoTime: true, timeOfDay: 12, timeScale: 2 };
    const ny = new NewYearCelebration({
      sim: { events: new Emitter(), state: { year: 2001, stats: { population: 1200 } } } as unknown as Simulation,
      signal: t.abort.signal, showCamera: t.show, world: () => world as unknown as WorldViewApi,
      objects: () => ({ fireworks: fireworks() }) as unknown as CityObjectsViewApi, settings: () => settings, toast: vi.fn(),
    });
    try {
      ny.celebrate({ instant: true, camera: true, quiet: true });
      ny.frame(0);
      expect(t.controls.target).toEqual({ x: 300, z: 400 });
      const skyline = t.controls.view(), behindIt = behind('pointerdown', 'keydown');
      for (const [type, code, init] of [
        ['pointermove', '', { target: 'canvas' }], ['pointerdown', '', { target: 'hud', button: 0 }], ['pointerup', '', { target: 'hud' }],
        ['keydown', 'Escape', {}], ['keydown', 'KeyM', {}], ['blur', '', {}],
      ] as [string, string, Init][]) {
        expect(input(type, code, init).defaultPrevented, type).toBe(false);
        expect(ny.cameraActive, type).toBe(true);
      }
      // (the click on the Budget button and the two keys went on to the HUD)
      expect(behindIt).toHaveBeenCalledTimes(3);
      const calls = t.controls.calls.length;
      expect(input('pointerdown', '', { target: 'canvas', button: 0 }).defaultPrevented).toBe(false);
      expect(behindIt).toHaveBeenCalledTimes(4);
      expect(ny.cameraActive).toBe(false);
      ny.frame(0.5);
      expect(t.controls.view()).toEqual(skyline);
      expect(t.controls.calls.length).toBe(calls);
    } finally { ny.dispose(); }
  });

  it('switching the New Year camera off mid-show gives the player\'s view back', () => {
    const t = setup();
    const settings = { ...DEFAULT_SETTINGS };
    const world = { controls: t.controls, autoTime: true, timeOfDay: 12, timeScale: 2 };
    const sim = { events: new Emitter(), speed: 1, state: { day: 360, year: 2001, config: { name: 'Queensbury' }, stats: { population: 1200 }, buildings: new Map(), history: { pop: [] } } } as unknown as Simulation;
    const ny = new NewYearCelebration({
      sim, signal: t.abort.signal, showCamera: t.show, world: () => world as unknown as WorldViewApi,
      objects: () => ({ fireworks: fireworks() }) as unknown as CityObjectsViewApi, settings: () => settings, toast: vi.fn(),
    });
    try {
      ny.celebrate({ year: 2001, quiet: true });
      ny.frame(0, 1000);
      ny.frame(0.1, 1100);
      ny.frame(0.1, 2100);
      expect(ny.cameraActive).toBe(true);
      expect(t.controls.view()).not.toEqual(t.initial);
      settings.newYearCamera = false;
      ny.frame(0.1, 2200);
      expect(ny.cameraActive).toBe(false);
      expectView(t.controls.view(), t.initial);
    } finally { ny.dispose(); }
  });

  it.each(['spotlight', 'founding'] as const)('an idle New Year cannot advance or cancel a later %s session', (owner) => {
    const t = momentsSetup();
    const world = { controls: t.controls, autoTime: true, timeOfDay: 12, timeScale: 2 };
    const sim = {
      events: new Emitter<Record<string, unknown>>(), speed: 1,
      state: { day: 360, year: 2001, config: { name: 'Queensbury' }, stats: { population: 1200 }, buildings: new Map(), history: { pop: [] } },
    } as unknown as Simulation;
    const ny = new NewYearCelebration({
      sim, signal: t.abort.signal, showCamera: t.show,
      world: () => world as unknown as WorldViewApi,
      objects: () => ({ fireworks: fireworks() }) as unknown as CityObjectsViewApi,
      settings: () => t.settings, toast: vi.fn(),
    });
    expect(ny.celebrate({ instant: true, camera: true })).toBe(true);
    ny.frame(0);
    expect(ny.cameraActive).toBe(true);
    ny.cancel();
    expect(ny.cameraActive).toBe(false);
    let founding: FoundingFlyIn | null = null;
    if (owner === 'spotlight') {
      t.first();
      t.now(60000);
      t.moments.frame(0);
    } else {
      founding = new FoundingFlyIn(t.show, t.controls, { x: 250, z: 350, distance: 900, tilt: 47, yaw: 350 }, 'Queensbury · Founded April 2000', vi.fn(), t.root as unknown as HTMLElement);
    }
    expect(t.show.active).toBe(true);
    expect(ny.cameraActive).toBe(false);
    const before = t.controls.view(), calls = t.controls.calls.length;
    ny.frame(0.5);
    ny.cancel();
    expect(t.show.active).toBe(true);
    expect(t.controls.view()).toEqual(before);
    expect(t.controls.calls.length).toBe(calls);
    t.settings.newYearCamera = false;
    ny.frame(0.5);
    ny.cancel();
    ny.dispose();
    expect(t.show.active).toBe(true);
    expect(t.controls.view()).toEqual(before);
    expect(t.controls.calls.length).toBe(calls);
    if (founding) founding.frame(0.5);
    else t.moments.frame(0.5);
    expect(t.controls.calls.length).toBeGreaterThan(calls);
  });
});
