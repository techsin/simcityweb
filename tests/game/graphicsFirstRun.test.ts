/**
 * FH-21: the first run picks a graphics quality the machine can carry, a slow High / Ultra city gets one offer to switch
 * to Medium, and a lost WebGL context pauses, saves and rebuilds the views at the same camera without touching the city.
 * (The browser half, WEBGL_lose_context on a real page, is tools/qa-context-loss.mjs.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, applyFirstRunQuality } from '../../src/region/settings';
import { detectQuality } from '../../src/render/world/quality';
import { CityScene } from '../../src/game/CityScene';
import { Toasts } from '../../src/ui/Notifications';
import type { GameContext } from '../../src/game/context';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

const device = (cores: number, ua = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141') => vi.stubGlobal('navigator', { hardwareConcurrency: cores, userAgent: ua });

describe('FH-21: the first run takes its quality from the device', () => {
  it.each([[4, 'medium'], [8, 'high'], [16, 'high'], [2, 'medium']] as const)('a first run with %i cores starts on %s', (cores, q) => {
    device(cores);
    const s = { ...DEFAULT_SETTINGS };
    expect(applyFirstRunQuality(s)).toBe(true);
    expect(s.quality).toBe(q);
    expect(detectQuality()).toBe(q);
  });

  it('a phone starts on Low', () => {
    device(8, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile');
    const s = { ...DEFAULT_SETTINGS };
    applyFirstRunQuality(s);
    expect(s.quality).toBe('low');
  });

  it.each(['metropolis.settings', 'metropolis.settings.v1', 'metropolis.lastRegion', 'metropolis.lastSession'])('an existing profile (%s) keeps its setting', (key) => {
    device(4);
    store.set(key, key === 'metropolis.settings' ? JSON.stringify({ ...DEFAULT_SETTINGS, quality: 'ultra' }) : '{}');
    const s = { ...DEFAULT_SETTINGS, quality: 'ultra' as const };
    expect(applyFirstRunQuality(s)).toBe(false);
    expect(s.quality).toBe('ultra');
  });

  it('the app applies it before anything else and saves it, so it holds from then on', () => {
    const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
    const ctor = main.slice(main.indexOf('  constructor(host: HTMLElement) {'));
    expect(ctor.split('\n')[2].trim()).toBe('if (applyFirstRunQuality(this.settings)) saveSettings(this.settings);');
  });
});

// ------------------------------------------------------------------ the slow-frame prompt
type Scene = Record<string, unknown>;
const proto = CityScene.prototype as unknown as Record<string, (this: Scene, ...a: unknown[]) => unknown>;

function slowScene(quality = 'high') {
  const shown: { text: string; opts: { buttons?: { label: string; run(): void }[] } }[] = [];
  const scene: Scene = {
    slow: [], settings: { quality }, firstFrame: true, ctxLost: null,
    toasts: { show: (text: string, _k: string, _c: unknown, _t: string, opts: never) => shown.push({ text, opts }) },
    applySettings: vi.fn((p: { quality?: string }) => Object.assign(scene.settings as object, p)),
  };
  const tick = (fps: number, seconds: number) => { for (let t = 0; t < seconds; t += 0.5) proto.checkSlow.call(scene, fps, 0.5); };
  return { scene, shown, tick };
}

describe('FH-21: one offer to switch a slow city to Medium', () => {
  it('after 20 s at a median under 25 fps on High: the toast, with Switch and Keep', () => {
    const { scene, shown, tick } = slowScene();
    tick(12, 19.5);
    expect(shown).toHaveLength(0);
    tick(12, 0.5);
    expect(shown).toHaveLength(1);
    expect(shown[0].text).toBe('The city is running slowly — switch graphics to Medium?');
    expect(shown[0].opts.buttons!.map((b) => b.label)).toEqual(['Switch', 'Keep']);
    // shown: remembered for the profile at once, and never again in this city
    expect(JSON.parse(store.get('metropolis.ui.slowPrompt')!)).toMatchObject({ shown: true });
    tick(5, 60);
    expect(shown).toHaveLength(1);
    shown[0].opts.buttons![0].run();
    expect(scene.applySettings).toHaveBeenCalledWith({ quality: 'medium' });
    expect(JSON.parse(store.get('metropolis.ui.slowPrompt')!)).toMatchObject({ answer: 'switch' });
  });

  it('Keep is remembered too and changes nothing', () => {
    const { scene, shown, tick } = slowScene('ultra');
    tick(8, 20);
    shown[0].opts.buttons![1].run();
    expect(scene.applySettings).not.toHaveBeenCalled();
    expect(JSON.parse(store.get('metropolis.ui.slowPrompt')!)).toMatchObject({ answer: 'keep' });
  });

  it('not on Medium or Low, not at a median of 25 fps or more, and a quality change restarts the 20 s', () => {
    for (const q of ['medium', 'low']) {
      const { shown, tick } = slowScene(q);
      tick(5, 60);
      expect(shown, q).toHaveLength(0);
    }
    const fast = slowScene();
    for (let k = 0; k < 120; k++) proto.checkSlow.call(fast.scene, k % 3 ? 40 : 10, 0.5);
    expect(fast.shown).toHaveLength(0);
    const { scene, shown, tick } = slowScene();
    tick(10, 15);
    (scene.settings as { quality: string }).quality = 'medium';
    tick(10, 1);
    (scene.settings as { quality: string }).quality = 'high';
    tick(10, 15);
    expect(shown).toHaveLength(0);
    tick(10, 5);
    expect(shown).toHaveLength(1);
  });

  it('the window starts with the first rendered frame: a slow first render behind the loading screen does not count', () => {
    const { scene, shown, tick } = slowScene();
    scene.firstFrame = false;
    tick(1, 60);
    expect(shown).toHaveLength(0);
    scene.firstFrame = true;
    tick(10, 19.5);
    expect(shown).toHaveLength(0);
    tick(10, 0.5);
    expect(shown).toHaveLength(1);
    const src = readFileSync(new URL('../../src/game/CityScene.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/this\.readyPending = false;\s*this\.firstFrame = true;\s*this\.resolveReady\(\);/);
  });

  it('a profile that saw it never gets it again (the scene starts without a window)', () => {
    const src = readFileSync(new URL('../../src/game/CityScene.ts', import.meta.url), 'utf8');
    expect(src).toContain('private slow: { fps: number; dt: number }[] | null = loadPref<unknown>(SLOW_PREF, null) === null ? [] : null;');
    const { scene, shown } = slowScene();
    scene.slow = null;
    for (let k = 0; k < 100; k++) proto.checkSlow.call(scene, 3, 0.5);
    expect(shown).toHaveLength(0);
  });

  it('the question toast: each answer runs once and closes it; a click on the toast itself does nothing', () => {
    const root = new FEl('div');
    const ctx = { signal: new AbortController().signal, sim: { events: { on: () => () => {} } }, settings: { toasts: true }, mods: {}, root, sound() {}, focusCell: vi.fn() } as unknown as GameContext;
    vi.stubGlobal('window', { setTimeout: () => 1 });
    const toasts = new Toasts(ctx, root as unknown as HTMLElement);
    const run = vi.fn();
    toasts.show('Question?', 'warning', { x: 1, z: 1 }, 'Graphics', { buttons: [{ label: 'Yes', primary: true, run }, { label: 'No', run() {} }] });
    const t = (toasts.el as unknown as FEl).querySelector('.toast')!;
    expect(t.querySelectorAll('.t-btn').map((b) => textOf(b))).toEqual(['Yes', 'No']);
    t.click();
    expect(ctx.focusCell).not.toHaveBeenCalled();
    expect(t.classList.contains('out')).toBe(false);
    t.querySelector('.t-btn')!.click();
    expect(run).toHaveBeenCalledTimes(1);
    expect(t.classList.contains('out')).toBe(true);
  });

  it('a question stays until it is answered (no timer, no countdown bar); with its own ttl it expires', () => {
    const root = new FEl('div');
    const ctx = { signal: new AbortController().signal, sim: { events: { on: () => () => {} } }, settings: { toasts: true }, mods: {}, root, sound() {}, focusCell: vi.fn() } as unknown as GameContext;
    const timers: number[] = [];
    vi.stubGlobal('window', { setTimeout: (_f: () => void, ms: number) => (timers.push(ms), timers.length) });
    const toasts = new Toasts(ctx, root as unknown as HTMLElement);
    toasts.show('Question?', 'warning', undefined, 'Graphics', { buttons: [{ label: 'Yes', run() {} }] });
    expect(timers).toEqual([]);
    expect((toasts.el as unknown as FEl).querySelector('.t-timer')!.style.display).toBe('none');
    toasts.show('Timed question?', 'warning', undefined, 'Graphics', { ttl: 5000, buttons: [{ label: 'Yes', run() {} }] });
    expect(timers).toEqual([5000]);
  });

  it('news toasts never push a question out (a busy city filled the stack within a second)', () => {
    const root = new FEl('div');
    root.classList.add('short');
    const ctx = { signal: new AbortController().signal, sim: { events: { on: () => () => {} } }, settings: { toasts: true }, mods: {}, root, sound() {}, focusCell: vi.fn() } as unknown as GameContext;
    vi.stubGlobal('window', { setTimeout: () => 1 });
    const toasts = new Toasts(ctx, root as unknown as HTMLElement);
    toasts.show('Question?', 'warning', undefined, 'Graphics', { buttons: [{ label: 'Yes', run() {} }] });
    for (let k = 0; k < 6; k++) toasts.show(`News ${k}`, 'good');
    const el = toasts.el as unknown as FEl;
    expect(el.children).toHaveLength(3);
    expect(el.querySelectorAll('.toast.question')).toHaveLength(1);
    expect(el.children.map((c) => textOf(c.querySelector('.t-text')!))).toEqual(['Question?', 'News 5', 'News 4']);
  });
});

// ------------------------------------------------------------------ a lost graphics context
function lostScene() {
  const calls: string[] = [];
  const state = { size: 128, day: 777, systemData: { camera: { x: 1, z: 2, distance: 300 } }, buildings: new Map() };
  const view = (name: string) => {
    const controls = { target: { x: 1000, y: 0, z: 1200 }, distance: 640, yawAngle: 0.5, tiltAngle: 0.9, setView: vi.fn() };
    return { name, controls, dispose: () => calls.push(`dispose ${name}`) };
  };
  const uiRoot = new FEl('div');
  const scene: Scene = {
    disposed: false, ctxLost: null, uiRoot, abort: new AbortController(), settings: { quality: 'high' },
    world: view('world 1'), objects: view('objects 1'),
    host: { speed: 2, setSpeed: vi.fn((v: number) => { (scene.host as { speed: number }).speed = v; }) },
    sim: { state },
    minimap: { markDirty: () => calls.push('minimap') },
    storeCamera: () => calls.push('storeCamera'),
    save: vi.fn(async () => { calls.push('save'); }),
    sound: (n: string) => calls.push(`sound ${n}`),
    swapCanvas: () => calls.push('swapCanvas'),
    createViews: () => { calls.push('createViews'); scene.world = view('world 2'); scene.objects = view('objects 2'); },
    resize: () => calls.push('resize'),
    applySettings: () => calls.push('applySettings'),
    placeInitialCamera: () => calls.push('placeInitialCamera'),
  };
  // the handlers under test, from the real class
  scene.onContextLost = proto.onContextLost;
  scene.restoreViews = proto.restoreViews;
  return { scene, calls, state, uiRoot };
}

describe('FH-21: a lost graphics context', () => {
  it('pauses the game, saves, and shows "Graphics reset — Restore"', () => {
    const { scene, calls, uiRoot } = lostScene();
    proto.onContextLost.call(scene);
    expect((scene.host as { setSpeed: ReturnType<typeof vi.fn> }).setSpeed).toHaveBeenCalledWith(0, 'error');
    expect(calls.slice(0, 2)).toEqual(['storeCamera', 'save']);
    const card = uiRoot.querySelector('.ctx-lost')!;
    expect(textOf(card)).toMatch(/^Graphics reset/);
    expect(card.querySelector('button')!.textContent).toBe('Restore');
    // the HUD root passes pointer events through to the canvas: the card takes them back, or Restore cannot be clicked
    expect(card.style.cssText).toContain('pointer-events:auto');
    // a second loss event while the card is up changes nothing
    proto.onContextLost.call(scene);
    expect(uiRoot.querySelectorAll('.ctx-lost')).toHaveLength(1);
    expect(scene.save).toHaveBeenCalledTimes(1);
  });

  it('Restore rebuilds both views on a fresh canvas at the lost view\'s camera; the city and its pause are untouched', async () => {
    const { scene, calls, state, uiRoot } = lostScene();
    const before = JSON.stringify(state);
    proto.onContextLost.call(scene);
    calls.length = 0;
    uiRoot.querySelector('.ctx-lost')!.querySelector('button')!.click();
    await Promise.resolve();
    expect(calls).toEqual(['dispose objects 1', 'dispose world 1', 'swapCanvas', 'createViews', 'resize', 'applySettings', 'minimap', 'sound confirm']);
    const ctl = (scene.world as { controls: { setView: ReturnType<typeof vi.fn> } }).controls;
    // the camera of the lost view (readCamera: m, degrees), not a fresh start view
    expect(ctl.setView).toHaveBeenCalledWith(1000, 1200, 640, 51.57, 28.65);
    expect(uiRoot.querySelectorAll('.ctx-lost')).toHaveLength(0);
    expect(scene.ctxLost).toBeNull();
    expect((scene.host as { speed: number }).speed).toBe(0);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('the browser handing the context back (webglcontextrestored) restores the same way, once', async () => {
    const { scene, calls } = lostScene();
    const canvas = new FEl('canvas');
    proto.watchContext.call(scene, canvas);
    let prevented = false;
    canvas.fire('webglcontextlost', { preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    expect(scene.ctxLost).not.toBeNull();
    canvas.fire('webglcontextrestored');
    canvas.fire('webglcontextrestored');
    await Promise.resolve();
    expect(calls.filter((c) => c === 'createViews')).toHaveLength(1);
    expect(scene.ctxLost).toBeNull();
    // disposing the old views forces a loss on the old (restored) canvas: that is not a new loss
    canvas.fire('webglcontextlost', { preventDefault() {} });
    expect(scene.ctxLost).toBeNull();
    expect(scene.save).toHaveBeenCalledTimes(1);
    expect(canvas.listenerCount()).toBe(0);
  });
});
