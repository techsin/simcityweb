/**
 * B2 (docs/dev/B2_DESIGN.md §11): whole-pass exactness of the split infra steps — one go against many small steps.
 *  core      the resumable kernels against their whole-call originals (road / transit searches, accumulate, the graph
 *            builds, the stop collector, the box filters, the parking passes, SearchK's car-leg refresh), the pass
 *            snapshot's chunk plan, pieceUnits, the scheduler's urgent budget
 *  traffic   (G1) cycles run in one go (scale 1e9), at the production piece size and in tiny / random pieces give
 *            identical cities and traffic fields at every cycle end, across network and building edits; cross-system
 *            queries between every two pieces change nothing (R8); every external output changes at most once per
 *            cycle (R7 / R4); a save taken mid-cycle holds no cycle state and loads idle (R9); two cities stepped
 *            interleaved equal their solo runs (module scratch); every piece's estimate stays within its budget.
 * The frozen-original comparison (traffic vs the pre-J2 class, phase by phase, three piece scales) is
 * tests/sim/exact/traffic.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { RNG } from '../../src/core/rng';
import type { CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { boxH, boxHRows, boxV, BoxVRun } from '../../src/sim/infra/blur';
import { BuildingSnapshot } from '../../src/sim/infra/common';
import { GraphBuildRun, GridGraph, RoadGraph } from '../../src/sim/infra/graph';
import { INFRA_PIECE_COLD_MS, INFRA_PIECE_MS, INFRA_URGENT_BUDGET } from '../../src/sim/infra/params';
import { baseSupply, baseSupplyRange, parkingFromBoxes, parkingFromBoxesRange, parkingSummaryOf } from '../../src/sim/infra/parking';
import { InfraScheduler, pieceBudgetUs, pieceUnits, withPieceScale, type InfraTask } from '../../src/sim/infra/scheduler';
import {
  RoadSearchRun, Search, SearchK, Seeds, TransitSearchRun, accumulate, accumulateRange, roadSearch, transitSearch, type TransitNet,
} from '../../src/sim/infra/search';
import { MinHeap } from '../../src/sim/infra/heap';
import { StopCollector, collectStops, copyStopList, type StopList } from '../../src/sim/infra/transit';
import { TrafficSystem } from '../../src/sim/infra/traffic';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { newState, place, roadLine, stressCity } from './cityGen';
import { lineTown } from './prTowns';
import { diffDigests, digest, fieldsDigest, stateDigest, trafficCycle } from './b2Harness';

// ------------------------------------------------------------------------------------------------ helpers
function randomRoads(rng: RNG, N: number, density = 0.55): CityState {
  const st = newState(N);
  const types = [Network.Street, Network.Road, Network.Avenue, Network.OneWay, Network.Highway];
  for (let i = 0; i < st.cells; i++) {
    const r = rng.next();
    if (r < density) st.network[i] = rng.pick(types);
    else if (r < density + 0.05) st.network[i] = Network.Rail;
    if (st.network[i] === Network.OneWay) st.netFlags[i] = (rng.int(0, 3) << 2);
    if (rng.chance(0.03)) st.netFlags[i] |= 1 << 5; // level crossing
    if (rng.chance(0.2)) st.subway[i] = 1;
  }
  return st;
}

function sameSearch(a: Search, b: Search, n: number, at: string): void {
  expect(b.settled, `${at} settled`).toBe(a.settled);
  expect(b.graphVersion, `${at} version`).toBe(a.graphVersion);
  for (let v = 0; v < n; v++) {
    if (!Object.is(a.dist[v], b.dist[v]) || a.src[v] !== b.src[v] || a.next[v] !== b.next[v] || a.done[v] !== b.done[v]) throw new Error(`${at}: node ${v}`);
    if (a.dist[v] < Infinity && a.hops[v] !== b.hops[v]) throw new Error(`${at}: hops ${v}`);
  }
  for (let k = 0; k < a.settled; k++) if (a.order[k] !== b.order[k]) throw new Error(`${at}: order ${k}`);
}

function randomSeeds(rng: RNG, n: number, count: number, maxLabel: number): Seeds {
  const s = new Seeds();
  for (let k = 0; k < count; k++) s.push(rng.int(-1, n), rng.chance(0.1) ? rng.pick([0, maxLabel * 3, Infinity]) : rng.range(0, maxLabel), rng.int(0, 50));
  return s;
}

function sameGraph(a: object, b: object, at: string): void {
  const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
  expect(Object.keys(rb), `${at} keys`).toEqual(Object.keys(ra));
  for (const k of Object.keys(ra)) {
    const x = ra[k], y = rb[k];
    if (ArrayBuffer.isView(x)) expect(digest(y), `${at}.${k}`).toBe(digest(x));
    else expect(y, `${at}.${k}`).toEqual(x);
  }
}

// ------------------------------------------------------------------------------------------------ core
describe('B2 core: resumable kernels equal their whole-call originals', () => {
  it('pieceUnits / pieceBudgetUs / withPieceScale', () => {
    expect(pieceUnits(0.1, 1, 0.3)).toBe(3000);
    expect(pieceUnits(1e9, 1, 0.3)).toBe(1);
    expect(pieceUnits(1e9, 5, 0.3)).toBe(5);
    expect(pieceBudgetUs(0.3)).toBeCloseTo(300);
    withPieceScale(1e9, () => { expect(pieceUnits(0.1)).toBe(0x3fffffff); expect(pieceBudgetUs()).toBeGreaterThan(1e10); });
    withPieceScale(1e-9, () => expect(pieceUnits(0.1)).toBe(1));
    expect(pieceUnits(0.1, 1, INFRA_PIECE_MS)).toBe(Math.floor(INFRA_PIECE_MS * 1000 / 0.1));
    expect(() => withPieceScale(1e-9, () => { throw new Error('x'); })).toThrow();
    expect(pieceUnits(0.1, 1, INFRA_PIECE_COLD_MS)).toBe(Math.floor(INFRA_PIECE_COLD_MS * 1000 / 0.1)); // restored
  });

  it('RoadSearchRun in random chunks = roadSearch(), with other searches between the chunks', () => {
    const rng = new RNG(0xb2a1), heap = new MinHeap();
    for (let c = 0; c < 60; c++) {
      const st = randomRoads(rng, rng.pick([1, 2, 7, 16, 33, 48]), rng.range(0.2, 0.9));
      const g = new RoadGraph();
      g.build(st);
      const n = g.n;
      const time = new Float32Array(n), ramp = new Float32Array(n);
      for (let v = 0; v < n; v++) { time[v] = g.t0[v] * rng.range(1, 4); ramp[v] = rng.range(0.05, 2); }
      const seeds = randomSeeds(rng, n, rng.int(0, 12), 30);
      const limit = rng.pick([5, 30, 400, 3000]);
      const adj = rng.chance(0.5) ? g.fwd : g.rev;
      const rp = rng.chance(0.5) ? ramp : null;
      const A = new Search(), B = new Search(), other = new Search();
      roadSearch(g, adj, time, A, heap, seeds, limit, rp);
      const run = new RoadSearchRun();
      run.start(g, adj, time, B, seeds, limit, rp);
      let guard = 0;
      while (!run.run(rng.pick([1, 2, 3, 17, 100, 1e9]))) {
        // (garageReach / emergency between two pieces: the module search must not disturb the run)
        roadSearch(g, g.rev, g.t0, other, heap, randomSeeds(rng, n, 3, 20), 50, null);
        if (++guard > 1e6) throw new Error('run did not end');
      }
      sameSearch(A, B, n, `road ${c}`);
      expect(run.run(5), 'a finished run stays finished').toBe(true);
    }
  });

  it('TransitSearchRun in random chunks = transitSearch()', () => {
    const rng = new RNG(0xb2a2), heap = new MinHeap();
    for (let c = 0; c < 40; c++) {
      const st = randomRoads(rng, rng.pick([4, 12, 24, 40]), 0.6);
      const g = new RoadGraph(), rail = new GridGraph(), sub = new GridGraph();
      g.build(st);
      rail.build(st.size, (i) => st.network[i] === Network.Rail);
      sub.build(st.size, (i) => st.subway[i] !== 0);
      const nR = g.n, nRail = rail.n, nSub = sub.n, nFerry = rng.int(0, 3), total = nR + nRail + nSub + nFerry;
      const busTime = new Float32Array(nR);
      for (let v = 0; v < nR; v++) busTime[v] = g.t0[v] * 1.25 * rng.range(1, 3);
      const E = rng.int(0, 60), from: number[] = [], to: number[] = [], cost: number[] = [];
      for (let e = 0; e < E && total > 0; e++) { from.push(rng.int(0, total - 1)); to.push(rng.int(0, total - 1)); cost.push(rng.range(0.5, 8)); }
      const trStart = new Int32Array(total + 1);
      for (const f of from) trStart[f + 1]++;
      for (let i = 0; i < total; i++) trStart[i + 1] += trStart[i];
      const fill = trStart.slice(0, total), trTo = new Int32Array(E), trCost = new Float32Array(E);
      for (let e = 0; e < from.length; e++) { const p = fill[from[e]]++; trTo[p] = to[e]; trCost[p] = cost[e]; }
      const T: TransitNet = { nR, nRail, nSub, nFerry, total, roadAdj: g.rev, busTime, railAdj: rail.adj, subAdj: sub.adj, railTime: 0.06, subTime: 0.03, trStart, trTo, trCost };
      const seeds = randomSeeds(rng, total, rng.int(0, 10), 40);
      const limit = rng.pick([10, 126, 3000]);
      const A = new Search(), B = new Search();
      transitSearch(T, A, heap, seeds, limit);
      const run = new TransitSearchRun();
      run.start(T, B, seeds, limit);
      while (!run.run(rng.pick([1, 5, 64, 1e9]))) { /* chunks */ }
      sameSearch(A, B, total, `transit ${c}`);
    }
  });

  it('accumulateRange from the end of the forest to its start = accumulate (flows and sink order)', () => {
    const rng = new RNG(0xb2a3), heap = new MinHeap();
    for (let c = 0; c < 40; c++) {
      const st = randomRoads(rng, rng.pick([8, 20, 40]), 0.7);
      const g = new RoadGraph();
      g.build(st);
      const S = new Search();
      roadSearch(g, g.rev, g.t0, S, heap, randomSeeds(rng, g.n, 6, 10), 400, null);
      const a = new Float32Array(g.n);
      for (let v = 0; v < g.n; v++) a[v] = rng.chance(0.3) ? rng.range(0, 100) : 0;
      const b = a.slice(), sa: number[] = [], sb: number[] = [];
      accumulate(S, a, (id, f, v) => sa.push(id, f, v));
      let k1 = S.settled;
      while (k1 > 0) { const k0 = Math.max(0, k1 - rng.int(1, 50)); accumulateRange(S, b, k0, k1, (id, f, v) => sb.push(id, f, v)); k1 = k0; }
      expect(digest(b)).toBe(digest(a));
      expect(sb).toEqual(sa);
    }
  });

  it('GraphBuildRun in random pieces = RoadGraph.build + GridGraph.build (published into used graphs: tails, versions)', () => {
    const rng = new RNG(0xb2a4);
    // graphs that already hold earlier (bigger / smaller) builds: allocation and tails must follow build()
    const refRoad = new RoadGraph(), refRail = new GridGraph(), refSub = new GridGraph();
    const road = new RoadGraph(), rail = new GridGraph(), sub = new GridGraph();
    const run = new GraphBuildRun();
    for (let c = 0; c < 40; c++) {
      const st = randomRoads(rng, rng.pick([1, 3, 16, 31, 64]), rng.range(0, 0.95));
      refRoad.build(st);
      refRail.build(st.size, (i) => st.network[i] === Network.Rail || (st.netFlags[i] & (1 << 5)) !== 0);
      refSub.build(st.size, (i) => st.subway[i] !== 0);
      run.begin(st);
      // (the grids may change after begin(): the build reads its copy)
      const keep = st.network.slice();
      st.network.fill(0);
      const budget = rng.pick([0.001, 0.05, 1, 50, 1e9]);
      let guard = 0;
      while (!run.run(budget)) if (++guard > 1e7) throw new Error('build did not end');
      st.network.set(keep);
      run.publish(road, rail, sub);
      sameGraph(refRoad, road, `road ${c}`);
      sameGraph(refRail, rail, `rail ${c}`);
      sameGraph(refSub, sub, `subway ${c}`);
      expect(run.active).toBe(false);
    }
  });

  it('StopCollector + copyStopList = collectStops into a used list (tails, growth)', () => {
    const rng = new RNG(0xb2a5);
    const ref: StopList = { n: 0, bid: new Int32Array(64), mode: new Uint8Array(64), cell: new Int32Array(64) };
    const dst: StopList = { n: 0, bid: new Int32Array(64), mode: new Uint8Array(64), cell: new Int32Array(64) };
    const back: StopList = { n: 0, bid: new Int32Array(64), mode: new Uint8Array(64), cell: new Int32Array(64) };
    for (let c = 0; c < 12; c++) {
      const N = rng.pick([8, 24, 40]);
      const st = newState(N);
      for (let i = 0; i < st.cells; i++) { st.network[i] = rng.chance(0.6) ? Network.Road : 0; if (rng.chance(0.15)) st.netFlags[i] = 16; }
      for (let k = 0; k < rng.int(0, 40); k++) {
        const x = rng.int(0, N - 2), z = rng.int(0, N - 2);
        if (st.building[z * N + x] >= 0) continue;
        place(st, rng.pick(['tr_bus_stop', 't_subway', 't_r1', 'tr_ferry_terminal']), x, z);
      }
      collectStops(st, ref);
      const col = new StopCollector(), list = [...st.buildings.values()];
      col.begin(back);
      while (!col.buildings(st, list, rng.int(1, 7))) { /* chunks */ }
      while (!col.cells(st, rng.int(1, 200))) { /* chunks */ }
      col.end();
      copyStopList(dst, back);
      expect(dst.n).toBe(ref.n);
      expect(digest([dst.bid, dst.mode, dst.cell])).toBe(digest([ref.bid, ref.mode, ref.cell]));
    }
  });

  it('boxHRows + BoxVRun by row ranges = boxH + boxV; baseSupplyRange / parkingFromBoxesRange = their originals', () => {
    const rng = new RNG(0xb2a6);
    for (let c = 0; c < 30; c++) {
      const N = rng.pick([1, 2, 5, 17, 64]), r = rng.pick([0, 1, 2, 3, 9]), C = N * N;
      const src = Float32Array.from({ length: C }, () => (rng.chance(0.2) ? 0 : rng.range(-5, 50)));
      const t1 = new Float32Array(C), d1 = new Float32Array(C), t2 = new Float32Array(C), d2 = new Float32Array(C);
      boxH(src, t1, N, r);
      boxV(t1, d1, N, r);
      for (let z = 0; z < N;) { const z1 = Math.min(N, z + rng.int(1, 9)); boxHRows(src, t2, N, r, z, z1); z = z1; }
      const run = new BoxVRun();
      run.begin(t2, d2, N, r);
      while (!run.run(rng.int(1, 6))) { /* rows */ }
      expect(digest(t2)).toBe(digest(t1));
      expect(digest(d2)).toBe(digest(d1));
    }
    const st = stressCity(48, 5).st;
    const a = new Float32Array(st.cells), b = new Float32Array(st.cells);
    baseSupply(st, a);
    for (let i = 0; i < st.cells; i += 97) baseSupplyRange(st, b, i, Math.min(st.cells, i + 97));
    expect(digest(b)).toBe(digest(a));
    const N = st.size, D = Float32Array.from({ length: st.cells }, () => (rng.chance(0.5) ? 0 : rng.range(0, 30)));
    const bd = Float32Array.from(D, (x) => x * 0.7), bs = Float32Array.from(a, (x) => x * 1.1), prev = Float32Array.from({ length: st.cells }, () => rng.next());
    for (const p of [null, prev]) {
      const o1 = new Float32Array(st.cells), o2 = new Float32Array(st.cells);
      const s1 = parkingFromBoxes(N, D, a, bd, bs, o1, p, 0.4);
      const acc = { wSum: 0, pSum: 0, dCells: 0, high: 0, sTot: 0, dTot: 0 };
      for (let i = 0; i < st.cells; i += 61) parkingFromBoxesRange(N, D, a, bd, bs, o2, p, 0.4, i, Math.min(st.cells, i + 61), acc);
      expect(digest(o2)).toBe(digest(o1));
      expect(parkingSummaryOf(acc)).toEqual(s1);
    }
  });

  it('SearchK car legs refreshed by settle-order ranges = refreshAlt', () => {
    const rng = new RNG(0xb2a7);
    for (let c = 0; c < 20; c++) {
      const st = randomRoads(rng, rng.pick([12, 30]), 0.7);
      const g = new RoadGraph();
      g.build(st);
      const t2 = Float32Array.from({ length: g.n }, (_, v) => g.t0[v] * rng.range(1, 3)), r2 = Float32Array.from({ length: g.n }, () => rng.range(0, 2));
      const seeds = randomSeeds(rng, g.n, 5, 5), groups = Array.from({ length: 60 }, (_, i) => i % 4);
      const mk = () => {
        const K = new SearchK(3);
        K.start(g, g.rev, g.t0, seeds, groups, 200, null, 30, 8, t2, r2);
        while (!K.run(1e9)) { /* run */ }
        return K;
      };
      const A = mk();
      const B = mk();
      const t3 = Float32Array.from(t2, (x) => x * rng.range(0.5, 2)), r3 = rng.chance(0.5) ? null : r2;
      A.refreshAlt(t3, r3);
      expect(B.refreshAltBegin(t3, r3)).toBe(true);
      for (let k = 0; k < B.settled;) { const k1 = Math.min(B.settled, k + rng.int(1, 40)); B.refreshAltRange(k, k1); k = k1; }
      expect(digest(B.alt)).toBe(digest(A.alt));
    }
  });

  it('BuildingSnapshot: chunks cover the list in order, each within the budget unless one building exceeds it', () => {
    const st = stressCity(64, 3).st;
    const snap = new BuildingSnapshot();
    snap.take(st);
    expect(snap.n).toBe(st.buildings.size);
    for (const budget of [1, 7, 50, 1e9]) {
      const k = snap.plan(0.5, 0.25, budget);
      expect(snap.bounds[0]).toBe(0);
      expect(snap.bounds[k]).toBe(snap.n);
      let cells = 0;
      for (let c = 0; c < k; c++) {
        expect(snap.countOf(c)).toBeGreaterThan(0);
        let us = 0, f = 0;
        for (let i = snap.bounds[c]; i < snap.bounds[c + 1]; i++) { const b = snap.list[i]; us += 0.5 + 0.25 * b.w * b.d; f += b.w * b.d; }
        expect(snap.cellsOf(c)).toBe(f);
        cells += f;
        if (snap.countOf(c) > 1) expect(us).toBeLessThanOrEqual(budget + 1e-9);
      }
      expect(cells).toBe([...st.buildings.values()].reduce((s, b) => s + b.w * b.d, 0));
    }
    snap.release();
    expect(snap.list.length).toBe(0);
  });

  it('scheduler: urgent steps re-scan for the first urgent task, under one estimated budget headless; the first always runs', () => {
    const mk = (name: string, cost: number, n: number, log: string[]): InfraTask & { left: number } => {
      const t = {
        name, left: n,
        due: () => t.left > 0, urgent: () => t.left > 0, cost: () => cost,
        step: () => { t.left--; log.push(name); },
      };
      return t;
    };
    const log: string[] = [];
    const sch = new InfraScheduler();
    const a = mk('a', 5, 3, log), b = mk('b', 4, 100, log);
    sch.register(a); sch.register(b);
    const sim = { state: { day: 1 } } as unknown as Simulation;
    sch.tickDay(sim);
    // a: 3 x 5 = 15, then b while 15 + 4k <= 24: 2 steps (23); then the normal loop's budget is used up
    expect(log.slice(0, 5)).toEqual(['a', 'a', 'a', 'b', 'b']);
    expect(log.length).toBe(5);
    expect(INFRA_URGENT_BUDGET).toBe(24);
    // an oversized first urgent step still runs
    const log2: string[] = [];
    const sch2 = new InfraScheduler();
    sch2.register(mk('big', 100, 2, log2));
    sch2.tickDay(sim);
    expect(log2).toEqual(['big']);
  });
});

