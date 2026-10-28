/**
 * The simulation isolate (W1.2): SimCore, the ChangeRecorder and T032's ProtocolInbox, paced by main's rAF ticks.
 * One frame-hook pass, one scheduler step or one day per task, with a post to self between (§3.1, WASM_PLAN finding 8),
 * so commands, reads and pongs run at those boundaries. Persistence 'main' (R14): saves and snapshots go to the page,
 * and snapshots are deltas of the newest save the page has not refused.
 */
import { CityActions } from '../sim/actions';
import { createSystems } from '../sim/systems';
import type { DisastersSystem } from '../sim/infra/disasters';
import { schedulerOf } from '../sim/infra/scheduler';
import { deserializeCity } from '../save/serialize';
import type { CityRecord } from '../save/cities';
import { initSimWasm, simWasmFlagSelects } from '../wasm/simWasm';
import { SimCore, type CitySaveCopy, type SimModules } from './SimCore';
import { ChangeRecorder } from './recorder';
import { ProtocolInbox, type InboxStore } from './protocolInbox';
import { PROTOCOL_VERSION, assertOwnedBuffers, errorText, type M2W, type Packet, type Reply } from './protocol';
import { ACK_WINDOW, sourceRecord, type SerializedSource, type SimWorkerScope, type WorkerInit, type WorkerInput, type WorkerOutput } from './workerProtocol';

const IN_NODE = typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === 'string';

/** R14's persistence 'main': a save hands its record to the page, which confirms the put ('stored'). Snapshots are deltas
 *  of the newest save handed over, as the inbox's own pending base; a refused put falls back to the confirmed one. */
class MainStore implements InboxStore {
  private base: CityRecord;
  private pending: CityRecord[] = [];
  constructor(source: SerializedSource) { this.base = sourceRecord(source); }
  get savedAt(): number { return this.base.savedAt; }
  putSave(copy: CitySaveCopy): Promise<{ record: CityRecord }> {
    this.pending.push(copy.record);
    return Promise.resolve({ record: copy.record });
  }
  /** the page stores the payload, and its acknowledgement says where */
  putSnapshot(): Promise<boolean> { return Promise.resolve(false); }
  recoveryBase(): CityRecord { return this.pending.at(-1) ?? this.base; }
  stored(savedAt: number, ok: boolean): void {
    const i = this.pending.findIndex((r) => r.savedAt === savedAt);
    if (i < 0) return;
    // the page stores saves in order: an earlier copy still pending was refused or lost in a resync
    if (ok) { this.base = this.pending[i]; this.pending.splice(0, i + 1); }
    else this.pending.splice(i, 1);
  }
  /** a resync dropped this save's reply, so the page never stores its record */
  lost(savedAt: number): void {
    const i = this.pending.findIndex((r) => r.savedAt === savedAt);
    if (i >= 0) this.pending.splice(i, 1);
  }
}

