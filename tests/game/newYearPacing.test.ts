/**
 * FEEL-02a (D17): New Year paced in real time. A full show on the city's first New Year, on a rank-up New Year and
 * otherwise at most once per 10 real minutes (never two within 3 minutes, at most 2 in any 10); every other New Year a
 * burst of at most 12 s at 1x and 2x (no countdown, fanfare, camera, clock or calendar takeover) or, at ultra, a silent
 * compact toast. "Every year" keeps today's pacing. The burst's length is measured on the real Fireworks.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Emitter } from '../../src/core/events';
import { NEW_YEAR_PACING, NewYearCelebration, NewYearPacer } from '../../src/game/NewYear';
import { DEFAULT_SETTINGS, type GameSettings } from '../../src/game/settings';
import { Fireworks } from '../../src/render/city/effects/Fireworks';
import type { Simulation, CityEvents } from '../../src/sim/Simulation';
import type { CityObjectsViewApi, WorldViewApi } from '../../src/render/contracts';

const MIN = 60_000;

describe('NewYearPacer: which New Years get the full show', () => {
  it('the first decision is a full show; then at most once per 10 real minutes', () => {
    const p = new NewYearPacer();
    expect(p.decide(0, false, false)).toBe('full');
    p.noteFull(0);
    expect(p.decide(3 * MIN, false, false)).toBe('burst');
    expect(p.decide(9.99 * MIN, false, false)).toBe('burst');
    expect(p.decide(10 * MIN, false, false)).toBe('full');
  });

  it('a milestone gets a full show unless one played in the last 3 real minutes', () => {
    const p = new NewYearPacer();
    p.noteFull(0);
    expect(p.decide(2.9 * MIN, true, false)).toBe('burst');
    expect(p.decide(3 * MIN, true, false)).toBe('full');
  });

  it('at most 2 full shows in any 10 real minutes, milestones included', () => {
    const p = new NewYearPacer();
    p.noteFull(0);
    p.noteFull(3 * MIN);
    expect(p.decide(6 * MIN, true, false)).toBe('burst');
    expect(p.decide(9.9 * MIN, true, false)).toBe('burst');
    // the show at 0 has left the window; the one at 3 min is 7 minutes back
    expect(p.decide(10 * MIN, true, false)).toBe('full');
  });

  it('at ultra a New Year without the full show gets only the toast', () => {
    const p = new NewYearPacer();
    p.noteFull(0);
    expect(p.decide(MIN, false, true)).toBe('quiet');
    expect(p.decide(MIN, true, true)).toBe('quiet');
    expect(p.decide(4 * MIN, true, true)).toBe('full');
  });
});

// ------------------------------------------------------------------ the celebration with its stand-ins
class FakeWorld {
  autoTime = true;
  timeScale = 2;
  private h = 10.5;
  camera = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 500, 0, 1] } };
  cameraController = {
    enabled: true, target: { x: 0, z: 0 }, distance: 900, yawAngle: 0.7, tiltAngle: 0.9, views: 0,
    setView() {
      this.views++;
    },
  };
  get timeOfDay() {
    return this.h;
  }
  set timeOfDay(v: number) {
    this.h = ((v % 24) + 24) % 24;
  }
  update(dt: number) {
    if (this.autoTime) this.h = (this.h + (dt * this.timeScale) / 60) % 24;
  }
}

class FakeFireworks {
  activeFor = 0;
  started: { population?: number; delay?: number; duration?: number } | null = null;
  starts: { delay?: number; duration?: number }[] = [];
  timeScale = 1;
  onSound: unknown = null;
  t = 0;
  get active() {
    return this.t < this.activeFor;
  }
  get isRunning() {
    return this.active;
  }
  get midnight() {
    return this.started?.delay ?? 0;
  }
  get centre() {
    return this.active ? { x: 100, z: 100 } : null;
  }
  start(o: { population?: number; delay?: number; duration?: number }) {
    this.started = o;
    this.starts.push(o);
    this.t = 0;
    this.activeFor = (o.delay ?? 0) + (o.duration ?? 20) + 4;
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

interface Setup {
  secondsPerDay?: number;
  settings?: Partial<GameSettings>;
  startYear?: number;
  foundedDay?: number;
  pop?: number[];
}

function setup(o: Setup = {}) {
  const events = new Emitter<CityEvents>();
  const state = {
    day: 0,
    year: 2001,
    stats: { population: 101_650 },
    buildings: new Map([[1, {}]]),
    history: { pop: o.pop ?? Array.from({ length: 40 }, () => 100_000) },
    config: { name: 'Testville', startYear: o.startYear ?? 1990 },
    systemData: o.foundedDay === undefined ? {} : { foundedDay: o.foundedDay },
  };
  const spd = o.secondsPerDay ?? 0.5;
  const sim = { events, state, speed: spd <= 0.05 ? 3 : spd <= 0.2 ? 2 : 1, secondsPerDay: () => spd } as unknown as Simulation;
  const world = new FakeWorld();
  const fw = new FakeFireworks();
  const settings: GameSettings = { ...DEFAULT_SETTINGS, ...o.settings };
  const toasts: { title?: string; text: string; silent: boolean; ttl?: number }[] = [];
  const sounds: string[] = [];
  const calendar: boolean[] = [];
  const clock = { now: 1000 };
  const ny = new NewYearCelebration({
    sim,
    world: () => world as unknown as WorldViewApi,
    objects: () => ({ fireworks: fw }) as unknown as CityObjectsViewApi,
    settings: () => settings,
    toast: (text, _k, _c, title, opts) => toasts.push({ title, text, silent: !!opts?.silent, ttl: opts?.ttl }),
    sound: (n) => sounds.push(n),
    holdCalendar: (on) => calendar.push(on),
    now: () => clock.now,
  });
  let camFrames = 0;
  const step = (seconds: number, dt = 1 / 10) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) {
      clock.now += dt * 1000;
      ny.frame(dt, clock.now);
      world.update(dt);
      fw.tick(dt);
      if (ny.cameraActive) camFrames++;
    }
  };
  /** the year turns over during play (a frame on the day before, so it is not a batch-simulated year) */
  const newYear = (year: number) => {
    state.day = (year - state.config.startYear) * 360 - 1;
    ny.frame(0.016, clock.now);
    state.day++;
    state.year = year;
    events.emit('year', year);
  };
  /** play `years` New Years one game year apart at this speed; returns what each got */
  const play = (first: number, years: number) => {
    const out: string[] = [];
    for (let y = first; y < first + years; y++) {
      const nStarts = fw.starts.length, nFan = sounds.filter((s) => s === 'reward').length, nToast = toasts.length;
      newYear(y);
      const started = fw.starts.length > nStarts ? fw.starts[fw.starts.length - 1] : null;
      const fanfare = sounds.filter((s) => s === 'reward').length > nFan;
      out.push(started ? (started.duration === NEW_YEAR_PACING.burstDuration ? 'burst' : 'full') + (fanfare ? '+fanfare' : '') : toasts.length > nToast ? 'toast' : 'none');
      step(spd * 360);
    }
    return out;
  };
  return { events, state, sim, world, fw, settings, toasts, sounds, calendar, clock, ny, step, newYear, play, cams: () => camFrames };
}

