/**
 * Lane ui-panels, final fixes:
 *  P15  the Budget ledger groups lines by the funding slider that scales them (ledgerGroup);
 *  ER1  (routed from emergency r1) the Emergencies panel counts down the player's dispatch window
 *       (dispatchWindowEnd), not the deadline, and stops once a building is lost;
 *  F6   commute by mode in the Statistics panel (commuteModes, stats.commuteByMode read defensively);
 *  50   the park & ride garage defs come from the catalog (GARAGE_DEFS);
 *  51   which graphs label their y-axis as a whole (GraphDef.axis) is pinned;
 *  52   auto-ranged percentage graphs label their ticks with the step's decimals (no "0% 1% 1% 2% 2%").
 */
import { describe, expect, it } from 'vitest';
import { ledgerGroup } from '../../src/ui/panels/BudgetPanel';
import { activeTimeText } from '../../src/ui/panels/EmergenciesPanel';
import { GRAPHS } from '../../src/ui/panels/GraphsPanel';
import { axisTicks, niceAxis, pctAxisLabels } from '../../src/ui/graphAxis';
import { GARAGE_DEFS, commuteModes } from '../../src/ui/statsModel';
import { dispatchWindowEnd, type Incident } from '../../src/sim/infra/emergency';
import { emgTime } from '../../src/ui/EmergencyBanner';
import { getDef } from '../../src/sim/catalog';

describe('Budget ledger groups (final fixes P15)', () => {
  it('each group answers to one funding slider: department buildings and their tiles together, named apart', () => {
    expect(ledgerGroup('service:utilities')).toEqual(['utilities', 'buildings']);
    expect(ledgerGroup('utilities:landfill')).toEqual(['utilities', 'landfill']);
    expect(ledgerGroup('utilities:powerlines')).toEqual(['utilities', 'powerlines']);
    expect(ledgerGroup('service:roads')).toEqual(['roads', 'buildings']);
    expect(ledgerGroup('transport:roads')).toEqual(['roads', 'roads']);
    expect(ledgerGroup('transport:highways')).toEqual(['roads', 'highways']);
    expect(ledgerGroup('transport:rail')).toEqual(['transit', 'rail']);
    expect(ledgerGroup('transport:subway')).toEqual(['transit', 'subway']);
    expect(ledgerGroup('service:transit')).toEqual(['transit', 'buildings']);
    // the rest by key prefix, as before
    expect(ledgerGroup('service:police')).toEqual(['service', 'police']);
    expect(ledgerGroup('tax:R$')).toEqual(['tax', 'R$']);
    expect(ledgerGroup('tourism')).toEqual(['tourism', '']);
    expect(ledgerGroup('loan')).toEqual(['loan', '']);
  });
});

describe('Emergencies panel countdown (routed from emergency r1)', () => {
  const inc = (o: Partial<Incident>): Incident => ({
    id: 1, kind: 'industrial', state: 'uncovered', start: 10, deadline: 22, lost: 0, deaths: 0, saved: 0, injured: 0, radius: 0,
    need: { fire: 1, medical: 1 }, units: [], fires: [], ...o,
  }) as unknown as Incident;
  it('counts down the dispatch window (an industrial accident: until its plant ignites), not the deadline', () => {
    const a = inc({});
    const now = 11;
    expect(dispatchWindowEnd(a)).toBeLessThan(a.deadline);
    const t = activeTimeText(a, now);
    expect(t).toContain(`${emgTime(dispatchWindowEnd(a) - now)} left`);
    expect(t).not.toContain(`${emgTime(a.deadline - now)} left`);
  });
  it('no countdown once a building is lost (the loss shows instead) or the window has passed', () => {
    const f = inc({ kind: 'fire', deadline: 16, lost: 1, need: { fire: 2 }, fires: [3, 4] as unknown as Incident['fires'] });
    const t = activeTimeText(f, 12);
    expect(t).not.toMatch(/left/);
    expect(t).toContain('1 building lost');
    expect(t).toContain('2 burning');
    const late = inc({});
    expect(activeTimeText(late, dispatchWindowEnd(late) + 0.5)).not.toMatch(/left/);
    // a dispatched incident does not count down
    expect(activeTimeText(inc({ state: 'dispatched' }), 11)).not.toMatch(/left/);
  });
});

