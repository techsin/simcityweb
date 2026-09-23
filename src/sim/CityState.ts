/**
 * CityState — the complete, serializable state of one city. Pure data + small helpers, no DOM / three.js.
 * Grids are row-major typed arrays of size N*N (i = z*N + x). Heights are (N+1)^2 corner samples.
 *
 * OWNERSHIP of layers (who writes):
 *   heights, water, trees           -> terrain gen / terraform actions
 *   zone, network, netFlags, powerLines, building  -> actions (player) + growth system
 *   powered, watered                -> utilities system
 *   traffic, congestion, commute    -> traffic system
 *   airPollution, waterPollution, garbage, noise -> pollution system
 *   crime, police/fire/health/edu/park/transit coverage -> services system
 *   landValue, desirability         -> desirability system
 *   SIM_DEPTH_SPEC layers (docs/SIM_DEPTH_SPEC.md; one writer package each, see the field comments):
 *   eduElemCov / eduHighCov / eduCollegeCov / playCov / greenCov / shopAccess / stigma / prestige / campus /
 *   accessCommute -> WP2 catchments · treeCover / soil / landfillFill -> WP3 pollution · visitors -> WP4 tourism ·
 *   respFire / respPolice / respMedical -> WP8 emergency · parking -> WP7 facilities
 * Renderers & UI only READ state and listen to Simulation events.
 */
import type { CityConfigData } from './config';
import { DEV_TYPE_COUNT, Network, Zone, isRoad } from '../core/types';
import type { ServiceKind } from './catalogTypes';
import { START_YEAR } from '../core/constants';
import { WORKFORCE_RATIO } from './economy/tuning';

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------
export const BF = {
  Powered: 1 << 0,
  Watered: 1 << 1,
  Abandoned: 1 << 2,
  OnFire: 1 << 3,
  Burnt: 1 << 4, // rubble; needs bulldozing
  NoRoad: 1 << 5,
  Historic: 1 << 6, // player-marked: won't redevelop
  Constructing: 1 << 7,
  Plopped: 1 << 8, // placed by player (not growable)
  NoJobs: 1 << 9, // residents can't find jobs (complaint indicator)
  Congested: 1 << 10,
  Polluted: 1 << 11,
  Crime: 1 << 12,
  NoGarbage: 1 << 13,
  /** residential: noise above NOISY_THRESHOLD (written by WP3 pollution) */
  Noisy: 1 << 14,
  /** residential: a kids / teens / seniors need has gap >= 0.5 affecting >= 3 people (written by WP1 population) */
  NeedsUnmet: 1 << 15,
  /** an active emergency incident is at this building (written by WP8 emergency) */
  Incident: 1 << 16,
  /** civic: staffed below 60 % of def.jobs (written by WP7 facilities) */
  Understaffed: 1 << 17,
} as const;

export interface Building {
  id: number;
  /** BuildingDef id (src/sim/catalog.ts) */
  def: string;
  /** min corner cell */
  x: number;
  z: number;
  /** occupied size in cells AFTER rotation */
  w: number;
  d: number;
  /** 0: front faces +Z, 1: +X, 2: -Z, 3: -X (model rotated by rot * 90deg around +Y) */
  rot: 0 | 1 | 2 | 3;
  variant: number;
  /** residents currently living (R) */
  pop: number;
  /** jobs currently filled (C / I / civic) */
  jobs: number;
  /** max residents or jobs */
  capacity: number;
  /** 1..3 for growables, 0 for civic */
  wealth: number;
  /** construction progress 0..1 (1 = complete) */
  built: number;
  /** days since placed */
  age: number;
  /** BF bitmask */
  flags: number;
  /** base ground height (m) the building stands on (lot is leveled to this) */
  baseY: number;
  /** 0..1 how well the building is doing (drives abandonment / upgrades) */
  health: number;
  /** days the building has been unhappy (for abandonment) */
  unhappy: number;

