/**
 * WP6b orphans (docs/SIM_DEPTH_PART_B.md critic item 42):
 *  - the Clean Power Act's "plant upkeep +15 %" (SIM_DEPTH_SPEC C1) on the plants that smoke, nothing on clean ones;
 *  - capHints names a cap-relief transit facility whose use factor is 0 (no link: WP7b transportUseFactor) "not
 *    connected" instead of "little used".
 */
import { describe, expect, it } from 'vitest';
import { makeCity, road } from './helpers';
import { BF, type Building } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { econData } from '../../src/sim/economy/runtime';
import { economyRuntime } from '../../src/sim/systems/economy';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { computeMonthlyBudget } from '../../src/sim/economy/budget';
import { capHints, demandContext } from '../../src/sim/economy/demand';
import { ordinanceEffect } from '../../src/sim/economy/ordinances';

function put(c: ReturnType<typeof makeCity>, defId: string, x: number, z: number): Building {
  const def = getDef(defId)!;
  const b: Building = {
    id: c.st.nextBuildingId++, def: defId, x, z, w: def.footprint[0], d: def.footprint[1], rot: 0, variant: 0,
    pop: 0, jobs: 0, capacity: def.jobs ?? 0, wealth: 2, built: 1, age: 0, flags: BF.Plopped | BF.Powered | BF.Watered,
    baseY: 5, health: 1, unhappy: 0,
  };
  placeBuilding(c.sim, b);
  return b;
}

describe('Clean Power Act upkeep (SIM_DEPTH_SPEC C1)', () => {
  const utilities = (defId: string, act: boolean) => {
    const c = makeCity();
    put(c, defId, 20, 20);
    c.st.stats.powerSupply = 100;
    c.st.stats.powerDemand = 60;
    if (act) c.st.budget.ordinances.push('clean_power_act');
    return computeMonthlyBudget(c.st, null).expense['service:utilities'] ?? 0;
  };
  it('a coal plant costs 15 % more with scrubbers, a wind turbine the same', () => {
    expect(ordinanceEffect(makeCity().st, 'upkeep.power.smoke')).toBe(1);
    const coal0 = utilities('util_coal_plant', false), coal1 = utilities('util_coal_plant', true);
    expect(coal0).toBeGreaterThan(0);
    expect(coal1 / coal0).toBeCloseTo(1.15, 2); // (budget lines are rounded to whole $)
    const wind0 = utilities('util_wind_turbine', false), wind1 = utilities('util_wind_turbine', true);
    expect(wind0).toBeGreaterThan(0);
    expect(wind1).toBe(wind0);
  });
});

describe('cap-relief hint for an unconnected transit facility', () => {
  it('a train station with use factor 0 reads "not connected", a little-used one "little used"', () => {
    const c = makeCity();
    const rt = economyRuntime(c.sim.systems)!;
    const st = c.st;
    const b = put(c, 'tr_train_station', 20, 20);
    expect(road(c.A, 16, 19, 40, 19).ok).toBe(true); // road access: the only issue left is the link
    c.sim.runDays(1);
    const just = (st.systemData.justice ??= {}) as { use?: Record<string, number> };
    just.use = { [b.id]: 0 };
    const ctx0 = demandContext(st, rt);
    expect(ctx0.reliefIssues.R).toEqual({ unconnected: 1 });
    const d = econData(st);
    d.capBinding[0] = 1;
    st.stats.demand[0] = 0.5;
    expect(capHints(st).find((h) => h.family === 'R')!.hint).toMatch(/1 not connected/);
    // used, but below its rating: still "little used"
    just.use = { [b.id]: 0.5 };
    expect(demandContext(st, rt).reliefIssues.R).toEqual({ use: 1 });
    expect(capHints(st).find((h) => h.family === 'R')!.hint).toMatch(/little used/);
  });
});
