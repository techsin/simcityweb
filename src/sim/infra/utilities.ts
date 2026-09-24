/**
 * Utilities system: power grid + water network.
 *
 * POWER
 *  - Conductors: any network cell (roads, rail, bridges), power-line cells, building-covered cells.
 *  - Each connected conductor component shares the output of the power plants it contains (def.powerOut, reduced when
 *    utilities funding < 100 %). Demand = def.powerUse (scaled by occupancy) or derived from capacity.
 *  - Plant output (SIM_DEPTH_SPEC WP3 E): thermal plants (category power + waterUse) x THERMAL_UNWATERED without water
 *    (last pass); wind turbines x (0.6 + 0.8 smoothstep(10, 60, height above the local mean)); solar x season x
 *    climate; nuclear x ordinanceEffect 'power.nuclear' (nuclear-free zone shuts plants down); the incinerator x its
 *    garbage burn share (PollutionSystem.incineratorShare, previous pass). plantLoad(id) = component demand / supply.
 *  - Brownout: when demand > supply, critical loads (health, police, fire, water producers) are served first, then a
 *    multi-source BFS from the plants serves consumers in distance order; once the supply is exhausted every farther
 *    consumer loses power (farthest first).
 *  - Empty zoned cells 4-adjacent to a powered conductor are marked powered (for growth).
 *  - Writes state.powered, BF.Powered (buildingChanged on flip), stats.powerSupply / powerDemand.
 * WATER
 *  - Pipes run automatically under every road cell; road-connected components form water networks.
 *  - Producers (def.waterOut) feed the road component they touch (<= 1 cell). Pumps within 2 cells of FRESH water
 *    +50 % (sea only: brackish x 0.6, terrainMasks.seaMask); desalination away from the sea x 0.2; intakes lose
 *    output with the intake pollution max(ground, adjacent water body) (less with a treatment plant in the city).
 *  - Tap water quality per network = 1 - supply-weighted intake pollution x (1 - 0.7 sewageTreated) (treatment and
 *    desalination output is clean): waterQualityAt(sim, cell); stats.tapWater = demand-weighted city mean.
 *  - Buildings 4-adjacent to a watered road get water; same brownout ordering by BFS from producers.
 *  - Writes state.watered, BF.Watered, stats.waterSupply / waterDemand / tapWater. Shortage / blackout news
 *    (30-day cooldown).
 * SCHEDULING (InfraScheduler; every step <= ~2.3 measured ms on the 256² stress city, estimates in stepCost):
 *    uses (+ local label patch) -> [labels: full passes / a new building bridging two grids] -> power sums + loads
 *    (+ results when no grid is short) -> [brownout: critical-first + distance-ordered BFS, only when a grid is
 *    short] -> water sums (+ results, flags) -> [water brownout BFS + results, flags: only when a network is short].
 *  - full pass (relabel components): network / power-line / plopped-building changes (urgent, next scheduler slot)
 *    and every UTIL_FULL_DAYS days;
 *  - soft pass (labels patched locally for growables added / removed, sums + brownout + flags): within
 *    UTIL_SOFT_DAYS of a growth change / zone change and every UTIL_REFRESH_DAYS days (demand drifts with pop).
 */
import { Network, isRoad } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import {
  Fam, type DefInfo, activeJobs, detectJobsUnknown, ensureIdArray, ensureIdFloat, fundingFactor, infoOf,
  readEffects, setFlagQuiet, nowMs,
  buildingList,
} from './common';
import {
  DESAL_INLAND_OUT, POWER_MIN_PLOPPED, POWER_PER_CIVIC_JOB, POWER_PER_JOB_C, POWER_PER_JOB_I, POWER_PER_RES,
  PUMP_POLL_LOSS, PUMP_TREATED_LOSS, PUMP_WATER_BONUS, PUMP_WATER_DIST, SEA_PUMP_OUT, SHORTAGE_NEWS_DAYS, SOLAR_CLIMATE,
  SOLAR_SUMMER, SOLAR_WINTER, TAP_TREATMENT_CLEAN, THERMAL_UNWATERED, UTIL_BASE_SHARE, UTIL_FULL_DAYS, UTIL_REFRESH_DAYS,
  UTIL_SOFT_DAYS, WATER_PER_CIVIC_JOB, WATER_PER_JOB_C, WATER_PER_JOB_I, WATER_PER_RES, WIND_TURBINE_BASE,
  WIND_TURBINE_GAIN, WIND_TURBINE_H0, WIND_TURBINE_H1, WIND_TURBINE_RADIUS,
} from './params';
import { schedulerOf, sizeFactors } from './scheduler';
import { ordinanceEffect } from '../economy/ordinances';
import { seaMask, waterNear } from './terrainMasks';
import { smoothstep } from '../../core/rng';
import type { PollutionSystem } from './pollution';

const IND_KEYS = ['IA', 'ID', 'IM', 'IHT'] as const;

/** a multiplicative factor on a producer's output, for the inspector ("Flat site 60 %") */
export interface OutputFactor {
  label: string;
  mul: number;
}
/** power plant / water producer output breakdown (last utilities pass) */
export interface ProducerInfo {
  kind: 'power' | 'water';
  /** def output at 100 % (MW or kL/day) */
  nominal: number;
  /** output this pass */
  output: number;
  factors: OutputFactor[];
  /** power: share of the plant's grid supply in use 0..1 (-1 unknown); water: intake pollution 0..1 */
  load: number;
}

type ProducerKind = 0 | 2 | 3 | 4 | 5;
const PK_OTHER = 0, PK_NUCLEAR = 2, PK_WIND = 3, PK_SOLAR = 4, PK_INCIN = 5;
function powerKind(inf: DefInfo): ProducerKind {
  if (inf.isIncinerator) return PK_INCIN;
  const s = inf.id + ' ' + inf.model;
  if (s.includes('nuclear')) return PK_NUCLEAR;
  if (s.includes('wind')) return PK_WIND;
  if (s.includes('solar')) return PK_SOLAR;
  return PK_OTHER;
}
function isDesal(inf: DefInfo): boolean {
  return (inf.id + ' ' + inf.model).includes('desal');
}
/** loads served first in a brownout */
function isCritical(inf: DefInfo): boolean {
  return inf.waterOut > 0 || inf.service === 'health' || inf.service === 'police' || inf.service === 'fire';
}

/** pass steps (see SCHEDULING above); the brownout steps run only when a grid / network is short */
const U_USES = 0, U_LABEL = 1, U_POWER = 2, U_BROWN = 3, U_WATER = 4, U_WATER_BROWN = 5;

/** append v at index n of a growable id list; returns the (possibly new) array */
function pushId(a: Int32Array<ArrayBuffer>, n: number, v: number): Int32Array<ArrayBuffer> {
  if (n >= a.length) {
    const b = new Int32Array(Math.max(64, a.length * 2));
    b.set(a);
    a = b;
  }
  a[n] = v;
  return a;
}

function occupancy(inf: DefInfo, b: Building, jobsUnknown: boolean): number {
  if (b.capacity <= 0) return 1;
  if (inf.fam === Fam.R) return Math.min(1, b.pop / b.capacity);
  if (inf.fam === Fam.C || inf.fam === Fam.I) return Math.min(1, activeJobs(inf, b, jobsUnknown) / b.capacity);
  return 1;
}