  // ---- optional demographics (written by WP1; undefined = derive from the household profile). Saved as Float32
  //      columns (NaN = undefined): write Math.fround(v) so a save / load round trip is bit-exact.
  /** cohort shares 0..1 of residents: kids 0-11, teens 12-17, young adults 18-24, seniors 65+ (adults = 1 - sum) */
  kids?: number;
  teens?: number;
  yad?: number;
  srs?: number;
  /** workforce share of residents */
  wf?: number;
  /** education attainment of the adult residents 0..1 */
  edu?: number;
  /** C / I / civic: hiring factor 0..1 (demand x health x power / water; WP1). undefined = 1 */
  hire?: number;
}

// ---------------------------------------------------------------------------
// Budget, stats, history
// ---------------------------------------------------------------------------
export interface Loan {
  principal: number;
  remaining: number;
  /** annual interest rate, e.g. 0.06 */
  rate: number;
  monthlyPayment: number;
  monthsLeft: number;
}

export interface BudgetState {
  /** tax rate percent per DevType (index = DevType), default 9 */
  taxRates: number[];
  /** service funding percent (0..150, default 100) */
  funding: Record<ServiceKind, number>;
  /** enabled ordinance ids */
  ordinances: string[];
  loans: Loan[];
  /** last month's breakdown, keyed by line item (e.g. 'tax:R', 'police', 'roads', 'ordinance:recycling') */
  lastIncome: Record<string, number>;
  lastExpense: Record<string, number>;
  /** accumulators for current month */
  curIncome: Record<string, number>;
  curExpense: Record<string, number>;
}

export interface HistorySeries {
  /** month index since start (year*12+month) */
  t: number[];
  pop: number[];
  funds: number[];
  income: number[];
  expense: number[];
  r: number[];
  c: number[];
  i: number[];
  landValue: number[];
  crime: number[];
  pollution: number[];
  traffic: number[];
  eq: number[];
  hq: number[];
  approval: number[];
  // ---- SIM_DEPTH_SPEC series (written by WP5 history; padded with 0 up to t.length by padHistory())
  kids: number[];
  teens: number[];
  youngAdults: number[];
  adults: number[];
  seniors: number[];
  unemployment: number[];
  commute: number[];
  noise: number[];
  air: number[];
  waterPoll: number[];
  garbageLoad: number[];
  powerMargin: number[];
  waterMargin: number[];
  tourists: number[];
  attractiveness: number[];
  enrolElem: number[];
  enrolHigh: number[];
  enrolCollege: number[];
  healthServed: number[];
  incidents: number[];
  responseMin: number[];
  emergencyDeaths: number[];
  jailOccupancy: number[];
  busLoad: number[];
  parkRide: number[];
}

/** every HistorySeries key (t first); keep in sync with the interface */
export const HISTORY_KEYS: readonly (keyof HistorySeries)[] = [
  't', 'pop', 'funds', 'income', 'expense', 'r', 'c', 'i', 'landValue', 'crime', 'pollution', 'traffic', 'eq', 'hq', 'approval',
  'kids', 'teens', 'youngAdults', 'adults', 'seniors', 'unemployment', 'commute', 'noise', 'air', 'waterPoll', 'garbageLoad',
  'powerMargin', 'waterMargin', 'tourists', 'attractiveness', 'enrolElem', 'enrolHigh', 'enrolCollege', 'healthServed',
  'incidents', 'responseMin', 'emergencyDeaths', 'jailOccupancy', 'busLoad', 'parkRide',
];

export function emptyHistory(): HistorySeries {
  const h = {} as Record<keyof HistorySeries, number[]>;
  for (const k of HISTORY_KEYS) h[k] = [];
  return h as HistorySeries;
}

/**
 * Keep every series aligned with h.t: creates missing keys and pushes 0 onto series shorter than t (series nobody
 * writes yet, old saves). Called by recordHistory after the month's values were pushed.
 */
