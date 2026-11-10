/**
 * T036 step 4 (NEW-04) on W1.2's real worker host (?simworker=1). WorkerSimHost stores the worker's saves and snapshots
 * on the page, through the page's KV (R14), so:
 * - the region lock fences them as it fences the local host's: a tab that lost the lock stores nothing;
 * - a full store's QuotaExceededError reaches host.save with its name, so the guided dialog opens (B9, the name lost in a
 *   Worker-protocol reply, is the loopback's; T061 item 7);
 * - Export from the guided dialog writes the running city, rebuilt from the worker's snapshot.
 * T083: since W1.3 a persistent store's worker writes its own IndexedDB ('worker-idb'), which the page's guard does not
 * reach (W1.3 decision 21). The second block is that lock case, with every write named (put, delete and clear on each
 * store): a read-only tab's worker writes nothing, at its boot (a journal bound to the save, or a pending snapshot with
 * its journal: W1.3 decision 20's boot-time delete) or later; a takeover moves the write right to the new tab's worker;
 * and the old tab's worker stops at once. T083 (b), in both persistences: a snapshot its store refuses still carries its
 * payload, so Export works from a full or read-only tab.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deserializeCity, saveRegion } from '../../src/save';
import { clearRecoveryBase, getCityRecord, type CityRecord } from '../../src/save/cities';
import { MemoryKV, RegionSaveLock, regionSaveAccess, setKV, type KV, type StoreName } from '../../src/save/db';
import { buildRecoverySnapshot, journalMatches, type RecoveryJournal } from '../../src/save/recoveryCodec';
import { storeJournalIdb, storeRecoveryIdb, type IdbRecoveryRecord } from '../../src/save/recoveryIdb';
import { readLsJournal } from '../../src/save/recoveryLs';
import { isQuotaError, snapshotRegionFile } from '../../src/ui/StorageDialog';
import type { WorkerSimHost } from '../../src/worker/WorkerSimHost';
import type { WorkerInput, WorkerPort } from '../../src/worker/workerProtocol';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { MemStorage, PersistentMemoryKV, regionData } from '../save/fixtures';
import { bootIdb, bootNode, inProcess, initialCity, send, waitFor } from './workerHarness';

const WORKER_LOCK = 'metropolis.region-worker.hosts';
const FULL = 'The quota has been exceeded.';

/** Web Locks' two promises, with a stolen lock's request rejecting with AbortError (as tests/storageDb.test.ts).
 *  Every tab and worker of the origin shares it: a worker thread's through nodeWorker.ts's bridge (`locks: true`). */
class FakeLocks {
  private held = new Map<string, { reject: (error: unknown) => void }>();
  /** T083: the names asked for, and the names whose holder a steal broke */
  readonly asked: string[] = [];
  readonly stolen: string[] = [];
  private gates = new Map<string, Promise<void>>();
  holds(name: string): boolean { return this.held.has(name); }
  /** the next grants of `name` are delivered only once the returned function is called (a real grant comes in a later task) */
  delay(name: string): () => void {
    let open!: () => void;
    this.gates.set(name, new Promise<void>((resolve) => { open = resolve; }));
    return () => { this.gates.delete(name); open(); };
  }
  request(name: string, options: LockOptions, callback: LockGrantedCallback<unknown>): Promise<unknown> {
    this.asked.push(name); timeline.push(`lock ${name}`);
    return new Promise((resolve, reject) => {
      const previous = this.held.get(name);
      if (previous && options.steal) {
        this.held.delete(name);
        this.stolen.push(name);
        previous.reject(new DOMException('Stolen', 'AbortError'));
      } else if (previous) {
        Promise.resolve(callback(null)).then(resolve, reject);
        return;
      }
      const entry = { reject }, gate = this.gates.get(name), grant = () => callback({ name, mode: 'exclusive' } as Lock);
      this.held.set(name, entry);
      (gate ? gate.then(grant) : Promise.resolve(grant())).then(() => {
        if (this.held.get(name) === entry) this.held.delete(name);
        resolve(undefined);
      }, reject);
    });
  }
}

