import { describe, expect, it } from 'vitest';
import { BF, HISTORY_KEYS, YEAR_REVIEW_TERMS, padHistory, type HistorySeries, type YearReviewGoals } from '../../src/sim/CityState';
import { historySystem, recordHistory } from '../../src/sim/economy/history';
import { Simulation } from '../../src/sim/Simulation';
import { newState, place } from '../infra/cityGen';

function reviewCity() {
  const st = newState(16);
  st.systemData.economy = { resCrime: 0.123456789, resServices: 0.6, resParks: 0.9, approvalTerms: { tax: -3.123456789, parks: 2 } };
  return st;
}

describe('year review history telemetry', () => {
  it('pads old saves with unavailable samples, then records aligned measured months', () => {
    const st = reviewCity();
    st.history = { t: [1, 2], pop: [100, 200] } as unknown as HistorySeries;
    padHistory(st.history);
    expect(st.history.reviewSample).toEqual([0, 0]);
    expect(st.history.approval_tax).toEqual([0, 0]);
    st.day = 90;
    recordHistory(st);
    expect(st.history.reviewSample).toEqual([0, 0, 1]);
    expect(st.history.approval_tax).toEqual([0, 0, -3.123456789]);
    for (const key of HISTORY_KEYS) expect(st.history[key].length, key).toBe(3);
  });

  it('keeps recurring figures separate from one-off income and spending without rounding', () => {
    const st = reviewCity();
    st.budget.lastIncome = { 'tax:R': 500.125, 'ordinance:parking_fines': 20.25, 'oneoff:loan': 5000 };
    st.budget.lastExpense = { police: 100.0625, 'oneoff:construction': 3000 };
    recordHistory(st);
    expect(st.history.recurringExpense).toEqual([100.0625]);
    expect(st.history.recurringNet).toEqual([420.3125]);
    expect(st.history.income).toEqual([5520]);
    expect(st.history.expense).toEqual([3100]);
  });

  it('preserves a negative treasury below one unit for the finance cutoff', () => {
    const st = reviewCity();
    st.funds = -0.01;
    recordHistory(st);
    expect(st.history.reviewFunds).toEqual([-0.01]);
    expect(st.history.funds[0]).toBe(-0);
  });

  it('records Noisy occupied homes by building count and the mean of five services at homes', () => {
    const st = reviewCity();
    place(st, 't_r1', 1, 1, { pop: 1, flags: BF.Noisy });
    place(st, 't_r3', 3, 1, { pop: 400 });
    place(st, 't_r1', 6, 1, { pop: 0, flags: BF.Noisy });
    place(st, 't_cs', 8, 1, { pop: 10, flags: BF.Noisy });
    st.stats.avgNoise = 0.97;
    recordHistory(st);
    expect(st.history.noisyHomes).toEqual([0.5]);
    expect(st.history.homeServices[0]).toBeCloseTo(0.66);
    expect(st.history.resCrime).toEqual([0.123456789]);
    expect(st.history.noise).toEqual([0.97]);
  });

  it('snapshots exact approval term values and monthly emergency outcomes', () => {
    const st = reviewCity();
    Object.assign(st.stats.emergency.lastMonth, { auto: 3, manual: 2, failed: 1, buildingsLost: 4 });
    recordHistory(st);
    expect(st.history.emergencyAnswered).toEqual([5]);
    expect(st.history.emergencyFailed).toEqual([1]);
    expect(st.history.buildingsLost).toEqual([4]);
    for (const id of YEAR_REVIEW_TERMS) expect(st.history[`approval_${id}`]).toEqual([id === 'tax' ? -3.123456789 : id === 'parks' ? 2 : 0]);
    const data = st.systemData.economy as { approvalTerms: Record<string, number> };
    data.approvalTerms.tax = 5;
    recordHistory(st);
    expect(st.history.approval_tax).toEqual([-3.123456789, 5]);
    expect(HISTORY_KEYS).toContain('approval_base');
    expect(HISTORY_KEYS).toContain('approval_clamp');
  });

  it('uses only the optional advisor built-out flag', () => {
    const st = reviewCity();
    recordHistory(st);
    st.systemData.advisors = { builtOut: true };
    recordHistory(st);
    st.systemData.advisors = { builtOut: false };
    recordHistory(st);
    expect(st.history.builtOut).toEqual([0, 1, 0]);
  });

  it('does not count missing economy telemetry as a measured review sample', () => {
    const st = newState(16);
    recordHistory(st);
    expect(st.history.reviewSample).toEqual([0]);
  });

  it('seeds a January checkpoint approval baseline without fabricating an old grade or a new history point', () => {
    const st = reviewCity(); st.day = 7200;
    st.history = { t: [240], pop: [5000] } as unknown as HistorySeries;
    new Simulation(st, [historySystem()]);
    expect(st.history.t).toEqual([240]);
    expect(st.history.reviewSample).toEqual([0]);
    expect(st.history.reviewTermsSample).toEqual([1]);
    expect(st.history.approval_tax).toEqual([-3.123456789]);
    const midyear = reviewCity(); midyear.day = 7201;
    midyear.history.t.push(240); padHistory(midyear.history);
    new Simulation(midyear, [historySystem()]);
    expect(midyear.history.reviewTermsSample).toEqual([0]);
  });

  it('silently seeds old goals on init and stamps newly reached goals only once', () => {
    const st = reviewCity();
    st.stats.population = 5000;
    st.unlocked.add('mayor_house');
    st.day = 360;
    const sim = new Simulation(st, [historySystem()]);
    const data = st.systemData.economy as { yearReviewGoals: YearReviewGoals };
    expect(data.yearReviewGoals.seen).toEqual(['mayor_house', 'rank:settlement', 'rank:village', 'rank:town']);
    expect(data.yearReviewGoals.completed).toEqual({});
    st.stats.population = 10000;
    st.unlocked.add('museum');
    st.day = 390;
    sim.systems[0].monthly?.(sim);
    expect(data.yearReviewGoals.completed).toEqual({ museum: 13, 'rank:small_city': 13 });
    st.day = 420;
    sim.systems[0].monthly?.(sim);
    expect(data.yearReviewGoals.completed).toEqual({ museum: 13, 'rank:small_city': 13 });
    expect(data.yearReviewGoals.seen.filter((id) => id === 'museum')).toHaveLength(1);
    sim.systems[0].init?.(sim);
    expect(data.yearReviewGoals.completed).toEqual({ museum: 13, 'rank:small_city': 13 });
    expect(st.news).toHaveLength(0);
  });

  it('does not claim a previously reached rank again after a population drop and recovery', () => {
    const st = reviewCity();
    st.stats.population = 1000;
    st.systemData.cityRanks = { village: true, town: true };
    const sim = new Simulation(st, [historySystem()]);
    st.stats.population = 5000; st.day = 360;
    sim.systems[0].monthly?.(sim);
    const data = st.systemData.economy as { yearReviewGoals: YearReviewGoals };
    expect(data.yearReviewGoals.completed).toEqual({});
    expect(data.yearReviewGoals.seen).toContain('rank:town');
  });
});
