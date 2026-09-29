/**
 * Advisors & news: contextual advice with per-message cooldowns (no spam: at most ADVICE_PER_MONTH per month,
 * highest priority first, ≥ MIN_COOLDOWN days per message key, doubling while the condition persists), population
 * milestones, and flavor headlines.
 * Advisors: 'finance' | 'utilities' | 'transport' | 'safety' | 'health' | 'environment' | 'planning' (+ 'news').
 * Messages go through sim.notify(text, kind, x, z, advisor).
 *
 * "Why doesn't it grow?" (with the sim-infra utilities layer): a monthly scan of the zoned tiles buildings can use
 * (growable lots + empty tiles facing a road) and of the plopped utilities explains power plants that are not wired to
 * the zones ('gridGap'), isolated plants, burnt plants ('plantBurnt' when no plant stands any more — judged from the
 * plants, not the lagging supply stat — else 'plantBurntPart'), thermal plants without cooling water when the
 * capacity gets tight ('plantDry'), water facilities without a road / power
 * ('waterNoRoad' / 'waterNoPower'), dense zones off the pipe network ('waterGap'), zones without road access
 * ('noRoadAccess'; zoneR / zoneC / zoneI name a family's roadless land instead of asking for more zones) and a city
 * where nothing grows although zones are ready ('noDemand' / 'growthStalled'). Safety: fuel-burning plants (industrial
 * accidents, WP8) in a city without a fire station ('plantNoFire') or beyond every station's reach ('plantFireReach').
 * Rules marked `confirm` read utilities results (which lag an edit by a few days) and only speak when the condition
 * already held at the previous monthly check.
 * openAdvice(sim): the advice that holds right now (Advisors panel: open issues per advisor, highest priority first).
 * advisorIssues(st): the full, unthrottled list of the last monthly pass grouped by advisor (ADVICE_PER_MONTH = 2 only
 * limits what is announced; everything else still shows in the Advisors panel).
 *
 * SIM_DEPTH_SPEC §F / WP5-4 rules (each with a map location): schools / health / playgrounds from the catchment needs
 * (unservedClusters), overcrowded schools / hospitals / police stations (facilityLoad), one fire rule (response gap
 * first — residents beyond auto-dispatch reach, uncoveredHotspots — then prevention coverage), slow ambulances, riot
 * risk, an overcrowded jail, noise, sewage, tap water, landfills filling up, ONE garbage rule (homes without pickup from
 * 300 residents, with the reason: capacity / truck range / no road), hotels, tourism, attractiveness, the bus fleet,
 * parking and regional job markets. PERF (WP5 ≤ 0.03 ms/day): the rules read what other systems already computed —
 * stats.needs (services pass), residentSurvey (approval's monthly survey: garbage pickup), traffic.parkingSummary —
 * plus two cheap sources of their own: Noisy homes counted from building events (NoiseCount), and the residents
 * beyond auto-dispatch reach from the services pass's resident raster and the response layers (one typed-array pass,
 * countRespOut). The two map scans the
 * pre-WP5 rules need (zoned blocks, plopped facilities) run on the last days of the month (MONTH_SCAN_DAYS) and are
 * saved with the city (AdvisorData.scan), so a game loaded mid-scan gives the same advice. The places of the rules
 * (unservedClusters / uncoveredHotspots / the worst home) are looked up only for advice that is announced or listed
 * (Advice.where); the Advisors panel reads advisorIssues (the month tick's list) while the game runs.
 *
 * Flavour headlines: a shuffle bag over HEADLINES (each line once per cycle; lines that don't fit the city's size,
 * season, climate or buildings wait in the bag), and no line again within HEADLINE_REPEAT_DAYS (2 in-game years).
 * Bag / schedule persist in state.systemData.advisors; they use one sim.rng draw per headline like the former pick.
 */
import type { SimSystem, Simulation } from '../Simulation';
import { BF, RESP_NONE, type Building, type CityState, type NeedStat, type NeedTier } from '../CityState';
import { DEV_TYPE_LABELS, DevType, Network, Zone, zoneDensity } from '../../core/types';
import { type EconRuntime, type InfraFlags, econData, infraFlags } from './runtime';
import { capHints, regionInputs } from './demand';
import { residentCoverage, residentSurvey } from './approval';
import { attractivenessBreakdown } from './tourism';
import { facilityLoad, unservedClusters } from '../infra/catchments';
import { emergencyOf, uncoveredHotspots } from '../infra/emergency';
import { EMERG_RMAX, GARBAGE_TRUCK_RANGE } from '../infra/params';
import type { PollutionSystem } from '../infra/pollution';
import type { UtilitiesSystem } from '../infra/utilities';
import type { ParkingSummary } from '../infra/parking';
import { maxLoanAmount, loanRate } from './loans';
import { RNG, hash2 } from '../../core/rng';
import { ZONE_DEVTYPES, getDef } from '../catalog';
import { formatMoney } from './format';

const ADVICE_PER_MONTH = 2;
/** no advice repeats sooner than this (days) */
const MIN_COOLDOWN = 60;
const money = (v: number) => formatMoney(v);
const int = (v: number) => Math.round(v).toLocaleString('en-US');

interface Advice {
  id: string;
  /** days before the same id can repeat */
  cooldown: number;
  priority: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'warning';
  advisor: string;
  x?: number;
  z?: number;
  /** only speak when the condition already held at the previous monthly check (utilities results lag edits) */
  confirm?: boolean;
  /** stay quiet in the news feed while a news item matching this was posted within QUIET_DAYS (another system's news
   *  said the same; the issue still shows in the Advisors panel) */
  quietIf?: RegExp;
  /** the place to act, found only when needed (x / z unset): the rule is announced, or the Advisors panel lists it.
   *  unservedClusters / uncoveredHotspots cost O(cells) / O(buildings) each — most months every open rule is still in
   *  its cooldown and nobody asks (PERF) */
  where?: () => { x?: number; z?: number };
}
/** fill in a lazily located advice's place (see Advice.where); returns the advice */
function placed<T extends { x?: number; z?: number }>(a: T, where: (() => { x?: number; z?: number }) | undefined): T {
  if (where && a.x === undefined) {
    const p = where();
    if (p.x !== undefined && p.z !== undefined) { a.x = p.x; a.z = p.z; }
  }
  return a;
}
/** see Advice.quietIf */
const QUIET_DAYS = 90;
/** a news item matching `re` was posted within QUIET_DAYS */
function recentNews(st: CityState, re: RegExp): boolean {
  const news = st.news;
  for (let k = news.length - 1; k >= 0; k--) {
    const n = news[k];
    if (st.day - n.day > QUIET_DAYS) break;
    if (re.test(n.text)) return true;
  }
  return false;
}

const POP_MILESTONES = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 750000, 1000000];

/** a `confirm` rule speaks once its condition has held this many days (i.e. at the second monthly check in a row) */
const CONFIRM_DAYS = 25;
/** grid / pipe gaps smaller than this (tiles) are not worth a message */
const GAP_MIN_TILES = 6;
/** zoned tiles without any road access before 'noRoadAccess' speaks */
const NO_ACCESS_MIN_TILES = 8;
/** a flavour headline never repeats within this many days (2 in-game years) */
export const HEADLINE_REPEAT_DAYS = 720;

// ------------------------------------------------------------------------------------------------ persistent state
/** advisor state in state.systemData.advisors (plain data, saved with the city) */
export interface AdvisorData {
  v: 1;
  /** absolute day of the next flavour headline */
  nextHeadline: number;
  /** headline shuffle bag (HEADLINES ids, drawn from the end) */
  bag: string[];
  /** headline id -> absolute day it was last shown */
  shown: Record<string, number>;
  /** confirm-rule id -> first day of the current uninterrupted sighting */
  seen: Record<string, number>;
  /** the advice posted lately, oldest first (at most POSTS_KEPT): which news items came from an advice rule — the
   *  Advisors panel shows those only while their rule holds (openAdvice), never as a stale "latest message" */
  posts?: { day: number; id: string; text: string }[];
  /** the month's map scans, taken on MONTH_SCAN_DAYS for the coming month tick (saved: a game loaded on day 28 gives
   *  the advice the uninterrupted game gives) */
  scan?: { month: number; zone?: ZoneScan; fac?: FacScanData };
}
/** advice posts kept in AdvisorData.posts (2 a month at most: two years) */
const POSTS_KEPT = 48;

export function advisorData(st: CityState): AdvisorData {
  let a = st.systemData.advisors as AdvisorData | undefined;
  if (!a || a.v !== 1) {
    // new city: first headline around day 45 (as before); an older save gets a calm first month
    a = { v: 1, nextHeadline: st.day < 45 ? 45 : st.day + 30, bag: [], shown: {}, seen: {} };
    st.systemData.advisors = a;
  }
  a.bag ??= [];
  a.shown ??= {};
  a.seen ??= {};
  return a;
}

// ------------------------------------------------------------------------------------------------ city scans
const isRoadN = (v: number) => v >= Network.Street && v <= Network.Highway;
const R_ZONES = (1 << Zone.ResLow) | (1 << Zone.ResMed) | (1 << Zone.ResHigh);
const C_ZONES = (1 << Zone.ComLow) | (1 << Zone.ComMed) | (1 << Zone.ComHigh);
const I_ZONES = (1 << Zone.IndAg) | (1 << Zone.IndMed) | (1 << Zone.IndHigh);

/** zoned tiles a building can use (growable lots + empty zoned tiles facing a road) and their utilities */
interface ZoneScan {
  /** zoned R/C/I tiles */
  zoned: number;
  /** usable tiles: growable lots + empty zoned tiles 4-adjacent to a road */
  front: number;
  /** usable tiles without power (utilities layer only), first one (cell index, -1 = none) */
  unpowered: number;
  unpoweredAt: number;
  /** usable medium / high density tiles (they need piped water), and those without water */
  needWater: number;
  unwatered: number;
  unwateredAt: number;
  /** usable tiles with everything a building needs (power, water where required), bitmask of their zones, first one */
  ready: number;
  readyZones: number;
  readyAt: number;
  /** zoned tiles in zone blocks without a single road-facing tile, first one */
  noAccess: number;
  noAccessAt: number;
  /** the same per family (0 R, 1 C, 2 I) and the first tile of each (-1 = none) */
  noAccessFam: [number, number, number];
  noAccessFamAt: [number, number, number];
}

/** one pass over the zoned tiles (4-connected blocks flood-filled for road access) */
function scanZones(st: CityState, util: boolean, visited: Uint8Array, stack: Int32Array): ZoneScan {
  const N = st.size, C = st.cells;
  const zone = st.zone, net = st.network, bld = st.building, powered = st.powered, watered = st.watered;
  const r: ZoneScan = {
    zoned: 0, front: 0, unpowered: 0, unpoweredAt: -1, needWater: 0, unwatered: 0, unwateredAt: -1, ready: 0, readyZones: 0, readyAt: -1, noAccess: 0, noAccessAt: -1,
    noAccessFam: [0, 0, 0], noAccessFamAt: [-1, -1, -1],
  };
  const isZ = (i: number) => zone[i] >= Zone.ResLow && zone[i] <= Zone.IndHigh;
  // per block: tiles per family (0 R, 1 C, 2 I) and the first tile of each
  const fam = [0, 0, 0], famAt = [-1, -1, -1];
  visited.fill(0);
  for (let s = 0; s < C; s++) {
    if (visited[s] || !isZ(s)) continue;
    let sp = 0, cells = 0, access = false;
    fam[0] = fam[1] = fam[2] = 0;
    famAt[0] = famAt[1] = famAt[2] = -1;
    stack[sp++] = s;
    visited[s] = 1;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % N;
      cells++;
      const zn = zone[i];
      const f = (1 << zn) & R_ZONES ? 0 : (1 << zn) & C_ZONES ? 1 : 2;
      fam[f]++;
      if (famAt[f] < 0) famAt[f] = i;
      const road = (x > 0 && isRoadN(net[i - 1])) || (x < N - 1 && isRoadN(net[i + 1])) || (i >= N && isRoadN(net[i - N])) || (i + N < C && isRoadN(net[i + N]));
      if (road) access = true;
      if (road || bld[i] >= 0) {
        r.front++;
        const p = !util || powered[i] === 1;
        if (!p) { r.unpowered++; if (r.unpoweredAt < 0) r.unpoweredAt = i; }
        let w = true;
        if (zoneDensity(zn) >= 2) {
          r.needWater++;
          w = !util || watered[i] === 1;
          if (!w) { r.unwatered++; if (r.unwateredAt < 0) r.unwateredAt = i; }
        }
        if (p && w) { r.ready++; r.readyZones |= 1 << zn; if (r.readyAt < 0) r.readyAt = i; }
      }
      if (x > 0 && !visited[i - 1] && isZ(i - 1)) { visited[i - 1] = 1; stack[sp++] = i - 1; }
      if (x < N - 1 && !visited[i + 1] && isZ(i + 1)) { visited[i + 1] = 1; stack[sp++] = i + 1; }
      if (i >= N && !visited[i - N] && isZ(i - N)) { visited[i - N] = 1; stack[sp++] = i - N; }
      if (i + N < C && !visited[i + N] && isZ(i + N)) { visited[i + N] = 1; stack[sp++] = i + N; }
    }
    r.zoned += cells;
    if (!access) {
      r.noAccess += cells;
      if (r.noAccessAt < 0) r.noAccessAt = s;
      for (let f = 0; f < 3; f++) {
        r.noAccessFam[f] += fam[f];
        if (r.noAccessFamAt[f] < 0) r.noAccessFamAt[f] = famAt[f];
      }
    }
  }
  return r;
}

