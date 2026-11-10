/** NEW-05: demand changes realized throughput below the family cap, without changing the growth bank contract. */
import { describe, expect, it } from 'vitest';
import { DEV_TYPE_COUNT, DevType } from '../../src/core/types';
import { CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { defaultCityConfig } from '../../src/sim/config';
import { taxFactor } from '../../src/sim/economy/demand';
import { growthSystem } from '../../src/sim/economy/growth';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import {
  GROWTH_BANK_DAYS, GROWTH_DEMAND_EXPONENT, GROWTH_DEMAND_FULL, GROWTH_MAX_BASE, GROWTH_MAX_FRAC, GROWTH_MAX_SCALE, GROWTH_RESPONSE,
  TAX_FACTOR_MAX, TAX_FACTOR_MIN, TAX_NEUTRAL, TAX_SENS,
} from '../../src/sim/economy/tuning';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';

const FAMILIES = [
  ['R', [DevType.R1, DevType.R2, DevType.R3]],
  ['C', [DevType.CS1, DevType.CS2, DevType.CS3, DevType.CO2, DevType.CO3]],
  ['I', [DevType.IA, DevType.ID, DevType.IM, DevType.IHT]],
] as const;
const DEV_TYPES = Array.from({ length: DEV_TYPE_COUNT }, (_, d) => d);

/** No lots or buildings: daily carry exposes throughput without construction spending it or drawing random numbers. */
function growthCity(st = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false }))) {
  const rt = new EconRuntime();
  const sim = new Simulation(st, [growthSystem(rt)]);
  rt.totals.resCapAll = [10000, 10000, 10000];
  for (let d = DevType.CS1; d <= DevType.IHT; d++) rt.totals.jobCapAll[d] = 10000;
  return { st, rt, sim, data: econData(st) };
}

function familyCap(c: ReturnType<typeof growthCity>, family: 'R' | 'C' | 'I', devs: readonly number[]) {
  const capacity = devs.reduce((sum, d) => sum + (d <= DevType.R3 ? c.rt.totals.resCapAll[d] : c.rt.totals.jobCapAll[d]), 0);
  return GROWTH_MAX_BASE[family] + GROWTH_MAX_FRAC * capacity / Math.sqrt(1 + capacity / GROWTH_MAX_SCALE);
}

function setFamilyDemand(c: ReturnType<typeof growthCity>, fraction: number) {
  for (const [family, devs] of FAMILIES) for (const d of devs) c.st.stats.demand[d] = GROWTH_DEMAND_FULL[family] * fraction;
}

