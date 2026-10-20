/** Ordinances and Rewards panels (data from sim-core's listOrdinances / listRewards when available). */
import type { GameContext } from '../../game/context';
import { allDefs, defIcon } from '../../game/toolCatalog';
import type { OrdinanceInfo, RewardInfo } from '../../game/modules';
import type { BuildingDef } from '../../sim/catalogTypes';
import { BF, type Building } from '../../sim/CityState';
import type { SimSystem } from '../../sim/Simulation';
import type { EconRuntime } from '../../sim/economy/runtime';
import { Panel } from '../Panel';
import { confirmDialog } from '../Modals';
import { clear, escapeHtml, h, toggle } from '../dom';
import { icon } from '../icons';
import { money, titleCase } from '../format';
import { upkeepEstimate } from '../upkeepModel';

/** the plopped buildings by def: the defs with a standing building, and one ruin (BF.Burnt) of every def that has one */
export interface RuinState {
  live: Set<string>;
  ruin: Map<string, Building>;
}

/** RuinState of a list of buildings (the economy runtime's plopped list, or every building: only plopped ones count) */
export function ruinState(list: Iterable<Building>): RuinState {
  const live = new Set<string>(), ruin = new Map<string, Building>();
  for (const b of list) {
    if (!(b.flags & BF.Plopped)) continue;
    if (b.flags & BF.Burnt) {
      if (!ruin.has(b.def)) ruin.set(b.def, b);
    } else live.add(b.def);
  }
  return { live, ruin };
}

/**
 * The ruin a reward lies in (final fixes r3): one of its buildings is a ruin — burnt down, or flattened by a tornado, a
 * quake or a meteor — and none of them stands. It read "Built" while its deal income and effects had stopped (and
 * placing it again is refused while the ruin stands). null: not in ruins.
 */
export function rewardRuin(defIds: readonly string[], s: RuinState): Building | null {
  if (defIds.some((d) => s.live.has(d))) return null;
  for (const d of defIds) {
    const b = s.ruin.get(d);
    if (b) return b;
  }
  return null;
}

/** the Rewards panel's status chip of a reward in ruins */
export const REWARD_RUIN_TEXT = 'In ruins — bulldoze to rebuild';

function ordIcon(o: OrdinanceInfo): string {
  const s = (o.id + ' ' + o.name + ' ' + (o.category ?? '')).toLowerCase();
  const rules: [RegExp, string][] = [
    [/recycl/, 'recycle'], [/smoke|pollut|clean air|emission/, 'smog'], [/water|conserv/, 'water'], [/power|energy/, 'power'],
    [/crime|police|neighbo|watch|curfew/, 'police'], [/fire|smoke detector/, 'fire'], [/health|clinic|smok/, 'health'],
    [/school|educat|tutor|reading/, 'education'], [/casino|gambl|tour/, 'star'], [/car|traffic|carpool|commute/, 'car'],
    [/tree|park|green/, 'leaf'], [/tax|business|deal|legaliz/, 'budget'], [/noise/, 'noise'],
  ];
  for (const [re, ic] of rules) if (re.test(s)) return ic;
  return 'ordinances';
}

/** good / bad tone of an effect string like "−10% crime" or "+1 approval" */
function effectTone(e: string): 'good' | 'bad' | 'info' {
  const m = e.trim().match(/^([+\-−])/);
  if (!m) return 'info';
  const up = m[1] === '+';
  const badThing = /crime|pollution|fire|traffic|garbage|noise|risk|cost|expense|tax/i.test(e);
  const goodThing = /approval|education|health|income|land value|demand|effectiveness|coverage|eq|hq|happiness|tourism/i.test(e);
  if (badThing && !goodThing) return up ? 'bad' : 'good';
  if (goodThing) return up ? 'good' : 'bad';
  return 'info';
}

