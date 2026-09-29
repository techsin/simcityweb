/**
 * Field passes bound to the live simulation modules: the NIMBY rebuild and the PollutionSystem field stages running on
 * FieldKernels (the restructured JS of src/wasm/js/fieldPasses.ts, or the WebAssembly kernels of fieldPassesBind.ts).
 *
 *   fieldKernelsJs       the restructured JS kernels (fair A/B baseline / fallback)
 *   fieldKernelsWasm     the WebAssembly kernels (JS fallback: fieldKernelsJs)
 *   makeNimby(kernels)   rebuildNimby / nimbyCost / nimbyAt with the nimby.ts signatures: the building walk (source
 *                        strengths from Building / DefInfo, plantLoad, getDef stage) stays JS and fills a compact source
 *                        list; splats, landfill blocks, corridors and the 1 − exp(−x) pass run on the kernels. The
 *                        scheduler cost estimate (nimbyCost) is computed from the same touch counts as nimby.ts.
 *   installFieldPasses(pollution, kernels)
 *                        instance method overrides of a PollutionSystem: stageCells / stageAir / stageNoise / stageB /
 *                        stageFlags with their field work on the kernels (the building walks, garbage steps, blur calls,
 *                        flags and events stay the original JS); returns an uninstall function
 *   adoptPollutionArrays(pollution, heap)
 *                        move the system's field arrays into wasm memory (zero copy for the kernels), see adoptLayers()
 *
 * The overrides and the NIMBY walk are FROZEN copies of pollution.ts / nimby.ts at 24f8609 (the versions the kernels
 * were ported from; both files are read-only for sim-depth part B). With those files live, a city simulated with
 * makeNimby(…) + installFieldPasses(…) is bit-identical to one simulated with the originals
 * (tests/wasm/fieldPasses.test.ts). The overrides reach into the PollutionSystem's private fields (their names and
 * meaning at 24f8609); an integration would call the kernels from pollution.ts / nimby.ts directly instead.
 * nimby.ts cannot be patched from outside (services.ts imports its functions): swap it with a module redirect (a rolldown
 * plugin: tools/bench/fieldPasses/plugins.mjs, or vi.mock in tests) that dispatches per CityState.
 */
import { DevType, Network, Zone } from '../../core/types';
import type { Building, CityState } from '../../sim/CityState';
import { BF } from '../../sim/CityState';
import type { Simulation } from '../../sim/Simulation';
import { getDef } from '../../sim/catalog';
import { ordinanceEffect } from '../../sim/economy/ordinances';
import { Fam, buildingList, infoOf, isFunctional, readEffects, setFlagQuiet, type DefInfo, type OrdEffects } from '../../sim/infra/common';
import { falloff } from '../../sim/infra/catchments';
import { blurSigma2, boxAverage } from '../../sim/infra/blur';
import { windVector, type WindVector } from '../../sim/infra/wind';
import type { PollutionSystem } from '../../sim/infra/pollution';
import {
  AIR_K, AIR_PER_TRIP, BANK_COUPLING, BRIDGE_NOISE, GARBAGE_SMELL, LANDFILL_AIR, LANDFILL_IDLE_EMIT, LANDFILL_SIZE_REF, NET_BASE_NOISE,
  NIMBY_HIGHWAY, NIMBY_HIGHWAY_BRIDGE, NIMBY_ID, NIMBY_IM, NIMBY_LANDFILL_IDLE, NIMBY_PLANT_IDLE, NIMBY_RAIL, NOISE_CONG_DAMP,
  NOISE_CROSSING, NOISE_FREIGHT_RAIL, NOISE_K, NOISE_PER_TRIP, NOISE_PER_TRIP_NET, NOISY_THRESHOLD, PARK_NOISE_ABSORB, POLLUTED_THRESHOLD,
  POLL_PEAK_GAIN, POLL_RADII, POLL_SMOOTH, PRESTIGE_HIGH_C, PRESTIGE_HIGH_C_STAGE, SOIL_DECAY, SOIL_GROUNDWATER, SOIL_RATE,
  SOIL_SRC_LANDFILL, TREE_AIR_ABSORB, TREE_COVER_RADIUS, TREE_NOISE_ABSORB, TUNNEL_AIR, TUNNEL_NOISE, WATER_K, WIND_DRIFT_FAR,
} from '../../sim/infra/params';
import type { WasmHeap } from '../heap';
import { adoptLayers, type AdoptedLayers } from '../layers';
import {
  NimbySources, NimbyTables, PH_ALL, T_CAMPUS, T_PRESTIGE, T_STIGMA, USED_A, USED_N, USED_W, fieldKernelsJs, intensityToSource,
  type FieldKernels, type NimbyCtx,
} from '../js/fieldPasses';
import { makeFieldKernels, releaseNimbyCtx } from './fieldPassesBind';

