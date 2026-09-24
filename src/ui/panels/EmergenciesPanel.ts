/**
 * Emergencies panel (WP8, id 'emergencies'): three tabs.
 *   Active      every incident: kind, state, units, ETA, severity, time left; Jump + Dispatch buttons.
 *   Fleet       every fire / police / medical station: free / total units (funding), coverage range, power.
 *   Statistics  this month and the last 12 months: counts by kind, auto / player / late / failed, average response
 *               time per responder, deaths, injured, rescued, buildings lost, damage, arrests, riot days; medical
 *               response score.
 */
import type { GameContext } from '../../game/context';
import { INCIDENT_KINDS, RESPONDERS, type EmergencyMonth, type Responder } from '../../sim/CityState';
import { INCIDENT_COLOR, INCIDENT_LABEL, INCIDENT_RESPONDERS, RESPONDER_LABEL, RESPONDER_UNIT, emergencyOf, type Incident } from '../../sim/infra/emergency';
import { openDispatch } from '../../game/tools/DispatchTool';
import { Panel } from '../Panel';
import { clear, h, setText } from '../dom';
import { icon } from '../icons';
import { money, num, pct } from '../format';
import { emgTime, kindIcon, minText, placeText, stateText } from '../EmergencyBanner';

type Tab = 'active' | 'fleet' | 'stats';
const RESP_ICON: Record<Responder, string> = { fire: 'fire', police: 'police', medical: 'health' };

export class EmergenciesPanel extends Panel {
  readonly id = 'emergencies';
  readonly title = 'Emergencies';
  override icon = 'alert';
  override width = 470;
  private tab: Tab = 'active';
  private tabBtns: Partial<Record<Tab, HTMLButtonElement>> = {};
  private content!: HTMLDivElement;
  private sig = '';

  constructor(ctx: GameContext) {
    super(ctx);
  }

  protected build(): void {
    const tabs = h('div', { class: 'tabs' });
    for (const [id, label] of [['active', 'Active'], ['fleet', 'Fleet'], ['stats', 'Statistics']] as const) {
      const b = h('button', null, label) as HTMLButtonElement;
      b.addEventListener('click', () => this.showTab(id));
      this.tabBtns[id] = b;
      tabs.appendChild(b);
    }
    this.el.insertBefore(tabs, this.body);
    this.content = h('div', { class: 'emg-panel' });
    this.body.appendChild(this.content);
  }

  showTab(t: Tab): void {
    this.tab = t;
    this.sig = '';
    this.update();
  }

  override update(): void {
    for (const [k, b] of Object.entries(this.tabBtns)) b?.classList.toggle('on', k === this.tab);
    const em = emergencyOf(this.ctx.sim);
    if (!em || !em.active) {
      if (this.sig !== 'none') {
        this.sig = 'none';
        clear(this.content);
        this.content.appendChild(h('div', { class: 'faint', style: 'padding:14px' }, 'The emergency service is not running.'));
      }
      return;
    }
    if (this.tab === 'active') this.renderActive();
    else if (this.tab === 'fleet') this.renderFleet();
    else this.renderStats();
  }

