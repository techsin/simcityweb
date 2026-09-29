/**
 * Inspector model (WP5, docs/SIM_DEPTH_PART_B.md items 25 / 30 / 33): pure functions that turn the simulation's
 * explanations (FacilityReport, desirability / land value / condition breakdowns, growth limits, needs, response
 * slack, crime terms) into display rows, bars and chips. No DOM: InfoPanel renders them; tests pin them with stub
 * outputs (null / [] / -1) and with full outputs.
 */
import { EMERG_RMAX } from '../sim/infra/params';
import type { FactorTerm } from '../sim/explain';
import type { FacilityLine, FacilityReport } from '../sim/infra/facilities';
import type { NeedReport } from '../sim/economy/demographics';

export type Tone = 'pos' | 'warn' | 'neg' | '';

export interface Bar {
  id: string;
  label: string;
  /** signed contribution */
  value: number;
  /** formatted value ("+0.12", "−8") */
  text: string;
  detail?: string;
}

export interface ModelRow {
  label: string;
  value: string;
  tone?: Tone;
  /** 0..1+ fill for a bar (facility lines with a ratio) */
  ratio?: number;
  /** status chip of the row */
  status?: 'ok' | 'warn' | 'bad';
  hint?: string;
}

export interface Chip {
  text: string;
  cls: 'good' | 'warn' | 'bad' | 'info';
  title?: string;
  /** topic for de-duplication against facility warnings */
  topic?: 'power' | 'water' | 'road' | 'staff' | 'burnt' | 'fire' | 'other';
}

/** at most this many bars per section (critic item 30) */
export const MAX_BARS = 8;

const fmt = (v: number, digits = 2) => {
  const r = Number(v.toFixed(digits));
  return r === 0 ? (0).toFixed(digits) : `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(digits)}`;
};

/** the n terms with the largest |value| (stable), as bars */
export function termBars(terms: readonly FactorTerm[] | null | undefined, n = MAX_BARS, digits = 2, scale = 1): Bar[] {
  if (!terms || !terms.length) return [];
  return terms
    .map((t, k) => ({ t, k }))
    .filter((e) => Number.isFinite(e.t.value) && Math.abs(e.t.value) > 1e-4)
    .sort((a, b) => Math.abs(b.t.value) - Math.abs(a.t.value) || a.k - b.k)
    .slice(0, n)
    .map(({ t }) => ({ id: t.id, label: t.label, value: t.value, text: fmt(t.value * scale, digits), detail: t.detail }));
}

// ------------------------------------------------------------------------------------------------ desirability
export interface DesirabilityView {
  bars: Bar[];
  value: number;
  raw: number;
  /** the raw sum was outside -1..1 */
  clamped: boolean;
  /** the stored value still moves towards clamp(raw) (smoothing / refresh lag) */
  updating: boolean;
  note?: string;
}

/** desirabilityBreakdown → top bars + clamp / updating notes; null when there is nothing to show (stub: no terms) */
export function desirabilityView(br: { terms: FactorTerm[]; raw: number; value: number } | null | undefined): DesirabilityView | null {
  if (!br || !br.terms || !br.terms.length) return null;
  const clampedRaw = Math.max(-1, Math.min(1, br.raw));
  const clamped = Math.abs(br.raw) > 1 + 1e-6;
  const updating = Math.abs(clampedRaw - br.value) > 0.02;
  let note: string | undefined;
  if (clamped) note = `Capped: the factors add up to ${fmt(br.raw)}, desirability tops out at ${fmt(clampedRaw)}`;
  else if (updating) note = `Updating: heading for ${fmt(clampedRaw)}`;
  return { bars: termBars(br.terms), value: br.value, raw: br.raw, clamped, updating, note };
}

// ------------------------------------------------------------------------------------------------ condition
export interface ConditionView {
  bars: Bar[];
  /** condition target 0..1 the building moves to */
  target: number;
  /** "Abandons in 34 days" (null = not at risk) */
  abandon: string | null;
}

/** conditionBreakdown → bars (the base term first, then the penalties) + the abandonment countdown */
export function conditionView(cb: { terms: FactorTerm[]; target: number; abandonInDays: number | null } | null | undefined): ConditionView | null {
  if (!cb || !cb.terms || !cb.terms.length) return null;
  const abandon = cb.abandonInDays === null || cb.abandonInDays === undefined ? null
    : cb.abandonInDays <= 0 ? 'Abandons any day now' : `Abandons in ${Math.round(cb.abandonInDays)} day${Math.round(cb.abandonInDays) === 1 ? '' : 's'}`;
  const base = cb.terms.filter((t) => t.id === 'desirability');
  const rest = termBars(cb.terms.filter((t) => t.id !== 'desirability'), MAX_BARS - base.length);
  return {
    bars: [...base.map((t) => ({ id: t.id, label: 'From desirability', value: t.value, text: fmt(t.value), detail: t.detail })), ...rest],
    target: cb.target,
    abandon,
  };
}

