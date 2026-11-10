import { describe, expect, it } from 'vitest';
import { Network, type Difficulty } from '../../src/core/types';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { BF, CityState, type Building } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { getDef } from '../../src/sim/catalog';
import { defaultCityConfig } from '../../src/sim/config';
import { approvalSystem } from '../../src/sim/economy/approval';
import { budgetSystem, computeMonthlyBudget, mayorRemoval } from '../../src/sim/economy/budget';
import { loanOffer, maxLoanAmount, takeLoanNow } from '../../src/sim/economy/loans';
import { buildingUpkeep, expectedUpkeep, facilityOpex, opexRateOf, tierOperatingCosts } from '../../src/sim/economy/opex';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { DIFFICULTY_RULES } from '../../src/sim/economy/tuning';
import type { FacilityLoad } from '../../src/sim/infra/catchments';

function city(difficulty: Difficulty): CityState {
  return new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', difficulty, disasters: false }));
}

function budget(st: CityState): Simulation {
  return new Simulation(st, [budgetSystem(new EconRuntime())]);
}

/** A fixed recurring expense keeps each month's closing balance negative without other systems changing it. */
function debtCity(difficulty: Difficulty): CityState {
  const st = city(difficulty);
  st.funds = 0;
  st.network[0] = Network.Highway;
  return st;
}

describe('LG-09 Hard and Expert rules', () => {
  it('adds the prescribed Hard rules and Expert restrictions', () => {
    expect(DIFFICULTY_RULES.hard).toMatchObject({
      income: 0.85, opexMultiplier: 1.15, taxPerPoint: -4.5, disasterMultiplier: 1.5,
      manualDispatchWindowMultiplier: 1, bankruptRemovalMonths: 12, loanCutoffYears: null,
    });
    expect(DIFFICULTY_RULES.expert).toMatchObject({
      income: 0.85, opexMultiplier: 1.15, taxPerPoint: -4.5, disasterMultiplier: 3,
      manualDispatchWindowMultiplier: 0.75, bankruptRemovalMonths: 12, loanCutoffYears: 5,
    });
    expect(defaultCityConfig({ difficulty: 'expert' })).toMatchObject({
      startFunds: 40_000, sandbox: false, disasters: true,
    });
  });

  it.each(['medium', 'hard', 'expert'] as const)('%s charges the same running costs in forecasts, estimates and facility details', (difficulty) => {
    const st = city(difficulty), school = getDef('civ_elementary_school')!;
    st.systemData.infraVersion = 1;
    st.budget.funding.education = 75;
    st.stats.needs.elementary.served = 600;
    const schools: Building[] = [1, 2].map((id) => ({
      id, def: school.id, x: id * 4, z: 4, w: school.footprint[0], d: school.footprint[1], rot: 0, variant: 0,
      pop: 0, jobs: 0, capacity: 0, wealth: 0, built: 0, age: 1, flags: BF.Plopped | BF.Powered | BF.Watered,
      baseY: 0, health: 1, unhappy: 0,
    }));
    for (const b of schools) st.buildings.set(b.id, b);
    const services: SimSystem & { facilityLoadOf(state: CityState, id: number): FacilityLoad } = {
      name: 'services',
      facilityLoadOf: (_state, id) => ({
        tier: 'elementary', needTier: 'elementary', capacity: 1500, demand: id * 200, utilization: id * 200 / 1500,
        served: id * 200, seated: id * 200, operating: 1, powered: true, radius: 20, metric: 'walk',
      }),
    };
    const sim = new Simulation(st, [services]);
    const multiplier = difficulty === 'medium' ? 1 : 1.15;
    const running = 600 * 0.6 * multiplier;
    const fixed = school.upkeep! * 0.3;
    expect(tierOperatingCosts(st, new Set(['elementary']))).toEqual({ elementary: running });
    expect(buildingUpkeep(st, school)).toBe(fixed);
    expect(expectedUpkeep(st, school, 600)).toBeCloseTo(fixed + running, 12);
    const details = schools.map((b) => facilityOpex(sim, b)!);
    expect(details[0].rate).toBe(0.6 * multiplier);
    expect(details[0].people).toBe(200);
    expect(details[1].people).toBe(400);
    expect(details[0].running + details[1].running).toBeCloseTo(running, 12);
    expect(details[0].building + details[1].building).toBeCloseTo(2 * fixed * 0.75, 12);
    expect(computeMonthlyBudget(st, null).expense['service:education']).toBe(Math.round(2 * fixed * 0.75 + running));
    delete st.systemData.infraVersion;
    expect(tierOperatingCosts(st)).toEqual({});
    expect(expectedUpkeep(st, school, 600)).toBe(school.upkeep);
  });

  it('reports difficulty-adjusted service rates while callers without a city keep the catalog rate', () => {
    const school = getDef('civ_elementary_school')!;
    expect(opexRateOf(school, city('medium'))).toEqual({ tier: 'elementary', rate: 0.6, unit: 'pupil' });
    for (const difficulty of ['hard', 'expert'] as const) {
      expect(opexRateOf(school, city(difficulty))).toEqual({ tier: 'elementary', rate: 0.6 * 1.15, unit: 'pupil' });
    }
    expect(opexRateOf(school)).toEqual({ tier: 'elementary', rate: 0.6, unit: 'pupil' });
    expect(opexRateOf(school, null)).toEqual(opexRateOf(school));
    expect(opexRateOf(getDef('civ_jail'), city('expert'))).toBeNull();
  });

  it.each([['medium', -3.5], ['hard', -4.5], ['expert', -4.5]] as const)('%s penalizes above-neutral taxes per point and keeps low-tax approval', (difficulty, perPoint) => {
    for (const [rate, expected] of [[11, 2 * perPoint], [9, 0], [7, 3]]) {
      const st = city(difficulty);
      st.stats.population = 1000;
      st.stats.residents = [1000, 0, 0];
      st.budget.taxRates.fill(rate);
      new Simulation(st, [approvalSystem(new EconRuntime())]);
      expect(econData(st).approvalTerms.tax, `tax ${rate}%`).toBe(expected);
    }
  });
});

