/** W1.1b: recovery against the loopback core, then through T032's packet host and a fresh loopback boot (T033). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import { clearRecoveryBase, getCityRecord, getRecoveryBase, loadCity, saveCity } from '../../src/save/cities';
import { setKV } from '../../src/save/db';
import {
  JOURNAL_OPS, JOURNAL_RESERVE_BYTES, LS_BUDGET_BYTES, buildRecoverySnapshot, journalMatches, rebuildRecoveredCity,
  type JournalBase, type RecoveryJournal,
} from '../../src/save/recoveryCodec';
import { adoptRecoveryJournal, findRecoverySnapshot, readRecoveryJournal, storeJournalIdb, storeRecoveryIdb } from '../../src/save/recoveryIdb';
import { peekRecoveryMarker, readLsJournal, readLsSnapshot } from '../../src/save/recoveryLs';
import * as page from '../../src/save/recovery';
import { writeRecoverySnapshot } from '../../src/save/recovery';
import * as codec from '../../src/save/serialize';
import { ReplicaSaveError } from '../../src/save/state';
import { BF, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { CityActions, type ActionResult } from '../../src/sim/actions';
import { LoopbackCore } from '../../src/worker/loopbackCore';
import { LoopbackSimHost, type LoopbackSimHostOptions } from '../../src/worker/LoopbackSimHost';
import { assertOwnedBuffers, cloneMessage, CommandOutcomeLost, type M2W } from '../../src/worker/protocol';
import { exactDigest } from '../../src/worker/queries';
import { RecoveryMirror } from '../../src/worker/recoveryMirror';
import { LocalSimHost, type Command, type SnapshotWhy } from '../../src/worker/SimHost';
import { newState, place } from '../infra/cityGen';
import { MemStorage, PersistentMemoryKV, regionData } from '../save/fixtures';

const city = { regionId: 'rtest', tileKey: '0_0' };
const rect = { x0: 3, z0: 3, x1: 6, z1: 6 };
const loops: LoopbackCore[] = [], mirrors: RecoveryMirror[] = [], hosts: LocalSimHost[] = [], packetHosts: LoopbackSimHost[] = [];
let now: number, kv: PersistentMemoryKV, storage: MemStorage;
beforeEach(() => {
  now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  kv = new PersistentMemoryKV(); setKV(kv); clearRecoveryBase();
  storage = new MemStorage(); vi.stubGlobal('localStorage', storage);
});
afterEach(async () => {
  for (const m of mirrors.splice(0)) m.dispose();
  for (const l of loops.splice(0)) l.dispose();
  for (const h of hosts.splice(0)) await h.dispose();
  for (const h of packetHosts.splice(0)) await h.dispose();
  clearRecoveryBase(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function loop(state: CityState): LoopbackCore {
  const l = new LoopbackCore(state, { modules: { CityActions } });
  loops.push(l); return l;
}

function info(state: CityState) {
  return { cityName: state.config.name, day: state.day, funds: state.funds, population: state.stats.population };
}

async function fixture() {
  const state = newState(16); state.funds = 100000; state.stats.population = 10000;
  place(state, 't_r1', 10, 10);
  await kv.put('regions', regionData());
  const savedAt = await saveCity(city.regionId, city.tileKey, state), l = loop(state);
  const abort = new AbortController();
  const mirror = new RecoveryMirror({ ...city, savedAt, info: info(state), kv, signal: abort.signal });
  mirrors.push(mirror); now = 1100;
  let seq = 0;
  const post = (command: Command, ack = true) => {
    const message = cloneMessage<M2W>({ t: 'cmd', seq: ++seq, ...command });
    if (message.t !== 'cmd') throw new Error('Expected command');
    mirror.onCommand(message.seq, message.op, message.args);
    const result = l.core.applyCommand({ op: command.op, args: message.args } as Command, l.core.actions!);
    l.flush(true);
    if (ack) mirror.onAck(seq, structuredClone(result));
    return result;
  };
  const save = async () => {
    mirror.onSaving();
    const copy = l.core.copySave(city.regionId, city.tileKey), cmd = seq;
    await l.core.putSave(copy);
    mirror.onSaved(copy.record.savedAt, cmd, info(l.primary));
    return copy.record;
  };
  const snapshot = async () => {
    // as ProtocolInbox cuts one: against the stored save, encoded to the slot less the journal's reserve
    const s = buildRecoverySnapshot(city.regionId, city.tileKey, l.primary, getRecoveryBase(city.regionId, city.tileKey),
      { ...info(l.primary), at: Date.now() }, LS_BUDGET_BYTES - JOURNAL_RESERVE_BYTES), cmd = seq;
    await storeRecoveryIdb(kv, s.marker, s.payload);
    const reply = cloneMessage({ t: 'snapped', id: 1, marker: s.marker, payload: s.payload, cmd });
    expect(mirror.onSnapped(reply.marker, reply.payload, reply.cmd)).toBe(true);
    return { ...s, cmd };
  };
  return { l, mirror, abort, post, save, snapshot, savedAt };
}

describe('RecoveryMirror', () => {
  it('restores a loopback snapshot plus the journal at the snapshot day', async () => {
    const f = await fixture();
    expect(f.post({ op: 'zone', args: [rect, Zone.ResLow] })).toMatchObject({ ok: true });
    f.l.runDays(3);
    const snap = await f.snapshot();
    f.post({ op: 'setTax', args: [DevType.R1, 13] });
    expect(f.post({ op: 'buildNetwork', args: [[{ x: 3, z: 8 }, { x: 4, z: 8 }], Network.Road] })).toMatchObject({ ok: true });
    const expected = codec.serializeCity(f.l.primary, { copy: true });
    now = 1200; f.l.runDays(2); f.mirror.writeNow('pagehide');
    expect(readLsSnapshot()?.payload).toEqual(snap.payload);
    expect(readLsJournal()).toMatchObject({ base: { kind: 'snapshot', at: 1100, baseSavedAt: 1000 }, fromCmd: 1 });
    const pending = (await findRecoverySnapshot(kv, city))!;
    const base: JournalBase = { ...city, savedAt: pending.record!.savedAt, snapshot: pending.marker };
    await adoptRecoveryJournal(kv, readLsJournal()!, base);
    const journal = (await readRecoveryJournal(kv, base))!;
    const restored = loop(codec.deserializeCity(rebuildRecoveredCity(pending)));
    expect(restored.core.replayRecoveryJournal(journal, base)).toEqual({ applied: [2, 3], failed: [] });
    restored.flush(true);
    expect(restored.state.budget.taxRates[DevType.R1]).toBe(13);
    expect(codec.serializeCity(restored.primary, { copy: true })).toEqual({ ...expected, savedAt: now });
    expect(restored.primary.day).toBe(3);
  });

  it('restores from the journal alone after save then unload, including an unacknowledged edit', async () => {
    const f = await fixture();
    f.post({ op: 'setTax', args: [DevType.R1, 11] });
    await f.snapshot(); now = 1200;
    const record = await f.save();
    f.post({ op: 'zone', args: [rect, Zone.ResLow] }, false);
    f.post({ op: 'setFunding', args: ['fire', 125] });
    const expected = codec.serializeCity(f.l.primary, { copy: true });
    f.mirror.writeNow('beforeunload');
    expect(peekRecoveryMarker()).toMatchObject({ kind: 'journal', bytes: 0, baseSavedAt: record.savedAt });
    expect(readLsSnapshot()?.payload).toBeNull();
    const journal = (await readRecoveryJournal(kv, record))!;
    expect(journal.fromCmd).toBe(1);
    expect(journal.ops.map((e) => e.seq)).toEqual([2, 3]);
    const restored = loop(codec.deserializeCity(record.city));
    expect(restored.core.replayRecoveryJournal(journal, record)).toEqual({ applied: [2, 3], failed: [] });
    expect(codec.serializeCity(restored.primary, { copy: true })).toEqual(expected);
    now = 1300;
    await restored.core.putSave(restored.core.copySave(city.regionId, city.tileKey));
    expect(await kv.get('recovery', 'rtest:0_0#journal')).toBeUndefined();
  });

  it('drops snapshots from older saves, other cities, and older command watermarks', async () => {
    const f = await fixture(), old = await f.snapshot();
    now = 1200; await f.save();
    expect(f.mirror.onSnapped(old.marker, old.payload, old.cmd)).toBe(false);
    now = 1300; f.post({ op: 'setTax', args: [DevType.R1, 14] });
    const current = await f.snapshot();
    expect(f.mirror.onSnapped({ ...current.marker, tileKey: 'other', at: 1400 }, current.payload, current.cmd)).toBe(false);
    expect(f.mirror.onSnapped({ ...current.marker, at: 1400 }, current.payload, 0)).toBe(false);
    expect(f.mirror.onSnapped({ ...current.marker, at: 1250 }, current.payload, current.cmd)).toBe(false);
    now = 1500; await f.save();
    expect(f.mirror.journal.base).toEqual({ kind: 'save', savedAt: 1500 });
    expect(f.mirror.journal.ops).toEqual([]);
    f.mirror.writeNow('pagehide');
    expect(peekRecoveryMarker()).toBeNull();
  });

  it('drops the payload on a delayed saved reply and keeps edits newer than that copy', async () => {
    const f = await fixture();
    f.post({ op: 'setTax', args: [DevType.R1, 11] });
    f.mirror.onSaving();
    const copy = f.l.core.copySave(city.regionId, city.tileKey);
    now = 1200; f.post({ op: 'setFunding', args: ['fire', 120] });
    await f.snapshot();
    expect(f.mirror.journal.ops).toEqual([]);
    await f.l.core.putSave(copy); f.mirror.onSaved(copy.record.savedAt, 1);
    f.mirror.writeNow('pagehide');
    expect(readLsSnapshot()?.payload).toBeNull();
    expect(readLsJournal()).toMatchObject({ base: { kind: 'save', savedAt: 1100 }, fromCmd: 1, ops: [{ seq: 2, op: 'setFunding' }] });
  });

  it('keeps the snapshot and journal when a full save fails', async () => {
    const f = await fixture(); f.mirror.onSaving();
    const copy = f.l.core.copySave(city.regionId, city.tileKey);
    f.post({ op: 'zone', args: [rect, Zone.ResLow] });
    const snapshot = await f.snapshot();
    f.post({ op: 'setTax', args: [DevType.R1, 13] });
    const put = vi.spyOn(kv, 'put').mockRejectedValueOnce(new Error('quota'));
    await expect(f.l.core.putSave(copy)).rejects.toThrow('quota');
    f.mirror.onSaveFailed(); put.mockRestore();
    f.mirror.writeNow('exit');
    expect(readLsSnapshot()?.payload).toEqual(snapshot.payload);
    expect(readLsJournal()).toMatchObject({ base: { kind: 'snapshot', at: snapshot.marker.at }, fromCmd: 1, ops: [{ seq: 2 }] });
    expect(getRecoveryBase(city.regionId, city.tileKey)?.savedAt).toBe(f.savedAt);
  });

  it('discards a journal when the stored record changed, including a LocalSimHost save', async () => {
    const f = await fixture(); f.post({ op: 'setTax', args: [DevType.R1, 15] }); f.mirror.writeNow('pagehide');
    const old = readLsJournal()!, record = (await getCityRecord(kv, city.regionId, city.tileKey))!;
    const local = new LocalSimHost(codec.deserializeCity(record.city), { persistence: city });
    hosts.push(local); await local.start({ CityActions }); now = 1200; await local.save('manual');
    const current = (await getCityRecord(kv, city.regionId, city.tileKey))!;
    // An unload copy from another realm/tab can arrive after the local save's cleanup.
    await storeJournalIdb(kv, old);
    expect(await readRecoveryJournal(kv, current)).toBeNull();
    expect(await kv.get('recovery', 'rtest:0_0#journal')).toBeUndefined();
    const restored = loop(codec.deserializeCity(current.city));
    expect(restored.core.replayRecoveryJournal(old, current)).toBeNull();
    expect(restored.primary.budget.taxRates[DevType.R1]).not.toBe(15);
  });

  it('replays historic and ordinance toggles as idempotent sets', async () => {
    const f = await fixture(), id = [...f.l.primary.buildings.keys()][0];
    f.post({ op: 'setHistoric', args: [id, true] });
    f.post({ op: 'setOrdinance', args: ['nuclear_free_zone', true] });
    const journal = f.mirror.journal, record = getRecoveryBase(city.regionId, city.tileKey)!;
    expect(journal.ops[1].args[2]).toEqual({ confirm: true });
    const restored = loop(codec.deserializeCity(record.city));
    expect(restored.core.replayRecoveryJournal(journal, record)?.failed).toEqual([]);
    const once = codec.serializeCity(restored.primary, { copy: true });
    expect(restored.core.replayRecoveryJournal(journal, record)?.failed).toEqual([]);
    expect(codec.serializeCity(restored.primary, { copy: true })).toEqual(once);
    expect(restored.primary.buildings.get(id)!.flags & BF.Historic).toBeTruthy();
    expect(restored.primary.budget.ordinances.filter((id) => id === 'nuclear_free_zone')).toHaveLength(1);
  });

  it('journals only the explicit op whitelist and rejects excluded ops at replay too', async () => {
    const f = await fixture();
    const included = Object.keys(JOURNAL_OPS);
    const excluded = ['setSpeed', 'resume', 'setCamera', 'dispatch', 'dispatchBest', 'dismissAlert', 'setSettings', 'holdCalendar',
      'triggerDisaster', 'debug.runDays', 'debug.verify', 'debug.setStepBudget', 'debug.setTrafficMinCycle', 'future.op', 'toString'];
    [...included, ...excluded].forEach((op, i) => f.mirror.onCommand(i + 1, op, []));
    expect(f.mirror.journal.ops.map((e) => e.op)).toEqual(included);
    const forged = f.mirror.journal;
    (forged.ops[0] as { op: string }).op = 'setSpeed';
    expect(f.l.core.replayRecoveryJournal(forged, { ...city, savedAt: f.savedAt })).toBeNull();
  });

  it('replays every whitelisted action in FIFO order with the same city and RNG', async () => {
    const f = await fixture(), id = [...f.l.primary.buildings.keys()][0];
    const road = [{ x: 3, z: 8 }, { x: 4, z: 8 }, { x: 5, z: 8 }];
    const path = [{ x: 2, z: 12 }, { x: 3, z: 12 }];
    const commands: Command[] = [
      { op: 'zone', args: [rect, Zone.ResLow] }, { op: 'dezone', args: [rect] },
      { op: 'buildNetwork', args: [road, Network.Road] }, { op: 'buildPowerLine', args: [path] },
      { op: 'buildSubway', args: [path] }, { op: 'plop', args: ['park_small', 4, 9, 0] },
      { op: 'terraform', args: ['raise', 12, 4, 1, 0.5] }, { op: 'plantTrees', args: [rect] },
      { op: 'bulldoze', args: [rect] }, { op: 'setHistoric', args: [id, true] },
      { op: 'setTax', args: [DevType.R1, 12] }, { op: 'setFunding', args: ['fire', 125] },
      { op: 'setOrdinance', args: ['nuclear_free_zone', true] }, { op: 'takeLoan', args: [10000] },
    ];
    for (const cmd of commands) {
      const result = f.post(cmd);
      if (result) expect(result, cmd.op).toMatchObject({ ok: true });
    }
    const loan = f.l.primary.budget.loans[0];
    expect(f.post({ op: 'repayLoan', args: [0, { principal: loan.principal, monthsLeft: loan.monthsLeft }] })).toMatchObject({ ok: true });
    const journal = f.mirror.journal, record = getRecoveryBase(city.regionId, city.tileKey)!;
    expect(new Set(journal.ops.map((e) => e.op))).toEqual(new Set(Object.keys(JOURNAL_OPS)));
    const restored = loop(codec.deserializeCity(record.city));
    expect(restored.core.replayRecoveryJournal(journal, record)).toEqual({ applied: journal.ops.map((e) => e.seq), failed: [] });
    expect(codec.serializeCity(restored.primary, { copy: true })).toEqual(codec.serializeCity(f.l.primary, { copy: true }));
    expect(restored.core.sim.rng.state).toBe(f.l.core.sim.rng.state);
  });

  it('removes failed acks, copies posted arguments, and drops commands that fail on the earlier base', async () => {
    const f = await fixture(), args = [rect, Zone.ResLow];
    f.mirror.onCommand(1, 'zone', args); args[0] = { ...rect, x0: 0 };
    expect(f.mirror.journal.ops[0].args[0]).toEqual(rect);
    f.mirror.onAck(1, { ok: false, cost: 0 });
    f.mirror.onCommand(2, 'plop', ['missing_def', 1, 1, 0]);
    f.mirror.onCommand(3, 'setTax', [DevType.R1, 12]);
    expect(f.l.core.replayRecoveryJournal(f.mirror.journal, { ...city, savedAt: f.savedAt })).toEqual({ applied: [3], failed: [2] });
    expect(f.mirror.journal.ops.map((e) => e.seq)).toEqual([2, 3]);
  });

  it('carries the bulldoze ack charge and preserves it when the replay quote changes', async () => {
    const f = await fixture(), path = [{ x: 3, z: 8 }, { x: 4, z: 8 }], r = { x0: 3, z0: 8, x1: 5, z1: 9 };
    f.post({ op: 'buildNetwork', args: [path, Network.Road] });
    const record = await f.save();
    const result = f.post({ op: 'bulldoze', args: [r] }) as ActionResult;
    expect(result.ok).toBe(true); expect(result.cost).toBeLessThan(0);
    const journal = f.mirror.journal;
    expect(journal.ops[0]).toMatchObject({ op: 'bulldoze', cost: result.cost, refund: result.refund });
    expect(journal.ops[0]).not.toHaveProperty('cells');
    expect(journal.ops[0]).not.toHaveProperty('refundNote');
    const restored = loop(codec.deserializeCity(record.city));
    // A changed replay quote: the street is cheaper, and the replay's fresh CityActions never built it today (FH-07a).
    for (const p of path) restored.primary.network[restored.primary.idx(p.x, p.z)] = Network.Street;
    expect(restored.core.replayRecoveryJournal(journal, record)?.failed).toEqual([]);
    expect(restored.primary.funds).toBe(Number(record.city.scalars.funds) - result.cost);
    expect(restored.primary.budget.curIncome['oneoff:refund']).toBe(-result.cost);
  });

  it('fits payload plus journal in the reserve and uses IDB when the LS journal is missing', async () => {
    const f = await fixture(), snap = await f.snapshot();
    f.post({ op: 'setTax', args: [DevType.R1, 13] }); f.mirror.writeNow('hidden');
    expect(snap.payload.byteLength + JSON.stringify(readLsJournal()).length * 2).toBeLessThanOrEqual(LS_BUDGET_BYTES);
    storage.removeItem('metropolis.recovery.journal');
    const base = { ...city, savedAt: f.savedAt, snapshot: snap.marker };
    const journal = (await readRecoveryJournal(kv, base))!;
    expect(journal.ops[0].op).toBe('setTax');
    expect(journalMatches(journal, { ...base, snapshot: { ...snap.marker, at: snap.marker.at + 1 } })).toBe(false);
    assertOwnedBuffers(snap);
  });

  it('requests a snapshot at half the reserve and writes an oversized journal to IDB only', async () => {
    const f = await fixture(), requestSnapshot = vi.fn(), abort = new AbortController();
    const mirror = new RecoveryMirror({ ...city, savedAt: f.savedAt, info: info(f.l.primary), signal: abort.signal, kv, requestSnapshot });
    mirrors.push(mirror);
    const path = Array.from({ length: 1500 }, (_, x) => ({ x, z: 3 }));
    for (let i = 1; i <= 4; i++) mirror.onCommand(i, 'buildNetwork', [path, Network.Road]);
    expect(requestSnapshot).toHaveBeenCalledOnce();
    expect(JSON.stringify(mirror.journal).length * 2).toBeGreaterThan(JOURNAL_RESERVE_BYTES);
    const put = vi.spyOn(kv, 'put'); mirror.writeNow('beforeunload');
    expect(put).toHaveBeenCalledExactlyOnceWith('recovery', mirror.journal, 'rtest:0_0#journal');
    expect(peekRecoveryMarker()).toMatchObject({ kind: 'journal', journalIdbOnly: true, bytes: 0 });
    expect(readLsJournal()).toBeNull();
    expect((await readRecoveryJournal(kv, { ...city, savedAt: f.savedAt }))?.ops).toHaveLength(4);
  });

  it('adopts the newer LS edit list when an IDB unload write failed at the same timestamp', async () => {
    const f = await fixture(), base = { ...city, savedAt: f.savedAt };
    f.post({ op: 'setTax', args: [DevType.R1, 12] }); f.mirror.writeNow('hidden');
    const put = vi.spyOn(kv, 'put').mockRejectedValueOnce(new Error('unloading'));
    f.post({ op: 'setFunding', args: ['fire', 125] }); f.mirror.writeNow('pagehide');
    expect((await readRecoveryJournal(kv, base))?.ops).toHaveLength(1);
    expect(readLsJournal()?.ops).toHaveLength(2);
    put.mockRestore();
    await adoptRecoveryJournal(kv, readLsJournal()!, base);
    expect((await readRecoveryJournal(kv, base))?.ops).toHaveLength(2);
  });

  it('carries replayed edits after a failed boot save and trims them at the first successful save', async () => {
    const f = await fixture(), base = { ...city, savedAt: f.savedAt };
    const carried: RecoveryJournal = { v: 1, ...city, at: now, base: { kind: 'save', savedAt: f.savedAt }, fromCmd: -2,
      ops: [{ seq: -1, op: 'setTax', args: [DevType.R1, 12] }, { seq: 0, op: 'setFunding', args: ['fire', 125] }] };
    const mirror = new RecoveryMirror({ ...base, signal: new AbortController().signal, info: info(f.l.primary), kv, journal: carried });
    mirrors.push(mirror); mirror.onCommand(1, 'setTax', [DevType.R2, 13]);
    mirror.writeNow('crash');
    expect((await readRecoveryJournal(kv, base))?.ops.map((e) => e.seq)).toEqual([-1, 0, 1]);
    mirror.onSaved(1200, 1);
    expect(mirror.journal.ops).toEqual([]);
    expect(mirror.journal.base).toEqual({ kind: 'save', savedAt: 1200 });
  });

  it('writes without serializing or retaining a recovery city, and stops on city abort', async () => {
    const f = await fixture(); await f.snapshot(); f.post({ op: 'setTax', args: [DevType.R1, 14] });
    clearRecoveryBase();
    const serialize = vi.spyOn(codec, 'serializeCity'), deserialize = vi.spyOn(codec, 'deserializeCity');
    const put = vi.spyOn(kv, 'put');
    f.mirror.writeNow('pagehide');
    expect(serialize).not.toHaveBeenCalled(); expect(deserialize).not.toHaveBeenCalled();
    expect(getRecoveryBase(city.regionId, city.tileKey)).toBeNull();
    expect(put).toHaveBeenCalledOnce(); expect(readLsSnapshot()?.payload).not.toBeNull();
    f.abort.abort('dispose');
    f.mirror.onCommand(10, 'setTax', [DevType.R1, 15]); f.mirror.writeNow('crash');
    expect(put).toHaveBeenCalledOnce(); expect(f.mirror.journal.ops).toEqual([]);
  });

  it('refuses the actual loopback replica at all three save entry points', async () => {
    const f = await fixture(), replica = f.l.replica.state as CityState;
    expect(() => codec.serializeCity(replica)).toThrow(ReplicaSaveError);
    await expect(saveCity(city.regionId, city.tileKey, replica)).rejects.toThrow(ReplicaSaveError);
    expect(() => writeRecoverySnapshot(city.regionId, city.tileKey, replica, info(replica))).toThrow(ReplicaSaveError);
  });

  it('keeps an in-flight ordinance as posted, and replays an applied one as a confirmed set', async () => {
    const f = await fixture();
    f.mirror.onCommand(1, 'setOrdinance', ['nuclear_free_zone', true]);
    expect(f.mirror.journal.ops[0].args).toEqual(['nuclear_free_zone', true]);
    f.mirror.onAck(1, { ok: false, cost: 0, needsConfirm: true });
    expect(f.mirror.journal.ops).toEqual([]);
    f.mirror.onCommand(2, 'setOrdinance', ['nuclear_free_zone', true]);
    f.mirror.onAck(2, { ok: true, cost: 0 });
    expect(f.mirror.journal.ops[0].args).toEqual(['nuclear_free_zone', true, { confirm: true }]);
  });

  it('books the refund the player got on its own budget line when the replay quotes a bigger one', async () => {
    const f = await fixture(), r = { x0: 3, z0: 8, x1: 5, z1: 9 };
    const built = f.post({ op: 'buildNetwork', args: [[{ x: 3, z: 8 }, { x: 4, z: 8 }], Network.Road] }) as ActionResult;
    f.l.runDays(2); // no longer built today: a quarter of the price comes back
    const charged = f.post({ op: 'bulldoze', args: [r] }) as ActionResult;
    expect(charged.refund).toBe(-charged.cost);
    expect(charged.refund).toBe(built.cost / 4);
    const journal = f.mirror.journal, record = getRecoveryBase(city.regionId, city.tileKey)!;
    expect(journal.ops[1]).toMatchObject({ op: 'bulldoze', cost: charged.cost, refund: charged.refund });
    const restored = loop(codec.deserializeCity(record.city)), budget = restored.primary.budget;
    // replayed on the save's day, the road is built and bulldozed the same day: its quote is the full price
    expect(restored.core.replayRecoveryJournal(journal, record)).toEqual({ applied: [1, 2], failed: [] });
    expect(budget.curIncome['oneoff:refund']).toBe(charged.refund);
    expect(budget.curExpense['oneoff:demolition']).toBeUndefined();
    expect(restored.primary.funds).toBe(Number(record.city.scalars.funds) - built.cost - charged.cost);
  });
});

/** T033: the mirror on T032's packet host; a fresh loopback boot of the same save replays what it journaled (§4.3). */
describe('RecoveryMirror through the loopback host', () => {
  const road = [{ x: 3, z: 8 }, { x: 4, z: 8 }], roadRect = { x0: 3, z0: 8, x1: 5, z1: 9 };
  const trees = { x0: 20, z0: 4, x1: 24, z1: 6 };
  const ops = () => readLsJournal()?.ops.map((e) => [e.seq, e.op]);

  /** the stored city a session starts from */
  async function storedCity(): Promise<void> {
    const state = newState(32); state.funds = 100000;
    place(state, 't_r1', 10, 10);
    await kv.put('regions', regionData());
    await saveCity(city.regionId, city.tileKey, state);
  }
  /** main.ts's playCity: the load sets the recovery base, then the scene's host starts (paused: no day passes) */
  async function boot(loopback?: LoopbackSimHostOptions['loopback']): Promise<LoopbackSimHost> {
    const state = (await loadCity(city.regionId, city.tileKey))!;
    const host = new LoopbackSimHost(state, { persistence: { ...city, regionName: 'Test Region' }, initialSpeed: 0, loopback });
    packetHosts.push(host);
    await host.start(); await host.drain();
    return host;
  }
  /** the page goes away: App's synchronous unload write, then the host and the realm's recovery base */
  async function unload(host: LoopbackSimHost, why: SnapshotWhy = 'pagehide'): Promise<void> {
    host.recovery!.writeNow(why);
    await host.dispose();
    clearRecoveryBase();
  }
  /** packets wait in flight until drained and the core never stalls: a resync drops what is in flight */
  const held = { lag: { seed: 3, packetTicks: 1000, longUnitChance: 0 } };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('replays the journal of a session onto a fresh boot of its save: the same city, without the excluded ops', async () => {
    await storedCity(); now = 1100;
    const host = await boot(), id = [...host.state.buildings.keys()][0];
    host.post('zone', [rect, Zone.ResLow]);
    host.post('buildNetwork', [road, Network.Road]);
    host.post('setTax', [DevType.R1, 12]); host.post('setTax', [DevType.R1, 13]);
    host.post('plop', ['park_small', 4, 12, 0]);
    host.post('terraform', ['raise', 20, 20, 1, 0.5]);
    host.post('plantTrees', [trees]);
    host.post('setFunding', ['fire', 120]);
    host.post('setHistoric', [id, true]);
    host.post('holdCalendar', [true]);
    host.post('setOrdinance', ['nuclear_free_zone', true, { confirm: true }]);
    host.post('takeLoan', [10000]);
    host.post('bulldoze', [roadRect]);
    host.post('dismissAlert', [99]);
    host.post('setSettings', [{ emergencyUncovered: 'pause', emergencyLiveSlowmo: 2, emergencyAlerts: 'all' }]);
    host.post('holdCalendar', [false]);
    await host.drain();
    const expected = exactDigest(host.harness.primary);
    expect(exactDigest(host.state)).toBe(expected);
    await unload(host);
    expect(ops()).toEqual([[1, 'zone'], [2, 'buildNetwork'], [3, 'setTax'], [4, 'plop'], [5, 'terraform'], [6, 'plantTrees'],
      [7, 'setFunding'], [8, 'setHistoric'], [10, 'setOrdinance'], [11, 'takeLoan'], [12, 'bulldoze']]);
    expect(readLsJournal()?.ops[2].args).toEqual([DevType.R1, 13]);
    // the title-time check moves the slot's journal into IDB; a journal alone has nothing to rebuild
    expect(await page.findRecoverySnapshot(city)).toBeNull();
    now = 1200;
    const fresh = await boot();
    expect(fresh.harness.recovered).toEqual({ applied: [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12], failed: [] });
    expect(exactDigest(fresh.harness.primary)).toBe(expected);
    expect(exactDigest(fresh.state)).toBe(expected);
    expect(fresh.changes).toBeGreaterThan(0); // App's dirty check sees the replayed edits as unsaved
  });

  it('restores from the journal alone after a save, edits and an unload, booking the bulldoze the player was charged', async () => {
    await storedCity(); now = 1100;
    const host = await boot();
    host.post('buildNetwork', [road, Network.Road]);
    now = 1200;
    const saved = host.save('manual'); await host.drain();
    expect(await saved).toMatchObject({ savedAt: 1200, cmd: 1 });
    // built today in this session: a full refund. Replayed on the save, the road is a base road quoted at 25 %.
    const bulldoze = host.post('bulldoze', [roadRect]); host.post('setTax', [DevType.R1, 9]);
    await host.drain();
    const charged = await bulldoze.done as ActionResult;
    const base = codec.deserializeCity((await getCityRecord(kv, city.regionId, city.tileKey))!.city);
    expect(new CityActions(new Simulation(base, [])).bulldoze(roadRect, true).refund).toBeLessThan(charged.refund!);
    const expected = exactDigest(host.harness.primary);
    now = 1300;
    // the unload's IDB write dies with the page: only the synchronous slot has these edits
    const put = vi.spyOn(kv, 'put').mockRejectedValueOnce(new Error('unloading'));
    await unload(host, 'beforeunload');
    put.mockRestore();
    expect(peekRecoveryMarker()).toMatchObject({ kind: 'journal', bytes: 0, baseSavedAt: 1200 });
    expect(readLsJournal()).toMatchObject({ base: { kind: 'save', savedAt: 1200 }, fromCmd: 1,
      ops: [{ seq: 2, op: 'bulldoze', cost: charged.cost, refund: charged.refund }, { seq: 3, op: 'setTax' }] });
    expect(await kv.get('recovery', 'rtest:0_0#journal')).toBeUndefined();
    expect(await page.findRecoverySnapshot(city)).toBeNull();
    expect(peekRecoveryMarker()).toBeNull();
    now = 1400;
    const fresh = await boot();
    expect(fresh.harness.recovered).toEqual({ applied: [2, 3], failed: [] });
    expect(exactDigest(fresh.harness.primary)).toBe(expected);
    // its first save holds the replayed edits: they leave the journal, and the save's cleanup deletes the record
    now = 1500;
    const resaved = fresh.save('manual'); await fresh.drain();
    expect((await resaved).cmd).toBe(0);
    expect(await kv.get('recovery', 'rtest:0_0#journal')).toBeUndefined();
    fresh.recovery!.writeNow('pagehide');
    expect(peekRecoveryMarker()).toBeNull();
  });

  it('keeps a correct journal across a resync: the snapshot it asks for replaces the entries whose acks were lost', async () => {
    await storedCity(); now = 1100;
    const host = await boot(held);
    const tickets = [host.post('zone', [rect, Zone.ResLow]), host.post('plop', ['missing_def', 1, 1, 0]),
      host.post('buildNetwork', [road, Network.Road]), host.post('bulldoze', [roadRect])];
    await settle();
    expect(host.harness.inbox.cmd).toBe(4);
    now = 1200;
    host.harness.post({ t: 'resync' });
    await settle();
    for (const t of tickets) await expect(t.done).rejects.toBeInstanceOf(CommandOutcomeLost);
    // until that snapshot lands the four stay journaled, the failed plop too (a replay drops it), with no charges
    host.recovery!.writeNow('hidden');
    expect(readLsJournal()).toMatchObject({ base: { kind: 'save', savedAt: 1000 }, fromCmd: 0 });
    expect(ops()).toEqual([[1, 'zone'], [2, 'plop'], [3, 'buildNetwork'], [4, 'bulldoze']]);
    expect(readLsJournal()?.ops[3]).not.toHaveProperty('cost');
    await host.drain();
    host.post('setTax', [DevType.R1, 15]); host.post('plantTrees', [trees]);
    await host.drain();
    const expected = exactDigest(host.harness.primary);
    now = 1300;
    await unload(host);
    expect(readLsJournal()).toMatchObject({ base: { kind: 'snapshot', at: 1200, baseSavedAt: 1000 }, fromCmd: 4 });
    expect(ops()).toEqual([[5, 'setTax'], [6, 'plantTrees']]);
    expect(readLsSnapshot()?.payload).not.toBeNull();
    // Recover: the snapshot becomes the save, and its journal follows it there
    const pending = (await page.findRecoverySnapshot(city))!;
    expect(pending.marker).toMatchObject({ at: 1200, baseSavedAt: 1000 });
    await page.restoreRecoverySnapshot(pending);
    expect(await kv.get('recovery', 'rtest:0_0')).toBeUndefined();
    expect(await kv.get('recovery', 'rtest:0_0#journal')).toMatchObject({ base: { kind: 'save', savedAt: 1300 }, fromCmd: 4 });
    now = 1400;
    const fresh = await boot();
    expect(fresh.harness.recovered).toEqual({ applied: [5, 6], failed: [] });
    expect(exactDigest(fresh.harness.primary)).toBe(expected);
  });

  it('rebinds the journal to a save whose reply a resync dropped, so the snapshot of that save is kept', async () => {
    await storedCity(); now = 1100;
    const host = await boot(held);
    host.post('zone', [rect, Zone.ResLow]);
    const saved = host.save('manual');
    host.post('buildNetwork', [road, Network.Road]);
    await settle(); // the save is written at the zone's watermark; its reply waits in flight
    expect((await getCityRecord(kv, city.regionId, city.tileKey))?.savedAt).toBe(1100);
    now = 1200;
    host.harness.post({ t: 'resync' });
    await expect(saved).rejects.toThrow(/interrupted by resync/);
    await host.drain();
    host.post('setFunding', ['fire', 125]); await host.drain();
    const expected = exactDigest(host.harness.primary);
    now = 1300;
    await unload(host);
    expect(readLsJournal()).toMatchObject({ base: { kind: 'snapshot', at: 1200, baseSavedAt: 1100 }, fromCmd: 2 });
    expect(ops()).toEqual([[3, 'setFunding']]);
    const pending = (await page.findRecoverySnapshot(city))!;
    expect(pending.marker.baseSavedAt).toBe(1100);
    await page.restoreRecoverySnapshot(pending);
    now = 1400;
    const fresh = await boot();
    expect(fresh.harness.recovered).toEqual({ applied: [3], failed: [] });
    expect(exactDigest(fresh.harness.primary)).toBe(expected);
  });

  it('carries the replayed edits until a save holds them, so a second crash loses nothing', async () => {
    await storedCity(); now = 1100;
    const first = await boot();
    first.post('zone', [rect, Zone.ResLow]); first.post('setTax', [DevType.R1, 12]);
    await first.drain();
    await unload(first);
    await page.findRecoverySnapshot(city);
    now = 1200;
    const second = await boot();
    expect(second.harness.recovered).toEqual({ applied: [1, 2], failed: [] });
    second.post('buildNetwork', [road, Network.Road]);
    await second.drain();
    const expected = exactDigest(second.harness.primary);
    now = 1300;
    await unload(second);
    expect(readLsJournal()).toMatchObject({ base: { kind: 'save', savedAt: 1000 }, fromCmd: -2 });
    expect(ops()).toEqual([[-1, 'zone'], [0, 'setTax'], [1, 'buildNetwork']]);
    await page.findRecoverySnapshot(city);
    now = 1400;
    const third = await boot();
    expect(third.harness.recovered).toEqual({ applied: [-1, 0, 1], failed: [] });
    expect(exactDigest(third.harness.primary)).toBe(expected);
    const saved = third.save('manual'); await third.drain();
    expect((await saved).cmd).toBe(0);
    expect(await kv.get('recovery', 'rtest:0_0#journal')).toBeUndefined();
    third.recovery!.writeNow('pagehide');
    expect(peekRecoveryMarker()).toBeNull();
  });
});
