/**
 * Disasters: tornado (moving funnel destroying buildings along its path), earthquake (random damage + fires around
 * the epicentre), meteor strike (crater: lowers terrain, removes buildings / roads in the core, fires around),
 * and plain fires. Random disasters happen only when state.config.disasters is true (monthly chance, city > 2k pop);
 * triggerDisaster() always works (UI disaster menu / sandbox).
 *
 * Events: 'disaster' {kind, x, z, active} — tornado re-emits while moving (x,z = current funnel cell, fractional
 * position via DisastersSystem.active[]), earthquake / meteor emit active:true then active:false after a few days.
 * News via sim.notify(..., 'disaster', x, z). Destroyed buildings get BF.Burnt (rubble; sim-core decides regrowth)
 * + buildingChanged; buildings inside a meteor crater are removed (buildingRemoved).
 * Emergency aftermath (WP8, emergency.ts): earthquake-destroyed buildings with occupants become 'collapse' rescue
 * incidents (max EQ_COLLAPSE_MAX), tornado-destroyed homes / workplaces 'medical' calls along the path (max
 * TORNADO_MEDICAL_MAX), a meteor strike METEOR_MEDICAL 'medical' calls around the crater; fires started here are
 * fire incidents (fire.ts -> emergency.onFire).
 * Persistent (systemData.infraDisasters, final fixes routed 45): the random stream and the disasters under way (a tornado
 * on its path, a quake's / meteor's active days, a tornado's medical calls), so a loaded game rolls the same disasters
 * and the same tornado path as the uninterrupted one (it used to re-seed from seed + day and drop them).
 * Final fixes SF-2 (silent ruins): a tornado counts what it destroys (ActiveDisaster.destroyed / facilities / worst,
 * persisted; no random draws) and posts ONE summary when it ends — how many buildings, the city facilities among them
 * ("incl. your Fire Station and Elementary School") and the fix, at the worst spot; the earthquake and meteor summaries
 * name the destroyed city facilities too. Final fixes r3: every plopped kind counts — after the services (FACILITY_RANK)
 * the deals, landmarks, civic buildings, transport and parks by what they bring in (defRank; bus stops last), so the
 * three kinds a summary names are the most urgent ones and the rest read "… and N more" (text only: no random draws).
 */
import { RNG } from '../../core/rng';
import { BF, type Building } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { computeWater } from '../terrainGen';
import { nowMs, removeBuilding } from './common';
import { getDef } from '../catalog';
import type { BuildingDef } from '../catalogTypes';
import { ATTRACTIONS } from '../economy/tourism';
import { TOURISM_INCOME_PER_VISITOR } from '../economy/tuning';
import type { FireSystem } from './fire';
import { emergencyOf } from './emergency';

export type DisasterKind = 'fire' | 'tornado' | 'earthquake' | 'meteor';

export interface ActiveDisaster {
  kind: DisasterKind;
  /** current position (cells, fractional for the tornado) */
  x: number;
  z: number;
  /** remaining lifetime in sim days */
  daysLeft: number;
  /** tornado heading (radians) */
  heading: number;
  /** earthquake magnitude / meteor radius */
  magnitude: number;
  /** tornado: medical incidents spawned along its path so far (aftermath cap TORNADO_MEDICAL_MAX) */
  calls?: number;
  /** tornado (final fixes SF-2, its summary at the end): buildings destroyed so far, the def ids of the city facilities
   *  among them (defRank: every plopped kind, final fixes r3) and the worst spot — the most important facility (a service
   *  first), else the fullest building: [x, z, weight] */
  destroyed?: number;
  facilities?: string[];
  worst?: [number, number, number];
}

/** systemData.infraDisasters */
interface DisastersSave {
  v: number;
  /** the random stream (RNG state) */
  rng: number;
  /** the disasters under way */
  active: ActiveDisaster[];
}

const TORNADO_CELLS_PER_DAY = 10;
const TORNADO_DAYS = 4;
const TORNADO_RADIUS = 1.2;
/** emergency aftermath (WP8): rescue / medical incidents spawned per disaster */
const EQ_COLLAPSE_MAX = 12;
const TORNADO_MEDICAL_MAX = 6;
const METEOR_MEDICAL = 3;

