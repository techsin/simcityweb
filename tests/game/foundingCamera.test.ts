import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FoundingFlyIn, foundingTitle, readCamera, type FlyInOptions } from '../../src/game/cameraStart';
import { ShowCamera, type ShowControls } from '../../src/game/ShowCamera';
import { CityScene } from '../../src/game/CityScene';
import { CameraController } from '../../src/render/world/CameraController';
import { defaultCityConfig } from '../../src/sim/config';
import { createCityState } from '../../src/sim/terrainGen';
import { FEl, textNode } from './fakeDom';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { activeElement: null, createElement: (tag: string) => new FEl(tag), createTextNode: textNode });
});
afterEach(() => vi.unstubAllGlobals());

const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) });
const rules = { canvas: () => canvas, cameraKey: (e: KeyboardEvent) => e.code === 'KeyW' };

function rig(opts: FlyInOptions = {}, root?: FEl) {
  const c = new CameraController(new THREE.PerspectiveCamera(), canvas as unknown as HTMLElement, { mapSize: 1024, heightAt: () => 0 });
  const abort = new AbortController();
  const show = new ShowCamera(() => c, abort.signal);
  const landed = vi.fn();
  const landing = { x: 500, z: 600, distance: 900, yaw: 35, tilt: 50 };
  const fly = new FoundingFlyIn(show, c, landing, 'Queensbury · Founded April 2000 · Mayor Maya Vance', landed, root as unknown as HTMLElement | undefined, opts);
  return { c, show, landed, landing, fly, dispose: () => { abort.abort(); c.dispose(); } };
}

/** an input event on the window (capture), at `target` when given */
function input(type: string, init: Record<string, unknown> = {}, target?: object): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), { code: 'Escape', key: 'Escape', ...init });
  if (target) Object.defineProperty(event, 'target', { value: target });
  window.dispatchEvent(event);
  return event;
}

describe('founding fly-in (FEEL-27)', () => {
  it('starts at 3× even beyond the ordinary zoom limit and lands exactly at 2.5 s', () => {
    const r = rig();
    try {
      expect(r.c.distance).toBe(2700);
      r.fly.frame(1.25);
      expect(r.c.distance).toBeCloseTo(Math.sqrt(2700 * 900));
      r.fly.frame(1.25);
      expect(r.fly.active).toBe(false);
      expect(r.c.distance).toBe(900);
      expect(r.c.target.x).toBe(500);
      expect(r.c.target.z).toBe(600);
      expect(r.c.baseTilt * 180 / Math.PI).toBeCloseTo(50);
      expect(r.landed).toHaveBeenCalledTimes(1);
      r.fly.frame(10);
      expect(r.landed).toHaveBeenCalledTimes(1);
    } finally { r.dispose(); }
  });

  it.each(['keydown', 'pointerdown', 'wheel', 'touchstart'])('%s skips to the start view within a frame', (type) => {
    const r = rig();
    try {
      window.dispatchEvent(Object.assign(new Event(type), { code: 'Escape', key: 'Escape' }));
      r.fly.frame(1 / 60);
      expect(r.fly.active).toBe(false);
      expect(r.c.distance).toBe(900);
      expect(r.landed).toHaveBeenCalledTimes(1);
    } finally { r.dispose(); }
  });

  it('uses the real founding month and mayor in the title', () => {
    const st = createCityState(defaultCityConfig({ size: 32, name: 'Queensbury', mayor: 'Maya Vance', startYear: 2000 }));
    st.systemData.foundedDay = 90;
    expect(foundingTitle(st)).toBe('Queensbury · Founded April 2000 · Mayor Maya Vance');
  });

  it('a save in the input-skip event keeps the landing before the next frame finishes the fly-in', () => {
    const r = rig();
    try {
      const act = vi.fn();
      window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyS', key: 's', ctrlKey: true }));
      expect(r.show.active).toBe(false);
      expect(r.fly.active).toBe(true);
      const scene = { founding: r.fly, host: { act }, camMemory: {}, world: { controls: r.c } };
      CityScene.prototype.storeCamera.call(scene as unknown as CityScene);
      expect(act).toHaveBeenCalledExactlyOnceWith('setCamera', [r.landing], { tag: scene.camMemory });
    } finally { r.dispose(); }
  });
});

