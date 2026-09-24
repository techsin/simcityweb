/**
 * Budget (monthly): taxes, building upkeep by service bucket × funding, network maintenance, ordinances,
 * facility / business-deal income, loan payments, bankruptcy warnings and strikes.
 *
 * BUDGET KEYS (state.budget.lastIncome / lastExpense; stable, documented for the UI):
 *  income:  'tax:R$' 'tax:R$$' 'tax:R$$$' 'tax:CS$' 'tax:CS$$' 'tax:CS$$$' 'tax:CO$$' 'tax:CO$$$'
 *           'tax:I-Ag' 'tax:I-D' 'tax:I-M' 'tax:I-HT'                      (DEV_TYPE_LABELS)
 *           'deal:<defId>'      business deals / reward buildings with income (military base, casino…)
 *           'facility:<defId>'  other buildings with income (airports, stadium, zoo, seaport…); tourist venues earn
 *                               × (0.35 + 0.65 × visits / draw) × (A/60)^0.3 (SIM_DEPTH_SPEC WP4) × use factor (WP7);
 *                               nothing while the venue is closed (unpowered, no road, unfunded, on strike)
 *           'tourism'           tourist spending: effective tourists × 0.25 × (avg CS tax / 9)       (WP4)
 *           'recycling'         recycled material sales: tons recycled × 0.5                          (WP4 / WP3)
 *           'ordinance:<id>'    revenue ordinances (legalized gambling, parking fines)
 *           'oneoff:loan'       loan proceeds          'oneoff:refund'  bulldoze refunds
 *  expense: 'service:police' 'service:fire' 'service:health' 'service:education' 'service:transit'
 *           'service:parks' 'service:utilities' 'service:roads' 'service:civic' (no funding slider)
 *           'transport:streets' 'transport:roads' 'transport:oneway' 'transport:avenues' 'transport:highways'
 *           'transport:bridges' 'transport:rail' 'transport:subway'
 *           'utilities:powerlines' 'utilities:landfill'
 *           'ordinance:<id>'    'loan' (all loan payments)
 *           'oneoff:construction' 'oneoff:zoning' 'oneoff:demolition' 'oneoff:terraform' 'oneoff:loanRepay'
 *  'oneoff:*' entries were paid / received immediately when the action happened; everything else is settled on
 *  the first day of the month. Σ lastIncome − Σ lastExpense = change of funds over the month.
 */
import type { SimSystem, Simulation } from '../Simulation';
import { BF, type CityState } from '../CityState';
import { DEV_TYPE_LABELS, Network, Zone } from '../../core/types';
import type { ServiceKind } from '../catalogTypes';
import { getDef } from '../catalog';
import {
  BANKRUPT_MONTHS, BANKRUPT_WARN_MONTHS, BRIDGE_UPKEEP_MUL, DIFFICULTY_INCOME, LANDFILL_UPKEEP, NETWORK_UPKEEP, POWERLINE_UPKEEP,
  RECYCLING_INCOME_PER_T, STRIKE_FUNDING, SUBWAY_UPKEEP, TAX_NEUTRAL, TAX_PER_JOB, TAX_PER_RES, TOURISM, TOURISM_INCOME_PER_VISITOR,
  UTIL_FIXED, VENUE_INCOME,
} from './tuning';
import { type EconRuntime, econData, infraFlags } from './runtime';
import { ORDINANCES, ordinanceEffect, ordinanceMonthly } from './ordinances';
import { payLoansMonthly } from './loans';
import { ATTRACTIONS, venueVisits } from './tourism';
import { facilityUseFactor } from '../infra/facilities';

const NET_KEY: Record<number, string> = {
  [Network.Street]: 'transport:streets',
  [Network.Road]: 'transport:roads',
  [Network.OneWay]: 'transport:oneway',
  [Network.Avenue]: 'transport:avenues',
  [Network.Highway]: 'transport:highways',
  [Network.Rail]: 'transport:rail',
};

/**
 * Service effectiveness multiplier for sim-infra (coverage strength): funding scaling with diminishing returns,
 * 0 while the service is on strike. funding 100% → 1, 50% → ~0.62, 150% → ~1.18.
 */
