/** second kernel instances (other binaries: scalar / inline fdlibm) usable as a wasm core's `instance` */
import { readFileSync } from 'node:fs';
import { WasmHeap } from '../../../src/wasm/heap';
import { simWasmImports, SIM_WASM_INITIAL_RESERVE, type SimWasmInstance } from '../../../src/wasm/simWasm';

/** an instance of the binary `bytes` with its own (pre-sized) memory and the loader's imports and start-up reserve */
export function instanceFromBytes(bytes: Uint8Array, label: string): SimWasmInstance {
  const t0 = performance.now();
  const mod = new WebAssembly.Module(bytes as Uint8Array<ArrayBuffer>);
  const inst = new WebAssembly.Instance(mod, simWasmImports());
  const ex = inst.exports as unknown as SimWasmInstance['exports'];
  const heap = new WasmHeap(ex.memory, Number(ex.__heap_base.value));
  heap.reserve(SIM_WASM_INITIAL_RESERVE);
  const f = ex.sk_features();
  return {
    exports: ex, memory: ex.memory, heap, source: label, bytes: bytes.length, initMs: performance.now() - t0,
    features: { simd128: (f & 1) !== 0, std: (f & 2) !== 0, bulkMemory: (f & 4) !== 0, nontrappingFptoint: (f & 8) !== 0, signExt: (f & 16) !== 0, atomics: (f & 32) !== 0 },
  };
}

export function instanceFromFile(file: string, label: string): SimWasmInstance {
  return instanceFromBytes(new Uint8Array(readFileSync(file)), label);
}
