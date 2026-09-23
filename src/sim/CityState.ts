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
 * Renderers & UI only READ state and listen to Simulation events.
 */
import type { CityConfigData } from './config';
import { DEV_TYPE_COUNT, Network, Zone, isRoad } from '../core/types';
import type { ServiceKind } from './catalogTypes';
import { START_YEAR } from '../core/constants';

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
}

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
  /** network flags: bit0 bridge, bit1 tunnel, bits2-3 one-way direction (0:+x 1:+z 2:-x 3:-z), bit4 has bus stop */
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
    this.stats = {
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
    };
    this.history = { t: [], pop: [], funds: [], income: [], expense: [], r: [], c: [], i: [], landValue: [], crime: [], pollution: [], traffic: [], eq: [], hq: [], approval: [] };
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
