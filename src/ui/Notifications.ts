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
  /** the news log the track shows: newsMark and length of state.news at the last rebuild (final fixes N2: the log is
   *  capped at 200 items, so its length alone stops changing) */
  private shownMark = -1;
  private shownLen = -1;
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
    return news.length !== this.shownLen || newsMark(news) !== this.shownMark;
  }

  private rebuild(): void {
    const st = this.ctx.state;
    const items = tickerItems(st.news);
    this.shownLen = st.news.length;
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
  readonly el: HTMLDivElement;
  /** performance.now() a message signature last sounded */
  private sounded = new Map<string, number>();
  private live = new Map<string, { el: HTMLElement; count: number; at: number; badge: HTMLElement; cell?: { x: number; z: number }; restart: (ms: number) => void }>();
  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.el = h('div', { class: 'toasts' });
    parent.appendChild(this.el);
    ctx.sim.events.on('news', (n) => {
      if (!ctx.settings.toasts) return;
      if (n.kind === 'info') return;
      if (n.kind === 'advisor' && !/!|urgent|critical|warning/i.test(n.text)) return;
      // silent: GameSounds plays the (rate-limited) news sound even when toasts are off
      this.show(n.text, n.kind, n.x !== undefined && n.z !== undefined ? { x: n.x, z: n.z } : undefined, n.advisor, { silent: true });
    });
  }

  /**
   * show a toast; plays the kind's sound (TOAST_SOUND) unless opts.silent or it merges into an identical live toast.
   * opts.action: a click runs it (instead of jumping to `cell`), with a small hint line under the text.
   */
  show(text: string, kind = 'info', cell?: { x: number; z: number }, title?: string, opts: { silent?: boolean; ttl?: number; action?: { hint: string; icon?: string; run: () => void } } = {}): void {
    const now = performance.now();
    const key = kind + ':' + text;
    const meta = NEWS_META[kind] ?? NEWS_META.info;
    const ttl = (opts.ttl ?? (kind === 'error' ? 2600 : kind === 'disaster' ? 12000 : kind === 'music' ? 4200 : 7000)) * Toasts.ttlScale;
    // identical message within the de-dup window: bump the counter on the existing toast instead of stacking
    const live = this.live.get(key);
    if (live && live.el.isConnected && now - live.at < Toasts.DEDUP_MS) {
      live.count++;
      live.at = now;
      live.badge.textContent = `×${live.count}`;
      live.badge.style.display = '';
      live.badge.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
      if (cell) live.cell = cell;
      live.restart(ttl);
      if (this.el.firstElementChild !== live.el) this.el.prepend(live.el);
      return;
    }
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
    const t = h('div', { class: 'toast mp-glass', style: { '--tc': meta.color } as Record<string, string> },
      h('div', { class: 't-ico', html: icon(meta.icon, 16) }),
      h('div', { class: 't-body' },
        h('div', { class: 't-title' }, title ?? meta.title, badge),
        h('div', { class: 't-text' }, text),
        opts.action ? h('div', { class: 't-go', html: icon(opts.action.icon ?? 'target', 12) + escapeHtml(opts.action.hint) }) : cell ? h('div', { class: 't-go', html: icon('target', 12) + 'Click to view' }) : null,
      ),
      x,
      timerBar,
    );
    let timer = 0;
    const entry = {
      el: t, count: 1, at: now, badge, cell,
      restart: (ms: number) => {
        clearTimeout(timer);
        timer = window.setTimeout(kill, ms);
        timerBar.style.animation = 'none';
        void timerBar.offsetWidth;
        timerBar.style.animation = '';
        timerBar.style.animationDuration = ms + 'ms';
      },
    };
    const kill = () => {
      clearTimeout(timer);
      if (this.live.get(key) === entry) this.live.delete(key);
      t.classList.add('out');
      setTimeout(() => t.remove(), 300);
    };
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      kill();
    }, { signal: this.ctx.signal });
    t.addEventListener('click', () => {
      if (opts.action) opts.action.run();
      else if (entry.cell) this.ctx.focusCell(entry.cell.x, entry.cell.z, 420);
      kill();
    }, { signal: this.ctx.signal });
    timer = window.setTimeout(kill, ttl);
    this.live.set(key, entry);
    this.el.prepend(t);
    // at most 4 visible (3 on short screens, e.g. 1280×720: CityScene sets .short on the UI root)
    const max = this.ctx.root.classList.contains('short') ? Math.min(3, Toasts.MAX) : Toasts.MAX;
    while (this.el.children.length > max) {
      const last = this.el.lastElementChild as HTMLElement;
      for (const [k, v] of this.live) if (v.el === last) this.live.delete(k);
      last.remove();
    }
  }
}
