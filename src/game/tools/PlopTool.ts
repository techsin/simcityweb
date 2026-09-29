/**
 * Place a ploppable building: ghost follows the cursor, auto-faces the nearest road (R rotates manually).
 * The fitting data view switches on while placing (WP5): parks → Parks (play / green tier), schools → Education with the
 * school's tier, fire stations → Emergency (fire response), garbage → Garbage, air / noise emitters → Air / Noise,
 * transit → Transit, a parking garage → Parking, unwanted / prestigious buildings → Prestige. The cursor tip previews
 * what the spot gives: transit stops within reach of a garage (park & ride), partner terminals of a ferry.
 */
import { CELL_SIZE } from '../../core/constants';
import { Overlay } from '../../core/types';
import type { ActionResult } from '../../sim/actions';
import { getDef } from '../../sim/catalog';
import type { BuildingDef } from '../../sim/catalogTypes';
import { facilityDefFacts } from '../../sim/infra/facilities';
import { ferryPartnersFor, stopsNear } from '../../sim/infra/transportFacilities';
import { EMG_FIRE } from '../../sim/infra/overlays';
import type { GameContext } from '../context';
import { escapeHtml } from '../../ui/dom';
import { money } from '../../ui/format';
import { FAIL, resultTip, safe, Tool, type ToolPointer } from './Tool';

type Rot = 0 | 1 | 2 | 3;

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

  constructor(ctx: GameContext, private def: BuildingDef, icon: string) {
    super(ctx);
    this.id = 'plop:' + def.id;
    this.label = def.name;
    this.icon = icon;
    const ao = autoOverlayOf(def);
    this.autoOverlay = ao?.o ?? null;
    this.autoVariant = ao?.v ?? -1;
    const f = safe(() => facilityDefFacts(def.id), []);
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
    let html = '';
    this.targets = [];
    const is = (id: string) => d.id === id || d.model === id;
    if (is('tr_parking_garage')) {
      const stops = safe(() => stopsNear(this.ctx.sim, x, z, w, dd), []);
      this.targets = stops.map((s) => s.id);
      html = stops.length
        ? `<div class="tip-ok tip-facts">Park &amp; ride: ${stops.length} stop${stops.length > 1 ? 's' : ''} in reach — ${stops.slice(0, 3).map((s) => `${escapeHtml(s.name)} (${s.dist} tiles)`).join(', ')}</div>`
        : '<div class="tip-warn tip-facts">No transit stop within 5 tiles: drivers park but can\'t switch to transit here</div>';
    } else if (is('tr_ferry_terminal')) {
      const ps = safe(() => ferryPartnersFor(this.ctx.sim, x, z, w, dd, rot), []);
      this.targets = ps.map((p) => p.id);
      html = ps.length
        ? `<div class="tip-ok tip-facts">Ferry links: ${ps.slice(0, 3).map((p) => `${escapeHtml(p.name)} (${p.minutes} min)`).join(', ')}</div>`
        : '<div class="tip-warn tip-facts">No partner terminal on this water yet — a ferry needs a second terminal to link to</div>';
    }
    this.preview = html;
    return html;
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
      const cells = this.res.cells && this.res.cells.length ? [...this.res.cells] : [];
      if (!cells.length) for (let z = pl.z; z < pl.z + d; z++) for (let x = pl.x; x < pl.x + w; x++) cells.push({ x, z, ok });
      // the stops a garage would serve / the terminals a ferry would link to, lit up on the map
      for (const id of this.previewTargets(pl.x, pl.z, pl.rot)) {
        const b = this.ctx.state.buildings.get(id);
        if (b) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) cells.push({ x, z, ok: true });
      }
      this.ctx.world.setHighlight(cells);
    }
    const up = this.def.upkeep ? `Upkeep ${money(this.def.upkeep)}/mo` : '';
    const t = resultTip(this.def.name, this.res, [up, this.manual ? 'R rotate' : 'Auto-facing road · R rotate'].filter(Boolean).map(escapeHtml).join(' · '));
    const pv = this.place ? this.placementPreview(this.place.x, this.place.z, this.place.rot) : '';
    this.ctx.tip.show(t.html + (this.facts ? `<div class="tip-sub tip-facts">${this.facts}</div>` : '') + pv, t.kind);
  }

  override activate(): void {
    this.lastKey = '';
    this.previewKey = '';
    this.manual = false;
    // the tool controller switches the auto data view on after activate(): pick its variant first (school tier ...)
    if (this.autoOverlay !== null && this.autoVariant >= 0) this.ctx.preferOverlayVariant?.(this.autoOverlay, this.autoVariant);
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
        this.ctx.tools.select(null, { silent: true });
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
