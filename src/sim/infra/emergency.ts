/**
 * Emergency dispatch (SIM_DEPTH_SPEC WP8). Headless: no DOM / three.js.
 *
 * INCIDENTS  fires (fire.ts ignitions become cluster incidents), industrial accidents, hazardous spills, crime sprees,
 *            riots, medical emergencies, building collapses (earthquakes) and prison riots (WP7 justice). Generated
 *            deterministically from the city (own RNG, state saved in systemData.emergency): monthly cumulative weight
 *            arrays over candidate buildings, a daily Poisson draw per kind.
 * FLEETS     every fire / police / medical station has a fleet (FLEET; effective units scale with funding) and an auto
 *            range RANGE = coverage radius x ROAD_RADIUS_FACTOR x NET_TIME[Road] x EMERG_RANGE_K (minutes).
 * DISPATCH   a reverse road search from the incident (siren link times: t0 x (1 + 0.3 (bpr - 1))) settles stations in
 *            order of travel time. Auto: the nearest station of the needed type with a free unit whose travel time is
 *            within its own range (a real road route, driven by a vehicle). Otherwise the incident is 'queued' (a unit
 *            of an in-range station comes back before the grace time) or 'uncovered' (reason busy / outOfRange /
 *            noStation) and the player can dispatch any station city-wide (dispatchOptions / dispatch). Minor
 *            incidents that are not covered are sent the nearest free unit at any range (slower, no alert).
 *            At most EMERG_SEARCHES_PER_DAY auto searches per day; the rest wait for the next day.
 * TIME       one game-minute of siren driving = EMERG_DAYS_PER_MIN sim days. Vehicles carry their route (corner cells)
 *            with cumulative minutes; position = interpolate(times, (simTime - legStart) / EMERG_DAYS_PER_MIN).
 * OUTCOMES   per kind (grace G / deadline): late (answered after G), failed (deadline passed), deaths / injured /
 *            rescued, buildings lost + damage, arrests, riot days -> stats.emergency (month, lastMonth, 12-month year),
 *            medScore (12-month EMA of medical response quality, read by WP1 HQ), approval (WP4 reads lastMonth).
 *            Unattended incidents escalate: fires spread and burn down, riots grow (health damage, ignitions, crime),
 *            industrial accidents ignite, spills pollute, medical calls lose patients.
 * LAYERS     st.respFire / respPolice / respMedical: auto-dispatch slack in minutes (>= 0 reached within a station's
 *            range, < 0 minutes beyond it, RESP_NONE = no station of that type). Scheduler task 'emergency.response'
 *            (3 forward station searches + 3 land fills), every EMERG_RESP_PERIOD days, sooner after station / network
 *            changes, and synchronously in init() (the layers are derived, not saved).
 * EVENTS     sim.events 'emergency' (new / queued / dispatched / arrived / escalated / resolved / failed / uncovered),
 *            news via sim.notify (advisors 'safety' / 'health'), BF.Incident on the site building.
 */
import { RNG } from '../../core/rng';
import { Network } from '../../core/types';
import {
  BF, INCIDENT_KINDS, RESPONDERS, RESP_NONE, emptyEmergencyMonth,
  type Building, type CityState, type EmergencyMonth, type EmergencyStats, type IncidentKind, type Responder,
} from '../CityState';
import type { EmergencyEvent, SimSystem, Simulation } from '../Simulation';
import { getDef } from '../catalog';
import type { BuildingDef, ServiceKind } from '../catalogTypes';
import { cohortShares } from '../economy/demographics';
import { facilityLoad } from './catchments';
import { Fam, buildingList, centerCell, fundingFactor, infoOf, isFunctional } from './common';
import { RoadGraph, perimeterNodes } from './graph';
import { MinHeap } from './heap';
import {
  BPR_ALPHA, BPR_MAX_FACTOR, CRIME_MAJOR, CRIME_SPREE_MIN, CRIME_SPREE_RATE, EMERG_DAYS_PER_MIN, EMERG_DEADLINE,
  EMERG_FILL_COST, EMERG_GRACE, EMERG_MANUAL_MAX, EMERG_MAX_PATH, EMERG_PLANT_P, EMERG_RANGE_K, EMERG_RESP_PERIOD,
  EMERG_RMAX, EMERG_SEARCHES_PER_DAY, EMERG_SEARCH_COST, EMERG_SIREN_CONG, EMERG_SLOW_MARGIN, EMERG_TRUCK_SHARE,
  EMERG_UNPOWERED_TURNOUT, EMERG_WORK_DAYS, FIRE_BURN_DAYS, FIRE_CLUSTER_R, FIRE_DRY_WORK, FIRE_HOLD_PER_UNIT,
  FIRE_SPREAD_DRY, FIRE_SPREAD_ONSCENE, FIRE_SPREAD_P, FIRE_WORK_PER_AREA, INDUSTRIAL_POLL, IND_ACCIDENT_RATE,
  MED_BASE, MED_DELAY_LOSS, MED_MAJOR, MED_RATE, MED_SENIOR, MED_SURVIVE, NET_TIME, PRISON_ESCAPE, RAMP_PENALTY,
  RIOT_AFTER_BOOST, RIOT_AFTER_DAYS, RIOT_APPROVAL, RIOT_CRIME, RIOT_CRIME_BOOST, RIOT_HEALTH, RIOT_IGNITE_P,
  RIOT_MIN_POP, RIOT_P, RIOT_R_GROW, RIOT_R_MAX, ROAD_RADIUS_FACTOR, SPILL_HWY_RATE, SPILL_POLL, SPILL_RATE_ID,
  SPILL_SITE_P, SPREE_FAIL_BOOST, SPREE_FAIL_DAYS,
} from './params';
import { schedulerOf } from './scheduler';
import { Search, Seeds, roadSearch } from './search';
import type { FireSystem } from './fire';

export type IncidentState = 'queued' | 'uncovered' | 'dispatched' | 'onScene' | 'resolved' | 'failed';
export type UncoveredReason = 'noStation' | 'outOfRange' | 'busy';

export interface Incident {
  id: number;
  kind: IncidentKind;
  /** site cell */
  x: number;
  z: number;
  /** building at the site, -1 = none */
  buildingId: number;
  major: boolean;
  state: IncidentState;
  /** sim time (days, fractional) the incident started, and its deadline */
  start: number;
  deadline: number;
  /** kind-specific severity (burning buildings, riot radius, injured, ...) */
  severity: number;
  /** units needed per responder */
  need: Partial<Record<Responder, number>>;
  /** assigned vehicle ids */
  units: number[];
  reason?: UncoveredReason;
  manualPossible: boolean;
  /** expected arrival of the first unit (game minutes after dispatch) */
  etaMin?: number;
  // ---- WP8 details (all plain data, saved in systemData.emergency)
  /** place label for the UI (building name) */
  place: string;
  /** why it is not covered, for the banner ("All 2 trucks of Fire Station #3 are busy") */
  note: string;
  /** grace days (answered later = late) */
  grace: number;
  /** sim time the first unit reached the scene (-1 = none yet), and per responder */
  arrived: number;
  firstAt: Partial<Record<Responder, number>>;
  /** 0 not answered yet, 1 auto-dispatch, 2 player dispatch */
  answered: number;
  /** remaining on-scene work (unit-days) for the non-fire kinds */
  work: number;
  /** people injured / trapped, and the deaths so far */
  injured: number;
  deaths: number;
  /** riot radius (cells) */
  radius: number;
  /** fire: burning building ids of the cluster, buildings lost / saved */
  fires: number[];
  lost: number;
  saved: number;
  /** earliest sim day of the next automatic dispatch attempt */
  retry: number;
  /** stations version seen by the last attempt (uncovered incidents retry when stations change) */
  stVer: number;
}

export type EmergencyVehicleModel = 'fire_truck' | 'car_police' | 'ambulance';
export interface EmergencyVehicle {
  id: number;
  responder: Responder;
  model: EmergencyVehicleModel;
  stationId: number;
  incidentId: number;
  /** transport = a clinic ambulance taking the patient to a hospital */
  state: 'outbound' | 'onScene' | 'returning' | 'transport';
  /** route cells (i = z*N + x; corner cells only, <= EMERG_MAX_PATH) from the route start to its end */
  path: number[];
  /** cumulative game minutes at each path cell (rounded to 0.01) */
  times: number[];
  /** sim time (days, fractional) the current leg started (outbound: after the turnout) */
  legStart: number;
  /** current leg along the path, in path minutes: m0 -> m1 (outbound 0 -> T, returning T -> 0, recall m -> 0) */
  m0: number;
  m1: number;
  /** sim time the current leg ends */
  arrive: number;
  /** sim time on-scene work was last credited */
  workFrom: number;
  /** transport: destination hospital station id (-1 none) */
  hospital: number;
}

export interface StationFleet {
  type: Responder;
  total: number;
  free: number;
  out: number;
}
export interface DispatchOption {
  stationId: number;
  name: string;
  responder: Responder;
  free: number;
  /** travel + turnout (game minutes); Infinity = no road route */
  etaMin: number;
  etaDays: number;
  /** effective units (funding) */
  total: number;
  /** within the station's auto range */
  inRange: boolean;
}
export interface DispatchResult {
  ok: boolean;
  reason?: string;
  etaMin?: number;
  /** units sent */
  sent?: number;
}
export interface SpawnOptions {
  major?: boolean;
  buildingId?: number;
  severity?: number;
}

/** units per station def (effective units scale with funding: 0 below 25 %, else max(1, round(units x min(1.2, f)))) */
export const FLEET: Readonly<Record<string, { responder: Responder; units: number }>> = {
  civ_fire_station: { responder: 'fire', units: 2 },
  civ_fire_hq: { responder: 'fire', units: 5 },
  civ_police_kiosk: { responder: 'police', units: 1 },
  civ_police_station: { responder: 'police', units: 2 },
  civ_police_hq: { responder: 'police', units: 6 },
  civ_clinic: { responder: 'medical', units: 1 },
  civ_hospital: { responder: 'medical', units: 3 },
  civ_medical_center: { responder: 'medical', units: 6 },
};

export const INCIDENT_LABEL: Readonly<Record<IncidentKind, string>> = {
  fire: 'Fire',
  industrial: 'Industrial accident',
  spill: 'Hazardous spill',
  crime: 'Crime spree',
  riot: 'Riot',
  medical: 'Medical emergency',
  collapse: 'Building collapse',
  prisonRiot: 'Prison riot',
};
export const INCIDENT_COLOR: Readonly<Record<IncidentKind, string>> = {
  fire: '#e8542c',
  industrial: '#e89a2c',
  spill: '#8fbf2a',
  crime: '#3d6fd8',
  riot: '#9b3dd8',
  medical: '#e8e8e8',
  collapse: '#a08060',
  prisonRiot: '#5a3dd8',
};
/** UI icon (src/ui/icons.ts) per kind */
export const INCIDENT_ICON: Readonly<Record<IncidentKind, string>> = {
  fire: 'fire', industrial: 'factory', spill: 'smog', crime: 'crime', riot: 'riot', medical: 'health', collapse: 'quake', prisonRiot: 'police',
};
/** responders an incident needs (primary first) */
export const INCIDENT_RESPONDERS: Readonly<Record<IncidentKind, readonly Responder[]>> = {
  fire: ['fire'], industrial: ['fire', 'medical'], spill: ['fire'], crime: ['police'], riot: ['police'], medical: ['medical'],
  collapse: ['fire', 'medical'], prisonRiot: ['police'],
};
export const RESPONDER_LABEL: Readonly<Record<Responder, string>> = { fire: 'Fire', police: 'Police', medical: 'Medical' };
/** unit nouns [singular, plural] */
export const RESPONDER_UNIT: Readonly<Record<Responder, readonly [string, string]>> = {
  fire: ['fire truck', 'fire trucks'], police: ['police car', 'police cars'], medical: ['ambulance', 'ambulances'],
};
export const RESPONDER_MODEL: Readonly<Record<Responder, EmergencyVehicleModel>> = { fire: 'fire_truck', police: 'car_police', medical: 'ambulance' };
const RESPONDER_SERVICE: Readonly<Record<Responder, ServiceKind>> = { fire: 'fire', police: 'police', medical: 'health' };
const RESPONDER_STATION: Readonly<Record<Responder, string>> = { fire: 'fire station', police: 'police station', medical: 'clinic or hospital' };
const DEFAULT_RADIUS: Readonly<Record<Responder, number>> = { fire: 24, police: 26, medical: 16 };
/** kinds that are always major (alert the player when not covered); medical / crime are major per incident */
const MAJOR_KINDS: ReadonlySet<IncidentKind> = new Set<IncidentKind>(['fire', 'industrial', 'spill', 'riot', 'collapse', 'prisonRiot']);
const R_INDEX: Readonly<Record<Responder, number>> = { fire: 0, police: 1, medical: 2 };
const EPS = 1e-6;
const MIN_T = Math.min(NET_TIME[1], NET_TIME[2], NET_TIME[3], NET_TIME[4], NET_TIME[5]);
const QB = MIN_T * 0.999;