const locks: RegionSaveLock[] = [], hosts: WorkerSimHost[] = [];
let webLocks: FakeLocks;
/** T083: lock requests and city record reads, in the order they reached this thread (a worker thread's over its bridge) */
let timeline: string[] = [];
beforeAll(async () => { await buildWorkerTest(); }, 60000);
beforeEach(() => { timeline = []; webLocks = new FakeLocks(); vi.stubGlobal('navigator', { locks: webLocks }); });
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.dispose();
  for (const lock of locks.splice(0)) lock.dispose();
  clearRecoveryBase();
  setKV(new MemoryKV());
  vi.unstubAllGlobals();
});
/** `active`: this page's lock (regionSaveAccess reads it); otherwise another tab's */
function lock(active: boolean): RegionSaveLock {
  const l = new RegionSaveLock('hosts', active);
  locks.push(l);
  return l;
}
const tax = (city: Parameters<typeof deserializeCity>[0]) => deserializeCity(city).budget.taxRates[0];

describe('NEW-04 on the worker host', () => {
  it('a tab that lost its region lock stores none of the worker\'s saves or snapshots', { timeout: 30000 }, async () => {
    const kv = new MemoryKV();
    expect(await lock(true).acquire()).toBe(true);
    const host = await bootNode(initialCity(), { kv, deterministic: true });
    try {
      const first = await host.save('manual');
      expect((await getCityRecord(kv, 'hosts', '0'))?.savedAt).toBe(first.savedAt);
      // the second tab's "Use it here instead"
      expect(await lock(false).acquire(true)).toBe(true);
      expect(regionSaveAccess('hosts')).toBe(false);
      await send(host, 'setTax', [0, 13]);
      await expect(host.save('manual')).rejects.toMatchObject({ name: 'NotAllowedError' });
      expect((await getCityRecord(kv, 'hosts', '0'))?.savedAt, 'the record is still the one this tab saved with the lock').toBe(first.savedAt);
      // T083 (b): the refused snapshot answers with its payload instead of rejecting (Export reads it); nothing is stored
      const snap = await host.snapshot('hidden');
      expect(snap).toMatchObject({ ok: false, idb: false, ls: false, marker: { baseSavedAt: first.savedAt } });
      expect(snap!.payload.length).toBeGreaterThan(0);
      expect(await kv.get('recovery', 'hosts:0'), 'no recovery snapshot either').toBeUndefined();
    } finally { await host.dispose(); }
  });

  it('a full store\'s QuotaExceededError reaches host.save with its name: the guided dialog\'s case', { timeout: 30000 }, async () => {
    class FullStore extends MemoryKV {
      override async put(store: StoreName, value: unknown, key?: string): Promise<void> {
        if (store === 'cities') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return super.put(store, value, key);
      }
    }
    const host = await bootNode(initialCity(), { kv: new FullStore(), deterministic: true });
    try {
      const error = await host.save('manual').then(() => null, (e: unknown) => e);
      expect(isQuotaError(error)).toBe(true);
    } finally { await host.dispose(); }
  });

  it('Export writes the running city from the worker\'s snapshot, not its last save', { timeout: 30000 }, async () => {
    const kv = new MemoryKV();
    setKV(kv);
    await saveRegion(regionData('hosts'));
    const host = await bootNode(initialCity(), { kv, deterministic: true });
    try {
      await host.save('manual');
      const saved = deserializeCity((await getCityRecord(kv, 'hosts', '0'))!.city).budget.taxRates[0];
      await send(host, 'setTax', [0, saved + 4]);
      const file = await snapshotRegionFile('hosts', host);
      expect(deserializeCity(file.cities['0']).budget.taxRates[0]).toBe(saved + 4);
      expect(deserializeCity((await getCityRecord(kv, 'hosts', '0'))!.city).budget.taxRates[0], 'Export saves nothing').toBe(saved);
    } finally { await host.dispose(); }
  });

  it('T083 (b): a snapshot the page\'s store refuses still carries its payload: Export works from a full store and from a tab that lost the lock', { timeout: 30000 }, async () => {
    class FillingStore extends MemoryKV {
      full = false;
      override async put(store: StoreName, value: unknown, key?: string): Promise<void> {
        if (this.full) throw new DOMException(FULL, 'QuotaExceededError');
        return super.put(store, value, key);
      }
    }
    const kv = new FillingStore();
    setKV(kv);
    expect(await lock(true).acquire()).toBe(true);
    await saveRegion(regionData('hosts'));
    const host = await bootNode(initialCity(), { kv, deterministic: true });
    try {
      const first = await host.save('manual');
      const saved = tax((await getCityRecord(kv, 'hosts', '0'))!.city);
      await send(host, 'setTax', [0, saved + 4]);
      kv.full = true;
      const refused = await host.snapshot('periodic');
      expect(refused).toMatchObject({ ok: false, idb: false, ls: false, cmd: 1, marker: { baseSavedAt: first.savedAt } });
      expect(await kv.get('recovery', 'hosts:0')).toBeUndefined();
      expect(tax((await snapshotRegionFile('hosts', host)).cities['0']), 'Export from the full store').toBe(saved + 4);
      kv.full = false;
      // a store that takes it again is told so: nothing was left behind by the refusals
      expect(await host.snapshot('hidden')).toMatchObject({ ok: true });
      expect(await kv.get('recovery', 'hosts:0')).toBeTruthy();
      // the second tab's "Use it here instead": this tab is read-only now
      expect(await lock(false).acquire(true)).toBe(true);
      await send(host, 'setTax', [0, saved + 5]);
      expect(tax((await snapshotRegionFile('hosts', host)).cities['0']), 'Export from the read-only tab').toBe(saved + 5);
      expect(tax((await getCityRecord(kv, 'hosts', '0'))!.city), 'Export saved nothing').toBe(saved);
    } finally { await host.dispose(); }
  });
});

