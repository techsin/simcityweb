import { Worker } from 'node:worker_threads';
import type { WorkerPort } from '../../../src/worker/workerProtocol';

export function nodeWorkerPort(url: URL): WorkerPort {
  const worker = new Worker(url);
  return {
    postMessage: (message) => worker.postMessage(message),
    listen(receive, fail, signal) {
      const exit = (code: number) => fail(new Error(`Simulation worker exited (${code})`));
      worker.on('message', receive); worker.on('error', fail); worker.on('messageerror', fail); worker.on('exit', exit);
      signal.addEventListener('abort', () => {
        worker.off('message', receive); worker.off('error', fail); worker.off('messageerror', fail); worker.off('exit', exit);
        // terminate() can race an already emitted error during teardown.
        worker.on('error', () => {});
      }, { once: true });
    },
    terminate: () => worker.terminate(),
  };
}
