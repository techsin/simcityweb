/**
 * Place a ploppable building: ghost follows the cursor, auto-faces the nearest road (R rotates manually); shore
 * buildings auto-face the water, preferring a side whose lot also touches a road (final fixes P14).
 * The fitting data view switches on while placing (WP5): parks → Parks (play / green tier), schools → Education with the
 * school's tier, fire stations → Emergency (fire response), garbage → Garbage, air / noise emitters → Air / Noise,
 * transit → Transit, a parking garage → Parking, unwanted / prestigious buildings → Prestige. The cursor tip previews
 * what the spot gives: transit stops within reach of a garage (park & ride), partner terminals of a ferry; what the
 * building costs a month here — "Upkeep here ≈§A/mo now · up to §B at full use" (final fixes P3 / UI-1: A = the budget
 * change it makes at this spot, placement.ts upkeepHere; the build menu, Rewards panel and facility facts quote the
 * city's typical figure, "≈§X/mo typical in this city"); and, in red, that a staffed service without a road won't work
 * (final fixes P8).
 */
import { CELL_SIZE } from '../../core/constants';
import { Overlay } from '../../core/types';
import type { ActionResult } from '../../sim/actions';
import { getDef } from '../../sim/catalog';
import type { BuildingDef } from '../../sim/catalogTypes';
import { facilityDefFacts } from '../../sim/infra/facilities';
import { lotTouchesRoad } from '../../sim/economy/buildings';
import { EMG_FIRE } from '../../sim/infra/overlays';
import type { GameContext } from '../context';
import { escapeHtml } from '../../ui/dom';
import { money } from '../../ui/format';
import { upkeepEstimate } from '../../ui/upkeepModel';
import { FAIL, resultTip, safe, Tool, type ToolPointer } from './Tool';
import { shoreFacesWater, shoreRotation, staffedService, type Rot } from './placement';
import { watchFor, type WatchHandle } from '../../worker/SimHost';
import type { QueryArgs, QueryResult } from '../../worker/queries';

/** actions.ts plop's shore rule failure (the tip adds how to fix it) */
const SHORE_FAIL = 'Must be placed on the shore with its front facing water';
/** the red line of a staffed service no road touches (final fixes P8) */
export const NO_ROAD_STAFFED = "No road access — staff can't reach it; it won't work until a road touches it";
/** cells the ground point under a resting pointer may drift (camera shake) while a click still places the preview */
export const PREVIEW_JITTER = 2;

/** the data view (and its variant, -1 = the view's own) that helps placing a def; null = leave the view alone */
export function autoOverlayOf(def: BuildingDef): { o: Overlay; v: number } | null {
  const tier = def.coverage?.tier;
  const id = def.id, m = def.model;
  const is = (x: string) => id === x || m === x;
  if (is('tr_parking_garage')) return { o: Overlay.Parking, v: -1 };
  if (is('civ_bus_depot') || def.category === 'transport' && (is('tr_bus_stop') || is('tr_subway_station') || is('tr_train_station') || is('tr_ferry_terminal'))) return { o: Overlay.Transit, v: -1 };
  if (tier === 'elementary') return { o: Overlay.Education, v: 1 };
  if (tier === 'high') return { o: Overlay.Education, v: 2 };
  if (tier === 'college' || tier === 'library') return { o: Overlay.Education, v: 3 };
  if (def.category === 'park' || tier === 'play' || tier === 'green') return { o: Overlay.Parks, v: tier === 'play' ? 1 : tier === 'green' ? 2 : 0 };
  if (def.category === 'fire') return { o: Overlay.Emergency, v: EMG_FIRE };
  if (def.category === 'police' && tier === 'police') return { o: Overlay.Police, v: -1 };
  if (def.category === 'health') return { o: Overlay.Health, v: -1 };
  if (def.category === 'garbage') return { o: Overlay.Garbage, v: is('util_landfill_tile') ? 1 : 0 };
  if ((def.pollution?.air ?? 0) > 0) return { o: Overlay.AirPollution, v: -1 };
  if ((def.pollution?.noise ?? 0) > 0) return { o: Overlay.Noise, v: -1 };
  if (def.category === 'power') return { o: Overlay.Power, v: -1 };
  if (def.category === 'water') return { o: Overlay.Water, v: -1 };
  if ((def.stigma?.amount ?? 0) >= 0.1 || (def.prestige?.amount ?? 0) >= 0.1) return { o: Overlay.Nimby, v: -1 };
  if (def.coverage?.kind === 'education') return { o: Overlay.Education, v: -1 };
  return null;
}

