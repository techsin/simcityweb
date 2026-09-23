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
 *  - EQ (0..150) follows 25 + 125 x (population-weighted education coverage) as a first-order lag with time constant
 *    EQ_TAU_YEARS (~10 years: schools shape a generation); HQ (0..150) follows (30 + 120 x health coverage) x
 *    (1 - 0.35 x air pollution) with HQ_TAU_YEARS (~4 years).
 *  SCHEDULING (InfraScheduler): a pass every SERVICES_PERIOD days (within SERVICES_DIRTY_DAYS after a service
 *  building / road change): prep (resident grid, station lists) -> stations processed in bounded steps
 *  (WORK_PER_STEP cell touches, accumulated in a scratch layer, copied when a kind completes) -> finish (transit stops,
 *  uniform footprints, EQ / HQ). Emits layerUpdated('services').
 */
import type { Building, CityState } from '../CityState';
import type { ServiceKind } from '../catalogTypes';
import type { SimSystem, Simulation } from '../Simulation';
import { COV_KINDS, Fam, fundingFactor, infoOf, isFunctional, nowMs, readEffects, buildingList, type OrdEffects } from './common';
import { COVERAGE_DEMAND, EQ_TAU_YEARS, HQ_TAU_YEARS, ROAD_RADIUS_FACTOR } from './params';
import { schedulerOf, sizeFactors } from './scheduler';
import { collectStops, computeTransitCoverage, type StopList } from './transit';
import { getDef } from '../catalog';

export const SERVICES_PERIOD = 8;
/** a new / removed service building or road change is reflected within this many days */
export const SERVICES_DIRTY_DAYS = 2;
/** estimated cell touches processed per scheduler step (bounds step cost) */
const WORK_PER_STEP = 350000;
const KIND_SERVICE: Record<string, ServiceKind> = {
  police: 'police', fire: 'fire', health: 'health', education: 'education', park: 'parks', transit: 'transit', garbage: 'utilities',
};
const STEP_PREP = 0, STEP_FINISH = 7;

export class ServicesSystem implements SimSystem {
  readonly name = 'services';
  private stamp = 0;
  private visit = new Int32Array(0);
  private best = new Float32Array(0);
  private dstamp = new Int32Array(0);
  private dist = new Uint16Array(0);
  private queue = new Int32Array(0);
  private touched = new Int32Array(0);
  private resCell = new Float32Array(0);
  private tmpLayer = new Float32Array(0);
  private scratch = new Float32Array(0);
  private fall = new Float32Array(512);
  private stops: StopList | undefined;
  private lastRun = -1e9;
  private lastEqDay = 0;
  lastMs = 0;

  // pass state: -1 idle, 0 prep, 1..6 kinds (police, fire, health, education, park, transit), 7 finish
  private stepIdx = -1;
  private firstPass = false;
  private cursor = 0;
  private stations: Building[][] = [[], [], [], [], [], []];
  private policeMul = 1;
  private fx: OrdEffects | null = null;

  private dirty = false;
  private unsub: (() => void)[] = [];

  init(sim: Simulation): void {
    for (const u of this.unsub) u();
    // a new / removed service building or road change shows its coverage within SERVICES_DIRTY_DAYS
    const markB = (b: { def: string }) => { const d = getDef(b.def); if (d && (d.coverage || d.category === 'park' || d.category === 'transport')) this.dirty = true; };
    this.unsub = [sim.events.on('buildingAdded', markB), sim.events.on('buildingRemoved', markB), sim.events.on('networkChanged', () => { this.dirty = true; })];
    sim.state.systemData.infraVersion = 1;
    this.lastRun = -1e9;
    this.lastEqDay = sim.state.day;
    this.stepIdx = -1;
    this.compute(sim, true);
    const self = this;
    schedulerOf(sim).register({
      name: 'services',
      due: (s) => self.due(s),
      urgent: () => false,
      cost: (s) => self.stepCost(s),
      step: (s) => self.step(s),
    });
  }

