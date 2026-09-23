/** Top HUD bar: city, date & speed, funds, population, RCI demand, approval, panel buttons. */
import { DEV_TYPE_LABELS, DevType } from '../core/types';
import type { GameContext } from '../game/context';
import { h, setText, toggleClass } from './dom';
import { icon } from './icons';
import { compact, dayLabel, hourLabel, money, moneySigned, num, signClass } from './format';

export function sumValues(r: Record<string, number> | undefined): number {
  let s = 0;
  if (r) for (const k in r) s += r[k] || 0;
  return s;
}

/** last month net (income - expense) */
export function lastNet(ctx: GameContext): number {
  const b = ctx.state.budget;
  return sumValues(b.lastIncome) - sumValues(b.lastExpense);
}

const RCI_DEFS: { key: 'R' | 'C' | 'I'; color: string; devs: DevType[] }[] = [
  { key: 'R', color: 'var(--res)', devs: [DevType.R1, DevType.R2, DevType.R3] },
  { key: 'C', color: 'var(--com)', devs: [DevType.CS1, DevType.CS2, DevType.CS3, DevType.CO2, DevType.CO3] },
  { key: 'I', color: 'var(--ind)', devs: [DevType.IA, DevType.ID, DevType.IM, DevType.IHT] },
];

export const DEV_NAMES = [
  'Low-wealth residents', 'Medium-wealth residents', 'High-wealth residents',
  'Low-wealth services', 'Medium-wealth services', 'High-wealth services',
  'Medium-wealth offices', 'High-wealth offices',
  'Agriculture', 'Dirty industry', 'Manufacturing', 'High-tech industry',
];

/** aggregate demand for a family: strongest positive sub-demand, else the mean */
export function familyDemand(demand: number[], devs: DevType[]): number {
  let mx = -1, sum = 0;
  for (const d of devs) {
    const v = demand[d] ?? 0;
    mx = Math.max(mx, v);
    sum += v;
  }
  const mean = sum / devs.length;
  return Math.max(-1, Math.min(1, mx > 0 ? Math.max(mx, mean) : mean));
}

/** current count vs cap for a dev type: returns 0..1+ ratio or -1 if unknown */
export function capRatio(ctx: GameContext, d: DevType): number {
  const st = ctx.state.stats;
  const cap = st.demandCap?.[d] ?? 0;
  if (!cap || cap <= 0) return -1;
  const cur = d <= DevType.R3 ? (st.residents as number[] | undefined)?.[d] ?? 0 : st.jobsByDev?.[d] ?? 0;
  return cur / cap;
}

function paintBar(el: HTMLElement, v: number, color: string): void {
  const fill = el.firstElementChild as HTMLElement;
  const a = Math.min(1, Math.abs(v));
  if (v >= 0) {
    fill.style.top = `${50 - a * 50}%`;
    fill.style.height = `${a * 50}%`;
    fill.style.background = color;
    fill.style.opacity = '1';
  } else {
    fill.style.top = '50%';
    fill.style.height = `${a * 50}%`;
    fill.style.background = color;
    fill.style.opacity = '0.45';
  }
}

