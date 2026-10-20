/**
 * Fresh-load / LOD scheduling invariants (pure JS, no WebGL context):
 *  - smooth motion defers the LOD evaluations of buildings out of the view and of their shadows' reach into it: in
 *    reach every building is on the right side of its swap distances in every frame, the deferred ones are settled by
 *    the frames the camera rests, a bounded slice per frame (swapping at once, no dissolve), and a resting camera then
 *    costs nothing
 *  - a camera receding along its view (a zoom-out) defers nothing: its widening view takes in the buildings it leaves
 *    behind within the motion
 *  - a quality switch evaluates every building in its frame (no sliced catch-up), and the LOW twig strip's rebuild
 *    keeps each building's level (its hysteresis band) instead of starting all of them on their full model
 *  - a building whose proxy arrives late (a load's bulk wake) takes the level it would have had with the proxy at once
 *  - the rubble kit's debris pieces cast no shadows at the low preset (near cascade at the presets that fade)
 *  - the load's warm-up sweep (its LOD part, BuildingRenderer.warmLod) swaps along its poses and puts every level, band
 *    and the LOD camera state back; it is skipped before a real update and while proxies are pending
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { lotTwigs, setLotTwigStrip } from '../../src/assets/builders/winterTwigs';
import { buildLodProxy } from '../../src/render/city/buildings/lodProxy';
import { TileCuller } from '../../src/render/city/common/batch';
import { BuildingRenderer, deferReach } from '../../src/render/city/buildings/BuildingRenderer';
import { sharedUniforms } from '../../src/assets/materials';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { BF, type Building } from '../../src/sim/CityState';
import { CELL_SIZE } from '../../src/core/constants';

registerAllModels();

type BI = { id: number; li: number; lod: number; geom: number; lodGeom: number; siteGeom: number; siteLod: number; radius: number; cy: number; cells: number[]; vis: { cx: number; cz: number } };
type Flat = { list: BI[]; lx: Float32Array; ly: Float32Array; lz: Float32Array; lsr: Float32Array; lht: Float32Array; lodDeferred: boolean };

const MODELS = ['res_cottage', 'res_ranch', 'res_apartment', 'res_tower', 'com_office_small', 'com_diner', 'com_office_tower', 'ind_warehouse'].filter((m) => MANIFEST_BY_ID[m]);

/** a flat 64 x 64 town with a building every 3 cells */
function town(seed = 7): BuildingRenderer {
  const st = createCityState(defaultCityConfig({ size: 64, seed, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
  st.heights.fill(0);
  const br = new BuildingRenderer(st, new TileCuller(64, CELL_SIZE, 16));
  br.lodBudgetMs = 1e9; // proxies on demand without a frame budget here
  let id = 1;
  for (let z = 0; z < 62; z += 3) for (let x = 0; x < 62; x += 3) {
    const b = { id: id++, def: MODELS[(x * 7 + z * 3) % MODELS.length], x, z, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 0 } as unknown as Building;
    // (in the state too: a rebuild re-adds the state's buildings)
    st.buildings.set(b.id, b);
    br.add(b, false);
  }
  return br;
}

const H = 720;
const K = (H / Math.tan((45 * Math.PI) / 360)) / 2;
/** a small drawing buffer (short swap distances: a ~200 m pan crosses many bands) */
const HS = 100;
const KS = (HS / Math.tan((45 * Math.PI) / 360)) / 2;
const hasProxy = (bi: BI) => !(bi.lodGeom === bi.geom && bi.siteLod === bi.siteGeom);

/** buildings on the wrong side of a swap distance (Float32 band arithmetic: 1 mm slack), split by whether their
 *  deferral sphere (LOD centre; radius + shadow reach, at least 30 m) touches the view frustum */
function wrong(br: BuildingRenderer, cam: THREE.PerspectiveCamera, on: number, off: number, k = K): { inReach: number; outReach: number } {
  const f = br as unknown as Flat;
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const sp = new THREE.Sphere();
  let inReach = 0, outReach = 0;
  for (const bi of f.list) {
    if (!hasProxy(bi)) continue;
    const i = bi.li, d = Math.hypot(f.lx[i] - cam.position.x, f.ly[i] - cam.position.y, f.lz[i] - cam.position.z), rk = bi.radius * k;
    const bad = (bi.lod === 0 && d > rk / on + 0.001) || (bi.lod === 1 && d < rk / off - 0.001);
    if (!bad) continue;
    sp.center.set(f.lx[i], f.ly[i], f.lz[i]);
    sp.radius = f.lsr[i] + Math.max(30, deferReach() * f.lht[i]);
    if (fr.intersectsSphere(sp)) inReach++;
    else outReach++;
  }
  return { inReach, outReach };
}

describe('smooth-motion LOD deferral', () => {
  it('evaluates the buildings in reach of the view in every frame, the others once the camera rests (at once, no dissolve)', () => {
    const br = town();
    br.lodSlice = 1e9;
    // (the fade program counts as compiled: swaps in view may dissolve)
    br.fadeReady = true;
    const f = br as unknown as Flat;
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 8000);
    const on = br.lodPixels * Math.min(1.08, br.fadeOn), off = br.lodPixels * 1.12;
    const evals = vi.spyOn(br as unknown as { lodEval: () => void }, 'lodEval');
    // a camera 60 m up in the town looking east while it moves east at 2 m per frame: the buildings ahead come closer
    // (in view: upgraded at once), the ones behind it recede (out of view: their downgrades wait)
    const look = (x: number) => {
      cam.position.set(x, 60, 512);
      cam.lookAt(x + 400, 0, 512);
      cam.updateMatrixWorld();
      br.updateLod(cam, HS);
    };
    look(200);
    // the first frame (a new metric) evaluates everything
    expect(wrong(br, cam, on, off, KS)).toEqual({ inReach: 0, outReach: 0 });
    let deferredSeen = 0, maxDeferred = 0, smoothEvals = 0;
    for (let k = 1; k <= 250; k++) {
      const e0 = evals.mock.calls.length;
      look(200 + k * 2);
      smoothEvals += evals.mock.calls.length - e0;
      const w = wrong(br, cam, on, off, KS);
      expect(w.inReach, `frame ${k}: a building in reach of the view on the wrong level`).toBe(0);
      if (w.outReach > 0) deferredSeen++;
      maxDeferred = Math.max(maxDeferred, w.outReach);
    }
    expect(deferredSeen).toBeGreaterThan(50);
    expect(maxDeferred).toBeGreaterThan(10);
    expect(f.lodDeferred).toBe(true);
    // the same motion without the deferral evaluates more (the deferred evaluations it saves)
    const ref = town();
    ref.lodSlice = 1e9;
    ref.lodDefer = false;
    const refEvals = vi.spyOn(ref as unknown as { lodEval: () => void }, 'lodEval');
    const cam2 = cam.clone();
    const look2 = (x: number) => { cam2.position.set(x, 60, 512); cam2.lookAt(x + 400, 0, 512); cam2.updateMatrixWorld(); ref.updateLod(cam2, HS); };
    look2(200);
    const r0 = refEvals.mock.calls.length;
    for (let k = 1; k <= 250; k++) look2(200 + k * 2);
    expect(smoothEvals).toBeLessThan((refEvals.mock.calls.length - r0) * 0.8);
    // the camera rests: its frames settle the deferred buildings, a slice per frame (lodDeferMs, at least lodWakeSlice:
    // with 0 ms exactly that many), instantly (no new dissolve: out of sight), with every building in reach right
    const fades0 = br.fading;
    br.lodDeferMs = 0;
    const waiting = wrong(br, cam, on, off, KS).outReach;
    expect(waiting).toBeGreaterThan(br.lodWakeSlice);
    let restFrames = 0;
    do {
      const e = evals.mock.calls.length;
      look(200 + 250 * 2);
      restFrames++;
      expect(evals.mock.calls.length - e, `resting frame ${restFrames}`).toBeLessThanOrEqual(br.lodWakeSlice);
      expect(wrong(br, cam, on, off, KS).inReach).toBe(0);
    } while (f.lodDeferred && restFrames < 1000);
    expect(restFrames).toBeGreaterThanOrEqual(Math.ceil(waiting / br.lodWakeSlice));
    expect(wrong(br, cam, on, off, KS)).toEqual({ inReach: 0, outReach: 0 });
    expect(f.lodDeferred).toBe(false);
    expect(br.fading).toBe(fades0);
    expect(br.lodCount).toBe(f.list.filter((b) => b.lod === 1).length);
    // ... and then a resting camera costs nothing
    const e1 = evals.mock.calls.length;
    for (let i = 0; i < 10; i++) look(200 + 250 * 2);
    expect(evals.mock.calls.length).toBe(e1);
    // a cut is never deferred (its due buildings are evaluated by priority, see catchUp)
    look(980);
    expect(wrong(br, cam, on, off, KS)).toEqual({ inReach: 0, outReach: 0 });
  });

  it('defers nothing while the camera recedes along its view (a zoom-out takes in what it leaves behind)', () => {
    const br = town();
    br.lodSlice = 1e9;
    br.fadeReady = true;
    const f = br as unknown as Flat;
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 8000);
    const on = br.lodPixels * Math.min(1.08, br.fadeOn), off = br.lodPixels * 1.12;
    // a zoom-out from a street view at the town's middle: the camera backs away from its ground target and rises
    const T = new THREE.Vector3(512, 0, 512);
    const sp = new THREE.Sphere(), fr = new THREE.Frustum(), pm = new THREE.Matrix4();
    const look = (k: number) => {
      const d = 60 * Math.pow(1.025, k), tilt = ((20 + k * 0.3) * Math.PI) / 180;
      cam.position.set(T.x - Math.cos(tilt) * d, Math.sin(tilt) * d, T.z);
      cam.lookAt(T);
      cam.updateMatrixWorld();
      br.updateLod(cam, HS);
    };
    look(0);
    let outSwaps = 0;
    for (let k = 1; k <= 120; k++) {
      const before = f.list.map((b) => b.lod);
      look(k);
      expect(wrong(br, cam, on, off, KS), `frame ${k}`).toEqual({ inReach: 0, outReach: 0 });
      expect(f.lodDeferred).toBe(false);
      // (swaps of buildings out of the view and of their shadows' reach: the ones a deferral would have held)
      fr.setFromProjectionMatrix(pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      f.list.forEach((b, j) => {
        if (b.lod === before[j]) return;
        sp.center.set(f.lx[b.li], f.ly[b.li], f.lz[b.li]);
        sp.radius = f.lsr[b.li] + Math.max(30, deferReach() * f.lht[b.li]);
        if (!fr.intersectsSphere(sp)) outSwaps++;
      });
    }
    expect(outSwaps).toBeGreaterThan(10);
  });

  it('reaches as far as the sun\'s shadows: a low sun widens the margin, a set sun takes the widest', () => {
    const L = sharedUniforms.uSunDir.value, L0 = L.clone();
    try {
      L.set(0, 1, 0);
      expect(deferReach()).toBeCloseTo(0, 6);
      L.set(Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), 0);
      expect(deferReach()).toBeCloseTo(1, 6);
      // 20 deg: shadows 2.75 x the caster's height
      L.set(Math.cos((20 * Math.PI) / 180), Math.sin((20 * Math.PI) / 180), 0).multiplyScalar(3);
      expect(deferReach()).toBeCloseTo(1 / Math.tan((20 * Math.PI) / 180), 6);
      L.set(1, 0.02, 0);
      expect(deferReach()).toBe(10);
      L.set(0.3, -0.5, 0.2);
      expect(deferReach()).toBe(10);
    } finally {
      L.copy(L0);
    }
  });
});

describe('quality switch LOD', () => {
  it('evaluates every building in the switch frame and keeps each level through the LOW twig-strip rebuild', () => {
    const strip0 = lotTwigs.strip;
    try {
      setLotTwigStrip(true);
      const mk = () => {
        const br = town(11);
        // a tiny sliced catch-up: without the full evaluation a switch would take many frames
        br.lodSlice = 10;
        br.lodCatch = 10;
        br.lodCatchMin = 10;
        br.lodPixels = 11;
        return br;
      };
      const a = mk(), b = mk();
      const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 30000);
      const view = (br: BuildingRenderer, x: number, y: number, z: number) => {
        cam.position.set(x, y, z);
        cam.lookAt(512, 0, 512);
        cam.updateMatrixWorld();
        br.update(1 / 60);
        br.updateLod(cam, H);
      };
      // both: far (every building on its proxy), settled
      for (const br of [a, b]) { br.flushLod(); view(br, 512, 4000, -1200); }
      expect(a.lodCount).toBeGreaterThan((a as unknown as Flat).list.filter((x) => hasProxy(x)).length * 0.6);
      // `a` switches LOW -> HIGH (the forest publishes the twig strip off: its buildings rebuild) and cuts to a nearer
      // view in the same frame; `b` only switches the preset (no rebuild)
      a.lodPixels = 9;
      setLotTwigStrip(false);
      (b as unknown as { twigVer: number }).twigVer = lotTwigs.version;
      view(a, 512, 200, -900);
      b.lodPixels = 9;
      view(b, 512, 200, -900);
      const on = 9 * Math.min(1.08, a.fadeOn), off = 9 * 1.12;
      // one frame settled everything (no backlog), both ways
      expect(a.lodBehind).toBe(false);
      expect(b.lodBehind).toBe(false);
      expect(wrong(a, cam, on, off)).toEqual({ inReach: 0, outReach: 0 });
      expect(wrong(b, cam, on, off)).toEqual({ inReach: 0, outReach: 0 });
      // the rebuilt town kept its levels: the same proxies as the town that was not rebuilt (inside the hysteresis
      // band the proxy stays), not a fresh evaluation from all-full
      const la = (a as unknown as Flat).list, lb = (b as unknown as Flat).list;
      expect(la.map((x) => x.lod)).toEqual(lb.map((x) => x.lod));
      const band = la.filter((x) => {
        if (!hasProxy(x)) return false;
        const d = Math.hypot(x.vis.cx - cam.position.x, x.cy - cam.position.y, x.vis.cz - cam.position.z), rk = x.radius * K;
        return d > rk / off && d < rk / on;
      });
      expect(band.length).toBeGreaterThan(3);
      expect(band.every((x) => x.lod === 1)).toBe(true);
    } finally {
      setLotTwigStrip(strip0);
    }
  });
});

