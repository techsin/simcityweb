/** parentPort is the only substitution: all scheduling, recorder, commands and persistence run in simWorker. W1.3: with
 *  `workerData.kv`, the worker's own IndexedDB is the test's KV on the main thread, reached through a request / reply
 *  bridge over parentPort (node has no IndexedDB; without it openKV() falls back to memory, as a browser's may).
 *  T083: that connection checks this realm's region write guard at each write, as the browser's IdbKV does, and a
 *  failure keeps its name across the bridge (a QuotaExceededError); with `workerData.locks`, this thread's
 *  navigator.locks is the main thread's lock manager (node has none). */
import { parentPort, workerData } from 'node:worker_threads';
import { installSimWorker } from '../../../src/worker/simWorker';
import { requireRegionSaveAccess, setKV, type KV, type StoreName } from '../../../src/save/db';
import { registerTestDefs } from '../../../tests/infra/cityGen';

interface KvReply { t: 'kvres'; id: number; ok: boolean; value?: unknown; error?: string; name?: string }
class BridgeKV implements KV {
  readonly persistent = true;
  private id = 0;
  private waits = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>();
  constructor(private post: (message: unknown) => void) {}
  private call<T>(op: string, args: unknown[]): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((resolve, reject) => {
      this.waits.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.post({ t: 'kv', id, op, args });
    });
  }
  /** T083: db.ts's requireStoreSaveAccess, which IdbKV and MemoryKV run at the start of every put and delete */
  private async write(op: 'put' | 'delete', store: StoreName, value: unknown, key?: string): Promise<void> {
    const record = value as { id?: string; regionId?: string; marker?: { regionId?: string } } | undefined;
    requireRegionSaveAccess(store === 'regions' ? key ?? record?.id : key?.split(':')[0] ?? record?.regionId ?? record?.marker?.regionId);
    return this.call<void>(op, op === 'put' ? [store, value, key] : [store, key]);
  }
  settle(m: KvReply): void {
    const wait = this.waits.get(m.id);
    this.waits.delete(m.id);
    if (m.ok) wait?.resolve(m.value); else wait?.reject(Object.assign(new Error(m.error), m.name ? { name: m.name } : {}));
  }
  get<T>(store: StoreName, key: string) { return this.call<T | undefined>('get', [store, key]); }
  put(store: StoreName, value: unknown, key?: string) { return this.write('put', store, value, key); }
  delete(store: StoreName, key: string) { return this.write('delete', store, undefined, key); }
  getAll<T>(store: StoreName) { return this.call<T[]>('getAll', [store]); }
  keys(store: StoreName, lower?: string, upper?: string) { return this.call<string[]>('keys', [store, lower, upper]); }
}

interface LockReply { t: 'lockres'; id: number; state: 'granted' | 'unavailable' | 'released' | 'refused'; error?: string; name?: string }
/** T083: navigator.locks.request over parentPort: the grant, the hold while the callback's promise is pending, and the
 *  request's own settlement (a steal rejects it with AbortError, as Web Locks does) */
class BridgeLocks {
  private id = 0;
  private requests = new Map<number, { name: string; callback(lock: unknown): unknown; resolve(): void; reject(error: unknown): void }>();
  constructor(private post: (message: unknown) => void) {}
  request(name: string, options: unknown, callback: (lock: unknown) => unknown): Promise<void> {
    const id = ++this.id;
    return new Promise<void>((resolve, reject) => {
      this.requests.set(id, { name, callback, resolve, reject });
      this.post({ t: 'lock', id, name, options });
    });
  }
  settle(m: LockReply): void {
    const r = this.requests.get(m.id);
    if (!r) return;
    if (m.state === 'granted' || m.state === 'unavailable') {
      const unlock = () => this.post({ t: 'unlock', id: m.id });
      void Promise.resolve().then(() => r.callback(m.state === 'granted' ? { name: r.name, mode: 'exclusive' } : null)).then(unlock, unlock);
      return;
    }
    this.requests.delete(m.id);
    if (m.state === 'released') r.resolve(); else r.reject(new DOMException(m.error ?? 'The lock was stolen', m.name ?? 'AbortError'));
  }
}

const port = parentPort!;
registerTestDefs();
const data = workerData as { kv?: boolean; locks?: boolean } | undefined;
const bridge = data?.kv ? new BridgeKV((m) => port.postMessage(m)) : null;
if (bridge) setKV(bridge);
const locks = data?.locks ? new BridgeLocks((m) => port.postMessage(m)) : null;
if (locks) Object.defineProperty(globalThis.navigator, 'locks', { value: locks, configurable: true });
installSimWorker({
  postMessage: (message) => port.postMessage(message),
  listen(receive, fail, signal) {
    const message = (m: unknown) => {
      if ((m as KvReply | null)?.t === 'kvres') bridge?.settle(m as KvReply);
      else if ((m as LockReply | null)?.t === 'lockres') locks?.settle(m as LockReply);
      else receive(m as Parameters<typeof receive>[0]);
    };
    port.on('message', message); port.on('messageerror', fail);
    process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
    signal.addEventListener('abort', () => {
      port.off('message', message); port.off('messageerror', fail);
      process.off('uncaughtException', fail); process.off('unhandledRejection', fail); port.close();
    }, { once: true });
  },
});
