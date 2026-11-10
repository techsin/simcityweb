import { describe, expect, it, vi } from 'vitest';
import { registerAllModels } from '../../src/assets/builders';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { getModelGeometry, hasModel } from '../../src/assets/registry';
import { CELL_SIZE } from '../../src/core/constants';
import { CATALOG, capReliefOf, getDef } from '../../src/sim/catalog';

const HONOURS = [
  'clean_air_metropolis', 'transit_capital', 'scholar_city', 'healthy_city', 'safe_city', 'tourist_capital',
  'full_employment', 'green_belt', 'balanced_books', 'quiet_city', 'megacity', 'megalopolis',
];
const MODELS = ['rw_honour_completion_plaque', 'rw_eco_plaza', 'rw_firefighters_memorial'];

registerAllModels();

describe('honour decorations', () => {
  it('gives every honour a distinct free, unique 1x1 plaque with a small local civic-pride benefit', () => {
    const plaques = HONOURS.map((honour) => getDef(`rw_honour_${honour}_plaque`)!);
    expect(new Set(plaques.map((d) => d.id)).size).toBe(12);
    for (let i = 0; i < plaques.length; i++) {
      const d = plaques[i];
      expect(d.model).toBe('rw_honour_completion_plaque');
      expect(d.footprint).toEqual([1, 1]);
      expect(d.requires).toBe(`honour_${HONOURS[i]}`);
      expect(d.name).toMatch(/ Plaque$/);
      expect(d.unique).toBe(true);
      expect(d.cost).toBe(0);
      expect(d.upkeep).toBe(0);
      expect(d.landValue).toEqual({ amount: 0.01, radius: 1 });
      for (const effect of ['jobs', 'income', 'coverage', 'prestige', 'campus', 'pollution', 'powerUse', 'waterUse'] as const) {
        expect(d[effect], `${d.id}: ${effect}`).toBeUndefined();
      }
      expect(capReliefOf(d.id)).toBeUndefined();
    }
  });

  it('keeps the optional Eco Plaza and memorial free, unique, and limited to a small local benefit', () => {
    for (const [id, honour] of [['rw_eco_plaza', 'clean_air_metropolis'], ['rw_firefighters_memorial', 'safe_city']]) {
      const d = getDef(id)!;
      expect(d.requires).toBe(`honour_${honour}`);
      expect(d.unique).toBe(true);
      expect(d.cost).toBe(0);
      expect(d.upkeep).toBe(0);
      expect(d.jobs).toBeUndefined();
      expect(d.income).toBeUndefined();
      expect(d.coverage).toBeUndefined();
      expect(d.landValue).toEqual({ amount: 0.05, radius: 4 });
      expect(capReliefOf(id)).toBeUndefined();
    }
  });

  it.each(MODELS)('%s has a finished model and catalog correspondence within its lot and budget', (id) => {
    const entry = MANIFEST_BY_ID[id];
    expect(entry.group).toBe('reward');
    expect(entry.pendingCatalog).toBeUndefined();
    expect(entry.desc).not.toMatch(/^STUB /);
    expect(CATALOG.some((d) => d.model === id)).toBe(true);
    expect(hasModel(id)).toBe(true);
    const errors = vi.spyOn(console, 'error');
    try {
      const geo = getModelGeometry(id);
      const position = geo.getAttribute('position');
      expect(position.count / 3).toBeGreaterThan(30);
      expect(position.count / 3).toBeLessThanOrEqual(3000);
      for (const attribute of Object.values(geo.attributes)) {
        expect(attribute.count).toBe(position.count);
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      }
      const bounds = geo.boundingBox!;
      expect(bounds.min.x).toBeGreaterThanOrEqual(-entry.footprint[0] * CELL_SIZE / 2);
      expect(bounds.max.x).toBeLessThanOrEqual(entry.footprint[0] * CELL_SIZE / 2);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-entry.footprint[1] * CELL_SIZE / 2);
      expect(bounds.max.z).toBeLessThanOrEqual(entry.footprint[1] * CELL_SIZE / 2);
      expect(bounds.min.y).toBe(0);
      expect(bounds.max.y).toBeGreaterThanOrEqual(entry.height[0]);
      expect(bounds.max.y).toBeLessThanOrEqual(entry.height[1]);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
