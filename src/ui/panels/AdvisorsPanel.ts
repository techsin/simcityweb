/**
 * Advisors (status + advice) and the full news feed. Each advisor card shows its open issues (highest priority
 * first) — else another system's news of the last RECENT_DAYS (advice posts never linger once resolved: adviceIdOf),
 * else its own assessment. An open 'bad' / 'warning' issue also colours the status dot. The top-bar badge stays on the
 * (cheap) assessments.
 * PERF: while the game runs the cards read advisorIssues (the month tick's full list — no scan of the city); a fresh
 * openAdvice scan (several ms on a big map) runs only while paused, or once after the player edited the map (zones,
 * roads, lines, plopped buildings: playerEditCounter — the city's own growth never counts), so a school placed while
 * paused shows at once. The content is rebuilt only when what it shows changed (the cards' texts, the newest news
 * item), at most once per real second (final fixes A1: the signature changed with every 50 residents, a full rebuild
 * on every UI tick at ultra speed).
 * "Show me" opens the data view of the advice (advisorModel.adviceView) together with the camera move (final fixes N8).
 */
import type { NewsItem } from '../../sim/CityState';
import { adviceIdOf, advisorIssues, advisorIssuesReady, openAdvice, type OpenAdvice } from '../../sim/economy/advisors';
import type { GameContext } from '../../game/context';
import { type AdviceView, adviceView, outageAssessment, utilityOutages } from '../advisorModel';
import { newsMark } from '../newsLog';
import { resolveVariant } from '../../sim/infra/overlays';
import { overlayTitle } from '../overlays';
import { Panel } from '../Panel';
import { clear, escapeHtml, h, toggleClass } from '../dom';
import { icon } from '../icons';
import { dayLabel, money, pct } from '../format';
import { lastNet } from '../TopBar';
import { playerEditCounter, type EditCounter } from '../playerEdits';

/** an advisor's own assessment; `at` / `view`: where "Show me" goes and the data view it opens */
export interface Assessment {
  level: 'good' | 'warn' | 'bad';
  text: string;
  at?: { x: number; z: number } | null;
  view?: AdviceView | null;
}

interface Advisor {
  id: string;
  name: string;
  role: string;
  icon: string;
  color: string;
  /** matches NewsItem.advisor */
  keys: RegExp;
  assess: (ctx: GameContext) => Assessment;
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
      if (s.powerDemand > 0 && s.powerSupply < s.powerDemand) return { level: 'bad', text: `Power shortage! Demand ${Math.round(s.powerDemand)} MW vs supply ${Math.round(s.powerSupply)} MW. Build a power plant.`, view: adviceView('powerShortage') };
      if (s.population > 0 && s.powerSupply === 0) return { level: 'bad', text: 'Our city has no power at all! Place a power plant and connect it with power lines.', view: adviceView('noPower') };
      // final fixes N1 (card part): occupied buildings cut off from the grid or the pipes, live from their flags — the
      // supply can keep up while a bulldozed road leaves a district dark
      const out = outageAssessment(utilityOutages(ctx.state));
      if (out?.kind === 'power') return out;
      if (s.waterDemand > 0 && s.waterSupply < s.waterDemand) return { level: 'warn', text: 'Water supply cannot keep up with demand. Build pumps or water towers.', view: adviceView('waterShortage') };
      if (out) return out;
      if (s.garbageCapacity > 0 && s.garbageProduced > s.garbageCapacity) return { level: 'warn', text: 'Garbage is piling up. Zone a landfill or build a recycling center.', view: adviceView('garbage') };
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
  /** the player's map edits (a fresh scan after one; growth alone keeps the month tick's list) */
  private readonly edits: EditCounter;

