/** Main-side adapter for the real worker. The application still selects LocalSimHost by default. */
import { Emitter } from '../core/events';
import { Overlay } from '../core/types';
import { CityActions, type CityActionsApi, type ActionResult } from '../sim/actions';
import { BF, type CityState, type Building } from '../sim/CityState';
import { Simulation } from '../sim/Simulation';
import { attachOverlays, registerDerivedSource, TAP_T0 } from '../sim/infra/overlays';
import { getDef } from '../sim/catalog';
import { openKV, type KV } from '../save/db';
import { getCityRecord } from '../save/cities';
import { cityFingerprint } from '../save/fingerprint';
import { storeRecoveryIdb, clearRecoveryAfterSave as clearRecoveryIdb } from '../save/recoveryIdb';
import { storeRecoveryLs, clearRecoveryAfterSave as clearRecoveryLs } from '../save/recoveryLs';
import type { RecoverySnapshot } from '../save/recoveryCodec';
import { Gesture, type SimHost, type Command, type CommandOp, type CommandArgs, type CommandResult, type ActOptions,
  type Ticket, type GestureOwner, type SpeedSource, type SaveAck, type SaveReason, type SnapshotAck, type SnapshotWhy,
  type RecoveryMirror, type PolicyView, type WatchHandle, type LocalSimHostOptions } from './SimHost';
import { Replica } from './replica';
import { viewLayers, workerRaster } from './recorder';
import { exactDigest, queryKey, type QueryName, type QueryArgs, type QueryResult, type WatchPolicy } from './queries';
import { PROTOCOL_VERSION, assertOwnedBuffers, type Clock, type Packet, type PolicyState, type ViewState } from './protocol';
import { WorkerLiveness, type WorkerPort, type SerializedSource, type WorkerInput, type WorkerOutput, type WorkerReply, type BootPhase } from './workerProtocol';

export class HostCrashed extends Error { override name = 'HostCrashed'; }
export interface WorkerSimHostOptions extends Omit<LocalSimHostOptions, 'persistence'> {
  port?: WorkerPort;
  kv?: KV;
  deterministic?: boolean;
  dev?: boolean;
  settings?: import('./protocol').SimSettings;
  regionName?: string;
  /** Supplied by the region-screen prefetch. No hello deadline runs during a download. */
  scriptLoaded?: Promise<void>;
  onBoot?: (phase: BootPhase, pct: number) => void;
  /** App integration: boot failures choose a fresh local host; later failures show the crash path. */
  onCrash?: (error: HostCrashed, duringBoot: boolean) => void;
  /** T031/T032 consolidation seam: replace the small compatibility action facade below. */
  actions?: (host: WorkerSimHost, preview: CityActionsApi) => CityActionsApi;
}
interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const PREVIEW = new Set<CommandOp>(['zone', 'dezone', 'bulldoze', 'buildNetwork', 'buildPowerLine', 'buildSubway', 'plop', 'terraform', 'plantTrees']);
const PENDING = new Set<CommandOp>([...PREVIEW, 'setOrdinance', 'takeLoan', 'repayLoan']);
const DEFAULT_SETTINGS = { emergencyUncovered: 'live', emergencyLiveSlowmo: 3, emergencyAlerts: 'major' } as const;
type Pending = { command: Command; tag: object | null; result: Deferred<unknown>; predicted: unknown };

export function browserSimWorker(): WorkerPort {
  const worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module', name: 'sim' });
  const lifetime = new AbortController(), queued: ({ message: WorkerOutput } | { error: unknown })[] = [];
  let target: { receive(m: WorkerOutput): void; fail(e: unknown): void } | null = null;
  const deliver = (item: typeof queued[number]) => {
    if (!target) { queued.push(item); return; }
    if ('message' in item) target.receive(item.message); else target.fail(item.error);
  };
  worker.addEventListener('message', (e) => deliver({ message: e.data }), { signal: lifetime.signal });
  worker.addEventListener('error', (e) => { e.preventDefault(); deliver({ error: e.error ?? new Error(e.message || 'Worker script failed to load') }); }, { signal: lifetime.signal });
  worker.addEventListener('messageerror', () => deliver({ error: new Error('Worker messageerror') }), { signal: lifetime.signal });
  return {
    postMessage: (m) => worker.postMessage(m),
    listen(receive, fail, signal) {
      if (signal.aborted) return;
      target = { receive, fail };
      const stop = () => { target = null; queued.length = 0; lifetime.abort('dispose'); signal.removeEventListener('abort', stop); };
      signal.addEventListener('abort', stop, { once: true });
      for (const item of queued.splice(0)) { if (signal.aborted) break; deliver(item); }
    },
    terminate: () => { lifetime.abort('dispose'); target = null; queued.length = 0; worker.terminate(); },
  };
}

