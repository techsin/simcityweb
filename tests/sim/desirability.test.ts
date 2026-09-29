/**
 * SIM_DEPTH_SPEC WP6 (docs/SIM_DEPTH_PART_B.md §5 WP6a, items 34-36): the 33-term desirability model and its breakdown,
 * cohort weighting, the city-relative commute ramp, RENT, the land value formula and its breakdown, functional-gated
 * plopped splats (burnt landmarks, parks funding), the garbage fade, the RENT cap in the condition target and the
 * neighbour-connection stub rule.
 */
import { describe, expect, it } from 'vitest';
import { createSystems } from '../../src/sim/systems/index';
import { makeCity, road } from './helpers';
import { DevType, Network, Zone } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import type { Simulation } from '../../src/sim/Simulation';
import { ZONE_DEVTYPES } from '../../src/sim/catalog';
import type { EconRuntime } from '../../src/sim/economy/runtime';
import { DESIR_TERM_IDS, NT, T_ELEM, desirWeight, desirabilityBreakdown } from '../../src/sim/economy/desirability';
import { landValueBreakdown } from '../../src/sim/economy/landValue';
import { commuteRamp, conditionDesirability, garbageFade } from '../../src/sim/economy/factors';
import { updateNeighborConnections } from '../../src/sim/economy/connections';
import { DESIR_WEIGHTS, LV_REFRESH_DAYS, RENT_CONDITION_MIN } from '../../src/sim/economy/tuning';

const rtOf = (sim: Simulation) => (sim.getSystem('economy.population') as unknown as { rt: EconRuntime }).rt;

/** a small serviced town: avenue to both map edges, a road grid, R low / medium / high, C and I zones, utilities,
 *  a school, a park and a clinic; run `days` */
function town(days = 45): { st: CityState; sim: Simulation; rt: EconRuntime; A: ReturnType<typeof makeCity>['A'] } {
  const { st, sim, A } = makeCity({ size: 64 }, createSystems());
  st.funds = 5e6;
  expect(road(A, 0, 32, 63, 32, Network.Avenue).ok).toBe(true);
  for (let x = 8; x <= 56; x += 8) road(A, x, 16, x, 48);
  road(A, 8, 16, 56, 16);
  road(A, 8, 48, 56, 48);
  A.zone({ x0: 9, z0: 17, x1: 16, z1: 32 }, Zone.ResLow);
  A.zone({ x0: 17, z0: 17, x1: 24, z1: 32 }, Zone.ResMed);
  A.zone({ x0: 25, z0: 17, x1: 32, z1: 32 }, Zone.ResHigh);
  A.zone({ x0: 33, z0: 17, x1: 40, z1: 32 }, Zone.ComMed);
  A.zone({ x0: 9, z0: 33, x1: 24, z1: 48 }, Zone.ResLow);
  A.zone({ x0: 41, z0: 33, x1: 56, z1: 48 }, Zone.IndMed);
  for (const [def, x, z] of [['util_gas_plant', 50, 26], ['util_water_pump', 45, 18], ['civ_elementary_school', 26, 34], ['park_small', 30, 34], ['civ_clinic', 34, 34]] as const) {
    let ok = false;
    for (const rot of [0, 1, 2, 3] as const) if (!ok) ok = A.plop(def, x, z, rot).ok;
    expect(ok, def).toBe(true);
  }
  sim.runDays(days);
  return { st, sim, rt: rtOf(sim), A };
}

/** deterministic cell sampler */
function sampler(seed: number) {
  let s = seed >>> 0 || 1;
  return (n: number) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % n; };
}

