/**
 * Services system: service coverage via the WP2 catchment tier engine (infra/catchments.ts), transit coverage, the
 * access fields and the NIMBY / YIMBY rasters. Headless: no DOM / three.js.
 *
 * Layers written (0..1 unless noted):
 *   tiers        policeCov, fireCov (capacity-free), eduElemCov, eduHighCov, eduCollegeCov (college + library /
 *                museum / research), healthCov (clinic + hospital), playCov, greenCov
 *   legacy       parkCov = 1 - (1 - play)(1 - green); eduCov = clamp(.45 elem + .35 high + .20 college) (no longer
 *                saturates); transitCov (def coverage of stops / depots + walking radius around bus-stop road cells)
 *   access       accessCommute (minutes, every cell; R footprints keep st.commute), shopAccess
 *   NIMBY        stigma, prestige, campus (infra/nimby.ts)
 *   stats        stats.needs[tier] = { need, served, capacity, unreached, overcrowded }
 *
 * Tier engine (per need tier; facilities of the tier in DefInfo.tier / catalog coverage.tier):
 *   reach(f)   walk / drive road-network kernels or a Euclidean disk (catchments.reachRaw), radius x 1.3 road cells,
 *              falloff w: full to 35 % R, smoothstep to 0 at R. a_fi = w_fi x strength_f = the share of a cell's
 *              need that can use f.
 *   op_f       funding factor x ordinance (edu / health / police effect; police x justiceFactors().policeMul) x
 *              (def uses power & unpowered ? UNPOWERED_SERVICE_EFF : 1) x (health & uses water & dry ?
 *              UNWATERED_HEALTH_EFF : 1) x facilityOpFactor (WP7 staffing) = the quality of the service.
 *   shared tiers (capacity: schools, health, parks) — sequential seat filling. Every cell keeps an unseated share u_i
 *              (1 at the start). Facilities take seats best first (op_f descending, then building id):
 *                e_fi = min(u_i, a_fi)  (claim),  D_f = sum_i need_i e_fi,  sigma_f = min(1, S_f / D_f)
 *                u_i -= e_fi sigma_f,  cov_i += e_fi sigma_f op_f
 *              -> seats are conserved (f seats sigma_f D_f <= S_f; served = sum need x cov <= sum S x op); one school
 *              uncrowded = strength x op (legacy), 1,500 seats for 3,000 kids = 0.5, two overlapping schools = 1.0.
 *              MONOTONE: building a facility (or raising a facility's capacity, or its op while the seat order stays)
 *              never lowers any cell's coverage — later claims only shrink where earlier facilities seated people,
 *              and better-run facilities go first, so an unpowered school next to a working one only takes its
 *              overflow and a clinic inside a hospital catchment only adds seats (the proportional split this
 *              replaces could lower coverage there). Proof sketch: seated shares only grow when a facility is added
 *              (min(u, a) sigma is monotone in u and sigma), and cov = sum over the seat order of seated x op with op
 *              non-increasing (Abel summation).
 *              facilityLoad: seated = sigma_f D_f; demand = seated + (crowded facilities) the need left unseated in
 *              its reach, by reach share a_fi / sum_g a_gi; utilization = demand / S_f.
 *   union tiers (police, fire; transit) — legacy: cov = 1 - prod(1 - min(1, w s r_f)), r_f = op_f min(1, S / D_f)
 *              with D_f = sum need w (S = Infinity unless a def / WP7 provider gives one).
 *   need rasters from the residents' cohort shares (economy/demographics cohortShares; reference mix until WP1):
 *              elementary kids, high teens, college yad x COLLEGE_WILL[w] + .05 adults, health patient-equivalents
 *              (.6k + .5t + .5y + .9a + 3.5s) / 1.183, play kids + .7 teens, green pop (.8 + 1.2 seniors) / .98,
 *              police / fire residents.
 *   Reach cache: a facility's reach depends only on the road network and its footprint, so reaches are kept per slot
 *              between passes and reused unless a networkChanged rect touches the reach's bounding box (+2), the
 *              network hash changed without events (direct edits), or the facility moved / changed def. Results are
 *              identical to a fresh search (deterministic, save / load safe).
 * EQ / HQ belong to WP1 (population system, from the education stock b.edu). While no residential building carries
 * b.edu yet (WP1 not active, or infra-only simulations), the legacy lag runs here as a fallback:
 *   EQ -> 25 + 125 x (1 - (1-elem)(1-high)(1-college)) at homes (EQ_TAU_YEARS), HQ -> (30 + 120 health)(1 - .35 air).
 *
 * SCHEDULING (InfraScheduler): a pass every SERVICES_PERIOD days (within SERVICES_DIRTY_DAYS after a service /
 * NIMBY building change, power flip or road change). Funding, ordinances, strikes, health water, staffing and justice
 * changes are urgent; live mode starts at most one pass per SERVICES_MIN_PASS_MS (ongoing passes keep running):
 *   prep (need rasters, facility lists, op factors) -> tiers police .. green + transit (reach (cached / searched), seat
 *   allocation in seat order, crowded-facility demand, finalize) -> transit stops -> NIMBY (every 2nd pass unless a
 *   NIMBY source building or a highway / rail cell changed) -> access commute (seeds, search, land; every ACCESS_PERIOD
 *   days or after a network change) -> access shops (search, land) -> footprints (uniform coverage over large buildings;
 *   layers of empty slots skipped) -> finish (legacy combos, stats.needs, EQ / HQ fallback). Unserved clusters are
 *   computed on demand. Emits layerUpdated('services') and layerUpdated('catchments').
 *
 * B2 (docs/dev/B2_DESIGN.md §4): every state's work is a sequence of PIECES, one per scheduler step, each of about
 * INFRA_PIECE_MS (the tier engine) or half INFRA_PIECE_COLD_MS (every other loop: they run once per pass, so they run
 * cold for many passes) estimated warm ms; the state ids and transitions are the pre-B2 ones. A pass whose pieces run
 * with nothing in between (compute(), init, the scheduler's flush) computes bit-identical results to the pre-B2 steps:
 * the loop bodies are the pre-B2 ones, loop-carried locals are fields of the same type, one building snapshot serves the
 * whole pass (R4), and every external output changes in one piece per state (R7, audit below).
 */
import type { Building, CityState, NeedStat, NeedTier } from '../CityState';
import { BF } from '../CityState';
import type { ServiceKind } from '../catalogTypes';
import type { SimSystem, Simulation } from '../Simulation';
import type { CellRect } from '../../core/events';
import { DevType, Network } from '../../core/types';
import {
  BuildingSnapshot, COV_KINDS, Fam, REACH_METRICS, SERVICE_TIERS, ensureIdFloat, fundingFactor, infoOf, isFunctional, jobSlots,
  nowMs, readEffects, wealthOf, type DefInfo, type OrdEffects,
} from './common';
import {
  ACCESS_JOB_EXTRA, ACCESS_JOB_SLOTS, ACCESS_LAND_STEP, ACCESS_PERIOD, ACCESS_UNREACHED, CAR_OVERHEAD, CATCH_COLLEGE_WILL,
  CLUSTER_BLOCK, CLUSTER_COV, COLLEGE_ADULT_W, EDU_LEGACY_W, EQ_TAU_YEARS, GREEN_NEED_BASE, GREEN_NEED_NORM,
  GREEN_NEED_SENIOR, HEALTH_NEED_NORM, HEALTH_NEED_W, HQ_TAU_YEARS, INFRA_BLD_SIZING_US, INFRA_CELL_SIZING_US, INFRA_PIECE_COLD_MS, INFRA_PIECE_MS,
  MAX_COMMUTE, NET_TIME,
  OVERCROWDED_UTIL, PLAY_TEEN_W, RAMP_PENALTY, RES_PER_CS_JOB, ROAD_RADIUS_FACTOR, SHOP_BASE, SHOP_CAP_CELLS, SHOP_FAR, SHOP_NEAR,
  UNPOWERED_SERVICE_EFF, UNWATERED_HEALTH_EFF,
} from './params';
import { pieceBudgetUs, pieceUnits, schedulerOf } from './scheduler';
import { StopCollector, stopServes, transitCoverageActive, transitCoverageRange, type StopList } from './transit';
import { getDef } from '../catalog';
import {
  NEED_ORDER, ReachRun, RoadDistRun, RoadTimeRun, TIER_NEED, TIME_Q, tierLayer, tierProvider, type FacilityLoad,
  type TierNeedRun,
} from './catchments';
import { NimbyRun } from './nimby';
import { cohortShares } from '../economy/demographics';
import { justiceFactors } from './justice';
import { facilityOpFactor } from './facilities';
import type { TrafficSystem } from './traffic';

export const SERVICES_PERIOD = 15;
/** a new / removed service building or road change is reflected within this many days */
export const SERVICES_DIRTY_DAYS = 2;
/** live mode only: minimum real ms between pass starts, like traffic's cycle cap */
export const SERVICES_MIN_PASS_MS = 1000;
/** absolute change in facilityOpFactor since the last captured value; smaller drift waits for the periodic pass */
export const SERVICES_STAFF_DELTA = 0.05;
/**
 * work units: per cell reached by a fresh search, per cached reach entry copied, per entry allocated / splatted, per
 * entry of a crowded facility's demand report. B2 (design §4 S_TIERS a): re-weighted so that every kind of tier item
 * costs about SC.tierUnit warm µs per unit (pre-B2: U_SEARCH 3.6, the report 0.25 per entry + 8, the init 0.1 per cell)
 */
const U_SEARCH = 1.75, U_COPY = 0.1, U_ENTRY = 0.25, U_REPORT = 0.45;
/**
 * B2 (G2): tier work units of a fresh reach's pieces: per Dial queue entry taken (a road reach), per disk cell visited (a
 * disk), and per reached cell of the pool copy that ends it. dense1m's 2,428 facilities: 0.389 queue entries per reached
 * cell (so 4.5 per entry = U_SEARCH per reached cell, the pre-B2 count), 0.100 warm µs per entry (4.1 units) and 0.035 µs
 * per disk cell (1.4 units). Sizes only: where a piece ends moves no result.
 */
const U_REACH_POP = 4.5, U_REACH_DISK = 1.4, U_REACH_COPY = 0.1;
/** tier work units per cell: a slot's init fills (A, cov, seat), an empty slot's layer fill, the final clamp / stats / publish */
const U_INIT = 0.035, U_EMPTY = 0.0175, U_CLAMP = 0.11, U_STATS = 0.11, U_PUBLISH = 0.02;
/** tier work units per footprint cell of the per-tier footprint max (two passes over each lot) */
const FOOT_WORK = 0.22;
const KIND_SERVICE: Record<string, ServiceKind> = {
  police: 'police', fire: 'fire', health: 'health', education: 'education', park: 'parks', transit: 'transit', garbage: 'utilities',
};

/** engine slots: 0..7 = NEED_ORDER need tiers, 8 = transit coverage (union, no need) */
const NT = NEED_ORDER.length;
const SLOT_TRANSIT = NT;
const SLOT_HEALTH = NEED_ORDER.indexOf('health');
/** engine slot of each SERVICE_TIERS index */
const SLOT_OF_TIER: readonly number[] = SERVICE_TIERS.map((t) => NEED_ORDER.indexOf(TIER_NEED[t]));
/** need raster of each engine slot: 0 res, 1 kids, 2 teens, 3 college, 4 health, 5 play, 6 green */
const NEED_RASTER: readonly number[] = [0, 0, 1, 2, 3, 4, 5, 6];
const N_RASTERS = 7;

// steps
const S_PREP = 0, S_TIERS = 1, S_STOPS = 2, S_NIMBY = 3, S_ACC_SEED = 4, S_ACC_SEARCH = 5, S_ACC_LAND = 6, S_SHOP_A = 7,
  S_SHOP_B = 8, S_FOOT = 9, S_FINISH = 10;
// tier phases (shared tiers: init -> search -> alloc (in seat order) -> report -> final; union: init -> search -> final)
const P_INIT = 0, P_SEARCH = 1, P_ALLOC = 2, P_REPORT = 3, P_FINAL = 4;
// B2 sub-states. prep: the hashes (the first piece consumes the pass inputs), setup, the need fills, the attachment
// refresh, the snapshot, its chunk plan, the building chunks, the provider need rasters, the road count, the publish, the
// work estimate
const PR_CORRIDOR = 0, PR_NETHASH = 1, PR_WATERHASH = 2, PR_SETUP = 3, PR_FILLS = 4, PR_ATTACH = 5, PR_SNAP = 6, PR_PLAN = 7,
  PR_BLD = 8, PR_PROV = 9, PR_ROADS = 10, PR_PUBLISH = 11, PR_WORK = 12;
// the final items of a tier slot: clamp (rows), stats (rows), capacity / overcrowded, footprint max (lots), publish
const F_CLAMP = 0, F_STATS = 1, F_CAP = 2, F_FOOT = 3, F_PUBLISH = 4;
// stops: collector over the snapshot, over the cells, the attachment refresh, the disk setup, the disks, the compose, publish
const ST_COLLECT_B = 0, ST_COLLECT_C = 1, ST_ATTACH = 2, ST_BEGIN = 3, ST_DISKS = 4, ST_COMPOSE = 5, ST_PUBLISH = 6;
// access land / shop land: init rows, chamfer forward rows, backward rows, output rows, (access: home footprints) publish
const AL_INIT = 0, AL_FWD = 1, AL_BWD = 2, AL_OUT = 3, AL_HOMES = 4, AL_PUBLISH = 5;
const SB_INIT = 0, SB_FWD = 1, SB_BWD = 2, SB_POP = 3, SB_CS = 4, SB_BOX = 5, SB_OUT = 6, SB_PUBLISH = 7;
// finish: the legacy combos (rows), their publish, the per-tier stats (rows), stats.needs, the stale records (ids), the EQ /
// HQ fallback (buildings), the end
const FI_COMBO = 0, FI_COMBO_PUB = 1, FI_TIERS = 2, FI_NEEDS = 3, FI_STALE = 4, FI_EQHQ = 5, FI_END = 6;

/**
 * B2 piece budgets (design R2, review 2 item 1). Every services loop but the tier items runs once per pass (the NIMBY
 * rebuild every 2nd), so it runs cold for many passes after a load: half INFRA_PIECE_COLD_MS, like traffic's
 * once-per-cycle loops (G1: 10-37 x their warm cost in days 0-80, ~45 x on first executions), and a cell loop at most the
 * cold cell floor's cells (cellUnits). Pure native fills / copies (no JIT state) use INFRA_PIECE_MS.
 */
const COLD = INFRA_PIECE_COLD_MS / 4, WARM = INFRA_PIECE_MS;
/**
 * the tier steps' budget: a quarter of INFRA_PIECE_MS. The tier items run hundreds of times per pass and are near warm
 * after a few passes, but the first scheduled passes after a load still ran them at ~10 x (G2 dense1m: 2-4.4 ms steps at
 * 0.3) and at half INFRA_PIECE_MS at 22-93 x (B2 fix round: the gates' and the verify runs from a load, tiers.search /
 * alloc / final 3.5-5.5 ms in days 0-80); COLD likewise went from half to a quarter of INFRA_PIECE_COLD_MS (prep's
 * chunks, the stop list, NIMBY and the finish up to 4-6 ms there)
 */
const TIER = INFRA_PIECE_MS / 4;
/** cells of one piece of a once-per-pass cell loop costing `us` per cell (params INFRA_CELL_SIZING_US: the cold floor) */
function cellUnits(us: number, budget = COLD): number {
  return pieceUnits(us > INFRA_CELL_SIZING_US ? us : INFRA_CELL_SIZING_US, 1, budget);
}
/** buildings of one piece of a once-per-pass Building loop costing `us` per building (params INFRA_BLD_SIZING_US) */
function bldUnits(us: number, budget = COLD): number {
  return pieceUnits(us > INFRA_BLD_SIZING_US ? us : INFRA_BLD_SIZING_US, 1, budget);
}
/**
 * the absolute scale of the estimates: stepCost = SV_EST x (SC.piece + the piece's units x SC) / 1000. SC sets the
 * relative costs, so (with the budgets above) the chunk sizes; SV_EST makes the estimate honest warm wall ms without
 * moving a chunk (traffic's TR_EST pattern, G1). G2 fit: the median of estimate / wall over the services steps of dense1m
 * --warm 300 --days 120 (2 runs, 4,736 steps) was 1.23 at SV_EST 1 with these fixed costs.
 */
const SV_EST = 0.8;
/**
 * B2 cost model (design §9): estimated warm wall µs per work unit of each kind of piece; a piece's estimate is SC.piece +
 * its own work counts x these, and its chunk size is pieceUnits(coefficient, 1, budget), so both follow from the same
 * cursor. Start values: the services mapping's in-schedule fits (dense1m / bot256 / vet cities); G2 refit.
 */
