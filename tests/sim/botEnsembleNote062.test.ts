import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareBase, compareVariant, disjointBandShift, memberEndpoints, METRICS, metricsIn, summarizeEnsemble, systematicShift,
  type AnnualBand, type AnnualMetrics, type Metric,
} from '../../tools/simEnsembleStats';
import { compareCli, parseCompareOptions, projectFiveMemberSummary, validateComparisonPair, validateSummary, validateVariantPair } from '../../tools/simEnsembleCompare.mjs';

function rows(value: number, years = 15): AnnualMetrics[] {
  return Array.from({ length: years }, (_, index) => ({ yearIndex: index + 1, year: 2001 + index,
    population: value, approval: value, air: value, ihtShare: value }));
}
function bands(value: number, min = value, max = value, years = 15): AnnualBand[] {
  return rows(value, years).map((row) => ({ yearIndex: row.yearIndex, year: row.year,
    metrics: Object.fromEntries(METRICS.map((metric) => [metric, { median: value, min, max, width: max - min }])) as AnnualBand['metrics'] }));
}
function change(values: AnnualBand[], yearIndex: number, metric: Metric, value: number): void {
  values[yearIndex - 1].metrics[metric] = { median: value, min: value, max: value, width: 0 };
}
function summary(years = 15, runs: 5 | 9 = 9) {
  return validateSummary({ protocol: 'NOTE-062', complete: true, row: { size: years === 15 ? 128 : 256, years, seed: 7 },
    source: { commit: 'tree', simBlob: 'bot', srcTree: 'src' }, configuration: { botArgs: [], variant: false }, nudge: 100, runs,
    members: [{ id: 'control', nudge: 0, day: 1 }, ...[1, ...(runs === 9 ? [2] : [])].flatMap((multiple) => [1, 1441].flatMap((day) =>
      [100 * multiple, -100 * multiple].map((nudge) => ({ id: `${nudge}:${day}`, nudge, day }))))], years: bands(100, 90, 110, years) });
}

