/**
 * FEEL-02a's pacing probes (POLISH_PLAN §8.1, verifier 6), headless: a real city save of 100k or more runs in the real
 * Simulation at ultra for 5 real minutes and at 2x and 1x for 10 each, on a simulated real-time clock (30 frames a
 * second), with the real NewYearCelebration, the real Fireworks (its sparks measure "fireworks on screen") and the real
 * Toasts on the city's own news. Skipped unless PACING_SAVE names a .city.metropolis save:
 *
 *   PACING_SAVE=…/small_s7_y10.city.metropolis npx vitest run --configLoader runner tests/game/pacingProbe.test.ts
 *
 * PACING_BASELINE=1 also runs today's pacing (newYearPacing 'everyYear', no toast budget) for comparison. Random
 * disasters are switched on (a bot save has them off) so the probe sees disaster toasts. Not covered: the emergency
 * banner's policy toasts and the player's own feedback (both always show), and LIVE mode (no LivePolicy here).
 */
import * as THREE from 'three';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEW_YEAR_PACING, NewYearCelebration } from '../../src/game/NewYear';
import { DEFAULT_SETTINGS, type GameSettings, type NewYearPacing } from '../../src/game/settings';
import { Fireworks } from '../../src/render/city/effects/Fireworks';
import type { CityObjectsViewApi, WorldViewApi } from '../../src/render/contracts';
import { deserializeCity } from '../../src/save/serialize';
import { unpackFile } from '../../src/save/bundle';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems';
import { CELL_SIZE } from '../../src/core/constants';
import type { GameContext } from '../../src/game/context';
import { Toasts } from '../../src/ui/Notifications';
import { FEl, installFakeDom, textOf } from './fakeDom';

const SAVE = process.env.PACING_SAVE ?? '';
const FPS = 30;
/** PACING_SCALE < 1 shortens every probe (a smoke run; the limits are then not meaningful) */
const SCALE = Number(process.env.PACING_SCALE ?? 1);

