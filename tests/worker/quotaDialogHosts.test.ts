/**
 * T083 (c): B9 of T036 step 4 (NOTE-058), the guided quota dialog on the packet hosts. The Worker protocol's save reply
 * used to drop the error's name, so a full store opened the generic "City could not be saved" on the loopback; T061
 * item 7 made the reply carry it (tests/worker/saveErrorName.test.ts pins the name). This pins the dialog itself, with
 * the real StorageDialog: a save that a full store refuses opens "Storage full" with Export, Manage storage and Retry on
 * the loopback and on the worker host, in both of its persistences, exactly as on the local host. The save goes
 * through withRegionSaveAccess, as the App's does (doSaveCity).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { clearRecoveryBase, type CityRecord } from '../../src/save/cities';
import { setKV, withRegionSaveAccess, type StoreName } from '../../src/save/db';
import { serializeCity } from '../../src/save/serialize';
import { showStorageError, storageDialogOpen, STORAGE_FULL_MESSAGE } from '../../src/ui/StorageDialog';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { LocalSimHost, type SimHost } from '../../src/worker/SimHost';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { FEl, textNode, textOf } from '../game/fakeDom';
import { newState, place } from '../infra/cityGen';
import { PersistentMemoryKV } from '../save/fixtures';
import { bootIdb, bootNode, within } from './workerHarness';

const page = vi.hoisted(() => ({ root: null as unknown as HTMLElement }));
vi.mock('../../src/region/ui/modal', () => ({ uiRoot: () => page.root, toast: vi.fn() }));

const FULL = 'Browser storage is full';
/** the browser's store, full for the stores in `full` */
class FullKV extends PersistentMemoryKV {
  full = new Set<StoreName>();
  override async put(store: StoreName, value: unknown, key?: string): Promise<void> {
    if (this.full.has(store)) throw new DOMException(FULL, 'QuotaExceededError');
    return super.put(store, value, key);
  }
}
const persistence = { regionId: 'hosts', tileKey: '0', regionName: 'Region' };
const hosts: SimHost[] = [];
beforeAll(async () => { await buildWorkerTest(); }, 60000);
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.dispose();
  clearRecoveryBase(); setKV(new PersistentMemoryKV());
  vi.unstubAllGlobals();
});

function city() { const st = newState(32); place(st, 't_r1', 4, 4); return st; }
/** the App's save (doSaveCity): the rejection it hands to showStorageError */
async function failedSave(host: SimHost): Promise<unknown> {
  const failed = withRegionSaveAccess(persistence.regionId, () => host.save('manual'))
    .then(() => { throw new Error('the save went through'); }, (e: unknown) => e);
  // the loopback's reply needs its queue drained, once the wrapper's storage estimate has let the save through
  if (host instanceof LoopbackSimHost) { await new Promise((resolve) => setTimeout(resolve, 0)); await host.drain(); }
  return within(failed);
}
/** the dialog showStorageError opens for `error`, read from the real DOM it builds; then its Retry, which closes it */
async function dialogFor(error: unknown) {
  const root = new FEl('main');
  page.root = root as unknown as HTMLElement;
  vi.stubGlobal('document', { createElement: (tag: string) => new FEl(tag), createTextNode: (s: string) => textNode(s), activeElement: null });
  vi.stubGlobal('window', new EventTarget());
  const retry = vi.fn(async () => {});
  await showStorageError(error, { retry });
  const dialog = root.querySelector('.storage-dialog')!;
  const buttons = dialog.querySelectorAll('button');
  const shown = { open: storageDialogOpen(), title: textOf(dialog.querySelector('h2')!), message: textOf(dialog.querySelector('p')!),
    buttons: buttons.map(textOf), details: dialog.querySelector('.storage-details') !== null };
  buttons.find((b) => textOf(b) === 'Retry')!.click();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(retry, 'Retry runs the save again').toHaveBeenCalledOnce();
  expect(storageDialogOpen(), 'and closes the dialog').toBe(false);
  vi.unstubAllGlobals();
  return shown;
}
const GUIDED = { open: true, title: 'Storage full', message: STORAGE_FULL_MESSAGE, buttons: ['Export', 'Manage storage', 'Retry', 'Close'], details: false };

describe('T083 (c): a full store opens the guided quota dialog on every host (B9)', () => {
  it('the local host, the loopback and the worker host in both persistences all get Export, Manage storage and Retry', { timeout: 30000 }, async () => {
    const kv = new FullKV(); setKV(kv);
    const serialized = serializeCity(city(), { copy: true }); serialized.savedAt = 1;
    await kv.put('cities', { key: 'hosts:0', ...persistence, savedAt: serialized.savedAt, city: serialized } satisfies CityRecord, 'hosts:0');
    const local = new LocalSimHost(city(), { initialSpeed: 0, persistence }); hosts.push(local); await local.start();
    const loopback = new LoopbackSimHost(city(), { initialSpeed: 0, persistence, journal: false }); hosts.push(loopback); await loopback.start();
    const main = await bootNode(serialized, { kv, initialSpeed: 0 }); hosts.push(main);
    const idb = await bootIdb('hosts', '0', { kv, initialSpeed: 0, journal: false }); hosts.push(idb);
    expect([main.persistence, idb.persistence]).toEqual(['main', 'worker-idb']);
    kv.full.add('cities');
    const errors = { local: await failedSave(local), loopback: await failedSave(loopback), 'worker (main)': await failedSave(main), 'worker (worker-idb)': await failedSave(idb) };
    for (const [kind, error] of Object.entries(errors)) {
      expect(error, kind).toBeInstanceOf(Error);
      expect((error as Error).message, kind).toBe(FULL);
      expect(await dialogFor(error), `${kind}: the guided dialog`).toEqual(GUIDED);
    }
  });

  it('it is the error\'s name that picks it: a nameless failure gets the plain dialog with Details', async () => {
    expect(await dialogFor(new Error(FULL))).toEqual({ open: true, title: 'City could not be saved',
      message: 'Your city could not be saved. Try again, or open Details for more information.', buttons: ['Retry', 'Close'], details: true });
    expect(await dialogFor(new DOMException(FULL, 'QuotaExceededError'))).toEqual(GUIDED);
  });
});
