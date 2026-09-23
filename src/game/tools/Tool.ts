/** Base class for all mouse tools (left button only — middle/right belong to the camera). */
import type { CellHit } from '../../render/contracts';
import type { ActionResult } from '../../sim/actions';
import type { GameContext } from '../context';
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
  constructor(protected ctx: GameContext) {}
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

/** Tooltip html for an action preview. */
export function resultTip(title: string, r: ActionResult | null, extra = ''): { html: string; kind: 'ok' | 'bad' } {
  if (!r) return { html: `<b>${escapeHtml(title)}</b>`, kind: 'ok' };
  const cost = r.cost ?? 0;
  const costTxt = cost < 0 ? `<span class="tip-refund">Refund ${money(-cost)}</span>` : cost > 0 ? `<span class="tip-cost">${money(cost)}</span>` : '';
  const reason = r.reason ? `<div class="tip-reason">${escapeHtml(r.reason)}</div>` : '';
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
