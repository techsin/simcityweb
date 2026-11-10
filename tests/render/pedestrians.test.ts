/** FEEL-25: bounded, replica-only street life. No WebGL or wall-clock timing assertions. */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CELL_SIZE } from '../../src/core/constants';
import { Network } from '../../src/core/types';
import { RNG } from '../../src/core/rng';
import { type Building, type CityState } from '../../src/sim/CityState';
import { Pedestrians, pedestrianActivityAt } from '../../src/render/city/Pedestrians';
import { CURB_H, HALF_W, LIFT, NF_TUNNEL, NetInfo } from '../../src/render/city/common/netinfo';
import { RoadSurface } from '../../src/render/city/common/surface';
import type { QualityLevel } from '../../src/render/contracts';
import { newState, roadLine } from '../infra/cityGen';

function city(size = 64, type = Network.Road, vertical = false): CityState {
  const st = newState(size);
  const homes: Building[] = [];
  for (let z = 4; z < size - 3; z += 4) {
    roadLine(st, vertical ? z : 1, vertical ? 1 : z, vertical ? z : size - 2, vertical ? size - 2 : z, type);
    for (let x = 1; x < size - 1; x++) for (const side of [-1, 1]) {
      const b: Building = {
        id: st.nextBuildingId++, def: 't_r2', x: vertical ? z + side : x, z: vertical ? x : z + side,
        w: 1, d: 1, rot: 0, variant: 0, pop: 0, jobs: 0, capacity: 60, wealth: 1, built: 1,
        age: 100, flags: 0, baseY: 5, health: 1, unhappy: 0,
      };
      homes.push(b);
      st.buildings.set(b.id, b);
      st.building[st.idx(b.x, b.z)] = b.id;
    }
  }
  for (const b of homes) b.pop = 50000 / homes.length;
  st.stats.population = 50000;
  return st;
}

function camera(size: number, height = 120): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 4000);
  cam.position.set(size * CELL_SIZE / 2, 5 + height, size * CELL_SIZE / 2);
  cam.lookAt(cam.position.x, 5, cam.position.z);
  cam.updateMatrixWorld();
  return cam;
}

function setup(st = city(), quality: QualityLevel = 'high') {
  const net = new NetInfo(st), surf = new RoadSurface(st, net), cam = camera(st.size);
  const people = new Pedestrians(st, net, surf, quality);
  const settle = (hour = 12) => { for (let k = 0; k < 30; k++) people.update(0, cam, hour); };
  return { st, net, surf, cam, people, settle };
}

