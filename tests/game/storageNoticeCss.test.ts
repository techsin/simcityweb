/**
 * T086 B1 / B2: where the region lock notice sits and when it hides (src/ui/storage.css). The project has no DOM or
 * layout engine in its tests, so this reads the rules and checks their numbers against the HUD's own: the UI zoom
 * (src/ui/zoom.ts), the stacking of the HUD layers, and the class names of the screens the selectors name.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeUiZoom } from '../../src/ui/zoom';

const read = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');
const storage = read('ui/storage.css');

/** the declarations of every rule whose selector list has exactly `selector`, merged in source order */
function rule(sheet: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of sheet.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const [selectors, body] = block.split('{');
    if (!body || !selectors.split(',').some((s) => s.trim().replace(/\s+/g, ' ') === selector)) continue;
    for (const decl of body.split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) out[decl.slice(0, colon).trim()] = decl.slice(colon + 1).trim();
    }
  }
  return out;
}

/** a CSS length made of px / vw / vh, numbers, * and /, min(), max() and clamp(), in px for a viewport */
function px(value: string, w: number, h: number): number {
  let at = 0;
  const skip = () => { while (value[at] === ' ' || value[at] === '\n') at++; };
  const list = (): number[] => {
    const args = [product()];
    for (skip(); value[at] === ','; skip()) { at++; args.push(product()); }
    if (value[at++] !== ')') throw new Error(`expected ")" at ${at} in ${value}`);
    return args;
  };
  const term = (): number => {
    skip();
    const fn = /^(min|max|clamp)\(/.exec(value.slice(at));
    if (fn) {
      at += fn[0].length;
      const args = list();
      return fn[1] === 'min' ? Math.min(...args) : fn[1] === 'max' ? Math.max(...args) : Math.max(args[0], Math.min(args[1], args[2]));
    }
    const num = /^(\d+(?:\.\d+)?)(px|vw|vh)?/.exec(value.slice(at));
    if (!num) throw new Error(`cannot read "${value.slice(at)}"`);
    at += num[0].length;
    return Number(num[1]) * (num[2] === 'vw' ? w / 100 : num[2] === 'vh' ? h / 100 : 1);
  };
  const product = (): number => {
    let v = term();
    for (skip(); value[at] === '*' || value[at] === '/'; skip()) v = value[at++] === '*' ? v * term() : v / term();
    return v;
  };
  const result = product();
  skip();
  if (at !== value.length) throw new Error(`unread "${value.slice(at)}"`);
  return result;
}

const NOTICE = '.storage-lock-notice';
const IN_CITY = '.meta-root:has(> .city-host) > .storage-lock-notice';
/** the toolbar block with a tool selected, in HUD px from the bottom edge (hud.css): .hud-bottom's 12, the toolbar's 68
 *  (56 + 2 × 5 padding + 2 border), the block's gap of 8, and the tool chip's 42 (its 28 px close button + 2 × 6 + 2) */
const TOOLBAR_BLOCK = 12 + 68 + 8 + 42;
const VIEWPORTS: [number, number][] = [[1280, 720], [1366, 768], [1600, 900], [1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160], [1024, 600], [900, 1200], [800, 600]];

describe('the lock notice in a city (T086 B2)', () => {
  it('leaves the top centre, where the emergency banners hang, and docks at the bottom centre', () => {
    expect(rule(storage, NOTICE)).toMatchObject({ top: '82px', left: '50%' }); // (the region screen keeps it there)
    const docked = rule(storage, IN_CITY);
    expect(docked.top).toBe('auto');
    expect(docked.bottom).toBeDefined();
    expect(docked.left).toBeUndefined();
  });

  it.each(VIEWPORTS)('sits 12 HUD px above the toolbar block at %i x %i, following the UI zoom', (w, h) => {
    const zoom = computeUiZoom(w, h, 1);
    const bottom = px(rule(storage, IN_CITY).bottom, w, h);
    // (computeUiZoom rounds to 0.01: 142 HUD px are then within 0.71 px)
    expect(Math.abs(bottom - 142 * zoom)).toBeLessThan(0.75);
    expect(bottom - TOOLBAR_BLOCK * zoom).toBeGreaterThan(6);
  });

  it('is 113.6 px up at 1280 x 720 and 154.9 px up at 1920 x 1080', () => {
    const bottom = rule(storage, IN_CITY).bottom;
    expect(px(bottom, 1280, 720)).toBeCloseTo(113.6, 1);
    expect(px(bottom, 1920, 1080)).toBeCloseTo(154.9, 1);
  });

  it('stacks under every HUD layer that can reach it, so a banner, the pill, a flyout or a card keeps its clicks', () => {
    const z = Number(rule(storage, IN_CITY)['z-index']);
    expect(z).toBeGreaterThan(Number(rule(read('region/ui/meta.css'), '.neighbor-labels')['z-index']));
    const hud = read('ui/hud.css'), emergency = read('ui/emergency.css');
    const layers: [string, string][] = [
      [emergency, '.emg-banners'], [emergency, '.emg-teach-fallback'], [hud, '.hud-bottom'], [hud, '.hud-bottom:has(.flyout.open)'],
      [hud, '.panel-layer'], [hud, '.minimap'], [hud, '.hud-bl'], [hud, '.hud-top'], [hud, '.hud-tl'], [read('ui/yearReview.css'), '.year-review'],
    ];
    for (const [sheet, selector] of layers) expect(Number(rule(sheet, selector)['z-index']), selector).toBeGreaterThan(z);
    // outside a city it stays above the screens' own layers, as before
    expect(rule(storage, NOTICE)['z-index']).toBe('95');
  });
});

describe('the lock notice while a screen is on its way in (T086 B1)', () => {
  it('is hidden under a loading screen and on the title screen, so its button cannot start a takeover there', () => {
    for (const screen of ['.loading', '.title-screen']) {
      expect(rule(storage, `.meta-root:has(> ${screen}) > .storage-lock-notice`), screen).toEqual({ visibility: 'hidden' });
    }
  });

  it('names the elements the app really puts under its root', () => {
    const main = read('main.ts');
    expect(main).toContain("this.root = h('div', { class: 'meta-root' });");
    expect(main).toMatch(/const container = h\('div', \{ class: 'meta-layer city-host' \}\);\s+this\.root\.prepend\(container\);/);
    expect(read('region/ui/LoadingScreen.ts')).toMatch(/\{ class: 'loading' \},[\s\S]*root\.appendChild\(this\.el\);/);
    expect(read('region/ui/TitleScreen.ts')).toMatch(/\{ class: 'title-screen' \},[\s\S]*root\.appendChild\(this\.el\);/);
    expect(read('ui/StorageDialog.ts')).toMatch(/this\.banner = h\('div', \{ class: 'storage-lock-notice glass', role: 'status' \}\);\s+root\.appendChild\(this\.banner\);/);
  });
});