/** pollution source of an active incident (spills, industrial fires) — splatted by pollution.ts like plopped emitters */
export interface EmergencyPollutionSource {
  x: number;
  z: number;
  air: number;
  water: number;
  radius: number;
}
/** crime boost of an active / failed incident (riots, unresolved crime) — splatted by crime.ts into raw crime */
export interface CrimeBoost {
  x: number;
  z: number;
  radius: number;
  amount: number;
}

// ------------------------------------------------------------------------------------------------ helpers
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
const r2 = (v: number) => Math.round(v * 100) / 100;

/** station fleet of a def: FLEET by def id, else by model (test / mod defs reusing a station model) */
const fleetCache = new Map<string, { responder: Responder; units: number } | null>();
export function fleetOfDef(defId: string): { responder: Responder; units: number } | null {
  let f = fleetCache.get(defId);
  if (f !== undefined) return f;
  f = FLEET[defId] ?? null;
  if (!f) {
    const d = getDef(defId);
    if (d) f = FLEET[d.model] ?? null;
    else return null; // catalog not loaded: do not cache
  }
  fleetCache.set(defId, f);
  return f;
}

/** auto-dispatch range (game minutes) of a station def */
export function stationRange(def: BuildingDef | undefined, r: Responder): number {
  const radius = def?.coverage?.radius ?? DEFAULT_RADIUS[r];
  return Math.min(EMERG_RMAX, radius * ROAD_RADIUS_FACTOR * NET_TIME[Network.Road] * EMERG_RANGE_K);
}

function isHospitalDef(def: BuildingDef | undefined): boolean {
  if (!def) return false;
  if (def.coverage?.tier === 'hospital') return true;
  if (def.coverage?.tier === 'clinic') return false;
  return (def.coverage?.radius ?? 0) > 20;
}

/** vehicle position at sim time t: cell coords (x, z at cell centres = +0.5), unit heading, moving flag */
export interface VehiclePos { x: number; z: number; hx: number; hz: number; moving: boolean }
export function vehiclePosition(v: EmergencyVehicle, t: number, N: number, out: VehiclePos = { x: 0, z: 0, hx: 1, hz: 0, moving: false }): VehiclePos {
  const p = v.path, tm = v.times;
  const n = p.length;
  if (n === 0) return out;
  let m: number;
  let moving = false;
  const fwd = v.m1 >= v.m0;
  if (v.state === 'onScene') m = v.m1;
  else {
    const el = (t - v.legStart) / EMERG_DAYS_PER_MIN;
    const span = Math.abs(v.m1 - v.m0);
    const s = el <= 0 ? 0 : el >= span ? span : el;
    moving = el > 0 && el < span;
    m = fwd ? v.m0 + s : v.m0 - s;
  }
  // segment k with times[k] <= m <= times[k+1]
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tm[mid] <= m) lo = mid;
    else hi = mid;
  }
  const a = p[lo], b = p[Math.min(n - 1, lo + 1)];
  const ax = a % N, az = (a - ax) / N, bx = b % N, bz = (b - bx) / N;
  const span = tm[Math.min(n - 1, lo + 1)] - tm[lo];
  const f = span > 1e-9 ? Math.max(0, Math.min(1, (m - tm[lo]) / span)) : 0;
  out.x = ax + (bx - ax) * f + 0.5;
  out.z = az + (bz - az) * f + 0.5;
  let hx = bx - ax, hz = bz - az;
  const l = Math.hypot(hx, hz);
  if (l > 0) {
    hx /= l; hz /= l;
    if (!fwd) { hx = -hx; hz = -hz; }
    out.hx = hx; out.hz = hz;
  }
  out.moving = moving;
  return out;
}

// ------------------------------------------------------------------------------------------------ dispatch search
/**
 * Reverse road search (travel times TO the seeds = the incident's road nodes) with Dial buckets and early exit.
 * `visit(u, d)` is called for settled nodes that have station entries (stHead[u] >= 0); returning true stops.
 * Settling also stops once labels exceed `this.stop` (the visitor may lower it).
 */
class DispatchSearch {
  dist: Float64Array<ArrayBuffer> = new Float64Array(0);
  next: Int32Array<ArrayBuffer> = new Int32Array(0);
  done: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private head: Int32Array<ArrayBuffer> = new Int32Array(0);
  private enext: Int32Array<ArrayBuffer> = new Int32Array(0);
  private enode: Int32Array<ArrayBuffer> = new Int32Array(0);
  private en = 0;
  stop = Infinity;
  settled = 0;

  private push(b: number, v: number): void {
    const e = this.en++;
    if (e >= this.enext.length) {
      const c = this.enext.length * 2 + 64;
      const a = new Int32Array(c); a.set(this.enext); this.enext = a;
      const n = new Int32Array(c); n.set(this.enode); this.enode = n;
    }
    this.enode[e] = v;
    this.enext[e] = this.head[b];
    this.head[b] = e;
  }

  run(g: RoadGraph, tm: Float32Array, seeds: Int32Array, ns: number, limit: number, stHead: Int32Array | null, visit: ((u: number, d: number) => boolean) | null): void {
    const n = g.n;
    if (this.dist.length < n) {
      const c = n + (n >> 2) + 16;
      this.dist = new Float64Array(c);
      this.next = new Int32Array(c);
      this.done = new Uint8Array(c);
    }
    const dist = this.dist, next = this.next, done = this.done;
    dist.fill(Infinity, 0, n);
    next.fill(-1, 0, n);
    done.fill(0, 0, n);
    this.settled = 0;
    if (!(limit < 2000)) limit = 2000;
    const invQ = 1 / QB;
    const nb = Math.ceil(limit * invQ) + 2;
    if (this.head.length < nb) this.head = new Int32Array(nb + 64);
    const head = this.head;
    head.fill(-1, 0, nb);
    this.en = 0;
    for (let s = 0; s < ns; s++) {
      const v = seeds[s];
      if (v < 0 || v >= n || dist[v] === 0) continue;
      dist[v] = 0;
      next[v] = -1;
      this.push(0, v);
    }
    const adj = g.rev, type = g.type;
    const HW = Network.Highway;
    let cnt = 0;
    outer: for (let b = 0; b < nb; b++) {
      let e = head[b];
      while (e >= 0) {
        const u = this.enode[e];
        e = this.enext[e];
        if (done[u] === 1) continue;
        const key = dist[u];
        if (key > this.stop) break outer;
        done[u] = 1;
        cnt++;
        if (visit && (!stHead || stHead[u] >= 0) && visit(u, key)) break outer;
        const tu = tm[u];
        const hu = type[u] === HW;
        const base = u * 4;
        for (let k = 0; k < 4; k++) {
          const v = adj[base + k];
          if (v < 0 || done[v] === 1) continue;
          let c = 0.5 * (tu + tm[v]);
          if (hu !== (type[v] === HW)) c += RAMP_PENALTY;
          const nd = key + c;
          if (nd < dist[v] && nd <= limit) {
            dist[v] = nd;
            next[v] = u;
            const bi = (nd * invQ) | 0;
            this.push(bi > b ? bi : b + 1, v);
          }
        }
      }
      head[b] = -1;
    }
    this.settled = cnt;
  }
}

// ------------------------------------------------------------------------------------------------ system
interface Station {
  id: number;
  def: string;
  name: string;
  responder: Responder;
  hospital: boolean;
  /** FLEET units and effective units (funding) */
  base: number;
  units: number;
  /** auto range (minutes) */
  range: number;
  /** extra turnout (days): unpowered stations */
  turnout: number;
  x: number;
  z: number;
  /** road entry nodes on the current graph */
  nodes: number[];
}

interface Effect {
  kind: 'crime' | 'poll';
  x: number;
  z: number;
  radius: number;
  a: number;
  b: number;
  until: number;
}

interface Persist {
  v: number;
  nextId: number;
  nextVid: number;
  rng: number;
  incidents: Incident[];
  vehicles: EmergencyVehicle[];
  effects: Effect[];
  months: EmergencyMonth[];
  medQ: [number, number];
  searchDay: number;
  searchesLeft: number;
}

/** candidate list for incident generation: cumulative weights (monthly rates) and building ids (< 0: -(cell + 1)) */
class Weights {
  cum: Float64Array<ArrayBuffer> = new Float64Array(256);
  id: Int32Array<ArrayBuffer> = new Int32Array(256);
  n = 0;
  total = 0;
  clear(): void {
    this.n = 0;
    this.total = 0;
  }
  add(id: number, w: number): void {
    if (!(w > 0)) return;
    if (this.n >= this.cum.length) {
      const c = this.cum.length * 2;
      const a = new Float64Array(c); a.set(this.cum); this.cum = a;
      const b = new Int32Array(c); b.set(this.id); this.id = b;
    }
    this.total += w;
    this.cum[this.n] = this.total;
    this.id[this.n] = id;
    this.n++;
  }
  pick(r: number): number {
    if (this.n === 0) return 0;
    const x = r * this.total;
    let lo = 0, hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return this.id[lo];
  }
}

export class EmergencySystem implements SimSystem {
  readonly name = 'emergency';
  /** the emergency system handles fires / incidents (false only for the Phase 0 stub) */
  readonly active: boolean = true;
  protected sim: Simulation | null = null;
  private list: Incident[] = [];
  private byId = new Map<number, Incident>();
  private vlist: EmergencyVehicle[] = [];
  private vById = new Map<number, EmergencyVehicle>();
  private stations: Station[] = [];
  private stById = new Map<number, Station>();
  private out = new Map<number, number>();
  private stDirty = true;
  /** incremented whenever the station set / units change (uncovered incidents retry) */
  private stVer = 0;
  private g = new RoadGraph();
  private netDirty = true;
  private tm: Float32Array<ArrayBuffer> = new Float32Array(0);
  private tmDay = -1;
  private tmVer = -1;
  private ds = new DispatchSearch();
  private seedBuf = new Int32Array(64);
  private tmpNodes = new Int32Array(64);
  /** node -> station entry lists */
  private nodeHead = new Int32Array(0);
  private entSt = new Int32Array(0);
  private entNext = new Int32Array(0);
  private seen = new Int32Array(0);
  private stamp = 0;
  private rng = new RNG(1);
  private p: Persist = EmergencySystem.emptyPersist();
  private unsub: (() => void)[] = [];
  private inDaily = false;
  private lastNews = new Map<string, number>();
  // generation
  private wMed = new Weights();
  private wCrime = new Weights();
  private wInd = new Weights();
  private wSpill = new Weights();
  private shares = new Float32Array(5);
  // response layers
  private respStep = -1;
  private respLast = -1e9;
  private respDirty = true;
  private respNetOnly = false;
  private nodeSlack: Float32Array<ArrayBuffer>[] = [new Float32Array(0), new Float32Array(0), new Float32Array(0)];
  private hasStation = [false, false, false];
  private respComputed = false;
  private S = new Search();
  private seeds = new Seeds();
  private heap = new MinHeap(64);
  // caches
  private boosts: CrimeBoost[] = [];
  private polls: EmergencyPollutionSource[] = [];
  private optCache = new Map<number, { day: number; ver: number; stVer: number; eta: Map<number, number> }>();
  /** profiling: ms spent in daily() (last / total) */
  lastDailyMs = 0;

  private static emptyPersist(): Persist {
    return { v: 1, nextId: 1, nextVid: 1, rng: 0, incidents: [], vehicles: [], effects: [], months: [], medQ: [0, 0], searchDay: -1, searchesLeft: EMERG_SEARCHES_PER_DAY };
  }

  // ------------------------------------------------------------------------------------------ lifecycle
  init(sim: Simulation): void {
    this.sim = sim;
    const st = sim.state;
    for (const u of this.unsub) u();
    this.unsub = [
      sim.events.on('networkChanged', () => this.markNet()),
      sim.events.on('terrainChanged', () => this.markNet()),
      sim.events.on('buildingAdded', (b) => this.onBuildingEvent(b)),
      sim.events.on('buildingRemoved', (b) => this.onBuildingEvent(b)),
      sim.events.on('buildingChanged', (b) => {
        if (this.stById.has(b.id) || (b.built >= 1 && fleetOfDef(b.def))) this.onBuildingEvent(b);
      }),
    ];
    this.load(st);
    this.netDirty = true;
    this.stDirty = true;
    this.lastNews.clear();
    this.optCache.clear();
    this.ensureGraph(st);
    this.refreshStations(sim);
    this.buildWeights(sim);
    // derived layers: compute synchronously
    this.respStep = -1;
    this.respDirty = true;
    do this.respTaskStep(sim); while (this.respStep >= 0);
    this.rebuildCaches(st);
    this.writeStats(st);
    const self = this;
    schedulerOf(sim).register({
      name: 'emergency.response',
      due: (s) => self.respDue(s),
      urgent: () => false,
      cost: () => self.respCost(),
      step: (s) => self.respTaskStep(s),
    });
  }

