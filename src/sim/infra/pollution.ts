/**
 * Pollution system: garbage, air (smoke), noise, water, soil. One pass every POLL_PERIOD days, run by the InfraScheduler
 * in 10 small steps (each <= ~2.5 estimated ms on 256²; see stepCost):
 *   0 garbage sources   production per building, facilities (incinerator / recycling / landfill regions with road access)
 *   1 garbage routes    truck-range BFS (GARBAGE_TRUCK_RANGE road cells) from facilities, capacity allocation
 *                       (recycling -> incineration -> landfill), incinerator burn shares, landfill dumping
 *   2 garbage apply     uncollected piles build up / collected piles clear, BF.NoGarbage, landfill fill (stock)
 *   3 building sources  (stageA) every emitter: plants by load, incinerator by burn share, industry, heating, shops,
 *                       nightlife, construction, fires, sewage, emergency spills (WP8 hook), parks, soil sources
 *   4 cell sources      traffic by network type (tunnels / bridges / crossings / congestion / freight rail), landfill
 *                       cells by use and size, garbage smell, soil leaching, treeCover (published) + park buffer
 *   5 air near          small / medium emitters (half resolution blur)
 *   6 air far + wind    large emitters (quarter resolution), prevailing-wind plume (wind.ts), saturation, tree absorption
 *   7 noise             blur, saturation, tree / park buffers
 *   8 water             (stageB) ground water blur, diffusion along water bodies, bank coupling (polluted rivers
 *                       contaminate their banks and the pumps drawing from them)
 *   9 flags + stats     soil stock update, BF.Polluted (R / C only), BF.Noisy (R), stats.avg*
 *
 *  Source model: catalog def.pollution.{air,water,noise} = intensity on the 0..1 overlay scale at the source with a
 *  falloff radius (negative = cleaning, e.g. water treatment). Converted to a source strength S = -K ln(1 - I) /
 *  POLL_PEAK_GAIN so an isolated emitter peaks at ~I; emitters are bucketed by radius into blur classes
 *  (air: full / half / quarter resolution, sigma ~2.4 / 4.9 / 9.8 cells; water & noise: half / quarter) and
 *  sources add up (industrial districts saturate). Growables scale with activity (0.3 + 0.7 x occupancy); power plants
 *  with their grid load (0.25 + 0.75 x UtilitiesSystem.plantLoad); the incinerator with its burn share.
 *  Defs without explicit pollution fall back to per-job emission by industry type (AIR_PER_JOB ...).
 *  Ordinances: 'pollution.air' (x 'pollution.air.industry' for industry & plants, x 'pollution.air.power' for plants),
 *  'pollution.water' (x '.industry'), 'pollution.sewage', 'pollution.noise' (C / I / construction),
 *  'pollution.noise.traffic', 'garbage.produced', 'soil.decay'.
 *  GARBAGE: production = def.pollution.garbage (t/month at full occupancy) x activity x 'garbage.produced'. A building
 *  is collected only if road-reachable within GARBAGE_TRUCK_RANGE of a facility and capacity remains (nearest first);
 *  garbageInfo says why not ('capacity', 'range', or 'noRoad' when no road touches the building at all).
 *  Recycling diverts up to RECYCLE_MAX_SHARE, incinerators burn (power output = def MW x burn share, read by utilities),
 *  landfills take the rest and FILL UP (state.landfillFill, LANDFILL_CELL_STOCK t per cell, cells fill in order; a
 *  full cell has no capacity). Unpowered facilities work at GARBAGE_UNPOWERED. state.garbage = uncollected piles on
 *  building cells (smell + crime) and, on landfill cells, a display level (0.35 + 0.3 use + 0.35 fill).
 *  SOIL (stock, saved): industry / landfill / toxic sources contaminate, slow decay; leaches into ground water. A closed
 *  landfill leaves brownfield soil (once, when the cell stops being landfill); its fill stays with the land, so zoning
 *  it again gives no fresh capacity, until a building occupies the cell.
 *  Emits layerUpdated('pollution') after the flags step.
 */
import { DevType, Network, Zone, isRoad } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { blurDown, blurDownAdd, blurSigma2, boxAverage, upsampleAdd } from './blur';
import {
  DX, DZ, Fam, activeJobs, detectJobsUnknown, ensureIdArray, ensureIdFloat, fundingFactor, infoOf, isFunctional, nowMs,
  readEffects, setFlagQuiet, activity, type DefInfo, type OrdEffects, buildingList, wealthOf,
} from './common';
import { getDef } from '../catalog';
import { ordinanceEffect } from '../economy/ordinances';
import { schedulerOf, sizeFactors } from './scheduler';
import { windVector, type WindVector } from './wind';
import { emergencyPollution } from './emergency';
import type { UtilitiesSystem } from './utilities';
import {
  AIR_K, AIR_PER_CS_JOB, AIR_PER_JOB, AIR_PER_TRIP, BANK_COUPLING, BANK_DIST, BRIDGE_NOISE, BROWNFIELD_BASE, BROWNFIELD_FILL,
  CONSTRUCTION_AIR, CONSTRUCTION_NOISE, FIRE_SMOKE, GARBAGE_BUILDUP_RATE, GARBAGE_DECAY, GARBAGE_PER_CIVIC_JOB,
  GARBAGE_NEWS_DAYS, GARBAGE_PER_JOB_C, GARBAGE_PER_JOB_I, GARBAGE_PER_RES, GARBAGE_SMELL, GARBAGE_TRUCK_RANGE, GARBAGE_UNPOWERED,
  HEAT_AIR_PER_RES, HEAT_CLIMATE, HEAT_WEALTH, INCIN_IDLE_ACT, LANDFILL_AIR, LANDFILL_CELL_CAP, LANDFILL_CELL_STOCK,
  LANDFILL_IDLE_EMIT, LANDFILL_SIZE_REF, LANDFILL_WARN_FILL, NET_BASE_NOISE, NOISE_CONG_DAMP, NOISE_CROSSING, NOISE_FREIGHT_RAIL, NOISE_K,
  NOISE_NIGHTLIFE, NOISE_PER_JOB, NOISE_PER_TRIP, NOISE_PER_TRIP_NET, NOISY_THRESHOLD, NO_GARBAGE_THRESHOLD,
  PARK_NOISE_ABSORB, PLANT_IDLE_ACT, POLLUTED_THRESHOLD, POLL_PEAK_GAIN, POLL_RADII, POLL_SMOOTH, RECYCLE_MAX_SHARE,
  SEWAGE_PER_RES, SOIL_DECAY, SOIL_GROUNDWATER, SOIL_RATE, SOIL_SRC_IND, SOIL_SRC_LANDFILL, SOIL_SRC_PLOPPED,
  TREATMENT_DEFAULT_CAP, TREATMENT_RES_PER_KL, TREE_AIR_ABSORB, TREE_COVER_RADIUS, TREE_NOISE_ABSORB, TUNNEL_AIR,
  TUNNEL_NOISE, WATER_K, WATER_POLL_PER_JOB, WIND_DRIFT_FAR, WIND_DRIFT_PREVAIL,
} from './params';

/** 1 - exp(-x) lookup table on [0, 16) (x beyond -> 1) */
const SAT_N = 4096, SAT_MAX = 16;
const SAT = new Float32Array(SAT_N + 1);
for (let i = 0; i <= SAT_N; i++) SAT[i] = 1 - Math.exp(-(i / SAT_N) * SAT_MAX);
/**
 * L[i] += (sat(field[i] * invK) x buffer(i) - L[i]) * alpha, skipping cells where mask[i] != 0;
 * buffer(i) = 1 - k1 buf1[i] - k2 buf2[i] (trees / parks absorb after saturation; null = none)
 */
function saturate(field: Float32Array, L: Float32Array, C: number, invK: number, alpha: number, mask: Uint8Array | null,
  buf1: Float32Array | null = null, k1 = 0, buf2: Float32Array | null = null, k2 = 0): void {
  const scale = (invK * SAT_N) / SAT_MAX;
  for (let i = 0; i < C; i++) {
    if (mask !== null && mask[i] !== 0) continue;
    const f = field[i];
    let t = 0;
    if (f > 0) {
      const u = f * scale;
      if (u >= SAT_N) t = 1;
      else { const k = u | 0; const a = SAT[k]; t = a + (SAT[k + 1] - a) * (u - k); }
      if (buf1 !== null) {
        let m = 1 - k1 * buf1[i];
        if (buf2 !== null) m -= k2 * buf2[i];
        t *= m > 0 ? m : 0;
      }
    }
    L[i] += (t - L[i]) * alpha;
  }
}

