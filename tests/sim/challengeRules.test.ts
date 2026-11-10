/**
 * LG-14 "Mayor's challenges": the rules a city is founded with (src/sim/economy/challenges.ts, config.challenges).
 * - No loans: the bank lends nothing, and says why.
 * - No dirty industry: I-D never opens; manufacturing still does.
 * - Frequent disasters: the same single monthly draw, FREQUENT_DISASTERS times as likely, with no extra draw.
 * - Hard money: ALL of Hard's money rules on any difficulty (NOTE-104): its tax income, LG-09's running costs ×1.15 (the
 *   budget, its forecast and the upkeep cards agree) and the 12-month bankruptcy removal; the starting funds are the
 *   dialog's (applyChallenges). Not Hard's tax-approval cost nor its disaster odds: those stay the difficulty's.
 * - A city without challenges takes none of these branches: every figure is what it was.
 * - The badges: earned at the "City" rank, kept after a later drop, written into the tile summary.
 */
import { describe, expect, it } from 'vitest';
import { makeCity, road } from './helpers';
import { DevType, Network, Zone, type Difficulty } from '../../src/core/types';
import { RNG } from '../../src/core/rng';
import { getDef } from '../../src/sim/catalog';
import { BF, CityState, type Building } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { approvalSystem } from '../../src/sim/economy/approval';
import { budgetSystem, computeMonthlyBudget, mayorRemoval } from '../../src/sim/economy/budget';
import {
  CHALLENGE_BADGE_POP, CHALLENGE_BADGE_RANK, FREQUENT_DISASTERS, MAYOR_CHALLENGES, NO_LOANS_REASON, cityChallenges, disasterRate,
  earnedChallenges, hasChallenge, moneyDifficulty, type MayorChallenge,
} from '../../src/sim/economy/challenges';
import { loanOffer, maxLoanAmount, takeLoanNow } from '../../src/sim/economy/loans';
import { expectedUpkeep, facilityOpex, opexRateOf, tierOperatingCosts } from '../../src/sim/economy/opex';
import { CITY_RANKS, rewardsSystem } from '../../src/sim/economy/rewards';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { DISASTER_MIN_POP, OPEX_BUILDING_SHARE, TAX_PER_RES, difficultyRules } from '../../src/sim/economy/tuning';
import type { FacilityLoad } from '../../src/sim/infra/catchments';
import { DisastersSystem } from '../../src/sim/infra/disasters';
import { facilityDefFacts, fullUseUpkeep } from '../../src/sim/infra/facilities';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { summarizeCity } from '../../src/region/citySummary';
import { upkeepEstimate } from '../../src/ui/upkeepModel';
import { newState } from '../infra/cityGen';

const withChallenges = (st: CityState, ...ids: MayorChallenge[]): CityState => { st.config = { ...st.config, challenges: ids }; return st; };

describe('LG-14 challenge config', () => {
  it('reads the challenges of a config; a config without the field has none', () => {
    expect(MAYOR_CHALLENGES).toEqual(['noLoans', 'noDirtyIndustry', 'frequentDisasters', 'hardMoney']);
    for (const id of MAYOR_CHALLENGES) {
      expect(hasChallenge({}, id)).toBe(false);
      expect(hasChallenge({ challenges: [] }, id)).toBe(false);
      expect(hasChallenge({ challenges: [id] }, id)).toBe(true);
    }
    // known ids only, once each, in the table's order
    expect(cityChallenges({ challenges: ['hardMoney', 'someLaterRule', 'noLoans', 'hardMoney'] })).toEqual(['noLoans', 'hardMoney']);
    expect(cityChallenges({})).toEqual([]);
  });

  it('the money difficulty and the disaster rate are the city\'s own without the challenge', () => {
    for (const d of ['easy', 'medium', 'hard', 'sandbox']) {
      expect(moneyDifficulty({ difficulty: d })).toBe(d);
      expect(moneyDifficulty({ difficulty: d, challenges: ['noLoans'] })).toBe(d);
      expect(moneyDifficulty({ difficulty: d, challenges: ['hardMoney'] })).toBe('hard');
    }
    expect(disasterRate({})).toBe(1);
    expect(disasterRate({ challenges: ['hardMoney'] })).toBe(1);
    expect(disasterRate({ challenges: ['frequentDisasters'] })).toBe(FREQUENT_DISASTERS);
    // LG-15's "Frequent ×2"
    expect(FREQUENT_DISASTERS).toBe(2);
  });

  it('the badge rank is the "City" rank of the ladder', () => {
    expect(CITY_RANKS.find((r) => r.id === CHALLENGE_BADGE_RANK)).toEqual({ id: 'city', name: 'City', population: CHALLENGE_BADGE_POP });
  });
});