  private onBuildingEvent(b: Building): void {
    if (this.stById.has(b.id) || fleetOfDef(b.def)) this.stDirty = true;
  }

  private markNet(): void {
    this.netDirty = true;
    if (!this.respDirty) this.respNetOnly = true;
    this.respDirty = true;
    this.optCache.clear();
  }

  private load(st: CityState): void {
    const raw = st.systemData.emergency as Partial<Persist> | undefined;
    const p = EmergencySystem.emptyPersist();
    if (raw && typeof raw === 'object' && raw.v === 1) {
      p.nextId = raw.nextId ?? 1;
      p.nextVid = raw.nextVid ?? 1;
      p.rng = raw.rng ?? 0;
      p.incidents = Array.isArray(raw.incidents) ? raw.incidents : [];
      p.vehicles = Array.isArray(raw.vehicles) ? raw.vehicles : [];
      p.effects = Array.isArray(raw.effects) ? raw.effects : [];
      p.months = Array.isArray(raw.months) ? raw.months : [];
      p.medQ = Array.isArray(raw.medQ) ? [raw.medQ[0] ?? 0, raw.medQ[1] ?? 0] : [0, 0];
      p.searchDay = raw.searchDay ?? -1;
      p.searchesLeft = raw.searchesLeft ?? EMERG_SEARCHES_PER_DAY;
    }
    this.p = p;
    this.rng = new RNG(((st.config.seed ^ 0x3e41c) >>> 0) || 1);
    if (p.rng) this.rng.state = p.rng;
    else p.rng = this.rng.state;
    this.list = p.incidents;
    this.vlist = p.vehicles;
    this.byId.clear();
    for (const inc of this.list) {
      inc.fires ??= [];
      inc.firstAt ??= {};
      inc.units ??= [];
      inc.need ??= {};
      this.byId.set(inc.id, inc);
    }
    this.vById.clear();
    for (const v of this.vlist) this.vById.set(v.id, v);
    this.recountOut();
    st.systemData.emergency = p;
  }

  private recountOut(): void {
    this.out.clear();
    for (const v of this.vlist) this.out.set(v.stationId, (this.out.get(v.stationId) ?? 0) + 1);
  }

  private persist(): void {
    this.p.rng = this.rng.state;
    const sd = this.sim?.state.systemData;
    if (sd && sd.emergency !== this.p) sd.emergency = this.p;
  }

  /** current sim time: the day inside daily(), continuous time for player / disaster actions between days */
  private now(sim: Simulation): number {
    return this.inDaily ? sim.state.day : sim.simTime();
  }

  // ------------------------------------------------------------------------------------------ graph / stations
  private ensureGraph(st: CityState): boolean {
    if (!this.netDirty && this.g.N === st.size) return false;
    this.g.build(st);
    this.netDirty = false;
    this.tmVer = -1;
    this.optCache.clear();
    this.stationNodes(st);
    return true;
  }

  private ensureTimes(st: CityState): void {
    const g = this.g;
    if (this.tmDay === st.day && this.tmVer === g.version) return;
    this.tmDay = st.day;
    this.tmVer = g.version;
    const n = g.n;
    if (this.tm.length < n) this.tm = new Float32Array(n + (n >> 3) + 16);
    const traffic = st.traffic, cellOf = g.cellOf, cap = g.cap, t0 = g.t0, tm = this.tm;
    for (let v = 0; v < n; v++) {
      const r = cap[v] > 0 ? traffic[cellOf[v]] / cap[v] : 0;
      let f = 1 + BPR_ALPHA * r * r * r * r;
      if (f > BPR_MAX_FACTOR) f = BPR_MAX_FACTOR;
      tm[v] = t0[v] * (1 + EMERG_SIREN_CONG * (f - 1));
    }
  }

  private refreshStations(sim: Simulation): void {
    const st = sim.state;
    this.stDirty = false;
    const prev = this.stById;
    const list: Station[] = [];
    const count = new Map<string, number>();
    for (const b of buildingList(st)) {
      const f = fleetOfDef(b.def);
      if (!f || !isFunctional(b)) continue;
      const def = getDef(b.def);
      const k = (count.get(b.def) ?? 0) + 1;
      count.set(b.def, k);
      const old = prev.get(b.id);
      list.push({
        id: b.id, def: b.def, name: `${def?.name ?? 'Station'} #${k}`, responder: f.responder, hospital: f.responder === 'medical' && isHospitalDef(def),
        base: f.units, units: old?.units ?? f.units, range: stationRange(def, f.responder), turnout: 0, x: b.x, z: b.z, nodes: [],
      });
    }
    list.sort((a, b) => a.id - b.id);
    this.stations = list;
    this.stById = new Map(list.map((s) => [s.id, s]));
    this.stationNodes(st);
    this.updateUnits(st, true);
    this.stVer++;
    this.respDirty = true;
    this.respNetOnly = false;
    this.optCache.clear();
  }

  private stationNodes(st: CityState): void {
    const g = this.g;
    const N = st.size;
    let total = 0;
    for (const s of this.stations) {
      const b = st.buildings.get(s.id);
      s.nodes.length = 0;
      if (!b || g.N !== N) continue;
      const c = perimeterNodes(g.nodeOfCell, N, b, this.tmpNodes, 0, this.tmpNodes.length);
      for (let k = 0; k < c; k++) if (!s.nodes.includes(this.tmpNodes[k])) s.nodes.push(this.tmpNodes[k]);
      total += s.nodes.length;
    }
    if (this.nodeHead.length < g.n) this.nodeHead = new Int32Array(g.n + (g.n >> 3) + 16);
    this.nodeHead.fill(-1, 0, g.n);
    if (this.entSt.length < total) {
      this.entSt = new Int32Array(total + 16);
      this.entNext = new Int32Array(total + 16);
    }
    if (this.seen.length < this.stations.length) this.seen = new Int32Array(this.stations.length + 16);
    let e = 0;
    this.stations.forEach((s, k) => {
      for (const v of s.nodes) {
        this.entSt[e] = k;
        this.entNext[e] = this.nodeHead[v];
        this.nodeHead[v] = e;
        e++;
      }
    });
  }

  /** effective units from funding, turnout from power; returns true if any station's reach changed */
  private updateUnits(st: CityState, force = false): boolean {
    let changed = false;
    for (const s of this.stations) {
      const b = st.buildings.get(s.id);
      if (!b) continue;
      const f = fundingFactor(st, RESPONDER_SERVICE[s.responder]);
      const u = f < 0.25 ? 0 : Math.max(1, Math.round(s.base * Math.min(1.2, f)));
      if ((u > 0) !== (s.units > 0)) changed = true;
      if (u !== s.units) this.stVer++;
      s.units = u;
      const inf = infoOf(st, b);
      s.turnout = inf.usesPower && !(b.flags & BF.Powered) ? EMERG_UNPOWERED_TURNOUT : 0;
    }
    if (changed && !force) {
      this.respDirty = true;
      this.respNetOnly = false;
    }
    return changed;
  }

  private freeOf(s: Station): number {
    return Math.max(0, s.units - (this.out.get(s.id) ?? 0));
  }

  // ------------------------------------------------------------------------------------------ public API
  /** active incidents (id order) */
  incidents(): readonly Incident[] {
    return this.list;
  }
  incident(id: number): Incident | undefined {
    return this.byId.get(id);
  }
  /** vehicles on the road / on scene */
  vehicles(): readonly EmergencyVehicle[] {
    return this.vlist;
  }
  /** emergency stations (fire / police / medical) with their fleets */
  stationList(): readonly { id: number; name: string; responder: Responder; units: number; base: number; free: number; range: number; x: number; z: number; powered: boolean; hospital: boolean }[] {
    return this.stations.map((s) => ({ id: s.id, name: s.name, responder: s.responder, units: s.units, base: s.base, free: this.freeOf(s), range: s.range, x: s.x, z: s.z, powered: s.turnout === 0, hospital: s.hospital }));
  }
  /** fleet of a station building, null when it is not an emergency station */
  stationFleet(buildingId: number): StationFleet | null {
    const s = this.stById.get(buildingId);
    if (!s) {
      const b = this.sim?.state.buildings.get(buildingId);
      const f = b ? fleetOfDef(b.def) : null;
      return f ? { type: f.responder, total: 0, free: 0, out: 0 } : null;
    }
    const out = this.out.get(s.id) ?? 0;
    return { type: s.responder, total: s.units, free: Math.max(0, s.units - out), out };
  }
  /** station display name ("Fire Station #3") */
  stationName(buildingId: number): string {
    return this.stById.get(buildingId)?.name ?? 'Station';
  }

  /** player dispatch options for an incident: every station of a needed type city-wide (ETA from a full-map search, cached 3 days) */
  dispatchOptions(sim: Simulation, incidentId: number): DispatchOption[] {
    const inc = this.byId.get(incidentId);
    if (!inc) return [];
    const st = sim.state;
    this.syncStations(sim);
    const ver = this.g.version;
    let c = this.optCache.get(incidentId);
    if (!c || st.day - c.day > 3 || c.ver !== ver || c.stVer !== this.stVer) {
      const eta = new Map<number, number>();
      const ns = this.siteSeeds(st, inc);
      if (ns > 0) {
        this.ensureTimes(st);
        this.ds.stop = Infinity;
        const stamp = ++this.stamp;
        this.ds.run(this.g, this.tm, this.seedBuf, ns, 2000, this.nodeHead, (u, d) => {
          for (let e = this.nodeHead[u]; e >= 0; e = this.entNext[e]) {
            const k = this.entSt[e];
            if (this.seen[k] === stamp) continue;
            this.seen[k] = stamp;
            eta.set(this.stations[k].id, d);
          }
          return false;
        });
      }
      c = { day: st.day, ver, stVer: this.stVer, eta };
      this.optCache.set(incidentId, c);
    }
    const need = INCIDENT_RESPONDERS[inc.kind];
    const outL: DispatchOption[] = [];
    for (const s of this.stations) {
      if (!need.includes(s.responder)) continue;
      const t = c.eta.get(s.id);
      const etaMin = t === undefined ? Infinity : r2(t + s.turnout / EMERG_DAYS_PER_MIN);
      outL.push({ stationId: s.id, name: s.name, responder: s.responder, free: this.freeOf(s), total: s.units, etaMin, etaDays: etaMin * EMERG_DAYS_PER_MIN, inRange: t !== undefined && t <= s.range + EPS });
    }
    outL.sort((a, b) => (a.free > 0 ? 0 : 1) - (b.free > 0 ? 0 : 1) || a.etaMin - b.etaMin || a.stationId - b.stationId);
    return outL;
  }

  /** send `units` free units of a station to an incident (player dispatch) */
  dispatch(sim: Simulation, incidentId: number, stationId: number, units = 1): DispatchResult {
    const inc = this.byId.get(incidentId);
    if (!inc) return { ok: false, reason: 'This emergency is already over' };
    this.syncStations(sim);
    const s = this.stById.get(stationId);
    if (!s) return { ok: false, reason: 'Not an emergency station' };
    if (!INCIDENT_RESPONDERS[inc.kind].includes(s.responder)) return { ok: false, reason: `${s.name} can't help with a ${INCIDENT_LABEL[inc.kind].toLowerCase()}` };
    if (s.units <= 0) return { ok: false, reason: `${s.name} has no funded ${RESPONDER_UNIT[s.responder][1]} — raise the ${RESPONDER_SERVICE[s.responder]} budget` };
    const free = this.freeOf(s);
    if (free <= 0) return { ok: false, reason: `All ${s.units} ${RESPONDER_UNIT[s.responder][s.units === 1 ? 0 : 1]} of ${s.name} are busy` };
    const st = sim.state;
    const ns = this.siteSeeds(st, inc);
    if (ns === 0) return { ok: false, reason: 'No road leads to this place' };
    this.ensureTimes(st);
    const k = this.stations.indexOf(s);
    let found = -1, fd = 0;
    this.ds.stop = Infinity;
    this.ds.run(this.g, this.tm, this.seedBuf, ns, 2000, this.nodeHead, (u, d) => {
      for (let e = this.nodeHead[u]; e >= 0; e = this.entNext[e]) {
        if (this.entSt[e] === k) { found = u; fd = d; return true; }
      }
      return false;
    });
    if (found < 0) return { ok: false, reason: `No road route from ${s.name}` };
    const now = this.now(sim);
    const n = Math.max(1, Math.min(free, units | 0));
    const route = this.extractPath(found);
    for (let q = 0; q < n; q++) this.sendUnit(sim, inc, s, route, fd, now, true);
    this.afterDispatch(sim, inc);
    this.persist();
    return { ok: true, etaMin: r2(fd + s.turnout / EMERG_DAYS_PER_MIN), sent: n };
  }

