/**
 * The top bar's funds segment (POLISH_PLAN §7.3: GUIDE's, from the round-1 TopBar split): the treasury and last month's
 * recurring net; a click opens the Budget. Also the ledger sums the Budget and Advisors panels read (re-exported by
 * src/ui/TopBar.ts).
 */
import type { GameContext } from '../../game/context';
import { h, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import { money, moneySigned, signClass } from '../format';

export function sumValues(r: Record<string, number> | undefined): number {
  let s = 0;
  if (r) for (const k in r) s += r[k] || 0;
  return s;
}

/** ledger keys paid / received immediately (construction, zoning, demolition, loan proceeds & repayments, refunds) */
export function isOneOff(key: string): boolean {
  return key.startsWith('oneoff:');
}

/** sum of the recurring entries only (excludes 'oneoff:*' — construction, loan principal, refunds...) */
export function sumRecurring(r: Record<string, number> | undefined): number {
  let s = 0;
  if (r) for (const k in r) if (!isOneOff(k)) s += r[k] || 0;
  return s;
}

/** sum of the one-off entries only ('oneoff:*') */
export function sumOneOff(r: Record<string, number> | undefined): number {
  let s = 0;
  if (r) for (const k in r) if (isOneOff(k)) s += r[k] || 0;
  return s;
}

/** last month's recurring net (taxes & deals - upkeep, services, loan payments); one-offs and loan money excluded */
export function lastNet(ctx: GameContext): number {
  const b = ctx.state.budget;
  return sumRecurring(b.lastIncome) - sumRecurring(b.lastExpense);
}

export class FundsSegment {
  readonly el: HTMLElement;
  private fundsEl: HTMLElement;
  private netEl: HTMLElement;

  constructor(private ctx: GameContext) {
    this.fundsEl = h('div', { class: 'hud-value' });
    this.netEl = h('div', { class: 'hud-sub' });
    this.el = h('div', { class: 'hud-seg click', title: 'Budget (M)' }, h('span', { class: 'ico-wrap', style: 'color:#7ee2a0', html: icon('money', 20) }), h('div', { class: 'hud-stack' }, this.fundsEl, this.netEl));
    this.el.addEventListener('click', () => this.ctx.panels.toggle('budget'), { signal: this.ctx.signal });
  }

  update(): void {
    const ctx = this.ctx;
    const st = ctx.state;
    setText(this.fundsEl, st.config.sandbox ? '∞' : money(st.funds));
    toggleClass(this.fundsEl, 'neg', st.funds < 0);
    const net = lastNet(ctx);
    const hasBudget = Object.keys(st.budget.lastIncome).length + Object.keys(st.budget.lastExpense).length > 0;
    setText(this.netEl, hasBudget ? `${moneySigned(net, Math.abs(net) >= 1e5)}/mo` : 'No report yet');
    const netClass = 'hud-sub ' + (hasBudget ? signClass(net) : 'faint');
    if (this.netEl.className !== netClass) this.netEl.className = netClass;
  }
}
