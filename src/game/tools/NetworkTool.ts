/**
 * Roads / rail / power lines / subway: drag an L-shaped path (Shift flips the L), live preview + cost. A route through
 * developed lots that cuts occupied buildings off the grid / the pipes (final fixes N1) says so in the tip, tints those
 * buildings red and asks first (demolishRisk.ts).
 * Final fixes r3 (LD21c, the pattern UI-5 gave the bulldozer): per path change only utilityCut's local detour check
 * runs (utilityCutQuick); the map-wide flood fill it may need (1.55 ms median, 46 ms max per change on a 1M save) waits
 * until the path has rested CUT_SETTLE_MS, and the release's confirm (sideDemolishRisks) always runs it in full, so a
 * real cut is never missed.
 */
import { Network, Overlay, isRoad } from '../../core/types';
import type { ActionResult } from '../../sim/actions';
import { lPath, type Cell } from '../geom';
import type { GameContext } from '../context';
import { commitAction, FAIL, resultTip, safe, Tool, type ToolPointer } from './Tool';
import { buildingCells, utilityCut, utilityCutQuick, type DemolishRisk, type Removal, type UtilityCut } from '../demolishRisk';
import { confirmDialog } from '../../ui/Modals';
import { escapeHtml } from '../../ui/dom';
import { CUT_SETTLE_MS } from './ZoneTool';

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
  private riskRequest = 0;
  private riskPending = false;
  /** occupied buildings the drag's demolitions cut off the grid / the pipes (per path, with res; the full fill's
   *  answer once the path has rested) */
  private cut: UtilityCut | null = null;
  /** the full utility-cut fill waiting for the path to rest (CUT_SETTLE_MS) */
  private cutTimer: ReturnType<typeof setTimeout> | null = null;
  /** the tip's second line for the current path ("12 tiles · flipped", "Click and drag to build") */
  private extra = '';

  constructor(ctx: GameContext, private kind: NetKind, id: string, icon: string) {
    super(ctx);
    this.id = id;
    this.label = NETWORK_LABELS[String(kind)] ?? 'Network';
    this.icon = icon;
    if (kind === 'power') this.autoOverlay = Overlay.Power;
  }

  private run(path: Cell[]): ActionResult {
    const a = this.ctx.actions;
    const k = this.kind;
    return safe(() => (k === 'power' ? a.buildPowerLine(path, true) : k === 'subway' ? a.buildSubway(path, true) : a.buildNetwork(path, k, true)), FAIL);
  }

  private clearPreview(): void {
    this.cancelCut();
    this.ctx.world.setHighlight(null);
    this.ctx.objects.setNetworkPreview(null);
  }

  private cancelCut(): void {
    if (this.cutTimer !== null) clearTimeout(this.cutTimer);
    this.cutTimer = null;
  }

  /** the path rested: the full utility-cut fill, its red line and tint (nothing when the path changed meanwhile) */
  private settleCut(key: string, rm: Removal): void {
    this.cutTimer = null;
    if (key !== this.lastKey) return;
    this.cut = safe(() => utilityCut(this.ctx.state, rm), null);
    if (!this.cut) return;
    this.paint();
    this.showTip();
  }

  /** the path's cells (green / red as the preview says) and the buildings it cuts off (red) */
  private paint(): void {
    const res = this.res, path = this.path ?? [];
    const ok = !!res?.ok;
    const hl = res?.cells && res.cells.length ? [...res.cells] : path.map((q) => ({ ...q, ok }));
    if (this.cut) for (const c of buildingCells(this.ctx.state, this.cut.ids)) hl.push(c);
    this.ctx.world.setHighlight(hl);
  }

  /** the cursor tip of the current path's preview (res, extra, cut) */
  private showTip(): void {
    const t = resultTip(this.label, this.res, this.extra);
    const cut = this.cut ? `<div class="tip-reason">${escapeHtml(this.cut.text)}</div>` : '';
    this.ctx.tip.show(t.html + cut, cut ? 'bad' : t.kind);
  }

  /** what a drag along `path` adds in place of the lots it demolishes: road / rail cells conduct power, roads carry pipes */
  private added(path: Cell[]): Removal['add'] {
    const k = this.kind;
    return typeof k === 'number' ? { cells: path, pipes: isRoad(k) } : null;
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
    const key = path.length + ':' + path[0].x + ',' + path[0].z + '>' + c.x + ',' + c.z + (p.shift ? 's' : '') + (this.start ? 'd' : 'h') + ':' + (this.ctx.host.pending?.revision ?? 0);
    if (key !== this.lastKey || force) {
      this.lastKey = key;
      this.path = path;
      this.res = this.run(path);
      const ok = this.res.ok;
      const dem = ok ? this.res.demolished : undefined;
      // the cut: the local detour check now; when only the map-wide fill can tell, that once the path rests (settleCut)
      this.cancelCut();
      this.cut = null;
      if (dem?.length) {
        const rm: Removal = { buildings: dem, add: this.added(path) };
        if (safe(() => utilityCutQuick(this.ctx.state, rm), 'flood') === 'flood') this.cutTimer = setTimeout(() => this.settleCut(key, rm), CUT_SETTLE_MS);
      }
      this.paint();
      this.ctx.objects.setNetworkPreview(path, this.kind, ok);
    }
    const len = this.res?.ok && this.res.affected ? this.res.affected : path.length;
    this.extra = this.start ? `${len} tile${len === 1 ? '' : 's'}${p.shift ? ' · flipped' : ''}` : 'Click and drag to build';
    this.showTip();
  }

  override activate(): void {
    if (this.kind === 'subway') this.ctx.objects.setUnderground(true);
  }
  override deactivate(): void {
    this.riskRequest++; this.riskPending = false;
    if (this.kind === 'subway') this.ctx.objects.setUnderground(false);
    this.start = null;
    this.clearPreview();
    this.ctx.tip.hide();
  }
  override move(p: ToolPointer): void {
    this.refresh(p);
  }
  override down(p: ToolPointer): void {
    this.riskRequest++; this.riskPending = false;
    if (!p.hit) return;
    this.start = { x: p.hit.x, z: p.hit.z };
    this.lastKey = '';
    this.refresh(p);
  }
  override up(p: ToolPointer): void {
    if (!this.start) return;
    this.refresh(p);
    // (the release acts now: its confirm runs the full cut check itself)
    this.cancelCut();
    const path = this.path;
    this.start = null;
    if (path && path.length) {
      // a route through developed lots that demolishes a lot (> §20k of fees, DISPLACE_CONFIRM residents + jobs, or
      // buildings cut off the grid / the pipes) asks first
      const risk = this.sideRisk(path);
      if (risk) {
        const request = ++this.riskRequest, gesture = this.gesture ?? undefined;
        this.riskPending = true;
        this.clearPreview();
        this.ctx.tip.hide();
        this.lastKey = '';
        const work = risk.then(async (risk) => {
          if (this.ctx.signal.aborted || request !== this.riskRequest || this.ctx.tools.active !== this) return;
          const yes = !risk || await confirmDialog(this.ctx, { title: risk.title, message: 'This route runs through developed lots:', items: risk.items, confirm: 'Build & demolish', danger: true });
          if (this.ctx.signal.aborted || request !== this.riskRequest || this.ctx.tools.active !== this) return;
          this.riskPending = false;
          if (yes) await this.commitPath(path, gesture).done;
          if (this.ctx.signal.aborted || request !== this.riskRequest || this.ctx.tools.active !== this) return;
          this.lastKey = '';
          this.ctx.tools.refresh();
        }).catch(() => {
          if (this.ctx.signal.aborted || request !== this.riskRequest) return;
          this.riskPending = false;
          this.ctx.toast('Could not check demolition consequences', 'error');
        });
        gesture?.track(work);
        // the dialog is modal: no preview / tip underneath it (the next frame after it closes refreshes them)
        return;
      }
      this.commitPath(path);
    }
    this.lastKey = '';
    this.refresh(p, true);
  }

  private sideRisk(path: Cell[]): Promise<DemolishRisk | null> | null {
    const pre = this.run(path);
    if (!pre.ok || !pre.demolished?.length) return null;
    return this.ctx.host.query('sideDemolishRisks', { ids: pre.demolished, fee: pre.demolishFee ?? 0, refund: pre.refund, refundNote: pre.refundNote, sandbox: this.ctx.sandbox(), add: this.added(path) });
  }

  private commitPath(path: Cell[], gesture = this.gesture ?? undefined) {
    const feedback = { ok: () => this.ctx.sound(this.kind === 'power' ? 'powerline' : this.kind === 'subway' || this.kind === Network.Rail ? 'rail' : 'build', { intensity: Math.min(1, path.length / 40) }) };
    if (this.kind === 'power') return commitAction(this.ctx, this, 'buildPowerLine', [path], feedback, gesture);
    if (this.kind === 'subway') return commitAction(this.ctx, this, 'buildSubway', [path], feedback, gesture);
    return commitAction(this.ctx, this, 'buildNetwork', [path, this.kind], feedback, gesture);
  }
  override cancel(): boolean {
    if (!this.start && !this.riskPending) return false;
    this.riskRequest++; this.riskPending = false;
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
    // (off the map no tip shows a deferred cut — back on it, the preview runs again; the release's confirm checks it)
    this.cancelCut();
    if (!this.start) this.clearPreview();
    this.lastKey = '';
    this.ctx.tip.hide();
  }
  override hints(): string[] {
    return ['Drag to build', 'Shift flip corner', 'Esc / right-click cancel'];
  }
}
