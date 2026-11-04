/**
 * FEEL-17's CityObjectsView hunk: the building / network events, the per-frame update, a rebuild and a state swap all
 * reach the kerbside garbage, and the stats count its one draw. The PropRenderer tests cover the props themselves.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CELL_SIZE } from '../../src/core/constants';
import { Network } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { placeBuilding, removeBuilding } from '../../src/sim/economy/buildings';
import { CityObjectsView } from '../../src/render/city/CityObjectsView';
import { newState, roadLine } from '../infra/cityGen';

const Z = 14;

function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, 1.5, 1, 4000);
  cam.position.set(16 * CELL_SIZE, 200, 40 * CELL_SIZE);
  cam.lookAt(16 * CELL_SIZE, 0, 16 * CELL_SIZE);
  cam.updateMatrixWorld();
  return cam;
}

/** a 1x1 home on row Z, not yet on the map (placeBuilding adds it and emits buildingAdded) */
function home(st: CityState, x: number, flags: number = BF.NoGarbage): Building {
  return {
    id: st.nextBuildingId++, def: 't_r2', x, z: Z, w: 1, d: 1, rot: 0, variant: 0, pop: 60, jobs: 0, capacity: 60,
    wealth: 1, built: 1, age: 100, flags, baseY: 5, health: 1, unhappy: 0,
  };
}

/** world positions of the drawn garbage instances on the given lot column */
function on(view: CityObjectsView, x: number): THREE.Vector3[] {
  const g = view.props.garbage, m = new THREE.Matrix4(), out: THREE.Vector3[] = [];
  for (let i = 0; i < g.count; i++) {
    g.getMatrixAt(i, m);
    const p = new THREE.Vector3().setFromMatrixPosition(m);
    if (Math.floor(p.x / CELL_SIZE) === x) out.push(p);
  }
  return out;
}

describe('CityObjectsView kerbside garbage wiring (FEEL-17)', () => {
  it('follows building and network events, frames, rebuilds and a state swap; +1 draw call while shown', () => {
    const st = newState(32);
    roadLine(st, 2, Z - 1, 30, Z - 1, Network.Road);
    const sim = new Simulation(st, []);
    const view = new CityObjectsView(st, sim.events, {
      scene: new THREE.Scene(), camera: camera(),
      renderer: { domElement: { height: 720 } } as unknown as THREE.WebGLRenderer,
      canvas: {} as HTMLCanvasElement, getState: () => sim.state,
    });
    const frame = () => view.update(1 / 60);
    // the stats' draw count with and without the garbage mesh, in the same frame (roads and fireworks vary)
    const garbageCalls = () => {
      const g = view.props.garbage, shown = g.visible, n = view.stats().drawCalls;
      g.visible = false;
      const without = view.stats().drawCalls;
      g.visible = shown;
      return n - without;
    };
    try {
      frame();
      expect(view.props.garbage.count).toBe(0);

      // buildingAdded: a flagged lot shows a bag on its first frame; an unflagged one shows nothing
      const a = home(st, 8), plain = home(st, 20, 0);
      placeBuilding(sim, a);
      placeBuilding(sim, plain);
      frame();
      expect(on(view, 8).length).toBe(1);
      expect(on(view, 20).length).toBe(0);
      expect(view.props.garbage.visible).toBe(true);
      expect(garbageCalls()).toBe(1);

      // networkChanged: the bags sit at the road edge, the -Z one (row Z - 1) while only it has a road ...
      for (const p of on(view, 8)) expect(p.z).toBeCloseTo(Z * CELL_SIZE + 0.75, 4);
      roadLine(st, 2, Z - 1, 30, Z - 1, Network.None);
      roadLine(st, 2, Z + 1, 30, Z + 1, Network.Road);
      sim.events.emit('networkChanged', { x0: 2, z0: Z - 1, x1: 30, z1: Z + 1 });
      frame();
      // ... and the building's own front (+Z) once the road moves there
      expect(on(view, 8).length).toBe(1);
      for (const p of on(view, 8)) expect(p.z).toBeCloseTo((Z + 1) * CELL_SIZE - 0.75, 4);

      // buildingChanged: the mirrored flag clearing empties the kerb within the clearing ramp (8-20 days)
      const b = home(st, 14);
      placeBuilding(sim, b);
      frame();
      expect(on(view, 14).length).toBe(1);
      a.flags &= ~BF.NoGarbage;
      sim.events.emit('buildingChanged', a);
      st.day += 21;
      frame();
      expect(on(view, 8).length).toBe(0);
      expect(on(view, 14).length).toBeGreaterThanOrEqual(1);

      // buildingRemoved: the lot's props go on the next frame, and with them the draw
      removeBuilding(sim, b);
      frame();
      expect(view.props.garbage.count).toBe(0);
      expect(view.props.garbage.visible).toBe(false);
      expect(garbageCalls()).toBe(0);

      // rebuildAll (a same-state reset) reads the flags back from the state
      const c = home(st, 22);
      st.buildings.set(c.id, c);
      st.building[st.idx(c.x, c.z)] = c.id;
      sim.events.emit('reset', undefined);
      expect(on(view, 22).length).toBeGreaterThanOrEqual(1);

      // a state swap (a load): the new city's flagged lots show at once, mature; the old city's are gone
      const fresh = newState(32);
      roadLine(fresh, 2, Z - 1, 30, Z - 1, Network.Road);
      const d = home(fresh, 4);
      fresh.buildings.set(d.id, d);
      fresh.building[fresh.idx(d.x, d.z)] = d.id;
      sim.replaceState(fresh);
      expect(on(view, 22).length).toBe(0);
      expect(on(view, 4).length).toBeGreaterThanOrEqual(1);
      expect(on(view, 4).length).toBe(view.props.garbage.count);
    } finally {
      view.dispose();
    }
  });
});
