/**
 * Dispatch tool (WP8): send an emergency unit yourself.
 *
 *   openDispatch(ctx, incidentId)   from the emergency banner / Emergencies panel ("Choose station…")
 *
 * The incident's site is marked; every station of a type the incident needs is highlighted (green: free units,
 * red: all busy / unfunded). Hovering a station previews its road route and shows its free units and ETA; click sends
 * one unit, Shift-click every free unit. Clicking another incident switches to it. Esc / right click cancels.
 */
import type { GameContext } from '../context';
import type { ToolSpec } from '../toolCatalog';
import { INCIDENT_LABEL, INCIDENT_RESPONDERS, RESPONDER_UNIT, emergencyOf, type DispatchOption, type Incident } from '../../sim/infra/emergency';
import { escapeHtml } from '../../ui/dom';
import { Tool, type ToolPointer } from './Tool';

let pendingIncident: number | null = null;

/** select the dispatch tool for an incident (re-targets it when it is already active) */
export function openDispatch(ctx: GameContext, incidentId: number): void {
  pendingIncident = incidentId;
  const cur = ctx.tools.active as unknown;
  if (cur instanceof DispatchTool) {
    cur.target(incidentId);
    pendingIncident = null;
    return;
  }
  if (!ctx.tools.select('dispatch')) pendingIncident = null;
}

/** toolbar / hotkey-less spec (registered in toolCatalog.ts STATIC_TOOLS) */
export const DISPATCH_SPEC: ToolSpec = {
  id: 'dispatch',
  label: 'Dispatch',
  icon: 'alert',
  color: '#ff6a4d',
  desc: 'Send a fire truck, police car or ambulance to an emergency yourself.',
  create: (c) => new DispatchTool(c),
};

function fmtMin(m: number): string {
  return Number.isFinite(m) ? `${m.toFixed(1)} min` : 'no road route';
}

export class DispatchTool extends Tool {
  readonly id = 'dispatch';
  readonly label = 'Dispatch';
  override icon = 'alert';
  override cursor = 'pointer';
  override wantsGrid = false;
  private inc: number | null = null;
  private opts: DispatchOption[] = [];
  private optsKey = '';
  private hoverStation: number | null = null;
  private routeCells: { x: number; z: number; ok: boolean }[] = [];
  private offs: (() => void)[] = [];

  override activate(): void {
    const id = pendingIncident ?? this.oldestWaiting();
    pendingIncident = null;
    this.target(id);
    // the incident may end (or units come back) while the tool is open
    this.offs.push(
      this.ctx.sim.events.on('emergency', (e) => {
        if (e.id !== this.inc) return;
        if (e.type === 'resolved' || e.type === 'failed') this.ended();
      }),
      this.ctx.ui.on('uiTick', () => {
        if (this.inc === null) return;
        if (!this.incident()) { this.ended(); return; }
        const k = this.optsKey;
        this.refreshOptions();
        if (k !== this.optsKey) this.paint();
      }),
    );
  }

  override deactivate(): void {
    for (const f of this.offs) f();
    this.offs = [];
    this.ctx.world.setHighlight(null);
    this.ctx.tip.hide();
    this.hoverStation = null;
    this.routeCells = [];
  }

  /** the targeted incident is over: next waiting incident, else back to the default tool */
  private ended(): void {
    const next = this.oldestWaiting(true);
    if (next !== null) {
      this.target(next);
      return;
    }
    this.inc = null;
    this.ctx.world.setHighlight(null);
    this.ctx.tip.hide();
    this.ctx.tools.select(null, { silent: true });
  }

  /** switch to an incident (null = the oldest one waiting for help) */
  target(id: number | null): void {
    this.inc = id;
    this.optsKey = '';
    this.hoverStation = null;
    const inc = this.incident();
    if (!inc) {
      this.ctx.toast('No emergency is waiting for a dispatch', 'info');
      this.ctx.world.setHighlight(null);
      return;
    }
    this.refreshOptions(true);
    this.paint();
  }

