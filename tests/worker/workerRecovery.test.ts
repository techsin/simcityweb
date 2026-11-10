/**
 * W1.3 (T039, WORKER_DESIGN §4, §5.3's recovery row through the real worker): the worker reads and writes its own
 * IndexedDB (here the test's KV, through nodeWorker.ts's bridge), replays the journal bound to its save before its
 * Ready and saves; the page keeps T033's journal mirror; the title screen offers a journal alone; a worker whose
 * IndexedDB falls back to memory is replaced by one with persistence 'main'; LocalSimHost replays the journal too.
 * No Date.now mock: the worker thread keeps its own clock.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevType, Zone } from '../../src/core/types';
import { clearRecoveryBase, getCityRecord, getRecoveryBase, loadCity, type CityRecord } from '../../src/save/cities';
import { setKV, type StoreName } from '../../src/save/db';
import { deserializeCity } from '../../src/save/serialize';
import { buildRecoverySnapshot, type RecoveryJournal } from '../../src/save/recoveryCodec';
import { storeJournalIdb, storeRecoveryIdb } from '../../src/save/recoveryIdb';
import { readLsJournal } from '../../src/save/recoveryLs';
import { discardRecoverySnapshot, findRecoverySnapshot, hasRecoverySnapshot, restoreRecoverySnapshot } from '../../src/save/recovery';
import { CityActions } from '../../src/sim/actions';
import { createSystems } from '../../src/sim/systems';
import type { M2W } from '../../src/worker/protocol';
import { periodicSnapshotDue, SNAPSHOT_SIM_DAYS, SNAPSHOT_WALL_MS } from '../../src/worker/recoveryMirror';
import { SimCore } from '../../src/worker/SimCore';
import { LocalSimHost } from '../../src/worker/SimHost';
import type { WorkerSimHost } from '../../src/worker/WorkerSimHost';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { bootIdb, inProcess, initialCity, send, waitFor } from './workerHarness';
import { MemStorage, PersistentMemoryKV, regionData } from '../save/fixtures';

const REGION = 'hosts', TILE = '0', KEY = `${REGION}:${TILE}`, CITY = { regionId: REGION, tileKey: TILE };
const rect = { x0: 3, z0: 3, x1: 6, z1: 6 };

/** a store whose next `failCities` city puts fail, as a full disk would */
class TestKV extends PersistentMemoryKV {
  failCities = 0;
  override async put(store: StoreName, value: unknown, key?: string): Promise<void> {
    if (store === 'cities' && this.failCities > 0) { this.failCities--; throw new Error('test: the disk is full'); }
    return super.put(store, value, key);
  }
}
let kv: TestKV;
const hosts: { dispose(): Promise<void> }[] = [];
beforeAll(async () => { await buildWorkerTest(); }, 60000);
beforeEach(async () => {
  kv = new TestKV(); setKV(kv); clearRecoveryBase();
  vi.stubGlobal('localStorage', new MemStorage());
  await kv.put('regions', regionData(REGION, 'Host Region'));
  const city = initialCity();
  await kv.put('cities', { key: KEY, regionId: REGION, tileKey: TILE, savedAt: city.savedAt, city } satisfies CityRecord, KEY);
});
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.dispose();
  clearRecoveryBase(); vi.unstubAllGlobals();
});
async function boot(opts: Partial<Parameters<typeof bootIdb>[2]> = {}): Promise<WorkerSimHost> {
  const host = await bootIdb(REGION, TILE, { kv, deterministic: true, ...opts });
  hosts.push(host); return host;
}
const record = async () => (await getCityRecord(kv, REGION, TILE))!;
const stored = (key = KEY) => kv.get<RecoveryJournal>('recovery', key);
const zoned = (st: { zone: ArrayLike<number>; idx(x: number, z: number): number }) => {
  let n = 0;
  for (let z = rect.z0; z <= rect.z1; z++) for (let x = rect.x0; x <= rect.x1; x++) if (st.zone[st.idx(x, z)] === Zone.ResLow) n++;
  return n;
};
/** the tab closes: the app's unload handler writes the journal, and nothing is saved */
async function close(host: WorkerSimHost): Promise<void> {
  host.recovery!.writeNow('pagehide');
  await host.dispose();
}
async function savedJournal(ops: RecoveryJournal['ops']): Promise<CityRecord> {
  const rec = await record();
  await storeJournalIdb(kv, { v: 1, ...CITY, at: rec.savedAt + 1, base: { kind: 'save', savedAt: rec.savedAt }, fromCmd: 0, ops });
  return rec;
}

