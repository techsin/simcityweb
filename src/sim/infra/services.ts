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
 * NIMBY building change, power flip or road change):
 *   prep (need rasters, facility lists, op factors) -> tiers police .. green + transit (bounded steps of
 *   WORK_PER_STEP work units: reach (cached / searched), seat allocation in seat order, crowded-facility demand,
 *   finalize) -> transit stops -> NIMBY (every 2nd pass unless a NIMBY source building or a highway / rail cell
 *   changed) -> access commute (seeds, search, land; every ACCESS_PERIOD days or after a network change) -> access
 *   shops (search, land) -> footprints (uniform coverage over large buildings; layers of empty slots skipped) ->
 *   finish (legacy combos, stats.needs, EQ / HQ fallback). Unserved clusters are computed on demand.
 *   Emits layerUpdated('services') and layerUpdated('catchments').
 */
import type { Building, CityState, NeedStat, NeedTier } from '../CityState';
import { BF } from '../CityState';
import type { ServiceKind } from '../catalogTypes';
import type { SimSystem, Simulation } from '../Simulation';
import type { CellRect } from '../../core/events';
import { DevType, Network } from '../../core/types';
import {
  COV_KINDS, Fam, REACH_METRICS, SERVICE_TIERS, buildingList, ensureIdFloat, fundingFactor, infoOf, isFunctional, jobSlots,
  nowMs, readEffects, wealthOf, type DefInfo, type OrdEffects,
} from './common';
import {
  ACCESS_JOB_EXTRA, ACCESS_JOB_SLOTS, ACCESS_LAND_STEP, ACCESS_PERIOD, ACCESS_UNREACHED, CAR_OVERHEAD, CATCH_COLLEGE_WILL,
  CLUSTER_BLOCK, CLUSTER_COV, COLLEGE_ADULT_W, EDU_LEGACY_W, EQ_TAU_YEARS, GREEN_NEED_BASE, GREEN_NEED_NORM,
  GREEN_NEED_SENIOR, HEALTH_NEED_NORM, HEALTH_NEED_W, HQ_TAU_YEARS, MAX_COMMUTE, NET_TIME, OVERCROWDED_UTIL, PLAY_TEEN_W,
  RAMP_PENALTY, RES_PER_CS_JOB, ROAD_RADIUS_FACTOR, SHOP_BASE, SHOP_CAP_CELLS, SHOP_FAR, SHOP_NEAR, UNPOWERED_SERVICE_EFF,
  UNWATERED_HEALTH_EFF,
} from './params';
import { schedulerOf, sizeFactors } from './scheduler';
import { collectStops, computeTransitCoverage, type StopList } from './transit';
import { getDef } from '../catalog';
import {
  NEED_ORDER, TIER_NEED, TIME_Q, reachRaw, reachResult, roadDistMulti, roadTimeMulti, tierLayer, tierProvider,
  type FacilityLoad,
} from './catchments';
import { nimbyCost, rebuildNimby } from './nimby';
import { cohortShares } from '../economy/demographics';
import { justiceFactors } from './justice';
import { facilityOpFactor } from './facilities';
import type { TrafficSystem } from './traffic';

export const SERVICES_PERIOD = 15;
/** a new / removed service building or road change is reflected within this many days */
export const SERVICES_DIRTY_DAYS = 2;
/** work units processed per tier step (bounds step cost: ~2.1 ms measured on the 256² stress city) */
const WORK_PER_STEP = 120000;
/** work units: per cell reached by a fresh search, per cached reach entry copied, per entry allocated / splatted */
const U_SEARCH = 3.6, U_COPY = 0.1, U_ENTRY = 0.25;
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

/** road-cell free-flow minutes (TIME_Q units) per Network for accessCommute (roads only) */
const NET_TIME_Q: readonly number[] = NET_TIME.map((t, k) => (k >= 1 && k <= 5 ? Math.max(1, Math.round(t / TIME_Q)) : 0));
const RAMP_Q = Math.round(RAMP_PENALTY / TIME_Q);

export interface UnservedCluster { x: number; z: number; people: number }

