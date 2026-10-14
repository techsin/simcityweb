/**
 * Final fixes F1 (traffic part): with region data, a founded neighbour's regional jobs (for our residents) and workers
 * (for our jobs) sit only at the neighbour connections on the edge segment that faces it — residents reach a
 * neighbour's jobs only by a road that leads there. The region at large (the default exchange) stays spread over every
 * connection as without region data, and a neighbour beyond an edge without a connection adds nothing at any of them.
 * (The economy side — sizing the neighbour's share from its connected surplus — is src/region/regionEffects.ts.)
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { Building, CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { TrafficSystem, type ConnectionReport } from '../../src/sim/infra/traffic';
import { CONNECTION_JOBS, CONNECTION_WORKERS, REGION_JOB_MIN, REGION_JOB_SHARE, REGION_WORKER_MIN, REGION_WORKER_SHARE } from '../../src/sim/infra/params';
import { applyRegionEffects, type RegionContext, type RegionNeighbor } from '../../src/region/regionEffects';
import { workerShare } from '../../src/sim/economy/demographics';
import { WORKFORCE_RATIO } from '../../src/sim/economy/tuning';
import { newState, place } from './cityGen';

const N = 64;

/** one founded neighbour along a whole edge (jobs / workers as the region layer reports them) */
function regionOf(edge: 'n' | 's' | 'e' | 'w', population: number, jobs: number): RegionContext {
  const workers = Math.round(population * WORKFORCE_RATIO);
  const n: RegionNeighbor = { edge, tileKey: 'nb', name: 'Neighbour', founded: true, population, jobs, workers, r: population, c: jobs / 2, i: jobs / 2, from: 0, to: N };
  return {
    regionId: 'r', tileKey: 't', population, jobs, workers, neighbors: [n], adjacentPopulation: population, adjacentJobs: jobs,
    adjacentWorkers: workers, jobBonus: 0, workerBonus: 0,
  };
}

/** 64² grid town (roads every 4 cells; an avenue row to the west and east edges = two neighbour connections; the north
 *  and south edges have none), homes + shops with `jobsPerWorker` job slots per resident worker; traffic only */
function town(region: RegionContext | null, jobsPerWorker = 0.6): { st: CityState; sim: Simulation; tr: TrafficSystem } {
  const st = newState(N);
  for (let z = 2; z <= N - 2; z++) for (let x = 2; x <= N - 2; x++) if ((x - 2) % 4 === 0 || (z - 2) % 4 === 0) st.network[z * N + x] = Network.Road;
  for (let x = 0; x < N; x++) st.network[30 * N + x] = Network.Avenue;
  st.neighborConnections = [{ edge: 'w', x: 0, z: 30, type: Network.Avenue }, { edge: 'e', x: N - 1, z: 30, type: Network.Avenue }];
  let rs = 17;
  const rnd = () => { rs = (Math.imul(rs, 1103515245) + 12345) >>> 0; return rs / 4294967296; };
  const homes: Building[] = [], sites: Building[] = [];
  for (let bz = 0; bz < 15; bz++) for (let bx = 0; bx < 15; bx++) {
    for (let dz = 1; dz <= 3; dz++) for (let dx = 1; dx <= 3; dx++) {
      if (dx === 2 && dz === 2) continue;
      const x = 2 + bx * 4 + dx, z = 2 + bz * 4 + dz;
      if (st.network[z * N + x] !== 0) continue;
      const rot = dz === 1 ? 2 : dz === 3 ? 0 : dx === 1 ? 3 : 1;
      if (rnd() < 0.7) homes.push(place(st, 't_r2', x, z, { pop: 50, capacity: 50, wealth: 2, rot }));
      else sites.push(place(st, 't_cs', x, z, { jobs: 0, capacity: 10, wealth: 2, rot }));
    }
  }
  const W = homes.reduce((s, b) => s + b.pop * workerShare(b), 0);
  for (const b of sites) b.capacity = (jobsPerWorker * W) / sites.length;
  st.stats.population = homes.reduce((s, b) => s + b.pop, 0);
  st.stats.workforce = Math.round(W);
  st.stats.jobCapByDev = [0, 0, 0, Math.round(jobsPerWorker * W), 0, 0, 0, 0, 0, 0, 0, 0];
  st.systemData.infraLayers = { utilities: false, pollution: false, services: false, traffic: true };
  if (region) applyRegionEffects(st, region);
  const tr = new TrafficSystem();
  const sim = new Simulation(st, [tr]);
  for (let k = 0; k < 6; k++) { tr.invalidate(); tr.runCycleSync(sim); }
  return { st, sim, tr };
}

const at = (r: ConnectionReport[], edge: string) => r.filter((c) => c.edge === edge);
const sum = (r: ConnectionReport[], f: (c: ConnectionReport) => number) => r.reduce((s, c) => s + f(c), 0);
/** residents matched to a job (all of the town's workers: local + regional) */
function employed(st: CityState, tr: TrafficSystem): number {
  let e = 0;
  for (const b of st.buildings.values()) if (b.def === 't_r2') e += b.pop * workerShare(b) * Math.max(0, tr.workerAccess(b.id));
  return e;
}

