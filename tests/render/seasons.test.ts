/**
 * Seasons (pure JS, no WebGL context):
 *  - nature models carry their Foliage patterns (3 variant-seasonal deciduous, 4 evergreen, 1 / 2 shader-seasonal
 *    shrubs), never the automatic pattern 0; see-through bare crowns report an open fraction (darker, thinner impostors)
 *  - park trees: cherries blossom (2), broadleaves seasonal (1), conifers / palms evergreen (4), layouts unchanged; the
 *    deciduous kit trees mark their leaf lobes (floor >= 1) and carry a winter twig crown (pattern 5, same floor); the
 *    winter swap reads per-face values only and never drops pattern-0 foliage (no shards / confetti); low quality strips
 *    the twig crowns (sprays + limbs + clump inner trunks) back to the plain models' triangles
 *  - setFoliageSeason: winter / spring strengths only in seasonal climates, tropics flower all year
 *  - TreeRenderer: winter flags the bare broadleaf impostors see-through (negative instance red) and stretches the
 *    conifer impostors; a bare winter tree costs no more triangles than a green one; every January street tree is bare;
 *    the map's edge forests continue past the edge (edge band: models up to shadowLodFrac x the LOD distances, then
 *    their own impostors, which never cast) and the outer ring gets impostors, deterministically, its far sectors in
 *    quarter blocks (each drawn as the prefix of its trees, ordered by the thinning random, that its nearest point
 *    keeps) and its near pairs as the prefix of their trees (ordered by depth past the map edge) within reach of the
 *    switch distance; a season / density / map-cell change refills the ring without regenerating it (only a terrain
 *    edit on the map border regenerates that side); the load generates the ring at once, runtime work runs in bounded
 *    slices on calm frames (or every few frames of a long motion); low quality (short tree LOD distance) has no ring /
 *    band
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { getModelGeometry, registeredModelIds } from '../../src/assets/registry';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { Surf } from '../../src/core/types';
import { getBuildingMaterial, patchFoliageDepthMaterial, setFoliageSeason, sharedUniforms } from '../../src/assets/materials';
import { bareTreeProxy, getImpostorGeometries, natureStats } from '../../src/render/world/fallbackTrees';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { TerrainRenderer } from '../../src/render/world/TerrainRenderer';
import { TreeRenderer, ringRand, treeSurfaceChain } from '../../src/render/world/TreeRenderer';
import { CELL_SIZE } from '../../src/core/constants';
import { ModelBuilder } from '../../src/assets/ModelBuilder';
import { RNG } from '../../src/core/rng';
import { palm as comPalm } from '../../src/assets/builders/com_kit';
import { palm as civPalm } from '../../src/assets/builders/civ_kit';
import { BARE_WOOD, bareCrown, tree as parkTree, treeClump, type TreeKind } from '../../src/assets/builders/park_lib';
import { lotTwigGeometry, lotTwigKey, lotTwigs, setLotTwigStrip, stripWinterTwigs } from '../../src/assets/builders/winterTwigs';
import { SEASONAL_TREES, seasonalVariant, setTreeSeason, treeSeason } from '../../src/assets/builders/nat_season';

registerAllModels();

/** foliage area per pattern */
function foliagePatterns(g: THREE.BufferGeometry): Map<number, number> {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const srf = g.getAttribute('surf') as THREE.BufferAttribute;
  const out = new Map<number, number>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    if (Math.round(srf.getX(i)) !== Surf.Foliage) continue;
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    const p = Math.round(srf.getY(i));
    out.set(p, (out.get(p) ?? 0) + b.sub(a).cross(c.sub(a)).length() / 2);
  }
  return out;
}

