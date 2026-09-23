/**
 * EconRuntime — shared scratch + indices for the sim-core economy systems (one instance per economySystems() call).
 * Rebuilt from CityState on init (new game / load). Listens to Simulation events to keep indices fresh.
 * Persistent economy data lives in state.systemData.economy (EconData, structured-clone friendly).
 *
 * INFRA DETECTION: sim-infra's systems set state.systemData.infraVersion (any value). Optionally
 * state.systemData.infraLayers = { utilities?, traffic?, pollution?, services? } booleans for partial infra.
 * Without infra: buildings count as powered / watered, commute = COMMUTE_FALLBACK, coverage = COVERAGE_FALLBACK.
 */
import { BF, type Building, type CityState } from '../CityState';
import type { Simulation } from '../Simulation';
import { DEV_TYPE_COUNT } from '../../core/types';
import { getDef } from '../catalog';
import type { BuildingDef } from '../catalogTypes';
import { COARSE, WORKFORCE_RATIO } from './tuning';

export interface EconData {
  v: number;
  /** smoothed absolute demand (capacity units) per DevType, used by growth */
  demandAbs: number[];
  /** raw target per DevType (after caps & modifiers) */
  target: number[];
  /** uncapped target per DevType */
  rawTarget: number[];
  /** 1 when the demand cap is binding for that DevType */
  capBinding: number[];
  /** growth allowance carry-over per DevType */
  carry: number[];
  monthsNegative: number;
  bankrupt: boolean;
  /** advisor cooldowns: message id → absolute day last shown */
  cooldowns: Record<string, number>;
  /** advisor back-off: message id → consecutive repeats while the condition persisted */
  streak?: Record<string, number>;
  /** months each service has been on strike */
  strikes: Record<string, number>;
  /** approval before smoothing */
  approvalRaw: number;
  /** pop-weighted resident experience (monthly): */
  resCrime: number;
  resPollution: number;
  resCommute: number;
  resServices: number;
  resParks: number;
  resEdu: number;
  resHealth: number;
  /** tourism score (landmarks, parks, airports, ordinance) */
  tourism: number;
  /** highest population milestone announced */
  popMilestone: number;
  /** last month's net income */
  lastNet: number;

  // ---- SIM_DEPTH_SPEC (Phase 0; defaulted with ??= in econData() so older saves load)
  /** tourists per day (WP4), attractiveness 0..100 overall / per wealth (WP4) */
  tourists: number;
  attractiveness: number;
  attractByWealth: number[];
  /** approval / attractiveness terms of the last monthly update, id -> points (WP4) */
  approvalTerms: Record<string, number>;
  attractTerms: Record<string, number>;
  /** overnight visitors without a hotel room (WP4) */
  hotelShortage: number;
  /** migration multipliers per wealth (WP4; 1 = neutral) */
  migration: number[];
  /** regional demand terms of the last demand update (WP4-1; WP5 demand tooltip) */
  regionTerms?: RegionTerms;
}

/** WP4-1 regional demand terms (capacity units added to the targets / caps) */
export interface RegionTerms {
  R: number[];
  CS: number[];
  CO: number;
  I: number;
  /** multiplier on the industrial target from the regional market */
  market: number;
  capR: number;
  capC: number;
  capI: number;
}

