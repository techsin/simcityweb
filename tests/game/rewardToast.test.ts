/** FEEL-06: reward references open the matching Rewards row through FEEL-02a's shared toast queue. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext, UIEvents } from '../../src/game/context';
import type { RewardInfo } from '../../src/game/modules';
import { CityState, type NewsItem } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import type { CityEvents } from '../../src/sim/Simulation';
import { Toasts } from '../../src/ui/Notifications';
import { PanelManager } from '../../src/ui/Panel';
import { RewardsPanel } from '../../src/ui/panels/ListPanels';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const proto = FEl.prototype as unknown as Record<string, unknown>;
const scroll = vi.fn();
beforeAll(() => { proto.scrollIntoView = scroll; });
afterAll(() => { delete proto.scrollIntoView; });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('window', globalThis);
  scroll.mockClear();
});
const aborts: AbortController[] = [];
afterEach(() => {
  for (const abort of aborts.splice(0)) abort.abort();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function make() {
  const root = new FEl('div'), layer = new FEl('div');
  layer.clientWidth = 1600;
  layer.clientHeight = 900;
  root.appendChild(layer);
  const abort = new AbortController();
  aborts.push(abort);
  const events = new Emitter<CityEvents>();
  const state = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false, treeDensity: 0, waterAmount: 0 }));
  const items: RewardInfo[] = ['reward', 'landmark'].map((id) => ({ id, name: `The ${id}`, description: '', unlocked: true, progress: 1, requirement: '', defIds: [] }));
  const ctx = {
    root, signal: abort.signal, state, sim: { events }, host: { events, commandCount: 0 },
    settings: { toasts: true }, mods: { listRewards: () => items }, ui: new Emitter<UIEvents>(), sound() {}, focusCell: vi.fn(),
  } as unknown as GameContext;
  const panels = new PanelManager(ctx, layer as unknown as HTMLElement);
  ctx.panels = panels;
  const panel = new RewardsPanel(ctx);
  panels.register(panel);
  const toasts = new Toasts(ctx, root as unknown as HTMLElement);
  const el = toasts.el as unknown as FEl;
  const news = (text: string, kind: NewsItem['kind'], ref?: NewsItem['ref']) => events.emit('news', { day: 1, text, kind, ref });
  const rows = () => (panel.body as unknown as FEl).querySelectorAll('.li');
  return { news, el, panel, panels, items, rows, toasts, abort };
}

describe('reward toast Place it action', () => {
  it.each(['reward', 'landmark'])('opens Rewards, scrolls to and highlights the %s reference regardless of text', (id) => {
    const { news, el, panel, panels, rows } = make();
    news('A headline with the other item and no matching name', 'reward', { reward: id });
    expect(textOf(el.querySelector('.t-go')!)).toContain('Place it');
    el.children[0].click();
    expect(panels.isOpen('rewards')).toBe(true);
    const selected = rows().find((row) => row.dataset.reward === id)!;
    expect(rows().filter((row) => row.classList.contains('reward-highlight'))).toEqual([selected]);
    expect(scroll.mock.contexts).toEqual([selected]);
    expect(scroll).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' });
    expect(panels.get('rewards')).toBe(panel);
  });

  it('queues a referenced reward over budget and keeps its Place it action', () => {
    const { news, el, panels, rows } = make();
    news('Earlier good news', 'good');
    news('Unlocked another item', 'reward', { reward: 'landmark' });
    expect(el.children).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(textOf(el.children[0])).toContain('Unlocked another item');
    expect(textOf(el.children[0])).toContain('Place it');
    el.children[0].click();
    expect(panels.isOpen('rewards')).toBe(true);
    expect(rows().find((row) => row.classList.contains('reward-highlight'))?.dataset.reward).toBe('landmark');
  });

  it('spaces five capped rewards in order and keeps every Place it action', () => {
    const { news, el, panels, items, rows } = make();
    const ids = Array.from({ length: 5 }, (_, i) => `capped-${i}`);
    const reward = items[0];
    items.splice(0, items.length, ...ids.map((id) => ({ ...reward, id, name: id })));
    const seen: { at: number; id: string; el: FEl }[] = [];
    const prepend = el.prepend.bind(el);
    el.prepend = (...cs: (FEl | string)[]) => {
      for (const c of cs) if (c instanceof FEl) {
        const id = textOf(c.querySelector('.t-text')!);
        if (ids.includes(id)) seen.push({ at: performance.now(), id, el: c });
      }
      prepend(...cs);
    };
    for (let i = 0; i < Toasts.BUDGET_PER_MIN; i++) news(`Fire ${i}`, 'disaster');
    for (const id of ids) news(id, 'reward', { reward: id });
    let checked = 0;
    for (let s = 0; s < 60; s++) {
      news(`Emergency ${s}`, 'bad');
      vi.advanceTimersByTime(1000);
      // Re-checking the queue in the same instant must not release another capped item.
      news('Another budgeted item', 'good');
      while (checked < seen.length) {
        const shown = seen[checked++];
        expect(textOf(shown.el.querySelector('.t-go')!)).toContain('Place it');
        shown.el.click();
        expect(panels.isOpen('rewards')).toBe(true);
        expect(rows().find((row) => row.classList.contains('reward-highlight'))?.dataset.reward).toBe(shown.id);
      }
    }
    expect(seen.map((shown) => shown.id)).toEqual(ids);
    expect(seen[0].at).toBe(Toasts.QUEUE_MAX_MS);
    for (let i = 1; i < seen.length; i++) expect(seen[i].at - seen[i - 1].at).toBeGreaterThanOrEqual(Toasts.BUDGET_GAP_MS / 2);
  });

  it('keeps the selected row through rebuilds and changes it on a later toast', () => {
    const { news, el, panel, items, rows } = make();
    news('First unlock', 'reward', { reward: 'reward' });
    el.children[0].click();
    items[1].progress = 0.5;
    vi.advanceTimersByTime(4000);
    panel.update();
    expect(rows().find((row) => row.classList.contains('reward-highlight'))?.dataset.reward).toBe('reward');
    news('Second unlock', 'reward', { reward: 'landmark' });
    el.children[0].click();
    expect(rows().filter((row) => row.classList.contains('reward-highlight')).map((row) => row.dataset.reward)).toEqual(['landmark']);
    panel.onClose();
    expect(rows().some((row) => row.classList.contains('reward-highlight'))).toBe(false);
  });

  it('does not infer an action from reward headline text and preserves other news actions', () => {
    const { news, el, panels, toasts } = make();
    news('New landmark available: The landmark!', 'reward');
    expect(el.querySelector('.t-go')).toBeNull();
    el.children[0].click();
    expect(panels.isOpen('rewards')).toBe(false);
    const run = vi.fn();
    toasts.newsAction = (n) => n.ref?.advice ? { hint: 'Zone homes', run } : undefined;
    vi.advanceTimersByTime(4000);
    news('More homes needed!', 'advisor', { advice: 'zoneR' });
    el.children[0].click();
    expect(run).toHaveBeenCalledOnce();
  });

  it('drops a queued Place it action on city exit', () => {
    const { news, el, abort } = make();
    news('Earlier good news', 'good');
    news('A new reward', 'reward', { reward: 'reward' });
    abort.abort();
    vi.advanceTimersByTime(60000);
    expect(el.children.map(textOf).join(' ')).not.toContain('A new reward');
    expect(vi.getTimerCount()).toBe(0);
  });
});
