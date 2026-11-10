import { describe, expect, it, vi } from 'vitest';
import * as catalog from '../../src/sim/catalog';
import { FACADE_MODELS, MANIFEST_BY_ID } from '../../src/assets/manifest';
import { type Building, type CityState } from '../../src/sim/CityState';
import { DevType, Zone, type Difficulty } from '../../src/core/types';
import { spreadFacade, spreadVariant } from '../../src/sim/economy/growth';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { VARIANT_SPREAD } from '../../src/sim/economy/tuning';
import { householdForm } from '../../src/sim/economy/demographics';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { Simulation } from '../../src/sim/Simulation';
import { economySystems } from '../../src/sim/systems/economy';
import { makeCity, road } from './helpers';

const BASES = ['res_walkup.r1.3', 'res_walkup.r1.4', 'com_corner_store.cs1.1',
  'com_shops_apartments.cs1.3', 'com_office_block.co2.4', 'com_office_block.co3.5',
  'res_rowhouses.r2.3', 'com_boutique.cs3.1'];

function building(st: CityState, def: string, x: number, z: number, variant = 0): Building {
  const d = catalog.getDef(def)!;
  return {
    id: st.nextBuildingId++, def, x, z, w: d.footprint[0], d: d.footprint[1], rot: 0, variant,
    pop: 0, jobs: 0, capacity: d.capacity!, wealth: catalog.DEV_WEALTH[d.devType!], built: 1, age: 400,
    flags: 0, baseY: 5, health: 0.8, unhappy: 0,
  };
}

describe('NEW-01 facade catalog', () => {
  it.each(BASES)('%s has three stat-identical facade defs outside the original weighted pools', (id) => {
    const base = catalog.getDef(id)!, family = catalog.facadeDefs(id);
    expect(family).toHaveLength(4);
    expect(family[0]).toBe(base);
    expect(family.slice(1).map((d) => d.model)).toEqual(FACADE_MODELS[base.model]);
    for (const d of family) {
      expect({ ...d, id: base.id, model: base.model, household: base.household })
        .toEqual({ ...base, household: base.household });
      expect(householdForm(d)).toBe(householdForm(base));
      expect(catalog.growthDefId(d.id)).toBe(id);
      expect(catalog.getDef(d.id)).toBe(d);
      expect(catalog.facadeDefs(d.id)).toBe(family);
      expect(MANIFEST_BY_ID[d.model].variants).toBe(MANIFEST_BY_ID[base.model].variants);
      expect(MANIFEST_BY_ID[d.model].footprint).toEqual(base.footprint);
      expect(catalog.growablesFor(d.devType!).includes(d)).toBe(d === base);
      for (const z of d.zones!) expect(catalog.growablesForZone(z).includes(d)).toBe(d === base);
    }
  });

  it('keeps all other defs and original variant counts unchanged', () => {
    expect(Object.keys(FACADE_MODELS)).toHaveLength(6);
    for (const [model, count] of [['res_walkup', 12], ['com_corner_store', 12],
      ['com_shops_apartments', 12], ['com_office_block', 8], ['res_rowhouses', 12], ['com_boutique', 10]] as const) {
      expect(MANIFEST_BY_ID[model].variants).toBe(count);
    }
    expect(catalog.facadeDefs('res_cottage.r1.2')).toEqual([]);
    expect(catalog.growthDefId('old_or_unknown_def')).toBe('old_or_unknown_def');
    const { st } = makeCity({ size: 32 }, []);
    expect(spreadFacade(st, 'res_cottage.r1.2', 10, 10, 1, 1, 0, 1)).toBe(catalog.getDef('res_cottage.r1.2'));
  });
});