const SC = {
  /** per piece (dispatch, cursors; G2 dense1m: the shortest pieces, a swap or an empty range, took 2-5 µs) */
  piece: 3,
  consume: 15, corridor: 0.0012, hashWord: 0.002, setup: 25, idArrays: 0.0006, fill: 0.0004,
  attach: 0.0046, snapTake: 0.02, snapPlan: 0.012,
  prepB: 0.12, prepF: 0.09, provSum: 0.0012, roads: 0.0012, publish: 1, workFac: 0.15, workSlot: 2,
  /** the tier engine: per re-weighted work unit (U_*), per step (G2 dense1m: a final row item of 41.6 µs of units took 45) */
  tierUnit: 0.0246, tierStep: 3,
  stopB: 0.012, stopCell: 0.004, stopBegin: 5, disk: 0.51, compose: 0.0024,
  seedB: 0.11, accSeed: 0.0034, accPop: 0.053, accInit: 0.002, chamfer: 0.009, accOut: 0.002, accHome: 0.035,
  shopStart: 0.002, shopPop: 0.038, shopInit: 0.002, shopBlock: 0.009, shopCs: 0.03, shopBox: 0.05, shopOut: 0.008,
  foot: 0.0168, combo: 0.0041, tierStat: 0.0026, needs: 10, stale: 0.004, eqhq: 0.06, end: 20,
} as const;

/** road-cell free-flow minutes (TIME_Q units) per Network for accessCommute (roads only) */
const NET_TIME_Q: readonly number[] = NET_TIME.map((t, k) => (k >= 1 && k <= 5 ? Math.max(1, Math.round(t / TIME_Q)) : 0));
const RAMP_Q = Math.round(RAMP_PENALTY / TIME_Q);

export interface UnservedCluster { x: number; z: number; people: number }

/** a cached reach of one facility: pool range + bounding box of the reached cells */
interface CacheEnt { key: number; start: number; end: number; x0: number; z0: number; x1: number; z1: number; road: boolean; valid: boolean }
interface SlotCache { idx: Int32Array<ArrayBuffer>; w: Float32Array<ArrayBuffer>; ent: Map<number, CacheEnt> }
interface ServiceInput { def: string; flags: number; built: boolean; staff: number }

function relevantDef(id: string): boolean {
  const d = getDef(id);
  return !!d && (!!d.coverage || d.category === 'park' || d.category === 'transport' || !!d.stigma || !!d.prestige || !!d.campus);
}
function nimbyDef(id: string): boolean {
  const d = getDef(id);
  return !!d && (!!d.stigma || !!d.prestige || !!d.campus);
}
/** service kinds whose fundingFactor a pass may read; it is 0 during a strike, which the monthly budget starts and ends */
const FUNDED_KINDS: readonly ServiceKind[] = ['police', 'fire', 'health', 'education', 'transit', 'parks', 'utilities', 'roads'];

const defNums = new Map<string, number>();
function defNum(id: string): number {
  let n = defNums.get(id);
  if (n === undefined) defNums.set(id, (n = defNums.size + 1));
  return n;
}
/** cache key of a facility: def + footprint (a moved / rotated / replaced building searches again) */
function keyOf(b: Building): number {
  return (((defNum(b.def) * 4096 + b.x) * 4096 + b.z) * 64 + (b.w & 63)) * 64 + (b.d & 63);
}

/** the traffic system's attachment refresh (a lazy cache other systems trigger through stopAttached) */
interface AttachProbe { attachRefreshMs?(st: CityState): number; stopAttached?(id: number): boolean }

/*
 * B2 R7 audit — the public queries, what they read, and the piece that publishes it (every other field is pass-private):
 *  layerOf(st, kind)          the CityState layers. Tier layers (police .. green): each slot's F_PUBLISH (.set of the clamped
 *                             and lot-maxed buffer; an empty slot's layer: its P_INIT fill). eduCov / parkCov: FI_COMBO_PUB.
 *                             transitCov: the transit slot's F_PUBLISH, ST_PUBLISH and the S_FOOT publish (three states, as
 *                             pre-B2: design R7 exception). accessCommute: AL_PUBLISH. shopAccess: SB_PUBLISH. stigma /
 *                             prestige / campus: the NIMBY run's publish piece.
 *  facilityLoadOf(st, id)     tierById .. powById: written by each tier item (record / reportDemand) as pre-B2 (R7
 *                             exception); the stale records are dropped by FI_STALE id ranges (a record of a facility the
 *                             pass did not process may stay readable until its range runs; facilityLoadOf already drops
 *                             removed / re-tiered buildings itself).
 *  clustersOf(tier)           need / provNeed (PR_PUBLISH swaps them in), the tier layer, donePasses (FI_END).
 *  needRaster(tier)           need / provNeed: PR_PUBLISH (prep builds into needBack / provBack).
 *  policeMul / policeFx       PR_SETUP (crime reads them).
 *  stats.needs / eq / hq      FI_NEEDS / FI_END. The events (layerUpdated): FI_END.
 * Saved data among these (policeCov, fireCov, healthCov, eduCov, parkCov, transitCov, stats) changes within one piece
 * per state, as within one step pre-B2 (R9).
 */
export class ServicesSystem implements SimSystem {
  readonly name = 'services';
  lastMs = 0;
  /** justice police multiplier folded into policeCov this pass (crime.ts divides it out so it counts once, WP3-3) */
  policeMul = 1;
  /** 'police.effect' ordinance factor folded into policeCov this pass (crime.ts applies only fx / policeFx, WP3-3) */
  policeFx = 1;

  private stepIdx = -1;
  private firstPass = false;
  private tierSlot = 0;
  private tierPhase = P_INIT;
  private cursor = 0;
  /** estimated work units left in this pass's tier steps (for step cost estimates) */
  private workLeft = 0;
  private lastRun = -1e9;
  private lastPassMs = -1e9;
  private framed = false;
  private lastEqDay = 0;
  private lastAccess = -1e9;
  private accessDirty = true;
  private doAccess = false;
  private nimbyDirty = true;
  private nimbyAge = 99;
  /** hash of the highway / rail cells (+ bridge / tunnel bits): the NIMBY corridor sources */
  private corridorH = 0;
  private doNimby = true;
  private dirty = false;
  private dirtyUrgent = false;
  private passUrgent = false;
  private justiceMul = 1;
  /** fundingFactor of each FUNDED_KINDS entry as last seen (NaN = not seen yet: the first sighting only records it) */
  private funded = new Float64Array(FUNDED_KINDS.length).fill(NaN);
  private inputs = new Map<number, ServiceInput>();
  private unsub: (() => void)[] = [];

  // pass inputs
  private fac: Building[][] = Array.from({ length: NT + 1 }, () => [] as Building[]);
  private facOp: number[][] = Array.from({ length: NT + 1 }, () => [] as number[]);
  private facCap: number[][] = Array.from({ length: NT + 1 }, () => [] as number[]);
  /**
   * current slot, per facility: its pool range; shared slots: seated fraction of its claims, seats taken. Typed, grown
   * once (tierInit): every entry of the slot is written (the search writes every range, the seat allocation every
   * fraction and seat count) before it is read. (G2: pre-B2's JS arrays, emptied per slot and filled in seat order, made
   * allocSeats deoptimise on an out-of-bounds store and run unoptimised for whole tier steps.)
   */
  private facStart = new Int32Array(64);
  private facEnd = new Int32Array(64);
  private facSig = new Float64Array(64);
  private facSeat = new Float64Array(64);
  /** seat order of the current shared slot (facility indices, best op first, then building id) */
  private order = new Int32Array(0);
  /** the slot's building ids by facility index, for seatOrder's comparator */
  private orderId = new Float64Array(0);
  private shared: boolean[] = new Array(NT + 1).fill(false);
  /** slot had facilities in the previous pass (an empty slot's layer is already 0) */
  private hadFac: boolean[] = new Array(NT + 1).fill(true);
  private multi: Building[] = [];
  /** Σ footprint cells of `multi` (work estimate of the per-tier footprint max in finalizeTier) */
  private multiCells = 0;
  /**
   * B2: the lots of `multi` as clipped rectangles (x0, z0, x1, z1 per lot), captured in prep: the footprint-max loops read
   * these instead of Building fields (a building's footprint never changes, so the values are the ones the pre-B2 loops
   * read), which keeps them out of the Building-shape deopt waves
   */
  private multiRect = new Int32Array(256);
  private fx: OrdEffects | null = null;
  private roadCells = 0;
  private csSeeds = new Int32Array(0);
  private nCsSeeds = 0;
  private needSum = new Float64Array(N_RASTERS);

  // scratch (cells)
  private C = 0;
  private need: Float32Array[] = [];
  private provNeed: (Float32Array | null)[] = new Array(NT).fill(null);
  private provSum = new Float64Array(NT);
  /** reach sum per cell (sum_f a_fi) of the current slot */
  private A = new Float32Array(0);
  /** shared tiers: unseated share per cell (1 = nobody seated yet) */
  private seat = new Float32Array(0);
  /** coverage accumulator of the current slot */
  private cov = new Float32Array(0);
  private tmp = new Float32Array(0);
  private idist = new Int32Array(0);
  private shopDist = new Int32Array(0);
  private shares = new Float32Array(5);
  private shopLut = new Float32Array(0);
  private colX0 = new Int32Array(0);
  private colX1 = new Int32Array(0);
  private colT = new Float32Array(0);
  // reach pool of the current slot (becomes the slot's cache at the end of the slot) + per-slot caches
  private pIdx: Int32Array<ArrayBuffer> = new Int32Array(0);
  private pW: Float32Array<ArrayBuffer> = new Float32Array(0);
  private poolN = 0;
  private curEnt = new Map<number, CacheEnt>();
  private cache: (SlotCache | null)[] = new Array(NT + 1).fill(null);
  private netHash = 0;
  private waterHash = 0;
  private netEvents = false;
  private stops: StopList | undefined;

  // per-facility results (by building id) for facilityLoad
  private tierById = new Float32Array(0);
  private capById = new Float32Array(0);
  private demById = new Float32Array(0);
  private servById = new Float32Array(0);
  private seatById = new Float32Array(0);
  private opById = new Float32Array(0);
  private utilById = new Float32Array(0);
  private powById = new Float32Array(0);
  /** pass number that last recorded each facility (stale entries are cleared at the end of a pass) */
  private seenById = new Float32Array(0);
  private passNo = 0;
  // stats per need slot; unserved clusters (lazy, per completed pass)
  private tierStats: NeedStat[] = NEED_ORDER.map(() => ({ need: 0, served: 0, capacity: 0, unreached: 0, overcrowded: 0 }));
  private clusters: UnservedCluster[][] = NEED_ORDER.map(() => []);
  private clusterPass: number[] = NEED_ORDER.map(() => -1);
  private donePasses = 0;
  private lastState: CityState | null = null;

  // ---- B2 piece state (design §4). Every field below is reset at each pass start and end and in init (resetPieces /
  // ensure); none is saved (R9).
  /** sub-state of the current state (PR_* / ST_* / AL_* / SB_* / FI_*) */
  private sub = 0;
  /** loop cursor of the current sub-state (cells, rows, buildings, stops, facilities, lots, ids) */
  private cur = 0;
  /** second cursor (prep: the provider / work-estimate slot; finish: the tier of the stats) */
  private cur2 = 0;
  /** running hashes of prep (the corridor hash, then the network and water hashes) */
  private hAcc = 0;
  private hNet = 0;
  /** the pass's building list (R4): prep, stops, NIMBY, the access seeds and homes, shopB's CS sums, the EQ / HQ fallback */
  private snap = new BuildingSnapshot();
  /** st.nextBuildingId when the snapshot was taken (the police need run's monthly scan) */
  private snapNextId = 0;
  /** prep's building loop: the 7 need sums (doubles, as the pre-B2 locals) and the CS frontage seed count */
  private needAcc = new Float64Array(N_RASTERS);
  private nCs = 0;
  /** the need rasters prep fills (swapped with `need` in PR_PUBLISH) */
  private needBack: Float32Array[] = [];
  /** provider need rasters being built (swapped in per slot in PR_PUBLISH) and whether this pass's slot has one */
  private provBack: (Float32Array | null)[] = new Array(NT).fill(null);
  private provUse: boolean[] = new Array(NT).fill(false);
  private provRun: TierNeedRun | null = null;
  /** 0 the provider run, 1 its sum (by cell ranges) */
  private provPh = 0;
  private provAcc = 0;
  private roadAcc = 0;
  /** the tier work estimate being summed (PR_WORK) */
  private workAcc = 0;
  /** the tier slot's final items: item, cursor, the stats sums (doubles) */
  private finSub = F_CLAMP;
  private finCur = 0;
  private finNeed = 0;
  private finServed = 0;
  private finUnreached = 0;
  /** accumulator scratch of the stats loops (doubles) and the lot-max loop's units */
  private finAcc = new Float64Array(3);
  private lotOut = new Float64Array(1);
  /** C-cell scratch: a tier layer before its publish, the composed transit layer, the transit lot max */
  private finBuf = new Float32Array(0);
  private stopCol = new StopCollector();
  private stopFund = 0;
  private stopActive: ((s: number) => boolean) | undefined = undefined;
  private nimbyRun = new NimbyRun();
  private accRun = new RoadTimeRun();
  private shopRun = new RoadDistRun();
  /**
   * B2 (G2): the tier search's fresh reach in pieces (catchments ReachRun, its own engine). A fresh reach is held across
   * tier steps: reachPh 1 = searching, 2 = searched (the pool copy, the record and the union splat still to run); the
   * facility's cursor advances when its item completes. reachKey / reachRoad are the cache entry's key and kind, taken
   * when the reach begins (as pre-B2's reachOf took them before its search).
   */
  private reach = new ReachRun();
  private reachPh = 0;
  private reachKey = 0;
  private reachRoad = true;
  /** units the held item has spent so far (its remaining estimate) */
  private reachDone = 0;
  /** set by a tier item that stops before it completes: tierWork ends the step */
  private tierHold = false;
  /** accessCommute's value for unreached cells (from stats.avgCommute, read at the output's first piece) */
  private accUnreached = 0;
  private accNext = new Float32Array(0);
  private shopNext = new Float32Array(0);
  /** shopB's coarse block sums and box3 scratch (pre-B2: allocated per call) */
  private shopCs = new Float32Array(0);
  private shopPop = new Float32Array(0);
  private shopBoxTmp = new Float32Array(0);
  private eduNext = new Float32Array(0);
  private parkNext = new Float32Array(0);
  /** the per-tier stats of finish (doubles) */
  private fiServed = 0;
  private fiUnreached = 0;
  /** the EQ / HQ fallback sums (doubles) */
  private eqPop = 0;
  private eqEdu = 0;
  private eqHealth = 0;
  private eqAir = 0;
  private eqWp1 = false;

  init(sim: Simulation): void {
    for (const u of this.unsub) u();
    this.inputs.clear();
    this.funded.fill(NaN);
    this.dirty = this.dirtyUrgent = this.passUrgent = false;
    this.framed = false;
    this.lastPassMs = -1e9;
    this.unsub = [
      sim.events.on('buildingAdded', (b) => this.observeBuilding(sim.state, b)),
      sim.events.on('buildingRemoved', (b) => this.forgetBuilding(b)),
      sim.events.on('buildingChanged', (b) => this.observeBuilding(sim.state, b)),
      // population writes jobs / hire without buildingChanged; visit only the tracked service / NIMBY buildings
      sim.events.on('day', () => {
        for (const [id, prev] of this.inputs) {
          const b = sim.state.buildings.get(id);
          if (b) this.observeBuilding(sim.state, b);
          else this.forgetBuilding({ id, def: prev.def });
        }
        this.checkPolicy(sim.state);
      }),
      // after JusticeSystem.monthly and the budget's strike update (services.monthly would run before them)
      sim.events.on('month', () => this.checkPolicy(sim.state)),
      // NIMBY only depends on highway / rail cells of the network: prep compares their hash (corridorHash)
      sim.events.on('networkChanged', (r) => {
        this.dirty = true; this.accessDirty = true;
        this.invalidateReach(r);
      }),
      // WP7b (critic item 1 / 17): a new / removed tunnel connects or cuts subway stations -> transitCov
      sim.events.on('subwayChanged', () => { this.dirty = true; }),
    ];
    sim.state.systemData.infraVersion = 1;
    this.lastRun = -1e9;
    this.lastAccess = -1e9;
    this.accessDirty = true;
    this.nimbyDirty = true;
    this.lastEqDay = sim.state.day;
    this.stepIdx = -1;
    this.resetPieces();
    this.cache = new Array(NT + 1).fill(null);
    this.hadFac = new Array(NT + 1).fill(true);
    this.netEvents = false;
    this.compute(sim, true);
    const self = this;
    schedulerOf(sim).register({
      name: 'services',
      due: (s) => self.due(s),
      urgent: () => self.dirtyUrgent || self.passUrgent,
      cost: (s) => self.stepCost(s),
      step: (s) => self.step(s),
    });
  }

  daily(sim: Simulation): void {
    schedulerOf(sim).tickDay(sim);
  }

  frame(sim: Simulation, _dt: number): void {
    this.framed = true;
    schedulerOf(sim).tickFrame(sim, this);
  }

  /** policy / operating-factor change: prioritize the next pass, including its remaining steps */
  invalidate(): void {
    this.dirty = true;
    this.dirtyUrgent = true;
  }