/**
 * per-cell source strength of an AREA source whose uniform district level is L: a uniform field s of class-0 sources
 * blurs to s x (peak gain x 2 pi sigma^2, sigma^2 = 8), so s = -K ln(1 - L) / that gain
 */
function areaSource(L: number, K: number): number {
  return (-Math.log(1 - Math.min(0.95, L)) * K) / (POLL_PEAK_GAIN * 2 * Math.PI * 8);
}

/** source strength per unit of intensity: peak field for intensity I is -K ln(1 - I) (layer = 1 - exp(-f/K)) */
function srcScale(K: number): number {
  return K / POLL_PEAK_GAIN;
}
/** catalog intensity (0..1 at the source, negative = cleaning) -> source strength for the blur model */
function intensityToSource(I: number, scale: number): number {
  if (I === 0) return 0;
  const a = Math.min(0.95, Math.abs(I));
  const v = -Math.log(1 - a) * scale;
  return I < 0 ? -v : v;
}

const IND_KEYS = ['IA', 'ID', 'IM', 'IHT'] as const;
/** share kept per diffusion iteration along water bodies (higher = spreads farther downstream) */
const WATER_DIFFUSE_KEEP = 0.975;
/** days between pollution updates */
export const POLL_PERIOD = 12;
/** steps of one pass */
const S_GARB_SRC = 0, S_GARB_ROUTE = 1, S_GARB_APPLY = 2, S_SRC_BLD = 3, S_SRC_CELLS = 4, S_AIR_NEAR = 5, S_AIR_FAR = 6,
  S_NOISE = 7, S_WATER = 8, S_FLAGS = 9;
const LAST_STEP = S_FLAGS;
/** garbage facility kinds */
const FK_OTHER = 0, FK_INCIN = 1, FK_RECYCLE = 2;

/** WP3 ordinance keys (sim-core ordinanceEffect; multiplicative, default 1) */
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

export interface GarbageInfo {
  /** tons / month produced */
  producedT: number;
  collected: boolean;
  /** uncollected pile level 0..1 (max over the footprint) */
  level: number;
  /**
   * why not collected: no capacity left, beyond garbage-truck range of every facility (or on a road network without
   * one), or no road on the building's edge at all (trucks cannot stop there)
   */
  reason?: 'capacity' | 'range' | 'noRoad';
}
export interface LandfillInfo {
  /** landfill cells in this connected landfill */
  cells: number;
  /** mean fill 0..1 */
  fill: number;
  /** tons / month it can take now (cells not full x per-cell capacity x funding) and tons / month dumped */
  capacityT: number;
  usedT: number;
  /** false = no road on its edge: garbage trucks cannot reach it */
  road: boolean;
}
export interface GarbageSummary {
  producedT: number;
  collectedT: number;
  recycledT: number;
  burnedT: number;
  landfilledT: number;
  /** produced by buildings beyond truck range / beyond capacity (t / month) */
  outOfRangeT: number;
  overCapacityT: number;
  outOfRangeBuildings: number;
  /** buildings (and their t / month) with no road on their edge: trucks cannot collect whatever the range */
  noRoadBuildings: number;
  noRoadT: number;
  /** mean landfill fill 0..1 and landfill capacity (t / month) */
  landfillFill: number;
  landfillCapT: number;
}

export class PollutionSystem implements SimSystem {
  readonly name = 'pollution';
  /** air sources by radius class (full / half / quarter resolution blur) */
  private air: Float32Array<ArrayBuffer>[] = [];
  /** water / noise sources by class (half / quarter resolution blur) */
  private waterS: Float32Array<ArrayBuffer>[] = [];
  private noiseS: Float32Array<ArrayBuffer>[] = [];
  /** non-empty flags: air 0..2, water 3..4, noise 5..6 */
  private usedCls = new Uint8Array(7);
  private tmp = new Float32Array(0);
  private tmp2 = new Float32Array(0);
  private coarse = new Float32Array(0);
  private coarseTmp = new Float32Array(0);
  /** half-resolution accumulator of the near air classes (plume step) */
  private coarseAcc = new Float32Array(0);
  /** ground-water level of land cells before bank coupling (persistent; water cells unused) */
  private ground = new Float32Array(0);
  /** park footprint mask and its blurred buffer; soil source per cell (this pass) */
  private parkMask = new Float32Array(0);
  private parkBuf = new Float32Array(0);
  private soilSrc = new Float32Array(0);
  private waterCells = new Int32Array(0);
  private waterNb = new Int32Array(0);
  /** bank land cells (within BANK_DIST of water) and the water cell each couples to */
  private bankCells = new Int32Array(0);
  private bankSrc = new Int32Array(0);
  private nWater = -1;
  private waterVersion = -1;
  private queue = new Int32Array(0);
  // ---- garbage (per building id)
  private served = new Int32Array(1024);
  private reach = new Int32Array(1024);
  private prodById = new Float32Array(1024);
  private reasonById = new Uint8Array(1024);
  /** incinerator burn share 0..1 (-1 unknown) */
  private incShare = new Float32Array(1024).fill(-1);
  /** total air source strength per building of the last pass (emissionOf) */
  private airById = new Float32Array(1024);
  private servedStamp = 0;
  private stamp = 0;
  // ---- garbage facilities of the current pass
  private facIds: number[] = [];
  private facCap: number[] = [];
  private facKind: number[] = [];
  private seeds = new Int32Array(0);
  private nSeeds = 0;
  /** truck distance (road cells) from the nearest garbage facility per cell (255 = beyond range); rebuilt on change */
  private roadDist = new Uint8Array(0);
  private routeDirty = true;
  private routeSig = -1;
  private bucketCount = new Int32Array(GARBAGE_TRUCK_RANGE + 1);
  private bDist = new Uint8Array(0);
  /** buildings reached by garbage trucks, nearest first (this pass) */
  private orderIds = new Int32Array(4096);
  // ---- landfill regions (labels of the last pass)
  private lfRegion = new Int32Array(0);
  private lfOrder = new Int32Array(0);
  private regStart: number[] = [];
  private regCount: number[] = [];
  private regRoad: boolean[] = [];
  private regCap: number[] = [];
  private regUsed: number[] = [];
  private nReg = 0;
  /** landfill cells of the last pass (closing a landfill leaves brownfield soil once); invalid until the first pass */
  private lfPrev = new Uint8Array(0);
  private lfPrevValid = false;
  /** incinerator ids of the last pass (their burn share is cleared when they disappear) */
  private incIds: number[] = [];
  private summary: GarbageSummary = {
    producedT: 0, collectedT: 0, recycledT: 0, burnedT: 0, landfilledT: 0, outOfRangeT: 0, overCapacityT: 0,
    outOfRangeBuildings: 0, noRoadBuildings: 0, noRoadT: 0, landfillFill: 0, landfillCapT: 0,
  };
  private capRec = 0;
  private capInc = 0;
  private capLf = 0;
  private lastRun = -1e9;
  private treesDirty = true;
  private parkDirty = true;
  private lastRangeNews = -1e9;
  private lastFillNews = -1e9;
  private simRef: Simulation | null = null;
  /** DefInfo per building id (ids are never reused and defs never change in place; known defs only) */
  private infos: DefInfo[] = [];
  /** treatment capacity (residents) found by the garbage-sources step of this pass */
  private treatCapB = 0;
  /** park set signature: the blurred park buffer is only rebuilt when parks change */
  private parkSig = -1;
  lastMs = 0;

  private unsub: (() => void)[] = [];

  init(sim: Simulation): void {
    for (const u of this.unsub) u();
    this.simRef = sim;
    // per-id caches do not survive a new city (replaceState: building ids start again from 1)
    this.infos = [];
    this.incShare.fill(-1);
    this.incIds = [];
    this.lfPrevValid = false;
    this.unsub = [
      sim.events.on('terrainChanged', () => this.invalidateWater()),
      sim.events.on('reset', () => { this.invalidateWater(); this.routeDirty = true; }),
      sim.events.on('treesChanged', () => { this.treesDirty = true; }),
      sim.events.on('networkChanged', () => { this.routeDirty = true; }),
    ];
    this.routeDirty = true;
    sim.state.systemData.infraVersion = 1;
    this.lastRun = -1e9;
    this.nWater = -1;
    this.stepIdx = -1;
    this.compute(sim, true);
    const self = this;
    schedulerOf(sim).register({
      name: 'pollution',
      due: (s) => self.stepIdx >= 0 || s.state.day - self.lastRun >= POLL_PERIOD,
      urgent: () => false,
      cost: (s) => self.stepCost(s),
      step: (s) => self.step(s),
    });
  }

