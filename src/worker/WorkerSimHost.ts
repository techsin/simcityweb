/**
 * W1.2's main side: T032's PacketSimHost over a real Worker. The packet plumbing (R1 optimism and rebasing, tickets and
 * tags, keyed watches, views, the clock, replies and resyncs) is PacketSimHost's; this file adds the transport: boot
 * with its progress and timeouts, versioning, liveness on visible time (R11), failing fast, explicit acks, and
 * persistence 'main' (R14). The application still selects LocalSimHost.
 */
import { openKV, type KV } from '../save/db';
import { getCityRecord, type CityRecord } from '../save/cities';
import type { RecoveryMarker } from '../save/recoveryCodec';
import { clearRecoveryAfterSave as clearRecoveryIdb, storeRecoveryIdb } from '../save/recoveryIdb';
import { storeRecoveryLs } from '../save/recoveryLs';
import { PacketSimHost, hostActions, type PacketHostOptions, type Settle } from './LoopbackSimHost';
import type { RecoveryMirror, SnapshotAck, SnapshotWhy } from './SimHost';
import { PROTOCOL_VERSION, assertOwnedBuffers, errorText, type Ready, type Reply, type SimSettings, type W2M } from './protocol';
import { ACK_WINDOW, WorkerLiveness, type SerializedSource, type WorkerInput, type WorkerOutput, type WorkerPort } from './workerProtocol';

/** The worker failed: a fatal message, onerror / messageerror, a boot timeout, or 10 visible seconds without a packet. */
export class HostCrashed extends Error { override name = 'HostCrashed'; }

export interface WorkerSimHostOptions extends Omit<PacketHostOptions, 'persistence'> {
  /** the region screen's pre-spawned browserSimWorker() (§4.1); a fresh one by default; a node port in tests */
  port?: WorkerPort;
  kv?: KV;
  settings?: SimSettings;
  regionName?: string;
  /** deterministic mode (§5.1): the worker's live flag stays off and days come from runDays */
  deterministic?: boolean;
  dev?: boolean;
  /** the region screen's prefetch: no hello deadline runs while the script may still be downloading (§4.1) */
  scriptLoaded?: Promise<void>;
  onBoot?: (phase: Extract<W2M, { t: 'boot' }>['phase'], pct: number) => void;
  /** App integration: a boot failure falls back to LocalSimHost; a later crash takes the crash path (§4.4) */
  onCrash?: (error: HostCrashed, duringBoot: boolean) => void;
}
/** LivePolicy's own defaults, as LocalSimHost and the loopback start */
const DEFAULT_SETTINGS: SimSettings = { emergencyUncovered: 'live', emergencyLiveSlowmo: 3, emergencyAlerts: 'major' };

/** The real worker, created as the LOD worker is. Spawn it early (the region screen): its messages and errors wait for
 *  the host that boots on it. */
export function browserSimWorker(): WorkerPort {
  const worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module', name: 'sim' });
  const lifetime = new AbortController(), queued: ({ message: WorkerOutput } | { error: unknown })[] = [];
  let target: { receive(m: WorkerOutput): void; fail(e: unknown): void } | null = null;
  const deliver = (item: typeof queued[number]) => {
    if (!target) { queued.push(item); return; }
    if ('message' in item) target.receive(item.message); else target.fail(item.error);
  };
  worker.addEventListener('message', (e) => deliver({ message: e.data }), { signal: lifetime.signal });
  // a script that fails to load fires a bare ErrorEvent: fail fast (R11) rather than wait for a hello
  worker.addEventListener('error', (e) => { e.preventDefault(); deliver({ error: e.error ?? new Error(e.message || 'The simulation worker failed to load') }); }, { signal: lifetime.signal });
  worker.addEventListener('messageerror', () => deliver({ error: new Error('Worker messageerror') }), { signal: lifetime.signal });
  return {
    postMessage: (m) => worker.postMessage(m),
    listen(receive, fail, signal) {
      if (signal.aborted) return;
      target = { receive, fail };
      signal.addEventListener('abort', () => { target = null; queued.length = 0; }, { once: true });
      for (const item of queued.splice(0)) { if (signal.aborted) break; deliver(item); }
    },
    terminate: () => { lifetime.abort('dispose'); target = null; queued.length = 0; worker.terminate(); },
  };
}

interface LinkTarget { receive(m: WorkerOutput): void; fail(e: unknown): void; ping?(): void }
/** The page's end of one worker, from init to dispose: its port, the watchdog on visible time and the page lifecycle
 *  resets (R11). It boots the worker, then hands the worker's messages to the host. */
