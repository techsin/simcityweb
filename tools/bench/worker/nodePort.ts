import { Worker } from 'node:worker_threads';
import type { KV } from '../../../src/save/db';
import type { WorkerPort } from '../../../src/worker/workerProtocol';

/** `kv` (W1.3): the worker's IndexedDB, answered here (nodeWorker.ts's bridge). Without it the worker's openKV() falls
 *  back to memory, as a browser's can (§4.1 step 3). */
export function nodeWorkerPort(url: URL, opts: { kv?: KV } = {}): WorkerPort {
  const kv = opts.kv;
  const worker = new Worker(url, kv ? { workerData: { kv: true } } : undefined);
  type Request = { t: 'kv'; id: number; op: 'get' | 'put' | 'delete' | 'getAll' | 'keys'; args: unknown[] };
  const isKv = (m: unknown): m is Request => (m as Request | null)?.t === 'kv';
  if (kv) {
    worker.on('message', (m: unknown) => {
      if (!isKv(m)) return;
      const run = (kv[m.op] as (...args: unknown[]) => Promise<unknown>).apply(kv, m.args);
      run.then((value) => worker.postMessage({ t: 'kvres', id: m.id, ok: true, value }),
        (e: unknown) => worker.postMessage({ t: 'kvres', id: m.id, ok: false, error: String((e as Error)?.message ?? e) }))
        .catch(() => { /* the worker is gone */ });
    });
  }
  return {
    postMessage: (message) => worker.postMessage(message),
    listen(receive, fail, signal) {
      const message = (m: unknown) => { if (!isKv(m)) receive(m as Parameters<typeof receive>[0]); };
      const exit = (code: number) => fail(new Error(`Simulation worker exited (${code})`));
      worker.on('message', message); worker.on('error', fail); worker.on('messageerror', fail); worker.on('exit', exit);
      signal.addEventListener('abort', () => {
        worker.off('message', message); worker.off('error', fail); worker.off('messageerror', fail); worker.off('exit', exit);
        // terminate() can race an already emitted error during teardown.
        worker.on('error', () => {});
      }, { once: true });
    },
    terminate: () => worker.terminate(),
  };
}
