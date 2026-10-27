/** First-year goals: replica-safe predicates and actions, with host query results supplied by the card. */
import { DAYS_PER_MONTH } from '../../core/constants';
import { DEV_TYPE_LABELS, Overlay, Zone } from '../../core/types';
import { BF, type CityState } from '../../sim/CityState';
import { getDef } from '../../sim/catalog';
import type { BudgetBreakdown } from '../../sim/economy/budget';
import type { LandfillInfo } from '../../sim/infra/pollution';
import type { SimHost } from '../../worker/SimHost';
import { guideCopy } from './copy';
import { toolAction, viewAction, type GuideAction, type GuideHooks } from './coach';
import { isFuelPlant } from './founding';
import { GOAL_IDS, type GoalId, type GuideProgress } from './progress';

export interface GoalFacts {
  noGarbage: boolean;
  brownout: boolean;
  fuelPlants: number;
  services: number;
  policeAtHomes: number;
  fireCovered: number;
  fuelCovered: boolean;
}

/** Refreshed at most once a second, including the NoGarbage counter. */
export function goalFacts(host: Pick<SimHost, 'state' | 'emergency'>): GoalFacts {
  const st = host.state;
  let noGarbage = false, brownout = false, fuelPlants = 0, services = 0;
  let residents = 0, police = 0, buildings = 0, covered = 0, fuelCovered = true;
  const fireReady = host.emergency.active && host.emergency.layersReady;
  for (const b of st.buildings.values()) {
    if (b.flags & BF.Burnt) continue;
    const def = getDef(b.def), cell = (b.z + (b.d >> 1)) * st.size + b.x + (b.w >> 1);
    if (b.flags & BF.NoGarbage) noGarbage = true;
    if (def?.category === 'growable' && def.devType !== undefined && def.devType <= 2 && b.pop > 0) {
      residents += b.pop;
      police += st.policeCov[cell] * b.pop;
      if (!(b.flags & BF.Powered)) brownout = true;
    }
    if (def?.coverage && b.flags & BF.Plopped) services++;
    buildings++;
    const fire = fireReady && st.respFire[cell] >= 0;
    if (fire) covered++;
    if (isFuelPlant(b)) { fuelPlants++; if (!fire) fuelCovered = false; }
  }
  return { noGarbage, brownout, fuelPlants, services, policeAtHomes: residents ? police / residents : 0,
    fireCovered: buildings ? covered / buildings : 0, fuelCovered };
}

export interface GoalInputs {
  state: CityState;
  facts: GoalFacts;
  progress: GuideProgress;
  landfill: readonly LandfillInfo[];
  viewSeconds: number;
}

export function approvalTerms(st: CityState): Record<string, number> {
  return (st.systemData.economy as { approvalTerms?: Record<string, number> } | undefined)?.approvalTerms ?? {};
}

function monthlyNet(st: CityState): number {
  const sum = (lines: Record<string, number>) => Object.entries(lines).reduce((total, [key, value]) => total + (key.startsWith('oneoff:') ? 0 : value), 0);
  return sum(st.budget.lastIncome) - sum(st.budget.lastExpense);
}

export function goalAppears(id: GoalId, { state: st, facts: f, progress: p }: GoalInputs): boolean {
  switch (id) {
    case 'G1': return true;
    case 'G2': return f.noGarbage || st.stats.population >= 300;
    case 'G3': return (approvalTerms(st).crime ?? 0) <= -4 || st.stats.population >= 400;
    case 'G4': return f.fuelPlants > 0 || st.stats.population >= 800;
    case 'G5': return monthlyNet(st) < 0 || f.services >= 2;
    case 'G6': return st.stats.needs.elementary.unreached >= 100;
    case 'G7': return st.stats.population >= 1500;
    case 'G8': return p.completed.includes('G7');
    case 'G9': return p.completed.includes('G1');
    case 'G10': return st.stats.powerDemand > st.stats.powerSupply * 0.8 || f.brownout;
  }
}

export function goalDone(id: GoalId, { state: st, facts: f, progress: p, landfill, viewSeconds }: GoalInputs): boolean {
  switch (id) {
    case 'G1': return st.stats.population >= 500;
    case 'G2': return landfill.some((info) => info.road && info.capacityT > 0);
    case 'G3': return f.policeAtHomes >= 0.5;
    case 'G4': return f.fireCovered >= 0.5 && f.fuelCovered;
    case 'G5': return p.budgetOpened || p.solventMonths >= 2;
    case 'G6': return st.stats.needs.elementary.need > 0 && st.stats.needs.elementary.unreached < st.stats.needs.elementary.need * 0.5;
    case 'G7': return viewSeconds >= 3;
    case 'G8': return p.whyOpened;
    case 'G9': return st.stats.population >= 2500;
    case 'G10': return p.powerMarginSince !== null && st.day - p.powerMarginSince >= DAYS_PER_MONTH
      && st.stats.powerDemand > 0 && st.stats.powerSupply >= st.stats.powerDemand * 1.25 && !f.brownout;
  }
}

/** Count settled recurring budgets, excluding loans, construction and other one-off transactions. */
export function trackBudget(st: CityState, p: GuideProgress): void {
  if (p.lastBudgetMonth === st.monthIndex) return;
  p.solventMonths = monthlyNet(st) < 0 ? 0 : p.lastBudgetMonth === st.monthIndex - 1 ? Math.min(2, p.solventMonths + 1) : 1;
  p.lastBudgetMonth = st.monthIndex;
}

