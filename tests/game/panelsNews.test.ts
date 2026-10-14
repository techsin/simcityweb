/**
 * Final fixes N2 (lane ui-panels): the news ticker froze for good once the news log reached its 200-item cap —
 * CityState.notify keeps the last 200 items, and the ticker rebuilt only when news.length changed (Sunside showed
 * Dec 2017 – Apr 2018 items until 2030). newsMark (src/ui/newsLog.ts) is the identity of the newest item; the ticker and
 * the Advisors & news panel refresh on it. Also A1: the ticker measures its view width on rebuilds / resizes, not on
 * every frame.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { newsMark, tickerItems } from '../../src/ui/newsLog';
import { NewsTicker } from '../../src/ui/Notifications';
import type { GameContext } from '../../src/game/context';

// ------------------------------------------------------------------------------------------------ minimal DOM
class FakeText {
  parentElement: FakeEl | null = null;
  constructor(public text: string) {}
  get textContent(): string {
    return this.text;
  }
}
class FakeEl {
  parentElement: FakeEl | null = null;
  children: (FakeEl | FakeText)[] = [];
  className = '';
  attrs: Record<string, string> = {};
  style: Record<string, string> & { setProperty?: (k: string, v: string) => void } = {};
  dataset: Record<string, string> = {};
  private html = '';
  /** layout stand-ins: the track is wide (it scrolls), the view 600 px; `reads` counts the layout reads */
  private sw = 2400;
  private cw = 600;
  reads = 0;
  get scrollWidth(): number {
    this.reads++;
    return this.sw;
  }
  set scrollWidth(v: number) {
    this.sw = v;
  }
  get clientWidth(): number {
    this.reads++;
    return this.cw;
  }
  set clientWidth(v: number) {
    this.cw = v;
  }
  constructor(readonly tagName: string) {
    this.style.setProperty = (k: string, v: string) => (this.style[k] = v);
  }
  appendChild<T extends FakeEl | FakeText>(c: T): T {
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  append(...cs: (FakeEl | FakeText)[]): void {
    for (const c of cs) this.appendChild(c);
  }
  addEventListener(): void {}
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  set innerHTML(v: string) {
    this.children = [];
    this.html = v;
  }
  get innerHTML(): string {
    return this.html;
  }
  get textContent(): string {
    return this.html.replace(/<[^>]*>/g, '') + this.children.map((c) => c.textContent).join('');
  }
}

let restore: (() => void) | null = null;
beforeAll(() => {
  const g = globalThis as unknown as { document?: unknown };
  const had = g.document;
  g.document = {
    createElement: (t: string) => new FakeEl(t.toUpperCase()),
    createTextNode: (s: string) => new FakeText(s),
  };
  restore = () => (g.document = had);
});
afterAll(() => restore?.());

function city(): CityState {
  return new CityState(defaultCityConfig({ size: 16, seed: 3, terrain: 'flat', disasters: false, treeDensity: 0, waterAmount: 0 }));
}

function ticker(st: CityState): { t: NewsTicker; track: FakeEl } {
  const ctx = { state: st, focusCell: () => {}, panels: { open: () => {} } } as unknown as GameContext;
  const parent = new FakeEl('DIV');
  const t = new NewsTicker(ctx, parent as unknown as HTMLElement);
  const view = (t.el as unknown as FakeEl).children[1] as FakeEl;
  return { t, track: view.children[0] as FakeEl };
}

describe('news log: newsMark / tickerItems', () => {
  it('a new item changes the mark even once the log is full (its length stays at 200)', () => {
    const st = city();
    expect(newsMark(st.news)).toBe(0);
    const marks = new Set<number>();
    for (let k = 0; k < 205; k++) {
      st.day = k;
      st.notify(`Item ${k}`, 'info');
      marks.add(newsMark(st.news));
    }
    expect(st.news.length).toBe(200);
    // one distinct mark per item, also for the five that pushed the oldest out
    expect(marks.size).toBe(205);
    expect(tickerItems(st.news).map((n) => n.text)).toEqual(['Item 204', 'Item 203', 'Item 202', 'Item 201', 'Item 200', 'Item 199', 'Item 198', 'Item 197']);
    // the same log, nothing new: the same mark
    expect(newsMark(st.news)).toBe(newsMark(st.news));
  });
});

