/** Budget: taxes per DevType, service funding, last month ledger (grouped by key prefix), loans, projected net. */
import { DEV_TYPE_LABELS, DevType } from '../../core/types';
import type { ServiceKind } from '../../sim/catalogTypes';
import { getDef } from '../../sim/catalog';
import type { GameContext } from '../../game/context';
import { Panel } from '../Panel';
import { clear, h, setSlider, setText, slider, toggleClass } from '../dom';
import { icon } from '../icons';
import { money, moneySigned, signClass, titleCase } from '../format';
import { sumValues } from '../TopBar';

const TAX_GROUPS: { label: string; color: string; devs: DevType[] }[] = [
  { label: 'Residential', color: 'var(--res)', devs: [DevType.R1, DevType.R2, DevType.R3] },
  { label: 'Commercial', color: 'var(--com)', devs: [DevType.CS1, DevType.CS2, DevType.CS3, DevType.CO2, DevType.CO3] },
  { label: 'Industrial', color: 'var(--ind)', devs: [DevType.IA, DevType.ID, DevType.IM, DevType.IHT] },
];

export const SERVICES: { key: ServiceKind; label: string; icon: string }[] = [
  { key: 'police', label: 'Police', icon: 'police' },
  { key: 'fire', label: 'Fire', icon: 'fire' },
  { key: 'health', label: 'Health', icon: 'health' },
  { key: 'education', label: 'Education', icon: 'education' },
  { key: 'transit', label: 'Transit', icon: 'bus' },
  { key: 'parks', label: 'Parks', icon: 'park' },
  { key: 'utilities', label: 'Utilities', icon: 'utilities' },
  { key: 'roads', label: 'Roads', icon: 'road' },
];

const GROUP_LABELS: Record<string, string> = {
  tax: 'Taxes', service: 'City services', transport: 'Transportation', ordinance: 'Ordinances', loan: 'Loan payments', loans: 'Loan payments',
  deal: 'Business deals', utilities: 'Utilities', neighbor: 'Neighbor deals', construction: 'Construction', zoning: 'Zoning', bulldoze: 'Demolition',
  income: 'Income', building: 'Buildings', upkeep: 'Upkeep', terraform: 'Terraforming', trees: 'Trees',
};

function taxKeys(d: DevType): string[] {
  return [`tax:${DEV_TYPE_LABELS[d]}`, `tax:${DevType[d]}`, `tax:${d}`];
}
function lookup(rec: Record<string, number>, keys: string[]): number {
  for (const k of keys) if (rec[k] !== undefined) return rec[k];
  return 0;
}
function serviceKeys(s: ServiceKind): string[] {
  return [`service:${s}`, `transport:${s}`, `services:${s}`, s];
}

export class BudgetPanel extends Panel {
  readonly id = 'budget';
  readonly title = 'Budget';
  override icon = 'budget';
  override width = 720;
  private tab: 'taxes' | 'services' | 'ledger' | 'loans' = 'taxes';
  private tabBtns: Record<string, HTMLButtonElement> = {};
  private content!: HTMLDivElement;
  private taxSliders = new Map<DevType, { s: HTMLInputElement; v: HTMLElement; m: HTMLElement }>();
  private fundSliders = new Map<ServiceKind, { s: HTMLInputElement; v: HTMLElement; m: HTMLElement }>();
  private netEls!: { inc: HTMLElement; exp: HTMLElement; net: HTMLElement; note: HTMLElement; funds: HTMLElement };
  /** rates / funding in effect when last month's report was produced (for projections) */
  private snapTax: number[];
  private snapFund: Record<string, number>;

  constructor(ctx: GameContext) {
    super(ctx);
    this.snapTax = [...ctx.state.budget.taxRates];
    this.snapFund = { ...ctx.state.budget.funding };
    ctx.sim.events.on('month', () => {
      this.snapTax = [...ctx.state.budget.taxRates];
      this.snapFund = { ...ctx.state.budget.funding };
      if (this.isOpen) this.renderTab();
    });
  }

  override defaultPos(w: number, hh: number): { x: number; y: number } {
    return { x: Math.max(14, (w - this.width) / 2), y: Math.max(72, (hh - 640) / 2) };
  }

