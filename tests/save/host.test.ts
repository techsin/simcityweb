import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevType } from '../../src/core/types';
import { clearRecoveryBase, getCityRecord, getRecoveryBase, saveCity } from '../../src/save/cities';
import { setKV } from '../../src/save/db';
import { cityFingerprint } from '../../src/save/fingerprint';
import { peekRecoveryMarker } from '../../src/save/recoveryLs';
import { LocalSimHost } from '../../src/worker/SimHost';
import { deferred, MemStorage, PersistentMemoryKV, smallCity } from './fixtures';

let now: number, kv: PersistentMemoryKV;
const hosts: LocalSimHost[] = [];
beforeEach(() => {
  now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  kv = new PersistentMemoryKV(); setKV(kv); clearRecoveryBase();
  vi.stubGlobal('localStorage', new MemStorage());
});
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.dispose();
  clearRecoveryBase(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function fixture(signal?: AbortSignal) {
  const state = smallCity();
  await saveCity('rtest', '0_0', state);
  const host = new LocalSimHost(state, { signal, persistence: { regionId: 'rtest', tileKey: '0_0', regionName: 'Region' } });
  hosts.push(host); await host.start({}); now = 1100;
  return { state, host };
}

describe('LocalSimHost persistence', () => {
  it('acks the authoritative copy and command / change counters, even when the city advances during IDB', async () => {
    const { state, host } = await fixture(), started = deferred(), release = deferred();
    const camera = { x: 10, z: 20, distance: 400 };
    const cmd = host.act('setCamera', [camera]).seq, fp = cityFingerprint(state);
    const put = kv.put.bind(kv);
    vi.spyOn(kv, 'put').mockImplementation(async (store, value, key) => {
      if (store === 'cities') { started.resolve(); await release.promise; }
      await put(store, value, key);
    });
    const saved = host.save('manual'); await started.promise;
    expect(getRecoveryBase('rtest', '0_0')!.savedAt).toBe(1000);
    now = 1200; state.day += 10; state.funds += 77;
    host.act('setTax', [DevType.R1, 14]);
    host.events.emit('zoneChanged', { x0: 0, z0: 0, x1: 1, z1: 1 });
    await host.snapshot('hidden'); // newer, but based on the full save that is being replaced
    release.resolve();
    const ack = await saved;
    expect(ack).toMatchObject({ savedAt: 1100, cmd, pktSeq: 0, fp, changes: 0, recoveryDropped: true });
    expect(ack.summary.funds).toBe(Math.round(state.funds - 77));
    expect(cityFingerprint(state)).not.toBe(ack.fp);
    expect(host.changes).toBe(1);
    const record = (await getCityRecord(kv, 'rtest', '0_0'))!;
    expect(record.city.scalars.day).toBe(0);
    expect(record.city.data.systemData).toMatchObject({ camera });
    expect(peekRecoveryMarker()).toBeNull();
    expect(await kv.keys('recovery')).toEqual([]);
    expect(getRecoveryBase('rtest', '0_0')!.savedAt).toBe(ack.savedAt);
  });

  it('serializes saves FIFO and keeps the queue usable after a failed write', async () => {
    const { state, host } = await fixture(), started = deferred(), release = deferred();
    vi.spyOn(kv, 'put').mockImplementationOnce(async () => { started.resolve(); await release.promise; });
    const first = host.save('manual'), failed = expect(first).rejects.toThrow('quota');
    await started.promise;
    const second = host.save('autosave');
    expect(kv.put).toHaveBeenCalledTimes(1);
    state.day = 9; now = 1200;
    release.reject(new Error('quota')); await failed;
    const ack = await second;
    expect(ack.savedAt).toBe(1200);
    expect(ack.fp).toBe(cityFingerprint(state));
    expect((await getCityRecord(kv, 'rtest', '0_0'))!.city.scalars.day).toBe(9);
  });

  for (const why of ['beforeunload', 'pagehide', 'hidden', 'periodic', 'exit'] as const) {
    it(`${why}: writes local recovery before returning the promise`, async () => {
      const { state, host } = await fixture(); state.day = 5;
      const pending = host.snapshot(why);
      expect(peekRecoveryMarker()).toMatchObject({ day: 5, why, at: 1100, baseSavedAt: 1000, ls: true });
      const ack = await pending;
      expect(ack).toMatchObject({ fp: cityFingerprint(state), cmd: 0, changes: 0, ok: true });
      expect(ack!.dropped.length > 0).toBe(why === 'periodic');
      expect(host.recovery).toBeNull();
    });
  }

  it('keeps a new-base localStorage snapshot taken while IDB cleanup is pending', async () => {
    const { state, host } = await fixture(), started = deferred(), release = deferred();
    const remove = kv.delete.bind(kv);
    vi.spyOn(kv, 'delete').mockImplementation(async (store, key) => {
      await remove(store, key); started.resolve(); await release.promise;
    });
    const saved = host.save('hidden'); await started.promise;
    now = 1200; state.day = 7;
    await host.snapshot('hidden');
    expect(peekRecoveryMarker()?.baseSavedAt).toBe(1100);
    release.resolve(); await saved;
    expect(peekRecoveryMarker()).toMatchObject({ baseSavedAt: 1100, day: 7 });
    expect(await kv.keys('recovery')).toEqual(['rtest:0_0']);
  });

  it('counts saved edits, ignores derived updates, and removes listeners on abort / dispose', async () => {
    const abort = new AbortController(), { host } = await fixture(abort.signal);
    const rect = { x0: 0, z0: 0, x1: 1, z1: 1 };
    host.events.emit('zoneChanged', rect); host.events.emit('layerUpdated', 'traffic');
    expect(host.changes).toBe(1);
    abort.abort('dispose'); host.events.emit('zoneChanged', rect);
    expect(host.changes).toBe(1);
    await host.dispose();
    await expect(host.save('exit')).rejects.toThrow('disposed');
    await expect(host.snapshot('exit')).rejects.toThrow('disposed');
  });
});
