/**
 * QA round 2 of T070, on the Rewards panel's rows. B1: `.reward-prog .bar { flex: 1 }` beside an unshrinkable text gave
 * the progress bar 0 px on every row whose requirement needs two lines (the Statue's, six of the twelve honours'): the
 * bar keeps a floor, and a text too long to leave it that much wraps under it; rows whose text fits beside a bar of that
 * width lay out as before. B6: the Rewards / Honours tabs scrolled away with the list: they sit in a sticky strip, as
 * the Settings nav does. Browser-checked on the real GPU by the lead; this pins the rules and the markup they style.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { normalizeReward } from '../../src/game/modules';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { RewardsPanel } from '../../src/ui/panels/ListPanels';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();

const css = (f: string) => readFileSync(new URL(`../../src/ui/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const hud = css('hud.css'), rewards = css('rewards.css');

/** the declarations of the rule whose selector list is exactly `sel` (null: no such rule) */
function bodyOf(sheet: string, sel: string): Record<string, string> | null {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (norm(m[1]) !== norm(sel)) continue;
    return Object.fromEntries(m[2].split(';').map((d) => d.split(':')).filter((d) => d.length > 1).map(([k, ...v]) => [k.trim(), norm(v.join(':'))]));
  }
  return null;
}

const aborts: AbortController[] = [];
afterEach(() => { for (const a of aborts.splice(0)) a.abort(); });

function panel() {
  const abort = new AbortController();
  aborts.push(abort);
  const state = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false, treeDensity: 0, waterAmount: 0 }));
  const statue = {
    id: 'statue', name: 'Statue of the Mayor', kind: 'reward', unlocked: false, progress: 0.5, defIds: ['civ_statue'],
    progressText: 'Population 56,380 / 2,500 · Approval 56 / 55 · Months at approval ≥55% 3 / 6 OR +9.0 / 10 points from lowest 47.2% · Recovery months 0 / 6',
  };
  const city = { id: 'city_hall', name: 'City Hall', kind: 'reward', unlocked: false, progress: 0.25, defIds: ['civ_city_hall'], progressText: 'Population 5,000 / 20,000' };
  const ctx = {
    state, signal: abort.signal, host: { events: { on: () => () => undefined }, commandCount: 0 },
    mods: { listRewards: () => [statue, city].map(normalizeReward) }, tools: { select: () => true }, panels: { close: () => undefined },
  } as unknown as GameContext;
  const p = new RewardsPanel(ctx);
  p.mount(() => undefined, () => undefined, () => undefined);
  p.onOpen();
  p.update();
  return p.body as unknown as FEl;
}

describe('QA round 2, B1: a reward row\'s progress bar keeps its width', () => {
  it('the bar has a floor it starts from, and the row wraps instead of squeezing it', () => {
    const row = bodyOf(hud, '.reward-prog')!, bar = bodyOf(hud, '.reward-prog .bar')!;
    expect(row.display).toBe('flex');
    expect(row['flex-wrap']).toBe('wrap');
    const floor = Number(/^(\d+)px$/.exec(bar['min-width'])?.[1]);
    expect(floor).toBeGreaterThanOrEqual(64);
    // grows over what its line has left (alone on it when the text wrapped), from the floor, never under it
    expect(bar.flex).toBe(`1 1 ${floor}px`);
  });

  it('the text keeps its own width: a short requirement stays on the bar\'s line', () => {
    // (no rule gives the text a full line of its own, or a width that would wrap a short one)
    for (const sel of ['.reward-prog span', '.reward-prog > span']) {
      const text = bodyOf(hud, sel) ?? bodyOf(rewards, sel);
      expect(text?.flex ?? '', sel).not.toMatch(/100%/);
      expect(text?.['flex-basis'] ?? '', sel).not.toMatch(/100%/);
      expect(text?.width ?? '', sel).toBe('');
    }
    // the column gap of a one-line row is the 8 px it was
    expect(bodyOf(hud, '.reward-prog')!.gap).toMatch(/^(\d+px )?8px$/);
  });

  it('the rows these rules style: the bar, then the requirement, in one .reward-prog', () => {
    const rows = panel().querySelectorAll('.li');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const prog = row.querySelector('.reward-prog')!;
      expect(prog.children.map((c) => `${c.tagName.toLowerCase()}.${c.className}`)).toEqual(['div.bar warn', 'span.']);
      expect(prog.children[0].querySelector('.fill')!.style.width).toMatch(/^\d+%$/);
    }
    const statue = rows.find((r) => r.dataset.reward === 'statue')!;
    expect(statue.querySelector('.fill')!.style.width).toBe('50%');
    expect(textOf(statue.querySelector('.reward-prog')!.children[1])).toContain('Recovery months 0 / 6');
  });
});

describe('QA round 2, B6: the Rewards / Honours tabs stay in view', () => {
  it('the tabs sit in a strip of their own, the first thing in the scrolling body, before the list', () => {
    const body = panel();
    expect(body.children.map((c) => c.className)).toEqual(['reward-tabs', 'list']);
    const strip = body.children[0];
    expect(strip.children.map((c) => c.className)).toEqual(['ui-seg']);
    expect(strip.children[0].children.map(textOf)).toEqual(['Rewards', 'Honours']);
  });

  it('the strip is sticky at the top of the body, above the rows and opaque', () => {
    const strip = bodyOf(rewards, '.reward-tabs')!;
    expect(strip.position).toBe('sticky');
    expect(strip.top).toBe('0');
    expect(Number(strip['z-index'])).toBeGreaterThanOrEqual(1);
    expect(strip.background).toMatch(/rgb\(/);
    expect(strip.background).not.toMatch(/rgba\(|transparent/);
    // no row is positioned above it
    for (const sel of ['.li', '.li:hover', '.li.on', '.li.locked', '.li.reward-highlight']) {
      expect((bodyOf(hud, sel) ?? bodyOf(rewards, sel))?.['z-index'] ?? '', sel).toBe('');
    }
  });

  it('the strip covers the body\'s top and side padding, so it is flush under the panel head and no row shows beside it', () => {
    const body = bodyOf(hud, '.panel-body')!, strip = bodyOf(rewards, '.reward-tabs')!;
    expect(body['overflow-y']).toBe('auto');
    const [top, side] = /^(\d+)px (\d+)px/.exec(body.padding)!.slice(1).map(Number);
    const [mTop, mSide, mBottom] = /^(-?\d+)px (-?\d+)px (-?\d+)px$/.exec(strip.margin)!.slice(1).map(Number);
    expect([mTop, mSide]).toEqual([-top, -side]);
    expect(mBottom).toBeGreaterThan(0);
    const [, pSide] = /^(\d+)px (\d+)px/.exec(strip.padding)!.slice(1).map(Number);
    expect(pSide).toBe(side);
  });
});
