/** NOTE-052: fork qualification, reuse and the four-probe envelope contract. */
import { describe, expect, it } from 'vitest';
import {
  firstLogDifference, parseOptions, sameSource, summarizeEnvelope, validateCompleted,
  type AnnualMetrics,
} from '../../tools/simAaForkEnvelope.mjs';

const source = { commit: 'docs-one', simBlob: 'bot', srcTree: 'simulation' };
const row = { size: 128, years: 15, seed: 7 };
const args = ['--size', '128', '--years', '15', '--seed', '7', '--out-dir', 'out', '--quiet-gate', 'gate.mjs'];
const annuals = (): AnnualMetrics[] => Array.from({ length: 15 }, (_, i) => ({
  yearIndex: i + 1, year: 2001 + i, population: 1000, air: 0.1, approval: 50, ihtShare: 0,
}));

describe('bot: NOTE-052 fork envelope', () => {
  it('accepts exhaustive collection and rejects ambiguous or unsupported candidates', () => {
    expect(parseOptions([...args, '--all-sizes', '--report-only'])).toMatchObject({ ...row, allSizes: true, reportOnly: true });
    expect(parseOptions([...args, '--nudge', '100'])).toMatchObject({ nudge: 100, allSizes: false });
    expect(() => parseOptions([...args, '--nudge', '1'])).toThrow('--nudge');
    expect(() => parseOptions([...args, '--all-sizes', '--nudge', '10'])).toThrow('mutually exclusive');
    expect(() => parseOptions([...args, '--seed', '11'])).toThrow('row must be');
  });

  it('qualifies a full-log fork by day and text, excluding observational metadata and funds', () => {
    const control = [{ day: 30, text: 'built a road', funds: 100, date: 'January' }];
    expect(firstLogDifference(control, [{ ...control[0], funds: 110, date: 'other label' }])).toBeNull();
    expect(firstLogDifference(control, [{ ...control[0], day: 60 }])?.index).toBe(0);
    expect(firstLogDifference(control, [{ ...control[0], text: 'built a park' }])?.index).toBe(0);
  });

  it('shows the next control event for an insertion and handles a trace ending', () => {
    const shared = { day: 30, text: 'built a road' }, next = { day: 90, text: 'built homes' };
    const inserted = { day: 60, text: 'built a park' };
    expect(firstLogDifference([shared, next], [shared, inserted, next])).toEqual({ index: 1, control: next, nudge: inserted });
    expect(firstLogDifference([shared], [shared, inserted])).toEqual({ index: 1, control: null, nudge: inserted });
    expect(firstLogDifference([], [])).toBeNull();
  });

  it('pools four probes from year 10 and keeps absolute and relative maxima independent', () => {
    const base = annuals();
    base[10].population = 10;
    const runs = ['plus-day1', 'minus-day1', 'plus-year5', 'minus-year5'].map(id => ({ id, rows: structuredClone(base) }));
    runs[0].rows[8].population = 1_000_000; // Outside the envelope window.
    runs[1].rows[9].population = 1100;
    runs[3].rows[10].population = 30;
    const result = summarizeEnvelope(base, runs).population;
    expect(result).toMatchObject({ delta: 100, year: 2010, control: 1000, relativePercent: 10, run: 'minus-day1',
      maxAnnualRelativePercent: 200, maxAnnualRelativeYear: 2011 });
  });

  it('retains absolute units for a zero control and rejects unaligned annual evidence', () => {
    const base = annuals(), probe = annuals();
    probe[9].ihtShare = 0.1;
    expect(summarizeEnvelope(base, [{ id: 'probe', rows: probe }]).ihtShare).toMatchObject({ delta: 0.1, relativePercent: null });
    expect(summarizeEnvelope(base, [{ id: 'control', rows: base }]).ihtShare.relativePercent).toBe(0);
    probe[9].year++;
    expect(() => summarizeEnvelope(base, [{ id: 'probe', rows: probe }])).toThrow('unaligned');
  });

  it('reuses documentation-only commits but rejects either changed simulation identity', () => {
    expect(sameSource(source, { ...source, commit: 'docs-two' })).toBe(true);
    expect(sameSource(source, { ...source, simBlob: 'changed-bot' })).toBe(false);
    expect(sameSource(source, { ...source, srcTree: 'changed-simulation' })).toBe(false);
  });

  it('rejects reused evidence for another sign, timing, source, or incomplete trajectory', () => {
    const evidence = {
      complete: true,
      spec: { ...row, ...source, id: '128x15_s7_n-10_d1441', nudge: -10, day: 1441 },
      rows: annuals().map(r => ({ ...r, botRow: {}, stateHash: 'a'.repeat(64) })),
      actions: [], log: [],
    };
    expect(validateCompleted(evidence, row, { ...source, commit: 'docs-two' }, -10, 1441)).toBe(evidence);
    expect(() => validateCompleted(evidence, row, source, 10, 1441)).toThrow('mismatch');
    expect(() => validateCompleted(evidence, row, source, -10, 1)).toThrow('mismatch');
    expect(() => validateCompleted(evidence, row, { ...source, srcTree: 'other' }, -10, 1441)).toThrow('mismatch');
    expect(() => validateCompleted({ ...evidence, rows: evidence.rows.slice(1) }, row, source, -10, 1441)).toThrow('incomplete');
  });
});
