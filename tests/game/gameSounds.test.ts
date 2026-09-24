/**
 * GameSounds (src/game/GameSounds.ts): event sounds are budgeted so a busy city never nags — news bursts play their
 * most important item, one news sound per NEWS_GAP, repeated messages stay quiet, routine fires get a soft bell while
 * unanswered ones ring the full alarm, the monthly budget tick is rare unless the sign flips.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { GameSounds } from '../../src/game/GameSounds';
import type { SoundOpts } from '../../src/game/context';

function setup(opts: { sandbox?: boolean } = {}) {
  const events = new Emitter<Record<string, unknown>>();
  const state = { budget: { lastIncome: {} as Record<string, number>, lastExpense: {} as Record<string, number> } };
  const plays: { name: string; opts?: SoundOpts }[] = [];
  const gs = new GameSounds({
    sim: { events, state } as never,
    sound: (name, o) => plays.push({ name, opts: o }),
    world: () => ({ camera: null }) as never,
    sandbox: () => !!opts.sandbox,
  });
  const news = (text: string, kind: string) => events.emit('news', { day: 1, text, kind });
  const names = () => plays.map((p) => p.name);
  return { events, state, plays, gs, news, names };
}

describe('GameSounds', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.setSystemTime(0);
    vi.advanceTimersByTime(60_000);
  });
  afterEach(() => vi.useRealTimers());

  it('plays only the most important item of a news burst, then respects the shared news budget', () => {
    const t = setup();
    t.news('Pigeons stage sit-in', 'info');
    t.news('Traffic is getting bad', 'warning');
    t.news('A building was abandoned', 'bad');
    vi.advanceTimersByTime(200);
    expect(t.names()).toEqual(['bad']);
    // 1 s later: inside the news budget -> silent
    vi.advanceTimersByTime(1000);
    t.news('Crime is rising downtown', 'warning');
    vi.advanceTimersByTime(200);
    expect(t.names()).toEqual(['bad']);
    // well after it -> plays
    vi.advanceTimersByTime(20_000);
    t.news('Crime is rising downtown', 'warning');
    vi.advanceTimersByTime(200);
    expect(t.names()).toEqual(['bad', 'warning']);
  });

  it('keeps a repeated message (numbers ignored) quiet for minutes', () => {
    const t = setup();
    t.news('Garbage is piling up: trucks can’t reach 12 buildings', 'warning');
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(60_000);
    t.news('Garbage is piling up: trucks can’t reach 31 buildings', 'warning');
    vi.advanceTimersByTime(200);
    expect(t.names()).toEqual(['warning']);
    vi.advanceTimersByTime(200_000);
    t.news('Garbage is piling up: trucks can’t reach 8 buildings', 'warning');
    vi.advanceTimersByTime(200);
    expect(t.names()).toEqual(['warning', 'warning']);
  });

  it('celebrates population milestones, brighter for big ones; other good news is a plain chime', () => {
    const t = setup();
    t.news('Botville reaches 250,000 residents!', 'good');
    expect(t.plays[0].name).toBe('milestone');
    expect(t.plays[0].opts?.pitch).toBeCloseTo(Math.pow(2, 4 / 12), 5);
    vi.advanceTimersByTime(30_000);
    t.news('Botville reaches 2,500 residents!', 'good');
    vi.advanceTimersByTime(200);
    expect(t.names()).toEqual(['milestone', 'good']);
  });

  it('routine advisor tips get the rare soft bell; urgent ones the advisor chime', () => {
    const t = setup();
    t.news('Our education quotient is only 80. Schools attract offices.', 'advisor');
    vi.advanceTimersByTime(200);
    expect(t.names()).toEqual(['news']);
    vi.advanceTimersByTime(40_000);
    t.news('Warning! The power plant is at 98% capacity.', 'advisor');
    vi.advanceTimersByTime(200);
    expect(t.names()).toEqual(['news', 'advisor']);
  });

  it('fires: soft bell when the fire service answers, full bell when nobody can (news silent), full bell without dispatch', () => {
    const t = setup();
    // routine: the emergency system answers
    t.events.emit('disaster', { kind: 'fire', x: 5, z: 5, active: true });
    t.events.emit('emergency', { type: 'new', id: 1, kind: 'fire', x: 5, z: 5, major: true, manualPossible: false });
    t.events.emit('emergency', { type: 'dispatched', id: 1, kind: 'fire', x: 5, z: 5, major: true, manualPossible: false });
    vi.advanceTimersByTime(100);
    expect(t.names()).toEqual(['fireBell']);
    // spreading within the incident: quiet
    t.events.emit('disaster', { kind: 'fire', x: 6, z: 5, active: true });
    t.events.emit('emergency', { type: 'escalated', id: 1, kind: 'fire', x: 5, z: 5, major: true, manualPossible: false });
    vi.advanceTimersByTime(100);
    expect(t.names()).toEqual(['fireBell']);
    // unanswered: the full bell once, its news stays silent
    t.events.emit('disaster', { kind: 'fire', x: 30, z: 5, active: true });
    t.events.emit('emergency', { type: 'new', id: 2, kind: 'fire', x: 30, z: 5, major: true, manualPossible: false });
    t.events.emit('emergency', { type: 'uncovered', id: 2, kind: 'fire', x: 30, z: 5, major: true, manualPossible: true });
    t.news('Fire at Villa — all fire trucks are busy. Send help with the Dispatch tool!', 'disaster');
    vi.advanceTimersByTime(2000);
    expect(t.names()).toEqual(['fireBell', 'fire']);
    // no dispatch system (no emergency events): every fire rings the full bell (rate-limited)
    vi.advanceTimersByTime(30_000);
    t.events.emit('disaster', { kind: 'fire', x: 50, z: 5, active: true });
    vi.advanceTimersByTime(100);
    expect(t.names()).toEqual(['fireBell', 'fire', 'fire']);
  });

  it('unanswered major incidents warn; minor ones stay quiet', () => {
    const t = setup();
    t.events.emit('emergency', { type: 'uncovered', id: 3, kind: 'medical', x: 1, z: 1, major: false, manualPossible: true });
    t.events.emit('emergency', { type: 'uncovered', id: 4, kind: 'crime', x: 1, z: 1, major: true, manualPossible: true });
    expect(t.names()).toEqual(['warning']);
  });

  it('monthly budget tick: rare, sooner when the budget flips between black and red; none in sandbox', () => {
    const t = setup();
    const month = (net: number) => {
      t.state.budget.lastIncome = { 'tax:R': net > 0 ? net + 100 : 100 };
      t.state.budget.lastExpense = { 'service:police': net > 0 ? 100 : 100 - net };
      t.events.emit('month', 1);
      vi.advanceTimersByTime(400);
    };
    month(500);
    expect(t.names()).toEqual(['coin']);
    vi.advanceTimersByTime(30_000);
    month(400); // same sign, 30 s later: silent
    expect(t.names()).toEqual(['coin']);
    vi.advanceTimersByTime(25_000);
    month(-300); // flipped into the red: plays sooner
    expect(t.names()).toEqual(['coin', 'cashLow']);
    const s = setup({ sandbox: true });
    s.state.budget.lastIncome = { 'tax:R': 900 };
    s.events.emit('month', 1);
    vi.advanceTimersByTime(400);
    expect(s.names()).toEqual([]);
  });
});
