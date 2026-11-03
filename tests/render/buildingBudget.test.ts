/** Building event bursts defer geometry work; bulk loads and captures still settle synchronously (R2). */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { lotTwigs, setLotTwigStrip } from '../../src/assets/builders/winterTwigs';
import { CELL_SIZE } from '../../src/core/constants';
import { BuildingRenderer, type BuildingVisual } from '../../src/render/city/buildings/BuildingRenderer';
import { TileCuller } from '../../src/render/city/common/batch';
import { IF_SELECTED } from '../../src/render/city/common/cityMaterial';
import { BF, type Building } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { createCityState } from '../../src/sim/terrainGen';

registerAllModels();

type BI = {
  id: number; b: Building; li: number; main: number; site: number; found: number; cells: number[];
  geom: number; lod: number; flod: number; flags: number; anim: number; wakeGeom: number;
};
type Internals = {
  inst: Map<number, BI>; list: BI[]; animating: Set<number>; lodWake: BI[]; evalWake: boolean;
  buildOrder: BI[]; buildAt: number;
  build(bi: BI): void;
  lodEval(bi: BI, c: THREE.Vector3, K: number, on: number, off: number): void;
  wakeWaiting(c: THREE.Vector3, K: number, on: number, off: number, all: boolean): void;
};
const inside = (br: BuildingRenderer) => br as unknown as Internals;
const renderers: BuildingRenderer[] = [];
const strip0 = lotTwigs.strip;

afterEach(() => {
  vi.restoreAllMocks();
  for (const br of renderers.splice(0)) br.dispose();
  setLotTwigStrip(strip0);
});

