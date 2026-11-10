/** Query / inspect: hover highlights, click opens the info card. This is the default tool. */
import { Network, Overlay, isRoad } from '../../core/types';
import { overlayInfo, overlayTitle } from '../../ui/overlays';
import { overlayLayer, overlayReadout } from '../../sim/infra/overlays';
import { getDef } from '../../sim/catalog';
import { BF, type Building } from '../../sim/CityState';
import { needsExpectation, waterRequired } from '../../sim/economy/demographics';
import type { GameContext } from '../context';
import { escapeHtml } from '../../ui/dom';
import { num, pct } from '../../ui/format';
import {
  HoverStatusCache, THRIVING_CONDITION, THRIVING_TEXT, TIP_KIND, TIP_LINE, drawsPower, hoverStatus, type HoverStatus,
} from '../../ui/inspectorModel';
import { emptyZoneStatus, zoneStatusLine, zoneStatusTone } from '../../ui/zoneStatus';
import { NETWORK_LABELS } from './NetworkTool';
import { safe, Tool, type ToolPointer } from './Tool';
import { ZONE_LABELS } from './ZoneTool';

/** growables' conditions the hover keeps (FEEL-19); past this many it starts over */
const MAX_CONDITIONS = 4096;

export class QueryTool extends Tool {
  readonly id = 'query';
  readonly label = 'Query';
  override icon = 'query';
  override cursor = 'default';
  override wantsGrid = false;
  /** the highlighted building (undefined: unknown, the next move applies its pick whatever it is) */
  private hoverId: number | null | undefined = null;
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

  // ---- FEEL-19: the hover's status line
  /** the line per building, for the sim day it was read on */
  private statusCache = new HoverStatusCache();
  /** growables' condition as the host last answered it, and the sim day it answered on */
  private conditions = new Map<number, { day: number; health: number }>();
  /** buildings whose condition is being asked */
  private asking = new Set<number>();
  /** the pointer of the last move, to show the tip again when a condition arrives (null: the cursor left) */
  private lastPointer: ToolPointer | null = null;

