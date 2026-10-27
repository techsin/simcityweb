/** Shared by hosts.test and the plain-node preflight when Vite cannot start in a restricted sandbox. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Network, Zone, DevType } from '../../../src/core/types';
import { serializeCity, deserializeCity, type SerializedCity } from '../../../src/save/serialize';
import { encodeBundle } from '../../../src/save/bundleCodec';
import { getCityRecord } from '../../../src/save/cities';
import { MemoryKV, openKV, type StoreName } from '../../../src/save/db';
import { CityActions, type ActionResult } from '../../../src/sim/actions';
import type { CityState } from '../../../src/sim/CityState';
import { createSystems } from '../../../src/sim/systems';
import { LocalSimHost, type Command } from '../../../src/worker/SimHost';
import { LoopbackCore } from '../../../src/worker/loopbackCore';
import { WorkerSimHost } from '../../../src/worker/WorkerSimHost';
import { exactDigest } from '../../../src/worker/queries';
import { rebuildRecoveredCity } from '../../../src/save/recoveryCodec';
import { newState, place } from '../../../tests/infra/cityGen';
import { nodeWorkerPort } from './nodePort';

export function initialCity(): SerializedCity {
  const st = newState(32); st.config.seed = 7; st.funds = 1e6;
  place(st, 't_coal', 2, 13); place(st, 't_pump', 6, 14);
  for (let x = 4; x < 20; x += 2) place(st, 't_r1', x, 17, { pop: 10, capacity: 12 });
  place(st, 't_cs', 22, 17, { jobs: 20 });
  const city = serializeCity(st, { copy: true }); city.savedAt = 1; return city;
}
function hash(city: SerializedCity): string {
  return createHash('sha256').update(encodeBundle({ ...city, savedAt: 0 })).digest('hex');
}
export async function makeWorker(url: URL, city = initialCity(), kv = new MemoryKV()): Promise<WorkerSimHost> {
  const host = new WorkerSimHost({ kind: 'serialized', regionId: 'hosts', tileKey: '0', savedAt: city.savedAt, city },
    { port: nodeWorkerPort(url), kv, deterministic: true, dev: true, settings: { emergencyUncovered: 'ignore', emergencyLiveSlowmo: 3, emergencyAlerts: 'all' } });
  try { await host.ready; return host; } catch (e) { await host.dispose(); throw e; }
}
async function workerCity(host: WorkerSimHost, kv: MemoryKV): Promise<SerializedCity> {
  await host.save('manual');
  const record = await getCityRecord(kv, 'hosts', '0'); assert.ok(record); return record.city;
}

export async function hostParity(url: URL): Promise<void> {
  const city = initialCity(), kv = new MemoryKV(), worker = await makeWorker(url, city, kv);
  const local = new LocalSimHost(deserializeCity(city)), loopback = new LoopbackCore(deserializeCity(city), { recorder: { dev: true } });
  await local.start({ createSystems, CityActions });
  const script = new Map<number, Command[]>([
    [0, [{ op: 'buildNetwork', args: [Array.from({ length: 28 }, (_, x) => ({ x: x + 2, z: 16 })), Network.Road] },
      { op: 'zone', args: [{ x0: 3, z0: 18, x1: 20, z1: 20 }, Zone.ResLow] }]],
    [12, [{ op: 'plantTrees', args: [{ x0: 3, z0: 3, x1: 8, z1: 8 }] }, { op: 'setTax', args: [DevType.R1, 9.5] }]],
    [30, [{ op: 'setFunding', args: ['police', 90] }, { op: 'takeLoan', args: [10000] }]],
    [44, [{ op: 'dezone', args: [{ x0: 18, z0: 18, x1: 20, z1: 20 }] }]],
    [60, [{ op: 'setSpeed', args: [0, 'pause'] }, { op: 'resume', args: ['pause'] }]],
    [75, [{ op: 'triggerDisaster', args: ['tornado', 26, 26] }]],
    [90, [{ op: 'setHistoric', args: [3, true] }, { op: 'setCamera', args: [{ x: 10, z: 10, yaw: 1, tilt: 1, distance: 100 }] }]],
  ]);
  try {
    for (let day = 0; day <= 120; day++) {
      if ([30, 60, 120].includes(day)) {
        const saved = await workerCity(worker, kv);
        assert.equal(hash(saved), hash(serializeCity(local.sim.state, { copy: true })), `Local / Worker full save hash at day ${day}`);
        assert.equal(hash(saved), hash(serializeCity(loopback.primary, { copy: true })), `Loopback / Worker full save hash at day ${day}`);
        assert.equal(await worker.query('verify', {}), exactDigest(worker.state), `Worker replica at day ${day}`);
        assert.equal(exactDigest(loopback.state), exactDigest(worker.state), `Loopback replica at day ${day}`);
      }
      for (const c of script.get(day) ?? []) {
        const expected = await local.act(c.op, c.args).done;
        loopback.core.applyCommand(structuredClone(c), loopback.core.actions!); loopback.flush(true);
        const actual = await worker.act(c.op, c.args).done;
        // Wire acks intentionally omit preview cell lists.
        const strip = (r: unknown) => { if (!r || typeof r !== 'object') return r; const { cells: _, ...rest } = r as ActionResult; return rest; };
        assert.deepEqual(actual, strip(expected), `command ${c.op} at day ${day}`);
      }
      if (day < 120) { local.sim.runDays(1); loopback.runDays(1); await worker.runDays(1); }
    }
  } finally { await worker.dispose(); await local.dispose(); loopback.dispose(); }
}

export async function crossHostSaves(url: URL): Promise<void> {
  const city = initialCity(), kv = new MemoryKV(), worker = await makeWorker(url, city, kv);
  let loaded: LocalSimHost | undefined, other: WorkerSimHost | undefined;
  const otherKv = new MemoryKV();
  try {
    await worker.runDays(60);
    const saved = await workerCity(worker, kv);
    loaded = new LocalSimHost(deserializeCity(saved), { persistence: { regionId: 'hosts', tileKey: '0' } });
    await loaded.start({ createSystems, CityActions });
    other = await makeWorker(url, saved, otherKv);
    loaded.sim.runDays(60); await other.runDays(60);
    assert.equal(hash(await workerCity(other, otherKv)), hash(serializeCity(loaded.sim.state, { copy: true })), 'Worker save → Local load: 60-day full hash');
    assert.equal(exactDigest(other.state), exactDigest(loaded.state));
    await loaded.save('manual');
    const record = await getCityRecord(await openKV(), 'hosts', '0'); assert.ok(record);
    await loaded.dispose(); await other.dispose();
    loaded = new LocalSimHost(deserializeCity(record.city)); await loaded.start({ createSystems, CityActions });
    other = await makeWorker(url, record.city, otherKv);
    loaded.sim.runDays(60); await other.runDays(60);
    assert.equal(hash(await workerCity(other, otherKv)), hash(serializeCity(loaded.sim.state, { copy: true })), 'Local save → Worker load: 60-day full hash');
  } finally { await worker.dispose(); await loaded?.dispose(); await other?.dispose(); }
}

export async function workerBoundaries(url: URL): Promise<void> {
  const kv = new MemoryKV(), host = await makeWorker(url, initialCity(), kv);
  try {
    const tag = {}, causes: object[] = [];
    host.events.on('treesChanged', () => { if (host.cause?.tag) causes.push(host.cause.tag); });
    const ticket = host.act('plantTrees', [{ x0: 3, z0: 3, x1: 8, z1: 8 }], { tag });
    const query = host.query('verify', {});
    await ticket.done;
    assert.deepEqual(causes, [tag]); assert.equal(await query, exactDigest(host.state), 'read your writes');
    const first = await host.snapshot('hidden'); assert.ok(first?.ok);
    assert.ok(await kv.get('recovery', 'hosts:0'), 'snapshot stored by main');
    const ack = await host.save('manual'); assert.equal(ack.cmd, ticket.seq);
    assert.equal(await kv.get('recovery', 'hosts:0'), undefined, 'save drops the old recovery payload');
    await host.act('setTax', [DevType.R1, 11.5]).done;
    const snap = await host.snapshot('hidden'); assert.ok(snap);
    const record = await getCityRecord(kv, 'hosts', '0'); assert.ok(record);
    assert.equal(snap.marker.baseSavedAt, record.savedAt);
    const rebuilt = deserializeCity(rebuildRecoveredCity({ marker: snap.marker, payload: snap.payload, record }));
    assert.equal(rebuilt.budget.taxRates[DevType.R1], 11.5);
    assert.throws(() => serializeCity(host.state as CityState), /replica/i);
    await host.dispose();
    assert.throws(() => host.act('setTax', [DevType.R1, 12]), /disposed/);
    assert.equal(host.emergency.incidents().length, 0);
  } finally { await host.dispose(); }
}

export async function saveFailureChecks(url: URL): Promise<void> {
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
  const kv = new Store(), city = initialCity(), host = await makeWorker(url, city, kv);
  try {
    await assert.rejects(host.save('manual'), /test put failure/);
    const first = await host.snapshot('hidden'); assert.equal(first?.marker.baseSavedAt, city.savedAt);
    const saving = host.save('manual'); await entered;
    const ticket = host.act('setTax', [0, 13]);
    const snapshot = host.snapshot('hidden');
    let settled = false; void ticket.done.then(() => { settled = true; });
    await Promise.resolve(); assert.equal(settled, false, 'commands behind a save wait for the persistence barrier');
    release();
    const saved = await saving; await ticket.done;
    const snapped = await snapshot; assert.ok(snapped);
    assert.equal(saved.cmd, 0, 'save ack describes the copy taken before the posted tax change');
    assert.equal(snapped.cmd, ticket.seq); assert.equal(snapped.marker.baseSavedAt, saved.savedAt);
    const record = await getCityRecord(kv, 'hosts', '0'); assert.ok(record);
    assert.equal(deserializeCity(record.city).budget.taxRates[0], deserializeCity(city).budget.taxRates[0]);
    assert.equal(deserializeCity(rebuildRecoveredCity({ marker: snapped.marker, payload: snapped.payload, record })).budget.taxRates[0], 13);
  } finally { release(); await host.dispose(); }
}