export class OrdinancesPanel extends Panel {
  readonly id = 'ordinances';
  readonly title = 'Ordinances';
  override icon = 'ordinances';
  override width = 480;
  private listEl!: HTMLDivElement;
  private sig = '';

  protected build(): void {
    this.listEl = h('div', { class: 'list' });
    this.body.appendChild(this.listEl);
  }

  private list(): OrdinanceInfo[] | null {
    const f = this.ctx.mods.listOrdinances;
    if (!f) return null;
    try {
      return f(this.ctx.state);
    } catch (e) {
      console.warn('[ui] listOrdinances failed', e);
      return [];
    }
  }

  override onOpen(): void {
    this.sig = '';
  }

  override update(): void {
    const items = this.list();
    const sig = items ? items.map((o) => `${o.id}:${o.enabled}:${o.available}:${o.monthlyCost}`).join('|') + this.ctx.state.budget.ordinances.join(',') : 'none';
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.listEl);
    if (!items || !items.length) {
      this.listEl.appendChild(h('div', { class: 'empty', html: icon('ordinances', 28) + '<div>No ordinances are available yet.<br>The city council will propose some as your city grows.</div>' }));
      return;
    }
    const enabledIds = new Set(this.ctx.state.budget.ordinances);
    let total = 0;
    for (const o of items) {
      const on = o.enabled || enabledIds.has(o.id);
      if (on) total += o.monthlyCost;
      const sw = toggle(on, (v) => {
        let r: { ok: boolean; reason?: string; needsConfirm?: boolean } | null = null;
        try {
          r = this.ctx.actions.setOrdinance(o.id, v);
        } catch (e) {
          console.warn(e);
        }
        if (r && !r.ok && r.needsConfirm) {
          // WP5-6: it would shut existing buildings down (nuclear-free zone) — ask first, then enact with confirm
          void confirmDialog(this.ctx, {
            title: `Enact ${o.name}?`,
            message: 'This ordinance takes effect immediately:',
            items: [(r.reason ?? 'It shuts existing buildings down').replace(/^Demolish (.*) first: this ordinance would shut (it|them) down/, 'It shuts down $1'), 'The lost power must come from other plants — check the grid first'],
            confirm: 'Enact anyway',
            danger: true,
          }).then((yes) => {
            if (yes) {
              let r2: { ok: boolean; reason?: string } | null = null;
              try {
                r2 = this.ctx.actions.setOrdinance(o.id, true, { confirm: true });
              } catch (e) {
                console.warn(e);
              }
              if (r2 && !r2.ok) {
                this.ctx.toast(r2.reason ?? 'The council rejected this ordinance', 'error');
                this.ctx.sound('error');
              } else this.ctx.sound('toggleOn');
            }
            this.sig = '';
            this.update();
          });
          this.sig = '';
          this.update();
          return;
        }
        if (r && !r.ok) {
          this.ctx.toast(r.reason ?? 'The council rejected this ordinance', 'error');
          this.ctx.sound('error');
        } else this.ctx.sound(v ? 'toggleOn' : 'toggleOff');
        this.sig = '';
        this.update();
      }, !o.available);
      const cost = o.monthlyCost;
      const effects = h('div', { class: 'li-e' });
      for (const e of o.effects.slice(0, 5)) effects.appendChild(h('span', { class: 'chip ' + effectTone(e) }, e));
      const row = h('div', { class: 'li' + (on ? ' on' : '') + (!o.available ? ' locked' : '') },
        h('div', { class: 'li-ico', html: icon(ordIcon(o), 17) }),
        h('div', null,
          h('div', { class: 'li-t' }, o.name),
          o.description ? h('div', { class: 'li-d' }, o.description) : null,
          !o.available && o.requirement ? h('div', { class: 'li-d warn', html: icon('lock', 12) + ' ' + escapeHtml(o.requirement) }) : null,
          o.effects.length ? effects : null,
        ),
        h('div', { class: 'li-r' }, sw, cost ? h('span', { class: cost > 0 ? 'neg' : 'pos' }, cost > 0 ? `−${money(cost)}/mo` : `+${money(-cost)}/mo`) : h('span', { class: 'faint' }, 'Free')),
      );
      this.listEl.appendChild(row);
    }
    this.listEl.appendChild(h('div', { class: 'net-card', style: 'margin-top:6px' }, h('span', { class: 'dim' }, 'Monthly ordinance balance'), h('span', { class: 'nc-v ' + (total > 0 ? 'neg' : total < 0 ? 'pos' : ''), style: 'font-size:16px' }, total > 0 ? `−${money(total)}` : total < 0 ? `+${money(-total)}` : money(0))));
  }
}

