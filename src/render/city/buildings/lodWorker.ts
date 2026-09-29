/**
 * LOD proxy worker (module worker, see lodBuilder.ts): builds building massing proxies off the main thread.
 * In:  { key, position, color, surf } — copies of the model's non-indexed attribute arrays (Float32Array, transferred)
 * Out: { key, ok, position?, normal?, color?, surf? } — the proxy's attributes (transferred); ok = false: no proxy
 */
import * as THREE from 'three';
import { makeLodProxy } from './lodProxy';

interface Req { key: string; position: Float32Array; color: Float32Array; surf: Float32Array }

const ctx = self as unknown as { onmessage: ((e: MessageEvent<Req>) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };

ctx.onmessage = (e) => {
  const { key, position, color, surf } = e.data;
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
};
