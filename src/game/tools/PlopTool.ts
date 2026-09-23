/** Place a ploppable building: ghost follows the cursor, auto-faces the nearest road (R rotates manually). */
import { CELL_SIZE } from '../../core/constants';
import type { ActionResult } from '../../sim/actions';
import { getDef } from '../../sim/catalog';
import type { BuildingDef } from '../../sim/catalogTypes';
import type { GameContext } from '../context';
import { escapeHtml } from '../../ui/dom';
import { money } from '../../ui/format';
import { FAIL, resultTip, safe, Tool, type ToolPointer } from './Tool';

type Rot = 0 | 1 | 2 | 3;

export class PlopTool extends Tool {
  readonly id: string;
  readonly label: string;
  private rot: Rot = 0;
  private manual = false;
  private lastKey = '';
  private place: { x: number; z: number; rot: Rot } | null = null;
  private res: ActionResult | null = null;

  constructor(ctx: GameContext, private def: BuildingDef, icon: string) {
    super(ctx);
    this.id = 'plop:' + def.id;
    this.label = def.name;
    this.icon = icon;
  }

  private dims(rot: Rot): [number, number] {
    const [w, d] = this.def.footprint;
    return rot % 2 ? [d, w] : [w, d];
  }

  private origin(p: ToolPointer, rot: Rot): { x: number; z: number } {
    const [w, d] = this.dims(rot);
    const px = p.hit!.point.x / CELL_SIZE, pz = p.hit!.point.z / CELL_SIZE;
    return { x: Math.round(px - w / 2), z: Math.round(pz - d / 2) };
  }

  /** count road cells along the front edge for a given rotation */
  private frontRoads(x: number, z: number, rot: Rot): number {
    const st = this.ctx.state;
    const [w, d] = this.dims(rot);
    let n = 0;
    if (rot === 0) for (let i = 0; i < w; i++) n += st.isRoadAt(x + i, z + d) ? 1 : 0;
    else if (rot === 1) for (let i = 0; i < d; i++) n += st.isRoadAt(x + w, z + i) ? 1 : 0;
    else if (rot === 2) for (let i = 0; i < w; i++) n += st.isRoadAt(x + i, z - 1) ? 1 : 0;
    else for (let i = 0; i < d; i++) n += st.isRoadAt(x - 1, z + i) ? 1 : 0;
    return n;
  }

  private choose(p: ToolPointer): { x: number; z: number; rot: Rot } {
    if (this.manual) return { ...this.origin(p, this.rot), rot: this.rot };
    let best = { ...this.origin(p, this.rot), rot: this.rot };
    let bestN = this.frontRoads(best.x, best.z, best.rot);
    for (let r = 0 as Rot; r < 4; r = (r + 1) as Rot) {
      if (r === this.rot) continue;
      const o = this.origin(p, r);
      const n = this.frontRoads(o.x, o.z, r);
      if (n > bestN) {
        bestN = n;
        best = { ...o, rot: r };
      }
    }
    this.rot = best.rot;
    return best;
  }

  private refresh(p: ToolPointer | null, force = false): void {
    if (!p || !p.hit) {
      this.ctx.objects.setGhost(null);
      this.ctx.world.setHighlight(null);
      this.ctx.tip.hide();
      this.place = null;
      this.lastKey = '';
      return;
    }
    const pl = this.choose(p);
    const key = `${pl.x},${pl.z},${pl.rot}`;
    if (key !== this.lastKey || force) {
      this.lastKey = key;
      this.place = pl;
      this.res = safe(() => this.ctx.actions.plop(this.def.id, pl.x, pl.z, pl.rot, true), FAIL);
      const ok = this.res.ok;
      this.ctx.objects.setGhost(this.def.id, pl.x, pl.z, pl.rot, ok);
      const [w, d] = this.dims(pl.rot);
      const cells = this.res.cells && this.res.cells.length ? this.res.cells : [];
      if (!cells.length) for (let z = pl.z; z < pl.z + d; z++) for (let x = pl.x; x < pl.x + w; x++) cells.push({ x, z, ok });
      this.ctx.world.setHighlight(cells);
    }
    const up = this.def.upkeep ? `Upkeep ${money(this.def.upkeep)}/mo` : '';
    const t = resultTip(this.def.name, this.res, [up, this.manual ? 'R rotate' : 'Auto-facing road · R rotate'].filter(Boolean).map(escapeHtml).join(' · '));
    this.ctx.tip.show(t.html, t.kind);
  }

  override activate(): void {
    this.lastKey = '';
    this.manual = false;
  }
  override deactivate(): void {
    this.ctx.objects.setGhost(null);
    this.ctx.world.setHighlight(null);
    this.ctx.tip.hide();
  }
  override move(p: ToolPointer): void {
    this.refresh(p);
  }
  override down(p: ToolPointer): void {
    this.refresh(p, true);
    const pl = this.place;
    if (!pl) return;
    const r = safe(() => this.ctx.actions.plop(this.def.id, pl.x, pl.z, pl.rot, false), FAIL);
    if (r.ok) {
      this.ctx.sound('plop');
      const def = getDef(this.def.id) ?? this.def;
      if (def.unique) {
        this.ctx.tools.select(null);
        return;
      }
    } else {
      this.ctx.sound('error');
      if (r.reason) this.ctx.toast(r.reason, 'error');
    }
    this.lastKey = '';
    this.refresh(p, true);
  }
  override key(e: KeyboardEvent, p: ToolPointer | null): boolean {
    if (e.type === 'keydown' && (e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
      this.manual = true;
      this.rot = ((this.rot + (e.shiftKey ? 3 : 1)) % 4) as Rot;
      this.ctx.sound('rotate');
      this.refresh(p, true);
      return true;
    }
    return false;
  }
  override leave(): void {
    this.refresh(null);
  }
  override hints(): string[] {
    return ['Click to place', 'R rotate', 'Esc done'];
  }
}
