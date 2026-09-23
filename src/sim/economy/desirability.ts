/**
 * Desirability per DevType per cell → state.desirability[dev][i] in [-1, 1].
 * Weighted sum of land value, pollution, crime, noise, commute, service coverage, parks, transit, traffic,
 * nearby customers, freight access, slope, taxes and ordinances (weights: tuning.ts DESIR_WEIGHTS).
 * Time-sliced: zoned / developed cells get the DevTypes of their zone every DESIR_REFRESH_DAYS;
 * unzoned land cells get all DevTypes every 4 sweeps (for the overlay and planning). Roads & water = -1.
 */
import type { SimSystem } from '../Simulation';
import type { CityState } from '../CityState';
import { clamp, smoothstep } from '../../core/rng';
import { DEV_TYPE_COUNT, Network, Zone } from '../../core/types';
import { ZONE_DEVTYPES, devFamily } from '../catalog';
import {
  COARSE, COMMUTE_BAD, COMMUTE_FALLBACK, COMMUTE_GOOD, COVERAGE_FALLBACK, DESIR_REFRESH_DAYS, DESIR_TAX, DESIR_WEIGHTS,
  FREIGHT_BLOCKS, POP_NEAR_FULL, SLOPE_P0, SLOPE_P1, TAX_NEUTRAL, TAX_SENS, TRAFFIC_BUSY,
} from './tuning';
import { type EconRuntime, infraFlags } from './runtime';
import { ordinanceEffect } from './ordinances';

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

/** road noise proxy used when the pollution system is absent */
const NET_NOISE = [0, 0.03, 0.08, 0.2, 0.1, 0.45, 0.2];
/** road "customer traffic" proxy used when the traffic system is absent */
const NET_TRAFFIC = [0, 0.2, 0.45, 0.65, 0.45, 0, 0];

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
  for (const b of rt.plopped) if (b.def === 'tr_freight_station' || b.def === 'tr_seaport' || b.def === 'tr_airport_large' || b.def === 'tr_airport_small') mark(b.x, b.z);
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

export function desirabilitySystem(rt: EconRuntime): SimSystem {
  let row = 0;
  let sweep = 0;
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
          for (let d = 0; d < DEV_TYPE_COUNT; d++) des[d][i] = -1;
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
          T[T_PARK] = Math.min(1, Math.max(0, rt.lvEffects[i]) * 3);
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
          for (let t = 1; t < NT; t++) s += WT[o + t] * T[t];
          des[d][i] = clamp(s, -1, 1);
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
      prepShift(st);
      band(st, 0, st.size, true);
      row = 0;
      sweep = 0;
    },
    daily(sim) {
      const t0 = performance.now();
      const st = sim.state;
      if (rt.networkDirty) { computeFreightAccess(st, rt); rt.networkDirty = false; }
      if (row === 0) prepShift(st);
      const N = st.size;
      const rows = Math.ceil(N / DESIR_REFRESH_DAYS);
      const z1 = Math.min(N, row + rows);
      band(st, row, z1, sweep % 4 === 0);
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
