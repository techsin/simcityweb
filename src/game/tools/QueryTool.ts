/** Query / inspect: hover highlights, click opens the info card. This is the default tool. */
import { Network, isRoad } from '../../core/types';
import { getDef } from '../../sim/catalog';
import type { GameContext } from '../context';
import { escapeHtml } from '../../ui/dom';
import { num, pct } from '../../ui/format';
import { NETWORK_LABELS } from './NetworkTool';
import { safe, Tool, type ToolPointer } from './Tool';

export class QueryTool extends Tool {
  readonly id = 'query';
  readonly label = 'Query';
  override icon = 'query';
  override cursor = 'default';
  override wantsGrid = false;
  private hoverId: number | null = null;
  private lastCell = '';
  private downAt: { x: number; y: number } | null = null;

  constructor(ctx: GameContext, private showTip = true) {
    super(ctx);
  }

  private pick(p: ToolPointer): number | null {
    let id = safe(() => this.ctx.objects.pickBuilding(p.clientX, p.clientY), null);
    if (id === null && p.hit) id = this.ctx.state.buildingAt(p.hit.x, p.hit.z)?.id ?? null;
    return id;
  }

  override move(p: ToolPointer): void {
    const id = this.pick(p);
    if (id !== this.hoverId) {
      this.hoverId = id;
      safe(() => this.ctx.objects.setSelected(id), undefined);
    }
    if (!this.showTip) return;
    const st = this.ctx.state;
    const key = `${id}:${p.hit?.x},${p.hit?.z}`;
    if (key === this.lastCell) return;
    this.lastCell = key;
    if (id !== null) {
      const b = st.buildings.get(id);
      const def = b ? getDef(b.def) : undefined;
      if (b) {
        const pop = def?.category === 'growable' && def.devType !== undefined && def.devType <= 2 ? `${num(b.pop)} residents` : b.capacity ? `${num(b.jobs)} / ${num(b.capacity)} jobs` : '';
        this.ctx.tip.show(`<div class="tip-head"><b>${escapeHtml(def?.name ?? b.def)}</b></div>${pop ? `<div class="tip-sub">${pop}</div>` : ''}`, 'info');
        return;
      }
    }
    if (p.hit) {
      const i = st.idx(p.hit.x, p.hit.z);
      const n = st.network[i] as Network;
      if (n && isRoad(n)) {
        this.ctx.tip.show(`<div class="tip-head"><b>${NETWORK_LABELS[n]}</b></div><div class="tip-sub">${num(st.traffic[i])} trips/day · ${pct(st.congestion[i])} congestion</div>`, 'info');
        return;
      }
    }
    this.ctx.tip.hide();
  }
  override down(p: ToolPointer): void {
    this.downAt = { x: p.clientX, y: p.clientY };
  }
  override up(p: ToolPointer): void {
    if (!this.downAt) return;
    const moved = Math.hypot(p.clientX - this.downAt.x, p.clientY - this.downAt.y);
    this.downAt = null;
    if (moved > 6) return;
    const id = this.pick(p);
    if (id !== null) {
      this.ctx.sound('select');
      const b = this.ctx.state.buildings.get(id);
      this.ctx.showQuery({ buildingId: id, x: b?.x ?? p.hit?.x ?? 0, z: b?.z ?? p.hit?.z ?? 0 });
    } else if (p.hit) {
      this.ctx.sound('select');
      this.ctx.showQuery({ buildingId: null, x: p.hit.x, z: p.hit.z });
    }
  }
  override deactivate(): void {
    this.hoverId = null;
    safe(() => this.ctx.objects.setSelected(null), undefined);
    this.ctx.tip.hide();
  }
  override leave(): void {
    this.lastCell = '';
    this.ctx.tip.hide();
  }
  override hints(): string[] {
    return ['Click a building, road or lot to inspect'];
  }
}
