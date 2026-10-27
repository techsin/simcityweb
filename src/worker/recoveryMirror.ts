/** Main's encoded recovery payload and base-bound command journal; never a serialized city or a simulation. */
import { openedKV, type KV } from '../save/db';
import {
  DELTA_VERSION, JOURNAL_RESERVE_BYTES, isJournalOp, journalMatches,
  type RecoveryCity, type RecoveryInfo, type RecoveryJournal, type RecoveryMarker,
} from '../save/recoveryCodec';
import { storeJournalIdb } from '../save/recoveryIdb';
import { clearRecoveryAfterSave, storeRecoveryLs } from '../save/recoveryLs';
import type { SnapshotWhy } from './SimHost';

export interface RecoveryMirrorOptions extends RecoveryCity {
  savedAt: number;
  cmd?: number;
  info: RecoveryInfo;
  signal: AbortSignal;
  kv?: KV;
  now?: () => number;
  requestSnapshot?: () => void | Promise<unknown>;
  /** A failed boot save may carry replayed edits renumbered below the new session's commands. */
  journal?: RecoveryJournal;
}

export class RecoveryMirror {
  private city: RecoveryCity;
  private savedAt: number;
  private savedCmd: number;
  private fromCmd: number;
  private ops: RecoveryJournal['ops'] = [];
  private saves: number[] = [];
  private snapshot: { marker: RecoveryMarker; payload: Uint8Array } | null = null;
  private info: RecoveryInfo;
  private kv: KV | null;
  private now: () => number;
  private requestSnapshot: (() => void | Promise<unknown>) | null;
  private requested = false;
  private disposed = false;
  private signal: AbortSignal;

  constructor(opts: RecoveryMirrorOptions) {
    this.city = { regionId: opts.regionId, tileKey: opts.tileKey };
    this.savedAt = opts.savedAt;
    this.fromCmd = opts.cmd ?? 0;
    this.savedCmd = this.fromCmd;
    this.info = structuredClone(opts.info);
    this.kv = opts.kv ?? openedKV();
    this.now = opts.now ?? Date.now;
    this.requestSnapshot = opts.requestSnapshot ?? null;
    this.signal = opts.signal;
    if (opts.journal && journalMatches(opts.journal, { ...this.city, savedAt: this.savedAt })) {
      this.fromCmd = opts.journal.fromCmd;
      this.savedCmd = this.fromCmd;
      this.ops = structuredClone(opts.journal.ops);
    }
    if (this.signal.aborted) this.dispose();
    else this.signal.addEventListener('abort', this.dispose, { once: true });
  }

  get journal(): RecoveryJournal {
    const m = this.snapshot?.marker;
    return {
      v: 1, ...this.city, at: this.now(),
      base: m ? { kind: 'snapshot', at: m.at, baseSavedAt: this.savedAt } : { kind: 'save', savedAt: this.savedAt },
      fromCmd: this.fromCmd, ops: structuredClone(this.ops.filter((entry) => entry.seq > this.fromCmd)),
    };
  }

  /** Called on posting, before an ack can arrive; predictions never decide what survives recovery. */
  onCommand(seq: number, op: string, args: unknown[]): void {
    if (this.disposed || !isJournalOp(op)) return;
    if (!Number.isSafeInteger(seq) || seq <= this.fromCmd || seq <= (this.ops.at(-1)?.seq ?? -Infinity)) return;
    const copy = structuredClone(args);
    if (op === 'setOrdinance') copy[2] = { confirm: true };
    this.ops.push({ seq, op, args: copy });
    this.checkReserve();
  }

  onAck(seq: number, result: unknown): void {
    if (this.disposed) return;
    const index = this.ops.findIndex((entry) => entry.seq === seq);
    if (index < 0) return;
    const r = result as { ok?: boolean; cost?: number } | null | undefined;
    if (result === false || r?.ok === false) { this.ops.splice(index, 1); return; }
    const entry = this.ops[index];
    if (entry.op === 'bulldoze' && r?.ok === true && Number.isFinite(r.cost)) entry.cost = r.cost;
    this.checkReserve();
  }

  /** Saves are FIFO. Pin the current suffix only while a copy/put may be in flight. */
  onSaving(): void { if (!this.disposed) this.saves.push(this.fromCmd); }

  onSaveFailed(): void {
    if (this.disposed) return;
    this.saves.shift();
    this.prune();
  }

  onSaved(savedAt: number, cmd: number, info?: RecoveryInfo): void {
    if (this.disposed || !Number.isFinite(savedAt) || !Number.isSafeInteger(cmd) || savedAt < this.savedAt || cmd < this.savedCmd) return;
    this.savedAt = savedAt;
    this.savedCmd = cmd;
    this.saves.shift();
    this.snapshot = null;
    if (info) this.info = structuredClone(info);
    this.ops = this.ops.filter((entry) => entry.seq > cmd);
    this.trim(cmd);
    clearRecoveryAfterSave(this.city.regionId, this.city.tileKey, savedAt);
    this.checkReserve();
  }

  onSnapped(marker: RecoveryMarker, payload: Uint8Array, cmd: number): boolean {
    if (this.disposed || marker.regionId !== this.city.regionId || marker.tileKey !== this.city.tileKey
      || marker.baseSavedAt !== this.savedAt || marker.at <= this.savedAt || cmd < this.fromCmd
      || !Number.isFinite(marker.at) || !Number.isSafeInteger(cmd)
      || marker.at <= (this.snapshot?.marker.at ?? -Infinity) || marker.bytes !== payload.byteLength) return false;
    this.snapshot = { marker: structuredClone(marker), payload: payload.slice() };
    this.trim(cmd);
    this.checkReserve();
    return true;
  }

  /** App already owns pagehide/beforeunload/hidden listeners. No serialization, async open, or worker round trip. */
  writeNow(why: SnapshotWhy | 'crash'): void {
    if (this.disposed || (!this.snapshot && !this.ops.length)) return;
    const journal = this.journal;
    const marker: RecoveryMarker = this.snapshot ? { ...this.snapshot.marker, why } : {
      ...this.info, ...this.city, v: DELTA_VERSION, at: journal.at, baseSavedAt: this.savedAt,
      bytes: 0, ls: false, dropped: [], why,
    };
    storeRecoveryLs(marker, this.snapshot?.payload ?? null, journal);
    if (this.kv?.persistent) {
      try { void storeJournalIdb(this.kv, journal).catch(() => undefined); }
      catch { /* the synchronous localStorage copy remains available */ }
    }
  }

  private trim(cmd: number): void {
    this.fromCmd = cmd;
    this.prune();
    this.requested = false;
  }

  private prune(): void {
    // A save's copy can predate a snapshot delivered while its put was pending.
    const keepAfter = Math.max(this.savedCmd, Math.min(this.fromCmd, ...this.saves));
    this.ops = this.ops.filter((entry) => entry.seq > keepAfter);
  }

  private checkReserve(): void {
    if (this.requested || !this.requestSnapshot || JSON.stringify(this.journal).length * 2 <= JOURNAL_RESERVE_BYTES / 2) return;
    this.requested = true;
    try { void Promise.resolve(this.requestSnapshot()).catch(() => { this.requested = false; }); }
    catch { this.requested = false; }
  }

  dispose = (): void => {
    this.disposed = true;
    this.signal.removeEventListener('abort', this.dispose);
    this.snapshot = null;
    this.ops = [];
    this.saves = [];
    this.kv = null;
    this.now = Date.now;
    this.requestSnapshot = null;
  };
}
