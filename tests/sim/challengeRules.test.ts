/**
 * LG-14 "Mayor's challenges": the rules a city is founded with (src/sim/economy/challenges.ts, config.challenges).
 * - No loans: the bank lends nothing, and says why.
 * - No dirty industry: I-D never opens; manufacturing still does.
 * - Frequent disasters: the same single monthly draw, FREQUENT_DISASTERS times as likely, with no extra draw.
 * - Hard money: Hard's tax income on any difficulty (the starting funds are the dialog's: applyChallenges).
 * - A city without challenges takes none of these branches: every figure is what it was.
 * - The badges: earned at the "City" rank, kept after a later drop, written into the tile summary.
 */
import { describe, expect, it } from 'vitest';
import { makeCity, road } from './helpers';
import { DevType, Zone } from '../../src/core/types';
import { RNG } from '../../src/core/rng';
import { getDef } from '../../src/sim/catalog';
import type { CityState } from '../../src/sim/CityState';
import { computeMonthlyBudget } from '../../src/sim/economy/budget';
import {
  CHALLENGE_BADGE_POP, CHALLENGE_BADGE_RANK, FREQUENT_DISASTERS, MAYOR_CHALLENGES, NO_LOANS_REASON, cityChallenges, disasterRate,
  earnedChallenges, hasChallenge, moneyDifficulty, type MayorChallenge,
} from '../../src/sim/economy/challenges';
import { loanOffer, maxLoanAmount, takeLoanNow } from '../../src/sim/economy/loans';
import { CITY_RANKS, rewardsSystem } from '../../src/sim/economy/rewards';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { DISASTER_MIN_POP, TAX_PER_RES, difficultyRules } from '../../src/sim/economy/tuning';
import { DisastersSystem } from '../../src/sim/infra/disasters';
import { Simulation } from '../../src/sim/Simulation';
import { summarizeCity } from '../../src/region/citySummary';
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