  override move(p: ToolPointer): void {
    this.lastPointer = p;
    const id = this.pick(p);
    if (id !== this.hoverId) {
      this.hoverId = id;
      safe(() => this.ctx.objects.setSelected(id), undefined);
    }
    if (!this.showTip) return;
    const st = this.ctx.state;
    // (1 s bucket: utilities recompute while paused, e.g. an empty lot becomes powered)
    const key = `${id}:${p.hit?.x},${p.hit?.z}:${this.ctx.overlay}:${this.ctx.overlayVariant}:${st.day >> 2}:${Math.floor(performance.now() / 1000)}`;
    if (key === this.lastCell) return;
    this.lastCell = key;
    // data view active: read out the overlay value under the cursor — the same variant and raster the terrain draws
    const ov = this.ctx.overlay;
    if (ov !== Overlay.None && ov !== Overlay.Zones && p.hit) {
      const info = overlayInfo(ov);
      // the value and the name come from the same place: the highlighted building (its centre cell) — except on
      // road-only views, which read the road under the cursor — else the tile under the cursor
      const b = id !== null ? st.buildings.get(id) : undefined;
      const roadsOnly = !!safe(() => overlayLayer(st, ov, this.ctx.overlayVariant)?.roadsOnly, false);
      const useB = !!b && !roadsOnly;
      const cx = useB ? Math.min(st.size - 1, b!.x + (b!.w >> 1)) : p.hit.x, cz = useB ? Math.min(st.size - 1, b!.z + (b!.d >> 1)) : p.hit.z;
      const r = safe(() => overlayReadout(st, ov, cx, cz, this.ctx.overlayVariant), null);
      if (r) {
        const cls = r.tone === 'good' ? 'pos' : r.tone === 'warn' ? 'warn' : r.tone === 'bad' ? 'neg' : '';
        const where = escapeHtml(useB ? getDef(b!.def)?.name ?? b!.def : this.tileName(p.hit.x, p.hit.z));
        const sub = r.sub ? `${escapeHtml(r.sub)} · ${where}` : where;
        this.ctx.tip.show(`<div class="tip-head"><b>${escapeHtml(overlayTitle(ov, this.ctx.overlayVariant) || info?.label || 'Value')}</b><span class="${cls}" style="font-weight:800">${escapeHtml(r.text)}</span></div><div class="tip-sub">${sub}</div>`, 'info');
        return;
      }
    }
    if (id !== null) {
      const b = st.buildings.get(id);
      const def = b ? getDef(b.def) : undefined;
      if (b) {
        // FEEL-19: one status line under the name and occupancy, from the inspector's chip table in the chip's words and
        // tone (statusOf): what is wrong first, "Under construction N%" while it is built, "Thriving" for a growable
        // doing well. (A ruin houses and employs nobody: its residents / jobs are stale until the next population pass —
        // final fixes r4: a fresh ruin read "40 / 40 jobs". Its line is the inspector's cause-neutral "In ruins")
        const status = this.statusOf(b);
        const sub = b.flags & BF.Burnt ? ''
          : def?.category === 'growable' && def.devType !== undefined && def.devType <= 2 ? `<div class="tip-sub">${num(b.pop)} residents</div>` : b.capacity ? `<div class="tip-sub">${num(b.jobs)} / ${num(b.capacity)} jobs</div>` : '';
        const line = status ? `<div class="${TIP_LINE[status.tone]}">${escapeHtml(status.text)}</div>` : '';
        this.ctx.tip.show(`<div class="tip-head"><b>${escapeHtml(def?.name ?? b.def)}</b></div>${sub}${line}`, status ? TIP_KIND[status.tone] : 'info');
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
        // (a lot behind the buildings on the road waits for the lot in front: a warning, not a red blocker)
        const tone = zoneStatusTone(zs);
        this.ctx.tip.show(`<div class="tip-head"><b>${escapeHtml(ZONE_LABELS[st.zone[i]] ?? 'Zoned lot')}</b></div><div class="${tone === 'ok' ? 'tip-sub' : tone === 'warn' ? 'tip-warn' : 'tip-reason'}">${escapeHtml(zoneStatusLine(zs))}</div>${more}`, tone === 'bad' ? 'bad' : tone === 'ok' ? 'ok' : 'info');
        return;
      }
    }
    this.ctx.tip.hide();
  }
  /**
   * FEEL-19: building b's status line (inspectorModel hoverStatus over the shared chip table), worked out once per
   * building per sim day (HoverStatusCache; a flag or utility-cell change works it out again at once). Flags, built and
   * the power / water cells are exact on a worker host's replica (W0.3); a growable's condition is not (WORKER_DESIGN
   * §1.3: health is a lagged field there), so the host answers it, once per building per sim day, and the last answer
   * stands meanwhile. Only a growable without a problem chip asks: the condition decides only its "Thriving".
   */
  private statusOf(b: Building): HoverStatus | null {
    const st = this.ctx.state, def = getDef(b.def), growable = !def || def.category === 'growable';
    const i = st.idx(b.x, b.z), pw = st.powered[i] ? 1 : 0, wt = st.watered[i] ? 1 : 0;
    const cond = growable ? this.conditions.get(b.id) : undefined;
    const sig = (b.flags * 4 + pw * 2 + wt) * 3 + (cond === undefined ? 0 : cond.health >= THRIVING_CONDITION ? 2 : 1);
    const line = this.statusCache.get(b.id, st.day, sig, () => hoverStatus(b.flags, b.built, cond?.health, {
      poweredCell: pw === 1, wateredCell: wt === 1, usesPower: drawsPower(def, growable), growable,
      needsWater: safe(() => waterRequired(st, b), false), needsExpectation: safe(() => needsExpectation(st), 1),
    }));
    if (growable && (line === null || line.text === THRIVING_TEXT) && cond?.day !== st.day) this.askCondition(b.id);
    return line;
  }
  /** ask the host for building `id`'s condition (one request at a time per building). The answer shows the tip again
   *  while the cursor still rests on the building: at once on the local host, within a packet on the worker's */
  private askCondition(id: number): void {
    const host = this.ctx.host as GameContext['host'] | undefined;
    if (this.asking.has(id) || !host) return;
    this.asking.add(id);
    let answer: Promise<number | null>;
    try {
      answer = host.query('buildingCondition', { id });
    } catch {
      this.asking.delete(id);
      return;
    }
    answer.then((health) => {
      this.asking.delete(id);
      if (typeof health !== 'number') {
        this.conditions.delete(id);
        return;
      }
      if (this.conditions.size >= MAX_CONDITIONS) this.conditions.clear();
      this.conditions.set(id, { day: this.ctx.state.day, health });
      const p = this.lastPointer;
      if (p && this.hoverId === id) {
        this.lastCell = '';
        safe(() => this.move(p), undefined);
      }
    }, () => this.asking.delete(id));
  }
  /** what stands on a tile: its building, road, empty lot or bare land (the hover readout names it) */
  private tileName(x: number, z: number): string {
    const st = this.ctx.state;
    const i = st.idx(x, z);
    const bid = st.building[i];
    const b = bid >= 0 ? st.buildings.get(bid) : undefined;
    if (b) return getDef(b.def)?.name ?? b.def;
    const n = st.network[i] as Network;
    if (n) return NETWORK_LABELS[n] ?? 'Road';
    if (st.zone[i]) return `${ZONE_LABELS[st.zone[i]] ?? 'Zoned'} lot`;
    return st.water[i] ? 'Water' : `Tile ${x}, ${z}`;
  }
  override down(p: ToolPointer): void {
    this.downAt = { x: p.clientX, y: p.clientY };
    const c = this.ctx.world.controls as { beginPan?(x: number, y: number): void };
    c.beginPan?.(p.clientX, p.clientY);
  }
  override up(p: ToolPointer): void {
    const c = this.ctx.world.controls as { endPan?(): void };
    c.endPan?.();
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
    this.lastPointer = null;
    safe(() => this.ctx.objects.setSelected(null), undefined);
    this.ctx.tip.hide();
  }
  override leave(): void {
    this.lastCell = '';
    this.lastPointer = null;
    this.ctx.tip.hide();
  }
  /** FEEL-24 (QA B6): photo mode draws the plain city: the hover box goes, and the next move puts it back */
  clearHover(): void {
    this.hoverId = undefined;
    this.lastCell = '';
    safe(() => this.ctx.objects.setSelected(null), undefined);
    this.ctx.tip.hide();
  }
  override hints(): string[] {
    return ['Click a building, road or zoned lot to inspect', 'Alt-click any tile'];
  }
}
