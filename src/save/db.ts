/**
 * Minimal promise wrapper around IndexedDB (no deps) with an in-memory fallback when IndexedDB is unavailable
 * (private browsing, file://, tests). Database 'metropolis' with stores:
 *   regions  keyPath 'id'                 -> RegionData
 *   cities   out-of-line key 'regionId:tileKey' -> CityRecord
 *   recovery out-of-line key                     -> emergency "unsaved progress" snapshot (save/recovery.ts)  [v2]
 */
export const DB_NAME = 'metropolis';
export const DB_VERSION = 2;
export type StoreName = 'regions' | 'cities' | 'recovery';

export interface KV {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, value: unknown, key?: string): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  getAll<T>(store: StoreName): Promise<T[]>;
  /** keys in [lower, upper] */
  keys(store: StoreName, lower?: string, upper?: string): Promise<string[]>;
  readonly persistent: boolean;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

class IdbKV implements KV {
  readonly persistent = true;
  constructor(private db: IDBDatabase) {}
  private tx(store: StoreName, mode: IDBTransactionMode) {
    return this.db.transaction(store, mode).objectStore(store);
  }
  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return (await req(this.tx(store, 'readonly').get(key))) as T | undefined;
  }
  put(store: StoreName, value: unknown, key?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      try {
        // structured clone happens synchronously here -> a consistent snapshot of live typed arrays
        if (key !== undefined && !os.keyPath) os.put(value, key);
        else os.put(value);
        // explicit commit: the request + commit reach the backend right away instead of after a renderer round trip
        // (matters when the page is being unloaded — see save/recovery.ts)
        t.commit?.();
      } catch (e) {
        reject(e);
        return;
      }
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
    });
  }
  delete(store: StoreName, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction(store, 'readwrite');
      t.objectStore(store).delete(key);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
  async getAll<T>(store: StoreName): Promise<T[]> {
    return (await req(this.tx(store, 'readonly').getAll())) as T[];
  }
  async keys(store: StoreName, lower?: string, upper?: string): Promise<string[]> {
    const range = lower !== undefined && upper !== undefined ? IDBKeyRange.bound(lower, upper) : undefined;
    return ((await req(this.tx(store, 'readonly').getAllKeys(range))) as IDBValidKey[]).map(String);
  }
}

/** in-memory fallback (lost on reload) */
export class MemoryKV implements KV {
  readonly persistent = false;
  private stores: Record<StoreName, Map<string, unknown>> = { regions: new Map(), cities: new Map(), recovery: new Map() };
  private clone<T>(v: T): T {
    return typeof structuredClone === 'function' ? structuredClone(v) : v;
  }
  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    const v = this.stores[store].get(key);
    return v === undefined ? undefined : this.clone(v as T);
  }
  async put(store: StoreName, value: unknown, key?: string): Promise<void> {
    const k = key ?? (value as { id: string }).id;
    this.stores[store].set(k, this.clone(value));
  }
  async delete(store: StoreName, key: string): Promise<void> {
    this.stores[store].delete(key);
  }
  async getAll<T>(store: StoreName): Promise<T[]> {
    return [...this.stores[store].values()].map((v) => this.clone(v as T));
  }
  async keys(store: StoreName, lower?: string, upper?: string): Promise<string[]> {
    return [...this.stores[store].keys()].filter((k) => (lower === undefined || k >= lower) && (upper === undefined || k <= upper)).sort();
  }
}

let kvPromise: Promise<KV> | null = null;
let kvReady: KV | null = null;

/** the opened backend, synchronously (null until openKV() resolved) — for writes that must start inside an unload handler */
export function openedKV(): KV | null {
  return kvReady;
}

export function openKV(): Promise<KV> {
  if (kvPromise) return kvPromise;
  kvPromise = new Promise<KV>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(new MemoryKV());
      return;
    }
    let settled = false;
    const fallback = (why: unknown) => {
      if (settled) return;
      settled = true;
      console.warn('[save] IndexedDB unavailable, using in-memory storage', why);
      resolve(new MemoryKV());
    };
    try {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('regions')) db.createObjectStore('regions', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('cities')) db.createObjectStore('cities');
        if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery');
      };
      r.onsuccess = () => {
        if (settled) return;
        settled = true;
        const db = r.result;
        db.onversionchange = () => db.close();
        resolve(new IdbKV(db));
      };
      r.onerror = () => fallback(r.error);
      r.onblocked = () => fallback('blocked');
      // only for a browser whose open() never answers: a slow open (cold start, busy machine — seen at 4 s under
      // load) must not silently fall back to memory, where every save of the session is lost on reload
      setTimeout(() => fallback('timeout'), 15000);
    } catch (e) {
      fallback(e);
    }
  });
  void kvPromise.then((kv) => (kvReady = kv));
  return kvPromise;
}

/** for tests: force a specific backend */
export function setKV(kv: KV): void {
  kvPromise = Promise.resolve(kv);
  kvReady = kv;
}
