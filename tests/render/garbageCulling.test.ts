/** Garbage compaction uses cached poses, tight view culling and mirrored road frontage. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { CELL_SIZE } from '../../src/core/constants';
import { Network } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import { TileCuller } from '../../src/render/city/common/batch';
import { PropRenderer } from '../../src/render/city/props/PropRenderer';

registerAllModels();

const renderers: PropRenderer[] = [];
const flat = { terrain: () => 0 };
const close = new THREE.Vector3(256, 180, 256);

function renderer(size = 1024): PropRenderer {
  const props = new PropRenderer(new TileCuller(size, CELL_SIZE, 16));
  renderers.push(props);
  return props;
}

function building(id = 7, extra: Partial<Building> = {}): Building {
  return {
    id, def: 'res_cottage', x: 8, z: 8, w: 2, d: 3, rot: 0, variant: 0,
    pop: 20, jobs: 0, capacity: 30, wealth: 1, built: 1, age: 100,
    flags: BF.NoGarbage, baseY: 0, health: 1, unhappy: 0, ...extra,
  };
}

function positions(props: PropRenderer): THREE.Vector3[] {
  const m = new THREE.Matrix4();
  return Array.from({ length: props.garbage.count }, (_, i) => {
    props.garbage.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  });
}

function view(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, 1.5, 1, 3000);
  camera.position.set(256, 180, 640);
  camera.lookAt(256, 0, 256);
  camera.updateMatrixWorld();
  return camera;
}

function fourItemBuilding(props: PropRenderer): Building {
  for (let id = 1; id <= 32; id++) {
    const b = building(id);
    props.resetGarbage([b], 0);
    props.updateGarbage(0, close, flat);
    if (props.garbage.count === 4) return b;
  }
  throw new Error('No four-item garbage variant');
}

function expectFront(props: PropRenderer, b: Building, rot: number): void {
  expect(props.garbage.count).toBeGreaterThan(0);
  for (const p of positions(props)) {
    const inset = rot === 0 ? (b.z + b.d) * CELL_SIZE - p.z
      : rot === 1 ? (b.x + b.w) * CELL_SIZE - p.x
        : rot === 2 ? p.z - b.z * CELL_SIZE : p.x - b.x * CELL_SIZE;
    expect(inset).toBeCloseTo(0.75, 4);
  }
}

afterEach(() => {
  for (const props of renderers.splice(0)) props.dispose();
  vi.restoreAllMocks();
});

describe('garbage view culling', () => {
  it('omits distant and off-frustum lots, sizes capacity for visible props and keeps cached terrain on pans', () => {
    const props = renderer(), camera = view();
    const near = building(7, { x: 15, z: 15 });
    const surf = { terrain: vi.fn(() => 0) };
    props.resetGarbage([near], 100);
    props.updateGarbage(100, camera, surf);
    const expected = positions(props);
    expect(expected.length).toBeGreaterThan(0);
    const distant = Array.from({ length: 2000 }, (_, i) => building(i + 100, {
      x: 200 + i % 100, z: 200 + Math.floor(i / 100),
    }));
    const behind = Array.from({ length: 40 }, (_, i) => building(i + 3000, {
      x: 14 + i % 5, z: 50 + Math.floor(i / 5),
    }));
    props.resetGarbage([near, ...distant, ...behind], 100);
    props.updateGarbage(100, camera, surf);
    expect(positions(props)).toEqual(expected);
    expect(props.garbage.instanceMatrix.count).toBe(256);
    const sampled = surf.terrain.mock.calls.length;
    const version = props.garbage.instanceMatrix.version;
    for (let i = 1; i <= 5; i++) {
      camera.position.x += 0.01;
      camera.updateMatrixWorld();
      props.updateGarbage(100 + i, camera, surf);
    }
    expect(positions(props)).toEqual(expected);
    expect(surf.terrain).toHaveBeenCalledTimes(sampled);
    expect(props.garbage.instanceMatrix.version).toBe(version);
  });

  it('responds to camera orientation at the same position', () => {
    const props = renderer(), camera = view();
    props.resetGarbage([building(7, { x: 15, z: 15 }), building(8, { x: 15, z: 50 })], 100);
    props.updateGarbage(100, camera, flat);
    expect(props.garbage.count).toBeGreaterThan(0);
    expect(positions(props).every((p) => p.z < camera.position.z)).toBe(true);
    const version = props.garbage.instanceMatrix.version;
    camera.lookAt(256, 0, 1024);
    camera.updateMatrixWorld();
    props.updateGarbage(100, camera, flat);
    expect(props.garbage.count).toBeGreaterThan(0);
    expect(positions(props).every((p) => p.z > camera.position.z)).toBe(true);
    expect(props.garbage.instanceMatrix.version).toBeGreaterThan(version);
  });

  it('culls individual lots in a tile straddled by the frustum', () => {
    const props = renderer(), camera = new THREE.PerspectiveCamera(20, 1, 1, 1000);
    camera.up.set(0, 0, -1);
    camera.position.set(144, 300, 144);
    camera.lookAt(144, 0, 144);
    camera.updateMatrixWorld();
    const a = building(7), b = building(8, { x: 15 });
    props.resetGarbage([a], 100);
    props.updateGarbage(100, camera, flat);
    const expected = positions(props);
    expect(expected.length).toBeGreaterThan(0);
    props.resetGarbage([a, b], 100);
    props.updateGarbage(100, camera, flat);
    expect(positions(props)).toEqual(expected);
  });

  it('refreshes individual distance membership inside the same culler tile without resampling terrain', () => {
    const props = renderer(), b = fourItemBuilding(props);
    const surf = { terrain: vi.fn(() => 0) };
    props.resetGarbage([b], 100);
    props.updateGarbage(100, close, surf);
    const full = positions(props), sampled = surf.terrain.mock.calls.length;
    const edge = new THREE.Vector3(Math.min(...full.map((p) => p.x)) + 900.1, full[0].y, full[0].z);
    const expected = full.filter((p) => p.distanceTo(edge) < 900);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(4);
    props.updateGarbage(100, edge, surf);
    expect(positions(props)).toEqual(expected);
    expect(surf.terrain).toHaveBeenCalledTimes(sampled);
    edge.x += 10;
    props.updateGarbage(100, edge, surf);
    expect(props.garbage.count).toBe(0);
    expect(surf.terrain).toHaveBeenCalledTimes(sampled);
  });

  it('uploads only used matrix and variant ranges after compaction', () => {
    const props = renderer();
    props.resetGarbage([building()], 100);
    props.updateGarbage(100, close, flat);
    const n = props.garbage.count;
    const variants = props.garbage.geometry.getAttribute('garbageVariant') as THREE.InstancedBufferAttribute;
    expect(n).toBeGreaterThan(0);
    expect(props.garbage.instanceMatrix.updateRanges).toEqual([{ start: 0, count: n * 16 }]);
    expect(variants.updateRanges).toEqual([{ start: 0, count: n }]);
    const matrixVersion = props.garbage.instanceMatrix.version, variantVersion = variants.version;
    props.updateGarbage(100, close.clone().addScalar(0.01), flat);
    expect(props.garbage.instanceMatrix.version).toBe(matrixVersion);
    expect(variants.version).toBe(variantVersion);
  });

  it('samples four fixed poses once, including buildup and clearing days, and refreshes only an edited lot', () => {
    const props = renderer(), a = building(7), b = building(8, { x: 40 });
    let raised = false;
    const surf = { terrain: vi.fn((x: number) => raised && x < 400 ? 8 : 0) };
    props.garbageBuildingChanged(a, 0);
    props.garbageBuildingChanged(b, 0);
    props.updateGarbage(0, close, surf);
    expect(surf.terrain).toHaveBeenCalledTimes(8);
    for (let day = 1; day <= 60; day++) props.updateGarbage(day, close, surf);
    props.garbageBuildingChanged({ ...a, flags: 0 }, 60);
    props.updateGarbage(61, close, surf);
    expect(surf.terrain).toHaveBeenCalledTimes(8);
    raised = true;
    props.invalidateGarbage({ x0: a.x, z0: a.z, x1: a.x + a.w, z1: a.z + a.d });
    props.updateGarbage(61, close, surf);
    expect(surf.terrain).toHaveBeenCalledTimes(12);
    for (const p of positions(props)) expect(p.y).toBeCloseTo(p.x < 400 ? 8.08 : 0.08, 5);
    props.garbageBuildingChanged({ ...b, baseY: 12 }, 61);
    props.updateGarbage(61, close, surf);
    expect(surf.terrain).toHaveBeenCalledTimes(16);
    expect(positions(props).filter((p) => p.x >= 400).every((p) => Math.abs(p.y - 12.08) < 1e-4)).toBe(true);
  });
});

describe('garbage mirrored road frontage', () => {
  it.each([0, 1, 2, 3] as const)('uses adjacent road edge %i when the building rotation faces no road', (roadRot) => {
    const props = renderer(64), b = building(7, { rot: ((roadRot + 2) % 4) as Building['rot'] });
    const state = { size: 64, network: new Uint8Array(64 * 64) };
    const x = roadRot === 1 ? b.x + b.w : roadRot === 3 ? b.x - 1 : b.x;
    const z = roadRot === 0 ? b.z + b.d : roadRot === 2 ? b.z - 1 : b.z;
    state.network[z * state.size + x] = Network.Street;
    props.resetGarbage([b], 100);
    props.updateGarbage(100, close, { ...flat, state });
    expectFront(props, b, roadRot);
  });

  it('selects the first road edge, then the next remaining edge after mirrored network invalidation', () => {
    const props = renderer(64), b = building(7, { rot: 3 });
    const state = { size: 64, network: new Uint8Array(64 * 64) };
    const south = (b.z + b.d) * state.size + b.x;
    state.network[b.z * state.size + b.x - 1] = Network.Road;
    state.network[south] = Network.Street;
    state.network[b.z * state.size + b.x + b.w] = Network.Avenue;
    props.resetGarbage([b], 100);
    props.updateGarbage(100, close, { ...flat, state });
    expectFront(props, b, 0);
    state.network[south] = Network.None;
    props.invalidateGarbage({ x0: b.x, z0: b.z + b.d, x1: b.x + 1, z1: b.z + b.d + 1 });
    props.updateGarbage(100, close, { ...flat, state });
    expectFront(props, b, 1);
  });

  it('falls back to the building rotation when only rail fronts the lot', () => {
    const props = renderer(64), b = building(7, { rot: 1 });
    const state = { size: 64, network: new Uint8Array(64 * 64) };
    state.network[(b.z - 1) * state.size + b.x] = Network.Rail;
    props.resetGarbage([b], 100);
    props.updateGarbage(100, close, { ...flat, state });
    expectFront(props, b, 1);
  });
});

describe('garbage session episodes', () => {
  it('preserves buildup on a same-session rebuild and starts mature for a different session', () => {
    const props = renderer(), b = fourItemBuilding(props), session = {};
    props.resetGarbage([], 0, session);
    props.garbageBuildingChanged(b, 0);
    props.updateGarbage(1, close, flat);
    expect(props.garbage.count).toBe(1);
    props.resetGarbage([b], 1, session);
    props.updateGarbage(1, close, flat);
    expect(props.garbage.count).toBe(1);
    props.resetGarbage([b], 1, {});
    props.updateGarbage(1, close, flat);
    expect(props.garbage.count).toBe(4);
  });

  it('retains still-clearing lots on a same-session rebuild and removes demolished lots', () => {
    const props = renderer(), b = fourItemBuilding(props), session = {};
    props.resetGarbage([b], 100, session);
    const cleared = { ...b, flags: 0 };
    props.garbageBuildingChanged(cleared, 100);
    props.updateGarbage(102, close, flat);
    const expected = positions(props);
    expect(expected.length).toBeGreaterThan(0);
    props.resetGarbage([cleared], 102, session);
    props.updateGarbage(102, close, flat);
    expect(positions(props)).toEqual(expected);
    props.resetGarbage([], 102, session);
    props.updateGarbage(102, close, flat);
    expect(props.garbage.count).toBe(0);
  });

  it.each([false, true])('preserves episode scalars when recreating the view, clearing=%s', (clearing) => {
    const props = renderer(), b = fourItemBuilding(props), session = {};
    props.resetGarbage(clearing ? [b] : [], 100, session);
    const current = clearing ? { ...b, flags: 0 } : b;
    props.garbageBuildingChanged(current, 100);
    props.updateGarbage(102, close, flat);
    const expected = positions(props);
    expect(expected.length).toBeGreaterThan(0);
    props.dispose();
    renderers.splice(renderers.indexOf(props), 1);
    const replacement = renderer();
    replacement.resetGarbage([current], 102, session);
    replacement.updateGarbage(102, close, flat);
    expect(positions(replacement)).toEqual(expected);
    replacement.updateGarbage(clearing ? 121 : 160, close, flat);
    expect(replacement.garbage.count).toBe(clearing ? 0 : 4);
  });
});
