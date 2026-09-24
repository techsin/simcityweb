/**
 * Rendering LOD / culling invariants (pure JS, no WebGL context):
 *  - building massing proxies: generated for (nearly) every building model, much cheaper, inside the model's bounds,
 *    windowed models keep window surfaces (lit at night), deterministic
 *  - DynamicBatch per-pass draw lists: view frustum culling, per-instance shadow cascade masks, tiny-caster skipping,
 *    receiver-volume culling and list caching
 *  - shadow receivers only bump their version when the volume really changes
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { getModelGeometry, registeredModelIds } from '../../src/assets/registry';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { Surf } from '../../src/core/types';
import { buildLodProxy } from '../../src/render/city/buildings/lodProxy';
import { DynamicBatch, TileCuller } from '../../src/render/city/common/batch';
import { makeReceiver, setReceiver } from '../../src/render/world/Shadows';

registerAllModels();

const WINDOWED = new Set<number>([Surf.WallWindows, Surf.GlassCurtain, Surf.GlassPlain]);

function surfArea(g: THREE.BufferGeometry, pick: (s: number) => boolean): number {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const srf = g.getAttribute('surf') as THREE.BufferAttribute;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area = 0;
  for (let i = 0; i < pos.count; i += 3) {
    if (!pick(Math.round(srf.getX(i)))) continue;
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return area;
}

describe('building LOD proxies', () => {
  const buildingIds = registeredModelIds().filter((id) => {
    const g = MANIFEST_BY_ID[id]?.group;
    return g !== undefined && g !== 'prop' && g !== 'nature' && g !== 'vehicle' && !id.startsWith('construction_site');
  });

  it('are generated for nearly every building variant, cheap, inside the model bounds and keep lit windows', () => {
    let total = 0, withProxy = 0, windowed = 0, windowedKept = 0;
    const tooBig: string[] = [];
    for (const id of buildingIds) {
      const nv = MANIFEST_BY_ID[id].variants ?? 1;
      for (let v = 0; v < nv; v++) {
        const g = getModelGeometry(id, v);
        const full = g.getAttribute('position').count / 3;
        const p = buildLodProxy(g);
        total++;
        if (!p) continue;
        const tris = p.getAttribute('position').count / 3;
        // BuildingRenderer only uses a proxy that is at most half the full model
        if (tris <= full * 0.5) withProxy++;
        if (tris > 200) tooBig.push(`${id}#${v}: ${tris}`);
        g.computeBoundingBox();
        p.computeBoundingBox();
        const gb = g.boundingBox!.clone().expandByScalar(0.6);
        expect(gb.containsBox(p.boundingBox!), `${id}#${v} proxy inside model bounds`).toBe(true);
        // models with a real window facade keep window surfaces (day windows, night lights)
        const wa = surfArea(g, (s) => WINDOWED.has(s));
        const fa = surfArea(g, (s) => s !== Surf.Foliage && s !== Surf.Pavement && s !== Surf.Water && s !== Surf.Field);
        if (wa > 40 && wa > fa * 0.08) {
          windowed++;
          if (surfArea(p, (s) => WINDOWED.has(s)) > 0) windowedKept++;
        }
      }
    }
    expect(total).toBeGreaterThan(300);
    expect(withProxy / total).toBeGreaterThan(0.9);
    expect(tooBig).toEqual([]);
    expect(windowed).toBeGreaterThan(50);
    expect(windowedKept / windowed).toBeGreaterThan(0.95);
  }, 180_000); // builds every building model + proxy (~5 s of CPU)

  it('is deterministic', () => {
    for (const id of buildingIds.slice(0, 25)) {
      const g = getModelGeometry(id, 0);
      const a = buildLodProxy(g), b = buildLodProxy(g);
      expect(a === null, id).toBe(b === null);
      if (!a || !b) continue;
      for (const name of ['position', 'color', 'surf']) {
        expect(Array.from(a.getAttribute(name).array), `${id} ${name}`).toEqual(Array.from(b.getAttribute(name).array));
      }
    }
  }, 60_000);
});

// ---------------------------------------------------------------- per-pass draw lists
function boxGeo(size: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  g.translate(0, size / 2, 0);
  return g;
}

/** run one pass of the batch for `camera` and return the drawn instance ids */
function drawn(batch: DynamicBatch, camera: THREE.Camera, shadow = false, frame = 1): number[] {
  camera.updateMatrixWorld();
  const renderer = { info: { render: { frame } } } as unknown as THREE.WebGLRenderer;
  (batch as unknown as { beforePass: (...a: unknown[]) => void }).beforePass(renderer, camera, batch.mesh.geometry, batch.mesh.material, shadow);
  const m = batch.mesh as unknown as { _multiDrawCount: number; _indirectTexture: THREE.DataTexture };
  const ids = m._indirectTexture.image.data as unknown as Uint32Array;
  return Array.from(ids.subarray(0, m._multiDrawCount)).sort((x, y) => x - y);
}

