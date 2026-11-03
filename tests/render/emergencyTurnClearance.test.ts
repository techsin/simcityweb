/** FEEL-09: the complete truck footprint and settled camera at narrow junctions, without WebGL. */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { getModelGeometry } from '../../src/assets/registry';
import { CELL_SIZE } from '../../src/core/constants';
import { Network, Surf } from '../../src/core/types';
import { HALF_W, LIFT, NetInfo, junctionFillet } from '../../src/render/city/common/netinfo';
import { RoadSurface } from '../../src/render/city/common/surface';
import { GeoBuf } from '../../src/render/city/roads/geobuf';
import { M, RoadMesher } from '../../src/render/city/roads/mesher';
import { LAMP_LED_BIT } from '../../src/render/city/roads/roadMaterial';
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
const diagnostics: Record<string, number | boolean | string>[] = [];
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

function junction(incoming: Network, outgoing: Network, own = incoming): Uint8Array {
  const network = new Uint8Array(N * N);
  for (let k = 0; k < N; k++) { network[CORNER * N + k] = incoming; network[k * N + CORNER] = outgoing; }
  network[CORNER * N + CORNER] = own;
  return network;
}

const layouts = [
  { name: 'Road/Road', incoming: Network.Road, outgoing: Network.Road },
  { name: 'Road/Street', incoming: Network.Road, outgoing: Network.Street },
  { name: 'Street/Road', incoming: Network.Street, outgoing: Network.Road },
  { name: 'Street/Street', incoming: Network.Street, outgoing: Network.Street },
  { name: 'Street cell, Road/Street arms', incoming: Network.Road, outgoing: Network.Street, own: Network.Street },
  { name: 'Street cell, Street/Road arms', incoming: Network.Street, outgoing: Network.Road, own: Network.Street },
  { name: 'Road L-bend', incoming: Network.Road, outgoing: Network.Road, bend: true },
  { name: 'Street L-bend', incoming: Network.Street, outgoing: Network.Street, bend: true },
];

function turnNetwork(layout: typeof layouts[number], right: boolean, rotation = 0): Uint8Array {
  const network = junction(layout.incoming, layout.outgoing, layout.own ?? layout.incoming);
  if (layout.bend) {
    for (let k = CORNER + 1; k < N; k++) network[CORNER * N + k] = 0;
    for (let k = 0; k < N; k++) if (right ? k < CORNER : k > CORNER) network[k * N + CORNER] = 0;
  }
  if (!rotation) return network;
  const rotated = new Uint8Array(N * N);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const [rx, rz] = rotate(x, z, rotation);
    if (rx >= 0 && rx < N && rz >= 0 && rz < N) rotated[rz * N + rx] = network[z * N + x];
  }
  return rotated;
}

function rotate(x: number, z: number, rotation: number): [number, number] {
  let dx = x - CORNER, dz = z - CORNER;
  for (let k = 0; k < rotation; k++) [dx, dz] = [-dz, dx];
  return [CORNER + dx, CORNER + dz];
}

function route(right: boolean, speed: number, rotation = 0, reverse = false): EmergencyVehicle {
  const leg = 40 * CELL_SIZE, nextSpeed = speed === 107 ? 143 : 107;
  const times = [0, leg / speed / SECONDS_PER_DAY / EMERG_DAYS_PER_MIN];
  times.push(times[1] + leg / nextSpeed / SECONDS_PER_DAY / EMERG_DAYS_PER_MIN);
  const path = [CORNER * N + CORNER - 40, CORNER * N + CORNER, (CORNER + (right ? 40 : -40)) * N + CORNER].map(c => {
    const [x, z] = rotate(c % N, Math.floor(c / N), rotation);
    return z * N + x;
  });
  if (reverse) path.reverse();
  return {
    id: 7, responder: 'fire', model: 'fire_truck', stationId: 1, incidentId: 2, state: 'outbound',
    path,
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

type Point = [number, number];
interface Obstacle { points: Point[]; minX: number; maxX: number; minZ: number; maxZ: number; parts?: Obstacle[]; model?: string; x?: number; z?: number }

function obstacle(points: Point[]): Obstacle {
  return { points, minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
    minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1])) };
}

