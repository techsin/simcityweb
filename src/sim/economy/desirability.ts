/**
 * Desirability per DevType per cell → state.desirability[dev][i] in [-1, 1] (SIM_DEPTH_SPEC WP6: 33 terms).
 * raw = bias + tax / ordinance shift + w_lv·(landValue − lvRef) + Σ w_t·term_t, stored clamped to [-1, 1]:
 *  0-16 (phase 0)  land value, air, water, garbage (the lot's uncollected pile × garbageFade), crime, noise, commute
 *                  (city-relative ramp, WP2 accessCommute), police, fire, health, edu (legacy combo, unused), park
 *                  (legacy combo: CS$$ / CS$$$), transit, passing traffic, customers nearby (CS: wealth-matched
 *                  coarse residents × CUSTOMER_MIX), freight access (I: traffic's per-building freight access where an
 *                  industry stands, else the coarse freight BFS), slope
 *  17-32 (WP6)     elementary / high school / college, playgrounds, green space, shops, stigma, prestige, campus,
 *                  visitors, skilled workforce (coarse education), trees, contaminated soil, rent (smoothstep of land
 *                  value: the poor are priced out of premium land), wealthy neighbours, parking pressure (WP6-2)
 * Residential weights of elementary / high / college / play / green / health / noise / shops / transit / crime are
 * scaled per zone density by the household mix it brings (COHORT_TERM_MUL: WTZ, precomputed at module load).
 * The band and desirabilityBreakdown share fillRow (the inputs) and the weights: the formula exists once.
 * Time-sliced: zoned / developed cells get the DevTypes of their zone every DESIR_REFRESH_DAYS; unzoned land cells get
 * all DevTypes (reference mix weights) every DESIR_ALL_SWEEPS sweeps (overlay / planning). Roads & water = -1.
 * Perf: rows are filled with the layers hoisted (fillRow); a cell reads only the inputs its zone's DevTypes weigh (NEED_Z)
 * and its zone's DevTypes are summed together (PROGS / runProg); the slope term (updated for terrainChanged rects) and
 * traffic's per-industry freight access (refreshed with the coarse freight BFS) are cached per cell.
 */
import type { SimSystem, Simulation } from '../Simulation';
import type { CityState } from '../CityState';
import type { CellRect } from '../../core/events';
import { BF } from '../CityState';
import { smoothstep } from '../../core/rng';
import { DEV_TYPE_COUNT, DevType, Network, Zone, ZONE_COUNT, zoneDensity } from '../../core/types';
import { DEV_WEALTH, ZONE_DEVTYPES, devFamily } from '../catalog';
import {
  COARSE, COHORT_BASE, COHORT_TERM_MUL, COVERAGE_FALLBACK, CUSTOMER_MIX, DESIR_ALL_SWEEPS, DESIR_REFRESH_DAYS, DESIR_TAX,
  DESIR_WEIGHTS, type DesirWeights, FREIGHT_BLOCKS, FREIGHT_REFRESH_DAYS, PARKING_TERMS, POP_NEAR_FULL, POP_NEAR_FULL_W,
  SLOPE_P0, SLOPE_P1, TAX_NEUTRAL, TAX_SENS, TRAFFIC_BUSY,
} from './tuning';
import { type EconRuntime, type InfraFlags, infraFlags } from './runtime';
import { ordinanceEffect } from './ordinances';
import { lvEffectAt } from './landValue';
import { commuteMinutes, commuteRamp, garbageFade, rentLevel, type CommuteRamp } from './factors';
import { profileShares } from './demographics';
import { facilityUseFactor } from '../infra/facilities';
import type { FactorTerm } from '../explain';

// ------------------------------------------------------------------------------------------------ terms
export const T_LV = 0, T_AIR = 1, T_WATER = 2, T_GARB = 3, T_CRIME = 4, T_NOISE = 5, T_COMMUTE = 6, T_POLICE = 7, T_FIRE = 8,
  T_HEALTH = 9, T_EDU = 10, T_PARK = 11, T_TRANSIT = 12, T_TRAFFIC = 13, T_POP = 14, T_FREIGHT = 15, T_SLOPE = 16,
  T_ELEM = 17, T_HIGH = 18, T_COLLEGE = 19, T_PLAY = 20, T_GREEN = 21, T_SHOPS = 22, T_STIGMA = 23, T_PRESTIGE = 24,
  T_CAMPUS = 25, T_VISITORS = 26, T_SKILL = 27, T_TREES = 28, T_SOIL = 29, T_RENT = 30, T_WEALTHY = 31, T_PARKING = 32;
/** number of desirability terms */
export const NT = 33;
const TERM_KEYS: readonly (keyof DesirWeights)[] = [
  'lv', 'air', 'water', 'garbage', 'crime', 'noise', 'commute', 'police', 'fire', 'health', 'edu', 'park', 'transit', 'traffic',
  'popNear', 'freight', 'slope', 'elem', 'high', 'college', 'play', 'green', 'shops', 'stigma', 'prestige', 'campus', 'visitors',
  'skill', 'trees', 'soil', 'rent', 'wealthy', 'parking',
];
/** FactorTerm ids / labels of the terms (desirabilityBreakdown; WP5 inspector) */
export const DESIR_TERM_IDS: readonly string[] = TERM_KEYS as readonly string[];
export const DESIR_TERM_LABELS: readonly string[] = [
  'Land value', 'Air pollution', 'Water pollution', 'Uncollected garbage', 'Crime', 'Noise', 'Commute', 'Police', 'Fire protection',
  'Health care', 'Schools', 'Parks', 'Transit', 'Passing traffic', 'Customers nearby', 'Freight access', 'Slope',
  'Elementary school', 'High school', 'College', 'Playgrounds', 'Green space', 'Shops nearby', 'Stigma (NIMBY)', 'Prestige',
  'Campus', 'Visitors', 'Skilled workforce', 'Trees', 'Contaminated soil', 'Rent', 'Wealthy neighbours', 'Parking pressure',
];
const DEV_ENUM = ['R1', 'R2', 'R3', 'CS1', 'CS2', 'CS3', 'CO2', 'CO3', 'IA', 'ID', 'IM', 'IHT'];