export class TopBar {
  readonly el: HTMLDivElement;
  private dateEl!: HTMLElement;
  private todEl!: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];
  private fundsEl!: HTMLElement;
  private netEl!: HTMLElement;
  private popEl!: HTMLElement;
  private trendEl!: HTMLElement;
  private rciBars: HTMLElement[] = [];
  private rciPop!: HTMLElement;
  private subBars: { el: HTMLElement; val: HTMLElement; dev: DevType; color: string }[] = [];
  private apprEl!: HTMLElement;
  private apprSeg!: HTMLElement;
  private leftGlass!: HTMLElement;
  private cityName!: HTMLElement;
  private citySub!: HTMLElement;
  private badges: Record<string, HTMLElement> = {};
  private rciOpen = false;

  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.el = h('div', { class: 'hud-top' });
    this.el.append(this.buildLeft(), this.buildCenter(), h('div', { class: 'spacer' }), this.buildRight());
    parent.appendChild(this.el);
    document.addEventListener('pointerdown', (e) => {
      if (this.rciOpen && !(e.target as HTMLElement).closest('.rci-seg')) this.setRci(false);
    });
  }

  private buildLeft(): HTMLElement {
    this.cityName = h('div', { class: 'city-name' });
    this.citySub = h('div', { class: 'hud-sub dim' });
    const city = h('div', { class: 'hud-seg click', title: 'City menu (Esc)' }, h('div', { class: 'city-badge', html: icon('resHigh', 18) }), h('div', { class: 'hud-stack' }, this.cityName, this.citySub));
    city.addEventListener('click', () => this.ctx.openPauseMenu());
    this.dateEl = h('div', { class: 'hud-value' });
    this.todEl = h('div', { class: 'tod' });
    const date = h('div', { class: 'hud-seg' }, h('div', { class: 'hud-stack' }, h('div', { class: 'hud-label' }, 'Date', h('span', { class: 'paused-pill' }, 'PAUSED')), this.dateEl));
    const speeds: [number, string, string][] = [[0, 'pause', 'Pause (Space)'], [1, 'play', 'Normal speed (1)'], [2, 'fast', 'Fast (2)'], [3, 'ultra', 'Ultra (3)']];
    const sp = h('div', { class: 'speed' });
    for (const [s, ic, t] of speeds) {
      const b = h('button', { title: t, html: icon(ic, 15) }) as HTMLButtonElement;
      b.addEventListener('click', () => {
        this.ctx.sim.speed = s;
        this.ctx.sound('click');
        b.blur();
      });
      this.speedBtns.push(b);
      sp.appendChild(b);
    }
    const spSeg = h('div', { class: 'hud-seg' }, sp, this.todEl);
    this.leftGlass = h('div', { class: 'mp-glass' }, city, date, spSeg);
    return this.leftGlass;
  }

  private buildCenter(): HTMLElement {
    this.fundsEl = h('div', { class: 'hud-value' });
    this.netEl = h('div', { class: 'hud-sub' });
    const funds = h('div', { class: 'hud-seg click', title: 'Budget (M)' }, h('span', { class: 'ico-wrap', style: 'color:#7ee2a0', html: icon('money', 20) }), h('div', { class: 'hud-stack' }, this.fundsEl, this.netEl));
    funds.addEventListener('click', () => this.ctx.panels.toggle('budget'));
    this.popEl = h('div', { class: 'hud-value' });
    this.trendEl = h('div', { class: 'hud-sub' });
    const pop = h('div', { class: 'hud-seg click', title: 'City statistics (J)' }, h('span', { class: 'ico-wrap', style: 'color:#8fc8ff', html: icon('people', 20) }), h('div', { class: 'hud-stack' }, this.popEl, this.trendEl));
    pop.addEventListener('click', () => this.ctx.panels.toggle('stats'));

    const rci = h('div', { class: 'rci' });
    for (const d of RCI_DEFS) {
      const bar = h('div', { class: 'rci-bar' }, h('i'), h('span', { class: 'rci-cap' }));
      this.rciBars.push(bar);
      rci.appendChild(h('div', { class: 'rci-col' }, bar, h('span', { class: 'rci-l', style: { color: d.color } }, d.key)));
    }
    this.rciPop = this.buildRciPop();
    const rciSeg = h('div', { class: 'hud-seg click rci-seg', title: 'RCI demand — click for details' }, rci, this.rciPop);
    rciSeg.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.rci-pop')) return;
      this.setRci(!this.rciOpen);
    });

    this.apprEl = h('div', { class: 'hud-value' });
    this.apprSeg = h('div', { class: 'hud-seg click approval', title: 'Mayor approval — advisors (N)' }, h('span', { class: 'ico-wrap', html: icon('smile', 20) }), h('div', { class: 'hud-stack' }, h('div', { class: 'hud-label' }, 'Approval'), this.apprEl));
    this.apprSeg.addEventListener('click', () => this.ctx.panels.toggle('advisors'));
    return h('div', { class: 'mp-glass' }, funds, pop, rciSeg, this.apprSeg);
  }

  private buildRciPop(): HTMLElement {
    const grid = h('div', { class: 'rci-grid' });
    for (const fam of RCI_DEFS) {
      for (const d of fam.devs) {
        const bar = h('div', { class: 'rci-bar' }, h('i'), h('span', { class: 'rci-cap' }));
        const val = h('span', { class: 'val' });
        bar.title = DEV_NAMES[d];
        grid.appendChild(h('div', { class: 'g' }, val, bar, h('span', { class: 'lbl' }, DEV_TYPE_LABELS[d])));
        this.subBars.push({ el: bar, val, dev: d, color: fam.color });
      }
    }
    const groups = h('div', { class: 'rci-groups' },
      h('div', { style: { color: 'var(--res)', borderColor: 'var(--res)' } }, 'RESIDENTIAL'),
      h('div', { style: { color: 'var(--com)', borderColor: 'var(--com)' } }, 'COMMERCIAL'),
      h('div', { style: { color: 'var(--ind)', borderColor: 'var(--ind)' } }, 'INDUSTRIAL'),
    );
    const foot = h('div', { class: 'rci-foot' }, h('span', { class: 'cap-key' }, 'Demand cap reached — build parks, airports, seaports or landmarks'));
    return h('div', { class: 'rci-pop mp-glass i' }, h('div', { class: 'sec-title' }, 'Demand by type'), grid, groups, foot);
  }

  private setRci(open: boolean): void {
    this.rciOpen = open;
    toggleClass(this.rciPop, 'open', open);
    if (open) this.update();
  }

  private buildRight(): HTMLElement {
    const btns: [string, string, string, () => void][] = [
      ['budget', 'budget', 'Budget (M)', () => this.ctx.panels.toggle('budget')],
      ['graphs', 'graphs', 'Graphs (G)', () => this.ctx.panels.toggle('graphs')],
      ['stats', 'stats', 'City statistics (J)', () => this.ctx.panels.toggle('stats')],
      ['advisors', 'advisors', 'Advisors & news (N)', () => this.ctx.panels.toggle('advisors')],
      ['ordinances', 'ordinances', 'Ordinances (Y)', () => this.ctx.panels.toggle('ordinances')],
      ['rewards', 'trophy', 'Rewards & unlocks', () => this.ctx.panels.toggle('rewards')],
    ];
    const g = h('div', { class: 'mp-glass', style: 'gap:2px' });
    for (const [id, ic, t, f] of btns) {
      const b = h('button', { class: 'icon-btn', title: t, html: icon(ic, 19), dataset: { panel: id } });
      b.addEventListener('click', () => {
        f();
        b.blur();
      });
      g.appendChild(b);
    }
    g.appendChild(h('div', { style: 'width:1px;height:24px;background:var(--hair);margin:0 4px' }));
    const help = h('button', { class: 'icon-btn', title: 'Help & shortcuts (F1)', html: icon('help', 19) });
    help.addEventListener('click', () => this.ctx.panels.toggle('help'));
    const set = h('button', { class: 'icon-btn', title: 'Settings', html: icon('settings', 19), dataset: { panel: 'settings' } });
    set.addEventListener('click', () => this.ctx.panels.toggle('settings'));
    const menu = h('button', { class: 'icon-btn', title: 'Menu (Esc)', html: icon('menu', 19) });
    menu.addEventListener('click', () => this.ctx.openPauseMenu());
    g.append(help, set, menu);
    this.ctx.ui.on('panel', ({ id, open }) => {
      const b = g.querySelector(`[data-panel="${id}"]`);
      if (b) toggleClass(b, 'on', open);
    });
    return g;
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

  update(): void {
    const ctx = this.ctx;
    const st = ctx.state;
    setText(this.cityName, st.config.name || 'New City');
    const diff = st.config.sandbox ? 'Sandbox' : st.config.difficulty[0].toUpperCase() + st.config.difficulty.slice(1);
    setText(this.citySub, `Mayor ${st.config.mayor || ''} · ${diff}`.replace('Mayor  ·', 'Mayor ·'));
    setText(this.dateEl, dayLabel(st.day, st.config.startYear));
    const speed = ctx.sim.speed;
    this.speedBtns.forEach((b, i) => {
      toggleClass(b, 'on', i === speed);
      toggleClass(b, 'paused', i === 0 && speed === 0);
    });
    toggleClass(this.leftGlass, 'is-paused', speed === 0);
    let hour = 12;
    try {
      hour = ctx.world.timeOfDay ?? 12;
    } catch {
      /* ignore */
    }
    const night = hour < 6 || hour >= 19.5;
    const todHtml = icon(night ? 'moon' : hour < 8 || hour > 18 ? 'sunrise' : 'sun', 15) + `<span class="num">${hourLabel(hour)}</span>`;
    if (this.todEl.dataset.h !== todHtml) {
      this.todEl.dataset.h = todHtml;
      this.todEl.innerHTML = todHtml;
    }
    toggleClass(this.todEl, 'night', night);

    // funds
    setText(this.fundsEl, st.config.sandbox ? '∞' : money(st.funds));
    toggleClass(this.fundsEl, 'neg', st.funds < 0);
    const net = lastNet(ctx);
    const hasBudget = Object.keys(st.budget.lastIncome).length + Object.keys(st.budget.lastExpense).length > 0;
    setText(this.netEl, hasBudget ? `${moneySigned(net, Math.abs(net) >= 1e5)}/mo` : 'No report yet');
    this.netEl.className = 'hud-sub ' + (hasBudget ? signClass(net) : 'faint');

    // population
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

    // RCI
    const dem = st.stats.demand ?? [];
    RCI_DEFS.forEach((fam, i) => {
      const bar = this.rciBars[i];
      paintBar(bar, familyDemand(dem, fam.devs), fam.color);
      const capped = fam.devs.some((dv) => (dem[dv] ?? 0) > 0.05 && capRatio(ctx, dv) >= 0.95);
      toggleClass(bar, 'capped', capped);
    });
    if (this.rciOpen) {
      for (const s of this.subBars) {
        const v = dem[s.dev] ?? 0;
        paintBar(s.el, v, s.color);
        setText(s.val, (v > 0 ? '+' : '') + Math.round(v * 100));
        const cr = capRatio(ctx, s.dev);
        toggleClass(s.el, 'capped', cr >= 0.95);
        s.el.title = `${DEV_NAMES[s.dev]}: demand ${Math.round(v * 100)}${cr >= 0 ? ` · cap ${Math.round(cr * 100)}% used` : ''}`;
      }
    }

    // approval
    const ap = st.stats.approval ?? 50;
    setText(this.apprEl, `${Math.round(ap)}%`);
    const cls = ap >= 60 ? '' : ap >= 40 ? 'meh' : 'bad';
    const want = `hud-seg click approval ${cls}`;
    if (this.apprSeg.className !== want) {
      this.apprSeg.className = want;
      (this.apprSeg.firstElementChild as HTMLElement).innerHTML = icon(ap >= 60 ? 'smile' : ap >= 40 ? 'meh' : 'frown', 20);
    }
  }
}