/** R14 loader: read the stored bytes, without constructing an authoritative CityState on main. */
export async function loadWorkerSimHost(regionId: string, tileKey: string, opts: WorkerSimHostOptions = {}): Promise<WorkerSimHost> {
  const kv = opts.kv ?? await openKV(), record = await getCityRecord(kv, regionId, tileKey);
  if (!record) throw new Error('City record not found');
  const host = new WorkerSimHost({ kind: 'serialized', regionId, tileKey, savedAt: record.savedAt, city: record.city }, { ...opts, kv });
  await host.ready;
  return host;
}

export class WorkerSimHost implements SimHost {
  readonly kind = 'worker';
  private abort = new AbortController();
  private port: WorkerPort;
  private replica: Replica;
  private started = false;
  private closed: Error | null = null;
  private termination: Promise<unknown> = Promise.resolve();
  private readyResult = deferred<void>();
  readonly ready = this.readyResult.promise;
  readonly sim: Simulation;
  readonly actions: CityActionsApi;
  readonly preview: CityActionsApi;
  readonly recovery: RecoveryMirror;
  private pending = new Map<number, Pending>();
  private requests = new Map<number, Deferred<unknown>>();
  private persisting = new Set<number>();
  private watches = new Map<number, RemoteWatch>();
  private queries = new Map<string, Promise<unknown>>();
  private seq = 0;
  private id = 0;
  private tick = 0;
  private epoch = 0;
  private ping = 0;
  private gesture: Gesture | null = null;
  private clockAt = 0;
  private changeCount = 0;
  private pausedFrom = 1;
  private life: WorkerLiveness;
  private timer: ReturnType<typeof setInterval>;
  private now: () => number;
  private cleanupViews: (() => void)[] = [];
  private policyChanges = new Emitter<{ change: PolicyState }>();
  readonly policy: PolicyView;
  private storage: Promise<unknown> = Promise.resolve();
  private lastSnapshot: RecoverySnapshot | null = null;
  private savedAt: number;
  private applyingSeq = 0;
  private savedChanges = 0;
  private savedFingerprint = '';
  private snapshotAt = 0;
  private snapshotDay = 0;
  private snapshotPending = false;

