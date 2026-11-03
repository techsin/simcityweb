/** FEEL-15: view wiring supplies plant loads and resets plume history when rebuilding a city. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CityObjectsView } from '../../src/render/city/CityObjectsView';
import type { Emit } from '../../src/render/city/effects/Effects';
import { BF, CityState, type Building } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { getDef } from '../../src/sim/catalog';
import { defaultCityConfig } from '../../src/sim/config';

const views: CityObjectsView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.dispose();
});

function town(): CityState {
  const state = new CityState(defaultCityConfig({ size: 32, seed: 7, terrain: 'flat', disasters: false, treeDensity: 0, waterAmount: 0 }));
  state.heights.fill(5);
  state.day = 90;
  return state;
}

function building(state: CityState, id: number, defId: string, x = 8, jobs?: number): Building {
  const def = getDef(defId)!;
  const capacity = def.capacity ?? def.jobs ?? 0;
  const [w, d] = def.footprint;
  const b: Building = {
    id, def: defId, x, z: 8, w, d, rot: 0, variant: 0, pop: 0, jobs: jobs ?? capacity, capacity,
    wealth: 1, built: 1, age: 100, flags: BF.Powered | BF.Watered, baseY: 5, health: 1, unhappy: 0,
  };
  state.buildings.set(id, b);
  state.nextBuildingId = Math.max(state.nextBuildingId, id + 1);
  for (let z = b.z; z < b.z + d; z++) for (let xx = x; xx < x + w; xx++) state.building[state.idx(xx, z)] = id;
  return b;
}

function rig(state: CityState, getPlantLoad?: (id: number) => number | null) {
  const sim = new Simulation(state);
  const view = new CityObjectsView(state, sim.events, {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), renderer: {} as THREE.WebGLRenderer,
    canvas: {} as HTMLCanvasElement, getState: () => sim.state, getPlantLoad,
  });
  views.push(view);
  return { sim, view };
}

function particles(view: CityObjectsView, id: number): number {
  const groups = (view.effects as unknown as { emitters: Map<number, Emit[]> }).emitters;
  return (groups.get(id) ?? []).reduce((sum, e) => sum + e.count, 0);
}

describe('CityObjectsView output plume wiring', () => {
  it('passes the load callback through and keeps separate plants on their own grid loads', () => {
    const state = town();
    building(state, 3, 'util_coal_plant', 4);
    building(state, 9, 'util_coal_plant', 16);
    const load = vi.fn((id: number) => id === 3 ? 0.15 : id === 9 ? 1 : null);
    const { view } = rig(state, load);
    expect(view.buildings.plantLoad).toBe(load);
    expect(load).toHaveBeenCalledWith(3);
    expect(load).toHaveBeenCalledWith(9);
    expect(view.buildings.getVisual(3)!.activity).toBe(0.25);
    expect(view.buildings.getVisual(9)!.activity).toBe(1);
    expect(particles(view, 3)).toBeGreaterThan(0);
    expect(particles(view, 9)).toBeGreaterThan(0);
    expect(particles(view, 3)).toBeLessThanOrEqual(particles(view, 9) * 0.4);
    expect(view.effects.particleCount).toBe(particles(view, 3) + particles(view, 9));
  });

  it('leaves a plant inactive when no UtilitiesView load callback is available', () => {
    const state = town();
    building(state, 3, 'util_coal_plant');
    const { view } = rig(state);
    expect(view.buildings.plantLoad).toBeNull();
    expect(view.buildings.getVisual(3)!.activity).toBe(0);
    expect(view.effects.particleCount).toBe(0);
    expect(view.effects.smoke.visible).toBe(false);
  });

  it.each(['replaceState', 'reset'] as const)('initializes fresh positive plume strength after %s in the same month', (reset) => {
    const state = town(), b = building(state, 1, 'ind_refinery.id.4', 8, 85);
    expect(b.capacity).toBe(340);
    const { sim, view } = rig(state);
    const before = view.buildings.getVisual(1)!;
    const low = view.effects.particleCount;
    expect(before.activity).toBe(0.25);
    expect(low).toBeGreaterThan(0);
    if (reset === 'replaceState') {
      const next = town();
      building(next, 1, b.def, b.x, b.capacity);
      sim.replaceState(next);
      expect(view.state).toBe(next);
    } else {
      b.jobs = b.capacity;
      sim.events.emit('reset', undefined);
      expect(view.state).toBe(state);
    }
    const fresh = view.buildings.getVisual(1)!;
    expect(fresh).not.toBe(before);
    expect(fresh).toMatchObject({
      id: before.id, model: before.model, variant: before.variant, cx: before.cx, cz: before.cz,
      baseY: before.baseY, yaw: before.yaw, activityMonth: before.activityMonth, activity: 1,
    });
    const full = view.effects.particleCount;
    expect(full).toBeGreaterThan(low * 2.5);
    expect(view.buildings.pendingBuilds).toBe(0);
    // A second reset at another positive step must also settle without advancing the calendar or rendering a frame.
    sim.state.buildings.get(1)!.jobs = 170;
    sim.events.emit('reset', undefined);
    expect(view.buildings.getVisual(1)!.activity).toBe(0.5);
    expect(view.buildings.getVisual(1)!.activityMonth).toBe(before.activityMonth);
    expect(view.effects.particleCount).toBeGreaterThan(low);
    expect(view.effects.particleCount).toBeLessThan(full);
  });
});