  /** dispatch from the fastest station with a free unit ("Send nearest" / bot) */
  dispatchBest(sim: Simulation, incidentId: number): DispatchResult {
    const inc = this.byId.get(incidentId);
    if (!inc) return { ok: false, reason: 'This emergency is already over' };
    const opts = this.dispatchOptions(sim, incidentId).filter((o) => o.free > 0 && Number.isFinite(o.etaMin));
    if (!opts.length) return { ok: false, reason: `No free ${RESPONDER_UNIT[INCIDENT_RESPONDERS[inc.kind][0]][0]} can reach this place` };
    let res: DispatchResult = { ok: false, reason: 'No free unit' };
    let sentAny = false;
    for (const r of INCIDENT_RESPONDERS[inc.kind]) {
      let missing = (inc.need[r] ?? 0) - this.assigned(inc, r);
      for (const o of opts) {
        if (missing <= 0) break;
        if (o.responder !== r) continue;
        const d = this.dispatch(sim, incidentId, o.stationId, missing);
        if (d.ok) {
          missing -= d.sent ?? 1;
          if (!sentAny) res = d;
          sentAny = true;
        }
      }
    }
    return res;
  }

  /** would an incident needing responder r at (x, z) be auto-dispatched now? (inspector / tests; no unit is sent) */
  probe(sim: Simulation, r: Responder, x: number, z: number): { auto: boolean; etaMin: number; stationId: number; reason?: UncoveredReason } {
    const st = sim.state;
    this.syncStations(sim);
    const b = st.buildingAt(x, z);
    const fake = { x, z, buildingId: b ? b.id : -1 } as Incident;
    const ns = this.siteSeeds(st, fake);
    const any = this.stations.some((s) => s.responder === r && s.units > 0);
    if (!any || ns === 0) return { auto: false, etaMin: Infinity, stationId: -1, reason: 'noStation' };
    this.ensureTimes(st);
    const res = this.searchUnits(st, r, ns, 1, false);
    if (res.picks.length) return { auto: true, etaMin: r2(res.picks[0].t), stationId: res.picks[0].s.id };
    return { auto: false, etaMin: res.manual ? r2(res.manual.t) : Infinity, stationId: res.manual?.s.id ?? -1, reason: res.inRangeBusy.length ? 'busy' : res.manual ? 'outOfRange' : 'noStation' };
  }

  /** create an incident (disasters, justice prison riots, sandbox, tests); returns its id or -1 */
  spawn(sim: Simulation, kind: IncidentKind, x: number, z: number, opts: SpawnOptions = {}): number {
    const st = sim.state;
    x = Math.floor(x);
    z = Math.floor(z);
    if (!st.inBounds(x, z)) return -1;
    const b = opts.buildingId !== undefined ? st.buildings.get(opts.buildingId) : st.buildingAt(x, z);
    if (kind === 'fire') {
      const fire = sim.getSystem<FireSystem>('fire');
      if (!b || !fire) return -1;
      if (!fire.ignite(sim, b)) {
        const f = fire.fires.get(b.id);
        return f && f.incidentId !== undefined ? f.incidentId : -1;
      }
      return fire.fires.get(b.id)?.incidentId ?? -1;
    }
    const inc = this.create(sim, kind, b ? b.x : x, b ? b.z : z, b ?? null, opts);
    return inc ? inc.id : -1;
  }

  /** the active incident at / covering cell (x, z), if any (inspector) */
  report(sim: Simulation, x: number, z: number): Incident | null {
    const bid = sim.state.inBounds(x, z) ? sim.state.building[sim.state.idx(x, z)] : -1;
    for (const inc of this.list) {
      if (inc.x === x && inc.z === z) return inc;
      if (bid >= 0 && (inc.buildingId === bid || inc.fires.includes(bid))) return inc;
      if (inc.kind === 'riot' && Math.hypot(inc.x - x, inc.z - z) <= inc.radius) return inc;
    }
    return null;
  }

  /** outcome statistics (stats.emergency) */
  stats(sim: Simulation): EmergencyStats {
    return sim.state.stats.emergency;
  }

  /** a building ignited (fire.ts). true = the emergency system handles it (joins / starts a fire incident) */
  onFire(sim: Simulation, b: Building, spread: boolean): boolean {
    if (!this.active || !this.sim) return false;
    const st = sim.state;
    const fire = sim.getSystem<FireSystem>('fire');
    const f = fire?.fires.get(b.id);
    if (!fire || !f) return false;
    // join a fire incident within FIRE_CLUSTER_R cells
    for (const inc of this.list) {
      if (inc.kind !== 'fire' || inc.state === 'resolved' || inc.state === 'failed') continue;
      if (this.nearCluster(st, inc, b)) {
        inc.fires.push(b.id);
        f.incidentId = inc.id;
        this.setIncidentFlag(sim, b, true);
        inc.severity = inc.fires.length;
        inc.need.fire = 1 + Math.floor(inc.fires.length / FIRE_HOLD_PER_UNIT);
        this.emit(sim, inc, 'escalated');
        if (inc.need.fire > this.assigned(inc, 'fire')) inc.retry = Math.min(inc.retry, st.day);
        if (!this.inDaily) this.tryDispatch(sim, inc);
        this.persist();
        return true;
      }
    }
    const inc = this.create(sim, 'fire', b.x, b.z, b, { major: true });
    if (!inc) return false;
    f.incidentId = inc.id;
    void spread;
    return true;
  }

  // ------------------------------------------------------------------------------------------ incidents
  private nearCluster(st: CityState, inc: Incident, b: Building): boolean {
    const R = FIRE_CLUSTER_R;
    const gap = (o: { x: number; z: number; w: number; d: number }) => {
      const dx = Math.max(0, o.x - (b.x + b.w), b.x - (o.x + o.w));
      const dz = Math.max(0, o.z - (b.z + b.d), b.z - (o.z + o.d));
      return Math.max(dx, dz);
    };
    if (gap({ x: inc.x, z: inc.z, w: 1, d: 1 }) <= R) return true;
    for (const id of inc.fires) {
      const o = st.buildings.get(id);
      if (o && gap(o) <= R) return true;
    }
    return false;
  }

  private create(sim: Simulation, kind: IncidentKind, x: number, z: number, b: Building | null, opts: SpawnOptions): Incident | null {
    const st = sim.state;
    if (b) for (const o of this.list) if (o.kind === kind && o.buildingId === b.id) return null; // one per kind and building
    const now = this.now(sim);
    const rng = this.rng;
    const def = b ? getDef(b.def) : undefined;
    const major = opts.major ?? (MAJOR_KINDS.has(kind) || (kind === 'medical' ? rng.next() < MED_MAJOR : kind === 'crime' ? rng.next() < CRIME_MAJOR : false));
    const inc: Incident = {
      id: this.p.nextId++, kind, x, z, buildingId: b ? b.id : -1, major, state: 'queued', start: now,
      deadline: now + EMERG_DEADLINE[kind], severity: 1, need: {}, units: [], manualPossible: false,
      place: def?.name ?? placeName(st, x, z), note: '', grace: EMERG_GRACE[kind], arrived: -1, firstAt: {}, answered: 0, work: 0,
      injured: 0, deaths: 0, radius: 0, fires: [], lost: 0, saved: 0, retry: Math.floor(now), stVer: -1,
    };
    const occ = b ? b.pop + b.jobs : 0;
    switch (kind) {
      case 'fire':
        if (b) inc.fires.push(b.id);
        inc.need = { fire: 1 };
        inc.severity = 1;
        break;
      case 'medical':
        inc.injured = opts.severity ?? (major ? rng.int(3, 8) : 1);
        inc.need = { medical: major ? 2 : 1 };
        break;
      case 'industrial':
        inc.injured = opts.severity ?? rng.int(1, 4);
        inc.need = { fire: 1, medical: 1 };
        break;
      case 'collapse':
        inc.injured = opts.severity ?? Math.max(1, Math.min(30, Math.round(occ * 0.03)));
        inc.need = { fire: 1, medical: 1 };
        break;
      case 'crime':
        inc.need = { police: major ? 2 : 1 };
        break;
      case 'riot':
        inc.radius = 2;
        inc.need = { police: 2 };
        break;
      case 'prisonRiot':
        inc.need = { police: 3 };
        break;
      case 'spill':
        inc.need = { fire: 1 };
        break;
    }
    if (kind !== 'fire') inc.severity = kind === 'riot' ? inc.radius : Math.max(1, inc.injured);
    const primary = INCIDENT_RESPONDERS[kind][0];
    inc.work = (EMERG_WORK_DAYS[kind] ?? 1) * (inc.need[primary] ?? 1);
    this.list.push(inc);
    this.byId.set(inc.id, inc);
    const m = st.stats.emergency.month;
    m.count[kind]++;
    m.injured += inc.injured;
    if (b) this.setIncidentFlag(sim, b, true);
    this.emit(sim, inc, 'new');
    this.tryDispatch(sim, inc);
    this.persist();
    return inc;
  }

  private setIncidentFlag(sim: Simulation, b: Building, on: boolean): void {
    if (!on) {
      for (const o of this.list) if (o.buildingId === b.id || o.fires.includes(b.id)) return;
    }
    const has = (b.flags & BF.Incident) !== 0;
    if (has === on) return;
    b.flags = on ? b.flags | BF.Incident : b.flags & ~BF.Incident;
    sim.events.emit('buildingChanged', b);
  }

  private assigned(inc: Incident, r: Responder): number {
    let n = 0;
    for (const id of inc.units) {
      const v = this.vById.get(id);
      if (v && v.responder === r && (v.state === 'outbound' || v.state === 'onScene')) n++;
    }
    return n;
  }

  private onSceneCount(inc: Incident, r: Responder): number {
    let n = 0;
    for (const id of inc.units) {
      const v = this.vById.get(id);
      if (v && v.responder === r && v.state === 'onScene') n++;
    }
    return n;
  }

  /** road nodes of the incident site into seedBuf; returns the count */
  private siteSeeds(st: CityState, inc: Pick<Incident, 'x' | 'z' | 'buildingId'>): number {
    const g = this.g;
    const N = st.size;
    if (g.N !== N) return 0;
    const b = inc.buildingId >= 0 ? st.buildings.get(inc.buildingId) : undefined;
    if (b) {
      if (this.seedBuf.length < 2 * (b.w + b.d) + 8) this.seedBuf = new Int32Array(2 * (b.w + b.d) + 8);
      return perimeterNodes(g.nodeOfCell, N, b, this.seedBuf, 0, this.seedBuf.length);
    }
    return cellSeeds(g, N, inc.x, inc.z, this.seedBuf);
  }

  /** path (node ids) from station node u to the site along the last search's tree */
  private extractPath(u: number): { cells: number[]; times: number[] } {
    const g = this.g, dist = this.ds.dist, next = this.ds.next;
    const nodes: number[] = [];
    for (let v = u, guard = 0; v >= 0 && guard < 100000; v = next[v], guard++) nodes.push(v);
    const t0 = dist[u];
    const N = g.N;
    const cells: number[] = [], times: number[] = [];
    for (let k = 0; k < nodes.length; k++) {
      const c = g.cellOf[nodes[k]];
      if (k > 0 && k < nodes.length - 1) {
        const a = g.cellOf[nodes[k - 1]], b = g.cellOf[nodes[k + 1]];
        const d1x = (c % N) - (a % N), d1z = Math.floor(c / N) - Math.floor(a / N);
        const d2x = (b % N) - (c % N), d2z = Math.floor(b / N) - Math.floor(c / N);
        if (d1x === d2x && d1z === d2z) continue; // straight: keep corners only
      }
      cells.push(c);
      times.push(r2(t0 - dist[nodes[k]]));
    }
    if (cells.length > EMERG_MAX_PATH) {
      // extremely winding route: keep an evenly spaced subset (the renderer interpolates between the kept cells)
      const step = cells.length / EMERG_MAX_PATH;
      const c2: number[] = [], t2: number[] = [];
      for (let k = 0; k < EMERG_MAX_PATH - 1; k++) { const q = Math.floor(k * step); c2.push(cells[q]); t2.push(times[q]); }
      c2.push(cells[cells.length - 1]); t2.push(times[times.length - 1]);
      return { cells: c2, times: t2 };
    }
    return { cells, times };
  }

