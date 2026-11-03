import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext } from '../../src/game/context';
import type { GameSettings } from '../../src/game/settings';
import { MilestoneCard } from '../../src/ui/MilestoneCard';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom } from './fakeDom';

installFakeDom();
const lifetimes: AbortController[] = [];
const MILESTONES = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 750000, 1000000, 1250000, 1500000];

function setup(opts: { pop?: number; speed?: number; motion?: GameSettings['motion'] } = {}) {
  const state = newState(16), abort = new AbortController();
  lifetimes.push(abort);
  state.config.name = 'Queensbury';
  state.stats.population = opts.pop ?? 0;
  const events = new Emitter<Record<string, unknown>>();
  const host = { events, speed: opts.speed ?? 1, policy: { live: false } };
  const settings = { motion: opts.motion ?? 'full' };
  const ctx = { host, state, settings, signal: abort.signal } as unknown as GameContext;
  const root = new FEl('div'), rankUp = vi.fn();
  const card = new MilestoneCard(ctx, root as unknown as HTMLElement, rankUp);
  const el = root.querySelector('.milestone-card')!;
  const title = () => el.querySelector('.milestone-title')!.textContent;
  const next = () => el.querySelector('.milestone-next')!.textContent;
  const visible = () => el.style.display !== 'none';
  const cross = (pop: number) => {
    state.stats.population = pop;
    events.emit('news', { day: state.day, kind: 'good', text: `Queensbury reaches ${pop.toLocaleString('en-US')} residents!` });
  };
  return { state, abort, events, host, settings, root, card, el, rankUp, title, next, visible, cross };
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => {
  for (const abort of lifetimes.splice(0)) abort.abort();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('milestone card', () => {
  it('shows an accessible population card for four real seconds regardless of simulation time or pause', () => {
    const t = setup();
    t.cross(10000);
    expect(t.title()).toBe('QUEENSBURY · 10,000 RESIDENTS');
    expect(t.el.getAttribute('role')).toBe('status');
    expect(t.el.getAttribute('aria-live')).toBe('polite');
    expect(t.visible()).toBe(true);
    t.state.day += 36000;
    t.host.speed = 0;
    vi.advanceTimersByTime(3999);
    expect(t.visible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(t.visible()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('celebrates all fourteen milestones through 1.5 million residents', () => {
    const t = setup();
    for (const pop of MILESTONES) {
      t.cross(pop);
      expect(t.visible(), String(pop)).toBe(true);
      expect(t.title()).toBe(`QUEENSBURY · ${pop.toLocaleString('en-US')} RESIDENTS`);
      expect(t.next()).toMatch(/^Next: .+/);
      vi.advanceTimersByTime(4000);
      expect(t.visible()).toBe(false);
    }
  });

  it('offers the nearer building stage after reaching ten thousand', () => {
    const t = setup();
    t.cross(10000);
    expect(t.next()).toBe('Next: Taller buildings at 12,000 residents');
  });

  it('falls back to the next rank and keeps a next line at the highest rank', () => {
    const t = setup();
    t.cross(250000);
    expect(t.next()).toBe('Next: Global City at 500,000 residents');
    t.cross(1500000);
    expect(t.next()).toBe('Next: Keep your Megalopolis thriving');
  });

  it('shows at most one card in thirty real seconds at ultra', () => {
    const t = setup({ speed: 3 });
    t.cross(500);
    vi.advanceTimersByTime(4000);
    t.cross(1000);
    expect(t.visible()).toBe(false);
    vi.advanceTimersByTime(25999);
    t.cross(2500);
    expect(t.visible()).toBe(false);
    vi.advanceTimersByTime(1);
    t.cross(5000);
    expect(t.visible()).toBe(true);
    expect(t.title()).toContain('5,000 RESIDENTS');
  });

  it('counts a card shown at one times speed against the ultra budget', () => {
    const t = setup();
    t.cross(500);
    vi.advanceTimersByTime(1000);
    t.host.speed = 3;
    t.cross(1000);
    expect(t.title()).toContain('500 RESIDENTS');
    vi.advanceTimersByTime(29000);
    expect(t.visible()).toBe(false);
    t.cross(2500);
    expect(t.title()).toContain('2,500 RESIDENTS');
    expect(t.visible()).toBe(true);
  });

  it('uses the explicit reduced-motion setting and lets full motion override the system', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const t = setup({ motion: 'reduced' });
    t.cross(500);
    expect(t.el.classList.contains('reduced-motion')).toBe(true);
    t.settings.motion = 'full';
    t.cross(1000);
    expect(t.el.classList.contains('reduced-motion')).toBe(false);
  });

  it('follows the system reduced-motion preference when each new card appears', () => {
    let reduced = false;
    const matchMedia = vi.fn(() => ({ matches: reduced }));
    vi.stubGlobal('matchMedia', matchMedia);
    const t = setup({ motion: 'system' });
    t.cross(500);
    expect(t.el.classList.contains('reduced-motion')).toBe(false);
    reduced = true;
    t.cross(1000);
    expect(t.el.classList.contains('reduced-motion')).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('aborts its timer, removes the card and stops observing city events', () => {
    const t = setup();
    t.cross(1000);
    expect(t.rankUp).toHaveBeenCalledTimes(1);
    t.abort.abort();
    expect(t.root.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    t.cross(5000);
    t.events.emit('reset', undefined);
    expect(t.root.children).toHaveLength(0);
    expect(t.rankUp).toHaveBeenCalledTimes(1);
    t.card.dispose();
  });

  it('loads an established city silently and reset hides a card while accepting the loaded population', () => {
    const t = setup({ pop: 300000 });
    for (const pop of MILESTONES.filter((m) => m <= 250000)) {
      t.events.emit('news', { day: 1, kind: 'good', text: `Queensbury reaches ${pop.toLocaleString('en-US')} residents!` });
    }
    expect(t.visible()).toBe(false);
    expect(t.rankUp).not.toHaveBeenCalled();
    t.cross(500000);
    expect(t.visible()).toBe(true);
    t.state.stats.population = 750000;
    t.events.emit('reset', undefined);
    expect(t.visible()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    t.cross(750000);
    expect(t.visible()).toBe(false);
    t.cross(1000000);
    expect(t.visible()).toBe(true);
  });

  it('does not repeat an already reached milestone when a city is reopened', () => {
    const first = setup();
    first.cross(10000);
    first.abort.abort();
    const reopened = setup({ pop: first.state.stats.population });
    reopened.cross(10000);
    expect(reopened.visible()).toBe(false);
    expect(reopened.rankUp).not.toHaveBeenCalled();
    reopened.cross(25000);
    expect(reopened.visible()).toBe(true);
    expect(reopened.rankUp).toHaveBeenCalledTimes(1);
  });

  it('calls the rank hook only on new ranks with their tier intensity', () => {
    const t = setup();
    t.cross(500);
    t.cross(1000);
    t.cross(2500);
    t.cross(5000);
    t.cross(10000);
    t.cross(10000);
    expect(t.rankUp.mock.calls.map(([rank]) => rank.id)).toEqual(['village', 'town', 'small_city']);
    expect(t.rankUp.mock.calls.map(([, intensity]) => intensity)).toEqual([1 / 11, 2 / 11, 3 / 11]);
  });

  it('skips rank bursts during LIVE and resumes them for later ranks', () => {
    const t = setup();
    t.host.policy.live = true;
    t.cross(1000);
    expect(t.visible()).toBe(true);
    expect(t.rankUp).not.toHaveBeenCalled();
    t.host.policy.live = false;
    t.cross(1000);
    expect(t.rankUp).not.toHaveBeenCalled();
    t.cross(5000);
    expect(t.rankUp.mock.calls.map(([rank]) => rank.id)).toEqual(['town']);
  });

  it('does not replay an earlier rank when a recovering city reaches a non-rank milestone', () => {
    const t = setup({ pop: 400000 });
    t.cross(1250000);
    expect(t.visible()).toBe(true);
    expect(t.rankUp).not.toHaveBeenCalled();
    t.cross(1500000);
    expect(t.rankUp.mock.calls.map(([rank]) => rank.id)).toEqual(['megalopolis']);
  });

  it('ignores ordinary good news, stage news, reward news and other kinds', () => {
    const t = setup();
    for (const news of [
      { kind: 'good', text: 'A new park opens downtown.' },
      { kind: 'good', text: 'Towers can now grow at 35,000 residents.' },
      { kind: 'good', text: 'Queensbury reaches 3,000 residents!' },
      { kind: 'reward', text: 'Queensbury reaches 10,000 residents!' },
      { kind: 'warning', text: 'Queensbury reaches 10,000 residents!' },
      { kind: 'info', text: 'Queensbury reaches 10,000 residents!' },
    ]) t.events.emit('news', { day: 1, ...news });
    expect(t.visible()).toBe(false);
    expect(t.rankUp).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    t.cross(10000);
    expect(t.visible()).toBe(true);
  });
});
