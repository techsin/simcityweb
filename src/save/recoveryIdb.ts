/** Recovery records in IndexedDB; localStorage adoption is supplied by the page-side composition. */
import type { KV } from './db';
import { cityKey, type CityRecord } from './cities';
import { journalMatches, type JournalBase, type RecoveryJournal, type PendingRecovery, type RecoveryCity, type RecoveryMarker } from './recoveryCodec';
import type { Journal } from '../worker/protocol';

export interface IdbRecoveryRecord { marker: RecoveryMarker; payload: Uint8Array }
const recKey = (c: RecoveryCity) => cityKey(c.regionId, c.tileKey);
const sameCity = (a: RecoveryCity, b: RecoveryCity) => a.regionId === b.regionId && a.tileKey === b.tileKey;

/** KV.put issues the request and explicit commit synchronously, and resolves on transaction completion. */
export function storeRecoveryIdb(kv: KV, marker: RecoveryMarker, payload: Uint8Array): Promise<void> {
  return kv.put('recovery', { marker, payload } satisfies IdbRecoveryRecord, recKey(marker));
}

export function storeJournalIdb(kv: KV, journal: Journal): Promise<void> {
  return kv.put('recovery', journal, recKey(journal) + '#journal');
}

// W1.1b: independent of title-screen snapshot restoration and safe in the authoritative isolate.
export async function readRecoveryJournal(kv: KV, base: JournalBase): Promise<RecoveryJournal | null> {
  const key = recKey(base) + '#journal';
  const journal = await kv.get<RecoveryJournal>('recovery', key);
  if (!journal) return null;
  if (journalMatches(journal, base)) return journal;
  await kv.delete('recovery', key);
  return null;
}

/** Adopt an unload copy only after its loaded record/snapshot has been identified. */
export async function adoptRecoveryJournal(kv: KV, journal: RecoveryJournal, base: JournalBase): Promise<void> {
  if (!journalMatches(journal, base)) return;
  const current = await readRecoveryJournal(kv, base);
  if (!current || current.at <= journal.at) await storeJournalIdb(kv, journal);
}

export async function peekRecoveryMarker(kv: KV, city: RecoveryCity): Promise<RecoveryMarker | null> {
  return (await kv.get<IdbRecoveryRecord>('recovery', recKey(city)))?.marker ?? null;
}

export async function hasRecoverySnapshot(kv: KV, city: RecoveryCity): Promise<boolean> {
  if (!kv.persistent) return false;
  const key = recKey(city);
  return (await kv.keys('recovery', key, key)).length > 0;
}

export async function adoptRecoverySnapshot(kv: KV, marker: RecoveryMarker, payload: Uint8Array): Promise<void> {
  const cur = await peekRecoveryMarker(kv, marker);
  if (!cur || cur.at < marker.at) await storeRecoveryIdb(kv, marker, payload);
}

/**
 * The newest pending snapshot (of `city`, or of any city) that can be restored: newer than the stored full save of
 * its city and a delta of exactly that save. Stale / orphaned / mismatched snapshots met on the way are deleted.
 */
export async function findRecoverySnapshot(kv: KV, city?: RecoveryCity): Promise<PendingRecovery | null> {
  if (!kv.persistent) return null;
  const cands: { key: string; rec: IdbRecoveryRecord }[] = [];
  try {
    for (const key of await kv.keys('recovery')) {
      if (key.endsWith('#journal')) continue;
      const rec = await kv.get<IdbRecoveryRecord>('recovery', key);
      if (rec?.marker && rec.payload && typeof rec.marker.at === 'number' && (!city || sameCity(rec.marker, city))) cands.push({ key, rec });
      else if (!rec?.marker || !rec.payload) await kv.delete('recovery', key);
    }
  } catch {
    return null;
  }
  cands.sort((a, b) => b.rec.marker.at - a.rec.marker.at);
  for (const { key, rec } of cands) {
    const m = rec.marker;
    const record = (await kv.get<CityRecord>('cities', recKey(m))) ?? null;
    const region = await kv.get<{ id: string; name: string }>('regions', m.regionId);
    // restorable only onto the full save it is a delta of (and only while that save is older than the snapshot)
    const stale = !region || !record || record.savedAt >= m.at || (m.baseSavedAt !== 0 && record.savedAt !== m.baseSavedAt);
    if (stale) {
      await kv.delete('recovery', key).catch(() => undefined);
      continue;
    }
    if (!m.regionName) m.regionName = region.name;
    return { marker: m, payload: rec.payload, record };
  }
  return null;
}

/** Start the delete before yielding, so later snapshot writes queue after it. */
export async function discardRecoverySnapshot(kv: KV, city?: RecoveryCity): Promise<void> {
  if (city) {
    await Promise.all([kv.delete('recovery', recKey(city)), kv.delete('recovery', recKey(city) + '#journal')]);
  } else for (const key of await kv.keys('recovery')) await kv.delete('recovery', key);
}

export async function clearRecoveryAfterSave(kv: KV, regionId: string, tileKey: string, savedAt: number): Promise<boolean> {
  const city = { regionId, tileKey };
  const marker = peekRecoveryMarker(kv, city);
  const deletion = discardRecoverySnapshot(kv, city);
  const [m] = await Promise.all([marker, deletion]);
  return !!m && m.at > savedAt;
}
