/**
 * Equivalence of the traffic core — the numeric phases of TrafficSystem (src/sim/infra/traffic.ts at commit 24f8609)
 * as the fair optimised-JS core (src/wasm/js/trafficCore.ts) and the WebAssembly core (wasm/sim-kernels/src/traffic.rs
 * via src/wasm/kernels/trafficBind.ts) — with each other and with the original JS. Everything is compared exactly
 * (floats as values, NaN == NaN, -0 !== +0; searches on their defined ranges).
 *
 *  A  kernels, fair JS vs wasm, on random synthetic inputs (road grids with one-ways / highways / disconnected pieces,
 *     rail and subway, connections, stops, 0 / huge / subnormal values, wealth outside 1..3) and edge cases (empty
 *     map, no roads, no stops, a single node, entities at the map edges): all arrays after EVERY kernel.
 *  B  the ORIGINAL TrafficSystem methods (frozen 24f8609 class) vs the driver + fair JS vs the driver + wasm on the
 *     same synthetic inputs, from transit to finalize (round control flow, route sampling and RNG draws included).
 *  C  whole cities: three Simulations (original / fair / wasm) stepped phase by phase over several cycles with a
 *     network edit in between (graph rebuild, capacity growth, cached shop / freight cycles), the profiler's 1M
 *     fixture when present, days of the whole sim (JS-vs-JS baseline first), a mid-game install and a wasm memory
 *     growth between steps.
 *  D  the kernels' exp / log against Math.exp / Math.log bit for bit: specials, 2M random arguments and every
 *     argument the cities' cycles produce.
 * B and C need the frozen tree (SIM_SNAP or the profiler's snapshot); they are skipped when it is absent.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makeFairTrafficCore, type Arrs } from '../../src/wasm/js/trafficCore';
import { makeWasmTrafficCore, resetTrafficWasmStats, trafficMathSelfTest, trafficWasmStats, type TrafficWasmCore } from '../../src/wasm/kernels/trafficBind';
import { installTrafficCore } from '../../src/wasm/kernels/trafficDriver';
import { TRAFFIC_ARRAYS, trafficParams, type Cls, type TrafficCoreApi } from '../../src/wasm/kernels/trafficLayout';
import { makeFairSearch } from '../../src/wasm/js/roadTransitSearch';
import { initSimWasmSync, setSimWasmPreference, simWasmInstance, simWasmStatus } from '../../src/wasm/simWasm';
import { cloneLayers, loadCore, makeScenario, type Scenario } from './trafficCoreScenario';
import { diffCity, diffTraffic } from '../../tools/bench/trafficCore/compare';

// the 24f8609 constants (params.ts at that commit; the live file may have moved on)
const P24 = {
  BPR_ALPHA: 0.15, BPR_MAX_FACTOR: 12, BUS_TIME_FACTOR: 1.25, STOP_WALK_TIME_PER_CELL: 0.5, MATCH_PRICE_MAX: 30, MAX_COMMUTE: 110, CAR_OVERHEAD: 4,
  WALK_TIME_PER_CELL: 0.8, MODE_BETA: 0.13, CAR_BIAS: [-1.2, 0, 0.9], TRANSIT_BIAS: [0.7, 0, -0.7], WALK_BIAS: -0.5, BUS_PCU_PER_RIDER: 1 / 12,
  MATCH_PRICE_STEP_MIN: 0.15, MATCH_PRICE_STEP_REL: 0.12, REGIONAL_TIME: 16, REGIONAL_FILL: 0.55, CONNECTION_WORKERS: [0, 300, 1500, 1500, 4000, 12000, 5000],
  CAR_OCCUPANCY: 1.15, SHOP_PCU_WEIGHT: 0.4, SHOP_TRIPS_PER_RES: 0.25, TRUCK_PCU: 2.5, NET_CAPACITY: [0, 350, 1200, 1600, 2600, 7000, 12000], DEST_NOISE: 0.02,
  NET_TIME: [0, 0.16, 0.1, 0.085, 0.075, 0.04, 0.035], SUBWAY_TIME: 0.03, RAMP_PENALTY: 0.35, STOP_WALK_RADIUS: 5, WALK_MAX_CELLS: 15, MATCH_PROP_ROUNDS: 3,
};
const NET = { Street: 1, Road: 2, Avenue: 3, OneWay: 4, Highway: 5, Rail: 6 };
const P = trafficParams(P24, NET);
const fairSearch = makeFairSearch({ NET_TIME: P24.NET_TIME, RAMP_PENALTY: P24.RAMP_PENALTY, SUBWAY_TIME: P24.SUBWAY_TIME, BUS_TIME_FACTOR: P24.BUS_TIME_FACTOR, HIGHWAY: 5 });

const cores: TrafficWasmCore[] = [];
const wasmCore = (): TrafficWasmCore => {
  const c = makeWasmTrafficCore(P, { search: fairSearch });
  cores.push(c);
  return c;
};
afterAll(() => { for (const c of cores) c.dispose(); });

// ------------------------------------------------------------------------------------------------ comparison of cores
const same = (x: number, y: number) => Object.is(x, y) || (x !== x && y !== y);
const SKIP = new Set(['sortA', 'sortB', 'nsIdx', 'nsDist', 'seedNode', 'seedLabel', 'seedId', 'hist', 'keyA', 'keyB', 'jTmp']);
const SEARCH = [['sa', 'n'], ['st', 'total'], ['sb', 'n']] as const;

function diffCores(a: TrafficCoreApi, b: TrafficCoreApi): string[] {
  const out: string[] = [];
  const c = a.c;
  // outNeed = the last size a core asked for when growing a buffer (diagnostic, not state)
  for (const k of Object.keys(c) as (keyof typeof c)[]) if (k !== 'outNeed' && c[k] !== b.c[k]) out.push(`count ${k}: ${c[k]} vs ${b.c[k]}`);
  for (let i = 0; i < 8; i++) if (!same(a.out[i], b.out[i])) out.push(`out${i}: ${a.out[i]} vs ${b.out[i]}`);
  if (out.length) return out;
  const A = a.A as unknown as Record<string, ArrayLike<number>>, B = b.A as unknown as Record<string, ArrayLike<number>>;
  const stAttEnd = (A.stAttS as Int32Array)[c.stopN] ?? 0;
  const range: Record<Cls, number> = {
    N: c.n, T: c.total, T1: c.total + 1, R: c.nRail, B: c.nSub, O: c.oN, J: c.jN, Q: c.qN, S: c.sN, F: c.fN, K: c.kN, P: c.stopN + 1, A: stAttEnd,
    G: c.binN * c.binN + 1, E: c.nTr, NT: c.entN, SD: 0, C: c.nComp, QE: 0, L: c.cells, H: 0, X: 0,
  };
  for (const d of TRAFFIC_ARRAYS) {
    if (d.wasmOnly || SKIP.has(d.name) || /^(sa|st|sb)[A-Z]/.test(d.name)) continue;
    let len = d.cls === 'X' ? (d.name === 'routeCand' || d.name === 'routeW' ? c.outRoutes : 0) : range[d.cls] * d.mult;
    if (d.name === 'inCand') len = c.outCand;
    const x = A[d.name], y = B[d.name];
    for (let i = 0; i < len; i++) if (!same(x[i], y[i])) { out.push(`${d.name}[${i}]: ${x[i]} vs ${y[i]}`); break; }
  }
  for (const [p, nk] of SEARCH) {
    const n = nk === 'n' ? c.n : c.total, settled = p === 'sa' ? c.saSettled : p === 'st' ? c.stSettled : c.sbSettled;
    const d1 = A[p + 'Dist'], d2 = B[p + 'Dist'];
    for (const f of ['Dist', 'Src', 'Next', 'Done']) {
      const x = A[p + f], y = B[p + f];
      for (let i = 0; i < n; i++) if (!same(x[i], y[i])) { out.push(`${p}${f}[${i}]`); break; }
    }
    for (let i = 0; i < n; i++) if (d1[i] < Infinity && A[p + 'Hops'][i] !== B[p + 'Hops'][i]) { out.push(`${p}Hops[${i}]`); break; }
    for (let i = 0; i < settled; i++) if (A[p + 'Order'][i] !== B[p + 'Order'][i]) { out.push(`${p}Order[${i}]`); break; }
    void d2;
  }
  return out;
}

/** the kernel sequence of one cycle (4 rounds unconditionally) as named steps on `core` */
function stepsOf(core: TrafficCoreApi, sc: Scenario): [string, () => void][] {
  const A = core.A as unknown as Arrs;
  const steps: [string, () => void][] = [
    ['prepNodes', () => core.prepNodes()], ['prepOrigins', () => core.prepOrigins()], ['clusters', () => core.clusters()],
    ['prepStops', () => core.prepStops()], ['transfers', () => core.transfers()], ['transit', () => core.transit()],
  ];
  for (let r = 0; r < 4; r++) steps.push([`roundSearch ${r}`, () => core.roundSearch(r)], [`roundMatch ${r}`, () => core.roundMatch(r)]);
  steps.push(
    ['commute', () => core.commute()],
    ['inboundCached', () => { for (let j = 0; j < core.c.jB; j++) A.jTmp[j] = sc.inboundById[A.jBid[j]]; core.inboundCached(); }],
    ['inbound', () => core.inbound()], ['shop', () => core.shop()], ['freight', () => core.freight()],
    ['addCached', () => { core.addCached(0); core.addCached(1); core.addCached(2); }], ['finalize', () => core.finalize()],
  );
  return steps;
}

