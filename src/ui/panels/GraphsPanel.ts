/**
 * Graphs: canvas line (or stacked area) charts from state.history with time ranges, legend and crosshair tooltip.
 * SIM_DEPTH_SPEC §F / WP5-3 graphs read the history series of economy/history.ts (the same definitions the stats panel
 * shows): demographics (stacked), enrolment, utility margins, garbage load, environment, tourism, attractiveness,
 * jobs, commute, emergencies and transit. The RCI graph shows demand as a signed percentage (signedPct).
 */
import '../insight.css';
import type { HistorySeries } from '../../sim/CityState';
import type { GameContext } from '../../game/context';
import { Panel } from '../Panel';
import { clear, h, segmented, toggleClass } from '../dom';
import { icon } from '../icons';
import { compact, moneyCompact, monthLabel, num, pct, signedPct } from '../format';
import { niceAxis, niceStep } from '../graphAxis';
import { uiZoom } from '../zoom';

type Key = Exclude<keyof HistorySeries, 't'>;
export interface GraphDef {
  id: string;
  label: string;
  icon: string;
  /** list group (section header in the graph list) */
  group: string;
  series: { key: Key; label: string; color: string; fmt?: (v: number) => string }[];
  fmt: (v: number) => string;
  /** fixed y range (else auto from 0) */
  range?: [number, number];
  unit?: string;
  /** stacked areas (series add up, e.g. age groups) */
  stacked?: boolean;
  /** higher is better (title trend colour; default true) */
  goodUp?: boolean;
  /** counts / money: the y-axis ticks on whole numbers (graphAxis.niceAxis) */
  int?: boolean;
}