/** city services a disaster summary names first (final fixes SF-2), by category: the lower, the more urgent to rebuild —
 *  their loss leaves fires and patients unanswered, homes dark or dry, pupils without seats */
const FACILITY_RANK: Readonly<Partial<Record<string, number>>> = { fire: 0, police: 1, health: 2, power: 3, water: 4, education: 5, garbage: 6 };
/** every other plopped kind a summary names after the services (final fixes r3: the Missile Test Range, landmarks, civic
 *  buildings, venues, parks and a Bus Stop flattened by a quake went unnamed) */
const OTHER_RANKED: ReadonlySet<string> = new Set(['reward', 'landmark', 'civic', 'transport', 'park']);
/**
 * what a plopped building brings in a month (§; final fixes r3, the order of the non-service ruins — the advisors' ruins
 * card leads with the same one, economy/advisors.ts ruinValue): its income (deal / venue, catalog), its tourists'
 * spending at the reference draw (TOURISM_INCOME_PER_VISITOR a visitor a day) and a hundredth of what it costs to build
 */
function facilityValue(def: BuildingDef): number {
  const a = ATTRACTIONS[def.id] ?? ATTRACTIONS[def.model];
  return (def.income ?? 0) + (a ? a.draw * TOURISM_INCOME_PER_VISITOR : 0) + (def.cost ?? 0) / 100;
}
/** the rank of a def in a disaster summary: the services 0-6 (FACILITY_RANK), then every other plopped kind by what it
 *  brings in (7 + 1 / (1 + value): the most valuable first), bus stops last (8); -1: not a city facility it names */
function defRank(def: BuildingDef | undefined): number {
  if (!def || def.hidden) return -1;
  const r = FACILITY_RANK[def.category];
  if (r !== undefined) return r;
  if (!OTHER_RANKED.has(def.category)) return -1;
  if (def.id === 'tr_bus_stop' || def.model === 'tr_bus_stop') return 8;
  return 7 + 1 / (1 + facilityValue(def));
}
/** the rank of a destroyed building in a disaster summary (-1: not a city facility it names) */
function facilityRank(b: Building): number {
  return defRank(getDef(b.def));
}
/** a summary's facility def ids, the most urgent first (services by FACILITY_RANK, then the most valuable; ties in the
 *  order destroyed): facilityListText names the first 3 kinds */
function byRank(defIds: readonly string[]): string[] {
  return defIds.map((id, k) => ({ id, k, r: defRank(getDef(id)) })).sort((a, c) => a.r - c.r || a.k - c.k).map((o) => o.id);
}
/** "your Fire Station, Police Station and 2 Elementary Schools" (def ids in the given order; at most 3 kinds named, the
 *  buildings of the rest counted: "… and 4 more") */
export function facilityListText(defIds: readonly string[]): string {
  const n = new Map<string, number>();
  for (const id of defIds) n.set(id, (n.get(id) ?? 0) + 1);
  const parts: string[] = [];
  let more = 0;
  for (const [id, k] of n) {
    if (n.size > 3 && parts.length >= 3) { more += k; continue; }
    const name = getDef(id)?.name ?? 'city facility';
    parts.push(k > 1 ? `${k} ${name.endsWith('s') ? name : name + 's'}` : name);
  }
  const shown = more ? [...parts, `${more} more`] : parts;
  return `your ${shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0]}`;
}

export class DisastersSystem implements SimSystem {
  readonly name = 'disasters';
  readonly active: ActiveDisaster[] = [];
  private rng = new RNG(1);
  private lastFrameMs = -1e9;
  private lastEmitCell = new Map<ActiveDisaster, number>();
  /** the persisted record (systemData.infraDisasters; its `active` is this.active) */
  private save: DisastersSave = { v: 1, rng: 1, active: this.active };