/** Called for each day, so a short outage between card checks resets the full-month margin. */
export function trackPower(st: CityState, p: GuideProgress): void {
  if (!p.started.includes('G10') || p.completed.includes('G10')) return;
  if (st.stats.powerDemand <= 0 || st.stats.powerSupply < st.stats.powerDemand * 1.25) p.powerMarginSince = null;
  else p.powerMarginSince ??= st.day;
}

export function advanceGoals(input: GoalInputs): GoalId[] {
  const { progress: p } = input, fresh: GoalId[] = [];
  for (const id of GOAL_IDS) {
    if (p.completed.includes(id) || (p.phase === 'complete' && id !== 'G10')) continue;
    if (!p.started.includes(id) && goalAppears(id, input)) p.started.push(id);
    if (p.started.includes(id) && goalDone(id, input)) { p.completed.push(id); fresh.push(id); }
  }
  trackPower(input.state, p);
  if (input.facts.brownout) p.powerMarginSince = null;
  return fresh;
}

/** Power warnings take a slot before the long population goals; they cannot wait behind G1 / G9. */
export function visibleGoals(p: GuideProgress): GoalId[] {
  const pending = GOAL_IDS.filter((id) => p.started.includes(id) && !p.completed.includes(id) && (p.phase !== 'complete' || id === 'G10'));
  return [...pending.filter((id) => id === 'G10'), ...pending.filter((id) => id !== 'G10')].slice(0, 2);
}

/** A +1 point estimate from the watched tax lines. Zero-rate taxable groups need FH-05's projection query. */
export function taxPointIncome(st: CityState, budget: BudgetBreakdown | undefined): number | null {
  if (!budget) return null;
  let gain = 0;
  for (let d = 0; d < 12; d++) {
    const rate = st.budget.taxRates[d], count = d < 3 ? st.stats.residents[d] : st.stats.jobsByDev[d];
    if (rate === 0 && count > 0) return null;
    if (rate > 0) gain += (budget.income['tax:' + DEV_TYPE_LABELS[d]] ?? 0) / rate;
  }
  return gain;
}

export function goalPresentation(id: GoalId, st: CityState, budget: BudgetBreakdown | undefined, hooks: GuideHooks): { title: string; text: string[]; action: GuideAction } {
  const c = guideCopy.phaseC, a = guideCopy.actions;
  const query: GuideAction = { label: a.Query(), icon: 'query', coach: { categories: ['query'], control: 'rci' }, run: (ctx) => ctx.tools.select('query') };
  switch (id) {
    case 'G1': return { title: c.G1Title(500), text: [c.G1(), c.G1Query()], action: query };
    case 'G2': return { title: c.G2Title(), text: [c.G2(3, 3)], action: toolAction(a.Landfill(), 'garbage', `zone:${Zone.Landfill}`, 'utilities', 'garbage') };
    case 'G3': return { title: c.G3Title(), text: [c.G3()], action: viewAction(a.Police(), 'police', 'civic', 'police', Overlay.Police) };
    case 'G4': return { title: c.G4Title(), text: [c.G4()], action: viewAction(a.Fire(), 'fire', 'civic', 'fire', Overlay.Emergency) };
    case 'G5': {
      const gain = taxPointIncome(st, budget);
      return { title: c.G5Title(), text: [gain === null ? 'Check your budget before building more services.' : c.G5(gain)],
        action: { label: a.Taxes(), icon: 'budget', coach: { categories: [], control: 'budget' }, run: (ctx) => ctx.panels.open('budget') } };
    }
    case 'G6': return { title: c.G6Title(), text: [c.G6(st.stats)], action: viewAction(a.Education(), 'education', 'civic', 'education', Overlay.Education) };
    case 'G7': return { title: c.G7Title(), text: [c.G7()], action: {
      label: a.Views(), icon: 'layers', coach: { categories: ['dataviews'], control: 'dataviews' }, run: (ctx) => ctx.panels.open('dataviews'),
    } };
    case 'G8': return { title: c.G8Title(), text: [c.G8()], action: { ...query, coach: { categories: ['query'], control: 'why' },
      run: (ctx) => { hooks.openWhy?.(); ctx.tools.select('query'); } } };
    case 'G9': return { title: c.G9Title(), text: [c.G9()], action: {
      label: a.Rewards(), icon: 'reward', coach: { categories: ['landmarks'], control: 'rewards' }, run: (ctx) => ctx.panels.open('rewards'),
    } };
    case 'G10': return { title: c.G10Title(), text: [c.G10(st.stats), c.G10Wind(), c.G10Gas(), c.G10Siting()],
      action: viewAction(a.Power(), 'power', 'utilities', 'power', Overlay.Power) };
  }
}

/** One inspectCell query per connected landfill, not one query per tile. */
export function landfillSites(st: CityState): { x: number; z: number }[] {
  const seen = new Uint8Array(st.cells), out: { x: number; z: number }[] = [];
  const valid = (i: number) => st.zone[i] === Zone.Landfill && st.building[i] < 0 && !st.water[i] && !st.network[i];
  for (let i = 0; i < st.cells; i++) {
    if (seen[i] || !valid(i)) continue;
    out.push({ x: i % st.size, z: Math.floor(i / st.size) });
    const queue = [i];
    seen[i] = 1;
    for (let k = 0; k < queue.length; k++) {
      const j = queue[k], x = j % st.size;
      const next = [j - st.size, j + st.size];
      if (x) next.push(j - 1);
      if (x < st.size - 1) next.push(j + 1);
      for (const n of next) if (n >= 0 && n < st.cells && !seen[n] && valid(n)) { seen[n] = 1; queue.push(n); }
    }
  }
  return out;
}