function shadowCam(cascade: number, texel: number): THREE.OrthographicCamera {
  const c = new THREE.OrthographicCamera(-1500, 1500, 1500, -1500, 1, 4000);
  c.position.set(800, 2000, 800);
  c.up.set(0, 0, 1);
  c.lookAt(800, 0, 800);
  c.updateProjectionMatrix();
  c.userData.cascade = cascade;
  c.userData.texel = texel;
  return c;
}

describe('DynamicBatch per-pass culling', () => {
  const N = 128, CELL = 16; // 2 km map, 8 x 8 tiles
  const setup = () => {
    const culler = new TileCuller(N, CELL, 16);
    const batch = new DynamicBatch(new THREE.MeshBasicMaterial(), 64, 1 << 14, 'test');
    batch.mesh.castShadow = true;
    batch.enablePassCulling({ culler, minShadowTexels: 1.2 });
    const big = batch.geometryId('big', () => boxGeo(20));
    const tiny = batch.geometryId('tiny', () => boxGeo(0.5));
    const m = new THREE.Matrix4();
    const place = (geo: number, x: number, z: number) => {
      const id = batch.add(geo);
      batch.setMatrix(id, m.makeTranslation(x, 0, z));
      batch.setTile(id, culler.tileOfWorld(x, z));
      return id;
    };
    const a = place(big, 100, 100);   // in view
    const b = place(big, 1900, 1900); // far corner, beyond the view's far plane
    const c = place(tiny, 120, 120);  // tiny caster next to a
    return { batch, a, b, c };
  };
  const viewCam = () => {
    const cam = new THREE.PerspectiveCamera(40, 16 / 9, 1, 1200);
    cam.position.set(-150, 200, -150);
    cam.lookAt(150, 0, 150);
    return cam;
  };

  it('draws only the instances inside each pass frustum', () => {
    const { batch, a, b, c } = setup();
    expect(drawn(batch, viewCam())).toEqual([a, c]);
    // the shadow camera sees the whole map: everything that is big enough for its texel
    expect(drawn(batch, shadowCam(0, 0.2), true)).toEqual([a, b, c]);
  });

  it('skips casters smaller than minShadowTexels and honours per-instance cascade masks', () => {
    const { batch, a, b, c } = setup();
    // 0.5 m box: bounding radius 0.43 m < 1.2 texels * 2 m / 2 -> skipped in a coarse cascade
    expect(drawn(batch, shadowCam(1, 2), true)).toEqual([a, b]);
    batch.setShadowCascades(b, 0b01);
    expect(drawn(batch, shadowCam(1, 2), true, 2)).toEqual([a]);
    expect(drawn(batch, shadowCam(0, 0.2), true, 3)).toEqual([a, b, c]);
    void c;
  });

  it('culls casters whose shadow cannot reach the receiver volume and rebuilds when it changes', () => {
    const { batch, a, b, c } = setup();
    const view = viewCam();
    view.updateMatrixWorld();
    const cam = shadowCam(0, 0.2);
    const recv = makeReceiver();
    cam.userData.recv = recv;
    const sun = new THREE.Vector3(0.3, 1, 0.2).normalize();
    setReceiver(recv, view, 1, 800, sun, 0);
    // the far-corner building is behind the view: its shadow cannot fall into the visible slice
    expect(drawn(batch, cam, true)).toEqual([a, c]);
    // the view turns around (receiver changes, the shadow camera does not): the cached list must be rebuilt
    view.position.set(2150, 200, 2150);
    view.lookAt(1850, 0, 1850);
    view.updateMatrixWorld();
    setReceiver(recv, view, 1, 800, sun, 0);
    expect(drawn(batch, cam, true, 2)).toEqual([b]);
  });
});

describe('shadow receiver versions', () => {
  it('bump only when the volume changes', () => {
    const cam = new THREE.PerspectiveCamera(40, 1.5, 1, 5000);
    cam.position.set(0, 300, 0);
    cam.lookAt(200, 0, 200);
    cam.updateMatrixWorld();
    const r = makeReceiver();
    const sun = new THREE.Vector3(0.2, 1, 0.1).normalize();
    setReceiver(r, cam, 1, 600, sun, -10);
    const v0 = r.version;
    setReceiver(r, cam, 1, 600, sun, -10);
    expect(r.version).toBe(v0);
    cam.lookAt(210, 0, 200);
    cam.updateMatrixWorld();
    setReceiver(r, cam, 1, 600, sun, -10);
    expect(r.version).toBe(v0 + 1);
  });
});
