/** page entry of the browser A/B: main-thread suite, then the same suite in a module Worker; results on window.__rts */
import { runBrowserSuite } from './browserCore';

const q = new URLSearchParams(location.search);
const opts = { reps: Number(q.get('reps') ?? 31), warmupMs: Number(q.get('warmup') ?? 600), scalar: q.get('scalar') === '1' };
const out = window as unknown as { __rts: Record<string, unknown> };
out.__rts = { done: false };
(async () => {
  try {
    const main = await runBrowserSuite({ ...opts, where: 'main', log: (s) => console.log(s) });
    const worker = await new Promise<unknown>((resolve, reject) => {
      const w = new Worker('/worker.js', { type: 'module' });
      w.onmessage = (e: MessageEvent<{ log?: string; result?: unknown; error?: string }>) => {
        if (e.data.log) console.log(e.data.log);
        if (e.data.error) reject(new Error(e.data.error));
        if (e.data.result) resolve(e.data.result);
      };
      w.onerror = (e) => reject(new Error(e.message));
      w.postMessage(opts);
    });
    out.__rts = { done: true, main, worker, crossOriginIsolated: (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated ?? false };
  } catch (e) {
    out.__rts = { done: true, error: e instanceof Error ? e.stack ?? e.message : String(e) };
  }
})();
