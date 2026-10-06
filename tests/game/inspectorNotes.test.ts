/**
 * Routed UI items for the WP5 inspector (simB ROUTED_ITEMS 37 / 41 / 44):
 *  37  the condition clamp ("Floored at 0%" / "Capped at 100%") is a note like land value's, not a green bonus bar, and
 *      a small "Capped at 100%" term can never become the main problem;
 *  41  capped desirability factors with a stored value more than 5 points behind show both notes;
 *  44  terms under half a point are not drawn as "−0" / "+0" bars, and every signed point value uses one notation
 *      (signedPts: "+61" / "−10" with a true minus / "0") — the header read ASCII "-10" beside the Why? section's "−10".
 */
import { describe, expect, it } from 'vitest';
import { conditionView, crimeBars, desirabilityView, growthRows, landValueView, mainProblem, signedPts } from '../../src/ui/inspectorModel';
import type { FactorTerm } from '../../src/sim/explain';

describe('item 37: the condition clamp is a note, not a bar', () => {
  it('"Floored at 0%" (an unpowered home in a blackout): a note with what the factors add up to, no +21 bonus bar', () => {
    // conditionBreakdown of an unpowered Ranch House: 0.5 + 0.5 x desirability, no power, no garbage pickup — the target
    // floors at 0 and the clamp term makes the terms add up to it (+0.21)
    const c = conditionView({
      terms: [
        { id: 'desirability', label: 'Desirability', value: 0.49 },
        { id: 'power', label: 'No power', value: -0.6 },
        { id: 'garbage', label: 'Garbage not collected', value: -0.1 },
        { id: 'clamp', label: 'Floored at 0%', value: 0.21 },
      ],
      target: 0, abandonInDays: 20,
    })!;
    expect(c.bars.map((b) => b.id)).toEqual(['desirability', 'power', 'garbage']);
    expect(c.note).toBe('Floored at 0%: the factors add up to −21%');
    expect(mainProblem({ condition: c })).toMatchObject({ text: 'No power', tone: 'bad' });
  });

  it('"Capped at 100%": a note, and never the main problem (no fix, no hint)', () => {
    // counting down (low demand) although its target is full: a struggling building — a −3 cap passed the −2 cut
    const counting = conditionView({
      terms: [
        { id: 'desirability', label: 'Desirability', value: 0.98 },
        { id: 'waterBonus', label: 'Piped water', value: 0.05 },
        { id: 'clamp', label: 'Capped at 100%', value: -0.03 },
      ],
      target: 1, abandonInDays: 12,
    })!;
    expect(counting.bars.map((b) => b.id)).toEqual(['desirability', 'waterBonus']);
    expect(counting.note).toBe('Capped at 100%: the factors add up to +103%');
    expect(mainProblem({ condition: counting })).toBeNull();
    // a cap of 10 points on a building that copes reached the PENALTY_PROBLEM cut
    const big = conditionView({
      terms: [{ id: 'desirability', label: 'Desirability', value: 1 }, { id: 'waterBonus', label: 'Piped water', value: 0.1 }, { id: 'clamp', label: 'Capped at 100%', value: -0.1 }],
      target: 1, abandonInDays: null,
    })!;
    expect(big.note).toBe('Capped at 100%: the factors add up to +110%');
    expect(mainProblem({ condition: big })).toBeNull();
  });

  it('a clamp under half a point reads like the target itself: no note; no clamp: no note', () => {
    const tiny = conditionView({ terms: [{ id: 'desirability', label: 'Desirability', value: 0.999 }, { id: 'waterBonus', label: 'Piped water', value: 0.004 }, { id: 'clamp', label: 'Capped at 100%', value: -0.003 }], target: 1, abandonInDays: null })!;
    expect(tiny.note).toBeUndefined();
    expect(conditionView({ terms: [{ id: 'desirability', label: 'Desirability', value: 0.7 }], target: 0.7, abandonInDays: null })!.note).toBeUndefined();
  });
});

describe('item 41: capped and still updating — both notes', () => {
  const terms: FactorTerm[] = [{ id: 'base', label: 'Base appeal', value: 0.6 }, { id: 'lv', label: 'Land value', value: 0.47 }];

  it('the factors add up to +107 while the stored value is +92: "Capped" and "Updating" together', () => {
    const d = desirabilityView({ terms, raw: 1.07, value: 0.92 })!;
    expect(d.clamped).toBe(true);
    expect(d.updating).toBe(true);
    expect(d.notes).toEqual(['Capped: the factors add up to +107, desirability tops out at +100', 'Updating: heading for +100']);
    expect(d.note).toContain('Capped');
    expect(d.note).toContain('Updating: heading for +100');
  });

  it('either alone: one note; neither: none', () => {
    expect(desirabilityView({ terms, raw: 1.07, value: 0.98 })!.notes).toEqual(['Capped: the factors add up to +107, desirability tops out at +100']);
    expect(desirabilityView({ terms, raw: -1.2, value: -0.81 })!.notes).toEqual(['Capped: the factors add up to −120, desirability tops out at −100', 'Updating: heading for −100']);
    expect(desirabilityView({ terms, raw: 0.8, value: 0.7 })!.notes).toEqual(['Updating: heading for +80']);
    const none = desirabilityView({ terms, raw: 0.8, value: 0.78 })!;
    expect(none.notes).toEqual([]);
    expect(none.note).toBeUndefined();
    // capped by under half a point ("add up to +100, tops out at +100"): only the updating line (a 195k city's
    // Walk-up Apartments: raw 1.004, stored +92)
    const sub = desirabilityView({ terms, raw: 1.004, value: 0.92 })!;
    expect(sub.clamped).toBe(true);
    expect(sub.notes).toEqual(['Updating: heading for +100']);
  });
});

