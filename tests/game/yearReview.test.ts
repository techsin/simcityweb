/** LG-21: annual windows, replica-only reads, pacing and card lifetime without WebGL. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext, UIEvents } from '../../src/game/context';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import { CityState, HISTORY_KEYS } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import type { CityEvents } from '../../src/sim/Simulation';
import { APPROVAL_LABELS } from '../../src/sim/economy/approval';
import { REWARDS } from '../../src/sim/economy/rewards';
import { buildYearReview, YearReview, yearGradeInput, yearReviewDue } from '../../src/ui/YearReview';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();

function city(): CityState {
  const state = new CityState(defaultCityConfig({ seed: 7, startYear: 2000, name: 'Queensbury' }));
  for (let t = 0; t <= 36; t++) {
    for (const key of HISTORY_KEYS) state.history[key].push(0);
    const h = state.history;
    h.t[t] = t; h.reviewSample[t] = h.reviewTermsSample[t] = 1; h.pop[t] = 1000 + t * 10;
    h.funds[t] = h.reviewFunds[t] = 3000; h.expense[t] = h.recurringExpense[t] = 1000;
    h.income[t] = 1200; h.recurringNet[t] = 200; h.approval[t] = 60 + t / 5;
    h.approval_services[t] = t * 0.3; h.approval_crime[t] = t * -0.2;
    h.approval_noise[t] = t * -0.4; h.approval_tax[t] = t * 0.1;
    h.resCrime[t] = 0.1; h.air[t] = 0.05; h.noisyHomes[t] = 0.05; h.homeServices[t] = 0.8;
    h.unemployment[t] = 0.06; h.incidents[t] = h.emergencyAnswered[t] = 10;
    h.tourists[t] = 100 + t; h.eq[t] = 100; h.hq[t] = 110;
  }
  state.stats.population = 1240;
  state.systemData.economy = { yearReviewGoals: { seen: [], completed: { 'rank:village': 24, mayor_house: 13, museum: 25 } } };
  return state;
}

describe('year review model', () => {
  it('matches the Graphs population interval and averages/sums the twelve completed months for grading', () => {
    const state = city(), report = buildYearReview(state, 2002)!;
    expect(report.population).toBe(1240);
    expect(report.populationChange).toBe(120);
    expect(report.growth).toBeCloseTo(120 / 1120, 12);
    expect(yearGradeInput(state.history, 24)?.growth).toBeCloseTo(120 / 1120, 12);
    expect(report.bankMonths).toBe(3);
    expect(report.recurringNet).toBe(2400);
    expect(report.incidents).toBe(120);
    expect(report.answered).toBe(120);
    expect(report.tourists).toBe(118.5);
    expect(yearGradeInput(state.history, 24)?.approval).toBeCloseTo(63.7);
    expect(report.grade).not.toBeNull();
    expect(report.pastGrades.map((past) => past.year)).toEqual([2000, 2001]);
    expect(report.completed).toEqual(["Mayor's House", 'Village']);
    expect(report.next).toHaveLength(3);
  });

  it('shares the approval tooltip labels and ranks changes by magnitude', () => {
    const report = buildYearReview(city(), 2002)!;
    expect(report.terms.map((t) => t.id)).toEqual(['noise', 'services', 'crime']);
    for (const term of report.terms) expect(term.label).toBe(APPROVAL_LABELS[term.id]);
    expect(report.terms[0].change).toBeCloseTo(-4.8);
  });

  it('hides base and limit adjustments just as the tooltip does', () => {
    const state = city(); state.history.approval_clamp[24] = -20; state.history.approval_base[24] = 65;
    expect(buildYearReview(state, 2002)?.terms.map((t) => t.id)).toEqual(['noise', 'services', 'crime']);
  });

  it('uses a yearly emergency label and omits changes that would print as zero points', () => {
    const state = city();
    for (const key of ['approval_noise', 'approval_services', 'approval_crime', 'approval_tax'] as const) state.history[key][24] = state.history[key][12];
    state.history.approval_emergencies[24] = -0.3;
    state.history.approval_parks[24] = 0.049;
    state.history.approval_tourism[24] = -0.049;
    state.history.approval_pollution[24] = 0.05;
    state.history.approval_unemployment[24] = -0.05;
    expect(buildYearReview(state, 2002)?.terms).toEqual([
      { id: 'emergencies', label: 'Emergencies', change: -0.3 },
      { id: 'pollution', label: APPROVAL_LABELS.pollution, change: 0.05 },
      { id: 'unemployment', label: APPROVAL_LABELS.unemployment, change: -0.05 },
    ]);
  });

  it('preserves the negative-funds cutoff despite rounded Graphs funds', () => {
    const state = city();
    state.history.funds[24] = 0; state.history.reviewFunds[24] = -0.01;
    const report = buildYearReview(state, 2002)!;
    expect(report.grade?.scores.finances).toBe(0);
    expect(report.funds).toBe(-0.01);
    expect(report.bankMonths).toBeLessThan(0);
  });

  it('does not turn missing old-save or gapped monthly inputs into a grade', () => {
    const state = city();
    state.history.reviewSample[13] = 0;
    const old = buildYearReview(state, 2002)!;
    expect(old.grade).toBeNull();
    expect(old.answered).toBeNull();
    expect(old.populationChange).toBe(120);
    expect(old.pastGrades.map((g) => g.year)).toEqual([2000]);
    state.history.reviewSample[12] = 0;
    state.history.reviewTermsSample[12] = 0;
    expect(buildYearReview(state, 2002)?.termsMeasured).toBe(false);
    state.history.reviewSample[13] = 1; state.history.t[13] = 12;
    expect(yearGradeInput(state.history, 24)).toBeNull();
    expect(buildYearReview(state, 2004)).toBeNull();
  });

  it('handles capped histories by month index and prints only the captured year', () => {
    const state = city(), before = buildYearReview(state, 2002)!;
    for (const key of HISTORY_KEYS) state.history[key].splice(0, 10);
    expect(buildYearReview(state, 2002)?.grade).toEqual(before.grade);
    expect(buildYearReview(state, 2002)?.populationChange).toBe(120);
    state.history.pop[state.history.t.indexOf(25)] = 999999;
    expect(before.population).toBe(1240);
    expect(buildYearReview(state, 2002)?.population).toBe(1240);
  });

  it('is deterministic for an equivalent save and reads frozen replica data without writing', () => {
    const state = city();
    const first = buildYearReview(state, 2002, 'North Bay');
    for (const key of HISTORY_KEYS) Object.freeze(state.history[key]);
    Object.freeze(state.history); Object.freeze(state.systemData); Object.freeze(state.stats);
    expect(buildYearReview(state, 2002, 'North Bay')).toEqual(first);
    const loaded = city();
    loaded.history = structuredClone(state.history);
    expect(buildYearReview(loaded, 2002, 'North Bay')).toEqual(first);
    expect(first?.region).toContain('North Bay');
  });
});

function fixture(initialYear = 2000) {
  const state = city(); state.day = (initialYear - 2000) * 360;
  const events = new Emitter<CityEvents>(), ui = new Emitter<UIEvents>();
  const scene = new FEl('div'), root = new FEl('div'), canvas = new FEl('canvas'), win = new FEl('window');
  scene.append(canvas, root); vi.stubGlobal('window', win);
  const abort = new AbortController();
  const policy = { live: false, subscribe: vi.fn((listener: (p: { live: boolean }) => void, signal: AbortSignal) => {
    policyListener = listener;
    signal.addEventListener('abort', () => { policyListener = null; }, { once: true });
    return () => { policyListener = null; };
  }) };
  let policyListener: ((p: { live: boolean }) => void) | null = null;
  const host = { events, policy, speed: 1, get sim(): never { throw new Error('No simulation access'); } };
  const settings = { ...DEFAULT_SETTINGS, newYear: 'off' as const };
  const ctx = { state, host, ui, signal: abort.signal, root, canvas, settings,
    get sim(): never { throw new Error('No simulation access'); },
  } as unknown as GameContext;
  const show = { busy: false };
  new YearReview(ctx, { busy: () => show.busy });
  const tick = () => ui.emit('uiTick', undefined);
  const ready = () => ui.emit('viewsReady', undefined);
  const year = (year: number) => { state.day = (year - 2000) * 360; events.emit('year', year); };
  const live = (on: boolean) => { policy.live = on; policyListener?.(policy); };
  return { state, ctx, events, ui, root, canvas, scene, win, abort, host, settings, show, tick, ready, year, live,
    card: () => root.querySelector('.year-review'),
  };
}

describe('year review lifetime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('never shows on load/reset or a duplicate year; shows immediately on January 1 with the show off', () => {
    const f = fixture(2020);
    f.ready(); f.tick(); f.events.emit('reset', undefined); f.year(2020);
    expect(f.card()).toBeNull(); f.abort.abort();
    const next = fixture();
    next.year(2001); expect(next.card()).toBeNull();
    next.ready(); next.year(2002);
    expect(textOf(next.card()!)).toContain('Queensbury Gazette — 2002');
    next.card()!.querySelector('.yr-close')!.click();
    next.year(2002); next.tick(); expect(next.card()).toBeNull(); next.abort.abort();
  });

  it('waits for busy to clear and closes after fifteen real seconds, also while paused', () => {
    const f = fixture(); f.ready(); f.show.busy = true; f.year(2001);
    f.scene.fire('wheel', { target: f.canvas }); f.win.fire('keydown', { key: 'w', target: f.canvas });
    expect(f.card()).toBeNull(); vi.advanceTimersByTime(20000);
    f.show.busy = false; f.tick(); expect(f.card()).not.toBeNull();
    f.host.speed = 0; vi.advanceTimersByTime(14999); expect(f.card()).not.toBeNull();
    vi.advanceTimersByTime(1); expect(f.card()).toBeNull(); f.abort.abort();
  });

  it('dates delayed figures at the captured January even when the city advances during the show', () => {
    const f = fixture(); f.ready(); f.show.busy = true; f.year(2002);
    f.state.day += 150; f.state.stats.population = 999999;
    f.state.history.pop[25] = 999999;
    f.show.busy = false; f.tick();
    expect(textOf(f.card()!)).toContain('Figures on 1 January 2002');
    const residents = f.card()!.querySelector('.yr-metric')!;
    expect(textOf(residents)).toContain('1,240');
    expect(textOf(residents)).toContain('+120 residents');
    expect(textOf(f.card()!)).not.toContain('999,999');
    f.abort.abort();
  });

  it('shows unavailable approval until residents arrive and omits an empty Next goals block', () => {
    const f = fixture();
    f.state.history.pop[12] = 0;
    for (const reward of REWARDS) f.state.unlocked.add(reward.id);
    f.ready(); f.year(2001);
    expect(f.card()!.querySelectorAll('h3').map(textOf)).toContain('Approval —');
    expect(textOf(f.card()!)).toContain('No residents yet.');
    expect(textOf(f.card()!)).not.toContain('Approval 62');
    expect(f.card()!.querySelector('.yr-next')).toBeNull();
    f.abort.abort();
  });

  it('uses a save-stable cadence at each speed', () => {
    const years = Array.from({ length: 20 }, (_, i) => 2001 + i);
    expect(years.filter((y) => yearReviewDue(y, 2000, 1))).toHaveLength(20);
    expect(years.filter((y) => yearReviewDue(y, 2000, 2))).toEqual(years.filter((y) => y % 2 === 0));
    expect(years.filter((y) => yearReviewDue(y, 2000, 3))).toEqual([2005, 2010, 2015, 2020]);
    const f = fixture(); f.ready(); f.host.speed = 2;
    f.year(2001); expect(f.card()).toBeNull(); f.year(2002); expect(f.card()).not.toBeNull(); f.abort.abort();
  });

  it('keeps the full fifteen seconds when an ineligible ultra-speed New Year arrives', () => {
    const f = fixture(), history = f.state.history;
    for (const key of HISTORY_KEYS) history[key].push(...new Array(24).fill(history[key].at(-1)));
    for (let t = 37; t <= 60; t++) history.t[t] = t;
    f.ready(); f.host.speed = 3; f.year(2005); expect(f.card()).not.toBeNull();
    vi.advanceTimersByTime(7000); f.year(2006); expect(f.card()).not.toBeNull();
    vi.advanceTimersByTime(7999); expect(f.card()).not.toBeNull();
    vi.advanceTimersByTime(1); expect(f.card()).toBeNull(); f.abort.abort();
  });

  it('drops LIVE years and pending cards, hides an open card at once, and never replays them', () => {
    const f = fixture(); f.ready(); f.live(true); f.year(2001); f.live(false); f.tick();
    expect(f.card()).toBeNull();
    f.show.busy = true; f.year(2002); f.live(true); f.show.busy = false; f.live(false); f.tick();
    expect(f.card()).toBeNull();
    f.year(2003); expect(f.card()).not.toBeNull(); f.live(true); expect(f.card()).toBeNull();
    f.live(false); f.tick(); expect(f.card()).toBeNull(); f.abort.abort();
  });

  it('the setting hides and cancels a pending card immediately', () => {
    const f = fixture(); f.ready(); f.year(2001); expect(f.card()).not.toBeNull();
    f.settings.yearReview = false; f.ui.emit('settings', f.settings); expect(f.card()).toBeNull();
    f.year(2002); f.settings.yearReview = true; f.tick(); expect(f.card()).toBeNull();
    f.show.busy = true; f.year(2003); f.settings.yearReview = false; f.ui.emit('settings', f.settings);
    f.show.busy = false; f.settings.yearReview = true; f.tick(); expect(f.card()).toBeNull(); f.abort.abort();
  });

  it.each(['pointerdown', 'wheel', 'touchstart', 'pointermove'])('dismisses on map %s and keeps the input available to the map', (event) => {
    const f = fixture(); f.ready(); f.year(2001);
    const preventDefault = vi.fn(); f.scene.fire(event, { type: event, target: f.canvas, buttons: 1, preventDefault });
    expect(f.card()).toBeNull(); expect(preventDefault).not.toHaveBeenCalled(); f.abort.abort();
  });

  it('dismisses on minimap input, ignores idle hovering, and follows a replacement city canvas', () => {
    const f = fixture(); f.ready(); f.year(2001);
    f.scene.fire('pointermove', { type: 'pointermove', target: f.canvas, buttons: 0 }); expect(f.card()).not.toBeNull();
    const mini = new FEl('canvas'); vi.spyOn(mini, 'closest').mockReturnValue(mini);
    f.scene.fire('pointerdown', { target: mini }); expect(f.card()).toBeNull();
    const fresh = new FEl('canvas'); f.scene.appendChild(fresh);
    (f.ctx as unknown as { canvas: FEl }).canvas = fresh;
    f.year(2002); f.scene.fire('wheel', { target: fresh }); expect(f.card()).toBeNull(); f.abort.abort();
  });

  it('dismisses on camera keys and releases subscriptions, DOM listeners and timer on exit', () => {
    const f = fixture(); f.ready(); f.year(2001); f.win.fire('keydown', { key: 'w', code: 'KeyW', target: f.canvas });
    expect(f.card()).toBeNull(); f.year(2002); expect(f.card()).not.toBeNull();
    f.abort.abort(); expect(f.card()).toBeNull(); expect(vi.getTimerCount()).toBe(0);
    expect(f.win.listenerCount()).toBe(0); expect(f.scene.listenerCount()).toBe(0);
    f.year(2003); f.tick(); expect(f.card()).toBeNull();
  });
});
