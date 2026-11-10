import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { DEFAULT_SETTINGS, type GameSettings } from '../../src/game/settings';
import { PhotoBar, photoFilename, photoSize } from '../../src/ui/PhotoBar';
import { FEl, textNode } from './fakeDom';

let focused: PhotoElement | null = null;
const downloads: { href: string | null; name: string | null }[] = [];
const lifetimes: AbortController[] = [];

class PhotoElement extends FEl {
  inert = false;
  isConnected = true;
  width = 0;
  height = 0;
  focusCalls: unknown[] = [];
  override focus(options?: unknown): void {
    focused = this;
    this.focusCalls.push(options);
  }
  override blur(): void { if (focused === this) focused = null; }
  override click(): void {
    if (this.tagName === 'a') downloads.push({ href: this.getAttribute('href'), name: this.getAttribute('download') });
    super.click();
  }
  dispatchEvent(event: Event): boolean {
    this.fire(event.type, { stopImmediatePropagation() {} });
    return true;
  }
}

function setup(opts: { auto?: boolean; hour?: number; scale?: number; inert?: boolean; photoClass?: boolean; speed?: number } = {}) {
  const abort = new AbortController();
  lifetimes.push(abort);
  const scene = new PhotoElement('div'), root = new PhotoElement('div'), canvas = new PhotoElement('canvas');
  scene.className = 'mp-scene custom' + (opts.photoClass ? ' photo-mode' : '');
  root.className = 'mp-ui custom-hud';
  root.inert = opts.inert ?? false;
  root.style.cssText = 'display:grid;opacity:0.7';
  const panel = new PhotoElement('section');
  panel.className = 'panel open';
  panel.style.cssText = 'left:123px;top:77px';
  root.appendChild(panel);
  scene.append(canvas, root);
  canvas.width = 1920; canvas.height = 1080;
  const originalFocus = new PhotoElement('button');
  panel.appendChild(originalFocus);
  originalFocus.focus();
  const controls = { beginPan: vi.fn() };
  const world = { autoTime: opts.auto ?? true, timeOfDay: opts.hour ?? 10.5, timeScale: opts.scale ?? 2, controls, capture: vi.fn(() => 'data:image/png;base64,cGhvdG8=') };
  const host = {
    speed: opts.speed ?? 1,
    setSpeed: vi.fn((speed: number, _source: string) => { host.speed = speed; }),
    resume: vi.fn((_source: string) => { host.speed = opts.speed || 1; }),
  };
  const active = { id: 'plop:civ_city_hall', leave: vi.fn() };
  const tools = { active, refresh: vi.fn() };
  const settings = Object.freeze({ ...DEFAULT_SETTINGS, keyBindings: Object.freeze({ photo: 'KeyP' }) }) as GameSettings;
  const tip = { hide: vi.fn() }, applySettings = vi.fn();
  const state = { day: 391, config: { name: 'Queensbury', startYear: 2000 } };
  const ctx = { root, canvas, world, host, tools, tip, settings, state, signal: abort.signal, overlay: 3, overlayVariant: 2, applySettings } as unknown as GameContext;
  let now = 1000;
  const photo = new PhotoBar(ctx, scene as unknown as HTMLElement, () => now);
  const button = (text: string) => scene.querySelectorAll('button').find((b) => b.textContent === text)!;
  const status = () => scene.all().find((el) => el.getAttribute('role') === 'status')?.textContent;
  const scrub = (hour: number) => {
    const slider = scene.querySelector('input')!;
    slider.value = String(hour);
    slider.fire('input');
  };
  return { abort, photo, scene, root, canvas, panel, originalFocus, world, host, tools, active, settings, tip, ctx, state, applySettings, button, status, scrub, now: (ms: number) => { now = ms; } };
}

beforeEach(() => {
  focused = null;
  downloads.length = 0;
  vi.stubGlobal('document', {
    createElement: (tag: string) => new PhotoElement(tag),
    createTextNode: textNode,
    get activeElement() { return focused; },
    addEventListener() {},
    removeEventListener() {},
  });
});
afterEach(() => {
  for (const abort of lifetimes.splice(0)) abort.abort();
  vi.unstubAllGlobals();
});

