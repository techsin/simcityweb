/**
 * Emergency "unsaved progress" snapshots (src/save/recovery.ts): delta codec, string packing, and the
 * write -> find -> restore cycle against a persistent in-memory KV + a localStorage stub.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { Network, Zone } from '../../src/core/types';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';
import {
  LS_BUDGET_BYTES,
  MemoryKV,
  RECOMPUTED_LAYERS,
  applyCityDelta,
  clearRecoveryAfterSave,
  clearRecoveryBase,
  discardRecoverySnapshot,
  encodeCityDelta,
  findRecoverySnapshot,
  hasRecoverySnapshot,
  loadCity,
  packBytes,
  peekRecoveryMarker,
  restoreRecoverySnapshot,
  saveCity,
  saveRegion,
  setKV,
  unpackBytes,
  writeRecoverySnapshot,
  type CityDelta,
} from '../../src/save/index';
import { createRegionData } from '../../src/region/RegionModel';

class PersistentMemoryKV extends MemoryKV {
  override readonly persistent = true as unknown as false;
}

class MemStorage {
  m = new Map<string, string>();
  quota = Infinity;
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    let used = 0;
    for (const [kk, vv] of this.m) if (kk !== k) used += kk.length + vv.length;
    if (used + k.length + v.length > this.quota) throw new Error('QuotaExceededError');
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

function bld(id: number, x: number, z: number, extra: Partial<Building> = {}): Building {
  return { id, def: 'res_cottage', x, z, w: 1, d: 1, rot: 0, variant: 0, pop: 5, jobs: 0, capacity: 6, wealth: 1, built: 1, age: 10, flags: BF.Powered, baseY: 0, health: 1, unhappy: 0, ...extra };
}

function city(): CityState {
  const st = createCityState(defaultCityConfig({ name: 'Deltaville', mayor: 'Ada', size: 64, seed: 99, terrain: 'river' }));
  st.day = 400;
  st.funds = 50_000;
  for (let x = 4; x < 50; x++) {
    st.network[st.idx(x, 20)] = Network.Road;
    st.zone[st.idx(x, 21)] = Zone.ResLow;
  }
  for (let i = 0; i < st.cells; i += 3) {
    st.traffic[i] = i * 0.5;
    st.desirability[2][i] = (i % 7) / 7;
  }
  for (let k = 0; k < 40; k++) {
    const b = bld(k + 1, 4 + k, 21);
    st.buildings.set(b.id, b);
    st.building[st.idx(b.x, b.z)] = b.id;
  }
  st.nextBuildingId = 41;
  st.systemData.test = { cache: new Float32Array([1, 2, 3]), m: new Map([[1, 'a']]) };
  return st;
}

/** path of the first difference between two values (typed arrays compared element-wise) */
function firstDiff(a: unknown, b: unknown, path = '$'): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b) return `${path}: type ${typeof a} vs ${typeof b}`;
  if (a === null || b === null || typeof a !== 'object') return `${path}: ${String(a)} vs ${String(b)}`;
  if (a.constructor !== (b as object).constructor) return `${path}: ctor ${a.constructor?.name} vs ${(b as object).constructor?.name}`;
  if (ArrayBuffer.isView(a)) {
    const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return `${path}: length ${x.length} vs ${y.length}`;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return `${path}[${i}]: ${x[i]} vs ${y[i]}`;
    return null;
  }
  if (a instanceof Map) return firstDiff([...a.entries()], [...(b as Map<unknown, unknown>).entries()], path);
  if (a instanceof Set) return firstDiff([...a], [...(b as Set<unknown>)], path);
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return `${path}: keys ${ka.sort().join(',')} vs ${kb.sort().join(',')}`;
  for (const k of ka) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

const strip = (c: SerializedCity) => ({ ...c, savedAt: 0 });

describe('string packing', () => {
  it('round-trips arbitrary bytes through 15-bit chars (no surrogates)', () => {
    for (const n of [0, 1, 2, 14, 15, 16, 29, 30, 1000, 65537]) {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (i * 131 + 7) & 255;
      const s = packBytes(b);
      expect(s.length).toBe(Math.ceil((n * 8) / 15));
      // (one assertion per string, not per char: 35k expect() calls made this test take minutes on a loaded machine)
      let bad = -1;
      for (let i = 0; i < s.length && bad < 0; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x1000 || c > 0x8fff) bad = i;
      }
      expect(bad).toBe(-1);
      expect(firstDiff(unpackBytes(s, n), b)).toBeNull();
    }
  });
});

