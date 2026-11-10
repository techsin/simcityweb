/** NEW-04: losing ownership preserves the current recovery slot and blocks IndexedDB mutations too. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryKV, restrictRegionSaveAccess } from '../../src/save/db';
import { clearRecoveryAfterSave, discardRecoverySnapshot, peekRecoveryMarker, readLsJournal, readLsSnapshot, storeRecoveryLs } from '../../src/save/recoveryLs';
import { journalFixture, MemStorage, recoveryFixture } from './fixtures';

let storage: MemStorage;
let release: (() => void) | null = null;
beforeEach(() => {
  storage = new MemStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  release?.();
  release = null;
  vi.unstubAllGlobals();
});

function storedRecovery() {
  const { marker, payload } = recoveryFixture(), journal = journalFixture();
  expect(storeRecoveryLs(marker, payload, journal)).toBe(true);
  return { marker, payload, journal, slot: new Map(storage.m) };
}

describe('recovery storage permission', () => {
  it('does not overwrite a recovery payload, marker or journal after write permission is revoked', () => {
    const { marker, journal, slot } = storedRecovery();
    release = restrictRegionSaveAccess(() => false);
    expect(storeRecoveryLs({ ...marker, at: marker.at + 10 }, new Uint8Array([9, 8, 7]), { ...journal, at: journal.at + 10 })).toBe(false);
    expect(storage.m).toEqual(slot);
    expect(peekRecoveryMarker()?.at).toBe(marker.at);
    expect(readLsJournal()?.at).toBe(journal.at);
  });

  it('does not discard an owned slot through either a global or city-specific cleanup while read-only', () => {
    const { marker, payload, slot } = storedRecovery();
    release = restrictRegionSaveAccess(() => false);
    discardRecoverySnapshot();
    discardRecoverySnapshot({ regionId: marker.regionId, tileKey: marker.tileKey });
    expect(storage.m).toEqual(slot);
    expect(readLsSnapshot()?.payload).toEqual(payload);
  });

  it('does not clear a newer snapshot after a save from a revoked owner, and resumes once allowed', () => {
    const { marker, slot } = storedRecovery();
    let writable = false;
    release = restrictRegionSaveAccess((id) => id === marker.regionId && writable);
    expect(clearRecoveryAfterSave(marker.regionId, marker.tileKey, marker.at - 1)).toBe(false);
    expect(storage.m).toEqual(slot);
    writable = true;
    expect(clearRecoveryAfterSave(marker.regionId, marker.tileKey, marker.at - 1)).toBe(true);
    expect(peekRecoveryMarker()).toBeNull();
    expect(readLsJournal()).toBeNull();
    expect(storage.m.size).toBe(0);
  });

  it('checks the current permission for each IndexedDB put and delete while leaving reads available', async () => {
    const kv = new MemoryKV(), record = { marker: { regionId: 'rtest' }, payload: new Uint8Array([1, 2, 3]) };
    await kv.put('recovery', record, 'rtest:0_0');
    let writable = false;
    release = restrictRegionSaveAccess((id) => id === 'rtest' && writable);
    await expect(kv.put('recovery', { ...record, payload: new Uint8Array([9]) }, 'rtest:0_0')).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(kv.delete('recovery', 'rtest:0_0')).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(await kv.get('recovery', 'rtest:0_0')).toEqual(record);
    writable = true;
    await kv.delete('recovery', 'rtest:0_0');
    expect(await kv.get('recovery', 'rtest:0_0')).toBeUndefined();
  });

  it('uses the store key for ownership even if recovery metadata names an allowed region', async () => {
    const kv = new MemoryKV();
    release = restrictRegionSaveAccess((id) => id === 'allowed');
    await expect(kv.put('recovery', { regionId: 'allowed' }, 'busy:0_0#journal')).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(await kv.keys('recovery')).toEqual([]);
  });
});
