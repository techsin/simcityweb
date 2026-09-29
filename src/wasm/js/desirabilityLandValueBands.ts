/**
 * Desirability + land-value bands — restructured JavaScript ("fair JS" A/B baseline of the WebAssembly port, and its
 * JS fallback).
 *
 * Same algorithm and BIT-IDENTICAL results as the per-day band closures of src/sim/economy/desirability.ts
 * (desirabilitySystem → band) and src/sim/economy/landValue.ts (landValueSystem → band) at commit 24f8609, with the
 * fixes a fair JS baseline needs, which are also the restructurings of the Rust port (wasm/sim-kernels/src/econ.rs),
 * so that an A/B against the wasm kernels measures the language / runtime and not the restructuring:
 *  1. the land-value accumulators (sum / cnt / sumAll / cntAll) are locals, written back once per band into a
 *     Float64Array (the original's closure-captured `let`s box a heap number on every store: ~0.26 MB of garbage/day);
 *  2. every st.* layer, rt.coarse* grid, rt.lv* array and inf.* flag is hoisted into a local before the loops;
 *  3. clamp, smoothstep, cellSlope and lvEffectAt are inlined;
 *  4. the Float32Array term vector T is a Float64Array holding Math.fround()ed values (exactly what the original stores
 *     and reads back), and each dev's non-zero weights are pre-converted to f64 in NZ order;
 *  5. per-zone dev lists are Int8Arrays; per dev, BIAS + shift is hoisted out of the cell loop (same f64 sum);
 *  6. land value: s / c with c = 4 is s · 0.25 (the same real quotient, so the same rounding) and the value stored at
 *     x − 1 is kept in a local instead of being read back from the layer.
 * Float semantics are the original's: f64 in the JS order, f32 exactly where the original stores into a Float32Array,
 * Math.min / Math.max with their NaN / ±0 behaviour, the accumulators add the unrounded value.
 *
 * Table-driven (so the WP6a term list can be re-expressed as data): weights WT f32[devs·nt], LVREF / BIAS f32[devs],
 * NZ lists, per-zone dev lists, NET_NOISE / NET_TRAFFIC and the tuning constants come from buildEconBandTables(); only
 * the term vector (which layer / formula gives term t, 17 terms at 24f8609) is code.
 *
 * This file imports nothing from src/sim: src/wasm/kernels/desirabilityLandValueBands.ts builds the tables from the
 * live tuning / catalog modules, the wasm binding (src/wasm/kernels/desirabilityLandValueBandsBind.ts) shares them.
 */

// ------------------------------------------------------------------------------------------------ inputs
/** the CityState fields the bands read / write (CityState satisfies it) */
export interface EconBandState {
  size: number;
  zone: Uint8Array;
  network: Uint8Array;
  water: Uint8Array;
  building: Int32Array;
  landValue: Float32Array;
  airPollution: Float32Array;
  waterPollution: Float32Array;
  garbage: Float32Array;
  crime: Float32Array;
  noise: Float32Array;
  traffic: Float32Array;
  commute: Float32Array;
  policeCov: Float32Array;
  fireCov: Float32Array;
  healthCov: Float32Array;
  eduCov: Float32Array;
  parkCov: Float32Array;
  transitCov: Float32Array;
  /** corner heights (N+1)² */
  heights: Float32Array;
  desirability: Float32Array[];
  stats: { avgCommute: number };
}

/** the EconRuntime fields the bands read (EconRuntime satisfies it) */
export interface EconBandRuntime {
  cw: number;
  coarsePop: Float32Array;
  coarseFreight: Float32Array;
  coarseWealth: Float32Array;
  lvStatic: Float32Array;
  lvEffects: Float32Array;
  lvLandfill: Float32Array;
}

/** infraFlags(st) subset */
export interface EconBandFlags {
  traffic: boolean;
  pollution: boolean;
  services: boolean;
}

