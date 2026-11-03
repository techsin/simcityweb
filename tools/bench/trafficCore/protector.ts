/**
 * V8's ArrayBuffer-detaching protector in benchmark arms. While it holds, optimized code accesses typed arrays without a
 * detach check; once it is invalidated (for good, per isolate), every typed-array access of optimized code carries one.
 * What invalidates it depends on the V8. In node 22's V8: the first detach of any ArrayBuffer (a memory.grow of a wasm
 * memory, a postMessage transfer list, ArrayBuffer.prototype.transfer, and in NODE the web streams of undici: Blob.stream /
 * DecompressionStream / Response.arrayBuffer, i.e. bundle.ts unpackFile). Chromium 153's V8 tracks array buffer views: a
 * detach of a buffer with no view or exactly one TypedArray view leaves it intact (the view is updated in place: such a
 * transfer is free), and a detach of a buffer with two or more views, a DataView or a detach key invalidates it. A fair
 * A/B therefore keeps it intact in every arm (fixtures gunzipped with zlib in node, a pre-sized wasm memory that never
 * grows, no transfer lists) unless an arm invalidates it on purpose ('-inv' arms: the game's main thread on a V8 that
 * invalidates on any detach, where lodBuilder's postMessage transfer list of single-view buffers invalidates it).
 * Chromium 153 keeps the page's protector through those transfers, and invalidateProtector() below detaches a buffer
 * with no view, so there an '-inv' arm keeps it too, as the page does (its probe reports it).
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

/** detach an ArrayBuffer with no view: invalidates the protector of this isolate for good where any detach does (node
 *  22's V8); Chromium 153's V8 leaves it intact (a buffer with two or more views, a DataView or a detach key would not) */
export function invalidateProtector(): void {
  const b = new ArrayBuffer(8) as ArrayBuffer & { transfer?: () => ArrayBuffer };
  if (typeof b.transfer === 'function') b.transfer();
  else structuredClone(b, { transfer: [b] });
}
