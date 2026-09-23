import { describe, expect, it } from 'vitest';
import { CATALOG, CAP_RELIEF, PLOP_CATEGORIES, ZONE_DEVTYPES, getDef, growablesFor, ploppables, rotatedFootprint } from '../../src/sim/catalog';
import { MANIFEST, MANIFEST_BY_ID } from '../../src/assets/manifest';
import { REWARD_BY_ID } from '../../src/sim/economy/rewards';
import { DEV_TYPE_COUNT, Zone } from '../../src/core/types';

const BUILDING_GROUPS = new Set(['residential', 'commercial', 'industrial', 'utility', 'civic', 'park', 'landmark', 'reward', 'transport']);

describe('catalog', () => {
  it('has a def for every building model of the manifest', () => {
    const models = new Set(CATALOG.map((d) => d.model));
    const missing = MANIFEST.filter((m) => BUILDING_GROUPS.has(m.group) && !models.has(m.id)).map((m) => m.id);
    expect(missing).toEqual([]);
  });

  it('ids are unique, footprints match the manifest', () => {
    const ids = new Set<string>();
    for (const d of CATALOG) {
      expect(ids.has(d.id), d.id).toBe(false);
      ids.add(d.id);
      expect(d.footprint).toEqual(MANIFEST_BY_ID[d.model].footprint);
      expect(getDef(d.id)).toBe(d);
    }
  });

  it('growables: every DevType has stage-1 buildings, capacity grows with stage, hidden', () => {
    for (let dev = 0; dev < DEV_TYPE_COUNT; dev++) {
      const list = growablesFor(dev);
      expect(list.length, `dev ${dev}`).toBeGreaterThan(0);
      for (const d of list) {
        expect(d.hidden).toBe(true);
        expect(d.capacity).toBeGreaterThan(0);
        expect(d.zones!.length).toBeGreaterThan(0);
        for (const z of d.zones!) expect(ZONE_DEVTYPES[z]).toContain(dev);
      }
      // max capacity of stage s+1 >= max capacity of stage s
      const byStage = new Map<number, number>();
      for (const d of list) byStage.set(d.stage!, Math.max(byStage.get(d.stage!) ?? 0, d.capacity!));
      const stages = [...byStage.keys()].sort((a, b) => a - b);
      for (let k = 1; k < stages.length; k++) expect(byStage.get(stages[k])!).toBeGreaterThanOrEqual(byStage.get(stages[k - 1])!);
    }
  });

  it('size references from the brief', () => {
    expect(getDef('res_shack.r1.1')!.capacity).toBeLessThanOrEqual(8);
    const st = getDef('res_supertall.r3.8')!.capacity!;
    expect(st).toBeGreaterThanOrEqual(6000);
    expect(st).toBeLessThanOrEqual(9000);
    expect(getDef('com_megatower.co3.8')!.capacity).toBe(12000);
  });

  it('low zones only get stage ≤ 3 growables; high zone buildings exist up to stage 8', () => {
    for (const d of CATALOG) {
      if (d.category !== 'growable') continue;
      if (d.zones!.every((z) => z === Zone.ResLow || z === Zone.ComLow || z === Zone.IndAg)) expect(d.stage!).toBeLessThanOrEqual(3);
    }
    expect(growablesFor(2).some((d) => d.stage === 8)).toBe(true);
  });

  it('ploppables have cost/name, known unlock ids, and categories for the UI', () => {
    const plops = ploppables();
    expect(plops.length).toBeGreaterThan(60);
    for (const d of plops) {
      expect(d.cost, d.id).toBeGreaterThanOrEqual(0);
      expect(d.name.length).toBeGreaterThan(2);
      if (d.requires) expect(REWARD_BY_ID.has(d.requires), `${d.id} requires ${d.requires}`).toBe(true);
    }
    expect(ploppables('power').every((d) => d.category === 'power' && (d.powerOut ?? 0) > 0)).toBe(true);
    expect(PLOP_CATEGORIES).not.toContain('growable');
    for (const id of Object.keys(CAP_RELIEF)) expect(getDef(id), id).toBeDefined();
  });

  it('a 1M city needs several big plants (unit system sanity)', () => {
    // 1M residents (mix) + ~550k jobs
    const res = 1_000_000 * 0.001;
    const jobs = 550_000 * 0.0022;
    const need = res + jobs;
    expect(need / getDef('util_coal_plant')!.powerOut!).toBeGreaterThan(4);
    expect(need / getDef('util_nuclear_plant')!.powerOut!).toBeGreaterThan(1.2);
  });

  it('rotatedFootprint swaps w/d for odd rotations', () => {
    const d = getDef('tr_train_station')!;
    expect(rotatedFootprint(d, 0)).toEqual([4, 2]);
    expect(rotatedFootprint(d, 1)).toEqual([2, 4]);
    expect(rotatedFootprint(d, 2)).toEqual([4, 2]);
    expect(rotatedFootprint(d, 3)).toEqual([2, 4]);
  });
});