export class RewardsPanel extends Panel {
  readonly id = 'rewards';
  readonly title = 'Rewards & unlocks';
  override icon = 'trophy';
  override width = 480;
  private listEl!: HTMLDivElement;

  protected build(): void {
    this.listEl = h('div', { class: 'list' });
    this.body.appendChild(this.listEl);
  }

  private list(): RewardInfo[] {
    const f = this.ctx.mods.listRewards;
    const st = this.ctx.state;
    if (f) {
      try {
        return f(st);
      } catch (e) {
        console.warn('[ui] listRewards failed', e);
      }
    }
    // fallback: derive from catalog `requires`
    const out: RewardInfo[] = [];
    const seen = new Set<string>();
    for (const d of allDefs()) {
      if (!d.requires || seen.has(d.requires)) continue;
      seen.add(d.requires);
      const un = st.unlocked.has(d.requires) || !!st.config.sandbox;
      out.push({ id: d.requires, name: d.name, description: d.description ?? '', unlocked: un, progress: un ? 1 : 0, requirement: titleCase(d.requires), defId: d.id, defIds: [d.id] });
    }
    return out;
  }

  override onOpen(): void {
    this.resetGate();
  }

  /** the city's plopped buildings as standing / in ruins: the economy runtime's plopped list (the StatsPanel pattern),
   *  else every building — read on each update (a disaster can flatten a reward while the game is paused) */
  private ruins(): RuinState {
    const st = this.ctx.state;
    let list: Iterable<Building> = st.buildings.values();
    try {
      const rt = this.ctx.sim.getSystem<SimSystem & { rt?: EconRuntime }>('economy.population')?.rt;
      if (rt) {
        rt.ensureLists();
        list = rt.plopped;
      }
    } catch {
      /* the whole city */
    }
    return ruinState(list);
  }

  /** open the inspector on a reward's ruin, where its Clear rubble button is (the camera goes there). This panel closes
   *  first: the inspector then takes its usual place, not the free spot beside this panel over the ruin */
  private showRuin(b: Building): void {
    this.ctx.panels.close(this.id);
    this.ctx.focusCell(b.x + b.w / 2 - 0.5, b.z + b.d / 2 - 0.5, 360);
    this.ctx.showQuery({ buildingId: b.id, x: b.x, z: b.z }, { silent: true });
  }

