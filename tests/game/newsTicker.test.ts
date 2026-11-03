/**
 * FEEL-01 (POLISH_PLAN, T060): the news ticker shows the newest headline first, as one readable clause.
 * - A new item enters from the right at once; it holds 5 s if it fits, otherwise it scrolls through once at 60 px/s.
 * - Bursts queue: 5 s for the first, then 3 s each.
 * - One clause (at most 90 characters, split at " — " or ". "); the tooltip has the full text.
 * - Flavour headlines carry a "Gazette" label; hover pauses the ticker; the welcome tip is right; `ticker.push(item)`.
 *
 * The layout is tests/game/tickerLayout.ts's stand-in for the 1280x720 HUD (measured by tools/qa-ticker.mjs, which also
 * checks the real layout in the browser).
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import type { NewsItem } from '../../src/sim/CityState';
import { NewsTicker, TICKER_CLAUSE_MAX, isGazette, tickerClause, tickerRoutine } from '../../src/ui/Notifications';
import { LocalSimHost } from '../../src/worker/SimHost';
import { newState } from '../infra/cityGen';
import { FEl, installFakeDom, textOf } from './fakeDom';
import { FADE_L, FADE_R, VIEW_W, tickerLayout, trackGeometry as geometry, visibilityWatch } from './tickerLayout';

installFakeDom();

const hosts: LocalSimHost[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const h of hosts.splice(0)) await h.dispose();
});

function make() {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const abort = new AbortController();
  const host = new LocalSimHost(newState(16), { signal: abort.signal });
  hosts.push(host);
  const focusCell = vi.fn();
  const open = vi.fn();
  const ctx = { host, get state() { return host.state; }, sim: host.sim, signal: abort.signal, focusCell, panels: { open } } as unknown as GameContext;
  const parent = new FEl('div');
  const ticker = new NewsTicker(ctx, parent as unknown as HTMLElement);
  // the layout: the view's width, the track's from its item (read on each swap: no ResizeObserver here)
  const { el, view, track, x, span, reads } = tickerLayout(ticker);
  /** run `s` seconds of frames at `fps`, calling `each` after every frame */
  const run = (s: number, fps = 60, each?: (t: number) => void) => {
    const n = Math.round(s * fps);
    for (let k = 0; k < n; k++) {
      now += 1000 / fps;
      ticker.frame(Math.min(0.1, 1 / fps));
      each?.(now / 1000);
    }
  };
  const notify = (text: string, kind: NewsItem['kind'] = 'info', advisor?: string) => host.sim.notify(text, kind, undefined, undefined, advisor);
  return { ticker, host, el, view, track, run, notify, span, x, focusCell, open, reads, now: () => now / 1000 };
}

/** run frames until `pred` holds (at most `maxS` seconds); true when it did */
function until(t: ReturnType<typeof make>, pred: () => boolean, maxS = 30): boolean {
  for (let k = 0; k < maxS * 60; k++) {
    if (pred()) return true;
    t.run(1 / 60);
  }
  return pred();
}

/** the first 20 characters of the current item are inside the view's opaque part */
function first20In(s: { from: number; first20: number }): boolean {
  return s.from >= FADE_L - 0.5 && s.first20 <= VIEW_W - FADE_R + 0.5;
}

/** seconds until the current item is `text` and its first 20 characters are in view (Infinity past `max`) */
function timeToFirst20(t: ReturnType<typeof make>, text: string, max = 5, fps = 60): number {
  const t0 = t.now();
  let at = Infinity;
  t.run(max, fps, (s) => {
    if (at === Infinity && t.ticker.current?.text === text && first20In(t.span())) at = s - t0;
  });
  return at;
}

const LONG = 'Commuters praise the new crosstown avenue as average trips fall to eighteen minutes across town';

