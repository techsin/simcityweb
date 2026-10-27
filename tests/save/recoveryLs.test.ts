import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LS_BUDGET_BYTES } from '../../src/save/recoveryCodec';
import * as ls from '../../src/save/recoveryLs';
import { journalFixture, MemStorage, recoveryFixture } from './fixtures';

let storage: MemStorage;
beforeEach(() => { storage = new MemStorage(); vi.stubGlobal('localStorage', storage); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('recovery localStorage slot', () => {
  it('writes synchronously; peeking reads only the marker, while reading restores the packed payload', () => {
    const f = recoveryFixture();
    expect(ls.storeRecoveryLs(f.marker, f.payload)).toBe(true);
    const get = vi.spyOn(storage, 'getItem');
    expect(ls.peekRecoveryMarker()).toMatchObject({ at: 1010, ls: true });
    expect(get).toHaveBeenCalledExactlyOnceWith('metropolis.recovery');
    expect(ls.readLsSnapshot()?.payload).toEqual(f.payload);
  });

  it('reserves space for the journal and marks journals that can only be stored in IDB', () => {
    const f = recoveryFixture(), journal = journalFixture();
    const payload = new Uint8Array(LS_BUDGET_BYTES - ls.JOURNAL_RESERVE_BYTES + 1);
    expect(ls.storeRecoveryLs({ ...f.marker, bytes: payload.length }, payload, journal)).toBe(false);
    expect(storage.getItem('metropolis.recovery.data')).toBeNull();
    expect(JSON.parse(storage.getItem('metropolis.recovery.journal')!)).toEqual(journal);
    expect(ls.peekRecoveryMarker()).toMatchObject({ kind: 'snapshot', journalIdbOnly: false });
    journal.ops[0].args = ['x'.repeat(ls.JOURNAL_RESERVE_BYTES)];
    ls.storeRecoveryLs({ ...f.marker }, null, journal);
    expect(ls.peekRecoveryMarker()).toMatchObject({ kind: 'journal', bytes: 0, ls: false, journalIdbOnly: true });
    expect(storage.getItem('metropolis.recovery.journal')).toBeNull();
  });

  it('handles quota failures and corrupt data without claiming a payload exists', () => {
    const f = recoveryFixture(); storage.quota = 1000;
    expect(ls.storeRecoveryLs(f.marker, f.payload)).toBe(false);
    expect(ls.peekRecoveryMarker()?.ls).toBe(false);
    storage.quota = Infinity; ls.storeRecoveryLs(f.marker, f.payload);
    storage.setItem('metropolis.recovery.data', 'bad');
    expect(ls.readLsSnapshot()?.payload).toBeNull();
    storage.setItem('metropolis.recovery', '{');
    expect(ls.peekRecoveryMarker()).toBeNull();
  });

  it('clears only the saved city, including its journal, and preserves snapshots made from the new base', () => {
    const f = recoveryFixture();
    ls.storeRecoveryLs(f.marker, f.payload, journalFixture());
    expect(ls.clearRecoveryAfterSave('other', '0_0', 1005)).toBe(false);
    expect(ls.peekRecoveryMarker()).not.toBeNull();
    expect(ls.clearRecoveryAfterSave('rtest', '0_0', 1005)).toBe(true);
    expect(storage.m.size).toBe(0);
    ls.storeRecoveryLs({ ...f.marker, baseSavedAt: 1005 }, f.payload);
    expect(ls.clearRecoveryAfterSave('rtest', '0_0', 1005)).toBe(false);
    expect(ls.peekRecoveryMarker()?.baseSavedAt).toBe(1005);
    expect(ls.clearRecoveryAfterSave('rtest', '0_0', 1020)).toBe(false);
    expect(storage.m.size).toBe(0);
  });
});