describe('seasonal foliage patterns', () => {
  it('nature models: variant-seasonal deciduous 3, evergreen 4, shader-seasonal shrubs 1 / 2', () => {
    const expectOnly = (id: string, v: number, p: number) => {
      const pats = foliagePatterns(getModelGeometry(id, v));
      expect([...pats.keys()], `${id}#${v}`).toEqual([p]);
    };
    for (const v of [0, 3, 6, 7]) expectOnly('tree_oak', v, 3);
    for (const v of [0, 4]) expectOnly('tree_maple', v, 3);
    for (const v of [0, 4]) expectOnly('tree_birch', v, 3);
    for (const id of ['tree_pine', 'tree_spruce', 'tree_palm', 'tree_cypress']) expectOnly(id, 0, 4);
    expectOnly('bush', 0, 1);
    expectOnly('bush', 1, 4);
    expectOnly('bush', 2, 2);
    expectOnly('bush', 3, 2);
  });

  it('a bare winter tree costs no more triangles than its species\' green variants (winter forests: no extra load)', () => {
    const tris = (id: string, v: number) => getModelGeometry(id, v).getAttribute('position').count / 3;
    for (const [id, s] of Object.entries(SEASONAL_TREES)) {
      const green = Math.min(...s.green.map((v) => tris(id, v)));
      for (const v of s.bare) expect(tris(id, v), `${id}#${v}`).toBeLessThanOrEqual(green);
    }
  });

  it('street trees: every deciduous one is bare in Dec-Feb (no marcescent brown crowns); the shader gets the raw share', () => {
    for (const month of [11, 0, 1]) {
      setTreeSeason(month, 'temperate');
      expect(treeSeason.mix.bare).toBe(1);
      // (materials.ts FOLIAGE_WINTER applies BARE_ALL itself)
      expect(sharedUniforms.uSeason.value.y).toBeCloseTo(0.93, 5);
      for (const [id, s] of Object.entries(SEASONAL_TREES)) {
        for (let i = 0; i < 200; i++) {
          const r = ((i * 0.6180339887) % 1 + 1) % 1;
          expect(s.bare, `${id} r=${r.toFixed(3)} month ${month}`).toContain(seasonalVariant(id, i % 4, r, treeSeason.mix));
        }
      }
    }
    // spring / summer: no bare street trees; the tropics never
    setTreeSeason(5, 'temperate');
    expect(treeSeason.mix.bare).toBe(0);
    setTreeSeason(0, 'tropical');
    expect(treeSeason.mix.bare).toBe(0);
    setTreeSeason(5, 'temperate');
  });

  it('bare crowns are see-through (darker, thinner impostors); leafy crowns are not', () => {
    const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    for (const [id, bare, green] of [['tree_oak', 6, 0], ['tree_maple', 4, 0], ['tree_birch', 4, 0]] as [string, number, number][]) {
      const b = natureStats(getModelGeometry(id, bare)), g = natureStats(getModelGeometry(id, green));
      expect(b.open, `${id} bare`).toBeGreaterThan(0.6);
      expect(g.open, `${id} green`).toBe(0);
      expect(lum(b.color)).toBeLessThan(0.2);
    }
    for (const id of ['tree_pine', 'tree_spruce', 'tree_palm', 'bush', 'rock']) expect(natureStats(getModelGeometry(id, 0)).open, id).toBe(0);
    // rocks are tinted by their stone, not the old green fallback
    const rock = natureStats(getModelGeometry('rock', 0)).color;
    expect(Math.abs(rock.g - rock.r)).toBeLessThan(0.05);
  });

  it('bareTreeProxy (opaque mid-distance LODs): a slim twig spindle + trunk for bare trees, none for leafy ones', () => {
    for (const [id, bare, green] of [['tree_oak', 6, 0], ['tree_maple', 4, 0], ['tree_birch', 4, 0]] as [string, number, number][]) {
      const gb = getModelGeometry(id, bare), st = natureStats(gb);
      const p = bareTreeProxy(gb)!;
      expect(p, id).toBeTruthy();
      expect(bareTreeProxy(getModelGeometry(id, green)), id).toBeNull();
      expect(p.getAttribute('position').count / 3).toBe(16);
      const bb = p.boundingBox!;
      expect(bb.min.y).toBeCloseTo(0, 3);
      expect(bb.max.y).toBeCloseTo(st.height, 3);
      // at most ~55% of the crown radius wide: the ground shows around a bare tree
      expect(Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2).toBeLessThan(st.radius * 0.6);
      // foliage pattern 3 (never recoloured: the variant carries the season), in the twig colour (red > green)
      const srf = p.getAttribute('surf') as THREE.BufferAttribute, col = p.getAttribute('color') as THREE.BufferAttribute;
      let fol = 0;
      for (let i = 0; i < srf.count; i += 3) {
        if (Math.round(srf.getX(i)) !== Surf.Foliage) continue;
        fol++;
        expect(Math.round(srf.getY(i))).toBe(3);
        expect(col.getX(i)).toBeGreaterThan(col.getY(i));
      }
      expect(fol).toBe(8);
    }
  });

  it('park trees: cherries blossom, broadleaves seasonal, conifers and palms evergreen', () => {
    const tot = new Map<number, number>();
    for (const id of registeredModelIds()) {
      if (MANIFEST_BY_ID[id]?.group !== 'park') continue;
      for (const [p, a] of foliagePatterns(getModelGeometry(id, 0))) tot.set(p, (tot.get(p) ?? 0) + a);
    }
    for (const p of [1, 2, 4]) expect(tot.get(p) ?? 0, `pattern ${p}`).toBeGreaterThan(10);
  }, 120_000);

  it('deciduous kit trees: lobes marked floor >= 1 + a winter twig crown (pattern 5, same floor); evergreens: neither', () => {
    /** distinct floor values of the faces painted Foliage pattern `pat` */
    const floors = (g: THREE.BufferGeometry, pat: number) => {
      const srf = g.getAttribute('surf') as THREE.BufferAttribute;
      const out = new Set<string>();
      for (let i = 0; i < srf.count; i += 3) if (Math.round(srf.getX(i)) === Surf.Foliage && Math.round(srf.getY(i)) === pat) out.add(srf.getZ(i).toFixed(4));
      return [...out].map(Number);
    };
    for (const kind of ['oak', 'round', 'maple', 'birch', 'poplar', 'willow', 'cherry'] as TreeKind[]) {
      const b = new ModelBuilder();
      parkTree(b, new RNG(3), 0, 0, 1, kind);
      const g = b.build();
      // a few square metres of twig sprays (thin spikes), one per-tree floor shared by the lobes and the twigs
      expect(foliagePatterns(g).get(5) ?? 0, kind).toBeGreaterThan(0.3);
      const lobes = floors(g, kind === 'cherry' ? 2 : 1), twigs = floors(g, 5);
      expect(lobes.length, kind).toBe(1);
      expect(lobes[0], kind).toBeGreaterThanOrEqual(1);
      expect(twigs, kind).toEqual(lobes);
    }
    for (const kind of ['cone', 'acacia', 'palm'] as TreeKind[]) {
      const b = new ModelBuilder();
      parkTree(b, new RNG(3), 0, 0, 1, kind);
      // (evergreen lobes: pattern 4, never swapped whatever their floor)
      expect([...foliagePatterns(b.build()).keys()], kind).toEqual([4]);
    }
  });

  it('bareCrown (for the other kits\' lot trees): a lighter twig crown on the floor its crown blob is painted with', () => {
    const b = new ModelBuilder();
    b.paint(0x5b4330, Surf.Wood).cylinder(4, -2, 0, 2.4, 0.2, 0.14, 5, { top: false });
    const fl = bareCrown(b, 4, -2, [4, 2.3, -2], [4, 3.9, -2], 2.2, 2.0, 0x5b4330, 0.14);
    b.paint(0x4c7630, Surf.Foliage, 1, fl).blob(4, 3.9, -2, 2.2, 2.0, 2.2, 0, 0.16, 1.5);
    const g = b.build();
    expect(fl).toBeGreaterThanOrEqual(1);
    expect(fl).toBeLessThan(2);
    const srf = g.getAttribute('surf') as THREE.BufferAttribute;
    let twig = 0, blob = 0;
    for (let i = 0; i < srf.count; i += 3) {
      if (Math.round(srf.getX(i)) !== Surf.Foliage) continue;
      const p = Math.round(srf.getY(i));
      if (p === 5) { twig++; expect(srf.getZ(i)).toBeCloseTo(fl, 4); }
      if (p === 1) blob++;
    }
    expect(blob).toBe(20);
    // 3 tips x 3 single-sided spikes, turned up (the camera looks down at them); 3 double-sided bark blades (the limbs,
    // inside the crown: they cast the bare tree's shadow) + the 10-tri trunk
    expect(twig).toBe(9);
    for (let i = 0; i < srf.count; i += 3) {
      if (Math.round(srf.getX(i)) !== Surf.Foliage || Math.round(srf.getY(i)) !== 5) continue;
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const a = new THREE.Vector3().fromBufferAttribute(pos, i), e1 = new THREE.Vector3().fromBufferAttribute(pos, i + 1).sub(a);
      expect(e1.cross(new THREE.Vector3().fromBufferAttribute(pos, i + 2).sub(a)).y, 'twig faces up').toBeGreaterThanOrEqual(0);
    }
    let wood = 0;
    for (let i = 0; i < srf.count; i += 3) if (Math.round(srf.getX(i)) === Surf.Wood) wood++;
    expect(wood).toBe(16);
    // the same tree position always gives the same crown (no rng draw)
    const b2 = new ModelBuilder();
    expect(bareCrown(b2, 4, -2, [4, 2.3, -2], [4, 3.9, -2], 2.2, 2.0, 0x5b4330, 0.14)).toBe(fl);
  });

  it('lot shadows: patchFoliageDepthMaterial runs the bare-winter crown swap in the depth pass, winter only', () => {
    const m = patchFoliageDepthMaterial(new THREE.MeshDepthMaterial());
    const sh = { vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
    const vs = sh.vertexShader;
    expect(vs).toContain('attribute vec3 surf;');
    expect(vs).toContain('if (uSeason.y > 0.0 && abs(surf.x - 8.0) < 0.5)');
    // the view's swap (FOLIAGE_WINTER), after begin_vertex
    expect(vs.indexOf('bool bareW')).toBeGreaterThan(vs.indexOf('#include <begin_vertex>'));
    expect(vs).toContain('transformed = vec3(0.0)');
    expect((sh.uniforms as Record<string, unknown>).uSeason).toBe(sharedUniforms.uSeason);
    expect(m.customProgramCacheKey()).toContain('foliage-winter');
    // the view's vertex shader runs the same swap
    const vw = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    getBuildingMaterial().onBeforeCompile(vw, {} as THREE.WebGLRenderer);
    const swap = vs.slice(vs.indexOf('bool bareW'), vs.indexOf('transformed = vec3(0.0)'));
    expect(swap.length).toBeGreaterThan(100);
    expect(vw.vertexShader).toContain(swap);
    // per-face values only (paint channels + instance seed): all three corners of a face agree, so a face is dropped
    // whole, never stretched into a shard; and pattern-0 foliage (shrubs, hedges, roof planters) is never dropped
    for (const perVertex of ['normal', 'color', 'position']) expect(swap, perVertex).not.toContain(perVertex);
    expect(swap).toContain('surf.y > 0.5 && surf.y < 2.5 && surf.z >= 1.0');
  });

  it('low quality twig strip: kit / park trees lose their winter twig crowns, back to the plain models\' triangles', () => {
    // a kit tree (res_util round tree): 10-tri trunk + 20-tri crown blob + the 15-tri bare crown (9 spray, 6 limb tris)
    const b = new ModelBuilder();
    b.paint(0x5b4330, Surf.Wood).cylinder(4, -2, 0, 2.4, 0.2, 0.14, 5, { top: false });
    const fl = bareCrown(b, 4, -2, [4, 2.3, -2], [4, 3.9, -2], 2.2, 2.0, 0x5b4330, 0.14);
    b.paint(0x4c7630, Surf.Foliage, 1, fl).blob(4, 3.9, -2, 2.2, 2.0, 2.2, 0, 0.16, 1.5);
    const g = b.build();
    expect(g.getAttribute('position').count / 3).toBe(45);
    const s = stripWinterTwigs(g)!;
    expect(s.getAttribute('position').count / 3).toBe(30);
    expect(stripWinterTwigs(g)).toBe(s);
    const srf = s.getAttribute('surf') as THREE.BufferAttribute;
    for (let i = 0; i < srf.count; i++) {
      expect(Math.round(srf.getY(i)), 'no pattern-5 faces').not.toBe(5);
      // the crown keeps its per-tree random but loses the swap marker: it stays a (twig-coloured) crown while bare
      if (Math.round(srf.getX(i)) === Surf.Foliage) expect(srf.getZ(i)).toBeCloseTo(fl - 1, 5);
    }
    for (const name of ['position', 'normal', 'color', 'surf']) expect(s.getAttribute(name).count).toBe(90);
    // park trees and clumps: every winter-only face is pattern 5 (sprays) or Wood BARE_WOOD (limbs, inner trunks)
    const pb = new ModelBuilder();
    parkTree(pb, new RNG(3), 0, 0, 1, 'oak');
    treeClump(pb, new RNG(4), 20, 0, 6, 4);
    const pg = pb.build(), ps = stripWinterTwigs(pg)!;
    const psrf = pg.getAttribute('surf') as THREE.BufferAttribute;
    let winter = 0, limbs = 0;
    for (let i = 0; i < psrf.count; i += 3) {
      if (Math.round(psrf.getY(i)) !== 5) continue;
      winter++;
      if (Math.round(psrf.getX(i)) === Surf.Wood) limbs++;
    }
    expect(BARE_WOOD).toBe(5);
    expect(limbs).toBeGreaterThan(8);
    expect(ps.getAttribute('position').count / 3).toBe(pg.getAttribute('position').count / 3 - winter);
    // a model without twig crowns is registered as is
    const nb = new ModelBuilder();
    nb.paint(0x4c7630, Surf.Foliage).blob(0, 1, 0, 1, 0.8, 1, 0, 0.2, 2);
    const ng = nb.build();
    expect(stripWinterTwigs(ng)).toBeNull();
    // the building renderer's registration: the stripped geometry under its own key while the strip is on
    const v0 = lotTwigs.version;
    setLotTwigStrip(false);
    expect(lotTwigGeometry(g)).toBe(g);
    expect(lotTwigKey('k', g)).toBe('k');
    setLotTwigStrip(true);
    expect(lotTwigs.version).toBeGreaterThan(v0);
    expect(lotTwigGeometry(g)).toBe(s);
    expect(lotTwigKey('k', g)).toBe('k#lt');
    expect(lotTwigGeometry(ng)).toBe(ng);
    expect(lotTwigKey('k', ng)).toBe('k');
    setLotTwigStrip(false);
  });

  it('lot palms (commercial / civic kits) are evergreen: their fronds never turn autumn-coloured or bare', () => {
    for (const palm of [comPalm, civPalm]) {
      const b = new ModelBuilder();
      palm(b, new RNG(5), 0, 0, 1);
      expect([...foliagePatterns(b.build()).keys()]).toEqual([4]);
    }
  });

  it('setFoliageSeason: winter / spring only in seasonal climates, the tropics flower all year', () => {
    const fs = sharedUniforms.uFoliageSeason.value;
    setFoliageSeason(0, 'temperate');
    expect(fs.y).toBe(1);
    expect(sharedUniforms.uFoliageDry.value).toBeGreaterThan(0.4);
    setFoliageSeason(3, 'alpine');
    expect(fs.z).toBe(1);
    expect(fs.y).toBe(0);
    setFoliageSeason(0, 'desert');
    expect(fs.y).toBe(0);
    expect(fs.x).toBeCloseTo(0.45);
    setFoliageSeason(6, 'tropical');
    expect(fs.w).toBe(1);
    expect(fs.y + fs.z).toBe(0);
    setFoliageSeason(5, 'temperate');
  });
});

describe('tree programs', () => {
  it('shade only the tree surfaces: the uber surface chain keeps the foliage / bark / rock / plain blocks', () => {
    const sh = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    getBuildingMaterial().onBeforeCompile(sh, {} as THREE.WebGLRenderer);
    const fs = sh.fragmentShader;
    const out = treeSurfaceChain(fs);
    expect(out.length).toBeLessThan(fs.length * 0.8);
    // the chain keeps its structure and the blocks tree surfaces enter
    const markers = (s: string) => s.split('\n').filter((l) => /^ {2}\} else( if \(.*\))? \{$/.test(l)).length;
    expect(markers(out)).toBe(markers(fs));
    for (const s of ['void applySurface(', 'float lowF =', '// wood planks', 'float stand =']) expect(out, s).toContain(s);
    // facade-only work is gone (window night lights)
    const calls = (s: string) => s.split('\n').filter((l) => l.includes('nightWindows(') && !/^\s*(vec[234]|float|void)\s+nightWindows\(/.test(l)).length;
    expect(calls(fs)).toBeGreaterThan(0);
    expect(calls(out)).toBe(0);
    // anything unexpected is left as it is
    expect(treeSurfaceChain('void main() {}')).toBe('void main() {}');
    const odd = fs.replace(/^ {2}\} else if \(type < 3\.5\) \{$/m, '  } else if (type < 3.5 && vertical) {');
    expect(odd).not.toBe(fs);
    expect(treeSurfaceChain(odd)).toBe(odd);
  });
});

describe('tree impostors in winter', () => {
  it('bare broadleaf impostors are flagged see-through (negative instance red); conifer impostors stretch 10%', () => {
    const st = createCityState(defaultCityConfig({ size: 64, seed: 11, terrain: 'hills', climate: 'temperate', treeDensity: 0.6 }));
    const tr = new TreeRenderer(st, new TerrainRenderer(st, 1, false), { lodDistance: 850, density: 1, castShadows: false, maxVariants: 3 });
    const chunks = (tr as unknown as { chunks: { far: (THREE.InstancedMesh | null)[]; farTotal: number[] }[] }).chunks;
    const scan = () => {
      let bare = 0, broad = 0, conH = 0, con = 0;
      for (const c of chunks) {
        const [b, k] = c.far;
        if (b) {
          const col = b.instanceColor!.array as Float32Array;
          for (let i = 0; i < c.farTotal[0]; i++) { broad++; bare += col[i * 3] < 0 ? 1 : 0; }
        }
        if (k) {
          const e = k.instanceMatrix.array as Float32Array;
          for (let i = 0; i < c.farTotal[1]; i++) { conH += e[i * 16 + 5]; con++; }
        }
      }
      return { bare, broad, conH, con };
    };
    tr.setMonth(6);
    tr.flush(false);
    const jul = scan();
    tr.setMonth(0);
    tr.flush(false);
    const jan = scan();
    expect(jul.broad).toBeGreaterThan(100);
    expect(jul.bare).toBe(0);
    expect(jan.bare).toBeGreaterThan(jan.broad * 0.3);
    // mid-winter: every deciduous forest tree is bare (no marcescent leftovers: they read as brown boulders)
    const kinds = (tr as unknown as { kinds: { id: string; variant: number }[] }).kinds;
    const near = (tr as unknown as { chunks: { near: (THREE.InstancedMesh | null)[] }[] }).chunks;
    let seasonal = 0, leafy = 0;
    for (const c of near) c.near.forEach((m, k) => {
      const s = SEASONAL_TREES[kinds[k].id];
      if (!m || !s) return;
      seasonal += m.count;
      if (!s.bare.includes(kinds[k].variant)) leafy += m.count;
    });
    expect(seasonal).toBeGreaterThan(50);
    expect(leafy).toBe(0);
    expect(jan.con).toBe(jul.con);
    expect(jan.con).toBeGreaterThan(20);
    expect(jan.conH / jul.conH).toBeCloseTo(1.1, 2);
    tr.dispose();
  }, 120_000);
});

describe('outer ring trees', () => {
  const make = (size = 64) => {
    const st = createCityState(defaultCityConfig({ size, seed: 11, terrain: 'hills', climate: 'temperate', treeDensity: 0.6 }));
    const tr = new TreeRenderer(st, new TerrainRenderer(st, 1, false), { lodDistance: 850, density: 1, castShadows: false, maxVariants: 3 });
    tr.flush();
    return { st, tr };
  };
  /** x / z of every drawn-able ring instance (micro sector meshes: all of a sector's trees) */
  const ringXZ = (tr: TreeRenderer) => {
    const out: string[] = [];
    for (const m of tr.group.children as THREE.InstancedMesh[]) {
      if (m.name !== 'trees-ring' || !(m.geometry.name ?? '').startsWith('impostor-micro')) continue;
      const e = m.instanceMatrix.array as Float32Array;
      for (let i = 0; i < ((m.userData.ringCount as number) ?? 0); i++) out.push(`${e[i * 16 + 12].toFixed(2)},${e[i * 16 + 14].toFixed(2)}`);
    }
    return out;
  };

  it('edge forests continue past the map edge and the landscape ring gets impostors, deterministically', () => {
    const { st, tr } = make();
    const W = st.size * CELL_SIZE;
    // trees placed beyond the map edge by the edge chunks (full models), none further out than the edge band
    let beyond = 0, outside = 0;
    for (const m of tr.group.children as THREE.InstancedMesh[]) {
      if (!m.isInstancedMesh || !m.name.startsWith('trees-') || m.name === 'trees-far' || m.name === 'trees-ring' || m.name === 'trees-warmup') continue;
      const e = m.instanceMatrix.array as Float32Array;
      for (let i = 0; i < m.count; i++) {
        const x = e[i * 16 + 12], z = e[i * 16 + 14];
        const d = Math.max(-x, x - W, -z, z - W, 0);
        if (d > 0) beyond++;
        if (d > 10 * CELL_SIZE + 1) outside++;
      }
    }
    expect(beyond).toBeGreaterThan(0);
    expect(outside).toBe(0);
    expect(tr.ringInstances).toBeGreaterThan(500);
    expect(tr.ringGenerations).toBe(8);
    const ring = tr.group.children.filter((o) => o.name === 'trees-ring') as THREE.InstancedMesh[];
    expect(ring.length).toBeGreaterThan(0);
    // every ring impostor stands outside the map and its edge band
    for (const m of ring) {
      const e = m.instanceMatrix.array as Float32Array;
      for (let i = 0; i < ((m.userData.ringCount as number) ?? 0); i++) {
        const x = e[i * 16 + 12], z = e[i * 16 + 14];
        expect(Math.max(-x, x - W, -z, z - W)).toBeGreaterThan(10 * CELL_SIZE - 1);
      }
    }
    // each sector draws its trees in one micro mesh (broadleaves + conifers) beyond lodDistance; its conifers carry the
    // evergreen flag (negative instance blue), the near pair keeps the two impostor shapes apart; no ring shadows
    const micro = ring.filter((m) => (m.geometry.name ?? '').startsWith('impostor-micro'));
    // (the sectors' micro impostors in their quarter blocks: at most 4 meshes per sector)
    expect(micro.length).toBeGreaterThan(8);
    expect(micro.length).toBeLessThanOrEqual(32);
    expect(micro.reduce((a, m) => a + ((m.userData.ringCount as number) ?? 0), 0)).toBe(tr.ringInstances);
    let flagged = 0, conifers = 0;
    for (const m of ring) {
      const n = (m.userData.ringCount as number) ?? 0, c = m.instanceColor!.array as Float32Array;
      if (micro.includes(m)) for (let i = 0; i < n; i++) flagged += c[i * 3 + 2] < 0 ? 1 : 0;
      else if (m.geometry === getImpostorGeometries().conifer) conifers += n;
    }
    expect(conifers).toBeGreaterThan(0);
    expect(flagged).toBe(conifers);
    expect(ring.every((m) => !m.castShadow)).toBe(true);
    // deterministic
    expect(make().tr.ringInstances).toBe(tr.ringInstances);
    tr.dispose();
  }, 120_000);

  it('season, density and map-cell changes refill the ring; only a border terrain edit regenerates (that side)', () => {
    const { st, tr } = make();
    const n0 = tr.ringInstances, xz0 = ringXZ(tr);
    // a season change: same trees, new kinds / colours
    tr.setMonth(9);
    tr.flush();
    expect(tr.ringInstances).toBe(n0);
    expect(tr.ringGenerations).toBe(8);
    // a lower quality density draws a subset of the same trees, without new candidates
    tr.setQuality({ lodDistance: 850, density: 0.75, castShadows: false, maxVariants: 3 });
    tr.flush();
    expect(tr.ringGenerations).toBe(8);
    expect(tr.ringInstances).toBeLessThan(n0 * 0.7);
    expect(tr.ringInstances).toBeGreaterThan(n0 * 0.3);
    const all = new Set(xz0);
    for (const p of ringXZ(tr)) expect(all.has(p)).toBe(true);
    tr.setQuality({ lodDistance: 850, density: 1, castShadows: false, maxVariants: 3 });
    tr.flush();
    expect(tr.ringInstances).toBe(n0);
    // zoning / roads / trees on the map border: the chunk is rebuilt, the ring is not regenerated
    tr.onCellsChanged({ x0: 0, z0: 20, x1: 3, z1: 24 });
    tr.flush();
    expect(tr.ringGenerations).toBe(8);
    // a terrain edit on the west border moves the outer landscape there: the 3 west sectors are regenerated
    const N1 = st.size + 1;
    for (let z = 20; z <= 24; z++) st.heights[z * N1] += 6;
    tr.onCellsChanged({ x0: 0, z0: 20, x1: 3, z1: 24 });
    tr.flush();
    expect(tr.ringGenerations).toBe(11);
    tr.dispose();
  }, 120_000);

  it('far (micro) chunks draw broadleaf + conifer impostors as one merged mesh; nearer chunks keep the pair', () => {
    const { st, tr } = make();
    const W = st.size * CELL_SIZE;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    const chunks = (tr as unknown as { chunks: { far: (THREE.InstancedMesh | null)[]; farTotal: number[] }[] }).chunks;
    // far above the map: every chunk projects its trees below a pixel -> micro state
    cam.position.set(W / 2, 30000, W / 2);
    tr.update(cam);
    let merged = 0;
    for (const c of chunks) {
      const [b, k, m] = c.far;
      if (!m || !c.farTotal[2]) continue;
      expect(c.farTotal[2]).toBe(c.farTotal[0] + c.farTotal[1]);
      expect(m.visible).toBe(true);
      expect(!!b?.visible || !!k?.visible).toBe(false);
      const col = m.instanceColor!.array as Float32Array;
      let flagged = 0;
      for (let i = 0; i < c.farTotal[2]; i++) flagged += col[i * 3 + 2] < 0 ? 1 : 0;
      expect(flagged).toBe(c.farTotal[1]);
      merged++;
    }
    expect(merged).toBeGreaterThan(0);
    // close to the map: the regular broadleaf / conifer pair again
    cam.position.set(W / 2, 300, W / 2);
    tr.update(cam);
    for (const c of chunks) if (c.far[2]) expect(c.far[2].visible).toBe(false);
    tr.dispose();
  }, 120_000);

  it('low cameras: no ring from inside the city, the near sectors next to the map edge; high cameras: far sectors', () => {
    const { st, tr } = make(128);
    const W = st.size * CELL_SIZE;
    const terr = (tr as unknown as { terrain: TerrainRenderer }).terrain;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    const ring = () => tr.group.children.filter((o) => o.name === 'trees-ring') as THREE.InstancedMesh[];
    const isMicro = (m: THREE.InstancedMesh) => (m.geometry.name ?? '').startsWith('impostor-micro');
    const at = (x: number, h: number, z: number) => {
      cam.position.set(x, terr.meshHeightAt(x, z) + h, z);
      tr.update(cam);
    };
    // street height in the middle of a 2 km map: the ring is hidden
    at(W / 2, 30, W / 2);
    expect(ring().some((m) => m.visible)).toBe(false);
    // street height next to the west edge: the ring is the horizon there - that side's regular impostor pair
    at(60, 30, W / 2);
    const shown = ring().filter((m) => m.visible);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.some(isMicro)).toBe(false);
    // high above the map: the far sectors' micro impostors
    at(W / 2, 3000, W / 2);
    expect(ring().some((m) => m.visible && isMicro(m))).toBe(true);
    tr.dispose();
  }, 120_000);

  it('edge band: a near edge chunk submits only the band trees within the view\'s reach (none it could show is cut)', () => {
    const { st, tr } = make(128);
    const W = st.size * CELL_SIZE;
    const terr = (tr as unknown as { terrain: TerrainRenderer }).terrain;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    const chunks = (tr as unknown as { chunks: { near: (THREE.InstancedMesh | null)[]; isNear: boolean; mapN: Int32Array | null; nearN: Int32Array | null }[] }).chunks;
    // the band trees' fade end + jitter (TreeRenderer.update: shadowLodFrac x the map trees'): a band tree's near model
    // past it is fully faded out
    const lod = 850, w = lod * tr.fadeBandDither, reach = (lod + w + w * 0.8 * 0.5) * tr.shadowLodFrac;
    const a2c = (tr as unknown as { a2c: boolean }).a2c;
    expect(a2c).toBe(false);
    for (const [x, z] of [[W / 2, W / 2], [W * 0.3, W * 0.6], [120, W / 2]]) {
      cam.position.set(x, terr.meshHeightAt(x, z) + 40, z);
      cam.lookAt(x + 100, 0, z + 50);
      cam.updateMatrixWorld();
      tr.update(cam);
      let band = 0, cut = 0;
      for (const c of chunks) {
        if (!c.mapN || !c.nearN || !c.isNear) continue;
        for (let k = 0; k < c.near.length; k++) {
          const m = c.near[k];
          if (!m) continue;
          band += c.nearN[k] - c.mapN[k];
          cut += c.nearN[k] - m.count;
          expect(m.count).toBeGreaterThanOrEqual(c.mapN[k]);
          const e = m.instanceMatrix.array as Float32Array;
          // every band tree left out is beyond the reach of the view's near models
          for (let i = m.count; i < c.nearN[k]; i++) expect(Math.hypot(e[i * 16 + 12] - cam.position.x, e[i * 16 + 13] - cam.position.y, e[i * 16 + 14] - cam.position.z)).toBeGreaterThan(reach);
        }
      }
      expect(band).toBeGreaterThan(0);
      // from the middle of a 2 km map most band trees are out of reach (off-centre cameras: a looser bound)
      if (x === W / 2) expect(cut).toBeGreaterThan(band * 0.5);
    }
    tr.dispose();
  }, 120_000);

  it('far ring blocks: culled by their own bounds, each submits the prefix of its trees (ordered by ringRand) the shader can keep', () => {
    const { st, tr } = make(128);
    const W = st.size * CELL_SIZE;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    // the bench's far view: 4 km from the map centre, 85 degrees down
    const a = (85 * Math.PI) / 180, y = (45 * Math.PI) / 180, d = 4000;
    cam.position.set(W / 2 - Math.sin(y) * Math.cos(a) * d, Math.sin(a) * d, W / 2 + Math.cos(y) * Math.cos(a) * d);
    cam.lookAt(W / 2, 0, W / 2);
    cam.updateMatrixWorld();
    tr.update(cam);
    const blocks = tr.group.children.filter((o) => o.name === 'trees-ring' && ((o as THREE.Mesh).geometry.name ?? '').startsWith('impostor-micro')) as THREE.InstancedMesh[];
    expect(blocks.length).toBeGreaterThan(8);
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let total = 0, submitted = 0, culled = 0, cut = 0;
    for (const m of blocks) {
      const n = (m.userData.ringCount as number) ?? 0, e = m.instanceMatrix.array as Float32Array;
      total += n;
      // ordered by the thinning random
      for (let j = 1; j < n; j++) expect(ringRand(e[j * 16 + 12], e[j * 16 + 14])).toBeGreaterThanOrEqual(ringRand(e[(j - 1) * 16 + 12], e[(j - 1) * 16 + 14]));
      // every tree past the prefix is one the shader drops at its own distance (keep fraction at the tree's foot, as
      // TREE_RING: a conifer's instance is shifted down by its stretch, negative instance blue)
      const col = m.instanceColor!.array as Float32Array;
      for (let j = m.count; j < n; j++) {
        const foot = e[j * 16 + 13] + (col[j * 3 + 2] < 0 ? (0.9 / 0.37 - 1) / (0.9 / 0.37) * e[j * 16 + 5] : 0);
        const dist = Math.hypot(e[j * 16 + 12] - cam.position.x, foot - cam.position.y, e[j * 16 + 14] - cam.position.z);
        const keep = Math.min(1, Math.max(0.3, 1.2 - (dist - 850) / 5500));
        expect(ringRand(e[j * 16 + 12], e[j * 16 + 14])).toBeGreaterThanOrEqual(keep - 1e-4);
      }
      if (m.count < n) cut++;
      if (!m.visible) continue;
      if (!m.intersectsFrustum(fr)) culled++;
      else submitted += m.count;
    }
    expect(total).toBe(tr.ringInstances);
    // seen from above (4 km), a third of the blocks are off screen and the rest thinned: ~half the trees are submitted
    expect(culled).toBeGreaterThan(5);
    expect(cut).toBeGreaterThan(10);
    expect(submitted).toBeGreaterThan(0);
    expect(submitted).toBeLessThan(total * 0.6);
    tr.dispose();
  }, 120_000);

  it('the load generates the ring at once; runtime work (a border edit\'s regeneration) runs in bounded slices', () => {
    const st = createCityState(defaultCityConfig({ size: 128, seed: 11, terrain: 'hills', climate: 'temperate', treeDensity: 0.6 }));
    const tr = new TreeRenderer(st, new TerrainRenderer(st, 1, false), { lodDistance: 850, density: 1, castShadows: false, maxVariants: 3 });
    const ring = tr as unknown as { ringStale: number; ringRefill: number; ringGen: unknown; ringFillState: unknown; ringFarDirty: number; dirty: Set<number> };
    const busy = () => !!(ring.ringStale || ring.ringRefill || ring.ringGen || ring.ringFillState || ring.ringFarDirty);
    // the constructor (load): every sector generated, filled and uploaded; only the map's chunks are left to the first
    // frames (nearest first)
    expect(tr.ringGenerations).toBe(8);
    expect(busy()).toBe(false);
    expect(tr.ringInstances).toBeGreaterThan(500);
    expect(ring.dirty.size).toBe(16);
    const blocks = () => tr.group.children.filter((o) => o.name === 'trees-ring' && ((o as THREE.Mesh).geometry.name ?? '').startsWith('impostor-micro')) as THREE.InstancedMesh[];
    expect(blocks().reduce((a, m) => a + ((m.userData.ringCount as number) ?? 0), 0)).toBe(tr.ringInstances);
    // a regeneration of every sector (as after border terrain edits): zero-budget slices, one bounded unit each (a block
    // row, a candidate batch, a sector's finish or its far blocks' upload), at most one sector completed per slice
    const n0 = tr.ringInstances;
    ring.ringStale = 0xff;
    let slices = 0;
    while (busy() && slices < 100000) {
      const before = tr.ringGenerations;
      tr.ringStep(0);
      slices++;
      expect(tr.ringGenerations - before).toBeLessThanOrEqual(1);
    }
    expect(tr.ringGenerations).toBe(16);
    expect(tr.ringInstances).toBe(n0);
    // 128-cell map: a sector spans 52-66 block rows
    expect(slices).toBeGreaterThan(8 * 40);
    // flush() completes pending work at once
    ring.ringStale = 0xff;
    tr.ringStep(0);
    expect(busy()).toBe(true);
    tr.flush();
    expect(busy()).toBe(false);
    expect(tr.ringGenerations).toBe(24);
    tr.dispose();
  }, 120_000);

  it('runtime ring work runs on calm frames, and while the camera keeps moving one slice every few frames after a wait', () => {
    const st = createCityState(defaultCityConfig({ size: 64, seed: 11, terrain: 'hills', climate: 'temperate', treeDensity: 0.6 }));
    const W = st.size * CELL_SIZE;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    /** a renderer with a season refill pending, whose ring slices are counted (zero budget: one unit per slice) */
    const counted = () => {
      const tr = new TreeRenderer(st, new TerrainRenderer(st, 1, false), { lodDistance: 850, density: 1, castShadows: false, maxVariants: 3 });
      tr.ringBudgetMs = 0;
      // (the load generated the ring: no slice is due until a runtime change)
      cam.position.set(W / 2, 600, W / 2 + 300);
      for (let f = 0; f < 20; f++) tr.update(cam);
      const step = tr.ringStep.bind(tr);
      const c = { tr, slices: 0 };
      tr.ringStep = (b: number) => { c.slices++; step(b); };
      for (let f = 0; f < 20; f++) tr.update(cam);
      expect(c.slices).toBe(0);
      tr.setMonth(st.month === 6 ? 0 : 6);
      return c;
    };
    const a = counted();
    // a camera zooming out (2% of its height per frame): no slice for 200 frames
    let h = 200;
    for (let f = 0; f < 200; f++) {
      cam.position.set(W / 2, (h *= 1.02), W / 2 + 300);
      a.tr.update(cam);
    }
    expect(a.slices).toBe(0);
    // the camera stops: slices start after a few still frames (and the season's chunk rebuilds), one per frame
    let still = 0;
    while (!a.slices && still < 100) { a.tr.update(cam); still++; }
    expect(still).toBeGreaterThanOrEqual(8);
    const s0 = a.slices;
    for (let f = 0; f < 5; f++) a.tr.update(cam);
    expect(a.slices).toBe(s0 + 5);
    // a cut (one big jump) pauses them for the catch-up frames after it, then they resume
    cam.position.set(W / 4, 900, W / 4);
    const s1 = a.slices;
    for (let f = 0; f < 6; f++) a.tr.update(cam);
    expect(a.slices).toBe(s1);
    for (let f = 0; f < 4; f++) a.tr.update(cam);
    expect(a.slices).toBeGreaterThan(s1);
    // a camera that never stops (a pan of 20 m per frame): after RING_MAX_WAIT (240) frames one slice every 8 frames
    const b = counted();
    let k = 0;
    for (; k < 400 && !b.slices; k++) {
      cam.position.set(W / 2 + k * 20, 600, W / 2);
      b.tr.update(cam);
    }
    expect(k).toBeGreaterThan(240);
    expect(k).toBeLessThanOrEqual(240 + 8);
    const s2 = b.slices;
    for (let f = 0; f < 80; f++) {
      cam.position.set(W / 2 + (k + f) * 20, 600, W / 2);
      b.tr.update(cam);
    }
    expect(b.slices - s2).toBeGreaterThanOrEqual(9);
    expect(b.slices - s2).toBeLessThanOrEqual(11);
    a.tr.dispose();
    b.tr.dispose();
  }, 120_000);

  it('ring near pairs submit only the trees within reach of their switch distance (ordered by depth past the map edge)', () => {
    const { st, tr } = make(128);
    const W = st.size * CELL_SIZE;
    const terr = (tr as unknown as { terrain: TerrainRenderer }).terrain;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    const lod = 850, reach = lod * 1.06;
    const nears = () => tr.group.children.filter((o) => o.name === 'trees-ring' && !((o as THREE.Mesh).geometry.name ?? '').startsWith('impostor-micro')) as THREE.InstancedMesh[];
    expect(nears().length).toBe(16);
    for (const [x, h, z] of [[60, 30, W / 2], [W * 0.2, 400, W * 0.1], [W / 2, 30, W / 2], [W / 2, 3000, W / 2], [W - 30, 80, W - 30]]) {
      cam.position.set(x, terr.meshHeightAt(x, z) + h, z);
      tr.update(cam);
      let submitted = 0, total = 0;
      for (const m of nears()) {
        const n = (m.userData.ringCount as number) ?? 0, e = m.instanceMatrix.array as Float32Array;
        total += n;
        submitted += m.visible ? m.count : 0;
        // every tree left out is beyond any tree's switch distance (the shader draws a tree up to <= 1.06 x lod)
        for (let i = m.visible ? m.count : 0; i < n; i++) {
          expect(Math.hypot(e[i * 16 + 12] - cam.position.x, e[i * 16 + 13] - cam.position.y, e[i * 16 + 14] - cam.position.z)).toBeGreaterThan(reach);
        }
      }
      expect(total).toBe(tr.ringInstances);
      // from the middle of the map or high above it, none; next to the edge, the trees in reach only
      if (x === W / 2) expect(submitted).toBe(0);
      else expect(submitted).toBeLessThan(total * 0.5);
      if (x === 60) expect(submitted).toBeGreaterThan(0);
    }
    tr.dispose();
  }, 120_000);

  it('edge band trees: models up to shadowLodFrac x the LOD distances, then their own impostors, which never cast', () => {
    const { st, tr } = make(128);
    const W = st.size * CELL_SIZE;
    const terr = (tr as unknown as { terrain: TerrainRenderer }).terrain;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 1, 90000);
    type Ch = { near: (THREE.InstancedMesh | null)[]; bfar: (THREE.InstancedMesh | null)[]; bfarTotal: number[]; mapN: Int32Array | null; isNear: boolean; box: THREE.Box3 };
    const chunks = (tr as unknown as { chunks: Ch[] }).chunks;
    const edge = chunks.filter((c) => c.mapN);
    expect(edge.length).toBe(12);
    // every band tree has an impostor in its chunk's band meshes, which never cast shadows
    let bandTrees = 0, bandImps = 0;
    for (const c of edge) {
      bandTrees += c.near.reduce((a, m, k) => a + (m ? ((m.userData.total as number) ?? 0) - c.mapN![k] : 0), 0);
      bandImps += c.bfarTotal[0] + c.bfarTotal[1];
      for (const m of c.bfar) if (m) expect(m.name).toBe('trees-far-band');
    }
    expect(bandTrees).toBeGreaterThan(100);
    expect(bandImps).toBe(bandTrees);
    // a street camera next to the west edge, then one in the middle of the map
    for (const [x, z] of [[100, W / 2], [W / 2, W / 2]]) {
      cam.position.set(x, terr.meshHeightAt(x, z) + 40, z);
      tr.update(cam);
      for (const c of edge) {
        for (const m of c.bfar) if (m) expect(m.castShadow).toBe(false);
        for (let k = 0; k < c.near.length; k++) {
          const m = c.near[k];
          if (!m || !c.isNear) continue;
          // without band trees submitted, a near mesh is culled by its map trees' bounds alone
          if (m.count <= c.mapN![k]) {
            expect(m.boundingBox!.min.x).toBeGreaterThanOrEqual(c.box.min.x - 10);
            expect(m.boundingBox!.max.x).toBeLessThanOrEqual(c.box.max.x + 10);
            expect(m.boundingBox!.min.z).toBeGreaterThanOrEqual(c.box.min.z - 10);
            expect(m.boundingBox!.max.z).toBeLessThanOrEqual(c.box.max.z + 10);
          }
        }
      }
      // next to the edge, the west band's far trees are drawn as impostors
      if (x === 100) expect(edge.some((c) => c.bfar.some((m) => m?.visible && m.count > 0))).toBe(true);
    }
    tr.dispose();
  }, 120_000);

  it('low quality (tree LOD distance < 560 m): no outer ring, no edge band, lot twig strip on; a higher quality brings all back', () => {
    const st = createCityState(defaultCityConfig({ size: 64, seed: 11, terrain: 'hills', climate: 'temperate', treeDensity: 0.6 }));
    const q = (lodDistance: number) => ({ lodDistance, density: 1, castShadows: false, maxVariants: 3 });
    const tr = new TreeRenderer(st, new TerrainRenderer(st, 1, false), q(460));
    tr.flush();
    const W = st.size * CELL_SIZE;
    /** trees placed beyond the map edge (edge band: full models) */
    const beyond = () => {
      let n = 0;
      for (const m of tr.group.children as THREE.InstancedMesh[]) {
        if (!m.isInstancedMesh || !m.name.startsWith('trees-') || m.name === 'trees-far' || m.name === 'trees-ring' || m.name === 'trees-warmup') continue;
        const e = m.instanceMatrix.array as Float32Array;
        for (let i = 0; i < m.count; i++) if (Math.max(-e[i * 16 + 12], e[i * 16 + 12] - W, -e[i * 16 + 14], e[i * 16 + 14] - W) > 0) n++;
      }
      return n;
    };
    const ringMeshes = () => tr.group.children.filter((o) => o.name === 'trees-ring').length;
    expect(ringMeshes()).toBe(0);
    expect(tr.ringInstances).toBe(0);
    expect(beyond()).toBe(0);
    // (the building renderer draws the lot models without their winter twig crowns: winterTwigs.ts)
    expect(lotTwigs.strip).toBe(true);
    tr.setQuality(q(850));
    tr.flush();
    expect(tr.ringInstances).toBeGreaterThan(500);
    expect(ringMeshes()).toBeGreaterThan(0);
    expect(beyond()).toBeGreaterThan(0);
    expect(lotTwigs.strip).toBe(false);
    tr.setQuality(q(460));
    tr.flush();
    expect(ringMeshes()).toBe(0);
    expect(tr.ringInstances).toBe(0);
    expect(beyond()).toBe(0);
    expect(lotTwigs.strip).toBe(true);
    tr.dispose();
    setLotTwigStrip(false);
  }, 120_000);
});
