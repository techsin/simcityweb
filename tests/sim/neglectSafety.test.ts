/** LG-06: the rolling safety record reaches migration / visits, and damage is charged once after the month rolls. */
import { describe, expect, it } from 'vitest';
import { BF, type Building, type CityState, type EmergencyStats } from '../../src/sim/CityState';
import type { CityConfigData } from '../../src/sim/config';
import type { Simulation } from '../../src/sim/Simulation';
import type { ServiceKind } from '../../src/sim/catalogTypes';
import { getDef } from '../../src/sim/catalog';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { budgetSystem, computeMonthlyBudget, emergencyRebuildCost, emergencyRebuildCosts } from '../../src/sim/economy/budget';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { emergencyMigrationImpact, emergencySafety, tourismSystem, venueVisits } from '../../src/sim/economy/tourism';
import { EM_REP, MIG_MAX, MIG_MIN } from '../../src/sim/economy/tuning';
import { EmergencySystem } from '../../src/sim/infra/emergency';
import { makeCity } from './helpers';

function building(sim: Simulation, defId: string, x: number, z: number, extra: Partial<Building> = {}): Building {
  const def = getDef(defId)!;
  const b: Building = {
    id: sim.state.nextBuildingId++, def: defId, x, z, w: def.footprint[0], d: def.footprint[1], rot: 0, variant: 0,
    pop: 0, jobs: 0, capacity: def.capacity ?? 0, wealth: 1, built: 1, age: 400, flags: 0,
    baseY: 5, health: 0.8, unhappy: 0, ...extra,
  };
  placeBuilding(sim, b);
  return b;
}

describe('neglect: safety record', () => {
  it('uses all incident kinds and deaths per 1,000 residents from the same rolled year as approval', () => {
    const { st, sim } = makeCity({}, []);
    st.stats.population = 10_000;
    const em = st.stats.emergency;
    em.year.count.fire = 10;
    em.year.count.medical = 20;
    em.year.count.crime = 5;
    em.year.failed = 4;
    em.year.deaths = 25;
    // Current and last month are not a second source of remembered failures or deaths.
    em.month.failed = em.lastMonth.failed = 100;
    em.month.deaths = em.lastMonth.deaths = 100;
    const before = structuredClone(st.stats);
    const saved = structuredClone(st.systemData);
    const rng = sim.rng.state;
    expect(emergencySafety(st, 0.12)).toBeCloseTo(1 - 1.6 * 0.12 - EM_REP * 4 / 65 - 0.002 * 25 / 10, 12);
    expect(st.stats).toEqual(before);
    expect(st.systemData).toEqual(saved);
    expect(sim.rng.state).toBe(rng);
  });

  it('normalizes deaths by resident population, clamps the score and stays finite in an empty city', () => {
    const { st } = makeCity({}, []);
    st.stats.population = 1_000;
    st.stats.emergency.year.deaths = 100;
    expect(emergencySafety(st, 0)).toBeCloseTo(0.8, 12);
    st.stats.population = 10_000;
    expect(emergencySafety(st, 0)).toBeCloseTo(0.98, 12);
    st.stats.population = 0;
    expect(emergencySafety(st, 0)).toBe(1);
    st.stats.emergency.year.failed = 1_000;
    expect(emergencySafety(st, 0)).toBe(0);
    st.stats.emergency.year.failed = 0;
    expect(emergencySafety(st, 1)).toBe(0);
    expect(emergencySafety(st, -1)).toBe(1);
  });

  it('reads old saves without emergency stats or a rolling year without initializing data', () => {
    const { st, sim } = makeCity({}, []);
    const stats = st.stats as { emergency?: EmergencyStats };
    delete stats.emergency;
    const saved = structuredClone(st.systemData);
    const rng = sim.rng.state;
    expect(emergencySafety(st, 0.125)).toBe(0.8);
    expect(stats.emergency).toBeUndefined();
    stats.emergency = {} as EmergencyStats;
    expect(emergencySafety(st, 0.125)).toBe(0.8);
    expect(stats.emergency).toEqual({});
    expect(st.systemData).toEqual(saved);
    expect(sim.rng.state).toBe(rng);
  });

  it('lowers every wealth tier\'s migration and the next venue pass without changing crime or drawing RNG', () => {
    const rt = new EconRuntime();
    const tourism = tourismSystem(rt);
    const { st, sim } = makeCity({}, [tourism]);
    for (let w = 0; w < 3; w++) building(sim, 'res_apartment.r2.4', 8 + w * 12, 8, { pop: 4_000, wealth: w + 1 });
    const plaza = building(sim, 'park_plaza', 40, 40, { flags: BF.Plopped });
    st.stats.population = 12_000;
    st.stats.unemployment = 0;
    st.crime.fill(0.1);
    const refresh = () => { st.day++; tourism.refresh(sim); };
    refresh();
    refresh();
    const d = econData(st);
    const before = { a: d.attractiveness, safety: d.attractTerms.safety, migration: d.migration.slice(), visits: venueVisits(st, plaza.id)!.visits };
    expect(before.visits).toBeGreaterThan(0);
    const rng = sim.rng.state;
    st.stats.emergency.year.count.fire = 20;
    st.stats.emergency.year.failed = 8;
    st.stats.emergency.year.deaths = 10;
    refresh();
    expect(d.attractiveness).toBeLessThan(before.a);
    expect(d.attractTerms.safety).toBeLessThan(before.safety);
    d.rawTarget[0] = d.rawTarget[1] = d.rawTarget[2] = 10_000;
    const saved = structuredClone(st.systemData);
    const impact = emergencyMigrationImpact(st);
    let target = 0;
    for (let w = 0; w < 3; w++) {
      expect(d.migration[w]).toBeLessThan(before.migration[w]);
      expect(d.migration[w]).toBeGreaterThanOrEqual(MIG_MIN);
      expect(d.migration[w]).toBeLessThanOrEqual(MIG_MAX);
      expect(impact.multiplierLoss[w]).toBeCloseTo(before.migration[w] - d.migration[w], 12);
      target += 10_000 * impact.multiplierLoss[w] / d.migration[w];
    }
    expect(impact.targetResidents).toBe(Math.round(target));
    impact.multiplierLoss.fill(0);
    expect(emergencyMigrationImpact(st).targetResidents).toBeGreaterThan(0);
    expect(st.systemData).toEqual(saved);
    // The pass uses the previous attractiveness; the following pass sees the safety loss.
    expect(venueVisits(st, plaza.id)!.visits).toBeCloseTo(before.visits, 9);
    refresh();
    expect(venueVisits(st, plaza.id)!.visits).toBeLessThan(before.visits);
    expect(st.crime[st.idx(8, 8)]).toBeCloseTo(0.1, 7);
    expect(sim.rng.state).toBe(rng);
  });
});

