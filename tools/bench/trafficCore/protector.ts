/**
 * V8's ArrayBuffer-detaching protector in benchmark arms. The first detach of any ArrayBuffer in an isolate (a
 * memory.grow of a wasm memory, a postMessage transfer list, ArrayBuffer.prototype.transfer, and in NODE the web
 * streams of undici: Blob.stream / DecompressionStream / Response.arrayBuffer, i.e. bundle.ts unpackFile) invalidates
 * it for good: from then on every typed-array access of optimized code in that isolate carries a detach check. A fair
 * A/B therefore keeps it intact in every arm (fixtures gunzipped with zlib in node, a pre-sized wasm memory that never
 * grows, no transfer lists) unless an arm invalidates it on purpose ('-inv' arms: the game's main thread today, where
 * lodBuilder's postMessage transfer list invalidates it).
 */

/**
 * a probe of the protector: an optimized typed-array loop deoptimizes when the protector is invalidated, so the probe
 * reports an invalidation that happens AFTER it was made — make it first thing in the isolate. null when natives
 * syntax is off (node --allow-natives-syntax / chromium --js-flags=--allow-natives-syntax)
 */
export function makeProtectorProbe(): (() => boolean) | null {
  try {
    const ta = new Float32Array(64);
    const probe = new Function('a', 'let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s;') as (a: Float32Array) => number;
    const prep = new Function('f', 'a', '%PrepareFunctionForOptimization(f); f(a); f(a); %OptimizeFunctionOnNextCall(f); f(a);') as (f: unknown, a: unknown) => void;
    const status = new Function('f', 'return %GetOptimizationStatus(f);') as (f: unknown) => number;
    prep(probe, ta);
    const s0 = status(probe);
    return () => { probe(ta); return status(probe) === s0; };
  } catch {
    return null;
  }
}

/** detach an ArrayBuffer: invalidates the protector of this isolate for good */
export function invalidateProtector(): void {
  const b = new ArrayBuffer(8) as ArrayBuffer & { transfer?: () => ArrayBuffer };
  if (typeof b.transfer === 'function') b.transfer();
  else structuredClone(b, { transfer: [b] });
}
