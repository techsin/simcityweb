import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

// J0 (docs/WORKER_DESIGN.md §6 S0): the main thread posts LOD jobs to its workers by structured clone, never with a
// transfer list. A transfer detaches ArrayBuffers on the main thread, and the first detach there invalidates V8's
// ArrayBuffer-detaching protector for the whole isolate, which slows every typed-array access on the main thread.
describe('LOD proxy builder: J0, no transfer from the main thread', () => {
  it('posts every job without a transfer list and leaves its arrays attached', async () => {
    const calls: { msg: Record<string, unknown>; transfer: unknown }[] = [];
    class FakeWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      constructor(public url: URL, public opts: unknown) {}
      postMessage(msg: Record<string, unknown>, transfer?: unknown): void { calls.push({ msg, transfer }); }
      terminate(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    try {
      const { LodProxyBuilder } = await import('../../src/render/city/buildings/lodBuilder');
      const pb = new LodProxyBuilder();
      expect(pb.available).toBe(true);
      const g = new THREE.BufferGeometry();
      for (const n of ['position', 'color', 'surf']) g.setAttribute(n, new THREE.Float32BufferAttribute(new Float32Array(9), 3));
      for (let i = 0; i < 4; i++) pb.request(`notransfer_${i}`, g, () => {}, i === 0);
      const jobs = calls.filter((c) => 'position' in c.msg);
      expect(jobs.length).toBeGreaterThan(0);
      for (const { msg, transfer } of jobs) {
        // no transfer list at all (an empty one would also be fine, but the design says none)
        expect(transfer).toBeUndefined();
        for (const k of ['position', 'color', 'surf']) {
          const a = msg[k] as Float32Array;
          expect(a).toBeInstanceOf(Float32Array);
          // still attached after the post: nothing was detached on this thread
          expect(a.buffer.byteLength).toBe(a.length * 4);
          // a copy, never the geometry's own array (so a clone cannot alias the live attribute)
          expect(a).not.toBe((g.getAttribute(k) as THREE.BufferAttribute).array);
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
