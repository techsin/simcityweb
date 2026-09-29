/**
 * adoptLayers — prototype of "CityState layers live in wasm linear memory" without touching CityState.ts: every own
 * typed-array field of an object (and every array-of-typed-arrays field, e.g. CityState.desirability) is moved into
 * the kernel heap, so kernels run on the layers in place (zero copies per call).
 *
 * What it does (and what a real CityState integration needs, see wasm/README.md "Memory model"):
 *  1. one heap.reserve() for all layers up front (a safe point: nothing else holds views yet), then one allocArray()
 *     per layer, contents copied, the field replaced by the wasm view;
 *  2. an onGrow listener re-creates the fields' views if memory ever grows later (local aliases such as
 *     `const L = st.crime` held by running code are NOT fixed — hence the no-growth-while-running rule in heap.ts);
 *  3. release() copies the layers back into plain typed arrays and frees the blocks (city unload / replaceState).
 * Save / load needs nothing extra: serializeCity({copy:true}) slices (standalone buffers), deserializeCity .set()s
 * into the fresh state's arrays, and bundle / recovery code honours byteOffset / byteLength.
 */
import type { HeapArray, HeapArrayCtor, WasmHeap } from './heap';

export interface AdoptedLayers {
  readonly heap: WasmHeap;
  /** adopted field names (array fields once) */
  readonly keys: readonly string[];
  /** number of typed arrays adopted */
  readonly arrays: number;
  /** bytes of layer data adopted */
  readonly bytes: number;
  /** re-create every adopted view after memory growth (also runs automatically on heap growth) */
  rebind(): void;
  /** move the layers back into plain typed arrays and free their blocks */
  release(): void;
}

const isTA = (v: unknown): v is HeapArray => ArrayBuffer.isView(v) && !(v instanceof DataView);

export function adoptLayers(
  obj: object,
  heap: WasmHeap,
  opts: { include?: (key: string, v: HeapArray) => boolean; reserveExtra?: number } = {},
): AdoptedLayers {
  const rec = obj as Record<string, unknown>;
  const include = opts.include ?? (() => true);
  const singles: string[] = [];
  const lists: string[] = [];
  let bytes = 0;
  let arrays = 0;
  for (const key of Object.keys(rec)) {
    const v = rec[key];
    if (isTA(v)) {
      if (heap.ptrOf(v) >= 0 || !include(key, v)) continue;
      singles.push(key);
      bytes += Math.ceil(v.byteLength / 16) * 16;
      arrays++;
    } else if (Array.isArray(v) && v.length > 0 && v.every(isTA)) {
      if ((v as HeapArray[]).some((a) => heap.ptrOf(a) >= 0) || !include(key, v[0] as HeapArray)) continue;
      lists.push(key);
      for (const a of v as HeapArray[]) bytes += Math.ceil(a.byteLength / 16) * 16;
      arrays += v.length;
    }
  }
  heap.reserve(bytes + (opts.reserveExtra ?? 0));
  const move = (a: HeapArray): HeapArray => {
    const n = heap.allocArray(a.constructor as HeapArrayCtor, a.length);
    (n as unknown as { set(src: ArrayLike<number>): void }).set(a as unknown as ArrayLike<number>);
    return n;
  };
  for (const key of singles) rec[key] = move(rec[key] as HeapArray);
  for (const key of lists) rec[key] = (rec[key] as HeapArray[]).map(move);

  const rebind = (): void => {
    for (const key of singles) rec[key] = heap.refresh(rec[key] as HeapArray);
    for (const key of lists) rec[key] = (rec[key] as HeapArray[]).map((a) => heap.refresh(a));
  };
  const off = heap.onGrow(rebind);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    off();
    rebind();
    const back = (a: HeapArray): HeapArray => {
      const c = a.slice() as HeapArray;
      heap.free(a);
      return c;
    };
    for (const key of singles) rec[key] = back(rec[key] as HeapArray);
    for (const key of lists) rec[key] = (rec[key] as HeapArray[]).map(back);
  };
  return { heap, keys: [...singles, ...lists], arrays, bytes, rebind, release };
}
