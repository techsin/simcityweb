/** Top HUD bar: city, date & speed, funds, population, RCI demand, approval, panel buttons. */
import { DEV_TYPE_LABELS, DevType } from '../core/types';
import type { GameContext } from '../game/context';
import { clear, h, setText, toggleClass } from './dom';
import { icon } from './icons';
import { compact, dayLabel, hourLabel, money, moneySigned, num, signClass } from './format';
import { approvalBreakdown } from '../sim/economy/approval';

export function sumValues(r: Record<string, number> | undefined): number {
  let s = 0;
  if (r) for (const k in r) s += r[k] || 0;
  return s;
}

/** ledger keys paid / received immediately (construction, zoning, demolition, loan proceeds & repayments, refunds) */
export function isOneOff(key: string): boolean {
  return key.startsWith('oneoff:');
}

/** sum of the recurring entries only (excludes 'oneoff:*' — construction, loan principal, refunds...) */
export function sumRecurring(r: Record<string, number> | undefined): number {
  let s = 0;
  if (r) for (const k in r) if (!isOneOff(k)) s += r[k] || 0;
  return s;
}

/** sum of the one-off entries only ('oneoff:*') */
export function sumOneOff(r: Record<string, number> | undefined): number {
  let s = 0;
  if (r) for (const k in r) if (isOneOff(k)) s += r[k] || 0;
  return s;
}

/** last month's recurring net (taxes & deals - upkeep, services, loan payments); one-offs and loan money excluded */
export function lastNet(ctx: GameContext): number {
  const b = ctx.state.budget;
  return sumRecurring(b.lastIncome) - sumRecurring(b.lastExpense);
}

const RCI_DEFS: { key: 'R' | 'C' | 'I'; color: string; devs: DevType[] }[] = [
  { key: 'R', color: 'var(--res)', devs: [DevType.R1, DevType.R2, DevType.R3] },
  { key: 'C', color: 'var(--com)', devs: [DevType.CS1, DevType.CS2, DevType.CS3, DevType.CO2, DevType.CO3] },
  { key: 'I', color: 'var(--ind)', devs: [DevType.IA, DevType.ID, DevType.IM, DevType.IHT] },
];

