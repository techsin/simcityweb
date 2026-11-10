/** NEW-04 B7: an export rebuilds the running host snapshot even when quota or another tab prevents storing it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevType } from '../../src/core/types';
import { summarizeCity } from '../../src/region/citySummary';
import { clearRecoveryBase, getCityRecord, saveCity } from '../../src/save/cities';
import { restrictRegionSaveAccess, setKV } from '../../src/save/db';
import { deserializeCity, loadRegion, packFile, readRegionFile, saveRegion, type RegionFile } from '../../src/save';
import { snapshotRegionFile } from '../../src/ui/StorageDialog';
import { LocalSimHost } from '../../src/worker/SimHost';
import { MemStorage, PersistentMemoryKV, regionData, smallCity } from './fixtures';

vi.mock('../../src/audio', () => ({ audio: { play: vi.fn() } }));

let now: number;
let kv: PersistentMemoryKV;
let local: MemStorage;
const hosts: LocalSimHost[] = [];
const restrictions: (() => void)[] = [];
beforeEach(() => {
  now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  kv = new PersistentMemoryKV();
  setKV(kv);
  clearRecoveryBase();
  local = new MemStorage();
  vi.stubGlobal('localStorage', local);
});
afterEach(async () => {
  for (const release of restrictions.splice(0)) release();
  for (const host of hosts.splice(0)) await host.dispose();
  clearRecoveryBase();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture() {
  const region = regionData();
  const state = smallCity(), neighbour = smallCity();
  state.day = 10;
  state.funds = 5000;
  state.stats.population = 100;
  state.stats.residents = [75, 25, 0];
  state.stats.jobsByDev[DevType.CS1] = 12;
  state.stats.jobsByDev[DevType.IA] = 7;
  neighbour.config.name = 'Neighbour City';
  neighbour.day = 7;
  neighbour.stats.population = 45;
  neighbour.stats.residents = [45, 0, 0];
  neighbour.zone[2] = 1;
  region.tiles[0].city = summarizeCity(state);
  region.tiles[1].city = summarizeCity(neighbour);
  region.totals = { population: 145, cities: 2, r: 145, c: 12, i: 7 };
  await saveRegion(region);
  await saveCity(region.id, '1_0', neighbour);
  await saveCity(region.id, '0_0', state);
  const base = (await getCityRecord(kv, region.id, '0_0'))!;
  const host = new LocalSimHost(state, { persistence: { regionId: region.id, tileKey: '0_0', regionName: region.name } });
  hosts.push(host);
  await host.start({});
  now = 2000;
  state.day = 60;
  state.funds = 9876;
  state.stats.population = 390;
  state.stats.residents = [300, 90, 0];
  state.stats.jobsByDev[DevType.CS1] = 35;
  state.stats.jobsByDev[DevType.IA] = 20;
  return { region, state, host, base };
}

function expectLiveCity(file: RegionFile): void {
  const city = deserializeCity(file.cities['0_0']);
  expect(city.day).toBe(60);
  expect(city.funds).toBe(9876);
  expect(city.stats.population).toBe(390);
  expect(city.stats.residents).toEqual([300, 90, 0]);
}

describe('running city region export', () => {
  it('uses the host snapshot for the current city and its summary while retaining the other city and stored saves', async () => {
    const { region, host, base } = await fixture();
    const snapshot = vi.spyOn(host, 'snapshot');
    const file = await snapshotRegionFile(region.id, host);
    expect(snapshot).toHaveBeenCalledExactlyOnceWith('hidden');
    expectLiveCity(file);
    expect(file.region.tiles[0].city).toMatchObject({ population: 390, r: 390, c: 35, i: 20, funds: 9876 });
    expect(file.region.totals).toEqual({ population: 435, cities: 2, r: 435, c: 35, i: 20 });
    expect(Object.keys(file.cities).sort()).toEqual(['0_0', '1_0']);
    const neighbour = deserializeCity(file.cities['1_0']);
    expect(neighbour.config.name).toBe('Neighbour City');
    expect(neighbour.day).toBe(7);
    expect(neighbour.stats.population).toBe(45);
    expect(neighbour.zone[2]).toBe(1);
    const stored = (await getCityRecord(kv, region.id, '0_0'))!;
    expect(stored.savedAt).toBe(base.savedAt);
    expect(stored.city.scalars.day).toBe(10);
    expect(stored.city.scalars.funds).toBe(5000);
    const storedRegion = (await loadRegion(region.id))!;
    expect(storedRegion.tiles[0].city?.population).toBe(100);
    expect(storedRegion.totals.population).toBe(145);
  });

  it('can use the stored base after the snapshot leaves the host recovery cache', async () => {
    const { region, host } = await fixture();
    const ack = await host.snapshot('hidden');
    clearRecoveryBase();
    vi.spyOn(host, 'snapshot').mockResolvedValueOnce(ack);
    expectLiveCity(await snapshotRegionFile(region.id, host));
  });

  it('produces a usable download payload while both recovery stores are full', async () => {
    const { region, host } = await fixture();
    local.quota = 0;
    const put = vi.spyOn(kv, 'put').mockRejectedValue(new DOMException('Full', 'QuotaExceededError'));
    const snapshot = vi.spyOn(host, 'snapshot');
    const file = await snapshotRegionFile(region.id, host);
    expect(snapshot).toHaveBeenCalledExactlyOnceWith('hidden');
    const ack = await snapshot.mock.results[0].value;
    expect(ack!.payload.length).toBeGreaterThan(0);
    expect(ack!.ls).toBe(false);
    expect(put.mock.calls.map(([store]) => store)).toEqual(['recovery']);
    expect(local.m.size).toBe(0);
    expect(await kv.keys('recovery')).toEqual([]);
    expectLiveCity(await readRegionFile(await packFile(file, false)));
    expect((await getCityRecord(kv, region.id, '0_0'))!.city.scalars.day).toBe(10);
  });

  it('keeps the live payload exportable when read-only access prevents every save and recovery write', async () => {
    const { region, host } = await fixture();
    restrictions.push(restrictRegionSaveAccess(() => false));
    await expect(host.save('manual')).rejects.toMatchObject({ name: 'NotAllowedError' });
    const snapshot = vi.spyOn(host, 'snapshot');
    const file = await snapshotRegionFile(region.id, host);
    const ack = await snapshot.mock.results[0].value;
    expect(snapshot).toHaveBeenCalledExactlyOnceWith('hidden');
    expect(ack!.payload.length).toBeGreaterThan(0);
    expect(ack!.ls).toBe(false);
    expect(local.m.size).toBe(0);
    expect(await kv.keys('recovery')).toEqual([]);
    expectLiveCity(await readRegionFile(await packFile(file, false)));
    expect((await getCityRecord(kv, region.id, '0_0'))!.city.scalars.day).toBe(10);
  });

  it.each(['missing', 'different region'] as const)('rejects a %s host snapshot instead of exporting the stale stored city', async (kind) => {
    const { region, host } = await fixture();
    const ack = (await host.snapshot('hidden'))!;
    vi.spyOn(host, 'snapshot').mockResolvedValueOnce(kind === 'missing' ? null : { ...ack, marker: { ...ack.marker, regionId: 'another-region' } });
    await expect(snapshotRegionFile(region.id, host)).rejects.toThrow('The city snapshot is unavailable');
  });

  it('rejects a snapshot whose base was replaced instead of substituting the stored city', async () => {
    const { region, host, base } = await fixture();
    const ack = await host.snapshot('hidden');
    clearRecoveryBase();
    await kv.put('cities', { ...base, savedAt: base.savedAt + 1 }, base.key);
    vi.spyOn(host, 'snapshot').mockResolvedValueOnce(ack);
    await expect(snapshotRegionFile(region.id, host)).rejects.toThrow('The snapshot base is no longer available');
  });

  it('rejects corrupt snapshot bytes instead of returning a stale export', async () => {
    const { region, host } = await fixture();
    const ack = (await host.snapshot('hidden'))!;
    vi.spyOn(host, 'snapshot').mockResolvedValueOnce({ ...ack, payload: new Uint8Array([1, 2, 3]) });
    await expect(snapshotRegionFile(region.id, host)).rejects.toThrow();
  });
});
