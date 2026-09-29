/**
 * Advisors (status + advice) and the full news feed. Each advisor card shows its open issues (advice whose condition
 * still holds, highest priority first: sim/economy/advisors openAdvice) — else its latest message of the last 90 days,
 * else its own assessment. An open 'bad' / 'warning' issue also colours the status dot (and 'bad' counts for the badge).
 */
import type { NewsItem } from '../../sim/CityState';
import { openAdvice, type OpenAdvice } from '../../sim/economy/advisors';
import type { GameContext } from '../../game/context';
import { Panel } from '../Panel';
import { clear, escapeHtml, h, toggleClass } from '../dom';
import { icon } from '../icons';
import { dayLabel, money, pct } from '../format';
import { lastNet } from '../TopBar';

interface Advisor {
  id: string;
  name: string;
  role: string;
  icon: string;
  color: string;
  /** matches NewsItem.advisor */
  keys: RegExp;
  assess: (ctx: GameContext) => { level: 'good' | 'warn' | 'bad'; text: string };
}

const S = (ctx: GameContext) => ctx.state.stats;

export const ADVISORS: Advisor[] = [
  {
    id: 'finance', name: 'Morgan Price', role: 'Finance', icon: 'budget', color: '#2f9e5b', keys: /financ|budget|money|treasur/i,
    assess: (ctx) => {
      const net = lastNet(ctx), f = ctx.state.funds;
      if (ctx.state.config.sandbox) return { level: 'good', text: 'Sandbox mode — money is no object, Mayor.' };
      if (f < 0) return { level: 'bad', text: `We're in the red (${money(f)}). Raise taxes, cut services or take a loan immediately.` };
      if (net < 0) return { level: 'warn', text: `We lost ${money(-net)} last month. At this rate the treasury runs dry in ${Math.max(1, Math.floor(f / -net))} months.` };
      return { level: 'good', text: net > 0 ? `A healthy surplus of ${money(net)} last month. Consider investing in services.` : 'The budget is balanced. Keep an eye on expenses as the city grows.' };
    },
  },
  {
    id: 'utilities', name: 'Dana Volt', role: 'Utilities', icon: 'utilities', color: '#c9a21a', keys: /utilit|power|water|garbage|energy/i,
    assess: (ctx) => {
      const s = S(ctx);
      if (s.powerDemand > 0 && s.powerSupply < s.powerDemand) return { level: 'bad', text: `Power shortage! Demand ${Math.round(s.powerDemand)} MW vs supply ${Math.round(s.powerSupply)} MW. Build a power plant.` };
      if (s.waterDemand > 0 && s.waterSupply < s.waterDemand) return { level: 'warn', text: 'Water supply cannot keep up with demand. Build pumps or water towers.' };
      if (s.garbageCapacity > 0 && s.garbageProduced > s.garbageCapacity) return { level: 'warn', text: 'Garbage is piling up. Zone a landfill or build a recycling center.' };
      if (s.population > 0 && s.powerSupply === 0) return { level: 'bad', text: 'Our city has no power at all! Place a power plant and connect it with power lines.' };
      return { level: 'good', text: 'Power, water and garbage services are keeping up.' };
    },
  },
  {
    id: 'safety', name: 'Chief Reyes', role: 'Public safety', icon: 'police', color: '#3f6fe0', keys: /safety|police|fire|crime/i,
    assess: (ctx) => {
      const c = S(ctx).avgCrime;
      if (c > 0.45) return { level: 'bad', text: `Crime is out of control (${pct(c)}). We need police stations in the affected neighborhoods.` };
      if (c > 0.25) return { level: 'warn', text: 'Crime is rising. A police station would help keep the streets safe.' };
      return { level: 'good', text: 'The streets are safe. Make sure fire coverage grows with the city.' };
    },
  },
  {
    id: 'health', name: 'Dr. Okafor', role: 'Health & education', icon: 'education', color: '#d95a8a', keys: /health|educat|school|hospital/i,
    assess: (ctx) => {
      const s = S(ctx);
      if (s.population > 2000 && s.eq < 60) return { level: 'warn', text: `Education quotient is low (EQ ${Math.round(s.eq)}). Schools attract high-tech industry and offices.` };
      if (s.population > 2000 && s.hq < 60) return { level: 'warn', text: `Health is poor (HQ ${Math.round(s.hq)}). Build clinics or a hospital.` };
      return { level: 'good', text: `EQ ${Math.round(s.eq)} · HQ ${Math.round(s.hq)}. Our citizens are healthy and learning.` };
    },
  },
  {
    id: 'transport', name: 'Sam Lane', role: 'Transportation', icon: 'car', color: '#7a8aa0', keys: /transport|traffic|road|transit|commute/i,
    assess: (ctx) => {
      const s = S(ctx);
      if (s.avgTraffic > 0.7) return { level: 'bad', text: `Gridlock! Congestion is at ${pct(s.avgTraffic)}. Upgrade to avenues, add highways or transit.` };
      if (s.avgCommute > 45) return { level: 'warn', text: `Commutes average ${Math.round(s.avgCommute)} minutes. Workers won't travel much further.` };
      return { level: 'good', text: s.avgCommute ? `Average commute ${Math.round(s.avgCommute)} min. Traffic is flowing.` : 'Connect zones with roads so citizens can reach jobs.' };
    },
  },
  {
    id: 'environment', name: 'Robin Green', role: 'Environment', icon: 'leaf', color: '#2fae7a', keys: /environ|pollut|nature|park/i,
    assess: (ctx) => {
      const p = S(ctx).avgPollution;
      if (p > 0.45) return { level: 'bad', text: `Pollution is choking the city (${pct(p)}). Separate industry from homes and plant trees.` };
      if (p > 0.25) return { level: 'warn', text: 'Pollution is climbing. Parks and cleaner industry would help.' };
      return { level: 'good', text: 'The air is clean. Parks will keep land values high.' };
    },
  },
  {
    id: 'planning', name: 'Alex Stone', role: 'City planning', icon: 'zones', color: '#8a63d2', keys: /plan|zone|demand|growth|develop/i,
    assess: (ctx) => {
      const s = S(ctx);
      const dem = s.demand ?? [];
      const r = Math.max(dem[0] ?? 0, dem[1] ?? 0, dem[2] ?? 0), c = Math.max(...(dem.slice(3, 8).length ? dem.slice(3, 8) : [0])), i = Math.max(...(dem.slice(8, 12).length ? dem.slice(8, 12) : [0]));
      if (s.unemployment > 0.15) return { level: 'warn', text: `Unemployment is ${pct(s.unemployment)}. Zone more commercial and industrial land.` };
      const top = [['residential', r], ['commercial', c], ['industrial', i]].sort((a, b) => (b[1] as number) - (a[1] as number))[0];
      if ((top[1] as number) > 0.3) return { level: 'good', text: `There's strong demand for ${top[0]} development — zone accordingly.` };
      return { level: 'good', text: 'Demand is balanced. Improve services and land value to attract wealthier citizens.' };
    },
  },
];

