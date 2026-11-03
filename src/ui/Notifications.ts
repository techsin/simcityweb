/** News ticker (bottom-left marquee) and toast notifications (top-right). */
import type { NewsItem } from '../sim/CityState';
import type { GameContext } from '../game/context';
import { escapeHtml, h } from './dom';
import { icon } from './icons';
import { dayLabel } from './format';
import { newsMark, tickerItems } from './newsLog';

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

export class NewsTicker {
  readonly el: HTMLDivElement;
  private track: HTMLDivElement;
  private view: HTMLDivElement;
  private x = 0;
  private hover = false;
  /** the news sequence at the last rebuild; newsMark also detects a cleared / replaced log */
  private shownMark = -1;
  private shownNews = -1;
  private width = 0;
  /** the view's width, measured on rebuilds and resizes only (A1: frame() read clientWidth every frame) */
  private viewW = 0;
  /** reports the track's and the view's sizes after layout: a rebuild then reads no layout (it forced one, of whatever
   *  the frame had changed so far, on every news item) */
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
    // the view's width changes with the window (and the UI zoom) only, the track's with its items: measure them when
    // they change (after layout), not every frame nor on every rebuild
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
    this.rebuild();
  }

  /** the track must be rebuilt: a news item was added (also to a full log), or the log was cleared / replaced */
  private stale(): boolean {
    const news = this.ctx.state.news;
    return this.ctx.host.newsSeq !== this.shownNews || newsMark(news) !== this.shownMark;
  }

  private rebuild(): void {
    const st = this.ctx.state;
    const items = tickerItems(st.news);
    this.shownNews = this.ctx.host.newsSeq;
    this.shownMark = newsMark(st.news);
    this.track.innerHTML = '';
    if (!items.length) {
      const welcome: NewsItem[] = [
        { day: st.day, text: `Welcome to ${st.config.name}! Zone some land and connect it with roads to get started.`, kind: 'info' },
        { day: st.day, text: 'Tip: residents need power — build a power plant and connect it with power lines.', kind: 'advisor' },
      ];
      items.push(...welcome);
    }
    for (const n of items) {
      const el = h('span', { class: `tk-item ${n.kind}` }, h('span', { class: 'tk-dot' }), h('span', { class: 'd' }, dayLabel(n.day, st.config.startYear)), h('span', { html: escapeHtml(n.text) }));
      if (n.x !== undefined && n.z !== undefined) {
        el.dataset.x = String(n.x);
        el.dataset.z = String(n.z);
        el.style.cursor = 'pointer';
      }
      this.track.appendChild(el);
    }
    // (without a ResizeObserver: one layout read per rebuild)
    if (!this.ro) this.measure();
  }

  /** the track's and the view's widths (a ResizeObserver calls this after layout: no forced layout then) */
  private measure(): void {
    this.width = this.track.scrollWidth;
    this.viewW = this.view.clientWidth;
  }

  frame(dt: number): void {
    if (this.stale()) this.rebuild();
    const vw = this.viewW;
    if (this.width <= vw - 20) {
      this.x = 0;
      this.track.style.transform = 'translateX(0)';
      return;
    }
    if (!this.hover) this.x -= dt * 38;
    if (this.x < -this.width) this.x = vw;
    this.track.style.transform = `translateX(${this.x.toFixed(1)}px)`;
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
   * action waits in a queue and shows when the budget allows (at the latest QUEUE_MAX_MS after it arrived); one without
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
  /** a queued toast (one with an action) shows at the latest this long after it arrived, whatever the budget */
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
    ctx.sim.events.on('news', (n) => {
      if (!ctx.settings.toasts) return;
      if (n.kind === 'info') return;
      if (n.kind === 'advisor' && !/!|urgent|critical|warning/i.test(n.text)) return;
      const action = this.newsAction?.(n);
      // silent: GameSounds plays the (rate-limited) news sound even when toasts are off. FEEL-02a: bad news and disasters
      // always show; every other kind shares the budget
      this.show(n.text, n.kind, n.x !== undefined && n.z !== undefined ? { x: n.x, z: n.z } : undefined, n.advisor, {
        silent: true, budget: n.kind !== 'bad' && n.kind !== 'disaster', ...(action ? { action } : {}),
      });
    });
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

  /** the oldest eligible toast goes first; a deferred lesson never holds up ordinary news */
  private drain(): void {
    const now = performance.now();
    while (this.queue.length) {
      const i = this.queue.findIndex((q) => !q.opts.deferWhile?.());
      if (i < 0) break;
      const q = this.queue[i];
      if (q.opts.budget && !this.allows(now) && now - q.at < Toasts.QUEUE_MAX_MS) break;
      this.queue.splice(i, 1);
      this.show(q.text, q.kind, q.cell, q.title, { ...q.opts, budget: false });
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
      at = Math.min(at, q.opts.budget ? Math.min(this.nextAllowed(now), q.at + Toasts.QUEUE_MAX_MS) : now);
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
      live.badge.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
      if (cell) live.cell = cell;
      live.restart(ttl);
      if (this.el.firstElementChild !== live.el) this.el.prepend(live.el);
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
    this.el.prepend(t);
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
