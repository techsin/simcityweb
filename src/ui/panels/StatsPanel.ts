/** City statistics: population, jobs, utilities supply vs demand, quotients, commute & trips by mode. */
import { DevType } from '../../core/types';
import type { GameContext } from '../../game/context';
import { Panel } from '../Panel';
import { h, setText } from '../dom';
import { icon } from '../icons';
import { compact, num, pct } from '../format';

function sum(a: number[] | undefined, i0: number, i1: number): number {
  let s = 0;
  if (a) for (let i = i0; i <= i1; i++) s += a[i] ?? 0;
  return s;
}

export class StatsPanel extends Panel {
  readonly id = 'stats';
  readonly title = 'City statistics';
  override icon = 'stats';
  override width = 500;
  private cards: Record<string, { v: HTMLElement; s: HTMLElement }> = {};
  private meters: Record<string, { bar: HTMLElement; fill: HTMLElement; v: HTMLElement }> = {};
  private modes!: HTMLElement;
  private modesLegend!: HTMLElement;
  private wealth!: HTMLElement;
  private wealthLegend!: HTMLElement;

  protected build(): void {
    const card = (id: string, label: string, ic: string) => {
      const v = h('div', { class: 'sc-v' }), s = h('div', { class: 'sc-s' });
      this.cards[id] = { v, s };
      return h('div', { class: 'stat-card' }, h('div', { class: 'sc-l', html: icon(ic, 13) + `<span>${label}</span>` }), v, s);
    };
    const meter = (id: string, label: string, ic: string) => {
      const fill = h('div', { class: 'fill' });
      const bar = h('div', { class: 'bar' }, fill);
      const v = h('div', { class: 'mr-v' });
      this.meters[id] = { bar, fill, v };
      return h('div', { class: 'meter-row' }, h('div', { class: 'mr-l', html: icon(ic, 15) + `<span>${label}</span>` }), bar, v);
    };
    this.modes = h('div', { class: 'bar', style: 'height:10px;display:flex;gap:2px;background:transparent' });
    this.modesLegend = h('div', { class: 'graph-legend', style: 'margin-top:8px' });
    this.wealth = h('div', { class: 'bar', style: 'height:10px;display:flex;gap:2px;background:transparent' });
    this.wealthLegend = h('div', { class: 'graph-legend', style: 'margin-top:8px' });
    this.body.append(
      h('div', { class: 'stat-cards' }, card('pop', 'Population', 'people'), card('jobs', 'Jobs', 'briefcase'), card('unemp', 'Unemployment', 'people'), card('bld', 'Buildings', 'resHigh')),
      h('div', { class: 'sec-title' }, 'Residents by wealth'),
      this.wealth, this.wealthLegend,
      h('div', { class: 'sec-title' }, 'Utilities — demand vs supply'),
      meter('power', 'Power', 'power'), meter('water', 'Water', 'water'), meter('garbage', 'Garbage', 'garbage'),
      h('div', { class: 'sec-title' }, 'Quality of life'),
      meter('eq', 'Education', 'education'), meter('hq', 'Health', 'health'), meter('lv', 'Land value', 'landValue'),
      meter('crime', 'Crime', 'crime'), meter('poll', 'Pollution', 'smog'), meter('traffic', 'Congestion', 'car'),
      h('div', { class: 'sec-title' }, 'Commute'),
      h('div', { class: 'stat-cards', style: 'margin-bottom:10px' }, card('commute', 'Avg. commute', 'clock'), card('trips', 'Trips / day', 'car')),
      this.modes, this.modesLegend,
    );
  }

  private setMeter(id: string, frac: number, text: string, cls: 'good' | 'warn' | 'bad' | '' = ''): void {
    const m = this.meters[id];
    m.fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    m.bar.className = 'bar ' + cls;
    setText(m.v, text);
  }