describe('LG-14 No loans', () => {
  it('the bank lends nothing and says why; without the challenge the same city borrows as before', () => {
    const plain = makeCity().st, pledged = withChallenges(makeCity().st, 'noLoans');
    for (const st of [plain, pledged]) st.stats.population = 20_000;
    expect(maxLoanAmount(plain)).toBeGreaterThan(100_000);
    expect(loanOffer(plain, 20_000)).toMatchObject({ ok: true });
    expect(maxLoanAmount(pledged)).toBe(0);
    expect(loanOffer(pledged, 20_000)).toMatchObject({ ok: false, reason: NO_LOANS_REASON, maxAmount: 0 });
    const funds = pledged.funds;
    expect(takeLoanNow(pledged, 20_000).ok).toBe(false);
    expect(pledged.funds).toBe(funds);
    expect(pledged.budget.loans).toEqual([]);
    expect(pledged.budget.curIncome['oneoff:loan']).toBeUndefined();
    expect(takeLoanNow(plain, 20_000).ok).toBe(true);
    expect(plain.budget.loans).toHaveLength(1);
  });

  it('the action is refused with the reason (the Budget panel shows it)', () => {
    const { st, A } = makeCity();
    withChallenges(st, 'noLoans');
    st.stats.population = 20_000;
    expect(A.takeLoan(20_000)).toMatchObject({ ok: false, reason: NO_LOANS_REASON });
  });
});

