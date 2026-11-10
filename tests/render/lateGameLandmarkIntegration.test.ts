/** LG-02: the gallery and game use the registered art, including the winter crowns of the lot trees. */
import { describe, expect, it, vi } from 'vitest';
import { registerAllModels } from '../../src/assets/builders';
import { MANIFEST_BY_ID, manifestByGroup } from '../../src/assets/manifest';
import { clearModelCache, getModelGeometry, hasModel } from '../../src/assets/registry';
import { Surf } from '../../src/core/types';

const IDS = [
  'lm_central_library', 'lm_grand_central', 'lm_stock_exchange', 'lm_botanical_dome',
  'lm_world_trade_center', 'lm_millennium_tower', 'lm_metropolis_crown',
];
const DECIDUOUS = new Set(['lm_central_library', 'lm_stock_exchange', 'lm_world_trade_center', 'lm_millennium_tower']);

registerAllModels();

describe('late-game landmark gallery integration', () => {
  it('offers all seven finished models and both variants through the landmark gallery group', () => {
    const gallery = new Set(manifestByGroup('landmark').map((entry) => entry.id));
    for (const id of IDS) {
      expect(gallery.has(id), id).toBe(true);
      expect(MANIFEST_BY_ID[id].pendingCatalog, id).toBeUndefined();
      expect(MANIFEST_BY_ID[id].variants, id).toBeGreaterThanOrEqual(2);
      expect(hasModel(id), id).toBe(true);
    }
  });

  it.each(IDS)('%s builds every registered variant with night lighting and complete winter crowns', (id) => {
    const error = vi.spyOn(console, 'error');
    clearModelCache();
    try {
      for (let variant = 0; variant < MANIFEST_BY_ID[id].variants; variant++) {
        const geometry = getModelGeometry(id, variant), surf = geometry.getAttribute('surf');
        const label = `${id}#${variant}`;
        expect(geometry.name, label).toBe(label);
        expect(geometry.getAttribute('position').count / 3, label).toBeGreaterThan(12);
        const crowns = new Set<number>(), twigs = new Set<number>();
        let night = 0;
        for (let i = 0; i < surf.count; i += 3) {
          const type = surf.getX(i), pattern = surf.getY(i), floor = surf.getZ(i);
          if (type === Surf.WallWindows || type === Surf.GlassCurtain ||
            (type === Surf.GlassPlain && (pattern === 2 || pattern === 3)) ||
            (type === Surf.Emissive && (pattern === 10 || pattern === 11))) night++;
          if (type !== Surf.Foliage) continue;
          if ((pattern === 1 || pattern === 2) && floor >= 1) crowns.add(floor);
          if (pattern === 5) twigs.add(floor);
        }
        expect(night, `${label} night-lit surfaces`).toBeGreaterThan(0);
        if (DECIDUOUS.has(id)) expect(crowns.size, `${label} seasonal lot trees`).toBeGreaterThan(0);
        expect(twigs, `${label} every seasonal crown has matching winter twigs`).toEqual(crowns);
      }
      expect(error).not.toHaveBeenCalled();
    } finally {
      clearModelCache();
      error.mockRestore();
    }
  });
});