installFakeDom();
const proto = FEl.prototype as unknown as Record<string, unknown>;
beforeAll(() => {
  Object.defineProperty(proto, 'isConnected', { configurable: true, get(this: FEl) { let e: FEl | null = this; while (e?.parentNode) e = e.parentNode; return !!(e as unknown as { stack?: boolean })?.stack; } });
  proto.animate = () => undefined;
});
afterAll(() => {
  delete proto.isConnected;
  delete proto.animate;
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('window', globalThis);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

class ProbeWorld {
  autoTime = true;
  timeScale = 2;
  timeOfDay = 14;
  camera: THREE.PerspectiveCamera;
  cameraController = { enabled: true, target: { x: 0, z: 0 }, distance: 1200, yawAngle: 0.7, tiltAngle: 0.9, setView() {} };
  constructor(cam: THREE.PerspectiveCamera) {
    this.camera = cam;
  }
  update(dt: number) {
    if (this.autoTime) this.timeOfDay = (this.timeOfDay + (dt * this.timeScale) / 60) % 24;
  }
}

interface ProbeResult {
  label: string;
  speed: number;
  minutes: number;
  pop0: number;
  pop1: number;
  days: number;
  newYears: number;
  fullShows: number;
  bursts: number;
  fanfares: number;
  cameraTakeovers: number;
  /** share of real time with fireworks sparks on screen */
  fireworksShare: number;
  /** each burst's sparks-on-screen length (s) */
  burstLengths: number[];
  toasts: number;
  maxToastsIn60s: number;
  disasterNews: number;
  disasterToastsShown: number;
  minFullGapS: number | null;
}

async function probe(label: string, speed: number, minutes: number, pacing: NewYearPacing, budget: boolean): Promise<ProbeResult> {
  const st = deserializeCity((await unpackFile(new Uint8Array(readFileSync(SAVE)))) as Parameters<typeof deserializeCity>[0]);
  st.config.disasters = true;
  const sim = new Simulation(st, createSystems());
  sim.speed = speed;
  const settings: GameSettings = { ...DEFAULT_SETTINGS, newYearPacing: pacing };
  // the UI
  const root = new FEl('div');
  (root as unknown as { stack: boolean }).stack = true;
  const abort = new AbortController();
  const ctx = { signal: abort.signal, sim, settings, mods: {}, root, sound() {}, focusCell() {} } as unknown as GameContext;
  const toasts = new Toasts(ctx, root as unknown as HTMLElement);
  const saved = [Toasts.BUDGET_GAP_MS, Toasts.BUDGET_PER_MIN];
  if (!budget) [Toasts.BUDGET_GAP_MS, Toasts.BUDGET_PER_MIN] = [0, Infinity];
  const t0 = performance.now();
  const shown: { t: number; kind: string; text: string }[] = [];
  let kindNow = '';
  const show = toasts.show.bind(toasts);
  toasts.show = (text, kind = 'info', ...rest) => {
    kindNow = kind;
    show(text, kind, ...rest);
  };
  const el = toasts.el as unknown as FEl;
  const prepend = el.prepend.bind(el);
  el.prepend = (...cs: (FEl | string)[]) => {
    for (const c of cs) if (c instanceof FEl && !el.children.includes(c)) shown.push({ t: (performance.now() - t0) / 1000, kind: kindNow, text: textOf(c.querySelector('.t-text')!) });
    prepend(...cs);
  };
  let disasterNews = 0, disasterShown = 0;
  sim.events.on('news', (n) => {
    if (n.kind !== 'disaster') return;
    disasterNews++;
    if (el.children.some((c) => textOf(c.querySelector('.t-text')!) === n.text)) disasterShown++;
  });
  // the show
  const size = st.size * CELL_SIZE;
  const cam = new THREE.PerspectiveCamera(50, 16 / 9, 1, 30000);
  cam.position.set(size / 2, 900, size / 2 + 1400);
  cam.lookAt(size / 2, 0, size / 2);
  cam.updateMatrixWorld();
  const sites = Array.from({ length: 40 }, (_, i) => ({ x: size / 2 - 300 + (i % 8) * 80, y: 0, z: size / 2 - 200 + Math.floor(i / 8) * 80, kind: 'park' as const, weight: 1 }));
  const fw = new Fireworks({ camera: cam, mapSize: size, quality: 'low', groundAt: () => 0, getSites: () => sites });
  const starts: { duration?: number; at: number }[] = [];
  const start = fw.start.bind(fw);
  fw.start = (o = {}) => {
    starts.push({ duration: o.duration, at: (performance.now() - t0) / 1000 });
    start(o);
  };
  const world = new ProbeWorld(cam);
  let fanfares = 0;
  let heldMax: number | null = null;
  const ny = new NewYearCelebration({
    sim, signal: abort.signal, settings: () => settings,
    world: () => world as unknown as WorldViewApi,
    objects: () => ({ fireworks: fw }) as unknown as CityObjectsViewApi,
    toast: (text, kind, cell, title, opts) => toasts.show(text, kind, cell, title, opts),
    sound: (n) => { if (n === 'reward') fanfares++; },
    // as SimCore's holdCalendar
    holdCalendar: (on) => {
      if (on && heldMax === null) { heldMax = sim.maxDaysPerFrame; sim.maxDaysPerFrame = 0; }
      else if (!on && heldMax !== null) { sim.maxDaysPerFrame = heldMax > 0 ? heldMax : 4; heldMax = null; }
    },
    now: () => performance.now(),
  });
  let newYears = 0;
  sim.events.on('year', () => newYears++);
  const pop0 = st.stats.population, day0 = st.day;
  const dt = 1 / FPS;
  let sparks = 0, cams = 0, camWas = false;
  let burstStart = -1, burstSparks = 0;
  const burstLengths: number[] = [];
  const frames = Math.round(minutes * SCALE * 60 * FPS);
  for (let f = 0; f < frames; f++) {
    vi.advanceTimersByTime(1000 / FPS);
    sim.update(dt);
    ny.frame(dt, performance.now());
    fw.update(dt);
    world.update(dt);
    const vis = (fw as unknown as { mesh: THREE.Mesh }).mesh.visible;
    if (vis) sparks += dt;
    if (ny.cameraActive && !camWas) cams++;
    camWas = ny.cameraActive;
    // a burst's sparks-on-screen time: from its start to its last visible spark
    const last = starts[starts.length - 1];
    if (last && last.duration === NEW_YEAR_PACING.burstDuration && burstStart !== last.at) {
      if (burstStart >= 0) burstLengths.push(burstSparks);
      burstStart = last.at;
      burstSparks = 0;
    }
    if (burstStart >= 0 && last?.at === burstStart && vis) burstSparks = (performance.now() - t0) / 1000 - burstStart;
  }
  if (burstStart >= 0) burstLengths.push(burstSparks);
  const times = shown.map((s) => s.t);
  let maxIn60 = 0;
  for (let i = 0; i < times.length; i++) maxIn60 = Math.max(maxIn60, times.filter((t) => t >= times[i] && t < times[i] + 60).length);
  const fulls = starts.filter((s) => s.duration !== NEW_YEAR_PACING.burstDuration).map((s) => s.at);
  let minGap: number | null = null;
  for (let i = 1; i < fulls.length; i++) minGap = Math.min(minGap ?? Infinity, fulls[i] - fulls[i - 1]);
  const r: ProbeResult = {
    label, speed, minutes, pop0, pop1: st.stats.population, days: st.day - day0, newYears,
    fullShows: fulls.length, bursts: starts.length - fulls.length, fanfares, cameraTakeovers: cams,
    fireworksShare: Math.round((sparks / (minutes * SCALE * 60)) * 1000) / 1000,
    burstLengths: burstLengths.map((x) => Math.round(x * 10) / 10),
    toasts: shown.length, maxToastsIn60s: maxIn60, disasterNews, disasterToastsShown: disasterShown,
    minFullGapS: minGap === null ? null : Math.round(minGap),
  };
  [Toasts.BUDGET_GAP_MS, Toasts.BUDGET_PER_MIN] = saved;
  ny.dispose();
  fw.dispose();
  abort.abort();
  console.log('[pacing probe]', JSON.stringify(r));
  if (process.env.PACING_OUT) writeFileSync(process.env.PACING_OUT, JSON.stringify(r) + '\n', { flag: 'a' });
  return r;
}

describe.skipIf(!SAVE)('FEEL-02a pacing probes on a 100k+ save (PACING_SAVE)', () => {
  it('5 minutes at ultra: at most 2 fanfares and 2 full shows, at most 8 toasts in any 60 s, every disaster toast shown', async () => {
    const r = await probe('ultra 5 min', 3, 5, 'milestones', true);
    expect(r.pop0).toBeGreaterThanOrEqual(100_000);
    expect(r.newYears).toBeGreaterThanOrEqual(15);
    expect(r.fanfares).toBeLessThanOrEqual(2);
    expect(r.fullShows).toBeLessThanOrEqual(2);
    expect(r.bursts).toBe(0);
    expect(r.maxToastsIn60s).toBeLessThanOrEqual(8);
    expect(r.disasterToastsShown).toBe(r.disasterNews);
  }, 1_800_000);

  it('10 minutes at 2x: at most 2 full shows; fireworks on screen at most 25 % of the time', async () => {
    const r = await probe('2x 10 min', 2, 10, 'milestones', true);
    expect(r.fullShows).toBeLessThanOrEqual(2);
    expect(r.fireworksShare).toBeLessThanOrEqual(0.25);
    expect(r.burstLengths.every((b) => b <= 12)).toBe(true);
    expect(r.maxToastsIn60s).toBeLessThanOrEqual(8);
  }, 1_800_000);

  it('10 minutes at 1x: at most 2 full shows (camera takeovers); every other New Year a burst of at most 12 s', async () => {
    const r = await probe('1x 10 min', 1, 10, 'milestones', true);
    expect(r.fullShows).toBeLessThanOrEqual(2);
    expect(r.cameraTakeovers).toBeLessThanOrEqual(2);
    expect(r.fullShows + r.bursts).toBe(r.newYears);
    expect(r.burstLengths.length).toBe(r.bursts);
    expect(r.burstLengths.every((b) => b <= 12)).toBe(true);
  }, 1_800_000);

  it.skipIf(!process.env.PACING_BASELINE)("today's pacing for comparison ('everyYear', no toast budget)", async () => {
    for (const [label, speed, minutes] of [['baseline ultra 5 min', 3, 5], ['baseline 2x 10 min', 2, 10], ['baseline 1x 10 min', 1, 10]] as const) {
      const r = await probe(label, speed, minutes, 'everyYear', false);
      expect(r.newYears).toBeGreaterThan(0);
    }
  }, 3_600_000);
});
