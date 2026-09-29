/**
 * Land value system → state.landValue (0..1), stats.avgLandValue (SIM_DEPTH_SPEC WP6).
 *  raw = base + view / elevation + waterfront × (1 − .8 water pollution) + plopped building splats (BuildingDef.landValue:
 *        parks, landmarks, dumps — functional buildings only, parks × parks funding; landfill zones)
 *        + police / fire / health / elementary / high / college coverage + play / green + transit + commute (city-relative)
 *        + neighbourhood wealth + prestige − stigma + tree cover − soil contamination + historic building
 *        − air / water / garbage (pile, faded in with town size) / crime / noise           (LV_TERMS, LV in tuning.ts)
 *  stored = temporal smoothing of the spatial 4-neighbour blend of clamp(raw, 0, 1).
 * lvRow() is the one formula: the band runs it a row at a time, landValueBreakdown lists its terms for one cell (+ clamp and
 * smoothing terms, so the list sums to the stored value). Time-sliced: a band of rows per day (full map every LV_REFRESH_DAYS).
 * Plopped splats are applied incrementally (EconRuntime's add / remove queue) with the factor each building had when it
 * was splatted; a Burnt / Abandoned flip (buildingChanged) or a parks-funding change re-splats the difference, so a
 * burnt landmark stops lifting its neighbourhood and an unfunded park lifts it less.
 * Historic buildings are read from a per-cell mask (rebuilt when a historic building changes and once per sweep).
 */
import type { SimSystem, Simulation } from '../Simulation';
import { BF, type Building, type CityState } from '../CityState';
import { clamp, smoothstep } from '../../core/rng';
import { Zone } from '../../core/types';
import { getDef } from '../catalog';
import {
  COARSE, COVERAGE_FALLBACK, LV, LV_EFFECTS_MIN_DAYS, LV_REFRESH_DAYS, LV_STATIC_MIN_DAYS, LV_TERMS, PARK_LV_FUNDING_MAX,
} from './tuning';
import { type EconRuntime, type InfraFlags, infraFlags } from './runtime';
import { commuteMinutes, commuteRamp, garbageFade, type CommuteRamp } from './factors';
import { serviceEffectiveness } from './budget';
import type { FactorTerm } from '../explain';

// ------------------------------------------------------------------------------------------------ WP6 per-runtime state
/** land-value state that EconRuntime (read-only in part B) does not carry: the waterfront raster (split out of the
 *  static terrain part) and the splat factor applied per plopped building */
interface LvExtra {
  /** waterfront bonus per cell (before the water-pollution cut) */
  wf: Float32Array;
  /** building id -> splat factor applied (0 = not splatted) */
  applied: Map<number, number>;
  /** parks effectiveness the park splats were applied with */
  parksEff: number;
  /** 1 on the cells of standing historic buildings (perf: no building lookup per cell); the cells marked */
  hist: Uint8Array;
  histCells: number[];
  /** a historic building changed (flag toggled, burnt / abandoned / repaired, removed): rebuild before the next band */
  histDirty: boolean;
}
const extras = new WeakMap<EconRuntime, LvExtra>();
function extraOf(rt: EconRuntime, st: CityState): LvExtra {
  let e = extras.get(rt);
  if (!e || e.wf.length !== st.cells) {
    e = { wf: new Float32Array(st.cells), applied: new Map(), parksEff: 1, hist: new Uint8Array(st.cells), histCells: [], histDirty: true };
    extras.set(rt, e);
  }
  return e;
}
/** historic mask: the cells of every historic building that is not burnt / abandoned */
function rebuildHistoric(st: CityState, e: LvExtra): void {
  const N = st.size, hist = e.hist, cells = e.histCells;
  for (let k = 0; k < cells.length; k++) hist[cells[k]] = 0;
  cells.length = 0;
  for (const b of st.buildings.values()) {
    if (!(b.flags & BF.Historic) || b.flags & (BF.Burnt | BF.Abandoned)) continue;
    for (let z = Math.max(0, b.z); z < Math.min(N, b.z + b.d); z++) {
      for (let x = Math.max(0, b.x); x < Math.min(N, b.x + b.w); x++) { const i = z * N + x; hist[i] = 1; cells.push(i); }
    }
  }
  e.histDirty = false;
}

