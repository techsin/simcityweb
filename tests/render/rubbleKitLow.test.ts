/**
 * The rubble kit at the low preset (BuildingRenderer.kitLean; pure JS, no WebGL context): burnt multi-cell lots are
 * composed from the same layout as at the other presets, from lighter pieces ('#lw' geometries):
 *  - each heap without its flattened underside (down-facing triangles wholly under the debris bed's top: back faces
 *    under an opaque bed; nothing in the kit casts a shadow at the low preset, whose depth pass would draw them)
 *  - each pile's ash spill without its core ring (the core fans straight into the dust ring); the wall stubs and the
 *    burnt car are the same geometry at every preset
 *  - everything above the spill is the full piece's, triangle for triangle (silhouettes, blocks, beams, walls)
 *  - a preset switch rebuilds the burnt lots from the other preset's pieces (and back), layout unchanged
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { TileCuller } from '../../src/render/city/common/batch';
import { BuildingRenderer } from '../../src/render/city/buildings/BuildingRenderer';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { BF, type Building } from '../../src/sim/CityState';
import { CELL_SIZE } from '../../src/core/constants';

registerAllModels();

type BI = { id: number; lod: number; cells: number[]; kitGeo: number[]; kitLod: number[]; kitM: Float32Array | null };
type Info = { start: number; count: number };

const LOW = 11, HIGH = 9;

/** a flat 64 x 64 town with a few houses and burnt lots of several sizes and building types (rubble kit) */
function town(lodPixels: number): BuildingRenderer {
  const N = 64;
  const st = createCityState(defaultCityConfig({ size: N, seed: 7, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
  st.heights.fill(0);
  const br = new BuildingRenderer(st, new TileCuller(N, CELL_SIZE, 16));
  br.lodBudgetMs = 1e9;
  br.lodPixels = lodPixels;
  let id = 1;
  const add = (def: string, x: number, z: number, w: number, d: number, flags: number) => {
    const b = { id: id++, def, x, z, w, d, rot: 0, variant: 0, built: 1, flags, baseY: 0 } as unknown as Building;
    st.buildings.set(b.id, b);
    br.add(b, false);
  };
  for (let x = 2; x < 60; x += 6) add('res_cottage', x, 2, 2, 2, 0);
  add('res_apartment', 4, 10, 4, 4, BF.Burnt);
  add('ind_warehouse', 12, 10, 4, 4, BF.Burnt);
  add('com_office_small', 20, 10, 3, 3, BF.Burnt);
  add('res_apartment', 28, 10, 2, 2, BF.Burnt);
  add('res_apartment', 34, 10, 3, 2, BF.Burnt);
  add('ind_warehouse', 40, 10, 4, 4, BF.Burnt);
  return br;
}

const internals = (br: BuildingRenderer) => {
  const o = br as unknown as { list: BI[]; batch: { geo: Map<string, number>; triangles(id: number): number; mesh: THREE.BatchedMesh } };
  const keyOf = new Map<number, string>();
  for (const [k, id] of o.batch.geo) keyOf.set(id, k);
  return { list: o.list, batch: o.batch, keyOf };
};

/** the triangles (9 floats each, rounded to mm) of a registered batch geometry */
function tris(br: BuildingRenderer, gid: number): string[] {
  const { batch } = internals(br);
  const info = (batch.mesh as unknown as { _geometryInfo: Info[] })._geometryInfo[gid];
  const P = batch.mesh.geometry.attributes.position.array as Float32Array;
  const out: string[] = [];
  for (let v = info.start; v < info.start + info.count; v += 3) {
    out.push(Array.from(P.subarray(v * 3, v * 3 + 9), (x) => Math.round(x * 1000)).join(','));
  }
  return out;
}
const maxY = (t: string) => { const a = t.split(',').map(Number); return Math.max(a[1], a[4], a[7]) / 1000; };

const cam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 50000);
cam.position.set(512, 120, 700);
cam.lookAt(400, 0, 300);
cam.updateMatrixWorld();

describe('rubble kit at the low preset', () => {
  it('builds the same layout from lighter pieces', () => {
    const lo = town(LOW), hi = town(HIGH);
    const L = internals(lo), H = internals(hi);
    const kl = L.list.filter((b) => b.kitM !== null), kh = H.list.filter((b) => b.kitM !== null);
    expect(kl.length).toBe(6);
    expect(kh.length).toBe(6);
    let tl = 0, th = 0;
    for (let i = 0; i < kl.length; i++) {
      const a = kl[i], b = kh[i];
      // (same layout: the pieces' world matrices, piece for piece)
      expect(Array.from(a.kitM!)).toEqual(Array.from(b.kitM!));
      expect(a.kitGeo.length).toBe(b.kitGeo.length);
      for (let k = 0; k < a.kitGeo.length; k++) {
        const ka = L.keyOf.get(a.kitGeo[k])!, kb = H.keyOf.get(b.kitGeo[k])!;
        // (the wall stubs and the burnt car are one geometry at every preset)
        if (kb === '__rubble:car' || kb.startsWith('__rubble:w')) { expect(ka).toBe(kb); continue; }
        expect(ka).toBe(kb + '#lw');
        tl += L.batch.triangles(a.kitGeo[k]);
        th += H.batch.triangles(b.kitGeo[k]);
        const fa = tris(lo, a.kitGeo[k]), fb = tris(hi, b.kitGeo[k]);
        // everything above the spill (7.5 cm) is the full piece's, triangle for triangle
        expect(fa.filter((t) => maxY(t) > 0.08)).toEqual(fb.filter((t) => maxY(t) > 0.08));
        // no down-facing triangle wholly under the bed
        for (const t of fa) {
          const p = t.split(',').map((x) => Number(x) / 1000);
          if (Math.max(p[1], p[4], p[7]) >= -0.05) continue;
          const n = new THREE.Vector3(p[3] - p[0], p[4] - p[1], p[5] - p[2]).cross(new THREE.Vector3(p[6] - p[0], p[7] - p[1], p[8] - p[2])).normalize();
          expect(n.y).toBeGreaterThanOrEqual(-0.3);
        }
        expect(fa.length).toBeLessThan(fb.length);
      }
      // (the far level is the same at every preset: the lighter pieces' own copies of the proxies)
      for (let k = 0; k < a.kitLod.length; k++) expect(tris(lo, a.kitLod[k])).toEqual(tris(hi, b.kitLod[k]));
    }
    // ~11 % lighter in all (the heaps' undersides and the spills' core rings)
    expect(tl / th).toBeLessThan(0.92);
    expect(tl / th).toBeGreaterThan(0.8);
  }, 120_000);

  it('a preset switch rebuilds the burnt lots from the other pieces, and back', () => {
    const br = town(LOW);
    const I = () => internals(br);
    const kitKeys = () => I().list.filter((b) => b.kitM !== null).flatMap((b) => b.kitGeo.map((g) => I().keyOf.get(g)!)).filter((k) => k !== '__rubble:car' && !k.startsWith('__rubble:w'));
    const layout = () => I().list.filter((b) => b.kitM !== null).map((b) => Array.from(b.kitM!));
    br.updateLod(cam, 720);
    const lay0 = layout();
    expect(kitKeys().every((k) => k.endsWith('#lw'))).toBe(true);
    const live0 = I().list.reduce((n, b) => n + b.cells.length, 0);
    br.lodPixels = HIGH;
    br.updateLod(cam, 720);
    expect(kitKeys().some((k) => k.endsWith('#lw'))).toBe(false);
    expect(layout()).toEqual(lay0);
    // (as many piece instances as before: the old ones were removed)
    expect(I().list.reduce((n, b) => n + b.cells.length, 0)).toBe(live0);
    br.lodPixels = LOW;
    br.updateLod(cam, 720);
    expect(kitKeys().every((k) => k.endsWith('#lw'))).toBe(true);
    expect(layout()).toEqual(lay0);
    expect(I().list.reduce((n, b) => n + b.cells.length, 0)).toBe(live0);
  }, 120_000);
});
