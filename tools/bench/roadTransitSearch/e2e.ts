/**
 * End-to-end A/B (node, CPU time): the whole headless simulation (Simulation.advanceDay: every system, the infra
 * scheduler's deterministic daily budget) on a 1M-population fixture, A on the original search.ts, B on the wasm
 * bindings (plugins.mjs 'swap' mode), in interleaved chunks of days with alternating order. Per chunk: CPU ms per day
 * of the whole sim, of each infra scheduler task (traffic = the system containing the kernels) and inside search.ts.
 * Afterwards a third simulation C (original JS) runs the same days: A == C is the JS-vs-JS determinism baseline, then
 * A == B must hold (serialized cities compared byte for byte, plus the traffic systems' state).
 *   args: --fixture dense1m|stress1m|stress256 [--fixtures DIR] [--days 120] [--chunk 3] [--warm 2] [--no-baseline]
 */
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { schedulerOf } from '../../../src/sim/infra/scheduler';
import { serializeCity } from '../../../src/save/serialize';
import { initSimWasmSync, setSimWasmPreference, simWasmStatus } from '../../../src/wasm/simWasm';
import { searchWasmStats } from '../../../src/wasm/kernels/searchBind';
import { bootstrapMedianCI } from '../ab';
import { benchMain, cpuMs, loadAvg } from '../node';
import { fixtureDir, loadCity } from './fixtures';
import { TIMING, deepDiff, isSearchLike } from './compare';