class WorkerLink {
  readonly life: WorkerLiveness;
  private lifetime = new AbortController();
  private timer: ReturnType<typeof setInterval>;
  private closing: Promise<void> | null = null;
  constructor(private port: WorkerPort, now: () => number, scriptLoaded: Promise<void> | undefined, private target: LinkTarget) {
    this.life = new WorkerLiveness(now);
    const signal = this.lifetime.signal;
    port.listen((m) => { this.life.received(m.t); this.target.receive(m); }, (e) => this.target.fail(e), signal);
    void scriptLoaded?.then(() => this.life.scriptLoaded(), (e) => this.target.fail(e));
    if (typeof document !== 'undefined') {
      // a frozen page freezes its worker too: hidden or frozen time never counts
      const reset = () => this.life.reset(document.visibilityState === 'visible');
      document.addEventListener('visibilitychange', reset, { signal });
      document.addEventListener('freeze', () => this.life.reset(false), { signal });
      document.addEventListener('resume', reset, { signal });
      window.addEventListener('pageshow', reset, { signal });
      window.addEventListener('pagehide', () => this.life.reset(false), { signal });
      reset();
    }
    this.timer = setInterval(() => this.poll(), 250);
  }
  retarget(target: LinkTarget): void { this.target = target; }
  post(m: WorkerInput): void {
    if (this.closing) return;
    assertOwnedBuffers(m); // §1.4; never a transfer list
    this.port.postMessage(m);
  }
  private poll(): void {
    const { ping, timeout } = this.life.poll();
    if (timeout) this.target.fail(new Error(this.life.phase === 'ready' ? 'The simulation worker stopped responding' : 'The simulation worker did not boot in time'));
    else if (ping) this.target.ping?.();
  }
  close(): Promise<void> {
    return this.closing ??= (() => {
      clearInterval(this.timer); this.lifetime.abort('dispose');
      return Promise.resolve().then(() => this.port.terminate()).then(() => undefined, () => undefined);
    })();
  }
}

/** R14: read the stored record without deserializing it on main, then boot the worker on it. */
export async function loadWorkerSimHost(regionId: string, tileKey: string, opts: WorkerSimHostOptions = {}): Promise<WorkerSimHost> {
  const kv = opts.kv ?? await openKV(), record = await getCityRecord(kv, regionId, tileKey);
  if (!record) { void opts.port?.terminate(); throw new Error('City record not found'); }
  return bootWorkerSimHost({ kind: 'serialized', regionId, tileKey, savedAt: record.savedAt, city: record.city }, { ...opts, kv });
}

/** Post init, follow hello and the boot phases (20 s of visible time at most between them), and build the host from the
 *  worker's Ready. Rejects with HostCrashed on a version mismatch, a fatal message, an error or a timeout. */
export function bootWorkerSimHost(source: SerializedSource, opts: WorkerSimHostOptions = {}): Promise<WorkerSimHost> {
  // the optimistic writes run CityActions on the replica; it loads lazily (FH-07a: the city screen's graph has none)
  const actions = opts.optimistic ? Promise.resolve(opts.optimistic) : import('../sim/actions').then((m) => m.CityActions, () => undefined);
  const booted = new Promise<WorkerSimHost>((resolve, reject) => {
    let done = false;
    const finish = (error: unknown, crashed: boolean) => {
      if (done) return;
      done = true;
      opts.signal?.removeEventListener('abort', cancel);
      void link.close();
      const e = crashed && !(error instanceof HostCrashed) ? Object.assign(new HostCrashed(errorText(error)), { cause: error }) : error;
      if (crashed) { try { opts.onCrash?.(e as HostCrashed, true); } catch { /* the rejection still reaches the caller */ } }
      reject(e);
    };
    const cancel = () => finish(new Error('Simulation host is disposed'), false);
    const link = new WorkerLink(opts.port ?? browserSimWorker(), opts.now ?? (() => performance.now()), opts.scriptLoaded, {
      receive: (m) => {
        if (done) return;
        if (m.t === 'hello') { if (m.v !== PROTOCOL_VERSION) finish(new Error(`Worker protocol version ${m.v}; the page speaks ${PROTOCOL_VERSION}`), true); }
        else if (m.t === 'boot') { try { opts.onBoot?.(m.phase, m.pct); } catch (e) { opts.errors?.report('Boot progress', e); } }
        else if (m.t === 'fatal') finish(Object.assign(new Error(m.message), m.stack ? { stack: m.stack } : {}), true);
        else if (m.t === 'ready') {
          done = true;
          opts.signal?.removeEventListener('abort', cancel);
          // synchronously: the worker's first packets follow its Ready at once
          try { resolve(new WorkerSimHost(m, link, source, opts)); } catch (e) { void link.close(); reject(e); }
        }
      },
      fail: (e) => finish(e, true),
    });
    if (opts.signal?.aborted) { cancel(); return; }
    opts.signal?.addEventListener('abort', cancel, { once: true });
    link.post({ t: 'init', v: PROTOCOL_VERSION, city: source, persistence: 'main', rctx: opts.rctx ?? null,
      initialSpeed: opts.initialSpeed ?? 1, settings: opts.settings ?? DEFAULT_SETTINGS,
      flags: { simwasm: opts.flags?.simwasm ?? null, dev: opts.dev ?? !!import.meta.env?.DEV },
      regionName: opts.regionName, deterministic: opts.deterministic });
  });
  return Promise.all([booted, actions]).then(([host, Actions]) => {
    if (Actions) host.useOptimisticActions(Actions);
    return host;
  });
}

