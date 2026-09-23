import { describe, expect, it, beforeEach } from 'vitest';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { Network, Zone } from '../../src/core/types';
import {
  CITY_SAVE_VERSION,
  deserializeCity,
  registerCityMigration,
  serializeCity,
  type SerializedCity,
} from '../../src/save/serialize';
import { decodeBundle, encodeBundle, gunzip, gzip, packFile, unpackFile } from '../../src/save/bundle';
import {
  MemoryKV,
  deleteCity,
  deleteRegion,
  exportRegion,
  hasCity,
  importRegion,
  listRegions,
  loadCity,
  loadRegion,
  saveCity,
  saveRegion,
  setKV,
} from '../../src/save/index';
import { createRegionData } from '../../src/region/RegionModel';

function makeBuilding(id: number, x: number, z: number, def: string, extra: Partial<Building> = {}): Building {
  return {
    id, def, x, z, w: 2, d: 2, rot: 1, variant: 3, pop: 37, jobs: 4, capacity: 40, wealth: 2, built: 0.75, age: 123,
    flags: BF.Powered | BF.Watered, baseY: 12.5, health: 0.66, unhappy: 3, ...extra,
  };
}

function populatedCity(): CityState {
  const st = createCityState(defaultCityConfig({ name: 'Testville', mayor: 'Ada', size: 64, seed: 4242, terrain: 'river' }));
  st.day = 1234;
  st.funds = 98765.5;
  // player layers
  for (let x = 5; x < 40; x++) {
    st.network[st.idx(x, 10)] = Network.Road;
    st.netFlags[st.idx(x, 10)] = x === 20 ? 1 : 0;
    st.zone[st.idx(x, 11)] = Zone.ResMed;
    st.powerLines[st.idx(x, 30)] = 1;
  }
  st.subway[st.idx(3, 3)] = 1;
  // derived layers
  for (let i = 0; i < st.cells; i += 7) {
    st.traffic[i] = i * 0.25;
    st.congestion[i] = (i % 13) / 13;
    st.landValue[i] = (i % 17) / 17;
    st.powered[i] = 1;
    st.desirability[4][i] = -0.5 + (i % 3) * 0.25;
  }
  // buildings
  const add = (b: Building) => {
    st.buildings.set(b.id, b);
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) st.building[st.idx(x, z)] = b.id;
  };
  add(makeBuilding(1, 6, 11, 'res_cottage'));
  add(makeBuilding(2, 9, 11, 'res_cottage', { variant: 1, flags: BF.Abandoned }));
  add(makeBuilding(7, 12, 11, 'com_shop', { rot: 3, customField: { hello: [1, 2, 3] } } as Partial<Building>));
  st.nextBuildingId = 8;
  // budget / stats / history / news
  st.budget.taxRates[3] = 12;
  st.budget.funding.police = 120;
  st.budget.ordinances.push('recycling');
  st.budget.loans.push({ principal: 10000, remaining: 8000, rate: 0.06, monthlyPayment: 200, monthsLeft: 40 });
  st.budget.lastIncome['tax:R'] = 1500;
  st.stats.population = 1234;
  st.stats.residents = [1000, 200, 34];
  st.stats.demand[2] = 0.75;
  st.history.t.push(1, 2, 3);
  st.history.pop.push(10, 20, 30);
  st.notify('Hello city', 'good', 3, 4);
  st.notify('Advisor says hi', 'advisor', undefined, undefined, 'finance');
  st.unlocked.add('mayor_house');
  st.unlocked.add('park_big');
  st.announced.add('mayor_house');
  st.milestones['stadium'] = 1;
  st.neighborConnections.push({ edge: 'n', x: 10, z: 0, type: Network.Highway });
  st.systemData.traffic = { lastRun: 42, cache: new Float32Array([1, 2, 3]), paths: new Map([[1, [2, 3]]]), seen: new Set(['a']) };
  st.systemData.growth = { cursor: 17, queue: [1, 2, 3] };
  return st;
}

/**
 * Cheap structural diff: returns the path of the first difference (or null). Avoids vitest's pretty diff of
 * huge typed arrays, which is extremely slow on failure.
 */