// ------------------------------------------------------------------------------------------------ weights
/**
 * WTZ[(slot * DEV + dev) * NT + term]: slot 0 = reference cohort mix (unzoned cells), 1..3 = zone density low / medium /
 * high (house / apartment / tower households for R DevTypes; C / I weights are the same in every slot)
 */
const SLOTS = 4;
const WTZ = new Float32Array(SLOTS * DEV_TYPE_COUNT * NT);
const LVREF = new Float32Array(DEV_TYPE_COUNT);
const BIAS = new Float32Array(DEV_TYPE_COUNT);
/** per slot × dev: indices (1..NT-1) of the non-zero weights (the inner loop skips zero terms) */
const NZ: Int8Array[] = [];
{
  const FORM = ['apartment', 'house', 'apartment', 'tower'] as const;
  const cohortTerm: [number, readonly number[]][] = [
    [T_ELEM, COHORT_TERM_MUL.elem], [T_HIGH, COHORT_TERM_MUL.high], [T_COLLEGE, COHORT_TERM_MUL.college],
    [T_PLAY, COHORT_TERM_MUL.play], [T_GREEN, COHORT_TERM_MUL.green], [T_HEALTH, COHORT_TERM_MUL.health],
    [T_NOISE, COHORT_TERM_MUL.noise], [T_SHOPS, COHORT_TERM_MUL.shops], [T_TRANSIT, COHORT_TERM_MUL.transit],
    [T_CRIME, COHORT_TERM_MUL.crime],
  ];
  const s = new Float32Array(5);
  for (let slot = 0; slot < SLOTS; slot++) {
    for (let d = 0; d < DEV_TYPE_COUNT; d++) {
      const w = DESIR_WEIGHTS[d];
      const o = (slot * DEV_TYPE_COUNT + d) * NT;
      for (let t = 0; t < NT; t++) WTZ[o + t] = (w[TERM_KEYS[t]] as number) ?? 0;
      WTZ[o + T_PARKING] *= PARKING_TERMS;
      if (d <= DevType.R3 && slot > 0) {
        profileShares(FORM[slot], DEV_WEALTH[d], s);
        for (const [t, M] of cohortTerm) {
          let num = 0, den = 0;
          for (let c = 0; c < 5; c++) { num += s[c] * M[c]; den += COHORT_BASE[c] * M[c]; }
          WTZ[o + t] *= den > 0 ? num / den : 1;
        }
      }
      const nz: number[] = [];
      for (let t = 1; t < NT; t++) if (WTZ[o + t] !== 0) nz.push(t);
      NZ[slot * DEV_TYPE_COUNT + d] = Int8Array.from(nz);
    }
  }
  for (let d = 0; d < DEV_TYPE_COUNT; d++) { LVREF[d] = DESIR_WEIGHTS[d].lvRef; BIAS[d] = DESIR_WEIGHTS[d].bias; }
}
/** weight slot of a zone: its density (1..3), 0 for unzoned land */
function slotOf(zone: number): number {
  if (zone === Zone.None || zone === Zone.Landfill) return 0;
  const d = zoneDensity(zone as Zone);
  return d >= 1 && d <= 3 ? d : 0;
}
/**
 * inputs the band reads per zone (perf: a cell reads only the layers some DevType of its zone weighs): NEED_Z[zone][t]
 * = 1 when a DevType of the zone has a non-zero weight for term t in the zone's slot; NEED_ALL = every DevType at slot 0
 * (unzoned cells); NEED_FULL = every term (breakdown). Terms a cell skips keep stale values in the term buffer, which
 * devRaw / runProg never read (they read the DevTypes' non-zero terms, a subset of the zone's; a zero customers weight
 * multiplies a stale finite value by 0).
 */
const NEED_Z: Uint8Array[] = [];
const NEED_ALL = new Uint8Array(NT);
const NEED_FULL = new Uint8Array(NT).fill(1);
{
  for (let zn = 0; zn < ZONE_COUNT; zn++) {
    const f = new Uint8Array(NT);
    f[T_LV] = 1;
    const slot = slotOf(zn);
    for (const d of ZONE_DEVTYPES[zn] ?? []) for (const t of NZ[slot * DEV_TYPE_COUNT + d]) f[t] = 1;
    NEED_Z[zn] = f;
  }
  NEED_ALL[T_LV] = 1;
  for (let d = 0; d < DEV_TYPE_COUNT; d++) for (const t of NZ[d]) NEED_ALL[t] = 1;
}
/** effective weight of term t for DevType dev on a lot of zone density slot (tests / UI) */
export function desirWeight(dev: number, t: number, slot = 0): number {
  return WTZ[(slot * DEV_TYPE_COUNT + dev) * NT + t];
}

/** road noise proxy used when the pollution system is absent */
const NET_NOISE = [0, 0.03, 0.08, 0.2, 0.1, 0.45, 0.2];
/** road "customer traffic" proxy used when the traffic system is absent */
const NET_TRAFFIC = [0, 0.2, 0.45, 0.65, 0.45, 0, 0];

