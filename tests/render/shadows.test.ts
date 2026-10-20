/**
 * Sun shadow fitting (Shadows.ts) as the frame loop's shadow policy (WorldView.updateShadowPolicy) uses it:
 * - the single map's radius steps by 1/6 octave and dirShadowLogRadius is the unrounded value the policy measures its
 *   zoom rate with (steps per frame);
 * - a held far cascade (CityCascadeShadow.holdFar) keeps the lookup matrix its map tile was rendered with, draws nothing
 *   (its frustum rejects everything) and only stands in for small motions: a jump or a light turn needs a redraw;
 * - the single map's receiver culling switch (CitySun.dirReceiverCull) attaches / detaches its cull volume;
 * - the single map's cull volume widened for the view's predicted motion (widenReceiver) holds the receivers of the
 *   frames it predicts (orbit, zoom) and not those after them, grows little for a zoom-in, a lot for a jump.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CitySun, copyReceiver, DIR_RADIUS_STEPS, dirShadowLogRadius, fitSunShadow, makeReceiver, receiverHolds, widenReceiver, type ShadowFit, type ShadowReceiver } from '../../src/render/world/Shadows';

const LIGHT = new THREE.Vector3(0.45, 0.8, 0.3).normalize();

function makeView(target: THREE.Vector3, distance: number, tiltDeg: number, yawDeg: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, distance * 6 + 42000);
  const t = THREE.MathUtils.degToRad(tiltDeg), y = THREE.MathUtils.degToRad(yawDeg);
  cam.position.set(target.x + Math.sin(y) * Math.cos(t) * distance, target.y + Math.sin(t) * distance, target.z + Math.cos(y) * Math.cos(t) * distance);
  cam.lookAt(target);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return cam;
}

function fitOf(target: THREE.Vector3, distance: number, lightDir = LIGHT): ShadowFit {
  return { target, distance, rangeMul: 1.6, lightDir, maxHeight: 40, minHeight: 0, mapSize: 4096 };
}

/** fit + cascade matrices for one frame (as WorldView.update / updateShadowPolicy do) */
function frame(sun: CitySun, cam: THREE.PerspectiveCamera, fit: ShadowFit, hold: boolean): void {
  fitSunShadow(sun, cam, fit);
  sun.cascadeShadow.holdFar = hold;
  sun.cascadeShadow.updateMatrices(sun, cam);
}

describe('single shadow map radius', () => {
  it('steps by 1/6 octave and matches its unrounded log radius', () => {
    const sun = new CitySun();
    const target = new THREE.Vector3(2000, 0, 2000);
    let prev = 0, steps = 0;
    for (let d = 200; d < 5000; d *= 1.01) {
      const cam = makeView(target, d, 50, 30);
      const fit = fitOf(target, d);
      fitSunShadow(sun, cam, fit);
      const r = (sun.dirShadow.camera as THREE.OrthographicCamera).right;
      const lr = dirShadowLogRadius(fit);
      // the map's radius is the asked-for radius rounded up to the next step
      expect(Math.log2(r)).toBeGreaterThanOrEqual(lr - 1e-9);
      expect(Math.log2(r) - lr).toBeLessThan(1 / DIR_RADIUS_STEPS + 1e-9);
      expect(r).toBeCloseTo(Math.pow(2, Math.ceil(Math.log2(Math.max(120, d * 1.6 * 0.62)) * 6) / 6), 9);
      if (prev && r !== prev) {
        steps++;
        expect(Math.log2(r / prev)).toBeCloseTo(1 / DIR_RADIUS_STEPS, 9);
      }
      prev = r;
    }
    expect(steps).toBeGreaterThan(10);
  });

  it('switches receiver culling on and off for the single map', () => {
    const sun = new CitySun();
    expect(sun.dirReceiverCull).toBe(true);
    expect(sun.dirShadow.camera.userData.recv).toBe(sun.dirCull);
    sun.dirReceiverCull = false;
    expect(sun.dirShadow.camera.userData.recv).toBeUndefined();
    expect((sun.dirShadow as unknown as { _frustum: { recv?: unknown } })._frustum.recv).toBeUndefined();
    sun.dirReceiverCull = true;
    expect((sun.dirShadow as unknown as { _frustum: { recv?: unknown } })._frustum.recv).toBe(sun.dirCull);
  });
});

describe('held far cascade', () => {
  const target = new THREE.Vector3(2000, 0, 2000);
  const setup = () => {
    const sun = new CitySun();
    sun.setCascaded(true);
    sun.cascadeShadow.mapSize.set(2048, 2048);
    const cam = makeView(target, 900, 50, 30);
    frame(sun, cam, fitOf(target, 900), false);
    return { sun, cam, m0: sun.cascadeShadow.getMatrix(1).clone(), n0: sun.cascadeShadow.getMatrix(0).clone() };
  };
  const huge = new THREE.Sphere(new THREE.Vector3(2000, 0, 2000), 1e5);

  it('keeps the far lookup matrix and draws nothing while held, then redraws when released', () => {
    const { sun, m0, n0 } = setup();
    const cs = sun.cascadeShadow;
    expect(cs.farHeld).toBe(false);
    // one frame of a slow orbit
    const cam = makeView(target, 900, 50, 31.5);
    frame(sun, cam, fitOf(target, 900), true);
    expect(cs.farHoldable).toBe(true);
    expect(cs.farHeld).toBe(true);
    expect(cs.getMatrix(1).equals(m0)).toBe(true);
    // (the near cascade follows the view)
    expect(cs.getMatrix(0).equals(n0)).toBe(false);
    expect(cs.getFrustum(1).intersectsSphere(huge)).toBe(false);
    expect(cs.getFrustum(0).intersectsSphere(huge)).toBe(true);
    // released: the far cascade is fitted to the current view again
    frame(sun, cam, fitOf(target, 900), false);
    expect(cs.farHeld).toBe(false);
    expect(cs.getMatrix(1).equals(m0)).toBe(false);
    expect(cs.getFrustum(1).intersectsSphere(huge)).toBe(true);
  });

  it('a small zoom step can be held, a jump or a light turn cannot', () => {
    {
      const { sun } = setup();
      frame(sun, makeView(target, 930, 50, 30), fitOf(target, 930), true);
      expect(sun.cascadeShadow.farHoldable).toBe(true);
    }
    {
      // camera cut to another part of the map
      const { sun } = setup();
      const t2 = new THREE.Vector3(3200, 0, 1200);
      frame(sun, makeView(t2, 900, 50, 30), fitOf(t2, 900), true);
      expect(sun.cascadeShadow.farHoldable).toBe(false);
    }
    {
      // zoom far out in one frame: the far cascade's depth range grows by more than a split step
      const { sun } = setup();
      frame(sun, makeView(target, 2600, 50, 30), fitOf(target, 2600), true);
      expect(sun.cascadeShadow.farHoldable).toBe(false);
    }
    {
      // the light direction stepped
      const { sun } = setup();
      const l2 = LIGHT.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.01);
      frame(sun, makeView(target, 900, 50, 30), fitOf(target, 900, l2), true);
      expect(sun.cascadeShadow.farHoldable).toBe(false);
    }
  });
});

