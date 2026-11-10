/**
 * The top bar's population segment (POLISH_PLAN §7.3: CONTENT's, from the round-1 TopBar split; LG-01's rank line goes
 * here): residents and the change since last month; a click opens City statistics.
 */
import type { GameContext } from '../../game/context';
import { h, setText } from '../dom';
import { icon } from '../icons';
import { compact, num } from '../format';

export class PopulationSegment {
  readonly el: HTMLElement;
  private popEl: HTMLElement;
  private trendEl: HTMLElement;

  constructor(private ctx: GameContext) {
    this.popEl = h('div', { class: 'hud-value' });
    this.trendEl = h('div', { class: 'hud-sub' });
    this.el = h('div', { class: 'hud-seg click', title: 'City statistics (J)' }, h('span', { class: 'ico-wrap', style: 'color:#8fc8ff', html: icon('people', 20) }), h('div', { class: 'hud-stack' }, this.popEl, this.trendEl));
    this.el.addEventListener('click', () => this.ctx.panels.toggle('stats'), { signal: this.ctx.signal });
  }

  update(): void {
    const st = this.ctx.state;
    const pop = st.stats.population;
    setText(this.popEl, num(pop));
    const hp = st.history.pop;
    const prev = hp.length >= 2 ? hp[hp.length - 2] : hp.length ? hp[0] : pop;
    const cur = hp.length ? Math.max(pop, 0) : pop;
    const d = cur - prev;
    const pctv = prev > 0 ? (d / prev) * 100 : 0;
    const trendHtml = d === 0 ? `<span class="zero">Stable</span>` : `<span class="trend ${d > 0 ? 'pos' : 'neg'}">${icon(d > 0 ? 'arrowUp' : 'arrowDown', 12)}${compact(Math.abs(d))}${prev > 0 ? ` (${Math.abs(pctv).toFixed(1)}%)` : ''}</span>`;
    if (this.trendEl.dataset.h !== trendHtml) {
      this.trendEl.dataset.h = trendHtml;
      this.trendEl.innerHTML = trendHtml;
    }
  }
}