// ------------------------------------------------------------------------------------------------ freight access
/** freight source plopped defs (counted only while functional and in use: a freight station without a rail link has a
 *  WP7 use factor of 0) */
const FREIGHT_DEFS = new Set(['tr_freight_station', 'tr_seaport', 'tr_airport_large', 'tr_airport_small']);

/** Freight access per coarse block: BFS over blocks from freight sources (highway, rail, freight station, seaport, edge connection). */
export function computeFreightAccess(st: CityState, rt: EconRuntime): void {
  const N = st.size, cw = rt.cw;
  const dist = new Int16Array(cw * cw).fill(-1);
  const queue: number[] = [];
  const mark = (x: number, z: number) => {
    const b = ((z / COARSE) | 0) * cw + ((x / COARSE) | 0);
    if (dist[b] !== 0) { dist[b] = 0; queue.push(b); }
  };
  for (let i = 0; i < st.cells; i++) {
    const n = st.network[i];
    if (n === Network.Highway || n === Network.Rail) mark(i % N, (i / N) | 0);
  }
  for (const c of st.neighborConnections) mark(c.x, c.z);
  for (const b of rt.plopped) {
    if (!FREIGHT_DEFS.has(b.def) || b.flags & (BF.Burnt | BF.Abandoned)) continue;
    if (!(facilityUseFactor(st, b) > 0)) continue;
    mark(b.x, b.z);
  }
  let h = 0;
  while (h < queue.length) {
    const b = queue[h++];
    const bx = b % cw, bz = (b / cw) | 0;
    const d = dist[b] + 1;
    if (d > FREIGHT_BLOCKS) continue;
    if (bx > 0 && dist[b - 1] < 0) { dist[b - 1] = d; queue.push(b - 1); }
    if (bx < cw - 1 && dist[b + 1] < 0) { dist[b + 1] = d; queue.push(b + 1); }
    if (bz > 0 && dist[b - cw] < 0) { dist[b - cw] = d; queue.push(b - cw); }
    if (bz < cw - 1 && dist[b + cw] < 0) { dist[b + cw] = d; queue.push(b + cw); }
  }
  // road-only cities still get some freight access by road
  const base = st.neighborConnections.length ? 0.25 : 0.1;
  for (let b = 0; b < cw * cw; b++) rt.coarseFreight[b] = dist[b] < 0 ? base : Math.max(base, 1 - dist[b] / (FREIGHT_BLOCKS + 1));
}

// ------------------------------------------------------------------------------------------------ per-runtime caches
/** duck-typed traffic view (per-building freight access of industry, -1 = not assessed) */
interface FreightApi { freightAccess?: (id: number) => number }

/**
 * per-cell inputs the band caches (EconRuntime is read-only in part B): the slope term (terrain; updated for the rects of
 * terrainChanged) and traffic's freight access of the industry standing on each cell (refreshed with the coarse freight
 * BFS: network changes and mid-month; -1 = none / not assessed -> the coarse value)
 */
interface DesExtra { slope: Float32Array; frCell: Float32Array; frBuilt: boolean }
const desExtras = new WeakMap<EconRuntime, DesExtra>();
function desExtraOf(rt: EconRuntime, st: CityState): DesExtra {
  let e = desExtras.get(rt);
  if (!e || e.slope.length !== st.cells) {
    e = { slope: new Float32Array(st.cells), frCell: new Float32Array(st.cells).fill(-1), frBuilt: false };
    desExtras.set(rt, e);
    slopeRect(st, e.slope, 0, 0, st.size, st.size);
  }
  return e;
}
/** slope term of the cells of [x0, x1) × [z0, z1) */
function slopeRect(st: CityState, out: Float32Array, x0: number, z0: number, x1: number, z1: number): void {
  const N = st.size;
  const xa = Math.max(0, x0), xb = Math.min(N, x1), za = Math.max(0, z0), zb = Math.min(N, z1);
  for (let z = za; z < zb; z++) for (let x = xa; x < xb; x++) out[z * N + x] = smoothstep(SLOPE_P0, SLOPE_P1, st.cellSlope(x, z));
}
/** industry freight access per cell from traffic (growable I buildings it has assessed) */
function computeFreightCells(st: CityState, rt: EconRuntime, e: DesExtra): void {
  const out = e.frCell;
  out.fill(-1);
  e.frBuilt = true;
  const tr = infraFlags(st).traffic ? (rt.sim?.getSystem('traffic') as unknown as FreightApi | undefined) : undefined;
  if (!tr || typeof tr.freightAccess !== 'function') return;
  const N = st.size;
  const list = rt.growables;
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    const dv = rt.defOf(b)?.devType;
    if (dv === undefined || dv < DevType.IA) continue;
    const a = tr.freightAccess(b.id);
    if (!(a >= 0)) continue;
    for (let z = Math.max(0, b.z); z < Math.min(N, b.z + b.d); z++) for (let x = Math.max(0, b.x); x < Math.min(N, b.x + b.w); x++) out[z * N + x] = a;
  }
}

// ------------------------------------------------------------------------------------------------ shared term model
/** per-call context of the term model (band: per daily band; breakdown: per query) */
interface TermCtx {
  st: CityState;
  rt: EconRuntime;
  inf: InfraFlags;
  ramp: CommuteRamp;
  /** garbage fade 0..1 */
  gFade: number;
  traffic: FreightApi | undefined;
  /** cached slope term / freight access per cell (band caches; null: computed live) */
  slope: Float32Array | null;
  frCell: Float32Array | null;
  /** per coarse block: customers nearby per CS tier (3 per block) and the wealth-blind value */
  popCSB: Float64Array;
  popAllB: Float64Array;
}