/** Also used by the node parentPort adapter; injected modules are for scheduler and error regression tests only. */
export function installSimWorker(scope: SimWorkerScope, modules: SimModules = { createSystems, CityActions }): { dispose(): void } {
  const abort = new AbortController(), loop = new MessageChannel(), inbox: WorkerInput[] = [];
  let core: SimCore | null = null, recorder: ChangeRecorder | null = null, protocol: ProtocolInbox | null = null;
  let store: MainStore | null = null, init: WorkerInit | null = null, booting = false, scheduled = false;
  /** ticks' summed dt since the last frame began: coalesced ticks run the hooks once, capped at 0.25 s (§3.1) */
  let pendingDt: number | null = null;
  let frame: { dt: number; stage: 'steps' | 'days'; days: number } | null = null;
  /** debug.runDays, deterministic mode: whole headless days, one per task; later FIFO work waits for its Ack */
  let run: { seq: number; left: number } | null = null;
  /** §2.10 backpressure: the last packet main acked, and the Readys sent (epoch) and adopted (confirmed) */
  let ack = 0, epoch = 1, confirmed = 1, flushWanted = false;
  /** posted packets main has not acked, with the replies they carried: a resync's Ready lists those as lost */
  let unacked: { seq: number; ids: number[]; saves: number[] }[] = [];

  function post(message: WorkerOutput): void {
    if (abort.signal.aborted) return;
    if (init?.flags.dev) assertOwnedBuffers(message); // §1.4
    scope.postMessage(message); // never a transfer list
  }
  function fatal(error: unknown): void {
    if (abort.signal.aborted) return;
    try { post({ t: 'fatal', message: errorText(error), stack: error instanceof Error ? error.stack : undefined }); }
    finally { dispose(); }
  }
  /** O7: the scheduler and disasters are told the mode; the 750 ms inference stays only for direct Simulation users */
  function setLive(live: boolean): void {
    schedulerOf(core!.sim).live = live;
    const disasters = core!.sim.getSystem<DisastersSystem>('disasters');
    if (disasters) disasters.live = live;
  }
  const live = () => !init!.deterministic && !run;

  async function boot(m: WorkerInit): Promise<void> {
    if (m.v !== PROTOCOL_VERSION) throw new Error(`Protocol version ${m.v}; this worker speaks ${PROTOCOL_VERSION}`);
    if (m.city?.kind !== 'serialized' || m.persistence !== 'main' || m.journal) throw new Error('W1.2 boots a serialized city with persistence main and no journal');
    init = m;
    post({ t: 'boot', phase: 'deserialize', pct: 0.1 });
    const st = deserializeCity(m.city.city);
    const flag = m.flags.simwasm;
    if (!IN_NODE && flag != null && simWasmFlagSelects(flag, 'blur')) {
      post({ t: 'boot', phase: 'wasm', pct: 0.3 });
      // never rejects: the kernels stay on JS if it fails
      await initSimWasm(new URL('../wasm/sim_kernels.wasm', import.meta.url));
      if (abort.signal.aborted) return;
    }
    post({ t: 'boot', phase: 'systems', pct: 0.5 });
    const errors: [string, unknown, { key?: string; sim?: boolean } | undefined][] = [];
    const c = core = new SimCore(st, { report: (title, e, details) => {
      if (protocol) protocol.error(details?.key ?? title, title, e, details?.sim);
      else errors.push([title, e, details]);
    } }, { simwasm: flag }, () => performance.now());
    c.sim.speed = m.initialSpeed;
    c.livePolicy.setSettings(m.settings);
    c.boot(m.rctx, modules);
    schedulerOf(c.sim).hostDriven = true;
    setLive(!m.deterministic);
    recorder = new ChangeRecorder(c.sim, { dev: m.flags.dev, signal: abort.signal, policy: () => {
      const { alerts, live, toast, warn } = c.livePolicy.view;
      return { alerts: alerts.map((a) => ({ ...a })), live, toast, warn };
    } });
    store = new MainStore(m.city);
    protocol = new ProtocolInbox(c, recorder, {
      now: () => performance.now(), signal: abort.signal, store, fatal,
      persistence: { regionId: m.city.regionId, tileKey: m.city.tileKey, regionName: m.regionName },
      // a save's boundary flushes at once; the rest go out with the batch of drained messages (§2.10)
      flush: (force) => { if (force) return flush(true); flushWanted = true; kick(); return null; },
    });
    post({ t: 'boot', phase: 'snapshot', pct: 0.9 });
    ready();
    // reported by systems' init before the inbox existed: they ride in the first packet
    for (const [title, e, details] of errors) protocol.error(details?.key ?? title, title, e, details?.sim);
  }

  function ready(lost: number[] = []): void {
    const r = recorder!.ready(protocol!.cmd, live());
    r.savedAt = store!.savedAt; r.changes = protocol!.changes;
    if (lost.length) r.lost = lost;
    post(r);
  }
  function flush(force = false): Packet | null {
    flushWanted = false;
    if (!recorder || !protocol) return null;
    // the recorder keeps merging (rect unions, latest arrays, the log) while main is behind
    if (recorder.sequence - ack > ACK_WINDOW) return null;
    const p = recorder.flush({ live: live(), force });
    if (!p) return null;
    p.changes = protocol.changes;
    const replies: Reply[] = p.replies ?? [];
    unacked.push({ seq: p.seq, ids: replies.flatMap((r) => r.t === 'error' ? [] : [r.id]),
      saves: replies.flatMap((r) => r.t === 'saved' && r.record ? [r.record.savedAt] : []) });
    post({ t: 'pkt', p });
    return p;
  }
  function acknowledge(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > recorder!.sequence) throw new Error(`Invalid packet acknowledgement ${value}`);
    if (value <= ack) return;
    const blocked = recorder!.sequence - ack > ACK_WINDOW;
    ack = value;
    while (unacked.length && unacked[0].seq <= ack) unacked.shift();
    if (blocked) { flushWanted = true; kick(); }
  }
  /** §2.10: main's replica diverged. Every reply main may have dropped is listed, so main rejects only those reads; the
   *  packet numbering restarts, and acks of the old numbering are ignored until main acks the new epoch. */
  function resync(): void {
    const pending = recorder!.pendingReplies;
    const lost = [...unacked.flatMap((u) => u.ids), ...pending.flatMap((r) => r.t === 'error' ? [] : [r.id])];
    for (const savedAt of [...unacked.flatMap((u) => u.saves), ...pending.flatMap((r) => r.t === 'saved' && r.record ? [r.record.savedAt] : [])]) store!.lost(savedAt);
    unacked = []; ack = 0; epoch++; flushWanted = false;
    protocol!.resetWatches();
    ready(lost);
  }

  /** Ticks only add dt and acks; the rest is not simulation work, so it runs at once, ahead of the FIFO. */
  function control(m: WorkerInput): boolean {
    switch (m.t) {
      case 'tick':
        if (!Number.isFinite(m.dt) || m.dt < 0) throw new Error('Invalid tick');
        if (confirmed === epoch) acknowledge(m.ack);
        if (!init!.deterministic) pendingDt = Math.min(0.25, (pendingDt ?? 0) + m.dt);
        return true;
      case 'ack':
        if (m.epoch < epoch) return true; // posted before a resync's Ready
        if (m.epoch > epoch) throw new Error(`Acknowledgement of epoch ${m.epoch}; the worker is at ${epoch}`);
        confirmed = epoch; acknowledge(m.ack);
        return true;
      case 'stored': store!.stored(m.savedAt, m.ok); return true;
      case 'ping': protocol!.handle(m); return true;
      case 'resync': resync(); return true;
      default: return false;
    }
  }
  function drain(): void {
    for (let i = 0; i < inbox.length;) {
      if (inbox[i].t === 'dispose') { dispose(); return; }
      if (protocol && control(inbox[i])) inbox.splice(i, 1);
      else i++;
    }
    // FIFO at this unit boundary: commands, reads, watches, views, saves and snapshots
    while (protocol && inbox.length && !run && !abort.signal.aborted) {
      const m = inbox[0] as M2W;
      if (m.t === 'init') throw new Error('Duplicate init');
      if (m.t === 'cmd' && m.op === 'debug.runDays') {
        if (frame) return; // the frame in progress finishes first: its scheduler steps are not headless
        inbox.shift(); startRun(m);
        continue;
      }
      inbox.shift(); protocol.handle(m);
    }
  }
  function startRun(m: Extract<M2W, { t: 'cmd' }>): void {
    const days = m.args[0];
    if (m.seq !== protocol!.cmd + 1) throw new Error(`Command gap: expected ${protocol!.cmd + 1}, got ${m.seq}`);
    if (!Number.isInteger(days) || (days as number) < 0) { protocol!.acknowledge(m.seq, { ok: false, commandError: 'Invalid day count' }); return; }
    run = { seq: m.seq, left: days as number };
    setLive(false);
    if (!run.left) finishRun();
  }
  function finishRun(): void {
    const seq = run!.seq;
    run = null;
    setLive(!init!.deterministic);
    protocol!.acknowledge(seq, core!.sim.state.day);
  }

  /** At most one unit of simulation work: a day of a run, a frame's hooks, one scheduler step, or one day. */
  function step(): 'day' | 'end' | 'hooks' | 'step' | null {
    const sim = core!.sim, scheduler = schedulerOf(sim);
    if (run) {
      sim.advanceDay(); protocol!.refresh();
      if (--run.left <= 0) finishRun();
      return 'day';
    }
    if (!frame) {
      if (pendingDt === null) return null;
      frame = { dt: pendingDt, stage: 'steps', days: 0 }; pendingDt = null;
      core!.livePolicy.tick(); sim.frameHooks(frame.dt); scheduler.beginFrame(sim);
      return 'hooks';
    }
    if (frame.stage === 'steps') {
      if (scheduler.stepOnce()) return 'step';
      scheduler.endFrame(); sim.accumulate(frame.dt); frame.stage = 'days';
    }
    // stepDay reads the speed again before every day, so a pause or a policy slowdown takes effect at once (§3.3)
    if (frame.days < sim.maxDaysPerFrame && sim.stepDay()) { frame.days++; protocol!.refresh(); return 'day'; }
    // as Simulation.update: a full frame caps the backlog, and maxDaysPerFrame 0 holds the calendar (NOTE-041)
    if (frame.days >= sim.maxDaysPerFrame) sim.capFrame();
    frame = null; protocol!.refresh();
    return 'end';
  }
  function unit(): void {
    scheduled = false;
    if (abort.signal.aborted) return;
    try {
      drain();
      if (abort.signal.aborted || !protocol) return;
      const kind = step();
      if (kind === 'day' || kind === 'end' || flushWanted) flush();
      if (run || frame || pendingDt !== null || inbox.length || flushWanted) kick();
    } catch (e) { fatal(e); }
  }
  function kick(): void {
    if (!scheduled && !abort.signal.aborted) { scheduled = true; loop.port2.postMessage(0); }
  }
  function receive(m: WorkerInput): void {
    if (abort.signal.aborted) return;
    if (m.t === 'init' && !init && !booting) {
      booting = true;
      void boot(m).then(() => { booting = false; kick(); }, fatal);
      return;
    }
    inbox.push(m); kick();
  }
  function dispose(): void {
    if (abort.signal.aborted) return;
    abort.abort('dispose');
    loop.port1.close(); loop.port2.close();
    if (core) { schedulerOf(core.sim).endFrame(); core.dispose(); core.sim.events.clear(); }
    core = null; recorder = null; protocol = null; store = null; run = null; frame = null;
    inbox.length = 0; unacked = [];
  }
  loop.port1.onmessage = unit;
  scope.listen(receive, fatal, abort.signal);
  post({ t: 'hello', v: PROTOCOL_VERSION });
  return { dispose };
}

// Browser entry; node tests install the same loop behind a parentPort adapter (tools/bench/worker/nodeWorker.ts).
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
  installSimWorker({
    postMessage: (m) => scope.postMessage(m),
    listen(receive, fail, signal) {
      scope.addEventListener('message', (e) => receive(e.data), { signal });
      scope.addEventListener('messageerror', () => fail(new Error('Worker messageerror')), { signal });
      scope.addEventListener('error', (e) => fail(e.error ?? new Error(e.message)), { signal });
      scope.addEventListener('unhandledrejection', (e) => fail(e.reason), { signal });
      // §4.4: the worker closes itself; main terminates it after at most 2 s
      signal.addEventListener('abort', () => scope.close(), { once: true });
    },
  });
}
