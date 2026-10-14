/**
 * Sun shadow fitting (Shadows.ts) as the frame loop's shadow policy (WorldView.updateShadowPolicy) uses it:
 * - the single map's radius steps by 1/6 octave and dirShadowLogRadius is the unrounded value the policy measures its
 *   zoom rate with (steps per frame);
 * - a held far cascade (CityCascadeShadow.holdFar) keeps the lookup matrix its map tile was rendered with, draws nothing
 *   (its frustum rejects everything) and only stands in for small motions: a jump or a light turn needs a redraw;
 * - the single map's receiver culling switch (CitySun.dirReceiverCull) attaches / detaches the receiver volume.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CitySun, DIR_RADIUS_STEPS, dirShadowLogRadius, fitSunShadow, type ShadowFit } from '../../src/render/world/Shadows';

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
    expect(sun.dirShadow.camera.userData.recv).toBe(sun.dirReceiver);
    sun.dirReceiverCull = false;
    expect(sun.dirShadow.camera.userData.recv).toBeUndefined();
    expect((sun.dirShadow as unknown as { _frustum: { recv?: unknown } })._frustum.recv).toBeUndefined();
    sun.dirReceiverCull = true;
    expect((sun.dirShadow as unknown as { _frustum: { recv?: unknown } })._frustum.recv).toBe(sun.dirReceiver);
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
