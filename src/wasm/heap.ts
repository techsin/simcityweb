/**
 * WasmHeap — JS-side allocator over the kernels' WebAssembly.Memory (the Rust side has NO allocator: kernels only
 * work on memory the caller hands them). Headless-safe (no DOM / node imports).
 *
 * Model
 *  - [0, heapBase) belongs to Rust (shadow stack, static data). The heap hands out 16-byte aligned blocks above it
 *    (first fit over an address-ordered free list with coalescing; blocks are multiples of 16 bytes).
 *  - Views: allocArray() returns a typed-array VIEW over memory.buffer, registered so refresh(view) can re-create it
 *    after memory.grow (growth DETACHES every view of the old buffer: length 0, reads undefined, writes dropped).
 *  - Growth policy (the one rule that keeps views valid): memory grows only
 *      a) explicitly via reserve(bytes) — call it at a safe point (city creation / load) and then refresh() views, or
 *      b) implicitly for kernel scratch (scratch()) while NO pinned views exist (no allocArray() view is alive).
 *    Once views are handed out, an allocation that needs more memory throws WasmHeapFullError instead of silently
 *    detaching them; kernel wrappers catch it and run the JS kernel.
 *  - scratch(slot, bytes): per-slot cached block for kernel staging / tables (grown on demand, never shrinks).
 */

export type HeapArray =
  | Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
export type HeapArrayCtor<T extends HeapArray = HeapArray> = { new (buffer: ArrayBuffer, byteOffset: number, length: number): T; readonly BYTES_PER_ELEMENT: number };

let slotIds = 0;
/**
 * A process-wide scratch slot id (module-level constant in a binding). Slots of one binding module can be shared by its
 * functions (bindings never run concurrently); each slot caches one block per heap.
 */
export function scratchSlot(): number {
  return slotIds++;
}

export class WasmHeapFullError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'WasmHeapFullError';
  }
}

const PAGE = 65536;
const ALIGN = 16;
const alignUp = (v: number, a: number) => Math.ceil(v / a) * a;

interface ViewRecord {
  ptr: number;
  length: number;
  ctor: HeapArrayCtor;
}

export interface WasmHeapStats {
  /** bytes of linear memory (all pages) */
  capacity: number;
  /** first heap byte (end of the Rust stack + static data) */
  heapBase: number;
  /** bytes in live blocks (arrays + scratch) */
  used: number;
  /** bytes in live allocArray() blocks (pinned views) */
  pinned: number;
  /** high-water mark of the heap (end of the highest block ever used) */
  top: number;
  /** number of memory.grow calls so far */
  grows: number;
}

export class WasmHeap {
  readonly memory: WebAssembly.Memory;
  readonly heapBase: number;
  /** bumps on every memory.grow (views of an older generation are detached) */
  generation = 0;
  grows = 0;
  private top: number;
  /** address-ordered free blocks (parallel arrays) */
  private freePtr: number[] = [];
  private freeSize: number[] = [];
  /** live blocks: ptr -> bytes */
  private live = new Map<number, number>();
  private pinnedBytes = 0;
  private pinnedCount = 0;
  private views = new WeakMap<object, ViewRecord>();
  private slots: { ptr: number; bytes: number }[] = [];
  private listeners: ((heap: WasmHeap) => void)[] = [];
  private buf: ArrayBuffer;
  private _u8: Uint8Array;
  private _i32: Int32Array;
  private _u32: Uint32Array;
  private _f32: Float32Array;
  private _f64: Float64Array;

  constructor(memory: WebAssembly.Memory, heapBase: number) {
    this.memory = memory;
    this.heapBase = alignUp(heapBase, ALIGN);
    this.top = this.heapBase;
    this.buf = memory.buffer;
    this._u8 = new Uint8Array(this.buf);
    this._i32 = new Int32Array(this.buf);
    this._u32 = new Uint32Array(this.buf);
    this._f32 = new Float32Array(this.buf);
    this._f64 = new Float64Array(this.buf);
  }

  // ------------------------------------------------------------------ whole-memory views (refreshed after growth)
  private sync(): void {
    if (this.buf !== this.memory.buffer) {
      this.buf = this.memory.buffer;
      this._u8 = new Uint8Array(this.buf);
      this._i32 = new Int32Array(this.buf);
      this._u32 = new Uint32Array(this.buf);
      this._f32 = new Float32Array(this.buf);
      this._f64 = new Float64Array(this.buf);
    }
  }
  /** Uint8Array over all of linear memory (index = byte offset) */
  get U8(): Uint8Array { this.sync(); return this._u8; }
  /** Int32Array over all of linear memory (index = byte offset >> 2) */
  get I32(): Int32Array { this.sync(); return this._i32; }
  get U32(): Uint32Array { this.sync(); return this._u32; }
  /** Float32Array over all of linear memory (index = byte offset >> 2) */
  get F32(): Float32Array { this.sync(); return this._f32; }
  /** Float64Array over all of linear memory (index = byte offset >> 3) */
  get F64(): Float64Array { this.sync(); return this._f64; }
  get capacity(): number { return this.memory.buffer.byteLength; }

