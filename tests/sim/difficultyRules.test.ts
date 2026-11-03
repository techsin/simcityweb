/** FH-04: Easy's first-city rules; the other difficulties keep the b60b2d3 formulas and saved settings. */
import { describe, expect, it } from 'vitest';
import type { Difficulty } from '../../src/core/types';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { BF, CityState, type Building } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { getDef } from '../../src/sim/catalog';
import { defaultCityConfig } from '../../src/sim/config';
import { approvalBreakdown, approvalSystem } from '../../src/sim/economy/approval';
import { budgetSystem, computeMonthlyBudget } from '../../src/sim/economy/budget';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { DIFFICULTY_RULES, difficultyRules } from '../../src/sim/economy/tuning';
import { sumTerms } from '../../src/sim/explain';

const difficulties = ['easy', 'medium', 'hard', 'sandbox'] as const;
const fades = [[124, 0], [2000, 0], [3500, 0.15625], [5000, 0.5], [6500, 0.84375], [8000, 1], [12000, 1]] as const;

/** One occupied home with fixed resident experience; only approval and budget advance in these tests. */
function town(difficulty: Difficulty, pop = 5000): CityState {
  const st = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', difficulty, disasters: true }));
  const def = getDef('res_apartment.r2.4')!;
  const b: Building = {
    id: 1, def: def.id, x: 4, z: 4, w: def.footprint[0], d: def.footprint[1], rot: 0, variant: 0,
    pop, jobs: 0, capacity: Math.max(pop, def.capacity ?? 0), wealth: 2, built: 1, age: 400,
    flags: BF.Powered | BF.Watered, baseY: 5, health: 0.8, unhappy: 0,
  };
  st.heights.fill(5);
  st.buildings.set(b.id, b);
  st.nextBuildingId = 2;
  for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) st.building[st.idx(x, z)] = b.id;
  st.stats.population = pop;
  st.stats.residents = [0, pop, 0];
  st.stats.unemployment = 0;
  st.stats.hq = 80;
  st.crime.fill(0.5);
  for (const cov of [st.policeCov, st.fireCov, st.healthCov, st.eduCov]) cov.fill(0.5);
  st.parkCov.fill(0.25);
  st.systemData.infraVersion = 1;
  st.systemData.infraLayers = { utilities: false, traffic: false, pollution: false, services: true };
  return st;
}

function start(st: CityState, emergencies = true): Simulation {
  const rt = new EconRuntime();
  const em: SimSystem & { active: boolean } = { name: 'emergency', active: emergencies };
  return new Simulation(st, [em, budgetSystem(rt), approvalSystem(rt)]);
}

function monthlyOutcomes(st: CityState): void {
  const { lastMonth: lm, year: yr } = st.stats.emergency;
  lm.failed = 2; lm.late = 1; lm.deaths = 3; lm.riotDays = 5;
  yr.count.fire = 7; yr.count.medical = 2; yr.failed = 1; yr.ignored = 1;
}

/** Frozen b60b2d3 expression: preserve the floating-point order, including the remembered term. */
function legacyEmergency(fade: number): number {
  const remembered = fade * (100 * 1 / (9 + 30) + 1.5 * 1);
  return -Math.min(8, 1.2 * 2 + 0.4 * 1 + 0.3 * 3 + 0.1 * 5 + remembered);
}

