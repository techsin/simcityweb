/** Base class for all mouse tools (left button only — middle/right belong to the camera). */
import type { CellHit } from '../../render/contracts';
import type { Overlay } from '../../core/types';
import type { ActionResult } from '../../sim/actions';
import type { GameContext } from '../context';
import type { CommandArgs, CommandOp, CommandResult, Gesture, Ticket } from '../../worker/SimHost';
import { escapeHtml } from '../../ui/dom';
import { money, moneySigned } from '../../ui/format';
import type { CityState } from '../../sim/CityState';
import type { BuildingDef } from '../../sim/catalogTypes';

export interface ToolPointer {
  clientX: number;
  clientY: number;
  hit: CellHit | null;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  /** left button held */
  down: boolean;
}

export abstract class Tool {
  abstract readonly id: string;
  abstract readonly label: string;
  icon = 'dot';
  cursor = 'crosshair';
  /** show the cell grid while this tool is active */
  wantsGrid = true;
  /** data view to show automatically while this tool is active (e.g. coverage for police stations) */
  autoOverlay: Overlay | null = null;
  protected gesture: Gesture | null = null;
  constructor(protected ctx: GameContext) {}
  beginGesture(): void {
    this.endGesture();
    this.gesture = this.ctx.host.beginGesture(this);
  }
  endGesture(): void {
    this.gesture?.end();
    this.gesture = null;
  }
  protected commit<K extends ActionOp>(op: K, args: CommandArgs<K>, feedback: CommitFeedback): Ticket<CommandResult<K>> {
    return commitAction(this.ctx, this, op, args, feedback, this.gesture ?? undefined);
  }
  activate(): void {}
  deactivate(): void {}
  down(_p: ToolPointer): void {}
  move(_p: ToolPointer): void {}
  up(_p: ToolPointer): void {}
  leave(): void {
    this.ctx.tip.hide();
  }
  /** Esc / right click: return true if something (a drag) was cancelled */
  cancel(): boolean {
    return false;
  }
  /** return true if the key was consumed */
  key(_e: KeyboardEvent, _p: ToolPointer | null): boolean {
    return false;
  }
  frame(_dt: number, _p: ToolPointer | null): void {}
  /** short usage hints for the tool bar chip */
  hints(): string[] {
    return [];
  }
  /** optional options UI (e.g. brush size) shown in the tool chip */
  options(): HTMLElement | null {
    return null;
  }
}

type ActionOp = { [K in CommandOp]: CommandResult<K> extends ActionResult ? K : never }[CommandOp];
export interface CommitFeedback {
  ok(r: ActionResult): void;
  fail?(r: ActionResult): void;
  /** Brush totals and panel closure use the authoritative result, even after exact feedback. */
  ack?(r: ActionResult): void;
}

/** Shared with the inspector's one-commit demolition gesture. */
export function commitAction<K extends ActionOp>(ctx: GameContext, owner: object, op: K, args: CommandArgs<K>, feedback: CommitFeedback, gesture?: Gesture): Ticket<CommandResult<K>> {
  const g = gesture ?? ctx.host.beginGesture(owner);
  const fail = (r: ActionResult) => {
    if (ctx.signal.aborted) return;
    if (feedback.fail) feedback.fail(r);
    else {
      ctx.sound('error');
      if (r.reason) ctx.toast(r.reason, 'error');
    }
  };
  const ticket = safe(() => ctx.host.act(op, args, { gesture: g }), {
    seq: 0, predicted: FAIL, exact: true, done: Promise.resolve(FAIL),
  } as Ticket<CommandResult<K>>);
  const predicted = ticket.predicted as ActionResult | undefined;
  if (!ctx.signal.aborted && ticket.exact && predicted) {
    if (predicted.ok) feedback.ok(predicted);
    else fail(predicted);
  }
  void ticket.done.then((r: ActionResult) => {
    if (ctx.signal.aborted) return;
    if (!ticket.exact || !predicted) {
      if (r.ok) feedback.ok(r);
      else g.fail(() => fail(r));
    } else if (predicted.ok && !r.ok) g.fail(() => fail(r));
    feedback.ack?.(r);
  }, () => {
    if (ctx.signal.aborted) return;
    g.fail(() => fail(FAIL));
    feedback.ack?.(FAIL);
  });
  if (!gesture) g.end();
  return ticket;
}

