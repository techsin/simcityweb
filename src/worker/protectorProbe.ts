/**
 * Dev only: a probe of V8's ArrayBuffer-detaching protector in this isolate (WORKER_DESIGN §5.4, risk 7). The first
 * detach of any ArrayBuffer (a transfer list, a wasm memory.grow, ArrayBuffer.prototype.transfer) invalidates the
 * protector for good, and every typed-array access in optimized code then carries a detach check. An optimized
 * typed-array loop deoptimizes at that moment, so the probe sees a detach that happens after it was made: the worker
 * makes it first, before the city is deserialized and before the wasm loader runs (fetch, instantiateStreaming, the
 * arrayBuffer() fallback). The same technique as tests/perf/protectorChild.ts and tools/bench/trafficCore/protector.ts.
 *
 * null unless natives syntax is on (Chromium `--js-flags=--allow-natives-syntax`, `node --allow-natives-syntax`) and the
 * loop TurboFan code. The result is sticky: a later re-optimization cannot hide an earlier detach,
 * so call it often.
 */
export function makeProtectorProbe(): (() => boolean) | null {
  try {
    const ta = new Float32Array(64);
    const probe = new Function('a', 'let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s;') as (a: Float32Array) => number;
    const prep = new Function('f', 'a', '%PrepareFunctionForOptimization(f); f(a); f(a); %OptimizeFunctionOnNextCall(f); f(a);') as (f: unknown, a: unknown) => void;
    const status = new Function('f', 'return %GetOptimizationStatus(f);') as (f: unknown) => number;
    prep(probe, ta);
    // TurboFan code (status bit 64) depends on the protector and deoptimizes on a detach. Node's V8 optimizes this loop
    // with TurboFan at once; Chromium 153's gives Maglev code (status 41), which checks the length on every access and
    // does not deoptimize (docs/dev/reports/local-W1.2-worker.md, the fix round), so warm it up until TurboFan takes it
    let s0 = status(probe);
    for (let i = 0; i < 1 << 19 && !(s0 & 64); i++) { probe(ta); if ((i & 255) === 0) s0 = status(probe); }
    s0 = status(probe);
    if (!(s0 & 64)) return null; // a loop that is not TurboFan code cannot observe an invalidation
    let intact = true;
    return () => { probe(ta); intact = intact && status(probe) === s0; return intact; };
  } catch {
    return null; // natives syntax off (a SyntaxError), or eval blocked
  }
}