/** run the kernel sequence on a fair and a wasm core in lockstep, comparing everything after every kernel */
function lockstep(sc: Scenario): { diffs: string[]; wasm: TrafficWasmCore } {
  const f = makeFairTrafficCore(P, fairSearch), w = wasmCore();
  loadCore(f, sc, cloneLayers(sc.layers));
  loadCore(w, sc, cloneLayers(sc.layers));
  const sf = stepsOf(f, sc), sw = stepsOf(w, sc);
  const diffs: string[] = [];
  for (let i = 0; i < sf.length && diffs.length === 0; i++) {
    sf[i][1]();
    sw[i][1]();
    const d = diffCores(f, w);
    if (d.length) diffs.push(`after ${sf[i][0]}: ${d.slice(0, 5).join('; ')}`);
  }
  if (diffs.length === 0 && w.lastJsReason !== '') diffs.push('wasm core ran JS: ' + w.lastJsReason);
  return { diffs, wasm: w };
}

// ================================================================================================ A: kernels
describe('trafficCore kernels: fair JS vs wasm on synthetic inputs', () => {
  it('the engine passes the kernels exp / log self-test', () => {
    expect(initSimWasmSync(), simWasmStatus().error ?? '').toBe(true);
    expect(trafficMathSelfTest(simWasmInstance()!)).toBe(true);
  });

  it('random scenarios: every array identical after every kernel', () => {
    resetTrafficWasmStats();
    for (let seed = 1; seed <= 40; seed++) {
      const sc = makeScenario(seed, {}, P24);
      const { diffs } = lockstep(sc);
      expect(diffs, `seed ${seed} (N ${sc.opts.N}, nodes ${sc.road.n}, origins ${sc.counts.oN}, stops ${sc.counts.stopN})`).toEqual([]);
    }
    expect(trafficWasmStats.jsCalls).toBe(0);
    expect(trafficWasmStats.wasmCalls).toBeGreaterThan(40 * 20);
  }, 300_000);

  it('extreme values: zero / huge capacities and volumes, subnormals, huge populations, wealth outside 1..3', () => {
    for (let seed = 101; seed <= 115; seed++) {
      const sc = makeScenario(seed, { extreme: true }, P24);
      expect(lockstep(sc).diffs, `seed ${seed}`).toEqual([]);
    }
  }, 300_000);

  it('edge cases: empty map, no roads, one node, no stops / sites / origins, entities on the map edge, dense stops', () => {
    const cases: [string, Parameters<typeof makeScenario>[1]][] = [
      ['empty 1x1', { N: 1, roadFill: 0, origins: 0, sites: 0, conns: 0, railConns: 0, shops: 0, fsrc: 0, sinks: 0, stops: 0, railFill: 0, subFill: 0 }],
      ['no roads', { N: 16, roadFill: 0, origins: 20, sites: 10, conns: 0, railConns: 1, shops: 3, fsrc: 3, sinks: 1, stops: 5, railFill: 0.2, subFill: 0.1 }],
      ['one road node', { N: 2, roadFill: 0.3, origins: 3, sites: 2, conns: 1, railConns: 0, shops: 1, fsrc: 1, sinks: 1, stops: 1, railFill: 0, subFill: 0 }],
      ['no stops', { N: 40, stops: 0 }],
      ['no sites', { N: 40, sites: 0, conns: 0, railConns: 0 }],
      ['no origins', { N: 40, origins: 0 }],
      ['dense stops', { N: 20, stops: 250, roadFill: 0.8, railFill: 0.1, subFill: 0.2 }],
      ['fragmented graph', { N: 64, roadFill: 0.22, origins: 400, sites: 150 }],
      ['map 257 (bins not a multiple of 8)', { N: 57, roadFill: 0.5, stops: 80 }],
    ];
    let seed = 500;
    for (const [name, o] of cases) {
      const sc = makeScenario(seed++, o, P24);
      expect(lockstep(sc).diffs, name).toEqual([]);
    }
  }, 300_000);

  it("preference 'js' runs the same kernels in JS on the same arrays (identical), and wasm again afterwards", () => {
    const sc = makeScenario(77, {}, P24);
    const f = makeFairTrafficCore(P, fairSearch), w = wasmCore();
    loadCore(f, sc, cloneLayers(sc.layers));
    loadCore(w, sc, cloneLayers(sc.layers));
    const fs = stepsOf(f, sc), ws = stepsOf(w, sc);
    for (let i = 0; i < fs.length; i++) {
      setSimWasmPreference(i % 2 ? 'js' : 'auto', 'traffic');
      fs[i][1]();
      ws[i][1]();
      expect(diffCores(f, w), `step ${fs[i][0]}`).toEqual([]);
    }
    setSimWasmPreference('auto', 'traffic');
  }, 120_000);
});

