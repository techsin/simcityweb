/** LG-21: the Gazette reads monthly replica history, and waits for the New Year show to finish. */
import './yearReview.css';
import { YEAR_REVIEW_TERMS, type CityState, type HistorySeries, type YearReviewGoals } from '../sim/CityState';
import { APPROVAL_LABELS } from '../sim/economy/approval';
import { CITY_RANKS, listMilestones, REWARD_BY_ID } from '../sim/economy/rewards';
import type { GameContext } from '../game/context';
import { h, isTyping } from './dom';
import { moneyCompact, num, pct, signedPct } from './format';
import { yearGrade, type YearGradeInput } from './yearGrade';

type Grade = ReturnType<typeof yearGrade>;
type Key = Exclude<keyof HistorySeries, 't'>;

export interface YearReviewReport {
  year: number;
  population: number;
  populationChange: number | null;
  growth: number | null;
  funds: number;
  bankMonths: number | null;
  recurringNet: number | null;
  approval: number;
  approvalChange: number | null;
  terms: { id: string; label: string; change: number }[];
  termsMeasured: boolean;
  incidents: number;
  answered: number | null;
  failed: number | null;
  lost: number | null;
  deaths: number;
  tourists: number;
  eq: number;
  hq: number;
  records: string[];
  completed: string[];
  next: { name: string; progress: number }[];
  rank: string;
  grade: Grade | null;
  pastGrades: { year: number; grade: Grade }[];
  region: string;
}

function yearWindow(history: HistorySeries, month: number): number[] {
  const indices: number[] = [];
  for (let i = 0; i < history.t.length; i++) if (history.t[i] > month - 12 && history.t[i] <= month) indices.push(i);
  return indices;
}

function sum(history: HistorySeries, key: Key, indices: number[]): number {
  return indices.reduce((n, i) => n + (history[key]?.[i] ?? 0), 0);
}

function mean(history: HistorySeries, key: Key, indices: number[]): number {
  return indices.length ? sum(history, key, indices) / indices.length : 0;
}

/** null means an old save has not yet recorded a full year of the additional review inputs. */
export function yearGradeInput(history: HistorySeries, month: number): YearGradeInput | null {
  const indices = yearWindow(history, month), end = indices.at(-1);
  const start = history.t.indexOf(month - 12);
  if (end === undefined || indices.length !== 12 || history.t[end] !== month
    || indices.some((i, k) => history.t[i] !== month - 11 + k || history.reviewSample?.[i] !== 1)
    || (start < 0 && month !== 12)) return null;
  const previous = start >= 0 ? history.pop[start] : 0;
  const population = history.pop[end];
  return {
    growth: previous > 0 ? (population - previous) / previous : population > 0 ? 1 : 0,
    builtOut: history.builtOut[end] === 1,
    unemployment: mean(history, 'unemployment', indices),
    approval: mean(history, 'approval', indices),
    funds: history.reviewFunds[end], monthlyExpense: history.recurringExpense[end],
    recurringNet: sum(history, 'recurringNet', indices),
    incidents: sum(history, 'incidents', indices), failed: sum(history, 'emergencyFailed', indices),
    crime: mean(history, 'resCrime', indices), air: mean(history, 'air', indices),
    noisyHomes: mean(history, 'noisyHomes', indices), services: mean(history, 'homeServices', indices),
  };
}

function goalName(id: string): string {
  return id.startsWith('rank:') ? CITY_RANKS.find((r) => r.id === id.slice(5))?.name ?? id.slice(5)
    : REWARD_BY_ID.get(id)?.name ?? id;
}

