/** Monthly history → state.history (cap HISTORY_CAP points; oldest dropped). */
import type { SimSystem } from '../Simulation';
import { padHistory, type CityState } from '../CityState';

export const HISTORY_CAP = 600;

function avg(a: number[], i0: number, i1: number): number {
  let s = 0;
  for (let i = i0; i <= i1; i++) s += a[i];
  return s / (i1 - i0 + 1);
}

export function recordHistory(st: CityState): void {
  const h = st.history;
  const s = st.stats;
  let inc = 0, exp = 0;
  for (const k in st.budget.lastIncome) inc += st.budget.lastIncome[k];
  for (const k in st.budget.lastExpense) exp += st.budget.lastExpense[k];
  h.t.push(st.monthIndex);
  h.pop.push(s.population);
  h.funds.push(Math.round(st.funds));
  h.income.push(Math.round(inc));
  h.expense.push(Math.round(exp));
  h.r.push(round3(avg(s.demand, 0, 2)));
  h.c.push(round3(avg(s.demand, 3, 7)));
  h.i.push(round3(avg(s.demand, 8, 11)));
  h.landValue.push(round3(s.avgLandValue));
  h.crime.push(round3(s.avgCrime));
  h.pollution.push(round3(s.avgPollution));
  h.traffic.push(round3(s.avgTraffic));
  h.eq.push(Math.round(s.eq));
  h.hq.push(Math.round(s.hq));
  h.approval.push(Math.round(s.approval));
  // SIM_DEPTH_SPEC series: WP5 pushes its values above this line; padHistory zero-fills series nobody wrote this month
  padHistory(h);
  if (h.t.length > HISTORY_CAP) {
    const drop = h.t.length - HISTORY_CAP;
    for (const k of Object.keys(h) as (keyof typeof h)[]) h[k].splice(0, drop);
  }
}
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function historySystem(): SimSystem {
  return {
    name: 'economy.history',
    monthly(sim) {
      recordHistory(sim.state);
    },
  };
}
