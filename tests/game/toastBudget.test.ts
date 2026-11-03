/**
 * FEEL-02a's toast budget: advisor, warning, good and reward news (and the demand-cap warning) show at most one per 4 s
 * and 8 a minute; bad news, disasters, errors and the player's own feedback always show (and count); a budgeted toast
 * with an action waits in a queue and appears within 60 s, never dropped; others stay in the ticker only.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { NewsItem } from '../../src/sim/CityState';
import type { CityEvents } from '../../src/sim/Simulation';
import type { GameContext } from '../../src/game/context';
import { Toasts } from '../../src/ui/Notifications';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
// the fake DOM has no isConnected / animate: a toast is connected while it hangs under the toast stack
const proto = FEl.prototype as unknown as Record<string, unknown>;
beforeAll(() => {
  Object.defineProperty(proto, 'isConnected', { configurable: true, get(this: FEl) { let e: FEl | null = this; while (e?.parentNode) e = e.parentNode; return !!(e as unknown as { stack?: boolean })?.stack; } });
  proto.animate = () => undefined;
});
afterAll(() => {
  delete proto.isConnected;
  delete proto.animate;
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('window', globalThis);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function make() {
  const root = new FEl('div');
  (root as unknown as { stack: boolean }).stack = true;
  const events = new Emitter<CityEvents>();
  const abort = new AbortController();
  const ctx = { signal: abort.signal, sim: { events }, settings: { toasts: true }, mods: {}, root, sound() {}, focusCell: vi.fn() } as unknown as GameContext;
  const toasts = new Toasts(ctx, root as unknown as HTMLElement);
  const el = toasts.el as unknown as FEl;
  /** every toast that appeared: [seconds since start, text] (also those already gone) */
  const seen: [number, string][] = [];
  const t0 = performance.now();
  // a new toast is prepended to the stack once; a merge only moves a live one to the top
  const prepend = el.prepend.bind(el);
  el.prepend = (...cs: (FEl | string)[]) => {
    for (const c of cs) if (c instanceof FEl && !el.children.includes(c)) seen.push([(performance.now() - t0) / 1000, textOf(c.querySelector('.t-text')!)]);
    prepend(...cs);
  };
  const news = (text: string, kind: NewsItem['kind'], extra: Partial<NewsItem> = {}) => events.emit('news', { day: 1, text, kind, ...extra });
  const texts = () => el.children.map((c) => textOf(c.querySelector('.t-text')!));
  return { toasts, el, events, news, seen, texts, abort };
}

/** the times of every window of `w` s that holds more than `max` of these times */
function overfull(times: number[], w: number, max: number): number[] {
  const bad: number[] = [];
  for (let i = 0; i < times.length; i++) if (times.filter((t) => t >= times[i] && t < times[i] + w).length > max) bad.push(times[i]);
  return bad;
}