/** fix hints of condition terms (population.ts conditionBreakdown ids) */
export const CONDITION_HINTS: Readonly<Record<string, string>> = {
  power: 'Connect power: a power line or a powered road beside it',
  water: 'Connect water: pipes run under roads to your pumps / towers',
  waterBonus: '',
  tapWater: 'Build a water treatment plant, or move the pumps away from pollution',
  road: 'Build a road beside it',
  garbage: 'Garbage trucks never come: build a landfill, incinerator or recycling center within reach',
  jobs: 'Residents can’t reach jobs: zone jobs nearby, add avenues or transit',
  needs: 'Build the missing services nearby (see Residents)',
  noise: 'Too noisy to sleep: plant trees, keep homes away from highways and industry',
};

export interface MainProblem {
  text: string;
  hint?: string;
  tone: 'bad' | 'warn';
}

/**
 * The one line the default inspector view leads with (critic item 30): a facility warning (they carry their fix), else
 * the largest negative condition penalty with its fix, else the largest negative desirability factor.
 */
export function mainProblem(input: {
  warnings?: readonly string[];
  condition?: ConditionView | null;
  desirability?: DesirabilityView | null;
  abandoned?: boolean;
}): MainProblem | null {
  const w = input.warnings?.find((x) => !/^Under construction/.test(x));
  if (w) {
    const i = w.indexOf(' — ');
    return i > 0 ? { text: w.slice(0, i), hint: w.slice(i + 3), tone: 'bad' } : { text: w, tone: 'warn' };
  }
  const neg = input.condition?.bars.filter((b) => b.id !== 'desirability' && b.value < -0.02).sort((a, b) => a.value - b.value)[0];
  if (neg) {
    const hint = CONDITION_HINTS[neg.id] || neg.detail;
    const tone = input.abandoned || (input.condition?.abandon ?? null) !== null || neg.value <= -0.2 ? 'bad' : 'warn';
    return { text: neg.detail && neg.id === 'needs' ? `${neg.label}: ${neg.detail}` : neg.label, hint: neg.id === 'needs' ? CONDITION_HINTS.needs : hint, tone };
  }
  const d = input.desirability?.bars.filter((b) => b.value < -0.05).sort((a, b) => a.value - b.value)[0];
  if (d) return { text: `Held back by ${d.label.toLowerCase()}`, hint: d.detail, tone: 'warn' };
  return null;
}

// ------------------------------------------------------------------------------------------------ growth limits
export interface GrowthLimitsLike {
  desStage: number;
  popStage: number;
  zoneStage: number;
  rejected: boolean;
  reason?: string;
  [k: string]: unknown;
}

