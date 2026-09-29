/** page entry of the trafficCore browser A/B: the suite on the main thread, then in a module Worker; results on window.__tc */
import { runBrowserTraffic } from './browserCore';

const q = new URLSearchParams(location.search);
const opts = { fixture: q.get('fixture') ?? 'dense1m', testdefs: q.get('testdefs') === '1', pairs: Number(q.get('pairs') ?? 31), warm: Number(q.get('warm') ?? 2), resident: q.get('resident') === '1' };
const out = window as unknown as { __tc: Record<string, unknown> };
out.__tc = { done: false };
(async () => {
  try {
    const main = q.get('main') === '0' ? null : await runBrowserTraffic({ ...opts, where: 'main', log: (s) => console.log(s) });
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
    out.__tc = { done: true, main, worker };
  } catch (e) {
    out.__tc = { done: true, error: e instanceof Error ? e.stack ?? e.message : String(e) };
  }
})();
