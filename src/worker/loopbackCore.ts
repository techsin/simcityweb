/** W1.1a harness: W0.1's SimCore plus the clone-only protocol, with no command / query host yet. */
import type { RegionContext } from '../region/regionEffects';
import { CityActions } from '../sim/actions';
import type { CityState } from '../sim/CityState';
import { createSystems } from '../sim/systems';
import { SimCore, type SimErrors, type SimFlags, type SimModules } from './SimCore';
import { ChangeRecorder, type RecorderOptions } from './recorder';
import { Replica, type ReplicaHooks } from './replica';
import { cloneMessage, type M2W, type Packet, type Ready, type ViewState, type W2M } from './protocol';

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
}
export interface ProtocolTiming { flushMs: number; cloneMs: number; applyMs: number; packets: number }

export class LoopbackCore {
  readonly core: SimCore;
  readonly recorder: ChangeRecorder;
  readonly replica: Replica;
  readonly timing: ProtocolTiming = { flushMs: 0, cloneMs: 0, applyMs: 0, packets: 0 };
  private elapsedMs = 0;
  private tick = 0;
  private disposed = false;
  private readonly live: boolean;

  constructor(state: CityState, private opts: LoopbackOptions = {}) {
    this.live = opts.cadence === 'live';
    this.core = new SimCore(state, opts.errors, opts.flags);
    this.core.sim.speed = opts.initialSpeed ?? 1;
    this.core.boot(opts.rctx ?? null, opts.modules ?? { createSystems, CityActions });
    this.recorder = new ChangeRecorder(this.core.sim, { ...opts.recorder, now: () => this.elapsedMs });
    this.replica = new Replica(opts.replica);
    this.deliver(this.recorder.ready(0, this.live));
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
    this.flush();
  }
  setView(view: ViewState): void {
    this.assertOpen();
    const m = cloneMessage<M2W>({ t: 'view', v: view });
    if (m.t === 'view') this.recorder.setView(m.v);
  }
  flush(force = false, rollingCount?: number): Packet | null {
    this.assertOpen();
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
    const ready = this.recorder.ready(0, this.live);
    this.deliver(ready);
    return ready;
  }
  private deliver(message: W2M): W2M {
    let start = performance.now();
    const received = cloneMessage(message);
    this.timing.cloneMs += performance.now() - start;
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
  resetTiming(): void {
    this.timing.flushMs = 0; this.timing.cloneMs = 0; this.timing.applyMs = 0; this.timing.packets = 0;
    this.recorder.captureMs = 0;
  }
  private assertOpen(): void { if (this.disposed) throw new Error('Loopback core disposed'); }
  dispose(): void {
    if (this.disposed) return;
    cloneMessage<M2W>({ t: 'dispose' });
    this.recorder.dispose(); this.replica.events.clear(); this.core.dispose(); this.disposed = true;
  }
}
