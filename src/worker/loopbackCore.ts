/** The clone-only protocol in one thread, retaining W1.1a's deterministic replica harness. */
import type { RegionContext } from '../region/regionEffects';
import { CityActions } from '../sim/actions';
import type { CityState } from '../sim/CityState';
import { createSystems } from '../sim/systems';
import { SimCore, type SimErrors, type SimFlags, type SimModules } from './SimCore';
import { ChangeRecorder, type RecorderOptions } from './recorder';
import { Replica, type ReplicaHooks } from './replica';
import { cloneMessage, copyOwned, type M2W, type Packet, type Ready, type ViewState, type W2M, type Reply } from './protocol';
import type { CityPersistence, Command } from './SimHost';
import { queryKey, type QueryArgs, type QueryName } from './queries';
import { CHANGE_EVENTS, cityFingerprint } from '../save/fingerprint';
import { getRecoveryBase } from '../save/cities';
import { buildRecoverySnapshot, LS_BUDGET_BYTES } from '../save/recoveryCodec';
import { openKV } from '../save/db';
import { storeRecoveryIdb } from '../save/recoveryIdb';

export interface LoopbackOptions {
  cadence?: 'design' | 'live';
  initialSpeed?: number;
  rctx?: RegionContext | null;
  flags?: SimFlags;
  errors?: SimErrors;
  modules?: SimModules;
  recorder?: Omit<RecorderOptions, 'now'>;
  replica?: ReplicaHooks;
  onPacket?: (packet: Packet, loopback: LoopbackCore) => void;
  /** Main-side packet plumbing can be shared with a real worker. */
  receive?: (message: W2M) => void;
  replicaInstance?: Replica;
  signal?: AbortSignal;
  persistence?: CityPersistence;
  now?: () => number;
  lag?: LagProfile;
}
export interface ProtocolTiming { flushMs: number; cloneMs: number; applyMs: number; packets: number }

/** Virtual transport time, never a busy wait or a change to simulation dt. */
export interface LagProfile { seed: number; packetTicks?: number; ackTicks?: number; longUnitChance?: number; unitMs?: readonly [number, number] }
export class SeededLag {
  private seed: number;
  constructor(readonly profile: LagProfile) { this.seed = profile.seed >>> 0; }
  random(): number { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 0x100000000; }
  packet(ack: boolean): number { return Math.floor(this.random() * ((this.profile.packetTicks ?? 6) + 1)) + (ack ? this.profile.ackTicks ?? 3 : 0); }
  unit(): number {
    if (this.random() >= (this.profile.longUnitChance ?? 0.1)) return 0;
    const [lo, hi] = this.profile.unitMs ?? [50, 150];
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }
}

type WatchRequest = Extract<M2W, { t: 'watch' }>;
interface CoreWatch {
  request: WatchRequest; at: number;
  cache: Map<string, { signature: string; at: number }>;
}

/** W1.1b: FIFO handlers shared with a worker inbox; scheduling remains the transport's responsibility. */
export class ProtocolInbox {
  cmd = 0;
  changes = 0;
  private watches = new Map<number, CoreWatch>();
  private errors = new Map<string, number>();
  constructor(readonly core: SimCore, readonly recorder: ChangeRecorder, private opts: {
    now(): number; flush(force?: boolean): Packet | null; signal: AbortSignal; persistence?: CityPersistence;
  }) {
    const offs = CHANGE_EVENTS.map((type) => core.sim.events.on(type, () => { this.changes++; }));
    opts.signal.addEventListener('abort', () => { for (const off of offs) off(); this.watches.clear(); }, { once: true });
  }

