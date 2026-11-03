/** Save failures, region backups and the one-writer storage session shared by the region and city screens. */
import './storage.css';
import type { RegionData } from '../region/types';
import { uiRoot } from '../region/ui/modal';
import { clearRecoveryBase, deleteRegion, downloadBlob, exportRegion, findRecoverySnapshot, listRegions, loadRegion, peekRecoveryMarker, safeFileName, type PendingRecovery, type RecoveryCity } from '../save';
import { markRegionExported, openKV, regionSaveAccess, RegionSaveLock, restrictRegionSaveAccess, storageEstimate } from '../save/db';
import { h } from './dom';

export const STORAGE_FULL_MESSAGE = "Your browser's storage for Metropolis is full. Export this region, or delete old regions or save history to free space.";

export function isQuotaError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError';
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

function removeDialog(back: HTMLElement): void {
  const i = dialogs.indexOf(back);
  if (i >= 0) dialogs.splice(i, 1);
  back.remove();
}

/** Error text is visible only on request; quota errors always have the same guided recovery actions. */
export async function showStorageError(error: unknown, actions: StorageActions): Promise<void> {
  if (actions.signal?.aborted || errorDialog) return;
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
  // Export reads the last stored region even when saving failed or this tab is read-only.
  downloadBlob(await exportRegion(region.id), safeFileName(region.name));
  markRegionExported(region.id);
  window.dispatchEvent(new CustomEvent('metropolis:region-exported', { detail: region.id }));
}

/** A closed region can still be open in another tab. Never delete it without its own lock. */
export async function deleteStorageRegion(regionId: string): Promise<boolean> {
  if (session?.region.id === regionId) return false;
  const lock = new RegionSaveLock(regionId, false);
  try {
    if (!(await lock.acquire())) return false;
    await deleteRegion(regionId);
    return true;
  } finally { lock.dispose(); }
}

/** Recovery discovery adopts the global unload slot and cleans stale records, so it needs their locks too. */
export async function withRecoveryStorage<T>(run: () => Promise<T>, unavailable: T): Promise<T> {
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

/** Keep snapshot discovery and the player's decision inside the same region-lock scope. */
export async function recoveryStorageGate(city: RecoveryCity, ask: (pending: PendingRecovery) => Promise<string>): Promise<boolean> {
  if (!regionSaveAccess(city.regionId)) return true;
  return withRecoveryStorage(async () => {
    const pending = await findRecoverySnapshot(city).catch(() => null);
    return !pending || (await ask(pending)) !== 'later';
  }, true);
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
    await withRecoveryStorage(async () => {
      const pending = await findRecoverySnapshot(city);
      if (pending) await ask(pending);
    }, undefined);
  } });
  return true;
}

export interface StorageCity {
  scene: { dispose(): void } | null;
  host: { dispose(): void | Promise<void> } | null;
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
  constructor(public region: RegionData, root: HTMLElement, private reload: () => Promise<void>) {
    this.lock = new RegionSaveLock(region.id);
    this.banner = h('div', { class: 'storage-lock-notice glass', role: 'status' });
    root.appendChild(this.banner);
    session = this;
    this.lock.subscribe(() => this.render());
    this.render();
  }
  async acquire(): Promise<boolean> { return this.lock.acquire(); }
  private render(): void {
    this.renderAbort.abort();
    this.renderAbort = new AbortController();
    const signal = this.renderAbort.signal;
    this.banner.hidden = this.lock.writable;
    this.banner.replaceChildren(h('span', null, this.lock.lost ? 'This region is now open in another tab' : 'This region is open in another tab'),
      h('button', { class: 'btn', signal, onclick: async () => {
        try { await this.lock.acquire(true, this.reload); }
        catch (e) { void showStorageError(e, { retry: () => this.lock.acquire(true, this.reload).then(() => undefined) }); }
      } }, 'Use it here instead'));
  }
  dispose(): void {
    this.renderAbort.abort();
    this.lock.dispose();
    this.banner.remove();
    if (session === this) session = null;
  }
}
