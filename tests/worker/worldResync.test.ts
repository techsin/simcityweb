/**
 * NOTE-041 item 2 (T034): on a resync's adopt, WorldView rebuilds from the fresh replica, as a city load does, and keeps
 * the camera. Through T032's loopback host with a forced resync; no WebGL, so the view's own reset path runs on
 * stand-in renderers (as exitRetention.test.ts stands in for its teardown).
 */
import { describe, expect, it } from 'vitest';
import type { Emitter } from '../../src/core/events';
import type { CityState } from '../../src/sim/CityState';
import type { CityEvents } from '../../src/sim/Simulation';
import { WorldView } from '../../src/render/world/WorldView';
import { LoopbackSimHost } from '../../src/worker/LoopbackSimHost';
import { newState, place } from '../infra/cityGen';

/** a WorldView without its constructor: its events, setState and the renderers that state reaches */
function standInView(events: Emitter<CityEvents>, state: CityState, getState?: () => CityState) {
  const rebuilt: CityState[] = [], camera = { target: { x: 120, y: 4, z: 96 }, distance: 640, yaw: 0.7, tilt: 52, shake() {} };
  const view = Object.create(WorldView.prototype) as Record<string, unknown>;
  Object.assign(view, {
    state, getState, events, unsub: [], shForce: 0, timeForce: false, cameraController: camera,
    terrain: { reset: (s: CityState) => rebuilt.push(s), heightRange: () => [0, 1], markCells() {}, onTerrainChanged() {}, onLayerUpdated() {}, setMonth() {}, worldHeight: () => 0 },
    trees: { reset: (s: CityState) => { if (s !== rebuilt.at(-1)) throw new Error('trees and terrain rebuilt from different states'); }, onCellsChanged() {}, setMonth() {} },
    sky: { setClimate() {} }, water: { updateOuter() {} },
  });
  (WorldView.prototype as unknown as { bindEvents(this: object): void }).bindEvents.call(view);
  return { view, rebuilt, camera };
}

describe('WorldView on a resync (NOTE-041)', () => {
  it('rebuilds from the fresh replica the host adopted, and keeps the camera', async () => {
    const st = newState(32);
    place(st, 't_r1', 4, 4);
    const host = new LoopbackSimHost(st, { initialSpeed: 0 });
    await host.start();
    try {
      const wired = standInView(host.events, host.state, () => host.state);
      const pose = JSON.stringify(wired.camera);
      // without the accessor (the old handler): the view re-reads the state it was built with
      const stale = standInView(host.events, host.state);
      const old = host.state;
      host.harness.resync();
      expect(host.state).not.toBe(old);
      expect(wired.rebuilt).toHaveLength(1);
      expect(wired.rebuilt[0]).toBe(host.state);
      expect(wired.view.state).toBe(host.state);
      expect(wired.rebuilt[0].buildings.size).toBe(1);
      expect(wired.view.shForce, 'shadows re-render as after a load').toBe(30);
      expect(JSON.stringify(wired.camera)).toBe(pose);
      expect(stale.rebuilt[0]).toBe(old);
    } finally { await host.dispose(); }
  });
});