function positions(people: Pedestrians): THREE.Vector3[] {
  const matrix = new THREE.Matrix4();
  return Array.from({ length: people.mesh.count }, (_, i) => {
    people.mesh.getMatrixAt(i, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  });
}

describe('FEEL-25 street life', () => {
  it.each(['low', 'medium', 'high', 'ultra'] as const)('50k at 120 m: >=20 by day, <=20%% at 3 am (%s)', (quality) => {
    const { people, cam, settle } = setup(city(), quality);
    try {
      for (const oblique of [false, true]) {
        if (oblique) {
          const tilt = 52 * Math.PI / 180, yaw = Math.PI / 4, centre = 32 * CELL_SIZE;
          cam.position.set(centre - Math.sin(yaw) * Math.cos(tilt) * 120, 5 + Math.sin(tilt) * 120, centre + Math.cos(yaw) * Math.cos(tilt) * 120);
          cam.lookAt(centre, 5, centre); cam.updateMatrixWorld();
          people.clear();
        }
        settle();
        const day = people.mesh.count;
        expect(day).toBeGreaterThanOrEqual(20);
        people.update(0, cam, 3);
        expect(people.mesh.count).toBeGreaterThan(0);
        expect(people.mesh.count).toBeLessThanOrEqual(Math.floor(day * 0.15 * 1.33));
        expect(people.mesh.count).toBeLessThanOrEqual(day * 0.2);
        people.update(0, cam, 12);
        expect(people.mesh.count).toBe(day);
      }
    } finally { people.dispose(); }
  });

  it('has smooth time shoulders, a late-night tail and wrapped hours', () => {
    expect(pedestrianActivityAt(3)).toBe(0.15);
    expect(pedestrianActivityAt(27)).toBe(0.15);
    expect(pedestrianActivityAt(-21)).toBe(0.15);
    expect(pedestrianActivityAt(12)).toBe(1);
    expect(pedestrianActivityAt(7)).toBeGreaterThan(pedestrianActivityAt(5));
    expect(pedestrianActivityAt(21)).toBeLessThan(pedestrianActivityAt(19));
    expect(pedestrianActivityAt(24 - 1e-6)).toBeCloseTo(pedestrianActivityAt(0), 5);
  });

  it.each(['low', 'medium', 'high', 'ultra'] as const)('bounds a saturated 1M city on %s, with one opaque draw and no shadow draws', (quality) => {
    const st = city(); st.stats.population = 1_000_000;
    const { people, cam, settle } = setup(st, quality);
    cam.fov = 110; cam.updateProjectionMatrix();
    people.getActivity = () => ({ customers: 10000, visitors: 10000, riders: 10000 });
    try {
      settle();
      expect(people.mesh.count).toBe(({ low: 120, medium: 300, high: 600, ultra: 600 })[quality]);
      expect(people.mesh.instanceMatrix.count).toBe(600);
      expect(people.mesh.geometry.groups).toHaveLength(0);
      expect(Array.isArray(people.mesh.material)).toBe(false);
      expect(people.mesh.material.transparent).toBe(false);
      expect(people.mesh.castShadow).toBe(false);
      expect(people.mesh.visible).toBe(true);
    } finally { people.dispose(); }
  });

  it.each([Network.Street, Network.Road, Network.Avenue, Network.OneWay])('walks along both axes of type %i sidewalks at the road surface height', (type) => {
    for (const vertical of [false, true]) {
      const { st, people, cam, surf, settle } = setup(city(64, type, vertical));
      try {
        settle();
        const before = positions(people);
        expect(before.length).toBeGreaterThan(20);
        people.update(0.25, cam, 12);
        const after = positions(people);
        expect(after.some((p, i) => before[i] && p.distanceTo(before[i]) > 0.1)).toBe(true);
        for (const p of after) {
          const lateral = (vertical ? p.x : p.z) % CELL_SIZE - CELL_SIZE / 2;
          expect(Math.abs(lateral)).toBeGreaterThan(HALF_W[type] + 0.225);
          expect(Math.abs(lateral)).toBeLessThan(CELL_SIZE / 2 - 0.225);
          expect(p.y).toBeCloseTo(surf.base(p.x, p.z) + LIFT + CURB_H, 4);
          expect(st.network[st.idx(Math.floor(p.x / CELL_SIZE), Math.floor(p.z / CELL_SIZE))]).toBe(type);
        }
      } finally { people.dispose(); }
    }
  });

  it('uses bridge decks, hides tunnels / crossings / width transitions and removes demolished paths immediately', () => {
    const { st, people, net, surf, cam, settle } = setup();
    try {
      settle();
      const p = positions(people)[0], x = Math.floor(p.x / CELL_SIZE), z = Math.floor(p.z / CELL_SIZE), i = st.idx(x, z);
      net.bAxis[i] = 0; net.bStart[i] = x * CELL_SIZE; net.bLen[i] = CELL_SIZE; net.bRise[i] = 8;
      people.update(0, cam, 12);
      const onCell = () => positions(people).filter((q) => Math.floor(q.x / CELL_SIZE) === x && Math.floor(q.z / CELL_SIZE) === z);
      expect(onCell().length).toBeGreaterThan(0);
      for (const q of onCell()) expect(q.y).toBeCloseTo(surf.baseIn(i, q.x, q.z) + LIFT + CURB_H, 4);
      st.netFlags[i] |= NF_TUNNEL;
      people.update(0, cam, 12); expect(onCell()).toEqual([]);
      st.netFlags[i] = 0; net.crossing[i] = 1;
      people.update(0, cam, 12); expect(onCell()).toEqual([]);
      net.crossing[i] = 0; net.bCross[i] = 1;
      people.update(0, cam, 12); expect(onCell()).toEqual([]);
      net.bCross[i] = 0; net.roadType[i + 1] = Network.Avenue;
      people.update(0, cam, 12); expect(onCell()).toEqual([]);
      net.roadType[i + 1] = Network.Road; st.network[i] = Network.None;
      net.update({ x0: x, z0: z, x1: x + 1, z1: z + 1 });
      people.update(0, cam, 12); expect(onCell()).toEqual([]);
    } finally { people.dispose(); }
  });

  it('spawns inside 350 m, draws nothing beyond 600 m or out of view, and skips far uploads / discovery', () => {
    const { people, cam, settle } = setup();
    try {
      settle();
      for (const p of positions(people)) expect(p.distanceTo(cam.position)).toBeLessThan(350);
      cam.lookAt(cam.position.x, 500, cam.position.z); cam.updateMatrixWorld();
      people.update(0, cam, 12);
      expect(people.mesh.count).toBe(0);
      cam.lookAt(cam.position.x, 5, cam.position.z); cam.updateMatrixWorld();
      people.update(0, cam, 12); expect(people.mesh.count).toBeGreaterThan(0);
      const feed = vi.fn(() => ({ customers: 10000, visitors: 0, riders: 0 }));
      people.getActivity = feed;
      const version = people.mesh.instanceMatrix.version;
      cam.position.y = 606; cam.lookAt(cam.position.x, 5, cam.position.z); cam.updateMatrixWorld();
      people.update(1, cam, 12);
      expect(people.mesh.visible).toBe(false);
      expect(people.mesh.count).toBe(0);
      expect(people.mesh.instanceMatrix.version).toBe(version);
      expect(feed).not.toHaveBeenCalled();
    } finally { people.dispose(); }
  });

  it('bounds nearby discovery work at 1M, never iterates buildings, reads derived layers, or draws from sim RNG', () => {
    const st = city(128); st.stats.population = 1_000_000;
    const { people, cam } = setup(st);
    const next = vi.spyOn(RNG.prototype, 'next').mockImplementation(() => { throw new Error('sim RNG'); });
    const get = vi.spyOn(st.buildings, 'get');
    const values = vi.spyOn(st.buildings, 'values').mockImplementation(() => { throw new Error('city scan'); });
    Object.defineProperty(st, 'visitors', { get: () => { throw new Error('unsubscribed visitors'); } });
    Object.defineProperty(st, 'transitCov', { get: () => { throw new Error('unsubscribed transit'); } });
    try {
      for (let k = 0; k < 30; k++) {
        get.mockClear();
        people.update(0, cam, 12);
        expect(get.mock.calls.length).toBeLessThanOrEqual(80 * 4);
      }
      expect(people.mesh.count).toBeGreaterThan(0);
      expect(values).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    } finally { people.dispose(); vi.restoreAllMocks(); }
  });

  it('uses the optional streamed customers, visitors and riders independently on the next bounded refresh', () => {
    const { people, settle, cam } = setup();
    const activity = { customers: 0, visitors: 0, riders: 0 };
    people.getActivity = () => activity;
    try {
      settle(); expect(people.mesh.count).toBe(0);
      for (const key of ['customers', 'visitors', 'riders'] as const) {
        activity[key] = 200;
        people.update(1, cam, 12); settle();
        expect(people.mesh.count).toBeGreaterThanOrEqual(20);
        activity[key] = 0;
        people.update(1, cam, 12); settle();
        expect(people.mesh.count).toBe(0);
      }
    } finally { people.dispose(); }
  });

  it('copies the 20-triangle person in four coats, preserves skin, and adds rain umbrellas in the same draw', () => {
    const { people, cam, settle } = setup();
    try {
      settle();
      const dry = people.mesh.geometry, count = people.mesh.count;
      expect(dry.getAttribute('position').count / 3).toBe(20);
      expect(Array.from(dry.getAttribute('coatMask').array).reduce((a, b) => a + b)).toBe(30);
      const colors = people.mesh.instanceColor!.array;
      const coats = new Set(Array.from({ length: count }, (_, i) => Array.from(colors.slice(i * 3, i * 3 + 3)).join(',')));
      expect(coats.size).toBe(4);
      people.update(0, cam, 12, true);
      expect(people.mesh.count).toBe(count);
      expect(people.mesh.geometry).not.toBe(dry);
      expect(people.mesh.geometry.getAttribute('position').count / 3).toBe(36);
      expect(people.mesh.geometry.groups).toHaveLength(0);
      people.update(0, cam, 12, false);
      expect(people.mesh.geometry).toBe(dry);
    } finally { people.dispose(); }
  });

  it('is deterministic and leaves mirrored records / arrays unchanged while walking', () => {
    const a = setup(), b = setup(a.st);
    const network = a.st.network.slice(), buildings = structuredClone(a.st.buildings), stats = structuredClone(a.st.stats);
    try {
      for (const dt of [...Array<number>(30).fill(1 / 60), 0.5, 0.1, 1, 0.2]) {
        a.people.update(dt, a.cam, 12); b.people.update(dt, b.cam, 12);
      }
      expect(a.people.mesh.count).toBeGreaterThan(20);
      expect(a.people.mesh.instanceMatrix.array).toEqual(b.people.mesh.instanceMatrix.array);
      expect(a.st.network).toEqual(network);
      expect(a.st.buildings).toEqual(buildings);
      expect(a.st.stats).toEqual(stats);
      expect(a.people.mesh.instanceMatrix.updateRanges).toEqual([{ start: 0, count: a.people.mesh.count * 16 }]);
      expect(a.people.mesh.instanceColor!.updateRanges).toEqual([{ start: 0, count: a.people.mesh.count * 3 }]);
    } finally { a.people.dispose(); b.people.dispose(); }
  });
});
