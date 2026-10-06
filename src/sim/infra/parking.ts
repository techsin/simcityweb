/**
 * Parking pressure (WP7-7, owner WP7b): st.parking 0..1 (derived; written by traffic every 2nd assignment and in its
 * warm cycle, emits layerUpdated('parking')). Headless: no DOM / three.js.
 *
 *  demand D   cars arriving per day on the footprint of every job site: car commuters (local + regional) + PARKING_SHOP_W
 *             x car shopping trips (traffic fills it with addFootprint)
 *  supply S   per cell: zoned land by density (PARKING_SUPPLY_ZONE C / I, PARKING_SUPPLY_R R: surface lots, driveways),
 *             plopped civic lots PARKING_SUPPLY_CIVIC, road cells PARKING_SUPPLY_ROAD (street parking) + every parking
 *             garage's free spaces (GARAGE_SPACES minus the cars its commuters park there; none without a road beside
 *             it) spread over GARAGE_WALK_RADIUS with a normalised kernel (1 - d / (R + 1), sums to the spaces). A park
 *             & ride garage keeps for the block around it what the block lacks (garageArea: demand minus supply over
 *             its walk area — traffic's reserve; local parkers first, park & ride gets the rest)
 *  parking    smoothstep(PARKING_RATIO[0], PARKING_RATIO[1], box(D) / box(S)); box = (2 PARKING_BOX_R + 1)^2 mean, so
 *             a block borrows spaces from its neighbours but a dense core runs out; blended with the previous raster
 *             (traffic passes it, PARKING_BLEND) so one noisy assignment does not flip a block.
 * Effects (readers): car commuters to a site pay PARKING_MIN x parking extra minutes (traffic); WP6a desirability
 * PARKING terms; the Parking overlay (WP5) and the inspector (roadCellReport / facility report of garages).
 */
import { Network, Zone, zoneDensity, zoneFamily } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { boxH, boxV } from './blur';
import {
  GARAGE_WALK_RADIUS, PARKING_BOX_R, PARKING_RATIO, PARKING_SUPPLY_CIVIC, PARKING_SUPPLY_R, PARKING_SUPPLY_ROAD,
  PARKING_SUPPLY_ZONE,
} from './params';

/** add `amount` spread uniformly over a building footprint into `out` */
export function addFootprint(N: number, b: Pick<Building, 'x' | 'z' | 'w' | 'd'>, amount: number, out: Float32Array): void {
  if (!(amount > 0)) return;
  const x0 = Math.max(0, b.x), z0 = Math.max(0, b.z), x1 = Math.min(N, b.x + b.w), z1 = Math.min(N, b.z + b.d);
  const area = (x1 - x0) * (z1 - z0);
  if (area <= 0) return;
  const v = amount / area;
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) out[z * N + x] += v;
}

/** normalised garage kernel weights (1 - d / (R + 1) inside radius R), cached per radius */
const kernels = new Map<number, { dx: Int8Array; dz: Int8Array; w: Float32Array }>();
function kernel(R: number): { dx: Int8Array; dz: Int8Array; w: Float32Array } {
  let k = kernels.get(R);
  if (k) return k;
  const dx: number[] = [], dz: number[] = [], w: number[] = [];
  let sum = 0;
  for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
    const d = Math.hypot(x, z);
    if (d > R + 0.5) continue;
    const v = 1 - d / (R + 1);
    dx.push(x); dz.push(z); w.push(v);
    sum += v;
  }
  k = { dx: Int8Array.from(dx), dz: Int8Array.from(dz), w: Float32Array.from(w.map((v) => v / sum)) };
  kernels.set(R, k);
  return k;
}

/** spread `spaces` around a footprint centre (normalised kernel of radius GARAGE_WALK_RADIUS + half footprint) */
export function addGarageSupply(N: number, b: Pick<Building, 'x' | 'z' | 'w' | 'd'>, spaces: number, out: Float32Array): void {
  if (!(spaces > 0)) return;
  const R = GARAGE_WALK_RADIUS + (Math.max(b.w, b.d) >> 1);
  const k = kernel(R);
  const cx = b.x + (b.w >> 1), cz = b.z + (b.d >> 1);
  // cells off the map lose their share (garages at the edge serve less)
  for (let q = 0; q < k.w.length; q++) {
    const x = cx + k.dx[q], z = cz + k.dz[q];
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    out[z * N + x] += spaces * k.w[q];
  }
}

/**
 * a garage's walk area (the disk its spaces spread over, see addGarageSupply): demand d and supply s summed over it and
 * the share of its kernel on the map (mass: its own spaces there = spaces x mass)
 */
