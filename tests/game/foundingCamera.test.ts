import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { FoundingFlyIn, foundingTitle } from '../../src/game/cameraStart';
import { ShowCamera } from '../../src/game/ShowCamera';
import { CityScene } from '../../src/game/CityScene';
import { CameraController } from '../../src/render/world/CameraController';
import { defaultCityConfig } from '../../src/sim/config';
import { createCityState } from '../../src/sim/terrainGen';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { activeElement: null });
});
afterEach(() => vi.unstubAllGlobals());

function rig() {
  const dom = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) });
  const c = new CameraController(new THREE.PerspectiveCamera(), dom as unknown as HTMLElement, { mapSize: 1024, heightAt: () => 0 });
  const abort = new AbortController();
  const show = new ShowCamera(() => c, abort.signal);
  const landed = vi.fn();
  const landing = { x: 500, z: 600, distance: 900, yaw: 35, tilt: 50 };
  const fly = new FoundingFlyIn(show, c, landing, 'title', landed);
  return { c, show, landed, landing, fly, dispose: () => { abort.abort(); c.dispose(); } };
}

describe('founding fly-in (FEEL-27)', () => {
  it('starts at 3× even beyond the ordinary zoom limit and lands exactly at 2.5 s', () => {
    const r = rig();
    try {
      expect(r.c.distance).toBe(2700);
      r.fly.frame(1.25);
      expect(r.c.distance).toBeCloseTo(Math.sqrt(2700 * 900));
      r.fly.frame(1.25);
      expect(r.fly.active).toBe(false);
      expect(r.c.distance).toBe(900);
      expect(r.c.target.x).toBe(500);
      expect(r.c.target.z).toBe(600);
      expect(r.c.baseTilt * 180 / Math.PI).toBeCloseTo(50);
      expect(r.landed).toHaveBeenCalledTimes(1);
      r.fly.frame(10);
      expect(r.landed).toHaveBeenCalledTimes(1);
    } finally { r.dispose(); }
  });

  it.each(['keydown', 'pointerdown', 'wheel', 'touchstart'])('%s skips to the start view within a frame', (type) => {
    const r = rig();
    try {
      window.dispatchEvent(Object.assign(new Event(type), { code: 'Escape', key: 'Escape' }));
      r.fly.frame(1 / 60);
      expect(r.fly.active).toBe(false);
      expect(r.c.distance).toBe(900);
      expect(r.landed).toHaveBeenCalledTimes(1);
    } finally { r.dispose(); }
  });

  it('uses the real founding month and mayor in the title', () => {
    const st = createCityState(defaultCityConfig({ size: 32, name: 'Queensbury', mayor: 'Maya Vance', startYear: 2000 }));
    st.systemData.foundedDay = 90;
    expect(foundingTitle(st)).toBe('Queensbury · Founded April 2000 · Mayor Maya Vance');
  });

  it('a save in the input-skip event keeps the landing before the next frame finishes the fly-in', () => {
    const r = rig();
    try {
      const act = vi.fn();
      window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyS', key: 's', ctrlKey: true }));
      expect(r.show.active).toBe(false);
      expect(r.fly.active).toBe(true);
      const scene = { founding: r.fly, host: { act }, camMemory: {}, world: { controls: r.c } };
      CityScene.prototype.storeCamera.call(scene as unknown as CityScene);
      expect(act).toHaveBeenCalledExactlyOnceWith('setCamera', [r.landing], { tag: scene.camMemory });
    } finally { r.dispose(); }
  });
});
