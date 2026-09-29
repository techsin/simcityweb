/** wall-clock profiling fields of the traffic system (phase timings; only frames-mode scheduling reads them) */
export const TIMING = new Set(['phaseMs', 'lastCycleMs', 'lastCycleMs0']);

/** deep comparison of two simulation objects / saves: typed arrays bytewise, plain values structurally */
export function deepDiff(a: unknown, b: unknown, path = '$', out: string[] = [], seen = new WeakSet<object>(), skip: (k: string, v: unknown) => boolean = () => false): string[] {
  if (out.length >= 12) return out;
  if (ArrayBuffer.isView(a) && !(a instanceof DataView)) {
    if (!ArrayBuffer.isView(b) || (b as ArrayBufferView).byteLength !== (a as ArrayBufferView).byteLength) { out.push(`${path}: shape`); return out; }
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength), y = new Uint8Array((b as ArrayBufferView).buffer, (b as ArrayBufferView).byteOffset, (b as ArrayBufferView).byteLength);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { out.push(`${path}: byte ${i}`); break; }
    return out;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (!(Object.is(a, b) || (a !== a && b !== b))) out.push(`${path}: ${a} vs ${b}`);
    return out;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b && !(typeof a === 'function' && typeof b === 'function')) out.push(`${path}: ${String(a).slice(0, 40)} vs ${String(b).slice(0, 40)}`);
    return out;
  }
  if (seen.has(a as object)) return out;
  seen.add(a as object);
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) { out.push(`${path}: map size ${a.size} vs ${b.size}`); return out; }
    for (const [k, v] of a) deepDiff(v, b.get(k), `${path}<${String(k)}>`, out, seen, skip);
    return out;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) out.push(`${path}: set size`);
    return out;
  }
  const ka = Object.keys(a as object).filter((k) => !skip(k, (a as Record<string, unknown>)[k]));
  for (const k of ka) deepDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out, seen, skip);
  return out;
}

/** a Search-like object (its stale regions may legitimately differ between implementations: compare defined parts) */
export const isSearchLike = (v: unknown): boolean =>
  !!v && typeof v === 'object' && 'dist' in (v as object) && 'order' in (v as object) && 'settled' in (v as object) && 'hops' in (v as object);

/** the observable part of two searches equal (dist bits, src, next, done on [0, n), hops where reached, order[0, settled)) */
export function sameSearch(a: { n: number; settled: number; dist: Float64Array; src: Int32Array; next: Int32Array; done: Uint8Array; hops: Uint16Array; order: Int32Array }, b: typeof a): boolean {
  if (a.n !== b.n || a.settled !== b.settled) return false;
  for (let v = 0; v < a.n; v++) {
    if (!Object.is(a.dist[v], b.dist[v]) || a.src[v] !== b.src[v] || a.next[v] !== b.next[v] || a.done[v] !== b.done[v]) return false;
    if (a.dist[v] < Infinity && a.hops[v] !== b.hops[v]) return false;
  }
  for (let k = 0; k < a.settled; k++) if (a.order[k] !== b.order[k]) return false;
  return true;
}
