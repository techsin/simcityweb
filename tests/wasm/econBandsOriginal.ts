/**
 * FROZEN REFERENCE ("JS as-is" arm of the desirability / land-value band A/B): the band closures of
 * src/sim/economy/desirability.ts (desirabilitySystem → prepShift, band) and src/sim/economy/landValue.ts
 * (landValueSystem → band, lvEffectAt) VERBATIM as of commit 24f8609, lifted into a factory so tests and benchmarks can
 * call them directly (in the live system they are closures that cannot be reached from outside). Module-level tables,
 * the closure-captured Float32Array T / shift and the closure-captured land-value accumulators are kept exactly as in
 * the original, so this copy has the original's performance characteristics too (boxed-double stores included).
 * WP6a rewrites both files; this copy stays the 24f8609 reference the WebAssembly port (wasm/sim-kernels/src/econ.rs)
 * is checked against.
 */
import type { CityState } from '../../src/sim/CityState';
import { clamp, smoothstep } from '../../src/core/rng';
import { DEV_TYPE_COUNT, Network, Zone } from '../../src/core/types';
import { ZONE_DEVTYPES, devFamily } from '../../src/sim/catalog';
import {
  COARSE, COMMUTE_BAD, COMMUTE_FALLBACK, COMMUTE_GOOD, COVERAGE_FALLBACK, DESIR_TAX, DESIR_WEIGHTS, LV, POP_NEAR_FULL, SLOPE_P0,
  SLOPE_P1, TAX_NEUTRAL, TAX_SENS, TRAFFIC_BUSY,
} from '../../src/sim/economy/tuning';
import { type EconRuntime, infraFlags } from '../../src/sim/economy/runtime';
import { ordinanceEffect } from '../../src/sim/economy/ordinances';

// ------------------------------------------------------------------------------------------------ desirability.ts
// term indices
const T_LV = 0, T_AIR = 1, T_WATER = 2, T_GARB = 3, T_CRIME = 4, T_NOISE = 5, T_COMMUTE = 6, T_POLICE = 7, T_FIRE = 8,
  T_HEALTH = 9, T_EDU = 10, T_PARK = 11, T_TRANSIT = 12, T_TRAFFIC = 13, T_POP = 14, T_FREIGHT = 15, T_SLOPE = 16;
const NT = 17;
const DEV_ENUM = ['R1', 'R2', 'R3', 'CS1', 'CS2', 'CS3', 'CO2', 'CO3', 'IA', 'ID', 'IM', 'IHT'];

/** flattened weights [dev * NT + term] and per-dev constants */
const WT = new Float32Array(DEV_TYPE_COUNT * NT);
const LVREF = new Float32Array(DEV_TYPE_COUNT);
const BIAS = new Float32Array(DEV_TYPE_COUNT);
for (let d = 0; d < DEV_TYPE_COUNT; d++) {
  const w = DESIR_WEIGHTS[d];
  const o = d * NT;
  WT[o + T_LV] = w.lv; WT[o + T_AIR] = w.air; WT[o + T_WATER] = w.water; WT[o + T_GARB] = w.garbage; WT[o + T_CRIME] = w.crime;
  WT[o + T_NOISE] = w.noise; WT[o + T_COMMUTE] = w.commute; WT[o + T_POLICE] = w.police; WT[o + T_FIRE] = w.fire;
  WT[o + T_HEALTH] = w.health; WT[o + T_EDU] = w.edu; WT[o + T_PARK] = w.park; WT[o + T_TRANSIT] = w.transit;
  WT[o + T_TRAFFIC] = w.traffic; WT[o + T_POP] = w.popNear; WT[o + T_FREIGHT] = w.freight; WT[o + T_SLOPE] = w.slope;
  LVREF[d] = w.lvRef;
  BIAS[d] = w.bias;
}
const ALL_DEVS: readonly number[] = Array.from({ length: DEV_TYPE_COUNT }, (_, i) => i);
/** per dev: indices (1..NT-1) of non-zero weights, so the inner loop skips zero terms */
const NZ: Int8Array[] = Array.from({ length: DEV_TYPE_COUNT }, (_, d) => {
  const out: number[] = [];
  for (let t = 1; t < NT; t++) if (WT[d * NT + t] !== 0) out.push(t);
  return Int8Array.from(out);
});

/** road noise proxy used when the pollution system is absent */
const NET_NOISE = [0, 0.03, 0.08, 0.2, 0.1, 0.45, 0.2];
/** road "customer traffic" proxy used when the traffic system is absent */
const NET_TRAFFIC = [0, 0.2, 0.45, 0.65, 0.45, 0, 0];

// ------------------------------------------------------------------------------------------------ landValue.ts
/** clamped total land value effect at cell i */
export function lvEffectAt(rt: EconRuntime, i: number): number {
  const v = rt.lvEffects[i] + rt.lvLandfill[i];
  return v < -0.7 ? -0.7 : v > 0.6 ? 0.6 : v;
}

export interface OriginalBands {
  /** desirabilitySystem's closure Float32Array (prepShift writes it; tests may set it directly) */
  readonly shift: Float32Array;
  prepShift(st: CityState): void;
  desirability(st: CityState, z0: number, z1: number, allCells: boolean): void;
  landValue(st: CityState, z0: number, z1: number, first: boolean): void;
  /** the land-value closure accumulators [sum, cnt, sumAll, cntAll] */
  acc(): [number, number, number, number];
  setAcc(sum: number, cnt: number, sumAll: number, cntAll: number): void;
}

