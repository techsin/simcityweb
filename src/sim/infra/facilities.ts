/**
 * Facility completeness (SIM_DEPTH_AMENDMENTS WP7-1, 7-3, 7-4, 7-11, WP7a of docs/SIM_DEPTH_PART_B.md). Headless: no DOM /
 * three.js. Every plopped facility genuinely works and says so:
 *
 *  - POLICE CAPACITY (WP7-1): the police tier shares patrol capacity like schools share seats (registerTierProvider,
 *    shared): need per cell = (residents + 0.5 jobs) x (0.5 + crime) crime-weighted people, capacity kiosk 6,000,
 *    station 30,000, HQ 110,000 (POLICE_CAP). An overloaded station patrols its whole area less; two stations split it.
 *  - STAFFING (WP7-3, critic item 7): facilityOpFactor = 0.6 + 0.4 x staffRel, staffRel = min(1, staff / max(0.5, city
 *    fill)) in 0.05 steps, staff = b.jobs / (def jobs x b.hire) = the share of the posted jobs that workers reach (power /
 *    water shortages are already in hire and in the service's own power / water factors, so they never count as
 *    understaffing). A lot without a road has staffRel 0. Unknown staffing (b.hire never set: infra-only simulations,
 *    a facility the population system has not visited yet) counts as full. Only the tier engine (schools, health,
 *    parks, police, fire coverage) uses it; BF.Understaffed (set monthly, tier facilities only) below 0.6 or without road.
 *  - USE (WP7-11): airports carry 0.012 pop^0.95 + overnight visitors passengers / day (shared by capacity: small 3,000,
 *    large 25,000), a seaport the trucks within reach / 3,000 (WP7b freightSinkTrucks; unknown -> full); use factor =
 *    0.6 + 0.4 smoothstep(0, 0.5, use) on cap relief, freight boost and income (demand.ts / budget.ts). Transit defs take
 *    WP7b's transportUseFactor hook (0 = not connected). Computed monthly (and when such a building is placed),
 *    persisted in systemData.justice.use; a building without an entry counts 1.
 *  - REPORTS: facilityReport(sim, id) for every plopped building of a non-hidden ploppable def (title, one-line role,
 *    >= 1 line, warnings with a fix), rendered generically by the inspector (WP5); transit defs append WP7b's
 *    transportFacilityReport part. facilityDefFacts(defId): static tooltip facts (+ transportDefFacts).
 */
import { BF, type Building, type CityState, type NeedTier } from '../CityState';
import type { Simulation } from '../Simulation';
import { Network } from '../../core/types';
import { DAYS_PER_MONTH } from '../../core/constants';
import { capReliefOf, getDef } from '../catalog';
import type { BuildingCategory, BuildingDef, ServiceKind } from '../catalogTypes';
import { Fam, SERVICE_TIERS, buildingList, centerCell, fundingFactor, infoOf, isFunctional, setFlag } from './common';
import { facilityLoad, newReachScratch, reachCells, registerTierProvider, tierProvider, type FacilityLoad, type ReachScratch } from './catchments';
import {
  AIRPORT_CAP, AIRPORT_PAX_EXP, AIRPORT_PAX_K, COURTHOUSE_POLICE_MUL, CRIME_SPILL, GARBAGE_UNPOWERED, HOLDING_CELLS, JAIL_BEDS,
  JUSTICE_CRIME_K, JUSTICE_POLICE_K, OVERCROWDED_UTIL, PATIENTS_PER_BED, POLICE_CAP, POLICE_CRIME_BASE, POLICE_JOB_W, RECYCLE_MAX_SHARE, SEAPORT_TRUCKS, STAFF_CITY_INFO,
  STAFF_CITY_MIN, STAFF_FLAG, STAFF_OP_MIN, STAFF_STEP, THERMAL_UNWATERED, UNPOWERED_SERVICE_EFF, UNWATERED_HEALTH_EFF, USE_FACTOR_MIN,
  USE_FULL,
} from './params';
import { emergencyOf, fleetOfDef, stationRange } from './emergency';
import * as TF from './transportFacilities';
import { justiceData, prisonAvailable } from './justice';
import type { UtilitiesSystem } from './utilities';
import type { PollutionSystem } from './pollution';
import { cohortShares } from '../economy/demographics';
import { ATTRACTIONS, venueIssue, venueVisits } from '../economy/tourism';
import { onStrike, venueIncomeFactor } from '../economy/budget';
import { ordinanceEffect } from '../economy/ordinances';
import { RECYCLING_INCOME_PER_T } from '../economy/tuning';

export interface FacilityLine {
  /** stable id ('patrolLoad', 'beds', 'riders', ...) */
  key: string;
  label: string;
  /** formatted value, e.g. "18,400 / 30,000 (61%)" */
  value: string;
  /** 0..1+ fill for a bar (omit = no bar) */
  ratio?: number;
  status?: 'ok' | 'warn' | 'bad';
  /** short advice ("workers can't reach it") */
  hint?: string;
}
export interface FacilityReport {
  title: string;
  /** one line: what this facility does */
  role: string;
  lines: FacilityLine[];
  warnings: string[];
}

// ================================================================================================ small helpers
const fmt = (v: number): string => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
const pct = (v: number): string => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
const money = (v: number): string => `§${fmt(v)}`;
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
/** a per-def table entry by def id, else by the def's model (test / mod defs reusing a catalog model) */
function byDef<T>(t: Readonly<Record<string, T>>, defId: string): T | undefined {
  const v = t[defId];
  if (v !== undefined) return v;
  const m = getDef(defId)?.model;
  return m !== undefined ? t[m] : undefined;
}
/** a road (street .. highway) touches the lot's edge (allocation free; same rule as the plop tool's road warning) */
function touchesRoad(st: CityState, b: Building): boolean {
  const N = st.size, net = st.network;
  const rd = (i: number) => { const n = net[i]; return n >= Network.Street && n <= Network.Highway; };
  const x0 = Math.max(0, b.x), z0 = Math.max(0, b.z), x1 = Math.min(N, b.x + b.w), z1 = Math.min(N, b.z + b.d);
  for (let x = x0; x < x1; x++) {
    if (b.z > 0 && rd((b.z - 1) * N + x)) return true;
    if (b.z + b.d < N && rd((b.z + b.d) * N + x)) return true;
  }
  for (let z = z0; z < z1; z++) {
    if (b.x > 0 && rd(z * N + b.x - 1)) return true;
    if (b.x + b.w < N && rd(z * N + b.x + b.w)) return true;
  }
  return false;
}

// ================================================================================================ per-state caches
/**
 * facility lists of the last scan (derived: rebuilt in init and by the monthly scan, so a loaded city rebuilds them) and
 * a per-building-id class byte (1 + Fam, +16 for a tier facility; 0 = not classified yet): building ids are never
 * reused and a building never changes family, so the monthly scan reads a typed array instead of a def lookup
 */