describe('Toasts: the FEEL-02a budget', () => {
  it('budgeted news shows at most one per 4 s and 8 in any 60 s; the rest is dropped (it stays in the ticker)', () => {
    const { news, seen } = make();
    for (let s = 0; s < 120; s++) {
      news(`Good news ${s}`, 'good');
      vi.advanceTimersByTime(1000);
    }
    const times = seen.map((x) => x[0]);
    expect(times.slice(0, 9)).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 60]);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(4);
    expect(overfull(times, 60, 8)).toEqual([]);
    expect(times.length).toBe(16);
  });

  it('advisor, warning and reward news share the budget; info and quiet advisor news never toast', () => {
    const { news, seen } = make();
    news('Traffic is getting worse!', 'advisor');
    news('Demand is shifting', 'warning');
    news('New landmark available: Stadium!', 'reward');
    news('A quiet note', 'info');
    news('A calm advisor remark', 'advisor');
    expect(seen.map((x) => x[1])).toEqual(['Traffic is getting worse!']);
    vi.advanceTimersByTime(4000);
    news('Demand is shifting', 'warning');
    expect(seen.map((x) => x[1])).toEqual(['Traffic is getting worse!', 'Demand is shifting']);
  });

  it('bad news and disasters always show, even over budget, and they count against it', () => {
    const { news, seen } = make();
    news('Good 1', 'good');
    for (let k = 0; k < 10; k++) news(`Fire ${k}!`, k % 2 ? 'disaster' : 'bad');
    expect(seen).toHaveLength(11);
    vi.advanceTimersByTime(5000);
    news('Good 2', 'good');
    // 11 toasts in the last minute: the budget is spent until the window frees up
    expect(seen.map((x) => x[1])).not.toContain('Good 2');
    vi.advanceTimersByTime(56000);
    news('Good 3', 'good');
    expect(seen[seen.length - 1][1]).toBe('Good 3');
  });

  it("the player's own feedback and the New Year toast are not budgeted (they always show)", () => {
    const { toasts, seen } = make();
    toasts.show('News', 'good', undefined, undefined, { budget: true });
    toasts.show('Not enough money', 'error');
    toasts.show('Fire engine dispatched', 'good', undefined, 'Dispatched');
    toasts.show('Testville celebrates with 101,650 residents.', 'reward', undefined, '🎆 Happy New Year 2011!', { silent: true });
    expect(seen.map((x) => x[1])).toEqual(['News', 'Not enough money', 'Fire engine dispatched', 'Testville celebrates with 101,650 residents.']);
  });

  it('a repeat of a live toast merges into it (×2) without spending the budget', () => {
    const { news, seen, el } = make();
    news('Power shortage looming', 'warning');
    news('Power shortage looming', 'warning');
    expect(el.children).toHaveLength(1);
    expect(textOf(el.querySelector('.t-count')!)).toBe('×2');
    vi.advanceTimersByTime(4000);
    news('Other news', 'good');
    expect(seen.map((x) => x[1])).toEqual(['Power shortage looming', 'Other news']);
  });

  it('a budgeted toast with an action is queued over budget and appears when the budget allows, never dropped', () => {
    const { toasts, news, seen, el } = make();
    const run = vi.fn();
    news('Good 0', 'good');
    toasts.show('Zone more homes', 'advisor', undefined, 'Planning', { budget: true, action: { hint: 'Zone homes', run } });
    expect(seen.map((x) => x[1])).toEqual(['Good 0']);
    // ... and other budgeted news meanwhile does not jump the queue
    vi.advanceTimersByTime(3000);
    news('Good 1', 'good');
    vi.advanceTimersByTime(1000);
    expect(seen.map((x) => x[1])).toEqual(['Good 0', 'Zone more homes']);
    const t = el.children[0];
    expect(textOf(t.querySelector('.t-go')!)).toContain('Zone homes');
    t.click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a queued action toast appears within 60 s even while bad news and disasters keep the budget spent', () => {
    const { toasts, news, seen } = make();
    for (let k = 0; k < 8; k++) news(`Fire ${k}`, 'disaster');
    toasts.show('Place it', 'reward', undefined, 'New building', { budget: true, action: { hint: 'Place it', run() {} } });
    let at = -1;
    for (let s = 1; s <= 70 && at < 0; s++) {
      news(`Flood ${s}`, 'bad');
      vi.advanceTimersByTime(1000);
      const hit = seen.find((x) => x[1] === 'Place it');
      if (hit) at = hit[0];
    }
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThanOrEqual(60);
  });

  it('a news item with an action (NewsItem.ref through newsAction) is queued, not dropped', () => {
    const { toasts, news, seen } = make();
    const run = vi.fn();
    toasts.newsAction = (n) => (n.ref?.advice === 'zoneR' ? { hint: 'Zone homes', run } : undefined);
    news('Good 0', 'good');
    news('No room to grow — zone more residential land!', 'warning', { ref: { advice: 'zoneR' } });
    news('Another warning', 'warning');
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(4100);
    expect(seen.map((x) => x[1])).toEqual(['Good 0', 'No room to grow — zone more residential land!']);
  });

  it('leaving the city drops the queue and its timer', () => {
    const { toasts, news, seen, abort } = make();
    news('Good 0', 'good');
    toasts.show('Zone more homes', 'advisor', undefined, undefined, { budget: true, action: { hint: 'Zone homes', run() {} } });
    abort.abort();
    vi.advanceTimersByTime(70000);
    expect(seen.map((x) => x[1])).toEqual(['Good 0']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the demand-cap toast shares the budget (TopBar passes budget through ctx.toast, CityScene through to Toasts)', () => {
    const top = readFileSync(new URL('../../src/ui/TopBar.ts', import.meta.url), 'utf8');
    expect(top).toMatch(/'warning', undefined, 'Demand cap', \{ budget: true \}\)/);
    const scene = readFileSync(new URL('../../src/game/CityScene.ts', import.meta.url), 'utf8');
    expect(scene).toContain('toast: (text, kind, cell, title, opts) => this.toasts?.show(text, kind, cell, title, opts),');
    expect(scene).toContain('toast: (text, kind, cell, title, opts) => this.toasts.show(text, kind, cell, title, opts),');
  });
});