export function serviceEffectiveness(state: CityState, service: ServiceKind): number {
  const d = econData(state);
  if ((d.strikes[service] ?? 0) > 0) return 0;
  const f = (state.budget.funding[service] ?? 100) / 100;
  return Math.pow(Math.max(0, f), 0.7);
}

/** true when a service is currently on strike */
export function onStrike(state: CityState, service: ServiceKind): boolean {
  return (econData(state).strikes[service] ?? 0) > 0;
}

/** Estimate utility supply / demand from the catalog when sim-infra's utilities system is absent. */
export function estimateUtilities(st: CityState, rt: EconRuntime): void {
  let pOut = 0, pUse = 0, wOut = 0, wUse = 0, gCap = 0, gProd = 0;
  for (const b of st.buildings.values()) {
    if (b.flags & (BF.Burnt | BF.Abandoned)) continue;
    const def = getDef(b.def);
    if (!def) continue;
    if (b.flags & BF.Plopped) {
      pOut += def.powerOut ?? 0;
      wOut += def.waterOut ?? 0;
      gCap += def.garbageCapacity ?? 0;
      pUse += def.powerUse ?? 0;
      wUse += def.waterUse ?? 0;
    } else {
      if (b.flags & BF.Constructing) continue;
      const occ = b.capacity > 0 ? (b.pop + b.jobs) / b.capacity : 0;
      pUse += (def.powerUse ?? 0) * occ;
      wUse += (def.waterUse ?? 0) * occ;
      gProd += (def.pollution?.garbage ?? 0) * occ;
    }
  }
  const lf = getDef('util_landfill_tile')?.garbageCapacity ?? 0;
  for (let i = 0; i < st.cells; i++) if (st.zone[i] === Zone.Landfill) gCap += lf;
  const s = st.stats;
  s.powerSupply = pOut;
  s.powerDemand = pUse * ordinanceEffect(st, 'power.demand');
  s.waterSupply = wOut;
  s.waterDemand = wUse * ordinanceEffect(st, 'water.demand');
  s.garbageCapacity = gCap;
  s.garbageProduced = gProd * ordinanceEffect(st, 'garbage.produced');
  void rt;
}

/**
 * Income multiplier of a tourist venue from its visits (WP4): (0.35 + 0.65 × min(1.25, visits / draw)) × (A/60)^0.3.
 * Normalised by the venue's reference draw (visits at attractiveness 60 in a big, well connected city), so a normally
 * visited venue earns its catalog income; 0 while it is closed (unpowered, no road, unfunded or on strike: op 0).
 * 1 when the tourism system has not run (economy-less tools, old saves) or the venue opened after its last update.
 */
export function venueIncomeFactor(st: CityState, buildingId: number, defId: string): number {
  const a = ATTRACTIONS[defId];
  if (!a) return 1;
  const v = venueVisits(st, buildingId);
  if (!v) return 1;
  if (v.op <= 0) return 0;
  const A = (st.systemData.economy as { attractiveness?: number } | undefined)?.attractiveness ?? TOURISM.aRef;
  const aF = Math.pow(Math.min(1.5, Math.max(0.5, A / TOURISM.aRef)), VENUE_INCOME.aExp);
  return (VENUE_INCOME.base + VENUE_INCOME.use * Math.min(VENUE_INCOME.useMax, v.visits / a.draw)) * aF;
}

export interface BudgetBreakdown {
  income: Record<string, number>;
  expense: Record<string, number>;
  totalIncome: number;
  totalExpense: number;
}