/**
 * The two band kernels. `shift` = prepShift's per-dev shift (f32[devs]); `acc` = land-value accumulators
 * [sum, cnt, sumAll, cntAll], read and written back (the original keeps them in closure variables).
 */
export interface EconBandFns {
  desirability(st: EconBandState, rt: EconBandRuntime, inf: EconBandFlags, shift: Float32Array, z0: number, z1: number, allCells: boolean): void;
  landValue(st: EconBandState, rt: EconBandRuntime, inf: EconBandFlags, z0: number, z1: number, first: boolean, acc: Float64Array): void;
}

// ------------------------------------------------------------------------------------------------ tables
/** DESIR_WEIGHTS entry (tuning.ts DesirWeights) */
export interface DesirWeightsLike {
  bias: number; lv: number; lvRef: number; air: number; water: number; garbage: number; crime: number; noise: number;
  commute: number; police: number; fire: number; health: number; edu: number; park: number; transit: number;
  traffic: number; popNear: number; freight: number; slope: number;
}

/** LV (tuning.ts) fields used by the band */
export interface LandValueConstsLike {
  base: number; services: number; parks: number; transit: number; commute: number; wealth: number;
  airPollution: number; waterPollution: number; garbage: number; crime: number; noise: number; temporal: number; spatial: number;
}

/** everything the bands take from tuning.ts / catalog.ts / core/types.ts and the module-private tables */
export interface EconBandConstants {
  /** core/types DEV_TYPE_COUNT (12) */
  DEV_TYPE_COUNT: number;
  DESIR_WEIGHTS: readonly DesirWeightsLike[];
  /** catalog ZONE_DEVTYPES: dev list per zone code */
  ZONE_DEVTYPES: readonly (readonly number[])[];
  /** Zone.None / Zone.Landfill: the zones that count as unzoned land */
  zoneNone: number;
  zoneLandfill: number;
  /** desirability.ts NET_NOISE / NET_TRAFFIC (per Network code) */
  NET_NOISE: readonly number[];
  NET_TRAFFIC: readonly number[];
  /** the devs whose value -1 marks a cleared road / water cell (desirability.ts: des[0], des[11]) */
  chkA: number;
  chkB: number;
  COARSE: number;
  COMMUTE_GOOD: number;
  COMMUTE_BAD: number;
  COMMUTE_FALLBACK: number;
  COVERAGE_FALLBACK: number;
  TRAFFIC_BUSY: number;
  POP_NEAR_FULL: number;
  SLOPE_P0: number;
  SLOPE_P1: number;
  /** landValue.ts lvEffectAt clamp (-0.7, 0.6) */
  LV_EFFECT_MIN: number;
  LV_EFFECT_MAX: number;
  LV: LandValueConstsLike;
}

// term indices of the 24f8609 term vector (desirability.ts)
export const T_LV = 0, T_AIR = 1, T_WATER = 2, T_GARB = 3, T_CRIME = 4, T_NOISE = 5, T_COMMUTE = 6, T_POLICE = 7, T_FIRE = 8,
  T_HEALTH = 9, T_EDU = 10, T_PARK = 11, T_TRANSIT = 12, T_TRAFFIC = 13, T_POP = 14, T_FREIGHT = 15, T_SLOPE = 16;
/** number of terms of the 24f8609 term vector */
export const ECON_NT = 17;
/** codes (u8) covered by the network / zone tables */
export const ECON_CODES = 256;