  /** pass progress: -1 idle, else the next step (S_*) */
  private stepIdx = -1;
  private firstPass = false;
  private fxB: OrdEffects | null = null;
  private fx3B: Wp3Effects | null = null;
  private jobsUnknownB = false;
  private dtMonthsB = 0;

  daily(sim: Simulation): void {
    // the tree tool gives immediate feedback on the published treeCover layer (the buffers apply at the next pass)
    if (this.treesDirty && this.stepIdx < 0 && sim.state.treeCover.length === this.tmp.length) {
      this.treesDirty = false;
      this.updateTreeCover(sim.state);
    }
    schedulerOf(sim).tickDay(sim);
  }

  frame(sim: Simulation, _dt: number): void {
    schedulerOf(sim).tickFrame(sim, this);
  }

  private stepCost(sim: Simulation): number {
    const { cells, bld } = sizeFactors(sim);
    switch (this.stepIdx < 0 ? 0 : this.stepIdx) {
      // estimates ~1.3-1.6x the min measured ms on the 256² stress city (20k buildings) under load; each <= 3.0
      case S_GARB_SRC: return 1.1 * bld + 0.4 * cells;
      case S_GARB_ROUTE: return 0.6 * bld + (this.routeDirty ? 1.0 : 0.5) * cells;
      case S_GARB_APPLY: return 1.2 * bld + 0.4 * cells;
      case S_SRC_BLD: return 1.9 * bld + 0.3 * cells;
      case S_SRC_CELLS: return 1.6 * cells;
      case S_AIR_NEAR: return 2.0 * cells;
      case S_AIR_FAR: return 0.9 * cells;
      case S_NOISE: return 1.8 * cells;
      case S_WATER: return 2.2 * cells;
      default: return 1.0 * bld + 0.3 * cells;
    }
  }

  /** one step of the pollution pass */
  step(sim: Simulation): void {
    const t0 = nowMs();
    const k = this.stepIdx < 0 ? 0 : this.stepIdx;
    const first = this.firstPass;
    switch (k) {
      case S_GARB_SRC: this.garbageSources(sim, first); break;
      case S_GARB_ROUTE: this.garbageRoutes(sim); break;
      case S_GARB_APPLY: this.garbageApply(sim); break;
      case S_SRC_BLD: this.stageA(sim, first); break;
      case S_SRC_CELLS: this.stageCells(sim); break;
      case S_AIR_NEAR: this.stageAirNear(sim); break;
      case S_AIR_FAR: this.stageAir(sim, first); break;
      case S_NOISE: this.stageNoise(sim, first); break;
      case S_WATER: this.stageB(sim, first); break;
      default: this.stageFlags(sim); break;
    }
    this.stepIdx = k >= LAST_STEP ? -1 : k + 1;
    if (this.stepIdx < 0) this.firstPass = false;
    this.lastMs = nowMs() - t0;
  }

  /** full synchronous update (init / tests) */
  compute(sim: Simulation, first: boolean): void {
    const t0 = nowMs();
    this.stepIdx = -1;
    this.firstPass = first;
    do this.step(sim); while (this.stepIdx >= 0);
    this.lastMs = nowMs() - t0;
  }

