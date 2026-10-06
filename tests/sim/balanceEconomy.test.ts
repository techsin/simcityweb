/**
 * WP6b balance round 2 — the economy mechanics the final balance added (docs/SIM_DEPTH_PART_B.md §7; acceptance r1:
 * "money too easy, no mid-game trade-offs, neglect not punished"):
 *  - OPERATING COSTS (economy/opex.ts): a school, clinic, police / fire station or park pays OPEX_BUILDING_SHARE of its
 *    catalog upkeep for the building plus running costs per person its tier serves (stats.needs[tier].served); venues
 *    with income, landmarks and civic buildings keep the flat upkeep; economy-only cities (no sim-infra services) too.
 *  - LABOUR HEADROOM (demand.ts): commerce and industry expand only while the workforce can staff the new jobs; the
 *    headroom is shared by the two families by the jobs each offers.
 *  - Residents remember unanswered emergencies for a year (approval.ts, APPROVAL_TERMS.emFailRate).
 */
import { describe, expect, it } from 'vitest';
import { makeCity, road } from './helpers';
import { DevType, Network, Zone } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { getDef } from '../../src/sim/catalog';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { computeMonthlyBudget } from '../../src/sim/economy/budget';
import { demandSystem } from '../../src/sim/economy/demand';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { buildingUpkeep, expectedUpkeep, opexTierOf } from '../../src/sim/economy/opex';
import {
  APPROVAL_TERMS, LABOUR_MIN_HEAD, LABOUR_UNEMP0, LABOUR_VAC0, OPEX_BUILDING_SHARE, OPEX_PER_SERVED, WORKFORCE_RATIO,
} from '../../src/sim/economy/tuning';

describe('operating costs (economy/opex.ts)', () => {
  function city() {
    const c = makeCity();
    road(c.A, 0, 20, 63, 20, Network.Road);
    expect(c.A.plop('civ_elementary_school', 4, 21, 0).ok).toBe(true);
    expect(c.A.plop('civ_clinic', 14, 21, 0).ok).toBe(true);
    return c;
  }
  const school = getDef('civ_elementary_school')!, clinic = getDef('civ_clinic')!;

  it('economy-only cities keep the flat catalog upkeep', () => {
    const { st } = city();
    st.stats.needs.elementary.served = 1000;
    const e = computeMonthlyBudget(st, null).expense;
    expect(e['service:education']).toBe(school.upkeep);
    expect(e['service:health']).toBe(clinic.upkeep);
  });

  it('with sim-infra services: the building share plus running costs per person served, × funding on the building', () => {
    const { st, A } = city();
    st.systemData.infraVersion = 1;
    st.stats.needs.elementary.served = 1000;
    st.stats.needs.health.served = 5000;
    // college students are served by no operating-cost facility of this city: no running costs for them
    st.stats.needs.college.served = 400;
    let e = computeMonthlyBudget(st, null).expense;
    expect(e['service:education']).toBe(Math.round(school.upkeep! * OPEX_BUILDING_SHARE + 1000 * OPEX_PER_SERVED.elementary));
    expect(e['service:health']).toBe(Math.round(clinic.upkeep! * OPEX_BUILDING_SHARE + 5000 * OPEX_PER_SERVED.health));
    // funding scales the building part (the served count — and so the running costs — follows the service quality at
    // the next services pass)
    A.setFunding('education', 50);
    e = computeMonthlyBudget(st, null).expense;
    expect(e['service:education']).toBe(Math.round((school.upkeep! * OPEX_BUILDING_SHARE) / 2 + 1000 * OPEX_PER_SERVED.elementary));
    // more people served cost more
    st.stats.needs.elementary.served = 1500;
    expect(computeMonthlyBudget(st, null).expense['service:education']).toBeGreaterThan(e['service:education']);
  });

  it('which defs run on operating costs, and the estimate a mayor (or the bot) plans with', () => {
    expect(opexTierOf(getDef('civ_hospital'))).toBe('health');
    expect(opexTierOf(getDef('civ_library'))).toBe('college');
    expect(opexTierOf(getDef('civ_police_station'))).toBe('police');
    expect(opexTierOf(getDef('park_small'))).toBe('green');
    // venues that earn money, rewards and buildings without a service tier keep the flat upkeep
    expect(opexTierOf(getDef('park_stadium'))).toBeNull();
    expect(opexTierOf(getDef('civ_jail'))).toBeNull();
    expect(opexTierOf(getDef('util_coal_plant'))).toBeNull();
    expect(buildingUpkeep(null, clinic)).toBeCloseTo(clinic.upkeep! * OPEX_BUILDING_SHARE, 6);
    expect(expectedUpkeep(null, clinic, 2000)).toBeCloseTo(clinic.upkeep! * OPEX_BUILDING_SHARE + 2000 * OPEX_PER_SERVED.health, 6);
    // capped at a typical load: a clinic never plans for more than its seats
    expect(expectedUpkeep(null, clinic, 1e9)).toBeLessThanOrEqual(clinic.upkeep! * OPEX_BUILDING_SHARE + clinic.coverage!.capacity! * OPEX_PER_SERVED.health);
    expect(expectedUpkeep(null, getDef('civ_jail')!)).toBe(getDef('civ_jail')!.upkeep);
  });
});

