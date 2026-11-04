/** NOTE-053: ensemble medians, active gates and staged verdicts. */
import { describe, expect, it } from 'vitest';
import {
  band, compareBase, compareVariant, median, METRICS, relativeSignoff, summarizeEnsemble, systematicShift,
  type AnnualBand, type AnnualMetrics, type Metric,
} from '../../tools/simEnsembleStats';
import { parseCompareOptions, validateComparisonPair, validateSummary, validateVariantPair } from '../../tools/simEnsembleCompare.mjs';

function rows(value: number, years = 15): AnnualMetrics[] {
  return Array.from({ length: years }, (_, index) => ({ yearIndex: index + 1, year: 2001 + index,
    population: value, approval: value, air: value, ihtShare: value }));
}
function bands(medianValue: number, min = medianValue, max = medianValue, years = 15): AnnualBand[] {
  return rows(medianValue, years).map((row) => ({ yearIndex: row.yearIndex, year: row.year,
    metrics: Object.fromEntries(METRICS.map((metric) => [metric, { median: medianValue, min, max, width: max - min }])) as AnnualBand['metrics'] }));
}
function change(values: AnnualBand[], yearIndex: number, metric: Metric, value: number): void {
  values[yearIndex - 1].metrics[metric] = { median: value, min: value, max: value, width: 0 };
}

describe('bot: NOTE-053 ensemble statistics', () => {
  it('takes the middle member without sorting the source and supports conventional even medians', () => {
    const values = [9, 1, 8, 3, 2];
    expect(median(values)).toBe(3);
    expect(values).toEqual([9, 1, 8, 3, 2]);
    expect(median([4, 2, 8, 6])).toBe(5);
    expect(band(values)).toEqual({ median: 3, min: 1, max: 9, width: 8 });
    expect(median([Number.MAX_VALUE, Number.MAX_VALUE])).toBe(Number.MAX_VALUE);
    expect(() => median([])).toThrow('observations');
    expect(() => median([1, NaN])).toThrow('finite');
    expect(() => band([-Number.MAX_VALUE, Number.MAX_VALUE])).toThrow('finite');
  });

  it('builds all annual metric bands and changes the median when the four stage-two members are added', () => {
    const members = [100, 80, 120, 90, 110].map((value, index) => ({ id: String(index), rows: rows(value) }));
    const original = structuredClone(members);
    const five = summarizeEnsemble(members);
    expect(five[9]).toMatchObject({ yearIndex: 10, year: 2010, metrics: {
      population: { median: 100, min: 80, max: 120, width: 40 },
      ihtShare: { median: 100, min: 80, max: 120, width: 40 },
    } });
    const nine = summarizeEnsemble([...members, ...[70, 75, 76, 77].map((value, index) => ({ id: `extra${index}`, rows: rows(value) }))]);
    expect(nine[9].metrics.population).toEqual({ median: 80, min: 70, max: 120, width: 50 });
    expect(members).toEqual(original);
  });

  it('rejects missing, unaligned, duplicate and non-finite annual observations', () => {
    const member = { id: 'control', rows: rows(100) };
    expect(() => summarizeEnsemble([])).toThrow('members');
    expect(() => summarizeEnsemble([member, member])).toThrow('duplicate');
    expect(() => summarizeEnsemble([member, { id: 'short', rows: rows(100, 14) }])).toThrow('unaligned');
    const wrongYear = rows(100); wrongYear[9].year++;
    expect(() => summarizeEnsemble([member, { id: 'wrong', rows: wrongYear }])).toThrow('unaligned');
    const invalid = rows(100); invalid[9].air = Infinity;
    expect(() => summarizeEnsemble([{ id: 'invalid', rows: invalid }])).toThrow('finite');
  });
});

