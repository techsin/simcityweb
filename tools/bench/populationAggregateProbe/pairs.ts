/**
 * Population aggregate probe — the comparison list and runner shared by the node and browser benchmarks
 * (environment-agnostic; the simulation modules come from the benchmark's tree via the bundler redirect).
 */
import type { Simulation } from '../../../src/sim/Simulation';
import { getDef } from '../../../src/sim/catalog';
import type { OrigCache, OrigRuntime } from '../../../tests/wasm/populationAggregateOriginal';
import { formatResult, runAB, type AbResult } from '../ab';
import { DAY_KINDS, DAY_WEIGHTS, dayOfKind, type Arm, type DayKind, type ProbeWorld } from './core';

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

/** the probe world of a live Simulation built with the plugins' __probeCache exposure */
export function worldOfSim(sim: Simulation, name: string): ProbeWorld {
  const pop = sim.systems.find((s) => s.name === 'economy.population') as unknown as { rt: OrigRuntime; __probeCache?: OrigCache };
  if (!pop?.__probeCache) throw new Error('the population system does not expose __probeCache (bundle with plugins.mjs exposeCache)');
  return {
    name, sim: sim as unknown as ProbeWorld['sim'], rt: pop.rt, get cache() { return pop.__probeCache!; },
    resolveDef: (id: string) => getDef(id), population: sim.state.stats.population,
  } as ProbeWorld;
}

export type PairResult = AbResult & { question: string };
export interface KindResult {
  kind: DayKind;
  day: number;
  results: PairResult[];
}

/** runAB of every pair on a day of each kind (sim.state.day set per kind, restored after) */
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
      const res: PairResult[] = [];
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

/**
 * per-arm medians per day kind (ms and ns per growable) and the day-weighted mean (24 plain : 7 sample : 1 demo per
 * 32 days). An arm measured in several pairs keeps the median of its first pair (all pairs run the same arm objects).
 */
export function summarize(kinds: KindResult[], n: number): Record<string, Record<string, number>> {
  const per: Record<string, Record<string, number>> = {};
  for (const k of kinds) {
    for (const r of k.results) {
      for (const side of [r.a, r.b]) (per[side.label] ??= {})[k.kind] ??= side.median;
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

/** day-weighted speedup of each pair: exp(Σ w·ln(speedup)) over the kinds (geometric), plus the CI bounds the same way */
export function weightedSpeedups(kinds: KindResult[]): Record<string, { median: number; lo: number; hi: number }> {
  const acc: Record<string, { m: number; lo: number; hi: number; w: number }> = {};
  for (const k of kinds) {
    const w = DAY_WEIGHTS[k.kind];
    for (const r of k.results) {
      const key = `${r.a.label}:${r.b.label}`;
      const e = (acc[key] ??= { m: 0, lo: 0, hi: 0, w: 0 });
      e.m += w * Math.log(r.speedup.median); e.lo += w * Math.log(r.speedup.lo); e.hi += w * Math.log(r.speedup.hi); e.w += w;
    }
  }
  const out: Record<string, { median: number; lo: number; hi: number }> = {};
  for (const [k, e] of Object.entries(acc)) if (e.w > 0.999) out[k] = { median: Math.exp(e.m / e.w), lo: Math.exp(e.lo / e.w), hi: Math.exp(e.hi / e.w) };
  return out;
}

export function logSummary(world: ProbeWorld, kr: KindResult[], log: (s: string) => void): Record<string, Record<string, number>> {
  const n = world.rt.growables.length;
  const summary = summarize(kr, n);
  log(`\n# ${world.name}: per-arm medians (ns per growable on plain / sample / demo days; day-weighted ms per day)`);
  for (const [arm, v] of Object.entries(summary)) {
    log(`  ${arm.padEnd(12)} ${DAY_KINDS.map((k) => (v[`${k}NsPerGrowable`] ?? NaN).toFixed(1).padStart(7)).join(' ')}   ${(v.dayWeightedMs ?? NaN).toFixed(3)} ms/day`);
  }
  return summary;
}
