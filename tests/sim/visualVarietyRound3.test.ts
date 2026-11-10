/** NEW-01 QA round 3: the facade choice looks at the model on the next lots in any variant; facade names. */
import { describe, expect, it } from 'vitest';
import { FACADE_MODELS, MANIFEST_BY_ID } from '../../src/assets/manifest';
import { type Building, type CityState } from '../../src/sim/CityState';
import { CATALOG, DEV_WEALTH, facadeDefs, getDef } from '../../src/sim/catalog';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { positionVariant, spreadFacade, spreadVariant } from '../../src/sim/economy/growth';
import { makeCity } from './helpers';

const WALKUP = 'res_walkup.r1.3';
const BASES = [WALKUP, 'res_walkup.r1.4', 'com_corner_store.cs1.1', 'com_shops_apartments.cs1.3',
  'com_office_block.co2.4', 'com_office_block.co3.5', 'res_rowhouses.r2.3', 'com_boutique.cs3.1'];

function building(st: CityState, def: string, x: number, z: number, variant: number): Building {
  const d = getDef(def)!;
  return {
    id: st.nextBuildingId++, def, x, z, w: d.footprint[0], d: d.footprint[1], rot: 0, variant,
    pop: 0, jobs: 0, capacity: d.capacity!, wealth: DEV_WEALTH[d.devType!], built: 1, age: 400,
    flags: 0, baseY: 5, health: 0.8, unhappy: 0,
  };
}

describe('NEW-01 round 3 facade choice', () => {
  it('prefers the facade whose nearest building in any variant is farthest, whatever the building id', () => {
    const { st, sim } = makeCity({ size: 32 }, []), family = facadeDefs(WALKUP), before = sim.rng.state;
    // (lot-edge distances from (12, 12): 1, 2, 4 and 3; none shares the new lot's variant 0 or its mirrored twin 6)
    placeBuilding(sim, building(st, family[0].id, 11, 12, 1));
    placeBuilding(sim, building(st, family[1].id, 12, 10, 2));
    placeBuilding(sim, building(st, family[2].id, 16, 12, 3));
    placeBuilding(sim, building(st, family[3].id, 12, 15, 7));
    // (the hashed start alone gives all four facades over these ids: the round-2 rule)
    const starts = new Set<string>();
    const empty = makeCity({ size: 32 }, []).st;
    for (let id = 1; id <= 24; id++) {
      expect(spreadFacade(st, WALKUP, 12, 12, 1, 1, 0, id)).toBe(family[2]);
      starts.add(spreadFacade(empty, WALKUP, 12, 12, 1, 1, 0, id).id);
    }
    expect(starts.size).toBe(4);
    expect(sim.rng.state).toBe(before);
  });

  it('breaks a tie on that distance by the same-looking variant: the variant itself or its mirrored twin', () => {
    const { st, sim } = makeCity({ size: 32 }, []), family = facadeDefs(WALKUP);
    expect(MANIFEST_BY_ID[family[1].model].buildVariants).toBe(6);
    placeBuilding(sim, building(st, family[0].id, 11, 12, 1));
    placeBuilding(sim, building(st, family[3].id, 13, 12, 2));
    placeBuilding(sim, building(st, family[1].id, 12, 9, 6)); // three cells away, the mirrored twin of variant 0
    placeBuilding(sim, building(st, family[2].id, 12, 15, 3)); // three cells away, the mirrored twin of variant 9
    for (let id = 1; id <= 24; id++) {
      expect(spreadFacade(st, WALKUP, 12, 12, 1, 1, 0, id)).toBe(family[2]);
      expect(spreadFacade(st, WALKUP, 12, 12, 1, 1, 9, id)).toBe(family[1]);
      // (neither twin stands near for variant 4: the tie goes to the hashed order, so both facades appear)
      expect([family[1], family[2]]).toContain(spreadFacade(st, WALKUP, 12, 12, 1, 1, 4, id));
    }
    expect(new Set(Array.from({ length: 24 }, (_, i) => spreadFacade(st, WALKUP, 12, 12, 1, 1, 4, i + 1).id)).size).toBe(2);
  });

  it('keeps the twin test first: a facade standing within reach with the same variant loses to nearer facades', () => {
    const { st, sim } = makeCity({ size: 32 }, []), family = facadeDefs(WALKUP);
    placeBuilding(sim, building(st, family[0].id, 18, 12, 0)); // six cells away, the farthest facade, but a twin
    placeBuilding(sim, building(st, family[1].id, 11, 12, 1));
    placeBuilding(sim, building(st, family[2].id, 12, 10, 2));
    placeBuilding(sim, building(st, family[3].id, 12, 15, 3));
    for (let id = 1; id <= 24; id++) expect(spreadFacade(st, WALKUP, 12, 12, 1, 1, 0, id)).toBe(family[3]);
    // one cell farther the twin is out of reach, and its model is the farthest again
    for (let id = 1; id <= 24; id++) expect(spreadFacade(st, WALKUP, 11, 13, 1, 1, 0, id)).toBe(family[0]);
  });

  it.each(BASES)('%s: a street grown lot by lot never repeats a model within four lots, whatever the variants', (id) => {
    const { st, sim } = makeCity({ size: 96 }, []), before = sim.rng.state;
    const d = getDef(id)!, [w, depth] = d.footprint, variants = MANIFEST_BY_ID[d.model].variants, models: string[] = [];
    for (let x = 4; x + w <= 92; x += w) {
      // (as growth does: the variant first, from the family's neighbours, then the facade)
      const variant = spreadVariant(st, id, x, 10, w, depth, positionVariant(x, 10, variants), variants);
      const def = spreadFacade(st, id, x, 10, w, depth, variant, st.nextBuildingId);
      placeBuilding(sim, building(st, def.id, x, 10, variant));
      models.push(def.model);
    }
    expect(models.length).toBeGreaterThanOrEqual(40);
    expect(new Set(models).size).toBe(4);
    for (let k = 3; k < models.length; k++) expect(new Set(models.slice(k - 3, k + 1)).size, `lots ${k - 3}-${k}: ${models.slice(k - 3, k + 1)}`).toBe(4);
    expect(sim.rng.state).toBe(before);
  });

  it('two rows back to back and a row across the street share no model on touching lots', () => {
    const { st, sim } = makeCity({ size: 64 }, []);
    const id = 'res_rowhouses.r2.3', d = getDef(id)!, [w, depth] = d.footprint, variants = MANIFEST_BY_ID[d.model].variants;
    expect([w, depth]).toEqual([2, 1]);
    // (rows at z = 10 and 11 touch back to back; the row at z = 13 stands across a one-cell street from z = 11)
    const lots: Building[] = [];
    for (const z of [10, 11, 13]) for (let x = 4; x + w <= 44; x += w) {
      const variant = spreadVariant(st, id, x, z, w, depth, positionVariant(x, z, variants), variants);
      const b = building(st, spreadFacade(st, id, x, z, w, depth, variant, st.nextBuildingId).id, x, z, variant);
      placeBuilding(sim, b);
      lots.push(b);
    }
    let touching = 0, same = 0;
    for (const a of lots) for (const b of lots) {
      if (a.id >= b.id) continue;
      const dx = Math.max(0, b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1)), dz = Math.max(0, b.z - (a.z + a.d - 1), a.z - (b.z + b.d - 1));
      if (Math.max(dx, dz) > 1) continue;
      touching++;
      if (getDef(a.def)!.model === getDef(b.def)!.model) same++;
    }
    expect(touching).toBeGreaterThan(80);
    // (a lot with two neighbours along its row and three behind touches five lots and has four facades to choose from)
    expect(same / touching).toBeLessThan(0.1);
    // along each row: never three of a model in a row
    for (const z of [10, 11, 13]) {
      const row = lots.filter((b) => b.z === z).map((b) => getDef(b.def)!.model);
      for (let k = 2; k < row.length; k++) expect(new Set(row.slice(k - 2, k + 1)).size, `z ${z} lots ${k - 2}-${k}`).toBeGreaterThan(1);
    }
  });
});

