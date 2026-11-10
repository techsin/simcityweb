/** News ticker (bottom-left marquee) and toast notifications (top-right). */
import type { NewsItem } from '../sim/CityState';
import type { GameContext } from '../game/context';
import { resolveMotion } from '../game/settings';
import { escapeHtml, h } from './dom';
import { icon } from './icons';
import { dayLabel } from './format';
import { newsMark, tickerItems } from './newsLog';
import type { RewardsPanel } from './panels/ListPanels';

export const NEWS_META: Record<string, { color: string; icon: string; title: string }> = {
  info: { color: 'var(--accent)', icon: 'news', title: 'News' },
  good: { color: 'var(--good)', icon: 'check', title: 'Good news' },
  bad: { color: 'var(--bad)', icon: 'alert', title: 'Problem' },
  warning: { color: 'var(--warn)', icon: 'alert', title: 'Warning' },
  disaster: { color: 'var(--bad)', icon: 'fire', title: 'Disaster' },
  reward: { color: '#e7b04a', icon: 'trophy', title: 'Reward unlocked' },
  advisor: { color: '#b58cff', icon: 'advisors', title: 'Advisor' },
  error: { color: 'var(--bad)', icon: 'alert', title: '' },
  saved: { color: 'var(--good)', icon: 'save', title: '' },
  music: { color: '#b58cff', icon: 'music', title: 'Now playing' },
};

/** toast kind -> sound (UI-originated toasts; sim news sounds come from src/game/GameSounds.ts) */
const TOAST_SOUND: Record<string, string | null> = {
  info: 'notify', good: 'good', bad: 'bad', warning: 'warning', disaster: 'alarm', reward: 'reward', advisor: 'advisor', error: 'error', saved: null, music: null,
};

/** an item the ticker shows: a news item, or one the UI pushes (FEEL-22's resident quotes, `NewsTicker.push`) */
export interface TickerItem {
  text: string;
  kind: string;
  /** absolute day (the date label); none for an undated item */
  day?: number;
  /** a click focuses this cell */
  x?: number;
  z?: number;
  advisor?: string;
}