// ------------------------------------------------------------------------------------------------ static terrain part
/** static terrain component: view / elevation into `out`; the waterfront bonus into `wfOut` (added to `out` when absent) */
export function computeStaticLandValue(st: CityState, out: Float32Array, wfOut?: Float32Array): void {
  const N = st.size;
  // chamfer distance to water (cells)
  const INF = 255;
  const dist = new Uint8Array(st.cells).fill(INF);
  for (let i = 0; i < st.cells; i++) if (st.water[i]) dist[i] = 0;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      let d = dist[i];
      if (x > 0 && dist[i - 1] + 1 < d) d = dist[i - 1] + 1;
      if (z > 0 && dist[i - N] + 1 < d) d = dist[i - N] + 1;
      dist[i] = d;
    }
  }
  for (let z = N - 1; z >= 0; z--) {
    for (let x = N - 1; x >= 0; x--) {
      const i = z * N + x;
      let d = dist[i];
      if (x < N - 1 && dist[i + 1] + 1 < d) d = dist[i + 1] + 1;
      if (z < N - 1 && dist[i + N] + 1 < d) d = dist[i + N] + 1;
      dist[i] = d;
    }
  }
  // coarse mean heights (for "view": elevation above surroundings)
  const cw = Math.ceil(N / COARSE);
  const sum = new Float32Array(cw * cw), cnt = new Float32Array(cw * cw);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) { const b = ((z / COARSE) | 0) * cw + ((x / COARSE) | 0); sum[b] += st.cellHeight(x, z); cnt[b]++; }
  const mean = new Float32Array(cw * cw);
  for (let bz = 0; bz < cw; bz++) {
    for (let bx = 0; bx < cw; bx++) {
      let s = 0, c = 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const x = bx + dx, z = bz + dz;
        if (x < 0 || z < 0 || x >= cw || z >= cw) continue;
        const b = z * cw + x;
        s += sum[b]; c += cnt[b];
      }
      mean[bz * cw + bx] = c ? s / c : 0;
    }
  }
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (st.water[i]) { out[i] = 0; if (wfOut) wfOut[i] = 0; continue; }
      const h = st.cellHeight(x, z);
      const wf = dist[i] >= LV.waterDist ? 0 : LV.waterfront * (1 - dist[i] / LV.waterDist) ** 1.5;
      const rel = h - mean[((z / COARSE) | 0) * cw + ((x / COARSE) | 0)];
      const view = LV.view * smoothstep(LV.viewH0, LV.viewH1, rel) + 0.04 * smoothstep(10, 90, h);
      if (wfOut) { out[i] = view; wfOut[i] = wf; } else out[i] = wf + view;
    }
  }
}

// ------------------------------------------------------------------------------------------------ plopped splats
function splat(st: CityState, out: Float32Array, cx: number, cz: number, amount: number, radius: number): void {
  const N = st.size;
  const r = Math.ceil(radius);
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
  const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(N - 1, Math.ceil(cz + r));
  const r2 = radius * radius;
  for (let z = z0; z <= z1; z++) {
    const dz = z + 0.5 - cz;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r2) continue;
      out[z * N + x] += amount * (1 - Math.sqrt(d2) / radius);
    }
  }
}

/** add (sign 1) or remove (sign -1) `sign` × the BuildingDef.landValue splat of a plopped building */
export function splatBuilding(st: CityState, b: Building, sign: number, out: Float32Array): void {
  const lv = getDef(b.def)?.landValue;
  if (!lv || sign === 0) return;
  splat(st, out, b.x + b.w / 2, b.z + b.d / 2, sign * lv.amount, lv.radius + Math.max(b.w, b.d) / 2);
}

