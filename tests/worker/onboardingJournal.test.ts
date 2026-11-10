/**
 * FH-22 (NOTE-079): the recovery journal carries setOnboarding, the guide's progress record, so a guide change made
 * after the last snapshot survives a closed tab on both packet hosts: the loopback, and the real worker with its own
 * IndexedDB (W1.3's harness: workerHarness.ts and nodeWorker.ts's KV bridge). The record is set whole, so the last
 * write wins: the record the city already holds adds no entry, and an applied one replaces the earlier ones.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOUNDING_IDS, copyOnboardingProgress, type GuideProgress } from '../../src/core/onboarding';
import { DevType, Zone } from '../../src/core/types';
import { clearRecoveryBase, getCityRecord, getRecoveryBase, loadCity, saveCity, type CityRecord } from '../../src/save/cities';
import { setKV } from '../../src/save/db';
import { JOURNAL_RESERVE_BYTES, type RecoveryJournal, type RecoveryMarker } from '../../src/save/recoveryCodec';
import { storeJournalIdb } from '../../src/save/recoveryIdb';
import { peekRecoveryMarker, readLsJournal } from '../../src/save/recoveryLs';
import { findRecoverySnapshot, restoreRecoverySnapshot } from '../../src/save/recovery';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { CityActions } from '../../src/sim/actions';
import type { CityState } from '../../src/sim/CityState';
import { newProgress } from '../../src/ui/guide/progress';
import { LoopbackCore } from '../../src/worker/loopbackCore';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { cloneMessage, type M2W } from '../../src/worker/protocol';
import { RecoveryMirror, type RecoveryMirrorOptions } from '../../src/worker/recoveryMirror';
import { LocalSimHost, type Command } from '../../src/worker/SimHost';
import type { WorkerSimHost } from '../../src/worker/WorkerSimHost';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { newState, place } from '../infra/cityGen';
import { MemStorage, PersistentMemoryKV, regionData } from '../save/fixtures';
import { bootIdb, initialCity, send, waitFor } from './workerHarness';

const progress = (over: Partial<GuideProgress> = {}): GuideProgress => ({ ...newProgress(90), ...over });
/** the same record with its keys in another order: the city compares records, not their JSON */
const reordered = (p: GuideProgress) => Object.fromEntries(Object.entries(structuredClone(p)).reverse()) as unknown as GuideProgress;
const guideOp = (seq: number, p: GuideProgress) => ({ seq, op: 'setOnboarding', args: [p] });
const rect = { x0: 3, z0: 3, x1: 6, z1: 6 };