/** Compute the recurring monthly budget at current state (does not mutate). Used by the UI for forecasts too. */
export function computeMonthlyBudget(st: CityState, rt: EconRuntime | null): BudgetBreakdown {
  const income: Record<string, number> = {};
  const expense: Record<string, number> = {};
  const add = (o: Record<string, number>, k: string, v: number) => { if (v) o[k] = (o[k] ?? 0) + v; };
  const rates = st.budget.taxRates;
  const mul = DIFFICULTY_INCOME[st.config.difficulty] ?? 1;
  const s = st.stats;
  // ---- taxes
  for (let w = 0; w < 3; w++) add(income, 'tax:' + DEV_TYPE_LABELS[w], s.residents[w] * TAX_PER_RES[w] * rates[w] * mul);
  for (let d = 3; d < 12; d++) add(income, 'tax:' + DEV_TYPE_LABELS[d], s.jobsByDev[d] * TAX_PER_JOB[d] * rates[d] * mul);
  // ---- buildings
  const funding = st.budget.funding;
  const powerUtil = s.powerSupply > 0 ? Math.min(1, s.powerDemand / s.powerSupply) : 0;
  const waterUtil = s.waterSupply > 0 ? Math.min(1, s.waterDemand / s.waterSupply) : 0;
  const plopped = rt ? rt.plopped : [...st.buildings.values()].filter((b) => b.flags & BF.Plopped);
  for (const b of plopped) {
    if (!st.buildings.has(b.id)) continue;
    const def = getDef(b.def);
    if (!def) continue;
    let up = def.upkeep ?? 0;
    if (def.powerOut && def.category === 'power') up *= UTIL_FIXED + (1 - UTIL_FIXED) * powerUtil;
    else if (def.waterOut && def.category === 'water') up *= UTIL_FIXED + (1 - UTIL_FIXED) * waterUtil;
    if (def.service) add(expense, 'service:' + def.service, up * (funding[def.service] ?? 100) / 100);
    else add(expense, 'service:civic', up);
    if (def.income && !(b.flags & BF.Burnt)) {
      const deal = def.category === 'reward';
      add(income, (deal ? 'deal:' : 'facility:') + def.id, def.income * (deal ? 1 : venueIncomeFactor(st, b.id, def.id)) * facilityUseFactor(st, b));
    }
  }
  // ---- tourism (WP4): tourist spending taxed like shops; recycled material sales (WP3 writes stats.garbageRecycled)
  const tourists = (st.systemData.economy as { tourists?: number } | undefined)?.tourists ?? 0;
  if (tourists > 0) add(income, 'tourism', tourists * TOURISM_INCOME_PER_VISITOR * ((rates[3] + rates[4] + rates[5]) / 3 / TAX_NEUTRAL) * mul);
  if (s.garbageRecycled > 0) add(income, 'recycling', s.garbageRecycled * RECYCLING_INCOME_PER_T);
  // ---- networks
  const N = st.cells;
  const counts = new Float64Array(8);
  let bridges = 0, powerLines = 0, subway = 0, landfill = 0;
  for (let i = 0; i < N; i++) {
    const n = st.network[i];
    if (n) {
      if (st.netFlags[i] & 1) bridges += NETWORK_UPKEEP[n] ?? 0;
      else counts[n]++;
      if (st.netFlags[i] & 0x20) counts[Network.Rail]++;
    }
    if (st.powerLines[i]) powerLines++;
    if (st.subway[i]) subway++;
    if (st.zone[i] === Zone.Landfill) landfill++;
  }
  const roadsF = (funding.roads ?? 100) / 100, transitF = (funding.transit ?? 100) / 100, utilF = (funding.utilities ?? 100) / 100;
  for (let n = 1; n <= 6; n++) add(expense, NET_KEY[n], counts[n] * NETWORK_UPKEEP[n] * (n === Network.Rail ? transitF : roadsF));
  add(expense, 'transport:bridges', bridges * BRIDGE_UPKEEP_MUL * roadsF);
  add(expense, 'transport:subway', subway * SUBWAY_UPKEEP * transitF);
  add(expense, 'utilities:powerlines', powerLines * POWERLINE_UPKEEP * utilF);
  add(expense, 'utilities:landfill', landfill * LANDFILL_UPKEEP * utilF);
  // ---- ordinances
  for (const o of ORDINANCES) {
    if (!st.budget.ordinances.includes(o.id)) continue;
    const m = ordinanceMonthly(o, s.population);
    if (m < 0) add(income, 'ordinance:' + o.id, -m);
    else add(expense, 'ordinance:' + o.id, m);
  }
  // ---- loans (payment preview)
  let loan = 0;
  for (const l of st.budget.loans) loan += Math.min(l.monthlyPayment, l.remaining * (1 + l.rate / 12));
  add(expense, 'loan', loan);
  for (const k in income) income[k] = Math.round(income[k]);
  for (const k in expense) expense[k] = Math.round(expense[k]);
  let ti = 0, te = 0;
  for (const k in income) ti += income[k];
  for (const k in expense) te += expense[k];
  return { income, expense, totalIncome: ti, totalExpense: te };
}

