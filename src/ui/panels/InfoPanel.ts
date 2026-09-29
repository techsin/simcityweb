/**
 * Inspector (query info card): building / road / lot details, "Make historic", demolish.
 *
 * Default view (docs/SIM_DEPTH_PART_B.md item 30): hero, status chips (de-duplicated against facility warnings),
 * occupancy, ONE "main problem" line with its fix, at most 6 key rows. Then collapsible sections that remember their
 * state (loadPref) and are only computed while open:
 *   Why?        desirability factors (top 8, capped / updating note), condition breakdown incl. "Abandons in N days",
 *               growth limits, land value factors, crime causes            (WP6a / WP1 / WP3 breakdowns; stubs → hidden)
 *   Residents   needs per cohort (needsOf) and a 5-bar age pyramid
 *   Facility    the generic facilityReport: role, label / value rows, a bar when a ratio is set, status, hint, warnings
 *   Environment noise, air, water pollution, garbage (why it isn't collected), tap water, emergency response times
 *               ("Fire response: auto, 2.1 min to spare" / "manual only"), coverages per tier
 * The panel is rebuilt at most once per real second while its content signature changes (ultra speed changes it
 * several times a second).
 */
import '../insight.css';
import { DEV_TYPE_LABELS, DevType, Network, Zone, isRoad, zoneDensity, zoneFamily } from '../../core/types';
import { BF, type Building, type CityState } from '../../sim/CityState';
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
import { emptyZoneStatus, roadAccess, utilityReaches, zoneStatusLine } from '../zoneStatus';
import { demolishRisks } from '../../game/demolishRisk';
import { confirmDialog } from '../Modals';
import { loadPref, savePref } from '../../game/settings';
import type { EconRuntime } from '../../sim/economy/runtime';
import type { SimSystem } from '../../sim/Simulation';
import { desirabilityBreakdown } from '../../sim/economy/desirability';
import { landValueBreakdown } from '../../sim/economy/landValue';
import { growthLimits } from '../../sim/economy/growth';
import { conditionBreakdown } from '../../sim/economy/population';
import { cohortShares, needsExpectation, needsOf, tapWaterAt, waterRequired } from '../../sim/economy/demographics';
import { TAP_SAFE } from '../../sim/economy/tuning';
import { facilityReport } from '../../sim/infra/facilities';
import { roadCellReport } from '../../sim/infra/transportFacilities';
import { responseAt } from '../../sim/infra/emergency';
import type { PollutionSystem } from '../../sim/infra/pollution';
import type { CrimeSystem } from '../../sim/infra/crime';
import { NOISY_THRESHOLD, POLLUTED_THRESHOLD } from '../../sim/infra/params';
import {
  type Bar, type Chip, type ModelRow, conditionView, crimeBars, dedupeChips, desirabilityView, facilityView, growthRows, mainProblem,
  needRows, pyramid, responseText, termBars,
} from '../inspectorModel';

