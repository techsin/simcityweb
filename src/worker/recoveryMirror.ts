/** Main's encoded recovery payload and base-bound command journal (WORKER_DESIGN §4.3, R7); never a serialized city
 *  or a simulation (O6). Packet hosts feed it from their command, ack, save and snapshot paths (T033). */
import { openedKV, type KV } from '../save/db';
import {
  DELTA_VERSION, JOURNAL_RESERVE_BYTES, isJournalOp, journalMatches,
  type RecoveryCity, type RecoveryInfo, type RecoveryJournal, type RecoveryMarker,
} from '../save/recoveryCodec';
import { storeJournalIdb } from '../save/recoveryIdb';
import { clearRecoveryAfterSave, storeRecoveryLs } from '../save/recoveryLs';
import type { RecoveryMirror as RecoveryWriter, SnapshotWhy } from './SimHost';

type Entry = RecoveryJournal['ops'][number];

export interface RecoveryMirrorOptions extends RecoveryCity {
  /** the loaded or last completed save: the journal's base */
  savedAt: number;
  /** the highest command seq that base contains */
  cmd?: number;
  /** the marker's metadata for a journal-only write; a function is read at write time */
  info: RecoveryInfo | (() => RecoveryInfo);
  signal: AbortSignal;
  kv?: KV;
  now?: () => number;
  /** asked once the journal passes half its localStorage reserve (`why: 'journal'`) */
  requestSnapshot?: () => void | Promise<unknown>;
  /** A boot whose post-replay save did not happen: the replayed edits, renumbered with seqs ≤ 0 (§4.3). */
  journal?: RecoveryJournal;
}

export class RecoveryMirror implements RecoveryWriter {
  private city: RecoveryCity;
  private savedAt: number;
  private savedCmd: number;
  private fromCmd: number;
  private ops: Entry[] = [];
  /** the UTF-16 bytes of the ops' JSON, kept incrementally for the reserve check */
  private opBytes = 0;
  private saves: number[] = [];
  private snapshot: { marker: RecoveryMarker; payload: Uint8Array } | null = null;
  private info: RecoveryInfo | (() => RecoveryInfo);
  private kv: KV | null;
  private now: () => number;
  private requestSnapshot: (() => void | Promise<unknown>) | null;
  private requested = false;
  /** something changed since the last write: a periodic write without a change is skipped */
  private dirty = false;
  private disposed = false;
  private signal: AbortSignal;

  constructor(opts: RecoveryMirrorOptions) {
    this.city = { regionId: opts.regionId, tileKey: opts.tileKey };
    this.savedAt = opts.savedAt;
    this.fromCmd = opts.cmd ?? 0;
    this.savedCmd = this.fromCmd;
    this.info = typeof opts.info === 'function' ? opts.info : structuredClone(opts.info);
    this.kv = opts.kv ?? openedKV();
    this.now = opts.now ?? Date.now;
    this.requestSnapshot = opts.requestSnapshot ?? null;
    this.signal = opts.signal;
    if (opts.journal && journalMatches(opts.journal, { ...this.city, savedAt: this.savedAt })) {
      this.fromCmd = opts.journal.fromCmd;
      this.savedCmd = this.fromCmd;
      this.ops = structuredClone(opts.journal.ops);
      this.dirty = this.ops.length > 0;
      this.measure();
    }
    if (this.signal.aborted) this.dispose();
    else this.signal.addEventListener('abort', this.dispose, { once: true });
  }

  /** the journal as it would be written now */
  get journal(): RecoveryJournal {
    const m = this.snapshot?.marker;
    return {
      v: 1, ...this.city, at: this.now(),
      base: m ? { kind: 'snapshot', at: m.at, baseSavedAt: this.savedAt } : { kind: 'save', savedAt: this.savedAt },
      fromCmd: this.fromCmd, ops: structuredClone(this.ops.filter((entry) => entry.seq > this.fromCmd)),
    };
  }
  /** the save the journal is bound to, directly or through its snapshot */
  get baseSavedAt(): number { return this.savedAt; }

  /** On posting, before an ack can arrive: commands still in flight at unload stay in (§4.3). Predictions never
   *  decide what survives recovery; the arguments are copied, so a caller's later edit cannot change them. */
  onCommand(seq: number, op: string, args: unknown[]): void {
    if (this.disposed || !isJournalOp(op)) return;
    if (!Number.isSafeInteger(seq) || seq <= this.fromCmd || seq <= (this.ops.at(-1)?.seq ?? -Infinity)) return;
    const copy = structuredClone(args);
    // toggles are stored as sets (R7); ordinance replays never stop at a confirmation
    if (op === 'setOrdinance') copy[2] = { confirm: true };
    const entry: Entry = { seq, op, args: copy };
    this.ops.push(entry);
    this.opBytes += bytesOf(entry);
    this.dirty = true;
    this.checkReserve();
  }