/** any 4-neighbour tile around the footprint (no corners) passes `test` */
function perimeterAny(st: CityState, b: Building, test: (i: number) => boolean): boolean {
  const N = st.size;
  for (let x = b.x; x < b.x + b.w; x++) {
    if (b.z > 0 && test((b.z - 1) * N + x)) return true;
    if (b.z + b.d < N && test((b.z + b.d) * N + x)) return true;
  }
  for (let z = b.z; z < b.z + b.d; z++) {
    if (b.x > 0 && test(z * N + b.x - 1)) return true;
    if (b.x + b.w < N && test(z * N + b.x + b.w)) return true;
  }
  return false;
}

/** plopped utilities by state (buildings resolved from FacScanData at the month tick) */
interface FacilityScan {
  /** power plants (def.powerOut > 0) standing / burnt; standing plants touching no conductor at all */
  plants: Building[];
  plantsBurnt: Building[];
  plantsIsolated: Building[];
  /** nominal MW of the burnt plants */
  burntMW: number;
  /** standing thermal plants (coal / oil / gas / nuclear need cooling water) without water: they run at reduced output */
  plantsDry: Building[];
  /** water producers: working / burnt / not next to a road (no pipes) / next to a road but unpowered */
  waterOk: Building[];
  waterBurnt: Building[];
  waterNoRoad: Building[];
  waterNoPower: Building[];
  /** other plopped buildings that use power but have none (and the first of them) */
  civicUnpowered: number;
  civicFirst: Building | null;
  /** nominal MW of the standing plants (the utilities stats lag a fire / the bulldozer by up to a pass) */
  liveMW: number;
  /** standing plants that burn fuel or garbage (air pollution): industrial accidents can set them on fire (WP8) */
  plantsRisky: Building[];
  /** standing fire stations */
  fireStations: number;
  /** standing seat / patient / patrol facilities (schools, colleges, clinics, hospitals, police) for overcrowding */
  tiered: Building[];
  /** standing bus depots and jails */
  depots: Building[];
  jails: Building[];
}
type IdKeys = 'plants' | 'plantsBurnt' | 'plantsIsolated' | 'plantsDry' | 'waterOk' | 'waterBurnt' | 'waterNoRoad' | 'waterNoPower' | 'plantsRisky' | 'tiered' | 'depots' | 'jails';
const ID_KEYS: readonly IdKeys[] = ['plants', 'plantsBurnt', 'plantsIsolated', 'plantsDry', 'waterOk', 'waterBurnt', 'waterNoRoad', 'waterNoPower', 'plantsRisky', 'tiered', 'depots', 'jails'];
/** FacilityScan as plain data (building ids): saved in AdvisorData.scan */
type FacScanData = { [K in IdKeys]: number[] } & { burntMW: number; civicUnpowered: number; civicFirst: number; liveMW: number; fireStations: number };

function scanFacilities(st: CityState, rt: EconRuntime): FacScanData {
  const f: FacScanData = {
    plants: [], plantsBurnt: [], plantsIsolated: [], burntMW: 0, plantsDry: [], waterOk: [], waterBurnt: [], waterNoRoad: [], waterNoPower: [],
    civicUnpowered: 0, civicFirst: -1, liveMW: 0, plantsRisky: [], fireStations: 0, tiered: [], depots: [], jails: [],
  };
  rt.ensureLists();
  for (const b of rt.plopped) {
    const def = rt.defOf(b);
    if (!def) continue;
    const burnt = (b.flags & BF.Burnt) !== 0;
    if (!burnt && def.category === 'fire') f.fireStations++;
    if (!burnt && b.built >= 1) {
      const tier = def.coverage?.tier;
      if (tier === 'elementary' || tier === 'high' || tier === 'college' || tier === 'clinic' || tier === 'hospital' || tier === 'police') f.tiered.push(b.id);
      if (def.id === 'civ_bus_depot' || def.model === 'civ_bus_depot') f.depots.push(b.id);
      if (def.id === 'civ_jail' || def.model === 'civ_jail') f.jails.push(b.id);
    }
    if ((def.powerOut ?? 0) > 0) {
      if (burnt) { f.plantsBurnt.push(b.id); f.burntMW += def.powerOut!; continue; }
      f.plants.push(b.id);
      f.liveMW += def.powerOut!;
      if ((def.pollution?.air ?? 0) > 0) f.plantsRisky.push(b.id);
      const conducts = (i: number) => st.network[i] !== Network.None || st.powerLines[i] !== 0 || (st.building[i] >= 0 && st.building[i] !== b.id);
      if (!perimeterAny(st, b, conducts)) f.plantsIsolated.push(b.id);
      if (def.category === 'power' && (def.waterUse ?? 0) > 0 && !(b.flags & BF.Watered)) f.plantsDry.push(b.id);
    } else if ((def.waterOut ?? 0) > 0) {
      if (burnt) f.waterBurnt.push(b.id);
      else if (!perimeterAny(st, b, (i) => isRoadN(st.network[i]))) f.waterNoRoad.push(b.id);
      else if ((def.powerUse ?? 0) > 0 && !(b.flags & BF.Powered)) f.waterNoPower.push(b.id);
      else f.waterOk.push(b.id);
    } else if (!burnt && (def.powerUse ?? 0) > 0 && !(b.flags & BF.Powered)) {
      f.civicUnpowered++;
      if (f.civicFirst < 0) f.civicFirst = b.id;
    }
  }
  return f;
}

/** the buildings of a facility scan (ids of buildings removed since the scan are skipped); each list is resolved on
 *  first use (PERF: most months no rule reads the ~200 schools / clinics / stations) */
function resolveFac(st: CityState, d: FacScanData): FacilityScan {
  const get = (ids: readonly number[]) => {
    const out: Building[] = [];
    for (const id of ids) { const b = st.buildings.get(id); if (b) out.push(b); }
    return out;
  };
  const f = { burntMW: d.burntMW, civicUnpowered: d.civicUnpowered, civicFirst: st.buildings.get(d.civicFirst) ?? null, liveMW: d.liveMW, fireStations: d.fireStations } as FacilityScan;
  for (const k of ID_KEYS) {
    let v: Building[] | undefined;
    Object.defineProperty(f, k, { get: () => (v ??= get(d[k] ?? [])), enumerable: true });
  }
  return f;
}

/**
 * Homes flagged Noisy (pollution sets BF.Noisy on residential buildings above NOISY_THRESHOLD and emits buildingChanged
 * on every flip), counted from building events instead of a monthly scan. Rebuilt from the flags for a new state.
 */
class NoiseCount {
  st: CityState | null = null;
  private bits = new Uint8Array(0);
  count = 0;
  reset(st: CityState): void {
    this.st = st;
    this.bits = new Uint8Array(Math.max(1024, st.nextBuildingId + 256));
    this.count = 0;
    for (const b of st.buildings.values()) this.touch(b);
  }
  touch(b: Building): void {
    if (b.id >= this.bits.length) {
      const n = new Uint8Array(Math.max(b.id + 256, this.bits.length * 2));
      n.set(this.bits);
      this.bits = n;
    }
    const v = b.flags & BF.Noisy ? 1 : 0;
    if (v !== this.bits[b.id]) { this.bits[b.id] = v; this.count += v ? 1 : -1; }
  }
  remove(b: Building): void {
    if (b.id < this.bits.length && this.bits[b.id]) { this.bits[b.id] = 0; this.count--; }
  }
}

/** parking pressure above which shoppers give up (WP5-4 parkingPressure; parking.ts highShare counts cells above it) */
const PARKING_FULL = 0.6;

/**
 * residents beyond a fire station's auto-dispatch reach (respFire < 0: beyond range, or no station), from the services
 * pass's resident raster (the 'fire' tier's need raster: residents per cell) — one typed-array pass, no building loop.
 * A populated cell at the layers' floor inside a building with a reached cell counts as reached (a building grown since
 * the last emergency pass keeps the land fill on its inner cells). null without the raster.
 */
function countRespOut(st: CityState, res: Float32Array | null): { residents: number; fireOut: number } | null {
  if (!res || res.length !== st.cells) return null;
  const F = st.respFire, C = st.cells;
  const floor = -EMERG_RMAX + 1e-3, none = RESP_NONE + 0.5;
  let residents = 0, fireOut = 0;
  for (let i = 0; i < C; i++) {
    const r = res[i];
    if (!(r > 0)) continue;
    residents += r;
    const f = F[i];
    if (f < 0 && !(f <= floor && f > none && reachedInBuilding(st, F, i))) fireOut += r;
  }
  return { residents, fireOut };
}
/** the same count from the homes themselves (centre cells): without the services raster (a city without the services
 *  system, synthetic tests) */
function countRespOutHomes(st: CityState, rt: EconRuntime): { residents: number; fireOut: number } {
  const N = st.size, F = st.respFire;
  let residents = 0, fireOut = 0;
  rt.ensureLists();
  for (const b of rt.growables) {
    const p = b.pop;
    if (p <= 0 || b.flags & BF.Abandoned) continue;
    const dev = rt.defOf(b)?.devType;
    if (dev === undefined || dev > DevType.R3) continue;
    const i = Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
    residents += p;
    if (F[i] < 0) fireOut += p;
  }
  return { residents, fireOut };
}
/** another cell of the building at cell i (within 3 cells in a straight line) is within auto-dispatch reach */
function reachedInBuilding(st: CityState, L: Float32Array, i: number): boolean {
  const bid = st.building[i];
  if (bid < 0) return false;
  const N = st.size, x = i % N, bld = st.building;
  for (let d = 1; d <= 3; d++) {
    if (x - d >= 0 && bld[i - d] === bid && L[i - d] >= 0) return true;
    if (x + d < N && bld[i + d] === bid && L[i + d] >= 0) return true;
    if (i - d * N >= 0 && bld[i - d * N] === bid && L[i - d * N] >= 0) return true;
    if (i + d * N < st.cells && bld[i + d * N] === bid && L[i + d * N] >= 0) return true;
  }
  return false;
}

/** the residential lot cell (a building on a residential zone) with the highest layer value passing `test`, -1 = none;
 *  one typed-array pass (ties: the lowest cell index) */
function worstHomeCell(st: CityState, layer: ArrayLike<number>, test?: (i: number) => boolean): number {
  const Z = st.zone, B = st.building, C = st.cells;
  let best = -1, bv = 0;
  for (let i = 0; i < C; i++) {
    const v = layer[i];
    if (!(v > bv) || B[i] < 0) continue;
    const z = Z[i];
    if (z < Zone.ResLow || z > Zone.ResHigh || (test && !test(i))) continue;
    bv = v;
    best = i;
  }
  return best;
}

