/** Query info card: building / road / lot details, flags, desirability, commute, "Make historic". */
import { DEV_TYPE_LABELS, DevType, Network, Zone, isRoad, zoneFamily } from '../../core/types';
import { BF, type Building } from '../../sim/CityState';
import { getDef } from '../../sim/catalog';
import type { GameContext, QueryTarget } from '../../game/context';
import { CATEGORY_COLORS, defIcon } from '../../game/toolCatalog';
import { NETWORK_LABELS } from '../../game/tools/NetworkTool';
import { ZONE_LABELS } from '../../game/tools/ZoneTool';
import { Panel } from '../Panel';
import { clear, escapeHtml, h } from '../dom';
import { icon } from '../icons';
import { money, num, pct, titleCase } from '../format';
import { thumbs } from '../thumbs';
import { DEV_NAMES } from '../TopBar';

const FLAG_CHIPS: [number, string, string][] = [
  [BF.Abandoned, 'Abandoned', 'bad'],
  [BF.OnFire, 'On fire!', 'bad'],
  [BF.Burnt, 'Burnt down', 'bad'],
  [BF.NoRoad, 'No road access', 'bad'],
  [BF.NoJobs, 'No jobs', 'warn'],
  [BF.Congested, 'Congested', 'warn'],
  [BF.Polluted, 'Polluted', 'warn'],
  [BF.Crime, 'High crime', 'warn'],
  [BF.NoGarbage, 'Garbage piling up', 'warn'],
  [BF.Historic, 'Historic', 'info'],
];

const DIRS = ['east', 'south', 'west', 'north'];

function devsForZone(z: Zone): DevType[] {
  const f = zoneFamily(z);
  if (f === 'R') return [DevType.R1, DevType.R2, DevType.R3];
  if (f === 'C') return z === Zone.ComLow ? [DevType.CS1, DevType.CS2, DevType.CS3] : [DevType.CS1, DevType.CS2, DevType.CS3, DevType.CO2, DevType.CO3];
  if (f === 'I') return z === Zone.IndAg ? [DevType.IA] : [DevType.ID, DevType.IM, DevType.IHT];
  return [];
}

function desirBar(v: number): HTMLElement {
  // -1..1 → centered bar
  const a = Math.min(1, Math.abs(v));
  const fill = h('div', { class: 'fill', style: { left: v >= 0 ? '50%' : `${50 - a * 50}%`, width: `${a * 50}%`, background: v >= 0 ? 'var(--good)' : 'var(--bad)' } });
  return h('div', { class: 'bar', style: 'width:110px' }, fill, h('span', { class: 'mark', style: 'left:calc(50% - 1px);opacity:.35' }));
}

export class InfoPanel extends Panel {
  readonly id = 'info';
  readonly title = 'Inspector';
  override icon = 'query';
  override width = 380;
  private target: QueryTarget | null = null;
  private sig = '';

  override defaultPos(w: number): { x: number; y: number } {
    return { x: w - this.width - 14, y: 72 };
  }

  protected build(): void {}

  show(t: QueryTarget): void {
    this.target = t;
    this.sig = '';
    this.update();
  }

  override onClose(): void {
    try {
      this.ctx.objects.setSelected(null);
    } catch {
      /* ignore */
    }
  }