describe('NewYearCelebration: FEEL-02a pacing', () => {
  it('1x (180 s a year): the first New Year of the session is the full show, the next three are bursts, the fifth full again', () => {
    const s = setup({ secondsPerDay: 0.5 });
    expect(s.play(2001, 5)).toEqual(['full+fanfare', 'burst', 'burst', 'burst', 'full+fanfare']);
    // 10 real minutes from the first: the 5th New Year (720 s later) is the second full show; never two within 10 min
    const full = s.ny.pacer.log.filter((e) => e.show === 'full');
    expect(full.map((e) => e.year)).toEqual([2001, 2005]);
    expect(full[1].at - full[0].at).toBeGreaterThanOrEqual(NEW_YEAR_PACING.periodMs);
  });

  it('a burst: no countdown, no fanfare, no camera, clock or calendar takeover; its yearly toast is silent', () => {
    const s = setup({ secondsPerDay: 0.5 });
    s.play(2001, 1);
    const cal = s.calendar.length, cams = s.cams(), views = s.world.cameraController.views;
    s.newYear(2002);
    expect(s.fw.started).toEqual(expect.objectContaining({ delay: NEW_YEAR_PACING.burstDelay, duration: NEW_YEAR_PACING.burstDuration }));
    expect(s.ny.ownsTime).toBe(false);
    expect(s.ny.cameraActive).toBe(false);
    s.step(15);
    expect(s.calendar.length).toBe(cal);
    expect(s.cams()).toBe(cams);
    expect(s.world.cameraController.views).toBe(views);
    expect(s.ny.busy).toBe(false);
    // the yearly toast stays, without the fanfare (the toast's own sound is suppressed too)
    const last = s.toasts[s.toasts.length - 1];
    expect(last.title).toBe('🎆 Happy New Year 2002!');
    expect(last.silent).toBe(true);
    expect(s.sounds.filter((n) => n === 'reward')).toHaveLength(1);
    // no countdown overlay or blip: the burst has no midnight to count down to
    expect(s.ny['countdownOn']).toBe(false);
  });

  it('the full show at 1x is today\'s cinematic: night, the camera and the calendar hold', () => {
    const s = setup({ secondsPerDay: 0.5 });
    s.newYear(2001);
    expect(s.ny.ownsTime).toBe(true);
    expect(s.calendar).toEqual([true]);
    expect(s.sounds).toEqual(['reward']);
    s.step(10);
    expect(s.cams()).toBeGreaterThan(0);
  });

  it('2x (72 s a year): 10 minutes give 1 full show (fireworks mode) and 7 bursts; fireworks run under 25 % of the time', () => {
    const s = setup({ secondsPerDay: 0.2 });
    let fwOn = 0;
    const out: string[] = [];
    for (let y = 2001; y < 2001 + Math.round(600 / 72); y++) {
      const n = s.fw.starts.length;
      s.newYear(y);
      out.push(s.fw.starts.length > n ? (s.fw.started!.duration === NEW_YEAR_PACING.burstDuration ? 'burst' : 'full') : 'none');
      for (let k = 0; k < 720; k++) {
        if (s.fw.active) fwOn += 0.1;
        s.step(0.1);
      }
    }
    expect(out).toEqual(['full', 'burst', 'burst', 'burst', 'burst', 'burst', 'burst', 'burst']);
    // (the stand-in keeps each show up for its delay + duration + 4 s; the real Fireworks' sparks are measured below)
    expect(fwOn / 600).toBeLessThan(0.25);
    expect(s.ny.ownsTime).toBe(false);
  });

  it('ultra (18 s a year): 5 minutes give 1 fanfare and 1 full show; every other New Year is one silent compact toast', () => {
    const s = setup({ secondsPerDay: 0.05 });
    const out = s.play(2001, Math.floor(300 / 18));
    expect(out[0]).toBe('full+fanfare');
    expect(out.slice(1).every((x) => x === 'toast')).toBe(true);
    expect(s.sounds.filter((n) => n === 'reward')).toHaveLength(1);
    expect(s.fw.starts).toHaveLength(1);
    const compact = s.toasts.slice(1);
    expect(compact.every((t) => t.silent && t.title === 'New Year' && t.ttl === NEW_YEAR_PACING.compactTtlMs)).toBe(true);
    // the history's 12-months-back sample is 100,000: "up 2%"
    expect(compact[0].text).toBe('2002 · 101,650 residents, up 2%');
  });

  it('the compact line: "2034 · 812,400 residents, up 6%", down, steady, small changes and no history', () => {
    const s = setup({ secondsPerDay: 0.05, pop: Array.from({ length: 13 }, () => 766_415) });
    s.state.stats.population = 812_400;
    expect(s.ny['compactLine'](2034)).toBe('2034 · 812,400 residents, up 6%');
    s.state.stats.population = 743_000;
    expect(s.ny['compactLine'](2034)).toBe('2034 · 743,000 residents, down 3%');
    s.state.stats.population = 766_415;
    expect(s.ny['compactLine'](2034)).toBe('2034 · 766,415 residents, steady');
    s.state.stats.population = 769_000;
    expect(s.ny['compactLine'](2034)).toBe('2034 · 769,000 residents, up 0.3%');
    s.state.history.pop = [];
    expect(s.ny['compactLine'](2034)).toBe('2034 · 769,000 residents');
  });

  it("the city's first New Year is a full show even 4 minutes after another one (a 1 April or a day-0 founding)", () => {
    for (const foundedDay of [90, undefined]) {
      const s = setup({ secondsPerDay: 0.5, startYear: 2000, foundedDay });
      s.ny.pacer.noteFull(s.clock.now - 4 * MIN);
      s.newYear(2001);
      expect(s.ny.pacer.log[0]).toEqual(expect.objectContaining({ year: 2001, show: 'full', milestone: true }));
    }
    // ... but not within 3 minutes of one
    const s = setup({ secondsPerDay: 0.5, startYear: 2000, foundedDay: 90 });
    s.ny.pacer.noteFull(s.clock.now - 2 * MIN);
    s.newYear(2001);
    expect(s.ny.pacer.log[0].show).toBe('burst');
    // the second New Year is no milestone
    const t = setup({ secondsPerDay: 0.5, startYear: 2000, foundedDay: 90 });
    t.ny.pacer.noteFull(t.clock.now - 4 * MIN);
    t.newYear(2002);
    expect(t.ny.pacer.log[0]).toEqual(expect.objectContaining({ show: 'burst', milestone: false }));
  });

  it('a rank-up New Year (a new CITY_RANKS rank within the last 12 months) is a full show, unless one played in the last 3 minutes', () => {
    // Large City (50k+) before; Metropolis (100k) reached this year
    const pop = [...Array.from({ length: 30 }, (_, i) => 60_000 + i * 1000), ...Array.from({ length: 12 }, (_, i) => 95_000 + i * 600)];
    const s = setup({ secondsPerDay: 0.5, pop });
    s.state.stats.population = 101_650;
    s.ny.pacer.noteFull(s.clock.now - 4 * MIN);
    s.newYear(2005);
    expect(s.ny.pacer.log[0]).toEqual(expect.objectContaining({ show: 'full', milestone: true }));
    expect(s.sounds).toEqual(['reward']);
    const t = setup({ secondsPerDay: 0.5, pop });
    t.ny.pacer.noteFull(t.clock.now - 2.5 * MIN);
    t.newYear(2005);
    expect(t.ny.pacer.log[0].show).toBe('burst');
  });

  it('no rank-up: a rank reached before and lost, then reached again, or growth within one rank', () => {
    // peaked at 104k three years ago (Metropolis), fell to 90k, back to 101k this year: no new rank
    const again = [...Array.from({ length: 12 }, () => 104_000), ...Array.from({ length: 18 }, () => 90_000), ...Array.from({ length: 12 }, () => 101_000)];
    const s = setup({ secondsPerDay: 0.5, pop: again });
    s.ny.pacer.noteFull(s.clock.now - 4 * MIN);
    s.newYear(2005);
    expect(s.ny.pacer.log[0]).toEqual(expect.objectContaining({ show: 'burst', milestone: false }));
    const within = setup({ secondsPerDay: 0.5, pop: [...Array.from({ length: 30 }, () => 110_000), ...Array.from({ length: 12 }, () => 140_000)] });
    within.ny.pacer.noteFull(within.clock.now - 4 * MIN);
    within.newYear(2005);
    expect(within.ny.pacer.log[0].milestone).toBe(false);
  });

  it('a New Year while a show still runs gets only its toast, without the fanfare', () => {
    const s = setup({ secondsPerDay: 0.5 });
    s.newYear(2001);
    s.step(2);
    expect(s.ny.busy).toBe(true);
    s.newYear(2002);
    expect(s.ny.pacer.log[1].show).toBe('quiet');
    expect(s.sounds).toEqual(['reward']);
    expect(s.toasts[1]).toEqual(expect.objectContaining({ title: '🎆 Happy New Year 2002!', silent: true }));
  });

  it('"Every year" keeps today\'s pacing: the full show and the fanfare every New Year', () => {
    const s = setup({ secondsPerDay: 0.5, settings: { newYearPacing: 'everyYear' } });
    expect(s.play(2001, 4)).toEqual(['full+fanfare', 'full+fanfare', 'full+fanfare', 'full+fanfare']);
    const u = setup({ secondsPerDay: 0.05, settings: { newYearPacing: 'everyYear' } });
    expect(u.play(2001, 3)).toEqual(['full+fanfare', 'full+fanfare', 'full+fanfare']);
    // switching to Milestones counts the shows it played
    u.settings.newYearPacing = 'milestones';
    expect(u.play(2004, 1)).toEqual(['toast']);
  });

  it('New Year off: nothing at all, as before', () => {
    const s = setup({ secondsPerDay: 0.05, settings: { newYear: 'off' } });
    expect(s.play(2001, 3)).toEqual(['none', 'none', 'none']);
    expect(s.toasts).toHaveLength(0);
  });

  it('the player raising the speed ends a burst too', () => {
    const s = setup({ secondsPerDay: 0.5 });
    s.play(2001, 1);
    s.newYear(2002);
    s.step(1);
    (s.sim as unknown as { speed: number }).speed = 3;
    s.step(0.5);
    expect(s.fw.active).toBe(false);
    s.step(1);
    expect(s.ny.busy).toBe(false);
  });
});