/** a def can be built: unlocked (or it needs no unlock), or sandbox */
function defAvailable(st: CityState, id: string): boolean {
  const def = getDef(id);
  return !!def && (!def.requires || st.unlocked.has(def.requires) || !!st.config.sandbox);
}

const nameOf = (b: Building) => getDef(b.def)?.name ?? 'building';
/** "1 zoned tile" / "12 zoned tiles" */
const count = (n: number, word: string) => `${Math.round(n).toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

// ------------------------------------------------------------------------------------------------ flavour headlines
interface HeadlineCtx {
  st: CityState;
  pop: number;
  /** 0 = January */
  month: number;
  /** any of these plopped defs stands in the city */
  has: (...defIds: string[]) => boolean;
  /** parks (plopped, category park) */
  parks: number;
  /** open water on the map (lazy) */
  water: () => boolean;
  /** growables per DevType */
  dev: readonly number[];
  /** a fire / any disaster made the news within the last 90 days */
  recentFire: boolean;
  recentDisaster: boolean;
}
interface Headline {
  id: string;
  /** placeholders {city} {mayor} {year} {pop} */
  text: string;
  /** population band [min, max) (every headline also needs more than 300 residents) */
  min?: number;
  max?: number;
  when?: (c: HeadlineCtx) => boolean;
}
const WINTER = (c: HeadlineCtx) => c.month === 11 || c.month <= 1;
const SPRING = (c: HeadlineCtx) => c.month >= 2 && c.month <= 4;
const SUMMER = (c: HeadlineCtx) => c.month >= 5 && c.month <= 7;
const AUTUMN = (c: HeadlineCtx) => c.month >= 8 && c.month <= 10;
const SNOWY = (c: HeadlineCtx) => WINTER(c) && (c.st.config.climate === 'temperate' || c.st.config.climate === 'alpine');
const FIRE_STATION = ['civ_fire_station', 'civ_fire_hq'];

const HEADLINES: readonly Headline[] = [
  // ---- any size
  { id: 'croissant', text: '{city} bakery wins regional croissant championship.' },
  { id: 'tie', text: 'Residents of {city} vote the mayor\'s tie "most daring" of {year}.' },
  { id: 'firecat', text: 'Stray cat elected honorary deputy of the {city} fire brigade.', when: (c) => c.has(...FIRE_STATION) },
  { id: 'market', text: 'Farmers\' market in {city} breaks attendance record.', when: (c) => !WINTER(c) },
  { id: 'houseplants', text: 'Study: {city} residents own more houseplants than anyone in the region.' },
  { id: 'jogging', text: 'Mayor {mayor} spotted jogging at dawn — citizens impressed.' },
  { id: 'gerald', text: 'Pothole named "Gerald" becomes local celebrity before repairs.' },
  { id: 'meteors', text: '{city} sky hosts a spectacular meteor shower tonight.', when: (c) => (c.month === 7 || c.month === 11) && !c.recentDisaster },
  { id: 'umbrella', text: 'Local inventor unveils a self-folding umbrella.' },
  { id: 'townsign', text: 'Historic society restores {city}\'s first town sign.', min: 2000 },
  { id: 'pumpkin', text: 'Community garden produces record-breaking pumpkin.', when: AUTUMN },
  { id: 'robotics', text: 'Local high school robotics team heads to nationals.', when: (c) => c.has('civ_high_school') },
  { id: 'crossword', text: 'Retired teacher, 94, completes her 1,000th crossword in the {city} Gazette.' },
  { id: 'chess', text: 'Chess club champion beats Mayor {mayor} in 14 moves; rematch scheduled.' },
  { id: 'triplets', text: 'Proud parents in {city} welcome triplets; the neighbours organise a nappy drive.' },
  // ---- small town
  { id: 'everyone', text: 'All {pop} residents of {city} invited to the town picnic — potato salad supply "under review".', max: 5000, when: (c) => !WINTER(c) },
  { id: 'bakesale', text: 'Bake sale at {city} town hall raises enough for a brand-new park bench.', max: 20000 },
  { id: 'doorbell', text: 'Local dog learns to ring doorbells, now "visits" every house on the block.', max: 30000 },
  { id: 'tortoise', text: 'Missing tortoise found three streets away after a two-week "adventure".', max: 40000 },
  { id: 'gnomes', text: 'Neighbourhood watch cracks the case of the missing garden gnomes.', max: 50000 },
  { id: 'garageband', text: 'Garage band from {city} plays its first sold-out show (capacity: 40).', max: 60000 },
  // ---- farms, water, seasons, climate
  { id: 'scarecrow', text: 'Scarecrow contest turns the fields around {city} into an open-air gallery.', when: (c) => AUTUMN(c) && c.dev[DevType.IA] > 0 },
  { id: 'goat', text: 'Goat escapes a farm near {city} and briefly directs traffic on Main Street.', when: (c) => c.dev[DevType.IA] > 0 },
  { id: 'duckrace', text: 'Annual rubber duck race ends in a 12-way photo finish.', when: (c) => !WINTER(c) && c.water() },
  { id: 'snowball', text: 'First snowfall of the season turns {city} into a snowball battlefield.', when: SNOWY },
  { id: 'snowday', text: 'Snow day! Schools close and every sledding hill in {city} is at capacity.', when: (c) => SNOWY(c) && c.has('civ_elementary_school', 'civ_high_school') },
  { id: 'carols', text: 'Local choir sets a regional record for the longest carol sing-along.', when: (c) => c.month === 11 },
  { id: 'icecream', text: 'Heatwave: {city} ice cream parlours report record sales.', when: (c) => SUMMER(c) && c.st.config.climate !== 'alpine' },
  { id: 'kites', text: 'Kite festival fills the spring sky above {city}.', when: SPRING },
  { id: 'showers', text: 'April showers: the {city} umbrella shop reports its best month ever.', when: (c) => c.month === 3 && c.st.config.climate !== 'desert' },
  { id: 'litter', text: 'Spring-cleaning volunteers collect two tons of litter from {city} parks.', when: (c) => SPRING(c) && c.parks > 0 },
  { id: 'lizard', text: 'Local lizard wins "most photographed resident" for the third year running.', when: (c) => c.st.config.climate === 'desert' },
  { id: 'coconut', text: 'Coconut falls, narrowly misses the mayor. Coconut unharmed.', when: (c) => c.st.config.climate === 'tropical' },
  { id: 'mtgoat', text: 'Mountain goat seen strolling through downtown {city}; declines to comment.', when: (c) => c.st.config.climate === 'alpine' },
  { id: 'cone', text: 'Traffic cone mysteriously appears on top of the {city} water tower.', when: (c) => c.has('util_water_tower') },
  // ---- growing city
  { id: 'pigeons', text: 'Pigeons stage sit-in on the tallest rooftop in {city}.', min: 3000 },
  { id: 'jazz', text: 'Jazz festival draws thousands to downtown {city}.', min: 5000 },
  { id: 'foodtrucks', text: 'New food truck park in {city} serves 14 kinds of tacos.', min: 5000 },
  { id: 'nightmarket', text: 'Night market opens in {city}; the dumplings sell out in 40 minutes.', min: 8000, when: (c) => !WINTER(c) },
  { id: 'economists', text: 'Economists call {city} "a city on the move".', min: 10000 },
  { id: 'playlist', text: 'Commuters vote the {city} rush-hour radio playlist "surprisingly good".', min: 10000 },
  { id: 'honey', text: 'Rooftop beehives on {city} offices produce 800 jars of "downtown honey".', min: 15000, when: (c) => c.dev[DevType.CO2] + c.dev[DevType.CO3] > 0 },
  { id: 'marathon', text: '{city} marathon: 3,000 runners, one of them dressed as a giant banana.', min: 20000, when: (c) => !WINTER(c) },
  { id: 'parkingapp', text: 'Local startup launches an app that finds free parking. Parking spots unimpressed.', min: 20000 },
  { id: 'squirrels', text: 'Squirrels of {city} declared "the best-fed in the region".', when: (c) => c.parks >= 8 },
  // ---- landmarks & facilities
  { id: 'giraffe', text: '{city} Zoo welcomes a baby giraffe; the naming contest gets 40,000 entries.', when: (c) => c.has('park_zoo') },
  { id: 'thewave', text: 'Stadium crowd in {city} keeps "the wave" going for 11 minutes straight.', when: (c) => c.has('park_stadium') },
  { id: 'trainspotters', text: 'Trainspotters gather to cheer the first freight train of the season through {city}.', when: (c) => c.has('tr_freight_station', 'tr_train_station') },
  { id: 'rubberchicken', text: 'Airport lost-and-found reunites a traveller with her lucky rubber chicken.', when: (c) => c.has('tr_airport_small', 'tr_airport_large') },
  { id: 'catapult', text: 'College students in {city} build a working catapult for physics week.', when: (c) => c.has('civ_college') },
  { id: 'holeinone', text: 'Golfers at the {city} club celebrate the first hole-in-one of the year.', when: (c) => c.has('park_golf') && !WINTER(c) },
  { id: 'ferry', text: '{city} ferry captain marks 10,000 crossings with a long toot of the horn.', when: (c) => c.has('tr_ferry_terminal') },
  { id: 'lighthouse', text: 'Lighthouse open day draws a queue all the way around the harbour.', when: (c) => c.has('lm_lighthouse') },
  { id: 'coaster', text: 'Amusement park unveils a new roller coaster, "only slightly terrifying".', when: (c) => c.has('park_amusement') },
  { id: 'dinohat', text: 'Museum night in {city}: the dinosaur skeleton gets a festive hat.', when: (c) => c.has('civ_museum') },
  { id: 'saturn', text: 'Observatory open night: {city} residents spot the rings of Saturn.', when: (c) => c.has('lm_observatory') },
  { id: 'amnesty', text: 'Library amnesty week: a book comes back 38 years late — "it was very good".', when: (c) => c.has('civ_library') },
  { id: 'busker', text: 'Subway busker plays the same song for 12 hours; {city} commuters now know every word.', when: (c) => c.has('tr_subway_station') },
  // ---- big city
  { id: 'pizza', text: '{city} crowned "Best Pizza Slice" in a hotly disputed regional poll.', min: 50000 },
  { id: 'picnic', text: '{city} office workers set a record for the longest lunch-break picnic.', min: 80000, when: (c) => !WINTER(c) },
  { id: 'skyline', text: 'Skyline photo of {city} goes viral: "Is that a painting?"', min: 100000 },
  { id: 'wifi', text: 'Tech conference in {city} ends early after someone forgets the Wi-Fi password.', min: 120000 },
  { id: 'fashion', text: 'Fashion week in {city}: this season\'s must-have accessory is a reusable coffee cup.', min: 150000 },
  { id: 'magnets', text: 'The {city} tourist office runs out of souvenir fridge magnets.', when: (c) => c.st.stats.tourists > 500 },
  // ---- events & mood
  { id: 'cookies', text: 'Grateful residents bury the {city} fire brigade in home-made cookies.', when: (c) => c.recentFire && c.has(...FIRE_STATION) },
  { id: 'greatcity', text: 'Survey: {city} residents rate their city "pretty great, actually".', when: (c) => c.st.stats.approval >= 72 },
  { id: 'committee', text: 'Residents of {city} form a committee to complain about committees.', when: (c) => c.st.stats.approval < 40 },
  { id: 'scarf', text: 'Commuter knits an entire scarf during one {city} traffic jam.', when: (c) => c.st.stats.avgCommute > 35 },
  { id: 'airjars', text: 'Local artist sells jars of "authentic {city} air". Critics call it breathtaking.', when: (c) => econData(c.st).resPollution > 0.3 },
  { id: 'babyboom', text: 'Maternity ward reports a baby boom as {city} keeps growing.', min: 2000, when: (c) => c.has('civ_clinic', 'civ_hospital', 'civ_medical_center') },
];
const HEADLINE_BY_ID = new Map(HEADLINES.map((h) => [h.id, h]));
/** number of flavour headlines (tests / docs) */
export const HEADLINE_COUNT = HEADLINES.length;

/**
 * Next flavour headline: shuffle bag over every line (each once per cycle); lines that don't fit the city right now stay
 * in the bag for later, and no line comes back within HEADLINE_REPEAT_DAYS. null = nothing fits (skip this one).
 */
function drawHeadline(a: AdvisorData, c: HeadlineCtx, day: number, seed: number): Headline | null {
  const fits = (h: Headline) => {
    const t = a.shown[h.id];
    return (t === undefined || day - t >= HEADLINE_REPEAT_DAYS) && c.pop >= (h.min ?? 0) && c.pop < (h.max ?? Infinity) && (!h.when || h.when(c));
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let k = a.bag.length - 1; k >= 0; k--) {
      const h = HEADLINE_BY_ID.get(a.bag[k]);
      if (!h) { a.bag.splice(k, 1); continue; } // line removed since the save
      if (!fits(h)) continue;
      a.bag.splice(k, 1);
      a.shown[h.id] = day;
      return h;
    }
    if (pass > 0) break;
    // cycle done (for what fits now): refill with every line not in the bag, freshly shuffled, drawn after the
    // leftovers (seasonal / size-gated lines keep their place and come up as soon as they fit)
    const inBag = new Set(a.bag);
    const refill = HEADLINES.filter((h) => !inBag.has(h.id)).map((h) => h.id);
    new RNG(seed).shuffle(refill);
    a.bag = refill.concat(a.bag);
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ WP5 rules
/** what the rules read besides the stats (see the PERF note in the header) */
interface Scans {
  zone: ZoneScan;
  fac: FacilityScan;
  /** homes flagged Noisy (NoiseCount) */
  noisy: number;
  /** residents beyond a fire station's auto-dispatch reach (null: the emergency layers are not computed) */
  resp: { residents: number; fireOut: number } | null;
  /** a rule's map location (unservedClusters / uncoveredHotspots / the worst home), looked up lazily through
   *  Advice.where: fresh on the month tick, memoised for the Advisors panel (LOCATE_TTL) */
  locate: (key: string, f: () => { x: number; z: number } | undefined) => { x?: number; z?: number };
}
const pctS = (v: number) => `${Math.round(v * 100)}%`;
const EDGE_NAME: Record<string, string> = { n: 'north', s: 'south', e: 'east', w: 'west' };
/** a need tier's unreached share (0 without need) */
const unreachedShare = (n: NeedStat | undefined) => (n && n.need > 0 ? n.unreached / n.need : 0);
/** the residents' tolerance for missing services shrinks as the city grows (approval fades garbage in over 2k .. 20k) */
const GARBAGE_FADE = 'Uncollected garbage costs approval from 2,000 residents (full effect at 20,000).';
/** a Prison younger than this (days) is not in the justice stats yet (its beds count from the next monthly pass) */
const JAIL_SETTLE_DAYS = 45;

/**
 * SIM_DEPTH_SPEC §F advisor table + WP5-4 + critic item 31 (one advisor per problem). Every rule names a place to act
 * (unservedClusters / uncoveredHotspots / the facility / the worst home) where one exists.
 */
function depthRules(st: CityState, rt: EconRuntime, inf: InfraFlags, sc: Scans, out: Advice[]): void {
  const s = st.stats, pop = s.population, N = st.size;
  const sim = rt.sim as Simulation | undefined;
  const d = econData(st);
  const at = (b: Building) => ({ x: b.x + (b.w >> 1), z: b.z + (b.d >> 1) });
  const cellAt = (i: number): { x?: number; z?: number } => (i >= 0 ? { x: i % N, z: (i / N) | 0 } : {});
  const cellOf = (i: number) => (i >= 0 ? { x: i % N, z: (i / N) | 0 } : undefined);
  const loc = sc.locate;
  const cluster = (tier: NeedTier): { x?: number; z?: number } => loc('cluster:' + tier, () => {
    const c = sim ? unservedClusters(sim, tier, 1)[0] : undefined;
    return c ? { x: Math.round(c.x), z: Math.round(c.z) } : undefined;
  });
  const hotspot = (r: 'fire' | 'medical'): { x?: number; z?: number } => loc('hot:' + r, () => {
    const h = sim ? uncoveredHotspots(sim, r, 1)[0] : undefined;
    return h ? { x: h.x, z: h.z } : undefined;
  });
  /** the worst home cell by a layer (lazy: only when the advice is announced / listed) */
  const home = (key: string, layer: ArrayLike<number>, test?: (i: number) => boolean) => () => loc(key, () => cellOf(worstHomeCell(st, layer, test)));
  const nd = s.needs;
  const svc = inf.services && !!nd;
  let overloadedPolice: { b: Building; u: number; n: number } | null = null;
  const cov = residentCoverage(st);
  const dev = rt.totals.countByDev;
  const homes = dev[DevType.R1] + dev[DevType.R2] + dev[DevType.R3];
  let shops = 0;
  for (let k = DevType.CS1; k <= DevType.CO3; k++) shops += dev[k];
  const coh = s.cohorts;

  // ---------------- education, health, recreation (catchment needs; residents expect them as the city grows)
  if (svc) {
    const el = nd.elementary;
    if (el && el.need > 0 && el.unreached >= Math.max(300, 0.05 * el.need)) {
      out.push({ id: 'noElementary', cooldown: 120, priority: 6, kind: 'warning', advisor: 'health', where: () => cluster('elementary'),
        text: `${int(el.unreached)} children have no elementary school within walking distance — build one near here.` });
    }
    const hi = nd.high;
    if (hi && hi.need > 0 && hi.unreached >= Math.max(200, 0.05 * hi.need)) {
      out.push({ id: 'noHigh', cooldown: 150, priority: 5, kind: 'warning', advisor: 'health', where: () => cluster('high'),
        text: `${int(hi.unreached)} teenagers have no high school within reach — build one near here, or they drop out and leave.` });
    }
    const co = nd.college;
    if (co && co.need > 0 && pop > 20000 && co.served / co.need < 0.3 && collegeAvailable(st)) {
      const sh = co.served / co.need;
      out.push({ id: 'noCollege', cooldown: 240, priority: 3, kind: 'info', advisor: 'health', where: () => cluster('college'),
        text: `${sh < 0.005 ? 'None of our young adults can' : `Only ${pctS(sh)} of our young adults can`} study here — they move away. A college or library raises EQ and attracts offices.` });
    }
    // seniors without care: the services pass's unreached patient share (stable between passes) × the city's seniors
    const he = nd.health;
    const seniorsOut = he && he.need > 0 ? coh[4] * Math.min(1, he.unreached / he.need) : 0;
    if (seniorsOut >= 500) {
      out.push({ id: 'seniorsHealth', cooldown: 150, priority: 5, kind: 'warning', advisor: 'health', where: () => cluster('health'),
        text: `About ${int(Math.round(seniorsOut / 10) * 10)} seniors have no clinic or hospital in reach — build a clinic near here.` });
    }
    const pl = nd.play;
    const noPlay = unreachedShare(pl);
    if (pop > 5000 && coh[0] > 100 && pl && pl.need > 0 && noPlay >= 0.3) {
      out.push({ id: 'playgrounds', cooldown: 240, priority: 3, kind: 'info', advisor: 'health', where: () => cluster('play'),
        text: `${pctS(noPlay)} of our children have no playground or sports field nearby. Families want them — build playgrounds in residential blocks.` });
    }
    // overcrowded facilities: the worst school / hospital (utilisation of its seats). PERF: only while the services
    // pass counted an overcrowded one (stats.needs[tier].overcrowded: utilisation > 1.15; the rules speak from 1.3)
    const crowded = (t: NeedTier) => (nd[t]?.overcrowded ?? 0) > 0;
    const pn = nd.police;
    const policeRule = pop > 3000 && (unreachedShare(pn) >= 0.25 || cov.police < 0.2);
    if (sim && (crowded('elementary') || crowded('high') || crowded('college') || crowded('health') || (!policeRule && crowded('police')))) {
      let schoolB: Building | null = null, schoolU = 0, clinicB: Building | null = null, clinicU = 0;
      let policeB: Building | null = null, policeU = 0, policeN = 0;
      for (const b of sc.fac.tiered) {
        const L = facilityLoad(sim, b.id);
        if (!L || !(L.capacity > 0) || !Number.isFinite(L.capacity)) continue;
        const u = L.utilization;
        if (L.needTier === 'elementary' || L.needTier === 'high' || L.needTier === 'college') {
          if (!schoolB || u > schoolU) { schoolB = b; schoolU = u; }
        } else if (L.needTier === 'health') {
          if (!clinicB || u > clinicU) { clinicB = b; clinicU = u; }
        } else if (L.needTier === 'police' && u > 1.15) {
          policeN++;
          if (!policeB || u > policeU) { policeB = b; policeU = u; }
        }
      }
      const school = schoolB ? { b: schoolB, u: schoolU } : null;
      const clinic = clinicB ? { b: clinicB, u: clinicU } : null;
      overloadedPolice = policeB ? { b: policeB, u: policeU, n: policeN } : null;
      if (school && school.u >= 1.3) {
        out.push({ id: 'schoolOvercrowded', cooldown: 150, priority: 4, kind: 'warning', advisor: 'health', ...at(school.b),
          text: `${nameOf(school.b)} is at ${Math.round(school.u * 100)}% capacity — every pupil learns less. Build another school nearby.` });
      }
      if (clinic && clinic.u >= 1.3) {
        out.push({ id: 'hospitalOvercrowded', cooldown: 150, priority: 4, kind: 'warning', advisor: 'health', ...at(clinic.b),
          text: `${nameOf(clinic.b)} is at ${Math.round(clinic.u * 100)}% capacity — patients wait and health suffers. Build another clinic or a hospital nearby.` });
      }
    }
    // police: unreached neighbourhoods vs overloaded stations (critic item 31)
    if (sim && policeRule) {
      out.push({ id: 'noPolice', cooldown: 180, priority: 4, kind: 'warning', advisor: 'safety', where: () => cluster('police'),
        text: `${pn && pn.need > 0 ? `${pctS(unreachedShare(pn))} of the city` : 'Most neighborhoods'} ${pn && pn.need > 0 ? 'has' : 'have'} no police patrols. Build a police station near here.` });
    } else if (sim && pop > 3000 && overloadedPolice) {
      const police = overloadedPolice;
      out.push({ id: 'policeOverloaded', cooldown: 180, priority: 4, kind: 'warning', advisor: 'safety', ...at(police.b),
        text: `${police.n > 1 ? `${police.n} police stations are overloaded — ${nameOf(police.b)} patrols` : `${nameOf(police.b)} patrols`} ${Math.round(police.u * 100)}% of its capacity, so crime creeps back. Build another station nearby.` });
    }
  }

  // ---------------- fire: the response gap first (nobody arrives in time without you), prevention second
  const R = sc.resp;
  const fireShare = R && R.residents > 0 ? R.fireOut / R.residents : 0;
  if (pop > 1500 && R && fireShare >= 0.15) {
    const noStation = sc.fac.fireStations === 0;
    // (no station at all: the plants' accident risk is part of this one fire advisor — plantNoFire stays quiet)
    const plants = sc.fac.plantsRisky.length;
    out.push({ id: 'noFireResponse', cooldown: 150, priority: 6, kind: 'warning', advisor: 'safety', where: () => hotspot('fire'),
      text: noStation
        ? `The city has no fire station: every fire waits for you to act and can spread${plants ? `, and an industrial accident could burn down ${plants > 1 ? `one of your ${plants} power plants` : 'your power plant'}` : ''}. Build a Fire Station near here.`
        : `${pctS(fireShare)} of residents live beyond the reach of a fire station — fires there wait for you to dispatch a truck. Build a Fire Station near here${inf.services && cov.fire < 0.2 ? ' (it also lowers the fire risk)' : ''}.` });
  } else if (pop > 3000 && inf.services && cov.fire < 0.2) {
    out.push({ id: 'noFire', cooldown: 180, priority: 5, kind: 'warning', advisor: 'safety', text: 'Most homes are outside fire station coverage. One spark and we lose whole blocks!' });
  }
  // ambulances: medical calls answered late (12-month quality)
  const med = s.emergency?.medScore ?? 1;
  if (pop > 2000 && med < 0.8) {
    out.push({ id: 'slowAmbulances', cooldown: 150, priority: 5, kind: 'warning', advisor: 'health', where: () => hotspot('medical'),
      text: `Ambulances are too slow: only ${pctS(med)} of medical emergencies were answered in time this year. Build a clinic or hospital near here.` });
  }
  // riots: unhappy, lawless districts
  if (pop > 5000 && s.approval < 40 && s.avgCrime > 0.4) {
    out.push({ id: 'riotRisk', cooldown: 120, priority: 8, kind: 'bad', advisor: 'safety', where: home('crime', st.crime),
      text: `Tension is rising: approval is ${Math.round(s.approval)}% and crime ${pctS(s.avgCrime)}. Riots start in unhappy, lawless districts — add police and fix what residents complain about.` });
  }
  // justice: an overfull Prison (or, before one exists, full holding cells) releases convicts early
  const jus = s.justice;
  const jails = sc.fac.jails;
  const settling = jails.some((b) => b.age < JAIL_SETTLE_DAYS);
  if (jus && jus.overflow > 0.2 && pop > 5000 && !settling) {
    const plus = Math.max(0, Math.round(((jus.crimeMul ?? 1) - 1) * 100));
    const crime = `${pctS(jus.overflow)} of convicts are released early${plus > 0 ? ` (+${plus}% crime)` : ''}`;
    out.push({ id: 'jailOvercrowded', cooldown: 150, priority: 6, kind: 'warning', advisor: 'safety', ...(jails[0] ? at(jails[0]) : {}),
      text: jails.length ? `The Prison is overcrowded: ${crime}. Build another Prison — away from wealthy homes.`
        : defAvailable(st, 'civ_jail') ? `The city has no Prison: ${crime}. Build a Prison — away from wealthy homes.`
          : `The police holding cells are full: ${crime}. More police stations add cells until the Prison unlocks at 15,000 residents.` });
  }

  // ---------------- environment and utilities
  if (homes >= 20 && sc.noisy >= 0.1 * homes) {
    out.push({ id: 'noise', cooldown: 180, priority: 4, kind: 'warning', advisor: 'environment', where: home('noisy', st.noise),
      text: `${pctS(Math.min(1, sc.noisy / homes))} of homes are too noisy to sleep. Plant trees along highways and busy roads, or keep homes away from industry and nightlife.` });
  }
  if (pop > 20000 && inf.utilities && s.sewageTreated < 0.5) {
    out.push({ id: 'sewage', cooldown: 240, priority: 4, kind: 'warning', advisor: 'environment',
      text: `${s.sewageTreated < 0.005 ? 'None of our sewage is treated' : `Only ${pctS(s.sewageTreated)} of our sewage is treated`} — the rest pollutes rivers and the drinking water. Build a water treatment plant.` });
  }
  if (pop > 1000 && inf.utilities && s.tapWater < 0.7 && s.waterSupply > 0) {
    // the dirtiest intake (utilities producerInfo: load = intake pollution for water producers)
    let dirty: Building | null = null, worst = 0;
    const u = sim?.getSystem<UtilitiesSystem>('utilities');
    if (u && typeof u.producerInfo === 'function') {
      for (const b of sc.fac.waterOk) {
        const pi = u.producerInfo(b.id);
        if (pi && pi.kind === 'water' && pi.load > worst) { worst = pi.load; dirty = b; }
      }
    }
    out.push({ id: 'tapWater', cooldown: 150, priority: 6, kind: 'warning', advisor: 'utilities', ...(dirty ? at(dirty) : {}),
      text: `Tap water quality is only ${pctS(s.tapWater)} and residents are getting sick. ${dirty ? `Your ${nameOf(dirty)} draws polluted water — ` : ''}build a water treatment plant or move pumps away from pollution (Water data view → Tap water quality).` });
  }
  // landfills filling up (preventive; WP3's own fill news said the same: stay quiet in the feed while it is recent)
  if (s.landfillFill > 0.8 && pop > 300) {
    // the fullest landfill cell (O(cells): only when announced / listed)
    const fullest = () => {
      let bi = -1, bv = -1;
      const F = st.landfillFill;
      for (let i = 0; i < F.length; i++) if (F[i] > bv && st.zone[i] === Zone.Landfill) { bv = F[i]; bi = i; }
      return cellAt(bi);
    };
    out.push({ id: 'landfillFull', cooldown: 180, priority: 5, kind: 'warning', advisor: 'utilities', where: fullest, quietIf: /^Landfills are/,
      text: `Landfills are ${pctS(s.landfillFill)} full — once full they take no more garbage. Zone more landfill, or build an incinerator or recycling center.` });
  }
  // garbage: ONE rule (critic item 31) — residents without pickup (approval's monthly survey), with the reason and
  // where; from 300 residents (QA)
  rt.ensureLists();
  const survey = pop >= 300 ? residentSurvey(st, rt, inf) : null;
  const garbageHomes = survey && survey.pop[3] > 0 ? survey.noGarbage[3] : 0;
  const legacyShort = !inf.pollution && pop > 2000 && s.garbageProduced > s.garbageCapacity * 1.02;
  if ((pop >= 300 && survey !== null && survey.pop[3] >= 200 && garbageHomes >= 0.2) || legacyShort) {
    const gs = sim?.getSystem<PollutionSystem>('pollution')?.garbageSummary?.();
    let reason: 'capacity' | 'range' | 'noRoad' = 'capacity';
    if (gs) {
      const cap = gs.overCapacityT, rng = gs.outOfRangeT, nr = gs.noRoadT;
      reason = rng >= cap && rng >= nr ? 'range' : nr > cap ? 'noRoad' : 'capacity';
      if (s.garbageCapacity <= 0) reason = 'range';
    }
    const share = garbageHomes > 0 ? pctS(garbageHomes) : 'many';
    const tail = pop < 20000 ? ` ${GARBAGE_FADE}` : '';
    const text = s.garbageCapacity <= 0 && (!gs || gs.landfillCapT <= 0)
      ? `Garbage is piling up at the homes of ${share} of residents: the city has nowhere to take it. Zone a landfill (or build an incinerator) and connect it by road.${tail}`
      : reason === 'range'
        ? `Garbage trucks can't reach the homes of ${share} of residents — they are more than ${GARBAGE_TRUCK_RANGE} road tiles from a landfill, incinerator or recycling center. Build one closer (Garbage data view).${tail}`
        : reason === 'noRoad'
          ? `${gs ? int(gs.noRoadBuildings) : 'Many'} buildings have no road at the door, so garbage trucks can't stop there. Build roads to them.${tail}`
          : `Garbage is piling up at the homes of ${share} of residents: landfills and incinerators are full (${int(s.garbageProduced)} t a month made, ${int(s.garbageCapacity)} t taken). Zone more landfill or build an incinerator / recycling center.${tail}`;
    out.push({ id: 'garbage', cooldown: 120, priority: garbageHomes >= 0.5 ? 7 : 6, kind: garbageHomes >= 0.5 ? 'bad' : 'warning', advisor: 'utilities',
      where: home('garbage', st.garbage), quietIf: /^Garbage is piling up/, text });
  }

  // ---------------- tourism, attractiveness, region
  if (pop > 5000 && d.hotelShortage > 50) {
    out.push({ id: 'hotelsFull', cooldown: 240, priority: 3, kind: 'info', advisor: 'planning',
      text: `${int(d.hotelShortage)} overnight tourists a day find no hotel room and stay away. Zone medium or high density commercial land near attractions — hotels grow there.` });
  }
  if (pop > 3000 && s.tourists >= 1000 && s.attractiveness >= 70) {
    out.push({ id: 'tourismGood', cooldown: 720, priority: 1, kind: 'good', advisor: 'planning',
      text: `Tourists love ${st.config.name}: ${int(s.tourists)} visitors a day, and our attractiveness is ${Math.round(s.attractiveness)}/100.` });
  }
  if (pop > 10000 && s.attractiveness > 0 && s.attractiveness < 30) {
    const worst = attractivenessBreakdown(st).filter((t) => t.value < 0).sort((a, b) => a.value - b.value)[0];
    out.push({ id: 'lowAttractiveness', cooldown: 240, priority: 3, kind: 'info', advisor: 'planning',
      text: `Few people want to move here (attractiveness ${Math.round(s.attractiveness)}/100)${worst ? ` — the biggest drag is ${worst.label.toLowerCase()}` : ''}. Culture, parks, safety and clean air draw newcomers and tourists.` });
  }
  const reg = regionInputs(st);
  if (reg) {
    const n = reg.neighbors.filter((x) => x.jobs - x.workers > 20000 && x.edgeF < 0.5).sort((a, b) => b.jobs - b.workers - (a.jobs - a.workers))[0];
    if (n) {
      out.push({ id: 'regionOpportunity', cooldown: 360, priority: 3, kind: 'info', advisor: 'planning',
        text: `${n.name ?? 'Our neighbour'} has ${int(n.jobs - n.workers)} more jobs than workers. Connect a highway on the ${EDGE_NAME[n.edge] ?? n.edge} edge so our residents can commute there (more residential demand).` });
    }
  }

  // ---------------- transit: bus fleet, parking
  const tf = s.transitFleet;
  if (tf && tf.busesNeeded >= 2 && tf.busesNeeded > 1.15 * tf.buses) {
    const dep = sc.fac.depots[0];
    out.push({ id: 'busFleetShort', cooldown: 150, priority: 4, kind: 'warning', advisor: 'transport', ...(dep ? at(dep) : {}),
      text: tf.buses <= 0 && !dep
        ? `Your bus stops have no depot, so no buses run. Build a Bus Depot near the stops.`
        : `Bus stops need ${int(tf.busesNeeded)} buses but the depots run ${int(tf.buses)} — riders wait and drive instead. Build another Bus Depot (or raise the transit budget).` });
  }
  // parking: traffic's parking summary (share of shop / office cells over PARKING_FULL pressure)
  const ps = sim?.getSystem<{ parkingSummary?: ParkingSummary } & SimSystem>('traffic')?.parkingSummary;
  if (ps && shops >= 10 && ps.highShare >= 0.1) {
    const fullest = () => loc('parking', () => {
      // (O(cells), only when announced / listed) the most crowded commercial lot
      let bi = -1, bv = PARKING_FULL;
      const P = st.parking, Z = st.zone;
      for (let i = 0; i < P.length; i++) if (P[i] > bv && Z[i] >= Zone.ComLow && Z[i] <= Zone.ComHigh) { bv = P[i]; bi = i; }
      return cellOf(bi);
    });
    out.push({ id: 'parkingPressure', cooldown: 180, priority: 3, kind: 'info', advisor: 'transport', where: fullest,
      text: defAvailable(st, 'tr_parking_garage')
        ? `Shoppers can't find parking around ${pctS(ps.highShare)} of our shops and offices, so they lose customers. Build a parking garage next to a transit stop.`
        : `Shoppers can't find parking around ${pctS(ps.highShare)} of our shops and offices, so they lose customers. Bus stops nearby let them leave the car at home; parking garages unlock at 15,000 residents.` });
  }
}

