import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRecoveryBase, createCityRecord, deleteCity, getCityRecord, getRecoveryBase, hasCity, loadCity, loadSerializedCity, putCityRecord, saveCity } from '../../src/save/cities';
import { setKV } from '../../src/save/db';
import { deferred, PersistentMemoryKV, smallCity } from './fixtures';

afterEach(() => { vi.restoreAllMocks(); clearRecoveryBase(); });
beforeEach(() => { clearRecoveryBase(); vi.spyOn(Date, 'now').mockReturnValue(1000); });

describe('city records', () => {
  it('copies live arrays and plain data, loads an independent city, and supports record lookup / deletion', async () => {
    const kv = new PersistentMemoryKV(); setKV(kv);
    const st = smallCity(); st.systemData.test = { values: new Uint8Array([7]) };
    const at = await saveCity('r', 't', st);
    st.zone[2] = 3;
    (st.systemData.test as { values: Uint8Array }).values[0] = 99;
    const record = await getCityRecord(kv, 'r', 't');
    expect(record).toMatchObject({ key: 'r:t', regionId: 'r', tileKey: 't', savedAt: at });
    expect(await hasCity('r', 't')).toBe(true);
    expect(await loadSerializedCity('r', 't')).toEqual(record!.city);
    const loaded = (await loadCity('r', 't'))!;
    expect(loaded.zone[2]).toBe(0);
    expect((loaded.systemData.test as { values: Uint8Array }).values[0]).toBe(7);
    loaded.zone[3] = 4;
    expect(getRecoveryBase('r', 't')!.city.layers.zone[3]).toBe(0);
    expect(getRecoveryBase('r', 'other')).toBeNull();
    await deleteCity('r', 't');
    expect(await hasCity('r', 't')).toBe(false);
    expect(await loadCity('r', 't')).toBeNull();
    expect(await loadSerializedCity('r', 't')).toBeNull();
  });

  it('advances the recovery base only after a successful put completes', async () => {
    const kv = new PersistentMemoryKV(), st = smallCity(); setKV(kv);
    await saveCity('r', 't', st);
    const old = getRecoveryBase('r', 't');
    st.day = 30;
    const rec = createCityRecord('r', 't', st), gate = deferred();
    vi.spyOn(kv, 'put').mockReturnValueOnce(gate.promise);
    const writing = putCityRecord(kv, rec);
    expect(getRecoveryBase('r', 't')).toBe(old);
    gate.resolve(); await writing;
    expect(getRecoveryBase('r', 't')!.city.scalars.day).toBe(30);
    const saved = getRecoveryBase('r', 't');
    vi.spyOn(kv, 'put').mockRejectedValueOnce(new Error('quota'));
    await expect(putCityRecord(kv, createCityRecord('r', 't', st))).rejects.toThrow('quota');
    expect(getRecoveryBase('r', 't')).toBe(saved);
  });
});
