/** Zoning / de-zoning / bulldozing: drag a rectangle, live cost preview, apply on release. */
import type { CellRect } from '../../core/events';
import { Zone } from '../../core/types';
import type { ActionResult } from '../../sim/actions';
import { rectFrom, type Cell } from '../geom';
import type { GameContext } from '../context';
import { FAIL, resultTip, safe, Tool, type ToolPointer } from './Tool';
import { demolishRisks, type DemolishRisk } from '../demolishRisk';
import { confirmDialog } from '../../ui/Modals';

export const ZONE_LABELS: Record<number, string> = {
  [Zone.ResLow]: 'Residential · Low density',
  [Zone.ResMed]: 'Residential · Medium density',
  [Zone.ResHigh]: 'Residential · High density',
  [Zone.ComLow]: 'Commercial · Low density',
  [Zone.ComMed]: 'Commercial · Medium density',
  [Zone.ComHigh]: 'Commercial · High density',
  [Zone.IndAg]: 'Agriculture',
  [Zone.IndMed]: 'Industrial · Medium density',
  [Zone.IndHigh]: 'Industrial · High density',
  [Zone.Landfill]: 'Landfill',
};

export const ZONE_HEX: Record<number, number> = {
  [Zone.ResLow]: 0x57d17f, [Zone.ResMed]: 0x35b865, [Zone.ResHigh]: 0x1f9a4d,
  [Zone.ComLow]: 0x6aa6ff, [Zone.ComMed]: 0x3d8bff, [Zone.ComHigh]: 0x2667d6,
  [Zone.IndAg]: 0xc3cf62, [Zone.IndMed]: 0xf0b429, [Zone.IndHigh]: 0xd88d17, [Zone.Landfill]: 0x9c7a55,
};

const BAD = 0xff5d5d;

type RectMode = { kind: 'zone'; zone: Zone } | { kind: 'dezone' } | { kind: 'bulldoze' };

export class RectTool extends Tool {
  readonly id: string;
  readonly label: string;
  private start: Cell | null = null;
  private lastKey = '';
  private lastRect: CellRect | null = null;
  private lastRes: ActionResult | null = null;

  constructor(ctx: GameContext, private mode: RectMode, id: string, label: string, icon: string) {
    super(ctx);
    this.id = id;
    this.label = label;
    this.icon = icon;
    if (mode.kind === 'bulldoze') this.cursor = 'crosshair';
  }

  private color(ok: boolean): number {
    if (!ok) return BAD;
    if (this.mode.kind === 'zone') return ZONE_HEX[this.mode.zone] ?? 0xffffff;
    if (this.mode.kind === 'dezone') return 0xff9d5d;
    return 0xff6a4d;
  }

  private run(rect: CellRect, preview: boolean): ActionResult {
    const a = this.ctx.actions;
    const m = this.mode;
    return safe(() => (m.kind === 'zone' ? a.zone(rect, m.zone, preview) : m.kind === 'dezone' ? a.dezone(rect, preview) : a.bulldoze(rect, preview)), FAIL);
  }

  /** rect for hovering (no drag): bulldoze snaps to the building under the cursor */
  private hoverRect(c: Cell): CellRect {
    if (this.mode.kind === 'bulldoze') {
      const b = this.ctx.state.buildingAt(c.x, c.z);
      if (b) return { x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d };
    }
    return { x0: c.x, z0: c.z, x1: c.x + 1, z1: c.z + 1 };
  }

