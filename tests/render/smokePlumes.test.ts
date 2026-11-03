/** FEEL-15: operational plumes follow output without rebuilding for every staffing change. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { smokeEmitters as industrialSmoke, steamEmitters as industrialSteam } from '../../src/assets/builders/industrial';
import { smokeEmitters as utilitySmoke, steamEmitters as utilitySteam } from '../../src/assets/builders/utility';
import type { BuildingVisual } from '../../src/render/city/buildings/BuildingRenderer';
import { Effects, type Emit } from '../../src/render/city/effects/Effects';

const effects: Effects[] = [];
const geometries: THREE.BufferGeometry[] = [];
const inside = (fx: Effects) => fx as unknown as { emitters: Map<number, Emit[]> };
const group = (fx: Effects, id = 1) => inside(fx).emitters.get(id)!;
const count = (list: Emit[]) => list.reduce((sum, e) => sum + e.count, 0);
const versions = (fx: Effects) => [fx.smoke, fx.flames].flatMap((mesh) =>
  ['aEmit', 'aP'].map((name) => (mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute).version));

afterEach(() => {
  vi.restoreAllMocks();
  for (const fx of effects.splice(0)) fx.dispose();
  for (const geo of geometries.splice(0)) geo.dispose();
});

function effect(): Effects {
  const fx = new Effects();
  effects.push(fx);
  return fx;
}

function visual(extra: Partial<BuildingVisual> = {}): BuildingVisual {
  return {
    id: 1, model: 'util_coal_plant', variant: 0, cx: 100, cz: 200, baseY: 2, yaw: 0,
    sw: 64, sd: 64, top: 92, bounds: new THREE.Box3(new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 90, 8)),
    burning: false, burnt: false, constructing: false, abandoned: false, activity: 1, activityMonth: 6, sy: 1,
    ...extra,
  };
}

function singleCoalStack(): void {
  vi.spyOn(utilitySmoke, 'util_coal_plant').mockReturnValue([[0, 40, 0]]);
  vi.spyOn(utilitySteam, 'util_coal_plant').mockReturnValue([]);
}

function withoutExports(model: string, run: () => void): void {
  const maps = [industrialSmoke, industrialSteam, utilitySmoke, utilitySteam];
  const saved = maps.map((map) => Object.getOwnPropertyDescriptor(map, model));
  for (const map of maps) delete map[model];
  try { run(); }
  finally {
    for (let i = 0; i < maps.length; i++) if (saved[i]) Object.defineProperty(maps[i], model, saved[i]!);
  }
}

describe('output-driven building plumes', () => {
  it('has exactly four positive strengths, with zero separate and quarter-step boundaries included', () => {
    singleCoalStack();
    const samples = [
      [0, 0], [0.01, 5], [0.1, 5], [0.25, 5], [0.250001, 9], [0.5, 9],
      [0.500001, 14], [0.75, 14], [0.750001, 18], [1, 18], [2, 18],
    ];
    const strengths = new Set<number>();
    for (const [activity, expected] of samples) {
      const fx = effect(), v = visual({ activity });
      fx.onBuilding(v, v.id);
      fx.update();
      expect(fx.particleCount, `activity ${activity}`).toBe(expected);
      strengths.add(fx.particleCount);
    }
    expect([...strengths]).toEqual([0, 5, 9, 14, 18]);
  });

  it('emits no smoke for the unstaffed 0/340 refinery visual', () => {
    const fx = effect(), v = visual({ model: 'ind_refinery', activity: 0 });
    fx.onBuilding(v, v.id);
    fx.update();
    expect(fx.particleCount).toBe(0);
    expect(fx.smoke.visible).toBe(false);
    expect(inside(fx).emitters.has(v.id)).toBe(false);
  });

  it('keeps a 15% coal plant at the quarter-load floor and below 40% of full particles', () => {
    const full = effect(), low = effect();
    full.onBuilding(visual(), 1);
    low.onBuilding(visual({ activity: 0.25 }), 1);
    full.update(); low.update();
    expect(full.particleCount).toBeGreaterThan(0);
    expect(low.particleCount).toBeGreaterThan(0);
    expect(low.particleCount).toBeLessThanOrEqual(full.particleCount * 0.4);
  });

  it('preserves emitter identity and all buffer versions within a step, including a new month', () => {
    singleCoalStack();
    const fx = effect(), v = visual({ activity: 0.1 });
    fx.onBuilding(v, 1); fx.update();
    const first = group(fx), uploaded = versions(fx);
    for (const [activity, activityMonth] of [[0.2, 6], [0.25, 6], [0.1, 7], [0.24, 8]]) {
      fx.onBuilding({ ...v, activity, activityMonth }, 1);
      fx.update();
      expect(group(fx)).toBe(first);
      expect(versions(fx)).toEqual(uploaded);
    }
  });

  it('reconstructs positive plumes at most once per month, including shutdown and restart', () => {
    singleCoalStack();
    const fx = effect(), v = visual({ activity: 0.25 });
    fx.onBuilding(v, 1); fx.update();
    const first = group(fx), uploaded = versions(fx);
    for (const activity of [0.5, 0.75, 1]) {
      fx.onBuilding({ ...v, activity }, 1); fx.update();
      expect(group(fx)).toBe(first);
      expect(count(group(fx))).toBe(5);
      expect(versions(fx)).toEqual(uploaded);
    }
    fx.onBuilding({ ...v, activity: 0.5, activityMonth: 7 }, 1); fx.update();
    const second = group(fx);
    expect(second).not.toBe(first);
    expect(count(second)).toBe(9);
    fx.onBuilding({ ...v, activity: 0, activityMonth: 7 }, 1); fx.update();
    expect(group(fx)).toBe(second);
    expect(fx.particleCount).toBe(0);
    const stopped = versions(fx);
    fx.onBuilding({ ...v, activity: 1, activityMonth: 7 }, 1); fx.update();
    expect(group(fx)).toBe(second);
    expect(fx.particleCount).toBe(0);
    expect(versions(fx)).toEqual(stopped);
    fx.onBuilding({ ...v, activity: 1, activityMonth: 8 }, 1); fx.update();
    expect(group(fx)).not.toBe(second);
    expect(fx.particleCount).toBe(18);
    const third = group(fx), resumed = versions(fx);
    fx.onBuilding({ ...v, activity: 0.5, activityMonth: 8 }, 1); fx.update();
    expect(group(fx)).toBe(third);
    expect(versions(fx)).toEqual(resumed);
  });

  it('allows a first positive plume in the same month as an initially inactive building', () => {
    singleCoalStack();
    const fx = effect(), v = visual({ activity: 0 });
    fx.onBuilding(v, 1); fx.update();
    fx.onBuilding({ ...v, activity: 0.25 }, 1); fx.update();
    expect(fx.particleCount).toBe(5);
    const first = group(fx);
    fx.onBuilding({ ...v, activity: 1 }, 1); fx.update();
    expect(group(fx)).toBe(first);
    expect(fx.particleCount).toBe(5);
  });

  it('stops operational counts immediately in place while retaining every fire emitter', () => {
    singleCoalStack();
    const fx = effect(), v = visual({ burning: true });
    fx.onBuilding(v, 1); fx.update();
    const first = group(fx), operational = first.filter((e) => e.kind === 0 || e.kind === 1 || e.kind === 5);
    const fire = first.filter((e) => e.kind === 2 || e.kind === 3);
    const before = fire.map((e) => ({ ...e }));
    expect(operational).toHaveLength(1);
    expect(fire).toHaveLength(8);
    fx.onBuilding({ ...v, activity: 0 }, 1);
    expect(group(fx)).toBe(first);
    expect(operational.every((e) => e.count === 0)).toBe(true);
    expect(fire).toEqual(before);
    fx.update();
    expect(fx.particleCount).toBe(118);
    expect((fx.flames.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(70);
    expect((fx.smoke.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(48);
    fx.onBuilding({ ...v, activity: 1 }, 1); fx.update();
    expect(group(fx)).toBe(first);
    expect(fire).toEqual(before);
    expect(fx.particleCount).toBe(118);
  });

  it('keeps fire and construction dust independent of operating activity', () => {
    const fire = effect(), dust = effect();
    fire.onBuilding(visual({ model: 'res_cottage', activity: 0, burning: true }), 1);
    fire.update();
    expect(fire.particleCount).toBe(118);
    const site = visual({ constructing: true, activity: 1 });
    dust.onBuilding(site, 1); dust.update();
    expect(group(dust)).toHaveLength(1);
    expect(group(dust)[0]).toMatchObject({ kind: 4, count: 6 });
    expect(dust.particleCount).toBe(6);
    const first = group(dust), uploaded = versions(dust);
    dust.onBuilding({ ...site, activity: 0, activityMonth: 7 }, 1); dust.update();
    expect(group(dust)).toBe(first);
    expect(versions(dust)).toEqual(uploaded);
    expect(dust.particleCount).toBe(6);
  });

  it.each(['abandoned', 'burnt', 'constructing'] as const)('suppresses operational plumes while %s', (flag) => {
    const fx = effect(), v = visual({ [flag]: true });
    fx.onBuilding(v, 1); fx.update();
    expect((group(fx) ?? []).some((e) => e.kind === 0 || e.kind === 1 || e.kind === 5)).toBe(false);
    expect(fx.particleCount).toBe(flag === 'constructing' ? 6 : 0);
  });

  it.each([
    ['util_nuclear_plant', 1, 26, 7],
    ['util_gas_plant', 5, 18, 5],
  ] as const)('scales exported steam / exhaust for %s and keeps duplicate steam positions unique', (model, kind, fullCount, lowCount) => {
    vi.spyOn(utilitySmoke, model).mockReturnValue([[1, 40, 2]]);
    vi.spyOn(utilitySteam, model).mockReturnValue(kind === 1 ? [[1, 40, 2]] : []);
    const full = effect(), low = effect();
    full.onBuilding(visual({ model }), 1);
    low.onBuilding(visual({ model, activity: 0.25 }), 1);
    full.update(); low.update();
    expect(group(full)).toHaveLength(1);
    expect(group(low)).toHaveLength(1);
    expect(group(full)[0]).toMatchObject({ kind, count: fullCount });
    expect(group(low)[0]).toMatchObject({ kind, count: lowCount });
    expect(low.particleCount).toBe(lowCount);
    expect(full.particleCount).toBe(fullCount);
  });

  it.each([
    ['util_coal_plant', 0, 18, 5],
    ['ind_assembly_plant', 5, 18, 5],
    ['util_nuclear_plant', 1, 26, 7],
  ] as const)('scales the geometry fallback for %s when emitter exports are absent', (model, kind, fullCount, lowCount) => {
    withoutExports(model, () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 40, 0, 0.4, 40, 0.4], 3));
      geometries.push(geo);
      const full = effect(), low = effect();
      full.geometryOf = low.geometryOf = () => geo;
      full.onBuilding(visual({ model, variant: 9876 }), 1);
      low.onBuilding(visual({ model, variant: 9876, activity: 0.25 }), 1);
      full.update(); low.update();
      expect(group(full)).toHaveLength(1);
      expect(group(full)[0]).toMatchObject({ kind, count: fullCount });
      expect(group(low)[0]).toMatchObject({ kind, count: lowCount });
      expect(full.particleCount).toBe(fullCount);
      expect(low.particleCount).toBe(lowCount);
    });
  });

  it('removes plume history so id reuse and clear can emit immediately in the same month', () => {
    singleCoalStack();
    const fx = effect(), v = visual({ activity: 0.25 });
    fx.onBuilding(v, 1); fx.update();
    const first = group(fx);
    fx.onBuilding(null, 1); fx.update();
    expect(inside(fx).emitters.has(1)).toBe(false);
    expect(fx.particleCount).toBe(0);
    fx.onBuilding({ ...v, activity: 1 }, 1); fx.update();
    expect(group(fx)).not.toBe(first);
    expect(fx.particleCount).toBe(18);
    const reused = group(fx);
    fx.clear(); fx.update();
    expect(inside(fx).emitters.size).toBe(0);
    expect(fx.particleCount).toBe(0);
    fx.onBuilding({ ...v, activity: 0.5 }, 1); fx.update();
    expect(group(fx)).not.toBe(reused);
    expect(fx.particleCount).toBe(9);
  });
});