describe('desirability: the 33-term model and its breakdown', () => {
  it('desirabilityBreakdown sums to the stored desirability (before the clamp) on 200 random cells', { timeout: 300000 }, () => {
    const { st, sim, rt } = town();
    // a full band from the current inputs (the band and the breakdown share one term function)
    sim.getSystem('economy.desirability')!.init!(sim);
    const rnd = sampler(7);
    let checked = 0;
    for (let k = 0; k < 200; k++) {
      const i = rnd(st.cells);
      const zn = st.zone[i];
      const devs = zn !== Zone.None && zn !== Zone.Landfill ? ZONE_DEVTYPES[zn] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
      for (const d of devs) {
        const br = desirabilityBreakdown(st, rt, d, i);
        const sum = br.terms.reduce((a, t) => a + t.value, 0);
        expect(sum).toBeCloseTo(br.raw, 9);
        expect(br.value).toBe(st.desirability[d][i]);
        expect(Math.max(-1, Math.min(1, br.raw))).toBeCloseTo(br.value, 5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    // every term id is a known one (inspector labels)
    const br = desirabilityBreakdown(st, rt, DevType.R2, 20 * st.size + 20);
    for (const t of br.terms) expect(['base', 'tax', ...DESIR_TERM_IDS]).toContain(t.id);
    expect(NT).toBe(33);
    // stub output without a runtime
    expect(desirabilityBreakdown(st, null, 0, 5).terms).toEqual([]);
  });

  it('cohort weighting: a low-density R$$ lot gains >= 1.5x more from an elementary school than a high-density lot', { timeout: 300000 }, () => {
    expect(desirWeight(DevType.R2, T_ELEM, 1) / desirWeight(DevType.R2, T_ELEM, 3)).toBeGreaterThanOrEqual(1.5);
    // the reference mix (unzoned slot) keeps the spec weight
    expect(desirWeight(DevType.R2, T_ELEM, 0)).toBeCloseTo(DESIR_WEIGHTS[DevType.R2].elem, 6);
    const { st, rt } = town(10);
    const N = st.size;
    const lo = 20 * N + 12, hi = 20 * N + 28; // ResLow / ResHigh cells
    expect(st.zone[lo]).toBe(Zone.ResLow);
    expect(st.zone[hi]).toBe(Zone.ResHigh);
    st.eduElemCov[lo] = st.eduElemCov[hi] = 1;
    const gain = (i: number) => desirabilityBreakdown(st, rt, DevType.R2, i).terms.find((t) => t.id === 'elem')!.value;
    expect(gain(lo) / gain(hi)).toBeGreaterThanOrEqual(1.5);
  });

  it('RENT: R$ desirability at land value .9 is at least 0.3 below R$ at .5, all else equal', { timeout: 300000 }, () => {
    const { st, rt } = town(10);
    const i = 20 * st.size + 12;
    st.landValue[i] = 0.5;
    const at5 = desirabilityBreakdown(st, rt, DevType.R1, i).raw;
    st.landValue[i] = 0.9;
    const at9 = desirabilityBreakdown(st, rt, DevType.R1, i).raw;
    expect(at5 - at9).toBeGreaterThanOrEqual(0.3);
    // the rich outbid the poor there: R$$ gains from the same land value
    st.landValue[i] = 0.5;
    const r2at5 = desirabilityBreakdown(st, rt, DevType.R2, i).raw;
    st.landValue[i] = 0.9;
    expect(desirabilityBreakdown(st, rt, DevType.R2, i).raw).toBeGreaterThan(r2at5);
  });

  it('commute is relative to the city: a cell at 2x the average commute scores lower than one at the average', { timeout: 300000 }, () => {
    const { st, rt } = town(10);
    const i = 20 * st.size + 12;
    st.stats.avgCommute = 10;
    const r = commuteRamp(st);
    expect(r.good).toBeCloseTo(8, 6);
    expect(r.bad).toBeCloseTo(30, 6);
    const term = () => desirabilityBreakdown(st, rt, DevType.R2, i).terms.find((t) => t.id === 'commute')!.value;
    st.accessCommute[i] = 10;
    const atAvg = term();
    st.accessCommute[i] = 20;
    const atTwice = term();
    expect(atTwice).toBeLessThan(atAvg - 0.05);
    // the old fixed 12..80 min ramp scored both the same (saturated); the new one separates them
    expect(atAvg).toBeGreaterThan(0);
  });

  it('garbage terms fade in with the town (2k -> 20k residents)', { timeout: 300000 }, () => {
    const { st, rt } = town(10);
    const i = 20 * st.size + 12;
    st.garbage[i] = 1;
    st.stats.population = 1500;
    expect(garbageFade(st)).toBe(0);
    expect(desirabilityBreakdown(st, rt, DevType.R1, i).terms.find((t) => t.id === 'garbage')?.value ?? 0).toBeCloseTo(0, 12);
    expect(landValueBreakdown(st, rt, i).find((t) => t.id === 'garbage')?.value ?? 0).toBeCloseTo(0, 12);
    st.stats.population = 30000;
    expect(garbageFade(st)).toBe(1);
    expect(desirabilityBreakdown(st, rt, DevType.R1, i).terms.find((t) => t.id === 'garbage')!.value).toBeCloseTo(DESIR_WEIGHTS[DevType.R1].garbage, 6);
  });

  it('RENT counts at most RENT_CONDITION_MIN in the condition target (existing homes gentrify, not abandon)', () => {
    const { st } = makeCity({ size: 16 });
    const i = 5 * 16 + 5;
    st.landValue[i] = 0.95;
    const des = -0.2;
    const cond = conditionDesirability(st, DevType.R1, i, des);
    // R$ rent at full pressure: −0.5 -> capped at RENT_CONDITION_MIN (−0.1)
    expect(cond).toBeCloseTo(des + 0.5 + RENT_CONDITION_MIN, 6);
    expect(conditionDesirability(st, DevType.R3, i, des)).toBe(des); // R$$$ pays no rent term
    st.landValue[i] = 0.3;
    expect(conditionDesirability(st, DevType.R1, i, des)).toBe(des); // no rent pressure on cheap land
  });
});

describe('land value: formula, breakdown, functional-gated splats', () => {
  it('landValueBreakdown sums to the stored land value (± 0.005) on 200 random cells', { timeout: 300000 }, () => {
    const { st, rt } = town();
    const rnd = sampler(11);
    for (let k = 0; k < 200; k++) {
      const i = rnd(st.cells);
      const terms = landValueBreakdown(st, rt, i);
      expect(terms.length).toBeGreaterThan(0);
      const sum = terms.reduce((a, t) => a + t.value, 0);
      expect(Math.abs(sum - st.landValue[i])).toBeLessThanOrEqual(0.005);
    }
    expect(landValueBreakdown(st, null, 3)).toEqual([]);
  });

  it('steady state: |smoothing| <= 0.05 on 90 % of land cells after 2 x LV_REFRESH_DAYS without edits', { timeout: 300000 }, () => {
    // roads and services only (nothing grows, nothing changes)
    const { st, sim, A } = makeCity({ size: 48 }, createSystems());
    st.funds = 1e6;
    road(A, 0, 24, 47, 24, Network.Avenue);
    road(A, 24, 4, 24, 44);
    for (const [def, x, z] of [['park_small', 20, 20], ['civ_clinic', 26, 20]] as const) {
      let ok = false;
      for (const rot of [0, 1, 2, 3] as const) if (!ok) ok = A.plop(def, x, z, rot).ok;
    }
    sim.runDays(2 * LV_REFRESH_DAYS + 6);
    const rt = rtOf(sim);
    let land = 0, small = 0;
    for (let i = 0; i < st.cells; i++) {
      if (st.water[i]) continue;
      land++;
      const sm = landValueBreakdown(st, rt, i).find((t) => t.id === 'smoothing')!.value;
      if (Math.abs(sm) <= 0.05) small++;
    }
    expect(small / land).toBeGreaterThanOrEqual(0.9);
  });

  it('a burnt landmark gives 0 land-value splat; parks lift land value by their funding', { timeout: 300000 }, () => {
    const { st, sim, A } = makeCity({ size: 48 }, createSystems());
    st.funds = 1e6;
    road(A, 0, 24, 47, 24, Network.Avenue);
    st.unlocked.add('lm_clock_tower');
    let lm: Building | undefined, park: Building | undefined;
    // far enough apart that their splats do not overlap the other's measuring box
    for (const rot of [0, 1, 2, 3] as const) if (!lm && A.plop('lm_clock_tower', 4, 22, rot).ok) lm = st.buildingAt(4, 22);
    for (const rot of [0, 1, 2, 3] as const) if (!park && A.plop('park_large', 38, 20, rot).ok) park = st.buildingAt(38, 20);
    expect(lm && park).toBeTruthy();
    sim.runDays(2);
    const rt = rtOf(sim);
    const around = (b: Building) => {
      let s = 0;
      for (let z = Math.max(0, b.z - 10); z < Math.min(st.size, b.z + b.d + 10); z++) for (let x = Math.max(0, b.x - 10); x < Math.min(st.size, b.x + b.w + 10); x++) s += rt.lvEffects[z * st.size + x];
      return s;
    };
    expect(around(lm!)).toBeGreaterThan(1);
    lm!.flags |= BF.Burnt;
    sim.events.emit('buildingChanged', lm!);
    sim.runDays(1);
    expect(Math.abs(around(lm!))).toBeLessThan(1e-3);
    // parks: splat × parks effectiveness (funding^0.7)
    const full = around(park!);
    expect(full).toBeGreaterThan(1);
    A.setFunding('parks', 50);
    sim.runDays(1);
    expect(around(park!) / full).toBeCloseTo(Math.pow(0.5, 0.7), 2);
    // bulldozing removes exactly what was splatted
    A.bulldoze({ x0: park!.x, z0: park!.z, x1: park!.x + park!.w, z1: park!.z + park!.d });
    sim.runDays(1);
    expect(Math.abs(around(park!))).toBeLessThan(1e-3);
  });
});

describe('neighbour connections', () => {
  it('a one-cell road stub at the map edge is not a neighbour connection; a road that leads into the city is', () => {
    const { st, A } = makeCity({ size: 48 });
    st.funds = 1e6;
    st.network[10 * 48 + 0] = Network.Road; // one cell at the west edge
    updateNeighborConnections(st);
    expect(st.neighborConnections.length).toBe(0);
    road(A, 47, 30, 45, 30); // a 3-cell dead-end spur from the east edge
    updateNeighborConnections(st);
    expect(st.neighborConnections.length).toBe(0);
    road(A, 0, 20, 12, 20); // a road into the map
    expect(st.neighborConnections.map((c) => c.edge)).toEqual(['w']);
    // extending the stub into the network makes it count
    road(A, 45, 30, 30, 30);
    expect(st.neighborConnections.map((c) => c.edge).sort()).toEqual(['e', 'w']);
  });
});