  constructor(ctx: GameContext) {
    super(ctx);
    this.edits = playerEditCounter(ctx.sim);
  }

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
    this.resetGate();
    if (t === 'advisors' && this.isOpen) this.refreshOpen(true);
    this.update();
  }

  /**
   * the advisor's latest news of the last RECENT_DAYS from another system (emergencies, shortages, connections …).
   * Advice posts are skipped: the open issues show those while their rule holds, and a resolved one must not linger.
   */
  private latestFor(a: Advisor): NewsItem | undefined {
    const st = this.ctx.state, news = st.news;
    for (let i = news.length - 1; i >= 0; i--) {
      const n = news[i];
      if (st.day - n.day >= RECENT_DAYS) break;
      if (!n.advisor || !(a.keys.test(n.advisor) || n.advisor === a.id)) continue;
      if (adviceIdOf(st, n)) continue;
      return n;
    }
    return undefined;
  }

  /**
   * open advice of the whole city. Running game: the month tick's list (advisorIssues, re-read each new month).
   * Paused, or the player edited the map since the last look (zones, roads, lines, plopped buildings — not the city's
   * own growth): a fresh openAdvice scan (several ms on a big map), throttled to OPEN_REFRESH_MS of wall-clock time.
   */
  private open: OpenAdvice[] = [];
  private openAt = -Infinity;
  private openDay = -1;
  private openEdits = -1;
  private openMonth = -1;
  private openState: unknown = null;
  private refreshOpen(force = false): void {
    const st = this.ctx.state, now = performance.now();
    const paused = this.ctx.sim.speed === 0;
    const edited = this.edits.count !== this.openEdits;
    if (!force && this.openState === st) {
      if (paused || edited) {
        // the city changed while paused, or the player edited the map: a fresh look, throttled
        if ((st.day === this.openDay && !edited) || now - this.openAt < OPEN_REFRESH_MS) return;
        this.scanFresh(st, now);
        return;
      }
      // running: the month tick's list, re-read once a month
      if (st.monthIndex !== this.openMonth) this.readIssues(st, now);
      return;
    }
    if (paused) this.scanFresh(st, now);
    else this.readIssues(st, now);
  }
  private mark(st: typeof this.ctx.state, now: number): void {
    this.openAt = now;
    this.openDay = st.day;
    this.openEdits = this.edits.count;
    this.openMonth = st.monthIndex;
    this.openState = st;
  }
  private scanFresh(st: typeof this.ctx.state, now: number): void {
    this.mark(st, now);
    try {
      this.open = openAdvice(this.ctx.sim);
    } catch {
      this.open = [];
    }
  }
  /** the month tick's full issue list (places looked up on the first read), highest priority first; before the first
   *  month tick of this session (e.g. right after loading) one fresh scan */
  private readIssues(st: typeof this.ctx.state, now: number): void {
    if (!advisorIssuesReady(st)) {
      this.scanFresh(st, now);
      return;
    }
    this.mark(st, now);
    try {
      this.open = Object.values(advisorIssues(st)).flat().sort((a, b) => b.priority - a.priority);
    } catch {
      this.open = [];
    }
  }

  /** this advisor's open issues, highest priority first */
  private openFor(a: Advisor): OpenAdvice[] {
    return this.open.filter((o) => o.advisor === a.id);
  }

  override onOpen(): void {
    // fresh open issues whenever the panel opens (the refresh while it stays open is throttled)
    this.openState = null;
    this.resetGate();
  }

  /** what each advisor card shows: open issues first (they still hold, however old the message); else recent news of
   *  other systems; else the advisor's own assessment — a bad one (an outage, a shortage) before a merely recent
   *  message */
  private cards(): Card[] {
    const out: Card[] = [];
    for (const a of ADVISORS) {
      let res: Assessment;
      try {
        res = a.assess(this.ctx);
      } catch {
        res = { level: 'good', text: '…' };
      }
      const open = this.openFor(a);
      const top = open[0];
      const latest = top || res.level === 'bad' ? undefined : this.latestFor(a);
      const level = worse(res.level, top ? LEVEL_OF[top.kind] : 'good');
      const text = top ? top.text : latest ? latest.text : res.text;
      const src = top ?? latest ?? null;
      const at = src ? (src.x !== undefined && src.z !== undefined ? { x: src.x, z: src.z } : null) : res.at ?? null;
      const view = top ? adviceView(top.id) : latest ? null : res.view ?? null;
      out.push({ a, level, text, at, view, more: open.slice(1, 1 + MORE_MAX), extra: open.slice(1 + MORE_MAX) });
    }
    return out;
  }

  /** "Show me": the advice's data view (its variant) and the camera on the place */
  private showMe(at: { x: number; z: number } | null, view: AdviceView | null): void {
    const ctx = this.ctx;
    if (view && (ctx.overlay !== view.overlay || (view.variant !== undefined && resolveVariant(view.overlay, ctx.overlayVariant) !== view.variant))) {
      // (the camera move makes its own sound)
      if (!at) ctx.sound('overlay');
      ctx.setOverlay(view.overlay, view.variant);
    }
    if (at) ctx.focusCell(at.x, at.z, 420);
  }

  override update(): void {
    const st = this.ctx.state;
    for (const [id, b] of Object.entries(this.tabBtns)) toggleClass(b, 'on', id === this.tab);
    if (this.tab === 'advisors') {
      this.refreshOpen();
      const cards = this.cards();
      const sig = cards.map((c) => `${c.level}|${c.text}|${c.at ? c.at.x + ',' + c.at.z : ''}|${c.view ? c.view.overlay + ':' + (c.view.variant ?? '') : ''}|${c.more.map((o) => o.id + '|' + o.text).join('/')}|${c.extra.length}`).join('\n');
      if (!this.gate('advisors', sig)) return;
      clear(this.content);
      const grid = h('div', { class: 'adv-grid' });
      for (const c of cards) {
        const a = c.a;
        const stColor = c.level === 'bad' ? 'var(--bad)' : c.level === 'warn' ? 'var(--warn)' : 'var(--good)';
        // ("Show me" without a place opens the data view that shows where: a city-wide issue)
        const go = c.at || c.view;
        const tip = c.view ? `Opens the ${overlayTitle(c.view.overlay, c.view.variant ?? -1)} data view${c.at ? ' and shows the place' : ''}` : 'Shows the place on the map';
        const card = h('div', { class: 'adv' },
          h('div', { class: 'av', style: { background: `linear-gradient(145deg, ${a.color}, color-mix(in srgb, ${a.color} 55%, #000))`, '--st': stColor } as Record<string, string>, html: icon(a.icon, 19) }),
          h('div', { class: 'ab' },
            h('div', { style: 'display:flex;align-items:baseline;gap:8px' }, h('span', { class: 'an' }, a.name), h('span', { class: 'ar' }, a.role)),
            h('div', { class: 'am' }, c.text),
            go ? h('button', { class: 'btn sm ghost', style: 'margin-top:6px;padding-left:0', title: tip, html: icon(c.at ? 'target' : 'layers', 13) + '<span>Show me</span>', onclick: () => this.showMe(c.at, c.view) }) : null,
            c.more.length ? h('ul', { class: 'am-more' }, ...c.more.map((o) => this.moreRow(o))) : null,
            c.extra.length ? h('div', { class: 'am-extra', title: c.extra.map((o) => o.text).join('\n') }, `+ ${c.extra.length} more`) : null,
          ),
        );
        grid.appendChild(card);
      }
      this.content.appendChild(grid);
      return;
    }
    // news feed: rebuilt when an item arrives — by the newest item's identity: the log keeps the last 200, so its
    // length stops changing once it is full (final fixes N2)
    if (!this.gate('news', `${newsMark(st.news)}:${st.news.length}:${st.config.startYear}`)) return;
    clear(this.content);
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

  /** a further open issue: one line (full text on hover), click shows it on the map (and its data view) */
  private moreRow(o: OpenAdvice): HTMLElement {
    const at = o.x !== undefined && o.z !== undefined ? { x: o.x, z: o.z } : null;
    const view = adviceView(o.id);
    const go = !!(at || view);
    return h('li', { class: o.kind + (go ? ' go' : ''), title: o.text, onclick: go ? () => this.showMe(at, view) : undefined },
      h('i', { class: 'md' }), h('span', { class: 'mt' }, o.text), go ? h('span', { class: 'mg', html: icon(at ? 'target' : 'layers', 12) }) : null);
  }

  /** advisor warnings count for the top-bar badge (cheap: the assessments; no advisor scan while the panel is shut) */
  alertCount(): number {
    let n = 0;
    for (const a of ADVISORS) {
      try {
        if (a.assess(this.ctx).level === 'bad') n++;
      } catch {
        /* ignore */
      }
    }
    return n;
  }
}

/** one advisor card's content (AdvisorsPanel.cards) */
interface Card {
  a: Advisor;
  level: 'good' | 'warn' | 'bad';
  text: string;
  at: { x: number; z: number } | null;
  view: AdviceView | null;
  more: OpenAdvice[];
  extra: OpenAdvice[];
}

/** further open issues listed under the top one */
const MORE_MAX = 2;
/** other systems' news older than this (days) no longer speaks for an advisor */
const RECENT_DAYS = 30;
/** while the panel stays open, open issues are re-evaluated at most this often (ms), and only when the city moved on */
const OPEN_REFRESH_MS = 3000;
const LEVEL_OF: Record<OpenAdvice['kind'], 'good' | 'warn' | 'bad'> = { bad: 'bad', warning: 'warn', info: 'good', good: 'good' };
const RANK = { good: 0, warn: 1, bad: 2 } as const;
const worse = (a: 'good' | 'warn' | 'bad', b: 'good' | 'warn' | 'bad') => (RANK[b] > RANK[a] ? b : a);
