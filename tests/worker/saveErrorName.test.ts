/**
 * T061 item 7 (T036 step 4's B9, NOTE-058): a save that fails in the authority's store reaches the page with its error's
 * name and message. The worker protocol's save and snapshot replies carried the message only (protocolInbox's `failed`),
 * and PacketSimHost rebuilt a plain Error from it, so a QuotaExceededError arrived nameless on the packet hosts and the
 * guided quota dialog (T036 step 4's StorageDialog: `isQuotaError` reads `error.name`) showed the generic one on the
 * loopback. The dialog itself is T036 step 4's (not in dev yet): the name it reads stands in for it here, and the Desktop
 * QA opens it on both hosts.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearRecoveryBase } from '../../src/save/cities';
import { setKV, type StoreName } from '../../src/save/db';
import { serializeCity } from '../../src/save/serialize';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { LocalSimHost, type SimHost } from '../../src/worker/SimHost';
import { errorName, replyError } from '../../src/worker/protocol';
import { buildWorkerTest } from '../../tools/bench/worker/buildTests.mjs';
import { PersistentMemoryKV } from '../save/fixtures';
import { newState, place } from '../infra/cityGen';
import { bootNode, within } from './workerHarness';

/** T036 step 4's predicate (src/ui/StorageDialog.ts there): the guided quota dialog opens for this error */
const isQuotaError = (error: unknown) => !!error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError';
const FULL = 'Browser storage is full';
/** the browser's store, full for the stores in `full` */
class FullKV extends PersistentMemoryKV {
  full = new Set<StoreName>();
  override async put(store: StoreName, value: unknown, key?: string): Promise<void> {
    if (this.full.has(store)) throw new DOMException(FULL, 'QuotaExceededError');
    return super.put(store, value, key);
  }
}
const persistence = { regionId: 'quota', tileKey: '0', regionName: 'Region' };
const hosts: SimHost[] = [];
beforeAll(async () => { await buildWorkerTest(); }, 60000);
afterEach(async () => { for (const h of hosts.splice(0)) await h.dispose(); clearRecoveryBase(); setKV(new PersistentMemoryKV()); });

function city() { const st = newState(32); place(st, 't_r1', 4, 4); return st; }
async function failedSave(host: SimHost): Promise<unknown> {
  const saving = host.save('manual');
  if (host instanceof LoopbackSimHost) await host.drain();
  return within(saving).then(() => { throw new Error('the save went through'); }, (e: unknown) => e);
}

describe('a quota failure keeps its name on every host (T061 item 7)', () => {
  it('the local, loopback and worker hosts reject a full store\'s save with the same QuotaExceededError', { timeout: 30000 }, async () => {
    const kv = new FullKV(); setKV(kv);
    const local = new LocalSimHost(city(), { initialSpeed: 0, persistence }); hosts.push(local); await local.start();
    const loopback = new LoopbackSimHost(city(), { initialSpeed: 0, persistence, journal: false }); hosts.push(loopback); await loopback.start();
    const serialized = serializeCity(city(), { copy: true }); serialized.savedAt = 1;
    const worker = await bootNode(serialized, { kv, initialSpeed: 0 }); hosts.push(worker);
    kv.full.add('cities');
    const errors = { local: await failedSave(local), loopback: await failedSave(loopback), worker: await failedSave(worker) };
    for (const [kind, e] of Object.entries(errors)) {
      expect(isQuotaError(e), `${kind}: the guided quota dialog's error`).toBe(true);
      expect(e, kind).toBeInstanceOf(Error);
      expect((e as Error).message, kind).toBe(FULL);
    }
  });

  it('a failed snapshot on the loopback keeps its name too', async () => {
    const kv = new FullKV(); setKV(kv);
    const host = new LoopbackSimHost(city(), { initialSpeed: 0, persistence, journal: false }); hosts.push(host); await host.start();
    kv.full.add('recovery');
    const snapping = host.snapshot('periodic'); await host.drain();
    const e = await snapping.then(() => null, (x: unknown) => x);
    expect(e).toMatchObject({ name: 'QuotaExceededError', message: FULL });
  });

  it('carries a name only where there is one', () => {
    expect(errorName(new DOMException('x', 'QuotaExceededError'))).toBe('QuotaExceededError');
    expect(errorName(new TypeError('x'))).toBe('TypeError');
    expect(errorName(new Error('x'))).toBeUndefined();
    expect(errorName('a string')).toBeUndefined();
    expect(replyError('lost')).toMatchObject({ name: 'Error', message: 'lost' });
    expect(replyError(FULL, 'QuotaExceededError')).toMatchObject({ name: 'QuotaExceededError', message: FULL });
  });
});
