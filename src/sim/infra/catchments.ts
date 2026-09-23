/**
 * Catchments & proximity engine (SIM_DEPTH_SPEC WP2). Headless: no DOM / three.js.
 *
 *  - Reach kernels (reachCells): which cells a facility on footprint (bx, bz, bw, bd) reaches and with what falloff
 *    weight (full to 35 % of the reach, smoothstep to 0 at the reach):
 *      walk   — Dial bucket search over road cells with integer quarter-cell costs WALK_COST (Street / Road / OneWay 4,
 *               Avenue 5; highways and rail tracks are impassable, so a highway is a pedestrian barrier). Reach =
 *               radius x ROAD_RADIUS_FACTOR road cells (a 20-tile school ~ a 20 minute walk).
 *      drive  — DRIVE_COST (Street 5, Road / OneWay 4, Avenue 3, Highway 2) + RAMP_COST on highway <-> road moves:
 *               avenues and highways carry a school bus / ambulance farther than streets.
 *      euclid — a disk (marinas, golf courses, transit stops).
 *    Seeds are the road cells around the footprint; every reached road cell splats its 3x3 neighbourhood (land cells
 *    next to the road); the CATCH_NEAR_FIELD cells around the footprint are always reached. Bridges / tunnels pass,
 *    unbridged water blocks. The circular 8-bucket queue makes a search O(cells reached).
 *  - Tier engine (run by the services system, services.ts): facilities of a need tier share one demand field. Each
 *    cell's need (pupils, patient-equivalents, visitors: from the residents' cohort shares) is split among the
 *    facilities reaching it in proportion to their reach x strength; a facility serves r = op x min(1, capacity /
 *    demand) of its share, so seats are conserved (served <= capacity, two schools next to each other each count half
 *    the children) and a crowded school visibly teaches everyone less. Police / fire are capacity-free tiers
 *    (legacy 1 - (1-a)(1-b) combination); WP7 can plug capacities / need rasters in via registerTierProvider.
 *  - Access fields (accessCommute, shopAccess) and NIMBY / YIMBY rasters (nimby.ts) are services steps too.
 * Public API for the inspector (WP5), the bot (WP6) and facilities (WP7): tierLayer, facilityLoad, unservedClusters,
 * reachCells, registerTierProvider.
 */
import type { Building, CityState, NeedTier } from '../CityState';
import type { Simulation } from '../Simulation';
import type { ReachMetric, ServiceTier } from '../catalogTypes';
import { Network } from '../../core/types';
import { CATCH_NEAR_FIELD, DRIVE_COST, RAMP_COST, ROAD_RADIUS_FACTOR, WALK_COST } from './params';
import { REACH_METRICS, SERVICE_TIERS } from './common';
import type { ServicesSystem } from './services';

export { REACH_METRICS, SERVICE_TIERS };

/** need tier served by each service tier */
export const TIER_NEED: Readonly<Record<ServiceTier, NeedTier>> = {
  elementary: 'elementary', high: 'high', college: 'college', library: 'college', clinic: 'health', hospital: 'health',
  play: 'play', green: 'green', police: 'police', fire: 'fire',
};

/** processing order of the need tiers in a services pass (index = need-tier slot of the engine) */
export const NEED_ORDER: readonly NeedTier[] = ['police', 'fire', 'elementary', 'high', 'college', 'health', 'play', 'green'];

/** coverage layer of a need tier */
export function tierLayer(st: CityState, tier: NeedTier): Float32Array {
  switch (tier) {
    case 'elementary': return st.eduElemCov;
    case 'high': return st.eduHighCov;
    case 'college': return st.eduCollegeCov;
    case 'health': return st.healthCov;
    case 'play': return st.playCov;
    case 'green': return st.greenCov;
    case 'police': return st.policeCov;
    case 'fire': return st.fireCov;
  }
}

export interface FacilityLoad {
  tier: ServiceTier;
  needTier: NeedTier;
  /** seats / patient-equivalents / visitors (Infinity for capacity-free tiers) */
  capacity: number;
  /** competition-weighted demand reaching the facility */
  demand: number;
  /** demand / (capacity x operating) */
  utilization: number;
  served: number;
  /** operating factor 0..1+ (funding x ordinance x power x water x staffing) */
  operating: number;
  powered: boolean;
  /** reach radius (cells) and metric */
  radius: number;
  metric: ReachMetric;
}