describe('W1.3: the worker\'s own IndexedDB', () => {
  it('boots from it (main sends no city), writes its saves and snapshots there, and main keeps no recovery base', { timeout: 30000 }, async () => {
    const posted: M2W[] = [];
    const host = await boot({ wrap: (port) => ({ ...port, postMessage(m) { posted.push(m as M2W); port.postMessage(m); } }) });
    const init = posted.find((m) => m.t === 'init');
    expect(init).toMatchObject({ city: { kind: 'idb', ...CITY }, persistence: 'worker-idb' });
    expect(host.persistence).toBe('worker-idb');
    const loaded = (await record()).savedAt;
    expect((await host.snapshot('hidden'))?.marker.baseSavedAt, 'a delta of the record the worker loaded').toBe(loaded);
    await send(host, 'setTax', [DevType.R1, 12]);
    const ack = await host.save('manual');
    const rec = await record();
    expect(rec.savedAt, 'the worker put the record').toBe(ack.savedAt);
    expect(deserializeCity(rec.city).budget.taxRates[DevType.R1]).toBe(12);
    expect(getRecoveryBase(REGION, TILE), 'only the worker realm keeps the base (O6)').toBeNull();
    await send(host, 'setTax', [DevType.R1, 13]);
    const snap = await host.snapshot('hidden');
    expect(snap).toMatchObject({ ok: true, idb: true, cmd: ack.cmd + 1 });
    expect((await kv.get<{ marker: { baseSavedAt: number } }>('recovery', KEY))?.marker.baseSavedAt, 'the worker stored it, a delta of its save').toBe(ack.savedAt);
    expect(readLsJournal(), 'the page\'s mirror took the snapshot up').toMatchObject({ base: { kind: 'snapshot', at: snap!.marker.at, baseSavedAt: ack.savedAt } });
    await host.save('manual');
    expect(await kv.get('recovery', KEY), 'a save deletes the snapshot it made obsolete').toBeUndefined();
  });

  it('a save, edits, the tab closes: the title offers the journal alone, and the next worker replays it and saves before its Ready', { timeout: 30000 }, async () => {
    const first = await boot();
    const saved = await first.save('manual');
    await send(first, 'setTax', [DevType.R1, 13]);
    expect(await send(first, 'zone', [rect, Zone.ResLow])).toMatchObject({ ok: true });
    const zones = zoned(first.state);
    expect(zones).toBeGreaterThan(0);
    await first.runDays(4);
    const day = first.state.day, name = first.state.config.name;
    await close(first);
    expect(await stored(KEY + '#journal'), 'its IndexedDB copy describes the city as the page last saw it')
      .toMatchObject({ info: { cityName: name, day, why: 'pagehide' }, base: { kind: 'save', savedAt: saved.savedAt } });
    expect(await hasRecoverySnapshot(CITY), 'a journal alone counts').toBe(true);
    const offer = (await findRecoverySnapshot())!;
    expect(offer.marker).toMatchObject({ kind: 'journal', bytes: 0, baseSavedAt: saved.savedAt, cityName: name, day, why: 'pagehide' });
    expect(offer.journal?.ops.map((o) => o.op)).toEqual(['setTax', 'zone']);
    await restoreRecoverySnapshot(offer);
    expect((await record()).savedAt, 'nothing is rebuilt for a journal').toBe(saved.savedAt);
    const phases: string[] = [];
    const second = await boot({ onBoot: (phase) => phases.push(phase) });
    expect(phases).toEqual(['idb', 'deserialize', 'systems', 'journal', 'snapshot']);
    expect(second.state.budget.taxRates[DevType.R1]).toBe(13);
    expect(zoned(second.state)).toBe(zones);
    const rec = await record();
    expect(rec.savedAt, 'saved before the Ready').toBeGreaterThan(saved.savedAt);
    expect(deserializeCity(rec.city).budget.taxRates[DevType.R1]).toBe(13);
    expect(await stored(KEY + '#journal'), 'that save deleted the journal').toBeUndefined();
    expect(second.changes, 'and the city reads as saved').toBe(0);
  });

  it('a worker snapshot, then an edit: the title restores the snapshot, and the next worker replays the journal bound to it', { timeout: 30000 }, async () => {
    const first = await boot();
    await first.save('manual');
    await send(first, 'setTax', [DevType.R1, 14]);
    await first.snapshot('hidden');
    await send(first, 'plantTrees', [rect]);
    await close(first);
    const offer = (await findRecoverySnapshot(CITY))!;
    expect(offer.marker.kind).not.toBe('journal');
    await restoreRecoverySnapshot(offer);
    expect(await stored(KEY + '#journal'), 'the journal is re-bound to the restored record').toMatchObject({ base: { kind: 'save', savedAt: (await record()).savedAt } });
    const second = await boot();
    expect(second.state.budget.taxRates[DevType.R1], 'from the snapshot').toBe(14);
    let trees = 0;
    for (let z = rect.z0; z <= rect.z1; z++) for (let x = rect.x0; x <= rect.x1; x++) trees += second.state.trees[second.state.idx(x, z)] > 0 ? 1 : 0;
    expect(trees, 'from the journal').toBeGreaterThan(0);
  });

  it('a failed boot save keeps the journal, and the Ready carries the replayed edits into the page\'s mirror (seqs ≤ 0)', { timeout: 30000 }, async () => {
    const first = await boot();
    const saved = await first.save('manual');
    await send(first, 'setTax', [DevType.R1, 15]);
    await close(first);
    kv.failCities = 1;
    const reports: string[] = [];
    const second = await boot({ errors: { report: (title) => { reports.push(title); } } });
    expect(second.state.budget.taxRates[DevType.R1]).toBe(15);
    // from the Ready itself, before any packet (the first one comes with the next ping, a second later)
    expect(second.changes, 'the city reads as unsaved').toBeGreaterThan(0);
    await waitFor(() => reports.length > 0, 'the report, in the first packet after the Ready');
    expect(reports).toContain('The recovered edits could not be saved');
    expect((await record()).savedAt).toBe(saved.savedAt);
    expect(await stored(KEY + '#journal'), 'still bound to the old save').toMatchObject({ base: { kind: 'save', savedAt: saved.savedAt } });
    // a second crash before any save: the mirror still holds the replayed edit
    second.recovery!.writeNow('crash');
    expect(readLsJournal()).toMatchObject({ fromCmd: -1, ops: [{ seq: 0, op: 'setTax', args: [DevType.R1, 15] }] });
    await second.dispose();
    const third = await boot();
    expect(third.state.budget.taxRates[DevType.R1]).toBe(15);
    expect((await record()).savedAt, 'this time the boot save lands').toBeGreaterThan(saved.savedAt);
    // and the first save of a session trims what the Ready carried
    kv.failCities = 0;
    await third.save('manual');
    expect(await stored(KEY + '#journal')).toBeUndefined();
  });

  it('a worker whose IndexedDB falls back to memory is replaced by one with persistence main, which replays the journal main passes', { timeout: 30000 }, async () => {
    await savedJournal([{ seq: 1, op: 'setTax', args: [DevType.R1, 16] }]);
    const reports: string[] = [];
    const host = await boot({ memoryWorker: true, errors: { report: (title) => { reports.push(title); } } });
    expect(host.persistence).toBe('main');
    expect(reports.some((t) => /IndexedDB/.test(t))).toBe(true);
    expect(host.state.budget.taxRates[DevType.R1]).toBe(16);
    expect(host.changes, 'no save before the Ready in this mode').toBeGreaterThan(0);
    const ack = await host.save('manual');
    expect((await record()).savedAt, 'main stored the worker\'s save').toBe(ack.savedAt);
    expect(await stored(KEY + '#journal'), 'and deleted the journal it contains').toBeUndefined();
  });

  it('replayJournal false boots the save as it is and leaves the journal in place', { timeout: 30000 }, async () => {
    const rec = await savedJournal([{ seq: 1, op: 'setTax', args: [DevType.R1, 17] }]);
    const host = await boot({ replayJournal: false });
    expect(host.state.budget.taxRates[DevType.R1]).toBe(deserializeCity(rec.city).budget.taxRates[DevType.R1]);
    expect(await stored(KEY + '#journal')).toBeTruthy();
    expect((await record()).savedAt).toBe(rec.savedAt);
  });

  it('a resync re-sends the saves and snapshots the worker wrote, and loses only the reads', async () => {
    const city = initialCity();
    await kv.put('cities', { key: 'units:0', regionId: 'units', tileKey: '0', savedAt: city.savedAt, city } satisfies CityRecord, 'units:0');
    const w = inProcess([], { deterministic: true, ack: false, idb: true });
    try {
      await w.until((m) => m.t === 'ready', 'ready');
      w.send({ t: 'query', id: 5, name: 'verify', args: {} });
      w.send({ t: 'save', id: 6, reason: 'manual' });
      w.send({ t: 'snapshot', id: 7, why: 'hidden' });
      await w.until((m) => m.t === 'pkt' && !!m.p.replies?.some((r) => r.t === 'snapped' && r.id === 7), 'the snapshot reply');
      w.send({ t: 'resync' });
      await waitFor(() => w.messages.filter((m) => m.t === 'ready').length === 2, 'the second Ready');
      const at = w.messages.findLastIndex((m) => m.t === 'ready'), ready = w.messages[at];
      expect(ready.t === 'ready' && ready.lost).toEqual([5]);
      await waitFor(() => w.messages.slice(at).some((m) => m.t === 'pkt' && !!m.p.replies?.some((r) => r.t === 'snapped' && r.id === 7)), 'the re-sent replies');
      const replies = w.messages.slice(at).flatMap((m) => m.t === 'pkt' ? m.p.replies ?? [] : []);
      expect(replies.map((r) => r.t === 'error' ? r.t : `${r.t}:${r.id}`)).toEqual(['saved:6', 'snapped:7']);
      expect((await getCityRecord(kv, 'units', '0'))?.savedAt).toBe(replies[0].t === 'saved' ? replies[0].savedAt : NaN);
    } finally { w.dispose(); }
  });
});

