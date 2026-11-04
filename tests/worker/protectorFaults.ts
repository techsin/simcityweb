/** Deliberate S1 negative controls; hygiene.test.ts allows only the two exact operations below. */
import type { MessagePort } from 'node:worker_threads';

export function transferOnce(port: MessagePort): void {
  const buffer = new ArrayBuffer(16);
  port.postMessage({ t: 'control', buffer }, [buffer]);
  if (buffer.byteLength !== 0) throw new Error('negative control did not detach its buffer');
}

export function growOnce(memory: WebAssembly.Memory): void {
  memory.grow(1);
}