export function padHistory(h: HistorySeries): void {
  const n = h.t.length;
  const rec = h as unknown as Record<string, number[] | undefined>;
  for (const k of HISTORY_KEYS) {
    let a = rec[k];
    if (!Array.isArray(a)) rec[k] = a = [];
    while (a.length < n) a.push(0);
  }
}

// ---------------------------------------------------------------------------
// SIM_DEPTH_SPEC stats types (Phase 0 contract; writers in brackets)
// ---------------------------------------------------------------------------
/** need tiers of stats.needs (WP2 writes education / health / play / green; WP7 writes police; fire is capacity-free) */
export type NeedTier = 'elementary' | 'high' | 'college' | 'health' | 'play' | 'green' | 'police' | 'fire';
export const NEED_TIERS: readonly NeedTier[] = ['elementary', 'high', 'college', 'health', 'play', 'green', 'police', 'fire'];
export interface NeedStat {
  /** people needing the service (tier units: pupils, patient-equivalents, ...) */
  need: number;
  /** need x coverage (<= capacity) */
  served: number;
  /** sum of facility capacity x operating factor */
  capacity: number;
  /** need in cells no facility reaches */
  unreached: number;
  /** number of facilities with utilisation > 1.15 */
  overcrowded: number;
}

export type IncidentKind = 'fire' | 'industrial' | 'spill' | 'crime' | 'riot' | 'medical' | 'collapse' | 'prisonRiot';
export const INCIDENT_KINDS: readonly IncidentKind[] = ['fire', 'industrial', 'spill', 'crime', 'riot', 'medical', 'collapse', 'prisonRiot'];
export type Responder = 'fire' | 'police' | 'medical';
export const RESPONDERS: readonly Responder[] = ['fire', 'police', 'medical'];
/** emergency outcome accumulators (WP8) */
export interface EmergencyMonth {
  count: Record<IncidentKind, number>;
  /** incidents answered by auto-dispatch / by a player dispatch */
  auto: number;
  manual: number;
  /** answered after the grace time / not resolved before the deadline */
  late: number;
  failed: number;
  /** summed response minutes and number of responses per responder (average = responseMin / responses) */
  responseMin: Record<Responder, number>;
  responses: Record<Responder, number>;
  deaths: number;
  injured: number;
  rescued: number;
  buildingsLost: number;
  /** damage in § */
  damage: number;
  arrests: number;
  riotDays: number;
}
export function emptyEmergencyMonth(): EmergencyMonth {
  return {
    count: { fire: 0, industrial: 0, spill: 0, crime: 0, riot: 0, medical: 0, collapse: 0, prisonRiot: 0 },
    auto: 0, manual: 0, late: 0, failed: 0,
    responseMin: { fire: 0, police: 0, medical: 0 },
    responses: { fire: 0, police: 0, medical: 0 },
    deaths: 0, injured: 0, rescued: 0, buildingsLost: 0, damage: 0, arrests: 0, riotDays: 0,
  };
}
export interface EmergencyStats {
  /** current month (rolled into lastMonth on the 1st), and the sum of the last 12 rolled months */
  month: EmergencyMonth;
  lastMonth: EmergencyMonth;
  year: EmergencyMonth;
  /** incidents active now / active and waiting for a player dispatch */
  active: number;
  manualActive: number;
  /** 12-month EMA of medical response quality 0..1 (1 = every call within grace); default 1 (neutral for HQ) */
  medScore: number;
}
/** justice (WP7): jail stock and its police / crime factors (legacy default: policeMul 1, crimeMul 1) */
export interface JusticeStats {
  inmates: number;
  beds: number;
  /** holding cells (per month) of police stations */
  holding: number;
  arrestsMonth: number;
  releasesMonth: number;
  /** inmates / beds */
  occupancy: number;
  /** share of sentenced offenders without a bed 0..1 */
  overflow: number;
  policeMul: number;
  crimeMul: number;
}
/** bus fleet, park & ride and ferries (WP7) */
export interface TransitFleetStats {
  buses: number;
  busesNeeded: number;
  /** commuters using park & ride per day / garage spaces */
  parkRide: number;
  parkRideSpaces: number;
  ferryRiders: number;
  ferryLinks: number;
}

