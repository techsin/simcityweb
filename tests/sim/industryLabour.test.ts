/** LG-07: retooling shares the existing C/I worker budget; an excluded dirty request cannot escape it. */
import { describe, expect, it } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import { smoothstep } from '../../src/core/rng';
import { BF, type Building } from '../../src/sim/CityState';
import { CATALOG } from '../../src/sim/catalog';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { demandSystem, industrialStrategy } from '../../src/sim/economy/demand';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { LABOUR_MIN_HEAD, LABOUR_POP0, LABOUR_POP1, LABOUR_UNEMP0, LABOUR_VAC0, WORKFORCE_RATIO } from '../../src/sim/economy/tuning';
import { Simulation } from '../../src/sim/Simulation';
import { makeCity } from './helpers';

function city(capI = 10000, population = 100000, eq = 100) {
  const { st } = makeCity({ size: 16 }, []);
  st.neighborConnections = [{ edge: 'n', x: 8, z: 0, type: Network.Highway }];
  st.stats.eq = eq;
  const rt = new EconRuntime(), sys = demandSystem(rt), sim = new Simulation(st, [sys]);
  rt.totals.population = population;
  rt.totals.pop = [population * 0.4, population * 0.45, population * 0.15];
  rt.totals.resCapAll = [...rt.totals.pop];
  [0.2, 0.2, 0.1, 0.35, 0.15].forEach((f, k) => { rt.totals.jobCapAll[DevType.CS1 + k] = 40000 * f; });
  [0.05, 0.35, 0.45, 0.15].forEach((f, k) => { rt.totals.jobCapAll[DevType.IA + k] = capI * f; });
  // Start this controlled mature city without demand EMA history from the empty city used by makeCity.
  sys.init!(sim);
  const staffable = population * WORKFORCE_RATIO * (1 - LABOUR_UNEMP0) / (1 - LABOUR_VAC0);
  return { st, rt, sys, sim, head: Math.max(LABOUR_MIN_HEAD, staffable - 40000 - capI) };
}

function jobDemand(c: ReturnType<typeof city>) {
  const d = econData(c.st);
  let positive = 0, net = 0;
  for (let dev = DevType.CS1; dev <= DevType.IHT; dev++) {
    positive += Math.max(0, d.demandAbs[dev]);
    net += d.demandAbs[dev];
  }
  return { positive, net };
}