// QA B4: the fly-in's clock ran through the first render and the loading screen's fade: nothing of it was on screen
describe('the fly-in waits for the loading screen (QA B4)', () => {
  it('held: the high view and no session until release(); then the full 2.5 s, the title card and one landing', () => {
    const root = new FEl('div'), r = rig({ hold: true, rules }, root);
    try {
      expect(r.fly.active).toBe(true);
      expect(r.show.active).toBe(false);
      expect(r.c.distance).toBe(2700);
      // the first frames under the loading screen: 0.5 s of them move nothing and show no title
      for (let i = 0; i < 30; i++) r.fly.frame(1 / 60);
      expect(r.c.distance).toBe(2700);
      expect(root.querySelector('.founding-title')).toBeNull();
      expect(r.landed).not.toHaveBeenCalled();
      r.fly.release();
      r.fly.frame(1 / 60);
      // (the frame of the release still shows the high view: the travel runs from the next one)
      expect(r.show.active).toBe(true);
      expect(r.c.distance).toBe(2700);
      expect(root.querySelector('.founding-title')?.textContent).toBe('Queensbury · Founded April 2000 · Mayor Maya Vance');
      r.fly.frame(1.25);
      expect(r.c.distance).toBeCloseTo(Math.sqrt(2700 * 900));
      expect(r.landed).not.toHaveBeenCalled();
      r.fly.frame(1.25);
      expect(r.fly.active).toBe(false);
      expect(r.c.distance).toBe(900);
      expect(r.c.target.x).toBe(500);
      expect(root.querySelector('.founding-title')).toBeNull();
      expect(r.landed).toHaveBeenCalledOnce();
    } finally { r.dispose(); }
  });

  it('input under the loading screen is not a skip, and what it moved is put back at the release', () => {
    const r = rig({ hold: true, rules });
    try {
      for (const type of ['keydown', 'keyup', 'pointerdown', 'pointerup', 'click', 'wheel', 'pointermove']) expect(input(type).defaultPrevented, type).toBe(false);
      // (W held under the loading screen pans the held view)
      window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyW', key: 'w' }));
      r.c.update(0.1);
      r.c.update(0.1);
      window.dispatchEvent(Object.assign(new Event('keyup'), { code: 'KeyW', key: 'w' }));
      expect(r.c.target.z).not.toBe(600);
      r.fly.frame(0.1);
      expect(r.fly.active).toBe(true);
      expect(r.landed).not.toHaveBeenCalled();
      r.fly.release();
      r.fly.frame(1 / 60);
      expect(r.show.active).toBe(true);
      expect(r.c.target.x).toBe(500);
      expect(r.c.target.z).toBe(600);
      expect(r.c.distance).toBe(2700);
      expect(r.show.saved?.d).toBe(900);
    } finally { r.dispose(); }
  });

  it('a page without the app (nobody releases it) starts by itself after 1.5 s of frames', () => {
    const r = rig({ hold: true });
    try {
      for (let t = 0; t < 14; t++) r.fly.frame(0.1);
      expect(r.show.active).toBe(false);
      r.fly.frame(0.1);
      expect(r.show.active).toBe(true);
      expect(r.c.distance).toBe(2700);
      r.fly.frame(2.5);
      expect(r.landed).toHaveBeenCalledOnce();
    } finally { r.dispose(); }
  });

  it('a pointer or key held at the release lands at once (the player is already at the controls)', () => {
    const r = rig({ hold: true, rules });
    try {
      input('pointerdown', { button: 1 }, canvas);
      r.fly.release();
      r.fly.frame(1 / 60);
      expect(r.fly.active).toBe(false);
      expect(r.c.distance).toBe(900);
      expect(r.landed).toHaveBeenCalledOnce();
    } finally { r.dispose(); }
  });

  it('a menu, a dialog or photo mode opened under the loading screen: the camera lands at the release, without the travel', () => {
    const r = rig({ hold: true, rules, busy: () => true });
    try {
      r.fly.frame(0.1);
      expect(r.c.distance).toBe(2700);
      r.fly.release();
      r.fly.frame(1 / 60);
      expect(r.show.active).toBe(false);
      expect(r.fly.active).toBe(false);
      expect(r.c.distance).toBe(900);
      expect(r.c.target.x).toBe(500);
      expect(r.landed).toHaveBeenCalledOnce();
    } finally { r.dispose(); }
  });

  it('another show that has the camera when the travel would start, or takes it in flight, keeps it', () => {
    const waiting = rig({ hold: true, rules });
    try {
      expect(waiting.show.begin({ cameraOnly: true })).toBe(true);
      waiting.show.moveTo({ x: 100, z: 100, d: 700, tilt: 30, yaw: 0 }, 0);
      waiting.show.frame(0);
      waiting.fly.release();
      waiting.fly.frame(1 / 60);
      expect(waiting.fly.active).toBe(false);
      expect(waiting.landed).toHaveBeenCalledOnce();
      expect(waiting.show.active).toBe(true);
      // (not even for a frame: the other show's view is as it left it)
      expect(waiting.c.distance).toBe(700);
      expect(waiting.c.target.x).toBe(100);
    } finally { waiting.dispose(); }
    const flying = rig({ rules });
    try {
      flying.fly.frame(0.5);
      // (a celebration takes the camera: it restores the fly-in's saved view, the landing, and begins its own session)
      flying.show.cancel(true);
      expect(flying.show.begin({ cameraOnly: true })).toBe(true);
      flying.show.moveTo({ x: 100, z: 100, d: 700, tilt: 30, yaw: 0 }, 0);
      flying.show.frame(0);
      flying.fly.frame(1 / 60);
      expect(flying.fly.active).toBe(false);
      expect(flying.landed).toHaveBeenCalledOnce();
      expect(flying.show.active).toBe(true);
      expect(flying.c.distance).toBe(700);
    } finally { flying.dispose(); }
  });

  it('land() puts a held or a flying camera on the landing at once, with its one landing', () => {
    const held = rig({ hold: true, rules });
    try {
      expect(held.c.distance).toBe(2700);
      held.fly.land();
      expect(held.fly.active).toBe(false);
      expect(held.c.distance).toBe(900);
      expect(held.c.target.x).toBe(500);
      expect(held.landed).toHaveBeenCalledOnce();
      // (a release that comes afterwards starts nothing)
      held.fly.release();
      held.fly.frame(1);
      expect(held.show.active).toBe(false);
      expect(held.landed).toHaveBeenCalledOnce();
      expect(held.c.distance).toBe(900);
    } finally { held.dispose(); }
    const flying = rig({ rules });
    try {
      flying.fly.frame(1);
      flying.fly.land();
      expect(flying.show.active).toBe(false);
      expect(flying.c.distance).toBe(900);
      expect(flying.landed).toHaveBeenCalledOnce();
    } finally { flying.dispose(); }
  });

  it('a lost graphics context lands a fly-in that is still held, before the scene stores the camera for the rebuilt view', () => {
    const order: string[] = [];
    const scene = {
      disposed: false, ctxLost: null as unknown, uiRoot: new FEl('div'), abort: new AbortController(),
      showCamera: { cancel: (restore: boolean) => order.push(`show.cancel(${restore})`) }, founding: { land: () => order.push('founding.land') },
      host: { setSpeed: () => order.push('pause') }, storeCamera: () => order.push('storeCamera'),
      save: async () => { order.push('save'); }, sound: () => undefined,
    };
    (CityScene.prototype as unknown as { onContextLost(this: object): void }).onContextLost.call(scene);
    expect(order).toEqual(['show.cancel(true)', 'founding.land', 'pause', 'storeCamera', 'save']);
    expect(scene.ctxLost).not.toBeNull();
  });

  it('inPlace: lands on the exact view the camera had, and saves its rounded copy (QA B14: 1,126 m for 1,126.4 m)', () => {
    const c = new CameraController(new THREE.PerspectiveCamera(), canvas as unknown as HTMLElement, { mapSize: 4096, heightAt: () => 0 });
    const abort = new AbortController(), show = new ShowCamera(() => c, abort.signal), landed = vi.fn();
    try {
      c.setView(1096.04, 1608, 1126.4, 50, 45);
      const landing = readCamera(c)!;
      expect(landing).toEqual({ x: 1096, z: 1608, distance: 1126, tilt: 50, yaw: 45 });
      const fly = new FoundingFlyIn(show, c, landing, 'title', landed, undefined, { inPlace: true });
      expect(fly.landing).toBe(landing);
      expect(c.distance).toBeCloseTo(3379.2, 9);
      fly.frame(2.5);
      expect(landed).toHaveBeenCalledOnce();
      expect(c.distance).toBe(1126.4);
      expect(c.target.x).toBe(1096.04);
      expect(c.baseTilt * 180 / Math.PI).toBeCloseTo(50, 10);
      expect(c.yawAngle * 180 / Math.PI).toBeCloseTo(45, 10);
    } finally { abort.abort(); c.dispose(); }
  });
});