const FLAG_CHIPS: [number, string, Chip['cls'], Chip['topic']?][] = [
  [BF.Abandoned, 'Abandoned', 'bad'],
  [BF.OnFire, 'On fire!', 'bad', 'fire'],
  [BF.Burnt, 'Burnt down', 'bad', 'burnt'],
  [BF.Incident, 'Emergency here', 'bad'],
  [BF.NoRoad, 'No road access', 'bad', 'road'],
  [BF.Understaffed, 'Understaffed', 'warn', 'staff'],
  [BF.NoJobs, 'No jobs', 'warn'],
  [BF.Congested, 'Congested', 'warn'],
  [BF.Polluted, 'Polluted', 'warn'],
  [BF.Noisy, 'Noisy', 'warn'],
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

/** section ids and their default open state */
const SECTIONS = { why: false, residents: false, facility: true, environment: false } as const;
type SectionId = keyof typeof SECTIONS;

/** min real ms between two rebuilds of the same target */
const REBUILD_MS = 1000;

export class InfoPanel extends Panel {
  readonly id = 'info';
  readonly title = 'Inspector';
  override icon = 'query';
  override width = 380;
  private target: QueryTarget | null = null;
  private sig = '';
  private builtAt = 0;
  private open: Record<SectionId, boolean> = { ...SECTIONS };

  override defaultPos(w: number): { x: number; y: number } {
    return { x: w - this.width - 14, y: 72 };
  }

  protected build(): void {
    for (const k of Object.keys(SECTIONS) as SectionId[]) this.open[k] = loadPref<boolean>('inspector.sec.' + k, SECTIONS[k]);
  }

  show(t: QueryTarget): void {
    this.target = t;
    this.sig = '';
    this.builtAt = 0;
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
    const ci = st.idx(t.x, t.z);
    // (empty lot: its growth status too — a neighbouring road can become powered while the game is paused)
    let zsig = '';
    if (!b) {
      try {
        const zs = emptyZoneStatus(st, t.x, t.z);
        zsig = zs ? zs.blockers.map((x) => x.text).join('|') || 'ready' : '';
      } catch {
        zsig = '';
      }
    }
    const openSig = (Object.keys(this.open) as SectionId[]).map((k) => (this.open[k] ? 1 : 0)).join('');
    const sig = b ? `b${b.id}:${b.pop}:${b.jobs}:${b.flags}:${Math.round(b.built * 20)}:${st.monthIndex}:${Math.floor(st.day / 5)}:${openSig}` : `c${t.x},${t.z}:${st.network[ci]}:${st.zone[ci]}:${st.building[ci]}:${st.powered[ci]}:${st.watered[ci]}:${Math.floor(st.day / 5)}:${zsig}:${openSig}`;
    if (sig === this.sig) return;
    // same target, new data: at most one rebuild per real second (breakdowns / needs / report are not free)
    const now = performance.now();
    const sameTarget = this.sig.split(':')[0] === sig.split(':')[0];
    if (sameTarget && now - this.builtAt < REBUILD_MS) return;
    this.sig = sig;
    this.builtAt = now;
    const scroll = this.body.scrollTop;
    clear(this.body);
    if (t.buildingId != null && !b) {
      this.titleEl.textContent = 'Inspector';
      this.body.appendChild(h('div', { class: 'empty', html: icon('bulldoze', 26) + '<div>This building no longer exists.</div>' }));
      return;
    }
    try {
      if (b) this.renderBuilding(b);
      else this.renderCell(t.x, t.z);
    } catch (e) {
      console.error('[ui] inspector failed', e);
      this.body.appendChild(h('div', { class: 'empty' }, 'Nothing to show here right now.'));
    }
    // same target: keep the reader's place; another building / cell starts at the top (no layout ran between the
    // clear and the rebuild, so the old offset would otherwise carry over)
    this.body.scrollTop = sameTarget ? scroll : 0;
  }

  // ------------------------------------------------------------------------------------------------ helpers
  private rt(): EconRuntime | null {
    return this.ctx.sim.getSystem<SimSystem & { rt?: EconRuntime }>('economy.population')?.rt ?? null;
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

  private kv(): { el: HTMLElement; add: (l: string, ic: string, v: string | HTMLElement, title?: string) => void; count: () => number } {
    const el = h('div', { class: 'kv' });
    let n = 0;
    return {
      el,
      add: (l, ic, v, title) => {
        n++;
        el.appendChild(h('span', { html: icon(ic, 14) + `<span>${escapeHtml(l)}</span>`, title }));
        el.appendChild(typeof v === 'string' ? h('span', { html: v, title }) : v);
      },
      count: () => n,
    };
  }

  /** a collapsible section; `build` runs only while it is open */
  private section(id: SectionId, title: string, ic: string, summary: string, build: () => (HTMLElement | null)[]): HTMLElement {
    const open = this.open[id];
    const head = h('button', { class: 'ins-sec-h' + (open ? ' open' : ''), 'aria-expanded': open ? 'true' : 'false', 'data-sfx': 'none' },
      h('span', { class: 'ico-wrap', html: icon(ic, 14) }),
      h('span', { class: 'ins-sec-t' }, title),
      summary ? h('span', { class: 'ins-sec-s' }, summary) : null,
      h('span', { class: 'ins-sec-c ico-wrap', html: icon(open ? 'chevUp' : 'chevDown', 13) }),
    );
    head.addEventListener('click', () => {
      this.open[id] = !this.open[id];
      savePref('inspector.sec.' + id, this.open[id]);
      this.ctx.sound(this.open[id] ? 'toggleOn' : 'toggleOff');
      this.sig = '';
      this.builtAt = 0;
      this.update();
    });
    const box = h('div', { class: 'ins-sec' + (open ? ' open' : '') }, head);
    if (open) {
      const body = h('div', { class: 'ins-sec-b' });
      for (const c of build()) if (c) body.appendChild(c);
      if (!body.children.length) body.appendChild(h('div', { class: 'ins-empty' }, 'Nothing to report yet.'));
      box.appendChild(body);
    }
    return box;
  }

  /** signed bars (factor lists); worse = a positive term is bad news (crime causes: red, not green) */
  private bars(title: string | null, bars: Bar[], unit: 'pts' | 'raw' = 'raw', note?: string, worse = false): HTMLElement | null {
    if (!bars.length) return null;
    const max = Math.max(0.05, ...bars.map((b) => Math.abs(b.value)));
    const box = h('div', { class: 'ins-bars' });
    if (title) box.appendChild(h('div', { class: 'ins-sub' }, title));
    for (const b of bars) {
      const a = Math.min(1, Math.abs(b.value) / max);
      const good = (b.value >= 0) !== worse;
      const fill = h('i', { style: { width: `${a * 50}%`, left: b.value >= 0 ? '50%' : `${50 - a * 50}%` }, class: good ? 'p' : 'n' });
      box.appendChild(h('div', { class: 'ins-bar', title: b.detail ?? '' },
        h('span', { class: 'l' }, b.label),
        h('span', { class: 't' }, fill, h('b')),
        h('span', { class: 'v ' + (good ? 'pos' : 'neg') }, unit === 'pts' ? `${b.value >= 0 ? '+' : '−'}${Math.abs(Math.round(b.value * 100))}` : b.text),
      ));
      if (b.detail && bars.length <= 4) box.appendChild(h('div', { class: 'ins-bar-d' }, b.detail));
    }
    if (note) box.appendChild(h('div', { class: 'ins-note' }, note));
    return box;
  }

  /** model rows as a key/value grid with optional ratio bars and hints */
  private rows(rows: ModelRow[]): HTMLElement | null {
    if (!rows.length) return null;
    const box = h('div', { class: 'ins-rows' });
    for (const r of rows) {
      const val = h('span', { class: 'rv ' + (r.tone ?? '') }, r.value);
      const row = h('div', { class: 'ins-row' + (r.status ? ' st-' + r.status : '') }, h('span', { class: 'rl' }, r.label), val);
      box.appendChild(row);
      if (r.ratio !== undefined) {
        const cls = r.status === 'bad' ? 'bad' : r.status === 'warn' ? 'warn' : 'good';
        box.appendChild(h('div', { class: 'bar ins-ratio ' + cls }, h('div', { class: 'fill', style: { width: `${Math.min(100, r.ratio * 100)}%` } }), r.ratio > 1 ? h('span', { class: 'mark', style: `left:calc(${Math.min(100, 100 / r.ratio)}% - 1px)` }) : null));
      }
      if (r.hint) box.appendChild(h('div', { class: 'ins-hint' }, r.hint));
    }
    return box;
  }

  private problem(p: ReturnType<typeof mainProblem>): HTMLElement | null {
    if (!p) return null;
    return h('div', { class: 'ins-problem ' + p.tone },
      h('span', { class: 'ico-wrap', html: icon('alert', 14) }),
      h('div', null, h('div', { class: 'pt' }, p.text), p.hint ? h('div', { class: 'ph' }, p.hint) : null));
  }

  private chips(list: Chip[]): HTMLElement {
    const box = h('div', { class: 'flags' });
    for (const c of list) box.appendChild(h('span', { class: 'chip ' + c.cls, title: c.title, html: c.text }));
    return box;
  }

  private lvl(v: number): string {
    return `<span class="${v >= 0.75 ? 'pos' : v >= 0.4 ? 'warn' : 'neg'}">${pct(v)}</span>`;
  }

  // ------------------------------------------------------------------------------------------------ building
  private renderBuilding(b: Building): void {
    const st = this.ctx.state;
    const sim = this.ctx.sim;
    const def = getDef(b.def);
    const N = st.size;
    const i = st.idx(b.x, b.z);
    const ci = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
    const growable = !def || def.category === 'growable';
    const color = def ? CATEGORY_COLORS[def.category] ?? (zoneFamily(st.zone[i] as Zone) === 'R' ? '#3cc76a' : zoneFamily(st.zone[i] as Zone) === 'C' ? '#3d8bff' : '#f0b429') : '#9aa7b6';
    const dev = def?.devType;
    const isRes = dev !== undefined && dev <= DevType.R3;
    const fam = dev === undefined ? null : dev <= DevType.R3 ? 'R' : dev <= DevType.CO3 ? 'C' : 'I';
    this.titleEl.textContent = def?.name ?? titleCase(b.def);
    const catLabel = growable ? (dev !== undefined ? DEV_NAMES[dev] : 'Growable') : titleCase(def!.category);
    const wealth = b.wealth > 0 && growable ? `<span class="wealth">${'$'.repeat(Math.min(3, b.wealth))}</span>` : '';
    this.body.appendChild(this.hero(def?.name ?? titleCase(b.def), `${wealth}<span>${escapeHtml(catLabel)}</span>${def?.stage ? `<span class="faint">· stage ${def.stage}</span>` : ''}`, def ? defIcon(def) : 'resHigh', color, def?.model, def?.footprint));

    // ---- facility report (plopped): its warnings lead the main problem and replace duplicate chips
    const rep = !growable ? facilityView(safeCall(() => facilityReport(sim, b.id), null)) : null;
    const warnings = rep?.warnings ?? [];

    // ---- chips
    const chips: Chip[] = [];
    const powered = !!(b.flags & BF.Powered) || !!st.powered[i];
    const watered = !!(b.flags & BF.Watered) || !!st.watered[i];
    // every building draws power except power plants and parks without an explicit use (lawns and benches)
    const isPlant = !!def && (def.powerOut ?? 0) > 0;
    const usesPower = growable || (!!def && !isPlant && (def.category !== 'park' || (def.powerUse ?? 0) > 0));
    if (usesPower) chips.push({ text: icon('power', 11) + (powered ? 'Powered' : 'No power'), cls: powered ? 'good' : 'bad', topic: 'power' });
    const needW = safeCall(() => waterRequired(st, b), false);
    if (watered) chips.push({ text: icon('water', 11) + 'Water', cls: 'good', topic: 'water' });
    else if (needW) chips.push({ text: icon('water', 11) + 'No water', cls: 'warn', topic: 'water', title: 'This building needs piped water' });
    if (b.built < 1 || b.flags & BF.Constructing) chips.push({ text: `Under construction ${Math.round(b.built * 100)}%`, cls: 'info' });
    for (const [bit, label, cls, topic] of FLAG_CHIPS) if (b.flags & bit) chips.push({ text: label, cls, topic });
    if (b.flags & BF.NeedsUnmet) {
      const exp = safeCall(() => needsExpectation(st), 1);
      chips.push({ text: 'Needs unmet', cls: exp > 0.01 ? 'warn' : 'info', title: exp > 0.01 ? 'Some residents lack a school, clinic, playground… (see Residents)' : 'Residents of a small town do not mind yet — they will as the city grows' });
    }
    this.body.appendChild(this.chips(dedupeChips(chips, warnings)));

    // ---- occupancy
    if (b.capacity > 0) {
      const cur = isRes ? b.pop : b.jobs;
      const frac = cur / b.capacity;
      this.body.appendChild(h('div', { class: 'cap-bar' },
        h('div', { class: 'cb-l' }, h('span', { class: 'dim' }, isRes ? 'Residents' : 'Jobs filled'), h('b', null, `${num(cur)} / ${num(b.capacity)}`)),
        h('div', { class: 'bar ' + (frac > 0.85 ? 'good' : frac > 0.4 ? '' : 'warn') }, h('div', { class: 'fill', style: { width: `${Math.min(100, frac * 100)}%` } }))));
    }

    // ---- main problem (breakdowns are computed once and reused by the Why? section)
    const rt = this.rt();
    const cond = growable ? conditionView(safeCall(() => conditionBreakdown(st, b), null)) : null;
    const des = growable && dev !== undefined ? desirabilityView(safeCall(() => desirabilityBreakdown(st, rt as EconRuntime, dev, ci), null)) : null;
    this.body.appendChild(this.problem(mainProblem({ warnings, condition: cond, desirability: des, abandoned: !!(b.flags & BF.Abandoned) })) ?? h('span'));

    // ---- key rows (at most 6)
    const kv = this.kv();
    const traffic = (this.ctx.mods.infra?.getTraffic?.(sim) ?? sim.getSystem('traffic')) as any;
    if (growable) {
      kv.add('Land value', 'landValue', pct(st.landValue[ci]));
      if (dev !== undefined && st.desirability[dev]) {
        const dv = st.desirability[dev][ci];
        kv.add(`Desirability (${DEV_TYPE_LABELS[dev]})`, 'desire', h('span', { style: 'display:flex;align-items:center;gap:8px;justify-content:flex-end' }, desirBar(dv), h('span', null, (dv > 0 ? '+' : '') + Math.round(dv * 100))));
      }
      const commute = this.commuteText(b, traffic, ci);
      if (commute) kv.add('Commute', 'clock', commute);
      try {
        if (fam === 'R') {
          const a = traffic?.workerAccess?.(b.id) ?? -1;
          if (a >= 0) kv.add('Job access', 'briefcase', this.lvl(a));
        } else if (b.capacity > 0) {
          const f = traffic?.jobFill?.(b.id) ?? -1;
          if (f >= 0) kv.add('Worker supply', 'people', this.lvl(f));
        }
        if (fam === 'C') {
          const c = traffic?.customers?.(b.id) ?? 0;
          if (c > 0) kv.add('Customers', 'people', `${num(c)}/day`);
        }
        if (fam === 'I') {
          const fr = traffic?.freightAccess?.(b.id) ?? -1;
          if (fr >= 0) kv.add('Freight access', 'train', this.lvl(fr));
        }
      } catch {
        /* ignore */
      }
      const tgt = cond ? ` → ${pct(Math.max(0, Math.min(1, cond.target)))}` : '';
      kv.add('Condition', 'heart', `${pct(b.health ?? 1)}${tgt}`, cond ? 'Current condition → the level it is heading for' : undefined);
    } else if (def) {
      if (def.upkeep) kv.add('Upkeep', 'budget', `${money(def.upkeep)}/mo`);
      if (def.income) kv.add('Income', 'budget', `<span class="pos">+${money(def.income)}/mo</span>`);
    }
    if (kv.count() < 6) kv.add('Age', 'calendar', b.age >= 360 ? `${Math.floor(b.age / 360)} yr ${Math.floor((b.age % 360) / 30)} mo` : `${Math.floor(b.age / 30)} months`);
    this.body.appendChild(kv.el);

    // ---- sections
    if (rep) {
      // the header above already shows the jobs bar and the upkeep: plain repeats of those lines are left out (a line
      // with a warning or a hint says more and stays)
      const header = new Set(['jobs filled', 'upkeep']);
      const rows = rep.rows.filter((r) => !(header.has(r.label.toLowerCase()) && !r.hint && (r.status ?? 'ok') === 'ok'));
      this.body.appendChild(this.section('facility', 'Facility', 'info', rows.length ? `${rows.length} facts` : '', () => [
        rep.role ? h('div', { class: 'ins-role' }, rep.role) : null,
        warnings.length ? h('ul', { class: 'ins-warn' }, ...warnings.map((w) => h('li', { html: icon('alert', 12) + `<span>${escapeHtml(w)}</span>` }))) : null,
        this.rows(rows),
      ]));
    }
    if (growable) {
      this.body.appendChild(this.section('why', 'Why?', 'help', des ? 'desirability · condition · growth' : 'condition · growth', () => this.whyBuilding(b, dev, ci, des, cond, rt)));
    }
    if (isRes && b.pop > 0) {
      const needs = safeCall(() => needsOf(st, b), []);
      const unmet = needs.filter((n) => !n.met).length;
      this.body.appendChild(this.section('residents', 'Residents', 'people', needs.length ? (unmet ? `${unmet} need${unmet > 1 ? 's' : ''} unmet` : 'all needs met') : `${num(b.pop)} people`, () => this.residents(b, needs)));
    }
    this.body.appendChild(this.section('environment', 'Environment', 'leaf', '', () => this.environment(ci, b, fam)));

    this.actions(b, growable);
  }

  private commuteText(b: Building, traffic: any, ci: number): string | null {
    const st = this.ctx.state;
    let commute: string | null = null;
    try {
      const r = traffic?.routeInfo?.(b.id);
      if (typeof r === 'number') commute = `${Math.round(r)} min`;
      else if (r && typeof r === 'object') {
        const m = r.commuteMin ?? r.minutes ?? r.time ?? r.commute ?? r.avgMinutes;
        const mode = r.mode ?? r.via;
        const none = mode === 'none' || r.reachable === false || r.ok === false;
        commute = none ? '<span class="neg">No route to work</span>' : [typeof m === 'number' && m > 0 ? `${Math.round(m)} min` : null, mode ? `by ${String(mode)}` : null].filter(Boolean).join(' · ');
      }
    } catch {
      commute = null;
    }
    if (!commute && st.commute[ci] > 0) commute = `${Math.round(st.commute[ci])} min`;
    return commute || null;
  }

  private whyBuilding(b: Building, dev: number | undefined, ci: number, des: ReturnType<typeof desirabilityView>, cond: ReturnType<typeof conditionView>, rt: EconRuntime | null): (HTMLElement | null)[] {
    const st = this.ctx.state;
    const out: (HTMLElement | null)[] = [];
    if (des) out.push(this.bars(`Desirability ${des.value >= 0 ? '+' : '−'}${Math.abs(Math.round(des.value * 100))} — what drives it`, des.bars, 'pts', des.note));
    if (cond) {
      const box = this.bars(`Condition heading for ${pct(Math.max(0, Math.min(1, cond.target)))}`, cond.bars, 'pts');
      if (box && cond.abandon) box.appendChild(h('div', { class: 'ins-abandon', html: icon('alert', 13) + `<span>${escapeHtml(cond.abandon)} — fix the red factors above</span>` }));
      out.push(box);
    }
    if (dev !== undefined) {
      const gl = safeCall(() => growthLimits(st, ci, dev), null);
      const def = getDef(b.def);
      out.push(this.rows(growthRows(gl, def?.stage)));
    }
    const lv = termBars(safeCall(() => landValueBreakdown(st, rt as EconRuntime, ci), []));
    if (lv.length) out.push(this.bars(`Land value ${pct(st.landValue[ci])} — factors`, lv, 'pts'));
    const cr = crimeBars(safeCall(() => this.ctx.sim.getSystem<CrimeSystem>('crime')?.termsOf?.(b.id) ?? null, null));
    if (cr && cr.total > 0.02) out.push(this.bars(`Crime ${pct(cr.total)} — causes (police removes ${pct(cr.police)})`, cr.bars, 'pts', cr.multiplier > 1.01 ? `×${cr.multiplier.toFixed(2)} from ordinances and the justice system` : undefined, true));
    return out;
  }

  private residents(b: Building, needs: ReturnType<typeof needsOf>): (HTMLElement | null)[] {
    const out: (HTMLElement | null)[] = [];
    const rows = needRows(needs);
    if (rows.length) {
      const list = h('div', { class: 'ins-needs' });
      for (const r of rows.slice(0, 10)) {
        list.appendChild(h('div', { class: 'ins-need ' + (r.met ? 'met' : 'unmet') },
          h('span', { class: 'nm', html: icon(r.met ? 'check' : 'alert', 12) }),
          h('span', { class: 'nw' }, `${r.who} ${num(r.people)}`),
          h('span', { class: 'nl' }, r.label),
          h('span', { class: 'na' }, pct(r.access)),
        ));
      }
      out.push(list);
    } else out.push(h('div', { class: 'ins-empty' }, 'Needs are assessed once the city has services.'));
    const pyr = pyramid(cohortShares(b, new Float32Array(5)), b.pop);
    if (pyr.length) {
      const max = Math.max(0.01, ...pyr.map((p) => p.share));
      const box = h('div', { class: 'ins-pyr' }, h('div', { class: 'ins-sub' }, 'Age groups'));
      for (const p of pyr) {
        box.appendChild(h('div', { class: 'pyr-row' }, h('span', { class: 'pl' }, p.label), h('span', { class: 'pb' }, h('i', { style: { width: `${(p.share / max) * 100}%` } })), h('span', { class: 'pv' }, `${num(p.people)} · ${pct(p.share)}`)));
      }
      out.push(box);
    }
    return out;
  }

  /** noise, air, water, garbage, tap water, response times, coverages at a cell (building-aware when b is set) */
  private environment(ci: number, b: Building | null, fam: 'R' | 'C' | 'I' | null): (HTMLElement | null)[] {
    const st = this.ctx.state;
    const sim = this.ctx.sim;
    const kv = this.kv();
    const nz = st.noise[ci], air = st.airPollution[ci], wp = st.waterPollution[ci];
    kv.add('Noise', 'noise', `<span class="${nz > NOISY_THRESHOLD ? 'neg' : nz > 0.3 ? 'warn' : ''}">${pct(nz)}</span>`, `Homes above ${pct(NOISY_THRESHOLD)} can't sleep`);
    kv.add('Air pollution', 'smog', `<span class="${air > POLLUTED_THRESHOLD ? 'neg' : air > 0.25 ? 'warn' : ''}">${pct(air)}</span>`);
    if (wp > 0.01) kv.add('Water pollution', 'water', pct(wp));
    if (st.soil[ci] > 0.02) kv.add('Soil contamination', 'terrain', pct(st.soil[ci]));
    // garbage: level + why it is not collected
    const gi = b ? safeCall(() => sim.getSystem<PollutionSystem>('pollution')?.garbageInfo?.(b.id) ?? null, null) : null;
    if (gi) {
      const why = gi.collected ? '<span class="pos">collected</span>' : gi.reason === 'noRoad' ? '<span class="neg">no road for the trucks</span>' : gi.reason === 'range' ? '<span class="neg">out of truck range</span>' : gi.reason === 'capacity' ? '<span class="neg">dumps are full</span>' : '<span class="warn">not collected</span>';
      kv.add('Garbage', 'garbage', `${why}${gi.level > 0.02 ? ` · pile ${pct(gi.level)}` : ''}`);
    } else if (st.garbage[ci] > 0.02) kv.add('Garbage', 'garbage', `pile ${pct(st.garbage[ci])}`);
    // tap water (served cells)
    if (st.watered[ci] || (b && b.flags & BF.Watered)) {
      const q = safeCall(() => tapWaterAt(sim, st, ci), 1);
      kv.add('Tap water', 'water', q >= TAP_SAFE ? `<span class="${q >= 0.85 ? 'pos' : 'warn'}">${pct(q)} · safe</span>` : `<span class="neg">${pct(q)} · unsafe tap water</span>`);
    }
    // emergency response (auto-dispatch reach)
    const resp: [string, 'fire' | 'police' | 'medical', string, string][] = [['Fire response', 'fire', 'fire', 'no fire station'], ['Police response', 'police', 'police', 'no police station'], ['Ambulance', 'medical', 'health', 'no clinic or hospital']];
    for (const [label, r, ic, none] of resp) {
      const t = responseText(safeCall(() => responseAt(sim, ci, r), null), none);
      if (t) kv.add(label, ic, `<span class="${t.tone}">${escapeHtml(t.text)}</span>`, 'Auto-dispatch reach: covered incidents become statistics; beyond it you dispatch yourself (live speed)');
    }
    const out: (HTMLElement | null)[] = [kv.el];
    // coverages
    const cov = this.kv();
    const c = (l: string, ic: string, v: number) => cov.add(l, ic, this.lvl(v));
    c('Police patrols', 'police', st.policeCov[ci]);
    c('Fire prevention', 'fire', st.fireCov[ci]);
    c('Care access', 'health', st.healthCov[ci]);
    if (fam === 'R' || fam === null) {
      c('Elementary school', 'education', st.eduElemCov[ci]);
      c('High school', 'education', st.eduHighCov[ci]);
      c('University', 'education', st.eduCollegeCov[ci]);
      c('Play & sports', 'park', st.playCov[ci]);
      c('Parks & gardens', 'trees', st.greenCov[ci]);
    }
    c('Transit', 'bus', st.transitCov[ci]);
    if (fam !== 'I') c('Shops in reach', 'com', st.shopAccess[ci]);
    if (fam === 'C' && st.parking[ci] > 0.01) cov.add('Parking pressure', 'parking', `<span class="${st.parking[ci] > 0.6 ? 'neg' : st.parking[ci] > 0.3 ? 'warn' : ''}">${pct(st.parking[ci])}</span>`);
    out.push(h('div', { class: 'ins-sub' }, 'Coverage'), cov.el);
    // utility grids
    try {
      const util = this.ctx.mods.infra?.getUtilities?.(sim);
      const x = ci % st.size, z = Math.floor(ci / st.size);
      const g = util?.gridInfo?.(sim, x, z);
      const w = util?.waterInfo?.(sim, x, z);
      if (g || w) {
        const u = this.kv();
        if (g) u.add('Power grid', 'power', `${num(g.demand)} / ${num(g.supply)} MW${g.shortage ? ' <span class="chip bad">Shortage</span>' : ''}`);
        if (w) u.add('Water network', 'water', `${num(w.demand)} / ${num(w.supply)} kL${w.shortage ? ' <span class="chip bad">Shortage</span>' : ''}`);
        out.push(h('div', { class: 'ins-sub' }, 'Utilities'), u.el);
      }
    } catch {
      /* ignore */
    }
    return out;
  }

  private actions(b: Building, growable: boolean): void {
    const acts = h('div', { class: 'info-actions' });
    const focus = h('button', { class: 'btn sm', html: icon('target', 13) + '<span>Focus</span>' });
    // (focusCell plays the camera whoosh)
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
        this.ctx.sound(hist ? 'toggleOff' : 'toggleOn');
        this.sig = '';
        this.builtAt = 0;
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
      const rect = { x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d };
      const doIt = () => {
        try {
          const r = this.ctx.actions.bulldoze(rect, false);
          if (!r.ok) {
            this.ctx.sound('error');
            this.ctx.toast(r.reason ?? 'Cannot demolish', 'error');
            return;
          }
          // the demolition rumble is the sound: the inspector closes silently
          this.ctx.sound('bulldoze');
          this.ctx.panels.close(this.id, { silent: true });
        } catch (e) {
          console.warn(e);
        }
      };
      // last power plant / water source, landmark / reward, or > §20k: confirm first
      let risk = null;
      try {
        risk = demolishRisks(this.ctx.state, rect, cost, { sandbox: this.ctx.sandbox() });
      } catch {
        risk = null;
      }
      if (!risk) return doIt();
      void confirmDialog(this.ctx, { title: risk.title, message: 'This demolition has consequences:', items: risk.items, confirm: 'Demolish', danger: true }).then((yes) => {
        if (yes && this.ctx.state.buildings.has(b.id)) doIt();
      });
    });
    acts.appendChild(demo);
    this.body.appendChild(acts);
  }

  // ------------------------------------------------------------------------------------------------ cells
  private renderCell(x: number, z: number): void {
    const st = this.ctx.state;
    const sim = this.ctx.sim;
    const i = st.idx(x, z);
    const n = st.network[i] as Network;
    const zone = st.zone[i] as Zone;
    if (n) {
      const kv = this.kv();
      const label = NETWORK_LABELS[n] ?? 'Network';
      this.titleEl.textContent = label;
      const bridge = st.netFlags[i] & 1 ? ' · bridge' : st.netFlags[i] & 2 ? ' · tunnel' : '';
      this.body.appendChild(this.hero(label, `<span>Tile ${x}, ${z}${bridge}</span>`, n === Network.Rail ? 'rail' : n === Network.Highway ? 'highway' : n === Network.Avenue ? 'avenue' : 'road', '#9fb3c8'));
      if (isRoad(n)) {
        const cong = st.congestion[i];
        this.body.appendChild(h('div', { class: 'cap-bar' },
          h('div', { class: 'cb-l' }, h('span', { class: 'dim' }, 'Congestion'), h('b', { class: cong > 1 ? 'neg' : cong > 0.7 ? 'warn' : '' }, pct(cong))),
          h('div', { class: 'bar ' + (cong > 1 ? 'bad' : cong > 0.7 ? 'warn' : 'good') }, h('div', { class: 'fill', style: { width: `${Math.min(100, cong * 100)}%` } }))));
        if (n === Network.OneWay) kv.add('Direction', 'oneway', `Heading ${DIRS[(st.netFlags[i] >> 2) & 3]}`);
      }
      // traffic, trucks, bus riders, interchange load (WP7b's road report, rendered generically)
      const lines = safeCall(() => roadCellReport(sim, i), []);
      this.body.appendChild(kv.el);
      if (lines.length) this.body.appendChild(this.rows(facilityView({ title: label, role: '', lines, warnings: [] })!.rows) ?? h('span'));
      else if (isRoad(n)) kv.add('Traffic volume', 'car', `${num(st.traffic[i])} trips/day`);
      const env = this.kv();
      env.add('Noise', 'noise', pct(st.noise[i]));
      env.add('Air pollution', 'smog', pct(st.airPollution[i]));
      this.body.appendChild(env.el);
      return;
    }
    const label = zone ? ZONE_LABELS[zone] : st.water[i] ? 'Water' : 'Open land';
    this.titleEl.textContent = zone ? (zone === Zone.Landfill ? 'Landfill' : 'Zoned lot') : st.water[i] ? 'Water' : 'Land';
    const ic = zone ? (zoneFamily(zone) === 'R' ? 'res' : zoneFamily(zone) === 'C' ? 'com' : zone === Zone.Landfill ? 'landfill' : zone === Zone.IndAg ? 'agri' : 'ind') : st.water[i] ? 'water' : 'terrain';
    const color = zone ? (zoneFamily(zone) === 'R' ? '#3cc76a' : zoneFamily(zone) === 'C' ? '#3d8bff' : '#f0b429') : st.water[i] ? '#4fb7ff' : '#c9a36a';
    this.body.appendChild(this.hero(label, `<span>Tile ${x}, ${z} · elevation ${Math.round(st.cellHeight(x, z))} m</span>`, ic, color));
    const flags = h('div', { class: 'flags' });
    if (zone && zone !== Zone.Landfill) {
      // same rules as the growth status below (zoneStatus.ts): utility through the lot or a served neighbour,
      // water only matters for medium / high density, road within a lot's depth
      const pw = utilityReaches(st, st.powered, i, 'power'), wt = utilityReaches(st, st.watered, i, 'water');
      const needWater = zoneDensity(zone) >= 2;
      flags.appendChild(h('span', { class: 'chip ' + (pw ? 'good' : 'bad'), html: icon('power', 11) + (pw ? 'Powered' : 'No power') }));
      flags.appendChild(h('span', { class: 'chip ' + (wt ? 'good' : needWater ? 'warn' : 'info'), title: wt || needWater ? undefined : 'Low-density lots grow without water; bigger buildings need it later', html: icon('water', 11) + (wt ? 'Water' : needWater ? 'No water' : 'No water yet') }));
      const road = roadAccess(st, x, z);
      flags.appendChild(h('span', { class: 'chip ' + (road ? 'good' : 'bad'), html: icon('road', 11) + (road ? 'Road access' : 'No road access') }));
    }
    if (st.powerLines[i]) flags.appendChild(h('span', { class: 'chip info', html: icon('pylon', 11) + 'Power line' }));
    if (st.trees[i]) flags.appendChild(h('span', { class: 'chip good', html: icon('trees', 11) + 'Trees' }));
    if (flags.children.length) this.body.appendChild(flags);
    // empty zoned lot: why it is (not) growing
    const zs = emptyZoneStatus(st, x, z);
    if (zs) {
      const box = h('div', { class: 'zone-status ' + (zs.ready ? 'ok' : 'bad') }, h('div', { class: 'zs-h', html: icon(zs.ready ? 'check' : 'alert', 13) + `<span>${escapeHtml(zoneStatusLine(zs))}</span>` }));
      for (const bl of zs.blockers.slice(1)) box.appendChild(h('div', { class: 'zs-r' }, bl.text));
      this.body.appendChild(box);
    }
    const kv = this.kv();
    if (zone === Zone.Landfill) {
      const lf = safeCall(() => sim.getSystem<PollutionSystem>('pollution')?.landfillInfo?.(x, z) ?? null, null);
      if (lf) {
        kv.add('Landfill fill', 'landfill', `<span class="${lf.fill > 0.8 ? 'neg' : lf.fill > 0.5 ? 'warn' : 'pos'}">${pct(lf.fill)}</span> of ${num(lf.cells)} tiles`);
        kv.add('Takes', 'garbage', `${num(lf.usedT)} / ${num(lf.capacityT)} t a month`);
        if (!lf.road) kv.add('Trucks', 'road', '<span class="neg">no road on its edge — trucks can’t reach it</span>');
      } else kv.add('Landfill fill', 'landfill', pct(st.landfillFill[i]));
    }
    kv.add('Land value', 'landValue', pct(st.landValue[i]));
    const devs = devsForZone(zone);
    for (const d of devs.slice(0, 5)) {
      const dv = st.desirability[d]?.[i] ?? 0;
      kv.add(`Desirability ${DEV_TYPE_LABELS[d]}`, 'desire', h('span', { style: 'display:flex;align-items:center;gap:8px;justify-content:flex-end' }, desirBar(dv), h('span', null, (dv > 0 ? '+' : '') + Math.round(dv * 100))));
    }
    this.body.appendChild(kv.el);
    if (devs.length) {
      // the DevType this lot suits best: its factors and growth limits
      let best = devs[0];
      for (const d of devs) if ((st.desirability[d]?.[i] ?? -2) > (st.desirability[best]?.[i] ?? -2)) best = d;
      this.body.appendChild(this.section('why', 'Why?', 'help', `best fit ${DEV_TYPE_LABELS[best]}`, () => {
        const rt = this.rt();
        const des = desirabilityView(safeCall(() => desirabilityBreakdown(st, rt as EconRuntime, best, i), null));
        const out: (HTMLElement | null)[] = [];
        if (des) out.push(this.bars(`Desirability ${DEV_TYPE_LABELS[best]} — what drives it`, des.bars, 'pts', des.note));
        out.push(this.rows(growthRows(safeCall(() => growthLimits(st, i, best), null))));
        const lv = termBars(safeCall(() => landValueBreakdown(st, rt as EconRuntime, i), []));
        if (lv.length) out.push(this.bars('Land value — factors', lv, 'pts'));
        return out;
      }));
    }
    const zf = zone ? zoneFamily(zone) : null;
    if (!st.water[i]) this.body.appendChild(this.section('environment', 'Environment', 'leaf', '', () => this.environment(i, null, zf === 'R' || zf === 'C' || zf === 'I' ? zf : null)));
  }
}

function safeCall<T>(f: () => T, fallback: T): T {
  try {
    const v = f();
    return v === undefined ? fallback : v;
  } catch (e) {
    console.warn('[ui] inspector query failed', e);
    return fallback;
  }
}

/** (exported for tests / other panels) the state a building's inspector reads its cell from */
export function centerCellOf(st: CityState, b: Building): number {
  const N = st.size;
  return Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
}
