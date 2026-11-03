/**
 * Monthly history → state.history (cap HISTORY_CAP points; oldest dropped).
 * SIM_DEPTH_SPEC series (WP5, docs/SIM_DEPTH_PART_B.md critic item 32; the graphs and the stats panel read the same):
 *   kids .. seniors      residents per cohort (stats.cohorts)
 *   unemployment         stats.unemployment · commute = avgCommute (minutes)
 *   noise / air / waterPoll   resident-weighted avgNoise / avgAir / avgWaterPollution
 *   garbageLoad          produced / max(1, capacity)
 *   powerMargin / waterMargin (supply − demand) / max(1, demand), clamped −1..1
 *   tourists, attractiveness
 *   enrolElem / enrolHigh / enrolCollege / healthServed   served / need (0 without need)
 *   incidents            Σ lastMonth.count · responseMin = Σ responseMin / Σ responses (mean over responders)
 *   emergencyDeaths      lastMonth.deaths · jailOccupancy = justice.occupancy
 *   busLoad              busesNeeded / max(1, buses) · parkRide = transitFleet.parkRide
 */
import type { SimSystem } from '../Simulation';
import { BF, INCIDENT_KINDS, RESPONDERS, YEAR_REVIEW_TERMS, padHistory, type CityState, type HistorySeries, type NeedStat, type YearReviewGoals, type YearReviewTerm } from '../CityState';
import { DevType } from '../../core/types';
import { getDef } from '../catalog';
import { CITY_RANKS } from './rewards';
import type { EconData } from './runtime';

export const HISTORY_CAP = 600;

function avg(a: number[], i0: number, i1: number): number {
  let s = 0;
  for (let i = i0; i <= i1; i++) s += a[i];
  return s / (i1 - i0 + 1);
}

export function recordHistory(st: CityState): void {
  const h = st.history;
  const s = st.stats;
  // every series aligned with t before this month's values (old saves / series added since: zero-padded)
  padHistory(h);
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
  recordDepthSeries(st, h);
  recordReviewSeries(st, h);
  // padHistory zero-fills series nobody wrote this month (old saves, new keys)
  padHistory(h);
  if (h.t.length > HISTORY_CAP) {
    const drop = h.t.length - HISTORY_CAP;
    for (const k of Object.keys(h) as (keyof typeof h)[]) h[k].splice(0, drop);
  }
}
function round3(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0;
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const fin = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** served / need of a need tier (0 without need) */
export function servedShare(n: NeedStat | undefined): number {
  return n && n.need > 0 ? clamp(n.served / n.need, 0, 1) : 0;
}
/** utility margin (supply − demand) / max(1, demand), clamped −1..1 */
export function utilityMargin(supply: number, demand: number): number {
  return clamp((fin(supply) - fin(demand)) / Math.max(1, fin(demand)), -1, 1);
}

/** push this month's value of every SIM_DEPTH_SPEC series (see the header for the definitions) */
function recordDepthSeries(st: CityState, h: HistorySeries): void {
  const s = st.stats;
  const co = s.cohorts ?? [0, 0, 0, 0, 0];
  h.kids.push(Math.round(fin(co[0])));
  h.teens.push(Math.round(fin(co[1])));
  h.youngAdults.push(Math.round(fin(co[2])));
  h.adults.push(Math.round(fin(co[3])));
  h.seniors.push(Math.round(fin(co[4])));
  h.unemployment.push(round3(fin(s.unemployment)));
  h.commute.push(round3(fin(s.avgCommute)));
  h.noise.push(round3(fin(s.avgNoise)));
  h.air.push(round3(fin(s.avgAir)));
  h.waterPoll.push(round3(fin(s.avgWaterPollution)));
  h.garbageLoad.push(round3(fin(s.garbageProduced) / Math.max(1, fin(s.garbageCapacity))));
  h.powerMargin.push(round3(utilityMargin(s.powerSupply, s.powerDemand)));
  h.waterMargin.push(round3(utilityMargin(s.waterSupply, s.waterDemand)));
  h.tourists.push(Math.round(fin(s.tourists)));
  h.attractiveness.push(round3(fin(s.attractiveness)));
  const nd = s.needs;
  h.enrolElem.push(round3(servedShare(nd?.elementary)));
  h.enrolHigh.push(round3(servedShare(nd?.high)));
  h.enrolCollege.push(round3(servedShare(nd?.college)));
  h.healthServed.push(round3(servedShare(nd?.health)));
  const em = s.emergency?.lastMonth;
  let inc = 0, mins = 0, resp = 0;
  if (em) {
    for (const k of INCIDENT_KINDS) inc += fin(em.count?.[k]);
    for (const r of RESPONDERS) {
      mins += fin(em.responseMin?.[r]);
      resp += fin(em.responses?.[r]);
    }
  }
  h.incidents.push(Math.round(inc));
  h.responseMin.push(round3(resp > 0 ? mins / resp : 0));
  h.emergencyDeaths.push(Math.round(fin(em?.deaths)));
  h.jailOccupancy.push(round3(fin(s.justice?.occupancy)));
  const tf = s.transitFleet;
  h.busLoad.push(round3(fin(tf?.busesNeeded) / Math.max(1, fin(tf?.buses))));
  h.parkRide.push(Math.round(fin(tf?.parkRide)));
}

export interface YearReviewBaseline {
  month: number;
  values: Record<'pop' | 'funds' | 'approval' | 'tourists' | 'eq' | 'hq', number>;
  approvalTerms: Partial<Record<YearReviewTerm, number>>;
}

type ReviewEconomy = Partial<EconData> & { yearReviewGoals?: YearReviewGoals; yearReviewBaseline?: YearReviewBaseline };

/** The founding snapshot is separate from monthly history, so Graphs keeps its existing sample window. */
function seedReviewBaseline(st: CityState): void {
  const data = st.systemData.economy as ReviewEconomy | undefined;
  const founded = typeof st.systemData.foundedDay === 'number' ? st.systemData.foundedDay : 0;
  if (!data?.approvalTerms || data.yearReviewBaseline || st.day !== founded || st.history.t.length) return;
  const s = st.stats;
  data.yearReviewBaseline = {
    month: st.monthIndex,
    values: { pop: s.population, funds: Math.round(st.funds), approval: Math.round(s.approval), tourists: Math.round(s.tourists), eq: Math.round(s.eq), hq: Math.round(s.hq) },
    approvalTerms: Object.fromEntries(YEAR_REVIEW_TERMS.map((id) => [id, fin(data.approvalTerms?.[id])])),
  };
}

/** A January checkpoint supplies its saved approval baseline, without inventing the preceding year's inputs. */
function seedReviewTerms(st: CityState): void {
  if (st.month !== 0 || st.dayOfMonth !== 0) return;
  const i = st.history.t.indexOf(st.monthIndex);
  const data = st.systemData.economy as ReviewEconomy | undefined;
  if (i < 0 || !data?.approvalTerms || st.history.reviewTermsSample?.[i] === 1) return;
  padHistory(st.history);
  for (const id of YEAR_REVIEW_TERMS) st.history[`approval_${id}`][i] = fin(data.approvalTerms[id]);
  st.history.reviewTermsSample[i] = 1;
}

/** Stamp new goals once; opening an existing city must not claim its old goals were completed this year. */
function recordReviewGoals(st: CityState, initial = false): void {
  const data = st.systemData.economy as ReviewEconomy | undefined;
  if (!data) return;
  const seed = initial || !data.yearReviewGoals;
  const goals = data.yearReviewGoals ??= { seen: [], completed: {} };
  const seen = new Set(goals.seen);
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    goals.seen.push(id);
    if (!seed) goals.completed[id] ??= st.monthIndex;
  };
  for (const id of st.unlocked) add(id);
  const ranks = st.systemData.cityRanks as Record<string, boolean> | undefined;
  for (const rank of CITY_RANKS) if (st.stats.population >= rank.population || ranks?.[rank.id]) add(`rank:${rank.id}`);
}