  constructor(source: SerializedSource, private opts: WorkerSimHostOptions = {}) {
    this.now = opts.now ?? (() => performance.now());
    this.life = new WorkerLiveness(this.now);
    this.savedAt = source.savedAt;
    this.port = opts.port ?? browserSimWorker();
    const self = this;
    this.replica = new Replica({
      tag: (seq) => this.pending.get(seq)?.tag ?? null,
      ack: (seq, result) => this.ack(seq, result),
      plain: (_state, cmd) => this.optimistic(cmd, 'plain'),
      building: (b, cmd) => this.optimistic(cmd, 'building', b),
      policy: (_policy, cmd) => this.optimistic(cmd, 'policy'),
      clock: (clock, cmd) => this.optimistic(cmd, 'clock', clock),
      adopt: (_replica, cmd) => {
        this.adoptViews();
        for (const watch of this.watches.values()) watch.reset();
        this.optimistic(cmd, 'plain'); this.optimistic(cmd, 'policy');
        for (const b of this.state.buildings.values()) this.optimistic(cmd, 'building', b);
        this.optimistic(cmd, 'clock', this.replica.clock);
      },
      watch: (value) => this.watches.get(value.id)?.receive(value.key, value.value),
      reply: (reply) => this.reply(reply as WorkerReply),
      digest: exactDigest,
      requestResync: () => this.post({ t: 'resync' }),
      report: (key, error) => this.report(key, error),
    });
    Object.defineProperties(this.emergency, {
      active: { get: () => !this.closed && this.replica.emergency.active },
      layersReady: { get: () => !this.closed && this.replica.emergency.layersReady },
    });
    // The W0 interface still names Simulation. No real Simulation or RNG is constructed over the replica.
    this.sim = Object.create(Simulation.prototype) as Simulation;
    Object.defineProperties(this.sim, {
      state: { get: () => this.state }, events: { get: () => this.events }, systems: { value: [] },
      speed: { get: () => this.speed, set: (v: number) => this.setSpeed(v, 'facade') },
      liveSlowdown: { get: () => this.liveSlowdown }, dayFraction: { get: () => this.simTime() - this.state.day },
    });
    this.sim.simTime = () => this.simTime(); this.sim.secondsPerDay = () => this.secondsPerDay();
    this.sim.getSystem = ((name: string) => ({ emergency: this.emergency, traffic: { ...this.traffic, getSampleRoutes: this.traffic.sampleRoutes },
      utilities: this.utilities, disasters: { active: this.closed ? [] : this.replica.disasters } })[name]) as Simulation['getSystem'];
    this.sim.runDays = ((n: number) => this.runDays(n)) as unknown as Simulation['runDays'];
    const forbidden = () => { throw new Error('The worker owns simulation mutations'); };
    this.sim.update = this.sim.advanceDay = this.sim.replaceState = this.sim.notify = forbidden;
    this.sim.frameHooks = this.sim.accumulate = this.sim.capFrame = forbidden;
    this.sim.stepDay = forbidden;
    this.preview = this.actionFacade(true);
    this.actions = opts.actions?.(this, this.preview) ?? this.actionFacade(false);
    this.policy = {
      get alerts() { return self.replica.policy.alerts; }, get live() { return self.replica.policy.live; },
      get toast() { return self.replica.policy.toast; }, get warn() { return self.replica.policy.warn; },
      subscribe(listener, signal) {
        if (signal.aborted || self.abort.signal.aborted) return () => {};
        const off = self.policyChanges.on('change', listener);
        const stop = () => { off(); signal.removeEventListener('abort', stop); self.abort.signal.removeEventListener('abort', stop); };
        signal.addEventListener('abort', stop, { once: true }); self.abort.signal.addEventListener('abort', stop, { once: true });
        return stop;
      },
    };
    // T033 seam: W1.2 retains only encoded worker snapshots, never a journal or replica serialization.
    this.recovery = { writeNow: () => {
      const snapshot = this.lastSnapshot;
      if (snapshot && !this.closed && snapshot.marker.baseSavedAt === this.savedAt) storeRecoveryLs(snapshot.marker, snapshot.payload);
    } };
    this.bindLifecycle();
    const stop = () => { void this.dispose(); };
    if (opts.signal?.aborted) queueMicrotask(stop);
    else opts.signal?.addEventListener('abort', stop, { once: true });
    this.abort.signal.addEventListener('abort', () => opts.signal?.removeEventListener('abort', stop), { once: true });
    this.timer = setInterval(() => this.checkLiveness(), 250);
    this.port.listen((m) => this.receive(m), (e) => this.crash(e), this.abort.signal);
    if (opts.scriptLoaded) void opts.scriptLoaded.then(() => this.life.scriptLoaded(), (e) => this.crash(e));
    this.post({ t: 'init', v: PROTOCOL_VERSION, city: source, persistence: 'main', rctx: opts.rctx ?? null,
      initialSpeed: opts.initialSpeed ?? 1, settings: opts.settings ?? DEFAULT_SETTINGS,
      flags: { simwasm: opts.flags?.simwasm ?? null, dev: opts.dev ?? false }, deterministic: opts.deterministic, regionName: opts.regionName });
  }
  get state() { return this.replica.state; }
  get events() { return this.replica.events; }
  get speed(): number { return this.replica.clock?.speed ?? this.opts.initialSpeed ?? 1; }
  get liveSlowdown(): number { return this.replica.clock?.slow ?? 1; }
  get cause() { return this.replica.cause; }
  readonly emergency = {
    active: false, layersReady: false,
    incidents: () => this.closed ? [] : this.replica.emergency.incidents(),
    incident: (id: number) => this.closed ? undefined : this.replica.emergency.incident(id),
    vehicles: () => this.closed ? [] : this.replica.emergency.vehicles(),
    stationList: () => this.closed ? [] : this.replica.emergency.stationList(),
    stationName: (id: number) => this.closed ? 'Station' : this.replica.emergency.stationName(id),
    stationFleet: (id: number) => this.closed ? null : this.replica.emergency.stationFleet(id),
  };
  readonly traffic = {
    sampleRoutes: (max: number) => this.closed ? [] : this.replica.traffic.sampleRoutes(max),
    truckVolume: () => this.closed ? null : this.replica.traffic.truckVolume(),
  };
  readonly utilities = { waterQualityAt: (_sim: Pick<Simulation, 'state'>, cell: number): number => {
    if (this.closed) return 1;
    const raster = this.replica.raster(Overlay.Water, 1);
    return raster ? Math.max(0, Math.min(1, (raster.data[cell] - TAP_T0) / (1 - TAP_T0))) : this.state.stats.tapWater ?? 1;
  } };
  get newsSeq(): number { return this.replica.newsSeq; }
  get changes(): number { return this.changeCount; }
  secondsPerDay(): number { return this.replica.clock?.spd ?? Infinity; }
  simTime(): number {
    const c = this.replica.clock;
    if (!c) return 0;
    const delta = c.speed === 0 || !c.live ? 0 : Math.min(0.25, Math.max(0, this.now() - this.clockAt) / 1000) / c.spd;
    return c.day + Math.min(1, c.frac + delta);
  }
  setSpeed(value: number, source: SpeedSource): void { void this.act('setSpeed', [value, source]).done.catch(() => {}); }
  resume(source: SpeedSource): void { void this.act('resume', [source]).done.catch(() => {}); }
  frame(dt: number): void {
    if (!this.started || this.closed) return;
    this.post({ t: 'tick', seq: ++this.tick, dt, epoch: this.epoch, ack: this.replica.seq });
    if (!this.snapshotPending && (this.now() - this.snapshotAt >= 30000 || this.state.day - this.snapshotDay >= 90)
      && (this.changes !== this.savedChanges || cityFingerprint(this.state) !== this.savedFingerprint)) {
      this.snapshotPending = true;
      this.snapshotAt = this.now(); this.snapshotDay = this.state.day;
      void this.snapshot('periodic').catch((e) => this.report('snapshot', e)).finally(() => { this.snapshotPending = false; });
    }
  }
  setView(v: ViewState): void { this.assertOpen(); this.post({ t: 'view', v }); }
  beginGesture(owner: GestureOwner): Gesture {
    this.gesture?.end();
    const gesture = new Gesture(owner, () => { if (this.gesture === gesture) this.gesture = null; });
    this.gesture = gesture; return gesture;
  }
  act<K extends CommandOp>(op: K, args: CommandArgs<K>, opts: ActOptions = {}): Ticket<CommandResult<K>> {
    this.assertOpen();
    const command = structuredClone({ op, args }) as Command;
    const predicted = this.predict(command) as CommandResult<K> | undefined;
    const exact = ![...this.pending.values()].some((p) => PENDING.has(p.command.op));
    if (exact && predicted && typeof predicted === 'object' && 'ok' in predicted && !predicted.ok && PENDING.has(op)) {
      return { seq: 0, predicted, exact, done: Promise.resolve(predicted) };
    }
    const result = deferred<unknown>(), seq = ++this.seq;
    // An ignored void command must still reject for an awaiting caller, without an unhandled rejection.
    void result.promise.catch(() => {});
    this.pending.set(seq, { command, tag: opts.tag ?? null, result, predicted });
    (opts.gesture ?? this.gesture)?.track(result.promise);
    if (op === 'setSpeed' && args[0] === 0 && args[1] === 'pause') this.pausedFrom = this.speed;
    this.optimistic(this.replica.cmd, 'plain'); this.optimistic(this.replica.cmd, 'policy');
    this.optimistic(this.replica.cmd, 'clock', this.replica.clock);
    if (command.op === 'setHistoric') {
      const b = this.state.buildings.get(command.args[0]);
      if (b) { this.optimistic(this.replica.cmd, 'building', b); this.events.emit('buildingChanged', b); }
    }
    if (command.op === 'setCamera') this.state.systemData.camera = command.args[0];
    this.post({ t: 'cmd', seq, ...command });
    return { seq, predicted, exact, done: result.promise as Promise<CommandResult<K>> };
  }
  query<K extends QueryName>(name: K, args: QueryArgs<K>): Promise<QueryResult<K>> {
    this.assertOpen();
    const key = `${this.seq}:${this.replica.seq}:${name}:${queryKey(args)}`;
    const existing = this.queries.get(key); if (existing) return existing as Promise<QueryResult<K>>;
    const { id, result } = this.request();
    this.queries.set(key, result.promise);
    const clear = () => { this.queries.delete(key); }; void result.promise.then(clear, clear);
    this.post({ t: 'query', id, name, args });
    return result.promise as Promise<QueryResult<K>>;
  }
  watch<K extends QueryName>(name: K, args: QueryArgs<K>, when: WatchPolicy): WatchHandle<QueryResult<K>, QueryArgs<K>> {
    this.assertOpen(); const id = ++this.id;
    const watch = new RemoteWatch(args, (a) => this.post({ t: 'watch', id, name, args: a as QueryArgs<K>, when }),
      () => { this.watches.delete(id); if (!this.closed) this.post({ t: 'unwatch', id }); }, (e) => this.report('watch', e));
    this.watches.set(id, watch); watch.start();
    return watch as WatchHandle<QueryResult<K>, QueryArgs<K>>;
  }
  runDays(days: number): Promise<number> {
    if (!Number.isInteger(days) || days < 0) return Promise.reject(new Error('Invalid day count'));
    this.assertOpen(); const { id, result } = this.request(); this.post({ t: 'run', id, days });
    return result.promise as Promise<number>;
  }
  save(reason: SaveReason): Promise<SaveAck> {
    this.assertOpen(); const { id, result } = this.request(); this.post({ t: 'save', id, reason });
    return result.promise as Promise<SaveAck>;
  }
  snapshot(why: SnapshotWhy): Promise<SnapshotAck | null> {
    this.assertOpen(); const { id, result } = this.request(); this.post({ t: 'snapshot', id, why });
    return result.promise as Promise<SnapshotAck>;
  }
  private request(): { id: number; result: Deferred<unknown> } {
    const id = ++this.id, result = deferred<unknown>(); this.requests.set(id, result); return { id, result };
  }
  private ack(seq: number, value: unknown): void {
    const pending = this.pending.get(seq); this.pending.delete(seq); pending?.result.resolve(value);
  }
  private receive(message: WorkerOutput): void {
    if (this.closed) return;
    try {
      this.life.received(message.t);
      switch (message.t) {
        case 'hello': if (message.v !== PROTOCOL_VERSION) throw new Error('Worker protocol version mismatch'); break;
        case 'boot': this.opts.onBoot?.(message.phase, message.pct); break;
        case 'fatal': this.crash(new Error(message.message)); break;
        case 'ready':
          this.epoch = message.epoch; this.changeCount = message.changes;
          this.replica.adopt(message);
          for (const a of message.settled) this.ack(a.seq, a.result);
          this.clockAt = this.now();
          if (!this.started) { this.snapshotAt = this.now(); this.snapshotDay = this.state.day; this.savedFingerprint = cityFingerprint(this.state); }
          this.started = true; this.post({ t: 'ack', epoch: this.epoch, ack: 0 }); this.readyResult.resolve(); break;
        case 'pkt': {
          if (message.epoch !== this.epoch || this.replica.diverged) return;
          // Replies are applied synchronously after log replay; persistence uses this packet's counter.
          this.applyingSeq = message.p.seq; this.changeCount = message.p.changes;
          const packet = message.p as Packet;
          if (!this.replica.apply(packet)) return;
          this.clockAt = this.now();
          this.post({ t: 'ack', ack: this.replica.seq, epoch: this.epoch });
          try { this.policyChanges.emit('change', this.replica.policy); } catch (e) { this.report('policy', e); }
          break;
        }
      }
    } catch (e) { this.crash(e); }
  }
  private reply(reply: WorkerReply): void {
    if (reply.t === 'error') {
      try { this.opts.errors?.report(reply.title, new Error(reply.message), { key: reply.key, sim: reply.sim }); } catch { /* reporting cannot stop replay */ }
      return;
    }
    if (reply.t === 'watchError') { this.watches.get(reply.id)?.fail(reply.key, new Error(reply.error)); return; }
    const pending = this.requests.get(reply.id); if (!pending || this.persisting.has(reply.id)) return;
    const pktSeq = this.applyingSeq;
    if (reply.t === 'qres' || reply.t === 'ran' || reply.t === 'snapshotFailed') {
      this.requests.delete(reply.id);
      if (reply.t === 'qres') { if (reply.ok) pending.resolve(reply.value); else pending.reject(new Error(reply.error)); }
      else if (reply.t === 'ran') pending.resolve(reply.day);
      else pending.reject(new Error(reply.error));
      return;
    }
    // Queue the IDB stages in packet order. A save's base advances only after main confirms its put.
    this.persisting.add(reply.id);
    const task = this.storage.then(async () => {
      if (this.closed) throw this.closed;
      const kv = this.opts.kv ?? await openKV();
      if (reply.t === 'saved') {
        if (!reply.ok) throw new Error(reply.error);
        await kv.put('cities', reply.record, reply.record.key);
        if (this.closed) throw this.closed;
        // The city put is the commit. A cleanup failure cannot make the worker keep an obsolete recovery base.
        const droppedIdb = await clearRecoveryIdb(kv, reply.record.regionId, reply.record.tileKey, reply.record.savedAt).catch((e) => { this.report('recovery:cleanup', e); return false; });
        if (this.closed) throw this.closed;
        const droppedLs = clearRecoveryLs(reply.record.regionId, reply.record.tileKey, reply.record.savedAt);
        this.savedAt = reply.record.savedAt; this.savedChanges = reply.changes; this.savedFingerprint = reply.fp; this.lastSnapshot = null;
        this.snapshotAt = this.now(); this.snapshotDay = Number(reply.record.city.scalars.day);
        if (!this.closed) this.post({ t: 'stored', id: reply.id, ok: true });
        return { savedAt: reply.record.savedAt, cmd: reply.cmd, pktSeq,
          fp: reply.fp, summary: reply.summary, changes: reply.changes, recoveryDropped: droppedIdb || droppedLs } satisfies SaveAck;
      }
      const start = this.now();
      if (reply.marker.baseSavedAt !== this.savedAt) throw new Error('Snapshot belongs to an obsolete save');
      this.lastSnapshot = reply;
      await storeRecoveryIdb(kv, reply.marker, reply.payload);
      if (this.closed) throw this.closed;
      this.snapshotAt = this.now(); this.snapshotDay = reply.marker.day;
      return { ...reply, ok: true, bytes: reply.payload.length, ls: false, idb: true, ms: this.now() - start } satisfies SnapshotAck;
    });
    this.storage = task.catch(() => {});
    void task.then((value) => { this.persisting.delete(reply.id); this.requests.delete(reply.id); if (this.closed) pending.reject(this.closed); else pending.resolve(value); }, (e) => {
      this.persisting.delete(reply.id); this.requests.delete(reply.id);
      if (reply.t === 'saved' && reply.ok && !this.closed) this.post({ t: 'stored', id: reply.id, ok: false });
      pending.reject(e);
    });
  }
  private adoptViews(): void {
    for (const off of this.cleanupViews) off();
    this.cleanupViews = [attachOverlays(this.sim), registerDerivedSource(this.state,
      (o, v) => { const r = this.replica.raster(o, v); return r ? { data: r.data, scale: r.scale, version: this.replica.seq } : null; },
      (overlay, variant) => overlay === Overlay.Traffic && variant === 1 ? this.replica.traffic.truckVolume() !== null
        : workerRaster({ overlay, variant, panels: [], focus: [] }) ? !!this.replica.raster(overlay, variant)
        : viewLayers({ overlay, variant, panels: [], focus: [] }).every((l) => this.replica.layerReady(l)))];
  }
  private optimistic(cmd: number, section: 'plain' | 'building' | 'policy' | 'clock', value?: Building | Clock): void {
    if (!this.replica.state) return;
    for (const [seq, p] of this.pending) {
      if (seq <= cmd) continue;
      const c = p.command;
      if (section === 'plain') {
        if (c.op === 'setTax') this.state.budget.taxRates[c.args[0]] = Math.max(0, Math.min(20, Math.round(c.args[1] * 10) / 10));
        if (c.op === 'setFunding' && c.args[0] in this.state.budget.funding) this.state.budget.funding[c.args[0]] = Math.max(0, Math.min(150, Math.round(c.args[1])));
      } else if (section === 'building' && c.op === 'setHistoric') {
        const b = value as Building;
        if (b.id === c.args[0] && !(b.flags & BF.Plopped)) b.flags = c.args[1] ? b.flags | BF.Historic : b.flags & ~BF.Historic;
      } else if (section === 'policy' && c.op === 'dismissAlert') {
        this.replica.policy.alerts = this.replica.policy.alerts.filter((a) => a.id !== c.args[0]);
      } else if (section === 'clock' && value && (c.op === 'setSpeed' || c.op === 'resume')) {
        const clock = value as Clock;
        clock.speed = c.op === 'resume' ? this.pausedFrom : Math.max(0, Math.min(3, c.args[0] | 0));
        clock.spd = [Infinity, 0.5, 0.2, 0.05][clock.speed] * (clock.speed === 1 ? Math.max(1, clock.slow) : 1);
      }
    }
  }
  /** Temporary T031 seam: previews run against detached budget data and the player's own pending costs. */
  private predict(c: Command): unknown {
    if (!PENDING.has(c.op)) return undefined;
    const state = Object.assign(Object.create(Object.getPrototypeOf(this.state)), this.state) as CityState;
    state.budget = structuredClone(this.state.budget); state.milestones = { ...this.state.milestones };
    for (const p of this.pending.values()) if (PENDING.has(p.command.op)) {
      const r = p.predicted as ActionResult | undefined;
      if (r?.ok) state.funds -= r.cost;
      if (r?.ok && p.command.op === 'plop' && getDef(p.command.args[0])?.unique) state.milestones[p.command.args[0]] = 1;
    }
    const shell = { state, events: new Emitter(), getSystem: () => undefined } as unknown as Simulation;
    const actions = new CityActions(shell);
    const fn = actions[c.op as keyof CityActionsApi] as (...args: unknown[]) => unknown;
    if (PREVIEW.has(c.op)) return fn.apply(actions, [...c.args, true]);
    return fn.apply(actions, c.op === 'repayLoan' ? [c.args[0]] : c.args);
  }
  private actionFacade(previewOnly: boolean): CityActionsApi {
    return new Proxy({} as CityActionsApi, { get: (_target, name: string) => (...input: unknown[]) => {
      let op = name as CommandOp, args = input;
      if (name === 'toggleHistoric') { op = 'setHistoric'; args = [input[0], !((this.state.buildings.get(input[0] as number)?.flags ?? 0) & BF.Historic)]; }
      if (name === 'repayLoan') { const l = this.state.budget.loans[input[0] as number]; args = [input[0], { principal: l?.principal ?? NaN, monthsLeft: l?.monthsLeft ?? NaN }]; }
      if (PREVIEW.has(op)) {
        const lengths: Record<string, number> = { zone: 2, dezone: 1, bulldoze: 1, buildNetwork: 2, buildPowerLine: 1, buildSubway: 1, plop: 4, terraform: 5, plantTrees: 1 };
        const n = lengths[op]; args = input.slice(0, n);
        if (previewOnly || input[n] === true) return this.predict({ op, args } as Command);
      } else if (previewOnly) throw new Error('Preview actions are read-only');
      const ticket = this.act(op, args as CommandArgs<CommandOp>);
      return ticket.exact ? ticket.predicted : ticket.predicted && typeof ticket.predicted === 'object' ? { ...ticket.predicted, provisional: true } : ticket.predicted;
    } });
  }
  private bindLifecycle(): void {
    if (typeof document === 'undefined') return;
    const signal = this.abort.signal;
    const reset = () => this.life.reset(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', reset, { signal });
    document.addEventListener('freeze', () => this.life.reset(false), { signal });
    document.addEventListener('resume', reset, { signal });
    window.addEventListener('pageshow', reset, { signal });
    window.addEventListener('pagehide', () => this.life.reset(false), { signal });
    reset();
  }
  private checkLiveness(): void {
    if (this.closed) return;
    const { ping, timeout } = this.life.poll();
    if (timeout) this.crash(new Error(this.started ? 'Worker stopped responding' : 'Worker boot timed out'));
    else if (ping) this.post({ t: 'ping', n: ++this.ping, epoch: this.epoch, ack: this.replica.seq });
  }
  private assertOpen(): void { if (this.closed) throw this.closed; if (!this.started) throw new Error('Await host.ready before using the worker'); }
  private post(message: WorkerInput): void {
    if (this.closed) return;
    try { assertOwnedBuffers(message); this.port.postMessage(message); } catch (e) { this.crash(e); }
  }
  private report(key: string, error: unknown): void { try { this.opts.errors?.report(key, error, { key }); } catch { /* reporter cannot stop replay */ } }
  private crash(error: unknown): void {
    if (this.closed) return;
    const e = new HostCrashed(error instanceof Error ? error.message : String(error));
    const duringBoot = !this.started;
    this.close(e);
    try { this.opts.onCrash?.(e, duringBoot); } catch (err) { this.report('crash', err); }
  }
  private close(error: Error): void {
    if (this.closed) return;
    this.closed = error; this.abort.abort('dispose'); clearInterval(this.timer);
    this.readyResult.reject(error);
    for (const p of this.pending.values()) p.result.reject(error); this.pending.clear();
    for (const p of this.requests.values()) p.reject(error); this.requests.clear(); this.queries.clear();
    this.gesture?.end(); this.gesture = null;
    for (const w of this.watches.values()) w.dispose(); this.watches.clear();
    for (const off of this.cleanupViews) off(); this.cleanupViews = [];
    this.events.clear(); this.policyChanges.clear(); this.replica.policy.alerts = []; this.replica.policy.live = false; this.lastSnapshot = null;
    try { this.termination = Promise.resolve(this.port.terminate()).catch((e) => this.report('worker:terminate', e)); }
    catch (e) { this.report('worker:terminate', e); }
  }
  dispose(): Promise<void> {
    if (!this.closed) { this.post({ t: 'dispose' }); this.close(new Error('Simulation host is disposed')); }
    return this.termination.then(() => undefined);
  }
}

/** T032 seam: argument-keyed values and signal-bound listeners, without a second query implementation. */
class RemoteWatch implements WatchHandle<unknown> {
  private cache = new Map<string, unknown>();
  private listeners = new Map<() => void, () => void>();
  private key: string;
  private closed = false;
  error: unknown;
  version = 0;
  constructor(private args: unknown, private send: (args: unknown) => void, private remove: () => void, private report: (e: unknown) => void) {
    this.args = structuredClone(args); this.key = queryKey(args);
  }
  start(): void { this.send(this.args); }
  reset(): void { this.cache.clear(); this.error = undefined; this.version++; this.start(); }
  get value(): unknown { return this.cache.get(this.key); }
  setArgs(args: unknown): void {
    if (this.closed || queryKey(args) === this.key) return;
    this.args = structuredClone(args); this.key = queryKey(args); this.error = undefined; this.version++; this.send(this.args);
  }
  receive(key: string, value: unknown): void {
    if (this.closed) return;
    this.cache.delete(key); this.cache.set(key, value);
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    if (key !== this.key) return;
    this.error = undefined; this.changed();
  }
  fail(key: string, error: unknown): void { if (key === this.key) { this.error = error; this.changed(); } }
  private changed(): void { this.version++; for (const fn of this.listeners.keys()) try { fn(); } catch (e) { this.report(e); } }
  subscribe(fn: () => void, signal: AbortSignal): () => void {
    this.listeners.get(fn)?.();
    const off = () => { this.listeners.delete(fn); signal.removeEventListener('abort', off); };
    if (!this.closed && !signal.aborted) { this.listeners.set(fn, off); signal.addEventListener('abort', off, { once: true }); }
    return off;
  }
  dispose(): void { if (this.closed) return; this.closed = true; this.remove(); for (const off of this.listeners.values()) off(); this.cache.clear(); }
}
