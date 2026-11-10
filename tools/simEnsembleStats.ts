/** NOTE-053 / NOTE-062 ensemble statistics; all values retain their simulation units. */
export const METRICS = ['population', 'approval', 'air', 'ihtShare'] as const;
export type Metric = typeof METRICS[number];
export const OBSERVATION_METRICS = ['commuteTerm', 'commuteTermRaw', 'resCommute', 'approvalNetCommute',
  'ihtDemandShareRaw', 'ihtDemandShareCapped', 'ihtDemandShare', 'dirtyJobShare', 'retooledIM', 'retooledIHT'] as const;
export type ObservationMetric = typeof OBSERVATION_METRICS[number];
export type MetricName = Metric | ObservationMetric;
export const ALL_METRICS: readonly MetricName[] = [...METRICS, ...OBSERVATION_METRICS];
export interface AnnualMetrics extends Partial<Record<ObservationMetric, number>> {
  yearIndex: number; year: number; population: number; approval: number; air: number; ihtShare: number;
}
export interface MetricBand { median: number; min: number; max: number; width: number }
export interface AnnualBand { yearIndex: number; year: number; metrics: Record<Metric, MetricBand> & Partial<Record<ObservationMetric, MetricBand>> }
export interface EnsembleMember { id: string; rows: AnnualMetrics[] }
export interface Tolerance { kind: 'absolute' | 'percent'; value: number }
export interface CompareOptions {
  fromYear?: number; throughYear?: number; runs?: 5 | 9;
  tolerance?: Tolerance | Partial<Record<MetricName, Tolerance>>;
  metrics?: readonly MetricName[];
}
export interface Threshold { boundary: 'lower' | 'upper'; value: number; reasons: string[]; distance: number }
export interface BaseMetricVerdict {
  pass: boolean; control: MetricBand; lane: number; delta: number; relativePercent: number | null;
  tolerance: number; allowedDelta: number; withinBand: boolean; withinDelta: boolean;
  lower: number; upper: number; thresholds: Threshold[]; nearThreshold: boolean;
  gated: boolean; exemption: 'zero-dev-iht-share' | null;
}
export interface BaseYearVerdict { yearIndex: number; year: number; pass: boolean; metrics: Record<MetricName, BaseMetricVerdict> }
export interface BaseComparison { pass: boolean; years: BaseYearVerdict[]; nearThreshold: boolean; needsNine: boolean; runs: 5 | 9;
  firstLaneIhtNonzero: { yearIndex: number; year: number; median: number } | null }
