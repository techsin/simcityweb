/**
 * Emergency "unsaved progress" snapshots (used by main.ts on beforeunload / pagehide / tab hide, and periodically
 * while a city has unsaved changes).
 *
 * Why not just save on beforeunload: an IndexedDB write started while the page unloads is aborted when the document
 * is torn down unless the backend has already committed it — a multi-MB city put usually has not (measured in
 * Chromium: 0-4 of 4 survived a reload / tab close). A synchronous localStorage write, and a SMALL IndexedDB write
 * with an explicit commit(), do survive (48/48). So the snapshot is kept small: a DELTA against the last full save of
 * the city (every typed array XOR'ed with the base and zero-run-length coded, so unchanged data costs ~nothing) plus
 * the plain data. It is written synchronously to localStorage (one slot: the latest snapshot, when it fits) and, best
 * effort, to IndexedDB (store 'recovery', one record per city key 'regionId:tileKey').
 *
 * The base is the SerializedCity of the last completed full save / load of the city (kept in memory: saveCity and
 * loadCity call setRecoveryBase). On the next start findRecoverySnapshot() first moves the localStorage copy into
 * IndexedDB (so a later snapshot of another city cannot overwrite it), then validates snapshots against the stored
 * full save (a delta of exactly that save, and newer than it); restoreRecoverySnapshot() rebuilds the city and makes
 * it the save. A completed full save deletes its city's snapshots (clearRecoveryAfterSave).
 *
 * Pure codec (encodeCityDelta / applyCityDelta / packBytes / unpackBytes) is headless and unit-tested.
 */
import { getCityRecord, getRecoveryBase, putCityRecord, cityKey } from './cities';
import { openedKV, openKV, type KV } from './db';
import { buildRecoverySnapshot, rebuildRecoveredCity, type JournalBase, type PendingRecovery, type RecoveryCity, type RecoveryMarker, type RecoverySnapshot, type SnapshotInfo, type WriteResult } from './recoveryCodec';
import * as idb from './recoveryIdb';
import * as ls from './recoveryLs';
import { assertSavableCity, type SavableCityState } from './state';

export * from './recoveryCodec';
export { setRecoveryBase, clearRecoveryBase, recoveryBaseSavedAt } from './cities';
export { peekRecoveryMarker } from './recoveryLs';

/** LocalSimHost's unload path: encode and write the synchronous slot before returning. */
export function writeRecoverySnapshot(regionId: string, tileKey: string, state: SavableCityState, info: SnapshotInfo): WriteResult & RecoverySnapshot {
  assertSavableCity(state);
  const t0 = performance.now();
  const snapshot = buildRecoverySnapshot(regionId, tileKey, state, getRecoveryBase(regionId, tileKey), { ...info, at: Date.now() });
  const storedLs = ls.storeRecoveryLs(snapshot.marker, snapshot.payload);
  let storedIdb = false;
  const kv = openedKV();
  if (kv?.persistent) {
    try {
      void idb.storeRecoveryIdb(kv, snapshot.marker, snapshot.payload).catch(() => undefined);
      storedIdb = true;
    } catch { /* e.g. DataCloneError */ }
  }
  return { ...snapshot, ok: storedLs || storedIdb, bytes: snapshot.payload.length, ls: storedLs, idb: storedIdb, ms: performance.now() - t0 };
}

export async function hasRecoverySnapshot(city: RecoveryCity): Promise<boolean> {
  const m = ls.peekRecoveryMarker();
  if (m?.regionId === city.regionId && m.tileKey === city.tileKey) return true;
  try { return await idb.hasRecoverySnapshot(await openKV(), city); } catch { return false; }
}

/** Move the reliable unload copy into IDB before looking for a restorable city. */
export async function findRecoverySnapshot(city?: RecoveryCity): Promise<PendingRecovery | null> {
  const kv = await openKV();
  if (!kv.persistent) return null;
  const local = ls.readLsSnapshot();
  if (local) {
    try {
      if (local.payload) await idb.adoptRecoverySnapshot(kv, local.marker, local.payload);
      await adoptLsJournal(kv, local.marker);
      const current = ls.peekRecoveryMarker();
      if (current?.at === local.marker.at && current.regionId === local.marker.regionId && current.tileKey === local.marker.tileKey) ls.discardRecoverySnapshot(local.marker);
    } catch { /* keep the localStorage copy */ }
  }
  return idb.findRecoverySnapshot(kv, city);
}

/** T033 (§4.3 Restoring): the unload journal moves into IndexedDB with the snapshot, once the save (and snapshot) it
 *  extends is identified; one bound to anything else is left behind with the slot. */
async function adoptLsJournal(kv: KV, marker: RecoveryMarker): Promise<void> {
  const journal = ls.readLsJournal();
  if (!journal || journal.regionId !== marker.regionId || journal.tileKey !== marker.tileKey) return;
  const record = await getCityRecord(kv, journal.regionId, journal.tileKey);
  if (!record) return;
  const base: JournalBase = { regionId: record.regionId, tileKey: record.tileKey, savedAt: record.savedAt };
  if (journal.base.kind === 'snapshot') {
    const snapshot = marker.at === journal.base.at ? marker : await idb.peekRecoveryMarker(kv, journal);
    if (!snapshot) return;
    base.snapshot = snapshot;
  }
  await idb.adoptRecoveryJournal(kv, journal, base);
}

/** Make the recovered snapshot the full save, then clear both recovery copies. A journal that extends the snapshot is
 *  re-bound to the new record (§4.3), so the next boot replays it onto the restored city. KV has no transaction
 *  across stores: it is written after the record, so a stop in between loses only what the snapshot alone would. */
export async function restoreRecoverySnapshot(p: PendingRecovery): Promise<void> {
  const city = rebuildRecoveredCity(p);
  const kv = await openKV();
  const { regionId, tileKey } = p.marker;
  const journal = p.record
    ? await idb.readRecoveryJournal(kv, { regionId, tileKey, savedAt: p.record.savedAt, snapshot: p.marker }).catch(() => null) : null;
  city.savedAt = Date.now();
  await putCityRecord(kv, { key: cityKey(regionId, tileKey), regionId, tileKey, savedAt: city.savedAt, city });
  await discardRecoverySnapshot(p.marker);
  if (journal?.ops.length) {
    await idb.storeJournalIdb(kv, { ...journal, at: Math.max(journal.at, city.savedAt), base: { kind: 'save', savedAt: city.savedAt } })
      .catch(() => undefined);
  }
}

export async function discardRecoverySnapshot(city?: RecoveryCity): Promise<void> {
  ls.discardRecoverySnapshot(city);
  try { await idb.discardRecoverySnapshot(openedKV() ?? await openKV(), city); } catch { /* ignore */ }
}

/** Await both halves; report a snapshot cut while the completed save was being written. */
export async function clearRecoveryAfterSave(regionId: string, tileKey: string, savedAt: number): Promise<boolean> {
  const newer = ls.clearRecoveryAfterSave(regionId, tileKey, savedAt);
  try { return await idb.clearRecoveryAfterSave(openedKV() ?? await openKV(), regionId, tileKey, savedAt) || newer; }
  catch { return newer; }
}
