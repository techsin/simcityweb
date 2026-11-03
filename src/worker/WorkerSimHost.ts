/**
 * W1.2's main side: T032's PacketSimHost over a real Worker. The packet plumbing (R1 optimism and rebasing, tickets and
 * tags, keyed watches, views, the clock, replies and resyncs) is PacketSimHost's; this file adds the transport: boot
 * with its progress and timeouts, versioning, liveness on visible time (R11), failing fast, explicit acks, and
 * persistence. The App boots it behind `?simworker=1` (src/main.ts) and builds the CityScene from it.
 * W1.3 (§4): with a persistent store the worker reads and writes its own IndexedDB (`'worker-idb'`), and the page keeps
 * T033's journal mirror; with a store that does not persist, or when the worker's IndexedDB falls back to memory, R14's
 * persistence 'main' stays: main reads the record, stores the worker's saves and snapshots, and passes the journal.
 */
import { openKV, type KV } from '../save/db';
import { cityKey, type CityRecord } from '../save/cities';
import { clearRecoveryAfterSave as clearRecoveryIdb, storeRecoveryIdb } from '../save/recoveryIdb';
import { PacketSimHost, type PacketHostOptions, type Settle } from './LoopbackSimHost';
import { exactDigest } from './queries';
import { readBootJournal } from './journal';
import { PROTOCOL_VERSION, assertOwnedBuffers, errorText, type CitySource, type Journal, type Ready, type Reply, type SimSettings, type W2M } from './protocol';
import { ACK_WINDOW, IDB_UNAVAILABLE, WorkerLiveness, type WorkerDebugReport, type WorkerInit, type WorkerInput, type WorkerOutput, type WorkerPort } from './workerProtocol';

/** A save or snapshot reply no caller waits for any more */
const NO_WAIT: Settle = { resolve: () => {}, reject: () => {} };

/** The worker failed: a fatal message, onerror / messageerror, a boot timeout, or 10 visible seconds without a packet.
 *  `code` is the worker's own (W1.3: IDB_UNAVAILABLE). */
export class HostCrashed extends Error { override name = 'HostCrashed'; code?: string; }

/** `journal` (T033's page mirror, W1.3 in the worker) is on by default when the page's store persists. */
export interface WorkerSimHostOptions extends Omit<PacketHostOptions, 'persistence'> {
  /** the worker: the region screen's pre-spawned browserSimWorker(SIM_WORKER_URL) or a fresh one (§4.1); a node port in tests */
  port: WorkerPort;
  /** W1.3 (§4.1 step 3): a fresh worker, for the restart with persistence 'main' when the first one's IndexedDB fell
   *  back to memory; without it that boot fails, and the App falls back to the main thread */
  respawn?: () => WorkerPort;
  /** W1.3 (§4.4): false boots the save without the journal bound to it ("Restart from autosave") */
  replayJournal?: boolean;
  kv?: KV;
  settings?: SimSettings;
  regionName?: string;
  /** deterministic mode (§5.1): the worker's live flag stays off and days come from runDays */
  deterministic?: boolean;
  dev?: boolean;
  /** the worker script's prefetch, settled no earlier than city entry: the hello deadline runs from then (§4.1); without
   *  it, none runs (a script that fails to load still fails fast) */
  scriptLoaded?: Promise<void>;
  onBoot?: (phase: Extract<W2M, { t: 'boot' }>['phase'], pct: number) => void;
  /** App integration: a boot failure falls back to LocalSimHost; a later crash takes the crash path (§4.4) */
  onCrash?: (error: HostCrashed, duringBoot: boolean) => void;
}
/** LivePolicy's own defaults, as LocalSimHost and the loopback start */
const DEFAULT_SETTINGS: SimSettings = { emergencyUncovered: 'live', emergencyLiveSlowmo: 3, emergencyAlerts: 'major' };

/** The real worker, from the bundled script's URL (simWorkerUrl.ts: Vite's IIFE worker chunk runs as a module worker,
 *  and in dev the module itself). Spawn it early (the region screen): its messages and errors wait for the host that
 *  boots on it. */
