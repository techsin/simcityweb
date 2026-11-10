import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegionSaveLock } from '../src/save/db';

class StorageStub {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

/** Models the two promises in Web Locks, including rejection of a stolen lock's released promise. */
class FakeLocks {
  readonly held = new Map<string, { reject: (error: unknown) => void }>();
  readonly requests: { name: string; options: LockOptions }[] = [];
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
      Promise.resolve(callback({ name, mode: 'exclusive' } as Lock)).then(() => {
        if (this.held.get(name) === entry) this.held.delete(name);
        resolve(undefined);
      }, reject);
    });
  }
}

class FakeChannel {
  static channels = new Map<string, Set<FakeChannel>>();
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor(readonly name: string) {
    const channels = FakeChannel.channels.get(name) ?? new Set<FakeChannel>();
    channels.add(this);
    FakeChannel.channels.set(name, channels);
  }
  postMessage(data: unknown): void {
    for (const channel of FakeChannel.channels.get(this.name) ?? []) {
      if (channel !== this) queueMicrotask(() => channel.onmessage?.({ data } as MessageEvent));
    }
  }
  close(): void { FakeChannel.channels.get(this.name)?.delete(this); }
}

let db: typeof import('../src/save/db');
let locks: FakeLocks;
let holders: RegionSaveLock[];

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
  vi.stubGlobal('localStorage', new StorageStub());
  vi.stubGlobal('BroadcastChannel', undefined);
  locks = new FakeLocks();
  holders = [];
  vi.stubGlobal('navigator', { locks, storage: { persisted: vi.fn().mockResolvedValue(false) } });
  db = await import('../src/save/db');
});