  private oldestWaiting(waitingOnly = false): number | null {
    const em = emergencyOf(this.ctx.sim);
    if (!em) return null;
    let best: Incident | null = null;
    for (const i of em.incidents()) if ((i.state === 'uncovered' || i.state === 'queued') && i.manualPossible && (!best || (i.major && !best.major) || i.start < best.start)) best = i;
    if (best || waitingOnly) return best?.id ?? null;
    return em.incidents()[0]?.id ?? null;
  }

  private incident(): Incident | undefined {
    return this.inc === null ? undefined : emergencyOf(this.ctx.sim)?.incident(this.inc);
  }

  private refreshOptions(force = false): void {
    const em = emergencyOf(this.ctx.sim);
    const inc = this.incident();
    if (!em || !inc) { this.opts = []; return; }
    const key = `${inc.id}:${this.ctx.state.day}:${inc.units.length}`;
    if (!force && key === this.optsKey) return;
    this.optsKey = key;
    this.opts = em.dispatchOptions(this.ctx.sim, inc.id);
  }

  /** station option under the cursor (the hovered building is a station of a needed type) */
  private optionAt(p: ToolPointer): DispatchOption | null {
    if (!p.hit) return null;
    const st = this.ctx.state;
    if (!st.inBounds(p.hit.x, p.hit.z)) return null;
    const bid = st.building[st.idx(p.hit.x, p.hit.z)];
    if (bid < 0) return null;
    return this.opts.find((o) => o.stationId === bid) ?? null;
  }