  private refresh(p: ToolPointer): void {
    if (!p.hit) {
      this.ctx.world.setHighlightRect(null, 0);
      this.ctx.tip.hide();
      this.lastKey = '';
      return;
    }
    const c = { x: p.hit.x, z: p.hit.z };
    const rect = this.start ? rectFrom(this.start, c) : this.hoverRect(c);
    const key = `${rect.x0},${rect.z0},${rect.x1},${rect.z1},${!!this.start}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.lastRect = rect;
      this.lastRes = this.run(rect, true);
      this.ctx.world.setHighlightRect(rect, this.color(this.lastRes.ok));
    }
    const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0;
    const size = `${w}×${d}${this.lastRes?.affected !== undefined ? ` · ${this.lastRes.affected} ${this.mode.kind === 'bulldoze' ? 'items' : 'tiles'}` : ''}`;
    const title = this.mode.kind === 'bulldoze' ? 'Bulldoze' : this.mode.kind === 'dezone' ? 'De-zone' : this.label;
    const t = resultTip(title, this.lastRes, size);
    this.ctx.tip.show(t.html, t.kind);
  }

  override activate(): void {
    this.lastKey = '';
  }
  override deactivate(): void {
    this.start = null;
    this.ctx.world.setHighlightRect(null, 0);
    this.ctx.tip.hide();
  }
  override move(p: ToolPointer): void {
    this.refresh(p);
  }
  override down(p: ToolPointer): void {
    if (!p.hit) return;
    this.start = { x: p.hit.x, z: p.hit.z };
    if (this.mode.kind === 'bulldoze' && this.ctx.state.buildingAt(p.hit.x, p.hit.z)) {
      // clicking a building bulldozes it whole; dragging still selects a rect
    }
    this.lastKey = '';
    this.refresh(p);
  }
  override up(p: ToolPointer): void {
    if (!this.start) return;
    let rect = this.lastRect;
    if (p.hit) {
      const c = { x: p.hit.x, z: p.hit.z };
      rect = c.x === this.start.x && c.z === this.start.z ? this.hoverRect(c) : rectFrom(this.start, c);
    }
    this.start = null;
    if (rect) {
      // destructive bulldozing (last power plant / water source, landmarks, > §20k) asks first
      const risk = this.mode.kind === 'bulldoze' ? this.bulldozeRisk(rect) : null;
      if (risk) {
        this.ctx.world.setHighlightRect(null, 0);
        this.ctx.tip.hide();
        void confirmDialog(this.ctx, { title: risk.title, message: 'This demolition has consequences:', items: risk.items, confirm: 'Demolish', danger: true }).then((yes) => {
          if (yes && this.ctx.tools.active === this) this.commit(rect);
          this.lastKey = '';
          this.ctx.tools.refresh();
        });
      } else this.commit(rect);
    }
    this.lastKey = '';
    this.refresh(p);
  }

  private bulldozeRisk(rect: CellRect): DemolishRisk | null {
    const pre = this.run(rect, true);
    if (!pre.ok) return null;
    return safe(() => demolishRisks(this.ctx.state, rect, pre.cost ?? 0, { sandbox: this.ctx.sandbox() }), null);
  }

  private commit(rect: CellRect): void {
    const r = this.run(rect, false);
    // bigger rectangles sound bigger (intensity 0..1 from the area)
    const area = Math.max(1, (rect.x1 - rect.x0) * (rect.z1 - rect.z0));
    if (r.ok) this.ctx.sound(this.mode.kind === 'bulldoze' ? 'bulldoze' : this.mode.kind === 'dezone' ? 'dezone' : 'zone', { intensity: Math.min(1, Math.log2(area) / 8) });
    else {
      this.ctx.sound('error');
      if (r.reason) this.ctx.toast(r.reason, 'error');
    }
  }
  override cancel(): boolean {
    if (!this.start) return false;
    this.start = null;
    this.lastKey = '';
    this.ctx.world.setHighlightRect(null, 0);
    this.ctx.tip.hide();
    return true;
  }
  override leave(): void {
    if (!this.start) {
      this.ctx.world.setHighlightRect(null, 0);
      this.lastKey = '';
    }
    this.ctx.tip.hide();
  }
  override hints(): string[] {
    if (this.mode.kind === 'bulldoze') return ['Click a building or drag an area', 'Esc cancel'];
    return ['Drag to paint a rectangle', 'Esc cancel'];
  }
}
