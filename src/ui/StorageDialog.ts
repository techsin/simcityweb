/** Save failures, region backups and the one-writer storage session shared by the region and city screens. */
import './storage.css';
import type { RegionData } from '../region/types';
import { toast, uiRoot } from '../region/ui/modal';
import { buildRegionFile, clearRecoveryBase, deleteRegion, deserializeCity, downloadBlob, exportRegion, findRecoverySnapshot, getCityRecord, getRecoveryBase, hasRecoverySnapshot, listRegions, loadRegion, packFile, peekRecoveryMarker, rebuildRecoveredCity, safeFileName, type PendingRecovery, type RecoveryCity, type RegionFile } from '../save';
import { markRegionExported, markRegionSummaryStale, openKV, regionSaveAccess, RegionSaveLock, restrictRegionSaveAccess, storageEstimate } from '../save/db';
import type { SimHost } from '../worker/SimHost';
import { summarizeCity } from '../region/citySummary';
import { h } from './dom';

export const STORAGE_FULL_MESSAGE = "Your browser's storage for Metropolis is full. Export this region, or delete old regions or save history to free space.";

export const RECOVERY_UNDECIDED_MESSAGE = "This city's unsaved progress could not be checked, so the city was not opened. Free some browser storage, then try again.";

export function isQuotaError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError';
}