export interface EconBandTables {
  readonly consts: EconBandConstants;
  readonly nt: number;
  readonly devs: number;
  /** [dev·nt + term] (desirability.ts WT) */
  readonly WT: Float32Array;
  readonly LVREF: Float32Array;
  readonly BIAS: Float32Array;
  /** per dev: terms 1..nt-1 with a non-zero weight, ascending (desirability.ts NZ) */
  readonly NZ: readonly Int8Array[];
  /** per dev: WT of its NZ terms, as f64 */
  readonly NZW: readonly Float64Array[];
  /** per zone code 0..255: its dev list (zoned), null (None / Landfill: unzoned) or undefined (not a zone: the original throws) */
  readonly zoneDevs: readonly (Int8Array | null | undefined)[];
  readonly allDevs: Int8Array;
  /** per network code 0..255; codes the original tables lack hold -Infinity (`undefined > x` is false in JS) */
  readonly netNoise: Float64Array;
  readonly netTraffic: Float64Array;
}

/**
 * Tables of the 24f8609 bands from the tuning constants, built exactly like desirability.ts builds WT / LVREF / BIAS /
 * NZ (Float32Array stores, `!== 0` on the stored weights).
 */
export function buildEconBandTables(c: EconBandConstants): EconBandTables {
  const devs = c.DEV_TYPE_COUNT;
  const nt = ECON_NT;
  const WT = new Float32Array(devs * nt);
  const LVREF = new Float32Array(devs);
  const BIAS = new Float32Array(devs);
  for (let d = 0; d < devs; d++) {
    const w = c.DESIR_WEIGHTS[d];
    const o = d * nt;
    WT[o + T_LV] = w.lv; WT[o + T_AIR] = w.air; WT[o + T_WATER] = w.water; WT[o + T_GARB] = w.garbage; WT[o + T_CRIME] = w.crime;
    WT[o + T_NOISE] = w.noise; WT[o + T_COMMUTE] = w.commute; WT[o + T_POLICE] = w.police; WT[o + T_FIRE] = w.fire;
    WT[o + T_HEALTH] = w.health; WT[o + T_EDU] = w.edu; WT[o + T_PARK] = w.park; WT[o + T_TRANSIT] = w.transit;
    WT[o + T_TRAFFIC] = w.traffic; WT[o + T_POP] = w.popNear; WT[o + T_FREIGHT] = w.freight; WT[o + T_SLOPE] = w.slope;
    LVREF[d] = w.lvRef;
    BIAS[d] = w.bias;
  }
  const NZ: Int8Array[] = [];
  const NZW: Float64Array[] = [];
  for (let d = 0; d < devs; d++) {
    const out: number[] = [];
    for (let t = 1; t < nt; t++) if (WT[d * nt + t] !== 0) out.push(t);
    NZ.push(Int8Array.from(out));
    NZW.push(Float64Array.from(out, (t) => WT[d * nt + t]));
  }
  const zoneDevs: (Int8Array | null | undefined)[] = new Array(ECON_CODES).fill(undefined);
  for (let z = 0; z < ECON_CODES; z++) {
    if (z === c.zoneNone || z === c.zoneLandfill) zoneDevs[z] = null;
    else if (z < c.ZONE_DEVTYPES.length) zoneDevs[z] = Int8Array.from(c.ZONE_DEVTYPES[z]);
  }
  const netNoise = new Float64Array(ECON_CODES).fill(-Infinity);
  const netTraffic = new Float64Array(ECON_CODES).fill(-Infinity);
  for (let k = 0; k < Math.min(ECON_CODES, c.NET_NOISE.length); k++) netNoise[k] = c.NET_NOISE[k];
  for (let k = 0; k < Math.min(ECON_CODES, c.NET_TRAFFIC.length); k++) netTraffic[k] = c.NET_TRAFFIC[k];
  return {
    consts: c, nt, devs, WT, LVREF, BIAS, NZ, NZW, zoneDevs, allDevs: Int8Array.from({ length: devs }, (_, i) => i), netNoise, netTraffic,
  };
}

// ------------------------------------------------------------------------------------------------ desirability
/**
 * desirabilitySystem → band(st, z0, z1, allCells) of 24f8609, restructured (see the file header); bit-identical.
 * A zone code that is not a zone throws the original's TypeError at the same cell (earlier cells are written).
 */