export interface VariantTarget { metric: MetricName; direction: 'below' | 'above'; amount: Tolerance }
export interface VariantYearVerdict {
  yearIndex: number; year: number; pass: boolean; base: number; variant: number; delta: number;
  relativePercent: number | null; threshold: number; amount: number; distance: number;
  devBand: MetricBand; nearThreshold: boolean;
}
export interface VariantComparison { pass: boolean; metric: MetricName; target: VariantTarget; years: VariantYearVerdict[]; nearThreshold: boolean; needsNine: boolean; runs: 5 | 9 }

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}
export function median(values: readonly number[]): number {
  if (!values.length) throw new Error('median needs observations');
  const sorted = values.map((value) => finite(value, 'observation')).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2;
}
export function band(values: readonly number[]): MetricBand {
  const middle = median(values), min = Math.min(...values), max = Math.max(...values);
  return { median: middle, min, max, width: finite(max - min, 'band width') };
}
function observationKeys(rows: readonly { yearIndex: number; year: number }[]): void {
  for (const [index, row] of rows.entries()) {
    if (!Number.isInteger(row.yearIndex) || row.yearIndex < 1 || !Number.isInteger(row.year) ||
        index > 0 && (row.yearIndex !== rows[index - 1].yearIndex + 1 || row.year !== rows[index - 1].year + 1)) throw new Error('invalid or nonconsecutive annual observations');
  }
}
export function summarizeEnsemble(members: readonly EnsembleMember[]): AnnualBand[] {
  if (!members.length || !members[0].rows.length) throw new Error('ensemble needs members and annual observations');
  if (new Set(members.map((member) => member.id)).size !== members.length) throw new Error('duplicate ensemble member');
  const reference = members[0].rows;
  observationKeys(reference);
  for (const member of members) {
    if (member.rows.length !== reference.length) throw new Error('unaligned ensemble years');
    member.rows.forEach((row, index) => {
      if (row.year !== reference[index].year || row.yearIndex !== reference[index].yearIndex) throw new Error('unaligned ensemble years');
      for (const metric of METRICS) finite(row[metric], metric);
      for (const metric of OBSERVATION_METRICS) if (row[metric] !== undefined) finite(row[metric]!, metric);
    });
  }
  // Old cached members remain usable; a partial collector cannot become an ensemble band.
  const metrics: MetricName[] = [...METRICS, ...OBSERVATION_METRICS.filter((metric) => members.every((member) => member.rows.every((row) => row[metric] !== undefined)))];
  return reference.map((row, index) => ({ yearIndex: row.yearIndex, year: row.year,
    metrics: Object.fromEntries(metrics.map((metric) => [metric, band(members.map((member) => member.rows[index][metric]!))])) as AnnualBand['metrics'] }));
}
export function metricsIn(rows: readonly AnnualBand[]): MetricName[] {
  return ALL_METRICS.filter((metric) => rows.length > 0 && rows.every((row) => row.metrics[metric] !== undefined));
}
function validateBands(rows: readonly AnnualBand[]): void {
  if (!rows.length) throw new Error('ensemble needs annual bands');
  observationKeys(rows);
  for (const row of rows) for (const metric of ALL_METRICS) {
    const value = row.metrics?.[metric];
    if (!value && !METRICS.includes(metric as Metric)) continue;
    if (!value || ![value.median, value.min, value.max, value.width].every(Number.isFinite) ||
        value.min > value.median || value.median > value.max || value.width !== value.max - value.min) throw new Error(`invalid ${metric} ensemble band`);
  }
}
function selectedMetrics(options: Pick<CompareOptions, 'metrics'>, ...sets: readonly AnnualBand[][]): readonly MetricName[] {
  const metrics = options.metrics ?? METRICS;
  if (!metrics.length || new Set(metrics).size !== metrics.length || metrics.some((metric) => !ALL_METRICS.includes(metric))) throw new Error('invalid comparison metrics');
  for (const rows of sets) for (const metric of metrics) if (!rows.every((row) => row.metrics[metric] !== undefined)) throw new Error(`missing ${metric} observations; cached members without this collector cannot supply this gate`);
  return metrics;
}
function aligned(...sets: readonly AnnualBand[][]): void {
  for (const rows of sets) validateBands(rows);
  const first = sets[0];
  for (const rows of sets.slice(1)) if (rows.length !== first.length || rows.some((row, index) => row.year !== first[index].year || row.yearIndex !== first[index].yearIndex)) throw new Error('unaligned ensemble years');
}
function window(rows: readonly AnnualBand[], options: CompareOptions): number[] {
  const from = options.fromYear ?? 10, through = options.throughYear ?? Infinity;
  if (!Number.isInteger(from) || from < 1 || options.throughYear !== undefined && (!Number.isInteger(through) || through < from)) throw new Error('invalid comparison year range');
  if (options.runs !== undefined && options.runs !== 5 && options.runs !== 9) throw new Error('comparison needs 5 or 9 runs');
  if (!rows.some((row) => row.yearIndex === from) || options.throughYear !== undefined && !rows.some((row) => row.yearIndex === through)) throw new Error('no annual observation at requested comparison boundary');
  const indices = rows.flatMap((row, index) => row.yearIndex >= from && row.yearIndex <= through ? [index] : []);
  if (!indices.length) throw new Error('no annual observations in comparison range');
  return indices;
}
export function relativePercent(delta: number, reference: number): number | null {
  return reference === 0 ? delta === 0 ? 0 : null : 100 * delta / Math.abs(reference);
}
export function toleranceUnits(tolerance: Tolerance, reference: number): number {
  if (!tolerance || !['absolute', 'percent'].includes(tolerance.kind) || !Number.isFinite(tolerance.value) || tolerance.value < 0) throw new Error('tolerance must be a nonnegative absolute value or percentage');
  return finite(tolerance.kind === 'percent' ? Math.abs(reference) * tolerance.value / 100 : tolerance.value, 'tolerance');
}
function metricTolerance(options: CompareOptions, metric: MetricName, reference: number): number {
  const tolerance = options.tolerance;
  return toleranceUnits(tolerance && 'kind' in tolerance ? tolerance : tolerance?.[metric] ?? { kind: 'absolute', value: 0 }, reference);
}

