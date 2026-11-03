/**
 * A layout stand-in for the news ticker on the fake DOM (tests/game/fakeDom.ts), FEEL-01: the view's width and the
 * width of the track's one item, from its date label, its Gazette tag and its text. The numbers are the 1280x720 HUD's,
 * measured in Chromium by tools/qa-ticker.mjs (its "calibration" line).
 */
import type { NewsTicker } from '../../src/ui/Notifications';
import { FEl, textOf } from './fakeDom';

/** the 1280x720 view (css px), and the widths of a 12 px text character, a 10.5 px date character and the tag */
export const VIEW_W = 389;
export const CHAR_W = 6.4;
export const DATE_CHAR_W = 5.6;
export const TAG_W = 58;
/** the view's fades (hud.css .tk-view mask) */
export const FADE_L = 16;
export const FADE_R = 24;

/** where the text of the track's item starts (relative to the track), the track's width, and the text */
export function trackGeometry(track: FEl): { textAt: number; width: number; text: string } {
  const it = track.children[0];
  // the track's padding, the dot, then a 7 px gap before each part
  let at = 14 + 6;
  const d = it?.querySelector('.d');
  if (d) at += 7 + textOf(d).length * DATE_CHAR_W;
  if (it?.querySelector('.tk-tag')) at += 7 + TAG_W;
  at += 7;
  const text = it ? textOf(it.querySelector('.tk-text')!) : '';
  return { textAt: at, width: Math.round(at + text.length * CHAR_W), text };
}

/** give a ticker on the fake DOM this layout (it reads the track's width on each swap: no ResizeObserver in node) */
export function tickerLayout(ticker: NewsTicker) {
  const el = ticker.el as unknown as FEl;
  const view = el.querySelector('.tk-view')!;
  const track = el.querySelector('.tk-track')!;
  let reads = 0;
  view.clientWidth = VIEW_W;
  Object.defineProperty(track, 'scrollWidth', { configurable: true, get: () => (reads++, trackGeometry(track).width) });
  (ticker as unknown as { measure(): void }).measure();
  /** the track's translateX (px) */
  const x = () => {
    const m = /translateX\((-?[\d.]+)px\)/.exec(String(track.style.transform ?? ''));
    return m ? Number(m[1]) : 0;
  };
  /** the item's text in view coordinates */
  const span = () => {
    const g = trackGeometry(track);
    return { from: x() + g.textAt, to: x() + g.width, text: g.text, first20: x() + g.textAt + Math.min(20, g.text.length) * CHAR_W };
  };
  return { el, view, track, x, span, reads: () => reads };
}

/**
 * Watches when items become fully visible: their start in the view's opaque part, and then their end there too (a
 * long item scrolls to show it). Call `frame(t)` after every ticker frame.
 */
export function visibilityWatch(ticker: NewsTicker, layout: ReturnType<typeof tickerLayout>, onlyNew = false) {
  const seen = new Map<object, { head: number; tail: number }>();
  return {
    frame(t: number): void {
      const cur = ticker.current;
      // onlyNew: as a new item only (not when the idle rotation shows it again, after it gave way)
      if (!cur || (onlyNew && !(ticker as unknown as { cur: { fresh: boolean } }).cur.fresh)) return;
      let v = seen.get(cur);
      if (!v) seen.set(cur, (v = { head: Infinity, tail: Infinity }));
      const sp = layout.span();
      if (v.head === Infinity && sp.from >= FADE_L - 0.5 && sp.from <= VIEW_W - FADE_R) v.head = t;
      if (v.head !== Infinity && v.tail === Infinity && sp.to <= VIEW_W - FADE_R + 0.5) v.tail = t;
    },
    /** when the item was fully visible (Infinity: not yet) */
    at(item: object): number {
      const v = seen.get(item);
      return v ? Math.max(v.head, v.tail) : Infinity;
    },
  };
}