describe('late proxies', () => {
  it('a building woken by its arriving proxy takes the level it would have had with the proxy at once (no dependence on when it came)', () => {
    // `a` gets its proxies from a worker stand-in only when the test delivers them (a load's prefetch arriving late),
    // `b` builds them on demand: same town, same views
    const a = town(13), b = town(13);
    const asked: { geo: THREE.BufferGeometry; done: (g: THREE.BufferGeometry | null) => void }[] = [];
    (a as unknown as { proxies: unknown }).proxies = { available: true, request: (_k: string, geo: THREE.BufferGeometry, done: (g: THREE.BufferGeometry | null) => void) => asked.push({ geo, done }) };
    for (const br of [a, b]) br.lodPixels = 11;
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 30000);
    const view = (br: BuildingRenderer, x: number, y: number, z: number) => {
      cam.position.set(x, y, z);
      cam.lookAt(512, 0, 512);
      cam.updateMatrixWorld();
      br.update(1 / 60);
      br.updateLod(cam, H);
    };
    const wakeLeft = (br: BuildingRenderer) => { const w = br as unknown as { lodWake: unknown[]; lodWakeAt: number }; return w.lodWake.length - w.lodWakeAt; };
    // far: every building wants its proxy; `a` waits on its full models, `b` is on its proxies
    view(a, 512, 4000, -1200);
    view(b, 512, 4000, -1200);
    const la = (a as unknown as Flat).list, lb = (b as unknown as Flat).list;
    expect(asked.length).toBeGreaterThan(0);
    expect(a.lodCount).toBe(0);
    expect(b.lodCount).toBeGreaterThan(lb.filter((x) => hasProxy(x)).length * 0.6);
    // both cut to a nearer view and settle there, `a`'s proxies still out
    for (let k = 0; k < 4; k++) { view(a, 512, 200, -900); view(b, 512, 200, -900); }
    expect(a.lodCount).toBe(0);
    // they arrive now: `a` wakes its buildings at the near view (a bulk wake: a few frames)
    for (const q of asked) q.done(buildLodProxy(q.geo));
    expect(wakeLeft(a)).toBeGreaterThan(a.lodWakeBulk);
    for (let k = 0; k < 20 && wakeLeft(a) > 0; k++) view(a, 512, 200, -900);
    expect(wakeLeft(a)).toBe(0);
    // the same levels as `b`, which had its proxies all along: inside the hysteresis band the proxy applies
    expect(la.map((x) => x.lod)).toEqual(lb.map((x) => x.lod));
    const on = 11 * 0.88, off = 11 * 1.12;
    const band = la.filter((x) => {
      if (!hasProxy(x)) return false;
      const d = Math.hypot(x.vis.cx - cam.position.x, x.cy - cam.position.y, x.vis.cz - cam.position.z), rk = x.radius * K;
      return d > rk / off && d < rk / on;
    });
    expect(band.length).toBeGreaterThan(3);
    expect(band.every((x) => x.lod === 1)).toBe(true);
    expect(wrong(a, cam, on, off)).toEqual({ inReach: 0, outReach: 0 });
  });
});