describe('FEEL-01 acceptance: within 1 s of a notify the first 20 characters are inside .tk-view', () => {
  it('from the idle rotation, from a long rotation item mid-scroll, and right after a new item\'s hold', () => {
    const t = make();
    t.run(7);
    // idle: the welcome rotation
    expect(t.ticker.current?.kind).toBeDefined();
    t.notify('Water main repaired on Elm Street after a long night of work.', 'good');
    expect(timeToFirst20(t, 'Water main repaired on Elm Street after a long night of work.')).toBeLessThanOrEqual(1);
    // a long item, then the rotation shows it again; a new item arrives while it scrolls
    t.run(5);
    t.notify(LONG, 'good');
    expect(timeToFirst20(t, LONG)).toBeLessThanOrEqual(1);
    t.run(12);
    t.notify('Second report.', 'info');
    t.notify(LONG + '!', 'info');
    t.run(30);
    // (the rotation: Second report., then the LONG items; wait for one to scroll)
    let guard = 0;
    while (!(t.ticker.current?.text.startsWith(LONG) && t.x() < -10) && guard++ < 3000) t.run(1 / 60);
    expect(t.x()).toBeLessThan(-10);
    t.notify('Power plant output steady after the evening peak.');
    expect(timeToFirst20(t, 'Power plant output steady after the evening peak.')).toBeLessThanOrEqual(1);
    // right after a new item's hold (5 s): the rotation's turn, and then a new item
    t.run(5.2);
    t.notify('Recycling center reaches a record month.', 'good');
    expect(timeToFirst20(t, 'Recycling center reaches a record month.')).toBeLessThanOrEqual(1);
  });

  it('on a slow machine too: the ticker runs on real time, not on the scene\'s clamped frame dt', () => {
    const t = make();
    t.notify('Old news.');
    t.run(6, 4);
    t.notify('Library extends its opening hours on weekends.', 'good');
    // 4 frames a second, each passing dt = 0.1 (CityScene clamps it) for 250 ms of real time
    expect(timeToFirst20(t, 'Library extends its opening hours on weekends.', 1, 4)).toBeLessThanOrEqual(1);
    // and it holds 5 real seconds, not 12.5
    const t0 = t.now() - 1;
    let end = Infinity;
    t.run(14, 4, (s) => {
      if (end === Infinity && t.ticker.current?.text !== 'Library extends its opening hours on weekends.') end = s - t0;
    });
    expect(end).toBeGreaterThan(4.7);
    expect(end).toBeLessThan(5.6);
  });
});

describe('FEEL-01 acceptance: a 200-character item shows at most 91 characters, plus a tooltip with the full text', () => {
  it('the ticker item and its tooltip', () => {
    const t = make();
    const text = ('The regional transit authority has approved a sweeping plan that would connect every neighbourhood of the city '
      + 'with frequent buses and new light rail lines over the coming years, pending a final vote of the council').slice(0, 200);
    expect(text).toHaveLength(200);
    t.notify(text);
    t.run(1);
    const item = t.track.children[0];
    const shown = textOf(item.querySelector('.tk-text')!);
    expect(shown.length).toBeLessThanOrEqual(91);
    expect(shown.endsWith('…')).toBe(true);
    expect(item.getAttribute('title')).toBe(text);
  });

  it('tickerClause: the first clause (" — " or ". "), at most 90 characters cut at a word, short texts unchanged', () => {
    expect(tickerClause('Mayor Avery spotted jogging at dawn — citizens impressed.')).toBe('Mayor Avery spotted jogging at dawn');
    expect(tickerClause('The city is BANKRUPT. The council demands immediate action (taxes, cuts, loans).')).toBe('The city is BANKRUPT.');
    expect(tickerClause('Power shortage: demand 120 MW exceeds supply 80 MW. Brownouts in outlying areas.')).toBe('Power shortage: demand 120 MW exceeds supply 80 MW.');
    expect(tickerClause('Riverton reaches 5,000 residents!')).toBe('Riverton reaches 5,000 residents!');
    // a decimal point and an abbreviation are no sentence end
    expect(tickerClause('Taxes rise 1.5 points on Main St. after the vote. Shops complain.')).toBe('Taxes rise 1.5 points on Main St. after the vote.');
    expect(tickerClause('  Trailing spaces.  ')).toBe('Trailing spaces.');
    const long = 'word '.repeat(60).trim();
    const c = tickerClause(long);
    expect(c.length).toBeLessThanOrEqual(TICKER_CLAUSE_MAX + 1);
    expect(c).toMatch(/word…$/);
    // one unbroken run: cut at 90 characters
    expect(tickerClause('x'.repeat(200))).toBe('x'.repeat(90) + '…');
    // every flavour headline and every news text of the sim fits in one clause of at most 91 characters
    for (const h of HEADLINES) expect(tickerClause(h).length).toBeLessThanOrEqual(91);
  });
});

