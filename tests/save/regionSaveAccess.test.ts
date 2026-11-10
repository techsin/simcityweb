/** NEW-04: asynchronous save work must retain region ownership before it can be acknowledged. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restrictRegionSaveAccess, withRegionSaveAccess } from '../../src/save/db';

let release: (() => void) | null = null;
let writable: boolean;
let estimate: ReturnType<typeof vi.fn<() => Promise<StorageEstimate>>>;

beforeEach(() => {
  writable = true;
  release = restrictRegionSaveAccess((regionId) => regionId === 'region' && writable);
  estimate = vi.fn<() => Promise<StorageEstimate>>().mockResolvedValue({ quota: 1000, usage: 100 });
  vi.stubGlobal('navigator', { storage: { estimate } });
});
afterEach(() => {
  release?.();
  release = null;
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('region save access across asynchronous work', () => {
  it('does not start a write when the storage estimate reaches the quota margin', async () => {
    estimate.mockResolvedValue({ quota: 1000, usage: 950 });
    const write = vi.fn().mockResolvedValue({ savedAt: 123 });
    await expect(withRegionSaveAccess('region', write)).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(write).not.toHaveBeenCalled();
  });

  it('does not start a write when ownership is revoked while the estimate awaits', async () => {
    const pending = deferred<StorageEstimate>();
    estimate.mockReturnValue(pending.promise);
    const write = vi.fn().mockResolvedValue({ savedAt: 123 });
    const save = withRegionSaveAccess('region', write);
    expect(estimate).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
    writable = false;
    const rejected = expect(save).rejects.toMatchObject({ name: 'NotAllowedError' });
    pending.resolve({ quota: 1000, usage: 100 });
    await rejected;
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects an acknowledgement when ownership is revoked while the write awaits', async () => {
    const started = deferred<void>(), pending = deferred<{ savedAt: number }>();
    const write = vi.fn(() => {
      started.resolve();
      return pending.promise;
    });
    const save = withRegionSaveAccess('region', write);
    await started.promise;
    writable = false;
    const rejected = expect(save).rejects.toMatchObject({ name: 'NotAllowedError' });
    pending.resolve({ savedAt: 123 });
    await rejected;
    expect(write).toHaveBeenCalledOnce();
  });

  it('returns the write acknowledgement when storage and ownership permit saving', async () => {
    const acknowledgement = { savedAt: 123 };
    const write = vi.fn().mockResolvedValue(acknowledgement);
    await expect(withRegionSaveAccess('region', write)).resolves.toBe(acknowledgement);
    expect(estimate).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
  });
});
