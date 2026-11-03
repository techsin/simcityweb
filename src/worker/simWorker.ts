/**
 * The simulation isolate (W1.2): SimCore, the ChangeRecorder and T032's ProtocolInbox, paced by main's rAF ticks.
 * One frame-hook pass, one scheduler step or one day per task, with a post to self between (§3.1, WASM_PLAN finding 8),
 * so commands, reads and pongs run at those boundaries.
 * Persistence (W1.3, §4): with 'worker-idb' the worker reads the city from its own IndexedDB connection, keeps the
 * recovery base in this realm, writes its saves and snapshots there, and replays the journal bound to the save before
 * its Ready, then saves. With 'main' (R14; non-persistent stores and the boot fallback) saves and snapshots go to the
 * page, snapshots are deltas of the newest save the page has not refused, and the page passes the journal at init.
 */
// first: the worker isolate's protector probe predates every other module of the bundle (protectorProbe.ts)
import { WORKER_ISOLATE_PROBE, makeProtectorProbe } from './protectorProbe';
import { CityActions } from '../sim/actions';
import { createSystems } from '../sim/systems';
import type { DisastersSystem } from '../sim/infra/disasters';
import { schedulerOf } from '../sim/infra/scheduler';
import { deserializeCity } from '../save/serialize';
import { getCityRecord, getRecoveryBase, setRecoveryBase, type CityRecord } from '../save/cities';
import { openKV } from '../save/db';
import { initSimWasm, simWasmFlagSelects, simWasmStatus } from '../wasm/simWasm';
import { SimCore, type CitySaveCopy, type SimModules } from './SimCore';
import { ChangeRecorder } from './recorder';
import { ProtocolInbox, type InboxStore } from './protocolInbox';
import { idbStore } from './idbStore';
import { readBootJournal, type BootJournal } from './journal';
import { exactDigest } from './queries';
import { PROTOCOL_VERSION, assertOwnedBuffers, errorText, type Journal, type M2W, type Packet, type Reply } from './protocol';
import { ACK_WINDOW, IDB_UNAVAILABLE, sourceRecord, type SerializedSource, type SimWorkerScope, type WorkerDebugReport, type WorkerInit, type WorkerInput, type WorkerOutput } from './workerProtocol';

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

/** W1.3 (§4.2, §4.3): 'worker-idb' writes this realm's IndexedDB; the Ready names the save the worker loaded. */
class WorkerIdbStore implements InboxStore {
  private store: InboxStore;
  constructor(core: SimCore, private loaded: CityRecord, private nextUnit: () => Promise<void>) { this.store = idbStore(core); }
  get savedAt(): number { return getRecoveryBase(this.loaded.regionId, this.loaded.tileKey)?.savedAt ?? this.loaded.savedAt; }
  /** §4.2's two units: save:copy ran in the inbox's unit; save:put (the put's synchronous clone, about 10-15 ms at 1M)
   *  waits for the next unit to finish, so the worker never blocks for both at once and work queued meanwhile runs first */
  async putSave(copy: CitySaveCopy) { await this.nextUnit(); return this.store.putSave(copy); }
  /** the boot's save, before the Ready: no unit runs yet */
  bootSave(copy: CitySaveCopy) { return this.store.putSave(copy); }
  putSnapshot(snapshot: Parameters<InboxStore['putSnapshot']>[0]) { return this.store.putSnapshot(snapshot); }
  recoveryBase(regionId: string, tileKey: string) { return this.store.recoveryBase(regionId, tileKey); }
}

