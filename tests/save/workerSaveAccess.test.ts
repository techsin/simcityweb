/**
 * T083 (a), W1.3 decision 21: db.ts's holdWorkerSaveAccess, the region lock's reach into a worker realm that writes
 * its own IndexedDB. No RegionSaveLock is active in such a realm, so the page's write guard let everything through.
 * Each `realm()` below is a fresh instance of db.ts (a worker's, or another tab's worker's); they share one Web Locks
 * manager, as the tabs and workers of an origin do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WORKER_LOCK = 'metropolis.region-worker.region';

/** Web Locks' two promises, with a stolen lock's request rejecting with AbortError (as tests/storageDb.test.ts).
 *  `gate` holds a grant back, as a real manager's grant arrives in a later task. */
class FakeLocks {
  readonly held = new Map<string, { reject: (error: unknown) => void }>();
  readonly requests: { name: string; options: LockOptions }[] = [];
  gate: Promise<void> | null = null;
  request(name: string, options: LockOptions, callback: LockGrantedCallback<unknown>): Promise<unknown> {
    this.requests.push({ name, options });
    return new Promise((resolve, reject) => {
      const previous = this.held.get(name);
      if (previous && options.steal) {
        this.held.delete(name);
        previous.reject(new DOMException('Stolen', 'AbortError'));
      } else if (previous) {
        Promise.resolve(callback(null)).then(resolve, reject);
        return;
      }
      const entry = { reject };
      this.held.set(name, entry);
      Promise.resolve(this.gate).then(() => callback({ name, mode: 'exclusive' } as Lock)).then(() => {
        if (this.held.get(name) === entry) this.held.delete(name);
        resolve(undefined);
      }, reject);
    });
  }
}

type Db = typeof import('../../src/save/db');
let locks: FakeLocks;
const realm = async (): Promise<Db> => { vi.resetModules(); return import('../../src/save/db'); };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const NOT_ALLOWED = { name: 'NotAllowedError', message: 'This region is open in another tab' };

