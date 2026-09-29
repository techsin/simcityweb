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
 * The band and desirabilityBreakdown share fillTerms / devRaw: the formula exists once.
 * Time-sliced: zoned / developed cells get the DevTypes of their zone every DESIR_REFRESH_DAYS; unzoned land cells get
 * all DevTypes (reference mix weights) every DESIR_ALL_SWEEPS sweeps (overlay / planning). Roads & water = -1.
 */
import type { SimSystem } from '../Simulation';
import type { CityState } from '../CityState';
import { BF } from '../CityState';
import { smoothstep } from '../../core/rng';
import { DEV_TYPE_COUNT, DevType, Network, Zone, zoneDensity } from '../../core/types';
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
/** effective weight of term t for DevType dev on a lot of zone density slot (tests / UI) */
export function desirWeight(dev: number, t: number, slot = 0): number {
  return WTZ[(slot * DEV_TYPE_COUNT + dev) * NT + t];
}
const ALL_DEVS: readonly number[] = Array.from({ length: DEV_TYPE_COUNT }, (_, i) => i);

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

// ------------------------------------------------------------------------------------------------ shared term model
/** duck-typed traffic view (per-building freight access of industry, -1 = not assessed) */
interface FreightApi { freightAccess?: (id: number) => number }

/** per-call context of the term model (band: per daily band; breakdown: per query) */
interface TermCtx {
  st: CityState;
  rt: EconRuntime;
  inf: InfraFlags;
  ramp: CommuteRamp;
  /** garbage fade 0..1 */
  gFade: number;
  traffic: FreightApi | undefined;
  /** coarse residents by wealth usable (WP1 grids sized) */
  popW: boolean;
  /** customers nearby per CS tier for the current cell (fillTerms writes) */
  popCS: Float64Array;
}

function termCtx(st: CityState, rt: EconRuntime, out?: TermCtx): TermCtx {
  const inf = infraFlags(st);
  const tr = inf.traffic ? (rt.sim?.getSystem('traffic') as unknown as FreightApi | undefined) : undefined;
  const cc = rt.cw * rt.cw;
  const c = out ?? { st, rt, inf, ramp: { avg: 0, good: 0, bad: 0 }, gFade: 0, traffic: undefined, popW: false, popCS: new Float64Array(3) };
  c.st = st; c.rt = rt; c.inf = inf;
  commuteRamp(st, c.ramp);
  c.gFade = garbageFade(st);
  c.traffic = tr && typeof tr.freightAccess === 'function' ? tr : undefined;
  c.popW = rt.coarsePopW[0].length === cc && cc > 0;
  return c;
}

