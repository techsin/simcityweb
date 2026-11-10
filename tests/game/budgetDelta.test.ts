/**
 * FH-05's budget helper, src/ui/guide/budgetDelta.ts (T037e moved it there from src/game/tools/Tool.ts, where T037c wrote
 * it; its tests came along from budgetPreview.test.ts, which keeps the plop tip, the build card and the acceptance
 * town):
 *  - budgetEffect / reservesText: before = last month's recurring net, the top bar's (one-offs left out); after = before
 *    − the upkeep the tip quotes + a business deal's income; red below zero with the months of reserves, never more
 *    than 60; no line before the first report, in a sandbox, or for a building that changes nothing;
 *  - Tool.ts hands on the same functions (the plop tool and the toolbar import them from there);
 *  - the finance advisor's side: the services the open advice asks for, by id (ASKED_SERVICE, askedServices), the lot
 *    beside an advice's place (serviceLot), and the upkeep the plop tip quotes for one more there (quotedUpkeep).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import * as Tool from '../../src/game/tools/Tool';
import { adviceView } from '../../src/ui/advisorModel';
import { ASKED_SERVICE, RESERVE_MONTHS_MAX, askedServices, budgetEffect, quotedUpkeep, recurringIncome, reservesText, serviceLot } from '../../src/ui/guide/budgetDelta';
import { upkeepEstimate } from '../../src/ui/upkeepModel';
import { newState, roadLine } from '../infra/cityGen';

const fire = getDef('civ_fire_station')!;

/** last month: +§259 of recurring net (900 − 641), one-offs on both sides (never counted); §2,042 in the bank */
function report(st: CityState): CityState {
  st.budget.lastIncome = { 'tax:R$': 600, 'tax:CS$': 300, 'oneoff:loan': 10000, 'oneoff:refund': 250 };
  st.budget.lastExpense = { 'service:utilities': 400, 'transport:roads': 241, 'oneoff:construction': 1400, 'oneoff:zoning': 90 };
  st.funds = 2042;
  return st;
}

describe('budgetEffect: last month\'s net → after this (FH-05)', () => {
  it('the plan\'s town: +§259 a month and a §539 Fire Station read "+§259 → −§280 after this", red, with the months of reserves', () => {
    expect(budgetEffect(report(newState(32)), fire, 539)).toEqual({ before: 259, after: -280, text: '+§259 → −§280 after this', reserves: '≈ 7 months of reserves', bad: true });
  });

  it('a surplus that stays positive: the plain line, no reserves', () => {
    expect(budgetEffect(report(newState(32)), fire, 100)).toEqual({ before: 259, after: 159, text: '+§259 → +§159 after this', reserves: '', bad: false });
  });

  it('one-offs never count: construction, zoning, demolition, terraform, loan money and refunds', () => {
    const st = report(newState(32));
    Object.assign(st.budget.lastIncome, { 'oneoff:loan': 1e6 });
    Object.assign(st.budget.lastExpense, { 'oneoff:demolition': 5000, 'oneoff:terraform': 800, 'oneoff:loanRepay': 20000 });
    expect(budgetEffect(st, fire, 100)!.before).toBe(259);
    // a first month of nothing but one-offs: a report with a net of zero (the top bar's "±§0/mo")
    st.budget.lastIncome = {};
    st.budget.lastExpense = { 'oneoff:construction': 1400 };
    expect(budgetEffect(st, fire, 539)!.text).toBe('±§0 → −§539 after this');
  });

  it('no line before the first report, in a sandbox, or for a building that changes nothing', () => {
    const st = newState(32);
    st.funds = 2042;
    // (a city's first month: the top bar's "No report yet")
    expect(budgetEffect(st, fire, 539)).toBeNull();
    report(st);
    expect(budgetEffect(st, fire, 539, true)).toBeNull();
    expect(budgetEffect(st, fire, 0)).toBeNull();
    expect(budgetEffect(st, fire, 0.4)).toBeNull();
    expect(budgetEffect(st, fire, 539)).not.toBeNull();
  });

  it('a business deal\'s income counts (it pays as it is); a venue\'s or an airport\'s follows its visitors, so it is named, not counted', () => {
    const st = report(newState(32));
    const line = (id: string) => { const d = getDef(id)!; return budgetEffect(st, d, d.upkeep ?? 0); };
    expect(line('rw_casino')).toMatchObject({ text: '+§259 → +§2,859 after this', bad: false });
    expect(line('rw_military_base')).toMatchObject({ text: '+§259 → +§1,759 after this', bad: false });
    expect(line('park_stadium')).toEqual({ before: 259, after: -1541, text: '+§259 → −§1,541 after this, before its income (up to §1,500 when busy)', reserves: '≈ 1 month of reserves', bad: true });
    expect(line('tr_airport_small')).toMatchObject({ text: '+§259 → −§541 after this, before its income (up to §600 when busy)', reserves: '≈ 3 months of reserves' });
    // the build card leaves the note out: its Income row already says it
    const stadium = getDef('park_stadium')!;
    expect(budgetEffect(st, stadium, stadium.upkeep ?? 0, false, { venueNote: false })?.text).toBe('+§259 → −§1,541 after this');
  });

  it('the months of reserves: none left, under a month, one month — and never more than 60', () => {
    expect(reservesText(0, 100)).toBe('no reserves left');
    expect(reservesText(-500, 100)).toBe('no reserves left');
    expect(reservesText(99, 100)).toBe('less than a month of reserves');
    expect(reservesText(100, 100)).toBe('≈ 1 month of reserves');
    expect(reservesText(6000, 100)).toBe('≈ 60 months of reserves');
    expect(reservesText(6001, 100)).toBe('more than 5 years of reserves');
    // (acceptance: the months-left text never exceeds 60 months)
    let counted = 0;
    for (let funds = 1; funds < 2e8; funds = Math.ceil(funds * 1.37)) {
      for (let loss = 1; loss < 3e5; loss = Math.ceil(loss * 1.61)) {
        const t = reservesText(funds, loss), m = /^≈ (\d+) months? of reserves$/.exec(t);
        if (m) { counted++; expect(Number(m[1]), t).toBeLessThanOrEqual(60); }
        else expect(['no reserves left', 'less than a month of reserves', 'more than 5 years of reserves']).toContain(t);
      }
    }
    expect(counted).toBeGreaterThan(50);
    // and through a whole line: a rich city losing a little
    const st = report(newState(32));
    st.funds = 1e7;
    expect(budgetEffect(st, fire, 539)!.reserves).toBe('more than 5 years of reserves');
  });
});

