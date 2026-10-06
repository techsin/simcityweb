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
 *    stand-in in the batch), reverse mid-fade, instant on cuts / flushes / off-screen; a zoom-out's dissolve is over by
 *    the instant-swap distance; fast pans / orbits swap at once (motion cap); the fade program compiles after the first
 *    frame, asynchronously
 *  - burnt multi-cell lots are composed from the rubble kit (one bed over the lot, following rising ground exactly;
 *    debris pieces off the cell grid with low-poly proxies); hill lots get real-size stone skirts, a plain box far away
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
    // (the fade program counts as compiled: no renderer here, see 'compiles the fade program ...')
    br.fadeReady = true;
    br.add({ id: 1, def: 'res_apartment', x: 30, z: 30, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 0 } as unknown as Building, false);
    const bi = (br as unknown as { list: BI[] }).list[0];
    const layer = (br as unknown as { fadeLayer: Slots }).fadeLayer;
    const info = (br.batch.mesh as unknown as { _instanceInfo: { geometryIndex: number }[] })._instanceInfo;
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 20000);
    const H = 720, K = (H / Math.tan((45 * Math.PI) / 360)) / 2;
    // downgrade distance while swaps may fade (the dissolve starts at fadeOn x lodPixels), upgrade distance (1.12 x)
    const dOn = (bi.radius * K) / (br.lodPixels * br.fadeOn), dOff = (bi.radius * K) / (br.lodPixels * 1.12);
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

  it('swaps at once when the motion would finish the dissolve within a frame or two (fast fly-by), dissolves otherwise', () => {
    const { br, bi, dOn, at, glide } = setup();
    // (the camera is ~0.45 dOn high here: every step below is far under the cut distance, i.e. smooth motion)
    const flyBy = () => {
      at(dOn * 0.5);
      glide(dOn * 0.94);
      // one frame carrying the building 12% farther (fadeTravel x 1): the dissolve would be over at once
      at(dOn * 1.06);
      expect(bi.lod).toBe(1);
    };
    flyBy();
    expect(br.fading).toBe(0);
    // the same crossing at 2% per frame dissolves
    at(dOn * 0.5);
    glide(dOn * 0.97);
    for (const f of [0.99, 1.01, 1.03]) at(dOn * f);
    expect(bi.lod).toBe(1);
    expect(br.fading).toBe(1);
    br.flushLod();
    // fadeFast 0: even the fast crossing dissolves (over the travel-driven frames)
    br.fadeFast = 0;
    flyBy();
    expect(br.fading).toBe(1);
  });

  it('wakes the buildings waiting for an arriving proxy a few per frame, each dissolving (no swap spike), none in a cut frame', () => {
    const run = (opts: { slice: number; fadeMax?: number; cut?: boolean }) => {
      const st = createCityState(defaultCityConfig({ size: 64, seed: 3, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
      st.heights.fill(0);
      const br = new BuildingRenderer(st, new TileCuller(64, CELL_SIZE, 16));
      br.fadeReady = true;
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

  it('starts a downgrade dissolve at fadeOn x lodPixels and has it over by the instant-swap distance in a zoom-out', () => {
    const { br, bi, dOn, at, glide } = setup();
    // the instant swap's distance (0.88 x lodPixels): a zoom-out never draws the full model beyond it
    const dInstant = (dOn * br.fadeOn) / 0.88;
    for (const rate of [1.002, 1.01, 1.03]) {
      at(dOn * 0.5);
      br.update(1);
      glide(dOn * 0.97);
      let d = dOn * 0.97, started = -1, over = -1;
      // frame loop order: camera, update, LOD
      for (let k = 0; k < 400 && over < 0; k++) {
        d *= rate;
        at(d);
        br.update(1 / 60);
        if (started < 0 && bi.lod === 1) started = d;
        if (started > 0 && br.fading === 0) over = d;
      }
      expect(started / dOn).toBeLessThan(rate + 1e-6);
      expect(over).toBeGreaterThan(started);
      expect(over).toBeLessThan(dInstant * rate * 1.02);
    }
  });

  it('caps the concurrent fades by the view motion: a slow orbit dissolves its swaps, a fast one swaps at once', () => {
    const { br, bi, dOn } = setup();
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 20000);
    // orbiting a point 0.2 dOn beside the building: its distance swings across both swap distances every revolution
    const C = new THREE.Vector3(bi.vis.cx + dOn * 0.2, 0, bi.vis.cz);
    let a = 0;
    const orbit = (deg: number, frames: number) => {
      let swaps = 0, faded = 0, lod = bi.lod;
      for (let i = 0; i < frames; i++) {
        a += (deg * Math.PI) / 180;
        cam.position.set(C.x + Math.cos(a) * dOn * 0.95, dOn * 0.3, C.z + Math.sin(a) * dOn * 0.95);
        cam.lookAt(C);
        cam.updateMatrixWorld();
        br.updateLod(cam, 720);
        if (bi.lod !== lod) { swaps++; if (br.fading > 0) faded++; lod = bi.lod; }
        br.update(1 / 60);
      }
      return { swaps, faded };
    };
    // (the building's first level is applied at once)
    orbit(0.25, 4);
    // 0.25 deg / frame (15 deg/s): every swap dissolves
    const slow = orbit(0.25, 1440);
    expect(slow.swaps).toBeGreaterThanOrEqual(2);
    expect(slow.faded).toBe(slow.swaps);
    // 4 deg / frame (240 deg/s): the view changes wholesale, every swap is instant
    br.flushLod();
    const fast = orbit(4, 180);
    expect(fast.swaps).toBeGreaterThanOrEqual(2);
    expect(fast.faded).toBe(0);
  });

  it('compiles the fade program asynchronously after the first frame that drew the buildings (not at load), fading only from then on', async () => {
    const st = createCityState(defaultCityConfig({ size: 64, seed: 3, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
    st.heights.fill(0);
    const br = new BuildingRenderer(st, new TileCuller(64, CELL_SIZE, 16));
    br.lodBudgetMs = 1e9;
    br.add({ id: 1, def: 'res_apartment', x: 30, z: 30, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 0 } as unknown as Building, false);
    type L = { lod: number; radius: number; cy: number; vis: { cx: number; cz: number } };
    const bi = (br as unknown as { list: L[] }).list[0];
    const layer = (br as unknown as { fadeLayer: { mesh: THREE.BatchedMesh } }).fadeLayer;
    // not in the scene graph: the load-time precompile (PostFX.compileScene) does not compile it
    expect(layer.mesh.parent).toBe(null);
    expect(br.fadeReady).toBe(false);
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 20000);
    const H = 720, K = (H / Math.tan((45 * Math.PI) / 360)) / 2;
    const dOn = (bi.radius * K) / (br.lodPixels * br.fadeOn);
    const target = new THREE.Vector3(bi.vis.cx, bi.cy, bi.vis.cz), dir = new THREE.Vector3(-1, 0.7, -1).normalize();
    const at = (d: number) => { cam.position.copy(target).addScaledVector(dir, d); cam.lookAt(target); cam.updateMatrixWorld(); br.updateLod(cam, H); };
    const glide = (from: number, to: number) => { for (let d = from; Math.abs(d - to) > 1e-6; d += Math.max(-5, Math.min(5, to - d))) at(d); at(to); };
    // before any frame: swaps are instant
    glide(dOn * 0.5, dOn * 1.1);
    expect(bi.lod).toBe(1);
    expect(br.fading).toBe(0);
    // the first scene pass that draws the building batch (inside the post-processing scene target)
    const sceneRT = new THREE.WebGLRenderTarget(4, 4);
    let bound: THREE.WebGLRenderTarget | null = sceneRT;
    const calls: [THREE.Object3D, THREE.WebGLRenderTarget | null, THREE.Object3D][] = [];
    let release = () => {};
    const renderer = {
      info: { render: { frame: 1 } },
      getRenderTarget: () => bound,
      setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { bound = t; },
      compileAsync: (obj: THREE.Object3D, _c: THREE.Camera, scene: THREE.Object3D) => { calls.push([obj, bound, scene]); return new Promise((r) => { release = () => r(obj); }); },
    };
    const scene = new THREE.Scene();
    scene.add(br.batch.mesh);
    br.batch.mesh.onBeforeRender(renderer as unknown as THREE.WebGLRenderer, scene, cam, br.batch.mesh.geometry, br.batch.mesh.material as THREE.Material, null as unknown as THREE.Group);
    bound = null;
    // no compile inside the render itself; the next update starts it with the scene target bound, then restores
    expect(calls.length).toBe(0);
    at(dOn * 1.1);
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe(layer.mesh);
    expect(calls[0][1]).toBe(sceneRT);
    expect(calls[0][2]).toBe(scene);
    expect(bound).toBe(null);
    expect(layer.mesh.parent).toBe(br.batch.mesh);
    // still compiling: instant swaps
    glide(dOn * 1.1, dOn * 0.5);
    expect(bi.lod).toBe(0);
    expect(br.fading).toBe(0);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(br.fadeReady).toBe(true);
    // ready: the next swap in view dissolves; later frames never compile again
    glide(dOn * 0.5, dOn * 1.05);
    expect(bi.lod).toBe(1);
    expect(br.fading).toBe(1);
    br.batch.mesh.onBeforeRender(renderer as unknown as THREE.WebGLRenderer, scene, cam, br.batch.mesh.geometry, br.batch.mesh.material as THREE.Material, null as unknown as THREE.Group);
    at(dOn * 1.05);
    expect(calls.length).toBe(1);
  });
});

describe('burnt lots and foundations', () => {
  const setup = () => {
    const st = createCityState(defaultCityConfig({ size: 64, seed: 5, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
    st.heights.fill(0);
    const br = new BuildingRenderer(st, new TileCuller(64, CELL_SIZE, 16));
    br.lodBudgetMs = 1e9;
    const geo = (br.batch as unknown as { geo: Map<string, number> }).geo;
    const keyOf = (g: number) => [...geo].find(([, id]) => id === g)?.[0] ?? '';
    const info = (br.batch.mesh as unknown as { _instanceInfo: { geometryIndex: number }[] })._instanceInfo;
    const mask = (id: number) => (br.batch as unknown as { instMask: Uint8Array }).instMask[id];
    return { st, br, geo, keyOf, info, mask };
  };
  type BI = { b: Building; main: number; cells: number[]; kitGeo: number[]; kitLod: number[]; found: number; lod: number; flod: number; foundGeom: number; foundLod: number; vis: { top: number; cx: number; cz: number } };
  const N1 = 65;
  /** the rendered terrain triangulation (TerrainRenderer.meshHeightAt) */
  const groundAt = (H: Float32Array, wx: number, wz: number) => {
    const fx = wx / CELL_SIZE, fz = wz / CELL_SIZE, x = Math.min(63, Math.floor(fx)), z = Math.min(63, Math.floor(fz));
    const tx = fx - x, tz = fz - z, i = z * N1 + x;
    const a = H[i], b = H[i + 1], c = H[i + N1], d = H[i + N1 + 1];
    return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  };
  /** highest up-facing surface of geometry g (lot-local) at (x, z): the bed's top incl. its blots */
  const topAt = (g: THREE.BufferGeometry, x: number, z: number) => {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    let best = -Infinity;
    for (let i = 0; i < p.count; i += 3) {
      const ax = p.getX(i), az = p.getZ(i), bx = p.getX(i + 1), bz = p.getZ(i + 1), cx = p.getX(i + 2), cz = p.getZ(i + 2);
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      best = Math.max(best, l1 * p.getY(i) + l2 * p.getY(i + 1) + l3 * p.getY(i + 2));
    }
    return best;
  };
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler();

  it('composes a burnt multi-cell lot from the rubble kit: one bed over the whole lot, debris pieces off the cell grid', () => {
    const { br, keyOf, info, mask } = setup();
    const lots: [number, number, number, number, string][] = [
      [4, 4, 4, 4, 'com_office_tower'], [12, 4, 3, 3, 'res_apartment'], [20, 4, 4, 3, 'ind_warehouse'], [28, 4, 2, 1, 'res_townhouse_row'],
      [34, 4, 2, 2, 'res_ranch'], [4, 14, 4, 4, 'res_tenement'], [12, 14, 4, 4, 'com_office_block'], [20, 14, 3, 2, 'com_strip_mall'],
    ];
    let id = 100;
    for (const [x, z, w, d, def] of lots) br.add({ id: id++, def, x, z, w, d, rot: (x + z) % 4, variant: 0, built: 1, flags: BF.Burnt, baseY: 0 } as unknown as Building, false);
    // a one-cell lot keeps prop.ts's (slightly inset) rubble tile
    br.add({ id: 8, def: 'res_cottage', x: 40, z: 20, w: 1, d: 1, rot: 0, variant: 0, built: 1, flags: BF.Burnt, baseY: 0 } as unknown as Building, false);
    const list = (br as unknown as { list: BI[] }).list;
    let bigs = 0, offGrid = 0, oddYaw = 0, pieces = 0, walls = 0;
    const offsets = new Set<string>();
    for (const bi of list.slice(0, lots.length)) {
      const { x, z, w, d } = bi.b;
      // the bed: one geometry over the whole lot (no per-cell tiles, so no seams), at the lot origin, casting no shadow
      const bed = info[bi.main].geometryIndex;
      expect(keyOf(bed).startsWith(`__rubble:bed:${w}x${d}:`)).toBe(true);
      const bb = br.batch.bounds(bed);
      expect(bb.min.x).toBeCloseTo((-w * CELL_SIZE) / 2 + 0.02, 3);
      expect(bb.max.z).toBeCloseTo((d * CELL_SIZE) / 2 - 0.02, 3);
      expect(mask(bi.main)).toBe(0);
      br.batch.mesh.getMatrixAt(bi.main, m);
      m.decompose(pos, q, sc);
      expect([pos.x, pos.z]).toEqual([(x + w / 2) * CELL_SIZE, (z + d / 2) * CELL_SIZE]);
      expect(sc.x).toBeCloseTo(1, 6);
      // the pieces: inside the lot, at hashed offsets and any yaw (not one per cell, centred, a quarter turn apart)
      expect(bi.cells.length).toBeGreaterThan(w * d * 0.6);
      for (let k = 0; k < bi.cells.length; k++) {
        const key = keyOf(bi.kitGeo[k]);
        expect(key.startsWith('__rubble:')).toBe(true);
        expect(info[bi.cells[k]].geometryIndex).toBe(bi.kitGeo[k]);
        expect(keyOf(bi.kitLod[k]).startsWith(key)).toBe(true);
        expect(mask(bi.cells[k])).toBe(1);
        br.batch.mesh.getMatrixAt(bi.cells[k], m);
        m.decompose(pos, q, sc);
        expect(pos.x).toBeGreaterThan(x * CELL_SIZE);
        expect(pos.x).toBeLessThan((x + w) * CELL_SIZE);
        expect(pos.z).toBeGreaterThan(z * CELL_SIZE);
        expect(pos.z).toBeLessThan((z + d) * CELL_SIZE);
        const ox = pos.x / CELL_SIZE - Math.floor(pos.x / CELL_SIZE) - 0.5, oz = pos.z / CELL_SIZE - Math.floor(pos.z / CELL_SIZE) - 0.5;
        if (Math.hypot(ox, oz) * CELL_SIZE > 1) offGrid++;
        offsets.add(`${ox.toFixed(2)},${oz.toFixed(2)}`);
        e.setFromQuaternion(q, 'YXZ');
        const quarter = e.y / (Math.PI / 2);
        if (Math.abs(quarter - Math.round(quarter)) > 0.05) oddYaw++;
        if (key.startsWith('__rubble:big')) bigs++;
        if (key.startsWith('__rubble:w')) {
          walls++;
          // the burnt shell: wall stubs stand within 2.5 m of the lot's edge
          const edge = Math.min(pos.x - x * CELL_SIZE, (x + w) * CELL_SIZE - pos.x, pos.z - z * CELL_SIZE, (z + d) * CELL_SIZE - pos.z);
          expect(edge).toBeLessThan(2.5);
        }
        pieces++;
      }
      expect(bi.vis.top).toBeGreaterThan(1);
    }
    expect(offGrid / pieces).toBeGreaterThan(0.5);
    expect(offsets.size).toBeGreaterThan(pieces * 0.8);
    expect(oddYaw).toBeGreaterThan(pieces * 0.3);
    expect(walls).toBeGreaterThan(lots.length);
    // interior 2 x 2 blocks of the 4 x 4 lots collapse into one big heap (most of the time)
    expect(bigs).toBeGreaterThanOrEqual(2);
    // the one-cell lot keeps its rubble tile
    const one = list[lots.length];
    expect(one.cells.length).toBe(0);
    expect(keyOf(info[one.main].geometryIndex).startsWith('rubble#')).toBe(true);
    // rebuilding / removing frees every piece
    const live0 = br.batch.instanceCount, first = list[0];
    expect(first.b.id).toBe(100);
    const n0 = 1 + first.cells.length + (first.found >= 0 ? 1 : 0);
    br.remove(100);
    expect(br.batch.instanceCount).toBe(live0 - n0);
    expect(first.cells.length).toBe(0);
  });

  it('lays the debris bed over rising ground exactly (no grass through it, no steps between cells) and rests every piece on it', () => {
    const { st, br, info } = setup();
    // ground rising 1.5 m per cell along x plus a twist along z; the lot keeps the height of its low corner (the sim
    // could not level the up-slope side), so its far side lies 4.5 m+ under the ground
    const ground = (x: number, z: number) => (x / CELL_SIZE) * 1.5 + ((x / CELL_SIZE) * (z / CELL_SIZE)) * 0.05;
    for (let z = 0; z <= st.size; z++) for (let x = 0; x <= st.size; x++) st.heights[z * N1 + x] = ground(x * CELL_SIZE, z * CELL_SIZE);
    // ... and a level lot with ONE vertex raised 3.9 m (a twisted cell: no plane fits it)
    for (let z = 0; z <= st.size; z++) for (let x = 36; x <= st.size; x++) st.heights[z * N1 + x] = 60;
    st.heights[21 * N1 + 41] = 63.9;
    br.add({ id: 9, def: 'res_apartment', x: 20, z: 10, w: 3, d: 2, rot: 0, variant: 0, built: 1, flags: BF.Burnt, baseY: st.heights[10 * N1 + 20] } as unknown as Building, false);
    br.add({ id: 11, def: 'res_apartment', x: 40, z: 20, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: BF.Burnt, baseY: 60 } as unknown as Building, false);
    const list = (br as unknown as { list: BI[] }).list;
    for (const bi of list) {
      const b = bi.b, cx = (b.x + b.w / 2) * CELL_SIZE, cz = (b.z + b.d / 2) * CELL_SIZE;
      const bed = br.batch.mesh.geometry, g = info[bi.main].geometryIndex;
      // the bed's own geometry (lot-local), read back from the batch's vertex range
      const gi = (br.batch.mesh as unknown as { _geometryInfo: { vertexStart: number; vertexCount: number }[] })._geometryInfo[g];
      const src = new THREE.BufferGeometry();
      const pa = bed.getAttribute('position') as THREE.BufferAttribute;
      src.setAttribute('position', new THREE.BufferAttribute((pa.array as Float32Array).slice(gi.vertexStart * 3, (gi.vertexStart + gi.vertexCount) * 3), 3));
      let worstUnder = Infinity, worstOver = 0;
      for (let i = 0; i <= b.w * 8; i++) for (let j = 0; j <= b.d * 8; j++) {
        const lx = -b.w * 8 + 0.05 + i * 2 - (i === b.w * 8 ? 0.1 : 0), lz = -b.d * 8 + 0.05 + j * 2 - (j === b.d * 8 ? 0.1 : 0);
        const top = topAt(src, lx, lz) + b.baseY, gr = Math.max(b.baseY, groundAt(st.heights, cx + lx, cz + lz));
        // the debris floor is 0.4 m over max(ground, base) everywhere (a level bed would leave the hill over it)
        worstUnder = Math.min(worstUnder, top - gr);
        worstOver = Math.max(worstOver, top - gr);
      }
      expect(worstUnder).toBeGreaterThan(0.35);
      expect(worstOver).toBeLessThan(0.55);
      // every piece rests on the bed: its origin on or a little under the bed (feet in the debris), never floating
      for (let k = 0; k < bi.cells.length; k++) {
        br.batch.mesh.getMatrixAt(bi.cells[k], m);
        const ex = m.elements;
        // upright: the local y axis stays world up (a vertical shear onto the slope, not a tilt; scaled with the piece)
        expect(Math.abs(ex[4]) + Math.abs(ex[6])).toBeLessThan(1e-6);
        expect(ex[5]).toBeGreaterThan(0.8);
        const lx = ex[12] - cx, lz = ex[14] - cz;
        const bedY = topAt(src, Math.max(-b.w * 8 + 0.1, Math.min(b.w * 8 - 0.1, lx)), Math.max(-b.d * 8 + 0.1, Math.min(b.d * 8 - 0.1, lz))) + b.baseY;
        expect(ex[13]).toBeLessThan(bedY + 0.1);
        expect(ex[13]).toBeGreaterThan(bedY - 1.6);
        // the batch's culling sphere holds the sheared piece
        const s = (br.batch as unknown as { sph: Float32Array }).sph, o = bi.cells[k] * 4;
        const bb = br.batch.bounds(bi.kitGeo[k]);
        for (const [px, py, pz] of [[bb.min.x, bb.min.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z], [bb.min.x, bb.max.y, bb.max.z], [bb.max.x, bb.max.y, bb.min.z]]) {
          pos.set(px, py, pz).applyMatrix4(m);
          expect(Math.hypot(pos.x - s[o], pos.y - s[o + 1], pos.z - s[o + 2])).toBeLessThanOrEqual(s[o + 3] + 1e-3);
        }
      }
      // picking / tile culling see the raised debris
      expect(bi.vis.top).toBeGreaterThan(b.baseY + 1);
    }
  });

  it('swaps every rubble piece to its low-poly proxy with the lot at LOD distance, without rebuilding draw lists', () => {
    const { br, info } = setup();
    br.add({ id: 21, def: 'res_tenement', x: 30, z: 30, w: 4, d: 4, rot: 0, variant: 0, built: 1, flags: BF.Burnt, baseY: 0 } as unknown as Building, false);
    const [bi] = (br as unknown as { list: BI[] }).list;
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 30000);
    const H = 720, K = (H / Math.tan((45 * Math.PI) / 360)) / 2;
    const at = (d: number) => { cam.position.set(bi.vis.cx, 0, bi.vis.cz).addScaledVector(new THREE.Vector3(-1, 0.8, -1).normalize(), d); cam.lookAt(bi.vis.cx, 0, bi.vis.cz); cam.updateMatrixWorld(); br.updateLod(cam, H); };
    at(100);
    expect(bi.lod).toBe(0);
    const full = bi.cells.reduce((a, id) => a + br.batch.triangles(info[id].geometryIndex), 0);
    const dOn = (11.3 * K) / (br.lodPixels * 0.88);
    for (let d = 100; d < dOn * 1.3; d += 25) at(d);
    expect(bi.lod).toBe(1);
    bi.cells.forEach((id, k) => expect(info[id].geometryIndex).toBe(bi.kitLod[k]));
    const lod = bi.cells.reduce((a, id) => a + br.batch.triangles(info[id].geometryIndex), 0);
    expect(lod).toBeLessThan(full * 0.2);
    // shared culling spheres: the swaps only patched draw ranges (no list rebuild)
    const ver = (br.batch as unknown as { version: number }).version;
    for (let d = dOn * 1.3; d > 100; d -= 25) at(d);
    expect(bi.lod).toBe(0);
    bi.cells.forEach((id, k) => expect(info[id].geometryIndex).toBe(bi.kitGeo[k]));
    expect((br.batch as unknown as { version: number }).version).toBe(ver);
  });

  it('puts real-size stone retaining-wall skirts under lots above the terrain; far away a plain 8-tri box, shadows only from deep ones', () => {
    const { st, br, geo, info, mask } = setup();
    // a slope rising 1.5 m per cell along x
    for (let z = 0; z <= st.size; z++) for (let x = 0; x <= st.size; x++) st.heights[z * N1 + x] = x * 1.5;
    // lots flattened to their highest corner: 2 cells wide -> 3 m above the low edge; 1 cell + 0.5 m; 0.3 m; a flat one
    br.add({ id: 1, def: 'res_cottage', x: 20, z: 10, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 22 * 1.5 } as unknown as Building, false);
    br.add({ id: 2, def: 'res_cottage', x: 30, z: 10, w: 1, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 30 * 1.5 + 0.5 } as unknown as Building, false);
    br.add({ id: 3, def: 'res_cottage', x: 40, z: 10, w: 1, d: 1, rot: 0, variant: 0, built: 1, flags: 0, baseY: 40 * 1.5 } as unknown as Building, false);
    br.add({ id: 4, def: 'res_cottage', x: 44, z: 10, w: 1, d: 1, rot: 0, variant: 0, built: 1, flags: 0, baseY: 44 * 1.5 + 0.3 } as unknown as Building, false);
    const [deep, shallow, flat, thin] = (br as unknown as { list: BI[] }).list;
    expect(flat.found).toBe(-1);
    // 3 m + 0.8 m into the ground -> the 4.8 m (two-tier) skirt at the lot's real size; 0.5 + 0.8 m -> the 2.2 m one
    const gDeep = geo.get('__foundation:32x32:4.8'), gShallow = geo.get('__foundation:16x32:2.2');
    expect(gDeep).toBeDefined();
    expect(gShallow).toBeDefined();
    expect(info[deep.found].geometryIndex).toBe(gDeep);
    expect(info[shallow.found].geometryIndex).toBe(gShallow);
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
    expect(br.batch.triangles(gDeep!)).toBe(34);
    expect(br.batch.triangles(gShallow!)).toBe(16);
    // shadows: skirts up to 0.4 m exposed none, up to 1.4 m the near cascade, deeper ones every cascade
    expect(mask(thin.found)).toBe(0);
    expect(mask(shallow.found)).toBe(1);
    expect(mask(deep.found)).toBe(0xff);
    // the far level: a plain box of the same real size (8 tris), sharing the full skirt's culling sphere
    for (const bi of [deep, shallow, thin]) {
      expect(br.batch.triangles(bi.foundLod)).toBe(8);
      const lb = br.batch.bounds(bi.foundLod), fb = br.batch.bounds(bi.foundGeom);
      expect(fb.clone().expandByScalar(1e-4).containsBox(lb)).toBe(true);
    }
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 30000);
    const H = 720, K = (H / Math.tan((45 * Math.PI) / 360)) / 2;
    const dir = new THREE.Vector3(0.2, 0.6, 1).normalize();
    const lookAt = (bi: BI, d: number) => {
      const t = new THREE.Vector3(bi.vis.cx, (bi as unknown as { cy: number }).cy, bi.vis.cz);
      cam.position.copy(t).addScaledVector(dir, d); cam.lookAt(t); cam.updateMatrixWorld(); br.updateLod(cam, H);
    };
    /** glide (<= 4% per frame) to distance d from building bi */
    const glideTo = (bi: BI, from: number, d: number) => { for (let x = from; Math.abs(x - d) > 1e-6; x = d > x ? Math.min(d, x * 1.04) : Math.max(d, x / 1.04)) lookAt(bi, x); lookAt(bi, d); };
    const ver0 = (br.batch as unknown as { version: number }).version;
    const radius = (bi: BI) => (bi as unknown as { radius: number }).radius;
    // the thin skirt (0.3 m exposed) turns plain once it projects under 2 px (~0.3 K / 2 away) while its house is still
    // full; up close it is the full skirt
    const dThin = (0.3 * K) / 2;
    lookAt(thin, dThin * 0.5);
    expect(info[thin.found].geometryIndex).toBe(thin.foundGeom);
    glideTo(thin, dThin * 0.5, dThin * 1.3);
    expect(thin.lod).toBe(0);
    expect(info[thin.found].geometryIndex).toBe(thin.foundLod);
    glideTo(thin, dThin * 1.3, dThin * 0.7);
    expect(info[thin.found].geometryIndex).toBe(thin.foundGeom);
    // the deep skirt (3 m) still projects over 2 px where its house swaps to the proxy: it turns plain with the house
    const dHouse = (radius(deep) * K) / (br.lodPixels * br.fadeOn);
    expect((3 * K) / 2).toBeGreaterThan(dHouse * 1.3);
    glideTo(deep, dHouse * 0.7, dHouse * 0.9);
    expect(deep.lod).toBe(0);
    expect(info[deep.found].geometryIndex).toBe(deep.foundGeom);
    glideTo(deep, dHouse * 0.9, dHouse * 1.3);
    expect(deep.lod).toBe(1);
    expect(info[deep.found].geometryIndex).toBe(deep.foundLod);
    // far: every house on its proxy, every skirt the plain box; swaps within shared spheres (no list rebuild)
    glideTo(deep, dHouse * 1.3, 3000);
    for (const bi of [deep, shallow, thin]) { expect(bi.lod).toBe(1); expect(info[bi.found].geometryIndex).toBe(bi.foundLod); }
    expect((br.batch as unknown as { version: number }).version).toBe(ver0);
    // a camera cut back close: the cut frame restores the full skirt (with the house) in view
    lookAt(shallow, 60);
    expect(shallow.lod).toBe(0);
    expect(info[shallow.found].geometryIndex).toBe(shallow.foundGeom);
  });

  it('keeps a one-cell rubble tile within its skirt of the ground where a corner is raised (no plane fits: no gap under the bed)', () => {
    const { st, br } = setup();
    // level ground at 0 with ONE vertex raised 3.9 m: cell (30, 20) gets it as its (+x, +z) corner (a triangle apex)
    st.heights.fill(0);
    st.heights[21 * N1 + 31] = 3.9;
    br.add({ id: 11, def: 'res_cottage', x: 30, z: 20, w: 1, d: 1, rot: 0, variant: 0, built: 1, flags: BF.Burnt, baseY: 0 } as unknown as Building, false);
    const [one] = (br as unknown as { list: (BI & { shear: number[] })[] }).list;
    expect(one.shear.length).toBe(3);
    br.batch.mesh.getMatrixAt(one.main, m);
    // the tile floats at most 0.45 m over the ground at any corner (the bed's closed sides reach 0.5 m under the tile
    // origin, prop.ts) and never sinks more than 0.2 m under the base
    for (const [lx, lz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
      pos.set(lx * 0.9, 0, lz * 0.9).applyMatrix4(m);
      expect(pos.y).toBeLessThanOrEqual(groundAt(st.heights, pos.x, pos.z) + 0.45 + 1e-6);
      expect(pos.y).toBeGreaterThan(-0.2 - 1e-6);
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
