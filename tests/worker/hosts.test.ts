/**
 * W1.2's gate (T034): Local, Loopback and the real Worker (node worker_threads, the production loop) run one city and
 * one scripted command list in deterministic mode, with equal full-save hashes at days 30, 60 and 120; a save from one
 * host loads in another and continues identically; persistence 'main' stores the worker's saves and snapshots (R14).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { clearRecoveryBase, getCityRecord } from '../../src/save/cities';
import { MemoryKV, setKV, type StoreName } from '../../src/save/db';
import { rebuildRecoveredCity } from '../../src/save/recoveryCodec';
import { CityActions } from '../../src/sim/actions';
import type { CityState } from '../../src/sim/CityState';
import { createSystems } from '../../src/sim/systems';
import { LocalSimHost, type Command } from '../../src/worker/SimHost';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import type { WorkerSimHost } from '../../src/worker/WorkerSimHost';
import { exactDigest } from '../../src/worker/queries';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { bootNode, hash, initialCity, send, stripCells, within } from './workerHarness';

beforeAll(async () => { await buildWorkerTest(); }, 60000);
afterEach(() => { clearRecoveryBase(); setKV(new MemoryKV()); });

const worker = (city: SerializedCity, kv: MemoryKV) => bootNode(city, { kv, deterministic: true });
/** the worker's own full save, as main stored it */
async function saved(host: WorkerSimHost, kv: MemoryKV): Promise<SerializedCity> {
  await host.save('manual');
  const record = await getCityRecord(kv, 'hosts', '0');
  if (!record) throw new Error('no stored record');
  return record.city;
}

const SCRIPT = new Map<number, Command[]>([
  [0, [{ op: 'buildNetwork', args: [Array.from({ length: 28 }, (_, x) => ({ x: x + 2, z: 16 })), Network.Road] },
    { op: 'zone', args: [{ x0: 3, z0: 18, x1: 20, z1: 20 }, Zone.ResLow] }]],
  [12, [{ op: 'plantTrees', args: [{ x0: 3, z0: 3, x1: 8, z1: 8 }] }, { op: 'setTax', args: [DevType.R1, 9.5] }]],
  [30, [{ op: 'setFunding', args: ['police', 90] }, { op: 'takeLoan', args: [10000] }]],
  [44, [{ op: 'dezone', args: [{ x0: 18, z0: 18, x1: 20, z1: 20 }] }]],
  [60, [{ op: 'setSpeed', args: [0, 'pause'] }, { op: 'resume', args: ['pause'] }]],
  [75, [{ op: 'triggerDisaster', args: ['tornado', 26, 26] }]],
  [90, [{ op: 'setHistoric', args: [3, true] }, { op: 'setCamera', args: [{ x: 10, z: 10, yaw: 1, tilt: 1, distance: 100 }] }]],
]);

describe('Local, Loopback and the real Worker', () => {
  it('120 scripted deterministic days give equal full-save hashes at days 30, 60 and 120', { timeout: 120000 }, async () => {
    const city = initialCity(), kv = new MemoryKV();
    const local = new LocalSimHost(deserializeCity(city));
    await local.start({ createSystems, CityActions });
    const loop = new LoopbackSimHost(deserializeCity(city), { loopback: { cadence: 'design', recorder: { dev: true } } });
    await loop.start();
    const host = await worker(city, kv);
    try {
      for (let day = 0; day <= 120; day++) {
        if (day === 30 || day === 60 || day === 120) {
          const full = hash(await saved(host, kv));
          expect(hash(serializeCity(local.sim.state, { copy: true })), `Local / Worker on day ${day}`).toBe(full);
          expect(hash(serializeCity(loop.harness.primary, { copy: true })), `Loopback / Worker on day ${day}`).toBe(full);
          // and each replica holds the exact state of its own worker side
          expect(exactDigest(host.state), `Worker replica on day ${day}`).toBe(await host.query('verify', {}));
          expect(exactDigest(loop.state), `Loopback replica on day ${day}`).toBe(exactDigest(host.state));
        }
        for (const c of SCRIPT.get(day) ?? []) {
          const expected = stripCells(await local.act(c.op, c.args).done);
          const a = loop.post(c.op, c.args), b = host.post(c.op, c.args);
          await loop.drain(); host.flushCommands();
          expect(await a.done, `Loopback ${c.op} on day ${day}`).toEqual(expected);
          expect(await b.done, `Worker ${c.op} on day ${day}`).toEqual(expected);
        }
        if (day < 120) { local.sim.runDays(1); loop.harness.runDays(1); expect(await host.runDays(1)).toBe(day + 1); }
      }
    } finally { await host.dispose(); await loop.dispose(); await local.dispose(); }
  });

  it('a save from one host loads in another and continues identically for 60 days', { timeout: 120000 }, async () => {
    const kv = new MemoryKV(), shared = new MemoryKV();
    setKV(shared);
    const first = await worker(initialCity(), kv);
    let local: LocalSimHost | undefined, other: WorkerSimHost | undefined;
    try {
      await first.runDays(60);
      const fromWorker = await saved(first, kv);
      local = new LocalSimHost(deserializeCity(fromWorker), { persistence: { regionId: 'hosts', tileKey: '0' } });
      await local.start({ createSystems, CityActions });
      const otherKv = new MemoryKV();
      other = await worker(fromWorker, otherKv);
      local.sim.runDays(60); await other.runDays(60);
      expect(hash(await saved(other, otherKv)), 'Worker save, Local and Worker loads').toBe(hash(serializeCity(local.sim.state, { copy: true })));
      expect(exactDigest(other.state)).toBe(exactDigest(local.state));
      // and back: LocalSimHost's own save (IndexedDB through openKV), loaded by a worker
      await local.save('manual');
      const record = await getCityRecord(shared, 'hosts', '0');
      if (!record) throw new Error('no local save');
      await local.dispose(); await other.dispose();
      local = new LocalSimHost(deserializeCity(record.city));
      await local.start({ createSystems, CityActions });
      const backKv = new MemoryKV();
      other = await worker(record.city, backKv);
      local.sim.runDays(60); await other.runDays(60);
      expect(hash(await saved(other, backKv)), 'Local save, Worker load').toBe(hash(serializeCity(local.sim.state, { copy: true })));
    } finally { await first.dispose(); await local?.dispose(); await other?.dispose(); }
  });
});