  override update(): void {
    const t = this.target;
    if (!t) return;
    const st = this.ctx.state;
    const b = t.buildingId != null ? st.buildings.get(t.buildingId) : undefined;
    const sig = b ? `b${b.id}:${b.pop}:${b.jobs}:${b.flags}:${Math.round(b.built * 20)}:${st.monthIndex}:${Math.floor(st.day / 5)}` : `c${t.x},${t.z}:${st.network[st.idx(t.x, t.z)]}:${st.zone[st.idx(t.x, t.z)]}:${Math.floor(st.day / 5)}`;
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.body);
    if (t.buildingId != null && !b) {
      this.titleEl.textContent = 'Inspector';
      this.body.appendChild(h('div', { class: 'empty', html: icon('bulldoze', 26) + '<div>This building no longer exists.</div>' }));
      return;
    }
    if (b) this.renderBuilding(b);
    else this.renderCell(t.x, t.z);
  }

  private hero(title: string, sub: string, ic: string, color: string, model?: string, fp?: [number, number]): HTMLElement {
    const box = h('div', { class: 'ih-ico', style: { '--c': color } as Record<string, string>, html: icon(ic, 24) });
    if (model && fp) {
      const c = thumbs.cached(model, 120, 120);
      const put = (u: string | null) => {
        if (u) box.innerHTML = `<img src="${u}" alt="">`;
      };
      if (c) put(c);
      else if (c === undefined) thumbs.get(model, fp, 120, 120).then(put);
    }
    return h('div', { class: 'info-hero' }, box, h('div', null, h('div', { class: 'ih-t' }, title), h('div', { class: 'ih-s', html: sub })));
  }

  private renderBuilding(b: Building): void {
    const st = this.ctx.state;
    const def = getDef(b.def);
    const i = st.idx(b.x, b.z);
    const growable = !def || def.category === 'growable';
    const color = def ? CATEGORY_COLORS[def.category] ?? (zoneFamily(st.zone[i] as Zone) === 'R' ? '#3cc76a' : zoneFamily(st.zone[i] as Zone) === 'C' ? '#3d8bff' : '#f0b429') : '#9aa7b6';
    const dev = def?.devType;
    const isRes = dev !== undefined && dev <= DevType.R3;
    this.titleEl.textContent = def?.name ?? titleCase(b.def);
    const catLabel = growable ? (dev !== undefined ? DEV_NAMES[dev] : 'Growable') : titleCase(def!.category);
    const wealth = b.wealth > 0 ? `<span class="wealth">${'$'.repeat(Math.min(3, b.wealth))}</span>` : '';
    this.body.appendChild(this.hero(def?.name ?? titleCase(b.def), `${wealth}<span>${escapeHtml(catLabel)}</span>${def?.stage ? `<span class="faint">· stage ${def.stage}</span>` : ''}`, def ? defIcon(def) : 'resHigh', color, def?.model, def?.footprint));

    // status chips
    const flags = h('div', { class: 'flags' });
    const powered = !!(b.flags & BF.Powered) || !!st.powered[i];
    const watered = !!(b.flags & BF.Watered) || !!st.watered[i];
    flags.appendChild(h('span', { class: 'chip ' + (powered ? 'good' : 'bad'), html: icon('power', 11) + (powered ? 'Powered' : 'No power') }));
    flags.appendChild(h('span', { class: 'chip ' + (watered ? 'good' : 'warn'), html: icon('water', 11) + (watered ? 'Water' : 'No water') }));
    if (b.built < 1 || b.flags & BF.Constructing) flags.appendChild(h('span', { class: 'chip info' }, `Under construction ${Math.round(b.built * 100)}%`));
    for (const [bit, label, cls] of FLAG_CHIPS) if (b.flags & bit) flags.appendChild(h('span', { class: 'chip ' + cls }, label));
    this.body.appendChild(flags);

    // occupancy
    if (b.capacity > 0) {
      const cur = isRes ? b.pop : b.jobs;
      const frac = cur / b.capacity;
      this.body.appendChild(h('div', { class: 'cap-bar' },
        h('div', { class: 'cb-l' }, h('span', { class: 'dim' }, isRes ? 'Residents' : 'Jobs filled'), h('b', null, `${num(cur)} / ${num(b.capacity)}`)),
        h('div', { class: 'bar ' + (frac > 0.85 ? 'good' : frac > 0.4 ? '' : 'warn') }, h('div', { class: 'fill', style: { width: `${Math.min(100, frac * 100)}%` } }))));
    }

    const kv = h('div', { class: 'kv' });
    const add = (l: string, ic: string, v: string | HTMLElement) => {
      kv.appendChild(h('span', { html: icon(ic, 14) + `<span>${l}</span>` }));
      kv.appendChild(typeof v === 'string' ? h('span', { html: v }) : v);
    };
    add('Land value', 'landValue', pct(st.landValue[i]));
    add('Air pollution', 'smog', pct(st.airPollution[i]));
    add('Crime', 'crime', pct(st.crime[i]));
    if (dev !== undefined && st.desirability[dev]) {
      const dv = st.desirability[dev][i];
      add(`Desirability (${DEV_TYPE_LABELS[dev]})`, 'desire', h('span', { style: 'display:flex;align-items:center;gap:8px;justify-content:flex-end' }, desirBar(dv), h('span', null, (dv > 0 ? '+' : '') + Math.round(dv * 100))));
    }
    // commute
    const traffic = this.ctx.sim.getSystem<any>('traffic');
    let commute: string | null = null;
    try {
      const r = traffic?.routeInfo?.(b.id);
      if (typeof r === 'number') commute = `${Math.round(r)} min`;
      else if (r && typeof r === 'object') {
        const m = r.minutes ?? r.time ?? r.commute ?? r.avgMinutes;
        const mode = r.mode ?? r.via;
        const dest = r.destination ?? r.dest ?? r.target;
        commute = [typeof m === 'number' ? `${Math.round(m)} min` : null, mode ? String(mode) : null, typeof dest === 'string' ? dest : null, r.reachable === false || r.ok === false ? '<span class="neg">No route</span>' : null].filter(Boolean).join(' · ');
      }
    } catch {
      commute = null;
    }
    if (!commute && st.commute[i] > 0) commute = `${Math.round(st.commute[i])} min`;
    if (commute) add('Commute', 'clock', commute);
    if (def && !growable) {
      if (def.upkeep) add('Upkeep', 'budget', `${money(def.upkeep)}/mo`);
      if (def.income) add('Income', 'budget', `<span class="pos">+${money(def.income)}/mo</span>`);
      if (def.powerOut) add('Power output', 'power', `${num(def.powerOut)} MW`);
      if (def.waterOut) add('Water output', 'water', `${num(def.waterOut)} kL/day`);
      if (def.coverage) add(`${titleCase(def.coverage.kind)} radius`, 'target', `${def.coverage.radius} tiles`);
    }
    add('Condition', 'heart', pct(b.health ?? 1));
    add('Age', 'calendar', b.age >= 360 ? `${Math.floor(b.age / 360)} yr ${Math.floor((b.age % 360) / 30)} mo` : `${Math.floor(b.age / 30)} months`);
    this.body.appendChild(kv);

    // actions
    const acts = h('div', { class: 'info-actions' });
    const focus = h('button', { class: 'btn sm', html: icon('target', 13) + '<span>Focus</span>' });
    focus.addEventListener('click', () => this.ctx.focusCell(b.x + b.w / 2 - 0.5, b.z + b.d / 2 - 0.5, 360));
    acts.appendChild(focus);
    if (growable) {
      const hist = !!(b.flags & BF.Historic);
      const hb = h('button', { class: 'btn sm' + (hist ? ' primary' : ''), html: icon('historic', 13) + `<span>${hist ? 'Historic ✓' : 'Make historic'}</span>`, title: 'Historic buildings never redevelop' });
      hb.addEventListener('click', () => {
        try {
          this.ctx.actions.toggleHistoric(b.id);
        } catch {
          b.flags ^= BF.Historic;
        }
        this.ctx.sound('click');
        this.sig = '';
        this.update();
      });
      acts.appendChild(hb);
    }
    let cost = 0;
    try {
      cost = this.ctx.actions.bulldoze({ x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d }, true).cost;
    } catch {
      cost = 0;
    }
    const demo = h('button', { class: 'btn sm danger', html: icon('bulldoze', 13) + `<span>Demolish${cost ? ` · ${cost < 0 ? '+' : ''}${money(Math.abs(cost))}` : ''}</span>` });
    demo.addEventListener('click', () => {
      try {
        const r = this.ctx.actions.bulldoze({ x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d }, false);
        if (!r.ok) {
          this.ctx.toast(r.reason ?? 'Cannot demolish', 'error');
          return;
        }
        this.ctx.sound('bulldoze');
        this.ctx.panels.close(this.id);
      } catch (e) {
        console.warn(e);
      }
    });
    acts.appendChild(demo);
    this.body.appendChild(acts);
  }

  private renderCell(x: number, z: number): void {
    const st = this.ctx.state;
    const i = st.idx(x, z);
    const n = st.network[i] as Network;
    const zone = st.zone[i] as Zone;
    const kv = h('div', { class: 'kv' });
    const add = (l: string, ic: string, v: string | HTMLElement) => {
      kv.appendChild(h('span', { html: icon(ic, 14) + `<span>${l}</span>` }));
      kv.appendChild(typeof v === 'string' ? h('span', { html: v }) : v);
    };
    if (n) {
      const label = NETWORK_LABELS[n] ?? 'Network';
      this.titleEl.textContent = label;
      const bridge = st.netFlags[i] & 1 ? ' · bridge' : st.netFlags[i] & 2 ? ' · tunnel' : '';
      this.body.appendChild(this.hero(label, `<span>Tile ${x}, ${z}${bridge}</span>`, n === Network.Rail ? 'rail' : n === Network.Highway ? 'highway' : n === Network.Avenue ? 'avenue' : 'road', '#9fb3c8'));
      if (isRoad(n)) {
        const cong = st.congestion[i];
        this.body.appendChild(h('div', { class: 'cap-bar' },
          h('div', { class: 'cb-l' }, h('span', { class: 'dim' }, 'Congestion'), h('b', { class: cong > 1 ? 'neg' : cong > 0.7 ? 'warn' : '' }, pct(cong))),
          h('div', { class: 'bar ' + (cong > 1 ? 'bad' : cong > 0.7 ? 'warn' : 'good') }, h('div', { class: 'fill', style: { width: `${Math.min(100, cong * 100)}%` } }))));
        add('Traffic volume', 'car', `${num(st.traffic[i])} trips/day`);
        if (n === Network.OneWay) add('Direction', 'oneway', `Heading ${DIRS[(st.netFlags[i] >> 2) & 3]}`);
        if (st.netFlags[i] & 16) add('Bus stop', 'bus', 'Yes');
      }
      add('Noise', 'noise', pct(st.noise[i]));
      add('Air pollution', 'smog', pct(st.airPollution[i]));
    } else {
      const label = zone ? ZONE_LABELS[zone] : st.water[i] ? 'Water' : 'Open land';
      this.titleEl.textContent = zone ? 'Zoned lot' : st.water[i] ? 'Water' : 'Land';
      const ic = zone ? (zoneFamily(zone) === 'R' ? 'res' : zoneFamily(zone) === 'C' ? 'com' : zone === Zone.Landfill ? 'landfill' : zone === Zone.IndAg ? 'agri' : 'ind') : st.water[i] ? 'water' : 'terrain';
      const color = zone ? (zoneFamily(zone) === 'R' ? '#3cc76a' : zoneFamily(zone) === 'C' ? '#3d8bff' : '#f0b429') : st.water[i] ? '#4fb7ff' : '#c9a36a';
      this.body.appendChild(this.hero(label, `<span>Tile ${x}, ${z} · elevation ${Math.round(st.cellHeight(x, z))} m</span>`, ic, color));
      const flags = h('div', { class: 'flags' });
      if (zone) {
        flags.appendChild(h('span', { class: 'chip ' + (st.powered[i] ? 'good' : 'bad'), html: icon('power', 11) + (st.powered[i] ? 'Powered' : 'No power') }));
        flags.appendChild(h('span', { class: 'chip ' + (st.watered[i] ? 'good' : 'warn'), html: icon('water', 11) + (st.watered[i] ? 'Water' : 'No water') }));
        let road = false;
        for (let dz = -1; dz <= 1 && !road; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx === 0) !== (dz === 0) && st.isRoadAt(x + dx, z + dz)) road = true;
        flags.appendChild(h('span', { class: 'chip ' + (road ? 'good' : 'bad'), html: icon('road', 11) + (road ? 'Road access' : 'No road access') }));
      }
      if (st.powerLines[i]) flags.appendChild(h('span', { class: 'chip info', html: icon('pylon', 11) + 'Power line' }));
      if (st.trees[i]) flags.appendChild(h('span', { class: 'chip good', html: icon('trees', 11) + 'Trees' }));
      if (flags.children.length) this.body.appendChild(flags);
      add('Land value', 'landValue', pct(st.landValue[i]));
      add('Air pollution', 'smog', pct(st.airPollution[i]));
      if (st.waterPollution[i] > 0.01) add('Water pollution', 'water', pct(st.waterPollution[i]));
      add('Crime', 'crime', pct(st.crime[i]));
      add('Police / fire', 'police', `${pct(st.policeCov[i])} / ${pct(st.fireCov[i])}`);
      add('Health / education', 'health', `${pct(st.healthCov[i])} / ${pct(st.eduCov[i])}`);
      for (const d of devsForZone(zone)) {
        const dv = st.desirability[d]?.[i] ?? 0;
        add(`Desirability ${DEV_TYPE_LABELS[d]}`, 'desire', h('span', { style: 'display:flex;align-items:center;gap:8px;justify-content:flex-end' }, desirBar(dv), h('span', null, (dv > 0 ? '+' : '') + Math.round(dv * 100))));
      }
    }
    this.body.appendChild(kv);
  }
}