/** A full store, or a write refused because another tab now owns the region. */
export function isStorageError(error: unknown): boolean {
  return isQuotaError(error) || (!!error && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError');
}

interface StorageActions {
  retry(): Promise<void>;
  export?(): Promise<void>;
  manage?(): Promise<void>;
  signal?: AbortSignal;
}

let session: RegionStorageSession | null = null;
let errorDialog: HTMLElement | null = null;
const dialogs: HTMLElement[] = [];
const takenOver = new Map<string, number>();
let conditionVersion = 0;
/** The start-up recovery scan holds temporary locks on the regions it scans (see withRecoveryStorage). */
let recoveryScan: Promise<unknown> = Promise.resolve();

export function storageDialogOpen(): boolean { return dialogs.length > 0; }
export function storageConditionVersion(): number { return conditionVersion; }
export function regionTakenOver(regionId: string, snapshotAt: number): boolean { return snapshotAt <= (takenOver.get(regionId) ?? -Infinity); }

function removeDialog(back: HTMLElement): void {
  const i = dialogs.indexOf(back);
  if (i >= 0) dialogs.splice(i, 1);
  back.remove();
}

/** Error text is visible only on request; quota errors always have the same guided recovery actions. */
export async function showStorageError(error: unknown, actions: StorageActions): Promise<void> {
  if (actions.signal?.aborted || errorDialog || (session && !regionSaveAccess(session.region.id))) return;
  const abort = new AbortController(), signal = abort.signal;
  const previous = document.activeElement as HTMLElement | null;
  const close = () => {
    abort.abort();
    removeDialog(back);
    if (errorDialog === back) errorDialog = null;
    previous?.focus();
  };
  const status = h('p', { class: 'storage-action-status', role: 'status' });
  const act = (label: string, fn: () => Promise<void>, finish = false) => h('button', {
    class: 'btn', signal, onclick: async () => {
      if (pending) return;
      pending = true;
      try {
        if (finish) close();
        await fn();
        if (!finish) status.textContent = label === 'Export' ? 'Region exported.' : '';
      } catch (e) {
        if (finish) void showStorageError(e, actions);
        else status.textContent = 'That could not be completed. Try again, or choose another option.';
      } finally { pending = false; }
    },
  }, label);
  let pending = false;
  const quota = isQuotaError(error);
  const details = h('details', { class: 'storage-details' }, h('summary', null, 'Details'), h('pre', null, error instanceof Error ? error.stack ?? error.message : String(error)));
  const buttons = h('div', { class: 'storage-actions' },
    ...(quota ? [act('Export', actions.export ?? (() => exportStorageRegion())), act('Manage storage', actions.manage ?? (() => openManageStorage()))] : []),
    act('Retry', actions.retry, true),
    h('button', { class: 'btn', signal, onclick: close }, 'Close'),
  );
  const back = h('div', { class: 'modal-back storage-back' }, h('div', { class: 'storage-dialog mp-glass', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': quota ? 'Storage full' : 'City could not be saved', tabindex: '-1' },
    h('h2', null, quota ? 'Storage full' : 'City could not be saved'),
    h('p', null, quota ? STORAGE_FULL_MESSAGE : 'Your city could not be saved. Try again, or open Details for more information.'),
    ...(quota ? [] : [details]), status, buttons,
  ));
  errorDialog = back;
  actions.signal?.addEventListener('abort', close, { once: true, signal });
  window.addEventListener('keydown', (e) => {
    if (dialogs.at(-1) !== back) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopImmediatePropagation();
  }, { capture: true, signal });
  uiRoot().appendChild(back);
  dialogs.push(back);
  back.querySelector<HTMLButtonElement>('button')?.focus();
}

export async function exportStorageRegion(region: RegionData | string | undefined = session?.region): Promise<void> {
  if (typeof region === 'string') region = await loadRegion(region) ?? undefined;
  if (!region) throw new Error('No region is open');
  const live = session?.region.id === region.id ? session.city() : null;
  const host = live?.host;
  const blob = host?.snapshot ? new Blob([await packFile(await snapshotRegionFile(region.id, host as Pick<SimHost, 'snapshot'>)) as BlobPart], { type: 'application/octet-stream' }) : await exportRegion(region.id);
  downloadBlob(blob, safeFileName(region.name));
  markRegionExported(region.id);
  window.dispatchEvent(new CustomEvent('metropolis:region-exported', { detail: region.id }));
}

/** Rebuild the host's current snapshot into a downloadable region without saving the live city to the store. */
export async function snapshotRegionFile(regionId: string, host: Pick<SimHost, 'snapshot'>): Promise<RegionFile> {
  const snapshot = await host.snapshot('hidden');
  if (!snapshot || snapshot.marker.regionId !== regionId) throw new Error('The city snapshot is unavailable');
  const { marker, payload } = snapshot;
  const cached = getRecoveryBase(regionId, marker.tileKey);
  const record = marker.baseSavedAt === 0 ? null : cached?.savedAt === marker.baseSavedAt ? cached : await getCityRecord(await openKV(), regionId, marker.tileKey) ?? null;
  if (marker.baseSavedAt !== 0 && record?.savedAt !== marker.baseSavedAt) throw new Error('The snapshot base is no longer available');
  const city = rebuildRecoveredCity({ marker, payload, record });
  const file = await buildRegionFile(regionId);
  file.cities[marker.tileKey] = city;
  const tile = file.region.tiles.find((t) => t.key === marker.tileKey);
  if (tile) tile.city = summarizeCity(deserializeCity(city), tile.city);
  const totals = { population: 0, cities: 0, r: 0, c: 0, i: 0 };
  for (const t of file.region.tiles) if (t.city) {
    totals.cities++; totals.population += t.city.population;
    totals.r += t.city.r; totals.c += t.city.c; totals.i += t.city.i;
  }
  file.region.totals = totals;
  return file;
}

/** A closed region can still be open in another tab. Never delete it without its own lock. */
export async function deleteStorageRegion(regionId: string): Promise<boolean> {
  if (session?.region.id === regionId) return false;
  // this tab's own recovery scan may hold that region's lock: wait for it rather than blame another tab
  await recoveryScan;
  if (session?.region.id === regionId) return false;
  const lock = new RegionSaveLock(regionId, false);
  try {
    if (!(await lock.acquire())) return false;
    await deleteRegion(regionId);
    conditionVersion++;
    return true;
  } finally { lock.dispose(); }
}

/** Recovery discovery adopts the global unload slot and cleans stale records, so it needs their locks too. */
export function withRecoveryStorage<T>(run: () => Promise<T>, unavailable: T): Promise<T> {
  const scan = scanRecoveryStorage(run, unavailable);
  recoveryScan = scan.catch(() => undefined);
  return scan;
}

async function scanRecoveryStorage<T>(run: () => Promise<T>, unavailable: T): Promise<T> {
  const kv = await openKV();
  const ids = new Set((await kv.keys('recovery')).map((key) => key.split(':')[0]));
  const local = peekRecoveryMarker();
  if (local) ids.add(local.regionId);
  const locks = new Map<string, RegionSaveLock>(), temporary: RegionSaveLock[] = [];
  try {
    for (const id of ids) {
      const active = session?.region.id === id;
      const lock = active ? session!.lock : new RegionSaveLock(id, false);
      if (!active) temporary.push(lock);
      if (active ? !lock.canSave() : !(await lock.acquire())) return unavailable;
      locks.set(id, lock);
    }
    const unrestrict = restrictRegionSaveAccess((id) => !!id && !!locks.get(id)?.canSave());
    try { return await run(); }
    finally { unrestrict(); }
  } finally { for (const lock of temporary) lock.dispose(); }
}

/**
 * One city's pending snapshot, while this tab holds that city's region. Another tab can hold any other region, so this
 * scan writes to no other region: the global localStorage slot is adopted into IndexedDB only when it is this region's
 * or its own region's lock is free, and other regions' records are left alone. `undefined`: undecided, because a copy
 * of the city's snapshot is still stored but none could be offered (an adoption or a cleanup failed).
 */
async function findCityRecovery(city: RecoveryCity): Promise<PendingRecovery | null | undefined> {
  const slot = peekRecoveryMarker()?.regionId;
  const slotLock = slot && slot !== city.regionId ? new RegionSaveLock(slot, false) : null;
  try {
    const adopt = !!slotLock && await slotLock.acquire();
    const unrestrict = restrictRegionSaveAccess((id) => id === city.regionId || (adopt && id === slot && !!slotLock?.canSave()));
    let pending: PendingRecovery | null | undefined;
    try { pending = await findRecoverySnapshot(city).catch(() => undefined); }
    finally { unrestrict(); }
    return pending === null && await hasRecoverySnapshot(city) ? undefined : pending;
  } finally { slotLock?.dispose(); }
}

/** A city never opens while its own pending snapshot is undecided; other regions (and other tabs) never decide it. */
export async function recoveryStorageGate(city: RecoveryCity, ask: (pending: PendingRecovery) => Promise<string>): Promise<boolean> {
  // without its region's lock this tab cannot overwrite the snapshot: the holder, or this tab after a takeover, is asked
  if (!regionSaveAccess(city.regionId)) return true;
  const pending = await findCityRecovery(city);
  if (pending === undefined) {
    toast(RECOVERY_UNDECIDED_MESSAGE, 'bad', 6000);
    return false;
  }
  return !pending || (await ask(pending)) !== 'later';
}

export async function storageRecoveryChoice<T>(regionId: string, ask: () => Promise<T>): Promise<T | null> {
  if (!regionSaveAccess(regionId)) return null;
  const choice = await ask();
  return regionSaveAccess(regionId) ? choice : null;
}

/** Quota or ownership failure must keep a valid recovery snapshot available for another attempt. */
export function handleRecoveryStorageError(error: unknown, city: RecoveryCity, ask: (pending: PendingRecovery) => Promise<unknown>): boolean {
  if (!regionSaveAccess(city.regionId)) return true;
  if (!isQuotaError(error)) return false;
  void showStorageError(error, { export: () => exportStorageRegion(city.regionId), retry: async () => {
    if (!regionSaveAccess(city.regionId)) return;
    const pending = await findCityRecovery(city);
    if (pending === undefined) toast(RECOVERY_UNDECIDED_MESSAGE, 'bad', 6000);
    else if (pending) await ask(pending);
  } });
  return true;
}

export interface StorageCity {
  scene: { dispose(): void } | null;
  host: { dispose(): void | Promise<void>; snapshot?: SimHost['snapshot'] } | null;
  ticker?: number;
  status?: { dispose(): void };
  labels?: { dispose(): void };
}

/** Discard this tab's older city, drain its outstanding saves, then read the newly acquired region. */
export async function reopenStoredRegion(regionId: string, city: StorageCity | null, opts: {
  root: HTMLElement; saved: Promise<void>; clearCity(): void; open(data: RegionData): Promise<void>;
}): Promise<void> {
  if (city) {
    clearInterval(city.ticker);
    city.status?.dispose();
    city.labels?.dispose();
    city.scene?.dispose();
    if (!city.scene) await city.host?.dispose();
    opts.root.querySelector('.city-host')?.remove();
    opts.clearCity();
    clearRecoveryBase();
  }
  await opts.saved;
  const data = await loadRegion(regionId);
  if (!data) throw new Error('The region is no longer stored');
  await opts.open(data);
}

/** Payload sizes, including typed arrays, without serializing or copying a city's large buffers. */
export function storedBytes(value: unknown): number {
  if (typeof value === 'string') return new TextEncoder().encode(value).length;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 1;
  if (!value || typeof value !== 'object') return 0;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value.byteLength;
  return Object.entries(value).reduce((n, [key, item]) => n + storedBytes(key) + storedBytes(item), 0);
}

const bytesLabel = (n: number) => n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** NEW-03 history has no store yet; current city saves and recovery snapshots are counted today. */
export async function openManageStorage(): Promise<void> {
  const abort = new AbortController(), signal = abort.signal;
  const body = h('div', { class: 'storage-regions' });
  const status = h('p', { role: 'status' });
  const close = () => { abort.abort(); removeDialog(back); };
  const back = h('div', { class: 'modal-back storage-back' }, h('div', { class: 'storage-dialog mp-glass', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Manage storage' },
    h('h2', null, 'Manage storage'), status, body,
    h('div', { class: 'storage-actions' }, h('button', { class: 'btn', signal, onclick: close }, 'Close')),
  ));
  const refresh = async () => {
    const kv = await openKV();
    const [regions, estimate] = await Promise.all([listRegions(), storageEstimate()]);
    if (signal.aborted) return;
    status.textContent = estimate?.quota ? `${bytesLabel(estimate.usage ?? 0)} used of ${bytesLabel(estimate.quota)} in this browser.` : 'Storage sizes are approximate.';
    body.replaceChildren();
    for (const region of regions) {
      let bytes = storedBytes(region);
      const saves: HTMLElement[] = [];
      for (const store of ['cities', 'recovery'] as const) {
        for (const key of await kv.keys(store, `${region.id}:`, `${region.id}:\uffff`)) {
          const record = await kv.get<{ tileKey?: string; city?: { config?: { name?: string } } }>(store, key);
          const size = storedBytes(record);
          bytes += size;
          saves.push(h('div', { class: 'storage-slot' }, `${store === 'recovery' ? 'Recovery snapshot' : record?.city?.config?.name ?? 'City save'} · ${bytesLabel(size)}`));
        }
      }
      const current = session?.region.id === region.id;
      const confirm = h('div', { class: 'storage-delete-confirm', hidden: true }, h('p', null, `Delete ${region.name} and all its city saves? Export a backup first.`));
      const remove = h('button', { class: 'btn danger', signal, onclick: async () => {
        confirm.hidden = false;
      } }, current ? 'Current region' : 'Delete region');
      confirm.append(h('button', { class: 'btn', signal, onclick: () => { confirm.hidden = true; } }, 'Cancel'), h('button', { class: 'btn danger', signal, onclick: async () => {
        try {
          if (!(await deleteStorageRegion(region.id))) { status.textContent = 'That region is open in another tab. Close it there before deleting it.'; return; }
          await refresh();
        } catch { status.textContent = 'The region could not be deleted. Try again.'; }
      } }, 'Delete permanently'));
      remove.disabled = current;
      body.appendChild(h('div', { class: 'storage-region' },
        h('div', { class: 'storage-region-head' }, h('strong', null, region.name), h('span', null, bytesLabel(bytes)),
          h('button', { class: 'btn', signal, onclick: () => void exportStorageRegion(region).catch(() => { status.textContent = 'Export failed. Try again.'; }) }, 'Export'), remove), ...saves, confirm));
    }
    if (!regions.length) body.appendChild(h('p', null, 'No regions are stored.'));
  };
  window.addEventListener('keydown', (e) => { if (dialogs.at(-1) !== back) return; if (e.key === 'Escape') close(); e.stopImmediatePropagation(); }, { capture: true, signal });
  uiRoot().appendChild(back);
  dialogs.push(back);
  try { await refresh(); }
  catch { status.textContent = 'Stored regions could not be listed. Close this dialog and try again.'; }
}

/** Kept alive across region → city → region; only the App's region lifecycle releases its lock. */
export class RegionStorageSession {
  readonly lock: RegionSaveLock;
  private renderAbort = new AbortController();
  private banner: HTMLElement;
  /** The notice stays hidden until the first acquire settles: an open must not flash "open in another tab". */
  private settled = false;
  constructor(public region: RegionData, root: HTMLElement, private reload: () => Promise<void>, readonly city: () => StorageCity | null = () => null) {
    this.lock = new RegionSaveLock(region.id);
    this.banner = h('div', { class: 'storage-lock-notice glass', role: 'status' });
    root.appendChild(this.banner);
    session = this;
    this.lock.subscribe(() => this.render());
    this.render();
  }
  async acquire(): Promise<boolean> {
    try { return await this.lock.acquire(); }
    finally {
      this.settled = true;
      this.render();
    }
  }
  private render(): void {
    this.renderAbort.abort();
    this.renderAbort = new AbortController();
    const signal = this.renderAbort.signal;
    this.banner.hidden = !this.settled || this.lock.writable;
    this.banner.replaceChildren(h('span', null, this.lock.lost ? 'This region is now open in another tab' : 'This region is open in another tab'),
      h('button', { class: 'btn', signal, onclick: async () => {
        const reload = async () => {
          takenOver.set(this.region.id, Date.now());
          // the old holder's last city write can outlive its region summary: the reload rebuilds the tiles
          markRegionSummaryStale(this.region.id);
          await this.reload();
        };
        try { await this.lock.acquire(true, reload); }
        catch (e) { void showStorageError(e, { retry: () => this.lock.acquire(true, reload).then(() => undefined) }); }
      } }, 'Use it here instead'));
  }
  dispose(): void {
    this.renderAbort.abort();
    this.lock.dispose();
    this.banner.remove();
    if (session === this) session = null;
  }
}