  /** byte offset of `v` if it is a live view into this memory, else -1 (plain array, other memory, or detached) */
  ptrOf(v: ArrayBufferView): number {
    return v.buffer === this.memory.buffer ? v.byteOffset : -1;
  }

  // ------------------------------------------------------------------ allocation
  /**
   * Allocate `bytes` (rounded up to 16) aligned to `align` (power of two >= 16). Grows memory if needed unless views are
   * pinned (then throws WasmHeapFullError; call reserve() at a safe point instead). Contents are NOT zeroed.
   */
  alloc(bytes: number, align = ALIGN): number {
    return this.allocInner(bytes, align, this.pinnedCount === 0);
  }

  private allocInner(bytes: number, align: number, mayGrow: boolean): number {
    if (!(bytes >= 0) || !Number.isFinite(bytes)) throw new RangeError(`WasmHeap.alloc: bad size ${bytes}`);
    align = Math.max(ALIGN, align | 0);
    if ((align & (align - 1)) !== 0) throw new RangeError(`WasmHeap.alloc: align ${align} is not a power of two`);
    const size = alignUp(Math.max(bytes, 1), ALIGN);
    // first fit in the free list
    const fp = this.freePtr, fs = this.freeSize;
    for (let k = 0; k < fp.length; k++) {
      const p = fp[k], s = fs[k];
      const ap = alignUp(p, align);
      const lead = ap - p;
      if (s < lead + size) continue;
      const tail = s - lead - size;
      // replace block k by its leading remainder / trailing remainder (keeps address order)
      if (lead > 0 && tail > 0) {
        fs[k] = lead;
        fp.splice(k + 1, 0, ap + size);
        fs.splice(k + 1, 0, tail);
      } else if (lead > 0) {
        fs[k] = lead;
      } else if (tail > 0) {
        fp[k] = ap + size;
        fs[k] = tail;
      } else {
        fp.splice(k, 1);
        fs.splice(k, 1);
      }
      this.live.set(ap, size);
      return ap;
    }
    // bump
    const ap = alignUp(this.top, align);
    const end = ap + size;
    if (end > this.memory.buffer.byteLength) {
      if (!mayGrow) {
        throw new WasmHeapFullError(
          `WasmHeap: ${size} bytes do not fit (capacity ${this.memory.buffer.byteLength}, top ${this.top}) and pinned views exist; ` +
            'reserve() memory at a safe point before handing out views',
        );
      }
      this.growTo(end);
    }
    if (ap > this.top) this.insertFree(this.top, ap - this.top);
    this.top = end;
    this.live.set(ap, size);
    return ap;
  }

  /** free a block from alloc() (or the block behind an allocArray() view) */
  free(ptrOrView: number | ArrayBufferView): void {
    let ptr: number;
    if (typeof ptrOrView === 'number') ptr = ptrOrView;
    else {
      const rec = this.views.get(ptrOrView);
      if (!rec) throw new Error('WasmHeap.free: view was not allocated by this heap');
      this.views.delete(ptrOrView);
      ptr = rec.ptr;
    }
    const size = this.live.get(ptr);
    if (size === undefined) throw new Error(`WasmHeap.free: ${ptr} is not a live block`);
    this.live.delete(ptr);
    if (typeof ptrOrView !== 'number') {
      this.pinnedBytes -= size;
      this.pinnedCount--;
    }
    this.insertFree(ptr, size);
  }

