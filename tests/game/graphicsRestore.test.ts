/** T058: loading stays outside the slow-frame window; graphics restores keep the displayed data and hour. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Overlay } from '../../src/core/types';
import { CityScene } from '../../src/game/CityScene';
import { exactDigest } from '../../src/worker/queries';
import { newState } from '../infra/cityGen';

const proto = CityScene.prototype as unknown as {
  checkSlow(this: object, fps: number, dt: number): void;
  restoreViews(this: object): Promise<void>;
  setOverlay(this: object, overlay: Overlay, variant: number): void;
};
const source = readFileSync(new URL('../../src/game/CityScene.ts', import.meta.url), 'utf8');
// The rAF callback is an instance field. Execute its shipped body with stand-in frame consumers, without WebGL or HUD.
const body = source.match(/  private loop = \(now: number\): void => \{([\s\S]*?)\n  \};/)?.[1];
if (!body) throw new Error('CityScene frame callback not found');
const frame = new Function('now', body) as (this: object, now: number) => void;

let clock = 100;
let store: Map<string, string>;
beforeEach(() => {
  clock = 100;
  store = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function frameScene() {
  return {
    disposed: false, last: clock, uiAcc: 0, slowAcc: 0, ambAcc: clock, renderFailures: 0,
    fps: { frames: 0, t: 0, value: 0, last: 0 },
    readyPending: false, firstFrame: false, simReady: false, ctxLost: null,
    slow: [] as { fps: number; dt: number }[] | null,
    settings: { quality: 'high', showFps: false },
    tools: { frame: vi.fn() }, host: { frame: vi.fn() }, newYear: { frame: vi.fn() },
    world: { update: vi.fn(), render: vi.fn() }, objects: { update: vi.fn() },
    minimap: { frame: () => false }, ticker: { frame: vi.fn() }, onboarding: { frame: vi.fn() },
    topBar: { update: vi.fn(), setBadge: vi.fn() }, panels: { tick: vi.fn(), isOpen: () => false },
    advisors: { alertCount: () => 0 }, uiEvents: { emit: vi.fn() }, camMemory: { placed: false },
    edgeScroll: vi.fn(), feedShake: vi.fn(), updateAmbience: vi.fn(), resolveReady: vi.fn(),
    errors: { report: vi.fn() }, toasts: { show: vi.fn() }, applySettings: vi.fn(),
    checkSlow: proto.checkSlow,
  };
}

function frames(scene: object, seconds: number, fps: number): void {
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    clock += 1000 / fps;
    frame.call(scene, clock);
  }
}

describe('first interactive frame fps sampling (T058)', () => {
  it.each([[3460, 0], [22000, 0], [0, 22000]])('a %i ms build and %i ms first draw do not count as slow play', (buildMs, drawMs) => {
    const scene = frameScene();
    frame.call(scene, clock); // the loading screen already had a rAF before view building began
    scene.fps.frames = 3;
    scene.fps.t = 0.2;
    scene.readyPending = true;
    clock += buildMs;
    scene.world.render.mockImplementationOnce(() => { clock += drawMs; });
    frame.call(scene, clock);
    expect(scene.firstFrame).toBe(true);
    expect(scene.resolveReady).toHaveBeenCalledOnce();
    expect(scene.fps.frames).toBe(0);
    expect(scene.fps.t).toBe(0);
    expect(scene.fps.last).toBe(clock);
    expect(scene.slow).toEqual([]);
    frames(scene, 60, 60);
    expect(scene.fps.value).toBeCloseTo(60, 6);
    expect(scene.toasts.show).not.toHaveBeenCalled();
    expect(store.has('metropolis.ui.slowPrompt')).toBe(false);
    expect(scene.errors.report).not.toHaveBeenCalled();
  });

  it('still offers Medium once after twenty seconds of slow play following a long load', () => {
    const scene = frameScene();
    frame.call(scene, clock);
    scene.readyPending = true;
    clock += 22000;
    frame.call(scene, clock);
    frames(scene, 19, 10);
    expect(scene.toasts.show).not.toHaveBeenCalled();
    frames(scene, 2, 10);
    expect(scene.toasts.show).toHaveBeenCalledOnce();
    expect(JSON.parse(store.get('metropolis.ui.slowPrompt')!)).toMatchObject({ shown: true });
    frames(scene, 30, 10);
    expect(scene.toasts.show).toHaveBeenCalledOnce();
  });
});

function restoreScene(overlay: Overlay, variant: number, hour: number, autoTime = true) {
  const state = newState(16);
  const world = () => ({
    timeOfDay: 10.5, autoTime: true,
    controls: { target: { x: 100, y: 0, z: 120 }, distance: 640, yawAngle: 0.5, tiltAngle: 0.9, setView: vi.fn() },
    setOverlay: vi.fn(), terrain: { setOverlay: vi.fn() }, dispose: vi.fn(),
  });
  const objects = () => ({ dispose: vi.fn(), setOverlayMode: vi.fn() });
  const scene = {
    disposed: false, ctxLost: { card: { remove: vi.fn() }, restoring: false } as object | null,
    ctxWatch: new AbortController(), sim: { state },
    world: world(), objects: objects(),
    host: { setView: vi.fn(), act: vi.fn(), setSpeed: vi.fn() },
    ctx: { overlay, overlayVariant: variant, setOverlay: (o: Overlay, v: number) => proto.setOverlay.call(scene, o, v) },
    overlayVariants: new Map<Overlay, number>(), view: { overlay, variant, panels: ['data'], focus: [] },
    minimap: { markDirty: vi.fn() }, uiEvents: { emit: vi.fn() },
    swapCanvas: vi.fn(), resize: vi.fn(), placeInitialCamera: vi.fn(), sound: vi.fn(),
    createViews: () => { scene.world = world(); scene.objects = objects(); },
    applySettings: () => {
      scene.world.autoTime = autoTime;
      if (!autoTime) scene.world.timeOfDay = hour;
    },
  };
  scene.world.timeOfDay = hour;
  scene.world.autoTime = autoTime;
  return { scene, state };
}

describe('restoring the displayed world (T058)', () => {
  it.each([[Overlay.LandValue, -1], [Overlay.Desirability, 13], [Overlay.None, -1]] as const)(
    'reapplies overlay %i and variant %i to terrain, buildings and host views', async (overlay, variant) => {
      const { scene, state } = restoreScene(overlay, variant, 21.75);
      const before = exactDigest(state), oldWorld = scene.world, watch = scene.ctxWatch;
      await proto.restoreViews.call(scene);
      expect(oldWorld.dispose).toHaveBeenCalledOnce();
      expect(watch.signal.aborted).toBe(true);
      expect(scene.world).not.toBe(oldWorld);
      expect(scene.world.setOverlay).toHaveBeenCalledExactlyOnceWith(overlay);
      expect(scene.world.terrain.setOverlay).toHaveBeenCalledExactlyOnceWith(overlay, variant);
      expect(scene.objects.setOverlayMode).toHaveBeenCalledExactlyOnceWith(overlay);
      expect(scene.ctx).toMatchObject({ overlay, overlayVariant: variant });
      expect(scene.host.setView).toHaveBeenCalledExactlyOnceWith(scene.view);
      expect(scene.view).toEqual({ overlay, variant, panels: ['data'], focus: [] });
      expect(scene.world.controls.setView).toHaveBeenCalledExactlyOnceWith(100, 120, 640, 51.57, 28.65);
      expect(scene.world.timeOfDay).toBe(21.75);
      expect(scene.ctxLost).toBeNull();
      expect(scene.host.act).not.toHaveBeenCalled();
      expect(scene.host.setSpeed).not.toHaveBeenCalled();
      expect(exactDigest(state)).toBe(before);
    },
  );

  it.each([[0, true], [23.99, true], [14, false]] as const)('keeps hour %s with autoTime=%s', async (hour, autoTime) => {
    const { scene } = restoreScene(Overlay.None, -1, hour, autoTime);
    await proto.restoreViews.call(scene);
    expect(scene.world.timeOfDay).toBe(hour);
    expect(scene.world.autoTime).toBe(autoTime);
  });
});