describe('rubble kit shadows', () => {
  it('debris pieces cast into the near cascade at the presets that fade, into no shadow map at the low preset', () => {
    const st = createCityState(defaultCityConfig({ size: 64, seed: 5, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
    st.heights.fill(0);
    const br = new BuildingRenderer(st, new TileCuller(64, CELL_SIZE, 16));
    br.lodBudgetMs = 1e9;
    const mask = (id: number) => (br.batch as unknown as { instMask: Uint8Array }).instMask[id];
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 8000);
    cam.position.set(300, 300, -200);
    cam.lookAt(200, 0, 200);
    cam.updateMatrixWorld();
    br.lodPixels = 9;
    br.add({ id: 100, def: 'com_office_tower', x: 4, z: 4, w: 4, d: 4, rot: 0, variant: 0, built: 1, flags: BF.Burnt, baseY: 0 } as unknown as Building, false);
    br.updateLod(cam, H);
    const list = (br as unknown as Flat).list;
    const pieces = () => list.flatMap((b) => b.cells);
    expect(pieces().length).toBeGreaterThan(8);
    expect(pieces().every((id) => mask(id) === 1)).toBe(true);
    // the low preset: no debris shadows, also for a lot burnt while it is on
    br.lodPixels = 11;
    br.updateLod(cam, H);
    br.add({ id: 101, def: 'res_apartment', x: 12, z: 4, w: 3, d: 3, rot: 0, variant: 0, built: 1, flags: BF.Burnt, baseY: 0 } as unknown as Building, false);
    br.updateLod(cam, H);
    expect(list.length).toBe(2);
    expect(pieces().length).toBeGreaterThan(12);
    expect(pieces().every((id) => mask(id) === 0)).toBe(true);
    // back to a preset that fades
    br.lodPixels = 10;
    br.updateLod(cam, H);
    expect(pieces().every((id) => mask(id) === 1)).toBe(true);
  });
});

describe('load warm-up (LOD part)', () => {
  type W = Flat & { lo2: Float32Array; hi2: Float32Array; lodPos: THREE.Vector3; lodDir: THREE.Vector3; warmLodNote: string };
  const at = (cam: THREE.PerspectiveCamera, x: number, y: number, z: number) => { cam.position.set(x, y, z); cam.lookAt(512, 0, 512); cam.updateMatrixWorld(); };

  it('swaps along the sweep of the batch warm-up and puts back every level, band and the LOD camera state', () => {
    const br = town(5);
    const f = br as unknown as W;
    const geo = (id: number) => (br.batch as unknown as { instGeo: Int32Array }).instGeo[id];
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 8000);
    // every proxy in (the sweep runs only over a settled load), the view settled
    br.flushLod();
    at(cam, 512, 260, -60);
    br.updateLod(cam, H);
    br.updateLod(cam, H);
    const hook = br.batch.warmHook!;
    expect(hook).toBeTypeOf('function');
    const n = f.list.length;
    const snap = () => ({
      lod: f.list.map((b) => b.lod), geo: f.list.map((b) => geo((b as unknown as { main: number }).main)),
      lo2: Array.from(f.lo2.subarray(0, n)), hi2: Array.from(f.hi2.subarray(0, n)), count: br.lodCount,
      pos: f.lodPos.toArray(), dir: f.lodDir.toArray(), deferred: f.lodDeferred,
    });
    const s0 = snap();
    // a sweep like the batch's (DynamicBatch.warmUp): a zoom-out from the street to far, back in, a cut
    const vc = new THREE.PerspectiveCamera(45, 16 / 9, 1, 8000);
    let most = 0;
    for (let k = 0; k < 48; k++) {
      const d = k < 32 ? 80 * Math.pow(1.12, k) : 80 * Math.pow(1.12, 31) * Math.pow(0.8, k - 31);
      at(vc, 512 - d * 0.5, d * 0.7, 512 - d * 0.5);
      hook(vc);
      most = Math.max(most, f.list.filter((b, j) => b.lod !== s0.lod[j]).length);
    }
    at(vc, 300, 40, 300);
    hook(vc);
    hook(null);
    expect(most).toBeGreaterThan(n * 0.3);
    expect(f.warmLodNote).toMatch(/^ran/);
    expect(snap()).toEqual(s0);
    // the real view did not move: its next update has nothing to evaluate
    const evals = vi.spyOn(br as unknown as { lodEval: () => void }, 'lodEval');
    br.updateLod(cam, H);
    expect(evals).not.toHaveBeenCalled();
  });

  it('is skipped (nothing changes) before a real update and while proxies are pending', () => {
    const br = town(6);
    const f = br as unknown as W;
    const vc = new THREE.PerspectiveCamera(45, 16 / 9, 1, 8000);
    at(vc, 512, 3000, -800);
    const lod0 = f.list.map((b) => b.lod);
    br.batch.warmHook!(vc);
    br.batch.warmHook!(null);
    expect(f.warmLodNote).toBe('skipped: no update yet');
    expect(f.list.map((b) => b.lod)).toEqual(lod0);
    // a near view needs few proxies: the others are still pending (a sweep would request them all)
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 8000);
    at(cam, 512, 40, 470);
    br.updateLod(cam, H);
    const lod1 = f.list.map((b) => b.lod);
    br.batch.warmHook!(vc);
    br.batch.warmHook!(null);
    expect(f.warmLodNote).toMatch(/^skipped: \d+ proxies pending/);
    expect(f.list.map((b) => b.lod)).toEqual(lod1);
  });
});