describe('NEW-01 round 3 facade names', () => {
  it('names the rowhouse facades after their own look and keeps every other facade under its original name', () => {
    const names = Object.fromEntries(CATALOG.filter((d) => d.category === 'growable').map((d) => [d.model, d.name]));
    expect(names.res_rowhouses).toBe('Brownstones');
    expect(names.res_rowhouses_hip).toBe('Terraced Houses');
    expect(names.res_rowhouses_gables).toBe('Gabled Rowhouses');
    expect(names.res_rowhouses_mansard).toBe('Mansard Rowhouses');
    for (const [base, models] of Object.entries(FACADE_MODELS)) {
      for (const model of models) {
        expect(names[model], model).toBeTruthy();
        expect(names[model] === names[base], model).toBe(base !== 'res_rowhouses');
      }
    }
  });

  it('changes the name only: every other field of a facade def is the original def\'s', () => {
    for (const base of CATALOG.filter((d) => facadeDefs(d.id)[0] === d)) {
      const family = facadeDefs(base.id);
      expect(family).toHaveLength(4);
      for (const d of family.slice(1)) {
        // (the walk-up facades also state their apartment household form, as before)
        expect(Object.keys(d).filter((k) => !(k in base)).every((k) => k === 'household')).toBe(true);
        for (const k of Object.keys(base) as (keyof typeof base)[]) {
          if (k === 'id' || k === 'model' || k === 'name' || k === 'household') continue;
          expect(d[k], `${d.id}.${k}`).toEqual(base[k]);
        }
        expect(d.description).toBe(base.description);
      }
    }
  });
});