interface StateCache {
  plopped: Building[];
  tier: Building[];
  cls: Uint8Array;
}
const stateCache = new WeakMap<CityState, StateCache>();
function cacheOf(st: CityState): StateCache {
  let c = stateCache.get(st);
  if (!c) stateCache.set(st, (c = { plopped: [], tier: [], cls: new Uint8Array(1024) }));
  return c;
}
const CLS_TIER = 16;
function classOf(st: CityState, c: StateCache, b: Building): number {
  const id = b.id;
  if (id >= c.cls.length) {
    const a = new Uint8Array(Math.max(id + 1, st.nextBuildingId + 1, c.cls.length * 2));
    a.set(c.cls);
    c.cls = a;
  }
  let k = c.cls[id];
  if (k === 0) {
    const inf = infoOf(st, b);
    k = (1 + inf.fam) | (inf.tier >= 0 ? CLS_TIER : 0);
    if (inf.known) c.cls[id] = k;
  }
  return k;
}
/** per-def WP7a facts (tables resolved by def id, else by model) */
interface DefFacts { beds: number; holding: number; court: boolean; use: 'airport' | 'seaport' | 'transit' | null; airCap: number }
const factsCache = new Map<string, DefFacts>();
function defFacts(defId: string): DefFacts {
  let f = factsCache.get(defId);
  if (f) return f;
  const def = getDef(defId);
  const m = def?.model;
  const tab = (t: Readonly<Record<string, number>>) => t[defId] ?? (m !== undefined ? t[m] ?? 0 : 0);
  const air = tab(AIRPORT_CAP);
  f = {
    beds: tab(JAIL_BEDS), holding: tab(HOLDING_CELLS), court: defId === 'civ_courthouse' || m === 'civ_courthouse', airCap: air,
    use: air > 0 ? 'airport' : defId === 'tr_seaport' || m === 'tr_seaport' ? 'seaport'
      : TRANSIT_USE_DEFS.has(defId) || (m !== undefined && TRANSIT_USE_DEFS.has(m)) ? 'transit' : null,
  };
  if (def) factsCache.set(defId, f); // (catalog not loaded yet: do not cache)
  return f;
}
/** prison beds / holding cells / courthouse of a def (justice.ts) */
export function justiceFactsOf(defId: string): { beds: number; holding: number; court: boolean } {
  return defFacts(defId);
}
const TRANSIT_USE_DEFS = new Set(['tr_bus_stop', 'civ_bus_depot', 'tr_subway_station', 'tr_train_station', 'tr_freight_station', 'tr_parking_garage', 'tr_ferry_terminal']);
/** day of the month (0 .. DAYS_PER_MONTH-1) on which a building's per-building monthly work runs (id hash; spreads it) */
export function monthSlice(id: number): number {
  return (Math.imul(id, 0x9e3779b1) >>> 0) % DAYS_PER_MONTH;
}

// ================================================================================================ police tier (WP7-1)
/** patrol capacity (crime-weighted people) of a police facility, Infinity when the def has no table entry */
export function policeCapacityOf(defId: string): number {
  return byDef(POLICE_CAP, defId) ?? Infinity;
}

/** police need raster: (residents + POLICE_JOB_W x filled jobs) x (POLICE_CRIME_BASE + crime), O(buildings + cells) */
function policeNeed(st: CityState, res: Float32Array, out: Float32Array): void {
  const N = st.size, C = st.cells;
  const list = buildingList(st);
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    const j = b.jobs;
    if (!(j > 0) || b.pop > 0) continue;
    const w = b.w, d = b.d;
    if (w === 1 && d === 1) { out[b.z * N + b.x] += POLICE_JOB_W * j; continue; }
    const v = (POLICE_JOB_W * j) / (w * d);
    const x0 = Math.max(0, b.x), z0 = Math.max(0, b.z), x1 = Math.min(N, b.x + w), z1 = Math.min(N, b.z + d);
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) out[z * N + x] += v;
  }
  const crime = st.crime;
  for (let i = 0; i < C; i++) {
    const p = res[i] + out[i];
    out[i] = p > 0 ? p * (POLICE_CRIME_BASE + crime[i]) : 0;
  }
}

const POLICE_PROVIDER = {
  shared: true,
  needOf: policeNeed,
  capacityOf: (_st: CityState, b: Building) => policeCapacityOf(b.def),
};
/** register the police tier provider (module load; again on first use when an import cycle made catchments unready) */
export function ensurePoliceProvider(): void {
  if (tierProvider('police') !== POLICE_PROVIDER) registerTierProvider('police', POLICE_PROVIDER);
}
let providerOk = false;
try {
  ensurePoliceProvider();
  providerOk = true;
} catch {
  /* catchments still initialising (import cycle): registered on first use (facilityOpFactor / JusticeSystem.init) */
}

// ================================================================================================ staffing (WP7-3)
/** job-weighted fill of the C / I job sites (b.jobs / (capacity x hire)); -1 without job sites */
export function computeCityFill(st: CityState): number {
  return monthlyScan(st).cityFill;
}

/** city job fill used by staffing (monthly, persisted; 1 while unknown) */
export function cityFillOf(st: CityState): number {
  const v = (st.systemData.justice as { cityFill?: number } | undefined)?.cityFill;
  return typeof v === 'number' && v > 0 ? v : 1;
}

/**
 * staffing of a facility: staff (0..1, workers who reach it / posted jobs), rel (vs the city's job fill, 0.05 steps) and
 * whether a road touches the lot; null = unknown (no jobs, or the population system never staffed it)
 */
export function staffingOf(st: CityState, b: Building): { staff: number; rel: number; road: boolean; jobs: number; slots: number } | null {
  if (b.hire === undefined) return null;
  const cap = b.capacity > 0 ? b.capacity : infoOf(st, b).civicJobs;
  if (!(cap > 0)) return null;
  const slots = cap * Math.max(0, Math.min(1, b.hire));
  if (!(slots > 0)) return null;
  const staff = Math.min(1, Math.max(0, b.jobs) / slots);
  const road = touchesRoad(st, b);
  const rel = road ? Math.min(1, staff / Math.max(STAFF_CITY_MIN, cityFillOf(st))) : 0;
  const steps = Math.round(1 / STAFF_STEP);
  return { staff, rel: Math.round(rel * steps) / steps, road, jobs: b.jobs, slots };
}

/** staffing operating factor of a service building (tier engine op_f; 1 when staffing is unknown) */
export function facilityOpFactor(st: CityState, b: Building): number {
  if (!providerOk) {
    try { if (!tierProvider('police')) ensurePoliceProvider(); providerOk = true; } catch { /* catchments not ready yet */ }
  }
  // staffing reaches the tier facilities only (critic item 8): a transit slot facility (station, depot, garage) keeps op 1
  if (infoOf(st, b).tier < 0) return 1;
  const s = staffingOf(st, b);
  return s ? STAFF_OP_MIN + (1 - STAFF_OP_MIN) * s.rel : 1;
}

/** true when a building's lack of staff shows as BF.Understaffed (tier facilities only) */
function understaffed(st: CityState, b: Building): boolean {
  if (!isFunctional(b) || infoOf(st, b).tier < 0) return false;
  const s = staffingOf(st, b);
  return !!s && (s.rel < STAFF_FLAG || !s.road);
}

// ================================================================================================ use factors (WP7-11)
/** use factor of a use share (0.6 .. 1) */
export function useFactorOf(use: number): number {
  return USE_FACTOR_MIN + (1 - USE_FACTOR_MIN) * smoothstep(0, USE_FULL, Math.max(0, use));
}

type UseHook = (st: CityState, b: Building) => number;
/** WP7b's optional transportUseFactor(st, b) hook (-1 = not a transport def, 0 = not connected) */
function transportUseHook(): UseHook | null {
  const f = (TF as unknown as { transportUseFactor?: UseHook }).transportUseFactor;
  return typeof f === 'function' ? f : null;
}
function useKind(defId: string): 'airport' | 'seaport' | 'transit' | null {
  return defFacts(defId).use;
}

/** airport passengers / day of the city (residents flying + overnight visitors) */
export function airportPassengers(st: CityState): number {
  const pop = Math.max(0, st.stats.population || 0);
  const overnight = (st.systemData.economy as { overnight?: number } | undefined)?.overnight ?? 0;
  return AIRPORT_PAX_K * Math.pow(pop, AIRPORT_PAX_EXP) + Math.max(0, overnight);
}

/** use factor of an airport / seaport / transit building (cap relief, freight boost, income); 1 without an entry */
export function facilityUseFactor(st: CityState, b: Building): number {
  const u = (st.systemData.justice as { use?: Record<string, number> } | undefined)?.use?.[b.id];
  return typeof u === 'number' && Number.isFinite(u) ? u : 1;
}