/** growthLimits → rows: the binding limit first ("Limited by: city size (stage 3 of 8)") */
export function growthRows(gl: GrowthLimitsLike | null | undefined, stage?: number): ModelRow[] {
  if (!gl) return [];
  const rows: ModelRow[] = [];
  const lim = Math.min(gl.desStage, gl.popStage, gl.zoneStage);
  const which = lim === gl.zoneStage ? 'zone density' : lim === gl.popStage ? 'city population' : 'desirability';
  if (gl.rejected) rows.push({ label: 'Growth', value: gl.reason ?? 'Blocked', tone: 'neg' });
  else rows.push({ label: 'Can grow to', value: `stage ${lim} · limited by ${which}`, tone: stage !== undefined && stage >= lim ? 'warn' : '' });
  rows.push({ label: 'Stage limits', value: `desirability ${gl.desStage} · population ${gl.popStage} · zone ${gl.zoneStage}` });
  // optional fields added by WP6a (e.g. downtown weight): show numbers / short strings generically
  for (const [k, v] of Object.entries(gl)) {
    if (['desStage', 'popStage', 'zoneStage', 'rejected', 'reason'].includes(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) rows.push({ label: labelOf(k), value: Math.abs(v) < 10 ? v.toFixed(2) : String(Math.round(v)) });
    else if (typeof v === 'string' && v.length < 80) rows.push({ label: labelOf(k), value: v });
  }
  return rows;
}
function labelOf(k: string): string {
  const s = k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ------------------------------------------------------------------------------------------------ facility report
export interface FacilityView {
  role: string;
  rows: ModelRow[];
  warnings: string[];
}

/** topic of a facility warning (for de-duplicating chips) */
export function warningTopic(w: string): Chip['topic'] {
  if (/^No power/i.test(w)) return 'power';
  if (/^No water/i.test(w)) return 'water';
  if (/^No road/i.test(w)) return 'road';
  if (/^Understaffed/i.test(w)) return 'staff';
  if (/^Burnt/i.test(w)) return 'burnt';
  return 'other';
}

/** facilityReport → generic rows (label / value, a bar when ratio is set, status, hint) + de-duplicated warnings */
export function facilityView(rep: FacilityReport | null | undefined): FacilityView | null {
  if (!rep) return null;
  const rows = rep.lines.map((l: FacilityLine) => {
    const r: ModelRow = { label: l.label, value: l.value };
    if (typeof l.ratio === 'number' && Number.isFinite(l.ratio)) r.ratio = Math.max(0, l.ratio);
    if (l.status) r.status = l.status;
    if (l.hint) r.hint = l.hint;
    r.tone = l.status === 'bad' ? 'neg' : l.status === 'warn' ? 'warn' : '';
    return r;
  });
  return { role: rep.role, rows, warnings: [...new Set(rep.warnings)] };
}

/** drop chips whose topic a facility warning already explains (the warning carries the fix) */
export function dedupeChips(chips: readonly Chip[], warnings: readonly string[]): Chip[] {
  const topics = new Set(warnings.map(warningTopic));
  return chips.filter((c) => !c.topic || c.topic === 'other' || !topics.has(c.topic));
}

// ------------------------------------------------------------------------------------------------ residents
const COHORT_NAME = ['Children', 'Teens', 'Young adults', 'Adults', 'Seniors'];
export interface NeedRow {
  who: string;
  people: number;
  label: string;
  met: boolean;
  access: number;
}

/** needsOf → rows ("Children 34 · Elementary school ✓ 92%"), unmet first, jobs / water at the end */
export function needRows(needs: readonly NeedReport[] | null | undefined): NeedRow[] {
  if (!needs || !needs.length) return [];
  const order = (n: NeedReport) => (n.met ? 1 : 0);
  return [...needs]
    .sort((a, b) => order(a) - order(b) || b.people - a.people)
    .map((n) => ({ who: n.cohort >= 0 ? COHORT_NAME[n.cohort] : 'Household', people: n.people, label: n.label, met: n.met, access: n.access }));
}

export interface PyramidBar {
  label: string;
  people: number;
  share: number;
}

/** 5-bar age pyramid of a home from its cohort shares */
export function pyramid(shares: ArrayLike<number> | null | undefined, pop: number): PyramidBar[] {
  if (!shares || shares.length < 5 || !(pop > 0)) return [];
  const out: PyramidBar[] = [];
  for (let c = 0; c < 5; c++) {
    const s = Math.max(0, Number(shares[c]) || 0);
    out.push({ label: COHORT_NAME[c], people: Math.round(pop * s), share: s });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ emergency response
/** "auto, 2.1 min to spare" / "manual only (1.4 min out of reach)" / "no station"; null = unknown (no data yet) */
export function responseText(r: { slackMin: number; covered: boolean } | null | undefined, noStation = 'no station'): { text: string; tone: Tone } | null {
  if (!r || !Number.isFinite(r.slackMin)) return null;
  if (r.slackMin <= -98.5) return { text: noStation, tone: 'neg' };
  // the response layers' floor (-EMERG_RMAX): no road reaches the lot at all
  if (r.slackMin <= -EMERG_RMAX + 1e-6) return { text: 'unreachable — no road to it', tone: 'neg' };
  if (r.covered || r.slackMin >= 0) return { text: `auto, ${r.slackMin.toFixed(1)} min to spare`, tone: 'pos' };
  return { text: `manual only (${(-r.slackMin).toFixed(1)} min out of reach)`, tone: r.slackMin >= -3 ? 'warn' : 'neg' };
}

// ------------------------------------------------------------------------------------------------ crime
export interface CrimeTermsLike {
  density: number; poverty: number; unemployment: number; landValue: number; abandoned: number; garbage: number; youth: number;
  nightlife: number; multiplier: number; police: number; total: number;
}
const CRIME_LABEL: Record<string, string> = {
  density: 'Crowding', poverty: 'Poverty', unemployment: 'Unemployment', landValue: 'Low land value', abandoned: 'Abandoned buildings',
  garbage: 'Garbage in the streets', youth: 'Bored teens', nightlife: 'Nightlife',
};
/** CrimeSystem.termsOf → bars (causes positive, police removes a share) */
export function crimeBars(t: CrimeTermsLike | null | undefined): { bars: Bar[]; total: number; police: number; multiplier: number } | null {
  if (!t) return null;
  const terms: FactorTerm[] = [];
  for (const k of Object.keys(CRIME_LABEL)) {
    const v = (t as unknown as Record<string, number>)[k];
    if (typeof v === 'number' && Math.abs(v) > 1e-3) terms.push({ id: k, label: CRIME_LABEL[k], value: v });
  }
  return { bars: termBars(terms, MAX_BARS, 2), total: t.total, police: t.police, multiplier: t.multiplier };
}