describe('growth: tax-adjusted demand response (NEW-05)', () => {
  it.each(FAMILIES)('%s throughput falls with positive demand even when wanted growth exceeds the cap', (family, devs) => {
    const daily: number[] = [];
    const full = GROWTH_DEMAND_FULL[family];
    for (const demand of [full / 4, full / 2, full, 1]) {
      const c = growthCity();
      const d = devs[0];
      c.data.demandAbs[d] = 100000;
      c.st.stats.demand[d] = demand;
      c.sim.advanceDay();
      daily.push(c.data.carry[d]);
      expect(c.data.demandAbs[d]).toBe(100000);
      expect(c.data.carry[d]).toBeLessThanOrEqual(familyCap(c, family, devs) + 1e-10);
    }
    expect(daily[0]).toBeCloseTo(daily[2] * Math.pow(1 / 4, GROWTH_DEMAND_EXPONENT), 10);
    expect(daily[1]).toBeCloseTo(daily[2] * Math.pow(1 / 2, GROWTH_DEMAND_EXPONENT), 10);
    expect(daily[0]).toBeGreaterThan(daily[2] / 4);
    expect(daily[0]).toBeLessThan(daily[1]);
    expect(daily[1]).toBeLessThan(daily[2]);
    expect(daily[3]).toBe(daily[2]);
    expect(daily[2]).toBeGreaterThan(0);
  });

  it.each(FAMILIES)('%s keeps wanted-growth proportions when mixed demand reduces the family throughput cap', (family, devs) => {
    const c = growthCity();
    const [a, b] = devs;
    c.data.demandAbs[a] = 10000;
    c.data.demandAbs[b] = 30000;
    c.st.stats.demand[a] = GROWTH_DEMAND_FULL[family];
    c.st.stats.demand[b] = GROWTH_DEMAND_FULL[family] / 2;
    c.sim.advanceDay();
    const cap = familyCap(c, family, devs);
    const response = Math.pow(5 / 8, GROWTH_DEMAND_EXPONENT);
    expect(c.data.carry[a]).toBeCloseTo(cap * response / 4, 10);
    expect(c.data.carry[b]).toBeCloseTo(cap * response * 3 / 4, 10);
    expect(c.data.carry[b] / c.data.carry[a]).toBeCloseTo(3, 10);
    expect(c.data.carry.reduce((sum, value) => sum + value, 0)).toBeCloseTo(cap * response, 10);
  });

  it.each(FAMILIES)('%s does not let an overfull subtype mask weak demand in another subtype', (family, devs) => {
    const c = growthCity();
    const [hot, weak] = devs;
    c.data.demandAbs[hot] = 10000;
    c.data.demandAbs[weak] = 30000;
    c.st.stats.demand[hot] = 1;
    c.st.stats.demand[weak] = GROWTH_DEMAND_FULL[family] / 4;
    c.sim.advanceDay();
    const cap = familyCap(c, family, devs);
    // Wanted growth is 1:3; the capped subtype mean is 7/16 before the family's concave response.
    const response = Math.pow(7 / 16, GROWTH_DEMAND_EXPONENT);
    expect(c.data.carry[hot]).toBeCloseTo(cap * response / 4, 10);
    expect(c.data.carry[weak]).toBeCloseTo(cap * response * 3 / 4, 10);
    expect(c.data.carry[hot] + c.data.carry[weak]).toBeCloseTo(cap * response, 10);
    expect(c.data.carry[weak] / c.data.carry[hot]).toBeCloseTo(3, 10);
  });

  it.each(FAMILIES)('%s preserves small wanted growth below its full and weak-demand throughput caps', (family, devs) => {
    const full = growthCity(), half = growthCity(), weak = growthCity();
    const d = devs[0];
    for (const c of [full, half, weak]) c.data.demandAbs[d] = 2;
    full.st.stats.demand[d] = GROWTH_DEMAND_FULL[family];
    half.st.stats.demand[d] = GROWTH_DEMAND_FULL[family] / 2;
    weak.st.stats.demand[d] = 0.011; // positive and above the existing eligibility cutoff
    full.sim.advanceDay();
    half.sim.advanceDay();
    weak.sim.advanceDay();
    expect(full.data.carry[d]).toBe(2);
    expect(half.data.carry[d]).toBe(2);
    expect(weak.data.carry[d]).toBe(2);
  });

  it.each(FAMILIES)('%s reduces previously uncapped wanted growth when weaker demand brings the cap below it', (family, devs) => {
    const full = growthCity(), weak = growthCity();
    const d = devs[0];
    const wanted = familyCap(full, family, devs) * 0.9;
    for (const c of [full, weak]) c.data.demandAbs[d] = wanted / GROWTH_RESPONSE;
    full.st.stats.demand[d] = GROWTH_DEMAND_FULL[family];
    weak.st.stats.demand[d] = 0.011;
    full.sim.advanceDay();
    weak.sim.advanceDay();
    expect(full.data.carry[d]).toBeCloseTo(wanted, 10);
    expect(weak.data.carry[d]).toBeGreaterThan(0);
    expect(weak.data.carry[d]).toBeLessThan(full.data.carry[d]);
  });

  it('retains the positive absolute demand and normalized-demand eligibility gates', () => {
    const c = growthCity();
    const normalized = [-0.5, 0, 0.01, GROWTH_DEMAND_FULL.C, GROWTH_DEMAND_FULL.C, GROWTH_DEMAND_FULL.C];
    const absolute = [1000, 1000, 1000, 0, -1000, 1000];
    normalized.forEach((value, d) => { c.st.stats.demand[d] = value; c.data.demandAbs[d] = absolute[d]; });
    c.sim.advanceDay();
    expect(c.data.carry.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(c.data.carry[5]).toBeGreaterThan(0);
  });

  it('caps an existing bank at the reduced daily throughput and retains debt recovery', () => {
    const c = growthCity();
    c.data.demandAbs[DevType.R1] = 100000;
    c.st.stats.demand[DevType.R1] = GROWTH_DEMAND_FULL.R / 2;
    c.sim.advanceDay();
    const daily = c.data.carry[DevType.R1];
    c.data.carry[DevType.R1] = 1e9;
    c.sim.advanceDay();
    expect(c.data.carry[DevType.R1]).toBeCloseTo(daily * GROWTH_BANK_DAYS, 10);
    c.data.carry[DevType.R1] = -100;
    c.sim.advanceDay();
    expect(c.data.carry[DevType.R1]).toBeCloseTo(-100 + daily, 10);
    c.st.stats.demand[DevType.R1] = 0;
    c.sim.advanceDay();
    expect(c.data.carry[DevType.R1]).toBeCloseTo((-100 + daily) * 0.97, 10);
    // An ineligible DevType cannot spend previously banked capacity.
    c.data.carry[DevType.R1] = 100;
    c.sim.advanceDay();
    expect(c.data.carry[DevType.R1]).toBe(0);
  });

  it('accumulates allowance without new RNG draws', () => {
    const c = growthCity();
    c.data.demandAbs.fill(10000);
    setFamilyDemand(c, 1 / 2);
    const rng = c.sim.rng.state;
    c.sim.runDays(12);
    expect(c.data.carry.every((value) => value > 0 && Number.isFinite(value))).toBe(true);
    expect(c.sim.rng.state).toBe(rng);
    expect(c.st.buildings.size).toBe(0);
  });

  it('loads an existing economy carry record and continues without additional save fields', () => {
    const c = growthCity();
    c.data.demandAbs.fill(10000);
    setFamilyDemand(c, 1 / 2);
    c.data.carry[DevType.R3] = -100;
    c.sim.runDays(7);
    const saved = structuredClone(serializeCity(c.st, { copy: true })) as SerializedCity;
    // Older cities need not have the optional growth scan state.
    delete (saved.data.systemData as Record<string, unknown>).growth;
    const restored = growthCity(deserializeCity(saved));
    const keys = Object.keys(c.data).sort();
    expect(restored.data.carry).toEqual(c.data.carry);
    c.sim.runDays(9);
    restored.sim.runDays(9);
    expect(restored.data.carry).toEqual(c.data.carry);
    expect(restored.st.stats.demand).toEqual(c.st.stats.demand);
    expect(Object.keys(restored.data).sort()).toEqual(keys);
  });
});

describe('demand: gradual tax response (NEW-05)', () => {
  it.each(DEV_TYPES)('DevType %i has a bounded, monotonically falling target from 9 through 20 percent', (d) => {
    let previous = taxFactor(d, TAX_NEUTRAL);
    expect(previous).toBe(1);
    for (let rate = TAX_NEUTRAL + 0.25; rate <= 20; rate += 0.25) {
      const factor = taxFactor(d, rate);
      expect(Number.isFinite(factor)).toBe(true);
      expect(factor).toBeGreaterThanOrEqual(TAX_FACTOR_MIN);
      expect(factor).toBeLessThanOrEqual(TAX_FACTOR_MAX);
      expect(factor).toBeLessThanOrEqual(previous);
      previous = factor;
    }
    expect(previous).toBeLessThan(1);
  });

  it.each([TAX_NEUTRAL, 11, 13, 14])('has no target jump at %i percent', (rate) => {
    const delta = 1e-6;
    for (const d of DEV_TYPES) {
      const before = taxFactor(d, rate - delta), at = taxFactor(d, rate), after = taxFactor(d, rate + delta);
      expect(before).toBeGreaterThanOrEqual(at);
      expect(after).toBeLessThanOrEqual(at);
      expect(Math.abs(before - at)).toBeLessThan(delta);
      expect(Math.abs(after - at)).toBeLessThan(delta);
    }
  });

  it('keeps wealthier homes and businesses more sensitive above neutral', () => {
    for (const rate of [10, 12, 14, 20]) {
      expect(taxFactor(DevType.R3, rate)).toBeLessThan(taxFactor(DevType.R2, rate));
      expect(taxFactor(DevType.R2, rate)).toBeLessThan(taxFactor(DevType.R1, rate));
      expect(taxFactor(DevType.CS3, rate)).toBeLessThan(taxFactor(DevType.CS2, rate));
      expect(taxFactor(DevType.CS2, rate)).toBeLessThan(taxFactor(DevType.CS1, rate));
      expect(taxFactor(DevType.CO3, rate)).toBeLessThan(taxFactor(DevType.CO2, rate));
    }
  });

  it('joins the legacy tax slope continuously at 11 percent', () => {
    const delta = 1e-6;
    for (const d of DEV_TYPES) {
      const at = taxFactor(d, 11);
      const before = (taxFactor(d, 11 - delta) - at) / delta;
      const after = (at - taxFactor(d, 11 + delta)) / delta;
      expect(before).toBeCloseTo(TAX_SENS[d] / TAX_NEUTRAL, 6);
      expect(after).toBeCloseTo(before, 6);
    }
  });

  it('tapers each additional tax point above 11 percent instead of accelerating toward a cliff', () => {
    for (const d of DEV_TYPES) {
      const factors = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map((rate) => taxFactor(d, rate));
      const losses = factors.slice(1).map((factor, k) => factors[k] - factor);
      losses.forEach((loss, k) => {
        expect(loss).toBeGreaterThan(0);
        if (k > 0) expect(loss).toBeLessThan(losses[k - 1]);
      });
    }
  });

  it.each(DEV_TYPES)('DevType %i retains the exact legacy tax response through 11 percent', (d) => {
    for (const rate of [-100, 0, 3, 6, 8, TAX_NEUTRAL, 10, 10.5, 11]) {
      const legacy = Math.max(TAX_FACTOR_MIN, Math.min(TAX_FACTOR_MAX, 1 - TAX_SENS[d] * (rate - TAX_NEUTRAL) / TAX_NEUTRAL));
      expect(taxFactor(d, rate)).toBe(legacy);
    }
    expect(taxFactor(d, 6)).toBeGreaterThan(1);
    expect(taxFactor(d, -100)).toBe(TAX_FACTOR_MAX);
  });

  it('keeps every target finite and positive at 14 percent', () => {
    for (const d of DEV_TYPES) {
      const factor = taxFactor(d, 14);
      expect(Number.isFinite(factor)).toBe(true);
      expect(factor).toBeGreaterThan(0);
      expect(factor).toBeLessThan(1);
    }
  });
});