/** recompute every use factor (monthly, and when an airport / seaport / transit building appears or goes) */
export function updateUseFactors(sim: Simulation, plopped?: readonly Building[]): void {
  const st = sim.state;
  const d = justiceData(st);
  const use: Record<string, number> = {};
  const data: Record<string, number> = {};
  const airports: Building[] = [];
  let airCap = 0;
  const hook = transportUseHook();
  const list = plopped ?? pluggedList(st);
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    if (!st.buildings.has(b.id)) continue;
    const kind = useKind(b.def);
    if (!kind) continue;
    if (kind === 'airport') {
      if (!isFunctional(b)) continue;
      airports.push(b);
      airCap += defFacts(b.def).airCap;
    } else if (kind === 'seaport') {
      const trucks = TF.freightSinkTrucks(sim, b.id);
      data[b.id] = trucks;
      use[b.id] = trucks >= 0 ? Math.round(useFactorOf(trucks / SEAPORT_TRUCKS) * 1e4) / 1e4 : 1;
    } else if (hook) {
      const v = hook(st, b);
      if (typeof v === 'number' && v >= 0 && Number.isFinite(v)) use[b.id] = Math.round(Math.min(1, v) * 1e4) / 1e4;
    }
  }
  setAirportUse(st, airports, airCap, use, data);
  d.use = use;
  d.useData = data;
}

/** airports share the city's passengers by capacity: one use factor for all of them */
function setAirportUse(st: CityState, airports: readonly Building[], airCap: number, use: Record<string, number>, data: Record<string, number>): void {
  if (!airports.length) return;
  const pax = airportPassengers(st);
  const f = Math.round(useFactorOf(airCap > 0 ? pax / airCap : 0) * 1e4) / 1e4;
  for (const b of airports) {
    use[b.id] = f;
    data[b.id] = Math.round((pax * defFacts(b.def).airCap) / Math.max(1, airCap));
  }
}

/**
 * an airport / seaport / transit building appears or goes: airports are re-shared right away (their use needs only the
 * population); a new seaport / transit stop has no entry (= full use) until the monthly update, when traffic has seen it
 */
function useChanged(sim: Simulation, b: Building, removed: boolean): void {
  const kind = useKind(b.def);
  if (!kind) return;
  const st = sim.state;
  const d = justiceData(st);
  if (removed) { delete d.use[b.id]; delete d.useData[b.id]; }
  if (kind !== 'airport') return;
  const airports: Building[] = [];
  let airCap = 0;
  for (const o of cacheOf(st).plopped) {
    if (o.id === b.id && removed) continue;
    if (st.buildings.get(o.id) !== o || !isFunctional(o) || useKind(o.def) !== 'airport') continue;
    airports.push(o);
    airCap += defFacts(o.def).airCap;
  }
  setAirportUse(st, airports, airCap, d.use, d.useData);
}

// ================================================================================================ monthly / daily hooks
/** plopped (civic / utility / transport) buildings of the state (scan; buildings placed without BF.Plopped count) */
export function pluggedList(st: CityState): Building[] {
  return monthlyScan(st).plopped;
}

/**
 * one scan for the month: plopped buildings, tier facilities (staffing flags) and the job-weighted fill of the C / I job
 * sites (-1 without job sites); refreshes the per-state facility lists
 */
export function monthlyScan(st: CityState): { plopped: Building[]; tier: Building[]; cityFill: number } {
  const plopped: Building[] = [], tier: Building[] = [];
  let jobs = 0, slots = 0;
  const c = cacheOf(st);
  const list = buildingList(st);
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    const cls = classOf(st, c, b);
    const fam = (cls & 15) - 1;
    if (fam === Fam.Plop) { plopped.push(b); if (cls & CLS_TIER) tier.push(b); continue; }
    if ((fam !== Fam.C && fam !== Fam.I) || b.capacity <= 0 || !isFunctional(b)) continue;
    jobs += b.jobs;
    slots += b.capacity * (b.hire ?? 1);
  }
  c.plopped = plopped;
  c.tier = tier;
  return { plopped, tier, cityFill: slots > 0 ? Math.min(1, jobs / slots) : -1 };
}

/** set / clear BF.Understaffed of a tier facility (buildingChanged on a flip) */
function updateStaffFlag(sim: Simulation, b: Building): void {
  const on = understaffed(sim.state, b);
  if (on !== ((b.flags & BF.Understaffed) !== 0)) setFlag(sim, b, BF.Understaffed, on);
}

const hooks = new WeakMap<Simulation, (() => void)[]>();

/** JusticeSystem.init: police provider, city fill, use-factor refresh on placement / removal */
export function facilityInit(sim: Simulation): void {
  try { if (!tierProvider('police')) ensurePoliceProvider(); providerOk = true; } catch { /* not ready */ }
  const st = sim.state;
  const d = justiceData(st);
  const scan = monthlyScan(st);
  if (d.cityFill < 0) d.cityFill = scan.cityFill;
  for (const u of hooks.get(sim) ?? []) u();
  const onAdd = (b: Building) => {
    const inf = infoOf(st, b);
    if (inf.fam === Fam.Plop) { const c = cacheOf(st); c.plopped.push(b); if (inf.tier >= 0) c.tier.push(b); }
    useChanged(sim, b, false);
  };
  const onRemove = (b: Building) => useChanged(sim, b, true);
  hooks.set(sim, [sim.events.on('buildingAdded', onAdd), sim.events.on('buildingRemoved', onRemove)]);
}

/** JusticeSystem.daily: emergency vehicles dispatched per station this month (report "responses") */
export function facilityDaily(sim: Simulation): void {
  // staffing flags: each tier facility on its own day of the month (spreads the per-building work, item 4)
  const st = sim.state;
  const dm = st.day % DAYS_PER_MONTH;
  const tier = cacheOf(st).tier;
  for (let k = 0; k < tier.length; k++) {
    const b = tier[k];
    if (monthSlice(b.id) !== dm || st.buildings.get(b.id) !== b) continue;
    updateStaffFlag(sim, b);
  }
  const em = emergencyOf(sim);
  if (!em || !em.active) return;
  const vs = em.vehicles();
  if (vs.length === 0) return;
  const d = justiceData(sim.state);
  let max = d.respVid;
  for (let k = 0; k < vs.length; k++) {
    const v = vs[k];
    if (v.id <= d.respVid) continue;
    d.resp[v.stationId] = (d.resp[v.stationId] ?? 0) + 1;
    if (v.id > max) max = v.id;
  }
  d.respVid = max;
}

/** JusticeSystem.monthly (after the justice model): responses roll, city fill + BF.Understaffed, use factors */
export function facilityMonthly(sim: Simulation, scan: { plopped: Building[]; cityFill: number } = monthlyScan(sim.state)): void {
  const d = justiceData(sim.state);
  d.respLast = d.resp;
  d.resp = {};
  if (scan.cityFill > 0) d.cityFill = Math.round(scan.cityFill * 1e4) / 1e4;
  updateUseFactors(sim, scan.plopped);
}

/** update every tier facility's BF.Understaffed now (tests / tools; the simulation spreads it over the month) */
export function updateStaffingFlags(sim: Simulation): void {
  for (const b of monthlyScan(sim.state).tier) if (sim.state.buildings.get(b.id) === b) updateStaffFlag(sim, b);
}

// ================================================================================================ report
interface Ctx {
  sim: Simulation;
  st: CityState;
  b: Building;
  def: BuildingDef;
  lines: FacilityLine[];
  warnings: string[];
  load: FacilityLoad | null;
}
const TIER_UNIT: Readonly<Record<string, [string, string]>> = {
  elementary: ['Pupils', 'children (0-11)'], high: ['Students', 'teens (12-17)'], college: ['Students', 'young adults and adult learners'],
  library: ['Learners', 'adult learners'], clinic: ['Patients', 'patients'], hospital: ['Beds', 'patients'], play: ['Kids & teens', 'kids and teens'],
  green: ['Visitors', 'residents'], police: ['Patrol load', 'people'], fire: ['Protected', 'residents'],
};
const UNREACHED_TEXT: Readonly<Partial<Record<NeedTier, string>>> = {
  elementary: 'children live out of reach of any elementary school', high: 'teens live out of reach of any high school',
  college: 'would-be students live out of reach of any college place', health: 'patients live out of reach of any clinic or hospital',
  play: 'kids and teens have no playground or sports field within reach', green: 'residents have no park within a walk',
  police: 'people live beyond every police patrol', fire: 'residents live beyond every fire station',
};

