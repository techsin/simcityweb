/**
 * Population aggregate probe — node micro-benchmark (bundled by tools/bench/populationAggregateProbe.bench.mjs with the
 * frozen-tree redirect + the __probeCache exposure; runs on an otherwise idle worker thread, CPU time).
 *
 *   node populationAggregateProbe.node.mjs --fixture F.metropolis [--fixture G …] [--warm 8] [--reps 31]
 *        [--simd sim_kernels.wasm] [--scalar sim_kernels.scalar.wasm] [--capture-dir DIR] [--kinds plain,sample,demo]
 *        [--pairs A:B,A:C,…] [--json out.json]
 *
 * Per fixture: load it with the tree's own save code, simulate --warm days (headless, all systems), then build the
 * arms over the population system's REAL rt.growables (Building objects with the shapes the sim gave them), its real
 * DemographicsCache.wf and the traffic system's real accessById (core.ts makeArms). Every arm is checked bit-exact
 * against arm A on demo / plain / sample days (twice, same call sequence), then each pair is timed with runAB
 * (tools/bench/ab.ts: warm-up, >= 31 interleaved order-alternated pairs, CPU time, median / min, 95 % bootstrap CI of
 * the paired ratio) on each day kind. --capture-dir writes the world's inputs (the test's real fixtures).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserializeCity, type SerializedCity } from '../../../src/save/serialize';
import { unpackFile } from '../../../src/save/bundle';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { getDef } from '../../../src/sim/catalog';
import type { OrigCache, OrigRuntime } from '../../../tests/wasm/populationAggregateOriginal';
import { formatResult, runAB, type AbResult } from '../ab';
import { benchMain, cpuMs, loadAvg } from '../node';
import {
  ARM_INFO, DAY_KINDS, DAY_WEIGHTS, captureWorld, checkArms, checkDays, dayOfKind, encodeCapture, instantiate, makeArms,
  type Arm, type DayKind, type ProbeWorld,
} from './core';

/** the comparisons (baseline arm, candidate arm, question) */
export const PAIRS: [string, string, string][] = [
  ['A', 'B', 'fair JS without migration (stable shapes + def index)'],
  ['A', 'B0', 'def index alone on the sim\'s own objects'],
  ['A', 'C', 'SoA layout in JS'],
  ['C', 'D', 'language: wasm vs JS on the same SoA'],
  ['A', 'DE', 'wasm if buildings stay objects (gather + wasm)'],
  ['A', 'E', 'the gather alone'],
  ['A', 'CE', 'gather + JS SoA loop'],
  ['Dstaged', 'D', 'marshalling: staged vs resident'],
  ['Dscalar', 'D', 'SIMD build vs scalar build'],
  ['DscalarBlur', 'D', 'explicit f64x2 blur vs scalar blur'],
];

export async function loadWorld(file: string, warm: number, log: (s: string) => void): Promise<{ world: ProbeWorld; sim: Simulation }> {
  const name = file.split('/').pop()!.replace(/\.metropolis$/, '');
  const c0 = cpuMs();
  const st = deserializeCity((await unpackFile(new Uint8Array(readFileSync(file)))) as SerializedCity);
  const systems = createSystems();
  const sim = new Simulation(st, systems);
  const c1 = cpuMs();
  for (let d = 0; d < warm; d++) sim.advanceDay();
  const pop = systems.find((s) => s.name === 'economy.population') as unknown as { rt: OrigRuntime; __probeCache?: OrigCache };
  if (!pop?.__probeCache) throw new Error('the population system does not expose __probeCache (bundle with plugins.mjs exposeCache)');
  log(`# ${name}: loaded + init ${(c1 - c0).toFixed(0)} ms CPU, ${warm} warm days ${(cpuMs() - c1).toFixed(0)} ms CPU; day ${st.day}, population ` +
    `${st.stats.population}, growables ${pop.rt.growables.length}, cache.wf ${pop.__probeCache.wf.length}`);
  const world: ProbeWorld = {
    name, sim: sim as unknown as ProbeWorld['sim'], rt: pop.rt, get cache() { return pop.__probeCache!; },
    resolveDef: (id) => getDef(id), population: st.stats.population,
  } as ProbeWorld;
  return { world, sim };
}

export interface KindResult {
  kind: DayKind;
  day: number;
  results: (AbResult & { question: string; a: AbResult['a']; b: AbResult['b'] })[];
}