// Dark-surface categorical steps (dataviz reference palette): blue, orange, aqua, purple, rose. R/C/I keep the game's
// zone colors.
const BLUE = '#3987e5', ORANGE = '#d95926', AQUA = '#199e70', PURPLE = '#9a6ae0', ROSE = '#d6457e', SAND = '#c9a23a';
const pct01 = (v: number) => pct(v);
const mins = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} min`;

export const GRAPHS: GraphDef[] = [
  { id: 'pop', group: 'City', label: 'Population', icon: 'people', series: [{ key: 'pop', label: 'Population', color: BLUE }], fmt: (v) => compact(v), int: true },
  // demand is stored as -1..1: a signed percentage (compact() showed 0 / ±1 only)
  { id: 'rci', group: 'City', label: 'R · C · I', icon: 'zones', series: [{ key: 'r', label: 'Residential', color: '#3cc76a' }, { key: 'c', label: 'Commercial', color: '#3d8bff' }, { key: 'i', label: 'Industrial', color: '#f0b429' }], fmt: (v) => signedPct(v), range: [-1, 1] },
  { id: 'approval', group: 'City', label: 'Approval', icon: 'smile', series: [{ key: 'approval', label: 'Mayor approval', color: AQUA }], fmt: (v) => Math.round(v) + '%', range: [0, 100] },
  { id: 'funds', group: 'Money', label: 'Treasury', icon: 'money', series: [{ key: 'funds', label: 'Funds', color: BLUE }], fmt: (v) => moneyCompact(v), int: true },
  { id: 'cash', group: 'Money', label: 'Income vs expenses', icon: 'budget', series: [{ key: 'income', label: 'Income', color: BLUE }, { key: 'expense', label: 'Expenses', color: ORANGE }], fmt: (v) => moneyCompact(v), int: true },
  { id: 'lv', group: 'Money', label: 'Land value', icon: 'landValue', series: [{ key: 'landValue', label: 'Avg. land value', color: BLUE }], fmt: pct01, range: [0, 1] },
  { id: 'demo', group: 'People', label: 'Age groups', icon: 'people', stacked: true, fmt: (v) => compact(v), int: true, series: [
    { key: 'kids', label: 'Children', color: PURPLE }, { key: 'teens', label: 'Teens', color: BLUE }, { key: 'youngAdults', label: 'Young adults', color: AQUA },
    { key: 'adults', label: 'Adults', color: SAND }, { key: 'seniors', label: 'Seniors', color: ROSE }] },
  { id: 'jobs', group: 'People', label: 'Unemployment', icon: 'briefcase', series: [{ key: 'unemployment', label: 'Unemployment', color: ORANGE }], fmt: (v) => pct(v, 1), goodUp: false },
  { id: 'commute', group: 'People', label: 'Commute', icon: 'clock', series: [{ key: 'commute', label: 'Avg. commute', color: BLUE }], fmt: mins, goodUp: false },
  { id: 'eqhq', group: 'People', label: 'Education & health', icon: 'education', series: [{ key: 'eq', label: 'EQ', color: BLUE }, { key: 'hq', label: 'HQ', color: ORANGE }], fmt: (v) => num(v), range: [0, 150] },
  { id: 'enrol', group: 'Services', label: 'Enrolment', icon: 'education', fmt: pct01, range: [0, 1], series: [
    { key: 'enrolElem', label: 'Elementary', color: PURPLE }, { key: 'enrolHigh', label: 'High school', color: BLUE }, { key: 'enrolCollege', label: 'University', color: AQUA },
    { key: 'healthServed', label: 'Health care', color: ROSE }] },
  // (counts and minutes on separate axes: a ~1 min response and 0-2 deaths flattened against 5-15 incidents)
  { id: 'emergencies', group: 'Services', label: 'Emergencies', icon: 'siren', fmt: (v) => num(v), goodUp: false, int: true, series: [
    { key: 'incidents', label: 'Incidents / month', color: ORANGE, fmt: (v) => num(v) }, { key: 'emergencyDeaths', label: 'Deaths / month', color: ROSE, fmt: (v) => num(v) }] },
  { id: 'response', group: 'Services', label: 'Response time', icon: 'clock', fmt: mins, goodUp: false, series: [
    { key: 'responseMin', label: 'Avg. response (min)', color: BLUE, fmt: mins }] },
  { id: 'crime', group: 'Services', label: 'Crime & prison', icon: 'crime', fmt: pct01, range: [0, 1.5], goodUp: false, series: [
    { key: 'crime', label: 'Avg. crime', color: BLUE }, { key: 'jailOccupancy', label: 'Prison occupancy', color: ORANGE }] },
  // (a 0-1 load and a count on one axis read "0" at every tick): one graph each
  { id: 'busLoad', group: 'Services', label: 'Bus load', icon: 'bus', fmt: pct01, goodUp: false, series: [
    { key: 'busLoad', label: 'Buses needed / buses running', color: ORANGE, fmt: pct01 }] },
  { id: 'parkRide', group: 'Services', label: 'Park & ride', icon: 'parking', fmt: (v) => compact(v), int: true, series: [
    { key: 'parkRide', label: 'Park & ride trips / day', color: AQUA, fmt: (v) => compact(v) }] },
  { id: 'traffic', group: 'Services', label: 'Traffic', icon: 'car', series: [{ key: 'traffic', label: 'Avg. congestion', color: BLUE }], fmt: pct01, range: [0, 1], goodUp: false },
  { id: 'margins', group: 'Utilities', label: 'Power & water margin', icon: 'power', fmt: (v) => signedPct(v), range: [-1, 1], series: [
    { key: 'powerMargin', label: 'Power spare', color: SAND }, { key: 'waterMargin', label: 'Water spare', color: BLUE }] },
  { id: 'garbage', group: 'Utilities', label: 'Garbage load', icon: 'garbage', series: [{ key: 'garbageLoad', label: 'Garbage made / capacity', color: ORANGE }], fmt: pct01, goodUp: false },
  { id: 'pollution', group: 'Environment', label: 'Pollution', icon: 'smog', fmt: pct01, range: [0, 1], goodUp: false, series: [
    { key: 'air', label: 'Air (at homes)', color: SAND }, { key: 'waterPoll', label: 'Water', color: BLUE }, { key: 'noise', label: 'Noise', color: ROSE }] },
  { id: 'tourism', group: 'Environment', label: 'Tourists', icon: 'star', series: [{ key: 'tourists', label: 'Tourists / day', color: ROSE }], fmt: (v) => compact(v), int: true },
  { id: 'attract', group: 'Environment', label: 'Attractiveness', icon: 'smile', series: [{ key: 'attractiveness', label: 'Attractiveness', color: AQUA }], fmt: (v) => String(Math.round(v)), range: [0, 100] },
];

export class GraphsPanel extends Panel {
  readonly id = 'graphs';
  readonly title = 'Graphs';
  override icon = 'graphs';
  override width = 760;
  override center = true;
  private cur = GRAPHS[0];
  private range = 60;
  private canvas!: HTMLCanvasElement;
  private hover!: HTMLDivElement;
  private titleH!: HTMLElement;
  private legend!: HTMLElement;
  private listBtns = new Map<string, HTMLButtonElement>();
  private hoverX: number | null = null;
  private lastLen = -1;
  private geom: { x0: number; x1: number; y0: number; y1: number; n: number; start: number } | null = null;

  override defaultPos(w: number, hh: number): { x: number; y: number } {
    return { x: Math.max(14, (w - this.width) / 2), y: Math.max(72, (hh - 420) / 2 - 40) };
  }

  protected build(): void {
    const list = h('div', { class: 'graph-list' });
    let group = '';
    for (const g of GRAPHS) {
      if (g.group !== group) {
        group = g.group;
        list.appendChild(h('div', { class: 'graph-group' }, group));
      }
      const b = h('button', { html: icon(g.icon, 15) + `<span>${g.label}</span>` }) as HTMLButtonElement;
      b.addEventListener('click', () => {
        this.cur = g;
        this.draw();
        b.blur();
      });
      this.listBtns.set(g.id, b);
      list.appendChild(b);
    }
    this.titleH = h('h4');
    const seg = segmented<number>([{ value: 12, label: '1Y' }, { value: 60, label: '5Y' }, { value: 120, label: '10Y' }, { value: 0, label: 'All' }], this.range, (v) => {
      this.range = v;
      this.draw();
    });
    this.legend = h('div', { class: 'graph-legend' });
    this.canvas = h('canvas');
    this.hover = h('div', { class: 'graph-hover mp-glass' });
    const cw = h('div', { class: 'graph-canvas-wrap' }, this.canvas, this.hover);
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hoverX = ((e.clientX - r.left) / r.width) * this.canvas.clientWidth;
      this.draw();
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hoverX = null;
      this.draw();
    });
    this.body.appendChild(h('div', { class: 'graph-wrap' }, list, h('div', null, h('div', { class: 'graph-top' }, this.titleH, seg), this.legend, cw)));
  }

  override onOpen(): void {
    requestAnimationFrame(() => this.draw());
  }

  override update(): void {
    const n = this.ctx.state.history.t.length;
    if (n !== this.lastLen) this.draw();
  }

  draw(): void {
    const st = this.ctx.state;
    const H = st.history;
    this.lastLen = H.t.length;
    for (const [id, b] of this.listBtns) toggleClass(b, 'on', id === this.cur.id);
    this.titleH.textContent = this.cur.label;
    if (this.cur.series.length === 1 && H.t.length) {
      const arr = H[this.cur.series[0].key];
      const lastV = arr[arr.length - 1] ?? 0;
      const s0 = this.range && H.t.length > this.range ? H.t.length - this.range : 0;
      const firstV = arr[s0] ?? 0;
      const d = lastV - firstV;
      const v = h('span', { class: 'gt-v' }, this.cur.fmt(lastV));
      this.titleH.appendChild(v);
      const goodUp = this.cur.goodUp ?? true;
      if (H.t.length > 1 && Math.abs(d) > 1e-9) this.titleH.appendChild(h('span', { class: 'gt-d ' + ((d > 0) === goodUp ? 'pos' : 'neg') }, `${d > 0 ? '▲' : '▼'} ${this.cur.fmt(Math.abs(d))}`));
    }
    clear(this.legend);
    if (this.cur.series.length > 1) {
      for (const s of this.cur.series) {
        const arr = H[s.key];
        const last = arr && arr.length ? arr[arr.length - 1] : undefined;
        this.legend.appendChild(h('span', null, h('i', { style: { background: s.color } }), s.label, last !== undefined ? h('b', { class: 'gl-v' }, (s.fmt ?? this.cur.fmt)(last)) : null));
      }
    }

    const cssW = this.canvas.clientWidth || 540, cssH = this.canvas.clientHeight || 280;
    const dpr = Math.min(3, (window.devicePixelRatio || 1) * uiZoom());
    if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    const g = this.canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    const total = H.t.length;
    const start = this.range && total > this.range ? total - this.range : 0;
    const n = total - start;
    const pad = { l: 52, r: 12, t: 10, b: 26 };
    const x0 = pad.l, x1 = cssW - pad.r, y0 = pad.t, y1 = cssH - pad.b;
    g.font = '600 10.5px Inter, system-ui, sans-serif';
    if (n < 2) {
      g.fillStyle = '#66727f';
      g.textAlign = 'center';
      g.fillText(n === 1 ? 'Collecting data — check back next month' : 'No history yet — graphs fill in month by month', cssW / 2, cssH / 2);
      this.hover.style.display = 'none';
      this.geom = null;
      return;
    }
    // y range
    let lo = 0, hi = 0, step = 1;
    if (this.cur.range) {
      [lo, hi] = this.cur.range;
      step = niceStep(hi - lo, 4);
    } else {
      lo = Infinity;
      hi = -Infinity;
      if (this.cur.stacked) {
        for (let i = start; i < total; i++) {
          let sum = 0;
          for (const s of this.cur.series) sum += H[s.key]?.[i] ?? 0;
          if (sum > hi) hi = sum;
        }
        lo = 0;
      } else {
        for (const s of this.cur.series) {
          const arr = H[s.key];
          for (let i = start; i < total; i++) {
            const v = arr[i] ?? 0;
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
      }
      // (counts tick on whole numbers: an all-zero series read "1 1 1 0 0 0")
      ({ lo, hi, step } = niceAxis(lo, hi, !!this.cur.int, 4));
    }
    const X = (i: number) => x0 + ((i - start) / (n - 1)) * (x1 - x0);
    const Y = (v: number) => y1 - ((v - lo) / (hi - lo || 1)) * (y1 - y0);
    // grid (recessive hairlines) + y labels
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (let v = lo; v <= hi + step * 0.001; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      g.strokeStyle = v === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.fillStyle = '#898781';
      g.fillText(this.cur.fmt(v), x0 - 8, y);
    }
    // x labels
    g.textAlign = 'center';
    g.textBaseline = 'top';
    const labelEvery = Math.max(1, Math.ceil(n / 6));
    for (let i = start; i < total; i += labelEvery) {
      g.fillStyle = '#898781';
      g.fillText(monthLabel(H.t[i], st.config.startYear), X(i), y1 + 8);
    }
    // series
    const single = this.cur.series.length === 1;
    if (this.cur.stacked) {
      // stacked areas: each band from the running sum below it to the sum including it
      const base = new Float64Array(total);
      for (const s of this.cur.series) {
        const arr = H[s.key];
        g.beginPath();
        for (let i = start; i < total; i++) {
          const y = Y(base[i] + (arr[i] ?? 0));
          if (i === start) g.moveTo(X(i), y);
          else g.lineTo(X(i), y);
        }
        for (let i = total - 1; i >= start; i--) g.lineTo(X(i), Y(base[i]));
        g.closePath();
        g.fillStyle = s.color + 'b0';
        g.fill();
        g.strokeStyle = s.color;
        g.lineWidth = 1.2;
        g.beginPath();
        for (let i = start; i < total; i++) {
          const y = Y(base[i] + (arr[i] ?? 0));
          if (i === start) g.moveTo(X(i), y);
          else g.lineTo(X(i), y);
        }
        g.stroke();
        for (let i = start; i < total; i++) base[i] += arr[i] ?? 0;
      }
    }
    for (const s of this.cur.stacked ? [] : this.cur.series) {
      const arr = H[s.key];
      if (single) {
        const grad = g.createLinearGradient(0, y0, 0, y1);
        grad.addColorStop(0, s.color + '55');
        grad.addColorStop(1, s.color + '00');
        g.beginPath();
        g.moveTo(X(start), Y(Math.max(lo, 0)));
        for (let i = start; i < total; i++) g.lineTo(X(i), Y(arr[i] ?? 0));
        g.lineTo(X(total - 1), Y(Math.max(lo, 0)));
        g.closePath();
        g.fillStyle = grad;
        g.fill();
      }
      g.beginPath();
      for (let i = start; i < total; i++) {
        const x = X(i), y = Y(arr[i] ?? 0);
        if (i === start) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = s.color;
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.stroke();
      // end marker + direct label for the latest value
      const lx = X(total - 1), ly = Y(arr[total - 1] ?? 0);
      g.beginPath();
      g.arc(lx, ly, 4, 0, Math.PI * 2);
      g.fillStyle = s.color;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = '#161d26';
      g.stroke();
    }
    this.geom = { x0, x1, y0, y1, n, start };
    // hover crosshair
    if (this.hoverX !== null && this.hoverX >= x0 - 10 && this.hoverX <= x1 + 10) {
      const i = Math.max(start, Math.min(total - 1, Math.round(start + ((this.hoverX - x0) / (x1 - x0)) * (n - 1))));
      const x = Math.round(X(i)) + 0.5;
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x, y1);
      g.stroke();
      let acc = 0;
      for (const s of this.cur.series) {
        const v = H[s.key][i] ?? 0;
        acc += v;
        g.beginPath();
        g.arc(X(i), Y(this.cur.stacked ? acc : v), 4.5, 0, Math.PI * 2);
        g.fillStyle = s.color;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = '#161d26';
        g.stroke();
      }
      this.hover.innerHTML = `<div class="gh-t">${monthLabel(H.t[i], st.config.startYear, false)}</div>` + this.cur.series.map((s) => `<div class="gh-r"><span><i style="background:${s.color}"></i> ${s.label}</span><b>${(s.fmt ?? this.cur.fmt)(H[s.key][i] ?? 0)}</b></div>`).join('');
      this.hover.style.display = 'block';
      const hw = this.hover.offsetWidth;
      this.hover.style.left = (x + 12 + hw > cssW ? x - hw - 12 : x + 12) + 'px';
      this.hover.style.top = '8px';
    } else this.hover.style.display = 'none';
  }
}