/** parks effectiveness 0..PARK_LV_FUNDING_MAX (funding^0.7, 0 on strike) */
function parksEffectiveness(st: CityState): number {
  return clamp(serviceEffectiveness(st, 'parks'), 0, PARK_LV_FUNDING_MAX);
}

/** splat factor of a plopped building: 0 when burnt / abandoned (a burnt landmark lifts nothing), parks × funding */
export function lvSplatFactor(st: CityState, b: Building, parksEff = parksEffectiveness(st)): number {
  if (b.flags & (BF.Burnt | BF.Abandoned)) return 0;
  const def = getDef(b.def);
  if (!def?.landValue) return 0;
  return def.service === 'parks' && def.landValue.amount > 0 ? parksEff : 1;
}

/** full rebuild of plopped-building land value effects (raw, unclamped) */
export function computeLandValueEffects(st: CityState, rt: EconRuntime, out: Float32Array): void {
  out.fill(0);
  const ex = extraOf(rt, st);
  ex.applied.clear();
  const pe = (ex.parksEff = parksEffectiveness(st));
  for (const b of rt.plopped) {
    if (!st.buildings.has(b.id)) continue;
    const f = lvSplatFactor(st, b, pe);
    if (f !== 0) { splatBuilding(st, b, f, out); ex.applied.set(b.id, f); }
  }
}

/** landfill zone land value (coarse 2×2 splats) */
export function computeLandfillEffects(st: CityState, out: Float32Array): void {
  out.fill(0);
  const lf = getDef('util_landfill_tile')?.landValue;
  if (!lf) return;
  const N = st.size;
  for (let z = 0; z < N; z += 2) {
    for (let x = 0; x < N; x += 2) {
      let c = 0;
      for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) if (x + dx < N && z + dz < N && st.zone[(z + dz) * N + x + dx] === Zone.Landfill) c++;
      if (c) splat(st, out, x + 1, z + 1, (lf.amount * c) / 4, lf.radius);
    }
  }
}

/** clamped total land value effect at cell i */
export function lvEffectAt(rt: EconRuntime, i: number): number {
  const v = rt.lvEffects[i] + rt.lvLandfill[i];
  return v < -0.7 ? -0.7 : v > 0.6 ? 0.6 : v;
}

// ------------------------------------------------------------------------------------------------ the formula
export const LV_BASE = 0, LV_VIEW = 1, LV_WATERFRONT = 2, LV_BUILDINGS = 3, LV_POLICE = 4, LV_FIRE = 5, LV_HEALTH = 6, LV_ELEM = 7,
  LV_HIGH = 8, LV_COLLEGE = 9, LV_PLAY = 10, LV_GREEN = 11, LV_TRANSIT = 12, LV_COMMUTE = 13, LV_WEALTH = 14, LV_PRESTIGE = 15,
  LV_STIGMA = 16, LV_TREES = 17, LV_SOIL = 18, LV_HISTORIC = 19, LV_AIR = 20, LV_WATERPOLL = 21, LV_GARBAGE = 22, LV_CRIME = 23,
  LV_NOISE = 24;
/** number of land value terms */
export const NLV = 25;
export const LV_TERM_IDS: readonly string[] = [
  'base', 'view', 'waterfront', 'buildings', 'police', 'fire', 'health', 'elementary', 'high', 'college', 'play', 'green', 'transit',
  'commute', 'wealth', 'prestige', 'stigma', 'trees', 'soil', 'historic', 'air', 'waterPollution', 'garbage', 'crime', 'noise',
];
export const LV_TERM_LABELS: readonly string[] = [
  'Base', 'View / elevation', 'Waterfront', 'Parks, landmarks & dumps nearby', 'Police', 'Fire protection', 'Health care',
  'Elementary school', 'High school', 'College', 'Playgrounds', 'Green space', 'Transit', 'Commute', 'Neighbourhood wealth',
  'Prestige', 'Stigma (NIMBY)', 'Trees', 'Contaminated soil', 'Historic building', 'Air pollution', 'Water pollution',
  'Uncollected garbage', 'Crime', 'Noise',
];