describe('labour headroom (demand.ts)', () => {
  /** demand-only city with synthetic totals: 100k residents (55k workers), job capacity per family as given */
  function demandCity(capC: number, capI: number) {
    const st = createCityState(defaultCityConfig({ size: 128, seed: 5, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
    st.neighborConnections = [{ edge: 'n', x: 64, z: 0, type: Network.Highway }];
    const rt = new EconRuntime();
    const sim = new Simulation(st, [demandSystem(rt)]);
    const t = rt.totals;
    t.pop = [40000, 45000, 15000];
    t.population = 100000;
    t.resCapAll = [40000, 45000, 15000];
    const c = [0.2, 0.2, 0.1, 0.35, 0.15], i = [0.05, 0.35, 0.45, 0.15];
    [DevType.CS1, DevType.CS2, DevType.CS3, DevType.CO2, DevType.CO3].forEach((d, k) => { t.jobCapAll[d] = capC * c[k]; });
    [DevType.IA, DevType.ID, DevType.IM, DevType.IHT].forEach((d, k) => { t.jobCapAll[d] = capI * i[k]; });
    st.stats.eq = 100;
    rt.capsDirty = true;
    // (demandAbs is smoothed: a month of the same totals converges it)
    for (let k = 0; k < 40; k++) sim.advanceDay();
    const d = econData(st);
    let posC = 0, posI = 0, exC = 0, exI = 0;
    for (let k = DevType.CS1; k <= DevType.CO3; k++) { posC += Math.max(0, d.demandAbs[k]); exC += Math.max(0, d.target[k] - t.jobCapAll[k]); }
    for (let k = DevType.IA; k <= DevType.IHT; k++) { posI += Math.max(0, d.demandAbs[k]); exI += Math.max(0, d.target[k] - t.jobCapAll[k]); }
    return { st, d, posC, posI, exC, exI };
  }
  const staffable = (100000 * WORKFORCE_RATIO * (1 - LABOUR_UNEMP0)) / (1 - LABOUR_VAC0);

  it('more jobs than the workforce can staff: commerce and industry wait for workers', () => {
    // 65k jobs for 55k workers, while the economy's targets want more
    const { d, posC, posI, exC, exI } = demandCity(40000, 25000);
    expect(exC + exI).toBeGreaterThan(2 * LABOUR_MIN_HEAD);
    expect(d.labour!.headroom).toBeLessThan(0);
    expect(posC + posI).toBeLessThanOrEqual(LABOUR_MIN_HEAD + 1);
    expect(d.labour!.scale).toBeLessThan(0.2);
  });

  it('workers to spare: jobs grow up to the headroom, shared by the jobs each family offers', () => {
    const { d, posC, posI, exC, exI } = demandCity(40000, 10000);
    const head = staffable - 50000;
    expect(d.labour!.headroom).toBeCloseTo(head, -1);
    expect(exC + exI).toBeGreaterThan(head);
    expect(posC + posI).toBeLessThanOrEqual(head + 2);
    expect(posC + posI).toBeGreaterThan(0.95 * head);
    // commerce offers 80 % of the jobs: it gets that share of the headroom (or all it wants) — the big industrial target
    // (a city without industrial land) no longer starves the offices
    expect(posC).toBeGreaterThanOrEqual(Math.min(exC, 0.8 * head) - 2);
  });
});

describe('approval remembers unanswered emergencies', () => {
  let nextId = 3_000_000;
  function town(pop: number) {
    const c = makeCity({ size: 96 });
    road(c.A, 0, 40, 95, 40, Network.Avenue);
    for (let k = 0; k < 8; k++) {
      const defId = 'res_apartment.r2.4', def = getDef(defId)!;
      const b: Building = {
        id: nextId++, def: defId, x: 10 + k * 8, z: 42, w: def.footprint[0], d: def.footprint[1], rot: 0, variant: 0, pop: pop / 8, jobs: 0,
        capacity: Math.max(pop / 8, def.capacity ?? 0), wealth: 2, built: 1, age: 400, flags: BF.Powered | BF.Watered, baseY: 5, health: 0.8, unhappy: 0,
      };
      c.st.nextBuildingId = Math.max(c.st.nextBuildingId, b.id + 1);
      placeBuilding(c.sim, b);
      for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) c.st.zone[c.st.idx(xx, zz)] = Zone.ResMed;
    }
    c.st.systemData.infraVersion = 1;
    c.st.systemData.infraLayers = { utilities: true, traffic: false, pollution: false, services: false };
    c.st.stats.population = pop;
    c.sim.systems.push({ name: 'emergency', active: true } as SimSystem & { active: boolean });
    return c;
  }
  function month(c: ReturnType<typeof town>) {
    c.st.day++;
    (c.sim.systems.find((s) => s.name === 'economy.approval') as SimSystem).monthly!(c.sim);
    return econData(c.st).approvalTerms;
  }

  it('the share of the year\'s emergencies that went unanswered costs approval for twelve months', () => {
    const c = town(12000);
    const yr = c.st.stats.emergency.year;
    yr.count.fire = 10; yr.count.medical = 30;
    expect(month(c).emergencies ?? 0).toBe(0);
    yr.failed = 3;
    const t = month(c).emergencies;
    expect(t).toBeCloseTo(-APPROVAL_TERMS.emFailRate * 3 / (40 + APPROVAL_TERMS.emFailN0), 5);
    // the approval breakdown says why
    expect(t).toBeLessThan(-4);
    // a big city's occasional failure weighs less than a town's
    yr.count.medical = 600; yr.failed = 3;
    expect(month(c).emergencies).toBeGreaterThan(t / 5);
  });

  it('a hamlet\'s first fire is not held against the mayor (faded in like the outage terms)', () => {
    const c = town(1200);
    const yr = c.st.stats.emergency.year;
    yr.count.fire = 1; yr.failed = 1;
    expect(month(c).emergencies ?? 0).toBe(0);
  });
});
