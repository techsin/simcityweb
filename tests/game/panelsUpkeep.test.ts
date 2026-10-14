/**
 * Final fixes P3 / N6 (panels part) and A4, lane ui-panels:
 *  P3 — upkeep and income disagreed by up to 9x between the build menu (a typical-load figure that ignored the city),
 *       the Rewards panel (the catalog upkeep) and the inspector (the actual cost). upkeepEstimate gives the build menu,
 *       its tooltip and the Rewards panel one estimate — what one more costs in this city now, and "up to §B at full
 *       use" — worded like the facility facts (facilities.ts) and the plop tool; the inspector header shows the
 *       report's actual upkeep AND income rows.
 *  A4 — the inspector showed a tier facility's staff twice (header "Jobs filled" bar + Facility "Staff" bar) and its
 *       upkeep twice: splitFacilityRows hands Staff / Upkeep / Income to the header and the rest to the section.
 */
import { describe, expect, it } from 'vitest';
import { getDef } from '../../src/sim/catalog';
import { expectedUpkeep, buildingUpkeep, opexRateOf } from '../../src/sim/economy/opex';
import { facilityDefFacts, fullUseUpkeep } from '../../src/sim/infra/facilities';
import { headerMoney, splitFacilityRows, type ModelRow } from '../../src/ui/inspectorModel';
import { upkeepEstimate } from '../../src/ui/upkeepModel';
import { newState } from '../infra/cityGen';

/** a city whose services system runs (running costs per person served) with a small unserved elementary need */
function city() {
  const st = newState(32);
  st.systemData.infraVersion = 1;
  const needs = st.stats.needs as unknown as Record<string, { need: number; served: number }>;
  needs.elementary = { ...needs.elementary, need: 2000, served: 1900 };
  needs.college = { ...needs.college, need: 50000, served: 0 };
  return st;
}

describe('upkeepEstimate (final fixes P3): one estimate in the build menu, its tooltip and the Rewards panel', () => {
  it('what one more costs in this city now, and the most it can cost at full use', () => {
    const st = city();
    const school = getDef('civ_elementary_school')!;
    const e = upkeepEstimate(st, school)!;
    expect(e.now).toBeCloseTo(expectedUpkeep(st, school), 6);
    expect(e.full).toBeCloseTo(fullUseUpkeep(school), 6);
    // a full school is never above the full-use figure (the elementary case read "≈§702" against §949 actual)
    const r = opexRateOf(school)!;
    expect(e.full).toBeGreaterThanOrEqual(buildingUpkeep(st, school) + (school.coverage!.capacity ?? 0) * r.rate - 1e-6);
    // a city with little unserved need: well below full use
    expect(e.now).toBeLessThan(e.full);
    // the same wording as the facility facts' hint ("≈§A/mo now · up to §B at full use")
    const fact = facilityDefFacts(school.id, st).find((f) => f.key === 'upkeep')!;
    expect(fact.hint).toBe(e.title);
    expect(e.title).toMatch(/^≈§[\d,]+\/mo now · up to §[\d,]+ at full use$/);
  });
  it('the estimate follows the city: a big unserved need costs more than a served one', () => {
    const st = city();
    const lib = [getDef('civ_college'), getDef('civ_library'), getDef('civ_university')].find((d) => d && upkeepEstimate(st, d));
    const school = getDef('civ_elementary_school')!;
    const served = upkeepEstimate(st, school)!.now;
    const needs = st.stats.needs as unknown as Record<string, { need: number; served: number }>;
    needs.elementary = { ...needs.elementary, need: 50000, served: 0 };
    expect(upkeepEstimate(st, school)!.now).toBeGreaterThan(served);
    if (lib) expect(upkeepEstimate(st, lib)!.now).toBeLessThanOrEqual(upkeepEstimate(st, lib)!.full);
  });
  it('flat-upkeep defs (venues with income, utilities, rewards) keep the catalog figure: no estimate', () => {
    const st = city();
    for (const id of ['util_coal_plant', 'tr_airport_small', 'park_zoo']) {
      const d = getDef(id);
      if (d) expect(upkeepEstimate(st, d)).toBeNull();
    }
    expect(upkeepEstimate(st, undefined)).toBeNull();
  });
  it('a city that charges no running costs (an economy-only simulation) pays the flat upkeep: no estimate', () => {
    const st = newState(32);
    expect(upkeepEstimate(st, getDef('civ_elementary_school'))).toBeNull();
    // (without a city — a static listing — the estimate is the typical one)
    expect(upkeepEstimate(null, getDef('civ_elementary_school'))).not.toBeNull();
  });
});

describe('inspector header rows (final fixes A4 / P3)', () => {
  const row = (key: string, label: string, value: string, extra: Partial<ModelRow> = {}): ModelRow => ({ key, label, value, ...extra });
  it('a tier facility: Staff, Upkeep and Income go to the header, the rest to the Facility section', () => {
    const rows = [
      row('seats', 'Pupils', '860 / 1,500 (57%)', { ratio: 0.57 }),
      row('quality', 'Service quality', '110%'),
      row('staff', 'Staff', '40 / 40', { ratio: 1, status: 'ok' }),
      row('upkeep', 'Upkeep', '§925 / month', { hint: 'Building §72 + its share of the running costs §853' }),
    ];
    const s = splitFacilityRows(rows);
    expect(s.staff?.value).toBe('40 / 40');
    expect(s.upkeep?.hint).toContain('Building §72');
    expect(s.income).toBeNull();
    expect(s.rest.map((r) => r.key)).toEqual(['seats', 'quality']);
  });
  it('a venue: the actual income row (not the catalog income); a plain "Jobs filled" line stays out', () => {
    const rows = [
      row('jobs', 'Jobs filled', '250 / 250', { ratio: 1 }),
      row('jobs2', 'Jobs filled', '12 / 250', { hint: 'All employers are 40% staffed — the city needs more workers' }),
      row('income', 'Income', '§960 / month'),
      row('upkeep', 'Upkeep', '§800 / month'),
    ];
    const s = splitFacilityRows(rows);
    expect(s.staff).toBeNull();
    expect(s.income?.value).toBe('§960 / month');
    expect(s.rest.map((r) => r.key)).toEqual(['jobs2']);
    expect(headerMoney(s.income!.value, true)).toBe('+§960/mo');
    expect(headerMoney(s.upkeep!.value)).toBe('§800/mo');
    expect(headerMoney('§1,021 / month (80% funding)')).toBe('§1,021/mo (80% funding)');
    expect(headerMoney('none while it is closed', true)).toBe('none while it is closed');
  });
});
