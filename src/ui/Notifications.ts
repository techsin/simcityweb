/** News ticker (bottom-left marquee) and toast notifications (top-right). */
import type { NewsItem } from '../sim/CityState';
import type { GameContext } from '../game/context';
import { escapeHtml, h } from './dom';
import { icon } from './icons';
import { dayLabel, simText } from './format';

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
};

export class NewsTicker {
  readonly el: HTMLDivElement;
  private track: HTMLDivElement;
  private view: HTMLDivElement;
  private x = 0;
  private hover = false;
  private shown = -1;
  private width = 0;

  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.track = h('div', { class: 'tk-track' });
    this.view = h('div', { class: 'tk-view' }, this.track);
    this.el = h('div', { class: 'ticker mp-glass', title: 'City news — click for all news' }, h('div', { class: 'tk-badge', html: icon('news', 14) + '<span>News</span>' }), this.view);
    this.el.addEventListener('pointerenter', () => (this.hover = true));
    this.el.addEventListener('pointerleave', () => (this.hover = false));
    this.el.addEventListener('click', (e) => {
      const it = (e.target as HTMLElement).closest('.tk-item') as HTMLElement | null;
      if (it && it.dataset.x) {
        ctx.focusCell(Number(it.dataset.x), Number(it.dataset.z));
        return;
      }
      ctx.panels.open('advisors');
      (ctx.panels as any).get?.('advisors')?.showTab?.('news');
    });
    parent.appendChild(this.el);
    this.rebuild();
  }

  private rebuild(): void {
    const st = this.ctx.state;
    const items = st.news.slice(-8).reverse();
    this.shown = st.news.length;
    this.track.innerHTML = '';
    if (!items.length) {
      const welcome: NewsItem[] = [
        { day: st.day, text: `Welcome to ${st.config.name}! Zone some land and connect it with roads to get started.`, kind: 'info' },
        { day: st.day, text: 'Tip: residents need power — build a power plant and connect it with power lines.', kind: 'advisor' },
      ];
      items.push(...welcome);
    }
    for (const n of items) {
      const el = h('span', { class: `tk-item ${n.kind}` }, h('span', { class: 'tk-dot' }), h('span', { class: 'd' }, dayLabel(n.day, st.config.startYear)), h('span', { html: escapeHtml(simText(n.text)) }));
      if (n.x !== undefined && n.z !== undefined) {
        el.dataset.x = String(n.x);
        el.dataset.z = String(n.z);
        el.style.cursor = 'pointer';
      }
      this.track.appendChild(el);
    }
    this.width = this.track.scrollWidth;
  }

  frame(dt: number): void {
    if (this.ctx.state.news.length !== this.shown) this.rebuild();
    const vw = this.view.clientWidth;
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
  readonly el: HTMLDivElement;
  private recent = new Map<string, number>();
  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.el = h('div', { class: 'toasts' });
    parent.appendChild(this.el);
    ctx.sim.events.on('news', (n) => {
      if (!ctx.settings.toasts) return;
      if (n.kind === 'info') return;
      if (n.kind === 'advisor' && !/!|urgent|critical|warning/i.test(n.text)) return;
      this.show(n.text, n.kind, n.x !== undefined && n.z !== undefined ? { x: n.x, z: n.z } : undefined, n.advisor);
      ctx.sound(n.kind === 'disaster' ? 'alarm' : n.kind === 'reward' ? 'reward' : n.kind === 'bad' || n.kind === 'warning' ? 'warning' : 'notify');
    });
  }

  show(text: string, kind = 'info', cell?: { x: number; z: number }, title?: string): void {
    const now = performance.now();
    const key = kind + ':' + text;
    if ((this.recent.get(key) ?? 0) > now - 2500) return;
    this.recent.set(key, now);
    const meta = NEWS_META[kind] ?? NEWS_META.info;
    const ttl = (kind === 'error' ? 2600 : kind === 'disaster' ? 12000 : 7000) * Toasts.ttlScale;
    const x = h('button', { class: 'icon-btn t-x', html: icon('close', 12) });
    const t = h('div', { class: 'toast mp-glass', style: { '--tc': meta.color } as Record<string, string> },
      h('div', { class: 't-ico', html: icon(meta.icon, 16) }),
      h('div', { class: 't-body' },
        title || meta.title ? h('div', { class: 't-title' }, title ?? meta.title) : null,
        h('div', { class: 't-text' }, simText(text)),
        cell ? h('div', { class: 't-go', html: icon('target', 12) + 'Click to view' }) : null,
      ),
      x,
      h('div', { class: 't-timer', style: { animationDuration: ttl + 'ms' } }),
    );
    let timer = 0;
    const kill = () => {
      clearTimeout(timer);
      t.classList.add('out');
      setTimeout(() => t.remove(), 300);
    };
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      kill();
    });
    t.addEventListener('click', () => {
      if (cell) this.ctx.focusCell(cell.x, cell.z, 420);
      kill();
    });
    timer = window.setTimeout(kill, ttl);
    this.el.prepend(t);
    while (this.el.children.length > 4) this.el.lastElementChild!.remove();
  }
}
