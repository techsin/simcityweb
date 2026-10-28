/** W1.1b: the worker's FIFO handlers, shared by the loopback core and the real worker (W1.2); scheduling remains the
 *  transport's responsibility. Worker-safe: no replica or main-thread module, and saves and snapshots are written
 *  through an injected store (R14), so W1.2's persistence 'main' can hand them to the page. */
import { FallbackActions } from '../game/fallback/FallbackActions';
import type { CityRecord } from '../save/cities';
import { CHANGE_EVENTS, cityFingerprint } from '../save/fingerprint';
import { buildRecoverySnapshot, LS_BUDGET_BYTES, type RecoverySnapshot } from '../save/recoveryCodec';
import type { CitySaveCopy, SimCore } from './SimCore';
import type { ChangeRecorder } from './recorder';
import { copyOwned, errorText, type M2W, type Packet, type Reply } from './protocol';
import type { CityPersistence, Command } from './SimHost';
import { queryKey, type QueryArgs, type QueryName } from './queries';

/** Where saves and snapshots land: the loopback (and W1.3) write IndexedDB; W1.2's persistence 'main' returns the
 *  record for the page to store. */
export interface InboxStore {
  /** W0.6's save write. Resolves to the reply's extra fields: recoveryDropped when written here, or the record. */
  putSave(copy: CitySaveCopy): Promise<{ recoveryDropped?: boolean; record?: CityRecord }>;
  /** W0.6's recovery slot. Resolves to whether that store persists. */
  putSnapshot(snapshot: RecoverySnapshot): Promise<boolean>;
  /** the city's last save, the base of its recovery deltas */
  recoveryBase(regionId: string, tileKey: string): CityRecord | null;
}

type WatchRequest = Extract<M2W, { t: 'watch' }>;
interface CoreWatch {
  request: WatchRequest; at: number;
  cache: Map<string, { signature: string; at: number }>;
  /** dispatchOptions: the command seq of its last run (a dispatch command bypasses the cap, as LocalWatch) */
  cmd?: number;
}

export class ProtocolInbox {
  cmd = 0;
  changes = 0;
  private watches = new Map<number, CoreWatch>();
  private errors = new Map<string, number>();
  private fallback: FallbackActions | null = null;
  /** saves and snapshots write one at a time, in request order, outside the FIFO */
  private writes: Promise<void> = Promise.resolve();
  /** the latest save still being written: snapshots delta against it, the base once it lands (recoveryIdb's check) */
  private pendingBase: CityRecord | null = null;
  constructor(readonly core: SimCore, readonly recorder: ChangeRecorder, private opts: {
    now(): number; flush(force?: boolean): Packet | null; signal: AbortSignal;
    persistence?: CityPersistence; store?: InboxStore;
    /** a write's reply failed to go out once it settled, outside the transport's own error path */
    fatal(error: unknown): void;
  }) {
    const offs = CHANGE_EVENTS.map((type) => core.sim.events.on(type, () => { this.changes++; }));
    opts.signal.addEventListener('abort', () => { for (const off of offs) off(); this.watches.clear(); }, { once: true });
  }

  /** Settles once every save and snapshot requested so far has replied: the harness's drain barrier. */
  get idle(): Promise<void> { return this.writes; }

