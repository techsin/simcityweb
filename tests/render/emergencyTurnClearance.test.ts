/** FEEL-09: the complete truck footprint and settled camera at narrow junctions, without WebGL. */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { CELL_SIZE } from '../../src/core/constants';
import { Network } from '../../src/core/types';
import { HALF_W, NetInfo, junctionFillet } from '../../src/render/city/common/netinfo';
import { RoadSurface } from '../../src/render/city/common/surface';
import { drawnVehiclePosition, EmergencyVehicles, type EmergencyFeed } from '../../src/render/city/vehicles/EmergencyVehicles';
import { vehicleGeometry } from '../../src/render/city/vehicles/VehicleRenderer';
import { CameraController } from '../../src/render/world/CameraController';
import type { EmergencyVehicle, VehiclePos } from '../../src/sim/infra/emergency';
import { EMERG_DAYS_PER_MIN } from '../../src/sim/infra/params';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';

registerAllModels();
const N = 128, SECONDS_PER_DAY = 1.5, CORNER = 60;
const geometry = vehicleGeometry('fire_truck', 0);
geometry.computeBoundingBox();
const bounds = geometry.boundingBox!;
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
  if (process.env.T047_TURN_DIAGNOSTICS) writeFileSync(process.env.T047_TURN_DIAGNOSTICS, JSON.stringify(diagnostics, null, 2), 'utf8');
});

function junction(incoming: Network, outgoing: Network): Uint8Array {
  const network = new Uint8Array(N * N);
  for (let k = 0; k < N; k++) { network[CORNER * N + k] = incoming; network[k * N + CORNER] = outgoing; }
  network[CORNER * N + CORNER] = incoming;
  return network;
}

function route(right: boolean, speed: number): EmergencyVehicle {
  const leg = 40 * CELL_SIZE, nextSpeed = speed === 107 ? 143 : 107;
  const times = [0, leg / speed / SECONDS_PER_DAY / EMERG_DAYS_PER_MIN];
  times.push(times[1] + leg / nextSpeed / SECONDS_PER_DAY / EMERG_DAYS_PER_MIN);
  return {
    id: 7, responder: 'fire', model: 'fire_truck', stationId: 1, incidentId: 2, state: 'outbound',
    path: [CORNER * N + CORNER - 40, CORNER * N + CORNER, (CORNER + (right ? 40 : -40)) * N + CORNER],
    times, legStart: 0, m0: 0, m1: times[2], arrive: times[2] * EMERG_DAYS_PER_MIN, workFrom: 0, hospital: -1,
  };
}

function renderer(v: EmergencyVehicle, network: Uint8Array, time: () => number): EmergencyVehicles {
  const feed: EmergencyFeed = { vehicles: () => [v], incidents: () => [], time };
  const pos = () => ({ x: 0, z: 0, hx: 1, hz: 0, moving: false });
  return Object.assign(Object.create(EmergencyVehicles.prototype), {
    state: { size: N, network }, surf: { y: () => 0, net: { roadType: network } }, feed,
    pos: pos(), beforePos: pos(), afterPos: pos(),
  }) as EmergencyVehicles;
}

/** Exact closest point on the entire oriented bounding rectangle, including the interior of each long side. */
function filletClearance(p: VehiclePos, b: number): number {
  const rf = junctionFillet(b), centre = (CORNER + 0.5) * CELL_SIZE;
  let clearance = Infinity;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const dx = centre + sx * (b + rf) - p.x, dz = centre + sz * (b + rf) - p.z;
    const side = dx * p.hz - dz * p.hx, along = dx * p.hx + dz * p.hz;
    const nearestSide = THREE.MathUtils.clamp(side, bounds.min.x, bounds.max.x);
    const nearestAlong = THREE.MathUtils.clamp(along, bounds.min.z, bounds.max.z);
    clearance = Math.min(clearance, Math.hypot(side - nearestSide, along - nearestAlong) - rf);
  }
  return clearance;
}

