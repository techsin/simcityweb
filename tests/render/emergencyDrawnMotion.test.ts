/** FEEL-09: the actual drawn lane and camera projected together, without WebGL. */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { CELL_SIZE } from '../../src/core/constants';
import { drawnVehiclePosition, EmergencyVehicles, type EmergencyFeed } from '../../src/render/city/vehicles/EmergencyVehicles';
import { CameraController } from '../../src/render/world/CameraController';
import type { EmergencyVehicle } from '../../src/sim/infra/emergency';
import { EMERG_DAYS_PER_MIN } from '../../src/sim/infra/params';

const N = 256, SECONDS_PER_DAY = 1.5;
const diagnostics: Record<string, number | boolean>[] = [];
let now = 0;
beforeEach(() => {
  now = 0;
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { activeElement: null });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => {
  if (process.env.T047_MOTION_DIAGNOSTICS) writeFileSync(process.env.T047_MOTION_DIAGNOSTICS, JSON.stringify(diagnostics, null, 2), 'utf8');
});

function route(firstSpeed: number): EmergencyVehicle {
  const points = [[30, 30], [80, 30], [80, 70], [44, 70], [44, 110], [84, 110]];
  const times = [0];
  for (let k = 0; k < points.length - 1; k++) {
    const speed = k % 2 === 0 ? firstSpeed : firstSpeed === 107 ? 143 : 107;
    const cells = Math.hypot(points[k + 1][0] - points[k][0], points[k + 1][1] - points[k][1]);
    times.push(times[k] + cells * CELL_SIZE / speed / SECONDS_PER_DAY / EMERG_DAYS_PER_MIN);
  }
  return {
    id: 7, responder: 'fire', model: 'fire_truck', stationId: 1, incidentId: 2, state: 'outbound',
    path: points.map(([x, z]) => z * N + x), times, legStart: 0, m0: 0, m1: times[times.length - 1],
    arrive: times[times.length - 1] * EMERG_DAYS_PER_MIN, workFrom: 0, hospital: -1,
  };
}

function renderer(v: EmergencyVehicle, time: () => number): EmergencyVehicles {
  const feed: EmergencyFeed = { vehicles: () => [v], incidents: () => [], time };
  const pos = () => ({ x: 0, z: 0, hx: 1, hz: 0, moving: false });
  return Object.assign(Object.create(EmergencyVehicles.prototype), {
    state: { size: N }, surf: { y: () => 0 }, feed, pos: pos(), beforePos: pos(), afterPos: pos(),
  }) as EmergencyVehicles;
}

describe('drawn emergency motion and follow projection', () => {
  it.each([
    { firstSpeed: 107, reducedMotion: false }, { firstSpeed: 143, reducedMotion: false },
    { firstSpeed: 107, reducedMotion: true }, { firstSpeed: 143, reducedMotion: true },
  ])('keeps 90-degree turns at $firstSpeed m/s within 3 px at 60 fps (reduced=$reducedMotion)', ({ firstSpeed, reducedMotion }) => {
    for (const yaw of [45, 135, 225, 315]) {
      const v = route(firstSpeed);
      let time = 0;
      const vehicles = renderer(v, () => time), start = vehicles.followPosition(v.id)!;
      const dom = Object.assign(new EventTarget(), {
        clientWidth: 1280, clientHeight: 720,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
        setPointerCapture() {}, releasePointerCapture() {},
      }) as unknown as HTMLElement;
      const camera = new THREE.PerspectiveCamera(38, 1280 / 720, 1, 50000);
      const controls = new CameraController(camera, dom, { mapSize: 12000, heightAt: () => 0 });
      controls.setView(start.x, start.z, 260, 50, yaw);
      controls.follow(ahead => vehicles.followPosition(v.id, ahead / SECONDS_PER_DAY), { reducedMotion });
      const p = new THREE.Vector3();
      const parked = drawnVehiclePosition(v, v.arrive + 1, N);
      let previousX = 640, previousY = 360, maxStep = 0, overThree = 0, frames = 0;
      let maxBox = 0, maxArrivalStep = 0, endpointOvershoot = 0;
      try {
        for (let frame = 1; frame <= (v.arrive * SECONDS_PER_DAY + 2) * 60; frame++) {
          time = frame / 60 / SECONDS_PER_DAY;
          now += 1000 / 60;
          const drawn = drawnVehiclePosition(v, time, N);
          controls.update(1 / 60);
          p.set(drawn.x, 0, drawn.z).project(camera);
          const x = (p.x + 1) * 640, y = (1 - p.y) * 360;
          // Exclude acquisition. Every turn, alternating segment speed and arrival/grace frame is measured.
          if (frame > 36) {
            const step = Math.hypot(x - previousX, y - previousY);
            maxStep = Math.max(maxStep, step);
            if (step > 3) overThree++;
            frames++;
            maxBox = Math.max(maxBox, Math.abs(p.x), Math.abs(p.y));
            if (time >= v.arrive - 0.12 * EMERG_DAYS_PER_MIN) {
              maxArrivalStep = Math.max(maxArrivalStep, step);
              endpointOvershoot = Math.max(endpointOvershoot, controls.target.x - parked.x, controls.target.z - parked.z);
            }
            expect(Math.abs(p.x)).toBeLessThanOrEqual(0.3);
            expect(Math.abs(p.y)).toBeLessThanOrEqual(0.3);
          }
          previousX = x; previousY = y;
        }
        diagnostics.push({ firstSpeed, reducedMotion, yaw, maxStep, overThree, frames, maxBox, maxArrivalStep, endpointOvershoot });
        expect({ firstSpeed, yaw, maxStep, overThree }).toMatchObject({ firstSpeed, yaw, overThree: 0 });
        expect(maxStep).toBeLessThanOrEqual(3);
        expect(endpointOvershoot).toBeLessThanOrEqual(1e-6);
      } finally { controls.dispose(); }
    }
  });

  it('rotates the lane continuously at a corner and stops continuously across the on-scene feed update', () => {
    const v = route(143), corner = v.times[1] * EMERG_DAYS_PER_MIN, h = 1e-6;
    const before = drawnVehiclePosition(v, corner - h, N), after = drawnVehiclePosition(v, corner + h, N);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.001);
    expect(Math.hypot(after.hx - before.hx, after.hz - before.hz)).toBeLessThan(0.001);
    const arrival = drawnVehiclePosition(v, v.arrive, N);
    v.state = 'onScene';
    expect(drawnVehiclePosition(v, v.arrive, N)).toEqual(arrival);
    const parkTime = v.arrive + 0.12 * EMERG_DAYS_PER_MIN;
    const settled = drawnVehiclePosition(v, parkTime, N), later = drawnVehiclePosition(v, parkTime + 1, N);
    expect(later).toEqual(settled);
  });
});
