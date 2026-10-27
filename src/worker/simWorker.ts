/** Authoritative simulation isolate. rAF supplies time; self-posts only finish already requested work. */
import { CityActions } from '../sim/actions';
import { createSystems } from '../sim/systems';
import type { DisastersSystem } from '../sim/infra/disasters';
import { schedulerOf } from '../sim/infra/scheduler';
import { deserializeCity } from '../save/serialize';
import { buildRecoverySnapshot } from '../save/recoveryCodec';
import type { CityRecord } from '../save/cities';
import { CHANGE_EVENTS, cityFingerprint } from '../save/fingerprint';
import { applySimWasmFlag, initSimWasm, simWasmFlagSelects } from '../wasm/simWasm';
import { SimCore, type SimModules } from './SimCore';
import { ChangeRecorder } from './recorder';
import { PROTOCOL_VERSION, EntryType, assertOwnedBuffers, encodeAck, type Packet, type PolicyState } from './protocol';
import { queryKey } from './queries';
import { sourceRecord, type SimWorkerScope, type WorkerInit, type WorkerInput, type WorkerOutput, type WorkerPacket, type WorkerReply } from './workerProtocol';

const IN_NODE = typeof (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node === 'string';
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);
type Watch = Extract<WorkerInput, { t: 'watch' }> & { at: number; signature: string };