/** load of a service building (WP5 inspector, WP6 bot); null when the building is not a (processed) tier facility */
export function facilityLoad(sim: Simulation, buildingId: number): FacilityLoad | null {
  const s = sim.getSystem<ServicesSystem>('services');
  return s && typeof s.facilityLoadOf === 'function' ? s.facilityLoadOf(sim.state, buildingId) : null;
}

/** where most people lack a tier: coarse 8x8 blocks, sum need x (1 - cov) where cov < 0.3, top `max` (largest first) */
export function unservedClusters(sim: Simulation, tier: NeedTier, max = 5): { x: number; z: number; people: number }[] {
  const s = sim.getSystem<ServicesSystem>('services');
  return s && typeof s.clustersOf === 'function' ? s.clustersOf(tier, max) : [];
}

/**
 * Pluggable tier data (WP2-1): WP7 registers police capacities / a crime-weighted need raster here (from
 * facilities.ts tables) without touching the services logic. Defaults: need = residents per cell, capacity =
 * DefInfo.tierCap, capacity-free union combination.
 */
export interface TierProvider {
  /** fill `out` (cells) with the tier's need; `res` = residents per cell */
  needOf?(st: CityState, res: Float32Array, out: Float32Array): void;
  /** capacity of a facility in tier units (Infinity = capacity-free) */
  capacityOf?(st: CityState, b: Building): number;
  /** true: share capacity across the catchment like schools (conserving); false: legacy union of coverages */
  shared?: boolean;
}
const providers = new Map<NeedTier, TierProvider>();
export function registerTierProvider(tier: NeedTier, p: TierProvider | null): void {
  if (p) providers.set(tier, p);
  else providers.delete(tier);
}
export function tierProvider(tier: NeedTier): TierProvider | undefined {
  return providers.get(tier);
}

// ================================================================================================ reach kernels
/** reach output: cell indices and falloff weights 0..1 (capacity >= cells reached; grown as needed) */
export interface ReachScratch {
  idx: Int32Array;
  w: Float32Array;
}
export function newReachScratch(cells: number): ReachScratch {
  return { idx: new Int32Array(cells), w: new Float32Array(cells) };
}

/** full strength up to 35 % of R, smoothstep drop to 0 at R */
export function falloff(d: number, R: number): number {
  const a = 0.35 * R;
  if (d <= a) return 1;
  if (d >= R) return 0;
  const t = (d - a) / (R - a);
  return 1 - t * t * (3 - 2 * t);
}

const HW = Network.Highway, STREET = Network.Street;

/** reusable search state (typed arrays sized to the map; module-level: the sim is single-threaded) */
class ReachEngine {
  C = 0;
  stamp = 0;
  visit = new Int32Array(0);
  best = new Float32Array(0);
  dstamp = new Int32Array(0);
  dist = new Int32Array(0);
  touched = new Int32Array(0);
  head = new Int32Array(8);
  enode = new Int32Array(4096);
  enext = new Int32Array(4096);
  en = 0;
  fall = new Float32Array(1024);

  ensure(C: number): void {
    if (this.C === C) return;
    this.C = C;
    this.visit = new Int32Array(C);
    this.best = new Float32Array(C);
    this.dstamp = new Int32Array(C);
    this.dist = new Int32Array(C);
    this.touched = new Int32Array(C);
    this.stamp = 0;
  }
  nextStamp(): number {
    if (this.stamp >= 0x7ffffff0) { this.stamp = 0; this.visit.fill(0); this.dstamp.fill(0); }
    return ++this.stamp;
  }
  push(slot: number, v: number): void {
    const e = this.en++;
    if (e >= this.enode.length) {
      const c = this.enode.length * 2;
      const a = new Int32Array(c); a.set(this.enode); this.enode = a;
      const b = new Int32Array(c); b.set(this.enext); this.enext = b;
    }
    this.enode[e] = v;
    this.enext[e] = this.head[slot];
    this.head[slot] = e;
  }
}
const eng = new ReachEngine();

