/**
 * WP1-1 one employment ledger: businesses post b.hire x capacity slots, traffic matches pop x wf workers against them,
 * b.jobs = the workers who arrive, and stats.unemployment = 1 - (sum pop x wf x workerAccess) / workforce — so the
 * unemployment stat, traffic's access and the filled jobs agree (docs/SIM_DEPTH_SPEC.md amendments WP1-1).
 */
import { describe, expect, it } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import type { Building, CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { Simulation } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { populationSystem } from '../../src/sim/economy/population';
import { workerShare } from '../../src/sim/economy/demographics';
import { TrafficSystem } from '../../src/sim/infra/traffic';
import { newState, place } from '../infra/cityGen';

interface TownOpts {
  /** job slots per resident worker (sum pop x wf) */
  jobsPerWorker: number;
  /** an avenue row reaching the west / east map edges (neighbour connections = regional jobs + inbound workers) */
  connections: boolean;
  /** state.systemData.regionJobs (region layer bonus) */
  regionJobs?: number;
}

/** 64² grid town (roads every 4 cells), homes + offices; traffic + the population system only (always powered) */
function town(o: TownOpts) {
  const N = 64;
  const st = newState(N);
  for (let z = 2; z <= N - 2; z++) for (let x = 2; x <= N - 2; x++) {
    if ((x - 2) % 4 === 0 || (z - 2) % 4 === 0) st.network[z * N + x] = Network.Road;
  }
  if (o.connections) for (let x = 0; x < N; x++) st.network[30 * N + x] = Network.Avenue;
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
  if (o.regionJobs !== undefined) st.systemData.regionJobs = o.regionJobs;
  const rt = new EconRuntime();
  const traffic = new TrafficSystem();
  const sim = new Simulation(st, [traffic, populationSystem(rt)]);
  // one occupancy round seeds the demographics (b.wf), then size the job sites to the actual workforce
  sim.runDays(4);
  const W = homes.reduce((s, b) => s + b.pop * workerShare(b), 0);
  for (const b of sites) b.capacity = (o.jobsPerWorker * W) / sites.length;
  for (let k = 0; k < 6; k++) { traffic.invalidate(); traffic.runCycleSync(sim); sim.runDays(8); }
  return { st, sim, rt, traffic, homes, sites, W };
}

function ledger(t: ReturnType<typeof town>) {
  const { st, traffic, homes, sites } = t;
  let W = 0, matched = 0;
  for (const b of homes) {
    if (b.pop <= 0) continue;
    const w = b.pop * workerShare(b);
    W += w;
    matched += w * Math.max(0, Math.min(1, traffic.workerAccess(b.id)));
  }
  const jobs = sites.reduce((s, b) => s + b.jobs, 0);
  const arriving = sites.reduce((s, b) => s + (traffic.routeInfo(b.id)?.jobsReached ?? 0), 0);
  return { W, matched, accUnemp: 1 - matched / W, jobs, arriving, unemp: st.stats.unemployment };
}

describe('one employment ledger (WP1-1)', () => {
  it('unemployment = 1 - matched workers / workforce; filled jobs = arriving workers', { timeout: 120000 }, () => {
    const t = town({ jobsPerWorker: 0.8, connections: false });
    const l = ledger(t);
    console.log(`surplus workers: W ${l.W.toFixed(0)} (stats ${t.st.stats.workforce}) matched ${l.matched.toFixed(0)} unemployment ${(l.unemp * 100).toFixed(1)}% vs traffic ${(l.accUnemp * 100).toFixed(1)}%, jobs ${l.jobs} arriving ${l.arriving} inbound ${t.traffic.inboundTotal.toFixed(0)}`);
    expect(Math.abs(t.st.stats.workforce - l.W)).toBeLessThan(l.W * 0.01);
    expect(Math.abs(l.unemp - l.accUnemp)).toBeLessThan(0.01);
    // no connections: every filled job is held by a local worker
    expect(t.traffic.inboundTotal).toBe(0);
    expect(Math.abs(l.jobs - l.matched)).toBeLessThan(l.matched * 0.03);
    expect(Math.abs(l.jobs - l.arriving)).toBeLessThan(l.arriving * 0.03);
    // businesses post their hiring factor (healthy, full demand -> 1) and traffic sees exactly those slots
    for (const b of t.sites) expect(b.hire).toBeCloseTo(1, 5);
    expect(t.rt.accessAvg).toBeGreaterThan(0);
  });

  it('with neighbour connections the ledger includes inbound workers and regional jobs', { timeout: 120000 }, () => {
    const t = town({ jobsPerWorker: 1.1, connections: true });
    const l = ledger(t);
    console.log(`connected: unemployment ${(l.unemp * 100).toFixed(1)}% vs traffic ${(l.accUnemp * 100).toFixed(1)}%, jobs ${l.jobs} arriving ${l.arriving} (inbound ${t.traffic.inboundTotal.toFixed(0)})`);
    expect(Math.abs(l.unemp - l.accUnemp)).toBeLessThan(0.01);
    expect(Math.abs(l.jobs - l.arriving)).toBeLessThan(l.arriving * 0.03);
  });

  it('2x job capacity -> unemployment < 3 %; jobs = 0.5 x workers without connections -> 45-55 %', { timeout: 120000 }, () => {
    const rich = town({ jobsPerWorker: 2, connections: false });
    const poor = town({ jobsPerWorker: 0.5, connections: false });
    console.log(`unemployment: 2x jobs ${(rich.st.stats.unemployment * 100).toFixed(1)}%, 0.5x jobs ${(poor.st.stats.unemployment * 100).toFixed(1)}%`);
    expect(rich.st.stats.unemployment).toBeLessThan(0.03);
    expect(poor.st.stats.unemployment).toBeGreaterThan(0.45);
    expect(poor.st.stats.unemployment).toBeLessThan(0.55);
    // shops without customers (negative demand) hire less -> fewer slots posted -> fewer workers matched
    poor.st.stats.demand[DevType.CS2] = -1;
    const before = poor.st.stats.unemployment;
    for (let k = 0; k < 4; k++) { poor.traffic.invalidate(); poor.traffic.runCycleSync(poor.sim); poor.sim.runDays(8); }
    const hire = poor.sites.reduce((s, b) => s + (b.hire ?? 1), 0) / poor.sites.length;
    console.log(`under-hiring: hire ${hire.toFixed(2)}, unemployment ${(before * 100).toFixed(1)}% -> ${(poor.st.stats.unemployment * 100).toFixed(1)}%`);
    expect(hire).toBeLessThan(0.8);
    expect(poor.st.stats.unemployment).toBeGreaterThan(before + 0.08);
  });

  it('a region job bonus (systemData.regionJobs) lowers unemployment', { timeout: 120000 }, () => {
    const base = town({ jobsPerWorker: 0.6, connections: true });
    const bonus = town({ jobsPerWorker: 0.6, connections: true, regionJobs: 20000 });
    console.log(`region jobs: default ${(base.st.stats.unemployment * 100).toFixed(1)}%, with bonus ${(bonus.st.stats.unemployment * 100).toFixed(1)}%`);
    expect(bonus.st.stats.unemployment).toBeLessThan(base.st.stats.unemployment - 0.02);
  });

  it('without traffic: the analytic model uses systemData.regionJobs', () => {
    const run = (regionJobs?: number) => {
      const st: CityState = newState(32);
      for (let x = 0; x < 32; x++) st.network[10 * 32 + x] = Network.Road;
      for (let x = 2; x < 30; x++) place(st, 't_r2', x, 11, { pop: 50, capacity: 50, wealth: 2, rot: 2 });
      for (let x = 2; x < 12; x++) place(st, 't_cs', x, 9, { jobs: 0, capacity: 20, rot: 0 });
      for (let d = 0; d <= DevType.IHT; d++) st.desirability[d].fill(1);
      if (regionJobs !== undefined) st.systemData.regionJobs = regionJobs;
      const sim = new Simulation(st, [populationSystem(new EconRuntime())]);
      sim.runDays(40);
      return st.stats.unemployment;
    };
    const a = run(), b = run(600);
    console.log(`no traffic: unemployment ${(a * 100).toFixed(1)}% -> with region jobs ${(b * 100).toFixed(1)}%`);
    expect(b).toBeLessThan(a - 0.05);
    void getDef;
  });
});
