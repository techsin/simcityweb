/** W1.2: what protocol.ts's M2W / W2M lack for a real worker. Commands, reads, packets and replies stay there. */
import type { CityRecord } from '../save/cities';
import type { CitySource, M2W, W2M } from './protocol';

export type SerializedSource = Extract<CitySource, { kind: 'serialized' }>;
/** R14: W1.2 boots a city main read without deserializing it, and main stores what the worker saves. */
export type WorkerInit = Extract<M2W, { t: 'init' }> & {
  city: SerializedSource; persistence: 'main';
  /** recovery markers name the region (CityPersistence.regionName) */
  regionName?: string;
  /** deterministic mode (§5.1, hosts.test): the live flag stays off, ticks are ignored, days come from debug.runDays */
  deterministic?: boolean;
};
export type WorkerInput = Exclude<M2W, { t: 'init' }> | WorkerInit
  /** Backpressure (§2.10) without ticks: main acks after a packet with replies and before the worker's window fills,
   *  so a hidden tab's save still replies (T032 minor 8). `epoch` counts the Readys main adopted: ticks posted before a
   *  resync's Ready carry acks of the old packet numbering, so the worker trusts tick acks only once it sees this one. */
  | { t: 'ack'; ack: number; epoch: number }
  /** persistence 'main': main stored a save's record (or failed to), so the worker deltas its snapshots against it */
  | { t: 'stored'; savedAt: number; ok: boolean };
export type WorkerOutput = W2M;

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

/** R11: only visible, unfrozen time counts; the page resets the count on its lifecycle events. */
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
    this.advance();
    if (!this.visible || this.phase === 'loading') return { ping: false, timeout: false };
    const ping = this.phase === 'ready' && this.pingAt >= 1000;
    if (ping) this.pingAt = 0;
    const limit = this.phase === 'boot' ? BOOT_TIMEOUT_MS : this.phase === 'hello' ? HELLO_TIMEOUT_MS : LIVENESS_TIMEOUT_MS;
    return { ping, timeout: this.elapsed >= limit };
  }
  private advance(): void {
    const now = this.now(), dt = Math.max(0, now - this.at); this.at = now;
    if (this.visible && this.phase !== 'loading') { this.elapsed += dt; this.pingAt += dt; }
  }
}

export function sourceRecord(source: SerializedSource): CityRecord {
  return { key: `${source.regionId}:${source.tileKey}`, regionId: source.regionId, tileKey: source.tileKey,
    savedAt: source.savedAt, city: source.city };
}
