/** second kernel instances (other binaries: scalar / imported math) usable as a wasm core's `instance` */
import { readFileSync } from 'node:fs';
import { WasmHeap } from '../../../src/wasm/heap';
import type { SimWasmInstance } from '../../../src/wasm/simWasm';

export function instanceFromFile(file: string, label: string): SimWasmInstance {
  const bytes = readFileSync(file);
  const t0 = performance.now();
  const mod = new WebAssembly.Module(bytes as Uint8Array<ArrayBuffer>);
  const needsEnv = WebAssembly.Module.imports(mod).some((i) => i.module === 'env');
  const inst = new WebAssembly.Instance(mod, needsEnv ? { env: { js_exp: Math.exp, js_log: Math.log } } : {});
  const ex = inst.exports as unknown as SimWasmInstance['exports'];
  const heap = new WasmHeap(ex.memory, Number(ex.__heap_base.value));
  heap.reserve(4 << 20);
  const f = ex.sk_features();
  return {
    exports: ex, memory: ex.memory, heap, source: label, bytes: bytes.length, initMs: performance.now() - t0,
    features: { simd128: (f & 1) !== 0, std: (f & 2) !== 0, bulkMemory: (f & 4) !== 0, nontrappingFptoint: (f & 8) !== 0, signExt: (f & 16) !== 0, atomics: (f & 32) !== 0 },
  };
}
