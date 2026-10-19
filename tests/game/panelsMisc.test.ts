/**
 * Lane ui-panels, final fixes:
 *  P15  the Budget ledger groups lines by the funding slider that scales them (ledgerGroup);
 *  ER1  (routed from emergency r1) the Emergencies panel counts down the player's dispatch window
 *       (dispatchWindowEnd), not the deadline, and stops once a building is lost;
 *  F6   commute by mode in the Statistics panel (commuteModes, stats.commuteByMode read defensively);
 *  50   the park & ride garage defs come from the catalog (GARAGE_DEFS);
 *  51   which graphs label their y-axis as a whole (GraphDef.axis) is pinned;
 *  52   auto-ranged percentage graphs label their ticks with the step's decimals (no "0% 1% 1% 2% 2%");
 *  UI-3 (lane ui, final fixes r2) the inspector's fire row beyond the burn-down window adds what the Fire view says: an
 *       industrial accident there is still saved by a fire truck sent within 3 days, however long the drive.
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
import { FIRE_FAR_NOTE, responseText } from '../../src/ui/inspectorModel';
import { EMG_FIRE, FIRE_TOO_FAR_TEXT, emgNearSlack } from '../../src/sim/infra/overlays';
import { EMERG_GRACE, EMERG_RMAX } from '../../src/sim/infra/params';

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

describe('inspector fire response (final fixes P2): beyond the amber band a fire burns down', () => {
  const near = emgNearSlack(EMG_FIRE);
  it('covered: auto; just out of reach (amber): manual, a truck sent at once still makes it; farther: it burns down', () => {
    expect(near).toBeLessThan(0);
    const fire = { near };
    expect(responseText({ slackMin: 1.5, covered: true }, 'no fire station', fire)).toEqual({ text: 'auto, 1.5 min to spare', tone: 'pos' });
    const amber = responseText({ slackMin: near / 2, covered: false }, 'no fire station', fire)!;
    expect(amber.text).toMatch(/^manual only \(/);
    expect(amber.tone).toBe('warn');
    const far = responseText({ slackMin: near - 1, covered: false }, 'no fire station', fire)!;
    expect(far.text).toMatch(/^too far — a fire burns down before a truck arrives \(\d+\.\d min out of reach\)$/);
    expect(far.tone).toBe('neg');
    expect(responseText({ slackMin: -EMERG_RMAX, covered: false }, 'no fire station', fire)!.text).toBe('too far — a fire burns down before a truck arrives');
    // no road: unreachable whatever the responder; other responders keep the manual wording
    expect(responseText({ slackMin: -EMERG_RMAX, covered: false, hasRoad: false }, 'no fire station', fire)!.text).toBe('unreachable — no road to it');
    expect(responseText({ slackMin: near - 1, covered: false })!.text).toMatch(/^manual only \(/);
  });

  it('final fixes UI-3: beyond the burn-down window the row says an industrial accident is still saved by a truck sent in time', () => {
    const fire = { near };
    // the Fire view's sentence (overlays.FIRE_TOO_FAR_TEXT), its industrial half
    expect(FIRE_FAR_NOTE).toBe(`An industrial accident here is still saved by a fire truck sent within ${EMERG_GRACE.industrial} days, however long the drive — build a fire station closer`);
    expect(FIRE_TOO_FAR_TEXT.toLowerCase()).toContain(FIRE_FAR_NOTE.toLowerCase());
    for (const r of [
      responseText({ slackMin: near - 1, covered: false }, 'no fire station', fire)!,
      responseText({ slackMin: -EMERG_RMAX, covered: false }, 'no fire station', fire)!,
      responseText({ slackMin: near - 1, covered: false, land: true }, 'no fire station', fire)!,
    ]) {
      expect(r.text).toContain('a fire burns down before a truck arrives');
      expect(r.note).toBe(FIRE_FAR_NOTE);
    }
    // covered, in the amber band, unreachable by road, no station, or another responder: no such note
    expect(responseText({ slackMin: 1.5, covered: true }, 'no fire station', fire)!.note).toBeUndefined();
    expect(responseText({ slackMin: near / 2, covered: false }, 'no fire station', fire)!.note).toBeUndefined();
    expect(responseText({ slackMin: -EMERG_RMAX, covered: false, hasRoad: false }, 'no fire station', fire)!.note).toBeUndefined();
    expect(responseText({ slackMin: -99, covered: false }, 'no fire station', fire)!.note).toBeUndefined();
    expect(responseText({ slackMin: near - 1, covered: false }, 'no police station')!.note).toBeUndefined();
  });
});
