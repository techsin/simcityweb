/** Ordinances and Rewards panels (data from sim-core's listOrdinances / listRewards when available). */
import type { GameContext } from '../../game/context';
import { allDefs, defIcon } from '../../game/toolCatalog';
import type { OrdinanceInfo, RewardInfo } from '../../game/modules';
import { Panel } from '../Panel';
import { clear, escapeHtml, h, toggle } from '../dom';
import { icon } from '../icons';
import { money, titleCase } from '../format';

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
        let r: { ok: boolean; reason?: string } | null = null;
        try {
          r = this.ctx.actions.setOrdinance(o.id, v);
        } catch (e) {
          console.warn(e);
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
  private sig = '';

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
    this.sig = '';
  }

  override update(): void {
    const items = this.list();
    const sig = items.map((r) => `${r.id}:${r.unlocked}:${r.built}:${Math.round(r.progress * 100)}:${r.requirement}`).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    clear(this.listEl);
    if (!items.length) {
      this.listEl.appendChild(h('div', { class: 'empty', html: icon('trophy', 28) + '<div>Rewards unlock as your city reaches milestones.</div>' }));
      return;
    }
    const sorted = items.slice().sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || b.progress - a.progress);
    for (const r of sorted) {
      const defs = r.defIds.map((id) => allDefs().find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d);
      const def = defs[0];
      const place = def && r.unlocked ? h('div', { style: 'display:flex;flex-direction:column;gap:4px;align-items:flex-end' }) : null;
      if (place)
        for (const d of defs.slice(0, 3)) {
          const b = h('button', { class: 'btn sm primary', title: `Place ${d.name}`, html: icon('plus', 13) + `<span>${defs.length > 1 ? escapeHtml(d.name) : 'Place'}</span>` });
          b.addEventListener('click', () => {
            if (this.ctx.tools.select('plop:' + d.id)) this.ctx.panels.close(this.id);
          });
          place.appendChild(b);
        }
      const row = h('div', { class: 'li' + (r.unlocked ? ' on' : ' locked') },
        h('div', { class: 'li-ico', html: icon(def ? defIcon(def) : 'trophy', 17) }),
        h('div', null,
          h('div', { class: 'li-t' }, r.name),
          r.description ? h('div', { class: 'li-d' }, r.description) : null,
          !r.unlocked
            ? h('div', { class: 'reward-prog' }, h('div', { class: 'bar warn' }, h('div', { class: 'fill', style: { width: `${Math.round(r.progress * 100)}%` } })), h('span', null, r.requirement || `${Math.round(r.progress * 100)}%`))
            : null,
          def ? h('div', { class: 'li-e' }, h('span', { class: 'chip' }, def.cost ? money(def.cost) : 'Free'), def.upkeep ? h('span', { class: 'chip' }, `${money(def.upkeep)}/mo`) : null, def.income ? h('span', { class: 'chip good' }, `+${money(def.income)}/mo`) : null) : null,
        ),
        h('div', { class: 'li-r' }, r.built ? h('span', { class: 'chip info', html: icon('check', 11) + 'Built' }) : r.unlocked ? h('span', { class: 'chip good', html: icon('check', 11) + 'Unlocked' }) : h('span', { class: 'chip warn', html: icon('lock', 11) + 'Locked' }), place),
      );
      this.listEl.appendChild(row);
    }
  }

  newUnlocks(): number {
    return this.list().filter((r) => r.unlocked).length;
  }
}