describe('W1.3: the worker\'s save as two units (§4.2)', () => {
  it('save:copy and save:put are separate worker tasks: a command that arrives after the copy runs before the put, and the put runs in a task of its own', async () => {
    const city = initialCity();
    await kv.put('cities', { key: 'units:0', regionId: 'units', tileKey: '0', savedAt: city.savedAt, city } satisfies CityRecord, 'units:0');
    const order: string[] = [], put = kv.put.bind(kv);
    // true from the ack's packet until a long microtask chain queued then has run: the rest of that unit's task. The put's
    // continuation is queued earlier in a task that resolves it, so a put in the ack's task sees this still true.
    let ackTask = false;
    vi.spyOn(kv, 'put').mockImplementation(async (store, value, key) => {
      if (store === 'cities') order.push(ackTask ? 'put in the ack unit\'s task' : 'put');
      return put(store, value, key);
    });
    let saving = false;
    const w = inProcess([], { deterministic: true, idb: true, tap: (m, send) => {
      if (m.t !== 'pkt') return;
      if (m.p.acks?.length) {
        order.push('ack'); ackTask = true;
        const clear = (n: number): void => { if (n) queueMicrotask(() => clear(n - 1)); else ackTask = false; };
        clear(50);
      }
      // the save's boundary packet, posted inside its copy unit: a command arrives as that task ends
      if (saving) { saving = false; order.push('copy'); queueMicrotask(() => send({ t: 'cmd', seq: 1, op: 'setTax', args: [DevType.R1, 9] })); }
    } });
    try {
      await w.until((m) => m.t === 'ready', 'ready');
      saving = true;
      w.send({ t: 'save', id: 1, reason: 'manual' });
      await w.until((m) => m.t === 'pkt' && !!m.p.replies?.some((r) => r.t === 'saved'), 'the saved reply');
      expect(order).toEqual(['copy', 'ack', 'put']);
    } finally { w.dispose(); }
  });
});