  private observeBuilding(st: CityState, b: Building, reset = false): void {
    const prev = this.inputs.get(b.id);
    if (!relevantDef(b.def)) {
      if (prev) this.forgetBuilding(b);
      return;
    }
    const inf = infoOf(st, b);
    const water = inf.tier >= 0 && SLOT_OF_TIER[inf.tier] === SLOT_HEALTH && inf.usesWater;
    const flags = b.flags & (BF.Powered | BF.Burnt | BF.Abandoned | (water ? BF.Watered : 0));
    const built = b.built >= 1;
    const staff = facilityOpFactor(st, b);
    const changed = !prev || prev.def !== b.def || prev.flags !== flags || prev.built !== built;
    const staffChanged = !!prev && Math.abs(staff - prev.staff) >= SERVICES_STAFF_DELTA;
    if (!reset && (changed || staffChanged)) {
      this.dirty = true;
      if (staffChanged || (prev && ((prev.flags ^ flags) & BF.Watered))) this.dirtyUrgent = true;
      if (nimbyDef(b.def) || (prev && nimbyDef(prev.def))) this.nimbyDirty = true;
    }
    if (!prev) this.inputs.set(b.id, { def: b.def, flags, built, staff });
    else {
      prev.def = b.def; prev.flags = flags; prev.built = built;
      // retain small staffing changes so successive small moves can cross the threshold
      if (reset || changed || staffChanged) prev.staff = staff;
    }
  }

  private forgetBuilding(b: { id: number; def: string }): void {
    const prev = this.inputs.get(b.id);
    if (prev || relevantDef(b.def)) this.dirty = true;
    if (nimbyDef(b.def) || (prev && nimbyDef(prev.def))) this.nimbyDirty = true;
    this.inputs.delete(b.id);
  }

  private checkJustice(st: CityState): void {
    const mul = justiceFactors(st).policeMul;
    if (mul === this.justiceMul) return;
    this.justiceMul = mul;
    this.invalidate();
  }

  /** justice, plus the funding factors: a strike starts and ends with the monthly budget, without a funding action */
  private checkPolicy(st: CityState): void {
    this.checkJustice(st);
    if (this.recordFunding(st)) this.invalidate();
  }

  /** records the funding factors; true when one changed since the last record (a first sighting only records it) */
  private recordFunding(st: CityState): boolean {
    const seen = this.funded;
    let changed = false;
    for (let k = 0; k < FUNDED_KINDS.length; k++) {
      const f = fundingFactor(st, FUNDED_KINDS[k]);
      if (f === seen[k]) continue;
      if (!Number.isNaN(seen[k])) changed = true;
      seen[k] = f;
    }
    return changed;
  }

  private due(sim: Simulation): boolean {
    // justice also refreshes after day listeners / building edits, without a dedicated event
    this.checkJustice(sim.state);
    if (this.stepIdx >= 0) return true;
    const d = sim.state.day - this.lastRun;
    if (!this.dirtyUrgent && d < SERVICES_PERIOD && !(this.dirty && d >= SERVICES_DIRTY_DAYS)) return false;
    // No cap clock on a headless advanceDay path; framesActive also handles a renderer that stopped ticking.
    if (this.framed && schedulerOf(sim).framesActive && nowMs() - this.lastPassMs < SERVICES_MIN_PASS_MS) return false;
    return true;
  }

  /** coverage layer for a CoverageKind name */
  layerOf(st: CityState, kind: string): Float32Array | null {
    switch (kind) {
      case 'police': return st.policeCov;
      case 'fire': return st.fireCov;
      case 'health': return st.healthCov;
      case 'education': return st.eduCov;
      case 'park': return st.parkCov;
      case 'transit': return st.transitCov;
      default: return null;
    }
  }

  /** full synchronous update (init / tests) */
  compute(sim: Simulation, first: boolean): void {
    const t0 = nowMs();
    this.stepIdx = -1;
    this.firstPass = first;
    do this.step(sim); while (this.stepIdx >= 0);
    this.lastMs = nowMs() - t0;
  }

  /**
   * one step (B2: one piece) of the coverage pass. The state ids and transitions are the pre-B2 ones; a state stays
   * current until its last piece reports completion. A pass whose pieces run with nothing in between computes exactly
   * what the pre-B2 steps computed.
   */
  step(sim: Simulation): void {
    const t0 = nowMs();
    // (B2 review 1 O8: an explicit pass start — a direct stepIdx = -1 (compute, tests) starts with every cursor reset)
    if (this.stepIdx < 0) { this.resetPieces(); this.stepIdx = S_PREP; }
    switch (this.stepIdx) {
      case S_PREP: if (this.prepPiece(sim)) this.nextState(S_TIERS); break;
      case S_TIERS: this.tierWork(sim); break;
      case S_STOPS: if (this.stopsPiece(sim)) this.nextState(this.doNimby ? S_NIMBY : this.doAccess ? S_ACC_SEED : S_FOOT); break;
      case S_NIMBY: if (this.nimbyPiece(sim)) this.nextState(this.doAccess ? S_ACC_SEED : S_FOOT); break;
      case S_ACC_SEED: if (this.accSeedPiece(sim)) this.nextState(S_ACC_SEARCH); break;
      case S_ACC_SEARCH: if (this.accSearchPiece(sim)) this.nextState(S_ACC_LAND); break;
      case S_ACC_LAND: if (this.accLandPiece(sim)) this.nextState(S_SHOP_A); break;
      case S_SHOP_A: if (this.shopAPiece(sim)) this.nextState(S_SHOP_B); break;
      case S_SHOP_B: if (this.shopBPiece(sim)) this.nextState(S_FOOT); break;
      case S_FOOT: if (this.footPiece(sim)) this.nextState(S_FINISH); break;
      default:
        if (this.finishPiece(sim)) {
          this.stepIdx = -1;
          this.firstPass = false;
          this.passUrgent = false;
          this.resetPieces();
        }
    }
    this.lastMs = nowMs() - t0;
  }

  private nextState(s: number): void {
    this.stepIdx = s;
    this.sub = 0;
    this.cur = 0;
    this.cur2 = 0;
  }

  /** B2: every piece cursor back to its reset value; the pass's snapshot and runs are released (R9) */
  private resetPieces(): void {
    this.sub = 0; this.cur = 0; this.cur2 = 0;
    this.hAcc = 0; this.hNet = 0;
    this.snap.release();
    this.snapNextId = 0;
    this.needAcc.fill(0);
    this.nCs = 0;
    this.provUse.fill(false);
    this.provRun = null;
    this.provPh = 0; this.provAcc = 0; this.roadAcc = 0; this.workAcc = 0;
    this.finSub = F_CLAMP; this.finCur = 0; this.finNeed = 0; this.finServed = 0; this.finUnreached = 0;
    this.finAcc.fill(0); this.lotOut.fill(0);
    this.stopFund = 0;
    this.stopActive = undefined;
    this.nimbyRun.release();
    this.accRun.release();
    this.shopRun.release();
    this.reach.release();
    this.reachPh = 0; this.reachDone = 0; this.tierHold = false;
    this.accUnreached = 0;
    this.fiServed = 0; this.fiUnreached = 0;
    this.eqPop = 0; this.eqEdu = 0; this.eqHealth = 0; this.eqAir = 0; this.eqWp1 = false;
  }

  // ------------------------------------------------------------------------------------------------ B2 cost model
  /**
   * estimated warm wall ms of the next step (B2 §9: the next piece's own work counts x the SC coefficients, with the
   * piece's own chunk sizes). Pure and O(1): reads the cursors and sizes, never runs a loop, never sets anything up.
   */
  stepCost(sim: Simulation): number {
    return (SV_EST * (SC.piece + this.pieceUs(sim))) / 1000;
  }

  /** µs of the next piece (stepCost) */
  private pieceUs(sim: Simulation): number {
    const st = sim.state, C = st.cells, N = st.size;
    const chunk = (us: number, left: number, budget = COLD) => Math.max(0, Math.min(pieceUnits(us, 1, budget), left)) * us;
    const cells = (us: number, left: number) => Math.max(0, Math.min(cellUnits(us), left)) * us;
    const blds = (us: number, left: number) => Math.max(0, Math.min(bldUnits(us), left)) * us;
    const rowsUs = (us: number, rowsLeft: number) => Math.max(0, Math.min(Math.max(1, Math.floor(cellUnits(us) / Math.max(1, N))), rowsLeft)) * us * N;
    switch (this.stepIdx) {
      case -1: case S_PREP: return this.prepUs(sim, chunk);
      case S_TIERS: {
        // (a final row item runs alone: its rows; any other step: the step's budget, or what is left of the estimate)
        if (this.tierSlot <= NT && this.tierPhase === P_FINAL && (this.finSub === F_CLAMP || this.finSub === F_STATS)) {
          const u = this.finSub === F_CLAMP ? U_CLAMP : U_STATS;
          return SC.tierStep + SC.tierUnit * Math.min(N - this.finCur, this.finalRows(N, u, Infinity)) * N * u;
        }
        const unit = pieceUnits(SC.tierUnit, 1, TIER);
        return SC.tierStep + SC.tierUnit * Math.min(unit, Math.max(unit * 0.25, this.workLeft));
      }
      case S_STOPS:
        switch (this.sub) {
          case ST_COLLECT_B: return blds(SC.stopB, this.cur === 0 ? this.snap.n : this.snap.n - this.stopCol.bi);
          case ST_COLLECT_C: return cells(SC.stopCell, C - this.stopCol.ci);
          case ST_ATTACH: { const a = this.attachUs(sim); return a > 0 ? a : SC.stopBegin + C * SC.fill; }
          case ST_BEGIN: return SC.stopBegin + C * SC.fill;
          case ST_DISKS: return chunk(SC.disk, (this.stops?.n ?? 0) - this.cur, COLD / 2);
          case ST_COMPOSE: return (this.cur === 0 ? C * SC.fill : 0) + rowsUs(SC.compose, N - this.cur);
          default: return C * SC.fill;
        }
      case S_NIMBY: return this.nimbyRun.active ? this.nimbyRun.pieceUs(pieceBudgetUs(COLD)) : 4 * C * 0.0004;
      case S_ACC_SEED: return this.sub === 0 ? C * SC.fill : blds(SC.seedB, this.snap.n - this.cur);
      case S_ACC_SEARCH:
        if (this.sub === 0) return cells(SC.accSeed, this.cur === 0 ? C : C - this.accRun.seedAt);
        return chunk(SC.accPop, Math.max(1, this.accRun.queued));
      case S_ACC_LAND:
        switch (this.sub) {
          case AL_INIT: return rowsUs(SC.accInit, N - this.cur);
          case AL_FWD: case AL_BWD: return rowsUs(SC.chamfer, N - this.cur);
          case AL_OUT: return rowsUs(SC.accOut, N - this.cur);
          case AL_HOMES: return blds(SC.accHome * 2, this.snap.n - this.cur);
          default: return C * SC.fill;
        }
      case S_SHOP_A: return this.sub === 0 ? C * SC.fill + this.nCsSeeds * 0.01 : chunk(SC.shopPop, Math.max(1, this.shopRun.queued));
      case S_SHOP_B:
        switch (this.sub) {
          case SB_INIT: return rowsUs(SC.shopInit, N - this.cur);
          case SB_FWD: case SB_BWD: return rowsUs(SC.chamfer, N - this.cur);
          case SB_POP: return rowsUs(SC.shopBlock, N - this.cur);
          case SB_CS: return blds(SC.shopCs, this.snap.n - this.cur);
          case SB_BOX: { const nb = Math.ceil(N / CLUSTER_BLOCK); return nb * nb * SC.shopBox + N * 0.05; }
          case SB_OUT: return rowsUs(SC.shopOut, N - this.cur);
          default: return C * SC.fill;
        }
      case S_FOOT: return this.sub === 0 ? C * SC.fill : this.sub === 1 ? Math.min(pieceBudgetUs(COLD), this.multiCells * SC.foot) : C * SC.fill;
      default:
        switch (this.sub) {
          case FI_COMBO: return rowsUs(SC.combo, N - this.cur);
          case FI_COMBO_PUB: return 2 * C * SC.fill;
          case FI_TIERS: return rowsUs(SC.tierStat, N - this.cur);
          case FI_NEEDS: return cells(SC.stale, Math.min(this.tierById.length, this.seenById.length));
          case FI_STALE: return cells(SC.stale, Math.min(this.tierById.length, this.seenById.length) - this.cur);
          case FI_EQHQ: return blds(SC.eqhq, this.snap.n - this.cur);
          default: return SC.end + SC.needs;
        }
    }
  }

  /** µs of the next prep piece (pieceUs) */
  private prepUs(sim: Simulation, chunk: (us: number, left: number, budget?: number) => number): number {
    const st = sim.state, C = st.cells;
    const cells = (us: number, left: number) => Math.max(0, Math.min(cellUnits(us), left)) * us;
    if (this.stepIdx < 0) return SC.consume + cells(SC.corridor, st.network.length);
    switch (this.sub) {
      case PR_CORRIDOR: return (this.cur === 0 ? SC.consume : 0) + cells(SC.corridor, st.network.length - this.cur);
      case PR_NETHASH: return cells(SC.hashWord, ((st.network.length & ~3) - this.cur) >> 2) + 1;
      case PR_WATERHASH: return cells(SC.hashWord, ((st.water.length & ~3) - this.cur) >> 2) + 1;
      case PR_SETUP: return SC.setup;
      case PR_FILLS: return chunk(C * SC.fill, N_RASTERS - this.cur, WARM);
      case PR_ATTACH: { const a = this.attachUs(sim); return a > 0 ? a : st.buildings.size * SC.snapTake; }
      case PR_SNAP: return st.buildings.size * SC.snapTake + 9 * Math.max(0, st.nextBuildingId + 1 - this.tierById.length) * SC.idArrays;
      case PR_PLAN: return chunk(SC.snapPlan, this.snap.n - this.snap.planned);
      case PR_BLD: return this.snap.countOf(this.cur) * SC.prepB + this.snap.cellsOf(this.cur) * SC.prepF;
      case PR_PROV: {
        const run = this.provRun;
        if (run) return this.provPh === 0 ? run.pieceUs(pieceBudgetUs(COLD)) : cells(SC.provSum, C - this.cur);
        return SC.workSlot + C * SC.fill;
      }
      case PR_ROADS: return cells(SC.roads, C - this.cur);
      case PR_PUBLISH: return SC.publish;
      default: return chunk(SC.workFac, this.facLeft()) + SC.workSlot;
    }
  }

  /** facilities the work estimate has not visited yet (prepUs; O(slots)) */
  private facLeft(): number {
    let n = 0;
    for (let k = this.cur2; k <= NT; k++) n += this.fac[k].length;
    return Math.max(1, n - (this.cur2 <= NT ? this.cur : 0));
  }

  /** µs of traffic's pending attachment refresh (0 when current) */
  private attachUs(sim: Simulation): number {
    const tr = sim.getSystem('traffic') as unknown as AttachProbe | undefined;
    return tr && typeof tr.attachRefreshMs === 'function' ? tr.attachRefreshMs(sim.state) * 1000 : 0;
  }

  /** B2: the name of the next piece ('prep.bld#3'), for the step tools (b2work cpumap / profile labels) */
  get stepName(): string {
    switch (this.stepIdx) {
      case -1: return 'prep.corridor';
      case S_PREP: return 'prep.' + ['corridor', 'netHash', 'waterHash', 'setup', 'fills', 'attach', 'snap', 'plan', 'bld', 'prov', 'roads', 'publish', 'work'][this.sub]
        + (this.sub === PR_BLD ? '#' + this.cur : this.sub === PR_PROV && this.provRun ? '.' + (this.provPh === 0 ? this.provRun.label : 'sum') : '');
      case S_TIERS: return 'tiers.' + (this.tierSlot > NT ? 'end' : ['init', 'search', 'alloc', 'report', 'final'][this.tierPhase]);
      case S_STOPS: return 'stops.' + ['collectB', 'collectC', 'attach', 'begin', 'disks', 'compose', 'publish'][this.sub];
      case S_NIMBY: return 'nimby.' + this.nimbyRun.label;
      case S_ACC_SEED: return this.sub === 0 ? 'accSeed.fill' : 'accSeed.bld';
      case S_ACC_SEARCH: return this.sub === 0 ? 'accSearch.seeds' : 'accSearch.run';
      case S_ACC_LAND: return 'accLand.' + ['init', 'fwd', 'bwd', 'out', 'homes', 'publish'][this.sub];
      case S_SHOP_A: return this.sub === 0 ? 'shopA.start' : 'shopA.run';
      case S_SHOP_B: return 'shopB.' + ['init', 'fwd', 'bwd', 'pop', 'cs', 'box', 'out', 'publish'][this.sub];
      case S_FOOT: return 'foot.' + ['copy', 'lots', 'publish'][this.sub];
      default: return 'finish.' + ['combo', 'comboPub', 'tiers', 'needs', 'stale', 'eqhq', 'end'][this.sub];
    }
  }

