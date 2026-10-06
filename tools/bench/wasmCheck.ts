/**
 * Page script of tools/bench/wasm-check.html (Vite dev server or production build): loads the kernels on the main
 * thread through src/wasm/browser.ts (Vite ?url asset), checks equivalence, tries a synchronous main-thread compile,
 * then repeats everything inside a module Web Worker. Result: window.__wasmCheck (read by tools/bench/browser-check.mjs).
 * Query: ?simwasm=js|wasm|auto (A/B flag), ?ab=1 (timings), ?quick=1.
 */
import { initSimWasmBrowser, simWasmUrl } from '../../src/wasm/browser';
import { simWasmImports } from '../../src/wasm/simWasm';
import { browserAB, equivalence } from './wasmCheckCore';

interface CheckResult {
  done: boolean;
  userAgent: string;
  crossOriginIsolated: boolean;
  wasmUrl: string;
  main?: unknown;
  syncCompile?: { ok: boolean; ms?: number; bytes?: number; error?: string };
  worker?: unknown;
  error?: string;
}

const out: CheckResult = { done: false, userAgent: navigator.userAgent, crossOriginIsolated: globalThis.crossOriginIsolated ?? false, wasmUrl: String(simWasmUrl) };
(window as unknown as { __wasmCheck: CheckResult }).__wasmCheck = out;
const q = new URLSearchParams(location.search);
const flag = q.get('simwasm');
const wantAB = q.get('ab') === '1';
const quick = q.get('quick') === '1';

async function main(): Promise<void> {
  const status = await initSimWasmBrowser();
  const eq = equivalence();
  const ab = wantAB ? browserAB(quick) : [];
  out.main = { status, eq, ab };
  // synchronous compile on the main thread (Chrome refuses it above a size limit; ours is ~24 KB)
  try {
    const bytes = await (await fetch(simWasmUrl)).arrayBuffer();
    const t0 = performance.now();
    new WebAssembly.Instance(new WebAssembly.Module(bytes), simWasmImports());
    out.syncCompile = { ok: true, ms: performance.now() - t0, bytes: bytes.byteLength };
  } catch (e) {
    out.syncCompile = { ok: false, error: String(e) };
  }
  // the same inside a module worker (where a sim worker would run the kernels)
  out.worker = await new Promise((resolve) => {
    const w = new Worker(new URL('./wasmCheckWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { resolve(e.data); w.terminate(); };
    w.onerror = (e) => { resolve({ error: e.message || 'worker error' }); w.terminate(); };
    w.postMessage({ flag, quick, ab: wantAB });
  });
}

main().then(
  () => { out.done = true; document.title = 'wasm-check: done'; },
  (e) => { out.error = e instanceof Error ? e.stack : String(e); out.done = true; document.title = 'wasm-check: error'; },
);
