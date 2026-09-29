/** Roads / rail / power lines / subway: drag an L-shaped path (Shift flips the L), live preview + cost. */
import { Network, Overlay } from '../../core/types';
import type { ActionResult } from '../../sim/actions';
import { lPath, type Cell } from '../geom';
import type { GameContext } from '../context';
import { FAIL, resultTip, safe, Tool, type ToolPointer } from './Tool';
import { sideDemolishRisks, type DemolishRisk } from '../demolishRisk';
import { confirmDialog } from '../../ui/Modals';

export type NetKind = Network | 'power' | 'subway';

export const NETWORK_LABELS: Record<string, string> = {
  [Network.Street]: 'Street',
  [Network.Road]: 'Road',
  [Network.Avenue]: 'Avenue',
  [Network.OneWay]: 'One-way road',
  [Network.Highway]: 'Highway',
  [Network.Rail]: 'Rail',
  power: 'Power line',
  subway: 'Subway',
};

export class NetworkTool extends Tool {
  readonly id: string;
  readonly label: string;
  private start: Cell | null = null;
  private path: Cell[] | null = null;
  private res: ActionResult | null = null;
  private lastKey = '';

  constructor(ctx: GameContext, private kind: NetKind, id: string, icon: string) {
    super(ctx);
    this.id = id;
    this.label = NETWORK_LABELS[String(kind)] ?? 'Network';
    this.icon = icon;
    if (kind === 'power') this.autoOverlay = Overlay.Power;
  }

  private run(path: Cell[], preview: boolean): ActionResult {
    const a = this.ctx.actions;
    const k = this.kind;
    return safe(() => (k === 'power' ? a.buildPowerLine(path, preview) : k === 'subway' ? a.buildSubway(path, preview) : a.buildNetwork(path, k, preview)), FAIL);
  }

  private clearPreview(): void {
    this.ctx.world.setHighlight(null);
    this.ctx.objects.setNetworkPreview(null);
  }

  private refresh(p: ToolPointer, force = false): void {
    if (!p.hit) {
      if (!this.start) {
        this.clearPreview();
        this.ctx.tip.hide();
        this.lastKey = '';
      }
      return;
    }
    const c = { x: p.hit.x, z: p.hit.z };
    let path: Cell[];
    if (this.start) {
      const dx = Math.abs(c.x - this.start.x), dz = Math.abs(c.z - this.start.z);
      const xFirst = (dx >= dz) !== p.shift;
      path = lPath(this.start, c, xFirst);
    } else path = [c];
    const key = path.length + ':' + path[0].x + ',' + path[0].z + '>' + c.x + ',' + c.z + (p.shift ? 's' : '') + (this.start ? 'd' : 'h');
    if (key !== this.lastKey || force) {
      this.lastKey = key;
      this.path = path;
      this.res = this.run(path, true);
      const ok = this.res.ok;
      this.ctx.world.setHighlight(this.res.cells && this.res.cells.length ? this.res.cells : path.map((q) => ({ ...q, ok })));
      this.ctx.objects.setNetworkPreview(path, this.kind, ok);
    }
    const len = this.res?.ok && this.res.affected ? this.res.affected : path.length;
    const extra = this.start ? `${len} tile${len === 1 ? '' : 's'}${p.shift ? ' · flipped' : ''}` : 'Click and drag to build';
    const t = resultTip(this.label, this.res, extra);
    this.ctx.tip.show(t.html, t.kind);
  }

  override activate(): void {
    if (this.kind === 'subway') this.ctx.objects.setUnderground(true);
  }
  override deactivate(): void {
    if (this.kind === 'subway') this.ctx.objects.setUnderground(false);
    this.start = null;
    this.clearPreview();
    this.ctx.tip.hide();
  }
  override move(p: ToolPointer): void {
    this.refresh(p);
  }
  override down(p: ToolPointer): void {
    if (!p.hit) return;
    this.start = { x: p.hit.x, z: p.hit.z };
    this.lastKey = '';
    this.refresh(p);
  }
  override up(p: ToolPointer): void {
    if (!this.start) return;
    this.refresh(p);
    const path = this.path;
    this.start = null;
    if (path && path.length) {
      // a route through developed lots that demolishes a lot (> §20k of fees, or DISPLACE_CONFIRM residents + jobs) asks first
      const risk = this.sideRisk(path);
      if (risk) {
        this.clearPreview();
        this.ctx.tip.hide();
        this.lastKey = '';
        void confirmDialog(this.ctx, { title: risk.title, message: 'This route runs through developed lots:', items: risk.items, confirm: 'Build & demolish', danger: true }).then((yes) => {
          if (yes && this.ctx.tools.active === this) this.commit(path);
          this.lastKey = '';
          this.ctx.tools.refresh();
        });
        // the dialog is modal: no preview / tip underneath it (the next frame after it closes refreshes them)
        return;
      }
      this.commit(path);
    }
    this.lastKey = '';
    this.refresh(p, true);
  }

  private sideRisk(path: Cell[]): DemolishRisk | null {
    const pre = this.run(path, true);
    if (!pre.ok || !pre.demolished?.length) return null;
    return safe(() => sideDemolishRisks(this.ctx.state, pre.demolished, pre.demolishFee ?? 0, { sandbox: this.ctx.sandbox() }), null);
  }

  private commit(path: Cell[]): void {
    const r = this.run(path, false);
    if (r.ok) this.ctx.sound(this.kind === 'power' ? 'powerline' : this.kind === 'subway' || this.kind === Network.Rail ? 'rail' : 'build', { intensity: Math.min(1, path.length / 40) });
    else {
      this.ctx.sound('error');
      if (r.reason) this.ctx.toast(r.reason, 'error');
    }
  }
  override cancel(): boolean {
    if (!this.start) return false;
    this.start = null;
    this.lastKey = '';
    this.clearPreview();
    this.ctx.tip.hide();
    return true;
  }
  override key(e: KeyboardEvent, p: ToolPointer | null): boolean {
    if (e.key === 'Shift' && p) {
      this.refresh({ ...p, shift: e.type === 'keydown' }, true);
    }
    return false;
  }
  override leave(): void {
    if (!this.start) {
      this.clearPreview();
      this.lastKey = '';
    }
    this.ctx.tip.hide();
  }
  override hints(): string[] {
    return ['Drag to build', 'Shift flip corner', 'Esc / right-click cancel'];
  }
}
