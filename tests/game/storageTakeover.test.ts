/**
 * T086 B1 and B6, on the real App. main.ts boots on import, here over a fake DOM, with the real RegionStorage, region
 * lock (a fake navigator.locks shared with "the other tab"), recovery store and LocalSimHost; only the screens that draw
 * are stubs. CityScene is absent, so a city opens as main.ts's placeholder on a real host.
 *
 * B1 (T036s4's post-merge QA): "Use it here instead" clicked while a read-only tab was still loading its city reopened
 * the region at once. The load then entered the city over the region screen, as the writer and without the Recover
 * question, so the other tab's snapshot was overwritten 30 s later and its saves missed the region's tile summary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegionData, RegionTile } from '../../src/region/types';
import type { RecoveryMarker } from '../../src/save';
import type { StoreName } from '../../src/save/db';
import type { LocalSimHost } from '../../src/worker/SimHost';
import { FEl, FNode, textNode, textOf } from './fakeDom';
import { FakeLocks, regionLockName } from '../save/fakeLocks';

interface ScreenStub { el: FEl; disposed: boolean }
interface RegionStub extends ScreenStub {
  model: { data: RegionData; tileByKey(key: string): RegionTile | undefined };
  cb: { onPlay(tile: RegionTile): void };
}
const ui = vi.hoisted(() => ({
  titles: [] as (ScreenStub & { o: { onContinue?: () => void } })[],
  regions: [] as RegionStub[],
  recover: vi.fn(), toast: vi.fn(),
  screen: (cls: string): FEl => Object.assign(document.createElement('div') as unknown as FEl, { className: cls }),
}));

vi.mock('../../src/audio', () => ({ audio: new Proxy({}, { get: () => () => undefined }) }));
vi.mock('../../src/ui/uiSounds', () => ({ installUiSounds: () => undefined }));
vi.mock('../../src/game/CityScene', () => ({ CityScene: undefined, default: undefined }));
vi.mock('../../src/region/NeighborLabels', () => ({ NeighborLabels: class {} }));
vi.mock('../../src/region/NewCityDialog', () => ({ openNewCityDialog: vi.fn(), terrainOptionsFor: vi.fn() }));
vi.mock('../../src/region/mapPreview', () => ({
  cityThumbnail: () => 'thumb', drawCityMap: () => undefined, normalizeThumbnail: async (t: string) => t,
  regionPreviewDataUrl: () => 'preview', regionPreviewKey: () => 'key',
}));
vi.mock('../../src/region/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/region/settings')>()), // the defaults and checks src/game/settings.ts reads
  applyFirstRunQuality: () => false, cityOverrides: () => ({}), loadSettings: () => ({ quality: 'medium' }),
  saveSettings: () => undefined, takeCityChanges: () => undefined,
}));
vi.mock('../../src/region/ui/dialogs', () => ({
  openRecoverDialog: ui.recover, openCredits: vi.fn(), openLoadRegion: vi.fn(), openNewRegion: vi.fn(), openSettings: vi.fn(), openSimCrashDialog: vi.fn(),
}));
vi.mock('../../src/region/ui/SaveStatus', () => ({ SaveStatus: class { el = { disabled: false }; mount() {} set() {} dispose() {} } }));
vi.mock('../../src/region/ui/modal', () => {
  let root: unknown = null;
  return { setUiRoot: (el: unknown) => { root = el; }, uiRoot: () => root, toast: ui.toast };
});
vi.mock('../../src/region/ui/TitleScreen', () => ({
  TitleScreen: class {
    readonly ready = Promise.resolve();
    readonly el = ui.screen('title-screen');
    disposed = false;
    constructor(root: FEl, readonly o: { onContinue?: () => void }) { root.appendChild(this.el); ui.titles.push(this); }
    dispose(): void { this.disposed = true; this.el.remove(); }
  },
}));
vi.mock('../../src/region/RegionScreen', () => ({
  RegionScreen: class {
    readonly ready = Promise.resolve();
    readonly el = ui.screen('region-hud');
    disposed = false;
    constructor(root: FEl, readonly model: RegionStub['model'], readonly cb: RegionStub['cb']) { root.appendChild(this.el); ui.regions.push(this); }
    selectTile(): void {}
    async refresh(): Promise<void> {}
    dispose(): void { this.disposed = true; this.el.remove(); }
  },
}));

class El extends FEl {
  hidden = false;
  replaceChildren(...children: (FNode | string)[]): void { this.textContent = ''; this.append(...children); }
}
class LocalStore {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
  removeItem(key: string): void { this.values.delete(key); }
}

/** the App's state this test reads (private in main.ts) */
interface AppView {
  root: El;
  busy: boolean;
  region: RegionStub['model'] | null;
  city: { tile: RegionTile; host: LocalSimHost; entered?: boolean } | null;
  saveCityState(reason: 'manual'): Promise<void>;
}

