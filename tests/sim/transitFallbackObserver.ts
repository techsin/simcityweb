/** FX3 diagnostics only: these hooks collect outside CityState and never change a simulated input. */
export interface Fx3Tuning {
  commute: number;
  commuteStart: number;
  needsPop0: number;
  needsPop1: number;
  ema: number;
  fallback: number;
}

const categories = ['measured', 'stale', 'neverRouted', 'selectedUnmatched', 'cutoff', 'disabled', 'geometryMismatch', 'currentZero'] as const;
const unmatchedReasons = ['noWorkers', 'noRoadEntries', 'noAssignment', 'nonpositiveMinutes'] as const;
type Category = typeof categories[number];
type UnmatchedReason = typeof unmatchedReasons[number];
type Weights<K extends string> = Record<K, number>;
interface Geometry { x: number; z: number; w: number; d: number; rot: number; def: string; center: number }
interface Prepared {
  geometry: Geometry | null;
  pop: number;
  workers: number;
  entries: number;
  cell: number;
}
interface Result extends Prepared {
  status: 'valid' | 'cutoff' | 'unmatched' | 'geometryMismatch';
  reason?: UnmatchedReason;
  minutes: number;
  assigned: number;
  prepDay: number | null;
  finalDay: number;
  cycle: number;
}
export interface Fx3Example {
  id: number;
  day: number;
  weight: number;
  gridMinutes: number;
  retainedMinutes: number | null;
  selectedLast: boolean;
  prepDay: number | null;
  finalDay: number | null;
  cycle: number | null;
  prepPop: number | null;
  prepWorkers: number | null;
  prepEntries: number | null;
  assigned: number | null;
  unmatchedReason?: UnmatchedReason;
}
interface Accumulator {
  weight: number;
  numerator: number;
  staleFallbackNumerator: number;
  staleRetainedNumerator: number;
  categoryWeights: Weights<Category>;
  categorySampleCounts: Weights<Category>;
  unmatchedReasonWeights: Weights<UnmatchedReason>;
  examples: Record<Category, Fx3Example[]>;
}
interface Selected extends Accumulator { actualNumerator: number; mean: number }
export interface Fx3Shadow {
  weight: number;
  mean: number | null;
  term: number;
  raw: number;
  approval: number;
  termDelta: number;
  rawDelta: number;
  approvalDelta: number;
}
export interface Fx3Record {
  day: number;
  first: boolean;
  resumed: boolean;
  surveyWeight: number;
  surveyNumerator: number;
  resCommute: number;
  populationFade: number;
  commuteTerm: number;
  raw: number;
  unclampedRaw: number;
  approval: number;
  staleWeight: number;
  staleShare: number;
  staleMinuteCorrection: number;
  categoryWeights: Weights<Category>;
  categorySampleCounts: Weights<Category>;
  unmatchedReasonWeights: Weights<UnmatchedReason>;
  examples: Record<Category, Fx3Example[]>;
  carry: Fx3Shadow;
  exclude: Fx3Shadow;
}
interface CityDiagnostics {
  selected: Set<number>;
  latest: Map<number, Result>;
  pending: { day: number; origins: Map<number, Prepared> } | null;
  carryApproval: number | null;
  excludeApproval: number | null;
}

function zeros<K extends string>(keys: readonly K[]): Weights<K> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Weights<K>;
}
function accumulator(): Accumulator {
  return {
    weight: 0, numerator: 0, staleFallbackNumerator: 0, staleRetainedNumerator: 0,
    categoryWeights: zeros(categories), categorySampleCounts: zeros(categories), unmatchedReasonWeights: zeros(unmatchedReasons),
    examples: Object.fromEntries(categories.map((k) => [k, [] as Fx3Example[]])) as Record<Category, Fx3Example[]>,
  };
}
function geometry(st: any, b: any): Geometry | null {
  if (!b) return null;
  return { x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, def: b.def, center: (b.z + (b.d >> 1)) * st.size + b.x + (b.w >> 1) };
}
function sameGeometry(a: Geometry | null, b: Geometry | null): boolean {
  return a !== null && b !== null && a.x === b.x && a.z === b.z && a.w === b.w && a.d === b.d
    && a.rot === b.rot && a.def === b.def && a.center === b.center;
}
function near(actual: number, expected: number, label: string, tolerance = 1e-9): void {
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > tolerance * Math.max(1, Math.abs(expected))) {
    throw new Error(`FX3 ${label}: ${actual} != ${expected}`);
  }
}
function clamp(v: number): number { return Math.max(0, Math.min(100, v)); }

