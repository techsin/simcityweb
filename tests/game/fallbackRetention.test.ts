/**
 * T016 lane F: fallback buildings / ghosts must not attach renderer listeners to registry objects. The node renderer
 * stand-in keeps itself alive through dispose listeners just as three does, including its shared DFG LUT. Retain the
 * drawn resources after teardown to check both listener removal and collection without a browser or WebGL context.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as THREE from 'three';
import { Emitter } from '../../src/core/events';
import { Overlay } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import type { CityEvents } from '../../src/sim/Simulation';
import { FallbackObjectsView } from '../../src/game/fallback/FallbackObjectsView';
import { FallbackWorldView } from '../../src/game/fallback/FallbackWorldView';
import { registerAllModels } from '../../src/assets/builders';
import { getModelGeometry } from '../../src/assets/registry';
import { getBuildingMaterial } from '../../src/assets/materials';
import { newState, place } from '../infra/cityGen';

const stub = vi.hoisted(() => ({ lut: null as THREE.Texture | null, order: [] as string[] }));

type Disposable = {
  addEventListener(type: 'dispose', f: (e: { target: Disposable }) => void): void;
  removeEventListener(type: 'dispose', f: (e: { target: Disposable }) => void): void;
};

vi.mock('three', async (importOriginal) => {
  const real = await importOriginal<typeof import('three')>();
  const lut = stub.lut = new real.DataTexture(new Uint8Array(4), 1, 1);
  class StubRenderer {
    readonly domElement: HTMLCanvasElement;
    readonly context = { lost: false, pixels: new Float64Array(1 << 14) };
    private seen = new WeakSet<object>();
    private props = new WeakMap<object, { uniforms: { dfgLUT: { value: THREE.Texture } } }>();
    readonly properties = { get: (o: object) => this.props.get(o) ?? {} };
    constructor(o: { canvas: HTMLCanvasElement }) {
      this.domElement = o.canvas;
    }
    setPixelRatio(): void {}
    setClearColor(): void {}
    private upload(o: object): void {
      if (this.seen.has(o)) return;
      this.seen.add(o);
      const f = (e: { target: Disposable }) => {
        e.target.removeEventListener('dispose', f);
        this.seen.delete(e.target);
        this.props.delete(e.target);
        if (e.target === lut) stub.order.push('lut');
      };
      (o as Disposable).addEventListener('dispose', f);
    }
    render(scene: THREE.Scene): void {
      scene.traverseVisible((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.geometry) return;
        this.upload(mesh.geometry);
        if ((mesh as THREE.InstancedMesh).isInstancedMesh) this.upload(mesh);
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          this.upload(mat);
          const map = (mat as THREE.MeshBasicMaterial).map;
          if (map) this.upload(map);
          // r186 binds this uniform on the terrain's Lambert program too; only PBR materials upload the LUT.
          this.props.set(mat, { uniforms: { dfgLUT: { value: lut } } });
          if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) this.upload(lut);
        }
      });
    }
    dispose(): void {
      this.props = new WeakMap();
      stub.order.push('renderer');
    }
    forceContextLoss(): void {
      this.context.lost = true;
      stub.order.push('context');
    }
  }
  return { ...real, WebGLRenderer: StubRenderer };
});

class TrackedTarget extends EventTarget {
  private listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    super.addEventListener(type, callback, options);
    if (!callback) return;
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(callback);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
    super.removeEventListener(type, callback, options);
    if (callback) this.listeners.get(type)?.delete(callback);
  }
  get listenerCount(): number {
    return [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  }
}

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;
const listeners = (o: object): number => ((o as { _listeners?: Record<string, unknown[]> })._listeners?.dispose ?? []).length;

let win: TrackedTarget;
beforeEach(() => {
  win = new TrackedTarget();
  vi.stubGlobal('window', win);
  stub.order.length = 0;
});
afterEach(() => vi.unstubAllGlobals());

function session() {
  const state = newState(16);
  state.trees[0] = 1;
  const events = new Emitter<CityEvents>();
  const canvas = new TrackedTarget();
  const world = new FallbackWorldView(canvas as unknown as HTMLCanvasElement, state, events, { quality: 'low' });
  const objects = new FallbackObjectsView(state, events, { scene: world.scene, camera: world.camera, renderer: world.renderer, canvas: canvas as unknown as HTMLCanvasElement });
  return { state, events, canvas, world, objects };
}

function building(scene: THREE.Scene, id: number): THREE.Mesh {
  let found: THREE.Mesh | undefined;
  scene.traverse((o) => { if (o.userData.bid === id) found = o as THREE.Mesh; });
  expect(found).toBeDefined();
  return found!;
}

function ghost(scene: THREE.Scene): THREE.Mesh {
  return scene.children.find((o) => o.renderOrder === 40) as THREE.Mesh;
}

function resources(scene: THREE.Scene): Set<object> {
  const out = new Set<object>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.geometry) return;
    out.add(mesh.geometry);
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) out.add(mesh);
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      out.add(mat);
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map) out.add(map);
    }
  });
  return out;
}

function watchDisposals(objects: Iterable<object>): Set<object> {
  const disposed = new Set<object>();
  for (const o of objects) {
    const f = (e: { target: Disposable }) => {
      e.target.removeEventListener('dispose', f);
      disposed.add(o);
    };
    (o as Disposable).addEventListener('dispose', f);
  }
  return disposed;
}

async function collected(refs: Record<string, WeakRef<object>>): Promise<Record<string, boolean>> {
  let out: Record<string, boolean> = {};
  for (let k = 0; k < 20; k++) {
    await new Promise((r) => setTimeout(r, k ? 20 : 0));
    gc();
    out = Object.fromEntries(Object.entries(refs).map(([key, ref]) => [key, ref.deref() === undefined]));
    if (Object.values(out).every(Boolean)) break;
  }
  return out;
}

describe('fallback views release renderer listeners and the GL context (T016 lane F)', () => {
  it('owns cached geometry views and a patched material clone; releases every drawn resource and the renderer on exit', async () => {
    registerAllModels();
    const shared = [getModelGeometry('res_cottage', 0), getModelGeometry('res_cottage', 1), getModelGeometry('com_corner_store', 0), getBuildingMaterial()];
    let sharedDisposes = 0;
    const onSharedDispose = () => { sharedDisposes++; };
    for (const o of shared) o.addEventListener('dispose', onSharedDispose);
    const before = shared.map(listeners);
    const visit = async () => {
      const { state, events, canvas, world, objects } = session();
      try {
        const a = place(state, 't_r1', 2, 2, { built: 0.5 });
        const b = place(state, 't_r1', 4, 2);
        const c = place(state, 't_r1', 6, 2, { variant: 1 });
        place(state, 't_r1', 8, 2, { flags: BF.Burnt });
        await vi.dynamicImportSettled();
        objects.update(0);
        const mesh = building(world.scene, a.id), same = building(world.scene, b.id), variant = building(world.scene, c.id);
        const mat = mesh.material as THREE.Material;
        expect(mesh.geometry).not.toBe(shared[0]);
        expect(mesh.geometry).toBe(same.geometry);
        expect(variant.geometry).not.toBe(mesh.geometry);
        expect(variant.geometry).not.toBe(shared[1]);
        for (const [view, src] of [[mesh.geometry, shared[0]], [variant.geometry, shared[1]]] as [THREE.BufferGeometry, THREE.BufferGeometry][]) {
          expect(view.index).toBe(src.index);
          expect(Object.keys(view.attributes)).toEqual(Object.keys(src.attributes));
          for (const k of Object.keys(src.attributes)) expect(view.attributes[k]).toBe(src.attributes[k]);
          expect(view.groups).toEqual(src.groups);
          expect(view.drawRange).toEqual(src.drawRange);
          expect(view.boundingBox).toBe(src.boundingBox);
          expect(view.boundingSphere).toBe(src.boundingSphere);
        }
        expect(mesh.scale.y).toBe(0.5);
        expect(mat).not.toBe(getBuildingMaterial());
        expect(same.material).toBe(mat);
        expect(variant.material).toBe(mat);
        expect(mat.onBeforeCompile).toBe(getBuildingMaterial().onBeforeCompile);
        expect(mat.customProgramCacheKey).toBe(getBuildingMaterial().customProgramCacheKey);
        expect(mat.customProgramCacheKey()).toBe(getBuildingMaterial().customProgramCacheKey());
        objects.setGhost('t_r1', 2, 4);
        expect(ghost(world.scene).geometry).toBe(mesh.geometry);
        objects.setSelected(a.id);
        world.setOverlay(Overlay.Zones);
        world.setBrush({ x: 2, z: 2 }, 2);
        world.render();
        const drawn = resources(world.scene);
        objects.setGhost('t_cs', 4, 4);
        const ghostGeo = ghost(world.scene).geometry;
        expect(ghostGeo).not.toBe(shared[2]);
        world.render();
        for (const o of resources(world.scene)) drawn.add(o);
        // The removed ghost's cached view must still be disposed at exit.
        objects.setGhost('t_r1', 2, 4);
        expect(ghost(world.scene).geometry).toBe(mesh.geometry);
        drawn.add(stub.lut!);
        for (const o of drawn) expect(listeners(o)).toBe(1);
        expect(shared.map(listeners)).toEqual(before);
        const disposed = watchDisposals(drawn);
        const context = (world.renderer as unknown as { context: object & { lost: boolean } }).context;
        const orderStart = stub.order.length;
        objects.dispose();
        expect(world.renderer.properties.get(mat)).toEqual({});
        world.dispose();
        expect(stub.order.slice(orderStart)).toEqual(['renderer', 'lut', 'context']);
        expect(context.lost).toBe(true);
        expect(disposed.size).toBe(drawn.size);
        for (const o of drawn) expect(listeners(o)).toBe(0);
        expect(shared.map(listeners)).toEqual(before);
        expect(sharedDisposes).toBe(0);
        expect(canvas.listenerCount).toBe(0);
        expect(win.listenerCount).toBe(0);
        expect(world.scene.children).toHaveLength(0);
        events.emit('reset', undefined);
        objects.update(0);
        expect(world.scene.children).toHaveLength(0);
        objects.dispose();
        world.dispose();
        expect(stub.order.slice(orderStart)).toEqual(['renderer', 'lut', 'context']);
        return { drawn, geometry: mesh.geometry, mat, refs: { renderer: new WeakRef(world.renderer), canvas: new WeakRef(canvas), context: new WeakRef(context) } };
      } finally {
        objects.dispose();
        world.dispose();
      }
    };
    try {
      const first = await visit();
      expect(await collected(first.refs)).toEqual({ renderer: true, canvas: true, context: true });
      const second = await visit();
      expect(second.geometry).not.toBe(first.geometry);
      expect(second.mat).not.toBe(first.mat);
      expect(await collected(second.refs)).toEqual({ renderer: true, canvas: true, context: true });
      // Keep the drawn resources rooted through both collection checks.
      for (const o of [...first.drawn, ...second.drawn]) expect(listeners(o)).toBe(0);
      expect(getModelGeometry('res_cottage', 0)).toBe(shared[0]);
      expect(getBuildingMaterial()).toBe(shared[3]);
    } finally {
      for (const o of shared) o.removeEventListener('dispose', onSharedDispose);
    }
  });

  it('disposes box materials on asset loading, reset, replacement and removal, and tree resources on rebuild', async () => {
    const { state, events, world, objects } = session();
    try {
      const b = place(state, 't_r1', 2, 2);
      events.emit('buildingAdded', b);
      objects.update(0);
      const initial = building(world.scene, b.id).material as THREE.Material;
      world.render();
      expect(listeners(initial)).toBe(1);
      await vi.dynamicImportSettled();
      expect(listeners(initial)).toBe(0);
      objects.update(0);
      const model = building(world.scene, b.id);
      world.render();
      b.flags |= BF.Burnt;
      for (const event of ['buildingChanged', 'reset', 'buildingChanged', 'buildingRemoved'] as const) {
        const old = building(world.scene, b.id).material as THREE.Material;
        if (event === 'buildingRemoved') state.buildings.delete(b.id);
        if (event === 'reset') events.emit('reset', undefined);
        else events.emit(event, b);
        objects.update(0);
        if (old === model.material) expect(listeners(old)).toBe(1);
        else expect(listeners(old)).toBe(0);
        world.render();
      }
      const trees = world.scene.children.find((o) => (o as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh;
      const oldTrees = [trees, trees.geometry, trees.material as THREE.Material];
      for (const o of oldTrees) expect(listeners(o)).toBe(1);
      const disposed = watchDisposals(oldTrees);
      events.emit('treesChanged', { x0: 0, z0: 0, x1: 1, z1: 1 });
      expect(disposed.size).toBe(oldTrees.length);
      for (const o of oldTrees) expect(listeners(o)).toBe(0);
      objects.dispose();
      expect(listeners(model.geometry)).toBe(0);
      expect(listeners(model.material as THREE.Material)).toBe(0);
    } finally {
      objects.dispose();
      world.dispose();
    }
  });

  it('can exit before the first draw or asset load completes without reviving the disposed view', async () => {
    const { state, events, canvas, world, objects } = session();
    const b = place(state, 't_r1', 2, 2);
    events.emit('buildingAdded', b);
    objects.dispose();
    world.dispose();
    await vi.dynamicImportSettled();
    const internals = objects as unknown as { assets: unknown; buildDirty: Set<number>; geometryViews: Map<string, THREE.BufferGeometry> };
    expect(internals.assets).toBeNull();
    expect(internals.buildDirty.size).toBe(0);
    expect(internals.geometryViews.size).toBe(0);
    objects.update(0);
    objects.setGhost('t_r1', 2, 4);
    events.emit('reset', undefined);
    expect(world.scene.children).toHaveLength(0);
    expect(canvas.listenerCount).toBe(0);
    expect(win.listenerCount).toBe(0);
    expect(stub.order).toEqual(['renderer', 'context']);
    objects.dispose();
    world.dispose();
    expect(stub.order).toEqual(['renderer', 'context']);
  });
});
