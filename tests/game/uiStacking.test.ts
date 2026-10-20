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
