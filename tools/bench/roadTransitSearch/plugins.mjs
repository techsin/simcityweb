/**
 * rolldown plugins for the roadTransitSearch benchmarks (tools/bench/roadTransitSearch.bench.mjs).
 *
 *  - the benchmark cores import the live simulation sources; with `tree` set to another checkout (e.g. the frozen
 *    snapshot of commit 24f8609, which the kernels were ported from and the 1M fixtures were saved with) those imports
 *    resolve into that tree instead, so a benchmark is not disturbed by concurrent edits of the live sim.
 *  - every module of that tree that imports src/sim/infra/search.ts gets a virtual module instead (no file is edited):
 *      mode 'swap':    per-simulation dispatch. `globalThis.__searchMode` = 'js' -> the ORIGINAL search.ts (its Search
 *                      class and functions, untouched), 'wasm' -> the bindings (src/wasm/kernels/searchBind.ts built
 *                      around that tree's search.ts + params). The mode is read when a Search is constructed and on
 *                      every call, so two simulations built under different modes run side by side, interleaved.
 *                      Per-call CPU timers accumulate into globalThis.__searchStats.
 *      mode 'capture': the original functions, plus a recorder (globalThis.__searchCapture) that snapshots every
 *                      call's inputs (graph arrays once per version, node times, seeds, limits, transit nets, flows)
 *                      for replay.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VIRTUAL = '\0rts-search';

export function searchPlugins({ tree = REPO, mode = 'swap', secondary = false } = {}) {
  const SEARCH = join(tree, 'src', 'sim', 'infra', 'search.ts');
  const PARAMS = join(tree, 'src', 'sim', 'infra', 'params.ts');
  const TYPES = join(tree, 'src', 'core', 'types.ts');
  const BIND = join(REPO, 'src', 'wasm', 'kernels', 'searchBind.ts');
  const HERE = join(REPO, 'tools', 'bench', 'roadTransitSearch');
  const plugins = [
    {
      // the benchmark cores import the LIVE sources (so they typecheck with the project); with another tree, those
      // imports (src/** except src/wasm/**, tests/**) are redirected to the same paths inside that tree
      name: 'rts-tree-redirect',
      resolveId(source, importer) {
        if (tree === REPO || !importer || !importer.startsWith(HERE) || !source.startsWith('.')) return null;
        const abs = resolve(dirname(importer), source);
        const rel = abs.slice(REPO.length + 1);
        if (!(rel.startsWith('src' + sep) || rel.startsWith('tests' + sep)) || rel.startsWith(join('src', 'wasm') + sep)) return null;
        const t = join(tree, rel);
        return t.endsWith('.ts') ? t : existsSync(t + '.ts') ? t + '.ts' : join(t, 'index.ts');
      },
    },
  ];
  if (mode === 'none') return plugins;
  plugins.push({
    name: 'rts-search-switch',
    resolveId(source, importer) {
      if (!importer || importer === VIRTUAL || importer.startsWith(join(REPO, 'src', 'wasm')) || importer.includes('roadTransitSearch')) return null;
      if (!(source === './search' || source.endsWith('/infra/search') || source.endsWith('/infra/search.ts'))) return null;
      const abs = resolve(dirname(importer), source.endsWith('.ts') ? source : source + '.ts');
      return abs === SEARCH ? VIRTUAL : null;
    },
    load(id) {
      if (id !== VIRTUAL) return null;
      const head = `
import * as js from ${JSON.stringify(SEARCH)};
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const stats = (globalThis.__searchStats ??= { road: 0, transit: 0, acc: 0, roadMs: 0, transitMs: 0, accMs: 0 });
`;
      if (mode === 'capture') {
        return head + `
const cap = (globalThis.__searchCapture ??= { on: false, calls: [], graphs: new Map(), searches: new Map(), nextS: 0 });
const sid = (S) => { let k = cap.searches.get(S); if (k === undefined) cap.searches.set(S, (k = cap.nextS++)); return k; };
const seedCopy = (s) => ({ n: s.n, node: s.node.slice(0, s.n), label: s.label.slice(0, s.n), id: s.id.slice(0, s.n) });
export const Search = js.Search;
export const Seeds = js.Seeds;
export function roadSearch(g, adj, time, S, heap, seeds, limit, ramp) {
  if (cap.on) {
    const key = g.version + ':' + g.n;
    if (!cap.graphs.has(key)) cap.graphs.set(key, { n: g.n, version: g.version, fwd: g.fwd.slice(0, 4 * g.n), rev: g.rev.slice(0, 4 * g.n), type: g.type.slice(0, g.n) });
    cap.calls.push({ kind: 'road', graph: key, dir: adj === g.fwd ? 'fwd' : adj === g.rev ? 'rev' : 'other', adj: adj === g.fwd || adj === g.rev ? null : adj.slice(0, 4 * g.n),
      time: time.slice(0, g.n), S: sid(S), seeds: seedCopy(seeds), limit: limit === undefined ? 400 : limit, ramp: ramp ? ramp.slice(0, g.n) : null });
  }
  const t0 = cpu();
  try { return js.roadSearch(g, adj, time, S, heap, seeds, limit, ramp); } finally { stats.roadMs += cpu() - t0; stats.road++; if (cap.on) cap.calls[cap.calls.length - 1].settled = S.settled; }
}
export function transitSearch(T, S, heap, seeds, limit) {
  if (cap.on) {
    const nTr = T.trStart[T.total];
    cap.calls.push({ kind: 'transit', S: sid(S), seeds: seedCopy(seeds), limit: limit === undefined ? 400 : limit, T: {
      nR: T.nR, nRail: T.nRail, nSub: T.nSub, nFerry: T.nFerry ?? 0, total: T.total, railTime: T.railTime, subTime: T.subTime,
      roadAdj: T.roadAdj.slice(0, 4 * T.nR), busTime: T.busTime.slice(0, T.nR), railAdj: T.railAdj.slice(0, 4 * T.nRail), subAdj: T.subAdj.slice(0, 4 * T.nSub),
      trStart: T.trStart.slice(0, T.total + 1), trTo: T.trTo.slice(0, nTr), trCost: T.trCost.slice(0, nTr) } });
  }
  const t0 = cpu();
  try { return js.transitSearch(T, S, heap, seeds, limit); } finally { stats.transitMs += cpu() - t0; stats.transit++; if (cap.on) cap.calls[cap.calls.length - 1].settled = S.settled; }
}
export function accumulate(S, acc, onSink) {
  if (cap.on) cap.calls.push({ kind: 'acc', S: sid(S), acc: acc.slice(0, S.n), f64: acc instanceof Float64Array, sink: !!onSink, settled: S.settled });
  const t0 = cpu();
  try { return js.accumulate(S, acc, onSink); } finally { stats.accMs += cpu() - t0; stats.acc++; }
}
`;
      }
      return head + `
import * as P from ${JSON.stringify(PARAMS)};
import { Network } from ${JSON.stringify(TYPES)};
import { makeSearchKernels } from ${JSON.stringify(BIND)};
const k = makeSearchKernels(js, { NET_TIME: P.NET_TIME, RAMP_PENALTY: P.RAMP_PENALTY, SUBWAY_TIME: P.SUBWAY_TIME, BUS_TIME_FACTOR: P.BUS_TIME_FACTOR, HIGHWAY: Network.Highway });
const wasm = () => globalThis.__searchMode === 'wasm';
/** constructed under the current mode: the original class (js) or the resident WasmSearch (wasm) */
export function Search() { return wasm() ? new k.Search() : new js.Search(); }
export const Seeds = js.Seeds;
export function roadSearch(...a) { const t0 = cpu(); try { return wasm() ? k.roadSearch(...a) : js.roadSearch(...a); } finally { stats.roadMs += cpu() - t0; stats.road++; } }
export function transitSearch(...a) { const t0 = cpu(); try { return wasm() ? k.transitSearch(...a) : js.transitSearch(...a); } finally { stats.transitMs += cpu() - t0; stats.transit++; } }
export function accumulate(...a) { const t0 = cpu(); try { return wasm() ? k.accumulate(...a) : js.accumulate(...a); } finally { stats.accMs += cpu() - t0; stats.acc++; } }
`;
    },
  });
  if (mode === 'swap' && secondary) plugins.push(...secondaryPlugins(tree));
  return plugins;
}

/**
 * opt-in ('swap' mode, `secondary: true`): the other searches of the Rust search module in their real systems —
 * catchments.ts roadTimeMulti / roadDistMulti (services) through a virtual catchments module (everything else
 * re-exported), and emergency.ts's DispatchSearch / ChunkedSearch through a source transform of emergency.ts that
 * constructs them per mode (the original classes stay in the file untouched). Mode is read at construction / call.
 */
function secondaryPlugins(tree) {
  const CATCH = join(tree, 'src', 'sim', 'infra', 'catchments.ts');
  const EMERG = join(tree, 'src', 'sim', 'infra', 'emergency.ts');
  const PARAMS = join(tree, 'src', 'sim', 'infra', 'params.ts');
  const TYPES = join(tree, 'src', 'core', 'types.ts');
  const CATCH_BIND = join(REPO, 'src', 'wasm', 'kernels', 'catchSearchBind.ts');
  const EM_BIND = join(REPO, 'src', 'wasm', 'kernels', 'emergencySearchBind.ts');
  const VCATCH = '\0rts-catch';
  return [
    {
      name: 'rts-catch-switch',
      resolveId(source, importer) {
        if (!importer || importer === VCATCH || importer.startsWith(join(REPO, 'src', 'wasm'))) return null;
        if (!(source === './catchments' || source.endsWith('/infra/catchments') || source.endsWith('/infra/catchments.ts'))) return null;
        const abs = resolve(dirname(importer), source.endsWith('.ts') ? source : source + '.ts');
        return abs === CATCH ? VCATCH : null;
      },
      load(id) {
        if (id !== VCATCH) return null;
        return `