export interface CityStats {
  population: number;
  /** residents by wealth [R$, R$$, R$$$] */
  residents: [number, number, number];
  /** filled jobs per DevType */
  jobsByDev: number[];
  /** job capacity per DevType */
  jobCapByDev: number[];
  workforce: number;
  employed: number;
  unemployment: number; // 0..1
  /** RCI demand per DevType, range [-1, 1] */
  demand: number[];
  /** demand caps per DevType (population/jobs cap; relieved by parks, airports, seaports, landmarks...) */
  demandCap: number[];
  powerSupply: number;
  powerDemand: number;
  waterSupply: number;
  waterDemand: number;
  garbageProduced: number;
  garbageCapacity: number;
  /** education quotient 0..150 (SC4 style), health quotient 0..150 */
  eq: number;
  hq: number;
  /** averages 0..1 */
  avgLandValue: number;
  avgCrime: number;
  avgPollution: number;
  avgTraffic: number;
  /** average commute time in minutes */
  avgCommute: number;
  /** mayor approval 0..100 */
  approval: number;
  /** trips per mode last traffic update */
  tripsCar: number;
  tripsTransit: number;
  tripsWalk: number;
  buildingCount: number;

  // ---- SIM_DEPTH_SPEC additions (all defaulted in defaultStats(); old saves are padded on load)
  /** residents per cohort: kids 0-11, teens 12-17, young adults 18-24, adults 25-64, seniors 65+ (WP1) */
  cohorts: [number, number, number, number, number];
  /** 15 entries: index = (wealth - 1) * 5 + cohort (WP1) */
  cohortsByWealth: number[];
  /** workforce / population (WP1; default WORKFORCE_RATIO 0.55) */
  workforceRatio: number;
  /** per need tier: need / served / capacity / unreached / overcrowded (WP2; police WP7) */
  needs: Record<NeedTier, NeedStat>;
  /** resident-weighted noise, air, water pollution 0..1 (WP3) */
  avgNoise: number;
  avgAir: number;
  avgWaterPollution: number;
  /** share of sewage treated 0..1 (WP3) */
  sewageTreated: number;
  /** tap water quality 0..1, 1 = clean (WP3; default 1 = neutral) */
  tapWater: number;
  /** mean landfill fill 0..1, tons / month diverted by recycling (WP3) */
  landfillFill: number;
  garbageRecycled: number;
  /** tourists per day, attractiveness 0..100 overall and per wealth, hotel rooms (WP4) */
  tourists: number;
  attractiveness: number;
  attractByWealth: [number, number, number];
  hotelRooms: number;
  /** emergencies (WP8) */
  emergency: EmergencyStats;
  /** jail / courts (WP7) */
  justice: JusticeStats;
  /** bus fleet / park & ride / ferries (WP7) */
  transitFleet: TransitFleetStats;
}

function emptyNeedStat(): NeedStat {
  return { need: 0, served: 0, capacity: 0, unreached: 0, overcrowded: 0 };
}

