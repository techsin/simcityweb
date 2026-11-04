/** NEW-04: takeover reads city records that outlived the old holder's region write. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevType } from '../../src/core/types';
import { loadCurrentRegion, RegionStorage } from '../../src/region/regionLock';
import { summarizeCity } from '../../src/region/citySummary';
import type { RegionData } from '../../src/region/types';
import { createCityRecord } from '../../src/save/cities';
import { MemoryKV, restrictRegionSaveAccess, setKV } from '../../src/save/db';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';

const session = vi.hoisted(() => ({ acquire: vi.fn(), dispose: vi.fn() }));
vi.mock('../../src/ui/StorageDialog', () => ({
  RegionStorageSession: class {
    acquire = session.acquire;
    dispose = session.dispose;
    constructor(public region: RegionData) {}
  },
  reopenStoredRegion: vi.fn(),
}));
vi.mock('../../src/region/NewCityDialog', () => ({ openNewCityDialog: vi.fn() }));

let kv: MemoryKV;
let release: (() => void) | undefined;
beforeEach(() => {
  kv = new MemoryKV();
  setKV(kv);
  session.acquire.mockReset().mockResolvedValue(true);
  session.dispose.mockReset();
});
afterEach(() => {
  release?.();
  release = undefined;
  vi.restoreAllMocks();
  setKV(new MemoryKV());
});

function fixture() {
  const state = new CityState(defaultCityConfig({ name: 'Port City', mayor: 'M', size: 64, seed: 7, regionId: 'region', tileX: 0, tileZ: 0 }));
  state.stats.population = 100;
  state.stats.residents = [100, 0, 0];
  const city = { ...summarizeCity(state), lastPlayed: 100, founded: 20, thumbnail: 'saved-thumbnail' };
  const region: RegionData = {
    format: 'metropolis-region', version: 1, genVersion: 1, id: 'region', name: 'Harbour', seed: 7,
    preset: 'greenvale', climate: 'temperate', created: 10, lastPlayed: 100,
    tiles: [{ key: '0_0', x: 0, z: 0, size: 1, city }],
    totals: { population: 100, cities: 1, r: 100, c: 0, i: 0 },
  };
  return { state, region };
}

describe('region summary reload after takeover', () => {
  it('rebuilds a stale tile from the completed city record, preserving its founding date and thumbnail without writing', async () => {
    const { state, region } = fixture();
    await kv.put('regions', region);
    state.day = 720;
    state.funds = 12345;
    state.stats.population = 250;
    state.stats.residents = [200, 30, 20];
    state.stats.jobsByDev[DevType.CS1] = 40;
    state.stats.jobsByDev[DevType.IA] = 10;
    const record = { ...createCityRecord(region.id, '0_0', state), savedAt: 200 };
    await kv.put('cities', record, record.key);
    const put = vi.spyOn(kv, 'put'), remove = vi.spyOn(kv, 'delete');

    const current = await loadCurrentRegion(region.id);
    expect(current?.tiles[0].city).toMatchObject({
      name: 'Port City', population: 250, r: 250, c: 40, i: 10, funds: 12345, year: 2002,
      lastPlayed: 200, founded: 20, thumbnail: 'saved-thumbnail',
    });
    expect(current?.totals).toEqual({ population: 250, cities: 1, r: 250, c: 40, i: 10 });
    expect(await kv.get('regions', region.id)).toEqual(region);
    expect(await kv.get('cities', record.key)).toEqual(record);
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('recovers a missing tile summary while keeping current summaries and tiles without records', async () => {
    const { state, region } = fixture();
    region.tiles.push({ key: '1_0', x: 1, z: 0, size: 1 });
    region.tiles.push({ key: '2_0', x: 2, z: 0, size: 1 });
    await kv.put('regions', region);
    const equalRecord = { ...createCityRecord(region.id, '0_0', state), savedAt: 100 };
    await kv.put('cities', equalRecord, equalRecord.key);
    state.config.name = 'New Port';
    state.stats.population = 75;
    state.stats.residents = [75, 0, 0];
    const newRecord = { ...createCityRecord(region.id, '1_0', state), savedAt: 200 };
    await kv.put('cities', newRecord, newRecord.key);

    const current = await loadCurrentRegion(region.id);
    expect(current?.tiles[0].city).toEqual(region.tiles[0].city);
    expect(current?.tiles[1].city).toMatchObject({ name: 'New Port', population: 75, lastPlayed: 200 });
    expect(current?.tiles[2].city).toBeUndefined();
    expect(current?.totals).toEqual({ population: 175, cities: 2, r: 175, c: 0, i: 0 });
    expect(await loadCurrentRegion('missing')).toBeNull();
  });

  it('retains an unreadable city\'s summary while refreshing a valid neighbouring record', async () => {
    const { state, region } = fixture();
    region.tiles.push({ key: '1_0', x: 1, z: 0, size: 1, city: { ...region.tiles[0].city!, name: 'Old Port' } });
    await kv.put('regions', region);
    const record = { ...createCityRecord(region.id, '0_0', state), savedAt: 200 };
    await kv.put('cities', { ...record, city: { ...record.city, format: 'invalid-city' } }, record.key);
    state.config.name = 'New Port';
    state.stats.population = 225;
    state.stats.residents = [225, 0, 0];
    const neighbour = { ...createCityRecord(region.id, '1_0', state), savedAt: 200 };
    await kv.put('cities', neighbour, neighbour.key);

    const current = await loadCurrentRegion(region.id);
    expect(current?.tiles[0].city).toEqual(region.tiles[0].city);
    expect(current?.tiles[1].city).toMatchObject({ name: 'New Port', population: 225, lastPlayed: 200 });
    expect(current?.totals).toEqual({ population: 325, cities: 2, r: 325, c: 0, i: 0 });
    expect(await kv.get('regions', region.id)).toEqual(region);
  });

  it('waits for the region lock before reading the stored city and never writes the repaired summary', async () => {
    const { state, region } = fixture();
    await kv.put('regions', region);
    const record = { ...createCityRecord(region.id, '0_0', state), savedAt: 200 };
    await kv.put('cities', record, record.key);
    let writable = false, acquired!: (value: boolean) => void;
    release = restrictRegionSaveAccess(() => writable);
    session.acquire.mockReturnValue(new Promise<boolean>((resolve) => { acquired = resolve; }));
    const get = vi.spyOn(kv, 'get'), put = vi.spyOn(kv, 'put'), remove = vi.spyOn(kv, 'delete');
    const context = { root: {} as HTMLElement, region: null, city: null, saved: Promise.resolve(), clearCity: vi.fn(), open: vi.fn() };
    const storage = new RegionStorage(() => context);
    const opening = storage.open(region);
    expect(session.acquire).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
    writable = true;
    acquired(true);
    expect((await opening).tiles[0].city?.lastPlayed).toBe(200);
    expect(get).toHaveBeenCalledWith('cities', record.key);
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    storage.dispose();
  });
});
