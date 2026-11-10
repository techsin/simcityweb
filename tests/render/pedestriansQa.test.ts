/** FEEL-25 QA regressions: avenue lamp clearance and discovery during a fast LOW-quality pan. */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CELL_SIZE } from '../../src/core/constants';
import { Network } from '../../src/core/types';
import { Pedestrians } from '../../src/render/city/Pedestrians';
import { HALF_W, NetInfo } from '../../src/render/city/common/netinfo';
import { RoadSurface } from '../../src/render/city/common/surface';
import { newState, roadLine } from '../infra/cityGen';

function camera(x: number, z: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(70, 1.5, 0.5, 4000);
  cam.position.set(x, 125, z);
  cam.up.set(0, 0, -1);
  cam.lookAt(x, 5, z);
  cam.updateMatrixWorld();
  return cam;
}

describe('FEEL-25 QA regressions', () => {
  it.each([false, true])('keeps avenue bodies clear of lamps through a full walking cycle (vertical=%s)', (vertical) => {
    const st = newState(64), centre = 32 * CELL_SIZE;
    roadLine(st, vertical ? 32 : 1, vertical ? 1 : 32, vertical ? 32 : 62, vertical ? 62 : 32, Network.Avenue);
    const net = new NetInfo(st), surf = new RoadSurface(st, net), cam = camera(centre, centre);
    const people = new Pedestrians(st, net, surf, 'low');
    people.getActivity = () => ({ customers: 400, visitors: 0, riders: 0 });
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3();
    let passedLampLine = false, checked = 0, lateralError = 0;
    let innerClearance = Infinity, outerClearance = Infinity, poleClearance = Infinity;
    try {
      for (let frame = 0; frame < 30; frame++) people.update(0, cam, 12);
      expect(people.mesh.count).toBeGreaterThan(0);
      // Even the slowest walker completes its 24 m out-and-back cycle within 30 seconds.
      for (let frame = 0; frame < 900; frame++) {
        people.update(1 / 30, cam, 12);
        for (let slot = 0; slot < people.mesh.count; slot++) {
          people.mesh.getMatrixAt(slot, matrix);
          point.setFromMatrixPosition(matrix);
          const x = Math.floor(point.x / CELL_SIZE), z = Math.floor(point.z / CELL_SIZE);
          const cx = (x + 0.5) * CELL_SIZE, cz = (z + 0.5) * CELL_SIZE;
          const lateral = vertical ? point.x - cx : point.z - cz;
          const along = vertical ? point.z - cz : point.x - cx;
          checked++;
          lateralError = Math.max(lateralError, Math.abs(Math.abs(lateral) - 7.72));
          innerClearance = Math.min(innerClearance, Math.abs(lateral) - 0.225 - HALF_W[Network.Avenue]);
          outerClearance = Math.min(outerClearance, CELL_SIZE / 2 - Math.abs(lateral) - 0.225);

          // RoadMesher.straight: one pole at along=0, alternating sides, halfWidth + 0.55 m out.
          const side = (x + z) & 1 ? 1 : -1, offset = HALF_W[Network.Avenue] + 0.55;
          const poleX = cx + (vertical ? -side * offset : 0);
          const poleZ = cz + (vertical ? 0 : side * offset);
          const dx = Math.max(0, Math.abs(point.x - poleX) - (vertical ? 0.225 : 0.15));
          const dz = Math.max(0, Math.abs(point.z - poleZ) - (vertical ? 0.15 : 0.225));
          poleClearance = Math.min(poleClearance, Math.hypot(dx, dz) - 0.12);
          const lampSide = vertical ? -side : side;
          if (Math.sign(lateral) === lampSide && Math.abs(along) < 0.03) passedLampLine = true;
        }
      }
      expect(checked).toBeGreaterThan(0);
      expect(lateralError).toBeLessThan(0.001);
      expect(innerClearance).toBeGreaterThan(0);
      expect(outerClearance).toBeGreaterThan(0);
      expect(poleClearance).toBeGreaterThan(0);
      expect(passedLampLine).toBe(true);
    } finally {
      people.dispose();
    }
  });

  it('finishes discovery and keeps drawing through a 132 m/s LOW pan at 30 fps, with bounded work', () => {
    const st = newState(128);
    for (let z = 4; z < st.size - 3; z += 4) roadLine(st, 1, z, st.size - 2, z, Network.Road);
    const net = new NetInfo(st), surf = new RoadSurface(st, net);
    const start = 32 * CELL_SIZE, z = 64 * CELL_SIZE, cam = camera(start, z);
    const people = new Pedestrians(st, net, surf, 'low');
    // One walker per visible cell leaves the LOW cap unfilled, exercising all 26 discovery slices.
    const feed = vi.fn(() => ({ customers: 40, visitors: 0, riders: 0 }));
    people.getActivity = feed;
    // Render counts alone cannot distinguish a completed empty roster from an unfinished scan.
    const progress = people as unknown as { scanning: boolean; cursor: number };
    let completed = 0, shownFrames = 0, firstShown = Infinity;
    try {
      for (let frame = 0; frame < 120; frame++) {
        const x = start + (frame + 1) * 132 / 30;
        cam.position.x = x;
        cam.lookAt(x, 5, z);
        cam.updateMatrixWorld();
        feed.mockClear();
        people.update(1 / 30, cam, 12);
        expect(feed.mock.calls.length).toBeLessThanOrEqual(80);
        expect(people.mesh.count).toBeLessThanOrEqual(120);
        if (!progress.scanning) {
          completed++;
          expect(progress.cursor).toBe(2025);
        }
        if (people.mesh.count > 0) {
          shownFrames++;
          firstShown = Math.min(firstShown, frame + 1);
        }
      }
      expect(completed).toBeGreaterThanOrEqual(3);
      expect(firstShown).toBeLessThanOrEqual(52);
      expect(shownFrames).toBeGreaterThanOrEqual(30);
    } finally {
      people.dispose();
    }
  });
});