// the real flavour headlines (advisors.ts HEADLINES), filled as fillHeadline does for a long town name
const advisorsSrc = readFileSync(new URL('../../src/sim/economy/advisors.ts', import.meta.url), 'utf8');
const HEADLINES = [...advisorsSrc.slice(advisorsSrc.indexOf('const HEADLINES'), advisorsSrc.indexOf('const HEADLINE_BY_ID')).matchAll(/text: '((?:[^'\\]|\\.)*)'/g)]
  .map((m) => m[1].replace(/\\'/g, "'").replaceAll('{city}', 'Port Ashbury Heights').replaceAll('{mayor}', 'Alexandra Montgomery')
    .replaceAll('{year}', '2034').replaceAll('{pop}', '4,812'));

describe('FEEL-01 acceptance: each of 10 consecutive headlines is fully visible within 15 s of arriving', () => {
  it('reads the real headlines', () => {
    expect(HEADLINES.length).toBeGreaterThan(60);
  });

  /**
   * Feed a schedule of [seconds, text, kind, advisor] into the ticker (60 frames a second) and return, for each item,
   * the seconds from its arrival until it was fully visible (its start, then its end, in the view's opaque part)
   */
  function visibleAfter(schedule: [number, string, NewsItem['kind'], string?][]): number[] {
    const t = make();
    t.notify('Older news.');
    t.run(6);
    const watch = visibilityWatch(t.ticker, tickerLayout(t.ticker));
    const items: { n: NewsItem; at: number }[] = [];
    const t0 = t.now();
    let k = 0;
    t.run(schedule[schedule.length - 1][0] + 40, 60, (s) => {
      while (k < schedule.length && s - t0 >= schedule[k][0]) {
        const [, text, kind, adv] = schedule[k++];
        t.notify(text, kind, adv);
        items.push({ n: t.host.state.news[t.host.state.news.length - 1], at: s });
      }
      watch.frame(s);
    });
    return items.filter((i) => isGazette(i.n)).map((i) => watch.at(i.n) - i.at);
  }

  it('the 10 longest flavour headlines, one every 8 s (the sim\'s shortest headline gap at 2×: 40 days × 0.2 s)', () => {
    const longest = [...HEADLINES].sort((a, b) => tickerClause(b).length - tickerClause(a).length).slice(0, 10);
    expect(tickerClause(longest[9]).length).toBeGreaterThan(80);
    const v = visibleAfter(longest.map((h, i) => [i * 8, h, 'info', 'news']));
    expect(v).toHaveLength(10);
    for (const s of v) expect(s).toBeLessThanOrEqual(15);
  });

  it('10 headlines among the other news of a 2× game (headlines 40-100 days apart, other news every 9 s)', () => {
    // the other news: real texts of a 45k city, as often as it came there at 2× (17 items in 160 s besides 10
    // headlines: tests/game/tickerProbe.test.ts on id128_y10 with TICKER_LIST=1)
    const other: [string, NewsItem['kind']][] = [
      ['Industry wants to move in, but your 79 empty industrial lots are odd tiles left between roads. Rezone them in blocks.', 'warning'],
      ['44% of our children have no playground or sports field nearby.', 'advisor'],
      ['Traffic is gridlocked here (245% of the road\'s capacity; 15 road tiles are over capacity).', 'warning'],
      ['Residential demand is strong but there is no room to grow', 'advisor'],
      ['Tourists love Riverton: 3,347 visitors a day, and our attractiveness is 71/100.', 'good'],
      ['Shops and factories would expand, but every worker has a job.', 'advisor'],
    ];
    const schedule: [number, string, NewsItem['kind'], string?][] = [];
    // 2×: 0.2 s a day, a month every 6 s; a fixed sequence of headline gaps (days) between 40 and 100
    const gaps = [40, 73, 55, 98, 41, 62, 87, 44, 70, 51];
    let day = 20;
    gaps.forEach((g, i) => {
      schedule.push([day * 0.2, HEADLINES[(i * 7 + 3) % HEADLINES.length], 'info', 'news']);
      day += g;
    });
    for (let m = 0; m * 9 < day * 0.2; m++) schedule.push([m * 9, ...other[m % other.length]]);
    schedule.sort((a, b) => a[0] - b[0]);
    const v = visibleAfter(schedule);
    expect(v).toHaveLength(10);
    for (const s of v) expect(s).toBeLessThanOrEqual(15);
  });

  it('10 headlines in a busy city at 2× (fires, warnings and tips: more news than one line can show)', () => {
    // modelled on a 250k city with fires at 2× (tests/game/tickerProbe.test.ts on bot256_s7_y60: 65 items in 139 s):
    // 2 tips or warnings each month (6 s), a fire and its outcome every 15 s, headlines 40-100 days apart
    const tips: [string, NewsItem['kind']][] = [
      ['29 city facilities lie in ruins (your 5 Fire Stations, 2 Police Stations, 5 Medical Centers). Rebuild them.', 'warning'],
      ['The city has no Prison: 92% of convicts are released early (+14% crime).', 'warning'],
      ['Fire trucks can\'t reach your Coal Power Plant: no road runs beside it.', 'warning'],
      ['About 1,070 seniors have no clinic or hospital in reach', 'warning'],
      ['Shops and factories would expand, but every worker has a job.', 'advisor'],
      ['Only 13% of our young adults can study here', 'advisor'],
    ];
    const schedule: [number, string, NewsItem['kind'], string?][] = [];
    const gaps = [40, 73, 55, 98, 41, 62, 87, 44, 70, 51];
    let day = 20;
    gaps.forEach((g, i) => {
      schedule.push([day * 0.2, HEADLINES[(i * 11 + 5) % HEADLINES.length], 'info', 'news']);
      day += g;
    });
    const end = day * 0.2;
    for (let m = 0; m * 6 < end; m++) for (const k of [0, 1]) schedule.push([m * 6, ...tips[(2 * m + k) % tips.length]]);
    for (let f = 0; f * 15 + 3 < end; f++) {
      schedule.push([f * 15 + 3, `Fire at Walk-up Apartments ${f}`, 'disaster']);
      schedule.push([f * 15 + 5.5, `The fire at Walk-up Apartments ${f} burned down 1 building.`, 'bad']);
    }
    schedule.sort((a, b) => a[0] - b[0]);
    const v = visibleAfter(schedule);
    expect(v).toHaveLength(10);
    for (const s of v) expect(s).toBeLessThanOrEqual(15);
  });
});

describe('FEEL-01: the timeline', () => {
  it('bursts queue in arrival order: 5 s for the first, then 3 s each; idle, the rotation goes newest first', () => {
    const t = make();
    for (const o of ['Old one.', 'Old two.']) t.notify(o);
    t.run(12);
    const burst = ['Alpha opens.', 'Bravo opens.', 'Charlie opens.', 'Delta opens.'];
    for (const b of burst) t.notify(b, 'good');
    const starts: [string, number][] = [];
    const t0 = t.now();
    t.run(20, 60, (s) => {
      const c = t.ticker.current!.text;
      if (!starts.length || starts[starts.length - 1][0] !== c) starts.push([c, +(s - t0).toFixed(2)]);
    });
    expect(starts.slice(0, 5).map((s) => s[0])).toEqual([...burst, expect.any(String)]);
    // Alpha at once, Bravo after its 5 s, then 3 s each; then the rotation, past the four it just showed
    expect(starts[0][1]).toBeLessThan(0.05);
    expect(starts[1][1]).toBeCloseTo(5, 1);
    expect(starts[2][1]).toBeCloseTo(8, 1);
    expect(starts[3][1]).toBeCloseTo(11, 1);
    expect(starts[4][1]).toBeCloseTo(14, 1);
    // the rotation: newest first, past the four it just showed as new
    expect(starts[4][0]).toBe('Old two.');
    expect(starts[5]).toEqual(['Old one.', expect.closeTo(19, 1)]);
  });

  it('a rotation never shows one item twice in a row, also when every item was just new', () => {
    const t = make();
    t.run(6);
    for (const b of ['One.', 'Two.']) t.notify(b, 'good');
    const seq: [string, number][] = [];
    const t0 = t.now();
    t.run(40, 60, (s) => {
      const c = t.ticker.current!.text;
      if (seq[seq.length - 1]?.[0] !== c) seq.push([c, Math.round(s - t0)]);
    });
    // One 5 s, Two 3 s (the burst), then the rotation: 5 s each, and Two does not hold on past its turn
    expect(seq.slice(0, 6)).toEqual([['One.', 0], ['Two.', 5], ['One.', 8], ['Two.', 13], ['One.', 18], ['Two.', 23]]);
  });

  it('a new item enters from the right; a long one rests, scrolls through once at 60 px/s until its end is in view, and rests', () => {
    const t = make();
    t.notify('Old news.');
    t.run(6);
    t.notify(LONG, 'good');
    t.run(1 / 60);
    // it starts at the view's right edge (just outside) and slides left
    expect(t.x()).toBeGreaterThan(VIEW_W * 0.9);
    t.run(NewsTicker.ENTER_S);
    expect(t.x()).toBe(0);
    const over = geometry(t.track).width - (VIEW_W - FADE_R);
    expect(over).toBeGreaterThan(100);
    // it rests LEAD_S, then 60 px/s
    t.run(NewsTicker.LEAD_S - 0.05);
    expect(t.x()).toBe(0);
    t.run(1.05);
    // (60 px/s: POLISH_PLAN FEEL-01's number)
    expect(t.x()).toBeCloseTo(-60, -0.5);
    // the end comes into view and stays there for TAIL_S; then the item is done (once: it does not loop back)
    t.run(over / NewsTicker.SCROLL_PX_S - 1);
    expect(t.x()).toBeCloseTo(-over, 0);
    expect(t.span().to).toBeLessThanOrEqual(VIEW_W - FADE_R + 0.5);
    t.run(NewsTicker.TAIL_S - 0.2);
    expect(t.ticker.current?.text).toBe(LONG);
    expect(t.x()).toBeCloseTo(-over, 0);
    t.run(0.2);
    expect(t.ticker.current?.text).not.toBe(LONG);
  });

  it('a short item holds 5 s at rest, and the transform is written only while it moves', () => {
    const t = make();
    t.notify('Old news.');
    t.run(6);
    t.notify('Short news.', 'good');
    t.run(NewsTicker.ENTER_S + 0.1);
    expect(t.x()).toBe(0);
    const style = t.track.style as Record<string, unknown>;
    let writes = 0;
    let v = style.transform;
    Object.defineProperty(style, 'transform', { configurable: true, get: () => v, set: (s) => { writes++; v = s; } });
    t.run(4);
    expect(t.ticker.current?.text).toBe('Short news.');
    expect(writes).toBe(0);
    t.run(1);
    expect(t.ticker.current?.text).not.toBe('Short news.');
    expect(writes).toBeGreaterThan(0);
  });

  it('hover pauses the ticker: the item and its place hold, new items wait; leaving resumes', () => {
    const t = make();
    t.run(6);
    t.notify(LONG, 'good');
    t.run(2.5);
    const x0 = t.x();
    expect(x0).toBeLessThan(0);
    t.el.fire('pointerenter');
    t.notify('Arrived while hovered.', 'good');
    t.run(10);
    expect(t.ticker.current?.text).toBe(LONG);
    expect(t.x()).toBe(x0);
    expect(t.ticker.waiting).toBe(1);
    t.el.fire('pointerleave');
    // the long item takes the rest of its time (it had 2.5 s of about 7.6), then the new one
    t.run(4);
    expect(t.ticker.current?.text).toBe(LONG);
    expect(until(t, () => t.ticker.current?.text === 'Arrived while hovered.', 2)).toBe(true);
  });

  it('at most 8 new items wait; past that the oldest waiting give way (they stay in the news feed)', () => {
    const t = make();
    t.notify('Old news.');
    t.run(6);
    for (let k = 0; k < 12; k++) t.notify(`Burst ${k}.`, 'good');
    t.run(1 / 60);
    // 12 new at once: the newest 8 wait, the first of them shows at once
    expect(t.ticker.current?.text).toBe('Burst 4.');
    expect(t.ticker.waiting).toBe(NewsTicker.QUEUE_MAX - 1);
    const seen: string[] = [];
    t.run(30, 60, () => seen[seen.length - 1] !== t.ticker.current!.text && seen.push(t.ticker.current!.text));
    expect(seen.slice(0, 8)).toEqual([4, 5, 6, 7, 8, 9, 10, 11].map((k) => `Burst ${k}.`));
    expect(t.host.state.news.map((n) => n.text)).toContain('Burst 2.');
    // a new city's first news (an empty log before): queued the same way
    const u = make();
    u.run(6);
    for (let k = 0; k < 3; k++) u.notify(`First ${k}.`, 'good');
    u.run(1 / 60);
    expect(u.ticker.current?.text).toBe('First 0.');
    expect(u.ticker.waiting).toBe(2);
  });

  it('routine news that waited STALE_S gives way to the items behind it; headlines, good news and rewards never do', () => {
    const t = make();
    t.notify('Old news.');
    t.run(6);
    // a long warning shows; behind it an advisor tip, then a flavour headline
    t.notify(LONG, 'warning');
    t.run(0.5);
    t.notify('Our children have no playground nearby.', 'advisor');
    t.notify(HEADLINES[1], 'info', 'news');
    const seen: string[] = [];
    t.run(25, 60, () => seen[seen.length - 1] !== t.ticker.current!.text && seen.push(t.ticker.current!.text));
    // the warning holds longer than STALE_S: the tip gives way, the headline follows the warning
    expect(seen.slice(0, 2)).toEqual([LONG, HEADLINES[1]]);
    // (it is still in the log: the rotation shows it later)
    expect(seen).toContain('Our children have no playground nearby.');
    // nothing behind it: a routine item that waited still shows
    const u = make();
    u.notify('Old news.');
    u.run(6);
    u.notify(LONG, 'warning');
    u.run(0.5);
    u.notify('Our children have no playground nearby.', 'advisor');
    expect(until(u, () => u.ticker.current?.text === 'Our children have no playground nearby.', 15)).toBe(true);
    // a headline that waited as long never gives way
    const w = make();
    w.notify('Old news.');
    w.run(6);
    w.notify(LONG, 'warning');
    w.run(0.5);
    w.notify(HEADLINES[2], 'info', 'news');
    w.notify('Riverton reaches 2,000 residents!', 'good');
    const seenW: string[] = [];
    w.run(25, 60, () => seenW[seenW.length - 1] !== w.ticker.current!.text && seenW.push(w.ticker.current!.text));
    expect(seenW.slice(0, 3)).toEqual([LONG, HEADLINES[2], 'Riverton reaches 2,000 residents!']);
    expect(tickerRoutine({ text: 'x', kind: 'info', advisor: 'news' })).toBe(false);
    expect(['good', 'reward'].map((kind) => tickerRoutine({ text: 'x', kind }))).toEqual([false, false]);
    expect(['advisor', 'warning', 'bad', 'disaster', 'info'].map((kind) => tickerRoutine({ text: 'x', kind }))).toEqual([true, true, true, true, true]);
  });

  it('a full queue lets the oldest routine item go first, not a headline', () => {
    const t = make();
    t.notify('Old news.');
    t.run(6);
    t.notify(HEADLINES[3], 'info', 'news');
    for (let k = 0; k < 9; k++) t.notify(`Tip ${k}.`, 'advisor');
    t.run(1 / 60);
    // the headline shows first (it came first); 9 tips: the oldest 2 gave way
    expect(t.ticker.current?.text).toBe(HEADLINES[3]);
    t.run(1 / 60);
    expect(t.ticker.waiting).toBe(NewsTicker.QUEUE_MAX - 1);
    const u = make();
    u.notify('Old news.');
    u.run(6);
    for (let k = 0; k < 4; k++) u.notify(`Tip ${k}.`, 'advisor');
    u.notify(HEADLINES[4], 'info', 'news');
    for (let k = 4; k < 9; k++) u.notify(`Tip ${k}.`, 'advisor');
    u.run(1 / 60);
    // 10 new at once: the two oldest tips gave way, the headline waits
    expect(u.ticker.current?.text).toBe('Tip 2.');
    const seen = new Set<string>();
    u.run(60, 60, () => seen.add(u.ticker.current!.text));
    expect(seen.has(HEADLINES[4])).toBe(true);
  });

  it('a replaced log (a load) starts over at its newest item, without queueing the old news', () => {
    const t = make();
    t.run(6);
    t.notify('Before the load 1.');
    t.notify('Before the load 2.');
    t.run(1 / 60);
    t.host.state.news = Array.from({ length: 30 }, (_, k) => ({ day: k, text: `Loaded ${k}.`, kind: 'info' as const }));
    t.run(1 / 60);
    expect(t.ticker.current?.text).toBe('Loaded 29.');
    expect(t.ticker.waiting).toBe(0);
    t.run(5.1);
    expect(t.ticker.current?.text).toBe('Loaded 28.');
  });
});

describe('FEEL-01: Gazette, the welcome tip, ticker.push', () => {
  it('flavour headlines (info news from the news desk) carry the Gazette label; other news does not', () => {
    const t = make();
    t.run(6);
    t.notify(HEADLINES[0], 'info', 'news');
    t.run(0.1);
    expect(textOf(t.track.children[0].querySelector('.tk-tag')!)).toBe('Gazette');
    expect(t.track.children[0].classList.contains('gazette')).toBe(true);
    t.notify('Riverton reaches 500 residents!', 'good', 'news');
    expect(until(t, () => t.ticker.current?.text === 'Riverton reaches 500 residents!')).toBe(true);
    expect(t.track.children[0].querySelector('.tk-tag')).toBeNull();
    expect(isGazette({ text: 'x', kind: 'info', advisor: 'news' })).toBe(true);
    expect(isGazette({ text: 'x', kind: 'info' })).toBe(false);
    expect(isGazette({ text: 'x', kind: 'advisor', advisor: 'finance' })).toBe(false);
  });

  it('the welcome tip says roads and power lines carry the power (FH-18\'s rule: never "connect it with power lines")', () => {
    const t = make();
    const texts = (t.ticker as unknown as { list: { text: string }[] }).list.map((n) => n.text);
    expect(texts).toContain('Tip: roads and power lines carry electricity from your plant to your zones.');
    for (const s of texts) expect(s).not.toMatch(/connect[^.!?]*with power lines/iu);
    expect(readFileSync(new URL('../../src/ui/Notifications.ts', import.meta.url), 'utf8')).not.toMatch(/connect[^.!?'`]*with power lines/iu);
  });

  it('push(item): shows next after the waiting news, once; a click focuses its cell; it survives a replaced log', () => {
    const t = make();
    t.run(6);
    t.notify('News first.', 'good');
    t.ticker.push({ text: '"If only the bus stopped closer." — the Okafors, Elm Street', kind: 'info', x: 4, z: 7 });
    t.run(1 / 60);
    expect(t.ticker.current?.text).toBe('News first.');
    t.run(5.1);
    expect(t.ticker.current?.text).toContain('If only the bus stopped closer.');
    // one clause (up to the " — ") and no date label for an undated item
    const item = t.track.children[0];
    expect(textOf(item.querySelector('.tk-text')!)).toBe('"If only the bus stopped closer."');
    expect(item.querySelector('.d')).toBeNull();
    // (the listener sits on the ticker; the fake DOM has no closest(), so the event's target brings its own)
    t.el.fire('click', { target: { closest: () => item } });
    expect(t.focusCell).toHaveBeenCalledWith(4, 7);
    // shown once: the rotation is the news log
    expect(until(t, () => !t.ticker.current?.text.includes('If only'))).toBe(true);
    t.run(40, 60, () => expect(t.ticker.current?.text).not.toContain('If only'));
    // a pushed item that waits survives a replaced log
    t.notify('More news.');
    t.ticker.push({ text: 'A pushed quote.', kind: 'info' });
    t.run(1 / 60);
    t.host.state.news = [{ day: 1, text: 'Loaded.', kind: 'info' }];
    t.run(1 / 60);
    expect(t.ticker.current?.text).toBe('A pushed quote.');
  });
});
