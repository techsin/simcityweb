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
      requireStoreSaveAccess(store, value, key);
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
      requireStoreSaveAccess(store, undefined, key);
      const t = this.db.transaction(store, 'readwrite');
      t.objectStore(store).delete(key);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      // W0.6 awaits this delete before a save is acknowledged: an aborted transaction must settle too
      t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
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
    requireStoreSaveAccess(store, value, key);
    const k = key ?? (value as { id: string }).id;
    this.stores[store].set(k, this.clone(value));
  }
  async delete(store: StoreName, key: string): Promise<void> {
    requireStoreSaveAccess(store, undefined, key);
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

// ------------------------------------------------------------------ browser storage safety
const PERSIST_KEY = 'metropolis.storagePersistence';
const BACKUP_KEY = 'metropolis.storageBackup.';
const BACKUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const prefs = new Map<string, string>();
let persistPromise: Promise<boolean> | null = null;

function storagePref(key: string): string | null {
  try { return localStorage.getItem(key) ?? prefs.get(key) ?? null; }
  catch { return prefs.get(key) ?? null; }
}
function setStoragePref(key: string, value: string): void {
  prefs.set(key, value);
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

/** Call directly from the first Found click, before awaiting anything that can consume its user gesture. */
export function requestPersistentStorage(): Promise<boolean> {
  if (persistPromise) return persistPromise;
  const previous = storagePref(PERSIST_KEY);
  if (previous !== null) return persistPromise = Promise.resolve(previous === 'granted');
  const remember = (granted: boolean) => {
    setStoragePref(PERSIST_KEY, granted ? 'granted' : 'denied');
    return granted;
  };
  try {
    const request = typeof navigator !== 'undefined' ? navigator.storage?.persist?.() : undefined;
    persistPromise = request ? Promise.resolve(request).then(remember, () => remember(false)) : Promise.resolve(remember(false));
  } catch {
    persistPromise = Promise.resolve(remember(false));
  }
  return persistPromise;
}

export async function storageEstimate(): Promise<StorageEstimate | null> {
  try {
    return typeof navigator !== 'undefined' && navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  } catch {
    return null;
  }
}

/** Leave room for the transaction and recovery data rather than discovering a full quota halfway through a save. */
export async function checkStorageSpace(): Promise<void> {
  const estimate = await storageEstimate();
  if (estimate?.quota && estimate.usage !== undefined && estimate.usage >= estimate.quota * 0.95) {
    throw new DOMException('Browser storage is full', 'QuotaExceededError');
  }
}

/** Check permission on both sides of the asynchronous estimate and persistence operation. */
export async function withRegionSaveAccess<T>(regionId: string, write: () => Promise<T>): Promise<T> {
  requireRegionSaveAccess(regionId);
  await checkStorageSpace();
  requireRegionSaveAccess(regionId);
  const saved = await write();
  // the write landed after a takeover: its region summary never will, so the next open rebuilds it
  if (!regionSaveAccess(regionId)) markRegionSummaryStale(regionId);
  requireRegionSaveAccess(regionId);
  return saved;
}

// A city record can outlive its tile summary in the region record when the region's lock moves to another tab. Only a
// region marked here has its city records read on open (regionLock.ts loadCurrentRegion): each can be many MB.
const SUMMARY_STALE_KEY = 'metropolis.regionSummaryStale.';
const summaryMarks = new Map<string, string>();

export function markRegionSummaryStale(regionId: string): void {
  const key = SUMMARY_STALE_KEY + regionId, value = String(Date.now());
  try { localStorage.setItem(key, value); } catch { summaryMarks.set(key, value); }
}

export function regionSummaryStale(regionId: string): boolean {
  const key = SUMMARY_STALE_KEY + regionId;
  try { return localStorage.getItem(key) !== null || summaryMarks.has(key); }
  catch { return summaryMarks.has(key); }
}

export function clearRegionSummaryStale(regionId: string): void {
  const key = SUMMARY_STALE_KEY + regionId;
  summaryMarks.delete(key);
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

export async function storageNeedsBackup(regionId: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && await navigator.storage?.persisted?.()) return false;
  } catch { /* denied or unavailable: keep offering an export */ }
  if (typeof navigator !== 'undefined' && !navigator.storage?.persisted && storagePref(PERSIST_KEY) === 'granted') return false;
  const exportedAt = Number(storagePref(BACKUP_KEY + regionId + '.exportedAt') ?? 0);
  const dismissedAt = Number(storagePref(BACKUP_KEY + regionId + '.dismissedAt') ?? 0);
  const backedUpAt = Math.max(exportedAt, dismissedAt);
  return !backedUpAt || Date.now() - backedUpAt > BACKUP_INTERVAL_MS;
}

export function markRegionExported(regionId: string): void {
  setStoragePref(BACKUP_KEY + regionId + '.exportedAt', String(Date.now()));
}

export function dismissRegionBackup(regionId: string): void {
  setStoragePref(BACKUP_KEY + regionId + '.dismissedAt', String(Date.now()));
}

// ------------------------------------------------------------------ one writer per region
const REGION_LOCK_PREFIX = 'metropolis.region.';
const LEASE_MS = 15000;
let lockSequence = 0;
let activeRegionLock: RegionSaveLock | null = null;
const accessListeners = new Set<() => void>();
const accessRestrictions = new Set<(regionId?: string) => boolean>();
type LockMessage = { kind: 'probe' | 'held' | 'claim' | 'release'; id: string };

export function currentRegionSaveLock(): RegionSaveLock | null { return activeRegionLock; }

export function regionSaveAccess(regionId?: string): boolean {
  for (const allow of accessRestrictions) if (!allow(regionId)) return false;
  return !activeRegionLock || (!!regionId && activeRegionLock.regionId !== regionId) || activeRegionLock.canSave();
}

/** Recovery scans temporarily allow writes only to regions whose locks the caller acquired. */
export function restrictRegionSaveAccess(allow: (regionId?: string) => boolean): () => void {
  accessRestrictions.add(allow);
  for (const fn of accessListeners) fn();
  return () => {
    if (accessRestrictions.delete(allow)) for (const fn of accessListeners) fn();
  };
}

export function requireRegionSaveAccess(regionId?: string): void {
  if (!regionSaveAccess(regionId)) throw new DOMException('This region is open in another tab', 'NotAllowedError');
}

function requireStoreSaveAccess(store: StoreName, value: unknown, key?: string): void {
  const record = value as { id?: string; regionId?: string; marker?: { regionId?: string } } | undefined;
  const regionId = store === 'regions' ? key ?? record?.id : key?.split(':')[0] ?? record?.regionId ?? record?.marker?.regionId;
  if (regionId || accessRestrictions.size) requireRegionSaveAccess(regionId);
}

export function watchRegionSaveAccess(regionId: string | undefined, fn: (writable: boolean) => void, signal?: AbortSignal): () => void {
  const update = () => fn(regionSaveAccess(regionId));
  const off = () => accessListeners.delete(update);
  if (!signal?.aborted) {
    accessListeners.add(update);
    signal?.addEventListener('abort', off, { once: true });
    update();
  }
  return off;
}

/** The region screen and all its cities share this lifetime; temporary storage-management locks are not active. */
export class RegionSaveLock {
  writable = false;
  lost = false;
  private disposed = false;
  private owned = false;
  private epoch = 0;
  private release: (() => void) | null = null;
  private pending: Promise<boolean> | null = null;
  private listeners = new Set<(writable: boolean) => void>();
  private channel: BroadcastChannel | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private candidate: string | null = null;
  private otherHolder = false;
  private readonly id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${typeof performance === 'undefined' ? 0 : performance.timeOrigin}:${++lockSequence}`;
  private readonly name: string;

  constructor(readonly regionId: string, active = true) {
    this.name = REGION_LOCK_PREFIX + regionId;
    if (active) {
      activeRegionLock = this;
      this.notify();
    }
  }

  subscribe(fn: (writable: boolean) => void): () => void {
    this.listeners.add(fn);
    fn(this.writable);
    return () => this.listeners.delete(fn);
  }

  /** Check the fallback lease at the write itself, before a queued channel message can arrive. */
  canSave(): boolean {
    if (this.writable && this.channel) {
      const lease = this.readLease();
      if (lease && lease.id !== this.id) { ++this.epoch; this.lose(); }
    }
    return this.writable;
  }

  /**
   * T086 B5: whether a tab holds this region now (null: not known, or this lock is taking it). A read-only tab polls
   * this to learn that the region became free. A query takes no lock; a queued request would be granted ahead of the
   * holder's own `ifAvailable` re-acquire (the start-up scan hands its lock to the session within a millisecond), and
   * that tab would then open read-only. The BroadcastChannel fallback has no such query: null.
   */
  async heldElsewhere(): Promise<boolean | null> {
    const taking = () => this.disposed || this.owned || !!this.pending;
    if (taking()) return null;
    try {
      const snapshot = await (typeof navigator !== 'undefined' ? navigator.locks : undefined)?.query?.();
      // (asked again: this tab may have started its own acquire while the query was out)
      return taking() || !snapshot?.held ? null : snapshot.held.some((lock) => lock.name === this.name);
    } catch {
      return null;
    }
  }

  /** beforeWrite reloads a takeover's stale region while the lock is held and saves are still disabled. */
  acquire(steal = false, beforeWrite?: () => Promise<void>): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.canSave()) return Promise.resolve(true);
    if (this.pending) return this.pending;
    const epoch = ++this.epoch;
    const request = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    const acquire = request ? this.acquireWebLock(request, steal, epoch, beforeWrite) : this.acquireChannel(steal, epoch, beforeWrite);
    this.pending = acquire.finally(() => { this.pending = null; });
    return this.pending;
  }

  private acquireWebLock(manager: LockManager, steal: boolean, epoch: number, beforeWrite?: () => Promise<void>): Promise<boolean> {
    return new Promise((resolve) => {
      const hold = new Promise<void>((release) => { this.release = release; });
      try {
        void manager.request(this.name, steal ? { steal: true } : { ifAvailable: true }, async (lock) => {
          if (!lock || this.disposed || epoch !== this.epoch) { resolve(false); return; }
          this.owned = true;
          await beforeWrite?.();
          if (this.disposed || epoch !== this.epoch) { resolve(false); return; }
          this.lost = false;
          this.setWritable(true);
          resolve(true);
          await hold;
        }).catch(() => {
          // Stealing rejects the old request's released promise with AbortError, even while its callback awaits.
          if (epoch === this.epoch) {
            ++this.epoch;
            this.lose();
          }
          resolve(false);
        });
      } catch {
        resolve(false);
      }
    });
  }

  private async acquireChannel(steal: boolean, epoch: number, beforeWrite?: () => Promise<void>): Promise<boolean> {
    if (!this.channel) {
      if (typeof BroadcastChannel === 'undefined') return false;
      try { this.channel = new BroadcastChannel(this.name); }
      catch { return false; }
      this.channel.onmessage = (event: MessageEvent<LockMessage>) => {
        const msg = event.data;
        if (!msg || msg.id === this.id) return;
        if (msg.kind === 'probe') {
          if (this.owned) this.send('held');
          if (this.candidate && msg.id < this.candidate) this.candidate = msg.id;
        } else if (msg.kind === 'held') {
          this.otherHolder = true;
        } else if (msg.kind === 'claim') {
          this.otherHolder = true;
          if (this.owned) { ++this.epoch; this.lose(); }
        }
      };
    }
    this.otherHolder = false;
    this.candidate = this.id;
    if (!steal) {
      const lease = this.readLease();
      if (lease && lease.id !== this.id && lease.until > Date.now()) return false;
      this.send('probe');
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (this.otherHolder || this.candidate !== this.id) return false;
    }
    this.candidate = null;
    if (this.disposed || epoch !== this.epoch) return false;
    this.owned = true;
    this.writeLease();
    this.send('claim');
    // A takeover revokes the old tab before the new tab reloads the region.
    try { await beforeWrite?.(); }
    catch { this.lose(); return false; }
    if (this.disposed || epoch !== this.epoch) return false;
    const lease = this.readLease();
    if (lease && lease.id !== this.id) { ++this.epoch; this.lose(); return false; }
    this.lost = false;
    this.setWritable(true);
    this.heartbeat = setInterval(() => {
      const lease = this.readLease();
      if (lease && lease.id !== this.id) { ++this.epoch; this.lose(); return; }
      this.writeLease();
      this.send('held');
    }, 3000);
    return true;
  }

  private readLease(): { id: string; until: number } | null {
    try { return JSON.parse(localStorage.getItem(this.name) ?? 'null') as { id: string; until: number } | null; }
    catch { return null; }
  }
  private writeLease(): void {
    try { localStorage.setItem(this.name, JSON.stringify({ id: this.id, until: Date.now() + LEASE_MS })); }
    catch { /* BroadcastChannel still coordinates tabs when localStorage is unavailable */ }
  }
  private send(kind: LockMessage['kind']): void { this.channel?.postMessage({ kind, id: this.id } satisfies LockMessage); }
  private notify(): void {
    for (const fn of this.listeners) fn(this.writable);
    if (activeRegionLock === this) for (const fn of accessListeners) fn();
  }
  private setWritable(value: boolean): void {
    if (this.writable === value) return;
    this.writable = value;
    this.notify();
  }
  private lose(): void {
    // writes that landed before this tab learned of the loss may have no region summary yet
    if (this.owned && !this.disposed) markRegionSummaryStale(this.regionId);
    this.lost ||= this.owned;
    this.owned = false;
    this.setWritable(false);
    this.release?.();
    this.release = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.readLease()?.id === this.id) {
      try { localStorage.removeItem(this.name); } catch { /* storage unavailable */ }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.epoch;
    const held = this.owned;
    this.lose();
    if (held) {
      this.send('release');
    }
    this.channel?.close();
    this.channel = null;
    this.listeners.clear();
    if (activeRegionLock === this) {
      activeRegionLock = null;
      for (const fn of accessListeners) fn();
    }
  }
}
