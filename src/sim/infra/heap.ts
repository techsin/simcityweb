/**
 * Binary min-heap over typed arrays (node id + float key) with lazy deletion (duplicates allowed; callers skip
 * stale entries by comparing the popped key with their dist array). No per-operation allocation.
 */
export class MinHeap {
  ids: Int32Array;
  keys: Float64Array;
  size = 0;

  constructor(capacity = 1024) {
    this.ids = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  reserve(capacity: number): void {
    if (capacity <= this.ids.length) return;
    const ids = new Int32Array(capacity);
    const keys = new Float64Array(capacity);
    ids.set(this.ids.subarray(0, this.size));
    keys.set(this.keys.subarray(0, this.size));
    this.ids = ids;
    this.keys = keys;
  }

  push(id: number, key: number): void {
    if (this.size >= this.ids.length) this.reserve(this.ids.length * 2);
    const ids = this.ids;
    const keys = this.keys;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const pk = keys[p];
      if (pk <= key) break;
      keys[i] = pk;
      ids[i] = ids[p];
      i = p;
    }
    keys[i] = key;
    ids[i] = id;
  }

  /** key of the top element (heap must be non-empty) */
  topKey(): number {
    return this.keys[0];
  }

  /** remove the min element and return its id (heap must be non-empty); its key was topKey() */
  pop(): number {
    const ids = this.ids;
    const keys = this.keys;
    const top = ids[0];
    const n = --this.size;
    if (n > 0) {
      const lastKey = keys[n];
      const lastId = ids[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        const c2 = c + 1;
        if (c2 < n && keys[c2] < keys[c]) c = c2;
        if (keys[c] >= lastKey) break;
        keys[i] = keys[c];
        ids[i] = ids[c];
        i = c;
      }
      keys[i] = lastKey;
      ids[i] = lastId;
    }
    return top;
  }
}