/** full-occupancy utility use of a building (power MW or water kL/day) */
function fullUse(inf: DefInfo, b: Building, power: boolean): number {
  const explicit = power ? inf.powerUse : inf.waterUse;
  if (explicit >= 0) return explicit;
  const cap = b.capacity;
  switch (inf.fam) {
    case Fam.R: return cap * (power ? POWER_PER_RES : WATER_PER_RES);
    case Fam.C: return cap * (power ? POWER_PER_JOB_C : WATER_PER_JOB_C);
    case Fam.I: {
      const k = IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))];
      return cap * (power ? POWER_PER_JOB_I[k] : WATER_PER_JOB_I[k]);
    }
    default: {
      const jobs = inf.civicJobs;
      const perJob = power ? POWER_PER_CIVIC_JOB : WATER_PER_CIVIC_JOB;
      // parks without an explicit powerUse / waterUse draw nothing (lawns and benches); staffed ones by their jobs
      return Math.max(inf.isPark ? 0 : POWER_MIN_PLOPPED, jobs * perJob);
    }
  }
}

export function buildingPowerUse(inf: DefInfo, b: Building, jobsUnknown: boolean): number {
  if (inf.powerOut > 0) return 0;
  if (b.built < 1 || (b.flags & (BF.Burnt | BF.Abandoned)) !== 0) return 0;
  const occ = occupancy(inf, b, jobsUnknown);
  return fullUse(inf, b, true) * (UTIL_BASE_SHARE + (1 - UTIL_BASE_SHARE) * occ);
}
export function buildingWaterUse(inf: DefInfo, b: Building, jobsUnknown: boolean): number {
  if (inf.waterOut > 0) return 0;
  if (b.built < 1 || (b.flags & (BF.Burnt | BF.Abandoned)) !== 0) return 0;
  const occ = occupancy(inf, b, jobsUnknown);
  return fullUse(inf, b, false) * (UTIL_BASE_SHARE + (1 - UTIL_BASE_SHARE) * occ);
}

function plantEfficiency(state: CityState): number {
  const f = fundingFactor(state, 'utilities');
  return f >= 1 ? 1 : 0.4 + 0.6 * f;
}

export interface GridInfo {
  supply: number;
  demand: number;
  /** true when demand > supply (brownout) */
  shortage: boolean;
}

export class UtilitiesSystem implements SimSystem {
  readonly name = 'utilities';
  /** power topology changed (network / power lines / plopped buildings) -> relabel + urgent */
  private dirtyFull = true;
  /** water topology changed (roads) */
  private dirtyWater = true;
  /** growables added / removed, zones changed -> soft refresh within UTIL_SOFT_DAYS */
  private soft = false;
  private added: Building[] = [];
  private removed: Building[] = [];
  private lastServe = -1e9;
  private lastFull = -1e9;
  /** pass step: -1 idle, else the next step (U_*) */
  private stepIdx = -1;
  private passFull = false;
  /** this pass relabels the power grid (full pass, or a new building bridges two grids) */
  private relabelPower = false;
  /** power producers and critical consumers of this pass (building ids; lists built by the uses step) */
  private plantIds = new Int32Array(64);
  private nPlants = 0;
  private critIds = new Int32Array(256);
  private nCrit = 0;
  /** water producers delivering water this pass (brownout BFS seeds) */
  private wSeedIds = new Int32Array(64);
  private nWSeeds = 0;
  /** stamps of this pass's power / water results in bOk (the brownout steps run after the sums steps) */
  private powerStamp = 0;
  private waterStamp = 0;
  private exhaustedP = new Uint8Array(256);
  private exhaustedW = new Uint8Array(256);
  /** per water network: supplied and not short (the power grid's okComp is separate) */
  private okW = new Uint8Array(256);
  private unsub: (() => void)[] = [];
  private stamp = 0;
  // per cell
  private pComp = new Int32Array(0);
  private wComp = new Int32Array(0);
  private queue = new Int32Array(0);
  private visit = new Int32Array(0);
  // per building id
  private bUse = new Float32Array(1024);
  private bOk = new Int32Array(1024);
  private bWComp = new Int32Array(1024);
  /** per building id: water use (>= 0) or -(output) - tiny for producers */
  private bWUse = new Float32Array(1024);
  /** water producers that need power to pump (def powerUse > 0) */
  private bNeedPow = new Uint8Array(1024);
  private bPow = new Uint8Array(1024);
  private bWat = new Uint8Array(1024);
  // per component
  private cSupply = new Float64Array(256);
  private cDemand = new Float64Array(256);
  private cLeft = new Float64Array(256);
  private wSupply = new Float64Array(256);
  private wDemand = new Float64Array(256);
  private wLeft = new Float64Array(256);
  private nPComp = 0;
  private okComp = new Uint8Array(256);
  private nWComp = 0;
  /** per water component: supply-weighted intake pollution sum, tap water quality 0..1 */
  private wPoll = new Float64Array(256);
  private wQual = new Float32Array(256);
  /** per building id: plant load 0..1 (-1 unknown) and last water result (0 unknown, 1 watered, 2 dry) */
  private loadById = new Float32Array(1024).fill(-1);
  private watSeen = new Uint8Array(1024);
  /** per producer id: output breakdown of the last pass; intake pollution per water producer id */
  private producers = new Map<number, ProducerInfo>();
  private intakeById = new Float32Array(1024);
  private wasShort = false;
  private lastShortNotify = -1e9;
  private wasWaterShort = false;
  private lastWaterNotify = -1e9;
  /** power supply of the last pass (blackout news when it drops to 0 under demand) */
  private lastSupply = 0;
  private lastBlackoutNotify = -1e9;
  /** nuclear plants shut down by the nuclear-free-zone ordinance: announced once per enactment */
  private nuclearOffAnnounced = false;
  private simRef: Simulation | null = null;
  /** duration (ms) of the last step / last full synchronous compute */
  lastMs = 0;