function termCtx(st: CityState, rt: EconRuntime, out?: TermCtx): TermCtx {
  const inf = infraFlags(st);
  const tr = inf.traffic ? (rt.sim?.getSystem('traffic') as unknown as FreightApi | undefined) : undefined;
  const cc = rt.cw * rt.cw;
  const c = out ?? {
    st, rt, inf, ramp: { avg: 0, good: 0, bad: 0 }, gFade: 0, traffic: undefined, slope: null, frCell: null,
    popCSB: new Float64Array(0), popAllB: new Float64Array(0),
  };
  c.st = st; c.rt = rt; c.inf = inf;
  commuteRamp(st, c.ramp);
  c.gFade = garbageFade(st);
  c.traffic = tr && typeof tr.freightAccess === 'function' ? tr : undefined;
  const e = desExtras.get(rt);
  c.slope = e && e.slope.length === st.cells ? e.slope : null;
  c.frCell = e && e.frBuilt && e.frCell.length === st.cells ? e.frCell : null;
  // customers nearby per coarse block: residents of each wealth (coarse, blurred) × who shops at that tier
  if (c.popAllB.length !== cc) { c.popAllB = new Float64Array(cc); c.popCSB = new Float64Array(cc * 3); }
  const popW = rt.coarsePopW[0].length === cc && cc > 0;
  for (let b = 0; b < cc; b++) {
    const all = Math.min(1, rt.coarsePop[b] / POP_NEAR_FULL);
    c.popAllB[b] = all;
    if (popW) {
      const p0 = rt.coarsePopW[0][b], p1 = rt.coarsePopW[1][b], p2 = rt.coarsePopW[2][b];
      for (let k = 0; k < 3; k++) {
        const v = (p0 * CUSTOMER_MIX[0][k] + p1 * CUSTOMER_MIX[1][k] + p2 * CUSTOMER_MIX[2][k]) / POP_NEAR_FULL_W[k];
        c.popCSB[b * 3 + k] = v < 1 ? v : 1;
      }
    } else c.popCSB[b * 3] = c.popCSB[b * 3 + 1] = c.popCSB[b * 3 + 2] = all;
  }
  return c;
}

/** row stride of the term buffer: the NT terms, then customers nearby per CS tier (3) and the wealth-blind value */
const NTX = NT + 4;
const X_POPCS = NT, X_POPALL = NT + 3;

/**
 * Fill the terms of cells xa..xb-1 of row z: TT[(x - xa) * NTX + t] for the terms needs[x - xa] flags (null: cell
 * skipped) — the one formula of the model's inputs, shared by the band (a row at a time, layers hoisted) and the
 * breakdown (one cell, NEED_FULL). T_POP holds the wealth-blind value; devRaw swaps in the CS tier's (X_POPCS).
 */
