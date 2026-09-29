/**
 * Land value system → state.landValue (0..1), stats.avgLandValue (SIM_DEPTH_SPEC WP6).
 *  raw = base + view / elevation + waterfront × (1 − .8 water pollution) + plopped building splats (BuildingDef.landValue:
 *        parks, landmarks, dumps — functional buildings only, parks × parks funding; landfill zones)
 *        + police / fire / health / elementary / high / college coverage + play / green + transit + commute (city-relative)
 *        + neighbourhood wealth + prestige − stigma + tree cover − soil contamination + historic building
 *        − air / water / garbage (pile, faded in with town size) / crime / noise           (LV_TERMS, LV in tuning.ts)
 *  stored = temporal smoothing of the spatial 4-neighbour blend of clamp(raw, 0, 1).
 * lvTerms() is the one formula: the band sums it, landValueBreakdown lists it (+ clamp and smoothing terms, so the list
 * sums to the stored value). Time-sliced: a band of rows per day (full map every LV_REFRESH_DAYS).
 * Plopped splats are applied incrementally (EconRuntime's add / remove queue) with the factor each building had when it
 * was splatted; a Burnt / Abandoned flip (buildingChanged) or a parks-funding change re-splats the difference, so a
 * burnt landmark stops lifting its neighbourhood and an unfunded park lifts it less.
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
}
const extras = new WeakMap<EconRuntime, LvExtra>();
function extraOf(rt: EconRuntime, st: CityState): LvExtra {
  let e = extras.get(rt);
  if (!e || e.wf.length !== st.cells) {
    e = { wf: new Float32Array(st.cells), applied: new Map(), parksEff: 1 };
    extras.set(rt, e);
  }
  return e;
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

/** fill L[0..NLV) with the land value terms of cell i (x, z) — their sum is the raw (unclamped) land value */
function lvTerms(c: LvCtx, i: number, x: number, z: number, L: Float64Array): void {
  const st = c.st, rt = c.rt, K = LV_TERMS;
  L[LV_BASE] = LV.base;
  L[LV_VIEW] = rt.lvStatic[i];
  L[LV_WATERFRONT] = c.ex.wf[i] * (1 - K.waterfrontPollution * st.waterPollution[i]);
  const eff = lvEffectAt(rt, i);
  L[LV_BUILDINGS] = eff;
  if (c.inf.services) {
    L[LV_POLICE] = K.police * st.policeCov[i]; L[LV_FIRE] = K.fire * st.fireCov[i]; L[LV_HEALTH] = K.health * st.healthCov[i];
    L[LV_ELEM] = K.elem * st.eduElemCov[i]; L[LV_HIGH] = K.high * st.eduHighCov[i]; L[LV_COLLEGE] = K.college * st.eduCollegeCov[i];
    L[LV_PLAY] = K.play * st.playCov[i]; L[LV_GREEN] = K.green * st.greenCov[i];
    L[LV_TRANSIT] = K.transit * st.transitCov[i];
  } else {
    const f = COVERAGE_FALLBACK, park = Math.max(0, eff) * 2;
    L[LV_POLICE] = K.police * f; L[LV_FIRE] = K.fire * f; L[LV_HEALTH] = K.health * f;
    L[LV_ELEM] = K.elem * f; L[LV_HIGH] = K.high * f; L[LV_COLLEGE] = K.college * f;
    L[LV_PLAY] = K.play * park; L[LV_GREEN] = K.green * park;
    L[LV_TRANSIT] = 0;
  }
  const r = c.ramp;
  const score = 1 - smoothstep(r.good, r.bad, commuteMinutes(st, c.inf.traffic, i, r.avg));
  L[LV_COMMUTE] = K.commute * (score - 0.5);
  L[LV_WEALTH] = K.wealth * rt.coarseWealth[((z / COARSE) | 0) * rt.cw + ((x / COARSE) | 0)];
  L[LV_PRESTIGE] = K.prestige * st.prestige[i];
  L[LV_STIGMA] = -K.stigma * st.stigma[i];
  L[LV_TREES] = K.trees * st.treeCover[i];
  L[LV_SOIL] = -K.soil * st.soil[i];
  let hist = 0;
  const bid = st.building[i];
  if (bid >= 0) { const b = st.buildings.get(bid); if (b && b.flags & BF.Historic && !(b.flags & (BF.Burnt | BF.Abandoned))) hist = K.historic; }
  L[LV_HISTORIC] = hist;
  L[LV_AIR] = -LV.airPollution * st.airPollution[i];
  L[LV_WATERPOLL] = -LV.waterPollution * st.waterPollution[i];
  L[LV_GARBAGE] = -K.garbage * st.garbage[i] * c.gFade;
  L[LV_CRIME] = -LV.crime * st.crime[i];
  L[LV_NOISE] = -LV.noise * st.noise[i];
}

function sumTerms(L: Float64Array): number {
  let v = 0;
  for (let k = 0; k < NLV; k++) v += L[k];
  return v;
}

// ------------------------------------------------------------------------------------------------ system
export function landValueSystem(rt: EconRuntime): SimSystem {
  let row = 0;
  let sum = 0, cnt = 0, sumAll = 0, cntAll = 0;
  let lastStatic = -1e9, lastLandfill = -1e9;
  const L = new Float64Array(NLV);
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
  };
  const band = (st: CityState, z0: number, z1: number, first: boolean) => {
    const N = st.size;
    const lvArr = st.landValue;
    const c = (ctx = lvCtx(st, rt, ctx));
    for (let z = z0; z < z1; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        if (st.water[i]) { lvArr[i] = 0; continue; }
        lvTerms(c, i, x, z, L);
        let v = sumTerms(L);
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
        if (st.zone[i] !== Zone.None || st.building[i] >= 0) { sum += nv; cnt++; }
      }
    }
  };
  const publish = (st: CityState) => {
    st.stats.avgLandValue = cnt > 0 ? sum / cnt : cntAll > 0 ? sumAll / cntAll : 0;
    sum = cnt = sumAll = cntAll = 0;
  };
  return {
    name: 'economy.landValue',
    init(sim) {
      rt.attach(sim);
      if (sub !== sim) {
        unsub?.();
        unsub = sim.events.on('buildingChanged', (b) => { if (b.flags & BF.Plopped && getDef(b.def)?.landValue) changed.push(b); });
        sub = sim;
      }
      const st = sim.state;
      rt.terrainDirty = true;
      refresh(st, true);
      sum = cnt = sumAll = cntAll = 0;
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
  lvTerms(c, i, x, z, BL);
  const out: FactorTerm[] = [];
  let raw = 0;
  for (let k = 0; k < NLV; k++) {
    const v = BL[k];
    raw += v;
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
