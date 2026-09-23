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
 *  - Writes state.watered, BF.Watered, stats.waterSupply / waterDemand / tapWater. Shortage news (30-day cooldown).
 * SCHEDULING (InfraScheduler, 3 steps per pass: uses + labels / power / water + flags):
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
  DX, DZ, Fam, type DefInfo, activeJobs, detectJobsUnknown, ensureIdArray, ensureIdFloat, fundingFactor, infoOf,
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
  /** pass step: -1 idle, 0..2 */
  private stepIdx = -1;
  private passFull = false;
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

  private stepCost(sim: Simulation): number {
    const { cells, bld } = sizeFactors(sim);
    const k = this.stepIdx < 0 ? 0 : this.stepIdx;
    const full = this.stepIdx < 0 ? this.dirtyFull : this.passFull;
    if (k === 0) return 1.6 * bld + (full ? 1.6 * cells : 0.6 * cells);
    if (k === 1) return 1.1 * cells + 0.6 * bld;
    return (full && this.dirtyWater ? 0.8 * cells : 0) + 1.5 * cells + 1.1 * bld;
  }

  /** run one step of a (full or soft) refresh pass */
  step(sim: Simulation): void {
    const t0 = nowMs();
    const st = sim.state;
    if (this.stepIdx < 0) {
      this.stepIdx = 0;
      this.passFull = this.dirtyFull || st.day - this.lastFull >= UTIL_FULL_DAYS || this.pComp.length !== st.cells;
    }
    if (this.stepIdx === 0) {
      this.ensure(st);
      const fx = readEffects(st);
      this.prepareUses(st, fx.powerDemand, fx.waterDemand, detectJobsUnknown(st));
      if (this.passFull) {
        this.dirtyFull = false;
        this.labelPower(st);
        this.lastFull = st.day;
      } else this.patchPower(st);
      this.added.length = 0;
      this.removed.length = 0;
      this.soft = false;
      this.stepIdx = 1;
    } else if (this.stepIdx === 1) {
      this.servePower(st);
      this.stepIdx = 2;
    } else {
      if (this.dirtyWater || this.wComp.length !== st.cells) { this.labelWater(st); this.dirtyWater = false; }
      this.serveWater(st);
      this.finish(sim);
      this.stepIdx = -1;
      this.lastServe = st.day;
    }
    this.lastMs = nowMs() - t0;
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
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const inf = infoOf(st, b);
      const ok = b.built >= 1 && (b.flags & (BF.Burnt | BF.Abandoned)) === 0;
      if (inf.powerOut > 0) {
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
   * the component of its neighbours (relabel everything if it bridges two components); removed buildings' cells
   * stop conducting (a possible split is picked up by the next full pass, at most UTIL_FULL_DAYS later).
   */
  private patchPower(st: CityState): void {
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
      if (multi) { this.labelPower(st); return; }
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
  }

  /** per-component supply / demand, brownout ordering, powered cells and building results */
  private servePower(st: CityState): void {
    const N = st.size, C = st.cells;
    const bld = st.building, zone = st.zone;
    const comp = this.pComp, queue = this.queue;
    const powered = st.powered;
    const nc = this.nPComp;
    const bUse = this.bUse;
    const list = buildingList(st);
    this.cSupply.fill(0, 0, nc);
    this.cDemand.fill(0, 0, nc);
    let supplyTot = 0, demandTot = 0;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const c = comp[b.z * N + b.x];
      if (c < 0) continue;
      const u = bUse[b.id];
      if (u < 0) { this.cSupply[c] -= u; supplyTot -= u; }
      else { this.cDemand[c] += u; demandTot += u; }
    }
    for (let c = 0; c < nc; c++) this.cLeft[c] = this.cSupply[c];
    const okComp = this.okComp.length >= nc ? this.okComp : (this.okComp = new Uint8Array(nc * 2 + 16));
    let anyShort = false;
    for (let c = 0; c < nc; c++) {
      okComp[c] = this.cSupply[c] > 0 && this.cDemand[c] <= this.cSupply[c] ? 1 : 0;
      if (this.cSupply[c] > 0 && this.cDemand[c] > this.cSupply[c]) anyShort = true;
    }
    for (let i = 0; i < C; i++) {
      const c = comp[i];
      powered[i] = c >= 0 ? okComp[c] : 0;
    }
    // plant load (share of the component's supply in use) -> pollution activity, inspector
    const loadById = this.loadById;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      if (bUse[b.id] >= 0) continue;
      const c = comp[b.z * N + b.x];
      const sup = c >= 0 ? this.cSupply[c] : 0;
      loadById[b.id] = sup > 0 ? Math.min(1, this.cDemand[c] / sup) : 0;
    }
    // brownout ordering: critical loads first, then a multi-source BFS from plants in short components
    const served = this.bOk;
    const stampNo = ++this.stamp;
    if (anyShort) {
      for (let bI = 0; bI < list.length; bI++) {
        const b = list[bI];
        const u = bUse[b.id];
        if (u <= 0) continue;
        const c = comp[b.z * N + b.x];
        if (c < 0 || !(this.cDemand[c] > this.cSupply[c]) || !isCritical(infoOf(st, b))) continue;
        if (this.cLeft[c] >= u) { this.cLeft[c] -= u; served[b.id] = stampNo; }
      }
      const visit = this.visit;
      let qh = 0, qt = 0;
      for (let bI = 0; bI < list.length; bI++) {
        const b = list[bI];
        if (bUse[b.id] >= 0) continue;
        const c = comp[b.z * N + b.x];
        if (c < 0 || !(this.cDemand[c] > this.cSupply[c])) continue;
        for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
          const i = z * N + x;
          if (visit[i] === stampNo) continue;
          visit[i] = stampNo;
          queue[qt++] = i;
        }
      }
      const exhausted = new Uint8Array(nc);
      while (qh < qt) {
        const i = queue[qh++];
        const c = comp[i];
        const bid = bld[i];
        if (bid >= 0 && served[bid] !== stampNo && served[bid] !== -stampNo) {
          const u = bUse[bid];
          if (u < 0) served[bid] = stampNo; // plant
          else if (!exhausted[c] && this.cLeft[c] >= u) { this.cLeft[c] -= u; served[bid] = stampNo; }
          else { exhausted[c] = 1; served[bid] = -stampNo; }
        }
        powered[i] = exhausted[c] ? 0 : 1;
        const x = i % N, z = (i - x) / N;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], nz = z + DZ[k];
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const j = nz * N + nx;
          if (visit[j] === stampNo || comp[j] !== c) continue;
          visit[j] = stampNo;
          queue[qt++] = j;
        }
      }
    }
    const result = this.bPow;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const c = comp[b.z * N + b.x];
      let on = false;
      if (c >= 0 && this.cSupply[c] > 0) on = this.cDemand[c] <= this.cSupply[c] ? true : served[b.id] === stampNo;
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
    st.stats.powerSupply = supplyTot;
    st.stats.powerDemand = demandTot;
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

  private serveWater(st: CityState): void {
    const N = st.size, C = st.cells;
    const zone = st.zone, bld = st.building;
    const comp = this.wComp, queue = this.queue;
    const watered = st.watered;
    const nc = this.nWComp;
    this.wSupply.fill(0, 0, nc);
    this.wDemand.fill(0, 0, nc);
    if (this.wPoll.length < nc) { this.wPoll = new Float64Array(nc * 2 + 16); this.wQual = new Float32Array(nc * 2 + 16); }
    const wPoll = this.wPoll;
    wPoll.fill(0, 0, nc);
    const bComp = this.bWComp; // per-building component (+1), 0 = none
    const bUse = this.bWUse;
    const list = buildingList(st);
    let supplyTot = 0, demandTot = 0;
    const seeds: number[] = [];
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const c = adjacentComp(comp, N, b);
      bComp[b.id] = c + 1;
      if (c < 0) continue;
      const u = bUse[b.id];
      if (u < 0) {
        // pumps / treatment plants need power to run
        const out = this.bNeedPow[b.id] && !this.bPow[b.id] ? 0 : -u - 1e-9;
        this.wSupply[c] += out;
        wPoll[c] += out * this.intakeById[b.id];
        supplyTot += out;
        if (out > 0) seeds.push(b.id);
      } else {
        this.wDemand[c] += u;
        demandTot += u;
      }
    }
    for (let c = 0; c < nc; c++) this.wLeft[c] = this.wSupply[c];
    const okW = this.okComp.length >= nc ? this.okComp : (this.okComp = new Uint8Array(nc * 2 + 16));
    let anyShort = false;
    for (let c = 0; c < nc; c++) {
      okW[c] = this.wSupply[c] > 0 && this.wDemand[c] <= this.wSupply[c] ? 1 : 0;
      if (this.wSupply[c] > 0 && this.wDemand[c] > this.wSupply[c]) anyShort = true;
    }
    for (let i = 0; i < C; i++) {
      const c = comp[i];
      watered[i] = c >= 0 ? okW[c] : 0;
    }
    const servedStamp = ++this.stamp;
    const served = this.bOk;
    if (anyShort) {
      const visit = this.visit;
      const exhausted = new Uint8Array(nc);
      let qh = 0, qt = 0;
      for (const id of seeds) {
        const b = st.buildings.get(id)!;
        const c = bComp[id] - 1;
        if (!(this.wDemand[c] > this.wSupply[c])) continue;
        const tmp = perimeterRoadCells(st, comp, b);
        for (const i of tmp) if (visit[i] !== servedStamp) { visit[i] = servedStamp; queue[qt++] = i; }
      }
      while (qh < qt) {
        const i = queue[qh++];
        const c = comp[i];
        const x = i % N, z = (i - x) / N;
        watered[i] = exhausted[c] ? 0 : 1;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], nz = z + DZ[k];
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const j = nz * N + nx;
          const bid = bld[j];
          if (bid >= 0 && served[bid] !== servedStamp && served[bid] !== -servedStamp && bComp[bid] - 1 === c) {
            const u = bUse[bid];
            if (u < 0) served[bid] = servedStamp;
            else if (!exhausted[c] && this.wLeft[c] >= u) { this.wLeft[c] -= u; served[bid] = servedStamp; }
            else { exhausted[c] = 1; served[bid] = -servedStamp; }
          }
          if (visit[j] === servedStamp || comp[j] !== c) continue;
          visit[j] = servedStamp;
          queue[qt++] = j;
        }
      }
    }
    const result = this.bWat;
    for (let bI = 0; bI < list.length; bI++) {
      const b = list[bI];
      const c = bComp[b.id] - 1;
      let on = false;
      if (c >= 0 && this.wSupply[c] > 0) on = this.wDemand[c] <= this.wSupply[c] ? true : served[b.id] === servedStamp;
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
    st.stats.waterSupply = supplyTot;
    st.stats.waterDemand = demandTot;
    // tap water quality per network: supply-weighted intake pollution, cleaned by sewage treatment (pollution pass)
    const treated = Math.max(0, Math.min(1, st.stats.sewageTreated || 0));
    const clean = 1 - TAP_TREATMENT_CLEAN * treated;
    const wQual = this.wQual;
    let qSum = 0, qW = 0;
    for (let c = 0; c < nc; c++) {
      const sup = this.wSupply[c];
      const q = sup > 0 ? Math.max(0, Math.min(1, 1 - (wPoll[c] / sup) * clean)) : 1;
      wQual[c] = q;
      const used = Math.min(sup, this.wDemand[c]);
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
