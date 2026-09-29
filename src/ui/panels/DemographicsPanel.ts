/**
 * Demographics panel (SIM_DEPTH_SPEC §F): who lives in the city and how well they are served.
 *   People    KPIs (population, workforce, EQ, HQ, attractiveness), the age pyramid stacked by wealth
 *             (stats.cohortsByWealth), trend sparklines from history
 *   Services  per need tier: need vs capacity vs served, the unreached with "Show me" (unservedClusters[0]); health
 *             (patients vs beds, seniors), recreation (play / green); police as patrol load
 *   Tourism   tourists, hotel rooms, attractiveness factors, the top venues (visits / capacity)
 */
import '../insight.css';
import type { GameContext } from '../../game/context';
import type { HistorySeries, NeedStat, NeedTier } from '../../sim/CityState';
import { getDef } from '../../sim/catalog';
import { unservedClusters } from '../../sim/infra/catchments';
import { attractivenessBreakdown, tourismSummary } from '../../sim/economy/tourism';
import { Panel } from '../Panel';
import { clear, h, toggleClass } from '../dom';
import { icon } from '../icons';
import { compact, num, pct } from '../format';
import { termBars } from '../inspectorModel';

type Tab = 'people' | 'services' | 'tourism';

const COHORTS = ['Children 0–11', 'Teens 12–17', 'Young adults 18–24', 'Adults 25–64', 'Seniors 65+'];
const WEALTH_COLORS = ['#86b6ef', '#3987e5', '#1c4fb0'];

interface TierRow {
  tier: NeedTier;
  label: string;
  unit: string;
  icon: string;
  /** units per shown unit (hospital beds: patient-equivalents per bed) */
  hint: string;
}
const TIERS: TierRow[] = [
  { tier: 'elementary', label: 'Elementary', unit: 'pupils', icon: 'education', hint: 'Children 0–11 and elementary school seats within walking distance' },
  { tier: 'high', label: 'High school', unit: 'students', icon: 'education', hint: 'Teens 12–17 and high school seats within reach' },
  { tier: 'college', label: 'University', unit: 'students', icon: 'education', hint: 'Young adults (and adult learners) and college / library places' },
  { tier: 'health', label: 'Health care', unit: 'patients', icon: 'health', hint: 'Patient-equivalents (seniors need ~4× the care) and clinic / hospital places' },
  { tier: 'play', label: 'Play & sports', unit: 'kids', icon: 'park', hint: 'Children and teens and the playground / sports capacity within reach' },
  { tier: 'green', label: 'Parks & gardens', unit: 'visitors', icon: 'trees', hint: 'Residents and the park space within a walk' },
  { tier: 'police', label: 'Police', unit: 'patrol load', icon: 'police', hint: 'Patrol load (crime-weighted residents and jobs) and the stations’ patrol capacity' },
];

function spark(values: number[], color: string, w = 96, hgt = 26): SVGSVGElement | HTMLElement {
  const n = values.length;
  if (n < 2) return h('span', { class: 'faint', style: 'font-size:10.5px' }, '—');
  let lo = Infinity, hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < 1e-9) { hi = lo + 1; }
  const pts = values.map((v, i) => `${((i / (n - 1)) * (w - 2) + 1).toFixed(1)},${(hgt - 2 - ((v - lo) / (hi - lo)) * (hgt - 4)).toFixed(1)}`).join(' ');
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(hgt));
  svg.setAttribute('class', 'spark');
  const pl = document.createElementNS(ns, 'polyline');
  pl.setAttribute('points', pts);
  pl.setAttribute('fill', 'none');
  pl.setAttribute('stroke', color);
  pl.setAttribute('stroke-width', '1.6');
  pl.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(pl);
  return svg;
}

export class DemographicsPanel extends Panel {
  readonly id = 'demographics';
  readonly title = 'Demographics';
  override icon = 'people';
  override width = 560;
  override center = true;
  private tab: Tab = 'people';
  private tabBtns: Record<string, HTMLButtonElement> = {};
  private content!: HTMLDivElement;
  private sig = '';

  override defaultPos(w: number, hh: number): { x: number; y: number } {
    return { x: Math.max(14, (w - this.width) / 2), y: Math.max(72, (hh - 560) / 2) };
  }

