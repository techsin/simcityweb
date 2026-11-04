/** parentPort is the only substitution: all scheduling, recorder, commands and persistence run in simWorker. */
import { parentPort } from 'node:worker_threads';
import { installSimWorker } from '../../../src/worker/simWorker';
import { registerTestDefs } from '../../../tests/infra/cityGen';

const port = parentPort!;
registerTestDefs();
installSimWorker({
  postMessage: (message) => port.postMessage(message),
  listen(receive, fail, signal) {
    port.on('message', receive); port.on('messageerror', fail);
    process.on('uncaughtException', fail); process.on('unhandledRejection', fail);
    signal.addEventListener('abort', () => {
      port.off('message', receive); port.off('messageerror', fail);
      process.off('uncaughtException', fail); process.off('unhandledRejection', fail); port.close();
    }, { once: true });
  },
});