describe('difficulty rules table and defaults', () => {
  it('has one row per difficulty, the original income multipliers and blurbs for New City', () => {
    expect(Object.keys(DIFFICULTY_RULES)).toEqual(difficulties);
    const expected = [
      { income: 1.2, fadeCrime: true, fadeMonthlyEmergencies: true, defaultDisasters: false },
      { income: 1.0, fadeCrime: false, fadeMonthlyEmergencies: false, defaultDisasters: true },
      { income: 0.85, fadeCrime: false, fadeMonthlyEmergencies: false, defaultDisasters: true },
      { income: 1.0, fadeCrime: false, fadeMonthlyEmergencies: false, defaultDisasters: true },
    ];
    const blurbs = [ // FH-11's card lines
      '§250k, +20% taxes, forgiving first years · Recommended for your first city',
      '§100k, the intended balance',
      '§40k, −15% taxes, tight from day one',
      'unlimited money, everything unlocked',
    ];
    for (let k = 0; k < difficulties.length; k++) {
      const { blurb, ...rules } = DIFFICULTY_RULES[difficulties[k]];
      expect(rules).toEqual(expected[k]);
      expect(blurb).toBe(blurbs[k]);
    }
  });

  it("gives an unknown saved difficulty Medium's rules, as the income multiplier always fell back to 1", () => {
    expect(difficultyRules('unknown')).toBe(DIFFICULTY_RULES.medium);
    const st = town('medium');
    const medium = computeMonthlyBudget(st, null).income;
    (st.config as { difficulty: string }).difficulty = 'unknown';
    expect(computeMonthlyBudget(st, null).income).toEqual(medium);
    start(st).runDays(30); // approval reads the same rules
    expect(econData(st).approvalTerms.crime).toBe(-15);
  });

  it('only Easy defaults disasters off; explicit settings and starting funds are preserved', () => {
    const funds = [250_000, 100_000, 40_000, 10_000_000];
    expect(defaultCityConfig().difficulty).toBe('medium');
    expect(defaultCityConfig().disasters).toBe(true);
    for (let k = 0; k < difficulties.length; k++) {
      const difficulty = difficulties[k];
      const cfg = defaultCityConfig({ difficulty });
      expect(cfg.disasters).toBe(difficulty !== 'easy');
      expect(cfg.startFunds).toBe(funds[k]);
      expect(cfg.sandbox).toBe(difficulty === 'sandbox');
      for (const disasters of [false, true]) expect(defaultCityConfig({ difficulty, disasters }).disasters).toBe(disasters);
    }
  });

  it.each(difficulties)('%s keeps the original tax and tourism income', (difficulty) => {
    const st = town(difficulty);
    st.stats.jobsByDev[3] = 2000;
    st.stats.jobsByDev[6] = 1000;
    econData(st).tourists = 400;
    const expected = {
      easy: { 'tax:R$$': 2160, 'tax:CS$': 540, 'tax:CO$$': 432, tourism: 120 },
      medium: { 'tax:R$$': 1800, 'tax:CS$': 450, 'tax:CO$$': 360, tourism: 100 },
      hard: { 'tax:R$$': 1530, 'tax:CS$': 383, 'tax:CO$$': 306, tourism: 85 },
      sandbox: { 'tax:R$$': 1800, 'tax:CS$': 450, 'tax:CO$$': 360, tourism: 100 },
    };
    const bd = computeMonthlyBudget(st, null);
    expect(bd.income).toEqual(expected[difficulty]);
    expect(bd.totalExpense).toBe(0);
    expect(bd.totalIncome).toBe(Object.values(expected[difficulty]).reduce((sum, v) => sum + v, 0));
  });
});

describe('difficulty approval fades', () => {
  it.each(difficulties)('%s: crime follows the 2k..8k resident fade only on Easy', (difficulty) => {
    for (const [pop, fade] of fades) {
      const st = town(difficulty, pop);
      const sim = start(st);
      sim.runDays(30);
      const value = difficulty === 'easy' && fade === 0 ? 0 : -15 * (difficulty === 'easy' ? fade : 1);
      expect(econData(st).approvalTerms.crime, `population ${pop}`).toBe(value);
      expect(approvalBreakdown(st).find((t) => t.id === 'crime')).toEqual({
        id: 'crime', label: 'Crime', value,
        detail: difficulty === 'easy' && fade < 1 ? 'new-town grace' : undefined,
      });
      expect(sumTerms(approvalBreakdown(st))).toBeCloseTo(econData(st).approvalRaw, 12);
    }
  });

  it('uses surveyed residents for both grace and its note, including when the crime term is zero', () => {
    const st = town('easy', 2000);
    st.stats.population = 100_000;
    st.stats.residents = [0, 100_000, 0];
    const sim = start(st);
    expect(econData(st).approvalTerms.crime).toBe(0);
    expect(approvalBreakdown(st).find((t) => t.id === 'crime')?.detail).toBe('new-town grace');
    st.buildings.get(1)!.pop = 8000;
    // The note still describes the last survey until the next monthly update.
    expect(approvalBreakdown(st).find((t) => t.id === 'crime')?.detail).toBe('new-town grace');
    sim.runDays(30);
    expect(econData(st).approvalTerms.crime).toBe(-15);
    expect(approvalBreakdown(st).find((t) => t.id === 'crime')?.detail).toBeUndefined();
  });

  it.each(difficulties)('%s: failed, late and deaths fade only on Easy', (difficulty) => {
    for (const [field, penalty] of [['failed', 1.2], ['late', 0.4], ['deaths', 0.3]] as const) {
      for (const [pop, fade] of fades) {
        const st = town(difficulty, pop);
        st.stats.emergency.lastMonth[field] = 1;
        start(st);
        const expected = -penalty * (difficulty === 'easy' ? fade : 1);
        expect(econData(st).approvalTerms.emergencies, `${field}, population ${pop}`).toBeCloseTo(expected, 12);
      }
    }
  });

  it('Easy fades monthly losses before the cap and keeps remembered losses faded exactly once', () => {
    const st = town('easy');
    st.stats.emergency.lastMonth.failed = 10;
    const sim = start(st);
    expect(econData(st).approvalTerms.emergencies).toBe(-6); // 12 × 0.5, then the cap of 8
    monthlyOutcomes(st);
    sim.runDays(30);
    const remembered = 0.5 * (100 / 39 + 1.5);
    expect(econData(st).approvalTerms.emergencies).toBe(-(0.5 * (1.2 * 2 + 0.4 + 0.3 * 3) + 0.1 * 5 + remembered));
    st.stats.emergency.lastMonth.failed = 100;
    sim.runDays(30);
    expect(econData(st).approvalTerms.emergencies).toBe(-8);
  });

  it.each(['medium', 'hard', 'sandbox'] as const)('%s keeps the exact legacy emergency expression at every fade', (difficulty) => {
    for (const [pop, fade] of fades) {
      const st = town(difficulty, pop);
      monthlyOutcomes(st);
      start(st);
      expect(econData(st).approvalTerms.emergencies, `population ${pop}`).toBe(legacyEmergency(fade));
    }
  });

  it.each(difficulties)('%s keeps riot days and the legacy fire fallback at full weight', (difficulty) => {
    const st = town(difficulty, 124);
    st.stats.emergency.lastMonth.riotDays = 5;
    start(st);
    expect(econData(st).approvalTerms.emergencies).toBe(-0.5);
    const sim = start(town(difficulty, 124), false);
    for (let k = 0; k < 2; k++) sim.events.emit('disaster', { kind: 'fire', x: 4, z: 4, active: true });
    sim.runDays(30);
    expect(econData(sim.state).approvalTerms.emergencies).toBe(-3);
    sim.runDays(30);
    expect(econData(sim.state).approvalTerms.emergencies).toBe(0);
  });
});

