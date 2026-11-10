/** T058: arriving news and live-toast merges leave question answers in place in the toast stack. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { Toasts } from '../../src/ui/Notifications';
import { FEl, installFakeDom, textOf } from './fakeDom';

installFakeDom();
// The fake DOM has no layout: check the container, order and answer nodes; real button rects are a browser check.
const proto = FEl.prototype as unknown as Record<string, unknown>;
beforeAll(() => {
  Object.defineProperty(proto, 'isConnected', { configurable: true, get(this: FEl) { let e: FEl | null = this; while (e?.parentNode) e = e.parentNode; return !!(e as unknown as { stack?: boolean })?.stack; } });
  proto.animate = () => undefined;
});
afterAll(() => {
  delete proto.isConnected;
  delete proto.animate;
});
const aborts: AbortController[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('window', globalThis);
});
afterEach(() => {
  for (const abort of aborts.splice(0)) abort.abort();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function make(short = false) {
  const root = new FEl('div');
  (root as unknown as { stack: boolean }).stack = true;
  if (short) root.classList.add('short');
  const abort = new AbortController();
  aborts.push(abort);
  const ctx = { signal: abort.signal, sim: { events: { on: () => () => {} } }, settings: { toasts: true }, mods: {}, root, sound() {}, focusCell() {} } as unknown as GameContext;
  const toasts = new Toasts(ctx, root as unknown as HTMLElement);
  const el = toasts.el as unknown as FEl;
  const texts = () => el.children.map((c) => textOf(c.querySelector('.t-text')!));
  const ask = (text = 'Slow city?', keep = vi.fn()) => {
    toasts.show(text, 'warning', undefined, 'Graphics', { buttons: [{ label: 'Switch', run() {} }, { label: 'Keep', run: keep }] });
    return el.children.find((c) => textOf(c.querySelector('.t-text')!) === text)!;
  };
  return { toasts, el, texts, ask };
}

function staysPut(question: FEl, container: FEl): () => void {
  const index = container.children.indexOf(question), buttons = question.querySelectorAll('.t-btn');
  const parents = buttons.map((b) => b.parentElement);
  expect(question.parentElement).toBe(container);
  return () => {
    expect(question.parentElement).toBe(container);
    expect(container.children.indexOf(question)).toBe(index);
    const current = question.querySelectorAll('.t-btn');
    expect(current).toHaveLength(buttons.length);
    for (let i = 0; i < buttons.length; i++) {
      expect(current[i]).toBe(buttons[i]);
      expect(current[i].parentElement).toBe(parents[i]);
    }
  };
}

describe('Toasts: stable question answers (T058)', () => {
  it.each(['music', 'good'])('new and dedup %s arrivals stay below the question, including between pointerdown and click', (kind) => {
    const { toasts, el, texts, ask } = make();
    toasts.show('Older toast', kind);
    const keep = vi.fn(), question = ask('Slow city?', keep), check = staysPut(question, el);
    const answer = question.querySelectorAll('.t-btn')[1];
    answer.fire('pointerdown');
    toasts.show('New toast', kind);
    check();
    expect(texts()).toEqual(['Slow city?', 'New toast', 'Older toast']);
    toasts.show('Older toast', kind);
    check();
    expect(texts()).toEqual(['Slow city?', 'Older toast', 'New toast']);
    expect(textOf(el.children[1].querySelector('.t-count')!)).toBe('\u00d72');
    toasts.show('Older toast', kind);
    check();
    expect(texts()).toEqual(['Slow city?', 'Older toast', 'New toast']);
    expect(textOf(el.children[1].querySelector('.t-count')!)).toBe('\u00d73');
    answer.click();
    expect(keep).toHaveBeenCalledOnce();
  });

  it('short-stack eviction removes old news while the question and its buttons stay in place', () => {
    const { toasts, el, texts, ask } = make(true);
    const check = staysPut(ask(), el);
    for (let k = 0; k < 6; k++) {
      toasts.show(`News ${k}`, 'good');
      check();
    }
    expect(texts()).toEqual(['Slow city?', 'News 5', 'News 4']);
    expect(el.children).toHaveLength(3);
  });

  it('a queued action toast appears below the question when the budget allows', () => {
    const { toasts, el, texts, ask } = make();
    const check = staysPut(ask(), el), run = vi.fn();
    toasts.show('Zone more homes', 'advisor', undefined, 'Planning', { budget: true, action: { hint: 'Zone homes', run } });
    expect(texts()).toEqual(['Slow city?']);
    vi.advanceTimersByTime(Toasts.BUDGET_GAP_MS);
    check();
    expect(texts()).toEqual(['Slow city?', 'Zone more homes']);
    el.children[1].click();
    expect(run).toHaveBeenCalledOnce();
  });

  it('new questions append after earlier questions and live-question merges preserve their order', () => {
    const { toasts, el, texts, ask } = make();
    const first = ask('First question?'), firstCheck = staysPut(first, el);
    const second = ask('Second question?'), secondCheck = staysPut(second, el);
    firstCheck();
    toasts.show('News', 'good');
    ask('First question?');
    firstCheck();
    secondCheck();
    ask('Second question?');
    firstCheck();
    secondCheck();
    expect(texts()).toEqual(['First question?', 'Second question?', 'News']);
    expect(textOf(first.querySelector('.t-count')!)).toBe('\u00d72');
    expect(textOf(second.querySelector('.t-count')!)).toBe('\u00d72');
  });

  it('without a question, new and dedup toasts keep their newest-first order', () => {
    const { toasts, texts } = make();
    toasts.show('Older toast', 'music');
    toasts.show('New toast', 'music');
    expect(texts()).toEqual(['New toast', 'Older toast']);
    toasts.show('Older toast', 'music');
    expect(texts()).toEqual(['Older toast', 'New toast']);
  });
});