describe('LG-14 Hard money', () => {
  const taxR = (st: CityState): number => computeMonthlyBudget(st, null).income['tax:R$'];
  const city = (difficulty: 'easy' | 'medium' | 'hard', ...ids: MayorChallenge[]): CityState => {
    const st = makeCity({ difficulty }).st;
    st.stats.residents = [1000, 0, 0];
    return ids.length ? withChallenges(st, ...ids) : st;
  };

  it('tax income follows Hard\'s rule on any difficulty, and the city\'s own rule without the challenge', () => {
    // (the budget's lines are whole simoleons)
    const base = 1000 * TAX_PER_RES[0] * 9;
    for (const d of ['easy', 'medium', 'hard'] as const) expect(taxR(city(d))).toBe(Math.round(base * difficultyRules(d).income));
    for (const d of ['easy', 'medium', 'hard'] as const) expect(taxR(city(d, 'hardMoney'))).toBe(taxR(city('hard')));
    expect(taxR(city('hard'))).toBeLessThan(taxR(city('medium')));
    expect(taxR(city('medium'))).toBeLessThan(taxR(city('easy')));
    // another challenge leaves the money alone
    expect(taxR(city('medium', 'noLoans'))).toBe(taxR(city('medium')));
  });

  /** a 16-cell city (the LG-09 tests' city) of the given difficulty and challenges */
  const small = (difficulty: Difficulty, ...ids: MayorChallenge[]): CityState => {
    const st = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', difficulty, disasters: false }));
    return ids.length ? withChallenges(st, ...ids) : st;
  };

  /**
   * Every figure of a city's running costs, with two elementary schools serving 600 of 2,000 pupils at 75% funding (the
   * services system's per-school loads: 200 and 400 pupils): the tier's running costs, the Budget panel's forecast, the
   * rate, each school's share (inspector), the upkeep card and the build menu's facts, a fire station's full-use figure
   * (infra/facilities.ts fullUseUpkeep), and what the budget then charges for the month.
   */
  function runningCosts(difficulty: Difficulty, ...ids: MayorChallenge[]) {
    const st = small(difficulty, ...ids), school = getDef('civ_elementary_school')!;
    st.systemData.infraVersion = 1;
    st.budget.funding.education = 75;
    st.stats.needs.elementary.need = 2000;
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
    const sim = new Simulation(st, [services, budgetSystem(new EconRuntime())]);
    const figures = {
      tier: tierOperatingCosts(st, new Set(['elementary'])).elementary!,
      forecast: computeMonthlyBudget(st, null).expense['service:education'],
      rate: opexRateOf(school, st)!.rate,
      typical: expectedUpkeep(st, school),
      shares: schools.map((b) => facilityOpex(sim, b)!.running),
      card: upkeepEstimate(st, school)!,
      facts: facilityDefFacts(school.id, st).find((f) => f.key === 'upkeep')!,
      fireFull: fullUseUpkeep(getDef('civ_fire_station')!, st),
    };
    sim.runDays(30);
    return { ...figures, charged: st.budget.lastExpense['service:education'] };
  }

  it('a Medium city under Hard money pays Hard\'s running costs (×1.15), and the budget and the UI estimates agree; without it, Medium\'s', () => {
    const plain = runningCosts('medium'), pledged = runningCosts('medium', 'hardMoney');
    // every figure is a Hard city's
    expect(pledged).toEqual(runningCosts('hard'));
    // ... which is Medium's running costs × 1.15 (the building upkeep is the same)
    const fixed = 2 * getDef('civ_elementary_school')!.upkeep! * OPEX_BUILDING_SHARE * 0.75;
    expect(plain.tier).toBe(600 * 0.6);
    expect(pledged.tier).toBeCloseTo(600 * 0.6 * 1.15, 9);
    expect(plain.rate).toBe(0.6);
    expect(pledged.rate).toBeCloseTo(0.6 * 1.15, 12);
    // the budget charges what its forecast (the Budget panel) said; the schools' shares add up to the tier's line
    for (const c of [plain, pledged]) {
      expect(c.charged).toBe(c.forecast);
      expect(c.shares[0] + c.shares[1]).toBeCloseTo(c.tier, 9);
    }
    expect(plain.charged).toBe(Math.round(fixed + 600 * 0.6));
    expect(pledged.charged).toBe(Math.round(fixed + 600 * 0.6 * 1.15));
    // the upkeep card and the build menu quote the same rate (72 building + 1,050 typical pupils)
    expect(plain.facts.value).toBe('§72 / month + §0.60 per pupil served');
    expect(pledged.facts.value).toBe('§72 / month + §0.69 per pupil served');
    expect(pledged.typical).toBeCloseTo(72 + 1050 * 0.6 * 1.15, 9);
    expect(pledged.card.now).toBe(pledged.typical);
    expect(pledged.card.full).toBeCloseTo(72 + 1500 * 0.6 * 1.15, 9);
    expect(pledged.facts.hint).toBe(pledged.card.title);
    expect(plain.card.title).toBe('≈§702/mo typical in this city · up to §972 at full use');
    // a fire station has no capacity: its full-use running costs take the multiplier in infra/facilities.ts
    expect(pledged.fireFull - 48).toBeCloseTo((plain.fireFull - 48) * 1.15, 9);
    // another challenge leaves Medium's costs alone
    expect(runningCosts('medium', 'noLoans')).toEqual(plain);
  });

  it('a Medium city under Hard money is removed after 12 months in debt, as a Hard city is; without the challenge it never is', () => {
    const debt = (...ids: MayorChallenge[]) => {
      const st = small('medium', ...ids);
      // (a fixed recurring expense keeps every month's closing balance negative: tests/sim/lg09EconomyDifficulty.test.ts)
      st.funds = 0;
      st.network[0] = Network.Highway;
      const sim = new Simulation(st, [budgetSystem(new EconRuntime())]);
      const removalNews: unknown[] = [];
      sim.events.on('news', (n) => { if (n.ref?.advice === 'mayorRemoved') removalNews.push(n); });
      return { st, sim, removalNews };
    };
    const pledged = debt('hardMoney'), plain = debt();
    for (const c of [pledged, plain]) c.sim.runDays(330);
    expect(econData(pledged.st).monthsNegative).toBe(11);
    expect(mayorRemoval(pledged.st)).toBeUndefined();
    for (const c of [pledged, plain]) c.sim.runDays(30);
    expect(mayorRemoval(pledged.st)).toEqual({ day: 360, bankruptSinceDay: 0, reason: 'bankruptcy' });
    expect(pledged.removalNews).toHaveLength(1);
    // the same city without the challenge: the same months of debt and the bankruptcy, never a removal nor its streak
    expect(econData(plain.st).monthsNegative).toBe(12);
    expect(econData(plain.st).bankrupt).toBe(true);
    plain.sim.runDays(360);
    expect(econData(plain.st).monthsNegative).toBe(24);
    expect(mayorRemoval(plain.st)).toBeUndefined();
    expect(plain.removalNews).toHaveLength(0);
    expect(Object.hasOwn(econData(plain.st), 'mayorRemovalStreak')).toBe(false);
  });

  it('is money only: Hard\'s tax-approval cost stays with the difficulty', () => {
    // homes taxed at 11%: each point above 9% costs Medium's 3.5 approval, not Hard's 4.5
    for (const [d, ids, perPoint] of [['medium', [], -3.5], ['medium', ['hardMoney'], -3.5], ['hard', [], -4.5]] as [Difficulty, MayorChallenge[], number][]) {
      const st = small(d, ...ids);
      st.stats.population = 1000;
      st.stats.residents = [1000, 0, 0];
      st.budget.taxRates.fill(11);
      new Simulation(st, [approvalSystem(new EconRuntime())]);
      expect(econData(st).approvalTerms.tax, `${d} ${ids.join(' ')}`).toBe(2 * perPoint);
    }
  });
});