  init(sim: Simulation): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    const ev = sim.events;
    const full = () => { this.dirtyFull = true; };
    const net = () => { this.dirtyFull = true; this.dirtyWater = true; };
    // growables appearing / vanishing: local label patch + soft refresh; plopped buildings (plants!): full + urgent
    const markAdd = (b: Building) => {
      if (b.flags & BF.Plopped || infoOf(sim.state, b).fam === Fam.Plop) this.dirtyFull = true;
      else { this.soft = true; this.added.push(b); }
    };
    const markRem = (b: Building) => {
      if (b.flags & BF.Plopped || infoOf(sim.state, b).fam === Fam.Plop) this.dirtyFull = true;
      else { this.soft = true; this.removed.push(b); }
    };
    this.unsub.push(ev.on('networkChanged', net), ev.on('buildingAdded', markAdd), ev.on('buildingRemoved', markRem),
      ev.on('powerLinesChanged', full), ev.on('zoneChanged', () => { this.soft = true; }), ev.on('reset', net));
    sim.state.systemData.infraLayers = { utilities: true, traffic: true, pollution: true, services: true };
    sim.state.systemData.infraVersion = 1;
    this.simRef = sim;
    // an ordinance already in force when a city is loaded is not news
    this.nuclearOffAnnounced = ordinanceEffect(sim.state, 'power.nuclear') < 0.5;
    this.dirtyFull = true;
    this.dirtyWater = true;
    this.added = [];
    this.removed = [];
    this.stepIdx = -1;
    this.lastSupply = 0;
    this.lastShortNotify = this.lastWaterNotify = this.lastBlackoutNotify = -1e9;
    this.wasShort = this.wasWaterShort = false;
    this.loadById.fill(-1);
    this.producers.clear();
    this.rememberCoolingWater(sim.state);
    this.compute(sim);
    const self = this;
    schedulerOf(sim).register({
      name: 'utilities',
      due: (s) => self.due(s),
      urgent: () => self.dirtyFull || self.stepIdx >= 0 && self.passFull,
      cost: (s) => self.stepCost(s),
      step: (s) => self.step(s),
    });
  }

  daily(sim: Simulation): void {
    schedulerOf(sim).tickDay(sim);
  }

  frame(sim: Simulation, _dt: number): void {
    schedulerOf(sim).tickFrame(sim, this);
  }

  /** mark for a full recompute as soon as possible */
  invalidate(): void {
    this.dirtyFull = true;
  }

  private due(sim: Simulation): boolean {
    if (this.stepIdx >= 0) return true;
    const d = sim.state.day;
    return this.dirtyFull || (this.soft && d - this.lastServe >= UTIL_SOFT_DAYS) || d - this.lastServe >= UTIL_REFRESH_DAYS || d - this.lastFull >= UTIL_FULL_DAYS;
  }

  /**
   * estimated ms of the next step (~1.3-1.5x the minimum measured on the 256² stress city with 20k buildings under
   * load; every step <= 3.0). The brownout steps only run when a grid / network is short, so their cost is known.
   */
  private stepCost(sim: Simulation): number {
    const { cells, bld } = sizeFactors(sim);
    const waterLabel = this.dirtyWater || this.wComp.length !== sim.state.cells ? 0.5 * cells : 0;
    switch (this.stepIdx < 0 ? U_USES : this.stepIdx) {
      case U_USES: return 2.0 * bld + 0.1 * cells;
      case U_LABEL: return (this.relabelPower ? 1.1 * cells : 0) + waterLabel + 0.05;
      case U_POWER: return 0.5 * cells + 0.7 * bld;
      case U_BROWN: return 1.9 * cells + 0.8 * bld;
      case U_WATER: return waterLabel + 0.5 * cells + 0.8 * bld;
      default: return 1.9 * cells + 0.8 * bld;
    }
  }

  /** run one step of a (full or soft) refresh pass */
  step(sim: Simulation): void {
    const t0 = nowMs();
    const st = sim.state;
    if (this.stepIdx < 0) {
      this.stepIdx = U_USES;
      this.passFull = this.dirtyFull || st.day - this.lastFull >= UTIL_FULL_DAYS || this.pComp.length !== st.cells;
    }
    switch (this.stepIdx) {
      case U_USES: {
        this.ensure(st);
        const fx = readEffects(st);
        this.prepareUses(st, fx.powerDemand, fx.waterDemand, detectJobsUnknown(st));
        let relabel = this.passFull;
        if (this.passFull) this.dirtyFull = false;
        else if (!this.patchPower(st)) relabel = true; // a new building bridges two grids: relabel in the next step
        this.relabelPower = relabel;
        this.added.length = 0;
        this.removed.length = 0;
        this.soft = false;
        this.stepIdx = relabel || this.dirtyWater || this.wComp.length !== st.cells ? U_LABEL : U_POWER;
        break;
      }
      case U_LABEL:
        if (this.relabelPower) {
          this.labelPower(st);
          if (this.passFull) this.lastFull = st.day;
        }
        if (this.dirtyWater || this.wComp.length !== st.cells) { this.labelWater(st); this.dirtyWater = false; }
        this.stepIdx = U_POWER;
        break;
      case U_POWER:
        this.ensureIds(st);
        this.stepIdx = this.powerSums(st) ? U_BROWN : U_WATER;
        break;
      case U_BROWN:
        this.ensureIds(st);
        this.powerBrownout(st);
        this.stepIdx = U_WATER;
        break;
      case U_WATER:
        this.ensureIds(st);
        // a road edit landed mid-pass: relabel the water networks before using them
        if (this.dirtyWater || this.wComp.length !== st.cells) { this.labelWater(st); this.dirtyWater = false; }
        if (this.waterSums(st)) this.stepIdx = U_WATER_BROWN;
        else this.endPass(sim);
        break;
      default:
        this.ensureIds(st);
        this.waterBrownout(st);
        this.endPass(sim);
        break;
    }
    this.lastMs = nowMs() - t0;
  }

  private endPass(sim: Simulation): void {
    this.finish(sim);
    this.stepIdx = -1;
    this.lastServe = sim.state.day;
  }

  /** full synchronous recompute (init / tests / UI) */
  compute(sim: Simulation): void {
    const t0 = nowMs();
    this.stepIdx = -1;
    this.dirtyFull = true;
    do this.step(sim); while (this.stepIdx >= 0);
    this.lastMs = nowMs() - t0;
  }

  /** power grid info at a cell (conductor or building) or null if not on a grid */
  gridInfo(sim: Simulation, x: number, z: number): GridInfo | null {
    const st = sim.state;
    if (!st.inBounds(x, z) || this.pComp.length !== st.cells) return null;
    const c = this.pComp[z * st.size + x];
    if (c < 0 || c >= this.nPComp) return null;
    return { supply: this.cSupply[c], demand: this.cDemand[c], shortage: this.cDemand[c] > this.cSupply[c] };
  }
  /** water network info at a road cell / building */
  waterInfo(sim: Simulation, x: number, z: number): GridInfo | null {
    const st = sim.state;
    if (!st.inBounds(x, z) || this.wComp.length !== st.cells) return null;
    let c = this.wComp[z * st.size + x];
    if (c < 0) {
      const b = st.buildingAt(x, z);
      if (b && b.id < this.bWComp.length) c = this.bWComp[b.id] - 1;
    }
    if (c < 0 || c >= this.nWComp) return null;
    return { supply: this.wSupply[c], demand: this.wDemand[c], shortage: this.wDemand[c] > this.wSupply[c] };
  }

  private ensure(st: CityState): void {
    const C = st.cells;
    if (this.pComp.length !== C) {
      this.pComp = new Int32Array(C).fill(-1);
      this.wComp = new Int32Array(C).fill(-1);
      this.queue = new Int32Array(C);
      this.visit = new Int32Array(C);
      this.passFull = true;
      this.dirtyWater = true;
    }
    this.ensureIds(st);
  }

  /** per-building-id arrays cover every id (buildings may appear between the steps of a pass) */
  private ensureIds(st: CityState): void {
    if (this.bOk.length >= st.nextBuildingId + 1 && this.bPow.length >= this.bOk.length) return;
    this.bOk = ensureIdArray(this.bOk, st);
    this.bUse = ensureIdFloat(this.bUse, st);
    this.bWComp = ensureIdArray(this.bWComp, st);
    this.bWUse = ensureIdFloat(this.bWUse, st);
    this.intakeById = ensureIdFloat(this.intakeById, st);
    if (this.loadById.length < this.bOk.length) {
      const l = new Float32Array(this.bOk.length).fill(-1);
      l.set(this.loadById);
      this.loadById = l;
    }
    if (this.bPow.length < this.bOk.length) {
      const grow = (a: Uint8Array) => { const b = new Uint8Array(this.bOk.length); b.set(a.subarray(0, Math.min(a.length, b.length))); return b; };
      this.bPow = grow(this.bPow);
      this.bWat = grow(this.bWat);
      this.bNeedPow = grow(this.bNeedPow);
      this.watSeen = grow(this.watSeen);
    }
  }

  /**
   * After a load: thermal plants that were simulated before (BF.Powered set by an earlier pass) take their cooling
   * water state from the saved BF.Watered flag, so an unwatered plant does not deliver full output for one pass
   * (which ended and restarted brownouts, re-firing shortage news after every load). Never-simulated plants (fresh
   * test / sandbox states) stay unknown = assumed watered.
   */
  private rememberCoolingWater(st: CityState): void {
    this.watSeen.fill(0);
    this.ensureIds(st);
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      if ((b.flags & BF.Powered) === 0) continue;
      const inf = infoOf(st, b);
      if (inf.powerOut > 0 && inf.waterUse > 0) this.watSeen[b.id] = (b.flags & BF.Watered) !== 0 ? 1 : 2;
    }
  }

  /** share 0..1 of the plant's grid supply in use (last pass; -1 = unknown / not a plant) */
  plantLoad(id: number): number {
    return id >= 0 && id < this.loadById.length ? this.loadById[id] : -1;
  }

  /** output breakdown of a power plant / water producer (last pass), null if not a producer */
  producerInfo(id: number): ProducerInfo | null {
    return this.producers.get(id) ?? null;
  }

  /**
   * tap-water quality 0..1 (1 = clean) at a cell: quality of the water network serving the road cell / building there
   * (supply-weighted intake pollution with treatment applied). Falls back to the city mean stats.tapWater.
   */
  waterQualityAt(sim: Simulation, cell: number): number {
    const st = sim.state;
    const mean = st.stats.tapWater ?? 1;
    if (cell < 0 || cell >= st.cells || this.wComp.length !== st.cells) return mean;
    let c = this.wComp[cell];
    if (c < 0) {
      const bid = st.building[cell];
      if (bid >= 0 && bid < this.bWComp.length) c = this.bWComp[bid] - 1;
    }
    if (c < 0) {
      const N = st.size, x = cell % N;
      if (x > 0 && this.wComp[cell - 1] >= 0) c = this.wComp[cell - 1];
      else if (x < N - 1 && this.wComp[cell + 1] >= 0) c = this.wComp[cell + 1];
      else if (cell >= N && this.wComp[cell - N] >= 0) c = this.wComp[cell - N];
      else if (cell + N < st.cells && this.wComp[cell + N] >= 0) c = this.wComp[cell + N];
    }
    if (c < 0 || c >= this.nWComp || !(this.wSupply[c] > 0)) return mean;
    return this.wQual[c];
  }

  /** apply flags, news, events */
  private finish(sim: Simulation): void {
    const st = sim.state;
    const changed: Building[] = [];
    const bPow = this.bPow, bWat = this.bWat;
    const watSeen = this.watSeen;
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const f1 = setFlagQuiet(b, BF.Powered, bPow[b.id] === 1);
      const f2 = setFlagQuiet(b, BF.Watered, bWat[b.id] === 1);
      watSeen[b.id] = bWat[b.id] === 1 ? 1 : 2;
      if (f1 || f2) changed.push(b);
    }
    for (const b of changed) sim.events.emit('buildingChanged', b);
    const short = st.stats.powerDemand > st.stats.powerSupply * 1.0001 && st.stats.powerSupply > 0;
    if (short && !this.wasShort && st.day - this.lastShortNotify > SHORTAGE_NEWS_DAYS) {
      this.lastShortNotify = st.day;
      sim.notify(`Power shortage: demand ${Math.round(st.stats.powerDemand)} MW exceeds supply ${Math.round(st.stats.powerSupply)} MW. Brownouts in outlying areas.`, 'warning', undefined, undefined, 'utilities');
    }
    this.wasShort = short;
    // the grid went dark (every plant lost, burnt or shut down by ordinance) while buildings still need power
    if (st.stats.powerSupply <= 0 && this.lastSupply > 0 && st.stats.powerDemand > 0 && st.day - this.lastBlackoutNotify > SHORTAGE_NEWS_DAYS) {
      this.lastBlackoutNotify = st.day;
      sim.notify(`Blackout: no power plant is supplying the grid (demand ${Math.round(st.stats.powerDemand).toLocaleString('en-US')} MW). Build or repair a power plant.`, 'warning', undefined, undefined, 'utilities');
    }
    this.lastSupply = st.stats.powerSupply;
    const wShort = st.stats.waterDemand > st.stats.waterSupply * 1.0001 && st.stats.waterSupply > 0;
    if (wShort && !this.wasWaterShort && st.day - this.lastWaterNotify > SHORTAGE_NEWS_DAYS) {
      this.lastWaterNotify = st.day;
      sim.notify(`Water shortage: demand ${Math.round(st.stats.waterDemand).toLocaleString('en-US')} kL/day exceeds supply ${Math.round(st.stats.waterSupply).toLocaleString('en-US')} kL/day. Taps run dry in outlying areas.`, 'warning', undefined, undefined, 'utilities');
    }
    this.wasWaterShort = wShort;
    sim.events.emit('layerUpdated', 'utilities');
  }

  /** one pass over buildings: power use / plant output (bUse) and water use / producer output (bWUse) */
  private prepareUses(st: CityState, pMul: number, wMul: number, jobsUnknown: boolean): void {
    const eff = plantEfficiency(st);
    const bUse = this.bUse, bWUse = this.bWUse;
    const list = buildingList(st);
    let hasTreatment = false;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const inf = infoOf(st, b);
      if (inf.isTreatment && b.built >= 1 && (b.flags & BF.Burnt) === 0) { hasTreatment = true; break; }
    }
    const producers = this.producers;
    producers.clear();
    const nuclearMul = Math.max(0, ordinanceEffect(st, 'power.nuclear'));
    let nuclearLost = 0;
    const pollution = this.simRef?.getSystem<PollutionSystem>('pollution');
    let sea: Uint8Array | null = null;
    const season = 0.5 * (SOLAR_WINTER + SOLAR_SUMMER) - 0.5 * (SOLAR_SUMMER - SOLAR_WINTER) * Math.cos((2 * Math.PI * ((st.day % 360) + 15)) / 360);
    const climate = SOLAR_CLIMATE[st.config.climate] ?? 1;
    let nPlants = 0, nCrit = 0;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const inf = infoOf(st, b);
      const ok = b.built >= 1 && (b.flags & (BF.Burnt | BF.Abandoned)) === 0;
      if (inf.powerOut <= 0 && isCritical(inf)) this.critIds = pushId(this.critIds, nCrit++, b.id);
      if (inf.powerOut > 0) {
        this.plantIds = pushId(this.plantIds, nPlants++, b.id);
        let out = 0;
        const factors: OutputFactor[] = [];
        if (ok) {
          out = inf.powerOut * eff;
          if (eff < 1) factors.push({ label: 'Utilities funding', mul: eff });
          // thermal plants (coal / oil / gas / nuclear: category power with a water use) need cooling water; last pass's
          // result (unknown for a brand-new plant -> assume watered)
          if (inf.category === 'power' && inf.waterUse > 0 && this.watSeen[b.id] === 2) {
            out *= THERMAL_UNWATERED;
            factors.push({ label: 'No cooling water', mul: THERMAL_UNWATERED });
          }
          switch (powerKind(inf)) {
            case PK_NUCLEAR:
              if (nuclearMul < 1) { nuclearLost += out * (1 - nuclearMul); out *= nuclearMul; factors.push({ label: 'Nuclear-free zone', mul: nuclearMul }); }
              break;
            case PK_WIND: {
              const m = WIND_TURBINE_BASE + WIND_TURBINE_GAIN * smoothstep(WIND_TURBINE_H0, WIND_TURBINE_H1, relativeHeight(st, b));
              out *= m;
              factors.push({ label: m < 1 ? 'Sheltered site' : 'Windy hilltop', mul: m });
              break;
            }
            case PK_SOLAR:
              out *= season * climate;
              factors.push({ label: 'Season', mul: season });
              if (climate !== 1) factors.push({ label: 'Climate', mul: climate });
              break;
            case PK_INCIN: {
              const share = pollution?.incineratorShare(b.id) ?? -1;
              if (share >= 0) { out *= share; factors.push({ label: 'Garbage burned', mul: share }); }
              break;
            }
          }
        }
        bUse[b.id] = -out;
        producers.set(b.id, { kind: 'power', nominal: inf.powerOut, output: out, factors, load: this.loadById[b.id] ?? -1 });
      } else bUse[b.id] = buildingPowerUse(inf, b, jobsUnknown) * pMul;
      if (inf.waterOut > 0) {
        let out = 0, intake = 0;
        const factors: OutputFactor[] = [];
        if (ok) {
          out = inf.waterOut * eff;
          if (eff < 1) factors.push({ label: 'Utilities funding', mul: eff });
          if (sea === null) sea = seaMask(st);
          const near = waterNear(st, b.x, b.z, b.w, b.d, PUMP_WATER_DIST, sea);
          if (isDesal(inf)) {
            if (!near.sea) { out *= DESAL_INLAND_OUT; factors.push({ label: 'No sea water', mul: DESAL_INLAND_OUT }); }
          } else {
            if (inf.isPump) {
              if (near.fresh) { out *= 1 + PUMP_WATER_BONUS; factors.push({ label: 'Fresh water nearby', mul: 1 + PUMP_WATER_BONUS }); }
              else if (near.sea) { out *= SEA_PUMP_OUT; factors.push({ label: 'Brackish sea water', mul: SEA_PUMP_OUT }); }
            }
            // intake pollution: ground water under the intake or the adjacent water body, whichever is worse
            intake = Math.min(1, intakePollution(st, b, PUMP_WATER_DIST));
            if (intake > 0.001) {
              const m = 1 - PUMP_POLL_LOSS * intake * (hasTreatment ? PUMP_TREATED_LOSS : 1);
              out *= m;
              factors.push({ label: 'Polluted intake', mul: m });
            }
          }
        }
        // treatment plants and desalination deliver clean water; pumps / towers deliver what they draw
        this.intakeById[b.id] = inf.isTreatment || isDesal(inf) ? 0 : intake;
        bWUse[b.id] = -out - 1e-9;
        this.bNeedPow[b.id] = inf.powerUse > 0 ? 1 : 0;
        producers.set(b.id, { kind: 'water', nominal: inf.waterOut, output: out, factors, load: intake });
      } else {
        bWUse[b.id] = buildingWaterUse(inf, b, jobsUnknown) * wMul;
        this.bNeedPow[b.id] = 0;
      }
    }
    this.nPlants = nPlants;
    this.nCrit = nCrit;
    if (nuclearLost > 0 && !this.nuclearOffAnnounced && this.simRef) {
      this.simRef.notify(`Nuclear plant shut down by ordinance (−${Math.round(nuclearLost).toLocaleString('en-US')} MW)`, 'warning', undefined, undefined, 'utilities');
    }
    this.nuclearOffAnnounced = nuclearMul < 0.5;
  }

  // ------------------------------------------------------------------------------------------ power
  /** label conductor components (network cells, power lines, building cells) */
  private labelPower(st: CityState): void {
    const N = st.size, C = st.cells;
    const net = st.network, lines = st.powerLines, bld = st.building;
    const comp = this.pComp, queue = this.queue;
    comp.fill(-1);
    let nc = 0;
    for (let s = 0; s < C; s++) {
      if (comp[s] >= 0) continue;
      if (net[s] === 0 && lines[s] === 0 && bld[s] < 0) continue;
      let qh = 0, qt = 0;
      queue[qt++] = s;
      comp[s] = nc;
      while (qh < qt) {
        const i = queue[qh++];
        const x = i % N;
        let j = i - 1;
        if (x > 0 && comp[j] < 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0)) { comp[j] = nc; queue[qt++] = j; }
        j = i + 1;
        if (x < N - 1 && comp[j] < 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0)) { comp[j] = nc; queue[qt++] = j; }
        j = i - N;
        if (j >= 0 && comp[j] < 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0)) { comp[j] = nc; queue[qt++] = j; }
        j = i + N;
        if (j < C && comp[j] < 0 && (net[j] !== 0 || lines[j] !== 0 || bld[j] >= 0)) { comp[j] = nc; queue[qt++] = j; }
      }
      nc++;
    }
    this.nPComp = nc;
    if (nc > this.cSupply.length) this.growPower(nc);
  }

  /**
   * Incremental label update for growables added / removed since the last pass (no full BFS): a new building joins
   * the component of its neighbours; removed buildings' cells stop conducting (a possible split is picked up by the
   * next full pass, at most UTIL_FULL_DAYS later). Returns false when a new building bridges two components (the
   * caller relabels everything in the next step).
   */
  private patchPower(st: CityState): boolean {
    const N = st.size;
    const net = st.network, lines = st.powerLines, bld = st.building;
    const comp = this.pComp;
    for (const b of this.removed) {
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        if (bld[i] < 0 && net[i] === 0 && lines[i] === 0) comp[i] = -1;
      }
    }
    for (const b of this.added) {
      if (!st.buildings.has(b.id)) continue;
      let c0 = -1, multi = false;
      for (let z = b.z - 1; z <= b.z + b.d && !multi; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const inside = x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d;
        const corner = (x < b.x || x >= b.x + b.w) && (z < b.z || z >= b.z + b.d);
        if (inside || corner) continue;
        const c = comp[z * N + x];
        if (c < 0) continue;
        if (c0 < 0) c0 = c;
        else if (c !== c0) { multi = true; break; }
      }
      if (multi) return false;
      if (c0 < 0) {
        c0 = this.nPComp++;
        if (this.nPComp > this.cSupply.length) this.growPower(this.nPComp);
      }
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        if (bld[i] === b.id) comp[i] = c0;
      }
    }
    return true;
  }

  /**
   * Power step 1: per-component supply / demand, plant loads, stats. No short grid: powered cells and building results
   * right away (returns false). A short grid: critical loads (health, police, fire, water producers) reserve their
   * share first and the distance-ordered BFS runs in the brownout step (returns true).
   */
  private powerSums(st: CityState): boolean {
    const N = st.size;
    const comp = this.pComp;
    const nc = this.nPComp;
    const bUse = this.bUse;
    const cSupply = this.cSupply, cDemand = this.cDemand, cLeft = this.cLeft;
    const list = buildingList(st);
    cSupply.fill(0, 0, nc);
    cDemand.fill(0, 0, nc);
    let supplyTot = 0, demandTot = 0;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const c = comp[b.z * N + b.x];
      if (c < 0) continue;
      const u = bUse[b.id];
      if (u < 0) { cSupply[c] -= u; supplyTot -= u; }
      else { cDemand[c] += u; demandTot += u; }
    }
    const okComp = this.okComp.length >= nc ? this.okComp : (this.okComp = new Uint8Array(nc * 2 + 16));
    let anyShort = false;
    for (let c = 0; c < nc; c++) {
      cLeft[c] = cSupply[c];
      const sup = cSupply[c] > 0;
      okComp[c] = sup && cDemand[c] <= cSupply[c] ? 1 : 0;
      if (sup && cDemand[c] > cSupply[c]) anyShort = true;
    }
    // plant load (share of the component's supply in use): pollution activity, WP2 plant stigma, inspector; a plant
    // delivering nothing (shut down by ordinance, burnt) has load 0
    const loadById = this.loadById, plants = this.plantIds, producers = this.producers;
    for (let q = 0; q < this.nPlants; q++) {
      const id = plants[q];
      const b = st.buildings.get(id);
      if (!b) continue;
      const c = comp[b.z * N + b.x];
      const sup = c >= 0 ? cSupply[c] : 0;
      const load = bUse[id] < 0 && sup > 0 ? Math.min(1, cDemand[c] / sup) : 0;
      loadById[id] = load;
      const pi = producers.get(id);
      if (pi) pi.load = load;
    }
    st.stats.powerSupply = supplyTot;
    st.stats.powerDemand = demandTot;
    const stampNo = (this.powerStamp = ++this.stamp);
    if (!anyShort) {
      this.powerResults(st, false);
      return false;
    }
    // brownout: critical loads are served first (in their short component, while its supply lasts)
    const served = this.bOk, crit = this.critIds;
    for (let q = 0; q < this.nCrit; q++) {
      const id = crit[q];
      const u = bUse[id];
      if (!(u > 0)) continue;
      const b = st.buildings.get(id);
      if (!b) continue;
      const c = comp[b.z * N + b.x];
      if (c < 0 || !(cDemand[c] > cSupply[c])) continue;
      if (cLeft[c] >= u) { cLeft[c] -= u; served[id] = stampNo; }
    }
    return true;
  }

  /**
   * Power step 2 (only when a component is short): multi-source BFS from the plants of short components serves
   * consumers in distance order; once the supply is exhausted every farther consumer loses power.
   */
  private powerBrownout(st: CityState): void {
    const N = st.size, C = st.cells;
    const bld = st.building;
    const comp = this.pComp, queue = this.queue, visit = this.visit;
    const bUse = this.bUse, served = this.bOk, stampNo = this.powerStamp;
    const cSupply = this.cSupply, cDemand = this.cDemand, cLeft = this.cLeft;
    const nc = this.nPComp;
    const powered = st.powered, okComp = this.okComp;
    for (let i = 0; i < C; i++) {
      const c = comp[i];
      powered[i] = c >= 0 ? okComp[c] : 0;
    }
    let qh = 0, qt = 0;
    const plants = this.plantIds;
    for (let q = 0; q < this.nPlants; q++) {
      const id = plants[q];
      if (!(bUse[id] < 0)) continue; // delivers nothing: not a source
      const b = st.buildings.get(id);
      if (!b) continue;
      const c = comp[b.z * N + b.x];
      if (c < 0 || !(cDemand[c] > cSupply[c])) continue;
      for (let z: number = b.z; z < b.z + b.d; z++) for (let x: number = b.x; x < b.x + b.w; x++) {
        const i = z * N + x;
        if (visit[i] === stampNo || comp[i] !== c) continue;
        visit[i] = stampNo;
        queue[qt++] = i;
      }
    }
    if (this.exhaustedP.length < nc) this.exhaustedP = new Uint8Array(nc * 2 + 16);
    const exhausted = this.exhaustedP;
    exhausted.fill(0, 0, nc);
    while (qh < qt) {
      const i = queue[qh++];
      const c = comp[i];
      const bid = bld[i];
      if (bid >= 0) {
        const sv = served[bid];
        if (sv !== stampNo && sv !== -stampNo) {
          const u = bUse[bid];
          if (u < 0) served[bid] = stampNo; // plant
          else if (exhausted[c] === 0 && cLeft[c] >= u) { cLeft[c] -= u; served[bid] = stampNo; }
          else { exhausted[c] = 1; served[bid] = -stampNo; }
        }
      }
      powered[i] = exhausted[c] ? 0 : 1;
      // neighbours in DX / DZ order (+x, +z, -x, -z), same component
      const x = i % N;
      let j = i + 1;
      if (x < N - 1 && visit[j] !== stampNo && comp[j] === c) { visit[j] = stampNo; queue[qt++] = j; }
      j = i + N;
      if (j < C && visit[j] !== stampNo && comp[j] === c) { visit[j] = stampNo; queue[qt++] = j; }
      j = i - 1;
      if (x > 0 && visit[j] !== stampNo && comp[j] === c) { visit[j] = stampNo; queue[qt++] = j; }
      j = i - N;
      if (j >= 0 && visit[j] !== stampNo && comp[j] === c) { visit[j] = stampNo; queue[qt++] = j; }
    }
    this.powerResults(st, true);
  }

  /** building results (bPow + footprint cells) and powered empty zoned cells; `brownout`: cells already written */
  private powerResults(st: CityState, brownout: boolean): void {
    const N = st.size, C = st.cells;
    const bld = st.building, zone = st.zone;
    const comp = this.pComp, powered = st.powered;
    const cSupply = this.cSupply, cDemand = this.cDemand;
    const served = this.bOk, stampNo = this.powerStamp;
    if (!brownout) {
      const okComp = this.okComp;
      for (let i = 0; i < C; i++) {
        const c = comp[i];
        powered[i] = c >= 0 ? okComp[c] : 0;
      }
    }
    const result = this.bPow;
    const list = buildingList(st);
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const c = comp[b.z * N + b.x];
      let on = false;
      if (c >= 0 && cSupply[c] > 0) on = cDemand[c] <= cSupply[c] ? true : served[b.id] === stampNo;
      const v = on ? 1 : 0;
      result[b.id] = v;
      if (b.w * b.d === 1) { powered[b.z * N + b.x] = v; continue; }
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        const i = z * N + x;
        if (bld[i] === b.id) powered[i] = v;
      }
    }
    // empty zoned cells adjacent to a powered conductor
    for (let i = 0; i < C; i++) {
      if (zone[i] === 0 || comp[i] >= 0) continue;
      const x = i % N;
      powered[i] = (x > 0 && powered[i - 1] === 1 && comp[i - 1] >= 0) || (x < N - 1 && powered[i + 1] === 1 && comp[i + 1] >= 0) ||
        (i >= N && powered[i - N] === 1 && comp[i - N] >= 0) || (i + N < C && powered[i + N] === 1 && comp[i + N] >= 0) ? 1 : 0;
    }
  }

  private growPower(n: number): void {
    const size = Math.max(n + 64, this.cSupply.length * 2);
    const g = (a: Float64Array) => { const b = new Float64Array(size); b.set(a); return b; };
    this.cSupply = g(this.cSupply);
    this.cDemand = g(this.cDemand);
    this.cLeft = g(this.cLeft);
  }
  private growWater(n: number): void {
    const size = Math.max(n + 64, this.wSupply.length * 2);
    const g = (a: Float64Array) => { const b = new Float64Array(size); b.set(a); return b; };
    this.wSupply = g(this.wSupply);
    this.wDemand = g(this.wDemand);
    this.wLeft = g(this.wLeft);
  }

  // ------------------------------------------------------------------------------------------ water
  /** road-connected components (pipes run under every road) */
  private labelWater(st: CityState): void {
    const N = st.size, C = st.cells;
    const net = st.network;
    const comp = this.wComp, queue = this.queue;
    comp.fill(-1);
    let nc = 0;
    for (let s = 0; s < C; s++) {
      if (comp[s] >= 0 || net[s] < 1 || net[s] > 5) continue;
      let qh = 0, qt = 0;
      queue[qt++] = s;
      comp[s] = nc;
      while (qh < qt) {
        const i = queue[qh++];
        const x = i % N;
        let j = i - 1;
        if (x > 0 && comp[j] < 0 && net[j] >= 1 && net[j] <= 5) { comp[j] = nc; queue[qt++] = j; }
        j = i + 1;
        if (x < N - 1 && comp[j] < 0 && net[j] >= 1 && net[j] <= 5) { comp[j] = nc; queue[qt++] = j; }
        j = i - N;
        if (j >= 0 && comp[j] < 0 && net[j] >= 1 && net[j] <= 5) { comp[j] = nc; queue[qt++] = j; }
        j = i + N;
        if (j < C && comp[j] < 0 && net[j] >= 1 && net[j] <= 5) { comp[j] = nc; queue[qt++] = j; }
      }
      nc++;
    }
    this.nWComp = nc;
    if (nc > this.wSupply.length) this.growWater(nc);
  }

  /**
   * Water step 1: per-network supply (pumps / treatment plants need power) and demand, intake pollution, tap quality.
   * No short network: results right away (returns false). A short network: the brownout step serves buildings in
   * road distance order from the producers (returns true).
   */
  private waterSums(st: CityState): boolean {
    const N = st.size;
    const comp = this.wComp;
    const nc = this.nWComp;
    const wSupply = this.wSupply, wDemand = this.wDemand, wLeft = this.wLeft;
    wSupply.fill(0, 0, nc);
    wDemand.fill(0, 0, nc);
    if (this.wPoll.length < nc) { this.wPoll = new Float64Array(nc * 2 + 16); this.wQual = new Float32Array(nc * 2 + 16); }
    const wPoll = this.wPoll;
    wPoll.fill(0, 0, nc);
    const bComp = this.bWComp; // per-building component (+1), 0 = none
    const bUse = this.bWUse, bNeedPow = this.bNeedPow, bPow = this.bPow, intake = this.intakeById;
    const list = buildingList(st);
    let supplyTot = 0, demandTot = 0, nSeeds = 0;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const c = adjacentComp(comp, N, b);
      bComp[b.id] = c + 1;
      if (c < 0) continue;
      const u = bUse[b.id];
      if (u < 0) {
        // pumps / treatment plants need power to run
        const out = bNeedPow[b.id] && !bPow[b.id] ? 0 : -u - 1e-9;
        wSupply[c] += out;
        wPoll[c] += out * intake[b.id];
        supplyTot += out;
        if (out > 0) this.wSeedIds = pushId(this.wSeedIds, nSeeds++, b.id);
      } else {
        wDemand[c] += u;
        demandTot += u;
      }
    }
    this.nWSeeds = nSeeds;
    const okW = this.okW.length >= nc ? this.okW : (this.okW = new Uint8Array(nc * 2 + 16));
    let anyShort = false;
    for (let c = 0; c < nc; c++) {
      wLeft[c] = wSupply[c];
      const sup = wSupply[c] > 0;
      okW[c] = sup && wDemand[c] <= wSupply[c] ? 1 : 0;
      if (sup && wDemand[c] > wSupply[c]) anyShort = true;
    }
    st.stats.waterSupply = supplyTot;
    st.stats.waterDemand = demandTot;
    this.waterStamp = ++this.stamp;
    this.tapQuality(st);
    if (!anyShort) {
      this.waterResults(st, false);
      return false;
    }
    return true;
  }

  /** Water step 2 (only when a network is short): BFS over the pipes from the producers, nearest buildings first */
  private waterBrownout(st: CityState): void {
    const N = st.size, C = st.cells;
    const bld = st.building;
    const comp = this.wComp, queue = this.queue, visit = this.visit;
    const watered = st.watered, okW = this.okW;
    const nc = this.nWComp;
    const bComp = this.bWComp, bUse = this.bWUse, served = this.bOk, stamp = this.waterStamp;
    const wSupply = this.wSupply, wDemand = this.wDemand, wLeft = this.wLeft;
    for (let i = 0; i < C; i++) {
      const c = comp[i];
      watered[i] = c >= 0 ? okW[c] : 0;
    }
    if (this.exhaustedW.length < nc) this.exhaustedW = new Uint8Array(nc * 2 + 16);
    const exhausted = this.exhaustedW;
    exhausted.fill(0, 0, nc);
    let qh = 0, qt = 0;
    const seeds = this.wSeedIds;
    for (let q = 0; q < this.nWSeeds; q++) {
      const id = seeds[q];
      const b = st.buildings.get(id);
      if (!b) continue;
      const c = bComp[id] - 1;
      if (c < 0 || !(wDemand[c] > wSupply[c])) continue;
      for (const i of perimeterRoadCells(st, comp, b)) if (visit[i] !== stamp) { visit[i] = stamp; queue[qt++] = i; }
    }
    while (qh < qt) {
      const i = queue[qh++];
      const c = comp[i];
      watered[i] = exhausted[c] ? 0 : 1;
      const x = i % N;
      // neighbours in DX / DZ order (+x, +z, -x, -z): serve adjacent buildings of this network, continue along pipes
      for (let k = 0; k < 4; k++) {
        let j: number;
        if (k === 0) { if (x >= N - 1) continue; j = i + 1; }
        else if (k === 1) { j = i + N; if (j >= C) continue; }
        else if (k === 2) { if (x === 0) continue; j = i - 1; }
        else { j = i - N; if (j < 0) continue; }
        const bid = bld[j];
        if (bid >= 0) {
          const sv = served[bid];
          if (sv !== stamp && sv !== -stamp && bComp[bid] - 1 === c) {
            const u = bUse[bid];
            if (u < 0) served[bid] = stamp;
            else if (exhausted[c] === 0 && wLeft[c] >= u) { wLeft[c] -= u; served[bid] = stamp; }
            else { exhausted[c] = 1; served[bid] = -stamp; }
          }
        }
        if (visit[j] === stamp || comp[j] !== c) continue;
        visit[j] = stamp;
        queue[qt++] = j;
      }
    }
    this.waterResults(st, true);
  }

  /** building results (bWat + footprint cells) and watered empty zoned cells; `brownout`: road cells already written */
  private waterResults(st: CityState, brownout: boolean): void {
    const N = st.size, C = st.cells;
    const zone = st.zone, bld = st.building;
    const comp = this.wComp, watered = st.watered;
    const bComp = this.bWComp, served = this.bOk, stamp = this.waterStamp;
    const wSupply = this.wSupply, wDemand = this.wDemand;
    if (!brownout) {
      const okW = this.okW;
      for (let i = 0; i < C; i++) {
        const c = comp[i];
        watered[i] = c >= 0 ? okW[c] : 0;
      }
    }
    const result = this.bWat;
    const list = buildingList(st);
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const c = bComp[b.id] - 1;
      let on = false;
      if (c >= 0 && wSupply[c] > 0) on = wDemand[c] <= wSupply[c] ? true : served[b.id] === stamp;
      const v = on ? 1 : 0;
      result[b.id] = v;
      if (b.w * b.d === 1) { watered[b.z * N + b.x] = v; continue; }
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        const i = z * N + x;
        if (bld[i] === b.id) watered[i] = v;
      }
    }
    // empty zoned cells within 1 cell of a watered road
    for (let i = 0; i < C; i++) {
      if (zone[i] === 0 || bld[i] >= 0 || comp[i] >= 0) continue;
      const x = i % N;
      watered[i] = (x > 0 && comp[i - 1] >= 0 && watered[i - 1] === 1) || (x < N - 1 && comp[i + 1] >= 0 && watered[i + 1] === 1) ||
        (i >= N && comp[i - N] >= 0 && watered[i - N] === 1) || (i + N < C && comp[i + N] >= 0 && watered[i + N] === 1) ? 1 : 0;
    }
  }

  /** tap water quality per network: supply-weighted intake pollution, cleaned by sewage treatment (pollution pass) */
  private tapQuality(st: CityState): void {
    const nc = this.nWComp;
    const treated = Math.max(0, Math.min(1, st.stats.sewageTreated || 0));
    const clean = 1 - TAP_TREATMENT_CLEAN * treated;
    const wQual = this.wQual, wPoll = this.wPoll, wSupply = this.wSupply, wDemand = this.wDemand;
    let qSum = 0, qW = 0;
    for (let c = 0; c < nc; c++) {
      const sup = wSupply[c];
      const q = sup > 0 ? Math.max(0, Math.min(1, 1 - (wPoll[c] / sup) * clean)) : 1;
      wQual[c] = q;
      const used = Math.min(sup, wDemand[c]);
      if (used > 0) { qSum += used * q; qW += used; }
    }
    st.stats.tapWater = qW > 0 ? qSum / qW : 1;
  }
}

