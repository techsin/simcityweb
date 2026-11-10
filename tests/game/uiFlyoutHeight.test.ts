/**
 * LG-02 QA round 2, B3 (real GPU, 1280x720): the Landmarks flyout's 19 cards (12 + LG-02's 7) need three rows, 424 px;
 * the scroll area (.fly-groups, hud.css) was capped at min(56vh, 520px) = 403 px, so the rows overflowed it by 21 px:
 * the third row's Metropolis Crown was cut by 17 px with its upkeep line hidden, and no scrollbar showed. The base's 12
 * cards (two rows, 285 px) fit.
 * Why 403: at 1280x720 the HUD root is zoomed 0.8 (ui/zoom.ts computeUiZoom), the layout is 1600 x 900 px, and the
 * zoom scales a bare vh like every other length — "56vh" was 403 of those 900 px, not 56 % of them. The cap now divides
 * the vh by the zoom (and is never less than the bare 56vh it was). This pins the 1280x720 arithmetic from the CSS:
 * three rows of the tallest card fit the scroll area, and the flyout with them stays below the top bar.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../src/sim/catalog';
import { computeUiZoom } from '../../src/ui/zoom';

const hud = readFileSync(new URL('../../src/ui/hud.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** the declarations of the rule whose selector list is exactly `sel` */
function bodyOf(sel: string): string {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  for (const m of hud.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (norm(m[1]) === norm(sel)) return m[2];
  throw new Error(`no rule ${sel}`);
}
/** the value of a declaration ("max-height" -> "min(…)") */
function decl(body: string, prop: string): string {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body);
  if (!m) throw new Error(`no ${prop} in ${body}`);
  return m[1].trim();
}
const num = (v: string) => {
  const m = /^(-?[\d.]+)(px)?$/.exec(v.trim());
  if (!m) throw new Error(`not a number: ${v}`);
  return Number(m[1]);
};

/**
 * a length of the HUD in its own px on a screen `screenH` px tall at `zoom`: px, a bare vh (N % of the screen's px
 * count — the root's zoom shrinks it with everything else), min / max, and calc(X / var(--ui-zoom))
 */
function own(expr: string, screenH: number, zoom: number): number {
  const s = expr.trim();
  const fn = /^(min|max)\(([\s\S]*)\)$/.exec(s);
  if (fn) {
    const args: string[] = [];
    let depth = 0, from = 0;
    for (let i = 0; i < fn[2].length; i++) {
      const ch = fn[2][i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) { args.push(fn[2].slice(from, i)); from = i + 1; }
    }
    args.push(fn[2].slice(from));
    const v = args.map((a) => own(a, screenH, zoom));
    return fn[1] === 'min' ? Math.min(...v) : Math.max(...v);
  }
  const c = /^calc\(([\s\S]*)\/\s*var\(--ui-zoom\)\s*\)$/.exec(s);
  if (c) return own(c[1], screenH, zoom) / zoom;
  const m = /^(-?[\d.]+)(vh|px)$/.exec(s);
  if (!m) throw new Error(`cannot evaluate ${expr}`);
  return m[2] === 'px' ? Number(m[1]) : (Number(m[1]) * screenH) / 100;
}

const W = 1280, H = 720;
/** the top bar's bottom edge in HUD px (Toolbar.placeTip keeps the tooltips below it) */
const TOP_BAR = 64;