/** Both clauses are required; base rows require nine members directly under NOTE-062. */
export function compareBase(dev: AnnualBand[], lane: AnnualBand[], options: CompareOptions = {}): BaseComparison {
  aligned(dev, lane);
  const chosenMetrics = selectedMetrics(options, dev, lane);
  const years = window(dev, options).map((index): BaseYearVerdict => {
    const reference = dev[index], other = lane[index];
    const metrics = Object.fromEntries(chosenMetrics.map((metric) => {
      const control = reference.metrics[metric]!, value = other.metrics[metric]!.median;
      const tolerance = metricTolerance(options, metric, control.median), allowedDelta = Math.max(tolerance, control.width / 2);
      const delta = value - control.median, withinBand = value >= control.min && value <= control.max, withinDelta = Math.abs(delta) <= allowedDelta;
      const deltaLower = control.median - allowedDelta, deltaUpper = control.median + allowedDelta;
      const lower = Math.max(control.min, deltaLower), upper = Math.min(control.max, deltaUpper);
      const thresholds: Threshold[] = [
        { boundary: 'lower', value: lower, reasons: [...(lower === control.min ? ['dev-min'] : []), ...(lower === deltaLower ? ['median-minus-allowed-delta'] : [])], distance: Math.abs(value - lower) },
        { boundary: 'upper', value: upper, reasons: [...(upper === control.max ? ['dev-max'] : []), ...(upper === deltaUpper ? ['median-plus-allowed-delta'] : [])], distance: Math.abs(value - upper) },
      ];
      const exempt = (options.runs ?? 9) === 9 && metric === 'ihtShare' && control.min === 0 && control.max === 0;
      return [metric, { pass: exempt || withinBand && withinDelta, gated: !exempt, exemption: exempt ? 'zero-dev-iht-share' : null,
        control, lane: value, delta, relativePercent: relativePercent(delta, control.median),
        tolerance, allowedDelta, withinBand, withinDelta, lower, upper, thresholds,
        nearThreshold: !exempt && thresholds.some((threshold) => threshold.distance <= control.width / 2) } satisfies BaseMetricVerdict];
    })) as Record<MetricName, BaseMetricVerdict>;
    return { yearIndex: reference.yearIndex, year: reference.year, pass: chosenMetrics.every((metric) => metrics[metric].pass), metrics };
  });
  const nearThreshold = years.some((year) => chosenMetrics.some((metric) => year.metrics[metric].nearThreshold)), runs = options.runs ?? 9;
  const first = lane.find((row) => row.metrics.ihtShare.median !== 0);
  return { pass: years.every((year) => year.pass), years, nearThreshold, needsNine: runs === 5, runs,
    firstLaneIhtNonzero: first ? { yearIndex: first.yearIndex, year: first.year, median: first.metrics.ihtShare.median } : null };
}

