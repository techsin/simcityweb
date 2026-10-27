/**
 * Zoning / de-zoning / bulldozing: drag a rectangle, live cost preview, apply on release.
 * Final fixes N1: the bulldozer (and a rezoning that tears buildings down) previews the occupied buildings it would cut
 * off the grid / the pipes — a red tip line and those buildings tinted red — and asks first (demolishRisk.ts).
 * Final fixes N3: the zone preview tints the tiles that will never get road access red and says how many (a warning,
 * not a block: zoneStatus.ts zonePlanNoAccess).
 * Final fixes UI-5: per rectangle change only utilityCut's local detour check runs (utilityCutQuick, ~0.02 ms); the
 * map-wide flood fill it sometimes needs (1.5-37 ms in a 1M city, once per cell step of a drag) waits until the
 * rectangle has rested CUT_SETTLE_MS, and the release's confirm (demolishRisks / sideDemolishRisks) always runs it in
 * full, so a real cut is never missed.
 */
import type { CellRect } from '../../core/events';
import { Zone } from '../../core/types';
import type { ActionResult } from '../../sim/actions';
import { rectFrom, type Cell } from '../geom';
import type { GameContext } from '../context';
import { FAIL, resultTip, safe, Tool, type ToolPointer } from './Tool';
import { buildingCells, bulldozeCut, bulldozeRemoval, demolishRisks, sideDemolishRisks, utilityCut, utilityCutQuick, type DemolishRisk, type Removal, type UtilityCut } from '../demolishRisk';
import { confirmDialog } from '../../ui/Modals';
import { escapeHtml } from '../../ui/dom';
import { noAccessText, zonePlanNoAccess } from '../../ui/zoneStatus';

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
/** ms a rectangle rests before the preview runs the full utility-cut fill (final fixes UI-5) */
export const CUT_SETTLE_MS = 100;

type RectMode = { kind: 'zone'; zone: Zone } | { kind: 'dezone' } | { kind: 'bulldoze' };

export class RectTool extends Tool {
  readonly id: string;
  readonly label: string;
  private start: Cell | null = null;
  private lastKey = '';
  private lastRect: CellRect | null = null;
  private lastRes: ActionResult | null = null;
  /** the preview's warnings (made per rect with lastRes): buildings cut off the grid / pipes, tiles without road access */
  private lastCut: UtilityCut | null = null;
  private lastNoAccess = '';
  /** the red tiles of lastNoAccess */
  private naCells: { x: number; z: number; ok: boolean }[] = [];
  /** cell highlights are on (the red tiles / buildings of the warnings above) */
  private hlOn = false;
  /** the full utility-cut fill waiting for the rectangle to rest (UI-5) */
  private cutTimer: ReturnType<typeof setTimeout> | null = null;

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

  private run(rect: CellRect): ActionResult {
    const a = this.ctx.actions;
    const m = this.mode;
    return safe(() => (m.kind === 'zone' ? a.zone(rect, m.zone, true) : m.kind === 'dezone' ? a.dezone(rect, true) : a.bulldoze(rect, true)), FAIL);
  }

  /** rect for hovering (no drag): bulldoze snaps to the building under the cursor */
  private hoverRect(c: Cell): CellRect {
    if (this.mode.kind === 'bulldoze') {
      const b = this.ctx.state.buildingAt(c.x, c.z);
      if (b) return { x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d };
    }
    return { x0: c.x, z0: c.z, x1: c.x + 1, z1: c.z + 1 };
  }