function firstDiff(a: unknown, b: unknown, path = '$'): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b) return `${path}: type ${typeof a} vs ${typeof b}`;
  if (a === null || b === null || typeof a !== 'object') {
    if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return null;
    return `${path}: ${String(a)} vs ${String(b)}`;
  }
  if (a.constructor !== (b as object).constructor) return `${path}: ctor ${a.constructor?.name} vs ${(b as object).constructor?.name}`;
  if (ArrayBuffer.isView(a)) {
    const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return `${path}: length ${x.length} vs ${y.length}`;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return `${path}[${i}]: ${x[i]} vs ${y[i]}`;
    return null;
  }
  if (a instanceof Map) {
    const bm = b as Map<unknown, unknown>;
    if (a.size !== bm.size) return `${path}: map size ${a.size} vs ${bm.size}`;
    for (const [k, v] of a) {
      if (!bm.has(k)) return `${path}: missing key ${String(k)}`;
      const d = firstDiff(v, bm.get(k), `${path}<${String(k)}>`);
      if (d) return d;
    }
    return null;
  }
  if (a instanceof Set) {
    const bs = b as Set<unknown>;
    if (a.size !== bs.size) return `${path}: set size ${a.size} vs ${bs.size}`;
    for (const v of a) if (!bs.has(v)) return `${path}: set missing ${String(v)}`;
    return null;
  }
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (ka.length !== kb.length) return `${path}: keys [${ka.join(',')}] vs [${kb.join(',')}]`;
  for (const k of ka) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

function expectSameCity(a: CityState, b: CityState) {
  expect(b.size).toBe(a.size);
  expect(b.year).toBe(a.year);
  // whole-object structural equality (covers every layer, buildings, budget, stats, history, news, sets, systemData)
  expect(firstDiff(a, b)).toBeNull();
}

describe('city serialization', () => {
  it('round-trips a populated city', () => {
    const st = populatedCity();
    const obj = serializeCity(st);
    expect(obj.version).toBe(CITY_SAVE_VERSION);
    expect(obj.buildings.count).toBe(3);
    expect(obj.buildings.defs).toEqual(['res_cottage', 'com_shop']);
    const back = deserializeCity(obj);
    expectSameCity(st, back);
    // helpers work on the restored instance
    expect(back.buildingAt(6, 11)?.def).toBe('res_cottage');
    expect(back.dateLabel()).toBe(st.dateLabel());
  });

  it('does not alias typed arrays of the serialized object', () => {
    const st = populatedCity();
    const obj = serializeCity(st);
    const back = deserializeCity(obj);
    back.zone[0] = 9;
    back.heights[0] = 999;
    expect((obj.layers.zone as Uint8Array)[0]).toBe(st.zone[0]);
    expect(st.heights[0]).not.toBe(999);
  });

  it('copy option snapshots the live state', () => {
    const st = populatedCity();
    const snap = serializeCity(st, { copy: true });
    st.traffic[0] = 12345;
    st.systemData.growth = { cursor: -1 };
    expect((snap.layers.traffic as Float32Array)[0]).not.toBe(12345);
    expect((snap.data.systemData as Record<string, unknown>).growth).toEqual({ cursor: 17, queue: [1, 2, 3] });
  });

  it('survives structured clone (IndexedDB path)', () => {
    const st = populatedCity();
    const cloned = structuredClone(serializeCity(st)) as SerializedCity;
    expectSameCity(st, deserializeCity(cloned));
  });

  it('survives the binary bundle codec + gzip (export file path)', async () => {
    const st = populatedCity();
    const bytes = encodeBundle(serializeCity(st));
    expectSameCity(st, deserializeCity(decodeBundle(bytes) as SerializedCity));
    const z = await gzip(bytes);
    expect(z.length).toBeLessThan(bytes.length);
    const unz = await gunzip(z);
    expect(firstDiff(unz, bytes)).toBeNull();
    const packed = await packFile(serializeCity(st));
    expectSameCity(st, deserializeCity((await unpackFile(packed)) as SerializedCity));
  });

  it('bundle codec keeps special values', () => {
    const v = { a: NaN, b: Infinity, c: -Infinity, d: undefined, e: new Map([['k', new Set([1, 2])]]), f: [new Int16Array([-3, 4]), new Float64Array([0.1])], g: new Date(5) };
    const back = decodeBundle(encodeBundle(v)) as typeof v;
    expect(back.a).toBeNaN();
    expect(back.b).toBe(Infinity);
    expect(back.c).toBe(-Infinity);
    expect('d' in back).toBe(true);
    expect(back.e).toEqual(v.e);
    expect(back.f[0]).toEqual(v.f[0]);
    expect(back.f[1]).toEqual(v.f[1]);
    expect(back.g.getTime()).toBe(5);
  });

  it('applies migrations from older versions', () => {
    const st = populatedCity();
    const obj = serializeCity(st) as SerializedCity;
    const old = { ...obj, version: 0, scalars: { ...obj.scalars } } as SerializedCity;
    delete old.scalars.funds;
    (old.scalars as Record<string, unknown>).money = 777;
    registerCityMigration(0, (o) => {
      const s = { ...o.scalars } as Record<string, number>;
      s.funds = s.money;
      delete s.money;
      return { ...o, version: 1, scalars: s };
    });
    const back = deserializeCity(old);
    expect(back.funds).toBe(777);
    expect(back.day).toBe(st.day);
  });

  it('rejects foreign data', () => {
    expect(() => deserializeCity({ format: 'nope' } as unknown as SerializedCity)).toThrow();
    expect(() => deserializeCity({ ...serializeCity(populatedCity()), version: CITY_SAVE_VERSION + 1 })).toThrow();
  });
});

