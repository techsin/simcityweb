/**
 * T089 (W1.3 decision 20): readRecoveryJournal's delete. A journal that does not extend the base it is read for used to
 * be deleted at once ("it can never apply"). One bound to a snapshot can still apply: restoring that snapshot takes it.
 * So a boot of the save underneath leaves it in place for as long as `recovery/<key>` holds that snapshot, and deletes
 * it only when no stored snapshot could take it any more.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as idb from '../../src/save/recoveryIdb';
import type { RecoveryJournal } from '../../src/save/recoveryCodec';
import { journalFixture, PersistentMemoryKV, recoveryFixture } from './fixtures';

afterEach(() => { vi.restoreAllMocks(); });

const city = { regionId: 'rtest', tileKey: '0_0' }, SNAPSHOT = 'rtest:0_0', JOURNAL = 'rtest:0_0#journal';
/** the save a boot loads: the fixture's record, saved at 1000 (its snapshot is at 1010) */
const save = { ...city, savedAt: 1000 };
/** a journal of one edit made after the snapshot at `at`, a delta of the save at `baseSavedAt` */
const bound = (at = 1010, baseSavedAt = 1000): RecoveryJournal => ({
  v: 1, ...city, at: 1020, base: { kind: 'snapshot', at, baseSavedAt }, fromCmd: 1, ops: [{ seq: 2, op: 'setTax', args: [0, 9] }],
});
async function store(journal: RecoveryJournal) {
  const kv = new PersistentMemoryKV(), f = recoveryFixture();
  await idb.storeRecoveryIdb(kv, f.marker, f.payload);
  await idb.storeJournalIdb(kv, journal);
  return { kv, f };
}

describe('readRecoveryJournal and a journal bound to a snapshot (T089)', () => {
  it('leaves it in place when the save underneath is read while that snapshot is stored, and returns it for the snapshot', async () => {
    const { kv, f } = await store(bound());
    const remove = vi.spyOn(kv, 'delete');
    // a boot of the save (readBootJournal): nothing to replay, and nothing deleted
    expect(await idb.readRecoveryJournal(kv, save)).toBeNull();
    expect(remove).not.toHaveBeenCalled();
    expect(await kv.get('recovery', JOURNAL)).toEqual(bound());
    // the snapshot's restore (restoreRecoverySnapshot) still takes it
    expect(await idb.readRecoveryJournal(kv, { ...save, snapshot: f.marker })).toEqual(bound());
  });

  it('deletes it once that snapshot is gone, or another snapshot holds its record', async () => {
    const { kv, f } = await store(bound());
    // a save or a discard deleted the snapshot
    await kv.delete('recovery', SNAPSHOT);
    expect(await idb.readRecoveryJournal(kv, save)).toBeNull();
    expect(await kv.get('recovery', JOURNAL)).toBeUndefined();
    // a later snapshot of the city took the record
    await idb.storeRecoveryIdb(kv, { ...f.marker, at: 1015 }, f.payload);
    await idb.storeJournalIdb(kv, bound());
    expect(await idb.readRecoveryJournal(kv, save)).toBeNull();
    expect(await kv.get('recovery', JOURNAL)).toBeUndefined();
  });

  it('deletes one the stored snapshot could not take: a delta of another save, or an edit list that cannot replay', async () => {
    // the journal names a snapshot at the same time, of another save
    const other = await store(bound(1010, 999));
    expect(await idb.readRecoveryJournal(other.kv, save)).toBeNull();
    expect(await other.kv.get('recovery', JOURNAL)).toBeUndefined();
    // an op outside the journal's whitelist: journalMatches refuses it for every base
    const forged = await store({ ...bound(), ops: [{ seq: 2, op: 'setSpeed' as never, args: [3] }] });
    expect(await idb.readRecoveryJournal(forged.kv, save)).toBeNull();
    expect(await forged.kv.get('recovery', JOURNAL)).toBeUndefined();
  });

  it('keeps the rule for a journal bound to a save: one of another save is deleted, a stored snapshot or not', async () => {
    const { kv } = await store({ ...journalFixture(), base: { kind: 'save', savedAt: 999 } });
    expect(await idb.readRecoveryJournal(kv, save)).toBeNull();
    expect(await kv.get('recovery', JOURNAL)).toBeUndefined();
    // and the journal of the save that is read is returned, beside a stored snapshot
    await idb.storeJournalIdb(kv, journalFixture());
    expect(await idb.readRecoveryJournal(kv, save)).toEqual(journalFixture());
  });

  it('keeps the journal, without failing the read, when the snapshot record cannot be read', async () => {
    const { kv } = await store(bound());
    const get = kv.get.bind(kv);
    const failing = vi.spyOn(kv, 'get').mockImplementation(((store, key) =>
      key === SNAPSHOT ? Promise.reject(new Error('read failed')) : get(store, key)) as typeof kv.get);
    expect(await idb.readRecoveryJournal(kv, save)).toBeNull();
    failing.mockRestore();
    expect(await kv.get('recovery', JOURNAL)).toEqual(bound());
  });
});