describe('bot: NOTE-053 base gates and second stage', () => {
  it('requires both the dev band and the median-distance gate, including equality', () => {
    const dev = bands(100, 80, 150), lane = bands(135);
    expect(compareBase(dev, lane).years[0].metrics.population).toMatchObject({ pass: true, allowedDelta: 35, lower: 80, upper: 135 });
    change(lane, 10, 'population', 136);
    expect(compareBase(dev, lane).years[0].metrics.population).toMatchObject({ pass: false, withinBand: true, withinDelta: false });
    change(lane, 10, 'population', 151);
    expect(compareBase(dev, lane, { tolerance: { kind: 'absolute', value: 100 } }).years[0].metrics.population).toMatchObject({ pass: false, withinBand: false, withinDelta: true });
    change(lane, 10, 'population', 80);
    expect(compareBase(dev, lane).years[0].metrics.population.pass).toBe(true);
  });

  it('applies a percent tolerance in each control year, never widens past the band and skips pre-year-10 failures', () => {
    const dev = bands(100, 80, 150), lane = bands(140);
    change(lane, 9, 'air', 10_000);
    const compared = compareBase(dev, lane, { tolerance: { kind: 'percent', value: 40 } });
    expect(compared.pass).toBe(true);
    expect(compared.years).toHaveLength(6);
    expect(compared.years[0].metrics.population).toMatchObject({ tolerance: 40, allowedDelta: 40, lower: 80, upper: 140 });
    expect(compareBase(dev, lane, { tolerance: { population: { kind: 'absolute', value: 40 } } }).years[0].metrics.approval.pass).toBe(false);
    expect(() => compareBase(dev, lane, { tolerance: { kind: 'percent', value: -1 } })).toThrow('nonnegative');
  });

  it('reports only active intersection thresholds and includes exact half-band distances', () => {
    const dev = bands(100, 80, 150), lane = bands(170);
    const metric = compareBase(dev, lane).years[0].metrics.population;
    expect(metric.thresholds).toEqual([
      { boundary: 'lower', value: 80, reasons: ['dev-min'], distance: 90 },
      { boundary: 'upper', value: 135, reasons: ['median-plus-allowed-delta'], distance: 35 },
    ]);
    expect(metric.nearThreshold).toBe(true);
    expect(compareBase(dev, lane).needsNine).toBe(true);
    change(lane, 10, 'population', 170.1);
    expect(compareBase(dev, lane).years[0].metrics.population.nearThreshold).toBe(false);
    const resolved = compareBase(dev, bands(100), { runs: 9 });
    expect(resolved.nearThreshold).toBe(true);
    expect(resolved.needsNine).toBe(false);
  });

  it('handles a zero-width band literally and rejects incompatible years and empty windows', () => {
    const equal = compareBase(bands(0), bands(0));
    expect(equal.pass).toBe(true);
    expect(equal.years[0].metrics.air.relativePercent).toBe(0);
    expect(equal.needsNine).toBe(true); // Distance zero is within the zero half-band.
    const moved = compareBase(bands(0), bands(1));
    expect(moved.pass).toBe(false);
    expect(moved.years[0].metrics.air.relativePercent).toBeNull();
    expect(moved.needsNine).toBe(false);
    expect(() => compareBase(bands(100, 100, 100, 15), bands(100, 100, 100, 14))).toThrow('unaligned');
    expect(() => compareBase(bands(100), bands(100), { fromYear: 16 })).toThrow('no annual');
  });

  it('rejects a year missing from both trajectories and requires the requested window boundaries', () => {
    const dev = bands(100), lane = bands(100);
    const withoutEleven = (values: AnnualBand[]) => values.filter((year) => year.yearIndex !== 11);
    expect(() => compareBase(withoutEleven(dev), withoutEleven(lane))).toThrow('nonconsecutive');
    expect(() => compareBase(dev.slice(10), lane.slice(10))).toThrow('boundary');
    expect(() => compareBase(dev, lane, { throughYear: 25 })).toThrow('boundary');
    expect(compareBase(dev.slice(9), lane.slice(9), { throughYear: 15 }).years.map((year) => year.yearIndex)).toEqual([10, 11, 12, 13, 14, 15]);
    const missingCalendarYear = structuredClone(dev); missingCalendarYear[10].year++;
    expect(() => compareBase(missingCalendarYear, missingCalendarYear)).toThrow('nonconsecutive');
  });
});

