/**
 * LG-02 QA round 2, B2 (the sim side): a landmark with a service tier — Central Library, Botanical Dome and, on the
 * same code path, the base's Observatory — stated its flat catalog upkeep, while the budget also charges the people it
 * serves at the tier's running-cost rate (economy/opex.ts tierOperatingCosts): a "§1,600 / month" Central Library
 * booked §6,197 in a 1.1M city. The fix changes no charge. It states the cost from the budget's own figures:
 *  - landmarkUpkeep: what one costs at a typical load in this city and with every seat in use (the build card, the
 *    plop tip and the Rewards panel quote it through ui/upkeepModel.ts);
 *  - landmarkOpex: the standing building's upkeep and its share of the tier's running costs (the inspector), so that
 *    the upkeep lines of a tier add up to the budget line.
 * What the city pays is pinned here against the catalog and tuning figures, not against the new helpers.
 */
import { describe, expect, it } from 'vitest';
import { BF, type Building } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { getDef } from '../../src/sim/catalog';
import { computeMonthlyBudget } from '../../src/sim/economy/budget';
import {
  expectedUpkeep, facilityOpex, landmarkOpex, landmarkOpexRateOf, landmarkUpkeep, opexTierOf, tierCharged,
} from '../../src/sim/economy/opex';
import { OPEX_BUILDING_SHARE, OPEX_PER_SERVED, OPEX_TYPICAL_LOAD } from '../../src/sim/economy/tuning';
import { facilityLoad } from '../../src/sim/infra/catchments';
import { facilityReport } from '../../src/sim/infra/facilities';
import { ServicesSystem } from '../../src/sim/infra/services';
import { newState, place, roadLine } from '../infra/cityGen';
import { makeCity, road } from './helpers';

const library = getDef('lm_central_library')!, dome = getDef('lm_botanical_dome')!, observatory = getDef('lm_observatory')!;
const publicLibrary = getDef('civ_library')!, smallPark = getDef('park_small')!;

/** an economy-only city that charges running costs (infraVersion set), the given defs placed along a road */
function city(...ids: string[]) {
  const c = makeCity({}, []);
  c.st.funds = 1e9;
  c.st.systemData.infraVersion = 1;
  road(c.A, 2, 20, 61, 20);
  const at: Record<string, Building> = {};
  let x = 4;
  for (const id of ids) {
    const def = getDef(id)!;
    if (def.requires) c.st.unlocked.add(def.requires);
    const r = c.A.plop(id, x, 21, 0);
    expect(r.ok, `${id}: ${r.reason}`).toBe(true);
    at[id] = c.st.buildingAt(x, 21)!;
    x += def.footprint[0] + 2;
  }
  return { ...c, at };
}
type Needs = Record<string, { need: number; served: number }>;

