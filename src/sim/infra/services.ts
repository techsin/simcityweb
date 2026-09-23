/**
 * Services system: coverage layers (0..1) policeCov / fireCov / healthCov / eduCov / parkCov / transitCov.
 *
 *  - Buildings with def.coverage {kind, radius, strength, capacity}. Police / fire / health / education use ROAD
 *    NETWORK distance (BFS over road cells from the building's frontage, radius * ROAD_RADIUS_FACTOR, splat to the
 *    3x3 cells around every reached road cell) + a small Euclidean near field; so rivers without bridges block
 *    coverage. Parks / transit use Euclidean disks.
 *  - Falloff: full strength up to 35 % of the radius, smooth drop to 0 at the radius.
 *  - Effectiveness = strength x funding (state.budget.funding[def.service] / 100, diminishing returns above 100 %)
 *    x capacity factor (def.coverage.capacity = residents served; e.g. a school for 10,000 residents with
 *    30,000 residents in its area is ~33 % effective) x ordinanceEffect 'police.effect' / 'health.effect' /
 *    'edu.effect'.
 *  - Overlapping stations combine as 1 - (1-a)(1-b). Large buildings get uniform coverage (max over footprint).
 *  - Police effectiveness x0.75 above 25k population without a jail.
 *  - Transit coverage: def.coverage of stops / depots (catalog) + walking radius around road-cell bus stops
 *    (netFlags bit 4) and stops without a coverage def (bus 5, subway 7, train 8 cells) x transit funding.
 *  - EQ (0..150) drifts slowly toward 25 + 125 x (population-weighted education coverage);
 *    HQ (0..150) toward (30 + 120 x health coverage) x (1 - 0.35 x air pollution).
 *  Emits layerUpdated('services').
 */
import { Network, isRoad } from '../../core/types';
import type { CityState } from '../CityState';
import type { ServiceKind } from '../catalogTypes';
import type { SimSystem, Simulation } from '../Simulation';
import { COV_KINDS, DX, DZ, Fam, fundingFactor, infoOf, isFunctional, nowMs, readEffects, buildingList } from './common';
import { COVERAGE_DEMAND, EQ_RATE, HQ_RATE, ROAD_RADIUS_FACTOR } from './params';
import { collectStops, computeTransitCoverage, type StopList } from './transit';
import { getDef } from '../catalog';

export const SERVICES_PERIOD = 8;
const KIND_SERVICE: Record<string, ServiceKind> = {
  police: 'police', fire: 'fire', health: 'health', education: 'education', park: 'parks', transit: 'transit', garbage: 'utilities',
};

export class ServicesSystem implements SimSystem {
  readonly name = 'services';
  private stamp = 0;
  private visit = new Int32Array(0);
  private best = new Float32Array(0);
  private dist = new Int32Array(0);
  private queue = new Int32Array(0);
  private touched = new Int32Array(0);
  private resCell = new Float32Array(0);
  private tmpLayer = new Float32Array(0);
  private stops: StopList | undefined;
  private lastRun = -1e9;
  lastMs = 0;

  private dirty = false;
  private unsub: (() => void)[] = [];

  init(sim: Simulation): void {
    for (const u of this.unsub) u();
    // a new / removed service building or road change shows its coverage on the next day
    const markB = (b: { def: string }) => { const d = getDef(b.def); if (d && (d.coverage || d.category === 'park')) this.dirty = true; };
    this.unsub = [sim.events.on('buildingAdded', markB), sim.events.on('buildingRemoved', markB), sim.events.on('networkChanged', () => { this.dirty = true; })];
    sim.state.systemData.infraVersion = 1;
    this.lastRun = -1e9;
    this.compute(sim, true);
  }

  daily(sim: Simulation): void {
    const d = sim.state.day;
    if (this.dirty || d % SERVICES_PERIOD === 3 || d - this.lastRun > SERVICES_PERIOD * 2) this.compute(sim, false);
  }

  /** coverage layer for a CoverageKind name */
  layerOf(st: CityState, kind: string): Float32Array | null {
    switch (kind) {
      case 'police': return st.policeCov;
      case 'fire': return st.fireCov;
      case 'health': return st.healthCov;
      case 'education': return st.eduCov;
      case 'park': return st.parkCov;
      case 'transit': return st.transitCov;
      default: return null;
    }
  }