function clipHeight(points: THREE.Vector3[], height: number, above: boolean): THREE.Vector3[] {
  const clipped: THREE.Vector3[] = [];
  for (let k = 0; k < points.length; k++) {
    const a = points[k], b = points[(k + 1) % points.length];
    const insideA = above ? a.y >= height : a.y <= height, insideB = above ? b.y >= height : b.y <= height;
    if (insideA) clipped.push(a);
    if (insideA !== insideB) clipped.push(a.clone().lerp(b, (height - a.y) / (b.y - a.y)));
  }
  return clipped;
}

/** Build the real raised triangles and prop positions, including the curbs tapering inside a mixed junction cell. */
function roadObstacles(network: Uint8Array): { sidewalk: Obstacle[]; props: Obstacle[]; trees: number; poles: number } {
  const state = new CityState(defaultCityConfig({ size: N, seed: 7, terrain: 'flat' }));
  state.network.set(network);
  state.heights.fill(0);
  const net = new NetInfo(state), surf = new RoadSurface(state, net), mesher = new RoadMesher(net, surf);
  const out = { main: new GeoBuf(), struct: new GeoBuf(), props: [], pools: [] };
  mesher.buildChunk(CORNER - 2, CORNER - 2, CORNER + 3, CORNER + 3, out);
  const sidewalk: Obstacle[] = [], props: Obstacle[] = [];
  for (let k = 0; k < out.main.count; k += 3) {
    let code = out.main.rd[k * 4 + 2];
    if (code >= LAMP_LED_BIT) code -= LAMP_LED_BIT;
    if (Math.floor(code / 64) !== M.SIDEWALK) continue;
    const points: Point[] = [];
    for (let j = 0; j < 3; j++) points.push([out.main.pos[(k + j) * 3], out.main.pos[(k + j) * 3 + 2]]);
    const area = (points[1][0] - points[0][0]) * (points[2][1] - points[0][1]) -
      (points[1][1] - points[0][1]) * (points[2][0] - points[0][0]);
    if (Math.abs(area) > 1e-7) sidewalk.push(obstacle(points));
  }
  let trees = 0, poles = 0;
  for (const prop of out.props as import('../../src/render/city/roads/mesher').PropItem[]) {
    const tree = prop.model.startsWith('tree_');
    if (!tree && prop.model !== 'traffic_light' && prop.model !== 'streetlight') continue;
    const geom = getModelGeometry(prop.model, prop.variant), pos = geom.getAttribute('position'), material = geom.getAttribute('surf');
    // The actual pole/trunk geometry below the truck roof; overhead lamps and tree crowns are not road obstacles.
    const roof = bounds.max.y + LIFT - prop.y, floor = bounds.min.y + LIFT - prop.y;
    const parts: Obstacle[] = [], cs = Math.cos(prop.yaw), sn = Math.sin(prop.yaw);
    for (let k = 0; k < pos.count; k += 3) {
      if (tree && material.getX(k) !== Surf.Wood) continue;
      const triangle = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(pos, k + j).multiplyScalar(prop.scale));
      const clipped = clipHeight(clipHeight(triangle, floor, true), roof, false);
      if (clipped.length) parts.push(obstacle(clipped.map(p =>
        [prop.x + cs * p.x + sn * p.z, prop.z - sn * p.x + cs * p.z] as Point)));
    }
    if (!parts.length) continue;
    props.push({ ...obstacle(parts.flatMap(p => p.points)), parts, model: prop.model, x: prop.x, z: prop.z });
    if (tree) trees++; else poles++;
  }
  return { sidewalk, props, trees, poles };
}

/** Signed separating-axis gap: negative only if the complete oriented truck rectangle overlaps a convex obstacle. */
function separation(p: VehiclePos, item: Obstacle): number {
  const x = p.x + (bounds.min.z + bounds.max.z) / 2 * p.hx;
  const z = p.z + (bounds.min.z + bounds.max.z) / 2 * p.hz;
  const halfX = (bounds.max.x - bounds.min.x) / 2, halfZ = (bounds.max.z - bounds.min.z) / 2;
  const reachX = Math.abs(p.hz) * halfX + Math.abs(p.hx) * halfZ;
  const reachZ = Math.abs(p.hx) * halfX + Math.abs(p.hz) * halfZ;
  let gap = Math.max(item.minX - x - reachX, x - reachX - item.maxX,
    item.minZ - z - reachZ, z - reachZ - item.maxZ);
  if (gap > 0) return gap;
  if (item.parts) return Math.min(...item.parts.map(part => separation(p, part)));
  const axes: Point[] = [[p.hz, -p.hx], [p.hx, p.hz]];
  for (let k = 0; k < item.points.length; k++) {
    const a = item.points[k], b = item.points[(k + 1) % item.points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length > 1e-9) axes.push([(a[1] - b[1]) / length, (b[0] - a[0]) / length]);
  }
  for (const [ax, az] of axes) {
    const mid = x * ax + z * az;
    const radius = halfX * Math.abs(p.hz * ax - p.hx * az) + halfZ * Math.abs(p.hx * ax + p.hz * az);
    let min = Infinity, max = -Infinity;
    for (const [px, pz] of item.points) { const d = px * ax + pz * az; min = Math.min(min, d); max = Math.max(max, d); }
    gap = Math.max(gap, min - mid - radius, mid - radius - max);
    if (gap > 0) return gap;
  }
  return gap;
}