export function browserSimWorker(url: string | URL): WorkerPort {
  const worker = new Worker(url, { type: 'module', name: 'sim' });
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
  private timer: ReturnType<typeof setInterval> | undefined;
  private closing: Promise<void> | null = null;
  constructor(private port: WorkerPort, now: () => number, private scriptLoaded: Promise<void> | undefined, private target: LinkTarget) {
    this.life = new WorkerLiveness(now);
  }
  /** Listen, then start the watchdog. Separate from the constructor: a pre-spawned port delivers what it queued (a load
   *  error, a wrong-version hello, a fatal) synchronously inside listen(), and the boot's handlers close this link. */
  start(): void {
    if (this.closing) return;
    const signal = this.lifetime.signal;
    this.port.listen((m) => { this.life.received(m.t); this.target.receive(m); }, (e) => this.target.fail(e), signal);
    if (this.closing) return;
    void this.scriptLoaded?.then(() => this.life.scriptLoaded(), (e) => this.target.fail(e));
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

/**
 * W1.3 (§4.1): with a persistent store the worker loads the city from its own IndexedDB and main sends no city. With a
 * store that does not persist (MemoryKV: main's and the worker's are separate), or after the worker's IndexedDB fell
 * back to memory (IDB_UNAVAILABLE, then a fresh worker from `respawn`), R14's path: main reads the record without
 * deserializing it, and passes the journal bound to it.
 */
export async function loadWorkerSimHost(regionId: string, tileKey: string, opts: WorkerSimHostOptions): Promise<WorkerSimHost> {
  const kv = opts.kv ?? await openKV(), key = cityKey(regionId, tileKey);
  // the key only: main does not read the record in 'worker-idb' mode (O6)
  if (!(await kv.keys('cities', key, key)).length) { void opts.port.terminate(); throw new Error('City record not found'); }
  let port = opts.port;
  if (kv.persistent) {
    try { return await bootWorkerSimHost({ kind: 'idb', regionId, tileKey }, { ...opts, kv }); }
    catch (e) {
      if ((e as HostCrashed)?.code !== IDB_UNAVAILABLE || !opts.respawn || opts.signal?.aborted) throw e;
      opts.errors?.report('The simulation worker could not open IndexedDB: its saves go through the page', e, { key: 'worker-idb' });
      port = opts.respawn();
    }
  }
  const record = await kv.get<CityRecord>('cities', key);
  if (!record) { void port.terminate(); throw new Error('City record not found'); }
  const journal = opts.replayJournal === false ? undefined : (await readBootJournal(kv, record).catch(() => undefined))?.journal;
  return bootWorkerSimHost({ kind: 'serialized', regionId, tileKey, savedAt: record.savedAt, city: record.city }, { ...opts, kv, port }, journal);
}

/** Post init, follow hello and the boot phases (20 s of visible time at most between them), and build the host from the
 *  worker's Ready. Rejects with HostCrashed on a version mismatch, a fatal message, an error or a timeout. `journal`:
 *  persistence 'main' only, the journal main read for the save it sends (§4.3). */
export function bootWorkerSimHost(source: CitySource, opts: WorkerSimHostOptions, journal?: Journal): Promise<WorkerSimHost> {
  // T031's HostActions and the optimistic writes run CityActions on the replica: both load lazily while the worker boots,
  // as the loopback loads them in start() (FH-07a: the city screen's static graph has no actions.ts)
  const modules = Promise.all([
    opts.optimistic ?? import('../sim/actions').then((m) => m.CityActions, () => undefined),
    opts.actions ? undefined : import('./HostActions').then((m) => m.HostActions),
  ]);
  void modules.catch(() => {}); // a boot that fails first reports its own error
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
    const link = new WorkerLink(opts.port, opts.now ?? (() => performance.now()), opts.scriptLoaded, {
      receive: (m) => {
        if (done) return;
        if (m.t === 'hello') { if (m.v !== PROTOCOL_VERSION) finish(new Error(`Worker protocol version ${m.v}; the page speaks ${PROTOCOL_VERSION}`), true); }
        else if (m.t === 'boot') { try { opts.onBoot?.(m.phase, m.pct); } catch (e) { opts.errors?.report('Boot progress', e); } }
        else if (m.t === 'fatal') {
          const crashed = Object.assign(new HostCrashed(m.message), m.stack ? { stack: m.stack } : {}, m.code ? { code: m.code } : {});
          finish(crashed, true);
        }
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
    // after `link` is assigned: what a pre-spawned port queued is delivered inside start()
    link.start();
    if (done) return;
    const persistence = (source.kind === 'idb' ? { city: source, persistence: 'worker-idb' } : { city: source, persistence: 'main', ...(journal ? { journal } : {}) }) as Pick<WorkerInit, 'city' | 'persistence' | 'journal'>;
    link.post({ t: 'init', v: PROTOCOL_VERSION, ...persistence, rctx: opts.rctx ?? null,
      initialSpeed: opts.initialSpeed ?? 1, settings: opts.settings ?? DEFAULT_SETTINGS,
      flags: { simwasm: opts.flags?.simwasm ?? null, dev: opts.dev ?? !!import.meta.env?.DEV },
      regionName: opts.regionName, deterministic: opts.deterministic, ...(opts.replayJournal === false ? { replay: false } : {}) } as WorkerInit);
  });
  return booted.then(async (host) => {
    try {
      const [Actions, Controller] = await modules;
      // the city's signal, or a crash, closed it while the modules loaded
      if (host.isDisposed) throw new Error('Simulation host is disposed');
      if (Actions) host.useOptimisticActions(Actions);
      // nothing is posted before the caller has the host, so no reservation predates the controller
      if (Controller) host.installActions((h) => new Controller(h));
      return host;
    } catch (e) { await host.dispose(); throw e; }
  });
}

export class WorkerSimHost extends PacketSimHost {
  /** W1.3: who writes the city's saves and snapshots: the worker's own IndexedDB, or main (R14) */
  readonly persistence: 'worker-idb' | 'main';
  private link: WorkerLink;
  private kv: KV | null;
  /** persistence 'main': the last save main stored, the base the worker's snapshots must be deltas of */
  private storedAt: number;
  /** the worker's saves and snapshots, stored here in reply order (R14) */
  private storage: Promise<void> = Promise.resolve();
  private storing = new Set<Settle>();
  private onCrashed: WorkerSimHostOptions['onCrash'];
  /** Readys adopted, and the last packet acked to the worker by a tick or an explicit ack (§2.10) */
  private epoch = 1;
  private acked = 0;
  private pings = 0;

  /** Built by bootWorkerSimHost from the worker's real Ready. */
  constructor(ready: Ready, link: WorkerLink, source: CitySource, opts: WorkerSimHostOptions) {
    // W1.3: T033's journal mirror binds to the Ready's save (and any replayed edits it carries) whenever the page's
    // store persists; it writes localStorage and a small IndexedDB record at unload (§4.3)
    super('worker', ready, { ...opts, journal: opts.journal ?? (opts.kv?.persistent ?? false),
      persistence: { regionId: source.regionId, tileKey: source.tileKey, regionName: opts.regionName } }, true);
    this.persistence = source.kind === 'idb' ? 'worker-idb' : 'main';
    this.storedAt = ready.savedAt;
    // the worker's count from its first Ready too: replayed edits that no save holds yet read as unsaved (§4.3)
    if (ready.changes !== undefined) this.changes = ready.changes;
    this.link = link; this.kv = opts.kv ?? null; this.onCrashed = opts.onCrash;
    if (this.closed) { void link.close(); return; }
    link.retarget({ receive: (m) => this.receive(m), fail: (e) => this.crash(e), ping: () => this.ping() });
    this.connect((m) => link.post(m as WorkerInput)); // the host never posts init
  }

  get isDisposed(): boolean { return this.closed; }
  /** Built from the worker's Ready, so there is nothing left to start: CityScene's initViews awaits this as it awaits
   *  the local and loopback hosts' start(). */
  start(): Promise<void> { return this.ready; }

  /** Deterministic mode (§2.9; hosts.test, the protector): whole headless days as separate worker units, live flag off.
   *  Resolves to the day reached, once the replica has applied them. */
  runDays(days: number): Promise<number> {
    if (!Number.isInteger(days) || days < 0) return Promise.reject(new Error('Invalid day count'));
    // a wire-only op of protocol.ts: SimHost's command table has no debug entries
    return this.post('debug.runDays' as never, [days] as never).done;
  }

  /** debug.verify (§2.2, §5.4: tools/qa-worker.mjs): the worker isolate's protector probe (flags.dev and natives syntax),
   *  its wasm kernels and its digest, as a debug unit acked in the command sequence. */
  debugVerify(): Promise<WorkerDebugReport> {
    return this.post('debug.verify' as never, [] as never).done as Promise<WorkerDebugReport>;
  }

  /** §5.4 (tools/qa-worker.mjs): the worker's exact digest and the replica's, read once its reply has been applied.
   *  Equal on a quiet (paused) city; live days in the reply's packet would follow the worker's read. */
  async verify(): Promise<{ worker: number; replica: number }> {
    const worker = await this.query('verify', {});
    return { worker, replica: exactDigest(this.state) };
  }

  override receive(message: WorkerOutput): void {
    if (this.closed) return;
    if (message.t === 'fatal') { this.crash(Object.assign(new Error(message.message), message.stack ? { stack: message.stack } : {})); return; }
    try {
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
    } catch (e) { this.crash(e); } // a packet's own failures resync inside Replica.apply; this is the host's
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

  /** R14: the worker's save record and its snapshots are stored here, in reply order, before their replies settle; also
   *  when no caller waits any more (T033), since the worker counts on main's put either way. With 'worker-idb' the
   *  worker wrote them: the base class settles them at once (the localStorage part, the journal mirror, the ack). */
  protected override settle(reply: Extract<Reply, { t: 'saved' | 'snapped' }>, waiting: Settle | undefined): void {
    if (this.persistence === 'worker-idb') { super.settle(reply, waiting); return; }
    const wait = waiting ?? NO_WAIT;
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
      this.storedAt = record.savedAt;
      // the put is the commit: a failed cleanup must not make the worker keep an obsolete base
      const dropped = await clearRecoveryIdb(kv, record.regionId, record.tileKey, record.savedAt).catch((e) => { this.report('recovery', e); return false; });
      super.settle({ ...ack, recoveryDropped: dropped || !!ack.recoveryDropped }, wait); // localStorage's part, the journal, the ack
    });
  }
  private storeSnapshot(reply: Extract<Reply, { t: 'snapped'; ok?: true }>, wait: Settle): void {
    this.write(wait, async () => {
      // a delta of a save main did not store (its put failed, or a resync lost it) restores nothing: not an error
      if (reply.marker.baseSavedAt !== this.storedAt) { wait.resolve(null); return; }
      const kv = this.kv ?? await openKV(), start = this.now();
      await storeRecoveryIdb(kv, reply.marker, reply.payload);
      // the journal mirror takes it up and writes its localStorage slot (the base class), as with 'worker-idb'
      const ms = (reply.result?.ms ?? 0) + this.now() - start;
      super.settle({ ...reply, result: { ok: true, bytes: reply.payload.length, ls: false, dropped: reply.marker.dropped, ...reply.result, idb: kv.persistent, ms } }, wait);
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
    // the snapshot first, while the host is open (§4.4)
    try { this.recovery?.writeNow('crash'); } catch (e) { this.report('recovery', e); }
    const onCrashed = this.onCrashed;
    // a caller that takes the crash path (the App's crash dialog, §4.4) shows it: no second error card in the overlay
    this.fail(crashed, !onCrashed);
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

