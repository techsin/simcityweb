/** LG-12: the region's storage session hands a sister-city plan to the New City dialog, under the same write checks. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CityConfigData } from '../src/sim/config';
import type { RegionModel } from '../src/region/RegionModel';
import type { SisterPlan } from '../src/region/regionEffects';
import type { RegionData, RegionTile } from '../src/region/types';
import { RegionStorage } from '../src/region/regionLock';
import type { StorageCity } from '../src/ui/StorageDialog';

const mocks = vi.hoisted(() => ({ access: vi.fn(), persist: vi.fn(), dialog: vi.fn() }));
vi.mock('../src/save', () => ({ loadRegion: vi.fn(), deleteRegion: vi.fn(), cityKey: vi.fn(), deserializeCity: vi.fn() }));
vi.mock('../src/save/db', () => ({ openKV: vi.fn(async () => ({})), regionSaveAccess: mocks.access, requestPersistentStorage: mocks.persist, regionSummaryStale: () => false, clearRegionSummaryStale: vi.fn() }));
vi.mock('../src/region/NewCityDialog', () => ({ openNewCityDialog: mocks.dialog }));
vi.mock('../src/ui/StorageDialog', () => ({ RegionStorageSession: class {}, reopenStoredRegion: vi.fn() }));

const data = { id: 'region', name: 'Harbour', tiles: [], totals: { population: 0, cities: 0, r: 0, c: 0, i: 0 } } as unknown as RegionData;
const tile = { key: '6_4' } as RegionTile;
const config = { name: 'Fairland' } as CityConfigData;
const model = { data } as RegionModel;
const plan = { id: 's1', amount: 0 } as SisterPlan;

function storage() {
  const context = {
    root: {} as HTMLElement, region: model as RegionModel | null, city: null as StorageCity | null,
    saved: Promise.resolve(), busy: false, setBusy: vi.fn(), clearCity: vi.fn(), open: vi.fn(async (_data: RegionData) => {}),
  };
  return { context, storage: new RegionStorage(() => context) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockReset().mockReturnValue(true);
  mocks.dialog.mockReset().mockResolvedValue(config);
});

describe('LG-12: founding a sister city through the storage session', () => {
  it('passes the plan to the dialog, and asks for persistent storage inside its Found click as for any founding', async () => {
    const { storage: s } = storage();
    let found: (() => void) | undefined;
    mocks.dialog.mockImplementationOnce(async (options) => { found = options.onFound; return config; });
    expect(await s.foundDialog(model, tile, plan)).toBe(config);
    expect(mocks.dialog).toHaveBeenCalledExactlyOnceWith({ region: model, tile, sister: plan, onFound: expect.any(Function) });
    expect(mocks.persist).not.toHaveBeenCalled();
    found!();
    expect(mocks.persist).toHaveBeenCalledOnce();
  });

  it('an ordinary founding carries no plan', async () => {
    const { storage: s } = storage();
    expect(await s.foundDialog(model, tile)).toBe(config);
    expect(Object.keys(mocks.dialog.mock.calls[0][0])).toEqual(['region', 'tile', 'onFound']);
  });

  it('refuses in a read-only region before and after the dialog: nothing is planned into a region another tab owns', async () => {
    const { storage: s } = storage();
    mocks.access.mockReturnValue(false);
    expect(await s.foundDialog(model, tile, plan)).toBeNull();
    expect(mocks.dialog).not.toHaveBeenCalled();
    mocks.access.mockReturnValue(true);
    mocks.dialog.mockImplementationOnce(async () => { mocks.access.mockReturnValue(false); return config; });
    expect(await s.foundDialog(model, tile, plan)).toBeNull();
  });
});