/** metric name -> index (0 walk, 1 drive, 2 euclid) */
export function metricIndex(m: ReachMetric): number {
  return m === 'walk' ? 0 : m === 'drive' ? 1 : 2;
}

/**
 * INTERNAL (services): reach from a footprint; results in reachResult().touched[0..n) with weights
 * reachResult().best[cell]. Valid until the next reach call. metric: 0 walk, 1 drive, 2 euclid.
 */
export function reachRaw(st: CityState, bx: number, bz: number, bw: number, bd: number, radius: number, metric: number): number {
  eng.ensure(st.cells);
  if (!(radius > 0)) return 0;
  return metric === 2 ? reachEuclid(st, bx, bz, bw, bd, radius) : reachRoad(st, bx, bz, bw, bd, radius, metric);
}
export function reachResult(): { touched: Int32Array; best: Float32Array } {
  return { touched: eng.touched, best: eng.best };
}

/**
 * cells reached from a footprint (bx, bz, bw, bd) within `radius` (cells; walk / drive radii are multiplied by
 * ROAD_RADIUS_FACTOR inside) by `metric`; fills scratch.idx / scratch.w (grown if too small), returns the count.
 */
export function reachCells(st: CityState, bx: number, bz: number, bw: number, bd: number, radius: number, metric: ReachMetric, scratch: ReachScratch): number {
  const n = reachRaw(st, bx, bz, bw, bd, radius, metricIndex(metric));
  if (scratch.idx.length < n) { scratch.idx = new Int32Array(n); scratch.w = new Float32Array(n); }
  const t = eng.touched, b = eng.best, idx = scratch.idx, w = scratch.w;
  for (let k = 0; k < n; k++) { const i = t[k]; idx[k] = i; w[k] = b[i]; }
  return n;
}

function reachEuclid(st: CityState, bx: number, bz: number, bw: number, bd: number, R: number): number {
  const N = st.size;
  const stamp = eng.nextStamp();
  const visit = eng.visit, best = eng.best, touched = eng.touched;
  const cx = bx + bw / 2 - 0.5, cz = bz + bd / 2 - 0.5;
  const half = Math.max(bw, bd) / 2;
  const Rt = R + half;
  const x0 = Math.max(0, Math.floor(cx - Rt)), x1 = Math.min(N - 1, Math.ceil(cx + Rt));
  const z0 = Math.max(0, Math.floor(cz - Rt)), z1 = Math.min(N - 1, Math.ceil(cz + Rt));
  let n = 0;
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const d = Math.max(0, Math.hypot(x - cx, z - cz) - half);
    if (d > R) continue;
    const v = falloff(d, R);
    if (v <= 0) continue;
    const i = z * N + x;
    if (visit[i] !== stamp) { visit[i] = stamp; touched[n++] = i; }
    best[i] = v;
  }
  return n;
}

