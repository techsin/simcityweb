/**
 * In-situ A/B (node, CPU time): two Simulations of the same fixture — A on the ORIGINAL search.ts, B on the wasm
 * bindings (plugins.mjs 'swap' mode dispatches per simulation) — each running TrafficSystem.runCycleSync (one full
 * traffic assignment: prep, matching rounds with their road searches, transit, commute, inbound / shop / freight,
 * finalize), interleaved with alternating order for >= 31 pairs after warm-up cycles. Reports CPU ms per cycle, the
 * time inside the search kernels, speedup with a 95% bootstrap CI, and checks both traffic systems and cities stay
 * bit-identical.
 *   args: --fixture dense1m|stress1m|stress256 [--fixtures DIR] [--pairs 31] [--warm 2] [--json out.json]
 */
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { initSimWasmSync, setSimWasmPreference, simWasmStatus } from '../../../src/wasm/simWasm';
import { searchMemStats, searchWasmStats } from '../../../src/wasm/kernels/searchBind';
import { bootstrapMedianCI } from '../ab';
import { benchMain, cpuMs, loadAvg } from '../node';
import { fixtureDir, loadCity } from './fixtures';
import { TIMING, deepDiff, isSearchLike, sameSearch } from './compare';

type Stats = { road: number; transit: number; acc: number; roadMs: number; transitMs: number; accMs: number };
const G = globalThis as unknown as { __searchMode: string; __searchStats: Stats };
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
  const spec = opt('--fixture', 'dense1m')!;
  const pairs = Number(opt('--pairs', '31'));
  const warm = Number(opt('--warm', '2'));
  if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
  const mk = async (mode: 'js' | 'wasm') => {
    G.__searchMode = mode;
    setSimWasmPreference(mode === 'js' ? 'js' : 'auto');
    const { st, label } = await loadCity(spec, fixtureDir(args));
    const t0 = cpuMs();
    const sim = new Simulation(st, createSystems());
    const tr = sim.getSystem('traffic') as unknown as { runCycleSync(s: Simulation): void; road: { n: number } };
    return { sim, tr, st, label, initMs: cpuMs() - t0, mode };
  };
  const A = await mk('js'), B = await mk('wasm');
  log(`# ${A.label}: pop ${A.st.stats.population}, road nodes ${A.tr.road.n}; init cpu js ${A.initMs.toFixed(0)} ms / wasm ${B.initMs.toFixed(0)} ms; load ${loadAvg().join(' ')}`);
  const run = (X: typeof A) => {
    G.__searchMode = X.mode;
    setSimWasmPreference(X.mode === 'js' ? 'js' : 'auto');
    const s = (G.__searchStats ??= { road: 0, transit: 0, acc: 0, roadMs: 0, transitMs: 0, accMs: 0 });
    s.road = s.transit = s.acc = s.roadMs = s.transitMs = s.accMs = 0;
    const t0 = cpuMs();
    X.tr.runCycleSync(X.sim);
    const ms = cpuMs() - t0;
    return { ms, searchMs: s.roadMs + s.transitMs + s.accMs, roadMs: s.roadMs, transitMs: s.transitMs, accMs: s.accMs, calls: s.road + s.transit + s.acc };
  };
  for (let k = 0; k < warm; k++) { run(A); run(B); }
  const a: ReturnType<typeof run>[] = [], b: ReturnType<typeof run>[] = [], ratio: number[] = [], sratio: number[] = [];
  const w0 = { ...searchWasmStats };
  for (let k = 0; k < pairs; k++) {
    let ra, rb;
    if (k % 2 === 0) { ra = run(A); rb = run(B); } else { rb = run(B); ra = run(A); }
    a.push(ra); b.push(rb); ratio.push(rb.ms / ra.ms); sratio.push(rb.searchMs / ra.searchMs);
    if (k < 3 || k === pairs - 1) log(`pair ${k}: js ${ra.ms.toFixed(1)} ms/cycle (search ${ra.searchMs.toFixed(1)}, ${ra.calls} calls) | wasm ${rb.ms.toFixed(1)} ms/cycle (search ${rb.searchMs.toFixed(1)})`);
  }
  G.__searchMode = 'js';
  setSimWasmPreference('auto');
  const ci = bootstrapMedianCI(ratio), sci = bootstrapMedianCI(sratio);
  const med = (xs: ReturnType<typeof run>[], k: keyof ReturnType<typeof run>) => median(xs.map((x) => x[k] as number));
  // bit-identical traffic systems and cities after warm + pairs cycles
  const skip = (k: string, v: unknown) => isSearchLike(v) || k === 'heap' || TIMING.has(k) || k === 'sim' || k === 'events';
  const trDiff = deepDiff(A.tr, B.tr, 'traffic', [], new WeakSet(), skip);
  const searchSame = ['SA', 'ST', 'SB'].map((k) => {
    const x = (A.tr as unknown as Record<string, Parameters<typeof sameSearch>[0]>)[k], y = (B.tr as unknown as Record<string, Parameters<typeof sameSearch>[0]>)[k];
    return x && y ? sameSearch(x, y) : true;
  });
  const cityDiff = deepDiff(A.st, B.st, 'state', [], new WeakSet(), (k) => k === 'savedAt');
  const res = {
    fixture: A.label, pop: A.st.stats.population, roadNodes: A.tr.road.n, cycles: warm + pairs, pairs,
    js: { cycleMs: med(a, 'ms'), cycleMin: Math.min(...a.map((x) => x.ms)), searchMs: med(a, 'searchMs'), roadMs: med(a, 'roadMs'), transitMs: med(a, 'transitMs'), accMs: med(a, 'accMs'), calls: a[0].calls },
    wasm: { cycleMs: med(b, 'ms'), cycleMin: Math.min(...b.map((x) => x.ms)), searchMs: med(b, 'searchMs'), roadMs: med(b, 'roadMs'), transitMs: med(b, 'transitMs'), accMs: med(b, 'accMs'), calls: b[0].calls },
    cycleSpeedup: 1 / median(ratio), cycleSpeedupCI: [1 / ci.hi, 1 / ci.lo],
    searchSpeedup: 1 / median(sratio), searchSpeedupCI: [1 / sci.hi, 1 / sci.lo],
    savedMsPerCycle: med(a, 'ms') - med(b, 'ms'),
    wasmPaths: { roadWasm: searchWasmStats.roadWasm - w0.roadWasm, roadJs: searchWasmStats.roadJs - w0.roadJs, transitWasm: searchWasmStats.transitWasm - w0.transitWasm, transitJs: searchWasmStats.transitJs - w0.transitJs, accWasm: searchWasmStats.accWasm - w0.accWasm, accJs: searchWasmStats.accJs - w0.accJs, reserves: searchMemStats.reserves },
    identical: { traffic: trDiff, searches: searchSame, city: cityDiff },
    load: loadAvg(),
  };
  log(`cycle: js ${res.js.cycleMs.toFixed(1)} ms, wasm ${res.wasm.cycleMs.toFixed(1)} ms -> ${res.cycleSpeedup.toFixed(3)}x [${res.cycleSpeedupCI.map((v) => v.toFixed(3)).join(', ')}], saves ${res.savedMsPerCycle.toFixed(1)} ms/cycle`);
  log(`inside search.ts: js ${res.js.searchMs.toFixed(1)} ms (road ${res.js.roadMs.toFixed(1)}, transit ${res.js.transitMs.toFixed(1)}, acc ${res.js.accMs.toFixed(1)}) wasm ${res.wasm.searchMs.toFixed(1)} ms (road ${res.wasm.roadMs.toFixed(1)}, transit ${res.wasm.transitMs.toFixed(1)}, acc ${res.wasm.accMs.toFixed(1)}) -> ${res.searchSpeedup.toFixed(2)}x [${res.searchSpeedupCI.map((v) => v.toFixed(2)).join(', ')}]; share of the js cycle ${(100 * res.js.searchMs / res.js.cycleMs).toFixed(1)}%`);
  log(`wasm paths: ${JSON.stringify(res.wasmPaths)}`);
  log(`bit-identical after ${res.cycles} cycles: traffic ${trDiff.length === 0 ? 'yes' : trDiff.slice(0, 4).join('; ')}, searches ${searchSame.join('/')}, city ${cityDiff.length === 0 ? 'yes' : cityDiff.slice(0, 4).join('; ')}`);
  return res;
});