function add(c: Ctx, key: string, label: string, value: string, extra: Partial<FacilityLine> = {}): void {
  c.lines.push({ key, label, value, ...extra });
}
function statusOfUtil(u: number): 'ok' | 'warn' | 'bad' {
  return u > OVERCROWDED_UTIL ? 'bad' : u > 1 ? 'warn' : 'ok';
}

/** the reach (walk / drive / disk) of a tier facility — cached per building and day for the report's catchment sums */
const reachMemo = new Map<number, { day: number; key: string; seniors: number; residents: number }>();
let reachScratch: ReachScratch | null = null;
function catchmentPeople(st: CityState, b: Building): { seniors: number; residents: number } {
  const inf = infoOf(st, b);
  const key = `${b.def}:${b.x}:${b.z}:${b.w}:${b.d}`;
  const m = reachMemo.get(b.id);
  if (m && m.day === st.day && m.key === key) return m;
  if (!reachScratch || reachScratch.idx.length < 1024) reachScratch = newReachScratch(4096);
  const metric = inf.metric === 0 ? 'walk' : inf.metric === 1 ? 'drive' : 'euclid';
  const n = reachCells(st, b.x, b.z, b.w, b.d, inf.tierRadius, metric, reachScratch);
  const idx = reachScratch.idx, w = reachScratch.w;
  const sh = new Float32Array(5);
  let seniors = 0, residents = 0;
  for (let q = 0; q < n; q++) {
    const bid = st.building[idx[q]];
    if (bid < 0) continue;
    const r = st.buildings.get(bid);
    if (!r || r.pop <= 0) continue;
    const per = (r.pop / (r.w * r.d)) * w[q];
    residents += per;
    seniors += per * cohortShares(r, sh)[4];
  }
  const out = { day: st.day, key, seniors, residents };
  if (reachMemo.size > 256) reachMemo.clear();
  reachMemo.set(b.id, out);
  return out;
}

function upkeepLine(c: Ctx): void {
  const up = c.def.upkeep ?? 0;
  if (!(up > 0)) return;
  const svc = c.def.service;
  const f = svc ? c.st.budget.funding[svc] ?? 100 : 100;
  add(c, 'upkeep', 'Upkeep', `${money(up * (svc ? f / 100 : 1))} / month${svc && f !== 100 ? ` (${f}% funding)` : ''}`);
}

function staffLine(c: Ctx, tier: boolean): void {
  const { st, b } = c;
  const jobs = b.capacity > 0 ? b.capacity : c.def.jobs ?? 0;
  if (!(jobs > 0)) return;
  const s = staffingOf(st, b);
  if (tier && s) {
    const op = STAFF_OP_MIN + (1 - STAFF_OP_MIN) * s.rel;
    const low = s.rel < STAFF_FLAG || !s.road;
    add(c, 'staff', 'Staff', `${fmt(s.jobs)} / ${fmt(s.slots)} — service at ${pct(op)}`, {
      ratio: s.staff, status: low ? 'bad' : s.rel < 0.95 ? 'warn' : 'ok',
      hint: !s.road ? 'No road access — build a road beside it' : low ? "Workers can't reach it — connect its road to where people live" : undefined,
    });
  } else {
    add(c, 'jobs', 'Jobs filled', `${fmt(b.jobs)} / ${fmt(jobs)}`, { ratio: jobs > 0 ? Math.min(1, b.jobs / jobs) : undefined });
  }
  const cf = (st.systemData.justice as { cityFill?: number } | undefined)?.cityFill ?? -1;
  if (cf > 0 && cf < STAFF_CITY_INFO) add(c, 'cityStaff', 'City workforce', `all employers are ${pct(cf)} staffed — the city needs more workers`);
}

/** operating quality of a tier facility with its reasons */
function qualityLine(c: Ctx): void {
  const L = c.load;
  if (!L) return;
  const op = L.operating;
  const why: string[] = [];
  const { st, b, def } = c;
  if ((def.powerUse ?? 0) > 0 && !(b.flags & BF.Powered)) why.push(`no power (x${UNPOWERED_SERVICE_EFF})`);
  if (L.needTier === 'health' && (def.waterUse ?? 0) > 0 && !(b.flags & BF.Watered)) why.push(`no water (x${UNWATERED_HEALTH_EFF})`);
  const svc = def.service;
  if (svc) {
    if (onStrike(st, svc)) why.push('on strike');
    else if ((st.budget.funding[svc] ?? 100) < 100) why.push(`${st.budget.funding[svc]}% funding`);
  }
  const s = staffingOf(st, b);
  if (s && s.rel < 1) why.push(`staff ${pct(STAFF_OP_MIN + (1 - STAFF_OP_MIN) * s.rel)}`);
  add(c, 'quality', 'Service quality', pct(Math.min(op, 1.5)), {
    ratio: Math.min(1, op), status: op < 0.5 ? 'bad' : op < 0.9 ? 'warn' : 'ok', hint: why.length ? why.join(' · ') : undefined,
  });
}

/** seats / patients / visitors of a shared tier facility, crowding, city-wide unreached */
function seatLines(c: Ctx): void {
  const L = c.load;
  const { st, def } = c;
  if (!L) {
    const cv = def.coverage;
    if (cv?.tier && cv.capacity) add(c, 'seats', TIER_UNIT[cv.tier]?.[0] ?? 'Capacity', `— / ${fmt(cv.capacity)} (not yet assessed)`);
    return;
  }
  const tier = L.tier;
  const unit = TIER_UNIT[tier] ?? ['Capacity', 'people'];
  if (Number.isFinite(L.capacity)) {
    if (tier === 'hospital') {
      add(c, 'beds', 'Beds', `${fmt(L.seated / PATIENTS_PER_BED)} / ${fmt(L.capacity / PATIENTS_PER_BED)}`, {
        ratio: L.utilization, status: statusOfUtil(L.utilization),
        hint: L.utilization > OVERCROWDED_UTIL ? 'Overcrowded — everyone in its area gets less care; build another hospital or clinic nearby' : undefined,
      });
    } else {
      const crowdHint = tier === 'police' ? 'Overloaded — patrols thin out over its whole area; build another station nearby'
        : tier === 'elementary' || tier === 'high' || tier === 'college' ? 'Overcrowded — every pupil in its area learns less; build another school nearby'
        : tier === 'clinic' ? 'Overcrowded — everyone in its area gets less care; build another clinic nearby'
        : 'Crowded — visitors get less out of it; build another park nearby';
      add(c, tier === 'police' ? 'patrolLoad' : 'seats', unit[0], `${fmt(tier === 'police' ? L.demand : L.seated)} / ${fmt(L.capacity)} (${pct(L.utilization)})`, {
        ratio: L.utilization, status: statusOfUtil(L.utilization), hint: L.utilization > 1 ? crowdHint : undefined,
      });
    }
    if (L.demand > L.seated * 1.02 && tier !== 'police') add(c, 'demand', 'Want a place', fmt(L.demand), { status: 'warn' });
    if (L.utilization > OVERCROWDED_UTIL) c.warnings.push(`Overcrowded (${pct(L.utilization)} of capacity)`);
  } else {
    add(c, 'served', unit[0], `≈ ${fmt(L.served)} ${unit[1]}`);
  }
  const need = st.stats.needs?.[L.needTier];
  if (need && need.unreached > 0.5 && L.needTier !== 'police' && UNREACHED_TEXT[L.needTier]) {
    add(c, 'unreached', 'Out of reach (city)', `${fmt(need.unreached)} ${UNREACHED_TEXT[L.needTier]}`, { status: need.unreached > 0.1 * need.need ? 'warn' : 'ok' });
  }
}