  // ------------------------------------------------------------------------------------------------ reach cache
  /** a road change inside (or next to) a cached reach invalidates it (no rect = every road reach) */
  private invalidateReach(r: CellRect | undefined): void {
    this.netEvents = true;
    const hit = (e: CacheEnt) => !r || (r.x0 - 2 <= e.x1 && r.x1 + 2 >= e.x0 && r.z0 - 2 <= e.z1 && r.z1 + 2 >= e.z0);
    for (const c of this.cache) {
      if (!c) continue;
      for (const e of c.ent.values()) if (e.road && e.valid && hit(e)) e.valid = false;
    }
    for (const e of this.curEnt.values()) if (e.road && e.valid && hit(e)) e.valid = false;
  }

  // ------------------------------------------------------------------------------------------------ prep
  private ensure(C: number): void {
    if (this.C === C) return;
    this.C = C;
    this.need = Array.from({ length: N_RASTERS }, () => new Float32Array(C));
    this.needBack = Array.from({ length: N_RASTERS }, () => new Float32Array(C));
    this.provNeed = new Array(NT).fill(null);
    this.provBack = new Array(NT).fill(null);
    this.A = new Float32Array(C);
    this.seat = new Float32Array(C);
    this.cov = new Float32Array(C);
    this.tmp = new Float32Array(C);
    this.idist = new Int32Array(C);
    this.shopDist = new Int32Array(C);
    this.finBuf = new Float32Array(C);
    this.accNext = new Float32Array(C);
    this.shopNext = new Float32Array(C);
    this.eduNext = new Float32Array(C);
    this.parkNext = new Float32Array(C);
    this.cache = new Array(NT + 1).fill(null);
    this.hadFac = new Array(NT + 1).fill(true);
  }

  /** the whole prep state in one go (pre-B2 name and semantics: tests, the one-go reference) */
  private prep(sim: Simulation): void {
    if (this.stepIdx !== S_PREP) { this.resetPieces(); this.stepIdx = S_PREP; }
    while (!this.prepPiece(sim)) { /* pieces */ }
    this.nextState(S_TIERS);
  }

  /** one prep piece; true when prep is complete */
  private prepPiece(sim: Simulation): boolean {
    const st = sim.state;
    for (;;) {
      switch (this.sub) {
        case PR_CORRIDOR:
          if (this.cur === 0) this.prepConsume(sim);
          if (this.prepCorridor(st)) { this.sub = PR_NETHASH; this.cur = 0; this.hAcc = 0x811c9dc5 ^ st.cells; }
          return false;
        case PR_NETHASH:
          if (this.prepHash(st.network)) { this.hNet = this.hAcc; this.sub = PR_WATERHASH; this.cur = 0; this.hAcc = 0x811c9dc5 ^ st.cells; }
          return false;
        case PR_WATERHASH:
          if (this.prepHash(st.water)) { this.prepCheckNetwork(this.hNet, this.hAcc); this.sub = PR_SETUP; this.cur = 0; }
          return false;
        case PR_SETUP: this.prepSetup(st); this.sub = PR_FILLS; this.cur = 0; return false;
        case PR_FILLS:
          if (this.prepFills()) { this.sub = PR_ATTACH; this.cur = 0; }
          return false;
        case PR_ATTACH:
          this.sub = PR_SNAP;
          if (this.prepAttach(sim)) return false;
          continue;
        case PR_SNAP:
          this.prepSnapshot(st);
          this.sub = PR_PLAN;
          return false;
        case PR_PLAN:
          if (this.snap.planRun(pieceUnits(SC.snapPlan, 1, COLD))) { this.sub = PR_BLD; this.cur = 0; }
          return false;
        case PR_BLD:
          if (this.cur < this.snap.chunks) this.prepBuildings(sim, this.cur++);
          if (this.cur >= this.snap.chunks) this.prepEndBuildings();
          return false;
        case PR_PROV:
          if (this.prepProviders(st)) { this.sub = PR_ROADS; this.cur = 0; this.roadAcc = 0; }
          return false;
        case PR_ROADS:
          if (this.prepRoads(st)) this.sub = PR_PUBLISH;
          return false;
        case PR_PUBLISH: this.prepPublish(); this.sub = PR_WORK; this.cur = 0; this.cur2 = 0; this.workAcc = 0; return false;
        default:
          return this.prepWork(st);
      }
    }
  }

  /** the pass inputs (R5: consumed in the pass's first piece; events after it mark the next pass) */
  private prepConsume(sim: Simulation): void {
    const st = sim.state;
    if (this.lastState !== st) { this.lastState = st; this.cache = new Array(NT + 1).fill(null); this.hadFac = new Array(NT + 1).fill(true); }
    this.lastRun = st.day;
    if (this.framed && schedulerOf(sim).framesActive) this.lastPassMs = nowMs();
    this.passUrgent = this.dirtyUrgent;
    this.dirtyUrgent = false;
    this.dirty = false;
    this.doAccess = this.firstPass || this.accessDirty || st.day - this.lastAccess >= ACCESS_PERIOD;
    if (this.doAccess) { this.lastAccess = st.day; this.accessDirty = false; }
    this.nimbyAge++;
    this.ensure(st.cells);
    this.hAcc = 0x2545f491;
  }

  /** the corridor hash by cell ranges; at its end the NIMBY decision (pre-B2 order: hash, compare, doNimby) */
  private prepCorridor(st: CityState): boolean {
    const n = st.network.length;
    const i1 = Math.min(n, this.cur + cellUnits(SC.corridor));
    this.hAcc = corridorHashRange(st, this.hAcc, this.cur, i1);
    this.cur = i1;
    if (i1 < n) return false;
    const ch = this.hAcc;
    if (ch !== this.corridorH) { this.corridorH = ch; this.nimbyDirty = true; }
    this.doNimby = this.firstPass || this.nimbyDirty || this.nimbyAge >= 2;
    if (this.doNimby) { this.nimbyAge = 0; this.nimbyDirty = false; }
    return true;
  }

  /** hashBytes(a, st.cells) by word ranges (hAcc), then its tail; true when done */
  private prepHash(a: Uint8Array): boolean {
    const n4 = a.length & ~3;
    const i1 = Math.min(n4, this.cur + 4 * cellUnits(SC.hashWord));
    this.hAcc = hashWords(a, this.hAcc, this.cur, i1);
    this.cur = i1;
    if (i1 < n4) return false;
    this.hAcc = hashTail(a, this.hAcc);
    return true;
  }

  /**
   * network hash: detects edits that bypass networkChanged (tests, tools) -> drop every road reach; water hash:
   * terraforming moves shores (the walk / drive near field stops at unbridged water) -> drop every road reach
   */
  private prepCheckNetwork(h: number, wh: number): void {
    if ((h !== this.netHash && !this.netEvents) || wh !== this.waterHash) this.invalidateReach(undefined);
    this.netHash = h;
    this.waterHash = wh;
    this.netEvents = false;
  }

  /** the pass's lists, effects, justice, funding and id arrays */
  private prepSetup(st: CityState): void {
    for (const l of this.fac) l.length = 0;
    for (const l of this.facOp) l.length = 0;
    for (const l of this.facCap) l.length = 0;
    this.multi.length = 0;
    this.multiCells = 0;
    this.fx = readEffects(st);
    const policeMul = justiceFactors(st).policeMul;
    this.policeMul = policeMul;
    this.justiceMul = policeMul;
    this.recordFunding(st);
    this.policeFx = this.fx.policeEffect;
    this.needAcc.fill(0);
    this.nCs = 0;
  }

  /** the pass snapshot (R4) and the per-id arrays, sized for every id of it (the tier items record by id) */
  private prepSnapshot(st: CityState): void {
    this.snap.take(st);
    this.snapNextId = st.nextBuildingId;
    this.tierById = ensureIdFloat(this.tierById as Float32Array<ArrayBuffer>, st);
    this.capById = ensureIdFloat(this.capById as Float32Array<ArrayBuffer>, st);
    this.demById = ensureIdFloat(this.demById as Float32Array<ArrayBuffer>, st);
    this.servById = ensureIdFloat(this.servById as Float32Array<ArrayBuffer>, st);
    this.seatById = ensureIdFloat(this.seatById as Float32Array<ArrayBuffer>, st);
    this.opById = ensureIdFloat(this.opById as Float32Array<ArrayBuffer>, st);
    this.utilById = ensureIdFloat(this.utilById as Float32Array<ArrayBuffer>, st);
    this.powById = ensureIdFloat(this.powById as Float32Array<ArrayBuffer>, st);
    this.seenById = ensureIdFloat(this.seenById as Float32Array<ArrayBuffer>, st);
    this.passNo = (this.passNo % 1e6) + 1;
    // (chunks planned with the cold Building floor; PR_BLD's estimate keeps prepB / prepF)
    this.snap.planBegin(Math.max(SC.prepB, INFRA_BLD_SIZING_US), SC.prepF, pieceBudgetUs(COLD));
  }

  /** zero the back need rasters (native fills, several per piece) */
  private prepFills(): boolean {
    const per = pieceUnits(this.C * SC.fill + 1, 1, WARM);
    const r1 = Math.min(N_RASTERS, this.cur + per);
    for (let r = this.cur; r < r1; r++) this.needBack[r].fill(0);
    this.cur = r1;
    return r1 >= N_RASTERS;
  }

  /** traffic's pending attachment refresh in its own piece (review 2 item 5e); false when it is current (no piece) */
  private prepAttach(sim: Simulation): boolean {
    const tr = sim.getSystem('traffic') as unknown as AttachProbe | undefined;
    if (!tr || typeof tr.attachRefreshMs !== 'function' || typeof tr.stopAttached !== 'function') return false;
    if (!(tr.attachRefreshMs(sim.state) > 0)) return false;
    tr.stopAttached(-1);
    return true;
  }

