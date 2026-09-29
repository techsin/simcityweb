/**
 * WebAssembly bindings of the desirability / land-value band kernels (wasm/sim-kernels/src/econ.rs), built around a JS
 * implementation: makeEconBandKernels(tables, js) returns the same EconBandFns (same signatures, bit-identical results)
 * running the Rust kernels when the 'econ' kernel slot is active and the arguments are in the supported domain, and
 * `js` otherwise (in practice the restructured JS of src/wasm/js/desirabilityLandValueBands.ts).
 *
 * Memory: every layer argument is either RESIDENT (it lives in the kernels' WebAssembly.Memory, e.g. CityState layers
 * moved there with adoptLayers(): its own offset is passed, zero copy) or STAGED (a plain typed array: copied into a
 * full-size scratch block, but only the rows the band reads, and the rows it writes are copied back). Mixed calls are
 * fine. Staged traffic per 256² band (22 rows): desirability ≈ 0.64 MB in + 0.27 MB out, land value ≈ 0.40 MB in +
 * 0.02 MB out (`stats` counts the bytes).
 *
 * Domain (anything else runs `js`): integer N in 1..32767, integer 0 <= z0 <= z1 <= N, rt.cw === ceil(N / COARSE),
 * layers of the expected typed-array types and lengths, outputs (des layers / landValue) not overlapping any other
 * argument. A zone code that is not a zone makes the kernel stop before that cell (return 1): the band then reruns in
 * JS, which rewrites the finished cells with the same values and throws the original's TypeError at that cell.
 *
 * This file does not import src/sim (src/wasm/kernels/desirabilityLandValueBands.ts binds the live tables), so tests and
 * benchmarks can swap it into the systems without an import cycle.
 */
import { kernelSlot, simWasmCallFailed } from '../simWasm';
import { scratchSlot, type WasmHeap } from '../heap';
import { gridOk, overlaps } from '../bind';
import {
  ECON_CODES, ECON_NT, type EconBandFlags, type EconBandFns, type EconBandRuntime, type EconBandState, type EconBandTables,
} from '../js/desirabilityLandValueBands';

/** parameter-block layout version (econ.rs LAYOUT) */
export const ECON_LAYOUT = 1;
/** dev capacity of the kernels (econ.rs DEV_MAX) */
export const ECON_DEV_MAX = 16;

export interface EconExports {
  memory: WebAssembly.Memory;
  econ_layout(): number;
  econ_desirability_band(ip: number, fp: number): number;
  econ_land_value_band(ip: number, fp: number): number;
}

export const ECON_KERNEL = kernelSlot('econ', ['econ_layout', 'econ_desirability_band', 'econ_land_value_band']);

/** an explicit kernel instance (benchmarks: scalar / SIMD builds); default: the loader's instance */
export interface EconWasm {
  ex: EconExports;
  heap: WasmHeap;
}

/** per-binding counters (benchmarks) */
export interface EconBindStats {
  wasmCalls: number;
  jsCalls: number;
  /** bytes copied into / out of wasm memory by staging */
  bytesIn: number;
  bytesOut: number;
}

// ------------------------------------------------------------------------------------------------ econ.rs ix / fx
const I_N = 0, I_CW = 1, I_COARSE = 2, I_Z0 = 3, I_Z1 = 4, I_FLAGS = 5, I_NTERMS = 6, I_DEVS = 7;
const I_ZONE = 8, I_NET = 9, I_WATER = 10, I_BUILDING = 11, I_LV = 12, I_AIR = 13, I_WPOL = 14, I_GARB = 15, I_CRIME = 16,
  I_NOISE = 17, I_TRAFFIC = 18, I_COMMUTE = 19, I_POLICE = 20, I_FIRE = 21, I_HEALTH = 22, I_EDU = 23, I_PARK = 24,
  I_TRANSIT = 25, I_HEIGHTS = 26, I_CPOP = 27, I_CFREIGHT = 28, I_CWEALTH = 29, I_LVSTATIC = 30, I_LVEFF = 31,
  I_LVLANDFILL = 32, I_SHIFT = 33, I_WT = 34, I_LVREF = 35, I_BIAS = 36, I_NZ = 37, I_NZ_LEN = 38, I_ZKIND = 39,
  I_ZDEV = 40, I_ZLEN = 41, I_NET_NOISE = 42, I_NET_TRAFFIC = 43, I_CHK_A = 44, I_CHK_B = 45, I_DES = 48;