/** fill T[0..NT) with the inputs of cell i (x, z) — the shared half of the band and the breakdown */
function fillTerms(c: TermCtx, i: number, x: number, z: number, T: Float64Array | Float32Array): void {
  const st = c.st, rt = c.rt, inf = c.inf, N = st.size, net = st.network;
  const lv = st.landValue[i];
  T[T_LV] = lv;
  T[T_AIR] = st.airPollution[i];
  T[T_WATER] = st.waterPollution[i];
  T[T_GARB] = st.garbage[i] * c.gFade;
  T[T_CRIME] = st.crime[i];
  // neighbour roads: noise proxy / traffic
  let nNoise = 0, nTraffic = 0, trafficVol = 0;
  if (x > 0) { const k = net[i - 1]; if (NET_NOISE[k] > nNoise) nNoise = NET_NOISE[k]; if (NET_TRAFFIC[k] > nTraffic) nTraffic = NET_TRAFFIC[k]; if (st.traffic[i - 1] > trafficVol) trafficVol = st.traffic[i - 1]; }
  if (x < N - 1) { const k = net[i + 1]; if (NET_NOISE[k] > nNoise) nNoise = NET_NOISE[k]; if (NET_TRAFFIC[k] > nTraffic) nTraffic = NET_TRAFFIC[k]; if (st.traffic[i + 1] > trafficVol) trafficVol = st.traffic[i + 1]; }
  if (z > 0) { const k = net[i - N]; if (NET_NOISE[k] > nNoise) nNoise = NET_NOISE[k]; if (NET_TRAFFIC[k] > nTraffic) nTraffic = NET_TRAFFIC[k]; if (st.traffic[i - N] > trafficVol) trafficVol = st.traffic[i - N]; }
  if (z < N - 1) { const k = net[i + N]; if (NET_NOISE[k] > nNoise) nNoise = NET_NOISE[k]; if (NET_TRAFFIC[k] > nTraffic) nTraffic = NET_TRAFFIC[k]; if (st.traffic[i + N] > trafficVol) trafficVol = st.traffic[i + N]; }
  T[T_NOISE] = inf.pollution ? st.noise[i] : nNoise;
  T[T_TRAFFIC] = inf.traffic ? Math.min(1, trafficVol / TRAFFIC_BUSY) : nTraffic;
  const r = c.ramp;
  T[T_COMMUTE] = 0.5 - smoothstep(r.good, r.bad, commuteMinutes(st, inf.traffic, i, r.avg));
  if (inf.services) {
    T[T_POLICE] = st.policeCov[i]; T[T_FIRE] = st.fireCov[i]; T[T_HEALTH] = st.healthCov[i]; T[T_EDU] = st.eduCov[i];
    T[T_PARK] = st.parkCov[i]; T[T_TRANSIT] = st.transitCov[i];
    T[T_ELEM] = st.eduElemCov[i]; T[T_HIGH] = st.eduHighCov[i]; T[T_COLLEGE] = st.eduCollegeCov[i];
    T[T_PLAY] = st.playCov[i]; T[T_GREEN] = st.greenCov[i]; T[T_SHOPS] = st.shopAccess[i];
  } else {
    const f = COVERAGE_FALLBACK;
    const park = Math.min(1, Math.max(0, lvEffectAt(rt, i)) * 3);
    T[T_POLICE] = T[T_FIRE] = T[T_HEALTH] = T[T_EDU] = f;
    T[T_PARK] = park;
    T[T_TRANSIT] = 0;
    T[T_ELEM] = T[T_HIGH] = T[T_COLLEGE] = T[T_SHOPS] = f;
    T[T_PLAY] = T[T_GREEN] = park;
  }
  T[T_STIGMA] = st.stigma[i]; T[T_PRESTIGE] = st.prestige[i]; T[T_CAMPUS] = st.campus[i];
  T[T_VISITORS] = st.visitors[i]; T[T_TREES] = st.treeCover[i]; T[T_SOIL] = st.soil[i];
  T[T_RENT] = rentLevel(lv);
  T[T_PARKING] = st.parking[i];
  const blk = ((z / COARSE) | 0) * rt.cw + ((x / COARSE) | 0);
  T[T_POP] = Math.min(1, rt.coarsePop[blk] / POP_NEAR_FULL);
  // customers nearby per CS tier: residents of each wealth (coarse, blurred) × who shops at that tier
  const pc = c.popCS;
  if (c.popW) {
    const p0 = rt.coarsePopW[0][blk], p1 = rt.coarsePopW[1][blk], p2 = rt.coarsePopW[2][blk];
    for (let k = 0; k < 3; k++) {
      const v = (p0 * CUSTOMER_MIX[0][k] + p1 * CUSTOMER_MIX[1][k] + p2 * CUSTOMER_MIX[2][k]) / POP_NEAR_FULL_W[k];
      pc[k] = v < 1 ? v : 1;
    }
  } else pc[0] = pc[1] = pc[2] = T[T_POP];
  T[T_SKILL] = rt.coarseSkill ? rt.coarseSkill[blk] : 0;
  T[T_WEALTHY] = rt.coarseWealth[blk];
  // freight: traffic's measured access for the industry standing here, else the coarse BFS
  let fr = rt.coarseFreight[blk];
  const tr = c.traffic;
  if (tr) {
    const id = st.building[i];
    if (id >= 0) {
      const b = st.buildings.get(id);
      if (b && !(b.flags & BF.Plopped)) {
        const dv = rt.defOf(b)?.devType;
        if (dv !== undefined && dv >= DevType.IA) { const a = tr.freightAccess!(id); if (a >= 0) fr = a; }
      }
    }
  }
  T[T_FREIGHT] = fr;
  T[T_SLOPE] = smoothstep(SLOPE_P0, SLOPE_P1, st.cellSlope(x, z));
}