  handle(message: M2W): void | Promise<void> {
    const m = message;
    switch (m.t) {
      case 'cmd': {
        if (m.seq !== this.cmd + 1) throw new Error(`Command gap: expected ${this.cmd + 1}, got ${m.seq}`);
        if (m.atDay !== undefined && m.atDay !== this.core.sim.state.day) throw new Error('atDay requires a deterministic day boundary');
        this.recorder.cause = m.seq;
        let result: unknown;
        try {
          if (m.op.startsWith('debug.')) throw new Error('Debug units belong to the worker scheduler');
          if (!this.core.actions) throw new Error('City actions are unavailable');
          result = this.core.applyCommand({ op: m.op, args: m.args } as unknown as Command, this.core.actions);
        } catch (e) {
          result = { ok: false, commandError: String(e) };
          this.error(`command:${m.op}`, `Command “${m.op}” failed`, e);
        } finally { this.recorder.cause = undefined; }
        this.cmd = m.seq;
        this.recorder.ack(m.seq, result);
        this.refresh(); this.opts.flush();
        return;
      }
      case 'query':
        try { this.recorder.reply({ t: 'qres', id: m.id, cmd: this.cmd, ok: true, value: copyOwned(this.core.runQuery(m.name, m.args as QueryArgs<QueryName>)) }); }
        catch (e) {
          this.recorder.reply({ t: 'qres', id: m.id, cmd: this.cmd, ok: false, error: String(e) });
          this.error(`query:${m.name}`, `Query “${m.name}” failed`, e);
        }
        this.opts.flush(); return;
      case 'watch': {
        const old = this.watches.get(m.id);
        this.watches.set(m.id, old ? { ...old, request: m } : { request: m, at: -Infinity, cache: new Map() });
        this.refresh(); this.opts.flush(); return;
      }
      case 'unwatch': this.watches.delete(m.id); return;
      case 'view': this.recorder.setView(m.v); this.opts.flush(); return;
      case 'ping': this.recorder.ping(m.n); this.opts.flush(); return;
      case 'save': return this.save(m);
      case 'snapshot': return this.snapshot(m);
      default: throw new Error(`Transport must handle ${m.t}`);
    }
  }

  refresh(): void {
    const now = this.opts.now();
    for (const w of this.watches.values()) {
      const m = w.request, key = queryKey(m.args), cached = w.cache.get(key);
      const interval = m.name === 'inspectBuilding' || m.name === 'inspectCell' ? 1000 : 200;
      if (now - w.at < 200 || (cached && now - cached.at < interval)) continue;
      const args = m.args as QueryArgs<QueryName>;
      const signature = this.core.querySignature(m.name, args, m.when, this.cmd);
      if (cached?.signature === signature) continue;
      w.at = now;
      try { this.recorder.watch({ id: m.id, key, cmd: this.cmd, value: copyOwned(this.core.runQuery(m.name, args)) }); }
      catch (e) {
        this.recorder.watch({ id: m.id, key, cmd: this.cmd, error: String(e) });
        this.error(`query:${m.name}`, `Watch “${m.name}” failed`, e);
      }
      w.cache.delete(key); w.cache.set(key, { signature, at: now });
      if (w.cache.size > 64) w.cache.delete(w.cache.keys().next().value!);
    }
  }
  resetWatches(): void { for (const w of this.watches.values()) { w.cache.clear(); w.at = -Infinity; } }

  error(key: string, title: string, e: unknown, sim = false): void {
    const now = this.opts.now(), disabled = title.includes('disabled');
    if (!disabled && now - (this.errors.get(key) ?? -Infinity) < 1000) return;
    this.errors.set(key, now);
    this.recorder.reply({ t: 'error', cmd: this.cmd, key, title, message: String(e), stack: e instanceof Error ? e.stack : undefined, sim, ...(disabled ? { disabled: true } : {}) });
  }