/** a college / library def is unlocked (or needs no unlock) */
function collegeAvailable(st: CityState): boolean {
  for (const id of ['civ_college', 'civ_library']) {
    const def = getDef(id);
    if (def && (!def.requires || st.unlocked.has(def.requires) || st.config.sandbox)) return true;
  }
  return false;
}

/** a piece of advice whose condition holds right now (Advisors panel) */
export interface OpenAdvice {
  id: string;
  advisor: string;
  text: string;
  kind: Advice['kind'];
  priority: number;
  x?: number;
  z?: number;
}

export interface AdvisorsSystem extends SimSystem {
  /** advice whose condition holds right now, highest priority first (confirm rules once the monthly pass confirmed
   *  them). Evaluated on demand between the monthly passes; reads the city only (no rng, no state writes) */
  openAdvice(st: CityState): OpenAdvice[];
}

/** the open advice of `sim` (see AdvisorsSystem.openAdvice); [] without the advisors system */
export function openAdvice(sim: Simulation): OpenAdvice[] {
  const sys = sim.getSystem<AdvisorsSystem>('economy.advisors');
  return typeof sys?.openAdvice === 'function' ? sys.openAdvice(sim.state) : [];
}

/** last monthly pass: every issue (unthrottled), per state (derived, not saved: recomputed at the next month tick) */
const lastIssues = new WeakMap<CityState, OpenAdvice[]>();
/** issues of lastIssues whose place is still to be found (Advice.where: looked up on the first read) */
const pendingWhere = new WeakMap<OpenAdvice, () => { x?: number; z?: number }>();

