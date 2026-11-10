/**
 * T036 step 4 (NEW-04) on W1.2's real worker host (?simworker=1). WorkerSimHost stores the worker's saves and snapshots
 * on the page, through the page's KV (R14), so:
 * - the region lock fences them as it fences the local host's: a tab that lost the lock stores nothing;
 * - a full store's QuotaExceededError reaches host.save with its name, so the guided dialog opens (B9, the name lost in a
 *   Worker-protocol reply, is the loopback's; T061 item 7);
 * - Export from the guided dialog writes the running city, rebuilt from the worker's snapshot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deserializeCity, saveRegion } from '../../src/save';
import { clearRecoveryBase, getCityRecord } from '../../src/save/cities';
import { MemoryKV, RegionSaveLock, regionSaveAccess, setKV, type StoreName } from '../../src/save/db';
import { isQuotaError, snapshotRegionFile } from '../../src/ui/StorageDialog';
import { regionData } from '../save/fixtures';
import { bootNode, initialCity, send } from './workerHarness';

/** Web Locks' two promises, with a stolen lock's request rejecting with AbortError (as tests/storageDb.test.ts) */
class FakeLocks {
  private held = new Map<string, { reject: (error: unknown) => void }>();
  request(name: string, options: LockOptions, callback: LockGrantedCallback<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const previous = this.held.get(name);
      if (previous && options.steal) {
        this.held.delete(name);
        previous.reject(new DOMException('Stolen', 'AbortError'));
      } else if (previous) {
        Promise.resolve(callback(null)).then(resolve, reject);
        return;
      }
      const entry = { reject };
      this.held.set(name, entry);
      Promise.resolve(callback({ name, mode: 'exclusive' } as Lock)).then(() => {
        if (this.held.get(name) === entry) this.held.delete(name);
        resolve(undefined);
      }, reject);
    });
  }
}

const locks: RegionSaveLock[] = [];
beforeEach(() => { vi.stubGlobal('navigator', { locks: new FakeLocks() }); });
afterEach(() => {
  for (const lock of locks.splice(0)) lock.dispose();
  clearRecoveryBase();
  setKV(new MemoryKV());
  vi.unstubAllGlobals();
});
/** `active`: this page's lock (regionSaveAccess reads it); otherwise another tab's */
function lock(active: boolean): RegionSaveLock {
  const l = new RegionSaveLock('hosts', active);
  locks.push(l);
  return l;
}

describe('NEW-04 on the worker host', () => {
  it('a tab that lost its region lock stores none of the worker\'s saves or snapshots', { timeout: 30000 }, async () => {
    const kv = new MemoryKV();
    expect(await lock(true).acquire()).toBe(true);
    const host = await bootNode(initialCity(), { kv, deterministic: true });
    try {
      const first = await host.save('manual');
      expect((await getCityRecord(kv, 'hosts', '0'))?.savedAt).toBe(first.savedAt);
      // the second tab's "Use it here instead"
      expect(await lock(false).acquire(true)).toBe(true);
      expect(regionSaveAccess('hosts')).toBe(false);
      await send(host, 'setTax', [0, 13]);
      await expect(host.save('manual')).rejects.toMatchObject({ name: 'NotAllowedError' });
      expect((await getCityRecord(kv, 'hosts', '0'))?.savedAt, 'the record is still the one this tab saved with the lock').toBe(first.savedAt);
      await expect(host.snapshot('hidden')).rejects.toMatchObject({ name: 'NotAllowedError' });
      expect(await kv.get('recovery', 'hosts:0'), 'no recovery snapshot either').toBeUndefined();
    } finally { await host.dispose(); }
  });

  it('a full store\'s QuotaExceededError reaches host.save with its name: the guided dialog\'s case', { timeout: 30000 }, async () => {
    class FullStore extends MemoryKV {
      override async put(store: StoreName, value: unknown, key?: string): Promise<void> {
        if (store === 'cities') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return super.put(store, value, key);
      }
    }
    const host = await bootNode(initialCity(), { kv: new FullStore(), deterministic: true });
    try {
      const error = await host.save('manual').then(() => null, (e: unknown) => e);
      expect(isQuotaError(error)).toBe(true);
    } finally { await host.dispose(); }
  });

  it('Export writes the running city from the worker\'s snapshot, not its last save', { timeout: 30000 }, async () => {
    const kv = new MemoryKV();
    setKV(kv);
    await saveRegion(regionData('hosts'));
    const host = await bootNode(initialCity(), { kv, deterministic: true });
    try {
      await host.save('manual');
      const saved = deserializeCity((await getCityRecord(kv, 'hosts', '0'))!.city).budget.taxRates[0];
      await send(host, 'setTax', [0, saved + 4]);
      const file = await snapshotRegionFile('hosts', host);
      expect(deserializeCity(file.cities['0']).budget.taxRates[0]).toBe(saved + 4);
      expect(deserializeCity((await getCityRecord(kv, 'hosts', '0'))!.city).budget.taxRates[0], 'Export saves nothing').toBe(saved);
    } finally { await host.dispose(); }
  });
});