describe('W1.3: the worker\'s save as two units (§4.2), the copy\'s task', () => {
  it('save:copy ends its unit: the run queued behind the save takes its first day in a later task', async () => {
    const city = initialCity();
    await kv.put('cities', { key: 'units:0', regionId: 'units', tileKey: '0', savedAt: city.savedAt, city } satisfies CityRecord, 'units:0');
    const order: string[] = [];
    // as above: true from the copy's boundary packet until the rest of that task's microtasks have run
    let saving = false, copyTask = false;
    const w = inProcess([], { deterministic: true, idb: true, tap: (m) => {
      if (m.t !== 'pkt') return;
      if (saving) {
        saving = false; order.push('copy'); copyTask = true;
        const clear = (n: number): void => { if (n) queueMicrotask(() => clear(n - 1)); else copyTask = false; };
        clear(50);
      } else if (order.length) order.push(copyTask ? 'packet in the copy\'s task' : 'packet');
    } });
    try {
      await w.until((m) => m.t === 'ready', 'ready');
      saving = true;
      w.send({ t: 'save', id: 1, reason: 'manual' });
      w.send({ t: 'cmd', seq: 1, op: 'debug.runDays', args: [2] });
      await w.until((m) => m.t === 'pkt' && !!m.p.acks?.length, 'the run\'s ack');
      await w.until((m) => m.t === 'pkt' && !!m.p.replies?.some((r) => r.t === 'saved'), 'the saved reply');
      expect(order[0]).toBe('copy');
      expect(order.length).toBeGreaterThan(2);
      expect(order).not.toContain('packet in the copy\'s task');
    } finally { w.dispose(); }
  });

  it('save:copy ends its unit, and a snapshot\'s copy ends its own (T083, W1.3 decision 19): the run queued behind the snapshot takes its first day in a later task', async () => {
    const city = initialCity();
    await kv.put('cities', { key: 'units:0', regionId: 'units', tileKey: '0', savedAt: city.savedAt, city } satisfies CityRecord, 'units:0');
    const order: string[] = [];
    // true from the snapshot's build (50-110 ms at 1M) until the rest of that task's microtasks have run
    let copyTask = false;
    const build = SimCore.prototype.copyRecoverySnapshot;
    const built = vi.spyOn(SimCore.prototype, 'copyRecoverySnapshot').mockImplementation(function (this: SimCore, ...args) {
      order.push('copy'); copyTask = true;
      const clear = (n: number): void => { if (n) queueMicrotask(() => clear(n - 1)); else copyTask = false; };
      clear(50);
      return build.apply(this, args);
    });
    const w = inProcess([], { deterministic: true, idb: true, tap: (m) => {
      if (m.t === 'pkt' && order.length) order.push(copyTask ? 'packet in the copy\'s task' : 'packet');
    } });
    try {
      await w.until((m) => m.t === 'ready', 'ready');
      w.send({ t: 'snapshot', id: 1, why: 'hidden' });
      w.send({ t: 'cmd', seq: 1, op: 'debug.runDays', args: [2] });
      await w.until((m) => m.t === 'pkt' && !!m.p.acks?.length, 'the run\'s ack');
      await w.until((m) => m.t === 'pkt' && !!m.p.replies?.some((r) => r.t === 'snapped'), 'the snapped reply');
      expect(order[0]).toBe('copy');
      expect(order.length).toBeGreaterThan(2);
      expect(order).not.toContain('packet in the copy\'s task');
    } finally { w.dispose(); built.mockRestore(); }
  });
});