function adjacentComp(comp: Int32Array, N: number, b: Building): number {
  const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d;
  for (let x = x0; x < x1; x++) {
    if (x < 0 || x >= N) continue;
    if (z0 > 0) { const c = comp[(z0 - 1) * N + x]; if (c >= 0) return c; }
    if (z1 < N) { const c = comp[z1 * N + x]; if (c >= 0) return c; }
  }
  for (let z = z0; z < z1; z++) {
    if (z < 0 || z >= N) continue;
    if (x0 > 0) { const c = comp[z * N + x0 - 1]; if (c >= 0) return c; }
    if (x1 < N) { const c = comp[z * N + x1]; if (c >= 0) return c; }
  }
  return -1;
}

function perimeterRoadCells(st: CityState, comp: Int32Array, b: Building): number[] {
  const N = st.size;
  const out: number[] = [];
  for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
    if (x < 0 || z < 0 || x >= N || z >= N) continue;
    const inside = x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d;
    const corner = (x < b.x || x >= b.x + b.w) && (z < b.z || z >= b.z + b.d);
    if (inside || corner) continue;
    const i = z * N + x;
    if (comp[i] >= 0) out.push(i);
  }
  return out;
}

/** intake pollution of a water producer: max(ground water at its centre, water bodies within d cells) */
function intakePollution(st: CityState, b: Building, d: number): number {
  const N = st.size, wm = st.water, L = st.waterPollution;
  const cx = Math.min(N - 1, b.x + (b.w >> 1)), cz = Math.min(N - 1, b.z + (b.d >> 1));
  let p = L[cz * N + cx] || 0;
  for (let z = b.z - d; z < b.z + b.d + d; z++) {
    if (z < 0 || z >= N) continue;
    for (let x = b.x - d; x < b.x + b.w + d; x++) {
      if (x < 0 || x >= N) continue;
      const i = z * N + x;
      if (wm[i] && L[i] > p) p = L[i];
    }
  }
  return p;
}