describe('item 44: one notation for points, no "−0" / "+0" bars', () => {
  it('signedPts: a true minus (never ASCII), a plus, and "0" under half a point', () => {
    expect(signedPts(-0.1)).toBe('−10');
    expect(signedPts(-0.1)).not.toContain('-');
    expect(signedPts(0.61)).toBe('+61');
    expect(signedPts(1)).toBe('+100');
    for (const v of [0, -0, 0.004, -0.004, 0.0049, -0.0049]) expect(signedPts(v)).toBe('0');
    expect(signedPts(0.005)).toBe('+1');
    expect(signedPts(-0.005)).toBe('−1');
    expect(signedPts(Number.NaN)).toBe('—');
  });

  it('terms under half a point are left out of every Why? list (desirability, condition, land value, crime)', () => {
    const d = desirabilityView({ terms: [{ id: 'base', label: 'Base appeal', value: 0.4 }, { id: 'noise', label: 'Noise', value: -0.003 }, { id: 'shops', label: 'Shops', value: 0.004 }], raw: 0.401, value: 0.401 })!;
    expect(d.bars.map((b) => b.id)).toEqual(['base']);
    // "Unmet needs −0" (a needs penalty of 0.3 points)
    const c = conditionView({ terms: [{ id: 'desirability', label: 'Desirability', value: 0.7 }, { id: 'needs', label: 'Unmet needs', value: -0.003 }, { id: 'noise', label: 'Noise at night', value: -0.05 }], target: 0.647, abandonInDays: null })!;
    expect(c.bars.map((b) => b.id)).toEqual(['desirability', 'noise']);
    // "Crowding +0"
    const cr = crimeBars({ density: 0.003, poverty: 0.2, unemployment: 0, landValue: 0.004, abandoned: 0, garbage: 0.03, youth: 0, nightlife: 0, multiplier: 1, police: 0.3, total: 0.2 })!;
    expect(cr.bars.map((b) => b.label)).toEqual(['Poverty', 'Garbage in the streets']);
    const lv = landValueView([{ id: 'base', label: 'Base', value: 0.3 }, { id: 'parks', label: 'Parks nearby', value: 0.002 }, { id: 'noise', label: 'Noise', value: -0.0049 }]);
    expect(lv.bars.map((b) => b.id)).toEqual(['base']);
    for (const b of [...d.bars, ...c.bars, ...cr.bars, ...lv.bars]) expect(signedPts(b.value)).not.toBe('0');
  });

  it('the top-8 cut still counts only shown terms; the condition base term always stays (the starting point)', () => {
    // 6 terms of 10-15 points, 6 of 0.05-0.3 points (above termBars' own 1e-4 floor)
    const many: FactorTerm[] = Array.from({ length: 12 }, (_, k) => ({ id: 't' + k, label: 'Term ' + k, value: k < 6 ? 0.1 + k * 0.01 : 0.0005 * (k - 5) }));
    const d = desirabilityView({ terms: many, raw: 0.9, value: 0.9 })!;
    expect(d.bars).toHaveLength(6);
    // a home at desirability −100: its base term is 0 — shown as "0", not "+0"
    const c = conditionView({ terms: [{ id: 'desirability', label: 'Desirability', value: 0.002 }, { id: 'power', label: 'No power', value: -0.6 }, { id: 'clamp', label: 'Floored at 0%', value: 0.598 }], target: 0, abandonInDays: 5 })!;
    expect(c.bars[0]).toMatchObject({ id: 'desirability', label: 'From desirability' });
    expect(signedPts(c.bars[0].value)).toBe('0');
    expect(c.note).toBe('Floored at 0%: the factors add up to −60%');
  });

  it('notes use the same notation (no "−0%" for a sub-point land value clamp)', () => {
    expect(landValueView([{ id: 'base', label: 'Base', value: -0.002 }, { id: 'clamp', label: 'Floored at 0%', value: 0.002 }]).note).toBeUndefined();
    expect(landValueView([{ id: 'ind', label: 'Industry nearby', value: -0.3 }, { id: 'clamp', label: 'Floored at 0%', value: 0.3 }]).note).toBe('Floored at 0%: the factors add up to −30%');
  });

  it('generic growth-limit numbers: negatives with the true minus', () => {
    const rows = growthRows({ desStage: 3, popStage: 5, zoneStage: 8, rejected: false, slope: -0.42, weight: 0.42, tiny: -0.001 });
    expect(rows.find((r) => r.label === 'Slope')!.value).toBe('−0.42');
    expect(rows.find((r) => r.label === 'Weight')!.value).toBe('0.42');
    expect(rows.find((r) => r.label === 'Tiny')!.value).toBe('0.00');
  });
});