  override update(): void {
    const items = this.list();
    const rs = this.ruins();
    const ruinOf = (r: RewardInfo) => (r.built ? rewardRuin(r.defIds, rs) : null);
    // (final fixes A1: the progress bars move with every percent of a growing city — a data-only change rebuilds the
    // list at most once per real second, Panel.gate; a reward falling into ruins — or its ruin cleared — rebuilds it too)
    const sig = items.map((r) => `${r.id}:${r.unlocked}:${r.built}:${ruinOf(r)?.id ?? ''}:${Math.round(r.progress * 100)}:${r.requirement}`).join('|');
    if (!this.gate('rewards', sig)) return;
    clear(this.listEl);
    if (!items.length) {
      this.listEl.appendChild(h('div', { class: 'empty', html: icon('trophy', 28) + '<div>Rewards unlock as your city reaches milestones.</div>' }));
      return;
    }
    const sorted = items.slice().sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || b.progress - a.progress);
    for (const r of sorted) {
      const defs = r.defIds.map((id) => allDefs().find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d);
      const def = defs[0];
      const ruin = ruinOf(r);
      const place = def && r.unlocked ? h('div', { style: 'display:flex;flex-direction:column;gap:4px;align-items:flex-end' }) : null;
      if (place && ruin) {
        // (in ruins: the inspector of the ruin, whose button clears the rubble — a one-per-city building can only be
        // placed again once the ruin is gone)
        const b = h('button', { class: 'btn sm', title: 'Show the ruins on the map — bulldoze them there, then place it again', html: icon('target', 13) + '<span>Show ruins</span>' });
        b.addEventListener('click', () => this.showRuin(ruin));
        place.appendChild(b);
      }
      if (place)
        for (const d of defs.slice(0, 3)) {
          if (ruin && d.unique) continue;
          const b = h('button', { class: 'btn sm primary', title: `Place ${d.name}`, html: icon('plus', 13) + `<span>${defs.length > 1 ? escapeHtml(d.name) : 'Place'}</span>` });
          b.addEventListener('click', () => {
            if (this.ctx.tools.select('plop:' + d.id)) this.ctx.panels.close(this.id);
          });
          place.appendChild(b);
        }
      const status = ruin
        ? h('span', { class: 'chip bad', style: 'max-width:150px;white-space:normal;text-align:right;line-height:1.25', title: 'It lies in ruins: no income and no effects until you bulldoze the rubble and build it again', html: icon('alert', 11) + `<span>${escapeHtml(REWARD_RUIN_TEXT)}</span>` })
        : r.built ? h('span', { class: 'chip info', html: icon('check', 11) + 'Built' }) : r.unlocked ? h('span', { class: 'chip good', html: icon('check', 11) + 'Unlocked' }) : h('span', { class: 'chip warn', html: icon('lock', 11) + 'Locked' });
      const row = h('div', { class: 'li' + (r.unlocked ? ' on' : ' locked') },
        h('div', { class: 'li-ico', html: icon(def ? defIcon(def) : 'trophy', 17) }),
        h('div', null,
          h('div', { class: 'li-t' }, r.name),
          r.description ? h('div', { class: 'li-d' }, r.description) : null,
          !r.unlocked
            ? h('div', { class: 'reward-prog' }, h('div', { class: 'bar warn' }, h('div', { class: 'fill', style: { width: `${Math.round(r.progress * 100)}%` } })), h('span', null, r.requirement || `${Math.round(r.progress * 100)}%`))
            : null,
          def ? h('div', { class: 'li-e' }, h('span', { class: 'chip' }, def.cost ? money(def.cost) : 'Free'), this.upkeepChip(def), def.income ? h('span', { class: 'chip good', title: def.category === 'reward' ? 'Deal income' : 'Income when busy — less while it is quiet (its inspector shows what it earns now)' }, `+${money(def.income)}/mo`) : null) : null,
        ),
        h('div', { class: 'li-r' }, status, place),
      );
      this.listEl.appendChild(row);
    }
  }

  /** the upkeep chip: the build menu's estimate for running-cost facilities ("≈§A/mo typical", the whole "typical in
   *  this city · up to §B at full use" on hover — final fixes P3: the panel showed the catalog upkeep, a third number;
   *  UI-1: the city-wide typical load, 2-11x what one more costs at a given spot in a big city, not a promise), else
   *  the flat upkeep */
  private upkeepChip(def: BuildingDef): HTMLElement | null {
    if (!def.upkeep) return null;
    const est = upkeepEstimate(this.ctx.state, def);
    return est ? h('span', { class: 'chip', title: `Upkeep ${est.title}` }, `≈${money(est.now)}/mo typical`) : h('span', { class: 'chip', title: 'Upkeep' }, `${money(def.upkeep)}/mo`);
  }

  newUnlocks(): number {
    return this.list().filter((r) => r.unlocked).length;
  }
}