describe('emergency junction turn clearance', () => {
  it.each(layouts)('keeps the complete truck off the real sidewalk, poles and trunks at $name', layout => {
    let minSidewalk = Infinity, minProp = Infinity, trees = 0, poles = 0;
    for (const right of [true, false]) for (let rotation = 0; rotation < 4; rotation++) {
      const network = turnNetwork(layout, right, rotation), obstacles = roadObstacles(network);
      trees += obstacles.trees; poles += obstacles.poles;
      expect(obstacles.sidewalk.length).toBeGreaterThan(0);
      for (const reverse of [false, true]) {
        const v = route(right, 107, rotation, reverse), corner = v.times[1] * EMERG_DAYS_PER_MIN;
        let sidewalkGap = Infinity, propGap = Infinity, worstProp: Obstacle | undefined;
        for (let k = -640; k <= 640; k++) {
          const t = corner + k / 640 * 2 * CELL_SIZE / 107 / SECONDS_PER_DAY;
          const p = drawnVehiclePosition(v, t, N, undefined, network);
          for (const item of obstacles.sidewalk) sidewalkGap = Math.min(sidewalkGap, separation(p, item));
          for (const item of obstacles.props) {
            const gap = separation(p, item);
            if (gap < propGap) { propGap = gap; worstProp = item; }
          }
        }
        minSidewalk = Math.min(minSidewalk, sidewalkGap); minProp = Math.min(minProp, propGap);
        diagnostics.push({ layout: layout.name, right, reverse, rotation, sidewalkGap, propGap,
          propModel: worstProp?.model ?? '', propX: worstProp?.x ?? 0, propZ: worstProp?.z ?? 0 });
      }
    }
    diagnostics.push({ layout: layout.name, minSidewalk, minProp, trees, poles });
    expect(poles).toBeGreaterThan(0);
    // Check the actual props in neighbouring straight cells as well as the corner's signal/outer light.
    if (layout.incoming !== Network.Avenue && layout.outgoing !== Network.Avenue) expect(trees).toBeGreaterThan(0);
    const meshPrecision = N * CELL_SIZE * 2 ** -23;
    expect(minSidewalk).toBeGreaterThanOrEqual(-meshPrecision);
    expect(minProp).toBeGreaterThanOrEqual(-meshPrecision);
  });

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

  it.each(layouts)('keeps every settled projected step within 3 px at $name', layout => {
    for (const right of [true, false]) for (const reverse of [false, true]) for (const speed of [107, 143]) for (const yaw of [45, 135, 225, 315]) {
      const network = turnNetwork(layout, right), v = route(right, speed, 0, reverse);
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
        diagnostics.push({ layout: layout.name, right, reverse, speed, yaw, maxStep });
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
    // Both turn arms must widen: the narrower Street arm correctly limits the cap even beside one Road crossing.
    state.network.set(junction(Network.Street, Network.Road));
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

  it('leaves the pre-existing highway-owned turn path unchanged (N6)', () => {
    const network = junction(Network.Highway, Network.Highway);
    for (const right of [true, false]) {
      const v = route(right, 107), corner = v.times[1] * EMERG_DAYS_PER_MIN;
      for (let k = -200; k <= 200; k++) {
        const t = corner + k / 200 * 2 * CELL_SIZE / 107 / SECONDS_PER_DAY;
        expect(drawnVehiclePosition(v, t, N, undefined, network)).toEqual(drawnVehiclePosition(v, t, N));
      }
    }
  });
});