function fillRow(c: TermCtx, z: number, xa: number, xb: number, TT: Float64Array, needs: readonly (Uint8Array | null)[]): void {
  const st = c.st, rt = c.rt, inf = c.inf, N = st.size;
  const lvL = st.landValue, air = st.airPollution, wat = st.waterPollution, garb = st.garbage, crime = st.crime;
  const noise = st.noise, net = st.network, tv = st.traffic;
  const pol = st.policeCov, fire = st.fireCov, health = st.healthCov, edu = st.eduCov, park = st.parkCov;
  const transit = st.transitCov, elem = st.eduElemCov, high = st.eduHighCov, college = st.eduCollegeCov;
  const play = st.playCov, green = st.greenCov, shops = st.shopAccess;
  const stigma = st.stigma, prestige = st.prestige, campus = st.campus, visitors = st.visitors, trees = st.treeCover;
  const soil = st.soil, parking = st.parking;
  const skill = rt.coarseSkill, wealth = rt.coarseWealth, cFreight = rt.coarseFreight;
  const popAllB = c.popAllB, popCSB = c.popCSB, slope = c.slope, frCell = c.frCell;
  const gFade = c.gFade, rGood = c.ramp.good, rBad = c.ramp.bad, rAvg = c.ramp.avg;
  const hasPoll = inf.pollution, hasTraffic = inf.traffic, hasServices = inf.services;
  const bz = ((z / COARSE) | 0) * rt.cw, row = z * N;
  for (let x = xa; x < xb; x++) {
    const need = needs[x - xa];
    if (!need) continue;
    const i = row + x, o = (x - xa) * NTX;
    const lv = lvL[i];
    TT[o + T_LV] = lv;
    if (need[T_AIR]) TT[o + T_AIR] = air[i];
    if (need[T_WATER]) TT[o + T_WATER] = wat[i];
    if (need[T_GARB]) TT[o + T_GARB] = garb[i] * gFade;
    if (need[T_CRIME]) TT[o + T_CRIME] = crime[i];
    const wNoise = need[T_NOISE] !== 0, wTraffic = need[T_TRAFFIC] !== 0;
    if (wTraffic || (wNoise && !hasPoll)) {
      // neighbour roads: noise proxy / traffic
      let nNoise = 0, nTraffic = 0, trafficVol = 0;
      if (x > 0) { const k = net[i - 1]; if (NET_NOISE[k] > nNoise) nNoise = NET_NOISE[k]; if (NET_TRAFFIC[k] > nTraffic) nTraffic = NET_TRAFFIC[k]; if (tv[i - 1] > trafficVol) trafficVol = tv[i - 1]; }
      if (x < N - 1) { const k = net[i + 1]; if (NET_NOISE[k] > nNoise) nNoise = NET_NOISE[k]; if (NET_TRAFFIC[k] > nTraffic) nTraffic = NET_TRAFFIC[k]; if (tv[i + 1] > trafficVol) trafficVol = tv[i + 1]; }
      if (z > 0) { const k = net[i - N]; if (NET_NOISE[k] > nNoise) nNoise = NET_NOISE[k]; if (NET_TRAFFIC[k] > nTraffic) nTraffic = NET_TRAFFIC[k]; if (tv[i - N] > trafficVol) trafficVol = tv[i - N]; }
      if (z < N - 1) { const k = net[i + N]; if (NET_NOISE[k] > nNoise) nNoise = NET_NOISE[k]; if (NET_TRAFFIC[k] > nTraffic) nTraffic = NET_TRAFFIC[k]; if (tv[i + N] > trafficVol) trafficVol = tv[i + N]; }
      if (wNoise) TT[o + T_NOISE] = hasPoll ? noise[i] : nNoise;
      TT[o + T_TRAFFIC] = hasTraffic ? Math.min(1, trafficVol / TRAFFIC_BUSY) : nTraffic;
    } else if (wNoise) TT[o + T_NOISE] = noise[i];
    if (need[T_COMMUTE]) TT[o + T_COMMUTE] = 0.5 - smoothstep(rGood, rBad, commuteMinutes(st, hasTraffic, i, rAvg));
    if (hasServices) {
      if (need[T_POLICE]) TT[o + T_POLICE] = pol[i];
      if (need[T_FIRE]) TT[o + T_FIRE] = fire[i];
      if (need[T_HEALTH]) TT[o + T_HEALTH] = health[i];
      if (need[T_EDU]) TT[o + T_EDU] = edu[i];
      if (need[T_PARK]) TT[o + T_PARK] = park[i];
      if (need[T_TRANSIT]) TT[o + T_TRANSIT] = transit[i];
      if (need[T_ELEM]) TT[o + T_ELEM] = elem[i];
      if (need[T_HIGH]) TT[o + T_HIGH] = high[i];
      if (need[T_COLLEGE]) TT[o + T_COLLEGE] = college[i];
      if (need[T_PLAY]) TT[o + T_PLAY] = play[i];
      if (need[T_GREEN]) TT[o + T_GREEN] = green[i];
      if (need[T_SHOPS]) TT[o + T_SHOPS] = shops[i];
    } else {
      const f = COVERAGE_FALLBACK;
      const pk = Math.min(1, Math.max(0, lvEffectAt(rt, i)) * 3);
      TT[o + T_POLICE] = TT[o + T_FIRE] = TT[o + T_HEALTH] = TT[o + T_EDU] = f;
      TT[o + T_PARK] = pk;
      TT[o + T_TRANSIT] = 0;
      TT[o + T_ELEM] = TT[o + T_HIGH] = TT[o + T_COLLEGE] = TT[o + T_SHOPS] = f;
      TT[o + T_PLAY] = TT[o + T_GREEN] = pk;
    }
    if (need[T_STIGMA]) TT[o + T_STIGMA] = stigma[i];
    if (need[T_PRESTIGE]) TT[o + T_PRESTIGE] = prestige[i];
    if (need[T_CAMPUS]) TT[o + T_CAMPUS] = campus[i];
    if (need[T_VISITORS]) TT[o + T_VISITORS] = visitors[i];
    if (need[T_TREES]) TT[o + T_TREES] = trees[i];
    if (need[T_SOIL]) TT[o + T_SOIL] = soil[i];
    if (need[T_RENT]) TT[o + T_RENT] = rentLevel(lv);
    if (need[T_PARKING]) TT[o + T_PARKING] = parking[i];
    const blk = bz + ((x / COARSE) | 0);
    if (need[T_POP]) {
      // customers nearby: wealth-blind (T_POP) and per CS tier (wealth-matched coarse residents × CUSTOMER_MIX)
      const b3 = blk * 3, all = popAllB[blk];
      TT[o + T_POP] = all; TT[o + X_POPALL] = all;
      TT[o + X_POPCS] = popCSB[b3]; TT[o + X_POPCS + 1] = popCSB[b3 + 1]; TT[o + X_POPCS + 2] = popCSB[b3 + 2];
    }
    if (need[T_SKILL]) TT[o + T_SKILL] = skill ? skill[blk] : 0;
    if (need[T_WEALTHY]) TT[o + T_WEALTHY] = wealth[blk];
    if (need[T_FREIGHT]) {
      // freight: traffic's measured access for the industry standing here (cached per cell, monthly), else the coarse BFS
      let fr = cFreight[blk];
      if (frCell) { const a = frCell[i]; if (a >= 0) fr = a; }
      else if (c.traffic) {
        const zn = st.zone[i], id = st.building[i];
        if (zn >= Zone.IndAg && zn <= Zone.IndHigh && id >= 0) {
          const b = st.buildings.get(id);
          const dv = b && !(b.flags & BF.Plopped) ? rt.defOf(b)?.devType : undefined;
          if (dv !== undefined && dv >= DevType.IA) { const a = c.traffic.freightAccess!(id); if (a >= 0) fr = a; }
        }
      }
      TT[o + T_FREIGHT] = fr;
    }
    if (need[T_SLOPE]) TT[o + T_SLOPE] = slope ? slope[i] : smoothstep(SLOPE_P0, SLOPE_P1, st.cellSlope(x, z));
  }
}

/** per slot × dev: the non-zero weights in NZ order (f64 copies of WTZ's f32 values) */
const WNZ: Float64Array[] = NZ.map((nz, k) => Float64Array.from(nz, (t) => WTZ[k * NT + t]));

