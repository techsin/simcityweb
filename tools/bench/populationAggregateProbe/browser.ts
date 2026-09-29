/**
 * Population aggregate probe — browser Web Worker entry (bundled for the browser with plugins.mjs: frozen-tree redirect
 * + __probeCache exposure; served and driven in headless Chromium by tools/bench/populationAggregateProbe.bench.mjs).
 *
 * Message in: { fixtures: {url, name}[], simd: string, scalar: string | null, warm, reps, kinds, pairs }.
 * Messages out: { log } lines, then { done: true, result } or { done: true, error }.
 * The worker loads each fixture with the frozen sim ITSELF (deserialize + Simulation + warm days, in this realm), so
 * arms A / B0 / E run on Building objects with the hidden classes this engine gave them; then the same arms, the same
 * bit-exactness check and the same pairs as the node entry. Clock: performance.now() in the worker (wall clock — the
 * only clock a browser has; samples >= 10 ms, interleaved pairs, medians).
 */
import { deserializeCity, type SerializedCity } from '../../../src/save/serialize';
import { unpackFile } from '../../../src/save/bundle';
import { Simulation } from '../../../src/sim/Simulation';
import { createSystems } from '../../../src/sim/systems/index';
import { ARM_INFO, DAY_KINDS, checkArms, checkDays, dayOfKind, instantiate, makeArms, type DayKind } from './core';
import { PAIRS, logSummary, runPairs, weightedSpeedups, worldOfSim } from './pairs';

interface Msg {
  fixtures: { url: string; name: string }[];
  simd: string;
  scalar: string | null;
  warm: number;
  reps: number;
  kinds: DayKind[];
  pairs: string | null;
}

const post = (m: unknown) => (self as unknown as { postMessage(x: unknown): void }).postMessage(m);
const log = (line: string) => post({ log: line });

async function compile(url: string): Promise<WebAssembly.Module> {
  const res = await fetch(url);
  return WebAssembly.compile(await res.arrayBuffer());
}

async function run(m: Msg): Promise<unknown> {
  const simd = instantiate(await compile(m.simd));
  const scalar = m.scalar ? instantiate(await compile(m.scalar)) : null;
  const kinds = (m.kinds?.length ? m.kinds : DAY_KINDS) as DayKind[];
  const pairs = m.pairs ? PAIRS.filter(([a, b]) => m.pairs!.split(',').includes(`${a}:${b}`)) : PAIRS;
  const ua = (self as unknown as { navigator: { userAgent: string } }).navigator.userAgent;
  const out: Record<string, unknown> = { userAgent: ua, reps: m.reps, warm: m.warm, arms: ARM_INFO, clock: 'performance.now() (worker, wall)' };
  log(`# ${ua}; ${m.reps} interleaved pairs per comparison; clock performance.now() in a worker`);
  for (const f of m.fixtures) {
    const t0 = performance.now();
    const bytes = new Uint8Array(await (await fetch(f.url)).arrayBuffer());
    const st = deserializeCity((await unpackFile(bytes)) as SerializedCity);
    const sim = new Simulation(st, createSystems());
    const t1 = performance.now();
    for (let d = 0; d < m.warm; d++) sim.advanceDay();
    const world = worldOfSim(sim, f.name);
    log(`\n# ${f.name}: load + init ${(t1 - t0).toFixed(0)} ms, ${m.warm} warm days ${(performance.now() - t1).toFixed(0)} ms (wall); day ${st.day}, ` +
      `population ${st.stats.population}, growables ${world.rt.growables.length}`);
    const arms = makeArms(world, { simd, scalar });
    const days = checkDays(dayOfKind(st.day, 'demo'));
    const n = checkArms(world, arms, days);
    log(`# bit-exact: every arm identical to A on days ${days.join(', ')} (${n} comparisons)`);
    const kr = runPairs(world, arms, pairs, kinds, m.reps, () => performance.now(), 'wall(worker)', log, 300, 10);
    checkArms(world, arms, checkDays(dayOfKind(st.day, 'demo'), 1));
    log('# bit-exact again after timing');
    const summary = logSummary(world, kr, log);
    out[f.name] = { population: world.population, growables: world.rt.growables.length, day: st.day, kinds: kr, summary, weighted: weightedSpeedups(kr) };
    for (const a of Object.values(arms)) a.dispose();
  }
  return out;
}

self.onmessage = (e: MessageEvent<Msg>) => {
  run(e.data).then(
    (result) => post({ done: true, result }),
    (err) => post({ done: true, error: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) }),
  );
};
