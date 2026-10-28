/** Main-side packet plumbing, shared with WorkerSimHost; only the last class knows the loopback transport. */
import { Overlay } from '../core/types';
import type { CellRect } from '../core/events';
import { SECONDS_PER_DAY } from '../core/constants';
import { simWasmFlagSelects } from '../wasm/simWasm';
import type { CityActions, CityActionsApi } from '../sim/actions';
import { BF, type Building, type CityState } from '../sim/CityState';
import type { Simulation } from '../sim/Simulation';
import { attachOverlays, registerDerivedSource, TAP_T0 } from '../sim/infra/overlays';
import { serializeCity } from '../save/serialize';
import { CHANGE_EVENTS } from '../save/fingerprint';
import { clearRecoveryAfterSave, storeRecoveryLs } from '../save/recoveryLs';
import { Gesture, type ActOptions, type Cause, type Command, type CommandArgs, type CommandOp, type CommandResult,
  type GestureOwner, type LocalSimHostOptions, type PolicySnapshot, type PolicyView, type RecoveryMirror,
  type SaveAck, type SaveReason, type SimHost, type SnapshotAck, type SnapshotWhy, type SpeedSource, type Ticket, type WatchHandle } from './SimHost';
import { exactDigest, queryKey, type QueryArgs, type QueryName, type QueryResult, type WatchPolicy } from './queries';
import { cloneMessage, copyOwned, EVENT_TYPES, type M2W, type Packet, type PolicyState,
  type RasterPatch, type Ready, type Reply, type ViewState, type W2M, type WatchValue } from './protocol';
import { Replica } from './replica';
import { viewLayers } from './recorder';
import type { LoopbackCore, LoopbackOptions } from './loopbackCore';