export class WorkerSimHost extends PacketSimHost {
  private link: WorkerLink;
  private kv: KV | null;
  private snapshots: SnapshotMirror;
  /** the worker's saves and snapshots, stored here in reply order (R14) */
  private storage: Promise<void> = Promise.resolve();
  private storing = new Set<Settle>();
  private onCrashed: WorkerSimHostOptions['onCrash'];
  /** Readys adopted, and the last packet acked to the worker by a tick or an explicit ack (§2.10) */
  private epoch = 1;
  private acked = 0;
  private pings = 0;

  /** Built by bootWorkerSimHost from the worker's real Ready. */
  constructor(ready: Ready, link: WorkerLink, source: SerializedSource, opts: WorkerSimHostOptions = {}) {
    const snapshots = new SnapshotMirror(source.savedAt);
    super('worker', ready, { ...opts, actions: opts.actions ?? hostActions, recovery: opts.recovery ?? snapshots,
      persistence: { regionId: source.regionId, tileKey: source.tileKey, regionName: opts.regionName } }, true);
    this.link = link; this.kv = opts.kv ?? null; this.snapshots = snapshots; this.onCrashed = opts.onCrash;
    if (this.closed) { void link.close(); return; }
    link.retarget({ receive: (m) => this.receive(m), fail: (e) => this.crash(e), ping: () => this.ping() });
    this.connect((m) => link.post(m as WorkerInput)); // the host never posts init
  }

  /** Deterministic mode (§2.9; hosts.test, the protector): whole headless days as separate worker units, live flag off.
   *  Resolves to the day reached, once the replica has applied them. */
  runDays(days: number): Promise<number> {
    if (!Number.isInteger(days) || days < 0) return Promise.reject(new Error('Invalid day count'));
    // a wire-only op of protocol.ts: SimHost's command table has no debug entries
    return this.post('debug.runDays' as never, [days] as never).done;
  }

  override receive(message: WorkerOutput): void {
    if (this.closed) return;
    if (message.t === 'fatal') { this.crash(Object.assign(new Error(message.message), message.stack ? { stack: message.stack } : {})); return; }
    if (message.t === 'ready') {
      // a resync: the worker numbers packets afresh, and trusts tick acks again once this epoch is acked
      this.epoch++; this.acked = 0;
      super.receive(message);
      if (!this.closed) this.link.post({ t: 'ack', ack: 0, epoch: this.epoch });
      return;
    }
    super.receive(message);
    if (message.t !== 'pkt' || this.closed || this.replica.diverged) return;
    // acks ride on ticks, which stop with the tab hidden (T032 minor 8): ack a packet with replies at once, and ack
    // before the worker's window fills, so the hidden path's save reply never waits for the tab to come back
    if (message.p.replies?.length || this.replica.seq - this.acked >= ACK_WINDOW - 1) this.postAck();
  }
  override frame(dt: number): void {
    super.frame(dt);
    if (!this.closed) this.acked = this.replica.seq; // the tick carried it
  }
  private postAck(): void {
    this.acked = this.replica.seq;
    this.link.post({ t: 'ack', ack: this.acked, epoch: this.epoch });
  }
  /** once per visible second (R11); the worker answers with a pong in its next packet */
  private ping(): void {
    if (this.closed) return;
    if (this.replica.seq > this.acked) this.postAck();
    this.send({ t: 'ping', n: ++this.pings });
  }

