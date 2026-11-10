/**
 * NEW-04: a city opens only after its own recovery snapshot is decided, whatever another tab holds. Real locks (a fake
 * navigator.locks), the real recovery store and the global localStorage slot; only the toast is stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingRecovery, RecoveryCity } from '../../src/save';
import { MemoryKV, RegionSaveLock, setKV } from '../../src/save/db';
import * as idb from '../../src/save/recoveryIdb';
import { peekRecoveryMarker, storeRecoveryLs } from '../../src/save/recoveryLs';
import { RECOVERY_UNDECIDED_MESSAGE, recoveryStorageGate } from '../../src/ui/StorageDialog';
import { MemStorage, PersistentMemoryKV, recoveryFixture, regionData } from './fixtures';

const ui = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../src/region/ui/modal', () => ({ uiRoot: vi.fn(), toast: ui.toast }));

/** Web Locks across tabs: a held name answers `ifAvailable` with null; a steal rejects the holder's request. */
class FakeLocks {
  private held = new Set<string>();
  request(name: string, options: LockOptions, callback: LockGrantedCallback<unknown>): Promise<unknown> {
    if (this.held.has(name) && !options.steal) return Promise.resolve(callback(null));
    this.held.add(name);
    return Promise.resolve(callback({ name, mode: 'exclusive' } as Lock)).finally(() => this.held.delete(name));
  }
}

const city: RecoveryCity = { regionId: 'rtest', tileKey: '0_0' };
let kv: PersistentMemoryKV;
let locks: RegionSaveLock[];

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage());
  vi.stubGlobal('navigator', { locks: new FakeLocks() });
  kv = new PersistentMemoryKV();
  setKV(kv);
  locks = [];
  ui.toast.mockClear();
});
afterEach(() => {
  for (const lock of locks) lock.dispose();
  setKV(new MemoryKV());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function hold(regionId: string, active: boolean): Promise<RegionSaveLock> {
  const lock = new RegionSaveLock(regionId, active);
  locks.push(lock);
  expect(await lock.acquire()).toBe(true);
  return lock;
}

/** This tab's city `rtest:0_0` has a crash snapshot; region `other` has its own in IndexedDB, and a newer one in the
 *  global slot that only that region's owner may move into IndexedDB. */
async function storedSnapshots() {
  const f = recoveryFixture();
  await kv.put('regions', regionData());
  await kv.put('cities', f.record, f.record.key);
  await idb.storeRecoveryIdb(kv, f.marker, f.payload);
  const other = { ...f.marker, regionId: 'other', tileKey: '3_3' };
  await kv.put('regions', regionData('other', 'Other Region'));
  await kv.put('cities', { ...f.record, key: 'other:3_3', regionId: 'other', tileKey: '3_3' }, 'other:3_3');
  await idb.storeRecoveryIdb(kv, other, f.payload);
  const slot = { ...other, at: other.at + 5 };
  expect(storeRecoveryLs({ ...slot }, f.payload)).toBe(true);
  return { f, other, slot };
}

const asked = (ask: { mock: { calls: unknown[][] } }) => (ask.mock.calls[0]?.[0] as PendingRecovery | undefined)?.marker;

describe('the recovery gate is scoped to the city\'s own region', () => {
  it('asks about the city while another tab owns a region with its own snapshot and the localStorage slot', async () => {
    const { f, other, slot } = await storedSnapshots();
    await kv.put('recovery', { junk: true }, 'other:9_9'); // malformed: its cleanup belongs to that region's owner
    await hold('other', false); // the other tab
    await hold('rtest', true); // this tab's region session
    const ask = vi.fn(async () => 'later');
    expect(await recoveryStorageGate(city, ask)).toBe(false);
    expect(ask).toHaveBeenCalledOnce();
    expect(asked(ask)).toMatchObject({ regionId: 'rtest', tileKey: '0_0', at: f.marker.at });
    // the other region's records and the global slot stay exactly as its owner left them
    expect(await kv.keys('recovery')).toEqual(['other:3_3', 'other:9_9', 'rtest:0_0']);
    expect((await idb.peekRecoveryMarker(kv, other))?.at).toBe(other.at);
    expect(peekRecoveryMarker()).toMatchObject({ regionId: 'other', tileKey: '3_3', at: slot.at });
    expect(ui.toast).not.toHaveBeenCalled();
  });

  it('enters once the player decides, and still enters a city that has no snapshot', async () => {
    await storedSnapshots();
    await hold('other', false);
    await hold('rtest', true);
    expect(await recoveryStorageGate(city, async () => 'discarded')).toBe(true);
    const ask = vi.fn(async () => 'later');
    expect(await recoveryStorageGate({ regionId: 'rtest', tileKey: '1_0' }, ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('moves a free region\'s slot into IndexedDB under that region\'s lock before asking, then releases the lock', async () => {
    const { other, slot } = await storedSnapshots();
    await hold('rtest', true);
    const ask = vi.fn(async () => 'later');
    expect(await recoveryStorageGate(city, ask)).toBe(false);
    expect(asked(ask)?.regionId).toBe('rtest');
    expect((await idb.peekRecoveryMarker(kv, other))?.at).toBe(slot.at);
    expect(peekRecoveryMarker()).toBeNull();
    await hold('other', false); // released: another tab can take that region now
  });

  it('does not enter while the city\'s own snapshot cannot be decided, and keeps it', async () => {
    const f = recoveryFixture();
    await kv.put('regions', regionData());
    await kv.put('cities', f.record, f.record.key);
    expect(storeRecoveryLs({ ...f.marker }, f.payload)).toBe(true); // only the unload slot holds it
    await hold('rtest', true);
    vi.spyOn(kv, 'put').mockRejectedValue(new DOMException('Full', 'QuotaExceededError'));
    const ask = vi.fn(async () => 'discarded');
    expect(await recoveryStorageGate(city, ask)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(ui.toast).toHaveBeenCalledExactlyOnceWith(RECOVERY_UNDECIDED_MESSAGE, 'bad', 6000);
    expect(peekRecoveryMarker()).toMatchObject({ regionId: 'rtest', tileKey: '0_0', at: f.marker.at });
  });
});