describe('bot: NOTE-053 targets, systematic shifts and historical sign-off', () => {
  it('compares a variant with its lane base and uses the separate dev band for stage two', () => {
    const dev = bands(200, 190, 210), base = bands(100), variant = bands(98);
    const target = { metric: 'population', direction: 'below', amount: { kind: 'percent', value: 2 } } as const;
    const result = compareVariant(dev, base, variant, target);
    expect(result).toMatchObject({ pass: true, needsNine: true });
    expect(result.years[0]).toMatchObject({ threshold: 98, delta: -2, relativePercent: -2, distance: 0, devBand: { width: 20 } });
    change(variant, 10, 'population', 98.01);
    expect(compareVariant(dev, base, variant, target).pass).toBe(false);
    expect(compareVariant(dev, base, bands(1000), target).needsNine).toBe(false);
    expect(compareVariant(dev, base, bands(98), target, { runs: 9 }).needsNine).toBe(false);
  });

  it('supports absolute above targets and percentages of negative and zero baselines', () => {
    const dev = bands(0), target = { metric: 'approval', direction: 'above', amount: { kind: 'absolute', value: 3 } } as const;
    expect(compareVariant(dev, bands(-10), bands(-7), target).pass).toBe(true);
    expect(compareVariant(dev, bands(-100), bands(-102), { metric: 'approval', direction: 'below', amount: { kind: 'percent', value: 2 } }).pass).toBe(true);
    const zero = compareVariant(dev, bands(0), bands(0), { metric: 'air', direction: 'below', amount: { kind: 'percent', value: 2 } });
    expect(zero.years[0]).toMatchObject({ pass: true, threshold: 0, relativePercent: 0 });
  });

  it('uses each of the three endpoints, strict quarter-band shifts and independent metric directions', () => {
    const comparisons = [15, 60, 60].map((years, index) => ({ id: `row${index}`, dev: bands(100, 80, 120, years), lane: bands(111, 111, 111, years) }));
    const result = systematicShift(comparisons);
    expect(result.population).toMatchObject({ realShift: true, direction: 'above' });
    expect(result.population.rows.map((row) => row.yearIndex)).toEqual([15, 60, 60]);
    comparisons[0].lane[14].metrics.population = { median: 110, min: 110, max: 110, width: 0 };
    expect(systematicShift(comparisons).population.realShift).toBe(false);
    for (const row of comparisons) change(row.lane, row.lane.length, 'air', 89);
    expect(systematicShift(comparisons).air.direction).toBe('below');
    expect(() => systematicShift(comparisons.slice(1))).toThrow('all three');
  });

  it('reports intermediate ±3% excursions but reopens sign-off only for the endpoint', () => {
    const dev = bands(100), lane = bands(102);
    change(lane, 10, 'population', 104);
    change(lane, 15, 'air', 96);
    const signoff = relativeSignoff(dev, lane);
    expect(signoff.metrics.population).toMatchObject({ outsideYears: [10], reopen: false });
    expect(signoff.metrics.air).toMatchObject({ outsideYears: [15], reopen: true });
    expect(relativeSignoff(dev, bands(103)).metrics.population.reopen).toBe(false);
    expect(relativeSignoff(bands(0), bands(1)).metrics.population).toMatchObject({ reopen: true, final: { relativePercent: null, limit: 0 } });
    const throughTen = relativeSignoff(dev, lane, 3, { throughYear: 10 });
    expect(throughTen).toMatchObject({ endpointYearIndex: 15, endpointYear: 2015 });
    expect(throughTen.metrics.population).toMatchObject({ outsideYears: [10], reopen: false, final: { delta: 2 } });
    expect(throughTen.metrics.air).toMatchObject({ outsideYears: [], reopen: true, final: { delta: -4 } });
  });
});

