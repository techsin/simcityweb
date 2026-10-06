/** a second kernel instance (another binary, e.g. the scalar build) usable through makeSearchKernels({ instance }) */
import { WasmHeap } from '../../../src/wasm/heap';
import { simWasmImports, type SimWasmInstance } from '../../../src/wasm/simWasm';

export function instanceFrom(bytes: Uint8Array, label: string): SimWasmInstance {
  const t0 = performance.now();
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes as Uint8Array<ArrayBuffer>), simWasmImports());
  const ex = inst.exports as unknown as SimWasmInstance['exports'];
  const heap = new WasmHeap(ex.memory, Number(ex.__heap_base.value));
  heap.reserve(4 << 20);
  const f = ex.sk_features();
  return {
    exports: ex, memory: ex.memory, heap, source: label, bytes: bytes.length, initMs: performance.now() - t0,
    features: { simd128: (f & 1) !== 0, std: (f & 2) !== 0, bulkMemory: (f & 4) !== 0, nontrappingFptoint: (f & 8) !== 0, signExt: (f & 16) !== 0, atomics: (f & 32) !== 0 },
  };
}
