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
 */
import { RNG } from '../../core/rng';
import { BF, type Building } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { computeWater } from '../terrainGen';
import { nowMs, removeBuilding } from './common';
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
}

const TORNADO_CELLS_PER_DAY = 10;
const TORNADO_DAYS = 4;
const TORNADO_RADIUS = 1.2;
/** emergency aftermath (WP8): rescue / medical incidents spawned per disaster */
const EQ_COLLAPSE_MAX = 12;
const TORNADO_MEDICAL_MAX = 6;
const METEOR_MEDICAL = 3;

export class DisastersSystem implements SimSystem {
  readonly name = 'disasters';
  readonly active: ActiveDisaster[] = [];
  private rng = new RNG(1);
  private lastFrameMs = -1e9;
  private lastEmitCell = new Map<ActiveDisaster, number>();
  /** medical incidents spawned per tornado (aftermath cap) */
  private tornadoCalls = new Map<ActiveDisaster, number>();

  init(sim: Simulation): void {
    sim.state.systemData.infraVersion = 1;
    this.rng = new RNG((sim.state.config.seed ^ 0xd15a) + sim.state.day);
    this.active.length = 0;
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
  }

  trigger(sim: Simulation, kind: DisasterKind, x: number, z: number): boolean {
    const st = sim.state;
    if (!st.inBounds(Math.floor(x), Math.floor(z))) return false;
    x = Math.floor(x);
    z = Math.floor(z);
    switch (kind) {
      case 'fire': return this.startFire(sim, x, z);
      case 'tornado': {
        const d: ActiveDisaster = { kind, x: x + 0.5, z: z + 0.5, daysLeft: TORNADO_DAYS, heading: this.rng.range(0, Math.PI * 2), magnitude: 1 };
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

  private destroy(sim: Simulation, b: Building): void {
    if (b.flags & BF.Burnt) return;
    b.flags = (b.flags & ~BF.OnFire) | BF.Burnt;
    this.fireSys(sim)?.fires.delete(b.id);
    sim.events.emit('buildingChanged', b);
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
          this.destroy(sim, b);
          // WP8: people hurt in destroyed homes / workplaces call for ambulances along the path
          const calls = this.tornadoCalls.get(d) ?? 0;
          if (occupied && calls < TORNADO_MEDICAL_MAX && this.spawnIncident(sim, 'medical', b) >= 0) this.tornadoCalls.set(d, calls + 1);
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
    this.tornadoCalls.delete(d);
    sim.events.emit('disaster', { kind: d.kind, x: d.x, z: d.z, active: false });
  }

  private earthquake(sim: Simulation, x: number, z: number, mag: number): void {
    const st = sim.state;
    const R = 10 + (mag - 5) * 16;
    const fire = this.fireSys(sim);
    let destroyed = 0, fires = 0, rescues = 0;
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
        this.destroy(sim, b);
        destroyed++;
      }
      else if (r < 0.65 && fire) { if (fire.ignite(sim, b, true)) fires++; }
    }
    if (fire) fire.riskBoost = Math.max(fire.riskBoost, 3);
    sim.notify(`Earthquake! Magnitude ${mag.toFixed(1)}: ${destroyed} buildings destroyed, ${fires} fires${rescues ? `, people trapped in ${rescues}` : ''}.`, 'disaster', x, z, 'disaster');
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
    const injured: { b: Building; d: number }[] = [];
    for (const b of Array.from(st.buildings.values())) {
      const d = Math.hypot(b.x + b.w / 2 - (x + 0.5), b.z + b.d / 2 - (z + 0.5)) - Math.max(b.w, b.d) / 2;
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
    sim.notify(`Meteor strike! ${destroyed} buildings destroyed.`, 'disaster', x, z, 'disaster');
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
