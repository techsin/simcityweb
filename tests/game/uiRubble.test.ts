/**
 * Final fixes UI-2 (lane ui): a burnt home or shop gave no instruction — the inspector showed a "Burnt down" chip,
 * "Condition 67% → 82%" and a Make historic button (verify-newplayer-r2 shot 125), and 55 such lots sat in rubble for
 * years, because growth never rebuilds on rubble. The rubble line names the fix: the bulldozer, or the Municipal
 * Demolition Crews ordinance (rubble cleared automatically); while the crews are enacted, that it is in hand.
 * Final fixes r3: in cause-neutral words, "In ruins" (BF.Burnt records no cause: tornado, quake and meteor rubble read
 * "Burnt down"), like a ruined facility's report.
 */
import { describe, expect, it } from 'vitest';
import { BF } from '../../src/sim/CityState';
import { getOrdinance, ordinanceAvailable } from '../../src/sim/economy/ordinances';
import { RUBBLE_CLEAR_DAYS } from '../../src/sim/economy/tuning';
import { RUINS_TEXT, mainProblem, rubbleProblem, type RubbleCrews } from '../../src/ui/inspectorModel';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import { newState, place } from '../infra/cityGen';

const crews = (o: Partial<RubbleCrews> = {}): RubbleCrews => ({ name: 'Municipal Demolition Crews', enacted: false, available: true, unlockPop: 1000, days: 30, ...o });

describe('rubble line (final fixes UI-2)', () => {
  it('names the fix: bulldoze it, or enact the Demolition Crews (Ordinances)', () => {
    const p = rubbleProblem(crews());
    expect(p.text).toBe('In ruins');
    expect(p.hint).toBe('Bulldoze the rubble so the lot can rebuild, or enact Municipal Demolition Crews (Ordinances) to clear rubble automatically');
    expect(p.tone).toBe('bad');
  });

  it('while the crews are enacted: they are clearing it (a warning, not a fix to make)', () => {
    const p = rubbleProblem(crews({ enacted: true }));
    expect(p.text).toBe('In ruins');
    expect(p.hint).toMatch(/^Municipal Demolition Crews are clearing it — the lot can rebuild once the rubble is gone \(within about 30 days\)$/);
    expect(p.tone).toBe('warn');
  });

  it('a town too small for the ordinance: the bulldozer, and when the crews come', () => {
    expect(rubbleProblem(crews({ available: false })).hint).toBe('Bulldoze the rubble so the lot can rebuild (Municipal Demolition Crews, who clear rubble automatically, come with 1,000 residents)');
    // (no such ordinance in the catalog: the bulldozer alone)
    expect(rubbleProblem(null).hint).toBe('Bulldoze the rubble so the lot can rebuild');
  });

  it('the names and numbers come from the real ordinance (economy/ordinances.ts) and the population system\'s rule', () => {
    const o = getOrdinance('rubble_cleanup')!;
    expect(o.name).toBe('Municipal Demolition Crews');
    expect(o.effects['add.rubble.cleanup']).toBeGreaterThan(0);
    expect(RUBBLE_CLEAR_DAYS).toBe(30);
    const st = newState(32);
    st.stats.population = o.unlockPop - 1;
    expect(ordinanceAvailable(st, o)).toBe(false);
    st.stats.population = o.unlockPop;
    expect(ordinanceAvailable(st, o)).toBe(true);
    // the line the inspector builds for this city (InfoPanel.rubbleCrews)
    const line = rubbleProblem({ name: o.name, enacted: st.budget.ordinances.includes(o.id), available: ordinanceAvailable(st, o), unlockPop: o.unlockPop, days: RUBBLE_CLEAR_DAYS });
    expect(line.hint).toContain('enact Municipal Demolition Crews (Ordinances)');
  });

  it('enacted crews do clear a burnt home within the promised days (population system)', () => {
    const st = newState(32);
    st.funds = 1e6;
    st.budget.ordinances.push('rubble_cleanup');
    const b = place(st, 't_r2', 6, 6, { flags: BF.Burnt });
    const sim = new Simulation(st, createSystems());
    let gone = -1;
    for (let d = 1; d <= 60 && gone < 0; d++) { sim.runDays(1); if (!st.buildings.has(b.id)) gone = d; }
    // (31 days on this town: the rubble's clock starts when the population system first sees it)
    expect(gone).toBeGreaterThanOrEqual(RUBBLE_CLEAR_DAYS - 1);
    expect(gone).toBeLessThanOrEqual(RUBBLE_CLEAR_DAYS + 10);
  });

  it('a burnt building whose condition would otherwise lead: the rubble line replaces the condition problem', () => {
    // (InfoPanel passes rubbleProblem instead of mainProblem for a burnt growable and no condition view at all)
    const condition = { bars: [{ id: 'power', label: 'No power', value: -0.5, text: '−0.50' }], target: 0.2, abandon: 'Abandons in 3 days' };
    expect(mainProblem({ condition })?.text).toBe('No power');
    expect(rubbleProblem(crews()).text).toBe(RUINS_TEXT);
  });
});
