/** Base class for all mouse tools (left button only — middle/right belong to the camera). */
import type { CellHit } from '../../render/contracts';
import type { Overlay } from '../../core/types';
import type { ActionResult } from '../../sim/actions';
import type { GameContext } from '../context';
import type { Command, CommandArgs, CommandOp, CommandResult, Gesture, Ticket } from '../../worker/SimHost';
import { commandPreview, type PendingPreviewView } from '../../worker/PendingEdits';
import { CommandOutcomeLost } from '../../worker/protocol';
import { escapeHtml } from '../../ui/dom';
import { money } from '../../ui/format';

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
  if (ctx.signal.aborted) return { seq: 0, predicted: FAIL, exact: true, done: Promise.resolve(FAIL) } as Ticket<CommandResult<K>>;
  const g = gesture ?? ctx.host.beginGesture(owner);
  const fail = (r: ActionResult) => {
    if (ctx.signal.aborted) return;
    if (feedback.fail) feedback.fail(r);
    else {
      ctx.sound('error');
      if (r.reason) ctx.toast(r.reason, 'error');
    }
  };
  const ticket = safe(() => ctx.host.act(op, args, { tag: owner, gesture: g }), {
    seq: 0, predicted: FAIL, exact: true, done: Promise.resolve(FAIL),
  } as Ticket<CommandResult<K>>);
  const predicted = ticket.predicted as ActionResult | undefined;
  const world = ctx.world as GameContext['world'] & PendingPreviewView;
  let clearPreview = () => {};
  if (!ctx.signal.aborted && ctx.host.kind !== 'local' && ticket.seq > 0 && (!ticket.exact || predicted?.ok) && world.setPendingPreview) {
    const geometry = commandPreview({ op, args } as Command);
    if (geometry) {
      safe(() => world.setPendingPreview!(ticket.seq, geometry), undefined);
      let cleared = false;
      clearPreview = () => {
        if (cleared) return;
        cleared = true;
        ctx.signal.removeEventListener('abort', clearPreview);
        safe(() => world.setPendingPreview?.(ticket.seq, null), undefined);
      };
      ctx.signal.addEventListener('abort', clearPreview, { once: true });
    }
  }
  if (!ctx.signal.aborted && ticket.exact && predicted) {
    if (predicted.ok) { g.recordFeedback(); feedback.ok(predicted); }
    else g.fail(() => fail(predicted));
  }
  const delivered = ticket.done.then((r: ActionResult) => {
    clearPreview();
    if (ctx.signal.aborted) return;
    g.recordAck(r.ok);
    if (!ticket.exact || !predicted) {
      if (r.ok) feedback.ok(r);
      else g.fail(() => fail(r));
    } else if (predicted.ok && !r.ok) g.fail(() => fail(r));
    feedback.ack?.(r);
  }, (e: unknown) => {
    clearPreview();
    if (ctx.signal.aborted) return;
    if (e instanceof CommandOutcomeLost) {
      // a resync dropped the Ack of a command the worker applied: the edit happened, so no failure feedback; the
      // stroke's totals take the prediction, or nothing
      g.recordAck(true);
      feedback.ack?.(predicted?.ok ? predicted : LOST);
      return;
    }
    g.fail(() => fail(FAIL));
    feedback.ack?.(FAIL);
  });
  g.track(delivered);
  if (!gesture) g.end();
  return ticket;
}

/** Tooltip html for an action preview. */
export function resultTip(title: string, r: ActionResult | null, extra = ''): { html: string; kind: 'ok' | 'bad' } {
  if (!r) return { html: `<b>${escapeHtml(title)}</b>`, kind: 'ok' };
  const cost = r.cost ?? 0;
  const note = r.refundNote ? ` (${escapeHtml(r.refundNote)})` : '';
  const costTxt = cost < 0 ? `<span class="tip-refund">Refund ${money(-cost)}${note}</span>` : cost > 0 ? `<span class="tip-cost">${money(cost)}</span>` : '';
  const reason = r.reason ? `<div class="${r.ok ? 'tip-warn' : 'tip-reason'}">${escapeHtml(r.reason)}</div>` : '';
  const head = `<div class="tip-head"><b>${escapeHtml(title)}</b>${costTxt}</div>`;
  return { html: head + (extra ? `<div class="tip-sub">${extra}</div>` : '') + reason, kind: r.ok ? 'ok' : 'bad' };
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
/** an applied command whose outcome a resync lost, with no ok prediction to stand in for it */
const LOST: ActionResult = { ok: true, cost: 0 };