/** a fresh CityStats (constructor default; also pads stats of older saves on load) */
export function defaultStats(): CityStats {
  const needs = {} as Record<NeedTier, NeedStat>;
  for (const t of NEED_TIERS) needs[t] = emptyNeedStat();
  return {
    population: 0,
    residents: [0, 0, 0],
    jobsByDev: new Array(DEV_TYPE_COUNT).fill(0),
    jobCapByDev: new Array(DEV_TYPE_COUNT).fill(0),
    workforce: 0,
    employed: 0,
    unemployment: 0,
    demand: new Array(DEV_TYPE_COUNT).fill(0),
    demandCap: new Array(DEV_TYPE_COUNT).fill(0),
    powerSupply: 0,
    powerDemand: 0,
    waterSupply: 0,
    waterDemand: 0,
    garbageProduced: 0,
    garbageCapacity: 0,
    eq: 50,
    hq: 50,
    avgLandValue: 0,
    avgCrime: 0,
    avgPollution: 0,
    avgTraffic: 0,
    avgCommute: 0,
    approval: 50,
    tripsCar: 0,
    tripsTransit: 0,
    tripsWalk: 0,
    buildingCount: 0,
    cohorts: [0, 0, 0, 0, 0],
    cohortsByWealth: new Array(15).fill(0),
    workforceRatio: WORKFORCE_RATIO,
    needs,
    avgNoise: 0,
    avgAir: 0,
    avgWaterPollution: 0,
    sewageTreated: 0,
    tapWater: 1,
    landfillFill: 0,
    garbageRecycled: 0,
    tourists: 0,
    attractiveness: 0,
    attractByWealth: [0, 0, 0],
    hotelRooms: 0,
    emergency: { month: emptyEmergencyMonth(), lastMonth: emptyEmergencyMonth(), year: emptyEmergencyMonth(), active: 0, manualActive: 0, medScore: 1 },
    justice: { inmates: 0, beds: 0, holding: 0, arrestsMonth: 0, releasesMonth: 0, occupancy: 0, overflow: 0, policeMul: 1, crimeMul: 1 },
    transitFleet: { buses: 0, busesNeeded: 0, parkRide: 0, parkRideSpaces: 0, ferryRiders: 0, ferryLinks: 0 },
  };
}

/** "no station" value of the resp* response-slack layers */
export const RESP_NONE = -99;

export interface NewsItem {
  day: number; // absolute day
  text: string;
  kind: 'info' | 'good' | 'bad' | 'warning' | 'disaster' | 'reward' | 'advisor';
  x?: number;
  z?: number;
  advisor?: string;
}

// ---------------------------------------------------------------------------
// CityState
// ---------------------------------------------------------------------------
export class CityState {
  readonly size: number;
  readonly cells: number;
  config: CityConfigData;

  // calendar
  /** absolute days since city founded */
  day = 0;
  get dayOfMonth() { return this.day % 30; }
  get month() { return Math.floor(this.day / 30) % 12; }
  get year() { return this.config.startYear + Math.floor(this.day / 360); }
  get monthIndex() { return Math.floor(this.day / 30); }

  funds = 0;

  // terrain
  /** corner heights (N+1)^2, meters */
  heights: Float32Array;
  /** 1 = water cell */
  water: Uint8Array;
  /** tree density per cell 0..4 (0 = none); renderer scatters instances */
  trees: Uint8Array;

  // player-built layers
  zone: Uint8Array;
  network: Uint8Array;
  /** network flags: bit0 bridge, bit1 tunnel, bits2-3 one-way direction (0:+x 1:+z 2:-x 3:-z), bit4 has bus stop,
   *  bit5 (0x20) rail/road level crossing (cell keeps its road type; rail passes through) */
  netFlags: Uint8Array;
  /** 1 = power line on cell */
  powerLines: Uint8Array;
  /** 1 = subway tunnel on cell */
  subway: Uint8Array;
  /** building id covering this cell, -1 if none */
  building: Int32Array;

  // derived layers (0..1 unless noted)
  powered: Uint8Array;
  watered: Uint8Array;
  /** trips/day through road cell */
  traffic: Float32Array;
  /** volume / capacity (0 .. >1) */
  congestion: Float32Array;
  /** commute minutes for residents at this cell */
  commute: Float32Array;
  airPollution: Float32Array;
  waterPollution: Float32Array;
  garbage: Float32Array;
  noise: Float32Array;
  crime: Float32Array;
  policeCov: Float32Array;
  fireCov: Float32Array;
  healthCov: Float32Array;
  eduCov: Float32Array;
  parkCov: Float32Array;
  transitCov: Float32Array;
  landValue: Float32Array;
  /** desirability per DevType: desirability[dev][i], -1..1 */
  desirability: Float32Array[];