export function runPairs(world: ProbeWorld, arms: Record<string, Arm>, pairs: [string, string, string][], kinds: DayKind[], reps: number,
  clock: () => number, clockName: string, log: (s: string) => void, warmupMs = 300, minSampleMs = 10): KindResult[] {
  const st = world.sim.state;
  const day0 = st.day;
  const out: KindResult[] = [];
  try {
    for (const kind of kinds) {
      const day = dayOfKind(day0, kind);
      st.day = day;
      log(`\n## ${world.name}: ${kind} day (day ${day}), ${world.rt.growables.length} growables`);
      const res: KindResult['results'] = [];
      for (const [a, b, q] of pairs) {
        const A = arms[a], B = arms[b];
        if (!A || !B) continue;
        const r = runAB({ name: `${kind} ${a} vs ${b}`, a: () => A.run(), b: () => B.run(), aLabel: a, bLabel: b },
          { reps, clock, clockName, warmupMs, minSampleMs });
        res.push({ ...r, question: q });
        log(`${formatResult(r)}  | ${q}`);
      }
      out.push({ kind, day, results: res });
    }
  } finally {
    st.day = day0;
  }
  return out;
}

/** per-arm per-growable medians (ns) and the day-weighted mean (24 plain : 7 sample : 1 demo per 32 days) */
export function summarize(kinds: KindResult[], n: number): Record<string, Record<string, number>> {
  const per: Record<string, Record<string, number>> = {};
  for (const k of kinds) {
    for (const r of k.results) {
      for (const side of [r.a, r.b]) {
        (per[side.label] ??= {})[k.kind] ??= side.median;
      }
    }
  }
  const out: Record<string, Record<string, number>> = {};
  for (const [arm, v] of Object.entries(per)) {
    out[arm] = {};
    let wsum = 0, wt = 0;
    for (const kind of DAY_KINDS) {
      if (v[kind] === undefined) continue;
      out[arm][`${kind}Ms`] = v[kind];
      out[arm][`${kind}NsPerGrowable`] = (v[kind] * 1e6) / Math.max(1, n);
      wsum += DAY_WEIGHTS[kind] * v[kind];
      wt += DAY_WEIGHTS[kind];
    }
    if (wt > 0.999) out[arm].dayWeightedMs = wsum;
  }
  return out;
}

benchMain(async ({ args, log }) => {
  const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const fixtures = args.flatMap((v, i) => (v === '--fixture' ? [args[i + 1]] : []));
  const warm = Number(opt('--warm', '8'));
  const reps = Number(opt('--reps', '31'));
  const kinds = (opt('--kinds', DAY_KINDS.join(','))!.split(',')) as DayKind[];
  const pairFilter = opt('--pairs')?.split(',');
  const pairs = pairFilter ? PAIRS.filter(([a, b]) => pairFilter.includes(`${a}:${b}`)) : PAIRS;
  const simd = instantiate(new WebAssembly.Module(readFileSync(opt('--simd', 'src/wasm/sim_kernels.wasm')!)));
  const scalarFile = opt('--scalar');
  const scalar = scalarFile ? instantiate(new WebAssembly.Module(readFileSync(scalarFile))) : null;
  const capDir = opt('--capture-dir');
  const result: Record<string, unknown> = { arms: ARM_INFO, pairs, reps, warm, kinds, loadBefore: loadAvg() };
  for (const file of fixtures) {
    const { world } = await loadWorld(file, warm, log);
    if (capDir) {
      mkdirSync(capDir, { recursive: true });
      const f = join(capDir, `${world.name}.w${warm}.pagc`);
      writeFileSync(f, encodeCapture(captureWorld(world)));
      log(`# capture -> ${f}`);
    }
    if (args.includes('--capture-only')) continue;
    const arms = makeArms(world, { simd, scalar });
    const days = checkDays(dayOfKind(world.sim.state.day, 'demo'));
    const nCmp = checkArms(world, arms, days);
    log(`# bit-exact: ${Object.keys(arms).filter((a) => a !== 'A').join(', ')} identical to A on days ${days.join(', ')} (${nCmp} comparisons; SoA gathers identical)`);
    const l0 = loadAvg();
    const kr = runPairs(world, arms, pairs, kinds, reps, cpuMs, 'cpu(process, idle main thread)', log);
    // outputs still identical after the timing runs
    checkArms(world, arms, checkDays(dayOfKind(world.sim.state.day, 'demo'), 1));
    const n = world.rt.growables.length;
    const summary = summarize(kr, n);
    log(`\n# ${world.name}: per-arm medians (ns per growable: plain / sample / demo; day-weighted ms)`);
    for (const [arm, v] of Object.entries(summary)) {
      log(`  ${arm.padEnd(12)} ${DAY_KINDS.map((k) => (v[`${k}NsPerGrowable`] ?? NaN).toFixed(1).padStart(7)).join(' ')}   ${(v.dayWeightedMs ?? NaN).toFixed(3)} ms/day`);
    }
    const stats: Record<string, unknown> = {};
    for (const [k, a] of Object.entries(arms)) if (a.stats) stats[k] = { ...a.stats };
    result[world.name] = { population: world.population, growables: n, day: world.sim.state.day, load: { before: l0, after: loadAvg() }, kinds: kr, summary, stats };
    for (const a of Object.values(arms)) a.dispose();
  }
  result.loadAfter = loadAvg();
  const jsonOut = opt('--out');
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 1));
  return result;
});