describe('LG-02 QA B2: the budget charges a tier landmark\'s users; the charge itself is unchanged', () => {
  it('which defs: the three landmarks with a service tier, no venue, reward or plain landmark', () => {
    expect(landmarkOpexRateOf(library)).toEqual({ tier: 'college', rate: OPEX_PER_SERVED.college, unit: 'learner' });
    expect(landmarkOpexRateOf(observatory)).toEqual({ tier: 'college', rate: OPEX_PER_SERVED.college, unit: 'learner' });
    expect(landmarkOpexRateOf(dome)).toEqual({ tier: 'green', rate: OPEX_PER_SERVED.green, unit: 'visitor' });
    // (the same charge reaches these base venues and rewards: their stated flat upkeep is left as it is)
    for (const id of ['park_zoo', 'park_stadium', 'park_amusement', 'rw_research_center', 'civ_cemetery']) expect(landmarkOpexRateOf(getDef(id)), id).toBeNull();
    for (const id of ['lm_grand_central', 'lm_stock_exchange', 'lm_world_trade_center', 'lm_millennium_tower', 'lm_metropolis_crown', 'lm_opera_house']) expect(landmarkOpexRateOf(getDef(id)), id).toBeNull();
    // a running-cost facility is not a landmark case, and nothing here turns a landmark into one: the budget and the
    // bot's estimate (expectedUpkeep) still see the flat catalog upkeep
    expect(landmarkOpexRateOf(publicLibrary)).toBeNull();
    for (const d of [library, dome, observatory]) {
      expect(opexTierOf(d)).toBeNull();
      expect(expectedUpkeep(null, d)).toBe(d.upkeep);
    }
  });

  it('Central Library: flat while no college-level facility runs; with one, §0.60 for each of its learners on top', () => {
    const alone = city('lm_central_library').st;
    (alone.stats.needs as unknown as Needs).college.served = 8000;
    // no operating-cost facility of the college tier: nobody is charged for (the stated flat upkeep is the truth)
    expect(computeMonthlyBudget(alone, null).expense['service:education']).toBe(library.upkeep);
    expect(tierCharged(alone, 'college')).toBe(false);
    expect(landmarkUpkeep(alone, library)).toBeNull();

    const { st, at } = city('lm_central_library', 'civ_library');
    const needs = st.stats.needs as unknown as Needs;
    needs.college.served = 8000;
    const line = () => computeMonthlyBudget(st, null).expense['service:education'];
    const flat = library.upkeep! + publicLibrary.upkeep! * OPEX_BUILDING_SHARE;
    expect(line()).toBe(Math.round(flat + 8000 * OPEX_PER_SERVED.college)); // §6,454 for a "§1,600" landmark and a "§54" library
    expect(tierCharged(st, 'college')).toBe(true);
    // the stated cost: every seat in use at most; a typical load bounded by the city's unserved need
    needs.college.need = 50000;
    let u = landmarkUpkeep(st, library)!;
    expect(u.full).toBe(library.upkeep! + library.coverage!.capacity! * OPEX_PER_SERVED.college);
    expect(u.full).toBeCloseTo(13600, 6);
    expect(u.now).toBeCloseTo(library.upkeep! + library.coverage!.capacity! * OPEX_TYPICAL_LOAD * OPEX_PER_SERVED.college, 6);
    expect(u.now).toBeCloseTo(10000, 6);
    needs.college.need = 9000; // 1,000 unserved: a quarter of a typical load at least
    u = landmarkUpkeep(st, library)!;
    expect(u.now).toBeCloseTo(library.upkeep! + 0.25 * library.coverage!.capacity! * OPEX_TYPICAL_LOAD * OPEX_PER_SERVED.college, 6);
    // the booked line lies inside the stated range at any use the landmark can have
    for (const learners of [0, 6157, 20000]) {
      needs.college.served = learners;
      expect(line() - Math.round(publicLibrary.upkeep! * OPEX_BUILDING_SHARE)).toBeLessThanOrEqual(u.full);
      expect(line()).toBeGreaterThanOrEqual(library.upkeep!);
    }
    // without a city (a static listing): the typical load
    expect(landmarkUpkeep(null, library)!.now).toBeCloseTo(10000, 6);
    // the public library in ruins: the tier is not charged, as computeMonthlyBudget's opexTiers has it
    needs.college.served = 8000;
    at.civ_library.flags |= BF.Burnt;
    expect(tierCharged(st, 'college')).toBe(false);
    expect(landmarkUpkeep(st, library)).toBeNull();
    expect(line()).toBe(Math.round(flat));
  });

  it('Botanical Dome (green tier, parks line) and the Observatory (same code path: civic upkeep, education running costs)', () => {
    const d = city('lm_botanical_dome', 'park_small').st;
    (d.stats.needs as unknown as Needs).green.served = 70535;
    expect(computeMonthlyBudget(d, null).expense['service:parks']).toBe(Math.round(dome.upkeep! + smallPark.upkeep! * OPEX_BUILDING_SHARE + 70535 * OPEX_PER_SERVED.green));
    expect(landmarkUpkeep(d, dome)!.full).toBe(dome.upkeep! + 80000 * OPEX_PER_SERVED.green);
    expect(landmarkUpkeep(d, dome)!.full).toBeCloseTo(3000, 6);
    expect(landmarkUpkeep(d, library)).toBeNull(); // (no college-level facility in this city)

    const o = city('lm_observatory', 'civ_library').st;
    (o.stats.needs as unknown as Needs).college.served = 3000;
    const e = computeMonthlyBudget(o, null).expense;
    expect(e['service:civic']).toBe(observatory.upkeep);
    expect(e['service:education']).toBe(Math.round(publicLibrary.upkeep! * OPEX_BUILDING_SHARE + 3000 * OPEX_PER_SERVED.college));
    expect(landmarkUpkeep(o, observatory)!.full).toBe(observatory.upkeep! + 5000 * OPEX_PER_SERVED.college);
    // an economy-only simulation charges no running costs at all
    delete o.systemData.infraVersion;
    expect(landmarkUpkeep(o, observatory)).toBeNull();
    expect(computeMonthlyBudget(o, null).expense['service:education']).toBe(publicLibrary.upkeep);
  });
});

