/**
 * Field-pass A/B — Chromium page entry for the CPU-time mode (`fieldPasses.bench.mjs browser-cpu`): the same captures,
 * arms, cases and bit-exactness check as browser.ts / node.ts, but run on the page's MAIN thread and driven sample by
 * sample from node, which reads the renderer main thread's CPU time (CDP Performance.getMetrics → ThreadTime) before and
 * after every sample: a browser measurement that, unlike performance.now(), does not count the time the thread spends
 * descheduled on a loaded machine.
 *
 * window.__fp: load(capUrl, simdUrl, scalarUrl) → meta + arm names; check() (throws on any difference); warm(a, b, case,
 * ms) → calls / wall per side; run(arm, case, inner); dispose(). Arms: orig, fair, simdRes, simdStaged, scalarRes.
 */
import { checkArms, decodeCapture, fairArm, instantiate, origArm, wasmArm, type CaseName, type CaptureMeta, type FieldArm } from './core';

let arms: Record<string, FieldArm> = {};
let mods: { simd: WebAssembly.Module; scalar: WebAssembly.Module | null } | null = null;

async function bytes(url: string): Promise<ArrayBuffer> {
  return (await fetch(url)).arrayBuffer();
}

const api = {
  async load(capUrl: string, simdUrl: string, scalarUrl: string | null): Promise<{ meta: CaptureMeta; arms: Record<string, string> }> {
    api.dispose();
    if (!mods) mods = { simd: await WebAssembly.compile(await bytes(simdUrl)), scalar: scalarUrl ? await WebAssembly.compile(await bytes(scalarUrl)) : null };
    const cap = decodeCapture(new Uint8Array(await bytes(capUrl)));
    const wSimd = instantiate(mods.simd), wScalar = mods.scalar ? instantiate(mods.scalar) : null;
    arms = { orig: origArm(cap), fair: fairArm(cap), simdRes: wasmArm(cap, wSimd, 'wasm SIMD resident', true), simdStaged: wasmArm(cap, wSimd, 'wasm SIMD staged', false) };
    if (wScalar) arms.scalarRes = wasmArm(cap, wScalar, 'wasm scalar resident', true);
    return { meta: cap.meta, arms: Object.fromEntries(Object.entries(arms).map(([k, a]) => [k, a.label])) };
  },
  /** every arm bit-exact against the original on every case (throws on the first difference) */
  check(): string {
    checkArms(Object.values(arms));
    return Object.values(arms).map((a) => a.label).join(', ');
  },
  /** alternate a / b for at least `ms` of wall time each (JIT tiers up); returns calls and wall ms per side */
  warm(a: string, b: string, ka: CaseName, kb: CaseName, ms: number): { calls: number; wa: number; wb: number } {
    const A = arms[a], B = arms[b];
    let wa = 0, wb = 0, calls = 0;
    const t00 = performance.now();
    while ((wa < ms || wb < ms || calls < 30) && performance.now() - t00 < 30 * ms) {
      let t0 = performance.now();
      A.run(ka);
      wa += performance.now() - t0;
      t0 = performance.now();
      B.run(kb);
      wb += performance.now() - t0;
      calls++;
    }
    return { calls, wa, wb };
  },
  run(arm: string, c: CaseName, inner: number): void {
    const A = arms[arm];
    for (let k = 0; k < inner; k++) A.run(c);
  },
  dispose(): void {
    for (const a of Object.values(arms)) a.dispose();
    arms = {};
  },
};

(globalThis as unknown as { __fp: typeof api }).__fp = api;
