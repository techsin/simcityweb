/**
 * Field-pass A/B — browser Web Worker entry (bundled for the browser by tools/bench/fieldPasses.bench.mjs, run in
 * Playwright Chromium). The same captures, arms, bit-exactness check and runAB protocol as the node side, with the
 * worker's performance.now() as the clock (wall time: CPU time is not available in browsers; interleaving and the
 * paired-ratio CI keep it usable under load).
 *
 * Message in: { caps: string[] (URLs of capture files), simd: URL, scalar: URL | null, reps: number, cases?: string[] }.
 * Messages out: { log } lines, then { done: true, result }.
 */
import { formatResult, runAB, type AbResult } from '../ab';
import { CASES, checkArms, decodeCapture, fairArm, instantiate, origArm, wasmArm, type CaseName, type FieldArm } from './core';

interface Job { caps: string[]; simd: string; scalar: string | null; reps: number; cases?: string[] }

const post = (m: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);
const log = (line: string) => post({ log: line });

async function run(job: Job): Promise<Record<string, unknown>> {
  const simd = await WebAssembly.compile(await (await fetch(job.simd)).arrayBuffer());
  const scalar = job.scalar ? await WebAssembly.compile(await (await fetch(job.scalar)).arrayBuffer()) : null;
  const cases = (job.cases ?? CASES) as CaseName[];
  const abOpts = { reps: job.reps, clockName: 'wall (worker performance.now)', warmupMs: 600, minSampleMs: 20 };
  // clock granularity: the smallest non-zero step of performance.now() (5 µs when cross-origin isolated, else 100 µs)
  let tick = Infinity;
  for (let k = 0, t0 = performance.now(); k < 20000; k++) { const t = performance.now(); if (t > t0) { tick = Math.min(tick, t - t0); t0 = t; } }
  const isolated = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  log(`# worker: crossOriginIsolated ${isolated}, performance.now() step ${(tick * 1000).toFixed(1)} µs; samples >= ${abOpts.minSampleMs} ms, ${job.reps} interleaved pairs`);
  const out: Record<string, unknown> = { userAgent: navigator.userAgent, crossOriginIsolated: isolated, clockStepUs: tick * 1000 };
  for (const url of job.caps) {
    const cap = decodeCapture(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    const m = cap.meta;
    log(`## ${m.name}: N ${m.N}, population ${m.population}`);
    const wSimd = instantiate(simd), wScalar = scalar ? instantiate(scalar) : null;
    const arms: Record<string, FieldArm> = {
      orig: origArm(cap), fair: fairArm(cap), simdRes: wasmArm(cap, wSimd, 'wasm SIMD resident', true), simdStaged: wasmArm(cap, wSimd, 'wasm SIMD staged', false),
    };
    if (wScalar) arms.scalarRes = wasmArm(cap, wScalar, 'wasm scalar resident', true);
    checkArms(Object.values(arms));
    log(`bit-exact in Chromium: ${Object.values(arms).map((a) => a.label).join(', ')}`);
    const pairs: [string, string, string][] = [
      ['as-is vs fair JS', 'orig', 'fair'], ['fair JS vs wasm SIMD resident', 'fair', 'simdRes'], ['fair JS vs wasm SIMD staged', 'fair', 'simdStaged'],
      ['as-is vs wasm SIMD resident', 'orig', 'simdRes'],
    ];
    if (wScalar) pairs.push(['wasm scalar vs SIMD build (resident)', 'scalarRes', 'simdRes']);
    const results: Record<string, AbResult[]> = {};
    for (const kind of cases) {
      results[kind] = [];
      for (const [label, a, b] of pairs) {
        const A = arms[a], B = arms[b];
        const ka: CaseName = a === 'orig' && kind === 'nimbyNoCache' ? 'nimby' : kind, kb: CaseName = b === 'orig' && kind === 'nimbyNoCache' ? 'nimby' : kind;
        const r = runAB({ name: `${kind} ${label}`, a: () => A.run(ka), b: () => B.run(kb), aLabel: A.label, bLabel: B.label }, abOpts);
        results[kind].push(r);
        log(formatResult(r));
      }
    }
    out[m.name] = { meta: m, results };
    for (const a of Object.values(arms)) a.dispose();
  }
  return out;
}

self.onmessage = (e: MessageEvent<Job>) => {
  run(e.data).then(
    (result) => post({ done: true, result }),
    (err) => post({ done: true, error: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) }),
  );
};
