/**
 * Rendering LOD / culling invariants (pure JS, no WebGL context):
 *  - building massing proxies: generated for (nearly) every building model, much cheaper, inside the model's bounds,
 *    windowed models keep window surfaces (lit at night), deterministic
 *  - DynamicBatch per-pass draw lists: view frustum culling, per-instance shadow cascade masks, tiny-caster skipping,
 *    receiver-volume culling and list caching, disabled tiles / tile sets, front-to-back sorting, guard-banded list
 *    reuse while the camera pans (exact again once it rests), LOD geometry swaps without re-culling
 *  - building LOD scheduled by camera travel: never on the wrong side of a swap distance (after a camera cut the
 *    downgrades may trail by a few catch-up frames, upgrades never), no work while still; cut frames stay cheap
 *  - building LOD cross-fade: swaps in view dissolve over fadeTime (complementary levels in the fade layer, empty
 *    stand-in in the batch), reverse mid-fade, instant on cuts / flushes / off-screen
 *  - burnt multi-cell lots are tiled one rubble tile per cell; hill lots get real-size stone skirts
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
import { getCityMaterial } from '../../src/render/city/common/cityMaterial';
import { makeReceiver, receiverSweepSphere, setReceiver } from '../../src/render/world/Shadows';
import { BuildingRenderer } from '../../src/render/city/buildings/BuildingRenderer';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { BF, type Building } from '../../src/sim/CityState';
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

  it('keeps the foliage season patterns of lot trees (blossom / seasonal / evergreen) in the foliage clusters', () => {
    const seen = new Set<number>();
    for (const id of buildingIds.filter((m) => m.startsWith('park_') || m.startsWith('res_'))) {
      const nv = MANIFEST_BY_ID[id].variants ?? 1;
      for (let v = 0; v < nv; v++) {
        const g = getModelGeometry(id, v);
        const p = buildLodProxy(g);
        if (!p) continue;
        const pats = (geo: THREE.BufferGeometry) => {
          const s = geo.getAttribute('surf') as THREE.BufferAttribute, out = new Set<number>();
          for (let i = 0; i < s.count; i++) if (Math.round(s.getX(i)) === Surf.Foliage) out.add(Math.round(s.getY(i)));
          return out;
        };
        const model = pats(g);
        for (const pt of pats(p)) {
          expect(model.has(pt), `${id}#${v}: proxy foliage pattern ${pt} not in the model`).toBe(true);
          seen.add(pt);
        }
      }
    }
    // cherry (2), deciduous (1) and evergreen (4) crowns all survive in some proxy
    for (const pt of [1, 2, 4]) expect(seen.has(pt), `pattern ${pt}`).toBe(true);
  }, 120_000);

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

  it('never misses an instance while the view turns, orbits, zooms and pans (angular + translation bands)', () => {
    const { culler, batch, build } = make();
    batch.mesh.castShadow = true;
    const geos = [2, 6, 14, 30].map((sz) => batch.geometryId('g' + sz, () => boxGeo(sz)));
    const m = new THREE.Matrix4();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 700; i++) {
      const x = rnd() * 2048, z = rnd() * 2048;
      const id = batch.add(geos[i % 4]);
      batch.setMatrix(id, m.makeTranslation(x, 0, z));
      batch.setTile(id, culler.tileOfWorld(x, z));
    }
    const sph = (batch as unknown as { sph: Float32Array }).sph;
    const view = new THREE.PerspectiveCamera(38, 16 / 9, 1, 9000);
    const sunCam = shadowCam(0, 0.5);
    sunCam.left = sunCam.bottom = -1600; sunCam.right = sunCam.top = 1600;
    sunCam.position.set(1024, 2500, 1024); sunCam.lookAt(1024, 0, 1024); sunCam.updateProjectionMatrix();
    const recv = makeReceiver();
    sunCam.userData.recv = recv;
    const sun = new THREE.Vector3(0.35, 1, 0.25).normalize();
    const f = new THREE.Frustum(), pm = new THREE.Matrix4(), S = new THREE.Sphere();
    /** instances in the exact pass volume that the list lacks */
    const misses = (cam: THREE.Camera, list: Set<number>, withRecv: boolean) => {
      f.setFromProjectionMatrix(pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const out: number[] = [];
      for (let id = 0; id < 700; id++) {
        const x = sph[id * 4], y = sph[id * 4 + 1], z = sph[id * 4 + 2], r = sph[id * 4 + 3];
        S.center.set(x, y, z); S.radius = r;
        if (f.intersectsSphere(S) && (!withRecv || receiverSweepSphere(recv, x, y, z, r)) && !list.has(id)) out.push(id);
      }
      return out;
    };
    // target / distance / yaw / pitch camera like the game's; segments: slow turn, fast orbit, zoom out + in, pan, rest
    const tgt = new THREE.Vector3(1024, 0, 1024);
    let dist = 700, yaw = 0.4, pitch = 0.75, frame = 1, builds0 = 0, slowFrames = 0, slowBuilds = 0;
    for (let step = 0; step < 480; step++) {
      const seg = Math.floor(step / 60);
      if (seg === 0) yaw += 0.004; // ~0.23 deg / frame
      else if (seg === 1) yaw += 0.03;
      else if (seg === 2) dist *= 1.012;
      else if (seg === 3) { dist /= 1.012; pitch -= 0.002; }
      else if (seg === 4) { tgt.x += 3; tgt.z -= 2; yaw += 0.002; }
      else if (seg === 5) { yaw += 0.001 * Math.sin(step); pitch += 0.0008; }
      else if (seg === 6) { yaw += 0.012; dist *= 0.997; }
      view.position.set(tgt.x + Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, tgt.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      view.near = THREE.MathUtils.clamp(dist * 0.01, 0.5, 60);
      view.far = dist * 6 + 3000;
      view.updateProjectionMatrix();
      view.lookAt(tgt);
      view.updateMatrixWorld();
      setReceiver(recv, view, view.near, Math.min(view.far, dist * 2.5), sun, 0);
      const b0 = build.mock.calls.length;
      const main = new Set(drawn(batch, view, false, frame));
      const shadow = new Set(drawn(batch, sunCam, true, frame));
      frame++;
      expect(misses(view, main, false), `step ${step}: view`).toEqual([]);
      expect(misses(sunCam, shadow, true), `step ${step}: shadow`).toEqual([]);
      if (seg === 0 && step > 5) { slowFrames++; slowBuilds += build.mock.calls.length - b0; }
      if (step === 0) builds0 = build.mock.calls.length;
    }
    // a slow turn reuses its lists over several frames (both passes)
    expect(slowBuilds / slowFrames).toBeLessThan(1);
    expect(build.mock.calls.length).toBeGreaterThan(builds0);
  }, 60_000);
});