  compute(sim: Simulation, first: boolean): void {
    const t0 = nowMs();
    const st = sim.state;
    const N = st.size, C = st.cells;
    this.lastRun = st.day;
    this.dirty = false;
    if (this.visit.length !== C) {
      this.visit = new Int32Array(C);
      this.best = new Float32Array(C);
      this.dist = new Int32Array(C);
      this.queue = new Int32Array(C);
      this.touched = new Int32Array(C);
      this.resCell = new Float32Array(C);
      this.tmpLayer = new Float32Array(C);
    }
    // residents per cell (for capacity factors)
    const res = this.resCell;
    res.fill(0);
    let hasJail = false;
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const inf = infoOf(st, b);
      if (inf.isJail && isFunctional(b)) hasJail = true;
      if (inf.fam !== Fam.R || b.pop <= 0) continue;
      const per = b.pop / (b.w * b.d);
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x >= 0 && z >= 0 && x < N && z < N) res[z * N + x] += per;
      }
    }
    const layers = [st.policeCov, st.fireCov, st.healthCov, st.eduCov, st.parkCov, st.transitCov];
    for (const L of layers) L.fill(0);
    const policeMul = st.stats.population > 25000 && !hasJail ? 0.75 : 1;
    const fx = readEffects(st);
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const inf = infoOf(st, b);
      let kind = inf.cov;
      let R = inf.covRadius, strength = inf.covStrength;
      if (kind < 0 && inf.isPark) { kind = 4; R = 3 + Math.max(b.w, b.d); strength = 0.7; }
      if (kind < 0 || kind > 5 || R <= 0 || strength <= 0) continue;
      if (!isFunctional(b)) continue;
      const kindName = COV_KINDS[kind];
      let eff = strength * fundingFactor(st, inf.service ?? KIND_SERVICE[kindName]);
      if (kind === 0) eff *= policeMul;
      if (kind === 0) eff *= fx.policeEffect;
      else if (kind === 2) eff *= fx.healthEffect;
      else if (kind === 3) eff *= fx.eduEffect;
      if (eff <= 0) continue;
      const L = layers[kind];
      const euclid = kind === 4 || kind === 5;
      const nT = euclid ? this.reachEuclid(st, b.x, b.z, b.w, b.d, R) : this.reachRoad(st, b.x, b.z, b.w, b.d, R);
      // capacity factor
      if (inf.covCapacity > 0) {
        let demand = 0;
        const ratio = COVERAGE_DEMAND[kindName] ?? 1;
        for (let t = 0; t < nT; t++) { const i = this.touched[t]; demand += res[i] * this.best[i] * ratio; }
        if (demand > inf.covCapacity) eff *= inf.covCapacity / demand;
      }
      const touched = this.touched, best = this.best;
      for (let t = 0; t < nT; t++) {
        const i = touched[t];
        let v = best[i] * eff;
        if (v > 1) v = 1;
        L[i] = 1 - (1 - L[i]) * (1 - v);
      }
    }
    // transit stops coverage (combined with generic transit coverage)
    this.stops = collectStops(st, this.stops);
    const tmp = this.tmpLayer;
    computeTransitCoverage(st, this.stops, tmp, Math.min(1.25, fundingFactor(st, 'transit')));
    const T = st.transitCov;
    for (let i = 0; i < C; i++) T[i] = 1 - (1 - T[i]) * (1 - Math.min(1, tmp[i]));
    // uniform coverage over building footprints
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      if (b.w * b.d <= 1) continue;
      for (const L of layers) {
        let m = 0;
        for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) { const v = L[z * N + x]; if (v > m) m = v; }
        for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) L[z * N + x] = m;
      }
    }
    // EQ / HQ
    let popSum = 0, edu = 0, health = 0, air = 0;
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      if (b.pop <= 0) continue;
      const inf = infoOf(st, b);
      if (inf.fam !== Fam.R) continue;
      const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
      popSum += b.pop;
      edu += b.pop * st.eduCov[i];
      health += b.pop * st.healthCov[i];
      air += b.pop * st.airPollution[i];
    }
    const stats = st.stats;
    if (popSum > 0) {
      edu /= popSum; health /= popSum; air /= popSum;
      let eqT = 25 + 125 * edu;
      let hqT = (30 + 120 * health) * (1 - 0.35 * air);
      eqT = Math.min(150, eqT);
      hqT = Math.min(150, Math.max(0, hqT));
      const re = first ? EQ_RATE : EQ_RATE, rh = first ? HQ_RATE : HQ_RATE;
      stats.eq += (eqT - stats.eq) * re;
      stats.hq += (hqT - stats.hq) * rh;
    }
    sim.events.emit('layerUpdated', 'services');
    this.lastMs = nowMs() - t0;
  }

  private resetStamps(): void {
    this.stamp = 0;
    this.visit.fill(0);
    this.dist.fill(-1);
  }

  /** Euclidean disk reach -> this.touched / this.best; returns count */
  private reachEuclid(st: CityState, bx: number, bz: number, bw: number, bd: number, R: number): number {
    const N = st.size;
    if (this.stamp >= 500000) this.resetStamps();
    const stamp = ++this.stamp;
    const cx = bx + bw / 2 - 0.5, cz = bz + bd / 2 - 0.5;
    const half = Math.max(bw, bd) / 2;
    const Rt = R + half;
    const x0 = Math.max(0, Math.floor(cx - Rt)), x1 = Math.min(N - 1, Math.ceil(cx + Rt));
    const z0 = Math.max(0, Math.floor(cz - Rt)), z1 = Math.min(N - 1, Math.ceil(cz + Rt));
    let n = 0;
    const visit = this.visit, best = this.best, touched = this.touched;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const d = Math.max(0, Math.hypot(x - cx, z - cz) - half);
      if (d > R) continue;
      const v = falloff(d, R);
      if (v <= 0) continue;
      const i = z * N + x;
      visit[i] = stamp;
      best[i] = v;
      touched[n++] = i;
    }
    return n;
  }

  /** road-network reach (BFS over road cells) -> this.touched / this.best; returns count */
  private reachRoad(st: CityState, bx: number, bz: number, bw: number, bd: number, R: number): number {
    const N = st.size;
    const net = st.network;
    // distances are encoded as stamp * 4096 + d in an Int32Array: reset before the encoding overflows
    if (this.stamp >= 500000) this.resetStamps();
    const stamp = ++this.stamp;
    const visit = this.visit, best = this.best, touched = this.touched, dist = this.dist, queue = this.queue;
    const roadR = R * ROAD_RADIUS_FACTOR;
    let n = 0;
    const touch = (i: number, v: number) => {
      if (visit[i] !== stamp) { visit[i] = stamp; best[i] = v; touched[n++] = i; }
      else if (v > best[i]) best[i] = v;
    };
    // near field (Euclidean, up to 3 cells around the building)
    const near = Math.min(3, R);
    for (let z = Math.max(0, bz - near); z <= Math.min(N - 1, bz + bd - 1 + near); z++)
      for (let x = Math.max(0, bx - near); x <= Math.min(N - 1, bx + bw - 1 + near); x++) touch(z * N + x, 1);
    // BFS seeds: road cells around the footprint
    let qh = 0, qt = 0;
    for (let z = bz - 1; z <= bz + bd; z++) for (let x = bx - 1; x <= bx + bw; x++) {
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      if (x >= bx && x < bx + bw && z >= bz && z < bz + bd) continue;
      const i = z * N + x;
      if (!isRoad(net[i] as Network)) continue;
      if (dist[i] === stamp * 4096) continue;
      dist[i] = stamp * 4096; // encodes distance 0 for this stamp
      queue[qt++] = i;
    }
    const base = stamp * 4096;
    while (qh < qt) {
      const i = queue[qh++];
      const d = dist[i] - base;
      const x = i % N, z = (i - x) / N;
      const v = falloff(d, roadR);
      if (v > 0) {
        for (let dz = -1; dz <= 1; dz++) {
          const zz = z + dz;
          if (zz < 0 || zz >= N) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= N) continue;
            touch(zz * N + xx, dx === 0 && dz === 0 ? v : falloff(d + 1, roadR));
          }
        }
      }
      if (d + 1 > roadR) continue;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], nz = z + DZ[k];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        const dj = dist[j] - base;
        if (dj >= 0 && dj < 4096) continue;
        if (!isRoad(net[j] as Network)) continue;
        dist[j] = base + d + 1;
        queue[qt++] = j;
      }
    }
    return n;
  }
}

function falloff(d: number, R: number): number {
  const a = 0.35 * R;
  if (d <= a) return 1;
  if (d >= R) return 0;
  const t = (d - a) / (R - a);
  return 1 - t * t * (3 - 2 * t);
}
