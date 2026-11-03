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

type BI = { id: number; main: number; site: number; geom: number; anim: number; li: number; fade: { p: number; gOld: number; gNew: number } | null };
type Inside = {
  inst: Map<number, BI>;
  collapses: { copy: BuildingCollapse; slots: number[]; age: number }[];
  collapseQueue: BuildingCollapse[];
  build(bi: BI): void;
  buildCollapse(copy: BuildingCollapse): void;
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
  it('copies the drawn geometry, pose and tint before freeing, independently of a reused id', () => {
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
    expect(br.collapsing).toBe(0);
    expect(br.batch.instanceCount).toBe(1);
  });

  it('sinks toward 15% height with a slight tilt, expires at 0.35 s and never invalidates shadows', () => {
    const br = town(); br.add(building(), false);
    const copy = removeWithCopy(br);
    br.update(0);
    const ghost = inside(br).collapses[0], slot = ghost.slots[0];
    expect((br.batch as unknown as { instMask: Uint8Array }).instMask[slot]).toBe(0);
    // Static batches must register an untiled copy for per-instance pass culling.
    expect((br.batch as unknown as { untiled: number[] }).untiled).toContain(slot);
    const version = shadowCasters.version;
    br.update(0.349999);
    const m = br.batch.mesh.getMatrixAt(slot, new THREE.Matrix4());
    const originalY = new THREE.Vector3().setFromMatrixColumn(copy.parts[0].matrix, 1).length();
    expect(new THREE.Vector3().setFromMatrixColumn(m, 1).length() / originalY).toBeCloseTo(0.15, 4);
    expect(Math.abs(m.elements[4])).toBeGreaterThan(0);
    expect(Math.abs(m.elements[13] - copy.baseY)).toBeLessThan(0.05);
    expect(shadowCasters.version).toBe(version);
    br.update(0.0000011);
    expect(br.collapsing).toBe(0);
    expect(br.batch.instanceCount).toBe(0);
  });

  it('captures the dominant real geometry during a fade instead of its empty stand-in', () => {
    const br = town(); br.add(building(), false); br.flushLod();
    const bi = inside(br).inst.get(1)!;
    const to = br.batch.mesh.getGeometryIdAt(bi.main);
    inside(br).startFade(bi, bi.geom, to);
    expect(br.batch.mesh.getGeometryIdAt(bi.main)).not.toBe(bi.geom);
    expect(br.captureCollapse(1)!.parts[0].geom).toBe(bi.geom);
    bi.fade!.p = 0.8;
    expect(br.captureCollapse(1)!.parts[0].geom).toBe(to);
    removeWithCopy(br); br.update(0);
    expect(br.fading).toBe(0);
    expect(br.collapsing).toBe(1);
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
    expect(br.captureCollapse(1)).not.toBeNull();
    br.feedbackCamera!.z += 0.01;
    expect(br.captureCollapse(1)).toBeNull();
  });

  it('drops queued and active copies after a camera cut, clear and dispose', () => {
    const br = town(); br.add(building(), false); removeWithCopy(br);
    br.feedbackCamera!.z = 10000; br.update(0);
    expect(br.collapsing).toBe(0);
    br.feedbackCamera!.z = 460;
    br.add(building(), false); const copy = removeWithCopy(br); br.update(0);
    br.feedbackCamera!.z = 10000; br.update(0);
    expect(br.collapsing).toBe(0);
    br.feedbackCamera!.z = 460; br.queueCollapse(copy); br.update(0);
    br.queueCollapse(copy); br.clear();
    expect(br.collapsing).toBe(0); expect(inside(br).collapseQueue).toHaveLength(0);
    br.queueCollapse(copy); br.update(0); br.dispose();
    expect(br.collapsing).toBe(0); expect(inside(br).collapseQueue).toHaveLength(0);
    renderers.splice(renderers.indexOf(br), 1);
  });

  it('shares the 2 ms geometry deadline and admits live builds between detached copies', () => {
    const br = town(); br.add(building(), false);
    const copy = br.captureCollapse(1)!; br.remove(1);
    for (let i = 0; i < 10; i++) { br.queueCollapse(copy); br.add(building(i + 2)); }
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const internal = inside(br), build = internal.build.bind(br), collapse = internal.buildCollapse.bind(br);
    let nBuild = 0, nCollapse = 0;
    vi.spyOn(internal, 'build').mockImplementation((bi) => { build(bi); nBuild++; now += 0.65; });
    vi.spyOn(internal, 'buildCollapse').mockImplementation((c) => { collapse(c); nCollapse++; now += 0.65; });
    br.update(0);
    expect(nBuild).toBe(2); expect(nCollapse).toBe(2);
    expect(now).toBeCloseTo(2.6);
    expect(br.pendingBuilds).toBe(8);
    for (let i = 0; i < 10; i++) br.update(0);
    expect(br.pendingBuilds).toBe(0); expect(nCollapse).toBe(10); expect(nBuild).toBe(10);
  });
});