describe('building LOD schedule', () => {
  it('keeps every building on the right side of its swap distance (downgrades may trail a cut briefly) and does no work while the camera rests', () => {
    const st = createCityState(defaultCityConfig({ size: 64, seed: 7, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
    st.heights.fill(0);
    const culler = new TileCuller(64, CELL_SIZE, 16);
    const br = new BuildingRenderer(st, culler);
    br.lodBudgetMs = 1e9; // proxies are built on demand without a frame budget here
    // a small per-frame evaluation slice (the city has fewer buildings than the default 3000): smooth motion stays
    // within it; camera jumps upgrade at once (flat scan) and catch up the rest at lodCatch evaluations per frame
    br.lodSlice = 100;
    br.lodCatch = 40;
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
    const dist = (bi: BI) => Math.hypot(bi.vis.cx - cam.position.x, bi.cy - cam.position.y, bi.vis.cz - cam.position.z);
    const hasProxy = (bi: BI) => !(bi.lodGeom === bi.geom && bi.siteLod === bi.siteGeom);
    const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere();
    const inView = (bi: BI) => { sph.center.set(bi.vis.cx, bi.cy, bi.vis.cz); sph.radius = bi.radius; return fr.intersectsSphere(sph); };
    // allowed lag: one schedule bucket (1 m) of camera travel. up: a proxy in view that must be full (never allowed);
    // upOut: the same out of view, down: a full model that may be a proxy (both allowed while the renderer catches up
    // after a cut)
    const check = () => {
      fr.setFromProjectionMatrix(pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      let up = 0, upOut = 0, down = 0;
      for (const bi of list) {
        if (!hasProxy(bi)) continue;
        const d = dist(bi), rk = bi.radius * K;
        if (bi.lod === 0 && d > rk / on + 1.001) down++;
        if (bi.lod === 1 && d < rk / off - 1.001) { if (inView(bi)) up++; else upOut++; }
      }
      return { up, upOut, down };
    };
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const p = new THREE.Vector3(512, 60, -200);
    let slowEvals = 0, slowSteps = 0, maxProxies = 0, cuts = 0, cutLagSeen = 0, maxCutExtra = 0;
    for (let step = 0; step < 600; step++) {
      const mode = Math.floor(step / 50) % 4; // slow pan, fast pan, zoom, jumps
      const cut = mode === 3 && step % 10 === 0;
      if (mode === 0) p.x += 3;
      else if (mode === 1) { p.x -= 45; p.z += 30; }
      else if (mode === 2) p.y = 40 + (step % 50) * 25;
      else if (cut) p.set(rnd() * 3000 - 1000, 20 + rnd() * 900, rnd() * 3000 - 1000);
      cam.position.copy(p);
      // (looking at the map centre from wherever the camera is: every mode sees part of the city)
      cam.lookAt(512, 0, 512);
      cam.updateMatrixWorld();
      // proxies the cut must upgrade in its own frame (the ones in view)
      let need = 0;
      if (cut) {
        fr.setFromProjectionMatrix(pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        for (const bi of list) if (bi.lod === 1 && hasProxy(bi) && dist(bi) < (bi.radius * K) / off && inView(bi)) need++;
      }
      const e0 = evals.mock.calls.length;
      br.updateLod(cam, H);
      const n = evals.mock.calls.length - e0;
      if (mode === 0 && step % 50 > 5) { slowEvals += n; slowSteps++; }
      const { up, upOut, down } = check();
      expect(up, `step ${step}: proxy in view left inside its upgrade distance`).toBe(0);
      if (!br.lodBehind) {
        expect(upOut, `step ${step}: proxy out of view left inside its upgrade distance`).toBe(0);
        expect(down, `step ${step}: full model beyond its downgrade distance`).toBe(0);
      }
      if (cut && step > 0) {
        cuts++;
        // the cut frame evaluates its upgrades + a quarter catch-up slice, not the whole city
        maxCutExtra = Math.max(maxCutExtra, n - need);
        if (down > 0) cutLagSeen++;
      }
      maxProxies = Math.max(maxProxies, br.lodCount);
    }
    expect(cuts).toBeGreaterThan(10);
    // (whole schedule buckets are evaluated: a few more than the slice)
    expect(maxCutExtra).toBeLessThan((br.lodCatch >> 2) + 16);
    expect(maxCutExtra).toBeLessThan(list.length * 0.1);
    // (with a 40-evaluation catch-up slice some downgrades do trail the cuts)
    expect(cutLagSeen).toBeGreaterThan(0);
    expect(br.lodCount).toBe(list.filter((b) => b.lod === 1).length);
    expect(maxProxies).toBeGreaterThan(list.length * 0.3);
    // a slow pan re-evaluates a small fraction of the buildings per frame
    expect(slowEvals / slowSteps).toBeLessThan(list.length * 0.1);
    // after the last cut the camera rests: the catch-up finishes within backlog / lodCatch frames, then no lag at all
    let frames = 0;
    while (br.lodBehind && frames < 100) { br.updateLod(cam, H); frames++; }
    expect(frames).toBeLessThanOrEqual(Math.ceil(list.length / br.lodCatch) + 2);
    expect(check()).toEqual({ up: 0, upOut: 0, down: 0 });
    // a resting camera costs nothing
    const e1 = evals.mock.calls.length;
    for (let i = 0; i < 20; i++) br.updateLod(cam, H);
    expect(evals.mock.calls.length).toBe(e1);
  }, 120_000);
});

describe('building LOD cross-fade', () => {
  type Slots = { n: number; geo: Int32Array; casts: Uint8Array; mesh: THREE.BatchedMesh };
  type BI = { lod: number; main: number; geom: number; lodGeom: number; radius: number; cy: number; vis: { cx: number; cz: number } };
  const setup = () => {
    const st = createCityState(defaultCityConfig({ size: 64, seed: 3, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
    st.heights.fill(0);
    const br = new BuildingRenderer(st, new TileCuller(64, CELL_SIZE, 16));
    br.lodBudgetMs = 1e9;
    br.add({ id: 1, def: 'res_apartment', x: 30, z: 30, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 0 } as unknown as Building, false);
    const bi = (br as unknown as { list: BI[] }).list[0];
    const layer = (br as unknown as { fadeLayer: Slots }).fadeLayer;
    const info = (br.batch.mesh as unknown as { _instanceInfo: { geometryIndex: number }[] })._instanceInfo;
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 20000);
    const H = 720, K = (H / Math.tan((45 * Math.PI) / 360)) / 2;
    const dOn = (bi.radius * K) / (br.lodPixels * 0.88), dOff = (bi.radius * K) / (br.lodPixels * 1.12);
    const dir = new THREE.Vector3(-1, 0.7, -1).normalize();
    const target = new THREE.Vector3(bi.vis.cx, bi.cy, bi.vis.cz);
    /** camera at distance d from the building, looking at it (away = looking the other way) */
    const at = (d: number, away = false) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(away ? cam.position.clone().addScaledVector(dir, 10) : target);
      cam.updateMatrixWorld();
      br.updateLod(cam, H);
    };
    /** move smoothly (<= 5 m per frame) to distance d */
    const glide = (d: number, away = false) => {
      let cur = cam.position.distanceTo(target);
      while (Math.abs(cur - d) > 1e-6) { cur += Math.max(-5, Math.min(5, d - cur)); at(cur, away); }
    };
    // decoded fade code of a slot: [fading in, t]
    const code = (s: number): [boolean, number] => {
      const a = ((layer.mesh as unknown as { _colorsTexture: THREE.DataTexture })._colorsTexture.image.data as Float32Array)[s * 4 + 3];
      const x = (1 - a) * 16, o = x - Math.round(x);
      return o > 0.23 ? [false, (o - 0.24) / 0.2] : [true, (o - 0.02) / 0.2];
    };
    return { br, bi, layer, info, dOn, dOff, at, glide, code };
  };

  it('dissolves a swap in view over fadeTime with complementary levels, and runs back when the level flips mid-fade', () => {
    const { br, bi, layer, info, dOn, dOff, at, glide, code } = setup();
    // time-driven progress only (the glides below move the camera between the explicit update() steps)
    br.fadeTravel = 0;
    expect(bi.lodGeom).toBeGreaterThanOrEqual(-1);
    at(dOn * 0.5);
    br.update(1);
    expect(bi.lod).toBe(0);
    expect(br.fading).toBe(0);
    // zoom out across the downgrade distance
    glide(dOn + 20);
    expect(bi.lod).toBe(1);
    expect(bi.lodGeom).not.toBe(bi.geom);
    expect(br.fading).toBe(1);
    // the building's own instance draws the 3-vertex empty stand-in; the layer draws old (fading out) + new (in)
    expect(br.batch.triangles(info[bi.main].geometryIndex)).toBe(1);
    expect(layer.n).toBe(2);
    const slots = [0, 1];
    const old = slots.find((s) => !code(s)[0])!, neu = slots.find((s) => code(s)[0])!;
    expect(layer.geo[old]).toBe(bi.geom);
    expect(layer.geo[neu]).toBe(bi.lodGeom);
    // one level casts the shadow: the old one until half way (the proxy's coarser roof must not streak the model's)
    expect(layer.casts[old]).toBe(1);
    expect(layer.casts[neu]).toBe(0);
    // the fade material takes the city material's scalars right before it draws (no stale sky light in a first frame)
    const city = getCityMaterial(), fm = layer.mesh.material as THREE.MeshStandardMaterial, e0 = city.envMapIntensity;
    city.envMapIntensity = e0 + 0.37;
    const fakeRenderer = { getRenderTarget: () => null, getDrawingBufferSize: (v: THREE.Vector2) => v.set(1280, 720) };
    layer.mesh.onBeforeRender(fakeRenderer as unknown as THREE.WebGLRenderer, null!, null!, null!, null!, null!);
    expect(fm.envMapIntensity).toBeCloseTo(e0 + 0.37, 6);
    city.envMapIntensity = e0;
    // half way: both codes carry the same (eased) threshold, so the dither keeps complementary pixel sets
    br.update(br.fadeTime / 2);
    expect(code(old)[1]).toBeCloseTo(0.5, 3);
    expect(code(neu)[1]).toBeCloseTo(0.5, 3);
    // ... from there on the new level casts
    expect(layer.casts[neu]).toBe(1);
    expect(layer.casts[old]).toBe(0);
    // zoom back in across the upgrade distance: the fade reverses (the old level fades back in) from where it is
    glide(dOff - 20);
    expect(bi.lod).toBe(0);
    expect(br.fading).toBe(1);
    const back = [0, 1].find((s) => code(s)[0])!;
    expect(layer.geo[back]).toBe(bi.geom);
    expect(code(back)[1]).toBeCloseTo(0.5, 3);
    br.update(br.fadeTime * 0.25);
    expect(br.fading).toBe(1);
    br.update(br.fadeTime * 0.3);
    // done: the instance draws the full model again, the layer is empty
    expect(br.fading).toBe(0);
    expect(layer.n).toBe(0);
    expect(info[bi.main].geometryIndex).toBe(bi.geom);
  });

  it('swaps at once on camera cuts, off-screen, for sub-threshold specks and on flushLod', () => {
    const { br, bi, layer, info, dOn, dOff, at, glide } = setup();
    at(dOn * 0.5);
    // a cut far out: instant downgrade (the whole view changed anyway)
    at(dOn * 6);
    expect(bi.lod).toBe(1);
    expect(br.fading).toBe(0);
    expect(info[bi.main].geometryIndex).toBe(bi.lodGeom);
    // a cut back in: the upgrade is instant and happens in the cut frame itself
    at(dOff * 0.3);
    expect(bi.lod).toBe(0);
    expect(br.fading).toBe(0);
    expect(info[bi.main].geometryIndex).toBe(bi.geom);
    // looking away while crossing the swap distance: no fade
    glide(dOn * 0.9, true);
    glide(dOn + 20, true);
    expect(bi.lod).toBe(1);
    expect(br.fading).toBe(0);
    // fading while in view, then a capture flush: settled at once
    glide(dOff * 0.9);
    glide(dOff - 20);
    expect(bi.lod).toBe(0);
    expect(br.fading).toBe(1);
    br.flushLod();
    expect(br.fading).toBe(0);
    expect(layer.n).toBe(0);
    expect(info[bi.main].geometryIndex).toBe(bi.geom);
    // a sub-threshold speck (swap forced while far beyond the fade size, e.g. after a proxy arrives) is instant
    br.fadeMinFrac = 2;
    glide(dOn + 20);
    expect(bi.lod).toBe(1);
    expect(br.fading).toBe(0);
    // removing a fading building drops its fade
    br.fadeMinFrac = 0.4;
    glide(dOff - 20);
    expect(br.fading).toBe(1);
    br.remove(1);
    expect(br.fading).toBe(0);
    expect(layer.n).toBe(0);
  });

  it('settles running fades at a cut, and the downgrades trailing a cut swap at once (no fade burst after cuts)', () => {
    const { br, bi, layer, info, dOn, dOff, at, glide } = setup();
    // a row of neighbours (same model) in view of the camera; a tiny catch-up slice so downgrades trail the cut
    for (let k = 0; k < 12; k++) {
      br.add({ id: 10 + k, def: 'res_apartment', x: 26 + 2 * (k % 6), z: 26 + 8 * Math.floor(k / 6), w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 0 } as unknown as Building, false);
    }
    br.lodCatch = 4;
    type L = { lod: number; b: { id: number }; fade: unknown };
    const all = (br as unknown as { list: L[] }).list;
    at(dOn * 0.5);
    expect(all.every((x) => x.lod === 0)).toBe(true);
    // a fade in progress, then a cut back in: the fade is settled in the cut frame (upgrade applied at once)
    glide(dOn + 20);
    expect(br.fading).toBeGreaterThan(0);
    at(dOff * 0.3);
    expect(br.fading).toBe(0);
    expect(layer.n).toBe(0);
    expect(bi.lod).toBe(0);
    expect(info[bi.main].geometryIndex).toBe(bi.geom);
    // a cut far out: the cut frame downgrades a quarter slice, the rest trails over the next frames without fading
    at(dOn * 1.4);
    expect(br.lodBehind).toBe(true);
    const trailing = all.filter((x) => x.lod === 0).length;
    expect(trailing).toBeGreaterThan(4);
    let frames = 0;
    while (br.lodBehind && frames < 20) {
      at(dOn * 1.4);
      frames++;
      expect(br.fading).toBe(0);
      expect(all.every((x) => x.fade === null)).toBe(true);
    }
    expect(frames).toBeGreaterThan(1);
    expect(all.every((x) => x.lod === 1)).toBe(true);
    // caught up: the next smooth swap fades again
    glide(dOff * 0.9);
    expect(br.fading).toBeGreaterThan(0);
  });

  it('completes a fade with the camera travel in fast motion, over fadeTime in slow motion', () => {
    const { br, bi, dOn, dOff, at, glide } = setup();
    type F = { p: number } | null;
    const fadeP = () => ((bi as unknown as { fade: F }).fade?.p ?? -1);
    at(dOn * 0.5);
    br.update(1);
    glide(dOn * 0.9);
    // fast zoom out, 4% farther per frame (street -> far in ~90 frames), frame loop order: camera, update, LOD
    let d = dOn * 0.9, started = -1, done = -1;
    const ps: number[] = [];
    for (let k = 0; k < 60 && done < 0; k++) {
      d *= 1.04;
      at(d);
      br.update(1 / 60);
      if (started < 0 && bi.lod === 1) started = k;
      if (started >= 0) {
        if (br.fading === 0) done = k;
        else ps.push(fadeP());
      }
    }
    expect(started).toBeGreaterThanOrEqual(0);
    // ~fadeTravel / ln(1.04) = 3 frames (fadeTime alone: 21 frames at 60 fps), still a dissolve, not a pop
    expect(done - started).toBeGreaterThanOrEqual(2);
    expect(done - started).toBeLessThanOrEqual(5);
    expect(ps.some((p) => p > 0.2 && p < 0.8)).toBe(true);
    // slow zoom back in (0.2% per frame) across the upgrade distance: the dissolve takes ~fadeTime
    glide(dOff * 1.03);
    d = dOff * 1.03;
    started = done = -1;
    for (let k = 0; k < 200 && done < 0; k++) {
      d = Math.max(dOff * 0.5, d / 1.002);
      at(d);
      br.update(1 / 60);
      if (started < 0 && bi.lod === 0) started = k;
      if (started >= 0 && br.fading === 0) done = k;
    }
    expect(started).toBeGreaterThanOrEqual(0);
    const frames = done - started, ideal = br.fadeTime * 60;
    expect(frames).toBeGreaterThan(ideal * 0.8);
    expect(frames).toBeLessThan(ideal * 1.2);
  });

  it('wakes the buildings waiting for an arriving proxy a few per frame, each dissolving (no swap spike), none in a cut frame', () => {
    const run = (opts: { slice: number; fadeMax?: number; cut?: boolean }) => {
      const st = createCityState(defaultCityConfig({ size: 64, seed: 3, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
      st.heights.fill(0);
      const br = new BuildingRenderer(st, new TileCuller(64, CELL_SIZE, 16));
      // worker stand-in: proxies arrive only when the test delivers them
      const asked: { geo: THREE.BufferGeometry; done: (g: THREE.BufferGeometry | null) => void }[] = [];
      (br as unknown as { proxies: unknown }).proxies = { available: true, request: (_k: string, geo: THREE.BufferGeometry, done: (g: THREE.BufferGeometry | null) => void) => asked.push({ geo, done }) };
      br.lodWakeSlice = opts.slice;
      if (opts.fadeMax) br.fadeMax = opts.fadeMax;
      // 150 buildings sharing one model
      let id = 1;
      for (let j = 0; j < 10; j++) for (let i = 0; i < 15; i++) br.add({ id: id++, def: 'res_apartment', x: 8 + i * 3, z: 12 + j * 3, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 0 } as unknown as Building, false);
      type L = { lod: number; waiting: number; radius: number };
      const all = (br as unknown as { list: L[] }).list;
      const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 30000);
      const H = 720, K = (H / Math.tan((45 * Math.PI) / 360)) / 2;
      const r = all[0].radius, dOn = (r * K) / (br.lodPixels * 0.88);
      // far enough for every building to want its proxy, near enough for the swaps to fade (> fadeMinFrac x lodPixels)
      const centre = new THREE.Vector3(30 * CELL_SIZE, 0, 27 * CELL_SIZE);
      let dir = new THREE.Vector3(0.3, 1, 0.5).normalize();
      let d = dOn * 1.3;
      const at = (dd: number) => { cam.position.copy(centre).addScaledVector(dir, dd); cam.lookAt(centre); cam.updateMatrixWorld(); br.update(1 / 60); br.updateLod(cam, H); };
      at(d);
      // nothing built yet: every building waits on its full model
      expect(all.every((b) => b.lod === 0 && b.waiting >= 0)).toBe(true);
      expect(br.lodCount).toBe(0);
      for (const a of asked) a.done(buildLodProxy(a.geo));
      let maxStep = 0, maxFades = 0, frames = 0, prev = br.lodCount;
      if (opts.cut) {
        // a camera cut (~2 km sideways, same distance) right after the arrival: the cut frame wakes nobody
        dir = new THREE.Vector3(-dir.z, dir.y, dir.x);
        at(d);
        expect(br.lodCount).toBe(0);
      }
      while (br.lodCount < all.length && frames < 400) {
        d += 1; // smooth creep
        at(d);
        frames++;
        maxStep = Math.max(maxStep, br.lodCount - prev);
        maxFades = Math.max(maxFades, br.fading);
        prev = br.lodCount;
      }
      expect(br.lodCount).toBe(all.length);
      return { maxStep, maxFades, frames };
    };
    // paced by the slice, every wake dissolves
    const a = run({ slice: 16 });
    expect(a.maxStep).toBeLessThanOrEqual(16);
    expect(a.frames).toBeGreaterThanOrEqual(Math.ceil(150 / 16));
    expect(a.maxFades).toBeGreaterThan(16);
    // ... and by the running fades: at most fadeMax / 2 of them from wakes
    const b = run({ slice: 64, fadeMax: 24 });
    expect(b.maxFades).toBeLessThanOrEqual(12);
    expect(b.maxFades).toBeGreaterThan(0);
    expect(b.frames).toBeGreaterThan(40);
    // a cut right after the arrival: nobody woken in the cut frame, paced wakes after it
    const c = run({ slice: 16, cut: true });
    expect(c.maxStep).toBeLessThanOrEqual(16);
    expect(c.frames).toBeGreaterThanOrEqual(Math.ceil(150 / 16));
  });
});

describe('burnt lots and foundations', () => {
  const setup = () => {
    const st = createCityState(defaultCityConfig({ size: 64, seed: 5, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
    st.heights.fill(0);
    const br = new BuildingRenderer(st, new TileCuller(64, CELL_SIZE, 16));
    br.lodBudgetMs = 1e9;
    const geo = (br.batch as unknown as { geo: Map<string, number> }).geo;
    const info = (br.batch.mesh as unknown as { _instanceInfo: { geometryIndex: number }[] })._instanceInfo;
    return { st, br, geo, info };
  };
  type BI = { main: number; cells: number[]; found: number };

  it('tiles a burnt multi-cell lot with one unstretched rubble tile per cell (hashed variant + quarter turn)', () => {
    const { br, geo, info } = setup();
    br.add({ id: 7, def: 'res_apartment', x: 10, z: 12, w: 3, d: 3, rot: 1, variant: 0, built: 1, flags: BF.Burnt, baseY: 0 } as unknown as Building, false);
    br.add({ id: 8, def: 'res_cottage', x: 20, z: 20, w: 1, d: 1, rot: 0, variant: 0, built: 1, flags: BF.Burnt, baseY: 0 } as unknown as Building, false);
    const [lot, one] = (br as unknown as { list: BI[] }).list;
    const rubble = new Set([0, 1, 2, 3].map((v) => geo.get(`rubble#${v}`)).filter((g) => g !== undefined));
    expect(lot.cells.length).toBe(8);
    const m = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler();
    const cells = new Set<string>(), variants = new Set<number>(), turns = new Set<number>();
    for (const id of [lot.main, ...lot.cells]) {
      const g = info[id].geometryIndex;
      expect(rubble.has(g)).toBe(true);
      variants.add(g);
      br.batch.mesh.getMatrixAt(id, m);
      m.decompose(pos, q, sc);
      expect(sc.x).toBeCloseTo(1, 5);
      expect(sc.y).toBeCloseTo(1, 5);
      expect(sc.z).toBeCloseTo(1, 5);
      const cx = Math.floor(pos.x / CELL_SIZE), cz = Math.floor(pos.z / CELL_SIZE);
      expect(pos.x).toBeCloseTo((cx + 0.5) * CELL_SIZE, 4);
      expect(pos.z).toBeCloseTo((cz + 0.5) * CELL_SIZE, 4);
      expect(cx >= 10 && cx < 13 && cz >= 12 && cz < 15).toBe(true);
      cells.add(`${cx},${cz}`);
      e.setFromQuaternion(q, 'YXZ');
      turns.add(((Math.round(e.y / (Math.PI / 2)) % 4) + 4) % 4);
      // a tile's broken walls (its -X / -Z sides) face the outside on the lot's edge cells
      const wall = new THREE.Vector3(-1, 0, -1).applyQuaternion(q), i = cx - 10, j = cz - 12;
      if (i === 0) expect(wall.x).toBeLessThan(0);
      if (i === 2) expect(wall.x).toBeGreaterThan(0);
      if (j === 0) expect(wall.z).toBeLessThan(0);
      if (j === 2) expect(wall.z).toBeGreaterThan(0);
    }
    // every footprint cell exactly once, not all alike
    expect(cells.size).toBe(9);
    expect(variants.size).toBeGreaterThan(1);
    expect(turns.size).toBeGreaterThan(1);
    // a 1x1 lot keeps its single (slightly inset) rubble model
    expect(one.cells.length).toBe(0);
    expect(rubble.has(info[one.main].geometryIndex)).toBe(true);
    // rebuilding / removing frees the tiles
    const live0 = br.batch.instanceCount;
    br.remove(7);
    expect(br.batch.instanceCount).toBe(live0 - 9);
  });

  it('puts real-size (unscaled) stone retaining-wall skirts under lots above the terrain, stepped when deep', () => {
    const { st, br, geo, info } = setup();
    const N1 = st.size + 1;
    // a slope rising 1.5 m per cell along x
    for (let z = 0; z <= st.size; z++) for (let x = 0; x <= st.size; x++) st.heights[z * N1 + x] = x * 1.5;
    // lots flattened to their highest corner: 2 cells wide -> 3 m above the low edge; a flat one: no skirt
    br.add({ id: 1, def: 'res_cottage', x: 20, z: 10, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 22 * 1.5 } as unknown as Building, false);
    br.add({ id: 2, def: 'res_cottage', x: 30, z: 10, w: 1, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 30 * 1.5 + 0.5 } as unknown as Building, false);
    br.add({ id: 3, def: 'res_cottage', x: 40, z: 10, w: 1, d: 1, rot: 0, variant: 0, built: 1, flags: 0, baseY: 40 * 1.5 } as unknown as Building, false);
    const [deep, shallow, flat] = (br as unknown as { list: BI[] }).list;
    expect(flat.found).toBe(-1);
    // 3 m + 0.8 m into the ground -> the 4.8 m (two-tier) skirt at the lot's real size; 0.5 + 0.8 m -> the 2.2 m one
    const gDeep = geo.get('__foundation:32x32:4.8'), gShallow = geo.get('__foundation:16x32:2.2');
    expect(gDeep).toBeDefined();
    expect(gShallow).toBeDefined();
    expect(info[deep.found].geometryIndex).toBe(gDeep);
    expect(info[shallow.found].geometryIndex).toBe(gShallow);
    const m = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    br.batch.mesh.getMatrixAt(deep.found, m);
    m.decompose(pos, q, sc);
    expect([sc.x, sc.y, sc.z].map((v) => +v.toFixed(5))).toEqual([1, 1, 1]);
    const bb = br.batch.bounds(gDeep!);
    expect(bb.min.y).toBeCloseTo(-4.8, 5);
    expect(bb.max.y).toBeCloseTo(0, 5);
    // the lower tier steps out 0.45 m beyond the lot edge inset
    expect(bb.max.x).toBeCloseTo(16 - 0.1 + 0.45, 4);
    const sb = br.batch.bounds(gShallow!);
    expect(sb.min.y).toBeCloseTo(-2.2, 5);
    expect(sb.max.x).toBeCloseTo(8 - 0.1 + 0.04, 4);
    expect(sb.max.z).toBeCloseTo(16 - 0.1 + 0.04, 4);
  });

  it('lays rubble tiles on ground that rises above the lot base (vertical shear, walls upright, culled whole)', () => {
    const { st, br } = setup();
    const N1 = st.size + 1;
    // ground rising 1.5 m per cell along x plus a twist along z; the lot keeps the height of its low corner (the sim
    // could not level the up-slope side), so its far side is 4.5 m + under the ground
    const ground = (x: number, z: number) => (x / CELL_SIZE) * 1.5 + ((x / CELL_SIZE) * (z / CELL_SIZE)) * 0.05;
    for (let z = 0; z <= st.size; z++) for (let x = 0; x <= st.size; x++) st.heights[z * N1 + x] = ground(x * CELL_SIZE, z * CELL_SIZE);
    const lot = { id: 9, def: 'res_apartment', x: 20, z: 10, w: 3, d: 2, rot: 0, variant: 0, built: 1, flags: BF.Burnt, baseY: ground(20 * CELL_SIZE, 10 * CELL_SIZE) };
    br.add(lot as unknown as Building, false);
    const [bi] = (br as unknown as { list: (BI & { vis: { top: number } })[] }).list;
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    let worst = 0, topMax = -Infinity;
    for (const id of [bi.main, ...bi.cells]) {
      br.batch.mesh.getMatrixAt(id, m);
      // upright: the local y axis stays world up (a shear, not a tilt)
      const e = m.elements;
      expect([e[4], e[5], e[6]].map((v) => +v.toFixed(6))).toEqual([0, 1, 0]);
      // the bed's top (0.4 m over the tile origin, prop.ts) lies 0.4 m over the ground at its corners and centre: never
      // under it (no grass through the debris), never floating
      for (const [lx, lz] of [[-8, -8], [8, -8], [-8, 8], [8, 8], [0, 0]]) {
        p.set(lx, 0.4, lz).applyMatrix4(m);
        const gap = p.y - ground(p.x, p.z);
        expect(gap).toBeGreaterThan(0.02);
        worst = Math.max(worst, gap);
      }
      p.set(0, 4, 0).applyMatrix4(m);
      topMax = Math.max(topMax, p.y);
      // the batch's culling sphere holds every corner of the sheared tile
      const s = (br.batch as unknown as { sph: Float32Array }).sph, o = id * 4;
      for (const [lx, ly, lz] of [[-8, -0.5, -8], [8, -0.5, 8], [8, 4, -8], [-8, 4, 8], [8, 4, 8]]) {
        p.set(lx, ly, lz).applyMatrix4(m);
        expect(Math.hypot(p.x - s[o], p.y - s[o + 1], p.z - s[o + 2])).toBeLessThanOrEqual(s[o + 3]);
      }
    }
    expect(worst).toBeLessThan(0.5);
    // picking / tile culling see the raised debris
    expect(bi.vis.top).toBeGreaterThanOrEqual(topMax - 0.5);
  });

  it('keeps a rubble bed within its skirt of the ground where one lot corner is raised (no plane fits: no gap under the bed, less grass than a level bed)', () => {
    const { st, br } = setup();
    const N1 = st.size + 1;
    // level ground at 0 with ONE vertex raised 3.9 m: cell (30, 20) gets it as its (+x, +z) corner (a triangle apex),
    // cell (30, 21) as its (+x, -z) corner (on the triangle diagonal)
    st.heights.fill(0);
    st.heights[21 * N1 + 31] = 3.9;
    br.add({ id: 11, def: 'res_apartment', x: 30, z: 20, w: 1, d: 2, rot: 0, variant: 0, built: 1, flags: BF.Burnt, baseY: 0 } as unknown as Building, false);
    // and a lot on a uniform slope next to it still follows the slope
    for (let z = 0; z <= st.size; z++) for (let x = 40; x <= st.size; x++) st.heights[z * N1 + x] = (x - 40) * 1.2;
    br.add({ id: 12, def: 'res_apartment', x: 41, z: 20, w: 2, d: 1, rot: 0, variant: 0, built: 1, flags: BF.Burnt, baseY: 1.2 } as unknown as Building, false);
    const [twisted, sloped] = (br as unknown as { list: (BI & { shear: number[] })[] }).list;
    const hAt = (wx: number, wz: number) => {
      // the rendered triangulation (TerrainRenderer.meshHeightAt)
      const fx = wx / CELL_SIZE, fz = wz / CELL_SIZE, x = Math.min(st.size - 1, Math.floor(fx)), z = Math.min(st.size - 1, Math.floor(fz));
      const tx = fx - x, tz = fz - z, i = z * N1 + x, H = st.heights;
      const a = H[i], b = H[i + 1], c = H[i + N1], d = H[i + N1 + 1];
      return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
    };
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const underside = (id: number) => {
      br.batch.mesh.getMatrixAt(id, m);
      return [[-8, -8], [8, -8], [-8, 8], [8, 8]].map(([lx, lz]) => { p.set(lx, 0, lz).applyMatrix4(m); return [p.y, hAt(p.x, p.z)]; });
    };
    // the twisted lot's tiles float at most 0.45 m over the ground at any corner (the bed's closed sides reach 0.5 m
    // under the tile origin, prop.ts: nothing shows under the bed) and never sink more than 0.2 m under the base
    expect(twisted.shear.length).toBe(6);
    for (const id of [twisted.main, ...twisted.cells]) {
      for (const [y, g] of underside(id)) {
        expect(y).toBeLessThanOrEqual(g + 0.45 + 1e-6);
        expect(y).toBeGreaterThan(-0.2 - 1e-6);
      }
    }
    // ... and leave less of the hill over the debris floor (0.4 m over the tile origin) than a level bed on the base
    const poke = (floor: (wx: number, wz: number) => number, cx: number, cz: number) => {
      let n = 0;
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
        const wx = (cx + i / 8) * CELL_SIZE, wz = (cz + j / 8) * CELL_SIZE;
        if (hAt(wx, wz) > floor(wx, wz) + 0.05) n++;
      }
      return n;
    };
    let pokeNow = 0, pokeLevel = 0;
    for (const [k, id] of [twisted.main, ...twisted.cells].entries()) {
      br.batch.mesh.getMatrixAt(id, m);
      const e = m.elements, cx = 30, cz = 20 + k;
      // floor height at (wx, wz): the matrix's world-vertical shear (e[1], e[9] of the sheared upright tile) + origin
      const floor = (wx: number, wz: number) => e[13] + e[1] * 0 + (wx - e[12]) * twisted.shear[k * 3] + (wz - e[14]) * twisted.shear[k * 3 + 1] + 0.4;
      pokeNow += poke(floor, cx, cz);
      pokeLevel += poke(() => 0.4, cx, cz);
    }
    expect(pokeLevel).toBeGreaterThan(0);
    expect(pokeNow).toBeLessThan(pokeLevel);
    // the sloped lot's tiles lie on the slope: underside on the ground at every corner
    for (const id of [sloped.main, ...sloped.cells]) {
      for (const [y, g] of underside(id)) expect(Math.abs(y - g)).toBeLessThan(1e-4);
    }
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

describe('street prop LOD', () => {
  it('switches proxies per prop at the right distance, disables tiles only once all their props are thinned out', async () => {
    const { PropRenderer } = await import('../../src/render/city/props/PropRenderer');
    const culler = new TileCuller(128, CELL_SIZE, 16);
    const pr = new PropRenderer(culler);
    pr.lodDistance = 1300;
    pr.lodFull = 520;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const models = ['streetlight', 'traffic_light', 'tree_oak', 'tree_maple'];
    const items = Array.from({ length: 2400 }, (_, i) => ({ model: i % 97 === 0 ? 'util_power_pylon' : models[i % 4], variant: i % 3, x: rnd() * 2040 + 4, y: 0, z: rnd() * 2040 + 4, yaw: rnd() * 6, scale: 1 }));
    pr.setGroup('t', items);
    type P = { ist: Uint8Array; ipos: Float32Array; igeo: Int32Array; near: Uint8Array; T: number };
    const pp = pr as unknown as P;
    const withProxy = () => { const out: number[] = []; for (let id = 0; id < pp.ist.length; id++) if (pp.ist[id]) out.push(id); return out; };
    const tileOf = (pr.batch as unknown as { instTile: Int32Array }).instTile;
    expect(withProxy().length).toBeGreaterThan(1500);
    expect(pr.pylons.instanceCount).toBe(items.filter((p) => p.model === 'util_power_pylon').length);
    const info = (pr.batch.mesh as unknown as { _instanceInfo: { geometryIndex: number }[] })._instanceInfo;
    const cam = new THREE.Vector3(1024, 300, -400);
    const full = 520, hide = 1300;
    let maxChanges = 0, slowChanges = 0, sawProxy = 0, sawOff = 0;
    const prev = new Map<number, number>();
    for (let step = 0; step < 400; step++) {
      const mode = Math.floor(step / 50) % 4;
      if (mode === 0) cam.x += 3;
      else if (mode === 1) { cam.z += 40; cam.x -= 25; }
      else if (mode === 2) cam.y = 60 + (step % 50) * 30;
      else if (step % 10 === 0) cam.set(rnd() * 3000 - 500, 40 + rnd() * 1200, rnd() * 3000 - 500);
      pr.updateLod(cam);
      let bad = 0, changes = 0;
      const ids = withProxy();
      // prop metric: horizontal distance with the camera height weighted by 0.8 (squared)
      const metric = (id: number) => Math.sqrt((pp.ipos[id * 3] - cam.x) ** 2 + (pp.ipos[id * 3 + 2] - cam.z) ** 2 + 0.8 * cam.y * cam.y);
      for (const id of ids) {
        const g0 = pp.igeo[id * 2], g1 = pp.igeo[id * 2 + 1];
        const d = metric(id);
        const st = pp.ist[id];
        // one schedule bucket (1 m) of lag allowed
        if (st === 2 && d > full * 1.06 + 1.001) bad++;
        if (st === 1 && d < full * 0.94 - 1.001) bad++;
        if (info[id].geometryIndex !== (st === 2 ? g0 : g1)) bad++;
        if (prev.get(id) !== undefined && prev.get(id) !== st) changes++;
        prev.set(id, st);
      }
      expect(bad, `step ${step}`).toBe(0);
      if (mode === 0 && step % 50 > 2) { maxChanges = Math.max(maxChanges, changes); slowChanges += changes; }
      for (const id of ids) if (pp.ist[id] === 1) { sawProxy++; break; }
      if (pp.near.includes(0)) sawOff++;
      // a disabled tile holds no prop the thinning band would still show
      for (const id of ids) {
        const t = tileOf[id] % pp.T;
        if (pp.near[t]) continue;
        expect(metric(id), `step ${step}: tile ${t}`).toBeGreaterThan(hide * 1.35);
      }
    }
    // a slow pan switches a handful of props per frame, never a tile-sized burst
    expect(slowChanges).toBeGreaterThan(0);
    expect(maxChanges).toBeLessThan(40);
    expect(sawProxy).toBeGreaterThan(100);
    expect(sawOff).toBeGreaterThan(50);
  }, 120_000);
});
