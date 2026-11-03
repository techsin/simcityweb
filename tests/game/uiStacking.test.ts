/**
 * Final fixes UI-6 (lane ui): the top bar's popovers — the approval breakdown on hover, the RCI card while open — drew
 * under the emergency banners (.emg-banners, z 55, emergency.css) and the toast stack (.hud-tl, z 50): the approval
 * card's "Emergencies last month −8.0" was hidden exactly when it mattered. While one is up the top bar stacks above
 * both and below the modal (60); the loading veil stays above the raised bar. The popovers are nearly opaque (a
 * banner's red text and blue buttons showed through the glass). Browser-checked at 1280x720; this pins the order.
 * Final fixes r4 U1: the bottom block with an open toolbar flyout, likewise (below).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANNER_W, EmergencyBanner, PANEL_HEAD_H, STACK_TOP, TOOLBAR_GAP, dockPill, type DockPlace, type DockRect } from '../../src/ui/EmergencyBanner';

const css = (f: string) => readFileSync(new URL(`../../src/ui/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const sheets = css('hud.css') + '\n' + css('emergency.css');

/** the z-index of the rule whose selector list is exactly `sel` (innermost blocks, so @media wrappers do not matter) */
function zOf(sel: string): number {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  for (const m of sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (norm(m[1]) !== norm(sel)) continue;
    const z = /(?:^|;)\s*z-index\s*:\s*(-?\d+)/.exec(m[2]);
    if (z) return Number(z[1]);
  }
  throw new Error(`no z-index for ${sel}`);
}

/** the declarations of the rule whose selector list is exactly `sel` */
function bodyOf(sel: string): string {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  for (const m of sheets.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (norm(m[1]) === norm(sel)) return m[2];
  throw new Error(`no rule ${sel}`);
}

describe('top bar popovers above the emergency banners (final fixes UI-6)', () => {
  it('a hovered top bar / an open RCI card stacks above the banners and the toasts, below the modal', () => {
    const raised = zOf('.hud-top:hover, .hud-top:has(.rci-pop.open)');
    const banners = zOf('.emg-banners');
    const toasts = zOf('.hud-tl');
    const modal = zOf(':where(.mp-ui) .modal-back');
    expect(raised).toBeGreaterThan(banners);
    expect(raised).toBeGreaterThan(toasts);
    expect(raised).toBeLessThan(modal);
    // (idle, the bar keeps its place under the banners and toasts that open below it)
    expect(zOf('.hud-top')).toBeLessThan(Math.min(banners, toasts));
  });
  it('the loading veil still covers a hovered top bar; the modal stays on top of everything', () => {
    const veil = zOf('.loading-veil');
    expect(veil).toBeGreaterThan(zOf('.hud-top:hover, .hud-top:has(.rci-pop.open)'));
    expect(veil).toBeLessThan(zOf(':where(.mp-ui) .modal-back'));
  });
  it('the approval and RCI popovers are nearly opaque (no banner text through the glass)', () => {
    const body = bodyOf('.hud-top .appr-pop.mp-glass, .hud-top .rci-pop.mp-glass');
    const alphas = [...body.matchAll(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)/g)].map((m) => Number(m[1]));
    expect(alphas.length).toBeGreaterThan(0);
    for (const a of alphas) expect(a).toBeGreaterThanOrEqual(0.95);
  });
});

/**
 * Final fixes r4 U1 (lane ui; playtest r4 p43 / p44 / p49, veteran r4 shots 028 / 029): the emergency banners drew over
 * an open toolbar flyout and took its clicks — at 1280x720 the Civic tabs and the Police Station / HQ / Prison cards
 * hit-tested to banners, a click on the Fire tab closed the flyout; at 1920x1080 it pressed a banner's Send nearest and
 * dispatched a fire truck. The flyout is absolutely positioned inside .toolbar inside .hud-bottom (z 45), a sibling of
 * .emg-banners (z 55) under the UI root, and .hud-bottom is transformed — a stacking context the flyout cannot leave
 * with a z-index of its own. While a flyout is open the whole bottom block stacks above the banners (the UI-6
 * precedent), below the loading veil and the modal. (EmergencyBanner also ends its stack above the open flyout:
 * tests/game/emergencyBanner.test.ts.)
 */
describe('an open toolbar flyout above the emergency banners (final fixes r4 U1)', () => {
  it('the bottom block with an open flyout stacks above the banners and the toasts, below the loading veil and the modal', () => {
    const raised = zOf('.hud-bottom:has(.flyout.open)');
    expect(raised).toBeGreaterThan(zOf('.emg-banners'));
    expect(raised).toBeGreaterThan(zOf('.hud-tl'));
    expect(raised).toBeLessThan(zOf('.loading-veil'));
    expect(raised).toBeLessThan(zOf(':where(.mp-ui) .modal-back'));
    // (closed, the block keeps its place under the banners)
    expect(zOf('.hud-bottom')).toBeLessThan(zOf('.emg-banners'));
  });
  it('the flyout lives in the bottom block\'s stacking context: the raise has to be the block\'s', () => {
    // .hud-bottom is transformed (a stacking context) and the flyout is positioned inside it, with no z-index of its own
    expect(bodyOf('.hud-bottom')).toMatch(/(?:^|;)\s*transform\s*:\s*translateX\(-50%\)/);
    expect(bodyOf('.flyout')).toMatch(/(?:^|;)\s*position\s*:\s*absolute/);
    expect(bodyOf('.flyout')).not.toMatch(/z-index/);
  });
});