  private async save(m: Extract<M2W, { t: 'save' }>): Promise<void> {
    const cmd = this.cmd;
    try {
      const p = this.opts.persistence;
      if (!p) throw new Error('City persistence is not configured');
      const copy = this.core.copySave(p.regionId, p.tileKey), changes = this.changes;
      const boundary = this.opts.flush(true);
      const pktSeq = boundary?.seq ?? this.recorder.sequence + 1;
      const recoveryDropped = await this.core.putSave(copy);
      if (this.opts.signal.aborted) return;
      this.recorder.reply({ t: 'saved', id: m.id, cmd, ok: true, savedAt: copy.record.savedAt, fp: copy.fp, summary: copy.summary, pktSeq, changes, recoveryDropped });
    } catch (e) {
      if (this.opts.signal.aborted) return;
      this.recorder.reply({ t: 'saved', id: m.id, cmd, ok: false, error: String(e) });
    }
    this.opts.flush();
  }

  private async snapshot(m: Extract<M2W, { t: 'snapshot' }>): Promise<void> {
    const cmd = this.cmd, p = this.opts.persistence;
    try {
      if (!p) { this.recorder.reply({ t: 'snapped', id: m.id, cmd, ok: false }); this.opts.flush(); return; }
      const start = performance.now(), st = this.core.sim.state;
      const snapshot = buildRecoverySnapshot(p.regionId, p.tileKey, st, getRecoveryBase(p.regionId, p.tileKey), {
        cityName: st.config.name, regionName: p.regionName, population: st.stats.population, funds: st.funds,
        why: m.why, lean: m.why === 'periodic', at: Date.now(),
      }, LS_BUDGET_BYTES - 128 * 1024); // W0.6's journal reserve, without importing the localStorage module.
      const fp = cityFingerprint(st), changes = this.changes;
      const kv = await openKV();
      await storeRecoveryIdb(kv, snapshot.marker, snapshot.payload);
      if (this.opts.signal.aborted) return;
      this.recorder.reply({ t: 'snapped', id: m.id, cmd, ...snapshot, fp, changes,
        result: { ok: true, bytes: snapshot.payload.length, ls: false, idb: kv.persistent, dropped: snapshot.dropped, ms: performance.now() - start } });
    } catch (e) {
      if (this.opts.signal.aborted) return;
      this.recorder.reply({ t: 'snapped', id: m.id, cmd, ok: false, error: String(e) });
    }
    this.opts.flush();
  }
}

export class LoopbackCore {
  readonly core: SimCore;
  readonly recorder: ChangeRecorder;
  readonly replica: Replica;
  readonly timing: ProtocolTiming = { flushMs: 0, cloneMs: 0, applyMs: 0, packets: 0 };
  private elapsedMs = 0;
  private tick = 0;
  private disposed = false;
  private readonly live: boolean;
  readonly inbox: ProtocolInbox;
  private abort = new AbortController();
  private queue: M2W[] = [];
  private outgoing: { at: number; message: W2M }[] = [];
  private processing: Promise<void> | null = null;
  private scheduled = false;
  private busyUntil = 0;
  private transportTick = 0;
  private lag: SeededLag | null;
  private acked = 0;
  private stop = () => this.dispose();

