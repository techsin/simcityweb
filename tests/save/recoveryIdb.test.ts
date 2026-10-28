import { afterEach, describe, expect, it, vi } from 'vitest';
import * as idb from '../../src/save/recoveryIdb';
import { deferred, journalFixture, PersistentMemoryKV, recoveryFixture, regionData } from './fixtures';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('recovery IDB records', () => {
  it('stores snapshot and journal separately, and adopts only a newer snapshot', async () => {
    const kv = new PersistentMemoryKV(), f = recoveryFixture(), journal = journalFixture();
    await idb.storeRecoveryIdb(kv, f.marker, f.payload);
    await idb.storeJournalIdb(kv, journal);
    expect(await kv.get('recovery', 'rtest:0_0#journal')).toEqual(journal);
    expect(await idb.hasRecoverySnapshot(kv, f.marker)).toBe(true);
    await idb.adoptRecoverySnapshot(kv, { ...f.marker, at: 1005 }, new Uint8Array([1]));
    expect(await idb.peekRecoveryMarker(kv, f.marker)).toEqual(f.marker);
    await idb.adoptRecoverySnapshot(kv, { ...f.marker, at: 1020 }, f.payload);
    expect((await idb.peekRecoveryMarker(kv, f.marker))?.at).toBe(1020);
  });

  it('finds only snapshots newer than their exact saved base, with an existing city and region', async () => {
    const kv = new PersistentMemoryKV(), f = recoveryFixture();
    await kv.put('regions', regionData()); await kv.put('cities', f.record, f.record.key);
    await idb.storeJournalIdb(kv, journalFixture());
    await idb.storeRecoveryIdb(kv, f.marker, f.payload);
    expect(await idb.findRecoverySnapshot(kv, { regionId: 'rtest', tileKey: 'other' })).toBeNull();
    expect((await idb.findRecoverySnapshot(kv))?.marker.regionName).toBe('Test Region');
    for (const savedAt of [1010, 1011, 1001]) {
      await kv.put('cities', { ...f.record, savedAt }, f.record.key);
      await idb.storeRecoveryIdb(kv, f.marker, f.payload);
      expect(await idb.findRecoverySnapshot(kv)).toBeNull();
      expect(await idb.peekRecoveryMarker(kv, f.marker)).toBeNull();
    }
    await kv.put('cities', f.record, f.record.key); await kv.delete('regions', 'rtest');
    await idb.storeRecoveryIdb(kv, f.marker, f.payload);
    expect(await idb.findRecoverySnapshot(kv)).toBeNull();
    expect(await kv.get('recovery', 'rtest:0_0#journal')).toEqual(journalFixture());
  });

  it('awaits both deletions, reports an IDB-only newer snapshot, and leaves other cities alone', async () => {
    const kv = new PersistentMemoryKV(), f = recoveryFixture(), gate = deferred();
    await idb.storeRecoveryIdb(kv, f.marker, f.payload);
    await idb.storeJournalIdb(kv, journalFixture());
    await idb.storeRecoveryIdb(kv, { ...f.marker, tileKey: 'other' }, f.payload);
    const remove = kv.delete.bind(kv);
    vi.spyOn(kv, 'delete').mockImplementation(async (store, key) => { await gate.promise; await remove(store, key); });
    let done = false;
    const clearing = idb.clearRecoveryAfterSave(kv, 'rtest', '0_0', 1005).then((newer) => { done = true; return newer; });
    expect(kv.delete).toHaveBeenCalledTimes(2);
    await Promise.resolve(); expect(done).toBe(false);
    gate.resolve(); expect(await clearing).toBe(true);
    expect(await kv.keys('recovery')).toEqual(['rtest:other']);
    await idb.discardRecoverySnapshot(kv);
    expect(await kv.keys('recovery')).toEqual([]);
  });

  it('issues the IDB put and explicit commit before yielding, and waits for transaction completion', async () => {
    vi.resetModules(); vi.useFakeTimers();
    const put = vi.fn(), commit = vi.fn();
    const tx = { objectStore: () => ({ keyPath: null, put }), commit, oncomplete: null as null | (() => void), onerror: null, onabort: null };
    const request = { result: { transaction: () => tx }, onsuccess: null as null | (() => void) };
    vi.stubGlobal('indexedDB', { open: () => request });
    const { openKV } = await import('../../src/save/db');
    const opening = openKV(); request.onsuccess!();
    const kv = await opening, f = recoveryFixture();
    let completed = false;
    const write = idb.storeRecoveryIdb(kv, f.marker, f.payload).then(() => { completed = true; });
    expect(put).toHaveBeenCalledExactlyOnceWith({ marker: f.marker, payload: f.payload }, 'rtest:0_0');
    expect(commit).toHaveBeenCalledOnce();
    await Promise.resolve(); expect(completed).toBe(false);
    tx.oncomplete!(); await write; expect(completed).toBe(true);
    commit.mockClear();
    const journal = idb.storeJournalIdb(kv, journalFixture());
    expect(commit).toHaveBeenCalledOnce(); tx.oncomplete!(); await journal;
    vi.clearAllTimers();
  });
});
