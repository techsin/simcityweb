/** W1.2: what protocol.ts's M2W / W2M lack for a real worker. Commands, reads, packets and replies stay there. */
import type { CityRecord } from '../save/cities';
import type { CitySource, M2W, W2M } from './protocol';

export type SerializedSource = Extract<CitySource, { kind: 'serialized' }>;
export type IdbSource = Extract<CitySource, { kind: 'idb' }>;
/** W1.3 (§4.1 step 2): the worker reads the city from its own IndexedDB and writes its saves and snapshots there
 *  (`'worker-idb'`). R14's W1.2 mode stays for non-persistent stores and the boot fallback: main reads the record
 *  without deserializing it, and stores what the worker saves (`'main'`). */
export type WorkerInit = Extract<M2W, { t: 'init' }> & ({ city: IdbSource; persistence: 'worker-idb' } | { city: SerializedSource; persistence: 'main' }) & {
  /** recovery markers name the region (CityPersistence.regionName) */
  regionName?: string;
  /** deterministic mode (§5.1, hosts.test): the live flag stays off, ticks are ignored, days come from debug.runDays */
  deterministic?: boolean;
  /** W1.3 (§4.4): false boots the save as it is, without the journal bound to it ("Restart from autosave") */
  replay?: boolean;
  /** T083 (NEW-04), 'worker-idb' only: whether this tab holds its region's lock. A worker told false writes nothing to
   *  its IndexedDB; `access` follows each change. Left out, the worker writes (harnesses that build init by hand). */
  writer?: boolean;
};
/** W1.3 (§4.1 step 3): the worker's IndexedDB open fell back to memory while main's store persists; the host restarts
 *  the worker with persistence 'main' rather than let it save into memory */
export const IDB_UNAVAILABLE = 'idb-unavailable';
export type WorkerInput = Exclude<M2W, { t: 'init' }> | WorkerInit
  /** Backpressure (§2.10) without ticks: main acks after a packet with replies and before the worker's window fills,
   *  so a hidden tab's save still replies (T032 minor 8). `epoch` counts the Readys main adopted: ticks posted before a
   *  resync's Ready carry acks of the old packet numbering, so the worker trusts tick acks only once it sees this one. */
  | { t: 'ack'; ack: number; epoch: number }
  /** persistence 'main': main stored a save's record (or failed to), so the worker deltas its snapshots against it */
  | { t: 'stored'; savedAt: number; ok: boolean }
  /** T083 (NEW-04), 'worker-idb': this tab took its region's lock, or lost it to another tab ("Use it here instead").
   *  The worker applies it on arrival, ahead of the FIFO: from a loss on, it writes nothing more to its IndexedDB. */
  | { t: 'access'; writable: boolean };
export type WorkerOutput = W2M;

/** T083 (b): a store refused a write because it is full (QuotaExceededError), or because this tab is not its region's
 *  writer (NEW-04: NotAllowedError). A snapshot refused this way still reaches its caller, as the local host's does. */
export function writeRefused(e: unknown): boolean {
  const name = e !== null && typeof e === 'object' && 'name' in e ? e.name : undefined;
  return name === 'QuotaExceededError' || name === 'NotAllowedError';
}

/** debug.verify's result (§2.2; dev harnesses and tools/qa-worker.mjs): what the worker isolate runs on */
export interface WorkerDebugReport {
  /** exactDigest of the worker's state when the unit ran */
  digest: number;
  day: number;
  /** the isolate's protector probe, sticky since boot (§5.4, risk 7); null without flags.dev or natives syntax */
  protector: boolean | null;
  /** the worker's wasm kernels (WASM_PLAN §7.8): loader state, blur on wasm, memory size and loader grows (never) */
  wasm: { state: string; blur: boolean; capacity: number | null; grows: number | null; error: string | null };
}

/** A single-argument post is deliberate: neither endpoint may transfer ownership. */
export interface WorkerPort {
  postMessage(message: WorkerInput): void;
  listen(receive: (message: WorkerOutput) => void, fail: (error: unknown) => void, signal: AbortSignal): void;
  terminate(): void | Promise<unknown>;
}
export interface SimWorkerScope {
  postMessage(message: WorkerOutput): void;
  listen(receive: (message: WorkerInput) => void, fail: (error: unknown) => void, signal: AbortSignal): void;
}

/** the worker stops flushing past this many packets main has not acked; the recorder keeps merging meanwhile */
export const ACK_WINDOW = 4;
export const HELLO_TIMEOUT_MS = 10000;
export const BOOT_TIMEOUT_MS = 20000;
export const LIVENESS_TIMEOUT_MS = 10000;
/** a gap between two of the page's own polls (every 250 ms) longer than this is a main-thread stall */
export const STALL_MS = 1000;

/** R11: only visible, unfrozen time counts; the page resets the count on its lifecycle events. A main-thread stall (a
 *  long task: a blocking GPU readback, a debugger) holds back the worker's messages too, so the poll that follows one
 *  gives no verdict, and the stall counts as STALL_MS at most: the packets queued behind it are read first, and a
 *  silent worker is caught once the page has seen (nearly) the full timeout of on-time silence. */
export class WorkerLiveness {
  private at: number;
  private elapsed = 0;
  private pingAt = 0;
  private visible = true;
  phase: 'loading' | 'hello' | 'boot' | 'ready' = 'loading';
  constructor(private now: () => number) { this.at = now(); }
  reset(visible = this.visible): void { this.visible = visible; this.at = this.now(); this.elapsed = this.pingAt = 0; }
  scriptLoaded(): void { if (this.phase === 'loading') { this.phase = 'hello'; this.reset(); } }
  received(kind: WorkerOutput['t']): void {
    this.advance();
    if (kind === 'hello' || kind === 'boot') this.phase = 'boot';
    if (kind === 'ready') this.phase = 'ready';
    if (kind !== 'fatal') this.elapsed = 0;
    this.at = this.now();
  }
  poll(): { ping: boolean; timeout: boolean } {
    const stalled = this.advance() > STALL_MS;
    if (!this.visible || this.phase === 'loading') return { ping: false, timeout: false };
    const ping = this.phase === 'ready' && this.pingAt >= 1000;
    if (ping) this.pingAt = 0;
    const limit = this.phase === 'boot' ? BOOT_TIMEOUT_MS : this.phase === 'hello' ? HELLO_TIMEOUT_MS : LIVENESS_TIMEOUT_MS;
    return { ping, timeout: !stalled && this.elapsed >= limit };
  }
  /** the time since the last poll or message; a stall's share of it is capped (it is not evidence against the worker) */
  private advance(): number {
    const now = this.now(), dt = Math.max(0, now - this.at); this.at = now;
    const counted = Math.min(dt, STALL_MS);
    if (this.visible && this.phase !== 'loading') { this.elapsed += counted; this.pingAt += counted; }
    return dt;
  }
}

export function sourceRecord(source: SerializedSource): CityRecord {
  return { key: `${source.regionId}:${source.tileKey}`, regionId: source.regionId, tileKey: source.tileKey,
    savedAt: source.savedAt, city: source.city };
}
