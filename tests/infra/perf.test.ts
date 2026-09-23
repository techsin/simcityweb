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
  it('per-system and per-phase timings', () => {
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
    const phaseMin = new Float64Array(8).fill(Infinity);
    let cycleMin = Infinity;
    for (let k = 0; k < R; k++) {
      tr.invalidate();
      tr.runCycleSync(sim);
      for (let p = 0; p < 8; p++) phaseMin[p] = Math.min(phaseMin[p], tr.phaseMs[p]);
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
    // steady-state days (headless: 1 traffic phase per day + staggered systems)
    const dayMs: number[] = [];
    for (let d = 0; d < 64; d++) { const a = performance.now(); sim.advanceDay(); dayMs.push(performance.now() - a); }
    dayMs.sort((a, b) => a - b);
    const s = city.st.stats;
    console.log(`stress city: roads=${city.roadCells} buildings=${city.buildings} pop=${city.pop} jobs=${city.jobs} gen=${tGen.toFixed(0)}ms init(all systems, cold)=${tInit.toFixed(0)}ms`);
    console.log(`traffic phases min ms [prep, commute, transit, mode, inbound, shop, freight, final]: ${Array.from(phaseMin).map((t) => t.toFixed(2)).join(' / ')}  full cycle min ${cycleMin.toFixed(1)} ms`);
    console.log(`systems min ms: ${Object.entries(sys).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ')}  pollution stageA=${polA.toFixed(2)} stageB=${polB.toFixed(2)} fire.daily=${fireDaily.toFixed(2)}`);
    console.log(`advanceDay ms: median ${dayMs[32].toFixed(2)} p90 ${dayMs[57].toFixed(2)} max ${dayMs[63].toFixed(2)}`);
    console.log(`stats: commute=${s.avgCommute.toFixed(1)}min traffic=${s.avgTraffic.toFixed(2)} car=${s.tripsCar} transit=${s.tripsTransit} walk=${s.tripsWalk} powerDemand=${s.powerDemand.toFixed(0)}MW water=${s.waterDemand.toFixed(0)}kL garbage=${s.garbageProduced.toFixed(0)}t pollution=${s.avgPollution.toFixed(2)} crime=${s.avgCrime.toFixed(2)} eq=${s.eq.toFixed(0)} hq=${s.hq.toFixed(0)}`);
    expect(city.buildings).toBeGreaterThan(15000);
    expect(cycleMin).toBeLessThan(400); // loose: target < 30 ms on a normal machine
    expect(Math.max(...phaseMin)).toBeLessThan(100);
  });

  it('road search on a fully paved 256x256 grid (65,536 nodes)', () => {
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