const REGION = 'rtest', TILE = '0_0';
const realTimers = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval };
let locks: FakeLocks;
let timers: ReturnType<typeof setTimeout>[];

beforeEach(() => {
  vi.resetModules();
  ui.titles.length = ui.regions.length = 0;
  ui.recover.mockReset().mockResolvedValue(null);
  ui.toast.mockReset();
  locks = new FakeLocks();
  timers = [];
  // every timer the App starts ends with its test: the city's 1 s ticker would outlive the fake document
  const tracked = <A extends unknown[]>(start: (...args: A) => ReturnType<typeof setTimeout>) => (...args: A) => {
    const id = start(...args);
    timers.push(id);
    return id;
  };
  const timeout = tracked((fn: () => void, ms?: number) => realTimers.setTimeout(fn, ms));
  const interval = tracked((fn: () => void, ms?: number) => realTimers.setInterval(fn, ms));
  vi.stubGlobal('setTimeout', timeout);
  vi.stubGlobal('setInterval', interval);
  const events = () => {
    const t = new EventTarget();
    return { addEventListener: t.addEventListener.bind(t), removeEventListener: t.removeEventListener.bind(t), dispatchEvent: t.dispatchEvent.bind(t) };
  };
  vi.stubGlobal('document', {
    ...events(), body: new El('body'), hidden: false, visibilityState: 'visible',
    createElement: (tag: string) => new El(tag), createTextNode: (s: string) => textNode(s), getElementById: () => null, querySelector: () => null,
  });
  vi.stubGlobal('Node', FNode);
  vi.stubGlobal('window', { ...events(), setTimeout: timeout, setInterval: interval, clearTimeout, clearInterval });
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('localStorage', new LocalStore());
  vi.stubGlobal('navigator', { locks });
  vi.stubGlobal('requestAnimationFrame', (fn: (t: number) => void) => timeout(() => fn(performance.now()), 1));
});
afterEach(() => {
  for (const id of timers) clearTimeout(id);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * A stored region with one city (last saved on day 0) and a recovery snapshot of it (day 10): the progress of the tab
 * that had it open. `otherTab`: that tab is alive and holds the region. Then the App boots to its title screen.
 */
async function boot(opts: { otherTab: boolean; lastTile?: boolean }) {
  const db = await import('../../src/save/db');
  const fx = await import('../save/fixtures');
  const idb = await import('../../src/save/recoveryIdb');
  const save = await import('../../src/save');
  const dialog = await import('../../src/ui/StorageDialog');
  const { summarizeCity } = await import('../../src/region/citySummary');
  const kv = new fx.PersistentMemoryKV();
  db.setKV(kv);
  const f = fx.recoveryFixture();
  const region = fx.regionData(REGION);
  region.tiles[0].city = summarizeCity(fx.smallCity());
  await kv.put('regions', region);
  await kv.put('cities', f.record, f.record.key);
  await idb.storeRecoveryIdb(kv, f.marker, f.payload);
  save.setLastSession(opts.lastTile === false ? { regionId: REGION } : { regionId: REGION, tileKey: TILE });
  const other = opts.otherTab ? new db.RegionSaveLock(REGION, false) : null;
  if (other) expect(await other.acquire()).toBe(true);
  await import('../../src/main');
  const app = (window as unknown as { __metropolis: AppView }).__metropolis;
  await vi.waitFor(() => expect(ui.titles).toHaveLength(1), long);
  const snapshot = async () => (await kv.get<{ marker: RecoveryMarker; payload: Uint8Array }>('recovery', f.record.key)) ?? null;
  /** hold back every read of one store until the returned function is called */
  const holdReads = (held: StoreName) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const get = kv.get.bind(kv);
    vi.spyOn(kv, 'get').mockImplementation((async (store: StoreName, key: string) => {
      if (store === held) await gate;
      return get(store, key);
    }) as typeof kv.get);
    return release;
  };
  return { app, db, kv, f, save, dialog, other, snapshot, holdReads, stored: await snapshot() };
}

const notice = (app: AppView) => app.root.querySelector('.storage-lock-notice') as El | null;
const liveRegions = () => ui.regions.filter((r) => !r.disposed);
const settle = (ms = 150) => new Promise((resolve) => realTimers.setTimeout(resolve, ms));
/** (generous: the full suite runs this beside CPU-heavy files) */
const long = { timeout: 30000, interval: 10 };

describe('a takeover and a city entry never overlap (T086 B1)', () => {
  it('waits for the city that is loading, then leaves one region screen, the snapshot, the Recover question and a tile that follows the saves', async () => {
    const { app, db, kv, f, save, dialog, other, snapshot, holdReads, stored } = await boot({ otherTab: true });
    // the read-only tab's Continue, with the city's record held back: the load is in flight
    const release = holdReads('cities');
    ui.titles[0].o.onContinue!();
    await vi.waitFor(() => expect(app.busy).toBe(true), long);
    expect(textOf(notice(app)!.querySelector('span')!)).toBe('This region is open in another tab');
    expect(notice(app)!.hidden).toBe(false);
    expect(app.root.querySelectorAll('.loading')).toHaveLength(1);

    // the QA's click, 0.4 s into the load (storage.css now also hides the button under a loading screen)
    notice(app)!.querySelector('button')!.click();
    await settle();
    // the other tab lost the region at the click; here nothing is torn down or reopened under the load
    expect(other!.writable).toBe(false);
    expect(other!.lost).toBe(true);
    expect(db.regionSaveAccess(REGION)).toBe(false);
    expect(app.busy).toBe(true);
    expect(ui.regions).toHaveLength(0);
    expect(app.city).toBeNull();

    release();
    await vi.waitFor(() => expect(liveRegions()).toHaveLength(1), long);
    await vi.waitFor(() => expect(db.regionSaveAccess(REGION)).toBe(true), long);
    // one screen: the region, held by this tab. The city the load opened is gone, and no loading screen is left
    expect(ui.regions).toHaveLength(1);
    expect(app.city).toBeNull();
    expect(app.root.querySelectorAll('.city-host')).toHaveLength(0);
    expect(app.root.querySelectorAll('.loading')).toHaveLength(0);
    expect(app.busy).toBe(false);
    expect(notice(app)!.hidden).toBe(true);
    expect(app.region).toBe(liveRegions()[0].model);
    // nobody was asked yet, and the other tab's snapshot is as it left it
    expect(ui.recover).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(stored);
    expect(stored!.marker.at).toBe(f.marker.at);

    // Play: the Recover question comes first, worded as another tab's progress, and Recover gives that progress
    ui.recover.mockResolvedValueOnce('recover');
    liveRegions()[0].cb.onPlay(app.region!.tileByKey(TILE)!);
    await vi.waitFor(() => expect(app.city?.entered).toBe(true), long);
    expect(ui.recover).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ regionId: REGION, tileKey: TILE, at: f.marker.at }));
    expect(dialog.regionTakenOver(REGION, f.marker.at)).toBe(true);
    expect(app.city!.host.state.day).toBe(f.state.day);
    expect(await snapshot()).toBeNull();
    expect(liveRegions()).toHaveLength(0);
    expect(app.root.querySelectorAll('.city-host')).toHaveLength(1);

    // the new writer's save reaches the stored region's tile: the city sits on the region model that is saved
    expect(app.city!.tile).toBe(app.region!.tileByKey(TILE));
    app.city!.host.sim.state.funds = 123_456;
    await app.saveCityState('manual');
    const record = (await save.getCityRecord(kv, REGION, TILE))!;
    const tile = (await save.loadRegion(REGION))!.tiles[0].city!;
    expect(tile.funds).toBe(123_456);
    expect(tile.lastPlayed).toBeGreaterThanOrEqual(record.savedAt);
    expect(record.savedAt).toBeGreaterThan(f.record.savedAt);
  }, 120000);

  it('ignores Play while the takeover reopens the region, so the gate cannot be passed as a read-only tab', async () => {
    const { app, db, kv, snapshot, holdReads, stored } = await boot({ otherTab: true, lastTile: false });
    ui.titles[0].o.onContinue!();
    await vi.waitFor(() => expect(liveRegions()).toHaveLength(1), long);
    await vi.waitFor(() => expect(app.root.querySelectorAll('.loading')).toHaveLength(0), long);
    expect(db.regionSaveAccess(REGION)).toBe(false);
    const first = liveRegions()[0];
    // the takeover's read of the region is held back: the old region screen still takes clicks
    const release = holdReads('regions');
    notice(app)!.querySelector('button')!.click();
    await vi.waitFor(() => expect(kv.get).toHaveBeenCalledWith('regions', REGION), long);
    first.cb.onPlay(first.model.tileByKey(TILE)!);
    await settle();
    release();
    await vi.waitFor(() => expect(db.regionSaveAccess(REGION)).toBe(true), long);
    await vi.waitFor(() => expect(app.busy).toBe(false), long);
    await settle();
    expect(app.city).toBeNull();
    expect(app.root.querySelectorAll('.city-host')).toHaveLength(0);
    expect(liveRegions()).toHaveLength(1);
    expect(liveRegions()[0]).not.toBe(first);
    expect(ui.recover).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(stored);
  }, 120000);
});