const STORES = ['regions', 'cities', 'recovery'] as const, WRITES = ['put', 'delete', 'clear'] as const;
type Writes = Record<typeof WRITES[number], Record<StoreName, number>>;
const noWrites = (): Writes => ({ put: { regions: 0, cities: 0, recovery: 0 }, delete: { regions: 0, cities: 0, recovery: 0 }, clear: { regions: 0, cities: 0, recovery: 0 } });

/** The browser's database as a worker's own IndexedDB connection reaches it. db.ts's write guard runs in the realm
 *  that writes, so nothing here asks the page's lock (W1.3 decision 21): what refuses a write below is the worker.
 *  It counts every write that reaches it, by operation and store. */
class WorkerDb implements KV {
  readonly persistent = true;
  full = new Set<StoreName>();
  ops = noWrites();
  /** the same writes in order, with their keys */
  log: string[] = [];
  private stores: Record<StoreName, Map<string, unknown>> = { regions: new Map(), cities: new Map(), recovery: new Map() };
  /** what is written from here on is the case's */
  reset(): void { this.ops = noWrites(); this.log = []; }
  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    if (store === 'cities') timeline.push(`get ${store} ${key}`);
    const v = this.stores[store].get(key);
    return v === undefined ? undefined : structuredClone(v) as T;
  }
  async put(store: StoreName, value: unknown, key?: string): Promise<void> {
    if (this.full.has(store)) throw new DOMException(FULL, 'QuotaExceededError');
    const k = key ?? (value as { id: string }).id;
    this.ops.put[store]++; this.log.push(`put ${store} ${k}`);
    this.stores[store].set(k, structuredClone(value));
  }
  async delete(store: StoreName, key: string): Promise<void> {
    this.ops.delete[store]++; this.log.push(`delete ${store} ${key}`);
    this.stores[store].delete(key);
  }
  /** The KV has no clear today. A store emptied in one call would be a write like the others, so it is counted. */
  async clear(store: StoreName): Promise<void> {
    this.ops.clear[store]++; this.log.push(`clear ${store}`);
    this.stores[store].clear();
  }
  async getAll<T>(store: StoreName): Promise<T[]> { return [...this.stores[store].values()].map((v) => structuredClone(v) as T); }
  async keys(store: StoreName, lower?: string, upper?: string): Promise<string[]> {
    return [...this.stores[store].keys()].filter((k) => (lower === undefined || k >= lower) && (upper === undefined || k <= upper)).sort();
  }
}
/** Each store operation by name: no put, no delete and no clear reached any of the three stores. */
function expectNoWrite(db: WorkerDb, who: string): void {
  for (const op of WRITES) for (const store of STORES) expect(db.ops[op][store], `${who}: ${op} on '${store}' [${db.log.join(', ')}]`).toBe(0);
}

