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
    // (B2 fix round: and every task's passes — a step after which its system is idle ends a pass — for the cadence check)
    const passes = new Map<string, number>();
    const sysOf = (n: string) => sim.getSystem(n === 'emergency.response' ? 'emergency' : n) as unknown as { phase?: number; stepIdx?: number; respStep?: number };
    for (const t of sch.tasks) {
      const cost = t.cost.bind(t), step = t.step.bind(t), sys = sysOf(t.name);
      t.cost = (s2) => { const c = cost(s2); if (c > (maxEst.get(t.name) ?? 0)) maxEst.set(t.name, c); return c; };
      passes.set(t.name, 0);
      t.step = (s2) => { step(s2); if ((sys.phase ?? sys.stepIdx ?? sys.respStep ?? 0) < 0) passes.set(t.name, passes.get(t.name)! + 1); };
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
    // P0-8 step budget: estimated cost <= 3.0 per step, every task (WP3 split pollution / crime, WP7b traffic's transit
    // step; WP6b dropped the last per-task exception)
    for (const [name, c] of maxEst) expect(c, `estimated step cost of ${name}`).toBeLessThanOrEqual(3.0);
    // B2 (docs/dev/B2_DESIGN.md §11.5): every traffic piece is estimated within about one INFRA_PIECE_MS (the other tasks
    // follow in their groups)
    expect(maxEst.get('traffic') ?? 0, 'estimated piece cost of traffic').toBeLessThanOrEqual(1.0);
    // (G2: every services piece too — the tier steps at ~INFRA_PIECE_MS, every other loop at half INFRA_PIECE_COLD_MS;
    // traffic's attachment refresh, when pending, runs in a services piece of its own)
    expect(maxEst.get('services') ?? 0, 'estimated piece cost of services').toBeLessThanOrEqual(1.0);
    // (G3: every crime and pollution piece too — half INFRA_PIECE_COLD_MS with the cold cell and Building floors; the
    // snapshot take and traffic's pending attachment refresh, in pollution pieces of their own, are the largest)
    expect(maxEst.get('crime') ?? 0, 'estimated piece cost of crime').toBeLessThanOrEqual(1.0);
    expect(maxEst.get('pollution') ?? 0, 'estimated piece cost of pollution').toBeLessThanOrEqual(1.0);
    // (G4: every utilities piece too — half INFRA_PIECE_COLD_MS with the cold floors; the snapshot take is the largest)
    expect(maxEst.get('utilities') ?? 0, 'estimated piece cost of utilities').toBeLessThanOrEqual(1.0);
    // P0-15 utilisation of the headless budget (deterministic: estimated costs). Lead decision (ROUTED_ITEMS #30): <= 0.89
    // until the million-population performance phase, which owns the scheduler budget. B2 G1 re-baselines it (design §9.4
    // item 5): traffic's pieces (~0.13-0.3 estimated ms) fill a day's budget to within one piece, and traffic is due every
    // day on this city (a cycle spans several days), so the share of the budget used no longer measures headroom (base
    // 41ae570: 0.869 with 2-3 ms steps; G1: 0.961). The per-task cadence (G4's table) is the headroom check instead.
    // G3: with crime's and pollution's pieces too (~0.01-0.13 estimated ms) a day is filled to within a few hundredths of
    // a ms: 0.985 (G2: 0.98). G4 (the step guard 256 -> 4096, which no longer ends a day of small utilities pieces
    // before its budget is spent): 0.996 at the budget 5.3, 0.994 at the final 4.6 — every day is spent to within one
    // piece, so the bound only
    // guards against the budget being overrun (urgent work beyond it), not headroom (the cadence table, §18, is that).
    expect(util, 'stress-city scheduler utilisation').toBeLessThanOrEqual(1.02);
    // P0-15's headroom, B2 fix round (the verify reviews: the bound above no longer measures it): the cadence. Over these
    // 180 days every task finishes at least as many passes as the base (41ae570, before B2) did on this same code path —
    // b2work/fix1/cadence.ts in both trees: utilities 22, traffic 4, pollution 7, services 10, crime 9 (B2 at the fix
    // round: 30, 4, 15, 11, 9). Deterministic: the headless schedule follows the estimates. (dense1m's traffic runs 10
    // cycles per 360 days instead of B's 13, design §18.5; this city's traffic keeps B's cadence.)
    console.log(`passes in ${D} days: ${[...passes].map(([k, v]) => `${k}=${v}`).join(' ')}`);
    const BASE_PASSES: Record<string, number> = { utilities: 22, traffic: 4, pollution: 7, services: 10, crime: 9 };
    for (const [name, n] of Object.entries(BASE_PASSES)) expect(passes.get(name) ?? 0, `passes of ${name} in ${D} days (base ${n})`).toBeGreaterThanOrEqual(n);
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