describe('"Later" on the title\'s Continue (T086 B6)', () => {
  it('releases the region: the tab on its title screen holds no lock and shows no notice', async () => {
    // each "Recover unsaved progress?" is answered "Later"; the region is held while it is asked
    const heldWhenAsked: boolean[] = [];
    ui.recover.mockImplementation(async () => { heldWhenAsked.push(locks.held.has(regionLockName(REGION))); return null; });
    const { app, db, snapshot, stored } = await boot({ otherTab: false });
    // the start-up offer comes first (under the scan's temporary lock); Continue then asks about the city itself
    await vi.waitFor(() => expect(ui.recover).toHaveBeenCalledOnce(), long);
    await settle();
    expect(locks.held.size).toBe(0);
    ui.titles[0].o.onContinue!();
    await vi.waitFor(() => expect(ui.recover).toHaveBeenCalledTimes(2), long);
    expect(heldWhenAsked).toEqual([true, true]);
    await vi.waitFor(() => expect(locks.held.has(regionLockName(REGION))).toBe(false), long);
    await settle();
    expect(db.currentRegionSaveLock()).toBeNull();
    expect(notice(app)).toBeNull();
    expect(app.city).toBeNull();
    expect(app.root.querySelectorAll('.loading')).toHaveLength(0);
    expect(ui.regions).toHaveLength(0);
    expect(ui.titles[0].disposed).toBe(false);
    expect(await snapshot()).toEqual(stored);
    // a second tab opens the region as its writer
    const second = new db.RegionSaveLock(REGION, false);
    expect(await second.acquire()).toBe(true);
    second.dispose();
  }, 120000);
});