function town(lodPixels = 9) {
  const state = createCityState(defaultCityConfig({ size: 64, seed: 7, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
  state.heights.fill(0);
  const br = new BuildingRenderer(state, new TileCuller(64, CELL_SIZE, 16));
  br.lodPixels = lodPixels;
  br.lodBudgetMs = 1e9;
  br.fadeTime = 0;
  renderers.push(br);
  return { br, state };
}

function building(id: number, extra: Partial<Building> = {}): Building {
  return { id, def: 'res_cottage', x: 8 + id * 3 % 44, z: 8, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 0, ...extra } as Building;
}

function camera() {
  const cam = new THREE.PerspectiveCamera(35, 16 / 9, 1, 20000);
  cam.position.set(512, 180, 1500);
  cam.lookAt(512, 0, 512);
  cam.updateMatrixWorld();
  return cam;
}

/** Only the geometry work advances the fake clock, so the budget checks are deterministic on any machine. */
function clockedBuild(br: BuildingRenderer, cost: number) {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const internal = inside(br), build = internal.build.bind(br);
  const built: number[] = [];
  const entries: BI[] = [];
  vi.spyOn(internal, 'build').mockImplementation((bi) => {
    build(bi);
    built.push(bi.id);
    entries.push(bi);
    now += cost;
  });
  return { built, entries, time: () => now };
}

function drain(br: BuildingRenderer) {
  let frames = 0;
  while (br.pendingBuilds && frames++ < 100) br.update(1);
  expect(br.pendingBuilds).toBe(0);
  br.update(1);
}

/** Geometry ids and instance slots depend on build order; compare their exact active buffer contents by lot/role. */
function snapshot(br: BuildingRenderer) {
  type Info = { vertexStart: number; vertexCount: number; indexStart: number; indexCount: number };
  const mesh = br.batch.mesh;
  const info = (mesh as unknown as { _geometryInfo: Info[] })._geometryInfo;
  const geos = new Map<number, unknown>();
  const geometry = (id: number) => {
    if (geos.has(id)) return geos.get(id);
    const gi = info[id], g = mesh.geometry;
    const attrs = Object.keys(g.attributes).sort().map((name) => {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      const lo = gi.vertexStart * a.itemSize, hi = lo + gi.vertexCount * a.itemSize;
      const arr = a.array.slice(lo, hi);
      return [name, a.itemSize, a.normalized, arr.constructor.name, createHash('sha256').update(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)).digest('hex')];
    });
    const index = g.getIndex();
    const value = {
      attrs,
      index: index ? Array.from(index.array.slice(gi.indexStart, gi.indexStart + gi.indexCount), (n) => n - gi.vertexStart) : null,
      bounds: [br.batch.bounds(id).min.toArray(), br.batch.bounds(id).max.toArray()],
    };
    geos.set(id, value);
    return value;
  };
  const slot = (id: number) => id < 0 ? null : {
    geometry: geometry(mesh.getGeometryIdAt(id)),
    matrix: mesh.getMatrixAt(id, new THREE.Matrix4()).toArray(),
    color: mesh.getColorAt(id, new THREE.Vector4()).toArray(),
    visible: mesh.getVisibleAt(id),
  };
  return [...inside(br).list].sort((a, b) => a.id - b.id).map((bi) => ({
    id: bi.id, lod: bi.lod, flod: bi.flod,
    visual: { ...br.getVisual(bi.id), bounds: [br.getVisual(bi.id)!.bounds.min.toArray(), br.getVisual(bi.id)!.bounds.max.toArray()] },
    main: slot(bi.main), site: slot(bi.site), found: slot(bi.found), cells: bi.cells.map(slot),
  }));
}

describe('BuildingRenderer geometry work queue', () => {
  for (const pixels of [11, 9]) it(`drains to the synchronous instance buffers at ${pixels === 11 ? 'LOW' : 'HIGH'}, including id reuse and cancellation`, () => {
    setLotTwigStrip(pixels === 11);
    const queued = town(pixels), sync = town(pixels);
    const timer = clockedBuild(queued.br, 3);
    const add = (b: Building) => {
      const qb = { ...b }, sb = { ...b };
      queued.state.buildings.set(b.id, qb); sync.state.buildings.set(b.id, sb);
      queued.br.add(qb); sync.br.add(sb, false);
    };
    const change = (id: number, patch: Partial<Building>) => {
      const q = { ...queued.state.buildings.get(id)!, ...patch }, s = { ...sync.state.buildings.get(id)!, ...patch };
      queued.state.buildings.set(id, q); sync.state.buildings.set(id, s);
      queued.br.changed(q); sync.br.changed(s); sync.br.flushLod();
    };
    const remove = (id: number) => {
      queued.state.buildings.delete(id); sync.state.buildings.delete(id);
      queued.br.remove(id); sync.br.remove(id);
    };
    add(building(1));
    add(building(2, { def: 'res_apartment', built: 0.3, flags: BF.Constructing, baseY: 2.4 }));
    add(building(3, { def: 'ind_warehouse', w: 3, d: 2, flags: BF.Burnt, baseY: 1.1 }));
    add(building(4));
    add(building(5));
    change(1, { flags: BF.OnFire });
    change(1, { flags: BF.Abandoned, variant: 1, rot: 1 });
    change(2, { built: 0.7 });
    remove(4);
    remove(5);
    add(building(5, { def: 'com_office_small', variant: 2, x: 42, z: 35, baseY: 3.2 }));
    expect(queued.br.pendingBuilds).toBe(4);
    queued.br.update(0);
    expect(timer.built).toHaveLength(1);
    drain(queued.br);
    change(2, { built: 1, flags: 0 });
    change(3, { rot: 1, x: 25, z: 27 });
    remove(5);
    add(building(5, { flags: BF.Burnt, w: 1, d: 1, rot: 3, baseY: 0.8 }));
    drain(queued.br);
    for (const br of [queued.br, sync.br]) {
      br.update(1);
      br.flushLod();
      br.updateLod(camera(), 720);
    }
    expect(queued.br.count).toBe(sync.br.count);
    expect(queued.br.lodCount).toBe(sync.br.lodCount);
    expect(queued.br.batch.mesh.material).toBe(sync.br.batch.mesh.material);
    expect(snapshot(queued.br)).toEqual(snapshot(sync.br));
    expect(inside(queued.br).inst.get(5)!.b.w).toBe(1);
    expect(timer.built.filter((id) => id === 4)).toHaveLength(0);
  });

  for (const cost of [0.65, 3.25]) it(`bounds a frame by 2 ms plus one entry (${cost} ms entries) and always makes progress`, () => {
    const { br } = town();
    const timer = clockedBuild(br, cost);
    for (let id = 1; id <= 17; id++) br.add(building(id));
    let frames = 0;
    while (br.pendingBuilds && frames++ < 30) {
      const start = timer.time(), n = timer.built.length;
      br.update(0);
      expect(timer.built.length - n).toBeGreaterThanOrEqual(1);
      expect(timer.time() - start).toBeLessThanOrEqual(2 + cost + 1e-9);
    }
    expect(br.pendingBuilds).toBe(0);
    expect(timer.built).toHaveLength(17);
  });

  it('finishes each priority wave despite a steady stream of nearer events', () => {
    const { br } = town();
    const timer = clockedBuild(br, 3);
    br.updateLod(camera(), 720);
    const old = [1, 2, 3, 4, 5, 6];
    for (const id of old) br.add(building(id, { x: 1, z: 1 }));
    br.update(0);
    for (let frame = 0; frame < 20; frame++) {
      for (let k = 0; k < 2; k++) br.add(building(100 + frame * 2 + k, { x: 31, z: 31 }));
      br.update(0);
      if (frame === 5) expect(old.every((id) => timer.built.includes(id))).toBe(true);
    }
    expect(br.pendingBuilds).toBeGreaterThan(0);
    drain(br);
    expect(timer.built).toHaveLength(46);
    expect(new Set(timer.built).size).toBe(46);
  });

  it('cancels stale entries in a partially built wave across id reuse and releases an emptied wave', () => {
    const { br } = town();
    const timer = clockedBuild(br, 3), internal = inside(br);
    for (const id of [1, 2, 3]) br.add(building(id));
    const cancelled = internal.inst.get(2)!;
    br.update(0);
    expect(timer.built).toEqual([1]);
    br.remove(2);
    br.add(building(2, { def: 'com_office_small', variant: 2 }));
    const replacement = internal.inst.get(2)!;
    br.remove(3);
    br.update(0);
    expect(timer.built).toEqual([1, 2]);
    expect(timer.entries).not.toContain(cancelled);
    expect(timer.entries).toContain(replacement);
    expect(br.getVisual(2)!.model).toBe('com_office_small');
    for (const id of [4, 5, 6]) br.add(building(id));
    br.update(0);
    expect(timer.built.at(-1)).toBe(4);
    expect(internal.buildOrder.length).toBeGreaterThan(0);
    br.remove(5);
    br.remove(6);
    expect(br.pendingBuilds).toBe(0);
    expect(internal.buildOrder).toEqual([]);
    expect(internal.buildAt).toBe(0);
    br.update(0);
    expect(timer.built).toEqual([1, 2, 4]);
  });

  it('keeps terrain rebuilding synchronous for drawn foundations without allocating queued lots', () => {
    const { br, state } = town();
    const drawn = building(1, { x: 8, z: 8, baseY: 2.4 });
    const queued = building(2, { x: 16, z: 8, baseY: 2.4 });
    br.add(drawn, false);
    br.add(queued);
    const internal = inside(br), pending = internal.inst.get(2)!;
    const initial = snapshot(br);
    state.heights.fill(-2);
    const builds = vi.spyOn(internal, 'build');
    const allocations = vi.spyOn(br.batch, 'add');
    br.terrainChanged(0, 0, 63, 63);
    expect(builds).toHaveBeenCalledTimes(1);
    expect(builds.mock.calls[0][0].id).toBe(1);
    expect(allocations).toHaveBeenCalled();
    expect(br.pendingBuilds).toBe(1);
    expect(br.count).toBe(1);
    expect(br.getVisual(1)).not.toBeNull();
    expect(br.getVisual(2)).toBeNull();
    expect(pending.li).toBe(-1);
    expect(pending.main).toBe(-1);
    expect(pending.site).toBe(-1);
    expect(pending.found).toBe(-1);
    expect(snapshot(br)).not.toEqual(initial);
    builds.mockClear();
    allocations.mockClear();
    br.terrainChanged(16, 8, 18, 10);
    expect(builds).not.toHaveBeenCalled();
    expect(allocations).not.toHaveBeenCalled();
    br.update(0);
    expect(br.pendingBuilds).toBe(0);
    expect(br.count).toBe(2);
    expect(pending.found).toBeGreaterThanOrEqual(0);
  });

  it('builds a visible lot before one outside the view, then nearer lots first', () => {
    const { br } = town();
    const timer = clockedBuild(br, 3);
    const cam = new THREE.PerspectiveCamera(20, 1, 1, 20000);
    cam.position.set(256, 80, 600);
    cam.lookAt(256, 0, 256);
    cam.updateMatrixWorld();
    br.updateLod(cam, 720);
    br.add(building(1, { x: 58, z: 56 }));
    br.add(building(2, { x: 15, z: 15 }));
    br.add(building(3, { x: 1, z: 15 }));
    drain(br);
    expect(timer.built).toEqual([2, 3, 1]);
  });

  it('keeps queued lots out of visuals, LOD counts and animation until their build, and applies the latest state', () => {
    const { br } = town();
    clockedBuild(br, 3);
    const visuals: [BuildingVisual | null, number][] = [];
    br.onVisual = (visual, id) => visuals.push([visual, id]);
    const b = building(1);
    br.add(b);
    const bi = inside(br).inst.get(1)!;
    br.changed({ ...b, variant: 2, rot: 1 });
    br.setSelected(1);
    br.updateLod(camera(), 720);
    expect(br.pendingBuilds).toBe(1);
    expect(br.count).toBe(0);
    expect(br.lodCount).toBe(0);
    expect(br.getVisual(1)).toBeNull();
    expect([...br.visuals()]).toEqual([]);
    expect(inside(br).list).toEqual([]);
    expect(inside(br).animating.size).toBe(0);
    expect(bi.li).toBe(-1);
    expect(visuals.filter(([v]) => v !== null)).toEqual([]);
    br.update(5);
    expect(br.pendingBuilds).toBe(0);
    expect(br.count).toBe(1);
    expect(inside(br).inst.get(1)).toBe(bi);
    expect(br.getVisual(1)!.variant).toBe(2);
    expect(br.getVisual(1)!.yaw).toBe(Math.PI / 2);
    expect(br.getVisual(1)!.sy).toBe(0.02);
    expect(bi.anim).toBe(0.55);
    expect(bi.flags & IF_SELECTED).toBe(IF_SELECTED);
    expect(visuals.filter(([v]) => v !== null)).toHaveLength(1);
    br.update(1);
    expect(br.getVisual(1)!.sy).toBe(1);
    br.changed({ ...bi.b, flags: BF.OnFire });
    expect(br.getVisual(1)).toBeNull();
    expect(br.count).toBe(0);
    expect(visuals.at(-1)).toEqual([null, 1]);
    const remove = vi.spyOn(br.batch, 'remove');
    br.remove(1);
    expect(remove).not.toHaveBeenCalled();
    expect(br.pendingBuilds).toBe(0);
    br.update(1);
    expect(br.count).toBe(0);
    expect(br.fading).toBe(0);
  });

  it('updates construction progress in place, then starts the completion pop when its queued rebuild runs', () => {
    const { br } = town();
    const b = building(1, { flags: BF.Constructing, built: 0.3 });
    br.add(b, false);
    const bi = inside(br).inst.get(1)!;
    br.changed({ ...b, built: 0.7 });
    expect(br.pendingBuilds).toBe(0);
    expect(br.getVisual(1)!.sy).toBe(0.7);
    br.changed({ ...b, built: 1, flags: 0 });
    expect(br.pendingBuilds).toBe(1);
    expect(inside(br).animating.size).toBe(0);
    br.update(5);
    expect(bi.anim).toBeCloseTo(0.55 * 0.7, 12);
    expect(br.getVisual(1)!.constructing).toBe(false);
    expect(inside(br).animating.has(1)).toBe(true);
  });

  it('allows a visual-removal callback to change, remove and replace the queued lot', () => {
    const { br } = town();
    const b = building(1);
    br.add(b, false);
    const old = inside(br).inst.get(1)!;
    const timer = clockedBuild(br, 3);
    const announced: BuildingVisual[] = [];
    let replaced = false;
    br.onVisual = (visual, id) => {
      if (visual) { announced.push(visual); return; }
      if (id !== 1 || replaced) return;
      replaced = true;
      br.changed({ ...b, def: 'com_office_small' });
      br.remove(1);
      br.add({ ...b, def: 'ind_warehouse' });
    };
    br.changed({ ...b, flags: BF.OnFire });
    const replacement = inside(br).inst.get(1)!;
    expect(replacement).not.toBe(old);
    expect(br.pendingBuilds).toBe(1);
    expect(br.count).toBe(0);
    br.update(0);
    expect(timer.entries).toEqual([replacement]);
    expect(announced.map((v) => v.model)).toEqual(['ind_warehouse']);
    expect(br.count).toBe(1);
    expect(br.pendingBuilds).toBe(0);
    expect(inside(br).list).toEqual([replacement]);
  });

  it('ignores stale proxy wakes while queued and after a different geometry has been built', () => {
    const { br } = town();
    br.add(building(1), false);
    br.flushLod();
    const internal = inside(br), bi = internal.inst.get(1)!;
    const old = bi.geom;
    internal.lodWake.push(bi);
    bi.wakeGeom = old;
    br.changed({ ...bi.b, def: 'com_office_small' });
    const evals = vi.spyOn(internal, 'lodEval');
    internal.wakeWaiting(new THREE.Vector3(), 1, 9, 10, true);
    expect(evals).not.toHaveBeenCalled();
    br.update(0);
    expect(bi.geom).not.toBe(old);
    internal.lodWake.push(bi);
    // The old wake may already have been copied into a background batch before the rebuild cancelled it.
    internal.wakeWaiting(new THREE.Vector3(), 1, 9, 10, true);
    expect(evals).not.toHaveBeenCalled();
  });

  it('settles bulk rebuilds, captures, quality switches and resets synchronously', () => {
    const { br, state } = town();
    const b = building(1);
    state.buildings.set(1, b);
    br.add(b);
    br.rebuildAll();
    expect(br.pendingBuilds).toBe(0);
    expect(br.count).toBe(1);
    expect(br.getVisual(1)!.sy).toBe(1);
    const second = building(2);
    state.buildings.set(2, second);
    br.add(second);
    br.flushLod();
    expect(br.pendingBuilds).toBe(0);
    expect(br.count).toBe(2);
    br.updateLod(camera(), 720);
    const third = building(3);
    state.buildings.set(3, third);
    br.add(third);
    br.lodPixels = 11;
    br.updateLod(camera(), 720);
    expect(br.pendingBuilds).toBe(0);
    expect(br.count).toBe(3);
    br.add(building(4));
    setLotTwigStrip(!lotTwigs.strip);
    br.update(0);
    expect(br.pendingBuilds).toBe(0);
    expect(br.count).toBe(3);
    br.add(building(5));
    br.clear();
    expect(br.pendingBuilds).toBe(0);
    expect(br.count).toBe(0);
    expect([...br.visuals()]).toEqual([]);
    expect(inside(br).animating.size).toBe(0);
    br.update(1);
    expect(br.count).toBe(0);
  });

  it('retains a queued proxy level across a twig-quality rebuild inside its hysteresis band', () => {
    const { br, state } = town();
    const b = building(1);
    state.buildings.set(1, b);
    br.add(b, false);
    const cam = camera();
    cam.position.set(512, 5000, 5500);
    cam.updateMatrixWorld();
    br.flushLod();
    br.updateLod(cam, 720);
    const bi = inside(br).inst.get(1)! as BI & { radius: number; cy: number };
    expect(bi.lod).toBe(1);
    b.flags = BF.Abandoned;
    br.changed(b);
    expect(br.lodCount).toBe(0);
    // At the new preset this distance keeps an existing proxy, but does not downgrade a full model.
    const K = 360 / Math.tan(cam.fov * Math.PI / 360), distance = bi.radius * K / 11;
    const visualX = (b.x + b.w / 2) * CELL_SIZE, visualZ = (b.z + b.d / 2) * CELL_SIZE;
    cam.position.set(visualX, bi.cy + distance, visualZ);
    cam.lookAt(visualX, 0, visualZ);
    cam.updateMatrixWorld();
    br.lodPixels = 11;
    setLotTwigStrip(!lotTwigs.strip);
    br.update(0);
    expect(br.pendingBuilds).toBe(0);
    br.updateLod(cam, 720);
    expect(inside(br).inst.get(1)!.lod).toBe(1);
    expect(br.lodCount).toBe(1);
  });
});