  private sendUnit(sim: Simulation, inc: Incident, s: Station, route: { cells: number[]; times: number[] }, t: number, now: number, manual: boolean): EmergencyVehicle {
    const T = route.times.length ? route.times[route.times.length - 1] : r2(t);
    const legStart = now + s.turnout;
    const v: EmergencyVehicle = {
      id: this.p.nextVid++, responder: s.responder, model: RESPONDER_MODEL[s.responder], stationId: s.id, incidentId: inc.id,
      state: 'outbound', path: route.cells.slice(), times: route.times.slice(), legStart, m0: 0, m1: T,
      arrive: legStart + T * EMERG_DAYS_PER_MIN, workFrom: 0, hospital: -1,
    };
    this.vlist.push(v);
    this.vById.set(v.id, v);
    inc.units.push(v.id);
    this.out.set(s.id, (this.out.get(s.id) ?? 0) + 1);
    const eta = r2(T + s.turnout / EMERG_DAYS_PER_MIN);
    if (inc.etaMin === undefined || inc.state === 'uncovered' || inc.state === 'queued' || eta < inc.etaMin) inc.etaMin = eta;
    if (inc.answered === 0) {
      inc.answered = manual ? 2 : 1;
      const m = sim.state.stats.emergency.month;
      if (manual) m.manual++;
      else m.auto++;
    } else if (manual && inc.answered === 1 && (inc.state === 'uncovered' || inc.state === 'queued')) {
      inc.answered = 2;
    }
    return v;
  }

  private afterDispatch(sim: Simulation, inc: Incident): void {
    const wasWaiting = inc.state === 'uncovered' || inc.state === 'queued';
    if (inc.state !== 'onScene') inc.state = this.onSceneAny(inc) ? 'onScene' : 'dispatched';
    inc.reason = undefined;
    inc.note = '';
    inc.manualPossible = false;
    if (wasWaiting || inc.units.length > 0) this.emit(sim, inc, 'dispatched');
    this.writeStats(sim.state);
  }

  private onSceneAny(inc: Incident): boolean {
    for (const id of inc.units) if (this.vById.get(id)?.state === 'onScene') return true;
    return false;
  }

  /**
   * search stations of responder r from the site seeds (already in seedBuf): picks = free units within their range in
   * order of travel time (up to `want` units), inRangeBusy = in-range stations without a free unit, manual = the
   * nearest free unit beyond range (within EMERG_MANUAL_MAX minutes). Paths are extracted during the search.
   */
  private searchUnits(st: CityState, r: Responder, ns: number, want: number, withPaths: boolean): {
    picks: { s: Station; t: number; n: number; route: { cells: number[]; times: number[] } | null }[];
    inRangeBusy: { s: Station; t: number }[];
    manual: { s: Station; t: number; route: { cells: number[]; times: number[] } | null } | null;
  } {
    const picks: { s: Station; t: number; n: number; route: { cells: number[]; times: number[] } | null }[] = [];
    const inRangeBusy: { s: Station; t: number }[] = [];
    let manual: { s: Station; t: number; route: { cells: number[]; times: number[] } | null } | null = null;
    let maxRange = 0;
    for (const s of this.stations) if (s.responder === r && s.units > 0 && s.range > maxRange) maxRange = s.range;
    let got = 0;
    const stamp = ++this.stamp;
    this.ds.stop = EMERG_MANUAL_MAX;
    this.ds.run(this.g, this.tm, this.seedBuf, ns, EMERG_MANUAL_MAX, this.nodeHead, (u, d) => {
      for (let e = this.nodeHead[u]; e >= 0; e = this.entNext[e]) {
        const k = this.entSt[e];
        if (this.seen[k] === stamp) continue;
        this.seen[k] = stamp;
        const s = this.stations[k];
        if (s.responder !== r || s.units <= 0) continue;
        const free = this.freeOf(s);
        if (d <= s.range + EPS) {
          if (free > 0 && got < want) {
            const n = Math.min(free, want - got);
            got += n;
            picks.push({ s, t: d, n, route: withPaths ? this.extractPath(u) : null });
          } else if (free <= 0) inRangeBusy.push({ s, t: d });
        } else if (free > 0 && !manual) {
          manual = { s, t: d, route: withPaths ? this.extractPath(u) : null };
        }
      }
      if (got >= want) return true;
      // beyond every station's range only the nearest free (manual) unit is still of interest
      if (d > maxRange + EPS && (manual || got > 0)) return true;
      return false;
    });
    return { picks, inRangeBusy, manual };
  }

  /** automatic dispatch attempt (auto range, queue / uncovered handling). Uses the daily search budget. */
  private tryDispatch(sim: Simulation, inc: Incident): void {
    const st = sim.state;
    if (inc.state === 'resolved' || inc.state === 'failed') return;
    this.syncStations(sim);
    const day = st.day;
    if (this.p.searchDay !== day) {
      this.p.searchDay = day;
      this.p.searchesLeft = EMERG_SEARCHES_PER_DAY;
    }
    const resp = INCIDENT_RESPONDERS[inc.kind];
    let sentAny = false;
    for (let ri = 0; ri < resp.length; ri++) {
      const r = resp[ri];
      const missing = (inc.need[r] ?? 0) - this.assigned(inc, r);
      if (missing <= 0) continue;
      const primary = ri === 0;
      const anyStation = this.stations.some((s) => s.responder === r && s.units > 0);
      const ns = this.siteSeeds(st, inc);
      if (!anyStation || ns === 0) {
        if (primary && this.assigned(inc, r) === 0) this.setUncovered(sim, inc, 'noStation', false, anyStation ? 'No road leads to this place' : `The city has no ${RESPONDER_STATION[r]}`);
        continue;
      }
      if (this.p.searchesLeft <= 0) {
        inc.retry = day + 1;
        return;
      }
      this.p.searchesLeft--;
      this.ensureTimes(st);
      const now = this.now(sim);
      const res = this.searchUnits(st, r, ns, missing, true);
      for (const pk of res.picks) {
        for (let q = 0; q < pk.n; q++) this.sendUnit(sim, inc, pk.s, pk.route!, pk.t, now, false);
        sentAny = true;
      }
      if (res.picks.length) continue;
      if (this.assigned(inc, r) > 0) continue; // units already on the way / on scene (need grew)
      const minor = !inc.major || !primary;
      if (minor && res.manual) {
        // minor incidents (and supporting responders) get the nearest free unit at any range, without an alert
        this.sendUnit(sim, inc, res.manual.s, res.manual.route!, res.manual.t, now, false);
        sentAny = true;
        continue;
      }
      if (!primary) continue;
      if (res.inRangeBusy.length) {
        // queued: a unit of an in-range station is back before the grace time ends
        let best = Infinity;
        for (const b of res.inRangeBusy) best = Math.min(best, this.nextFreeAt(b.s) + b.t * EMERG_DAYS_PER_MIN);
        const s0 = res.inRangeBusy[0].s;
        if (best <= inc.start + inc.grace) {
          const was = inc.state;
          inc.state = 'queued';
          inc.reason = 'busy';
          inc.manualPossible = !!res.manual;
          inc.note = `All ${s0.units} ${RESPONDER_UNIT[r][s0.units === 1 ? 0 : 1]} of ${s0.name} are busy — one is on its way back`;
          inc.retry = day + 1;
          if (was !== 'queued') this.emit(sim, inc, 'queued');
          continue;
        }
        this.setUncovered(sim, inc, 'busy', !!res.manual, `All ${s0.units} ${RESPONDER_UNIT[r][s0.units === 1 ? 0 : 1]} of ${s0.name} are busy`);
        inc.retry = day + 1;
      } else if (res.manual) {
        this.setUncovered(sim, inc, 'outOfRange', true, `Outside ${RESPONDER_LABEL[r].toLowerCase()} coverage — nearest free ${RESPONDER_UNIT[r][0]}: ${res.manual.s.name}, ${r2(res.manual.t).toFixed(1)} min away`);
        inc.retry = day + 5;
      } else {
        this.setUncovered(sim, inc, 'noStation', false, `No free ${RESPONDER_UNIT[r][0]} can reach this place`);
        inc.retry = day + 2;
      }
    }
    inc.stVer = this.stVer;
    if (sentAny) this.afterDispatch(sim, inc);
  }

  private setUncovered(sim: Simulation, inc: Incident, reason: UncoveredReason, manualPossible: boolean, note: string): void {
    const changed = inc.state !== 'uncovered' || inc.reason !== reason || inc.manualPossible !== manualPossible;
    inc.state = 'uncovered';
    inc.reason = reason;
    inc.manualPossible = manualPossible;
    inc.note = note;
    inc.etaMin = undefined;
    if (!changed) return;
    this.emit(sim, inc, 'uncovered');
    if (inc.major) {
      const r = INCIDENT_RESPONDERS[inc.kind][0];
      const adv = r === 'medical' ? 'health' : 'safety';
      const txt = manualPossible
        ? `${INCIDENT_LABEL[inc.kind]} at ${inc.place} — ${note}. Send help with the Dispatch tool!`
        : `${INCIDENT_LABEL[inc.kind]} at ${inc.place} — ${note}.`;
      this.news(sim, 'uncovered:' + inc.kind, 2, txt, 'disaster', inc.x, inc.z, adv);
    }
    this.writeStats(sim.state);
  }

  /** sim time the station's next unit is free (Infinity when none will be) */
  private nextFreeAt(s: Station): number {
    let best = Infinity;
    for (const v of this.vlist) {
      if (v.stationId !== s.id) continue;
      if (v.state === 'returning') best = Math.min(best, v.arrive);
    }
    return best;
  }

  private syncStations(sim: Simulation): void {
    const st = sim.state;
    const rebuilt = this.ensureGraph(st);
    if (this.stDirty) this.refreshStations(sim);
    else if (rebuilt) this.stVer++;
  }

  // ------------------------------------------------------------------------------------------ daily
  daily(sim: Simulation): void {
    schedulerOf(sim).tickDay(sim);
    if (!this.active) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const st = sim.state;
    this.sim = sim;
    this.inDaily = true;
    try {
      this.syncStations(sim);
      if (this.updateUnits(st)) this.stVer++;
      if (this.p.searchDay !== st.day) {
        this.p.searchDay = st.day;
        this.p.searchesLeft = EMERG_SEARCHES_PER_DAY;
      }
      this.generate(sim);
      this.advanceVehicles(sim);
      this.processIncidents(sim);
      // automatic dispatch: incidents still missing units (oldest first, within the daily search budget)
      for (let k = 0; k < this.list.length; k++) {
        const inc = this.list[k];
        if (inc.state === 'resolved' || inc.state === 'failed') continue;
        if (!this.missingAny(inc)) continue;
        const due = inc.retry <= st.day || (inc.state === 'uncovered' && inc.stVer !== this.stVer);
        if (due) this.tryDispatch(sim, inc);
      }
      // expire effects
      if (this.p.effects.length) this.p.effects = this.p.effects.filter((e) => e.until > st.day);
      this.rebuildCaches(st);
      this.writeStats(st);
      this.persist();
    } finally {
      this.inDaily = false;
    }
    if (t0) this.lastDailyMs = performance.now() - t0;
  }

  private missingAny(inc: Incident): boolean {
    for (const r of INCIDENT_RESPONDERS[inc.kind]) if ((inc.need[r] ?? 0) > this.assigned(inc, r)) return true;
    return false;
  }

  monthly(sim: Simulation): void {
    if (!this.active) return;
    const st = sim.state;
    const em = st.stats.emergency;
    // medical response quality -> medScore (12-month EMA)
    const [qs, qn] = this.p.medQ;
    if (qn > 0) em.medScore = Math.max(0, Math.min(1, em.medScore + (qs / qn - em.medScore) / 12));
    this.p.medQ = [0, 0];
    // roll the month
    const m = em.month;
    em.lastMonth = m;
    this.p.months.push(m);
    while (this.p.months.length > 12) this.p.months.shift();
    em.year = sumMonths(this.p.months);
    em.month = emptyEmergencyMonth();
    this.buildWeights(sim);
    this.inDaily = true;
    try {
      this.maybeRiot(sim);
    } finally {
      this.inDaily = false;
    }
    this.persist();
  }

  frame(sim: Simulation, _dt: number): void {
    schedulerOf(sim).tickFrame(sim, this);
  }

