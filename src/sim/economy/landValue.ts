/**
 * Land value system → state.landValue (0..1), stats.avgLandValue.
 * base + terrain (waterfront, view/elevation) + plopped effects (parks, landmarks, dumps: BuildingDef.landValue)
 * + services coverage + parks + commute accessibility + neighbourhood wealth − pollution − crime − noise.
 * Time-sliced: a band of rows per day (full map every LV_REFRESH_DAYS), smoothed spatially and temporally.
 */
import type { SimSystem } from '../Simulation';
import type { Building, CityState } from '../CityState';
import { clamp, smoothstep } from '../../core/rng';
import { Zone } from '../../core/types';
import { getDef } from '../catalog';
import { COARSE, COMMUTE_BAD, COMMUTE_FALLBACK, COMMUTE_GOOD, COVERAGE_FALLBACK, LV, LV_EFFECTS_MIN_DAYS, LV_REFRESH_DAYS, LV_STATIC_MIN_DAYS } from './tuning';
import { type EconRuntime, infraFlags } from './runtime';

/** static terrain component: waterfront + view/elevation */
export function computeStaticLandValue(st: CityState, out: Float32Array): void {
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
      if (st.water[i]) { out[i] = 0; continue; }
      const h = st.cellHeight(x, z);
      const wf = dist[i] >= LV.waterDist ? 0 : LV.waterfront * (1 - dist[i] / LV.waterDist) ** 1.5;
      const rel = h - mean[((z / COARSE) | 0) * cw + ((x / COARSE) | 0)];
      const view = LV.view * smoothstep(LV.viewH0, LV.viewH1, rel) + 0.04 * smoothstep(10, 90, h);
      out[i] = wf + view;
    }
  }
}

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

/** add (sign 1) or remove (sign -1) the BuildingDef.landValue splat of a plopped building */
export function splatBuilding(st: CityState, b: Building, sign: number, out: Float32Array): void {
  const lv = getDef(b.def)?.landValue;
  if (!lv) return;
  splat(st, out, b.x + b.w / 2, b.z + b.d / 2, sign * lv.amount, lv.radius + Math.max(b.w, b.d) / 2);
}

/** full rebuild of plopped-building land value effects (raw, unclamped) */
export function computeLandValueEffects(st: CityState, rt: EconRuntime, out: Float32Array): void {
  out.fill(0);
  for (const b of rt.plopped) if (st.buildings.has(b.id)) splatBuilding(st, b, 1, out);
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

export function landValueSystem(rt: EconRuntime): SimSystem {
  let row = 0;
  let sum = 0, cnt = 0, sumAll = 0, cntAll = 0;
  let lastStatic = -1e9, lastLandfill = -1e9;
  /**
   * full-map passes are throttled: terrain (lot leveling, terraform) at most every LV_STATIC_MIN_DAYS, landfill splats
   * every LV_EFFECTS_MIN_DAYS; plopped buildings are splatted incrementally (add / remove queue).
   */
  const refresh = (st: CityState, force: boolean) => {
    if (rt.terrainDirty && (force || st.day - lastStatic >= LV_STATIC_MIN_DAYS)) {
      computeStaticLandValue(st, rt.lvStatic);
      rt.terrainDirty = false;
      lastStatic = st.day;
    }
    if (rt.lvEffectsDirty || force) {
      computeLandValueEffects(st, rt, rt.lvEffects);
      rt.lvEffectsDirty = false;
      rt.lvQueue.length = 0;
    } else if (rt.lvQueue.length) {
      const q = rt.lvQueue;
      for (let k = 0; k < q.length; k += 2) splatBuilding(st, q[k] as Building, q[k + 1] as number, rt.lvEffects);
      q.length = 0;
    }
    if (rt.lvLandfillDirty && (force || st.day - lastLandfill >= LV_EFFECTS_MIN_DAYS)) {
      computeLandfillEffects(st, rt.lvLandfill);
      rt.lvLandfillDirty = false;
      lastLandfill = st.day;
    }
  };
  const band = (st: CityState, z0: number, z1: number, first: boolean) => {
    const N = st.size;
    const inf = infraFlags(st);
    const lvArr = st.landValue;
    const cw = rt.cw;
    const avgCommute = st.stats.avgCommute > 0 ? st.stats.avgCommute : COMMUTE_FALLBACK;
    for (let z = z0; z < z1; z++) {
      for (let x = 0; x < N; x++) {
        const i = z * N + x;
        if (st.water[i]) { lvArr[i] = 0; continue; }
        let services: number, park: number, transit: number;
        if (inf.services) {
          services = (st.policeCov[i] + st.fireCov[i] + st.healthCov[i] + st.eduCov[i]) * 0.25;
          park = st.parkCov[i];
          transit = st.transitCov[i];
        } else {
          services = COVERAGE_FALLBACK;
          park = Math.max(0, lvEffectAt(rt, i)) * 2;
          transit = 0;
        }
        const cm = inf.traffic && st.commute[i] > 0 ? st.commute[i] : avgCommute;
        const commuteScore = 1 - smoothstep(COMMUTE_GOOD, COMMUTE_BAD, cm);
        const wealth = rt.coarseWealth[((z / COARSE) | 0) * cw + ((x / COARSE) | 0)];
        let v = LV.base + rt.lvStatic[i] + lvEffectAt(rt, i)
          + LV.services * services + LV.parks * park + LV.transit * transit + LV.commute * (commuteScore - 0.5)
          + LV.wealth * wealth
          - LV.airPollution * st.airPollution[i] - LV.waterPollution * st.waterPollution[i] - LV.garbage * st.garbage[i]
          - LV.crime * st.crime[i] - LV.noise * st.noise[i];
        v = clamp(v, 0, 1);
        if (first) { lvArr[i] = v; continue; }
        // spatial blend with neighbours (their current values), then temporal smoothing
        let s = 0, c = 0;
        if (x > 0) { s += lvArr[i - 1]; c++; }
        if (x < N - 1) { s += lvArr[i + 1]; c++; }
        if (z > 0) { s += lvArr[i - N]; c++; }
        if (z < N - 1) { s += lvArr[i + N]; c++; }
        const sp = c ? v * (1 - LV.spatial) + (s / c) * LV.spatial : v;
        const nv = lvArr[i] + (sp - lvArr[i]) * LV.temporal;
        lvArr[i] = nv;
        sumAll += nv; cntAll++;
        if (st.zone[i] !== Zone.None || st.building[i] >= 0) { sum += nv; cnt++; }
      }
    }
  };
  return {
    name: 'economy.landValue',
    init(sim) {
      rt.attach(sim);
      const st = sim.state;
      refresh(st, true);
      band(st, 0, st.size, true);
      row = 0;
      sum = cnt = sumAll = cntAll = 0;
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
        st.stats.avgLandValue = cnt > 0 ? sum / cnt : cntAll > 0 ? sumAll / cntAll : 0;
        sum = cnt = sumAll = cntAll = 0;
        sim.events.emit('layerUpdated', 'landValue');
      }
      rt.timing.landValue = performance.now() - t0;
    },
  };
}
