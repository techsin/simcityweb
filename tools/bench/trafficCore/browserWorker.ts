/** worker entry of the trafficCore browser A/B (same suite, off the main thread) */
import { runBrowserTraffic, type BrowserOpts } from './browserCore';

self.onmessage = async (e: MessageEvent<Omit<BrowserOpts, 'where' | 'log'>>) => {
  try {
    const result = await runBrowserTraffic({ ...e.data, where: 'worker', log: (s) => (self as unknown as Worker).postMessage({ log: s }) });
    (self as unknown as Worker).postMessage({ result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: err instanceof Error ? err.stack ?? err.message : String(err) });
  }
};