describe('persistence main (R14)', () => {
  it('stores the worker\'s saves and snapshots on main, answers reads after their commands, and never saves the replica', { timeout: 30000 }, async () => {
    const kv = new MemoryKV(), host = await worker(initialCity(), kv);
    try {
      const tag = {}, causes: unknown[] = [];
      host.events.on('treesChanged', () => causes.push(host.cause?.tag));
      const ticket = host.post('plantTrees', [{ x0: 3, z0: 3, x1: 8, z1: 8 }], { tag });
      const read = host.query('verify', {});
      await ticket.done;
      expect(causes).toEqual([tag]);
      expect(await read, 'read your writes: the reply follows the Ack').toBe(exactDigest(host.state));
      const first = await host.snapshot('hidden');
      // stored in IndexedDB at once; localStorage only at unload (recovery.writeNow)
      expect(first).toMatchObject({ ok: true, ls: false, cmd: ticket.seq });
      expect(await kv.get('recovery', 'hosts:0')).toBeTruthy();
      const ack = await host.save('manual');
      expect(ack.cmd).toBe(ticket.seq);
      expect(await kv.get('recovery', 'hosts:0'), 'the save drops the snapshot it made obsolete').toBeUndefined();
      await send(host, 'setTax', [DevType.R1, 11.5]);
      const snap = await host.snapshot('hidden'), record = await getCityRecord(kv, 'hosts', '0');
      if (!snap || !record) throw new Error('missing snapshot or record');
      expect(record.savedAt).toBe(ack.savedAt);
      expect(snap.marker.baseSavedAt, 'a delta of the save main stored').toBe(record.savedAt);
      expect(deserializeCity(rebuildRecoveredCity({ marker: snap.marker, payload: snap.payload, record })).budget.taxRates[DevType.R1]).toBe(11.5);
      expect(() => host.recovery!.writeNow('pagehide')).not.toThrow();
      expect(() => serializeCity(host.state as CityState)).toThrow(/replica/i);
    } finally { await host.dispose(); }
    expect(() => host.post('setTax', [DevType.R1, 12])).toThrow(/disposed/);
  });

  it('a refused put keeps the worker\'s base; commands run on while a put is held, and a snapshot then deltas against it', { timeout: 30000 }, async () => {
    let fail = true, release!: () => void, writing!: () => void;
    const entered = new Promise<void>((resolve) => { writing = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    class Store extends MemoryKV {
      override async put(store: StoreName, value: unknown, key?: string): Promise<void> {
        if (store === 'cities') {
          if (fail) { fail = false; throw new Error('test put failure'); }
          writing(); await gate;
        }
        return super.put(store, value, key);
      }
    }
    const kv = new Store(), city = initialCity(), host = await worker(city, kv);
    try {
      await expect(host.save('manual')).rejects.toThrow('test put failure');
      // the worker heard of the refusal: its next snapshot is a delta of the city it booted on
      const first = await host.snapshot('hidden');
      expect(first?.marker.baseSavedAt).toBe(city.savedAt);
      const saving = host.save('manual');
      await entered;
      // the copy is taken; the inbox runs on while main writes it (T032 minor 6)
      const tax = host.post('setTax', [0, 13]);
      host.flushCommands();
      await expect(within(tax.done)).resolves.toBeUndefined();
      const snapshot = host.snapshot('hidden');
      release();
      const done = await saving, snapped = await snapshot;
      expect(done.cmd, 'the save describes its copy, taken before the tax change').toBe(0);
      expect(snapped?.cmd).toBe(tax.seq);
      expect(snapped?.marker.baseSavedAt, 'a delta of the save that was being written').toBe(done.savedAt);
      const record = await getCityRecord(kv, 'hosts', '0');
      if (!record || !snapped) throw new Error('missing record or snapshot');
      expect(deserializeCity(record.city).budget.taxRates[0]).toBe(deserializeCity(city).budget.taxRates[0]);
      expect(deserializeCity(rebuildRecoveredCity({ marker: snapped.marker, payload: snapped.payload, record })).budget.taxRates[0]).toBe(13);
    } finally { release(); await host.dispose(); }
  });
});
