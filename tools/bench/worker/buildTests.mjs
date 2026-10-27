/** The node adapter bundles the production worker loop, using the bench's kernel plugin. */
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { rolldown } from 'rolldown';
import simPlugins from '../sim.plugins.mjs';

const directory = new URL('./.tmp/', import.meta.url);
export const hostPlugins = [...simPlugins, {
  name: 'host-explicit-test-modules',
  resolveId(source) { if (source.endsWith('.wasm?url')) return '\0node-wasm-url'; },
  load(id) { if (id === '\0node-wasm-url') return 'export default "unused-in-node.wasm";'; },
  transform(code, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/worker/SimHost.ts')) return null;
    // Tests pass start({ createSystems, CityActions }); only Vite supplies import.meta.glob.
    return code.replace("import.meta.glob(['../sim/systems/index.ts', '../sim/actions.ts'])", '({})');
  },
}];
export async function buildWorkerTest() {
  await mkdir(directory, { recursive: true });
  const output = new URL(`simWorker-${randomUUID()}.mjs`, directory);
  const bundle = await rolldown({ input: fileURLToPath(new URL('./nodeWorker.ts', import.meta.url)), platform: 'node', plugins: simPlugins });
  try { await bundle.write({ file: fileURLToPath(output), format: 'esm', codeSplitting: false }); }
  finally { await bundle.close(); }
  return output;
}

if (process.argv.includes('--protector')) {
  await mkdir(directory, { recursive: true });
  const bundle = await rolldown({ input: fileURLToPath(new URL('../../../tests/perf/protectorChild.ts', import.meta.url)), platform: 'node' });
  try { await bundle.write({ file: fileURLToPath(new URL('protectorChild.mjs', directory)), format: 'esm', codeSplitting: false }); }
  finally { await bundle.close(); }
}