describe('the burst on the real Fireworks', () => {
  it('its sparks are gone within 12 s of the start, from a hamlet to a million residents; it settles by then too', () => {
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 1, 20000);
    cam.position.set(1000, 800, 1800);
    cam.updateMatrixWorld();
    const sites = Array.from({ length: 30 }, (_, i) => ({ x: 800 + (i % 6) * 60, y: 0, z: 800 + Math.floor(i / 6) * 60, kind: 'park' as const, weight: 1 }));
    const fw = new Fireworks({ camera: cam, mapSize: 2048, quality: 'low', groundAt: () => 0, getSites: () => sites });
    const world = new FakeWorld();
    const settings = { ...DEFAULT_SETTINGS };
    const state = { day: 0, year: 2001, stats: { population: 0 }, buildings: new Map(), history: { pop: [] as number[] }, config: { name: 'X', startYear: 2000 } };
    const sim = { events: new Emitter<CityEvents>(), state, speed: 1, secondsPerDay: () => 0.5 } as unknown as Simulation;
    const ny = new NewYearCelebration({ sim, world: () => world as unknown as WorldViewApi, objects: () => ({ fireworks: fw }) as unknown as CityObjectsViewApi, settings: () => settings, toast: () => undefined });
    try {
      for (const population of [300, 3000, 101_650, 1_000_000]) {
        state.stats.population = population;
        ny.frame(1 / 30, 0);
        expect(ny.celebrate({ burst: true, seed: 7 })).toBe(true);
        let t = 0, sparksEnd = 0, busyEnd = 0;
        const dt = 1 / 30;
        while (t < 40) {
          fw.update(dt);
          ny.frame(dt, 0);
          t += dt;
          if ((fw as unknown as { mesh: THREE.Mesh }).mesh.visible) sparksEnd = t;
          if (ny.busy) busyEnd = t;
          if (!fw.active && !ny.busy) break;
        }
        expect(sparksEnd).toBeGreaterThan(5);
        expect(sparksEnd).toBeLessThanOrEqual(12);
        expect(busyEnd).toBeLessThanOrEqual(12);
        fw.stop(true);
      }
    } finally {
      ny.dispose();
      fw.dispose();
    }
  });
});