  daily(sim: Simulation): void {
    schedulerOf(sim).tickDay(sim);
  }

  frame(sim: Simulation, _dt: number): void {
    schedulerOf(sim).tickFrame(sim, this);
  }

  private due(sim: Simulation): boolean {
    if (this.stepIdx >= 0) return true;
    const d = sim.state.day - this.lastRun;
    return d >= SERVICES_PERIOD || (this.dirty && d >= SERVICES_DIRTY_DAYS);
  }

  private stepCost(sim: Simulation): number {
    const { cells, bld } = sizeFactors(sim);
    if (this.stepIdx <= STEP_PREP) return 0.6 * bld + 0.2 * cells;
    if (this.stepIdx === STEP_FINISH) return 0.8 * bld + 0.5 * cells;
    return 2.0;
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

  /** full synchronous update (init / tests) */
  compute(sim: Simulation, first: boolean): void {
    const t0 = nowMs();
    this.stepIdx = -1;
    this.firstPass = first;
    do this.step(sim); while (this.stepIdx >= 0);
    this.lastMs = nowMs() - t0;
  }

  /** one step of the coverage pass */
  step(sim: Simulation): void {
    const t0 = nowMs();
    if (this.stepIdx < 0) this.stepIdx = STEP_PREP;
    if (this.stepIdx === STEP_PREP) {
      this.prep(sim);
      this.stepIdx = 1;
      this.cursor = 0;
    } else if (this.stepIdx === STEP_FINISH) {
      this.finish(sim, this.firstPass);
      this.stepIdx = -1;
      this.firstPass = false;
    } else {
      this.kindWork(sim);
    }
    this.lastMs = nowMs() - t0;
  }

  private prep(sim: Simulation): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    this.lastRun = st.day;
    this.dirty = false;
    if (this.visit.length !== C) {
      this.visit = new Int32Array(C);
      this.best = new Float32Array(C);
      this.dstamp = new Int32Array(C);
      this.dist = new Uint16Array(C);
      this.queue = new Int32Array(C);
      this.touched = new Int32Array(C);
      this.resCell = new Float32Array(C);
      this.tmpLayer = new Float32Array(C);
      this.scratch = new Float32Array(C);
      this.stamp = 0;
    }
    // residents per cell (for capacity factors) + station lists per kind
    const res = this.resCell;
    res.fill(0);
    let hasJail = false;
    for (const l of this.stations) l.length = 0;
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const inf = infoOf(st, b);
      if (inf.isJail && isFunctional(b)) hasJail = true;
      if (inf.fam === Fam.R) {
        if (b.pop <= 0) continue;
        const per = b.pop / (b.w * b.d);
        for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
          if (x >= 0 && z >= 0 && x < N && z < N) res[z * N + x] += per;
        }
        continue;
      }
      let kind = inf.cov;
      if (kind < 0 && inf.isPark) kind = 4;
      if (kind < 0 || kind > 5 || !isFunctional(b)) continue;
      if (inf.cov >= 0 && (inf.covRadius <= 0 || inf.covStrength <= 0)) continue;
      this.stations[kind].push(b);
    }
    this.policeMul = st.stats.population > 25000 && !hasJail ? 0.75 : 1;
    this.fx = readEffects(st);
  }

  /** process stations of the current kind(s) until the step's work budget is used */
  private kindWork(sim: Simulation): void {
    const st = sim.state;
    const C = st.cells;
    const layers = [st.policeCov, st.fireCov, st.healthCov, st.eduCov, st.parkCov, st.transitCov];
    const scratch = this.scratch;
    const fx = this.fx ?? readEffects(st);
    let work = 0;
    while (this.stepIdx >= 1 && this.stepIdx <= 6 && work < WORK_PER_STEP) {
      const kind = this.stepIdx - 1;
      const list = this.stations[kind];
      if (this.cursor === 0) scratch.fill(0);
      if (this.cursor >= list.length) {
        layers[kind].set(scratch.subarray(0, C));
        this.stepIdx++;
        this.cursor = 0;
        work += C * 0.1;
        continue;
      }
      const b = list[this.cursor++];
      if (!st.buildings.has(b.id)) continue;
      const inf = infoOf(st, b);
      let R = inf.covRadius, strength = inf.covStrength;
      if (inf.cov < 0) { R = 3 + Math.max(b.w, b.d); strength = 0.7; }
      const kindName = COV_KINDS[kind];
      let eff = strength * fundingFactor(st, inf.service ?? KIND_SERVICE[kindName]);
      if (kind === 0) eff *= this.policeMul * fx.policeEffect;
      else if (kind === 2) eff *= fx.healthEffect;
      else if (kind === 3) eff *= fx.eduEffect;
      if (eff <= 0) continue;
      const euclid = kind === 4 || kind === 5;
      const nT = euclid ? this.reachEuclid(st, b.x, b.z, b.w, b.d, R) : this.reachRoad(st, b.x, b.z, b.w, b.d, R);
      work += nT * 3 + 16;
      // capacity factor
      const touched = this.touched, best = this.best;
      if (inf.covCapacity > 0) {
        let demand = 0;
        const ratio = COVERAGE_DEMAND[kindName] ?? 1;
        const res = this.resCell;
        for (let t = 0; t < nT; t++) { const i = touched[t]; demand += res[i] * best[i] * ratio; }
        if (demand > inf.covCapacity) eff *= inf.covCapacity / demand;
      }
      for (let t = 0; t < nT; t++) {
        const i = touched[t];
        let v = best[i] * eff;
        if (v > 1) v = 1;
        scratch[i] = 1 - (1 - scratch[i]) * (1 - v);
      }
    }
  }

  private finish(sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const layers = [st.policeCov, st.fireCov, st.healthCov, st.eduCov, st.parkCov, st.transitCov];
    // transit stops coverage (combined with generic transit coverage)
    this.stops = collectStops(st, this.stops);
    const tmp = this.tmpLayer;
    computeTransitCoverage(st, this.stops, tmp, Math.min(1.25, fundingFactor(st, 'transit')));
    const T = st.transitCov;
    for (let i = 0; i < C; i++) { const t = tmp[i]; if (t > 0) T[i] = 1 - (1 - T[i]) * (1 - Math.min(1, t)); }
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
    // EQ / HQ: slow first-order lag toward the coverage targets (EQ over ~a decade, HQ over a few years)
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
    const dtDays = Math.max(0, st.day - this.lastEqDay);
    this.lastEqDay = st.day;
    if (popSum > 0 && !first && dtDays > 0) {
      edu /= popSum; health /= popSum; air /= popSum;
      const eqT = Math.min(150, 25 + 125 * edu);
      const hqT = Math.min(150, Math.max(0, (30 + 120 * health) * (1 - 0.35 * air)));
      const re = 1 - Math.exp(-dtDays / (EQ_TAU_YEARS * 360));
      const rh = 1 - Math.exp(-dtDays / (HQ_TAU_YEARS * 360));
      stats.eq += (eqT - stats.eq) * re;
      stats.hq += (hqT - stats.hq) * rh;
    }
    sim.events.emit('layerUpdated', 'services');
  }

  /** Euclidean disk reach -> this.touched / this.best; returns count */
  private reachEuclid(st: CityState, bx: number, bz: number, bw: number, bd: number, R: number): number {
    const N = st.size;
    const cx = bx + bw / 2 - 0.5, cz = bz + bd / 2 - 0.5;
    const half = Math.max(bw, bd) / 2;
    const Rt = R + half;
    const x0 = Math.max(0, Math.floor(cx - Rt)), x1 = Math.min(N - 1, Math.ceil(cx + Rt));
    const z0 = Math.max(0, Math.floor(cz - Rt)), z1 = Math.min(N - 1, Math.ceil(cz + Rt));
    let n = 0;
    const best = this.best, touched = this.touched;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const d = Math.max(0, Math.hypot(x - cx, z - cz) - half);
      if (d > R) continue;
      const v = falloff(d, R);
      if (v <= 0) continue;
      const i = z * N + x;
      best[i] = v;
      touched[n++] = i;
    }
    return n;
  }

  /** road-network reach (BFS over road cells) -> this.touched / this.best; returns count */
  private reachRoad(st: CityState, bx: number, bz: number, bw: number, bd: number, R: number): number {
    const N = st.size;
    const net = st.network;
    if (this.stamp >= 0x7ffffff0) { this.stamp = 0; this.visit.fill(0); this.dstamp.fill(0); }
    const stamp = ++this.stamp;
    const visit = this.visit, best = this.best, touched = this.touched, dist = this.dist, dstamp = this.dstamp, queue = this.queue;
    const roadR = R * ROAD_RADIUS_FACTOR;
    const maxD = Math.min(510, Math.ceil(roadR) + 2);
    const fall = this.fall;
    for (let d = 0; d <= maxD; d++) fall[d] = falloff(d, roadR);
    let n = 0;
    // near field (Euclidean, up to 3 cells around the building)
    const near = Math.min(3, R);
    for (let z = Math.max(0, bz - near); z <= Math.min(N - 1, bz + bd - 1 + near); z++)
      for (let x = Math.max(0, bx - near); x <= Math.min(N - 1, bx + bw - 1 + near); x++) {
        const i = z * N + x;
        if (visit[i] !== stamp) { visit[i] = stamp; touched[n++] = i; }
        best[i] = 1;
      }
    // BFS seeds: road cells around the footprint
    let qh = 0, qt = 0;
    for (let z = bz - 1; z <= bz + bd; z++) for (let x = bx - 1; x <= bx + bw; x++) {
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      if (x >= bx && x < bx + bw && z >= bz && z < bz + bd) continue;
      const i = z * N + x;
      const t = net[i];
      if (t < 1 || t > 5 || dstamp[i] === stamp) continue;
      dstamp[i] = stamp;
      dist[i] = 0;
      queue[qt++] = i;
    }
    while (qh < qt) {
      const i = queue[qh++];
      const d = dist[i];
      const x = i % N, z = (i - x) / N;
      const v = fall[d];
      if (v > 0) {
        const v1 = fall[d + 1];
        const zz0 = z > 0 ? z - 1 : 0, zz1 = z < N - 1 ? z + 1 : N - 1;
        const xx0 = x > 0 ? x - 1 : 0, xx1 = x < N - 1 ? x + 1 : N - 1;
        for (let zz = zz0; zz <= zz1; zz++) {
          const row = zz * N;
          for (let xx = xx0; xx <= xx1; xx++) {
            const j = row + xx;
            const w = j === i ? v : v1;
            if (visit[j] !== stamp) { visit[j] = stamp; best[j] = w; touched[n++] = j; }
            else if (w > best[j]) best[j] = w;
          }
        }
      }
      if (d + 1 > roadR) continue;
      const d1 = d + 1;
      let j = i - 1;
      if (x > 0 && dstamp[j] !== stamp && net[j] >= 1 && net[j] <= 5) { dstamp[j] = stamp; dist[j] = d1; queue[qt++] = j; }
      j = i + 1;
      if (x < N - 1 && dstamp[j] !== stamp && net[j] >= 1 && net[j] <= 5) { dstamp[j] = stamp; dist[j] = d1; queue[qt++] = j; }
      j = i - N;
      if (z > 0 && dstamp[j] !== stamp && net[j] >= 1 && net[j] <= 5) { dstamp[j] = stamp; dist[j] = d1; queue[qt++] = j; }
      j = i + N;
      if (z < N - 1 && dstamp[j] !== stamp && net[j] >= 1 && net[j] <= 5) { dstamp[j] = stamp; dist[j] = d1; queue[qt++] = j; }
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
