/**
 * W1.2: the simulation worker's script URL. Vite bundles simWorker.ts (and the kernels' wasm URL inside it) as a chunk of
 * its own, and this is its hashed URL, so the page can prefetch it on the region screen before it spawns the worker
 * from it (WORKER_DESIGN §4.1 step 1, O12). Only main.ts imports this module: node tests spawn the worker themselves.
 */
import url from './simWorker.ts?worker&url';

export const SIM_WORKER_URL: string = url;
