import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { CELL_SIZE } from '../../src/core/constants';
import { BuildingRenderer, type BuildingCollapse } from '../../src/render/city/buildings/BuildingRenderer';
import { TileCuller } from '../../src/render/city/common/batch';
import { shadowCasters } from '../../src/render/world/Shadows';
import { BF, type Building } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { createCityState } from '../../src/sim/terrainGen';

registerAllModels();

type BI = { id: number; main: number; site: number; found: number; geom: number; lodGeom: number; anim: number; li: number; fade: { p: number; gOld: number; gNew: number } | null };
type Inside = {
  inst: Map<number, BI>;
  collapses: { copy: BuildingCollapse; slots: number[]; age: number }[];
  capturedCollapses: Map<BuildingCollapse, { slots: number[] }>;
  budgetedWorks: unknown[];
  build(bi: BI): void;
  startFade(bi: BI, from: number, to: number): void;
};
const inside = (br: BuildingRenderer) => br as unknown as Inside;
const renderers: BuildingRenderer[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const br of renderers.splice(0)) br.dispose();
});

function town() {
  const st = createCityState(defaultCityConfig({ size: 64, seed: 7, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
  st.heights.fill(0);
  const br = new BuildingRenderer(st, new TileCuller(64, CELL_SIZE, 16));
  br.feedbackCamera = new THREE.Vector3(160, 0, 460);
  renderers.push(br);
  return br;
}

function building(id = 1, extra: Partial<Building> = {}): Building {
  return { id, def: 'res_cottage', x: 9, z: 9, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 0, ...extra } as Building;
}

function removeWithCopy(br: BuildingRenderer, id = 1) {
  const copy = br.captureCollapse(id)!;
  expect(copy).not.toBeNull();
  br.remove(id);
  br.queueCollapse(copy);
  return copy;
}

describe('detached building collapse', () => {
  it('hands over the drawn geometry, pose and tint independently of a reused id', () => {
    const br = town(), b = building();
    br.add(b, false);
    const old = inside(br).inst.get(b.id)!;
    const matrix = br.batch.mesh.getMatrixAt(old.main, new THREE.Matrix4()).clone();
    const color = br.batch.mesh.getColorAt(old.main, new THREE.Vector4()).clone();
    // A pending mutation must not change the snapshot of what is currently drawn.
    b.variant = 2; b.baseY = 20; b.built = 0.2;
    br.changed(b);
    const copy = removeWithCopy(br);
    expect(copy.parts[0].geom).toBe(old.geom);
    expect(copy.parts[0].matrix.equals(matrix)).toBe(true);
    expect(copy.parts[0].color.equals(color)).toBe(true);
    expect(br.getVisual(1)).toBeNull();
    br.add(building(1, { x: 30, variant: 1 }), false);
    const replacement = inside(br).inst.get(1)!;
    const replacementMatrix = br.batch.mesh.getMatrixAt(replacement.main, new THREE.Matrix4()).clone();
    br.update(0);
    expect(br.count).toBe(1);
    expect(br.collapsing).toBe(1);
    expect(inside(br).collapses[0].slots).not.toContain(replacement.main);
    br.update(0.2);
    expect(br.batch.mesh.getMatrixAt(replacement.main, new THREE.Matrix4()).equals(replacementMatrix)).toBe(true);
    br.update(0.15);
    expect(br.collapsing).toBe(1);
    br.update(0);
    expect(br.collapsing).toBe(0);
    expect(br.batch.instanceCount).toBe(1);
  });

  it.each([0.35, 0.5])('draws the exact 15%% pose once when a %s s step reaches or crosses expiry', (dt) => {
    const br = town(); br.add(building(), false);
    const copy = removeWithCopy(br);
    br.update(0);
    const ghost = inside(br).collapses[0], slot = ghost.slots[0];
    expect((br.batch as unknown as { instMask: Uint8Array }).instMask[slot]).toBe(0);
    // Static batches must register an untiled copy for per-instance pass culling.
    expect((br.batch as unknown as { untiled: number[] }).untiled).toContain(slot);
    const version = shadowCasters.version;
    br.update(dt);
    const m = br.batch.mesh.getMatrixAt(slot, new THREE.Matrix4());
    const originalY = new THREE.Vector3().setFromMatrixColumn(copy.parts[0].matrix, 1).length();
    expect(new THREE.Vector3().setFromMatrixColumn(m, 1).length() / originalY).toBeCloseTo(0.15, 6);
    expect(Math.abs(m.elements[4])).toBeGreaterThan(0);
    expect(Math.abs(m.elements[13] - copy.baseY)).toBeLessThan(0.05);
    expect(shadowCasters.version).toBe(version);
    expect(br.collapsing).toBe(1);
    expect(br.batch.mesh.getVisibleAt(slot)).toBe(true);
    br.update(0);
    expect(br.collapsing).toBe(0);
    expect(br.batch.instanceCount).toBe(0);
  });

  it.each([0.33, 0.8])('hands over the dominant real geometry at fade progress %s', (progress) => {
    const br = town(); br.add(building(), false); br.flushLod();
    const bi = inside(br).inst.get(1)!;
    const to = bi.lodGeom, main = bi.main;
    expect(to).not.toBe(bi.geom);
    inside(br).startFade(bi, bi.geom, to);
    expect(br.batch.mesh.getGeometryIdAt(bi.main)).not.toBe(bi.geom);
    bi.fade!.p = progress;
    const copy = br.captureCollapse(1)!;
    expect(copy.parts[0].geom).toBe(progress < 0.5 ? bi.geom : to);
    expect(br.batch.mesh.getGeometryIdAt(main)).toBe(copy.parts[0].geom);
    expect(br.captureCollapse(1)).toBeNull();
    br.remove(1); br.queueCollapse(copy); br.update(0);
    expect(br.fading).toBe(0);
    expect(br.collapsing).toBe(1);
    expect(inside(br).collapses[0].slots).toEqual([main]);
    expect(br.batch.instanceCount).toBe(1);
  });

  it('keeps the main batch culling version fixed while a tall detached copy tilts', () => {
    const br = town(); br.add(building(1, { def: 'res_tower.r2.7' }), false);
    removeWithCopy(br); br.update(0);
    const batch = br.batch as unknown as { version: number };
    const version = batch.version;
    for (let frame = 0; frame < 20; frame++) br.update(1 / 60);
    expect(br.collapsing).toBe(1);
    expect(batch.version).toBe(version);
  });

  it('has no copy for an undrawn add, rubble or a view beyond 2200 m', () => {
    const br = town();
    br.add(building()); expect(br.captureCollapse(1)).toBeNull(); br.remove(1);
    br.add(building(1, { flags: BF.Burnt }), false); expect(br.captureCollapse(1)).toBeNull(); br.remove(1);
    br.add(building(), false);
    br.feedbackCamera!.set(160, 0, 2360);
    const copy = br.captureCollapse(1)!;
    expect(copy).not.toBeNull();
    br.remove(1);
    br.feedbackCamera!.z += 0.01;
    br.queueCollapse(copy);
    expect(br.batch.instanceCount).toBe(0);
    br.add(building(), false);
    expect(br.captureCollapse(1)).toBeNull();
  });

  it('releases unplayed and active slots exactly once on cancellation, clear and dispose', () => {
    const br = town(); br.add(building(), false); removeWithCopy(br);
    br.feedbackCamera!.z = 10000; br.update(0);
    expect(br.collapsing).toBe(0);
    br.feedbackCamera!.z = 460;
    br.add(building(), false); const copy = removeWithCopy(br); br.update(0);
    br.feedbackCamera!.z = 10000; br.update(0);
    expect(br.collapsing).toBe(0);
    br.feedbackCamera!.z = 460;
    br.queueCollapse(copy); br.discardCollapse(copy);
    expect(br.batch.instanceCount).toBe(0);
    br.add(building(), false);
    const pending = br.captureCollapse(1)!; br.remove(1);
    br.add(building(2), false); removeWithCopy(br, 2);
    expect(inside(br).capturedCollapses.size).toBe(1);
    expect(br.collapsing).toBe(1);
    br.clear();
    br.queueCollapse(pending); br.discardCollapse(pending);
    expect(br.collapsing).toBe(0); expect(inside(br).capturedCollapses.size).toBe(0);
    expect(br.batch.instanceCount).toBe(0);
    br.add(building(), false); const discarded = br.captureCollapse(1)!; br.remove(1);
    br.discardCollapse(discarded); br.discardCollapse(discarded); br.queueCollapse(discarded);
    expect(br.batch.instanceCount).toBe(0);
    br.add(building(), false); const unplayed = br.captureCollapse(1)!; br.remove(1);
    br.add(building(2), false); const played = removeWithCopy(br, 2); br.queueCollapse(played);
    expect(br.collapsing).toBe(1);
    br.dispose(); br.queueCollapse(unplayed);
    expect(br.collapsing).toBe(0); expect(inside(br).capturedCollapses.size).toBe(0);
    expect(br.batch.instanceCount).toBe(0);
    renderers.splice(renderers.indexOf(br), 1);
  });

  it('hands over main and construction-site slots while freeing the foundation normally', () => {
    const br = town(); br.add(building(1, { baseY: 3, flags: BF.Constructing, built: 0.5 }), false);
    const bi = inside(br).inst.get(1)!, slots = [bi.main, bi.site];
    expect(slots.every((slot) => slot >= 0)).toBe(true);
    expect(bi.found).toBeGreaterThanOrEqual(0);
    expect(br.batch.instanceCount).toBe(3);
    removeWithCopy(br);
    expect(inside(br).collapses[0].slots).toEqual(slots);
    expect(br.batch.instanceCount).toBe(2);
    expect(slots.every((slot) => br.batch.mesh.getVisibleAt(slot))).toBe(true);
    br.update(0); br.update(0.35); br.update(0);
    expect(br.batch.instanceCount).toBe(0);
  });

  it('keeps every slot drawn through two consecutive 200-building removals without allocation', () => {
    const br = town();
    for (let wave = 0; wave < 2; wave++) {
      const ids: number[] = [], slots: number[] = [];
      for (let i = 0; i < 200; i++) {
        const id = wave * 200 + i + 1;
        br.add(building(id, { x: 2 + i % 20 * 3, z: 2 + Math.floor(i / 20) * 3 }), false);
        ids.push(id); slots.push(inside(br).inst.get(id)!.main);
      }
      const add = vi.spyOn(br.batch, 'add'), remove = vi.spyOn(br.batch, 'remove');
      const copies = ids.map((id) => { const copy = br.captureCollapse(id)!; br.remove(id); return copy; });
      expect(br.count).toBe(0);
      expect(br.batch.instanceCount).toBe(200);
      expect(slots.every((slot) => br.batch.mesh.getVisibleAt(slot))).toBe(true);
      for (const copy of copies) br.queueCollapse(copy);
      br.update(0);
      expect(br.collapsing).toBe(200);
      expect(inside(br).capturedCollapses.size).toBe(0);
      expect(inside(br).collapses.flatMap((c) => c.slots)).toEqual(slots);
      expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
      add.mockRestore(); remove.mockRestore();
      br.update(0.35); br.update(0);
      expect(br.batch.instanceCount).toBe(0);
    }
  });

  it('leaves the 2 ms geometry deadline unchanged without registering collapse work', () => {
    const br = town(); br.add(building(), false);
    removeWithCopy(br);
    const internal = inside(br);
    expect(internal.budgetedWorks).toHaveLength(0);
    expect(br.collapsing).toBe(1);
    for (let i = 0; i < 6; i++) br.add(building(i + 2));
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const built: number[] = [], build = internal.build.bind(br);
    vi.spyOn(internal, 'build').mockImplementation((bi) => { build(bi); built.push(bi.id); now += 0.75; });
    br.update(0);
    expect(built).toEqual([2, 3, 4]);
    expect(now).toBe(2.25);
    expect(br.pendingBuilds).toBe(3);
    expect(br.collapsing).toBe(1);
    br.update(0);
    expect(built).toEqual([2, 3, 4, 5, 6, 7]);
    expect(now).toBe(4.5);
    expect(br.pendingBuilds).toBe(0);
    expect(br.collapsing).toBe(1);
  });
});