/** raw desirability of DevType d (weights slot `slot`) from the terms at TT[o..] (sets T_POP to the DevType's value) */
function devRaw(TT: Float64Array, o: number, d: number, slot: number, shiftD: number): number {
  const k = slot * DEV_TYPE_COUNT + d;
  TT[o + T_POP] = d >= DevType.CS1 && d <= DevType.CS3 ? TT[o + X_POPCS + d - DevType.CS1] : TT[o + X_POPALL];
  let s = BIAS[d] + shiftD + WTZ[k * NT] * (TT[o + T_LV] - LVREF[d]);
  const nz = NZ[k], w = WNZ[k];
  for (let q = 0; q < nz.length; q++) s += w[q] * TT[o + nz[q]];
  return s;
}

/**
 * Fused DevType programs per zone (band perf): the zone's DevTypes evaluated together — U = the union of their non-zero
 * terms (T_POP excluded), W[q * nd + k] = DevType k's weight for term U[q] (0 when it ignores it: adds exactly 0), and
 * per DevType the customers-nearby weight and input slot (added last). Same sums as devRaw up to the order of the
 * customers term (float rounding).
 */
interface ZoneProg { devs: Int8Array; nd: number; U: Int16Array; W: Float64Array; wLv: Float64Array; lvRef: Float64Array; bias: Float64Array; wPop: Float64Array; popAt: Int16Array }
const PROGS: (ZoneProg | null)[] = [];
for (let zn = 0; zn < ZONE_COUNT; zn++) {
  const devsZ = ZONE_DEVTYPES[zn] ?? [];
  if (!devsZ.length || zn === Zone.Landfill) { PROGS[zn] = null; continue; }
  const slot = slotOf(zn), nd = devsZ.length;
  const uni = new Set<number>();
  for (const d of devsZ) for (const t of NZ[slot * DEV_TYPE_COUNT + d]) if (t !== T_POP) uni.add(t);
  const U = Int16Array.from([...uni].sort((a, b) => a - b));
  const W = new Float64Array(U.length * nd);
  const P: ZoneProg = {
    devs: Int8Array.from(devsZ), nd, U, W, wLv: new Float64Array(nd), lvRef: new Float64Array(nd), bias: new Float64Array(nd),
    wPop: new Float64Array(nd), popAt: new Int16Array(nd),
  };
  devsZ.forEach((d, k) => {
    const o = (slot * DEV_TYPE_COUNT + d) * NT;
    for (let q = 0; q < U.length; q++) W[q * nd + k] = WTZ[o + U[q]];
    P.wLv[k] = WTZ[o]; P.lvRef[k] = LVREF[d]; P.bias[k] = BIAS[d];
    P.wPop[k] = WTZ[o + T_POP];
    P.popAt[k] = d >= DevType.CS1 && d <= DevType.CS3 ? X_POPCS + d - DevType.CS1 : X_POPALL;
  });
  PROGS[zn] = P;
}

/** evaluate a zone program on the terms at TT[o..] into des[d][i] (clamped) */
function runProg(P: ZoneProg, TT: Float64Array, o: number, shift: Float64Array, des: Float32Array[], i: number): void {
  const U = P.U, W = P.W, n = U.length, lv = TT[o + T_LV];
  const devs = P.devs;
  if (P.nd === 3) {
    const d0 = devs[0], d1 = devs[1], d2 = devs[2];
    let s0 = P.bias[0] + shift[d0] + P.wLv[0] * (lv - P.lvRef[0]);
    let s1 = P.bias[1] + shift[d1] + P.wLv[1] * (lv - P.lvRef[1]);
    let s2 = P.bias[2] + shift[d2] + P.wLv[2] * (lv - P.lvRef[2]);
    for (let q = 0, w = 0; q < n; q++, w += 3) { const v = TT[o + U[q]]; s0 += W[w] * v; s1 += W[w + 1] * v; s2 += W[w + 2] * v; }
    s0 += P.wPop[0] * TT[o + P.popAt[0]]; s1 += P.wPop[1] * TT[o + P.popAt[1]]; s2 += P.wPop[2] * TT[o + P.popAt[2]];
    des[d0][i] = s0 < -1 ? -1 : s0 > 1 ? 1 : s0;
    des[d1][i] = s1 < -1 ? -1 : s1 > 1 ? 1 : s1;
    des[d2][i] = s2 < -1 ? -1 : s2 > 1 ? 1 : s2;
    return;
  }
  if (P.nd === 2) {
    const d0 = devs[0], d1 = devs[1];
    let s0 = P.bias[0] + shift[d0] + P.wLv[0] * (lv - P.lvRef[0]);
    let s1 = P.bias[1] + shift[d1] + P.wLv[1] * (lv - P.lvRef[1]);
    for (let q = 0, w = 0; q < n; q++, w += 2) { const v = TT[o + U[q]]; s0 += W[w] * v; s1 += W[w + 1] * v; }
    s0 += P.wPop[0] * TT[o + P.popAt[0]]; s1 += P.wPop[1] * TT[o + P.popAt[1]];
    des[d0][i] = s0 < -1 ? -1 : s0 > 1 ? 1 : s0;
    des[d1][i] = s1 < -1 ? -1 : s1 > 1 ? 1 : s1;
    return;
  }
  if (P.nd === 5) {
    const d0 = devs[0], d1 = devs[1], d2 = devs[2], d3 = devs[3], d4 = devs[4];
    let s0 = P.bias[0] + shift[d0] + P.wLv[0] * (lv - P.lvRef[0]);
    let s1 = P.bias[1] + shift[d1] + P.wLv[1] * (lv - P.lvRef[1]);
    let s2 = P.bias[2] + shift[d2] + P.wLv[2] * (lv - P.lvRef[2]);
    let s3 = P.bias[3] + shift[d3] + P.wLv[3] * (lv - P.lvRef[3]);
    let s4 = P.bias[4] + shift[d4] + P.wLv[4] * (lv - P.lvRef[4]);
    for (let q = 0, w = 0; q < n; q++, w += 5) {
      const v = TT[o + U[q]];
      s0 += W[w] * v; s1 += W[w + 1] * v; s2 += W[w + 2] * v; s3 += W[w + 3] * v; s4 += W[w + 4] * v;
    }
    s0 += P.wPop[0] * TT[o + P.popAt[0]]; s1 += P.wPop[1] * TT[o + P.popAt[1]]; s2 += P.wPop[2] * TT[o + P.popAt[2]];
    s3 += P.wPop[3] * TT[o + P.popAt[3]]; s4 += P.wPop[4] * TT[o + P.popAt[4]];
    des[d0][i] = s0 < -1 ? -1 : s0 > 1 ? 1 : s0;
    des[d1][i] = s1 < -1 ? -1 : s1 > 1 ? 1 : s1;
    des[d2][i] = s2 < -1 ? -1 : s2 > 1 ? 1 : s2;
    des[d3][i] = s3 < -1 ? -1 : s3 > 1 ? 1 : s3;
    des[d4][i] = s4 < -1 ? -1 : s4 > 1 ? 1 : s4;
    return;
  }
  for (let k = 0; k < P.nd; k++) {
    const d = devs[k];
    let s = P.bias[k] + shift[d] + P.wLv[k] * (lv - P.lvRef[k]);
    for (let q = 0; q < n; q++) s += W[q * P.nd + k] * TT[o + U[q]];
    s += P.wPop[k] * TT[o + P.popAt[k]];
    des[d][i] = s < -1 ? -1 : s > 1 ? 1 : s;
  }
}

