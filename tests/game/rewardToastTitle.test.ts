/**
 * T093 P2 (REVIEW-T093): a reward toast keeps its kind's title, "Reward unlocked". The reward news is filed under an
 * advisor ('planning', 'finance' for a deal), and that advisor was passed as the toast's title, so the toast read
 * "PLANNING". Other news keeps its advisor's title, and the reward toast keeps its "Place it" action.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext } from '../../src/game/context';
import type { NewsItem } from '../../src/sim/CityState';
import type { CityEvents } from '../../src/sim/Simulation';
import { NEWS_META, Toasts } from '../../src/ui/Notifications';
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
  const panels = { open: vi.fn(), get: vi.fn(() => ({ showReward: vi.fn() })) };
  const ctx = { signal: abort.signal, sim: { events }, settings: { toasts: true }, mods: {}, root, panels, sound() {}, focusCell: vi.fn() } as unknown as GameContext;
  const toasts = new Toasts(ctx, root as unknown as HTMLElement);
  const el = toasts.el as unknown as FEl;
  const news = (n: Partial<NewsItem> & Pick<NewsItem, 'text' | 'kind'>) => events.emit('news', { day: 1, ...n });
  /** the newest toast's title and text */
  const top = () => ({ title: textOf(el.children[0].querySelector('.t-title')!), text: textOf(el.children[0].querySelector('.t-text')!) });
  return { el, news, top, abort };
}

describe('T093 P2: the reward toast\'s title', () => {
  it('a reward filed under Planning reads "Reward unlocked", not the advisor', () => {
    const { news, top, abort } = make();
    news({ text: 'The citizens have built you a Mayor\'s House! Place it from Rewards.', kind: 'reward', advisor: 'planning', ref: { reward: 'mayor_house' } });
    expect(top().title).toContain(NEWS_META.reward.title);
    expect(top().title).not.toMatch(/planning/i);
    abort.abort();
  });

  it('a deal filed under Finance reads "Reward unlocked" too, and keeps its Place it action', () => {
    const { el, news, top, abort } = make();
    news({ text: 'Reward unlocked: Casino Resort!', kind: 'reward', advisor: 'finance', ref: { reward: 'casino' } });
    expect(top().title).toContain('Reward unlocked');
    expect(top().title).not.toMatch(/finance/i);
    expect(textOf(el.children[0].querySelector('.t-go')!)).toContain('Place it');
    abort.abort();
  });

  it('other news keeps its advisor as the title', () => {
    const { news, top, abort } = make();
    news({ text: 'Urgent: the budget is in the red!', kind: 'advisor', advisor: 'finance' });
    expect(top().title).toMatch(/finance/i);
    abort.abort();
  });
});
