/** LG-09 removal starts a fresh, saved streak instead of inheriting pre-rule debt warnings. */
import { describe, expect, it } from 'vitest';
import { Network, type Difficulty } from '../../src/core/types';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { defaultCityConfig } from '../../src/sim/config';
import { budgetSystem, mayorRemoval } from '../../src/sim/economy/budget';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';

function debtCity(difficulty: Difficulty): CityState {
  const st = new CityState(defaultCityConfig({ size: 16, seed: 7, difficulty, disasters: false }));
  st.funds = -100;
  st.network[0] = Network.Highway;
  return st;
}
function start(st: CityState): Simulation {
  return new Simulation(st, [budgetSystem(new EconRuntime())]);
}
function streak(st: CityState): number | undefined {
  return (st.systemData.economy as { mayorRemovalStreak?: number } | undefined)?.mayorRemovalStreak;
}
function reload(st: CityState): CityState {
  return deserializeCity(serializeCity(st, { copy: true }));
}

describe('LG-09 removal migration', () => {
  it.each(['hard', 'expert'] as const)('%s old debt warnings do not cause retroactive removal', (difficulty) => {
    const old = debtCity(difficulty);
    old.day = 360;
    econData(old).monthsNegative = 12;
    econData(old).bankrupt = true;
    expect(streak(old)).toBeUndefined();
    const st = reload(old), sim = start(st);
    sim.runDays(30);
    expect(econData(st).monthsNegative).toBe(13);
    expect(streak(st)).toBe(1);
    expect(mayorRemoval(st)).toBeUndefined();
    sim.runDays(300);
    expect(streak(st)).toBe(11);
    expect(mayorRemoval(st)).toBeUndefined();
    const loaded = reload(st), resumed = start(loaded);
    expect(streak(loaded)).toBe(11);
    resumed.runDays(30);
    expect(econData(loaded).monthsNegative).toBe(24);
    expect(streak(loaded)).toBe(12);
    expect(mayorRemoval(loaded)).toEqual({ day: 720, bankruptSinceDay: 360, reason: 'bankruptcy' });
    resumed.runDays(30);
    expect(loaded.news.filter((n) => n.ref?.advice === 'mayorRemoved')).toHaveLength(1);
  });

  it.each(['hard', 'expert'] as const)('%s resets the separate streak on a solvent settlement', (difficulty) => {
    const st = debtCity(difficulty), sim = start(st);
    econData(st).monthsNegative = 12;
    sim.runDays(330);
    expect(streak(st)).toBe(11);
    st.funds = 1000;
    sim.runDays(30);
    expect(streak(st)).toBe(0);
    st.funds = -100;
    sim.runDays(330);
    expect(streak(st)).toBe(11);
    expect(mayorRemoval(st)).toBeUndefined();
    sim.runDays(30);
    expect(mayorRemoval(st)).toEqual({ day: 720, bankruptSinceDay: 360, reason: 'bankruptcy' });
  });

  it.each(['easy', 'medium', 'sandbox'] as const)('%s never adds the LG-09 streak to a legacy city', (difficulty) => {
    const st = debtCity(difficulty);
    econData(st).monthsNegative = 12;
    start(st).runDays(390);
    expect(streak(st)).toBeUndefined();
    expect(mayorRemoval(st)).toBeUndefined();
  });

  it('sandbox continuation clears an existing streak without removing the mayor', () => {
    const st = debtCity('hard'), sim = start(st);
    sim.runDays(330);
    expect(streak(st)).toBe(11);
    st.config.sandbox = true;
    sim.runDays(30);
    expect(streak(st)).toBe(0);
    expect(mayorRemoval(st)).toBeUndefined();
  });
});
