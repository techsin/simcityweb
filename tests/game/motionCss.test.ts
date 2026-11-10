/** FEEL-21: CSS contracts for HUD effects; actual rendering remains a browser acceptance check. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = (name: string) => readFileSync(new URL(`../../src/ui/${name}.css`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const hud = css('hud'), emergency = css('emergency'), fx = css('fx');
function rule(source: string, selector: string): string {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].split(',').some((s) => s.trim() === selector))?.[2] ?? '';
}

describe('FEEL-21: reduced-motion CSS', () => {
  for (const root of ['.mp-ui.reduced-motion', '.mp-ui:not(.full-motion)']) {
    it(`${root} leaves pulses, blinks, coach marks, spinners and their pseudo-elements steady`, () => {
      for (const target of ['', ' *', '::before', '::after', ' *::before', ' *::after']) {
        const body = rule(hud, root + target);
        expect(body).toMatch(/animation:\s*none\s*!important/);
        expect(body).toMatch(/transition:\s*none\s*!important/);
      }
      for (const target of ['', ' *']) {
        const veil = rule(hud, `.mp-scene:has(${root}) .loading-veil${target}`);
        expect(veil).toMatch(/animation:\s*none\s*!important/);
        expect(veil).toMatch(/transition:\s*none\s*!important/);
      }
      expect(rule(hud, `${root} .tk-track`)).toMatch(/transform:\s*translateX\(0\)\s*!important/);
      expect(rule(hud, `${root} .toast .t-timer`)).toMatch(/display:\s*none\s*!important/);
      expect(rule(emergency, `${root} .settling::after`)).toMatch(/display:\s*none/);
      for (const kind of ['saved', 'lost']) {
        const outcome = rule(fx, `${root} .emg-banner.emg-${kind}`);
        expect(outcome).toMatch(/border-color:\s*var\(--hair\)/);
        expect(outcome).toMatch(/border-left-color:\s*var\(--kc\)/);
        expect(outcome).not.toMatch(/var\(--good\)|var\(--bad\)/);
        const steady = rule(emergency, '.emg-banner');
        expect(outcome.match(/box-shadow:[^;]+;/)?.[0]).toBe(steady.match(/box-shadow:[^;]+;/)?.[0]);
      }
    });

    it(`${root} gives toasts only a 150 ms opacity fade, including their exit`, () => {
      const toast = rule(hud, `${root} .toast`);
      expect(toast).toMatch(/transform:\s*none\s*!important/);
      expect(toast).toMatch(/transition:\s*opacity 0\.15s ease-out\s*!important/);
      expect(rule(hud, `${root} .toast:not(.out)`)).toMatch(/animation:\s*fadeIn 0\.15s ease-out\s*!important/);
      const fade = /@keyframes fadeIn\s*\{\s*from\s*\{([^}]+)\}/.exec(hud)?.[1] ?? '';
      expect(fade).toMatch(/opacity:\s*0/);
      expect(fade).not.toMatch(/transform|translate|scale/);
    });
  }

  it('keeps each OS fallback behind prefers-reduced-motion and excludes explicit Full', () => {
    for (const source of [hud, emergency, fx]) {
      const at = source.indexOf('@media (prefers-reduced-motion: reduce)');
      expect(at).toBeGreaterThan(0);
      const fallback = source.slice(at);
      const selectors = [...fallback.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap((m) => m[1].split(','));
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) expect(selector).toContain('.mp-ui:not(.full-motion)');
    }
  });
});
