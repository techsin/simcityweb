/** W1.2 transport envelope. Command / reply contracts stay with the loopback lane. */
import type { RegionContext } from '../region/regionEffects';
import type { CityRecord } from '../save/cities';
import type { RecoverySnapshot } from '../save/recoveryCodec';
import type { CitySaveCopy } from './SimCore';
import type { Command, SnapshotWhy } from './SimHost';
import type { QueryName, QueryArgs, WatchPolicy } from './queries';
import type { CitySource, M2W, Packet, Ready, Reply, SimSettings } from './protocol';

export type SerializedSource = Extract<CitySource, { kind: 'serialized' }>;
export interface WorkerInit {
  t: 'init'; v: number; city: SerializedSource; persistence: 'main';
  rctx: RegionContext | null; initialSpeed: number; settings: SimSettings;
  flags: { simwasm: string | null; dev: boolean };
  deterministic?: boolean;
  regionName?: string;
}
export type WorkerInput = WorkerInit
  | (Command & { t: 'cmd'; seq: number })
  | { t: 'query'; id: number; name: QueryName; args: QueryArgs<QueryName> }
  | { t: 'watch'; id: number; name: QueryName; args: QueryArgs<QueryName>; when: WatchPolicy }
  | Extract<M2W, { t: 'unwatch' | 'view' | 'save' | 'resync' | 'dispose' }>
  | { t: 'snapshot'; id: number; why: SnapshotWhy }
  | { t: 'tick'; seq: number; dt: number; ack: number; epoch: number }
  | { t: 'ack'; ack: number; epoch: number }
  | { t: 'ping'; n: number; ack: number; epoch: number }
  | { t: 'stored'; id: number; ok: boolean }
  | { t: 'run'; id: number; days: number };

export type WorkerReply = Exclude<Reply, { t: 'saved' | 'snapped' }>
  | ({ t: 'saved'; id: number; ok: true; cmd: number; changes: number } & CitySaveCopy)
  | { t: 'saved'; id: number; ok: false; error: string }
  | ({ t: 'snapped'; id: number; cmd: number; fp: string; changes: number } & RecoverySnapshot)
  | { t: 'snapshotFailed'; id: number; error: string }
  | { t: 'ran'; id: number; day: number }
  | { t: 'watchError'; id: number; key: string; error: string };
export type WorkerPacket = Omit<Packet, 'replies'> & { replies?: WorkerReply[]; changes: number };
export type BootPhase = 'deserialize' | 'wasm' | 'systems' | 'snapshot';
export type WorkerOutput =
  | { t: 'hello'; v: number }
  | { t: 'boot'; phase: BootPhase; pct: number }
  | (Ready & { epoch: number; settled: { seq: number; result: unknown }[]; changes: number })
  | { t: 'pkt'; epoch: number; p: WorkerPacket }
  | { t: 'fatal'; message: string; stack?: string };

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

export const HELLO_TIMEOUT_MS = 10000;
export const BOOT_TIMEOUT_MS = 20000;
export const LIVENESS_TIMEOUT_MS = 10000;

/** A wall-clock jump is not a frozen interval when the page supplies lifecycle resets (R11). */
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