  protected build(): void {
    const tabs = h('div', { class: 'tabs' });
    for (const [id, label] of [['people', 'People'], ['services', 'Schools & services'], ['tourism', 'Tourism']] as const) {
      const b = h('button', null, label) as HTMLButtonElement;
      b.addEventListener('click', () => {
        this.tab = id;
        this.sig = '';
        this.update();
      });
      this.tabBtns[id] = b;
      tabs.appendChild(b);
    }
    this.el.insertBefore(tabs, this.body);
    this.content = h('div', { class: 'demo-panel' });
    this.body.appendChild(this.content);
  }

  override onOpen(): void {
    this.sig = '';
  }

  override update(): void {
    const st = this.ctx.state;
    for (const [id, b] of Object.entries(this.tabBtns)) toggleClass(b, 'on', id === this.tab);
    const sig = `${this.tab}:${st.monthIndex}:${Math.floor(st.day / 10)}:${Math.round(st.stats.population / 25)}`;
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.content);
    if (this.tab === 'people') this.people();
    else if (this.tab === 'services') this.services();
    else this.tourism();
  }

  private card(label: string, ic: string, value: string, sub: string, cls = ''): HTMLElement {
    return h('div', { class: 'stat-card' }, h('div', { class: 'sc-l', html: icon(ic, 13) + `<span>${label}</span>` }), h('div', { class: 'sc-v ' + cls }, value), h('div', { class: 'sc-s' }, sub));
  }

  private history(key: Exclude<keyof HistorySeries, 't'>, months = 60): number[] {
    const a = this.ctx.state.history[key] ?? [];
    return a.slice(Math.max(0, a.length - months));
  }

  // ------------------------------------------------------------------------------------------------ people
  private people(): void {
    const st = this.ctx.state;
    const s = st.stats;
    const pop = s.population;
    const wf = s.workforce > 0 ? s.workforce : pop * (s.workforceRatio || 0.55);
    this.content.append(h('div', { class: 'stat-cards demo-kpis' },
      this.card('Population', 'people', num(pop), `${compact(s.residents?.[2] ?? 0)} wealthy · ${compact(s.residents?.[0] ?? 0)} low-wealth`),
      this.card('Workforce', 'briefcase', compact(wf), `${pct(pop > 0 ? wf / pop : s.workforceRatio)} of residents · ${pct(s.unemployment, 1)} jobless`, s.unemployment > 0.12 ? 'neg' : ''),
      this.card('Education', 'education', `EQ ${Math.round(s.eq)}`, s.eq >= 100 ? 'Educated workforce' : s.eq >= 60 ? 'Improving' : 'Needs schools', s.eq >= 90 ? 'pos' : s.eq < 50 ? 'neg' : 'warn'),
      this.card('Health', 'health', `HQ ${Math.round(s.hq)}`, s.hq >= 100 ? 'Long, healthy lives' : s.hq >= 60 ? 'Fair' : 'Needs care', s.hq >= 90 ? 'pos' : s.hq < 50 ? 'neg' : 'warn'),
      this.card('Attraction', 'star', `${Math.round(s.attractiveness)}`, 'out of 100 · draws newcomers', s.attractiveness >= 60 ? 'pos' : s.attractiveness < 30 ? 'neg' : ''),
    ));
    // ---- pyramid by wealth
    this.content.appendChild(h('div', { class: 'sec-title' }, 'Age groups by wealth'));
    const cbw = s.cohortsByWealth ?? [];
    const co = s.cohorts ?? [0, 0, 0, 0, 0];
    const tot = co.reduce((a, b) => a + b, 0);
    if (tot <= 0) this.content.appendChild(h('div', { class: 'empty' }, 'Nobody lives here yet.'));
    else {
      const maxRow = Math.max(1, ...co);
      const pyr = h('div', { class: 'demo-pyr' });
      for (let c = 4; c >= 0; c--) {
        const bar = h('div', { class: 'dp-bar' });
        for (let w = 0; w < 3; w++) {
          const v = cbw[w * 5 + c] ?? 0;
          if (v > 0) bar.appendChild(h('i', { style: { width: `${(v / maxRow) * 100}%`, background: WEALTH_COLORS[w] }, title: `${['R$', 'R$$', 'R$$$'][w]}: ${num(v)}` }));
        }
        pyr.appendChild(h('div', { class: 'dp-row' }, h('span', { class: 'dp-l' }, COHORTS[c]), bar, h('span', { class: 'dp-v' }, `${compact(co[c])} · ${pct(co[c] / tot)}`)));
      }
      this.content.appendChild(pyr);
      this.content.appendChild(h('div', { class: 'graph-legend', style: 'margin-top:6px' }, ...['Low wealth (R$)', 'Medium (R$$)', 'High (R$$$)'].map((l, w) => h('span', null, h('i', { style: { background: WEALTH_COLORS[w], height: '8px', width: '8px' } }), l))));
    }
    // ---- trends
    this.content.appendChild(h('div', { class: 'sec-title' }, 'Last 5 years'));
    const grid = h('div', { class: 'demo-trends' });
    const tr = (label: string, key: Exclude<keyof HistorySeries, 't'>, color: string, fmt: (v: number) => string) => {
      const vals = this.history(key);
      grid.appendChild(h('div', { class: 'dt' }, h('div', { class: 'dt-l' }, label), spark(vals, color), h('div', { class: 'dt-v' }, vals.length ? fmt(vals[vals.length - 1]) : '—')));
    };
    tr('Population', 'pop', '#3987e5', (v) => compact(v));
    tr('Children', 'kids', '#9a7ae0', (v) => compact(v));
    tr('Seniors', 'seniors', '#d95a8a', (v) => compact(v));
    tr('Unemployment', 'unemployment', '#d95926', (v) => pct(v, 1));
    tr('EQ', 'eq', '#8a52d6', (v) => String(Math.round(v)));
    tr('HQ', 'hq', '#d6457e', (v) => String(Math.round(v)));
    this.content.appendChild(grid);
  }

  // ------------------------------------------------------------------------------------------------ services
  private services(): void {
    const st = this.ctx.state;
    const nd = st.stats.needs;
    if (!nd) {
      this.content.appendChild(h('div', { class: 'empty' }, 'No service data yet.'));
      return;
    }
    const table = h('div', { class: 'demo-tiers' });
    for (const t of TIERS) {
      const n: NeedStat | undefined = nd[t.tier];
      if (!n) continue;
      table.appendChild(this.tierRow(t, n));
    }
    this.content.append(
      h('div', { class: 'dim', style: 'font-size:11.5px;margin-bottom:8px' }, 'Who needs each service, how many places the city has, and who is served. Unreached = no facility within reach at all.'),
      table,
    );
    this.content.appendChild(h('div', { class: 'sec-title' }, 'Served, last 5 years'));
    const grid = h('div', { class: 'demo-trends' });
    const tr = (label: string, key: Exclude<keyof HistorySeries, 't'>, color: string) => {
      const vals = this.history(key);
      grid.appendChild(h('div', { class: 'dt' }, h('div', { class: 'dt-l' }, label), spark(vals, color), h('div', { class: 'dt-v' }, vals.length ? pct(vals[vals.length - 1]) : '—')));
    };
    tr('Elementary', 'enrolElem', '#8a52d6');
    tr('High school', 'enrolHigh', '#6a7ae0');
    tr('University', 'enrolCollege', '#3987e5');
    tr('Health care', 'healthServed', '#d6457e');
    this.content.appendChild(grid);
  }

  private tierRow(t: TierRow, n: NeedStat): HTMLElement {
    const need = Math.max(0, n.need), served = Math.max(0, Math.min(need, n.served)), unreached = Math.max(0, Math.min(need - served, n.unreached));
    const reachedUnserved = Math.max(0, need - served - unreached);
    const capFree = !(n.capacity > 0) || !Number.isFinite(n.capacity);
    const share = need > 0 ? served / need : 1;
    const bar = h('div', { class: 'dtier-bar', title: t.hint });
    if (need > 0) {
      bar.append(
        h('i', { class: 's', style: { width: `${(served / need) * 100}%` } }),
        h('i', { class: 'u', style: { width: `${(reachedUnserved / need) * 100}%` } }),
        h('i', { class: 'x', style: { width: `${(unreached / need) * 100}%` } }),
      );
      if (!capFree) bar.appendChild(h('span', { class: 'cap', style: { left: `${Math.min(100, (n.capacity / need) * 100)}%` }, title: `Capacity ${num(n.capacity)}` }));
    }
    const unit = t.tier === 'police' ? t.unit : t.unit;
    const nums = need > 0
      ? `${compact(served)} of ${compact(need)} ${unit}${capFree ? '' : ` · capacity ${compact(n.capacity)}`}`
      : `No ${unit} yet`;
    const show = unreached >= Math.max(10, 0.02 * need)
      ? h('button', { class: 'btn sm ghost dtier-go', title: 'Show the biggest unserved area on the map', html: icon('target', 13) + '<span>Show me</span>' })
      : null;
    show?.addEventListener('click', () => {
      const c = unservedClusters(this.ctx.sim, t.tier, 1)[0];
      if (c) this.ctx.focusCell(Math.round(c.x), Math.round(c.z), 480);
      else this.ctx.toast('No unserved cluster found right now', 'info');
    });
    const tone = need <= 0 ? '' : share >= 0.85 ? 'pos' : share >= 0.6 ? 'warn' : 'neg';
    return h('div', { class: 'dtier' },
      h('div', { class: 'dtier-h' },
        h('span', { class: 'ico-wrap', html: icon(t.icon, 14) }),
        h('b', null, t.label),
        h('span', { class: 'dtier-p ' + tone }, need > 0 ? pct(share) : '—'),
        show ?? h('span'),
      ),
      bar,
      h('div', { class: 'dtier-n' }, nums, unreached > 0 ? h('span', { class: 'neg' }, ` · ${compact(unreached)} unreached`) : null, n.overcrowded > 0 ? h('span', { class: 'warn' }, ` · ${n.overcrowded} overcrowded`) : null),
    );
  }

  // ------------------------------------------------------------------------------------------------ tourism
  private tourism(): void {
    const st = this.ctx.state;
    const s = st.stats;
    const ts = tourismSummary(st);
    this.content.append(h('div', { class: 'stat-cards demo-kpis' },
      this.card('Tourists', 'star', compact(s.tourists), ts ? `${compact(ts.gross)} would come` : 'per day'),
      this.card('Hotel rooms', 'home', compact(s.hotelRooms), ts && ts.hotelShortage > 0 ? `${compact(ts.hotelShortage)} short a night` : 'enough for now', ts && ts.hotelShortage > 50 ? 'warn' : ''),
      this.card('Attraction', 'smile', String(Math.round(s.attractiveness)), 'out of 100'),
    ));
    const bars = termBars(attractivenessBreakdown(st), 8, 1);
    if (bars.length) {
      this.content.appendChild(h('div', { class: 'sec-title' }, 'What makes the city attractive'));
      const max = Math.max(1, ...bars.map((b) => Math.abs(b.value)));
      const box = h('div', { class: 'ins-bars' });
      for (const b of bars) {
        const a = Math.min(1, Math.abs(b.value) / max);
        box.appendChild(h('div', { class: 'ins-bar', title: b.detail ?? '' },
          h('span', { class: 'l' }, b.label),
          h('span', { class: 't' }, h('i', { class: b.value >= 0 ? 'p' : 'n', style: { width: `${a * 50}%`, left: b.value >= 0 ? '50%' : `${50 - a * 50}%` } }), h('b')),
          h('span', { class: 'v ' + (b.value >= 0 ? 'pos' : 'neg') }, `${b.value >= 0 ? '+' : '−'}${Math.abs(b.value).toFixed(1)}`)));
      }
      this.content.appendChild(box);
    }
    this.content.appendChild(h('div', { class: 'sec-title' }, 'Top attractions'));
    const top = ts?.topVenues ?? [];
    if (!top.length) {
      this.content.appendChild(h('div', { class: 'empty' }, 'No attractions yet — parks, landmarks, stadiums and beaches draw visitors.'));
      return;
    }
    const list = h('div', { class: 'demo-venues' });
    for (const v of top) {
      const def = getDef(v.def);
      const b = st.buildings.get(v.buildingId);
      const u = v.capacity > 0 ? v.visits / v.capacity : 0;
      const row = h('div', { class: 'dv-row' + (b ? ' go' : '') },
        h('span', { class: 'dvn' }, def?.name ?? v.def),
        h('span', { class: 'bar ' + (u > 0.95 ? 'warn' : 'good') }, h('span', { class: 'fill', style: { width: `${Math.min(100, u * 100)}%` } })),
        h('span', { class: 'dvv' }, `${compact(v.visits)} / ${compact(v.capacity)}`),
      );
      if (b) row.addEventListener('click', () => this.ctx.focusCell(b.x + (b.w >> 1), b.z + (b.d >> 1), 420));
      list.appendChild(row);
    }
    this.content.appendChild(list);
  }
}