export { FIELDS_KERNEL, makeFieldKernels, releaseNimbyCtx, type FieldsBindStats, type FieldsWasm } from './fieldPassesBind';
export { fieldKernelsJs };

/** WebAssembly field kernels (JS fallback: the restructured JS) */
export const fieldKernelsWasm: FieldKernels = makeFieldKernels(fieldKernelsJs);

/** the kernel tables of the live falloff (nimby.ts kernelOf semantics; shared by every NIMBY instance) */
export const NIMBY_TABLES = new NimbyTables(falloff);

// ================================================================================================= NIMBY
type PlantLoadFn = (id: number) => number;
function plantLoadFn(sim: Simulation): PlantLoadFn | null {
  const u = sim.getSystem('utilities') as unknown as { plantLoad?: PlantLoadFn } | undefined;
  return u && typeof u.plantLoad === 'function' ? u.plantLoad.bind(u) : null;
}

export interface NimbyImpl {
  readonly label: string;
  rebuildNimby(sim: Simulation): void;
  nimbyCost(sim: Simulation): number;
  nimbyAt(st: CityState, i: number): { stigma: number; prestige: number; campus: number };
  /** free the per-state buffers (kernel-owned wasm blocks included) */
  release(st: CityState): void;
}

/**
 * nimby.ts with the raster work on `kernels`. `cacheCorridor` (default true) keeps the corridor raster while the
 * corridor class map is unchanged (false: rebuilt every time, as nimby.ts does).
 */
