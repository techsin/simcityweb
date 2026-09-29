/**
 * Page entry of one ISOLATED browser arm (arm.html): window.__arm.init / cycle / digest, called by the node
 * coordinator (browserIso.ts) through Playwright. where = 'main': the arm runs on this page's main thread (how the
 * game runs its simulation today); 'worker': in a module Worker of this page (the page only forwards).
 */
import { makeArmHost, type ArmHost, type ArmHostOpts } from './browserArmHost';

type Where = 'main' | 'worker';
let host: ArmHost | null = null;
let worker: Worker | null = null;
let pending: ((v: unknown) => void) | null = null;
let failed: ((e: Error) => void) | null = null;

function ask(msg: Record<string, unknown>): Promise<unknown> {
  return new Promise((res, rej) => { pending = res; failed = rej; worker!.postMessage(msg); });
}

(window as unknown as { __arm: unknown }).__arm = {
  async init(o: ArmHostOpts & { where: Where }) {
    if (o.where === 'worker') {
      worker = new Worker('/armworker.js', { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ error?: string; value?: unknown }>) => {
        const p = pending, f = failed;
        pending = failed = null;
        if (e.data.error) f?.(new Error(e.data.error));
        else p?.(e.data.value);
      };
      worker.onerror = (e) => { const f = failed; pending = failed = null; f?.(new Error(e.message)); };
      return ask({ cmd: 'init', opts: o });
    }
    host = await makeArmHost(o);
    return host.info;
  },
  async cycle() { return worker ? ask({ cmd: 'cycle' }) : host!.cycle(); },
  async digest() { return worker ? ask({ cmd: 'digest' }) : host!.digest(); },
};