import * as orig from ${JSON.stringify(CATCH)};
import * as P from ${JSON.stringify(PARAMS)};
import { Network } from ${JSON.stringify(TYPES)};
import { makeCatchmentSearchKernels } from ${JSON.stringify(CATCH_BIND)};
export * from ${JSON.stringify(CATCH)};
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const stats = (globalThis.__searchStats ??= { road: 0, transit: 0, acc: 0, roadMs: 0, transitMs: 0, accMs: 0 });
const k = makeCatchmentSearchKernels(orig, { WALK_COST: P.WALK_COST, DRIVE_COST: P.DRIVE_COST, RAMP_COST: P.RAMP_COST, HIGHWAY: Network.Highway, STREET: Network.Street });
const wasm = () => globalThis.__searchMode === 'wasm';
export function roadTimeMulti(...a) { const t0 = cpu(); try { return wasm() ? k.roadTimeMulti(...a) : orig.roadTimeMulti(...a); } finally { stats.timeMs = (stats.timeMs ?? 0) + cpu() - t0; stats.time = (stats.time ?? 0) + 1; } }
export function roadDistMulti(...a) { const t0 = cpu(); try { return wasm() ? k.roadDistMulti(...a) : orig.roadDistMulti(...a); } finally { stats.distMs = (stats.distMs ?? 0) + cpu() - t0; stats.dist = (stats.dist ?? 0) + 1; } }
`;
      },
    },
    {
      name: 'rts-emergency-switch',
      transform(code, id) {
        if (id !== EMERG) return null;
        const a = 'private ds = new DispatchSearch();', b = 'private cs = new ChunkedSearch();';
        if (!code.includes(a) || !code.includes(b)) throw new Error('rts-emergency-switch: emergency.ts no longer constructs its searches as expected');
        return code.replace(a, 'private ds = __rtsNewDS();').replace(b, 'private cs = __rtsNewCS();') + `
import { makeEmergencySearchKernels as __rtsMk } from ${JSON.stringify(EM_BIND)};
const __rtsK = __rtsMk({ NET_TIME, RAMP_PENALTY, HIGHWAY: Network.Highway });
function __rtsNewDS(): DispatchSearch { return ((globalThis as { __searchMode?: string }).__searchMode === 'wasm' ? new __rtsK.DispatchSearch() : new DispatchSearch()) as DispatchSearch; }
function __rtsNewCS(): ChunkedSearch { return ((globalThis as { __searchMode?: string }).__searchMode === 'wasm' ? new __rtsK.ChunkedSearch() : new ChunkedSearch()) as ChunkedSearch; }
`;
      },
    },
  ];
}

export default searchPlugins;