describe('the Landmarks flyout fits 1280x720 (LG-02 QA B3)', () => {
  const zoom = computeUiZoom(W, H, 1);
  const layoutH = H / zoom, layoutW = W / zoom;
  const flyW = num(decl(bodyOf('.mp-ui'), '--fly-w'));
  const gap = num(decl(bodyOf('.fly-items'), 'gap'));
  const item = bodyOf('.fly-item'), name = bodyOf('.fly-name'), cost = bodyOf('.fly-cost');
  const [padTop, , padBottom] = decl(item, 'padding').split(/\s+/).map(num);
  const border = num(decl(item, 'border').split(/\s+/)[0]);
  const nameLine = num(decl(name, 'font-size')) * num(decl(name, 'line-height'));
  const lines = num(decl(name, '-webkit-line-clamp'));
  /** a card's cost block: the price and the upkeep line under it */
  const costH = (num(decl(cost, 'font-size')) + num(decl(bodyOf('.fly-cost .up'), 'font-size'))) * num(decl(cost, 'line-height'));
  /** the height of a card whose name takes `n` lines */
  const cardH = (n: number) => 2 * border + padTop + padBottom + num(decl(bodyOf('.fly-thumb'), 'height')) + 2 * num(decl(item, 'gap'))
    + Math.max(num(decl(name, 'min-height')), n * nameLine) + costH;
  const rowsH = (...nameLines: number[]) => nameLines.reduce((s, n) => s + cardH(n), 0) + (nameLines.length - 1) * gap;
  const cap = own(decl(bodyOf('.fly-groups'), 'max-height'), H, zoom);

  it('the layout at 1280x720: zoom 0.8, nine cards a row, the 19 landmarks in three rows', () => {
    expect(zoom).toBe(0.8);
    expect(layoutH).toBe(900);
    // a tabbed group lays its cards out in `.fly-items.wide`: nine cards and eight gaps
    const wide = /^calc\(var\(--fly-w\) \* (\d+) \+ (\d+)px\)$/.exec(decl(bodyOf('.fly-items.wide'), 'max-width'))!;
    const wideMax = flyW * Number(wide[1]) + Number(wide[2]);
    const perRow = Math.floor((wideMax + gap) / (flyW + gap));
    expect(perRow).toBe(9);
    // the flyout is wide enough for them (Toolbar.openFlyout: at most 1180 px and the layout less 32 px)
    const fly = bodyOf('.flyout');
    const [, padSide] = decl(fly, 'padding').split(/\s+/).map(num);
    const inner = Math.min(num(decl(fly, 'max-width')), layoutW - 32) - 2 * padSide - 2 - num(decl(bodyOf('.fly-groups'), 'padding-right'));
    expect(inner).toBeGreaterThanOrEqual(wideMax);
    const landmarks = CATALOG.filter((d) => d.category === 'landmark' && !d.hidden).length;
    expect(landmarks).toBe(19);
    expect(Math.ceil(landmarks / perRow)).toBe(3);
  });

  it('three rows fit the scroll area — the rows QA measured (424 px) and three rows of three-line names', () => {
    expect(lines).toBe(3);
    // QA's rows: "Giant Observation Wheel" (three lines) in the first, two-line names below: 424 px measured
    const measured = rowsH(3, 2, 2);
    expect(Math.abs(measured - 424)).toBeLessThan(2);
    const worst = rowsH(3, 3, 3);
    expect(worst).toBeGreaterThan(measured);
    // the bare 56vh it was: 403 px, 21 px short of the measured rows
    expect(Math.round(own('min(56vh, 520px)', H, zoom))).toBe(403);
    expect(own('min(56vh, 520px)', H, zoom)).toBeLessThan(measured);
    // now: 56 % of the 900 px layout
    expect(cap).toBeCloseTo(0.56 * layoutH, 6);
    expect(cap).toBeGreaterThanOrEqual(worst + 8); // (a hovered card lifts 2 px; a few px to spare)
    // two rows (the base's 12 landmarks) fit as before
    expect(rowsH(3, 2)).toBeLessThan(cap);
  });

  it('the flyout with the scroll area at its cap stays below the top bar', () => {
    const fly = bodyOf('.flyout');
    const [flyTop, , flyBottom] = decl(fly, 'padding').split(/\s+/).map(num);
    const lift = Number(/^calc\(100% \+ (\d+)px\)$/.exec(decl(fly, 'bottom'))![1]);
    const toolbar = num(decl(bodyOf('.tb-btn'), 'height')) + 2 * num(decl(bodyOf('.toolbar'), 'padding').split(/\s+/)[0]) + 2;
    const below = num(decl(bodyOf('.hud-bottom'), 'bottom')) + toolbar + lift;
    // the head row: the tabs (a 14 px icon and count chip in a button with 6 px padding, in a 2 px padded, bordered
    // strip) and the margin under it
    const tab = bodyOf('.fly-tabs button');
    const headH = 14 + 2 * num(decl(tab, 'padding').split(/\s+/)[0]) + 2 * num(decl(bodyOf('.fly-tabs'), 'padding')) + 2;
    const headGap = num(decl(bodyOf('.flyout .fly-head'), 'margin').split(/\s+/)[2]);
    const flyH = 2 + flyTop + headH + headGap + cap + flyBottom;
    expect(layoutH - below - flyH).toBeGreaterThanOrEqual(TOP_BAR + 8);
  });

  it('the cap is never less than it was, and unchanged where the 520 px limit rules', () => {
    const rule = decl(bodyOf('.fly-groups'), 'max-height');
    for (const [w, h, pref] of [[1280, 720, 1], [1366, 768, 1], [1600, 900, 1], [1920, 1080, 1], [2560, 1440, 1], [1920, 1080, 1.5], [1366, 768, 1.5]] as const) {
      const z = computeUiZoom(w, h, pref);
      const was = own('min(56vh, 520px)', h, z), now = own(rule, h, z);
      expect(now, `${w}x${h} at ${pref}`).toBeGreaterThanOrEqual(was);
      expect(now, `${w}x${h} at ${pref}`).toBeLessThanOrEqual(520);
      if (was === 520) expect(now).toBe(520);
    }
  });
});