function fleetLine(c: Ctx, noun: [string, string]): void {
  const em = emergencyOf(c.sim);
  const f = em?.stationFleet(c.b.id);
  if (!f) return;
  const d = justiceData(c.st);
  const now = d.resp[c.b.id] ?? 0, last = d.respLast[c.b.id] ?? 0;
  add(c, 'fleet', noun[1][0].toUpperCase() + noun[1].slice(1), f.total > 0 ? `${f.total} (${f.out} out)` : '0 — underfunded', {
    ratio: f.total > 0 ? f.out / f.total : undefined, status: f.total === 0 ? 'bad' : f.free === 0 ? 'warn' : 'ok',
    hint: f.total === 0 ? 'Raise the budget above 25% to put units back on the road' : f.free === 0 ? 'Every unit is out — a nearby station would cover the next call' : undefined,
  });
  add(c, 'responses', 'Calls answered', `${now} this month · ${last} last month`);
  const r = em?.stationList().find((s) => s.id === c.b.id);
  if (r) add(c, 'range', 'Auto-dispatch range', `${r.range.toFixed(1)} min by road`, { hint: 'Farther incidents need you to dispatch a unit (LIVE mode)' });
}

function justiceCityLines(c: Ctx): void {
  const j = c.st.stats.justice;
  if (!j) return;
  const places = j.beds + j.holding;
  if (places <= 0 && j.inmates < 1 && j.arrestsMonth <= 0) return;
  add(c, 'jails', 'Jails & holding cells', `${fmt(j.inmates)} / ${fmt(places)} (${pct(j.occupancy)} full)`, {
    ratio: j.occupancy, status: j.occupancy > 1.2 ? 'bad' : j.occupancy > 1 ? 'warn' : 'ok',
  });
  if (j.overflow > 0.05) {
    const fix = fundingFactor(c.st, 'police') <= 0 ? 'raise the police budget' : prisonAvailable(c.st) ? 'build a prison' : 'build a police station';
    add(c, 'overflow', 'Released early', `${pct(j.overflow)} of sentenced offenders`, {
      status: j.overflow > 0.3 ? 'bad' : 'warn', hint: `+${pct(JUSTICE_CRIME_K * j.overflow)} crime and ${pct(JUSTICE_POLICE_K * j.overflow)} weaker patrols — ${fix}`,
    });
  }
}

function prestigeLines(c: Ctx): void {
  const d = c.def;
  if (d.prestige) add(c, 'prestige', 'Prestige', `${d.prestige.amount} within ${d.prestige.radius} tiles`, { hint: 'Wealthy residents and high-end offices like to be near it' });
  if (d.landValue && d.landValue.amount > 0 && !d.prestige) add(c, 'landValue', 'Land value', `+${d.landValue.amount} within ${d.landValue.radius} tiles`);
  if (d.campus) add(c, 'campus', 'Campus draw', `${d.campus.amount} within ${d.campus.radius} tiles`, { hint: 'Offices and high-tech industry grow near it' });
}
function nuisanceLines(c: Ctx): void {
  const d = c.def;
  if (d.stigma && d.stigma.amount >= 0.1) add(c, 'stigma', 'Unwanted neighbour', `stigma ${d.stigma.amount} within ${d.stigma.radius} tiles`, { status: d.stigma.amount >= 0.4 ? 'warn' : 'ok', hint: 'Keep homes away — put it next to industry' });
  const spill = byDef(CRIME_SPILL, d.id);
  if (spill) add(c, 'crimeSpill', 'Crime nearby', `+${spill.amount} within ${spill.radius} tiles`, { status: 'warn', hint: 'Police coverage around it keeps it down' });
  const p = d.pollution;
  if (p && d.category !== 'power') {
    const parts: string[] = [];
    if ((p.air ?? 0) > 0) parts.push(`smoke ${p.air}`);
    if ((p.water ?? 0) > 0) parts.push(`water ${p.water}`);
    if ((p.noise ?? 0) >= 0.2) parts.push(`noise ${p.noise}`);
    if (parts.length && p.radius) add(c, 'pollution', 'Pollution', `${parts.join(', ')} within ${p.radius} tiles`, { status: (p.air ?? 0) >= 0.5 || (p.water ?? 0) >= 0.5 || (p.noise ?? 0) >= 0.5 ? 'warn' : 'ok' });
  }
}

/** tourists of a venue (WP4) */
function tourismLine(c: Ctx): void {
  if (!ATTRACTIONS[c.def.id]) return;
  const v = venueVisits(c.st, c.b.id);
  if (!v) { add(c, 'tourists', 'Tourists', `— / ${fmt(ATTRACTIONS[c.def.id].capacity)} a day (next month)`); return; }
  const issue = v.op <= 0 ? venueIssue(c.st, c.b, c.def) : null;
  add(c, 'tourists', 'Tourists', `${fmt(v.visits)} / ${fmt(v.capacity)} a day`, {
    ratio: v.capacity > 0 ? v.visits / v.capacity : undefined, status: v.op <= 0 ? 'bad' : 'ok',
    hint: issue === 'noRoad' ? 'Tourists need a road next to it' : issue === 'unpowered' ? 'Closed without power' : issue === 'closed' ? 'Closed' : undefined,
  });
}

/** cap relief (WP4-3, x use factor) and income */
function reliefIncomeLines(c: Ctx): void {
  const { st, b, def } = c;
  const r = capReliefOf(def.id);
  const use = facilityUseFactor(st, b);
  if (r) {
    const parts: string[] = [];
    if (r.R || r.R3) parts.push(`+${fmt((r.R ?? 0) + (r.R3 ?? 0))} residents`);
    if (r.C || r.CO3) parts.push(`+${fmt((r.C ?? 0) + (r.CO3 ?? 0))} commercial jobs`);
    if (r.I || r.IHT) parts.push(`+${fmt((r.I ?? 0) + (r.IHT ?? 0))} industrial jobs`);
    if (parts.length) add(c, 'relief', 'Demand cap', parts.join(', ') + (use < 0.999 ? ` (x${use.toFixed(2)} use)` : ''), { hint: 'Lets the city grow past its demand caps' });
  }
  if ((def.income ?? 0) > 0) {
    const deal = def.category === 'reward';
    const v = (def.income ?? 0) * (deal ? 1 : venueIncomeFactor(st, b.id, def.id)) * use * (b.flags & BF.Burnt ? 0 : 1);
    add(c, 'income', deal ? 'Deal income' : 'Income', `${money(v)} / month`);
  }
}

function powerLines(c: Ctx, u: UtilitiesSystem | undefined): void {
  const { st, b, def } = c;
  const pi = u?.producerInfo(b.id) ?? null;
  const nominal = def.powerOut ?? 0;
  if (pi && pi.kind === 'power') {
    const cut = pi.factors.filter((f) => f.mul < 0.999).map((f) => `${f.label} ${pct(f.mul)}`);
    add(c, 'output', 'Output', `${fmt(pi.output)} / ${fmt(pi.nominal)} MW`, { ratio: pi.nominal > 0 ? pi.output / pi.nominal : undefined, status: pi.output < 0.5 * pi.nominal ? 'warn' : 'ok', hint: cut.length ? cut.join(' · ') : undefined });
    if (pi.load >= 0) add(c, 'load', 'Grid load', pct(pi.load), { ratio: pi.load, status: pi.load >= 0.999 ? 'bad' : pi.load > 0.9 ? 'warn' : 'ok', hint: pi.load >= 0.999 ? 'Its grid needs more power — build another plant or connect grids' : undefined });
  } else add(c, 'output', 'Output', `${fmt(nominal)} MW (next utilities pass)`);
  const g = u?.gridInfo(c.sim, b.x, b.z);
  if (g) add(c, 'grid', 'Grid', `${fmt(g.demand)} / ${fmt(g.supply)} MW used`, { status: g.shortage ? 'bad' : 'ok' });
  if ((def.waterUse ?? 0) > 0) {
    const wet = (b.flags & BF.Watered) !== 0;
    add(c, 'cooling', 'Cooling water', wet ? `${fmt(def.waterUse ?? 0)} kL/day, connected` : `none — output x${THERMAL_UNWATERED}`, { status: wet ? 'ok' : 'bad', hint: wet ? undefined : 'Connect it to a water network (a road with water)' });
  }
  if ((def.pollution?.air ?? 0) > 0) add(c, 'smoke', 'Smoke', `${def.pollution!.air} within ${def.pollution!.radius ?? 0} tiles, by load`, { status: (def.pollution!.air ?? 0) >= 0.5 ? 'warn' : 'ok', hint: 'Keep it downwind of homes' });
  if ((def.id + def.model).includes('nuclear') && ordinanceEffect(st, 'power.nuclear') <= 0) c.warnings.push('Shut down by the Nuclear-Free Zone ordinance');
}