  // ------------------------------------------------------------------------------------------ generation
  private buildWeights(sim: Simulation): void {
    const st = sim.state;
    const med = this.wMed, crime = this.wCrime, ind = this.wInd, spill = this.wSpill;
    med.clear(); crime.clear(); ind.clear(); spill.clear();
    const list = buildingList(st);
    const util = fundingFactor(st, 'utilities');
    const plantF = EMERG_PLANT_P * (1.5 - Math.min(1.2, util));
    const cr = st.crime;
    const sh = this.shares;
    for (let q = 0; q < list.length; q++) {
      const b = list[q];
      if (!isFunctional(b)) continue;
      const inf = infoOf(st, b);
      if (b.pop > 0) {
        cohortShares(b, sh);
        med.add(b.id, b.pop * MED_RATE * (MED_BASE + MED_SENIOR * sh[4]));
      }
      const occ = b.pop + b.jobs;
      if (occ > 0) {
        const c = cr[centerCell(st, b)];
        if (c > CRIME_SPREE_MIN) {
          const f = (c - CRIME_SPREE_MIN) / 0.4;
          crime.add(b.id, occ * CRIME_SPREE_RATE * Math.min(1, f * f));
        }
      }
      if (inf.fam === Fam.I) {
        const key = inf.dev === 9 ? 'ID' : inf.dev === 10 ? 'IM' : inf.dev === 11 ? 'IHT' : '';
        if (key && b.jobs > 0) ind.add(b.id, b.jobs * (IND_ACCIDENT_RATE[key] ?? 0));
        if (key === 'ID' && b.jobs > 0) spill.add(b.id, b.jobs * SPILL_RATE_ID);
      } else if (inf.fam === Fam.Plop) {
        if ((inf.powerOut > 0 && inf.air > 0) || inf.isIncinerator) ind.add(b.id, plantF);
        const sp = SPILL_SITE_P[b.def] ?? (inf.model ? SPILL_SITE_P[inf.model] : undefined);
        if (sp) spill.add(b.id, sp);
      }
    }
    // congested highway cells (truck spills)
    const net = st.network, cong = st.congestion, tr = st.traffic;
    for (let i = 0; i < st.cells; i++) {
      if (net[i] !== Network.Highway || !(cong[i] > 1)) continue;
      spill.add(-(i + 1), SPILL_HWY_RATE * tr[i] * EMERG_TRUCK_SHARE * 30);
    }
  }

  private poisson(lambda: number): number {
    if (!(lambda > 0)) return 0;
    const L = Math.exp(-Math.min(lambda, 30));
    let k = 0, p = 1;
    do { k++; p *= this.rng.next(); } while (p > L && k < 60);
    return k - 1;
  }

  private generate(sim: Simulation): void {
    const st = sim.state;
    const kinds: [IncidentKind, Weights][] = [['medical', this.wMed], ['crime', this.wCrime], ['industrial', this.wInd], ['spill', this.wSpill]];
    for (const [kind, w] of kinds) {
      if (w.n === 0) continue;
      const n = this.poisson(w.total / 30);
      for (let q = 0; q < n; q++) {
        const id = w.pick(this.rng.next());
        if (id < 0) {
          const cell = -id - 1;
          const x = cell % st.size, z = (cell - x) / st.size;
          if (st.network[cell] !== Network.Highway) continue;
          this.create(sim, kind, x, z, null, {});
          continue;
        }
        const b = st.buildings.get(id);
        if (!b || !isFunctional(b) || b.flags & BF.OnFire) continue;
        if (kind === 'medical' && b.pop <= 0) continue;
        this.create(sim, kind, b.x, b.z, b, {});
      }
    }
  }

  private maybeRiot(sim: Simulation): void {
    const st = sim.state;
    const s = st.stats;
    if (s.population < RIOT_MIN_POP) return;
    if (this.list.some((i) => i.kind === 'riot')) return;
    const p = RIOT_P * smoothstep(RIOT_APPROVAL[0], RIOT_APPROVAL[1], s.approval) * smoothstep(RIOT_CRIME[0], RIOT_CRIME[1], s.avgCrime);
    if (!(p > 0) || this.rng.next() >= p) return;
    // worst block: crime x occupants on coarse 8x8 blocks
    const B = 8, nb = Math.ceil(st.size / B);
    const score = new Float64Array(nb * nb);
    const best = new Int32Array(nb * nb).fill(-1);
    const bestV = new Float64Array(nb * nb);
    for (const b of buildingList(st)) {
      const occ = b.pop + b.jobs;
      if (occ <= 0 || !isFunctional(b)) continue;
      const v = st.crime[centerCell(st, b)] * occ;
      const k = Math.floor(b.z / B) * nb + Math.floor(b.x / B);
      score[k] += v;
      if (v > bestV[k]) { bestV[k] = v; best[k] = b.id; }
    }
    let kb = -1;
    for (let k = 0; k < score.length; k++) if (best[k] >= 0 && (kb < 0 || score[k] > score[kb])) kb = k;
    if (kb < 0) return;
    const b = st.buildings.get(best[kb])!;
    this.create(sim, 'riot', b.x, b.z, b, { major: true });
  }

  // ------------------------------------------------------------------------------------------ vehicles
  private advanceVehicles(sim: Simulation): void {
    const st = sim.state;
    const now = st.day;
    for (let k = 0; k < this.vlist.length; k++) {
      const v = this.vlist[k];
      if (v.state === 'onScene' || v.arrive > now) continue;
      if (v.state === 'outbound') {
        const inc = this.byId.get(v.incidentId);
        if (!inc || inc.state === 'resolved' || inc.state === 'failed') { this.startReturn(v, v.arrive, v.m1); continue; }
        v.state = 'onScene';
        v.workFrom = v.arrive;
        this.onArrive(sim, inc, v);
      } else if (v.state === 'transport') {
        // at the hospital: drive home to the clinic
        const home = this.stById.get(v.stationId);
        const hosp = this.stById.get(v.hospital);
        const route = home && hosp ? this.routeBetween(st, hosp, home) : null;
        if (route) {
          v.path = route.cells;
          v.times = route.times;
          v.state = 'returning';
          v.m0 = 0;
          v.m1 = route.times[route.times.length - 1];
          v.legStart = v.arrive;
          v.arrive = v.legStart + v.m1 * EMERG_DAYS_PER_MIN;
          k--; // may already be home
        } else this.removeVehicle(v, k--);
      } else if (v.state === 'returning') {
        this.removeVehicle(v, k--);
      }
    }
  }

  private removeVehicle(v: EmergencyVehicle, k: number): void {
    this.vlist.splice(k, 1);
    this.vById.delete(v.id);
    const o = (this.out.get(v.stationId) ?? 1) - 1;
    if (o > 0) this.out.set(v.stationId, o);
    else this.out.delete(v.stationId);
    const inc = this.byId.get(v.incidentId);
    if (inc) {
      const i = inc.units.indexOf(v.id);
      if (i >= 0) inc.units.splice(i, 1);
    }
    // a unit is free again: waiting incidents of that responder may retry today
    const st = this.sim?.state;
    if (st) for (const w of this.list) if ((w.state === 'queued' || w.state === 'uncovered') && INCIDENT_RESPONDERS[w.kind].includes(v.responder)) w.retry = Math.min(w.retry, st.day);
  }

  /** start the drive back to the station from path minute m (at sim time t) */
  private startReturn(v: EmergencyVehicle, t: number, m: number): void {
    v.state = 'returning';
    v.m0 = m;
    v.m1 = 0;
    v.legStart = t;
    v.arrive = t + m * EMERG_DAYS_PER_MIN;
  }

  private onArrive(sim: Simulation, inc: Incident, v: EmergencyVehicle): void {
    const st = sim.state;
    const m = st.stats.emergency.month;
    const r = v.responder;
    const firstOfR = inc.firstAt[r] === undefined;
    if (firstOfR) {
      inc.firstAt[r] = v.arrive;
      m.responseMin[r] += (v.arrive - inc.start) / EMERG_DAYS_PER_MIN;
      m.responses[r]++;
    }
    const primary = INCIDENT_RESPONDERS[inc.kind][0];
    const first = inc.arrived < 0;
    if (first) inc.arrived = v.arrive;
    if (r === primary && firstOfR && v.arrive > inc.start + inc.grace) m.late++;
    if (inc.state !== 'resolved' && inc.state !== 'failed') inc.state = 'onScene';
    if (first) this.emit(sim, inc, 'arrived');
    // medical: patient outcome at the first ambulance
    if (inc.kind === 'medical' && r === 'medical' && firstOfR) {
      const D = v.arrive - inc.start;
      const hosp = this.hospitalFor(sim, inc, v);
      if (hosp && hosp.id !== v.stationId) v.hospital = hosp.id;
      this.medicalOutcome(sim, inc, D, hosp);
      const q = D <= inc.grace ? 1 : Math.max(0, 1 - (D - inc.grace) / 11);
      this.p.medQ[0] += q;
      this.p.medQ[1] += 1;
    }
  }

  /** hospital station used for a patient: the dispatching hospital itself, else the nearest reachable one */
  private hospitalFor(sim: Simulation, inc: Incident, v: EmergencyVehicle): Station | null {
    const home = this.stById.get(v.stationId);
    if (home?.hospital) return home;
    const st = sim.state;
    const ns = this.siteSeeds(st, inc);
    if (ns === 0) return null;
    this.ensureTimes(st);
    let found: Station | null = null;
    const stamp = ++this.stamp;
    this.ds.stop = EMERG_MANUAL_MAX;
    this.ds.run(this.g, this.tm, this.seedBuf, ns, EMERG_MANUAL_MAX, this.nodeHead, (u) => {
      for (let e = this.nodeHead[u]; e >= 0; e = this.entNext[e]) {
        const k = this.entSt[e];
        if (this.seen[k] === stamp) continue;
        this.seen[k] = stamp;
        if (this.stations[k].hospital) { found = this.stations[k]; return true; }
      }
      return false;
    });
    return found;
  }

  private medicalOutcome(sim: Simulation, inc: Incident, D: number, hosp: Station | null): void {
    let surv = MED_SURVIVE - MED_DELAY_LOSS * smoothstep(5, 16, D);
    if (hosp) {
      const load = facilityLoad(sim, hosp.id);
      if (load && load.utilization > 1.15) surv -= 0.1;
    }
    this.casualties(sim, inc, surv);
  }

  /** resolve the injured of an incident with survival probability `surv` */
  private casualties(sim: Simulation, inc: Incident, surv: number): void {
    if (inc.injured <= 0) return;
    const m = sim.state.stats.emergency.month;
    let deaths = 0;
    for (let q = 0; q < inc.injured; q++) if (this.rng.next() >= surv) deaths++;
    inc.deaths += deaths;
    m.deaths += deaths;
    m.rescued += inc.injured - deaths;
    inc.injured = 0;
  }

  /** route between two stations (hospital -> clinic): reverse search seeded at `to`, first settled node of `from` */
  private routeBetween(st: CityState, from: Station, to: Station): { cells: number[]; times: number[] } | null {
    if (!to.nodes.length || !from.nodes.length) return null;
    this.ensureTimes(st);
    const ns = Math.min(this.seedBuf.length, to.nodes.length);
    for (let k = 0; k < ns; k++) this.seedBuf[k] = to.nodes[k];
    const kFrom = this.stations.indexOf(from);
    let found = -1;
    this.ds.stop = Infinity;
    this.ds.run(this.g, this.tm, this.seedBuf, ns, EMERG_MANUAL_MAX * 2, this.nodeHead, (u) => {
      for (let e = this.nodeHead[u]; e >= 0; e = this.entNext[e]) if (this.entSt[e] === kFrom) { found = u; return true; }
      return false;
    });
    return found >= 0 ? this.extractPath(found) : null;
  }

  // ------------------------------------------------------------------------------------------ incident processing
  private processIncidents(sim: Simulation): void {
    const st = sim.state;
    const now = st.day;
    for (let k = 0; k < this.list.length; k++) {
      const inc = this.list[k];
      // on-scene work credit per responder since the last processing
      let ud = [0, 0, 0];
      for (const id of inc.units) {
        const v = this.vById.get(id);
        if (!v || v.state !== 'onScene') continue;
        const d = Math.max(0, now - v.workFrom);
        v.workFrom = now;
        ud[R_INDEX[v.responder]] += d;
      }
      if (inc.kind === 'fire') this.fireStep(sim, inc, ud[0]);
      else this.workStep(sim, inc, ud);
      if (inc.state === 'resolved' || inc.state === 'failed') {
        this.finalize(sim, inc, k);
        k--;
      }
    }
  }