  // ---------------------------------------------------------------------------------------------- active
  private renderActive(): void {
    const sim = this.ctx.sim;
    const em = emergencyOf(sim)!;
    const list = [...em.incidents()].sort((a, b) => rank(a) - rank(b) || a.start - b.start);
    const now = sim.simTime();
    const sig = 'a' + list.map((i) => `${i.id}:${i.state}:${i.units.length}:${i.fires.length}:${Math.floor((i.deadline - now) * 4)}:${i.etaMin ?? ''}`).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.content);
    const s = this.ctx.state.stats.emergency;
    this.content.appendChild(h('div', { class: 'emg-sum' },
      chip('Active', num(list.length)), chip('Need you', num(s.manualActive), s.manualActive ? 'bad' : ''),
      chip('This month', num(sumCount(s.month))), chip('Auto-dispatched', pct(autoShare(s.year))),
    ));
    if (!list.length) {
      this.content.appendChild(h('div', { class: 'emg-empty' }, h('span', { html: icon('check', 18) }), h('span', null, 'No emergencies right now. Covered incidents are answered automatically and show up in Statistics.')));
      return;
    }
    for (const inc of list) {
      const waiting = inc.state === 'uncovered' || inc.state === 'queued';
      const left = inc.deadline - now;
      const units = inc.units.length;
      const need = INCIDENT_RESPONDERS[inc.kind].map((r) => `${inc.need[r] ?? 0} ${RESPONDER_UNIT[r][(inc.need[r] ?? 0) === 1 ? 0 : 1]}`).join(' + ');
      const jump = h('button', { class: 'btn sm', title: 'Show on the map', html: icon('target', 13) });
      jump.addEventListener('click', () => {
        this.ctx.focusCell(inc.x, inc.z, 420);
        this.ctx.showQuery({ buildingId: inc.buildingId >= 0 ? inc.buildingId : null, x: inc.x, z: inc.z });
      });
      const disp = h('button', { class: 'btn sm' + (waiting ? ' primary' : ''), title: 'Dispatch a unit yourself' }, 'Dispatch');
      disp.addEventListener('click', () => openDispatch(this.ctx, inc.id));
      const sev = inc.kind === 'fire' ? `${inc.fires.length} burning` : inc.kind === 'riot' ? `radius ${Math.round(inc.radius)}` : inc.injured > 0 ? `${inc.injured} hurt` : '';
      this.content.appendChild(h('div', { class: 'emg-row' + (waiting ? ' waiting' : ''), style: { '--kc': INCIDENT_COLOR[inc.kind] } as Record<string, string> },
        h('div', { class: 'emg-ico sm', html: kindIcon(inc.kind, 16) }),
        h('div', { class: 'emg-rb' },
          h('div', { class: 'emg-rt' }, h('b', null, INCIDENT_LABEL[inc.kind]), inc.major ? h('span', { class: 'emg-tag' }, 'MAJOR') : null, h('span', { class: 'faint' }, ` · ${placeText(inc)}`)),
          h('div', { class: 'emg-rs' + (waiting ? ' neg' : '') }, waiting && inc.note ? inc.note : stateText(inc, now, em)),
          h('div', { class: 'emg-rs faint' }, `Needs ${need} · ${units} assigned${sev ? ' · ' + sev : ''} · ${emgTime(now - inc.start)} ago${waiting && left > 0 ? ` · ${emgTime(left)} left` : ''}`),
        ),
        h('div', { class: 'emg-rbtn' }, jump, disp),
      ));
    }
  }

  // ---------------------------------------------------------------------------------------------- fleet
  private renderFleet(): void {
    const em = emergencyOf(this.ctx.sim)!;
    const stations = em.stationList();
    const f = this.ctx.state.budget?.funding ?? {};
    const sig = 'f' + stations.map((s) => `${s.id}:${s.free}:${s.units}:${s.powered}`).join('|') + JSON.stringify(f);
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.content);
    for (const r of RESPONDERS) {
      const list = stations.filter((s) => s.responder === r);
      const tot = list.reduce((a, s) => a + s.units, 0), free = list.reduce((a, s) => a + s.free, 0);
      const svc = r === 'medical' ? 'health' : r;
      const fund = (f as Record<string, number>)[svc];
      this.content.appendChild(h('div', { class: 'sec-title', html: `${icon(RESP_ICON[r], 13)}<span>${RESPONDER_LABEL[r]} — ${free} of ${tot} ${RESPONDER_UNIT[r][1]} free${fund !== undefined ? ` · funding ${Math.round(fund)}%` : ''}</span>` }));
      if (!list.length) {
        this.content.appendChild(h('div', { class: 'emg-rs faint', style: 'padding:2px 4px 8px' }, `No ${r === 'medical' ? 'clinic or hospital' : r + ' station'} yet — emergencies of this kind can't be answered.`));
        continue;
      }
      for (const s of list) {
        const bar = h('div', { class: 'emg-units' });
        for (let k = 0; k < Math.max(s.units, s.base); k++) bar.appendChild(h('i', { class: k < s.free ? 'free' : k < s.units ? 'out' : 'off', title: k < s.free ? 'free' : k < s.units ? 'on a call' : 'not funded' }));
        const jump = h('button', { class: 'btn sm', title: 'Show on the map', html: icon('target', 13) });
        jump.addEventListener('click', () => this.ctx.focusCell(s.x, s.z, 420));
        this.content.appendChild(h('div', { class: 'emg-row' },
          h('div', { class: 'emg-ico sm', style: { '--kc': r === 'fire' ? '#e8542c' : r === 'police' ? '#3d6fd8' : '#e8e8e8' } as Record<string, string>, html: icon(RESP_ICON[r], 16) }),
          h('div', { class: 'emg-rb' },
            h('div', { class: 'emg-rt' }, h('b', null, s.name)),
            h('div', { class: 'emg-rs faint' }, `${s.free}/${s.units} ${RESPONDER_UNIT[r][1]} · auto-dispatch within ${minText(s.range)}${s.powered ? '' : ' · no power: slow turnout'}${s.units < s.base ? ' · underfunded' : ''}`),
            bar,
          ),
          h('div', { class: 'emg-rbtn' }, jump),
        ));
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- stats
  private renderStats(): void {
    const e = this.ctx.state.stats.emergency;
    const sig = 's' + JSON.stringify(e.month) + JSON.stringify(e.year) + e.medScore.toFixed(3);
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.content);
    const cols: [string, EmergencyMonth][] = [['This month', e.month], ['12 months', e.year]];
    const table = h('table', { class: 'emg-table' });
    const row = (label: string, f: (m: EmergencyMonth) => string, cls = '') => {
      table.appendChild(h('tr', { class: cls }, h('td', null, label), ...cols.map(([, m]) => h('td', null, f(m)))));
    };
    table.appendChild(h('tr', { class: 'hd' }, h('td', null, ''), ...cols.map(([l]) => h('td', null, l))));
    row('Incidents', (m) => num(sumCount(m)), 'strong');
    for (const k of INCIDENT_KINDS) {
      if (!e.year.count[k] && !e.month.count[k]) continue;
      row(`  ${INCIDENT_LABEL[k]}`, (m) => num(m.count[k]));
    }
    row('Auto-dispatched', (m) => num(m.auto));
    row('Dispatched by you', (m) => num(m.manual));
    row('Late', (m) => num(m.late));
    row('Failed', (m) => num(m.failed), 'neg');
    for (const r of RESPONDERS) row(`Avg. ${RESPONDER_LABEL[r].toLowerCase()} response`, (m) => (m.responses[r] ? minText(m.responseMin[r] / m.responses[r]) : '—'));
    row('Injured', (m) => num(m.injured));
    row('Rescued', (m) => num(m.rescued));
    row('Deaths', (m) => num(m.deaths), 'neg');
    row('Buildings lost', (m) => num(m.buildingsLost));
    row('Damage', (m) => money(Math.round(m.damage)));
    row('Arrests', (m) => num(m.arrests));
    row('Riot days', (m) => num(m.riotDays));
    this.content.append(
      h('div', { class: 'emg-sum' },
        chip('Auto-dispatched', pct(autoShare(e.year))), chip('Failed', num(e.year.failed), e.year.failed ? 'bad' : ''),
        chip('Medical response', pct(e.medScore), e.medScore < 0.8 ? 'bad' : ''),
      ),
      table,
      h('div', { class: 'emg-rs faint', style: 'padding:8px 2px 0' }, 'Incidents within a station’s reach (Fleet tab: “auto-dispatch within … min” of driving) are answered automatically along real roads and only show up here. Anything farther needs you to dispatch a unit. Build stations near the gaps (Fire / Police / Health data views), keep their budgets funded, and add more when all units are often busy.'),
    );
  }
}

function rank(i: Incident): number {
  return i.state === 'uncovered' ? 0 : i.state === 'queued' ? 1 : i.state === 'dispatched' ? 2 : 3;
}
function sumCount(m: EmergencyMonth): number {
  let s = 0;
  for (const k of INCIDENT_KINDS) s += m.count[k] ?? 0;
  return s;
}
function autoShare(m: EmergencyMonth): number {
  const t = m.auto + m.manual + m.failed;
  return t > 0 ? m.auto / t : 1;
}
function chip(label: string, value: string, cls = ''): HTMLElement {
  const v = h('div', { class: 'sc-v ' + (cls === 'bad' ? 'neg' : '') });
  setText(v, value);
  return h('div', { class: 'stat-card' }, h('div', { class: 'sc-l' }, label), v);
}
