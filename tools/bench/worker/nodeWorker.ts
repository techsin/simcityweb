/** parentPort is the only substitution: all scheduling, recorder, commands and persistence run in simWorker. W1.3: with
 *  `workerData.kv`, the worker's own IndexedDB is the test's KV on the main thread, reached through a request / reply
 *  bridge over parentPort (node has no IndexedDB; without it openKV() falls back to memory, as a browser's may). */
import { parentPort, workerData } from 'node:worker_threads';
import { installSimWorker } from '../../../src/worker/simWorker';
import { setKV, type KV, type StoreName } from '../../../src/save/db';
import { registerTestDefs } from '../../../tests/infra/cityGen';

interface KvReply { t: 'kvres'; id: number; ok: boolean; value?: unknown; error?: string }
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
  settle(m: KvReply): void {
    const wait = this.waits.get(m.id);
    this.waits.delete(m.id);
    if (m.ok) wait?.resolve(m.value); else wait?.reject(new Error(m.error));
  }
  get<T>(store: StoreName, key: string) { return this.call<T | undefined>('get', [store, key]); }
  put(store: StoreName, value: unknown, key?: string) { return this.call<void>('put', [store, value, key]); }
  delete(store: StoreName, key: string) { return this.call<void>('delete', [store, key]); }
  getAll<T>(store: StoreName) { return this.call<T[]>('getAll', [store]); }
  keys(store: StoreName, lower?: string, upper?: string) { return this.call<string[]>('keys', [store, lower, upper]); }
}

const port = parentPort!;
registerTestDefs();
const bridge = (workerData as { kv?: boolean } | undefined)?.kv ? new BridgeKV((m) => port.postMessage(m)) : null;
if (bridge) setKV(bridge);
installSimWorker({
  postMessage: (message) => port.postMessage(message),
  listen(receive, fail, signal) {
    const message = (m: unknown) => {
      if ((m as KvReply | null)?.t === 'kvres') bridge?.settle(m as KvReply);
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
