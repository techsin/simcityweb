/** FEEL-21: live camera preferences, without WebGL or a DOM library. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../../src/render/world/CameraController';

const controllers: CameraController[] = [];
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { activeElement: null });
});
afterEach(() => {
  for (const c of controllers.splice(0)) c.dispose();
  vi.unstubAllGlobals();
});

function camera() {
  const dom = Object.assign(new EventTarget(), {
    clientWidth: 1280, clientHeight: 720,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  }) as unknown as HTMLCanvasElement;
  const view = new THREE.PerspectiveCamera(45, 1280 / 720, 1, 30000);
  const controls = new CameraController(view, dom, { mapSize: 12000, heightAt: () => 0 });
  controls.setView(1000, 2000, 800, 52, 45);
  controllers.push(controls);
  return { controls, view };
}

describe('reduced motion camera (FEEL-21)', () => {
  it('repeated quake shakes move the camera 0 m while reduced', () => {
    const a = camera(), b = camera();
    a.controls.reducedMotion = true;
    for (let frame = 0; frame < 240; frame++) {
      if (frame % 72 === 0) a.controls.shake(1, 3);
      a.controls.update(1 / 60);
      b.controls.update(1 / 60);
      expect(a.view.matrixWorld.toArray()).toEqual(b.view.matrixWorld.toArray());
    }
  });

  it('removes an active shake at once and discards it when full motion returns', () => {
    const a = camera(), b = camera();
    a.controls.shake(1, 3);
    a.controls.update(0.1);
    b.controls.update(0.1);
    expect(a.view.position.distanceTo(b.view.position)).toBeGreaterThan(0);
    a.controls.reducedMotion = true;
    expect(a.view.matrixWorld.toArray()).toEqual(b.view.matrixWorld.toArray());
    a.controls.reducedMotion = false;
    a.controls.update(0.1);
    b.controls.update(0.1);
    expect(a.view.matrixWorld.toArray()).toEqual(b.view.matrixWorld.toArray());
    a.controls.shake(1, 3);
    a.controls.update(0.1);
    b.controls.update(0.1);
    expect(a.view.position.distanceTo(b.view.position)).toBeGreaterThan(0);
  });

  it('skips a focus flight to its destination and restores flights when switched back', () => {
    const { controls: c } = camera();
    c.reducedMotion = true;
    c.focusOn(5000, 2000, 600, { fly: true });
    expect(c.target.x).toBe(5000);
    expect(c.target.z).toBe(2000);
    expect(c.distance).toBe(600);
    c.reducedMotion = false;
    c.focusOn(1000, 2000, 600, { fly: true });
    c.update(0.1);
    expect(c.target.x).toBeGreaterThan(1000);
    expect(c.target.x).toBeLessThan(5000);
    expect(c.distance).toBeGreaterThan(600);
    c.update(1.5);
    expect(c.target.x).toBe(1000);
    expect(c.distance).toBe(600);
  });

  it('cancels an active flight at the displayed position when enabled', () => {
    const { controls: c } = camera();
    c.focusOn(5000, 2000, 600, { fly: true });
    c.update(0.4);
    const target = c.target.clone(), distance = c.distance;
    c.reducedMotion = true;
    for (let frame = 0; frame < 120; frame++) c.update(1 / 60);
    expect(c.target.toArray()).toEqual(target.toArray());
    expect(c.distance).toBeCloseTo(distance);
    c.reducedMotion = false;
    for (let frame = 0; frame < 120; frame++) c.update(1 / 60);
    expect(c.target.toArray()).toEqual(target.toArray());
    expect(c.distance).toBeCloseTo(distance);
  });

  it('keeps ordinary focus damping unchanged and defaults to full motion', () => {
    const a = camera(), b = camera();
    expect(a.controls.reducedMotion).toBe(false);
    a.controls.reducedMotion = true;
    a.controls.focusOn(1300, 2000, 600);
    b.controls.focusOn(1300, 2000, 600);
    for (let frame = 0; frame < 60; frame++) {
      a.controls.update(1 / 60);
      b.controls.update(1 / 60);
      expect(a.view.matrixWorld.toArray()).toEqual(b.view.matrixWorld.toArray());
    }
  });
});