/**
 * The full, unthrottled list of issues of the last monthly pass, grouped by advisor id (highest priority first).
 * ADVICE_PER_MONTH limits only what is announced in the news feed; the Advisors panel shows all of them (with "Show me").
 */
export function advisorIssues(st: CityState): Record<string, OpenAdvice[]> {
  const out: Record<string, OpenAdvice[]> = {};
  for (const a of lastIssues.get(st) ?? []) {
    const w = pendingWhere.get(a);
    if (w) { pendingWhere.delete(a); placed(a, w); }
    (out[a.advisor] ??= []).push(a);
  }
  return out;
}

/** a month tick has produced advisorIssues for this state (this session: the list is derived, not saved) */
export function advisorIssuesReady(st: CityState): boolean {
  return lastIssues.has(st);
}

/** the advice rule a news item came from (null: another system's news, or a post older than the kept ones) */
export function adviceIdOf(st: CityState, n: { day: number; text: string }): string | null {
  const posts = (st.systemData.advisors as AdvisorData | undefined)?.posts;
  if (!posts) return null;
  for (let k = posts.length - 1; k >= 0 && posts[k].day >= n.day; k--) if (posts[k].day === n.day && posts[k].text === n.text) return posts[k].id;
  return null;
}

/** days of the month on which the month tick's map scans are taken (zoned blocks, facilities: spread so the month tick
 *  itself only evaluates rules; deterministic, stale by at most 2 days, saved in AdvisorData.scan) */