  /** highlights: incident site (red), stations (green = free, red = busy), hovered route */
  private paint(): void {
    const st = this.ctx.state;
    const inc = this.incident();
    if (!inc) { this.ctx.world.setHighlight(null); return; }
    const cells: { x: number; z: number; ok: boolean }[] = [];
    const mark = (id: number, ok: boolean) => {
      const b = st.buildings.get(id);
      if (!b) return;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) cells.push({ x, z, ok });
    };
    if (inc.buildingId >= 0) mark(inc.buildingId, false);
    else cells.push({ x: inc.x, z: inc.z, ok: false });
    for (const id of inc.fires) if (id !== inc.buildingId) mark(id, false);
    for (const o of this.opts) mark(o.stationId, o.free > 0 && Number.isFinite(o.etaMin));
    for (const c of this.routeCells) cells.push(c);
    this.ctx.world.setHighlight(cells);
  }

  private setRoute(o: DispatchOption | null): void {
    const id = o?.stationId ?? null;
    if (id === this.hoverStation) return;
    this.hoverStation = id;
    this.routeCells = [];
    const em = emergencyOf(this.ctx.sim);
    const inc = this.incident();
    if (o && em && inc && Number.isFinite(o.etaMin)) {
      const path = em.routePreview(this.ctx.sim, inc.id, o.stationId);
      if (path) this.routeCells = expandPath(path, this.ctx.state.size, o.free > 0);
    }
    this.paint();
  }

  override move(p: ToolPointer): void {
    const inc = this.incident();
    if (!inc) {
      this.ctx.tip.show('<div class="tip-head"><b>Dispatch</b></div><div class="tip-sub">No emergency selected — click a burning / flashing site</div>', 'info');
      return;
    }
    this.refreshOptions();
    const o = this.optionAt(p);
    this.setRoute(o);
    const need = INCIDENT_RESPONDERS[inc.kind];
    const title = `${INCIDENT_LABEL[inc.kind]} · ${escapeHtml(inc.place)}`;
    if (o) {
      const unit = RESPONDER_UNIT[o.responder];
      const ok = o.free > 0 && Number.isFinite(o.etaMin);
      const body = o.total <= 0
        ? `<div class="tip-reason">No funded ${unit[1]} — raise the budget</div>`
        : o.free <= 0
          ? `<div class="tip-reason">All ${o.total} ${unit[o.total === 1 ? 0 : 1]} are busy</div>`
          : !Number.isFinite(o.etaMin)
            ? '<div class="tip-reason">No road route to the emergency</div>'
            : `<div class="tip-sub">${o.free} of ${o.total} ${unit[1]} free · ETA <b>${fmtMin(o.etaMin)}</b>${o.inRange ? '' : ' (outside its coverage)'}</div><div class="tip-sub faint">Click: send 1 · Shift-click: send ${o.free}</div>`;
      this.ctx.tip.show(`<div class="tip-head"><b>${escapeHtml(o.name)}</b></div><div class="tip-sub">${title}</div>${body}`, ok ? 'ok' : 'bad');
      return;
    }
    const free = this.opts.filter((q) => q.free > 0 && Number.isFinite(q.etaMin));
    const best = free[0];
    const needs = need.map((r) => `${inc.need[r] ?? 0} ${RESPONDER_UNIT[r][(inc.need[r] ?? 0) === 1 ? 0 : 1]}`).join(' + ');
    this.ctx.tip.show(
      `<div class="tip-head"><b>${title}</b></div><div class="tip-sub">Needs ${needs}${inc.units.length ? ` · ${inc.units.length} assigned` : ''}</div>` +
        (best ? `<div class="tip-sub">Click a <span class="pos">green</span> station — fastest: ${escapeHtml(best.name)} (${fmtMin(best.etaMin)})</div>` : '<div class="tip-reason">No station with a free unit can reach it</div>'),
      best ? 'info' : 'bad',
    );
  }

  override down(p: ToolPointer): void {
    const em = emergencyOf(this.ctx.sim);
    if (!em || !p.hit) return;
    const o = this.optionAt(p);
    const inc = this.incident();
    if (!o) {
      // clicking another incident's site switches to it
      const other = em.report(this.ctx.sim, p.hit.x, p.hit.z);
      if (other && other.id !== this.inc) {
        this.target(other.id);
        this.ctx.sound('select');
      }
      return;
    }
    if (!inc) return;
    const n = p.shift ? Math.max(1, o.free) : 1;
    const r = em.dispatch(this.ctx.sim, inc.id, o.stationId, n);
    if (!r.ok) {
      this.ctx.sound('error');
      this.ctx.toast(r.reason ?? 'Could not dispatch', 'warning');
      return;
    }
    this.ctx.sound('confirm');
    const unit = RESPONDER_UNIT[o.responder][(r.sent ?? 1) === 1 ? 0 : 1];
    this.ctx.toast(`${r.sent ?? 1} ${unit} from ${o.name} — ETA ${fmtMin(r.etaMin ?? NaN)}`, 'good', { x: inc.x, z: inc.z }, 'Dispatched');
    this.optsKey = '';
    this.refreshOptions(true);
    this.hoverStation = null;
    this.routeCells = [];
    // done when nothing more is needed: back to the default tool
    const still = em.incident(inc.id);
    const missing = still ? INCIDENT_RESPONDERS[still.kind].some((rr) => (still.need[rr] ?? 0) > still.units.filter((u) => em.vehicles().find((v) => v.id === u)?.responder === rr).length) : false;
    if (!missing) this.ctx.tools.select(null, { silent: true });
    else this.paint();
  }

  override hints(): string[] {
    return ['Click a green station: send 1', 'Shift-click: send all free', 'Esc cancel'];
  }
}

/** corner cells -> every cell along the straight segments */
function expandPath(path: readonly number[], N: number, ok: boolean): { x: number; z: number; ok: boolean }[] {
  const out: { x: number; z: number; ok: boolean }[] = [];
  for (let k = 0; k < path.length; k++) {
    const a = path[k];
    const ax = a % N, az = Math.floor(a / N);
    if (k === 0) { out.push({ x: ax, z: az, ok }); continue; }
    const b = path[k - 1];
    let x = b % N, z = Math.floor(b / N);
    let guard = 0;
    while ((x !== ax || z !== az) && guard++ < 4 * N) {
      x += Math.sign(ax - x);
      if (x === ax) z += Math.sign(az - z);
      out.push({ x, z, ok });
    }
  }
  return out;
}