/** Captured on January 1: later months during the fireworks cannot change the printed year's figures. */
export function buildYearReview(state: CityState, year: number, regionName?: string): YearReviewReport | null {
  const history = state.history, month = (year - state.config.startYear) * 12;
  const indices = yearWindow(history, month), end = history.t.indexOf(month), start = history.t.indexOf(month - 12);
  if (end < 0 || !indices.length) return null;
  const population = history.pop[end], previous = start >= 0 ? history.pop[start] : month === 12 ? 0 : null;
  const full = indices.length === 12 && indices.every((i, k) => history.t[i] === month - 11 + k && history.reviewSample?.[i] === 1);
  const expense = history.reviewSample?.[end] === 1 ? history.recurringExpense[end] : null;
  const termsMeasured = start >= 0 && history.reviewTermsSample?.[start] === 1 && history.reviewTermsSample?.[end] === 1;
  const terms = termsMeasured
    ? YEAR_REVIEW_TERMS.map((id) => ({ id, label: APPROVAL_LABELS[id] ?? id, change: history[`approval_${id}`][end] - history[`approval_${id}`][start] }))
      .filter((term) => Math.abs(term.change) > 1e-9).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3)
    : [];
  const records: string[] = [];
  const prior = history.t.map((t, i) => t <= month - 12 ? i : -1).filter((i) => i >= 0);
  if (prior.length) for (const [key, label] of [['pop', 'Population'], ['funds', 'Treasury'], ['approval', 'Approval'], ['tourists', 'Tourists'], ['eq', 'EQ'], ['hq', 'HQ']] as const) {
    const best = Math.max(...indices.map((i) => history[key][i]));
    if (best > Math.max(...prior.map((i) => history[key][i]))) records.push(`${label}: ${key === 'funds' ? moneyCompact(best) : num(best)}${key === 'approval' ? '%' : ''}`);
  }
  const economy = state.systemData.economy as { yearReviewGoals?: YearReviewGoals } | undefined;
  const completed = Object.entries(economy?.yearReviewGoals?.completed ?? {})
    .filter(([, t]) => t > month - 12 && t <= month).sort(([a, ta], [b, tb]) => ta - tb || a.localeCompare(b, 'en'))
    .map(([id]) => goalName(id));
  const milestones = listMilestones(state);
  const input = yearGradeInput(history, month);
  const pastGrades: YearReviewReport['pastGrades'] = [];
  for (const t of history.t) if (t > 0 && t % 12 === 0 && t <= month && t >= month - 9 * 12) {
    const pastInput = yearGradeInput(history, t);
    if (pastInput) pastGrades.push({ year: state.config.startYear + t / 12 - 1, grade: yearGrade(pastInput) });
  }
  const connections = state.neighborConnections.length;
  const jobs = state.systemData.regionJobs, workers = state.systemData.regionWorkers;
  const region = `${regionName || (state.config.regionId ? 'Region' : 'Independent city')} · ${num(connections)} regional connections`
    + (typeof jobs === 'number' ? ` · ${num(jobs)} job slots` : '')
    + (typeof workers === 'number' ? ` · ${num(workers)} worker slots` : '');
  return {
    year, population, populationChange: previous === null ? null : population - previous,
    growth: previous !== null && previous > 0 ? (population - previous) / previous : null,
    funds: history.reviewSample?.[end] === 1 ? history.reviewFunds[end] : history.funds[end],
    bankMonths: expense === null ? null : expense > 0 ? history.reviewFunds[end] / expense : Infinity,
    recurringNet: full ? sum(history, 'recurringNet', indices) : null,
    approval: history.approval[end], approvalChange: start >= 0 ? history.approval[end] - history.approval[start] : null,
    terms, termsMeasured, incidents: sum(history, 'incidents', indices), answered: full ? sum(history, 'emergencyAnswered', indices) : null,
    failed: full ? sum(history, 'emergencyFailed', indices) : null, lost: full ? sum(history, 'buildingsLost', indices) : null,
    deaths: sum(history, 'emergencyDeaths', indices), tourists: mean(history, 'tourists', indices), eq: history.eq[end], hq: history.hq[end],
    records, completed, next: milestones.nextUnlocks, rank: milestones.currentRank.name,
    grade: input ? yearGrade(input) : null, pastGrades, region,
  };
}

export function yearReviewDue(year: number, startYear: number, speed: number): boolean {
  const cadence = speed >= 3 ? 5 : speed >= 2 ? 2 : 1;
  return year > startYear && (year - startYear) % cadence === 0;
}

export class YearReview {
  private card: HTMLElement | null = null;
  private pending: YearReviewReport | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seenYear: number;
  private armed = false;
  private offs: (() => void)[] = [];