describe('news ticker (final fixes N2)', () => {
  it('pushing 205 items: the ticker shows the newest, not the items of when the log filled up', () => {
    const st = city();
    for (let k = 0; k < 200; k++) {
      st.day = k * 30;
      st.notify(`Old news ${k}`, 'info');
    }
    const { t, track } = ticker(st);
    expect(track.textContent).toContain('Old news 199');
    for (let k = 200; k < 205; k++) {
      st.day = k * 30;
      st.notify(`Fresh news ${k}`, 'warning');
      expect(st.news.length).toBe(200);
      t.frame(1 / 60);
    }
    const text = track.textContent;
    expect(text).toContain('Fresh news 204');
    expect(text).toContain('Fresh news 200');
    expect(text).not.toContain('Old news 196');
    // newest first
    expect(text.indexOf('Fresh news 204')).toBeLessThan(text.indexOf('Fresh news 203'));
  });

  it('a log replaced by another city (a load) rebuilds the ticker', () => {
    const st = city();
    st.notify('First city', 'info');
    const { t, track } = ticker(st);
    expect(track.textContent).toContain('First city');
    st.news = [{ day: 1, text: 'Loaded city', kind: 'info' }];
    t.frame(1 / 60);
    expect(track.textContent).toContain('Loaded city');
    expect(track.textContent).not.toContain('First city');
  });
});

describe('news ticker layout reads (final fixes A1)', () => {
  it('no layout read per frame; with a ResizeObserver none per rebuild either: the observer reports the widths', () => {
    const g = globalThis as unknown as { ResizeObserver?: unknown };
    const had = g.ResizeObserver;
    const observers: { cb: () => void; targets: unknown[] }[] = [];
    g.ResizeObserver = class {
      targets: unknown[] = [];
      constructor(public cb: () => void) {
        observers.push(this);
      }
      observe(t: unknown) {
        this.targets.push(t);
      }
      disconnect() {}
    };
    try {
      const st = city();
      st.notify('First', 'info');
      const { t, track } = ticker(st);
      const view = track.parentElement!;
      expect(observers).toHaveLength(1);
      expect(observers[0].targets).toEqual([view, track]);
      // the observer's first report (after the first layout): the widths
      observers[0].cb();
      const reads = () => track.reads + view.reads;
      const r0 = reads();
      for (let k = 0; k < 30; k++) t.frame(1 / 60);
      for (let k = 0; k < 5; k++) {
        st.notify(`News ${k}`, 'info');
        t.frame(1 / 60);
      }
      expect(track.textContent).toContain('News 4');
      // 30 frames + 5 rebuilds: not one layout read
      expect(reads()).toBe(r0);
      // the track scrolls with the reported widths (2400 px track in a 600 px view)
      expect(track.style.transform).toMatch(/^translateX\(-/);
      // a resize report: measured again
      view.clientWidth = 900;
      observers[0].cb();
      expect(reads()).toBe(r0 + 2);
    } finally {
      g.ResizeObserver = had;
    }
  });
  it('without a ResizeObserver: one read per rebuild, none per frame', () => {
    const st = city();
    st.notify('First', 'info');
    const { t, track } = ticker(st);
    const view = track.parentElement!;
    const reads = () => track.reads + view.reads;
    const r0 = reads();
    for (let k = 0; k < 30; k++) t.frame(1 / 60);
    expect(reads()).toBe(r0);
    st.notify('Second', 'info');
    t.frame(1 / 60);
    expect(reads()).toBe(r0 + 2);
  });
});