describe('NEW-01 deterministic facade spread', () => {
  it('uses tile and building id deterministically without drawing from the simulation RNG', () => {
    const { st, sim } = makeCity({ size: 32 }, []), before = sim.rng.state;
    const chosen = new Set<string>();
    for (let id = 1; id <= 100; id++) {
      const a = spreadFacade(st, BASES[0], 12, 12, 1, 1, 5, id);
      const b = spreadFacade(st, BASES[0], 12, 12, 1, 1, 5, id);
      expect(a).toBe(b);
      chosen.add(a.model);
    }
    expect(chosen.size).toBe(4);
    const tiles = new Set<string>();
    for (let x = 0; x < st.size; x++) tiles.add(spreadFacade(st, BASES[0], x, 12, 1, 1, 5, 1).model);
    expect(tiles.size).toBe(4);
    expect(sim.rng.state).toBe(before);
    expect(st.systemData.simRng).toBeUndefined();
  });

  it('uses the only free facade, matching the model across stages and ignoring other variants', () => {
    const { st, sim } = makeCity({ size: 32 }, []);
    const family = catalog.facadeDefs(BASES[0]), otherStage = catalog.facadeDefs(BASES[1]);
    for (let k = 0; k < 3; k++) placeBuilding(sim, building(st, otherStage[k].id, 10 + k * 2, 10, 4));
    placeBuilding(sim, building(st, family[3].id, 16, 10, 5));
    for (let id = 1; id <= 8; id++) expect(spreadFacade(st, BASES[0], 12, 12, 1, 1, 4, id)).toBe(family[3]);
  });

  it('measures the six-cell Chebyshev distance from lot edges, including deep lots', () => {
    const { st, sim } = makeCity({ size: 32 }, []);
    const family = catalog.facadeDefs(BASES[0]);
    for (let k = 0; k < 3; k++) {
      const b = building(st, family[k].id, 10 + k, 4);
      b.d = 3;
      placeBuilding(sim, b);
    }
    expect(VARIANT_SPREAD).toBe(6);
    expect(spreadFacade(st, BASES[0], 12, 12, 1, 1, 0, 1)).toBe(family[3]);
    const empty = makeCity({ size: 32 }, []).st;
    for (let id = 1; id <= 8; id++) {
      expect(spreadFacade(st, BASES[0], 12, 13, 1, 1, 0, id))
        .toBe(spreadFacade(empty, BASES[0], 12, 13, 1, 1, 0, id));
    }
  });

  it('when every facade is occupied, avoids a same-def twin before choosing the farthest model twin', () => {
    const { st, sim } = makeCity({ size: 32 }, []);
    const family = catalog.facadeDefs(BASES[0]), otherStage = catalog.facadeDefs(BASES[1]);
    for (let k = 0; k < 4; k++) placeBuilding(sim, building(st, k === 0 ? otherStage[k].id : family[k].id, 8 + k * 2, 10));
    expect(spreadFacade(st, BASES[0], 10, 12, 1, 1, 0, 1)).toBe(family[0]);
  });

  it('when every facade has a same-def twin, picks the farthest one', () => {
    const { st, sim } = makeCity({ size: 32 }, []);
    const family = catalog.facadeDefs(BASES[0]);
    for (let k = 0; k < 4; k++) placeBuilding(sim, building(st, family[k].id, [4, 8, 10, 12][k], 10));
    for (let id = 1; id <= 8; id++) expect(spreadFacade(st, BASES[0], 10, 12, 1, 1, 0, id)).toBe(family[0]);
  });

  it('projects facade neighbors back to the exact legacy variant decision, including same-def priority', () => {
    const original = makeCity({ size: 32 }, []), varied = makeCity({ size: 32 }, []);
    const family = catalog.facadeDefs(BASES[0]), otherStage = catalog.facadeDefs(BASES[1]);
    for (let v = 0; v < 12; v++) {
      const source = v % 2 ? otherStage : family, x = 7 + v % 4 * 2, z = 7 + Math.floor(v / 4) * 2;
      placeBuilding(original.sim, building(original.st, source[0].id, x, z, v));
      placeBuilding(varied.sim, building(varied.st, source[1 + v % 3].id, x, z, v));
    }
    for (const id of BASES.slice(0, 2)) for (let v = 0; v < 12; v++) {
      const expected = spreadVariant(original.st, id, 10, 13, 1, 1, v, 12);
      expect(spreadVariant(varied.st, id, 10, 13, 1, 1, v, 12)).toBe(expected);
      expect(spreadVariant(varied.st, catalog.facadeDefs(id)[2].id, 10, 13, 1, 1, v, 12)).toBe(expected);
    }
  });

  it.each(BASES)('%s spreads a street without three identical facades in a row', (id) => {
    const { st, sim } = makeCity({ size: 64 }, []);
    const d = catalog.getDef(id)!, width = d.footprint[0], models: string[] = [];
    for (let x = 4; x < 56; x += width) {
      const def = spreadFacade(st, id, x, 10, width, d.footprint[1], 0, st.nextBuildingId);
      placeBuilding(sim, building(st, def.id, x, 10));
      models.push(def.model);
    }
    for (let k = 2; k < models.length; k++) expect(new Set(models.slice(k - 2, k + 1)).size).toBeGreaterThan(1);
  });
});