// ------------------------------------------------------------------------------------------------ traffic (G1)
/** the stress generator's city with transit inside the map (its subway row 97 is off a 96² map), a rail line to the
 *  map edge with a freight station beside it (a freight sink: PH_SINKS), a bus depot (the depot BFS) and parking garages
 *  in the blocks beside the subway stations */
function transitCity(size: number, seed: number): CityState {
  const st = stressCity(size, seed, { withTransit: false, jobsPerWorker: 0.7 }).st;
  for (let i = 0; i < st.cells; i++) if (st.network[i] && i % 17 === 0) st.netFlags[i] |= 16;
  const z = size - 3;
  roadLine(st, 0, z, size - 1, z, Network.Road);
  for (let x = 1; x < size - 1; x++) st.subway[st.idx(x, z + 1)] = 1;
  for (let x = 1; x < size - 1; x += 12) { clearArea(st, x, z + 1, 1, 1); place(st, 't_subway', x, z + 1); }
  // garages in the 2x2 blocks just north of the stations' road (blocks: cells 3k + 2, 3k + 3)
  const bz = Math.floor((z - 4) / 3) * 3 + 2;
  for (let x = 13; x < size - 4; x += 24) { const bx = Math.floor(x / 3) * 3 + 2; clearArea(st, bx, bz, 2, 2); place(st, 'tr_parking_garage', bx, bz); }
  // rail from the west edge (x = 0) along z = 3, a level crossing on the road x = 1, a freight station above it
  clearArea(st, 2, 2, 2, 2);
  st.network[st.idx(0, 3)] = Network.Rail;
  st.netFlags[st.idx(1, 3)] |= 1 << 5;
  st.network[st.idx(2, 3)] = Network.Rail;
  st.network[st.idx(3, 3)] = Network.Rail;
  place(st, 't_freight', 2, 2);
  // a bus depot (3x3, on a cleared corner of a road grid square)
  clearArea(st, 26, 26, 3, 3, true);
  place(st, 'civ_bus_depot', 26, 26);
  return st;
}
/** remove the buildings (and with `roads` the network) on a rectangle */
function clearArea(st: CityState, x0: number, z0: number, w: number, d: number, roads = false): void {
  for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) {
    const i = st.idx(x, z), id = st.building[i];
    if (roads) st.network[i] = 0;
    if (id < 0) continue;
    const b = st.buildings.get(id)!;
    for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) st.building[st.idx(xx, zz)] = -1;
    st.buildings.delete(id);
  }
}

