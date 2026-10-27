/**
 * Camera cuts and the shadow maps (pure JS, no WebGL context; WorldView re-renders a shadow map when
 * shadowCasters.version moves, see WorldView.updateShadowPolicy):
 *  - a LOD downgrade (buildings, their sites and the rubble kit's pieces onto their far level) does not move
 *    shadowCasters.version: a far cut's catch-up no longer re-renders the map a second time two frames after the cut
 *    frame's own render; an upgrade (back to full detail) still does
 *  - a cut's catch-up of up to lodCatchMin due evaluations is done in the cut frame even on a loaded machine (every
 *    clock read over budget): the cut frame's passes draw the settled levels, none of the due buildings on its full
 *    model
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { TileCuller } from '../../src/render/city/common/batch';
import { shadowCasters } from '../../src/render/world/Shadows';
import { BuildingRenderer } from '../../src/render/city/buildings/BuildingRenderer';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { BF, type Building } from '../../src/sim/CityState';
import { CELL_SIZE } from '../../src/core/constants';

registerAllModels();

type BI = { id: number; lod: number; geom: number; lodGeom: number; siteGeom: number; siteLod: number; cells: number[]; kitM: Float32Array | null };

const MODELS = ['res_cottage', 'res_ranch', 'res_apartment', 'res_tower', 'com_office_small', 'com_diner', 'com_office_tower', 'ind_warehouse'].filter((m) => MANIFEST_BY_ID[m]);
/** (low and mid-rise only: towers stay on their full model in a 4 km view) */
const SMALL = ['res_cottage', 'res_ranch', 'res_apartment', 'com_office_small', 'com_diner', 'ind_warehouse'].filter((m) => MANIFEST_BY_ID[m]);

/** a flat N x N town with a building every `step` cells, and two burnt 4 x 4 lots (rubble kit) along its south edge */
function town(N = 64, step = 3, models = MODELS): BuildingRenderer {
  const st = createCityState(defaultCityConfig({ size: N, seed: 7, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
  st.heights.fill(0);
  const br = new BuildingRenderer(st, new TileCuller(N, CELL_SIZE, 16));
  br.lodBudgetMs = 1e9; // proxies on demand without a frame budget here
  let id = 1;
  const add = (b: Building) => { st.buildings.set(b.id, b); br.add(b, false); };
  for (let z = 0; z < N - 8; z += step) for (let x = 0; x < N - 2; x += step) {
    add({ id: id++, def: models[((x / step) * 7 + (z / step) * 3) % models.length], x, z, w: 2, d: 2, rot: 0, variant: 0, built: 1, flags: 0, baseY: 0 } as unknown as Building);
  }
  for (const x of [8, N - 24]) add({ id: id++, def: 'res_apartment', x, z: N - 6, w: 4, d: 4, rot: 0, variant: 0, built: 1, flags: BF.Burnt, baseY: 0 } as unknown as Building);
  return br;
}

const H = 720;
const view = (cam: THREE.PerspectiveCamera, x: number, y: number, z: number) => {
  cam.position.set(x, y, z);
  cam.lookAt(512, 0, 512);
  cam.updateMatrixWorld();
};

describe('camera cuts and the shadow maps', () => {
  it('a downgrade leaves shadowCasters.version as it is, an upgrade moves it', () => {
    const br = town();
    const list = (br as unknown as { list: BI[] }).list;
    const kits = list.filter((b) => b.kitM !== null);
    expect(kits.length).toBe(2);
    expect(kits.every((b) => b.cells.length > 0)).toBe(true);
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 50000);
    // street level in the middle of the town: everything near is on its full model
    view(cam, 512, 40, 640);
    br.updateLod(cam, H);
    for (let i = 0; i < 3; i++) br.updateLod(cam, H);
    const near = list.filter((b) => b.lod === 1).length;
    // a cut to the far view (4 km out): the catch-up downgrades nearly everything, in the cut frame
    const v0 = shadowCasters.version;
    view(cam, 512, 3000, 512 + 2600);
    br.updateLod(cam, H);
    expect(br.lodBehind).toBe(false);
    const far = list.filter((b) => b.lod === 1).length;
    expect(far).toBeGreaterThan(near + 100);
    // (the rubble kit lots too: every piece on its far level)
    expect(kits.every((b) => b.lod === 1)).toBe(true);
    expect(shadowCasters.version).toBe(v0);
    // the frames after it: nothing left to do, nothing moves the version
    br.updateLod(cam, H);
    br.updateLod(cam, H);
    expect(shadowCasters.version).toBe(v0);
    // back to the street: the upgrades do move it
    view(cam, 512, 40, 640);
    br.updateLod(cam, H);
    expect(list.filter((b) => b.lod === 1).length).toBeLessThan(far);
    expect(shadowCasters.version).toBeGreaterThan(v0);
  }, 120_000);

  it('a cut of up to lodCatchMin due downgrades is done in the cut frame on a loaded machine', () => {
    // a 144 x 144 town with ~4.8k buildings: more due downgrades in a street -> far cut than the old minimum (3000),
    // fewer than a dense 256 x 256 city's ~5.5k
    const N = 144, c = (N * CELL_SIZE) / 2;
    const br = town(N, 2, SMALL);
    const list = (br as unknown as { list: BI[] }).list;
    const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 50000);
    // (a 1080 px drawing buffer: the street view keeps buildings up to ~2 km on their full model, the whole town)
    const H2 = 1080;
    // (a camera looking down on the middle from close up: most buildings on their full model)
    const street = () => { cam.position.set(c, 25, c + 36); cam.lookAt(c, 0, c); cam.updateMatrixWorld(); };
    const farv = () => { cam.position.set(c, 4000, c + 1800); cam.lookAt(c, 0, c); cam.updateMatrixWorld(); };
    const full = () => list.filter((b) => b.lod === 0 && b.lodGeom >= 0 && b.lodGeom !== b.geom).length;
    street();
    for (let i = 0; i < 3; i++) br.updateLod(cam, H2);
    // (every proxy built: the cut below swaps, it does not wait for a proxy; the far view's settled levels)
    farv();
    for (let i = 0; i < 3; i++) br.updateLod(cam, H2);
    expect(br.lodBehind).toBe(false);
    const farFull = full();
    street();
    for (let i = 0; i < 8 && (i < 3 || br.lodBehind); i++) br.updateLod(cam, H2);
    expect(br.lodBehind).toBe(false);
    // the cut's due downgrades: more than the old minimum, at most the current one
    const due = full() - farFull;
    expect(due).toBeGreaterThan(3200);
    expect(due).toBeLessThanOrEqual(br.lodCatchMin);
    // a loaded machine: the wall clock runs 5 ms per read, every budget check is over
    let clock = 0;
    const slow = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 5));
    try {
      farv();
      br.updateLod(cam, H2);
      // the cut frame settles every level: none of the due buildings left on its full model
      expect(br.lodBehind).toBe(false);
      expect(full()).toBe(farFull);
      // (a smaller minimum leaves part of the same cut for the next frames: the clock does bound it beyond the minimum)
      street();
      for (let i = 0; i < 8 && (i < 3 || br.lodBehind); i++) br.updateLod(cam, H2);
      br.lodCatchMin = 3000;
      farv();
      br.updateLod(cam, H2);
      expect(br.lodBehind).toBe(true);
      expect(full()).toBeGreaterThan(farFull);
    } finally { slow.mockRestore(); }
  }, 120_000);
});