describe('emergency junction turn clearance', () => {
  it.each([
    [Network.Road, Network.Road], [Network.Road, Network.Street],
    [Network.Street, Network.Road], [Network.Street, Network.Street],
  ])('keeps the complete truck off the curb fillets at %s/%s junctions', (incoming, outgoing) => {
    const network = junction(incoming, outgoing), b = Math.max(HALF_W[incoming], HALF_W[outgoing]);
    for (const right of [true, false]) {
      const v = route(right, 107), corner = v.times[1] * EMERG_DAYS_PER_MIN;
      let minClearance = Infinity;
      // At least one sample every 0.02 m through both edges of the turn window and its apex.
      for (let k = -2000; k <= 2000; k++) {
        const t = corner + k / 2000 * 2 * CELL_SIZE / 107 / SECONDS_PER_DAY;
        const clearance = filletClearance(drawnVehiclePosition(v, t, N, undefined, network), b);
        minClearance = Math.min(minClearance, clearance);
        expect(clearance).toBeGreaterThanOrEqual(-1e-6);
      }
      diagnostics.push({ incoming, outgoing, right, minClearance });
    }
  });

  it.each([
    [Network.Road, Network.Road], [Network.Road, Network.Street],
    [Network.Street, Network.Road], [Network.Street, Network.Street],
  ])('keeps every settled projected step within 3 px at %s/%s junctions', (incoming, outgoing) => {
    for (const right of [true, false]) for (const speed of [107, 143]) for (const yaw of [45, 135, 225, 315]) {
      const network = junction(incoming, outgoing), v = route(right, speed);
      let time = 0;
      const vehicles = renderer(v, network, () => time), start = vehicles.followPosition(v.id)!;
      const dom = Object.assign(new EventTarget(), {
        clientWidth: 1920, clientHeight: 1080,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
        setPointerCapture() {}, releasePointerCapture() {},
      }) as unknown as HTMLElement;
      const camera = new THREE.PerspectiveCamera(38, 1920 / 1080, 1, 50000);
      const controls = new CameraController(camera, dom, { mapSize: 12000, heightAt: () => 0 });
      controls.setView(start.x, start.z, 260, 50, yaw);
      controls.follow(ahead => vehicles.followPosition(v.id, ahead / SECONDS_PER_DAY));
      const p = new THREE.Vector3();
      let previousX = 960, previousY = 540, maxStep = 0;
      try {
        for (let frame = 1; frame <= v.arrive * SECONDS_PER_DAY * 60; frame++) {
          time = frame / 60 / SECONDS_PER_DAY;
          now += 1000 / 60;
          const drawn = drawnVehiclePosition(v, time, N, undefined, network);
          controls.update(1 / 60);
          p.set(drawn.x, 0, drawn.z).project(camera);
          const x = (p.x + 1) * 960, y = (1 - p.y) * 540;
          // The accepted 3 px rule starts after the camera settles; every corner is several seconds later.
          if (frame > 60) maxStep = Math.max(maxStep, Math.hypot(x - previousX, y - previousY));
          previousX = x; previousY = y;
        }
        diagnostics.push({ incoming, outgoing, right, speed, yaw, maxStep });
        expect(maxStep).toBeLessThanOrEqual(3);
      } finally { controls.dispose(); }
    }
  });

  it('responds to in-place junction width changes without reusing a stale cached radius', () => {
    const v = route(true, 107), t = v.times[1] * EMERG_DAYS_PER_MIN, network = junction(Network.Road, Network.Road);
    const road = drawnVehiclePosition(v, t, N, undefined, network);
    network.set(junction(Network.Street, Network.Street));
    const street = drawnVehiclePosition(v, t, N, undefined, network);
    expect(street.x).toBeGreaterThan(road.x);
    expect(street.z).toBeLessThan(road.z);
    expect(filletClearance(street, HALF_W[Network.Street])).toBeGreaterThanOrEqual(-1e-6);
  });

  it('uses the filleted junction cap on mixed-width two-arm bends, matching the road mesher', () => {
    const network = new Uint8Array(N * N), v = route(true, 107), corner = v.times[1] * EMERG_DAYS_PER_MIN;
    for (let k = 0; k < CORNER; k++) network[CORNER * N + k] = Network.Road;
    for (let k = CORNER; k < N; k++) network[k * N + CORNER] = Network.Street;
    const cross = junction(Network.Street, Network.Road);
    for (let k = -200; k <= 200; k++) {
      const t = corner + k / 200 * 2 * CELL_SIZE / 107 / SECONDS_PER_DAY;
      const p = drawnVehiclePosition(v, t, N, undefined, network);
      expect(p).toEqual(drawnVehiclePosition(v, t, N, undefined, cross));
      expect(filletClearance(p, HALF_W[Network.Road])).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('takes effective crossing widths from the same NetInfo as the rendered road surface', () => {
    const state = new CityState(defaultCityConfig({ size: N, seed: 7, terrain: 'flat' }));
    state.network.set(junction(Network.Street, Network.Street));
    const c = CORNER * N + CORNER, crossing = c - 1;
    state.network[crossing] = Network.Rail;
    state.network[crossing - 1] = Network.Road;
    state.network[crossing - N] = state.network[crossing + N] = Network.Rail;
    const net = new NetInfo(state);
    expect(net.roadType[crossing]).toBe(Network.Road);
    expect(net.edgeHalf(c, 2)).toBe(HALF_W[Network.Road]);
    const v = route(true, 107), t = v.times[1] * EMERG_DAYS_PER_MIN;
    const vehicles = renderer(v, state.network, () => t);
    Object.assign(vehicles, { state, surf: new RoadSurface(state, net) });
    const p = vehicles.followPosition(v.id)!;
    const effective = drawnVehiclePosition(v, t, N, undefined, net.roadType);
    const raw = drawnVehiclePosition(v, t, N, undefined, state.network);
    expect(p.x).toBe(effective.x);
    expect(p.z).toBe(effective.z);
    expect(Math.hypot(p.x - raw.x, p.z - raw.z)).toBeGreaterThan(1);
    expect(filletClearance(effective, HALF_W[Network.Road])).toBeGreaterThanOrEqual(-1e-6);
  });
});
