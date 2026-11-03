/** FH-19 / FEEL-08: real camera math and input handlers, without a DOM library or WebGL. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CELL_SIZE } from '../../src/core/constants';
import { Emitter } from '../../src/core/events';
import { CityScene } from '../../src/game/CityScene';
import type { GameContext } from '../../src/game/context';
import { NewYearCelebration } from '../../src/game/NewYear';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import { BrushTool, brush } from '../../src/game/tools/BrushTool';
import { QueryTool } from '../../src/game/tools/QueryTool';
import { ToolController } from '../../src/game/tools/ToolController';
import type { ToolPointer } from '../../src/game/tools/Tool';
import { CameraController } from '../../src/render/world/CameraController';
import { Gesture } from '../../src/worker/SimHost';

const cleanup: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { activeElement: null });
});
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function camera() {
  const dom = Object.assign(new EventTarget(), {
    clientWidth: 1280, clientHeight: 720, style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture() {}, releasePointerCapture() {},
  }) as unknown as HTMLCanvasElement;
  const view = new THREE.PerspectiveCamera(45, 1280 / 720, 1, 30000);
  const controls = new CameraController(view, dom, { mapSize: 12000, heightAt: () => 0 });
  controls.setView(1000, 2000, 800, 52, 45);
  cleanup.push(() => controls.dispose());
  return { controls, dom, view };
}

function emit(target: EventTarget, type: string, init: Record<string, unknown> = {}): Event {
  const e = Object.assign(new Event(type, { cancelable: true }), init);
  target.dispatchEvent(e);
  return e;
}

function key(code: string, key: string, type = 'keydown', init: Record<string, unknown> = {}): Event {
  return emit(window, type, { code, key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init });
}

function pointer(dom: HTMLCanvasElement, type: string, init: Record<string, unknown> = {}): void {
  const e = Object.assign(new Event(type, { cancelable: true }), {
    clientX: 640, clientY: 360, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...init,
  });
  dom.dispatchEvent(e);
  window.dispatchEvent(e);
}

function advance(c: CameraController, seconds: number): void {
  const frames = Math.floor(seconds * 60);
  for (let i = 0; i < frames; i++) c.update(1 / 60);
  const rest = seconds - frames / 60;
  if (rest > 0) c.update(rest);
}

describe('camera flights (FEEL-08)', () => {
  it('a 4 km flight takes 1.2–1.6 s, rises above 1.5x the end distance and lands within 1%', () => {
    const { controls: c, view } = camera();
    const startY = view.position.y;
    c.focusOn(5000, 2000, 800, { fly: true });
    let peak = c.distance, peakY = startY, arrived = 0;
    for (let frame = 1; frame <= 96; frame++) {
      c.update(1 / 60);
      peak = Math.max(peak, c.distance);
      peakY = Math.max(peakY, view.position.y);
      if (!arrived && Math.abs(c.target.x - 5000) <= 4000 * 0.01 && Math.abs(c.distance - 800) <= 800 * 0.01) arrived = frame / 60;
    }
    expect(arrived).toBeGreaterThanOrEqual(1.2);
    expect(arrived).toBeLessThanOrEqual(1.6);
    expect(peak).toBeCloseTo(2000);
    expect(peak).toBeGreaterThanOrEqual(1.5 * c.distance);
    expect(peakY).toBeGreaterThan(startY);
    expect(c.target.x).toBeCloseTo(5000);
    expect(c.target.z).toBe(2000);
    expect(c.distance).toBeCloseTo(800);
  });

  it.each([[600, 0.75], [1000, 0.85], [4000, 1.6], [8000, 1.6]])('a %i m flight lasts %f seconds, including a stalled frame', (trip, duration) => {
    const { controls: c } = camera();
    c.focusOn(1000 + trip, 2000, 600, { fly: true });
    advance(c, duration - 0.1);
    expect(c.target.x).toBeLessThan(1000 + trip);
    c.update(0.1);
    expect(c.target.x).toBeCloseTo(1000 + trip);
    expect(c.distance).toBeCloseTo(600);
    c.setView(1000, 2000, 800);
    c.focusOn(1000 + trip, 2000, 600, { fly: true });
    c.update(duration);
    expect(c.target.x).toBe(1000 + trip);
    expect(c.distance).toBe(600);
  });

  it.each([300, 500])('a %i m fly request keeps the existing damping in every frame', (trip) => {
    const a = camera(), b = camera();
    a.controls.focusOn(1000 + trip, 2000, 600, { fly: true });
    b.controls.focusOn(1000 + trip, 2000, 600);
    for (let i = 0; i < 60; i++) {
      a.controls.update(1 / 60);
      b.controls.update(1 / 60);
      expect(a.controls.target.toArray()).toEqual(b.controls.target.toArray());
      expect(a.view.matrixWorld.toArray()).toEqual(b.view.matrixWorld.toArray());
    }
  });

  it('a long focus without fly keeps the original exponential damping', () => {
    const { controls: c } = camera();
    c.focusOn(5000, 2000, 600);
    c.update(0.1);
    expect(c.target.x).toBeCloseTo(5000 - 4000 * Math.exp(-1));
    expect(c.distance).toBeCloseTo(Math.exp(Math.log(600) + (Math.log(800) - Math.log(600)) * Math.exp(-0.9)));
  });

  it.each([[2500, 600, 2500], [800, 3000, 3000], [800, 600, 2000]])('the peak includes start %i m and end %i m', (start, end, peak) => {
    const { controls: c } = camera();
    c.setView(1000, 2000, start);
    c.focusOn(5000, 2000, end, { fly: true });
    advance(c, 0.8);
    expect(c.target.x).toBeCloseTo(3000);
    expect(c.distance).toBeCloseTo(peak);
  });

  it.each([
    ['middle', { button: 1, buttons: 4 }],
    ['Shift+right', { button: 2, buttons: 2, shiftKey: true }],
    ['orbit', { button: 2, buttons: 2 }],
  ] as const)('%s drag stops flight travel and altitude within one frame', (_name, init) => {
    const { controls: c, dom } = camera();
    c.focusOn(5000, 2000, 800, { fly: true });
    advance(c, 0.4);
    const distance = c.distance;
    pointer(dom, 'pointerdown', init);
    pointer(dom, 'pointermove', { ...init, clientX: 680 });
    const stopped = c.target.clone();
    c.update(1 / 60);
    expect(c.target.distanceTo(stopped)).toBeLessThan(1e-6);
    expect(c.distance).toBeCloseTo(distance);
    advance(c, 2);
    expect(c.target.distanceTo(stopped)).toBeLessThan(1e-6);
    expect(c.distance).toBeCloseTo(distance);
    pointer(dom, 'pointerup', init);
  });

  it('an ordinary focus interrupts a flight and follows the new target with existing damping', () => {
    const { controls: c } = camera();
    c.focusOn(5000, 2000, 800, { fly: true });
    advance(c, 0.4);
    const start = c.target.x, distance = c.distance;
    c.focusOn(start - 300, 2000);
    c.update(0.1);
    expect(c.target.x).toBeCloseTo(start - 300 + 300 * Math.exp(-1));
    expect(c.distance).toBeCloseTo(distance);
    advance(c, 2);
    expect(c.target.x).toBeCloseTo(start - 300);
  });

  it('a new flight starts at the displayed position and clears a pending cursor zoom', () => {
    const { controls: c } = camera();
    c.zoomBy(0.5, 700, 360);
    c.focusOn(5000, 2000, 800, { fly: true });
    advance(c, 0.4);
    const start = c.target.clone();
    c.focusOn(1000, 6000, 600, { fly: true });
    expect(c.target.toArray()).toEqual(start.toArray());
    advance(c, 1.6);
    expect(c.target.x).toBeCloseTo(1000);
    expect(c.target.z).toBeCloseTo(6000);
    expect(c.distance).toBeCloseTo(600);
  });

  it.each(['wheel', 'key', 'consumed key', 'touch', 'edge', 'setView'])('%s interrupts a flight', (input) => {
    const { controls: c, dom } = camera();
    c.focusOn(5000, 2000, 800, { fly: true });
    advance(c, 0.4);
    const start = c.target.clone();
    if (input === 'wheel') emit(dom, 'wheel', { deltaY: 40, deltaMode: 0, clientX: 640, clientY: 360 });
    else if (input === 'key') key('KeyQ', 'a');
    else if (input === 'consumed key') {
      const e = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Digit2', key: 'é' });
      e.preventDefault();
      window.dispatchEvent(e);
    }
    else if (input === 'touch') emit(dom, 'touchstart', { touches: [{ identifier: 1, clientX: 640, clientY: 360 }] });
    else if (input === 'setView') c.setView(start.x, start.z, 800);
    else {
      c.edgeScroll = true;
      emit(dom, 'pointerenter');
      emit(window, 'pointermove', { clientX: 0, clientY: 360 });
      c.update(1 / 60);
      c.edgeScroll = false;
    }
    advance(c, 2);
    expect(c.target.distanceTo(start)).toBeLessThan(input === 'edge' ? 100 : 1e-6);
  });
});

function queryContext(controls: GameContext['world']['controls']): GameContext {
  return {
    world: { controls, pickCell: () => null },
    objects: { pickBuilding: () => 7, setSelected: vi.fn() },
    state: { buildings: new Map([[7, { x: 10, z: 20 }]]) },
    host: { beginGesture: (owner: object) => new Gesture(owner) },
    signal: new AbortController().signal,
    tip: { move: vi.fn(), hide: vi.fn() }, sound: vi.fn(), showQuery: vi.fn(),
  } as unknown as GameContext;
}

describe('Query panning (FH-19)', () => {
  it('a 40 px left drag with the default Query pans, cancels a flight and opens no inspector; a click still inspects', () => {
    const { controls: c, dom } = camera();
    const ctx = queryContext(c), tools = new ToolController(ctx, dom);
    cleanup.push(() => tools.dispose());
    expect(tools.activeId).toBeNull();
    c.focusOn(5000, 2000, 800, { fly: true });
    advance(c, 0.4);
    const start = c.target.clone(), distance = c.distance;
    pointer(dom, 'pointerdown');
    pointer(dom, 'pointermove', { clientX: 680 });
    const stopped = c.target.clone();
    expect(stopped.distanceTo(start)).toBeGreaterThan(1);
    c.update(1 / 60);
    expect(c.target.distanceTo(stopped)).toBeLessThan(1e-6);
    expect(c.distance).toBeCloseTo(distance);
    pointer(dom, 'pointerup', { clientX: 680 });
    expect(ctx.showQuery).not.toHaveBeenCalled();
    expect(ctx.sound).not.toHaveBeenCalled();
    advance(c, 2);
    expect(c.distance).toBeCloseTo(distance);
    tools.select('query');
    pointer(dom, 'pointerdown');
    pointer(dom, 'pointerup');
    expect(ctx.showQuery).toHaveBeenCalledExactlyOnceWith({ buildingId: 7, x: 10, z: 20 }, { silent: true });
    expect(ctx.sound).toHaveBeenCalledExactlyOnceWith('select');
  });

  it('a click under 6 px still inspects with controls that have no pan hooks', () => {
    const ctx = queryContext({} as GameContext['world']['controls']);
    const tool = new QueryTool(ctx);
    tool.down({ clientX: 640, clientY: 360 } as ToolPointer);
    tool.up({ clientX: 643, clientY: 364 } as ToolPointer);
    expect(ctx.showQuery).toHaveBeenCalledTimes(1);
  });

  it('a left drag reserved for another tool does not pan', () => {
    const { controls: c, dom } = camera();
    const start = c.target.clone();
    pointer(dom, 'pointerdown');
    pointer(dom, 'pointermove', { clientX: 680 });
    pointer(dom, 'pointerup', { clientX: 680 });
    c.update(1 / 60);
    expect(c.target.toArray()).toEqual(start.toArray());
  });
});

function sceneInput() {
  const sim = { speed: 1 };
  const host = { sim, setSpeed: vi.fn((speed: number) => { sim.speed = speed; }) };
  const scene = Object.assign(Object.create(CityScene.prototype), {
    disposed: false, host, lastSpeed: 1, pause: { isOpen: false },
    tools: { key: vi.fn(() => false), select: vi.fn(), activeId: null },
    panels: { toggle: vi.fn() }, sound: vi.fn(),
  });
  const abort = new AbortController();
  window.addEventListener('keydown', (e) => scene.onKey(e), { signal: abort.signal });
  cleanup.push(() => abort.abort('dispose'));
  const c = camera();
  scene.world = { controls: c.controls };
  return { ...c, scene, host, signal: abort.signal };
}

describe('camera and city keys by code (FH-19)', () => {
  it.each([['KeyA', 'q'], ['KeyW', 'z'], ['KeyS', 'o'], ['KeyS', 'r'], ['KeyD', 'e']])('%s typing %s pans without rotating, selecting tools or opening panels', (code, char) => {
    const { controls: c, scene } = sceneInput();
    const start = c.target.clone(), yaw = c.yawAngle;
    key(code, char);
    c.update(0.1);
    expect(c.target.distanceTo(start)).toBeGreaterThan(1);
    if (code === 'KeyA') {
      expect(c.target.x).toBeLessThan(start.x);
      expect(c.target.z).toBeLessThan(start.z);
    }
    expect(c.yawAngle).toBe(yaw);
    expect(scene.tools.select).not.toHaveBeenCalled();
    expect(scene.panels.toggle).not.toHaveBeenCalled();
  });

  it.each([['KeyQ', 'a', -1], ['KeyE', 'w', 1]] as const)('%s typing %s rotates once without panning', (code, char, direction) => {
    const { controls: c } = sceneInput();
    const start = c.target.clone(), yaw = c.yawAngle;
    key(code, char);
    key(code, char, 'keydown', { repeat: true });
    advance(c, 2);
    expect(c.target.toArray()).toEqual(start.toArray());
    expect(c.yawAngle).toBeCloseTo(yaw + direction * Math.PI / 2);
  });

  it.each([['Digit1', '&', 1], ['Digit2', 'é', 2], ['Digit3', '"', 3], ['Numpad1', 'End', 1], ['Numpad2', 'ArrowDown', 2], ['Numpad3', 'PageDown', 3]] as const)('%s typing %s sets speed %i through the host', (code, char, speed) => {
    const { controls: c, host, scene } = sceneInput();
    const start = c.target.clone(), tilt = c.baseTilt;
    expect(key(code, char).defaultPrevented).toBe(true);
    expect(host.setSpeed).toHaveBeenCalledExactlyOnceWith(speed, 'keyboard');
    expect(scene.lastSpeed).toBe(speed);
    c.update(0.1);
    expect(c.target.toArray()).toEqual(start.toArray());
    expect(c.baseTilt).toBe(tilt);
  });

  it.each(['Backspace', 'Delete'])('%s selects bulldoze and prevents the browser default', (char) => {
    const { scene } = sceneInput();
    expect(key('', char).defaultPrevented).toBe(true);
    expect(scene.tools.select).toHaveBeenCalledExactlyOnceWith('bulldoze');
  });

  it('non-camera character hotkeys still open Data views', () => {
    const { scene } = sceneInput();
    key('KeyO', 'o');
    expect(scene.panels.toggle).toHaveBeenCalledExactlyOnceWith('dataviews');
  });

  it('a tool consuming a camera code stops that event before the camera', () => {
    const { controls: c, scene } = sceneInput();
    scene.tools.key.mockReturnValue(true);
    const later = vi.fn(), start = c.target.clone();
    window.addEventListener('keydown', later);
    expect(key('KeyS', 'r').defaultPrevented).toBe(true);
    c.update(0.1);
    expect(later).not.toHaveBeenCalled();
    expect(c.target.toArray()).toEqual(start.toArray());
  });

  it('keyup releases by code even if its character or the focused element changed', () => {
    const { controls: c } = camera();
    key('KeyA', 'q');
    c.update(0.1);
    Object.assign(document, { activeElement: { tagName: 'INPUT' } });
    key('KeyA', 'Q', 'keyup');
    advance(c, 2);
    const stopped = c.target.clone();
    advance(c, 2);
    expect(c.target.distanceTo(stopped)).toBeLessThan(1e-6);
  });

  it('typing, modifiers, disabled controls and consumed keydowns do not move the camera', () => {
    const { controls: c } = camera();
    const start = c.target.clone();
    Object.assign(document, { activeElement: { tagName: 'INPUT' } });
    key('KeyA', 'q');
    Object.assign(document, { activeElement: null });
    key('KeyA', 'q', 'keydown', { ctrlKey: true });
    c.enabled = false;
    key('KeyA', 'q');
    c.enabled = true;
    const e = Object.assign(new Event('keydown', { cancelable: true }), { code: 'KeyA', key: 'q' });
    e.preventDefault();
    window.dispatchEvent(e);
    advance(c, 1);
    expect(c.target.toArray()).toEqual(start.toArray());
  });

  it('focusCell requests a flight to the cell centre and keeps the existing whoosh', () => {
    const { scene } = sceneInput();
    const focus = vi.spyOn(scene.world.controls, 'focusOn');
    scene.focusCell(100, 120, 600);
    expect(focus).toHaveBeenCalledExactlyOnceWith(100.5 * CELL_SIZE, 120.5 * CELL_SIZE, 600, { fly: true });
    expect(scene.sound).toHaveBeenCalledExactlyOnceWith('whoosh', { volume: 0.7 });
  });
});

describe('brush size keys (NOTE-027)', () => {
  function setup() {
    const f = sceneInput();
    const radius = brush.radius;
    cleanup.push(() => { brush.radius = radius; });
    brush.radius = 5;
    const tool = new BrushTool({ sound: f.scene.sound } as GameContext, 'raise', 'raise');
    f.scene.tools.key.mockImplementation((e: KeyboardEvent) => tool.key(e, null));
    return { ...f, tool };
  }

  it.each([
    ['Equal', '=', 1], ['Equal', '+', 1], ['Equal', '}', 1],
    ['Minus', '-', -1], ['Minus', ')', -1],
    ['BracketRight', ']', 1], ['BracketLeft', '[', -1],
  ] as const)('%s typing %s resizes the brush without zooming the camera', (code, char, delta) => {
    const { controls: c, signal } = setup();
    const zoom = vi.spyOn(c, 'zoomBy'), later = vi.fn();
    window.addEventListener('keydown', later, { signal });
    const distance = c.distance;
    expect(key(code, char).defaultPrevented).toBe(true);
    expect(brush.radius).toBe(5 + delta);
    if (code === 'Equal' || code === 'Minus') expect(later).not.toHaveBeenCalled();
    c.update(0.1);
    expect(zoom).not.toHaveBeenCalled();
    expect(c.distance).toBeCloseTo(distance);
  });

  it.each([['Equal', '=', 10], ['Minus', '-', 1]] as const)('%s stays consumed at the radius limit, including repeats', (code, char, radius) => {
    const { controls: c, scene, signal } = setup();
    const later = vi.fn();
    window.addEventListener('keydown', later, { signal });
    brush.radius = radius;
    const distance = c.distance;
    expect(key(code, char).defaultPrevented).toBe(true);
    expect(key(code, char, 'keydown', { repeat: true }).defaultPrevented).toBe(true);
    expect(brush.radius).toBe(radius);
    expect(later).not.toHaveBeenCalled();
    expect(scene.sound).toHaveBeenCalledExactlyOnceWith('tap', { pitch: 0.6 });
    c.update(0.1);
    expect(c.distance).toBeCloseTo(distance);
  });

  it('keyup and unrelated keys leave the radius alone', () => {
    const { tool } = setup();
    expect(tool.key({ type: 'keyup', code: 'Equal', key: '=' } as KeyboardEvent, null)).toBe(false);
    expect(tool.key({ type: 'keydown', code: 'KeyA', key: 'q' } as KeyboardEvent, null)).toBe(false);
    expect(brush.radius).toBe(5);
  });
});

describe('New Year camera keys (NOTE-027)', () => {
  function setup() {
    const f = camera();
    const signal = new AbortController();
    const world = {
      cameraController: f.controls, controls: f.controls, camera: f.view, renderer: { domElement: f.dom },
      timeOfDay: 10.5, autoTime: true, timeScale: 2,
    } as unknown as GameContext['world'];
    const fw = {
      centre: { x: 4000, z: 5000 }, showSize: 0.5, active: true, midnight: 6, timeScale: 1, onSound: null,
      start: vi.fn(), stop: vi.fn(), fastForward: vi.fn(),
    };
    const sim = {
      events: new Emitter(), speed: 1, maxDaysPerFrame: 4,
      state: { day: 1, year: 2001, stats: { population: 1200 } },
    } as unknown as GameContext['sim'];
    const ny = new NewYearCelebration({
      sim, signal: signal.signal, world: () => world,
      objects: () => ({ fireworks: fw }) as unknown as GameContext['objects'],
      settings: () => DEFAULT_SETTINGS, toast: vi.fn(),
    });
    cleanup.push(() => { signal.abort('dispose'); ny.dispose(); });
    expect(ny.celebrate({ camera: true, quiet: true })).toBe(true);
    const start = f.controls.target.clone();
    ny.frame(0.1, 1000);
    expect(ny.cameraActive).toBe(true);
    expect(f.controls.target.distanceTo(start)).toBeGreaterThan(1);
    return { ...f, ny };
  }

  it('KeyW typing z hands the camera back within one frame and lets the player pan', () => {
    const { controls: c, ny } = setup();
    const setView = vi.spyOn(c, 'setView'), start = c.target.clone();
    key('KeyW', 'z');
    ny.frame(1 / 60, 1000 + 1000 / 60);
    expect(ny.cameraActive).toBe(false);
    expect(setView).not.toHaveBeenCalled();
    c.update(1 / 60);
    expect(c.target.distanceTo(start)).toBeGreaterThan(1);
    ny.frame(0.1, 1200);
    expect(setView).not.toHaveBeenCalled();
    expect(ny.active).toBe(true);
  });

  it('KeyZ typing w leaves the cinematic in control', () => {
    const { controls: c, ny } = setup();
    const setView = vi.spyOn(c, 'setView');
    key('KeyZ', 'w');
    ny.frame(1 / 60, 1000 + 1000 / 60);
    expect(ny.cameraActive).toBe(true);
    expect(setView).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['KeyQ', 'a'], ['ArrowLeft', 'ArrowLeft'], ['PageUp', 'PageUp'], ['Home', 'Home'],
    ['Equal', '='], ['Minus', ')'], ['NumpadAdd', '+'], ['NumpadSubtract', '-'],
  ])('%s typing %s hands the camera back', (code, char) => {
    const { controls: c, ny } = setup();
    const setView = vi.spyOn(c, 'setView');
    key(code, char);
    ny.frame(1 / 60, 1000 + 1000 / 60);
    expect(ny.cameraActive).toBe(false);
    expect(setView).not.toHaveBeenCalled();
  });
});