  private fireStep(sim: Simulation, inc: Incident, unitDays: number): void {
    const st = sim.state;
    const fire = sim.getSystem<FireSystem>('fire');
    if (!fire) { inc.state = 'resolved'; return; }
    // sync the cluster with the fire registry (disasters / UI may have removed fires)
    const cl: Building[] = [];
    for (const id of inc.fires) {
      const b = st.buildings.get(id);
      const f = fire.fires.get(id);
      if (b && f && b.flags & BF.OnFire) cl.push(b);
    }
    if (cl.length !== inc.fires.length) inc.fires = cl.map((b) => b.id);
    if (cl.length === 0) {
      inc.state = inc.lost > 0 && inc.lost >= inc.saved ? 'failed' : 'resolved';
      return;
    }
    const crews = this.onSceneCount(inc, 'fire');
    const nb = cl.length;
    const held = crews > 0 ? Math.min(1, (crews * FIRE_HOLD_PER_UNIT) / nb) : 0;
    const share = unitDays / nb;
    let maxDays = 0;
    const toSpread: Building[] = [];
    for (const b of cl) {
      const f = fire.fires.get(b.id)!;
      f.days += 1 - held;
      if (share > 0) {
        const watered = (b.flags & BF.Watered) !== 0;
        f.heat = (f.heat ?? 1) - share / (FIRE_WORK_PER_AREA * Math.sqrt(Math.max(1, b.w * b.d)) * (watered ? 1 : FIRE_DRY_WORK));
      }
      if ((f.heat ?? 1) <= 0) {
        fire.putOut(sim, b);
        inc.saved++;
        continue;
      }
      if (f.days >= FIRE_BURN_DAYS) {
        fire.burnDown(sim, b);
        inc.lost++;
        const m = st.stats.emergency.month;
        m.buildingsLost++;
        const def = getDef(b.def);
        const cost = def?.cost ?? 0;
        m.damage += cost > 0 && def?.category !== 'growable' ? cost : Math.max(1, b.capacity) * 40;
        continue;
      }
      maxDays = Math.max(maxDays, f.days);
      toSpread.push(b);
    }
    // spread to neighbours (legacy FIRE_SPREAD_P; x0.2 with a crew on scene, x1.3 without water)
    const N = st.size;
    const fc = st.fireCov;
    const rng = this.rng;
    for (const b of toSpread) {
      const dry = (b.flags & BF.Watered) === 0;
      const mul = (crews > 0 ? FIRE_SPREAD_ONSCENE : 1) * (dry ? FIRE_SPREAD_DRY : 1);
      for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const id = st.building[z * N + x];
        if (id < 0 || id === b.id) continue;
        const nbld = st.buildings.get(id);
        if (!nbld || nbld.flags & (BF.OnFire | BF.Burnt)) continue;
        const cov = fc[centerCell(st, nbld)];
        const p = ((FIRE_SPREAD_P * (1 - 0.8 * Math.min(1, cov))) / Math.max(1, (b.w + b.d) / 2)) * mul;
        if (rng.next() < p) fire.ignite(sim, nbld, true);
      }
    }
    const alive = inc.fires.filter((id) => fire.fires.has(id)).length;
    inc.fires = inc.fires.filter((id) => fire.fires.has(id));
    if (inc.fires.length === 0) {
      inc.state = inc.lost > 0 && inc.lost >= inc.saved ? 'failed' : 'resolved';
      return;
    }
    inc.severity = alive;
    inc.need.fire = 1 + Math.floor(alive / FIRE_HOLD_PER_UNIT);
    inc.deadline = st.day + Math.max(0, FIRE_BURN_DAYS - maxDays);
    if (inc.need.fire > this.assigned(inc, 'fire')) inc.retry = Math.min(inc.retry, st.day);
  }

  private workStep(sim: Simulation, inc: Incident, ud: number[]): void {
    const st = sim.state;
    const now = st.day;
    const kind = inc.kind;
    const primary = INCIDENT_RESPONDERS[kind][0];
    const pud = ud[R_INDEX[primary]];
    const m = st.stats.emergency.month;
    const b = inc.buildingId >= 0 ? st.buildings.get(inc.buildingId) : undefined;
    if (inc.buildingId >= 0 && !b) { inc.state = 'resolved'; return; } // site bulldozed
    if (kind === 'riot') {
      m.riotDays++;
      const police = this.onSceneCount(inc, 'police');
      const need = inc.need.police ?? 2;
      const loose = Math.max(0, 1 - police / need);
      if (loose > 0) {
        inc.radius = Math.min(RIOT_R_MAX, Math.max(inc.radius, 2 + RIOT_R_GROW * (now - inc.start)));
        this.riotDamage(sim, inc, loose);
        const nn = 2 + Math.floor(inc.radius / 3);
        if (nn > need) {
          inc.need.police = nn;
          this.emit(sim, inc, 'escalated');
          inc.retry = Math.min(inc.retry, now);
        }
      }
      inc.severity = Math.round(inc.radius * 10) / 10;
    }
    if (kind === 'industrial' && inc.firstAt.fire === undefined && now - inc.start >= EMERG_GRACE.industrial && b && !(b.flags & (BF.OnFire | BF.Burnt))) {
      // unanswered accident: the plant catches fire (its own fire incident) and the accident counts as failed
      this.emit(sim, inc, 'escalated');
      sim.getSystem<FireSystem>('fire')?.ignite(sim, b, false);
      this.casualties(sim, inc, MED_SURVIVE - MED_DELAY_LOSS * smoothstep(5, 16, now - inc.start + 6));
      inc.state = 'failed';
      return;
    }
    if (inc.arrived >= 0 && pud > 0) inc.work -= pud;
    if (inc.arrived >= 0 && inc.work <= 1e-9 && this.onSceneCount(inc, primary) > 0) {
      this.resolveOutcome(sim, inc, now);
      inc.state = 'resolved';
      return;
    }
    // deadline: nobody of the primary responder got there in time (units already working may finish)
    if (now >= inc.deadline && inc.firstAt[primary] === undefined) {
      this.failOutcome(sim, inc, now);
      inc.state = 'failed';
    }
  }

  private resolveOutcome(sim: Simulation, inc: Incident, now: number): void {
    const st = sim.state;
    const m = st.stats.emergency.month;
    const rng = this.rng;
    switch (inc.kind) {
      case 'crime': m.arrests += inc.major ? rng.int(3, 8) : rng.int(1, 4); break;
      case 'riot':
        m.arrests += rng.int(10, 40);
        this.p.effects.push({ kind: 'crime', x: inc.x, z: inc.z, radius: inc.radius + 2, a: RIOT_AFTER_BOOST, b: 0, until: now + RIOT_AFTER_DAYS });
        break;
      case 'prisonRiot': m.arrests += rng.int(5, 15); break;
      case 'industrial':
      case 'collapse': {
        const Dm = inc.firstAt.medical !== undefined ? inc.firstAt.medical - inc.start : 16;
        const Df = (inc.firstAt.fire ?? now) - inc.start;
        const surv = inc.kind === 'collapse'
          ? 0.95 - 0.6 * smoothstep(inc.grace, 15, Df) - (inc.firstAt.medical === undefined ? 0.1 : 0)
          : MED_SURVIVE - MED_DELAY_LOSS * smoothstep(5, 16, Dm);
        this.casualties(sim, inc, surv);
        break;
      }
      default: break;
    }
  }

  private failOutcome(sim: Simulation, inc: Incident, now: number): void {
    const st = sim.state;
    switch (inc.kind) {
      case 'medical':
      case 'industrial':
      case 'collapse':
        this.casualties(sim, inc, 0.3);
        break;
      case 'crime':
        this.p.effects.push({ kind: 'crime', x: inc.x, z: inc.z, radius: 4, a: SPREE_FAIL_BOOST, b: 0, until: now + SPREE_FAIL_DAYS });
        break;
      case 'riot':
        this.p.effects.push({ kind: 'crime', x: inc.x, z: inc.z, radius: inc.radius + 2, a: RIOT_AFTER_BOOST, b: 0, until: now + RIOT_AFTER_DAYS });
        break;
      case 'prisonRiot': {
        const j = st.systemData.justice as { inmates?: number } | undefined;
        if (j && typeof j.inmates === 'number') j.inmates *= 1 - PRISON_ESCAPE;
        st.stats.justice.inmates *= 1 - PRISON_ESCAPE;
        this.p.effects.push({ kind: 'crime', x: inc.x, z: inc.z, radius: 40, a: 0.1, b: 0, until: now + 90 });
        break;
      }
      case 'spill':
        this.p.effects.push({ kind: 'poll', x: inc.x, z: inc.z, radius: SPILL_POLL.radius, a: SPILL_POLL.air * 0.5, b: SPILL_POLL.water * 0.5, until: now + 30 });
        break;
      default: break;
    }
  }

  private riotDamage(sim: Simulation, inc: Incident, loose: number): void {
    const st = sim.state;
    const R = inc.radius;
    const fire = sim.getSystem<FireSystem>('fire');
    let ignitions = 0;
    const m = st.stats.emergency.month;
    const x0 = Math.max(0, Math.floor(inc.x - R)), x1 = Math.min(st.size - 1, Math.ceil(inc.x + R));
    const z0 = Math.max(0, Math.floor(inc.z - R)), z1 = Math.min(st.size - 1, Math.ceil(inc.z + R));
    const seen = new Set<number>();
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if ((x - inc.x) * (x - inc.x) + (z - inc.z) * (z - inc.z) > R * R) continue;
      const id = st.building[z * st.size + x];
      if (id < 0 || seen.has(id)) continue;
      seen.add(id);
      const b = st.buildings.get(id);
      if (!b || !isFunctional(b)) continue;
      b.health = Math.max(0, b.health - RIOT_HEALTH * loose);
      m.damage += 20 * loose;
      if (fire && ignitions < 2 && !(b.flags & BF.OnFire) && this.rng.next() < RIOT_IGNITE_P * loose) {
        if (fire.ignite(sim, b, true)) ignitions++;
      }
    }
  }

  private finalize(sim: Simulation, inc: Incident, k: number): void {
    const st = sim.state;
    const now = st.day;
    this.list.splice(k, 1);
    this.byId.delete(inc.id);
    this.optCache.delete(inc.id);
    const m = st.stats.emergency.month;
    if (inc.state === 'failed') m.failed++;
    // release units
    for (const id of inc.units) {
      const v = this.vById.get(id);
      if (!v) continue;
      if (v.state === 'onScene') {
        const home = this.stById.get(v.stationId);
        if (inc.kind === 'medical' && v.responder === 'medical' && home && !home.hospital && inc.state === 'resolved') {
          const hosp = v.hospital >= 0 ? this.stById.get(v.hospital) ?? null : null;
          const route = hosp ? this.hospitalRoute(sim, inc, hosp) : null;
          if (hosp && route) {
            v.state = 'transport';
            v.hospital = hosp.id;
            v.path = route.cells;
            v.times = route.times;
            v.m0 = route.times[route.times.length - 1];
            v.m1 = 0;
            v.legStart = now;
            v.arrive = now + v.m0 * EMERG_DAYS_PER_MIN;
            continue;
          }
        }
        this.startReturn(v, now, v.m1);
      } else if (v.state === 'outbound') {
        // recall: turn around where it is
        const el = Math.max(0, (now - v.legStart) / EMERG_DAYS_PER_MIN);
        this.startReturn(v, Math.max(now, v.legStart), Math.min(v.m1, el));
      }
    }
    const b = inc.buildingId >= 0 ? st.buildings.get(inc.buildingId) : undefined;
    if (b) this.setIncidentFlag(sim, b, false);
    for (const id of inc.fires) {
      const fb = st.buildings.get(id);
      if (fb) this.setIncidentFlag(sim, fb, false);
    }
    this.emit(sim, inc, inc.state === 'failed' ? 'failed' : 'resolved');
    this.outcomeNews(sim, inc);
  }

  /** route site -> hospital (reverse search from the site; the ambulance drives it backwards) */
  private hospitalRoute(sim: Simulation, inc: Incident, hosp: Station): { cells: number[]; times: number[] } | null {
    const st = sim.state;
    const ns = this.siteSeeds(st, inc);
    if (ns === 0) return null;
    this.ensureTimes(st);
    const k = this.stations.indexOf(hosp);
    let found = -1;
    this.ds.stop = Infinity;
    this.ds.run(this.g, this.tm, this.seedBuf, ns, EMERG_MANUAL_MAX * 2, this.nodeHead, (u) => {
      for (let e = this.nodeHead[u]; e >= 0; e = this.entNext[e]) if (this.entSt[e] === k) { found = u; return true; }
      return false;
    });
    return found >= 0 ? this.extractPath(found) : null;
  }

  private outcomeNews(sim: Simulation, inc: Incident): void {
    const L = INCIDENT_LABEL[inc.kind];
    const adv = INCIDENT_RESPONDERS[inc.kind][0] === 'medical' ? 'health' : 'safety';
    if (inc.state === 'failed') {
      let txt: string;
      switch (inc.kind) {
        case 'fire': txt = `The fire at ${inc.place} burned down ${inc.lost} building${inc.lost === 1 ? '' : 's'}.`; break;
        case 'medical': txt = `Medical emergency at ${inc.place}: ${inc.deaths ? `${inc.deaths} ${inc.deaths === 1 ? 'person' : 'people'} died` : 'nobody came'} — no ambulance arrived in time.`; break;
        case 'riot': txt = `The riot at ${inc.place} burned itself out after ${Math.round(sim.state.day - inc.start)} days. Crime is up in the area.`; break;
        case 'crime': txt = `The crime spree at ${inc.place} went unanswered — the neighbourhood is less safe now.`; break;
        case 'spill': txt = `The hazardous spill at ${inc.place} was never contained and is polluting the area.`; break;
        case 'prisonRiot': txt = `Prison riot at ${inc.place}: inmates escaped!`; break;
        case 'industrial': txt = `The industrial accident at ${inc.place} was not answered in time and the plant caught fire.`; break;
        default: txt = `${L} at ${inc.place}: help came too late${inc.deaths ? ` (${inc.deaths} dead)` : ''}.`;
      }
      this.news(sim, 'failed:' + inc.kind, 3, txt, 'bad', inc.x, inc.z, adv);
    } else if (inc.major && inc.answered === 2) {
      this.news(sim, 'resolved:' + inc.kind, 3, `${L} at ${inc.place} is under control — thanks to your dispatch.`, 'good', inc.x, inc.z, adv);
    }
  }

  private news(sim: Simulation, key: string, minDays: number, text: string, kind: 'good' | 'bad' | 'warning' | 'disaster' | 'info', x: number, z: number, adv: string): void {
    const day = sim.state.day;
    if (day - (this.lastNews.get(key) ?? -1e9) < minDays) return;
    this.lastNews.set(key, day);
    sim.notify(text, kind, x, z, adv);
  }

  private emit(sim: Simulation, inc: Incident, type: EmergencyEvent['type']): void {
    const ev: EmergencyEvent = { type, id: inc.id, kind: inc.kind, x: inc.x, z: inc.z, major: inc.major, manualPossible: inc.manualPossible };
    if (inc.reason && (type === 'uncovered' || type === 'queued')) ev.reason = inc.reason;
    if (inc.etaMin !== undefined && (type === 'dispatched' || type === 'queued')) ev.etaMin = inc.etaMin;
    sim.events.emit('emergency', ev);
  }

  private writeStats(st: CityState): void {
    const em = st.stats.emergency;
    em.active = this.list.length;
    let man = 0;
    for (const inc of this.list) if (inc.state === 'uncovered' && inc.manualPossible && inc.major) man++;
    em.manualActive = man;
  }

  private rebuildCaches(st: CityState): void {
    const boosts: CrimeBoost[] = [];
    const polls: EmergencyPollutionSource[] = [];
    for (const inc of this.list) {
      if (inc.kind === 'riot') boosts.push({ x: inc.x, z: inc.z, radius: inc.radius + 2, amount: RIOT_CRIME_BOOST });
      else if (inc.kind === 'prisonRiot') boosts.push({ x: inc.x, z: inc.z, radius: 6, amount: 0.2 });
      else if (inc.kind === 'spill') polls.push({ x: inc.x, z: inc.z, air: SPILL_POLL.air, water: SPILL_POLL.water, radius: SPILL_POLL.radius });
      else if (inc.kind === 'industrial') polls.push({ x: inc.x, z: inc.z, air: INDUSTRIAL_POLL.air, water: INDUSTRIAL_POLL.water, radius: INDUSTRIAL_POLL.radius });
    }
    for (const e of this.p.effects) {
      if (e.until <= st.day) continue;
      if (e.kind === 'crime') boosts.push({ x: e.x, z: e.z, radius: e.radius, amount: e.a });
      else polls.push({ x: e.x, z: e.z, air: e.a, water: e.b, radius: e.radius });
    }
    this.boosts = boosts;
    this.polls = polls;
  }

  /** crime boosts of active riots / failed incidents (crime.ts) */
  crimeBoosts(): CrimeBoost[] {
    return this.boosts;
  }
  /** pollution sources of active spills / accidents (pollution.ts) */
  pollutionSources(): EmergencyPollutionSource[] {
    return this.polls;
  }

  // ------------------------------------------------------------------------------------------ response layers
  private respDue(sim: Simulation): boolean {
    if (this.respStep >= 0) return true;
    const day = sim.state.day;
    if (day - this.respLast >= EMERG_RESP_PERIOD) return true;
    if (!this.respDirty) return false;
    // network edits: at most every 10 days headless (bots edit roads constantly); stations / live play: right away
    if (this.respNetOnly && !schedulerOf(sim).framesActive) return day - this.respLast >= 10;
    return true;
  }

  private respCost(): number {
    const nf = Math.max(0.05, this.g.n / 36000);
    if (this.respStep < 0 || this.respStep < 3) return 0.2 + EMERG_SEARCH_COST * Math.min(1.6, nf);
    const cf = this.g.C / 65536;
    return 0.1 + (EMERG_FILL_COST / 3) * cf + 0.2 * Math.max(0.05, (this.sim?.state.buildings.size ?? 0) / 20000);
  }

  private respTaskStep(sim: Simulation): void {
    const st = sim.state;
    if (this.respStep < 0) {
      this.syncStations(sim);
      this.ensureTimes(st);
      this.respStep = 0;
      this.respDirty = false;
      this.respNetOnly = false;
    }
    if (this.respStep < 3) this.respSearch(st, RESPONDERS[this.respStep]);
    else this.respFill(st, RESPONDERS[this.respStep - 3]);
    this.respStep++;
    if (this.respStep >= 6) {
      this.respStep = -1;
      this.respLast = st.day;
      this.respComputed = true;
      sim.events.emit('layerUpdated', 'emergency');
    }
  }

  private respSearch(st: CityState, r: Responder): void {
    const g = this.g;
    const ri = R_INDEX[r];
    const n = g.n;
    if (this.nodeSlack[ri].length < n) this.nodeSlack[ri] = new Float32Array(n + (n >> 3) + 16);
    const slack = this.nodeSlack[ri];
    const seeds = this.seeds;
    seeds.clear();
    let any = false;
    for (let k = 0; k < this.stations.length; k++) {
      const s = this.stations[k];
      if (s.responder !== r || s.units <= 0) continue;
      any = true;
      const label = Math.max(0, EMERG_RMAX - s.range);
      for (const v of s.nodes) seeds.push(v, label, k);
    }
    this.hasStation[ri] = any;
    if (!any || n === 0) { slack.fill(-EMERG_RMAX, 0, n); return; }
    const S = this.S;
    roadSearch(g, g.fwd, this.tm, S, this.heap, seeds, EMERG_RMAX + EMERG_SLOW_MARGIN);
    const dist = S.dist;
    for (let v = 0; v < n; v++) {
      const d = dist[v];
      if (d === Infinity) { slack[v] = -EMERG_RMAX; continue; }
      const s = EMERG_RMAX - d;
      slack[v] = s > -EPS && s < 0 ? 0 : s;
    }
  }

  private respFill(st: CityState, r: Responder): void {
    const ri = R_INDEX[r];
    const layer = r === 'fire' ? st.respFire : r === 'police' ? st.respPolice : st.respMedical;
    if (!this.hasStation[ri]) { layer.fill(RESP_NONE); return; }
    const g = this.g;
    const N = st.size;
    const slack = this.nodeSlack[ri];
    const noc = g.nodeOfCell;
    const bld = st.building;
    const NONE = -EMERG_RMAX;
    for (let z = 0; z < N; z++) {
      const row = z * N;
      for (let x = 0; x < N; x++) {
        const i = row + x;
        if (bld[i] >= 0) continue; // buildings below
        let best = NONE;
        const own = noc[i];
        if (own >= 0 && slack[own] > best) best = slack[own];
        if (x > 0) { const v = noc[i - 1]; if (v >= 0 && slack[v] > best) best = slack[v]; }
        if (x < N - 1) { const v = noc[i + 1]; if (v >= 0 && slack[v] > best) best = slack[v]; }
        if (z > 0) { const v = noc[i - N]; if (v >= 0 && slack[v] > best) best = slack[v]; }
        if (z < N - 1) { const v = noc[i + N]; if (v >= 0 && slack[v] > best) best = slack[v]; }
        layer[i] = best;
      }
    }
    const tmp = this.tmpNodes;
    for (const b of buildingList(st)) {
      let best = NONE;
      const c = perimeterNodes(noc, N, b, tmp, 0, tmp.length);
      for (let k = 0; k < c; k++) if (slack[tmp[k]] > best) best = slack[tmp[k]];
      if (c >= tmp.length) {
        // very large footprint: scan the full perimeter
        const big = new Int32Array(2 * (b.w + b.d) + 8);
        const c2 = perimeterNodes(noc, N, b, big, 0, big.length);
        for (let k = 0; k < c2; k++) if (slack[big[k]] > best) best = slack[big[k]];
      }
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        if (bld[i] === b.id) layer[i] = best;
      }
    }
  }

  /** response layers computed at least once (init) */
  get layersReady(): boolean {
    return this.respComputed;
  }
}