/** FEEL-01: the ticker shows at most this many characters of an item's first clause (then an ellipsis) */
export const TICKER_CLAUSE_MAX = 90;
/** a ". " after one of these is not a sentence end */
const NOT_A_STOP = /(?:^|[\s(])(?:e\.g|i\.e|vs|St|Dr|Mr|Mrs|Ms|No)$/;

/**
 * FEEL-01: the one clause the ticker shows: the text up to its first " — " or its first sentence end (". "), at most
 * `max` characters (cut at a word, plus "…"). The tooltip and the news feed keep the full text.
 */
export function tickerClause(text: string, max = TICKER_CLAUSE_MAX): string {
  const t = text.trim();
  let cut = t.length;
  const dash = t.indexOf(' — ');
  if (dash > 0) cut = dash;
  for (const m of t.matchAll(/\.\s/g)) {
    if (m.index >= cut) break;
    if (m.index > 0 && !NOT_A_STOP.test(t.slice(0, m.index))) {
      cut = m.index + 1;
      break;
    }
  }
  let c = t.slice(0, cut).trimEnd();
  if (c.length > max) {
    const sp = c.lastIndexOf(' ', max);
    c = c.slice(0, sp >= max * 0.6 ? sp : max).replace(/[\s,;:—–-]+$/u, '') + '…';
  }
  return c;
}

/** a flavour headline (advisors.ts posts them as 'info' news from the 'news' desk): the ticker labels it "Gazette" */
export function isGazette(n: TickerItem): boolean {
  return n.kind === 'info' && n.advisor === 'news';
}

/**
 * News the ticker may let go when it falls behind (NewsTicker.STALE_S): the kinds that show elsewhere too (advisor tips
 * and warnings in the Advisors panel; bad news and disasters as toasts that always show, and in the emergency banner).
 * Flavour headlines (the ticker is the only place that shows them), good news and rewards always wait their turn
 */
export function tickerRoutine(n: TickerItem): boolean {
  return !isGazette(n) && n.kind !== 'good' && n.kind !== 'reward';
}

/** an item waiting to show: from the news log, or pushed (a pushed one survives a replaced log) */
interface TickerQueued {
  item: TickerItem;
  news: boolean;
  /** the ticker's clock when it arrived (s) */
  at: number;
}

/** what the ticker shows now */
interface TickerShown {
  item: TickerItem;
  el: HTMLElement;
  /** seconds it has shown (hover pauses it) */
  t: number;
  /** how long it holds when it fits: HOLD_S, or BURST_S for a queued one after another new item */
  slot: number;
  /** a new item (it arrived or was pushed); the others come from the idle rotation */
  fresh: boolean;
}

/**
 * The news ticker (FEEL-01): one item at a time, the newest first.
 * - A new item enters from the right at once (a short ease-out slide; a rotation item gives way). It holds HOLD_S if it
 *   fits; otherwise it rests LEAD_S, scrolls through once at SCROLL_PX_S until its end is in view, and rests TAIL_S.
 * - Bursts queue: HOLD_S for the first, then BURST_S each (a long item's rests halve). At most QUEUE_MAX wait; past that
 *   the oldest waiting one gives way, and so does routine news (`tickerRoutine`) that waited STALE_S with more behind
 *   it. Everything stays in the news feed.
 * - Idle, it rotates through the newest 8 items (`tickerItems`), newest first, skipping each one it just showed as new.
 * - Each item is one clause (`tickerClause`) and its tooltip has the full text. Flavour headlines carry a "Gazette" label.
 * - Hover pauses all of it. Its clock is real time (CityScene clamps the frame dt at 0.1 s; a slow frame must not slow
 *   the holds down).
 * - Widths (PB-PANELS, A1): a ResizeObserver reports the track's and the view's after layout. A frame reads no layout,
 *   and writes the transform only when it changes.
 */
export class NewsTicker {
  /** seconds a new item (and a rotation item) that fits holds */
  static HOLD_S = 5;
  /** seconds each queued item of a burst holds after the first */
  static BURST_S = 3;
  /** seconds an item takes to enter from the right, and how far right of its place it starts (css px; at most the
   *  view's width). Not from beyond the view's edge: its first frame would show an empty ticker, for a whole second on
   *  a slow machine */
  static ENTER_S = 0.5;
  static ENTER_PX = 120;
  /** a long item rests this long at its start before it scrolls, and this long at its end (half that in a burst) */
  static LEAD_S = 1;
  static TAIL_S = 1;
  /** the scroll speed of an item longer than the view */
  static SCROLL_PX_S = 60;
  /** new items waiting, at most */
  static QUEUE_MAX = 8;
  /** a routine item (`tickerRoutine`) that has waited this long gives way to the items behind it: a busy city at 2x
   *  posts more news than one line can show, and the headlines must not wait behind it */
  static STALE_S = 6;
  /** the view's right fade (hud.css `.tk-view` mask): an item fits when it ends before it */
  static FADE_R = 24;
  /** the longest real-time step one frame takes (a hidden tab resumes where it was) */
  static MAX_STEP_S = 1;
  readonly el: HTMLDivElement;
  private track: HTMLDivElement;
  private view: HTMLDivElement;
  private hover = false;
  /** the news sequence at the last sync; newsMark also detects a cleared / replaced log */
  private shownMark = -1;
  private shownNews = -1;
  /** the newest news item at the last sync: the new items are the ones after it */
  private lastSeen: NewsItem | null = null;
  /** the idle rotation: the newest items, newest first (the welcome items for an empty log) */
  private list: TickerItem[] = [];
  private rot = 0;
  /** items shown as new: the rotation skips each one once */
  private recent = new WeakSet<TickerItem>();
  private queue: TickerQueued[] = [];
  private cur: TickerShown | null = null;
  /** the track's width (its one item, with the padding), reported after layout */
  private width = 0;
  /** the view's width, reported on resizes only (A1: frame() read clientWidth every frame) */
  private viewW = 0;
  /** the transform written last (px) */
  private x = NaN;
  private lastNow = -1;
  /** the ticker's clock (s, real time; hover pauses it) */
  private clock = 0;
  /** reports the track's and the view's sizes after layout: a swap then reads no layout either */
  private ro: ResizeObserver | null = null;

  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.track = h('div', { class: 'tk-track' });
    this.view = h('div', { class: 'tk-view' }, this.track);
    this.el = h('div', { class: 'ticker mp-glass', title: 'City news — click for all news' }, h('div', { class: 'tk-badge', html: icon('news', 14) + '<span>News</span>' }), this.view);
    this.el.addEventListener('pointerenter', () => (this.hover = true), { signal: this.ctx.signal });
    this.el.addEventListener('pointerleave', () => (this.hover = false), { signal: this.ctx.signal });
    this.el.addEventListener('click', (e) => {
      const it = (e.target as HTMLElement).closest('.tk-item') as HTMLElement | null;
      if (it && it.dataset.x) {
        ctx.focusCell(Number(it.dataset.x), Number(it.dataset.z));
        return;
      }
      ctx.panels.open('advisors');
      (ctx.panels as any).get?.('advisors')?.showTab?.('news');
    }, { signal: this.ctx.signal });
    parent.appendChild(this.el);
    // the view's width changes with the window (and the UI zoom) only, the track's with its item: measure them when
    // they change (after layout), not every frame nor on every swap
    if (typeof ResizeObserver !== 'undefined') {
      const ro = (this.ro = new ResizeObserver(() => this.measure()));
      ro.observe(this.view);
      ro.observe(this.track);
      ctx.signal?.addEventListener('abort', () => ro.disconnect(), { once: true });
    } else if (typeof window !== 'undefined') {
      const onResize = () => (this.viewW = this.view.clientWidth);
      window.addEventListener('resize', onResize, { signal: this.ctx.signal });
      ctx.signal?.addEventListener('abort', () => window.removeEventListener('resize', onResize), { once: true });
    }
    // the log the city starts with is old news: the rotation shows it, newest first
    this.sync(true);
    this.next(false);
    this.place();
  }

  /** FEEL-22: show a UI-made item next, after the news that came before it. It is not in the news log, so it shows
   *  once; a click on it focuses its x, z */
  push(item: TickerItem): void {
    if (this.stale()) this.sync();
    this.enqueue(item, false);
  }

  /** the item showing now (tests, tools) */
  get current(): TickerItem | null {
    return this.cur?.item ?? null;
  }

  /** the number of new items waiting (tests, tools) */
  get waiting(): number {
    return this.queue.length;
  }

  private enqueue(item: TickerItem, news: boolean): void {
    const q = this.queue;
    q.push({ item, news, at: this.clock });
    // full: the oldest routine news item gives way, else the oldest
    while (q.length > NewsTicker.QUEUE_MAX) {
      const k = q.findIndex((e) => e.news && tickerRoutine(e.item));
      q.splice(Math.max(0, k), 1);
    }
  }

  /** the news log changed: a news item was added (also to a full log), or the log was cleared / replaced */
  private stale(): boolean {
    return this.ctx.host.newsSeq !== this.shownNews || newsMark(this.ctx.state.news) !== this.shownMark;
  }

  /**
   * Queue the log's new items, the oldest first (past QUEUE_MAX the oldest give way). A replaced log (a load, another
   * city; for an empty one, more items than the queue holds) or a revision without a new item (W0.5: the sequence alone
   * invalidates) start over at the newest item instead. `init`: the ticker is new and the log is old news.
   */
  private sync(init = false): void {
    const st = this.ctx.state;
    const news = st.news;
    this.shownNews = this.ctx.host.newsSeq;
    this.shownMark = newsMark(news);
    let fresh: NewsItem[] = [];
    if (!this.lastSeen) fresh = news.length <= NewsTicker.QUEUE_MAX ? news.slice() : [];
    else {
      const at = news.lastIndexOf(this.lastSeen);
      if (at >= 0) fresh = news.slice(at + 1);
    }
    this.lastSeen = news[news.length - 1] ?? null;
    const list: TickerItem[] = tickerItems(news);
    if (!list.length) {
      list.push(
        { day: st.day, text: `Welcome to ${st.config.name}! Zone some land and connect it with roads to get started.`, kind: 'info' },
        { day: st.day, text: 'Tip: roads and power lines carry electricity from your plant to your zones.', kind: 'advisor' },
      );
    }
    this.list = list;
    this.rot = 0;
    if (init) return;
    if (fresh.length) {
      for (const n of fresh) this.enqueue(n, true);
      return;
    }
    // start over at the newest item; the news that waited belonged to the old log (pushed items stay)
    this.queue = this.queue.filter((q) => !q.news);
    this.recent = new WeakSet();
    this.cur = null;
  }

  /** show the next item: a waiting new one, else the rotation's next. `afterFresh`: a new item has just had its time,
   *  so a queued one holds BURST_S */
  private next(afterFresh: boolean): void {
    // routine news that waited STALE_S gives way to the items behind it (it stays in the news feed)
    while (this.queue.length > 1 && this.queue[0].news && tickerRoutine(this.queue[0].item) && this.clock - this.queue[0].at >= NewsTicker.STALE_S) this.queue.shift();
    const q = this.queue.shift();
    if (q) {
      if (q.news) this.recent.add(q.item);
      this.show(q.item, true, afterFresh ? NewsTicker.BURST_S : NewsTicker.HOLD_S);
      return;
    }
    // the rotation's next item: each one just shown as new is skipped once, and the one showing now does not follow
    // itself (unless it is the only one)
    const list = this.list;
    let item: TickerItem | null = null;
    for (let k = 0; k < 2 * list.length && !item; k++) {
      const it = list[this.rot];
      this.rot = (this.rot + 1) % list.length;
      if (this.recent.has(it)) this.recent.delete(it);
      else if (it !== this.cur?.item || list.length === 1) item = it;
    }
    this.show(item ?? list[0], false, NewsTicker.HOLD_S);
  }

  private show(item: TickerItem, fresh: boolean, slot: number): void {
    const c = this.cur;
    if (c && c.item === item) {
      // the same item again (a rotation of one): it stays, and its time starts over at rest
      c.t = NewsTicker.ENTER_S;
      c.slot = slot;
      c.fresh = fresh;
      return;
    }
    const el = this.render(item);
    this.track.innerHTML = '';
    this.track.appendChild(el);
    this.cur = { item, el, t: 0, slot, fresh };
    // (without a ResizeObserver: one layout read per swap)
    if (!this.ro) this.measure();
  }

  private render(n: TickerItem): HTMLElement {
    const gazette = isGazette(n);
    const el = h('span', { class: `tk-item ${n.kind}${gazette ? ' gazette' : ''}`, title: n.text },
      h('span', { class: 'tk-dot' }),
      n.day !== undefined ? this.date(n.day) : null,
      gazette ? h('span', { class: 'tk-tag' }, 'Gazette') : null,
      h('span', { class: 'tk-text' }, tickerClause(n.text)),
    );
    if (n.x !== undefined && n.z !== undefined) {
      el.dataset.x = String(n.x);
      el.dataset.z = String(n.z);
      el.style.cursor = 'pointer';
    }
    return el;
  }

  /** the date label: the month and day ("Mar 4"), the full date in its tooltip (the year takes room the clause needs) */
  private date(day: number): HTMLElement {
    const full = dayLabel(day, this.ctx.state.config.startYear);
    return h('span', { class: 'd', title: full }, full.replace(/, \d+$/, ''));
  }

  /** the track's and the view's widths (a ResizeObserver calls this after layout: no forced layout then) */
  private measure(): void {
    this.width = this.track.scrollWidth;
    this.viewW = this.view.clientWidth;
  }

  /** how far the item runs past the view's opaque part (px); <= 0: it fits (also while nothing is measured) */
  private overflow(): number {
    return this.viewW > 0 ? this.width - (this.viewW - NewsTicker.FADE_R) : 0;
  }

  /** a long item's rests: LEAD_S and TAIL_S, halved for a queued item of a burst */
  private rest(c: TickerShown): number {
    return c.slot < NewsTicker.HOLD_S ? 0.5 : 1;
  }

  /** how long the item shows: its slot, or for a long item the time to enter, rest, scroll through once and rest */
  private duration(c: TickerShown): number {
    if (resolveMotion(this.ctx.settings?.motion ?? 'system') === 'reduced') return c.slot;
    const S = NewsTicker;
    const over = this.overflow();
    const k = this.rest(c);
    return over > 0 ? Math.max(c.slot, S.ENTER_S + k * S.LEAD_S + over / S.SCROLL_PX_S + k * S.TAIL_S) : c.slot;
  }

  /** where the item is now: entering from the right, at rest, or scrolling (ease-out entry; translateX only) */
  private place(): void {
    const c = this.cur;
    if (!c) return;
    const S = NewsTicker;
    let x = 0;
    if (resolveMotion(this.ctx.settings?.motion ?? 'system') === 'reduced') {
      // FEEL-21: items still rotate, with their full text in the tooltip, but never slide or scroll.
      x = 0;
    } else if (c.t < S.ENTER_S) {
      const k = 1 - c.t / S.ENTER_S;
      x = Math.min(this.viewW, S.ENTER_PX) * k * k * k;
    } else {
      const over = this.overflow();
      if (over > 0) x = -Math.min(over, Math.max(0, c.t - S.ENTER_S - this.rest(c) * S.LEAD_S) * S.SCROLL_PX_S);
    }
    x = Math.round(x * 10) / 10 || 0;
    if (x !== this.x) {
      this.x = x;
      this.track.style.transform = `translateX(${x}px)`;
    }
  }

  frame(dt: number): void {
    // real time (dt is clamped by the scene), at most MAX_STEP_S a frame; a caller's larger dt wins (tests, tools)
    const now = performance.now();
    const real = this.lastNow < 0 ? 0 : Math.min(NewsTicker.MAX_STEP_S, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    const step = Math.max(dt, real);
    if (this.stale()) this.sync();
    const c = this.cur;
    if (!c) this.next(false);
    else if (!this.hover) {
      this.clock += step;
      c.t += step;
      // a new item: a rotation item gives way at once; a new one first has its time
      if (this.queue.length && !c.fresh) this.next(false);
      else if (c.t >= this.duration(c)) this.next(c.fresh);
    }
    this.place();
  }
}

/** an answer button on a question toast (Toasts.show opts.buttons) */
export interface ToastButton {
  label: string;
  primary?: boolean;
  run: () => void;
}

/** a click action on a toast (Toasts.show opts.action) */
export interface ToastAction {
  hint: string;
  icon?: string;
  run: () => void;
}

export interface ToastOptions {
  silent?: boolean;
  ttl?: number;
  action?: ToastAction;
  buttons?: ToastButton[];
  /** FH-08: wait in the shared queue while a New Year show is busy, even past QUEUE_MAX_MS. */
  deferWhile?: () => boolean;
  /** called when the toast actually appears (including a merge), never when it only enters the queue */
  onShow?: () => void;
  /** checked when a deferred or budgeted toast can appear; obsolete lessons do not consume their one-shot */
  isRelevant?: () => boolean;
  /** called instead of onShow when isRelevant rejects a toast at display time */
  onDrop?: () => void;
  /** its existing toast hides with the teaching cards if a New Year starts while it is still visible */
  teaching?: boolean;
  /**
   * FEEL-02a: the toast is news that shares the budget (Toasts.BUDGET_GAP_MS, BUDGET_PER_MIN). Over budget, one with an
   * action waits in a queue and shows when the budget allows (or in spaced releases after QUEUE_MAX_MS); one without
   * is dropped: it is still in the ticker and the news feed
   */
  budget?: boolean;
}

/** a toast that waits for the budget (it carries an action), or for a deferral to end */
interface QueuedToast {
  text: string;
  kind: string;
  cell?: { x: number; z: number };
  title?: string;
  opts: ToastOptions;
  key: string;
  at: number;
}

export class Toasts {
  /** multiplier for toast lifetimes (dev/screenshot tooling raises it) */
  static ttlScale = 1;
  /** identical messages within this window are merged (×N counter) */
  static DEDUP_MS = 20000;
  /**
   * the same message (numbers ignored) sounds at most once per this long - GameSounds' REPEAT_MS for sim news: a toast
   * that keeps coming back (a demand cap flickering around its threshold) shows again but doesn't re-chime. Errors
   * (feedback for the player's own click) always sound.
   */
  static REPEAT_MS = 180000;
  static MAX = 4;
  /**
   * FEEL-02a's toast budget for news (advisor, warning, good and reward news, and the demand-cap warning): a budgeted
   * toast shows only BUDGET_GAP_MS after the last toast and while fewer than BUDGET_PER_MIN showed in the last minute.
   * Every new toast counts (a merge into a live one does not); bad news, disasters, errors, the player's own feedback and
   * the yearly New Year toast are never budgeted, so they always show
   */
  static BUDGET_GAP_MS = 4000;
  static BUDGET_PER_MIN = 8;
  /** a queued toast (one with an action) becomes eligible for a spaced release this long after it arrived */
  static QUEUE_MAX_MS = 50000;
  readonly el: HTMLDivElement;
  /**
   * the action for a news toast, looked up by its NewsItem.ref (FH-03's "Zone homes", FEEL-06's "Place it"; set by the
   * lane that adds the action map). A news toast with an action is queued over budget instead of dropped
   */
  newsAction: ((n: NewsItem) => ToastAction | undefined) | null = null;
  /** performance.now() of every toast shown in the last minute (the budget's window), oldest first */
  private shownAt: number[] = [];
  /** budgeted toasts with an action that wait for the budget, oldest first */
  private queue: QueuedToast[] = [];
  private queueTimer = 0;
  private lastCappedAt = -Infinity;
  /** performance.now() a message signature last sounded */
  private sounded = new Map<string, number>();
  private live = new Map<string, { el: HTMLElement; count: number; at: number; badge: HTMLElement; cell?: { x: number; z: number }; restart: (ms: number) => void }>();
  /** close-out c4: the toasts' pending timers, cleared with the city: an expiry timer's callback holds this component and
   *  through ctx the scene, so an exit with a toast up (a dispatch's) kept the whole city alive until it fired (1-3 s) */
  private timers = new Set<number>();
  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.el = h('div', { class: 'toasts' });
    parent.appendChild(this.el);
    ctx.signal?.addEventListener('abort', () => {
      for (const t of this.timers) clearTimeout(t);
      this.timers.clear();
      this.live.clear();
      this.queue.length = 0;
    }, { once: true });
    const off = ctx.sim.events.on('news', (n) => {
      if (!ctx.settings.toasts) return;
      if (n.kind === 'info') return;
      if (n.kind === 'advisor' && !/!|urgent|critical|warning/i.test(n.text)) return;
      const reward = n.ref?.reward;
      const action = reward ? {
        hint: 'Place it', icon: 'plus', run: () => {
          const panels = ctx.panels as typeof ctx.panels & { get?: (id: string) => Pick<RewardsPanel, 'showReward'> | undefined };
          panels.open('rewards');
          panels.get?.('rewards')?.showReward(reward);
        },
      } : this.newsAction?.(n);
      // silent: GameSounds plays the (rate-limited) news sound even when toasts are off. FEEL-02a: bad news and disasters
      // always show; every other kind shares the budget
      this.show(n.text, n.kind, n.x !== undefined && n.z !== undefined ? { x: n.x, z: n.z } : undefined, n.advisor, {
        silent: true, budget: n.kind !== 'bad' && n.kind !== 'disaster', ...(action ? { action } : {}),
      });
    });
    ctx.signal?.addEventListener('abort', off, { once: true });
  }

  /** the budget allows a toast now: BUDGET_GAP_MS since the last toast and fewer than BUDGET_PER_MIN in the last minute */
  private allows(now: number): boolean {
    const a = this.shownAt;
    while (a.length && now - a[0] >= 60000) a.shift();
    return a.length < Toasts.BUDGET_PER_MIN && (!a.length || now - a[a.length - 1] >= Toasts.BUDGET_GAP_MS);
  }

  /** when the budget next allows a toast (performance.now ms) */
  private nextAllowed(now: number): number {
    const a = this.shownAt;
    let t = a.length ? a[a.length - 1] + Toasts.BUDGET_GAP_MS : now;
    if (a.length >= Toasts.BUDGET_PER_MIN) t = Math.max(t, a[a.length - Toasts.BUDGET_PER_MIN] + 60000);
    return t;
  }

  /**
   * the oldest eligible toast goes first (a deferred lesson never holds up ordinary news); capped releases bypass the
   * budget, at most one per half budget gap
   */
  private drain(): void {
    const now = performance.now();
    while (this.queue.length) {
      const i = this.queue.findIndex((q) => !q.opts.deferWhile?.());
      if (i < 0) break;
      const q = this.queue[i];
      const allowed = !q.opts.budget || this.allows(now);
      if (!allowed && (now - q.at < Toasts.QUEUE_MAX_MS || now - this.lastCappedAt < Toasts.BUDGET_GAP_MS / 2)) break;
      this.queue.splice(i, 1);
      this.show(q.text, q.kind, q.cell, q.title, { ...q.opts, budget: false });
      if (!allowed) {
        this.lastCappedAt = now;
        break;
      }
    }
    this.schedule(now);
  }

  /** wake up when the oldest eligible toast may show; poll a show-bound lesson until the show ends */
  private schedule(now: number): void {
    clearTimeout(this.queueTimer);
    this.timers.delete(this.queueTimer);
    this.queueTimer = 0;
    if (!this.queue.length || this.ctx.signal?.aborted) return;
    let at = Infinity;
    for (const q of this.queue) {
      if (q.opts.deferWhile?.()) { at = Math.min(at, now + 100); continue; }
      const capAt = Math.max(q.at + Toasts.QUEUE_MAX_MS, this.lastCappedAt + Toasts.BUDGET_GAP_MS / 2);
      at = Math.min(at, q.opts.budget ? Math.min(this.nextAllowed(now), capAt) : now);
      break;
    }
    this.queueTimer = this.arm(() => {
      this.queueTimer = 0;
      this.drain();
    }, Math.max(16, at - now));
  }

  /** a timer kept in this.timers until it fires: the city's abort clears the pending ones */
  private arm(f: () => void, ms: number): number {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      f();
    }, ms);
    this.timers.add(id);
    return id;
  }

  /** keep shown questions in place: new and promoted toasts go below them */
  private insertToast(t: HTMLElement): void {
    if (!this.el.firstElementChild?.classList.contains('question')) {
      this.el.prepend(t);
      return;
    }
    if (t.classList.contains('question') && t.parentElement === this.el) return;
    const next = Array.from(this.el.children).find((c) => !c.classList.contains('question')) ?? null;
    if (next !== t) this.el.insertBefore(t, next);
  }

  /**
   * show a toast; plays the kind's sound (TOAST_SOUND) unless opts.silent or it merges into an identical live toast.
   * opts.action: a click runs it (instead of jumping to `cell`), with a small hint line under the text.
   * opts.buttons: a question with answers (FH-21's slow-frame prompt): each button runs its answer and closes the toast;
   * a click elsewhere on the toast does nothing. Without its own opts.ttl it stays until answered or closed.
   */
  show(text: string, kind = 'info', cell?: { x: number; z: number }, title?: string, opts: ToastOptions = {}): void {
    const now = performance.now();
    const key = kind + ':' + text;
    const meta = NEWS_META[kind] ?? NEWS_META.info;
    const ttl = (opts.ttl ?? (kind === 'error' ? 2600 : kind === 'disaster' ? 12000 : kind === 'music' ? 4200 : 7000)) * Toasts.ttlScale;
    const deferred = !!opts.deferWhile?.();
    // identical message within the de-dup window: bump the counter on the existing toast instead of stacking
    const live = this.live.get(key);
    if (!deferred && live && live.el.isConnected && now - live.at < Toasts.DEDUP_MS) {
      if (opts.isRelevant?.() === false) { opts.onDrop?.(); return; }
      live.count++;
      live.at = now;
      live.badge.textContent = `×${live.count}`;
      live.badge.style.display = '';
      if (resolveMotion(this.ctx.settings.motion) !== 'reduced') live.badge.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
      if (cell) live.cell = cell;
      live.restart(ttl);
      if (this.el.firstElementChild !== live.el) this.insertToast(live.el);
      if (opts.teaching) live.el.classList.add('emg-teaching-toast');
      opts.onShow?.();
      return;
    }
    // FEEL-02a: over budget, news with an action waits (the queue goes first), other news stays in the ticker only
    if (deferred || (opts.budget && (this.queue.some((q) => !q.opts.deferWhile?.()) || !this.allows(now)))) {
      if ((deferred || opts.action) && !this.queue.some((q) => q.key === key)) {
        this.queue.push({ text, kind, cell, title, opts, key, at: now });
        this.drain();
      } else if (this.queue.length) this.drain();
      return;
    }
    if (opts.isRelevant?.() === false) { opts.onDrop?.(); return; }
    this.shownAt.push(now);
    // no toast sound when the action that raised it just played its own (error buzz, reward fanfare...)
    const recent = (this.ctx.mods.audio as { sinceLastPlay?: () => number } | undefined)?.sinceLastPlay?.() ?? 1e9;
    // (a null TOAST_SOUND entry means silent - `??` would have turned it into 'notify')
    let snd = opts.silent || recent < 150 ? null : kind in TOAST_SOUND ? TOAST_SOUND[kind] : 'notify';
    if (snd && kind !== 'error') {
      const sig = kind + ':' + text.replace(/[\d.,]+/g, '#').slice(0, 90);
      if (now - (this.sounded.get(sig) ?? -1e9) < Toasts.REPEAT_MS) snd = null;
      else {
        if (this.sounded.size > 64) for (const [k, t] of this.sounded) if (now - t >= Toasts.REPEAT_MS) this.sounded.delete(k);
        this.sounded.set(sig, now);
      }
    }
    if (snd) this.ctx.sound(snd);
    const x = h('button', { class: 'icon-btn t-x', html: icon('close', 12) });
    const badge = h('span', { class: 't-count', style: 'display:none' });
    const timerBar = h('div', { class: 't-timer', style: { animationDuration: ttl + 'ms' } });
    const answers = opts.buttons?.length ? opts.buttons.map((b) => h('button', { class: `btn t-btn${b.primary ? ' primary' : ''}`, type: 'button' }, b.label)) : null;
    // a question without its own ttl stays until it is answered or closed (on a machine at a few seconds a frame a timed
    // question would expire before it could be read)
    const sticky = !!answers && opts.ttl === undefined;
    if (sticky) timerBar.style.display = 'none';
    const t = h('div', { class: 'toast mp-glass', style: { '--tc': meta.color } as Record<string, string> },
      h('div', { class: 't-ico', html: icon(meta.icon, 16) }),
      h('div', { class: 't-body' },
        h('div', { class: 't-title' }, title ?? meta.title, badge),
        h('div', { class: 't-text' }, text),
        opts.action ? h('div', { class: 't-go', html: icon(opts.action.icon ?? 'target', 12) + escapeHtml(opts.action.hint) }) : cell ? h('div', { class: 't-go', html: icon('target', 12) + 'Click to view' }) : null,
        answers ? h('div', { class: 't-btns' }, ...answers) : null,
      ),
      x,
      timerBar,
    );
    let timer = 0;
    // (every timer is kept in this.timers until it fires: the city's abort clears the pending ones)
    const arm = (f: () => void, ms: number): number => this.arm(f, ms);
    const entry = {
      el: t, count: 1, at: now, badge, cell,
      restart: (ms: number) => {
        clearTimeout(timer);
        this.timers.delete(timer);
        if (sticky) return;
        timer = arm(kill, ms);
        timerBar.style.animation = 'none';
        void timerBar.offsetWidth;
        timerBar.style.animation = '';
        timerBar.style.animationDuration = ms + 'ms';
      },
    };
    const kill = () => {
      clearTimeout(timer);
      this.timers.delete(timer);
      if (this.live.get(key) === entry) this.live.delete(key);
      t.classList.add('out');
      arm(() => t.remove(), 300);
    };
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      kill();
    }, { signal: this.ctx.signal });
    answers?.forEach((el, k) => el.addEventListener('click', (e) => {
      e.stopPropagation();
      kill();
      opts.buttons![k].run();
    }, { signal: this.ctx.signal }));
    t.addEventListener('click', () => {
      if (answers) return;
      if (opts.action) opts.action.run();
      else if (entry.cell) this.ctx.focusCell(entry.cell.x, entry.cell.z, 420);
      kill();
    }, { signal: this.ctx.signal });
    if (!sticky) timer = arm(kill, ttl);
    this.live.set(key, entry);
    if (answers) t.classList.add('question');
    if (opts.teaching) t.classList.add('emg-teaching-toast');
    this.insertToast(t);
    // at most 4 visible (3 on short screens, e.g. 1280×720: CityScene sets .short on the UI root); the oldest goes first,
    // but a question waits for its answer (or its own expiry): news must not push it out before it can be read
    const max = this.ctx.root.classList.contains('short') ? Math.min(3, Toasts.MAX) : Toasts.MAX;
    while (this.el.children.length > max) {
      const kids = this.el.children;
      let last: HTMLElement | null = null;
      for (let k = kids.length - 1; k >= 0 && !last; k--) if (!kids[k].classList.contains('question')) last = kids[k] as HTMLElement;
      if (!last) break;
      for (const [k, v] of this.live) if (v.el === last) this.live.delete(k);
      last.remove();
    }
    opts.onShow?.();
  }
}
