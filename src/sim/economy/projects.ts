/** Multi-year construction: whole-money installments buy days of work, without overdrawing the city. */
import { DAYS_PER_MONTH, MONTHS_PER_YEAR } from '../../core/constants';
import type { ActionResult } from '../actions';
import { BF, type Building, type CityState } from '../CityState';
import { getDef } from '../catalog';
import type { BuildingDef, ProjectKind } from '../catalogTypes';
import type { SimSystem, Simulation } from '../Simulation';
import { removeBuilding } from './buildings';
import { formatMoney } from './format';

export const PROJECT_INSTALLMENTS = 'projects:installments';

export interface ProjectProgress {
  buildingId: number;
  def: string;
  kind?: ProjectKind;
  totalCost: number;
  totalDays: number;
  progressDays: number;
  paid: number;
  paidDays: number;
  lastPaymentMonth: number;
  paused: boolean;
  startedDay: number;
  completedDay?: number;
}

/** Optional save key: never created for cities that have not started a project. */
export interface ProjectsData { v: 1; items: ProjectProgress[] }

export function projectList(st: CityState): readonly ProjectProgress[] {
  const d = st.systemData.projects as ProjectsData | undefined;
  return d?.v === 1 && Array.isArray(d.items) ? d.items : [];
}

export function projectProgress(st: CityState, buildingId: number): ProjectProgress | undefined {
  return projectList(st).find((p) => p.buildingId === buildingId);
}

/** Undefined means available. This query does not allocate persistent state or check placement. */
export function projectAvailable(st: CityState, def: BuildingDef): string | undefined {
  if (def.buildMonths === undefined) return undefined;
  if (!Number.isInteger(def.buildMonths) || def.buildMonths <= 0 || !Number.isSafeInteger(def.buildMonths * DAYS_PER_MONTH)
    || !Number.isSafeInteger(def.cost ?? 0) || (def.cost ?? 0) < 0) return 'Invalid project duration or price';
  const gate = def.project;
  if (!gate) return undefined;
  if (gate.kind === 'expo' && projectList(st).some((p) => p.kind === 'expo')) return `${def.name} has already been commissioned`;
  if (st.config.sandbox || st.config.difficulty === 'sandbox') return undefined;
  if (st.stats.population < gate.population) return `Needs ${gate.population.toLocaleString('en-US')} residents`;
  if (gate.education !== undefined && st.stats.eq < gate.education) return `Needs EQ ${gate.education}`;
  if (gate.attractiveness !== undefined && st.stats.attractiveness < gate.attractiveness) return `Needs attractiveness ${gate.attractiveness}`;
  if (gate.stations) {
    let stations = 0;
    for (const b of st.buildings.values()) {
      if (b.def === 'tr_subway_station' && b.built >= 1 && !(b.flags & (BF.Constructing | BF.Burnt | BF.Abandoned))) stations++;
    }
    if (stations < gate.stations) return `Needs ${gate.stations} subway stations`;
  }
  return undefined;
}

/** Telescoping rounded totals make the last installment close at the exact catalog price. */
export function projectInstallment(p: Pick<ProjectProgress, 'totalCost' | 'totalDays' | 'paidDays' | 'paid'>): number {
  const days = Math.min(p.totalDays, p.paidDays + DAYS_PER_MONTH);
  return Math.round(p.totalCost * days / p.totalDays) - p.paid;
}

export function firstProjectInstallment(def: BuildingDef): number {
  return Math.round((def.cost ?? 0) / def.buildMonths!);
}

/** Called by the validated plop branch before buildingAdded is emitted. The action books the cash payment. */
export function beginProject(st: CityState, b: Building, def: BuildingDef): void {
  let d = st.systemData.projects as ProjectsData | undefined;
  if (!d || d.v !== 1 || !Array.isArray(d.items)) st.systemData.projects = d = { v: 1, items: [] };
  d.items.push({
    buildingId: b.id, def: def.id, kind: def.project?.kind, totalCost: def.cost ?? 0,
    totalDays: def.buildMonths! * DAYS_PER_MONTH, progressDays: 0, paid: firstProjectInstallment(def),
    paidDays: DAYS_PER_MONTH, lastPaymentMonth: st.monthIndex, paused: false, startedDay: st.day,
  });
}

function activeBuilding(st: CityState, p: ProjectProgress): Building | undefined {
  const b = st.buildings.get(p.buildingId);
  return b?.def === p.def ? b : undefined;
}

export function nextProjectInstallment(st: CityState): number {
  let total = 0;
  for (const p of projectList(st)) {
    if (p.completedDay === undefined && p.paidDays < p.totalDays && activeBuilding(st, p)) total += projectInstallment(p);
  }
  return total;
}