  // ------------------------------------------------------------------------------------------ public queries
  /** garbage state of a building (last pass), null if unknown */
  garbageInfo(id: number): GarbageInfo | null {
    const st = this.simRef?.state;
    const b = st?.buildings.get(id);
    if (!st || !b || id >= this.prodById.length) return null;
    const producedT = this.prodById[id];
    const collected = producedT === 0 || this.served[id] === this.servedStamp;
    const N = st.size;
    let level = 0;
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const v = st.garbage[z * N + x];
      if (v > level) level = v;
    }
    const r = this.reasonById[id];
    return { producedT, collected, level, reason: collected ? undefined : r === 3 ? 'noRoad' : r === 2 ? 'range' : r === 1 ? 'capacity' : undefined };
  }

  /** landfill at a landfill-zoned cell (last pass), null if the cell is not landfill */
  landfillInfo(x: number, z: number): LandfillInfo | null {
    const st = this.simRef?.state;
    if (!st || !st.inBounds(x, z) || this.lfRegion.length !== st.cells) return null;
    const r = this.lfRegion[z * st.size + x];
    if (r < 0 || r >= this.nReg) return null;
    const s = this.regStart[r], n = this.regCount[r];
    let f = 0;
    for (let q = 0; q < n; q++) f += st.landfillFill[this.lfOrder[s + q]];
    return { cells: n, fill: n > 0 ? f / n : 0, capacityT: this.regCap[r], usedT: this.regUsed[r], road: this.regRoad[r] };
  }

  /** incinerator burn share 0..1 of its nominal capacity (last pass; -1 unknown / not an incinerator) */
  incineratorShare(id: number): number {
    return id >= 0 && id < this.incShare.length ? this.incShare[id] : -1;
  }

  /** city garbage balance of the last pass (advisors / stats panel) */
  garbageSummary(): Readonly<GarbageSummary> {
    return this.summary;
  }

  /** total air source strength of a building in the last pass (0 = none; for tests and the inspector) */
  emissionOf(id: number): number {
    return id >= 0 && id < this.airById.length ? this.airById[id] : 0;
  }

  private info(st: CityState, b: Building): DefInfo {
    let inf = this.infos[b.id];
    if (inf === undefined) {
      inf = infoOf(st, b);
      if (inf.known) this.infos[b.id] = inf;
    }
    return inf;
  }

  // ------------------------------------------------------------------------------------------ allocation
  private ensureCells(st: CityState): void {
    const N = st.size, C = st.cells;
    if (this.tmp.length !== C) {
      this.air = [new Float32Array(C), new Float32Array(C), new Float32Array(C)];
      this.waterS = [new Float32Array(C), new Float32Array(C)];
      this.noiseS = [new Float32Array(C), new Float32Array(C)];
      this.tmp = new Float32Array(C);
      this.tmp2 = new Float32Array(C);
      this.ground = new Float32Array(C);
      this.parkMask = new Float32Array(C);
      this.parkBuf = new Float32Array(C);
      this.soilSrc = new Float32Array(C);
      this.queue = new Int32Array(C);
      this.lfRegion = new Int32Array(C).fill(-1);
      this.lfPrev = new Uint8Array(C);
      this.lfPrevValid = false;
      this.seeds = new Int32Array(Math.max(1024, C >> 2));
      this.nWater = -1;
      // ground water of land cells starts from the saved layer
      const L = st.waterPollution, wm = st.water;
      for (let i = 0; i < C; i++) this.ground[i] = wm[i] ? 0 : L[i];
    }
    const M2 = Math.ceil(N / 2);
    if (this.coarse.length < M2 * M2) { this.coarse = new Float32Array(M2 * M2); this.coarseTmp = new Float32Array(M2 * M2); }
  }

  private ensureIds(st: CityState): void {
    this.served = ensureIdArray(this.served, st);
    this.reach = ensureIdArray(this.reach, st);
    this.prodById = ensureIdFloat(this.prodById, st);
    this.airById = ensureIdFloat(this.airById, st);
    this.incShare = ensureIdFloat(this.incShare, st, -1);
    if (this.reasonById.length < this.served.length) {
      const r = new Uint8Array(this.served.length);
      r.set(this.reasonById);
      this.reasonById = r;
    }
  }

  private pushSeed(i: number): void {
    if (this.nSeeds >= this.seeds.length) {
      const s = new Int32Array(this.seeds.length * 2);
      s.set(this.seeds);
      this.seeds = s;
    }
    this.seeds[this.nSeeds++] = i;
  }

  // ------------------------------------------------------------------------------------------ garbage
  /** step 0: pass start, garbage production, facilities, landfill regions */
  private garbageSources(sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    this.ensureCells(st);
    this.ensureIds(st);
    const dtMonths = first ? 0 : Math.min(2, (st.day - this.lastRun) / 30);
    this.lastRun = st.day;
    const fx = readEffects(st);
    this.fxB = fx;
    this.fx3B = wp3Effects(st);
    const jobsUnknown = detectJobsUnknown(st);
    this.jobsUnknownB = jobsUnknown;
    this.dtMonthsB = dtMonths;
    const funding = Math.min(1.2, fundingFactor(st, 'utilities'));
    const prod = this.prodById;
    this.nSeeds = 0;
    this.facIds.length = 0; this.facCap.length = 0; this.facKind.length = 0;
    let produced = 0, capRec = 0, capInc = 0, capOther = 0, treatCap = 0;
    const util = Math.min(1, fundingFactor(st, 'utilities'));
    const list = buildingList(st);
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const inf = this.info(st, b);
      prod[b.id] = 0;
      // treatment capacity -> sewage reduction (stageA)
      if (inf.isTreatment && isFunctional(b)) {
        treatCap += (inf.capacity > 0 ? inf.capacity : inf.waterOut > 0 ? inf.waterOut * TREATMENT_RES_PER_KL : TREATMENT_DEFAULT_CAP) * util;
      }
      if (inf.garbageCap > 0) {
        if (!isFunctional(b)) continue;
        const n0 = this.nSeeds;
        this.seedPerimeter(st, b);
        // a facility needs a road on its perimeter (trucks) and power (x GARBAGE_UNPOWERED without)
        const cap = this.nSeeds > n0 ? inf.garbageCap * funding * ((b.flags & BF.Powered) !== 0 ? 1 : GARBAGE_UNPOWERED) : 0;
        const kind = inf.isRecycling ? FK_RECYCLE : inf.isIncinerator ? FK_INCIN : FK_OTHER;
        this.facIds.push(b.id); this.facCap.push(cap); this.facKind.push(kind);
        if (kind === FK_RECYCLE) capRec += cap;
        else if (kind === FK_INCIN) capInc += cap;
        else capOther += cap;
        continue;
      }
      if (!isFunctional(b)) continue;
      let p = 0;
      if (inf.garbage > 0) p = inf.garbage * (inf.fam === Fam.Plop ? 1 : activity(inf, b, jobsUnknown)); // catalog: t/month at full occupancy
      else if (inf.fam === Fam.R) p = b.pop * GARBAGE_PER_RES;
      else if (inf.fam === Fam.C) p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_JOB_C;
      else if (inf.fam === Fam.I) p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_JOB_I[IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))]];
      else p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_CIVIC_JOB;
      p *= fx.garbage;
      if (p > 0) { prod[b.id] = p; produced += p; }
    }
    // landfill regions (flood fill of empty landfill-zoned cells; usable if a road touches the region)
    const zone = st.zone, bld = st.building, net = st.network, fill = st.landfillFill;
    const lab = this.lfRegion, order = this.queue, lfPrev = this.lfPrev;
    lab.fill(-1);
    this.regStart.length = 0; this.regCount.length = 0; this.regRoad.length = 0; this.regCap.length = 0; this.regUsed.length = 0;
    const lfCellCap = (getDef('util_landfill_tile')?.garbageCapacity ?? LANDFILL_CELL_CAP) * Math.max(0.5, Math.min(1, funding));
    let nReg = 0, qt = 0, capLf = 0;
    const track = this.lfPrevValid;
    for (let s = 0; s < C; s++) {
      if (zone[s] !== Zone.Landfill || bld[s] >= 0) {
        // a landfill cell closed since the last pass (dezoned / rezoned / built over) leaves contaminated brownfield
        // soil, once. Its fill stays (zoning it as landfill again carries on from there, no free capacity) until a
        // building occupies the cell.
        if (lfPrev[s] !== 0) {
          lfPrev[s] = 0;
          if (track && fill[s] > 0.05) st.soil[s] = Math.max(st.soil[s], Math.min(1, BROWNFIELD_BASE + BROWNFIELD_FILL * fill[s]));
        }
        if (bld[s] >= 0 && fill[s] !== 0) fill[s] = 0;
        continue;
      }
      lfPrev[s] = 1;
      if (lab[s] >= 0) continue;
      const r = nReg++;
      const start = qt;
      let qh = qt;
      order[qt++] = s;
      lab[s] = r;
      let road = false;
      const seedMark = this.nSeeds;
      while (qh < qt) {
        const i = order[qh++];
        const x = i % N, z = (i - x) / N;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], nz = z + DZ[k];
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const j = nz * N + nx;
          if (isRoad(net[j] as Network)) { road = true; this.pushSeed(j); }
          if (zone[j] === Zone.Landfill && bld[j] < 0 && lab[j] < 0) { lab[j] = r; order[qt++] = j; }
        }
      }
      let cap = 0;
      if (road) { for (let q = start; q < qt; q++) if (fill[order[q]] < 1) cap += lfCellCap; }
      else this.nSeeds = seedMark;
      this.regStart.push(start); this.regCount.push(qt - start); this.regRoad.push(road); this.regCap.push(cap); this.regUsed.push(0);
      capLf += cap;
    }
    if (this.lfOrder.length < qt) this.lfOrder = new Int32Array(Math.max(qt, 256) * 2);
    this.lfOrder.set(order.subarray(0, qt));
    this.nReg = nReg;
    this.lfPrevValid = true;
    // other disposal facilities (mods / test defs without a kind) count as landfill capacity
    this.capRec = capRec;
    this.capInc = capInc;
    this.capLf = capLf + capOther;
    this.summary.producedT = produced;
    this.treatCapB = treatCap;
  }

  /** step 1: truck-range BFS from the facilities, nearest-first capacity allocation, burn / landfill shares */
  private garbageRoutes(sim: Simulation): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    // buildings may have appeared since the sources step (a later scheduler slot): per-id arrays must cover their ids
    // (a read past the end gives undefined -> NaN production / recycling -> NaN funds)
    this.ensureIds(st);
    const prod = this.prodById, served = this.served, reach = this.reach, reason = this.reasonById;
    const stamp = ++this.stamp;
    const sStamp = ++this.stamp;
    this.servedStamp = sStamp;
    // truck distance (road cells) from the nearest facility: multi-source BFS over roads, rerun only when the road
    // network or the facility entrances change
    const seeds = this.seeds;
    let sig = this.nSeeds;
    for (let q = 0; q < this.nSeeds; q++) sig = (sig * 31 + seeds[q]) % 2147483647;
    // cheap road checksum too, so direct layer edits (tests, sandbox tools) without networkChanged are picked up
    const net = st.network;
    let ns = 0;
    for (let i = 0; i < C; i++) if (net[i] !== 0) ns = (ns + (i + 1) * net[i]) % 2147483647;
    sig = (sig * 7 + ns) % 2147483647;
    if (this.routeDirty || sig !== this.routeSig || this.roadDist.length !== C) {
      this.routeDirty = false;
      this.routeSig = sig;
      this.truckBfs(st);
    }
    const rd = this.roadDist;
    // buildings by truck distance of their best perimeter road cell (counting sort: nearest first)
    const R = GARBAGE_TRUCK_RANGE;
    const bucket = this.bucketCount;
    bucket.fill(0);
    const list = buildingList(st);
    const bd = this.bDist.length >= list.length ? this.bDist : (this.bDist = new Uint8Array(list.length * 2 + 64));
    let reachProd = 0;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      let m = 255;
      const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d;
      for (let x = x0; x < x1; x++) {
        if (z0 > 0) { const v = rd[(z0 - 1) * N + x]; if (v < m) m = v; }
        if (z1 < N) { const v = rd[z1 * N + x]; if (v < m) m = v; }
      }
      for (let z = z0; z < z1; z++) {
        if (x0 > 0) { const v = rd[z * N + x0 - 1]; if (v < m) m = v; }
        if (x1 < N) { const v = rd[z * N + x1]; if (v < m) m = v; }
      }
      bd[bI] = m;
      if (m <= R) { bucket[m]++; reach[b.id] = stamp; reachProd += prod[b.id]; }
    }
    let acc = 0;
    for (let d = 0; d <= R; d++) { const c = bucket[d]; bucket[d] = acc; acc += c; }
    const nOrder = acc;
    if (this.orderIds.length < nOrder) this.orderIds = new Int32Array(nOrder * 2);
    const orderIds = this.orderIds;
    for (let bI = 0; bI < list.length; bI++) {
      const m = bd[bI];
      if (m <= R) orderIds[bucket[m]++] = list[bI].id;
    }
    // capacity: recycling (at most RECYCLE_MAX_SHARE of what is collected) + incineration + landfill, nearest first
    const capRecUse = Math.min(this.capRec, RECYCLE_MAX_SHARE * reachProd);
    const K = capRecUse + this.capInc + this.capLf;
    let left = K, collected = 0, overCap = 0;
    const ord = this.orderIds;
    for (let q = 0; q < nOrder; q++) {
      const bid = ord[q];
      const p = prod[bid];
      if (p === 0) { served[bid] = sStamp; reason[bid] = 0; continue; }
      if (left > 0) { left -= p; collected += p; served[bid] = sStamp; reason[bid] = 0; }
      else { reason[bid] = 1; overCap += p; }
    }
    const handled = Math.min(collected, K);
    const recycled = Math.min(this.capRec, RECYCLE_MAX_SHARE * handled);
    const burned = Math.min(this.capInc, handled - recycled);
    const landfilled = Math.max(0, Math.min(this.capLf, handled - recycled - burned));
    // per facility use (incinerators that disappeared since the last pass lose their share)
    const incShare = this.incShare;
    for (const id of this.incIds) if (id < incShare.length) incShare[id] = -1;
    this.incIds.length = 0;
    for (let f = 0; f < this.facIds.length; f++) {
      const id = this.facIds[f];
      if (this.facKind[f] !== FK_INCIN) continue;
      const b = st.buildings.get(id);
      const nominal = b ? infoOf(st, b).garbageCap : 0;
      incShare[id] = nominal > 0 && this.capInc > 0 ? Math.min(1, (burned * this.facCap[f]) / this.capInc / nominal) : 0;
      this.incIds.push(id);
    }
    const lfTotal = this.capLf;
    for (let r = 0; r < this.nReg; r++) this.regUsed[r] = lfTotal > 0 ? (landfilled * this.regCap[r]) / lfTotal : 0;
    const sm = this.summary;
    sm.collectedT = handled;
    sm.recycledT = recycled;
    sm.burnedT = burned;
    sm.landfilledT = landfilled;
    sm.overCapacityT = overCap;
    sm.landfillCapT = this.capLf;
    st.stats.garbageProduced = sm.producedT;
    st.stats.garbageCapacity = Math.min(this.capRec, RECYCLE_MAX_SHARE * sm.producedT) + this.capInc + this.capLf;
    st.stats.garbageRecycled = recycled;
  }

  /** step 2: piles build up / clear, BF.NoGarbage, landfill fill (stock) and display */
  private garbageApply(sim: Simulation): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const bld = st.building, zone = st.zone;
    const G = st.garbage, fill = st.landfillFill;
    const dtMonths = this.dtMonthsB;
    this.ensureIds(st);
    const prod = this.prodById, served = this.served, reach = this.reach, reason = this.reasonById;
    const sStamp = this.servedStamp, rStamp = sStamp - 1;
    const changed: Building[] = [];
    let outRange = 0, outRangeN = 0, outRangeX = -1, outRangeZ = -1, noRoad = 0, noRoadN = 0;
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const p = prod[b.id];
      const ok = p === 0 || served[b.id] === sStamp;
      if (!ok && reach[b.id] !== rStamp) {
        if (roadOnEdge(st, b)) {
          reason[b.id] = 2; outRange += p;
          if (outRangeN++ === 0) { outRangeX = b.x; outRangeZ = b.z; }
        } else { reason[b.id] = 3; noRoad += p; noRoadN++; }
      }
      const area = b.w * b.d;
      const rate = GARBAGE_BUILDUP_RATE * dtMonths * (0.6 + 0.4 * Math.min(1, p / area / 0.3));
      let level = 0;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        if (bld[i] !== b.id) continue;
        let g = G[i];
        if (ok) g *= 1 - GARBAGE_DECAY;
        else g = Math.min(1, g + rate);
        G[i] = g;
        if (g > level) level = g;
      }
      if (setFlagQuiet(b, BF.NoGarbage, level > NO_GARBAGE_THRESHOLD)) changed.push(b);
    }
    // landfill: dumped tons fill the region's cells in order; display level on the garbage layer
    const lab = this.lfRegion, lfOrder = this.lfOrder;
    let fillSum = 0, lfCells = 0;
    for (let r = 0; r < this.nReg; r++) {
      const s = this.regStart[r], n = this.regCount[r];
      let tons = this.regUsed[r] * dtMonths;
      for (let q = 0; q < n && tons > 0; q++) {
        const i = lfOrder[s + q];
        const f = fill[i];
        if (f >= 1) continue;
        const add = Math.min(tons, (1 - f) * LANDFILL_CELL_STOCK);
        fill[i] = Math.min(1, f + add / LANDFILL_CELL_STOCK);
        tons -= add;
      }
      const use = this.regCap[r] > 0 ? Math.min(1, this.regUsed[r] / this.regCap[r]) : 0;
      for (let q = 0; q < n; q++) {
        const i = lfOrder[s + q];
        G[i] = Math.min(1, 0.35 + 0.3 * use + 0.35 * fill[i]);
        fillSum += fill[i];
      }
      lfCells += n;
    }
    // other cells (roads, empty lots, demolished buildings): leftovers blow away
    for (let i = 0; i < C; i++) if (bld[i] < 0 && lab[i] < 0 && G[i] !== 0) G[i] *= 0.5;
    const sm = this.summary;
    sm.outOfRangeT = outRange;
    sm.outOfRangeBuildings = outRangeN;
    sm.noRoadT = noRoad;
    sm.noRoadBuildings = noRoadN;
    sm.landfillFill = lfCells > 0 ? fillSum / lfCells : 0;
    st.stats.landfillFill = sm.landfillFill;
    for (const b of changed) sim.events.emit('buildingChanged', b);
    this.garbageNews(sim, outRangeN, outRangeX, outRangeZ);
  }

  /** legible feedback for the new garbage rules: out-of-range districts and filling landfills (news, with cooldowns) */
  private garbageNews(sim: Simulation, outRangeN: number, x: number, z: number): void {
    const st = sim.state;
    if (this.dtMonthsB <= 0 || st.stats.population < 1000) return;
    const sm = this.summary;
    if (outRangeN >= 10 && sm.outOfRangeT > 0.05 * sm.producedT && st.day - this.lastRangeNews >= GARBAGE_NEWS_DAYS) {
      this.lastRangeNews = st.day;
      const why = this.capInc + this.capRec + this.capLf > 0
        ? `are more than ${GARBAGE_TRUCK_RANGE} road tiles from a landfill, incinerator or recycling center (or not connected to one)`
        : 'have no landfill, incinerator or recycling center to take their garbage';
      const nr = sm.noRoadBuildings > 0 ? ` ${sm.noRoadBuildings.toLocaleString('en-US')} more have no road for the trucks at all.` : '';
      sim.notify(`Garbage is piling up: trucks can't reach ${outRangeN.toLocaleString('en-US')} buildings — they ${why}.${nr}`, 'warning', x, z, 'utilities');
    }
    if (sm.landfillCapT > 0 && sm.landfillFill >= LANDFILL_WARN_FILL && st.day - this.lastFillNews >= GARBAGE_NEWS_DAYS * 2) {
      this.lastFillNews = st.day;
      sim.notify(`Landfills are ${Math.round(sm.landfillFill * 100)}% full. Zone more landfill or build an incinerator / recycling center before they close.`, 'warning', undefined, undefined, 'utilities');
    }
  }

  /** distance-limited multi-source BFS over road cells from the facility entrances (seeds) into roadDist */
  private truckBfs(st: CityState): void {
    const N = st.size, C = st.cells, net = st.network;
    if (this.roadDist.length !== C) this.roadDist = new Uint8Array(C);
    const rd = this.roadDist, queue = this.queue;
    rd.fill(255);
    let qh = 0, qt = 0;
    for (let q = 0; q < this.nSeeds; q++) {
      const s = this.seeds[q];
      if (rd[s] === 0) continue;
      rd[s] = 0;
      queue[qt++] = s;
    }
    const R = GARBAGE_TRUCK_RANGE;
    while (qh < qt) {
      const i = queue[qh++];
      const d = rd[i] + 1;
      if (d > R) continue;
      const x = i % N;
      let j = i + 1;
      if (x < N - 1 && rd[j] === 255 && net[j] >= Network.Street && net[j] <= Network.Highway) { rd[j] = d; queue[qt++] = j; }
      j = i - 1;
      if (x > 0 && rd[j] === 255 && net[j] >= Network.Street && net[j] <= Network.Highway) { rd[j] = d; queue[qt++] = j; }
      j = i + N;
      if (j < C && rd[j] === 255 && net[j] >= Network.Street && net[j] <= Network.Highway) { rd[j] = d; queue[qt++] = j; }
      j = i - N;
      if (j >= 0 && rd[j] === 255 && net[j] >= Network.Street && net[j] <= Network.Highway) { rd[j] = d; queue[qt++] = j; }
    }
  }

  private seedPerimeter(st: CityState, b: Building): void {
    const N = st.size;
    for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      if (x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d) continue;
      const i = z * N + x;
      if (isRoad(st.network[i] as Network)) this.pushSeed(i);
    }
  }

  // ------------------------------------------------------------------------------------------ sources
  /** step 3 (stageA): sources of every building */
  private stageA(sim: Simulation, _first: boolean): void {
    const st = sim.state;
    const N = st.size;
    this.ensureCells(st);
    this.ensureIds(st);
    const fx = this.fxB ?? readEffects(st);
    const fx3 = this.fx3B ?? wp3Effects(st);
    const jobsUnknown = this.jobsUnknownB;
    const air = this.air, waterS = this.waterS, noiseS = this.noiseS;
    for (const a of air) a.fill(0);
    for (const a of waterS) a.fill(0);
    for (const a of noiseS) a.fill(0);
    const park = this.parkMask, soilSrc = this.soilSrc;
    park.fill(0);
    soilSrc.fill(0);
    const used = this.usedCls;
    used.fill(0);
    const list = buildingList(st);

    // treatment capacity (garbage-sources step) -> sewage reduction (published: stats.sewageTreated, read by utilities)
    const util = Math.min(1, fundingFactor(st, 'utilities'));
    const treatCap = this.treatCapB;
    const pop = Math.max(1, st.stats.population || 0);
    const treated = Math.min(1, treatCap / pop);
    st.stats.sewageTreated = treatCap > 0 ? treated : 0;
    const sewageMul = (1 - 0.9 * treated) * fx.water * fx3.sewage;
    const airK = srcScale(AIR_K), waterK = srcScale(WATER_K), noiseK = srcScale(NOISE_K);
    const utilities = sim.getSystem<UtilitiesSystem>('utilities');
    // residential heating: winter peak (day-of-year), climate
    const winter = 0.5 + 0.5 * Math.cos((2 * Math.PI * ((st.day % 360) + 15)) / 360);
    const heat = HEAT_AIR_PER_RES * (0.6 + 0.8 * winter) * (HEAT_CLIMATE[st.config.climate] ?? 1) * fx.air;
    // area-calibrated per-cell sources (x footprint area below): district level L -> -ln(1 - L) K / uniform class-0 gain
    const nightSrc = areaSource(NOISE_NIGHTLIFE, NOISE_K) * fx3.noise;
    const conAir = areaSource(CONSTRUCTION_AIR, AIR_K) * fx.air;
    const conNoise = areaSource(CONSTRUCTION_NOISE, NOISE_K) * fx3.noise;
    const fireAir = intensityToSource(FIRE_SMOKE, airK);
    const zone = st.zone;
    const airById = this.airById, incShare = this.incShare;

    let parkSig = 0;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const inf = this.info(st, b);
      const flags = b.flags;
      const onFire = (flags & BF.OnFire) !== 0;
      const functional = isFunctional(b);
      const constructing = !functional && (flags & BF.Constructing) !== 0 && (flags & (BF.Burnt | BF.Abandoned)) === 0;
      airById[b.id] = 0;
      if (!functional && !onFire && !constructing) continue;
      const area = b.w * b.d;
      // def-class sources (a, w, nz in class ca / cw / cn) + small-radius extras (class 0)
      let a = 0, w = 0, nz = 0, aS = 0, wS = 0, nS = 0;
      let ca = 1, cw = 0, cn = 0;
      if (functional) {
        const act0 = activity(inf, b, jobsUnknown);
        let act = 0.3 + 0.7 * act0;
        if (inf.powerOut > 0 && !inf.isIncinerator) {
          const load = utilities ? utilities.plantLoad(b.id) : -1;
          if (load >= 0) act = PLANT_IDLE_ACT + (1 - PLANT_IDLE_ACT) * load;
          // a plant delivering nothing (shut down by the nuclear-free zone) neither smokes nor hums
          if (utilities && utilities.producerInfo(b.id)?.output === 0) act = 0;
        } else if (inf.isIncinerator) {
          const s = incShare[b.id];
          if (s >= 0) act = INCIN_IDLE_ACT + (1 - INCIN_IDLE_ACT) * s;
        }
        const industrial = inf.fam === Fam.I || inf.powerOut > 0;
        const airMul = fx.air * (industrial ? fx.airIndustry : 1) * (inf.category === 'power' ? fx3.airPower : 1);
        const waterMul = fx.water * (inf.fam === Fam.I ? fx.waterIndustry : 1);
        const noiseMul = inf.fam === Fam.C || inf.fam === Fam.I ? fx3.noise : 1;
        if (inf.air !== 0 || inf.waterPoll !== 0 || inf.noise !== 0) {
          // catalog semantics: intensity (0..1 overlay scale) at the source, falling off to 0 at radius
          const R = inf.pollRadius > 0 ? inf.pollRadius : 3;
          ca = R <= 6 ? 0 : R <= 13 ? 1 : 2;
          cw = cn = R <= 8 ? 0 : 1;
          a = intensityToSource(inf.air, airK) * act * airMul;
          w = intensityToSource(inf.waterPoll, waterK) * (inf.waterPoll > 0 ? act * waterMul : util);
          nz = intensityToSource(inf.noise, noiseK) * act * noiseMul;
          if (inf.waterPoll > 0 && inf.fam === Fam.Plop) {
            const sv = SOIL_SRC_PLOPPED * inf.waterPoll * act;
            for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if (x < N && z < N) soilSrc[z * N + x] += sv;
          }
        } else if (inf.fam === Fam.I) {
          // fallback when the def carries no explicit pollution: per active job by industry type
          const k = IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))];
          const j = activeJobs(inf, b, jobsUnknown);
          a = j * AIR_PER_JOB[k] * airMul;
          w = j * WATER_POLL_PER_JOB[k] * waterMul;
          nz = j * NOISE_PER_JOB[k] * noiseMul;
        }
        if (inf.fam === Fam.I) {
          const sv = SOIL_SRC_IND[IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))]] * act0;
          if (sv > 0) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if (x < N && z < N) soilSrc[z * N + x] += sv;
        } else if (inf.fam === Fam.R) {
          wS += b.pop * SEWAGE_PER_RES * sewageMul;
          aS += b.pop * heat * HEAT_WEALTH[wealthOf(inf, b) - 1];
        } else if (inf.fam === Fam.C) {
          if (inf.dev >= DevType.CS1 && inf.dev <= DevType.CS3) aS += activeJobs(inf, b, jobsUnknown) * AIR_PER_CS_JOB * fx.air;
          if ((inf.dev === DevType.CS2 || inf.dev === DevType.CS3) && zone[b.z * N + b.x] === Zone.ComHigh) nS += nightSrc * act0 * area;
        }
        if (inf.isPark) {
          parkSig = (parkSig * 31 + b.id * 7 + b.x * 3 + b.z) % 1000000007;
          for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if (x < N && z < N) park[z * N + x] = 1;
        }
      } else if (constructing) {
        aS += conAir * area;
        nS += conNoise * area;
      }
      if (onFire) aS += fireAir * Math.sqrt(area);
      if (a === 0 && w === 0 && nz === 0 && aS === 0 && wS === 0 && nS === 0) continue;
      airById[b.id] = a + aS;
      const inv = 1 / area;
      const ia = a * inv, iw = w * inv, inz = nz * inv, iaS = aS * inv, iwS = wS * inv, inS = nS * inv;
      const A = air[ca], W = waterS[cw], Nz = noiseS[cn], A0 = air[0], W0 = waterS[0], N0 = noiseS[0];
      if (ia !== 0) used[ca] = 1;
      if (iw !== 0) used[3 + cw] = 1;
      if (inz !== 0) used[5 + cn] = 1;
      if (iaS !== 0) used[0] = 1;
      if (iwS !== 0) used[3] = 1;
      if (inS !== 0) used[5] = 1;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        A[i] += ia; W[i] += iw; Nz[i] += inz;
        A0[i] += iaS; W0[i] += iwS; N0[i] += inS;
      }
    }
    if (parkSig !== this.parkSig) { this.parkSig = parkSig; this.parkDirty = true; }
    // emergency incidents (WP8): spills / industrial fires, splatted like plopped emitters
    const em = emergencyPollution(sim);
    for (let k = 0; k < em.length; k++) {
      const e = em[k];
      if (!st.inBounds(e.x, e.z)) continue;
      const i = e.z * N + e.x;
      const R = e.radius > 0 ? e.radius : 3;
      const cA = R <= 6 ? 0 : R <= 13 ? 1 : 2, cW = R <= 8 ? 0 : 1;
      if (e.air) { air[cA][i] += intensityToSource(e.air, airK) * fx.air; used[cA] = 1; }
      if (e.water) { waterS[cW][i] += intensityToSource(e.water, waterK) * fx.water; used[3 + cW] = 1; }
    }
  }

  /** step 4: traffic / network / landfill / pile / soil cell sources, tree cover + park buffer */
  private stageCells(sim: Simulation): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const fx = this.fxB ?? readEffects(st);
    const fx3 = this.fx3B ?? wp3Effects(st);
    const airK = srcScale(AIR_K), waterK = srcScale(WATER_K), noiseK = srcScale(NOISE_K);
    const traffic = st.traffic, cong = st.congestion, net = st.network, nf = st.netFlags, bld = st.building;
    const A0 = this.air[0], W0 = this.waterS[0], N0 = this.noiseS[0];
    const used = this.usedCls;
    const trafficAir = AIR_PER_TRIP * fx.air;
    const tn = fx3.noiseTraffic;
    const perTrip = NOISE_PER_TRIP_NET, base = baseNoiseSources(noiseK);
    const crossing = intensityToSource(NOISE_CROSSING, noiseK) * tn;
    let anyA = false, anyN = false, anyW = false;
    // uncollected garbage piles smell; contaminated soil leaches into ground water
    const G = st.garbage, soil = st.soil;
    const smell = areaSource(GARBAGE_SMELL, AIR_K) * fx.air;
    for (let i = 0; i < C; i++) {
      const g = G[i];
      if (g > 0.02 && bld[i] >= 0) { A0[i] += smell * g; anyA = true; }
      const so = soil[i];
      if (so > 0.005) { W0[i] += intensityToSource(SOIL_GROUNDWATER * so, waterK); anyW = true; }
      const n = net[i];
      if (n === 0) continue;
      const t = traffic[i];
      const f = nf[i];
      let nz = 0;
      if (n <= Network.Highway) {
        if (t > 0) {
          const c = cong[i];
          A0[i] += t * trafficAir * (1 + (c < 2 ? c : 2)) * ((f & 2) !== 0 ? TUNNEL_AIR : 1);
          anyA = true;
          const damp = c > 1 ? 1 - NOISE_CONG_DAMP * (c < 2 ? c - 1 : 1) : 1;
          nz = t * perTrip[n] * damp;
        }
        nz += base[n];
        if ((f & 0x20) !== 0) nz += crossing;
      } else if (n === Network.Rail) nz = t * NOISE_PER_TRIP * 0.2 + base[Network.Rail];
      if (nz > 0) {
        if ((f & 2) !== 0) nz *= TUNNEL_NOISE;
        else if ((f & 1) !== 0) nz *= BRIDGE_NOISE;
        N0[i] += nz * tn;
        anyN = true;
      }
    }
    // freight trains (WP7 exposes the cells of freight routes; skipped until then)
    const tr = sim.getSystem('traffic') as unknown as { freightRailCells?: () => ArrayLike<number> } | undefined;
    const fr = typeof tr?.freightRailCells === 'function' ? tr.freightRailCells() : null;
    if (fr && fr.length > 0) {
      const s = intensityToSource(NOISE_FREIGHT_RAIL, noiseK) * tn;
      for (let k = 0; k < fr.length; k++) { const i = fr[k]; if (i >= 0 && i < C) N0[i] += s; }
      anyN = true;
    }
    if (anyA) used[0] = 1;
    if (anyN) used[5] = 1;
    if (anyW) used[3] = 1;
    // landfill cells: emission by use, damped for big landfills (sources do not add up without bound)
    const lf = getDef('util_landfill_tile')?.pollution;
    const lfAir = lf ? intensityToSource(lf.air ?? 0, airK) * fx.air : LANDFILL_AIR;
    const lfWater = lf ? intensityToSource(lf.water ?? 0, waterK) * fx.water : 0;
    const lfNoise = lf ? intensityToSource(lf.noise ?? 0, noiseK) : 0;
    const soilSrc = this.soilSrc;
    for (let r = 0; r < this.nReg; r++) {
      const s = this.regStart[r], n = this.regCount[r];
      const use = this.regCap[r] > 0 ? Math.min(1, this.regUsed[r] / this.regCap[r]) : 0;
      const act = LANDFILL_IDLE_EMIT + (1 - LANDFILL_IDLE_EMIT) * use;
      const m = act / Math.sqrt(Math.max(1, n / LANDFILL_SIZE_REF));
      for (let q = 0; q < n; q++) {
        const i = this.lfOrder[s + q];
        A0[i] += lfAir * m; W0[i] += lfWater * m; N0[i] += lfNoise * m;
        soilSrc[i] += SOIL_SRC_LANDFILL * act;
      }
      if (n > 0) { used[0] = 1; used[3] = 1; used[5] = 1; }
    }
    // tree cover (published) and the park buffer only change with trees / parks
    if (this.treesDirty || this.firstPass) { this.treesDirty = false; this.updateTreeCover(st); }
    if (this.parkDirty || this.firstPass) { this.parkDirty = false; boxAverage(this.parkMask, this.parkBuf, this.tmp2, N, TREE_COVER_RADIUS); }
  }

  /** treeCover = (2r+1)^2 box average of trees / 4 (published, derived: also computed in init) */
  private updateTreeCover(st: CityState): void {
    const C = st.cells, trees = st.trees, t = this.tmp;
    for (let i = 0; i < C; i++) t[i] = trees[i] * 0.25;
    boxAverage(t, st.treeCover, this.tmp2, st.size, TREE_COVER_RADIUS);
  }

  /**
   * blur one air class at reduced resolution into `field` as a wind plume: the average of two copies drifted by d/2
   * and d downwind (the shift is applied while upsampling, so it costs no extra pass)
   */
  private plume(src: Float32Array, field: Float32Array, N: number, f: number, r: number, gain: number, w: WindVector, d: number): void {
    blurDown(src, N, f, r, this.coarse, this.coarseTmp);
    upsampleAdd(this.coarse, field, N, f, gain * 0.5, w.x * d * 0.5, w.z * d * 0.5);
    upsampleAdd(this.coarse, field, N, f, gain * 0.5, w.x * d, w.z * d);
  }

  /** step 5: small / medium emitter classes (half resolution) into the air field (this.tmp2) */
  private stageAirNear(sim: Simulation): void {
    const st = sim.state;
    const N = st.size, air = this.air, used = this.usedCls;
    const field = this.tmp2;
    field.fill(0);
    if (!used[0] && !used[1]) return;
    // both classes blur at half resolution into one coarse field (class 0: radius 1 -> sigma^2 = 4 * 2 = 8 cells^2,
    // ~ full-res radius 2), then the plume: the average of two copies drifted d/2 and d downwind (as for the far class)
    const M = Math.ceil(N / 2), MM = M * M;
    if (this.coarseAcc.length < MM) this.coarseAcc = new Float32Array(MM);
    const acc = this.coarseAcc, coarse = this.coarse;
    acc.fill(0, 0, MM);
    if (used[0]) {
      blurDown(air[0], N, 2, 1, coarse, this.coarseTmp);
      const g = POLL_PEAK_GAIN * 2 * Math.PI * 8;
      for (let m = 0; m < MM; m++) acc[m] += coarse[m] * g;
    }
    if (used[1]) {
      const rr = Math.max(1, Math.round(POLL_RADII[1] / 2));
      blurDown(air[1], N, 2, rr, coarse, this.coarseTmp);
      const g = POLL_PEAK_GAIN * 2 * Math.PI * 4 * blurSigma2(rr);
      for (let m = 0; m < MM; m++) acc[m] += coarse[m] * g;
    }
    const w = windVector(st), d = WIND_DRIFT_PREVAIL;
    upsampleAdd(acc, field, N, 2, 0.5, w.x * d * 0.5, w.z * d * 0.5);
    upsampleAdd(acc, field, N, 2, 0.5, w.x * d, w.z * d);
  }

  /** step 6: large emitters (quarter resolution, long plumes), saturation + tree absorption + smoothing */
  private stageAir(sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const air = this.air, used = this.usedCls;
    const field = this.tmp2;
    if (used[2]) {
      const rr = Math.max(1, Math.round(POLL_RADII[2] / 4));
      this.plume(air[2], field, N, 4, rr, POLL_PEAK_GAIN * 2 * Math.PI * 16 * blurSigma2(rr), windVector(st), WIND_DRIFT_FAR);
    }
    saturate(field, st.airPollution, C, 1 / AIR_K, first ? 1 : POLL_SMOOTH, null, st.treeCover, TREE_AIR_ABSORB);
  }

  /** blur a 2-class (half / quarter resolution) source pair into `out` (cleared) */
  private blurPair(src: Float32Array[], usedBase: number, out: Float32Array, N: number): void {
    out.fill(0);
    // class 0: half res r=1 (sigma^2 = 8), class 1: quarter res r=2 (sigma^2 = 96)
    if (this.usedCls[usedBase]) blurDownAdd(src[0], out, N, 2, 1, POLL_PEAK_GAIN * 2 * Math.PI * 8, this.coarse, this.coarseTmp);
    if (this.usedCls[usedBase + 1]) blurDownAdd(src[1], out, N, 4, 2, POLL_PEAK_GAIN * 2 * Math.PI * 96, this.coarse, this.coarseTmp);
  }

  /** step 7: noise layer (trees and parks buffer it) */
  private stageNoise(sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    this.blurPair(this.noiseS, 5, this.tmp, N);
    saturate(this.tmp, st.noise, C, 1 / NOISE_K, first ? 1 : POLL_SMOOTH, null, st.treeCover, TREE_NOISE_ABSORB, this.parkBuf, PARK_NOISE_ABSORB);
  }

  /** step 8 (stageB): water pollution (ground water + diffusion along water bodies + bank coupling) */
  private stageB(sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    this.ensureCells(st);
    const tmp = this.tmp, tmp2 = this.tmp2;
    const alpha = first ? 1 : POLL_SMOOTH;
    this.blurPair(this.waterS, 3, tmp, N);
    const L = st.waterPollution, ground = this.ground;
    const wm = st.water;
    // negative sources (treatment plants) also clean nearby water bodies
    for (let i = 0; i < C; i++) if (wm[i] && tmp[i] < 0) L[i] = Math.max(0, L[i] + tmp[i] * 0.05);
    // ground water of land cells (kept separately so bank coupling does not feed back into the water bodies)
    saturate(tmp, ground, C, 1 / WATER_K, alpha, wm);
    // diffusion over water cells (precomputed list + 4 neighbour slots: water idx or -(land cell)-1)
    this.ensureWaterList(st);
    const nW = this.nWater, wc = this.waterCells, wnb = this.waterNb;
    const cur = tmp2, nxt = tmp;
    for (let q = 0; q < nW; q++) cur[q] = L[wc[q]];
    const iters = 8;
    for (let it = 0; it < iters; it++) {
      for (let q = 0; q < nW; q++) {
        let s = cur[q], n = 1, inflow = 0;
        const b = q * 4;
        for (let k = 0; k < 4; k++) {
          const t = wnb[b + k];
          if (t === 0x7fffffff) continue;
          if (t >= 0) { s += cur[t]; n++; }
          else { const lv = ground[-t - 1]; if (lv > inflow) inflow = lv; }
        }
        const v = (s / n) * WATER_DIFFUSE_KEEP + inflow * 0.12;
        nxt[q] = v > 1 ? 1 : v;
      }
      for (let q = 0; q < nW; q++) cur[q] = nxt[q];
    }
    for (let q = 0; q < nW; q++) L[wc[q]] = cur[q];
    // land = ground water, raised on the banks of polluted water bodies
    for (let i = 0; i < C; i++) if (!wm[i]) L[i] = ground[i];
    const bank = this.bankCells, src = this.bankSrc;
    for (let k = 0; k < bank.length; k++) {
      const v = BANK_COUPLING * L[src[k]];
      const i = bank[k];
      if (v > L[i]) L[i] = v;
    }
  }

  /** step 9: soil stock, flags & stats */
  private stageFlags(sim: Simulation): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const fx3 = this.fx3B ?? wp3Effects(st);
    const dt = this.dtMonthsB;
    // soil contamination (stock): builds up under sources, decays slowly (brownfield cleanup speeds it up)
    if (dt > 0) {
      const soil = st.soil, src = this.soilSrc;
      const grow = SOIL_RATE * dt, keep = Math.max(0, 1 - SOIL_DECAY * dt * fx3.soilDecay);
      for (let i = 0; i < C; i++) {
        let s = soil[i];
        const q = src[i];
        if (s === 0 && q === 0) continue;
        if (q > 0) s += grow * Math.min(1, q) * (1 - s);
        s *= keep;
        soil[i] = s < 1e-4 ? 0 : s;
      }
    }
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

  /** mark water topology dirty (terrain changed) */
  invalidateWater(): void {
    this.nWater = -1;
  }

  private ensureWaterList(st: CityState): void {
    if (this.nWater >= 0 && this.waterVersion === st.cells) return;
    const N = st.size, C = st.cells, wm = st.water;
    let n = 0;
    const idx = new Int32Array(C).fill(-1);
    for (let i = 0; i < C; i++) if (wm[i]) idx[i] = n++;
    this.waterCells = new Int32Array(n);
    this.waterNb = new Int32Array(n * 4);
    for (let i = 0, q = 0; i < C; i++) {
      if (!wm[i]) continue;
      this.waterCells[q] = i;
      const x = i % N, z = (i - x) / N;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], nz = z + DZ[k];
        let t = 0x7fffffff;
        if (nx >= 0 && nz >= 0 && nx < N && nz < N) {
          const j = nz * N + nx;
          t = wm[j] ? idx[j] : -j - 1;
        }
        this.waterNb[q * 4 + k] = t;
      }
      q++;
    }
    this.nWater = n;
    this.waterVersion = C;
    // bank cells: land within BANK_DIST (4-neighbour steps) of water, each coupled to the water cell it was reached from
    const src = new Int32Array(C).fill(-1);
    const dist = new Uint8Array(C);
    const queue = new Int32Array(C);
    let qh = 0, qt = 0;
    for (let i = 0; i < C; i++) if (wm[i]) { src[i] = i; queue[qt++] = i; }
    const bank: number[] = [], bankSrc: number[] = [];
    while (qh < qt) {
      const i = queue[qh++];
      const d = dist[i];
      if (d >= BANK_DIST) continue;
      const x = i % N;
      const nb = [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, i >= N ? i - N : -1, i + N < C ? i + N : -1];
      for (const j of nb) {
        if (j < 0 || src[j] >= 0) continue;
        src[j] = src[i];
        dist[j] = d + 1;
        queue[qt++] = j;
        bank.push(j);
        bankSrc.push(src[i]);
      }
    }
    this.bankCells = Int32Array.from(bank);
    this.bankSrc = Int32Array.from(bankSrc);
  }
}

