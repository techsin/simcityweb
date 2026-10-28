/** The worker test bundle: the production worker loop behind a parentPort adapter (nodeWorker.ts), bundled in memory as
 *  protector.test.ts bundles its child, and loaded as a data: URL, so no build file lands in the tree. */
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

let built;
export function buildWorkerTest() {
  return built ??= (async () => {
    const bundle = await rolldown({ input: fileURLToPath(new URL('./nodeWorker.ts', import.meta.url)), platform: 'node' });
    try {
      const { output } = await bundle.generate({ format: 'esm', codeSplitting: false });
      if (output.length !== 1 || output[0].type !== 'chunk') throw new Error('expected one self-contained worker bundle');
      return new URL(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
    } finally { await bundle.close(); }
  })();
}