  protected build(): void {
    const tabs = h('div', { class: 'tabs' });
    for (const [id, label] of [['taxes', 'Taxes'], ['services', 'Services'], ['ledger', 'Income & expenses'], ['loans', 'Loans']] as const) {
      const b = h('button', null, label) as HTMLButtonElement;
      b.addEventListener('click', () => {
        this.tab = id;
        this.renderTab();
        b.blur();
      });
      this.tabBtns[id] = b;
      tabs.appendChild(b);
    }
    const inc = h('div', { class: 'nc-v pos' }), exp = h('div', { class: 'nc-v neg' }), net = h('div', { class: 'nc-v' }), note = h('div', { class: 'dim', style: 'font-size:11px;margin-top:2px' }), funds = h('div', { class: 'nc-v' });
    this.netEls = { inc, exp, net, note, funds };
    const card = (l: string, v: HTMLElement, sub?: HTMLElement) => h('div', null, h('div', { class: 'hud-label', style: 'margin-bottom:5px' }, l), v, sub ?? null);
    const summary = h('div', { class: 'net-card', style: 'margin:0 0 12px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px' },
      card('Treasury', funds), card('Income / mo', inc), card('Expenses / mo', exp), card('Projected net', net, note));
    this.content = h('div');
    // tabs sit between the head and the body
    this.el.insertBefore(tabs, this.body);
    this.body.append(summary, this.content);
    this.renderTab();
  }

  override onOpen(): void {
    this.renderTab();
  }

  private renderTab(): void {
    for (const [id, b] of Object.entries(this.tabBtns)) toggleClass(b, 'on', id === this.tab);
    clear(this.content);
    this.taxSliders.clear();
    this.fundSliders.clear();
    if (this.tab === 'taxes') this.renderTaxes();
    else if (this.tab === 'services') this.renderServices();
    else if (this.tab === 'ledger') this.renderLedger();
    else this.renderLoans();
    this.update();
  }

  private setTax(d: DevType, v: number): void {
    try {
      this.ctx.actions.setTax(d, v);
    } catch (e) {
      console.warn(e);
      this.ctx.state.budget.taxRates[d] = v;
    }
  }

  private renderTaxes(): void {
    const b = this.ctx.state.budget;
    const cols = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px 24px' });
    TAX_GROUPS.forEach((g) => {
      const box = h('div', { class: 'tax-group' });
      const avg = () => Math.round(g.devs.reduce((s, d) => s + b.taxRates[d], 0) / g.devs.length);
      const mv = h('span', { class: 'tr-v' }, avg() + '%');
      const master = slider({
        min: 0, max: 20, step: 0.5, value: avg(),
        oninput: (v) => {
          for (const d of g.devs) this.setTax(d, v);
          mv.textContent = v + '%';
          this.update();
        },
      });
      box.append(
        h('div', { class: 'sec-title', html: `<span class="zdot" style="background:${g.color}"></span><span>${g.label}</span>` }),
        h('div', { class: 'tax-row master' }, h('span', { class: 'tr-l' }, 'All'), master, mv, h('span', { class: 'tr-m' }, '')),
      );
      for (const d of g.devs) {
        const v = h('span', { class: 'tr-v' });
        const m = h('span', { class: 'tr-m' });
        const s = slider({
          min: 0, max: 20, step: 0.5, value: b.taxRates[d],
          oninput: (val) => {
            this.setTax(d, val);
            this.update();
          },
        });
        this.taxSliders.set(d, { s, v, m });
        box.appendChild(h('div', { class: 'tax-row', title: `Last month: ${money(lookup(b.lastIncome, taxKeys(d)))}` }, h('span', { class: 'tr-l' }, DEV_TYPE_LABELS[d]), s, v, m));
      }
      if (g.label === 'Industrial') cols.appendChild(box);
      else cols.appendChild(box);
    });
    const hint = h('div', { class: 'dim', style: 'font-size:11.5px;margin-top:10px;display:flex;gap:8px;align-items:center', html: icon('info', 14) + '<span>Taxes above ~12% slow growth and hurt approval; below ~7% attract newcomers but strain the budget.</span>' });
    this.content.append(cols, hint);
  }

  private renderServices(): void {
    const b = this.ctx.state.budget;
    this.content.appendChild(h('div', { class: 'sec-title' }, 'Funding (percent of full cost)'));
    const grid = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:2px 24px' });
    for (const s of SERVICES) {
      const v = h('span', { class: 'tr-v' });
      const m = h('span', { class: 'tr-m' });
      const sl = slider({
        min: 0, max: 150, step: 5, value: b.funding[s.key] ?? 100,
        oninput: (val) => {
          try {
            this.ctx.actions.setFunding(s.key, val);
          } catch {
            b.funding[s.key] = val;
          }
          this.update();
        },
      });
      this.fundSliders.set(s.key, { s: sl, v, m });
      grid.appendChild(h('div', { class: 'fund-row' }, h('span', { class: 'tr-l', html: icon(s.icon, 15) + `<span>${s.label}</span>` }), sl, v, m));
    }
    this.content.append(grid, h('div', { class: 'dim', style: 'font-size:11.5px;margin-top:12px;display:flex;gap:8px;align-items:center', html: icon('info', 14) + '<span>Under-funded services lose coverage and may strike; over-funding boosts effectiveness at extra cost.</span>' }));
  }