  handle(message: M2W): void {
    const m = message;
    switch (m.t) {
      case 'cmd': {
        if (m.seq !== this.cmd + 1) throw new Error(`Command gap: expected ${this.cmd + 1}, got ${m.seq}`);
        this.recorder.cause = m.seq;
        let result: unknown;
        try {
          // rejected like any failed command, never fatal: the deterministic harness steps whole days
          if (m.atDay !== undefined && m.atDay !== this.core.sim.state.day) throw new Error('atDay requires a deterministic day boundary');
          if (m.op.startsWith('debug.')) throw new Error('Debug units belong to the worker scheduler');
          // as LocalSimHost: stand-in actions when CityActions failed to construct, so pause and dispatch still work
          const actions = this.core.actions ?? (this.fallback ??= new FallbackActions(this.core.sim));
          result = this.core.applyCommand({ op: m.op, args: m.args } as unknown as Command, actions);
        } catch (e) {
          result = { ok: false, commandError: errorText(e) };
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
          this.recorder.reply({ t: 'qres', id: m.id, cmd: this.cmd, ok: false, error: errorText(e) });
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
      case 'save': this.save(m); return;
      case 'snapshot': this.snapshot(m); return;
      default: throw new Error(`Transport must handle ${m.t}`);
    }
  }

  refresh(): void {
    const now = this.opts.now();
    for (const w of this.watches.values()) {
      const m = w.request, key = queryKey(m.args), cached = w.cache.get(key);
      const interval = m.name === 'inspectBuilding' || m.name === 'inspectCell' ? 1000 : 200;
      // as LocalWatch (W0.3b, EM-1): argument changes share the cap; a dispatch command bypasses it for dispatchOptions
      const epoch = m.name === 'dispatchOptions' ? this.cmd : undefined;
      if (epoch === w.cmd && (now - w.at < 200 || (cached && now - cached.at < interval))) continue;
      const args = m.args as QueryArgs<QueryName>;
      const signature = this.core.querySignature(m.name, args, m.when, this.cmd);
      if (cached?.signature === signature) { w.cmd = epoch; continue; }
      w.at = now; w.cmd = epoch;
      try { this.recorder.watch({ id: m.id, key, cmd: this.cmd, value: copyOwned(this.core.runQuery(m.name, args)) }); }
      catch (e) {
        this.recorder.watch({ id: m.id, key, cmd: this.cmd, error: errorText(e) });
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
    this.recorder.reply({ t: 'error', cmd: this.cmd, key, title, message: errorText(e), stack: e instanceof Error ? e.stack : undefined, sim, ...(disabled ? { disabled: true } : {}) });
  }

  /** W0.6: the copy, its watermark and its change count are taken in this unit. The write is chained, so ticks and
   *  commands keep running while it lands, and the reply goes out when it settles. */
  private save(m: Extract<M2W, { t: 'save' }>): void {
    const cmd = this.cmd, p = this.opts.persistence, store = this.opts.store;
    const failed = (e: unknown): Reply => ({ t: 'saved', id: m.id, cmd, ok: false, error: errorText(e) });
    if (!p || !store) { this.recorder.reply(failed(new Error('City persistence is not configured'))); this.opts.flush(); return; }
    const copy = this.attempt(() => this.core.copySave(p.regionId, p.tileKey), failed);
    if (!copy) return;
    const changes = this.changes, boundary = this.opts.flush(true), record = copy.record;
    const pktSeq = boundary?.seq ?? this.recorder.sequence + 1;
    this.pendingBase = record;
    this.persist(async () => {
      try {
        const written = await store.putSave(copy);
        return { t: 'saved', id: m.id, cmd, ok: true, savedAt: record.savedAt, fp: copy.fp, summary: copy.summary, pktSeq, changes, ...written };
      } finally { if (this.pendingBase === record) this.pendingBase = null; }
    }, failed);
  }

  /** As save: built in this unit, against a save still being written if there is one, and stored in order. */
  private snapshot(m: Extract<M2W, { t: 'snapshot' }>): void {
    const cmd = this.cmd, p = this.opts.persistence, store = this.opts.store;
    if (!p || !store) { this.recorder.reply({ t: 'snapped', id: m.id, cmd, ok: false }); this.opts.flush(); return; }
    const failed = (e: unknown): Reply => ({ t: 'snapped', id: m.id, cmd, ok: false, error: errorText(e) });
    const start = performance.now(), st = this.core.sim.state, changes = this.changes;
    const built = this.attempt(() => ({
      snapshot: buildRecoverySnapshot(p.regionId, p.tileKey, st, this.pendingBase ?? store.recoveryBase(p.regionId, p.tileKey), {
        cityName: st.config.name, regionName: p.regionName, population: st.stats.population, funds: st.funds,
        why: m.why, lean: m.why === 'periodic', at: Date.now(),
      }, LS_BUDGET_BYTES - 128 * 1024), // W0.6's journal reserve, without importing the localStorage module.
      fp: cityFingerprint(st),
    }), failed);
    if (!built) return;
    const { snapshot, fp } = built;
    this.persist(async () => {
      const idb = await store.putSnapshot(snapshot);
      return { t: 'snapped', id: m.id, cmd, ...snapshot, fp, changes,
        result: { ok: true, bytes: snapshot.payload.length, ls: false, idb, dropped: snapshot.dropped, ms: performance.now() - start } };
    }, failed);
  }

  private attempt<T>(run: () => T, failed: (e: unknown) => Reply): T | null {
    try { return run(); } catch (e) { this.recorder.reply(failed(e)); this.opts.flush(); return null; }
  }
  private persist(write: () => Promise<Reply>, failed: (e: unknown) => Reply): void {
    const settled = this.writes.then(write).catch(failed).then((reply) => {
      if (this.opts.signal.aborted) return;
      this.recorder.reply(reply); this.opts.flush();
    });
    // the chain never rejects, so one failed reply cannot fail the writes queued behind it
    this.writes = settled.catch((e) => { if (!this.opts.signal.aborted) this.opts.fatal(e); });
  }
}
