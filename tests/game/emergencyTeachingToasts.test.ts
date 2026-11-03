/** FH-08's one-shot lessons share FEEL-02a's queue and wait for the whole New Year show. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/core/events';
import type { GameContext } from '../../src/game/context';
import type { CityEvents } from '../../src/sim/Simulation';
import { Toasts } from '../../src/ui/Notifications';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
const proto = FEl.prototype as unknown as Record<string, unknown>;
beforeAll(() => {
  Object.defineProperty(proto, 'isConnected', { configurable: true, get(this: FEl) { let e: FEl | null = this; while (e?.parentNode) e = e.parentNode; return !!(e as unknown as { stack?: boolean })?.stack; } });
  proto.animate = () => undefined;
});
afterAll(() => {
  delete proto.isConnected;
  delete proto.animate;
});
const lifetimes: AbortController[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('window', globalThis);
});
afterEach(() => {
  for (const abort of lifetimes.splice(0)) abort.abort();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function make() {
  const root = new FEl('div');
  (root as unknown as { stack: boolean }).stack = true;
  const abort = new AbortController();
  lifetimes.push(abort);
  const ctx = { signal: abort.signal, sim: { events: new Emitter<CityEvents>() }, settings: { toasts: true }, mods: {}, root, sound() {}, focusCell() {} } as unknown as GameContext;
  const toasts = new Toasts(ctx, root as unknown as HTMLElement);
  const el = toasts.el as unknown as FEl;
  const seen: string[] = [];
  const prepend = el.prepend.bind(el);
  el.prepend = (...cs: (FEl | string)[]) => {
    for (const c of cs) if (c instanceof FEl && !el.children.includes(c)) seen.push(textOf(c.querySelector('.t-text')!));
    prepend(...cs);
  };
  const clock = { busy: true };
  const teach = (text: string, onShow = vi.fn()) => {
    toasts.show(text, 'info', undefined, 'Emergency', {
      budget: true, action: { hint: 'Open Emergencies', run() {} },
      deferWhile: () => clock.busy, onShow, teaching: true,
    });
    return onShow;
  };
  return { toasts, el, seen, clock, teach, abort };
}

describe('FH-08 teaching toasts in the shared queue', () => {
  it.each([
    'LIVE: the game slowed down so you can follow the truck.',
    'The nearest free fire truck needed 6.3 min; this fire burned out in 5 min.',
  ])('waits beyond the queue deadline for the show to end: %s', (text) => {
    const t = make();
    const onShow = t.teach(text);
    vi.advanceTimersByTime(70000);
    expect(t.seen).toEqual([]);
    expect(onShow).not.toHaveBeenCalled();
    t.clock.busy = false;
    vi.advanceTimersByTime(100);
    expect(t.seen).toEqual([text]);
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(t.el.children[0].classList.contains('emg-teaching-toast')).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('keeps a budget-delayed lesson queued if a New Year starts before it can appear', () => {
    const t = make();
    t.clock.busy = false;
    t.toasts.show('City news', 'good', undefined, undefined, { budget: true });
    vi.advanceTimersByTime(1000);
    const onShow = t.teach('LIVE: follow the truck.');
    vi.advanceTimersByTime(1000);
    t.clock.busy = true;
    vi.advanceTimersByTime(60000);
    expect(t.seen).toEqual(['City news']);
    expect(onShow).not.toHaveBeenCalled();
    t.clock.busy = false;
    vi.advanceTimersByTime(100);
    expect(t.seen).toEqual(['City news', 'LIVE: follow the truck.']);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('allows ordinary news and queued actions past a lesson that is waiting for the show', () => {
    const t = make();
    const lessonShown = t.teach('LIVE: follow the truck.');
    t.toasts.show('City news', 'good', undefined, undefined, { budget: true });
    t.toasts.show('Zone more homes', 'advisor', undefined, undefined, { budget: true, action: { hint: 'Zone homes', run() {} } });
    expect(t.seen).toEqual(['City news']);
    vi.advanceTimersByTime(4000);
    expect(t.seen).toEqual(['City news', 'Zone more homes']);
    expect(lessonShown).not.toHaveBeenCalled();
    t.clock.busy = false;
    vi.advanceTimersByTime(4000);
    expect(t.seen).toEqual(['City news', 'Zone more homes', 'LIVE: follow the truck.']);
    expect(lessonShown).toHaveBeenCalledTimes(1);
  });

  it('deduplicates a deferred lesson and calls its display callback only when it appears', () => {
    const t = make();
    const onShow = vi.fn();
    t.teach('LIVE: follow the truck.', onShow);
    t.teach('LIVE: follow the truck.', onShow);
    expect(onShow).not.toHaveBeenCalled();
    t.clock.busy = false;
    vi.advanceTimersByTime(100);
    expect(t.seen).toEqual(['LIVE: follow the truck.']);
    expect(onShow).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('calls a display callback for a visible merge without spending the budget again', () => {
    const t = make();
    t.clock.busy = false;
    t.toasts.show('LIVE: follow the truck.', 'info');
    const onShow = t.teach('LIVE: follow the truck.');
    expect(t.seen).toEqual(['LIVE: follow the truck.']);
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(t.el.children[0].classList.contains('emg-teaching-toast')).toBe(true);
  });

  it('leaving the city cancels deferred lessons, callbacks and their polling timer', () => {
    const t = make();
    const onShow = t.teach('LIVE: follow the truck.');
    t.abort.abort();
    t.clock.busy = false;
    vi.advanceTimersByTime(70000);
    expect(t.seen).toEqual([]);
    expect(onShow).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