/** Also used by the node parentPort adapter; injected modules are for scheduler and error regression tests only. */
export function installSimWorker(scope: SimWorkerScope, modules: SimModules = { createSystems, CityActions }): { dispose(): void } {
  const abort = new AbortController(), loop = new MessageChannel(), inbox: WorkerInput[] = [];
  let core: SimCore | null = null, recorder: ChangeRecorder | null = null, protocol: ProtocolInbox | null = null;
  let store: MainStore | WorkerIdbStore | null = null, init: WorkerInit | null = null, booting = false, scheduled = false;
  /** ticks' summed dt since the last frame began: coalesced ticks run the hooks once, capped at 0.25 s (§3.1) */
  let pendingDt: number | null = null;
  let frame: { dt: number; stage: 'steps' | 'days'; days: number } | null = null;
  /** debug.runDays, deterministic mode: whole headless days, one per task; later FIFO work waits for its Ack */
  let run: { seq: number; left: number } | null = null;
  /** §2.10 backpressure: the last packet main acked, and the Readys sent (epoch) and adopted (confirmed) */
  let ack = 0, epoch = 1, confirmed = 1, flushWanted = false;
  /** posted packets main has not acked, with the replies they carried: a resync's Ready lists those as lost; with
   *  'worker-idb' the saves and snapshots were written here, so their replies go out again after it (`writes`) */
  let unacked: { seq: number; ids: number[]; saves: number[]; writes: Reply[] }[] = [];
  /** dev: this isolate's protector probe (§5.4, risk 7), read by debug.verify and once per frame (it is sticky) */
  let protector: (() => boolean) | null = null;
  /** W1.3: work that waits for the next unit to finish (a save's put, §4.2) */
  let afterUnit: (() => void)[] = [];
  const nextUnit = () => new Promise<void>((resolve) => { afterUnit.push(resolve); kick(); });

  function post(message: WorkerOutput): void {
    if (abort.signal.aborted) return;
    if (init?.flags.dev) assertOwnedBuffers(message); // §1.4
    scope.postMessage(message); // never a transfer list
  }
  function fatal(error: unknown): void {
    if (abort.signal.aborted) return;
    const code = (error as { code?: unknown } | null)?.code;
    try { post({ t: 'fatal', message: errorText(error), stack: error instanceof Error ? error.stack : undefined, ...(typeof code === 'string' ? { code } : {}) }); }
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
    // the probe sees only a detach that comes after it (natives syntax only): a browser worker's was made when the
    // bundle began to evaluate; elsewhere it is made now, before the city and the wasm loader
    if (m.flags?.dev) protector = WORKER_ISOLATE_PROBE ?? makeProtectorProbe();
    if (m.v !== PROTOCOL_VERSION) throw new Error(`Protocol version ${m.v}; this worker speaks ${PROTOCOL_VERSION}`);
    const idb = m.city?.kind === 'idb';
    if (idb ? m.persistence !== 'worker-idb' || m.journal : m.city?.kind !== 'serialized' || m.persistence !== 'main') {
      throw new Error('The worker boots an idb city with persistence worker-idb, or a serialized one with persistence main');
    }
    init = m;
    // §4.1 step 3: the worker's own connection, through the same openKV(); never a silent save into memory
    let record: CityRecord, kv: Awaited<ReturnType<typeof openKV>> | null = null;
    if (m.city.kind === 'idb') {
      post({ t: 'boot', phase: 'idb', pct: 0.05 });
      kv = await openKV();
      if (abort.signal.aborted) return;
      if (!kv.persistent) throw Object.assign(new Error('The simulation worker could not open IndexedDB'), { code: IDB_UNAVAILABLE });
      const rec = await getCityRecord(kv, m.city.regionId, m.city.tileKey);
      if (abort.signal.aborted) return;
      if (!rec) throw new Error('City record not found');
      record = rec;
    } else record = sourceRecord(m.city);
    post({ t: 'boot', phase: 'deserialize', pct: 0.1 });
    const st = deserializeCity(record.city);
    // only the worker realm keeps the recovery base: main holds no copy of the city (O6)
    if (idb) setRecoveryBase(record.regionId, record.tileKey, record.savedAt, record.city);
    const flag = m.flags.simwasm;
    if (!IN_NODE && flag != null && simWasmFlagSelects(flag, 'blur')) {
      post({ t: 'boot', phase: 'wasm', pct: 0.3 });
      // never rejects: the kernels stay on JS if it fails
      await initSimWasm(new URL('../wasm/sim_kernels.wasm', import.meta.url));
      if (abort.signal.aborted) return;
    }
    post({ t: 'boot', phase: 'systems', pct: 0.5 });
    const errors: [string, unknown, { key?: string; sim?: boolean } | undefined][] = [];
    // until the Ready: its recorder.ready() starts the packet stream afresh, so earlier replies would be dropped
    let readied = false;
    const c = core = new SimCore(st, { report: (title, e, details) => {
      if (protocol && readied) protocol.error(details?.key ?? title, title, e, details?.sim);
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
    const inboxStore = store = m.city.kind === 'idb' ? new WorkerIdbStore(c, record, nextUnit) : new MainStore(m.city);
    const p = { regionId: m.city.regionId, tileKey: m.city.tileKey, regionName: m.regionName };
    const inbox = protocol = new ProtocolInbox(c, recorder, {
      now: () => performance.now(), signal: abort.signal, store: inboxStore, fatal, persistence: p,
      // a save's boundary flushes at once; the rest go out with the batch of drained messages (§2.10)
      flush: (force) => { if (force) return flush(true); flushWanted = true; kick(); return null; },
    });
    // §4.3 Replay: the journal bound to the loaded save, after init and before the first tick. The worker reads its own
    // IndexedDB copy; with persistence 'main' the page passed it. `replay: false` boots the save as it is (§4.4).
    let carried: Journal | undefined;
    const journal: BootJournal | undefined = m.replay === false ? undefined : kv ? await readBootJournal(kv, record).catch((e) => {
      c.report('The recovery journal could not be read', e, { key: 'recovery' }); return undefined;
    }) : m.journal ? { journal: m.journal, base: { regionId: record.regionId, tileKey: record.tileKey, savedAt: record.savedAt } } : undefined;
    if (abort.signal.aborted) return;
    if (journal) {
      post({ t: 'boot', phase: 'journal', pct: 0.8 });
      const replayed = c.replayBootJournal(journal);
      if (replayed.applied && m.city.kind === 'idb') {
        // §4.3: saved before the Ready, so the replayed edits are durable and the old journal is deleted with the put
        try {
          await (inboxStore as WorkerIdbStore).bootSave(c.copySave(p.regionId, p.tileKey));
          inbox.changes = 0;
        } catch (e) {
          // the journal record still matches the old save: the Ready carries the edits, and a second crash loses nothing
          c.report('The recovered edits could not be saved', e, { key: 'recovery' });
          carried = replayed.carried;
        }
        if (abort.signal.aborted) return;
      } else carried = replayed.carried;
      // no save holds the carried edits: the city reads as unsaved even when none of them emits a change event (a tax)
      if (carried) inbox.changes += carried.ops.length;
    }
    post({ t: 'boot', phase: 'snapshot', pct: 0.9 });
    ready([], carried);
    readied = true;
    // reported by systems' init and the journal's replay before the Ready: they ride in the first packet
    for (const [title, e, details] of errors) protocol.error(details?.key ?? title, title, e, details?.sim);
  }

  function ready(lost: number[] = [], journal?: Journal): void {
    const r = recorder!.ready(protocol!.cmd, live());
    r.savedAt = store!.savedAt; r.changes = protocol!.changes;
    if (lost.length) r.lost = lost;
    if (journal) r.journal = journal;
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
      saves: replies.flatMap((r) => r.t === 'saved' && r.record ? [r.record.savedAt] : []),
      writes: store instanceof WorkerIdbStore ? replies.filter((r) => r.t === 'saved' || r.t === 'snapped') : [] });
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
    if (store instanceof WorkerIdbStore) {
      // W1.3, as the loopback (T033 decision 2): this worker wrote those saves and snapshots, so the page's journal must
      // rebind to them and a written save must not read as failed. Only reads are lost.
      const dropped = [...unacked.flatMap((u) => u.writes), ...pending.filter((r) => r.t === 'saved' || r.t === 'snapped')];
      const lost = [...unacked.flatMap((u) => u.ids), ...pending.flatMap((r) => r.t === 'error' ? [] : [r.id])]
        .filter((id) => !dropped.some((r) => r.t !== 'error' && r.id === id));
      unacked = []; ack = 0; epoch++; flushWanted = false;
      protocol!.resetWatches();
      ready(lost);
      for (const reply of dropped) recorder!.reply(reply);
      if (dropped.length) { flushWanted = true; kick(); }
      return;
    }
    const lost = [...unacked.flatMap((u) => u.ids), ...pending.flatMap((r) => r.t === 'error' ? [] : [r.id])];
    for (const savedAt of [...unacked.flatMap((u) => u.saves), ...pending.flatMap((r) => r.t === 'saved' && r.record ? [r.record.savedAt] : [])]) (store as MainStore).lost(savedAt);
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
      case 'stored':
        if (!(store instanceof MainStore)) throw new Error('stored is persistence main\'s');
        store.stored(m.savedAt, m.ok); return true;
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
      if (m.t === 'cmd' && m.op === 'debug.verify') { inbox.shift(); protocol.acknowledge(m.seq, debugReport()); continue; }
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
  /** debug.verify (§2.2; dev harnesses, tools/qa-worker.mjs): acked in the command sequence with what this isolate ran on */
  function debugReport(): WorkerDebugReport {
    const wasm = simWasmStatus();
    return { digest: exactDigest(core!.sim.state), protector: protector ? protector() : null, day: core!.sim.state.day,
      wasm: { state: wasm.state, blur: wasm.kernels.blur?.active ?? false, capacity: wasm.heap?.capacity ?? null,
        grows: wasm.heap?.grows ?? null, error: wasm.error } };
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
      protector?.();
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
    // their continuations run once this unit's task is done
    for (const resolve of afterUnit.splice(0)) resolve();
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
    inbox.length = 0; unacked = []; afterUnit = [];
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