export class PlopTool extends Tool {
  readonly id: string;
  readonly label: string;
  private rot: Rot = 0;
  private manual = false;
  private lastKey = '';
  private place: { x: number; z: number; rot: Rot } | null = null;
  private res: ActionResult | null = null;

  /** variant of the auto data view (-1 = the view's own) */
  private autoVariant = -1;
  /** key facts of the def for the cursor tip ("Seats 1,500 · ~20-tile walk") */
  private facts = '';
  /** placement preview line (garage: stops in reach; ferry: partner terminals) and the key it was made for */
  private preview = '';
  private previewKey = '';
  private placementReads = new Map<string, Promise<{ html: string; targets: number[] }>>();
  private placementRequest = 0;
  /** the upkeep line of the current spot ("Upkeep here ≈§A/mo now · up to §B at full use"), made with res */
  private upkeep = '';
  private upkeepRead: WatchHandle<QueryResult<'upkeepContext'>, QueryArgs<'upkeepContext'>> | null = null;
  /** the current spot: a staffed service without a road (P8) / a shore building not facing water (P14) */
  private noRoad = false;
  private shoreHint = '';

  constructor(ctx: GameContext, private def: BuildingDef, icon: string) {
    super(ctx);
    this.id = 'plop:' + def.id;
    this.label = def.name;
    this.icon = icon;
    const ao = autoOverlayOf(def);
    this.autoOverlay = ao?.o ?? null;
    this.autoVariant = ao?.v ?? -1;
    // (the tip's header already shows the cost; upkeep, jobs and size repeat the toolbar card: left out)
    const f = safe(() => facilityDefFacts(def.id), []).filter((l) => !/^(upkeep|jobs|size|staff|cost)$/i.test(l.label) && !/^(upkeep|jobs|staff)$/i.test(l.key ?? ''));
    this.facts = f.slice(0, 2).map((l) => `${escapeHtml(l.label)} ${escapeHtml(l.value)}`).join(' · ');
  }

  /** building ids the placement preview points at (garage: stops in reach, ferry: partner terminals) */
  private targets: number[] = [];
  private previewTargets(x: number, z: number, rot: Rot): number[] {
    this.placementPreview(x, z, rot);
    return this.targets;
  }

