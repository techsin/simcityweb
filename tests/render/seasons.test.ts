/**
 * Seasons (pure JS, no WebGL context):
 *  - nature models carry their Foliage patterns (3 variant-seasonal deciduous, 4 evergreen, 1 / 2 shader-seasonal
 *    shrubs), never the automatic pattern 0; see-through bare crowns report an open fraction (darker, thinner impostors)
 *  - park trees: cherries blossom (2), broadleaves seasonal (1), conifers / palms evergreen (4), layouts unchanged
 *  - setFoliageSeason: winter / spring strengths only in seasonal climates, tropics flower all year
 *  - TreeRenderer: the map's edge forests continue past the edge (edge band) and the outer ring gets impostors,
 *    deterministically; a season / density / map-cell change refills the ring without regenerating it (only a terrain
 *    edit on the map border regenerates that side), and the generation runs in small slices
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { getModelGeometry, registeredModelIds } from '../../src/assets/registry';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { Surf } from '../../src/core/types';
import { setFoliageSeason, sharedUniforms } from '../../src/assets/materials';
import { getImpostorGeometries, natureStats } from '../../src/render/world/fallbackTrees';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { TerrainRenderer } from '../../src/render/world/TerrainRenderer';
import { TreeRenderer } from '../../src/render/world/TreeRenderer';
import { CELL_SIZE } from '../../src/core/constants';

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

  it('park trees: cherries blossom, broadleaves seasonal, conifers and palms evergreen', () => {
    const tot = new Map<number, number>();
    for (const id of registeredModelIds()) {
      if (MANIFEST_BY_ID[id]?.group !== 'park') continue;
      for (const [p, a] of foliagePatterns(getModelGeometry(id, 0))) tot.set(p, (tot.get(p) ?? 0) + a);
    }
    for (const p of [1, 2, 4]) expect(tot.get(p) ?? 0, `pattern ${p}`).toBeGreaterThan(10);
  }, 120_000);

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

  it('generation and refills run in small slices (one block row / batch per step at a zero budget)', () => {
    const { st, tr } = make(128);
    const n0 = tr.ringInstances;
    tr.reset(st);
    let steps = 0;
    // (chunk rebuilds after the reset are separate: flush them, then only the ring is left)
    tr.flush(false);
    while (steps < 100000) {
      const before = tr.ringGenerations;
      tr.ringStep(0);
      steps++;
      expect(tr.ringGenerations - before).toBeLessThanOrEqual(1);
      if (tr.ringGenerations >= 16) break;
    }
    // 128-cell map: a sector spans 52-66 block rows
    expect(steps).toBeGreaterThan(8 * 40);
    tr.flush();
    expect(tr.ringInstances).toBe(n0);
    tr.dispose();
  }, 120_000);
});
