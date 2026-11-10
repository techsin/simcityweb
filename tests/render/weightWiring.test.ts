/** FEEL-14: live city events feed detached collapse, demolition dust, ash and deferred plop landings. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CityObjectsView } from '../../src/render/city/CityObjectsView';
import { BF, CityState, type Building } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';
import { placeBuilding, removeBuilding } from '../../src/sim/economy/buildings';

type FeedbackView = {
  flushFeedback(dt: number): void;
  removalFeedback: unknown[];
  landingFeedback: Set<number>;
};
const captured = (view: CityObjectsView) => (view.buildings as unknown as { capturedCollapses: Map<unknown, unknown> }).capturedCollapses;
const feedback = (view: CityObjectsView) => view as unknown as FeedbackView;
const views = new Set<CityObjectsView>();

afterEach(() => {
  for (const view of views) view.dispose();
  views.clear();
  vi.restoreAllMocks();
});

function building(st: CityState, extra: Partial<Building> = {}): Building {
  return { id: st.nextBuildingId++, def: 'res_cottage', x: 8, z: 8, w: 2, d: 2, rot: 0, variant: 0,
    pop: 20, jobs: 0, capacity: 40, wealth: 1, built: 1, age: 100, flags: 0, baseY: 5, health: 1, unhappy: 0, ...extra };
}

function town(initial: Partial<Building>[] = []) {
  const st = new CityState(defaultCityConfig({ size: 32, seed: 7, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
  st.heights.fill(5);
  const sim = new Simulation(st), scene = new THREE.Scene();
  const seeded = initial.map((extra) => {
    const b = building(st, extra);
    placeBuilding(sim, b);
    return b;
  });
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, 1, 10000);
  camera.position.set(144, 185, 384);
  camera.lookAt(144, 5, 144);
  camera.updateMatrixWorld();
  const view = new CityObjectsView(st, sim.events, { scene, camera,
    renderer: { domElement: { height: 1080 } } as THREE.WebGLRenderer,
    canvas: {} as HTMLCanvasElement, getState: () => sim.state });
  views.add(view);
  const impact = vi.spyOn(view.effects, 'impact');
  const queue = vi.spyOn(view.buildings, 'queueCollapse');
  const flush = (dt = 0) => feedback(view).flushFeedback(dt);
  return { st, sim, scene, camera, view, seeded, impact, queue, flush };
}

function lots(n: number): Partial<Building>[] {
  return Array.from({ length: n }, (_, i) => ({ x: 2 + i % 7 * 4, z: 2 + Math.floor(i / 7) * 4 }));
}

describe('CityObjectsView weight feedback wiring', () => {
  it('retains a drawn removal immediately, then admits its detached collapse and dust', () => {
    const { sim, view, seeded: [b], impact, queue, flush } = town([{}]);
    const visual = view.buildings.getVisual(b.id)!;
    const capture = vi.spyOn(view.buildings, 'captureCollapse');
    removeBuilding(sim, b);
    expect(view.buildings.getVisual(b.id)).toBeNull();
    expect(capture).toHaveBeenCalledExactlyOnceWith(b.id);
    expect(queue).not.toHaveBeenCalled();
    expect(impact).not.toHaveBeenCalled();
    expect(view.buildings.batch.instanceCount).toBe(1);
    expect(captured(view).size).toBe(1);
    flush();
    expect(queue).toHaveBeenCalledTimes(1);
    expect(queue.mock.calls[0][0]).toBe(capture.mock.results[0].value);
    expect(queue.mock.calls[0][0].parts.length).toBeGreaterThan(0);
    expect(view.buildings.collapsing).toBe(1);
    expect(captured(view).size).toBe(0);
    expect(impact).toHaveBeenCalledExactlyOnceWith({ cx: visual.cx, cz: visual.cz, baseY: visual.baseY,
      sw: visual.sw, sd: visual.sd }, 'dust');
    flush();
    expect(queue).toHaveBeenCalledTimes(1);
    expect(impact).toHaveBeenCalledTimes(1);
  });

  it('clears rubble with ash and no collapse, even when a growable immediately occupies its lot', () => {
    const { st, sim, view, seeded: [b], impact, queue, flush } = town([{ flags: BF.Burnt }]);
    const visual = view.buildings.getVisual(b.id)!;
    const capture = vi.spyOn(view.buildings, 'captureCollapse');
    removeBuilding(sim, b);
    placeBuilding(sim, building(st, { x: b.x, z: b.z }));
    flush();
    expect(capture).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
    expect(impact).toHaveBeenCalledExactlyOnceWith({ cx: visual.cx, cz: visual.cz, baseY: visual.baseY,
      sw: visual.sw, sd: visual.sd }, 'ash');
  });

  it('limits both redevelopment copy and dust to four in every rolling second', () => {
    const { st, sim, view, seeded, impact, queue, flush } = town(lots(12));
    const discard = vi.spyOn(view.buildings, 'discardCollapse');
    const redevelop = (start: number, dt: number) => {
      for (const old of seeded.slice(start, start + 2)) {
        removeBuilding(sim, old);
        placeBuilding(sim, building(st, { x: old.x, z: old.z }));
      }
      flush(dt);
      expect(captured(view).size).toBe(0);
      expect(view.buildings.batch.instanceCount).toBe(view.buildings.count + view.buildings.collapsing);
    };
    redevelop(0, 0);
    expect(impact).toHaveBeenCalledTimes(2);
    redevelop(2, 0.6);
    expect(impact).toHaveBeenCalledTimes(4);
    redevelop(4, 0.39);
    expect(impact).toHaveBeenCalledTimes(4);
    redevelop(6, 0.02);
    expect(impact).toHaveBeenCalledTimes(6);
    redevelop(8, 0.58);
    expect(impact).toHaveBeenCalledTimes(6);
    redevelop(10, 0.02);
    expect(impact).toHaveBeenCalledTimes(8);
    expect(queue).toHaveBeenCalledTimes(8);
    expect(discard).toHaveBeenCalledTimes(4);
    expect(impact.mock.calls.every(([, kind]) => kind === 'dust')).toBe(true);
    expect(queue.mock.calls.map(([copy]) => [copy.cx, copy.cz])).toEqual(
      [0, 1, 2, 3, 6, 7, 10, 11].map((i) => [(seeded[i].x + 1) * 16, (seeded[i].z + 1) * 16]));
  });

  it('does not treat an unrelated growable or an overlapping plop as redevelopment', () => {
    const { st, sim, seeded, impact, queue, flush } = town(lots(7));
    for (const old of seeded.slice(0, 4)) {
      removeBuilding(sim, old);
      placeBuilding(sim, building(st, { x: old.x, z: old.z }));
    }
    flush();
    const [, , , , ordinary, plopLot, limited] = seeded;
    removeBuilding(sim, ordinary);
    placeBuilding(sim, building(st, { x: 28, z: 28 }));
    removeBuilding(sim, plopLot);
    placeBuilding(sim, building(st, { x: plopLot.x, z: plopLot.z, flags: BF.Plopped }));
    removeBuilding(sim, limited);
    placeBuilding(sim, building(st, { x: limited.x, z: limited.z }));
    flush();
    expect(impact).toHaveBeenCalledTimes(6);
    expect(queue).toHaveBeenCalledTimes(6);
    expect(impact.mock.calls.slice(4).map(([visual, kind]) => [visual.cx, visual.cz, kind])).toEqual(
      [ordinary, plopLot].map((b) => [(b.x + 1) * 16, (b.z + 1) * 16, 'dust']));
  });

  it('lands a live plop on its first queued visual and never repeats on later visual changes', () => {
    const { st, sim, view, impact, queue } = town();
    const b = building(st, { flags: BF.Plopped });
    placeBuilding(sim, b);
    expect(view.buildings.getVisual(b.id)).toBeNull();
    expect(impact).not.toHaveBeenCalled();
    view.buildings.update(0);
    const visual = view.buildings.getVisual(b.id)!;
    expect(impact).toHaveBeenCalledExactlyOnceWith(visual, 'landing');
    expect(queue).not.toHaveBeenCalled();
    b.variant++;
    sim.events.emit('buildingChanged', b);
    view.buildings.update(0);
    view.buildings.onVisual?.(view.buildings.getVisual(b.id), b.id);
    expect(impact).toHaveBeenCalledTimes(1);
  });

  it('cancels an unbuilt plop landing when removed and when its id is replaced', () => {
    const { st, sim, view, impact, queue, flush } = town();
    const removed = building(st, { flags: BF.Plopped });
    placeBuilding(sim, removed);
    removeBuilding(sim, removed);
    placeBuilding(sim, building(st, { id: removed.id }));
    view.buildings.update(0);
    const replaced = building(st, { x: 12, flags: BF.Plopped });
    placeBuilding(sim, replaced);
    placeBuilding(sim, building(st, { id: replaced.id, x: 12 }));
    view.buildings.update(0);
    flush();
    expect(impact).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
    expect(feedback(view).landingFeedback.size).toBe(0);
  });

  it('admits removal feedback at 2,200 m and skips captures beyond that distance', () => {
    const { sim, camera, view, seeded, impact, queue, flush } = town([{}, { x: 12 }]);
    const capture = vi.spyOn(view.buildings, 'captureCollapse');
    const near = view.buildings.getVisual(seeded[0].id)!;
    camera.position.set(near.cx, near.baseY, near.cz + 2200);
    removeBuilding(sim, seeded[0]);
    flush();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledTimes(1);
    expect(impact).toHaveBeenCalledTimes(1);
    const far = view.buildings.getVisual(seeded[1].id)!;
    camera.position.set(far.cx, far.baseY, far.cz + 2200.01);
    removeBuilding(sim, seeded[1]);
    flush();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledTimes(1);
    expect(impact).toHaveBeenCalledTimes(1);
  });

  it('passes the current camera to Effects before a distant queued plop lands', () => {
    const { st, sim, camera, view, flush } = town();
    camera.position.set(144, 5, 3000);
    placeBuilding(sim, building(st, { flags: BF.Plopped }));
    flush();
    view.buildings.update(0);
    view.effects.update();
    expect(view.effects.particleCount).toBe(0);
    expect(feedback(view).landingFeedback.size).toBe(0);
  });

  it('frees retained removal slots when the camera leaves range before feedback admission', () => {
    const { sim, camera, view, seeded: [b], flush } = town([{}]);
    removeBuilding(sim, b);
    expect(captured(view).size).toBe(1);
    expect(view.buildings.batch.instanceCount).toBe(1);
    camera.position.set(144, 5, 3000);
    flush();
    expect(captured(view).size).toBe(0);
    expect(view.buildings.collapsing).toBe(0);
    expect(view.buildings.batch.instanceCount).toBe(0);
    view.effects.update();
    expect(view.effects.particleCount).toBe(0);
  });

  it('silences bulk loads and resets, clearing active copies and pending removal/landing feedback', () => {
    const { st, sim, view, seeded, impact, queue, flush } = town([{ flags: BF.Plopped }, { x: 12 }]);
    removeBuilding(sim, seeded[0]);
    flush();
    view.buildings.update(0);
    view.effects.update();
    expect(view.buildings.collapsing).toBe(1);
    expect(view.effects.particleCount).toBeGreaterThan(0);
    removeBuilding(sim, seeded[1]);
    const plop = building(st, { flags: BF.Plopped });
    placeBuilding(sim, plop);
    impact.mockClear(); queue.mockClear();
    sim.events.emit('reset', undefined);
    flush();
    view.buildings.update(0);
    view.effects.update();
    expect(view.buildings.getVisual(plop.id)).not.toBeNull();
    expect(view.buildings.collapsing).toBe(0);
    expect(captured(view).size).toBe(0);
    expect(view.buildings.pendingBuilds).toBe(0);
    expect(view.effects.particleCount).toBe(0);
    expect(feedback(view).removalFeedback).toEqual([]);
    expect(feedback(view).landingFeedback.size).toBe(0);
    expect(impact).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
  });

  it('disposes pending feedback and stops handling further city events', () => {
    const { st, sim, scene, view, seeded: [b], impact, queue, flush } = town([{}]);
    removeBuilding(sim, b);
    const plop = building(st, { flags: BF.Plopped });
    placeBuilding(sim, plop);
    view.dispose(); views.delete(view);
    expect(scene.children).not.toContain(view.root);
    expect(feedback(view).removalFeedback).toEqual([]);
    expect(feedback(view).landingFeedback.size).toBe(0);
    flush();
    removeBuilding(sim, plop);
    placeBuilding(sim, building(st, { flags: BF.Plopped }));
    sim.events.emit('reset', undefined);
    expect(impact).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
    expect(view.buildings.collapsing).toBe(0);
    expect(captured(view).size).toBe(0);
  });
});
