import { describe, expect, it, vi } from 'vitest';
import { registerAllModels } from '../../src/assets/builders';
import { MANIFEST, MANIFEST_BY_ID, manifestByGroup } from '../../src/assets/manifest';
import { getModelGeometry, hasModel } from '../../src/assets/registry';
import { CELL_SIZE } from '../../src/core/constants';
import { Surf } from '../../src/core/types';

const PROJECTS = ['tr_express_metro', 'util_fusion_plant', 'lm_world_expo', 'lm_expo_tower', 'rw_space_center'];
const ARCOLOGIES = ['com_business_arcology', 'res_arcology', 'res_arcology_mixed'];
const EXPANSIONS = ['facility_level_2', 'facility_level_3', 'park_small_level_2', 'park_small_level_3'];
const HONOURS = ['park_eco_plaza', 'lm_firefighters_memorial', 'rw_honour_plaque'];
const STUBS = [...PROJECTS, ...ARCOLOGIES, ...EXPANSIONS, ...HONOURS, 'civ_emergency_operations_center', 'garbage_pile', 'for_lease_sign'];

registerAllModels();

describe('polish asset manifest', () => {
  it('reserves the round 2–3 stub ids without adding unfinished models to catalog groups', () => {
    expect(new Set(MANIFEST.map((e) => e.id)).size).toBe(MANIFEST.length);
    expect(manifestByGroup('placeholder').map((e) => e.id).sort()).toEqual([...STUBS].sort());
    for (const id of STUBS) {
      expect(hasModel(id), id).toBe(true);
      expect(MANIFEST_BY_ID[id].desc, id).toMatch(/^STUB /);
    }
  });

  it('keeps the specified lots and the Small Park footprint through both expansion levels', () => {
    expect(MANIFEST_BY_ID.com_business_arcology.footprint).toEqual([5, 5]);
    expect(MANIFEST_BY_ID.res_arcology.footprint).toEqual([6, 6]);
    for (const id of ['park_small_level_2', 'park_small_level_3']) {
      expect(MANIFEST_BY_ID[id].footprint).toEqual(MANIFEST_BY_ID.park_small.footprint);
    }
  });

  it('provides two variants for arcologies and the garbage props', () => {
    for (const id of [...ARCOLOGIES, 'garbage_pile']) {
      expect(MANIFEST_BY_ID[id].variants, id).toBe(2);
      expect(MANIFEST_BY_ID[id].mirror, id).not.toBe(true);
      expect(getModelGeometry(id, 0).attributes.position.array, id).not.toEqual(getModelGeometry(id, 1).attributes.position.array);
    }
  });

  it.each(STUBS)('%s builds every variant within its lot, height and budget, with neutral labels', (id) => {
    const entry = MANIFEST_BY_ID[id];
    const errors = vi.spyOn(console, 'error');
    try {
      for (let v = 0; v < entry.variants; v++) {
        const geo = getModelGeometry(id, v);
        const pos = geo.getAttribute('position'), normal = geo.getAttribute('normal');
        const color = geo.getAttribute('color'), surf = geo.getAttribute('surf');
        expect(pos.count).toBeGreaterThan(30); // a labelled block, not the registry's fallback box
        expect(pos.count % 3).toBe(0);
        expect(pos.count / 3).toBeLessThanOrEqual(entry.budget!);
        expect(entry.budget).toBeLessThanOrEqual(200);
        for (const attr of [pos, normal, color, surf]) {
          expect(attr.count).toBe(pos.count);
          expect(Array.from(attr.array).every(Number.isFinite)).toBe(true);
        }
        const bb = geo.boundingBox!;
        expect(bb.min.x).toBeGreaterThanOrEqual(-entry.footprint[0] * CELL_SIZE / 2);
        expect(bb.max.x).toBeLessThanOrEqual(entry.footprint[0] * CELL_SIZE / 2);
        expect(bb.min.z).toBeGreaterThanOrEqual(-entry.footprint[1] * CELL_SIZE / 2);
        expect(bb.max.z).toBeLessThanOrEqual(entry.footprint[1] * CELL_SIZE / 2);
        expect(bb.min.y).toBe(0);
        expect(bb.max.y).toBeGreaterThanOrEqual(entry.height[0]);
        expect(bb.max.y).toBeLessThanOrEqual(entry.height[1] + 0.03);
        let frontLabel = 0, roofLabel = 0;
        for (let i = 0; i < pos.count; i++) {
          expect(color.getX(i)).toBe(color.getY(i));
          expect(color.getY(i)).toBe(color.getZ(i));
          expect(surf.getX(i)).toBe(Surf.Plain);
          if (color.getX(i) < 0.1) {
            if (normal.getZ(i) > 0.99) frontLabel++;
            if (normal.getY(i) > 0.99) roofLabel++;
          }
        }
        expect(frontLabel).toBeGreaterThan(0);
        expect(roofLabel).toBeGreaterThan(0);
      }
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
