/**
 * Polish FH-16 (src/ui/glossary.ts): plain names next to R$, CS$$$, CO$$, I-D, EQ and HQ.
 *  - the glossary: one entry per development type, its code from DEV_TYPE_LABELS, its name from the RCI segment's
 *    DEV_NAMES, what it wants from its strongest desirability weights (signs checked against tuning), and every number
 *    read from tuning (a mocked tuning moves them);
 *  - Budget: every tax row and every ledger tax line shows the plain name on a second, dim line of its own (the row's code
 *    column and slider keep their widths); the row's tooltip says what the type wants and keeps last month's amount;
 *  - hover: the Stats EQ / HQ meters, the Advisors EQ / HQ lines, the Demographics EQ / HQ cards and trends, and the
 *    Graphs EQ / HQ legend labels show the glossary entry.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEV_TYPE_COUNT, DEV_TYPE_LABELS, DevType, Overlay } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import type { OpenAdvice } from '../../src/sim/economy/advisors';
import { APPROVAL_TERMS, DESIR_WEIGHTS, EQ_FLOOR, EQ_SPAN_STOCK, HQ_FLOOR, HQ_SPAN_ACCESS, ID_EQ_START, IHT_EQ_START } from '../../src/sim/economy/tuning';
import { money } from '../../src/ui/format';
import { DEV_GLOSSARY, EQ_GLOSSARY, HQ_GLOSSARY, WANT_WORDS, glossaryOf, wantTerms } from '../../src/ui/glossary';
import { ADVISORS, AdvisorsPanel } from '../../src/ui/panels/AdvisorsPanel';
import { BudgetPanel } from '../../src/ui/panels/BudgetPanel';
import { DemographicsPanel } from '../../src/ui/panels/DemographicsPanel';
import { GRAPHS, GraphsPanel } from '../../src/ui/panels/GraphsPanel';
import { StatsPanel } from '../../src/ui/panels/StatsPanel';
import { DEV_NAMES } from '../../src/ui/topbar/rciSegment';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const gw = globalThis as unknown as Record<string, unknown>;
let hadWindow: unknown;
beforeAll(() => {
  hadWindow = gw.window;
  gw.window ??= globalThis; // (GraphsPanel.draw reads window.devicePixelRatio)
});
afterAll(() => { gw.window = hadWindow; });
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
  vi.restoreAllMocks();
});

const tips = () => [...DEV_GLOSSARY, EQ_GLOSSARY, HQ_GLOSSARY].map((e) => e.tip);

describe('the glossary (FH-16)', () => {
  it('has one entry per development type: codes from DEV_TYPE_LABELS, names equal to DEV_NAMES', () => {
    expect(DEV_GLOSSARY).toHaveLength(DEV_TYPE_COUNT);
    expect(DEV_GLOSSARY.map((e) => e.code)).toEqual(DEV_TYPE_LABELS);
    expect(DEV_GLOSSARY.map((e) => e.name)).toEqual(DEV_NAMES);
    for (const e of DEV_GLOSSARY) {
      expect(e.tip).toBe(`${e.code} · ${e.name} — ${e.about}`);
      expect(e.about).toMatch(/^wants .+\./);
      expect(glossaryOf(e.code)).toBe(e);
    }
    expect(glossaryOf('EQ')).toBe(EQ_GLOSSARY);
    expect(glossaryOf('HQ')).toBe(HQ_GLOSSARY);
    expect(glossaryOf('Taxes')).toBeUndefined();
    expect(glossaryOf('constructor')).toBeUndefined();
  });

  it('what a type wants follows its desirability weights (sign, order, and its lead want among its strongest)', () => {
    for (let d = 0; d < DEV_TYPE_COUNT; d++) {
      const w = DESIR_WEIGHTS[d], terms = wantTerms(d), label = DEV_TYPE_LABELS[d];
      expect(terms.length, label).toBeGreaterThan(0);
      for (const t of terms) {
        const word = WANT_WORDS[t];
        expect(word, `${label} ${t}`).toBeDefined();
        expect(w[t], `${label} ${t}`).not.toBe(0);
        expect(Math.sign(w[t]), `${label} ${t}: ${word!.less ? 'wants less' : 'wants more'}`).toBe(word!.less ? -1 : 1);
      }
      for (let k = 1; k < terms.length; k++) expect(Math.abs(w[terms[k]]), label).toBeLessThanOrEqual(Math.abs(w[terms[k - 1]]));
      const strongest = (Object.keys(w) as (keyof typeof w)[]).filter((k) => k !== 'bias' && k !== 'lvRef')
        .sort((a, b) => Math.abs(w[b]) - Math.abs(w[a])).slice(0, 3);
      expect(strongest.map((k) => Math.abs(w[k])), label).toContain(Math.abs(w[terms[0]]));
      // the words, in the weights' order
      let at = 0;
      for (const t of terms) {
        const i = DEV_GLOSSARY[d].about.indexOf(WANT_WORDS[t]!.words, at);
        expect(i, `${label}: "${WANT_WORDS[t]!.words}"`).toBeGreaterThan(at - 1);
        at = i;
      }
      // (only a type that weighs no air pollution says it does not mind it)
      expect(DEV_GLOSSARY[d].about.includes('pollution does not bother it'), label).toBe(w.air === 0);
    }
    expect(DEV_GLOSSARY[DevType.R3].about).toBe('wants high land value, clean air, low crime and parks.');
    expect(DEV_GLOSSARY[DevType.ID].about).toContain('pollution does not bother it');
  });

  it('every number in the glossary is a tuning value (the scales, the EQ thresholds, the HQ approval reference)', () => {
    expect(EQ_GLOSSARY.tip).toBe(`EQ · Education quotient — how educated your workers are (0–${EQ_FLOOR + EQ_SPAN_STOCK}); high-tech industry wants ${IHT_EQ_START}+ and offices grow with it. Schools raise it.`);
    expect(HQ_GLOSSARY.tip).toContain(`how healthy your residents are (0–${HQ_FLOOR + HQ_SPAN_ACCESS}); above ${APPROVAL_TERMS.hqRef} it wins you approval`);
    expect(DEV_GLOSSARY[DevType.IHT].about).toContain(`Demand starts once EQ passes ${IHT_EQ_START}.`);
    expect(DEV_GLOSSARY[DevType.ID].about).toContain(`shrinks once EQ passes ${ID_EQ_START}.`);
    expect(DEV_GLOSSARY[DevType.CO2].about).toContain('Office demand grows with EQ.');
    // (0 is the scales' bottom)
    const allowed = new Set([0, EQ_FLOOR + EQ_SPAN_STOCK, HQ_FLOOR + HQ_SPAN_ACCESS, IHT_EQ_START, ID_EQ_START, APPROVAL_TERMS.hqRef]);
    for (const tip of tips()) for (const m of tip.matchAll(/\d+/g)) expect(allowed, `${m[0]} in "${tip}"`).toContain(Number(m[0]));
  });

  it('the numbers move with tuning (none is typed into a string)', async () => {
    vi.resetModules();
    vi.doMock('../../src/sim/economy/tuning', async (importOriginal) => {
      const t = await importOriginal<typeof import('../../src/sim/economy/tuning')>();
      return { ...t, EQ_SPAN_STOCK: t.EQ_SPAN_STOCK - 3, HQ_SPAN_ACCESS: t.HQ_SPAN_ACCESS + 4, IHT_EQ_START: t.IHT_EQ_START + 3, ID_EQ_START: t.ID_EQ_START - 3, APPROVAL_TERMS: { ...t.APPROVAL_TERMS, hqRef: t.APPROVAL_TERMS.hqRef - 3 } };
    });
    try {
      const g = await import('../../src/ui/glossary');
      expect(g.EQ_GLOSSARY.tip).toContain(`(0–${EQ_FLOOR + EQ_SPAN_STOCK - 3}); high-tech industry wants ${IHT_EQ_START + 3}+`);
      expect(g.HQ_GLOSSARY.tip).toContain(`(0–${HQ_FLOOR + HQ_SPAN_ACCESS + 4}); above ${APPROVAL_TERMS.hqRef - 3} it wins`);
      expect(g.DEV_GLOSSARY[DevType.IHT].about).toContain(`once EQ passes ${IHT_EQ_START + 3}.`);
      expect(g.DEV_GLOSSARY[DevType.ID].about).toContain(`once EQ passes ${ID_EQ_START - 3}.`);
    } finally {
      vi.doUnmock('../../src/sim/economy/tuning');
      vi.resetModules();
    }
  });
});

// ------------------------------------------------------------------------------------------------ Budget
function budget() {
  const st = newState(32), abort = new AbortController(), host = new LocalSimHost(st, { now: () => 0 });
  st.stats.population = 3000;
  st.stats.residents = [2000, 1000, 0];
  // last month's tax income for every development type, and one expense line
  DEV_TYPE_LABELS.forEach((code, d) => { st.budget.lastIncome[`tax:${code}`] = 1000 + 37 * d; });
  st.budget.lastExpense['service:police'] = 420;
  const ctx = { state: st, sim: host.sim, host, signal: abort.signal, mods: {}, sound: vi.fn(), toast: vi.fn() } as unknown as GameContext;
  const panel = new BudgetPanel(ctx);
  panel.mount(() => {}, () => {}, () => {});
  cleanups.push(async () => { panel.onClose(); abort.abort('dispose'); await host.dispose(); });
  return { st, panel, el: panel.el as unknown as FEl };
}

describe('Budget: plain names on a second dim line (FH-16)', () => {
  it('every tax row: the code alone in its column, the plain name its own dim element spanning the row, the tooltip with wants and last month', () => {
    const { st, el } = budget();
    const rows = el.querySelectorAll('.tax-group').flatMap((g) => g.querySelectorAll('.tax-row').filter((r) => !r.classList.contains('master')));
    expect(rows).toHaveLength(DEV_TYPE_COUNT);
    rows.forEach((row, d) => {
      const code = DEV_TYPE_LABELS[d], kids = row.children;
      // the grid cells keep their order: code, slider, − value +, money — then the name line, then the effect line
      expect(kids.map((k) => k.className.split(' ').find((c) => c.startsWith('tr-') || c === 'ui-range' || c === 'tax-effect'))).toEqual(['tr-l', 'ui-range', 'tr-step', 'tr-m', 'tr-name', 'tax-effect']);
      expect(textOf(kids[0])).toBe(code);
      const name = row.querySelector('.tr-name')!;
      expect(name.parentNode).toBe(row);
      expect(name.classList.contains('dim')).toBe(true);
      expect(textOf(name)).toBe(DEV_NAMES[d]);
      expect(row.title).toBe(`${DEV_GLOSSARY[d].tip}\nLast month: ${money(st.budget.lastIncome[`tax:${code}`])}`);
      expect(row.title).toContain(DEV_GLOSSARY[d].about);
    });
    // the "All" rows have no name line
    for (const m of el.querySelectorAll('.master')) expect(m.querySelector('.tr-name')).toBeNull();
  });

  it('the name line spans the row in its own grid row, so the code column and the slider keep their widths', () => {
    const css = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
    expect(css('../../src/ui/guide/advice.css')).toMatch(/\.tax-row \.tr-name \{[^}]*grid-column: 1 \/ -1;/);
    // (the tax row's columns are hud.css's, unchanged: the 44 px code column, the slider's 1fr, the stepper, the money)
    expect(css('../../src/ui/hud.css')).toContain('.tax-row, .fund-row { display: grid; grid-template-columns: 44px 1fr 84px 52px;');
    expect(readFileSync(new URL('../../src/ui/panels/BudgetPanel.ts', import.meta.url), 'utf8')).toContain("import '../guide/advice.css';");
  });

  it('every ledger tax line: the code, then the plain name on a second dim line, the glossary entry on hover', () => {
    const { panel, el } = budget();
    panel.showTab('ledger');
    const items = el.querySelectorAll('tr.item');
    for (let d = 0; d < DEV_TYPE_COUNT; d++) {
      const code = DEV_TYPE_LABELS[d];
      const row = items.find((r) => r.children[0].childNodes[0]?.textContent === code);
      expect(row, code).toBeDefined();
      const name = row!.children[0].querySelector('.lg-name')!;
      expect(name.parentNode).toBe(row!.children[0]);
      expect(name.classList.contains('dim')).toBe(true);
      expect(textOf(name)).toBe(DEV_NAMES[d]);
      expect(row!.title).toBe(DEV_GLOSSARY[d].tip);
    }
    // other lines keep one line
    const police = items.find((r) => textOf(r).startsWith('Police'))!;
    expect(police.querySelector('.lg-name')).toBeNull();
    expect(police.title).toBe('');
  });
});

// ------------------------------------------------------------------------------------------------ hover entries
function city() {
  const st = newState(16), abort = new AbortController(), host = new LocalSimHost(st, { now: () => 0 });
  const ctx = {
    state: st, sim: host.sim, host, signal: abort.signal, mods: {}, sound: vi.fn(), toast: vi.fn(),
    overlay: Overlay.None, overlayVariant: -1, focusCell: () => {}, setOverlay: () => {}, panels: { open: () => {} },
  } as unknown as GameContext;
  cleanups.push(async () => { abort.abort('dispose'); await host.dispose(); });
  return { st, host, ctx, abort };
}

describe('EQ / HQ hover entries (FH-16)', () => {
  it('Stats: hovering the Education (EQ) meter shows the EQ entry, the Health (HQ) meter the HQ entry', () => {
    const { ctx } = city();
    const panel = new StatsPanel(ctx);
    panel.mount(() => {}, () => {}, () => {});
    panel.update();
    cleanups.push(() => panel.onClose());
    const rows = (panel.el as unknown as FEl).querySelectorAll('.meter-row');
    const row = (label: string) => rows.find((r) => textOf(r.querySelector('.mr-l')!) === label)!;
    expect(textOf(row('Education'))).toContain('EQ ');
    expect(row('Education').title).toBe(EQ_GLOSSARY.tip);
    expect(textOf(row('Health'))).toContain('HQ ');
    expect(row('Health').title).toBe(HQ_GLOSSARY.tip);
    expect(row('Land value').title).toBe('');
  });

  it('Advisors: the health advisor\'s EQ / HQ assessment carries the entries it names', () => {
    const { ctx, st } = city();
    const health = ADVISORS.find((a) => a.id === 'health')!;
    st.stats.population = 3000;
    st.stats.eq = 40; st.stats.hq = 90;
    expect(health.assess(ctx)).toMatchObject({ level: 'warn', tip: EQ_GLOSSARY.tip });
    st.stats.eq = 90; st.stats.hq = 40;
    expect(health.assess(ctx)).toMatchObject({ level: 'warn', tip: HQ_GLOSSARY.tip });
    st.stats.hq = 90;
    expect(health.assess(ctx)).toMatchObject({ level: 'good', tip: `${EQ_GLOSSARY.tip}\n${HQ_GLOSSARY.tip}` });
  });

  it('Advisors panel: the card line shows the entry on hover, from the assessment and from an open EQ / HQ issue', async () => {
    const { ctx, st } = city();
    let rows: OpenAdvice[] = [];
    const host = { query: async () => rows, watch: () => ({ value: rows, version: 1, dispose() {} }) };
    const pctx = { ...ctx, host, sim: { speed: 0, events: { on: () => () => {} } }, state: st } as unknown as GameContext;
    const panel = new AdvisorsPanel(pctx);
    panel.mount(() => {}, () => {}, () => {});
    panel.isOpen = true;
    const card = () => (panel.body as unknown as FEl).querySelectorAll('.adv').find((c) => textOf(c).includes('Dr. Okafor'))!;
    // no open issue: the assessment's "EQ 30 · HQ 35" line, both entries
    st.stats.eq = 30; st.stats.hq = 35;
    panel.onOpen();
    panel.update();
    await vi.waitFor(() => expect(textOf(card().querySelector('.am')!)).toContain('EQ 30 · HQ 35'));
    expect(card().querySelector('.am')!.title).toBe(`${EQ_GLOSSARY.tip}\n${HQ_GLOSSARY.tip}`);
    // open issues: eqLow on top (its entry on the card line), hqLow below (its entry after the text)
    rows = [
      { id: 'eqLow', advisor: 'health', kind: 'info', priority: 3, text: 'Our education quotient is only 30.' },
      { id: 'hqLow', advisor: 'health', kind: 'info', priority: 3, text: 'Health is poor (HQ 35). Build clinics and hospitals.' },
    ];
    panel.onOpen();
    panel.update();
    await vi.waitFor(() => expect(textOf(card().querySelector('.am')!)).toBe('Our education quotient is only 30.'));
    expect(card().querySelector('.am')!.title).toBe(EQ_GLOSSARY.tip);
    const more = card().querySelector('ul.am-more')!.children[0];
    expect(more.title).toBe(`Health is poor (HQ 35). Build clinics and hospitals.\n\n${HQ_GLOSSARY.tip}`);
    // another advisor's line has no entry
    const planning = (panel.body as unknown as FEl).querySelectorAll('.adv').find((c) => textOf(c).includes('Alex Stone'))!;
    expect(planning.querySelector('.am')!.title).toBe('');
  });

  it('Demographics: the EQ / HQ cards and the EQ / HQ trend rows show the entries', () => {
    const { ctx } = city();
    const panel = new DemographicsPanel(ctx);
    panel.mount(() => {}, () => {}, () => {});
    panel.onOpen();
    panel.update();
    cleanups.push(() => panel.onClose());
    const el = panel.el as unknown as FEl;
    const card = (label: string) => el.querySelectorAll('.stat-card').find((c) => textOf(c.querySelector('.sc-l')!) === label)!;
    expect(textOf(card('Education'))).toContain('EQ ');
    expect(card('Education').title).toBe(EQ_GLOSSARY.tip);
    expect(card('Health').title).toBe(HQ_GLOSSARY.tip);
    expect(card('Population').title).toBe('');
    const trend = (label: string) => el.querySelectorAll('.dt').find((r) => textOf(r.querySelector('.dt-l')!) === label)!;
    expect(trend('EQ').title).toBe(EQ_GLOSSARY.tip);
    expect(trend('HQ').title).toBe(HQ_GLOSSARY.tip);
    expect(trend('Population').title).toBe('');
  });

  it('Graphs: the EQ / HQ series labels show the entries on hover', () => {
    const eqhq = GRAPHS.find((g) => g.id === 'eqhq')!;
    expect(eqhq.series.map((s) => [s.label, s.tip])).toEqual([['EQ', EQ_GLOSSARY.tip], ['HQ', HQ_GLOSSARY.tip]]);
    const { ctx } = city();
    const panel = new GraphsPanel(ctx);
    panel.mount(() => {}, () => {}, () => {});
    const el = panel.el as unknown as FEl;
    const canvas = el.querySelector('canvas')! as unknown as { getContext: () => unknown };
    // (a 2D context that accepts every call: the test reads the legend, not the drawing)
    const any: unknown = new Proxy(() => any, { get: () => any, set: () => true, apply: () => any });
    canvas.getContext = () => any;
    el.querySelectorAll('button').find((b) => textOf(b) === 'Education & health')!.click();
    const legend = el.querySelector('.graph-legend')!.children;
    expect(legend.map((s) => [s.childNodes[1]?.textContent, s.title])).toEqual([['EQ', EQ_GLOSSARY.tip], ['HQ', HQ_GLOSSARY.tip]]);
  });
});
