/**
 * Final fixes F1 (economy part): region mode sizes the regional jobs / workers from what the demand model reads — a
 * founded neighbour's job SURPLUS (jobs its own workers leave open) × how well the shared edge is connected
 * (src/region/regionEffects.ts applyRegionEffects, src/sim/economy/regionLink.ts). A bedroom town next door, or a
 * neighbour beyond an edge without a road, no longer removes the city's unemployment; a connected job centre does
 * lower it. (Placing the regional job slots only on the connections that face the neighbour is traffic's part.)
 */
import { describe, expect, it } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import type { Building } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { populationSystem } from '../../src/sim/economy/population';
import { workerShare } from '../../src/sim/economy/demographics';
import { TrafficSystem } from '../../src/sim/infra/traffic';
import { applyRegionEffects, type RegionContext, type RegionNeighbor } from '../../src/region/regionEffects';
import { WORKFORCE_RATIO } from '../../src/sim/economy/tuning';
import { newState, place } from '../infra/cityGen';

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

/** 64² grid town (roads every 4 cells, an avenue row to the west / east edges = two neighbour connections), homes +
 *  shops with 0.6 job slots per resident worker: traffic + the population system only (always powered) */
function town(region: RegionContext | null) {
  const st = newState(N);
  for (let z = 2; z <= N - 2; z++) for (let x = 2; x <= N - 2; x++) {
    if ((x - 2) % 4 === 0 || (z - 2) % 4 === 0) st.network[z * N + x] = Network.Road;
  }
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
  for (const b of homes) st.zone[st.idx(b.x, b.z)] = Zone.ResMed;
  for (const b of sites) st.zone[st.idx(b.x, b.z)] = Zone.ComMed;
  for (let d = 0; d <= DevType.IHT; d++) st.desirability[d].fill(1);
  st.systemData.infraLayers = { utilities: false, pollution: false, services: false, traffic: true };
  const rt = new EconRuntime();
  const traffic = new TrafficSystem();
  const sim = new Simulation(st, [traffic, populationSystem(rt)]);
  sim.runDays(4);
  const W = homes.reduce((s, b) => s + b.pop * workerShare(b), 0);
  for (const b of sites) b.capacity = (0.6 * W) / sites.length;
  // the region layer writes its numbers on entry and every month (here: every cycle, the workforce settles first)
  for (let k = 0; k < 6; k++) {
    if (region) applyRegionEffects(st, region);
    traffic.invalidate(); traffic.runCycleSync(sim); sim.runDays(8);
  }
  return st;
}

describe('final fixes F1: regional jobs come from a connected neighbour job surplus', () => {
  it('a bedroom town or an unconnected edge leaves unemployment where it is; a connected job centre lowers it', { timeout: 300000 }, () => {
    const none = town(null).stats.unemployment;
    // a bedroom town (300k residents, 40k jobs) on the north edge, which has no road: no job surplus to offer
    const bedroom = town(regionOf('n', 300000, 40000)).stats.unemployment;
    // ... and on the connected west edge: still no surplus
    const bedroomW = town(regionOf('w', 300000, 40000)).stats.unemployment;
    // a job centre (60k residents, 260k jobs) beyond the unconnected north edge vs on the connected west edge
    const jobsN = town(regionOf('n', 60000, 260000));
    const jobsW = town(regionOf('w', 60000, 260000));
    console.log(`unemployment: no neighbour ${(none * 100).toFixed(1)}% · bedroom town north ${(bedroom * 100).toFixed(1)}% / west ${(bedroomW * 100).toFixed(1)}%`
      + ` · job centre north (no road) ${(jobsN.stats.unemployment * 100).toFixed(1)}% (regionJobs ${jobsN.systemData.regionJobs})`
      + ` / west (avenue) ${(jobsW.stats.unemployment * 100).toFixed(1)}% (regionJobs ${jobsW.systemData.regionJobs})`);
    expect(none).toBeGreaterThan(0.1);
    expect(Math.abs(bedroom - none)).toBeLessThan(0.01);
    expect(Math.abs(bedroomW - none)).toBeLessThan(0.01);
    // the connected job centre gives 7x the regional jobs of the unconnected one (EDGE_CONN avenue .7 vs EDGE_NONE .1)
    const bonus = (st: typeof jobsN) => (st.systemData.region as RegionContext).jobBonus;
    expect(bonus(jobsN)).toBeGreaterThan(0);
    expect(bonus(jobsW) / bonus(jobsN)).toBeCloseTo(7, 1);
    expect(jobsW.stats.unemployment).toBeLessThan(none - 0.03);
    expect(jobsW.stats.unemployment).toBeLessThan(jobsN.stats.unemployment - 0.02);
  });
});
