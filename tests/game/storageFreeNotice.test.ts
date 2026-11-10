/**
 * T086 B5: a read-only tab is told when its region has become free, and is offered it without a takeover. The real
 * region lock over a fake navigator.locks shared with "the other tab"; the notice is the session's real DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { RegionData } from '../../src/region/types';
import { RegionSaveLock } from '../../src/save/db';
import { regionTakenOver, RegionStorageSession } from '../../src/ui/StorageDialog';
import { FEl, FNode, installFakeDom, textOf } from './fakeDom';
import { FakeLocks, regionLockName } from '../save/fakeLocks';

const page = vi.hoisted(() => ({ root: null as unknown as HTMLElement }));
vi.mock('../../src/region/ui/modal', () => ({ uiRoot: () => page.root, toast: vi.fn() }));

class NoticeEl extends FEl {
  hidden = false;
  replaceChildren(...children: FNode[]): void { this.textContent = ''; this.append(...children); }
}

installFakeDom();
const POLL_MS = 2000;
const region = { id: 'region-one', name: 'Harbour' } as RegionData;
let root: NoticeEl;
let locks: FakeLocks;
let open: { dispose(): void }[];
let reload: Mock<() => Promise<void>>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
  root = new NoticeEl('main');
  page.root = root as unknown as HTMLElement;
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => new NoticeEl(tag)) as typeof document.createElement);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  locks = new FakeLocks();
  vi.stubGlobal('navigator', { locks });
  open = [];
  reload = vi.fn(async () => {});
});
afterEach(() => {
  for (const item of open.reverse()) item.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** another tab's hold on the region */
async function otherTab(steal = false): Promise<RegionSaveLock> {
  const lock = new RegionSaveLock(region.id, false);
  open.push(lock);
  expect(await lock.acquire(steal)).toBe(true);
  return lock;
}
function session(): RegionStorageSession {
  const s = new RegionStorageSession(region, root as unknown as HTMLElement, reload);
  open.push(s);
  return s;
}
const notice = () => root.querySelector('.storage-lock-notice') as NoticeEl;
const shown = () => (notice().hidden ? null : [textOf(notice().querySelector('span')!), textOf(notice().querySelector('button')!)]);
const click = async () => { notice().querySelector('button')!.click(); await vi.advanceTimersByTimeAsync(0); };
const poll = () => vi.advanceTimersByTimeAsync(POLL_MS);
const TAKEOVER = ['This region is open in another tab', 'Use it here instead'], FREE = ['This region is free now', 'Use it here'];

describe('a read-only tab and a region that became free', () => {
  it('says so within one poll of the holder leaving, and takes the region without stealing it', async () => {
    const holder = await otherTab();
    const s = session();
    expect(await s.acquire()).toBe(false);
    expect(shown()).toEqual(TAKEOVER);
    await poll();
    expect(locks.queries).toBe(1);
    expect(shown()).toEqual(TAKEOVER);
    holder.dispose(); // the other tab closed, or left the region
    await poll();
    expect(shown()).toEqual(FREE);
    await click();
    expect(locks.requests.at(-1)).toEqual({ name: regionLockName(region.id), options: { ifAvailable: true } });
    expect(reload).toHaveBeenCalledOnce();
    expect(s.lock.writable).toBe(true);
    expect(shown()).toBeNull();
    // the reload ran as a takeover's does: the next Play explains an older snapshot as another tab's progress
    expect(regionTakenOver(region.id, Date.now())).toBe(true);
    // a writer asks no more: its poll has ended
    expect(vi.getTimerCount()).toBe(0);
    const queries = locks.queries;
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(locks.queries).toBe(queries);
  });

  it('does not take a region another tab opened since the last poll: the takeover notice comes back', async () => {
    const holder = await otherTab();
    const s = session();
    await s.acquire();
    holder.dispose();
    await poll();
    expect(shown()).toEqual(FREE);
    const third = await otherTab();
    await click();
    expect(third.writable).toBe(true);
    expect(s.lock.writable).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(locks.requests.some(({ options }) => options.steal)).toBe(false);
    expect(shown()).toEqual(TAKEOVER);
    // that button is the takeover, as before
    await click();
    expect(third.writable).toBe(false);
    expect(s.lock.writable).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('goes back to "open in another tab" by itself when a tab takes the free region', async () => {
    const holder = await otherTab();
    const s = session();
    await s.acquire();
    holder.dispose();
    await poll();
    expect(shown()).toEqual(FREE);
    await otherTab();
    await poll();
    expect(shown()).toEqual(TAKEOVER);
  });

  it('offers the region back to the tab it was taken from, once the tab that took it has gone', async () => {
    const s = session();
    expect(await s.acquire()).toBe(true);
    expect(shown()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(locks.queries).toBe(0);
    const taker = await otherTab(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(shown()).toEqual(['This region is now open in another tab', 'Use it here instead']);
    taker.dispose();
    await poll();
    expect(shown()).toEqual(FREE);
  });

  it('keeps its notice while its own takeover waits, and stops asking when the session ends', async () => {
    await otherTab();
    const s = session();
    await s.acquire();
    let finish!: () => void;
    reload.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await click();
    // this tab has the lock now (saves still off): its own hold is not "another tab", and not "free" either
    await vi.advanceTimersByTimeAsync(3 * POLL_MS);
    expect(locks.queries).toBe(0);
    expect(shown()).toEqual(TAKEOVER);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(shown()).toBeNull();
    // taken back by the other tab: this tab asks again, until its session ends
    await otherTab(true);
    await poll();
    expect(locks.queries).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    s.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(locks.queries).toBe(1);
  });
});
