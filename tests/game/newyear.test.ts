/** NewYearCelebration: triggering, cinematic time-lapse to midnight, countdown timing and giving the clock back. */
import { describe, expect, it } from 'vitest';
import { Emitter } from '../../src/core/events';
import { NewYearCelebration } from '../../src/game/NewYear';
import { DEFAULT_SETTINGS, type GameSettings } from '../../src/game/settings';
import type { Simulation, CityEvents } from '../../src/sim/Simulation';
import type { CityObjectsViewApi, WorldViewApi } from '../../src/render/contracts';

class FakeWorld {
  autoTime = true;
  timeScale = 2;
  private h = 10.5;
  forced = 0;
  camera = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 500, 0, 1] } };
  get timeOfDay() {
    return this.h;
  }
  set timeOfDay(v: number) {
    this.h = ((v % 24) + 24) % 24;
    this.forced++;
  }
  update(dt: number) {
    if (this.autoTime) this.h = (this.h + (dt * this.timeScale) / 60) % 24;
  }
}

class FakeFireworks {
  activeFor = 0;
  started: { population?: number; delay?: number } | null = null;
  timeScale = 1;
  onSound: unknown = null;
  t = 0;
  get active() {
    return this.t < this.activeFor;
  }
  get midnight() {
    return this.started?.delay ?? 0;
  }
  start(o: { population?: number; delay?: number }) {
    this.started = o;
    this.t = 0;
    this.activeFor = (o.delay ?? 0) + 20;
  }
  stop() {
    this.activeFor = 0;
  }
  fastForward(s: number) {
    this.t += s;
  }
  tick(dt: number) {
    this.t += dt * this.timeScale;
  }
}

function setup(over: Partial<GameSettings> = {}) {
  const events = new Emitter<CityEvents>();
  const state = {
    day: 0,
    year: 2001,
    stats: { population: 1200 },
    buildings: new Map([[1, {}]]),
    history: { pop: [] as number[] },
    config: { name: 'Testville' },
  };
  const sim = { events, state } as unknown as Simulation;
  const world = new FakeWorld();
  const fw = new FakeFireworks();
  const settings: GameSettings = { ...DEFAULT_SETTINGS, ...over };
  const toasts: string[] = [];
  const ny = new NewYearCelebration({
    sim,
    world: () => world as unknown as WorldViewApi,
    objects: () => ({ fireworks: fw }) as unknown as CityObjectsViewApi,
    settings: () => settings,
    toast: (text, _k, _c, title) => toasts.push(`${title}|${text}`),
  });
  const step = (seconds: number, dt = 1 / 30) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      ny.frame(dt);
      world.update(dt);
      fw.tick(dt);
    }
  };
  return { events, state, world, fw, settings, toasts, ny, step };
}

describe('NewYearCelebration', () => {
  it('ignores years simulated in a batch (no frames yet / many days per frame)', () => {
    const { events, state, fw, toasts } = setup();
    state.day = 360;
    events.emit('year', 2002);
    expect(fw.started).toBeNull();
    expect(toasts.length).toBe(0);
  });

  it('celebrates a year reached in play: toast, time-lapse to 23:55, midnight at the opening salvo, clock restored', () => {
    const { events, state, world, fw, toasts, ny, step } = setup();
    state.history.pop = [800, 850, 900, 950, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1100, 1200];
    ny.frame(1 / 60);
    state.day = 361;
    ny.frame(1 / 60);
    state.year = 2002;
    events.emit('year', 2002);
    expect(toasts[0]).toContain('Happy New Year 2002');
    expect(toasts[0]).toContain('1,200 residents');
    expect(toasts[0]).toMatch(/▲ 41\.2% vs 2001/);
    expect(fw.started?.population).toBe(1200);
    const midnight = fw.started!.delay!;
    expect(midnight).toBeGreaterThan(3.6);
    expect(ny.ownsTime).toBe(true);
    const forcedBefore = world.forced;
    // just before midnight: 23:5x
    step(midnight - 0.3);
    expect(world.timeOfDay).toBeGreaterThan(23.9);
    expect(world.timeOfDay).toBeLessThan(24);
    // the lapse is driven through timeScale (no per-frame forced env refreshes)
    expect(world.forced - forcedBefore).toBeLessThan(3);
    step(0.6);
    expect(world.timeOfDay).toBeLessThan(0.1);
    // show runs; afterwards the day cycle continues at the normal speed
    step(30);
    expect(ny.active).toBe(false);
    expect(ny.ownsTime).toBe(false);
    expect(world.autoTime).toBe(true);
    expect(world.timeScale).toBe(2);
  });

  it('fixed-hour players get their hour back after the show', () => {
    const { world, fw, ny, step } = setup({ autoTime: false, fixedHour: 14 });
    world.autoTime = false;
    world.timeOfDay = 14;
    ny.frame(1 / 60);
    ny.celebrate({ year: 2005 });
    step((fw.started!.delay ?? 0) + 30);
    expect(ny.active).toBe(false);
    expect(world.autoTime).toBe(false);
    expect(world.timeOfDay).toBeCloseTo(14, 5);
  });

  it("'fireworks' mode leaves the clock alone; 'off' does nothing", () => {
    const a = setup({ newYear: 'fireworks' });
    a.ny.frame(1 / 60);
    a.ny.celebrate();
    expect(a.fw.started).not.toBeNull();
    expect(a.ny.ownsTime).toBe(false);
    const b = setup({ newYear: 'off' });
    expect(b.ny.celebrate()).toBe(false);
    expect(b.fw.started).toBeNull();
    expect(b.toasts.length).toBe(0);
  });
});
