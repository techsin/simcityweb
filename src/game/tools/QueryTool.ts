/** Query / inspect: hover highlights, click opens the info card. This is the default tool. */
import { Network, Overlay, isRoad } from '../../core/types';
import { overlayInfo } from '../../ui/overlays';
import { getDef } from '../../sim/catalog';
import type { GameContext } from '../context';
import { escapeHtml } from '../../ui/dom';
import { num, pct } from '../../ui/format';
import { emptyZoneStatus, zoneStatusLine } from '../../ui/zoneStatus';
import { NETWORK_LABELS } from './NetworkTool';
import { safe, Tool, type ToolPointer } from './Tool';
import { ZONE_LABELS } from './ZoneTool';

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
    // (1 s bucket: utilities recompute while paused, e.g. an empty lot becomes powered)
    const key = `${id}:${p.hit?.x},${p.hit?.z}:${this.ctx.overlay}:${st.day >> 2}:${Math.floor(performance.now() / 1000)}`;
    if (key === this.lastCell) return;
    this.lastCell = key;
    // data view active: read out the overlay value under the cursor
    const ov = this.ctx.overlay;
    const ovf = this.ctx.mods.infra?.overlayValue;
    if (ov !== Overlay.None && ov !== Overlay.Zones && p.hit && ovf) {
      const info = overlayInfo(ov);
      let v = 0;
      try {
        v = ovf(st, ov, p.hit.x, p.hit.z);
      } catch {
        v = 0;
      }
      const layer = safe(() => this.ctx.mods.infra?.overlayLayer?.(st, ov) ?? null, null);
      const binary = layer?.palette === 'binary';
      const txt = binary ? (v > 0.5 ? info?.hi ?? 'Yes' : info?.lo ?? 'No') : layer?.palette === 'diverging' ? `${v > 0 ? '+' : ''}${Math.round(v * 100)}` : pct(v);
      const good = info?.goodHigh ? v : 1 - v;
      const cls = good >= 0.66 ? 'pos' : good >= 0.33 ? 'warn' : 'neg';
      const b = id !== null ? st.buildings.get(id) : undefined;
      const sub = b ? escapeHtml(getDef(b.def)?.name ?? b.def) : `Tile ${p.hit.x}, ${p.hit.z}`;
      this.ctx.tip.show(`<div class="tip-head"><b>${escapeHtml(info?.label ?? layer?.label ?? 'Value')}</b><span class="${cls}" style="font-weight:800">${txt}</span></div><div class="tip-sub">${sub}</div>`, 'info');
      return;
    }
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
      // empty zoned lot: why it is (not) growing — no power / road / water / demand
      const zs = safe(() => emptyZoneStatus(st, p.hit!.x, p.hit!.z), null);
      if (zs) {
        const more = zs.blockers.slice(1, 3).map((b) => `<div class="tip-warn">${escapeHtml(b.text)}</div>`).join('');
        this.ctx.tip.show(`<div class="tip-head"><b>${escapeHtml(ZONE_LABELS[st.zone[i]] ?? 'Zoned lot')}</b></div><div class="${zs.ready ? 'tip-sub' : 'tip-reason'}">${escapeHtml(zoneStatusLine(zs))}</div>${more}`, zs.ready ? 'ok' : 'bad');
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
      // the inspect ping is the sound: the inspector opens without its panel swish
      this.ctx.sound('select');
      const b = this.ctx.state.buildings.get(id);
      this.ctx.showQuery({ buildingId: id, x: b?.x ?? p.hit?.x ?? 0, z: b?.z ?? p.hit?.z ?? 0 }, { silent: true });
    } else if (p.hit) {
      const st = this.ctx.state;
      const i = st.idx(p.hit.x, p.hit.z);
      // bare land / water: close the inspector (Alt-click inspects anyway)
      if (!st.network[i] && !st.zone[i] && !st.powerLines[i] && !p.alt) {
        this.ctx.showQuery(null);
        return;
      }
      this.ctx.sound('select');
      this.ctx.showQuery({ buildingId: null, x: p.hit.x, z: p.hit.z }, { silent: true });
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
    return ['Click a building, road or zoned lot to inspect', 'Alt-click any tile'];
  }
}
