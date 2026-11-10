/** T086 B5: a read-only tab learns whether its region is still held from a lock query, which takes no lock itself. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RegionSaveLock } from '../src/save/db';
import { FakeLocks } from './save/fakeLocks';

class StorageStub {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

let db: typeof import('../src/save/db');
let locks: FakeLocks;
let holders: RegionSaveLock[];

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('localStorage', new StorageStub());
  locks = new FakeLocks();
  holders = [];
  vi.stubGlobal('navigator', { locks });
  db = await import('../src/save/db');
});
afterEach(() => {
  for (const holder of holders) holder.dispose();
  vi.unstubAllGlobals();
});

function holder(regionId = 'region', active = false): RegionSaveLock {
  const lock = new db.RegionSaveLock(regionId, active);
  holders.push(lock);
  return lock;
}
/** a released lock leaves the fake manager a few microtasks later */
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('whether another tab holds the region', () => {
  it('follows the holder: held while it has the region, free once it lets go, held again when a tab takes it', async () => {
    const first = holder(), reader = holder('region', true);
    expect(await first.acquire()).toBe(true);
    expect(await reader.acquire()).toBe(false);
    expect(await reader.heldElsewhere()).toBe(true);
    first.dispose();
    await flush();
    expect(await reader.heldElsewhere()).toBe(false);
    const next = holder();
    expect(await next.acquire()).toBe(true);
    expect(await reader.heldElsewhere()).toBe(true);
    // another region's holder says nothing about this one
    next.dispose();
    await flush();
    expect(await holder('other').acquire()).toBe(true);
    expect(await reader.heldElsewhere()).toBe(false);
  });

  it('asks without a lock request, so the holder\'s own re-acquire is never queued behind a reader', async () => {
    const first = holder(), reader = holder('region', true);
    await first.acquire();
    await reader.acquire();
    const requests = locks.requests.length;
    for (let i = 0; i < 5; i++) await reader.heldElsewhere();
    expect(locks.queries).toBe(5);
    expect(locks.requests).toHaveLength(requests);
    // the start-up scan's pattern: release, then ask again at once with ifAvailable
    first.dispose();
    await flush();
    const session = holder();
    const asked = reader.heldElsewhere();
    expect(await session.acquire()).toBe(true);
    await asked;
    expect(session.writable).toBe(true);
  });

  it('answers null while this lock holds or is taking the region: its own lock is not another tab', async () => {
    const first = holder(), reader = holder('region', true);
    await first.acquire();
    await reader.acquire();
    let ready!: () => void;
    const taking = reader.acquire(true, () => new Promise<void>((resolve) => { ready = resolve; }));
    expect(await reader.heldElsewhere()).toBeNull();
    ready();
    expect(await taking).toBe(true);
    expect(await reader.heldElsewhere()).toBeNull();
    reader.dispose();
    expect(await reader.heldElsewhere()).toBeNull();
  });

  it('answers null when a takeover begins while the query is out', async () => {
    const first = holder(), reader = holder('region', true);
    await first.acquire();
    await reader.acquire();
    let answer!: (snapshot: LockManagerSnapshot) => void;
    vi.spyOn(locks, 'query').mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const asked = reader.heldElsewhere();
    const taking = reader.acquire(true);
    answer({ held: [], pending: [] });
    expect(await asked).toBeNull();
    expect(await taking).toBe(true);
  });

  it('answers null when it cannot know: no query support, a failed query, or the BroadcastChannel fallback', async () => {
    const reader = holder('region', true);
    vi.spyOn(locks, 'query').mockRejectedValueOnce(new Error('denied'));
    expect(await reader.heldElsewhere()).toBeNull();
    vi.stubGlobal('navigator', { locks: { request: locks.request.bind(locks) } });
    expect(await reader.heldElsewhere()).toBeNull();
    vi.stubGlobal('navigator', {});
    expect(await reader.heldElsewhere()).toBeNull();
  });
});
