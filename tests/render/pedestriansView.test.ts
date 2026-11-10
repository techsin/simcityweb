/** FEEL-25's CityObjectsView wiring: context feeds, one draw, quality changes and city lifecycle. */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CELL_SIZE } from '../../src/core/constants';
import { Network } from '../../src/core/types';
import type { CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { CityObjectsView } from '../../src/render/city/CityObjectsView';
import { newState, place, roadLine } from '../infra/cityGen';

function town(): CityState {
  const st = newState(32);
  st.stats.population = 50000;
  st.stats.tourists = 300;
  st.stats.tripsTransit = 10000;
  st.stats.tripsWalk = 5000;
  for (let z = 4; z <= 28; z += 3) {
    roadLine(st, 1, z, 30, z, Network.Road);
    for (let x = 4; x <= 27; x += 2) place(st, 't_r2', x, z + 1, { pop: 120 });
  }
  return st;
}

function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(80, 2.4, 1, 4000);
  cam.position.set(16 * CELL_SIZE, 125, 16 * CELL_SIZE);
  cam.up.set(0, 0, -1);
  cam.lookAt(16 * CELL_SIZE, 5, 16 * CELL_SIZE);
  cam.updateMatrixWorld();
  return cam;
}

/** Finish the bounded discovery slices without advancing visual time. */
function settle(view: CityObjectsView): void {
  for (let i = 0; i < 30; i++) view.update(0);
}

function pedestrianCalls(view: CityObjectsView): number {
  const mesh = view.pedestrians.mesh, visible = mesh.visible, calls = view.stats().drawCalls;
  mesh.visible = false;
  const hidden = view.stats().drawCalls;
  mesh.visible = visible;
  return calls - hidden;
}

describe('CityObjectsView pedestrians wiring (FEEL-25)', () => {
  it('uses context hour, rain and activity; counts one visible draw and applies the LOW cap', () => {
    const sim = new Simulation(town(), []);
    let hour = 12, rain = false;
    const activity = vi.fn(() => ({ customers: 400, visitors: 0, riders: 0 }));
    const view = new CityObjectsView(sim.state, sim.events, {
      scene: new THREE.Scene(), camera: camera(),
      renderer: { domElement: { height: 720 } } as unknown as THREE.WebGLRenderer,
      canvas: {} as HTMLCanvasElement,
      getTimeOfDay: () => hour, getRain: () => rain, getPedestrianActivity: activity,
    });
    try {
      settle(view);
      const mesh = view.pedestrians.mesh, daytime = mesh.count, dry = mesh.geometry;
      expect(activity).toHaveBeenCalled();
      expect(daytime).toBeGreaterThan(120);
      expect(daytime).toBeLessThanOrEqual(600);
      expect(mesh.visible).toBe(true);
      expect(pedestrianCalls(view)).toBe(1);

      hour = 3;
      view.update(0);
      expect(mesh.count).toBeLessThanOrEqual(Math.floor(daytime * 0.2));
      hour = 12;
      rain = true;
      view.update(0);
      expect(mesh.count).toBe(daytime);
      expect(mesh.geometry).not.toBe(dry);
      expect(pedestrianCalls(view)).toBe(1);
      rain = false;
      view.update(0);
      expect(mesh.geometry).toBe(dry);

      view.setQuality('low');
      expect(mesh.count).toBe(0);
      settle(view);
      expect(mesh.count).toBeGreaterThanOrEqual(20);
      expect(mesh.count).toBeLessThanOrEqual(120);
      expect(pedestrianCalls(view)).toBe(1);
      view.setQuality('high');
      settle(view);
      expect(mesh.count).toBe(daytime);
    } finally {
      view.dispose();
    }
  });

  it('follows network invalidation, same-state reset, replacement and disposal', () => {
    const st = town(), sim = new Simulation(st, []), scene = new THREE.Scene();
    const view = new CityObjectsView(st, sim.events, {
      scene, camera: camera(),
      renderer: { domElement: { height: 720 } } as unknown as THREE.WebGLRenderer,
      canvas: {} as HTMLCanvasElement, getState: () => sim.state, getTimeOfDay: () => 12,
    });
    const mesh = view.pedestrians.mesh;
    const rect = { x0: 0, z0: 0, x1: st.size, z1: st.size };
    let disposed = false;
    try {
      settle(view);
      expect(mesh.count).toBeGreaterThanOrEqual(20);

      st.network.fill(Network.None);
      sim.events.emit('networkChanged', rect);
      view.update(0);
      expect(mesh.count).toBe(0);
      expect(mesh.visible).toBe(false);
      expect(pedestrianCalls(view)).toBe(0);

      for (let z = 4; z <= 28; z += 3) roadLine(st, 1, z, 30, z, Network.Road);
      sim.events.emit('networkChanged', rect);
      settle(view);
      expect(mesh.count).toBeGreaterThanOrEqual(20);
      sim.events.emit('reset', undefined);
      expect(mesh.count).toBe(0);
      settle(view);
      expect(mesh.count).toBeGreaterThanOrEqual(20);

      sim.replaceState(newState(32));
      expect(mesh.count).toBe(0);
      settle(view);
      expect(mesh.visible).toBe(false);
      const fresh = town();
      sim.replaceState(fresh);
      settle(view);
      expect(view.state).toBe(fresh);
      expect(mesh.count).toBeGreaterThanOrEqual(20);

      const invalidate = vi.spyOn(view.pedestrians, 'invalidate');
      let geometryDisposals = 0, materialDisposals = 0;
      mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
      mesh.material.addEventListener('dispose', () => materialDisposals++);
      view.dispose();
      disposed = true;
      expect(mesh.parent).toBeNull();
      expect(scene.children).not.toContain(view.root);
      expect(mesh.count).toBe(0);
      expect(geometryDisposals).toBe(1);
      expect(materialDisposals).toBe(1);
      sim.events.emit('networkChanged', rect);
      expect(invalidate).not.toHaveBeenCalled();
    } finally {
      if (!disposed) view.dispose();
    }
  });
});