  // ---- SIM_DEPTH_SPEC layers (Float32, zero-initialised). DERIVED = not saved (src/save/serialize.ts DERIVED_LAYERS):
  //      the owner must recompute it synchronously in init(). Writer package in brackets.
  /** catchment coverage 0..1 per tier: elementary / high school / college (+library, museum) [WP2, derived] */
  eduElemCov: Float32Array;
  eduHighCov: Float32Array;
  eduCollegeCov: Float32Array;
  /** playgrounds & sports / gardens & parks coverage 0..1 [WP2, derived] */
  playCov: Float32Array;
  greenCov: Float32Array;
  /** walkable / drivable shops 0..1 [WP2, derived] */
  shopAccess: Float32Array;
  /** NIMBY stigma, YIMBY prestige, office / high-tech campus effect 0..1 [WP2, derived] */
  stigma: Float32Array;
  prestige: Float32Array;
  campus: Float32Array;
  /** commute minutes for every cell (0 = unknown) [WP2, derived] */
  accessCommute: Float32Array;
  /** blurred tree density 0..1 [WP3, derived] */
  treeCover: Float32Array;
  /** soil contamination 0..1 (stock) [WP3, SAVED] */
  soil: Float32Array;
  /** landfill fill 0..1 per landfill cell (stock) [WP3, SAVED] */
  landfillFill: Float32Array;
  /** visitor intensity 0..1 [WP4, derived] */
  visitors: Float32Array;
  /** auto-dispatch response slack (minutes) per responder: >= 0 reached within a station's range, RESP_NONE (-99) no
   *  station [WP8, derived] */
  respFire: Float32Array;
  respPolice: Float32Array;
  respMedical: Float32Array;
  /** parking pressure 0..1 [WP7, derived] */
  parking: Float32Array;

  buildings = new Map<number, Building>();
  nextBuildingId = 1;

  budget: BudgetState;
  stats: CityStats;
  history: HistorySeries;
  news: NewsItem[] = [];
  /** unlocked reward/requirement ids */
  unlocked = new Set<string>();
  /** ids of rewards already announced (so each unlock is announced once) */
  announced = new Set<string>();
  /** plopped unique building defs present */
  milestones: Record<string, number> = {};
  /** per-edge neighbor connections: which map edges have road/rail/highway leaving the map */
  neighborConnections: { edge: 'n' | 's' | 'e' | 'w'; x: number; z: number; type: Network }[] = [];
  /** arbitrary per-system persistent data (must be structured-clone friendly) */
  systemData: Record<string, unknown> = {};

  constructor(config: CityConfigData) {
    this.config = config;
    const N = (this.size = config.size);
    const C = (this.cells = N * N);
    this.heights = new Float32Array((N + 1) * (N + 1));
    this.water = new Uint8Array(C);
    this.trees = new Uint8Array(C);
    this.zone = new Uint8Array(C);
    this.network = new Uint8Array(C);
    this.netFlags = new Uint8Array(C);
    this.powerLines = new Uint8Array(C);
    this.subway = new Uint8Array(C);
    this.building = new Int32Array(C).fill(-1);
    this.powered = new Uint8Array(C);
    this.watered = new Uint8Array(C);
    this.traffic = new Float32Array(C);
    this.congestion = new Float32Array(C);
    this.commute = new Float32Array(C);
    this.airPollution = new Float32Array(C);
    this.waterPollution = new Float32Array(C);
    this.garbage = new Float32Array(C);
    this.noise = new Float32Array(C);
    this.crime = new Float32Array(C);
    this.policeCov = new Float32Array(C);
    this.fireCov = new Float32Array(C);
    this.healthCov = new Float32Array(C);
    this.eduCov = new Float32Array(C);
    this.parkCov = new Float32Array(C);
    this.transitCov = new Float32Array(C);
    this.landValue = new Float32Array(C);
    this.desirability = Array.from({ length: DEV_TYPE_COUNT }, () => new Float32Array(C));
    this.eduElemCov = new Float32Array(C);
    this.eduHighCov = new Float32Array(C);
    this.eduCollegeCov = new Float32Array(C);
    this.playCov = new Float32Array(C);
    this.greenCov = new Float32Array(C);
    this.shopAccess = new Float32Array(C);
    this.stigma = new Float32Array(C);
    this.prestige = new Float32Array(C);
    this.campus = new Float32Array(C);
    this.accessCommute = new Float32Array(C);
    this.treeCover = new Float32Array(C);
    this.soil = new Float32Array(C);
    this.landfillFill = new Float32Array(C);
    this.visitors = new Float32Array(C);
    this.respFire = new Float32Array(C);
    this.respPolice = new Float32Array(C);
    this.respMedical = new Float32Array(C);
    this.parking = new Float32Array(C);
    this.funds = config.startFunds;
    this.budget = {
      taxRates: new Array(DEV_TYPE_COUNT).fill(9),
      funding: { police: 100, fire: 100, health: 100, education: 100, transit: 100, parks: 100, utilities: 100, roads: 100 },
      ordinances: [],
      loans: [],
      lastIncome: {},
      lastExpense: {},
      curIncome: {},
      curExpense: {},
    };
    this.stats = defaultStats();
    this.history = emptyHistory();
  }

