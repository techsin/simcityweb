/**
 * WP5 inspector model (docs/SIM_DEPTH_PART_B.md items 30 / 33): the pure report / breakdown → rows functions accept the
 * stub outputs (null, [], -1) without errors and render full outputs: facility reports generically, factor bars (top 8,
 * capped / updating), condition with "Abandons in N days", growth limits (incl. optional fields), needs, pyramid,
 * response text, the main problem and chip de-duplication.
 */
import { describe, expect, it } from 'vitest';
import {
  DESIRABILITY_HINTS, MAX_BARS, conditionView, crimeBars, dedupeChips, desirabilityView, facilityView, growthRows, landValueView, mainProblem,
  needRows, pyramid, responseText, termBars, warningTopic,
} from '../../src/ui/inspectorModel';
import type { FactorTerm } from '../../src/sim/explain';

const terms = (n: number): FactorTerm[] => Array.from({ length: n }, (_, k) => ({ id: 't' + k, label: 'Term ' + k, value: (k % 2 ? -1 : 1) * (0.01 + k * 0.02) }));

describe('inspector model: stub outputs', () => {
  it('null / [] / -1 give empty views, never errors', () => {
    expect(facilityView(null)).toBeNull();
    expect(desirabilityView(null)).toBeNull();
    expect(desirabilityView({ terms: [], raw: 0.2, value: 0.2 })).toBeNull(); // the phase-0 stub: no terms
    expect(conditionView({ terms: [], target: 0.8, abandonInDays: null })).toBeNull();
    expect(growthRows(null)).toEqual([]);
    expect(termBars([])).toEqual([]);
    expect(termBars(null)).toEqual([]);
    expect(needRows([])).toEqual([]);
    expect(pyramid(null, 10)).toEqual([]);
    expect(pyramid(new Float32Array(5), 0)).toEqual([]);
    expect(responseText(null)).toBeNull();
    expect(crimeBars(null)).toBeNull();
    expect(mainProblem({})).toBeNull();
  });
});