const FAMILY_NAMES: Record<string, string> = { R: 'Residential', C: 'Commercial', I: 'Industrial' };
/** where to look for cap relief (toolbar category to open) */
const CAP_TARGET: Record<string, { category: string; label: string; icon: string }> = {
  R: { category: 'parks', label: 'Parks', icon: 'park' },
  C: { category: 'transport', label: 'Airports', icon: 'plane' },
  I: { category: 'transport', label: 'Freight & ports', icon: 'train' },
};

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
  /** approval terms object the tooltip was built from (a new object each month) */
  private apprTerms: unknown = null;
  private leftGlass!: HTMLElement;
  private cityName!: HTMLElement;
  private citySub!: HTMLElement;
  private badges: Record<string, HTMLElement> = {};
  private rciOpen = false;
  private rciSeg!: HTMLElement;
  private capHintsEl!: HTMLElement;
  private capSig = '';
  private announced = new Map<string, number>();

  constructor(private ctx: GameContext, parent: HTMLElement) {
    this.el = h('div', { class: 'hud-top' });
    this.el.append(this.buildLeft(), this.buildCenter(), h('div', { class: 'spacer' }), this.buildRight());
    parent.appendChild(this.el);
    document.addEventListener('pointerdown', (e) => {
      if (this.rciOpen && !(e.target as HTMLElement).closest('.rci-seg')) this.setRci(false);
    }, { signal: ctx.signal });
  }

  private buildLeft(): HTMLElement {
    this.cityName = h('div', { class: 'city-name' });
    this.citySub = h('div', { class: 'hud-sub dim' });
    const city = h('div', { class: 'hud-seg click', title: 'City menu (Esc)' }, h('div', { class: 'city-badge', html: icon('resHigh', 18) }), h('div', { class: 'hud-stack' }, this.cityName, this.citySub));
    city.addEventListener('click', () => this.ctx.openPauseMenu());
    this.dateEl = h('div', { class: 'hud-value' });
    this.todEl = h('div', { class: 'tod hide-sm' });
    const date = h('div', { class: 'hud-seg' }, h('div', { class: 'hud-stack' }, h('div', { class: 'hud-label' }, 'Date', h('span', { class: 'paused-pill' }, 'PAUSED'), h('span', { class: 'live-pill', title: 'An emergency needs you: the game runs at live speed until the help you send arrives (Settings → Gameplay)' }, 'LIVE')), this.dateEl));
    const speeds: [number, string, string][] = [[0, 'pause', 'Pause (Space)'], [1, 'play', 'Normal speed (1)'], [2, 'fast', 'Fast (2)'], [3, 'ultra', 'Ultra (3)']];
    const sp = h('div', { class: 'speed' });
    for (const [s, ic, t] of speeds) {
      const b = h('button', { title: t, html: icon(ic, 15) }) as HTMLButtonElement;
      b.addEventListener('click', () => {
        // distinct sounds: pause (tape-stop), normal / fast / ultra (1-3 rising blips); re-clicking the active speed ticks
        this.ctx.sound(this.ctx.sim.speed === s ? 'tap' : s === 0 ? 'pause' : 'speed' + s);
        this.ctx.sim.speed = s;
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
    const rciSeg = h('div', { class: 'hud-seg click rci-seg', title: 'RCI demand — click for details' }, rci, h('span', { class: 'rci-capdot' }), this.rciPop);
    this.rciSeg = rciSeg;
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
    this.capHintsEl = h('div', { class: 'rci-hints' });
    const foot = h('div', { class: 'rci-foot' }, h('span', { class: 'cap-key' }, 'Demand cap reached'), h('span', { class: 'faint' }, 'Bars above the line = growth wanted'));
    return h('div', { class: 'rci-pop mp-glass i' }, h('div', { class: 'sec-title' }, 'Demand by type'), grid, groups, this.capHintsEl, foot);
  }

  /** per DevType: is the demand cap limiting growth? (sim-core demandInfo, else supply/cap ratio heuristic) */
  private cappedDevs(): boolean[] {
    const st = this.ctx.state;
    const di = this.ctx.mods.econ?.demandInfo;
    if (di) {
      try {
        const info = di(st);
        if (Array.isArray(info.capped)) return info.capped.map((c, d) => c && (st.stats.demand[d] ?? 0) > -0.05);
      } catch {
        /* fall through */
      }
    }
    return Array.from({ length: 12 }, (_, d) => (st.stats.demand[d] ?? 0) > 0.05 && capRatio(this.ctx, d) >= 0.95);
  }

  private capHints(): { family: 'R' | 'C' | 'I'; devs: number[]; hint: string }[] {
    const f = this.ctx.mods.econ?.capHints;
    if (f) {
      try {
        return f(this.ctx.state);
      } catch {
        /* ignore */
      }
    }
    const capped = this.cappedDevs();
    const fallback: Record<string, string> = {
      R: 'Build parks, plazas or landmarks to raise the residential cap.',
      C: 'Build an airport, a convention center or landmarks to raise the commercial cap.',
      I: 'Connect to neighbors (highway / rail), build freight stations or a seaport to raise the industrial cap.',
    };
    return RCI_DEFS.filter((fam) => fam.devs.some((d) => capped[d])).map((fam) => ({ family: fam.key, devs: fam.devs.filter((d) => capped[d]), hint: fallback[fam.key] }));
  }

  /** "what to build" cards in the RCI popover — how players discover the cap / reward loop */
  private renderCapHints(): void {
    const hints = this.capHints();
    const sig = hints.map((x) => x.family + x.devs.join('.') + x.hint).join('|');
    if (sig === this.capSig) return;
    this.capSig = sig;
    clear(this.capHintsEl);
    for (const hnt of hints) {
      const fam = RCI_DEFS.find((f) => f.key === hnt.family)!;
      const go = h('button', { class: 'btn sm', html: icon(CAP_TARGET[hnt.family].icon, 13) + `<span>${CAP_TARGET[hnt.family].label}</span>` });
      go.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setRci(false);
        this.ctx.openFlyout?.(CAP_TARGET[hnt.family].category);
      });
      this.capHintsEl.appendChild(h('div', { class: 'cap-hint', style: { '--fc': fam.color } as Record<string, string> },
        h('span', { class: 'ch-ico', html: icon('alert', 14) }),
        h('div', { class: 'ch-body' },
          h('div', { class: 'ch-t' }, `${FAMILY_NAMES[hnt.family]} demand is capped`, h('span', { class: 'ch-devs' }, hnt.devs.map((d) => DEV_TYPE_LABELS[d]).join(' · '))),
          h('div', { class: 'ch-d' }, hnt.hint),
        ),
        go,
      ));
    }
  }

  /** one-time (per family, per ~quarter) toast when a demand cap starts limiting growth */
  private announceCaps(fams: string[]): void {
    const st = this.ctx.state;
    if (st.stats.population < 200) return;
    for (const f of fams) {
      const last = this.announced.get(f) ?? -1e9;
      if (st.day - last < 90) continue;
      this.announced.set(f, st.day);
      const hint = this.capHints().find((x) => x.family === f)?.hint ?? '';
      this.ctx.toast(`${FAMILY_NAMES[f]} growth is capped. ${hint}`, 'warning', undefined, 'Demand cap');
    }
  }

  /** close the RCI popover; true if it was open */
  closePopover(): boolean {
    if (!this.rciOpen) return false;
    this.setRci(false);
    return true;
  }

  private setRci(open: boolean): void {
    if (open !== this.rciOpen) this.ctx.sound(open ? 'flyout' : 'flyoutClose');
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
      ['emergencies', 'siren', 'Emergencies — active incidents, fleets, statistics', () => this.ctx.panels.toggle('emergencies')],
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

  /** onboarding coach mark on the play button */
  setCoachPlay(on: boolean): void {
    toggleClass(this.speedBtns[1], 'coach', on);
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

    // RCI (cap flags from sim-core's demandInfo when available)
    const dem = st.stats.demand ?? [];
    const cappedDev = this.cappedDevs();
    const capFams: string[] = [];
    RCI_DEFS.forEach((fam, i) => {
      const bar = this.rciBars[i];
      paintBar(bar, familyDemand(dem, fam.devs), fam.color);
      const capped = fam.devs.some((dv) => cappedDev[dv]);
      toggleClass(bar, 'capped', capped);
      toggleClass(bar.parentElement!, 'capped', capped);
      if (capped) capFams.push(fam.key);
    });
    toggleClass(this.rciSeg, 'has-cap', capFams.length > 0);
    const segTitle = capFams.length ? `RCI demand — ${capFams.map((f) => FAMILY_NAMES[f]).join(', ')} capped · click for details` : 'RCI demand — click for details';
    if (this.rciSeg.title !== segTitle) this.rciSeg.title = segTitle;
    this.announceCaps(capFams);
    if (this.rciOpen) {
      for (const s of this.subBars) {
        const v = dem[s.dev] ?? 0;
        paintBar(s.el, v, s.color);
        setText(s.val, (v > 0 ? '+' : '') + Math.round(v * 100));
        const capped = cappedDev[s.dev];
        toggleClass(s.el, 'capped', capped);
        toggleClass(s.el.parentElement!, 'capped', capped);
        const cap = st.stats.demandCap?.[s.dev] ?? 0;
        s.el.title = `${DEV_NAMES[s.dev]}: demand ${Math.round(v * 100)}${cap > 0 ? ` · cap ${cap.toLocaleString('en-US')}` : ''}${capped ? ' — CAPPED' : ''}`;
      }
      this.renderCapHints();
    }

    // emergencies waiting for a player dispatch (WP8)
    this.setBadge('emergencies', st.stats.emergency?.manualActive ?? 0);

    // approval
    const ap = st.stats.approval ?? 50;
    setText(this.apprEl, `${Math.round(ap)}%`);
    const cls = ap >= 60 ? '' : ap >= 40 ? 'meh' : 'bad';
    const want = `hud-seg click approval ${cls}`;
    if (this.apprSeg.className !== want) {
      this.apprSeg.className = want;
      (this.apprSeg.firstElementChild as HTMLElement).innerHTML = icon(ap >= 60 ? 'smile' : ap >= 40 ? 'meh' : 'frown', 20);
    }
    // why: the biggest approval terms of the last monthly update (sim-core approvalBreakdown, WP4), rebuilt monthly
    const eco = st.systemData.economy as { approvalTerms?: object; approvalRaw?: number } | undefined;
    if (eco?.approvalTerms !== this.apprTerms) {
      this.apprTerms = eco?.approvalTerms;
      let tip = 'Mayor approval — advisors (N)';
      try {
        const br = approvalBreakdown(st).filter((t) => t.id !== 'clamp');
        if (br.length > 1) {
          const line = (t: (typeof br)[number]) => `${t.value >= 0 ? '+' : '−'}${Math.abs(t.value).toFixed(1)}  ${t.label}${t.detail ? ` (${t.detail})` : ''}`;
          tip = `Mayor approval ${Math.round(ap)}%, heading for ${Math.round(eco?.approvalRaw ?? ap)}%\n${br.slice(0, 10).map(line).join('\n')}\nClick for advisors (N)`;
        }
      } catch {
        /* keep the plain title */
      }
      this.apprSeg.title = tip;
    }
  }
}
