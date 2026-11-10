/** Recovery records in IndexedDB; localStorage adoption is supplied by the page-side composition. */
import type { KV } from './db';
import { cityKey, type CityRecord } from './cities';
import { journalMatches, journalOnlyMarker, type JournalBase, type RecoveryJournal, type PendingRecovery, type RecoveryCity, type RecoveryMarker } from './recoveryCodec';
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
  // it can never apply. The cleanup is best-effort: a tab without its region's lock is refused the delete (NEW-04), and
  // that must not fail a boot's read (LocalSimHost and the loopback read here on every start); the holder deletes it
  await kv.delete('recovery', key).catch(() => undefined);
  return null;
}

/** Adopt an unload copy only after its loaded record/snapshot has been identified. A newer IndexedDB copy stays, even
 *  one bound to another base: it is the later write. */
export async function adoptRecoveryJournal(kv: KV, journal: RecoveryJournal, base: JournalBase): Promise<boolean> {
  if (!journalMatches(journal, base)) return false;
  const current = await kv.get<RecoveryJournal>('recovery', recKey(base) + '#journal');
  if (current && current.at > journal.at) return false;
  await storeJournalIdb(kv, journal);
  return true;
}

export async function peekRecoveryMarker(kv: KV, city: RecoveryCity): Promise<RecoveryMarker | null> {
  return (await kv.get<IdbRecoveryRecord>('recovery', recKey(city)))?.marker ?? null;
}

/** A snapshot, or (W1.3) a journal, of the city is stored; findRecoverySnapshot decides whether it can be offered. */
export async function hasRecoverySnapshot(kv: KV, city: RecoveryCity): Promise<boolean> {
  if (!kv.persistent) return false;
  const key = recKey(city), journal = key + '#journal';
  return (await kv.keys('recovery', key, key)).length > 0 || (await kv.keys('recovery', journal, journal)).length > 0;
}

export async function adoptRecoverySnapshot(kv: KV, marker: RecoveryMarker, payload: Uint8Array): Promise<void> {
  const cur = await peekRecoveryMarker(kv, marker);
  if (!cur || cur.at < marker.at) await storeRecoveryIdb(kv, marker, payload);
}

/**
 * The newest pending snapshot (of `city`, or of any city) that can be restored: newer than the stored full save of
 * its city and a delta of exactly that save. Stale / orphaned / mismatched snapshots met on the way are deleted.
 * W1.3 (§4.3 Restoring): a city with no restorable snapshot can still have a journal alone, bound to its stored save;
 * that is offered too (the newer of the two kinds). A city's snapshot wins over its journal: restoring the snapshot
 * takes the journal bound to it, and a journal bound to the save underneath it would replay edits the snapshot holds.
 */
export async function findRecoverySnapshot(kv: KV, city?: RecoveryCity): Promise<PendingRecovery | null> {
  if (!kv.persistent) return null;
  const snapshot = await findSnapshot(kv, city);
  if (snapshot === undefined) return null;
  const alone = await findJournalAlone(kv, city, snapshot).catch(() => null);
  return alone && (!snapshot || alone.marker.at > snapshot.marker.at) ? alone : snapshot;
}

/** undefined when the store could not be listed */
async function findSnapshot(kv: KV, city?: RecoveryCity): Promise<PendingRecovery | null | undefined> {
  const cands: { key: string; rec: IdbRecoveryRecord }[] = [];
  try {
    for (const key of await kv.keys('recovery')) {
      if (key.endsWith('#journal')) continue;
      const rec = await kv.get<IdbRecoveryRecord>('recovery', key);
      if (rec?.marker && rec.payload && typeof rec.marker.at === 'number' && (!city || sameCity(rec.marker, city))) cands.push({ key, rec });
      // a cleanup refused (another tab owns that region, NEW-04) must not end the scan for the city asked about
      else if (!rec?.marker || !rec.payload) await kv.delete('recovery', key).catch(() => undefined);
    }
  } catch {
    return undefined;
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

/** W1.3: the newest journal with edits, bound to its city's stored save, of a city without a restorable snapshot
 *  (`snapshot`, the newest one, is that city's when it has one: findSnapshot drops stale ones on the way). Journals
 *  that can never apply (their save or snapshot was replaced, their city or region is gone, no edits) are deleted. */
async function findJournalAlone(kv: KV, city: RecoveryCity | undefined, snapshot: PendingRecovery | null): Promise<PendingRecovery | null> {
  let best: PendingRecovery | null = null;
  for (const key of await kv.keys('recovery')) {
    if (!key.endsWith('#journal')) continue;
    const journal = await kv.get<RecoveryJournal>('recovery', key);
    if (!journal || typeof journal !== 'object' || typeof journal.regionId !== 'string' || typeof journal.tileKey !== 'string') {
      await kv.delete('recovery', key).catch(() => undefined);
      continue;
    }
    if (city && !sameCity(journal, city)) continue;
    // a snapshot of this city is restorable (or merely stored, when another city's was newest): it decides
    if ((snapshot && sameCity(snapshot.marker, journal)) || await kv.get('recovery', recKey(journal))) continue;
    const record = await kv.get<CityRecord>('cities', recKey(journal));
    const region = await kv.get<{ id: string; name: string }>('regions', journal.regionId);
    if (!record || !region || !journal.ops?.length || !journalMatches(journal, { regionId: journal.regionId, tileKey: journal.tileKey, savedAt: record.savedAt })) {
      await kv.delete('recovery', key).catch(() => undefined);
      continue;
    }
    if (best && best.marker.at >= journal.at) continue;
    best = { marker: journalOnlyMarker(journal, record, region.name), payload: new Uint8Array(0), record, journal };
  }
  return best;
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
