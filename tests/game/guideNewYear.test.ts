/** E11 extends the existing New Year toast; profile memory never creates a second toast. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import { Overlay } from '../../src/core/types';
import type { GameContext, UIEvents } from '../../src/game/context';
import { NewYearCelebration } from '../../src/game/NewYear';
import { DEFAULT_SETTINGS } from '../../src/game/settings';
import { Toasts } from '../../src/ui/Notifications';
import { Onboarding } from '../../src/ui/Onboarding';
import { guideCopy } from '../../src/ui/guide/copy';
import { loadGuideProfile } from '../../src/ui/guide/progress';
import { setGuideTips } from '../../src/ui/guide/tips';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState, place } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const lifetimes: { abort: AbortController; host: LocalSimHost; ny: NewYearCelebration }[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('window', globalThis);
  const prefs = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => prefs.get(key) ?? null, setItem: (key: string, value: string) => prefs.set(key, value) });
});
afterEach(async () => {
  for (const f of lifetimes.splice(0)) { f.ny.dispose(); f.abort.abort(); await f.host.dispose(); }
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

function city(speed = 1) {
  const st = newState(64), abort = new AbortController();
  st.day = 90; st.systemData.foundedDay = 90; st.stats.population = 10;
  place(st, 't_r1', 10, 10, { pop: 10 });
  const host = new LocalSimHost(st, { initialSpeed: speed, signal: abort.signal });
  const root = new FEl('div'), settings = { ...DEFAULT_SETTINGS, newYear: 'fireworks' as const };
  const ctx = { host, state: host.state, sim: host.sim, signal: abort.signal, root, canvas: new FEl('canvas'), settings,
    ui: new Emitter<UIEvents>(), mods: {}, overlay: Overlay.None, tools: { activeId: null, select() {} },
    panels: { open() {} }, world: { setHighlight() {} }, sound() {}, toast() {},
  } as unknown as GameContext;
  const guide = new Onboarding(ctx, root as unknown as HTMLElement, { coach() {}, celebrating: () => false });
  const toasts = new Toasts(ctx, root as unknown as HTMLElement), show = vi.spyOn(toasts, 'show');
  const ny = new NewYearCelebration({ sim: host.sim, signal: abort.signal, settings: () => settings,
    world: () => ctx.world, objects: () => ({} as GameContext['objects']),
    toast: (text, kind, cell, title, opts) => toasts.show(text, kind, cell, title, opts),
    yearFeedback: (text) => guide.yearFeedback(text),
  });
  lifetimes.push({ abort, host, ny });
  const year = (n: number) => {
    st.day = (n - st.config.startYear) * 360 - 1; ny.frame(0);
    st.day++; host.events.emit('year', n);
  };
  const texts = () => (toasts.el as unknown as FEl).children.map((el) => textOf(el.querySelector('.t-text')!));
  return { st, host, guide, toasts, show, ny, year, texts, settings };
}

describe('E11 year-end feedback', () => {
  it('appends once to the shared yearly toast and remembers it across cities', () => {
    const first = city(); first.year(first.st.config.startYear + 1);
    expect(first.show).toHaveBeenCalledTimes(1);
    expect(first.texts()).toHaveLength(1);
    expect(first.texts()[0]).toContain(guideCopy.phaseD.E11());
    expect(loadGuideProfile().seenExplainers).toContain('E11');
    first.guide.setMinimised(true);
    expect(loadGuideProfile().seenExplainers).toContain('E11');
    const second = city(); second.year(second.st.config.startYear + 1);
    expect(second.show).toHaveBeenCalledTimes(1);
    expect(second.texts()[0]).not.toContain(guideCopy.phaseD.E11());
  });

  it('does not consume the tip while tips or toast feedback are disabled', () => {
    setGuideTips(false);
    const f = city(); f.year(f.st.config.startYear + 1);
    expect(f.texts()[0]).not.toContain(guideCopy.phaseD.E11());
    expect(loadGuideProfile().seenExplainers).not.toContain('E11');
    setGuideTips(true); f.settings.toasts = false; f.year(f.st.config.startYear + 2);
    expect(f.show).toHaveBeenCalledTimes(1);
    expect(loadGuideProfile().seenExplainers).not.toContain('E11');
    f.settings.toasts = true; f.year(f.st.config.startYear + 3);
    expect(f.show).toHaveBeenCalledTimes(2);
    expect(f.texts()[0]).toContain(guideCopy.phaseD.E11());
  });

  it('adds the line to a compact ultra toast without changing its silence or lifetime', () => {
    const f = city(3); f.ny.pacer.noteFull(performance.now());
    f.year(f.st.config.startYear + 1);
    expect(f.show).toHaveBeenCalledTimes(1);
    expect(f.show.mock.calls[0][3]).toBe('New Year');
    expect(f.show.mock.calls[0][4]).toMatchObject({ silent: true, ttl: 4500 });
    expect(f.texts()[0]).toContain(guideCopy.phaseD.E11());
  });
});
