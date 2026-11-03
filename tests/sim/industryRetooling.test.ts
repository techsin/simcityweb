/** LG-07: refused dirty demand retools deterministically without bypassing caps or workforce limits. */
import { describe, expect, it } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import { CATALOG } from '../../src/sim/catalog';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { demandSystem, industrialStrategy } from '../../src/sim/economy/demand';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { Simulation } from '../../src/sim/Simulation';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { makeCity } from './helpers';

function fixture(room = false, ordinances: string[] = [], eq = 80, population = 10000) {
  const { st } = makeCity({ size: 16 }, []);
  st.stats.eq = eq;
  st.budget.taxRates.fill(9);
  st.budget.ordinances = ordinances;
  st.network[st.idx(4, 3)] = Network.Road;
  st.zone[st.idx(4, 4)] = room ? Zone.IndMed : Zone.IndHigh;
  const rt = new EconRuntime(), sys = demandSystem(rt), sim = new Simulation(st, [sys]);
  rt.totals.population = population;
  rt.totals.pop = [population, 0, 0];
  // Re-init on day zero computes the controlled fixture's targets without advancing a saved ramp.
  sys.init!(sim);
  return { st, rt, sys, sim };
}

describe('LG-07 industry retooling', () => {
  it('ramps linearly for 12 months with no dirty room, then stays level and unwinds when room returns', () => {
    const { st, sim, sys } = fixture();
    const strategy = () => industrialStrategy(st)!;
    const refused = strategy().refused;
    expect(refused).toBeGreaterThan(0);
    expect(strategy().retooledIM).toBe(0);
    for (const days of [30, 150, 180]) {
      sim.runDays(days);
      expect(strategy().retooledIM).toBeCloseTo(refused * 0.5 * st.day / 360, 8);
      expect(strategy().retooledIHT).toBeCloseTo(refused * 0.25 * st.day / 360, 8);
    }
    const full = structuredClone(strategy());
    sys.daily!(sim);
    expect(strategy()).toEqual(full);
    sim.runDays(360);
    expect(strategy().retooledIM).toBeCloseTo(refused * 0.5, 8);
    st.zone[st.idx(4, 4)] = Zone.IndMed;
    sim.runDays(180);
    expect(strategy().refused).toBe(0);
    expect(strategy().retooledIM).toBeCloseTo(refused * 0.25, 8);
    sim.runDays(180);
    expect(strategy().retooledIM).toBeCloseTo(0, 8);
  });

  it('does not retool placeable demand, tax losses or existing factories; combines policy and land refusals once', () => {
    const open = fixture(true);
    open.sim.runDays(360);
    expect(industrialStrategy(open.st)!.retooledIM).toBe(0);
    open.st.budget.taxRates[DevType.ID] = 14;
    open.sim.runDays(360);
    expect(industrialStrategy(open.st)!.refused).toBe(0);
    const policy = fixture(true, ['clean_air_act', 'pollution_controls']);
    const plain = fixture(true);
    const baseDirty = econData(plain.st).rawTarget[DevType.ID];
    const loss = industrialStrategy(policy.st)!.refused;
    expect(loss / baseDirty).toBeCloseTo(1 - 0.75 * 0.94, 3);
    policy.sim.runDays(360);
    expect(industrialStrategy(policy.st)!.retooledIM).toBeCloseTo(loss * 0.5 * 0.95 * 0.94, 8);
    policy.st.zone[policy.st.idx(4, 4)] = Zone.IndHigh;
    policy.sys.daily!(policy.sim);
    expect(industrialStrategy(policy.st)!.refused).toBeCloseTo(baseDirty, 0);
    policy.rt.totals.jobCapAll[DevType.ID] = 10000;
    policy.sys.daily!(policy.sim);
    expect(industrialStrategy(policy.st)!.refused).toBeCloseTo(loss, 8);
  });

  it('gates retooled high-tech strictly above EQ 70 and raises the native educated-city target', () => {
    const low = fixture(false, [], 70), high = fixture(false, [], 70.01);
    low.sim.runDays(360); high.sim.runDays(360);
    expect(industrialStrategy(low.st)!.retooledIM).toBeGreaterThan(0);
    expect(industrialStrategy(low.st)!.retooledIHT).toBe(0);
    expect(industrialStrategy(high.st)!.retooledIHT).toBeGreaterThan(0);
    const educated = fixture(true, [], 110);
    const raw = econData(educated.st).rawTarget;
    const total = raw.slice(DevType.IA).reduce((a, b) => a + b, 0);
    expect(raw[DevType.IHT] / total).toBeGreaterThanOrEqual(0.25);
  });

  it('applies receiving-sector taxes and ordinances to the replacement demand', () => {
    const a = fixture(), b = fixture();
    b.st.budget.taxRates[DevType.IM] = 14;
    b.st.budget.taxRates[DevType.IHT] = 14;
    a.sim.runDays(360); b.sim.runDays(360);
    expect(industrialStrategy(b.st)!.refused).toBe(industrialStrategy(a.st)!.refused);
    expect(industrialStrategy(b.st)!.retooledIM).toBeCloseTo(industrialStrategy(a.st)!.retooledIM * (1 - 0.45 * 5 / 9), 8);
    expect(industrialStrategy(b.st)!.retooledIHT).toBeCloseTo(industrialStrategy(a.st)!.retooledIHT * (1 - 0.75 * 5 / 9), 8);
    const dirtyTax = fixture();
    dirtyTax.st.budget.taxRates[DevType.ID] = 14;
    dirtyTax.sim.runDays(360);
    // A replacement pays its new sector's tax once; the refused factory's tax is not charged as well.
    expect(industrialStrategy(dirtyTax.st)!.retooledIM).toBe(industrialStrategy(a.st)!.retooledIM);
    expect(industrialStrategy(dirtyTax.st)!.retooledIHT).toBe(industrialStrategy(a.st)!.retooledIHT);
  });

  it('continues the same ramp after save/load and initializes older saves without consuming RNG', () => {
    const a = fixture(false, ['clean_air_act']);
    a.sim.runDays(157);
    const saved = serializeCity(a.st, { copy: true });
    const copy = deserializeCity(structuredClone(saved));
    const rt = new EconRuntime(), sys = demandSystem(rt), sim = new Simulation(copy, [sys]);
    Object.assign(rt.totals, structuredClone(a.rt.totals));
    const before = structuredClone(industrialStrategy(copy));
    sys.init!(sim);
    expect(industrialStrategy(copy)).toEqual(before);
    a.sim.runDays(400); sim.runDays(400);
    expect(industrialStrategy(copy)).toEqual(industrialStrategy(a.st));
    expect(econData(copy).demandAbs).toEqual(econData(a.st).demandAbs);
    delete (copy.systemData.economy as { industry?: unknown }).industry;
    expect(industrialStrategy(copy)).toBeUndefined();
    const rng = copy.systemData.simRng;
    sys.daily!(sim);
    expect(industrialStrategy(copy)!.retooledIM).toBe(0);
    expect(copy.systemData.simRng).toBe(rng);
    delete (copy.systemData.economy as { industry?: unknown }).industry;
    sys.init!(sim);
    expect(industrialStrategy(copy)!.retooledIM).toBe(0);
    sim.runDays(1);
    expect(industrialStrategy(copy)!.retooledIM).toBeCloseTo(industrialStrategy(copy)!.refused * 0.5 * 0.95 / 360, 8);
  });

  it('exposes filled dirty share and resident air read-only, while clean targets obey caps and labour headroom', () => {
    const { st, rt, sim } = fixture(false, [], 110, 200000);
    rt.totals.jobs[DevType.ID] = 200;
    rt.totals.jobs[DevType.IM] = 300;
    rt.totals.jobs[DevType.IHT] = 500;
    st.stats.avgAir = 0.12;
    rt.totals.civicJobCap = 200000;
    sim.runDays(360);
    const before = structuredClone(st.systemData);
    expect(industrialStrategy(st)!.dirtyShare).toBe(0.2);
    expect(industrialStrategy(st)!.airAtHomes).toBe(0.12);
    expect(st.systemData).toEqual(before);
    const data = econData(st);
    for (const dev of [DevType.IM, DevType.IHT]) {
      expect(data.target[dev]).toBeLessThanOrEqual(st.stats.demandCap[dev]);
      expect(data.demandAbs[dev]).toBeLessThanOrEqual(400);
    }
  });

  it('keeps dirty redevelopment subject to labour limits when an occupied district has no empty frontage', () => {
    const { st, rt, sim } = fixture(true, [], 80, 200000);
    const def = CATALOG.find((d) => d.devType === DevType.ID)!;
    const b: Building = { id: st.nextBuildingId++, def: def.id, x: 4, z: 4, w: def.footprint[0], d: def.footprint[1], rot: 2, variant: 0,
      pop: 0, jobs: 0, capacity: def.capacity!, wealth: 1, built: 1, age: 1000, flags: BF.Powered | BF.Watered, baseY: 5, health: 1, unhappy: 0 };
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) st.zone[st.idx(x, z)] = Zone.IndMed;
    placeBuilding(sim, b);
    rt.totals.jobCapAll[DevType.ID] = b.capacity;
    rt.totals.jobCapAll[DevType.IM] = rt.totals.jobCapAll[DevType.IHT] = 20000;
    rt.totals.civicJobCap = 200000;
    sim.runDays(360);
    expect(industrialStrategy(st)!.refused).toBeGreaterThan(0);
    expect(econData(st).demandAbs[DevType.ID]).toBeLessThanOrEqual(400 + 1e-8);
  });
});