function reachRoad(st: CityState, bx: number, bz: number, bw: number, bd: number, radius: number, metric: number): number {
  const N = st.size;
  const net = st.network;
  const cost = metric === 0 ? WALK_COST : DRIVE_COST;
  const drive = metric === 1;
  const stamp = eng.nextStamp();
  const visit = eng.visit, best = eng.best, touched = eng.touched, dist = eng.dist, dstamp = eng.dstamp;
  const roadR = radius * ROAD_RADIUS_FACTOR;
  const maxQ = Math.min(8000, Math.ceil(roadR * 4));
  if (eng.fall.length < maxQ + 16) eng.fall = new Float32Array(maxQ + 64);
  const fall = eng.fall;
  for (let q = 0; q <= maxQ + 8; q++) fall[q] = falloff(q / 4, roadR);
  let n = 0;
  // near field: always reached
  const near = Math.min(CATCH_NEAR_FIELD, Math.floor(radius));
  for (let z = Math.max(0, bz - near), z1 = Math.min(N - 1, bz + bd - 1 + near); z <= z1; z++)
    for (let x = Math.max(0, bx - near), x1 = Math.min(N - 1, bx + bw - 1 + near); x <= x1; x++) {
      const i = z * N + x;
      if (visit[i] !== stamp) { visit[i] = stamp; touched[n++] = i; }
      best[i] = 1;
    }
  // seeds: passable road cells around the footprint (corners included)
  const head = eng.head;
  head.fill(-1);
  eng.en = 0;
  let pending = 0;
  for (let z = bz - 1; z <= bz + bd; z++) {
    if (z < 0 || z >= N) continue;
    for (let x = bx - 1; x <= bx + bw; x++) {
      if (x < 0 || x >= N) continue;
      if (x >= bx && x < bx + bw && z >= bz && z < bz + bd) continue;
      const i = z * N + x;
      if (cost[net[i]] === 0 || dstamp[i] === stamp) continue;
      dstamp[i] = stamp;
      dist[i] = 0;
      eng.push(0, i);
      pending++;
    }
  }
  // Dial: edge costs are 2..7 quarter cells, so 8 circular buckets hold every pending label
  for (let cur = 0; pending > 0; cur++) {
    const slot = cur & 7;
    let e = head[slot];
    head[slot] = -1;
    while (e >= 0) {
      const u = eng.enode[e];
      e = eng.enext[e];
      pending--;
      if (dist[u] !== cur) continue; // stale entry (improved later)
      const v = fall[cur];
      const x = u % N, z = (u - x) / N;
      if (v > 0) {
        const v1 = fall[cur + 4];
        const zz0 = z > 0 ? z - 1 : 0, zz1 = z < N - 1 ? z + 1 : N - 1;
        const xx0 = x > 0 ? x - 1 : 0, xx1 = x < N - 1 ? x + 1 : N - 1;
        for (let zz = zz0; zz <= zz1; zz++) {
          const row = zz * N;
          for (let xx = xx0; xx <= xx1; xx++) {
            const j = row + xx;
            const w = j === u ? v : v1;
            if (visit[j] !== stamp) { visit[j] = stamp; best[j] = w; touched[n++] = j; }
            else if (w > best[j]) best[j] = w;
          }
        }
      }
      const tu = net[u];
      const hu = tu === HW;
      for (let k = 0; k < 4; k++) {
        let j: number;
        if (k === 0) { if (x === 0) continue; j = u - 1; }
        else if (k === 1) { if (x === N - 1) continue; j = u + 1; }
        else if (k === 2) { if (z === 0) continue; j = u - N; }
        else { if (z === N - 1) continue; j = u + N; }
        const tj = net[j];
        let c = cost[tj];
        if (c === 0) continue;
        if (drive && hu !== (tj === HW)) {
          if (tu === STREET || tj === STREET) continue; // no ramps between streets and highways
          c += RAMP_COST;
        }
        const nd = cur + c;
        if (nd > maxQ) continue;
        if (dstamp[j] !== stamp || nd < dist[j]) {
          dstamp[j] = stamp;
          dist[j] = nd;
          eng.push(nd & 7, j);
          pending++;
        }
      }
    }
  }
  return n;
}

/**
 * INTERNAL (services shopAccess): multi-source road distance in quarter cells by `metric` (0 walk / 1 drive) from
 * `seeds[0..nSeeds)` (road cells, label 0), up to maxQ. out (cells) = distance or -1 (unreached / not a road cell).
 * Returns the number of settled road cells.
 */
