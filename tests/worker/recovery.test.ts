/** W1.1b (T033): the journal mirror against the loopback core, unit by unit and through LoopbackSimHost. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import { clearRecoveryBase, getCityRecord, getRecoveryBase, loadCity, saveCity } from '../../src/save/cities';
import { setKV } from '../../src/save/db';
import {
  JOURNAL_OPS, JOURNAL_RESERVE_BYTES, LS_BUDGET_BYTES, journalMatches, rebuildRecoveredCity,
  type JournalBase, type RecoveryJournal,
} from '../../src/save/recoveryCodec';
import { adoptRecoveryJournal, findRecoverySnapshot, readRecoveryJournal, storeJournalIdb, storeRecoveryIdb } from '../../src/save/recoveryIdb';
import { peekRecoveryMarker, readLsJournal, readLsSnapshot } from '../../src/save/recoveryLs';
import { findRecoverySnapshot as findPendingRecovery, restoreRecoverySnapshot, writeRecoverySnapshot } from '../../src/save/recovery';
import * as codec from '../../src/save/serialize';
import { ReplicaSaveError } from '../../src/save/state';
import { BF, type CityState } from '../../src/sim/CityState';
import { CityActions, type ActionResult } from '../../src/sim/actions';
import { LoopbackCore } from '../../src/worker/loopbackCore';
import { LoopbackSimHost, type LoopbackSimHostOptions } from '../../src/worker/LoopbackSimHost';
import { assertOwnedBuffers, cloneMessage, type M2W } from '../../src/worker/protocol';
import { RecoveryMirror } from '../../src/worker/recoveryMirror';
import { LocalSimHost, type Command } from '../../src/worker/SimHost';
import { newState, place } from '../infra/cityGen';
import { MemStorage, PersistentMemoryKV, regionData } from '../save/fixtures';

const city = { regionId: 'rtest', tileKey: '0_0' };
const rect = { x0: 3, z0: 3, x1: 6, z1: 6 };
const loops: LoopbackCore[] = [], mirrors: RecoveryMirror[] = [], hosts: (LocalSimHost | LoopbackSimHost)[] = [];
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
    // W1.3: a local session replays a matching journal at start; this one is booted without it (the crash dialog's
    // "Continue on the main thread"), so its save is what replaces the record the journal extends
    const local = new LocalSimHost(codec.deserializeCity(record.city), { persistence: city, replayJournal: false });
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
      'triggerDisaster', 'holdCalendar', 'debug.runDays', 'debug.verify', 'debug.setStepBudget', 'debug.setTrafficMinCycle', 'future.op', 'toString'];
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
    // W1.3: a journal alone carries its description for the title screen's offer
    expect(put).toHaveBeenCalledExactlyOnceWith('recovery', { ...mirror.journal, info: expect.objectContaining({ cityName: f.l.primary.config.name, why: 'beforeunload' }) }, 'rtest:0_0#journal');
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

describe('RecoveryMirror: FH-07a and restoring (T033 carry-over)', () => {
  it('replays a day-20 bulldoze with the refund it was charged, not the base day\'s same-day rule', async () => {
    const f = await fixture(), road = [{ x: 3, z: 8 }, { x: 4, z: 8 }, { x: 5, z: 8 }];
    f.post({ op: 'buildNetwork', args: [road, Network.Road] });
    now = 1200; const record = await f.save();
    const plop = f.post({ op: 'plop', args: ['park_small', 4, 9, 0] }) as ActionResult;
    expect(plop).toMatchObject({ ok: true });
    f.l.runDays(2);
    // the park is 20 days old when it is bulldozed: half its price back
    const park = [...f.l.primary.buildings.values()].find((b) => b.def === 'park_small')!;
    park.age = 20;
    const r = { x0: park.x, z0: park.z, x1: park.x + park.w, z1: park.z + park.d };
    const bulldoze = f.post({ op: 'bulldoze', args: [r] }) as ActionResult;
    expect(bulldoze).toMatchObject({ ok: true, refund: plop.cost / 2, refundNote: 'under 30 days old' });
    const journal = f.mirror.journal;
    expect(journal.ops.at(-1)).toMatchObject({ op: 'bulldoze', cost: bulldoze.cost, refund: plop.cost / 2 });
    // at the base's day the replayed plop and bulldoze fall on one day, where the rule would refund the whole price
    const restored = loop(codec.deserializeCity(record.city)), st = restored.primary;
    const funds = st.funds, refunds = st.budget.curIncome['oneoff:refund'] ?? 0, fees = st.budget.curExpense['oneoff:demolition'] ?? 0;
    expect(restored.core.replayRecoveryJournal(journal, record)).toEqual({ applied: journal.ops.map((e) => e.seq), failed: [] });
    expect(st.funds).toBe(funds - plop.cost - bulldoze.cost);
    expect(st.budget.curIncome['oneoff:refund'] ?? 0).toBe(refunds + plop.cost / 2);
    expect(st.budget.curExpense['oneoff:demolition'] ?? 0).toBe(fees + bulldoze.cost + plop.cost / 2);
  });

  it('moves the unload journal into IndexedDB at title time when only localStorage kept it', async () => {
    const f = await fixture();
    f.post({ op: 'setTax', args: [DevType.R1, 12] });
    const put = vi.spyOn(kv, 'put').mockRejectedValueOnce(new Error('unloading'));
    f.mirror.writeNow('pagehide'); put.mockRestore();
    expect(await kv.get('recovery', 'rtest:0_0#journal')).toBeUndefined();
    expect(readLsJournal()?.ops).toHaveLength(1);
    // the slot is moved, not dropped; W1.3 offers the journal alone at title time
    expect(await findPendingRecovery()).toMatchObject({ marker: { kind: 'journal', baseSavedAt: f.savedAt, why: 'pagehide' }, journal: { ops: [{ seq: 1, op: 'setTax' }] } });
    expect(peekRecoveryMarker()).toBeNull();
    expect((await readRecoveryJournal(kv, { ...city, savedAt: f.savedAt }))?.ops).toMatchObject([{ seq: 1, op: 'setTax' }]);
  });

  it('restores a snapshot with the journal that extends it: re-bound to the new save, replayed at the next boot', async () => {
    const f = await fixture();
    f.post({ op: 'zone', args: [rect, Zone.ResLow] });
    now = 1200; await f.snapshot();
    f.post({ op: 'setTax', args: [DevType.R1, 13] });
    f.post({ op: 'setFunding', args: ['fire', 125] });
    now = 1300;
    const put = vi.spyOn(kv, 'put').mockRejectedValueOnce(new Error('unloading'));
    f.mirror.writeNow('pagehide'); put.mockRestore();
    const pending = (await findPendingRecovery(city))!;
    expect(pending.marker.at).toBe(1200);
    expect((await readRecoveryJournal(kv, { ...city, savedAt: f.savedAt, snapshot: pending.marker }))?.ops.map((e) => e.op))
      .toEqual(['setTax', 'setFunding']);
    now = 1400; await restoreRecoverySnapshot(pending);
    const record = (await getCityRecord(kv, city.regionId, city.tileKey))!;
    expect(record.savedAt).toBe(1400);
    expect(await readRecoveryJournal(kv, record)).toMatchObject({ base: { kind: 'save', savedAt: 1400 }, ops: [{ seq: 2 }, { seq: 3 }] });
    const host = await openHost();
    expect(host.harness.primary.budget.taxRates[DevType.R1]).toBe(13);
    expect(host.harness.primary.budget.funding.fire).toBe(125);
    expect(host.state.zone[host.state.idx(rect.x0, rect.z0)]).toBe(Zone.ResLow);
  });
});

async function savedCity(): Promise<number> {
  const state = newState(16); state.funds = 100000; state.stats.population = 10000;
  place(state, 't_r1', 10, 10);
  await kv.put('regions', regionData());
  return saveCity(city.regionId, city.tileKey, state);
}
/** as main.ts enters a city in `?simworker=loopback`: loadCity (the recovery base), then the host and its core */
async function openHost(opts: LoopbackSimHostOptions = {}, before?: (host: LoopbackSimHost) => void): Promise<LoopbackSimHost> {
  const host = new LoopbackSimHost((await loadCity(city.regionId, city.tileKey))!, { initialSpeed: 0, persistence: city, ...opts });
  hosts.push(host);
  before?.(host);
  await host.start(); await host.drain();
  return host;
}
async function settle<T>(host: LoopbackSimHost, p: Promise<T>): Promise<T> { await host.drain(); return p; }