/** NOTE-023: exercise both actual dock() branches with measured-layout inputs (CSS zoom 0.8 at these sizes). */
describe('emergency count pill clear of centred panel bodies', () => {
  const cases = [
    { width: 1024, height: 600, panel: 'Demographics', panelWidth: 560 },
    { width: 1024, height: 600, panel: 'Help', panelWidth: 900 },
    { width: 1280, height: 720, panel: 'Help', panelWidth: 900 },
  ];
  const overlaps = (a: DockRect, b: DockRect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  for (const liveBanners of [false, true]) {
    it.each(cases)(`${liveBanners ? 'live banners folded into the pill' : 'pill only'}: $panel at $width x $height`, ({ width, height, panelWidth }) => {
      const W = width / 0.8, H = height / 0.8, bottom = H - 96 - TOOLBAR_GAP;
      // Tall centred panels start below the top bar and reach their CSS max-height (100% - 170px).
      const panel: DockRect = { x: (W - panelWidth) / 2, y: 72, w: panelWidth, h: H - 170 };
      const panelEl = { offsetLeft: panel.x, offsetTop: panel.y, offsetWidth: panel.w, offsetHeight: panel.h,
        classList: { contains: (c: string) => c === 'center' } };
      const banners = new Map(Array.from({ length: liveBanners ? 10 : 0 }, (_, id) => [id, {
        id, inc: { start: 0 }, el: { offsetHeight: 150, classList: { contains: () => false } },
      }]));
      let placed: { d: DockPlace | null; compact: boolean; rows: number } | undefined;
      const state = {
        ctx: { root: { clientWidth: W, clientHeight: H, querySelectorAll: () => [panelEl] } },
        banners, moreShown: true, more: { offsetHeight: 34, style: { display: '', visibility: '' } },
        el: { offsetWidth: BANNER_W }, ro: null, mo: null, pressAt: 0, hiddenPrompts: liveBanners ? 0 : 10,
        dockDirty: true, ordered: () => [...banners.values()], stackBottom: () => bottom,
        applyDock: (d: DockPlace | null, compact: boolean, rows: number) => { placed = { d, compact, rows }; },
      };
      const dock = (EmergencyBanner.prototype as unknown as { dock(this: unknown): void }).dock;
      const check = () => {
        expect(placed).toBeDefined();
        expect(state.more.style.visibility).toBe('');
        expect(placed!.rows).toBe(liveBanners ? -1 : 0);
        const d = placed!.d;
        const pill = { x: d?.left ?? (W - BANNER_W) / 2, y: d?.top ?? STACK_TOP, w: d?.width ?? BANNER_W, h: state.more.offsetHeight };
        expect(overlaps(pill, panel), 'the whole body, including headline stats and section headings').toBe(false);
        expect(overlaps(pill, { ...panel, h: PANEL_HEAD_H }), 'title and tabs').toBe(false);
        expect(pill.x).toBeGreaterThanOrEqual(0);
        expect(pill.x + pill.w).toBeLessThanOrEqual(W);
        expect(pill.y).toBeGreaterThanOrEqual(STACK_TOP);
        expect(pill.y + pill.h).toBeLessThanOrEqual(bottom);
        return pill;
      };
      dock.call(state);
      const first = check();
      // The narrowed pill wraps; a subsequent dirty docking uses its actual taller measurement.
      state.el.offsetWidth = first.w;
      state.more.offsetHeight = first.w < 340 ? 94 : 48;
      state.dockDirty = true;
      dock.call(state);
      check();
    });
  }

  it('uses the strip below a panel when it fits above the toolbar, instead of the old below-header position', () => {
    const panel = { x: 190, y: 72, w: 900, h: 450 };
    const d = dockPill(1280, 34, [panel], 642)!;
    expect(d.width).toBe(BANNER_W);
    expect(d.top).toBeGreaterThanOrEqual(panel.y + panel.h);
    expect(d.top! + 34).toBeLessThanOrEqual(642);
    expect(overlaps({ x: d.left, y: d.top!, w: d.width, h: 34 }, panel)).toBe(false);
  });

  it('declines an occupied strip instead of returning a place over panel content', () => {
    expect(dockPill(1280, 34, [{ x: 0, y: 64, w: 1280, h: 600 }], 642)).toBeNull();
  });
});