/** A pre-FH-04 save: original config fields and unfaded crime / monthly losses, without running the new systems. */
function oldSave(difficulty: Difficulty, disasters: boolean) {
  const st = town(difficulty);
  st.config.disasters = disasters;
  st.day = 45;
  st.funds = st.config.startFunds + 1234.5;
  st.stats.approval = 42.25;
  monthlyOutcomes(st);
  const d = econData(st);
  d.approvalTerms = {
    base: 61, tax: 0, services: 18 * (0.5 - 0.3), pollution: 0, crime: -15, commute: 0, unemployment: 0,
    parks: 8 * (0.25 - 0.2), strikes: 0, deficit: 0, ordinances: 0, civic: 0,
    noise: 0, outages: 0, garbage: 0, needs: 0, tapWater: 0, tourism: 0, hq: 0,
    emergencies: legacyEmergency(0.5), justice: 0, toxicDump: 0, disaster: 0, clamp: 0,
  };
  d.approvalRaw = Object.values(d.approvalTerms).reduce((sum, v) => sum + v, 0);
  return serializeCity(st, { copy: true });
}

describe('old difficulty saves load and continue', () => {
  for (const difficulty of difficulties) {
    it.each([false, true])(`${difficulty}: saved disasters=%s survives loading and three month ticks`, (disasters) => {
      const saved = oldSave(difficulty, disasters);
      const st = deserializeCity(saved);
      const originalTerms = { ...econData(st).approvalTerms };
      const expectedTerms = { ...originalTerms };
      if (difficulty === 'easy') {
        expectedTerms.crime = -7.5;
        expectedTerms.emergencies = -(0.5 * (1.2 * 2 + 0.4 + 0.3 * 3) + 0.1 * 5 + 0.5 * (100 / 39 + 1.5));
      }
      const raw = Object.values(expectedTerms).reduce((sum, v) => sum + v, 0);
      const initialFunds = st.funds;
      const sim = start(st);
      expect(st.config).toEqual(saved.config);
      expect(st.stats.approval).toBe(42.25); // loading keeps the saved EMA even though Easy's raw terms change at once
      expect(econData(st).approvalTerms).toEqual(expectedTerms);
      expect(econData(st).approvalRaw).toBe(raw);
      expect(approvalBreakdown(st).find((t) => t.id === 'crime')?.detail).toBe(difficulty === 'easy' ? 'new-town grace' : undefined);
      let approval = 42.25;
      const income = { easy: 2160, medium: 1800, hard: 1530, sandbox: 0 }[difficulty];
      for (let month = 1; month <= 3; month++) {
        sim.runDays(month === 1 ? 15 : 30);
        approval += (raw - approval) * 0.3;
        expect(st.stats.approval).toBe(approval);
        expect(econData(st).approvalTerms).toEqual(expectedTerms);
        expect(st.funds).toBe(initialFunds + month * income);
        expect(st.config.disasters).toBe(disasters);
      }
      expect(econData(deserializeCity(saved)).approvalTerms).toEqual(originalTerms); // the old save itself stays untouched
    });
  }
});