describe('final fixes F1: regional jobs and workers only at the connections facing a founded neighbour', () => {
  it('without region data the default exchange is spread over every connection by capacity (unchanged)', { timeout: 300000 }, () => {
    const { st, tr } = town(null);
    const rep = tr.connectionReport();
    expect(at(rep, 'w').length).toBe(1);
    expect(at(rep, 'e').length).toBe(1);
    // traffic's workers (Σ pop x workerShare) and job slots
    let W = 0, slots = 0;
    for (const b of st.buildings.values()) { if (b.def === 't_r2') W += b.pop * workerShare(b); else slots += b.capacity; }
    const growth = 1 + Math.min(3, st.stats.population / 250000);
    const cap = CONNECTION_JOBS[Network.Avenue] * growth, capW = CONNECTION_WORKERS[Network.Avenue] * growth;
    const jobs = REGION_JOB_SHARE * W + REGION_JOB_MIN, workers = REGION_WORKER_SHARE * slots + REGION_WORKER_MIN;
    for (const c of rep) {
      expect(c.jobs).toBeCloseTo(Math.min(cap, jobs / 2), 0);
      expect(c.workerCap).toBeCloseTo(Math.min(capW, workers / 2), 0);
    }
  });

  it('a connected job centre east: its jobs sit at the east connection only; the residents commute east', { timeout: 300000 }, () => {
    const base = town(null);
    // (a job surplus smaller than the town's unemployed workers: every one of those jobs finds a resident)
    const east = town(regionOf('e', 10000, 40000));
    const reg = east.st.systemData.region as RegionContext;
    const bonus = reg.neighbors[0].jobSlots ?? 0;
    expect(bonus).toBeGreaterThan(500);
    const r0 = base.tr.connectionReport(), r1 = east.tr.connectionReport();
    console.log(`job centre east: bonus ${bonus} jobs · slots W ${sum(at(r1, 'w'), (c) => c.jobs).toFixed(0)} E ${sum(at(r1, 'e'), (c) => c.jobs).toFixed(0)}`
      + ` (no region: ${sum(at(r0, 'w'), (c) => c.jobs).toFixed(0)} / ${sum(at(r0, 'e'), (c) => c.jobs).toFixed(0)})`
      + ` · employed there W ${sum(at(r1, 'w'), (c) => c.employed).toFixed(0)} E ${sum(at(r1, 'e'), (c) => c.employed).toFixed(0)}`
      + ` · unemployed ${(1 - employed(east.st, east.tr) / east.st.stats.workforce).toFixed(3)} vs ${(1 - employed(base.st, base.tr) / base.st.stats.workforce).toFixed(3)}`);
    // the west connection keeps the region at large's share only; the east one adds the neighbour's
    expect(sum(at(r1, 'w'), (c) => c.jobs)).toBeCloseTo(sum(at(r0, 'w'), (c) => c.jobs), -1);
    expect(sum(at(r1, 'e'), (c) => c.jobs) - sum(at(r0, 'e'), (c) => c.jobs)).toBeCloseTo(bonus, -1);
    expect(sum(at(r1, 'e'), (c) => c.employed)).toBeGreaterThan(sum(at(r1, 'w'), (c) => c.employed) + 0.5 * bonus);
    expect(employed(east.st, east.tr)).toBeGreaterThan(employed(base.st, base.tr) + 0.5 * bonus);
  });

  it('a job centre beyond the unconnected south edge adds jobs at no connection', { timeout: 300000 }, () => {
    const base = town(null);
    const south = town(regionOf('s', 60000, 260000));
    const reg = south.st.systemData.region as RegionContext;
    // (the economy still counts a tenth through an unconnected edge — EDGE_NONE — but no road leads there)
    expect(reg.neighbors[0].jobSlots ?? 0).toBeGreaterThan(0);
    const r0 = base.tr.connectionReport(), r1 = south.tr.connectionReport();
    for (const edge of ['w', 'e']) expect(sum(at(r1, edge), (c) => c.jobs)).toBeCloseTo(sum(at(r0, edge), (c) => c.jobs), -1);
    expect(Math.abs(employed(south.st, south.tr) - employed(base.st, base.tr))).toBeLessThan(0.01 * base.st.stats.workforce);
  });

  it('a bedroom town west sends its workers through the west connection only', { timeout: 300000 }, () => {
    // (a town with more jobs than workers: vacancies for regional workers)
    const base = town(null, 1.6);
    const west = town(regionOf('w', 300000, 20000), 1.6);
    const reg = west.st.systemData.region as RegionContext;
    const extra = reg.neighbors[0].workerSlots ?? 0;
    expect(extra).toBeGreaterThan(500);
    const r0 = base.tr.connectionReport(), r1 = west.tr.connectionReport();
    console.log(`bedroom town west: +${extra} workers · cap W ${sum(at(r1, 'w'), (c) => c.workerCap).toFixed(0)} E ${sum(at(r1, 'e'), (c) => c.workerCap).toFixed(0)}`
      + ` (no region ${sum(at(r0, 'w'), (c) => c.workerCap).toFixed(0)} / ${sum(at(r0, 'e'), (c) => c.workerCap).toFixed(0)})`
      + ` · came in W ${sum(at(r1, 'w'), (c) => c.inbound).toFixed(0)} E ${sum(at(r1, 'e'), (c) => c.inbound).toFixed(0)}`);
    expect(sum(at(r1, 'e'), (c) => c.workerCap)).toBeCloseTo(sum(at(r0, 'e'), (c) => c.workerCap), -1);
    expect(sum(at(r1, 'w'), (c) => c.workerCap) - sum(at(r0, 'w'), (c) => c.workerCap)).toBeCloseTo(extra, -1);
    expect(sum(at(r1, 'w'), (c) => c.inbound)).toBeGreaterThan(sum(at(r1, 'e'), (c) => c.inbound));
  });
});
