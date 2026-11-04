/** NEW-04: real guided error DOM and the export route stay usable when writes fail or belong to another tab. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegionData } from '../../src/region/types';
import type { PendingRecovery, RecoveryCity } from '../../src/save';
import { exportStorageRegion, handleRecoveryStorageError, recoveryStorageGate, regionTakenOver, RegionStorageSession, reopenStoredRegion, showStorageError, storageDialogOpen, storageRecoveryChoice, STORAGE_FULL_MESSAGE, withRecoveryStorage } from '../../src/ui/StorageDialog';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';
import { smallCity } from '../save/fixtures';
import { serializeCity } from '../../src/save/serialize';

const page = vi.hoisted(() => ({ root: null as unknown as HTMLElement }));
const store = vi.hoisted(() => ({
  exportRegion: vi.fn(), downloadBlob: vi.fn(), listRegions: vi.fn(), deleteRegion: vi.fn(),
  saveCity: vi.fn(), saveRegion: vi.fn(), markRegionExported: vi.fn(), checkStorageSpace: vi.fn(),
  requireRegionSaveAccess: vi.fn(), openKV: vi.fn(), storageEstimate: vi.fn(),
  put: vi.fn(), remove: vi.fn(), keys: vi.fn(), get: vi.fn(), peekRecoveryMarker: vi.fn(),
  acquireLock: vi.fn(), disposeLock: vi.fn(), restrictRegionSaveAccess: vi.fn(), unrestrict: vi.fn(),
  loadRegion: vi.fn(), clearRecoveryBase: vi.fn(), regionSaveAccess: vi.fn(), findRecoverySnapshot: vi.fn(),
  buildRegionFile: vi.fn(), getCityRecord: vi.fn(), getRecoveryBase: vi.fn(), packFile: vi.fn(),
  rebuildRecoveredCity: vi.fn(), deserializeCity: vi.fn(),
}));
const lockState = vi.hoisted(() => ({
  instances: [] as { regionId: string; writable: boolean; active: boolean }[],
  restrictions: new Set<(regionId?: string) => boolean>(),
}));
vi.mock('../../src/region/ui/modal', () => ({ uiRoot: () => page.root, confirmDialog: vi.fn() }));
vi.mock('../../src/save', () => ({
  exportRegion: store.exportRegion, downloadBlob: store.downloadBlob, listRegions: store.listRegions,
  deleteRegion: store.deleteRegion, saveCity: store.saveCity, saveRegion: store.saveRegion,
  peekRecoveryMarker: store.peekRecoveryMarker,
  loadRegion: store.loadRegion, clearRecoveryBase: store.clearRecoveryBase, findRecoverySnapshot: store.findRecoverySnapshot,
  buildRegionFile: store.buildRegionFile, getCityRecord: store.getCityRecord, getRecoveryBase: store.getRecoveryBase, packFile: store.packFile,
  rebuildRecoveredCity: store.rebuildRecoveredCity, deserializeCity: store.deserializeCity,
  safeFileName: (name: string) => `${name}.metropolis`,
}));
vi.mock('../../src/save/db', () => ({
  markRegionExported: store.markRegionExported, openKV: store.openKV, storageEstimate: store.storageEstimate,
  checkStorageSpace: store.checkStorageSpace, requireRegionSaveAccess: store.requireRegionSaveAccess,
  regionSaveAccess: store.regionSaveAccess,
  restrictRegionSaveAccess: store.restrictRegionSaveAccess,
  RegionSaveLock: class {
    writable = false;
    readonly lost = false;
    constructor(readonly regionId: string, readonly active = true) { lockState.instances.push(this); }
    subscribe(fn: (writable: boolean) => void): () => void { fn(this.writable); return () => {}; }
    canSave(): boolean { return this.writable; }
    async acquire(steal = false, beforeWrite?: () => Promise<void>): Promise<boolean> {
      const allowed = !!store.acquireLock(this.regionId, this.active);
      if (allowed && steal) await beforeWrite?.();
      return this.writable = allowed;
    }
    dispose(): void { this.writable = false; store.disposeLock(this.regionId); }
  },
}));

class StorageEl extends FEl {
  replaceChildren(...children: FNode[]): void { this.textContent = ''; this.append(...children); }
}

installFakeDom();
let root: StorageEl;
let life: AbortController;
let windowEvents: EventTarget;
const region = { id: 'region-one', name: 'Harbour' } as RegionData;
beforeEach(() => {
  vi.clearAllMocks();
  lockState.instances = [];
  lockState.restrictions.clear();
  root = new StorageEl('main');
  page.root = root as unknown as HTMLElement;
  life = new AbortController();
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => new StorageEl(tag)) as typeof document.createElement);
  windowEvents = new EventTarget();
  vi.spyOn(windowEvents, 'dispatchEvent');
  vi.stubGlobal('window', windowEvents);
  store.exportRegion.mockResolvedValue(new Blob(['region bytes']));
  store.listRegions.mockResolvedValue([]);
  store.keys.mockResolvedValue([]);
  store.peekRecoveryMarker.mockReturnValue(null);
  store.findRecoverySnapshot.mockResolvedValue(null);
  store.regionSaveAccess.mockImplementation((id?: string) => [...lockState.restrictions].every((allow) => allow(id)));
  store.acquireLock.mockReturnValue(false);
  store.restrictRegionSaveAccess.mockImplementation((allow: (regionId?: string) => boolean) => {
    lockState.restrictions.add(allow);
    return () => { lockState.restrictions.delete(allow); store.unrestrict(); };
  });
  store.openKV.mockResolvedValue({ put: store.put, delete: store.remove, keys: store.keys, get: store.get });
  store.storageEstimate.mockResolvedValue({ usage: 1000, quota: 1000 });
  store.checkStorageSpace.mockRejectedValue(new DOMException('Full', 'QuotaExceededError'));
  store.requireRegionSaveAccess.mockImplementation(() => { throw new DOMException('Read only', 'NotAllowedError'); });
});
afterEach(() => {
  life.abort();
  for (const button of root.querySelectorAll('button')) if (textOf(button) === 'Close') button.click();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const button = (label: string): FEl => root.querySelectorAll('button').find((el) => textOf(el) === label)!;
const recoveryCity: RecoveryCity = { regionId: region.id, tileKey: '0_0' };
const pendingRecovery = (at: number): PendingRecovery => ({
  marker: { v: 1, ...recoveryCity, at, baseSavedAt: 0, bytes: 1, ls: false, dropped: [], cityName: 'Port City', day: 1, population: 10, funds: 100 },
  payload: new Uint8Array([at]), record: null,
});

describe('storage error dialog', () => {
  it('counts error and Manage storage dialogs until the last one closes', async () => {
    expect(storageDialogOpen()).toBe(false);
    await showStorageError(new DOMException('Full', 'QuotaExceededError'), { retry: async () => {}, signal: life.signal });
    expect(storageDialogOpen()).toBe(true);
    button('Manage storage').click(); await flush();
    life.abort(); // the city-owned error closes; the independent manager remains
    expect(storageDialogOpen()).toBe(true);
    button('Close').click();
    expect(storageDialogOpen()).toBe(false);
  });

  it('lets the ownership banner explain a save rejected after lock loss', async () => {
    const session = new RegionStorageSession(region, root as unknown as HTMLElement, async () => {});
    try {
      store.regionSaveAccess.mockReturnValue(false);
      await showStorageError(new DOMException('Taken over', 'NotAllowedError'), { retry: async () => {}, signal: life.signal });
      expect(root.querySelector('.storage-dialog')).toBeNull();
      expect(storageDialogOpen()).toBe(false);
    } finally { session.dispose(); }
  });

  it('records that a region came from another tab only when takeover reloads it', async () => {
    const takenRegion = { ...region, id: 'taken-copy' };
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const reload = vi.fn().mockResolvedValue(undefined);
    const session = new RegionStorageSession(takenRegion, root as unknown as HTMLElement, reload);
    try {
      expect(regionTakenOver(takenRegion.id, 1000)).toBe(false);
      store.acquireLock.mockReturnValue(true);
      button('Use it here instead').click(); await flush();
      expect(reload).toHaveBeenCalledOnce();
      expect(regionTakenOver(takenRegion.id, 999)).toBe(true);
      expect(regionTakenOver(takenRegion.id, 1000)).toBe(true);
      expect(regionTakenOver(takenRegion.id, 1001)).toBe(false);
    } finally { session.dispose(); }
  });

  it('replaces a raw quota exception with the guided message and working Export, Manage storage and Retry actions', async () => {
    const actions = { export: vi.fn().mockResolvedValue(undefined), manage: vi.fn().mockResolvedValue(undefined), retry: vi.fn().mockResolvedValue(undefined), signal: life.signal };
    await showStorageError(new DOMException('RAW IDB QUOTA ERROR', 'QuotaExceededError'), actions);
    expect(textOf(root)).toContain(STORAGE_FULL_MESSAGE);
    expect(textOf(root)).not.toContain('RAW IDB QUOTA ERROR');
    expect(root.querySelector('.storage-dialog')?.getAttribute('role')).toBe('alertdialog');
    expect(root.querySelectorAll('button').map(textOf)).toEqual(['Export', 'Manage storage', 'Retry', 'Close']);
    button('Export').click(); await flush();
    expect(actions.export).toHaveBeenCalledOnce();
    expect(textOf(root)).toContain('Region exported.');
    button('Manage storage').click(); await flush();
    expect(actions.manage).toHaveBeenCalledOnce();
    button('Retry').click(); await flush();
    expect(actions.retry).toHaveBeenCalledOnce();
    expect(root.querySelector('.storage-dialog')).toBeNull();
  });

  it('keeps a generic exception behind closed Details and offers a plain sentence and Retry', async () => {
    await showStorageError(new Error('RAW transaction internals'), { retry: async () => {}, signal: life.signal });
    const details = root.querySelector('details')!;
    expect(details).not.toBeNull();
    expect(details.getAttribute('open')).toBeNull();
    expect(textOf(details.querySelector('summary')!)).toBe('Details');
    expect(textOf(details.querySelector('pre')!)).toContain('RAW transaction internals');
    const visible = root.all().filter((el) => el.tagName === 'p').map(textOf).join(' ');
    expect(visible).toContain('Your city could not be saved. Try again, or open Details for more information.');
    expect(visible).not.toContain('RAW transaction internals');
    expect(root.querySelectorAll('button').map(textOf)).toEqual(['Retry', 'Close']);
  });

  it('closes a city-owned error dialog when the city lifetime ends', async () => {
    await showStorageError(new Error('failed'), { retry: async () => {}, signal: life.signal });
    expect(root.querySelector('.storage-dialog')).not.toBeNull();
    life.abort();
    expect(root.querySelector('.storage-dialog')).toBeNull();
  });

  it('opens Manage storage from the guided dialog and lists existing saves without writing', async () => {
    store.listRegions.mockResolvedValueOnce([region]);
    store.keys.mockImplementation(async (name: string) => name === 'cities' ? [`${region.id}:0_0`] : []);
    store.get.mockResolvedValue({ city: { config: { name: 'Port City' }, bytes: new Uint8Array(1024) } });
    await showStorageError(new DOMException('Full', 'QuotaExceededError'), { retry: async () => {}, signal: life.signal });
    button('Manage storage').click(); await flush();
    expect(root.querySelector('.storage-regions')).not.toBeNull();
    expect(textOf(root.querySelector('.storage-region')!)).toContain('Harbour');
    expect(textOf(root.querySelector('.storage-slot')!)).toContain('Port City · 1 KB');
    expect(store.listRegions).toHaveBeenCalledOnce();
    expect(store.put).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });
});

describe('export during a storage failure', () => {
  it('uses the running host snapshot for the quota dialog Export button', async () => {
    const state = smallCity();
    state.day = 100;
    state.funds = 777;
    const serialized = serializeCity(state, { copy: true });
    const file = { region: { ...region, tiles: [{ key: '0_0' }] }, cities: { '0_0': serialized } };
    const snapshot = vi.fn().mockResolvedValue({ marker: { regionId: region.id, tileKey: '0_0', baseSavedAt: 0 }, payload: new Uint8Array([1]) });
    const session = new RegionStorageSession(region, root as unknown as HTMLElement, async () => {}, () => ({ scene: null, host: { dispose() {}, snapshot } }));
    store.rebuildRecoveredCity.mockReturnValue(serialized);
    store.deserializeCity.mockReturnValue(state);
    store.buildRegionFile.mockResolvedValue(file);
    store.packFile.mockResolvedValue(new Uint8Array([5]));
    try {
      await showStorageError(new DOMException('Full', 'QuotaExceededError'), { retry: async () => {}, signal: life.signal });
      button('Export').click(); await flush(); await flush();
      expect(snapshot).toHaveBeenCalledExactlyOnceWith('hidden');
      expect(store.packFile).toHaveBeenCalledExactlyOnceWith(file);
      expect(store.exportRegion).not.toHaveBeenCalled();
      expect(store.downloadBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), 'Harbour.metropolis');
      expect(store.markRegionExported).toHaveBeenCalledExactlyOnceWith(region.id);
      expect(store.saveCity).not.toHaveBeenCalled();
      expect(store.saveRegion).not.toHaveBeenCalled();
    } finally { session.dispose(); }
  });

  it('can export a recovery region by id before a region session is open', async () => {
    store.loadRegion.mockResolvedValueOnce(region);
    await exportStorageRegion(region.id);
    expect(store.loadRegion).toHaveBeenCalledExactlyOnceWith(region.id);
    expect(store.exportRegion).toHaveBeenCalledExactlyOnceWith(region.id);
    expect(store.markRegionExported).toHaveBeenCalledExactlyOnceWith(region.id);
  });

  it('exports the current read-only region without a write or quota check, then records its backup', async () => {
    const session = new RegionStorageSession(region, root as unknown as HTMLElement, async () => {});
    try {
      expect(await session.acquire()).toBe(false);
      await showStorageError(new DOMException('Full', 'QuotaExceededError'), { retry: async () => {}, signal: life.signal });
      button('Export').click(); await flush();
      expect(store.exportRegion).toHaveBeenCalledExactlyOnceWith(region.id);
      expect(store.downloadBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), 'Harbour.metropolis');
      expect(store.markRegionExported).toHaveBeenCalledExactlyOnceWith(region.id);
      expect(store.saveCity).not.toHaveBeenCalled();
      expect(store.saveRegion).not.toHaveBeenCalled();
      expect(store.put).not.toHaveBeenCalled();
      expect(store.remove).not.toHaveBeenCalled();
      expect(store.requireRegionSaveAccess).not.toHaveBeenCalled();
      expect(store.checkStorageSpace).not.toHaveBeenCalled();
      expect(windowEvents.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'metropolis:region-exported', detail: region.id }));
    } finally { session.dispose(); }
  });

  it('does not record a backup when exporting fails', async () => {
    store.exportRegion.mockRejectedValueOnce(new Error('read failed'));
    await expect(exportStorageRegion(region)).rejects.toThrow('read failed');
    expect(store.downloadBlob).not.toHaveBeenCalled();
    expect(store.markRegionExported).not.toHaveBeenCalled();
    expect(windowEvents.dispatchEvent).not.toHaveBeenCalled();
  });
});

describe('recovery storage ownership', () => {
  it('locks every IndexedDB and localStorage recovery region once and rechecks ownership during the scan', async () => {
    store.keys.mockResolvedValue(['first:0_0', 'first:0_0#journal', 'second:1_0']);
    store.peekRecoveryMarker.mockReturnValue({ regionId: 'local-only' });
    store.acquireLock.mockReturnValue(true);
    const run = vi.fn(async () => {
      const allow = [...lockState.restrictions][0];
      expect(allow('first')).toBe(true);
      expect(allow('second')).toBe(true);
      expect(allow('local-only')).toBe(true);
      expect(allow('created-after-the-scan')).toBe(false);
      expect(allow(undefined)).toBe(false);
      await Promise.resolve();
      lockState.instances.find((lock) => lock.regionId === 'second')!.writable = false;
      expect(allow('second')).toBe(false);
      expect(allow('first')).toBe(true);
      return 'recovered';
    });
    expect(await withRecoveryStorage(run, 'unavailable')).toBe('recovered');
    expect(store.acquireLock.mock.calls).toEqual([['first', false], ['second', false], ['local-only', false]]);
    expect(store.disposeLock.mock.calls).toEqual([['first'], ['second'], ['local-only']]);
    expect(lockState.restrictions.size).toBe(0);
    expect(store.unrestrict).toHaveBeenCalledOnce();
  });

  it('skips recovery and releases all temporary locks if another tab owns any candidate region', async () => {
    store.keys.mockResolvedValue(['available:0_0', 'busy:0_0']);
    store.acquireLock.mockImplementation((id: string) => id !== 'busy');
    const run = vi.fn(async () => 'recovered');
    expect(await withRecoveryStorage(run, 'later')).toBe('later');
    expect(run).not.toHaveBeenCalled();
    expect(store.restrictRegionSaveAccess).not.toHaveBeenCalled();
    expect(store.disposeLock.mock.calls).toEqual([['available'], ['busy']]);
  });

  it('reuses the current writable region lock without releasing the region session', async () => {
    store.acquireLock.mockReturnValue(true);
    const session = new RegionStorageSession(region, root as unknown as HTMLElement, async () => {});
    try {
      await session.acquire();
      store.keys.mockResolvedValue([`${region.id}:0_0`]);
      expect(await withRecoveryStorage(async () => 'recovered', 'later')).toBe('recovered');
      expect(store.acquireLock).toHaveBeenCalledExactlyOnceWith(region.id, true);
      expect(lockState.instances).toHaveLength(1);
      expect(store.disposeLock).not.toHaveBeenCalled();
    } finally { session.dispose(); }
  });

  it('keeps a stale read-only session disabled instead of reacquiring it through a recovery scan', async () => {
    const session = new RegionStorageSession(region, root as unknown as HTMLElement, async () => {});
    try {
      store.keys.mockResolvedValue([`${region.id}:0_0`]);
      store.acquireLock.mockReturnValue(true);
      const run = vi.fn(async () => 'recovered');
      expect(await withRecoveryStorage(run, 'later')).toBe('later');
      expect(run).not.toHaveBeenCalled();
      expect(store.acquireLock).not.toHaveBeenCalled();
      expect(store.disposeLock).not.toHaveBeenCalled();
      expect(session.lock.canSave()).toBe(false);
    } finally { session.dispose(); }
  });

  it('removes the permission restriction and releases temporary locks when recovery throws', async () => {
    store.keys.mockResolvedValue(['first:0_0']);
    store.acquireLock.mockReturnValue(true);
    await expect(withRecoveryStorage(async () => { throw new Error('recovery failed'); }, 'later')).rejects.toThrow('recovery failed');
    expect(lockState.restrictions.size).toBe(0);
    expect(store.unrestrict).toHaveBeenCalledOnce();
    expect(store.disposeLock).toHaveBeenCalledExactlyOnceWith('first');
  });
});

describe('recovery storage decisions', () => {
  it('keeps discovery and the pending recovery prompt under the same lock until the player chooses later', async () => {
    store.keys.mockResolvedValue([`${region.id}:0_0`]);
    store.acquireLock.mockReturnValue(true);
    const pending = pendingRecovery(1);
    store.findRecoverySnapshot.mockImplementationOnce(async () => {
      expect(store.regionSaveAccess(region.id)).toBe(true);
      expect(lockState.restrictions.size).toBe(1);
      return pending;
    });
    let choose!: (choice: string) => void;
    const ask = vi.fn(() => new Promise<string>((resolve) => { choose = resolve; }));
    const gate = recoveryStorageGate(recoveryCity, ask);
    await flush();
    expect(store.findRecoverySnapshot).toHaveBeenCalledExactlyOnceWith(recoveryCity);
    expect(ask).toHaveBeenCalledExactlyOnceWith(pending);
    expect(lockState.restrictions.size).toBe(1);
    expect(store.disposeLock).not.toHaveBeenCalled();
    choose('later');
    expect(await gate).toBe(false);
    expect(lockState.restrictions.size).toBe(0);
    expect(store.disposeLock).toHaveBeenCalledExactlyOnceWith(region.id);
  });

  it('does not discover or prompt for recovery when this tab cannot own its region', async () => {
    const ask = vi.fn(async () => 'recovered');
    store.regionSaveAccess.mockReturnValueOnce(false);
    expect(await recoveryStorageGate(recoveryCity, ask)).toBe(true);
    expect(store.openKV).not.toHaveBeenCalled();
    store.keys.mockResolvedValue([`${region.id}:0_0`]);
    expect(await recoveryStorageGate(recoveryCity, ask)).toBe(true);
    expect(store.findRecoverySnapshot).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
    expect(store.disposeLock).toHaveBeenCalledExactlyOnceWith(region.id);
  });

  it('returns a recovery choice only while this tab still owns the region after the prompt', async () => {
    let choose!: (choice: string) => void;
    const ask = vi.fn(() => new Promise<string>((resolve) => { choose = resolve; }));
    const choice = storageRecoveryChoice(region.id, ask);
    expect(ask).toHaveBeenCalledOnce();
    store.regionSaveAccess.mockReturnValue(false);
    choose('discard');
    expect(await choice).toBeNull();
    expect(store.regionSaveAccess.mock.calls).toEqual([[region.id], [region.id]]);
  });

  it('does not open a recovery prompt without access and keeps an authorized choice', async () => {
    const ask = vi.fn(async () => 'recover');
    store.regionSaveAccess.mockReturnValueOnce(false);
    expect(await storageRecoveryChoice(region.id, ask)).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    expect(await storageRecoveryChoice(region.id, ask)).toBe('recover');
    expect(ask).toHaveBeenCalledOnce();
  });

  it('keeps a quota failure recoverable and refinds the latest pending snapshot inside the Retry lock', async () => {
    store.keys.mockResolvedValue([`${region.id}:0_0`]);
    store.acquireLock.mockReturnValue(true);
    const previous = pendingRecovery(1), latest = pendingRecovery(2);
    let available = previous;
    store.findRecoverySnapshot.mockImplementation(async () => available);
    const ask = vi.fn(async (pending: PendingRecovery) => {
      expect(pending).toBe(latest);
      expect(lockState.restrictions.size).toBe(1);
      expect(store.regionSaveAccess(region.id)).toBe(true);
      expect(store.disposeLock).not.toHaveBeenCalled();
    });
    expect(handleRecoveryStorageError(new DOMException('RAW QUOTA', 'QuotaExceededError'), recoveryCity, ask)).toBe(true);
    expect(textOf(root)).toContain(STORAGE_FULL_MESSAGE);
    expect(textOf(root)).not.toContain('RAW QUOTA');
    expect(store.findRecoverySnapshot).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    available = latest;
    button('Retry').click(); await flush();
    expect(store.findRecoverySnapshot).toHaveBeenCalledExactlyOnceWith(recoveryCity);
    expect(ask).toHaveBeenCalledExactlyOnceWith(latest);
    expect(root.querySelector('.storage-dialog')).toBeNull();
    expect(store.disposeLock).toHaveBeenCalledExactlyOnceWith(region.id);
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it('preserves recovery on an ownership failure without presenting a retry that cannot save', () => {
    store.regionSaveAccess.mockReturnValue(false);
    const ask = vi.fn();
    expect(handleRecoveryStorageError(new DOMException('Read only', 'NotAllowedError'), recoveryCity, ask)).toBe(true);
    expect(root.querySelector('.storage-dialog')).toBeNull();
    expect(store.findRecoverySnapshot).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it('leaves a different restoration failure for the caller to handle', () => {
    expect(handleRecoveryStorageError(new Error('Invalid snapshot'), recoveryCity, vi.fn())).toBe(false);
    expect(root.querySelector('.storage-dialog')).toBeNull();
    expect(store.findRecoverySnapshot).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });
});

describe('reopening a region after taking its lock', () => {
  it('disposes the stale city, drains its outstanding save, then reads and opens the latest stored region', async () => {
    const order: string[] = [];
    const cityRoot = new StorageEl('div');
    cityRoot.className = 'city-host';
    root.append(cityRoot);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => { order.push('timer'); });
    const hostDispose = vi.fn();
    const city = {
      ticker: 42,
      status: { dispose: () => { order.push('status'); } },
      labels: { dispose: () => { order.push('labels'); } },
      scene: { dispose: () => { order.push('scene'); } },
      host: { dispose: hostDispose },
    };
    let finish!: () => void;
    const saved = new Promise<void>((resolve) => { finish = resolve; });
    const latest = { ...region, name: 'Updated Harbour' };
    store.clearRecoveryBase.mockImplementationOnce(() => { order.push('base'); });
    store.loadRegion.mockImplementationOnce(async () => { order.push('read'); return latest; });
    const open = vi.fn(async () => { order.push('open'); });
    const reopening = reopenStoredRegion(region.id, city, {
      root: root as unknown as HTMLElement, saved,
      clearCity: () => { expect(root.querySelector('.city-host')).toBeNull(); order.push('clear-city'); },
      open,
    });
    expect(order).toEqual(['timer', 'status', 'labels', 'scene', 'clear-city', 'base']);
    expect(hostDispose).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(store.loadRegion).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    finish(); await reopening;
    expect(order).toEqual(['timer', 'status', 'labels', 'scene', 'clear-city', 'base', 'read', 'open']);
    expect(store.loadRegion).toHaveBeenCalledExactlyOnceWith(region.id);
    expect(open).toHaveBeenCalledExactlyOnceWith(latest);
    expect(store.saveCity).not.toHaveBeenCalled();
    expect(store.saveRegion).not.toHaveBeenCalled();
  });
});
