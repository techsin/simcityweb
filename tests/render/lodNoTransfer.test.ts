import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, scanFiles, sourceFiles } from '../worker/hygieneScan';

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
      postMessage(msg: Record<string, unknown>, transfer?: Transferable[] | StructuredSerializeOptions): void {
        calls.push({ msg, transfer });
        // a real port's semantics: a transfer list detaches the sender's buffers (only on a regression: the fixed
        // builder never passes one, so nothing is detached in this isolate)
        if (transfer !== undefined) structuredClone(msg, Array.isArray(transfer) ? { transfer } : transfer);
      }
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
      for (const n of ['position', 'color', 'surf']) g.setAttribute(n, new THREE.Float32BufferAttribute(new Float32Array(9).fill(1), 3));
      // one urgent job (posted at once, past the per-worker bound) and three queued ones (posted by pump)
      for (let i = 0; i < 4; i++) pb.request(`notransfer_${i}`, g, () => {}, i === 0);
      const jobs = calls.filter((c) => 'position' in c.msg);
      expect(jobs.length).toBe(4);
      for (const { msg, transfer } of jobs) {
        // no transfer list at all (an empty one would also keep the protector, but the design says none)
        expect(transfer).toBeUndefined();
        for (const k of ['position', 'color', 'surf']) {
          const a = msg[k] as Float32Array;
          const src = (g.getAttribute(k) as THREE.BufferAttribute).array as Float32Array;
          expect(a).toBeInstanceOf(Float32Array);
          // still attached after the post, with the geometry's whole contents (a detached view reads as length 0)
          expect(a.length).toBe(src.length);
          expect(a.buffer.byteLength).toBe(src.length * 4);
          expect(Array.from(a)).toEqual(Array.from(src));
          // a copy, never the geometry's own array (so the clone cannot alias the live attribute)
          expect(a).not.toBe(src);
          expect(a.buffer).not.toBe(src.buffer);
        }
      }
      // the geometry itself is untouched
      for (const k of ['position', 'color', 'surf']) expect((g.getAttribute(k) as THREE.BufferAttribute).array.length).toBe(9);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('no main-thread source posts with a transfer list; only the LOD worker\'s reply transfers (in its own isolate)', () => {
    // everything under src/ except the sim (S1's hygiene suite covers src/sim and src/save): the game's main thread,
    // the render workers and the host seam. A new transfer list here must be a deliberate, worker-side entry.
    const files = readdirSync(join(ROOT, 'src'), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === 'sim' ? [] : sourceFiles(`src/${e.name}`)) : /\.[cm]?[jt]sx?$/.test(e.name) ? [`src/${e.name}`] : []);
    expect(files).toContain('src/render/city/buildings/lodBuilder.ts');
    const transfers = scanFiles(files).filter((v) => v.rule === 'transfer list' || v.rule === 'ArrayBuffer transfer');
    expect(transfers.map(({ file, rule, code }) => ({ file, rule, code }))).toEqual([
      { file: 'src/render/city/buildings/lodWorker.ts', rule: 'transfer list', code: 'ctx.postMessage(msg, [msg.position.buffer, msg.normal.buffer, msg.color.buffer, msg.surf.buffer])' },
    ]);
    // (parsing ~290 files takes about 4 s alone and past 5 s inside the full parallel suite: vitest's default timeout)
  }, 60_000);
});