describe('LG-09 persistent mayor removal', () => {
  it.each(['hard', 'expert'] as const)('%s removes the mayor on month 12 and posts its action reference exactly once, including after load', (difficulty) => {
    const st = debtCity(difficulty), sim = budget(st);
    const removalNews: unknown[] = [];
    sim.events.on('news', (n) => { if (n.ref?.advice === 'mayorRemoved') removalNews.push(n); });
    sim.runDays(330);
    expect(econData(st).monthsNegative).toBe(11);
    expect(mayorRemoval(st)).toBeUndefined();
    sim.runDays(30);
    const removed = { day: 360, bankruptSinceDay: 0, reason: 'bankruptcy' };
    expect(mayorRemoval(st)).toEqual(removed);
    expect(removalNews).toHaveLength(1);
    expect(st.news.filter((n) => n.ref?.advice === 'mayorRemoved')).toHaveLength(1);
    const loaded = deserializeCity(serializeCity(st, { copy: true })), resumed = budget(loaded);
    resumed.runDays(60);
    expect(mayorRemoval(loaded)).toEqual(removed);
    expect(loaded.news.filter((n) => n.ref?.advice === 'mayorRemoved')).toHaveLength(1);
    loaded.funds = 1000;
    resumed.runDays(30);
    expect(econData(loaded).monthsNegative).toBe(0);
    expect(mayorRemoval(loaded)).toEqual(removed);
  });

  it.each(['hard', 'expert'] as const)('%s starts the 12-month streak again after a solvent month', (difficulty) => {
    const st = debtCity(difficulty), sim = budget(st);
    sim.runDays(330);
    st.funds = 1000;
    sim.runDays(30);
    expect(econData(st).monthsNegative).toBe(0);
    expect(mayorRemoval(st)).toBeUndefined();
    st.funds = 0;
    sim.runDays(330);
    expect(mayorRemoval(st)).toBeUndefined();
    sim.runDays(30);
    expect(mayorRemoval(st)).toEqual({ day: 720, bankruptSinceDay: 360, reason: 'bankruptcy' });
  });

  it.each(['hard', 'expert'] as const)('%s with a sandbox override never removes the mayor', (difficulty) => {
    const st = debtCity(difficulty);
    st.config.sandbox = true;
    econData(st).monthsNegative = 11;
    budget(st).runDays(390);
    expect(econData(st).monthsNegative).toBe(0);
    expect(mayorRemoval(st)).toBeUndefined();
    expect(st.news.some((n) => n.ref?.advice === 'mayorRemoved')).toBe(false);
  });

  it.each(['easy', 'medium', 'hard', 'sandbox'] as const)('%s old saves without removal or a negative-month field load and continue with a finite streak', (difficulty) => {
    const st = debtCity(difficulty);
    delete (econData(st) as unknown as Record<string, unknown>).monthsNegative;
    const saved = serializeCity(st, { copy: true });
    const loaded = deserializeCity(saved);
    expect(mayorRemoval(loaded)).toBeUndefined();
    budget(loaded).runDays(60);
    expect(econData(loaded).monthsNegative).toBe(difficulty === 'sandbox' ? 0 : 2);
    expect(Number.isFinite(econData(loaded).monthsNegative)).toBe(true);
    expect(mayorRemoval(loaded)).toBeUndefined();
  });
});