/** B2 piece state and scratch whose content depends on where the pieces fall (not results) */
const TRAFFIC_SCRATCH = ['snap', 'gb', 'task', 'unsub', 'lastState', 'transportFor', 'attachFor', 'phaseMs', 'lastCycleMs', 'lastCycleMs0', 'heap'];
/** the query-owned scratch and caches (findPath's BFS, garageReach's search and cache): queries change them by design */
const QUERY_SCRATCH = ['SP', 'SR', 'reachCache'];
const trafficOf = (sim: Simulation) => sim.getSystem('traffic') as unknown as TrafficSystem;

/** the network / building edits between two cycles (graph rebuilds, a new / removed building, carried state) */
function edit(sim: Simulation, k: number): void {
  const st = sim.state, N = st.size;
  if (k % 3 === 0) {
    const z = 4 + 3 * (k % 7);
    roadLine(st, 2, z, N - 3, z, k % 2 === 0 ? Network.Avenue : Network.Road);
    sim.events.emit('networkChanged', { x0: 0, z0: z, x1: N, z1: z + 1 });
  } else if (k % 3 === 1) {
    for (const b of st.buildings.values()) {
      if (b.pop > 0 && b.id % 5 === k % 5) { b.pop = Math.max(0, b.pop - 3); }
    }
    let x = 2 + (k * 7) % (N - 6), z = 2 + (k * 11) % (N - 6);
    while (st.building[st.idx(x, z)] >= 0 || st.network[st.idx(x, z)] !== 0) { x = (x + 1) % (N - 2); if (x === 0) z = (z + 1) % (N - 2); }
    sim.events.emit('buildingAdded', place(st, k % 2 ? 'tr_bus_stop' : 't_cs', x, z));
  } else {
    const ids = [...st.buildings.keys()];
    const b = st.buildings.get(ids[(k * 31) % ids.length])!;
    for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) st.building[st.idx(xx, zz)] = -1;
    st.buildings.delete(b.id);
    sim.events.emit('buildingRemoved', b);
  }
}