describe('LG-02 QA B2: the inspector states the building and its share of the running costs', () => {
  /** a street of homes, a Central Library and (optionally) a Public Library on a real services pass */
  function town(withPublic: boolean) {
    const st = newState(96);
    st.systemData.infraVersion = 1;
    roadLine(st, 10, 40, 85, 40);
    const on = BF.Plopped | BF.Powered | BF.Watered;
    for (let x = 24; x < 60; x += 2) place(st, 't_r2', x, 41, { pop: 4000, capacity: 4000, flags: BF.Powered | BF.Watered });
    const lib = place(st, 'lm_central_library', 26, 37, { flags: on });
    const pub = withPublic ? place(st, 'civ_library', 40, 38, { flags: on }) : null;
    const sim = new Simulation(st, [new ServicesSystem()]);
    return { st, sim, lib, pub };
  }
  const upkeep = (sim: Simulation, b: Building) => facilityReport(sim, b.id)!.lines.find((l) => l.key === 'upkeep')!;

  it('charged: "§1,600 + its learners" in the line and its hint; the tier\'s lines add up to the budget line', () => {
    const { st, sim, lib, pub } = town(true);
    const served = st.stats.needs.college.served;
    expect(facilityLoad(sim, lib.id)!.served).toBeGreaterThan(100);
    expect(served).toBeGreaterThan(100);
    const cl = landmarkOpex(sim, lib)!, pl = facilityOpex(sim, pub!)!;
    // the landmark pays its whole catalog upkeep (no building share), the facility OPEX_BUILDING_SHARE of its own
    expect(cl.building).toBe(library.upkeep);
    expect(pl.building).toBeCloseTo(publicLibrary.upkeep! * OPEX_BUILDING_SHARE, 9);
    expect(cl.running).toBeGreaterThan(0);
    expect(pl.running).toBeGreaterThan(0);
    // the two shares are the whole of the tier's running costs, each by the coverage it delivers
    expect(cl.running + pl.running).toBeCloseTo(served * OPEX_PER_SERVED.college, 6);
    expect(cl.running / pl.running).toBeCloseTo(facilityLoad(sim, lib.id)!.served / facilityLoad(sim, pub!.id)!.served, 6);
    const line = computeMonthlyBudget(st, null).expense['service:education'];
    expect(Math.abs(cl.building + cl.running + pl.building + pl.running - line)).toBeLessThanOrEqual(0.5); // (the line is rounded)
    // the report line: the sum, with the split in its hint (a school's words)
    const up = upkeep(sim, lib);
    expect(up.value).toBe(`§${Math.round(cl.building + cl.running).toLocaleString('en-US')} / month`);
    expect(up.value).not.toBe('§1,600 / month');
    expect(up.hint).toMatch(/^Its share of the city's running costs: the building §1,600 \+ §[\d,]+ for the people it serves \(§0\.60 a month for each of the city's [\d,]+ students\); bulldozing it saves less when nearby facilities take over its users$/);
    // funding scales the building part, as the budget does for a landmark with a service line
    st.budget.funding.education = 50;
    expect(landmarkOpex(sim, lib)!.building).toBe(library.upkeep! / 2);
    expect(upkeep(sim, lib).value).toMatch(/ \/ month \(50% funding\)$/);
    st.budget.funding.education = 100;
    // in ruins: the building is still charged, nothing for learners it no longer serves
    lib.flags |= BF.Burnt;
    expect(landmarkOpex(sim, lib)).toMatchObject({ building: library.upkeep, running: 0, people: 0 });
    expect(upkeep(sim, lib)).toMatchObject({ value: '§1,600 / month', status: 'warn', hint: 'Still charged until you bulldoze it' });
  });

  it('not charged (no college-level facility): the flat upkeep, as the budget books it', () => {
    const { st, sim, lib } = town(false);
    expect(st.stats.needs.college.served).toBeGreaterThan(100);
    expect(landmarkOpex(sim, lib)).toBeNull();
    expect(computeMonthlyBudget(st, null).expense['service:education']).toBe(library.upkeep);
    const up = upkeep(sim, lib);
    expect(up.value).toBe('§1,600 / month');
    expect(up.hint).toBeUndefined();
  });
});