function waterLines(c: Ctx, u: UtilitiesSystem | undefined): void {
  const { sim, st, b, def } = c;
  const pi = u?.producerInfo(b.id) ?? null;
  if (pi && pi.kind === 'water') {
    const cut = pi.factors.filter((f) => Math.abs(f.mul - 1) > 0.001).map((f) => `${f.label} ${pct(f.mul)}`);
    add(c, 'output', 'Output', `${fmt(pi.output)} / ${fmt(pi.nominal)} kL/day`, { ratio: pi.nominal > 0 ? pi.output / pi.nominal : undefined, status: pi.output < 0.5 * pi.nominal ? 'warn' : 'ok', hint: cut.length ? cut.join(' · ') : undefined });
    if (pi.load > 0.01) add(c, 'intake', 'Intake pollution', pct(pi.load), { ratio: pi.load, status: pi.load > 0.3 ? 'bad' : pi.load > 0.1 ? 'warn' : 'ok', hint: 'Polluted ground or river water lowers output and tap-water quality' });
  } else add(c, 'output', 'Output', `${fmt(def.waterOut ?? 0)} kL/day (next utilities pass)`);
  const q = u ? u.waterQualityAt(sim, centerCell(st, b)) : st.stats.tapWater ?? 1;
  add(c, 'quality', 'Tap water', `${pct(q)} clean`, { ratio: q, status: q < 0.6 ? 'bad' : q < 0.8 ? 'warn' : 'ok', hint: q < 0.6 ? 'Unsafe tap water — build a water treatment plant' : undefined });
  const w = u?.waterInfo(sim, b.x, b.z);
  if (w) add(c, 'network', 'Network', `${fmt(w.demand)} / ${fmt(w.supply)} kL/day used`, { ratio: w.supply > 0 ? w.demand / w.supply : undefined, status: w.shortage ? 'bad' : 'ok', hint: w.shortage ? 'Demand exceeds supply — add a pump or treatment plant' : undefined });
  if (infoOf(st, b).isTreatment) add(c, 'sewage', 'Sewage treated (city)', pct(st.stats.sewageTreated ?? 0), { ratio: st.stats.sewageTreated ?? 0 });
  if (!touchesRoad(st, b)) c.warnings.push('Not next to a road — its water cannot reach the pipes under the roads');
}

function garbageLines(c: Ctx, p: PollutionSystem | undefined): void {
  const { st, b, def } = c;
  const inf = infoOf(st, b);
  const cap = def.garbageCapacity ?? 0;
  if (inf.isIncinerator) {
    const share = p?.incineratorShare(b.id) ?? -1;
    if (share >= 0) add(c, 'burned', 'Burning', `${fmt(share * cap)} / ${fmt(cap)} t/month`, { ratio: share });
    else add(c, 'burned', 'Burning', `— / ${fmt(cap)} t/month (next garbage pass)`);
    const u = c.sim.getSystem<UtilitiesSystem>('utilities');
    const pi = u?.producerInfo(b.id);
    add(c, 'output', 'Power', `${fmt(pi && pi.kind === 'power' ? pi.output : (def.powerOut ?? 0) * Math.max(0, share))} / ${fmt(def.powerOut ?? 0)} MW (by tons burned)`);
  } else if (inf.isRecycling) {
    const sm = p?.garbageSummary();
    let total = 0;
    const f = Math.min(1.2, fundingFactor(st, 'utilities'));
    for (const o of buildingList(st)) {
      const oi = infoOf(st, o);
      if (!oi.isRecycling || !isFunctional(o) || !touchesRoad(st, o)) continue;
      total += oi.garbageCap * f * (o.flags & BF.Powered ? 1 : GARBAGE_UNPOWERED);
    }
    const mine = isFunctional(b) && touchesRoad(st, b) ? cap * f * (b.flags & BF.Powered ? 1 : GARBAGE_UNPOWERED) : 0;
    const rec = sm && total > 0 ? (sm.recycledT * mine) / total : 0;
    add(c, 'recycled', 'Recycling', `${fmt(rec)} / ${fmt(cap)} t/month`, { ratio: cap > 0 ? rec / cap : undefined, hint: `At most ${pct(RECYCLE_MAX_SHARE)} of the collected garbage can be recycled` });
    add(c, 'sales', 'Material sales', `${money(rec * RECYCLING_INCOME_PER_T)} / month`);
  }
  const sm = p?.garbageSummary();
  if (sm && sm.producedT > 0) {
    const un = sm.outOfRangeT + sm.overCapacityT + sm.noRoadT;
    add(c, 'city', 'City garbage', `${fmt(sm.collectedT)} / ${fmt(sm.producedT)} t/month collected`, {
      ratio: sm.collectedT / sm.producedT, status: un > 0.05 * sm.producedT ? 'warn' : 'ok',
      hint: sm.overCapacityT > 1 ? 'Over capacity — zone more landfill or build a recycling center / incinerator' : sm.outOfRangeT > 1 ? 'Some homes are beyond garbage-truck range' : undefined,
    });
  }
  if (!touchesRoad(st, b)) c.warnings.push('No road access — garbage trucks cannot reach it');
}

function policeLines(c: Ctx): void {
  const { st, def } = c;
  seatLines(c);
  fleetLine(c, ['police car', 'patrol cars']);
  const j = st.stats.justice;
  const L = c.load;
  const served = st.stats.needs?.police?.served ?? 0;
  if (j && L && served > 0) add(c, 'arrests', 'Arrests', `≈ ${fmt(j.arrestsMonth * Math.min(1, L.served / served))} / month in its patrol area`);
  const h = byDef(HOLDING_CELLS, def.id);
  if (h) add(c, 'holding', 'Holding cells', `${fmt(h * fundingFactor(st, 'police'))}`, { hint: 'Hold sentenced offenders when there is no prison bed' });
  justiceCityLines(c);
  qualityLine(c);
}

function jailLines(c: Ctx): void {
  const { st, b, def } = c;
  const j = st.stats.justice;
  const beds = (byDef(JAIL_BEDS, def.id) ?? 0) * fundingFactor(st, 'police');
  if (j) {
    const mine = isFunctional(b) ? j.inmates * (j.beds > 0 ? (beds / Math.max(1, j.beds + j.holding)) : 0) : 0;
    add(c, 'inmates', 'Inmates', `${fmt(mine)} / ${fmt(beds)} (${pct(beds > 0 ? mine / beds : 0)})`, { ratio: beds > 0 ? mine / beds : undefined, status: j.occupancy > 1.2 ? 'bad' : j.occupancy > 1 ? 'warn' : 'ok', hint: j.occupancy > 1.2 ? 'Overcrowded — riots break out; build another prison' : undefined });
    add(c, 'flow', 'City arrests', `${fmt(j.arrestsMonth)} / month · releases ${fmt(j.releasesMonth)} / month`);
    justiceCityLines(c);
    add(c, 'policeMul', 'Police effectiveness', pct(j.policeMul), { status: j.policeMul < 0.9 ? 'warn' : 'ok' });
  }
}