/** raw desirability of DevType d (weights slot `slot`) from filled terms (T[T_POP] per CS tier from c.popCS) */
function devRaw(c: TermCtx, T: Float64Array | Float32Array, d: number, slot: number, shiftD: number): number {
  const o = (slot * DEV_TYPE_COUNT + d) * NT;
  if (d >= DevType.CS1 && d <= DevType.CS3) T[T_POP] = c.popCS[d - DevType.CS1];
  let s = BIAS[d] + shiftD + WTZ[o] * (T[T_LV] - LVREF[d]);
  const nz = NZ[slot * DEV_TYPE_COUNT + d];
  for (let q = 0; q < nz.length; q++) { const t = nz[q]; s += WTZ[o + t] * T[t]; }
  return s;
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
  let lastFreight = -1e9;
  const T = new Float64Array(NT);
  const shift = new Float64Array(DEV_TYPE_COUNT);
  let ctx: TermCtx | undefined;

  const prepShift = (st: CityState) => {
    for (let d = 0; d < DEV_TYPE_COUNT; d++) shift[d] = shiftOf(st, d);
  };

  const band = (st: CityState, z0: number, z1: number, allCells: boolean) => {
    const N = st.size;
    const c = (ctx = termCtx(st, rt, ctx));
    const des = st.desirability;
    const net = st.network;
    for (let z = z0; z < z1; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        const zone = st.zone[i];
        const n = net[i];
        if (st.water[i] || n !== Network.None) {
          if (des[0][i] !== -1 || des[11][i] !== -1) for (let d = 0; d < DEV_TYPE_COUNT; d++) des[d][i] = -1;
          continue;
        }
        let devs: readonly number[];
        let slot = 0;
        if (zone !== Zone.None && zone !== Zone.Landfill) { devs = ZONE_DEVTYPES[zone]; slot = slotOf(zone); }
        else if (st.building[i] >= 0 && !allCells) continue;
        else if (allCells) devs = ALL_DEVS;
        else continue;
        fillTerms(c, i, x, z, T);
        for (let k = 0; k < devs.length; k++) {
          const d = devs[k];
          const s = devRaw(c, T, d, slot, shift[d]);
          des[d][i] = s < -1 ? -1 : s > 1 ? 1 : s;
        }
      }
    }
  };

  return {
    name: 'economy.desirability',
    init(sim) {
      rt.attach(sim);
      const st = sim.state;
      computeFreightAccess(st, rt);
      rt.networkDirty = false;
      lastFreight = st.day;
      prepShift(st);
      band(st, 0, st.size, true);
      row = 0;
      sweep = 0;
    },
    daily(sim) {
      const t0 = performance.now();
      const st = sim.state;
      // freight sources: road / rail changes, and monthly (a freight station counts only while its rail is linked —
      // WP7's use factor is refreshed monthly)
      if (rt.networkDirty || st.day - lastFreight >= FREIGHT_REFRESH_DAYS || lastFreight > st.day) {
        computeFreightAccess(st, rt);
        rt.networkDirty = false;
        lastFreight = st.day;
      }
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
const BT = new Float64Array(NT);
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
  fillTerms(c, i, x, z, BT);
  const slot = slotOf(st.zone[i]);
  const o = (slot * DEV_TYPE_COUNT + dev) * NT;
  if (dev >= DevType.CS1 && dev <= DevType.CS3) BT[T_POP] = c.popCS[dev - DevType.CS1];
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
