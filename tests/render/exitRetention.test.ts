/**
 * Close-out c1 (major): every exit to the region kept the whole previous city alive — one more CityScene per visit,
 * about 35 MB each for a 300k city (CDP Runtime.queryObjects after HeapProfiler.collectGarbage). three.js keeps a
 * dispose listener of each renderer (a closure over that renderer, its canvas and its GL state) on every material,
 * geometry and texture the renderer drew, and module-level objects shared by every city view outlived the view: the
 * city / ghost / road / LOD-fade materials, the world's noise and wave textures, the tree impostor geometries, three's
 * own DFG LUT. They held the disposed renderer, and through its canvas the detached scene DOM, its listeners and the
 * CityScene; and WorldView.hideEmpty's module-level scan stack still held the last scene's meshes (a TreeMesh ->
 * TreeRenderer.state -> the CityState).
 *
 * The teardown paths (CityObjectsView / BuildingRenderer / WorldView dispose) now dispose those shared objects — each
 * renderer drops its GPU copy and its listener; they stay cached and upload / compile again for the next city — and
 * clear the scan stack. Here a stand-in renderer "draws" them the way three.js does; after the teardown nothing may
 * keep it (or the scanned scene) reachable. The whole-game check is the exit / re-enter probe (CityScene count stays 1).
 */
import { describe, expect, it } from 'vitest';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as THREE from 'three';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';
import { CityObjectsView } from '../../src/render/city/CityObjectsView';
import { getCityMaterial, getGhostMaterial } from '../../src/render/city/common/cityMaterial';
import { getRoadMaterial } from '../../src/render/city/roads/roadMaterial';
import { WorldView } from '../../src/render/world/WorldView';
import { getNoiseTexture, getWaveNormalTexture } from '../../src/render/world/textures';
import { getImpostorGeometries, getMicroImpostorGeometries } from '../../src/render/world/fallbackTrees';

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc') as () => void;

type DisposeTarget = {
  addEventListener(type: 'dispose', f: (e: { target: DisposeTarget }) => void): void;
  removeEventListener(type: 'dispose', f: (e: { target: DisposeTarget }) => void): void;
};

/**
 * what three.js does the first time a renderer draws a material / geometry / texture (WebGLRenderer onMaterialDispose,
 * WebGLGeometries onGeometryDispose, WebGLTextures onTextureDispose): a dispose listener closing over the renderer,
 * which removes itself when the object is disposed. Returns a weak reference to the stand-in renderer.
 */
function drawWith(objs: object[]): WeakRef<object> {
  const renderer = { canvas: { pixels: new Float64Array(1 << 15) } };
  const onDispose = (e: { target: DisposeTarget }) => {
    e.target.removeEventListener('dispose', onDispose);
    void renderer.canvas;
  };
  for (const o of objs) (o as DisposeTarget).addEventListener('dispose', onDispose);
  return new WeakRef(renderer);
}

/** dispose listeners on a three.js object */
const listeners = (o: object): number => ((o as { _listeners?: Record<string, unknown[]> })._listeners?.dispose ?? []).length;

/** after the current task (WeakRef targets live until its end) and a full GC: is the object gone? */
async function collected(ref: WeakRef<object>): Promise<boolean> {
  await new Promise((r) => setTimeout(r, 0));
  gc();
  return ref.deref() === undefined;
}

describe('exit to region: nothing module-level keeps the disposed city view reachable (close-out c1)', () => {
  it('a city view teardown releases the city, ghost, road and LOD-fade materials it drew with', async () => {
    const st = createCityState(defaultCityConfig({ size: 64, seed: 7, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
    const sim = new Simulation(st, []);
    const view = new CityObjectsView(st, sim.events, {
      scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer: {} as THREE.WebGLRenderer, canvas: {} as HTMLCanvasElement,
    });
    const fade = (view.buildings as unknown as { fadeLayer: { mesh: THREE.Mesh } }).fadeLayer.mesh.material as THREE.Material;
    const shared = [getCityMaterial(), getGhostMaterial(), getRoadMaterial(), fade];
    expect(fade.name).toBe('building-lodfade');
    const renderer = drawWith(shared);
    for (const m of shared) expect(listeners(m)).toBe(1);
    view.dispose();
    for (const m of shared) expect(listeners(m), m.name || m.type).toBe(0);
    expect(await collected(renderer)).toBe(true);
    // (still the cached objects for the next city)
    expect(getCityMaterial()).toBe(shared[0]);
    expect(getRoadMaterial()).toBe(shared[2]);
  });

  /** the WorldView fields its hideEmpty() and dispose() use, with no WebGL behind them */
  function standInView(lut: THREE.Texture, city: object) {
    const scene = new THREE.Scene();
    // (a leaf mesh that keeps its city, as a TreeMesh does through TreeRenderer.state)
    const leaf = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    leaf.userData.city = city;
    scene.add(new THREE.Group().add(leaf));
    const terrainMaterial = new THREE.MeshStandardMaterial();
    const noop = { dispose: () => undefined };
    return {
      scene, renders: 0, instancedAt: -1, instanced: [] as THREE.Mesh[], hiddenEmpty: [] as THREE.Mesh[], nHidden: 0,
      _disposed: false, unsub: [] as (() => void)[], cameraController: noop, water: noop, trees: noop, sky: noop, post: noop,
      terrain: { material: terrainMaterial, dispose: () => undefined },
      sun: { dirShadow: {}, cascadeShadow: {} },
      // (three binds its shared DFG LUT into the programs of the physical materials: properties.get(material).uniforms)
      renderer: { properties: { get: (m: unknown) => (m === terrainMaterial ? { uniforms: { dfgLUT: { value: lut } } } : {}) }, dispose: () => undefined },
    };
  }

  const proto = WorldView.prototype as unknown as { hideEmpty(this: object): void; dispose(this: object): void };

  it("a world view teardown releases the shared textures, tree geometries and three's DFG LUT", async () => {
    const imp = getImpostorGeometries(), micro = getMicroImpostorGeometries();
    // (three's DFG LUT is module-private in three.js: a stand-in, found the way the teardown finds it)
    const lut = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const shared: object[] = [getNoiseTexture(), getWaveNormalTexture(), imp.broad, imp.conifer, micro.broad, micro.conifer, micro.top, micro.ringLow, lut];
    const renderer = drawWith(shared);
    proto.dispose.call(standInView(lut, {}));
    for (const o of shared) expect(listeners(o), (o as { name?: string }).name).toBe(0);
    expect(await collected(renderer)).toBe(true);
    // (still the cached objects for the next city)
    expect(getImpostorGeometries()).toBe(imp);
    expect(getNoiseTexture()).toBe(shared[0]);
  });

  it('a disposed world view leaves nothing of the scene it scanned in the module-level scan stack', async () => {
    // the view scans its scene (hideEmpty, in every frame's render) and is disposed (exit to region); then it is dropped
    const city = ((): WeakRef<object> => {
      const c = { cells: new Float64Array(1 << 15) };
      const view = standInView(new THREE.DataTexture(new Uint8Array(4), 1, 1), c);
      proto.hideEmpty.call(view);
      proto.dispose.call(view);
      return new WeakRef(c);
    })();
    // (the stack held the scanned scene's last leaf mesh, and through it the city: a TreeMesh -> the CityState)
    expect(await collected(city)).toBe(true);
  });
});
