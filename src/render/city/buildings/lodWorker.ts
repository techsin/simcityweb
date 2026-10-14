/**
 * LOD proxy worker (module worker, see lodBuilder.ts): builds building massing proxies off the main thread.
 * In:  { key, position, color, surf, urgent } — copies of the model's non-indexed attribute arrays (Float32Array,
 *      transferred); { promote: key } — a queued job is needed now (moves to the front)
 * Out: { key, ok, position?, normal?, color?, surf? } — the proxy's attributes (transferred); ok = false: no proxy
 * The top level has no static imports: the page holds the messages it posts to a worker until it learns that the
 * worker's script has run (a task on the page's main thread), and a city load keeps the main thread busy for seconds,
 * so the script must run before the load's long stretch starts, not after loading three.js. The proxy builder (three.js
 * + lodProxy) is imported right after; jobs that arrive before it is in wait in the queue.
 * Jobs queue here (urgent ones first) and are built one per task: the main thread posts a city's prefetch in bulk (so
 * the worker keeps building while a long load task holds the main thread), and a promotion or an urgent job that
 * arrives meanwhile is taken next.
 */
import type { BufferGeometry } from 'three';

interface Req { key: string; position: Float32Array; color: Float32Array; surf: Float32Array; urgent?: boolean }
interface Promote { promote: string }

const ctx = self as unknown as { onmessage: ((e: MessageEvent<Req | Promote>) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };

const queue: Req[] = [];
let build: ((req: Req) => void) | null = null;
let running = false;
// one job per task: a MessageChannel ping yields to the message queue between jobs without setTimeout's clamping
const tick = new MessageChannel();
tick.port1.onmessage = () => step();

function kick(): void {
  if (running || !build || !queue.length) return;
  running = true;
  tick.port2.postMessage(0);
}

function step(): void {
  const req = queue.shift();
  if (!req || !build) { running = false; return; }
  build(req);
  if (queue.length) tick.port2.postMessage(0);
  else running = false;
}

ctx.onmessage = (e) => {
  const d = e.data;
  if ('promote' in d) {
    const i = queue.findIndex((q) => q.key === d.promote);
    if (i > 0) queue.unshift(queue.splice(i, 1)[0]);
    return;
  }
  if (d.urgent) queue.unshift(d);
  else queue.push(d);
  kick();
};

void Promise.all([import('three'), import('./lodProxy')]).then(([T, lp]) => {
  build = (req) => {
    const { key, position, color, surf } = req;
    let out: BufferGeometry | null = null;
    try {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(position, 3));
      g.setAttribute('color', new T.BufferAttribute(color, 3));
      g.setAttribute('surf', new T.BufferAttribute(surf, 3));
      out = lp.makeLodProxy(key, g);
    } catch {
      out = null;
    }
    if (!out) { ctx.postMessage({ key, ok: false }); return; }
    const a = (n: string) => (out!.getAttribute(n).array as Float32Array).slice();
    const msg = { key, ok: true, position: a('position'), normal: a('normal'), color: a('color'), surf: a('surf') };
    ctx.postMessage(msg, [msg.position.buffer, msg.normal.buffer, msg.color.buffer, msg.surf.buffer]);
  };
  kick();
}, () => {
  // the builder did not load: the page builds the proxies itself (LodProxyBuilder.fail)
  ctx.postMessage({ key: '', ok: false, failed: true });
});