export function econData(st: CityState): EconData {
  let d = st.systemData.economy as EconData | undefined;
  if (!d || d.v !== 1) {
    d = {
      v: 1,
      demandAbs: new Array(DEV_TYPE_COUNT).fill(0),
      target: new Array(DEV_TYPE_COUNT).fill(0),
      rawTarget: new Array(DEV_TYPE_COUNT).fill(0),
      capBinding: new Array(DEV_TYPE_COUNT).fill(0),
      carry: new Array(DEV_TYPE_COUNT).fill(0),
      monthsNegative: 0,
      bankrupt: false,
      cooldowns: {},
      streak: {},
      strikes: {},
      approvalRaw: 50,
      resCrime: 0,
      resPollution: 0,
      resCommute: 25,
      resServices: 0.4,
      resParks: 0.3,
      resEdu: 0.4,
      resHealth: 0.4,
      tourism: 0,
      popMilestone: 0,
      lastNet: 0,
      tourists: 0,
      attractiveness: 0,
      attractByWealth: [0, 0, 0],
      approvalTerms: {},
      attractTerms: {},
      hotelShortage: 0,
      migration: [1, 1, 1],
    };
    st.systemData.economy = d;
  }
  d.tourists ??= 0;
  d.attractiveness ??= 0;
  d.attractByWealth ??= [0, 0, 0];
  d.approvalTerms ??= {};
  d.attractTerms ??= {};
  d.hotelShortage ??= 0;
  d.migration ??= [1, 1, 1];
  return d;
}

export interface InfraFlags {
  any: boolean;
  utilities: boolean;
  traffic: boolean;
  pollution: boolean;
  services: boolean;
}
export function infraFlags(st: CityState): InfraFlags {
  const any = st.systemData.infraVersion !== undefined;
  const layers = st.systemData.infraLayers as Partial<Record<'utilities' | 'traffic' | 'pollution' | 'services', boolean>> | undefined;
  return {
    any,
    utilities: any && (layers?.utilities ?? true),
    traffic: any && (layers?.traffic ?? true),
    pollution: any && (layers?.pollution ?? true),
    services: any && (layers?.services ?? true),
  };
}

/** per-day aggregate totals (recomputed daily by the population system) */
export interface Totals {
  /** residents by wealth */
  pop: [number, number, number];
  /** R capacity incl. under construction, excl. abandoned/burnt, by wealth */
  resCapAll: [number, number, number];
  resCapBuilt: [number, number, number];
  /** per DevType (C/I entries meaningful) */
  jobs: number[];
  jobCapAll: number[];
  jobCapBuilt: number[];
  civicJobCap: number;
  civicJobs: number;
  abandoned: number;
  constructing: number;
  growables: number;
  /** growables per DevType (built or constructing) */
  countByDev: number[];
  /** capacity of R buildings per stage, for stats */
  population: number;
}

function emptyTotals(): Totals {
  return {
    pop: [0, 0, 0],
    resCapAll: [0, 0, 0],
    resCapBuilt: [0, 0, 0],
    jobs: new Array(DEV_TYPE_COUNT).fill(0),
    jobCapAll: new Array(DEV_TYPE_COUNT).fill(0),
    jobCapBuilt: new Array(DEV_TYPE_COUNT).fill(0),
    civicJobCap: 0,
    civicJobs: 0,
    abandoned: 0,
    constructing: 0,
    growables: 0,
    countByDev: new Array(DEV_TYPE_COUNT).fill(0),
    population: 0,
  };
}

export class EconRuntime {
  sim!: Simulation;
  private subscribedTo: Simulation | null = null;
  private unsub: (() => void)[] = [];
  private initializedFor: CityState | null = null;

  /** growable buildings (array for fast iteration); rebuilt lazily when dirty */
  growables: Building[] = [];
  /** plopped buildings */
  plopped: Building[] = [];
  /** def cache per building id (avoid map lookups in hot loops) */
  private buildingsDirty = true;
  /** full rebuild of plopped land value effects needed (new game / load) */
  lvEffectsDirty = true;
  /** landfill zones changed → landfill land value splat must be recomputed */
  lvLandfillDirty = true;
  /** incremental plopped land value splats: [building, sign, building, sign, …] */
  lvQueue: (Building | number)[] = [];
  capsDirty = true;
  /** set when zones / networks / buildings change: growth candidate list must be rebuilt */
  candidatesDirty = true;
  /** set when networks change (freight access, connections) */
  networkDirty = true;
  /** terrain changed (static land value: water distance, view) */
  terrainDirty = true;