/** true when a road cell (street .. highway) touches the building's edge (corners excluded): trucks can stop there */
function roadOnEdge(st: CityState, b: Building): boolean {
  const N = st.size, net = st.network;
  const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d;
  for (let x = x0; x < x1; x++) {
    if (x < 0 || x >= N) continue;
    if (z0 > 0 && isRoad(net[(z0 - 1) * N + x] as Network)) return true;
    if (z1 < N && isRoad(net[z1 * N + x] as Network)) return true;
  }
  for (let z = z0; z < z1; z++) {
    if (z < 0 || z >= N) continue;
    if (x0 > 0 && isRoad(net[z * N + x0 - 1] as Network)) return true;
    if (x1 < N && isRoad(net[z * N + x1] as Network)) return true;
  }
  return false;
}

let baseSrcKey = -1;
let baseSrc: Float32Array = new Float32Array(0);
/** per-network base noise source strengths (cached for the noise scale) */
function baseNoiseSources(noiseK: number): Float32Array {
  if (noiseK === baseSrcKey) return baseSrc;
  baseSrcKey = noiseK;
  baseSrc = Float32Array.from(NET_BASE_NOISE, (I) => intensityToSource(I, noiseK));
  return baseSrc;
}

/** the pollution system of a simulation */
export function getPollution(sim: Simulation): PollutionSystem | undefined {
  return sim.getSystem<PollutionSystem>('pollution');
}
