/**
 * Fire system (daily).
 *  - Random ignition per building: FIRE_BASE_P x risk; risk up with industry (I-D x4, I-M x2.5), density,
 *    abandonment; down with fire coverage ((1 - 0.85 cov)^2); x ordinanceEffect 'fire.risk' (smoke detectors).
 *  - Burning buildings (BF.OnFire) spread to adjacent buildings (FIRE_SPREAD_P, less where covered).
 *  - Dispatch: if the building has fire coverage, the nearest fire station sends a truck (service route for the
 *    vehicle renderer) and puts the fire out after 1-3 days (coverage >= 0.6 / >= 0.35 / otherwise).
 *    Uncovered fires burn FIRE_BURN_DAYS then the building becomes rubble (BF.Burnt).
 *  - Emits buildingChanged on flag flips, 'disaster' {kind:'fire', x, z, active} when a fire starts / ends,
 *    news via sim.notify(..., 'disaster').
 *  Burning state persists in state.systemData.infraFires = [buildingId, daysBurning, putOutDay][].
 */
import { BF, type Building } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { RNG } from '../../core/rng';
import { Fam, centerCell, infoOf, readEffects, buildingList } from './common';
import { FIRE_BASE_P, FIRE_BURN_DAYS, FIRE_SPREAD_P } from './params';
import type { TrafficSystem } from './traffic';

interface FireState {
  days: number;
  /** absolute day the fire brigade puts it out (-1 = uncontrolled) */
  putOut: number;
}

export class FireSystem implements SimSystem {
  readonly name = 'fire';
  readonly fires = new Map<number, FireState>();
  private rng = new RNG(1);
  private lastNews = -1e9;
  /** fires started this month (for advisors) */
  firesThisMonth = 0;
  /** multiplier for random ignitions (disasters temporarily raise it) */
  riskBoost = 1;
  /** ordinance 'fire.effect' (firefighting effectiveness) */
  private fireEffect = 1;

  init(sim: Simulation): void {
    const st = sim.state;
    st.systemData.infraVersion = 1;
    this.rng = new RNG((st.config.seed ^ 0xf12e) + st.day);
    this.fires.clear();
    const saved = st.systemData.infraFires as number[][] | undefined;
    if (Array.isArray(saved)) {
      for (const e of saved) {
        const b = st.buildings.get(e[0]);
        if (b && b.flags & BF.OnFire) this.fires.set(e[0], { days: e[1] ?? 0, putOut: e[2] ?? -1 });
      }
    }
    // buildings flagged OnFire without state (e.g. set by others) join the simulation
    for (const b of buildingList(st)) if (b.flags & BF.OnFire && !this.fires.has(b.id)) this.fires.set(b.id, { days: 0, putOut: -1 });
  }

  monthly(): void {
    this.firesThisMonth = 0;
  }

