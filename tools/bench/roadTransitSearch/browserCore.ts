/**
 * Browser replay A/B (main thread or Web Worker): the node replay's units and pairs, timed with performance.now()
 * (browsers expose no CPU clock; the machine's load inflates wall time, so medians / minima of interleaved pairs are
 * reported). Every implementation is verified bit-identical in lockstep before it is timed.
 */
import * as js from '../../../src/sim/infra/search';
import * as P from '../../../src/sim/infra/params';
import { Network } from '../../../src/core/types';
import { makeSearchKernels } from '../../../src/wasm/kernels/searchBind';
import { makeFairSearch } from '../../../src/wasm/js/roadTransitSearch';
import { initSimWasm, simWasmStatus } from '../../../src/wasm/simWasm';
import { runAB, type AbResult } from '../ab';
import { decodeCapture, callLabel } from './captureFormat';
import { groups, makeReplay, prepare, snapshotAccStates, verifyLockstep, type Impl } from './replay';
import { instanceFrom } from './instance';

export interface SuiteOptions {
  reps: number;
  warmupMs: number;
  scalar: boolean;
  where: string;
  log: (s: string) => void;
}

export async function runBrowserSuite(o: SuiteOptions): Promise<{ where: string; status: unknown; verified: Record<string, number>; results: (AbResult & { unit: string; pair: string })[] }> {
  const PARAMS = { NET_TIME: P.NET_TIME, RAMP_PENALTY: P.RAMP_PENALTY, SUBWAY_TIME: P.SUBWAY_TIME, BUS_TIME_FACTOR: P.BUS_TIME_FACTOR, HIGHWAY: Network.Highway };
  const base = (globalThis as { location?: { href: string } }).location?.href ?? '';
  if (!(await initSimWasm(new URL('/sim_kernels.wasm', base)))) throw new Error('wasm init failed: ' + simWasmStatus().error);
  const cap = decodeCapture(new Uint8Array(await (await fetch(new URL('/capture.bin', base))).arrayBuffer()));
  const Pp = prepare(cap, js.Seeds);
  const W = makeSearchKernels(js, PARAMS);
  const F = makeFairSearch(PARAMS);
  const impls: Record<string, Impl> = {
    js: { name: 'js', newSearch: () => new js.Search(), roadSearch: js.roadSearch as Impl['roadSearch'], transitSearch: js.transitSearch as Impl['transitSearch'], accumulate: js.accumulate },
    fair: { name: 'fair-js', newSearch: () => new js.Search(), roadSearch: F.roadSearch, transitSearch: F.transitSearch, accumulate: F.accumulate },
    wasm: { name: 'wasm', newSearch: () => new W.Search(), roadSearch: W.roadSearch as Impl['roadSearch'], transitSearch: W.transitSearch as Impl['transitSearch'], accumulate: W.accumulate },
    copy: { name: 'wasm-copy', newSearch: () => new js.Search(), roadSearch: W.roadSearch as Impl['roadSearch'], transitSearch: W.transitSearch as Impl['transitSearch'], accumulate: W.accumulate },
  };
  if (o.scalar) {
    const si = instanceFrom(new Uint8Array(await (await fetch(new URL('/scalar.wasm', base))).arrayBuffer()), 'scalar.wasm');
    const S2 = makeSearchKernels(js, PARAMS, { instance: () => si, onError: (e) => { throw e; } });
    impls.scalar = { name: 'wasm-scalar', newSearch: () => new S2.Search(), roadSearch: S2.roadSearch as Impl['roadSearch'], transitSearch: S2.transitSearch as Impl['transitSearch'], accumulate: S2.accumulate };
  }
  const verified: Record<string, number> = {};
  for (const k of Object.keys(impls)) {
    if (k === 'js') continue;
    const f = verifyLockstep(cap, Pp, impls.js, impls[k]);
    verified[k] = f.length;
    o.log(`[${o.where}] verify ${impls[k].name}: ${f.length === 0 ? 'bit-identical' : 'MISMATCH ' + f[0]}`);
    if (f.length) throw new Error(`${k} not bit-identical: ${f[0]}`);
  }
  const G = groups(cap);
  const starts = (cap.meta.cycleStarts as number[] | undefined) ?? [0];
  let full = cap.calls.map((_, i) => i);
  for (let c = 0; c < starts.length; c++) {
    const a = starts[c], b = c + 1 < starts.length ? starts[c + 1] : cap.calls.length;
    const idx = Array.from({ length: b - a }, (_, i) => a + i);
    if (idx.some((i) => callLabel(cap.calls[i]) === 'road:shop')) { full = idx; break; }
  }
  const units: [string, number[]][] = [];
  for (const k of ['road:round', 'transit', 'accumulate']) if (G.has(k)) units.push([`${k} (x${G.get(k)!.length})`, G.get(k)!]);
  units.push([`one full cycle (${full.length} calls)`, full]);
  const accStates: Record<string, ReturnType<typeof snapshotAccStates>> = {};
  const replayOf = (k: string, idx: number[]) => {
    const onlyAcc = idx.every((i) => cap.calls[i].kind === 'acc');
    return makeReplay(cap, Pp, impls[k], idx, onlyAcc ? (accStates[k] ??= snapshotAccStates(cap, Pp, impls[k])) : undefined);
  };
  // js vs fair-js is measured in node; the browser run keeps the comparisons that matter for the port
  const pairs: [string, string][] = [['js', 'wasm'], ['fair', 'wasm'], ['js', 'copy']];
  if (impls.scalar) pairs.push(['scalar', 'wasm']);
  const results: (AbResult & { unit: string; pair: string })[] = [];
  for (const [unit, idx] of units) {
    for (const [a, b] of pairs) {
      if (unit.startsWith('accumulate') && (a === 'fair' || b === 'fair')) continue;
      const A = replayOf(a, idx), B = replayOf(b, idx);
      const r = runAB({ name: unit, a: A.run, b: B.run, aLabel: impls[a].name, bLabel: impls[b].name }, { reps: o.reps, warmupMs: o.warmupMs, minSampleMs: 10, clockName: 'wall' });
      o.log(`[${o.where}] ${unit.padEnd(28)} ${r.a.label} ${r.a.median.toFixed(3)} ms (min ${r.a.min.toFixed(3)}) | ${r.b.label} ${r.b.median.toFixed(3)} ms (min ${r.b.min.toFixed(3)}) -> ${r.speedup.median.toFixed(2)}x [${r.speedup.lo.toFixed(2)}, ${r.speedup.hi.toFixed(2)}]`);
      results.push({ ...r, unit, pair: `${a}/${b}` });
    }
  }
  return { where: o.where, status: simWasmStatus(), verified, results };
}