interface LvCtx { st: CityState; rt: EconRuntime; ex: LvExtra; inf: InfraFlags; ramp: CommuteRamp; gFade: number }
function lvCtx(st: CityState, rt: EconRuntime, out?: LvCtx): LvCtx {
  const c = out ?? { st, rt, ex: extraOf(rt, st), inf: infraFlags(st), ramp: { avg: 0, good: 0, bad: 0 }, gFade: 0 };
  c.st = st; c.rt = rt; c.ex = extraOf(rt, st); c.inf = infraFlags(st);
  commuteRamp(st, c.ramp);
  c.gFade = garbageFade(st);
  return c;
}

/**
 * Raw (unclamped) land value of the cells xa..xb-1 of row z into raw[x - xa] (water: 0) — the one formula: the band runs
 * it a row at a time (layers and constants hoisted), the breakdown for one cell with L, which then receives every term
 * (index LV_*; their sum in term order is the raw value up to float rounding: the row sums three partial sums).
 */
function lvRow(c: LvCtx, z: number, xa: number, xb: number, raw: Float64Array, L: Float64Array | null): void {
  const st = c.st, rt = c.rt, K = LV_TERMS, N = st.size;
  const kBase = LV.base, kWfp = K.waterfrontPollution, kPol = K.police, kFire = K.fire, kHealth = K.health, kElem = K.elem;
  const kHigh = K.high, kCollege = K.college, kPlay = K.play, kGreen = K.green, kTransit = K.transit, kCommute = K.commute;
  const kWealth = K.wealth, kPrestige = K.prestige, kStigma = K.stigma, kTrees = K.trees, kSoil = K.soil, kHist = K.historic;
  const kAir = LV.airPollution, kWater = LV.waterPollution, kGarb = K.garbage, kCrime = LV.crime, kNoise = LV.noise;
  const fb = COVERAGE_FALLBACK, gFade = c.gFade, rGood = c.ramp.good, rBad = c.ramp.bad, rAvg = c.ramp.avg;
  const services = c.inf.services, traffic = c.inf.traffic;
  const water = st.water, lvS = rt.lvStatic, wf = c.ex.wf, hist = c.ex.hist, eff = rt.lvEffects, lf = rt.lvLandfill;
  const pol = st.policeCov, fire = st.fireCov, health = st.healthCov, elem = st.eduElemCov, high = st.eduHighCov;
  const college = st.eduCollegeCov, play = st.playCov, green = st.greenCov, transit = st.transitCov;
  const prestige = st.prestige, stigma = st.stigma, trees = st.treeCover, soil = st.soil;
  const air = st.airPollution, wp = st.waterPollution, garb = st.garbage, crime = st.crime, noise = st.noise;
  const wealth = rt.coarseWealth, bz = ((z / COARSE) | 0) * rt.cw;
  const row = z * N;
  for (let x = xa; x < xb; x++) {
    const i = row + x;
    if (water[i]) { raw[x - xa] = 0; continue; }
    const tView = lvS[i];
    const tWf = wf[i] * (1 - kWfp * wp[i]);
    // plopped buildings and landfill splats, clamped (= lvEffectAt)
    let e = eff[i] + lf[i];
    e = e < -0.7 ? -0.7 : e > 0.6 ? 0.6 : e;
    let tPol: number, tFire: number, tHealth: number, tElem: number, tHigh: number, tCol: number, tPlay: number, tGreen: number, tTransit: number;
    if (services) {
      tPol = kPol * pol[i]; tFire = kFire * fire[i]; tHealth = kHealth * health[i];
      tElem = kElem * elem[i]; tHigh = kHigh * high[i]; tCol = kCollege * college[i];
      tPlay = kPlay * play[i]; tGreen = kGreen * green[i]; tTransit = kTransit * transit[i];
    } else {
      const park = Math.max(0, e) * 2;
      tPol = kPol * fb; tFire = kFire * fb; tHealth = kHealth * fb;
      tElem = kElem * fb; tHigh = kHigh * fb; tCol = kCollege * fb;
      tPlay = kPlay * park; tGreen = kGreen * park; tTransit = 0;
    }
    const tCommute = kCommute * (1 - smoothstep(rGood, rBad, commuteMinutes(st, traffic, i, rAvg)) - 0.5);
    const tWealth = kWealth * wealth[bz + ((x / COARSE) | 0)];
    const tPrestige = kPrestige * prestige[i];
    const tStigma = -kStigma * stigma[i];
    const tTrees = kTrees * trees[i];
    const tSoil = -kSoil * soil[i];
    const tHist = hist[i] ? kHist : 0;
    const tAir = -kAir * air[i];
    const tWp = -kWater * wp[i];
    const tGarb = -kGarb * garb[i] * gFade;
    const tCrime = -kCrime * crime[i];
    const tNoise = -kNoise * noise[i];
    // three independent partial sums (term order within each)
    const s1 = kBase + tView + tWf + e + tPol + tFire + tHealth + tElem;
    const s2 = tHigh + tCol + tPlay + tGreen + tTransit + tCommute + tWealth + tPrestige + tStigma;
    const s3 = tTrees + tSoil + tHist + tAir + tWp + tGarb + tCrime + tNoise;
    raw[x - xa] = s1 + s2 + s3;
    if (L) {
      L[LV_BASE] = kBase; L[LV_VIEW] = tView; L[LV_WATERFRONT] = tWf; L[LV_BUILDINGS] = e;
      L[LV_POLICE] = tPol; L[LV_FIRE] = tFire; L[LV_HEALTH] = tHealth; L[LV_ELEM] = tElem; L[LV_HIGH] = tHigh;
      L[LV_COLLEGE] = tCol; L[LV_PLAY] = tPlay; L[LV_GREEN] = tGreen; L[LV_TRANSIT] = tTransit; L[LV_COMMUTE] = tCommute;
      L[LV_WEALTH] = tWealth; L[LV_PRESTIGE] = tPrestige; L[LV_STIGMA] = tStigma; L[LV_TREES] = tTrees; L[LV_SOIL] = tSoil;
      L[LV_HISTORIC] = tHist; L[LV_AIR] = tAir; L[LV_WATERPOLL] = tWp; L[LV_GARBAGE] = tGarb; L[LV_CRIME] = tCrime;
      L[LV_NOISE] = tNoise;
    }
  }
}