export class AdvisorsPanel extends Panel {
  readonly id = 'advisors';
  readonly title = 'Advisors & news';
  override icon = 'advisors';
  override width = 640;
  private tab: 'advisors' | 'news' = 'advisors';
  private tabBtns: Record<string, HTMLButtonElement> = {};
  private content!: HTMLDivElement;
  private lastSig = '';
  seenNews = 0;

  override defaultPos(w: number): { x: number; y: number } {
    return { x: w - this.width - 14, y: 72 };
  }

  protected build(): void {
    const tabs = h('div', { class: 'tabs' });
    for (const [id, label] of [['advisors', 'Advisors'], ['news', 'News feed']] as const) {
      const b = h('button', null, label) as HTMLButtonElement;
      b.addEventListener('click', () => this.showTab(id));
      this.tabBtns[id] = b;
      tabs.appendChild(b);
    }
    this.el.insertBefore(tabs, this.body);
    this.content = h('div');
    this.body.appendChild(this.content);
  }

  showTab(t: 'advisors' | 'news'): void {
    this.tab = t;
    this.lastSig = '';
    this.update();
  }

  private latestFor(a: Advisor): NewsItem | undefined {
    const news = this.ctx.state.news;
    for (let i = news.length - 1; i >= 0; i--) {
      const n = news[i];
      if (n.advisor && (a.keys.test(n.advisor) || n.advisor === a.id)) return n;
    }
    return undefined;
  }

  /** open advice of the whole city, re-evaluated at most once a second of wall-clock time (a few ms on a big map) */
  private open: OpenAdvice[] = [];
  private openAt = -Infinity;
  private openState: unknown = null;
  private refreshOpen(): void {
    const now = performance.now();
    if (this.openState === this.ctx.state && now - this.openAt < 1000) return;
    this.openAt = now;
    this.openState = this.ctx.state;
    try {
      this.open = openAdvice(this.ctx.sim);
    } catch {
      this.open = [];
    }
  }

  /** this advisor's open issues, highest priority first */
  private openFor(a: Advisor): OpenAdvice[] {
    return this.open.filter((o) => o.advisor === a.id);
  }

  override onOpen(): void {
    this.seenNews = this.ctx.state.news.length;
  }