/** height (m) of a building's site above the mean terrain height within WIND_TURBINE_RADIUS cells */
function relativeHeight(st: CityState, b: Building): number {
  const N = st.size, H = st.heights, W = N + 1;
  const cx = Math.min(N, b.x + (b.w >> 1)), cz = Math.min(N, b.z + (b.d >> 1));
  const h = H[cz * W + cx];
  const R = WIND_TURBINE_RADIUS;
  let s = 0, n = 0;
  for (let z = Math.max(0, cz - R); z <= Math.min(N, cz + R); z += 4) for (let x = Math.max(0, cx - R); x <= Math.min(N, cx + R); x += 4) {
    s += H[z * W + x];
    n++;
  }
  return n > 0 ? h - s / n : 0;
}

/**
 * Tap-water quality 0..1 (1 = clean) at a cell: supply-weighted intake quality of the water network component serving
 * it, with treatment applied (SIM_DEPTH_SPEC WP3-5; consumed by WP1-3). Falls back to the city mean stats.tapWater
 * (cells off the network, or no utilities system).
 */
export function waterQualityAt(sim: Simulation, cell: number): number {
  const u = sim.getSystem<UtilitiesSystem>('utilities');
  return u ? u.waterQualityAt(sim, cell) : sim.state.stats.tapWater ?? 1;
}

/** plant load 0..1 of a power plant (-1 unknown / no utilities system) */
export function plantLoadOf(sim: Simulation, id: number): number {
  return sim.getSystem<UtilitiesSystem>('utilities')?.plantLoad(id) ?? -1;
}
