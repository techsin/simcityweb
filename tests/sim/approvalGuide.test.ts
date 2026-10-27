/** FH-06 / FH-09: readable monthly terms and the tax cost described by the Budget panel. */
import { describe, expect, it } from 'vitest';
import { approvalBreakdown, approvalSystem } from '../../src/sim/economy/approval';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { Simulation } from '../../src/sim/Simulation';
import { newState, place } from '../infra/cityGen';

function town(rates = [9, 9, 9]) {
  const st = newState(32);
  st.stats.population = 3000;
  st.stats.residents = [1500, 1000, 500];
  rates.forEach((rate, d) => { st.budget.taxRates[d] = rate; });
  const sim = new Simulation(st, [approvalSystem(new EconRuntime())]);
  return { st, sim };
}

describe('approval guide details (FH-06)', () => {
  it('explains the starting score even before the first residents', () => {
    const st = newState(32);
    new Simulation(st, [approvalSystem(new EconRuntime())]);
    expect(approvalBreakdown(st)[0]).toEqual({ id: 'base', label: 'Starting approval', value: 61, detail: 'every city starts at 61' });
  });

  it('explains resident-weighted crime and its fix without changing simulation state', () => {
    const st = newState(32);
    const a = place(st, 't_r1', 4, 4, { pop: 1000 }), b = place(st, 't_r2', 9, 9, { pop: 2000 });
    st.stats.population = 3000;
    st.stats.residents = [1000, 2000, 0];
    st.crime[st.idx(a.x + (a.w >> 1), a.z + (a.d >> 1))] = 0.2;
    st.crime[st.idx(b.x + (b.w >> 1), b.z + (b.d >> 1))] = 0.515;
    new Simulation(st, [approvalSystem(new EconRuntime())]);
    st.stats.avgCrime = 0.9; // the all-occupant average is not the crime experienced at homes
    const before = JSON.stringify({ stats: st.stats, systemData: st.systemData, budget: st.budget });
    const row = approvalBreakdown(st).find((t) => t.id === 'crime')!;
    expect(row.label).toBe('Crime at homes');
    expect(row.detail).toBe('crime at homes 41% — low-wealth homes, uncollected garbage and low land value; police remove up to 85% where they patrol');
    expect(row.value).toBeCloseTo(-12.3, 5);
    expect(JSON.stringify({ stats: st.stats, systemData: st.systemData, budget: st.budget })).toBe(before);
  });

  it('describes the weighted tax rate that produced the monthly term, even after another slider edit', () => {
    const { st } = town([9, 11, 14]);
    st.budget.taxRates.fill(20);
    const row = approvalBreakdown(st).find((t) => t.id === 'tax')!;
    expect(row.value).toBe(-5.25);
    expect(row.detail).toBe('homes are taxed 10.5% on average — each point above 9% costs 3.5 approval; each point below adds 1.5');
  });

  it('explains a below-neutral tax bonus using the same monthly rate', () => {
    const { st } = town([8, 8, 8]);
    const row = approvalBreakdown(st).find((t) => t.id === 'tax')!;
    expect(row.value).toBe(1.5);
    expect(row.detail).toContain('homes are taxed 8% on average');
    expect(row.detail).toContain('each point below adds 1.5');
  });

  it('preserves the Easy new-town grace row', () => {
    const st = newState(32);
    st.config.difficulty = 'easy';
    st.stats.population = 100;
    st.stats.residents = [100, 0, 0];
    place(st, 't_r1', 4, 4, { pop: 100 });
    st.crime.fill(0.8);
    new Simulation(st, [approvalSystem(new EconRuntime())]);
    expect(approvalBreakdown(st).find((t) => t.id === 'crime')).toMatchObject({ value: 0, detail: 'new-town grace' });
  });

  it('reads saved home crime when the monthly penalty still reflects an earlier grace period', () => {
    const st = newState(32);
    st.config.difficulty = 'easy';
    st.stats.population = 8000;
    st.systemData.economy = { approvalTerms: { base: 61, crime: -6.15 }, resCrime: 0.41 };
    expect(approvalBreakdown(st).find((t) => t.id === 'crime')!.detail).toContain('crime at homes 41%');
  });
});

describe('tax approval timing (FH-09)', () => {
  it('11% lowers the raw target by 7 after one month and moves shown approval 88% of the way after six', () => {
    const { st, sim } = town();
    const raw = econData(st).approvalRaw, shown = st.stats.approval;
    st.budget.taxRates.fill(11, 0, 3);
    sim.runDays(30);
    expect(raw - econData(st).approvalRaw).toBeCloseTo(7, 8);
    expect(shown - st.stats.approval).toBeCloseTo(2.1, 8);
    sim.runDays(150);
    expect(raw - econData(st).approvalRaw).toBeCloseTo(7, 8);
    expect((shown - st.stats.approval) / 7).toBeCloseTo(1 - 0.7 ** 6, 8);
  });
});