  /** R14: the worker's save record and its snapshots are stored here, in reply order, before their replies settle. */
  protected override settle(reply: Extract<Reply, { t: 'saved' | 'snapped' }>, wait: Settle): void {
    if (reply.t === 'saved' && reply.ok && reply.record) this.storeSave(reply, reply.record, wait);
    else if (reply.t === 'snapped' && reply.ok !== false) this.storeSnapshot(reply, wait);
    else super.settle(reply, wait);
  }
  private storeSave(reply: Extract<Reply, { t: 'saved' }>, record: CityRecord, wait: Settle): void {
    const { record: _record, ...ack } = reply;
    this.write(wait, async () => {
      const kv = this.kv ?? await openKV();
      // not putCityRecord: main keeps no recovery base (§4.1); the worker's is what main confirms here
      try { await kv.put('cities', record, record.key); }
      catch (e) { this.stored(record.savedAt, false); throw e; }
      this.stored(record.savedAt, true);
      // the put is the commit: a failed cleanup must not make the worker keep an obsolete base
      const dropped = await clearRecoveryIdb(kv, record.regionId, record.tileKey, record.savedAt).catch((e) => { this.report('recovery', e); return false; });
      this.snapshots.saved(record.savedAt);
      super.settle({ ...ack, recoveryDropped: dropped || !!ack.recoveryDropped }, wait); // localStorage's part, the ack
    });
  }
  private storeSnapshot(reply: Extract<Reply, { t: 'snapped'; ok?: true }>, wait: Settle): void {
    this.write(wait, async () => {
      // a delta of a save main did not store (its put failed, or a resync lost it) restores nothing: not an error
      if (reply.marker.baseSavedAt !== this.snapshots.savedAt) { wait.resolve(null); return; }
      const kv = this.kv ?? await openKV(), start = this.now();
      await storeRecoveryIdb(kv, reply.marker, reply.payload);
      this.snapshots.snapped(reply.marker, reply.payload);
      wait.resolve({ ...reply.result, marker: reply.marker, payload: reply.payload, dropped: reply.marker.dropped,
        ok: true, bytes: reply.payload.length, ms: (reply.result?.ms ?? 0) + this.now() - start, idb: kv.persistent, ls: false,
        cmd: reply.cmd, fp: reply.fp!, changes: reply.changes ?? this.changes } satisfies SnapshotAck);
    });
  }
  private write(wait: Settle, run: () => Promise<void>): void {
    this.storing.add(wait);
    this.storage = this.storage.then(run).catch((e) => wait.reject(e)).finally(() => { this.storing.delete(wait); });
  }
  private stored(savedAt: number, ok: boolean): void {
    if (!this.closed) this.link.post({ t: 'stored', savedAt, ok });
  }

  /** fatal, onerror / messageerror, or 10 visible seconds without a packet (§4.4) */
  private crash(error: unknown): void {
    if (this.closed) return;
    const crashed = error instanceof HostCrashed ? error : Object.assign(new HostCrashed(errorText(error)), { cause: error });
    // the snapshot first, while the host is open (SnapshotWhy has no 'crash'; T033's mirror takes one)
    try { this.recovery?.writeNow('exit'); } catch (e) { this.report('recovery', e); }
    const onCrashed = this.onCrashed;
    this.fail(crashed);
    void this.dispose();
    try { onCrashed?.(crashed, false); } catch { /* the host is closed */ }
  }
  protected override fail(error: unknown, report = true): void {
    super.fail(error, report);
    // already handed to the store; neither exists yet if the city's signal aborted during the base constructor
    for (const wait of this.storing ?? []) wait.reject(error);
    this.storing?.clear();
  }
  override dispose(): Promise<void> {
    const done = super.dispose(); // posts dispose, rejects outstanding work
    return Promise.all([done, this.link?.close()]).then(() => undefined);
  }
}

/** W1.2's recovery (R14, no journal yet): the last worker snapshot while it is newer than the last save, written to
 *  localStorage only at unload. Edits since that snapshot can be lost (≤ 30 s). T033's RecoveryMirror replaces it. */
class SnapshotMirror implements RecoveryMirror {
  private last: { marker: RecoveryMarker; payload: Uint8Array } | null = null;
  constructor(public savedAt: number) {}
  saved(savedAt: number): void { this.savedAt = savedAt; this.last = null; }
  snapped(marker: RecoveryMarker, payload: Uint8Array): void {
    if (marker.baseSavedAt === this.savedAt && marker.at > (this.last?.marker.at ?? -Infinity)) this.last = { marker, payload };
  }
  writeNow(why: SnapshotWhy): void {
    if (this.last) storeRecoveryLs({ ...this.last.marker, why }, this.last.payload);
  }
}
