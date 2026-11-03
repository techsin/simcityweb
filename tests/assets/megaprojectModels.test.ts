/** LG-03 art checks are CPU geometry checks; the lead reviews actual day/night/winter GPU renders. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { ModelBuilder } from '../../src/assets/ModelBuilder';
import { models } from '../../src/assets/builders/megaprojects';
import { registerAllModels } from '../../src/assets/builders';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { getModelGeometry, hasModel } from '../../src/assets/registry';
import { setFoliageSeason, sharedUniforms } from '../../src/assets/materials';
import { setTreeSeason, treeSeason } from '../../src/assets/builders/nat_season';
import { hashString, RNG } from '../../src/core/rng';
import { Surf } from '../../src/core/types';
import { makeLodProxy } from '../../src/render/city/buildings/lodProxy';

const IDS = ['tr_express_metro', 'util_fusion_plant', 'lm_world_expo', 'lm_expo_tower', 'rw_space_center'];
registerAllModels();

function build(id: string, variant: number, seed: number): BufferGeometry {
  const b = new ModelBuilder();
  models[id](b, variant, new RNG(seed), MANIFEST_BY_ID[id]);
  return b.build();
}

function signature(g: BufferGeometry): string {
  const hash = createHash('sha256');
  for (const name of ['position', 'normal', 'color', 'surf']) {
    const a = g.getAttribute(name);
    hash.update(new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength));
  }
  return hash.digest('hex');
}

describe('mega-project model art', () => {
  it('promotes finished art to building groups and keeps only round-3 catalog dependencies pending', () => {
    expect(IDS.map((id) => MANIFEST_BY_ID[id].group)).toEqual(['transport', 'utility', 'landmark', 'landmark', 'reward']);
    for (const id of IDS) {
      expect(hasModel(id), id).toBe(true);
      expect(MANIFEST_BY_ID[id].desc, id).not.toMatch(/^STUB /);
      expect(MANIFEST_BY_ID[id].variants, `${id}: unique showpiece`).toBe(1);
      expect(MANIFEST_BY_ID[id].pendingCatalog, id).toBe(['lm_expo_tower', 'rw_space_center'].includes(id) ? 'LG-03' : undefined);
    }
  });

  it.each(IDS)('%s builds every variant inside the lot and triangle budget without fallback geometry', (id) => {
    const entry = MANIFEST_BY_ID[id];
    const budget = entry.budget ?? (entry.group === 'landmark' ? 8000 : 3000);
    expect(budget).toBeLessThanOrEqual(8000);
    for (let v = 0; v < entry.variants; v++) {
      const seed = hashString(`${id}#${v}`), g = build(id, v, seed);
      try {
        expect(signature(getModelGeometry(id, v)), `${id}: registry uses production builder`).toBe(signature(g));
        const pos = g.getAttribute('position');
        expect(pos.count / 3).toBeGreaterThan(200);
        expect(pos.count / 3).toBeLessThanOrEqual(budget);
        for (const name of ['position', 'normal', 'color', 'surf']) {
          const attr = g.getAttribute(name);
          expect(attr.count, name).toBe(pos.count);
          expect(Array.from(attr.array).every(Number.isFinite), name).toBe(true);
        }
        const bounds = g.boundingBox!;
        expect(bounds.min.x).toBeGreaterThanOrEqual(-entry.footprint[0] * 8);
        expect(bounds.max.x).toBeLessThanOrEqual(entry.footprint[0] * 8);
        expect(bounds.min.z).toBeGreaterThanOrEqual(-entry.footprint[1] * 8);
        expect(bounds.max.z).toBeLessThanOrEqual(entry.footprint[1] * 8);
        expect(bounds.min.y).toBe(0);
        expect(bounds.max.y).toBeGreaterThanOrEqual(entry.height[0] - 0.001);
        expect(bounds.max.y).toBeLessThanOrEqual(entry.height[1] + 0.001);
        // No collapsed structural faces; the shared foliage kit has deliberately collapsed cone-tip triangles.
        const surf = g.getAttribute('surf');
        for (let i = 0; i < pos.count; i += 3) {
          if (surf.getX(i) === Surf.Foliage) continue;
          const ax = pos.getX(i + 1) - pos.getX(i), ay = pos.getY(i + 1) - pos.getY(i), az = pos.getZ(i + 1) - pos.getZ(i);
          const bx = pos.getX(i + 2) - pos.getX(i), by = pos.getY(i + 2) - pos.getY(i), bz = pos.getZ(i + 2) - pos.getZ(i);
          expect(Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx)).toBeGreaterThan(1e-8);
        }
      } finally {
        g.dispose();
      }
    }
  });

  it.each(IDS)('%s carries night lighting and winter foliage metadata with deterministic geometry in every season', (id) => {
    const oldMonth = treeSeason.month, oldClimate = treeSeason.climate;
    const oldNight = sharedUniforms.uNight.value;
    const expected = build(id, 0, 7);
    try {
      const surf = expected.getAttribute('surf');
      const types = Array.from({ length: surf.count }, (_, i) => surf.getX(i));
      expect(types).toContain(Surf.Foliage);
      expect(types.some((t) => t === Surf.GlassPlain || t === Surf.WallWindows)).toBe(true);
      expect(types).toContain(Surf.Emissive);
      const seasonal = [[5, 0], [5, 1], [0, 0]];
      for (const [month, night] of seasonal) {
        setTreeSeason(month, 'temperate');
        setFoliageSeason(month, 'temperate');
        sharedUniforms.uNight.value = night;
        const next = build(id, 0, 7);
        try {
          expect(signature(next)).toBe(signature(expected));
        } finally {
          next.dispose();
        }
      }
      expect(sharedUniforms.uSeason.value.y).toBeGreaterThan(0.9);
      expect(sharedUniforms.uFoliageDry.value).toBe(0.7);
    } finally {
      expected.dispose();
      setTreeSeason(oldMonth, oldClimate);
      setFoliageSeason(oldMonth, oldClimate);
      sharedUniforms.uNight.value = oldNight;
    }
  });

  it.each(IDS)('%s keeps a cheap, deterministic distant model with night windows', (id) => {
    const full = getModelGeometry(id), lod = makeLodProxy(`${id}#0`, full);
    expect(lod).not.toBeNull();
    if (!lod) return;
    const repeat = makeLodProxy(`${id}#0`, full);
    try {
      const count = lod.getAttribute('position').count;
      expect(count / 3).toBeLessThanOrEqual(200);
      expect(count).toBeLessThanOrEqual(full.getAttribute('position').count / 2);
      for (const name of ['position', 'normal', 'color', 'surf']) {
        const attr = lod.getAttribute(name);
        expect(attr.count).toBe(count);
        expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
      }
      const surf = lod.getAttribute('surf');
      expect(Array.from({ length: surf.count }, (_, i) => surf.getX(i)).some((type) => type === Surf.GlassPlain || type === Surf.WallWindows || type === Surf.GlassCurtain)).toBe(true);
      expect(repeat).not.toBeNull();
      expect(signature(lod)).toBe(signature(repeat!));
    } finally {
      lod.dispose();
      repeat?.dispose();
    }
  });

  it('lists every project in gallery review links and initializes explicit seasonal queries before rendering', () => {
    const html = readFileSync(new URL('../../gallery.html', import.meta.url), 'utf8');
    for (const id of IDS) expect(html).toContain(id);
    expect(html).toContain('night=1');
    expect(html).toContain('month=0&amp;climate=temperate');
    expect(html.indexOf('setTreeSeason(month, climate)')).toBeLessThan(html.indexOf("await import('/src/gallery/main.ts')"));
  });
});