// ------------------------------------------------------------------------------------------------ system
export function landValueSystem(rt: EconRuntime): SimSystem {
  let row = 0;
  /** average accumulators: zoned / built sum, count; all land sum, count (band locals, written back once per band) */
  const acc = new Float64Array(4);
  let lastStatic = -1e9, lastLandfill = -1e9;
  let rawRow = new Float64Array(0);
  let ctx: LvCtx | undefined;
  /** plopped buildings whose flags changed since the last refresh (Burnt / Abandoned flips re-splat) */
  const changed: Building[] = [];
  let sub: Simulation | null = null;
  let unsub: (() => void) | null = null;

  /**
   * full-map passes are throttled: terrain (lot leveling, terraform) at most every LV_STATIC_MIN_DAYS, landfill splats
   * every LV_EFFECTS_MIN_DAYS; plopped buildings are splatted incrementally (add / remove queue, flag flips, parks
   * funding).
   */
  const refresh = (st: CityState, force: boolean) => {
    const ex = extraOf(rt, st);
    if (rt.terrainDirty && (force || st.day - lastStatic >= LV_STATIC_MIN_DAYS)) {
      computeStaticLandValue(st, rt.lvStatic, ex.wf);
      rt.terrainDirty = false;
      lastStatic = st.day;
    }
    if (rt.lvEffectsDirty || force) {
      computeLandValueEffects(st, rt, rt.lvEffects);
      rt.lvEffectsDirty = false;
      rt.lvQueue.length = 0;
      changed.length = 0;
    } else {
      const pe = parksEffectiveness(st);
      if (rt.lvQueue.length) {
        const q = rt.lvQueue;
        for (let k = 0; k < q.length; k += 2) {
          const b = q[k] as Building;
          if ((q[k + 1] as number) > 0) {
            if (ex.applied.has(b.id) || !st.buildings.has(b.id)) continue;
            const f = lvSplatFactor(st, b, pe);
            if (f !== 0) { splatBuilding(st, b, f, rt.lvEffects); ex.applied.set(b.id, f); }
          } else {
            const f = ex.applied.get(b.id);
            if (f !== undefined) { splatBuilding(st, b, -f, rt.lvEffects); ex.applied.delete(b.id); }
          }
        }
        q.length = 0;
      }
      // flag flips (burnt / abandoned / repaired) and a parks-funding change: re-splat the difference
      const funding = Math.abs(pe - ex.parksEff) > 0.005;
      if (changed.length || funding) {
        const list = funding ? rt.plopped : changed;
        ex.parksEff = pe;
        for (let k = 0; k < list.length; k++) {
          const b = list[k];
          if (!st.buildings.has(b.id) || !(b.flags & BF.Plopped)) continue;
          const f0 = ex.applied.get(b.id) ?? 0;
          const f = lvSplatFactor(st, b, pe);
          if (Math.abs(f - f0) < 1e-6) continue;
          splatBuilding(st, b, f - f0, rt.lvEffects);
          if (f !== 0) ex.applied.set(b.id, f); else ex.applied.delete(b.id);
        }
        changed.length = 0;
      }
    }
    if (rt.lvLandfillDirty && (force || st.day - lastLandfill >= LV_EFFECTS_MIN_DAYS)) {
      computeLandfillEffects(st, rt.lvLandfill);
      rt.lvLandfillDirty = false;
      lastLandfill = st.day;
    }
    // historic mask: on a historic building's change, and once per sweep
    if (ex.histDirty || force || row === 0) rebuildHistoric(st, ex);
  };
  const band = (st: CityState, z0: number, z1: number, first: boolean) => {
    const N = st.size;
    const lvArr = st.landValue, water = st.water, zone = st.zone, bld = st.building;
    const c = (ctx = lvCtx(st, rt, ctx));
    if (rawRow.length < N) rawRow = new Float64Array(N);
    const raw = rawRow;
    let sum = 0, cnt = 0, sumAll = 0, cntAll = 0;
    for (let z = z0; z < z1; z++) {
      lvRow(c, z, 0, N, raw, null);
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        if (water[i]) { lvArr[i] = 0; continue; }
        let v = raw[x];
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        let nv = v;
        if (!first) {
          // spatial blend with neighbours (their current values), then temporal smoothing
          let s = 0, n = 0;
          if (x > 0) { s += lvArr[i - 1]; n++; }
          if (x < N - 1) { s += lvArr[i + 1]; n++; }
          if (z > 0) { s += lvArr[i - N]; n++; }
          if (z < N - 1) { s += lvArr[i + N]; n++; }
          const sp = n ? v * (1 - LV.spatial) + (s / n) * LV.spatial : v;
          nv = lvArr[i] + (sp - lvArr[i]) * LV.temporal;
        }
        lvArr[i] = nv;
        sumAll += nv; cntAll++;
        if (zone[i] !== Zone.None || bld[i] >= 0) { sum += nv; cnt++; }
      }
    }
    acc[0] += sum; acc[1] += cnt; acc[2] += sumAll; acc[3] += cntAll;
  };
  const publish = (st: CityState) => {
    st.stats.avgLandValue = acc[1] > 0 ? acc[0] / acc[1] : acc[3] > 0 ? acc[2] / acc[3] : 0;
    acc.fill(0);
  };
  return {
    name: 'economy.landValue',
    init(sim) {
      rt.attach(sim);
      if (sub !== sim) {
        unsub?.();
        const histFlip = (b: Building) => {
          const ex = extras.get(rt);
          if (!ex || ex.histDirty) return;
          const N = sim.state.size, i = b.z * N + b.x;
          if (b.flags & BF.Historic || (i >= 0 && i < ex.hist.length && ex.hist[i])) ex.histDirty = true;
        };
        const u1 = sim.events.on('buildingChanged', (b) => {
          if (b.flags & BF.Plopped && getDef(b.def)?.landValue) changed.push(b);
          histFlip(b);
        });
        const u2 = sim.events.on('buildingRemoved', histFlip);
        unsub = () => { u1(); u2(); };
        sub = sim;
      }
      const st = sim.state;
      rt.terrainDirty = true;
      row = 0;
      refresh(st, true);
      acc.fill(0);
      band(st, 0, st.size, true);
      // (stats from the first pass too: a new or loaded city shows its average at once)
      publish(st);
      row = 0;
    },
    daily(sim) {
      const t0 = performance.now();
      const st = sim.state;
      rt.attach(sim);
      refresh(st, false);
      const N = st.size;
      const rows = Math.ceil(N / LV_REFRESH_DAYS);
      const z1 = Math.min(N, row + rows);
      band(st, row, z1, false);
      row = z1;
      if (row >= N) {
        row = 0;
        publish(st);
        sim.events.emit('layerUpdated', 'landValue');
      }
      rt.timing.landValue = performance.now() - t0;
    },
  };
}