  /** the preview's warnings for `rect` (lastRes is its preview, `key` its refresh key): utility cuts of the bulldozer /
   *  a rezoning's demolitions, the tiles a zoning leaves without road access; their cells are tinted red. The cut: the
   *  local detour check now, the full fill once the rectangle rests (settleCut) */
  private warnings(rect: CellRect, key: string): void {
    const st = this.ctx.state, res = this.lastRes;
    this.cancelCut();
    this.lastCut = null;
    this.lastNoAccess = '';
    this.naCells = [];
    let rm: Removal | null = null;
    if (res?.ok) {
      const m = this.mode;
      if (m.kind === 'bulldoze') rm = safe(() => bulldozeRemoval(st, rect), null);
      else if (m.kind === 'zone') {
        if (res.demolished?.length) rm = { buildings: res.demolished };
        const na = safe(() => zonePlanNoAccess(st, rect, m.zone, res.demolished), { none: [], total: 0 });
        if (na.none.length) {
          this.lastNoAccess = noAccessText(na.none.length, Math.max(na.total, res.affected ?? 0));
          const N = st.size;
          for (const i of na.none) this.naCells.push({ x: i % N, z: (i / N) | 0, ok: false });
        }
      }
    }
    const removal = rm;
    if (removal && safe(() => utilityCutQuick(st, removal), 'flood') === 'flood') this.cutTimer = setTimeout(() => this.settleCut(key, rect, removal), CUT_SETTLE_MS);
    this.paint();
  }

  /** the rectangle rested: the full utility-cut fill, its red line and tint (nothing when the rectangle moved on) */
  private settleCut(key: string, rect: CellRect, rm: Removal): void {
    this.cutTimer = null;
    if (key !== this.lastKey) return;
    const st = this.ctx.state;
    // (a bulldozed rect is read again: the city may have changed while it rested)
    this.lastCut = safe(() => (this.mode.kind === 'bulldoze' ? bulldozeCut(st, rect) : utilityCut(st, rm)), null);
    if (!this.lastCut) return;
    this.paint();
    this.showTip(rect);
  }

  private cancelCut(): void {
    if (this.cutTimer !== null) clearTimeout(this.cutTimer);
    this.cutTimer = null;
  }

  /** the red tint of the warnings: tiles without road access, buildings cut off */
  private paint(): void {
    const hl = [...this.naCells];
    if (this.lastCut) for (const c of buildingCells(this.ctx.state, this.lastCut.ids)) hl.push(c);
    this.highlight(hl);
  }

  private highlight(cells: { x: number; z: number; ok: boolean }[] | null): void {
    const on = !!cells && cells.length > 0;
    if (!on && !this.hlOn) return;
    this.hlOn = on;
    this.ctx.world.setHighlight(on ? cells : null);
  }

  private clearPreview(): void {
    this.cancelCut();
    this.ctx.world.setHighlightRect(null, 0);
    this.highlight(null);
  }

  private refresh(p: ToolPointer): void {
    if (!p.hit) {
      this.clearPreview();
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
      this.lastRes = this.run(rect);
      this.ctx.world.setHighlightRect(rect, this.color(this.lastRes.ok));
      this.warnings(rect, key);
    }
    this.showTip(rect);
  }

  /** the cursor tip of `rect`'s preview (lastRes, lastCut, lastNoAccess) */
  private showTip(rect: CellRect): void {
    const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0;
    const size = `${w}×${d}${this.lastRes?.affected !== undefined ? ` · ${this.lastRes.affected} ${this.mode.kind === 'bulldoze' ? 'items' : 'tiles'}` : ''}`;
    const title = this.mode.kind === 'bulldoze' ? 'Bulldoze' : this.mode.kind === 'dezone' ? 'De-zone' : this.label;
    const t = resultTip(title, this.lastRes, size);
    // (a cut is a red line and a red tip: the click asks first; tiles without road access are a warning)
    const cut = this.lastCut ? `<div class="tip-reason">${escapeHtml(this.lastCut.text)}</div>` : '';
    const na = this.lastNoAccess ? `<div class="tip-warn">${escapeHtml(this.lastNoAccess)}</div>` : '';
    this.ctx.tip.show(t.html + cut + na, cut ? 'bad' : t.kind);
  }