  totals: Totals = emptyTotals();
  /** workforce fill ratio of jobs (0..1) from the last daily aggregation */
  jobFill = 0;
  /** employment ratio of workers */
  employedRatio = 0;
  /** pop-weighted traffic job access (0..1), -1 when the traffic system gives none */
  accessAvg = -1;

  // ---- coarse grids (COARSE × COARSE cell blocks)
  cw = 0;
  /** residents per coarse block (blurred) */
  coarsePop!: Float32Array;
  /** raw residents per coarse block (accumulated during aggregation) */
  coarsePopRaw!: Float32Array;
  /** avg wealth (−1..1) of buildings per coarse block (blurred) */
  coarseWealth!: Float32Array;
  coarseWealthRaw!: Float32Array;
  coarseCountRaw!: Float32Array;
  /** freight access 0..1 per coarse block */
  coarseFreight!: Float32Array;
  // ---- SIM_DEPTH_SPEC (WP1 writes; zero / neutral until then)
  /** actual workforce / population ratio (EMA, clamped [0.46, 0.62]); demand uses it instead of WORKFORCE_RATIO */
  workforceRatio = WORKFORCE_RATIO;
  /** residents per coarse block by wealth [R$, R$$, R$$$] (blurred like coarsePop) */
  coarsePopW: Float32Array[] = [new Float32Array(0), new Float32Array(0), new Float32Array(0)];
  /** population-weighted education b.edu per coarse block (blurred) */
  coarseSkill!: Float32Array;
  /** kids per coarse block (blurred) */
  coarseKids!: Float32Array;

  // ---- static land value (terrain): per cell
  lvStatic!: Float32Array;
  /** land value effects of plopped buildings (raw sum of splats; clamped when read) */
  lvEffects!: Float32Array;
  /** land value effect of landfill zones */
  lvLandfill!: Float32Array;

  /** growth candidate front cells (zoned, empty, next to a road) */
  candidates: Int32Array = new Int32Array(0);
  candidateCount = 0;
  /** zoned empty cells per zone (incl. no road) — UI / advisors */
  emptyZoned: number[] = new Array(11).fill(0);
  /** candidate (road-accessible) empty cells per zone */
  emptyFront: number[] = new Array(11).fill(0);
  /** constructing buildings */
  constructing: Building[] = [];

  /** timing (ms) of the last daily run per system, for profiling */
  timing: Record<string, number> = {};

  attach(sim: Simulation): void {
    this.sim = sim;
    if (this.subscribedTo !== sim) {
      for (const u of this.unsub) u();
      const ev = sim.events;
      this.unsub = [
        ev.on('buildingAdded', (b) => this.onAdded(b)),
        ev.on('buildingRemoved', (b) => this.onRemoved(b)),
        ev.on('zoneChanged', () => { this.candidatesDirty = true; this.lvLandfillDirty = true; }),
        ev.on('networkChanged', () => { this.candidatesDirty = true; this.networkDirty = true; this.capsDirty = true; }),
        ev.on('terrainChanged', () => { this.terrainDirty = true; }),
        ev.on('reset', () => this.reset()),
      ];
      this.subscribedTo = sim;
    }
    if (this.initializedFor !== sim.state) this.reset();
  }