  constructor(private ctx: GameContext, private options: { busy: () => boolean; regionName?: string }) {
    this.seenYear = ctx.state.year;
    this.offs.push(
      ctx.host.events.on('year', (year) => this.onYear(year)),
      ctx.host.events.on('reset', () => { this.seenYear = ctx.state.year; this.dismiss(); }),
      ctx.ui.on('viewsReady', () => { this.seenYear = ctx.state.year; this.armed = true; }),
      ctx.ui.on('uiTick', () => this.update()),
      ctx.ui.on('settings', () => { if (!ctx.settings.yearReview) this.dismiss(); }),
      ctx.host.policy.subscribe((policy) => { if (policy.live) this.dismiss(); }, ctx.signal),
    );
    // Delegate from the scene: a restored WebGL context can replace the canvas.
    const map = ctx.canvas.parentElement ?? ctx.canvas;
    const input = (e: Event) => {
      const target = e.target as HTMLElement | null;
      const onMap = target === ctx.canvas || !!target?.closest?.('.minimap');
      if (this.card && onMap && (e.type !== 'pointermove' || (e as PointerEvent).buttons)) this.dismiss();
    };
    for (const event of ['pointerdown', 'wheel', 'touchstart', 'pointermove']) map.addEventListener(event, input, { capture: true, passive: true, signal: ctx.signal });
    if (typeof window !== 'undefined') window.addEventListener('keydown', (e) => {
      if (this.card && !isTyping(e) && !['Tab', 'Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) this.dismiss();
    }, { capture: true, signal: ctx.signal });
    ctx.signal.addEventListener('abort', () => this.dispose(), { once: true });
  }

  private onYear(year: number): void {
    if (year <= this.seenYear) return;
    this.seenYear = year;
    if (!this.armed || !this.ctx.settings.yearReview || this.ctx.host.policy.live) { this.dismiss(); return; }
    if (!yearReviewDue(year, this.ctx.state.config.startYear, this.ctx.host.speed)) return;
    this.dismiss();
    this.pending = buildYearReview(this.ctx.state, year, this.options.regionName);
    this.update();
  }

  private update(): void {
    if (!this.ctx.settings.yearReview || this.ctx.host.policy.live) { this.dismiss(); return; }
    if (!this.pending || this.options.busy()) return;
    const report = this.pending;
    this.pending = null;
    this.show(report);
  }

  private show(report: YearReviewReport): void {
    const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;
    const close = h('button', { class: 'yr-close', type: 'button', 'aria-label': 'Close year in review', title: 'Close' }, '×');
    close.addEventListener('click', () => this.dismiss(), { signal: this.ctx.signal });
    const grades = h('div', { class: 'yr-sparkline', role: 'img', 'aria-label': report.pastGrades.length
      ? report.pastGrades.map((g) => `${g.year}: ${g.grade.letter}, ${g.grade.score.toFixed(1)} points`).join('; ')
      : 'Past grades will appear after a full year of records' });
    for (const past of report.pastGrades) grades.appendChild(h('i', {
      style: { height: `${Math.max(2, past.grade.score)}%` }, title: `${past.year}: ${past.grade.letter} (${past.grade.score.toFixed(1)})`,
    }));
    const grade = h('div', { class: 'yr-grade', title: report.grade ? Object.entries(report.grade.scores).map(([k, v]) => `${k}: ${v.toFixed(1)}`).join(' · ')
      : 'A full year of review records is needed to calculate a grade' },
    h('span', null, "Mayor's grade"), h('b', null, report.grade?.letter ?? '—'),
    h('small', null, report.grade ? `${report.grade.score.toFixed(1)} / 100` : 'Collecting a full year'), grades);
    const metric = (label: string, value: string, detail: string) => h('div', { class: 'yr-metric' }, h('span', null, label), h('b', null, value), h('small', null, detail));
    const section = (label: string, ...children: HTMLElement[]) => h('section', null, h('h3', null, label), ...children);
    const terms = report.terms.length ? report.terms.map((term) => h('div', { class: 'yr-term' }, h('span', null, term.label), h('b', { class: term.change > 0 ? 'pos' : 'neg' }, `${signed(term.change)} pts`)))
      : [h('p', { class: 'dim' }, report.termsMeasured ? 'No approval term changes this year.' : 'Term comparisons begin after a full year of records.')];
    const list = (items: string[], empty: string) => h('p', null, items.length ? items.join(' · ') : empty);
    const card = h('article', { class: 'year-review mp-glass', role: 'region', 'aria-label': `${this.ctx.state.config.name} Gazette — ${report.year}` },
      close,
      h('header', null, h('div', null, h('div', { class: 'yr-eyebrow' }, `${report.year - 1} in review · ${report.rank}`),
        h('h2', null, `${this.ctx.state.config.name || 'City'} Gazette — ${report.year}`)), grade),
      h('div', { class: 'yr-metrics' },
        metric('Residents', num(report.population), report.growth === null ? report.populationChange === null ? 'Annual change unavailable' : `${num(report.populationChange)} new residents` : `${signedPct(report.growth, 1)} · ${report.populationChange! >= 0 ? '+' : '−'}${num(Math.abs(report.populationChange!))} residents`),
        metric('Bank', report.bankMonths === null ? '—' : Number.isFinite(report.bankMonths) ? `${report.bankMonths.toFixed(1)} months` : 'No recurring expenses', moneyCompact(report.funds)),
        metric('Tourists / day', num(report.tourists), 'Year average'), metric('Education / health', `${num(report.eq)} / ${num(report.hq)}`, 'EQ / HQ at year end')),
      h('div', { class: 'yr-columns' },
        section(`Approval ${num(report.approval)}%${report.approvalChange === null ? '' : ` · ${signed(report.approvalChange)} pts`}`, ...terms),
        section('Emergency response', list([
          `${num(report.incidents)} incidents`, `${report.answered === null ? '—' : num(report.answered)} answered`, `${report.failed === null ? '—' : num(report.failed)} failed`,
          `${num(report.deaths)} lives lost`, `${report.lost === null ? '—' : num(report.lost)} buildings lost`,
        ], 'No incidents')),
        section('Records · recorded history', list(report.records, 'No new records this year.')),
        section('Goals completed', list(report.completed, 'No newly completed goals recorded this year.'))),
      h('div', { class: 'yr-next' }, h('h3', null, 'Next goals'), ...report.next.map((goal) => h('span', null, goal.name, h('b', null, pct(goal.progress))))),
      h('footer', null, h('div', null, report.region), h('small', null, 'Closes after 15 seconds or any map input')),
    );
    this.card = card;
    this.ctx.root.appendChild(card);
    this.timer = setTimeout(() => this.dismiss(), 15000);
  }

  dismiss(): void {
    this.pending = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.card?.remove();
    this.card = null;
  }

  private dispose(): void {
    this.dismiss();
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
