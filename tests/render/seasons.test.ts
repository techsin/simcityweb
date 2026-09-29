/**
 * Seasons (pure JS, no WebGL context):
 *  - nature models carry their Foliage patterns (3 variant-seasonal deciduous, 4 evergreen, 1 / 2 shader-seasonal
 *    shrubs), never the automatic pattern 0; see-through bare crowns report an open fraction (darker, thinner impostors)
 *  - park trees: cherries blossom (2), broadleaves seasonal (1), conifers / palms evergreen (4), layouts unchanged
 *  - setFoliageSeason: winter / spring strengths only in seasonal climates, tropics flower all year
 *  - TreeRenderer: the map's edge forests continue past the edge (edge band) and the outer ring gets impostors,
 *    deterministically; a season change refills the ring without regenerating it
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { getModelGeometry, registeredModelIds } from '../../src/assets/registry';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { Surf } from '../../src/core/types';
import { setFoliageSeason, sharedUniforms } from '../../src/assets/materials';
import { natureStats } from '../../src/render/world/fallbackTrees';
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
  it('edge forests continue past the map edge and the landscape ring gets impostors, deterministically', () => {
    const make = () => {
      const st = createCityState(defaultCityConfig({ size: 64, seed: 11, terrain: 'hills', climate: 'temperate', treeDensity: 0.6 }));
      const tr = new TreeRenderer(st, new TerrainRenderer(st, 1, false), { lodDistance: 850, density: 1, castShadows: false, maxVariants: 3 });
      tr.flush();
      return { st, tr };
    };
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
    // deterministic
    expect(make().tr.ringInstances).toBe(tr.ringInstances);
    // a season change refills the ring (same trees, new kinds / colours)
    const n0 = tr.ringInstances;
    tr.setMonth(9);
    tr.flush();
    expect(tr.ringInstances).toBe(n0);
    tr.dispose();
  }, 120_000);
});