/** the 24f8609 band closures over one EconRuntime (one factory call = one system instance's closures) */
export function makeOriginalBands(rt: EconRuntime): OriginalBands {
  // ---------------------------------------------------------------- desirabilitySystem(rt) closure
  const T = new Float32Array(NT);
  const shift = new Float32Array(DEV_TYPE_COUNT);

  const prepShift = (st: CityState) => {
    const rates = st.budget.taxRates;
    for (let d = 0; d < DEV_TYPE_COUNT; d++) {
      const fam = devFamily(d);
      shift[d] = -DESIR_TAX * TAX_SENS[d] * (rates[d] - TAX_NEUTRAL)
        + ordinanceEffect(st, 'add.desir.' + DEV_ENUM[d]) + ordinanceEffect(st, 'add.desir.' + fam);
    }
  };

  const band = (st: CityState, z0: number, z1: number, allCells: boolean) => {
    const N = st.size, cw = rt.cw;
    const inf = infraFlags(st);
    const des = st.desirability;
    const avgCommute = st.stats.avgCommute > 0 ? st.stats.avgCommute : COMMUTE_FALLBACK;
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
        if (zone !== Zone.None && zone !== Zone.Landfill) devs = ZONE_DEVTYPES[zone];
        else if (st.building[i] >= 0 && !allCells) continue;
        else if (allCells) devs = ALL_DEVS;
        else continue;
        // ---- terms
        T[T_LV] = st.landValue[i];
        T[T_AIR] = st.airPollution[i];
        T[T_WATER] = st.waterPollution[i];
        T[T_GARB] = st.garbage[i];
        T[T_CRIME] = st.crime[i];
        // neighbour roads: noise proxy / traffic
        let nNoise = 0, nTraffic = 0, trafficVol = 0;
        if (x > 0) { const k = net[i - 1]; if (NET_NOISE[k] > nNoise) nNoise = NET_NOISE[k]; if (NET_TRAFFIC[k] > nTraffic) nTraffic = NET_TRAFFIC[k]; if (st.traffic[i - 1] > trafficVol) trafficVol = st.traffic[i - 1]; }
        if (x < N - 1) { const k = net[i + 1]; if (NET_NOISE[k] > nNoise) nNoise = NET_NOISE[k]; if (NET_TRAFFIC[k] > nTraffic) nTraffic = NET_TRAFFIC[k]; if (st.traffic[i + 1] > trafficVol) trafficVol = st.traffic[i + 1]; }
        if (z > 0) { const k = net[i - N]; if (NET_NOISE[k] > nNoise) nNoise = NET_NOISE[k]; if (NET_TRAFFIC[k] > nTraffic) nTraffic = NET_TRAFFIC[k]; if (st.traffic[i - N] > trafficVol) trafficVol = st.traffic[i - N]; }
        if (z < N - 1) { const k = net[i + N]; if (NET_NOISE[k] > nNoise) nNoise = NET_NOISE[k]; if (NET_TRAFFIC[k] > nTraffic) nTraffic = NET_TRAFFIC[k]; if (st.traffic[i + N] > trafficVol) trafficVol = st.traffic[i + N]; }
        T[T_NOISE] = inf.pollution ? st.noise[i] : nNoise;
        T[T_TRAFFIC] = inf.traffic ? Math.min(1, trafficVol / TRAFFIC_BUSY) : nTraffic;
        const cm = inf.traffic && st.commute[i] > 0 ? st.commute[i] : avgCommute;
        T[T_COMMUTE] = 0.5 - smoothstep(COMMUTE_GOOD, COMMUTE_BAD, cm);
        if (inf.services) {
          T[T_POLICE] = st.policeCov[i]; T[T_FIRE] = st.fireCov[i]; T[T_HEALTH] = st.healthCov[i]; T[T_EDU] = st.eduCov[i];
          T[T_PARK] = st.parkCov[i]; T[T_TRANSIT] = st.transitCov[i];
        } else {
          T[T_POLICE] = T[T_FIRE] = T[T_HEALTH] = T[T_EDU] = COVERAGE_FALLBACK;
          T[T_PARK] = Math.min(1, Math.max(0, lvEffectAt(rt, i)) * 3);
          T[T_TRANSIT] = 0;
        }
        const blk = ((z / COARSE) | 0) * cw + ((x / COARSE) | 0);
        T[T_POP] = Math.min(1, rt.coarsePop[blk] / POP_NEAR_FULL);
        T[T_FREIGHT] = rt.coarseFreight[blk];
        T[T_SLOPE] = smoothstep(SLOPE_P0, SLOPE_P1, st.cellSlope(x, z));
        // ---- per dev
        for (let k = 0; k < devs.length; k++) {
          const d = devs[k];
          const o = d * NT;
          let s = BIAS[d] + shift[d] + WT[o] * (T[T_LV] - LVREF[d]);
          const nz = NZ[d];
          for (let q = 0; q < nz.length; q++) { const t = nz[q]; s += WT[o + t] * T[t]; }
          des[d][i] = clamp(s, -1, 1);
        }
      }
    }
  };

  // ---------------------------------------------------------------- landValueSystem(rt) closure
  let sum = 0, cnt = 0, sumAll = 0, cntAll = 0;
  const lvBand = (st: CityState, z0: number, z1: number, first: boolean) => {
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
    shift,
    prepShift,
    desirability: band,
    landValue: lvBand,
    acc: () => [sum, cnt, sumAll, cntAll],
    setAcc(a, b, c, d) { sum = a; cnt = b; sumAll = c; cntAll = d; },
  };
}