  // ------------------------------------------------------------------ helpers
  idx(x: number, z: number): number {
    return z * this.size + x;
  }
  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.size && z < this.size;
  }
  hIdx(x: number, z: number): number {
    return z * (this.size + 1) + x;
  }
  /** corner height */
  cornerHeight(x: number, z: number): number {
    return this.heights[this.hIdx(x, z)];
  }
  /** average height of a cell (4 corners) */
  cellHeight(x: number, z: number): number {
    const N1 = this.size + 1;
    const h = this.heights;
    const i = z * N1 + x;
    return (h[i] + h[i + 1] + h[i + N1] + h[i + N1 + 1]) * 0.25;
  }
  /** bilinear height at world position (meters). */
  heightAt(wx: number, wz: number, cellSize = 16): number {
    const N = this.size;
    const fx = Math.min(Math.max(wx / cellSize, 0), N - 1e-4);
    const fz = Math.min(Math.max(wz / cellSize, 0), N - 1e-4);
    const x = Math.floor(fx), z = Math.floor(fz);
    const tx = fx - x, tz = fz - z;
    const N1 = N + 1;
    const h = this.heights;
    const i = z * N1 + x;
    const a = h[i], b = h[i + 1], c = h[i + N1], d = h[i + N1 + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }
  /** max slope (m) between corners of the cell */
  cellSlope(x: number, z: number): number {
    const N1 = this.size + 1;
    const h = this.heights;
    const i = z * N1 + x;
    const a = h[i], b = h[i + 1], c = h[i + N1], d = h[i + N1 + 1];
    return Math.max(a, b, c, d) - Math.min(a, b, c, d);
  }
  isWater(x: number, z: number): boolean {
    return this.water[this.idx(x, z)] === 1;
  }
  isRoadAt(x: number, z: number): boolean {
    return this.inBounds(x, z) && isRoad(this.network[this.idx(x, z)] as Network);
  }
  zoneAt(x: number, z: number): Zone {
    return this.zone[this.idx(x, z)] as Zone;
  }
  buildingAt(x: number, z: number): Building | undefined {
    if (!this.inBounds(x, z)) return undefined;
    const id = this.building[this.idx(x, z)];
    return id >= 0 ? this.buildings.get(id) : undefined;
  }
  /** add a news / notification item */
  notify(text: string, kind: NewsItem['kind'] = 'info', x?: number, z?: number, advisor?: string): NewsItem {
    const n: NewsItem = { day: this.day, text, kind, x, z, advisor };
    this.news.push(n);
    if (this.news.length > 200) this.news.splice(0, this.news.length - 200);
    return n;
  }
  /** date label like "Mar 2003" */
  dateLabel(): string {
    return `${MONTH_NAMES[this.month]} ${this.year}`;
  }
}

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export { START_YEAR };