// ================================================================================================ frozen tree
const SNAP = process.env.SIM_SNAP ?? '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile/snap';
const FIXTURES = process.env.SIM_FIXTURES ?? '/tmp/claude-0/-home-user-simcityweb/4580b61e-4eb1-589c-8d44-88f27e267d08/scratchpad/wasm/profile/fixtures';
const haveSnap = existsSync(join(SNAP, 'src', 'sim', 'infra', 'traffic.ts'));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
async function loadSnap(): Promise<Any> {
  const m = async (p: string) => import(/* @vite-ignore */ join(SNAP, p));
  const [traffic, sim, systems, types, params, common, graph, transit, demo, tuning, city, gen, ser, bundle] = await Promise.all([
    m('src/sim/infra/traffic.ts'), m('src/sim/Simulation.ts'), m('src/sim/systems/index.ts'), m('src/core/types.ts'), m('src/sim/infra/params.ts'),
    m('src/sim/infra/common.ts'), m('src/sim/infra/graph.ts'), m('src/sim/infra/transit.ts'), m('src/sim/economy/demographics.ts'),
    m('src/sim/economy/tuning.ts'), m('src/sim/CityState.ts'), m('tests/infra/cityGen.ts'), m('src/save/serialize.ts'), m('src/save/bundle.ts'),
  ]);
  const plain = (o: object) => ({ ...o });
  const deps = {
    Network: plain(types.Network), params: plain(params), common: plain(common), graph: plain(graph), transit: plain(transit),
    workerShare: demo.workerShare, REGION_JOBS_FOR_RESIDENTS: tuning.REGION_JOBS_FOR_RESIDENTS, BF: plain(city.BF),
  };
  const PS = trafficParams(params, types.Network);
  const fs = makeFairSearch({ NET_TIME: params.NET_TIME, RAMP_PENALTY: params.RAMP_PENALTY, SUBWAY_TIME: params.SUBWAY_TIME, BUS_TIME_FACTOR: params.BUS_TIME_FACTOR, HIGHWAY: types.Network.Highway });
  return { traffic, sim, systems, types, params, common, graph, transit, city, gen, ser, bundle, deps, PS, fs };
}

