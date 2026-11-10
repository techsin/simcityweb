import { describe, expect, it } from 'vitest';
import { FACADE_MODELS, MANIFEST_BY_ID } from '../../src/assets/manifest';
import { type Building, type CityState } from '../../src/sim/CityState';
import { DEV_WEALTH, facadeDefs, getDef, growablesFor, growablesForZone, growthDefId } from '../../src/sim/catalog';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { householdForm, updateDemographics } from '../../src/sim/economy/demographics';
import { spreadVariant } from '../../src/sim/economy/growth';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { makeCity } from './helpers';

const FAMILIES = [['res_rowhouses.r2.3', 12, 6], ['com_boutique.cs3.1', 10, 5]] as const;

function building(st: CityState, def: string, x: number, z: number, variant: number): Building {
  const d = getDef(def)!;
  return {
    id: st.nextBuildingId++, def, x, z, w: d.footprint[0], d: d.footprint[1], rot: 0, variant,
    pop: 0, jobs: 0, capacity: d.capacity!, wealth: DEV_WEALTH[d.devType!], built: 1, age: 400,
    flags: 0, baseY: 5, health: 0.8, unhappy: 0,
  };
}

describe('NEW-01 rowhouse and boutique continuity', () => {
  it.each(FAMILIES)('%s preserves its original variant contract and simulation stats', (id, count, builds) => {
    const base = getDef(id)!, entry = MANIFEST_BY_ID[base.model], family = facadeDefs(id);
    expect(entry.variants).toBe(count);
    expect(entry.buildVariants).toBe(builds);
    expect(entry.mirror).toBe(true);
    expect(family).toHaveLength(4);
    expect(family[0]).toBe(base);
    expect(family.slice(1).map((d) => d.model)).toEqual(FACADE_MODELS[base.model]);
    for (const d of family) {
      // (round 3: a facade may carry a display name of its own; every other field is the original's)
      expect({ ...d, id: base.id, model: base.model, name: base.name, household: base.household })
        .toEqual({ ...base, household: base.household });
      expect(householdForm(d)).toBe(householdForm(base));
      expect(growthDefId(d.id)).toBe(id);
      expect(MANIFEST_BY_ID[d.model].variants).toBe(count);
      expect(MANIFEST_BY_ID[d.model].buildVariants).toBe(builds);
      expect(MANIFEST_BY_ID[d.model].mirror).toBe(true);
      expect(MANIFEST_BY_ID[d.model].footprint).toEqual(base.footprint);
      expect(growablesFor(d.devType!).includes(d)).toBe(d === base);
      for (const z of d.zones!) expect(growablesForZone(z).includes(d)).toBe(d === base);
    }
  });

  it.each(FAMILIES)('%s keeps every original model and variant index through save/load', (id, count) => {
    const { st, sim } = makeCity({ size: 64 }, []), base = getDef(id)!;
    for (let variant = 0; variant < count; variant++) {
      const x = 4 + variant % 6 * 4, z = 4 + Math.floor(variant / 6) * 4;
      placeBuilding(sim, building(st, id, x, z, variant));
    }
    const records = [...st.buildings.values()].map((b) => ({ ...b }));
    const loaded = deserializeCity(serializeCity(st, { copy: true }));
    expect([...loaded.buildings.values()]).toEqual(records);
    for (const b of loaded.buildings.values()) {
      expect(b.def).toBe(id);
      expect(getDef(b.def)?.model).toBe(base.model);
      expect(growthDefId(b.def)).toBe(id);
    }
    expect(loaded.systemData).toEqual(st.systemData);
  });

  it.each(FAMILIES)('%s keeps the legacy free-variant and saturated same-def decisions with alias neighbors', (id, count) => {
    const base = getDef(id)!, family = facadeDefs(id);
    for (const saturated of [false, true]) {
      const original = makeCity({ size: 32 }, []), varied = makeCity({ size: 32 }, []);
      const placed = saturated ? count : count - 1;
      for (let variant = 0; variant < placed; variant++) {
        const k = variant - 1;
        // Variant 0 is the unique farthest twin (six cells); the remaining twins are at most five away.
        const x = variant === 0 ? 10 : 11 + k % 4 * 3;
        const z = variant === 0 ? 10 : 12 + Math.floor(k / 4) * 3;
        placeBuilding(original.sim, building(original.st, id, x, z, variant));
        placeBuilding(varied.sim, building(varied.st, family[1 + variant % 3].id, x, z, variant));
      }
      for (let start = 0; start < count; start++) {
        const expected = saturated ? 0 : count - 1;
        expect(spreadVariant(original.st, id, 16, 16, base.footprint[0], base.footprint[1], start, count)).toBe(expected);
        for (const d of family) {
          expect(spreadVariant(varied.st, d.id, 16, 16, base.footprint[0], base.footprint[1], start, count)).toBe(expected);
        }
      }
    }
  });

  it('rowhouse facades preserve the house cohort profile, workforce and education across building ages', () => {
    const { st, sim } = makeCity({ size: 32 }, []), family = facadeDefs(FAMILIES[0][0]), base = family[0];
    const b = building(st, base.id, 10, 10, 4), before = sim.rng.state;
    b.pop = b.capacity * 0.75;
    expect(householdForm(base)).toBe('house');
    for (const age of [0, 20 * 360, 60 * 360]) {
      const original = { ...b, age };
      updateDemographics(st, original, base, 10 * st.size + 10, 30);
      for (const d of family.slice(1)) {
        const varied = { ...b, age, def: d.id };
        updateDemographics(st, varied, d, 10 * st.size + 10, 30);
        expect({ ...varied, def: base.id }).toEqual(original);
      }
    }
    expect(sim.rng.state).toBe(before);
  });
});
