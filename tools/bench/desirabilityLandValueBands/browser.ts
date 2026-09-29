/**
 * Desirability / land-value band A/B — browser Web Worker entry (bundled for the browser with plugins.mjs's tree redirect;
 * served and driven in headless Chromium by tools/bench/desirabilityLandValueBands.bench.mjs).
 *
 * Message in: { caps: string[] (URLs of band captures), simd: string, scalar: string | null, reps: number }.
 * Messages out: { log: string } lines, then { done: true, result } or { done: true, error }.
 * Same arms / sweeps / bit-exactness check as the node entry; the clock is performance.now() in this worker (wall
 * clock: the only clock a browser has; 100 µs granularity without cross-origin isolation, samples are >= 15 ms).
 */
import { ECON_TABLES } from '../../../src/wasm/kernels/desirabilityLandValueBands';
import { runAB, formatResult, type AbResult } from '../ab';
import { SWEEPS, bandsOf, checkArms, decodeCapture, fixedArm, instantiate, origArm, sweep, wasmArm, type Arm } from './core';

interface Msg { caps: string[]; simd: string; scalar: string | null; reps: number }

const post = (m: unknown) => (self as unknown as { postMessage(x: unknown): void }).postMessage(m);
const log = (line: string) => post({ log: line });

async function compile(url: string): Promise<WebAssembly.Module> {
  const res = await fetch(url);
  return WebAssembly.compile(await res.arrayBuffer());
}

async function run(m: Msg): Promise<unknown> {
  const simd = await compile(m.simd);
  const scalar = m.scalar ? await compile(m.scalar) : null;
  const out: Record<string, unknown> = { userAgent: (self as unknown as { navigator: { userAgent: string } }).navigator.userAgent, reps: m.reps };
  log(`# ${out.userAgent}; ${m.reps} interleaved pairs per case; clock performance.now() (worker)`);
  for (const url of m.caps) {
    const cap = decodeCapture(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    log(`\n## ${cap.name}: N ${cap.N}, day ${cap.day}, population ${cap.population}`);
    const wSimd = instantiate(simd), wScalar = scalar ? instantiate(scalar) : null;
    const arms: Record<string, Arm> = {
      orig: origArm(cap),
      fixed: fixedArm(cap, ECON_TABLES),
      simdRes: wasmArm(cap, ECON_TABLES, wSimd, 'wasm SIMD resident', true),
      simdStaged: wasmArm(cap, ECON_TABLES, wSimd, 'wasm SIMD staged', false),
    };
    if (wScalar) arms.scalarRes = wasmArm(cap, ECON_TABLES, wScalar, 'wasm scalar resident', true);
    checkArms(Object.values(arms), cap.N);
    log(`bit-exact: ${Object.values(arms).map((a) => a.label).join(', ')} identical after every band of 3 sweeps`);
    const bands = bandsOf(cap.N);
    const pairs: [string, string, string][] = [
      ['as-is vs fair JS', 'orig', 'fixed'],
      ['fair JS vs wasm SIMD resident', 'fixed', 'simdRes'],
      ['fair JS vs wasm SIMD staged', 'fixed', 'simdStaged'],
      ['as-is vs wasm SIMD resident', 'orig', 'simdRes'],
    ];
    if (wScalar) pairs.push(['wasm scalar vs SIMD build (resident)', 'scalarRes', 'simdRes']);
    const results: Record<string, AbResult[]> = {};
    for (const kind of SWEEPS) {
      results[kind] = [];
      log(`\n### ${kind}: one full sweep = ${bands.length} daily bands`);
      for (const [label, a, b] of pairs) {
        const A = arms[a], B = arms[b];
        const r = runAB({ name: `${kind} ${label}`, a: () => sweep(A, kind, bands), b: () => sweep(B, kind, bands), aLabel: A.label, bLabel: B.label },
          { reps: m.reps, clock: () => performance.now(), clockName: 'wall(worker)', warmupMs: 500, minSampleMs: 15 });
        results[kind].push(r);
        log(formatResult(r));
      }
    }
    out[cap.name] = { population: cap.population, day: cap.day, results };
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