export function makeNimby(
  kernels: FieldKernels,
  opts: { cacheCorridor?: boolean; label?: string; tables?: NimbyTables; sources?: (tables: NimbyTables) => NimbySources } = {},
): NimbyImpl {
  const tables = opts.tables ?? NIMBY_TABLES;
  const newSources = opts.sources ?? ((t: NimbyTables) => new NimbySources(t));
  const force = opts.cacheCorridor === false;
  const costEst = new WeakMap<CityState, number>();
  const ctxs = new WeakMap<CityState, { ctx: NimbyCtx; src: NimbySources }>();

  function rebuildNimby(sim: Simulation): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    let c = ctxs.get(st);
    if (!c) ctxs.set(st, (c = { ctx: {}, src: newSources(tables) }));
    const src = c.src;
    src.reset();
    const plantLoad = plantLoadFn(sim);
    let touches = 0;
    const bL = buildingList(st);
    for (let bI = 0; bI < bL.length; bI++) {
      const b = bL[bI];
      if (!isFunctional(b)) continue;
      const inf = infoOf(st, b);
      let sA = inf.stigmaAmt, sR = inf.stigmaR;
      let pA = inf.prestigeAmt, pR = inf.prestigeR;
      if (inf.fam === Fam.I) {
        if (inf.dev === DevType.ID) { sA = NIMBY_ID.amount; sR = NIMBY_ID.radius; }
        else if (inf.dev === DevType.IM) { sA = NIMBY_IM.amount; sR = NIMBY_IM.radius; }
      } else if (inf.fam === Fam.C && pA === 0 && (inf.dev === DevType.CS3 || inf.dev === DevType.CO3)) {
        const stage = getDef(b.def)?.stage ?? 0;
        if (stage >= PRESTIGE_HIGH_C_STAGE) { pA = PRESTIGE_HIGH_C.amount; pR = PRESTIGE_HIGH_C.radius; }
      }
      if (sA > 0 && inf.powerOut > 0 && plantLoad) {
        const load = plantLoad(b.id);
        if (load >= 0) sA *= NIMBY_PLANT_IDLE + (1 - NIMBY_PLANT_IDLE) * Math.min(1, load);
      }
      if (sA > 0) touches += src.add(b.x, b.z, b.w, b.d, sA, sR, T_STIGMA);
      if (pA > 0) touches += src.add(b.x, b.z, b.w, b.d, pA, pR, T_PRESTIGE);
      if (inf.campusAmt > 0) touches += src.add(b.x, b.z, b.w, b.d, inf.campusAmt, inf.campusR, T_CAMPUS);
    }
    const lfDef = getDef('util_landfill_tile');
    const lfA = lfDef?.stigma?.amount ?? 0.35, lfR = lfDef?.stigma?.radius ?? 6;
    const lfTable = lfR > 0 ? tables.of(lfR, 2, 2) : null;
    const tabH = tables.of(NIMBY_HIGHWAY.radius, 1, 1), tabR = tables.of(NIMBY_RAIL.radius, 1, 1);
    const r = kernels.nimby(c.ctx, {
      N, src, zone: st.zone, fill: st.landfillFill ?? null, lfCode: Zone.Landfill, lfTable, lfA, lfIdle: NIMBY_LANDFILL_IDLE,
      net: st.network, flags: st.netFlags, highway: Network.Highway, rail: Network.Rail, tabH, tabR,
      aH: NIMBY_HIGHWAY.amount, aHB: NIMBY_HIGHWAY_BRIDGE, aR: NIMBY_RAIL.amount, force,
      S: st.stigma, P: st.prestige, K: st.campus,
    }, PH_ALL);
    touches += r.lf * (lfTable ? lfTable.n : 0);
    touches += r.nh * tabH.n + r.nr * tabR.n;
    // cost model of nimby.ts (the same expression, the same touch count)
    costEst.set(st, 0.3 + 0.9 * (C / 65536) + 0.45 * (bL.length / 20000) + touches * 6e-6);
  }

  function nimbyCost(sim: Simulation): number {
    const st = sim.state;
    return costEst.get(st) ?? 0.3 + 0.9 * (st.cells / 65536) + 0.45 * (st.buildings.size / 20000) + 0.6;
  }

  function nimbyAt(st: CityState, i: number): { stigma: number; prestige: number; campus: number } {
    return { stigma: st.stigma[i] ?? 0, prestige: st.prestige[i] ?? 0, campus: st.campus[i] ?? 0 };
  }

  function release(st: CityState): void {
    const c = ctxs.get(st);
    if (c) releaseNimbyCtx(c.ctx);
    ctxs.delete(st);
    costEst.delete(st);
  }

  return { label: opts.label ?? kernels.kind, rebuildNimby, nimbyCost, nimbyAt, release };
}

// ================================================================================================= pollution
/** pollution.ts module-private helpers @24f8609 (verbatim) */
function srcScale(K: number): number {
  return K / POLL_PEAK_GAIN;
}
function areaSource(L: number, K: number): number {
  return (-Math.log(1 - Math.min(0.95, L)) * K) / (POLL_PEAK_GAIN * 2 * Math.PI * 8);
}
let baseSrcKey = -1;
let baseSrc: Float32Array = new Float32Array(0);
function baseNoiseSources(noiseK: number): Float32Array {
  if (noiseK === baseSrcKey) return baseSrc;
  baseSrcKey = noiseK;
  baseSrc = Float32Array.from(NET_BASE_NOISE, (I) => intensityToSource(I, noiseK));
  return baseSrc;
}
interface Wp3Effects { airPower: number; sewage: number; noise: number; noiseTraffic: number; soilDecay: number }
function effect(st: CityState, key: string): number {
  try {
    const v = ordinanceEffect(st, key);
    return typeof v === 'number' && isFinite(v) && v >= 0 ? v : 1;
  } catch {
    return 1;
  }
}
function wp3Effects(st: CityState): Wp3Effects {
  return {
    airPower: effect(st, 'pollution.air.power'),
    sewage: effect(st, 'pollution.sewage'),
    noise: effect(st, 'pollution.noise'),
    noiseTraffic: effect(st, 'pollution.noise.traffic'),
    soilDecay: effect(st, 'soil.decay'),
  };
}