describe('LG-14 No dirty industry', () => {
  /** homes, shops and a dirty-industry zone along one road, grown for two years */
  function grow(...ids: MayorChallenge[]): Record<number, number> {
    const { st, sim, A } = makeCity();
    if (ids.length) withChallenges(st, ...ids);
    st.funds = 1e6;
    road(A, 2, 30, 61, 30);
    A.zone({ x0: 2, z0: 26, x1: 30, z1: 30 }, Zone.ResLow);
    A.zone({ x0: 2, z0: 31, x1: 14, z1: 35 }, Zone.ComLow);
    A.zone({ x0: 34, z0: 26, x1: 62, z1: 30 }, Zone.IndMed);
    A.zone({ x0: 34, z0: 31, x1: 62, z1: 35 }, Zone.IndMed);
    sim.runDays(720);
    const byDev: Record<number, number> = {};
    for (const b of st.buildings.values()) {
      const dev = getDef(b.def)?.devType;
      if (dev !== undefined) byDev[dev] = (byDev[dev] ?? 0) + 1;
    }
    return byDev;
  }

  it('I-D never opens on a medium-density industrial zone; manufacturing still does', () => {
    const plain = grow();
    // (the control: this town does grow dirty industry)
    expect(plain[DevType.ID] ?? 0).toBeGreaterThan(0);
    const clean = grow('noDirtyIndustry');
    expect(clean[DevType.ID] ?? 0).toBe(0);
    expect(clean[DevType.IM] ?? 0).toBeGreaterThan(0);
    expect(clean[DevType.R1] ?? 0).toBeGreaterThan(0);
  });

  it('another challenge does not change what grows', () => {
    expect(grow('noLoans')).toEqual(grow());
  });
});