describe('single map cull volume (widenReceiver)', () => {
  const target = new THREE.Vector3(2000, 0, 2000);
  const FOV_TURN = (10 * Math.PI) / 180;
  /** the single map's receiver of a view (as WorldView.update fits it every frame) */
  const recvOf = (cam: THREE.PerspectiveCamera, d: number, light = LIGHT): ShadowReceiver => {
    const sun = new CitySun();
    fitSunShadow(sun, cam, fitOf(target, d, light));
    const r = makeReceiver();
    copyReceiver(r, sun.dirReceiver);
    return r;
  };
  /** rigid per-frame motion from camera a to b: rotation (row-major, world axes) about a's position, then the travel */
  const motion = (a: THREE.Camera, b: THREE.Camera) => {
    const ra = new THREE.Matrix4().extractRotation(a.matrixWorld), rb = new THREE.Matrix4().extractRotation(b.matrixWorld);
    const m = rb.multiply(ra.transpose()).elements;
    const q = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
    const v = [b.position.x - a.position.x, b.position.y - a.position.y, b.position.z - a.position.z];
    return { v, q };
  };

  it('an orbit: holds the receivers of the predicted frames, not those after them', () => {
    const d = 800, step = 1.5;
    const cams = Array.from({ length: 16 }, (_, i) => makeView(target, d, 50, 30 + i * step));
    const recs = cams.map((c) => recvOf(c, d));
    const { v, q } = motion(cams[0], cams[1]);
    const w = makeReceiver();
    const g1 = widenReceiver(w, recs[1], v, q, 1, 0.25, 1, d, FOV_TURN);
    expect(g1).toBeGreaterThan(0);
    expect(w.banded).toBe(true);
    const k = 4;
    const g = widenReceiver(w, recs[1], v, q, k, 0.25, 1, d, FOV_TURN);
    // (about k times the one-frame growth)
    expect(g).toBeGreaterThan(g1 * (k - 1));
    expect(g).toBeLessThan(g1 * (k + 1));
    for (let j = 1; j <= 1 + k; j++) expect(receiverHolds(w, recs[j])).toBe(true);
    expect(receiverHolds(w, recs[1 + k + 4])).toBe(false);
    // the other way round
    expect(receiverHolds(recs[1], recs[2])).toBe(false);
  });

  it('a zoom: the predicted receivers are held; zooming in widens far less than zooming out', () => {
    const ds = Array.from({ length: 8 }, (_, i) => 800 * Math.exp(0.03 * i));
    const out = ds.map((d) => makeView(target, d, 50, 30));
    const rOut = out.map((c, i) => recvOf(c, ds[i]));
    // (error as WorldView's: a quarter more where the motion widens; the zoom speeds up 3 % per frame)
    const mo = motion(out[0], out[1]);
    const wo = makeReceiver();
    const go = widenReceiver(wo, rOut[1], mo.v, mo.q, 4, 0.25, 1, ds[1], FOV_TURN);
    for (let j = 1; j <= 5; j++) expect(receiverHolds(wo, rOut[j])).toBe(true);
    const inn = [...out].reverse(), dIn = [...ds].reverse();
    const rIn = inn.map((c, i) => recvOf(c, dIn[i]));
    const mi = motion(inn[0], inn[1]);
    const wi = makeReceiver();
    const gi = widenReceiver(wi, rIn[1], mi.v, mi.q, 4, 0.25, 1, dIn[1], FOV_TURN);
    for (let j = 1; j <= 5; j++) expect(receiverHolds(wi, rIn[j])).toBe(true);
    expect(gi).toBeGreaterThanOrEqual(0);
    expect(gi).toBeLessThan(go * 0.25);
  });

  it('a jump grows past any budget; another light is never held', () => {
    const d = 800;
    const a = makeView(target, d, 50, 30), b = makeView(new THREE.Vector3(2900, 0, 1300), d, 50, 30);
    const { v, q } = motion(a, b);
    const w = makeReceiver();
    expect(widenReceiver(w, recvOf(b, d), v, q, 1, 0.25, 1, d, FOV_TURN)).toBeGreaterThan(1);
    const r = recvOf(a, d);
    const l2 = LIGHT.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.01);
    expect(receiverHolds(r, recvOf(a, d))).toBe(true);
    expect(receiverHolds(r, recvOf(a, d, l2))).toBe(false);
  });
});
