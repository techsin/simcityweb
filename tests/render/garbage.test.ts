/** Kerbside garbage is cosmetic: mirrored flag events, deterministic days, one mesh, no WebGL context. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { getModelGeometry } from '../../src/assets/registry';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { CELL_SIZE, DAYS_PER_MONTH } from '../../src/core/constants';
import { RNG } from '../../src/core/rng';
import { BF, type Building } from '../../src/sim/CityState';
import { TileCuller } from '../../src/render/city/common/batch';
import { PropRenderer } from '../../src/render/city/props/PropRenderer';

registerAllModels();

const renderers: PropRenderer[] = [];
const camera = new THREE.Vector3(160, 180, 200);
const flat = { terrain: () => 0 };

function renderer(): PropRenderer {
  const props = new PropRenderer(new TileCuller(64, CELL_SIZE, 16));
  renderers.push(props);
  return props;
}

function building(id = 1, extra: Partial<Building> = {}): Building {
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

function snapshot(props: PropRenderer): { matrices: number[]; variants: number[] } {
  const n = props.garbage.count;
  const a = props.garbage.geometry.getAttribute('garbageVariant');
  return {
    matrices: Array.from(props.garbage.instanceMatrix.array.slice(0, n * 16)),
    variants: Array.from({ length: n }, (_, i) => a.getX(i)),
  };
}

function fourItemLot(props: PropRenderer): Building {
  for (let id = 1; id <= 32; id++) {
    const b = building(id);
    props.resetGarbage([b], 0);
    props.updateGarbage(0, camera, flat);
    if (props.garbage.count === 4) {
      props.resetGarbage([], 0);
      return b;
    }
  }
  throw new Error('No four-item garbage variant');
}

afterEach(() => {
  for (const props of renderers.splice(0)) props.dispose();
  vi.restoreAllMocks();
});

describe('kerbside garbage', () => {
  it.each([0, 1, 2, 3] as const)('places bags at the road front of a rectangular lot rotated %i quarters', (rot) => {
    const props = renderer();
    // w / d are the occupied dimensions after rotation, rather than model dimensions.
    const b = building(7, { rot, w: rot & 1 ? 3 : 2, d: rot & 1 ? 2 : 3, baseY: 4 });
    props.resetGarbage([b], 100);
    props.updateGarbage(100, camera, flat);
    expect(props.garbage.count).toBeGreaterThanOrEqual(1);
    expect(props.garbage.count).toBeLessThanOrEqual(4);
    for (const p of positions(props)) {
      expect(p.x).toBeGreaterThan(b.x * CELL_SIZE);
      expect(p.x).toBeLessThan((b.x + b.w) * CELL_SIZE);
      expect(p.z).toBeGreaterThan(b.z * CELL_SIZE);
      expect(p.z).toBeLessThan((b.z + b.d) * CELL_SIZE);
      const inset = rot === 0 ? (b.z + b.d) * CELL_SIZE - p.z
        : rot === 1 ? (b.x + b.w) * CELL_SIZE - p.x
          : rot === 2 ? p.z - b.z * CELL_SIZE : p.x - b.x * CELL_SIZE;
      expect(inset).toBeCloseTo(0.75, 4);
      expect(p.y).toBeCloseTo(4.08, 5);
    }
  });

  it('grounds every prop on the higher of terrain and lot base and refreshes after a terrain edit', () => {
    const props = renderer(), b = building(7, { w: 1, d: 1, baseY: 3 });
    let raised = false;
    const surf = { terrain: (x: number) => raised ? 6 + x * 0.01 : 1 };
    props.resetGarbage([b], 100);
    props.updateGarbage(100, camera, surf);
    const before = positions(props);
    for (const p of before) expect(p.y).toBeCloseTo(3.08, 5);
    raised = true;
    props.invalidateGarbage();
    props.updateGarbage(100, camera, surf);
    for (const [i, p] of positions(props).entries()) {
      expect(p.x).toBe(before[i].x);
      expect(p.z).toBe(before[i].z);
      expect(p.y).toBeCloseTo(surf.terrain(p.x) + 0.08, 5);
    }
  });

  it('starts with one item and grows monotonically to one through four over one to two months', () => {
    const props = renderer(), targets = new Set<number>();
    for (let id = 1; id <= 32; id++) {
      const b = building(id);
      props.resetGarbage([b], 0);
      props.updateGarbage(0, camera, flat);
      const target = props.garbage.count;
      targets.add(target);
      props.resetGarbage([], 0);
      props.garbageBuildingChanged(b, 0);
      let previous = 1, mature = -1;
      for (let day = 0; day <= 2 * DAYS_PER_MONTH; day++) {
        props.updateGarbage(day, camera, flat);
        const count = props.garbage.count;
        if (day === 0) expect(count, `id ${id}`).toBe(1);
        expect(count).toBeGreaterThanOrEqual(previous);
        expect(count).toBeLessThanOrEqual(target);
        if (count === target && mature < 0) mature = day;
        previous = count;
      }
      expect(previous).toBe(target);
      if (target > 1) {
        expect(mature).toBeGreaterThanOrEqual(DAYS_PER_MONTH);
        expect(mature).toBeLessThanOrEqual(2 * DAYS_PER_MONTH);
      }
      props.updateGarbage(1000, camera, flat);
      expect(props.garbage.count).toBe(target);
    }
    expect([...targets].sort()).toEqual([1, 2, 3, 4]);
  });

  it('clears monotonically over one to two months after collection returns', () => {
    const props = renderer();
    for (let id = 1; id <= 32; id++) {
      const b = building(id);
      props.resetGarbage([b], 100);
      props.updateGarbage(100, camera, flat);
      let previous = props.garbage.count, cleared = -1;
      props.garbageBuildingChanged({ ...b, flags: 0 }, 100);
      for (let day = 100; day <= 100 + 2 * DAYS_PER_MONTH; day++) {
        props.updateGarbage(day, camera, flat);
        expect(props.garbage.count).toBeLessThanOrEqual(previous);
        if (props.garbage.count === 0 && cleared < 0) cleared = day - 100;
        previous = props.garbage.count;
      }
      expect(cleared, `id ${id}`).toBeGreaterThanOrEqual(DAYS_PER_MONTH);
      expect(cleared, `id ${id}`).toBeLessThanOrEqual(2 * DAYS_PER_MONTH);
      expect(props.garbage.count).toBe(0);
      expect(props.garbage.visible).toBe(false);
    }
  });

  it('does not restart buildup or clearing on unrelated repeated building events', () => {
    const plain = renderer(), repeated = renderer(), b = fourItemLot(plain);
    for (const props of [plain, repeated]) props.garbageBuildingChanged(b, 0);
    for (let day = 0; day <= 130; day++) {
      if (day === 65) plain.garbageBuildingChanged({ ...b, flags: 0 }, day);
      repeated.garbageBuildingChanged({ ...b, flags: (day < 65 ? BF.NoGarbage : 0) | (day % 2 ? BF.Powered : 0) }, day);
      plain.updateGarbage(day, camera, flat);
      repeated.updateGarbage(day, camera, flat);
      expect(snapshot(repeated), `day ${day}`).toEqual(snapshot(plain));
    }
  });

  it('keeps rapid flag reversals continuous and independent of rendered frame cadence', () => {
    const daily = renderer(), sparse = renderer(), b = fourItemLot(daily);
    const changes = new Map([[0, true], [16, false], [24, true], [55, false], [60, true], [100, false]]);
    for (let day = 0; day <= 160; day++) {
      if (changes.has(day)) {
        // The event computes its transition from the emitting day, even if no frame rendered the preceding days.
        daily.updateGarbage(day, camera, flat);
        const before = daily.garbage.count;
        const next = { ...b, flags: changes.get(day) ? BF.NoGarbage : 0 };
        for (const props of [daily, sparse]) props.garbageBuildingChanged(next, day);
        daily.updateGarbage(day, camera, flat);
        sparse.updateGarbage(day, camera, flat);
        if (before > 0) expect(daily.garbage.count, `transition day ${day}`).toBe(before);
        expect(snapshot(sparse), `transition day ${day}`).toEqual(snapshot(daily));
      } else daily.updateGarbage(day, camera, flat);
    }
    sparse.updateGarbage(160, camera, flat);
    expect(snapshot(sparse)).toEqual(snapshot(daily));
    expect(daily.garbage.count).toBe(0);
  });

  it('loads mature flagged lots, ignores unflagged lots, and removes reused ids without stale props', () => {
    const props = renderer(), b = building(7);
    props.resetGarbage([b, building(8, { flags: 0 })], 100);
    props.updateGarbage(100, camera, flat);
    const mature = props.garbage.count;
    expect(mature).toBeGreaterThanOrEqual(1);
    props.removeGarbage(b.id);
    props.updateGarbage(100, camera, flat);
    expect(props.garbage.count).toBe(0);
    props.garbageBuildingChanged({ ...b, x: 20 }, 100);
    props.updateGarbage(100, camera, flat);
    expect(props.garbage.count).toBe(1);
    expect(positions(props)[0].x).toBeGreaterThan(20 * CELL_SIZE);
    props.resetGarbage([], 100);
    props.updateGarbage(100, camera, flat);
    expect(props.garbage.count).toBe(0);
  });

  it('recognises flag transitions when event records are updated in place', () => {
    const props = renderer(), b = building(7);
    props.resetGarbage([b], 100);
    props.updateGarbage(100, camera, flat);
    b.flags = 0;
    props.garbageBuildingChanged(b, 100);
    props.updateGarbage(160, camera, flat);
    expect(props.garbage.count).toBe(0);
    b.flags = BF.NoGarbage;
    props.garbageBuildingChanged(b, 160);
    props.updateGarbage(160, camera, flat);
    expect(props.garbage.count).toBe(1);
  });

  it('cuts exactly at 900 m, including camera height, and reculls while the sim day is paused', () => {
    const props = renderer(), b = building();
    props.garbageBuildingChanged(b, 0);
    props.updateGarbage(0, camera, flat);
    const p = positions(props)[0];
    // Front Z is exact in the instance matrix; the cutoff must exclude equality, with no LOD hysteresis.
    props.updateGarbage(0, new THREE.Vector3(p.x, p.y, p.z + 899.99), flat);
    expect(props.garbage.count).toBe(1);
    props.updateGarbage(0, new THREE.Vector3(p.x, p.y, p.z + 900), flat);
    expect(props.garbage.count).toBe(0);
    props.updateGarbage(0, new THREE.Vector3(p.x, p.y, p.z + 900.01), flat);
    expect(props.garbage.count).toBe(0);
    props.updateGarbage(0, new THREE.Vector3(p.x, p.y + 900.01, p.z), flat);
    expect(props.garbage.count).toBe(0);
    props.updateGarbage(0, new THREE.Vector3(p.x, p.y + 899.99, p.z), flat);
    expect(props.garbage.count).toBe(1);
  });

  it('cuts individual props across an off-centre camera boundary, rather than the whole lot', () => {
    const props = renderer();
    let full: THREE.Vector3[] = [];
    for (let id = 1; id <= 32 && full.length < 4; id++) {
      props.resetGarbage([building(id)], 100);
      props.updateGarbage(100, camera, flat);
      full = positions(props);
    }
    expect(full.length).toBe(4);
    const edge = new THREE.Vector3(Math.min(...full.map((p) => p.x)) + 900.1, full[0].y, full[0].z);
    const expected = full.filter((p) => p.distanceTo(edge) < 900);
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(full.length);
    props.updateGarbage(100, edge, flat);
    expect(positions(props)).toEqual(expected);
  });

  it('skips unchanged frames and invalidates only when relevant data or the day changes', () => {
    const props = renderer(), b = building();
    const surf = { terrain: vi.fn(() => 0) };
    props.garbageBuildingChanged(b, 0);
    props.updateGarbage(0, camera, surf);
    const calls = surf.terrain.mock.calls.length, version = props.garbage.instanceMatrix.version;
    props.updateGarbage(0, camera.clone(), surf);
    props.garbageBuildingChanged({ ...b, flags: b.flags | BF.Powered }, 0);
    props.updateGarbage(0, camera, surf);
    expect(surf.terrain).toHaveBeenCalledTimes(calls);
    expect(props.garbage.instanceMatrix.version).toBe(version);
    props.updateGarbage(1, camera, surf);
    expect(surf.terrain.mock.calls.length).toBeGreaterThan(calls);
    props.garbageBuildingChanged({ ...b, baseY: 10 }, 1);
    props.updateGarbage(1, camera, surf);
    expect(positions(props)[0].y).toBeCloseTo(10.08, 5);
  });

  it('packs both low-poly variants into one instanced mesh without shadow draws', () => {
    const props = renderer();
    props.resetGarbage(Array.from({ length: 32 }, (_, i) => building(i + 1)), 100);
    props.updateGarbage(100, camera, flat);
    const mesh = props.garbage, geometry = mesh.geometry;
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.parent).toBe(props.batch.mesh);
    expect(Array.isArray(mesh.material)).toBe(false);
    expect(mesh.castShadow).toBe(false);
    expect(geometry.groups).toEqual([]);
    expect(geometry.getAttribute('position').count / 3).toBeLessThanOrEqual(28);
    for (const name of ['garbagePosition', 'garbageNormal', 'garbageColor']) {
      expect(geometry.getAttribute(name).count, name).toBe(geometry.getAttribute('position').count);
    }
    expect(new Set(snapshot(props).variants)).toEqual(new Set([0, 1]));
    const bag = getModelGeometry('garbage_pile', 0), bin = getModelGeometry('garbage_pile', 1);
    expect(MANIFEST_BY_ID.garbage_pile.group).toBe('prop');
    expect(Array.from(bag.getAttribute('position').array)).not.toEqual(Array.from(bin.getAttribute('position').array));
    for (const g of [bag, bin]) expect(g.getAttribute('position').count / 3).toBeLessThanOrEqual(28);
  });

  it('selects each variant\'s position, normal and colour in the city material shader', () => {
    const props = renderer();
    const shader = {
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as THREE.WebGLProgramParametersWithUniforms;
    (props.garbage.material as THREE.Material).onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    for (const name of ['garbageVariant', 'garbagePosition', 'garbageNormal', 'garbageColor']) {
      expect(shader.vertexShader).toContain(`attribute ${name === 'garbageVariant' ? 'float' : 'vec3'} ${name};`);
    }
    expect(shader.vertexShader).toContain('objectNormal = mix(normal, garbageNormal, garbageVariant);');
    expect(shader.vertexShader).toContain('vColor.xyz = mix(color, garbageColor, garbageVariant);');
    const selected = shader.vertexShader.indexOf('transformed = mix(position, garbagePosition, garbageVariant);');
    expect(selected).toBeGreaterThan(0);
    expect(shader.vertexShader.indexOf('vObjPos = transformed;')).toBeGreaterThan(selected);
    expect(shader.vertexShader).toContain('vObjNormal = objectNormal;');
  });

  it('grows capacity beyond 256 without adding meshes or retaining the replaced geometry', () => {
    const props = renderer(), old = props.garbage;
    const meshDisposed = vi.fn(), geometryDisposed = vi.fn();
    old.addEventListener('dispose', meshDisposed);
    old.geometry.addEventListener('dispose', geometryDisposed);
    props.resetGarbage(Array.from({ length: 300 }, (_, i) => building(i + 1, { x: 8 + i % 10, z: 8 + Math.floor(i / 10) })), 100);
    props.updateGarbage(100, new THREE.Vector3(256, 180, 360), flat);
    expect(props.garbage.count).toBeGreaterThan(256);
    expect(props.garbage.instanceMatrix.count).toBeGreaterThanOrEqual(props.garbage.count);
    expect(props.garbage.geometry.getAttribute('garbageVariant').count).toBe(props.garbage.instanceMatrix.count);
    expect(props.batch.mesh.children.filter((child) => child.name === 'garbage')).toEqual([props.garbage]);
    expect(old.parent).toBeNull();
    expect(meshDisposed).toHaveBeenCalledOnce();
    expect(geometryDisposed).toHaveBeenCalledOnce();
  });

  it('never mutates mirrored building records or draws from the simulation RNG', () => {
    const props = renderer(), b = Object.freeze(building(7));
    const before = { ...b }, next = vi.spyOn(RNG.prototype, 'next');
    props.garbageBuildingChanged(b, 10);
    props.updateGarbage(40, camera, flat);
    props.garbageBuildingChanged(Object.freeze({ ...b, flags: 0 }), 40);
    props.updateGarbage(100, camera, flat);
    props.resetGarbage([b], 100);
    props.updateGarbage(100, camera, flat);
    expect(b).toEqual(before);
    expect(next).not.toHaveBeenCalled();
  });
});