export function makeDesirabilityBandJs(tb: EconBandTables): EconBandFns['desirability'] {
  const C = tb.consts;
  const devs = tb.devs;
  const T = new Float64Array(tb.nt);
  const bs = new Float64Array(devs);
  const WLV = new Float64Array(devs);
  const LVREF64 = new Float64Array(devs);
  for (let d = 0; d < devs; d++) {
    WLV[d] = tb.WT[d * tb.nt + T_LV];
    LVREF64[d] = tb.LVREF[d];
  }
  const NZ = tb.NZ, NZW = tb.NZW, zoneDevs = tb.zoneDevs, allDevs = tb.allDevs, netNoise = tb.netNoise, netTraffic = tb.netTraffic;
  const COARSE = C.COARSE, GOOD = C.COMMUTE_GOOD, BAD = C.COMMUTE_BAD, FALLBACK = C.COMMUTE_FALLBACK;
  const COV = Math.fround(C.COVERAGE_FALLBACK), BUSY = C.TRAFFIC_BUSY, POPFULL = C.POP_NEAR_FULL, SP0 = C.SLOPE_P0, SP1 = C.SLOPE_P1;
  const EMIN = C.LV_EFFECT_MIN, EMAX = C.LV_EFFECT_MAX;
  const chkA = C.chkA, chkB = C.chkB;

  return function desirabilityBand(st, rt, inf, shift, z0, z1, allCells) {
    const N = st.size, cw = rt.cw;
    const des = st.desirability;
    const desA = des[chkA], desB = des[chkB];
    const avgCommute = st.stats.avgCommute > 0 ? st.stats.avgCommute : FALLBACK;
    const zone = st.zone, net = st.network, water = st.water;
    const lvA = st.landValue, air = st.airPollution, wpol = st.waterPollution, garb = st.garbage, crime = st.crime, noise = st.noise;
    const traffic = st.traffic, commute = st.commute;
    const police = st.policeCov, fire = st.fireCov, health = st.healthCov, edu = st.eduCov, park = st.parkCov, transit = st.transitCov;
    const heights = st.heights;
    const cpop = rt.coarsePop, cfreight = rt.coarseFreight, lvEff = rt.lvEffects, lvFill = rt.lvLandfill;
    const infTraffic = inf.traffic, infPollution = inf.pollution, infServices = inf.services;
    for (let d = 0; d < devs; d++) bs[d] = tb.BIAS[d] + shift[d];
    const N1 = N + 1;
    for (let z = z0; z < z1; z++) {
      const bz = ((z / COARSE) | 0) * cw;
      const r = z * N;
      const h0 = z * N1;
      for (let x = 0; x < N; x++) {
        const i = r + x;
        if (water[i] || net[i] !== 0) {
          if (desA[i] !== -1 || desB[i] !== -1) for (let d = 0; d < devs; d++) des[d][i] = -1;
          continue;
        }
        let list = zoneDevs[zone[i]];
        if (list === null) {
          if (!allCells) continue;
          list = allDevs;
        }
        // ---- terms (Math.fround = the original's Float32Array T store)
        T[T_LV] = lvA[i];
        T[T_AIR] = air[i];
        T[T_WATER] = wpol[i];
        T[T_GARB] = garb[i];
        T[T_CRIME] = crime[i];
        let nNoise = 0, nTraffic = 0, vol = 0;
        if (x > 0) {
          const k = net[i - 1];
          const a = netNoise[k]; if (a > nNoise) nNoise = a;
          const b = netTraffic[k]; if (b > nTraffic) nTraffic = b;
          const v = traffic[i - 1]; if (v > vol) vol = v;
        }
        if (x < N - 1) {
          const k = net[i + 1];
          const a = netNoise[k]; if (a > nNoise) nNoise = a;
          const b = netTraffic[k]; if (b > nTraffic) nTraffic = b;
          const v = traffic[i + 1]; if (v > vol) vol = v;
        }
        if (z > 0) {
          const k = net[i - N];
          const a = netNoise[k]; if (a > nNoise) nNoise = a;
          const b = netTraffic[k]; if (b > nTraffic) nTraffic = b;
          const v = traffic[i - N]; if (v > vol) vol = v;
        }
        if (z < N - 1) {
          const k = net[i + N];
          const a = netNoise[k]; if (a > nNoise) nNoise = a;
          const b = netTraffic[k]; if (b > nTraffic) nTraffic = b;
          const v = traffic[i + N]; if (v > vol) vol = v;
        }
        T[T_NOISE] = infPollution ? noise[i] : Math.fround(nNoise);
        T[T_TRAFFIC] = infTraffic ? Math.fround(Math.min(1, vol / BUSY)) : Math.fround(nTraffic);
        const cmi = commute[i];
        const cm = infTraffic && cmi > 0 ? cmi : avgCommute;
        let tc = (cm - GOOD) / (BAD - GOOD);
        tc = tc < 0 ? 0 : tc > 1 ? 1 : tc;
        T[T_COMMUTE] = Math.fround(0.5 - tc * tc * (3 - 2 * tc));
        if (infServices) {
          T[T_POLICE] = police[i]; T[T_FIRE] = fire[i]; T[T_HEALTH] = health[i]; T[T_EDU] = edu[i];
          T[T_PARK] = park[i]; T[T_TRANSIT] = transit[i];
        } else {
          T[T_POLICE] = COV; T[T_FIRE] = COV; T[T_HEALTH] = COV; T[T_EDU] = COV;
          const e = lvEff[i] + lvFill[i];
          T[T_PARK] = Math.fround(Math.min(1, Math.max(0, e < EMIN ? EMIN : e > EMAX ? EMAX : e) * 3));
          T[T_TRANSIT] = 0;
        }
        const blk = bz + ((x / COARSE) | 0);
        T[T_POP] = Math.fround(Math.min(1, cpop[blk] / POPFULL));
        T[T_FREIGHT] = cfreight[blk];
        const hi = h0 + x;
        const ha = heights[hi], hb = heights[hi + 1], hc = heights[hi + N1], hd = heights[hi + N1 + 1];
        let ts = (Math.max(ha, hb, hc, hd) - Math.min(ha, hb, hc, hd) - SP0) / (SP1 - SP0);
        ts = ts < 0 ? 0 : ts > 1 ? 1 : ts;
        T[T_SLOPE] = Math.fround(ts * ts * (3 - 2 * ts));
        // ---- per dev, in list order
        const tlv = T[T_LV];
        for (let k = 0; k < list!.length; k++) {
          const d = list![k];
          let s = bs[d] + WLV[d] * (tlv - LVREF64[d]);
          const nz = NZ[d], nw = NZW[d];
          for (let q = 0; q < nz.length; q++) s += nw[q] * T[nz[q]];
          des[d][i] = s < -1 ? -1 : s > 1 ? 1 : s;
        }
      }
    }
  };
}

