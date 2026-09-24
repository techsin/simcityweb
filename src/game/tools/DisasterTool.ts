/** Trigger a disaster at the clicked location (only when disasters are enabled or in sandbox). */
import type { GameContext } from '../context';
import { escapeHtml } from '../../ui/dom';
import { Tool, type ToolPointer } from './Tool';

export class DisasterTool extends Tool {
  readonly id: string;
  readonly label: string;
  override wantsGrid = false;
  /** last refused cell + reason: the tip keeps explaining while the cursor stays there */
  private refused: { x: number; z: number; why: string } | null = null;
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
    const r = this.refused;
    if (r && (r.x !== p.hit.x || r.z !== p.hit.z)) this.refused = null;
    this.ctx.tip.show(`<div class="tip-head"><b>${escapeHtml(this.label)}</b></div>` + (this.refused ? `<div class="tip-reason">${escapeHtml(this.refused.why)}</div>` : '<div class="tip-sub">Click to unleash</div>'), 'bad');
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
      const why = this.failReason(p.hit.x, p.hit.z);
      this.ctx.toast(why, 'error');
      this.refused = { x: p.hit.x, z: p.hit.z, why };
      this.move(p);
      return;
    }
    this.ctx.tools.select(null, { silent: true });
  }
  /** why triggerDisaster refused (a fire needs a building within 3 tiles that is not already burning / burnt out) */
  private failReason(x: number, z: number): string {
    if (this.kind === 'fire') {
      let near = false;
      for (let dz = -3; dz <= 3 && !near; dz++) for (let dx = -3; dx <= 3; dx++) {
        if (this.ctx.state.buildingAt(x + dx, z + dz)) {
          near = true;
          break;
        }
      }
      return near ? 'Everything here is already burning or burnt out — pick another building' : 'No building here to set on fire — click on or next to a building';
    }
    return `Could not start a ${this.label.toLowerCase()} here`;
  }
  override deactivate(): void {
    this.refused = null;
    this.ctx.world.setHighlight(null);
    this.ctx.tip.hide();
  }
  override hints(): string[] {
    return ['Click a location', 'Esc cancel'];
  }
}
