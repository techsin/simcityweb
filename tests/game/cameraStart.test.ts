/**
 * Camera start / memory (src/game/cameraStart.ts, used by CityScene): while the renderer modules load, the game runs
 * on a stand-in view whose camera sits at the map corner (0, 0) / 800 m, and the 2 s camera-store tick already runs.
 * That view must never be stored (it overwrote a save's camera, and the new-city start view was then placed from it:
 * new cities and reloaded saves opened on the map corner). Pure: no DOM / WebGL.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraMemory, bestBuildableCell, startCamera, validCamera, type SavedCamera } from '../../src/game/cameraStart';
import { NullWorldView } from '../../src/game/fallback/NullViews';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { CELL_SIZE } from '../../src/core/constants';

/** stand-in for the real CameraController: setView places immediately (like the game's controller) */
class FakeControls {
  enabled = true;
  readonly target = new THREE.Vector3();
  distance = 800;
  yawAngle = 0;
  tilt = 0.8;
  setView(x: number, z: number, distance: number, tiltDeg?: number, yawDeg?: number): void {
    this.target.set(x, 0, z);
    this.distance = distance;
    if (tiltDeg !== undefined) this.tilt = (tiltDeg * Math.PI) / 180;
    if (yawDeg !== undefined) this.yawAngle = (yawDeg * Math.PI) / 180;
  }
  focusOn(x: number, z: number, distance?: number): void {
    this.setView(x, z, distance ?? this.distance);
  }
  rotateStep(): void {}
}

const city = () => createCityState(defaultCityConfig({ size: 64, seed: 7, terrain: 'hills', climate: 'temperate' }));

/** the 2 s ticks (and an autosave) that happen while loadGameModules() is still pending */
function loadingTicks(mem: CameraMemory, st: ReturnType<typeof city>, standIn: NullWorldView, n = 3): void {
  for (let i = 0; i < n; i++) mem.store(st, standIn.controls, true);
  // even without the stand-in flag nothing may be stored before the real view's camera was placed
  mem.store(st, standIn.controls, false);
}

describe('camera start / memory', () => {
  it('new city: slow module loading does not store the stand-in camera; the view opens on the best buildable land', () => {
    const st = city();
    const mem = new CameraMemory();
    loadingTicks(mem, st, new NullWorldView());
    expect(st.systemData.camera).toBeUndefined();
    const c = new FakeControls();
    mem.place(st, c);
    const cell = bestBuildableCell(st);
    expect(c.target.x).toBeCloseTo((cell.x + 0.5) * CELL_SIZE);
    expect(c.target.z).toBeCloseTo((cell.z + 0.5) * CELL_SIZE);
    expect(c.target.x + c.target.z).toBeGreaterThan(0);
    // from now on the real view is remembered
    mem.store(st, c);
    const saved = validCamera(st.systemData.camera, st)!;
    expect(saved.x).toBeCloseTo(c.target.x, 0);
    expect(saved.z).toBeCloseTo(c.target.z, 0);
  });

  it('saved city: the stored camera survives the load and is restored', () => {
    const st = city();
    const cam: SavedCamera = { x: 610, z: 455, distance: 450, yaw: 30, tilt: 40 };
    st.systemData.camera = { ...cam };
    const mem = new CameraMemory();
    loadingTicks(mem, st, new NullWorldView(), 5);
    expect(st.systemData.camera).toEqual(cam);
    expect(startCamera(st, 900)).toEqual(cam);
    const c = new FakeControls();
    mem.place(st, c);
    expect([c.target.x, c.target.z, c.distance]).toEqual([610, 455, 450]);
    mem.store(st, c);
    expect(validCamera(st.systemData.camera, st)).toMatchObject({ x: 610, z: 455, distance: 450, yaw: 30, tilt: 40 });
  });

  it('a stand-in view (no WebGL) never overwrites the save, even after placement', () => {
    const st = city();
    const cam: SavedCamera = { x: 300, z: 700, distance: 520 };
    st.systemData.camera = { ...cam };
    const mem = new CameraMemory();
    const nv = new NullWorldView();
    mem.place(st, nv.controls);
    mem.store(st, nv.controls, nv.isNull);
    expect(st.systemData.camera).toEqual(cam);
  });
});
