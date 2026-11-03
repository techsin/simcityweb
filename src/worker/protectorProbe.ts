/**
 * Dev only: a probe of V8's ArrayBuffer-detaching protector in this isolate (WORKER_DESIGN §5.4, risk 7). Where V8 has
 * that protector (node 22's V8 does), the first detach of any ArrayBuffer (a transfer list, a wasm memory.grow,
 * ArrayBuffer.prototype.transfer) invalidates it for good, and every typed-array access in optimized code then carries a
 * detach check. TurboFan code of a typed-array loop depends on the protector and deoptimizes at that moment, so the probe
 * sees a detach that happens after it was made: the worker makes it first, before the city is deserialized and before
 * the wasm loader runs (fetch, instantiateStreaming, the arrayBuffer() fallback). The same technique as
 * tests/perf/protectorChild.ts and tools/bench/trafficCore/protector.ts.
 *
 * Chromium 153's V8 has no ArrayBufferDetaching protector: a detach deoptimizes this loop in no isolate and V8 traces no
 * invalidation, while a protector it has (ArraySpecies) is traced and deoptimizes the code that depends on it. There the
 * probe reads intact whatever ran, so tools/qa-worker.mjs runs both controls first and counts the probe as evidence only
 * where a detach deoptimizes it (docs/dev/reports/local-W1.2-worker.md, the fix round).
 *
 * The tier is read with %ActiveTierIsTurbofan, not with %GetOptimizationStatus's bits, whose layout differs between V8
 * versions (node 22's V8 reads this loop's TurboFan code as 81, Chromium 153's as 41). The loop is warmed up until
 * TurboFan takes it, as a hot loop would be, with %FinalizeOptimization installing the background compile.
 *
 * null unless natives syntax is on (Chromium `--js-flags=--allow-natives-syntax`, `node --allow-natives-syntax`) and the
 * loop reached TurboFan. The result is sticky: a later re-optimization cannot hide an earlier detach, so call it often.
 */
export function makeProtectorProbe(): (() => boolean) | null {
  try {
    const ta = new Float32Array(64);
    const probe = new Function('a', 'let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s;') as (a: Float32Array) => number;
    const turbofan = new Function('f', 'return %ActiveTierIsTurbofan(f);') as (f: unknown) => boolean;
    let finalize: (() => void) | null = null;
    try { finalize = new Function('%FinalizeOptimization();') as () => void; } catch { /* a V8 without it: calls alone */ }
    for (let i = 0; i < 1 << 20 && !turbofan(probe); i++) {
      probe(ta);
      if ((i & 1023) === 1023 && finalize) { try { finalize(); } catch { finalize = null; } }
    }
    if (!turbofan(probe)) return null; // a loop that is not TurboFan code cannot observe an invalidation
    let intact = true;
    return () => { probe(ta); intact = intact && turbofan(probe); return intact; };
  } catch {
    return null; // natives syntax off (a SyntaxError), or eval blocked
  }
}

/**
 * The browser worker isolate's probe, made when this module is evaluated. simWorker.ts imports this module first, so the
 * probe predates every other module of the worker's bundle as well as the init message (a TurboFan loop compiled after an
 * invalidation carries the detach checks and never deoptimizes, so a probe made late cannot see what came before it).
 * null on main, in node (simWorker's boot makes the probe there, before the city and the wasm loader) and without
 * natives syntax.
 */
export const WORKER_ISOLATE_PROBE: (() => boolean) | null =
  typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope ? makeProtectorProbe() : null;