describe('T083: NEW-04 reaches the worker\'s own IndexedDB (persistence worker-idb)', () => {
  let db: WorkerDb;
  beforeEach(async () => {
    db = new WorkerDb(); setKV(db);
    vi.stubGlobal('localStorage', new MemStorage());
    await db.put('regions', regionData('hosts', 'Host Region'));
    const city = initialCity();
    await db.put('cities', { key: 'hosts:0', regionId: 'hosts', tileKey: '0', savedAt: city.savedAt, city } satisfies CityRecord, 'hosts:0');
    db.reset();
  });
  const record = async () => (await getCityRecord(db, 'hosts', '0'))!;
  const journalOf = (base: RecoveryJournal['base'], at: number, value: number, city = { regionId: 'hosts', tileKey: '0' }): RecoveryJournal =>
    ({ v: 1, ...city, at, base, fromCmd: 0, ops: [{ seq: 1, op: 'setTax', args: [0, value] }] });
  /** what the page posts to its worker */
  const tap = (posted: WorkerInput[]) => (port: WorkerPort): WorkerPort => ({ ...port, postMessage(m) { posted.push(m); port.postMessage(m); } });
  const said = (posted: WorkerInput[]) => posted.filter((m) => m.t === 'access');
  async function boot(opts: Partial<Parameters<typeof bootIdb>[2]> = {}): Promise<WorkerSimHost> {
    const host = await bootIdb('hosts', '0', { kv: db, deterministic: true, locks: true, ...opts });
    hosts.push(host);
    return host;
  }
  /** another tab holds the region, so this tab opens it read-only */
  async function readOnly(): Promise<void> {
    expect(await lock(false).acquire()).toBe(true);
    expect(await lock(true).acquire()).toBe(false);
    expect(regionSaveAccess('hosts')).toBe(false);
  }

  it('a read-only tab boots a city with a journal bound to its save: its worker makes no record write and no recovery delete, then or later; Export still reads the running city', { timeout: 30000 }, async () => {
    const loaded = await record(), base = tax(loaded.city);
    const journal = journalOf({ kind: 'save', savedAt: loaded.savedAt }, loaded.savedAt + 1, base + 3);
    await storeJournalIdb(db, journal);
    db.reset();
    await readOnly();
    const posted: WorkerInput[] = [], reports: string[] = [];
    const host = await boot({ wrap: tap(posted), errors: { report: (title) => { reports.push(title); } } });
    expect(host.persistence).toBe('worker-idb');
    expect(posted.find((m) => m.t === 'init')).toMatchObject({ persistence: 'worker-idb', writer: false });
    expect(webLocks.asked, 'the worker asks for no lock').not.toContain(WORKER_LOCK);
    // the journal is replayed for the view, as LocalSimHost replays it; W1.3's save before the Ready is not this tab's to make
    expect(host.state.budget.taxRates[0]).toBe(base + 3);
    expect(host.changes, 'the city reads as unsaved').toBeGreaterThan(0);
    expectNoWrite(db, 'the boot');
    expect((await record()).savedAt, 'the record is the holder\'s').toBe(loaded.savedAt);
    expect(await db.get('recovery', 'hosts:0#journal'), 'and the journal stays for it').toEqual(journal);
    // whatever is asked of it later
    await send(host, 'setTax', [0, base + 5]);
    await expect(host.save('manual')).rejects.toMatchObject({ name: 'NotAllowedError', message: 'This region is open in another tab' });
    await expect(host.save('autosave')).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(await host.snapshot('periodic')).toMatchObject({ ok: false, idb: false, ls: false, marker: { baseSavedAt: loaded.savedAt } });
    expect(await host.snapshot('hidden')).toMatchObject({ ok: false, idb: false, ls: false });
    expect(tax((await snapshotRegionFile('hosts', host)).cities['0']), 'Export from the read-only tab').toBe(base + 5);
    expectNoWrite(db, 'the session');
    expect(reports, 'and a refusal for the lock is not an error').toEqual([]);
  });

  it('a read-only tab boots a city with a pending snapshot and its journal: its worker deletes neither (W1.3 decision 20, the boot-time journal delete) and writes nothing', { timeout: 30000 }, async () => {
    const loaded = await record(), base = tax(loaded.city);
    // the holder's session left a snapshot, a delta of the save, and the journal that extends it; no Recover has run yet
    const state = deserializeCity(loaded.city);
    state.day += 3; state.budget.taxRates[0] = base + 2;
    const snap = buildRecoverySnapshot('hosts', '0', state, loaded, { at: loaded.savedAt + 5, cityName: 'x', population: 0, funds: 0 });
    const journal = journalOf({ kind: 'snapshot', at: snap.marker.at, baseSavedAt: loaded.savedAt }, snap.marker.at + 1, base + 4);
    await storeRecoveryIdb(db, snap.marker, snap.payload);
    await storeJournalIdb(db, journal);
    db.reset();
    await readOnly();
    const reports: string[] = [];
    const host = await boot({ errors: { report: (title) => { reports.push(title); } } });
    // the worker boots the save: the snapshot is the holder's to restore, and its journal does not extend the save
    expect(host.state.budget.taxRates[0]).toBe(base);
    expect(host.changes).toBe(0);
    // the journal "can never apply" to the save this worker loaded, which is where a worker realm deleted it
    expectNoWrite(db, 'the boot');
    const kept = await db.get<RecoveryJournal>('recovery', 'hosts:0#journal');
    expect(kept, 'the journal of the pending snapshot').toEqual(journal);
    expect((await db.get<IdbRecoveryRecord>('recovery', 'hosts:0'))?.marker, 'and the snapshot').toEqual(snap.marker);
    expect(journalMatches(kept!, { regionId: 'hosts', tileKey: '0', savedAt: loaded.savedAt, snapshot: snap.marker }), 'still the holder\'s to restore').toBe(true);
    await send(host, 'setTax', [0, base + 6]);
    await expect(host.save('manual')).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(await host.snapshot('hidden'), 'a snapshot of this tab does not replace the holder\'s').toMatchObject({ ok: false, idb: false });
    expectNoWrite(db, 'the session');
    expect((await db.get<IdbRecoveryRecord>('recovery', 'hosts:0'))?.marker.at).toBe(snap.marker.at);
    expect(reports).toEqual([]);
  });

  it('a takeover during a session: the page\'s loss reaches its worker at once (the relay), which makes no further write and lets its own lock go; taking the region back gives the write right back', { timeout: 30000 }, async () => {
    const mine = lock(true);
    expect(await mine.acquire()).toBe(true);
    const posted: WorkerInput[] = [];
    const host = await boot({ wrap: tap(posted) });
    expect(posted.find((m) => m.t === 'init')).toMatchObject({ writer: true });
    const first = await host.save('manual');
    expect(db.log, 'the holder\'s save: the record, then the recovery records it made obsolete').toEqual(['put cities hosts:0', 'delete recovery hosts:0', 'delete recovery hosts:0#journal']);
    expect(webLocks.holds(WORKER_LOCK)).toBe(true);
    await send(host, 'setTax', [0, 13]);
    // the second tab's "Use it here instead": this page's lock request rejects with AbortError, and its handler tells the worker
    const other = lock(false);
    expect(await other.acquire(true)).toBe(true);
    expect(said(posted)).toEqual([{ t: 'access', writable: false }]);
    db.reset();
    // (the page itself would not ask any more; the worker is what refuses here)
    await expect(host.save('manual')).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(host.save('autosave')).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(await host.snapshot('periodic')).toMatchObject({ ok: false, idb: false });
    expect(await host.snapshot('hidden')).toMatchObject({ ok: false, idb: false });
    expectNoWrite(db, 'the old tab after the takeover');
    expect((await record()).savedAt).toBe(first.savedAt);
    expect(webLocks.holds(WORKER_LOCK), 'free for the new tab\'s worker, without a steal').toBe(false);
    expect(webLocks.stolen).toEqual(['metropolis.region.hosts']);
    // this tab takes the region back: the worker writes again. Its own lock is granted a moment after the page's word,
    // and the save asked for at once waits for it instead of being refused
    const grant = webLocks.delay(WORKER_LOCK);
    expect(await mine.acquire(true)).toBe(true);
    expect(said(posted)).toEqual([{ t: 'access', writable: false }, { t: 'access', writable: true }]);
    const saving = host.save('manual');
    let settled = false;
    void saving.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(settled, 'the save waits for the worker\'s lock').toBe(false);
    expectNoWrite(db, 'before the worker\'s lock is its own');
    grant();
    const again = await saving;
    expect(db.ops.put.cities).toBe(1);
    expect((await record()).savedAt).toBe(again.savedAt);
    expect(tax((await record()).city)).toBe(13);
    expect(webLocks.holds(WORKER_LOCK)).toBe(true);
    // and once more, for a snapshot: lost, taken back, and the snapshot asked for at once is stored when the lock comes
    await send(host, 'setTax', [0, 14]);
    expect(await other.acquire(true)).toBe(true);
    const regrant = webLocks.delay(WORKER_LOCK);
    expect(await mine.acquire(true)).toBe(true);
    expect(said(posted).map((m) => m.t === 'access' && m.writable)).toEqual([false, true, false, true]);
    const snapping = host.snapshot('hidden');
    settled = false;
    void snapping.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(settled, 'the snapshot waits for the worker\'s lock').toBe(false);
    regrant();
    expect(await snapping).toMatchObject({ ok: true, idb: true });
  });

  it('a takeover moves the write right to the new tab\'s worker, and the old tab\'s worker stops writing at once: its own lock is stolen (AbortError) before its page has said anything', { timeout: 30000 }, async () => {
    // Both pages say "writer": the old tab's page has not relayed its loss yet, so only the worker's own lock stops its worker.
    const toOld: WorkerInput[] = [];
    const oldTab = await boot({ wrap: tap(toOld) });
    expect(toOld.find((m) => m.t === 'init')).toMatchObject({ writer: true });
    expect(webLocks.holds(WORKER_LOCK)).toBe(true);
    const first = await oldTab.save('manual');
    expect((await record()).savedAt).toBe(first.savedAt);
    await send(oldTab, 'setTax', [0, 13]);
    // the new tab's city opens after its "Use it here instead": its worker takes the write right before it reads the city,
    // so nothing the old tab's worker starts from then on can land behind the record the new one loads
    const from = timeline.length;
    const newTab = await boot();
    expect(webLocks.stolen, 'the old worker\'s request rejected with AbortError').toEqual([WORKER_LOCK]);
    expect(timeline.slice(from).filter((e) => e === `lock ${WORKER_LOCK}` || e === 'get cities hosts:0').slice(0, 2), 'the lock, then the record')
      .toEqual([`lock ${WORKER_LOCK}`, 'get cities hosts:0']);
    db.reset();
    await expect(oldTab.save('manual')).rejects.toMatchObject({ name: 'NotAllowedError' });
    await expect(oldTab.save('autosave')).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(await oldTab.snapshot('periodic')).toMatchObject({ ok: false, idb: false });
    expect(await oldTab.snapshot('hidden')).toMatchObject({ ok: false, idb: false });
    expectNoWrite(db, 'the old tab\'s worker after the takeover');
    expect((await record()).savedAt).toBe(first.savedAt);
    expect(said(toOld), 'and its page had told it nothing').toEqual([]);
    // the write right is the new tab's worker's
    await send(newTab, 'setTax', [0, 11]);
    const second = await newTab.save('manual');
    expect(db.log, 'the new tab\'s save').toEqual(['put cities hosts:0', 'delete recovery hosts:0', 'delete recovery hosts:0#journal']);
    const rec = await record();
    expect(rec.savedAt).toBe(second.savedAt);
    expect(tax(rec.city)).toBe(11);
    await send(newTab, 'setTax', [0, 12]);
    expect(await newTab.snapshot('hidden')).toMatchObject({ ok: true, idb: true });
    expect((await db.get<IdbRecoveryRecord>('recovery', 'hosts:0'))?.marker.baseSavedAt).toBe(second.savedAt);
    // the old tab closing its city takes nothing from the new one
    await oldTab.dispose();
    expect(webLocks.holds(WORKER_LOCK)).toBe(true);
    await send(newTab, 'setTax', [0, 10]);
    expect((await newTab.save('manual')).savedAt).toBe((await record()).savedAt);
  });

  it('without Web Locks in the worker realm, the page\'s word alone moves the write right', { timeout: 30000 }, async () => {
    const mine = lock(true);
    expect(await mine.acquire()).toBe(true);
    const host = await boot({ locks: false });
    const first = await host.save('manual');
    await send(host, 'setTax', [0, 13]);
    expect(await lock(false).acquire(true)).toBe(true);
    db.reset();
    await expect(host.save('manual')).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(await host.snapshot('hidden')).toMatchObject({ ok: false, idb: false });
    expectNoWrite(db, 'the old tab after the takeover');
    expect((await record()).savedAt).toBe(first.savedAt);
    expect(webLocks.asked).not.toContain(WORKER_LOCK);
  });

  describe('the production worker loop in this realm', () => {
    const UNITS_LOCK = 'metropolis.region-worker.units', UNITS = { regionId: 'units', tileKey: '0' };
    let loaded: CityRecord;
    beforeEach(async () => {
      const city = initialCity();
      loaded = { key: 'units:0', ...UNITS, savedAt: city.savedAt, city };
      await db.put('cities', loaded, 'units:0');
      db.reset();
    });

    it('a loss that arrives while the worker boots is applied on arrival: the journal it replays is not saved', async () => {
      const base = tax(loaded.city);
      await storeJournalIdb(db, journalOf({ kind: 'save', savedAt: loaded.savedAt }, loaded.savedAt + 1, base + 3, UNITS));
      db.reset();
      // init says "writer" (inProcess leaves the field out); the page's lock is stolen before the worker has read the city
      const w = inProcess([], { deterministic: true, idb: true });
      try {
        w.send({ t: 'access', writable: false });
        const ready = await w.until((m) => m.t === 'ready', 'ready');
        if (ready.t !== 'ready') throw new Error('unreachable');
        expect(tax(ready.snapshot), 'replayed for the view').toBe(base + 3);
        expect(ready.journal?.ops, 'and carried, as a save that did not happen').toMatchObject([{ seq: 0, op: 'setTax' }]);
        expect(ready.savedAt).toBe(loaded.savedAt);
        expectNoWrite(db, 'the boot');
        expect(webLocks.holds(UNITS_LOCK)).toBe(false);
      } finally { w.dispose(); }
    });

    it('a loss while the save before the Ready is on its way: the store refuses the write, and that is not reported as an error', async () => {
      /** this realm's own store (MemoryKV's put runs db.ts's guard), where the page's word arrives just before the put */
      class Late extends PersistentMemoryKV {
        before: (() => void) | null = null;
        override async put(store: StoreName, value: unknown, key?: string): Promise<void> {
          if (store === 'cities') { const before = this.before; this.before = null; before?.(); }
          return super.put(store, value, key);
        }
      }
      const kv = new Late(); setKV(kv);
      await kv.put('cities', loaded, 'units:0');
      await storeJournalIdb(kv, journalOf({ kind: 'save', savedAt: loaded.savedAt }, loaded.savedAt + 1, tax(loaded.city) + 3, UNITS));
      const w = inProcess([], { deterministic: true, idb: true });
      kv.before = () => w.send({ t: 'access', writable: false });
      try {
        const ready = await w.until((m) => m.t === 'ready', 'ready');
        expect(ready.t === 'ready' && ready.journal?.ops, 'the edits ride in the Ready').toMatchObject([{ seq: 0, op: 'setTax' }]);
        expect(kv.before, 'the save was on its way').toBeNull();
        expect((await getCityRecord(kv, 'units', '0'))?.savedAt).toBe(loaded.savedAt);
        w.send({ t: 'ping', n: 1 });
        await w.until((m) => m.t === 'pkt' && m.p.pong === 1, 'the packets after the Ready');
        expect(w.packets().flatMap((p) => p.replies ?? []).filter((r) => r.t === 'error')).toEqual([]);
      } finally { w.dispose(); }
    });

    it('a worker that closes lets its lock go and lifts its fence', async () => {
      const w = inProcess([], { deterministic: true, idb: true });
      try {
        await w.until((m) => m.t === 'ready', 'ready');
        expect(webLocks.holds(UNITS_LOCK)).toBe(true);
        expect(webLocks.stolen).toEqual([]);
      } finally { w.dispose(); }
      await waitFor(() => !webLocks.holds(UNITS_LOCK), 'the lock\'s release');
      expect(regionSaveAccess('units')).toBe(true);
    });
  });

  it('(b) a full store still answers a snapshot with its payload, so Export works; the journal mirror keeps the base that is stored', { timeout: 30000 }, async () => {
    const host = await boot();
    const saved = await host.save('manual');
    await send(host, 'setTax', [0, 13]);
    db.full.add('recovery'); db.full.add('cities');
    db.reset();
    const snap = await host.snapshot('periodic');
    expect(snap).toMatchObject({ ok: false, idb: false, ls: false, marker: { baseSavedAt: saved.savedAt } });
    expect(snap!.payload.length).toBeGreaterThan(0);
    expectNoWrite(db, 'the full store');
    // the page's mirror did not rebind its journal to a snapshot no store holds: the unload write is the save's journal
    host.recovery!.writeNow('pagehide');
    expect(readLsJournal()).toMatchObject({ base: { kind: 'save', savedAt: saved.savedAt }, ops: [{ op: 'setTax', args: [0, 13] }] });
    expect(tax((await snapshotRegionFile('hosts', host)).cities['0']), 'Export from the full store').toBe(13);
    // (c): the worker's own failed save keeps its name too, the guided dialog's case
    const error = await host.save('manual').then(() => null, (e: unknown) => e);
    expect(isQuotaError(error)).toBe(true);
    expect((error as Error).message).toBe(FULL);
    // with room again, the snapshot is stored and the mirror takes it up
    db.full.clear();
    const stored = await host.snapshot('hidden');
    expect(stored).toMatchObject({ ok: true, idb: true });
    expect(readLsJournal()).toMatchObject({ base: { kind: 'snapshot', at: stored!.marker.at, baseSavedAt: saved.savedAt } });
  });
});