  /** what this spot gives: stops for a garage's park & ride, partner terminals for a ferry (html, '' = nothing) */
  private placementPreview(x: number, z: number, rot: Rot): string {
    const d = this.def;
    const key = `${x},${z},${rot}`;
    if (key === this.previewKey) return this.preview;
    this.previewKey = key;
    const [w, dd] = this.dims(rot);
    this.preview = '';
    this.targets = [];
    const is = (id: string) => d.id === id || d.model === id;
    let read = this.placementReads.get(key);
    if (!read && is('tr_parking_garage')) {
      read = this.ctx.host.query('stopsNear', { x, z, w, d: dd }).then((stops) => ({
        targets: stops.map((s) => s.id),
        html: stops.length
        ? `<div class="tip-ok tip-facts">Park &amp; ride: ${stops.length} stop${stops.length > 1 ? 's' : ''} in reach — ${stops.slice(0, 3).map((s) => `${escapeHtml(s.name)} (${s.dist} tiles)`).join(', ')}</div>`
        : '<div class="tip-warn tip-facts">No transit stop within 5 tiles: drivers park but can\'t switch to transit here</div>',
      }));
    } else if (!read && is('tr_ferry_terminal')) {
      read = this.ctx.host.query('ferryPartnersFor', { x, z, w, d: dd, rot }).then((ps) => ({
        targets: ps.map((p) => p.id),
        html: ps.length
        ? `<div class="tip-ok tip-facts">Ferry links: ${ps.slice(0, 3).map((p) => `${escapeHtml(p.name)} (${p.minutes} min)`).join(', ')}</div>`
        : '<div class="tip-warn tip-facts">No partner terminal on this water yet — a ferry needs a second terminal to link to</div>',
      }));
    }
    if (read) {
      this.placementReads.set(key, read);
      const request = this.placementRequest;
      void read.then(({ html, targets }) => {
        if (this.ctx.signal.aborted || this.ctx.tools.active !== this || request !== this.placementRequest || key !== this.previewKey) return;
        this.preview = html;
        this.targets = targets;
        if (this.lastPointer) this.refresh(this.lastPointer, true);
      }).catch(() => { if (request === this.placementRequest) this.placementReads.delete(key); });
    }
    return this.preview;
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

  /** the auto rotation faces the water (a shore building with water beside it) */
  private facingWater = false;

  private choose(p: ToolPointer): { x: number; z: number; rot: Rot } {
    this.facingWater = false;
    if (this.manual) return { ...this.origin(p, this.rot), rot: this.rot };
    // shore buildings: the side facing the water (a road along the lot preferred), else the road as usual
    if (this.def.placement === 'shore') {
      const s = safe(() => shoreRotation(this.ctx.state, (r) => { const [w, d] = this.dims(r); return { ...this.origin(p, r), w, d }; }, this.rot), null);
      if (s) {
        this.rot = s.rot;
        this.facingWater = true;
        return s;
      }
    }
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

  /** the pointer of the last refresh (origins of the other rotations for the shore hint) */
  private lastPointer: ToolPointer | null = null;

  /** One argument-keyed watch; changes repaint only the active tool's current footprint. */
  private upkeepAt(x: number, z: number, w: number, d: number): number | null {
    const args = { defId: this.def.id, x, z, w, d };
    if (!this.upkeepRead) {
      this.upkeepRead = watchFor(this.ctx.host, 'upkeepContext', args, 'change', this.ctx.signal);
      this.upkeepRead.subscribe(() => {
        if (this.ctx.tools.active === this && this.lastPointer) this.refresh(this.lastPointer, true);
      }, this.ctx.signal);
    } else this.upkeepRead.setArgs(args);
    return this.upkeepRead.value?.here ?? null;
  }

  private refresh(p: ToolPointer | null, force = false): void {
    this.lastPointer = p && p.hit ? p : null;
    if (!p || !p.hit) {
      this.upkeepRead?.dispose(); this.upkeepRead = null;
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
      this.spotNotes(pl.x, pl.z, w, d, pl.rot);
      const cells = this.res.cells && this.res.cells.length ? [...this.res.cells] : [];
      if (!cells.length) for (let z = pl.z; z < pl.z + d; z++) for (let x = pl.x; x < pl.x + w; x++) cells.push({ x, z, ok });
      // the stops a garage would serve / the terminals a ferry would link to, lit up on the map
      for (const id of this.previewTargets(pl.x, pl.z, pl.rot)) {
        const b = this.ctx.state.buildings.get(id);
        if (b) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) cells.push({ x, z, ok: true });
      }
      this.ctx.world.setHighlight(cells);
    }
    const facing = this.manual ? 'R rotate' : this.facingWater ? 'Auto-facing water · R rotate' : 'Auto-facing road · R rotate';
    const t = resultTip(this.def.name, this.shown(), [this.upkeep, facing].filter(Boolean).map(escapeHtml).join(' · '));
    const pv = this.place ? this.placementPreview(this.place.x, this.place.z, this.place.rot) : '';
    // (a staffed service without a road is placeable but won't work: a red line and a red tip, P8)
    const bad = this.noRoad ? `<div class="tip-reason">${escapeHtml(NO_ROAD_STAFFED)}</div>` : '';
    this.ctx.tip.show(t.html + bad + (this.facts ? `<div class="tip-sub tip-facts">${this.facts}</div>` : '') + pv, bad ? 'bad' : t.kind);
  }

  /**
   * what this spot means beyond the preview's result: the upkeep here (P3 / UI-1: schools, clinics, stations, parks pay
   * running costs per person served — what one more costs here now, and the most it can cost), whether a staffed
   * service gets no road (P8), how to fix a shore building that doesn't face water (P14)
   */
  private spotNotes(x: number, z: number, w: number, d: number, rot: Rot): void {
    const def = this.def, st = this.ctx.state;
    const est = safe(() => upkeepEstimate(st, def), null);
    if (est) {
      // (the build menu's figure is city-wide; at the cursor it is this spot's: "Upkeep here")
      const here = safe(() => this.upkeepAt(x, z, w, d), null);
      const now = here ?? est.now;
      // (a fire station in a big unserved district can newly protect more than a typical station's "full use": the
      // figure here is then the most it costs — no "up to" the same number, UI-1)
      const full = money(Math.max(now, est.full));
      this.upkeep = `Upkeep${here !== null ? ' here' : ''} ≈${money(now)}/mo now${full !== money(now) ? ` · up to ${full} at full use` : ''}`;
    } else this.upkeep = def.upkeep ? `Upkeep ${money(def.upkeep)}/mo` : '';
    const res = this.res;
    this.noRoad = !!res?.ok && staffedService(def) && !safe(() => lotTouchesRoad(st, x, z, w, d), true);
    this.shoreHint = '';
    if (res && !res.ok && res.reason === SHORE_FAIL) {
      // another side of this spot faces the water: press R; none does: the spot is wrong
      let other = false;
      for (let r = 0 as Rot; r < 4 && !other; r = (r + 1) as Rot) {
        if (r === rot) continue;
        const [rw, rd] = this.dims(r);
        const o = this.place && this.lastPointer ? this.origin(this.lastPointer, r) : { x, z };
        other = safe(() => shoreFacesWater(st, o.x, o.z, rw, rd, r), false);
      }
      // (the reason already says "with its front facing water": the fix only names the move — final fixes UI-4)
      this.shoreHint = other ? ' — press R to face the water' : ' — move it onto the water\'s edge';
    }
  }

  /** the preview's result as the tip shows it: the staffed no-road warning goes in red (bad line), a shore failure
   *  says how to fix it */
  private shown(): ActionResult | null {
    const r = this.res;
    if (!r) return r;
    if (this.noRoad) return { ...r, reason: undefined };
    if (this.shoreHint && r.reason) return { ...r, reason: r.reason + this.shoreHint };
    return r;
  }

  override activate(): void {
    this.upkeepRead?.dispose(); this.upkeepRead = null;
    this.placementRequest++;
    this.placementReads.clear();
    this.lastKey = '';
    this.previewKey = '';
    this.manual = false;
    // the tool controller switches the auto data view on after activate(): pick its variant first (school tier ...)
    if (this.autoOverlay !== null && this.autoVariant >= 0) this.ctx.preferOverlayVariant?.(this.autoOverlay, this.autoVariant);
  }
  override deactivate(): void {
    this.upkeepRead?.dispose(); this.upkeepRead = null;
    this.placementRequest++;
    this.placementReads.clear();
    this.ctx.objects.setGhost(null);
    this.ctx.world.setHighlight(null);
    this.ctx.tip.hide();
  }
  override move(p: ToolPointer): void {
    this.refresh(p);
  }
  /**
   * The click places what the preview shows when the pointer has not moved since it was made and the ground point under
   * it moved at most PREVIEW_JITTER cells (the camera shook; a pan re-picks the spot): re-picking at the click moved the
   * building — under an earthquake's camera shake an ok preview became "Blocked by a road or rail" (close-out c2).
   */
  override down(p: ToolPointer): void {
    if (!this.previewHolds(p)) this.refresh(p, true);
    const pl = this.place;
    if (!pl) return;
    const unique = (getDef(this.def.id) ?? this.def).unique;
    const shoreHint = this.shoreHint;
    const ticket = this.commit('plop', [this.def.id, pl.x, pl.z, pl.rot], {
      ok: () => {
        this.ctx.sound('plop');
        if (unique && this.ctx.tools.active === this) this.ctx.tools.select(null, { silent: true });
      },
      fail: (r) => {
        this.ctx.sound('error');
        if (r.reason) this.ctx.toast(r.reason === SHORE_FAIL && shoreHint ? r.reason + shoreHint : r.reason, 'error');
      },
    });
    if (unique && ticket.exact && ticket.predicted?.ok) return;
    this.lastKey = '';
    this.refresh(p, true);
  }
  /** the last preview still stands for pointer p (down) */
  private previewHolds(p: ToolPointer): boolean {
    const lp = this.lastPointer;
    if (!this.place || !lp?.hit || !p.hit || lp.clientX !== p.clientX || lp.clientY !== p.clientY) return false;
    const tol = PREVIEW_JITTER * CELL_SIZE;
    return Math.abs(p.hit.point.x - lp.hit.point.x) <= tol && Math.abs(p.hit.point.z - lp.hit.point.z) <= tol;
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
