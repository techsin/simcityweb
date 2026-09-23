/** Trigger a disaster at the clicked location (only when disasters are enabled or in sandbox). */
import type { GameContext } from '../context';
import { escapeHtml } from '../../ui/dom';
import { Tool, type ToolPointer } from './Tool';

export class DisasterTool extends Tool {
  readonly id: string;
  readonly label: string;
  override wantsGrid = false;
  constructor(ctx: GameContext, private kind: string, name: string, icon: string) {
    super(ctx);
    this.id = 'disaster:' + kind;
    this.label = name;
    this.icon = icon;
  }
  override move(p: ToolPointer): void {
    if (!p.hit) {
      this.ctx.world.setHighlight(null);
      this.ctx.tip.hide();
      return;
    }
    this.ctx.world.setHighlight([{ x: p.hit.x, z: p.hit.z, ok: false }]);
    this.ctx.tip.show(`<div class="tip-head"><b>${escapeHtml(this.label)}</b></div><div class="tip-sub">Click to unleash</div>`, 'bad');
  }
  override down(p: ToolPointer): void {
    if (!p.hit) return;
    const f = this.ctx.mods.triggerDisaster;
    if (!f) {
      this.ctx.toast('Disasters are not available yet', 'warning');
      return;
    }
    let started: unknown = false;
    try {
      // the alarm comes from the sim's 'disaster' event / news (src/game/GameSounds.ts)
      started = f(this.ctx.sim, this.kind, p.hit.x, p.hit.z);
    } catch (e) {
      console.warn('[disaster] failed', e);
      started = false;
    }
    // triggerDisaster returns false when it could not start (e.g. a fire with no building nearby): keep the tool
    // selected so the player can pick another spot, and say why
    if (started === false) {
      this.ctx.sound('error');
      const why = this.failReason();
      this.ctx.toast(why, 'error');
      this.ctx.tip.show(`<div class="tip-head"><b>${escapeHtml(this.label)}</b></div><div class="tip-reason">${escapeHtml(why)}</div>`, 'bad');
      return;
    }
    this.ctx.tools.select(null, { silent: true });
  }
  private failReason(): string {
    if (this.kind === 'fire') return 'No building here to set on fire — click on or next to a building';
    return `Could not start a ${this.label.toLowerCase()} here`;
  }
  override deactivate(): void {
    this.ctx.world.setHighlight(null);
    this.ctx.tip.hide();
  }
  override hints(): string[] {
    return ['Click a location', 'Esc cancel'];
  }
}