  override activate(): void {
    this.lastKey = '';
  }
  override deactivate(): void {
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
    if (this.mode.kind === 'bulldoze' && this.ctx.state.buildingAt(p.hit.x, p.hit.z)) {
      // clicking a building bulldozes it whole; dragging still selects a rect
    }
    this.lastKey = '';
    this.refresh(p);
  }
  override up(p: ToolPointer): void {
    if (!this.start) return;
    // (the click acts now: its confirm runs the full cut check itself)
    this.cancelCut();
    let rect = this.lastRect;
    if (p.hit) {
      const c = { x: p.hit.x, z: p.hit.z };
      rect = c.x === this.start.x && c.z === this.start.z ? this.hoverRect(c) : rectFrom(this.start, c);
    }
    this.start = null;
    if (rect) {
      // destructive bulldozing (last power plant / water source, buildings cut off the grid / pipes, landmarks,
      // > §20k) and rezoning that demolishes a lot (> §20k of fees, DISPLACE_CONFIRM residents + jobs, or a cut) ask first
      const bull = this.mode.kind === 'bulldoze';
      const risk = bull ? this.bulldozeRisk(rect) : this.mode.kind === 'zone' ? this.rezoneRisk(rect) : null;
      if (risk) {
        this.clearPreview();
        this.ctx.tip.hide();
        this.lastKey = '';
        const msg = bull ? 'This demolition has consequences:' : 'Rezoning demolishes the buildings on these lots:';
        void confirmDialog(this.ctx, { title: risk.title, message: msg, items: risk.items, confirm: bull ? 'Demolish' : 'Rezone & demolish', danger: true }).then((yes) => {
          if (this.ctx.signal.aborted) return;
          if (yes && this.ctx.tools.active === this) this.commitRect(rect);
          this.lastKey = '';
          this.ctx.tools.refresh();
        });
        // the dialog is modal: no hover preview / tip underneath it (the next frame after it closes refreshes them)
        return;
      }
      this.commitRect(rect);
    }
    this.lastKey = '';
    this.refresh(p);
  }

  private bulldozeRisk(rect: CellRect): DemolishRisk | null {
    const pre = this.run(rect);
    if (!pre.ok) return null;
    return safe(() => demolishRisks(this.ctx.state, rect, pre.cost ?? 0, { sandbox: this.ctx.sandbox() }), null);
  }

  /** zoning over growables of another family demolishes them (ActionResult.demolished) */
  private rezoneRisk(rect: CellRect): DemolishRisk | null {
    const pre = this.run(rect);
    if (!pre.ok || !pre.demolished?.length) return null;
    return safe(() => sideDemolishRisks(this.ctx.state, pre.demolished, pre.demolishFee ?? 0, { sandbox: this.ctx.sandbox() }), null);
  }

  private commitRect(rect: CellRect): void {
    // bigger rectangles sound bigger (intensity 0..1 from the area)
    const area = Math.max(1, (rect.x1 - rect.x0) * (rect.z1 - rect.z0));
    const feedback = { ok: () => this.ctx.sound(this.mode.kind, { intensity: Math.min(1, Math.log2(area) / 8) }) };
    if (this.mode.kind === 'zone') this.commit('zone', [rect, this.mode.zone], feedback);
    else this.commit(this.mode.kind, [rect], feedback);
  }
  override cancel(): boolean {
    if (!this.start) return false;
    this.start = null;
    this.lastKey = '';
    this.clearPreview();
    this.ctx.tip.hide();
    return true;
  }
  override leave(): void {
    // (off the map no tip shows a deferred cut — back on it, the preview runs again; the release's confirm checks it)
    this.cancelCut();
    if (!this.start) this.clearPreview();
    this.lastKey = '';
    this.ctx.tip.hide();
  }
  override hints(): string[] {
    if (this.mode.kind === 'bulldoze') return ['Click a building or drag an area', 'Esc cancel'];
    return ['Drag to paint a rectangle', 'Esc cancel'];
  }
}
