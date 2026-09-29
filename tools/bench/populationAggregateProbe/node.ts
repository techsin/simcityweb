/**
 * Population aggregate probe — node micro-benchmark (bundled by tools/bench/populationAggregateProbe.bench.mjs with the
 * frozen-tree redirect + the __probeCache exposure; runs on an otherwise idle worker thread, CPU time).
 *
 *   node populationAggregateProbe.node.mjs --fixture F.metropolis [--fixture G …] [--warm 8] [--reps 31]
 *        [--simd sim_kernels.wasm] [--scalar sim_kernels.scalar.wasm] [--capture-dir DIR] [--capture-only]
 *        [--kinds plain,sample,demo] [--pairs A:B,A:C,…] [--out out.json]
 *
 * Per fixture: load it with the tree's own save code, simulate --warm days (headless, all systems), then build the
 * arms over the population system's REAL rt.growables (Building objects with the shapes the sim gave them), its real
 * DemographicsCache.wf and the traffic system's real accessById (core.ts makeArms). Every arm is checked bit-exact
 * against arm A on demo / plain / sample days (twice, same call sequence), then each pair is timed with runAB
 * (tools/bench/ab.ts: warm-up, >= 31 interleaved order-alternated pairs, CPU time, median / min, 95 % bootstrap CI of
 * the paired ratio) on each day kind, and the outputs are checked again. --capture-dir writes the world's inputs (the
 * equivalence test's real fixtures).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserializeCity, type SerializedCity } from '../../../src/save/serialize';
import { unpackFile } from '../../../src/save/bundle';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { benchMain, cpuMs, loadAvg } from '../node';
import { type ProbeJs, ARM_INFO, DAY_KINDS, captureWorld, checkArms, checkDays, dayOfKind, encodeCapture, instantiate, makeArms, type DayKind, type ProbeWorld } from './core';
import { PAIRS, logSummary, runPairs, weightedSpeedups, worldOfSim } from './pairs';
// arm B's private copy of the fair-JS module (own inline-cache feedback; plugins.mjs jsCopy)
import * as jsBCopy from 'popagg:js-b';

async function loadWorld(file: string, warm: number, log: (s: string) => void): Promise<ProbeWorld> {
  const name = file.split('/').pop()!.replace(/\.metropolis$/, '');
  const c0 = cpuMs();
  const st = deserializeCity((await unpackFile(new Uint8Array(readFileSync(file)))) as SerializedCity);
  const sim = new Simulation(st, createSystems());
  const c1 = cpuMs();
  for (let d = 0; d < warm; d++) sim.advanceDay();
  const world = worldOfSim(sim, name);
  log(`# ${name}: loaded + init ${(c1 - c0).toFixed(0)} ms CPU, ${warm} warm days ${(cpuMs() - c1).toFixed(0)} ms CPU; day ${st.day}, population ` +
    `${st.stats.population}, growables ${world.rt.growables.length}, cache.wf ${world.cache.wf.length}`);
  return world;
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
  const result: Record<string, unknown> = { arms: ARM_INFO, pairs, reps, warm, kinds, clock: 'process.cpuUsage (idle main thread)', loadBefore: loadAvg() };
  for (const file of fixtures) {
    const world = await loadWorld(file, warm, log);
    if (capDir) {
      mkdirSync(capDir, { recursive: true });
      const f = join(capDir, `${world.name}.w${warm}.pagc`);
      writeFileSync(f, encodeCapture(captureWorld(world)));
      log(`# capture -> ${f}`);
    }
    if (args.includes('--capture-only')) continue;
    const arms = makeArms(world, { simd, scalar, jsB: jsBCopy as unknown as ProbeJs });
    const days = checkDays(dayOfKind(world.sim.state.day, 'demo'));
    const nCmp = checkArms(world, arms, days);
    log(`# bit-exact: ${Object.keys(arms).filter((a) => a !== 'A').join(', ')} identical to A on days ${days.join(', ')} (${nCmp} comparisons; SoA gathers identical)`);
    const l0 = loadAvg();
    const kr = runPairs(world, arms, pairs, kinds, reps, cpuMs, 'cpu', log);
    // outputs still identical after the timing runs
    checkArms(world, arms, checkDays(dayOfKind(world.sim.state.day, 'demo'), 1));
    log(`# bit-exact again after timing; load average ${l0.join(' ')} -> ${loadAvg().join(' ')}`);
    const summary = logSummary(world, kr, log);
    const weighted = weightedSpeedups(kr);
    const stats: Record<string, unknown> = {};
    for (const [k, a] of Object.entries(arms)) if (a.stats) stats[k] = { ...a.stats };
    result[world.name] = { population: world.population, growables: world.rt.growables.length, day: world.sim.state.day, load: { before: l0, after: loadAvg() },
      kinds: kr, summary, weighted, stats };
    for (const a of Object.values(arms)) a.dispose();
  }
  result.loadAfter = loadAvg();
  const jsonOut = opt('--out');
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 1));
  return result;
});
