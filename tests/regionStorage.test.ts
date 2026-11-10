/** Storage coordination keeps App's region and city transitions inside one lock lifetime. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CityConfigData } from '../src/sim/config';
import type { RegionModel } from '../src/region/RegionModel';
import type { RegionData, RegionTile } from '../src/region/types';
import { RegionStorage } from '../src/region/regionLock';
import type { StorageCity } from '../src/ui/StorageDialog';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), remove: vi.fn(), access: vi.fn(), persist: vi.fn(), dialog: vi.fn(), reopen: vi.fn(),
}));
const sessions = vi.hoisted(() => {
  class Session {
    readonly acquire = vi.fn(async () => false);
    readonly dispose = vi.fn();
    constructor(public region: RegionData, readonly root: HTMLElement, readonly reload: () => Promise<void>) {
      instances.push(this);
    }
  }
  const instances: Session[] = [];
  return { Session, instances };
});
vi.mock('../src/save', () => ({ loadRegion: mocks.load, deleteRegion: mocks.remove, cityKey: vi.fn(), deserializeCity: vi.fn() }));
vi.mock('../src/save/db', () => ({ openKV: vi.fn(async () => ({})), regionSaveAccess: mocks.access, requestPersistentStorage: mocks.persist, regionSummaryStale: () => false, clearRegionSummaryStale: vi.fn() }));
vi.mock('../src/region/NewCityDialog', () => ({ openNewCityDialog: mocks.dialog }));
vi.mock('../src/ui/StorageDialog', () => ({ RegionStorageSession: sessions.Session, reopenStoredRegion: mocks.reopen }));

const data = { id: 'region', name: 'Harbour', tiles: [], totals: { population: 0, cities: 0, r: 0, c: 0, i: 0 } } as unknown as RegionData;
const tile = { key: '0_0' } as RegionTile;
const config = { name: 'Port City' } as CityConfigData;
const model = { data } as RegionModel;

function fixture() {
  const context = {
    root: {} as HTMLElement, region: model as RegionModel | null, city: null as StorageCity | null,
    saved: Promise.resolve(), busy: false, setBusy: vi.fn(), clearCity: vi.fn(), open: vi.fn(async (_data: RegionData) => {}),
  };
  return { context, storage: new RegionStorage(() => context) };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessions.instances.length = 0;
  mocks.load.mockReset().mockResolvedValue(null);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  mocks.access.mockReset().mockReturnValue(true);
  mocks.dialog.mockReset().mockResolvedValue(config);
  mocks.reopen.mockReset().mockResolvedValue(undefined);
});

describe('region storage transitions', () => {
  it('keeps the same lock through region and city transitions, updating its current region data', async () => {
    const { context, storage } = fixture();
    await storage.hold(data);
    const updated = { ...data, name: 'Renamed Harbour' };
    context.city = { scene: null, host: null };
    await storage.hold(updated);
    context.city = null;
    await storage.hold(updated);
    expect(sessions.instances).toHaveLength(1);
    expect(sessions.instances[0].region).toBe(updated);
    expect(sessions.instances[0].acquire).toHaveBeenCalledOnce();
    expect(sessions.instances[0].dispose).not.toHaveBeenCalled();
    storage.dispose();
    storage.dispose();
    expect(sessions.instances[0].dispose).toHaveBeenCalledOnce();
  });

  it('releases the old region before acquiring another and reacquires after returning to the title', async () => {
    const { storage } = fixture();
    await storage.hold(data);
    const first = sessions.instances[0];
    const next = { ...data, id: 'other' };
    first.dispose.mockImplementationOnce(() => { expect(sessions.instances).toHaveLength(1); });
    await storage.hold(next);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(sessions.instances[1].acquire).toHaveBeenCalledOnce();
    storage.dispose();
    await storage.hold(next);
    expect(sessions.instances).toHaveLength(3);
    expect(sessions.instances[1].dispose).toHaveBeenCalledOnce();
    storage.dispose();
  });

  it('loads the latest stored region after acquiring its session, with the supplied data as a fallback', async () => {
    const { storage } = fixture();
    const latest = { ...data, name: 'Updated in another tab' };
    mocks.load.mockImplementationOnce(async () => {
      expect(sessions.instances[0].acquire).toHaveBeenCalledOnce();
      return latest;
    });
    expect(await storage.open(data)).toBe(latest);
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(data.id);
    expect(await storage.open(data)).toBe(data);
    expect(sessions.instances).toHaveLength(1);
    storage.dispose();
  });

  it('uses the current city and save chain on takeover and allows reopening without awaiting its own acquisition', async () => {
    const { context, storage } = fixture();
    await storage.hold(data);
    const city = { scene: { dispose: vi.fn() }, host: null };
    context.city = city;
    const saved = Promise.resolve();
    context.saved = saved;
    const latest = { ...data, name: 'New owner data' };
    mocks.load.mockResolvedValue(latest);
    context.open.mockImplementationOnce(async (region) => {
      expect(await storage.open(region)).toBe(latest);
    });
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    mocks.reopen.mockImplementationOnce(async (_id, _city, current) => {
      expect(current).toBe(context);
      await pending;
      await current.open(latest);
    });
    const reloading = sessions.instances[0].reload();
    expect(mocks.reopen).toHaveBeenCalledExactlyOnceWith(data.id, city, context);
    expect(context.open).not.toHaveBeenCalled();
    finish();
    await reloading;
    expect(context.open).toHaveBeenCalledExactlyOnceWith(latest);
    expect(sessions.instances).toHaveLength(1);
    expect(sessions.instances[0].acquire).toHaveBeenCalledOnce();
    storage.dispose();
  });

  it('opens the stored region instead of resetting one held by another tab', async () => {
    const { context, storage } = fixture();
    const latest = { ...data, name: 'Existing region' };
    mocks.access.mockReturnValue(false);
    mocks.load.mockResolvedValue(latest);
    expect(await storage.reset(data)).toBe(false);
    expect(context.open).toHaveBeenCalledExactlyOnceWith(latest);
    expect(mocks.remove).not.toHaveBeenCalled();
    storage.dispose();
  });

  it('resets a writable testing region and preserves its existing delete-failure tolerance', async () => {
    const { storage } = fixture();
    mocks.remove.mockRejectedValueOnce(new Error('Missing store'));
    expect(await storage.reset(data)).toBe(true);
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(data.id);
    expect(mocks.load).not.toHaveBeenCalled();
    storage.dispose();
  });
});

describe('founding storage ownership', () => {
  it('requests persistence only from the dialog Found callback', async () => {
    const { storage } = fixture();
    let found!: () => void;
    mocks.dialog.mockImplementationOnce(async (options) => { found = options.onFound; return config; });
    expect(await storage.foundDialog(model, tile)).toBe(config);
    expect(mocks.dialog).toHaveBeenCalledWith({ region: model, tile, onFound: expect.any(Function) });
    expect(mocks.persist).not.toHaveBeenCalled();
    found();
    expect(mocks.persist).toHaveBeenCalledOnce();
  });

  it('does not open the dialog in a read-only tab or for a superseded region', async () => {
    const { context, storage } = fixture();
    mocks.access.mockReturnValue(false);
    expect(await storage.foundDialog(model, tile)).toBeNull();
    mocks.access.mockReturnValue(true);
    context.region = null;
    expect(await storage.foundDialog(model, tile)).toBeNull();
    expect(mocks.dialog).not.toHaveBeenCalled();
  });

  it('discards a Found result if the region or its ownership changes while the dialog is open', async () => {
    const { context, storage } = fixture();
    mocks.dialog.mockImplementationOnce(async () => { context.region = null; return config; });
    expect(await storage.foundDialog(model, tile)).toBeNull();
    context.region = model;
    mocks.dialog.mockImplementationOnce(async () => { mocks.access.mockReturnValue(false); return config; });
    expect(await storage.foundDialog(model, tile)).toBeNull();
  });
});