export function garageArea(N: number, b: Pick<Building, 'x' | 'z' | 'w' | 'd'>, D: Float32Array, S: Float32Array): { d: number; s: number; mass: number } {
  const R = GARAGE_WALK_RADIUS + (Math.max(b.w, b.d) >> 1);
  const k = kernel(R);
  const cx = b.x + (b.w >> 1), cz = b.z + (b.d >> 1);
  let d = 0, s = 0, mass = 0;
  for (let q = 0; q < k.w.length; q++) {
    const x = cx + k.dx[q], z = cz + k.dz[q];
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    const i = z * N + x;
    d += D[i]; s += S[i]; mass += k.w[q];
  }
  return { d, s, mass };
}

/** parking pressure of a demand / supply ratio (the raster's smoothstep, PARKING_RATIO) */
export function pressureOf(d: number, s: number): number {
  return !(d > 1e-6) ? 0 : s > 1e-6 ? sstep(PARKING_RATIO[0], PARKING_RATIO[1], d / s) : 1;
}

/** supply per cell by Zone value (lookup: no per-cell function calls) */
const ZONE_SUPPLY = (() => {
  const a = new Float32Array(16);
  for (let z = 1; z <= 10; z++) {
    const fam = zoneFamily(z as Zone), dens = zoneDensity(z as Zone);
    a[z] = fam === 'C' || fam === 'I' ? PARKING_SUPPLY_ZONE[dens - 1] ?? 0 : fam === 'R' ? PARKING_SUPPLY_R[dens - 1] ?? 0 : 0;
  }
  return a;
})();
const ROAD_SUPPLY = Float32Array.from({ length: 16 }, (_, t) => PARKING_SUPPLY_ROAD[t] ?? 0);

/** base supply (zones, civic lots, streets) into `out` (overwritten) */
export function baseSupply(st: CityState, out: Float32Array): void {
  const C = st.cells, zone = st.zone, net = st.network, bld = st.building;
  const ZS = ZONE_SUPPLY, RS = ROAD_SUPPLY, civic = PARKING_SUPPLY_CIVIC;
  for (let i = 0; i < C; i++) {
    const t = net[i];
    if (t !== Network.None) { out[i] = RS[t]; continue; }
    const z = zone[i];
    // unzoned lot with a building = plopped civic lot (plopping clears the zone)
    out[i] = z !== 0 ? ZS[z] : bld[i] >= 0 ? civic : 0;
  }
}

/** smoothstep */
function sstep(a: number, b: number, x: number): number {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

export interface ParkingSummary {
  /** job-weighted mean pressure over demand cells (weights = demand) */
  demandWeighted: number;
  /** cells with demand > 0 and pressure > 0.6 / cells with demand > 0 */
  highShare: number;
  /** total supply (cars / day) and demand */
  supply: number;
  demand: number;
}

/**
 * parking = smoothstep(r0, r1, box(D) / box(S)) into `out` (0 where there is no demand nearby); with `prev` (the
 * previous raster, not aliasing `out`) out = blend x prev + (1 - blend) x fresh. `tmpA` / `tmpB` are scratch rasters of
 * st.cells. D and S are left unchanged. The summary describes the (blended) result.
 */
export function computeParking(N: number, D: Float32Array, S: Float32Array, out: Float32Array, tmpA: Float32Array, tmpB: Float32Array,
  prev: Float32Array | null = null, blend = 0): ParkingSummary {
  const C = N * N, R = PARKING_BOX_R;
  boxH(D, tmpA, N, R);
  boxV(tmpA, out, N, R); // out = box(D)
  boxH(S, tmpA, N, R);
  boxV(tmpA, tmpB, N, R); // tmpB = box(S)
  const r0 = PARKING_RATIO[0], r1 = PARKING_RATIO[1];
  const bl = prev && prev.length === C ? Math.max(0, Math.min(1, blend)) : 0;
  let wSum = 0, pSum = 0, dCells = 0, high = 0, sTot = 0, dTot = 0;
  for (let i = 0; i < C; i++) {
    const d = out[i];
    sTot += S[i];
    const di = D[i];
    dTot += di;
    const s = tmpB[i];
    let p = !(d > 1e-6) ? 0 : s > 1e-6 ? sstep(r0, r1, d / s) : 1;
    if (bl > 0) p = bl * prev![i] + (1 - bl) * p;
    out[i] = p;
    if (di > 0) {
      wSum += di; pSum += di * p; dCells++;
      if (p > 0.6) high++;
    }
  }
  return { demandWeighted: wSum > 0 ? pSum / wSum : 0, highShare: dCells > 0 ? high / dCells : 0, supply: sTot, demand: dTot };
}

/** mean parking pressure over a footprint */
export function parkingOver(st: CityState, b: Pick<Building, 'x' | 'z' | 'w' | 'd'>): number {
  const N = st.size, p = st.parking;
  let s = 0, n = 0;
  for (let z = Math.max(0, b.z); z < Math.min(N, b.z + b.d); z++) for (let x = Math.max(0, b.x); x < Math.min(N, b.x + b.w); x++) { s += p[z * N + x]; n++; }
  return n > 0 ? s / n : 0;
}