  /** The authoritative result: a failure leaves the journal; a bulldoze keeps the charge it was acked with. */
  onAck(seq: number, result: unknown): void {
    if (this.disposed) return;
    const index = this.ops.findIndex((entry) => entry.seq === seq);
    if (index < 0) return;
    const r = result as { ok?: boolean; cost?: number; refund?: number } | null | undefined;
    if (result === false || r?.ok === false || (r && typeof r === 'object' && 'commandError' in r)) {
      this.opBytes -= bytesOf(this.ops[index]);
      this.ops.splice(index, 1);
      this.dirty = true;
      return;
    }
    const entry = this.ops[index];
    if (entry.op === 'bulldoze' && r?.ok === true && Number.isFinite(r.cost)) {
      this.opBytes -= bytesOf(entry);
      entry.cost = r.cost;
      if (Number.isFinite(r.refund)) entry.refund = r.refund;
      this.opBytes += bytesOf(entry);
      this.dirty = true;
    }
    this.checkReserve();
  }

  /** Saves are FIFO. Pin the current suffix only while a copy/put may be in flight. */
  onSaving(): void { if (!this.disposed) this.saves.push(this.fromCmd); }

  onSaveFailed(): void {
    if (this.disposed) return;
    this.saves.shift();
    this.prune();
  }

  /** §4.3: drop the payload, rebind to the save and keep only the commands newer than its copy. `info` replaces
   *  plain metadata (a provider is read at write time anyway). */
  onSaved(savedAt: number, cmd: number, info?: RecoveryInfo): void {
    if (this.disposed || !Number.isFinite(savedAt) || !Number.isSafeInteger(cmd) || savedAt < this.savedAt || cmd < this.savedCmd) return;
    this.savedAt = savedAt;
    this.savedCmd = cmd;
    this.saves.shift();
    this.snapshot = null;
    if (info && typeof this.info !== 'function') this.info = structuredClone(info);
    this.trim(cmd);
    clearRecoveryAfterSave(this.city.regionId, this.city.tileKey, savedAt);
    this.dirty = true;
    this.checkReserve();
  }

  /** Accepted only as a newer delta of the current save, from the same city, at or after the current watermark. */
  onSnapped(marker: RecoveryMarker, payload: Uint8Array, cmd: number): boolean {
    if (this.disposed || marker.regionId !== this.city.regionId || marker.tileKey !== this.city.tileKey
      || marker.baseSavedAt !== this.savedAt || marker.at <= this.savedAt || cmd < this.fromCmd
      || !Number.isFinite(marker.at) || !Number.isSafeInteger(cmd)
      || marker.at <= (this.snapshot?.marker.at ?? -Infinity) || marker.bytes !== payload.byteLength) return false;
    this.snapshot = { marker: structuredClone(marker), payload: payload.slice() };
    this.trim(cmd);
    this.dirty = true;
    return true;
  }

  /** Synchronous: localStorage (marker, the payload when the base is a snapshot, the journal) plus a small IndexedDB
   *  journal record with commit(). No serialization, async open or worker round trip. Returns whether the payload
   *  went into localStorage. The app owns the pagehide / beforeunload / hidden listeners. */
  writeNow(why: SnapshotWhy | 'crash'): boolean {
    if (this.disposed || (!this.snapshot && !this.ops.length) || (why === 'periodic' && !this.dirty)) return false;
    const journal = this.journal;
    const marker: RecoveryMarker = this.snapshot ? { ...this.snapshot.marker, why } : {
      ...this.describe(), ...this.city, v: DELTA_VERSION, at: journal.at, baseSavedAt: this.savedAt,
      bytes: 0, ls: false, dropped: [], why,
    };
    const ls = storeRecoveryLs(marker, this.snapshot?.payload ?? null, journal);
    if (this.kv?.persistent) {
      try { void storeJournalIdb(this.kv, journal).catch(() => undefined); }
      catch { /* the synchronous localStorage copy remains available */ }
    }
    this.dirty = false;
    return ls;
  }

  private describe(): RecoveryInfo {
    try { return typeof this.info === 'function' ? this.info() : this.info; }
    catch { return { cityName: '', day: 0, population: 0, funds: 0 }; }
  }

  private trim(cmd: number): void {
    this.fromCmd = cmd;
    this.prune();
    this.requested = false;
  }

  private prune(): void {
    // A save's copy can predate a snapshot delivered while its put was pending.
    const keepAfter = Math.max(this.savedCmd, Math.min(this.fromCmd, ...this.saves));
    const before = this.ops.length;
    this.ops = this.ops.filter((entry) => entry.seq > keepAfter);
    if (this.ops.length !== before) this.measure();
  }

  private measure(): void { this.opBytes = this.ops.reduce((n, entry) => n + bytesOf(entry), 0); }

  /** §4.3: main asks for a snapshot when the journal passes half its reserve. */
  private checkReserve(): void {
    if (this.requested || !this.requestSnapshot || this.opBytes <= JOURNAL_RESERVE_BYTES / 2) return;
    this.requested = true;
    try { void Promise.resolve(this.requestSnapshot()).catch(() => { this.requested = false; }); }
    catch { this.requested = false; }
  }

  dispose = (): void => {
    this.disposed = true;
    this.signal.removeEventListener('abort', this.dispose);
    this.snapshot = null;
    this.ops = [];
    this.opBytes = 0;
    this.saves = [];
    this.kv = null;
    this.now = Date.now;
    this.requestSnapshot = null;
    this.info = { cityName: '', day: 0, population: 0, funds: 0 };
  };
}

/** UTF-16 bytes of one entry plus its separator, as JSON.stringify(journal) would hold it */
function bytesOf(entry: Entry): number { return (JSON.stringify(entry).length + 1) * 2; }