export class Fx3Observer {
  private readonly cities = new WeakMap<object, CityDiagnostics>();
  private readonly accumulators = new WeakMap<object, Accumulator>();
  private readonly surveys = new WeakMap<object, Selected>();
  private readonly rows: Fx3Record[] = [];

  constructor(private readonly tuning: Fx3Tuning) {}

  get records(): readonly Fx3Record[] { return this.rows; }
  get latest(): Fx3Record | undefined { return this.rows[this.rows.length - 1]; }

  private city(st: object): CityDiagnostics {
    let c = this.cities.get(st);
    if (!c) {
      c = { selected: new Set(), latest: new Map(), pending: null, carryApproval: null, excludeApproval: null };
      this.cities.set(st, c);
    }
    return c;
  }

  /** Called after PREP has finished: copy only primitive origin metadata, never a live traffic array. */
  trafficPrep(st: any, tr: any): void {
    const origins = new Map<number, Prepared>();
    for (let o = 0; o < tr.oN; o++) {
      const id = tr.oBid[o];
      origins.set(id, {
        geometry: geometry(st, st.buildings.get(id)), pop: tr.oPop[o], workers: tr.oW[o], entries: tr.oEntC[o], cell: tr.oCell[o],
      });
    }
    this.city(st).pending = { day: st.day, origins };
  }

  /** Called after FINAL2, before saveTransport: a newer unmatched/cut result supersedes an older valid result. */
  trafficFinal(st: any, tr: any): void {
    const c = this.city(st);
    for (const id of c.latest.keys()) if (!st.buildings.has(id)) c.latest.delete(id);
    const selected = new Set<number>();
    for (let o = 0; o < tr.oN; o++) {
      const id = tr.oBid[o];
      selected.add(id);
      const current = geometry(st, st.buildings.get(id));
      const prepared = c.pending?.origins.get(id);
      const p: Prepared = prepared ?? { geometry: null, pop: 0, workers: 0, entries: 0, cell: tr.oCell[o] };
      const minutes = tr.commuteById[id] ?? 0;
      const assigned = tr.oAsg[o] ?? 0;
      let status: Result['status'];
      let reason: UnmatchedReason | undefined;
      if (!sameGeometry(p.geometry, current) || current?.center !== p.cell || tr.oCell[o] !== p.cell) status = 'geometryMismatch';
      else if (tr.oCut[o] === 1) status = 'cutoff';
      else if (!(p.workers > 0) || !(p.entries > 0) || !(assigned > 0) || !(minutes > 0)) {
        status = 'unmatched';
        reason = !(p.workers > 0) ? 'noWorkers' : !(p.entries > 0) ? 'noRoadEntries' : !(assigned > 0) ? 'noAssignment' : 'nonpositiveMinutes';
      } else status = 'valid';
      c.latest.set(id, { ...p, status, reason, minutes, assigned, prepDay: c.pending?.day ?? null, finalDay: st.day, cycle: tr.cycles });
    }
    c.selected = selected;
    c.pending = null;
  }

  surveyReset(acc: object): void { this.accumulators.set(acc, accumulator()); }

  /** This receives exactly the production survey's selected home, centre and population on its sampling day. */
  surveyHome(st: any, acc: object, b: any, i: number, p: number, trafficEnabled: boolean, gridMinutes: number): void {
    let a = this.accumulators.get(acc);
    if (!a) { a = accumulator(); this.accumulators.set(acc, a); }
    const c = this.city(st);
    const r = c.latest.get(b.id);
    const selectedLast = c.selected.has(b.id);
    let category: Category;
    if (!trafficEnabled) category = 'disabled';
    else if (gridMinutes > 0) category = 'measured';
    else if (!r) category = 'neverRouted';
    else if (r.status === 'geometryMismatch' || !sameGeometry(r.geometry, geometry(st, b)) || r.geometry?.center !== i) category = 'geometryMismatch';
    else if (r.status === 'cutoff') category = 'cutoff';
    else if (r.status === 'unmatched') category = 'selectedUnmatched';
    else if (gridMinutes <= 0 && r.status === 'valid' && !selectedLast) category = 'stale';
    else category = 'currentZero';
    const minutes = trafficEnabled && gridMinutes > 0 ? gridMinutes : this.tuning.fallback;
    a.weight += p;
    a.numerator += minutes * p;
    a.categoryWeights[category] += p;
    a.categorySampleCounts[category]++;
    if (category === 'selectedUnmatched' && r?.reason) a.unmatchedReasonWeights[r.reason] += p;
    if (category === 'stale') {
      a.staleFallbackNumerator += this.tuning.fallback * p;
      a.staleRetainedNumerator += r!.minutes * p;
    }
    if (a.examples[category].length < 3) a.examples[category].push({
      id: b.id, day: st.day, weight: p, gridMinutes, retainedMinutes: r?.minutes ?? null, selectedLast,
      prepDay: r?.prepDay ?? null, finalDay: r?.finalDay ?? null, cycle: r?.cycle ?? null,
      prepPop: r?.pop ?? null, prepWorkers: r?.workers ?? null, prepEntries: r?.entries ?? null, assigned: r?.assigned ?? null,
      ...(r?.reason ? { unmatchedReason: r.reason } : {}),
    });
  }

