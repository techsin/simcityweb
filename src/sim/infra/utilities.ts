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
 *    (30-day cooldown). Final fixes N1: a pass that cuts OCCUPIED buildings off because their grid / pipe network lost
 *    its producer (a bulldozed road, line, plant or pump — not the brownout's deliberate farthest-first cut) posts
 *    "Power cut" / "Water cut" news at once with the counts and the biggest building's place (UTIL_CUT_NEWS_DAYS).
 * SCHEDULING (InfraScheduler; estimates in stepCost):
 *    uses (+ local label patch) -> [labels: full passes / a new building bridging two grids] -> power sums + loads
 *    (+ results when no grid is short) -> [brownout: critical-first + distance-ordered BFS, only when a grid is
 *    short] -> water sums (+ results, flags) -> [water brownout BFS + results, flags: only when a network is short].
 *    B2 (docs/dev/B2_DESIGN.md §7): each of these steps runs as a sequence of small pieces (one scheduler step each, about
 *    half INFRA_PIECE_COLD_MS estimated warm ms): the building loops over chunks of one building snapshot per pass, the
 *    cell loops by cell ranges, the labels and brownout searches by BFS pieces, into private buffers — every external
 *    output (labels, sums, plant loads, producers, st.powered / st.watered, the flags, stats) changes in one piece, the
 *    flags from a candidate list applied in one piece. A pass whose pieces run with nothing in between computes exactly
 *    what the pre-B2 steps computed.
 *  R7 audit (the public queries, what they read, the piece that publishes it): gridInfo — pComp / nPComp (the power
 *    label's last piece; patchPower in the uses' last piece), cSupply / cDemand (the power sums' last chunk); waterInfo
 *    and waterQualityAt — wComp / nWComp (the water label's last piece), bWComp, wSupply / wDemand, wQual and
 *    stats.tapWater (the water sums' last chunk); plantLoad — loadById (the power sums' last chunk); producerInfo —
 *    producers (the uses' last chunk, a swap) and their load (the power sums' last chunk, as pre-B2 two steps); st.powered
 *    / st.watered (the results' last piece); BF.Powered / BF.Watered (the flags' publish piece). Pre-B2's window from a
 *    label to the next sums, in which gridInfo pairs new labels with old sums, is unchanged.
 *  - full pass (relabel components): network / power-line / plopped-building changes (urgent, next scheduler slot)
 *    and every UTIL_FULL_DAYS days;
 *  - soft pass (labels patched locally for growables added / removed, sums + brownout + flags): within
 *    UTIL_SOFT_DAYS of a growth change / zone change and every UTIL_REFRESH_DAYS days (demand drifts with pop).
 */
import { Network, isRoad, zoneDensity } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { getDef } from '../catalog';
import { WATER_REQUIRED_STAGE } from '../economy/tuning';
import {
  Fam, type DefInfo, activeJobs, detectJobsUnknown, ensureIdArray, ensureIdFloat, fundingFactor, infoOf,
  readEffects, setFlagQuiet, nowMs,
  buildingList, BuildingSnapshot,
} from './common';
import {
  DESAL_INLAND_OUT, POWER_MIN_PLOPPED, POWER_PER_CIVIC_JOB, POWER_PER_JOB_C, POWER_PER_JOB_I, POWER_PER_RES,
  PUMP_POLL_LOSS, PUMP_TREATED_LOSS, PUMP_WATER_BONUS, PUMP_WATER_DIST, SEA_PUMP_OUT, SHORTAGE_NEWS_DAYS, SOLAR_CLIMATE,
  SOLAR_SUMMER, SOLAR_WINTER, TAP_TREATMENT_CLEAN, THERMAL_UNWATERED, UTIL_BASE_SHARE, UTIL_CUT_NEWS_DAYS, UTIL_FULL_DAYS, UTIL_REFRESH_DAYS,
  UTIL_SOFT_DAYS, WATER_PER_CIVIC_JOB, WATER_PER_JOB_C, WATER_PER_JOB_I, WATER_PER_RES, WIND_TURBINE_BASE,
  WIND_TURBINE_GAIN, WIND_TURBINE_H0, WIND_TURBINE_H1, WIND_TURBINE_RADIUS,
  INFRA_BLD_SIZING_US, INFRA_CELL_SIZING_US, INFRA_PIECE_COLD_MS,
} from './params';
import { pieceBudgetUs, pieceUnits, schedulerOf } from './scheduler';
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

// ---- B2 pieces (docs/dev/B2_DESIGN.md §7). `sub` numbers the pieces of the whole pass; the state ids (U_*) and their
// transitions are the pre-B2 ones (stepIdx moves on when a state's last piece is done).
// U_USES: the pass start (its inputs consumed, R5), the snapshot, its chunk plan, the sea mask, the treatment prefix scan,
// the uses chunks (the last one publishes the producers, the nuclear news and the label patch)
const S_START = 0, S_SNAP = 1, S_PLAN = 2, S_SEA = 3, S_SCAN = 4, S_USES = 5;
// the labels (U_LABEL; the water label also as U_WATER's mid-pass relabel): BFS pieces into private buffers, published by
// a swap in the last piece
const S_PLABEL = 6, S_WLABEL = 7;
// U_POWER: the sums chunks (the last one publishes); the results (also U_BROWN's): cells, building chunks, zoned cells
// (the last one publishes st.powered)
const S_PSUM = 8, S_PCELLS = 9, S_PBLD = 10, S_PZONED = 11;
// U_BROWN: cells, seeds, the BFS pieces (then S_PBLD / S_PZONED)
const S_BCELLS = 12, S_BSEED = 13, S_BBFS = 14;
// U_WATER: the sums chunks (the first may start the mid-pass relabel; the last one publishes); the results (also
// U_WATER_BROWN's: the last one publishes st.watered)
const S_WSUM = 15, S_WCELLS = 16, S_WBLD = 17, S_WZONED = 18;
// U_WATER_BROWN: cells, seeds, the BFS pieces (then S_WBLD / S_WZONED)
const S_WBCELLS = 19, S_WBSEED = 20, S_WBBFS = 21;
// the finish (in U_WATER / U_WATER_BROWN): building chunks (flag candidates, cooling water, the cut tally), the flags'
// publish, the events (the last piece: the news, layerUpdated, the pass end)
const S_FBLD = 22, S_FAPPLY = 23, S_FEV = 24;
const SUB_NAMES = ['start', 'snap', 'plan', 'sea', 'scan', 'bld', 'plabel', 'wlabel', 'sum', 'cells', 'bld', 'zoned', 'cells', 'seed', 'bfs',
  'sum', 'cells', 'bld', 'zoned', 'cells', 'seed', 'bfs', 'flags', 'apply', 'events'];
const STATE_NAMES = ['uses', 'label', 'power', 'brownout', 'water', 'waterBrownout'];
const CHUNKED = new Set([S_USES, S_PSUM, S_PBLD, S_WSUM, S_WBLD, S_FBLD]);
/**
 * B2 piece budget (design R2): every utilities loop runs once per pass. The passes are frequent (every few days at
 * dense1m, urgent after edits), so half INFRA_PIECE_COLD_MS as pollution's building loops, with G2's cold cell and
 * Building floors (params INFRA_CELL_SIZING_US / INFRA_BLD_SIZING_US): about 16,000 cells or 270 buildings per piece.
 */
const COLD = INFRA_PIECE_COLD_MS / 2;
/**
 * the absolute scale of the estimates: stepCost = UT_EST x (UT.piece + the piece's units x UT) / 1000. UT sets the relative
 * costs (and, with the budget, the cell and BFS chunk sizes); UT_EST makes the estimate honest warm wall ms without moving
 * a chunk (traffic's TR_EST pattern).
 */
const UT_EST = 1;
/**
 * B2 cost model (design §9): estimated warm wall µs per work unit of each kind of piece. Start values: the utilities
 * mapping's in-schedule fits (uses 0.08 ms + 16 ns per prefix-scanned building + 24 ns·B + 17 ns·F; label 13.7 ns per
 * cell; power sums 15·B + 3·F, results 5.1·C + 5.9·B + 7.9·F; brownout 5.5·C + 27·Q + 12·F; water sums 12·B + 9·F,
 * results 4.2·C + 4.4·B + 8.5·F, finish 14.5·B + 400·E; water brownout 6.3·C + 70-99·Q). G4 refit (dense1m and bot256,
 * --warm 300 --days 120, 3 runs each: each label's coefficients divided by the geometric mean of its median est / ms on
 * the two fixtures): uses chunks / 1.27, power sums / 1.95, power results / 1.21, water sums / 1.43, water results / 1.31,
 * finish / 1.49, plan / 1.38, label x 1.22, zoned x 1.37, snapshot x 1.18, the pass start 15 -> 25, the water brownout's
 * seeds 0.3 -> 1 µs per seed (+ 8), the flags' publish 2 -> 6, the pass end 40 -> 26; a second hold put the building
 * chunks at 1.24-1.55 x their measured cost on dense1m and 0.93-1.15 x on bot256 (utilities' median error +0.39 / -0.01),
 * so the six chunk kinds' coefficients were divided by 1.18 more (centring the two fixtures). None of them sizes a piece
 * (US, UT_PLAN_* do), so the refits moved no boundary.
 */
const UT = {
  /** per piece (dispatch, cursors, ensureIds) */
  piece: 1.5,
  /** the pass start (ensure, effects, the input swaps); the snapshot per building (the day's first buildingList rebuild
   *  + the copy + the jobs check), its plan per building */
  start: 25, snapTake: 0.0165, plan: 0.0087,
  /** the sea mask (the masks' checksum) per cell; the treatment prefix scan per building */
  sea: 0.0015, scan: 0.016,
  /** the uses chunks per building / footprint cell; their publish (fixed) + per patched (added / removed) building */
  usesB: 0.0161, usesF: 0.0114, usesPub: 4, patch: 0.08,
  /** the labels per unit (a cell scanned or a cell taken off the BFS queue); a label's publish (fixed) */
  label: 0.0085, labelPub: 2,
  /** power sums per building / footprint cell; their publish (fixed) + per component / plant / critical load */
  sumB: 0.0065, sumF: 0.0013, sumPub: 4, sumComp: 0.004, sumPlant: 0.2, sumCrit: 0.05,
  /** results: the cell loop per cell, per building / footprint cell, the zoned loop per cell, the layer copy per cell */
  cells: 0.0025, resB: 0.0042, resF: 0.0055, zoned: 0.0036, copy: 0.0002,
  /** brownout: the seeds per plant footprint cell, the BFS per queue cell */
  seed: 0.01, bfs: 0.027,
  /** water sums per building / footprint cell; their publish (fixed) + per component (tap quality) */
  wsumB: 0.0071, wsumF: 0.0053, wsumPub: 4, wsumComp: 0.01,
  /** water results per building / footprint cell; the water brownout's seeds per seed, its BFS per queue cell */
  wresB: 0.0029, wresF: 0.0055, wseed: 1, wbfs: 0.085,
  /** the finish per building / footprint cell, the flags' publish per candidate, per event, the pass end (news,
   *  layerUpdated and its listeners) */
  finB: 0.0082, finF: 0.0006, apply: 0.05, event: 0.4, end: 26,
} as const;
/**
 * the chunk sizes, in estimated µs per unit (pieceUnits / cellUnits; kept apart from the estimates' UT coefficients, so a
 * refit of the estimates never moves a piece boundary — traffic's TR_EST lesson): the plan per building, a label unit
 * (a cell scanned or dequeued), the cell loops (the cold cell floor), a brownout queue cell, an event
 */
const US = { plan: 0.012, label: 0.007, cells: INFRA_CELL_SIZING_US, zoned: INFRA_CELL_SIZING_US, bfs: 0.027, wbfs: 0.085, event: 0.4 } as const;
/** the chunk plan of the pass snapshot (every building stage walks it): the cold Building floor per building + 20 ns per
 *  footprint cell (the results' footprint writes; sizing only — the estimates use each stage's own coefficients) */
const UT_PLAN_B = INFRA_BLD_SIZING_US, UT_PLAN_F = 0.02;
/** the treatment prefix scan's sizing per building (a DefInfo lookup and two fields: half the Building floor, about 540
 *  buildings per piece; at a quarter its first pieces after a load ran at ~3 µs per building, 4.1 ms) */
const UT_SCAN_SIZING = INFRA_BLD_SIZING_US / 2;
/** cells of one piece of a once-per-pass cell loop costing `us` per cell (the cold cell floor) */
function cellUnits(us: number): number {
  return pieceUnits(us > INFRA_CELL_SIZING_US ? us : INFRA_CELL_SIZING_US, 1, COLD);
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
  /** treatment-scan prefix, overwritten on every prepareUses call (list order, never building ids) */
  private useInfo: DefInfo[] = [];
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
  /** last "Power cut" / "Water cut" news (final fixes N1); no such news for the init / load pass */
  private lastCutNews = -1e9;
  private cutQuiet = false;
  private simRef: Simulation | null = null;
  /** duration (ms) of the last step / last full synchronous compute */
  lastMs = 0;

  // ---- B2 piece state (design §7). Every field below is reset at each pass start and end and in init (resetPieces);
  // none is saved (R9).
  /** the piece inside the pass (S_*) and its cursor (chunk / cell / row index) */
  private sub = 0;
  private cur = 0;
  /** the pass snapshot (R4): every building stage of the pass walks it */
  private snap = new BuildingSnapshot();
  /** the pass inputs (R3: computed once per pass at its first piece, as pre-B2 once per uses step) */
  private pMul = 1;
  private wMul = 1;
  private jobsUnknown = false;
  private eff = 1;
  private nuclearMul = 1;
  private nuclearLost = 0;
  private season = 0;
  private climate = 1;
  private seaM: Uint8Array | null = null;
  private pollRef: PollutionSystem | null = null;
  /** the treatment prefix scan: its length and result */
  private nInfo = 0;
  private hasTreatment = false;
  /** the growables added / removed before this pass (swapped out of `added` / `removed` at its start, R5) */
  private passAdded: Building[] = [];
  private passRemoved: Building[] = [];
  /** the producers of the pass being built (published by a swap at the uses step's end: producerInfo) */
  private producersNext = new Map<number, ProducerInfo>();
  /** a label in pieces: into the private buffer, next start cell, components so far, BFS queue head / tail, in a BFS */
  private pCompNext = new Int32Array(0);
  private wCompNext = new Int32Array(0);
  private lBegun = false;
  private lS = 0;
  private lNc = 0;
  private lBusy = false;
  /** the water label's next piece (S_PSUM: U_LABEL's; S_WSUM: U_WATER's mid-pass relabel); U_WATER's relabel check done */
  private wlNext = S_PSUM;
  private wChecked = false;
  /** the sums (pre-B2's double locals), into private per-component buffers published by .set() (gridInfo / waterInfo /
   *  waterQualityAt never see half sums), the per-id network of the water sums likewise */
  private supplyTot = 0;
  private demandTot = 0;
  private cSupplyN = new Float64Array(256);
  private cDemandN = new Float64Array(256);
  private wSupplyN = new Float64Array(256);
  private wDemandN = new Float64Array(256);
  private wPollN = new Float64Array(256);
  private bWCompN = new Int32Array(0);
  private nSeeds = 0;
  /** the results into private layers, published by one .set() (R7 / R9: st.powered / st.watered are saved) */
  private poweredNext = new Uint8Array(0);
  private wateredNext = new Uint8Array(0);
  /** the results follow a brownout (their cells are written already) */
  private brown = false;
  /** a brownout BFS: queue head / tail */
  private qh = 0;
  private qt = 0;
  /** the finish: flag candidates (4 x snapshot index + the wanted Powered (1) / Watered (2) bits, for each building whose
   *  bits flip: applied in one piece, R7 / R9 — rememberCoolingWater reads the saved flags on load) and the changed list */
  private cand: number[] = [];
  private changed: Building[] = [];

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
    this.resetPieces();
    this.lastSupply = 0;
    this.lastShortNotify = this.lastWaterNotify = this.lastBlackoutNotify = this.lastCutNews = -1e9;
    this.wasShort = this.wasWaterShort = false;
    this.loadById.fill(-1);
    this.producers.clear();
    this.useInfo.length = 0;
    this.rememberCoolingWater(sim.state);
    // (flags a loaded / new city's first pass flips are not news)
    this.cutQuiet = true;
    try { this.compute(sim); } finally { this.cutQuiet = false; }
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

  // ------------------------------------------------------------------------------------------------ B2 cost model
  /**
   * estimated warm wall ms of the next step (B2 §9: the next piece's own work counts x the UT coefficients, with the
   * piece's own chunk sizes). Pure and O(1): reads the cursors and sizes, never runs a loop, never sets anything up.
   */
  stepCost(sim: Simulation): number {
    return (UT_EST * (UT.piece + this.pieceUs(sim))) / 1000;
  }

  /** µs of the next piece (stepCost) */
  private pieceUs(sim: Simulation): number {
    const st = sim.state, C = st.cells;
    const snap = this.snap, k = this.cur, last = k + 1 >= snap.chunks;
    const cells = (size: number, us: number) => Math.max(0, Math.min(cellUnits(size), C - k)) * us;
    if (this.stepIdx < 0) return UT.start;
    switch (this.sub) {
      case S_START: return UT.start;
      case S_SNAP: return st.buildings.size * UT.snapTake;
      case S_PLAN: return Math.max(0, Math.min(pieceUnits(US.plan, 1, COLD), snap.n - snap.planned)) * UT.plan;
      case S_SEA: return C * UT.sea;
      case S_SCAN: return Math.max(0, Math.min(pieceUnits(UT_SCAN_SIZING, 1, COLD), snap.n - k)) * UT.scan;
      case S_USES:
        return snap.countOf(k) * UT.usesB + snap.cellsOf(k) * UT.usesF
          + (last ? UT.usesPub + (this.passFull ? 0 : (this.passAdded.length + this.passRemoved.length) * UT.patch) : 0);
      case S_PLABEL: case S_WLABEL:
        return Math.max(0, Math.min(pieceUnits(US.label, 1, COLD), 2 * (C - this.lS) + 1)) * UT.label + UT.labelPub;
      case S_PSUM:
        return snap.countOf(k) * UT.sumB + snap.cellsOf(k) * UT.sumF
          + (last ? UT.sumPub + this.nPComp * UT.sumComp + this.nPlants * UT.sumPlant + this.nCrit * UT.sumCrit : 0);
      case S_PCELLS: case S_BCELLS: case S_WCELLS: case S_WBCELLS: return cells(US.cells, UT.cells);
      case S_PBLD: return snap.countOf(k) * UT.resB + snap.cellsOf(k) * UT.resF;
      case S_WBLD: return snap.countOf(k) * UT.wresB + snap.cellsOf(k) * UT.wresF;
      case S_PZONED: case S_WZONED: return cells(US.zoned, UT.zoned) + (C - k <= cellUnits(US.zoned) ? C * UT.copy : 0);
      case S_BSEED: return 2 + this.nPlants * 9 * UT.seed;
      // (the queue grows while a BFS piece runs: its estimate is the piece's full size)
      case S_BBFS: return pieceUnits(US.bfs, 1, COLD) * UT.bfs;
      case S_WSUM:
        return snap.countOf(k) * UT.wsumB + snap.cellsOf(k) * UT.wsumF + (last ? UT.wsumPub + this.nWComp * UT.wsumComp : 0);
      case S_WBSEED: return 8 + this.nWSeeds * UT.wseed;
      case S_WBBFS: return pieceUnits(US.wbfs, 1, COLD) * UT.wbfs;
      case S_FBLD: return snap.countOf(k) * UT.finB + snap.cellsOf(k) * UT.finF;
      case S_FAPPLY: return 6 + this.cand.length * UT.apply;
      default: {
        const left = this.changed.length - k, n = pieceUnits(US.event, 1, COLD);
        return Math.max(0, Math.min(n, left)) * UT.event + (left <= n ? UT.end : 0);
      }
    }
  }

  /** B2: the name of the next piece ('power.sum#3'), for the step tools (b2work cpumap / profile labels) */
  get stepName(): string {
    if (this.stepIdx < 0) return 'uses.start';
    const s = this.sub;
    return STATE_NAMES[this.stepIdx] + '.' + SUB_NAMES[s] + (CHUNKED.has(s) ? '#' + this.cur : '');
  }

  /**
   * one step (B2: one piece) of a (full or soft) refresh pass. The state ids and transitions are the pre-B2 ones; a state
   * stays current until its last piece is done. A pass whose pieces run with nothing in between computes exactly what the
   * pre-B2 steps computed.
   */
  step(sim: Simulation): void {
    const t0 = nowMs();
    const st = sim.state;
    if (this.stepIdx < 0) {
      // (B2 review 1 O8: an explicit pass start, every cursor reset; a direct stepIdx = -1 or compute() starts clean)
      this.resetPieces();
      this.stepIdx = U_USES;
      this.passFull = this.dirtyFull || st.day - this.lastFull >= UTIL_FULL_DAYS || this.pComp.length !== st.cells;
    }
    // (R4: buildings may appear between the pieces of a pass; the per-id arrays cover every id, as pre-B2's steps)
    if (this.sub !== S_START) this.ensureIds(st);
    switch (this.sub) {
      case S_START: this.usesStart(st); this.sub = S_SNAP; break;
      case S_SNAP:
        this.snap.take(st);
        // (pre-B2 read it in the uses step's prologue: a pure function of the buildings; here after the snapshot, so the
        // day's first buildingList rebuild falls in this piece, whose estimate counts it)
        this.jobsUnknown = detectJobsUnknown(st);
        // (one chunk plan for every building stage of the pass; each stage's estimate uses its own coefficients)
        this.snap.planBegin(UT_PLAN_B, UT_PLAN_F, pieceBudgetUs(COLD));
        this.sub = S_PLAN;
        break;
      case S_PLAN:
        if (this.snap.planRun(pieceUnits(US.plan, 1, COLD))) this.sub = S_SEA;
        break;
      case S_SEA:
        // (pre-B2 took the sea mask at the first working water producer of the uses loop: a pure function of the water grid,
        // cached and checksummed by terrainMasks, so taking it before the loop changes nothing)
        this.seaM = seaMask(st);
        this.sub = S_SCAN;
        this.cur = 0;
        break;
      case S_SCAN: this.scanPiece(st); break;
      case S_USES: this.usesPiece(st); break;
      case S_PLABEL: this.powerLabelPiece(st); break;
      case S_WLABEL: this.waterLabelPiece(st); break;
      case S_PSUM: this.powerSumPiece(st); break;
      case S_PCELLS: this.cellsPiece(st, this.poweredNext, this.pComp, this.okComp, S_PBLD); break;
      case S_PBLD: this.powerResultsPiece(st); break;
      case S_PZONED: this.powerZonedPiece(st); break;
      case S_BCELLS: this.cellsPiece(st, this.poweredNext, this.pComp, this.okComp, S_BSEED); break;
      case S_BSEED: this.brownSeeds(st); break;
      case S_BBFS: this.brownBfsPiece(st); break;
      case S_WSUM: this.waterSumPiece(st); break;
      case S_WCELLS: this.cellsPiece(st, this.wateredNext, this.wComp, this.okW, S_WBLD); break;
      case S_WBLD: this.waterResultsPiece(st); break;
      case S_WZONED: this.waterZonedPiece(st); break;
      case S_WBCELLS: this.cellsPiece(st, this.wateredNext, this.wComp, this.okW, S_WBSEED); break;
      case S_WBSEED: this.waterBrownSeeds(st); break;
      case S_WBBFS: this.waterBrownBfsPiece(st); break;
      case S_FBLD: this.finishPiece(st); break;
      case S_FAPPLY: this.applyFlags(); break;
      default: this.eventsPiece(sim); break;
    }
    this.lastMs = nowMs() - t0;
  }

  /** B2: every piece cursor back to its reset value; the pass's snapshot and lists are released (R9) */
  private resetPieces(): void {
    this.sub = S_START;
    this.cur = 0;
    this.snap.release();
    this.seaM = null;
    this.pollRef = null;
    this.nuclearLost = 0;
    this.nInfo = 0;
    this.hasTreatment = false;
    this.passAdded.length = 0;
    this.passRemoved.length = 0;
    this.producersNext.clear();
    this.lBegun = false;
    this.lS = 0;
    this.lNc = 0;
    this.lBusy = false;
    this.wlNext = S_PSUM;
    this.wChecked = false;
    this.supplyTot = 0;
    this.demandTot = 0;
    this.nSeeds = 0;
    this.brown = false;
    this.qh = 0;
    this.qt = 0;
    this.cand.length = 0;
    this.changed.length = 0;
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

  // ------------------------------------------------------------------------------------------ uses (U_USES)
  /**
   * The pass start: pre-B2's uses-step prologue (ensure, the ordinance effects, the jobs check, the plant efficiency and
   * prepareUses' per-pass values, computed once per pass) and the inputs consumed here (R5: the dirty flags and the
   * added / removed lists; events arriving later mark the next pass, as pre-B2 for an event between two steps).
   */
  private usesStart(st: CityState): void {
    this.ensure(st);
    const fx = readEffects(st);
    this.pMul = fx.powerDemand;
    this.wMul = fx.waterDemand;
    this.eff = plantEfficiency(st);
    this.nInfo = 0;
    this.hasTreatment = false;
    this.producersNext.clear();
    this.nuclearMul = Math.max(0, ordinanceEffect(st, 'power.nuclear'));
    this.nuclearLost = 0;
    this.pollRef = this.simRef?.getSystem<PollutionSystem>('pollution') ?? null;
    this.season = 0.5 * (SOLAR_WINTER + SOLAR_SUMMER) - 0.5 * (SOLAR_SUMMER - SOLAR_WINTER) * Math.cos((2 * Math.PI * ((st.day % 360) + 15)) / 360);
    this.climate = SOLAR_CLIMATE[st.config.climate] ?? 1;
    this.nPlants = 0;
    this.nCrit = 0;
    if (this.passFull) this.dirtyFull = false;
    // (the growables added / removed so far are this pass's label patch; later ones go to the next pass)
    const a = this.added;
    this.added = this.passAdded;
    this.passAdded = a;
    const r = this.removed;
    this.removed = this.passRemoved;
    this.passRemoved = r;
    this.soft = false;
  }

  /** one piece of the treatment prefix scan (pre-B2's first prepareUses loop, by building ranges of the snapshot: it
   *  reads a DefInfo and two fields per building, so its pieces hold UT_SCAN_SIZING-sized ranges; it stops at the first
   *  working treatment plant, `useInfo` keeps the prefix's DefInfo) */
  private scanPiece(st: CityState): void {
    const snap = this.snap, list = snap.list, infos = this.useInfo;
    const i1 = Math.min(snap.n, this.cur + pieceUnits(UT_SCAN_SIZING, 1, COLD));
    let done = false;
    let n = this.nInfo;
    for (let bI = this.cur; bI < i1; bI++) {
      const b = list[bI];
      const inf = infoOf(st, b);
      infos[n++] = inf;
      if (inf.isTreatment && b.built >= 1 && (b.flags & BF.Burnt) === 0) { this.hasTreatment = true; done = true; break; }
    }
    this.nInfo = n;
    this.cur = i1;
    if (i1 >= snap.n) done = true;
    if (!done) return;
    infos.length = this.nInfo;
    this.sub = S_USES;
    this.cur = 0;
  }

  /** one chunk of the uses loop (pre-B2 prepareUses' main loop: power use / plant output (bUse) and water use / producer
   *  output (bWUse)); the last chunk publishes (usesPublish) */
  private usesPiece(st: CityState): void {
    const snap = this.snap;
    if (this.cur < snap.chunks) this.usesChunk(st, this.cur++);
    if (this.cur >= snap.chunks) this.usesPublish(st);
  }

  private usesChunk(st: CityState, k: number): void {
    const eff = this.eff;
    const bUse = this.bUse, bWUse = this.bWUse;
    const list = this.snap.list;
    const infos = this.useInfo, nInfo = this.nInfo, hasTreatment = this.hasTreatment;
    const producers = this.producersNext;
    const nuclearMul = this.nuclearMul;
    let nuclearLost = this.nuclearLost;
    const pollution = this.pollRef;
    const sea = this.seaM!;
    const season = this.season, climate = this.climate;
    const pMul = this.pMul, wMul = this.wMul, jobsUnknown = this.jobsUnknown;
    let nPlants = this.nPlants, nCrit = this.nCrit;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
      const b = list[bI];
      const inf = bI < nInfo ? infos[bI] : infoOf(st, b);
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
    this.nuclearLost = nuclearLost;
  }

  /** the uses step's end: the producers (producerInfo, read by pollution and the inspector) by a swap, the nuclear news,
   *  the label patch of a soft pass, the next state (pre-B2's order) */
  private usesPublish(st: CityState): void {
    const p = this.producers;
    this.producers = this.producersNext;
    this.producersNext = p;
    if (this.nuclearLost > 0 && !this.nuclearOffAnnounced && this.simRef) {
      this.simRef.notify(`Nuclear plant shut down by ordinance (−${Math.round(this.nuclearLost).toLocaleString('en-US')} MW)`, 'warning', undefined, undefined, 'utilities');
    }
    this.nuclearOffAnnounced = this.nuclearMul < 0.5;
    let relabel = this.passFull;
    if (!this.passFull && !this.patchPower(st)) relabel = true; // a new building bridges two grids: relabel in the next step
    this.relabelPower = relabel;
    this.passAdded.length = 0;
    this.passRemoved.length = 0;
    this.cur = 0;
    if (relabel) { this.stepIdx = U_LABEL; this.sub = S_PLABEL; }
    else if (this.dirtyWater || this.wComp.length !== st.cells) { this.stepIdx = U_LABEL; this.sub = S_WLABEL; this.wlNext = S_PSUM; }
    else { this.stepIdx = U_POWER; this.sub = S_PSUM; }
  }

  // ------------------------------------------------------------------------------------------ power
  /**
   * one piece of the power label (pre-B2 labelPower: conductor components — network cells, power lines, building cells —
   * by BFS in cell order, in pieces of at most pieceUnits(US.label) cells scanned or dequeued) into pCompNext; the last
   * piece publishes (a swap: gridInfo never sees half labels), then the water label or the power sums follow
   */
  private powerLabelPiece(st: CityState): void {
    const N = st.size, C = st.cells;
    const net = st.network, lines = st.powerLines, bld = st.building;
    if (!this.lBegun) {
      if (this.pCompNext.length !== C) this.pCompNext = new Int32Array(C);
      this.pCompNext.fill(-1);
      this.lS = 0; this.lNc = 0; this.lBusy = false; this.qh = 0; this.qt = 0;
      this.lBegun = true;
    }
    const comp = this.pCompNext, queue = this.queue;
    let budget = pieceUnits(US.label, 1, COLD);
    let s = this.lS, nc = this.lNc, qh = this.qh, qt = this.qt, busy = this.lBusy;
    while (budget > 0) {
      if (busy) {
        while (qh < qt && budget > 0) {
          budget--;
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
        if (qh < qt) break;
        busy = false;
        nc++;
        s++;
        continue;
      }
      if (s >= C) break;
      budget--;
      if (comp[s] >= 0 || (net[s] === 0 && lines[s] === 0 && bld[s] < 0)) { s++; continue; }
      qh = 0; qt = 0;
      queue[qt++] = s;
      comp[s] = nc;
      busy = true;
    }
    this.lS = s; this.lNc = nc; this.qh = qh; this.qt = qt; this.lBusy = busy;
    if (busy || s < C) return;
    // the publish: labels, component count, the per-component arrays' growth, the full pass's day
    this.pCompNext = this.pComp;
    this.pComp = comp;
    this.nPComp = nc;
    if (nc > this.cSupply.length) this.growPower(nc);
    if (this.passFull) this.lastFull = st.day;
    this.lBegun = false;
    this.qh = this.qt = 0;
    if (this.dirtyWater || this.wComp.length !== st.cells) { this.sub = S_WLABEL; this.wlNext = S_PSUM; }
    else { this.stepIdx = U_POWER; this.sub = S_PSUM; this.cur = 0; }
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
    for (const b of this.passRemoved) {
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        if (bld[i] < 0 && net[i] === 0 && lines[i] === 0) comp[i] = -1;
      }
    }
    for (const b of this.passAdded) {
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
   * one chunk of the power sums (pre-B2 powerSums' building loop: per-component supply / demand, as doubles in list order,
   * into private buffers); the last chunk publishes (powerSumsPublish)
   */
  private powerSumPiece(st: CityState): void {
    const snap = this.snap;
    if (this.cur === 0) {
      const nc = this.nPComp;
      if (this.cSupplyN.length < this.cSupply.length) { this.cSupplyN = new Float64Array(this.cSupply.length); this.cDemandN = new Float64Array(this.cSupply.length); }
      this.cSupplyN.fill(0, 0, nc);
      this.cDemandN.fill(0, 0, nc);
      this.supplyTot = 0;
      this.demandTot = 0;
    }
    if (this.cur < snap.chunks) this.powerSumChunk(st, this.cur++);
    if (this.cur >= snap.chunks) this.powerSumsPublish(st);
  }

  private powerSumChunk(st: CityState, k: number): void {
    const N = st.size;
    const comp = this.pComp;
    const bUse = this.bUse;
    const cSupply = this.cSupplyN, cDemand = this.cDemandN;
    const list = this.snap.list;
    let supplyTot = this.supplyTot, demandTot = this.demandTot;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
      const b = list[bI];
      const c = comp[b.z * N + b.x];
      if (c < 0) continue;
      const u = bUse[b.id];
      if (u < 0) { cSupply[c] -= u; supplyTot -= u; }
      else { cDemand[c] += u; demandTot += u; }
    }
    this.supplyTot = supplyTot;
    this.demandTot = demandTot;
  }

  /**
   * The power sums' publish (pre-B2 powerSums after its building loop): the sums (gridInfo), plant loads (pollution
   * activity, WP2 plant stigma, inspector), stats. No short grid: the results follow (no brownout). A short grid:
   * critical loads (health, police, fire, water producers) reserve their share first and the distance-ordered BFS runs in
   * the brownout step.
   */
  private powerSumsPublish(st: CityState): void {
    const N = st.size;
    const comp = this.pComp;
    const nc = this.nPComp;
    const bUse = this.bUse;
    this.cSupply.set(this.cSupplyN.subarray(0, nc));
    this.cDemand.set(this.cDemandN.subarray(0, nc));
    const cSupply = this.cSupply, cDemand = this.cDemand, cLeft = this.cLeft;
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
    st.stats.powerSupply = this.supplyTot;
    st.stats.powerDemand = this.demandTot;
    const stampNo = (this.powerStamp = ++this.stamp);
    this.cur = 0;
    if (this.poweredNext.length !== st.cells) this.poweredNext = new Uint8Array(st.cells);
    if (!anyShort) {
      this.brown = false;
      this.sub = S_PCELLS;
      return;
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
    this.stepIdx = U_BROWN;
    this.sub = S_BCELLS;
  }

  /** a cell range of `out[i] = c >= 0 ? ok[c] : 0` (the results' first loop, the brownouts' first loop; out: private) */
  private cellsPiece(st: CityState, out: Uint8Array, comp: Int32Array, ok: Uint8Array, next: number): void {
    const C = st.cells;
    const i1 = Math.min(C, this.cur + cellUnits(US.cells));
    for (let i = this.cur; i < i1; i++) {
      const c = comp[i];
      out[i] = c >= 0 ? ok[c] : 0;
    }
    this.cur = i1;
    if (i1 < C) return;
    this.cur = 0;
    this.sub = next;
  }

  /** the power brownout's seeds (pre-B2 powerBrownout after its cell loop): the plants of short components, the
   *  exhausted flags */
  private brownSeeds(st: CityState): void {
    const N = st.size;
    const comp = this.pComp, queue = this.queue, visit = this.visit;
    const bUse = this.bUse, stampNo = this.powerStamp;
    const cSupply = this.cSupply, cDemand = this.cDemand;
    const nc = this.nPComp;
    let qt = 0;
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
    this.exhaustedP.fill(0, 0, nc);
    this.qh = 0;
    this.qt = qt;
    this.sub = S_BBFS;
  }

  /**
   * one piece of the power brownout BFS (pre-B2 powerBrownout's loop: from the plants of short components, consumers in
   * distance order; once the supply is exhausted every farther consumer loses power), at most pieceUnits(US.bfs) queue
   * cells; then the building results
   */
  private brownBfsPiece(st: CityState): void {
    const N = st.size, C = st.cells;
    const bld = st.building;
    const comp = this.pComp, queue = this.queue, visit = this.visit;
    const bUse = this.bUse, served = this.bOk, stampNo = this.powerStamp;
    const cLeft = this.cLeft;
    const powered = this.poweredNext;
    const exhausted = this.exhaustedP;
    let qh = this.qh, qt = this.qt;
    const q1 = qh + pieceUnits(US.bfs, 1, COLD);
    while (qh < qt && qh < q1) {
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
    this.qh = qh;
    this.qt = qt;
    if (qh < qt) return;
    this.qh = this.qt = 0;
    this.brown = true;
    this.sub = S_PBLD;
    this.cur = 0;
  }

  /** one chunk of the power building results (pre-B2 powerResults' building loop: bPow + footprint cells, into the
   *  private layer) */
  private powerResultsPiece(st: CityState): void {
    const snap = this.snap;
    if (this.cur < snap.chunks) this.powerResultsChunk(st, this.cur++);
    if (this.cur >= snap.chunks) { this.sub = S_PZONED; this.cur = 0; }
  }

  private powerResultsChunk(st: CityState, k: number): void {
    const N = st.size;
    const bld = st.building;
    const comp = this.pComp, powered = this.poweredNext;
    const cSupply = this.cSupply, cDemand = this.cDemand;
    const served = this.bOk, stampNo = this.powerStamp;
    const result = this.bPow;
    const list = this.snap.list;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
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
  }

  /** a cell range of the powered empty zoned cells (adjacent to a powered conductor; pre-B2 powerResults' last loop);
   *  the last piece publishes st.powered (one .set(): a saved layer) and the water step follows */
  private powerZonedPiece(st: CityState): void {
    const N = st.size, C = st.cells;
    const zone = st.zone;
    const comp = this.pComp, powered = this.poweredNext;
    const i1 = Math.min(C, this.cur + cellUnits(US.zoned));
    for (let i = this.cur; i < i1; i++) {
      if (zone[i] === 0 || comp[i] >= 0) continue;
      const x = i % N;
      powered[i] = (x > 0 && powered[i - 1] === 1 && comp[i - 1] >= 0) || (x < N - 1 && powered[i + 1] === 1 && comp[i + 1] >= 0) ||
        (i >= N && powered[i - N] === 1 && comp[i - N] >= 0) || (i + N < C && powered[i + N] === 1 && comp[i + N] >= 0) ? 1 : 0;
    }
    this.cur = i1;
    if (i1 < C) return;
    st.powered.set(powered.subarray(0, C));
    this.brown = false;
    this.stepIdx = U_WATER;
    this.sub = S_WSUM;
    this.cur = 0;
    this.wChecked = false;
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
  /**
   * one piece of the water label (pre-B2 labelWater: road-connected components — pipes run under every road — by BFS in
   * cell order) into wCompNext; its first piece consumes dirtyWater (R5), the last one publishes (a swap) and goes on to
   * `wlNext` (U_LABEL's power sums, or U_WATER's sums after a mid-pass relabel)
   */
  private waterLabelPiece(st: CityState): void {
    const N = st.size, C = st.cells;
    const net = st.network;
    if (!this.lBegun) {
      this.dirtyWater = false;
      if (this.wCompNext.length !== C) this.wCompNext = new Int32Array(C);
      this.wCompNext.fill(-1);
      this.lS = 0; this.lNc = 0; this.lBusy = false; this.qh = 0; this.qt = 0;
      this.lBegun = true;
    }
    const comp = this.wCompNext, queue = this.queue;
    let budget = pieceUnits(US.label, 1, COLD);
    let s = this.lS, nc = this.lNc, qh = this.qh, qt = this.qt, busy = this.lBusy;
    while (budget > 0) {
      if (busy) {
        while (qh < qt && budget > 0) {
          budget--;
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
        if (qh < qt) break;
        busy = false;
        nc++;
        s++;
        continue;
      }
      if (s >= C) break;
      budget--;
      if (comp[s] >= 0 || net[s] < 1 || net[s] > 5) { s++; continue; }
      qh = 0; qt = 0;
      queue[qt++] = s;
      comp[s] = nc;
      busy = true;
    }
    this.lS = s; this.lNc = nc; this.qh = qh; this.qt = qt; this.lBusy = busy;
    if (busy || s < C) return;
    this.wCompNext = this.wComp;
    this.wComp = comp;
    this.nWComp = nc;
    if (nc > this.wSupply.length) this.growWater(nc);
    this.lBegun = false;
    this.qh = this.qt = 0;
    this.cur = 0;
    if (this.wlNext === S_WSUM) this.sub = S_WSUM;
    else { this.stepIdx = U_POWER; this.sub = S_PSUM; }
  }

  /**
   * one chunk of the water sums (pre-B2 waterSums' building loop: per-network supply — pumps / treatment plants need
   * power — demand, intake pollution, the seeds, into private buffers); the first piece of U_WATER relabels the networks
   * first when a road edit landed mid-pass (pre-B2's check at the U_WATER step); the last chunk publishes
   */
  private waterSumPiece(st: CityState): void {
    if (!this.wChecked) {
      this.wChecked = true;
      // a road edit landed mid-pass: relabel the water networks before using them
      if (this.dirtyWater || this.wComp.length !== st.cells) {
        this.sub = S_WLABEL;
        this.wlNext = S_WSUM;
        this.waterLabelPiece(st);
        return;
      }
    }
    const snap = this.snap;
    if (this.cur === 0) {
      const nc = this.nWComp, L = this.wSupply.length;
      if (this.wSupplyN.length < L) { this.wSupplyN = new Float64Array(L); this.wDemandN = new Float64Array(L); }
      if (this.wPollN.length < nc) this.wPollN = new Float64Array(nc * 2 + 16);
      this.wSupplyN.fill(0, 0, nc);
      this.wDemandN.fill(0, 0, nc);
      this.wPollN.fill(0, 0, nc);
      if (this.bWCompN.length !== this.bWComp.length) this.bWCompN = new Int32Array(this.bWComp.length);
      this.bWCompN.set(this.bWComp);
      this.supplyTot = 0;
      this.demandTot = 0;
      this.nSeeds = 0;
    }
    if (this.cur < snap.chunks) this.waterSumChunk(st, this.cur++);
    if (this.cur >= snap.chunks) this.waterSumsPublish(st);
  }

  private waterSumChunk(st: CityState, k: number): void {
    const N = st.size;
    const comp = this.wComp;
    const wSupply = this.wSupplyN, wDemand = this.wDemandN, wPoll = this.wPollN;
    const bComp = this.bWCompN; // per-building component (+1), 0 = none
    const bUse = this.bWUse, bNeedPow = this.bNeedPow, bPow = this.bPow, intake = this.intakeById;
    const list = this.snap.list;
    let supplyTot = this.supplyTot, demandTot = this.demandTot, nSeeds = this.nSeeds;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
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
    this.supplyTot = supplyTot;
    this.demandTot = demandTot;
    this.nSeeds = nSeeds;
  }

  /**
   * The water sums' publish (pre-B2 waterSums after its building loop): sums, networks per building, intake pollution
   * (one .set() each: waterInfo / waterQualityAt never see half sums), stats, tap quality. No short network: the results
   * follow; a short network: the brownout step serves buildings in road distance order from the producers.
   */
  private waterSumsPublish(st: CityState): void {
    const nc = this.nWComp;
    if (this.wPoll.length < nc) { this.wPoll = new Float64Array(nc * 2 + 16); this.wQual = new Float32Array(nc * 2 + 16); }
    this.wPoll.set(this.wPollN.subarray(0, nc));
    this.wSupply.set(this.wSupplyN.subarray(0, nc));
    this.wDemand.set(this.wDemandN.subarray(0, nc));
    const L = Math.min(this.bWCompN.length, this.bWComp.length);
    this.bWComp.set(L === this.bWCompN.length ? this.bWCompN : this.bWCompN.subarray(0, L));
    this.nWSeeds = this.nSeeds;
    const wSupply = this.wSupply, wDemand = this.wDemand, wLeft = this.wLeft;
    const okW = this.okW.length >= nc ? this.okW : (this.okW = new Uint8Array(nc * 2 + 16));
    let anyShort = false;
    for (let c = 0; c < nc; c++) {
      wLeft[c] = wSupply[c];
      const sup = wSupply[c] > 0;
      okW[c] = sup && wDemand[c] <= wSupply[c] ? 1 : 0;
      if (sup && wDemand[c] > wSupply[c]) anyShort = true;
    }
    st.stats.waterSupply = this.supplyTot;
    st.stats.waterDemand = this.demandTot;
    this.waterStamp = ++this.stamp;
    this.tapQuality(st);
    this.cur = 0;
    if (this.wateredNext.length !== st.cells) this.wateredNext = new Uint8Array(st.cells);
    if (!anyShort) { this.brown = false; this.sub = S_WCELLS; }
    else { this.stepIdx = U_WATER_BROWN; this.sub = S_WBCELLS; }
  }

  /** the water brownout's seeds (pre-B2 waterBrownout after its cell loop): the exhausted flags, the road cells around
   *  the delivering producers of short networks (seed order) */
  private waterBrownSeeds(st: CityState): void {
    const comp = this.wComp, queue = this.queue, visit = this.visit;
    const nc = this.nWComp;
    const bComp = this.bWComp, stamp = this.waterStamp;
    const wSupply = this.wSupply, wDemand = this.wDemand;
    if (this.exhaustedW.length < nc) this.exhaustedW = new Uint8Array(nc * 2 + 16);
    this.exhaustedW.fill(0, 0, nc);
    let qt = 0;
    const seeds = this.wSeedIds;
    for (let q = 0; q < this.nWSeeds; q++) {
      const id = seeds[q];
      const b = st.buildings.get(id);
      if (!b) continue;
      const c = bComp[id] - 1;
      if (c < 0 || !(wDemand[c] > wSupply[c])) continue;
      for (const i of perimeterRoadCells(st, comp, b)) if (visit[i] !== stamp) { visit[i] = stamp; queue[qt++] = i; }
    }
    this.qh = 0;
    this.qt = qt;
    this.sub = S_WBBFS;
  }

  /** one piece of the water brownout BFS (pre-B2 waterBrownout's loop: over the pipes from the producers, nearest
   *  buildings first), at most pieceUnits(US.wbfs) queue cells; then the building results */
  private waterBrownBfsPiece(st: CityState): void {
    const N = st.size, C = st.cells;
    const bld = st.building;
    const comp = this.wComp, queue = this.queue, visit = this.visit;
    const watered = this.wateredNext;
    const bComp = this.bWComp, bUse = this.bWUse, served = this.bOk, stamp = this.waterStamp;
    const wLeft = this.wLeft;
    const exhausted = this.exhaustedW;
    let qh = this.qh, qt = this.qt;
    const q1 = qh + pieceUnits(US.wbfs, 1, COLD);
    while (qh < qt && qh < q1) {
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
    this.qh = qh;
    this.qt = qt;
    if (qh < qt) return;
    this.qh = this.qt = 0;
    this.brown = true;
    this.sub = S_WBLD;
    this.cur = 0;
  }

  /** one chunk of the water building results (pre-B2 waterResults' building loop: bWat + footprint cells, into the
   *  private layer) */
  private waterResultsPiece(st: CityState): void {
    const snap = this.snap;
    if (this.cur < snap.chunks) this.waterResultsChunk(st, this.cur++);
    if (this.cur >= snap.chunks) { this.sub = S_WZONED; this.cur = 0; }
  }

  private waterResultsChunk(st: CityState, k: number): void {
    const N = st.size;
    const bld = st.building;
    const watered = this.wateredNext;
    const bComp = this.bWComp, served = this.bOk, stamp = this.waterStamp;
    const wSupply = this.wSupply, wDemand = this.wDemand;
    const result = this.bWat;
    const list = this.snap.list;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
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
  }

  /** a cell range of the watered empty zoned cells (within 1 cell of a watered road; pre-B2 waterResults' last loop); the
   *  last piece publishes st.watered (one .set(): a saved layer) and the finish follows */
  private waterZonedPiece(st: CityState): void {
    const N = st.size, C = st.cells;
    const zone = st.zone, bld = st.building;
    const comp = this.wComp, watered = this.wateredNext;
    const i1 = Math.min(C, this.cur + cellUnits(US.zoned));
    for (let i = this.cur; i < i1; i++) {
      if (zone[i] === 0 || bld[i] >= 0 || comp[i] >= 0) continue;
      const x = i % N;
      watered[i] = (x > 0 && comp[i - 1] >= 0 && watered[i - 1] === 1) || (x < N - 1 && comp[i + 1] >= 0 && watered[i + 1] === 1) ||
        (i >= N && comp[i - N] >= 0 && watered[i - N] === 1) || (i + N < C && comp[i + N] >= 0 && watered[i + N] === 1) ? 1 : 0;
    }
    this.cur = i1;
    if (i1 < C) return;
    st.watered.set(watered.subarray(0, C));
    this.brown = false;
    this.sub = S_FBLD;
    this.cur = 0;
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

  // ------------------------------------------------------------------------------------------ finish (flags, news)
  /**
   * one chunk of the finish (pre-B2 finish's building loop, without writing the flags): the buildings whose Powered /
   * Watered bits flip (candidates, applied in one piece: R7 / R9), the cooling-water result, the cut tally (list order:
   * `cut.at` = the first largest building)
   */
  private finishPiece(st: CityState): void {
    const snap = this.snap;
    if (this.cur === 0) {
      const cut = this.cut;
      cut.pN = cut.pRes = cut.pJobs = cut.wN = cut.wRes = cut.wJobs = 0;
      cut.at = null;
      cut.atPeople = 0;
      cut.pPlant = false;
      this.cand.length = 0;
    }
    if (this.cur < snap.chunks) this.finishChunk(st, this.cur++);
    if (this.cur >= snap.chunks) { this.sub = S_FAPPLY; this.cur = 0; }
  }

  private finishChunk(st: CityState, k: number): void {
    const bPow = this.bPow, bWat = this.bWat;
    const watSeen = this.watSeen;
    const list = this.snap.list, cand = this.cand;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
      const b = list[bI];
      const wasP = (b.flags & BF.Powered) !== 0, wasW = (b.flags & BF.Watered) !== 0;
      const onP = bPow[b.id] === 1, onW = bWat[b.id] === 1;
      // (pre-B2: f1 / f2 = setFlagQuiet(...) flipped the bit)
      const f1 = wasP !== onP, f2 = wasW !== onW;
      watSeen[b.id] = onW ? 1 : 2;
      if (f1 || f2) {
        cand.push(bI * 4 + (onP ? 1 : 0) + (onW ? 2 : 0));
        if ((wasP && f1) || (wasW && f2)) this.tallyCut(st, b, wasP && f1, wasW && f2);
      }
    }
  }

  /** the flags' publish: every candidate's Powered / Watered bits in snapshot order (pre-B2's changed list), in one piece */
  private applyFlags(): void {
    const list = this.snap.list, cand = this.cand, changed = this.changed;
    changed.length = 0;
    for (let k = 0; k < cand.length; k++) {
      const q = cand[k];
      const b = list[q >> 2];
      const f1 = setFlagQuiet(b, BF.Powered, (q & 1) !== 0);
      const f2 = setFlagQuiet(b, BF.Watered, (q & 2) !== 0);
      if (f1 || f2) changed.push(b);
    }
    this.sub = S_FEV;
    this.cur = 0;
  }

  /** the events in batches (after the flags they announce); the last piece: news, layerUpdated, the pass end */
  private eventsPiece(sim: Simulation): void {
    const st = sim.state, changed = this.changed;
    const k1 = Math.min(changed.length, this.cur + pieceUnits(US.event, 1, COLD));
    for (let k = this.cur; k < k1; k++) {
      const b = changed[k];
      // (R4: a snapshot building removed since gets no event; in an uninterrupted pass every one is live)
      if (st.buildings.get(b.id) === b) sim.events.emit('buildingChanged', b);
    }
    this.cur = k1;
    if (k1 < changed.length) return;
    this.finishNews(sim);
    this.stepIdx = -1;
    this.lastServe = st.day;
    this.resetPieces();
  }

  /** pre-B2 finish after the flags and events: the cut, shortage and blackout news, layerUpdated */
  private finishNews(sim: Simulation): void {
    const st = sim.state;
    this.cutNews(sim);
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

  /**
   * occupied buildings this pass cut off because their grid / pipe network lost every producer (a bulldozed road,
   * power line, plant or pump; not the brownout's deliberate farthest-first cut, whose grid still has supply):
   * counts for the "Power cut" / "Water cut" news (final fixes N1)
   */
  private cut = { pN: 0, pRes: 0, pJobs: 0, wN: 0, wRes: 0, wJobs: 0, at: null as Building | null, atPeople: 0, pPlant: false };
  private tallyCut(st: CityState, b: Building, lostPower: boolean, lostWater: boolean): void {
    if (this.cutQuiet || !(b.pop > 0 || b.jobs > 0) || (b.flags & (BF.Abandoned | BF.Burnt)) !== 0) return;
    const N = st.size, cut = this.cut;
    let counted = false;
    const s = st.stats;
    if (lostPower && !(infoOf(st, b).powerOut > 0)) {
      const c = this.pComp[b.z * N + b.x];
      const none = c < 0 || c >= this.nPComp || !(this.cSupply[c] > 0);
      // a grid split off with too little supply of its own while the city as a whole has enough: also an edit's cut
      const split = !none && this.cDemand[c] > this.cSupply[c] && s.powerSupply >= s.powerDemand;
      if (none || split) {
        cut.pN++; cut.pRes += b.pop; cut.pJobs += b.jobs;
        counted = true;
        // a plant stands on the dark grid but produces nothing (ordinance, idle incinerator ...): say so, not "reconnect"
        if (none && !cut.pPlant && c >= 0) for (let q = 0; q < this.nPlants; q++) {
          const p = st.buildings.get(this.plantIds[q]);
          if (p && this.pComp[p.z * N + p.x] === c) { cut.pPlant = true; break; }
        }
      }
    }
    if (lostWater && needsWater(st, b)) {
      const c = this.bWComp[b.id] - 1;
      const none = c < 0 || c >= this.nWComp || !(this.wSupply[c] > 0);
      const split = !none && this.wDemand[c] > this.wSupply[c] && s.waterSupply >= s.waterDemand;
      if (none || split) {
        cut.wN++; cut.wRes += b.pop; cut.wJobs += b.jobs;
        counted = true;
      }
    }
    if (counted && b.pop + b.jobs > cut.atPeople) { cut.at = b; cut.atPeople = b.pop + b.jobs; }
  }

  /** "Power cut" / "Water cut" news right after the pass that cut occupied buildings off (location: the biggest one) */
  private cutNews(sim: Simulation): void {
    const st = sim.state, c = this.cut;
    if ((c.pN === 0 && c.wN === 0) || !c.at || st.day - this.lastCutNews < UTIL_CUT_NEWS_DAYS) return;
    // (a city-wide blackout has its own news)
    if (c.pN > 0 && c.wN === 0 && st.stats.powerSupply <= 0) return;
    this.lastCutNews = st.day;
    const n = (v: number) => Math.round(v).toLocaleString('en-US');
    const who = (k: number, res: number, jobs: number) => {
      const p = [res > 0 ? `${n(res)} resident${Math.round(res) === 1 ? '' : 's'}` : '', jobs > 0 ? `${n(jobs)} job${Math.round(jobs) === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
      return `${n(k)} building${k === 1 ? '' : 's'}${p ? ` (${p})` : ''}`;
    };
    const x = c.at.x + (c.at.w >> 1), z = c.at.z + (c.at.d >> 1);
    let text: string;
    if (c.pN > 0 && c.wN > 0) {
      text = c.pN === c.wN
        ? `Power and water cut: ${who(c.pN, c.pRes, c.pJobs)} lost power and water — reconnect ${c.pN === 1 ? 'it' : 'them'} to the grid and to the pipes under the roads (Power and Water data views).`
        : `Power and water cut: ${who(c.pN, c.pRes, c.pJobs)} lost power and ${who(c.wN, c.wRes, c.wJobs)} lost water — reconnect them to the grid and to the pipes under the roads (Power and Water data views).`;
    } else if (c.pN > 0) {
      text = c.pPlant
        ? `Power cut: ${who(c.pN, c.pRes, c.pJobs)} lost power — the plant on ${c.pN === 1 ? 'its' : 'their'} grid produces nothing (click it to see why; Power data view).`
        : `Power cut: ${who(c.pN, c.pRes, c.pJobs)} lost power — reconnect ${c.pN === 1 ? 'it' : 'them'} to the grid with a road or power line (Power data view).`;
    } else {
      text = `Water cut: ${who(c.wN, c.wRes, c.wJobs)} lost water — connect ${c.wN === 1 ? 'its road' : 'their roads'} to a road with a working water pump; pipes run under roads (Water data view).`;
    }
    sim.notify(text, 'warning', x, z, 'utilities');
  }
}

/** a building needs piped water: a growable from stage WATER_REQUIRED_STAGE or on a medium / high density zone (the
 *  rule growth and population apply), a plopped one when its def uses water */
function needsWater(st: CityState, b: Building): boolean {
  const def = getDef(b.def);
  if (!def) return false;
  if (def.category !== 'growable') return (def.waterUse ?? 0) > 0;
  return (def.stage ?? 1) >= WATER_REQUIRED_STAGE || zoneDensity(st.zone[b.z * st.size + b.x]) >= 2;
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