/** road nodes around a cell without a building: its own node (road cell) + 4-neighbour road nodes */
function cellSeeds(g: RoadGraph, N: number, x: number, z: number, out: Int32Array): number {
  let c = 0;
  const noc = g.nodeOfCell;
  const i = z * N + x;
  if (noc[i] >= 0) out[c++] = noc[i];
  if (x > 0 && noc[i - 1] >= 0) out[c++] = noc[i - 1];
  if (x < N - 1 && noc[i + 1] >= 0) out[c++] = noc[i + 1];
  if (z > 0 && noc[i - N] >= 0) out[c++] = noc[i - N];
  if (z < N - 1 && noc[i + N] >= 0) out[c++] = noc[i + N];
  return c;
}

function placeName(st: CityState, x: number, z: number): string {
  const t = st.network[z * st.size + x];
  if (t === Network.Highway) return `the highway (${x}, ${z})`;
  return `(${x}, ${z})`;
}

function sumMonths(ms: readonly EmergencyMonth[]): EmergencyMonth {
  const s = emptyEmergencyMonth();
  for (const m of ms) {
    for (const k of INCIDENT_KINDS) s.count[k] += m.count?.[k] ?? 0;
    for (const r of RESPONDERS) {
      s.responseMin[r] += m.responseMin?.[r] ?? 0;
      s.responses[r] += m.responses?.[r] ?? 0;
    }
    s.auto += m.auto; s.manual += m.manual; s.late += m.late; s.failed += m.failed;
    s.deaths += m.deaths; s.injured += m.injured; s.rescued += m.rescued; s.buildingsLost += m.buildingsLost;
    s.damage += m.damage; s.arrests += m.arrests; s.riotDays += m.riotDays;
  }
  return s;
}

export function emergencyOf(sim: Simulation): EmergencySystem | undefined {
  return sim.getSystem<EmergencySystem>('emergency');
}

/** vehicles for the renderer (EmergencyVehicles.ts) */
export function emergencyVehicles(sim: Simulation): readonly EmergencyVehicle[] {
  return emergencyOf(sim)?.vehicles() ?? [];
}

/** auto-dispatch reach of responder r at a cell: slack >= 0 = covered; slackMin RESP_NONE = no station of that type */
export function responseAt(sim: Simulation, cell: number, r: Responder): { slackMin: number; covered: boolean } | null {
  const em = emergencyOf(sim);
  const st = sim.state;
  if (!em || !em.active || !em.layersReady || cell < 0 || cell >= st.cells) return null;
  const layer = r === 'fire' ? st.respFire : r === 'police' ? st.respPolice : st.respMedical;
  const v = layer[cell];
  return { slackMin: v, covered: v >= 0 };
}

/** coarse 8x8 blocks with the most residents outside responder r's auto-dispatch reach (top n) */
export function uncoveredHotspots(sim: Simulation, r: Responder, n = 5): { x: number; z: number; people: number }[] {
  const em = emergencyOf(sim);
  const st = sim.state;
  if (!em || !em.active || !em.layersReady) return [];
  const layer = r === 'fire' ? st.respFire : r === 'police' ? st.respPolice : st.respMedical;
  const B = 8, nb = Math.ceil(st.size / B);
  const acc = new Float64Array(nb * nb);
  for (const b of buildingList(st)) {
    if (b.pop <= 0) continue;
    if (layer[centerCell(st, b)] >= 0) continue;
    acc[Math.floor(b.z / B) * nb + Math.floor(b.x / B)] += b.pop;
  }
  const out: { x: number; z: number; people: number }[] = [];
  for (let k = 0; k < acc.length; k++) if (acc[k] > 0) out.push({ x: (k % nb) * B + B / 2, z: Math.floor(k / nb) * B + B / 2, people: acc[k] });
  out.sort((a, b) => b.people - a.people || a.z - b.z || a.x - b.x);
  return out.slice(0, n);
}

/** pollution sources of active incidents (spills, industrial accidents, failed spills) */
export function emergencyPollution(sim: Simulation): EmergencyPollutionSource[] {
  const em = emergencyOf(sim);
  return em && em.active && typeof em.pollutionSources === 'function' ? em.pollutionSources() : [];
}

/** crime boosts of active / failed incidents (riots, failed crime sprees, prison riots) */
export function emergencyCrimeBoosts(sim: Simulation): CrimeBoost[] {
  const em = emergencyOf(sim);
  return em && em.active && typeof em.crimeBoosts === 'function' ? em.crimeBoosts() : [];
}