// ------------------------------------------------------------------------------------------------ land value
/** landValueSystem → band(st, z0, z1, first) of 24f8609, restructured (see the file header); bit-identical, in place */
export function makeLandValueBandJs(tb: EconBandTables): EconBandFns['landValue'] {
  const C = tb.consts, L = C.LV;
  const COARSE = C.COARSE, GOOD = C.COMMUTE_GOOD, BAD = C.COMMUTE_BAD, FALLBACK = C.COMMUTE_FALLBACK, COV = C.COVERAGE_FALLBACK;
  const EMIN = C.LV_EFFECT_MIN, EMAX = C.LV_EFFECT_MAX;
  const K_BASE = L.base, K_SERV = L.services, K_PARKS = L.parks, K_TRANSIT = L.transit, K_COMMUTE = L.commute, K_WEALTH = L.wealth;
  const K_AIR = L.airPollution, K_WPOL = L.waterPollution, K_GARB = L.garbage, K_CRIME = L.crime, K_NOISE = L.noise;
  const TEMPORAL = L.temporal, SPATIAL = L.spatial, KEEP = 1 - L.spatial;
  const zoneNone = C.zoneNone;

  return function landValueBand(st, rt, inf, z0, z1, first, acc) {
    const N = st.size, cw = rt.cw;
    const avgCommute = st.stats.avgCommute > 0 ? st.stats.avgCommute : FALLBACK;
    const lvArr = st.landValue, zone = st.zone, water = st.water, building = st.building;
    const air = st.airPollution, wpol = st.waterPollution, garb = st.garbage, crime = st.crime, noise = st.noise, commute = st.commute;
    const police = st.policeCov, fire = st.fireCov, health = st.healthCov, edu = st.eduCov, park = st.parkCov, transit = st.transitCov;
    const lvStatic = rt.lvStatic, lvEff = rt.lvEffects, lvFill = rt.lvLandfill, cwealth = rt.coarseWealth;
    const infTraffic = inf.traffic, infServices = inf.services;
    let sum = acc[0], cnt = acc[1], sumAll = acc[2], cntAll = acc[3];
    for (let z = z0; z < z1; z++) {
      const bz = ((z / COARSE) | 0) * cw;
      const r = z * N;
      let left = 0;
      for (let x = 0; x < N; x++) {
        const i = r + x;
        if (water[i]) { lvArr[i] = 0; left = 0; continue; }
        let services: number, prk: number, trn: number;
        const e0 = lvEff[i] + lvFill[i];
        const eff = e0 < EMIN ? EMIN : e0 > EMAX ? EMAX : e0;
        if (infServices) {
          services = (police[i] + fire[i] + health[i] + edu[i]) * 0.25;
          prk = park[i];
          trn = transit[i];
        } else {
          services = COV;
          prk = Math.max(0, eff) * 2;
          trn = 0;
        }
        const cmi = commute[i];
        const cm = infTraffic && cmi > 0 ? cmi : avgCommute;
        let tc = (cm - GOOD) / (BAD - GOOD);
        tc = tc < 0 ? 0 : tc > 1 ? 1 : tc;
        const score = 1 - tc * tc * (3 - 2 * tc);
        const wealth = cwealth[bz + ((x / COARSE) | 0)];
        let v = K_BASE + lvStatic[i] + eff
          + K_SERV * services + K_PARKS * prk + K_TRANSIT * trn + K_COMMUTE * (score - 0.5)
          + K_WEALTH * wealth
          - K_AIR * air[i] - K_WPOL * wpol[i] - K_GARB * garb[i]
          - K_CRIME * crime[i] - K_NOISE * noise[i];
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        if (first) { left = Math.fround(v); lvArr[i] = left; continue; }
        let s = 0, c = 0;
        if (x > 0) { s += left; c++; }
        if (x < N - 1) { s += lvArr[i + 1]; c++; }
        if (z > 0) { s += lvArr[i - N]; c++; }
        if (z < N - 1) { s += lvArr[i + N]; c++; }
        const sp = c ? v * KEEP + (c === 4 ? s * 0.25 : s / c) * SPATIAL : v;
        const old = lvArr[i];
        const nv = old + (sp - old) * TEMPORAL;
        left = Math.fround(nv);
        lvArr[i] = left;
        sumAll += nv; cntAll++;
        if (zone[i] !== zoneNone || building[i] >= 0) { sum += nv; cnt++; }
      }
    }
    acc[0] = sum; acc[1] = cnt; acc[2] = sumAll; acc[3] = cntAll;
  };
}

/** both restructured JS bands over one set of tables */
export function makeEconBandsJs(tb: EconBandTables): EconBandFns {
  return { desirability: makeDesirabilityBandJs(tb), landValue: makeLandValueBandJs(tb) };
}