const IP_LEN = I_DES + ECON_DEV_MAX;
const F_AVG_COMMUTE = 0, F_COMMUTE_GOOD = 1, F_COMMUTE_BAD = 2, F_COVERAGE_FALLBACK = 3, F_TRAFFIC_BUSY = 4,
  F_POP_NEAR_FULL = 5, F_SLOPE_P0 = 6, F_SLOPE_P1 = 7, F_EFF_MIN = 8, F_EFF_MAX = 9, F_LV_BASE = 10, F_ACC = 24;
const FP_LEN = 28;
const FL_TRAFFIC = 1, FL_POLLUTION = 2, FL_SERVICES = 4, FL_ALL = 8;

// staging / scratch slots of this module
const S_IP = scratchSlot(), S_FP = scratchSlot(), S_SHIFT = scratchSlot();
const S_ZONE = scratchSlot(), S_NET = scratchSlot(), S_WATER = scratchSlot(), S_BUILDING = scratchSlot(), S_LV = scratchSlot(),
  S_AIR = scratchSlot(), S_WPOL = scratchSlot(), S_GARB = scratchSlot(), S_CRIME = scratchSlot(), S_NOISE = scratchSlot(),
  S_TRAFFIC = scratchSlot(), S_COMMUTE = scratchSlot(), S_POLICE = scratchSlot(), S_FIRE = scratchSlot(), S_HEALTH = scratchSlot(),
  S_EDU = scratchSlot(), S_PARK = scratchSlot(), S_TRANSIT = scratchSlot(), S_HEIGHTS = scratchSlot(), S_CPOP = scratchSlot(),
  S_CFREIGHT = scratchSlot(), S_CWEALTH = scratchSlot(), S_LVSTATIC = scratchSlot(), S_LVEFF = scratchSlot(), S_LVFILL = scratchSlot();
const S_DES: number[] = Array.from({ length: ECON_DEV_MAX }, () => scratchSlot());

type Layer = Uint8Array | Int32Array | Float32Array;
const isInt = (v: number): boolean => v === (v | 0);

/** the binary's parameter-block layout matches these bindings (checked once per instance; a stale binary runs JS) */
const layouts = new WeakMap<object, boolean>();
function layoutOk(ex: EconExports): boolean {
  let ok = layouts.get(ex);
  if (ok === undefined) {
    ok = typeof ex.econ_layout === 'function' && ex.econ_layout() === ECON_LAYOUT;
    if (!ok) console.warn(`[simWasm] econ kernels: parameter layout ${String(ex.econ_layout?.())} != ${ECON_LAYOUT} (stale binary? npm run build:wasm), running JS`);
    layouts.set(ex, ok);
  }
  return ok;
}

/** tables block of one EconBandTables in one heap (written once) */
interface TablePtrs {
  heap: WasmHeap;
  wt: number; lvref: number; bias: number; nz: number; nzLen: number; zkind: number; zdev: number; zlen: number;
  netNoise: number; netTraffic: number;
}

function writeTables(h: WasmHeap, tb: EconBandTables): TablePtrs {
  const devs = tb.devs, nt = tb.nt;
  const align = (v: number) => (v + 15) & ~15;
  let o = 0;
  const at = (bytes: number) => { const p = o; o = align(o + bytes); return p; };
  const oWt = at(devs * nt * 4), oLvref = at(devs * 4), oBias = at(devs * 4), oNz = at(devs * nt), oNzLen = at(devs),
    oZkind = at(ECON_CODES), oZdev = at(ECON_CODES * devs), oZlen = at(ECON_CODES), oNoise = at(ECON_CODES * 8), oTraffic = at(ECON_CODES * 8);
  const base = h.alloc(o, 16);
  const F32 = h.F32, U8 = h.U8, F64 = h.F64;
  F32.set(tb.WT, (base + oWt) >> 2);
  F32.set(tb.LVREF, (base + oLvref) >> 2);
  F32.set(tb.BIAS, (base + oBias) >> 2);
  U8.fill(0, base + oNz, base + oNz + devs * nt);
  for (let d = 0; d < devs; d++) {
    U8.set(tb.NZ[d], base + oNz + d * nt);
    U8[base + oNzLen + d] = tb.NZ[d].length;
  }
  U8.fill(0, base + oZdev, base + oZdev + ECON_CODES * devs);
  for (let z = 0; z < ECON_CODES; z++) {
    const l = tb.zoneDevs[z];
    U8[base + oZkind + z] = l === null ? 0 : l === undefined ? 2 : 1;
    U8[base + oZlen + z] = l ? l.length : 0;
    if (l) U8.set(l, base + oZdev + z * devs);
  }
  F64.set(tb.netNoise, (base + oNoise) >> 3);
  F64.set(tb.netTraffic, (base + oTraffic) >> 3);
  return {
    heap: h, wt: base + oWt, lvref: base + oLvref, bias: base + oBias, nz: base + oNz, nzLen: base + oNzLen, zkind: base + oZkind,
    zdev: base + oZdev, zlen: base + oZlen, netNoise: base + oNoise, netTraffic: base + oTraffic,
  };
}