  daily(sim: Simulation): void {
    const st = sim.state;
    const N = st.size;
    const rng = this.rng;
    // --- random ignition
    const fx = readEffects(st);
    this.fireEffect = fx.fireEffect;
    const base = FIRE_BASE_P * fx.fireRisk * this.riskBoost;
    const fc = st.fireCov;
    // ignition checks are sliced: each day a quarter of the buildings is tested with 4x the daily probability
    const slice = st.day & 3;
    for (let bI = slice, bL = buildingList(st); bI < bL.length; bI += 4) {
      const b = bL[bI];
      if (b.flags & (BF.OnFire | BF.Burnt)) continue;
      if (b.built < 0.3) continue;
      const inf = infoOf(st, b);
      if (inf.isPark) continue;
      let risk = 1;
      if (inf.fam === Fam.I) risk = inf.dev === 9 ? 4 : inf.dev === 10 ? 2.5 : 1.3;
      else if (inf.fam === Fam.R || inf.fam === Fam.C) risk = 1 + Math.min(1.5, (b.pop + b.jobs) / (b.w * b.d * 120));
      if (b.flags & BF.Abandoned) risk *= 3;
      const cov = fc[centerCell(st, b)];
      const k = 1 - 0.85 * Math.min(1, cov);
      const p = 4 * base * risk * k * k * Math.sqrt(b.w * b.d);
      if (rng.next() < p) this.ignite(sim, b);
    }
    // --- burning buildings
    if (this.fires.size === 0) {
      if (this.riskBoost > 1) this.riskBoost = Math.max(1, this.riskBoost * 0.8);
      return;
    }
    const toSpread: Building[] = [];
    for (const [id, f] of this.fires) {
      const b = st.buildings.get(id);
      if (!b) { this.fires.delete(id); continue; }
      f.days++;
      if (f.putOut >= 0 && st.day >= f.putOut) {
        this.fires.delete(id);
        b.flags &= ~BF.OnFire;
        sim.events.emit('buildingChanged', b);
        sim.events.emit('disaster', { kind: 'fire', x: b.x, z: b.z, active: false });
        continue;
      }
      if (f.days >= FIRE_BURN_DAYS) {
        this.fires.delete(id);
        b.flags = (b.flags & ~BF.OnFire) | BF.Burnt;
        sim.events.emit('buildingChanged', b);
        sim.events.emit('disaster', { kind: 'fire', x: b.x, z: b.z, active: false });
        continue;
      }
      toSpread.push(b);
    }
    for (const b of toSpread) {
      // neighbours within 1 cell of the footprint
      for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const id = st.building[z * N + x];
        if (id < 0 || id === b.id) continue;
        const nb = st.buildings.get(id);
        if (!nb || nb.flags & (BF.OnFire | BF.Burnt)) continue;
        const cov = fc[centerCell(st, nb)];
        if (rng.next() < (FIRE_SPREAD_P * (1 - 0.8 * Math.min(1, cov))) / Math.max(1, (b.w + b.d) / 2)) this.ignite(sim, nb, true);
      }
    }
    this.save(sim);
  }

  /** set a building on fire (no-op if already burning / rubble). Returns true if it ignited. */
  ignite(sim: Simulation, b: Building, spread = false): boolean {
    if (b.flags & (BF.OnFire | BF.Burnt)) return false;
    const st = sim.state;
    b.flags |= BF.OnFire;
    const cov = st.fireCov[centerCell(st, b)] * this.fireEffect;
    let putOut = -1;
    if (cov >= 0.15) {
      const days = cov >= 0.6 ? 1 : cov >= 0.35 ? 2 : 3;
      putOut = st.day + days + (this.rng.next() < 0.3 ? 1 : 0);
      this.dispatch(sim, b);
    }
    this.fires.set(b.id, { days: 0, putOut });
    this.firesThisMonth++;
    sim.events.emit('buildingChanged', b);
    sim.events.emit('disaster', { kind: 'fire', x: b.x, z: b.z, active: true });
    if (!spread && st.day - this.lastNews > 5) {
      this.lastNews = st.day;
      sim.notify(putOut >= 0 ? 'Fire reported! Firefighters are on their way.' : 'Fire reported in an area without fire coverage!', 'disaster', b.x, b.z, 'fire');
    }
    this.save(sim);
    return true;
  }

  /** extinguish immediately (e.g. UI / cheats) */
  extinguish(sim: Simulation, b: Building): void {
    if (!(b.flags & BF.OnFire)) return;
    b.flags &= ~BF.OnFire;
    this.fires.delete(b.id);
    sim.events.emit('buildingChanged', b);
    sim.events.emit('disaster', { kind: 'fire', x: b.x, z: b.z, active: false });
    this.save(sim);
  }

  private dispatch(sim: Simulation, b: Building): void {
    const st = sim.state;
    let best: Building | undefined;
    let bd = Infinity;
    for (let sI = 0, sL = buildingList(st); sI < sL.length; sI++) {
      const s = sL[sI];
      const inf = infoOf(st, s);
      if (inf.cov !== 1 || s.built < 1 || s.flags & BF.Burnt) continue;
      const d = Math.abs(s.x - b.x) + Math.abs(s.z - b.z);
      if (d < bd && d <= inf.covRadius * 2.2) { bd = d; best = s; }
    }
    if (!best) return;
    const tr = sim.getSystem<TrafficSystem>('traffic');
    if (!tr) return;
    const path = tr.findPath(sim, centerCell(st, best), centerCell(st, b));
    if (path && path.length >= 2) tr.pushServiceRoute(sim, path, 1, 2);
  }

  private save(sim: Simulation): void {
    const arr: number[][] = [];
    for (const [id, f] of this.fires) arr.push([id, f.days, f.putOut]);
    sim.state.systemData.infraFires = arr;
  }
}
