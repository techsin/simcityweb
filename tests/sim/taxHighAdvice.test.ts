/**
 * FH-09: the finance advisor's taxHigh warning fires from 11% (the resident-weighted rate approval.ts charges) and says
 * what it costs in approval. Kept beside tests/sim/advisors.test.ts, which sub-lane (b) is editing (POLISH_PLAN §7.4).
 */
import { describe, expect, it } from 'vitest';
import { Simulation } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { TAX_HIGH_ADVICE, advisorIssues, advisorsSystem, type AdvisorsSystem } from '../../src/sim/economy/advisors';
import { newState } from '../infra/cityGen';

function city(rates: number[], residents: [number, number, number] = [2000, 1000, 0]) {
  const st = newState(64);
  st.stats.population = residents[0] + residents[1] + residents[2];
  st.stats.residents = [residents[0], residents[1], residents[2]];
  rates.forEach((r, d) => { st.budget.taxRates[d] = r; });
  const adv = advisorsSystem(new EconRuntime()) as AdvisorsSystem;
  const sim = new Simulation(st, [adv]);
  st.day = 30;
  adv.monthly!(sim);
  const issue = (advisorIssues(st).finance ?? []).find((a) => a.id === 'taxHigh');
  const news = st.news.filter((n) => /Residential taxes average/.test(n.text));
  return { st, issue, news };
}

describe('taxHigh advice (FH-09)', () => {
  it('fires at 11%, not at 10.5%, and names the approval cost', () => {
    expect(TAX_HIGH_ADVICE).toBe(11);
    const { issue, news } = city([11, 11, 11]);
    expect(issue?.text).toBe('Residential taxes average 11.0%. Each point above 9% costs 3.5 approval, so approval heads 7 points lower; higher rates also slow growth.');
    expect(news).toHaveLength(1);
    expect(news[0].kind).toBe('warning');
    expect(news[0].text).toMatch(/approval/);
    expect(city([10.5, 10.5, 10.5]).issue).toBeUndefined();
    // still only from 1,000 residents
    expect(city([14, 14, 14], [600, 400, 0]).issue).toBeUndefined();
  });

  it('weights the rates by residents, as approval does', () => {
    // a plain average of 12 / 9 / 15 is 12, but nobody lives in the 15% tier: 2000 × 12 + 1000 × 9 → 11%
    expect(city([12, 9, 15]).issue?.text).toContain('average 11.0%');
    // the plain average is 11.3, but the residents pay 10%
    expect(city([10, 10, 14]).issue).toBeUndefined();
  });
});