  private stack(el: HTMLElement, legend: HTMLElement, parts: { label: string; v: number; color: string }[]): void {
    const total = parts.reduce((s, p) => s + p.v, 0);
    el.innerHTML = '';
    legend.innerHTML = '';
    if (!total) {
      el.appendChild(h('div', { style: 'flex:1;border-radius:4px;background:rgba(255,255,255,.08)' }));
      legend.appendChild(h('span', { class: 'faint' }, 'No data yet'));
      return;
    }
    for (const p of parts) {
      if (p.v > 0) el.appendChild(h('div', { style: { flex: String(p.v / total), background: p.color, borderRadius: '4px', minWidth: '3px' } }));
      legend.appendChild(h('span', null, h('i', { style: { background: p.color, height: '8px', width: '8px' } }), `${p.label} ${Math.round((p.v / total) * 100)}%`));
    }
  }

  override update(): void {
    const s = this.ctx.state.stats;
    const c = this.cards;
    setText(c.pop.v, num(s.population));
    setText(c.pop.s, `${compact(s.workforce)} workforce`);
    const jobs = sum(s.jobsByDev, DevType.CS1, DevType.IHT);
    const cap = sum(s.jobCapByDev, DevType.CS1, DevType.IHT);
    setText(c.jobs.v, compact(jobs));
    setText(c.jobs.s, `of ${compact(cap)} available`);
    setText(c.unemp.v, pct(s.unemployment, 1));
    c.unemp.v.className = 'sc-v ' + (s.unemployment > 0.12 ? 'neg' : s.unemployment > 0.07 ? 'warn' : 'pos');
    setText(c.unemp.s, `${compact(s.employed)} employed`);
    setText(c.bld.v, num(s.buildingCount || this.ctx.state.buildings.size));
    setText(c.bld.s, `${num(this.ctx.state.buildings.size)} structures`);

    const util = (id: string, dem: number, sup: number, unit: string) => {
      const frac = sup > 0 ? dem / sup : dem > 0 ? 1 : 0;
      this.setMeter(id, frac, `${compact(dem)} / ${compact(sup)} ${unit}`, frac > 1 ? 'bad' : frac > 0.85 ? 'warn' : 'good');
    };
    util('power', s.powerDemand, s.powerSupply, 'MW');
    util('water', s.waterDemand, s.waterSupply, 'kL');
    util('garbage', s.garbageProduced, s.garbageCapacity, 't');
    this.setMeter('eq', s.eq / 150, `EQ ${Math.round(s.eq)}`, s.eq >= 90 ? 'good' : s.eq >= 50 ? 'warn' : 'bad');
    this.setMeter('hq', s.hq / 150, `HQ ${Math.round(s.hq)}`, s.hq >= 90 ? 'good' : s.hq >= 50 ? 'warn' : 'bad');
    this.setMeter('lv', s.avgLandValue, pct(s.avgLandValue), s.avgLandValue > 0.5 ? 'good' : s.avgLandValue > 0.25 ? 'warn' : 'bad');
    this.setMeter('crime', s.avgCrime, pct(s.avgCrime), s.avgCrime > 0.4 ? 'bad' : s.avgCrime > 0.2 ? 'warn' : 'good');
    this.setMeter('poll', s.avgPollution, pct(s.avgPollution), s.avgPollution > 0.4 ? 'bad' : s.avgPollution > 0.2 ? 'warn' : 'good');
    this.setMeter('traffic', s.avgTraffic, pct(s.avgTraffic), s.avgTraffic > 0.7 ? 'bad' : s.avgTraffic > 0.4 ? 'warn' : 'good');
    setText(c.commute.v, s.avgCommute ? `${Math.round(s.avgCommute)} min` : '—');
    setText(c.commute.s, s.avgCommute > 45 ? 'Too long' : s.avgCommute ? 'Acceptable' : 'No commuters yet');
    const trips = s.tripsCar + s.tripsTransit + s.tripsWalk;
    setText(c.trips.v, compact(trips));
    setText(c.trips.s, 'car · transit · walk');
    this.stack(this.modes, this.modesLegend, [
      { label: 'Car', v: s.tripsCar, color: '#3987e5' },
      { label: 'Transit', v: s.tripsTransit, color: '#d95926' },
      { label: 'Walk', v: s.tripsWalk, color: '#199e70' },
    ]);
    const r = s.residents ?? [0, 0, 0];
    this.stack(this.wealth, this.wealthLegend, [
      { label: 'R$', v: r[0], color: '#86b6ef' },
      { label: 'R$$', v: r[1], color: '#3987e5' },
      { label: 'R$$$', v: r[2], color: '#1c5cab' },
    ]);
  }
}
