import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BufferGeometry } from 'three';
import { registerAllModels } from '../../src/assets/builders';
import { FACADE_MODELS, MANIFEST_BY_ID } from '../../src/assets/manifest';
import { clearModelCache, getModelGeometry, hasModel } from '../../src/assets/registry';
import { Surf } from '../../src/core/types';
import { buildLodProxy } from '../../src/render/city/buildings/lodProxy';

registerAllModels();

function signature(g: BufferGeometry, roofAbove = -Infinity): string {
  const hash = createHash('sha256'), pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < roofAbove) continue;
    for (const name of ['position', 'color', 'surf']) {
      const a = g.getAttribute(name);
      for (let k = 0; k < a.itemSize; k++) hash.update(`${a.array[i * a.itemSize + k]},`);
    }
  }
  return hash.digest('hex');
}

describe('NEW-01 facade geometry', () => {
  it.each(Object.entries(FACADE_MODELS))('%s adds three distinct roof and colour families', (base, models) => {
    expect(models).toHaveLength(3);
    const silhouettes = new Set<string>(), roofColours = new Set<string>();
    for (const id of models) {
      expect(hasModel(id), id).toBe(true);
      const entry = MANIFEST_BY_ID[id], geometry = getModelGeometry(id, 0);
      const pos = geometry.getAttribute('position'), color = geometry.getAttribute('color');
      const roof: number[] = [], colours = new Set<string>();
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) >= entry.height[0] - 1) {
        roof.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        colours.add(`${color.getX(i)},${color.getY(i)},${color.getZ(i)}`);
      }
      silhouettes.add(createHash('sha256').update(JSON.stringify(roof)).digest('hex'));
      roofColours.add([...colours].sort().join(';'));
      expect(entry.variants).toBe(MANIFEST_BY_ID[base].variants);
      expect(entry.buildVariants).toBe(MANIFEST_BY_ID[base].buildVariants);
      const variants = new Set<string>();
      for (let v = 0; v < entry.buildVariants!; v++) variants.add(signature(getModelGeometry(id, v), entry.height[0] - 1));
      expect(variants.size, `${id} authored palettes / roof details`).toBe(entry.buildVariants);
    }
    expect(silhouettes.size).toBe(3);
    expect(roofColours.size).toBe(3);
  });

  it.each(Object.values(FACADE_MODELS).flat())('%s keeps every variant finite, within its lot, height and 1500-triangle budget', (id) => {
    const entry = MANIFEST_BY_ID[id], errors = vi.spyOn(console, 'error');
    try {
      for (let v = 0; v < entry.variants; v++) {
        const g = getModelGeometry(id, v), pos = g.getAttribute('position'), surf = g.getAttribute('surf');
        expect(pos.count / 3, `${id}#${v}`).toBeLessThanOrEqual(1500);
        expect(pos.count).toBeGreaterThan(30);
        expect(pos.count % 3).toBe(0);
        for (const a of Object.values(g.attributes)) {
          expect(a.count).toBe(pos.count);
          expect(a.array.every(Number.isFinite)).toBe(true);
        }
        const bounds = g.boundingBox!;
        expect(bounds.min.x).toBeGreaterThanOrEqual(-entry.footprint[0] * 8 - 0.5);
        expect(bounds.max.x).toBeLessThanOrEqual(entry.footprint[0] * 8 + 0.5);
        expect(bounds.min.z).toBeGreaterThanOrEqual(-entry.footprint[1] * 8 - 0.5);
        expect(bounds.max.z).toBeLessThanOrEqual(entry.footprint[1] * 8 + 0.5);
        expect(bounds.min.y).toBeGreaterThanOrEqual(-0.01);
        expect(bounds.max.y).toBeGreaterThanOrEqual(entry.height[0]);
        expect(bounds.max.y).toBeLessThanOrEqual(entry.height[1]);
        let windows = 0;
        for (let i = 0; i < surf.count; i++) if ([Surf.WallWindows, Surf.GlassCurtain, Surf.GlassPlain].includes(surf.getX(i))) windows++;
        expect(windows).toBeGreaterThan(0);
      }
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('rebuilds the same geometry after interleaved models and cache resets', () => {
    const ids = Object.values(FACADE_MODELS).flat(), expected = new Map<string, string>();
    for (const id of ids) for (const v of [0, 3, MANIFEST_BY_ID[id].variants - 1]) expected.set(`${id}#${v}`, signature(getModelGeometry(id, v)));
    clearModelCache();
    for (const id of [...ids].reverse()) for (const v of [MANIFEST_BY_ID[id].variants - 1, 3, 0]) {
      expect(signature(getModelGeometry(id, v))).toBe(expected.get(`${id}#${v}`));
    }
  });

  it('keeps office plaza trees visible in distant winter proxies', () => {
    for (const id of FACADE_MODELS.com_office_block) for (let v = 0; v < MANIFEST_BY_ID[id].variants; v++) {
      const g = getModelGeometry(id, v), surf = g.getAttribute('surf');
      let twigs = false;
      for (let i = 0; i < surf.count; i++) if (surf.getX(i) === Surf.Foliage && surf.getY(i) > 4.5) { twigs = true; break; }
      if (!twigs) continue;
      const proxy = buildLodProxy(g)!;
      try {
        expect(proxy, `${id}#${v} distant proxy`).not.toBeNull();
        const s = proxy.getAttribute('surf');
        expect(Array.from({ length: s.count }, (_, i) => s.getX(i)).includes(Surf.Foliage), `${id}#${v} lot trees`).toBe(true);
      } finally {
        proxy?.dispose();
      }
    }
  });
});