/** Called after ordinary monthly obligations. Returns actual spending, never the unaffordable forecast. */
export function payProjectInstallments(sim: Simulation): number {
  const st = sim.state;
  const sandbox = !!st.config.sandbox || st.config.difficulty === 'sandbox';
  let paid = 0;
  for (const p of projectList(st)) {
    const b = activeBuilding(st, p);
    if (!b || p.completedDay !== undefined || p.paidDays >= p.totalDays || p.lastPaymentMonth >= st.monthIndex) continue;
    p.lastPaymentMonth = st.monthIndex;
    const cost = projectInstallment(p);
    p.paused = !sandbox && st.funds < cost;
    if (p.paused) continue;
    if (!sandbox) st.funds -= cost;
    p.paid += cost;
    p.paidDays = Math.min(p.totalDays, p.paidDays + DAYS_PER_MONTH);
    paid += cost;
  }
  return paid;
}

/** Half the money actually paid; never the unfinanced catalog price or the site-clearing charge. */
export function projectCancelRefund(st: CityState, buildingId: number): number {
  const p = projectProgress(st, buildingId);
  return p && p.completedDay === undefined ? p.paid * 0.5 : 0;
}

/** Retain completion history (Expo is once per city), discard a cancelled construction contract. */
export function forgetUnfinishedProject(st: CityState, buildingId: number): void {
  const d = st.systemData.projects as ProjectsData | undefined;
  if (d?.v === 1) d.items = d.items.filter((p) => p.buildingId !== buildingId || p.completedDay !== undefined);
}

export function cancelProject(sim: Simulation, buildingId: number, preview = false): ActionResult {
  const st = sim.state, p = projectProgress(st, buildingId);
  const b = p ? activeBuilding(st, p) : undefined;
  if (!p || !b || p.completedDay !== undefined) return { ok: false, cost: 0, reason: 'No unfinished project here' };
  const refund = projectCancelRefund(st, buildingId);
  if (!preview) {
    forgetUnfinishedProject(st, buildingId);
    if (!st.config.sandbox && st.config.difficulty !== 'sandbox') st.funds += refund;
    st.budget.curIncome['oneoff:refund'] = (st.budget.curIncome['oneoff:refund'] ?? 0) + refund;
    removeBuilding(sim, b);
  }
  return { ok: true, cost: -refund, refund, affected: 1 };
}

export function completedProject(st: CityState, kind: ProjectKind): boolean {
  return projectList(st).some((p) => {
    const b = activeBuilding(st, p);
    return p.kind === kind && p.completedDay !== undefined && !!b && b.built >= 1
      && !(b.flags & (BF.Constructing | BF.Burnt | BF.Abandoned));
  });
}

/** Round 3 hook: the opening starts an exact twelve-month draw window. */
export function expoDrawMultiplier(st: CityState): number {
  for (const p of projectList(st)) {
    if (p.kind !== 'expo' || p.completedDay === undefined || st.day < p.completedDay
      || st.day >= p.completedDay + DAYS_PER_MONTH * MONTHS_PER_YEAR) continue;
    const b = activeBuilding(st, p);
    if (b && b.built >= 1 && !(b.flags & (BF.Constructing | BF.Burnt | BF.Abandoned))) return 1.5;
  }
  return 1;
}

export function projectPauseReason(st: CityState, buildingId: number): string | undefined {
  const p = projectProgress(st, buildingId);
  return p?.paused ? `Paused: needs ${formatMoney(projectInstallment(p))} this month` : undefined;
}

export function projectsSystem(): SimSystem {
  return {
    name: 'economy.projects',
    daily(sim) {
      const st = sim.state;
      for (const p of projectList(st)) {
        const b = activeBuilding(st, p);
        if (!b && p.completedDay === undefined) { forgetUnfinishedProject(st, p.buildingId); continue; }
        if (!b || p.completedDay !== undefined || p.paused || p.progressDays >= p.paidDays
          || b.flags & (BF.Burnt | BF.Abandoned | BF.OnFire)) continue;
        const quarter = Math.floor(p.progressDays * 4 / p.totalDays);
        p.progressDays++;
        b.built = Math.fround(p.progressDays / p.totalDays);
        if (p.progressDays === p.totalDays) {
          b.built = 1;
          b.flags &= ~BF.Constructing;
          b.capacity = getDef(p.def)?.jobs ?? 0;
          p.completedDay = st.day;
          p.paused = false;
          sim.events.emit('buildingChanged', b);
          sim.notify(`${getDef(p.def)?.name ?? p.def} opens in ${st.config.name}!`, 'good', b.x + (b.w >> 1), b.z + (b.d >> 1), 'planning');
        } else if (Math.floor(p.progressDays * 4 / p.totalDays) !== quarter) sim.events.emit('buildingChanged', b);
      }
    },
  };
}