describe.skipIf(!haveSnap)('trafficCore vs the original traffic.ts (frozen 24f8609)', () => {
  let S: Any = null;
  const snap = async () => (S ??= await loadSnap());

  // ---------------------------------------------------------------------------------------------- B: synthetic
  /** a TrafficSystem in the prepped state of scenario `sc`: original (fields assigned) or driver + core */
  function system(X: Any, sc: Scenario, core: TrafficCoreApi | null, prepped: TrafficCoreApi, layers: ReturnType<typeof cloneLayers>): Any {
    const tr = new X.traffic.TrafficSystem();
    const c = prepped.c;
    const A = prepped.A as unknown as Record<string, Float32Array>;
    tr.road = sc.road; tr.rail = sc.rail; tr.subway = sc.sub;
    tr.oN = c.oN; tr.jN = c.jN; tr.jB = c.jB; tr.sN = c.sN; tr.fN = c.fN; tr.kN = c.kN; tr.qN = c.qN; tr.entN = c.entN; tr.binN = c.binN;
    const stops = { n: c.stopN, bid: Int32Array.from({ length: c.stopN }, (_, s) => (s % 3 === 0 ? -1 : 50000 + s)), mode: (A.stMode as unknown as Uint8Array).slice(0, c.stopN), cell: (A.stCell as unknown as Int32Array).slice(0, c.stopN) };
    tr.stops = stops;
    tr.fx = { trafficCar: 0.9 + (sc.opts.N % 5) * 0.05, transitRidership: 1.1 };
    tr.propFactor = prepped.s.propFactor;
    tr.growth = sc.scalars.growth;
    tr.regionWorkerCap = sc.scalars.regionWorkerCap;
    tr.sfRecompute = true;
    tr.sfVersion = -1;
    tr.round = 0;
    tr.iter = 1;
    tr.rngState = 4242;
    tr.inboundById = sc.inboundById.slice();
    tr.freightById = new Float32Array(40000).fill(-1);
    tr.priceById = new Float32Array(40000);
    tr.connPrice = new Float32Array(sc.layers.cells);
    tr.pendingRoutes = [];
    const map: [string, string][] = [
      ['nodeTime', 'nodeTime'], ['volNew', 'volNew'], ['acc', 'acc'], ['tAcc', 'tAcc'], ['railNew', 'railNew'], ['subNew', 'subNew'], ['ent', 'ent'],
      ['oBid', 'oBid'], ['oW', 'oW'], ['oPop', 'oPop'], ['oWealth', 'oWealth'], ['oEntS', 'oEntS'], ['oEntC', 'oEntC'], ['oCell', 'oCell'], ['oHalf', 'oHalf'],
      ['oCarNode', 'oCarNode'], ['oBoard', 'oBoard'], ['oShC', 'oShC'], ['oShT', 'oShT'], ['oShW', 'oShW'], ['oTime', 'oTime'], ['oEmp', 'oEmp'], ['oJobT', 'oJobT'],
      ['jBid', 'jBid'], ['jSlots', 'jSlots'], ['jNoise', 'jNoise'], ['jAsg', 'jAsg'], ['jCapP', 'jCapP'], ['jPrice', 'jPrice'], ['jQ', 'jQ'], ['qNode', 'qNode'],
      ['qSlots', 'qSlots'], ['qCapP', 'qCapP'], ['qAsg', 'qAsg'], ['qPrice', 'qPrice'], ['qProp', 'qProp'], ['qBase', 'qBase'], ['qNoise', 'qNoise'],
      ['qTimeSum', 'qTimeSum'], ['nodeQ', 'nodeQ'], ['jBase', 'jBase'], ['jEntS', 'jEntS'], ['jEntC', 'jEntC'], ['jCell', 'jCell'], ['jHalf', 'jHalf'],
      ['jTimeSum', 'jTimeSum'], ['jInbound', 'jInbound'], ['jRailNode', 'jRailNode'], ['jConnType', 'jConnType'], ['sBid', 'sBid'], ['sEntS', 'sEntS'],
      ['sEntC', 'sEntC'], ['sLoad', 'sLoad'], ['fBid', 'fBid'], ['fTrucks', 'fTrucks'], ['fEntS', 'fEntS'], ['fEntC', 'fEntC'], ['kEntS', 'kEntS'],
      ['kEntC', 'kEntC'], ['kLabel', 'kLabel'], ['stAttS', 'stAttS'], ['stAttC', 'stAttC'], ['stAtt', 'stAtt'], ['stWait', 'stWait'], ['stLoad', 'stLoad'],
      ['stopBins', 'stopBins'], ['stopBinStart', 'stopBinStart'], ['nodeStop', 'nodeStop'], ['trStartA', 'trStart'], ['busTimeA', 'busTime'], ['oU', 'oU'],
      ['oAsg', 'oAsg'], ['oTimeSum', 'oTimeSum'], ['oCarW', 'oCarW'], ['oTrW', 'oTrW'], ['oWalkW', 'oWalkW'], ['oTrT', 'oTrT'], ['oBoardStop', 'oBoardStop'],
      ['oLastD', 'oLastD'], ['candNode', 'candNode'], ['volShop', 'volShop'], ['volFreight', 'volFreight'], ['volInbound', 'volInbound'],
    ];
    const total = sc.road.n + sc.rail.n + sc.sub.n;
    const mk = () => ({
      nR: sc.road.n, nRail: sc.rail.n, nSub: sc.sub.n, total, roadAdj: sc.road.rev, railAdj: sc.rail.adj, subAdj: sc.sub.adj,
      railTime: X.params.NET_TIME[6], subTime: X.params.SUBWAY_TIME,
    });
    if (!core) {
      for (const [f, k] of map) tr[f] = A[k].slice();
      tr.candKey = new Float64Array(Math.max(64, c.oN) * 2);
      tr.nsIdx = new Int32Array(64); tr.nsDist = new Float32Array(64);
      tr.tnet = { ...mk(), busTime: tr.busTimeA, trStart: tr.trStartA, trTo: (A.trTo as unknown as Int32Array).slice(0, c.nTr), trCost: A.trCost.slice(0, c.nTr) };
      return tr;
    }
    installTrafficCore(tr, X.deps, core);
    // capacities + graphs + layers from the scenario, then the prepped state over it
    loadCore(core, sc, layers);
    core.ensure({ E: Math.max(1, c.nTr), Q: c.qN + 1 });
    const B = core.A as unknown as Record<string, Float32Array>;
    for (const d of TRAFFIC_ARRAYS) if (!d.wasmOnly) B[d.name].set(A[d.name].subarray(0, Math.min(A[d.name].length, B[d.name].length)));
    Object.assign(core.c, prepped.c);
    Object.assign(core.s, prepped.s);
    tr.tnet = { ...mk(), busTime: B.busTime, trStart: B.trStart, trTo: B.trTo, trCost: B.trCost };
    return tr;
  }

  it('B: original methods vs driver + fair / wasm, transit .. finalize, random scenarios', async () => {
    const X = await snap();
    for (let seed = 1; seed <= 16; seed++) {
      const sc = makeScenario(seed, { extreme: seed > 12 }, P24);
      // prep-equivalent kernels once (the original's prep / prepTransit need a whole city: covered by C)
      const prepped = makeFairTrafficCore(X.PS, X.fs);
      loadCore(prepped, sc, cloneLayers(sc.layers));
      prepped.prepNodes(); prepped.prepOrigins(); prepped.clusters(); prepped.prepStops(); prepped.transfers();
      const L = [cloneLayers(sc.layers), cloneLayers(sc.layers), cloneLayers(sc.layers)];
      const sims = L.map((l) => ({ state: { traffic: l.traffic, congestion: l.congestion, network: l.network, cells: l.cells, size: l.size, stats: {} as Record<string, number> } }));
      const fc = makeFairTrafficCore(X.PS, X.fs), wc = makeWasmTrafficCore(X.PS, { search: X.fs });
      cores.push(wc);
      const trs = [system(X, sc, null, prepped, L[0]), system(X, sc, fc, prepped, L[1]), system(X, sc, wc, prepped, L[2])];
      const cmp = (where: string) => {
        for (let i = 1; i < 3; i++) {
          const d = [...diffTraffic(trs[0], trs[i]), ...['traffic', 'congestion'].flatMap((k) => {
            const a = sims[0].state[k as 'traffic'], b = sims[i].state[k as 'traffic'];
            for (let q = 0; q < a.length; q++) if (!same(a[q], b[q])) return [`state.${k}[${q}]`];
            return [];
          })];
          expect(d, `seed ${seed} ${i === 1 ? 'fair' : 'wasm'} after ${where}`).toEqual([]);
        }
      };
      for (const tr of trs) tr.transit();
      cmp('transit');
      for (let round = 0; round < 6; round++) {
        for (const tr of trs) tr.roundSearch();
        cmp(`roundSearch ${round}`);
        const next = trs.map((tr) => tr.roundMatch());
        expect(new Set(next).size, `seed ${seed} round ${round} control flow`).toBe(1);
        cmp(`roundMatch ${round}`);
        if (next[0] !== 3) break;
      }
      for (const tr of trs) tr.commuteEnd();
      cmp('commuteEnd');
      for (const tr of trs) tr.inbound();
      cmp('inbound');
      for (const tr of trs) tr.shopping();
      cmp('shopping');
      for (const tr of trs) tr.freight();
      cmp('freight');
      trs.forEach((tr, i) => tr.finalize(sims[i]));
      cmp('finalize');
      for (const k of ['tripsCar', 'tripsTransit', 'tripsWalk', 'avgCommute', 'avgTraffic']) {
        expect(sims[1].state.stats[k], k).toBe(sims[0].state.stats[k]);
        expect(sims[2].state.stats[k], k).toBe(sims[0].state.stats[k]);
      }
      expect(wc.lastJsReason).toBe('');
    }
  }, 600_000);

  // ---------------------------------------------------------------------------------------------- C: whole cities
  /** a Simulation of the frozen tree with `kind` installed on its TrafficSystem before init */
  function arm(X: Any, st: Any, kind: 'orig' | 'fair' | 'wasm'): Any {
    const systems = X.systems.createSystems();
    const tr = systems.find((s: Any) => s.name === 'traffic');
    let core: TrafficCoreApi | null = null;
    if (kind === 'fair') core = makeFairTrafficCore(X.PS, X.fs);
    if (kind === 'wasm') { core = makeWasmTrafficCore(X.PS, { search: X.fs }); cores.push(core as TrafficWasmCore); }
    if (core) installTrafficCore(tr, X.deps, core);
    const sim = new X.sim.Simulation(st, systems);
    return { kind, sim, st, tr, core };
  }
  const stepCompare = (arms: Any[], cycles: number, label: string, edit?: (cy: number, a: Any) => void) => {
    const [A, ...B] = arms;
    const check = (where: string) => {
      for (const b of B) expect([...diffTraffic(A.tr, b.tr), ...diffCity(A.st, b.st)], `${label} ${b.kind} @ ${where}`).toEqual([]);
    };
    check('warm-start');
    let steps = 0;
    for (let cy = 0; cy < cycles; cy++) {
      if (edit) for (const a of arms) edit(cy, a);
      for (const x of arms) { x.tr.phase = 0; x.tr.lastCycleStart = x.st.day; }
      while (A.tr.phase >= 0) {
        const ph = A.tr.phase;
        for (const x of arms) { expect(x.tr.phase, `${label} ${x.kind} phase`).toBe(ph); x.tr.step(x.sim); }
        steps++;
        check(`cycle ${cy} phase ${ph} round ${A.tr.round}`);
      }
    }
    return steps;
  };

  it('C: stress city, every phase of 6 cycles, with road edits (graph rebuild, growth) and cached shop / freight cycles', async () => {
    const X = await snap();
    X.gen.registerTestDefs();
    const arms = (['orig', 'fair', 'wasm'] as const).map((k) => arm(X, X.gen.stressCity(96).st, k));
    resetTrafficWasmStats();
    // cycles 2 and 4: extend a road along a row (new nodes: graph rebuild -> node capacity growth, graph re-copy)
    const edit = (cy: number, a: Any) => {
      if (cy !== 2 && cy !== 4) return;
      const st = a.st, N = st.size, z = cy === 2 ? 3 : N - 4;
      for (let x = 2; x < N - 2; x++) { const i = z * N + x; if (st.network[i] === 0 && st.building[i] < 0) st.network[i] = X.types.Network.Road; }
      a.sim.events.emit('networkChanged');
    };
    const steps = stepCompare(arms, 6, 'stress96', edit);
    expect(steps).toBeGreaterThan(60);
    expect(trafficWasmStats.jsCalls).toBe(0);
    expect(trafficWasmStats.wasmCalls).toBeGreaterThan(100);
    // the stats were reset after the warm-start cycle: one graph copy per road edit (rebuild -> new version)
    expect(trafficWasmStats.graphCopies).toBeGreaterThanOrEqual(2);
    expect(arms[2].tr.road.n).toBeGreaterThan(5008);
  }, 900_000);

  it('C: wasm memory growth between steps (views re-pointed) and a mid-game install keep the city identical', async () => {
    const X = await snap();
    X.gen.registerTestDefs();
    const A = arm(X, X.gen.stressCity(80).st, 'orig');
    const W = arm(X, X.gen.stressCity(80).st, 'wasm');
    // mid-game install: a system that ran the original for its warm-start cycle takes over with a wasm core
    const L = arm(X, X.gen.stressCity(80).st, 'orig');
    const lateCore = makeWasmTrafficCore(X.PS, { search: X.fs });
    cores.push(lateCore);
    installTrafficCore(L.tr, X.deps, lateCore);
    const heap = simWasmInstance()!.heap;
    for (let cy = 0; cy < 3; cy++) {
      for (const x of [A, W, L]) { x.tr.phase = 0; x.tr.lastCycleStart = x.st.day; }
      while (A.tr.phase >= 0) {
        const ph = A.tr.phase;
        for (const x of [A, W, L]) x.tr.step(x.sim);
        if (ph === 4 || ph === 7) heap.reserve(heap.capacity + (8 << 20)); // grows memory: every view detaches
        for (const x of [W, L]) expect([...diffTraffic(A.tr, x.tr), ...diffCity(A.st, x.st)], `${x === W ? 'wasm' : 'late'} cycle ${cy} phase ${ph}`).toEqual([]);
      }
    }
    expect(W.core.lastJsReason).toBe('');
    expect(lateCore.lastJsReason).toBe('');
  }, 900_000);

  it('C: whole sim, 36 days: JS-vs-JS baseline identical, then original vs wasm identical (saved cities)', async () => {
    const X = await snap();
    X.gen.registerTestDefs();
    const days = 36;
    const run = (kind: 'orig' | 'wasm') => {
      const a = arm(X, X.gen.stressCity(96).st, kind);
      for (let d = 0; d < days; d++) a.sim.advanceDay();
      return a;
    };
    const save = (st: Any) => X.ser.serializeCity(st, { copy: true });
    const bytes = (v: Any) => JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? Array.from(new Uint8Array((x as ArrayBufferView).buffer, (x as ArrayBufferView).byteOffset, (x as ArrayBufferView).byteLength)).join(',') : x));
    const a1 = run('orig'), a2 = run('orig');
    const s1 = bytes({ ...save(a1.st), savedAt: 0 });
    expect(bytes({ ...save(a2.st), savedAt: 0 }) === s1, 'JS vs JS').toBe(true);
    const w = run('wasm');
    expect(bytes({ ...save(w.st), savedAt: 0 }) === s1, 'JS vs wasm city').toBe(true);
    expect(diffTraffic(a1.tr, w.tr)).toEqual([]);
    expect(w.core.lastJsReason).toBe('');
  }, 900_000);

  const dense = join(FIXTURES, 'dense1m_s7.metropolis');
  it.skipIf(!existsSync(dense))('C: the 1M-population dense fixture, every phase of 2 cycles', async () => {
    const X = await snap();
    const { readFileSync } = await import('node:fs');
    const load = async () => X.ser.deserializeCity(await X.bundle.unpackFile(new Uint8Array(readFileSync(dense))));
    const arms = [arm(X, await load(), 'orig'), arm(X, await load(), 'fair'), arm(X, await load(), 'wasm')];
    expect(arms[0].st.stats.population).toBeGreaterThan(1_000_000);
    stepCompare(arms, 2, 'dense1m');
    expect(arms[2].core.lastJsReason).toBe('');
  }, 1_800_000);

  // ---------------------------------------------------------------------------------------------- D: exp / log
  it('D: exp / log bit-identical to Math.exp / Math.log (specials, 2M random, every argument of the cities\' cycles)', async () => {
    const X = await snap();
    const w = simWasmInstance()!;
    const ex = w.exports as unknown as { traffic_exp(x: number): number; traffic_log(x: number): number; traffic_math_batch(x: number, o: number, n: number, which: number): void };
    const check = (xs: Float64Array, which: 0 | 1) => {
      const h = w.heap, n = xs.length;
      const p = h.alloc(16 * n + 16, 16);
      try {
        new Float64Array(h.memory.buffer, p, n).set(xs);
        ex.traffic_math_batch(p, p + 8 * n, n, which);
        const R = new Float64Array(h.memory.buffer, p + 8 * n, n);
        const f = which ? Math.log : Math.exp;
        let bad = 0;
        for (let i = 0; i < n; i++) if (!same(R[i], f(xs[i]))) bad++;
        return bad;
      } finally {
        h.free(p);
      }
    };
    const specials = Float64Array.from([0, -0, 1, -1, 2, 0.5, Infinity, -Infinity, NaN, 5e-324, -5e-324, 2.2250738585072014e-308, 1.7976931348623157e308,
      709.782712893384, 709.7827128933841, -745.1332191019411, -745.1332191019412, 0.34657359027997264, 1.0397207708399179, 3.725290298461914e-9]);
    expect(check(specials, 0) + check(specials, 1)).toBe(0);
    const r = Math.random;
    const xs = new Float64Array(1 << 20), U = new Uint32Array(xs.buffer);
    for (let rep = 0; rep < 2; rep++) {
      for (let i = 0; i < xs.length; i++) {
        const m = i & 3;
        if (m === 0) { U[2 * i] = (r() * 4294967296) >>> 0; U[2 * i + 1] = (r() * 4294967296) >>> 0; } else if (m === 1) xs[i] = (r() - 0.5) * 1500; else if (m === 2) xs[i] = -r() * 40; else xs[i] = 0.25 + r() * 7.75;
      }
      expect(check(xs, 0), 'exp').toBe(0);
      expect(check(xs, 1), 'log').toBe(0);
    }
    // every argument the traffic phases pass to Math.exp / Math.log in a few cycles of the stress city (fair core: the
    // same calls as the original, recorded through a wrapper)
    X.gen.registerTestDefs();
    const a = arm(X, X.gen.stressCity(96).st, 'fair');
    const E: number[] = [], Lg: number[] = [];
    const exp0 = Math.exp, log0 = Math.log;
    Math.exp = (x: number) => { E.push(x); return exp0(x); };
    Math.log = (x: number) => { Lg.push(x); return log0(x); };
    try {
      for (let k = 0; k < 3; k++) a.tr.runCycleSync(a.sim);
    } finally {
      Math.exp = exp0;
      Math.log = log0;
    }
    expect(E.length).toBeGreaterThan(1000);
    expect(check(Float64Array.from(E), 0), `${E.length} exp arguments`).toBe(0);
    expect(check(Float64Array.from(Lg), 1), `${Lg.length} log arguments`).toBe(0);
  }, 600_000);
});