/** Also used by the parentPort adapter; injected modules are for scheduler/error regression tests only. */
export function installSimWorker(scope: SimWorkerScope, modules: SimModules = { createSystems, CityActions }): { dispose(): void } {
  const abort = new AbortController(), loop = new MessageChannel();
  let core: SimCore | null = null, recorder: ChangeRecorder | null = null, init: Omit<WorkerInit, 'city'> | null = null;
  let base: CityRecord | null = null, scheduled = false, booting = false;
  let epoch = 0, seq = 0, ack = 0, cmd = 0, tick = 0, adoptedThrough = 0, pong: number | undefined;
  let changes = 0, pendingDt: number | null = null, frame: 'hooks' | 'steps' | 'days' | null = null, frameDt = 0, frameDays = 0;
  let run: { id: number; remaining: number; live: boolean } | null = null;
  const inbox: WorkerInput[] = [], watches = new Map<number, Watch>();
  const copies = new Map<number, CityRecord>(), settled = new Map<number, unknown>();
  const sent = new Map<number, { commands: number[]; replies: WorkerReply[] }>();
  const errors = new Map<string, number>();
  let replies: WorkerReply[] = [], acks: unknown[] = [], persistenceUnit = false;
  const units: Record<string, number> = {};
  const startedAt = performance.now();
  let busyMs = 0, dayMs = 0, statsAt = -Infinity;

  function post(message: WorkerOutput): void {
    if (abort.signal.aborted) return;
    assertOwnedBuffers(message);
    scope.postMessage(message);
  }
  function fatal(error: unknown): void {
    if (abort.signal.aborted) return;
    try { post({ t: 'fatal', message: errorText(error), ...(error instanceof Error ? { stack: error.stack } : {}) }); }
    finally { dispose(); }
  }
  function report(title: string, error: unknown, opts: { key?: string; sim?: boolean } = {}): void {
    const key = opts.key ?? title, now = performance.now();
    if (!title.endsWith('— disabled') && now - (errors.get(key) ?? -Infinity) < 1000) return;
    errors.set(key, now);
    replies.push({ t: 'error', key, title, message: errorText(error), sim: opts.sim ?? false,
      ...(error instanceof Error ? { stack: error.stack } : {}), ...(title.endsWith('— disabled') ? { disabled: true } : {}) });
    kick();
  }
  function setLive(live: boolean): void {
    if (!core) return;
    schedulerOf(core.sim).live = live;
    const disasters = core.sim.getSystem<DisastersSystem>('disasters');
    if (disasters) disasters.live = live;
  }
  function ready(): void {
    const r = recorder!.ready(cmd, !init!.deterministic);
    // A resync cannot strand a ticket or a reply whose packet was lost.
    replies = [...sent.values()].flatMap((p) => p.replies).concat(replies);
    sent.clear(); acks = []; seq = ack = 0; epoch++; adoptedThrough = cmd;
    post({ ...r, savedAt: base!.savedAt, epoch, changes, settled: [...settled].map(([seq, result]) => ({ seq, result })) });
  }
  async function boot(message: WorkerInit): Promise<void> {
    if (init || message.v !== PROTOCOL_VERSION) throw new Error('Worker protocol version mismatch or duplicate init');
    if (message.persistence !== 'main' || message.city.kind !== 'serialized' || 'journal' in message) throw new Error('W1.2 requires serialized city, main persistence and no journal');
    const { city: _city, ...options } = message;
    init = options;
    base = sourceRecord(message.city);
    post({ t: 'boot', phase: 'deserialize', pct: 0 });
    const st = deserializeCity(message.city.city);
    post({ t: 'boot', phase: 'wasm', pct: 0.25 });
    const flag = message.flags.simwasm;
    if (flag !== null) applySimWasmFlag(flag);
    if (!IN_NODE && flag !== null && simWasmFlagSelects(flag, 'blur')) {
      await initSimWasm(new URL('../wasm/sim_kernels.wasm', import.meta.url));
    }
    if (abort.signal.aborted) return;
    post({ t: 'boot', phase: 'systems', pct: 0.5 });
    core = new SimCore(st, { report }, { simwasm: flag });
    core.sim.speed = message.initialSpeed;
    core.livePolicy.setSettings(message.settings);
    core.boot(message.rctx, modules);
    if (!core.actions) throw new Error('Worker CityActions failed to boot');
    schedulerOf(core.sim).hostDriven = true;
    setLive(!message.deterministic);
    recorder = new ChangeRecorder(core.sim, { dev: message.flags.dev, policy: () => {
      const p = core!.livePolicy.view;
      return { alerts: p.alerts.map((a) => ({ ...a })), live: p.live, toast: p.toast, warn: p.warn };
    } });
    const offChanges = CHANGE_EVENTS.map((type) => core!.sim.events.on(type, () => { changes++; }));
    abort.signal.addEventListener('abort', () => { for (const off of offChanges) off(); }, { once: true });
    post({ t: 'boot', phase: 'snapshot', pct: 0.9 });
    ready();
  }
  function acknowledge(value: number, generation: number): void {
    if (generation !== epoch) return;
    if (!Number.isInteger(value) || value < 0 || value > seq) throw new Error('Invalid packet acknowledgement');
    ack = Math.max(ack, value);
    for (const n of settled.keys()) if (n <= adoptedThrough) settled.delete(n);
    for (const [s, p] of sent) if (s <= ack) {
      for (const n of p.commands) settled.delete(n);
      sent.delete(s);
    }
  }
  function command(message: Extract<WorkerInput, { t: 'cmd' }>): void {
    if (message.seq !== cmd + 1) throw new Error('Command sequence gap');
    recorder!.cause = message.seq;
    let result: unknown;
    try { result = encodeAck(core!.applyCommand(message, core!.actions!)); }
    finally { recorder!.cause = undefined; }
    cmd = message.seq;
    settled.set(cmd, result);
    recorder!.append([EntryType.Ack, core!.sim.state.day, acks.length, cmd]);
    acks.push(result);
  }
  function receive(message: WorkerInput): void {
    if (abort.signal.aborted) return;
    inbox.push(message); kick();
  }
  function drain(): void {
    // Control messages keep a bounded run/save barrier alive without overtaking simulation reads or writes.
    for (let i = 0; i < inbox.length;) {
      const m = inbox[i];
      if (m.t === 'dispose') { dispose(); return; }
      if (m.t === 'ack' || m.t === 'ping' || m.t === 'stored') {
        inbox.splice(i, 1);
        if (m.t === 'stored') {
          const copy = copies.get(m.id);
          if (!copy) throw new Error('Unknown stored save');
          if (m.ok) base = copy;
          copies.delete(m.id);
        } else {
          acknowledge(m.ack, m.epoch);
          if (m.t === 'ping') pong = m.n;
        }
      } else i++;
    }
    if (booting || run || copies.size) return;
    while (inbox.length && !abort.signal.aborted) {
      if (inbox[0].t === 'run' && (frame || pendingDt !== null)) return;
      const m = inbox.shift()!;
      if (m.t === 'init') {
        booting = true;
        void boot(m).then(() => { booting = false; kick(); }, fatal);
        return;
      }
      if (!core || !recorder || !init) throw new Error('Worker has not received init');
      switch (m.t) {
        case 'cmd': command(m); break;
        case 'tick':
          acknowledge(m.ack, m.epoch);
          if (!Number.isInteger(m.seq) || m.seq <= tick || !Number.isFinite(m.dt) || m.dt < 0) throw new Error('Invalid frame tick');
          tick = m.seq;
          if (!init.deterministic) pendingDt = Math.min(0.25, (pendingDt ?? 0) + m.dt);
          break;
        case 'query':
          try { replies.push({ t: 'qres', id: m.id, ok: true, value: structuredClone(core.runQuery(m.name, m.args)) }); }
          catch (e) { replies.push({ t: 'qres', id: m.id, ok: false, error: errorText(e) }); }
          break;
        case 'watch': {
          const old = watches.get(m.id);
          watches.set(m.id, { ...m, at: old?.at ?? -Infinity, signature: '' }); break;
        }
        case 'unwatch': watches.delete(m.id); break;
        case 'view': recorder.setView(m.v); break;
        case 'save': {
          persistenceUnit = true;
          try {
            const copy = core.copySave(base!.regionId, base!.tileKey);
            // Strictly increasing bases even for two saves in the same millisecond.
            copy.record.savedAt = Math.max(copy.record.savedAt, base!.savedAt + 1);
            copy.record.city.savedAt = copy.record.savedAt;
            copies.set(m.id, copy.record);
            replies.push({ t: 'saved', id: m.id, ok: true, ...copy, cmd, changes });
          } catch (e) { replies.push({ t: 'saved', id: m.id, ok: false, error: errorText(e) }); }
          return;
        }
        case 'snapshot': {
          persistenceUnit = true;
          try {
            const st = core.sim.state;
            const snapshot = buildRecoverySnapshot(base!.regionId, base!.tileKey, st, base, {
              cityName: st.config.name, regionName: init.regionName, population: st.stats.population, funds: st.funds,
              why: m.why, lean: m.why === 'periodic', at: Math.max(Date.now(), base!.savedAt + 1),
            });
            replies.push({ t: 'snapped', id: m.id, ...snapshot, cmd, changes, fp: cityFingerprint(st) });
          } catch (e) { replies.push({ t: 'snapshotFailed', id: m.id, error: errorText(e) }); }
          return;
        }
        case 'run':
          if (!Number.isInteger(m.days) || m.days < 0) throw new Error('Invalid day count');
          run = { id: m.id, remaining: m.days, live: !init.deterministic }; setLive(false); return;
        case 'resync': ready(); break;
      }
    }
  }
  function watchValues(): NonNullable<Packet['watch']> {
    const out: NonNullable<Packet['watch']> = [], now = performance.now();
    for (const w of watches.values()) {
      const interval = w.name === 'inspectBuilding' || w.name === 'inspectCell' ? 1000 : 200;
      if (now - w.at < interval) continue;
      const signature = core!.querySignature(w.name, w.args, w.when, cmd);
      if (w.signature === signature) continue;
      w.at = now; w.signature = signature;
      const key = queryKey(w.args);
      try { out.push({ id: w.id, key, value: structuredClone(core!.runQuery(w.name, w.args)) }); }
      catch (e) { replies.push({ t: 'watchError', id: w.id, key, error: errorText(e) }); }
    }
    return out;
  }
  function flush(): void {
    if (!recorder || booting || seq - ack > 4) return;
    const watch = watchValues();
    const recorded = recorder.flush({ cmd, live: !init!.deterministic && !run,
      force: !!(replies.length || acks.length || watch.length || pong !== undefined) });
    if (!recorded) return;
    const p: WorkerPacket = { ...recorded, replies: undefined, changes };
    if (acks.length) p.acks = acks;
    if (replies.length) p.replies = replies;
    if (watch.length) p.watch = watch;
    if (pong !== undefined) p.pong = pong;
    const now = performance.now();
    if (now - statsAt >= 1000) {
      p.stats = { busy: busyMs / Math.max(1, now - startedAt), msPerDay: dayMs / Math.max(1, units.day ?? 0), units: { ...units }, queue: inbox.length };
      statsAt = now;
    }
    seq = p.seq;
    sent.set(seq, { commands: p.log.filter((e) => e[0] === EntryType.Ack).map((e) => e[3]!), replies });
    replies = []; acks = []; pong = undefined;
    post({ t: 'pkt', epoch, p });
  }
  function nextUnit(): string | null {
    if (!core || booting || copies.size) return null;
    const sim = core.sim, scheduler = schedulerOf(sim);
    if (run) {
      if (run.remaining > 0) { sim.advanceDay(); run.remaining--; return 'day'; }
      replies.push({ t: 'ran', id: run.id, day: sim.state.day }); setLive(run.live); run = null; return 'run:end';
    }
    if (!frame && pendingDt !== null) { frameDt = pendingDt; pendingDt = null; frameDays = 0; frame = 'hooks'; }
    if (frame === 'hooks') {
      core.livePolicy.tick(); sim.frameHooks(frameDt); scheduler.beginFrame(sim); frame = 'steps'; return 'frame';
    }
    if (frame === 'steps') {
      if (scheduler.stepOnce()) return 'step';
      scheduler.endFrame(); sim.accumulate(frameDt); frame = 'days'; return 'accumulate';
    }
    if (frame === 'days') {
      if (frameDays < sim.maxDaysPerFrame && sim.stepDay()) { frameDays++; return 'day'; }
      if (frameDays >= sim.maxDaysPerFrame) sim.capFrame();
      frame = null; return 'frame:end';
    }
    return null;
  }
  function unit(): void {
    scheduled = false;
    if (abort.signal.aborted) return;
    const start = performance.now();
    try {
      persistenceUnit = false;
      drain();
      if (abort.signal.aborted || booting) return;
      // Replies and command effects leave before the next expensive unit.
      flush();
      const unitStart = performance.now(), kind = persistenceUnit ? null : nextUnit();
      if (kind === 'day') dayMs += performance.now() - unitStart;
      if (kind) { units[kind] = (units[kind] ?? 0) + 1; flush(); }
      if (!copies.size && (run || frame || pendingDt !== null || inbox.length)) kick();
    } catch (e) { fatal(e); }
    finally { busyMs += performance.now() - start; }
  }
  function kick(): void {
    if (!scheduled && !abort.signal.aborted) { scheduled = true; loop.port2.postMessage(0); }
  }
  function dispose(): void {
    if (abort.signal.aborted) return;
    abort.abort('dispose');
    clearInterval(heartbeat); loop.port1.close(); loop.port2.close();
    if (core) schedulerOf(core.sim).endFrame();
    recorder?.dispose(); core?.dispose(); core?.sim.events.clear();
    core = null; recorder = null; base = null; init = null; run = null;
    inbox.length = 0; copies.clear(); settled.clear(); sent.clear(); watches.clear(); replies = []; acks = [];
  }
  loop.port1.onmessage = unit;
  const heartbeat = setInterval(() => { if (recorder && !booting) kick(); }, 250);
  scope.listen(receive, fatal, abort.signal);
  post({ t: 'hello', v: PROTOCOL_VERSION });
  return { dispose };
}

// Browser entry; node tests install the identical loop behind a parentPort adapter.
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
  installSimWorker({
    postMessage: (m) => scope.postMessage(m),
    listen(receive, fail, signal) {
      scope.addEventListener('message', (e) => receive(e.data), { signal });
      scope.addEventListener('messageerror', () => fail(new Error('Worker messageerror')), { signal });
      scope.addEventListener('error', (e) => fail(e.error ?? new Error(e.message)), { signal });
      scope.addEventListener('unhandledrejection', (e) => fail(e.reason), { signal });
    },
  });
}
