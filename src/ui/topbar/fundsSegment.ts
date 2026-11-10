/**
 * The top bar's funds segment (POLISH_PLAN §7.3: GUIDE's, from the round-1 TopBar split): the treasury and last month's
 * recurring net; a click opens the Budget. Also the ledger sums the Budget and Advisors panels read (re-exported by
 * src/ui/TopBar.ts).
 *
 * FEEL-03, money you can feel:
 * - (b) the treasury counts to its new value over COUNT_MS (one requestAnimationFrame loop that writes only the label's
 *   text), with a FLASH_MS red or green flash (Web Animations, colour only);
 * - (c) at the month tick a chip under it shows the month's recurring net for MONTH_CHIP_MS: `lastNet`, the very sum
 *   behind Budget's "Monthly net (recurring)". At ultra (an 18 s year) only when the sign flips or the net moves by
 *   CHIP_ULTRA_CHANGE or more;
 * - a sandbox shows "∞", no net, no chip and no count-up (money is no object there: a red "−§11,231/mo" beside "∞" read
 *   as a warning that cannot apply, shots2/hd_01);
 * - reduced motion, a hidden tab or no real document: the figure is set at once.
 */
import type { GameContext } from '../../game/context';
import { DAYS_PER_MONTH } from '../../core/constants';
import { h, setText, toggleClass } from '../dom';
import { icon } from '../icons';
import { money, moneySigned, signClass } from '../format';
import { HudChip, reducedMotion } from './hudChip';

/** FEEL-03 (b): the funds count-up (ms) and its flash (ms) */
export const COUNT_MS = 350;
export const FLASH_MS = 400;
/** FEEL-03 (c): how long the month chip shows (ms), and the change of the net that shows it at ultra (a share) */
export const MONTH_CHIP_MS = 2500;
export const CHIP_ULTRA_CHANGE = 0.2;
/** the sim speed called ultra (the top bar's fourth speed button) */
const ULTRA = 3;
const FLASH_UP = '#43d17a';
const FLASH_DOWN = '#ff5d5d';

/** FEEL-03 (c): does the month chip show for this month's net (`prev`: last month's; null: none)? Always below ultra;
 *  at ultra only on a sign flip or a change of CHIP_ULTRA_CHANGE of last month's net or more */