  /** chunk k of the snapshot: the pre-B2 building loop body */
  private prepBuildings(sim: Simulation, k: number): void {
    const st = sim.state;
    const N = st.size;
    const [res, kids, teens, college, health, play, green] = this.needBack;
    const acc = this.needAcc;
    const policeMul = this.policeMul;
    const sh = this.shares;
    let nCs = this.nCs;
    const bL = this.snap.list;
    for (let bI = this.snap.bounds[k], e = this.snap.bounds[k + 1]; bI < e; bI++) {
      const b = bL[bI];
      this.observeBuilding(st, b, true);
      if (b.w * b.d > 1) { this.pushLot(b, N); this.multiCells += b.w * b.d; }
      const inf = infoOf(st, b);
      if (inf.fam === Fam.R) {
        if (b.pop <= 0) continue;
        cohortShares(b, sh);
        const area = b.w * b.d;
        const per = b.pop / area;
        const k = sh[0] * per, t = sh[1] * per, y = sh[2] * per, a = sh[3] * per, s = sh[4] * per;
        const w = wealthOf(inf, b);
        const vCol = y * CATCH_COLLEGE_WILL[w - 1] + COLLEGE_ADULT_W * a;
        const vHea = (HEALTH_NEED_W[0] * k + HEALTH_NEED_W[1] * t + HEALTH_NEED_W[2] * y + HEALTH_NEED_W[3] * a + HEALTH_NEED_W[4] * s) / HEALTH_NEED_NORM;
        const vPla = k + PLAY_TEEN_W * t;
        const vGre = per * (GREEN_NEED_BASE + GREEN_NEED_SENIOR * sh[4]) / GREEN_NEED_NORM;
        let cells = 0;
        for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
          if (x < 0 || z < 0 || x >= N || z >= N) continue;
          const i = z * N + x;
          res[i] += per; kids[i] += k; teens[i] += t; college[i] += vCol; health[i] += vHea; play[i] += vPla; green[i] += vGre;
          cells++;
        }
        acc[0] += per * cells; acc[1] += k * cells; acc[2] += t * cells; acc[3] += vCol * cells; acc[4] += vHea * cells; acc[5] += vPla * cells; acc[6] += vGre * cells;
        continue;
      }
      if (!isFunctional(b)) continue;
      if (inf.fam === Fam.C && inf.dev >= DevType.CS1 && inf.dev <= DevType.CS3 && b.capacity > 0) nCs = this.pushFrontage(st, b, nCs);
      let slot = -1, R = 0, s = 0;
      if (inf.tier >= 0) { slot = SLOT_OF_TIER[inf.tier]; R = inf.tierRadius; s = inf.tierStrength; }
      // WP7b (WP7-6 / F2): only serving stops splat their transit coverage (no depot / garage, no off-road bus stop,
      // lone station or unlinked ferry)
      else if (inf.cov === 5 && transitCoverageActive(sim, b, inf)) { slot = SLOT_TRANSIT; R = inf.covRadius; s = inf.covStrength; }
      if (slot < 0 || !(R > 0) || !(s > 0)) continue;
      const op = this.opOf(st, b, inf, slot, policeMul);
      const prov = slot < NT ? tierProvider(NEED_ORDER[slot]) : undefined;
      let cap = slot === SLOT_TRANSIT ? Infinity : inf.tierCap;
      if (prov?.capacityOf) { const c = prov.capacityOf(st, b); if (c > 0) cap = c; }
      this.fac[slot].push(b);
      this.facOp[slot].push(op);
      this.facCap[slot].push(cap);
    }
    this.nCs = nCs;
  }

  /** a multi-cell building: the lot list and its clipped rectangle */
  private pushLot(b: Building, N: number): void {
    const q = this.multi.length;
    this.multi.push(b);
    if (this.multiRect.length < 4 * q + 4) { const a = new Int32Array(Math.max(8 * q + 8, 256)); a.set(this.multiRect); this.multiRect = a; }
    const r = this.multiRect;
    r[4 * q] = Math.max(0, b.x); r[4 * q + 1] = Math.max(0, b.z); r[4 * q + 2] = Math.min(N, b.x + b.w); r[4 * q + 3] = Math.min(N, b.z + b.d);
  }

  /** after the building chunks: the need sums, the CS seed count; the providers start at slot 0 */
  private prepEndBuildings(): void {
    this.needSum.set(this.needAcc);
    this.nCsSeeds = this.nCs;
    this.sub = PR_PROV;
    this.cur = 0;
    this.cur2 = 0;
    this.provRun = null;
    this.provPh = 0;
  }

  /**
   * tier modes + provider need rasters (WP7 registerTierProvider), slot by slot: a provider's need run in pieces (or its
   * needOf in one piece) into the slot's back raster, then its sum by cell ranges; true when every slot is done
   */
  private prepProviders(st: CityState): boolean {
    const C = st.cells;
    while (this.cur2 < NT) {
      const k = this.cur2;
      const prov = tierProvider(NEED_ORDER[k]);
      if (!this.provRun && this.provPh === 0) {
        this.shared[k] = prov?.shared ?? k >= 2;
        if (!prov?.needOf) { this.provUse[k] = false; this.cur2++; continue; }
        let a = this.provBack[k];
        if (!a || a.length !== C) a = this.provBack[k] = new Float32Array(C);
        a.fill(0);
        this.provUse[k] = true;
        if (prov.needRun) this.provRun = prov.needRun(st, this.needBack[0], a, this.snap.list, this.snapNextId);
        else { prov.needOf(st, this.needBack[0], a); this.provPh = 1; this.cur = 0; this.provAcc = 0; return false; }
      }
      if (this.provPh === 0) {
        if (this.provRun!.step(pieceBudgetUs(COLD))) { this.provRun = null; this.provPh = 1; this.cur = 0; this.provAcc = 0; }
        return false;
      }
      // the sum (index order, a double, as pre-B2)
      const i1 = Math.min(C, this.cur + cellUnits(SC.provSum));
      const sum = (this.provAcc = sumRange(this.provBack[k]!, this.provAcc, this.cur, i1));
      this.cur = i1;
      if (i1 < C) return false;
      this.provSum[k] = sum;
      this.provPh = 0;
      this.cur = 0;
      this.cur2++;
      return false;
    }
    this.shared[SLOT_TRANSIT] = false;
    this.cur = 0;
    return true;
  }

  /** the road cell count by ranges */
  private prepRoads(st: CityState): boolean {
    const C = st.cells;
    const i1 = Math.min(C, this.cur + cellUnits(SC.roads));
    this.roadAcc = countRoads(st.network, this.roadAcc, this.cur, i1);
    this.cur = i1;
    return i1 >= C;
  }

  /** the new need rasters and provider rasters become visible (needRaster, clustersOf, the tier steps) */
  private prepPublish(): void {
    const t = this.need;
    this.need = this.needBack;
    this.needBack = t;
    for (let k = 0; k < NT; k++) {
      if (this.provUse[k]) {
        const old = this.provNeed[k];
        this.provNeed[k] = this.provBack[k];
        this.provBack[k] = old;
      } else if (this.provNeed[k]) {
        if (!this.provBack[k]) this.provBack[k] = this.provNeed[k];
        this.provNeed[k] = null;
      }
    }
    this.roadCells = this.roadAcc;
  }

  /** the work estimate of the tier steps (same units as tierWork's counter; cached reaches are cheap), by facility ranges */
  private prepWork(st: CityState): boolean {
    const C = st.cells;
    let budget = pieceUnits(SC.workFac, 1, COLD);
    let w = this.workAcc;
    while (this.cur2 <= NT && budget > 0) {
      const k = this.cur2;
      const list = this.fac[k];
      if (this.cur === 0) {
        if (list.length === 0) { if (this.hadFac[k] || k === SLOT_TRANSIT) w += C * U_EMPTY; this.cur2++; continue; }
        w += C * (U_INIT + U_CLAMP + U_PUBLISH) + (k === SLOT_TRANSIT ? 0 : C * U_STATS + FOOT_WORK * this.multiCells);
        if (this.shared[k]) w += list.length * Math.log2(list.length + 1);
      }
      const cache = this.cache[k];
      const perEntry = this.shared[k] ? U_ENTRY * 2 + U_REPORT : U_ENTRY * 2;
      const c1 = Math.min(list.length, this.cur + budget);
      for (let c = this.cur; c < c1; c++) {
        const b = list[c];
        const e = cache?.ent.get(b.id);
        if (e && e.key === keyOf(b)) w += (e.end - e.start) * ((e.valid ? U_COPY : U_SEARCH) + perEntry) + 16; // last reach size
        else w += this.workOf(st, b, k);
      }
      budget -= c1 - this.cur;
      this.cur = c1;
      if (c1 < list.length) break;
      this.cur = 0;
      this.cur2++;
    }
    this.workAcc = w;
    if (this.cur2 <= NT) return false;
    this.workLeft = w;
    this.tierSlot = 0;
    this.tierPhase = P_INIT;
    this.cursor = 0;
    this.finSub = F_CLAMP;
    this.finCur = 0;
    return true;
  }

  /** frontage road cells (4-neighbours of the footprint) of a building -> csSeeds */
  private pushFrontage(st: CityState, b: Building, n: number): number {
    const N = st.size, net = st.network;
    const need = n + 2 * (b.w + b.d);
    if (this.csSeeds.length < need) { const a = new Int32Array(Math.max(need, this.csSeeds.length * 2, 1024)); a.set(this.csSeeds.subarray(0, n)); this.csSeeds = a; }
    const seeds = this.csSeeds;
    const x0 = b.x, x1 = b.x + b.w, z0 = b.z, z1 = b.z + b.d;
    for (let side = 0; side < 4; side++) {
      const horiz = side < 2;
      const fixed = side === 0 ? z0 - 1 : side === 1 ? z1 : side === 2 ? x0 - 1 : x1;
      if (fixed < 0 || fixed >= N) continue;
      const a0 = horiz ? x0 : z0, a1 = horiz ? x1 : z1;
      for (let a = a0; a < a1; a++) {
        if (a < 0 || a >= N) continue;
        const i = horiz ? fixed * N + a : a * N + fixed;
        const t = net[i];
        if (t >= 1 && t <= 5) seeds[n++] = i;
      }
    }
    return n;
  }

  /** operating factor of a facility (funding x ordinance x justice x power x water x staffing) */
  private opOf(st: CityState, b: Building, inf: DefInfo, slot: number, policeMul: number): number {
    const fx = this.fx!;
    const svc = inf.service ?? (inf.cov >= 0 ? KIND_SERVICE[COV_KINDS[inf.cov]] : inf.isPark ? 'parks' : undefined);
    let f = fundingFactor(st, svc);
    const need = slot < NT ? NEED_ORDER[slot] : null;
    if (need === 'police') f *= fx.policeEffect * policeMul;
    else if (need === 'elementary' || need === 'high' || need === 'college') f *= fx.eduEffect;
    else if (need === 'health') f *= fx.healthEffect;
    if (inf.usesPower && (b.flags & BF.Powered) === 0) f *= UNPOWERED_SERVICE_EFF;
    if (slot === SLOT_HEALTH && inf.usesWater && (b.flags & BF.Watered) === 0) f *= UNWATERED_HEALTH_EFF;
    const staff = facilityOpFactor(st, b);
    if (typeof staff === 'number' && isFinite(staff) && staff >= 0) f *= staff;
    return f;
  }

  /** estimated work units of one facility searched fresh (same units as tierWork's counter) */
  private workOf(st: CityState, b: Building, slot: number): number {
    return this.searchCells(st, b, slot) * ((this.metricOf(st, b, slot) === 2 ? U_SEARCH / 2 : U_SEARCH) + (this.shared[slot] ? U_ENTRY * 2 + U_REPORT : U_ENTRY * 2)) + 24;
  }
  private metricOf(st: CityState, b: Building, slot: number): number {
    return slot === SLOT_TRANSIT ? 2 : infoOf(st, b).metric;
  }
  /** expected cells reached by a fresh search of a facility (its reach disk; road reaches about half of it) */
  private searchCells(st: CityState, b: Building, slot: number): number {
    const inf = infoOf(st, b);
    const metric = slot === SLOT_TRANSIT ? 2 : inf.metric;
    const R = slot === SLOT_TRANSIT ? inf.covRadius : inf.tierRadius;
    const r = metric === 2 ? R + Math.max(b.w, b.d) / 2 : R * ROAD_RADIUS_FACTOR * 0.8;
    return Math.PI * r * r * (metric === 2 ? 1 : 0.5);
  }

  // ------------------------------------------------------------------------------------------------ tier engine
  /**
   * one tier step: items (an init, a facility's reach, its seat allocation, its demand report, a final row range / lot
   * range, a publish) while the next item's units fit in the step's budget (B2 design §4 S_TIERS c: the budget is tested
   * BEFORE an item, with the item's known units — a fresh reach by its expected size; a single item over the budget runs
   * alone). A step stops only between items; A, cov, seat, the pool and curEnt persist between steps as pre-B2, so the
   * units only move the boundaries.
   */
  private tierWork(sim: Simulation): void {
    const st = sim.state;
    const budget = pieceUnits(SC.tierUnit, 1, TIER);
    let work = 0;
    while (this.stepIdx === S_TIERS) {
      const k = this.tierSlot;
      if (k > NT) { this.nextState(S_STOPS); break; }
      // (a final row item — the clamp or the stats of a slot, once-per-pass cell loops — runs alone in its step, capped by
      // the cold cell floor: G2 dense1m measured them at interpreter speed in the first passes after a load)
      const rowItem = this.tierPhase === P_FINAL && (this.finSub === F_CLAMP || this.finSub === F_STATS);
      if (rowItem && work > 0) break;
      const u = this.tierItemUnits(st, k);
      if (work > 0 && work + u > budget) break;
      const done = this.tierItem(st, k, budget - work);
      work += done;
      this.workLeft -= done;
      if (rowItem) break;
      if (this.tierHold) { this.tierHold = false; break; }
    }
  }

  /** rows of a final row item (u tier units per cell): what `room` allows, at most the cold cell floor's cells */
  private finalRows(N: number, u: number, room: number): number {
    const cap = Math.floor(cellUnits(u * SC.tierUnit) / Math.max(1, N));
    return Math.max(1, Math.min(cap, Math.floor(room / (Math.max(1, N) * u))));
  }

  /** the next tier item's units, known before it runs (a fresh reach: its expected size; row / lot items: one row / lot) */
  private tierItemUnits(st: CityState, k: number): number {
    const C = st.cells, N = st.size;
    const list = this.fac[k];
    const shared = this.shared[k];
    switch (this.tierPhase) {
      case P_INIT:
        if (list.length === 0) return this.hadFac[k] || k === SLOT_TRANSIT ? C * U_EMPTY : 0;
        return C * U_INIT;
      case P_SEARCH: {
        if (this.cursor >= list.length) return shared ? list.length * Math.log2(list.length + 1) : 0;
        const b = list[this.cursor];
        // (a held fresh reach: what is left of its estimate; searched: its pool copy and splat)
        if (this.reachPh === 1) return Math.max(8, this.freshUnits(st, b, k) - this.reachDone);
        if (this.reachPh === 2) return this.reach.n * (U_REACH_COPY + (shared ? 0 : U_ENTRY * 2)) + 16;
        if (!st.buildings.has(b.id)) return 0;
        const cache = this.cache[k];
        const e = cache?.ent.get(b.id);
        if (cache && e && e.valid && e.key === keyOf(b)) return (e.end - e.start) * (U_COPY + (shared ? 0 : U_ENTRY * 2)) + (shared ? 8 : 16);
        return this.freshUnits(st, b, k);
      }
      case P_ALLOC: {
        if (this.cursor >= list.length) return 0;
        const c = this.order[this.cursor];
        const n = this.facEnd[c] - this.facStart[c];
        return n > 0 ? 2 * n * U_ENTRY + 8 : 4;
      }
      case P_REPORT: {
        if (this.cursor >= list.length) return 0;
        const c = this.cursor;
        const n = this.facEnd[c] - this.facStart[c];
        return n > 0 && this.facSig[c] < 1 ? n * U_REPORT + 14 : 2;
      }
      default:
        switch (this.finSub) {
          case F_CLAMP: return N * U_CLAMP;
          case F_STATS: return N * U_STATS;
          case F_CAP: return shared ? list.length * 0.5 + 8 : 8;
          case F_FOOT: {
            const q = this.finCur;
            if (q >= this.multi.length) return 0;
            const r = this.multiRect;
            return Math.max(1, r[4 * q + 2] - r[4 * q]) * Math.max(1, r[4 * q + 3] - r[4 * q + 1]) * FOOT_WORK;
          }
          default: return C * U_PUBLISH + 8;
        }
    }
  }

  /** expected units of facility b's fresh reach item (its search, pool copy and union splat) */
  private freshUnits(st: CityState, b: Building, k: number): number {
    const shared = this.shared[k];
    return this.searchCells(st, b, k) * ((this.metricOf(st, b, k) === 2 ? U_SEARCH / 2 : U_SEARCH) + (shared ? 0 : U_ENTRY * 2)) + (shared ? 16 : 24);
  }

  /** run the next tier item (row / lot items: as many rows / lots as `room` units allow, at least one); returns its units */
  private tierItem(st: CityState, k: number, room: number): number {
    switch (this.tierPhase) {
      case P_INIT: return this.fac[k].length === 0 ? this.tierEmpty(st, k) : this.tierInit(st, k);
      case P_SEARCH: return this.cursor >= this.fac[k].length ? this.tierSearchEnd(k) : this.tierSearch(st, k, room);
      case P_ALLOC: return this.tierAlloc(st, k);
      case P_REPORT: return this.tierReport(st, k);
      default: return this.finalItem(st, k, room);
    }
  }

  /** an empty slot: zero the layer (once; the transit layer every pass, the stops state composes the stop coverage onto
   *  it), stats without a cell loop */
  private tierEmpty(st: CityState, k: number): number {
    let w = 0;
    if (this.hadFac[k] || k === SLOT_TRANSIT) {
      (k === SLOT_TRANSIT ? st.transitCov : tierLayer(st, NEED_ORDER[k])).fill(0);
      w = st.cells * U_EMPTY;
    }
    this.hadFac[k] = false;
    this.cache[k] = null;
    if (k < NT) {
      const n = this.provNeed[k] ? this.provSum[k] : this.needSum[NEED_RASTER[k]];
      const ts = this.tierStats[k];
      ts.need = n; ts.served = 0; ts.capacity = 0; ts.unreached = n; ts.overcrowded = 0;
    }
    this.tierSlot++;
    return w;
  }

  private tierInit(st: CityState, k: number): number {
    this.hadFac[k] = true;
    this.A.fill(0);
    this.cov.fill(0);
    if (this.shared[k]) this.seat.fill(1);
    this.poolN = 0;
    this.curEnt = new Map();
    const n = this.fac[k].length;
    if (this.facStart.length < n) {
      const cap = Math.max(n, this.facStart.length * 2);
      this.facStart = new Int32Array(cap); this.facEnd = new Int32Array(cap);
      this.facSig = new Float64Array(cap); this.facSeat = new Float64Array(cap);
    }
    this.cursor = 0;
    this.tierPhase = P_SEARCH;
    return st.cells * U_INIT;
  }

  private tierSearchEnd(k: number): number {
    let w = 0;
    if (this.shared[k]) { this.seatOrder(k); this.tierPhase = P_ALLOC; w = this.fac[k].length * Math.log2(this.fac[k].length + 1); }
    else this.beginFinal();
    this.cursor = 0;
    return w;
  }

  /**
   * facility `cursor` of slot k: its reach (a cached copy, or a fresh search in pieces of at most `room` units, held across
   * steps), then the union splat. The cursor advances when the item completes; the pool, the cache entry, the record and
   * the splat are written in its last piece, in pre-B2's order.
   */
  private tierSearch(st: CityState, k: number, room: number): number {
    const c = this.cursor;
    const b = this.fac[k][c];
    let w = 0;
    if (this.reachPh === 0) {
      if (!st.buildings.has(b.id)) { this.facStart[c] = this.facEnd[c] = this.poolN; this.cursor++; return 0; }
      const hit = this.reachCached(b, k, c);
      if (hit >= 0) { this.cursor++; return hit + (this.shared[k] ? 0 : this.splatUnion(st, b, k, c, this.needOfSlot(k))); }
      this.reachBegin(st, b, k);
    }
    if (this.reachPh === 1) {
      const rr = this.reach, w0 = rr.work;
      const unit = this.reachRoad ? U_REACH_POP : U_REACH_DISK;
      const done = rr.run(Math.max(1, Math.floor(room / unit)));
      w = (rr.work - w0) * unit;
      this.reachDone += w;
      if (!done) { this.tierHold = true; return w; }
      this.reachPh = 2;
      // (the pool copy and the union splat when they fit in what is left of the step, else first in the next one)
      if (w > 0 && w + rr.n * (U_REACH_COPY + (this.shared[k] ? 0 : U_ENTRY * 2)) + 16 > room) { this.tierHold = true; return w; }
    }
    w += this.reachFinish(st, b, k, c);
    this.cursor++;
    return w + (this.shared[k] ? 0 : this.splatUnion(st, b, k, c, this.needOfSlot(k)));
  }

  /** shared tiers: facilities take seats in seat order (best op first, then building id) */
  private tierAlloc(st: CityState, k: number): number {
    const list = this.fac[k];
    if (this.cursor >= list.length) { this.tierPhase = P_REPORT; this.cursor = 0; return 0; }
    const c = this.order[this.cursor++];
    return this.allocSeats(st, list[c], k, c, this.needOfSlot(k));
  }

  /** shared tiers: demand / utilization of crowded facilities from the need left unseated in their reach */
  private tierReport(st: CityState, k: number): number {
    const list = this.fac[k];
    if (this.cursor >= list.length) { this.beginFinal(); return 0; }
    const c = this.cursor++;
    return this.reportDemand(st, list[c], k, c, this.needOfSlot(k));
  }

  /** the need raster of slot k (the transit slot: residents) */
  private needOfSlot(k: number): Float32Array {
    return k < NT ? this.provNeed[k] ?? this.need[NEED_RASTER[k]] : this.need[0];
  }

  private beginFinal(): void {
    this.tierPhase = P_FINAL;
    this.finSub = F_CLAMP;
    this.finCur = 0;
    this.finNeed = 0; this.finServed = 0; this.finUnreached = 0;
  }

  /**
   * the slot's final items (design §4 S_TIERS d): clamp cov into finBuf by rows; the stats by rows over finBuf (the
   * pre-footprint values, as pre-B2 read the layer before its footprint max); capacity / overcrowded and tierStats; the
   * footprint max on finBuf by lots; the publish (layer.set(finBuf), the cache swap, the next slot). The transit slot does
   * the clamp and the publish only. The layer changes once, in the publish: no reader sees a tier layer without its lot max.
   */
  private finalItem(st: CityState, k: number, room: number): number {
    switch (this.finSub) {
      case F_CLAMP: return this.finClamp(st, k, room);
      case F_STATS: return this.finStats(st, k, room);
      case F_CAP: return this.finCap(k);
      case F_FOOT: return this.finFoot(st, room);
      default: return this.finPublish(st, k);
    }
  }

  private finClamp(st: CityState, k: number, room: number): number {
    const N = st.size;
    const z0 = this.finCur, z1 = Math.min(N, z0 + this.finalRows(N, U_CLAMP, room));
    clampRange(this.cov, this.finBuf, z0 * N, z1 * N);
    this.finCur = z1;
    if (z1 >= N) { this.finSub = k === SLOT_TRANSIT ? F_PUBLISH : F_STATS; this.finCur = 0; }
    return (z1 - z0) * N * U_CLAMP;
  }

  private finStats(st: CityState, k: number, room: number): number {
    const N = st.size;
    const z0 = this.finCur, z1 = Math.min(N, z0 + this.finalRows(N, U_STATS, room));
    const acc = this.finAcc;
    acc[0] = this.finNeed; acc[1] = this.finServed; acc[2] = this.finUnreached;
    tierStatsRange(this.needOfSlot(k), this.finBuf, this.A, acc, z0 * N, z1 * N);
    this.finNeed = acc[0]; this.finServed = acc[1]; this.finUnreached = acc[2];
    this.finCur = z1;
    if (z1 >= N) { this.finSub = F_CAP; this.finCur = 0; }
    return (z1 - z0) * N * U_STATS;
  }

  private finCap(k: number): number {
    const shared = this.shared[k];
    let capacity = 0, over = 0;
    const list = this.fac[k], ops = this.facOp[k], caps = this.facCap[k];
    // capacity-free (union) tiers report capacity 0 / no crowding
    for (let c = 0; shared && c < list.length; c++) {
      const S = caps[c];
      if (!(S < Infinity)) continue;
      capacity += S * ops[c];
      const id = list[c].id;
      if (id < this.utilById.length && this.tierById[id] > 0 && this.utilById[id] > OVERCROWDED_UTIL) over++;
    }
    const ts = this.tierStats[k];
    ts.need = this.finNeed; ts.served = this.finServed; ts.capacity = capacity; ts.unreached = this.finUnreached; ts.overcrowded = over;
    this.finSub = F_FOOT;
    this.finCur = 0;
    return shared ? list.length * 0.5 + 8 : 8;
  }

  /**
   * a lot is covered as a whole from the moment its tier is written (the max over its footprint, as the footprint step
   * makes it at the end of the pass): the back rows of a deep lot, never reached per cell, would otherwise read 0 for the
   * days until that step, and the desirability band, needsOf (Residents) and the data views read the layer (195k city:
   * mean police over R cells 0.98 -> 0.46 on those days, a deep lot's stored desirability -9 vs raw +49)
   */
  private finFoot(st: CityState, room: number): number {
    // (at most S_FOOT's lots per piece, the same loop: SC.foot per lot cell at the cold budget. G2 dense1m: the first call
    // of a load's second pass ran at ~0.19 µs per lot cell, 2-3 ms and once 10 ms for the ~12,000 lot cells the cold cell
    // floor allowed, in about half the runs)
    const cap = cellUnits(SC.foot) * FOOT_WORK;
    const r = lotMaxRange(this.finBuf, st.size, this.multiRect, this.multi.length, this.finCur, room < cap ? room : cap, FOOT_WORK, this.lotOut);
    this.finCur = r;
    if (r >= this.multi.length) { this.finSub = F_PUBLISH; this.finCur = 0; }
    return this.lotOut[0];
  }

  private finPublish(st: CityState, k: number): number {
    (k === SLOT_TRANSIT ? st.transitCov : tierLayer(st, NEED_ORDER[k])).set(this.finBuf.subarray(0, st.cells));
    // this slot's pool becomes its cache; the old cache buffers are the next slot's pool
    const old = this.cache[k];
    this.cache[k] = { idx: this.pIdx, w: this.pW, ent: this.curEnt };
    if (old) { this.pIdx = old.idx; this.pW = old.w; } else { this.pIdx = new Int32Array(0); this.pW = new Float32Array(0); }
    this.poolN = 0;
    this.curEnt = new Map();
    this.tierSlot++;
    this.tierPhase = P_INIT;
    this.finSub = F_CLAMP;
    this.finCur = 0;
    return st.cells * U_PUBLISH + 8;
  }

  /**
   * seat order of shared slot k: operating factor descending (better-run facilities fill first), then building id. B2
   * (G2): the comparator reads the ids from a typed copy (the same values, so every comparison returns what pre-B2's
   * `list[a].id - list[b].id` returned and the sort output is identical): reading them from the Buildings made this one
   * item 0.9-2.7 ms at dense1m on every pass (play / green, 500-900 facilities, ~10 k comparisons on Building maps).
   */
  private seatOrder(k: number): void {
    const list = this.fac[k], ops = this.facOp[k];
    const n = list.length;
    if (this.order.length < n) this.order = new Int32Array(Math.max(n, this.order.length * 2, 64));
    if (this.orderId.length < n) this.orderId = new Float64Array(Math.max(n, this.orderId.length * 2, 64));
    const ord = this.order.subarray(0, n), ids = this.orderId;
    for (let c = 0; c < n; c++) { ord[c] = c; ids[c] = list[c].id; }
    ord.sort((a, b) => ops[b] - ops[a] || ids[a] - ids[b]);
  }

  /** facility b's reach copied from the slot's cache (entry valid, same key): its units, or -1 (a fresh reach) */
  private reachCached(b: Building, k: number, c: number): number {
    const key = keyOf(b), id = b.id;
    const cache = this.cache[k];
    const e = cache?.ent.get(id);
    if (!(cache && e && e.valid && e.key === key)) return -1;
    const off = this.poolN;
    const n = e.end - e.start;
    this.ensurePool(off + n);
    this.pIdx.set(cache.idx.subarray(e.start, e.end), off);
    this.pW.set(cache.w.subarray(e.start, e.end), off);
    this.poolN = off + n;
    this.facStart[c] = off; this.facEnd[c] = off + n;
    this.curEnt.set(id, { key, start: off, end: off + n, x0: e.x0, z0: e.z0, x1: e.x1, z1: e.z1, road: e.road, valid: true });
    return n * U_COPY + 8;
  }

  /** a fresh reach of facility b begins (reachRaw's prologue in the run; the key and the kind as pre-B2 took them) */
  private reachBegin(st: CityState, b: Building, k: number): void {
    this.reachKey = keyOf(b);
    const inf = infoOf(st, b);
    const transit = k === SLOT_TRANSIT;
    const metric = transit ? 2 : inf.metric;
    this.reachRoad = metric !== 2;
    this.reach.begin(st, b.x, b.z, b.w, b.d, transit ? inf.covRadius : inf.tierRadius, metric);
    this.reachPh = 1;
    this.reachDone = 0;
  }

  /** the searched reach into the pool (cells with weight > 0, in search order) and the slot's cache entry */
  private reachFinish(st: CityState, b: Building, k: number, c: number): number {
    const rr = this.reach;
    const n = rr.n;
    const touched = rr.touched, best = rr.best;
    const off = this.poolN;
    this.ensurePool(off + n);
    const pIdx = this.pIdx, pW = this.pW;
    const N = st.size;
    let m = off, x0 = N, z0 = N, x1 = -1, z1 = -1;
    for (let t = 0; t < n; t++) {
      const i = touched[t];
      const w = best[i];
      if (w <= 0) continue;
      pIdx[m] = i; pW[m] = w; m++;
      const x = i % N, z = (i - x) / N;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    this.poolN = m;
    this.facStart[c] = off; this.facEnd[c] = m;
    this.curEnt.set(b.id, { key: this.reachKey, start: off, end: m, x0, z0, x1, z1, road: this.reachRoad, valid: true });
    rr.release();
    this.reachPh = 0;
    this.reachDone = 0;
    return n * U_REACH_COPY + 16;
  }

  private ensurePool(n: number): void {
    if (this.pIdx.length >= n) return;
    const cap = Math.max(n, this.pIdx.length * 2, 65536);
    const a = new Int32Array(cap); a.set(this.pIdx.subarray(0, this.poolN)); this.pIdx = a;
    const f = new Float32Array(cap); f.set(this.pW.subarray(0, this.poolN)); this.pW = f;
  }

  /** union tier (police / fire / transit): legacy combination from the pool range; returns work units */
  private splatUnion(st: CityState, b: Building, k: number, c: number, needL: Float32Array): number {
    const id = b.id, flags = b.flags;
    const inf = infoOf(st, b);
    const transit = k === SLOT_TRANSIT;
    const s = transit ? inf.covStrength : inf.tierStrength;
    const op = this.facOp[k][c], S = this.facCap[k][c];
    const s0 = this.facStart[c], s1 = this.facEnd[c];
    const pIdx = this.pIdx, pW = this.pW;
    const A = this.A, cov = this.cov;
    let D = 0;
    for (let q = s0; q < s1; q++) { const i = pIdx[q]; const w = pW[q]; D += needL[i] * w; A[i] += w; }
    const r = S < Infinity && D > S ? op * (S / D) : op;
    const eff = s * r;
    let served = 0;
    if (eff > 0) {
      for (let q = s0; q < s1; q++) {
        const i = pIdx[q];
        let v = pW[q] * eff;
        if (v > 1) v = 1;
        served += needL[i] * v;
        cov[i] = 1 - (1 - cov[i]) * (1 - v);
      }
    }
    if (!transit) this.record(id, flags, inf, S, D, served, op, S < Infinity && D > S ? S : D);
    return (s1 - s0) * U_ENTRY * 2 + 8;
  }

  /**
   * shared tier: facility c of slot k takes seats from the unseated share of every cell it reaches (claims
   * e = min(u, a), seats sigma = min(1, S / sum need x e) of them at quality op); returns work units
   */
  private allocSeats(st: CityState, b: Building, k: number, c: number, needL: Float32Array): number {
    const s0 = this.facStart[c], s1 = this.facEnd[c];
    this.facSig[c] = 1; this.facSeat[c] = 0;
    if (s1 <= s0) return 4;
    const id = b.id, flags = b.flags;
    const inf = infoOf(st, b);
    const s = inf.tierStrength;
    const pIdx = this.pIdx, pW = this.pW, u = this.seat, A = this.A, cov = this.cov;
    let D = 0;
    for (let q = s0; q < s1; q++) {
      const i = pIdx[q];
      const a = pW[q] * s;
      A[i] += a;
      const ui = u[i];
      D += needL[i] * (ui < a ? ui : a);
    }
    const op = this.facOp[k][c], S = this.facCap[k][c];
    const sig = S < Infinity && D > S ? S / D : 1;
    const rho = sig * op;
    if (sig > 0) {
      for (let q = s0; q < s1; q++) {
        const i = pIdx[q];
        const a = pW[q] * s;
        const ui = u[i];
        const e = ui < a ? ui : a;
        if (!(e > 0)) continue;
        const left = ui - e * sig;
        u[i] = left > 0 ? left : 0;
        cov[i] += e * rho;
      }
    }
    const seated = D * sig;
    this.facSig[c] = sig;
    this.facSeat[c] = seated;
    // demand of an uncrowded facility = its claims; crowded ones are re-measured in reportDemand
    this.record(id, flags, inf, S, D, D * rho, op, seated);
    return 2 * (s1 - s0) * U_ENTRY + 8;
  }

  /**
   * shared tier, after every facility of the slot took its seats: a crowded facility's demand = seats taken + the
   * need its reach leaves unseated (min(u, a) per cell, by reach share a / sum a); returns work units
   */
  private reportDemand(st: CityState, b: Building, k: number, c: number, needL: Float32Array): number {
    const s0 = this.facStart[c], s1 = this.facEnd[c];
    if (s1 <= s0 || !(this.facSig[c] < 1)) return 2;
    const s = infoOf(st, b).tierStrength;
    const pIdx = this.pIdx, pW = this.pW, u = this.seat, A = this.A;
    let left = 0;
    for (let q = s0; q < s1; q++) {
      const i = pIdx[q];
      const n = needL[i];
      if (!(n > 0)) continue;
      const ui = u[i];
      if (!(ui > 0)) continue;
      const a = pW[q] * s;
      const Ai = A[i];
      left += n * (ui < a ? ui : a) * (Ai > a ? a / Ai : 1);
    }
    const id = b.id;
    if (id < this.demById.length) {
      const S = this.facCap[k][c];
      const dem = this.facSeat[c] + left;
      this.demById[id] = dem;
      this.utilById[id] = S < Infinity && S > 0 ? dem / S : 0;
    }
    return (s1 - s0) * U_REPORT + 14;
  }

  private record(id: number, flags: number, inf: DefInfo, S: number, D: number, served: number, op: number, seated: number): void {
    if (id >= this.tierById.length) return;
    this.tierById[id] = inf.tier + 1;
    this.seenById[id] = this.passNo;
    this.capById[id] = S;
    this.demById[id] = D;
    this.servById[id] = served;
    this.seatById[id] = seated;
    this.opById[id] = op;
    this.utilById[id] = S < Infinity && S > 0 ? D / S : 0;
    this.powById[id] = !inf.usesPower || (flags & BF.Powered) !== 0 ? 1 : 0;
  }

  // ------------------------------------------------------------------------------------------------ transit stops
  /** the whole stops state in one go (pre-B2 name and semantics) */
  private finishTransit(sim: Simulation): void {
    if (this.stepIdx !== S_STOPS) this.nextState(S_STOPS);
    while (!this.stopsPiece(sim)) { /* pieces */ }
  }

  /**
   * transit stops coverage (combined with the generic transit coverage), in pieces: the stop list over the snapshot and
   * the cells (collectStops' order), traffic's attachment refresh (its own piece when pending), the funding capture, the
   * disks by stop ranges into tmp, the compose by rows into a copy of transitCov, the publish (.set). True when done.
   */
  private stopsPiece(sim: Simulation): boolean {
    const st = sim.state;
    const C = st.cells, N = st.size;
    for (;;) {
      switch (this.sub) {
        case ST_COLLECT_B: {
          if (this.cur === 0) {
            this.stops ??= { n: 0, bid: new Int32Array(64), mode: new Uint8Array(64), cell: new Int32Array(64) };
            this.stopCol.begin(this.stops);
            this.cur = 1;
          }
          if (this.stopCol.buildings(st, this.snap.list, bldUnits(SC.stopB))) this.sub = ST_COLLECT_C;
          return false;
        }
        case ST_COLLECT_C:
          if (this.stopCol.cells(st, cellUnits(SC.stopCell))) { this.stops = this.stopCol.end(); this.sub = ST_ATTACH; }
          return false;
        case ST_ATTACH:
          this.sub = ST_BEGIN;
          if (this.prepAttach(sim)) return false;
          continue;
        case ST_BEGIN: {
          this.stopFund = Math.min(1.25, fundingFactor(st, 'transit'));
          // WP7b: unattached stops (traffic.stopAttached) give no walking coverage; road-flag stops sit on a road
          const stops = this.stops!;
          this.stopActive = (s) => stops.bid[s] < 0 || stopServes(sim, stops.bid[s]);
          this.tmp.fill(0);
          this.sub = ST_DISKS;
          this.cur = 0;
          return false;
        }
        case ST_DISKS: {
          const stops = this.stops!;
          // (the stop disks run cold the longest: 25-45 x in the first passes after a load; half the cold budget)
          const s1 = Math.min(stops.n, this.cur + pieceUnits(SC.disk, 1, COLD / 2));
          transitCoverageRange(st, stops, this.tmp, this.stopFund, true, this.stopActive, this.cur, s1);
          this.cur = s1;
          if (s1 >= stops.n) { this.sub = ST_COMPOSE; this.cur = 0; this.stopActive = undefined; }
          return false;
        }
        case ST_COMPOSE: {
          // the compose works on a byte copy of transitCov (cells without stop coverage keep their exact bits)
          if (this.cur === 0) this.finBuf.set(st.transitCov.subarray(0, C));
          const rows = Math.max(1, Math.floor(cellUnits(SC.compose) / Math.max(1, N)));
          const z1 = Math.min(N, this.cur + rows);
          composeRange(this.finBuf, this.tmp, this.cur * N, z1 * N);
          this.cur = z1;
          if (z1 >= N) this.sub = ST_PUBLISH;
          return false;
        }
        default:
          st.transitCov.set(this.finBuf.subarray(0, C));
          return true;
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ NIMBY
  /** NIMBY / YIMBY rasters in pieces over the pass snapshot (nimby.ts NimbyRun); true when published */
  private nimbyPiece(sim: Simulation): boolean {
    if (!this.nimbyRun.active) { this.nimbyRun.begin(sim, this.snap.list); }
    return this.nimbyRun.step(pieceBudgetUs(COLD));
  }

  // ------------------------------------------------------------------------------------------------ access fields
  /** the whole access-seed state in one go (pre-B2 name and semantics) */
  private accessCommuteSeeds(sim: Simulation): void {
    if (this.stepIdx !== S_ACC_SEED) this.nextState(S_ACC_SEED);
    while (!this.accSeedPiece(sim)) { /* pieces */ }
  }

  /** accessCommute step 1: seeds on frontage road cells (homes: their commute; job sites: CAR_OVERHEAD + 2) */
  private accSeedPiece(sim: Simulation): boolean {
    if (this.sub === 0) { this.idist.fill(-1); this.sub = 1; this.cur = 0; return false; }
    const e = Math.min(this.snap.n, this.cur + bldUnits(SC.seedB));
    this.accSeedRange(sim, this.cur, e);
    this.cur = e;
    return e >= this.snap.n;
  }

  /** the access seeds of the snapshot buildings [b0, b1) */
  private accSeedRange(sim: Simulation, b0: number, b1: number): void {
    const st = sim.state;
    const N = st.size;
    const net = st.network;
    const dist = this.idist;
    const tr = sim.getSystem<TrafficSystem>('traffic');
    const jobKey = Math.round((CAR_OVERHEAD + ACCESS_JOB_EXTRA) / TIME_Q);
    const maxKey = Math.round(MAX_COMMUTE / TIME_Q);
    const cm = st.commute;
    const bL = this.snap.list;
    for (let bI = b0; bI < b1; bI++) {
      const b = bL[bI];
      if (b.built < 1 || (b.flags & (BF.Burnt | BF.Abandoned)) !== 0) continue;
      const inf = infoOf(st, b);
      let key: number;
      if (inf.fam === Fam.R) {
        if (b.pop <= 0) continue;
        let m = tr ? tr.commuteOf(b.id) : 0;
        if (!(m > 0)) m = cm[Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1))];
        if (!(m > 0)) continue;
        key = Math.min(maxKey, Math.round(m / TIME_Q));
      } else if (jobSlots(inf, b) >= ACCESS_JOB_SLOTS) key = jobKey;
      else continue;
      const x0 = b.x, x1 = b.x + b.w, z0 = b.z, z1 = b.z + b.d;
      for (let side = 0; side < 4; side++) {
        const horiz = side < 2;
        const fixed = side === 0 ? z0 - 1 : side === 1 ? z1 : side === 2 ? x0 - 1 : x1;
        if (fixed < 0 || fixed >= N) continue;
        const a0 = horiz ? x0 : z0, a1 = horiz ? x1 : z1;
        for (let a = a0; a < a1; a++) {
          if (a < 0 || a >= N) continue;
          const i = horiz ? fixed * N + a : a * N + fixed;
          const t = net[i];
          if (t < 1 || t > 5) continue;
          const d = dist[i];
          if (d < 0 || key < d) dist[i] = key;
        }
      }
    }
  }

  /** accessCommute step 2: the multi-source free-flow search (catchments RoadTimeRun: seed scan, then the drain) */
  private accSearchPiece(sim: Simulation): boolean {
    if (this.sub === 0) {
      if (this.cur === 0) { this.accRun.begin(sim.state, this.idist, Math.round((MAX_COMMUTE + 60) / TIME_Q), NET_TIME_Q, RAMP_Q); this.cur = 1; }
      if (this.accRun.seed(cellUnits(SC.accSeed))) this.sub = 1;
      return false;
    }
    if (!this.accRun.run(pieceUnits(SC.accPop, 1, COLD))) return false;
    this.accRun.release();
    return true;
  }

  /** the whole access-land state in one go (pre-B2 name and semantics) */
  private accessCommuteLand(sim: Simulation): void {
    if (this.stepIdx !== S_ACC_LAND) this.nextState(S_ACC_LAND);
    while (!this.accLandPiece(sim)) { /* pieces */ }
  }

  /**
   * accessCommute step 3: land cells (adjacent road + ACCESS_LAND_STEP per cell), unreached, R footprints — the init,
   * the two chamfer sweeps and the output by rows (each sweep reads only rows it finished, so it resumes at row
   * boundaries), the home footprints over the snapshot, all into accNext; then the publish (.set)
   */
  private accLandPiece(sim: Simulation): boolean {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const net = st.network;
    const v = this.tmp;
    const INF = 1e9;
    const rows = (us: number) => Math.max(1, Math.floor(cellUnits(us) / Math.max(1, N)));
    switch (this.sub) {
      case AL_INIT: {
        const z1 = Math.min(N, this.cur + rows(SC.accInit));
        accInitRange(v, net, this.idist, INF, this.cur * N, z1 * N);
        this.cur = z1;
        if (z1 >= N) { this.sub = AL_FWD; this.cur = 0; }
        return false;
      }
      case AL_FWD: {
        const z1 = Math.min(N, this.cur + rows(SC.chamfer));
        chamferForward(v, N, net, ACCESS_LAND_STEP, INF, this.cur, z1);
        this.cur = z1;
        if (z1 >= N) { this.sub = AL_BWD; this.cur = 0; }
        return false;
      }
      case AL_BWD: {
        // (cur counts the rows done from the bottom)
        const r1 = Math.min(N, this.cur + rows(SC.chamfer));
        chamferBackward(v, N, net, ACCESS_LAND_STEP, INF, N - r1, N - this.cur);
        this.cur = r1;
        if (r1 >= N) { this.sub = AL_OUT; this.cur = 0; }
        return false;
      }
      case AL_OUT: {
        if (this.cur === 0) { const avg = st.stats.avgCommute; this.accUnreached = avg > 0 ? ACCESS_UNREACHED * avg : 0; }
        const z1 = Math.min(N, this.cur + rows(SC.accOut));
        accOutRange(this.accNext, v, INF, this.accUnreached, this.cur * N, z1 * N);
        this.cur = z1;
        if (z1 >= N) { this.sub = AL_HOMES; this.cur = 0; }
        return false;
      }
      case AL_HOMES: {
        const e = Math.min(this.snap.n, this.cur + bldUnits(SC.accHome * 2));
        this.accHomes(st, this.cur, e);
        this.cur = e;
        if (e >= this.snap.n) this.sub = AL_PUBLISH;
        return false;
      }
      default:
        st.accessCommute.set(this.accNext.subarray(0, C));
        return true;
    }
  }

  /** residential footprints of the snapshot buildings [b0, b1) keep their own (traffic) commute */
  private accHomes(st: CityState, b0: number, b1: number): void {
    const N = st.size;
    const out = this.accNext, cm = st.commute;
    const bL = this.snap.list;
    for (let bI = b0; bI < b1; bI++) {
      const b = bL[bI];
      if (b.pop <= 0 || infoOf(st, b).fam !== Fam.R) continue;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        if (cm[i] > 0) out[i] = cm[i];
      }
    }
  }

  /** shopAccess step 1: road distance from the CS frontage seeds (catchments RoadDistRun) */
  private shopAPiece(sim: Simulation): boolean {
    if (this.sub === 0) {
      this.shopRun.start(sim.state, 1, this.csSeeds, this.nCsSeeds, SHOP_CAP_CELLS * 4, this.shopDist);
      this.sub = 1;
      return false;
    }
    if (!this.shopRun.run(pieceUnits(SC.shopPop, 1, COLD))) return false;
    this.shopRun.release();
    return true;
  }

  /** the whole shop-land state in one go (pre-B2 name and semantics) */
  private shopLand(sim: Simulation): void {
    if (this.stepIdx !== S_SHOP_B) this.nextState(S_SHOP_B);
    while (!this.shopBPiece(sim)) { /* pieces */ }
  }

  /**
   * shopAccess step 2: land cells, distance score x (base + supply ratio of CS jobs to residents per coarse block) — the
   * init and the chamfer by rows, the block sums (residents by rows, CS capacity over the snapshot), box3 x 2 + the ratio
   * + the LUT + the column taps, the bilinear output by rows into shopNext; then the publish (.set)
   */
  private shopBPiece(sim: Simulation): boolean {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const net = st.network;
    const v = this.tmp;
    const INF = 1e9;
    const B = CLUSTER_BLOCK;
    const nb = Math.ceil(N / B);
    const rows = (us: number) => Math.max(1, Math.floor(cellUnits(us) / Math.max(1, N)));
    switch (this.sub) {
      case SB_INIT: {
        const z1 = Math.min(N, this.cur + rows(SC.shopInit));
        shopInitRange(v, net, this.shopDist, INF, this.cur * N, z1 * N);
        this.cur = z1;
        if (z1 >= N) { this.sub = SB_FWD; this.cur = 0; }
        return false;
      }
      case SB_FWD: {
        const z1 = Math.min(N, this.cur + rows(SC.chamfer));
        chamferForward(v, N, net, 4, INF, this.cur, z1);
        this.cur = z1;
        if (z1 >= N) { this.sub = SB_BWD; this.cur = 0; }
        return false;
      }
      case SB_BWD: {
        const r1 = Math.min(N, this.cur + rows(SC.chamfer));
        chamferBackward(v, N, net, 4, INF, N - r1, N - this.cur);
        this.cur = r1;
        if (r1 >= N) { this.sub = SB_POP; this.cur = 0; }
        return false;
      }
      case SB_POP: {
        // coarse supply ratio: CS job capacity x RES_PER_CS_JOB / residents, blurred over 3x3 blocks
        if (this.cur === 0) {
          if (this.shopCs.length !== nb * nb) { this.shopCs = new Float32Array(nb * nb); this.shopPop = new Float32Array(nb * nb); this.shopBoxTmp = new Float32Array(nb * nb); }
          this.shopCs.fill(0);
          this.shopPop.fill(0);
        }
        const z1 = Math.min(N, this.cur + rows(SC.shopBlock));
        shopPopRows(this.shopPop, this.need[0], N, B, nb, this.cur, z1);
        this.cur = z1;
        if (z1 >= N) { this.sub = SB_CS; this.cur = 0; }
        return false;
      }
      case SB_CS: {
        const e = Math.min(this.snap.n, this.cur + bldUnits(SC.shopCs));
        this.shopCsRange(st, this.cur, e);
        this.cur = e;
        if (e >= this.snap.n) { this.sub = SB_BOX; this.cur = 0; }
        return false;
      }
      case SB_BOX: {
        const cs = this.shopCs, pop = this.shopPop;
        box3(cs, nb, this.shopBoxTmp); box3(pop, nb, this.shopBoxTmp);
        const ratio = cs;
        for (let q = 0; q < nb * nb; q++) ratio[q] = Math.min(1, (cs[q] * RES_PER_CS_JOB) / (pop[q] + 1));
        const capQ = SHOP_CAP_CELLS * 4;
        // distance score LUT (quarter-cell integer distances) and per-column bilinear taps into the coarse ratio grid
        if (this.shopLut.length !== capQ + 1) {
          this.shopLut = new Float32Array(capQ + 1);
          for (let q = 0; q <= capQ; q++) this.shopLut[q] = 1 - smoothstep(SHOP_NEAR, SHOP_FAR, q / 4);
        }
        if (this.colX0.length !== N) { this.colX0 = new Int32Array(N); this.colX1 = new Int32Array(N); this.colT = new Float32Array(N); }
        const cx0 = this.colX0, cx1 = this.colX1, ct = this.colT;
        for (let x = 0; x < N; x++) {
          const f = Math.min(nb - 1, Math.max(0, (x + 0.5) / B - 0.5));
          const x0 = Math.floor(f);
          cx0[x] = x0; cx1[x] = Math.min(nb - 1, x0 + 1); ct[x] = f - x0;
        }
        this.sub = SB_OUT;
        this.cur = 0;
        return false;
      }
      case SB_OUT: {
        const z1 = Math.min(N, this.cur + rows(SC.shopOut));
        shopOutRows(this.shopNext, v, this.shopCs, this.shopLut, this.colX0, this.colX1, this.colT, N, B, nb, SHOP_CAP_CELLS * 4, this.cur, z1);
        this.cur = z1;
        if (z1 >= N) this.sub = SB_PUBLISH;
        return false;
      }
      default:
        st.shopAccess.set(this.shopNext.subarray(0, C));
        return true;
    }
  }

  /** shopB's CS job capacity per coarse block, snapshot buildings [b0, b1) */
  private shopCsRange(st: CityState, b0: number, b1: number): void {
    const N = st.size;
    const B = CLUSTER_BLOCK;
    const nb = Math.ceil(N / B);
    const cs = this.shopCs;
    const bL = this.snap.list;
    for (let bI = b0; bI < b1; bI++) {
      const b = bL[bI];
      const inf = infoOf(st, b);
      if (inf.fam !== Fam.C || inf.dev < DevType.CS1 || inf.dev > DevType.CS3 || !isFunctional(b)) continue;
      const x = Math.min(N - 1, b.x + (b.w >> 1)), z = Math.min(N - 1, b.z + (b.d >> 1));
      cs[((z / B) | 0) * nb + ((x / B) | 0)] += b.capacity;
    }
  }

  // ------------------------------------------------------------------------------------------------ footprints / finish
  /** the whole footprint state in one go (pre-B2 name and semantics) */
  private footprints(st: CityState): void {
    if (this.stepIdx !== S_FOOT) this.nextState(S_FOOT);
    while (!this.footPiece({ state: st } as Simulation)) { /* pieces */ }
  }

  /**
   * uniform transit coverage over building footprints (max over the footprint). The tier layers are uniform per lot
   * already (each slot's final items apply the footprint max before its publish, and empty slots are all 0); the transit
   * layer gets the stop coverage composed after its slot (S_STOPS), so it is the one layer left. (WP6b: redoing every tier
   * here gave the same layers and a step estimate of 4.5 ms on the 1.5M bot city, over the 3 ms step budget.) B2: on a
   * byte copy of transitCov by lots, published by .set().
   */
  private footPiece(sim: Simulation): boolean {
    const st = sim.state;
    const N = st.size, C = st.cells;
    switch (this.sub) {
      case 0:
        if (!(this.hadFac[SLOT_TRANSIT] || (this.stops?.n ?? 0) > 0)) return true;
        this.finBuf.set(st.transitCov.subarray(0, C));
        this.sub = 1;
        this.cur = 0;
        return false;
      case 1: {
        const q = lotMaxRange(this.finBuf, N, this.multiRect, this.multi.length, this.cur, pieceBudgetUs(COLD), SC.foot, this.lotOut);
        this.cur = q;
        if (q >= this.multi.length) this.sub = 2;
        return false;
      }
      default:
        st.transitCov.set(this.finBuf.subarray(0, C));
        return true;
    }
  }

  /** the whole finish state in one go (pre-B2 name and semantics) */
  private finish(sim: Simulation, first: boolean): void {
    if (this.stepIdx !== S_FINISH) this.nextState(S_FINISH);
    this.firstPass = first;
    while (!this.finishPiece(sim)) { /* pieces */ }
  }

  /**
   * last state: legacy combos (rows into private buffers, then their publish), the per-tier stats.needs pass (rows),
   * stats.needs, stale facility records (id ranges), the EQ / HQ fallback (snapshot chunks), then the end: EQ / HQ,
   * layerUpdated. True when done.
   */
  private finishPiece(sim: Simulation): boolean {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const rows = (us: number) => Math.max(1, Math.floor(cellUnits(us) / Math.max(1, N)));
    for (;;) {
      switch (this.sub) {
        case FI_COMBO: {
          // legacy layers for untouched consumers
          const z1 = Math.min(N, this.cur + rows(SC.combo));
          comboRange(st.eduElemCov, st.eduHighCov, st.eduCollegeCov, st.playCov, st.greenCov, this.eduNext, this.parkNext, this.cur * N, z1 * N);
          this.cur = z1;
          if (z1 >= N) this.sub = FI_COMBO_PUB;
          return false;
        }
        case FI_COMBO_PUB:
          st.eduCov.set(this.eduNext.subarray(0, C));
          st.parkCov.set(this.parkNext.subarray(0, C));
          this.sub = FI_TIERS;
          this.cur = 0;
          this.cur2 = 0;
          this.fiServed = 0; this.fiUnreached = 0;
          return false;
        case FI_TIERS: {
          // stats.needs — per building: the footprint pass made each lot's coverage uniform, so the back rows of deep lots
          // (no road within one cell: never reached per cell) count as served / reached with their front door (WP6a probe)
          let k = this.cur2;
          while (k < NT) {
            if (!this.hadFac[k]) { k++; continue; }
            const needL = this.provNeed[k] ?? this.need[NEED_RASTER[k]];
            if (!needL || needL.length !== C) { k++; continue; }
            break;
          }
          this.cur2 = k;
          if (k >= NT) { this.sub = FI_NEEDS; continue; }
          const needL = this.provNeed[k] ?? this.need[NEED_RASTER[k]];
          const z1 = Math.min(N, this.cur + rows(SC.tierStat));
          const acc = this.finAcc;
          acc[0] = this.fiServed; acc[1] = this.fiUnreached;
          finishStatsRange(needL, tierLayer(st, NEED_ORDER[k]), acc, this.cur * N, z1 * N);
          this.fiServed = acc[0]; this.fiUnreached = acc[1];
          this.cur = z1;
          if (z1 >= N) {
            this.tierStats[k].served = this.fiServed;
            this.tierStats[k].unreached = this.fiUnreached;
            this.cur = 0;
            this.cur2 = k + 1;
            this.fiServed = 0; this.fiUnreached = 0;
          }
          return false;
        }
        case FI_NEEDS:
          // (stats.needs is written in the end piece, with stats.eq / hq: saved data that changed within one pre-B2 step
          // changes within one piece, R9; nothing in between reads it)
          this.sub = FI_STALE;
          this.cur = 0;
          continue;
        case FI_STALE: {
          // facilities not processed this pass (removed / no longer a tier facility) drop out of facilityLoad
          const n = Math.min(this.tierById.length, this.seenById.length);
          const id1 = Math.min(n, this.cur + cellUnits(SC.stale));
          staleRange(this.tierById, this.seenById, this.passNo, this.cur, id1);
          this.cur = id1;
          if (id1 >= n) { this.sub = FI_EQHQ; this.cur = 0; this.eqPop = 0; this.eqEdu = 0; this.eqHealth = 0; this.eqAir = 0; this.eqWp1 = false; }
          return false;
        }
        case FI_EQHQ: {
          const bI = this.eqhqRange(st, this.cur, Math.min(this.snap.n, this.cur + bldUnits(SC.eqhq)));
          this.cur = bI;
          if (this.eqWp1 || bI >= this.snap.n) this.sub = FI_END;
          return false;
        }
        default: {
          const stats = st.stats;
          const needs = stats.needs as Record<NeedTier, NeedStat> | undefined;
          if (needs) {
            for (let k = 0; k < NT; k++) {
              const t = NEED_ORDER[k];
              const src = this.tierStats[k];
              const dst = needs[t] ?? (needs[t] = { need: 0, served: 0, capacity: 0, unreached: 0, overcrowded: 0 });
              dst.need = Math.round(src.need);
              dst.served = Math.round(src.served);
              dst.capacity = Math.round(src.capacity);
              dst.unreached = Math.round(src.unreached);
              dst.overcrowded = src.overcrowded;
            }
          }
          const dtDays = Math.max(0, st.day - this.lastEqDay);
          this.lastEqDay = st.day;
          const popSum = this.eqPop;
          let eduA = this.eqEdu, health = this.eqHealth, air = this.eqAir;
          if (!this.eqWp1 && popSum > 0 && !this.firstPass && dtDays > 0) {
            eduA /= popSum; health /= popSum; air /= popSum;
            const eqT = Math.min(150, 25 + 125 * eduA);
            const hqT = Math.min(150, Math.max(0, (30 + 120 * health) * (1 - 0.35 * air)));
            stats.eq += (eqT - stats.eq) * (1 - Math.exp(-dtDays / (EQ_TAU_YEARS * 360)));
            stats.hq += (hqT - stats.hq) * (1 - Math.exp(-dtDays / (HQ_TAU_YEARS * 360)));
          }
          this.donePasses++;
          sim.events.emit('layerUpdated', 'services');
          sim.events.emit('layerUpdated', 'catchments');
          return true;
        }
      }
    }
  }

  /**
   * the EQ / HQ legacy fallback over the snapshot buildings [b0, b1) (WP1 owns them once buildings carry the education
   * stock b.edu: the first such home ends the loop); returns the next building
   */
  private eqhqRange(st: CityState, b0: number, b1: number): number {
    const N = st.size;
    const E = st.eduElemCov, H = st.eduHighCov, K = st.eduCollegeCov;
    let popSum = this.eqPop, eduA = this.eqEdu, health = this.eqHealth, air = this.eqAir;
    const bL = this.snap.list;
    let bI = b0;
    for (; bI < b1; bI++) {
      const b = bL[bI];
      if (b.pop <= 0) continue;
      if (infoOf(st, b).fam !== Fam.R) continue;
      if (b.edu !== undefined) { this.eqWp1 = true; break; }
      const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
      popSum += b.pop;
      eduA += b.pop * (1 - (1 - E[i]) * (1 - H[i]) * (1 - K[i]));
      health += b.pop * st.healthCov[i];
      air += b.pop * st.airPollution[i];
    }
    this.eqPop = popSum; this.eqEdu = eduA; this.eqHealth = health; this.eqAir = air;
    return bI;
  }

  /** coarse CLUSTER_BLOCK blocks: need x (1 - cov) where cov < CLUSTER_COV, need-weighted centroid, top 16 */
  private computeClusters(st: CityState, k: number): UnservedCluster[] {
    const N = st.size;
    const B = CLUSTER_BLOCK;
    const nb = Math.ceil(N / B);
    const needL = this.provNeed[k] ?? this.need[NEED_RASTER[k]];
    if (!needL || needL.length !== st.cells) return [];
    const cov = tierLayer(st, NEED_ORDER[k]);
    const people = new Float32Array(nb * nb), sx = new Float32Array(nb * nb), sz = new Float32Array(nb * nb);
    for (let z = 0; z < N; z++) {
      const row = z * N, brow = ((z / B) | 0) * nb;
      for (let x = 0; x < N; x++) {
        const i = row + x;
        const n = needL[i];
        if (n <= 0) continue;
        const c = cov[i];
        if (c >= CLUSTER_COV) continue;
        const u = n * (1 - c);
        const q = brow + ((x / B) | 0);
        people[q] += u; sx[q] += u * x; sz[q] += u * z;
      }
    }
    const out: UnservedCluster[] = [];
    for (let q = 0; q < nb * nb; q++) {
      const p = people[q];
      if (p < 1) continue;
      if (out.length === 16 && p <= out[15].people) continue;
      const c: UnservedCluster = { x: Math.round(sx[q] / p), z: Math.round(sz[q] / p), people: Math.round(p) };
      let j = out.length < 16 ? out.length : 15;
      if (out.length < 16) out.push(c); else out[15] = c;
      while (j > 0 && out[j - 1].people < out[j].people) { const t = out[j - 1]; out[j - 1] = out[j]; out[j] = t; j--; }
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------ public queries
  /** facility load of a tier building (catchments.facilityLoad) */
  facilityLoadOf(st: CityState, id: number): FacilityLoad | null {
    if (id < 0 || id >= this.tierById.length) return null;
    const t = this.tierById[id] - 1;
    if (t < 0) return null;
    const b = st.buildings.get(id);
    if (!b) return null;
    const inf = infoOf(st, b);
    if (inf.tier !== t) return null;
    const tier = SERVICE_TIERS[t];
    return {
      tier, needTier: TIER_NEED[tier], capacity: this.capById[id], demand: this.demById[id], utilization: this.utilById[id],
      served: this.servById[id], seated: this.seatById[id], operating: this.opById[id], powered: this.powById[id] === 1,
      radius: inf.tierRadius, metric: REACH_METRICS[inf.metric] ?? 'walk',
    };
  }

  /** top unserved clusters of a need tier (catchments.unservedClusters); computed on demand, cached per pass */
  clustersOf(tier: NeedTier, max = 5): UnservedCluster[] {
    const k = NEED_ORDER.indexOf(tier);
    if (k < 0 || !this.lastState || this.need.length === 0) return [];
    if (this.clusterPass[k] !== this.donePasses) {
      this.clusters[k] = this.computeClusters(this.lastState, k);
      this.clusterPass[k] = this.donePasses;
    }
    return this.clusters[k].slice(0, Math.max(0, max)).map((c) => ({ ...c }));
  }

  /** need raster (people / tier units per cell) of a need tier from the last pass — read-only (WP5 / WP7) */
  needRaster(tier: NeedTier): Float32Array | null {
    const k = NEED_ORDER.indexOf(tier);
    if (k < 0 || this.need.length === 0) return null;
    return this.provNeed[k] ?? this.need[NEED_RASTER[k]];
  }
}

// ------------------------------------------------------------------------------------------------ B2 piece loops
// (design R10: every loop of a piece is a function of its own, so a deopt of a Building loop never drags a cell loop of
// the same dispatcher into the interpreter)

/** a[i0, i1) summed onto `acc` in index order (a double) */
function sumRange(a: Float32Array, acc: number, i0: number, i1: number): number {
  for (let i = i0; i < i1; i++) acc += a[i];
  return acc;
}

/** road cells (network 1..5) in [i0, i1), added to n */
function countRoads(net: Uint8Array, n: number, i0: number, i1: number): number {
  for (let i = i0; i < i1; i++) { const t = net[i]; if (t >= 1 && t <= 5) n++; }
  return n;
}

/** the final clamp of a tier slot over [i0, i1): buf = min(cov, 1) */
function clampRange(cov: Float32Array, buf: Float32Array, i0: number, i1: number): void {
  for (let i = i0; i < i1; i++) { const v = cov[i]; buf[i] = v < 1 ? v : 1; }
}

/** a tier slot's stats over [i0, i1) onto acc = [need, served, unreached] (doubles, index order) */
function tierStatsRange(needL: Float32Array, buf: Float32Array, A: Float32Array, acc: Float64Array, i0: number, i1: number): void {
  let need = acc[0], served = acc[1], unreached = acc[2];
  for (let i = i0; i < i1; i++) {
    const n = needL[i];
    if (n <= 0) continue;
    need += n;
    served += n * buf[i];
    if (A[i] <= 0) unreached += n;
  }
  acc[0] = need; acc[1] = served; acc[2] = unreached;
}

/** the stop coverage composed onto T over [i0, i1) (cells with t <= 0 keep their bits) */
function composeRange(T: Float32Array, tmp: Float32Array, i0: number, i1: number): void {
  for (let i = i0; i < i1; i++) { const t = tmp[i]; if (t > 0) T[i] = 1 - (1 - T[i]) * (1 - Math.min(1, t)); }
}

/** accessCommute's init over [i0, i1): road cells with a label -> minutes, everything else INF */
function accInitRange(v: Float32Array, net: Uint8Array, dist: Int32Array, inf: number, i0: number, i1: number): void {
  for (let i = i0; i < i1; i++) { const t = net[i]; v[i] = t >= 1 && t <= 5 && dist[i] >= 0 ? dist[i] * TIME_Q : inf; }
}

/** accessCommute's output over [i0, i1): reached cells keep their minutes, the rest the unreached value */
function accOutRange(out: Float32Array, v: Float32Array, inf: number, unreached: number, i0: number, i1: number): void {
  for (let i = i0; i < i1; i++) out[i] = v[i] < inf * 0.5 ? v[i] : unreached;
}

/** shopAccess's init over [i0, i1): road cells with a distance keep it, everything else INF */
function shopInitRange(v: Float32Array, net: Uint8Array, d: Int32Array, inf: number, i0: number, i1: number): void {
  for (let i = i0; i < i1; i++) { const t = net[i]; v[i] = t >= 1 && t <= 5 && d[i] >= 0 ? d[i] : inf; }
}

/** shopAccess's residents per coarse block, rows [z0, z1) */
function shopPopRows(pop: Float32Array, res: Float32Array, N: number, B: number, nb: number, z0: number, z1: number): void {
  for (let z = z0; z < z1; z++) { const bz = (z / B) | 0; for (let x = 0; x < N; x++) { const r = res[z * N + x]; if (r > 0) pop[bz * nb + ((x / B) | 0)] += r; } }
}

/** shopAccess's bilinear output, rows [z0, z1) */
function shopOutRows(out: Float32Array, v: Float32Array, ratio: Float32Array, lut: Float32Array, cx0: Int32Array, cx1: Int32Array, ct: Float32Array,
  N: number, B: number, nb: number, capQ: number, z0r: number, z1r: number): void {
  for (let z = z0r; z < z1r; z++) {
    const fz = Math.min(nb - 1, Math.max(0, (z + 0.5) / B - 0.5));
    const z0 = Math.floor(fz), tz = fz - z0;
    const r0 = z0 * nb, r1 = Math.min(nb - 1, z0 + 1) * nb;
    const row = z * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
      const q = v[i];
      if (!(q <= capQ)) { out[i] = 0; continue; }
      const tx = ct[x], a = cx0[x], c = cx1[x];
      const r = (ratio[r0 + a] + (ratio[r0 + c] - ratio[r0 + a]) * tx) * (1 - tz) + (ratio[r1 + a] + (ratio[r1 + c] - ratio[r1 + a]) * tx) * tz;
      out[i] = lut[q | 0] * (SHOP_BASE + (1 - SHOP_BASE) * r);
    }
  }
}

/** the legacy combos over [i0, i1) into edu / park */
function comboRange(E: Float32Array, H: Float32Array, K: Float32Array, P: Float32Array, G: Float32Array, edu: Float32Array, park: Float32Array,
  i0: number, i1: number): void {
  const [we, wh, wc] = EDU_LEGACY_W;
  for (let i = i0; i < i1; i++) {
    const v = we * E[i] + wh * H[i] + wc * K[i];
    edu[i] = v < 1 ? v : 1;
    park[i] = 1 - (1 - P[i]) * (1 - G[i]);
  }
}

/** finish's per-tier stats over [i0, i1) onto acc = [served, unreached] (doubles, index order) */
function finishStatsRange(needL: Float32Array, layer: Float32Array, acc: Float64Array, i0: number, i1: number): void {
  let served = acc[0], unreached = acc[1];
  for (let i = i0; i < i1; i++) { const n = needL[i]; if (n <= 0) continue; const v = layer[i]; served += n * v; if (v <= 0) unreached += n; }
  acc[0] = served; acc[1] = unreached;
}

/**
 * the max over each lot's footprint, written back over it (the per-tier / transit footprint max), for the lots q0.. of
 * `rect` (x0, z0, x1, z1 per lot, clipped to the map): lots while their units (cells x perCell) fit in `room` (at least
 * one); returns the next lot, out[0] = the units used
 */
function lotMaxRange(L: Float32Array, N: number, rect: Int32Array, nLots: number, q0: number, room: number, perCell: number, out: Float64Array): number {
  let used = 0, q = q0;
  for (; q < nLots; q++) {
    const x0 = rect[4 * q], z0 = rect[4 * q + 1], x1 = rect[4 * q + 2], z1 = rect[4 * q + 3];
    const u = Math.max(1, x1 - x0) * Math.max(1, z1 - z0) * perCell;
    if (used > 0 && used + u > room) break;
    used += u;
    lotFill(L, N, x0, z0, x1, z1, lotMax(L, N, x0, z0, x1, z1));
  }
  out[0] = used;
  return q;
}
/** the max of L over a lot (one loop per function, R10: G2 traced lotMaxRange deoptimising in its OSR code on the never
 *  executed fill loop after the max loop, ten times in a load's first pass) */
function lotMax(L: Float32Array, N: number, x0: number, z0: number, x1: number, z1: number): number {
  let m = 0;
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { const v = L[z * N + x]; if (v > m) m = v; }
  return m;
}
/** v over a lot */
function lotFill(L: Float32Array, N: number, x0: number, z0: number, x1: number, z1: number, v: number): void {
  for (let z = z0; z < z1; z++) L.fill(v, z * N + x0, z * N + x1);
}

/** the stale-record clear over ids [i0, i1) */
function staleRange(tb: Float32Array, seen: Float32Array, pass: number, i0: number, i1: number): void {
  for (let id = i0; id < i1; id++) if (tb[id] > 0 && seen[id] !== pass) tb[id] = 0;
}

/** corridorHash over net[i0, i1) from h (the whole hash: one range [0, net.length) from 0x2545f491) */
function corridorHashRange(st: CityState, h: number, i0: number, i1: number): number {
  const net = st.network, fl = st.netFlags;
  for (let i = i0; i < i1; i++) {
    const t = net[i];
    if (t !== Network.Highway && t !== Network.Rail) continue;
    h = Math.imul(h ^ (i * 16 + t * 4 + (fl[i] & 3)), 16777619) ^ (h >>> 15);
  }
  return h;
}

/** hashBytes' word rounds over a[i0, i1) (4 bytes per round; i0, i1 multiples of 4 up to a.length & ~3) */
function hashWords(a: Uint8Array, h: number, i0: number, i1: number): number {
  for (let i = i0; i < i1; i += 4) {
    const v = a[i] | (a[i + 1] << 8) | (a[i + 2] << 16) | (a[i + 3] << 24);
    h = Math.imul(h ^ v, 16777619) ^ (h >>> 13);
  }
  return h;
}
/** hashBytes' tail (the last a.length % 4 bytes) */
function hashTail(a: Uint8Array, h: number): number {
  for (let i = a.length & ~3; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619);
  return h;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 3x3 box blur on an n x n grid in place (zero boundary); `t` = n x n scratch (pre-B2: allocated per call) */
function box3(a: Float32Array, n: number, t: Float32Array): void {
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    let s = a[z * n + x];
    if (x > 0) s += a[z * n + x - 1];
    if (x < n - 1) s += a[z * n + x + 1];
    t[z * n + x] = s / 3;
  }
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    let s = t[z * n + x];
    if (z > 0) s += t[(z - 1) * n + x];
    if (z < n - 1) s += t[(z + 1) * n + x];
    a[z * n + x] = s / 3;
  }
}