describe('commute by mode (final fixes F6)', () => {
  it('"Car 9.1 · Transit 14.2 · Walk 6.0 min" and why transit riders accept longer trips; absent data: nothing', () => {
    const m = commuteModes({ car: 9.1, transit: 14.2, walk: 6, transitSaved: -2.4 });
    expect(m.times).toBe('Car 9.1 · Transit 14.2 · Walk 6.0 min');
    expect(m.note).toBe('Transit riders accept longer trips than drivers — 2.4 min more than driving the same trip.');
    expect(commuteModes({ car: 9.1, transit: 14.2, walk: 0, transitSaved: 1.5 }).note).toBe('Transit riders accept longer trips than drivers — it saves them 1.5 min against driving the same trip.');
    expect(commuteModes({ car: 12, transit: 10, walk: 5, transitSaved: 3 }).note).toBe('Transit saves its riders 3.0 min against driving the same trip.');
    expect(commuteModes({ car: 12, walk: 0, transit: 0, transitSaved: 0 })).toEqual({ times: 'Car 12.0 min', note: '' });
    expect(commuteModes(undefined)).toEqual({ times: '', note: '' });
    expect(commuteModes({ car: NaN, transit: 0, walk: 0, transitSaved: 0 })).toEqual({ times: '', note: '' });
  });
});

describe('statsModel garages (routed 50) and graph axes (routed 51)', () => {
  it('the garage defs come from the catalog: the transport buildings the roads service runs', () => {
    expect([...GARAGE_DEFS]).toEqual(['tr_parking_garage']);
    for (const id of GARAGE_DEFS) expect(getDef(id)).toMatchObject({ category: 'transport', service: 'roads' });
  });
  it('the count / money graphs label the whole y-axis in one notation (GraphDef.axis)', () => {
    expect(GRAPHS.filter((g) => g.axis && g.int).map((g) => g.id).sort()).toEqual(['cash', 'demo', 'funds', 'parkRide', 'pop', 'tourism']);
    // the auto-ranged share graphs label theirs in percent with the step's decimals (routed 52); the rest per tick
    expect(GRAPHS.filter((g) => g.axis && !g.int).map((g) => g.id).sort()).toEqual(['busLoad', 'garbage', 'jobs']);
    for (const g of GRAPHS) if (g.axis && !g.int) expect(g.range).toBeUndefined();
  });
});

describe('percentage axes (routed 52): no duplicate tick labels below 2 %', () => {
  it('a 0.5 % step keeps its decimal; whole steps have none; zero reads 0%', () => {
    expect(pctAxisLabels([0, 0.005, 0.01, 0.015, 0.02], 0.005)).toEqual(['0%', '0.5%', '1.0%', '1.5%', '2.0%']);
    expect(pctAxisLabels([0, 0.25, 0.5, 0.75, 1], 0.25)).toEqual(['0%', '25%', '50%', '75%', '100%']);
    expect(pctAxisLabels([0, 0.0025, 0.005], 0.0025)).toEqual(['0%', '0.25%', '0.50%']);
  });
  it('the Bus load / Garbage load / Unemployment graphs on tiny values: every tick label distinct', () => {
    for (const id of ['busLoad', 'garbage', 'jobs']) {
      const g = GRAPHS.find((x) => x.id === id)!;
      for (const hiData of [0.0015, 0.004, 0.018, 0.07, 0.6, 1.3]) {
        const { lo, hi, step } = niceAxis(0, hiData, false, 4);
        const labels = g.axis!(axisTicks(lo, hi, step), step);
        expect(new Set(labels).size).toBe(labels.length);
      }
    }
  });
});