  override update(): void {
    const st = this.ctx.state;
    for (const [id, b] of Object.entries(this.tabBtns)) toggleClass(b, 'on', id === this.tab);
    this.seenNews = st.news.length;
    let openSig = '';
    if (this.tab === 'advisors') {
      this.refreshOpen();
      openSig = this.open.map((o) => `${o.id}|${o.text}`).join('\n');
    }
    const sig = `${this.tab}:${st.news.length}:${st.monthIndex}:${Math.round(st.stats.population / 50)}:${openSig}`;
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    clear(this.content);
    if (this.tab === 'advisors') {
      const grid = h('div', { class: 'adv-grid' });
      for (const a of ADVISORS) {
        let res: { level: 'good' | 'warn' | 'bad'; text: string };
        try {
          res = a.assess(this.ctx);
        } catch {
          res = { level: 'good', text: '…' };
        }
        // open issues first (they still hold, however old the message); else the latest message of the last 90 days
        const open = this.openFor(a);
        const top = open[0];
        const latest = top ? undefined : this.latestFor(a);
        const recent = !!latest && st.day - latest.day < 90;
        const level = worse(res.level, top ? LEVEL_OF[top.kind] : 'good');
        const stColor = level === 'bad' ? 'var(--bad)' : level === 'warn' ? 'var(--warn)' : 'var(--good)';
        const text = top ? top.text : recent ? latest!.text : res.text;
        const src = top ?? (recent ? latest! : null);
        const at = src && src.x !== undefined && src.z !== undefined ? { x: src.x, z: src.z } : null;
        const more = open.slice(1, 1 + MORE_MAX);
        const card = h('div', { class: 'adv' },
          h('div', { class: 'av', style: { background: `linear-gradient(145deg, ${a.color}, color-mix(in srgb, ${a.color} 55%, #000))`, '--st': stColor } as Record<string, string>, html: icon(a.icon, 19) }),
          h('div', { class: 'ab' },
            h('div', { style: 'display:flex;align-items:baseline;gap:8px' }, h('span', { class: 'an' }, a.name), h('span', { class: 'ar' }, a.role)),
            h('div', { class: 'am' }, text),
            at ? h('button', { class: 'btn sm ghost', style: 'margin-top:6px;padding-left:0', html: icon('target', 13) + '<span>Show me</span>', onclick: () => this.ctx.focusCell(at.x, at.z, 420) }) : null,
            more.length ? h('ul', { class: 'am-more' }, ...more.map((o) => this.moreRow(o))) : null,
            open.length > 1 + MORE_MAX ? h('div', { class: 'am-extra', title: open.slice(1 + MORE_MAX).map((o) => o.text).join('\n') }, `+ ${open.length - 1 - MORE_MAX} more`) : null,
          ),
        );
        grid.appendChild(card);
      }
      this.content.appendChild(grid);
    } else {
      const list = h('div', { class: 'news-list' });
      const items = st.news.slice().reverse();
      if (!items.length) list.appendChild(h('div', { class: 'empty', html: icon('news', 28) + '<div>No news yet. Build your city and the headlines will follow.</div>' }));
      for (const n of items.slice(0, 150)) {
        const row = h('div', { class: `news-row ${n.kind}` }, h('span', { class: 'nd' }), h('span', { class: 'nt' }, dayLabel(n.day, st.config.startYear)), h('span', { html: escapeHtml(n.text) + (n.advisor ? ` <span class="faint">— ${escapeHtml(n.advisor)}</span>` : '') }));
        if (n.x !== undefined && n.z !== undefined) {
          const go = h('span', { class: 'go', title: 'Show on map', html: icon('target', 14) });
          row.appendChild(go);
          row.style.cursor = 'pointer';
          row.addEventListener('click', () => this.ctx.focusCell(n.x!, n.z!, 420));
        } else row.appendChild(h('span'));
        list.appendChild(row);
      }
      this.content.appendChild(list);
    }
  }

  /** a further open issue: one line (full text on hover), click shows it on the map */
  private moreRow(o: OpenAdvice): HTMLElement {
    const go = o.x !== undefined && o.z !== undefined;
    return h('li', { class: o.kind + (go ? ' go' : ''), title: o.text, onclick: go ? () => this.ctx.focusCell(o.x!, o.z!, 420) : undefined },
      h('i', { class: 'md' }), h('span', { class: 'mt' }, o.text), go ? h('span', { class: 'mg', html: icon('target', 12) }) : null);
  }

  /** advisor warnings count for the top-bar badge (a 'bad' assessment or a 'bad' open issue) */
  alertCount(): number {
    this.refreshOpen();
    let n = 0;
    for (const a of ADVISORS) {
      let bad = this.open.some((o) => o.advisor === a.id && o.kind === 'bad');
      if (!bad) {
        try {
          bad = a.assess(this.ctx).level === 'bad';
        } catch {
          /* ignore */
        }
      }
      if (bad) n++;
    }
    return n;
  }
}

/** further open issues listed under the top one */
const MORE_MAX = 2;
const LEVEL_OF: Record<OpenAdvice['kind'], 'good' | 'warn' | 'bad'> = { bad: 'bad', warning: 'warn', info: 'good', good: 'good' };
const RANK = { good: 0, warn: 1, bad: 2 } as const;
const worse = (a: 'good' | 'warn' | 'bad', b: 'good' | 'warn' | 'bad') => (RANK[b] > RANK[a] ? b : a);