// ------------------------------------------------------------------------------------------------ breakdown
const BL = new Float64Array(NLV);
const BR = new Float64Array(1);
let bctx: LvCtx | undefined;

/**
 * Land value terms at cell i (WP5 inspector): every non-zero term of the formula, then 'clamp' (clamp(raw, 0, 1) − raw)
 * and 'smoothing' (stored − clamp(raw): the blend with the neighbours and the lag of the temporal smoothing), so the
 * list sums to the stored land value. rt null: [].
 */
export function landValueBreakdown(st: CityState, rt: EconRuntime | null, i: number): FactorTerm[] {
  if (!rt || !rt.lvStatic || rt.lvStatic.length !== st.cells || i < 0 || i >= st.cells) return [];
  if (st.water[i]) return [{ id: 'water', label: 'Water', value: st.landValue[i] }];
  const N = st.size, x = i % N, z = (i / N) | 0;
  const c = (bctx = lvCtx(st, rt, bctx));
  if (c.ex.histDirty) rebuildHistoric(st, c.ex);
  lvRow(c, z, x, x + 1, BR, BL);
  const raw = BR[0];
  const out: FactorTerm[] = [];
  for (let k = 0; k < NLV; k++) {
    const v = BL[k];
    if (v === 0 && k !== LV_BASE) continue;
    out.push({ id: LV_TERM_IDS[k], label: LV_TERM_LABELS[k], value: v, detail: lvDetail(k, st, c, i) });
  }
  const cl = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  if (cl !== raw) out.push({ id: 'clamp', label: raw > 1 ? 'Capped at 100%' : 'Floored at 0%', value: cl - raw });
  const stored = st.landValue[i];
  out.push({ id: 'smoothing', label: 'Neighbourhood blend & lag', value: stored - cl, detail: 'land value follows its neighbours and changes gradually' });
  return out;
}

function lvDetail(k: number, st: CityState, c: LvCtx, i: number): string | undefined {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  switch (k) {
    case LV_WATERFRONT: return st.waterPollution[i] > 0.05 ? `polluted water −${pct(LV_TERMS.waterfrontPollution * st.waterPollution[i])} of the bonus` : undefined;
    case LV_COMMUTE: return `${commuteMinutes(st, c.inf.traffic, i, c.ramp.avg).toFixed(0)} min (city average ${c.ramp.avg.toFixed(0)})`;
    case LV_GARBAGE: return c.gFade < 1 ? `counts ${pct(c.gFade)} (fades in from 2k to 20k residents)` : undefined;
    case LV_BUILDINGS: return 'parks and landmarks raise it, dumps and heavy utilities lower it';
    default: return undefined;
  }
}