// ------------------------------------------------------------------------------------------- the page's own realm
describe('FH-22 (NOTE-079): the guide record in the journal mirror and on the loopback host', () => {
  const city = { regionId: 'rtest', tileKey: '0_0' }, JOURNAL = 'rtest:0_0#journal';
  const loops: LoopbackCore[] = [], mirrors: RecoveryMirror[] = [], hosts: (LocalSimHost | LoopbackSimHost)[] = [];
  let now: number, kv: PersistentMemoryKV;
  beforeEach(() => {
    now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    kv = new PersistentMemoryKV(); setKV(kv); clearRecoveryBase();
    vi.stubGlobal('localStorage', new MemStorage());
  });
  afterEach(async () => {
    for (const m of mirrors.splice(0)) m.dispose();
    for (const l of loops.splice(0)) l.dispose();
    for (const h of hosts.splice(0)) await h.dispose();
    clearRecoveryBase(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  function loop(state: CityState): LoopbackCore {
    const l = new LoopbackCore(state, { modules: { CityActions } });
    loops.push(l); return l;
  }
  function mirror(opts: Partial<RecoveryMirrorOptions> = {}): RecoveryMirror {
    const m = new RecoveryMirror({ ...city, savedAt: 1000, kv, signal: new AbortController().signal,
      info: { cityName: 'Guide City', day: 90, funds: 0, population: 0 }, ...opts });
    mirrors.push(m); return m;
  }
  async function savedCity(): Promise<number> {
    const state = newState(16); state.funds = 100000; state.stats.population = 10000;
    place(state, 't_r1', 10, 10);
    await kv.put('regions', regionData());
    return saveCity(city.regionId, city.tileKey, state);
  }
  /** a saved city on a loopback core, with a mirror fed as the packet host feeds it: on posting, then with the ack */
  async function session() {
    const savedAt = await savedCity(), record = getRecoveryBase(city.regionId, city.tileKey)!;
    const l = loop(deserializeCity(record.city)), m = mirror({ savedAt });
    now = 1100;
    let seq = 0;
    const post = (command: Command): unknown => {
      const message = cloneMessage<M2W>({ t: 'cmd', seq: ++seq, ...command });
      if (message.t !== 'cmd') throw new Error('Expected command');
      m.onCommand(message.seq, message.op, message.args);
      const result = l.core.applyCommand({ op: command.op, args: message.args } as Command, l.core.actions!);
      l.flush(true);
      m.onAck(seq, structuredClone(result));
      return result;
    };
    return { l, m, post, record };
  }
  /** as main.ts enters a city in `?simworker=loopback`: loadCity (the recovery base), then the host and its core */
  async function openHost(): Promise<LoopbackSimHost> {
    const host = new LoopbackSimHost((await loadCity(city.regionId, city.tileKey))!, { initialSpeed: 0, persistence: city });
    hosts.push(host);
    await host.start(); await host.drain();
    return host;
  }
  async function settle<T>(host: LoopbackSimHost, p: Promise<T>): Promise<T> { await host.drain(); return p; }
  /** the guide's command through the host, as Onboarding.persistProgress sends it */
  async function guide(host: LoopbackSimHost, p: GuideProgress): Promise<boolean> {
    return settle(host, host.act('setOnboarding', [p]).done);
  }

  it('journals a changed record once, with no charge; the same record again adds no entry and marks nothing', async () => {
    const m = mirror(), a = progress({ minimised: true }), put = vi.spyOn(kv, 'put');
    m.onCommand(1, 'setOnboarding', [a]);
    // on posting, before any ack: a change still in flight at unload is kept (§4.3)
    expect(m.journal.ops).toEqual([guideOp(1, a)]);
    m.onAck(1, true);
    expect(m.journal.ops, 'the entry is the command alone: costs and refunds are a bulldoze\'s').toEqual([guideOp(1, a)]);
    m.writeNow('hidden');
    expect(put).toHaveBeenCalledOnce();
    expect(readLsJournal()?.ops).toEqual([guideOp(1, a)]);
    for (const [seq, same] of [[2, a], [3, reordered(a)]] as const) { m.onCommand(seq, 'setOnboarding', [same]); m.onAck(seq, true); }
    expect(m.journal.ops).toEqual([guideOp(1, a)]);
    now = 1100; m.writeNow('periodic');
    expect(put, 'nothing changed since the last write').toHaveBeenCalledOnce();
    // a changed record is a change again, and so is the first one after it
    m.onCommand(4, 'setOnboarding', [progress()]); m.onCommand(5, 'setOnboarding', [a]);
    expect(m.journal.ops).toEqual([guideOp(1, a), guideOp(4, progress()), guideOp(5, a)]);
    m.writeNow('periodic');
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('does not journal the record the city held at the Ready, and journals a changed one', () => {
    const held = progress({ phase: 'year', completed: [...FOUNDING_IDS], started: ['G1'] });
    const m = mirror({ cmd: 7, onboarding: held });
    held.minimised = true; // the host's object changes with later packets: the mirror keeps its own copy
    m.onCommand(8, 'setOnboarding', [{ ...held, minimised: false }]);
    expect(m.journal.ops).toEqual([]);
    m.onCommand(9, 'setOnboarding', [held]);
    expect(m.journal.ops).toEqual([guideOp(9, held)]);
    // a city without a record: the first one is a change
    const fresh = mirror();
    fresh.onCommand(1, 'setOnboarding', [progress()]);
    expect(fresh.journal.ops).toEqual([guideOp(1, progress())]);
  });

  it('compares records as the city does: an update is journaled exactly when the city changes', async () => {
    const f = await session();
    const base = progress({ phase: 'year', completed: ['road', 'zones'], started: ['G1', 'G2'], lastBudgetMonth: 0 });
    const guides = () => f.m.journal.ops.filter((e) => e.op === 'setOnboarding');
    const cases: [string, GuideProgress, boolean][] = [
      ['the keys in another order', reordered(base), false],
      ['a detached copy', structuredClone(base), false],
      ['the ids in another order', { ...base, completed: ['zones', 'road'] }, true],
      ['one id fewer', { ...base, started: ['G1'] }, true],
      ['null for 0', { ...base, lastBudgetMonth: null }, true],
      ['a flag', { ...base, whyOpened: true }, true],
      ['a day', { ...base, powerMarginSince: 91 }, true],
    ];
    // two commands a case: the base record (seq 2i + 1), then its variant (seq 2i + 2)
    for (const [i, [what, variant, changes]] of cases.entries()) {
      expect(f.post({ op: 'setOnboarding', args: [base] }), what).toBe(true);
      const before = f.l.inbox.changes, held = guides();
      expect(held, what).toHaveLength(1);
      expect(f.post({ op: 'setOnboarding', args: [variant] }), what).toBe(true);
      expect(f.l.inbox.changes - before, `${what}: the city`).toBe(changes ? 1 : 0);
      expect(guides(), `${what}: the journal`).toEqual(changes ? [guideOp(2 * i + 2, variant)] : held);
      expect(f.l.primary.systemData.onboarding, what).toEqual(guides()[0].args[0]);
    }
  });

  it('last write wins: an applied record replaces the earlier ones, those in flight stay in order, a rejected one is dropped', () => {
    const m = mirror(), a = progress({ minimised: true }), b = progress({ budgetOpened: true }), c = progress({ whyOpened: true });
    m.onCommand(1, 'setTax', [DevType.R1, 12]);
    m.onCommand(2, 'setOnboarding', [a]);
    m.onCommand(3, 'zone', [rect, Zone.ResLow]);
    m.onCommand(4, 'setOnboarding', [b]);
    m.onCommand(5, 'setOnboarding', [c]);
    const seqs = () => m.journal.ops.map((e) => e.seq);
    expect(seqs()).toEqual([1, 2, 3, 4, 5]);
    m.onAck(1, undefined); m.onAck(2, true);
    expect(seqs(), 'the first record has nothing to replace').toEqual([1, 2, 3, 4, 5]);
    m.onAck(3, { ok: true, cost: 90 }); m.onAck(4, true);
    expect(seqs(), 'the second replaces the first; the third is still in flight').toEqual([1, 3, 4, 5]);
    m.onAck(5, false);
    expect(seqs(), 'a rejected record replaces nothing').toEqual([1, 3, 4]);
    expect(m.journal.ops[2]).toEqual(guideOp(4, b));
    // a save's copy between two records keeps only the newer one, like any other command
    m.onCommand(6, 'setOnboarding', [a]); m.onAck(6, true);
    m.onSaving(); m.onSaved(1200, 4);
    expect(m.journal).toMatchObject({ base: { kind: 'save', savedAt: 1200 }, fromCmd: 4, ops: [guideOp(6, a)] });
  });

  it('replays the one record it keeps onto the save: the same city and RNG as the session', async () => {
    const f = await session(), a = progress({ minimised: true });
    const b = progress({ phase: 'year', completed: [...FOUNDING_IDS], started: ['G1', 'G10'], lastBudgetMonth: 3, powerMarginSince: 95 });
    f.post({ op: 'setTax', args: [DevType.R1, 12] });
    expect(f.post({ op: 'setOnboarding', args: [a] })).toBe(true);
    expect(f.post({ op: 'zone', args: [rect, Zone.ResLow] })).toMatchObject({ ok: true });
    expect(f.post({ op: 'setOnboarding', args: [b] })).toBe(true);
    expect(f.post({ op: 'setOnboarding', args: [reordered(b)] }), 'the same record: applied, nothing changed').toBe(true);
    expect(f.post({ op: 'setOnboarding', args: [{ ...b, version: 2 } as unknown as GuideProgress] })).toBe(false);
    const journal = f.m.journal;
    expect(journal.ops.map((e) => [e.seq, e.op])).toEqual([[1, 'setTax'], [3, 'zone'], [4, 'setOnboarding']]);
    const restored = loop(deserializeCity(f.record.city));
    expect(restored.core.replayRecoveryJournal(journal, f.record)).toEqual({ applied: [1, 3, 4], failed: [] });
    expect(restored.primary.systemData.onboarding).toEqual(b);
    expect(serializeCity(restored.primary, { copy: true })).toEqual(serializeCity(f.l.primary, { copy: true }));
    expect(restored.core.sim.rng.state).toBe(f.l.core.sim.rng.state);
    expect(restored.primary.day, 'no time passes in a replay').toBe(f.l.primary.day);
    // after a rejected record the valid one is journaled again (the city answers that nothing changed): still one record
    expect(f.post({ op: 'setOnboarding', args: [b] })).toBe(true);
    expect(f.m.journal.ops.map((e) => [e.seq, e.op])).toEqual([[1, 'setTax'], [3, 'zone'], [7, 'setOnboarding']]);
  });

  it('many small guide updates never grow the journal or ask for a snapshot; unacknowledged ones stay, within the reserve\'s request', () => {
    const requestSnapshot = vi.fn();
    const m = mirror({ requestSnapshot });
    // a month's budget timer and a power margin that flaps every day, for 400 updates
    const update = (i: number) => progress({ phase: 'year', lastBudgetMonth: i, solventMonths: i % 3, powerMarginSince: i % 2 ? 90 + i : null });
    for (let i = 1; i <= 400; i++) { m.onCommand(i, 'setOnboarding', [update(i)]); m.onAck(i, true); }
    expect(m.journal.ops).toEqual([guideOp(400, update(400))]);
    expect(JSON.stringify(m.journal).length * 2).toBeLessThan(2048);
    expect(requestSnapshot).not.toHaveBeenCalled();
    // in flight (no ack yet) every record stays, in order: the reserve asks for a snapshot once past its half, as for any op
    for (let i = 401; i <= 800; i++) m.onCommand(i, 'setOnboarding', [update(i)]);
    expect(m.journal.ops).toHaveLength(401);
    expect(JSON.stringify(m.journal).length * 2).toBeGreaterThan(JOURNAL_RESERVE_BYTES / 2);
    expect(requestSnapshot).toHaveBeenCalledOnce();
    // and the newest one's ack leaves that record alone
    for (let i = 401; i <= 800; i++) m.onAck(i, true);
    expect(m.journal.ops).toEqual([guideOp(800, update(800))]);
  });

  it('a fuzz of guide updates, acks (some lost in a resync), saves and snapshots: the journal replayed onto its base always gives the last record posted', { timeout: 30000 }, () => {
    // four records the city takes and one it rejects (a future version)
    const pool = [progress(), progress({ minimised: true }), progress({ budgetOpened: true }), progress({ whyOpened: true }),
      { ...progress(), version: 2 } as unknown as GuideProgress];
    const valid = pool.map((p) => copyOnboardingProgress(p) !== null), keys = pool.map((p) => JSON.stringify(p));
    expect(valid).toEqual([true, true, true, true, false]);
    const snapMarker = (at: number, baseSavedAt: number): RecoveryMarker => ({ v: 1, ...city, at, baseSavedAt, bytes: 1, ls: false,
      dropped: [], cityName: 'Guide City', day: 90, population: 0, funds: 0 });
    for (let seed = 1; seed <= 300; seed++) {
      let state = seed;
      const next = () => { // mulberry32
        let t = state += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
      const pick = (n: number) => Math.floor(next() * n);
      /** the record in the loaded save: none (-1) or a valid one; then every command posted, a guide record or another op (null) */
      const held = pick(5) - 1, posted: (number | null)[] = [];
      /** the city's record after its first `n` commands: a whole-record set, and a rejected one changes nothing */
      const recordAt = (n: number) => posted.slice(0, n).reduce<number>((r, p) => p !== null && valid[p] ? p : r, held);
      const m = mirror({ onboarding: held < 0 ? undefined : pool[held] });
      // the authority: the commands it has applied, its clock, the save its snapshots are deltas of, what each base holds
      let applied = 0, at = 1000, baseAt = 1000, newest = held;
      const bases = new Map<string, number>([['save:1000', held]]), applies = new Set<number>();
      /** saves and snapshots reply in request order, each after the acks of the commands it contains */
      const replies: (() => void)[] = [];
      const apply = () => {
        const p = posted[applied++];
        // a resync drops some acks: the command was applied, and the page never hears its outcome
        if (next() < 0.15) return;
        m.onAck(applied, p === null ? undefined : valid[p]);
        if (p !== null && valid[p]) applies.add(applied);
      };
      for (let step = 0; step < 80; step++) {
        const what = next();
        if (what < 0.4) {
          const p = next() < 0.75 ? pick(5) : null, seq = posted.push(p);
          m.onCommand(seq, p === null ? 'setTax' : 'setOnboarding', p === null ? [DevType.R1, seq % 20] : [structuredClone(pool[p])]);
          if (p !== null && p === newest) expect(m.journal.ops.some((e) => e.seq === seq), `seed ${seed}, step ${step}: the same record again`).toBe(false);
          if (p !== null) newest = p;
        } else if (what < 0.7) { if (applied < posted.length) apply(); }
        else if (what < 0.8) {
          // a save: FIFO behind every command posted so far; its put lands or fails, and its reply comes later
          while (applied < posted.length) apply();
          const cmd = applied, ok = next() < 0.8, savedAt = ++at;
          m.onSaving();
          if (ok) { bases.set(`save:${savedAt}`, recordAt(cmd)); baseAt = savedAt; }
          replies.push(() => { if (ok) m.onSaved(savedAt, cmd); else m.onSaveFailed(); });
        } else if (what < 0.88) {
          while (applied < posted.length) apply();
          const cmd = applied, marker = snapMarker(++at, baseAt);
          bases.set(`snapshot:${marker.at}`, recordAt(cmd));
          replies.push(() => { m.onSnapped(marker, new Uint8Array(1), cmd); });
        } else replies.shift()?.();
        // what a restore would do now: the base's record, then the journal's guide records in order
        const journal = m.journal, base = journal.base;
        let restored = bases.get(base.kind === 'save' ? `save:${base.savedAt}` : `snapshot:${base.at}`);
        expect(restored, `seed ${seed}, step ${step}: a base the authority wrote`).not.toBeUndefined();
        const guides = journal.ops.filter((e) => e.op === 'setOnboarding');
        for (const e of guides) { const p = keys.indexOf(JSON.stringify(e.args[0])); if (valid[p]) restored = p; }
        expect(restored, `seed ${seed}, step ${step}: no guide change is lost`).toBe(recordAt(posted.length));
        expect(guides.filter((e) => applies.has(e.seq)).length, `seed ${seed}, step ${step}: one applied record at most`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a guide change after the last snapshot, then the tab closes without a final snapshot: the restore keeps the change', async () => {
    const savedAt = await savedCity(); now = 1100;
    const host = await openHost();
    const a = progress({ minimised: true });
    const b = progress({ minimised: true, phase: 'year', completed: [...FOUNDING_IDS], started: ['G1'], lastBudgetMonth: 3 });
    expect(await guide(host, a)).toBe(true);
    now = 1200; const snap = (await settle(host, host.snapshot('periodic')))!;
    expect(snap).toMatchObject({ cmd: 1, marker: { at: 1200, baseSavedAt: savedAt } });
    expect(await guide(host, b)).toBe(true);
    // the tab closes: the app's unload handler writes the journal (main.ts snapshotNow), and no snapshot or save follows
    now = 1300; host.recovery!.writeNow('pagehide');
    await host.dispose();
    expect(readLsJournal()).toMatchObject({ base: { kind: 'snapshot', at: 1200, baseSavedAt: savedAt }, fromCmd: 1 });
    expect(readLsJournal()!.ops).toEqual([guideOp(2, b)]);
    const pending = (await findRecoverySnapshot(city))!;
    expect(pending.marker.at).toBe(1200);
    now = 1400; await restoreRecoverySnapshot(pending);
    const restored = (await getCityRecord(kv, city.regionId, city.tileKey))!;
    expect(deserializeCity(restored.city).systemData.onboarding, 'the snapshot alone holds the earlier record').toEqual(a);
    expect(await kv.get<RecoveryJournal>('recovery', JOURNAL), 're-bound to the restored save').toMatchObject({ base: { kind: 'save', savedAt: 1400 }, ops: [guideOp(2, b)] });
    const again = await openHost();
    expect(again.harness.primary.systemData.onboarding, 'the journal replayed the change made after it').toEqual(b);
    expect(again.state.systemData.onboarding).toEqual(b);
    // the loopback cannot save before its Ready: the replayed record reads as unsaved until the first save, which trims it
    expect(again.changes).toBeGreaterThan(0);
    now = 1500; await settle(again, again.save('manual'));
    expect(await kv.get('recovery', JOURNAL)).toBeUndefined();
    expect((await loadCity(city.regionId, city.tileKey))!.systemData.onboarding).toEqual(b);
  });

  it('an identical update adds no journal entry: after a change, after a save, and for the loaded record in a new session', async () => {
    await savedCity(); now = 1100;
    const host = await openHost(), a = progress({ minimised: true });
    expect(await guide(host, a)).toBe(true);
    host.recovery!.writeNow('hidden');
    expect(readLsJournal()!.ops).toEqual([guideOp(1, a)]);
    const changes = host.changes;
    for (const same of [a, reordered(a)]) expect(await guide(host, same), 'the city applies it: nothing changed').toBe(true);
    expect(host.changes, 'and the city does not read as changed').toBe(changes);
    now = 1150; host.recovery!.writeNow('hidden');
    expect(readLsJournal()!.ops).toEqual([guideOp(1, a)]);
    // the save holds the record and trims the journal: the record sent again leaves nothing to write at unload
    now = 1200; await settle(host, host.save('manual'));
    expect(peekRecoveryMarker()).toBeNull();
    expect(await guide(host, a)).toBe(true);
    host.recovery!.writeNow('pagehide');
    expect(peekRecoveryMarker()).toBeNull();
    expect(await kv.get('recovery', JOURNAL)).toBeUndefined();
    await host.dispose();
    // a new session: the record it loaded, then a changed one
    const again = await openHost();
    expect(again.state.systemData.onboarding).toEqual(a);
    expect(await guide(again, reordered(a))).toBe(true);
    again.recovery!.writeNow('pagehide');
    expect(peekRecoveryMarker()).toBeNull();
    const b = progress({ minimised: false, budgetOpened: true });
    expect(await guide(again, b)).toBe(true);
    again.recovery!.writeNow('pagehide');
    expect(readLsJournal()!.ops).toEqual([guideOp(2, b)]);
  });

  it('LocalSimHost replays a guide record that a packet session journaled, and its first save deletes the journal', async () => {
    const savedAt = await savedCity();
    const b = progress({ phase: 'year', completed: [...FOUNDING_IDS], started: ['G1'], dismissed: true });
    await storeJournalIdb(kv, { v: 1, ...city, at: savedAt + 1, base: { kind: 'save', savedAt }, fromCmd: 0, ops: [{ seq: 1, op: 'setOnboarding', args: [b] }] });
    const local = new LocalSimHost((await loadCity(city.regionId, city.tileKey))!, { persistence: city });
    hosts.push(local); await local.start({ CityActions });
    expect(local.state.systemData.onboarding).toEqual(b);
    expect(local.changes, 'the replayed record reads as unsaved').toBe(1);
    now = 1100; await local.save('manual');
    expect(await kv.get('recovery', JOURNAL)).toBeUndefined();
    expect((await loadCity(city.regionId, city.tileKey))!.systemData.onboarding).toEqual(b);
  });
});

// ------------------------------------------------------------------------------- the real worker, its own IndexedDB
// No Date.now mock: the worker thread keeps its own clock (as workerRecovery.test.ts).
describe('FH-22 (NOTE-079): the guide record through the real worker and its own IndexedDB', () => {
  const REGION = 'hosts', TILE = '0', KEY = `${REGION}:${TILE}`, CITY = { regionId: REGION, tileKey: TILE };
  let kv: PersistentMemoryKV;
  const hosts: { dispose(): Promise<void> }[] = [];
  beforeAll(async () => { await buildWorkerTest(); }, 60000);
  beforeEach(async () => {
    kv = new PersistentMemoryKV(); setKV(kv); clearRecoveryBase();
    vi.stubGlobal('localStorage', new MemStorage());
    await kv.put('regions', regionData(REGION, 'Host Region'));
    const city = initialCity();
    await kv.put('cities', { key: KEY, regionId: REGION, tileKey: TILE, savedAt: city.savedAt, city } satisfies CityRecord, KEY);
  });
  afterEach(async () => {
    for (const h of hosts.splice(0)) await h.dispose();
    clearRecoveryBase(); vi.unstubAllGlobals();
  });
  async function boot(): Promise<WorkerSimHost> {
    const host = await bootIdb(REGION, TILE, { kv, deterministic: true });
    hosts.push(host); return host;
  }
  const record = async () => (await getCityRecord(kv, REGION, TILE))!;
  const stored = () => kv.get<RecoveryJournal>('recovery', KEY + '#journal');
  /** the tab closes: the app's unload handler writes the journal (main.ts snapshotNow), and nothing is saved or snapped */
  async function close(host: WorkerSimHost): Promise<void> {
    host.recovery!.writeNow('pagehide');
    await host.dispose();
  }
  /** a snapshot is newer than the save it is a delta of: the two threads share the system clock */
  const after = (savedAt: number) => waitFor(() => Date.now() > savedAt + 1, 'the clock to pass the save');

  it('a guide change after the last worker snapshot, then the tab closes without a final snapshot: the restore keeps the change', { timeout: 30000 }, async () => {
    const first = await boot();
    expect(first.persistence).toBe('worker-idb');
    const saved = await first.save('manual');
    const a = progress({ minimised: true });
    const b = progress({ minimised: true, phase: 'year', completed: [...FOUNDING_IDS], started: ['G1'], lastBudgetMonth: 3 });
    expect(await send(first, 'setOnboarding', [a])).toBe(true);
    await after(saved.savedAt);
    const snap = (await first.snapshot('hidden'))!;
    expect(snap, 'the worker stored it').toMatchObject({ ok: true, idb: true, cmd: saved.cmd + 1 });
    expect(await send(first, 'setOnboarding', [b])).toBe(true);
    await close(first);
    expect(await stored(), 'the page\'s journal extends that snapshot with the change made after it')
      .toMatchObject({ base: { kind: 'snapshot', at: snap.marker.at, baseSavedAt: saved.savedAt }, fromCmd: snap.cmd });
    expect((await stored())!.ops).toEqual([guideOp(snap.cmd + 1, b)]);
    const offer = (await findRecoverySnapshot(CITY))!;
    expect(offer.marker.kind, 'the worker\'s snapshot is the offer').not.toBe('journal');
    await restoreRecoverySnapshot(offer);
    const restored = await record();
    expect(deserializeCity(restored.city).systemData.onboarding, 'the snapshot alone holds the earlier record').toEqual(a);
    expect(await stored(), 're-bound to the restored save').toMatchObject({ base: { kind: 'save', savedAt: restored.savedAt } });
    const phases: string[] = [];
    const second = await bootIdb(REGION, TILE, { kv, deterministic: true, onBoot: (phase) => phases.push(phase) });
    hosts.push(second);
    expect(phases, 'the worker replays the journal').toContain('journal');
    expect(second.state.systemData.onboarding, 'the change made after the snapshot is back').toEqual(b);
    const rec = await record();
    expect(rec.savedAt, 'saved before the Ready').toBeGreaterThan(restored.savedAt - 1);
    expect(deserializeCity(rec.city).systemData.onboarding).toEqual(b);
    expect(await stored(), 'that save deleted the journal').toBeUndefined();
    expect(second.changes, 'and the city reads as saved').toBe(0);
  });

  it('a save, two guide changes, the tab closes: the journal alone holds one record, and the next worker replays it and saves before its Ready', { timeout: 30000 }, async () => {
    const first = await boot();
    const saved = await first.save('manual');
    const a = progress({ minimised: true }), b = progress({ minimised: true, budgetOpened: true });
    expect(await send(first, 'setOnboarding', [a])).toBe(true);
    expect(first.changes, 'a guide change alone reads as unsaved').toBeGreaterThan(saved.changes);
    expect(await send(first, 'setOnboarding', [b])).toBe(true);
    await close(first);
    const journal = (await stored())!;
    expect(journal).toMatchObject({ base: { kind: 'save', savedAt: saved.savedAt }, info: { why: 'pagehide' } });
    expect(journal.ops, 'the last write, with no charge').toEqual([guideOp(saved.cmd + 2, b)]);
    const offer = (await findRecoverySnapshot())!;
    expect(offer.marker).toMatchObject({ kind: 'journal', bytes: 0, baseSavedAt: saved.savedAt });
    await restoreRecoverySnapshot(offer);
    const second = await boot();
    expect(second.state.systemData.onboarding).toEqual(b);
    const rec = await record();
    expect(rec.savedAt, 'saved before the Ready').toBeGreaterThan(saved.savedAt);
    expect(deserializeCity(rec.city).systemData.onboarding).toEqual(b);
    expect(await stored(), 'that save deleted the journal').toBeUndefined();
    expect(second.changes, 'and the city reads as saved').toBe(0);
  });

  it('an identical update adds no journal entry: after a change, after a save, and for the loaded record in a new session', { timeout: 30000 }, async () => {
    const first = await boot(), a = progress({ minimised: true });
    expect(await send(first, 'setOnboarding', [a])).toBe(true);
    first.recovery!.writeNow('hidden');
    expect(readLsJournal()!.ops).toEqual([guideOp(1, a)]);
    const changes = first.changes;
    for (const same of [a, reordered(a)]) expect(await send(first, 'setOnboarding', [same]), 'the worker applies it: nothing changed').toBe(true);
    expect(first.changes, 'and the city does not read as changed').toBe(changes);
    first.recovery!.writeNow('hidden');
    expect(readLsJournal()!.ops).toEqual([guideOp(1, a)]);
    // the save holds the record and trims the journal: the record sent again leaves nothing to write at unload
    await first.save('manual');
    expect(peekRecoveryMarker()).toBeNull();
    expect(await send(first, 'setOnboarding', [a])).toBe(true);
    await close(first);
    expect(peekRecoveryMarker()).toBeNull();
    expect(await stored()).toBeUndefined();
    // a new session: the record the worker loaded, then a changed one
    const second = await boot();
    expect(second.state.systemData.onboarding).toEqual(a);
    expect(await send(second, 'setOnboarding', [reordered(a)])).toBe(true);
    second.recovery!.writeNow('pagehide');
    expect(peekRecoveryMarker()).toBeNull();
    const b = progress({ minimised: false, budgetOpened: true });
    expect(await send(second, 'setOnboarding', [b])).toBe(true);
    second.recovery!.writeNow('pagehide');
    expect(readLsJournal()!.ops).toEqual([guideOp(2, b)]);
  });
});