afterEach(() => {
  for (const holder of holders) holder.dispose();
  FakeChannel.channels.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function holder(regionId = 'region', active = false): RegionSaveLock {
  const lock = new db.RegionSaveLock(regionId, active);
  holders.push(lock);
  return lock;
}

describe('browser storage safety', () => {
  it('requests persistence synchronously in the gesture and remembers one result', async () => {
    const persist = vi.fn().mockResolvedValue(false);
    Object.assign(navigator.storage, { persist });
    const first = db.requestPersistentStorage();
    expect(persist).toHaveBeenCalledOnce();
    expect(db.requestPersistentStorage()).toBe(first);
    await expect(first).resolves.toBe(false);
    await expect(db.requestPersistentStorage()).resolves.toBe(false);
    expect(persist).toHaveBeenCalledOnce();
    vi.resetModules();
    const nextTab = await import('../src/save/db');
    await expect(nextTab.requestPersistentStorage()).resolves.toBe(false);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('offers a backup after denial until export, then again after seven days', async () => {
    await expect(db.storageNeedsBackup('region')).resolves.toBe(true);
    db.markRegionExported('region');
    await expect(db.storageNeedsBackup('region')).resolves.toBe(false);
    await expect(db.storageNeedsBackup('other')).resolves.toBe(true);
    vi.setSystemTime(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1);
    await expect(db.storageNeedsBackup('region')).resolves.toBe(true);
    db.dismissRegionBackup('region');
    await expect(db.storageNeedsBackup('region')).resolves.toBe(false);
  });

  it('does not remind when the browser confirms persistent storage', async () => {
    vi.mocked(navigator.storage.persisted).mockResolvedValue(true);
    await expect(db.storageNeedsBackup('region')).resolves.toBe(false);
  });

  it('treats unsupported or rejected persistence and estimates as unavailable', async () => {
    vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockRejectedValue(new Error('denied')), estimate: vi.fn().mockRejectedValue(new Error('unavailable')) } });
    await expect(db.requestPersistentStorage()).resolves.toBe(false);
    await expect(db.storageEstimate()).resolves.toBeNull();
    await expect(db.storageNeedsBackup('region')).resolves.toBe(true);
    vi.stubGlobal('navigator', {});
    await expect(db.storageEstimate()).resolves.toBeNull();
    await expect(db.checkStorageSpace()).resolves.toBeUndefined();
  });

  it('checks the five percent quota margin without exposing an estimate failure', async () => {
    const estimate = vi.fn().mockResolvedValue({ quota: 1000, usage: 949 });
    Object.assign(navigator.storage, { estimate });
    await expect(db.storageEstimate()).resolves.toEqual({ quota: 1000, usage: 949 });
    await expect(db.checkStorageSpace()).resolves.toBeUndefined();
    estimate.mockResolvedValue({ quota: 1000, usage: 950 });
    await expect(db.checkStorageSpace()).rejects.toMatchObject({ name: 'QuotaExceededError' });
  });
});

describe('one writer per region', () => {
  it('opens the second tab read-only and hands saving both ways using Web Locks steal', async () => {
    const first = holder(), second = holder();
    const firstChanges: boolean[] = [], secondChanges: boolean[] = [];
    first.subscribe((writable) => firstChanges.push(writable));
    second.subscribe((writable) => secondChanges.push(writable));
    expect(await first.acquire()).toBe(true);
    expect(await second.acquire()).toBe(false);
    expect(first.writable).toBe(true);
    expect(second.writable).toBe(false);
    expect(await second.acquire(true)).toBe(true);
    expect(first.writable).toBe(false);
    expect(first.lost).toBe(true);
    expect(await first.acquire(true)).toBe(true);
    expect(second.writable).toBe(false);
    expect(second.lost).toBe(true);
    expect(first.lost).toBe(false);
    expect(firstChanges).toEqual([false, true, false, true]);
    expect(secondChanges).toEqual([false, true, false]);
    expect(locks.requests.map(({ options }) => options)).toEqual([{ ifAvailable: true }, { ifAvailable: true }, { steal: true }, { steal: true }]);
  });

  it('holds the new lock while reloading stale data before allowing saves', async () => {
    const first = holder(), second = holder();
    await first.acquire();
    let ready!: () => void;
    const refresh = new Promise<void>((resolve) => { ready = resolve; });
    const acquiring = second.acquire(true, () => refresh);
    expect(second.writable).toBe(false);
    await Promise.resolve();
    expect(first.writable).toBe(false);
    expect(await holder().acquire()).toBe(false);
    ready();
    expect(await acquiring).toBe(true);
    expect(second.writable).toBe(true);
  });

  it('cannot enable saves if another takeover happens during the refresh', async () => {
    const first = holder(), second = holder(), third = holder();
    await first.acquire();
    let ready!: () => void;
    const refresh = new Promise<void>((resolve) => { ready = resolve; });
    const acquiring = second.acquire(true, () => refresh);
    await third.acquire(true);
    ready();
    expect(await acquiring).toBe(false);
    expect(second.writable).toBe(false);
    expect(third.writable).toBe(true);
  });

  it('guards low-level writes after ownership is lost, leaving reads and other regions available', async () => {
    const first = holder('region', true), second = holder();
    const kv = new db.MemoryKV();
    const access: boolean[] = [];
    const signal = new AbortController();
    db.watchRegionSaveAccess(undefined, (writable) => access.push(writable), signal.signal);
    expect(db.regionSaveAccess()).toBe(false);
    await first.acquire();
    await kv.put('regions', { id: 'region' });
    await second.acquire(true);
    expect(() => db.requireRegionSaveAccess('region')).toThrow('This region is open in another tab');
    await expect(kv.put('regions', { id: 'region' })).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(kv.put('cities', { regionId: 'region' }, 'region:0_0')).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(kv.put('recovery', {}, 'region:0_0#journal')).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(kv.delete('regions', 'region')).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(kv.get('regions', 'region')).resolves.toEqual({ id: 'region' });
    await expect(kv.put('regions', { id: 'other' })).resolves.toBeUndefined();
    expect(access).toEqual([false, true, false]);
    signal.abort();
    first.dispose();
    expect(db.regionSaveAccess()).toBe(true);
    expect(access).toEqual([false, true, false]);
  });

  it('marks the region summary stale when a lock is lost or a write outlives it, never on a release', async () => {
    const first = holder('region', true), second = holder();
    await first.acquire();
    first.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(db.regionSummaryStale('region')).toBe(false);
    const owner = holder('region', true);
    expect(await owner.acquire()).toBe(true);
    let land!: () => void;
    const writing = db.withRegionSaveAccess('region', () => new Promise<void>((resolve) => { land = resolve; }));
    await vi.advanceTimersByTimeAsync(0);
    await second.acquire(true);
    expect(owner.lost).toBe(true);
    expect(db.regionSummaryStale('region')).toBe(true);
    db.clearRegionSummaryStale('region'); // the new holder's reload reads the records, then the late write lands
    land();
    await expect(writing).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(db.regionSummaryStale('region')).toBe(true);
  });

  it('does not change active access when Manage storage takes a temporary lock', async () => {
    const active = holder('region', true);
    await active.acquire();
    const temporary = holder('other');
    await temporary.acquire();
    expect(db.currentRegionSaveLock()).toBe(active);
    expect(db.regionSaveAccess()).toBe(true);
    temporary.dispose();
    expect(db.currentRegionSaveLock()).toBe(active);
  });

  it('scopes recovery mutations to acquired regions and rechecks ownership after revocation', async () => {
    const owned = holder(), otherTab = holder();
    const kv = new db.MemoryKV();
    await kv.put('regions', { id: 'other' });
    await owned.acquire();
    const unrestrict = db.restrictRegionSaveAccess((regionId) => regionId === 'region' && owned.canSave());
    expect(db.regionSaveAccess('region')).toBe(true);
    expect(db.regionSaveAccess('other')).toBe(false);
    await kv.put('recovery', { regionId: 'region' }, 'region:0_0');
    await expect(kv.put('recovery', { regionId: 'region' }, 'other:0_0')).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(kv.put('regions', { id: 'new-region' })).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(kv.delete('regions', 'other')).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(kv.get('regions', 'other')).resolves.toEqual({ id: 'other' });
    await otherTab.acquire(true);
    await expect(kv.delete('recovery', 'region:0_0')).rejects.toMatchObject({ name: 'NotAllowedError' });
    unrestrict();
    unrestrict();
    expect(db.regionSaveAccess('other')).toBe(true);
    await expect(kv.put('regions', { id: 'new-region' })).resolves.toBeUndefined();
  });

  it('uses BroadcastChannel heartbeat and takeover when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const first = holder(), second = holder();
    const acquiring = first.acquire();
    await vi.advanceTimersByTimeAsync(100);
    expect(await acquiring).toBe(true);
    expect(await second.acquire()).toBe(false);
    expect(await second.acquire(true)).toBe(true);
    await Promise.resolve();
    expect(first.writable).toBe(false);
    expect(first.lost).toBe(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await first.acquire(true)).toBe(true);
    await Promise.resolve();
    expect(second.writable).toBe(false);
    expect(second.lost).toBe(true);
  });

  it('blocks a fallback write from the old tab before its takeover message is delivered', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const first = holder('region', true), second = holder();
    const initial = first.acquire();
    await vi.advanceTimersByTimeAsync(100);
    await initial;
    const kv = new db.MemoryKV();
    await kv.put('regions', { id: 'region' });
    const takeover = second.acquire(true);
    expect(first.writable).toBe(true);
    const write = kv.put('regions', { id: 'region', stale: true });
    expect(first.writable).toBe(false);
    await expect(write).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(await takeover).toBe(true);
    await expect(kv.get('regions', 'region')).resolves.toEqual({ id: 'region' });
  });

  it('answers fallback probes while holding the region for an asynchronous reload', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    const first = holder(), second = holder();
    let ready!: () => void;
    const refresh = new Promise<void>((resolve) => { ready = resolve; });
    const initial = first.acquire(false, () => refresh);
    await vi.advanceTimersByTimeAsync(100);
    expect(first.writable).toBe(false);
    localStorage.removeItem('metropolis.region.region');
    const competing = second.acquire();
    await vi.advanceTimersByTimeAsync(100);
    expect(await competing).toBe(false);
    ready();
    expect(await initial).toBe(true);
  });
});
