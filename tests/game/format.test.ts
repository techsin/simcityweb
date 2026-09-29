/** UI number formatting: signedPct (WP5: the RCI graph axis showed only 0 / ±1 through compact()). */
import { describe, expect, it } from 'vitest';
import { signedPct } from '../../src/ui/format';

describe('signedPct', () => {
  it('formats -1..1 values as signed percentages with a true minus sign', () => {
    expect(signedPct(0.34)).toBe('+34%');
    expect(signedPct(-0.12)).toBe('−12%');
    expect(signedPct(1)).toBe('+100%');
    expect(signedPct(-1)).toBe('−100%');
    expect(signedPct(0)).toBe('0%');
    expect(signedPct(-0.004)).toBe('0%');
    expect(signedPct(0.1234, 1)).toBe('+12.3%');
    expect(signedPct(Number.NaN)).toBe('—');
  });
});
