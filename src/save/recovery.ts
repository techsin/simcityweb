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
import { getRecoveryBase, putCityRecord, cityKey } from './cities';
import { openedKV, openKV } from './db';
import { buildRecoverySnapshot, rebuildRecoveredCity, type PendingRecovery, type RecoveryCity, type RecoverySnapshot, type SnapshotInfo, type WriteResult } from './recoveryCodec';
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
      const current = ls.peekRecoveryMarker();
      if (current?.at === local.marker.at && current.regionId === local.marker.regionId && current.tileKey === local.marker.tileKey) ls.discardRecoverySnapshot(local.marker);
    } catch { /* keep the localStorage copy */ }
  }
  return idb.findRecoverySnapshot(kv, city);
}

/** Make the recovered snapshot the full save, then clear both recovery copies. */
export async function restoreRecoverySnapshot(p: PendingRecovery): Promise<void> {
  const city = rebuildRecoveredCity(p);
  const kv = await openKV();
  const { regionId, tileKey } = p.marker;
  city.savedAt = Date.now();
  await putCityRecord(kv, { key: cityKey(regionId, tileKey), regionId, tileKey, savedAt: city.savedAt, city });
  await discardRecoverySnapshot(p.marker);
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