  constructor(state: CityState, private opts: LoopbackOptions = {}) {
    this.live = opts.cadence === 'live';
    this.lag = opts.lag ? new SeededLag(opts.lag) : null;
    const bootErrors: Reply[] = [];
    this.core = new SimCore(state, { report: (title, e, details) => {
      if (!opts.receive) opts.errors?.report(title, e, details);
      if (this.inbox) { this.inbox.error(details?.key ?? title, title, e, details?.sim); return; }
      const reply: Reply = { t: 'error', cmd: 0, key: details?.key ?? title, title, message: String(e), sim: details?.sim ?? false };
      if (this.recorder) this.recorder.reply(reply); else bootErrors.push(reply);
    } }, opts.flags);
    this.core.sim.speed = opts.initialSpeed ?? 1;
    this.core.boot(opts.rctx ?? null, opts.modules ?? { createSystems, CityActions });
    this.recorder = new ChangeRecorder(this.core.sim, { policy: () => {
      const { alerts, live, toast, warn } = this.core.livePolicy.view;
      return { alerts: alerts.map((a) => ({ ...a })), live, toast, warn };
    }, ...opts.recorder, now: () => this.now(), signal: this.abort.signal });
    this.replica = opts.replicaInstance ?? new Replica(opts.replica);
    this.inbox = new ProtocolInbox(this.core, this.recorder, { now: () => this.now(), flush: (force) => this.flush(force), signal: this.abort.signal, persistence: opts.persistence });
    this.deliver(this.ready());
    for (const reply of bootErrors) this.recorder.reply(reply);
    opts.signal?.addEventListener('abort', this.stop, { once: true });
    if (opts.signal?.aborted) this.dispose();
  }
  private now(): number { return this.opts.now?.() ?? this.elapsedMs; }
  private ready(): Ready {
    const ready = this.recorder.ready(this.inbox.cmd, this.live), p = this.opts.persistence;
    if (p) ready.savedAt = getRecoveryBase(p.regionId, p.tileKey)?.savedAt ?? 0;
    return ready;
  }
  get state(): CityState { return this.replica.state; }
  get primary(): CityState { return this.core.sim.state; }
  /** Harness clock used to verify the recorder's 4-per-second group throttle independently. */
  get elapsedTimeMs(): number { return this.elapsedMs; }

