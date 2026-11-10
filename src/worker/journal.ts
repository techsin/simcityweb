/**
 * W1.3 (WORKER_DESIGN §4.3 Replay): the authoritative side of the recovery journal. Every host replays the journal
 * bound to the save it loaded, after init and before the first tick (SimCore.replayBootJournal): the worker reads
 * `recovery/<key>#journal` from its own IndexedDB, the loopback core and LocalSimHost from the page's, where the
 * recovery base names the loaded save. The page's mirror is src/worker/recoveryMirror.ts. Worker-safe: no
 * localStorage, no replica.
 */
import { getRecoveryBase, type CityRecord } from '../save/cities';
import { openKV, type KV } from '../save/db';
import { readRecoveryJournal } from '../save/recoveryIdb';
import type { JournalBase, RecoveryJournal } from '../save/recoveryCodec';
import type { Journal } from './protocol';
import type { CityPersistence } from './SimHost';

/** A journal and the save (and snapshot) it extends */
export interface BootJournal { journal: RecoveryJournal; base: JournalBase }

/** The journal bound to `record`, the save being loaded, or none. One bound to another save or snapshot is deleted on
 *  the way (readRecoveryJournal), as it can never apply. A store that does not persist holds no journal. */
export async function readBootJournal(kv: KV, record: Pick<CityRecord, 'regionId' | 'tileKey' | 'savedAt'>): Promise<BootJournal | undefined> {
  if (!kv.persistent) return undefined;
  const base: JournalBase = { regionId: record.regionId, tileKey: record.tileKey, savedAt: record.savedAt };
  const journal = await readRecoveryJournal(kv, base);
  return journal ? { journal, base } : undefined;
}

/** LocalSimHost and the loopback: the page's recovery base is the save it loaded (loadCity / saveCity set it). */
export async function bootJournal(persistence: CityPersistence | null | undefined): Promise<BootJournal | undefined> {
  if (!persistence) return undefined;
  const record = getRecoveryBase(persistence.regionId, persistence.tileKey);
  if (!record) return undefined;
  return readBootJournal(await openKV(), record);
}

/** §4.3: replayed edits that no save holds yet ride in the Ready, renumbered with seqs ≤ 0 and bound to the loaded
 *  save. The page's mirror starts from them, so a second crash before the first save loses nothing, and that save,
 *  which contains them, trims them. */
export function carriedJournal({ journal, base }: BootJournal, applied: readonly number[], now = Date.now()): Journal | undefined {
  if (!applied.length) return undefined;
  const keep = new Set(applied), ops = journal.ops.filter((entry) => keep.has(entry.seq)), n = ops.length;
  return { v: 1, regionId: base.regionId, tileKey: base.tileKey, at: Math.max(now, base.savedAt),
    base: { kind: 'save', savedAt: base.savedAt }, fromCmd: -n, ops: ops.map((entry, i) => ({ ...entry, seq: i + 1 - n })),
    ...(journal.info ? { info: journal.info } : {}) };
}
