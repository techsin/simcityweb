/**
 * T061 F2 (T034b's review): the worker crash dialog (§4.4) opens over a running city, but it is a region-screen modal:
 * its backdrop (meta.css `.modal-back`, z 40) sat under the city HUD's layers (the toasts 50, the toolbar's block 45,
 * the emergency banners 55, the error stack 80, the tips 90-95: the review's probe clicked the toolbar through it). It
 * now takes `.modal-top`, which stacks above every z-index the city screen uses, T036 step 4's storage dialogs
 * (storage.css, z 130) included: with the worker dead their Retry cannot work, so the crash dialog wins.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSimCrashDialog } from '../../src/region/ui/dialogs';
import { setUiRoot } from '../../src/region/ui/modal';
import { FEl, FNode, installFakeDom } from './fakeDom';

installFakeDom();
const src = (f: string) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** the z-index of the rule whose selector list is exactly `sel` */
function zOf(css: string, sel: string): number {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (norm(m[1]) !== norm(sel)) continue;
    const z = /(?:^|;)\s*z-index\s*:\s*(-?\d+)/.exec(m[2]);
    if (z) return Number(z[1]);
  }
  throw new Error(`no z-index for ${sel}`);
}
/** every z-index the city screen can show: its style sheets, the region screen's other rules, inline styles */
function cityLayers(): { where: string; z: number }[] {
  const out: { where: string; z: number }[] = [];
  const scan = (where: string, text: string) => { for (const m of text.matchAll(/z-?index\s*[:=]\s*['"]?(-?\d+)/gi)) out.push({ where, z: Number(m[1]) }); };
  for (const f of readdirSync(new URL('../../src/ui/', import.meta.url))) if (f.endsWith('.css')) scan(`ui/${f}`, src(`ui/${f}`));
  scan('region/ui/meta.css', src('region/ui/meta.css').replace(/\.modal-back\.modal-top\s*\{[^}]*\}/, ''));
  for (const dir of ['game', 'ui']) for (const f of readdirSync(new URL(`../../src/${dir}/`, import.meta.url))) {
    if (f.endsWith('.ts') && f !== 'demo.ts') scan(`${dir}/${f}`, src(`${dir}/${f}`));
  }
  return out;
}

describe('the worker crash dialog stacks above the city HUD (T061 F2)', () => {
  let root: FEl;
  beforeEach(() => {
    vi.stubGlobal('Node', FNode);
    vi.stubGlobal('window', new FEl('window'));
    root = new FEl('div');
    setUiRoot(root as unknown as HTMLElement);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('its backdrop is a .modal-top, and .modal-top is above every layer the city screen draws', async () => {
    const choice = openSimCrashDialog({ cityName: 'Testville', message: 'The simulation worker stopped responding', recoverable: false });
    const back = root.querySelector('.modal-back');
    expect(back?.classList.contains('modal-top'), 'the crash dialog\'s backdrop').toBe(true);
    const top = zOf(src('region/ui/meta.css'), '.modal-back.modal-top');
    const layers = cityLayers();
    expect(layers.length).toBeGreaterThan(20);
    const above = layers.filter((l) => l.z >= top);
    expect(above, `layers at or above the crash dialog (${top})`).toEqual([]);
    // the HUD's own modal (the pause menu, confirm) and the region screen's are below it as well
    expect(top).toBeGreaterThan(zOf(src('ui/hud.css'), ':where(.mp-ui) .modal-back'));
    expect(top).toBeGreaterThan(zOf(src('region/ui/meta.css'), '.modal-back'));
    root.querySelectorAll('button').find((b) => b.classList.contains('primary'))?.click();
    await expect(choice).resolves.toBe('restart');
  });
});