/** Exact monthly inputs for UI-side review reconstruction; no simulation policy or score is stored here. */
function recordReviewSeries(st: CityState, h: HistorySeries): void {
  const data = st.systemData.economy as ReviewEconomy | undefined;
  let income = 0, expense = 0;
  for (const k in st.budget.lastIncome) if (!k.startsWith('oneoff:')) income += st.budget.lastIncome[k];
  for (const k in st.budget.lastExpense) if (!k.startsWith('oneoff:')) expense += st.budget.lastExpense[k];
  let homes = 0, noisy = 0;
  for (const b of st.buildings.values()) {
    if (b.pop <= 0) continue;
    const dev = getDef(b.def)?.devType;
    if (dev === undefined || dev > DevType.R3) continue;
    homes++;
    if (b.flags & BF.Noisy) noisy++;
  }
  const em = st.stats.emergency?.lastMonth;
  // LG-05/T037b owns the producer; absent metadata deliberately keeps growth scoring.
  const advisors = st.systemData.advisors as { builtOut?: boolean } | undefined;
  h.reviewSample.push(data?.approvalTerms && Number.isFinite(data.resCrime)
    && Number.isFinite(data.resServices) && Number.isFinite(data.resParks) ? 1 : 0);
  h.reviewTermsSample.push(data?.approvalTerms ? 1 : 0);
  h.reviewFunds.push(st.funds);
  h.recurringNet.push(income - expense);
  h.recurringExpense.push(expense);
  h.resCrime.push(fin(data?.resCrime));
  h.homeServices.push((4 * fin(data?.resServices) + fin(data?.resParks)) / 5);
  h.noisyHomes.push(homes > 0 ? noisy / homes : 0);
  h.emergencyAnswered.push(fin(em?.auto) + fin(em?.manual));
  h.emergencyFailed.push(fin(em?.failed));
  h.buildingsLost.push(fin(em?.buildingsLost));
  h.builtOut.push(advisors?.builtOut === true ? 1 : 0);
  for (const id of YEAR_REVIEW_TERMS) h[`approval_${id}`].push(fin(data?.approvalTerms?.[id]));
  recordReviewGoals(st);
}

export function historySystem(): SimSystem {
  return {
    name: 'economy.history',
    init(sim) {
      recordReviewGoals(sim.state, true);
      seedReviewBaseline(sim.state);
      seedReviewTerms(sim.state);
    },
    monthly(sim) {
      recordHistory(sim.state);
    },
  };
}