describe('bot: NOTE-062 final stages and observational bands', () => {
  it('requires nine directly for every base and long variant, with no third stage', () => {
    const dev = bands(100, 90, 110), lane = bands(1000);
    expect(compareBase(dev, lane, { runs: 5 })).toMatchObject({ nearThreshold: false, needsNine: true });
    expect(compareBase(dev, bands(100), { runs: 9 })).toMatchObject({ nearThreshold: true, needsNine: false });
    const target = { metric: 'population', direction: 'below', amount: { kind: 'percent', value: 2 } } as const;
    expect(compareVariant(dev, bands(100), bands(1), target, { runs: 5 }).needsNine).toBe(false);
    expect(compareVariant(bands(100, 90, 110, 60), bands(100, 100, 100, 60), bands(1, 1, 1, 60), target, { runs: 5 }))
      .toMatchObject({ nearThreshold: false, needsNine: true });
    expect(compareVariant(dev, bands(100), bands(98), target, { runs: 9 })).toMatchObject({ nearThreshold: true, needsNine: false });
  });

  it('summarizes complete collector observations without fabricating old-cache readings', () => {
    const members = [0, 1, 2].map((offset) => ({ id: String(offset), rows: rows(70 + offset).map((row) => ({ ...row,
      commuteTerm: -offset, approvalNetCommute: row.approval + offset, ihtDemandShare: offset / 10 })) }));
    const summarized = summarizeEnsemble(members);
    expect(metricsIn(summarized)).toEqual([...METRICS, 'commuteTerm', 'approvalNetCommute', 'ihtDemandShare']);
    expect(summarized[9].metrics.approvalNetCommute).toEqual({ median: 72, min: 70, max: 74, width: 4 });
    expect(compareBase(summarized, summarized, { metrics: ['approvalNetCommute'] }).pass).toBe(true);
    const mixed = summarizeEnsemble([...members, { id: 'cached', rows: rows(70) }]);
    expect(metricsIn(mixed)).toEqual(METRICS);
    expect(() => compareBase(mixed, mixed, { metrics: ['approvalNetCommute'] })).toThrow('missing approvalNetCommute');
    members[0].rows[0].commuteTerm = NaN;
    expect(() => summarizeEnsemble(members)).toThrow('finite');
  });

  it('exempts only an exactly-zero nine-member dev I-HT band and reports first activation', () => {
    const dev = bands(100, 90, 110), lane = bands(100);
    for (let year = 1; year <= 15; year++) { change(dev, year, 'ihtShare', 0); change(lane, year, 'ihtShare', year >= 3 ? 0.2 : 0); }
    const result = compareBase(dev, lane, { metrics: ['ihtShare'], runs: 9 });
    expect(result).toMatchObject({ pass: true, nearThreshold: false, needsNine: false, firstLaneIhtNonzero: { yearIndex: 3, year: 2003, median: 0.2 } });
    expect(result.years[0].metrics.ihtShare).toMatchObject({ gated: false, exemption: 'zero-dev-iht-share', withinBand: false });
    expect(compareBase(dev, lane, { metrics: ['ihtShare'], runs: 5 }).pass).toBe(false);
    change(dev, 10, 'ihtShare', 0.1);
    expect(compareBase(dev, lane, { metrics: ['ihtShare'] }).years[0].metrics.ihtShare).toMatchObject({ pass: false, gated: true });
    const triples = [15, 60, 60].map((years, index) => ({ id: String(index), dev: bands(0, 0, 0, years), lane: bands(1, 1, 1, years), runs: 9 as const }));
    expect(systematicShift(triples).ihtShare.realShift).toBe(false);
    expect(disjointBandShift(bands(0), bands(1), { metrics: ['ihtShare'] }).ihtShare.realShift).toBe(false);
  });

  it('reports three disjoint years as a real shift even when sides alternate; touching breaks the run', () => {
    const dev = bands(100, 90, 110), lane = bands(100, 90, 110);
    change(lane, 10, 'population', 111); change(lane, 11, 'population', 89); change(lane, 12, 'population', 111);
    const shifted = disjointBandShift(dev, lane).population;
    expect(shifted).toMatchObject({ realShift: true, longestRun: 3 });
    expect(shifted.streaks[0]).toMatchObject({ fromYear: 10, throughYear: 12, years: 3, direction: 'mixed' });
    change(lane, 11, 'population', 110);
    expect(disjointBandShift(dev, lane).population).toMatchObject({ realShift: false, longestRun: 1 });
    expect(() => disjointBandShift(dev.filter((row) => row.yearIndex !== 11), lane.filter((row) => row.yearIndex !== 11))).toThrow('nonconsecutive');
  });

  it('reports actual member endpoints and a strict under-100,000 stalled count without gating it', () => {
    const members = [99_999, 100_000, -1].map((growth, index) => ({ id: String(index), rows: rows(1_000_000, 60) }));
    members.forEach((member, index) => { member.rows[59].population += [99_999, 100_000, -1][index]; });
    const result = memberEndpoints(members, ['population', 'approvalNetCommute']);
    expect(result).toMatchObject({ memberCount: 3, stalledCount: 2, missingMetrics: ['approvalNetCommute'], metrics: ['population'] });
    expect(result.members.map((member) => member.stalled)).toEqual([true, false, true]);
    expect(result.members[0]).toMatchObject({ population2050: 1_000_000, population2060: 1_099_999, growth2050to2060: 99_999, values: { population: 1_099_999 } });
    expect(() => memberEndpoints([{ id: 'short', rows: rows(100) }])).toThrow('2050 and 2060');
  });

  it('accepts the new optional metric and ignores role metadata when matching scientific arguments', () => {
    expect(parseCompareOptions(['base', '--dev', 'dev', '--lane', 'lane', '--metric', 'approvalNetCommute', '--out-dir', 'out']).metrics).toEqual(['approvalNetCommute']);
    const base = summary(), roleOnly = structuredClone(base); roleOnly.configuration.variant = true;
    expect(() => validateComparisonPair(base, roleOnly)).not.toThrow();
    expect(() => validateVariantPair(base, roleOnly)).toThrow('arguments must differ');
  });

  it('projects the actual matching five short members instead of using a nine-member aggregate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'metropolis-note062-projection-'));
    try {
      const base = summary();
      base.members.forEach((member, index) => {
        const path = join(dir, `${index}.json`); member.path = path;
        writeFileSync(path, JSON.stringify({ complete: true, spec: { ...base.source, ...base.row, nudge: member.nudge, day: member.day, botArgs: [] }, rows: rows(index < 5 ? index + 1 : 1000) }), 'utf8');
      });
      const projected = projectFiveMemberSummary(base, join(dir, 'summary.json'));
      expect(projected.runs).toBe(5); expect(projected.members).toHaveLength(5);
      expect(projected.years[0].metrics.population).toEqual({ median: 3, min: 1, max: 5, width: 4 });
      expect(base.runs).toBe(9); expect(base.years[0].metrics.population.median).toBe(100);
      const firstPath = base.members[0].path!, wrong = JSON.parse(readFileSync(firstPath, 'utf8'));
      wrong.spec.seed = 11; writeFileSync(firstPath, JSON.stringify(wrong), 'utf8');
      expect(() => projectFiveMemberSummary(base, join(dir, 'summary.json'))).toThrow('ensemble origin');
      wrong.spec.seed = 7; wrong.spec.botArgs = ['--skip', 'dirty']; writeFileSync(firstPath, JSON.stringify(wrong), 'utf8');
      expect(() => projectFiveMemberSummary(base, join(dir, 'summary.json'))).toThrow('ensemble origin');
      expect(() => projectFiveMemberSummary(summary(60), join(dir, 'long.json'))).toThrow('only valid for a 128x15');
      const unavailable = summary(); expect(() => projectFiveMemberSummary(unavailable, join(dir, 'missing.json'))).toThrow('raw member path');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('writes disjoint shifts, zero exemptions and member columns to comparison evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'metropolis-note062-compare-')), previousExit = process.exitCode;
    try {
      const dev = summary(60), lane = summary(60);
      for (let index = 1; index <= 60; index++) { change(dev.years, index, 'ihtShare', 0); change(lane.years, index, 'ihtShare', 0.1); }
      for (let year = 10; year <= 12; year++) change(lane.years, year, 'population', 120);
      for (const [name, input] of [['dev', dev], ['lane', lane]] as const) {
        input.members.forEach((member, index) => {
          const path = join(dir, `${name}-${index}.json`); member.path = path;
          writeFileSync(path, JSON.stringify({ complete: true, spec: { ...input.source, ...input.row, nudge: member.nudge, day: member.day, botArgs: [] }, rows: rows(100, 60) }), 'utf8');
        });
        writeFileSync(join(dir, `${name}.json`), JSON.stringify(input), 'utf8');
      }
      await compareCli(['base', '--dev', join(dir, 'dev.json'), '--lane', join(dir, 'lane.json'), '--out-dir', dir]);
      const evidence = JSON.parse(readFileSync(join(dir, 'base.compare.json'), 'utf8'));
      expect(evidence).toMatchObject({ realShift: true, status: 'investigate-real-shift', needsNine: [] });
      expect(evidence.evidence.results[0].disjointBandShift.population.longestRun).toBe(3);
      expect(evidence.evidence.memberEndpoints[0].evidence.lane.stalledCount).toBe(9);
      const markdown = readFileSync(join(dir, 'base.compare.md'), 'utf8');
      expect(markdown).toContain('9/9 stalled'); expect(markdown).toContain('Population growth 2050-2060');
      expect(markdown).toContain('zero-dev-iht-share'); expect(markdown).toContain('mechanism explanation');
    } finally { process.exitCode = previousExit; rmSync(dir, { recursive: true, force: true }); }
  });
});
