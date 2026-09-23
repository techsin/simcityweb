/**
 * SIM_DEPTH_SPEC WP4-1: regional play in RCI demand. Neighbour cities (state.systemData.region, written by
 * src/region/regionEffects.ts) raise / lower the targets, scaled by how well the shared edge is connected.
 */
import { describe, expect, it } from 'vitest';
import { makeCity, road } from './helpers';
import { DevType, Network } from '../../src/core/types';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { demandSystem, edgeFactor, regionInputs } from '../../src/sim/economy/demand';
import type { RegionContext, RegionNeighbor } from '../../src/region/regionEffects';
import { applyRegionEffects, regionContext } from '../../src/region/regionEffects';
import { createRegionData } from '../../src/region/RegionModel';
import type { CityState } from '../../src/sim/CityState';
import { EDGE_CONN, EDGE_NONE } from '../../src/sim/economy/tuning';

const SIZE = 128;

function neighbor(o: Partial<RegionNeighbor>): RegionNeighbor {
  return { edge: 'n', tileKey: 'n1', name: 'Northtown', founded: true, population: 0, jobs: 0, workers: 0, r: 0, c: 0, i: 0, from: 0, to: SIZE, ...o };
}
function region(neighbors: RegionNeighbor[], population = -1): RegionContext {
  let p = 0, j = 0, w = 0;
  for (const n of neighbors) if (n.founded) { p += n.population; j += n.jobs; w += n.workers; }
  return {
    regionId: 'r', tileKey: 't', population: population >= 0 ? population : p, jobs: j, workers: w, neighbors,
    adjacentPopulation: p, adjacentJobs: j, adjacentWorkers: w, jobBonus: 0, workerBonus: 0,
  };
}

/**
 * Demand-only simulation with synthetic city totals (~100k local jobs → an R target of ~195k residents), so the
 * regional terms can be read in isolation.
 */