describe('the helper moved, not copied (T037e)', () => {
  it('Tool.ts hands on the guide\'s own functions: the plop tool and the toolbar keep importing them from there', () => {
    expect(Tool.budgetEffect).toBe(budgetEffect);
    expect(Tool.reservesText).toBe(reservesText);
    // (the one cap both the tip's reserves and the finance advisor's months count to)
    expect(RESERVE_MONTHS_MAX).toBe(60);
  });
});

describe('the services the advisors ask for (FH-05: the finance card\'s "a Fire Station costs about §540 a month")', () => {
  /** a 32 × 32 map with one road along z = 10 (x 2..29) */
  function strip(): CityState {
    const st = newState(32);
    roadLine(st, 2, 10, 29, 10, Network.Road);
    return st;
  }

  it('every entry is a live advice rule with a data view, and asks for a building any city can place: unlocked, with an upkeep', () => {
    const rules = readFileSync(new URL('../../src/sim/economy/advisors.ts', import.meta.url), 'utf8');
    const names: Record<string, string> = {};
    for (const [id, defId] of Object.entries(ASKED_SERVICE)) {
      expect(rules.includes(`{ id: '${id}',`), `advisors.ts has a rule '${id}'`).toBe(true);
      expect(adviceView(id), `${id}: a service gap has a coverage view`).not.toBeNull();
      const def = getDef(defId)!;
      expect(def, defId).toBeDefined();
      expect(def.requires, `${defId} is never locked`).toBeUndefined();
      expect(def.upkeep, defId).toBeGreaterThan(0);
      expect(def.coverage, `${defId} is a service`).toBeDefined();
      names[defId] = def.name;
    }
    expect(names).toEqual({
      civ_fire_station: 'Fire Station', civ_police_station: 'Police Station', civ_elementary_school: 'Elementary School', civ_high_school: 'High School',
      civ_library: 'Public Library', civ_clinic: 'Medical Clinic', park_playground: 'Playground', park_small: 'Small Park',
    });
  });

  it('askedServices: by id — a variant\'s ref first — never by text; one entry per building, at the first place its advice names', () => {
    const st = strip();
    const asked = askedServices(st, [
      { id: 'zoneR' },
      { id: 'crime' },                                  // "We need more police stations": no place …
      { id: 'noFireResponse', x: 12, z: 14 },
      { id: 'noPolice', x: 20, z: 12 },                 // … this one names it
      { id: 'plantNoFire', x: 5, z: 5 },                // (the Fire Station already has its place)
      { id: 'zoneR', ref: 'noRoadAccess', x: 1, z: 1 },
      { id: 'noHigh', ref: 'zoneDev2' },                // a variant whose fix is another rule's: not a High School
      { id: 'toString' },
      { id: 'parks' },
      { id: 'zoneR', ref: 'playgrounds', x: 12, z: 20 }, // by its ref; no road within reach of that place
    ]);
    expect(asked.map((a) => [a.def.id, a.lot])).toEqual([
      ['civ_police_station', { x: 20, z: 11, w: 2, d: 2 }],
      ['civ_fire_station', { x: 12, z: 11, w: 2, d: 2 }],
      ['park_small', null],
      ['park_playground', null],
    ]);
    expect(askedServices(st, [])).toEqual([]);
    expect(askedServices(st, [{ id: 'deficit' }, { id: 'garbage', x: 3, z: 3 }, { id: 'schoolOvercrowded', x: 12, z: 14 }])).toEqual([]);
  });

  it('serviceLot: the footprint nearest to the place — centred on a cell as the plop tool centres one — on dry land off the road, a road along one side', () => {
    const st = strip();
    // mid-block, four rows south of the road: the lot on the road's south side, straight north of the place
    expect(serviceLot(st, fire, 12, 14)).toEqual({ x: 12, z: 11, w: 2, d: 2 });
    expect(serviceLot(st, getDef('park_playground')!, 12, 14)).toEqual({ x: 12, z: 11, w: 1, d: 1 });
    expect(serviceLot(st, getDef('civ_elementary_school')!, 12, 14)).toEqual({ x: 11, z: 11, w: 3, d: 3 });
    expect(serviceLot(st, getDef('civ_high_school')!, 12, 14)).toEqual({ x: 11, z: 11, w: 4, d: 4 });
    // a place on the road itself: beside it, never on it
    expect(serviceLot(st, fire, 12, 10)).toEqual({ x: 12, z: 11, w: 2, d: 2 });
    // at the map's edge, past the road's end: inside the map, the road's last tile along its west side
    expect(serviceLot(st, fire, 31, 11)).toEqual({ x: 30, z: 10, w: 2, d: 2 });
    // water where the nearest lot would stand: the next one along the road
    st.water[st.idx(12, 11)] = 1;
    st.water[st.idx(13, 11)] = 1;
    expect(serviceLot(st, fire, 12, 14)).toEqual({ x: 10, z: 11, w: 2, d: 2 });
    // no road within six cells: no lot (the city-wide estimate stands in)
    expect(serviceLot(st, fire, 12, 20)).toBeNull();
    expect(serviceLot(newState(16), fire, 8, 8)).toBeNull();
  });

  it('quotedUpkeep: the spot\'s "Upkeep here"; without one the city-wide estimate, as the plop tip starts; a flat-upkeep building its catalog figure', () => {
    const st = newState(32);
    st.systemData.infraVersion = 1; // (a city that charges running costs: the Fire Station's typical ≈§539 a month)
    expect(upkeepEstimate(st, fire)!.now).toBeGreaterThan(fire.upkeep!);
    expect(quotedUpkeep(st, fire, null)).toBe(upkeepEstimate(st, fire)!.now);
    expect(quotedUpkeep(st, fire, 58.5)).toBe(58.5);
    // (a spot no road reaches costs the bare building: still the spot's figure)
    expect(quotedUpkeep(st, fire, 48)).toBe(48);
    const pump = getDef('util_water_pump')!;
    expect(pump.upkeep).toBeGreaterThan(0);
    expect(quotedUpkeep(st, pump, null)).toBe(pump.upkeep);
    expect(quotedUpkeep(st, pump, 999)).toBe(pump.upkeep);
    // an economy-only city charges no running costs: the catalog upkeep, whatever a spot says
    const plain = newState(32);
    expect(upkeepEstimate(plain, fire)).toBeNull();
    expect(quotedUpkeep(plain, fire, 58.5)).toBe(fire.upkeep);
  });

  it('recurringIncome: last month\'s taxes and deals, one-offs left out', () => {
    const st = newState(32);
    expect(recurringIncome(st)).toBe(0);
    expect(recurringIncome(report(st))).toBe(900);
    expect(recurringIncome({ budget: undefined as never })).toBe(0);
  });
});