describe('LG-14 Frequent disasters', () => {
  /** the first draw is `first`; every later one 0.5 */
  class Scripted extends RNG {
    draws = 0;
    constructor(private first: number) { super(1); }
    override next(): number { return ++this.draws === 1 ? this.first : 0.5; }
  }
  function month(first: number, ...ids: MayorChallenge[]): { kinds: string[]; draws: number } {
    const st = newState(64, true);
    if (ids.length) withChallenges(st, ...ids);
    st.stats.population = DISASTER_MIN_POP;
    const sys = new DisastersSystem();
    const sim = new Simulation(st, [sys]);
    const rng = new Scripted(first);
    (sys as unknown as { rng: RNG }).rng = rng;
    const kinds: string[] = [];
    sim.events.on('disaster', (d) => { if (d.active) kinds.push(d.kind); });
    sys.monthly(sim);
    return { kinds, draws: rng.draws };
  }

  it('the monthly draw is twice as likely for each kind, on the same single draw', () => {
    // the plain thresholds: tornado < 0.008, earthquake < 0.012, meteor < 0.0145
    expect(month(0.0079).kinds).toEqual(['tornado']);
    expect(month(0.0119).kinds).toEqual(['earthquake']);
    expect(month(0.0144).kinds).toEqual(['meteor']);
    expect(month(0.0146).kinds).toEqual([]);
    const f = (first: number) => month(first, 'frequentDisasters').kinds;
    expect(f(0.0159)).toEqual(['tornado']);
    expect(f(0.0161)).toEqual(['earthquake']);
    expect(f(0.0239)).toEqual(['earthquake']);
    expect(f(0.0241)).toEqual(['meteor']);
    expect(f(0.0289)).toEqual(['meteor']);
    expect(f(0.0291)).toEqual([]);
  });

  it('a month without a disaster draws the same three numbers with and without the challenge', () => {
    expect(month(0.5).draws).toBe(3);
    expect(month(0.5, 'frequentDisasters').draws).toBe(3);
  });

  it('Hard money leaves a Medium city\'s disaster odds alone: they are not money (Hard\'s ×1.5 would make 0.0146 a meteor)', () => {
    expect(month(0.0144, 'hardMoney').kinds).toEqual(['meteor']);
    expect(month(0.0146, 'hardMoney').kinds).toEqual([]);
  });

  it('disasters switched off, or a town under the minimum, draws nothing either way', () => {
    for (const ids of [[], ['frequentDisasters']] as MayorChallenge[][]) {
      const st = newState(64, false);
      if (ids.length) withChallenges(st, ...ids);
      st.stats.population = DISASTER_MIN_POP * 10;
      const sys = new DisastersSystem();
      const sim = new Simulation(st, [sys]);
      const rng = new Scripted(0.001);
      (sys as unknown as { rng: RNG }).rng = rng;
      sys.monthly(sim);
      expect(rng.draws).toBe(0);
    }
  });
});

describe('LG-14 challenge badges', () => {
  it('are earned at the City rank and kept after the city shrinks (the reached rank is the simulation\'s record)', () => {
    const st = withChallenges(makeCity().st, 'noLoans', 'hardMoney');
    st.stats.population = CHALLENGE_BADGE_POP - 1;
    expect(earnedChallenges(st)).toEqual([]);
    st.stats.population = CHALLENGE_BADGE_POP;
    expect(earnedChallenges(st)).toEqual(['noLoans', 'hardMoney']);
    st.stats.population = 900;
    expect(earnedChallenges(st)).toEqual([]);
    st.systemData.cityRanks = { settlement: true, village: true, town: true, small_city: true, city: true };
    expect(earnedChallenges(st)).toEqual(['noLoans', 'hardMoney']);
    // a city without challenges earns none, whatever its size
    const plain = makeCity().st;
    plain.stats.population = 1e6;
    expect(earnedChallenges(plain)).toEqual([]);
  });

  it('the rewards system records the rank the badges need: a city that reached it keeps its badges through a drop', () => {
    const st = withChallenges(newState(16), 'noDirtyIndustry');
    st.stats.population = CHALLENGE_BADGE_POP - 1;
    const sim = new Simulation(st, [rewardsSystem(new EconRuntime())]);
    expect(earnedChallenges(st)).toEqual([]);
    st.stats.population = CHALLENGE_BADGE_POP;
    sim.runDays(30);
    expect((st.systemData.cityRanks as Record<string, boolean>)[CHALLENGE_BADGE_RANK]).toBe(true);
    st.stats.population = 900;
    sim.runDays(30);
    expect(earnedChallenges(st)).toEqual(['noDirtyIndustry']);
    expect(summarizeCity(st)).toMatchObject({ challenges: ['noDirtyIndustry'], badges: ['noDirtyIndustry'] });
  });

  it('the tile summary carries the scenario, the challenges and the earned badges; a plain city\'s summary has none of the keys', () => {
    const plain = summarizeCity(makeCity().st);
    for (const k of ['scenario', 'challenges', 'badges']) expect(Object.hasOwn(plain, k)).toBe(false);
    const st = withChallenges(makeCity().st, 'frequentDisasters');
    expect(summarizeCity(st)).toMatchObject({ challenges: ['frequentDisasters'], badges: [] });
    st.stats.population = CHALLENGE_BADGE_POP + 10;
    expect(summarizeCity(st)).toMatchObject({ challenges: ['frequentDisasters'], badges: ['frequentDisasters'] });
    const scenario = makeCity().st;
    scenario.config = { ...scenario.config, scenario: { id: 'boomtown', startDay: 90 } };
    const s = summarizeCity(scenario);
    expect(s.scenario).toBe('boomtown');
    expect(Object.hasOwn(s, 'challenges')).toBe(false);
  });
});