describe('city delta', () => {
  it('a delta of a few edits is tiny and restores the exact city', () => {
    const st = city();
    const base = serializeCity(st, { copy: true });
    // edits since the "save"
    st.day += 45;
    st.funds -= 1234.5;
    st.network[st.idx(30, 40)] = Network.Road;
    st.zone[st.idx(31, 40)] = Zone.ComLow;
    st.heights[500] += 3.25;
    st.traffic[99] = 12345;
    st.buildings.get(5)!.pop = 99;
    st.buildings.delete(7); // removal shifts the SoA columns
    const nb = bld(41, 30, 41, { def: 'com_shop', flags: BF.Constructing });
    st.buildings.set(41, nb);
    st.nextBuildingId = 42;
    st.budget.taxRates[0] = 11;
    st.notify('new news', 'info');
    const cur = serializeCity(st, { copy: true });
    const delta = encodeCityDelta(cur, base, 1111);
    const bytes = encodeBundle(delta);
    const full = encodeBundle(cur);
    expect(bytes.length).toBeLessThan(full.length / 5);
    const back = applyCityDelta(decodeBundle(bytes) as CityDelta, base);
    expect(firstDiff(strip(back), strip(cur))).toBeNull();
    // and it loads
    const st2 = deserializeCity(back);
    expect(st2.day).toBe(st.day);
    expect(st2.buildings.size).toBe(st.buildings.size);
    expect(st2.buildings.get(41)?.def).toBe('com_shop');
    expect(st2.network[st2.idx(30, 40)]).toBe(Network.Road);
  });

  it('without a base the delta is a full, still compact snapshot', () => {
    const st = city();
    const cur = serializeCity(st, { copy: true });
    const delta = encodeCityDelta(cur, null, 0);
    expect(delta.baseSavedAt).toBe(0);
    const back = applyCityDelta(decodeBundle(encodeBundle(delta)) as CityDelta, null);
    expect(firstDiff(strip(back), strip(cur))).toBeNull();
  });

  it('over budget, recomputed layers are dropped and come from the base', () => {
    const st = city();
    const base = serializeCity(st, { copy: true });
    for (let i = 0; i < st.cells; i++) {
      st.traffic[i] += 1;
      st.desirability[2][i] += 0.5;
    }
    st.zone[st.idx(1, 1)] = Zone.IndMed;
    const cur = serializeCity(st, { copy: true });
    const delta = encodeCityDelta(cur, base, 1, { budget: 2000 });
    expect(delta.dropped).toContain('desirability');
    expect(delta.dropped).toContain('traffic');
    const back = applyCityDelta(decodeBundle(encodeBundle(delta)) as CityDelta, base);
    expect(firstDiff(back.layers.traffic, base.layers.traffic)).toBeNull();
    expect(firstDiff(back.layers.zone, cur.layers.zone)).toBeNull();
  });

  it('lean (periodic) snapshots leave every recomputed layer to the base, keep all primary data', () => {
    const st = city();
    const base = serializeCity(st, { copy: true });
    for (let i = 0; i < st.cells; i += 5) {
      st.traffic[i] += 1;
      st.landValue[i] += 0.25;
      st.desirability[1][i] -= 0.5;
    }
    st.zone[st.idx(1, 1)] = Zone.IndMed;
    st.network[st.idx(2, 1)] = Network.Road;
    st.garbage[77] = 0.5; // a saved layer outside RECOMPUTED_LAYERS: always kept
    st.day += 12;
    const cur = serializeCity(st, { copy: true });
    const lean = encodeCityDelta(cur, base, 1, { budget: LS_BUDGET_BYTES, lean: true });
    const full = encodeCityDelta(cur, base, 1, { budget: LS_BUDGET_BYTES });
    const leanRecomputed = RECOMPUTED_LAYERS.filter((k) => k in cur.layers);
    expect([...lean.dropped].sort()).toEqual([...leanRecomputed].sort());
    for (const k of leanRecomputed) expect(lean.layers[k]).toBeUndefined();
    expect(full.dropped).toEqual([]);
    expect(encodeBundle(lean).length).toBeLessThan(encodeBundle(full).length);
    const back = applyCityDelta(decodeBundle(encodeBundle(lean)) as CityDelta, base);
    for (const k of leanRecomputed) expect(firstDiff(back.layers[k], base.layers[k])).toBeNull();
    for (const k of Object.keys(cur.layers).filter((k) => !RECOMPUTED_LAYERS.includes(k))) expect(firstDiff(back.layers[k], cur.layers[k])).toBeNull();
    expect(firstDiff(strip({ ...back, layers: {} }), strip({ ...cur, layers: {} }))).toBeNull();
    expect(deserializeCity(back).day).toBe(st.day);
    // without a base there is nothing to take them from: a lean delta is then a full one
    expect(encodeCityDelta(cur, null, 0, { lean: true }).dropped).toEqual([]);
  });

  it('refuses a different base', () => {
    const st = city();
    const base = serializeCity(st, { copy: true });
    st.zone[st.idx(2, 2)] = Zone.IndMed;
    const delta = encodeCityDelta(serializeCity(st, { copy: true }), base, 1);
    // not the base the delta was made against (another city: every layer differs)
    const other = serializeCity(createCityState(defaultCityConfig({ name: 'Other', size: 64, seed: 7, terrain: 'hills' })), { copy: true });
    expect(() => applyCityDelta(delta, other)).toThrow(/checksum|mismatch/);
    expect(() => applyCityDelta(delta, null)).toThrow(/base/);
  });
});