  runDays(n: number): void {
    this.assertOpen();
    if (this.live) throw new Error('Use frame() for live cadence; W0.1 has no explicit mode switch');
    if (!Number.isInteger(n) || n < 0) throw new Error('Invalid day count');
    for (let i = 0; i < n; i++) {
      // Design cadence has no real-time throttle pressure: one completed day and packet per step.
      this.elapsedMs += 250;
      this.core.sim.advanceDay();
      this.inbox.refresh();
      this.flush();
    }
  }
  frame(dt: number): void {
    this.assertOpen();
    if (!this.live) throw new Error('Use runDays() for design cadence');
    const m = cloneMessage<M2W>({ t: 'tick', seq: ++this.tick, dt, ack: this.replica.seq });
    if (m.t !== 'tick' || !Number.isFinite(m.dt) || m.dt < 0) throw new Error('Invalid tick');
    this.elapsedMs += m.dt * 1000;
    // beginTick / nextUnit and explicit live mode are not present in W0.1. Do not emulate that scheduler here.
    this.core.frame(m.dt);
    this.inbox.refresh();
    this.flush();
  }
  setView(view: ViewState): void {
    this.assertOpen();
    const m = cloneMessage<M2W>({ t: 'view', v: view });
    if (m.t === 'view') this.recorder.setView(m.v);
  }
  flush(force = false, rollingCount?: number): Packet | null {
    this.assertOpen();
    if (this.opts.receive && this.recorder.sequence - this.acked > 4) return null;
    const start = performance.now();
    const packet = this.recorder.flush({ live: this.live, force, rollingCount });
    this.timing.flushMs += performance.now() - start;
    if (!packet) return null;
    const message = this.deliver({ t: 'pkt', p: packet });
    return message.t === 'pkt' ? message.p : null;
  }
  /** No sim time passes; each existing building is checked once against the R2 shadow. */
  forceRollingRound(): void {
    const count = Math.max(1, this.opts.recorder?.rollingCount ?? 512);
    for (let i = 0; i < Math.max(1, Math.ceil(this.primary.buildings.size / count)); i++) {
      this.elapsedMs += 250;
      this.flush(true, count);
    }
  }
  resync(): Ready {
    this.assertOpen();
    cloneMessage<M2W>({ t: 'resync' });
    this.outgoing = []; this.acked = 0;
    this.inbox.resetWatches();
    const ready = this.ready();
    this.deliver(ready);
    return ready;
  }
  private deliver(message: W2M): W2M {
    let start = performance.now();
    const received = cloneMessage(message);
    this.timing.cloneMs += performance.now() - start;
    if (this.opts.receive) {
      const delay = received.t === 'pkt' ? this.lag?.packet(!!received.p.acks?.length) ?? 0 : 0;
      const at = Math.max(this.transportTick + delay, this.outgoing.at(-1)?.at ?? 0);
      this.outgoing.push({ at, message: received });
      this.deliverDue();
      return received;
    }
    start = performance.now();
    if (received.t === 'ready') this.replica.adopt(received);
    else if (received.t === 'pkt') {
      if (!this.replica.apply(received.p)) throw new Error('Loopback replica diverged; resync required');
      this.timing.applyMs += performance.now() - start;
      this.timing.packets++;
      this.opts.onPacket?.(received.p, this);
    }
    return received;
  }
  /** Posting never runs a command inline: HostActions must register its reservation before Ack replay. */
  post(message: M2W): void {
    this.assertOpen();
    const received = cloneMessage(message);
    if (received.t === 'tick') {
      this.acked = Math.max(this.acked, received.ack);
      this.advanceTransport(received.dt * 1000);
    }
    this.queue.push(received);
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => { this.scheduled = false; if (!this.disposed) void this.pump(); });
    }
  }
  advanceTransport(ms = 16): void {
    this.transportTick++; this.elapsedMs += ms;
    this.deliverDue();
    if (!this.disposed) void this.pump();
  }
  private deliverDue(force = false): void {
    while (!this.disposed && this.outgoing.length && (force || this.outgoing[0].at <= this.transportTick)) {
      const message = this.outgoing.shift()!.message;
      this.opts.receive!(message);
      if (message.t === 'pkt') {
        this.timing.packets++;
        this.opts.onPacket?.(message.p, this);
      }
    }
  }
  private pump(force = false): Promise<void> {
    if (this.processing) return this.processing;
    const run = async () => {
      while (!this.disposed && this.queue.length && (force || this.elapsedMs >= this.busyUntil)) {
        const m = this.queue.shift()!;
        if (m.t === 'tick') {
          if (this.live) this.core.frame(m.dt);
          this.inbox.refresh(); this.flush();
        } else if (m.t === 'resync') this.resync();
        else if (m.t === 'dispose') this.dispose();
        else {
          const waiting = this.inbox.handle(m);
          if (waiting) await waiting;
        }
        this.busyUntil = this.elapsedMs + (this.lag?.unit() ?? 0);
      }
    };
    this.processing = run().catch((e) => {
      if (!this.disposed) this.deliver({ t: 'fatal', message: String(e), stack: e instanceof Error ? e.stack : undefined });
    }).finally(() => {
      this.processing = null;
      if (!this.disposed && this.queue.length && this.elapsedMs >= this.busyUntil) queueMicrotask(() => { if (!this.disposed) void this.pump(); });
    });
    return this.processing;
  }
  /** Test/harness barrier: finish FIFO work and deliveries, without advancing a simulated day. */
  async drain(): Promise<void> {
    this.assertOpen();
    await this.processing;
    do {
      this.deliverDue(true); this.acked = this.replica.seq;
      await this.pump(true);
      this.deliverDue(true); this.acked = this.replica.seq;
      this.flush(); this.deliverDue(true); this.acked = this.replica.seq;
    } while (this.queue.length || this.outgoing.length);
  }
  resetTiming(): void {
    this.timing.flushMs = 0; this.timing.cloneMs = 0; this.timing.applyMs = 0; this.timing.packets = 0;
    this.recorder.captureMs = 0;
  }
  private assertOpen(): void { if (this.disposed) throw new Error('Loopback core disposed'); }
  dispose(): void {
    if (this.disposed) return;
    cloneMessage<M2W>({ t: 'dispose' });
    this.disposed = true;
    this.opts.signal?.removeEventListener('abort', this.stop);
    this.abort.abort('dispose');
    this.queue = []; this.outgoing = [];
    this.recorder.dispose(); this.replica.events.clear(); this.core.dispose();
  }
}