describe('what skips the fly-in (QA B1, B2, B8)', () => {
  it('a bare pointer move does not; a click on the map does, and the tool never gets it', () => {
    const r = rig({ rules }), tool = vi.fn();
    try {
      for (const type of ['pointerdown', 'pointerup', 'click']) window.addEventListener(type, tool);
      r.fly.frame(0.5);
      input('pointermove', {}, canvas);
      r.fly.frame(0.5);
      expect(r.fly.active).toBe(true);
      expect(r.c.distance).toBeGreaterThan(900);
      expect(r.landed).not.toHaveBeenCalled();
      const press = { button: 0, pointerId: 1 };
      for (const type of ['pointerdown', 'pointerup', 'click']) expect(input(type, press, canvas).defaultPrevented, type).toBe(true);
      expect(tool).not.toHaveBeenCalled();
      r.fly.frame(1 / 60);
      expect(r.fly.active).toBe(false);
      expect(r.c.distance).toBe(900);
      expect(r.landed).toHaveBeenCalledOnce();
    } finally { r.dispose(); }
  });

  it('Escape and Space skip without reaching the game (no pause menu, no unpause); W lands and pans from there', () => {
    for (const [code, key] of [['Escape', 'Escape'], ['Space', ' ']]) {
      const r = rig({ rules }), game = vi.fn();
      try {
        window.addEventListener('keydown', game);
        r.fly.frame(0.5);
        expect(input('keydown', { code, key }).defaultPrevented, code).toBe(true);
        expect(game).not.toHaveBeenCalled();
        r.fly.frame(1 / 60);
        expect(r.c.distance).toBe(900);
        expect(r.landed).toHaveBeenCalledOnce();
      } finally { r.dispose(); }
    }
    const r = rig({ rules });
    try {
      r.fly.frame(0.5);
      expect(input('keydown', { code: 'KeyW', key: 'w' }).defaultPrevented).toBe(false);
      r.fly.frame(1 / 60);
      expect(r.landed).toHaveBeenCalledOnce();
      expect(r.c.distance).toBe(900);
      r.c.update(0.1);
      expect(r.c.target.z).not.toBe(600);
    } finally { r.dispose(); }
  });
});