  /** rebuild everything from the current state (new game / load) */
  reset(): void {
    const st = this.sim.state;
    this.initializedFor = st;
    const N = st.size;
    this.cw = Math.ceil(N / COARSE);
    const cc = this.cw * this.cw;
    this.coarsePop = new Float32Array(cc);
    this.coarsePopRaw = new Float32Array(cc);
    this.coarseWealth = new Float32Array(cc);
    this.coarseWealthRaw = new Float32Array(cc);
    this.coarseCountRaw = new Float32Array(cc);
    this.coarseFreight = new Float32Array(cc);
    this.coarsePopW = [new Float32Array(cc), new Float32Array(cc), new Float32Array(cc)];
    this.coarseSkill = new Float32Array(cc);
    this.coarseKids = new Float32Array(cc);
    this.workforceRatio = WORKFORCE_RATIO;
    this.lvStatic = new Float32Array(st.cells);
    this.lvEffects = new Float32Array(st.cells);
    this.lvLandfill = new Float32Array(st.cells);
    this.lvQueue = [];
    this.lvLandfillDirty = true;
    this.candidates = new Int32Array(st.cells);
    this.candidateCount = 0;
    this.buildingsDirty = true;
    this.lvEffectsDirty = true;
    this.capsDirty = true;
    this.candidatesDirty = true;
    this.networkDirty = true;
    this.terrainDirty = true;
    this.totals = emptyTotals();
    this.constructing = [];
    this.defCache = [];
    econData(st);
    this.rebuildBuildingLists();
  }

  /** position of a building in growables / plopped (by building id), -1 = none */
  private listIndex: Int32Array = new Int32Array(1024).fill(-1);

  private setIndex(id: number, pos: number): void {
    if (id >= this.listIndex.length) {
      const n = new Int32Array(Math.max(id + 1, this.listIndex.length * 2)).fill(-1);
      n.set(this.listIndex);
      this.listIndex = n;
    }
    this.listIndex[id] = pos;
  }

  /** O(1) swap-remove of a building from its list */
  private dropFromList(b: Building): void {
    const list = b.flags & BF.Plopped ? this.plopped : this.growables;
    const pos = b.id < this.listIndex.length ? this.listIndex[b.id] : -1;
    if (pos < 0 || pos >= list.length || list[pos] !== b) { this.buildingsDirty = true; return; }
    const last = list[list.length - 1];
    list[pos] = last;
    this.listIndex[last.id] = pos;
    list.pop();
    this.listIndex[b.id] = -1;
  }

  private onAdded(b: Building): void {
    if (b.flags & BF.Plopped) {
      this.setIndex(b.id, this.plopped.length);
      this.plopped.push(b);
      this.lvQueue.push(b, 1);
      this.capsDirty = true;
    } else {
      this.setIndex(b.id, this.growables.length);
      this.growables.push(b);
      if (b.flags & BF.Constructing) this.constructing.push(b);
    }
    // growth re-validates candidate cells itself; the list is rebuilt on zone / network changes (and every 10 days)
  }

  private onRemoved(b: Building): void {
    this.dropFromList(b);
    if (b.flags & BF.Plopped) {
      this.lvQueue.push(b, -1);
      this.capsDirty = true;
      // recount (other systems may remove buildings without touching milestones)
      const st = this.sim.state;
      let n = 0;
      for (const o of st.buildings.values()) if (o.def === b.def && o.flags & BF.Plopped) n++;
      if (n > 0) st.milestones[b.def] = n;
      else delete st.milestones[b.def];
    }
  }

  /** rebuild growables / plopped / constructing arrays if a removal happened */
  ensureLists(): void {
    if (this.buildingsDirty) this.rebuildBuildingLists();
  }

  private rebuildBuildingLists(): void {
    const st = this.sim.state;
    this.growables = [];
    this.plopped = [];
    this.constructing = [];
    this.listIndex.fill(-1);
    for (const b of st.buildings.values()) {
      if (b.flags & BF.Plopped) { this.setIndex(b.id, this.plopped.length); this.plopped.push(b); }
      else {
        this.setIndex(b.id, this.growables.length);
        this.growables.push(b);
        if (b.flags & BF.Constructing) this.constructing.push(b);
      }
    }
    this.buildingsDirty = false;
  }

  /** def of a building, cached by building id (hot loops) */
  defOf(b: Building): BuildingDef | undefined {
    const c = this.defCache[b.id];
    if (c !== undefined && c.id === b.def) return c;
    const d = getDef(b.def);
    if (d) this.defCache[b.id] = d;
    return d;
  }
  private defCache: BuildingDef[] = [];
}