beforeEach(() => {
  locks = new FakeLocks();
  vi.stubGlobal('navigator', { locks });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('T083: a worker realm\'s write right follows its tab\'s region lock', () => {
  it('writes its region only once the page says this tab is the writer, and takes the worker\'s lock by stealing', async () => {
    const db = await realm(), kv = new db.MemoryKV();
    const access = db.holdWorkerSaveAccess('region');
    expect(access.writable).toBe(false);
    await expect(kv.put('cities', { regionId: 'region' }, 'region:0_0')).rejects.toMatchObject(NOT_ALLOWED);
    await expect(kv.put('cities', { regionId: 'other' }, 'other:0_0'), 'another region is not this lease\'s').resolves.toBeUndefined();
    expect(locks.requests, 'no lock before the page\'s word').toEqual([]);
    expect(await access.set(true)).toBe(true);
    expect(access.writable).toBe(true);
    expect(locks.requests).toEqual([{ name: WORKER_LOCK, options: { steal: true } }]);
    await kv.put('cities', { regionId: 'region' }, 'region:0_0');
    await kv.put('recovery', { marker: { regionId: 'region' } }, 'region:0_0');
    await kv.delete('recovery', 'region:0_0#journal');
    expect(await kv.keys('cities')).toEqual(['other:0_0', 'region:0_0']);
    access.dispose();
  });

  it('a read-only tab\'s worker asks for no lock and is refused every put and delete of the region', async () => {
    const db = await realm(), kv = new db.MemoryKV();
    const access = db.holdWorkerSaveAccess('region');
    expect(await access.set(false)).toBe(false);
    expect(locks.requests).toEqual([]);
    expect(db.regionSaveAccess('region')).toBe(false);
    expect(db.regionSaveAccess('other')).toBe(true);
    await expect(kv.put('cities', { regionId: 'region' }, 'region:0_0'), 'a save').rejects.toMatchObject(NOT_ALLOWED);
    await expect(kv.put('recovery', { marker: { regionId: 'region' } }, 'region:0_0'), 'a snapshot').rejects.toMatchObject(NOT_ALLOWED);
    await expect(kv.delete('recovery', 'region:0_0#journal'), 'a stale journal\'s cleanup').rejects.toMatchObject(NOT_ALLOWED);
    expect(await kv.keys('cities')).toEqual([]);
    access.dispose();
  });

  it('a takeover: the new tab\'s worker steals the lock, and the old tab\'s worker is refused from its next write on, before its page says anything', async () => {
    const oldTab = await realm(), oldKv = new oldTab.MemoryKV();
    const old = oldTab.holdWorkerSaveAccess('region');
    await old.set(true);
    await oldKv.put('cities', { regionId: 'region', n: 1 }, 'region:0_0');
    const newTab = await realm(), newKv = new newTab.MemoryKV();
    const next = newTab.holdWorkerSaveAccess('region');
    expect(await next.set(true)).toBe(true);
    // the steal rejected the old worker's request with AbortError: no message from its page was needed
    expect(old.writable).toBe(false);
    await expect(oldKv.put('cities', { regionId: 'region', n: 2 }, 'region:0_0')).rejects.toMatchObject(NOT_ALLOWED);
    await expect(oldKv.delete('recovery', 'region:0_0')).rejects.toMatchObject(NOT_ALLOWED);
    expect(await oldKv.get('cities', 'region:0_0')).toMatchObject({ n: 1 });
    await expect(newKv.put('cities', { regionId: 'region', n: 3 }, 'region:0_0')).resolves.toBeUndefined();
    // the old page repeating what it last said (it has not learned yet) does not steal the lock back
    const asked = locks.requests.length;
    expect(await old.set(true)).toBe(false);
    expect(locks.requests.length).toBe(asked);
    expect(next.writable).toBe(true);
    // only its page's loss and return does: "Use it here instead", back in the old tab
    await old.set(false);
    expect(await old.set(true)).toBe(true);
    expect(next.writable).toBe(false);
    await expect(newKv.put('cities', { regionId: 'region', n: 4 }, 'region:0_0')).rejects.toMatchObject(NOT_ALLOWED);
    old.dispose(); next.dispose();
  });

  it('told that its tab lost the region, the worker stops at once and lets its lock go', async () => {
    const db = await realm(), kv = new db.MemoryKV();
    const access = db.holdWorkerSaveAccess('region');
    await access.set(true);
    expect(locks.held.has(WORKER_LOCK)).toBe(true);
    const done = access.set(false);
    // synchronously, before any await: a put that starts in this same task is already refused
    expect(access.writable).toBe(false);
    await expect(kv.put('cities', { regionId: 'region' }, 'region:0_0')).rejects.toMatchObject(NOT_ALLOWED);
    expect(await done).toBe(false);
    await flush();
    expect(locks.held.has(WORKER_LOCK), 'free for the new tab\'s worker').toBe(false);
    access.dispose();
  });

  it('a grant that arrives after the page took its word back gives no write right, and the lock is let go', async () => {
    const db = await realm();
    const access = db.holdWorkerSaveAccess('region');
    let open!: () => void;
    locks.gate = new Promise<void>((resolve) => { open = resolve; });
    const granted = access.set(true);
    expect(access.writable, 'not before the grant').toBe(false);
    void access.set(false);
    open();
    expect(await granted).toBe(false);
    await flush();
    expect(access.writable).toBe(false);
    expect(locks.held.has(WORKER_LOCK)).toBe(false);
    access.dispose();
  });

  it('a lock stolen before its grant was delivered gives no write right', async () => {
    const old = (await realm()).holdWorkerSaveAccess('region');
    let deliver!: () => void;
    locks.gate = new Promise<void>((resolve) => { deliver = resolve; });
    const asked = old.set(true);
    locks.gate = null;
    const next = (await realm()).holdWorkerSaveAccess('region');
    expect(await next.set(true)).toBe(true);
    deliver();
    expect(await asked).toBe(false);
    await flush();
    expect(old.writable).toBe(false);
    expect(next.writable).toBe(true);
    old.dispose(); next.dispose();
  });

  it('settled() waits for a grant still on its way, so a write asked for right after the page\'s word is not refused', async () => {
    const db = await realm(), kv = new db.MemoryKV();
    const access = db.holdWorkerSaveAccess('region');
    let open!: () => void;
    locks.gate = new Promise<void>((resolve) => { open = resolve; });
    void access.set(true);
    const write = access.settled().then(() => kv.put('cities', { regionId: 'region' }, 'region:0_0'));
    await flush();
    expect(await kv.keys('cities'), 'not before the grant').toEqual([]);
    open();
    await expect(write).resolves.toBeUndefined();
    expect(await kv.keys('cities')).toEqual(['region:0_0']);
    access.dispose();
  });

  it('without Web Locks in the realm the page\'s word decides alone', async () => {
    vi.stubGlobal('navigator', {});
    const db = await realm(), kv = new db.MemoryKV();
    const access = db.holdWorkerSaveAccess('region');
    await expect(kv.put('cities', { regionId: 'region' }, 'region:0_0')).rejects.toMatchObject(NOT_ALLOWED);
    expect(await access.set(true)).toBe(true);
    await kv.put('cities', { regionId: 'region' }, 'region:0_0');
    expect(await access.set(false)).toBe(false);
    await expect(kv.delete('cities', 'region:0_0')).rejects.toMatchObject(NOT_ALLOWED);
    access.dispose();
  });

  it('a lock manager that refuses the request itself leaves the page\'s word standing', async () => {
    vi.stubGlobal('navigator', { locks: { request: () => Promise.reject(new DOMException('Denied in this context', 'SecurityError')) } });
    const db = await realm();
    const access = db.holdWorkerSaveAccess('region');
    expect(await access.set(true)).toBe(true);
    expect(access.writable).toBe(true);
    expect(await access.set(false)).toBe(false);
    access.dispose();
  });

  it('its lock is not the page\'s: a tab\'s page and its worker hold theirs together, and dispose frees the worker\'s', async () => {
    const page = await realm(), worker = await realm();
    const region = new page.RegionSaveLock('region');
    expect(await region.acquire()).toBe(true);
    const access = worker.holdWorkerSaveAccess('region');
    expect(await access.set(true)).toBe(true);
    expect(region.writable, 'the worker\'s steal took nothing from its page').toBe(true);
    expect([...locks.held.keys()].sort()).toEqual(['metropolis.region-worker.region', 'metropolis.region.region']);
    access.dispose();
    await flush();
    expect([...locks.held.keys()]).toEqual(['metropolis.region.region']);
    // the fence goes with the lease: this realm's guard is as it was
    expect(worker.regionSaveAccess('region')).toBe(true);
    await expect(new worker.MemoryKV().put('cities', { regionId: 'region' }, 'region:0_0')).resolves.toBeUndefined();
    region.dispose();
  });
});