// The scene's rAF callback, as shipped (the way graphicsRestore.test.ts runs it): a real controller and fly-in, stand-in
// consumers for everything else.
const source = readFileSync(new URL('../../src/game/CityScene.ts', import.meta.url), 'utf8');
const body = source.match(/  private loop = \(now: number\): void => \{([\s\S]*?)\n  \};/)?.[1];
if (!body) throw new Error('CityScene frame callback not found');
const frame = new Function('now', body) as (this: object, now: number) => void;

describe('the scene runs the fly-in on screen (QA B4)', () => {
  let clock = 0;
  beforeEach(() => {
    clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    Object.assign(document, { hidden: false });
  });
  afterEach(() => vi.restoreAllMocks());

  function scene() {
    const c = new CameraController(new THREE.PerspectiveCamera(), canvas as unknown as HTMLElement, { mapSize: 4096, heightAt: () => 0 });
    const abort = new AbortController(), show = new ShowCamera(() => c, abort.signal);
    c.setView(1096, 1608, 1126.4, 50, 45);
    let landedAt = -1;
    const landed = vi.fn(() => { landedAt = clock; });
    const founding = new FoundingFlyIn(show, c as unknown as ShowControls, readCamera(c)!, 'title', landed, undefined, { hold: true, inPlace: true, rules });
    const s = {
      disposed: false, last: clock, uiAcc: 0, slowAcc: 0, ambAcc: clock, renderFailures: 0,
      fps: { frames: 0, t: 0, value: 0, last: 0 },
      readyPending: true, firstFrame: false, simReady: true, ctxLost: null, slow: null, loadMs: null as number | null,
      settings: { quality: 'high', showFps: false }, founding, showCamera: show,
      tools: { frame: vi.fn() }, host: { frame: vi.fn() }, newYear: { frame: vi.fn() },
      world: { update: vi.fn((dt: number) => c.update(dt)), render: vi.fn() }, objects: { update: vi.fn() },
      minimap: { frame: () => false }, ticker: { frame: vi.fn() }, onboarding: { frame: vi.fn() },
      topBar: { update: vi.fn(), setBadge: vi.fn() }, panels: { tick: vi.fn(), isOpen: () => false },
      advisors: { alertCount: () => 0 }, uiEvents: { emit: vi.fn() }, camMemory: { placed: false },
      edgeScroll: vi.fn(), feedShake: vi.fn(), updateAmbience: vi.fn(), resolveReady: vi.fn(),
      errors: { report: vi.fn() }, toasts: { show: vi.fn() }, applySettings: vi.fn(), checkSlow: vi.fn(),
    };
    const run = (ms: number, stall = 0) => {
      clock += ms;
      if (stall) s.world.render.mockImplementationOnce(() => { clock += stall; });
      frame.call(s, clock);
    };
    return { s, c, show, founding, landed, landedAt: () => landedAt, run, dispose: () => { abort.abort(); c.dispose(); } };
  }

  it('a 2.5 s first render and the 480 ms fade leave it at 3×; the load report starts it; it lands 2.5 to 3 s later', () => {
    const t = scene();
    try {
      // the first frame of the real views: cold shaders, 2.5 s inside render()
      t.run(16, 2500);
      expect(t.s.firstFrame).toBe(true);
      expect(t.s.resolveReady).toHaveBeenCalledOnce();
      // the loading screen fades for 480 ms: frames run, the camera waits at 3× with nothing landed
      for (let i = 0; i < 30; i++) t.run(16);
      expect(t.c.distance).toBeCloseTo(3379.2, 6);
      expect(t.show.active).toBe(false);
      expect(t.landed).not.toHaveBeenCalled();
      expect(t.s.errors.report).not.toHaveBeenCalled();
      // (under the loading screen the tools still run: nothing flies yet)
      const hover = t.s.tools.frame.mock.calls.length;
      expect(hover).toBe(31);
      // main.ts: await ld.hide(); scene.reportLoadTime(ms)
      CityScene.prototype.reportLoadTime.call(t.s as unknown as CityScene, 3200);
      const shown = clock;
      t.run(16);
      expect(t.c.distance).toBeCloseTo(3379.2, 6);
      for (let i = 0; i < 60; i++) t.run(1000 / 60);
      // one second on screen: well on the way, not there
      expect(t.c.distance).toBeLessThan(3000);
      expect(t.c.distance).toBeGreaterThan(1300);
      expect(t.landed).not.toHaveBeenCalled();
      for (let i = 0; i < 120 && !t.landed.mock.calls.length; i++) t.run(1000 / 60);
      expect(t.landed).toHaveBeenCalledOnce();
      expect(t.landedAt() - shown).toBeGreaterThanOrEqual(2500);
      expect(t.landedAt() - shown).toBeLessThanOrEqual(3000);
      expect(t.c.distance).toBeCloseTo(1126.4, 9);
      // (in flight the tools' hover waits: only the frame of the release, before the travel began, read it)
      expect(t.s.tools.frame).toHaveBeenCalledTimes(hover + 1);
      t.run(16);
      expect(t.s.tools.frame).toHaveBeenCalledTimes(hover + 2);
    } finally { t.dispose(); }
  });

  it('a stalled frame moves the fly-in by a tenth of a second at most', () => {
    const t = scene();
    try {
      t.run(16, 2500);
      CityScene.prototype.reportLoadTime.call(t.s as unknown as CityScene, 2600);
      t.run(16);
      t.run(16);
      const before = t.c.distance;
      // a 1.2 s hitch in flight: the next frame is 0.1 s further along, not at the landing
      t.run(1200);
      expect(t.c.distance).toBeLessThan(before);
      expect(t.c.distance).toBeGreaterThan(3200);
      expect(t.landed).not.toHaveBeenCalled();
    } finally { t.dispose(); }
  });
});