/** Tooltip html for an action preview (`more`: html lines under the sub line, above the reason — FH-05's budget line). */
export function resultTip(title: string, r: ActionResult | null, extra = '', more = ''): { html: string; kind: 'ok' | 'bad' } {
  if (!r) return { html: `<b>${escapeHtml(title)}</b>${more}`, kind: 'ok' };
  const cost = r.cost ?? 0;
  const note = r.refundNote ? ` (${escapeHtml(r.refundNote)})` : '';
  const costTxt = cost < 0 ? `<span class="tip-refund">Refund ${money(-cost)}${note}</span>` : cost > 0 ? `<span class="tip-cost">${money(cost)}</span>` : '';
  const reason = r.reason ? `<div class="${r.ok ? 'tip-warn' : 'tip-reason'}">${escapeHtml(r.reason)}</div>` : '';
  const head = `<div class="tip-head"><b>${escapeHtml(title)}</b>${costTxt}</div>`;
  return { html: head + (extra ? `<div class="tip-sub">${extra}</div>` : '') + more + reason, kind: r.ok ? 'ok' : 'bad' };
}

/** FH-05: what placing a building does to the monthly budget (the plop tip's line, the build card's row) */
export interface BudgetEffect {
  /** last month's recurring net (§ / month) */
  before: number;
  /** before + the building's monthly effect */
  after: number;
  /** "+§259 → −§280 after this" (a venue or an airport: ", before its income (up to §1,500 when busy)") */
  text: string;
  /** below zero after it: how long the treasury lasts at that rate ("≈ 7 months of reserves"); '' otherwise */
  reserves: string;
  /** below zero after it: the line is red */
  bad: boolean;
}

/**
 * FH-05: "Monthly budget: +§259 → −§280 after this", before a building is placed: a Fire Station read ≈§539/mo while
 * the town made +§259/mo, and players overbuilt services without knowing it (shots2/024, shots2/078).
 * Before: last month's recurring net, the top bar's figure (mirrored budget.lastIncome / lastExpense; one-offs such as
 * construction, loan money and refunds left out). After: before minus the upkeep the tip quotes (`upkeep`: the spot's
 * "Upkeep here", the card's city-wide estimate or the catalog figure), plus a business deal's income, which pays as it
 * is; a venue's or an airport's income follows its visitors and traffic, so it is named, not counted. Below zero after
 * it, the line turns red and says how long the treasury lasts at that rate, never more than 60 months. Mirrored reads
 * only: no computeMonthlyBudget per mouse move (a Worker watch, WORKER_DESIGN §2.8).
 * null without a budget report yet (a city's first month: the top bar's "No report yet"), in a sandbox (money is no
 * object), or when the building changes nothing.
 */
export function budgetEffect(st: Pick<CityState, 'budget' | 'funds'>, def: Pick<BuildingDef, 'category' | 'income'>, upkeep: number, sandbox = false,
  opts: { venueNote?: boolean } = {}): BudgetEffect | null {
  const b = st.budget;
  if (sandbox || !b) return null;
  let before = 0, report = false;
  for (const k in b.lastIncome) { report = true; if (!k.startsWith('oneoff:')) before += b.lastIncome[k] || 0; }
  for (const k in b.lastExpense) { report = true; if (!k.startsWith('oneoff:')) before -= b.lastExpense[k] || 0; }
  const deal = def.category === 'reward' ? def.income ?? 0 : 0;
  const change = deal - Math.max(0, upkeep || 0);
  if (!report || Math.round(change) === 0) return null;
  const after = before + change;
  const venue = def.category === 'reward' || opts.venueNote === false ? 0 : def.income ?? 0;
  const text = `${moneySigned(before)} → ${moneySigned(after)} after this${venue > 0 ? `, before its income (up to ${money(venue)} when busy)` : ''}`;
  const bad = Math.round(after) < 0;
  return { before, after, text, reserves: bad ? reservesText(st.funds, -after) : '', bad };
}

/** how long `funds` last at a loss of `loss` § a month (FH-05): "≈ 7 months of reserves", never more than 60 months */
export function reservesText(funds: number, loss: number): string {
  if (!(funds > 0)) return 'no reserves left';
  const months = funds / loss;
  if (months < 1) return 'less than a month of reserves';
  if (months > 60) return 'more than 5 years of reserves';
  const n = Math.floor(months);
  return `≈ ${n} month${n === 1 ? '' : 's'} of reserves`;
}

/** call an action safely (sim-core code may throw while WIP) */
export function safe<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch (e) {
    console.warn('[tool] action threw', e);
    return fallback;
  }
}

export const FAIL: ActionResult = { ok: false, cost: 0, reason: 'Action unavailable' };