  /** Called before the selected production accumulator is cleared; cached survey reuse needs no extra call. */
  surveySelected(_st: any, acc: object, sv: any): void {
    const a = this.accumulators.get(acc);
    if (!a) throw new Error('FX3 selected a survey without observed samples/reset');
    const values = acc as ArrayLike<number>;
    const weight = sv.pop[3];
    near(a.weight, weight, 'sampled population');
    near(values[3], weight, 'accumulator population');
    near(Object.values(a.categoryWeights).reduce((sum, v) => sum + v, 0), weight, 'category population');
    near(a.numerator, values[40], 'sampled numerator');
    if (weight > 0) near(values[40] / weight, sv.commute, 'selected mean');
    this.surveys.set(sv, {
      ...a, categoryWeights: { ...a.categoryWeights }, categorySampleCounts: { ...a.categorySampleCounts },
      unmatchedReasonWeights: { ...a.unmatchedReasonWeights },
      examples: Object.fromEntries(categories.map((k) => [k, a.examples[k].map((e) => ({ ...e }))])) as Record<Category, Fx3Example[]>,
      weight, actualNumerator: values[40], mean: sv.commute,
    });
  }

  /** Called after approval's normal EMA write. Both alternative histories remain external, with realised other terms. */
  approval(st: any, sv: any, first: boolean, resumed: boolean, terms: Record<string, number>, raw: number, approval: number): void {
    const a = this.surveys.get(sv);
    if (!a) throw new Error('FX3 approval survey was not observed');
    const c = this.city(st), t = this.tuning;
    const u = Math.max(0, Math.min(1, (a.weight - t.needsPop0) / (t.needsPop1 - t.needsPop0)));
    const fade = a.weight > 0 ? u * u * (3 - 2 * u) : 0;
    const term = (mean: number | null) => mean === null ? 0 : (t.commute * Math.max(0, mean - t.commuteStart) * fade || 0);
    const actualTerm = a.weight > 0 ? term(a.mean) : 0;
    near(actualTerm, terms.commute, 'actual commute term');
    const staleWeight = a.categoryWeights.stale;
    const carryMean = a.weight > 0 ? (a.actualNumerator - a.staleFallbackNumerator + a.staleRetainedNumerator) / a.weight : null;
    const excludeWeight = a.weight - staleWeight;
    const excludeMean = excludeWeight > 0 ? (a.actualNumerator - a.staleFallbackNumerator) / excludeWeight : null;
    const unclampedRaw = raw - (terms.clamp ?? 0);
    const shadow = (weight: number, mean: number | null, previous: number | null): Fx3Shadow => {
      const nextTerm = term(mean);
      const nextRaw = clamp(unclampedRaw - actualTerm + nextTerm);
      if (!first && previous === null) throw new Error('FX3 monthly approval preceded initialization');
      const nextApproval = first ? (resumed ? approval : nextRaw) : clamp(previous! + (nextRaw - previous!) * t.ema);
      return { weight, mean, term: nextTerm, raw: nextRaw, approval: nextApproval,
        termDelta: nextTerm - actualTerm, rawDelta: nextRaw - raw, approvalDelta: nextApproval - approval };
    };
    const carry = shadow(a.weight, carryMean, c.carryApproval);
    const exclude = shadow(excludeWeight, excludeMean, c.excludeApproval);
    c.carryApproval = carry.approval;
    c.excludeApproval = exclude.approval;
    this.rows.push({
      day: st.day, first, resumed, surveyWeight: a.weight, surveyNumerator: a.actualNumerator, resCommute: a.mean,
      populationFade: fade, commuteTerm: actualTerm, raw, unclampedRaw, approval,
      staleWeight, staleShare: a.weight > 0 ? staleWeight / a.weight : 0,
      staleMinuteCorrection: a.staleFallbackNumerator - a.staleRetainedNumerator,
      categoryWeights: { ...a.categoryWeights }, categorySampleCounts: { ...a.categorySampleCounts },
      unmatchedReasonWeights: { ...a.unmatchedReasonWeights }, examples: a.examples, carry, exclude,
    });
  }
}