  private itemLabel(group: string, item: string): string {
    if (group === 'tax') return DEV_TYPE_LABELS.includes(item) ? item : titleCase(item);
    if (group === 'ordinance') {
      const o = this.ctx.mods.listOrdinances?.(this.ctx.state).find((x) => x.id === item);
      if (o) return o.name;
    }
    if (group === 'deal' || group === 'building') {
      const d = getDef(item);
      if (d) return d.name;
    }
    return titleCase(item);
  }

  private ledgerTable(rec: Record<string, number>, title: string, cls: 'pos' | 'neg'): HTMLElement {
    const groups = new Map<string, { total: number; items: [string, number][] }>();
    for (const [k, v] of Object.entries(rec)) {
      if (!v) continue;
      const i = k.indexOf(':');
      const g = i >= 0 ? k.slice(0, i) : k;
      const item = i >= 0 ? k.slice(i + 1) : '';
      const e = groups.get(g) ?? { total: 0, items: [] };
      e.total += v;
      if (item) e.items.push([item, v]);
      groups.set(g, e);
    }
    const t = h('table', { class: 'ledger' });
    const sorted = [...groups.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));
    if (!sorted.length) t.appendChild(h('tr', null, h('td', { class: 'dim', colspan: '2' }, 'No data yet')));
    for (const [g, e] of sorted) {
      t.appendChild(h('tr', { class: 'grp' }, h('td', null, GROUP_LABELS[g] ?? titleCase(g)), h('td', { class: cls }, money(e.total))));
      if (e.items.length > 1 || (e.items.length === 1 && e.items[0][0] !== g))
        for (const [it, v] of e.items.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))) t.appendChild(h('tr', { class: 'item' }, h('td', null, this.itemLabel(g, it)), h('td', null, money(v))));
    }
    t.appendChild(h('tr', { class: 'total' }, h('td', null, 'Total'), h('td', { class: cls }, money(sumValues(rec)))));
    return h('div', null, h('div', { class: 'sec-title' }, title), t);
  }

  private renderLedger(): void {
    const b = this.ctx.state.budget;
    const empty = !Object.keys(b.lastIncome).length && !Object.keys(b.lastExpense).length;
    if (empty) {
      this.content.appendChild(h('div', { class: 'empty', html: icon('calendar', 28) + '<div>The first monthly report arrives at the end of the month.</div>' }));
    }
    this.content.appendChild(h('div', { class: 'budget-cols' }, this.ledgerTable(b.lastIncome, 'Income — last month', 'pos'), this.ledgerTable(b.lastExpense, 'Expenses — last month', 'neg')));
    const curI = sumValues(b.curIncome), curE = sumValues(b.curExpense);
    if (curI || curE) this.content.appendChild(h('div', { class: 'dim', style: 'font-size:11.5px;margin-top:12px' }, `This month so far: ${money(curI)} income · ${money(curE)} expenses`));
  }

  private renderLoans(): void {
    const b = this.ctx.state.budget;
    this.content.appendChild(h('div', { class: 'sec-title' }, 'Outstanding loans'));
    if (!b.loans.length) this.content.appendChild(h('div', { class: 'dim', style: 'font-size:12.5px;padding:4px 0 8px' }, 'No outstanding loans.'));
    b.loans.forEach((l, i) => {
      const repay = h('button', { class: 'btn sm' }, `Repay ${money(l.remaining)}`);
      repay.addEventListener('click', () => {
        const r = this.safeAct(() => this.ctx.actions.repayLoan(i));
        if (r && !r.ok) this.ctx.toast(r.reason ?? 'Cannot repay', 'error');
        else this.ctx.sound('money');
        this.renderTab();
      });
      this.content.appendChild(h('div', { class: 'loan-row' },
        h('div', null, h('div', { style: 'font-weight:700' }, `${money(l.principal)} at ${(l.rate * 100).toFixed(1)}%`), h('div', { class: 'dim' }, `${money(l.monthlyPayment)}/mo · ${l.monthsLeft} months left · ${money(l.remaining)} remaining`)),
        repay));
    });
    this.content.appendChild(h('div', { class: 'sec-title' }, 'Take a loan'));
    const acts = h('div', { class: 'loan-actions' });
    const base = Math.max(10000, Math.round(this.ctx.state.stats.population * 5 / 10000) * 10000);
    for (const amt of [base, base * 2.5, base * 5, base * 10]) {
      const bt = h('button', { class: 'btn', html: icon('plus', 14) + `<span>${money(amt)}</span>` });
      bt.addEventListener('click', () => {
        const r = this.safeAct(() => this.ctx.actions.takeLoan(amt));
        if (r && !r.ok) this.ctx.toast(r.reason ?? 'The bank declined the loan', 'error');
        else this.ctx.sound('money');
        this.renderTab();
      });
      acts.appendChild(bt);
    }
    this.content.append(acts, h('div', { class: 'dim', style: 'font-size:11.5px;margin-top:10px' }, 'Loans are repaid in monthly installments with interest.'));
  }

  private safeAct<T>(f: () => T): T | null {
    try {
      return f();
    } catch (e) {
      console.warn(e);
      this.ctx.toast('Action unavailable', 'error');
      return null;
    }
  }

  /** projected monthly income / expense from last month, scaled by tax & funding changes */
  projection(): { inc: number; exp: number; hasData: boolean } {
    const b = this.ctx.state.budget;
    const hasData = Object.keys(b.lastIncome).length + Object.keys(b.lastExpense).length > 0;
    let inc = 0, exp = 0;
    const taxHandled = new Set<string>();
    for (let d = 0; d < DEV_TYPE_LABELS.length; d++) {
      for (const k of taxKeys(d)) {
        if (b.lastIncome[k] !== undefined) {
          const old = this.snapTax[d] || 0;
          inc += old > 0 ? (b.lastIncome[k] * b.taxRates[d]) / old : b.lastIncome[k];
          taxHandled.add(k);
          break;
        }
      }
    }
    for (const [k, v] of Object.entries(b.lastIncome)) if (!taxHandled.has(k)) inc += v;
    const svcHandled = new Set<string>();
    for (const s of SERVICES) {
      for (const k of serviceKeys(s.key)) {
        if (b.lastExpense[k] !== undefined) {
          const old = this.snapFund[s.key] ?? 100;
          exp += old > 0 ? (b.lastExpense[k] * (b.funding[s.key] ?? 100)) / old : b.lastExpense[k];
          svcHandled.add(k);
          break;
        }
      }
    }
    for (const [k, v] of Object.entries(b.lastExpense)) if (!svcHandled.has(k)) exp += v;
    return { inc, exp, hasData };
  }

  override update(): void {
    const st = this.ctx.state;
    const b = st.budget;
    const p = this.projection();
    setText(this.netEls.funds, st.config.sandbox ? '∞' : money(st.funds));
    setText(this.netEls.inc, money(p.inc));
    setText(this.netEls.exp, money(p.exp));
    const net = p.inc - p.exp;
    setText(this.netEls.net, p.hasData ? moneySigned(net) : '—');
    this.netEls.net.className = 'nc-v ' + (p.hasData ? signClass(net) : 'dim');
    const lastNet = sumValues(b.lastIncome) - sumValues(b.lastExpense);
    setText(this.netEls.note, p.hasData ? `Last month ${moneySigned(lastNet)}` : 'Awaiting first report');
    for (const [d, r] of this.taxSliders) {
      const rate = b.taxRates[d];
      setSlider(r.s, rate);
      setText(r.v, `${rate % 1 ? rate.toFixed(1) : rate}%`);
      toggleClass(r.s, 'warn', rate > 12 && rate <= 15);
      toggleClass(r.s, 'bad', rate > 15);
      const last = lookup(b.lastIncome, taxKeys(d));
      const old = this.snapTax[d] || 0;
      const proj = old > 0 ? (last * rate) / old : last;
      setText(r.m, p.hasData ? money(proj) : '—');
    }
    for (const [s, r] of this.fundSliders) {
      const f = b.funding[s] ?? 100;
      setSlider(r.s, f);
      setText(r.v, `${f}%`);
      toggleClass(r.s, 'warn', f < 80);
      toggleClass(r.s, 'bad', f < 50);
      const last = lookup(b.lastExpense, serviceKeys(s));
      const old = this.snapFund[s] ?? 100;
      setText(r.m, p.hasData ? money(old > 0 ? (last * f) / old : last) + '/mo' : '—');
    }
  }
}