describe('the scene\'s loop in photo mode (QA B14)', () => {
  it('ends a celebration that holds the clock, and lets fireworks alone (a year\'s burst) play', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    const scene = (ownsTime: boolean) => ({
      disposed: false, last: 0, uiAcc: 0, slowAcc: 0, ambAcc: 0, renderFailures: 0, fps: { frames: 0, t: 0, value: 0, last: 0 },
      readyPending: false, firstFrame: true, simReady: true, ctxLost: null, slow: null, settings: { quality: 'high', showFps: false },
      photo: { active: true, frame: vi.fn() }, tools: { frame: vi.fn() }, host: { frame: vi.fn() },
      newYear: { frame: vi.fn(), cancel: vi.fn(), ownsTime },
      world: { update: vi.fn(), render: vi.fn() }, objects: { update: vi.fn() },
      minimap: { frame: () => false }, ticker: { frame: vi.fn() }, onboarding: { frame: vi.fn() },
      topBar: { update: vi.fn(), setBadge: vi.fn() }, panels: { tick: vi.fn(), isOpen: () => false },
      advisors: { alertCount: () => 0 }, uiEvents: { emit: vi.fn() }, camMemory: { placed: false },
      edgeScroll: vi.fn(), feedShake: vi.fn(), updateAmbience: vi.fn(), resolveReady: vi.fn(),
      errors: { report: vi.fn() }, toasts: { show: vi.fn() }, applySettings: vi.fn(), checkSlow: vi.fn(),
    });
    const cinematic = scene(true), burst = scene(false);
    frame.call(cinematic, 16);
    frame.call(burst, 16);
    expect(cinematic.newYear.cancel).toHaveBeenCalledExactlyOnceWith(false);
    expect(burst.newYear.cancel).not.toHaveBeenCalled();
    for (const each of [cinematic, burst]) {
      expect(each.newYear.frame).toHaveBeenCalledOnce();
      expect(each.photo.frame).toHaveBeenCalledOnce();
      // (photo mode keeps the tools still)
      expect(each.tools.frame).not.toHaveBeenCalled();
      expect(each.errors.report).not.toHaveBeenCalled();
    }
  });
});