export function showMonthChip(net: number, prev: number | null, ultra: boolean): boolean {
  if (!ultra || prev === null) return true;
  const a = Math.round(net), b = Math.round(prev);
  if (Math.sign(a) !== Math.sign(b)) return true;
  return a !== b && Math.abs(a - b) >= CHIP_ULTRA_CHANGE * Math.abs(b);
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

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
  /** FEEL-03 (c): the month chip */
  readonly chip: HudChip;
  private fundsEl: HTMLElement;
  private netEl: HTMLElement;
  /** FEEL-03 (b): the figure the label shows (null: none yet, or "∞"), the count-up's start and end, its first frame's
   *  time (-1: not yet) and its frame request (0: none) */
  private shown: number | null = null;
  private from = 0;
  private to = 0;
  private t0 = -1;
  private raf = 0;
  private flashDir = 0;
  private flashAt = -Infinity;
  /** FEEL-03 (c): the month of the last tick (-1: none yet), the state it was read from (a load or a replica's resync
   *  replaces it: no chip for that) and the net reported at the last month tick */
  private month = -1;
  private monthOf: object | null = null;
  private monthNet: number | null = null;

  constructor(private ctx: GameContext) {
    this.fundsEl = h('div', { class: 'hud-value' });
    this.netEl = h('div', { class: 'hud-sub' });
    this.chip = new HudChip(ctx, 'month');
    this.el = h('div', { class: 'hud-seg click', title: 'Budget (M)' }, h('span', { class: 'ico-wrap', style: 'color:#7ee2a0', html: icon('money', 20) }), h('div', { class: 'hud-stack' }, this.fundsEl, this.netEl, this.chip.el));
    this.el.addEventListener('click', () => this.ctx.panels.toggle('budget'), { signal: this.ctx.signal });
    this.ctx.signal.addEventListener('abort', () => this.stop(), { once: true });
  }

  update(): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const sandbox = !!st.config.sandbox;
    this.showFunds(st.funds, sandbox);
    toggleClass(this.fundsEl, 'neg', st.funds < 0);
    const net = lastNet(ctx);
    const hasBudget = Object.keys(st.budget.lastIncome).length + Object.keys(st.budget.lastExpense).length > 0;
    setText(this.netEl, sandbox ? '' : hasBudget ? `${moneySigned(net, Math.abs(net) >= 1e5)}/mo` : 'No report yet');
    const netClass = 'hud-sub ' + (hasBudget && !sandbox ? signClass(net) : 'faint');
    if (this.netEl.className !== netClass) this.netEl.className = netClass;
    this.monthChip(net, hasBudget, sandbox);
  }

  /** FEEL-03 (b): the treasury label, counting up to a changed figure */
  private showFunds(funds: number, sandbox: boolean): void {
    if (sandbox) {
      this.stop();
      this.shown = null;
      setText(this.fundsEl, '∞');
      return;
    }
    const first = this.shown === null;
    if (!first && funds === this.to) return;
    const dir = first ? 0 : Math.sign(funds - this.to);
    this.to = funds;
    if (first || !this.canAnimate()) {
      this.stop();
      this.shown = funds;
      setText(this.fundsEl, money(funds));
      return;
    }
    this.from = this.shown!;
    this.t0 = -1;
    this.flash(dir);
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  /** one count-up frame: eased from `from` to `to` over COUNT_MS from the first frame; only the label's text is written */
  private frame = (ts: number): void => {
    this.raf = 0;
    if (this.ctx.signal.aborted || this.shown === null) return;
    if (this.t0 < 0) this.t0 = ts;
    const p = Math.min(1, Math.max(0, (ts - this.t0) / COUNT_MS));
    const v = p >= 1 ? this.to : this.from + (this.to - this.from) * easeOut(p);
    this.shown = v;
    setText(this.fundsEl, money(p >= 1 ? v : Math.round(v)));
    if (p < 1) this.raf = requestAnimationFrame(this.frame);
  };

  /** the count-up runs with full motion in a visible tab (rAF does not run in a hidden one; a test's document has no
   *  visibility) */
  private canAnimate(): boolean {
    return typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && document.visibilityState === 'visible' && !reducedMotion(this.ctx);
  }

  /** the red (spent) or green (earned) flash; one at a time per direction (a held brush spends every 70-120 ms) */
  private flash(dir: number): void {
    const el = this.fundsEl;
    if (!dir || typeof el.animate !== 'function') return;
    const now = performance.now();
    if (dir === this.flashDir && now - this.flashAt < FLASH_MS) return;
    this.flashDir = dir;
    this.flashAt = now;
    const c = dir > 0 ? FLASH_UP : FLASH_DOWN;
    try {
      el.animate([{ color: c, textShadow: `0 0 10px ${c}` }, {}], { duration: FLASH_MS, easing: 'ease-out' });
    } catch {
      /* no implicit end keyframe in this browser: no flash */
    }
  }

  /** cancel a running count-up (the caller writes the figure) */
  private stop(): void {
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** FEEL-03 (c): at the month tick, the month's recurring net under the funds */
  private monthChip(net: number, hasBudget: boolean, sandbox: boolean): void {
    const st = this.ctx.state, m = Math.floor(st.day / DAYS_PER_MONTH);
    if (m !== this.month || st !== this.monthOf) {
      const first = this.month < 0 || st !== this.monthOf, prev = this.monthNet;
      this.month = m;
      this.monthOf = st;
      this.monthNet = hasBudget ? net : null;
      if (!first && hasBudget && !sandbox && showMonthChip(net, prev, this.ctx.sim?.speed === ULTRA)) this.chip.show(moneySigned(net), signClass(net), MONTH_CHIP_MS);
    }
    this.chip.tick();
  }
}
