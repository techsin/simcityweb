import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { EVENT_HEADLINES, SIGHTING_HEADLINES, isEventHeadline, sightingCameraDistance } from '../../src/sim/economy/eventHeadlines';
import { NewsTicker } from '../../src/ui/Notifications';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';
import { tickerLayout } from './tickerLayout';

installFakeDom();
const hosts: LocalSimHost[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const host of hosts.splice(0)) await host.dispose();
});

function make() {
  // the ticker's clock (real time in the game): each frame below is 1/60 s later
  let now = 0;
  const signal = new AbortController().signal;
  const host = new LocalSimHost(newState(16), { signal });
  hosts.push(host);
  const focusCell = vi.fn();
  const ctx = { host, get state() { return host.state; }, signal, focusCell,
    panels: { open: vi.fn() } } as unknown as GameContext;
  const ticker = new NewsTicker(ctx, new FEl('div') as unknown as HTMLElement, () => now);
  const layout = tickerLayout(ticker);
  const run = (seconds: number, seen?: Set<string>) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      now += 1000 / 60;
      ticker.frame();
      if (ticker.current) seen?.add(ticker.current.text);
    }
  };
  return { ticker, host, focusCell, run, ...layout };
}

describe('T074 QA: event bursts and visitor camera framing', () => {
  it('identifies event templates independently of the building name, leaving ordinary and flavour news alone', () => {
    const n = { kind: 'info', advisor: 'news', text: EVENT_HEADLINES.fire.replace('{name}', 'Central Fire Station') };
    expect(isEventHeadline(n)).toBe(true);
    expect(isEventHeadline({ ...n, kind: 'good' })).toBe(false);
    expect(isEventHeadline({ ...n, advisor: 'utilities' })).toBe(false);
    expect(isEventHeadline({ ...n, text: 'City Hall opens in Riverton!' })).toBe(false);
    expect(isEventHeadline({ ...n, text: 'Local ducks demand a larger pond.' })).toBe(false);
  });

  it('lets the oldest event story give way before ordinary good news and rewards in a burst', () => {
    const t = make(), seen = new Set<string>();
    t.run(6);
    t.host.sim.notify('City Hall opens in Riverton!', 'good');
    t.run(1 / 60, seen);
    const ordinary = Array.from({ length: 7 }, (_, i) => `Service ${i} opens in Riverton!`);
    for (const text of ordinary) t.host.sim.notify(text, 'good');
    t.host.sim.notify('A reward is ready to place!', 'reward');
    const stories = Object.values(EVENT_HEADLINES).slice(0, 14).map((text) => text.replace('{name}', 'Central Facility'));
    for (const text of stories) t.host.sim.notify(text, 'info', undefined, undefined, 'news');
    t.run(1 / 60, seen);
    expect(t.ticker.waiting).toBe(NewsTicker.QUEUE_MAX);
    t.run(65, seen);
    for (const text of ['City Hall opens in Riverton!', ...ordinary, 'A reward is ready to place!']) expect(seen.has(text), text).toBe(true);
    expect(t.host.state.news.filter((n) => isEventHeadline(n))).toHaveLength(14);
  });

  it('keeps the newest event stories when event copy alone overfills the queue', () => {
    const t = make();
    t.run(6);
    t.host.sim.notify('City Hall opens in Riverton!', 'good');
    t.run(1 / 60);
    const stories = Object.values(EVENT_HEADLINES).slice(0, 10).map((text) => text.replace('{name}', 'Central Facility'));
    for (const text of stories) t.host.sim.notify(text, 'info', undefined, undefined, 'news');
    t.run(1 / 60);
    const queue = (t.ticker as unknown as { queue: { item: { text: string } }[] }).queue;
    expect(queue.map((q) => q.item.text)).toEqual(stories.slice(2));
  });

  it('passes a useful focus distance for each visitor, preserving the normal headline zoom', () => {
    const distances = { balloons: 700, blimp: 700, whale: 350, observatory: 450, gerald: 150 } as const;
    for (const kind of Object.keys(distances) as (keyof typeof distances)[]) {
      const t = make();
      t.run(6);
      t.host.sim.notify(SIGHTING_HEADLINES[kind], 'info', 4, 7, 'news');
      t.run(1 / 60);
      const item = t.track.children[0];
      t.el.fire('click', { target: { closest: () => item } });
      expect(t.focusCell).toHaveBeenCalledWith(4, 7, distances[kind]);
      expect(sightingCameraDistance(SIGHTING_HEADLINES[kind])).toBe(distances[kind]);
    }
    const t = make();
    t.run(6);
    t.host.sim.notify('A normal located headline.', 'info', 4, 7, 'news');
    t.run(1 / 60);
    t.el.fire('click', { target: { closest: () => t.track.children[0] } });
    expect(t.focusCell).toHaveBeenCalledWith(4, 7);
  });
});