function courthouseLines(c: Ctx): void {
  const j = c.st.stats.justice;
  const on = isFunctional(c.b) && fundingFactor(c.st, 'police') > 0;
  add(c, 'court', 'Trials', on ? `police effectiveness x${COURTHOUSE_POLICE_MUL} city-wide` : 'closed', { status: on ? 'ok' : 'bad' });
  if (j) add(c, 'policeMul', 'Police effectiveness', pct(j.policeMul));
  justiceCityLines(c);
}

function roleOf(c: Ctx): string {
  const { st, b, def } = c;
  const inf = infoOf(st, b);
  const cv = def.coverage;
  const r = cv ? Math.round(cv.radius) : 0;
  const how = cv?.metric === 'walk' ? `a ~${r}-tile walk` : cv?.metric === 'euclid' ? `${r} tiles` : `~${r} tiles by road`;
  const tier = inf.tier >= 0 ? SERVICE_TIERS[inf.tier] : undefined;
  if (def.category === 'power') return `Power plant: up to ${fmt(def.powerOut ?? 0)} MW for every building on its grid (power lines and roads conduct)`;
  if (def.category === 'water') return `Water supply: ${fmt(def.waterOut ?? 0)} kL/day into the pipes under the roads it touches`;
  if (inf.isIncinerator) return `Incinerator: burns up to ${fmt(def.garbageCapacity ?? 0)} t/month of garbage and makes up to ${fmt(def.powerOut ?? 0)} MW, by tons burned`;
  if (inf.isRecycling) return `Recycling center: recycles up to ${fmt(def.garbageCapacity ?? 0)} t/month (at most ${pct(RECYCLE_MAX_SHARE)} of the collected garbage) and sells the material`;
  if (byDef(JAIL_BEDS, def.id)) return `Prison: ${fmt(byDef(JAIL_BEDS, def.id) ?? 0)} beds keep sentenced offenders off the streets city-wide`;
  if (def.id === 'civ_courthouse' || def.model === 'civ_courthouse') return `Courthouse: quicker trials make every police patrol ${pct(COURTHOUSE_POLICE_MUL - 1)} more effective`;
  if (tier === 'police') return `Police: patrols homes and businesses within ${how} (${fmt(policeCapacityOf(def.id))} crime-weighted people); its cars answer crime calls`;
  if (tier === 'fire') return `Fire station: fire prevention within ${how}; its trucks answer fires and accidents`;
  if (tier === 'clinic') return `Clinic: care for ${fmt(cv?.capacity ?? 0)} patient-equivalents within ${how} (seniors need ~4x the care); an ambulance answers calls`;
  if (tier === 'hospital') return `Hospital: ${fmt((cv?.capacity ?? 0) / PATIENTS_PER_BED)} beds for patients within ${how}; ambulances answer calls`;
  if (tier === 'elementary') return `Elementary school: ${fmt(cv?.capacity ?? 0)} seats for children (0-11) within ${how}`;
  if (tier === 'high') return `High school: ${fmt(cv?.capacity ?? 0)} seats for teens (12-17) within ${how}`;
  if (tier === 'college') return `College places for ${fmt(cv?.capacity ?? 0)} young adults and adult learners within ${how}`;
  if (tier === 'library') return `Partial college-level learning for ${fmt(cv?.capacity ?? 0)} within ${how}`;
  if (tier === 'play') return `Play space for ${fmt(cv?.capacity ?? 0)} kids and teens within ${how}`;
  if (tier === 'green') return `Green space for ${fmt(cv?.capacity ?? 0)} residents within ${how}`;
  if (useKind(def.id) === 'airport') return `Airport: ${fmt(byDef(AIRPORT_CAP, def.id) ?? 0)} passengers a day; a busy airport raises the demand caps and earns more`;
  if (useKind(def.id) === 'seaport') return `Seaport: up to ${fmt(SEAPORT_TRUCKS)} trucks a day of freight; a busy port raises the industrial cap and freight access`;
  if (def.category === 'landmark') return 'Landmark: prestige draws wealthy residents and offices; tourists come to see it';
  if (def.category === 'reward') return def.income && !def.cost ? `Business deal: ${money(def.income)} / month in exchange for an unwanted neighbour` : def.description ?? 'Reward';
  return def.description ?? CATEGORY_ROLE[def.category] ?? def.name;
}
const CATEGORY_ROLE: Partial<Record<BuildingCategory, string>> = {
  civic: 'Civic building', park: 'Park', transport: 'Transport facility',
};

const APPROVAL_CIVIC: Readonly<Record<string, number>> = { civ_mayor_house: 2, civ_statue: 3, civ_city_hall: 2 };

/** inspector report of a facility (every plopped building of a non-hidden ploppable def); null otherwise */
export function facilityReport(sim: Simulation, buildingId: number): FacilityReport | null {
  const st = sim.state;
  const b = st.buildings.get(buildingId);
  if (!b) return null;
  const def = getDef(b.def);
  if (!def || def.category === 'growable' || def.hidden) return null;
  const inf = infoOf(st, b);
  const c: Ctx = { sim, st, b, def, lines: [], warnings: [], load: inf.tier >= 0 ? facilityLoad(sim, b.id) : null };
  // ---- status warnings (a fix in each)
  if (b.flags & BF.Burnt) c.warnings.push('Burnt down — bulldoze it and build it again');
  else if (b.built < 1) c.warnings.push('Under construction');
  const powered = (b.flags & BF.Powered) !== 0;
  if (!(b.flags & BF.Burnt) && (def.powerUse ?? 0) > 0 && !powered && def.category !== 'power') {
    c.warnings.push(inf.tier >= 0 ? `No power — works at ${pct(UNPOWERED_SERVICE_EFF)}; connect it to a power line or powered road` : 'No power — connect it to a power line or powered road');
  }
  if (!(b.flags & BF.Burnt) && inf.tier >= 0 && c.load?.needTier === 'health' && (def.waterUse ?? 0) > 0 && !(b.flags & BF.Watered)) {
    c.warnings.push(`No water — treatment at ${pct(UNWATERED_HEALTH_EFF)}; connect it to a water network`);
  }
  const svc = def.service as ServiceKind | undefined;
  if (svc && onStrike(st, svc)) c.warnings.push('Staff on strike — raise the budget');
  if (inf.tier >= 0 && def.category !== 'power' && def.category !== 'water' && !touchesRoad(st, b) && !(b.flags & BF.Burnt)) c.warnings.push('No road access — build a road beside it');
  if (b.flags & BF.Understaffed) c.warnings.push("Understaffed — workers can't reach it");
  // ---- per kind
  const tier = inf.tier >= 0 ? SERVICE_TIERS[inf.tier] : undefined;
  if (def.category === 'power') powerLines(c, sim.getSystem<UtilitiesSystem>('utilities'));
  else if (def.category === 'water') waterLines(c, sim.getSystem<UtilitiesSystem>('utilities'));
  else if (def.category === 'garbage') garbageLines(c, sim.getSystem<PollutionSystem>('pollution'));
  else if (byDef(JAIL_BEDS, def.id)) jailLines(c);
  else if (def.id === 'civ_courthouse' || def.model === 'civ_courthouse') courthouseLines(c);
  else if (tier === 'police') policeLines(c);
  else if (tier === 'fire') {
    seatLines(c);
    fleetLine(c, ['fire truck', 'fire trucks']);
    qualityLine(c);
  } else if (tier === 'clinic' || tier === 'hospital') {
    seatLines(c);
    const cp = catchmentPeople(st, b);
    add(c, 'seniors', 'Seniors in its area', `≈ ${fmt(cp.seniors)} of ${fmt(cp.residents)} residents`, { hint: 'Seniors need about 4x the care of adults' });
    fleetLine(c, ['ambulance', 'ambulances']);
    qualityLine(c);
  } else if (tier) {
    seatLines(c);
    qualityLine(c);
  }
  if (useKind(def.id) === 'airport') {
    const d = justiceData(st);
    const cap = byDef(AIRPORT_CAP, def.id) ?? 0;
    const pax = d.useData[b.id] ?? Math.round((airportPassengers(st) * cap) / Math.max(1, cap));
    const u = facilityUseFactor(st, b);
    add(c, 'passengers', 'Passengers', `${fmt(pax)} / ${fmt(cap)} a day`, { ratio: cap > 0 ? pax / cap : undefined, status: u < 0.8 ? 'warn' : 'ok', hint: u < 0.999 ? 'More residents and overnight tourists keep it busier' : undefined });
    add(c, 'use', 'Use', `${pct(u)} of its full demand-cap boost and income`, { ratio: u });
  } else if (useKind(def.id) === 'seaport') {
    const d = justiceData(st);
    const t = d.useData[b.id];
    const u = facilityUseFactor(st, b);
    add(c, 'throughput', 'Throughput', typeof t === 'number' && t >= 0 ? `${fmt(t)} / ${fmt(SEAPORT_TRUCKS)} trucks a day` : 'not counted yet', { ratio: typeof t === 'number' && t >= 0 ? t / SEAPORT_TRUCKS : undefined, hint: u < 0.999 ? 'Industry within reach by road ships through it' : undefined });
    add(c, 'use', 'Use', `${pct(u)} of its full demand-cap boost and income`, { ratio: u, status: u < 0.8 ? 'warn' : 'ok' });
  }
  if (def.category === 'park' || def.category === 'landmark' || def.category === 'civic' || def.category === 'reward' || def.category === 'education' || def.category === 'health') prestigeLines(c);
  const ap = byDef(APPROVAL_CIVIC, def.id);
  if (ap) add(c, 'approval', 'Approval', `+${ap} (civic pride)`);
  tourismLine(c);
  nuisanceLines(c);
  reliefIncomeLines(c);
  staffLine(c, inf.tier >= 0);
  upkeepLine(c);
  // ---- transport part (WP7b hook: bus stop, depot, subway / train / freight stations, garage, ferry)
  const tp = TF.transportFacilityReport(sim, b);
  if (tp) {
    for (const l of tp.lines) c.lines.push(l);
    for (const w of tp.warnings) c.warnings.push(w);
  }
  const role = tp?.role && useKind(def.id) === 'transit' ? tp.role : roleOf(c);
  if (c.lines.length === 0) add(c, 'status', 'Status', isFunctional(b) ? 'working' : 'closed');
  return { title: def.name, role, lines: c.lines, warnings: [...new Set(c.warnings)] };
}