export const MONTH_SCAN_DAYS = [28, 29] as const;
/** a found rule place is reused this many days by the Advisors panel (advisorIssues / openAdvice). The month tick looks
 *  the places of what it announces up fresh: the news never depends on when the panel was open */
const LOCATE_TTL = 8;

export function advisorsSystem(rt: EconRuntime): AdvisorsSystem {
  /** flood-fill scratch for the monthly zone scan (re-sized with the map) */
  let scratch = { visited: new Uint8Array(0), stack: new Int32Array(0) };
  const zoneScan = (st: CityState, util: boolean): ZoneScan => {
    if (scratch.visited.length !== st.cells) scratch = { visited: new Uint8Array(st.cells), stack: new Int32Array(st.cells) };
    return scanZones(st, util, scratch.visited, scratch.stack);
  };
  /** the emergency response layers are computed (the fire / ambulance reach of homes is known) */
  const respReady = (st: CityState): boolean => {
    const sim = rt.sim as Simulation | undefined;
    if (!sim || sim.state !== st) return false;
    const em = emergencyOf(sim);
    return !!em && em.active && em.layersReady;
  };
  /** Noisy homes, from building events (see NoiseCount) */
  const noise = new NoiseCount();
  let unsub: (() => void)[] = [];
  let subscribedTo: Simulation | null = null;
  const noisyOf = (st: CityState): number => {
    if (noise.st !== st) noise.reset(st);
    return noise.count;
  };
  /** residents beyond auto-dispatch reach (countRespOut); null while the emergency layers or the services pass are
   *  not there yet */
  const respOut = (st: CityState): { residents: number; fireOut: number } | null => {
    if (!respReady(st)) return null;
    const sim = rt.sim as Simulation;
    const svc = sim.getSystem<SimSystem & { needRaster?: (t: NeedTier) => Float32Array | null }>('services');
    return countRespOut(st, typeof svc?.needRaster === 'function' ? svc.needRaster('fire') : null) ?? countRespOutHomes(st, rt);
  };
  /** Advisors panel: rule locations memoised for LOCATE_TTL days */
  const locMemo = new Map<string, { st: CityState; day: number; at: { x: number; z: number } | null }>();
  const memoLocate = (st: CityState) => (key: string, f: () => { x: number; z: number } | undefined): { x?: number; z?: number } => {
    const m = locMemo.get(key);
    if (m && m.st === st && st.day >= m.day && st.day - m.day <= LOCATE_TTL) return m.at ? { ...m.at } : {};
    const at = f() ?? null;
    locMemo.set(key, { st, day: st.day, at });
    return at ? { ...at } : {};
  };
  /** the month tick: looked up fresh */
  const freshLocate = (_key: string, f: () => { x: number; z: number } | undefined): { x?: number; z?: number } => f() ?? {};

  const headlineCtx = (st: CityState): HeadlineCtx => {
    rt.ensureLists();
    let parks = 0;
    for (const b of rt.plopped) if (!(b.flags & BF.Burnt) && rt.defOf(b)?.category === 'park') parks++;
    let water: boolean | undefined;
    const recent = (re: RegExp | null) => st.news.some((n) => n.kind === 'disaster' && st.day - n.day <= 90 && (!re || re.test(n.text)));
    return {
      st, pop: st.stats.population, month: st.month,
      has: (...ids) => ids.some((id) => (st.milestones[id] ?? 0) > 0),
      parks,
      water: () => (water ??= st.water.includes(1)),
      dev: rt.totals.countByDev,
      recentFire: recent(/fire/i),
      recentDisaster: recent(null),
    };
  };
  const fillHeadline = (text: string, st: CityState) => text.replaceAll('{city}', st.config.name).replaceAll('{mayor}', st.config.mayor)
    .replaceAll('{year}', String(st.year)).replaceAll('{pop}', int(st.stats.population));

  /** every rule's advice holding now; 'month' = the month tick (saved scans, fresh places), 'open' = the Advisors
   *  panel (fresh scans, memoised places, reads the city only) */
  const gather = (st: CityState, mode: 'month' | 'open', scans?: { zone?: ZoneScan; fac?: FacScanData }): Advice[] => {
    const out: Advice[] = [];
    const s = st.stats;
    const d = econData(st);
    const inf = infraFlags(st);
    const pop = s.population;
    const inc = st.budget.lastIncome, exp = st.budget.lastExpense;
    let income = 0, expense = 0;
    for (const k in inc) if (!k.startsWith('oneoff:')) income += inc[k];
    for (const k in exp) if (!k.startsWith('oneoff:')) expense += exp[k];
    const net = income - expense;
    // ---------------- finance
    if (net < 0 && st.funds >= 0 && st.funds < -net * 8 && pop > 0) {
      out.push({ id: 'deficit', cooldown: 90, priority: 8, kind: 'warning', advisor: 'finance',
        text: `We ran a deficit of ${money(-net)} last month and only have ${money(st.funds)} left. Trim services or raise taxes a little.` });
    }
    if (st.funds >= 0 && st.funds < 5000 && pop > 200) {
      const max = maxLoanAmount(st);
      if (max > 0) out.push({ id: 'lowFunds', cooldown: 150, priority: 6, kind: 'warning', advisor: 'finance',
        text: `Funds are low (${money(st.funds)}). The bank would lend up to ${money(max)} at ${(loanRate(st) * 100).toFixed(1)}%.` });
    }
    if (net > 0 && income > 0 && net > income * 0.3 && st.funds > 150000 && pop > 5000) {
      out.push({ id: 'surplus', cooldown: 360, priority: 1, kind: 'good', advisor: 'finance',
        text: `A healthy surplus of ${money(net)}/month! Lower taxes to boost growth, or invest in services and parks.` });
    }
    const rTax = (st.budget.taxRates[0] + st.budget.taxRates[1] + st.budget.taxRates[2]) / 3;
    if (rTax >= 12 && pop > 1000) {
      out.push({ id: 'taxHigh', cooldown: 180, priority: 5, kind: 'warning', advisor: 'finance',
        text: `Residential taxes average ${rTax.toFixed(1)}% — people are leaving for cheaper cities.` });
    }
    // ---------------- utilities
    let zoned = 0;
    for (let z = Zone.ResLow; z <= Zone.IndHigh; z++) zoned += rt.emptyZoned[z];
    const N = st.size;
    const util = inf.utilities;
    const scan = scans?.zone ?? zoneScan(st, util);
    const fac = resolveFac(st, scans?.fac ?? scanFacilities(st, rt));
    const loc = mode === 'month' ? freshLocate : memoLocate(st);
    const at = (b: Building) => ({ x: b.x + (b.w >> 1), z: b.z + (b.d >> 1) });
    const cellAt = (i: number): { x?: number; z?: number } => (i >= 0 ? { x: i % N, z: (i / N) | 0 } : {});
    const burntWhat = (list: Building[], many: string) => (list.length > 1 ? `${list.length} ${many}` : `The ${nameOf(list[0])}`);
    const needPower = zoned > 30 || rt.totals.growables > 0;
    // the grid is dark: no plant delivers, or none stands any more (a fire or the bulldozer took the last one after the
    // utilities' last pass, whose supply stat still counts it)
    const dark = s.powerSupply <= 0 || fac.plants.length === 0;
    if (dark && fac.plantsBurnt.length && (needPower || s.powerDemand > 0)) {
      out.push({ id: 'plantBurnt', cooldown: 60, priority: 10, kind: 'bad', advisor: 'utilities', ...at(fac.plantsBurnt[0]),
        text: `${burntWhat(fac.plantsBurnt, 'power plants')} burned down — the city has no power! Bulldoze the rubble and build a new power plant.` });
    } else if (dark && needPower) {
      if (util && fac.plants.length) {
        // plants stand but deliver nothing (ordinance shutdown, idle incinerator, …)
        out.push({ id: 'noPower', cooldown: 45, priority: 10, kind: 'bad', advisor: 'utilities', confirm: true, ...at(fac.plants[0]),
          text: `Nothing will grow without power! Your ${nameOf(fac.plants[0])} isn't producing any — click it to see why.` });
      } else {
        out.push({ id: 'noPower', cooldown: 45, priority: 10, kind: 'bad', advisor: 'utilities',
          text: 'Nothing will grow without power! Build a power plant and run power lines to your zones.' });
      }
    } else if (!inf.utilities && s.powerDemand > s.powerSupply * 0.99 && s.powerDemand > 0) {
      out.push({ id: 'powerShortage', cooldown: 60, priority: 9, kind: 'bad', advisor: 'utilities',
        text: `Brownouts! Demand of ${s.powerDemand.toFixed(0)} MW exceeds our ${s.powerSupply.toFixed(0)} MW supply. Build a power plant.` });
    } else if (s.powerDemand > s.powerSupply * 0.85 && s.powerSupply > 0) {
      out.push({ id: 'powerTight', cooldown: 180, priority: 4, kind: 'warning', advisor: 'utilities',
        text: `The power grid is at ${Math.round((100 * s.powerDemand) / s.powerSupply)}% capacity. Plan a new plant soon.` });
    }
    // a plant burned down while others still stand (worth a word when it was ≥ 10 % of the nominal capacity). Its own id:
    // the back-off of this note must not hold back the "no power" alarm above once the last plant goes too
    if (!dark && fac.burntMW > 0 && fac.burntMW >= 0.1 * (fac.liveMW + fac.burntMW)) {
      out.push({ id: 'plantBurntPart', cooldown: 90, priority: 7, kind: 'warning', advisor: 'utilities', ...at(fac.plantsBurnt[0]),
        text: `${burntWhat(fac.plantsBurnt, 'power plants')} burned down (−${int(fac.burntMW)} MW). Bulldoze the rubble and replace it before the grid runs short.` });
    }
    // thermal plants without cooling water run at reduced output — only worth a word once the capacity gets tight
    if (util && fac.plantsDry.length && s.powerSupply > 0 && s.powerDemand > s.powerSupply * 0.7) {
      const b = fac.plantsDry[0], n = fac.plantsDry.length;
      out.push({ id: 'plantDry', cooldown: 120, priority: 5, kind: 'warning', advisor: 'utilities', confirm: true, ...at(b),
        text: `${n > 1 ? `${n} power plants have` : `Your ${nameOf(b)} has`} no cooling water, so ${n > 1 ? 'they run' : 'it runs'} at reduced output. Connect ${n > 1 ? 'them' : 'it'} to your water network (pipes run under roads).` });
    }
    // power exists but does not reach the zones (skipped in a brownout: then the farthest consumers are cut on purpose)
    const powerShort = s.powerDemand > s.powerSupply * 1.0001;
    if (util && !dark && !powerShort && (scan.unpowered >= GAP_MIN_TILES || fac.civicUnpowered > 0)) {
      const parts: string[] = [];
      if (scan.unpowered) parts.push(count(scan.unpowered, 'zoned tile'));
      if (fac.civicUnpowered) parts.push(count(fac.civicUnpowered, 'city building'));
      const many = parts.length > 1 || (scan.unpowered || fac.civicUnpowered) > 1;
      const none = scan.front > 0 && scan.unpowered >= scan.front; // not one usable zoned tile has power
      const lone = fac.plants.length > 0 && fac.plantsIsolated.length === fac.plants.length;
      const base = { id: 'gridGap', cooldown: 60, priority: none ? 9 : 6, kind: none ? 'bad' as const : 'warning' as const, advisor: 'utilities', confirm: true };
      if (lone) {
        const who = fac.plants.length > 1 ? 'Your power plants are' : `Your ${nameOf(fac.plants[0])} is`;
        out.push({ ...base, ...at(fac.plantsIsolated[0]),
          text: `${who} running but not connected to anything — ${parts.join(' and ')} ${many ? 'have' : 'has'} no power. Run power lines or a road from the plant to your zones.` });
      } else {
        out.push({ ...base, ...(scan.unpoweredAt >= 0 ? cellAt(scan.unpoweredAt) : fac.civicFirst ? at(fac.civicFirst) : {}),
          text: `Power plants supply ${int(s.powerSupply)} MW, but ${parts.join(' and ')} ${many ? 'aren\'t' : 'isn\'t'} connected to the grid${scan.unpowered ? ', so nothing can grow there' : ''}. Connect ${many ? 'them' : 'it'} with roads or power lines (see the Power data view).` });
      }
    }
    const waterFacilities = fac.waterOk.length + fac.waterBurnt.length + fac.waterNoRoad.length + fac.waterNoPower.length;
    if (pop > 1500 && s.waterSupply <= 0 && (!util || waterFacilities === 0)) {
      out.push({ id: 'noWater', cooldown: 90, priority: 8, kind: 'warning', advisor: 'utilities',
        text: 'Medium and high density buildings need water — build water pumps or towers.' });
    } else if (s.waterDemand > s.waterSupply && s.waterSupply > 0) {
      out.push({ id: 'waterShortage', cooldown: 60, priority: 8, kind: 'bad', advisor: 'utilities',
        text: `Water shortage: ${int(s.waterDemand)} kL/day needed, ${int(s.waterSupply)} available.` });
    }
    if (util) {
      // water facilities that exist but can't deliver (these replace the generic "build water pumps" advice)
      const dry = s.waterSupply <= 0;
      if (fac.waterBurnt.length) {
        out.push({ id: 'waterBurnt', cooldown: 90, priority: dry ? 8 : 5, kind: 'warning', advisor: 'utilities', ...at(fac.waterBurnt[0]),
          text: `${burntWhat(fac.waterBurnt, 'water facilities')} burned down${dry ? ' — the taps have run dry' : ''}. Bulldoze the rubble and build a new one.` });
      }
      if (fac.waterNoRoad.length) {
        const b = fac.waterNoRoad[0];
        out.push({ id: 'waterNoRoad', cooldown: 60, priority: dry ? 8 : 5, kind: 'warning', advisor: 'utilities', ...at(b),
          text: `Your ${nameOf(b)} isn't next to a road, so its water can't reach anyone — pipes run under roads. Build a road beside it.` });
      }
      if (fac.waterNoPower.length) {
        const b = fac.waterNoPower[0], n = fac.waterNoPower.length;
        out.push({ id: 'waterNoPower', cooldown: 60, priority: dry ? 8 : 5, kind: 'warning', advisor: 'utilities', confirm: true, ...at(b),
          text: `${n > 1 ? `${n} water facilities have` : `Your ${nameOf(b)} has`} no power, so ${n > 1 ? 'they' : 'it'} can't pump any water. Connect ${n > 1 ? 'them' : 'it'} to the power grid with a road or power line.` });
      }
      // water flows, but dense zones sit on roads that are not part of its pipe network
      const waterShort = s.waterDemand > s.waterSupply * 1.0001;
      if (s.waterSupply > 0 && !waterShort && scan.unwatered >= GAP_MIN_TILES) {
        const none = scan.unwatered >= scan.needWater;
        const src = fac.waterOk[0];
        out.push({ id: 'waterGap', cooldown: 90, priority: none ? 7 : 5, kind: 'warning', advisor: 'utilities', confirm: true, ...cellAt(scan.unwateredAt),
          text: `Water is flowing, but ${count(scan.unwatered, 'medium/high-density tile')} ${scan.unwatered === 1 ? 'has' : 'have'} none, so they can't grow. Pipes run under roads — connect those roads to the one your ${src ? nameOf(src) : 'water supply'} stands on.` });
      }
    }
    // ---------------- transport
    if (st.neighborConnections.length === 0 && pop > 800) {
      out.push({ id: 'noConnection', cooldown: 240, priority: 5, kind: 'info', advisor: 'transport',
        text: 'Connect to the region! A highway or road off the map edge boosts demand and brings commuters.' });
    }
    if (inf.traffic) {
      let worst = 0, wi = -1;
      const cg = st.congestion;
      const step = Math.max(1, (st.cells / 4096) | 0);
      for (let i = (hash2(st.day, 3) * step) | 0; i < st.cells; i += step) if (cg[i] > worst) { worst = cg[i]; wi = i; }
      if (worst > 1.25 && wi >= 0) {
        out.push({ id: 'gridlock', cooldown: 90, priority: 6, kind: 'warning', advisor: 'transport', x: wi % st.size, z: (wi / st.size) | 0,
          text: 'Traffic is gridlocked here! Upgrade to avenues, add alternate routes or build transit.' });
      }
    }
    if (s.avgCommute > 45 && pop > 3000) {
      out.push({ id: 'commute', cooldown: 180, priority: 5, kind: 'warning', advisor: 'transport',
        text: `Commutes average ${Math.round(s.avgCommute)} minutes. Build highways, avenues, buses or subways.` });
    }
    // ---------------- safety / health / education / environment
    if (pop > 2500 && d.resCrime > 0.35) {
      out.push({ id: 'crime', cooldown: 150, priority: 6, kind: 'warning', advisor: 'safety', text: 'Crime is rising in residential areas. We need more police stations.' });
    }
    // thermal plants and incinerators can have industrial accidents: unanswered, one sets the plant on fire, and a young
    // city can lose its only plant. A fire station in reach answers it (WP8 auto-dispatch; st.respFire < 0 = beyond
    // every station's reach, RESP_NONE while the layer knows no station — all 0 without the emergency system)
    if (fac.plantsRisky.length) {
      // fire trucks drive: a plant wired by power lines alone (no road beside it) can't be reached at all
      const noRoad = (b: Building) => !perimeterAny(st, b, (i) => isRoadN(st.network[i]));
      if (fac.fireStations === 0) {
        const b = fac.plantsRisky[0], n = fac.plantsRisky.length;
        const fix = n > 1 ? 'build a Fire Station within reach of them' : noRoad(b) ? 'build a Fire Station and a road to the plant' : 'build a Fire Station within reach of it';
        out.push({ id: 'plantNoFire', cooldown: 120, priority: 7, kind: 'warning', advisor: 'safety', ...at(b),
          text: `The city has no fire station. An industrial accident at ${n > 1 ? `one of your ${n} power plants` : `your ${nameOf(b)}`} would go unanswered and could burn it down — ${fix}.` });
      } else {
        const far = fac.plantsRisky.filter((b) => {
          const v = st.respFire[(b.z + (b.d >> 1)) * N + b.x + (b.w >> 1)];
          return v < 0 && v > RESP_NONE;
        });
        if (far.length) {
          const b = far[0], n = far.length;
          out.push({ id: 'plantFireReach', cooldown: 150, priority: 5, kind: 'warning', advisor: 'safety', confirm: true, ...at(b),
            text: n === 1 && noRoad(b)
              ? `Fire trucks can't reach your ${nameOf(b)}: no road runs beside it. An industrial accident there could burn it down — build a road to the plant.`
              : `${n > 1 ? `${n} of your power plants are` : `Your ${nameOf(b)} is`} out of reach of your fire stations: an industrial accident there could burn ${n > 1 ? 'them' : 'it'} down. Build a Fire Station closer (see the Fire data view).` });
        }
      }
    }
    if (pop > 5000 && s.eq < 60) {
      out.push({ id: 'eqLow', cooldown: 240, priority: 3, kind: 'info', advisor: 'health',
        text: `Our education quotient is only ${Math.round(s.eq)}. Schools attract offices and high-tech industry (and clean the air of dirty industry).` });
    }
    if (pop > 5000 && s.hq < 60) {
      out.push({ id: 'hqLow', cooldown: 240, priority: 3, kind: 'info', advisor: 'health', text: `Health is poor (HQ ${Math.round(s.hq)}). Build clinics and hospitals.` });
    }
    if (pop > 2000 && d.resPollution > 0.3) {
      out.push({ id: 'airPollution', cooldown: 180, priority: 5, kind: 'warning', advisor: 'environment',
        text: 'Smog is choking our neighborhoods. Separate industry from homes, plant trees, or pass the Clean Air Act.' });
    }
    // ---------------- WP5: services, emergencies, justice, environment, tourism, region, transit (depthRules)
    depthRules(st, rt, inf, { zone: scan, fac, noisy: noisyOf(st), resp: pop > 1500 ? respOut(st) : null, locate: loc }, out);
    // one fire advisor (critic item 31): a city without any fire station hears it once — noFireResponse names the
    // plants' accident risk too
    if (out.some((a) => a.id === 'noFireResponse')) {
      const k = out.findIndex((a) => a.id === 'plantNoFire');
      if (k >= 0) out.splice(k, 1);
    }
    // ---------------- planning
    for (const h of capHints(st)) {
      const what = h.family === 'R' ? 'Residential' : h.family === 'C' ? 'Commercial' : 'Industrial';
      const fix = h.family === 'R' ? 'build parks and recreation' : h.family === 'C' ? 'build an airport or landmarks' : 'build a seaport, freight rail or highway connections';
      out.push({ id: 'cap' + h.family, cooldown: 150, priority: 7, kind: 'warning', advisor: 'planning',
        text: `${what} demand is capped (${h.devs.map((x) => DEV_TYPE_LABELS[x]).join(', ')}) — ${fix}!` });
    }
    const famDemand = (a: number, b: number) => { let m = -1; for (let k = a; k <= b; k++) m = Math.max(m, s.demand[k]); return m; };
    const room = (zs: number[]) => zs.reduce((t, z) => t + rt.emptyFront[z], 0);
    // no room to grow although the family has zoned land that no road reaches: say that, not "zone more land"
    // ('noRoadAccess', a confirm rule, only speaks a month later)
    const roadless = (f: 0 | 1 | 2, what: string, lead: string) => {
      const n = scan.noAccessFam[f];
      return n >= NO_ACCESS_MIN_TILES
        ? { ...cellAt(scan.noAccessFamAt[f]), text: `${lead}, but ${count(n, `${what} tile`)} ${n === 1 ? 'has' : 'have'} no road access, so nothing can be built there — run roads into those zones.` }
        : null;
    };
    if (famDemand(0, 2) > 0.5 && room([Zone.ResLow, Zone.ResMed, Zone.ResHigh]) < 12) {
      out.push({ id: 'zoneR', cooldown: 90, priority: 6, kind: 'info', advisor: 'planning',
        ...(roadless(0, 'residential', 'Residential demand is strong') ?? { text: 'Residential demand is strong but there is no room to grow — zone more residential land along roads.' }) });
    }
    if (famDemand(3, 7) > 0.5 && room([Zone.ComLow, Zone.ComMed, Zone.ComHigh]) < 8) {
      out.push({ id: 'zoneC', cooldown: 90, priority: 6, kind: 'info', advisor: 'planning',
        ...(roadless(1, 'commercial', 'Businesses want to open shops and offices') ?? { text: 'Businesses want to open shops and offices — zone more commercial land.' }) });
    }
    if (famDemand(8, 11) > 0.5 && room([Zone.IndAg, Zone.IndMed, Zone.IndHigh]) < 8) {
      out.push({ id: 'zoneI', cooldown: 90, priority: 6, kind: 'info', advisor: 'planning',
        ...(roadless(2, 'industrial', 'Industry wants to move in') ?? { text: 'Industry wants to move in — zone industrial land, ideally near highways or rail.' }) });
    }
    // sub-type specific: strong demand for a DevType whose zones have no room at all
    const SUBTYPE_HINT: [number, number[], string][] = [
      [DevType.IHT, [Zone.IndHigh], 'High-tech industry wants to move in, but there is no high-density industrial zone. Zone some — clean, educated areas are best.'],
      [DevType.IA, [Zone.IndAg], 'Farmers are looking for land. Zone agricultural land on flat ground away from pollution.'],
      [DevType.CO3, [Zone.ComMed, Zone.ComHigh], 'Corporate offices (CO$$$) want high land value downtown — zone medium or high density commercial.'],
      [DevType.R3, [Zone.ResLow, Zone.ResMed, Zone.ResHigh], 'Wealthy residents are looking for homes. Zone residential land near parks and water.'],
    ];
    for (const [dev, zs, text] of SUBTYPE_HINT) {
      if (s.demand[dev] > 0.6 && room(zs) === 0) out.push({ id: 'zoneDev' + dev, cooldown: 150, priority: 6, kind: 'info', advisor: 'planning', text });
    }
    if (pop > 2000 && s.unemployment > 0.15) {
      out.push({ id: 'unemployment', cooldown: 120, priority: 7, kind: 'warning', advisor: 'planning',
        text: `Unemployment is at ${Math.round(s.unemployment * 100)}%. Zone more commercial and industrial land.` });
    }
    if (pop > 2000 && rt.jobFill < 0.8 && rt.jobFill > 0) {
      out.push({ id: 'workers', cooldown: 120, priority: 5, kind: 'info', advisor: 'planning', text: 'Businesses cannot find enough workers. Zone more residential land.' });
    }
    if (rt.totals.abandoned > 20) {
      out.push({ id: 'abandoned', cooldown: 180, priority: 4, kind: 'warning', advisor: 'planning',
        text: `${rt.totals.abandoned} buildings stand abandoned. Check power, water, road access, crime, pollution and demand.` });
    }
    // ---------------- why nothing grows: road access, demand, land
    if (scan.noAccess >= NO_ACCESS_MIN_TILES) {
      const none = scan.front === 0;
      out.push({ id: 'noRoadAccess', cooldown: none ? 60 : 120, priority: none ? 9 : 5, kind: none ? 'bad' : 'warning', advisor: 'planning', confirm: true,
        ...cellAt(scan.noAccessAt),
        text: none
          ? `Nothing can grow: none of your ${count(scan.zoned, 'zoned tile')} touch a road. Buildings only grow on lots facing a road — build roads through your zones.`
          : `${count(scan.noAccess, 'zoned tile')} ${scan.noAccess === 1 ? 'has' : 'have'} no road access and will never develop. Run a road into those zones.` });
    }
    const alive = rt.totals.growables - rt.totals.abandoned;
    if (alive <= 0 && scan.ready > 0 && st.day >= 60) {
      // zones face a road and have their utilities, yet not a single building stands
      let best = -1;
      for (let z = Zone.ResLow; z <= Zone.IndHigh; z++) if (scan.readyZones & (1 << z)) for (const dv of ZONE_DEVTYPES[z]) best = Math.max(best, s.demand[dv]);
      if (best <= 0.02) {
        const fams = ([['residential', R_ZONES], ['commercial', C_ZONES], ['industrial', I_ZONES]] as const).filter(([, m]) => scan.readyZones & m).map(([n]) => n);
        let tip = 'Lower taxes, or connect a road or highway to the region to bring in demand.';
        if (famDemand(0, 2) > 0.1 && !(scan.readyZones & R_ZONES)) tip = 'Residents want to move in — zone some residential land; shops and jobs follow the people.';
        else if (famDemand(3, 7) > 0.1 && !(scan.readyZones & C_ZONES)) tip = 'Businesses want to open — zone some commercial land.';
        else if (famDemand(8, 11) > 0.1 && !(scan.readyZones & I_ZONES)) tip = 'Industry wants to move in — zone some industrial land.';
        out.push({ id: 'noDemand', cooldown: 90, priority: 7, kind: 'warning', advisor: 'planning', confirm: true, ...cellAt(scan.readyAt),
          text: `Nothing is growing: there is no demand for ${fams.join(' or ')} buildings right now (see the RCI meter). ${tip}` });
      } else if (st.day >= 150 && scan.ready >= 12) {
        out.push({ id: 'growthStalled', cooldown: 120, priority: 6, kind: 'warning', advisor: 'planning', confirm: true, ...cellAt(scan.readyAt),
          text: 'Nothing is growing although there is demand and the zones have roads and utilities. The land may be too steep or too unattractive (pollution, noise, a power plant next door) — check the Desirability data view.' });
      }
    }
    return out;
  };

  return {
    name: 'economy.advisors',
    init(sim) {
      rt.attach(sim);
      const d = econData(sim.state);
      if (!d.popMilestone) d.popMilestone = POP_MILESTONES.filter((m) => m <= sim.state.stats.population).pop() ?? 0;
      // Noisy homes follow the building events (pollution emits buildingChanged on every flag flip)
      if (subscribedTo !== sim) {
        for (const f of unsub) f();
        const live = () => noise.st === sim.state;
        unsub = [
          sim.events.on('buildingChanged', (b) => { if (live()) noise.touch(b); }),
          sim.events.on('buildingAdded', (b) => { if (live()) noise.touch(b); }),
          sim.events.on('buildingRemoved', (b) => { if (live()) noise.remove(b); }),
        ];
        subscribedTo = sim;
      }
      noise.reset(sim.state);
    },
    openAdvice(st) {
      if (!rt.sim || rt.sim.state !== st) return [];
      // read-only: the confirm sightings of the last monthly pass (no advisorData() — it would create the record)
      const seen = (st.systemData.advisors as AdvisorData | undefined)?.seen ?? {};
      return gather(st, 'open')
        .filter((a) => !a.confirm || (seen[a.id] !== undefined && st.day - seen[a.id] >= CONFIRM_DAYS))
        .sort((a, b) => b.priority - a.priority)
        .map((a) => placed({ id: a.id, advisor: a.advisor, text: a.text, kind: a.kind, priority: a.priority, x: a.x, z: a.z }, a.where));
    },
    daily(sim) {
      const st = sim.state;
      const d = econData(st);
      // the month tick's map scans, spread over the month's last days (PERF: month-tick / normal-day cost); saved with
      // the city, so a game loaded in between gives the same advice
      const dom = st.day % 30;
      if (dom === MONTH_SCAN_DAYS[0] || dom === MONTH_SCAN_DAYS[1]) {
        const a0 = advisorData(st);
        if (!a0.scan || a0.scan.month !== st.monthIndex) a0.scan = { month: st.monthIndex };
        if (dom === MONTH_SCAN_DAYS[0] && !a0.scan.zone) a0.scan.zone = zoneScan(st, infraFlags(st).utilities);
        else if (dom === MONTH_SCAN_DAYS[1] && !a0.scan.fac) a0.scan.fac = scanFacilities(st, rt);
      }
      // population milestones
      const pop = st.stats.population;
      for (const m of POP_MILESTONES) {
        if (m > d.popMilestone && pop >= m) {
          d.popMilestone = m;
          sim.notify(`${st.config.name} reaches ${m.toLocaleString('en-US')} residents!`, 'good', undefined, undefined, 'news');
        }
      }
      // flavor headlines (shuffle bag; the schedule persists with the city)
      const a = advisorData(st);
      if (st.day >= a.nextHeadline) {
        a.nextHeadline = st.day + 40 + sim.rng.int(0, 60);
        if (pop > 300) {
          // exactly one draw, like the former rng.pick: the sim's random stream stays as it was
          const seed = (sim.rng.next() * 4294967296) >>> 0 || 1;
          const h = drawHeadline(a, headlineCtx(st), st.day, seed);
          if (h) sim.notify(fillHeadline(h.text, st), 'info', undefined, undefined, 'news');
        }
      }
    },
    monthly(sim) {
      const st = sim.state;
      const d = econData(st);
      const a0 = advisorData(st);
      const ms = a0.scan && a0.scan.month === st.monthIndex - 1 ? a0.scan : undefined;
      delete a0.scan;
      const list = gather(st, 'month', ms).sort((a, b) => b.priority - a.priority);
      // persistent conditions back off: each repeat doubles the cooldown (max ×8); cleared conditions reset
      const streak = (d.streak ??= {});
      const active = new Set(list.map((a) => a.id));
      for (const id of Object.keys(streak)) if (!active.has(id)) delete streak[id];
      // confirm rules: remember the first sighting; they speak once the condition held for CONFIRM_DAYS
      const seen = advisorData(st).seen;
      for (const id of Object.keys(seen)) if (!active.has(id)) delete seen[id];
      for (const a of list) if (a.confirm) seen[a.id] ??= st.day;
      let shown = 0;
      for (const a of list) {
        if (shown >= ADVICE_PER_MONTH) break;
        if (a.confirm && st.day - seen[a.id] < CONFIRM_DAYS) continue;
        const last = d.cooldowns[a.id];
        const cooldown = Math.max(MIN_COOLDOWN, a.cooldown) * 2 ** Math.min(3, streak[a.id] ?? 0);
        if (last !== undefined && st.day - last < cooldown) continue;
        if (a.quietIf && recentNews(st, a.quietIf)) continue;
        d.cooldowns[a.id] = st.day;
        streak[a.id] = (streak[a.id] ?? 0) + 1;
        placed(a, a.where);
        sim.notify(a.text, a.kind === 'info' ? 'advisor' : a.kind, a.x, a.z, a.advisor);
        const posts = (advisorData(st).posts ??= []);
        posts.push({ day: st.day, id: a.id, text: a.text });
        if (posts.length > POSTS_KEPT) posts.splice(0, posts.length - POSTS_KEPT);
        shown++;
      }
      // every open issue for advisorIssues (the announced ones already know their place; the others look it up when read)
      const issues: OpenAdvice[] = [];
      for (const a of list) {
        if (a.confirm && st.day - seen[a.id] < CONFIRM_DAYS) continue;
        const o: OpenAdvice = { id: a.id, advisor: a.advisor, text: a.text, kind: a.kind, priority: a.priority, x: a.x, z: a.z };
        if (a.where && a.x === undefined) pendingWhere.set(o, a.where);
        issues.push(o);
      }
      lastIssues.set(st, issues);
    },
  };
}