function demandCity(conn: Network | null, reg: RegionContext | null) {
  const st = createCityState(defaultCityConfig({ size: SIZE, seed: 5, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
  if (conn !== null) st.neighborConnections = [{ edge: 'n', x: 64, z: 0, type: conn }];
  if (reg) st.systemData.region = reg;
  const rt = new EconRuntime();
  const sim = new Simulation(st, [demandSystem(rt)]);
  const t = rt.totals;
  t.pop = [40000, 45000, 15000];
  t.population = 100000;
  t.jobCapAll[DevType.CS1] = 8000; t.jobCapAll[DevType.CS2] = 7000; t.jobCapAll[DevType.CS3] = 3000;
  t.jobCapAll[DevType.CO2] = 20000; t.jobCapAll[DevType.CO3] = 8000;
  t.jobCapAll[DevType.ID] = 20000; t.jobCapAll[DevType.IM] = 26000; t.jobCapAll[DevType.IHT] = 8000;
  t.resCapAll = [40000, 45000, 15000];
  st.stats.eq = 90;
  rt.capsDirty = true;
  sim.advanceDay();
  return { st, sim, rt, d: econData(st) };
}
const sumR = (st: CityState) => { const r = econData(st).rawTarget; return r[0] + r[1] + r[2]; };
const sumCS = (st: CityState) => { const r = econData(st).rawTarget; return r[3] + r[4] + r[5]; };
const sumCO = (st: CityState) => { const r = econData(st).rawTarget; return r[6] + r[7]; };
const sumI = (st: CityState) => { const r = econData(st).rawTarget; return r[9] + r[10] + r[11]; };

describe('regional demand (WP4-1)', () => {
  it('an isolated city gets bit-identical demand (no region, or only unfounded neighbours)', () => {
    const run = (withRegion: boolean) => {
      const c = makeCity({ size: 64 });
      road(c.A, 0, 31, 63, 31, Network.Avenue);
      for (let z = 4; z <= 58; z += 9) road(c.A, 4, z, 58, z);
      c.A.zone({ x0: 5, z0: 5, x1: 58, z1: 30 }, 1);
      c.A.zone({ x0: 5, z0: 32, x1: 58, z1: 58 }, 8);
      if (withRegion) c.st.systemData.region = region([neighbor({ founded: false, population: 0 }), neighbor({ edge: 's', tileKey: 's1', founded: false })], 0);
      c.sim.runDays(90);
      const d = econData(c.st);
      return { demand: c.st.stats.demand.slice(), target: d.target.slice(), raw: d.rawTarget.slice(), cap: c.st.stats.demandCap.slice(), terms: d.regionTerms };
    };
    const a = run(false), b = run(true);
    expect(b.demand).toEqual(a.demand);
    expect(b.target).toEqual(a.target);
    expect(b.raw).toEqual(a.raw);
    expect(b.cap).toEqual(a.cap);
    expect(b.terms).toBeUndefined();
  });

  it('edge factor: best connection on the shared segment, 0.1 without one', () => {
    const st = createCityState(defaultCityConfig({ size: SIZE, seed: 5, terrain: 'flat', treeDensity: 0, waterAmount: 0 }));
    const n = neighbor({ from: 0, to: 64 });
    expect(edgeFactor(st, n)).toBe(EDGE_NONE);
    st.neighborConnections = [{ edge: 'n', x: 80, z: 0, type: Network.Highway }]; // outside the segment
    expect(edgeFactor(st, n)).toBe(EDGE_NONE);
    st.neighborConnections.push({ edge: 'n', x: 20, z: 0, type: Network.Street }, { edge: 'n', x: 30, z: 0, type: Network.Avenue });
    expect(edgeFactor(st, n)).toBe(EDGE_CONN[Network.Avenue]);
    st.neighborConnections.push({ edge: 'w', x: 0, z: 30, type: Network.Highway }); // other edge
    expect(edgeFactor(st, n)).toBe(EDGE_CONN[Network.Avenue]);
    // e / w edges use z
    expect(edgeFactor(st, neighbor({ edge: 'w', from: 0, to: 64 }))).toBe(EDGE_CONN[Network.Highway]);
  });

  it('a neighbouring job centre raises R: ≥ 10 % by highway, ≤ 4 % by street, ≤ 2 % unconnected', () => {
    const jobCentre = () => region([neighbor({ population: 18000, jobs: 50000, workers: 10000 })]);
    const gain = (conn: Network | null) => {
      const base = demandCity(conn, null);
      const withN = demandCity(conn, jobCentre());
      return sumR(withN.st) / sumR(base.st) - 1;
    };
    const hw = gain(Network.Highway), street = gain(Network.Street), none = gain(null);
    console.log(`R gain from a 50k-job neighbour: highway ${(hw * 100).toFixed(1)}%, street ${(street * 100).toFixed(1)}%, none ${(none * 100).toFixed(1)}%`);
    expect(hw).toBeGreaterThanOrEqual(0.1);
    expect(street).toBeGreaterThan(0);
    expect(street).toBeLessThanOrEqual(0.04);
    expect(none).toBeGreaterThan(0);
    expect(none).toBeLessThanOrEqual(0.02);
  });

  it('a neighbouring bedroom town raises C / I; neighbour shoppers raise CS; a big region widens the industrial market', () => {
    const base = demandCity(Network.Highway, null);
    const bed = demandCity(Network.Highway, region([neighbor({ population: 50000, jobs: 2000, workers: 27500 })]));
    expect(sumCS(bed.st)).toBeGreaterThan(sumCS(base.st));
    expect(sumCO(bed.st)).toBeGreaterThan(sumCO(base.st));
    expect(sumI(bed.st)).toBeGreaterThan(sumI(base.st));
    // no job surplus next door: R unchanged
    expect(sumR(bed.st)).toBe(sumR(base.st));
    // caps relieved by the reachable neighbour population
    expect(bed.st.stats.demandCap[DevType.R1]).toBeGreaterThan(base.st.stats.demandCap[DevType.R1]);
    // a 2M region (far cities too) → industrial target × 1.25 (+ the bedroom term)
    const far = demandCity(Network.Highway, region([neighbor({ founded: false })], 2_000_000));
    expect(far.d.regionTerms!.market).toBeCloseTo(1.25, 6);
    expect(sumI(far.st) / sumI(base.st)).toBeCloseTo(1.25, 2);
    expect(sumR(far.st)).toBe(sumR(base.st));
  });

  it('the stored terms sum to the target deltas', () => {
    const reg = region([
      neighbor({ population: 60000, jobs: 45000, workers: 20000 }),
      neighbor({ edge: 'e', tileKey: 'e1', population: 80000, jobs: 5000, workers: 44000, from: 0, to: 128 }),
    ], 900000);
    const base = demandCity(Network.Highway, null);
    const w = demandCity(Network.Highway, reg);
    w.st.neighborConnections.push({ edge: 'e', x: 127, z: 40, type: Network.Road });
    w.rt.capsDirty = true;
    w.sim.advanceDay();
    base.st.neighborConnections.push({ edge: 'e', x: 127, z: 40, type: Network.Road });
    base.rt.capsDirty = true;
    base.sim.advanceDay();
    const T = econData(w.st).regionTerms!;
    const tol = 4; // rawTarget is rounded per DevType
    expect(Math.abs(T.R[0] + T.R[1] + T.R[2] - (sumR(w.st) - sumR(base.st)))).toBeLessThan(tol);
    expect(Math.abs(T.CS[0] + T.CS[1] + T.CS[2] - (sumCS(w.st) - sumCS(base.st)))).toBeLessThan(tol);
    expect(Math.abs(T.CO - (sumCO(w.st) - sumCO(base.st)))).toBeLessThan(tol);
    expect(Math.abs(T.I - (sumI(w.st) - sumI(base.st)))).toBeLessThan(tol);
    expect(T.R[0]).toBeGreaterThan(0);
    expect(T.CS[1]).toBeGreaterThan(0);
    expect(T.capR).toBeCloseTo((60000 * 1 + 80000 * EDGE_CONN[Network.Road]) * 0.1, 6);
    // inputs are exposed for the UI / advisors
    const inp = regionInputs(w.st)!;
    expect(inp.neighbors.map((n) => n.edgeF).sort()).toEqual([EDGE_CONN[Network.Road], EDGE_CONN[Network.Highway]].sort());
  });

  it('works with the real region model (regionEffects → demand)', () => {
    const { model } = createRegionData({ seed: 3, preset: 'greenvale' });
    const tile = model.data.tiles.find((t) => t.x > 0 && t.z > 0 && t.x + t.size < 16 && t.z + t.size < 16 && t.size === 2)!;
    const north = regionContext(model, tile).neighbors.find((n) => n.edge === 'n')!;
    model.tileByKey(north.tileKey)!.city = {
      name: 'Jobsville', mayor: 'M', population: 30000, r: 20000, c: 30000, i: 25000, funds: 0, lastPlayed: 0, founded: 0, difficulty: 'medium',
    };
    const c = makeCity({ size: 128 });
    road(c.A, north.from + 4, 0, north.from + 4, 60, Network.Highway);
    road(c.A, 0, 60, 127, 60, Network.Road);
    c.sim.runDays(5);
    const r0 = sumR(c.st);
    applyRegionEffects(c.st, regionContext(model, tile));
    c.sim.runDays(2);
    const d = econData(c.st);
    expect(d.regionTerms).toBeDefined();
    expect(d.regionTerms!.R[1]).toBeGreaterThan(1000);
    expect(sumR(c.st)).toBeGreaterThan(r0 + 1000);
  });
});