// ================================================================================================ static facts
/**
 * static facts of a def for the toolbar / plop tooltips (WP5 renders them generically): capacity units, fleet, beds,
 * seats, spaces, buses ... (docs/SIM_DEPTH_PART_B.md; appends WP7b's transportDefFacts)
 */
export function facilityDefFacts(defId: string): FacilityLine[] {
  const def = getDef(defId);
  if (!def || def.category === 'growable') return [];
  const out: FacilityLine[] = [];
  const f = (key: string, label: string, value: string, hint?: string) => out.push(hint ? { key, label, value, hint } : { key, label, value });
  const cv = def.coverage;
  const tier = cv?.tier;
  const reach = cv ? (cv.metric === 'walk' ? `~${cv.radius}-tile walk` : cv.metric === 'euclid' ? `${cv.radius} tiles` : `~${cv.radius} tiles by road`) : '';
  if ((def.powerOut ?? 0) > 0) f('output', 'Power', def.garbageCapacity ? `up to ${fmt(def.powerOut ?? 0)} MW, by tons burned` : `${fmt(def.powerOut ?? 0)} MW`);
  if (def.category === 'power' && (def.waterUse ?? 0) > 0) f('cooling', 'Cooling water', `${fmt(def.waterUse ?? 0)} kL/day`, 'Output halves without it');
  if ((def.waterOut ?? 0) > 0) f('output', 'Water', `${fmt(def.waterOut ?? 0)} kL/day`);
  if ((def.garbageCapacity ?? 0) > 0) f('garbage', 'Garbage', `${fmt(def.garbageCapacity ?? 0)} t/month`);
  if (tier === 'police') f('patrol', 'Patrol capacity', `${fmt(policeCapacityOf(def.id))} people · ${reach}`);
  else if (tier === 'hospital') f('beds', 'Beds', `${fmt((cv?.capacity ?? 0) / PATIENTS_PER_BED)} · ${reach}`);
  else if (tier === 'fire') f('reach', 'Fire prevention', reach);
  else if (tier && cv?.capacity) f('seats', TIER_UNIT[tier]?.[0] ?? 'Capacity', `${fmt(cv.capacity)} ${TIER_UNIT[tier]?.[1] ?? ''} · ${reach}`.trim());
  const fl = fleetOfDef(def.id);
  if (fl) {
    const n = fl.units;
    f('fleet', fl.responder === 'fire' ? 'Fire trucks' : fl.responder === 'police' ? 'Patrol cars' : 'Ambulances', `${n}`, `Auto-dispatch within ${stationRange(def, fl.responder).toFixed(1)} min`);
  }
  const h = byDef(HOLDING_CELLS, def.id);
  if (h) f('holding', 'Holding cells', `${h}`);
  const jb = byDef(JAIL_BEDS, def.id);
  if (jb) f('beds', 'Prison beds', `${fmt(jb)}`);
  if (def.id === 'civ_courthouse') f('court', 'Police effectiveness', `+${pct(COURTHOUSE_POLICE_MUL - 1)} city-wide`);
  const ac = byDef(AIRPORT_CAP, def.id);
  if (ac) f('passengers', 'Passengers', `${fmt(ac)} a day`, 'Relief and income scale with use');
  if (def.id === 'tr_seaport') f('throughput', 'Freight', `${fmt(SEAPORT_TRUCKS)} trucks a day`, 'Relief and income scale with use');
  if (def.prestige) f('prestige', 'Prestige', `${def.prestige.amount} within ${def.prestige.radius} tiles`);
  if (def.campus) f('campus', 'Campus draw', `${def.campus.amount} within ${def.campus.radius} tiles`);
  if (def.stigma && def.stigma.amount >= 0.1) f('stigma', 'Unwanted neighbour', `${def.stigma.amount} within ${def.stigma.radius} tiles`);
  const a = ATTRACTIONS[def.id];
  if (a) f('tourists', 'Tourists', `up to ${fmt(a.capacity)} a day`);
  const r = capReliefOf(def.id);
  if (r) {
    const parts: string[] = [];
    if (r.R || r.R3) parts.push(`R +${fmt((r.R ?? 0) + (r.R3 ?? 0))}`);
    if (r.C || r.CO3) parts.push(`C +${fmt((r.C ?? 0) + (r.CO3 ?? 0))}`);
    if (r.I || r.IHT) parts.push(`I +${fmt((r.I ?? 0) + (r.IHT ?? 0))}`);
    if (parts.length) f('relief', 'Demand cap', parts.join(' · '));
  }
  if ((def.income ?? 0) > 0) f('income', 'Income', `${money(def.income ?? 0)} / month`);
  if (def.landValue && def.landValue.amount > 0 && !def.prestige) f('landValue', 'Land value', `+${def.landValue.amount} within ${def.landValue.radius} tiles`);
  if ((def.jobs ?? 0) > 0) f('jobs', 'Jobs', fmt(def.jobs ?? 0));
  if ((def.upkeep ?? 0) > 0) f('upkeep', 'Upkeep', `${money(def.upkeep ?? 0)} / month`);
  for (const t of TF.transportDefFacts(defId)) out.push(t);
  return out;
}

