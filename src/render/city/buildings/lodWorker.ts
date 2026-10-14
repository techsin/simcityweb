/**
 * LOD proxy worker (module worker, see lodBuilder.ts): builds building massing proxies off the main thread.
 * In:  { key, position, color, surf, urgent } — copies of the model's non-indexed attribute arrays (Float32Array,
 *      transferred); { promote: key } — a queued job is needed now (moves to the front)
 * Out: { key, ok, position?, normal?, color?, surf? } — the proxy's attributes (transferred); ok = false: no proxy
 * Jobs queue here (urgent ones first) and are built one per task: the main thread posts a city's whole prefetch at
 * once (so the worker keeps building while a long load task holds the main thread, instead of waiting for it to hand
 * out the next job), and a promotion or an urgent job that arrives meanwhile is taken next.
 */
import * as THREE from 'three';
import { makeLodProxy } from './lodProxy';

interface Req { key: string; position: Float32Array; color: Float32Array; surf: Float32Array; urgent?: boolean }
interface Promote { promote: string }

const ctx = self as unknown as { onmessage: ((e: MessageEvent<Req | Promote>) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };

const queue: Req[] = [];
let running = false;
// one job per task: a MessageChannel ping yields to the message queue between jobs without setTimeout's clamping
const tick = new MessageChannel();
tick.port1.onmessage = () => step();

function build(req: Req): void {
  const { key, position, color, surf } = req;
  let out: THREE.BufferGeometry | null = null;
  try {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(position, 3));
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    g.setAttribute('surf', new THREE.BufferAttribute(surf, 3));
    out = makeLodProxy(key, g);
  } catch {
    out = null;
  }
  if (!out) { ctx.postMessage({ key, ok: false }); return; }
  const a = (n: string) => (out!.getAttribute(n).array as Float32Array).slice();
  const msg = { key, ok: true, position: a('position'), normal: a('normal'), color: a('color'), surf: a('surf') };
  ctx.postMessage(msg, [msg.position.buffer, msg.normal.buffer, msg.color.buffer, msg.surf.buffer]);
}

function step(): void {
  const req = queue.shift();
  if (!req) { running = false; return; }
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
  if (!running) { running = true; tick.port2.postMessage(0); }
};
