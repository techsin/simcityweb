/**
 * Secondary-kernel A/B (node, CPU time on an idle worker thread): the other searches of the Rust `search` module on a
 * fixture's real inputs, original JS vs wasm bindings, interleaved (tools/bench/ab.ts), each verified bit-identical
 * first:
 *  - catchments.ts roadTimeMulti: services' accessCommute search (seeds from ServicesSystem.accessCommuteSeeds,
 *    limit (MAX_COMMUTE + 60) / TIME_Q, NET_TIME_Q / RAMP_Q) — the "accSearch" step
 *  - catchments.ts roadDistMulti: services' shopAccess drive search from the commercial frontage seeds — "shopA"
 *  - emergency.ts ChunkedSearch: a full station search of the response layers (start + steps of EMERG_SEARCH_CHUNK)
 *  - emergency.ts DispatchSearch: dispatch runs from incident nodes with a station visitor (early exit after 8 station
 *    nodes), and full runs without a visitor (whole graph up to the 2000 min limit)
 *   args: --fixture dense1m|stress1m|stress256 [--fixtures DIR] [--reps 31] [--warmup 600] [--days 2]
 */
import { readFileSync } from 'node:fs';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import * as catchJs from '../../../src/sim/infra/catchments';
import * as em from '../../../src/sim/infra/emergency';
import * as P from '../../../src/sim/infra/params';
import { Seeds } from '../../../src/sim/infra/search';
import type { RoadGraph } from '../../../src/sim/infra/graph';
import { Network } from '../../../src/core/types';
import { makeCatchmentSearchKernels } from '../../../src/wasm/kernels/catchSearchBind';
import { makeEmergencySearchKernels, type DispatchSearchLike } from '../../../src/wasm/kernels/emergencySearchBind';
import { initSimWasmSync, simWasmStatus } from '../../../src/wasm/simWasm';
import { runAB, formatResult, type AbResult } from '../ab';
import { benchMain, cpuMs, loadAvg } from '../node';
import { fixtureDir, loadCity } from './fixtures';