/** Same-commit base/variant identity is checked by the CLI; the separate dev band controls stage two. */
export function compareVariant(dev: AnnualBand[], base: AnnualBand[], variant: AnnualBand[], target: VariantTarget, options: CompareOptions = {}): VariantComparison {
  aligned(dev, base, variant);
  if (!ALL_METRICS.includes(target.metric) || !['below', 'above'].includes(target.direction)) throw new Error('invalid variant target');
  selectedMetrics({ metrics: [target.metric] }, dev, base, variant);
  const years = window(base, options).map((index): VariantYearVerdict => {
    const row = base[index], control = row.metrics[target.metric]!.median, value = variant[index].metrics[target.metric]!.median;
    const amount = toleranceUnits(target.amount, control), threshold = control + (target.direction === 'below' ? -amount : amount);
    const devBand = dev[index].metrics[target.metric]!, distance = Math.abs(value - threshold), delta = value - control;
    return { yearIndex: row.yearIndex, year: row.year, pass: target.direction === 'below' ? value <= threshold : value >= threshold,
      base: control, variant: value, delta, relativePercent: relativePercent(delta, control), threshold, amount, distance,
      devBand, nearThreshold: distance <= devBand.width / 2 };
  });
  const nearThreshold = years.some((year) => year.nearThreshold), longRow = base.at(-1)!.yearIndex === 60, runs = options.runs ?? (longRow ? 9 : 5);
  return { pass: years.every((year) => year.pass), metric: target.metric, target, years, nearThreshold, needsNine: runs === 5 && (longRow || nearThreshold), runs };
}

export interface ShiftRow { id: string; dev: AnnualBand[]; lane: AnnualBand[]; runs?: 5 | 9 }
export interface ShiftMetric {
  realShift: boolean; direction: 'above' | 'below' | null;
  rows: { id: string; yearIndex: number; year: number; dev: number; lane: number; delta: number; quarterBand: number; gated: boolean }[];
}
/** The required short row ends at year 15; the two long rows end at year 60. */
export function systematicShift(rows: ShiftRow[], metrics: readonly MetricName[] = METRICS): Record<MetricName, ShiftMetric> {
  if (rows.length !== 3 || new Set(rows.map((row) => row.id)).size !== 3) throw new Error('systematic shift needs all three distinct rows');
  for (const row of rows) { aligned(row.dev, row.lane); selectedMetrics({ metrics }, row.dev, row.lane); }
  return Object.fromEntries(metrics.map((metric) => {
    const endpoints = rows.map((row) => {
      const control = row.dev.at(-1)!, lane = row.lane.at(-1)!.metrics[metric]!.median, value = control.metrics[metric]!;
      return { id: row.id, yearIndex: control.yearIndex, year: control.year, dev: value.median, lane, delta: lane - value.median,
        quarterBand: value.width / 4, gated: !(row.runs !== 5 && metric === 'ihtShare' && value.min === 0 && value.max === 0) };
    });
    const direction = endpoints.every((row) => row.gated && row.delta > row.quarterBand) ? 'above' : endpoints.every((row) => row.gated && row.delta < -row.quarterBand) ? 'below' : null;
    return [metric, { realShift: direction !== null, direction, rows: endpoints }];
  })) as Record<MetricName, ShiftMetric>;
}

export interface DisjointYear { yearIndex: number; year: number; direction: 'above' | 'below'; dev: MetricBand; lane: MetricBand }
export interface DisjointStreak { fromYear: number; throughYear: number; years: number; direction: 'above' | 'below' | 'mixed'; observations: DisjointYear[] }
export interface DisjointShift { realShift: boolean; longestRun: number; streaks: DisjointStreak[] }
/** A touching endpoint is overlap; zero-dev I-HT years do not contribute to a shift. */
export function disjointBandShift(dev: AnnualBand[], lane: AnnualBand[], options: CompareOptions = {}): Record<MetricName, DisjointShift> {
  aligned(dev, lane);
  const metrics = selectedMetrics(options, dev, lane), indices = window(dev, options);
  return Object.fromEntries(metrics.map((metric) => {
    const streaks: DisjointStreak[] = [];
    let pending: DisjointYear[] = [];
    const finish = () => {
      if (!pending.length) return;
      streaks.push({ fromYear: pending[0].yearIndex, throughYear: pending.at(-1)!.yearIndex, years: pending.length,
        direction: pending.every((year) => year.direction === pending[0].direction) ? pending[0].direction : 'mixed', observations: pending });
      pending = [];
    };
    for (const index of indices) {
      const reference = dev[index], control = reference.metrics[metric]!, value = lane[index].metrics[metric]!;
      const exempt = (options.runs ?? 9) === 9 && metric === 'ihtShare' && control.min === 0 && control.max === 0;
      const direction = exempt ? null : value.min > control.max ? 'above' : value.max < control.min ? 'below' : null;
      if (direction) pending.push({ yearIndex: reference.yearIndex, year: reference.year, direction, dev: control, lane: value });
      else finish();
    }
    finish();
    const longestRun = Math.max(0, ...streaks.map((streak) => streak.years));
    return [metric, { realShift: longestRun >= 3, longestRun, streaks }];
  })) as Record<MetricName, DisjointShift>;
}

