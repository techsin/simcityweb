import { describe, expect, it } from 'vitest';
import type { Difficulty } from '../../src/core/types';
import { CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { getDef } from '../../src/sim/catalog';
import { defaultCityConfig } from '../../src/sim/config';
import { approvalBreakdown, approvalSystem } from '../../src/sim/economy/approval';
import { expectedUpkeep, opexRateOf, tierOperatingCosts } from '../../src/sim/economy/opex';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { facilityDefFacts, fullUseUpkeep } from '../../src/sim/infra/facilities';
import { upkeepEstimate } from '../../src/ui/upkeepModel';

function city(difficulty: Difficulty): CityState {
  const st = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', difficulty, disasters: false }));
  st.systemData.infraVersion = 1;
  return st;
}

describe('LG-09 review: quoted service costs', () => {
  it.each(['easy', 'medium', 'sandbox'] as const)('%s keeps the original service rate and cost expressions', (difficulty) => {
    const st = city(difficulty), school = getDef('civ_elementary_school')!;
    st.stats.needs.elementary.served = 123.5;
    expect(opexRateOf(school, st)?.rate).toBe(0.6);
    expect(tierOperatingCosts(st, new Set(['elementary']))).toEqual({ elementary: 123.5 * 0.6 });
    expect(expectedUpkeep(st, school, 123.5)).toBe(72 + 123.5 * 0.6);
    expect(fullUseUpkeep(school, st)).toBe(972);
    expect(upkeepEstimate(st, school)?.full).toBe(972);
    expect(facilityDefFacts(school.id, st).find((f) => f.key === 'upkeep')?.value).toBe('§72 / month + §0.60 per pupil served');
  });

  it.each(['hard', 'expert'] as const)('%s quotes the same adjusted rate in facility facts and upkeep cards', (difficulty) => {
    const st = city(difficulty), school = getDef('civ_elementary_school')!;
    st.stats.needs.elementary.need = 2000;
    st.stats.needs.elementary.served = 1900;
    const estimate = upkeepEstimate(st, school)!;
    expect(estimate.now).toBeCloseTo(253.125, 10); // 72 building + 262.5 pupils at 0.69 each
    expect(estimate.full).toBe(1107); // 72 building + all 1,500 seats at 0.69 each
    expect(estimate.title).toBe('≈§253/mo typical in this city · up to §1,107 at full use');
    const upkeep = facilityDefFacts(school.id, st).find((f) => f.key === 'upkeep')!;
    expect(upkeep.value).toBe('§72 / month + §0.69 per pupil served');
    expect(upkeep.hint).toBe(estimate.title);
    expect(fullUseUpkeep(getDef('civ_police_station')!, st)).toBeCloseTo(51 + 30_000 * 0.072 * 1.15, 10);
    expect(fullUseUpkeep(getDef('civ_clinic')!, st)).toBeCloseTo(60 + 8000 * 0.078 * 1.15, 10);
  });

  it.each(['hard', 'expert'] as const)('%s full-use fire costs stay independent of the city\'s unmet need', (difficulty) => {
    const st = city(difficulty), fire = getDef('civ_fire_station')!;
    const full = fullUseUpkeep(fire, st), typical = expectedUpkeep(st, fire);
    expect(full).toBeCloseTo(48 + (12_000 * (24 / 26) * (24 / 26) * 0.048 / 0.7) * 1.15, 10);
    st.stats.needs.fire.need = 1_000_000;
    st.stats.needs.fire.served = 1_000_000;
    expect(expectedUpkeep(st, fire)).toBeLessThan(typical);
    expect(fullUseUpkeep(fire, st)).toBe(full);
    expect(upkeepEstimate(st, fire)?.full).toBe(full);
    expect(fullUseUpkeep(fire)).toBe(fullUseUpkeep(fire, null));
    expect(fullUseUpkeep(fire, city('medium'))).toBe(fullUseUpkeep(fire));
  });
});

describe('LG-09 review: tax approval detail', () => {
  it.each([
    ['easy', 3.5], ['medium', 3.5], ['sandbox', 3.5], ['hard', 4.5], ['expert', 4.5],
  ] as const)('%s describes the settled residential rate and its own penalty', (difficulty, penalty) => {
    const st = city(difficulty);
    st.stats.population = 1000;
    st.stats.residents = [1000, 0, 0];
    st.budget.taxRates.fill(11);
    new Simulation(st, [approvalSystem(new EconRuntime())]);
    st.budget.taxRates.fill(13); // the detail must still describe the last monthly term
    const tax = approvalBreakdown(st).find((term) => term.id === 'tax')!;
    expect(tax.value).toBe(-2 * penalty);
    expect(tax.detail).toBe(`homes are taxed 11% on average — each point above 9% costs ${penalty} approval; each point below adds 1.5`);
  });

  it.each(['hard', 'expert'] as const)('%s still inverts the unchanged low-tax bonus', (difficulty) => {
    const st = city(difficulty);
    st.stats.population = 1000;
    st.stats.residents = [1000, 0, 0];
    st.budget.taxRates.fill(7);
    new Simulation(st, [approvalSystem(new EconRuntime())]);
    const tax = approvalBreakdown(st).find((term) => term.id === 'tax')!;
    expect(tax.value).toBe(3);
    expect(tax.detail).toContain('homes are taxed 7% on average');
    expect(tax.detail).toContain('each point below adds 1.5');
  });
});
