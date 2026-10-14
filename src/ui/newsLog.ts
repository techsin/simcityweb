/**
 * The city's news log as the UI watches it (headless, no DOM): what the ticker shows and when a news view must refresh.
 *
 * Final fixes N2: CityState.notify keeps the last 200 items, so once the log is full its length stays at 200 and a view
 * that refreshed on a new length froze for good (the ticker showed Dec 2017 items until 2030). A view compares newsMark()
 * instead: the identity of the newest item (and the length, for a log that was cleared or replaced).
 */
import type { NewsItem } from '../sim/CityState';

/** sequence number of each news item the UI has seen (by identity: items are never edited, only appended / dropped) */
const marks = new WeakMap<object, number>();
let nextMark = 1;

/** a token that changes whenever an item is appended to `news` — also once the log is full and drops its oldest item,
 *  or when the log is replaced (another city, a load); 0 for an empty log */
export function newsMark(news: readonly NewsItem[]): number {
  const last = news[news.length - 1];
  if (!last) return 0;
  let m = marks.get(last);
  if (m === undefined) {
    m = nextMark++;
    marks.set(last, m);
  }
  return m;
}

/** the items the ticker scrolls: the newest `max`, newest first */
export function tickerItems(news: readonly NewsItem[], max = 8): NewsItem[] {
  return news.slice(-max).reverse();
}