describe('bot: NOTE-053 compare CLI identity', () => {
  function summary() {
    return validateSummary({ protocol: 'NOTE-053', complete: true,
      row: { size: 128, years: 15, seed: 7 }, source: { commit: 'same-lane-commit', simBlob: 'bot', srcTree: 'src' },
      configuration: { botArgs: [] }, nudge: 100, runs: 5,
      members: [{ id: 'control', nudge: 0, day: 1 },
        ...[1, 1441].flatMap((day) => [100, -100].map((nudge) => ({ id: `${nudge}:${day}`, nudge, day })))],
      years: bands(100, 90, 110) });
  }

  it('parses repeated row inputs, metric selection and percentage targets', () => {
    const options = parseCompareOptions(['base', '--dev', 'dev.json', '--dev', 'dev2.json', '--lane', 'lane2.json', '--lane', 'lane.json',
      '--out-dir', 'out', '--metric', 'population,air', '--tolerance-percent', '3']);
    expect(options).toMatchObject({ mode: 'base', metrics: ['population', 'air'], tolerance: { kind: 'percent', value: 3 }, fromYear: 10 });
    expect(options.dev).toHaveLength(2);
    expect(parseCompareOptions(['variant', '--dev', 'dev', '--base', 'base', '--variant', 'variant', '--metric', 'population', '--out-dir', 'out', '--target-below-percent', '2']))
      .toMatchObject({ target: { metric: 'population', direction: 'below', amount: { kind: 'percent', value: 2 } } });
    expect(() => parseCompareOptions(['base', '--dev', 'dev', '--lane', 'lane', '--out-dir', 'out', '--tolerance', '1', '--tolerance-percent', '1'])).toThrow('choose absolute');
    expect(() => parseCompareOptions(['variant', '--dev', 'dev', '--base', 'base', '--variant', 'variant', '--out-dir', 'out', '--target-below-percent', '2'])).toThrow('metric');
  });

  it('requires a complete signed/timed ensemble and rejects a duplicated or missing member', () => {
    const valid = summary();
    expect(validateSummary(valid)).toBe(valid);
    expect(() => validateSummary({ ...valid, complete: false })).toThrow('complete');
    expect(() => validateSummary({ ...valid, members: valid.members.slice(1) })).toThrow('complete');
    const duplicate = structuredClone(valid); duplicate.members[4] = duplicate.members[3];
    expect(() => validateSummary(duplicate)).toThrow('members');
    const invalid = structuredClone(valid); invalid.years[0].metrics.population.width = 1;
    expect(() => validateSummary(invalid)).toThrow('band');
  });

  it('requires the exact same lane commit and source for base/variant, while allowing a different dev commit', () => {
    const base = summary(), variant = structuredClone(base);
    variant.configuration.botArgs.push('--neglect');
    expect(() => validateVariantPair(base, variant)).not.toThrow();
    variant.source.commit = 'other-commit';
    expect(() => validateVariantPair(base, variant)).toThrow('exact same lane commit');
    expect(() => validateComparisonPair(base, { ...base, source: { ...base.source, commit: 'different-dev' } })).not.toThrow();
    expect(() => validateVariantPair(base, base)).toThrow('arguments must differ');
    expect(() => validateComparisonPair(base, { ...base, nudge: 200 })).toThrow('nudge');
    expect(() => validateComparisonPair(base, { ...base, runs: 9 })).toThrow('run count');
    const differentDependencies = structuredClone(base);
    differentDependencies.configuration.botArgs.push('--neglect');
    differentDependencies.source.dependencies = 'changed';
    expect(() => validateVariantPair(base, differentDependencies)).toThrow('dependency or observer');
    const differentObserver = structuredClone(base);
    differentObserver.configuration.botArgs.push('--neglect');
    differentObserver.source.observer = 'changed';
    expect(() => validateVariantPair(base, differentObserver)).toThrow('dependency or observer');
  });
});