type Stats = { road: number; transit: number; acc: number; roadMs: number; transitMs: number; accMs: number };
const G = globalThis as unknown as { __searchMode: string; __searchStats: Stats };
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) >> 1] : 0.5 * (s[n / 2 - 1] + s[n / 2]); };

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
  const spec = opt('--fixture', 'dense1m')!;
  const days = Number(opt('--days', '120'));
  const chunk = Number(opt('--chunk', '3'));
  const warm = Number(opt('--warm', '2'));
  const baseline = !args.includes('--no-baseline');
  if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
  const mk = async (mode: 'js' | 'wasm') => {
    G.__searchMode = mode;
    setSimWasmPreference(mode === 'js' ? 'js' : 'auto');
    const { st, label } = await loadCity(spec, fixtureDir(args));
    const sim = new Simulation(st, createSystems());
    const taskMs = new Map<string, number>();
    // per-system daily hooks (the first infra system's daily also runs the scheduler's steps for the day)
    for (const sys of sim.systems) {
      const f = sys.daily?.bind(sys);
      if (!f) continue;
      const name = `${sys.name}.daily`;
      sys.daily = (s: Simulation) => {
        const t0 = cpuMs();
        try { f(s); } finally { taskMs.set(name, (taskMs.get(name) ?? 0) + cpuMs() - t0); }
      };
    }
    for (const t of schedulerOf(sim).tasks) {
      const f = t.step.bind(t);
      const name = t.name;
      (t as { step: (s: Simulation) => void }).step = (s: Simulation) => {
        const t0 = cpuMs();
        try { f(s); } finally { taskMs.set(name, (taskMs.get(name) ?? 0) + cpuMs() - t0); }
      };
    }
    return { sim, st, label, mode, taskMs, day0: st.day };
  };
  const A = await mk('js'), B = await mk('wasm');
  const tasks = [...schedulerOf(A.sim).tasks.map((t) => t.name), ...A.sim.systems.filter((x) => x.daily).map((x) => `${x.name}.daily`)];
  log(`# ${A.label}: pop ${A.st.stats.population}, day ${A.day0}; infra tasks ${tasks.join(', ')}; chunks of ${chunk} days; load ${loadAvg().join(' ')}`);
  const runChunk = (X: typeof A) => {
    G.__searchMode = X.mode;
    setSimWasmPreference(X.mode === 'js' ? 'js' : 'auto');
    const s = (G.__searchStats ??= { road: 0, transit: 0, acc: 0, roadMs: 0, transitMs: 0, accMs: 0 });
    s.road = s.transit = s.acc = s.roadMs = s.transitMs = s.accMs = 0;
    (s as Stats & { timeMs?: number; distMs?: number }).timeMs = 0;
    (s as Stats & { timeMs?: number; distMs?: number }).distMs = 0;
    X.taskMs.clear();
    const t0 = cpuMs();
    for (let d = 0; d < chunk; d++) X.sim.advanceDay();
    const ms = (cpuMs() - t0) / chunk;
    const per: Record<string, number> = {};
    for (const [k, v] of X.taskMs) per[k] = v / chunk;
    const sx = s as Stats & { timeMs?: number; distMs?: number };
    return { ms, tasks: per, searchMs: (s.roadMs + s.transitMs + s.accMs) / chunk, calls: (s.road + s.transit + s.acc) / chunk, catchMs: ((sx.timeMs ?? 0) + (sx.distMs ?? 0)) / chunk };
  };
  for (let k = 0; k < warm; k++) { runChunk(A); runChunk(B); }
  const pairs = Math.max(1, Math.floor(days / chunk) - warm);
  const ra: ReturnType<typeof runChunk>[] = [], rb: ReturnType<typeof runChunk>[] = [];
  for (let k = 0; k < pairs; k++) {
    let a, b;
    if (k % 2 === 0) { a = runChunk(A); b = runChunk(B); } else { b = runChunk(B); a = runChunk(A); }
    ra.push(a); rb.push(b);
    if (k < 2 || k % 10 === 9) log(`chunk ${k}: js ${a.ms.toFixed(1)} ms/day (traffic ${(a.tasks.traffic ?? 0).toFixed(1)}, search ${a.searchMs.toFixed(2)}) | wasm ${b.ms.toFixed(1)} ms/day (traffic ${(b.tasks.traffic ?? 0).toFixed(1)}, search ${b.searchMs.toFixed(2)})`);
  }
  G.__searchMode = 'js';
  setSimWasmPreference('auto');
  const ratioOf = (f: (x: ReturnType<typeof runChunk>) => number) => {
    const r = ra.map((a, k) => (f(rb[k]) > 0 && f(a) > 0 ? f(rb[k]) / f(a) : NaN)).filter((v) => v === v);
    if (r.length < 3) return null;
    const ci = bootstrapMedianCI(r);
    return { speedup: 1 / median(r), ci: [1 / ci.hi, 1 / ci.lo] };
  };
  const summary = (xs: ReturnType<typeof runChunk>[]) => {
    const t: Record<string, number> = {};
    for (const n of tasks) t[n] = median(xs.map((x) => x.tasks[n] ?? 0));
    return { msPerDay: median(xs.map((x) => x.ms)), searchMsPerDay: median(xs.map((x) => x.searchMs)), searchCallsPerDay: median(xs.map((x) => x.calls)), catchMsPerDay: xs.reduce((q, x) => q + x.catchMs, 0) / xs.length, tasks: t };
  };
  const res = {
    fixture: A.label, pop0: A.st.stats.population, days: (warm + pairs) * chunk, chunk, pairs,
    js: summary(ra), wasm: summary(rb),
    total: ratioOf((x) => x.ms), traffic: ratioOf((x) => x.tasks.traffic ?? 0), search: ratioOf((x) => x.searchMs),
    services: ratioOf((x) => x.tasks.services ?? 0), emergencyDaily: ratioOf((x) => x.tasks['emergency.daily'] ?? 0),
    wasmPaths: { ...searchWasmStats },
    identity: {} as Record<string, unknown>,
    load: loadAvg(),
  };
  log(`whole sim: js ${res.js.msPerDay.toFixed(1)} ms/day, wasm ${res.wasm.msPerDay.toFixed(1)} ms/day -> ${res.total?.speedup.toFixed(3)}x [${res.total?.ci.map((v) => v.toFixed(3)).join(', ')}]`);
  log(`traffic task: js ${res.js.tasks.traffic?.toFixed(2)} ms/day, wasm ${res.wasm.tasks.traffic?.toFixed(2)} ms/day -> ${res.traffic?.speedup.toFixed(3)}x [${res.traffic?.ci.map((v) => v.toFixed(3)).join(', ')}]`);
  log(`inside search.ts: js ${res.js.searchMsPerDay.toFixed(2)} ms/day (${res.js.searchCallsPerDay.toFixed(1)} calls/day), wasm ${res.wasm.searchMsPerDay.toFixed(2)} ms/day -> ${res.search ? `${res.search.speedup.toFixed(2)}x [${res.search.ci.map((v) => v.toFixed(2)).join(', ')}]` : 'n/a (too few chunks with search calls)'}`);
  log(`services task: ${res.services ? `${res.services.speedup.toFixed(3)}x [${res.services.ci.map((v) => v.toFixed(3)).join(', ')}]` : 'n/a'}; emergency.daily: ${res.emergencyDaily ? `${res.emergencyDaily.speedup.toFixed(3)}x [${res.emergencyDaily.ci.map((v) => v.toFixed(3)).join(', ')}]` : 'n/a'}; catchment searches (mean ms/day) js ${res.js.catchMsPerDay.toFixed(2)} wasm ${res.wasm.catchMsPerDay.toFixed(2)}`);
  log(`tasks js (ms/day): ${Object.entries(res.js.tasks).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`);
  log(`tasks wasm (ms/day): ${Object.entries(res.wasm.tasks).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`);
  // ---- identity: JS-vs-JS baseline, then JS-vs-wasm
  const save = (st: typeof A.st) => serializeCity(st, { copy: true });
  const skipSave = (k: string) => k === 'savedAt';
  const skipTr = (k: string, v: unknown) => isSearchLike(v) || k === 'heap' || TIMING.has(k) || k === 'sim' || k === 'events';
  if (baseline) {
    const C = await mk('js');
    G.__searchMode = 'js';
    setSimWasmPreference('js');
    const total = (warm + pairs) * chunk;
    for (let d = 0; d < total; d++) C.sim.advanceDay();
    setSimWasmPreference('auto');
    const base = deepDiff(save(A.st), save(C.st), 'save', [], new WeakSet(), skipSave);
    res.identity.jsVsJs = base;
    log(`JS vs JS after ${total} days: ${base.length === 0 ? 'identical' : 'DIFFERENT ' + base.slice(0, 4).join('; ')}`);
  }
  const d1 = deepDiff(save(A.st), save(B.st), 'save', [], new WeakSet(), skipSave);
  const d2 = deepDiff(A.sim.getSystem('traffic'), B.sim.getSystem('traffic'), 'traffic', [], new WeakSet(), skipTr);
  res.identity.jsVsWasm = d1;
  res.identity.trafficState = d2;
  log(`JS vs wasm after ${res.days} days: city ${d1.length === 0 ? 'identical' : 'DIFFERENT ' + d1.slice(0, 4).join('; ')}; traffic state ${d2.length === 0 ? 'identical' : 'DIFFERENT ' + d2.slice(0, 4).join('; ')}; population ${A.st.stats.population} / ${B.st.stats.population}`);
  log(`# load after ${loadAvg().join(' ')}`);
  return res;
});