describe('NEW-01 economic and save continuity', () => {
  function town(difficulty: Difficulty) {
    const city = makeCity({ size: 32, difficulty });
    city.st.funds = 1e6;
    for (const z of [4, 13, 22, 31]) road(city.A, 4, z, 31, z);
    for (const x of [4, 13, 22, 31]) road(city.A, x, 4, x, 31);
    for (let bz = 0; bz < 3; bz++) for (let bx = 0; bx < 3; bx++) {
      const zone = bz === 0 ? Zone.ResMed : bz === 1 ? Zone.ComMed : bx < 2 ? Zone.ResLow : Zone.IndMed;
      city.A.zone({ x0: 5 + bx * 9, z0: 5 + bz * 9, x1: 13 + bx * 9, z1: 13 + bz * 9 }, zone);
    }
    city.sim.runDays(360);
    return city;
  }

  it.each(['medium', 'hard'] as const)('keeps %s economic state and RNG identical with facade selection enabled', { timeout: 120000 }, (difficulty) => {
    const date = vi.spyOn(Date, 'now').mockReturnValue(0);
    const disabled = vi.spyOn(catalog, 'facadeDefs').mockReturnValue([]);
    try {
      const baseline = town(difficulty);
      baseline.sim.runDays(90);
      const expected = serializeCity(baseline.st, { copy: true });
      disabled.mockRestore();
      const varied = town(difficulty);
      varied.sim.runDays(90);
      expect([...varied.st.buildings.values()].some((b) => b.def !== catalog.growthDefId(b.def))).toBe(true);
      expect(varied.sim.rng.state).toBe(baseline.sim.rng.state);
      for (const b of varied.st.buildings.values()) b.def = catalog.growthDefId(b.def);
      expect(serializeCity(varied.st, { copy: true })).toEqual(expected);
    } finally {
      disabled.mockRestore();
      date.mockRestore();
    }
  });

  it('round-trips old buildings and new facades without new systemData keys or changing existing records', () => {
    const { st, sim } = makeCity({ size: 32 }, []);
    for (let k = 0; k < 4; k++) {
      const d = catalog.facadeDefs(BASES[0])[k];
      placeBuilding(sim, building(st, d.id, 4 + k * 3, 10, 11));
    }
    const records = [...st.buildings.values()].map((b) => ({ ...b }));
    const loaded = deserializeCity(serializeCity(st, { copy: true }));
    expect([...loaded.buildings.values()]).toEqual(records);
    expect(loaded.systemData).toEqual(st.systemData);
    const resumed = new Simulation(loaded, economySystems());
    resumed.runDays(1);
    expect([...loaded.buildings.values()].map((b) => [b.def, b.variant, b.capacity]))
      .toEqual(records.map((b) => [b.def, b.variant, b.capacity]));
    expect(catalog.getDef(records[0].def)?.devType).toBe(DevType.R1);
  });
});