  private insertFree(ptr: number, size: number): void {
    const fp = this.freePtr, fs = this.freeSize;
    // binary search for the insertion point
    let lo = 0, hi = fp.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fp[mid] < ptr) lo = mid + 1;
      else hi = mid;
    }
    let k = lo;
    fp.splice(k, 0, ptr);
    fs.splice(k, 0, size);
    // coalesce with the next and the previous block
    if (k + 1 < fp.length && fp[k] + fs[k] === fp[k + 1]) {
      fs[k] += fs[k + 1];
      fp.splice(k + 1, 1);
      fs.splice(k + 1, 1);
    }
    if (k > 0 && fp[k - 1] + fs[k - 1] === fp[k]) {
      fs[k - 1] += fs[k];
      fp.splice(k, 1);
      fs.splice(k, 1);
      k--;
    }
    // a free block that ends at the top lowers the top
    if (fp[k] + fs[k] === this.top) {
      this.top = fp[k];
      fp.splice(k, 1);
      fs.splice(k, 1);
    }
  }

  private growTo(end: number): void {
    const cur = this.memory.buffer.byteLength;
    if (end <= cur) return;
    // grow in >= 1 MiB steps (and >= 1/8 of the current size) so repeated small growth stays rare
    const want = Math.max(end - cur, 16 * PAGE, cur >> 3);
    const pages = Math.ceil(want / PAGE);
    try {
      this.memory.grow(pages);
    } catch (e) {
      // e.g. the declared / engine maximum: retry with the exact need before giving up
      const exact = Math.ceil((end - cur) / PAGE);
      if (exact === pages) throw new WasmHeapFullError(`WasmHeap: memory.grow(${pages}) failed: ${String(e)}`);
      try {
        this.memory.grow(exact);
      } catch (e2) {
        throw new WasmHeapFullError(`WasmHeap: memory.grow(${exact}) failed: ${String(e2)}`);
      }
    }
    this.generation++;
    this.grows++;
    this.sync();
    for (const l of this.listeners.slice()) l(this);
  }

  /**
   * Make sure `bytes` more bytes can be allocated without growing (grows now if needed, even with pinned views).
   * Growth detaches existing views: call at a safe point and refresh() them (onGrow listeners are notified).
   */
  reserve(bytes: number): void {
    const need = this.top + alignUp(Math.max(0, bytes), ALIGN);
    if (need > this.memory.buffer.byteLength) this.growTo(need);
  }

  /** listen for memory growth (after it happened); returns an unsubscribe function */
  onGrow(listener: (heap: WasmHeap) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  // ------------------------------------------------------------------ typed-array views
  /**
   * Allocate a zero-filled typed array that LIVES in linear memory (kernels use it in place, zero copies). The view is
   * pinned: while any pinned view is alive, implicit growth is refused (see class comment). free(view) releases it.
   */
  allocArray<T extends HeapArray>(ctor: HeapArrayCtor<T>, length: number, align = ALIGN): T {
    const bpe = ctor.BYTES_PER_ELEMENT;
    const ptr = this.allocInner(length * bpe, Math.max(align, bpe), this.pinnedCount === 0);
    this.pinnedBytes += this.live.get(ptr)!;
    this.pinnedCount++;
    const v = new ctor(this.memory.buffer, ptr, length);
    v.fill(0);
    this.views.set(v, { ptr, length, ctor: ctor as HeapArrayCtor });
    return v;
  }

  /**
   * The current view for `v`: `v` itself while it is live, a new view of the same block if memory grew since it was
   * made (the stale view is detached), or `v` unchanged if it was not allocated by this heap.
   */
  refresh<T extends HeapArray>(v: T): T {
    if (v.buffer === this.memory.buffer) return v;
    const rec = this.views.get(v);
    if (!rec) return v;
    const nv = new rec.ctor(this.memory.buffer, rec.ptr, rec.length) as T;
    this.views.delete(v);
    this.views.set(nv, rec);
    return nv;
  }

  /** true when `v` was allocated by allocArray() (live or stale) */
  owns(v: object): boolean {
    return this.views.has(v);
  }

  // ------------------------------------------------------------------ kernel scratch
  /** byte offset of a cached scratch block of >= `bytes` for `slot` (see scratchSlot(); may grow memory: see alloc). Not zeroed. */
  scratch(slot: number, bytes: number, align = ALIGN): number {
    const s = this.slots[slot];
    if (s && s.bytes >= bytes && s.ptr % align === 0) return s.ptr;
    if (s) {
      // release the old block first (it can merge with its neighbours); the slot is empty until the new block exists
      this.slots[slot] = undefined as unknown as { ptr: number; bytes: number };
      this.live.delete(s.ptr);
      this.insertFree(s.ptr, s.bytes);
    }
    const ptr = this.allocInner(bytes, align, this.pinnedCount === 0);
    this.slots[slot] = { ptr, bytes: this.live.get(ptr)! };
    return ptr;
  }

  stats(): WasmHeapStats {
    let used = 0;
    for (const s of this.live.values()) used += s;
    return { capacity: this.memory.buffer.byteLength, heapBase: this.heapBase, used, pinned: this.pinnedBytes, top: this.top, grows: this.grows };
  }
}