describe('LG-09 Expert loan cutoff', () => {
  it('permits borrowing through foundedDay + 1799 and blocks all new borrowing from foundedDay + 1800', () => {
    const st = city('expert');
    st.systemData.foundedDay = 90;
    st.day = 1889;
    expect(maxLoanAmount(st)).toBe(60_000);
    expect(takeLoanNow(st, 5000).ok).toBe(true);
    st.day = 1890;
    const funds = st.funds;
    expect(maxLoanAmount(st)).toBe(0);
    expect(loanOffer(st, 5000)).toMatchObject({ ok: false, maxAmount: 0, reason: expect.stringContaining('year 5') });
    expect(takeLoanNow(st, 5000).ok).toBe(false);
    expect(st.funds).toBe(funds);
    expect(st.budget.loans).toHaveLength(1);
  });

  it('uses day zero as the founding day when an old city has no foundedDay', () => {
    const st = city('expert');
    delete st.systemData.foundedDay;
    st.day = 1799;
    expect(loanOffer(st, 5000).ok).toBe(true);
    st.day = 1800;
    expect(maxLoanAmount(st)).toBe(0);
    expect(loanOffer(st, 5000).ok).toBe(false);
  });

  it('keeps paying an existing loan after Expert borrowing closes', () => {
    const st = city('expert');
    st.systemData.foundedDay = 90;
    st.day = 1889;
    const offer = takeLoanNow(st, 5000), funds = st.funds;
    expect(offer.ok).toBe(true);
    budget(st).runDays(1);
    expect(loanOffer(st, 5000).ok).toBe(false);
    expect(st.budget.loans[0].monthsLeft).toBe(119);
    expect(st.budget.loans[0].remaining).toBeCloseTo(5000 * (1 + offer.rate / 12) - offer.monthlyPayment, 10);
    expect(st.budget.lastExpense.loan).toBe(Math.round(offer.monthlyPayment));
    expect(st.funds).toBe(funds - Math.round(offer.monthlyPayment));
  });

  it.each(['easy', 'medium', 'hard'] as const)('%s keeps borrowing open after year 5', (difficulty) => {
    const st = city(difficulty);
    st.day = 3600;
    expect(maxLoanAmount(st)).toBe(60_000);
    expect(takeLoanNow(st, 5000).ok).toBe(true);
  });
});