/** the PollutionSystem internals the overrides use (pollution.ts @24f8609 private fields / methods) */
interface PollutionPrivate {
  air: Float32Array[];
  waterS: Float32Array[];
  noiseS: Float32Array[];
  usedCls: Uint8Array;
  tmp: Float32Array;
  tmp2: Float32Array;
  ground: Float32Array;
  parkMask: Float32Array;
  parkBuf: Float32Array;
  soilSrc: Float32Array;
  waterCells: Int32Array;
  waterNb: Int32Array;
  bankCells: Int32Array;
  bankSrc: Int32Array;
  nWater: number;
  lfOrder: Int32Array;
  regStart: number[];
  regCount: number[];
  regCap: number[];
  regUsed: number[];
  nReg: number;
  treesDirty: boolean;
  parkDirty: boolean;
  firstPass: boolean;
  fxB: OrdEffects | null;
  fx3B: Wp3Effects | null;
  dtMonthsB: number;
  ensureCells(st: CityState): void;
  ensureWaterList(st: CityState): void;
  updateTreeCover(st: CityState): void;
  plume(src: Float32Array, field: Float32Array, N: number, f: number, r: number, gain: number, w: WindVector, d: number): void;
  blurPair(src: Float32Array[], usedBase: number, out: Float32Array, N: number): void;
  info(st: CityState, b: Building): DefInfo;
  stageCells(sim: Simulation): void;
  stageAir(sim: Simulation, first: boolean): void;
  stageNoise(sim: Simulation, first: boolean): void;
  stageB(sim: Simulation, first: boolean): void;
  stageFlags(sim: Simulation): void;
}

/** the field arrays the kernels read / write in place (adoptPollutionArrays) */
export const POLLUTION_FIELD_ARRAYS = ['air', 'waterS', 'noiseS', 'tmp', 'tmp2', 'ground', 'parkBuf', 'soilSrc', 'waterCells', 'waterNb', 'bankCells', 'bankSrc'] as const;

/**
 * Move the PollutionSystem's field arrays (POLLUTION_FIELD_ARRAYS) into wasm memory (after the system's init: the arrays
 * exist). Arrays the system re-creates later (the water list after a terrain change) are plain again and get staged.
 */
export function adoptPollutionArrays(pol: PollutionSystem, heap: WasmHeap, reserveExtra = 0): AdoptedLayers {
  return adoptLayers(pol, heap, { include: (k) => (POLLUTION_FIELD_ARRAYS as readonly string[]).includes(k), reserveExtra });
}

const OVERRIDES = ['stageCells', 'stageAir', 'stageNoise', 'stageB', 'stageFlags'] as const;

/**
 * Override the field stages of one PollutionSystem instance with `kernels` (own properties shadowing the prototype
 * methods; step() / compute() call them as before). Returns the uninstall function.
 */
