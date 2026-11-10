/**
 * T028b: the acceptance harness's recovery-mirror row (tools/qa-worker/journal.mjs and checks.mjs's recoveryMirror)
 * against what W1.3 really stores, for each host and persistence mode. No browser: the App is stood in for by the one
 * call its pagehide handler makes on a host whose store persists (main.ts snapshotNow: host.recovery?.writeNow(why)),
 * localStorage by the tests' MemStorage, and IndexedDB by a facade over the tests' KV, which the real worker also
 * writes through nodeWorker.ts's bridge, as a browser's worker writes the page's database. So the row's page reads and
 * its verdict run on records written by the hosts' own code.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Zone } from '../../src/core/types';
import { clearRecoveryBase, getCityRecord, loadCity, type CityRecord } from '../../src/save/cities';
import { MemoryKV, setKV, type KV } from '../../src/save/db';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import type { WorkerSimHost } from '../../src/worker/WorkerSimHost';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { recoveryMirror, type RecoveryDriver } from '../../tools/qa-worker/checks.mjs';
import { fakeIndexedDB } from '../../tools/qa-worker/fake-idb.mjs';
import { Report } from '../../tools/qa-worker/harness.mjs';
import { MemStorage, PersistentMemoryKV, regionData } from '../save/fixtures';
import { bootIdb, bootNode, initialCity } from './workerHarness';

const REGION = 'hosts', TILE = '0', KEY = `${REGION}:${TILE}`;
type Host = WorkerSimHost | LoopbackSimHost;
let kv: PersistentMemoryKV;
/** strokes made in this test: each zones a fresh row of the city (a cell already zoned is refused) */
let strokes = 0;
const hosts: { dispose(): Promise<void> }[] = [];
beforeAll(async () => { await buildWorkerTest(); }, 60000);
beforeEach(async () => {
  strokes = 0;
  kv = new PersistentMemoryKV(); setKV(kv); clearRecoveryBase();
  vi.stubGlobal('localStorage', new MemStorage());
  vi.spyOn(console, 'log').mockImplementation(() => {}); // the Report prints each row
  await kv.put('regions', regionData(REGION, 'Host Region'));
  const city = initialCity();
  await kv.put('cities', { key: KEY, regionId: REGION, tileKey: TILE, savedAt: city.savedAt, city } satisfies CityRecord, KEY);
});
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.dispose();
  clearRecoveryBase(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function worker(opts: Partial<Parameters<typeof bootIdb>[2]> = {}): Promise<WorkerSimHost> {
  const host = await bootIdb(REGION, TILE, { kv, deterministic: true, ...opts });
  hosts.push(host); return host;
}
/** as main.ts enters a city on `?simworker=loopback`: loadCity (the page's recovery base), then the host and its core */
async function loopback(): Promise<LoopbackSimHost> {
  const host = new LoopbackSimHost((await loadCity(REGION, TILE))!, { initialSpeed: 0, persistence: { regionId: REGION, tileKey: TILE } });
  hosts.push(host);
  await host.start(); await host.drain();
  return host;
}
/** settle what the host has posted: the loopback's deterministic core runs on drain, the worker on its own thread */
async function settled<T>(host: Host, work: Promise<T>): Promise<T> {
  if (host instanceof LoopbackSimHost) await host.drain();
  return work;
}

/**
 * The harness's Driver for this row, on a booted host: `page.evaluate` runs the row's page functions here, against
 * the page globals below, and `draw` makes the edit a zone stroke ends in (a posted, acknowledged zone command).
 * `store`: the page's store, which is also what the facade reads. `afterDraw` runs after the nth edit's ack.
 */
function driver(host: Host, store: KV, opts: { ackTimeout?: number; afterDraw?: (n: number) => Promise<unknown> } = {}): RecoveryDriver & { draws: number[][] } {
  vi.stubGlobal('PageTransitionEvent', class { constructor(readonly type: string) {} });
  vi.stubGlobal('indexedDB', fakeIndexedDB(store));
  vi.stubGlobal('window', {
    __metropolis: { persistent: store.persistent, region: { data: { id: REGION } }, city: { tile: { key: TILE }, scene: { host } } },
    // main.ts: pagehide → snapshotNow('pagehide'), which returns early unless the store persists, then writes the mirror
    dispatchEvent(event: { type: string }) { if (event.type === 'pagehide' && store.persistent) host.recovery?.writeNow('pagehide'); return true; },
  });
  const draws: number[][] = [];
  return {
    draws, options: { host: host.kind, ackTimeout: opts.ackTimeout ?? 5000 },
    page: { evaluate: async (fn, arg) => fn(arg) },
    async draw(op, tool, cell) {
      expect([op, tool]).toEqual(['zone', 'zone:1']);
      draws.push(cell);
      // the harness zones (146,154), then (148,154) on a retry, in a 256² city: the same strokes on this 32² one, each
      // on a free row north of its buildings
      const x0 = cell[0] - 140, z0 = 3 + 2 * strokes++;
      const ticket = host.post('zone', [{ x0, z0, x1: x0 + 1, z1: z0 + 1 }, Zone.ResLow]);
      host.flushCommands();
      expect(await settled(host, ticket.done)).toMatchObject({ ok: true });
      await opts.afterDraw?.(draws.length);
      return [{ seq: ticket.seq }];
    },
  };
}
/** the row as a run adds it, after the zone check it depends on */
async function row(d: RecoveryDriver) {
  const report = new Report();
  report.checks.push({ name: 'zone', status: 'PASS', reason: 'the zone check, run earlier' });
  await recoveryMirror(d, report);
  expect(report.checks.map((c) => c.name)).toEqual(['zone', 'recovery mirror']);
  return { status: report.checks[1].status, reason: report.checks[1].reason, details: report.details };
}

describe('qa-worker\'s recovery-mirror row on what W1.3 stores (T028b)', () => {
  it('worker, persistence worker-idb: passes on the page\'s two journal copies and on the worker\'s own save and snapshot records', { timeout: 30000 }, async () => {
    const host = await worker();
    expect(host.persistence).toBe('worker-idb');
    const d = driver(host, kv);
    let r = await row(d);
    expect(r.reason).toMatch(/^worker, persistence 'worker-idb': App pagehide wrote 1 whitelisted edits bound to save; UI zone seq 1 retained in localStorage and in IndexedDB recovery\/hosts:0#journal; IndexedDB holds that save \(the worker wrote it on its own connection and replays the journal at boot\)$/);
    expect(r.status).toBe('PASS');
    expect(r.details.recoveryMode).toEqual({ kind: 'worker', persistence: 'worker-idb', storePersistent: true, mirror: true, regionId: REGION, tileKey: TILE });
    expect(r.details.recoveryStores.idb).toMatchObject({ key: KEY, savedAt: (await getCityRecord(kv, REGION, TILE))!.savedAt, snapshot: null });
    // the worker stores a snapshot through its own connection, and the journal then extends that snapshot
    const snap = (await host.snapshot('hidden'))!;
    expect(snap).toMatchObject({ ok: true, idb: true });
    r = await row(d);
    expect(r.reason).toMatch(/^worker, persistence 'worker-idb': App pagehide wrote 1 whitelisted edits bound to snapshot; UI zone seq 2 retained .*; IndexedDB holds that snapshot and its save \(the worker wrote it/);
    expect(r.status).toBe('PASS');
    expect(r.details.recoveryStores.idb.snapshot).toMatchObject({ at: snap.marker.at, baseSavedAt: snap.marker.baseSavedAt });
    expect(d.draws).toEqual([[146, 154], [146, 154]]);
  });

  it('worker, persistence main (its IndexedDB fell back to memory): passes on the journal and on the records main stored', { timeout: 30000 }, async () => {
    const reports: string[] = [];
    const host = await worker({ memoryWorker: true, errors: { report: (title) => { reports.push(title); } } });
    expect(host.persistence).toBe('main');
    expect(reports.some((title) => /IndexedDB/.test(title))).toBe(true);
    const d = driver(host, kv);
    let r = await row(d);
    expect(r.reason).toMatch(/^worker, persistence 'main': App pagehide wrote 1 whitelisted edits bound to save; .* \(main stored it and passes the journal in init\.journal: the worker's IndexedDB was unavailable\)$/);
    expect(r.status).toBe('PASS');
    expect((await host.snapshot('hidden'))?.ok).toBe(true);
    r = await row(d);
    expect(r.reason).toMatch(/bound to snapshot; .* IndexedDB holds that snapshot and its save \(main stored it/);
    expect(r.status).toBe('PASS');
  });

  it('worker with a store that does not persist: no journal by design, so the row is SKIPPED with that reason and edits nothing', { timeout: 30000 }, async () => {
    const memory = new MemoryKV();
    const host = await bootNode(initialCity(), { kv: memory, deterministic: true });
    hosts.push(host);
    expect([host.persistence, host.recovery]).toEqual(['main', null]);
    const d = driver(host, memory);
    const r = await row(d);
    expect(r.status).toBe('SKIPPED');
    expect(r.reason).toMatch(/^no journal by design: the page's store does not persist .* W1\.3 then runs persistence 'main' without a journal mirror/);
    expect(d.draws).toEqual([]);
  });

  it('a worker host without the mirror while its store persists (W1.2\'s shape) is a FAIL, where the old row skipped', { timeout: 30000 }, async () => {
    const host = await worker({ journal: false });
    expect([host.persistence, host.recovery]).toEqual(['worker-idb', null]);
    const d = driver(host, kv);
    const r = await row(d);
    expect(r.status).toBe('FAIL');
    expect(r.reason).toMatch(/W1\.3 keeps the journal mirror on this worker host \(persistence 'worker-idb'\), but host\.recovery is null/);
    expect(d.draws).toEqual([]);
  });

  it('loopback: passes on the page\'s copies and the core\'s records; a snapshot inside the window repeats the edit once', async () => {
    const host = await loopback();
    let d = driver(host, kv);
    let r = await row(d);
    expect(r.reason).toMatch(/^loopback: App pagehide wrote 1 whitelisted edits bound to save; UI zone seq 1 retained .* \(the loopback core wrote it and replays the journal at boot\)$/);
    expect(r.status).toBe('PASS');
    // a periodic snapshot lands after the edit's ack and before pagehide: the edit is in that snapshot, so the journal
    // no longer lists it. Nothing is lost, and the attempt shows nothing: the row edits once more
    d = driver(host, kv, { afterDraw: async (n) => { if (n === 1) await settled(host, host.snapshot('periodic')); } });
    r = await row(d);
    expect(r.reason).toMatch(/^loopback: App pagehide wrote 1 whitelisted edits bound to snapshot; UI zone seq 3 retained/);
    expect(r.status).toBe('PASS');
    expect(d.draws).toEqual([[146, 154], [148, 154]]);
    expect(r.details.recoveryRebased).toMatch(/snapshot base already contains the UI edit \(seq 2, fromCmd 2\)/);
  });

  it('the IndexedDB copy is asserted: a page that writes only localStorage fails, as does a journal bound to a save the database does not hold', async () => {
    const host = await loopback();
    // the unload's IndexedDB journal put is lost (the old row read localStorage alone and passed)
    const put = kv.put.bind(kv);
    const lost = vi.spyOn(kv, 'put').mockImplementation(async (store, value, key) => { if (!key?.endsWith('#journal')) await put(store, value, key); });
    let r = await row(driver(host, kv, { ackTimeout: 300 }));
    expect(r.status).toBe('FAIL');
    expect(r.reason).toMatch(/pagehide left no journal record in IndexedDB \(recovery\/hosts:0#journal\)/);
    lost.mockRestore();
    // the stored save is replaced behind the journal's back: the next boot would discard this journal (journalMatches)
    const record = (await getCityRecord(kv, REGION, TILE))!;
    await kv.put('cities', { ...record, savedAt: record.savedAt + 5 }, KEY);
    const d = driver(host, kv);
    r = await row(d);
    expect(r.status).toBe('FAIL');
    expect(r.reason).toMatch(new RegExp(`bound to the save of ${record.savedAt}, but IndexedDB cities/hosts:0 holds the save of ${record.savedAt + 5}; a first edit read the same way`));
    expect(d.draws).toHaveLength(2);
  });
});
