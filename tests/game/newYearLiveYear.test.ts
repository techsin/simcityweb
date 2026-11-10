/**
 * T077 (WORKER_DESIGN §3.6): NewYearCelebration's batch test reads the host's liveYear where it has one. True: the year
 * was reached in play, however late or bunched its days reached the page. False: a batch of days, however short.
 * Without the input, or when the host cannot tell (undefined), the frame-gap rule decides, as before
 * (tests/game/newyear.test.ts runs without the input). The hosts' side is tests/worker/liveYear.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { Emitter } from '../../src/core/events';
import { NewYearCelebration } from '../../src/game/NewYear';
import { DEFAULT_SETTINGS, type GameSettings } from '../../src/game/settings';
import type { CityObjectsViewApi, WorldViewApi } from '../../src/render/contracts';
import type { CityEvents, Simulation } from '../../src/sim/Simulation';

function setup(liveYear?: () => boolean | undefined) {
  const events = new Emitter<CityEvents>();
  const state = {
    day: 0, year: 2001, stats: { population: 1200 }, buildings: new Map([[1, {}]]),
    history: { pop: [] as number[] }, config: { name: 'Testville' },
  };
  const fw = { starts: 0, timeScale: 1, onSound: null as unknown, active: false, midnight: 0, start() { this.starts++; }, stop() {}, fastForward() {} };
  // every year that is no batch gets its show or, while one runs, its toast
  const settings: GameSettings = { ...DEFAULT_SETTINGS, newYear: 'fireworks', newYearPacing: 'everyYear' };
  const toasts: string[] = [];
  const ny = new NewYearCelebration({
    sim: { events, state } as unknown as Simulation,
    world: () => ({ timeOfDay: 10.5, autoTime: true }) as unknown as WorldViewApi,
    objects: () => ({ fireworks: fw }) as unknown as CityObjectsViewApi,
    settings: () => settings,
    toast: (_text, _kind, _cell, title) => toasts.push(title ?? ''),
    liveYear,
  });
  (ny as unknown as { loadAudio(): void }).loadAudio = () => undefined;
  /** a frame on `frameDay` (none when omitted), then the year turns on `day` */
  const turn = (year: number, day: number, frameDay?: number) => {
    if (frameDay !== undefined) { state.day = frameDay; ny.frame(1 / 60); }
    state.day = day; state.year = year;
    const before = toasts.length;
    events.emit('year', year);
    return toasts.length > before;
  };
  return { ny, fw, toasts, turn, state };
}

describe('NewYearCelebration: the host\'s liveYear decides the batch test (T077)', () => {
  it('a live year is celebrated with no frame drawn yet, and many days after the last one', () => {
    const { ny, fw, toasts, turn } = setup(() => true);
    try {
      expect(turn(2002, 360)).toBe(true);
      expect(fw.starts).toBe(1);
      expect(toasts).toEqual(['🎆 Happy New Year 2002!']);
      // a backlog of packets: 40 days since the last drawn frame
      expect(turn(2003, 720, 680)).toBe(true);
    } finally { ny.dispose(); }
  });

  it('a batch year is not, even one day after a drawn frame', () => {
    const { ny, fw, toasts, turn } = setup(() => false);
    try {
      expect(turn(2002, 360, 359)).toBe(false);
      expect(fw.starts).toBe(0); expect(toasts).toEqual([]);
    } finally { ny.dispose(); }
  });

  it('reads the flag as each year turns', () => {
    let live = true;
    const { ny, turn } = setup(() => live);
    try {
      expect(turn(2002, 360, 359)).toBe(true);
      live = false;
      expect(turn(2003, 720, 719)).toBe(false);
      live = true;
      expect(turn(2004, 1080, 1079)).toBe(true);
    } finally { ny.dispose(); }
  });

  it('a host that cannot tell leaves the frame-gap rule: no frame yet or more than 8 days since the last is a batch', () => {
    for (const liveYear of [() => undefined, undefined]) {
      const { ny, turn } = setup(liveYear);
      try {
        expect(turn(2002, 360), 'no frame yet').toBe(false);
        expect(turn(2003, 720, 712), '8 days after a frame').toBe(true);
        expect(turn(2004, 1080, 1071), '9 days after a frame').toBe(false);
      } finally { ny.dispose(); }
    }
  });

  it('a brand-new city (day 0) and an empty one still get no party when the year is live', () => {
    const a = setup(() => true);
    try { expect(a.turn(2001, 0, 0)).toBe(false); } finally { a.ny.dispose(); }
    const b = setup(() => true);
    b.state.stats.population = 0; b.state.buildings.clear();
    try { expect(b.turn(2002, 360, 359)).toBe(false); } finally { b.ny.dispose(); }
  });
});
