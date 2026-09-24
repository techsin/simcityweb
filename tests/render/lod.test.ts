/**
 * Rendering LOD / culling invariants (pure JS, no WebGL context):
 *  - building massing proxies: generated for (nearly) every building model, much cheaper, inside the model's bounds,
 *    windowed models keep window surfaces (lit at night), deterministic
 *  - DynamicBatch per-pass draw lists: view frustum culling, per-instance shadow cascade masks, tiny-caster skipping,
 *    receiver-volume culling and list caching, disabled tiles / tile sets, front-to-back sorting, guard-banded list
 *    reuse while the camera pans (exact again once it rests), LOD geometry swaps without re-culling
 *  - building LOD scheduled by camera travel: never on the wrong side of a swap distance, no work while still
 *  - shadow receivers only bump their version when the volume really changes
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { getModelGeometry, registeredModelIds } from '../../src/assets/registry';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { Surf } from '../../src/core/types';
import { buildLodProxy } from '../../src/render/city/buildings/lodProxy';
import { DynamicBatch, TileCuller } from '../../src/render/city/common/batch';
import { makeReceiver, setReceiver } from '../../src/render/world/Shadows';
import { BuildingRenderer } from '../../src/render/city/buildings/BuildingRenderer';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import type { Building } from '../../src/sim/CityState';
import { CELL_SIZE } from '../../src/core/constants';

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

  it('skips disabled tiles and tile sets without casters for the cascade', () => {
    const culler = new TileCuller(N, CELL, 16);
    const T = culler.tiles * culler.tiles;
    const batch = new DynamicBatch(new THREE.MeshBasicMaterial(), 64, 1 << 14, 'sets');
    batch.mesh.castShadow = true;
    batch.enablePassCulling({ culler, tileSets: 2 });
    const g = batch.geometryId('big', () => boxGeo(20));
    const m = new THREE.Matrix4();
    const tile = culler.tileOfWorld(100, 100);
    const a = batch.add(g);
    batch.setMatrix(a, m.makeTranslation(100, 0, 100));
    batch.setTile(a, tile);
    // second set of the same map tile: casts into cascade 0 only
    const d = batch.add(g);
    batch.setMatrix(d, m.makeTranslation(140, 0, 100));
    batch.setShadowCascades(d, 0b01);
    batch.setTile(d, tile + T);
    expect(drawn(batch, viewCam())).toEqual([a, d]);
    expect(drawn(batch, shadowCam(1, 0.5), true, 2)).toEqual([a]);
    batch.setTileEnabled(tile, false);
    expect(drawn(batch, viewCam(), false, 3)).toEqual([d]);
    batch.setTileEnabled(tile, true);
    expect(drawn(batch, viewCam(), false, 4)).toEqual([a, d]);
  });

  it('sorts main-pass lists nearest first when sortFront is set', () => {
    const culler = new TileCuller(N, CELL, 16);
    const batch = new DynamicBatch(new THREE.MeshBasicMaterial(), 64, 1 << 14, 'sorted');
    batch.enablePassCulling({ culler });
    batch.sortFront = true;
    const g = batch.geometryId('big', () => boxGeo(8));
    const m = new THREE.Matrix4();
    // added far to near along the view direction
    const ids = [560, 420, 300, 200, 120, 60].map((d) => {
      const id = batch.add(g);
      batch.setMatrix(id, m.makeTranslation(d, 0, d));
      batch.setTile(id, culler.tileOfWorld(d, d));
      return id;
    });
    const cam = viewCam();
    cam.updateMatrixWorld();
    drawn(batch, cam);
    const mm = batch.mesh as unknown as { _multiDrawCount: number; _indirectTexture: THREE.DataTexture };
    const order = Array.from((mm._indirectTexture.image.data as unknown as Uint32Array).subarray(0, mm._multiDrawCount));
    expect(order).toEqual([...ids].reverse());
  });
});

describe('DynamicBatch list reuse', () => {
  const N = 128, CELL = 16;
  const make = () => {
    const culler = new TileCuller(N, CELL, 16);
    const batch = new DynamicBatch(new THREE.MeshBasicMaterial(), 64, 1 << 14, 'reuse');
    batch.enablePassCulling({ culler });
    return { culler, batch, build: vi.spyOn(batch as unknown as { build: () => void }, 'build') };
  };
  // looks from (-150, 200, -150) toward (150, 0, 150): ~470 m to the ground -> guard band ~28 m
  const cam = new THREE.PerspectiveCamera(40, 16 / 9, 1, 1200);
  const look = (dx: number) => {
    cam.position.set(-150 + dx, 200, -150 - dx);
    cam.lookAt(150 + dx, 0, 150 - dx);
    cam.updateMatrixWorld();
  };

  it('reuses a list while the camera pans within the guard band and culls exactly once the view rests', () => {
    const { culler, batch, build } = make();
    const g = batch.geometryId('b', () => boxGeo(4));
    const m = new THREE.Matrix4();
    // an instance just outside the left edge of the view (within the band) and one well inside
    look(0);
    const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const put = (x: number, z: number) => {
      const id = batch.add(g);
      batch.setMatrix(id, m.makeTranslation(x, 0, z));
      batch.setTile(id, culler.tileOfWorld(x, z));
      return id;
    };
    const inside = put(300, 300);
    // walk from the view centre line sideways until just outside the frustum, then 12 m further (the box's culling
    // sphere reaches ~3.5 m back toward the frustum)
    const dir = new THREE.Vector3(1, 0, -1).normalize(), p = new THREE.Vector3(300, 0, 300);
    while (f.containsPoint(p)) p.addScaledVector(dir, 1);
    p.addScaledVector(dir, 12);
    const edge = put(p.x, p.z);
    let frame = 1;
    expect(drawn(batch, cam, false, frame++)).toEqual([inside]); // first list: exact
    // panning away from `edge` at ~4.2 m per frame: culled with a guard band of ~4 frames of motion (~17 m), which
    // still covers the edge instance
    look(-3);
    expect(drawn(batch, cam, false, frame++)).toEqual([inside, edge]);
    const builds = build.mock.calls.length;
    for (const x of [-6, -9, -12]) {
      look(x);
      expect(drawn(batch, cam, false, frame++)).toEqual([inside, edge]);
    }
    expect(build.mock.calls.length).toBe(builds); // ~13 m of panning: no rebuild
    // at rest the list is culled exactly once (no guard band drawn while nothing moves)
    for (let i = 0; i < 12; i++) drawn(batch, cam, false, frame++);
    expect(drawn(batch, cam, false, frame++)).toEqual([inside]);
    expect(build.mock.calls.length).toBe(builds + 1);
    // a jump far beyond any band: rebuilt exactly (a band the camera outruns would only enlarge the list)
    look(-80);
    expect(drawn(batch, cam, false, frame++)).toEqual([inside]);
    expect(build.mock.calls.length).toBe(builds + 2);
    expect((batch as unknown as { slots: { margin: number }[] }).slots[0].margin).toBe(0);
  });

  it('refreshes draw ranges on LOD geometry swaps without re-culling', () => {
    const { culler, batch, build } = make();
    const full = batch.geometryId('full', () => boxGeo(10));
    const proxy = batch.geometryId('proxy', () => boxGeo(6));
    const huge = batch.geometryId('huge', () => boxGeo(60));
    batch.shareSphere(full, proxy);
    const id = batch.add(full);
    batch.setMatrix(id, new THREE.Matrix4().makeTranslation(300, 0, 300));
    batch.setTile(id, culler.tileOfWorld(300, 300));
    look(0);
    expect(drawn(batch, cam, false, 1)).toEqual([id]);
    const n0 = build.mock.calls.length;
    const mm = batch.mesh as unknown as { _multiDrawStarts: Int32Array; _multiDrawCounts: Int32Array; _geometryInfo: { start: number; count: number }[] };
    batch.setGeometry(id, proxy);
    expect(drawn(batch, cam, false, 2)).toEqual([id]);
    expect(build.mock.calls.length).toBe(n0);
    expect(mm._multiDrawStarts[0]).toBe(mm._geometryInfo[proxy].start);
    expect(mm._multiDrawCounts[0]).toBe(mm._geometryInfo[proxy].count);
    batch.setGeometry(id, full);
    drawn(batch, cam, false, 3);
    expect(build.mock.calls.length).toBe(n0);
    expect(mm._multiDrawCounts[0]).toBe(mm._geometryInfo[full].count);
    // a geometry that outgrows the culling sphere re-culls
    batch.setGeometry(id, huge);
    drawn(batch, cam, false, 4);
    expect(build.mock.calls.length).toBe(n0 + 1);
  });
});

describe('building LOD schedule', () => {
  it('keeps every building on the right side of its swap distance and does no work while the camera rests', () => {
    const st = createCityState(defaultCityConfig({ size: 64, seed: 7, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
    st.heights.fill(0);
    const culler = new TileCuller(64, CELL_SIZE, 16);
    const br = new BuildingRenderer(st, culler);
    br.lodBudgetMs = 1e9; // proxies are built on demand without a frame budget here
    const models = ['res_cottage', 'res_ranch', 'res_apartment', 'res_tower', 'com_office_small', 'com_diner', 'com_office_tower', 'ind_warehouse'].filter((m) => MANIFEST_BY_ID[m]);
    expect(models.length).toBeGreaterThan(3);
    let id = 1;
    for (let z = 0; z < 62; z += 3) for (let x = 0; x < 62; x += 3) {
      br.add({ id: id++, def: models[(x * 7 + z * 3) % models.length], x, z, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 0 } as unknown as Building, false);
    }
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 8000);
    const H = 720, K = (H / Math.tan((45 * Math.PI) / 360)) / 2;
    const on = br.lodPixels * 0.88, off = br.lodPixels * 1.12;
    type BI = { lod: number; geom: number; lodGeom: number; siteGeom: number; siteLod: number; radius: number; cy: number; vis: { cx: number; cz: number } };
    const list = (br as unknown as { list: BI[] }).list;
    const evals = vi.spyOn(br as unknown as { lodEval: () => void }, 'lodEval');
    const check = () => {
      let bad = 0;
      for (const bi of list) {
        if (bi.lodGeom === bi.geom && bi.siteLod === bi.siteGeom) continue;
        const d = Math.hypot(bi.vis.cx - cam.position.x, bi.cy - cam.position.y, bi.vis.cz - cam.position.z);
        const rk = bi.radius * K;
        // allowed lag: one schedule bucket (1 m) of camera travel
        if (bi.lod === 0 && d > rk / on + 1.001) bad++;
        if (bi.lod === 1 && d < rk / off - 1.001) bad++;
      }
      return bad;
    };
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const p = new THREE.Vector3(512, 60, -200);
    let slowEvals = 0, slowSteps = 0, maxProxies = 0;
    for (let step = 0; step < 600; step++) {
      const mode = Math.floor(step / 50) % 4; // slow pan, fast pan, zoom, jumps
      if (mode === 0) p.x += 3;
      else if (mode === 1) { p.x -= 45; p.z += 30; }
      else if (mode === 2) p.y = 40 + (step % 50) * 25;
      else if (step % 10 === 0) p.set(rnd() * 3000 - 1000, 20 + rnd() * 900, rnd() * 3000 - 1000);
      cam.position.copy(p);
      cam.updateMatrixWorld();
      const e0 = evals.mock.calls.length;
      br.updateLod(cam, H);
      if (mode === 0 && step % 50 > 5) { slowEvals += evals.mock.calls.length - e0; slowSteps++; }
      expect(check(), `step ${step}`).toBe(0);
      maxProxies = Math.max(maxProxies, br.lodCount);
    }
    expect(br.lodCount).toBe(list.filter((b) => b.lod === 1).length);
    expect(maxProxies).toBeGreaterThan(list.length * 0.3);
    // a slow pan re-evaluates a small fraction of the buildings per frame
    expect(slowEvals / slowSteps).toBeLessThan(list.length * 0.1);
    // a resting camera costs nothing
    const e1 = evals.mock.calls.length;
    for (let i = 0; i < 20; i++) br.updateLod(cam, H);
    expect(evals.mock.calls.length).toBe(e1);
  }, 120_000);
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
    // a pure translation changes the volume but not its shape (guard-banded caster lists stay valid)
    const s0 = r.shape;
    cam.position.x += 5;
    cam.updateMatrixWorld();
    setReceiver(r, cam, 1, 600, sun, -10);
    expect(r.version).toBe(v0 + 2);
    expect(r.shape).toBe(s0);
    cam.lookAt(260, 0, 200);
    cam.updateMatrixWorld();
    setReceiver(r, cam, 1, 600, sun, -10);
    expect(r.shape).toBe(s0 + 1);
  });
});
