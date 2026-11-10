/**
 * T087 (REVIEW-T051 minor 4, and T061 item 5): a plant that delivers 0 MW shows no smoke, on the local host and on a
 * packet host. A nuclear plant shut down by the Nuclear Free Zone stays powered by the grid's other plant and fully
 * staffed, and the sim gives it a valid load of 0, so FEEL-15's plant floor max(0.25, load) kept a quarter plume over
 * it. The hosts now report its load as unavailable: BuildingRenderer's activity is 0 and the plume is at step 0.
 * CityScene's real caller, the object view, the building renderer and the effects run here; only the DOM / WebGL
 * world shell is replaced (as in smokeLocalHost.test.ts).
 */
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
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { LocalSimHost } from '../../src/worker/SimHost';

type Host = LocalSimHost | LoopbackSimHost;
const hosts: Host[] = [], views: CityObjectsView[] = [];
const CONSUMER: BuildingDef = {
  id: 't_t087_smoke_60', name: 'Test 60 MW consumer', model: 'res_cottage', category: 'growable', footprint: [1, 1],
  devType: DevType.R1, zones: [Zone.ResLow], capacity: 100, powerUse: 60, waterUse: 0,
};

afterEach(async () => {
  for (const view of views.splice(0)) view.dispose();
  for (const host of hosts.splice(0)) await host.dispose();
  vi.restoreAllMocks();
});

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

/** One grid: a nuclear plant (1,600 MW) and a hydro station (80 MW) joined by a power line, and a 60 MW consumer the
 *  dam carries alone. */
function town() {
  if (!getDef(CONSUMER.id)) { CATALOG.push(CONSUMER); rebuildCatalogIndex(); }
  const state = new CityState(defaultCityConfig({ size: 64, seed: 7, terrain: 'flat', disasters: false, treeDensity: 0, waterAmount: 0 }));
  state.heights.fill(5);
  state.day = 90;
  const nuclear = place(state, 'util_nuclear_plant', 4, 4);
  const hydro = place(state, 'util_hydro_dam', 4, 20);
  for (let z = nuclear.z + nuclear.d; z < hydro.z; z++) state.powerLines[state.idx(4, z)] = 1;
  place(state, CONSUMER.id, 4, hydro.z + hydro.d);
  return { state, nuclear, hydro };
}

/** CityScene.createViews without DOM / HUD / WebGL: the plant-load caller and the object view are the real ones. */
function createView(host: Host): CityObjectsView {
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
function plumeStep(view: CityObjectsView, id: number): number | undefined {
  return (view.effects as unknown as { plumes: Map<number, { step: number }> }).plumes.get(id)?.step;
}
/** the month's activity refresh and the emitters' upload, as a settled frame */
function settle(view: CityObjectsView): void {
  view.buildings.flushLod();
  view.effects.update();
}

describe('a plant that delivers 0 MW shows no smoke', () => {
  it('local host: the shut-down nuclear plant goes from the idle floor to activity 0 and plume step 0', async () => {
    const { state, nuclear, hydro } = town();
    const host = new LocalSimHost(state), utilities = new UtilitiesSystem();
    hosts.push(host);
    await host.start({ createSystems: () => [utilities] });
    const view = createView(host);
    // 60 of 1,680 MW in use: both plants idle at the floor, and the cooling towers steam at the first step
    expect(view.buildings.plantLoad?.(nuclear.id)).toBeCloseTo(60 / 1680, 6);
    expect(view.buildings.getVisual(nuclear.id)!.activity).toBe(0.25);
    expect(plumeStep(view, nuclear.id)).toBe(1);
    const idle = particles(view, nuclear.id);
    expect(idle).toBeGreaterThan(0);

    state.budget.ordinances.push('nuclear_free_zone');
    utilities.compute(host.sim);
    state.day += 30;
    settle(view);
    // still powered (the dam carries the grid) and fully staffed: the load alone says the plant is off
    expect(nuclear.flags & BF.Powered).toBeTruthy();
    expect(nuclear.jobs / nuclear.capacity).toBe(1);
    expect(utilities.plantLoad(nuclear.id)).toBe(0);
    expect(view.buildings.plantLoad?.(nuclear.id)).toBeNull();
    expect(view.buildings.getVisual(nuclear.id)!.activity).toBe(0);
    expect(plumeStep(view, nuclear.id)).toBe(0);
    expect(particles(view, nuclear.id)).toBe(0);
    // the plant that carries the city keeps its own output
    expect(view.buildings.plantLoad?.(hydro.id)).toBeCloseTo(0.75, 6);
    expect(view.buildings.getVisual(hydro.id)!.activity).toBeCloseTo(0.75, 6);

    // the control: read as the sim's raw load (a valid 0), the same plant would steam at the floor again
    view.buildings.plantLoad = (id) => utilities.plantLoad(id);
    state.day += 30;
    settle(view);
    expect(view.buildings.getVisual(nuclear.id)!.activity).toBe(0.25);
    expect(particles(view, nuclear.id)).toBe(idle);
  });

  it('local host: the repealed ordinance brings the plume back in a later month', async () => {
    const { state, nuclear } = town();
    state.budget.ordinances.push('nuclear_free_zone');
    const host = new LocalSimHost(state), utilities = new UtilitiesSystem();
    hosts.push(host);
    await host.start({ createSystems: () => [utilities] });
    const view = createView(host);
    expect(view.buildings.getVisual(nuclear.id)!.activity).toBe(0);
    expect(particles(view, nuclear.id)).toBe(0);
    state.budget.ordinances.length = 0;
    utilities.compute(host.sim);
    state.day += 30;
    settle(view);
    expect(view.buildings.getVisual(nuclear.id)!.activity).toBe(0.25);
    expect(plumeStep(view, nuclear.id)).toBe(1);
    expect(particles(view, nuclear.id)).toBeGreaterThan(0);
  });

  it('loopback host: the forwarded load draws the plume, and the stream\'s -1 after the shutdown removes it', async () => {
    const { state, nuclear, hydro } = town();
    const utilities = new UtilitiesSystem();
    const host = new LoopbackSimHost(state, { initialSpeed: 0, loopback: { cadence: 'design', modules: { createSystems: () => [utilities] }, recorder: { rollingCount: 0 } } });
    hosts.push(host);
    await host.start();
    const view = createView(host);
    // T087 item 1: the packet host's view has the reader, so the plant is no longer "unavailable" there
    expect(view.buildings.plantLoad?.(nuclear.id)).toBeCloseTo(60 / 1680, 6);
    expect(view.buildings.getVisual(nuclear.id)!.activity).toBe(0.25);
    expect(plumeStep(view, nuclear.id)).toBe(1);
    expect(particles(view, nuclear.id)).toBeGreaterThan(0);

    state.budget.ordinances.push('nuclear_free_zone');
    utilities.compute(host.harness.core.sim);
    host.harness.runDays(30);
    settle(view);
    const mirrored = host.state.buildings.get(nuclear.id)!;
    expect(host.state.day).toBe(120);
    expect(mirrored.flags & BF.Powered).toBeTruthy();
    expect(mirrored.jobs / mirrored.capacity).toBe(1);
    expect(host.utilities.plantLoad(nuclear.id)).toBeNull();
    expect(view.buildings.getVisual(nuclear.id)!.activity).toBe(0);
    expect(plumeStep(view, nuclear.id)).toBe(0);
    expect(particles(view, nuclear.id)).toBe(0);
    expect(view.buildings.getVisual(hydro.id)!.activity).toBeCloseTo(0.75, 6);
  });
});
