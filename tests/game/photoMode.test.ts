import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Overlay } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import { DEFAULT_SETTINGS, type GameSettings } from '../../src/game/settings';
import { QueryTool } from '../../src/game/tools/QueryTool';
import { PhotoBar, photoFilename, photoSize, pngBlob, type PhotoHooks } from '../../src/ui/PhotoBar';
import { FEl, textNode } from './fakeDom';

let focused: PhotoElement | null = null;
const downloads: { href: string | null; name: string | null }[] = [];
const lifetimes: AbortController[] = [];
/** the capture's data: link ("photo" as base64) */
const PNG = 'data:image/png;base64,cGhvdG8=';

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

type Opts = { auto?: boolean; hour?: number; scale?: number; inert?: boolean; photoClass?: boolean; speed?: number; overlay?: Overlay; tool?: string | null; showGrid?: boolean; hooks?: PhotoHooks };

function setup(opts: Opts = {}) {
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
  /** what the renderers were last told to draw (the picture) */
  const drawn = { grid: true, overlay: opts.overlay ?? 3, overlayMode: opts.overlay ?? 3, underground: opts.tool === 'subway', selected: 41 as number | null };
  const world = {
    autoTime: opts.auto ?? true, timeOfDay: opts.hour ?? 10.5, timeScale: opts.scale ?? 2, controls, capture: vi.fn(() => PNG),
    setGridVisible: vi.fn((on: boolean) => { drawn.grid = on; }), setOverlay: vi.fn((o: number) => { drawn.overlay = o; }),
  };
  const objects = {
    setSelected: vi.fn((id: number | null) => { drawn.selected = id; }), setOverlayMode: vi.fn((o: number) => { drawn.overlayMode = o; }),
    setUnderground: vi.fn((on: boolean) => { drawn.underground = on; }),
  };
  const host = {
    speed: opts.speed ?? 1,
    setSpeed: vi.fn((speed: number, _source: string) => { host.speed = speed; }),
    resume: vi.fn((_source: string) => { host.speed = 0; }),
  };
  const active = { id: opts.tool === undefined ? 'plop:civ_city_hall' : opts.tool ?? 'query', leave: vi.fn(), wantsGrid: opts.tool !== null };
  const tools = { active, activeId: opts.tool === undefined ? 'plop:civ_city_hall' : opts.tool, refresh: vi.fn() };
  const settings = Object.freeze({ ...DEFAULT_SETTINGS, showGrid: opts.showGrid ?? true, keyBindings: Object.freeze({ photo: 'KeyP' }) }) as GameSettings;
  const tip = { hide: vi.fn() }, applySettings = vi.fn();
  const state = { day: 391, config: { name: 'Queensbury', startYear: 2000 } };
  const ctx = {
    root, canvas, world, objects, host, tools, tip, settings, state, signal: abort.signal, overlay: opts.overlay ?? 3, overlayVariant: 2, applySettings,
    // (the scene's setOverlay: the data view back on the renderers, from the HUD's state)
    setOverlay: vi.fn((o: number) => { drawn.overlay = drawn.overlayMode = o; }),
  } as unknown as GameContext & { setOverlay: ReturnType<typeof vi.fn> };
  let now = 1000;
  // (the capture runs after a painted frame in the browser: at once here unless a test holds it)
  const photo = new PhotoBar(ctx, scene as unknown as HTMLElement, () => now, { afterPaint: (f) => f(), ...opts.hooks });
  const button = (text: string) => scene.querySelectorAll('button').find((b) => b.textContent === text)!;
  const status = () => scene.all().find((el) => el.getAttribute('role') === 'status')?.textContent;
  const scrub = (hour: number) => {
    const slider = scene.querySelector('input')!;
    slider.value = String(hour);
    slider.fire('input');
  };
  return { abort, photo, scene, root, canvas, panel, originalFocus, world, objects, drawn, host, tools, active, settings, tip, ctx, state, applySettings, button, status, scrub, now: (ms: number) => { now = ms; } };
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
  vi.restoreAllMocks();
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

  // QA B5: Fast, Pause, Resume gave Normal; once the pause menu had been opened on a paused game, Resume did nothing
  it.each([1, 2, 3])('Resume returns to the speed the bar paused from (%i), through setSpeed and never host.resume', (speed) => {
    const t = setup({ speed });
    t.photo.enter();
    expect(t.button('Pause')).toBeDefined();
    t.button('Pause').click();
    expect(t.host.setSpeed).toHaveBeenLastCalledWith(0, 'keyboard');
    expect(t.host.speed).toBe(0);
    t.button('Resume').click();
    expect(t.host.setSpeed).toHaveBeenLastCalledWith(speed, 'keyboard');
    expect(t.host.speed).toBe(speed);
    expect(t.button('Pause')).toBeDefined();
    expect(t.host.resume).not.toHaveBeenCalled();
    expect(t.host.setSpeed).toHaveBeenCalledTimes(2);
    t.photo.exit();
    expect(t.host.setSpeed).toHaveBeenCalledTimes(2);
    expect(t.host.speed).toBe(speed);
  });

  it('entered on a paused game, Resume starts the scene\'s last running speed (Normal when it knows none)', () => {
    const fast = setup({ speed: 0, hooks: { lastSpeed: () => 2 } });
    fast.photo.enter();
    fast.button('Resume').click();
    expect(fast.host.setSpeed).toHaveBeenCalledExactlyOnceWith(2, 'keyboard');
    const fresh = setup({ speed: 0 });
    fresh.photo.enter();
    fresh.button('Resume').click();
    expect(fresh.host.setSpeed).toHaveBeenCalledExactlyOnceWith(1, 'keyboard');
    expect(fresh.host.resume).not.toHaveBeenCalled();
  });

  it('the button follows the speed when it changes under the bar (an emergency pause, a late acknowledgement)', () => {
    const t = setup({ speed: 2 });
    t.photo.enter();
    t.host.speed = 0;
    t.photo.frame();
    expect(t.button('Resume')).toBeDefined();
    t.host.speed = 3;
    t.photo.frame();
    expect(t.button('Pause')).toBeDefined();
    // (a pause the bar did not make resumes to what the bar itself last paused from, else the scene's speed, else Normal)
    t.host.speed = 0;
    t.photo.frame();
    t.button('Resume').click();
    expect(t.host.setSpeed).toHaveBeenCalledExactlyOnceWith(1, 'keyboard');
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

  // QA B9: a click on the bar reached the toolbar's document-level "click outside" closer and shut an open flyout
  it('keeps every press in photo mode below the document, and lets them through again after leaving', () => {
    const t = setup(), stop = vi.fn();
    expect(t.scene.listenerCount('pointerdown')).toBe(0);
    t.photo.enter();
    // (the event bubbles from the bar, or from the map on a right drag, up to the scene)
    t.scene.fire('pointerdown', { target: t.button('Capture PNG'), stopPropagation: stop });
    t.scene.fire('pointerdown', { target: t.canvas, button: 2, stopPropagation: stop });
    expect(stop).toHaveBeenCalledTimes(2);
    t.photo.exit();
    expect(t.scene.listenerCount('pointerdown')).toBe(0);
  });

  it.each([[8192, 4320, 4096, 2160], [2160, 8192, 1080, 4096], [1536, 960, 1536, 960]])('captures %s×%s at %s×%s with the player view and a city/date filename', async (width, height, expectedWidth, expectedHeight) => {
    const t = setup(), blobs: Blob[] = [];
    const link = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { blobs.push(blob as Blob); return 'blob:photo'; });
    t.canvas.width = width; t.canvas.height = height;
    t.photo.enter();
    t.button('Capture PNG').click();
    expect(t.world.capture).toHaveBeenCalledWith(expectedWidth, expectedHeight, false);
    expect(Math.max(expectedWidth, expectedHeight)).toBeLessThanOrEqual(4096);
    // (the PNG's bytes behind a blob: link: the download starts without a multi-megabyte data: URL)
    expect(downloads).toEqual([{ href: 'blob:photo', name: 'Queensbury-2001-02-02.png' }]);
    expect(link).toHaveBeenCalledOnce();
    expect(blobs[0].type).toBe('image/png');
    expect(await blobs[0].text()).toBe('photo');
    expect(t.status()).toBe('Captured');
    expect(t.scene.querySelector('a')).toBeNull();
    expect(t.photo.active).toBe(true);
  });

  it('falls back to the data: link where Blob links are not available', () => {
    const t = setup();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('no Blob URLs'); });
    t.photo.enter();
    t.button('Capture PNG').click();
    expect(downloads).toEqual([{ href: PNG, name: 'Queensbury-2001-02-02.png' }]);
    expect(t.status()).toBe('Captured');
  });

  // QA B13: at the 4096 px cap the capture held the main thread for 0.6 to 2.6 s with nothing on screen saying so
  it('says "Capturing…" and locks the button before the capture starts, then reports it', () => {
    let paint: (() => void) | null = null;
    const t = setup({ hooks: { afterPaint: (f) => { paint = f; } } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
    t.photo.enter();
    const capture = t.button('Capture PNG');
    capture.click();
    expect(t.status()).toBe('Capturing…');
    expect(capture.disabled).toBe(true);
    expect(t.world.capture).not.toHaveBeenCalled();
    // (a second click while it waits or runs starts nothing)
    capture.click();
    expect(paint).not.toBeNull();
    paint!();
    expect(t.world.capture).toHaveBeenCalledOnce();
    expect(t.status()).toBe('Captured');
    expect(capture.disabled).toBe(false);
    expect(downloads).toHaveLength(1);
    capture.click();
    paint!();
    expect(t.world.capture).toHaveBeenCalledTimes(2);
  });

  it('a capture still waiting for its frame does not run after leaving', () => {
    let paint: (() => void) | null = null;
    const t = setup({ hooks: { afterPaint: (f) => { paint = f; } } });
    t.photo.enter();
    t.button('Capture PNG').click();
    t.photo.exit();
    paint!();
    expect(t.world.capture).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
    // (and the next visit starts unlocked)
    t.photo.enter();
    expect(t.button('Capture PNG').disabled).toBe(false);
    expect(t.status()).toBe('');
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
    expect(t.button('Capture PNG').disabled).toBe(false);
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
    const drawnAtAbort = t.ctx.setOverlay.mock.calls.length + t.world.setGridVisible.mock.calls.length;
    t.abort.abort();
    expect(t.photo.active).toBe(false);
    expect(t.scene.querySelector('.photo-bar')).toBeNull();
    expect(t.scene.classList.contains('photo-mode')).toBe(false);
    expect(t.root.inert).toBe(false);
    expect(t.world.autoTime).toBe(true);
    expect(t.world.timeOfDay).toBe(11);
    expect(t.tools.refresh).not.toHaveBeenCalled();
    // (the views are going with the city: nothing is drawn back on them)
    expect(t.ctx.setOverlay.mock.calls.length + t.world.setGridVisible.mock.calls.length).toBe(drawnAtAbort);
    expect(t.originalFocus.focusCalls).toHaveLength(1);
    expect(t.canvas.listenerCount('pointerdown')).toBe(0);
    expect(t.scene.listenerCount('pointerdown')).toBe(0);
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

// QA B6: the hover box was in the downloaded PNG; the tool's grid, its automatic overlay and a data view stayed in it
describe('the picture shows the plain city (QA B6)', () => {
  it('the grid, the data view and the selection box leave the renderers on entering, and come back from the HUD\'s state', () => {
    const t = setup({ overlay: Overlay.Traffic, hooks: { inspected: () => 41 } });
    t.photo.enter();
    expect(t.drawn).toEqual({ grid: false, overlay: Overlay.None, overlayMode: Overlay.None, underground: false, selected: null });
    // the HUD's own state is not touched: the data view and the tool are still chosen
    expect(t.ctx.overlay).toBe(Overlay.Traffic);
    expect(t.ctx.setOverlay).not.toHaveBeenCalled();
    expect(t.tools.active).toBe(t.active);
    t.photo.exit();
    expect(t.ctx.setOverlay).toHaveBeenCalledExactlyOnceWith(Overlay.Traffic, 2);
    // (the inspector's building has its box again; the tool's own hover follows with its next move: refresh())
    expect(t.drawn).toEqual({ grid: true, overlay: Overlay.Traffic, overlayMode: Overlay.Traffic, underground: false, selected: 41 });
    expect(t.tools.refresh).toHaveBeenCalledOnce();
  });

  it('with no data view, no inspector and no tool nothing is switched on when leaving', () => {
    const t = setup({ overlay: Overlay.None, tool: null });
    t.photo.enter();
    t.photo.exit();
    expect(t.ctx.setOverlay).not.toHaveBeenCalled();
    expect(t.drawn).toEqual({ grid: false, overlay: Overlay.None, overlayMode: Overlay.None, underground: false, selected: null });
    expect(t.objects.setUnderground).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('the grid stays off for a player who switched it off, and the subway view comes back with the subway tool', () => {
    const off = setup({ showGrid: false });
    off.photo.enter();
    off.photo.exit();
    expect(off.drawn.grid).toBe(false);
    const subway = setup({ tool: 'subway', overlay: Overlay.None });
    subway.photo.enter();
    expect(subway.drawn.underground).toBe(false);
    subway.photo.exit();
    expect(subway.drawn.underground).toBe(true);
    expect(subway.drawn.grid).toBe(true);
  });

  it('a renderer without one of the calls (a stand-in view) does not stop photo mode', () => {
    const t = setup();
    t.world.setOverlay.mockImplementation(() => { throw new Error('stand-in'); });
    t.objects.setSelected.mockImplementation(() => { throw new Error('stand-in'); });
    t.photo.enter();
    expect(t.photo.active).toBe(true);
    expect(t.drawn.grid).toBe(false);
    t.photo.exit();
    expect(t.photo.active).toBe(false);
    expect(t.drawn.grid).toBe(true);
  });

  it('the Query tool drops its hover box for the photo and applies its pick again with the next move', () => {
    const setSelected = vi.fn(), hide = vi.fn();
    let under: number | null = 7;
    const ctx = {
      objects: { pickBuilding: () => under, setSelected }, tip: { show: vi.fn(), hide }, overlay: Overlay.None, overlayVariant: -1,
      state: { day: 0, buildings: new Map(), idx: () => 0, network: [0], zone: [0] },
    } as unknown as GameContext;
    const tool = new QueryTool(ctx, false), at = { clientX: 5, clientY: 5, hit: null, shift: false, ctrl: false, alt: false, down: false };
    tool.move(at);
    tool.move(at);
    expect(setSelected.mock.calls).toEqual([[7]]);
    tool.clearHover();
    expect(setSelected).toHaveBeenLastCalledWith(null);
    expect(hide).toHaveBeenCalled();
    // the pointer still rests on the same building: its box comes back
    tool.move(at);
    expect(setSelected.mock.calls).toEqual([[7], [null], [7]]);
    // and over open land after a photo, the cleared state is applied once, not skipped
    tool.clearHover();
    under = null;
    tool.move(at);
    tool.move(at);
    expect(setSelected.mock.calls).toEqual([[7], [null], [7], [null], [null]]);
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

  it('turns the capture\'s data: link into the same bytes as a PNG blob', async () => {
    const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128]);
    const blob = pngBlob('data:image/png;base64,' + Buffer.from(bytes).toString('base64'));
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });
});
