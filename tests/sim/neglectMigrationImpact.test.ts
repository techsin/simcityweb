import { describe, expect, it } from 'vitest';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { Simulation } from '../../src/sim/Simulation';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { emergencyMigrationImpact, tourismSystem } from '../../src/sim/economy/tourism';
import { makeCity } from './helpers';

describe('LG-06 current migration multiplier', () => {
  it('is neutral on an old city without economy outputs and does not initialize them', () => {
    const { st, sim } = makeCity({}, []);
    const saved = structuredClone(st.systemData);
    const stats = structuredClone(st.stats);
    const rng = sim.rng.state;
    expect(emergencyMigrationImpact(st)).toEqual({ multiplierLoss: [0, 0, 0], targetResidents: 0, multiplier: 1 });
    expect(st.systemData).toEqual(saved);
    expect(st.stats).toEqual(stats);
    expect(sim.rng.state).toBe(rng);
  });

  it('weights wealth tiers by their counterfactual residential targets, rather than averaging multiplier losses', () => {
    const { st, sim } = makeCity({}, []);
    st.systemData.economy = { migration: [0.9, 0.5, 1], rawTarget: [90, 10, 0], safetyMigrationLoss: [0.1, 0.5, 0.5] };
    const saved = structuredClone(st.systemData);
    const rng = sim.rng.state;
    const impact = emergencyMigrationImpact(st);
    // The current targets total 100; without the record they would total 100 + 20.
    expect(impact.targetResidents).toBe(20);
    expect(impact.multiplier).toBeCloseTo(100 / 120, 12);
    expect(Math.round((1 - impact.multiplier) * 100)).toBe(17);
    impact.multiplierLoss.fill(0);
    expect(emergencyMigrationImpact(st).multiplierLoss).toEqual([0.1, 0.5, 0.5]);
    expect(st.systemData).toEqual(saved);
    expect(sim.rng.state).toBe(rng);
  });

  it('keeps the multiplier precise when the display count of lost target residents rounds to zero', () => {
    const { st } = makeCity({}, []);
    st.systemData.economy = { migration: [1, 1, 1], rawTarget: [1, 0, 0], safetyMigrationLoss: [0.01, 0, 0] };
    const impact = emergencyMigrationImpact(st);
    expect(impact.targetResidents).toBe(0);
    expect(impact.multiplier).toBeCloseTo(1 / 1.01, 12);
    expect(Math.round((1 - impact.multiplier) * 100)).toBe(1);
  });

  it('ignores commercial targets, negative residential targets and tiers with no usable migration multiplier', () => {
    const { st } = makeCity({}, []);
    st.systemData.economy = { migration: [1, 0, 1], rawTarget: [-40, 90, 10, 1e6], safetyMigrationLoss: [0.5, 0.5, 0.1] };
    const impact = emergencyMigrationImpact(st);
    expect(impact.targetResidents).toBe(1);
    expect(impact.multiplier).toBeCloseTo(10 / 11, 12);
  });

  it('has no cut with no residential target, even if a tier has a remembered multiplier loss', () => {
    const { st } = makeCity({}, []);
    st.systemData.economy = { migration: [0.8, 1, 1], rawTarget: [0, 0, 0, 1e6], safetyMigrationLoss: [0.12, 0, 0] };
    expect(emergencyMigrationImpact(st)).toEqual({ multiplierLoss: [0.12, 0, 0], targetResidents: 0, multiplier: 1 });
  });

  it('treats missing optional saved losses as neutral without normalizing the saved economy object', () => {
    const { st } = makeCity({}, []);
    st.systemData.economy = { migration: [0.9, 1, 1.12], rawTarget: [100, 200, 300] };
    const saved = structuredClone(st.systemData);
    expect(emergencyMigrationImpact(st)).toEqual({ multiplierLoss: [0, 0, 0], targetResidents: 0, multiplier: 1 });
    expect(st.systemData).toEqual(saved);
  });

  it.each([true, false])('restores the exact current multiplier on a mid-month load (saved venue pass: %s)', (hasPass) => {
    const { st } = makeCity({}, [tourismSystem(new EconRuntime())]);
    st.day = 9;
    const d = econData(st);
    d.migration = [0.9, 0.5, 1];
    d.rawTarget = [90, 10, 0];
    (d as typeof d & { safetyMigrationLoss?: number[] }).safetyMigrationLoss = [0.1, 0.5, 0.5];
    if (!hasPass) delete st.systemData.tourismPass;
    const before = emergencyMigrationImpact(st);
    const saved = serializeCity(st, { copy: true });
    const restored = deserializeCity(structuredClone(saved));
    new Simulation(restored, [tourismSystem(new EconRuntime())]);
    expect(emergencyMigrationImpact(restored)).toEqual(before);
  });
});