/** the private DispatchSearch class of the tree's emergency.ts, compiled from its source (the file is not edited) */
async function originalDispatch(): Promise<new () => DispatchSearchLike> {
  const { transformWithOxc } = await import('vite');
  const src = readFileSync(EMERGENCY_TS, 'utf8');
  const start = src.indexOf('class DispatchSearch {');
  if (start < 0) throw new Error('DispatchSearch not found in ' + EMERGENCY_TS);
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const code = (await transformWithOxc(src.slice(start, end), 'dispatch.ts')).code;
  const MIN_T = Math.min(P.NET_TIME[1], P.NET_TIME[2], P.NET_TIME[3], P.NET_TIME[4], P.NET_TIME[5]);
  return new Function('Network', 'RAMP_PENALTY', 'QB', `${code}\nreturn DispatchSearch;`)(Network, P.RAMP_PENALTY, MIN_T * 0.999);
}
/** set by the driver (the tree's emergency.ts path) */
const EMERGENCY_TS = process.env.RTS_EMERGENCY_TS ?? '';

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
  const reps = Number(opt('--reps', '31'));
  const warmupMs = Number(opt('--warmup', '600'));
  const days = Number(opt('--days', '2'));
  if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
  const { st, label } = await loadCity(opt('--fixture', 'dense1m')!, fixtureDir(args));
  const sim = new Simulation(st, createSystems());
  for (let d = 0; d < days; d++) sim.advanceDay();
  log(`# ${label}: pop ${st.stats.population}, ${st.size}² map; load ${loadAvg().join(' ')}`);
  const opts = { clock: cpuMs, clockName: 'cpu', reps, warmupMs };
  const results: (AbResult & { kernel: string })[] = [];
  const ab = (kernel: string, a: () => void, b: () => void) => {
    const r = runAB({ name: kernel, a, b, aLabel: 'js', bLabel: 'wasm' }, opts);
    log(formatResult(r));
    results.push({ ...r, kernel });
  };

  // ---------------------------------------------------------------------------------------------- catchments
  const K = makeCatchmentSearchKernels(catchJs, { WALK_COST: P.WALK_COST, DRIVE_COST: P.DRIVE_COST, RAMP_COST: P.RAMP_COST, HIGHWAY: Network.Highway, STREET: Network.Street });
  const sv = sim.getSystem('services') as unknown as { accessCommuteSeeds(s: Simulation): void; idist: Int32Array; csSeeds: Int32Array; nCsSeeds: number };
  const C = st.cells;
  sv.accessCommuteSeeds(sim);
  const seedsT = sv.idist.slice(0, C);
  const TIME_Q = catchJs.TIME_Q;
  const NET_TIME_Q = P.NET_TIME.map((t, k) => (k >= 1 && k <= 5 ? Math.max(1, Math.round(t / TIME_Q)) : 0));
  const RAMP_Q = Math.round(P.RAMP_PENALTY / TIME_Q);
  const limitQ = Math.round((P.MAX_COMMUTE + 60) / TIME_Q);
  const oa = new Int32Array(C), ob = new Int32Array(C);
  const ta = () => { oa.set(seedsT); return catchJs.roadTimeMulti(st, oa, limitQ, NET_TIME_Q, RAMP_Q); };
  const tb = () => { ob.set(seedsT); return K.roadTimeMulti(st, ob, limitQ, NET_TIME_Q, RAMP_Q); };
  const sa = ta(), sb = tb();
  let bad = sa !== sb ? 1 : 0;
  for (let i = 0; i < C; i++) if (oa[i] !== ob[i]) bad++;
  let nSeedsT = 0;
  for (let i = 0; i < C; i++) if (seedsT[i] >= 0) nSeedsT++;
  log(`roadTimeMulti: ${nSeedsT} seed cells, ${sa} settled, limitQ ${limitQ}; mismatches ${bad}`);
  if (bad) throw new Error('roadTimeMulti mismatch');
  ab('catchments roadTimeMulti (accSearch)', ta, tb);

  let cs = sv.csSeeds, ncs = sv.nCsSeeds;
  if (!(ncs > 0)) {
    // no services pass yet: frontage of every commercial building = road cells next to non-road cells with buildings
    const tmp: number[] = [];
    for (let i = 0; i < C; i++) if (st.network[i] >= 1 && st.network[i] <= 5 && ((i % st.size > 0 && st.building[i - 1] >= 0) || (i % st.size < st.size - 1 && st.building[i + 1] >= 0))) tmp.push(i);
    cs = Int32Array.from(tmp.filter((_, k) => k % 4 === 0));
    ncs = cs.length;
  }
  const maxQ = P.SHOP_CAP_CELLS * 4;
  const da = new Int32Array(C), db = new Int32Array(C);
  const xa = () => catchJs.roadDistMulti(st, 1, cs, ncs, maxQ, da), xb = () => K.roadDistMulti(st, 1, cs, ncs, maxQ, db);
  const ra = xa(), rb = xb();
  bad = ra !== rb ? 1 : 0;
  for (let i = 0; i < C; i++) if (da[i] !== db[i]) bad++;
  log(`roadDistMulti: ${ncs} frontage seeds, ${ra} settled, maxQ ${maxQ}; mismatches ${bad}`);
  if (bad) throw new Error('roadDistMulti mismatch');
  ab('catchments roadDistMulti (shopA)', xa, xb);

  // ---------------------------------------------------------------------------------------------- emergency
  const E = makeEmergencySearchKernels({ NET_TIME: P.NET_TIME, RAMP_PENALTY: P.RAMP_PENALTY, HIGHWAY: Network.Highway });
  const es = sim.getSystem('emergency') as unknown as {
    ensureGraph(st: unknown): boolean; refreshStations(s: Simulation): void; g: RoadGraph; tm: Float32Array; respTm: Float32Array; nodeHead: Int32Array;
    stations: { responder: string; units: number; range: number; nodes: number[] }[];
  };
  es.ensureGraph(st);
  es.refreshStations(sim);
  const g = es.g, n = g.n;
  const respTm = es.respTm.length >= n ? es.respTm : es.tm.length >= n ? es.tm : new Float32Array(n).fill(0.1);
  const tm = es.tm.length >= n ? es.tm : respTm;
  const seeds = new Seeds();
  for (let k = 0; k < es.stations.length; k++) {
    const s = es.stations[k];
    if (s.responder !== 'fire' || s.units <= 0) continue;
    for (const v of s.nodes) seeds.push(v, Math.max(0, P.EMERG_RMAX - s.range), k);
  }
  log(`emergency graph: ${n} nodes, ${es.stations.length} stations, ${seeds.n} fire-station seed nodes`);
  const CA = new em.ChunkedSearch(), CB = new E.ChunkedSearch();
  const chunkRun = (c: { start(n: number, s: Seeds, l: number): void; step(g: RoadGraph, a: Int32Array, t: Float32Array, m: number): boolean }) => () => {
    c.start(n, seeds, P.EMERG_RMAX + P.EMERG_SLOW_MARGIN);
    let steps = 0;
    while (!c.step(g, g.fwd, respTm, P.EMERG_SEARCH_CHUNK) && steps < 1e6) steps++;
  };
  chunkRun(CA)(); chunkRun(CB)();
  bad = CA.settled !== CB.settled ? 1 : 0;
  for (let v = 0; v < n; v++) if (!Object.is(CA.dist[v], CB.dist[v])) bad++;
  log(`ChunkedSearch: ${CA.settled} settled; mismatches ${bad}`);
  if (bad) throw new Error('ChunkedSearch mismatch');
  ab('emergency ChunkedSearch (response layer)', chunkRun(CA), chunkRun(CB));

  if (EMERGENCY_TS) {
    const Orig = await originalDispatch();
    // kernel-level numbers: every run through wasm (the shipped default sends small runs to the JS port: see below)
    const EF = makeEmergencySearchKernels({ NET_TIME: P.NET_TIME, RAMP_PENALTY: P.RAMP_PENALTY, HIGHWAY: Network.Highway }, { dispatchMinSettled: 0 });
    const DA = new Orig(), DB = new EF.DispatchSearch();
    const stHead = es.nodeHead.length >= n ? es.nodeHead : new Int32Array(n).fill(-1);
    let stations = 0;
    for (let v = 0; v < n; v++) if (stHead[v] >= 0) stations++;
    const incident = new Int32Array([Math.floor(n * 0.37), Math.floor(n * 0.37) + 1]);
    const visitor = (log2: number[]) => (u: number, d: number) => { log2.push(u, d); return log2.length >= 16; };
    const la: number[] = [], lb: number[] = [];
    const early = (D: DispatchSearchLike, l: number[]) => () => { l.length = 0; D.stop = Infinity; D.run(g, tm, incident, 2, 2000, stHead, visitor(l)); };
    const full = (D: DispatchSearchLike) => () => { D.stop = Infinity; D.run(g, tm, incident, 2, 2000, stHead, null); };
    early(DA, la)(); early(DB, lb)();
    bad = DA.settled !== DB.settled || la.join() !== lb.join() ? 1 : 0;
    for (let v = 0; v < n; v++) if (!Object.is(DA.d(v), DB.d(v)) || DA.nx(v) !== DB.nx(v)) bad++;
    log(`DispatchSearch early exit: ${DA.settled} settled, ${la.length / 2} station visits (${stations} station nodes); mismatches ${bad}`);
    if (bad) throw new Error('DispatchSearch mismatch');
    ab('emergency DispatchSearch (visitor, early exit)', early(DA, la), early(DB, lb));
    full(DA)(); full(DB)();
    bad = DA.settled !== DB.settled ? 1 : 0;
    for (let v = 0; v < n; v++) if (!Object.is(DA.d(v), DB.d(v))) bad++;
    log(`DispatchSearch full: ${DA.settled} settled; mismatches ${bad}`);
    if (bad) throw new Error('DispatchSearch (full) mismatch');
    ab('emergency DispatchSearch (full graph)', full(DA), full(DB));
    // the shipped adaptive class: small early-exit runs stay on the JS port, whole-graph runs switch to wasm
    const DC = new E.DispatchSearch(), DD = new E.DispatchSearch();
    const lc: number[] = [];
    ab('DispatchSearch adaptive (early exit)', early(DA, la), early(DC, lc));
    ab('DispatchSearch adaptive (full graph)', full(DA), full(DD));
  }
  log(`# load after ${loadAvg().join(' ')}`);
  return { fixture: label, results };
});
