/** W1.1b: recovery against W1.1a's unchanged loopback core, without the parallel host/worker lanes. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import { clearRecoveryBase, getCityRecord, getRecoveryBase, saveCity } from '../../src/save/cities';
import { setKV } from '../../src/save/db';
import {
  JOURNAL_OPS, JOURNAL_RESERVE_BYTES, LS_BUDGET_BYTES, journalMatches, rebuildRecoveredCity,
  type JournalBase, type RecoveryJournal,
} from '../../src/save/recoveryCodec';
import { adoptRecoveryJournal, findRecoverySnapshot, readRecoveryJournal, storeJournalIdb, storeRecoveryIdb } from '../../src/save/recoveryIdb';
import { peekRecoveryMarker, readLsJournal, readLsSnapshot } from '../../src/save/recoveryLs';
import { writeRecoverySnapshot } from '../../src/save/recovery';
import * as codec from '../../src/save/serialize';
import { ReplicaSaveError } from '../../src/save/state';
import { BF, type CityState } from '../../src/sim/CityState';
import { CityActions, type ActionResult } from '../../src/sim/actions';
import { LoopbackCore } from '../../src/worker/loopbackCore';
import { assertOwnedBuffers, cloneMessage, type M2W } from '../../src/worker/protocol';
import { RecoveryMirror } from '../../src/worker/recoveryMirror';
import { LocalSimHost, type Command } from '../../src/worker/SimHost';
import { newState, place } from '../infra/cityGen';
import { MemStorage, PersistentMemoryKV, regionData } from '../save/fixtures';

const city = { regionId: 'rtest', tileKey: '0_0' };
const rect = { x0: 3, z0: 3, x1: 6, z1: 6 };
const loops: LoopbackCore[] = [], mirrors: RecoveryMirror[] = [], hosts: LocalSimHost[] = [];
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
    const s = l.core.copyRecoverySnapshot(city.regionId, city.tileKey, info(l.primary)), cmd = seq;
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
    const excluded = ['setSpeed', 'resume', 'setCamera', 'dispatch', 'dispatchBest', 'dismissAlert', 'setSettings',
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
    expect(journal.ops[0]).toMatchObject({ op: 'bulldoze', cost: result.cost });
    expect(journal.ops[0]).not.toHaveProperty('cells');
    const restored = loop(codec.deserializeCity(record.city));
    // A changed replay quote models a refund window closing; this base has no FH-07a clock/fields yet.
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
});
