/** T086 B1: the takeover's reload waits for a city entry in flight, then keeps new entries out while it reopens the region. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegionData } from '../src/region/types';
import { RegionStorage } from '../src/region/regionLock';
import type { StorageCity } from '../src/ui/StorageDialog';

const mocks = vi.hoisted(() => ({ reopen: vi.fn() }));
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
vi.mock('../src/save', () => ({ loadRegion: vi.fn(async () => null), deleteRegion: vi.fn(), cityKey: vi.fn(), deserializeCity: vi.fn() }));
vi.mock('../src/save/db', () => ({ openKV: vi.fn(async () => ({})), regionSaveAccess: () => false, requestPersistentStorage: vi.fn(), regionSummaryStale: () => false, clearRegionSummaryStale: vi.fn() }));
vi.mock('../src/region/NewCityDialog', () => ({ openNewCityDialog: vi.fn() }));
vi.mock('../src/ui/StorageDialog', () => ({ RegionStorageSession: sessions.Session, reopenStoredRegion: mocks.reopen }));

const data = { id: 'region', name: 'Harbour', tiles: [], totals: { population: 0, cities: 0, r: 0, c: 0, i: 0 } } as unknown as RegionData;

/** the App's side: `busy` as playCity holds it, and a log of what the takeover did with it */
function fixture() {
  const log: string[] = [];
  const context = {
    root: {} as HTMLElement, region: null, city: null as StorageCity | null, saved: Promise.resolve(), busy: false,
    setBusy(busy: boolean) { context.busy = busy; log.push(busy ? 'busy' : 'idle'); },
    clearCity: vi.fn(), open: vi.fn(async (_data: RegionData) => {}),
  };
  return { context, log, storage: new RegionStorage(() => context) };
}

beforeEach(() => {
  vi.useFakeTimers();
  sessions.instances.length = 0;
  mocks.reopen.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a takeover while a city is being entered', () => {
  it('waits until the entry has finished, then tears down the city that entry opened', async () => {
    const { context, log, storage } = fixture();
    await storage.hold(data);
    context.busy = true; // playCity is loading the city: App.city is still empty
    const reloading = sessions.instances[0].reload();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.reopen).not.toHaveBeenCalled();
    expect(log).toEqual([]);
    const entered = { scene: { dispose: vi.fn() }, host: null };
    context.city = entered;
    context.busy = false; // enterCity returned
    mocks.reopen.mockImplementationOnce(async (_id, _city, current) => {
      expect(current.busy).toBe(true);
      log.push('reopen');
    });
    await vi.advanceTimersByTimeAsync(50);
    await reloading;
    expect(mocks.reopen).toHaveBeenCalledExactlyOnceWith(data.id, entered, context);
    expect(log).toEqual(['busy', 'reopen', 'idle']);
    expect(context.busy).toBe(false);
    storage.dispose();
  });

  it('holds App.busy while the region reopens, and gives it back when the reload fails', async () => {
    const { context, log, storage } = fixture();
    await storage.hold(data);
    let finish!: () => void;
    mocks.reopen.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const reloading = sessions.instances[0].reload();
    // nothing in flight: the reload starts in the click's own task, and no city entry can start under it
    expect(mocks.reopen).toHaveBeenCalledOnce();
    expect(context.busy).toBe(true);
    finish();
    await reloading;
    expect(context.busy).toBe(false);
    mocks.reopen.mockRejectedValueOnce(new Error('The region is no longer stored'));
    await expect(sessions.instances[0].reload()).rejects.toThrow('The region is no longer stored');
    expect(context.busy).toBe(false);
    expect(log).toEqual(['busy', 'idle', 'busy', 'idle']);
    storage.dispose();
  });

  it('reopens nothing when the player left the region while it waited', async () => {
    const { context, log, storage } = fixture();
    await storage.hold(data);
    context.busy = true;
    const reloading = sessions.instances[0].reload();
    await vi.advanceTimersByTimeAsync(200);
    await storage.hold({ ...data, id: 'other' }); // another region was opened: the first session is gone
    context.busy = false;
    await vi.advanceTimersByTimeAsync(50);
    await reloading;
    expect(mocks.reopen).not.toHaveBeenCalled();
    expect(log).toEqual([]);
    expect(sessions.instances[0].dispose).toHaveBeenCalledOnce();
    storage.dispose();
  });
});
