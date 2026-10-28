/** The clone-only protocol in one thread, retaining W1.1a's deterministic replica harness. */
import type { RegionContext } from '../region/regionEffects';
import { CityActions } from '../sim/actions';
import type { CityState } from '../sim/CityState';
import { createSystems } from '../sim/systems';
import { SimCore, type SimErrors, type SimFlags, type SimModules } from './SimCore';
import { ChangeRecorder, type RecorderOptions } from './recorder';
import { Replica, type ReplicaHooks } from './replica';
import { cloneMessage, errorText, type M2W, type Packet, type Ready, type ViewState, type W2M, type Reply } from './protocol';
import type { CityPersistence } from './SimHost';
import { SeededLag, type LagProfile } from './lag';
import { ProtocolInbox, type InboxStore } from './protocolInbox';
import { getRecoveryBase } from '../save/cities';
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

/** The loopback writes IndexedDB itself, as LocalSimHost does (and the worker will, in W1.3). */
function idbStore(core: SimCore): InboxStore {
  return {
    putSave: async (copy) => ({ recoveryDropped: await core.putSave(copy) }),
    putSnapshot: async ({ marker, payload }) => { const kv = await openKV(); await storeRecoveryIdb(kv, marker, payload); return kv.persistent; },
    recoveryBase: getRecoveryBase,
  };
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
  /** the traffic layers as last sent: a traffic pass writes them one step before it announces them (F6) */
  private sentRoad = { traffic: new Float32Array(0), congestion: new Float32Array(0) };
  private stop = () => this.dispose();

  constructor(state: CityState, private opts: LoopbackOptions = {}) {
    this.live = opts.cadence === 'live';
    this.lag = opts.lag ? new SeededLag(opts.lag) : null;
    const bootErrors: Reply[] = [];
    this.core = new SimCore(state, { report: (title, e, details) => {
      if (!opts.receive) opts.errors?.report(title, e, details);
      if (this.inbox) { this.inbox.error(details?.key ?? title, title, e, details?.sim); return; }
      const reply: Reply = { t: 'error', cmd: 0, key: details?.key ?? title, title, message: errorText(e), stack: e instanceof Error ? e.stack : undefined, sim: details?.sim ?? false };
      if (this.recorder) this.recorder.reply(reply); else bootErrors.push(reply);
    } }, opts.flags, () => this.now());
    this.core.sim.speed = opts.initialSpeed ?? 1;
    this.core.boot(opts.rctx ?? null, opts.modules ?? { createSystems, CityActions });
    this.recorder = new ChangeRecorder(this.core.sim, { policy: () => {
      const { alerts, live, toast, warn } = this.core.livePolicy.view;
      return { alerts: alerts.map((a) => ({ ...a })), live, toast, warn };
    }, ...opts.recorder, now: () => this.now(), signal: this.abort.signal });
    this.replica = opts.replicaInstance ?? new Replica(opts.replica);
    this.inbox = new ProtocolInbox(this.core, this.recorder, { now: () => this.now(), flush: (force) => this.flush(force),
      signal: this.abort.signal, persistence: opts.persistence, store: idbStore(this.core), fatal: (e) => this.fatal(e) });
    this.deliver(this.ready());
    for (const reply of bootErrors) this.recorder.reply(reply);
    opts.signal?.addEventListener('abort', this.stop, { once: true });
    if (opts.signal?.aborted) this.dispose();
  }
  private now(): number { return this.opts.now?.() ?? this.elapsedMs; }
  private ready(): Ready {
    const ready = this.recorder.ready(this.inbox.cmd, this.live), p = this.opts.persistence;
    if (p) ready.savedAt = getRecoveryBase(p.regionId, p.tileKey)?.savedAt ?? 0;
    ready.changes = this.inbox.changes;
    this.sentRoad = { traffic: this.primary.traffic.slice(), congestion: this.primary.congestion.slice() };
    return ready;
  }
  get state(): CityState { return this.replica.state; }
  get primary(): CityState { return this.core.sim.state; }
  /** The authoritative state as the replica should see it: the live state, with the utilities and traffic layers as
   *  last sent (a pass in flight has written them but not yet announced them). For the harness's comparisons. */
  get delivered(): CityState {
    const sent = this.recorder.sentUtilities(), st = this.primary;
    return Object.assign(Object.create(st) as CityState, { powered: sent.powered ?? st.powered, watered: sent.watered ?? st.watered,
      traffic: this.sentRoad.traffic, congestion: this.sentRoad.congestion });
  }
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
    // §2.10's backpressure, measured on this transport: packets still in flight. Main applies a packet as it arrives,
    // and its acks ride on ticks, which stop with the tab hidden while the hidden path's save reply must still go out.
    if (this.opts.receive && this.inFlight() > 4) return null;
    const start = performance.now();
    const packet = this.recorder.flush({ live: this.live, force, rollingCount });
    this.timing.flushMs += performance.now() - start;
    if (!packet) return null;
    packet.changes = this.inbox.changes;
    for (const patch of packet.layers ?? []) if (patch.name === 'traffic' || patch.name === 'congestion') this.sentRoad[patch.name].set(this.primary[patch.name]);
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
    // replies in packets still in flight, and those not yet flushed, are lost with them: main rejects only these reads
    const lost = [...this.outgoing.flatMap((o) => o.message.t === 'pkt' ? o.message.p.replies ?? [] : []), ...this.recorder.pendingReplies]
      .flatMap((r) => r.t === 'error' ? [] : [r.id]);
    this.outgoing = [];
    this.inbox.resetWatches();
    const ready = this.ready();
    if (lost.length) ready.lost = lost;
    this.deliver(ready);
    return ready;
  }
  private inFlight(): number {
    let n = 0;
    for (const o of this.outgoing) if (o.message.t === 'pkt') n++;
    return n;
  }
  private fatal(e: unknown): void {
    if (!this.disposed) this.deliver({ t: 'fatal', message: errorText(e), stack: e instanceof Error ? e.stack : undefined });
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
    if (received.t === 'tick') this.advanceTransport(received.dt * 1000);
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
        else this.inbox.handle(m);
        this.busyUntil = this.elapsedMs + (this.lag?.unit() ?? 0);
      }
    };
    this.processing = run().catch((e) => this.fatal(e)).finally(() => {
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
      this.deliverDue(true);
      await this.pump(true);
      await this.inbox.idle; // saves and snapshots reply when their writes settle
      this.deliverDue(true);
      this.flush(); this.deliverDue(true);
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