  init(sim: Simulation): void {
    const st = sim.state;
    st.systemData.infraVersion = 1;
    this.rng = new RNG((st.config.seed ^ 0xd15a) + st.day);
    this.active.length = 0;
    this.lastEmitCell.clear();
    // a save's random stream and disasters under way (a save from before has none: the stream starts from seed + day)
    const saved = st.systemData.infraDisasters as Partial<DisastersSave> | undefined;
    if (saved && typeof saved === 'object') {
      if (typeof saved.rng === 'number' && Number.isInteger(saved.rng) && saved.rng >= 0 && saved.rng < 4294967296) this.rng.state = saved.rng;
      if (Array.isArray(saved.active)) {
        for (const d of saved.active as Partial<ActiveDisaster>[]) {
          if (!d || (d.kind !== 'tornado' && d.kind !== 'earthquake' && d.kind !== 'meteor')) continue;
          const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
          const a: ActiveDisaster = { kind: d.kind, x: num(d.x, 0), z: num(d.z, 0), daysLeft: num(d.daysLeft, 0), heading: num(d.heading, 0), magnitude: num(d.magnitude, 1) };
          if (d.kind === 'tornado') {
            a.calls = num(d.calls, 0);
            // (SF-2: a save from before the summary has no tally: it counts from the load)
            a.destroyed = num(d.destroyed, 0);
            a.facilities = Array.isArray(d.facilities) ? d.facilities.filter((f): f is string => typeof f === 'string') : [];
            const w = d.worst;
            if (Array.isArray(w) && w.length === 3 && w.every((v) => typeof v === 'number' && Number.isFinite(v))) a.worst = [w[0], w[1], w[2]];
          }
          if (a.daysLeft > 0 && st.inBounds(Math.floor(a.x), Math.floor(a.z))) this.active.push(a);
        }
      }
    }
    this.save = { v: 1, rng: this.rng.state, active: this.active };
    st.systemData.infraDisasters = this.save;
  }

  /** the random stream into the persisted record (after every method that may draw from it) */
  private persist(): void {
    this.save.rng = this.rng.state;
  }

  monthly(sim: Simulation): void {
    const st = sim.state;
    if (!st.config.disasters || st.stats.population < 2000) return;
    const r = this.rng.next();
    const N = st.size;
    const x = this.rng.int(8, N - 9), z = this.rng.int(8, N - 9);
    if (r < 0.008) this.trigger(sim, 'tornado', x, z);
    else if (r < 0.012) this.trigger(sim, 'earthquake', x, z);
    else if (r < 0.0145) this.trigger(sim, 'meteor', x, z);
    this.persist();
  }

  daily(sim: Simulation): void {
    const framesActive = nowMs() - this.lastFrameMs < 750;
    for (let k = this.active.length - 1; k >= 0; k--) {
      const d = this.active[k];
      if (d.kind === 'tornado') {
        if (!framesActive) this.advanceTornado(sim, d, 1);
      } else {
        d.daysLeft -= 1;
        if (d.daysLeft <= 0) this.end(sim, k);
      }
    }
    this.persist();
  }

  frame(sim: Simulation, dt: number): void {
    this.lastFrameMs = nowMs();
    if (this.active.length === 0 || sim.speed === 0) return;
    // real seconds per day at the current speed (includes the WP8 LIVE slow-down at 1x)
    const days = Math.min(0.25, dt) / sim.secondsPerDay();
    for (let k = this.active.length - 1; k >= 0; k--) {
      const d = this.active[k];
      if (d.kind === 'tornado') this.advanceTornado(sim, d, days);
    }
    this.persist();
  }

  trigger(sim: Simulation, kind: DisasterKind, x: number, z: number): boolean {
    const ok = this.start(sim, kind, x, z);
    this.persist();
    return ok;
  }

  private start(sim: Simulation, kind: DisasterKind, x: number, z: number): boolean {
    const st = sim.state;
    if (!st.inBounds(Math.floor(x), Math.floor(z))) return false;
    x = Math.floor(x);
    z = Math.floor(z);
    switch (kind) {
      case 'fire': return this.startFire(sim, x, z);
      case 'tornado': {
        const d: ActiveDisaster = { kind, x: x + 0.5, z: z + 0.5, daysLeft: TORNADO_DAYS, heading: this.rng.range(0, Math.PI * 2), magnitude: 1, calls: 0, destroyed: 0, facilities: [] };
        this.active.push(d);
        sim.notify('Tornado sighted! Take cover!', 'disaster', x, z, 'disaster');
        sim.events.emit('disaster', { kind, x, z, active: true });
        return true;
      }
      case 'earthquake': {
        const mag = this.rng.range(5.8, 7.8);
        this.earthquake(sim, x, z, mag);
        const d: ActiveDisaster = { kind, x, z, daysLeft: 2, heading: 0, magnitude: mag };
        this.active.push(d);
        return true;
      }
      case 'meteor': {
        this.meteor(sim, x, z);
        this.active.push({ kind, x, z, daysLeft: 2, heading: 0, magnitude: 3 });
        return true;
      }
    }
    return false;
  }

