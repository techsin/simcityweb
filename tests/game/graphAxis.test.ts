/** WP5 review round 2: graph y-axes — count graphs tick on whole numbers (an all-zero Park & ride graph read "1 1 1 0 0 0") */
import { describe, expect, it } from 'vitest';
import { niceAxis } from '../../src/ui/graphAxis';
import { compact } from '../../src/ui/format';

const labels = (a: { lo: number; hi: number; step: number }) => {
  const out: string[] = [];
  for (let v = a.lo; v <= a.hi + a.step * 0.001; v += a.step) out.push(compact(v));
  return out;
};

describe('graph y-axis (niceAxis)', () => {
  it('count graphs: all-zero and small series tick 0, 1, 2, 3, 4 — every label distinct', () => {
    expect(niceAxis(0, 0, true)).toEqual({ lo: 0, hi: 4, step: 1 });
    expect(labels(niceAxis(0, 0, true))).toEqual(['0', '1', '2', '3', '4']);
    expect(labels(niceAxis(0, 2, true))).toEqual(['0', '1', '2', '3', '4']);
    expect(niceAxis(0, 7, true)).toEqual({ lo: 0, hi: 8, step: 2 });
    for (const hi of [0, 1, 3, 5, 9, 13, 47, 120, 999, 12345, 294083]) {
      const a = niceAxis(0, hi, true);
      expect(a.step).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(a.step)).toBe(true);
      expect(a.hi).toBeGreaterThanOrEqual(hi);
      const l = labels(a);
      expect(new Set(l).size, `0..${hi}: ${l.join(' ')}`).toBe(l.length);
    }
    // negative data (a treasury in the red) keeps whole steps
    const neg = niceAxis(-3, 1, true);
    expect(neg.lo).toBeLessThanOrEqual(-3);
    expect(neg.step).toBeGreaterThanOrEqual(1);
  });

  it('fractional graphs keep fine steps (a 0..1 share is not forced to whole numbers)', () => {
    expect(niceAxis(0, 0)).toEqual({ lo: 0, hi: 1, step: 0.2 });
    const a = niceAxis(0, 0.37);
    expect(a.step).toBeCloseTo(0.1, 9);
    expect(a.hi).toBeCloseTo(0.4, 9);
    // non-finite input (no data) falls back to 0
    expect(niceAxis(Infinity, -Infinity, true)).toEqual({ lo: 0, hi: 4, step: 1 });
  });
});
