/**
 * Browser entry for the simulation kernels: resolves the committed binary through Vite (`?url` import: a hashed asset
 * in production builds, /src/wasm/sim_kernels.wasm in dev) and instantiates it (streaming when the server sends
 * application/wasm, buffered otherwise). Import this from browser code only (main thread or a Web Worker) — node code
 * (tests, the balance bot) needs nothing: kernels auto-initialise from disk there.
 *
 *   import { initSimWasmBrowser } from './wasm/browser';
 *   await initSimWasmBrowser();            // before starting the sim (optional: results are identical without it)
 *
 * A/B flag: ?simwasm=js | wasm | auto (+ per kernel, e.g. ?simwasm=auto,blur:js), or localStorage 'metropolis.simwasm'.
 */
import wasmUrl from './sim_kernels.wasm?url';
import { applySimWasmFlag, initSimWasm, simWasmStatus, simWasmWanted, type SimWasmStatus } from './simWasm';

export { wasmUrl as simWasmUrl };

/**
 * Instantiate the kernels in this realm. `flag` overrides the URL / localStorage flag (a worker gets the page's flag
 * this way). Resolves to the status; kernels fall back to JS on any failure (status.error says why).
 */
export async function initSimWasmBrowser(opts: { url?: string | URL; flag?: string | null } = {}): Promise<SimWasmStatus> {
  if (opts.flag != null) applySimWasmFlag(opts.flag);
  if (simWasmWanted()) await initSimWasm(opts.url ?? new URL(wasmUrl, (globalThis as { location?: { href: string } }).location?.href));
  return simWasmStatus();
}