/** a city's traffic over `cycles` cycles (edits between them), each cycle at piece scale `scale` (random per cycle:
 *  'random'); hook after every piece; the digests at every cycle end */
/** the phases and named pieces any run visited (coverage of the test cities) */
const visited = new Set<string>();
function runCycles(mk: () => CityState, cycles: number, scale: number | 'random', hook?: (sim: Simulation, k: number) => void, exclude: readonly string[] = []): Record<string, string>[] {
  const st = mk();
  const tr = new TrafficSystem();
  const sim = new Simulation(st, [tr]);
  const rng = new RNG(0x5ca1e);
  const out: Record<string, string>[] = [];
  const t = tr as unknown as { stepName: string };
  for (let c = 0; c < cycles; c++) {
    if (c > 0) edit(sim, c);
    st.day += 2;
    const s = scale === 'random' ? rng.pick([1e9, 1, 0.3, 0.05, 0.004]) : scale;
    withPieceScale(s, () => trafficCycle(sim, (k) => { visited.add(t.stepName.replace(/#\d+$/, '')); hook?.(sim, k); }));
    out.push({ ...stateDigest(st), ...fieldsDigest(tr, [...TRAFFIC_SCRATCH, ...exclude]) });
  }
  return out;
}

function expectSameRuns(a: Record<string, string>[], b: Record<string, string>[], label: string): void {
  expect(b.length).toBe(a.length);
  for (let c = 0; c < a.length; c++) expect(diffDigests(a[c], b[c]), `${label}: cycle ${c}`).toEqual([]);
}

describe('B2 G1 traffic: a cycle in one go = in pieces', () => {
  const cities: [string, () => CityState][] = [
    ['transit city 48', () => transitCity(48, 11)],
    ['line town (P&R, overflow)', () => lineTown([48, 60, 72, 84, 96], 2).st],
    ['transit city 96', () => transitCity(96, 7)],
  ];
  for (const [name, mk] of cities) {
    it(`${name}: one go = production pieces = small / random pieces, at every cycle end across edits`, () => {
      const cycles = name.endsWith('96') ? 4 : 6;
      const one = runCycles(mk, cycles, 1e9);
      expectSameRuns(one, runCycles(mk, cycles, 1), `${name} production`);
      expectSameRuns(one, runCycles(mk, cycles, name.endsWith('48') ? 1e-9 : 0.01), `${name} tiny`);
      expectSameRuns(one, runCycles(mk, cycles, 'random'), `${name} random`);
    }, 300_000);
  }

  it('the test cities exercise the WP7b stages: park & ride, the overflow, the freight sinks, parking, the depot BFS, rebuilds', () => {
    for (const k of ['parkRide.search', 'parkRide.options', 'overflow.alloc', 'overflow.rest', 'sinks.2', 'parking.8', 'prepTransit.depotBfs',
      'prep.rb3', 'prep.rbPublish', 'freight.5', 'commute.ovLegs', 'transit.search', 'roundMatch.accept', 'final2.5']) expect(visited.has(k), k).toBe(true);
  });

  it('R8: cross-system queries between every two pieces change nothing (findPath, garageReach, stopsNear, routeInfo, stopAttached / freightRailCells with the attachment forced dirty)', () => {
    const mk = () => transitCity(48, 23);
    const base = runCycles(mk, 4, 0.05, undefined, QUERY_SCRATCH);
    const rng = new RNG(0x9e7);
    const withQueries = runCycles(mk, 4, 0.05, (sim, k) => {
      const tr = trafficOf(sim), st = sim.state, f = tr as unknown as { attachDirty: boolean };
      tr.findPath(sim, rng.int(0, st.cells - 1), rng.int(0, st.cells - 1));
      for (const b of st.buildings.values()) {
        if (b.def === 'tr_parking_garage') { tr.garageReach(b.id); tr.garageInfo(b.id); }
        if (b.id % 13 === k % 13) { tr.routeInfo(b.id); tr.stopLoad(b.id); tr.workerAccess(b.id); }
      }
      tr.stopsNear(st, rng.int(0, st.size - 3), rng.int(0, st.size - 3), 2, 2);
      if (k % 5 === 0) { f.attachDirty = true; tr.stopAttached(rng.int(0, st.nextBuildingId)); tr.freightRailCells(); }
      void tr.nodeTimes; tr.connectionReport(); tr.getSampleRoutes(20);
    }, QUERY_SCRATCH);
    expectSameRuns(base, withQueries, 'queries between pieces');
  }, 300_000);

  it('R7 / R4: every external output changes in at most one piece per stage (phase visit) — production pieces', () => {
    const st = transitCity(64, 5);
    const tr = new TrafficSystem();
    const sim = new Simulation(st, [tr]);
    const outputs = (): Record<string, string> => ({
      traffic: digest(st.traffic), congestion: digest(st.congestion), commute: digest(st.commute), parking: digest(st.parking),
      save: digest(st.systemData.infraTransport), stats: digest(st.stats),
      flags: digest([...st.buildings.values()].map((b) => b.flags)),
      access: digest(tr.accessById), jobFill: digest(tr.jobFillById), freight: digest(tr.freightById),
      nodeTimes: digest(tr.nodeTimes), graph: String(tr.graphVersion),
      stops: digest([...st.buildings.values()].map((b) => tr.stopLoad(b.id))),
      garages: digest([...st.buildings.values()].filter((b) => b.def === 'tr_parking_garage').map((b) => tr.garageInfo(b.id))),
      depots: digest([tr.minibusInfo, tr.depotStopsServed]),
      routes: digest(tr.getSampleRoutes(1000).map((r) => r.cells)), connections: digest(tr.connectionReport()),
      trucks: digest(tr.truckVolume()), sinks: digest([...st.buildings.values()].map((b) => tr.sinkTrucks(b.id))),
      inbound: String(tr.inboundTotal), bus: digest([...Array(st.cells).keys()].filter((i) => i % 7 === 0).map((i) => tr.cellBusRiders(i))),
    });
    for (let c = 0; c < 5; c++) {
      if (c > 0) edit(sim, c);
      st.day += 2;
      let prev = outputs();
      const changes = new Map<string, number>();
      const t = tr as unknown as { phase: number };
      let pieces = 0, visit = 0, ph = 0;
      trafficCycle(sim, () => {
        pieces++;
        const now = outputs();
        for (const k of Object.keys(now)) if (now[k] !== prev[k]) changes.set(`${k}@${visit}:${ph}`, (changes.get(`${k}@${visit}:${ph}`) ?? 0) + 1);
        prev = now;
        if (t.phase !== ph) { visit++; ph = t.phase; }
      });
      expect(pieces).toBeGreaterThan(20);
      // (pre-B2: one step per phase visit; the rebuild was its own step before prep's: road.n and the node times change
      // at the graph publish and again at prep's)
      for (const [k, n] of changes) expect(n, `cycle ${c}: ${k} changed in ${n} pieces`).toBeLessThanOrEqual(/^(nodeTimes|graph)@\d+:0$/.test(k) ? 2 : 1);
    }
  }, 300_000);

  it('R9: a save taken mid-cycle holds no cycle state; it loads idle and loads the same twice', () => {
    const st = transitCity(48, 3);
    const tr = new TrafficSystem();
    const sim = new Simulation(st, [tr]);
    const between = Object.keys(serializeCity(st, { copy: true })).sort();
    const sdBetween = Object.keys((serializeCity(st, { copy: true }).data.systemData ?? {}) as object).sort();
    st.day += 2;
    const t = tr as unknown as { phase: number; lastCycleStart: number; step(s: Simulation): void };
    t.phase = 0; t.lastCycleStart = st.day;
    let saved: SerializedCity | null = null;
    withPieceScale(0.02, () => {
      let k = 0;
      while (t.phase >= 0) { t.step(sim); if (++k === 300) saved = structuredClone(serializeCity(st, { copy: true })); }
    });
    expect(saved, 'mid-cycle save taken').not.toBeNull();
    expect(Object.keys(saved!).sort()).toEqual(between);
    expect(Object.keys((saved!.data.systemData ?? {}) as object).sort()).toEqual(sdBetween);
    const load = () => {
      const s2 = deserializeCity(structuredClone(saved!));
      const tr2 = new TrafficSystem();
      const sim2 = new Simulation(s2, [tr2]);
      const f = tr2 as unknown as Record<string, number>;
      expect(f.phase).toBeLessThan(0);
      for (const k of ['rbStage', 'pSub', 'tSub', 'trSub', 'otSub', 'prSub', 'rsSub', 'mSub', 'cmSub', 'ceSub', 'sfSub', 'pkSub', 'fiSub', 'f2Sub']) expect(f[k], k).toBe(0);
      for (let c = 0; c < 3; c++) { s2.day += 2; trafficCycle(sim2); }
      return { ...stateDigest(s2), ...fieldsDigest(tr2, TRAFFIC_SCRATCH) };
    };
    expect(diffDigests(load(), load())).toEqual([]);
  }, 300_000);

  it('two cities stepped interleaved, piece by piece, equal their solo runs (no module scratch shared across cities)', () => {
    const mkA = () => transitCity(48, 31), mkB = () => lineTown([48, 60, 72], 2).st;
    const soloA = runCycles(mkA, 3, 0.05), soloB = runCycles(mkB, 3, 0.05);
    const stA = mkA(), stB = mkB(), trA = new TrafficSystem(), trB = new TrafficSystem();
    const simA = new Simulation(stA, [trA]), simB = new Simulation(stB, [trB]);
    const a: Record<string, string>[] = [], b: Record<string, string>[] = [];
    withPieceScale(0.05, () => {
      for (let c = 0; c < 3; c++) {
        if (c > 0) { edit(simA, c); edit(simB, c); }
        stA.day += 2; stB.day += 2;
        const ta = trA as unknown as { phase: number; lastCycleStart: number }, tb = trB as unknown as { phase: number; lastCycleStart: number };
        ta.phase = tb.phase = 0; ta.lastCycleStart = stA.day; tb.lastCycleStart = stB.day;
        while (ta.phase >= 0 || tb.phase >= 0) { trA.step(simA); trB.step(simB); }
        a.push({ ...stateDigest(stA), ...fieldsDigest(trA, TRAFFIC_SCRATCH) });
        b.push({ ...stateDigest(stB), ...fieldsDigest(trB, TRAFFIC_SCRATCH) });
      }
    });
    expectSameRuns(soloA, a, 'city A interleaved');
    expectSameRuns(soloB, b, 'city B interleaved');
  }, 300_000);

  it('every piece estimate stays within its budget at the production size (stress city 128, cycles with a rebuild)', () => {
    const st = transitCity(128, 9);
    const tr = new TrafficSystem();
    const sim = new Simulation(st, [tr]);
    const max = new Map<string, number>();
    for (let c = 0; c < 3; c++) {
      if (c === 1) edit(sim, 3);
      st.day += 2;
      const t = tr as unknown as { phase: number; lastCycleStart: number; step(s: Simulation): void; stepName: string };
      t.phase = 0; t.lastCycleStart = st.day;
      while (t.phase >= 0) {
        const name = t.stepName.replace(/#\d+$/, ''), c0 = tr.stepCost(sim);
        if (c0 > (max.get(name) ?? 0)) max.set(name, c0);
        t.step(sim);
      }
    }
    // (budget: INFRA_PIECE_MS for the searches; the edit-only attachment refresh and the rebuild's publish are the only
    // exceptions: R2)
    for (const [name, c] of max) {
      const cap = /attach|rbPublish|rb0/.test(name) ? 2 : INFRA_PIECE_MS * 1.5;
      expect(c, `${name} estimate`).toBeLessThanOrEqual(cap);
    }
    expect(max.size).toBeGreaterThan(40);
  }, 300_000);
});