describe('LG-07 retooling labour conservation', () => {
  it.each([25000, 10000])('keeps aggregate new C/I demand inside headroom through the full ramp and unwind: I capacity %s', (capI) => {
    const c = city(capI), capacities = c.rt.totals.jobCapAll.slice(), jobs = c.rt.totals.jobs.slice();
    const start = econData(c.st).rawTarget.slice(), refused = industrialStrategy(c.st)!.refused;
    expect(refused).toBeGreaterThan(0);
    for (let day = 0; day <= 720; day++) {
      const demand = jobDemand(c);
      expect(demand.positive).toBeLessThanOrEqual(c.head + 1e-8);
      expect(demand.net).toBeLessThanOrEqual(c.head + 1e-8);
      expect(c.rt.totals.jobCapAll).toEqual(capacities);
      expect(c.rt.totals.jobs).toEqual(jobs);
      if (day <= 360) expect(econData(c.st).demandAbs[DevType.ID]).toBe(0);
      if (day === 360) {
        const strategy = industrialStrategy(c.st)!;
        expect(strategy.retooledIM).toBeCloseTo(refused * 0.5, 8);
        expect(strategy.retooledIHT).toBeCloseTo(refused * 0.25, 8);
        expect(econData(c.st).rawTarget[DevType.IM] - start[DevType.IM]).toBeCloseTo(strategy.retooledIM, 0);
        expect(econData(c.st).rawTarget[DevType.IHT] - start[DevType.IHT]).toBeCloseTo(strategy.retooledIHT, 0);
        c.st.zone[c.st.idx(4, 4)] = Zone.IndMed;
        c.st.network[c.st.idx(4, 3)] = Network.Road;
      }
      if (day < 720) c.sim.advanceDay();
    }
    expect(econData(c.st).demandAbs[DevType.ID]).toBeGreaterThan(0);
    expect(industrialStrategy(c.st)!.retooledIM).toBeCloseTo(0, 8);
  });

  it.each([LABOUR_POP0, (LABOUR_POP0 + LABOUR_POP1) / 2])('retains the original small-town labour fade at population %s', (population) => {
    const c = city(0, population), d = econData(c.st);
    const fade = smoothstep(LABOUR_POP0, LABOUR_POP1, population);
    const positiveTargets = d.target.slice(DevType.CS1).reduce((n, v, k) => n + Math.max(0, v - c.rt.totals.jobCapAll[DevType.CS1 + k]), 0);
    expect(d.demandAbs[DevType.ID]).toBeGreaterThan(0);
    expect(d.demandAbs[DevType.ID]).toBeCloseTo(d.target[DevType.ID] * (1 - fade), 0);
    expect(jobDemand(c).positive).toBeLessThanOrEqual((1 - fade) * positiveTargets + fade * c.head + 5);
  });

  it('conserves the original positive-demand bound below the high-tech retool threshold', () => {
    const c = city(10000, 100000, 60);
    c.sim.runDays(360);
    expect(industrialStrategy(c.st)!.retooledIM).toBeGreaterThan(0);
    expect(industrialStrategy(c.st)!.retooledIHT).toBe(0);
    expect(jobDemand(c).positive).toBeLessThanOrEqual(c.head + 1e-8);
  });

  it('shares the same headroom when ordinances retool demand and dirty land remains available', () => {
    const c = city();
    c.st.zone[c.st.idx(4, 4)] = Zone.IndMed;
    c.st.network[c.st.idx(4, 3)] = Network.Road;
    c.st.budget.ordinances = ['clean_air_act', 'pollution_controls'];
    for (let day = 0; day < 360; day++) {
      c.sim.advanceDay();
      expect(jobDemand(c).positive).toBeLessThanOrEqual(c.head + 1e-8);
    }
    expect(industrialStrategy(c.st)!.retooledIM).toBeGreaterThan(0);
    expect(industrialStrategy(c.st)!.retooledIHT).toBeGreaterThan(0);
    expect(econData(c.st).demandAbs[DevType.ID]).toBeGreaterThan(0);
  });

  it('budgets dirty redevelopment with occupied IndMed and no vacant frontage', () => {
    const c = city(), def = CATALOG.find((d) => d.devType === DevType.ID)!;
    const b: Building = { id: c.st.nextBuildingId++, def: def.id, x: 4, z: 4, w: def.footprint[0], d: def.footprint[1], rot: 2, variant: 0,
      pop: 0, jobs: 10, capacity: def.capacity!, wealth: 1, built: 1, age: 1000, flags: BF.Powered | BF.Watered, baseY: 5, health: 1, unhappy: 0 };
    placeBuilding(c.sim, b);
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) c.st.zone[c.st.idx(x, z)] = Zone.IndMed;
    c.sim.runDays(360);
    expect(econData(c.st).demandAbs[DevType.ID]).toBeGreaterThan(0);
    expect(jobDemand(c).positive).toBeLessThanOrEqual(c.head + 1e-8);
    expect(b.jobs).toBe(10);
  });

  it('preserves negative dirty demand instead of erasing it when no lot can accept expansion', () => {
    const c = city(), d = econData(c.st);
    c.rt.totals.jobCapAll[DevType.ID] = d.rawTarget[DevType.ID] * 0.9;
    c.st.budget.taxRates[DevType.ID] = 14;
    c.sim.runDays(360);
    expect(industrialStrategy(c.st)!.refused).toBeGreaterThan(0);
    expect(d.demandAbs[DevType.ID]).toBeLessThan(0);
    expect(d.demandAbs[DevType.ID]).toBeCloseTo(d.target[DevType.ID] - c.rt.totals.jobCapAll[DevType.ID], 0);
  });
});
