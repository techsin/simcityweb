/**
 * The top bar's panel buttons (POLISH_PLAN §7.3: part of META's shell, from the round-1 TopBar split): one button per
 * panel, lit while its panel is open, with an unread badge (advisors, rewards, the emergencies that wait for a
 * dispatch); then Help, Settings and the menu.
 */
import type { GameContext } from '../../game/context';
import { h, setText, toggleClass } from '../dom';
import { icon } from '../icons';

export class PanelButtons {
  readonly el: HTMLElement;
  private badges: Record<string, HTMLElement> = {};

  constructor(private ctx: GameContext) {
    const btns: [string, string, string, () => void][] = [
      ['budget', 'budget', 'Budget (M)', () => this.ctx.panels.toggle('budget')],
      ['graphs', 'graphs', 'Graphs (G)', () => this.ctx.panels.toggle('graphs')],
      ['stats', 'stats', 'City statistics (J)', () => this.ctx.panels.toggle('stats')],
      ['demographics', 'demographics', 'Demographics — ages, schools, services, tourism (P)', () => this.ctx.panels.toggle('demographics')],
      ['advisors', 'advisors', 'Advisors & news (N)', () => this.ctx.panels.toggle('advisors')],
      ['ordinances', 'ordinances', 'Ordinances (Y)', () => this.ctx.panels.toggle('ordinances')],
      ['rewards', 'trophy', 'Rewards & unlocks', () => this.ctx.panels.toggle('rewards')],
      ['emergencies', 'siren', 'Emergencies — active incidents, fleets, statistics', () => this.ctx.panels.toggle('emergencies')],
    ];
    const g = h('div', { class: 'mp-glass', style: 'gap:2px' });
    for (const [id, ic, t, f] of btns) {
      const b = h('button', { class: 'icon-btn', title: t, html: icon(ic, 19), dataset: { panel: id } });
      b.addEventListener('click', () => {
        f();
        b.blur();
      }, { signal: this.ctx.signal });
      g.appendChild(b);
    }
    g.appendChild(h('div', { style: 'width:1px;height:24px;background:var(--hair);margin:0 4px' }));
    const help = h('button', { class: 'icon-btn', title: 'Help & shortcuts (F1)', html: icon('help', 19) });
    help.addEventListener('click', () => this.ctx.panels.toggle('help'), { signal: this.ctx.signal });
    const set = h('button', { class: 'icon-btn', title: 'Settings', html: icon('settings', 19), dataset: { panel: 'settings' } });
    set.addEventListener('click', () => this.ctx.panels.toggle('settings'), { signal: this.ctx.signal });
    const menu = h('button', { class: 'icon-btn', title: 'Menu (Esc)', html: icon('menu', 19) });
    menu.addEventListener('click', () => this.ctx.openPauseMenu(), { signal: this.ctx.signal });
    g.append(help, set, menu);
    this.ctx.ui.on('panel', ({ id, open }) => {
      const b = g.querySelector(`[data-panel="${id}"]`);
      if (b) toggleClass(b, 'on', open);
    });
    this.el = g;
  }

  /** badge (e.g. unread advisor messages) on a panel button */
  setBadge(panel: string, n: number): void {
    const b = this.el.querySelector(`[data-panel="${panel}"]`) as HTMLElement | null;
    if (!b) return;
    let el = this.badges[panel];
    if (n <= 0) {
      el?.remove();
      delete this.badges[panel];
      return;
    }
    if (!el) {
      el = h('span', { class: 'badge' });
      this.badges[panel] = el;
      b.appendChild(el);
    }
    setText(el, n > 9 ? '9+' : String(n));
  }

  /** emergencies waiting for a player dispatch (WP8) */
  update(): void {
    this.setBadge('emergencies', this.ctx.state.stats.emergency?.manualActive ?? 0);
  }
}