// (generous: on a loaded machine one of these took 140 s, and a timed-out test keeps running into the next one)
describe('write -> find -> restore', { timeout: 300_000 }, () => {
  let ls: MemStorage;
  beforeEach(async () => {
    ls = new MemStorage();
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = ls;
    setKV(new PersistentMemoryKV());
    clearRecoveryBase();
  });

  async function setup() {
    const { data } = createRegionData({ seed: 5, preset: 'greenvale', id: 'rtest', name: 'Test Region' });
    await saveRegion(data);
    const tileKey = data.tiles[0].key;
    const st = city();
    await saveCity('rtest', tileKey, st);
    return { tileKey, st };
  }

  it('recovers unsaved progress written by the unload snapshot', async () => {
    const { tileKey, st } = await setup();
    st.day += 60;
    st.funds += 777;
    st.network[st.idx(10, 50)] = Network.Road;
    const r = writeRecoverySnapshot('rtest', tileKey, st, { cityName: 'Deltaville', population: 10, funds: st.funds, why: 'test' });
    expect(r.ok && r.ls && r.idb).toBe(true);
    expect(r.bytes).toBeLessThan(40_000);
    expect(peekRecoveryMarker()?.day).toBe(st.day);
    const p = await findRecoverySnapshot();
    expect(p).not.toBeNull();
    expect(p!.marker.regionName).toBe('Test Region');
    expect(p!.marker.baseDay).toBe(400);
    await restoreRecoverySnapshot(p!);
    expect(peekRecoveryMarker()).toBeNull();
    const back = await loadCity('rtest', tileKey);
    expect(back!.day).toBe(st.day);
    expect(back!.funds).toBe(st.funds);
    expect(back!.network[back!.idx(10, 50)]).toBe(Network.Road);
    expect(await findRecoverySnapshot()).toBeNull();
  });

  it('works from IndexedDB alone when localStorage is full, and from localStorage alone', async () => {
    const { tileKey, st } = await setup();
    st.day += 30;
    ls.quota = 1000; // payload does not fit, the marker does
    const r = writeRecoverySnapshot('rtest', tileKey, st, { cityName: 'x', population: 0, funds: 0 });
    expect(r.ls).toBe(false);
    expect(r.idb).toBe(true);
    let p = await findRecoverySnapshot();
    expect(p?.marker.day).toBe(st.day);
    // localStorage only: IndexedDB record gone
    ls.quota = Infinity;
    st.day += 1;
    writeRecoverySnapshot('rtest', tileKey, st, { cityName: 'x', population: 0, funds: 0 });
    const kv = new PersistentMemoryKV();
    // copy the stores except the recovery record into a fresh KV
    const oldKv = (await import('../../src/save/db')).openedKV()!;
    for (const store of ['regions', 'cities'] as const) for (const k of await oldKv.keys(store)) await kv.put(store, await oldKv.get(store, k), store === 'cities' ? k : undefined);
    setKV(kv);
    p = await findRecoverySnapshot();
    expect(p?.marker.day).toBe(st.day);
    await restoreRecoverySnapshot(p!);
    expect((await loadCity('rtest', tileKey))!.day).toBe(st.day);
  });

  it('a newer full save makes the snapshot stale', async () => {
    const { tileKey, st } = await setup();
    st.day += 10;
    writeRecoverySnapshot('rtest', tileKey, st, { cityName: 'x', population: 0, funds: 0 });
    await new Promise((r) => setTimeout(r, 5));
    await saveCity('rtest', tileKey, st);
    expect(await findRecoverySnapshot()).toBeNull();
    expect(peekRecoveryMarker()).toBeNull();
  });

  it('discard clears both copies', async () => {
    const { tileKey, st } = await setup();
    st.day += 10;
    writeRecoverySnapshot('rtest', tileKey, st, { cityName: 'x', population: 0, funds: 0 });
    await discardRecoverySnapshot();
    expect(peekRecoveryMarker()).toBeNull();
    expect(await findRecoverySnapshot()).toBeNull();
  });

  /** a second city of the same region (tile 1), saved */
  async function secondCity() {
    const { data } = createRegionData({ seed: 5, preset: 'greenvale', id: 'rtest', name: 'Test Region' });
    const tileKey = data.tiles[1].key;
    const st = city();
    st.config.name = 'Second';
    await saveCity('rtest', tileKey, st);
    return { tileKey, st };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('keeps one snapshot per city: a later snapshot of another city does not overwrite a pending one', async () => {
    const a = await setup();
    a.st.day += 20;
    writeRecoverySnapshot('rtest', a.tileKey, a.st, { cityName: 'Deltaville', population: 0, funds: 0 });
    // next start: the player dismisses the offer ("later") -> the localStorage copy moves into IndexedDB
    expect((await findRecoverySnapshot())?.marker.tileKey).toBe(a.tileKey);
    expect(peekRecoveryMarker()).toBeNull();
    // ... then plays another city, whose snapshot takes the localStorage slot
    const b = await secondCity();
    b.st.day += 5;
    await new Promise((r) => setTimeout(r, 5));
    writeRecoverySnapshot('rtest', b.tileKey, b.st, { cityName: 'Second', population: 0, funds: 0 });
    expect(peekRecoveryMarker()?.tileKey).toBe(b.tileKey);
    expect(await hasRecoverySnapshot({ regionId: 'rtest', tileKey: a.tileKey })).toBe(true);
    expect(await hasRecoverySnapshot({ regionId: 'rtest', tileKey: b.tileKey })).toBe(true);
    // newest first; per-city lookups find each
    expect((await findRecoverySnapshot())?.marker.tileKey).toBe(b.tileKey);
    const pa = await findRecoverySnapshot({ regionId: 'rtest', tileKey: a.tileKey });
    expect(pa?.marker.day).toBe(a.st.day);
    const pb = await findRecoverySnapshot({ regionId: 'rtest', tileKey: b.tileKey });
    expect(pb?.marker.day).toBe(b.st.day);
    // restoring one leaves the other pending
    await restoreRecoverySnapshot(pa!);
    expect((await loadCity('rtest', a.tileKey))!.day).toBe(a.st.day);
    expect(await hasRecoverySnapshot({ regionId: 'rtest', tileKey: a.tileKey })).toBe(false);
    expect((await findRecoverySnapshot())?.marker.tileKey).toBe(b.tileKey);
  });

  it('a completed full save drops that city\'s snapshots (and reports one taken while it was written)', async () => {
    const a = await setup();
    a.st.day += 20;
    writeRecoverySnapshot('rtest', a.tileKey, a.st, { cityName: 'Deltaville', population: 0, funds: 0 });
    await findRecoverySnapshot(); // adopted into IndexedDB
    const b = await secondCity();
    b.st.day += 5;
    writeRecoverySnapshot('rtest', b.tileKey, b.st, { cityName: 'Second', population: 0, funds: 0 });
    const m = peekRecoveryMarker()!;
    // a save of B that started before B's snapshot (savedAt older): the snapshot is newer -> reported
    expect(clearRecoveryAfterSave('rtest', b.tileKey, m.at - 1)).toBe(true);
    await tick();
    expect(peekRecoveryMarker()).toBeNull();
    expect(await hasRecoverySnapshot({ regionId: 'rtest', tileKey: b.tileKey })).toBe(false);
    // A is untouched; a save of A newer than its snapshot is not reported, but still drops it
    expect(await hasRecoverySnapshot({ regionId: 'rtest', tileKey: a.tileKey })).toBe(true);
    expect(clearRecoveryAfterSave('rtest', a.tileKey, Date.now() + 1)).toBe(false);
    await tick();
    expect(await findRecoverySnapshot()).toBeNull();
  });

  it('is not offered when the stored save is not its base, or the city is gone', async () => {
    const { tileKey, st } = await setup();
    st.day += 20;
    writeRecoverySnapshot('rtest', tileKey, st, { cityName: 'x', population: 0, funds: 0 });
    const m = peekRecoveryMarker()!;
    // the stored save was replaced by a different one that is still older than the snapshot (e.g. imported)
    const kv = (await import('../../src/save/db')).openedKV()!;
    const key = `rtest:${tileKey}`;
    const other = serializeCity(createCityState(defaultCityConfig({ name: 'Other', size: 64, seed: 7, terrain: 'hills' })), { copy: true });
    await kv.put('cities', { key, regionId: 'rtest', tileKey, savedAt: m.baseSavedAt + 1, city: other }, key);
    expect(await findRecoverySnapshot()).toBeNull();
    expect(await hasRecoverySnapshot({ regionId: 'rtest', tileKey })).toBe(false);
    // city deleted
    const b = await secondCity();
    b.st.day += 3;
    writeRecoverySnapshot('rtest', b.tileKey, b.st, { cityName: 'Second', population: 0, funds: 0 });
    await kv.delete('cities', `rtest:${b.tileKey}`);
    expect(await findRecoverySnapshot()).toBeNull();
  });
});