export function roadDistMulti(st: CityState, metric: number, seeds: Int32Array, nSeeds: number, maxQ: number, out: Int32Array): number {
  const N = st.size;
  const net = st.network;
  const cost = metric === 0 ? WALK_COST : DRIVE_COST;
  const drive = metric === 1;
  out.fill(-1);
  const head = eng.head;
  head.fill(-1);
  eng.en = 0;
  let pending = 0;
  for (let s = 0; s < nSeeds; s++) {
    const i = seeds[s];
    if (out[i] === 0 || cost[net[i]] === 0) continue;
    out[i] = 0;
    eng.push(0, i);
    pending++;
  }
  let settled = 0;
  for (let cur = 0; pending > 0; cur++) {
    const slot = cur & 7;
    let e = head[slot];
    head[slot] = -1;
    while (e >= 0) {
      const u = eng.enode[e];
      e = eng.enext[e];
      pending--;
      if (out[u] !== cur) continue;
      settled++;
      const x = u % N, z = (u - x) / N;
      const tu = net[u];
      const hu = tu === HW;
      for (let k = 0; k < 4; k++) {
        let j: number;
        if (k === 0) { if (x === 0) continue; j = u - 1; }
        else if (k === 1) { if (x === N - 1) continue; j = u + 1; }
        else if (k === 2) { if (z === 0) continue; j = u - N; }
        else { if (z === N - 1) continue; j = u + N; }
        const tj = net[j];
        let c = cost[tj];
        if (c === 0) continue;
        if (drive && hu !== (tj === HW)) {
          if (tu === STREET || tj === STREET) continue;
          c += RAMP_COST;
        }
        const nd = cur + c;
        if (nd > maxQ) continue;
        const oj = out[j];
        if (oj < 0 || nd < oj) {
          out[j] = nd;
          eng.push(nd & 7, j);
          pending++;
        }
      }
    }
  }
  return settled;
}

/** quantum (minutes) of roadTimeMulti labels */
export const TIME_Q = 0.005;
let lhead = new Int32Array(0);
/**
 * INTERNAL (services accessCommute): multi-source free-flow travel time over road cells (Street .. Highway; NET_TIME
 * minutes per entered cell + RAMP_PENALTY on highway <-> road moves; no street <-> highway ramps). `out` (cells) holds
 * the seed labels on input (TIME_Q units, -1 = no seed) and the settled labels on output (-1 = unreached).
 * `limitQ` bounds the labels (linear Dial bucket queue, exact: integer edge costs >= 1).
 */
export function roadTimeMulti(st: CityState, out: Int32Array, limitQ: number, netTimeQ: readonly number[], rampQ: number): number {
  const N = st.size, C = st.cells;
  const net = st.network;
  eng.ensure(C);
  const nb = limitQ + 1;
  if (lhead.length < nb) lhead = new Int32Array(nb + 1024);
  const head = lhead;
  head.fill(-1, 0, nb);
  eng.en = 0;
  let pending = 0;
  for (let i = 0; i < C; i++) {
    const l = out[i];
    if (l < 0) continue;
    if (l > limitQ || netTimeQ[net[i]] === 0) { out[i] = -1; continue; }
    const e = eng.en++;
    if (e >= eng.enode.length) grow();
    eng.enode[e] = i; eng.enext[e] = head[l]; head[l] = e;
    pending++;
  }
  function grow(): void {
    const c = eng.enode.length * 2;
    const a = new Int32Array(c); a.set(eng.enode); eng.enode = a;
    const b = new Int32Array(c); b.set(eng.enext); eng.enext = b;
  }
  let settled = 0;
  for (let cur = 0; cur < nb && pending > 0; cur++) {
    let e = head[cur];
    head[cur] = -1;
    while (e >= 0) {
      const u = eng.enode[e];
      e = eng.enext[e];
      pending--;
      if (out[u] !== cur) continue;
      settled++;
      const x = u % N, z = (u - x) / N;
      const tu = net[u];
      const hu = tu === HW;
      for (let k = 0; k < 4; k++) {
        let j: number;
        if (k === 0) { if (x === 0) continue; j = u - 1; }
        else if (k === 1) { if (x === N - 1) continue; j = u + 1; }
        else if (k === 2) { if (z === 0) continue; j = u - N; }
        else { if (z === N - 1) continue; j = u + N; }
        const tj = net[j];
        let c = netTimeQ[tj];
        if (c === 0) continue;
        if (hu !== (tj === HW)) {
          if (tu === STREET || tj === STREET) continue;
          c += rampQ;
        }
        const nd = cur + c;
        if (nd > limitQ) continue;
        const oj = out[j];
        if (oj < 0 || nd < oj) {
          out[j] = nd;
          const en = eng.en++;
          if (en >= eng.enode.length) grow();
          eng.enode[en] = j; eng.enext[en] = head[nd]; head[nd] = en;
          pending++;
        }
      }
    }
  }
  return settled;
}