describe('save store (memory backend)', () => {
  beforeEach(() => setKV(new MemoryKV()));

  it('saves, lists, exports and imports regions with cities', async () => {
    const { data } = createRegionData({ seed: 99, preset: 'twin-rivers' });
    const tile = data.tiles.find((t) => t.size === 1)!;
    const st = populatedCity();
    tile.city = { name: 'Testville', mayor: 'Ada', population: 1234, r: 1234, c: 50, i: 20, funds: st.funds, lastPlayed: 1, founded: 1, difficulty: 'medium' };
    await saveRegion(data);
    await saveCity(data.id, tile.key, st);
    expect(await hasCity(data.id, tile.key)).toBe(true);
    expect((await listRegions()).map((r) => r.id)).toEqual([data.id]);
    expect((await loadRegion(data.id))?.tiles.length).toBe(data.tiles.length);
    expectSameCity(st, (await loadCity(data.id, tile.key))!);

    const blob = await exportRegion(data.id);
    const imported = await importRegion(blob);
    expect(imported.id).not.toBe(data.id);
    expect(imported.tiles).toEqual(data.tiles);
    const back = (await loadCity(imported.id, tile.key))!;
    expect(back.config.regionId).toBe(imported.id);
    back.config.regionId = st.config.regionId;
    expectSameCity(st, back);
    expect((await listRegions()).length).toBe(2);

    await deleteCity(data.id, tile.key);
    expect(await loadCity(data.id, tile.key)).toBeNull();
    await deleteRegion(imported.id);
    expect(await loadRegion(imported.id)).toBeNull();
    expect(await loadCity(imported.id, tile.key)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------ WP1 demographics fields
import { Simulation as WP1Simulation } from '../../src/sim/Simulation';
import { createSystems as wp1Systems } from '../../src/sim/systems/index';
import { OCC_PERIOD as WP1_OCC } from '../../src/sim/economy/tuning';
import { newState as wp1State, place as wp1Place, roadLine as wp1Road } from '../infra/cityGen';

describe('WP1 demographics building fields', () => {
  const FIELDS = ['kids', 'teens', 'yad', 'srs', 'wf', 'edu', 'hire'] as const;
  function town() {
    const st = wp1State(32);
    wp1Road(st, 1, 10, 30, 10, Network.Road);
    for (let x = 2; x < 28; x += 2) {
      wp1Place(st, 't_r2', x, 11, { pop: 40, wealth: 2, age: 0, rot: 2 });
      wp1Place(st, 't_cs', x, 9, { jobs: 5, rot: 0 });
    }
    const sim = new WP1Simulation(st, wp1Systems());
    sim.runDays(12);
    return { st, sim };
  }

  it('cohorts / workforce / education / hire survive save and load exactly (+ systemData.demographics)', { timeout: 60000 }, () => {
    const { st } = town();
    const homes = [...st.buildings.values()].filter((b) => b.def === 't_r2');
    const shops = [...st.buildings.values()].filter((b) => b.def === 't_cs');
    expect(homes.every((b) => b.kids !== undefined && b.srs !== undefined && b.wf !== undefined && b.edu !== undefined)).toBe(true);
    expect(shops.every((b) => b.hire !== undefined && b.kids === undefined)).toBe(true);
    const back = deserializeCity(serializeCity(st));
    for (const b of st.buildings.values()) {
      const r = back.buildings.get(b.id)!;
      for (const f of FIELDS) expect(r[f], `${b.def}.${f}`).toBe(b[f]);
    }
    expect(back.systemData.demographics).toEqual(st.systemData.demographics);
    expect(back.stats.cohorts).toEqual(st.stats.cohorts);
  });

  it('an old save without the fields loads (reference mix) and derives them within one occupancy period', { timeout: 60000 }, () => {
    const { st } = town();
    const obj = serializeCity(st);
    delete obj.buildings.opt;
    delete (obj.data.systemData as Record<string, unknown>).demographics;
    const old = deserializeCity(obj);
    for (const b of old.buildings.values()) for (const f of FIELDS) expect(b[f]).toBeUndefined();
    const sim = new WP1Simulation(old, wp1Systems());
    sim.runDays(WP1_OCC + 1);
    const homes = [...old.buildings.values()].filter((b) => b.def === 't_r2' && b.pop > 0);
    expect(homes.length).toBeGreaterThan(0);
    for (const b of homes) for (const f of ['kids', 'teens', 'yad', 'srs', 'wf', 'edu'] as const) expect(b[f], f).toBeDefined();
    expect(old.stats.workforce).toBeGreaterThan(0);
  });
});
