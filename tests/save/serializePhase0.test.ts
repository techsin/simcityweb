/**
 * SIM_DEPTH_SPEC Phase 0 save contract: derived layers are not saved, stocks are, optional building fields round-trip
 * (NaN = undefined), older saves get default stats / zero-padded history, and the save size stays bounded.
 */
import { describe, expect, it } from 'vitest';
import { CityState, HISTORY_KEYS, defaultStats, type Building } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { DERIVED_LAYERS, OPTIONAL_BUILDING_FIELDS, deserializeCity, estimateSize, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';

/** per-cell layers that existed before SIM_DEPTH_SPEC (save-size baseline) */
const LEGACY_LAYERS = new Set([
  'heights', 'water', 'trees', 'zone', 'network', 'netFlags', 'powerLines', 'subway', 'building', 'powered', 'watered',
  'traffic', 'congestion', 'commute', 'airPollution', 'waterPollution', 'garbage', 'noise', 'crime', 'policeCov', 'fireCov',
  'healthCov', 'eduCov', 'parkCov', 'transitCov', 'landValue', 'desirability',
]);

function city(size: number): CityState {
  return new CityState(defaultCityConfig({ size, seed: 5, terrain: 'flat' }));
}
function building(id: number, x: number, extra: Partial<Building> = {}): Building {
  return { id, def: 'res_cottage', x, z: 2, w: 1, d: 1, rot: 0, variant: 0, pop: 5, jobs: 0, capacity: 8, wealth: 1, built: 1, age: 9, flags: 0, baseY: 0, health: 0.7, unhappy: 0, ...extra };
}
function add(st: CityState, b: Building): void {
  st.buildings.set(b.id, b);
  st.building[st.idx(b.x, b.z)] = b.id;
  st.nextBuildingId = Math.max(st.nextBuildingId, b.id + 1);
}

describe('Phase 0 save contract', () => {
  it('derived layers are neither written nor restored; stocks are persisted', () => {
    const st = city(32);
    st.eduElemCov[5] = 0.7;
    st.respFire[3] = 2.5;
    st.soil[7] = 0.4;
    st.landfillFill[9] = 0.25;
    const obj = serializeCity(st);
    for (const k of DERIVED_LAYERS) expect(obj.layers[k], k).toBeUndefined();
    expect(obj.layers.soil).toBeDefined();
    expect(obj.layers.landfillFill).toBeDefined();
    // a save that still carries a derived layer (e.g. hand-made) is ignored on load
    (obj.layers as Record<string, unknown>).eduElemCov = st.eduElemCov;
    const back = deserializeCity(obj);
    expect(back.eduElemCov[5]).toBe(0);
    expect(back.respFire[3]).toBe(0);
    expect(back.soil[7]).toBeCloseTo(0.4, 6);
    expect(back.landfillFill[9]).toBe(0.25);
  });

  it('optional building fields round-trip exactly (Float32, NaN = undefined) and only when set', () => {
    const st = city(16);
    add(st, building(1, 1));
    add(st, building(2, 3, { kids: Math.fround(0.21), teens: Math.fround(0.08), yad: Math.fround(0.05), srs: Math.fround(0.1), wf: Math.fround(0.5), edu: Math.fround(0.33), hire: Math.fround(0.9) }));
    let obj = serializeCity(st);
    expect(Object.keys(obj.buildings.opt ?? {}).sort()).toEqual([...OPTIONAL_BUILDING_FIELDS].sort());
    expect(obj.buildings.extra).toEqual({});
    let back = deserializeCity(decodeBundle(encodeBundle(obj)) as SerializedCity);
    expect(back.buildings.get(1)!.kids).toBeUndefined();
    expect('hire' in back.buildings.get(1)!).toBe(false);
    expect(back.buildings.get(2)).toEqual(st.buildings.get(2));
    // no building sets a field -> no column at all (Phase 0 saves do not grow)
    st.buildings.delete(2);
    obj = serializeCity(st);
    expect(obj.buildings.opt).toBeUndefined();
    back = deserializeCity(obj);
    expect(back.buildings.get(1)!.wf).toBeUndefined();
  });

  it('older saves get default stats and zero-padded history series', () => {
    const st = city(16);
    st.history.t.push(10, 11, 12);
    st.history.pop.push(100, 200, 300);
    st.history.approval.push(50, 51, 52);
    st.stats.population = 300;
    const obj = serializeCity(st, { copy: true });
    const data = obj.data as { stats: Record<string, unknown>; history: Record<string, unknown> };
    // simulate a pre-spec save: remove every new stats field / history key
    const legacyStats = new Set(['population', 'residents', 'jobsByDev', 'jobCapByDev', 'workforce', 'employed', 'unemployment', 'demand', 'demandCap',
      'powerSupply', 'powerDemand', 'waterSupply', 'waterDemand', 'garbageProduced', 'garbageCapacity', 'eq', 'hq', 'avgLandValue', 'avgCrime',
      'avgPollution', 'avgTraffic', 'avgCommute', 'approval', 'tripsCar', 'tripsTransit', 'tripsWalk', 'buildingCount']);
    for (const k of Object.keys(data.stats)) if (!legacyStats.has(k)) delete data.stats[k];
    const legacyHist = new Set(['t', 'pop', 'funds', 'income', 'expense', 'r', 'c', 'i', 'landValue', 'crime', 'pollution', 'traffic', 'eq', 'hq', 'approval']);
    for (const k of Object.keys(data.history)) if (!legacyHist.has(k)) delete data.history[k];
    const back = deserializeCity(obj);
    expect(back.stats.population).toBe(300);
    const def = defaultStats();
    expect(back.stats.emergency).toEqual(def.emergency);
    expect(back.stats.needs).toEqual(def.needs);
    expect(back.stats.tapWater).toBe(1);
    expect(back.stats.justice.policeMul).toBe(1);
    // nested fill: a save with a partial nested object keeps its values and gains the missing keys
    const obj2 = serializeCity(back, { copy: true });
    const st2 = (obj2.data as { stats: { emergency: Record<string, unknown> } }).stats;
    st2.emergency = { medScore: 0.7 };
    const back2 = deserializeCity(obj2);
    expect(back2.stats.emergency.medScore).toBe(0.7);
    expect(back2.stats.emergency.month).toEqual(def.emergency.month);
    for (const k of HISTORY_KEYS) expect(back.history[k].length, k).toBe(k === 't' || legacyHist.has(k) ? st.history[k].length : 3);
    expect(back.history.pop).toEqual([100, 200, 300]);
    expect(back.history.incidents).toEqual([0, 0, 0]);
  });

  it('a 256² save grows by <= 1 MB of layers vs. the pre-spec layer set; optional columns <= 28 B / building', () => {
    const st = city(256);
    const obj = serializeCity(st);
    let added = 0;
    for (const [k, v] of Object.entries(obj.layers)) {
      if (LEGACY_LAYERS.has(k)) continue;
      added += Array.isArray(v) ? v.reduce((s, a) => s + a.byteLength, 0) : v.byteLength;
    }
    expect(added).toBeLessThanOrEqual(1 << 20);
    // with every optional field set on every building
    const n = 2000;
    for (let k = 0; k < n; k++) add(st, building(k + 1, k % 256, { z: (k / 256) | 0, kids: 0.1, teens: 0.1, yad: 0.1, srs: 0.1, wf: 0.5, edu: 0.5, hire: 1 }));
    const withOpt = serializeCity(st);
    for (const b of st.buildings.values()) for (const f of OPTIONAL_BUILDING_FIELDS) delete (b as unknown as Record<string, unknown>)[f];
    const noOpt = serializeCity(st);
    expect((estimateSize(withOpt) - estimateSize(noOpt)) / n).toBeLessThanOrEqual(28);
  });
});
