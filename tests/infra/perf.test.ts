/**
 * Performance on the synthetic 256x256 stress city (~36k road cells, ~19.5k buildings, ~650k residents).
 * Reports min-of-N timings (the test machine may be shared/noisy); assertions are deliberately loose.
 * Run: npx vitest run tests/infra/perf.test.ts --reporter=verbose --silent=false
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { RoadGraph } from '../../src/sim/infra/graph';
import { MinHeap } from '../../src/sim/infra/heap';
import { Search, Seeds, roadSearch } from '../../src/sim/infra/search';
import { resetSchedulerStats, schedulerOf, schedulerUtilisation } from '../../src/sim/infra/scheduler';
import { INFRA_DAY_BUDGET } from '../../src/sim/infra/params';
import { getTraffic } from '../../src/sim/systems/infra';
import { newSim, newState, stressCity } from './cityGen';

function minOf(n: number, fn: () => void): number {
  let best = Infinity;
  for (let k = 0; k < n; k++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

describe('infra perf (256x256 stress city)', () => {
  it('per-system and per-phase timings', { timeout: 240000 }, () => {
    const t0 = performance.now();
    const city = stressCity(256);
    const tGen = performance.now() - t0;
    const t1 = performance.now();
    const sim = newSim(city.st);
    const tInit = performance.now() - t1;
    const tr = getTraffic(sim)!;
    // warm up
    for (let k = 0; k < 6; k++) { tr.invalidate(); tr.runCycleSync(sim); }
    const R = 8;
    const P = tr.phaseMs.length;
    const phaseMin = new Float64Array(P).fill(Infinity);
    let cycleMin = Infinity;
    for (let k = 0; k < R; k++) {
      tr.invalidate();
      tr.runCycleSync(sim);
      for (let p = 0; p < P; p++) phaseMin[p] = Math.min(phaseMin[p], tr.phaseMs[p]);
      cycleMin = Math.min(cycleMin, tr.lastCycleMs);
    }
    const sys: Record<string, number> = {};
    for (const s of sim.systems as unknown as { name: string; compute?: (sim: unknown, first: boolean) => void }[]) {
      if (!s.compute) continue;
      s.compute(sim, false);
      sys[s.name] = minOf(R, () => s.compute!(sim, false));
    }
    const pol = sim.getSystem('pollution') as unknown as { stageA(s: unknown, f: boolean): void; stageB(s: unknown, f: boolean): void };
    const polA = minOf(R, () => pol.stageA(sim, false));
    const polB = minOf(R, () => pol.stageB(sim, false));
    const fire = sim.getSystem('fire')!;
    const fireDaily = minOf(R, () => fire.daily!(sim));
    // steady-state days (headless: the shared InfraScheduler spends ~INFRA_DAY_BUDGET estimated ms per day)
    const sch = schedulerOf(sim);
    for (let d = 0; d < 240; d++) sim.advanceDay(); // JIT warm-up of the interleaved (scheduled) code paths
    sch.spentMs.clear();
    resetSchedulerStats(sch);
    // P0-8: record every task's largest estimated step cost (deterministic) over the measured days
    const maxEst = new Map<string, number>();
    for (const t of sch.tasks) {
      const cost = t.cost.bind(t);
      t.cost = (s2) => { const c = cost(s2); if (c > (maxEst.get(t.name) ?? 0)) maxEst.set(t.name, c); return c; };
    }
    const dayMs: number[] = [];
    const D = 180;
    const cyc0 = tr.cycles;
    for (let d = 0; d < D; d++) { const a = performance.now(); sim.advanceDay(); dayMs.push(performance.now() - a); }
    dayMs.sort((a, b) => a - b);
    const q = (f: number) => dayMs[Math.min(D - 1, Math.floor(D * f))].toFixed(2);
    const s = city.st.stats;
    console.log(`stress city: roads=${city.roadCells} buildings=${city.buildings} pop=${city.pop} jobs=${city.jobs} gen=${tGen.toFixed(0)}ms init(all systems, cold)=${tInit.toFixed(0)}ms`);
    const names = ['prep', 'prepTransit', 'transit', 'roundSearch*', 'roundMatch*', 'commute', 'inbound', 'shop', 'freight', 'final', 'final2'];
    console.log(`traffic phases min ms (* = summed over matching rounds): ${Array.from(phaseMin).map((t, p) => `${names[p] ?? p}=${t.toFixed(2)}`).join(' ')}  full cycle min ${cycleMin.toFixed(1)} ms`);
    console.log(`systems min ms: ${Object.entries(sys).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ')}  pollution stageA=${polA.toFixed(2)} stageB=${polB.toFixed(2)} fire.daily=${fireDaily.toFixed(2)}`);
    console.log(`advanceDay ms over ${D} days: median ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${dayMs[D - 1].toFixed(2)}  traffic cycles ${tr.cycles - cyc0}  per task ms/day: ${[...sch.spentMs].map(([k, v]) => `${k}=${(v / D).toFixed(2)}`).join(' ')}`);
    console.log(`stats: commute=${s.avgCommute.toFixed(1)}min traffic=${s.avgTraffic.toFixed(2)} car=${s.tripsCar} transit=${s.tripsTransit} walk=${s.tripsWalk} powerDemand=${s.powerDemand.toFixed(0)}MW water=${s.waterDemand.toFixed(0)}kL garbage=${s.garbageProduced.toFixed(0)}t pollution=${s.avgPollution.toFixed(2)} crime=${s.avgCrime.toFixed(2)} eq=${s.eq.toFixed(0)} hq=${s.hq.toFixed(0)}`);
    const util = schedulerUtilisation(sch);
    console.log(`scheduler (P0-8/P0-15): utilisation ${(util * 100).toFixed(1)}% of INFRA_DAY_BUDGET ${INFRA_DAY_BUDGET} · max est. step ${[...maxEst].map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ')} · max measured step ms ${[...sch.maxStepMs].map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ')} · est ms/day ${[...sch.estMs].map(([k, v]) => `${k}=${(v / D).toFixed(2)}`).join(' ')}`);
    // P0-8 step budget: estimated cost <= 3.0 per step. Pre-existing oversized steps are capped at their Phase 0 values
    // (regression guard) — their owners lower the cap to 3.0 when they split the step (pollution / crime: WP3).
    const EST_CAP: Record<string, number> = { pollution: 4.6, traffic: 3.25, crime: 3.25 };
    for (const [name, c] of maxEst) expect(c, `estimated step cost of ${name}`).toBeLessThanOrEqual(EST_CAP[name] ?? 3.0);
    // measured max per step <= 6 ms (CI slack); wall-clock on shared machines spikes (GC / load), so strict mode only
    if (process.env.PERF_STRICT) for (const [name, ms] of sch.maxStepMs) expect(ms, `measured step ms of ${name}`).toBeLessThanOrEqual(6);
    expect(city.buildings).toBeGreaterThan(15000);
    expect(cycleMin).toBeLessThan(400); // loose: target < 30 ms on a normal machine
    expect(Math.max(...phaseMin)).toBeLessThan(100);
  });

  it('road search on a fully paved 256x256 grid (65,536 nodes)', { timeout: 60000 }, () => {
    const st = newState(256);
    for (let i = 0; i < st.cells; i++) st.network[i] = (i % 7 === 0 ? Network.Avenue : Network.Road);
    const g = new RoadGraph();
    const tb = minOf(3, () => g.build(st));
    const time = new Float32Array(g.n);
    for (let v = 0; v < g.n; v++) time[v] = g.t0[v];
    const S = new Search(), heap = new MinHeap(), seeds = new Seeds();
    for (let k = 0; k < 2000; k++) seeds.push((k * 7919) % g.n, 0, k);
    const ts = minOf(5, () => roadSearch(g, g.rev, time, S, heap, seeds, 400));
    console.log(`full grid: nodes=${g.n} build=${tb.toFixed(2)}ms multi-source search (2000 seeds)=${ts.toFixed(2)}ms settled=${S.settled}`);
    expect(S.settled).toBe(g.n);
  });
});
