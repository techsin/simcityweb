/**
 * Routed UI item 19 (simB ROUTED_ITEMS): one y-axis, one notation. compact() formats each tick on its own and changes
 * notation at 10,000 and 100,000, so the Tourists axis read "0 5,000 10.0k 15.0k" (and Population "0 50.0k 100k 150k",
 * Treasury "§0 §500k §1.00M §1.50M"). graphAxis.axisLabels writes every tick of an axis in the unit of its largest tick
 * with the decimals its step needs. compact() itself (35 callers: cards, tooltips, legends) is unchanged.
 */
import { describe, expect, it } from 'vitest';
import { axisLabels, axisTicks, niceAxis } from '../../src/ui/graphAxis';
import { compact, moneyCompact } from '../../src/ui/format';

/** the y-axis exactly as GraphsPanel builds it for a count / money graph */
const yAxis = (lo: number, hi: number, prefix = '') => {
  const a = niceAxis(lo, hi, true, 4);
  const ticks = axisTicks(a.lo, a.hi, a.step);
  return { ticks, labels: axisLabels(ticks, a.step, prefix) };
};

describe('graph y-axis labels: one notation per axis', () => {
  it('the Tourists axis 0..15k reads "0 5k 10k 15k" (compact() per tick: "0 5,000 10.0k 15.0k")', () => {
    const { ticks, labels } = yAxis(0, 14_200);
    expect(ticks).toEqual([0, 5000, 10000, 15000]);
    expect(ticks.map((v) => compact(v))).toEqual(['0', '5,000', '10.0k', '15.0k']); // the routed report
    expect(labels).toEqual(['0', '5k', '10k', '15k']);
  });

  it('the other count / money axes that mixed notations', () => {
    // Population 0..250k: "50.0k" beside "100k"
    const pop = yAxis(0, 214_860);
    expect(pop.ticks.map((v) => compact(v))).toEqual(['0', '50.0k', '100k', '150k', '200k', '250k']);
    expect(pop.labels).toEqual(['0', '50k', '100k', '150k', '200k', '250k']);
    // Treasury 0..2M: "§500k" beside "§1.00M"
    const funds = yAxis(0, 1_640_000, '§');
    expect(funds.ticks.map((v) => moneyCompact(v))).toEqual(['§0', '§500k', '§1.00M', '§1.50M', '§2.00M']);
    expect(funds.labels).toEqual(['§0', '§0.5M', '§1.0M', '§1.5M', '§2.0M']);
    // a treasury in the red: a true minus before the currency
    expect(yAxis(-3000, 12_000, '§').labels).toEqual(['−§5k', '§0', '§5k', '§10k', '§15k']);
    // 0..10k in steps of 2,000 (a 1Y Tourists range): "8,000" beside "10.0k"
    expect(yAxis(0, 9_962).labels).toEqual(['0', '2k', '4k', '6k', '8k', '10k']);
    // big: billions
    expect(yAxis(0, 1.3e9, '§').labels).toEqual(['§0', '§0.5B', '§1.0B', '§1.5B']);
  });

  it('axes that were consistent read as before (whole numbers below 10,000, small counts)', () => {
    for (const hi of [0, 2, 7, 13, 47, 120, 999, 4_200, 8_000]) {
      const { ticks, labels } = yAxis(0, hi);
      expect(labels, `0..${hi}`).toEqual(ticks.map((v) => compact(v)));
    }
    expect(yAxis(0, 0).labels).toEqual(['0', '1', '2', '3', '4']);
    expect(yAxis(0, 8_000).labels).toEqual(['0', '2,000', '4,000', '6,000', '8,000']);
  });

  it('every count axis: distinct labels, one suffix and one decimal count for all non-zero ticks', () => {
    for (const hi of [3, 9, 47, 950, 9_999, 10_000, 12_345, 14_999, 49_000, 99_999, 100_000, 294_083, 999_999, 1_000_000, 2_400_000, 47_000_000, 3.2e9]) {
      for (const prefix of ['', '§']) {
        const { labels } = yAxis(0, hi, prefix);
        const nz = labels.filter((l) => l !== prefix + '0');
        expect(new Set(labels).size, `0..${hi}: ${labels.join(' ')}`).toBe(labels.length);
        const suffixes = new Set(nz.map((l) => l.replace(/^[−§0-9.,]+/, '')));
        expect(suffixes.size, `0..${hi}: ${labels.join(' ')}`).toBeLessThanOrEqual(1);
        const decimals = new Set(nz.map((l) => (l.match(/\.(\d+)/)?.[1] ?? '').length));
        expect(decimals.size, `0..${hi}: ${labels.join(' ')}`).toBeLessThanOrEqual(1);
        expect(labels[0]).toBe(prefix + '0');
      }
    }
  });

  it('axisTicks: lo + k x step (no drift), zero snapped', () => {
    expect(axisTicks(-1, 1, 0.2).length).toBe(11);
    expect(axisTicks(-1, 1, 0.2)[5]).toBe(0);
    expect(axisTicks(0, 1, 0.1)[3]).toBeCloseTo(0.3, 12);
    expect(axisTicks(0, 4, 0)).toEqual([]);
    expect(axisLabels([Number.NaN], 1)).toEqual(['—']);
  });
});