describe('RecoveryMirror through LoopbackSimHost (T033 carry-over)', () => {
  it('journals what the host sends and replays it onto that save at the next boot, then the first save trims it', async () => {
    const savedAt = await savedCity(); now = 1100;
    const host = await openHost();
    host.post('setTax', [DevType.R1, 13]);
    host.post('zone', [rect, Zone.ResLow]);
    host.post('plop', ['missing_def', 1, 1, 0]);
    host.post('setSpeed', [2, 'keyboard']); host.post('holdCalendar', [true]);
    await host.drain();
    host.post('buildNetwork', [[{ x: 3, z: 8 }, { x: 4, z: 8 }], Network.Road]);
    host.post('setFunding', ['fire', 120]);
    // in flight and a slider still buffered: the unload write sends the slider and journals both
    host.recovery!.writeNow('pagehide');
    expect(peekRecoveryMarker()).toMatchObject({ kind: 'journal', bytes: 0, baseSavedAt: savedAt, cityName: host.state.config.name, why: 'pagehide' });
    expect(readLsJournal()).toMatchObject({ base: { kind: 'save', savedAt }, fromCmd: 0 });
    expect(readLsJournal()!.ops.map((e) => [e.seq, e.op])).toEqual([[1, 'setTax'], [2, 'zone'], [6, 'buildNetwork'], [7, 'setFunding']]);
    await host.drain();
    const expected = codec.serializeCity(host.harness.primary, { copy: true });
    await host.dispose();

    const again = await openHost();
    expect(codec.serializeCity(again.harness.primary, { copy: true })).toEqual(expected);
    expect(again.state.budget.taxRates[DevType.R1]).toBe(13);
    expect(again.changes).toBeGreaterThan(0); // the replayed edits are unsaved
    // the journal stays bound to the loaded save, renumbered below this session's commands, until a save contains it
    again.post('setTax', [DevType.R2, 9]);
    again.recovery!.writeNow('pagehide');
    expect(readLsJournal()).toMatchObject({ base: { kind: 'save', savedAt }, fromCmd: -4 });
    expect(readLsJournal()!.ops.map((e) => e.seq)).toEqual([-3, -2, -1, 0, 1]);
    now = 1300; const saved = await settle(again, again.save('manual'));
    expect(saved).toMatchObject({ savedAt: 1300, cmd: 1 });
    expect(await kv.get('recovery', 'rtest:0_0#journal')).toBeUndefined();
    expect(peekRecoveryMarker()).toBeNull();
    again.recovery!.writeNow('pagehide');
    expect(peekRecoveryMarker()).toBeNull();
  });

  it('keeps the payload and the journal of one base in localStorage through host snapshots and saves', async () => {
    const savedAt = await savedCity(); now = 1100;
    const host = await openHost();
    host.post('setTax', [DevType.R1, 11]);
    now = 1200; const snap = (await settle(host, host.snapshot('periodic')))!;
    expect(snap).toMatchObject({ cmd: 1, marker: { at: 1200, baseSavedAt: savedAt } });
    expect(peekRecoveryMarker()).toMatchObject({ kind: 'snapshot', at: 1200 });
    expect(readLsSnapshot()?.payload).toEqual(snap.payload);
    expect(readLsJournal()).toMatchObject({ base: { kind: 'snapshot', at: 1200, baseSavedAt: savedAt }, fromCmd: 1, ops: [] });
    host.post('zone', [rect, Zone.ResLow]); await host.drain();
    host.recovery!.writeNow('hidden');
    expect(readLsJournal()).toMatchObject({ base: { kind: 'snapshot', at: 1200 }, ops: [{ seq: 2, op: 'zone' }] });
    expect(readLsSnapshot()?.payload).toEqual(snap.payload);
    now = 1300; const saved = await settle(host, host.save('manual'));
    expect(peekRecoveryMarker()).toBeNull();
    host.post('setFunding', ['fire', 90]);
    host.recovery!.writeNow('pagehide');
    expect(peekRecoveryMarker()).toMatchObject({ kind: 'journal', bytes: 0, baseSavedAt: saved.savedAt });
    expect(readLsJournal()).toMatchObject({ base: { kind: 'save', savedAt: 1300 }, fromCmd: 2, ops: [{ seq: 3, op: 'setFunding' }] });
  });

  it('rebinds the journal to a save whose reply a resync dropped in flight, and that save still resolves', async () => {
    await savedCity(); now = 1100;
    const host = await openHost({ loopback: { lag: { seed: 3, packetTicks: 1000, longUnitChance: 0 } } });
    const core = host.harness;
    host.post('setTax', [DevType.R1, 12]);
    now = 1200; const saved = host.save('manual');
    await new Promise((resolve) => setTimeout(resolve, 0)); await core.inbox.idle;
    // written, and its reply waits in a packet still in flight
    expect((await getCityRecord(kv, city.regionId, city.tileKey))?.savedAt).toBe(1200);
    core.post({ t: 'resync' });
    await host.drain();
    await expect(saved).resolves.toMatchObject({ savedAt: 1200, cmd: 1 });
    host.post('setFunding', ['fire', 80]);
    host.recovery!.writeNow('pagehide');
    expect(readLsJournal()).toMatchObject({ base: { kind: 'save', savedAt: 1200 }, fromCmd: 1, ops: [{ seq: 2 }] });
  });

  it('journals commands posted before the core is ready, and writes the journal first on a fatal error', async () => {
    const savedAt = await savedCity(); now = 1100;
    // sent at once (not a coalesced slider), before the core's Ready names the save
    const host = await openHost({}, (h) => { h.post('zone', [rect, Zone.ResLow]); });
    expect(host.harness.primary.zone[host.harness.primary.idx(rect.x0, rect.z0)]).toBe(Zone.ResLow);
    host.post('setFunding', ['police', 110]); await host.drain();
    host.receive({ t: 'fatal', message: 'worker died' });
    expect(peekRecoveryMarker()).toMatchObject({ kind: 'journal', why: 'crash', baseSavedAt: savedAt });
    expect(readLsJournal()!.ops.map((e) => [e.seq, e.op])).toEqual([[1, 'zone'], [2, 'setFunding']]);
    expect(host.recovery).toBeNull();
  });

  it('keeps no journal without persistence or localStorage, and none when turned off', async () => {
    await savedCity();
    for (const opts of [{ journal: false }, { persistence: undefined }] as LoopbackSimHostOptions[]) {
      const host = await openHost(opts);
      host.post('setTax', [DevType.R1, 14]);
      expect(host.recovery).toBeNull();
      await host.dispose();
    }
    vi.unstubAllGlobals();
    const host = await openHost();
    host.post('setTax', [DevType.R1, 14]);
    expect(host.recovery).toBeNull();
    expect(storage.m.size).toBe(0);
  });
});
