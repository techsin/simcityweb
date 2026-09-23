/**
 * Job matching quality in a well-connected grid city with short commutes (sim-core balance-run scenario):
 * surplus workers -> job sites fill up; surplus jobs -> workers all find jobs and sites fill ~proportionally.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { CityState } from '../../src/sim/CityState';
import { getTraffic } from '../../src/sim/systems/infra';
import { newSim, newState, place } from './cityGen';

/** 128² grid, roads every 4 cells (avenues every 16), 3x3 blocks; homes and job sites mixed (CBD-ish centre) */
function gridCity(jobsPerWorker: number): { st: CityState; workers: number; slots: number } {
  const N = 128;
  const st = newState(N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if (x % 4 === 0 || z % 4 === 0) st.network[z * N + x] = x % 16 === 0 || z % 16 === 0 ? Network.Avenue : Network.Road;
  }
  let workers = 0, slots = 0;
  let rs = 99;
  const rnd = () => { rs = (Math.imul(rs, 1103515245) + 12345) >>> 0; return rs / 4294967296; };
  const homes: [number, number][] = [], jobs: [number, number][] = [];
  for (let bz = 0; bz < N / 4; bz++) for (let bx = 0; bx < N / 4; bx++) {
    const dc = Math.hypot(bx - 16, bz - 16) / 16;
    const cells: [number, number][] = [];
    // block centre (2,2) has no road frontage -> left empty (growables need road access)
    for (let dz = 1; dz <= 3; dz++) for (let dx = 1; dx <= 3; dx++) if (dx !== 2 || dz !== 2) cells.push([bx * 4 + dx, bz * 4 + dz]);
    for (const c of cells) (rnd() < 0.25 + 0.35 * (1 - dc) ? jobs : homes).push(c);
  }
  for (const [x, z] of homes) { place(st, 't_r2', x, z, { pop: 50, wealth: 2 }); workers += 50 * 0.55; }
  // job capacity per site so that total slots = jobsPerWorker * workers
  const per = (jobsPerWorker * workers) / jobs.length;
  for (const [x, z] of jobs) { const b = place(st, 't_cs', x, z, { jobs: 0 }); b.capacity = per; slots += per; }
  st.stats.population = homes.length * 50;
  return { st, workers, slots };
}

function report(st: CityState, tr: ReturnType<typeof getTraffic> & object) {
  const homes = [...st.buildings.values()].filter((b) => b.def === 't_r2');
  const sites = [...st.buildings.values()].filter((b) => b.def === 't_cs');
  const acc = homes.reduce((s, b) => s + tr.workerAccess(b.id), 0) / homes.length;
  const fills = sites.map((b) => tr.jobFill(b.id));
  const mean = fills.reduce((a, b) => a + b, 0) / fills.length;
  const hist = [0, 0, 0, 0, 0];
  for (const f of fills) hist[Math.min(4, Math.floor(f * 5))]++;
  return { acc, mean, hist, fills, sites: sites.length };
}

describe('capacity-constrained job matching', () => {
  it('surplus workers: job sites fill up, access ~ jobs / workers', { timeout: 120000 }, () => {
    const { st, workers, slots } = gridCity(0.75);
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    for (let k = 0; k < 8; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    const r = report(st, tr);
    console.log(`surplus workers: workers=${workers.toFixed(0)} slots=${slots.toFixed(0)} access=${r.acc.toFixed(2)} fill mean=${r.mean.toFixed(2)} hist(0-.2..0.8-1)=${r.hist.join(',')} commute=${st.stats.avgCommute.toFixed(1)}`);
    expect(r.mean).toBeGreaterThan(0.9);
    expect(r.hist[4]).toBeGreaterThan(r.sites * 0.85);
    expect(r.acc).toBeGreaterThan(0.7);
  });

  it('surplus jobs: workers all matched, sites fill proportionally', { timeout: 120000 }, () => {
    const { st, workers, slots } = gridCity(1.4);
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    for (let k = 0; k < 8; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    const r = report(st, tr);
    console.log(`surplus jobs: workers=${workers.toFixed(0)} slots=${slots.toFixed(0)} access=${r.acc.toFixed(2)} fill mean=${r.mean.toFixed(2)} hist=${r.hist.join(',')} commute=${st.stats.avgCommute.toFixed(1)}`);
    expect(r.acc).toBeGreaterThan(0.9);
    // most sites between 50 % and 90 % (proportional share ~ 1/1.4 = 0.71)
    const mid = r.fills.filter((f) => f > 0.5 && f < 0.95).length;
    expect(mid).toBeGreaterThan(r.sites * 0.7);
  });
});