describe('photo mode', () => {
  it.each([false, true])('restores the exact HUD, tool, overlay and focus with prior photo class/inert = %s', (alreadyHidden) => {
    const t = setup({ inert: alreadyHidden, photoClass: alreadyHidden });
    const classes = { scene: t.scene.className, root: t.root.className, panel: t.panel.className };
    const rootStyle = t.root.style.cssText, panelStyle = t.panel.style.cssText;
    const children = [...t.root.childNodes], originalSettings = JSON.stringify(t.settings);
    const cancel = vi.fn();
    t.canvas.addEventListener('pointercancel', cancel);
    t.photo.enter();
    expect(t.photo.active).toBe(true);
    expect(t.root.inert).toBe(true);
    expect(t.scene.classList.contains('photo-mode')).toBe(true);
    expect(t.scene.querySelector('.photo-bar')?.getAttribute('role')).toBe('toolbar');
    expect(focused).toBe(t.button('Exit'));
    expect(cancel).toHaveBeenCalledOnce();
    expect(t.active.leave).toHaveBeenCalledOnce();
    expect(t.tip.hide).toHaveBeenCalledOnce();
    expect(t.tools.active).toBe(t.active);
    t.scrub(21.75);
    t.photo.enter();
    expect(t.scene.querySelectorAll('.photo-bar')).toHaveLength(1);
    t.photo.exit();
    expect(t.photo.active).toBe(false);
    expect(t.scene.className).toBe(classes.scene);
    expect(t.root.className).toBe(classes.root);
    expect(t.panel.className).toBe(classes.panel);
    expect(t.root.inert).toBe(alreadyHidden);
    expect(t.root.style.cssText).toBe(rootStyle);
    expect(t.panel.style.cssText).toBe(panelStyle);
    expect(t.root.childNodes).toEqual(children);
    expect(t.scene.querySelector('.photo-bar')).toBeNull();
    expect(t.tools.active).toBe(t.active);
    expect(t.ctx.overlay).toBe(3);
    expect(t.ctx.overlayVariant).toBe(2);
    expect(t.tools.refresh).toHaveBeenCalledOnce();
    expect(focused).toBe(t.originalFocus);
    expect(t.originalFocus.focusCalls.at(-1)).toEqual({ preventScroll: true });
    expect(JSON.stringify(t.settings)).toBe(originalSettings);
    expect(t.applySettings).not.toHaveBeenCalled();
    t.photo.exit();
    expect(t.tools.refresh).toHaveBeenCalledOnce();
  });

  it('scrubs only the displayed hour and resumes the automatic clock at the elapsed game time', () => {
    const t = setup({ auto: true, hour: 23.5, scale: 2 });
    t.photo.enter();
    expect(t.world.autoTime).toBe(false);
    t.scrub(5.25);
    expect(t.world.timeOfDay).toBe(5.25);
    t.world.timeOfDay = 18;
    t.photo.frame();
    expect(t.world.timeOfDay).toBe(5.25);
    t.now(61000);
    t.photo.exit();
    expect(t.world.autoTime).toBe(true);
    expect(t.world.timeOfDay).toBeCloseTo(1.5, 10);
    expect(t.world.timeScale).toBe(2);
    expect(t.settings.autoTime).toBe(DEFAULT_SETTINGS.autoTime);
    expect(t.settings.fixedHour).toBe(DEFAULT_SETTINGS.fixedHour);
    t.photo.frame();
    expect(t.world.timeOfDay).toBeCloseTo(1.5, 10);
  });

  it('restores a fixed clock exactly regardless of the scrubbed hour and elapsed time', () => {
    const t = setup({ auto: false, hour: 14.25, scale: 3 });
    t.photo.enter();
    t.scrub(0.5);
    t.now(1_000_000);
    t.button('Exit').click();
    expect(t.world.autoTime).toBe(false);
    expect(t.world.timeOfDay).toBe(14.25);
    expect(t.world.timeScale).toBe(3);
  });

  it('pauses and resumes through the host', () => {
    const t = setup({ speed: 2 });
    t.photo.enter();
    t.button('Pause').click();
    expect(t.host.setSpeed).toHaveBeenLastCalledWith(0, 'keyboard');
    expect(t.host.speed).toBe(0);
    t.button('Resume').click();
    expect(t.host.resume).toHaveBeenCalledExactlyOnceWith('keyboard');
    expect(t.host.speed).toBe(2);
    expect(t.host.setSpeed).toHaveBeenCalledTimes(1);
    t.photo.exit();
    expect(t.host.setSpeed).toHaveBeenCalledTimes(1);
  });

  it('sends left drags to camera pan and removes its interception on exit', () => {
    const t = setup(), stop = vi.fn();
    t.photo.enter();
    expect(t.canvas.listenerCount('pointerdown')).toBe(1);
    t.canvas.fire('pointerdown', { button: 0, clientX: 120, clientY: 240, stopImmediatePropagation: stop });
    expect(t.world.controls.beginPan).toHaveBeenCalledWith(120, 240);
    expect(stop).toHaveBeenCalledOnce();
    t.canvas.fire('pointerdown', { button: 2, clientX: 120, clientY: 240, stopImmediatePropagation: stop });
    expect(t.world.controls.beginPan).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    t.photo.exit();
    expect(t.canvas.listenerCount('pointerdown')).toBe(0);
  });

  it.each([[8192, 4320, 4096, 2160], [2160, 8192, 1080, 4096], [1536, 960, 1536, 960]])('captures %s×%s at %s×%s with the player view and a city/date filename', (width, height, expectedWidth, expectedHeight) => {
    const t = setup();
    t.canvas.width = width; t.canvas.height = height;
    t.photo.enter();
    t.button('Capture PNG').click();
    expect(t.world.capture).toHaveBeenCalledWith(expectedWidth, expectedHeight, false);
    expect(Math.max(expectedWidth, expectedHeight)).toBeLessThanOrEqual(4096);
    expect(downloads).toEqual([{ href: 'data:image/png;base64,cGhvdG8=', name: 'Queensbury-2001-02-02.png' }]);
    expect(t.status()).toBe('Captured');
    expect(t.scene.querySelector('a')).toBeNull();
    expect(t.photo.active).toBe(true);
  });

  it('uses the canvas CSS dimensions when no drawing-buffer dimensions are set', () => {
    const t = setup();
    t.canvas.width = t.canvas.height = 0;
    t.canvas.clientWidth = 1600; t.canvas.clientHeight = 900;
    t.photo.enter();
    t.photo.capture();
    expect(t.world.capture).toHaveBeenCalledWith(1600, 900, false);
  });

  it.each(['', 'data:image/jpeg;base64,photo'])('reports an unavailable PNG without a download (%s)', (result) => {
    const t = setup();
    t.world.capture.mockReturnValue(result);
    t.photo.enter();
    t.button('Capture PNG').click();
    expect(t.status()).toBe('Capture failed');
    expect(downloads).toEqual([]);
    expect(t.photo.active).toBe(true);
  });

  it('reports capture exceptions and still permits exiting', () => {
    const t = setup();
    t.world.capture.mockImplementation(() => { throw new Error('WebGL capture unavailable'); });
    t.photo.enter();
    t.button('Capture PNG').click();
    expect(t.status()).toBe('Capture failed');
    expect(downloads).toEqual([]);
    t.button('Exit').click();
    expect(t.photo.active).toBe(false);
    expect(t.root.inert).toBe(false);
  });

  it('aborts by restoring the HUD and clock without reviving the tool or focus', () => {
    const t = setup({ hour: 10, auto: true });
    t.photo.enter();
    const oldBar = t.scene.querySelector('.photo-bar')!;
    t.scrub(19);
    t.now(31000);
    t.abort.abort();
    expect(t.photo.active).toBe(false);
    expect(t.scene.querySelector('.photo-bar')).toBeNull();
    expect(t.scene.classList.contains('photo-mode')).toBe(false);
    expect(t.root.inert).toBe(false);
    expect(t.world.autoTime).toBe(true);
    expect(t.world.timeOfDay).toBe(11);
    expect(t.tools.refresh).not.toHaveBeenCalled();
    expect(t.originalFocus.focusCalls).toHaveLength(1);
    expect(t.canvas.listenerCount('pointerdown')).toBe(0);
    for (const el of oldBar.all()) expect(el.listenerCount()).toBe(0);
    t.photo.enter();
    expect(t.photo.active).toBe(false);
  });

  it('ignores entry when the city has already aborted', () => {
    const t = setup();
    t.abort.abort();
    t.photo.enter();
    expect(t.photo.active).toBe(false);
    expect(t.scene.querySelector('.photo-bar')).toBeNull();
    expect(t.active.leave).not.toHaveBeenCalled();
    expect(t.root.inert).toBe(false);
  });
});

describe('photo export helpers', () => {
  it('caps each orientation at 4096 pixels and retains valid minimum dimensions', () => {
    expect(photoSize(1920, 1080)).toEqual([1920, 1080]);
    expect(photoSize(12000, 6000)).toEqual([4096, 2048]);
    expect(photoSize(6000, 12000)).toEqual([2048, 4096]);
    expect(photoSize(0, 0)).toEqual([16, 16]);
  });

  it('uses the city calendar and removes filename-invalid characters', () => {
    expect(photoFilename(' Queensbury: West/Harbor? ', 0, 2000)).toBe('Queensbury- West-Harbor--2000-01-01.png');
    expect(photoFilename('Queensbury', 359, 2000)).toBe('Queensbury-2000-12-30.png');
    expect(photoFilename('Queensbury', 360, 2000)).toBe('Queensbury-2001-01-01.png');
    expect(photoFilename(' ', 0, 2000)).toBe('City-2000-01-01.png');
  });
});
