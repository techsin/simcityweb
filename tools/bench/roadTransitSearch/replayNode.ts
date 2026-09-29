/**
 * Replay A/B (node, CPU time on an otherwise idle worker thread): every captured search.ts call of a traffic cycle,
 * through the original JS, the fair optimised JS (src/wasm/js/roadTransitSearch.ts), the wasm bindings with resident
 * searches (zero copy) and in copy mode (plain Search objects: outputs copied out, i.e. marshalling included), and the
 * scalar build of the same Rust (second wasm instance, same binding code). Every implementation is first verified
 * bit-identical to the original in lockstep over the whole capture.
 *   args: --capture FILE [--scalar FILE.wasm] [--reps 31] [--warmup 600] [--quick] [--json out.json]
 */
import { readFileSync, existsSync } from 'node:fs';
import * as js from '../../../src/sim/infra/search';
import * as P from '../../../src/sim/infra/params';
import { Network } from '../../../src/core/types';
import { makeSearchKernels, type SearchApi } from '../../../src/wasm/kernels/searchBind';
import { makeFairSearch } from '../../../src/wasm/js/roadTransitSearch';
import { initSimWasmSync, simWasmInstance, simWasmStatus } from '../../../src/wasm/simWasm';
import { instanceFrom } from './instance';
import { runAB, formatResult, type AbResult } from '../ab';
import { benchMain, cpuMs, loadAvg } from '../node';
import { decodeCapture, callLabel } from './captureFormat';
import { groups, makeReplay, prepare, snapshotAccStates, verifyLockstep, type Impl } from './replay';

const PARAMS = { NET_TIME: P.NET_TIME, RAMP_PENALTY: P.RAMP_PENALTY, SUBWAY_TIME: P.SUBWAY_TIME, BUS_TIME_FACTOR: P.BUS_TIME_FACTOR, HIGHWAY: Network.Highway };

export function implsFor(api: SearchApi, name: string, residentSearch: boolean): Impl {
  return {
    name,
    newSearch: residentSearch ? () => new api.Search() : () => new js.Search(),
    roadSearch: api.roadSearch as Impl['roadSearch'],
    transitSearch: api.transitSearch as Impl['transitSearch'],
    accumulate: api.accumulate,
  };
}

benchMain(({ args, log }) => {
  const opt = (k: string, d?: string) => (args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : d);
  const quick = args.includes('--quick');
  const reps = Number(opt('--reps', quick ? '15' : '31'));
  const warmupMs = Number(opt('--warmup', quick ? '300' : '600'));
  const file = opt('--capture')!;
  const scalarFile = opt('--scalar');
  if (!initSimWasmSync()) throw new Error('wasm init failed: ' + simWasmStatus().error);
  const st = simWasmStatus();
  const cap = decodeCapture(new Uint8Array(readFileSync(file)));
  const Pp = prepare(cap, js.Seeds);
  log(`# capture ${file}: ${JSON.stringify(cap.meta)}`);
  log(`# wasm ${st.source} (${st.bytes} B, simd ${st.features?.simd128}); load ${loadAvg().join(' ')}`);

  const W = makeSearchKernels(js, PARAMS);
  const F = makeFairSearch(PARAMS);
  const impls: Record<string, Impl> = {
    js: { name: 'js', newSearch: () => new js.Search(), roadSearch: js.roadSearch as Impl['roadSearch'], transitSearch: js.transitSearch as Impl['transitSearch'], accumulate: js.accumulate },
    fair: { name: 'fair-js', newSearch: () => new js.Search(), roadSearch: F.roadSearch, transitSearch: F.transitSearch, accumulate: F.accumulate },
    wasm: implsFor(W, 'wasm', true),
    copy: implsFor(W, 'wasm-copy', false),
  };
  if (scalarFile && existsSync(scalarFile)) {
    const si = instanceFrom(new Uint8Array(readFileSync(scalarFile)), scalarFile);
    impls.scalar = implsFor(makeSearchKernels(js, PARAMS, { instance: () => si, onError: (e) => { throw e; } }), 'wasm-scalar', true);
    log(`# scalar build: ${scalarFile} (${si.bytes} B, simd ${si.features.simd128})`);
  }
  void simWasmInstance;

  // ---- lockstep verification over the whole capture
  const verified: Record<string, number> = {};
  for (const k of Object.keys(impls)) {
    if (k === 'js') continue;
    const fails = verifyLockstep(cap, Pp, impls.js, impls[k]);
    verified[k] = fails.length;
    log(`verify ${impls[k].name.padEnd(11)} vs original over ${cap.calls.length} calls: ${fails.length === 0 ? 'bit-identical' : 'MISMATCH ' + fails.slice(0, 3).join('; ')}`);
    if (fails.length) throw new Error(`${k} is not bit-identical: ${fails[0]}`);
  }

  // ---- A/B units: per call kind, the first full cycle, all captured cycles
  const G = groups(cap);
  const starts = (cap.meta.cycleStarts as number[] | undefined) ?? [0];
  const fullCycle = (() => {
    // the first cycle that recomputes inbound / shop / freight (traffic does every other cycle)
    for (let c = 0; c < starts.length; c++) {
      const a = starts[c], b = c + 1 < starts.length ? starts[c + 1] : cap.calls.length;
      const idx = Array.from({ length: b - a }, (_, i) => a + i);
      if (idx.some((i) => callLabel(cap.calls[i]) === 'road:shop')) return idx;
    }
    return cap.calls.map((_, i) => i);
  })();
  const units: [string, number[]][] = [];
  for (const [k, idx] of G) units.push([`${k} (x${idx.length})`, idx]);
  units.push([`one full cycle (${fullCycle.length} calls)`, fullCycle]);
  if (starts.length > 1) units.push([`${starts.length} cycles (${cap.calls.length} calls)`, cap.calls.map((_, i) => i)]);

  const accStates: Record<string, ReturnType<typeof snapshotAccStates>> = {};
  const accState = (k: string) => (accStates[k] ??= snapshotAccStates(cap, Pp, impls[k]));
  const replayOf = (k: string, idx: number[]) => {
    const onlyAcc = idx.every((i) => cap.calls[i].kind === 'acc');
    return makeReplay(cap, Pp, impls[k], idx, onlyAcc ? accState(k) : undefined);
  };
  const pairs: [string, string][] = [['js', 'wasm'], ['js', 'fair'], ['fair', 'wasm'], ['js', 'copy']];
  if (impls.scalar) pairs.push(['scalar', 'wasm']);
  const results: (AbResult & { unit: string; pair: string })[] = [];
  const opts = { clock: cpuMs, clockName: 'cpu', reps, warmupMs };
  for (const [unit, idx] of units) {
    for (const [a, b] of pairs) {
      if (unit.startsWith('accumulate') && (a === 'fair' || b === 'fair')) continue; // fair JS accumulate = the original loop
      const A = replayOf(a, idx), B = replayOf(b, idx);
      const r = runAB({ name: unit, a: A.run, b: B.run, aLabel: impls[a].name, bLabel: impls[b].name }, opts);
      log(formatResult(r));
      results.push({ ...r, unit, pair: `${a}/${b}` });
    }
  }
  log(`# load after ${loadAvg().join(' ')}`);
  return { meta: cap.meta, wasm: { source: st.source, bytes: st.bytes, simd: st.features?.simd128 }, verified, results };
});