/** a cached reach of one facility: pool range + bounding box of the reached cells */
interface CacheEnt { key: number; start: number; end: number; x0: number; z0: number; x1: number; z1: number; road: boolean; valid: boolean }
interface SlotCache { idx: Int32Array<ArrayBuffer>; w: Float32Array<ArrayBuffer>; ent: Map<number, CacheEnt> }

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
  private unsub: (() => void)[] = [];

  // pass inputs
  private fac: Building[][] = Array.from({ length: NT + 1 }, () => [] as Building[]);
  private facOp: number[][] = Array.from({ length: NT + 1 }, () => [] as number[]);
  private facCap: number[][] = Array.from({ length: NT + 1 }, () => [] as number[]);
  private facStart: number[] = [];
  private facEnd: number[] = [];
  /** current shared slot, per facility: seated fraction of its claims, seats taken */
  private facSig: number[] = [];
  private facSeat: number[] = [];
  /** seat order of the current shared slot (facility indices, best op first, then building id) */
  private order = new Int32Array(0);
  private shared: boolean[] = new Array(NT + 1).fill(false);
  /** slot had facilities in the previous pass (an empty slot's layer is already 0) */
  private hadFac: boolean[] = new Array(NT + 1).fill(true);
  private multi: Building[] = [];
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

  init(sim: Simulation): void {
    for (const u of this.unsub) u();
    // a new / removed service / NIMBY building, a power flip or a road change shows within SERVICES_DIRTY_DAYS
    const relevant = (b: { def: string }) => {
      const d = getDef(b.def);
      return !!d && (!!d.coverage || d.category === 'park' || d.category === 'transport' || !!d.stigma || !!d.prestige || !!d.campus);
    };
    const nimbySrc = (b: { def: string }) => { const d = getDef(b.def); return !!d && (!!d.stigma || !!d.prestige || !!d.campus); };
    const markB = (b: { def: string }) => {
      if (relevant(b)) this.dirty = true;
      if (nimbySrc(b)) this.nimbyDirty = true;
    };
    const markC = (b: { def: string; flags: number }) => {
      if (relevant(b)) this.dirty = true;
      if (nimbySrc(b)) this.nimbyDirty = true;
    };
    this.unsub = [
      sim.events.on('buildingAdded', markB),
      sim.events.on('buildingRemoved', markB),
      sim.events.on('buildingChanged', markC),
      // NIMBY only depends on highway / rail cells of the network: prep compares their hash (corridorHash)
      sim.events.on('networkChanged', (r) => {
        this.dirty = true; this.accessDirty = true;
        this.invalidateReach(r);
      }),
    ];
    sim.state.systemData.infraVersion = 1;
    this.lastRun = -1e9;
    this.lastAccess = -1e9;
    this.accessDirty = true;
    this.nimbyDirty = true;
    this.lastEqDay = sim.state.day;
    this.stepIdx = -1;
    this.cache = new Array(NT + 1).fill(null);
    this.hadFac = new Array(NT + 1).fill(true);
    this.netEvents = false;
    this.compute(sim, true);
    const self = this;
    schedulerOf(sim).register({
      name: 'services',
      due: (s) => self.due(s),
      urgent: () => false,
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

  private due(sim: Simulation): boolean {
    if (this.stepIdx >= 0) return true;
    const d = sim.state.day - this.lastRun;
    return d >= SERVICES_PERIOD || (this.dirty && d >= SERVICES_DIRTY_DAYS);
  }

  /** estimated ms of the next step (deterministic: from problem sizes; calibrated on the 256² stress city) */
  private stepCost(sim: Simulation): number {
    const { cells, bld } = sizeFactors(sim);
    const roads = this.roadCells / 36000;
    switch (this.stepIdx) {
      case -1: case S_PREP: return 0.2 + 1.1 * bld + 0.5 * cells;
      case S_TIERS: return 0.1 + 2.2 * Math.max(0.25, Math.min(1, this.workLeft / WORK_PER_STEP));
      case S_STOPS: return 0.1 + 0.3 * bld + 0.9 * cells;
      case S_NIMBY: return nimbyCost(sim);
      case S_ACC_SEED: return 0.2 + 1.3 * bld + 0.2 * cells;
      case S_ACC_SEARCH: return 0.2 + 2.2 * roads + 0.2 * cells;
      case S_ACC_LAND: return 0.2 + 0.6 * bld + 1.6 * cells;
      case S_SHOP_A: return 0.2 + 0.3 * bld + 1.3 * roads;
      case S_SHOP_B: return 0.2 + 0.4 * bld + 1.7 * cells;
      case S_FOOT: {
        let L = this.hadFac[SLOT_TRANSIT] || (this.stops?.n ?? 0) > 0 ? 1 : 0;
        for (let k = 0; k < NT; k++) if (this.hadFac[k]) L++;
        return 0.1 + 0.3 * bld + 0.9 * (this.multi.length / 2000) * (L / 9);
      }
      default: return 0.2 + 0.5 * bld + 0.6 * cells;
    }
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

  /** one step of the coverage pass */
  step(sim: Simulation): void {
    const t0 = nowMs();
    if (this.stepIdx < 0) this.stepIdx = S_PREP;
    switch (this.stepIdx) {
      case S_PREP:
        this.prep(sim);
        this.stepIdx = S_TIERS;
        break;
      case S_TIERS:
        this.tierWork(sim);
        break;
      case S_STOPS:
        this.finishTransit(sim);
        this.stepIdx = this.doNimby ? S_NIMBY : this.doAccess ? S_ACC_SEED : S_FOOT;
        break;
      case S_NIMBY:
        rebuildNimby(sim);
        this.stepIdx = this.doAccess ? S_ACC_SEED : S_FOOT;
        break;
      case S_ACC_SEED:
        this.accessCommuteSeeds(sim);
        this.stepIdx = S_ACC_SEARCH;
        break;
      case S_ACC_SEARCH:
        roadTimeMulti(sim.state, this.idist, Math.round((MAX_COMMUTE + 60) / TIME_Q), NET_TIME_Q, RAMP_Q);
        this.stepIdx = S_ACC_LAND;
        break;
      case S_ACC_LAND:
        this.accessCommuteLand(sim);
        this.stepIdx = S_SHOP_A;
        break;
      case S_SHOP_A:
        roadDistMulti(sim.state, 1, this.csSeeds, this.nCsSeeds, SHOP_CAP_CELLS * 4, this.shopDist);
        this.stepIdx = S_SHOP_B;
        break;
      case S_SHOP_B:
        this.shopLand(sim);
        this.stepIdx = S_FOOT;
        break;
      case S_FOOT:
        this.footprints(sim.state);
        this.stepIdx = S_FINISH;
        break;
      default:
        this.finish(sim, this.firstPass);
        this.stepIdx = -1;
        this.firstPass = false;
    }
    this.lastMs = nowMs() - t0;
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

  /**
   * network hash: detects edits that bypass networkChanged (tests, tools) -> drop every road reach; water hash:
   * terraforming moves shores (the walk / drive near field stops at unbridged water) -> drop every road reach
   */
  private checkNetwork(st: CityState): void {
    const h = hashBytes(st.network, st.cells), wh = hashBytes(st.water, st.cells);
    if ((h !== this.netHash && !this.netEvents) || wh !== this.waterHash) this.invalidateReach(undefined);
    this.netHash = h;
    this.waterHash = wh;
    this.netEvents = false;
  }

  // ------------------------------------------------------------------------------------------------ prep
  private ensure(C: number): void {
    if (this.C === C) return;
    this.C = C;
    this.need = Array.from({ length: N_RASTERS }, () => new Float32Array(C));
    this.provNeed = new Array(NT).fill(null);
    this.A = new Float32Array(C);
    this.seat = new Float32Array(C);
    this.cov = new Float32Array(C);
    this.tmp = new Float32Array(C);
    this.idist = new Int32Array(C);
    this.shopDist = new Int32Array(C);
    this.cache = new Array(NT + 1).fill(null);
    this.hadFac = new Array(NT + 1).fill(true);
  }

  private prep(sim: Simulation): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    if (this.lastState !== st) { this.lastState = st; this.cache = new Array(NT + 1).fill(null); this.hadFac = new Array(NT + 1).fill(true); }
    this.lastRun = st.day;
    this.dirty = false;
    this.doAccess = this.firstPass || this.accessDirty || st.day - this.lastAccess >= ACCESS_PERIOD;
    if (this.doAccess) { this.lastAccess = st.day; this.accessDirty = false; }
    this.nimbyAge++;
    const ch = corridorHash(st);
    if (ch !== this.corridorH) { this.corridorH = ch; this.nimbyDirty = true; }
    this.doNimby = this.firstPass || this.nimbyDirty || this.nimbyAge >= 2;
    if (this.doNimby) { this.nimbyAge = 0; this.nimbyDirty = false; }
    this.ensure(C);
    this.checkNetwork(st);
    const need = this.need;
    for (const a of need) a.fill(0);
    const [res, kids, teens, college, health, play, green] = need;
    let sRes = 0, sKid = 0, sTeen = 0, sCol = 0, sHea = 0, sPla = 0, sGre = 0;
    for (const l of this.fac) l.length = 0;
    for (const l of this.facOp) l.length = 0;
    for (const l of this.facCap) l.length = 0;
    this.multi.length = 0;
    this.fx = readEffects(st);
    const policeMul = justiceFactors(st).policeMul;
    this.policeMul = policeMul;
    this.policeFx = this.fx.policeEffect;
    const sh = this.shares;
    let nCs = 0;
    const bL = buildingList(st);
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
    for (let bI = 0; bI < bL.length; bI++) {
      const b = bL[bI];
      if (b.w * b.d > 1) this.multi.push(b);
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
        sRes += per * cells; sKid += k * cells; sTeen += t * cells; sCol += vCol * cells; sHea += vHea * cells; sPla += vPla * cells; sGre += vGre * cells;
        continue;
      }
      if (!isFunctional(b)) continue;
      if (inf.fam === Fam.C && inf.dev >= DevType.CS1 && inf.dev <= DevType.CS3 && b.capacity > 0) nCs = this.pushFrontage(st, b, nCs);
      let slot = -1, R = 0, s = 0;
      if (inf.tier >= 0) { slot = SLOT_OF_TIER[inf.tier]; R = inf.tierRadius; s = inf.tierStrength; }
      else if (inf.cov === 5) { slot = SLOT_TRANSIT; R = inf.covRadius; s = inf.covStrength; }
      if (slot < 0 || !(R > 0) || !(s > 0)) continue;
      const op = this.opOf(st, b, inf, slot, policeMul);
      const prov = slot < NT ? tierProvider(NEED_ORDER[slot]) : undefined;
      let cap = slot === SLOT_TRANSIT ? Infinity : inf.tierCap;
      if (prov?.capacityOf) { const c = prov.capacityOf(st, b); if (c > 0) cap = c; }
      this.fac[slot].push(b);
      this.facOp[slot].push(op);
      this.facCap[slot].push(cap);
    }
    const ns = this.needSum;
    ns[0] = sRes; ns[1] = sKid; ns[2] = sTeen; ns[3] = sCol; ns[4] = sHea; ns[5] = sPla; ns[6] = sGre;
    this.nCsSeeds = nCs;
    // tier modes + provider need rasters (WP7 registerTierProvider)
    for (let k = 0; k < NT; k++) {
      const prov = tierProvider(NEED_ORDER[k]);
      this.shared[k] = prov?.shared ?? k >= 2;
      if (prov?.needOf) {
        let a = this.provNeed[k];
        if (!a) a = this.provNeed[k] = new Float32Array(C);
        a.fill(0);
        prov.needOf(st, res, a);
        let sum = 0;
        for (let i = 0; i < C; i++) sum += a[i];
        this.provSum[k] = sum;
      } else this.provNeed[k] = null;
    }
    this.shared[SLOT_TRANSIT] = false;
    let roads = 0;
    const net = st.network;
    for (let i = 0; i < C; i++) { const t = net[i]; if (t >= 1 && t <= 5) roads++; }
    this.roadCells = roads;
    // work estimate of the tier steps (same units as tierWork's counter; cached reaches are cheap)
    let w = 0;
    for (let k = 0; k <= NT; k++) {
      if (this.fac[k].length === 0) { if (this.hadFac[k] || k === SLOT_TRANSIT) w += C * 0.05; continue; }
      w += C * (this.shared[k] ? 0.45 : 0.3);
      const cache = this.cache[k];
      const perEntry = U_ENTRY * (this.shared[k] ? 3 : 2);
      for (const b of this.fac[k]) {
        const e = cache?.ent.get(b.id);
        if (e && e.key === keyOf(b)) w += (e.end - e.start) * ((e.valid ? U_COPY : U_SEARCH) + perEntry) + 16; // last reach size
        else w += this.workOf(st, b, k);
      }
    }
    this.workLeft = w;
    this.tierSlot = 0;
    this.tierPhase = P_INIT;
    this.cursor = 0;
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
    const inf = infoOf(st, b);
    const metric = slot === SLOT_TRANSIT ? 2 : inf.metric;
    const R = slot === SLOT_TRANSIT ? inf.covRadius : inf.tierRadius;
    const r = metric === 2 ? R + Math.max(b.w, b.d) / 2 : R * ROAD_RADIUS_FACTOR * 0.8;
    const cells = Math.PI * r * r * (metric === 2 ? 1 : 0.5);
    return cells * ((metric === 2 ? U_SEARCH / 2 : U_SEARCH) + U_ENTRY * (this.shared[slot] ? 3 : 2)) + 24;
  }

  // ------------------------------------------------------------------------------------------------ tier engine
  private tierWork(sim: Simulation): void {
    const st = sim.state;
    const C = st.cells;
    let work = 0;
    while (this.stepIdx === S_TIERS && work < WORK_PER_STEP) {
      const k = this.tierSlot;
      if (k > NT) { this.stepIdx = S_STOPS; break; }
      const list = this.fac[k];
      const shared = this.shared[k];
      const needL = k < NT ? this.provNeed[k] ?? this.need[NEED_RASTER[k]] : this.need[0];
      switch (this.tierPhase) {
        case P_INIT: {
          if (list.length === 0) {
            // empty slot: zero the layer (once; the transit layer every pass, finishTransit composes the stop
            // coverage onto it), stats without a cell loop
            if (this.hadFac[k] || k === SLOT_TRANSIT) {
              (k === SLOT_TRANSIT ? st.transitCov : tierLayer(st, NEED_ORDER[k])).fill(0);
              work += C * 0.05; this.workLeft -= C * 0.05;
            }
            this.hadFac[k] = false;
            this.cache[k] = null;
            if (k < NT) {
              const n = this.provNeed[k] ? this.provSum[k] : this.needSum[NEED_RASTER[k]];
              const ts = this.tierStats[k];
              ts.need = n; ts.served = 0; ts.capacity = 0; ts.unreached = n; ts.overcrowded = 0;
            }
            this.tierSlot++;
            break;
          }
          this.hadFac[k] = true;
          this.A.fill(0);
          this.cov.fill(0);
          if (shared) this.seat.fill(1);
          this.poolN = 0;
          this.curEnt = new Map();
          this.facStart.length = 0; this.facEnd.length = 0;
          this.facSig.length = 0; this.facSeat.length = 0;
          this.cursor = 0;
          this.tierPhase = P_SEARCH;
          const w = C * 0.1;
          work += w; this.workLeft -= w;
          break;
        }
        case P_SEARCH: {
          if (this.cursor >= list.length) {
            if (shared) { this.seatOrder(k); this.tierPhase = P_ALLOC; } else this.tierPhase = P_FINAL;
            this.cursor = 0;
            break;
          }
          const c = this.cursor++;
          const b = list[c];
          if (!st.buildings.has(b.id)) { this.facStart[c] = this.facEnd[c] = this.poolN; continue; }
          const u = this.reachOf(st, b, k, c) + (shared ? 0 : this.splatUnion(st, b, k, c, needL));
          work += u; this.workLeft -= u;
          break;
        }
        case P_ALLOC: {
          // shared tiers: facilities take seats in seat order (best op first, then building id)
          if (this.cursor >= list.length) { this.tierPhase = P_REPORT; this.cursor = 0; break; }
          const c = this.order[this.cursor++];
          const u = this.allocSeats(st, list[c], k, c, needL);
          work += u; this.workLeft -= u;
          break;
        }
        case P_REPORT: {
          // shared tiers: demand / utilization of crowded facilities from the need left unseated in their reach
          if (this.cursor >= list.length) { this.tierPhase = P_FINAL; break; }
          const c = this.cursor++;
          const u = this.reportDemand(st, list[c], k, c, needL);
          work += u; this.workLeft -= u;
          break;
        }
        default: {
          this.finalizeTier(st, k, needL);
          // this slot's pool becomes its cache; the old cache buffers are the next slot's pool
          const old = this.cache[k];
          this.cache[k] = { idx: this.pIdx, w: this.pW, ent: this.curEnt };
          if (old) { this.pIdx = old.idx; this.pW = old.w; } else { this.pIdx = new Int32Array(0); this.pW = new Float32Array(0); }
          this.poolN = 0;
          this.curEnt = new Map();
          const w = C * (shared ? 0.3 : 0.2);
          work += w; this.workLeft -= w;
          this.tierSlot++;
          this.tierPhase = P_INIT;
        }
      }
    }
  }

  /** seat order of shared slot k: operating factor descending (better-run facilities fill first), then building id */
  private seatOrder(k: number): void {
    const list = this.fac[k], ops = this.facOp[k];
    const n = list.length;
    if (this.order.length < n) this.order = new Int32Array(Math.max(n, this.order.length * 2, 64));
    const ord = this.order.subarray(0, n);
    for (let c = 0; c < n; c++) ord[c] = c;
    ord.sort((a, b) => ops[b] - ops[a] || list[a].id - list[b].id);
  }

  /** reach of facility c of slot k into the pool (cached copy or fresh search); returns work units */
  private reachOf(st: CityState, b: Building, k: number, c: number): number {
    const key = keyOf(b);
    const cache = this.cache[k];
    const e = cache?.ent.get(b.id);
    const off = this.poolN;
    if (cache && e && e.valid && e.key === key) {
      const n = e.end - e.start;
      this.ensurePool(off + n);
      this.pIdx.set(cache.idx.subarray(e.start, e.end), off);
      this.pW.set(cache.w.subarray(e.start, e.end), off);
      this.poolN = off + n;
      this.facStart[c] = off; this.facEnd[c] = off + n;
      this.curEnt.set(b.id, { key, start: off, end: off + n, x0: e.x0, z0: e.z0, x1: e.x1, z1: e.z1, road: e.road, valid: true });
      return n * U_COPY + 8;
    }
    const inf = infoOf(st, b);
    const transit = k === SLOT_TRANSIT;
    const metric = transit ? 2 : inf.metric;
    const n = reachRaw(st, b.x, b.z, b.w, b.d, transit ? inf.covRadius : inf.tierRadius, metric);
    const { touched, best } = reachResult();
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
    this.curEnt.set(b.id, { key, start: off, end: m, x0, z0, x1, z1, road: metric !== 2, valid: true });
    return n * (metric === 2 ? U_SEARCH / 2 : U_SEARCH) + 16;
  }

  private ensurePool(n: number): void {
    if (this.pIdx.length >= n) return;
    const cap = Math.max(n, this.pIdx.length * 2, 65536);
    const a = new Int32Array(cap); a.set(this.pIdx.subarray(0, this.poolN)); this.pIdx = a;
    const f = new Float32Array(cap); f.set(this.pW.subarray(0, this.poolN)); this.pW = f;
  }

  /** union tier (police / fire / transit): legacy combination from the pool range; returns work units */
  private splatUnion(st: CityState, b: Building, k: number, c: number, needL: Float32Array): number {
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
    if (!transit) this.record(b, inf, S, D, served, op, S < Infinity && D > S ? S : D);
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
    this.record(b, inf, S, D, D * rho, op, seated);
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
    return (s1 - s0) * U_ENTRY + 8;
  }

  private record(b: Building, inf: DefInfo, S: number, D: number, served: number, op: number, seated: number): void {
    const id = b.id;
    if (id >= this.tierById.length) return;
    this.tierById[id] = inf.tier + 1;
    this.seenById[id] = this.passNo;
    this.capById[id] = S;
    this.demById[id] = D;
    this.servById[id] = served;
    this.seatById[id] = seated;
    this.opById[id] = op;
    this.utilById[id] = S < Infinity && S > 0 ? D / S : 0;
    this.powById[id] = !inf.usesPower || (b.flags & BF.Powered) !== 0 ? 1 : 0;
  }

  /** write the tier layer + stats.needs of the slot */
  private finalizeTier(st: CityState, k: number, needL: Float32Array): void {
    const C = st.cells;
    const shared = this.shared[k];
    const layer = k === SLOT_TRANSIT ? st.transitCov : tierLayer(st, NEED_ORDER[k]);
    const A = this.A, cov = this.cov;
    for (let i = 0; i < C; i++) { const v = cov[i]; layer[i] = v < 1 ? v : 1; }
    if (k === SLOT_TRANSIT) return;
    let need = 0, served = 0, unreached = 0;
    for (let i = 0; i < C; i++) {
      const n = needL[i];
      if (n <= 0) continue;
      need += n;
      served += n * layer[i];
      if (A[i] <= 0) unreached += n;
    }
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
    ts.need = need; ts.served = served; ts.capacity = capacity; ts.unreached = unreached; ts.overcrowded = over;
  }

  // ------------------------------------------------------------------------------------------------ transit stops
  /** transit stops coverage (combined with the generic transit coverage) */
  private finishTransit(sim: Simulation): void {
    const st = sim.state;
    const C = st.cells;
    this.stops = collectStops(st, this.stops);
    const tmp = this.tmp;
    computeTransitCoverage(st, this.stops, tmp, Math.min(1.25, fundingFactor(st, 'transit')));
    const T = st.transitCov;
    for (let i = 0; i < C; i++) { const t = tmp[i]; if (t > 0) T[i] = 1 - (1 - T[i]) * (1 - Math.min(1, t)); }
  }

  // ------------------------------------------------------------------------------------------------ access fields
  /** accessCommute step 1: seeds on frontage road cells (homes: their commute; job sites: CAR_OVERHEAD + 2) */
  private accessCommuteSeeds(sim: Simulation): void {
    const st = sim.state;
    const N = st.size;
    const net = st.network;
    const dist = this.idist;
    dist.fill(-1);
    const tr = sim.getSystem<TrafficSystem>('traffic');
    const jobKey = Math.round((CAR_OVERHEAD + ACCESS_JOB_EXTRA) / TIME_Q);
    const maxKey = Math.round(MAX_COMMUTE / TIME_Q);
    const cm = st.commute;
    const bL = buildingList(st);
    for (let bI = 0; bI < bL.length; bI++) {
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

  /** accessCommute step 3: land cells (adjacent road + ACCESS_LAND_STEP per cell), unreached, R footprints */
  private accessCommuteLand(sim: Simulation): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const net = st.network;
    const dist = this.idist;
    const v = this.tmp;
    const INF = 1e9;
    for (let i = 0; i < C; i++) { const t = net[i]; v[i] = t >= 1 && t <= 5 && dist[i] >= 0 ? dist[i] * TIME_Q : INF; }
    chamfer(v, N, net, ACCESS_LAND_STEP, INF);
    const avg = st.stats.avgCommute;
    const unreached = avg > 0 ? ACCESS_UNREACHED * avg : 0;
    const out = st.accessCommute, cm = st.commute;
    for (let i = 0; i < C; i++) out[i] = v[i] < INF * 0.5 ? v[i] : unreached;
    // residential footprints keep their own (traffic) commute
    const bL = buildingList(st);
    for (let bI = 0; bI < bL.length; bI++) {
      const b = bL[bI];
      if (b.pop <= 0 || infoOf(st, b).fam !== Fam.R) continue;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        if (cm[i] > 0) out[i] = cm[i];
      }
    }
  }

  /** shopAccess step 2: land cells, distance score x (base + supply ratio of CS jobs to residents per coarse block) */
  private shopLand(sim: Simulation): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const net = st.network;
    const d = this.shopDist;
    const v = this.tmp;
    const INF = 1e9;
    for (let i = 0; i < C; i++) { const t = net[i]; v[i] = t >= 1 && t <= 5 && d[i] >= 0 ? d[i] : INF; }
    chamfer(v, N, net, 4, INF);
    // coarse supply ratio: CS job capacity x RES_PER_CS_JOB / residents, blurred over 3x3 blocks
    const B = CLUSTER_BLOCK;
    const nb = Math.ceil(N / B);
    const cs = new Float32Array(nb * nb), pop = new Float32Array(nb * nb);
    const res = this.need[0];
    for (let z = 0; z < N; z++) { const bz = (z / B) | 0; for (let x = 0; x < N; x++) { const r = res[z * N + x]; if (r > 0) pop[bz * nb + ((x / B) | 0)] += r; } }
    const bL = buildingList(st);
    for (let bI = 0; bI < bL.length; bI++) {
      const b = bL[bI];
      const inf = infoOf(st, b);
      if (inf.fam !== Fam.C || inf.dev < DevType.CS1 || inf.dev > DevType.CS3 || !isFunctional(b)) continue;
      const x = Math.min(N - 1, b.x + (b.w >> 1)), z = Math.min(N - 1, b.z + (b.d >> 1));
      cs[((z / B) | 0) * nb + ((x / B) | 0)] += b.capacity;
    }
    box3(cs, nb); box3(pop, nb);
    const ratio = cs;
    for (let q = 0; q < nb * nb; q++) ratio[q] = Math.min(1, (cs[q] * RES_PER_CS_JOB) / (pop[q] + 1));
    const out = st.shopAccess;
    const capQ = SHOP_CAP_CELLS * 4;
    // distance score LUT (quarter-cell integer distances) and per-column bilinear taps into the coarse ratio grid
    if (this.shopLut.length !== capQ + 1) {
      this.shopLut = new Float32Array(capQ + 1);
      for (let q = 0; q <= capQ; q++) this.shopLut[q] = 1 - smoothstep(SHOP_NEAR, SHOP_FAR, q / 4);
    }
    const lut = this.shopLut;
    if (this.colX0.length !== N) { this.colX0 = new Int32Array(N); this.colX1 = new Int32Array(N); this.colT = new Float32Array(N); }
    const cx0 = this.colX0, cx1 = this.colX1, ct = this.colT;
    for (let x = 0; x < N; x++) {
      const f = Math.min(nb - 1, Math.max(0, (x + 0.5) / B - 0.5));
      const x0 = Math.floor(f);
      cx0[x] = x0; cx1[x] = Math.min(nb - 1, x0 + 1); ct[x] = f - x0;
    }
    for (let z = 0; z < N; z++) {
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

  // ------------------------------------------------------------------------------------------------ footprints / finish
  /** uniform coverage over building footprints (max over the footprint); layers of empty slots are all 0 (skipped) */
  private footprints(st: CityState): void {
    const N = st.size;
    const layers: Float32Array[] = [];
    for (let k = 0; k < NT; k++) if (this.hadFac[k]) layers.push(tierLayer(st, NEED_ORDER[k]));
    if (this.hadFac[SLOT_TRANSIT] || (this.stops?.n ?? 0) > 0) layers.push(st.transitCov);
    if (layers.length === 0) return;
    const list = this.multi;
    for (let q = 0; q < list.length; q++) {
      const b = list[q];
      const x0 = Math.max(0, b.x), z0 = Math.max(0, b.z), x1 = Math.min(N, b.x + b.w), z1 = Math.min(N, b.z + b.d);
      for (const L of layers) {
        let m = 0;
        for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) { const v = L[z * N + x]; if (v > m) m = v; }
        for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) L[z * N + x] = m;
      }
    }
  }

  /** last step: legacy combos, stats.needs, stale facility records, EQ / HQ fallback, layerUpdated */
  private finish(sim: Simulation, first: boolean): void {
    const st = sim.state;
    const N = st.size, C = st.cells;
    const E = st.eduElemCov, H = st.eduHighCov, K = st.eduCollegeCov, P = st.playCov, G = st.greenCov;
    // legacy layers for untouched consumers
    const edu = st.eduCov, park = st.parkCov;
    const [we, wh, wc] = EDU_LEGACY_W;
    for (let i = 0; i < C; i++) {
      const e = we * E[i] + wh * H[i] + wc * K[i];
      edu[i] = e < 1 ? e : 1;
      park[i] = 1 - (1 - P[i]) * (1 - G[i]);
    }
    // stats.needs
    const needs = st.stats.needs as Record<NeedTier, NeedStat> | undefined;
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
    // facilities not processed this pass (removed / no longer a tier facility) drop out of facilityLoad
    const tb = this.tierById, seen = this.seenById, pass = this.passNo;
    for (let id = 0, n = Math.min(tb.length, seen.length); id < n; id++) if (tb[id] > 0 && seen[id] !== pass) tb[id] = 0;
    // EQ / HQ legacy fallback (WP1 owns them once buildings carry the education stock b.edu)
    let popSum = 0, eduA = 0, health = 0, air = 0, wp1 = false;
    const bL = buildingList(st);
    for (let bI = 0; bI < bL.length; bI++) {
      const b = bL[bI];
      if (b.pop <= 0) continue;
      if (infoOf(st, b).fam !== Fam.R) continue;
      if (b.edu !== undefined) { wp1 = true; break; }
      const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
      popSum += b.pop;
      eduA += b.pop * (1 - (1 - E[i]) * (1 - H[i]) * (1 - K[i]));
      health += b.pop * st.healthCov[i];
      air += b.pop * st.airPollution[i];
    }
    const stats = st.stats;
    const dtDays = Math.max(0, st.day - this.lastEqDay);
    this.lastEqDay = st.day;
    if (!wp1 && popSum > 0 && !first && dtDays > 0) {
      eduA /= popSum; health /= popSum; air /= popSum;
      const eqT = Math.min(150, 25 + 125 * eduA);
      const hqT = Math.min(150, Math.max(0, (30 + 120 * health) * (1 - 0.35 * air)));
      stats.eq += (eqT - stats.eq) * (1 - Math.exp(-dtDays / (EQ_TAU_YEARS * 360)));
      stats.hq += (hqT - stats.hq) * (1 - Math.exp(-dtDays / (HQ_TAU_YEARS * 360)));
    }
    this.donePasses++;
    sim.events.emit('layerUpdated', 'services');
    sim.events.emit('layerUpdated', 'catchments');
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

/** hash of the highway / rail cells with their bridge / tunnel bits (NIMBY corridor stigma sources) */
function corridorHash(st: CityState): number {
  const net = st.network, fl = st.netFlags;
  let h = 0x2545f491;
  for (let i = 0; i < net.length; i++) {
    const t = net[i];
    if (t !== Network.Highway && t !== Network.Rail) continue;
    h = Math.imul(h ^ (i * 16 + t * 4 + (fl[i] & 3)), 16777619) ^ (h >>> 15);
  }
  return h;
}

/** FNV-style hash of a byte layer (4 bytes per round) */
function hashBytes(a: Uint8Array, seed: number): number {
  let h = 0x811c9dc5 ^ seed;
  const n4 = a.length & ~3;
  for (let i = 0; i < n4; i += 4) {
    const v = a[i] | (a[i + 1] << 8) | (a[i + 2] << 16) | (a[i + 3] << 24);
    h = Math.imul(h ^ v, 16777619) ^ (h >>> 13);
  }
  for (let i = n4; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619);
  return h;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 3x3 box blur on an n x n grid in place (zero boundary) */
function box3(a: Float32Array, n: number): void {
  const t = new Float32Array(a.length);
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
 * two-pass chamfer (4-neighbour) over non-road cells: v = min(v, neighbour + step); road cells (net 1..5) keep their
 * value and act as sources. Values >= inf are "unset".
 */
function chamfer(v: Float32Array, N: number, net: Uint8Array, step: number, inf: number): void {
  for (let z = 0; z < N; z++) {
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
  for (let z = N - 1; z >= 0; z--) {
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