/**
 * the two-pass chamfer (4-neighbour) over non-road cells: v = min(v, neighbour + step); road cells (net 1..5) keep their
 * value and act as sources. Values >= inf are "unset". B2: the forward sweep over rows [z0, z1) (ascending) and the
 * backward sweep over rows [z0, z1) (descending). Each sweep reads only rows it finished (and road cells, which it never
 * writes), so consecutive row ranges — forward from 0, backward from N — give exactly the pre-B2 chamfer(v, N, net, step, inf).
 */
function chamferForward(v: Float32Array, N: number, net: Uint8Array, step: number, inf: number, z0: number, z1: number): void {
  for (let z = z0; z < z1; z++) {
    const row = z * N;
    for (let x = 0; x < N; x++) {
      const i = row + x;
      const t = net[i];
      if (t >= 1 && t <= 5) continue;
      let m = v[i];
      if (x > 0) { const a = v[i - 1] + step; if (a < m) m = a; }
      if (z > 0) { const a = v[i - N] + step; if (a < m) m = a; }
      if (x < N - 1) { const t2 = net[i + 1]; if (t2 >= 1 && t2 <= 5) { const a = v[i + 1] + step; if (a < m) m = a; } }
      if (z < N - 1) { const t2 = net[i + N]; if (t2 >= 1 && t2 <= 5) { const a = v[i + N] + step; if (a < m) m = a; } }
      v[i] = m < inf ? m : inf;
    }
  }
}
function chamferBackward(v: Float32Array, N: number, net: Uint8Array, step: number, inf: number, z0: number, z1: number): void {
  for (let z = z1 - 1; z >= z0; z--) {
    const row = z * N;
    for (let x = N - 1; x >= 0; x--) {
      const i = row + x;
      const t = net[i];
      if (t >= 1 && t <= 5) continue;
      let m = v[i];
      if (x < N - 1) { const a = v[i + 1] + step; if (a < m) m = a; }
      if (z < N - 1) { const a = v[i + N] + step; if (a < m) m = a; }
      v[i] = m < inf ? m : inf;
    }
  }
}
