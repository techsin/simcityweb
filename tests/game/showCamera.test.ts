import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CELL_SIZE } from '../../src/core/constants';
import { Emitter } from '../../src/core/events';
import type { GameContext } from '../../src/game/context';
import { FoundingFlyIn } from '../../src/game/cameraStart';
import { NewYearCelebration } from '../../src/game/NewYear';
import { FirstCameraMoments, ShowCamera, type ShowControls, type ShowView } from '../../src/game/ShowCamera';
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

function input(type: string, code = 'Escape'): void {
  const event = new Event(type);
  Object.defineProperty(event, 'code', { value: code });
  window.dispatchEvent(event);
}

function expectView(actual: ShowView, expected: ShowView): void {
  for (const key of ['x', 'z', 'd', 'tilt', 'yaw'] as const) expect(actual[key], key).toBeCloseTo(expected[key], 8);
}

function setup() {
  const abort = new AbortController();
  lifetimes.push(abort);
  const controls = new Controls(), initial = controls.view();
  let now = 0, current: ShowControls | null = controls;
  const show = new ShowCamera(() => current, abort.signal, () => now);
  return { abort, controls, initial, show, now: (ms: number) => { now = ms; }, current: (c: ShowControls | null) => { current = c; } };
}

function momentsSetup() {
  const t = setup(), events = new Emitter<Record<string, unknown>>();
  const root = new FEl('div'), settings: GameSettings = { ...DEFAULT_SETTINGS, motion: 'full' };
  const policy = { live: false }, busy = { value: false };
  const ctx = { root, host: { events, policy }, settings, signal: t.abort.signal } as unknown as GameContext;
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
  return { ...t, events, root, settings, policy, busy, moments, first, advance, caption, start };
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

  it.each(['keydown', 'keyup', 'pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'wheel', 'touchstart', 'touchend', 'touchcancel', 'blur'])('%s returns control synchronously without moving back against the player', (type) => {
    const t = setup();
    t.show.begin();
    t.show.moveTo({ x: 100, z: 200, d: 360, tilt: 30, yaw: 15 }, 2);
    t.show.frame(0.75);
    const interrupted = t.controls.view(), calls = t.controls.calls.length;
    input(type);
    expect(t.show.active).toBe(false);
    expect(t.controls.edgeScroll).toBe(true);
    t.show.frame(30);
    expect(t.controls.view()).toEqual(interrupted);
    expect(t.controls.calls.length).toBe(calls);
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

  it.each(['setting', 'motion', 'live', 'newYear'] as const)('defers while %s forbids travel and releases an active moment when it becomes forbidden', (gate) => {
    const t = momentsSetup();
    const blocked = (on: boolean) => {
      if (gate === 'setting') t.settings.cameraMoments = !on;
      if (gate === 'motion') t.settings.motion = on ? 'reduced' : 'full';
      if (gate === 'live') t.policy.live = on;
      if (gate === 'newYear') t.busy.value = on;
    };
    t.first();
    blocked(true);
    t.start();
    expect(t.show.active).toBe(false);
    expect(t.caption()).toBeNull();
    blocked(false);
    t.moments.frame(0);
    expect(t.show.active).toBe(true);
    t.advance(0.75);
    const interrupted = t.controls.view();
    blocked(true);
    t.moments.frame(0);
    expect(t.show.active).toBe(false);
    expect(t.caption()).toBeNull();
    expect(t.controls.view()).toEqual(interrupted);
    expect(t.controls.edgeScroll).toBe(true);
  });

  it('clears its caption within a frame after Escape and lets the next first wait for idle', () => {
    const t = momentsSetup();
    t.first('stage:6');
    t.first('stage:7');
    t.start();
    t.advance(1);
    const interrupted = t.controls.view();
    input('keydown');
    expect(t.show.active).toBe(false);
    t.moments.frame(1 / 60);
    expect(t.caption()).toBeNull();
    expect(t.controls.view()).toEqual(interrupted);
    input('keyup');
    t.now(7999);
    t.moments.frame(0);
    expect(t.show.active).toBe(false);
    t.now(8000);
    t.moments.frame(0);
    expect(t.show.active).toBe(true);
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
    const calls = t.controls.calls.length;
    t.first('stage:7');
    t.advance(10);
    expect(t.show.active).toBe(false);
    expect(t.caption()).toBeNull();
    expect(t.controls.calls.length).toBe(calls);
  });
});

describe('shared New Year camera ownership', () => {
  it('New Year cancellation follows rebound camera codes, keeping unrelated keys alone', () => {
    const t = setup();
    const settings = { ...DEFAULT_SETTINGS, keyBindings: { panForward: 'KeyZ' } };
    const world = { controls: t.controls, autoTime: true, timeOfDay: 12, timeScale: 2 };
    const fireworks = { active: true, timeScale: 1, centre: { x: 300, z: 400 }, start: vi.fn(), stop: vi.fn(), fastForward: vi.fn(), midnight: 2.8, onSound: null };
    const ny = new NewYearCelebration({
      sim: { events: new Emitter(), state: { year: 2001, stats: { population: 1200 } } } as unknown as Simulation,
      signal: t.abort.signal, showCamera: t.show, world: () => world as unknown as WorldViewApi,
      objects: () => ({ fireworks }) as unknown as CityObjectsViewApi, settings: () => settings, toast: vi.fn(),
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

  it.each(['spotlight', 'founding'] as const)('an idle New Year cannot advance or cancel a later %s session', (owner) => {
    const t = momentsSetup();
    const world = { controls: t.controls, autoTime: true, timeOfDay: 12, timeScale: 2 };
    const fireworks = { active: true, timeScale: 1, centre: { x: 300, z: 400 }, start: vi.fn(), stop: vi.fn(), fastForward: vi.fn(), midnight: 2.8, onSound: null };
    const sim = {
      events: new Emitter<Record<string, unknown>>(), speed: 1,
      state: { day: 360, year: 2001, config: { name: 'Queensbury' }, stats: { population: 1200 }, buildings: new Map(), history: { pop: [] } },
    } as unknown as Simulation;
    const ny = new NewYearCelebration({
      sim, signal: t.abort.signal, showCamera: t.show,
      world: () => world as unknown as WorldViewApi,
      objects: () => ({ fireworks }) as unknown as CityObjectsViewApi,
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
      t.start();
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