/** Structural T031 seam: this branch neither copies nor owns HostActions / PendingEdits. */
export interface PacketActions extends CityActionsApi {
  readonly preview: CityActionsApi;
  readonly pending: {
    readonly count: number;
    readonly revision: number;
    overlay<T>(fn: () => T): T;
    claims(rect: CellRect): 'blocked' | 'waiting' | null;
    subscribe(listener: () => void, signal: AbortSignal): () => void;
    ack(seq: number): void;
    rebase(cmd: number): void;
  };
  act<K extends CommandOp>(op: K, args: CommandArgs<K>, opts?: ActOptions): Ticket<CommandResult<K>>;
  beginGesture(owner: GestureOwner): Gesture;
  dispose(): void;
}
export type ActionFactory = (host: PacketSimHost) => PacketActions;
export interface PacketHostOptions extends LocalSimHostOptions {
  actions?: ActionFactory;
  recovery?: RecoveryMirror;
  /** T033 can observe the posted command and packet replies without owning the transport. */
  onPost?: (command: Extract<M2W, { t: 'cmd' }>) => void;
  onAck?: (seq: number, result: unknown) => void;
  onSaving?: () => void;
  onReply?: (reply: Reply, packet: Packet) => void;
  onPacket?: (packet: Packet) => void;
  /** CityActions for the optimistic tax / funding / historic writes, when already loaded (tests). Hosts load it lazily
   *  and call useOptimisticActions: the city screen's static graph excludes src/sim/actions.ts (FH-07a). */
  optimistic?: typeof CityActions;
}
interface Deferred { resolve(value: any): void; reject(error: unknown): void }
function deferred<T>(): Deferred & { promise: Promise<T> } {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // Fire-and-forget setters have no caller awaiting them; explicit consumers still see rejection.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}

/** A keyed, bounded watch cache. A delayed value for another target never appears under the current target. */
export class PacketWatch<K extends QueryName> implements WatchHandle<QueryResult<K>, QueryArgs<K>> {
  private cache = new Map<string, WatchValue>();
  private listeners = new Map<() => void, () => void>();
  private key: string;
  private closed = false;
  version = 0;
  constructor(readonly id: number, readonly name: K, private args: QueryArgs<K>, readonly when: WatchPolicy,
    private send: (message: M2W) => void, private remove: () => void, private report: (error: unknown) => void) {
    this.args = copyOwned(args); this.key = queryKey(args);
  }
  get value(): QueryResult<K> | undefined { return this.cache.get(this.key)?.value as QueryResult<K> | undefined; }
  get error(): unknown { const e = this.cache.get(this.key)?.error; return e === undefined ? undefined : new Error(e); }
  request(): void { if (!this.closed) this.send({ t: 'watch', id: this.id, name: this.name, args: this.args, when: this.when }); }
  setArgs(args: QueryArgs<K>): void {
    if (this.closed || queryKey(args) === this.key) return;
    this.args = copyOwned(args); this.key = queryKey(args); this.version++; this.request();
  }
  receive(value: WatchValue): void {
    if (this.closed) return;
    this.cache.delete(value.key); this.cache.set(value.key, value);
    if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    if (value.key !== this.key) return;
    this.version++;
    for (const listener of this.listeners.keys()) {
      try { listener(); } catch (e) { this.report(e); }
    }
  }
  reset(): void { this.cache.clear(); this.version++; this.request(); }
  subscribe(listener: () => void, signal: AbortSignal): () => void {
    this.listeners.get(listener)?.();
    const off = () => { this.listeners.delete(listener); signal.removeEventListener('abort', off); };
    if (!signal.aborted && !this.closed) { this.listeners.set(listener, off); signal.addEventListener('abort', off, { once: true }); }
    return off;
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.remove(); this.send({ t: 'unwatch', id: this.id });
    for (const off of this.listeners.values()) off();
    this.cache.clear();
  }
}

export class PacketSimHost implements SimHost {
  readonly replica: Replica;
  readonly sim: Simulation;
  readonly policy: PolicyView;
  readonly recovery: RecoveryMirror | null;
  readonly ready: Promise<void>;
  private readiness = deferred<void>();
  private controller: PacketActions | null = null;
  private optimistic: CityActions | null = null;
  /** every post, coalesced slider moves included (a funding move changes upkeep): SimHost.commandCount */
  private posted = 0;
  private edits = new Map<number, Command>();
  private tickets = new Map<number, Deferred & { promise: Promise<unknown>; tag: object | null }>();
  private sliders = new Map<string, Extract<M2W, { t: 'cmd' }>>();
  private queuedView: ViewState | null = null;
  private requests = new Map<number, Deferred>();
  private queries = new Map<string, Promise<unknown>>();
  private watches = new Map<number, PacketWatch<QueryName>>();
  private policies = new Map<(p: PolicySnapshot) => void, () => void>();
  private policyBefore: PolicyState | null = null;
  private seq = 0;
  private id = 0;
  private ticks = 0;
  private gesture: Gesture | null = null;
  private offViews = () => {};
  private abort = new AbortController();
  protected closed = false;
  protected options: PacketHostOptions;
  private sender: ((m: M2W) => void) | null = null;
  private outbox: M2W[] = [];
  private packet: Packet | null = null;
  private hasReady = false;
  private receivedAt = 0;
  private lastTime = 0;
  private pausedFrom = 1;
  private speedMirror = 1;
  private stop = () => { void this.dispose(); };
  changes = 0;

  constructor(readonly kind: 'loopback' | 'worker', initial: Ready, options: PacketHostOptions = {}, initialIsReady = true) {
    this.options = options;
    this.ready = this.readiness.promise;
    this.recovery = options.recovery ? { writeNow: (why) => {
      if (this.closed) return;
      this.flushCommands(); this.options.recovery?.writeNow(why);
    } } : null;
    this.replica = new Replica({
      tag: (seq) => this.tickets.get(seq)?.tag ?? null,
      ack: (seq, result) => this.ack(seq, result),
      plain: (_state, cmd) => { this.controller?.pending.rebase(cmd); this.reapply(cmd); },
      building: (building, cmd) => this.reapply(cmd, building),
      policy: (policy, cmd) => this.reapply(cmd, undefined, policy),
      clock: (clock, cmd) => { this.speedMirror = clock.speed; this.reapply(cmd); },
      adopt: (_replica, cmd) => this.adopt(cmd),
      watch: (value) => {
        this.assertWatermark(value.cmd);
        this.watches.get(value.id)?.receive(value);
      },
      reply: (reply) => this.reply(reply),
      digest: exactDigest,
      requestResync: () => { this.send({ t: 'resync' }); },
      report: (key, error) => this.report(key, error),
    });
    const host = this;
    // Compatibility facade: no authoritative system or stepping method is exposed to the page.
    this.sim = {
      get state() { return host.state; }, get events() { return host.events; }, systems: [],
      get speed() { return host.speed; }, set speed(v: number) { host.setSpeed(v, 'facade'); },
      get liveSlowdown() { return host.liveSlowdown; },
      get dayFraction() { return host.simTime() - host.state.day; },
      simTime: () => host.simTime(), secondsPerDay: () => host.secondsPerDay(), update: (dt: number) => host.frame(dt),
      getSystem: (name: string) => name === 'emergency' ? host.emergency : name === 'traffic' ? host.replica.traffic
        : name === 'utilities' ? host.utilities : name === 'disasters' ? { active: host.replica.disasters } : undefined,
      runDays: () => { throw new Error('Use the host deterministic harness'); },
      advanceDay: () => { throw new Error('Use the host deterministic harness'); },
    } as unknown as Simulation;
    if (options.optimistic) this.useOptimisticActions(options.optimistic);
    this.policy = {
      get alerts() { return host.replica.policy.alerts; }, get live() { return host.replica.policy.live; },
      get toast() { return host.replica.policy.toast; }, get warn() { return host.replica.policy.warn; },
      subscribe(listener, signal) {
        host.policies.get(listener)?.();
        const off = () => { host.policies.delete(listener); signal.removeEventListener('abort', off); };
        if (!signal.aborted && !host.closed) { host.policies.set(listener, off); signal.addEventListener('abort', off, { once: true }); }
        return off;
      },
    };
    this.replica.adopt(cloneMessage(initial));
    if (options.actions) this.installActions(options.actions);
    options.signal?.addEventListener('abort', this.stop, { once: true });
    if (options.signal?.aborted) this.stop();
    if (initialIsReady && !this.closed) { this.hasReady = true; this.readiness.resolve(undefined); }
  }

  get state() { return this.replica.state; }
  get events() { return this.replica.events; }
  get speed(): number { return this.speedMirror; }
  get liveSlowdown(): number { return this.replica.clock.slow; }
  get cause(): Cause | null { return this.replica.cause; }
  get emergency() { return this.replica.emergency; }
  get traffic() { return this.replica.traffic; }
  get newsSeq(): number { return this.replica.newsSeq; }
  get actions(): CityActionsApi { if (!this.controller) throw new Error('T031 HostActions is not installed'); return this.controller; }
  get preview(): CityActionsApi { if (!this.controller) throw new Error('T031 PreviewActions is not installed'); return this.controller.preview; }
  get pending() { return this.controller?.pending ?? { count: 0, revision: 0, overlay: <T>(fn: () => T) => fn(), claims: (): null => null, subscribe: () => () => {}, ack: () => {}, rebase: () => {} }; }
  get degradedActions(): boolean { return !this.controller; }
  readonly utilities = { waterQualityAt: (_sim: Pick<Simulation, 'state'>, cell: number): number => {
    const r = this.replica.raster(Overlay.Water, 1);
    return r ? Math.max(0, Math.min(1, (r.data[cell] - TAP_T0) / (1 - TAP_T0))) : this.state.stats.tapWater ?? 1;
  } };
  protected now(): number { return this.options.now?.() ?? performance.now(); }
  installActions(factory: ActionFactory): void { this.controller?.dispose(); this.controller = factory(this); this.controller.pending.rebase(this.replica.cmd); }
  connect(send: (m: M2W) => void): void {
    if (this.closed) return;
    this.sender = send;
    for (const message of this.outbox.splice(0)) send(message);
  }
  protected send(message: M2W): void {
    if (this.closed) return;
    if (message.t !== 'cmd') this.flushCommands();
    const copy = cloneMessage(message);
    if (this.sender) this.sender(copy); else this.outbox.push(copy);
  }

  act<K extends CommandOp>(op: K, args: CommandArgs<K>, opts: ActOptions = {}): Ticket<CommandResult<K>> {
    if (this.controller) return this.controller.act(op, args, opts);
    // Transport-only tests can post without T031. The browser requires its controller before ready.
    const ticket = this.post(op, args, opts);
    (opts.gesture ?? this.gesture)?.track(ticket.done);
    return { ...ticket, exact: false };
  }
  get commandCount(): number { return this.posted; }
  /** Install the optimistic writes once CityActions has loaded; until then those commands wait for their packet. */
  useOptimisticActions(Actions: typeof CityActions): void {
    if (!this.closed && !this.optimistic) this.optimistic = new Actions(this.sim);
  }
  post<K extends CommandOp>(op: K, args: CommandArgs<K>, opts: ActOptions = {}): Pick<Ticket<CommandResult<K>>, 'seq' | 'done'> {
    this.assertOpen();
    this.posted++;
    const key = op === 'setTax' || op === 'setFunding' ? `${op}:${args[0]}` : null;
    if (!key) this.flushCommands();
    const pending = key ? this.sliders.get(key) : undefined;
    if (pending) {
      const command = copyOwned({ op, args }) as Command;
      pending.args = command.args; this.edits.set(pending.seq, command); this.optimism(command);
      return { seq: pending.seq, done: this.tickets.get(pending.seq)!.promise as Promise<CommandResult<K>> };
    }
    const command = copyOwned({ op, args }) as Command, seq = ++this.seq, wait = deferred<CommandResult<K>>();
    this.tickets.set(seq, { ...wait, tag: opts.tag ?? null });
    this.edits.set(seq, command);
    // Queue before emitting an optimistic event, so a listener's nested command stays FIFO.
    const message: Extract<M2W, { t: 'cmd' }> = { t: 'cmd', seq, op, args: command.args };
    if (key) this.sliders.set(key, message);
    else this.transmit(message);
    this.optimism(command);
    return { seq, done: wait.promise };
  }
  /** Coalesce sliders and focus per frame; reads/saves/non-slider commands also flush the pending inputs. */
  flushCommands(): void {
    const pending = [...this.sliders.values()]; this.sliders.clear();
    for (const message of pending) this.transmit(message);
    const view = this.queuedView; this.queuedView = null;
    if (view) this.send({ t: 'view', v: view });
  }
  private transmit(message: Extract<M2W, { t: 'cmd' }>): void {
    try { this.options.onPost?.(copyOwned(message)); } catch (e) { this.report('command observer', e); }
    this.send(message);
  }
  private ack(seq: number, result: unknown): void {
    const ticket = this.tickets.get(seq);
    this.edits.delete(seq); this.controller?.pending.ack(seq); this.tickets.delete(seq);
    try { this.options.onAck?.(seq, result); } catch (e) { this.report('ack observer', e); }
    if (result && typeof result === 'object' && 'commandError' in result) ticket?.reject(new Error(String(result.commandError)));
    else ticket?.resolve(result);
  }
  beginGesture(owner: GestureOwner): Gesture {
    if (this.controller) return this.controller.beginGesture(owner);
    this.gesture?.end();
    const g = new Gesture(owner, () => { if (this.gesture === g) this.gesture = null; });
    return this.gesture = g;
  }
  setSpeed(value: number, source: SpeedSource): void { this.act('setSpeed', [value, source]); }
  resume(source: SpeedSource): void { this.act('resume', [source]); }
  private optimism(command: Command): void {
    switch (command.op) {
      case 'setTax': this.optimistic?.setTax(...command.args); break;
      case 'setFunding': this.optimistic?.setFunding(...command.args); break;
      case 'setHistoric': {
        const [id, on] = command.args, b = this.state.buildings.get(id);
        if (b && !!(b.flags & BF.Historic) !== on) this.optimistic?.toggleHistoric(id);
        break;
      }
      case 'setSpeed':
        if (command.args[0] === 0 && command.args[1] === 'pause') this.pausedFrom = this.speed;
        this.speedMirror = Math.max(0, Math.min(3, command.args[0] | 0));
        this.events.emit('speedChanged', this.speed); break;
      case 'resume': this.speedMirror = this.pausedFrom; this.events.emit('speedChanged', this.speed); break;
      case 'dismissAlert': this.replica.policy.alerts = this.replica.policy.alerts.filter((a) => a.id !== command.args[0]); this.publishPolicy(); break;
      case 'setCamera': this.state.systemData.camera = copyOwned(command.args[0]); break;
    }
  }
  /** Rebase without events; the authoritative event that follows sees the latest pending field value. */
  private reapply(cmd: number, building?: Building, policy?: PolicyState): void {
    for (const [seq, c] of this.edits) if (seq > cmd) {
      if (building) {
        if (c.op === 'setHistoric' && c.args[0] === building.id && !(building.flags & BF.Plopped)) building.flags = c.args[1] ? building.flags | BF.Historic : building.flags & ~BF.Historic;
      } else if (policy) {
        if (c.op === 'dismissAlert') policy.alerts = policy.alerts.filter((a) => a.id !== c.args[0]);
      } else {
        if (c.op === 'setTax') this.optimistic?.setTax(...c.args);
        if (c.op === 'setFunding') this.optimistic?.setFunding(...c.args);
        if (c.op === 'setSpeed') this.speedMirror = Math.max(0, Math.min(3, c.args[0] | 0));
        if (c.op === 'resume') this.speedMirror = this.pausedFrom;
      }
    }
  }
  simTime(): number {
    const c = this.replica.clock;
    const f = c.frac + (this.speed > 0 ? Math.max(0, this.now() - this.receivedAt) / 1000 / this.secondsPerDay() : 0);
    return this.lastTime = Math.max(this.lastTime, c.day + Math.min(0.999, f));
  }
  secondsPerDay(): number { return SECONDS_PER_DAY[this.speed] * (this.speed === 1 ? Math.max(1, this.liveSlowdown || 1) : 1); }
  frame(dt: number): void {
    if (this.closed) return;
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid tick');
    this.send({ t: 'tick', seq: ++this.ticks, dt, ack: this.replica.seq });
  }
  setView(view: ViewState): void { if (!this.closed) this.queuedView = copyOwned(view); }

  query<K extends QueryName>(name: K, args: QueryArgs<K>): Promise<QueryResult<K>> {
    if (this.closed) return Promise.reject(new Error('Simulation host is disposed'));
    const key = `${this.seq}:${this.replica.seq}:${name}:${queryKey(args)}`, old = this.queries.get(key);
    if (old) return old as Promise<QueryResult<K>>;
    const id = ++this.id, wait = deferred<QueryResult<K>>();
    this.requests.set(id, wait); this.queries.set(key, wait.promise);
    const clear = () => { if (this.queries.get(key) === wait.promise) this.queries.delete(key); };
    void wait.promise.then(clear, clear);
    this.send({ t: 'query', id, name, args });
    return wait.promise;
  }
  watch<K extends QueryName>(name: K, args: QueryArgs<K>, when: WatchPolicy): WatchHandle<QueryResult<K>, QueryArgs<K>> {
    this.assertOpen();
    const id = ++this.id;
    const w = new PacketWatch<K>(id, name, args, when, (m) => this.send(m), () => this.watches.delete(id), (e) => this.report(`watch:${name}`, e));
    this.watches.set(id, w as PacketWatch<QueryName>); w.request(); return w;
  }
  save(reason: SaveReason): Promise<SaveAck> {
    if (!this.closed) { try { this.options.onSaving?.(); } catch (e) { this.report('save observer', e); } }
    return this.request({ t: 'save', id: ++this.id, reason });
  }
  snapshot(why: SnapshotWhy): Promise<SnapshotAck | null> { return this.request({ t: 'snapshot', id: ++this.id, why }); }
  private request<T>(message: Extract<M2W, { t: 'save' | 'snapshot' }>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Simulation host is disposed'));
    const wait = deferred<T>(); this.requests.set(message.id, wait); this.send(message); return wait.promise;
  }
  private assertWatermark(cmd: number): void {
    if (!Number.isSafeInteger(cmd) || cmd < 0 || cmd > this.replica.applied) throw new Error('Reply is newer than the replica or has an invalid watermark');
  }
  protected reply(reply: Reply): void {
    this.assertWatermark(reply.cmd);
    if (reply.t === 'error') { this.report(reply.key, new Error(reply.message), reply.title, reply.sim); return; }
    try { this.options.onReply?.(reply, this.packet!); } catch (e) { this.report('reply observer', e); }
    const wait = this.requests.get(reply.id); this.requests.delete(reply.id);
    if (!wait) return;
    if (reply.t === 'qres') {
      if (reply.ok) wait.resolve(reply.value); else wait.reject(new Error(reply.error));
    } else if (reply.t === 'saved') {
      if (!reply.ok) { wait.reject(new Error(reply.error)); return; }
      const p = this.options.persistence;
      const dropped = p ? clearRecoveryAfterSave(p.regionId, p.tileKey, reply.savedAt!) : false;
      wait.resolve({ savedAt: reply.savedAt!, cmd: reply.cmd, pktSeq: reply.pktSeq!, fp: reply.fp!, summary: reply.summary!,
        changes: reply.changes ?? this.changes, recoveryDropped: dropped || !!reply.recoveryDropped } satisfies SaveAck);
    } else if (reply.ok === false) {
      if (reply.error) wait.reject(new Error(reply.error)); else wait.resolve(null);
    } else {
      const ls = storeRecoveryLs(reply.marker, reply.payload);
      wait.resolve({ ...reply.result, marker: reply.marker, payload: reply.payload, dropped: reply.marker.dropped,
        ok: true, bytes: reply.payload.length, ms: reply.result?.ms ?? 0, idb: reply.result?.idb ?? false, ls,
        cmd: reply.cmd, fp: reply.fp!, changes: reply.changes ?? this.changes } satisfies SnapshotAck);
    }
  }

  receive(message: W2M): void {
    if (this.closed) return;
    if (message.t === 'fatal') { this.fail(new Error(message.message)); void this.dispose(); return; }
    if (message.t === 'ready') {
      if (this.hasReady) {
        for (const request of this.requests.values()) request.reject(new Error('Read interrupted by resync'));
        this.requests.clear(); this.queries.clear();
      }
      this.hasReady = true;
      // the worker's count: events in packets dropped by a resync must not leave dirty tracking behind for good
      if (message.changes !== undefined) this.changes = message.changes;
      this.replica.adopt(message); this.readiness.resolve(undefined); return;
    }
    if (message.t !== 'pkt') return;
    this.packet = message.p;
    if (message.p.clock.day < this.replica.clock.day) this.lastTime = message.p.clock.day;
    this.receivedAt = this.now();
    if (this.replica.apply(message.p)) {
      // the worker's count when the packet carries it (save and snapshot acks carry the same counter); else the log's
      this.changes = message.p.changes ?? this.changes + message.p.log.filter((e) => CHANGE_EVENTS.some((name) => EVENT_TYPES[name as keyof typeof EVENT_TYPES] === e[0])).length;
      this.publishPolicy(); this.options.onPacket?.(message.p);
    }
    this.packet = null;
  }
  private adopt(cmd: number): void {
    this.offViews();
    this.speedMirror = this.replica.clock.speed; this.receivedAt = this.now(); this.lastTime = this.replica.clock.day;
    this.controller?.pending.rebase(cmd);
    this.reapply(cmd); this.reapply(cmd, undefined, this.replica.policy);
    for (const b of this.state.buildings.values()) this.reapply(cmd, b);
    const offOverlay = attachOverlays(this.sim), versions = new WeakMap<RasterPatch, number>();
    let version = 0;
    const offSource = registerDerivedSource(this.state, (o, v) => {
      const r = this.replica.raster(o, v);
      if (!r) return null;
      let n = versions.get(r); if (n === undefined) versions.set(r, n = ++version);
      return { data: r.data, scale: r.scale, version: n };
    }, (o, v) => viewLayers({ overlay: o, variant: v, panels: [], focus: [] }).every((name) => this.replica.layerReady(name))
      && (o !== Overlay.Emergency || this.emergency.layersReady) && (o !== Overlay.Traffic || v !== 1 || this.traffic.truckVolume() !== null));
    this.offViews = () => { offSource(); offOverlay(); };
    // A snapshot cannot reconstruct lost results. Fail explicitly instead of leaving awaited UI work hanging.
    for (const [seq, ticket] of this.tickets) if (seq <= cmd) { ticket.reject(new Error('Command outcome lost during resync')); this.tickets.delete(seq); this.edits.delete(seq); this.controller?.pending.ack(seq); }
    for (const w of this.watches.values()) w.reset();
    this.publishPolicy();
  }
  private publishPolicy(): void {
    const p = this.replica.policy;
    if (JSON.stringify(p) === JSON.stringify(this.policyBefore)) return;
    this.policyBefore = copyOwned(p);
    for (const listener of this.policies.keys()) { try { listener(p); } catch (e) { this.report('policy', e); } }
  }
  protected report(key: string, error: unknown, title = key, sim = false): void {
    try { this.options.errors?.report(title, error, { key, sim }); } catch { /* a reporter cannot stop replay */ }
  }
  protected assertOpen(): void { if (this.closed) throw new Error('Simulation host is disposed'); }
  protected fail(error: unknown, report = true): void {
    this.readiness.reject(error);
    for (const ticket of this.tickets.values()) ticket.reject(error);
    for (const request of this.requests.values()) request.reject(error);
    this.tickets.clear(); this.requests.clear(); this.queries.clear(); this.edits.clear();
    if (report) this.report('host', error);
  }
  dispose(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.send({ t: 'dispose' }); this.closed = true;
    this.options.signal?.removeEventListener('abort', this.stop); this.abort.abort('dispose');
    this.fail(new Error('Simulation host is disposed'), false);
    for (const w of this.watches.values()) w.dispose();
    for (const off of this.policies.values()) off();
    this.gesture?.end(); this.controller?.dispose(); this.offViews(); this.events.clear();
    this.sender = null; this.outbox = []; this.sliders.clear(); this.queuedView = null;
    this.options = {};
    return Promise.resolve();
  }
}

export interface LoopbackSimHostOptions extends PacketHostOptions {
  loopback?: Omit<LoopbackOptions, 'receive' | 'replicaInstance' | 'signal' | 'persistence'>;
}
const ACTION_MODULES = import.meta.glob<{ HostActions: new (host: PacketSimHost) => PacketActions }>('./HostActions.ts', { eager: true });

export class LoopbackSimHost extends PacketSimHost {
  private loop: LoopbackCore | null = null;
  private starting: Promise<void> | null = null;
  private initial: CityState | null;
  constructor(state: CityState, private opts: LoopbackSimHostOptions = {}) {
    const speed = opts.initialSpeed ?? 1;
    const actions = ACTION_MODULES['./HostActions.ts'];
    super('loopback', { t: 'ready', snapshot: serializeCity(state, { copy: true }), streams: {}, policy: { alerts: [], live: false },
      clock: { day: state.day, frac: 0, speed, slow: 1, spd: SECONDS_PER_DAY[speed], live: true }, savedAt: 0, cmd: 0 },
      { ...opts, actions: opts.actions ?? (actions ? (host) => new actions.HostActions(host) : undefined) }, false);
    this.initial = this.closed ? null : state;
    if (this.closed) this.opts = {};
  }
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = (async () => {
      try {
        const [{ LoopbackCore }, { CityActions }] = await Promise.all([import('./loopbackCore'), import('../sim/actions')]);
        this.useOptimisticActions(CityActions);
        const flag = this.opts.flags?.simwasm;
        if (typeof window !== 'undefined' && flag != null && simWasmFlagSelects(flag, 'blur')) {
          try { await (await import('../wasm/browser')).initSimWasmBrowser({ flag }); }
          catch (e) { this.report('wasm', e, 'WASM kernels failed to load'); }
        }
        if (this.closed) return;
        this.loop = new LoopbackCore(this.initial!, { cadence: 'live', ...this.opts.loopback, initialSpeed: this.opts.initialSpeed,
          rctx: this.opts.rctx, flags: this.opts.flags, signal: this.opts.signal, persistence: this.opts.persistence,
          now: this.opts.now, replicaInstance: this.replica, receive: (m) => this.receive(m) });
        this.initial = null;
        this.connect((m) => this.loop?.post(m));
      } catch (e) { this.fail(e); throw e; }
    })();
    return this.starting;
  }
  /** Deterministic test/harness API; never exposes the authoritative state through SimHost.sim. */
  get harness(): LoopbackCore { if (!this.loop) throw new Error('Loopback host has not started'); return this.loop; }
  drain(): Promise<void> { this.flushCommands(); return this.harness.drain(); }
  override dispose(): Promise<void> {
    const done = super.dispose();
    this.loop?.dispose(); this.loop = null; this.initial = null; this.opts = {};
    return done;
  }
}
