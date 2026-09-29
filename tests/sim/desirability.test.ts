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
import { Simulation } from '../../src/sim/Simulation';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { ZONE_DEVTYPES, getDef } from '../../src/sim/catalog';
import { conditionBreakdown } from '../../src/sim/economy/population';
import { sumTerms } from '../../src/sim/explain';
import type { EconRuntime } from '../../src/sim/economy/runtime';
import { DESIR_TERM_IDS, NT, T_ELEM, desirWeight, desirabilityBreakdown } from '../../src/sim/economy/desirability';
import { landValueBreakdown } from '../../src/sim/economy/landValue';
import { commuteMinutes, commuteRamp, conditionDesirability, garbageFade, lotCell } from '../../src/sim/economy/factors';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { updateNeighborConnections } from '../../src/sim/economy/connections';
import { DESIR_WEIGHTS, LV_REFRESH_DAYS, PENALTY_NO_GARBAGE, RENT_CONDITION_MIN } from '../../src/sim/economy/tuning';

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
    // a full band from the current inputs (the band and the breakdown share one term function): init runs one for a
    // new city (a loaded one keeps its saved layer)
    { const d = st.day; st.day = 0; sim.getSystem('economy.desirability')!.init!(sim); st.day = d; }
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

describe('condition: the RENT cap and the garbage fade keep conditionBreakdown exact', () => {
  it('conditionBreakdown sums to the condition target with the RENT cap and a faded no-pickup penalty', { timeout: 300000 }, () => {
    const { st, sim } = town(20);
    // an R$ cottage on a ResLow lot facing the z = 16 road (placed directly: growth picks its own DevTypes)
    const def = getDef('res_cottage.r1.2')!;
    expect(def.devType).toBe(DevType.R1);
    const [w, d] = def.footprint;
    let x0 = -1;
    for (let x = 9; x + w <= 16 && x0 < 0; x++) {
      let free = true;
      for (let z = 17; z < 17 + d; z++) for (let x1 = x; x1 < x + w; x1++) if (st.building[z * st.size + x1] >= 0) free = false;
      if (free) x0 = x;
    }
    expect(x0).toBeGreaterThanOrEqual(0);
    const b: Building = {
      id: st.nextBuildingId++, def: def.id, x: x0, z: 17, w, d, rot: 2, variant: 0, pop: 4, jobs: 0, capacity: def.capacity ?? 0, wealth: 1,
      built: 1, age: 400, flags: BF.Powered | BF.Watered, baseY: 5, health: 0.8, unhappy: 0,
    };
    placeBuilding(sim, b);
    const N = st.size;
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) st.landValue[z * N + x] = 0.95; // full rent pressure
    b.flags |= BF.NoGarbage;
    st.stats.population = 11000; // halfway through the garbage fade
    const br = conditionBreakdown(st, b);
    expect(Math.max(0, Math.min(1, sumTerms(br.terms)))).toBeCloseTo(br.target, 6);
    const g = br.terms.find((t) => t.id === 'garbage')!;
    expect(g.value).toBeCloseTo(-PENALTY_NO_GARBAGE * garbageFade(st), 6);
    expect(g.value).toBeLessThan(0);
    expect(g.value).toBeGreaterThan(-PENALTY_NO_GARBAGE);
    // the desirability term uses the capped rent (≥ the stored desirability, which carries the full R$ rent) — at the
    // lot's front row, where the occupancy loop evaluates the building
    const i = lotCell(b, N);
    const des = br.terms.find((t) => t.id === 'desirability')!;
    expect(des.value).toBeGreaterThanOrEqual(0.5 + 0.5 * st.desirability[DevType.R1][i] - 1e-6);
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

  it('save / load: a loaded city keeps its smoothed land value (no first pass) and refreshes the same rows', { timeout: 300000 }, () => {
    const { st, sim } = town(40);
    const copy = deserializeCity(structuredClone(serializeCity(st, { copy: true })) as SerializedCity);
    const saved = Float32Array.from(copy.landValue);
    const sim2 = new Simulation(copy, createSystems());
    // init rebuilt the caches but kept the saved values: a first pass would drop the neighbourhood blend and the lag
    let d0 = 0;
    for (let i = 0; i < copy.cells; i++) d0 = Math.max(d0, Math.abs(copy.landValue[i] - saved[i]));
    expect(d0).toBe(0);
    expect(copy.stats.avgLandValue).toBeGreaterThan(0);
    expect(Math.abs(copy.stats.avgLandValue - st.stats.avgLandValue)).toBeLessThan(0.02);
    // the band continues on the rows of the day: the original and the loaded copy stay together
    sim.runDays(3);
    sim2.runDays(3);
    let d1 = 0;
    for (let i = 0; i < copy.cells; i++) d1 = Math.max(d1, Math.abs(copy.landValue[i] - st.landValue[i]));
    expect(d1).toBeLessThan(0.02);
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

describe('desirability: save / load and early-game commute', () => {
  it('a loaded city keeps its saved desirability (no band on the empty coarse inputs) and follows the original', { timeout: 300000 }, () => {
    const { st, sim } = town(40);
    const copy = deserializeCity(structuredClone(serializeCity(st, { copy: true })) as SerializedCity);
    const saved = copy.desirability.map((l) => Float32Array.from(l));
    const sim2 = new Simulation(copy, createSystems());
    // right after init: every cell as saved (shops / offices read their customers, skills and wealthy neighbours from
    // the coarse grids that population.init fills after desirability.init)
    let d0 = 0, cCells = 0;
    for (let i = 0; i < copy.cells; i++) {
      const zn = copy.zone[i];
      for (const d of zn !== Zone.None && zn !== Zone.Landfill ? ZONE_DEVTYPES[zn] : []) {
        d0 = Math.max(d0, Math.abs(copy.desirability[d][i] - saved[d][i]));
        if (d >= DevType.CS1 && d <= DevType.CO3) cCells++;
      }
    }
    expect(cCells).toBeGreaterThan(50);
    expect(d0).toBeLessThanOrEqual(0.005);
    // the band continues on the rows of the day: the original and the loaded copy refresh the same rows with the same
    // inputs (a few days: the other systems' post-load passes differ a little)
    sim.runDays(3);
    sim2.runDays(3);
    let d1 = 0, n = 0, sum = 0;
    for (let i = 0; i < copy.cells; i++) {
      const zn = copy.zone[i];
      if (zn === Zone.None || zn === Zone.Landfill) continue;
      for (const d of ZONE_DEVTYPES[zn]) { const e = Math.abs(copy.desirability[d][i] - st.desirability[d][i]); d1 = Math.max(d1, e); sum += e; n++; }
    }
    expect(sum / n).toBeLessThan(0.01);
    void d1;
  });

  it('before traffic has an average commute, a cell with no road route scores a long commute, not the average', () => {
    const { st } = makeCity({ size: 16 });
    st.stats.avgCommute = 0;
    const r = commuteRamp(st);
    const a = 3 * 16 + 3, b = 3 * 16 + 5;
    // services has not written accessCommute yet: unknown everywhere -> the average
    expect(commuteMinutes(st, true, a, r.avg, r.unreached)).toBe(r.avg);
    // it has (b is reached, a is not): a no longer scores as an average commute
    st.day = 1;
    st.accessCommute[b] = 6;
    const r2 = commuteRamp(st);
    expect(commuteMinutes(st, true, b, r2.avg, r2.unreached)).toBe(6);
    expect(commuteMinutes(st, true, a, r2.avg, r2.unreached)).toBeGreaterThan(r2.avg);
  });

  it('lotCell: a growable is evaluated at the middle of its road-side row', () => {
    const N = 32;
    // a 2 x 4 lot at (10, 10): rot 0 faces +z (row z = 13), rot 2 faces -z (row 10), rot 1 +x (column 11), rot 3 -x (10)
    const lot = (rot: number) => ({ x: 10, z: 10, w: 2, d: 4, rot });
    expect(lotCell(lot(0), N)).toBe(13 * N + 11);
    expect(lotCell(lot(2), N)).toBe(10 * N + 11);
    expect(lotCell(lot(1), N)).toBe(12 * N + 11);
    expect(lotCell(lot(3), N)).toBe(12 * N + 10);
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
