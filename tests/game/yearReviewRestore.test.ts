/** LG-21: restoring graphics during an active New Year show must release the Gazette's busy gate. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { CityScene } from '../../src/game/CityScene';
import { NewYearCelebration } from '../../src/game/NewYear';
import type { GameContext, UIEvents } from '../../src/game/context';
import { NullObjectsView, NullWorldView } from '../../src/game/fallback/NullViews';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import { CityState, HISTORY_KEYS } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import type { CityEvents, Simulation } from '../../src/sim/Simulation';
import { YearReview } from '../../src/ui/YearReview';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();

/** Fireworks.dispose hides/disposes its GPU resources but leaves isRunning unchanged. */
class LostFireworks {
  isRunning = false;
  disposed = false;
  fading = false;
  timeScale = 1;
  onSound: unknown = null;
  midnight = 0;
  get active(): boolean { return this.isRunning; }
  get settled(): boolean { return this.fading || !this.isRunning; }
  start(options: { delay?: number }): void {
    this.midnight = options.delay ?? 0;
    this.isRunning = true;
  }
  stop(): void { this.isRunning = false; }
  fastForward(): void {}
  dispose(): void { this.disposed = true; }
}

describe('year review graphics recovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('shows after the celebration phase ends while its final sparks are still fading', () => {
    const state = new CityState(defaultCityConfig({ size: 16, startYear: 2000 }));
    for (let t = 0; t <= 12; t++) {
      for (const key of HISTORY_KEYS) state.history[key].push(0);
      state.history.t[t] = t; state.history.pop[t] = 1000 + 10 * t;
    }
    state.stats.population = 1120;
    const events = new Emitter<CityEvents>(), ui = new Emitter<UIEvents>(), abort = new AbortController();
    const root = new FEl('div'), map = new FEl('div'), canvas = new FEl('canvas');
    map.append(canvas, root); vi.stubGlobal('window', new FEl('window'));
    const settings = { ...DEFAULT_SETTINGS, newYear: 'fireworks' as const };
    const sim = { state, events, speed: 1 } as unknown as Simulation;
    const fw = new LostFireworks();
    const ny = new NewYearCelebration({ sim, world: () => new NullWorldView(),
      objects: () => Object.assign(new NullObjectsView(), { fireworks: fw }), settings: () => settings, toast() {} });
    vi.spyOn(ny as unknown as { loadAudio(): void }, 'loadAudio').mockImplementation(() => undefined);
    const host = { events, speed: 1, policy: { live: false, subscribe: () => () => undefined } };
    const ctx = { state, host, ui, settings, root, canvas, signal: abort.signal } as unknown as GameContext;
    new YearReview(ctx, { busy: () => ny.active });
    try {
      ui.emit('viewsReady', undefined); state.day = 360; ny.frame(0.1, 1000); events.emit('year', 2001);
      for (let i = 1; i <= 50; i++) ny.frame(0.1, 1000 + i * 100);
      expect(ny['phase']).toBe('show'); ui.emit('uiTick', undefined);
      expect(root.querySelector('.year-review')).toBeNull();
      fw.fading = true;
      for (let i = 51; i <= 100; i++) ny.frame(0.1, 1000 + i * 100);
      expect(ny.active).toBe(false); expect(ny.busy).toBe(true); expect(fw.isRunning).toBe(true);
      ui.emit('uiTick', undefined);
      expect(textOf(root.querySelector('.year-review')!)).toContain('Figures on 1 January 2001');
    } finally { ny.dispose(); abort.abort(); }
  });

  it('cancels an active show before disposing its view, then releases this and later yearly cards', async () => {
    const state = new CityState(defaultCityConfig({ size: 16, seed: 7, startYear: 2000, name: 'Queensbury' }));
    for (let t = 0; t <= 24; t++) {
      for (const key of HISTORY_KEYS) state.history[key].push(0);
      state.history.t[t] = t;
      state.history.pop[t] = 1000 + t * 10;
      state.history.approval[t] = 60;
    }
    state.stats.population = 1240;
    const events = new Emitter<CityEvents>(), ui = new Emitter<UIEvents>();
    const sim = { state, events, speed: 1 } as unknown as Simulation;
    const abort = new AbortController(), ctxWatch = new AbortController();
    const root = new FEl('div'), map = new FEl('div'), canvas = new FEl('canvas'), lostCard = new FEl('div');
    map.append(canvas, root);
    root.appendChild(lostCard);
    vi.stubGlobal('window', new FEl('window'));
    const settings = { ...DEFAULT_SETTINGS, newYear: 'fireworks' as const };
    const host = { events, speed: 1, policy: { live: false, subscribe: () => () => undefined } };
    const ctx = { state, host, ui, settings, root, canvas, signal: abort.signal } as unknown as GameContext;
    const oldFireworks = new LostFireworks(), freshFireworks = new LostFireworks();
    const oldObjects = Object.assign(new NullObjectsView(), { fireworks: oldFireworks });
    const freshObjects = Object.assign(new NullObjectsView(), { fireworks: freshFireworks });
    const oldWorld = new NullWorldView(), freshWorld = new NullWorldView();
    const order: string[] = [];
    vi.spyOn(oldFireworks, 'stop').mockImplementation(() => { order.push('stop'); oldFireworks.isRunning = false; });
    vi.spyOn(oldObjects, 'dispose').mockImplementation(() => { order.push('objects.dispose'); oldFireworks.dispose(); });
    vi.spyOn(oldWorld, 'dispose').mockImplementation(() => { order.push('world.dispose'); });
    // Exercise the real restore method; only its renderer construction, layout and audio are stand-ins.
    const scene = {
      disposed: false, ctxLost: { card: lostCard, restoring: false } as { card: FEl; restoring: boolean } | null,
      sim, world: oldWorld, objects: oldObjects, canvas, ctxWatch,
      newYear: null as unknown as NewYearCelebration,
      swapCanvas() {
        this.canvas.remove();
        this.canvas = new FEl('canvas');
        map.appendChild(this.canvas);
        (ctx as unknown as { canvas: FEl }).canvas = this.canvas;
      },
      createViews() { this.world = freshWorld; this.objects = freshObjects; },
      resize() {}, applySettings() {}, placeInitialCamera() {}, sound() {}, minimap: { markDirty() {} },
    };
    const ny = scene.newYear = new NewYearCelebration({
      sim, signal: abort.signal, world: () => scene.world, objects: () => scene.objects,
      settings: () => settings, toast() {},
    });
    vi.spyOn(ny as unknown as { loadAudio(): void }, 'loadAudio').mockImplementation(() => undefined);
    new YearReview(ctx, { busy: () => ny.active });
    const card = () => root.querySelector('.year-review');
    let now = 1000;
    const step = (seconds: number) => {
      for (let i = 0; i < seconds * 10; i++) ny.frame(0.1, now += 100);
    };
    const year = (year: number) => {
      state.day = (year - 2000) * 360;
      ny.frame(0.1, now += 100);
      events.emit('year', year);
    };
    try {
      ui.emit('viewsReady', undefined);
      year(2001);
      step(5);
      expect(ny['phase']).toBe('show');
      expect(oldFireworks.isRunning).toBe(true);
      expect(ny.busy).toBe(true);
      expect(card()).toBeNull();

      await (CityScene.prototype as unknown as { restoreViews(this: unknown): Promise<void> }).restoreViews.call(scene);
      expect(order).toEqual(['stop', 'objects.dispose', 'world.dispose']);
      expect(oldFireworks.disposed).toBe(true);
      expect(oldFireworks.isRunning).toBe(false);
      expect(ctxWatch.signal.aborted).toBe(true);
      expect(scene.canvas).not.toBe(canvas);
      expect(scene.ctxLost).toBeNull();
      expect(ny.busy).toBe(false);
      ui.emit('uiTick', undefined);
      expect(textOf(card()!)).toContain('Queensbury Gazette');
      expect(card()!.getAttribute('aria-label')).toContain('2001');
      card()!.querySelector('.yr-close')!.click();

      year(2002);
      step(5);
      expect(ny['phase']).toBe('show');
      expect(freshFireworks.isRunning).toBe(true);
      expect(card()).toBeNull();
      freshFireworks.stop();
      step(5);
      expect(ny.busy).toBe(false);
      ui.emit('uiTick', undefined);
      expect(card()!.getAttribute('aria-label')).toContain('2002');
    } finally {
      ny.dispose();
      abort.abort('dispose');
    }
  });
});
