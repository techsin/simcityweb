/** NOTE-053 ensemble statistics and gates; all values retain their simulation units. */
export const METRICS = ['population', 'approval', 'air', 'ihtShare'] as const;
export type Metric = typeof METRICS[number];
export interface AnnualMetrics {
  yearIndex: number; year: number; population: number; approval: number; air: number; ihtShare: number;
}
export interface MetricBand { median: number; min: number; max: number; width: number }
export interface AnnualBand { yearIndex: number; year: number; metrics: Record<Metric, MetricBand> }
export interface EnsembleMember { id: string; rows: AnnualMetrics[] }
export interface Tolerance { kind: 'absolute' | 'percent'; value: number }
export interface CompareOptions {
  fromYear?: number; throughYear?: number; runs?: 5 | 9;
  tolerance?: Tolerance | Partial<Record<Metric, Tolerance>>;
}
export interface Threshold { boundary: 'lower' | 'upper'; value: number; reasons: string[]; distance: number }
export interface BaseMetricVerdict {
  pass: boolean; control: MetricBand; lane: number; delta: number; relativePercent: number | null;
  tolerance: number; allowedDelta: number; withinBand: boolean; withinDelta: boolean;
  lower: number; upper: number; thresholds: Threshold[]; nearThreshold: boolean;
}
export interface BaseYearVerdict { yearIndex: number; year: number; pass: boolean; metrics: Record<Metric, BaseMetricVerdict> }
export interface BaseComparison { pass: boolean; years: BaseYearVerdict[]; nearThreshold: boolean; needsNine: boolean; runs: 5 | 9 }
export interface VariantTarget { metric: Metric; direction: 'below' | 'above'; amount: Tolerance }
export interface VariantYearVerdict {
  yearIndex: number; year: number; pass: boolean; base: number; variant: number; delta: number;
  relativePercent: number | null; threshold: number; amount: number; distance: number;
  devBand: MetricBand; nearThreshold: boolean;
}
export interface VariantComparison { pass: boolean; metric: Metric; target: VariantTarget; years: VariantYearVerdict[]; nearThreshold: boolean; needsNine: boolean; runs: 5 | 9 }

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
    });
  }
  return reference.map((row, index) => ({ yearIndex: row.yearIndex, year: row.year,
    metrics: Object.fromEntries(METRICS.map((metric) => [metric, band(members.map((member) => member.rows[index][metric]))])) as Record<Metric, MetricBand> }));
}
function validateBands(rows: readonly AnnualBand[]): void {
  if (!rows.length) throw new Error('ensemble needs annual bands');
  observationKeys(rows);
  for (const row of rows) for (const metric of METRICS) {
    const value = row.metrics?.[metric];
    if (!value || ![value.median, value.min, value.max, value.width].every(Number.isFinite) ||
        value.min > value.median || value.median > value.max || value.width !== value.max - value.min) throw new Error(`invalid ${metric} ensemble band`);
  }
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
function metricTolerance(options: CompareOptions, metric: Metric, reference: number): number {
  const tolerance = options.tolerance;
  return toleranceUnits(tolerance && 'kind' in tolerance ? tolerance : tolerance?.[metric] ?? { kind: 'absolute', value: 0 }, reference);
}

/** Both clauses are required; only the intersection's active boundaries trigger stage two. */
export function compareBase(dev: AnnualBand[], lane: AnnualBand[], options: CompareOptions = {}): BaseComparison {
  aligned(dev, lane);
  const years = window(dev, options).map((index): BaseYearVerdict => {
    const reference = dev[index], other = lane[index];
    const metrics = Object.fromEntries(METRICS.map((metric) => {
      const control = reference.metrics[metric], value = other.metrics[metric].median;
      const tolerance = metricTolerance(options, metric, control.median), allowedDelta = Math.max(tolerance, control.width / 2);
      const delta = value - control.median, withinBand = value >= control.min && value <= control.max, withinDelta = Math.abs(delta) <= allowedDelta;
      const deltaLower = control.median - allowedDelta, deltaUpper = control.median + allowedDelta;
      const lower = Math.max(control.min, deltaLower), upper = Math.min(control.max, deltaUpper);
      const thresholds: Threshold[] = [
        { boundary: 'lower', value: lower, reasons: [...(lower === control.min ? ['dev-min'] : []), ...(lower === deltaLower ? ['median-minus-allowed-delta'] : [])], distance: Math.abs(value - lower) },
        { boundary: 'upper', value: upper, reasons: [...(upper === control.max ? ['dev-max'] : []), ...(upper === deltaUpper ? ['median-plus-allowed-delta'] : [])], distance: Math.abs(value - upper) },
      ];
      return [metric, { pass: withinBand && withinDelta, control, lane: value, delta, relativePercent: relativePercent(delta, control.median),
        tolerance, allowedDelta, withinBand, withinDelta, lower, upper, thresholds,
        nearThreshold: thresholds.some((threshold) => threshold.distance <= control.width / 2) } satisfies BaseMetricVerdict];
    })) as Record<Metric, BaseMetricVerdict>;
    return { yearIndex: reference.yearIndex, year: reference.year, pass: METRICS.every((metric) => metrics[metric].pass), metrics };
  });
  const nearThreshold = years.some((year) => METRICS.some((metric) => year.metrics[metric].nearThreshold)), runs = options.runs ?? 5;
  return { pass: years.every((year) => year.pass), years, nearThreshold, needsNine: runs === 5 && nearThreshold, runs };
}

/** Same-commit base/variant identity is checked by the CLI; the separate dev band controls stage two. */
export function compareVariant(dev: AnnualBand[], base: AnnualBand[], variant: AnnualBand[], target: VariantTarget, options: CompareOptions = {}): VariantComparison {
  aligned(dev, base, variant);
  if (!METRICS.includes(target.metric) || !['below', 'above'].includes(target.direction)) throw new Error('invalid variant target');
  const years = window(base, options).map((index): VariantYearVerdict => {
    const row = base[index], control = row.metrics[target.metric].median, value = variant[index].metrics[target.metric].median;
    const amount = toleranceUnits(target.amount, control), threshold = control + (target.direction === 'below' ? -amount : amount);
    const devBand = dev[index].metrics[target.metric], distance = Math.abs(value - threshold), delta = value - control;
    return { yearIndex: row.yearIndex, year: row.year, pass: target.direction === 'below' ? value <= threshold : value >= threshold,
      base: control, variant: value, delta, relativePercent: relativePercent(delta, control), threshold, amount, distance,
      devBand, nearThreshold: distance <= devBand.width / 2 };
  });
  const nearThreshold = years.some((year) => year.nearThreshold), runs = options.runs ?? 5;
  return { pass: years.every((year) => year.pass), metric: target.metric, target, years, nearThreshold, needsNine: runs === 5 && nearThreshold, runs };
}

export interface ShiftRow { id: string; dev: AnnualBand[]; lane: AnnualBand[] }
export interface ShiftMetric {
  realShift: boolean; direction: 'above' | 'below' | null;
  rows: { id: string; yearIndex: number; year: number; dev: number; lane: number; delta: number; quarterBand: number }[];
}
/** The required short row ends at year 15; the two long rows end at year 60. */
export function systematicShift(rows: ShiftRow[]): Record<Metric, ShiftMetric> {
  if (rows.length !== 3 || new Set(rows.map((row) => row.id)).size !== 3) throw new Error('systematic shift needs all three distinct rows');
  for (const row of rows) aligned(row.dev, row.lane);
  return Object.fromEntries(METRICS.map((metric) => {
    const endpoints = rows.map((row) => {
      const control = row.dev.at(-1)!, lane = row.lane.at(-1)!.metrics[metric].median, value = control.metrics[metric];
      return { id: row.id, yearIndex: control.yearIndex, year: control.year, dev: value.median, lane, delta: lane - value.median, quarterBand: value.width / 4 };
    });
    const direction = endpoints.every((row) => row.delta > row.quarterBand) ? 'above' : endpoints.every((row) => row.delta < -row.quarterBand) ? 'below' : null;
    return [metric, { realShift: direction !== null, direction, rows: endpoints }];
  })) as Record<Metric, ShiftMetric>;
}

export interface SignoffMetric {
  delta: number; relativePercent: number | null; limit: number; outside: boolean; dev: number; lane: number;
}
export interface SignoffYear { yearIndex: number; year: number; metrics: Record<Metric, SignoffMetric> }
export function relativeSignoff(dev: AnnualBand[], lane: AnnualBand[], percent = 3, options: Pick<CompareOptions, 'fromYear' | 'throughYear'> = {}) {
  aligned(dev, lane);
  toleranceUnits({ kind: 'percent', value: percent }, 1);
  const valuesAt = (index: number): Record<Metric, SignoffMetric> => Object.fromEntries(METRICS.map((metric) => {
    const reference = dev[index].metrics[metric].median, value = lane[index].metrics[metric].median, delta = value - reference;
    const limit = toleranceUnits({ kind: 'percent', value: percent }, reference);
    return [metric, { delta, relativePercent: relativePercent(delta, reference), limit, outside: Math.abs(delta) > limit, dev: reference, lane: value }];
  })) as Record<Metric, SignoffMetric>;
  const years = window(dev, options).map((index): SignoffYear => ({ yearIndex: dev[index].yearIndex, year: dev[index].year,
    metrics: valuesAt(index) }));
  const endpoint = dev.at(-1)!, endpointMetrics = valuesAt(dev.length - 1);
  return { percent, years, endpointYearIndex: endpoint.yearIndex, endpointYear: endpoint.year,
    metrics: Object.fromEntries(METRICS.map((metric) => [metric, {
      outsideYears: years.filter((year) => year.metrics[metric].outside).map((year) => year.yearIndex),
      reopen: endpointMetrics[metric].outside, final: endpointMetrics[metric],
    }])) as Record<Metric, { outsideYears: number[]; reopen: boolean; final: SignoffMetric }> };
}
