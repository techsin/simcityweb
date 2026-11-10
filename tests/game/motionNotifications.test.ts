/** FEEL-21: reduced motion leaves the news readable and actionable, without ticker travel or toast badge pops. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import type { MotionPref } from '../../src/game/settings';
import type { ToolSpec } from '../../src/game/toolCatalog';
import { NewsTicker, Toasts } from '../../src/ui/Notifications';
import { Toolbar } from '../../src/ui/Toolbar';
import { FEl, installFakeDom, textOf } from './fakeDom';
import { tickerLayout } from './tickerLayout';

installFakeDom();
const aborts: AbortController[] = [];
let osReduced = false;
beforeEach(() => {
  osReduced = false;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('matchMedia', () => ({ matches: osReduced }));
});
afterEach(() => {
  for (const abort of aborts.splice(0)) abort.abort();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function context(motion: MotionPref) {
  const abort = new AbortController();
  aborts.push(abort);
  const settings = { motion, toasts: true };
  const root = new FEl('div');
  const focusCell = vi.fn(), open = vi.fn();
  const ctx = {
    settings, root, signal: abort.signal, focusCell, panels: { open }, mods: {}, sound() {},
    host: { newsSeq: 0 }, state: { news: [], day: 0, config: { name: 'Riverton', startYear: 2000 } },
    sim: { events: { on: () => () => {} } },
  } as unknown as GameContext;
  return { ctx, root, settings, focusCell, open };
}

function makeTicker(motion: MotionPref) {
  const t = context(motion);
  const ticker = new NewsTicker(t.ctx, t.root as unknown as HTMLElement);
  const layout = tickerLayout(ticker);
  const run = (seconds: number) => {
    for (let n = 0; n < Math.round(seconds * 60); n++) ticker.frame(1 / 60);
  };
  return { ...t, ticker, ...layout, run };
}

const LONG = 'Commuters praise the new crosstown avenue as average trips fall to eighteen minutes across town';

describe('FEEL-21: news ticker', () => {
  it('never enters or scrolls in reduced motion, but rotates long items at the ordinary hold interval', () => {
    const t = makeTicker('reduced');
    t.ticker.push({ text: LONG, kind: 'good' });
    t.ticker.push({ text: 'The next report.', kind: 'good' });
    t.ticker.frame(0);
    expect(t.ticker.current?.text).toBe(LONG);
    expect(t.x()).toBe(0);
    for (let s = 0; s < 4; s++) {
      t.run(1);
      expect(t.x()).toBe(0);
      expect(t.ticker.current?.text).toBe(LONG);
    }
    t.run(1.1);
    expect(t.ticker.current?.text).toBe('The next report.');
    expect(t.x()).toBe(0);
  });

  it('keeps the full tooltip, focus action and news-feed action on a static item', () => {
    const t = makeTicker('reduced');
    t.ticker.push({ text: LONG + ' More details are in this tooltip.', kind: 'good', x: 4, z: 7 });
    t.ticker.frame(0);
    const item = t.track.children[0];
    expect(item.getAttribute('title')).toBe(LONG + ' More details are in this tooltip.');
    expect(textOf(item.querySelector('.tk-text')!)).toContain('Commuters praise');
    t.el.fire('click', { target: { closest: () => item } });
    expect(t.focusCell).toHaveBeenCalledWith(4, 7);
    t.el.fire('click', { target: { closest: () => null } });
    expect(t.open).toHaveBeenCalledWith('advisors');
  });

  it('stops an item mid-scroll even while hovered, and restores motion without rebuilding or reading layout', () => {
    const t = makeTicker('full');
    t.ticker.push({ text: LONG, kind: 'good' });
    t.ticker.frame(0);
    t.run(2.5);
    expect(t.x()).toBeLessThan(0);
    const item = t.track.children[0], reads = t.reads();
    t.el.fire('pointerenter');
    t.settings.motion = 'reduced';
    t.ticker.frame(0);
    expect(t.x()).toBe(0);
    t.settings.motion = 'full';
    t.ticker.frame(0);
    expect(t.x()).toBeLessThan(0);
    expect(t.track.children[0]).toBe(item);
    expect(t.reads()).toBe(reads);
  });

  it('follows OS changes in System mode and lets Full override an OS request for reduced motion', () => {
    const t = makeTicker('system');
    t.ticker.push({ text: LONG, kind: 'good' });
    t.ticker.frame(0);
    expect(t.x()).toBeGreaterThan(0);
    osReduced = true;
    t.ticker.frame(0);
    expect(t.x()).toBe(0);
    t.settings.motion = 'full';
    t.ticker.frame(0);
    expect(t.x()).toBeGreaterThan(0);
    t.settings.motion = 'system';
    osReduced = false;
    t.ticker.frame(0);
    expect(t.x()).toBeGreaterThan(0);
  });
});

describe('FEEL-21: toast merges', () => {
  it('updates the duplicate count quietly in Reduced/System, and restores badge pops in Full', () => {
    osReduced = true;
    const t = context('system');
    const toasts = new Toasts(t.ctx, t.root as unknown as HTMLElement);
    toasts.show('A repeated report.', 'good');
    const el = (toasts.el as unknown as FEl).children[0];
    Object.defineProperty(el, 'isConnected', { value: true });
    const badge = el.querySelector('.t-count')!;
    const animate = vi.fn();
    (badge as unknown as { animate: typeof animate }).animate = animate;
    toasts.show('A repeated report.', 'good');
    expect(textOf(badge)).toBe('\u00d72');
    expect(animate).not.toHaveBeenCalled();
    t.settings.motion = 'full';
    toasts.show('A repeated report.', 'good');
    expect(textOf(badge)).toBe('\u00d73');
    expect(animate).toHaveBeenCalledOnce();
    t.settings.motion = 'reduced';
    toasts.show('A repeated report.', 'good');
    expect(textOf(badge)).toBe('\u00d74');
    expect(animate).toHaveBeenCalledOnce();
    expect((toasts.el as unknown as FEl).children).toHaveLength(1);
  });
});

describe('FEEL-21: locked toolbar cards', () => {
  it('keeps error feedback but skips the card shake in Reduced/System and restores it in Full', () => {
    const t = context('reduced');
    const sound = vi.fn();
    t.ctx.sound = sound;
    const toolbar = Object.assign(Object.create(Toolbar.prototype), { ctx: t.ctx }) as { item(spec: ToolSpec, active: boolean): HTMLElement };
    const item = toolbar.item({ id: 'locked', label: 'Locked', icon: 'lock', locked: { hint: 'Reach 2,000 residents' }, create() { throw new Error('unused'); } }, false) as unknown as FEl;
    const animate = vi.fn();
    (item as unknown as { animate: typeof animate }).animate = animate;
    item.click();
    expect(sound).toHaveBeenCalledWith('error');
    expect(animate).not.toHaveBeenCalled();
    t.settings.motion = 'full';
    item.click();
    expect(animate).toHaveBeenCalledOnce();
    t.settings.motion = 'system';
    osReduced = true;
    item.click();
    expect(animate).toHaveBeenCalledOnce();
    expect(sound).toHaveBeenCalledTimes(3);
  });
});