/** the kernels' domain of a table set (validated once): 17 terms, <= 16 devs, integer COARSE >= 1, dev codes in range */
function tablesSupported(tb: EconBandTables): boolean {
  const c = tb.consts;
  if (tb.nt !== ECON_NT || tb.devs < 1 || tb.devs > ECON_DEV_MAX) return false;
  if (!(isInt(c.COARSE) && c.COARSE >= 1)) return false;
  if (!(isInt(c.chkA) && isInt(c.chkB) && c.chkA >= 0 && c.chkB >= 0 && c.chkA < tb.devs && c.chkB < tb.devs)) return false;
  for (const l of tb.zoneDevs) if (l) for (const d of l) if (d < 0 || d >= tb.devs) return false;
  for (const nz of tb.NZ) for (const t of nz) if (t < 1 || t >= tb.nt) return false;
  return true;
}

const f32ok = (a: unknown, n: number): a is Float32Array => a instanceof Float32Array && a.length >= n;
const u8ok = (a: unknown, n: number): a is Uint8Array => a instanceof Uint8Array && a.length >= n;

/** band API that runs the wasm kernels when possible and `js` otherwise */
export function makeEconBandKernels(
  tb: EconBandTables,
  js: EconBandFns,
  opts: { wasm?: EconWasm; stats?: EconBindStats } = {},
): EconBandFns {
  const supported = tablesSupported(tb);
  const C = tb.consts, L = C.LV;
  const devs = tb.devs;
  const stats = opts.stats;
  let tables: TablePtrs | null = null;
  // outputs-vs-arguments overlap check, cached for the last argument set (identical arrays -> same answer)
  let lastDesArgs: Layer[] | null = null, lastDesOk = false;
  let lastLvArgs: Layer[] | null = null, lastLvOk = false;

  const instance = (): EconWasm | null => {
    if (!supported) return null;
    let w: EconWasm | null = opts.wasm ?? null;
    if (!w) {
      const inst = ECON_KERNEL.instance();
      if (inst === null) return null;
      w = { ex: inst.exports as unknown as EconExports, heap: inst.heap };
    }
    return layoutOk(w.ex) ? w : null;
  };

  const noOverlap = (outs: Layer[], args: Layer[]): boolean => {
    for (let a = 0; a < outs.length; a++) {
      for (const b of args) if (b !== outs[a] && overlaps(outs[a], b)) return false;
      for (let b = a + 1; b < outs.length; b++) if (overlaps(outs[a], outs[b]) || outs[a] === outs[b]) return false;
    }
    return true;
  };
  const sameArgs = (x: Layer[] | null, y: Layer[]): boolean => {
    if (x === null || x.length !== y.length) return false;
    for (let k = 0; k < y.length; k++) if (x[k] !== y[k]) return false;
    return true;
  };

  /** pointer of a layer argument: its own offset (resident) or a scratch block of `total` elements (staged) */
  const ptr = (h: WasmHeap, slot: number, a: Layer, total: number): number => {
    const p = h.ptrOf(a);
    if (p >= 0 && p % a.BYTES_PER_ELEMENT === 0) return p;
    return h.scratch(slot, total * a.BYTES_PER_ELEMENT);
  };
  /** copy elements [e0, e1) of a staged array into its block (no-op when resident) */
  const put = (h: WasmHeap, a: Layer, p: number, e0: number, e1: number): void => {
    if (e1 <= e0 || h.ptrOf(a) === p) return;
    const b = a.BYTES_PER_ELEMENT;
    const src = a.subarray(e0, e1);
    if (b === 1) h.U8.set(src as Uint8Array, p + e0);
    else if (a instanceof Float32Array) h.F32.set(src as Float32Array, (p >> 2) + e0);
    else h.I32.set(src as Int32Array, (p >> 2) + e0);
    if (stats) stats.bytesIn += (e1 - e0) * b;
  };
  /** copy elements [e0, e1) of a staged Float32Array output back */
  const get = (h: WasmHeap, a: Float32Array, p: number, e0: number, e1: number): void => {
    if (e1 <= e0 || h.ptrOf(a) === p) return;
    a.set(h.F32.subarray((p >> 2) + e0, (p >> 2) + e1), e0);
    if (stats) stats.bytesOut += (e1 - e0) * 4;
  };

  const tablesIn = (h: WasmHeap): TablePtrs => {
    if (tables === null || tables.heap !== h) tables = writeTables(h, tb);
    return tables;
  };

  const fillConsts = (h: WasmHeap, fp: number, avgCommute: number): void => {
    const F = h.F64, o = fp >> 3;
    F[o + F_AVG_COMMUTE] = avgCommute;
    F[o + F_COMMUTE_GOOD] = C.COMMUTE_GOOD;
    F[o + F_COMMUTE_BAD] = C.COMMUTE_BAD;
    F[o + F_COVERAGE_FALLBACK] = C.COVERAGE_FALLBACK;
    F[o + F_TRAFFIC_BUSY] = C.TRAFFIC_BUSY;
    F[o + F_POP_NEAR_FULL] = C.POP_NEAR_FULL;
    F[o + F_SLOPE_P0] = C.SLOPE_P0;
    F[o + F_SLOPE_P1] = C.SLOPE_P1;
    F[o + F_EFF_MIN] = C.LV_EFFECT_MIN;
    F[o + F_EFF_MAX] = C.LV_EFFECT_MAX;
    const lv = [L.base, L.services, L.parks, L.transit, L.commute, L.wealth, L.airPollution, L.waterPollution, L.garbage, L.crime, L.noise, L.temporal, L.spatial];
    for (let k = 0; k < lv.length; k++) F[o + F_LV_BASE + k] = lv[k];
  };

  // ---------------------------------------------------------------------------------------------- desirability
  function desirability(st: EconBandState, rt: EconBandRuntime, inf: EconBandFlags, shift: Float32Array, z0: number, z1: number, allCells: boolean): void {
    const w = instance();
    const N = st.size;
    if (w === null || !gridOk(N) || !isInt(z0) || !isInt(z1) || z0 < 0 || z1 > N || rt.cw !== Math.ceil(N / C.COARSE)) {
      if (stats) stats.jsCalls++;
      return js.desirability(st, rt, inf, shift, z0, z1, allCells);
    }
    if (z0 >= z1) return;
    const nn = N * N, cc = rt.cw * rt.cw, svc = inf.services;
    const des = st.desirability;
    let ok = Array.isArray(des) && des.length >= devs && shift instanceof Float32Array && shift.length >= devs &&
      u8ok(st.zone, nn) && u8ok(st.network, nn) && u8ok(st.water, nn) && f32ok(st.landValue, nn) && f32ok(st.airPollution, nn) &&
      f32ok(st.waterPollution, nn) && f32ok(st.garbage, nn) && f32ok(st.crime, nn) && f32ok(st.noise, nn) && f32ok(st.traffic, nn) &&
      f32ok(st.commute, nn) && f32ok(st.heights, (N + 1) * (N + 1)) && f32ok(rt.coarsePop, cc) && f32ok(rt.coarseFreight, cc) &&
      (svc
        ? f32ok(st.policeCov, nn) && f32ok(st.fireCov, nn) && f32ok(st.healthCov, nn) && f32ok(st.eduCov, nn) && f32ok(st.parkCov, nn) && f32ok(st.transitCov, nn)
        : f32ok(rt.lvEffects, nn) && f32ok(rt.lvLandfill, nn));
    for (let d = 0; ok && d < devs; d++) ok = f32ok(des[d], nn);
    if (ok) {
      const args: Layer[] = [st.zone, st.network, st.water, st.landValue, st.airPollution, st.waterPollution, st.garbage, st.crime, st.noise,
        st.traffic, st.commute, st.heights, rt.coarsePop, rt.coarseFreight, st.policeCov, st.fireCov, st.healthCov, st.eduCov, st.parkCov,
        st.transitCov, rt.lvEffects, rt.lvLandfill, shift];
      for (let d = 0; d < devs; d++) args.push(des[d]);
      if (!sameArgs(lastDesArgs, args)) {
        lastDesArgs = args;
        lastDesOk = noOverlap(des.slice(0, devs), args.slice(0, args.length - devs).filter((a) => ArrayBuffer.isView(a)));
      }
      ok = lastDesOk;
    }
    if (!ok) {
      if (stats) stats.jsCalls++;
      return js.desirability(st, rt, inf, shift, z0, z1, allCells);
    }
    const avgCommute = st.stats.avgCommute > 0 ? st.stats.avgCommute : C.COMMUTE_FALLBACK;
    const h = w.heap;
    let rc = -1;
    try {
      // (1) pointers: scratch allocations first (they may grow memory)
      const tp = tablesIn(h);
      const ip = h.scratch(S_IP, IP_LEN * 4), fp = h.scratch(S_FP, FP_LEN * 8, 16), ps = h.scratch(S_SHIFT, ECON_DEV_MAX * 4);
      const pZone = ptr(h, S_ZONE, st.zone, nn), pNet = ptr(h, S_NET, st.network, nn), pWater = ptr(h, S_WATER, st.water, nn);
      const pLv = ptr(h, S_LV, st.landValue, nn), pAir = ptr(h, S_AIR, st.airPollution, nn), pWpol = ptr(h, S_WPOL, st.waterPollution, nn);
      const pGarb = ptr(h, S_GARB, st.garbage, nn), pCrime = ptr(h, S_CRIME, st.crime, nn), pNoise = ptr(h, S_NOISE, st.noise, nn);
      const pTraffic = ptr(h, S_TRAFFIC, st.traffic, nn), pCommute = ptr(h, S_COMMUTE, st.commute, nn);
      const pHeights = ptr(h, S_HEIGHTS, st.heights, (N + 1) * (N + 1));
      const pCpop = ptr(h, S_CPOP, rt.coarsePop, cc), pCfreight = ptr(h, S_CFREIGHT, rt.coarseFreight, cc);
      let pPolice = 0, pFire = 0, pHealth = 0, pEdu = 0, pPark = 0, pTransit = 0, pEff = 0, pFill = 0;
      if (svc) {
        pPolice = ptr(h, S_POLICE, st.policeCov, nn); pFire = ptr(h, S_FIRE, st.fireCov, nn); pHealth = ptr(h, S_HEALTH, st.healthCov, nn);
        pEdu = ptr(h, S_EDU, st.eduCov, nn); pPark = ptr(h, S_PARK, st.parkCov, nn); pTransit = ptr(h, S_TRANSIT, st.transitCov, nn);
      } else {
        pEff = ptr(h, S_LVEFF, rt.lvEffects, nn); pFill = ptr(h, S_LVFILL, rt.lvLandfill, nn);
      }
      const pDes: number[] = [];
      for (let d = 0; d < devs; d++) pDes.push(ptr(h, S_DES[d], des[d], nn));
      // (2) staged inputs: the band's rows (+1 row above / below for the neighbour-road terms, +1 row of corners)
      const e0 = z0 * N, e1 = z1 * N;
      const n0 = Math.max(0, z0 - 1) * N, n1 = Math.min(N, z1 + 1) * N;
      put(h, st.zone, pZone, e0, e1); put(h, st.network, pNet, n0, n1); put(h, st.water, pWater, e0, e1);
      put(h, st.landValue, pLv, e0, e1); put(h, st.airPollution, pAir, e0, e1); put(h, st.waterPollution, pWpol, e0, e1);
      put(h, st.garbage, pGarb, e0, e1); put(h, st.crime, pCrime, e0, e1); put(h, st.noise, pNoise, e0, e1);
      put(h, st.traffic, pTraffic, n0, n1); put(h, st.commute, pCommute, e0, e1);
      put(h, st.heights, pHeights, z0 * (N + 1), (z1 + 1) * (N + 1));
      put(h, rt.coarsePop, pCpop, 0, cc); put(h, rt.coarseFreight, pCfreight, 0, cc);
      if (svc) {
        put(h, st.policeCov, pPolice, e0, e1); put(h, st.fireCov, pFire, e0, e1); put(h, st.healthCov, pHealth, e0, e1);
        put(h, st.eduCov, pEdu, e0, e1); put(h, st.parkCov, pPark, e0, e1); put(h, st.transitCov, pTransit, e0, e1);
      } else {
        put(h, rt.lvEffects, pEff, e0, e1); put(h, rt.lvLandfill, pFill, e0, e1);
      }
      // outputs keep the values of the devs a cell does not write: stage the rows in as well
      for (let d = 0; d < devs; d++) put(h, des[d], pDes[d], e0, e1);
      // (3) parameter blocks
      const I = h.I32, o = ip >> 2;
      I[o + I_N] = N; I[o + I_CW] = rt.cw; I[o + I_COARSE] = C.COARSE; I[o + I_Z0] = z0; I[o + I_Z1] = z1;
      I[o + I_FLAGS] = (inf.traffic ? FL_TRAFFIC : 0) | (inf.pollution ? FL_POLLUTION : 0) | (svc ? FL_SERVICES : 0) | (allCells ? FL_ALL : 0);
      I[o + I_NTERMS] = tb.nt; I[o + I_DEVS] = devs;
      I[o + I_ZONE] = pZone; I[o + I_NET] = pNet; I[o + I_WATER] = pWater; I[o + I_BUILDING] = 0; I[o + I_LV] = pLv;
      I[o + I_AIR] = pAir; I[o + I_WPOL] = pWpol; I[o + I_GARB] = pGarb; I[o + I_CRIME] = pCrime; I[o + I_NOISE] = pNoise;
      I[o + I_TRAFFIC] = pTraffic; I[o + I_COMMUTE] = pCommute; I[o + I_POLICE] = pPolice; I[o + I_FIRE] = pFire;
      I[o + I_HEALTH] = pHealth; I[o + I_EDU] = pEdu; I[o + I_PARK] = pPark; I[o + I_TRANSIT] = pTransit; I[o + I_HEIGHTS] = pHeights;
      I[o + I_CPOP] = pCpop; I[o + I_CFREIGHT] = pCfreight; I[o + I_CWEALTH] = 0; I[o + I_LVSTATIC] = 0; I[o + I_LVEFF] = pEff;
      I[o + I_LVLANDFILL] = pFill; I[o + I_SHIFT] = ps; I[o + I_WT] = tp.wt; I[o + I_LVREF] = tp.lvref; I[o + I_BIAS] = tp.bias;
      I[o + I_NZ] = tp.nz; I[o + I_NZ_LEN] = tp.nzLen; I[o + I_ZKIND] = tp.zkind; I[o + I_ZDEV] = tp.zdev; I[o + I_ZLEN] = tp.zlen;
      I[o + I_NET_NOISE] = tp.netNoise; I[o + I_NET_TRAFFIC] = tp.netTraffic; I[o + I_CHK_A] = C.chkA; I[o + I_CHK_B] = C.chkB;
      for (let d = 0; d < ECON_DEV_MAX; d++) I[o + I_DES + d] = d < devs ? pDes[d] : 0;
      h.F32.set(shift.subarray(0, devs), ps >> 2);
      fillConsts(h, fp, avgCommute);
      // (4) the kernel
      rc = w.ex.econ_desirability_band(ip, fp);
      if (rc === 0) {
        for (let d = 0; d < devs; d++) get(h, des[d], pDes[d], e0, e1);
        if (stats) stats.wasmCalls++;
        return;
      }
    } catch (e) {
      simWasmCallFailed('econ', e);
    }
    // rc 1 (a zone code that is not a zone: the JS rerun rewrites the finished cells identically and throws the
    // original's TypeError), rc 2 (outside the kernel's domain: nothing written) or a failed call
    if (stats) stats.jsCalls++;
    js.desirability(st, rt, inf, shift, z0, z1, allCells);
  }

  // ---------------------------------------------------------------------------------------------- land value
  function landValue(st: EconBandState, rt: EconBandRuntime, inf: EconBandFlags, z0: number, z1: number, first: boolean, acc: Float64Array): void {
    const w = instance();
    const N = st.size;
    if (w === null || !gridOk(N) || !isInt(z0) || !isInt(z1) || z0 < 0 || z1 > N || rt.cw !== Math.ceil(N / C.COARSE) ||
      !(acc instanceof Float64Array) || acc.length < 4) {
      if (stats) stats.jsCalls++;
      return js.landValue(st, rt, inf, z0, z1, first, acc);
    }
    if (z0 >= z1) return;
    const nn = N * N, cc = rt.cw * rt.cw, svc = inf.services;
    let ok = u8ok(st.zone, nn) && u8ok(st.water, nn) && st.building instanceof Int32Array && st.building.length >= nn &&
      f32ok(st.landValue, nn) && f32ok(st.airPollution, nn) && f32ok(st.waterPollution, nn) && f32ok(st.garbage, nn) &&
      f32ok(st.crime, nn) && f32ok(st.noise, nn) && f32ok(st.commute, nn) && f32ok(rt.lvStatic, nn) && f32ok(rt.lvEffects, nn) &&
      f32ok(rt.lvLandfill, nn) && f32ok(rt.coarseWealth, cc) &&
      (!svc || (f32ok(st.policeCov, nn) && f32ok(st.fireCov, nn) && f32ok(st.healthCov, nn) && f32ok(st.eduCov, nn) && f32ok(st.parkCov, nn) && f32ok(st.transitCov, nn)));
    if (ok) {
      const args: Layer[] = [st.landValue, st.zone, st.water, st.building, st.airPollution, st.waterPollution, st.garbage, st.crime,
        st.noise, st.commute, rt.lvStatic, rt.lvEffects, rt.lvLandfill, rt.coarseWealth, st.policeCov, st.fireCov, st.healthCov,
        st.eduCov, st.parkCov, st.transitCov];
      if (!sameArgs(lastLvArgs, args)) {
        lastLvArgs = args;
        lastLvOk = noOverlap([st.landValue], args.slice(1).filter((a) => ArrayBuffer.isView(a)));
      }
      ok = lastLvOk;
    }
    if (!ok) {
      if (stats) stats.jsCalls++;
      return js.landValue(st, rt, inf, z0, z1, first, acc);
    }
    const avgCommute = st.stats.avgCommute > 0 ? st.stats.avgCommute : C.COMMUTE_FALLBACK;
    const h = w.heap;
    try {
      const ip = h.scratch(S_IP, IP_LEN * 4), fp = h.scratch(S_FP, FP_LEN * 8, 16);
      const pLv = ptr(h, S_LV, st.landValue, nn), pZone = ptr(h, S_ZONE, st.zone, nn), pWater = ptr(h, S_WATER, st.water, nn);
      const pBuilding = ptr(h, S_BUILDING, st.building, nn), pAir = ptr(h, S_AIR, st.airPollution, nn);
      const pWpol = ptr(h, S_WPOL, st.waterPollution, nn), pGarb = ptr(h, S_GARB, st.garbage, nn), pCrime = ptr(h, S_CRIME, st.crime, nn);
      const pNoise = ptr(h, S_NOISE, st.noise, nn), pCommute = ptr(h, S_COMMUTE, st.commute, nn);
      const pStatic = ptr(h, S_LVSTATIC, rt.lvStatic, nn), pEff = ptr(h, S_LVEFF, rt.lvEffects, nn), pFill = ptr(h, S_LVFILL, rt.lvLandfill, nn);
      const pWealth = ptr(h, S_CWEALTH, rt.coarseWealth, cc);
      let pPolice = 0, pFire = 0, pHealth = 0, pEdu = 0, pPark = 0, pTransit = 0;
      if (svc) {
        pPolice = ptr(h, S_POLICE, st.policeCov, nn); pFire = ptr(h, S_FIRE, st.fireCov, nn); pHealth = ptr(h, S_HEALTH, st.healthCov, nn);
        pEdu = ptr(h, S_EDU, st.eduCov, nn); pPark = ptr(h, S_PARK, st.parkCov, nn); pTransit = ptr(h, S_TRANSIT, st.transitCov, nn);
      }
      const e0 = z0 * N, e1 = z1 * N;
      // the blend reads the land value of the rows above and below the band
      put(h, st.landValue, pLv, first ? e0 : Math.max(0, z0 - 1) * N, first ? e1 : Math.min(N, z1 + 1) * N);
      put(h, st.zone, pZone, e0, e1); put(h, st.water, pWater, e0, e1); put(h, st.building, pBuilding, e0, e1);
      put(h, st.airPollution, pAir, e0, e1); put(h, st.waterPollution, pWpol, e0, e1); put(h, st.garbage, pGarb, e0, e1);
      put(h, st.crime, pCrime, e0, e1); put(h, st.noise, pNoise, e0, e1); put(h, st.commute, pCommute, e0, e1);
      put(h, rt.lvStatic, pStatic, e0, e1); put(h, rt.lvEffects, pEff, e0, e1); put(h, rt.lvLandfill, pFill, e0, e1);
      put(h, rt.coarseWealth, pWealth, 0, cc);
      if (svc) {
        put(h, st.policeCov, pPolice, e0, e1); put(h, st.fireCov, pFire, e0, e1); put(h, st.healthCov, pHealth, e0, e1);
        put(h, st.eduCov, pEdu, e0, e1); put(h, st.parkCov, pPark, e0, e1); put(h, st.transitCov, pTransit, e0, e1);
      }
      const I = h.I32, o = ip >> 2;
      I[o + I_N] = N; I[o + I_CW] = rt.cw; I[o + I_COARSE] = C.COARSE; I[o + I_Z0] = z0; I[o + I_Z1] = z1;
      I[o + I_FLAGS] = (inf.traffic ? FL_TRAFFIC : 0) | (inf.pollution ? FL_POLLUTION : 0) | (svc ? FL_SERVICES : 0) | (first ? FL_ALL : 0);
      I[o + I_NTERMS] = tb.nt; I[o + I_DEVS] = devs;
      I[o + I_ZONE] = pZone; I[o + I_NET] = 0; I[o + I_WATER] = pWater; I[o + I_BUILDING] = pBuilding; I[o + I_LV] = pLv;
      I[o + I_AIR] = pAir; I[o + I_WPOL] = pWpol; I[o + I_GARB] = pGarb; I[o + I_CRIME] = pCrime; I[o + I_NOISE] = pNoise;
      I[o + I_TRAFFIC] = 0; I[o + I_COMMUTE] = pCommute; I[o + I_POLICE] = pPolice; I[o + I_FIRE] = pFire; I[o + I_HEALTH] = pHealth;
      I[o + I_EDU] = pEdu; I[o + I_PARK] = pPark; I[o + I_TRANSIT] = pTransit; I[o + I_HEIGHTS] = 0; I[o + I_CPOP] = 0;
      I[o + I_CFREIGHT] = 0; I[o + I_CWEALTH] = pWealth; I[o + I_LVSTATIC] = pStatic; I[o + I_LVEFF] = pEff; I[o + I_LVLANDFILL] = pFill;
      fillConsts(h, fp, avgCommute);
      const F = h.F64, fo = fp >> 3;
      F[fo + F_ACC] = acc[0]; F[fo + F_ACC + 1] = acc[1]; F[fo + F_ACC + 2] = acc[2]; F[fo + F_ACC + 3] = acc[3];
      const rc = w.ex.econ_land_value_band(ip, fp);
      if (rc === 0) {
        get(h, st.landValue, pLv, e0, e1);
        const G = h.F64;
        acc[0] = G[fo + F_ACC]; acc[1] = G[fo + F_ACC + 1]; acc[2] = G[fo + F_ACC + 2]; acc[3] = G[fo + F_ACC + 3];
        if (stats) stats.wasmCalls++;
        return;
      }
    } catch (e) {
      simWasmCallFailed('econ', e);
    }
    // rc 2 (outside the kernel's domain: nothing written) or a failed call
    if (stats) stats.jsCalls++;
    js.landValue(st, rt, inf, z0, z1, first, acc);
  }

  return { desirability, landValue };
}
