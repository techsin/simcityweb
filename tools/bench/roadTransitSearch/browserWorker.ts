/** worker entry of the browser A/B (same suite, off the main thread) */
import { runBrowserSuite } from './browserCore';

self.onmessage = async (e: MessageEvent<{ reps: number; warmupMs: number; scalar: boolean }>) => {
  try {
    const result = await runBrowserSuite({ ...e.data, where: 'worker', log: (s) => (self as unknown as Worker).postMessage({ log: s }) });
    (self as unknown as Worker).postMessage({ result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.stack ?? err.message : String(err) });
  }
};