describe('W1.3: LocalSimHost replays the journal too (§4.3, "in either host")', () => {
  it('replays the journal bound to its loaded save at start, unless told not to; its first save deletes it', async () => {
    await savedJournal([{ seq: 1, op: 'setTax', args: [DevType.R1, 18] }, { seq: 2, op: 'zone', args: [rect, Zone.ResLow] }]);
    const local = new LocalSimHost((await loadCity(REGION, TILE))!, { persistence: CITY });
    hosts.push(local);
    await local.start({ createSystems, CityActions });
    expect(local.state.budget.taxRates[DevType.R1]).toBe(18);
    expect(zoned(local.state)).toBeGreaterThan(0);
    expect(local.changes, 'the city reads as unsaved').toBeGreaterThan(0);
    const off = new LocalSimHost((await loadCity(REGION, TILE))!, { persistence: CITY, replayJournal: false });
    hosts.push(off);
    await off.start({ createSystems, CityActions });
    expect(off.state.budget.taxRates[DevType.R1]).not.toBe(18);
    await local.save('manual');
    expect(await stored(KEY + '#journal')).toBeUndefined();
  });
});

describe('W1.3: the title screen\'s offer of a journal alone (§4.3 Restoring)', () => {
  it('offers it only while it applies; a city\'s snapshot wins over it; discarding deletes it', async () => {
    const rec = await record();
    // bound to a save the record replaced: never offered, and deleted
    await storeJournalIdb(kv, { v: 1, ...CITY, at: rec.savedAt + 1, base: { kind: 'save', savedAt: rec.savedAt - 1 }, fromCmd: 0, ops: [{ seq: 1, op: 'setTax', args: [0, 9] }] });
    expect(await findRecoverySnapshot(CITY)).toBeNull();
    expect(await stored(KEY + '#journal')).toBeUndefined();
    // no edits: nothing to offer
    await savedJournal([]);
    expect(await findRecoverySnapshot(CITY)).toBeNull();
    expect(await stored(KEY + '#journal')).toBeUndefined();
    // with a restorable snapshot of the same city, the snapshot is the offer (its restore takes the journal bound to it)
    await savedJournal([{ seq: 1, op: 'setTax', args: [0, 9] }]);
    expect(await hasRecoverySnapshot(CITY), 'IndexedDB holds a journal alone, and no localStorage slot').toBe(true);
    const state = deserializeCity(rec.city); state.day += 3;
    const snap = buildRecoverySnapshot(REGION, TILE, state, rec, { at: rec.savedAt + 5, cityName: 'x', population: 0, funds: 0 });
    await storeRecoveryIdb(kv, snap.marker, snap.payload);
    expect((await findRecoverySnapshot(CITY))?.marker.kind).toBeUndefined();
    await kv.delete('recovery', KEY);
    const offer = (await findRecoverySnapshot(CITY))!;
    expect(offer.marker).toMatchObject({ kind: 'journal', cityName: state.config.name, regionName: 'Host Region', baseDay: Number(rec.city.scalars.day) });
    await discardRecoverySnapshot(offer.marker);
    expect(await stored(KEY + '#journal')).toBeUndefined();
    expect(await hasRecoverySnapshot(CITY)).toBe(false);
  });
});