  /** WP8 aftermath incident at a building (no-op without the emergency system); returns the incident id or -1 */
  private spawnIncident(sim: Simulation, kind: 'collapse' | 'medical', b: Building, major?: boolean): number {
    const em = emergencyOf(sim);
    if (!em || !em.active) return -1;
    const occ = b.pop + b.jobs;
    const opts = kind === 'medical' ? { buildingId: b.id, major: major ?? occ >= 40, severity: major || occ >= 40 ? this.rng.int(2, 6) : 1 } : { buildingId: b.id, major: true };
    return em.spawn(sim, kind, b.x, b.z, opts);
  }

  private fireSys(sim: Simulation): FireSystem | undefined {
    return sim.getSystem<FireSystem>('fire');
  }

  private startFire(sim: Simulation, x: number, z: number): boolean {
    const st = sim.state;
    const fire = this.fireSys(sim);
    if (!fire) return false;
    for (let r = 0; r <= 3; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const b = st.buildingAt(x + dx, z + dz);
        if (b && fire.ignite(sim, b)) return true;
      }
    }
    return false;
  }

  /** turn a building into rubble; false when it already was */
  private destroy(sim: Simulation, b: Building): boolean {
    if (b.flags & BF.Burnt) return false;
    b.flags = (b.flags & ~BF.OnFire) | BF.Burnt;
    this.fireSys(sim)?.fires.delete(b.id);
    sim.events.emit('buildingChanged', b);
    return true;
  }

  /** a tornado's tally of a building it destroys (SF-2; read before the flag flip, no random draws) */
  private tally(d: ActiveDisaster, b: Building): void {
    d.destroyed = (d.destroyed ?? 0) + 1;
    const rank = facilityRank(b);
    if (rank >= 0) (d.facilities ??= []).push(b.def);
    const w = rank >= 0 ? 1e9 - rank : b.pop + b.jobs;
    if (!d.worst || w > d.worst[2]) d.worst = [b.x + (b.w >> 1), b.z + (b.d >> 1), w];
  }

  private advanceTornado(sim: Simulation, d: ActiveDisaster, days: number): void {
    const st = sim.state;
    const N = st.size;
    let dist = days * TORNADO_CELLS_PER_DAY;
    d.daysLeft -= days;
    while (dist > 0) {
      const step = Math.min(0.5, dist);
      dist -= step;
      d.heading += this.rng.range(-0.25, 0.25);
      d.x += Math.cos(d.heading) * step;
      d.z += Math.sin(d.heading) * step;
      if (d.x < 1 || d.z < 1 || d.x > N - 1 || d.z > N - 1) { d.daysLeft = 0; break; }
      // damage
      const r = TORNADO_RADIUS;
      for (let z = Math.floor(d.z - r); z <= Math.floor(d.z + r); z++) for (let x = Math.floor(d.x - r); x <= Math.floor(d.x + r); x++) {
        if (!st.inBounds(x, z)) continue;
        if (Math.hypot(x + 0.5 - d.x, z + 0.5 - d.z) > r) continue;
        const b = st.buildingAt(x, z);
        if (b && !(b.flags & BF.Burnt) && this.rng.next() < 0.6) {
          const occupied = b.pop + b.jobs > 0;
          this.tally(d, b);
          this.destroy(sim, b);
          // WP8: people hurt in destroyed homes / workplaces call for ambulances along the path
          const calls = d.calls ?? 0;
          if (occupied && calls < TORNADO_MEDICAL_MAX && this.spawnIncident(sim, 'medical', b) >= 0) d.calls = calls + 1;
        }
        if (st.trees[z * N + x] > 0) st.trees[z * N + x] = Math.max(0, st.trees[z * N + x] - 2);
      }
      const cell = Math.floor(d.z) * N + Math.floor(d.x);
      if (this.lastEmitCell.get(d) !== cell) {
        this.lastEmitCell.set(d, cell);
        sim.events.emit('disaster', { kind: 'tornado', x: d.x, z: d.z, active: true });
      }
    }
    if (d.daysLeft <= 0) {
      const k = this.active.indexOf(d);
      if (k >= 0) this.end(sim, k);
      const r = Math.ceil(TORNADO_DAYS * TORNADO_CELLS_PER_DAY) + 2;
      sim.events.emit('treesChanged', { x0: Math.max(0, Math.floor(d.x) - r), z0: Math.max(0, Math.floor(d.z) - r), x1: Math.min(N, Math.floor(d.x) + r), z1: Math.min(N, Math.floor(d.z) + r) });
    }
  }

  private end(sim: Simulation, k: number): void {
    const d = this.active[k];
    this.active.splice(k, 1);
    this.lastEmitCell.delete(d);
    sim.events.emit('disaster', { kind: d.kind, x: d.x, z: d.z, active: false });
    if (d.kind === 'tornado') this.tornadoSummary(sim, d);
  }

  /**
   * the tornado's one summary when it ends (final fixes SF-2: it used to end in silence while the quake and the meteor
   * post one): what it destroyed, the city facilities among them and the fix, at the worst spot (else where it ended)
   */
  private tornadoSummary(sim: Simulation, d: ActiveDisaster): void {
    const st = sim.state;
    const n = d.destroyed ?? 0;
    const fx = Math.max(0, Math.min(st.size - 1, Math.floor(d.x))), fz = Math.max(0, Math.min(st.size - 1, Math.floor(d.z)));
    if (n <= 0) { sim.notify('The tornado has passed — no buildings were destroyed.', 'disaster', fx, fz, 'disaster'); return; }
    const fac = d.facilities ?? [];
    const incl = fac.length ? `, incl. ${facilityListText(byRank(fac))}` : '';
    const [x, z] = d.worst ?? [fx, fz];
    sim.notify(`Tornado: ${n} building${n === 1 ? '' : 's'} destroyed${incl} — bulldoze the rubble and rebuild.`, 'disaster', x, z, 'disaster');
  }

  private earthquake(sim: Simulation, x: number, z: number, mag: number): void {
    const st = sim.state;
    const R = 10 + (mag - 5) * 16;
    const fire = this.fireSys(sim);
    let destroyed = 0, fires = 0, rescues = 0;
    const facilities: string[] = [];
    sim.events.emit('disaster', { kind: 'earthquake', x, z, active: true });
    for (const b of Array.from(st.buildings.values())) {
      const d = Math.hypot(b.x + b.w / 2 - x, b.z + b.d / 2 - z);
      if (d > R) continue;
      const p = 0.55 * (1 - d / R) * ((mag - 4.5) / 3.5);
      if (this.rng.next() >= p) continue;
      const r = this.rng.next();
      if (r < 0.4) {
        const occupied = b.pop + b.jobs > 0 && !(b.flags & BF.Burnt);
        // WP8: people trapped in collapsed occupied buildings -> rescue incident (fire + medical), before the flag flip
        if (occupied && rescues < EQ_COLLAPSE_MAX && this.spawnIncident(sim, 'collapse', b) >= 0) rescues++;
        // (SF-2: the summary names the city facilities it destroyed)
        if (!(b.flags & BF.Burnt) && facilityRank(b) >= 0) facilities.push(b.def);
        this.destroy(sim, b);
        destroyed++;
      }
      else if (r < 0.65 && fire) { if (fire.ignite(sim, b, true)) fires++; }
    }
    if (fire) fire.riskBoost = Math.max(fire.riskBoost, 3);
    const incl = facilities.length ? ` (incl. ${facilityListText(byRank(facilities))})` : '';
    sim.notify(`Earthquake! Magnitude ${mag.toFixed(1)}: ${destroyed} buildings destroyed${incl}, ${fires} fires${rescues ? `, people trapped in ${rescues}` : ''}.`, 'disaster', x, z, 'disaster');
  }

  private meteor(sim: Simulation, x: number, z: number): void {
    const st = sim.state;
    const N = st.size;
    const craterR = 3, destroyR = 5, fireR = 8, depth = 9;
    sim.events.emit('disaster', { kind: 'meteor', x, z, active: true });
    // terrain crater (corner heights)
    const N1 = N + 1;
    for (let cz = z - craterR - 1; cz <= z + craterR + 2; cz++) for (let cx = x - craterR - 1; cx <= x + craterR + 2; cx++) {
      if (cx < 0 || cz < 0 || cx > N || cz > N) continue;
      const d = Math.hypot(cx - (x + 0.5), cz - (z + 0.5)) / (craterR + 0.5);
      if (d >= 1.3) continue;
      const h = d < 1 ? -depth * (1 - d * d) : depth * 0.25 * (1 - (d - 1) / 0.3); // rim
      st.heights[cz * N1 + cx] += h;
    }
    const rect = { x0: Math.max(0, x - craterR - 2), z0: Math.max(0, z - craterR - 2), x1: Math.min(N, x + craterR + 3), z1: Math.min(N, z + craterR + 3) };
    computeWater(st, rect.x0, rect.z0, rect.x1, rect.z1);
    // remove networks / lines / trees in the core
    let netHit = false, lineHit = false;
    for (let zz = rect.z0; zz < rect.z1; zz++) for (let xx = rect.x0; xx < rect.x1; xx++) {
      const d = Math.hypot(xx + 0.5 - (x + 0.5), zz + 0.5 - (z + 0.5));
      if (d > craterR - 0.5) continue;
      const i = zz * N + xx;
      if (st.network[i]) { st.network[i] = 0; st.netFlags[i] = 0; netHit = true; }
      if (st.powerLines[i]) { st.powerLines[i] = 0; lineHit = true; }
      st.trees[i] = 0;
    }
    // buildings
    const fire = this.fireSys(sim);
    let destroyed = 0;
    const facilities: string[] = [];
    const injured: { b: Building; d: number }[] = [];
    for (const b of Array.from(st.buildings.values())) {
      const d = Math.hypot(b.x + b.w / 2 - (x + 0.5), b.z + b.d / 2 - (z + 0.5)) - Math.max(b.w, b.d) / 2;
      // (SF-2: the summary names the city facilities it destroyed — standing ones, not rubble it buries)
      if (d <= destroyR && !(b.flags & BF.Burnt) && facilityRank(b) >= 0) facilities.push(b.def);
      if (d <= craterR) { removeBuilding(sim, b); destroyed++; }
      else if (d <= destroyR) { this.destroy(sim, b); destroyed++; }
      else if (d <= fireR && fire && this.rng.next() < 0.35) fire.ignite(sim, b, true);
      if (d > craterR && d <= fireR + 4 && b.pop > 0) injured.push({ b, d });
    }
    // WP8: the nearest inhabited buildings around the crater call for ambulances
    injured.sort((a, c) => a.d - c.d || a.b.id - c.b.id);
    for (let k = 0, n = 0; k < injured.length && n < METEOR_MEDICAL; k++) if (this.spawnIncident(sim, 'medical', injured[k].b, true) >= 0) n++;
    sim.events.emit('terrainChanged', rect);
    sim.events.emit('treesChanged', rect);
    if (netHit) sim.events.emit('networkChanged', rect);
    if (lineHit) sim.events.emit('powerLinesChanged', rect);
    sim.notify(`Meteor strike! ${destroyed} buildings destroyed${facilities.length ? `, incl. ${facilityListText(byRank(facilities))}` : ''}.`, 'disaster', x, z, 'disaster');
  }
}

/**
 * Trigger a disaster at cell (x, z). Works regardless of state.config.disasters (that flag only controls random
 * disasters). Returns false if the disaster could not start (e.g. 'fire' with no building nearby).
 */
export function triggerDisaster(sim: Simulation, kind: DisasterKind, x: number, z: number): boolean {
  const sys = sim.getSystem<DisastersSystem>('disasters');
  if (!sys) return false;
  return sys.trigger(sim, kind, x, z);
}

/** currently active disasters (tornado position is fractional cells) */
export function activeDisasters(sim: Simulation): readonly ActiveDisaster[] {
  return sim.getSystem<DisastersSystem>('disasters')?.active ?? [];
}
