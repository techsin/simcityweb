/**
 * Vite config for the WebAssembly browser checks: the project's own vite.config.ts (same base './', target, …) plus
 * tools/bench/wasm-check.html as an extra input, built into node_modules/.cache/wasm-check-dist. COI=1 adds the
 * cross-origin-isolation headers (needed for SharedArrayBuffer / wasm threads) to the dev and preview servers.
 * Used by tools/bench/browser-check.mjs; `npm run build` itself is unaffected.
 */
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from '../../vite.config';

/** COOP + COEP: makes the page crossOriginIsolated (SharedArrayBuffer, shared WebAssembly.Memory) */
export const COI_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const coi = process.env.COI === '1';

export default mergeConfig(
  base,
  defineConfig({
    logLevel: 'warn',
    build: {
      outDir: fileURLToPath(new URL('../../node_modules/.cache/wasm-check-dist', import.meta.url)),
      emptyOutDir: true,
      rollupOptions: { input: { wasmcheck: fileURLToPath(new URL('./wasm-check.html', import.meta.url)) } },
    },
    server: coi ? { headers: COI_HEADERS } : {},
    preview: coi ? { headers: COI_HEADERS } : {},
  }),
);