describe('W1.3: the snapshot cadence of a packet host (§4.3 Worker)', () => {
  const base = { now: 100_000, day: 500, snapAt: 100_000, snapDay: 500, saveAt: 0, saveDay: 0 };
  it('is due every min(30 s, 90 sim days), counted from the later of the last snapshot and the last save', () => {
    expect(periodicSnapshotDue(base)).toBe(false);
    expect(periodicSnapshotDue({ ...base, now: base.now + SNAPSHOT_WALL_MS })).toBe(true);
    // ultra with autosave off: 90 days pass in 4.5 s
    expect(periodicSnapshotDue({ ...base, now: base.now + 4500, day: base.day + SNAPSHOT_SIM_DAYS })).toBe(true);
    expect(periodicSnapshotDue({ ...base, now: base.now + 4500, day: base.day + SNAPSHOT_SIM_DAYS - 1 })).toBe(false);
    // a save inside the window is the better base: the request is skipped
    const saved = { ...base, saveAt: base.now + 20_000, saveDay: base.day + 80 };
    expect(periodicSnapshotDue({ ...saved, now: base.now + SNAPSHOT_WALL_MS, day: base.day + SNAPSHOT_SIM_DAYS })).toBe(false);
    expect(periodicSnapshotDue({ ...saved, now: saved.saveAt + SNAPSHOT_WALL_MS, day: saved.saveDay + 1 })).toBe(true);
  });
});
