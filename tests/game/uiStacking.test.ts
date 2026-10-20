/**
 * Final fixes UI-6 (lane ui): the top bar's popovers — the approval breakdown on hover, the RCI card while open — drew
 * under the emergency banners (.emg-banners, z 55, emergency.css) and the toast stack (.hud-tl, z 50): the approval
 * card's "Emergencies last month −8.0" was hidden exactly when it mattered. While one is up the top bar stacks above
 * both and below the modal (60); the loading veil stays above the raised bar. The popovers are nearly opaque (a
 * banner's red text and blue buttons showed through the glass). Browser-checked at 1280x720; this pins the order.
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