function budgetCity(cfg: Partial<CityConfigData> = {}) {
  const rt = new EconRuntime();
  const emergency = new EmergencySystem();
  const budget = budgetSystem(rt);
  const c = makeCity(cfg, [emergency, budget]);
  const month = () => {
    c.st.day += 30;
    emergency.monthly(c.sim);
    budget.monthly!(c.sim);
  };
  return { ...c, rt, budget, month };
}

describe('neglect: emergency rebuilding budget', () => {
  it('charges 15 percent of damage rounded to whole currency, never a credit for negative damage', () => {
    expect(emergencyRebuildCost(56_000)).toBe(8_400);
    expect(emergencyRebuildCost(6)).toBe(1);
    expect(emergencyRebuildCost(3)).toBe(0);
    expect(emergencyRebuildCost(0)).toBe(0);
    expect(emergencyRebuildCost(-100)).toBe(0);
  });

  it('forecasts this month, settles the rolled month once and has no charge in the following clean month', () => {
    const { st, sim, rt, month } = budgetCity();
    st.stats.emergency.month.damage = 56_000;
    st.stats.emergency.lastMonth.damage = 12_000;
    const funds = st.funds;
    const before = structuredClone(st.stats.emergency);
    const rng = sim.rng.state;
    const preview = computeMonthlyBudget(st, rt);
    expect(preview.expense['emergency:rebuild']).toBe(8_400);
    expect(preview.totalExpense).toBe(8_400);
    expect(st.stats.emergency).toEqual(before);
    expect(st.funds).toBe(funds);
    expect(sim.rng.state).toBe(rng);
    month();
    expect(st.stats.emergency.month.damage).toBe(0);
    expect(st.stats.emergency.lastMonth.damage).toBe(56_000);
    expect(emergencyRebuildCosts(st)).toEqual({ month: 0, lastMonth: 8_400, year: 8_400, unansweredYear: 0 });
    expect(st.budget.lastExpense['emergency:rebuild']).toBe(8_400);
    expect(st.funds).toBe(funds - 8_400);
    expect(econData(st).lastNet).toBe(-8_400);
    expect(computeMonthlyBudget(st, rt).expense['emergency:rebuild'] ?? 0).toBe(0);
    month();
    expect(st.budget.lastExpense['emergency:rebuild'] ?? 0).toBe(0);
    expect(st.funds).toBe(funds - 8_400);
    expect(econData(st).lastNet).toBe(0);
    expect(emergencyRebuildCosts(st).year).toBe(8_400);
  });

  it.each(['easy', 'medium', 'hard'] as const)('does not discount rebuilding through %s income rules or service funding', (difficulty) => {
    const { st, month } = budgetCity({ difficulty });
    for (const service of Object.keys(st.budget.funding) as ServiceKind[]) st.budget.funding[service] = 0;
    st.stats.emergency.month.damage = 56_000;
    const funds = st.funds;
    month();
    expect(st.budget.lastExpense['emergency:rebuild']).toBe(8_400);
    expect(st.funds).toBe(funds - 8_400);
  });

  it('records rebuilding in sandbox without reducing funds', () => {
    const { st, month } = budgetCity({ difficulty: 'sandbox', sandbox: true });
    st.funds = st.config.startFunds * 2;
    st.stats.emergency.month.damage = 56_000;
    const funds = st.funds;
    month();
    expect(st.budget.lastExpense['emergency:rebuild']).toBe(8_400);
    expect(st.funds).toBe(funds);
    expect(econData(st).lastNet).toBe(-8_400);
  });

  it('forecasts an old save with no emergency stats without adding an expense or initializing data', () => {
    const { st } = makeCity({}, []);
    delete (st.stats as { emergency?: EmergencyStats }).emergency;
    const saved = structuredClone(st.systemData);
    expect(computeMonthlyBudget(st as CityState, null).expense['emergency:rebuild'] ?? 0).toBe(0);
    expect(st.systemData).toEqual(saved);
    expect(st.stats.emergency).toBeUndefined();
    (st.stats as { emergency?: EmergencyStats }).emergency = {} as EmergencyStats;
    expect(emergencyRebuildCosts(st)).toEqual({ month: 0, lastMonth: 0, year: 0, unansweredYear: 0 });
  });
});
