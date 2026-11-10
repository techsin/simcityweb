import { describe, expect, it } from 'vitest';
import { makeCity, road } from './helpers';
import { DEV_TYPE_LABELS, DevType } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { Simulation } from '../../src/sim/Simulation';
import { computeMonthlyBudget } from '../../src/sim/economy/budget';
import { removeBuilding } from '../../src/sim/economy/buildings';
import { populationSystem } from '../../src/sim/economy/population';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { difficultyRules, TAX_PER_JOB, TAX_PER_RES } from '../../src/sim/economy/tuning';

function plop(c: ReturnType<typeof makeCity>, defId: string, x = 12, z = 12): Building {
  const def = getDef(defId)!;
  if (def.requires) c.st.unlocked.add(def.requires);
  expect(c.A.plop(defId, x, z, 0).ok).toBe(true);
  return c.st.buildingAt(x, z)!;
}

function taxCity(difficulty: 'medium' | 'hard' = 'medium') {
  const c = makeCity({ difficulty }, []);
  c.st.funds = 1e9;
  c.st.stats.residents = [2000, 3000, 4000];
  c.st.stats.population = 9000;
  for (let d = DevType.CS1; d <= DevType.IHT; d++) c.st.stats.jobsByDev[d] = 2000 + 1000 * d;
  c.st.budget.taxRates.fill(9);
  road(c.A, 10, 11, 24, 11);
  return c;
}

describe('late landmarks: office taxes', () => {
  it.each(['medium', 'hard'] as const)('keeps all %s tax rows unchanged without a Stock Exchange', (difficulty) => {
    const { st } = taxCity(difficulty);
    st.unlocked.add('lm_stock_exchange');
    const { income } = computeMonthlyBudget(st, null);
    const mul = difficultyRules(difficulty).income;
    for (let d: number = DevType.R1; d <= DevType.IHT; d++) {
      const units = d <= DevType.R3 ? st.stats.residents[d] : st.stats.jobsByDev[d];
      const per = d <= DevType.R3 ? TAX_PER_RES[d] : TAX_PER_JOB[d];
      expect(income['tax:' + DEV_TYPE_LABELS[d]]).toBe(Math.round(units * per * st.budget.taxRates[d] * mul));
    }
  });

  it('raises only CO$$ and CO$$$ tax receipts by 5%, and stops after demolition', () => {
    const c = taxCity();
    const before = computeMonthlyBudget(c.st, null).income;
    const exchange = plop(c, 'lm_stock_exchange');
    const after = computeMonthlyBudget(c.st, null).income;
    for (let d = DevType.R1; d <= DevType.IHT; d++) {
      const key = 'tax:' + DEV_TYPE_LABELS[d];
      expect(after[key]).toBe(d === DevType.CO2 || d === DevType.CO3 ? Math.round(before[key] * 1.05) : before[key]);
    }
    expect(c.st.budget.taxRates).toEqual(new Array(12).fill(9));
    removeBuilding(c.sim, exchange);
    expect(computeMonthlyBudget(c.st, null).income).toEqual(before);
  });

  it.each([BF.Burnt, BF.Abandoned, BF.Constructing])('withholds the office bonus while the exchange has closed flag %i', (flag) => {
    const c = taxCity();
    const before = computeMonthlyBudget(c.st, null).income;
    const exchange = plop(c, 'lm_stock_exchange');
    exchange.flags |= flag;
    const after = computeMonthlyBudget(c.st, null).income;
    expect(after['tax:CO$$']).toBe(before['tax:CO$$']);
    expect(after['tax:CO$$$']).toBe(before['tax:CO$$$']);
  });

  it('withholds the office bonus without road access or required power', () => {
    const c = taxCity();
    const before = computeMonthlyBudget(c.st, null).income;
    const exchange = plop(c, 'lm_stock_exchange');
    c.st.systemData.infraVersion = 1;
    c.st.systemData.infraLayers = { utilities: true, traffic: false, services: false, pollution: false };
    expect(getDef(exchange.def)!.powerUse).toBeGreaterThan(0);
    expect(computeMonthlyBudget(c.st, null).income['tax:CO$$']).toBe(before['tax:CO$$']);
    exchange.flags |= BF.Powered;
    expect(computeMonthlyBudget(c.st, null).income['tax:CO$$']).toBeGreaterThan(before['tax:CO$$']);
    c.st.network.fill(0);
    expect(computeMonthlyBudget(c.st, null).income['tax:CO$$']).toBe(before['tax:CO$$']);
  });
});

describe('late landmarks: commercial employment', () => {
  it('counts World Trade Center capacity and filled jobs as CO$$$, once, alongside civic jobs', () => {
    const c = makeCity({}, []);
    c.st.funds = 1e9;
    const tower = plop(c, 'lm_world_trade_center');
    const school = plop(c, 'civ_elementary_school', 26, 12);
    tower.jobs = 6400;
    school.jobs = 30;
    const rt = new EconRuntime();
    new Simulation(c.st, [populationSystem(rt)]);
    expect(tower.capacity).toBe(8000);
    expect(c.st.stats.jobCapByDev[DevType.CO3]).toBe(8000);
    expect(c.st.stats.jobsByDev[DevType.CO3]).toBe(6400);
    expect(rt.totals.jobCapAll[DevType.CO3]).toBe(8000);
    expect(rt.totals.civicJobCap).toBe(school.capacity);
    expect(rt.totals.civicJobs).toBe(30);
    expect(rt.totals.growables).toBe(0);
    const expected = Math.round(6400 * TAX_PER_JOB[DevType.CO3] * c.st.budget.taxRates[DevType.CO3] * difficultyRules(c.st.config.difficulty).income);
    expect(computeMonthlyBudget(c.st, rt).income['tax:CO$$$']).toBe(expected);
  });

  it.each([BF.Burnt, BF.Abandoned])('excludes a closed World Trade Center (%i) from commercial employment', (flag) => {
    const c = makeCity({}, []);
    c.st.funds = 1e9;
    const tower = plop(c, 'lm_world_trade_center');
    tower.jobs = 8000;
    tower.flags |= flag;
    const rt = new EconRuntime();
    new Simulation(c.st, [populationSystem(rt)]);
    expect(c.st.stats.jobCapByDev[DevType.CO3]).toBe(0);
    expect(c.st.stats.jobsByDev[DevType.CO3]).toBe(0);
    expect(rt.totals.civicJobCap).toBe(0);
    expect(rt.totals.civicJobs).toBe(0);
  });
});
