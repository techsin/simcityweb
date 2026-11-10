/**
 * FEEL-03 (c, d): a chip under a top-bar segment for a few seconds: the month's net under funds, the approval change
 * under Approval (hud.css `.hud-chip`). It is absolutely placed below the bar, so showing it moves nothing. It shows on
 * a class change (an opacity / transform transition, none under reduced motion) and hides on the first HUD tick after
 * its time; an unchanged tick writes nothing (T030).
 */
import type { GameContext } from '../../game/context';
import { resolveMotion } from '../../game/settings';
import { h, setText } from '../dom';

/** FEEL-21's reduced motion as the city's settings resolve it ('system' follows the device) */
export function reducedMotion(ctx: Pick<GameContext, 'settings'>): boolean {
  return resolveMotion(ctx.settings?.motion ?? 'system') === 'reduced';
}

export class HudChip {
  readonly el: HTMLElement;
  /** hide time (performance.now); 0: hidden */
  private until = 0;
  /** the shown chip's class without `on` (it keeps its colour while it fades) */
  private rest: string;

  constructor(private ctx: Pick<GameContext, 'settings'>, private kind: string) {
    this.rest = `hud-chip ${kind}`;
    this.el = h('div', { class: this.rest });
  }

  get visible(): boolean {
    return this.until > 0;
  }

  /** show `text` in tone `tone` ('pos', 'neg' or 'zero') for `ms` */
  show(text: string, tone: string, ms: number): void {
    setText(this.el, text);
    this.rest = `hud-chip ${this.kind} ${tone}${reducedMotion(this.ctx) ? ' rm' : ''}`;
    const cls = `${this.rest} on`;
    if (this.el.className !== cls) this.el.className = cls;
    this.until = performance.now() + ms;
  }

  /** each HUD tick: hide once its time is up */
  tick(): void {
    if (!this.until || performance.now() < this.until) return;
    this.until = 0;
    this.el.className = this.rest;
  }
}
