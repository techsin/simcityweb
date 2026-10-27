/**
 * Close-out c2 item 8 (left open by c1): the toolbar thumbnail renderer (src/ui/thumbs.ts) disposes its WebGL renderer
 * after 15 s idle, yet every disposed renderer stayed reachable — three.js hangs a dispose listener (a closure over the
 * renderer, its canvas and its GL state) on each geometry and material a renderer draws, and the thumbnails drew the
 * shared registry geometries and the shared building material (a UI session left 7 extra renderers in the city).
 * The thumbnails now draw a view of the registry geometry (its own object over the same buffers, disposed after the
 * render) with the renderer's own copy of the building material (disposed with the renderer).
 *
 * three's renderer is replaced by a stand-in that "draws" the way three.js does (one dispose listener per drawn geometry
 * and material, removed when that object is disposed); after the idle cleanup nothing shared may hold a listener and
 * the stand-in must be collectable.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import type * as THREEType from 'three';

const stub = vi.hoisted(() => ({ renderers: [] as WeakRef<object>[], draws: 0, lut: null as object | null }));

vi.mock('three', async (importOriginal) => {
  const THREE = await importOriginal<typeof import('three')>();
  type Disposable = { addEventListener(t: 'dispose', f: (e: { target: Disposable }) => void): void; removeEventListener(t: 'dispose', f: (e: { target: Disposable }) => void): void };
  // three r186's DFG LUT: one module-level texture for every renderer, bound to the physical materials' programs
  // (close-out c4: each renderer that drew a physical material hangs its dispose listener on it)
  const lut = new THREE.Texture();
  lut.name = 'DFG_LUT';
  stub.lut = lut;
  class StubRenderer {
    readonly domElement: { toDataURL(type?: string): string };
    toneMapping = 0;
    toneMappingExposure = 1;
    /** stand-in for the GL state and canvas a real renderer keeps */
    private state = { pixels: new Float64Array(1 << 14) };
    private seen = new WeakSet<object>();
    /** WebGLProperties: a drawn material's program uniforms (how WorldView / thumbs find the LUT) */
    readonly properties = { get: (o: object) => (this.seen.has(o) ? { uniforms: { dfgLUT: { value: lut } } } : undefined) };
    constructor(o: { canvas: { toDataURL?: () => string } }) {
      o.canvas.toDataURL = () => 'data:image/png;base64,AAAA';
      this.domElement = o.canvas as { toDataURL(): string };
      stub.renderers.push(new WeakRef(this));
    }
    setPixelRatio(): void {}
    setClearColor(): void {}
    setSize(): void {}
    dispose(): void {}
    forceContextLoss(): void {}
    /** WebGLGeometries / WebGLRenderer: the first draw of a geometry / material (and of the LUT a physical material binds)
     *  hangs a listener closing over the renderer */
    render(scene: THREEType.Scene): void {
      stub.draws++;
      scene.traverse((o) => {
        const m = o as THREEType.Mesh;
        if (!m.isMesh) return;
        for (const t of [m.geometry, m.material as THREEType.Material, lut] as unknown as Disposable[]) {
          if (this.seen.has(t)) continue;
          this.seen.add(t);
          const state = this.state;
          const f = (e: { target: Disposable }) => {
            e.target.removeEventListener('dispose', f);
            void state;
          };
          t.addEventListener('dispose', f);
        }
      });
    }
  }
  class StubPMREM {
    constructor(_r: unknown) {}
    fromScene(): { texture: THREEType.Texture } {
      return { texture: new THREE.Texture() };
    }
    dispose(): void {}
  }
  return { ...THREE, WebGLRenderer: StubRenderer, PMREMGenerator: StubPMREM };
});

import { thumbs } from '../../src/ui/thumbs';
import { getModelGeometry, hasModel } from '../../src/assets/registry';
import { getBuildingMaterial } from '../../src/assets/materials';
import { registerAllModels } from '../../src/assets/builders';

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;

/** dispose listeners on a three.js object */
const listeners = (o: object): number => ((o as { _listeners?: Record<string, unknown[]> })._listeners?.dispose ?? []).length;

const g = globalThis as unknown as Record<string, unknown>;
const had: Record<string, unknown> = {};
beforeAll(() => {
  for (const k of ['document', 'window', 'requestAnimationFrame']) had[k] = g[k];
  g.document = { createElement: () => ({}) };
  g.window = globalThis;
  g.requestAnimationFrame = (f: (t: number) => void) => setTimeout(() => f(performance.now()), 0);
});
afterAll(() => {
  for (const k of Object.keys(had)) g[k] = had[k];
});

describe('toolbar thumbnails keep no disposed renderer alive (close-out c2 item 8)', () => {
  it('after the 15 s idle cleanup no shared geometry or material holds a listener, and the renderer is collectable', { timeout: 120000 }, async () => {
    registerAllModels();
    const models = ['res_cottage', 'com_corner_store', 'ind_warehouse'].filter(hasModel);
    expect(models.length).toBe(3);
    vi.useFakeTimers();
    try {
      const urls = await Promise.all(models.map((m) => {
        const p = thumbs.get(m, [1, 1]);
        return p;
      }).map(async (p) => {
        // (the renderer works one thumbnail per animation frame)
        for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(20);
        return p;
      }));
      expect(urls.every((u) => typeof u === 'string' && u.startsWith('data:image/png'))).toBe(true);
      expect(stub.draws).toBe(3);
      expect(stub.renderers.length).toBe(1);
      // the shared registry geometries and the shared building material were never drawn by the thumbnail renderer
      for (const m of models) expect(listeners(getModelGeometry(m, 0)), m).toBe(0);
      expect(listeners(getBuildingMaterial())).toBe(0);
      expect(listeners(stub.lut!)).toBe(1);
      // idle: the renderer is disposed (15 s), and nothing it drew keeps it reachable — the shared DFG LUT included
      await vi.advanceTimersByTimeAsync(16000);
      expect(listeners(stub.lut!)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    const collectable = async (i: number) => {
      let gone = false;
      for (let k = 0; k < 20 && !gone; k++) {
        await new Promise((r) => setTimeout(r, k ? 20 : 0));
        gc();
        gone = stub.renderers[i].deref() === undefined;
      }
      return gone;
    };
    expect(await collectable(0)).toBe(true);
    // the next thumbnail starts a fresh renderer and still renders; its own idle cleanup frees it too (close-out c4:
    // a second burst used to add one more renderer per idle cycle)
    vi.useFakeTimers();
    try {
      const p = thumbs.get('res_cottage', [1, 1], 96, 64);
      for (let k = 0; k < 20; k++) await vi.advanceTimersByTimeAsync(20);
      expect(await p).toMatch(/^data:image\/png/);
      expect(stub.renderers.length).toBe(2);
      expect(listeners(getBuildingMaterial())).toBe(0);
      expect(listeners(stub.lut!)).toBe(1);
      await vi.advanceTimersByTimeAsync(16000);
      expect(listeners(stub.lut!)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
    expect(await collectable(1)).toBe(true);
  });
});
