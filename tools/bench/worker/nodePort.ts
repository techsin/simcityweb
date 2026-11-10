import { Worker } from 'node:worker_threads';
import type { KV } from '../../../src/save/db';
import type { WorkerPort } from '../../../src/worker/workerProtocol';

/** `kv` (W1.3): the worker's IndexedDB, answered here (nodeWorker.ts's bridge). Without it the worker's openKV() falls
 *  back to memory, as a browser's can (§4.1 step 3). `locks` (T083): the worker's navigator.locks is this thread's (a
 *  test's stand-in for Web Locks, which every tab and worker of an origin share). */
export function nodeWorkerPort(url: URL, opts: { kv?: KV; locks?: boolean } = {}): WorkerPort {
  const kv = opts.kv;
  const worker = new Worker(url, kv || opts.locks ? { workerData: { kv: !!kv, locks: !!opts.locks } } : undefined);
  type Request = { t: 'kv'; id: number; op: 'get' | 'put' | 'delete' | 'getAll' | 'keys'; args: unknown[] };
  type LockRequest = { t: 'lock'; id: number; name: string; options: LockOptions } | { t: 'unlock'; id: number };
  const isKv = (m: unknown): m is Request => (m as Request | null)?.t === 'kv';
  const isLock = (m: unknown): m is LockRequest => ['lock', 'unlock'].includes((m as LockRequest | null)?.t as string);
  if (kv) {
    worker.on('message', (m: unknown) => {
      if (!isKv(m)) return;
      const run = (kv[m.op] as (...args: unknown[]) => Promise<unknown>).apply(kv, m.args);
      run.then((value) => worker.postMessage({ t: 'kvres', id: m.id, ok: true, value }),
        // T083: with its name, as the worker's own IndexedDB would reject (a QuotaExceededError)
        (e: unknown) => worker.postMessage({ t: 'kvres', id: m.id, ok: false, error: String((e as Error)?.message ?? e), name: (e as Error | null)?.name }))
        .catch(() => { /* the worker is gone */ });
    });
  }
  /** T083: the locks the worker holds, released when it lets go or is terminated (as a browser frees a dead worker's) */
  const held = new Map<number, () => void>();
  const free = () => { for (const release of held.values()) release(); held.clear(); };
  if (opts.locks) {
    worker.on('message', (m: unknown) => {
      if (!isLock(m)) return;
      if (m.t === 'unlock') { held.get(m.id)?.(); held.delete(m.id); return; }
      const reply = (state: string, e?: unknown) => {
        try { worker.postMessage({ t: 'lockres', id: m.id, state, error: (e as Error | undefined)?.message, name: (e as Error | undefined)?.name }); }
        catch { /* the worker is gone */ }
      };
      const manager = (globalThis as { navigator?: Partial<Navigator> }).navigator?.locks;
      if (!manager) { reply('refused', new DOMException('No lock manager', 'NotSupportedError')); return; }
      manager.request(m.name, m.options, (lock) => {
        reply(lock ? 'granted' : 'unavailable');
        return new Promise<void>((release) => { held.set(m.id, release); });
      }).then(() => reply('released'), (e: unknown) => { held.delete(m.id); reply('refused', e); });
    });
    worker.on('exit', free);
  }
  return {
    postMessage: (message) => worker.postMessage(message),
    listen(receive, fail, signal) {
      const message = (m: unknown) => { if (!isKv(m) && !isLock(m)) receive(m as Parameters<typeof receive>[0]); };
      const exit = (code: number) => fail(new Error(`Simulation worker exited (${code})`));
      worker.on('message', message); worker.on('error', fail); worker.on('messageerror', fail); worker.on('exit', exit);
      signal.addEventListener('abort', () => {
        worker.off('message', message); worker.off('error', fail); worker.off('messageerror', fail); worker.off('exit', exit);
        // terminate() can race an already emitted error during teardown.
        worker.on('error', () => {});
      }, { once: true });
    },
    terminate: () => { free(); return worker.terminate(); },
  };
}