export function budgetSystem(rt: EconRuntime): SimSystem {
  const settle = (sim: Simulation) => {
    const st = sim.state;
    const data = econData(st);
    if (!infraFlags(st).utilities) estimateUtilities(st, rt);
    const bd = computeMonthlyBudget(st, rt);
    // actual loan payments (amortization mutates loans)
    delete bd.expense.loan;
    const paid = payLoansMonthly(st);
    if (paid) bd.expense.loan = Math.round(paid);
    let ti = 0, te = 0;
    for (const k in bd.income) ti += bd.income[k];
    for (const k in bd.expense) te += bd.expense[k];
    const sandbox = !!st.config.sandbox;
    if (!sandbox) st.funds += ti - te;
    else st.funds = Math.max(st.funds, st.config.startFunds);
    // merge one-offs into last month's record
    const b = st.budget;
    b.lastIncome = { ...bd.income };
    b.lastExpense = { ...bd.expense };
    for (const k in b.curIncome) b.lastIncome[k] = Math.round((b.lastIncome[k] ?? 0) + b.curIncome[k]);
    for (const k in b.curExpense) b.lastExpense[k] = Math.round((b.lastExpense[k] ?? 0) + b.curExpense[k]);
    b.curIncome = {};
    b.curExpense = {};
    data.lastNet = ti - te;
    // ---- bankruptcy
    if (!sandbox && st.funds < 0) {
      data.monthsNegative++;
      const m = data.monthsNegative;
      if (BANKRUPT_WARN_MONTHS.includes(m)) {
        sim.notify(
          m === 1 ? 'We are in the red! Cut expenses, raise taxes or take a loan.'
            : m === 3 ? 'Three months of debt. The bank is getting nervous — consider a loan and trimming services.'
              : 'Six months in debt! Bankruptcy looms. Raise taxes and cut spending now!',
          'warning', undefined, undefined, 'finance');
      }
      if (m >= BANKRUPT_MONTHS && !data.bankrupt) {
        data.bankrupt = true;
        sim.notify('The city is BANKRUPT. The council demands immediate action (taxes, cuts, loans).', 'disaster', undefined, undefined, 'finance');
      }
    } else {
      if (data.bankrupt && st.funds >= 0) sim.notify('We are out of debt. Bankruptcy averted!', 'good', undefined, undefined, 'finance');
      data.monthsNegative = 0;
      data.bankrupt = false;
    }
    // ---- strikes (funding below STRIKE_FUNDING)
    const services: ServiceKind[] = ['police', 'fire', 'health', 'education', 'transit'];
    for (const sv of services) {
      const f = b.funding[sv] ?? 100;
      const cur = data.strikes[sv] ?? 0;
      if (cur > 0) {
        data.strikes[sv] = cur - 1;
        if (cur - 1 === 0) sim.notify(`The ${sv} strike is over.`, 'info', undefined, undefined, 'safety');
      } else if (f < STRIKE_FUNDING && st.stats.population > 500 && sim.rng.chance(((STRIKE_FUNDING - f) / STRIKE_FUNDING) * 0.5)) {
        data.strikes[sv] = 1 + sim.rng.int(0, 2);
        sim.notify(`${sv[0].toUpperCase() + sv.slice(1)} workers are on strike over budget cuts!`, 'bad', undefined, undefined, sv === 'police' || sv === 'fire' ? 'safety' : sv === 'transit' ? 'transport' : 'health');
      }
    }
  };
  return {
    name: 'economy.budget',
    init(sim) {
      rt.attach(sim);
      if (!infraFlags(sim.state).utilities) estimateUtilities(sim.state, rt);
    },
    daily(sim) {
      // keep utility estimates fresh for the UI when sim-infra is absent (weekly)
      if (sim.state.day % 7 === 0 && !infraFlags(sim.state).utilities) estimateUtilities(sim.state, rt);
    },
    monthly(sim) {
      const t0 = performance.now();
      settle(sim);
      rt.timing.budget = performance.now() - t0;
    },
  };
}