export function installFieldPasses(pol: PollutionSystem, kernels: FieldKernels): () => void {
  const self = pol as unknown as PollutionPrivate & Record<string, unknown>;
  let regAdd = new Float64Array(64);

  function stageCells(this: PollutionPrivate, sim: Simulation): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const fx = this.fxB ?? readEffects(st);
    const fx3 = this.fx3B ?? wp3Effects(st);
    const airK = srcScale(AIR_K), waterK = srcScale(WATER_K), noiseK = srcScale(NOISE_K);
    const used = this.usedCls;
    const tn = fx3.noiseTraffic;
    const base = baseNoiseSources(noiseK);
    // freight trains (WP7 exposes the cells of freight routes)
    const tr = sim.getSystem('traffic') as unknown as { freightRailCells?: () => ArrayLike<number> } | undefined;
    const fr = typeof tr?.freightRailCells === 'function' ? tr.freightRailCells() : null;
    // landfill cells: emission by use, damped for big landfills (per region: the adds of each of its cells)
    const lf = getDef('util_landfill_tile')?.pollution;
    const lfAir = lf ? intensityToSource(lf.air ?? 0, airK) * fx.air : LANDFILL_AIR;
    const lfWater = lf ? intensityToSource(lf.water ?? 0, waterK) * fx.water : 0;
    const lfNoise = lf ? intensityToSource(lf.noise ?? 0, noiseK) : 0;
    const nReg = this.nReg;
    if (regAdd.length < 4 * nReg) regAdd = new Float64Array(8 * nReg);
    for (let r = 0; r < nReg; r++) {
      const n = this.regCount[r];
      const use = this.regCap[r] > 0 ? Math.min(1, this.regUsed[r] / this.regCap[r]) : 0;
      const act = LANDFILL_IDLE_EMIT + (1 - LANDFILL_IDLE_EMIT) * use;
      const m = act / Math.sqrt(Math.max(1, n / LANDFILL_SIZE_REF));
      regAdd[4 * r] = lfAir * m;
      regAdd[4 * r + 1] = lfWater * m;
      regAdd[4 * r + 2] = lfNoise * m;
      regAdd[4 * r + 3] = SOIL_SRC_LANDFILL * act;
    }
    const bits = kernels.cells({
      C, garbage: st.garbage, building: st.building, soil: st.soil, network: st.network, traffic: st.traffic, congestion: st.congestion,
      netFlags: st.netFlags, A0: this.air[0], W0: this.waterS[0], N0: this.noiseS[0], soilSrc: this.soilSrc, freight: fr,
      lfOrder: this.lfOrder, nReg, regStart: this.regStart, regCount: this.regCount, regAdd,
      smell: areaSource(GARBAGE_SMELL, AIR_K) * fx.air, waterK, soilGW: SOIL_GROUNDWATER, trafficAir: AIR_PER_TRIP * fx.air,
      tunnelAir: TUNNEL_AIR, congDamp: NOISE_CONG_DAMP, crossing: intensityToSource(NOISE_CROSSING, noiseK) * tn, noisePerTrip: NOISE_PER_TRIP,
      tunnelNoise: TUNNEL_NOISE, bridgeNoise: BRIDGE_NOISE, tn, freightS: intensityToSource(NOISE_FREIGHT_RAIL, noiseK) * tn,
      perTrip: NOISE_PER_TRIP_NET, base, highway: Network.Highway, rail: Network.Rail,
    });
    if (bits & USED_A) used[0] = 1;
    if ((bits & USED_N) || (fr && fr.length > 0)) used[5] = 1;
    if (bits & USED_W) used[3] = 1;
    for (let r = 0; r < nReg; r++) if (this.regCount[r] > 0) { used[0] = 1; used[3] = 1; used[5] = 1; }
    // tree cover (published) and the park buffer only change with trees / parks
    if (this.treesDirty || this.firstPass) { this.treesDirty = false; this.updateTreeCover(st); }
    if (this.parkDirty || this.firstPass) { this.parkDirty = false; boxAverage(this.parkMask, this.parkBuf, this.tmp2, N, TREE_COVER_RADIUS); }
  }

  function stageAir(this: PollutionPrivate, sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const air = this.air, used = this.usedCls;
    const field = this.tmp2;
    if (used[2]) {
      const rr = Math.max(1, Math.round(POLL_RADII[2] / 4));
      this.plume(air[2], field, N, 4, rr, POLL_PEAK_GAIN * 2 * Math.PI * 16 * blurSigma2(rr), windVector(st), WIND_DRIFT_FAR);
    }
    kernels.saturate(field, st.airPollution, C, 1 / AIR_K, first ? 1 : POLL_SMOOTH, null, st.treeCover, TREE_AIR_ABSORB);
  }

  function stageNoise(this: PollutionPrivate, sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    this.blurPair(this.noiseS, 5, this.tmp, N);
    kernels.saturate(this.tmp, st.noise, C, 1 / NOISE_K, first ? 1 : POLL_SMOOTH, null, st.treeCover, TREE_NOISE_ABSORB, this.parkBuf, PARK_NOISE_ABSORB);
  }

  function stageB(this: PollutionPrivate, sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    this.ensureCells(st);
    const tmp = this.tmp, tmp2 = this.tmp2;
    const alpha = first ? 1 : POLL_SMOOTH;
    this.blurPair(this.waterS, 3, tmp, N);
    // (the water list only depends on st.water: building it before the cleaning / saturate loops changes nothing)
    this.ensureWaterList(st);
    kernels.water({
      C, tmp, tmp2, L: st.waterPollution, ground: this.ground, water: st.water, waterCells: this.waterCells, nW: this.nWater,
      waterNb: this.waterNb, bankCells: this.bankCells, bankSrc: this.bankSrc, invK: 1 / WATER_K, alpha, bankCoupling: BANK_COUPLING,
    });
  }

  function stageFlags(this: PollutionPrivate, sim: Simulation): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const fx3 = this.fx3B ?? wp3Effects(st);
    const dt = this.dtMonthsB;
    // soil contamination (stock): builds up under sources, decays slowly (brownfield cleanup speeds it up)
    if (dt > 0) kernels.soil(st.soil, this.soilSrc, C, SOIL_RATE * dt, Math.max(0, 1 - SOIL_DECAY * dt * fx3.soilDecay));
    const airL = st.airPollution, waterL = st.waterPollution, noiseL = st.noise;
    const changed: Building[] = [];
    let polSum = 0, polN = 0, resW = 0, nSum = 0, aSum = 0, wSum = 0;
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const cx = Math.min(N - 1, b.x + (b.w >> 1)), cz = Math.min(N - 1, b.z + (b.d >> 1));
      const i = cz * N + cx;
      const a = airL[i], w = waterL[i], nz = noiseL[i];
      const weight = b.pop > 0 ? b.pop : Math.max(1, b.jobs * 0.5);
      polSum += (0.75 * a + 0.25 * w) * weight;
      polN += weight;
      const fam = this.info(st, b).fam;
      const isR = fam === Fam.R;
      if (isR && b.pop > 0) { resW += b.pop; nSum += nz * b.pop; aSum += a * b.pop; wSum += w * b.pop; }
      // the Polluted chip matters to people living / shopping there, not to factories and plants
      let f = setFlagQuiet(b, BF.Polluted, (isR || fam === Fam.C) && (a > POLLUTED_THRESHOLD || w > 0.6));
      if (setFlagQuiet(b, BF.Noisy, isR && nz > NOISY_THRESHOLD)) f = true;
      if (f) changed.push(b);
    }
    const s = st.stats;
    s.avgPollution = polN > 0 ? polSum / polN : 0;
    s.avgNoise = resW > 0 ? nSum / resW : 0;
    s.avgAir = resW > 0 ? aSum / resW : 0;
    s.avgWaterPollution = resW > 0 ? wSum / resW : 0;
    for (const b of changed) sim.events.emit('buildingChanged', b);
    sim.events.emit('layerUpdated', 'pollution');
  }

  const impl: Record<(typeof OVERRIDES)[number], unknown> = { stageCells, stageAir, stageNoise, stageB, stageFlags };
  const rec = self as unknown as Record<string, unknown>;
  const had = OVERRIDES.map((k) => (Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : undefined));
  for (const k of OVERRIDES) rec[k] = impl[k];
  return () => {
    OVERRIDES.forEach((k, j) => {
      if (had[j] !== undefined) rec[k] = had[j];
      else delete rec[k];
    });
  };
}