describe('inspector model: full outputs', () => {
  it('facility report: generic rows with ratio bars, status and hints; warnings de-duplicated', () => {
    const v = facilityView({
      title: 'Elementary School', role: 'Elementary school: 1,500 seats', warnings: ['No power — works at 30%', 'No power — works at 30%'],
      lines: [
        { key: 'seats', label: 'Pupils', value: '1,650 / 1,500 (110%)', ratio: 1.1, status: 'warn', hint: 'Overcrowded — build another school' },
        { key: 'staff', label: 'Staff', value: '38 / 40' },
      ],
    })!;
    expect(v.role).toContain('1,500 seats');
    expect(v.rows).toHaveLength(2);
    expect(v.rows[0]).toMatchObject({ label: 'Pupils', ratio: 1.1, status: 'warn', tone: 'warn', hint: 'Overcrowded — build another school' });
    expect(v.rows[1].ratio).toBeUndefined();
    expect(v.warnings).toEqual(['No power — works at 30%']);
    // the "No power" chip is dropped: the warning says the same with its fix
    const chips = dedupeChips([{ text: 'No power', cls: 'bad', topic: 'power' }, { text: 'Historic', cls: 'info' }], v.warnings);
    expect(chips.map((c) => c.text)).toEqual(['Historic']);
    expect(warningTopic('Understaffed — workers can’t reach it')).toBe('staff');
  });

  it('desirability: top 8 bars by |value|, capped and updating notes', () => {
    const d = desirabilityView({ terms: terms(12), raw: 1.4, value: 1 })!;
    expect(d.bars).toHaveLength(MAX_BARS);
    expect(Math.abs(d.bars[0].value)).toBeGreaterThanOrEqual(Math.abs(d.bars[7].value));
    expect(d.clamped).toBe(true);
    expect(d.note).toMatch(/Capped/);
    expect(d.note).toMatch(/add up to \+140, desirability tops out at \+100/); // (points, like the header)
    const u = desirabilityView({ terms: terms(3), raw: 0.5, value: 0.3 })!;
    expect(u.updating).toBe(true);
    expect(u.note).toMatch(/heading for \+50$/);
    // a gap under 5 points (a loaded city, a lot between two refreshes) is no news
    const q = desirabilityView({ terms: terms(3), raw: 0.5, value: 0.46 })!;
    expect(q.updating).toBe(false);
    expect(q.note).toBeUndefined();
  });

  it('condition: base term first, penalties, abandonment countdown; the main problem names the worst penalty with its fix', () => {
    const c = conditionView({
      terms: [{ id: 'desirability', label: 'Desirability', value: 0.6 }, { id: 'garbage', label: 'Garbage not collected', value: -0.15 }, { id: 'power', label: 'No power', value: -0.4 }],
      target: 0.05, abandonInDays: 34,
    })!;
    expect(c.bars[0].label).toBe('From desirability');
    expect(c.abandon).toBe('Abandons in 34 days');
    const p = mainProblem({ condition: c })!;
    expect(p.text).toBe('No power');
    expect(p.hint).toMatch(/power line/);
    expect(p.tone).toBe('bad');
    // facility warnings come first (they carry their own fix)
    expect(mainProblem({ warnings: ['Under construction', 'No road access — build a road beside it'], condition: c })).toEqual({ text: 'No road access', hint: 'build a road beside it', tone: 'bad' });
    expect(conditionView({ terms: [{ id: 'desirability', label: 'D', value: 0.5 }], target: 0.5, abandonInDays: 0 })!.abandon).toBe('Abandons any day now');
  });

  it('growth limits: binding limit first, optional fields shown generically', () => {
    const rows = growthRows({ desStage: 5, popStage: 3, zoneStage: 8, rejected: false, downtown: 0.42 }, 3);
    expect(rows[0].value).toBe('stage 3 · limited by city population');
    expect(rows[0].tone).toBe('warn');
    expect(rows.some((r) => r.label === 'Downtown' && r.value === '0.42')).toBe(true);
    expect(growthRows({ desStage: 0, popStage: 3, zoneStage: 8, rejected: true, reason: 'Desirability too low' })[0]).toMatchObject({ value: 'Desirability too low', tone: 'neg' });
  });

  it('needs (unmet first), pyramid, response text, crime causes', () => {
    const rows = needRows([
      { cohort: 0, kind: 'elementary', label: 'Elementary school', people: 34, access: 0.92, met: true },
      { cohort: 1, kind: 'high', label: 'High school', people: 12, access: 0.1, met: false },
      { cohort: -1, kind: 'water', label: 'Unsafe tap water', people: 120, access: 0.4, met: false },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Unsafe tap water', 'High school', 'Elementary school']);
    expect(rows[0].who).toBe('Everyone');
    expect(rows[1].who).toBe('Teens');
    const p = pyramid([0.2, 0.1, 0.1, 0.45, 0.15], 200);
    expect(p.map((b) => b.people)).toEqual([40, 20, 20, 90, 30]);
    expect(responseText({ slackMin: 2.1, covered: true })).toEqual({ text: 'auto, 2.1 min to spare', tone: 'pos' });
    expect(responseText({ slackMin: -1.4, covered: false })).toEqual({ text: 'manual only (1.4 min out of reach)', tone: 'warn' });
    expect(responseText({ slackMin: -8, covered: false })!.tone).toBe('neg');
    expect(responseText({ slackMin: -99, covered: false }, 'no fire station')).toEqual({ text: 'no fire station', tone: 'neg' });
    // the layers' floor (-EMERG_RMAX): no road beside the building, or 6+ min beyond every station's reach
    expect(responseText({ slackMin: -12, covered: false, hasRoad: false })).toEqual({ text: 'unreachable — no road to it', tone: 'neg' });
    expect(responseText({ slackMin: -12, covered: false, hasRoad: true })).toEqual({ text: 'manual only — 6+ min beyond every station', tone: 'neg' });
    expect(responseText({ slackMin: -12, covered: false })!.text).toMatch(/6\+ min beyond every station/);
    // empty land reads the nearest road / lot's reach, like the Emergency data view
    expect(responseText({ slackMin: 1.6, covered: true, land: true })).toEqual({ text: 'a lot here: auto, 1.6 min to spare', tone: 'pos' });
    expect(responseText({ slackMin: -12, covered: false, hasRoad: false, land: true })!.text).toBe('no road nearby');
    const cr = crimeBars({ density: 0.1, poverty: 0.2, unemployment: 0, landValue: 0.05, abandoned: 0, garbage: 0.03, youth: 0.01, nightlife: 0, multiplier: 1.1, police: 0.4, total: 0.25 })!;
    expect(cr.bars[0].label).toBe('Poverty');
    expect(cr.bars.every((b) => b.value > 0)).toBe(true);
    expect(cr.police).toBe(0.4);
  });
});

describe('inspector model: the main problem only for a struggling building, always with a fix', () => {
  const cond = (target: number, terms: FactorTerm[], abandonInDays: number | null = null) =>
    conditionView({ terms: [{ id: 'desirability', label: 'Desirability', value: 0.7 }, ...terms], target, abandonInDays })!;
  const des = (value: number, terms: FactorTerm[]) => desirabilityView({ terms, raw: value, value })!;

  it('a healthy building shows nothing (small penalties, desirability terms without a fix)', () => {
    const c = cond(0.9, [{ id: 'garbage', label: 'Garbage not collected', value: -0.05 }]);
    const d = des(0.6, [{ id: 'base', label: 'Base appeal', value: 0.3 }, { id: 'rent', label: 'Rent', value: -0.2 }, { id: 'noise', label: 'Noise', value: -0.08 }]);
    expect(mainProblem({ condition: c, desirability: d })).toBeNull();
    // rent / base / wealthy / prestige never lead, even when desirability is low
    const low = des(-0.1, [{ id: 'rent', label: 'Rent', value: -0.4 }, { id: 'wealthy', label: 'Wealthy neighbours', value: -0.2 }]);
    expect(mainProblem({ condition: c, desirability: low })).toBeNull();
    for (const id of ['base', 'rent', 'wealthy', 'prestige']) expect(DESIRABILITY_HINTS[id]).toBeUndefined();
  });

  it('a big penalty, a low target or a countdown names the penalty with its fix', () => {
    const big = mainProblem({ condition: cond(0.85, [{ id: 'noise', label: 'Noise at night', value: -0.12 }]) })!;
    expect(big).toMatchObject({ text: 'Noise at night', tone: 'warn' });
    expect(big.hint).toMatch(/trees/);
    const low = mainProblem({ condition: cond(0.5, [{ id: 'garbage', label: 'Garbage not collected', value: -0.05 }]) })!;
    expect(low.text).toBe('Garbage not collected');
    expect(low.hint).toMatch(/landfill/);
    expect(mainProblem({ condition: cond(0.7, [{ id: 'garbage', label: 'Garbage not collected', value: -0.05 }], 40) })!.tone).toBe('bad');
  });

  it('low desirability (or desirability limiting the stage) names the worst factor that has a fix', () => {
    const c = cond(0.9, []);
    const d = des(-0.1, [{ id: 'base', label: 'Base appeal', value: -0.3 }, { id: 'air', label: 'Air pollution', value: -0.2 }, { id: 'crime', label: 'Crime', value: -0.1 }]);
    const p = mainProblem({ condition: c, desirability: d })!;
    expect(p.text).toBe('Held back by air pollution');
    expect(p.hint).toBe(DESIRABILITY_HINTS.air);
    // a well-liked building is only "held back" when desirability is what caps its stage
    const ok = des(0.4, [{ id: 'noise', label: 'Noise', value: -0.1 }]);
    expect(mainProblem({ condition: c, desirability: ok })).toBeNull();
    expect(mainProblem({ condition: c, desirability: ok, desLimited: true })!.hint).toBe(DESIRABILITY_HINTS.noise);
  });

  it('land value: the floor / cap is a note, not a bar', () => {
    const v = landValueView([{ id: 'base', label: 'Base', value: 0.1 }, { id: 'ind', label: 'Industry nearby', value: -0.77 }, { id: 'clamp', label: 'Floored at 0%', value: 0.67 }, { id: 'smoothing', label: 'Neighbourhood blend & lag', value: 0 }]);
    expect(v.bars.map((b) => b.id)).toEqual(['ind', 'base']);
    expect(v.note).toBe('Floored at 0%: the factors add up to −67%');
    expect(landValueView([{ id: 'base', label: 'Base', value: 0.3 }]).note).toBeUndefined();
    expect(landValueView(null).bars).toEqual([]);
  });

  it('residents: a met quiet-streets need drops "(too noisy)"; the serving facility is named', () => {
    const rows = needRows([
      { cohort: 4, kind: 'quiet', label: 'Quiet streets (too noisy)', people: 4, access: 0.83, met: true },
      { cohort: 0, kind: 'elementary', label: 'Elementary school', people: 30, access: 0.9, met: true },
    ], (n) => (n.kind === 'elementary' ? 'Elementary School · 92% full' : undefined));
    expect(rows.find((r) => r.kind === 'quiet')!.label).toBe('Quiet streets');
    expect(rows.find((r) => r.kind === 'elementary')!.provider).toBe('Elementary School · 92% full');
    expect(needRows([{ cohort: 4, kind: 'quiet', label: 'Quiet streets (too noisy)', people: 4, access: 0.3, met: false }])[0].label).toBe('Quiet streets (too noisy)');
  });
});