/** tax / ordinance shift of DevType d */
function shiftOf(st: CityState, d: number): number {
  const fam = devFamily(d);
  return -DESIR_TAX * TAX_SENS[d] * (st.budget.taxRates[d] - TAX_NEUTRAL)
    + ordinanceEffect(st, 'add.desir.' + DEV_ENUM[d]) + ordinanceEffect(st, 'add.desir.' + fam);
}

// ------------------------------------------------------------------------------------------------ system
export function desirabilitySystem(rt: EconRuntime): SimSystem {
  let row = 0;
  let sweep = 0;
  /** term rows of the current map row, and which cells need which inputs */
  let TT = new Float64Array(0);
  let needs: (Uint8Array | null)[] = [];
  const shift = new Float64Array(DEV_TYPE_COUNT);
  let ctx: TermCtx | undefined;
  /** terrain rects changed since the last band (slope cache) */
  const terrain: CellRect[] = [];
  let sub: Simulation | null = null;
  let unsub: (() => void) | null = null;

  const prepShift = (st: CityState) => {
    for (let d = 0; d < DEV_TYPE_COUNT; d++) shift[d] = shiftOf(st, d);
  };
  /** refresh the per-cell caches: slope of changed terrain; freight with the coarse BFS */
  const prepCaches = (st: CityState, freight: boolean) => {
    const e = desExtraOf(rt, st);
    for (let k = 0; k < terrain.length; k++) {
      const r = terrain[k];
      slopeRect(st, e.slope, r.x0 - 1, r.z0 - 1, r.x1 + 1, r.z1 + 1);
    }
    terrain.length = 0;
    if (freight || !e.frBuilt) computeFreightCells(st, rt, e);
  };

  const band = (st: CityState, z0: number, z1: number, allCells: boolean) => {
    const N = st.size;
    const c = (ctx = termCtx(st, rt, ctx));
    const des = st.desirability;
    const net = st.network, water = st.water, zoneL = st.zone;
    if (TT.length < N * NTX) { TT = new Float64Array(N * NTX); needs = new Array<Uint8Array | null>(N).fill(null); }
    for (let z = z0; z < z1; z++) {
      const row = z * N;
      // which cells, with which inputs: zoned land (its DevTypes), unzoned land on an all-DevTypes sweep; roads / water -1
      for (let x = 0; x < N; x++) {
        const i = row + x;
        if (water[i] || net[i] !== Network.None) {
          needs[x] = null;
          if (des[0][i] !== -1 || des[11][i] !== -1) for (let d = 0; d < DEV_TYPE_COUNT; d++) des[d][i] = -1;
          continue;
        }
        const zone = zoneL[i];
        needs[x] = zone !== Zone.None && zone !== Zone.Landfill ? NEED_Z[zone] : allCells ? NEED_ALL : null;
      }
      fillRow(c, z, 0, N, TT, needs);
      for (let x = 0; x < N; x++) {
        if (!needs[x]) continue;
        const i = row + x, o = x * NTX;
        const P = PROGS[zoneL[i]];
        if (P) { runProg(P, TT, o, shift, des, i); continue; }
        // unzoned land (all-DevTypes sweep): every DevType at the reference mix weights
        for (let d = 0; d < DEV_TYPE_COUNT; d++) {
          const s = devRaw(TT, o, d, 0, shift[d]);
          des[d][i] = s < -1 ? -1 : s > 1 ? 1 : s;
        }
      }
    }
  };

  return {
    name: 'economy.desirability',
    init(sim) {
      rt.attach(sim);
      if (sub !== sim) {
        unsub?.();
        unsub = sim.events.on('terrainChanged', (r) => { terrain.push(r ?? { x0: 0, z0: 0, x1: sim.state.size, z1: sim.state.size }); });
        sub = sim;
      }
      const st = sim.state;
      computeFreightAccess(st, rt);
      rt.networkDirty = false;
      terrain.length = 0;
      desExtras.delete(rt);
      prepCaches(st, true);
      prepShift(st);
      band(st, 0, st.size, true);
      row = 0;
      sweep = 0;
    },
    daily(sim) {
      const t0 = performance.now();
      const st = sim.state;
      // freight sources: road / rail changes, and every FREIGHT_REFRESH_DAYS (absolute days, so a loaded city refreshes
      // on the same days; mid-month, away from the month-tick spike: a freight station counts only while its rail is
      // linked — WP7's use factor is monthly); traffic's per-industry freight access is cached per cell at the same time
      let freight = false;
      if (rt.networkDirty || st.day % FREIGHT_REFRESH_DAYS === FREIGHT_REFRESH_DAYS >> 1) {
        computeFreightAccess(st, rt);
        rt.networkDirty = false;
        freight = true;
      }
      prepCaches(st, freight);
      if (row === 0) prepShift(st);
      const N = st.size;
      const rows = Math.ceil(N / DESIR_REFRESH_DAYS);
      const z1 = Math.min(N, row + rows);
      band(st, row, z1, sweep % DESIR_ALL_SWEEPS === 0);
      row = z1;
      if (row >= N) {
        row = 0;
        sweep++;
        sim.events.emit('layerUpdated', 'desirability');
      }
      rt.timing.desirability = performance.now() - t0;
    },
  };
}

