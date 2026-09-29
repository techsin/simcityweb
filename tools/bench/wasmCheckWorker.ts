/// <reference lib="webworker" />
/**
 * Web Worker half of tools/bench/wasm-check.html: instantiates the kernels inside the worker (no DOM), runs the
 * equivalence check and the A/B there (a sim worker is where the kernels would run in the game).
 */
import { initSimWasmBrowser } from '../../src/wasm/browser';
import { browserAB, equivalence } from './wasmCheckCore';

self.onmessage = async (e: MessageEvent<{ flag: string | null; quick: boolean; ab: boolean }>) => {
  try {
    const status = await initSimWasmBrowser({ flag: e.data.flag });
    const eq = equivalence();
    const ab = e.data.ab ? browserAB(e.data.quick) : [];
    (self as unknown as Worker).postMessage({ status, eq, ab, crossOriginIsolated: (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.stack : String(err) });
  }
};