export function memberEndpoints(members: readonly EnsembleMember[], requested?: readonly MetricName[]) {
  const summary = summarizeEnsemble(members), metrics = requested ?? metricsIn(summary);
  if (!summary.some((row) => row.yearIndex === 50 && row.year === 2050) || !summary.some((row) => row.yearIndex === 60 && row.year === 2060)) throw new Error('member endpoints need annual 2050 and 2060 observations');
  const available = metrics.filter((metric) => members.every((member) => member.rows.find((row) => row.year === 2060)?.[metric] !== undefined));
  const values = members.map((member) => {
    const start = member.rows.find((row) => row.year === 2050)!, end = member.rows.find((row) => row.year === 2060)!;
    const growth2050to2060 = end.population - start.population;
    return { id: member.id, population2050: start.population, population2060: end.population, growth2050to2060,
      stalled: growth2050to2060 < 100_000, values: Object.fromEntries(available.map((metric) => [metric, end[metric]!])) as Partial<Record<MetricName, number>> };
  });
  return { yearIndex: 60 as const, year: 2060 as const, stalledBelow: 100_000 as const, metrics: available,
    missingMetrics: metrics.filter((metric) => !available.includes(metric)), memberCount: members.length,
    stalledCount: values.filter((member) => member.stalled).length, members: values };
}

export interface SignoffMetric {
  delta: number; relativePercent: number | null; limit: number; outside: boolean; dev: number; lane: number; gated: boolean;
}
export interface SignoffYear { yearIndex: number; year: number; metrics: Record<MetricName, SignoffMetric> }
export function relativeSignoff(dev: AnnualBand[], lane: AnnualBand[], percent = 3, options: Pick<CompareOptions, 'fromYear' | 'throughYear' | 'metrics' | 'runs'> = {}) {
  aligned(dev, lane);
  const metrics = selectedMetrics(options, dev, lane);
  toleranceUnits({ kind: 'percent', value: percent }, 1);
  const valuesAt = (index: number): Record<MetricName, SignoffMetric> => Object.fromEntries(metrics.map((metric) => {
    const reference = dev[index].metrics[metric]!.median, value = lane[index].metrics[metric]!.median, delta = value - reference;
    const limit = toleranceUnits({ kind: 'percent', value: percent }, reference);
    const control = dev[index].metrics[metric]!, gated = !((options.runs ?? 9) === 9 && metric === 'ihtShare' && control.min === 0 && control.max === 0);
    return [metric, { delta, relativePercent: relativePercent(delta, reference), limit, outside: gated && Math.abs(delta) > limit, dev: reference, lane: value, gated }];
  })) as Record<MetricName, SignoffMetric>;
  const years = window(dev, options).map((index): SignoffYear => ({ yearIndex: dev[index].yearIndex, year: dev[index].year,
    metrics: valuesAt(index) }));
  const endpoint = dev.at(-1)!, endpointMetrics = valuesAt(dev.length - 1);
  return { percent, years, endpointYearIndex: endpoint.yearIndex, endpointYear: endpoint.year,
    metrics: Object.fromEntries(metrics.map((metric) => [metric, {
      outsideYears: years.filter((year) => year.metrics[metric].outside).map((year) => year.yearIndex),
      reopen: endpointMetrics[metric].outside, final: endpointMetrics[metric],
    }])) as Record<MetricName, { outsideYears: number[]; reopen: boolean; final: SignoffMetric }> };
}