// ------------------------------------------------------------------------------------------------ breakdown
const BT = new Float64Array(NTX);
const B_NEED: readonly (Uint8Array | null)[] = [NEED_FULL];
let bctx: TermCtx | undefined;

/** detail line of a term's input value */
function termDetail(t: number, v: number, c: TermCtx, i: number): string | undefined {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  switch (t) {
    case T_LV: return `land value ${pct(v)}`;
    case T_COMMUTE: {
      const m = commuteMinutes(c.st, c.inf.traffic, i, c.ramp.avg);
      return `${m.toFixed(0)} min (city average ${c.ramp.avg.toFixed(0)}; good ≤ ${c.ramp.good.toFixed(0)}, bad ≥ ${c.ramp.bad.toFixed(0)})`;
    }
    case T_GARB: return c.gFade < 1 ? `uncollected pile ${pct(c.gFade > 0 ? v / c.gFade : 0)} · counts ${pct(c.gFade)} (fades in from 2k to 20k residents)` : `uncollected pile ${pct(v)}`;
    case T_RENT: return `rent pressure ${pct(v)} (land value above 45%)`;
    case T_WEALTHY: return v >= 0 ? 'richer neighbours' : 'poorer neighbours';
    case T_FREIGHT: return `freight access ${pct(v)}`;
    default: return pct(v);
  }
}

/**
 * Desirability terms of DevType `dev` at cell i: every non-zero weighted term (value = its contribution), the base appeal
 * and the tax / ordinance shift; Σ terms = raw (before the [-1, 1] clamp); value = the stored desirability (updated
 * every DESIR_REFRESH_DAYS — the inspector marks "updating" when it lags clamp(raw)). rt null: stub output.
 */
export function desirabilityBreakdown(st: CityState, rt: EconRuntime | null, dev: number, i: number): { terms: FactorTerm[]; raw: number; value: number } {
  const v = st.desirability[dev]?.[i] ?? 0;
  if (!rt || !rt.coarsePop || !(rt.cw > 0) || dev < 0 || dev >= DEV_TYPE_COUNT || i < 0 || i >= st.cells) return { terms: [], raw: v, value: v };
  if (st.water[i] || st.network[i] !== Network.None) {
    return { terms: [{ id: 'unbuildable', label: st.water[i] ? 'Water' : 'Road / rail', value: -1 }], raw: -1, value: v };
  }
  const N = st.size, x = i % N, z = (i / N) | 0;
  const c = (bctx = termCtx(st, rt, bctx));
  fillRow(c, z, x, x + 1, BT, B_NEED);
  const slot = slotOf(st.zone[i]);
  const o = (slot * DEV_TYPE_COUNT + dev) * NT;
  BT[T_POP] = dev >= DevType.CS1 && dev <= DevType.CS3 ? BT[X_POPCS + dev - DevType.CS1] : BT[X_POPALL];
  const terms: FactorTerm[] = [];
  const sh = shiftOf(st, dev);
  terms.push({ id: 'base', label: 'Base appeal', value: BIAS[dev] });
  if (sh !== 0) terms.push({ id: 'tax', label: 'Taxes & ordinances', value: sh, detail: `tax ${st.budget.taxRates[dev]}%` });
  let raw = BIAS[dev] + sh;
  const lvT = WTZ[o] * (BT[T_LV] - LVREF[dev]);
  if (WTZ[o] !== 0) { terms.push({ id: 'lv', label: DESIR_TERM_LABELS[T_LV], value: lvT, detail: termDetail(T_LV, BT[T_LV], c, i) }); raw += lvT; }
  const nz = NZ[slot * DEV_TYPE_COUNT + dev];
  for (let q = 0; q < nz.length; q++) {
    const t = nz[q];
    const val = WTZ[o + t] * BT[t];
    raw += val;
    terms.push({ id: DESIR_TERM_IDS[t], label: DESIR_TERM_LABELS[t], value: val, detail: termDetail(t, BT[t], c, i) });
  }
  return { terms, raw, value: v };
}
