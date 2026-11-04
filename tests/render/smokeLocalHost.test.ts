/** FEEL-15: CityScene's actual caller supplies local utility grid loads to the real building/effects views. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { DevType, Zone } from '../../src/core/types';
import { CityScene } from '../../src/game/CityScene';
import { CityObjectsView } from '../../src/render/city/CityObjectsView';
import type { Emit } from '../../src/render/city/effects/Effects';
import { BF, CityState, type Building } from '../../src/sim/CityState';
import { CATALOG, getDef, rebuildCatalogIndex } from '../../src/sim/catalog';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import { defaultCityConfig } from '../../src/sim/config';
import { UtilitiesSystem } from '../../src/sim/infra/utilities';
import { LocalSimHost } from '../../src/worker/SimHost';

const hosts: LocalSimHost[] = [], views: CityObjectsView[] = [];
const consumers: BuildingDef[] = [60, 400].map<BuildingDef>((powerUse) => ({
  id: `t_feel15_load_${powerUse}`, name: `Test ${powerUse} MW consumer`, model: 'res_cottage',
  category: 'growable', footprint: [1, 1], devType: DevType.R1, zones: [Zone.ResLow],
  capacity: 100, powerUse, waterUse: 0,
}));

afterEach(async () => {
  for (const view of views.splice(0)) view.dispose();
  for (const host of hosts.splice(0)) await host.dispose();
  vi.restoreAllMocks();
});

function town(): CityState {
  let added = false;
  for (const def of consumers) if (!getDef(def.id)) { CATALOG.push(def); added = true; }
  if (added) rebuildCatalogIndex();
  const state = new CityState(defaultCityConfig({ size: 64, seed: 7, terrain: 'flat', disasters: false, treeDensity: 0, waterAmount: 0 }));
  state.heights.fill(5);
  state.day = 90;
  return state;
}

function place(state: CityState, defId: string, x: number, z: number): Building {
  const def = getDef(defId)!, [w, d] = def.footprint, capacity = def.capacity ?? def.jobs ?? 0;
  const b: Building = {
    id: state.nextBuildingId++, def: defId, x, z, w, d, rot: 0, variant: 0,
    pop: def.category === 'growable' ? capacity : 0, jobs: def.jobs ?? 0, capacity,
    wealth: 1, built: 1, age: 100, flags: BF.Powered | BF.Watered, baseY: 5, health: 1, unhappy: 0,
  };
  state.buildings.set(b.id, b);
  for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) state.building[state.idx(xx, zz)] = b.id;
  return b;
}

function grid(state: CityState, x: number, powerUse: number) {
  const plant = place(state, 'util_coal_plant', x, 8);
  const consumer = place(state, `t_feel15_load_${powerUse}`, x, 26);
  for (let z = plant.z + plant.d; z < consumer.z; z++) state.powerLines[state.idx(x, z)] = 1;
  return { plant, consumer };
}

function local(state: CityState): LocalSimHost {
  const host = new LocalSimHost(state);
  hosts.push(host);
  return host;
}

/** Exercise createViews without constructing DOM/HUD/WebGL; the object view and all simulation readers are real. */
function createView(host: LocalSimHost): CityObjectsView {
  class HeadlessWorld {
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.PerspectiveCamera();
    readonly renderer = {} as THREE.WebGLRenderer;
  }
  const report = vi.fn();
  const screen = Object.assign(Object.create(CityScene.prototype), {
    host, opts: {}, settings: { quality: 'high' }, canvas: {} as HTMLCanvasElement,
    mods: { WorldView: HeadlessWorld, CityObjectsView }, errors: { report }, degraded: {},
    hookCameraSounds: vi.fn(), watchContext: vi.fn(),
  }) as { createViews(): void; objects: CityObjectsView };
  screen.createViews();
  expect(report).not.toHaveBeenCalled();
  expect(screen.objects).toBeInstanceOf(CityObjectsView);
  views.push(screen.objects);
  return screen.objects;
}

function particles(view: CityObjectsView, id: number): number {
  const emitters = (view.effects as unknown as { emitters: Map<number, Emit[]> }).emitters;
  return (emitters.get(id) ?? []).reduce((sum, e) => sum + e.count, 0);
}

describe('CityScene local plant-load caller', () => {
  it('carries each real grid load through the host, caller, building activity and plume particles', async () => {
    const state = town(), low = grid(state, 4, 60), full = grid(state, 36, 400);
    const host = local(state), utilities = new UtilitiesSystem();
    await host.start({ createSystems: () => [utilities] });
    expect(utilities.plantLoad(low.plant.id)).toBeCloseTo(0.15, 6);
    expect(utilities.plantLoad(full.plant.id)).toBe(1);
    expect(low.plant.flags & BF.Powered).toBeTruthy();
    expect(full.plant.flags & BF.Powered).toBeTruthy();
    const view = createView(host);
    expect(view.buildings.plantLoad?.(low.plant.id)).toBe(utilities.plantLoad(low.plant.id));
    expect(view.buildings.plantLoad?.(full.plant.id)).toBe(utilities.plantLoad(full.plant.id));
    expect(view.buildings.getVisual(low.plant.id)!.activity).toBe(0.25);
    expect(view.buildings.getVisual(full.plant.id)!.activity).toBe(1);
    expect(particles(view, low.plant.id)).toBeGreaterThan(0);
    expect(particles(view, low.plant.id)).toBeLessThanOrEqual(particles(view, full.plant.id) * 0.4);

    low.consumer.def = 't_feel15_load_400';
    utilities.compute(host.sim);
    expect(utilities.plantLoad(low.plant.id)).toBe(1);
    state.day += 30;
    view.buildings.flushLod();
    view.effects.update();
    expect(view.buildings.getVisual(low.plant.id)!.activity).toBe(1);
    expect(particles(view, low.plant.id)).toBe(particles(view, full.plant.id));

    low.plant.jobs = 17;
    host.events.emit('buildingChanged', low.plant);
    full.plant.flags &= ~BF.Powered;
    host.events.emit('buildingChanged', full.plant);
    view.buildings.flushLod();
    view.effects.update();
    expect(view.buildings.getVisual(low.plant.id)!.activity).toBe(0);
    expect(view.buildings.getVisual(full.plant.id)!.activity).toBe(0);
    expect(particles(view, low.plant.id)).toBe(0);
    expect(particles(view, full.plant.id)).toBe(0);
  });

  it('supplies unavailable local utilities through the actual caller as null and no plume', () => {
    const state = town(), plant = place(state, 'util_coal_plant', 8, 8), host = local(state);
    const view = createView(host);
    expect(view.buildings.plantLoad?.(plant.id)).toBeNull();
    expect(view.buildings.getVisual(plant.id)!.activity).toBe(0);
    expect(particles(view, plant.id)).toBe(0);
  });

  it('keeps the real object view active when the host has not acquired the optional load reader', () => {
    const state = town(), plant = place(state, 'util_coal_plant', 8, 8), host = local(state);
    // Packet hosts have this water-only view until T061 adds forwarding.
    delete host.utilities.plantLoad;
    const view = createView(host);
    expect(view.buildings.plantLoad?.(plant.id)).toBeNull();
    expect(view.buildings.getVisual(plant.id)!.activity).toBe(0);
    expect(particles(view, plant.id)).toBe(0);
  });
});
