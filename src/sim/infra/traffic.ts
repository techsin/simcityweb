/**
 * Traffic & transit system — commute / shopping / freight trip generation, capacity-constrained job matching,
 * congestion-aware assignment, mode choice.
 *
 * MODEL (one "cycle" = one full assignment, started every TRAFFIC_CYCLE_DAYS days, executed as small steps by the
 * shared InfraScheduler — see scheduler.ts):
 *  PREP     rebuild graphs when the network changed; snapshot origins (R buildings: workers = pop * 0.55), job sites
 *           (C / I capacity, plopped def.jobs, + neighbour connections as regional job sources), stops, node times
 *           from the smoothed volumes (BPR: t = t0 * (1 + 0.15 (v/c)^4)).
 *  TRANSIT  reverse multi-source Dijkstra on the multimodal transit net (bus riding on roads, rail, subway, transfers)
 *           seeded at stops within walking distance of job sites -> each origin's best transit option.
 *  ROUNDS   capacity-constrained matching (successive filling, up to MATCH_ROUNDS rounds, 2 steps each):
 *           search = reverse multi-source Dijkstra from every job site that still has capacity this round;
 *           match  = every origin with unassigned workers proposes to its nearest open site; proposals are accepted
 *           nearest-first up to the site's remaining capacity. The first MATCH_PROP_ROUNDS rounds cap each site at
 *           its proportional share (slots x min(1, 1.15 x workers / slots)) so that with surplus jobs sites fill
 *           proportionally instead of "nearest full, far empty"; later rounds allow full capacity.
 *           Seeds carry a persistent shadow price per site (minutes, tatonnement on first-round excess demand), so
 *           catchments match capacities after a few cycles and the rounds only clean up the remainder.
 *           Each accepted piece gets a car / transit / walk split (multinomial logit on times, wealth biases,
 *           ordinance effects); car flows are accumulated along that round's shortest-path forest in O(n).
 *  COMMUTE  transit riders accumulated on the transit forest (bus PCU on roads, rail / subway riders); per-origin
 *           employment access, commute times, mode shares.
 *  INBOUND  forward Dijkstra from neighbour connections: regional workers fill still-vacant jobs (connection caps).
 *  SHOP     reverse Dijkstra from commercial services; residents' shopping trips (off-peak weighted). \ every 2nd
 *  FREIGHT  reverse Dijkstra from freight sinks (road connections, rail-linked freight stations, seaports, airports); / cycle
 *           trucks (x TRUCK_LOCAL_FACTOR time off highways: trucks prefer highways).
 *  FINAL    MSA blend of volumes (equilibrium across cycles), write layers / flags / stats, sample routes.
 *
 * TRANSPORT FACILITIES (WP7b, docs/SIM_DEPTH_AMENDMENTS.md WP7-5 .. WP7-10, docs/SIM_DEPTH_PART_B.md):
 *  stations   a stop serves only while attached (refreshAttach, cell level, independent of the graph timing): bus stop
 *             next to a road, subway / train station on a line holding another station of its mode (train: or rail to
 *             the map edge), ferry terminal linked to a partner (ferry.ts). Unattached stops carry no riders and no
 *             transitCov (transit.ts / services' transit slot); stopAttached(id), stopLoad(id).
 *  buses      depots run DEPOT_BUSES each for the stops within DEPOT_RANGE road tiles (multi-source BFS on road / depot
 *             change); stops no depot reaches share MINIBUS_FLEET minibuses; rho = fleet / (riders / RIDERS_PER_BUS)
 *             in [BUS_RHO_MIN, BUS_RHO_MAX] divides the bus base wait (prepTransit).
 *  ferries    ferry nodes in the transit net (links = transfer edges, steps x FERRY_TIME_PER_CELL minutes).
 *  P&R        PH_PARKRIDE: reverse road search from park & ride garages (garage within PR_STOP_RADIUS of an attached
 *             stop) labelled with the stop's transit time; the origin's transit option is min(walk to a stop, park &
 *             ride); car legs flow on the P&R forest, riders join the transit forest at the garage's stop. A garage
 *             whose stop's best path rides nothing (jobs a walk away: downtown) is park & walk: car trips (car
 *             overhead, no wait), no stop riders, the parked cars leave the blocks' lots (garageInfo().ride = false).
 *  car-less   carlessShare(b) of each origin pays CARLESS_EXTRA_MIN more by car and park & ride (taxi / lift).
 *  parking    PH_PARKING (every 2nd cycle): parking.ts raster from car arrivals vs supply; car commuters to a site pay
 *             PARKING_MIN x parking(site).
 *  ramps      traffic's searches charge RAMP_BY_NET x congestion of the interchange (ramp flow per non-highway cell next
 *             to a highway, MSA smoothed) instead of the flat RAMP_PENALTY; roadCellReport shows the interchange load.
 *  trucks     truck time x TRUCK_LOCAL_FACTOR off highways; trucks / day per road cell (truckVolume); PH_SINKS: trucks
 *             within FREIGHT_SINK_MIN of each seaport / rail-linked freight station (sinkTrucks); freight trains run from
 *             rail-linked freight stations to the map edge / a seaport (freightRailCells).
 * Persistent (systemData.infraTransport): smoothed bus need per depot, stop / garage loads, ramp flows, parking (u8), so
 * the first post-load assignment continues where the save left off.
 *
 * OUTPUTS: state.traffic (PCU trips/day per road cell; riders/day on rail cells), state.congestion (v/c),
 *   state.commute (minutes on residential building cells), stats.avgCommute / avgTraffic / tripsCar / tripsTransit /
 *   tripsWalk, BF.NoJobs (residential: < 35 % of workers matched to a job), BF.Congested (entry road v/c > 1).
 * API (TrafficSystem, get via getTraffic(sim)):
 *   getSampleRoutes(max), routeInfo(buildingId), workerAccess(id), jobFill(id), freightAccess(id), customers(id),
 *   commuteOf(id), findPath(fromCell, toCell), pushServiceRoute(cells, weight, days), accessById / jobFillById arrays;
 *   WP7b: stopAttached(id), stopLoad(id), freightRailCells(), freightLinked(id), sinkTrucks(id), truckVolume(),
 *   depotInfo(id), garageInfo(id), ferryLinks(), ferryPartnersFor(...), stopsNear(...), rampLoad(cell), cellBusRiders(cell),
 *   fleetStats, parkingSummary.
 */
import { Network } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import {
  Fam, Transit, activeJobs, centerCell, detectJobsUnknown, ensureIdFloat, infoOf, isFunctional, jobSlots, nowMs,
  readEffects, setFlagQuiet, wealthOf, type OrdEffects,
  buildingList, fundingFactor,
} from './common';
import { GridGraph, RoadGraph, findNeighborConnections, perimeterNodes, type NeighborConn } from './graph';
import { MinHeap } from './heap';
import {
  BPR_ALPHA, BPR_MAX_FACTOR, BUS_PCU_PER_RIDER, BUS_TIME_FACTOR, CAR_BIAS, CAR_OCCUPANCY, CAR_OVERHEAD,
  CONNECTION_JOBS, CONNECTION_WORKERS, FREIGHT_PER_JOB, MAX_COMMUTE, MODE_BETA, MSA_MIN_ALPHA, NET_CAPACITY, NET_TIME,
  REGIONAL_FILL, REGIONAL_TIME, SHOP_PCU_WEIGHT, SHOP_TRIPS_PER_RES, STOP_CAP_BUS,
  STOP_CAP_SUBWAY, STOP_CAP_TRAIN, STOP_WALK_RADIUS, STOP_WALK_TIME_PER_CELL, SUBWAY_TIME, TRAFFIC_CYCLE_DAYS,
  TRAFFIC_MIN_CYCLE_MS, TRANSIT_BIAS, TRUCK_PCU, WAIT_BUS, WAIT_SUBWAY, WAIT_TRAIN, WALK_BIAS, WALK_MAX_CELLS,
  WALK_TIME_PER_CELL, WORKER_SHARE, DEST_NOISE, RESULT_SMOOTH, MATCH_ROUNDS, REGION_JOB_MIN, REGION_JOB_SHARE,
  REGION_WORKER_MIN, REGION_WORKER_SHARE, MATCH_PROP_ROUNDS, MATCH_PROP_SLACK, MATCH_PRICE_STEP_REL, MATCH_PRICE_STEP_MIN, MATCH_PRICE_MAX,
  RAMP_PENALTY, BUS_NEED_SMOOTH, BUS_RHO_MAX, BUS_RHO_MIN, CARLESS_EXTRA_MIN, DEPOT_BUSES, DEPOT_FUNDING_MAX, DEPOT_RANGE,
  DEPOT_UNPOWERED, FERRY_TIME_PER_CELL, FREIGHT_SINK_MIN, GARAGE_CROWD_FROM, GARAGE_CROWD_K, GARAGE_SPACES, MINIBUS_FLEET,
  PARKING_MIN, PARKING_SHOP_W, PR_CAR_LEG_MAX, PR_HOME_MIN, PR_LIMIT, PR_PARK_MIN, PR_STOP_RADIUS, RAMP_ALPHA, RAMP_BY_NET,
  RAMP_CAP, RAMP_MAX_FACTOR, RIDERS_PER_BUS, STOP_CAP_FERRY, TRUCK_LOCAL_FACTOR, WAIT_FERRY, GARAGE_LOAD_SMOOTH, GARAGE_WALK_RADIUS,
} from './params';
import { schedulerOf, type InfraTask } from './scheduler';
import { REGION_JOBS_FOR_RESIDENTS } from '../economy/tuning';
import { carlessShare, workerShare } from '../economy/demographics';
import { Search, Seeds, accumulate, roadSearch, transitSearch, type TransitNet } from './search';
import { TRAFFIC_OF_STATE, collectStops, isStopMode, type StopList } from './transit';
import { getDef } from '../catalog';
import { computeFerryNet, ferryPartnersAt, type FerryLink, type FerryNet, type FerryPartner, type FerryTerminal } from './ferry';
import { addFootprint, addGarageSupply, baseSupply, computeParking, parkingOver, type ParkingSummary } from './parking';

/** netFlags bit 5: rail level crossing on a road cell (see src/sim/actions.ts NET_CROSSING) */
const NETFLAG_CROSSING = 1 << 5;

export type RouteKind = 'car' | 'bus' | 'truck' | 'train' | 'service';
export interface SampleRoute {
  /** cell indices (i = z*N + x) along a real route, in travel order */
  cells: Uint32Array;
  kind: RouteKind;
  /** trips/day this route represents (spawn vehicles proportionally) */
  weight: number;
  /** vehicle model hint (WP7-12: police patrols 'car_police', garbage rounds 'garbage_truck'); omit = renderer's choice */
  model?: string;
}
export interface RouteInfo {
  /** residential: average commute minutes of its workers; job site: average commute of arriving workers */
  commuteMin: number;
  /** dominant mode: 'car' | 'transit' | 'walk' | 'none' */
  mode: string;
  /** residential: workers that reached a job; job site: workers arriving (local + regional) */
  jobsReached: number;
}

const PH_PREP = 0, PH_PREP2 = 1, PH_TRANSIT = 2, PH_RSEARCH = 3, PH_RMATCH = 4, PH_COMMUTE = 5, PH_INBOUND = 6, PH_SHOP = 7,
  PH_FREIGHT = 8, PH_FINAL = 9, PH_FINAL2 = 10,
  // WP7b (appended so the indices of the phases above stay stable): per-origin transit options (split from TRANSIT),
  // park & ride search, freight sink throughput, parking raster
  PH_TRANSIT2 = 11, PH_PARKRIDE = 12, PH_SINKS = 13, PH_PARKING = 14;
const PHASES = 15;
/** phase order (the matching rounds PH_RSEARCH <-> PH_RMATCH choose their successor in roundMatch) */
const NEXT_PHASE: readonly number[] = [
  PH_PREP2, PH_TRANSIT, PH_TRANSIT2, PH_RMATCH, -2, PH_INBOUND, PH_SHOP, PH_FREIGHT, PH_SINKS, PH_FINAL2, -1,
  PH_PARKRIDE, PH_RSEARCH, PH_PARKING, PH_FINAL,
];
/**
 * estimated ms per phase on the reference 256² stress city (scaled by graph / building counts). WP7b phases calibrated
 * by step-wise CPU on stressCity(256) + 853 facilities + 40 garages / 6 terminals / 2 depots (CPU per estimated ms of
 * the cycle unchanged: 3.31 vs 3.35 without WP7b)
 */
const PHASE_COST = [1.9, 0.9, 2.3, 1.2, 1.2, 1.5, 2.4, 2.8, 2.4, 0.4, 1.6, 0.6, 1.6, 1.2, 1.8];
/** car-less share: the car / park & ride utility x exp(-MODE_BETA x CARLESS_EXTRA_MIN) */
const CARLESS_K = Math.exp(-MODE_BETA * CARLESS_EXTRA_MIN);
/** transport defs of the WP7b fleet / parking models (per-def data keyed by def id; catalogTypes is read-only) */
const DEPOT_DEFS: Readonly<Record<string, number>> = { civ_bus_depot: DEPOT_BUSES };
const GARAGE_DEFS: Readonly<Record<string, number>> = { tr_parking_garage: GARAGE_SPACES };
/** estimated ms of a road / rail / subway graph rebuild on a 256² map */
const REBUILD_COST = 2.5;
const MAX_ENTRIES = 12;
const MODE_NAMES = ['none', 'car', 'transit', 'walk'];
const IND_KEYS = ['IA', 'ID', 'IM', 'IHT'] as const;

/** growable typed arrays helper */
function growI32(a: Int32Array<ArrayBuffer>, n: number): Int32Array<ArrayBuffer> {
  if (a.length >= n) return a;
  const b = new Int32Array(Math.max(n, a.length * 2, 64));
  b.set(a);
  return b;
}
function growF32(a: Float32Array<ArrayBuffer>, n: number): Float32Array<ArrayBuffer> {
  if (a.length >= n) return a;
  const b = new Float32Array(Math.max(n, a.length * 2, 64));
  b.set(a);
  return b;
}
function growU8(a: Uint8Array<ArrayBuffer>, n: number): Uint8Array<ArrayBuffer> {
  if (a.length >= n) return a;
  const b = new Uint8Array(Math.max(n, a.length * 2, 64));
  b.set(a);
  return b;
}

export class TrafficSystem implements SimSystem {
  readonly name = 'traffic';

  // graphs
  readonly road = new RoadGraph();
  readonly rail = new GridGraph();
  readonly subway = new GridGraph();
  private graphDirty = true;
  private unsub: (() => void)[] = [];

  // scheduling
  private phase = -1;
  private rebuiltInCycle = false;
  private lastCycleStart = -1e9;
  private lastCycleMs0 = -1e9;
  /** cycles since graph rebuild (MSA) */
  private iter = 0;
  /** total completed assignments */
  cycles = 0;
  /** timings (ms) of the last completed cycle per phase */
  readonly phaseMs = new Float64Array(PHASES);
  lastCycleMs = 0;

  // searches
  private heap = new MinHeap(4096);
  private SA = new Search(); // commute (persists until next cycle)
  private ST = new Search(); // transit (persists)
  private SB = new Search(); // scratch (inbound / shop / freight)
  private seeds = new Seeds();
  private tnet: TransitNet | null = null;

  // per road node
  private nodeTime: Float32Array<ArrayBuffer> = new Float32Array(0);
  private volNew: Float32Array<ArrayBuffer> = new Float32Array(0);
  private acc: Float32Array<ArrayBuffer> = new Float32Array(0);
  private tAcc: Float32Array<ArrayBuffer> = new Float32Array(0);
  private railNew: Float32Array<ArrayBuffer> = new Float32Array(0);
  private subNew: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** subway riders per cell (not in state.traffic because subway can run under roads) */
  subwayRiders: Float32Array<ArrayBuffer> = new Float32Array(0);

  // snapshot: shared entry storage
  private ent: Int32Array<ArrayBuffer> = new Int32Array(4096);
  private entN = 0;
  // origins (residential)
  private oN = 0;
  private oBid: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oW: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oPop: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oWealth: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private oEntS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oEntC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private oCell: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oHalf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private oCarNode: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oBoard: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oShC: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oShT: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oShW: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oTime: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oEmp: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oJobT: Int32Array<ArrayBuffer> = new Int32Array(0);
  // job sites (buildings then connections)
  private jN = 0;
  private jB = 0; // number of building job sites (connections follow)
  private jBid: Int32Array<ArrayBuffer> = new Int32Array(0);
  private jSlots: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** small destination preference noise (minutes) of this cycle (tie breaking / route variety) */
  private jNoise: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** workers matched this cycle (all modes) */
  private jAsg: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** proportional-share capacity for the first matching rounds */
  private jCapP: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** shadow price (minutes) shaping catchments across cycles; round-0 proposals (excess demand signal) */
  private jPrice: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** job cluster of each job site (sites sharing their primary road entry node), -1 = unreachable */
  private jQ: Int32Array<ArrayBuffer> = new Int32Array(0);
  // job clusters: the matching works on clusters (co-located sites would otherwise shadow each other)
  private qN = 0;
  private qNode: Int32Array<ArrayBuffer> = new Int32Array(0);
  private qSlots: Float32Array<ArrayBuffer> = new Float32Array(0);
  private qCapP: Float32Array<ArrayBuffer> = new Float32Array(0);
  private qAsg: Float32Array<ArrayBuffer> = new Float32Array(0);
  private qPrice: Float32Array<ArrayBuffer> = new Float32Array(0);
  private qProp: Float32Array<ArrayBuffer> = new Float32Array(0);
  private qBase: Float32Array<ArrayBuffer> = new Float32Array(0);
  private qNoise: Float32Array<ArrayBuffer> = new Float32Array(0);
  private qTimeSum: Float32Array<ArrayBuffer> = new Float32Array(0);
  private nodeQ: Int32Array<ArrayBuffer> = new Int32Array(0);
  private priceById: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private connPrice: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jBase: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jEntS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private jEntC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private jCell: Int32Array<ArrayBuffer> = new Int32Array(0);
  private jHalf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private jTimeSum: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jInbound: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jRailNode: Int32Array<ArrayBuffer> = new Int32Array(0);
  // shops
  private sN = 0;
  private sBid: Int32Array<ArrayBuffer> = new Int32Array(0);
  private sEntS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private sEntC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private sLoad: Float32Array<ArrayBuffer> = new Float32Array(0);
  // freight sources
  private fN = 0;
  private fBid: Int32Array<ArrayBuffer> = new Int32Array(0);
  private fTrucks: Float32Array<ArrayBuffer> = new Float32Array(0);
  private fEntS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private fEntC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  // freight sinks (seeds kept as building entries)
  private kN = 0;
  private kEntS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private kEntC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private kLabel: Float32Array<ArrayBuffer> = new Float32Array(0);
  // connections
  private conns: NeighborConn[] = [];
  // stops
  private stops: StopList = { n: 0, bid: new Int32Array(64), mode: new Uint8Array(64), cell: new Int32Array(64) };
  private stAttS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private stAttC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private stAtt: Int32Array<ArrayBuffer> = new Int32Array(0);
  private stWait: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stLoad: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stLoadPrev = new Map<number, number>();
  private stopBins: Int32Array<ArrayBuffer> = new Int32Array(0);
  private stopBinStart: Int32Array<ArrayBuffer> = new Int32Array(0);
  private binN = 0;
  private nodeStop: Int32Array<ArrayBuffer> = new Int32Array(0);
  private nsIdx: Int32Array<ArrayBuffer> = new Int32Array(64);
  private nsDist: Float32Array<ArrayBuffer> = new Float32Array(64);
  private jConnType: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private growth = 1;
  private trStartA: Int32Array<ArrayBuffer> = new Int32Array(0);
  private busTimeA: Float32Array<ArrayBuffer> = new Float32Array(0);
  private regionWorkerCap = 0;

  // matching state (per origin)
  private oU: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oAsg: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oTimeSum: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oCarW: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oTrW: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oWalkW: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oTrT: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oBoardStop: Int32Array<ArrayBuffer> = new Int32Array(0);
  /** distance (pure minutes) to the nearest open job cluster in the last round the origin took part in */
  private oLastD: Float32Array<ArrayBuffer> = new Float32Array(0);
  private candKey: Float64Array<ArrayBuffer> = new Float64Array(0);
  private candNode: Int32Array<ArrayBuffer> = new Int32Array(0);
  private round = 0;
  private propFactor = 1;
  private roundAccepted = 0;
  /** shopping / freight volumes are recomputed every 2nd cycle; cached per road node in between */
  private volShop: Float32Array<ArrayBuffer> = new Float32Array(0);
  private volFreight: Float32Array<ArrayBuffer> = new Float32Array(0);
  private sfVersion = -1;
  private sfRecompute = true;
  private truckRoutes: SampleRoute[] = [];
  private patrolIds: number[] = [];
  private stationIds: number[] = [];
  private volInbound: Float32Array<ArrayBuffer> = new Float32Array(0);
  private inboundById: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private task: InfraTask | null = null;

  // ---- WP7b transport facilities ---------------------------------------------------------------------------------
  /** park & ride car legs: reverse road search from the P&R garages (kept across a cycle, reused every 2nd cycle) */
  private SP = new Search();
  private prKey = '';
  /** per road node: interchange minutes (non-highway nodes), ramp flow of this cycle, ramp flow of the cached
   *  inbound / shop / freight passes (added again on the cycles those are cached) */
  private rampT: Float32Array<ArrayBuffer> = new Float32Array(0);
  private rampNew: Float32Array<ArrayBuffer> = new Float32Array(0);
  private rampSF: Float32Array<ArrayBuffer> = new Float32Array(0);
  private truckTime: Float32Array<ArrayBuffer> = new Float32Array(0);
  private prAcc: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** per cell (robust across graph rebuilds): MSA-smoothed ramp flow (PCU / day), trucks / day, bus riders / day */
  private rampVolCell: Float32Array<ArrayBuffer> = new Float32Array(0);
  private truckCell: Float32Array<ArrayBuffer> = new Float32Array(0);
  private busCell: Float32Array<ArrayBuffer> = new Float32Array(0);
  private hasTruckData = false;
  // stops (parallel to this.stops): key (bid, or -1 - cell for road-flag stops), depot index (-1 minibus / none),
  // service ratio of the bus stop, attached flag (0 = does not serve)
  private stKey: Int32Array<ArrayBuffer> = new Int32Array(0);
  private stDepot: Int32Array<ArrayBuffer> = new Int32Array(0);
  private stRho: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stOk: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private stIdxById = new Map<number, number>();
  /** attachment (cell level, refreshed lazily on transport / network / subway / terrain changes) */
  private attach = new Map<number, number>();
  /** subway / train station id -> stations of its mode on its line(s), line reaches the map edge */
  private lineInfo = new Map<number, { stations: number; edge: boolean }>();
  private freightLink = new Map<number, number>();
  private attachDirty = true;
  private attachSubwayComp: Int32Array<ArrayBuffer> = new Int32Array(0);
  private attachRailComp: Int32Array<ArrayBuffer> = new Int32Array(0);
  /** bumped on road / tunnel / terrain edits: the tunnel / rail component rasters and the ferry links are recomputed
   *  only then (a transport building change re-reads the stops only) */
  private netVer = 0;
  private terrainVer = 0;
  /** transit buildings (stops, stations, terminals, seaports) by id: rebuilt by prep's building scan every cycle, kept
   *  current in between by the building events, so an attachment refresh does not walk every building */
  private transportB = new Map<number, Building>();
  private transportFor: CityState | null = null;
  private attachSubVer = -1;
  private attachRailVer = -1;
  /** freight rail: cells of the freight train routes of rail-linked freight stations, their paths (stations -> edge) */
  private freightRail: Int32Array<ArrayBuffer> = new Int32Array(0);
  private freightPaths = new Map<number, Uint32Array>();
  // ferries
  private ferryNet: FerryNet = { links: [], partners: new Map() };
  private ferryKey = '';
  private ferryTerms: FerryTerminal[] = [];
  private ferryNodeOf = new Map<number, number>();
  private ferryRidersBy = new Map<number, number>();
  private ferryRiders = 0;
  // depots / bus fleet
  private depots: { id: number; fleet: number; stops: number; riders: number; need: number; rho: number }[] = [];
  private depotOwner: Int32Array<ArrayBuffer> = new Int32Array(0);
  private depotKey = '';
  private depotVer = -1;
  /** smoothed needed buses per depot id (-1 = minibus pool) [persisted] */
  private busNeed = new Map<number, number>();
  private minibus = { stops: 0, riders: 0, need: 0, rho: BUS_RHO_MAX };
  // garages / park & ride (per garage index this cycle)
  private gN = 0;
  private gBid: Int32Array<ArrayBuffer> = new Int32Array(0);
  private gEntS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private gEntC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private gStop: Int32Array<ArrayBuffer> = new Int32Array(0);
  private gWalk: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gLabel: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gSeed: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gBoard: Int32Array<ArrayBuffer> = new Int32Array(0);
  /** 1 = the stop's best transit path rides a vehicle; 0 = its jobs are a walk away (the garage is plain parking) */
  private gRide: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** garage centre cell and walk reach (GARAGE_WALK_RADIUS + half footprint): park & walk serves jobs within it */
  private gCell: Int32Array<ArrayBuffer> = new Int32Array(0);
  private gReach: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private gLoad: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gPrN = 0;
  /** park & ride cars per garage id of the last assignment [persisted] */
  private garageLoad = new Map<number, number>();
  /** garage id -> its users ride transit (false: park & walk) in the last assignment (derived) */
  private garageRide = new Map<number, boolean>();
  // per origin: park & ride option (total minutes, garage index, car entry node, board node, stop), car-less share
  private oPrT: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oPrG: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oPrNode: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oCl: Float32Array<ArrayBuffer> = new Float32Array(0);
  private prRiders = 0;
  // parking: car commuters arriving per cluster / job site, car shopping trips per shop, parking at each cluster
  private qCar: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jCar: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jPark: Float32Array<ArrayBuffer> = new Float32Array(0);
  private qPark: Float32Array<ArrayBuffer> = new Float32Array(0);
  private sCar: Float32Array<ArrayBuffer> = new Float32Array(0);
  private parkD: Float32Array<ArrayBuffer> = new Float32Array(0);
  private parkS: Float32Array<ArrayBuffer> = new Float32Array(0);
  private parkTmpA: Float32Array<ArrayBuffer> = new Float32Array(0);
  private parkTmpB: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** last parking raster summary (demand-weighted pressure, share of demand cells above 0.6, supply / demand) */
  parkingSummary: ParkingSummary = { demandWeighted: 0, highShare: 0, supply: 0, demand: 0 };
  // freight sinks (seaports + rail-linked freight stations): trucks / day within FREIGHT_SINK_MIN, by building id
  private sinkIds: number[] = [];
  private sinkTrucksById: Float32Array<ArrayBuffer> = new Float32Array(1024).fill(-1);
  private sinksDone = false;
  private transitDone = false;
  private sinkK: number[] = [];
  private depotB: Building[] = [];
  private jObj: Building[] = [];
  private jNoDest: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private sObj: Building[] = [];
  private attachFor: CityState | null = null;
  private prKeyNow = '';
  private lastState: CityState | null = null;

  // persistent by building id  /** residential: share of workers reaching a job (0..1); -1 = unknown. Index = building id. */
  accessById: Float32Array<ArrayBuffer> = new Float32Array(1024).fill(-1);
  /** job sites: filled share of job slots by reachable workers (local + regional), 0..1; -1 unknown */
  jobFillById: Float32Array<ArrayBuffer> = new Float32Array(1024).fill(-1);
  /** industry: freight access 0..1; -1 unknown */
  freightById: Float32Array<ArrayBuffer> = new Float32Array(1024).fill(-1);
  /** commercial: customers/day */
  customersById: Float32Array<ArrayBuffer> = new Float32Array(1024);
  /** residential: commute minutes; job sites: average arriving commute */
  commuteById: Float32Array<ArrayBuffer> = new Float32Array(1024);
  /** job sites: commuters arriving by car per day (local + regional; WP7-7 parking demand) */
  carsById: Float32Array<ArrayBuffer> = new Float32Array(1024);
  /** workers reached (R) / workers arriving (jobs) */
  reachedById: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private modeById: Uint8Array<ArrayBuffer> = new Uint8Array(1024);

  // stats of the cycle
  private tripsCar = 0;
  private tripsTransit = 0;
  private tripsWalk = 0;
  private tripsInbound = 0;
  private tripsShop = 0;
  private tripsFreight = 0;
  private commuteSum = 0;
  private commuteW = 0;

  // sample routes
  private routes: SampleRoute[] = [];
  private pendingRoutes: SampleRoute[] = [];
  private serviceRoutes: { r: SampleRoute; until: number }[] = [];
  private rngState = 12345;

  // cycle-level flags
  private fx: OrdEffects | null = null;
  private jobsUnknown = false;

  // ------------------------------------------------------------------------------------------ SimSystem
  init(sim: Simulation): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    const ev = sim.events;
    // WP7b: stop attachment / freight rail links / ferry links depend on transport buildings, roads, tunnels, water
    const markT = (b: Building) => {
      if (getDef(b.def)?.category !== 'transport') return;
      this.attachDirty = true;
      this.transportB.set(b.id, b);
    };
    const dropT = (b: Building) => { if (this.transportB.delete(b.id) || getDef(b.def)?.category === 'transport') this.attachDirty = true; };
    this.unsub.push(
      ev.on('networkChanged', () => { this.graphDirty = true; this.attachDirty = true; this.netVer++; }),
      ev.on('subwayChanged', () => { this.graphDirty = true; this.attachDirty = true; this.netVer++; }),
      ev.on('terrainChanged', () => { this.graphDirty = true; this.attachDirty = true; this.netVer++; this.terrainVer++; }),
      ev.on('reset', () => { this.graphDirty = true; this.attachDirty = true; this.netVer++; this.terrainVer++; }),
      ev.on('buildingAdded', markT),
      ev.on('buildingRemoved', dropT),
      ev.on('buildingChanged', markT),
    );
    TRAFFIC_OF_STATE.set(sim.state, this);
    this.lastState = sim.state;
    this.attachDirty = true;
    this.attachSubVer = this.attachRailVer = -1;
    this.transportB.clear();
    this.transportFor = null;
    this.attach.clear();
    this.freightLink.clear();
    this.freightPaths.clear();
    this.freightRail = new Int32Array(0);
    this.ferryKey = '';
    this.ferryNet = { links: [], partners: new Map() };
    this.depotKey = '';
    this.depotVer = -1;
    this.prKey = '';
    this.SP.graphVersion = -1;
    this.sinkTrucksById.fill(-1);
    this.sinksDone = false;
    this.hasTruckData = false;
    this.restoreTransport(sim.state);
    sim.state.systemData.infraVersion = 1;
    this.graphDirty = true;
    this.phase = -1;
    this.iter = 0;
    this.cycles = 0;
    this.accessById.fill(-1);
    this.priceById.fill(0);
    this.connPrice = new Float32Array(sim.state.cells);
    this.jobFillById.fill(-1);
    this.freightById.fill(-1);
    this.serviceRoutes = [];
    this.routes = [];
    this.sfVersion = -1;
    this.truckRoutes = [];
    this.rngState = (sim.state.config.seed ^ 0x51ed27) >>> 0 || 1;
    // steps are executed by the shared infra scheduler
    const self = this;
    this.task = {
      name: 'traffic',
      due: () => self.phase >= 0,
      urgent: () => false,
      cost: (s) => self.stepCost(s),
      step: (s) => self.step(s),
    };
    schedulerOf(sim).register(this.task);
    // warm start so layers exist right after load / new city
    if (sim.state.buildings.size > 0 || sim.state.network.some((v) => v !== 0)) this.runCycleSync(sim);
  }

  /** estimated cost (ms) of the next step */
  stepCost(sim: Simulation): number {
    const ph = this.phase < 0 ? PH_PREP : this.phase;
    const road = Math.max(0.05, this.road.n / 36000);
    const bld = Math.max(0.05, (this.oN + this.jN) / 20000);
    const base = PHASE_COST[ph];
    const size = sim.state.size;
    // (+ the WP7b attachment refresh after an edit: tunnel / rail components, ferry water paths)
    const attach = this.attachDirty ? 0.3 * (size * size / 65536) : 0;
    if (ph === PH_PREP && (this.graphDirty || this.road.N !== size)) return REBUILD_COST * (size * size / 65536) + attach;
    if (ph === PH_TRANSIT && this.stops.n === 0) return 0.1;
    // matching rounds / per-origin outputs: a fixed part (candidate lists, sorting) + a size-dependent part
    if (ph === PH_RSEARCH) return 0.6 + 0.6 * (0.8 * road + 0.2 * bld);
    if (ph === PH_RMATCH) return 0.7 + 0.5 * (0.3 * road + 0.7 * bld);
    // WP7b: + persisted state (parking u8 on the cycles that recompute it) / P&R car legs on the P&R forest
    if (ph === PH_FINAL2) return 1.0 + 0.6 * (0.3 * road + 0.7 * bld) + (this.sfRecompute ? 0.25 * (size * size / 65536) : 0);
    if (ph === PH_COMMUTE) return base * (0.3 * road + 0.7 * bld) + (this.gPrN > 0 ? 0.2 * road : 0);
    // WP7b prep extras: car-less shares, parking over job footprints, sink / garage / depot lists
    if (ph === PH_PREP) return base * (0.3 * road + 0.7 * bld) + 0.3 * bld + attach;
    if (ph === PH_TRANSIT2) return base * (0.3 * road + 0.7 * bld);
    if ((ph === PH_SHOP || ph === PH_FREIGHT || ph === PH_INBOUND) && !this.sfRecompute) return 0.15;
    // freight: + truck times and trucks per cell (WP7-10)
    if (ph === PH_FREIGHT) return base * (0.8 * road + 0.2 * bld) + 0.15 * road + 0.05 * (size * size / 65536);
    // WP7b: depot BFS on change; P&R search every 2nd cycle (options only in between); parking raster O(cells)
    if (ph === PH_PREP2) return base * (0.3 * road + 0.7 * bld);
    if (ph === PH_PARKRIDE) return this.prSearchDue() ? base * (0.8 * road + 0.2 * bld) : 0.1 + 0.3 * bld;
    if (ph === PH_PARKING) return 0.3 * bld + base * (size * size / 65536);
    return base * (0.8 * road + 0.2 * bld);
  }

  /** start a new cycle every TRAFFIC_CYCLE_DAYS sim days (with a live renderer at most every TRAFFIC_MIN_CYCLE_MS) */
  private maybeStart(sim: Simulation): void {
    if (this.phase >= 0) return;
    const st = sim.state;
    if (st.day - this.lastCycleStart < TRAFFIC_CYCLE_DAYS) return;
    const now = nowMs();
    if (schedulerOf(sim).framesActive && now - this.lastCycleMs0 < TRAFFIC_MIN_CYCLE_MS) return;
    this.phase = PH_PREP;
    this.lastCycleStart = st.day;
    this.lastCycleMs0 = now;
  }

  daily(sim: Simulation): void {
    this.maybeStart(sim);
    schedulerOf(sim).tickDay(sim);
  }

  frame(sim: Simulation, _dt: number): void {
    this.maybeStart(sim);
    schedulerOf(sim).tickFrame(sim, this);
  }

  /** run one full assignment synchronously (tests / load) */
  runCycleSync(sim: Simulation): void {
    if (this.phase < 0) {
      this.phase = PH_PREP;
      this.lastCycleStart = sim.state.day;
    }
    while (this.phase >= 0) this.step(sim);
  }

  /** request a new assignment as soon as possible */
  invalidate(): void {
    this.lastCycleStart = -1e9;
  }

  // ------------------------------------------------------------------------------------------ public queries
  getSampleRoutes(max: number): SampleRoute[] {
    const out = this.routes.length <= max ? this.routes.slice() : this.routes.slice(0, max);
    for (const s of this.serviceRoutes) {
      if (out.length >= max + 8) break;
      out.push(s.r);
    }
    return out;
  }

  routeInfo(buildingId: number): RouteInfo | null {
    if (buildingId < 0 || buildingId >= this.modeById.length) return null;
    const m = this.modeById[buildingId];
    if (m === 0 && this.reachedById[buildingId] === 0 && this.commuteById[buildingId] === 0) return null;
    return { commuteMin: this.commuteById[buildingId], mode: MODE_NAMES[m] ?? 'none', jobsReached: Math.round(this.reachedById[buildingId]) };
  }
  /** residential: 0..1 share of workers that can reach a job (-1 = not assessed yet) */
  workerAccess(id: number): number {
    return id >= 0 && id < this.accessById.length ? this.accessById[id] : -1;
  }
  /** job site: 0..1 share of job slots reachable workers fill (-1 = not assessed yet) */
  jobFill(id: number): number {
    return id >= 0 && id < this.jobFillById.length ? this.jobFillById[id] : -1;
  }
  /** industry: 0..1 freight access (-1 = not assessed) */
  freightAccess(id: number): number {
    return id >= 0 && id < this.freightById.length ? this.freightById[id] : -1;
  }
  /** commercial: shopping trips/day arriving */
  customers(id: number): number {
    return id >= 0 && id < this.customersById.length ? this.customersById[id] : 0;
  }
  commuteOf(id: number): number {
    return id >= 0 && id < this.commuteById.length ? this.commuteById[id] : 0;
  }
  /** job site: commuters arriving by car per day (last assignment; parking demand) */
  carsArriving(id: number): number {
    return id >= 0 && id < this.carsById.length ? this.carsById[id] : 0;
  }
  /**
   * congested travel minutes per road node of the current assignment (read-only view, indexed like this.road nodes;
   * valid for searches while graphVersion is unchanged). For other systems' roadSearch (emergency dispatch, WP8).
   */
  get nodeTimes(): Float32Array {
    return this.nodeTime.subarray(0, Math.min(this.nodeTime.length, this.road.n));
  }
  /** road graph version (incremented on every rebuild) — node ids / nodeTimes are only valid for one version */
  get graphVersion(): number {
    return this.road.version;
  }
  /** regional (neighbour-city) workers filling city jobs in the last assignment (WP1-1 employment ledger) */
  get inboundTotal(): number {
    return this.tripsInbound;
  }

  // ------------------------------------------------------------------------------------------ WP7b queries
  /**
   * stop building (bus stop, subway / train station, ferry terminal): does it serve? A bus stop next to a road; a subway
   * / train station on a line with another station of its mode (train: or rail to the map edge); a ferry terminal
   * linked to a partner. Non-stop ids: false. Always current (refreshed lazily after transport / road / tunnel / water
   * changes, independent of the assignment cycle).
   */
  stopAttached(id: number): boolean {
    const st = this.lastState;
    if (st) this.refreshAttach(st);
    return (this.attach.get(id) ?? 0) === 1;
  }
  /** riders (boardings + alightings / day, last assignment), current wait (min) and the depot (building id, -1 = none /
   *  minibuses) of a stop building; null = not a stop (or not seen by an assignment yet) */
  stopLoad(id: number): { riders: number; waitMin: number; depotId: number } | null {
    const s = this.stIdxById.get(id);
    if (s === undefined || s >= this.stops.n || this.stops.bid[s] !== id) return null;
    const d = this.stDepot[s];
    return { riders: this.stLoadPrev.get(id) ?? 0, waitMin: this.stWait[s], depotId: d >= 0 && d < this.depots.length ? this.depots[d].id : -1 };
  }
  /** cell indices on the freight train routes (rail-linked freight stations -> map edge / seaport) */
  freightRailCells(): ArrayLike<number> {
    const st = this.lastState;
    if (st) this.refreshAttach(st);
    return this.freightRail;
  }
  /** subway / train station: stations of its mode on its line (incl. itself), line reaches the map edge; null = none */
  stationLine(id: number): { stations: number; edge: boolean } | null {
    const st = this.lastState;
    if (st) this.refreshAttach(st);
    return this.lineInfo.get(id) ?? null;
  }
  /** freight station: rail reaches a rail neighbour connection or a seaport (-> counts as a freight sink) */
  freightLinked(id: number): boolean {
    const st = this.lastState;
    if (st) this.refreshAttach(st);
    return (this.freightLink.get(id) ?? 0) === 1;
  }
  /** trucks / day of industry within FREIGHT_SINK_MIN of a seaport / rail-linked freight station; -1 = unknown */
  sinkTrucks(id: number): number {
    return id >= 0 && id < this.sinkTrucksById.length ? this.sinkTrucksById[id] : -1;
  }
  /** trucks / day per road cell of the last freight pass (null before the first) */
  truckVolume(): Float32Array | null {
    return this.hasTruckData ? this.truckCell : null;
  }
  /** interchange load (ramp flow / RAMP_CAP) of a non-highway road cell next to a highway; -1 = not a ramp cell */
  rampLoad(cell: number): number {
    const st = this.lastState;
    if (!st || cell < 0 || cell >= st.cells) return -1;
    const net = st.network, N = st.size;
    const t = net[cell];
    if (!(t >= Network.Street && t < Network.Highway)) return -1;
    const x = cell % N, z = (cell - x) / N;
    let hw = false;
    if (x > 0 && net[cell - 1] === Network.Highway) hw = true;
    if (x < N - 1 && net[cell + 1] === Network.Highway) hw = true;
    if (z > 0 && net[cell - N] === Network.Highway) hw = true;
    if (z < N - 1 && net[cell + N] === Network.Highway) hw = true;
    if (!hw || t === Network.Street) return -1;
    return (this.rampVolCell[cell] ?? 0) / RAMP_CAP;
  }
  /** interchange minutes (ramp class x congestion) of a ramp cell (see rampLoad) */
  rampMinutes(cell: number): number {
    const st = this.lastState;
    if (!st) return RAMP_PENALTY;
    return rampTime(st.network[cell], this.rampVolCell[cell] ?? 0);
  }
  /** bus riders / day on a road cell (last assignment) */
  cellBusRiders(cell: number): number {
    return cell >= 0 && cell < this.busCell.length ? this.busCell[cell] : 0;
  }
  /** depot: buses (fleet), buses needed by its stops, stops served, riders / day; null = not a depot */
  depotInfo(id: number): { fleet: number; need: number; stops: number; riders: number; rho: number } | null {
    const d = this.depots.find((x) => x.id === id);
    return d ? { fleet: d.fleet, need: d.need, stops: d.stops, riders: d.riders, rho: d.rho } : null;
  }
  /** stops without a depot in range: minibus pool (MINIBUS_FLEET) */
  get minibusInfo(): { stops: number; riders: number; need: number; rho: number } {
    return { ...this.minibus };
  }
  /**
   * parking garage: park & ride stop (building id, -1 none), cars / day parked by commuters in the last assignment,
   * spaces, walk to the stop; ride = false when its stop's jobs are a walk away (users park and walk: no riders)
   */
  garageInfo(id: number): { stopId: number; parkRide: number; spaces: number; walkMin: number; ride: boolean } | null {
    for (let g = 0; g < this.gN; g++) {
      if (this.gBid[g] !== id) continue;
      const s = this.gStop[g];
      return {
        stopId: s >= 0 ? this.stops.bid[s] : -1, parkRide: this.garageLoad.get(id) ?? 0,
        spaces: GARAGE_DEFS[this.lastState?.buildings.get(id)?.def ?? ''] ?? GARAGE_SPACES, walkMin: this.gWalk[g],
        ride: this.garageRide.get(id) ?? true,
      };
    }
    return null;
  }
  /** ferry links (a, b terminal ids, water path a -> b, crossing minutes) — for the renderer (ferry boats) / inspector */
  ferryLinks(): readonly FerryLink[] {
    const st = this.lastState;
    if (st) this.refreshAttach(st);
    return this.ferryNet.links;
  }
  /** partner terminals (id, minutes) of a ferry terminal */
  ferryPartners(id: number): readonly FerryPartner[] {
    const st = this.lastState;
    if (st) this.refreshAttach(st);
    return this.ferryNet.partners.get(id) ?? [];
  }
  /** riders / day through a ferry terminal (boarding or leaving a boat there) */
  ferryRidersAt(id: number): number {
    return this.ferryRidersBy.get(id) ?? 0;
  }
  /** plop preview: partners a ferry terminal at (x, z, w, d, rot) would link to */
  ferryPartnersFor(st: CityState, x: number, z: number, w: number, d: number, rot: number): FerryPartner[] {
    this.refreshAttach(st);
    return ferryPartnersAt(st, this.ferryTerms, x, z, w, d, rot);
  }
  /** attached stops within r cells (+ half the footprint) of a footprint (garage preview), nearest first */
  stopsNear(st: CityState, x: number, z: number, w: number, d: number, r = PR_STOP_RADIUS): { id: number; mode: number; dist: number }[] {
    this.refreshAttach(st);
    const cx = x + (w >> 1), cz = z + (d >> 1), R = r + (Math.max(w, d) >> 1);
    const out: { id: number; mode: number; dist: number }[] = [];
    // stops of the last assignment (a stop placed since shows after the next one; previews run on every mouse move)
    const S = this.stops, N = st.size;
    for (let s = 0; s < S.n; s++) {
      const id = S.bid[s];
      if (id < 0 || this.attach.get(id) !== 1 || !st.buildings.has(id)) continue;
      const c = S.cell[s], sx = c % N, sz = (c - sx) / N;
      const dd = Math.hypot(sx - cx, sz - cz);
      if (dd <= R) out.push({ id, mode: S.mode[s], dist: dd });
    }
    return out.sort((a, b) => a.dist - b.dist || a.id - b.id);
  }
  /** fleet / park & ride / ferry totals of the last assignment (also in stats.transitFleet) */
  get fleetStats(): { buses: number; busesNeeded: number; parkRide: number; parkRideSpaces: number; ferryRiders: number; ferryLinks: number } {
    const st = this.lastState;
    return st ? { ...st.stats.transitFleet } : { buses: 0, busesNeeded: 0, parkRide: 0, parkRideSpaces: 0, ferryRiders: 0, ferryLinks: 0 };
  }

  /** a transient service-vehicle route (fire trucks etc.) shown for `days` sim days */
  pushServiceRoute(sim: Simulation, cells: Uint32Array, weight = 1, days = 2): void {
    this.serviceRoutes.push({ r: { cells, kind: 'service', weight }, until: sim.state.day + days });
    if (this.serviceRoutes.length > 32) this.serviceRoutes.shift();
  }

  /** shortest road path (BFS over allowed moves) between two cells next to / on roads; null if none */
  findPath(sim: Simulation, fromCell: number, toCell: number, maxNodes = 20000): Uint32Array | null {
    const st = sim.state;
    // never rebuild mid-cycle (searches hold node ids of the current graph)
    if ((this.graphDirty && this.phase < 0) || this.road.N !== st.size) this.rebuildGraphs(st);
    const g = this.road;
    const a = this.nearestRoadNode(st, fromCell), b = this.nearestRoadNode(st, toCell);
    if (a < 0 || b < 0) return null;
    if (g.comp[a] !== g.comp[b]) return null;
    const n = g.n;
    const S = this.SB;
    S.ensure(n);
    const parent = S.next, done = S.done, q = S.order;
    done.fill(0, 0, n);
    let qh = 0, qt = 0;
    q[qt++] = a;
    done[a] = 1;
    parent[a] = -1;
    let found = a === b;
    while (qh < qt && !found && qt < maxNodes) {
      const u = q[qh++];
      for (let k = 0; k < 4; k++) {
        const v = g.fwd[u * 4 + k];
        if (v < 0 || done[v]) continue;
        done[v] = 1;
        parent[v] = u;
        if (v === b) { found = true; break; }
        q[qt++] = v;
      }
    }
    S.settled = 0; // scratch invalidated
    if (!found) return null;
    const path: number[] = [];
    for (let v = b; v >= 0; v = parent[v]) path.push(g.cellOf[v]);
    path.reverse();
    return Uint32Array.from(path);
  }

  private nearestRoadNode(st: CityState, cell: number): number {
    const g = this.road;
    if (cell < 0 || cell >= st.cells) return -1;
    const nd = g.nodeOfCell[cell];
    if (nd >= 0) return nd;
    const b = st.building[cell] >= 0 ? st.buildings.get(st.building[cell]) : undefined;
    if (b) {
      const tmp = new Int32Array(4);
      if (perimeterNodes(g.nodeOfCell, st.size, b, tmp, 0, 4) > 0) return tmp[0];
    }
    const N = st.size, x = cell % N, z = (cell - x) / N;
    for (let r = 1; r <= 3; r++)
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const m = g.nodeOfCell[nz * N + nx];
        if (m >= 0) return m;
      }
    return -1;
  }

  // ------------------------------------------------------------------------------------------ scheduling
  /** run one step of the current cycle (no-op when idle) */
  step(sim: Simulation): void {
    const ph = this.phase;
    if (ph < 0) return;
    const t0 = nowMs();
    if (ph === PH_PREP && !this.rebuiltInCycle) this.phaseMs.fill(0);
    let next = NEXT_PHASE[ph];
    switch (ph) {
      case PH_PREP:
        // a graph rebuild is its own step (the prep snapshot follows in the next step)
        if (this.graphDirty || this.road.N !== sim.state.size) {
          this.rebuildGraphs(sim.state);
          this.rebuiltInCycle = true;
          next = PH_PREP;
        } else {
          this.rebuiltInCycle = false;
          this.prep(sim);
        }
        break;
      case PH_PREP2: this.prepTransit(sim.state); break;
      case PH_TRANSIT: this.transit(); break;
      case PH_TRANSIT2: this.originTransit(); break;
      case PH_PARKRIDE: this.parkRide(); break;
      case PH_RSEARCH: this.roundSearch(); break;
      case PH_RMATCH: next = this.roundMatch(); break;
      case PH_COMMUTE: this.commuteEnd(); break;
      case PH_INBOUND: this.inbound(); break;
      case PH_SHOP: this.shopping(); break;
      case PH_FREIGHT: this.freight(); break;
      case PH_SINKS: this.freightSinks(); break;
      case PH_PARKING: this.parkingRaster(sim); break;
      case PH_FINAL: this.finalize(sim); break;
      case PH_FINAL2: this.finalize2(sim); break;
    }
    this.phaseMs[ph] += nowMs() - t0;
    // WP7b phases without work this cycle are skipped (no empty scheduler steps)
    while (next >= 0 && this.skipPhase(next)) next = NEXT_PHASE[next];
    this.phase = next;
    if (this.phase < 0) {
      let s = 0;
      for (let i = 0; i < PHASES; i++) s += this.phaseMs[i];
      this.lastCycleMs = s;
    }
  }

  /** WP7b phases with nothing to do this cycle */
  private skipPhase(ph: number): boolean {
    switch (ph) {
      case PH_TRANSIT2: return this.transitDone;
      case PH_PARKRIDE: return this.gPrN === 0;
      case PH_SINKS: return !this.sfRecompute || this.sinkIds.length === 0;
      case PH_PARKING: return !this.sfRecompute;
      default: return false;
    }
  }

  /** P&R: a fresh search this cycle (every 2nd cycle, or when the forest does not match the graph / garages) */
  private prSearchDue(): boolean {
    return this.SP.graphVersion !== this.road.version || this.prKey !== this.prKeyNow || this.cycles % 2 === 1;
  }

  private rand(): number {
    let t = (this.rngState = (this.rngState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private rebuildGraphs(st: CityState): void {
    this.road.build(st);
    const net = st.network, flags = st.netFlags;
    // level crossings keep their road type with netFlags bit 5 set; the rail passes through them
    this.rail.build(st.size, (i) => net[i] === Network.Rail || (flags[i] & NETFLAG_CROSSING) !== 0);
    const sub = st.subway;
    this.subway.build(st.size, (i) => sub[i] !== 0);
    this.graphDirty = false;
    this.iter = 0;
  }

  private addEntries(nodeOfCell: Int32Array, N: number, b: Building): number {
    if (this.entN + MAX_ENTRIES > this.ent.length) this.ent = growI32(this.ent, (this.entN + MAX_ENTRIES) * 2);
    const c = perimeterNodes(nodeOfCell, N, b, this.ent, this.entN, MAX_ENTRIES);
    this.entN += c;
    return c;
  }

  // ------------------------------------------------------------------------------------------ PREP
  private prep(sim: Simulation): void {
    const st = sim.state;
    if (this.graphDirty || this.road.N !== st.size) this.rebuildGraphs(st);
    const g = this.road;
    const N = st.size;
    this.lastState = st;
    this.refreshAttach(st);
    this.fx = readEffects(st);
    this.jobsUnknown = detectJobsUnknown(st);
    // per-id arrays
    this.priceById = ensureIdFloat(this.priceById, st);
    if (this.connPrice.length !== st.cells) this.connPrice = new Float32Array(st.cells);
    this.accessById = ensureIdFloat(this.accessById, st, -1);
    this.jobFillById = ensureIdFloat(this.jobFillById, st, -1);
    this.freightById = ensureIdFloat(this.freightById, st, -1);
    this.customersById = ensureIdFloat(this.customersById, st);
    this.commuteById = ensureIdFloat(this.commuteById, st);
    this.carsById = ensureIdFloat(this.carsById, st);
    this.reachedById = ensureIdFloat(this.reachedById, st);
    this.inboundById = ensureIdFloat(this.inboundById, st);
    this.modeById = growU8(this.modeById, st.nextBuildingId + 1);
    this.sinkTrucksById = ensureIdFloat(this.sinkTrucksById, st, -1);

    // node times from smoothed volumes (state.traffic per cell)
    const n = g.n;
    this.nodeTime = growF32(this.nodeTime, n);
    this.volNew = growF32(this.volNew, n);
    this.acc = growF32(this.acc, n);
    const traffic = st.traffic;
    for (let v = 0; v < n; v++) {
      const r = traffic[g.cellOf[v]] / g.cap[v];
      let f = 1 + BPR_ALPHA * r * r * r * r;
      if (f > BPR_MAX_FACTOR) f = BPR_MAX_FACTOR;
      this.nodeTime[v] = g.t0[v] * f;
    }
    this.volNew.fill(0, 0, n);
    // WP7-10 interchanges: ramp minutes of every non-highway node from the smoothed ramp flow of its cell
    if (this.rampVolCell.length !== st.cells) this.rampVolCell = new Float32Array(st.cells);
    this.rampT = growF32(this.rampT, n);
    this.rampNew = growF32(this.rampNew, n);
    this.rampNew.fill(0, 0, n);
    this.prAcc = growF32(this.prAcc, n);
    this.prAcc.fill(0, 0, n);
    {
      const type = g.type, rv = this.rampVolCell, cellOf = g.cellOf, rt = this.rampT;
      for (let v = 0; v < n; v++) rt[v] = type[v] === Network.Highway ? RAMP_PENALTY : rampTime(type[v], rv[cellOf[v]]);
    }
    this.railNew = growF32(this.railNew, this.rail.n);
    this.railNew.fill(0, 0, this.rail.n);
    this.subNew = growF32(this.subNew, this.subway.n);
    this.subNew.fill(0, 0, this.subway.n);

    // snapshot buildings
    this.entN = 0;
    let oN = 0, jN = 0, sN = 0, fN = 0, kN = 0;
    const cap = st.buildings.size + 16;
    this.oBid = growI32(this.oBid, cap); this.oW = growF32(this.oW, cap); this.oPop = growF32(this.oPop, cap);
    this.oWealth = growU8(this.oWealth, cap); this.oEntS = growI32(this.oEntS, cap); this.oEntC = growU8(this.oEntC, cap);
    this.oCell = growI32(this.oCell, cap); this.oHalf = growU8(this.oHalf, cap);
    const conns = (this.conns = findNeighborConnections(st));
    const jcap = cap + conns.length;
    this.jBid = growI32(this.jBid, jcap); this.jSlots = growF32(this.jSlots, jcap);
    this.jNoise = growF32(this.jNoise, jcap); this.jAsg = growF32(this.jAsg, jcap); this.jCapP = growF32(this.jCapP, jcap);
    this.jPrice = growF32(this.jPrice, jcap); this.jQ = growI32(this.jQ, jcap);
    this.jBase = growF32(this.jBase, jcap); this.jEntS = growI32(this.jEntS, jcap); this.jEntC = growU8(this.jEntC, jcap);
    this.jCell = growI32(this.jCell, jcap); this.jHalf = growU8(this.jHalf, jcap); this.jRailNode = growI32(this.jRailNode, jcap);
    this.jConnType = growU8(this.jConnType, jcap);
    this.sBid = growI32(this.sBid, cap); this.sEntS = growI32(this.sEntS, cap); this.sEntC = growU8(this.sEntC, cap);
    this.fBid = growI32(this.fBid, cap); this.fTrucks = growF32(this.fTrucks, cap); this.fEntS = growI32(this.fEntS, cap);
    this.fEntC = growU8(this.fEntC, cap);
    this.kEntS = growI32(this.kEntS, cap + conns.length); this.kEntC = growU8(this.kEntC, cap + conns.length);
    this.kLabel = growF32(this.kLabel, cap + conns.length);
    this.oCl = growF32(this.oCl, cap); this.jPark = growF32(this.jPark, jcap); this.jCar = growF32(this.jCar, jcap);
    this.jNoDest = growU8(this.jNoDest, jcap);
    this.sCar = growF32(this.sCar, cap);
    this.gBid = growI32(this.gBid, 16); this.gEntS = growI32(this.gEntS, 16); this.gEntC = growU8(this.gEntC, 16);
    const nodeOfCell = g.nodeOfCell;
    const jobsUnknown = this.jobsUnknown;
    this.patrolIds.length = 0;
    this.stationIds.length = 0;
    this.sinkIds.length = 0;
    this.sinkK.length = 0;
    this.depotB.length = 0;
    this.transportB.clear();
    this.transportFor = st;
    let gN = 0;
    for (let bI = 0, bL = buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const inf = infoOf(st, b);
      if (inf.transit !== Transit.None) this.transportB.set(b.id, b);
      if (inf.fam === Fam.Plop && isFunctional(b)) {
        if (inf.cov === 0 || inf.cov === 2 || inf.garbageCap > 0) this.patrolIds.push(b.id);
        if (inf.transit === Transit.Freight || inf.transit === Transit.Train) this.stationIds.push(b.id);
      }
      if (inf.fam === Fam.R) {
        if (b.pop <= 0 || (b.flags & BF.Burnt) !== 0) continue;
        this.oBid[oN] = b.id;
        this.oPop[oN] = b.pop;
        this.oW[oN] = b.pop * workerShare(b); // WP1: per-building workforce share (b.wf, else WORKER_SHARE)
        this.oCl[oN] = carlessShare(b); // WP1-4 / WP7-8: car-less residents pay CARLESS_EXTRA_MIN by car
        this.oWealth[oN] = wealthOf(inf, b);
        this.oCell[oN] = centerCell(st, b);
        this.oHalf[oN] = Math.max(b.w, b.d) >> 1;
        this.oEntS[oN] = this.entN;
        this.oEntC[oN] = this.addEntries(nodeOfCell, N, b);
        oN++;
        continue;
      }
      const slots = jobSlots(inf, b);
      if (slots > 0) {
        this.jBid[jN] = b.id;
        this.jSlots[jN] = slots;
        this.jBase[jN] = 0;
        this.jCell[jN] = centerCell(st, b);
        this.jHalf[jN] = Math.max(b.w, b.d) >> 1;
        this.jRailNode[jN] = -1;
        this.jEntS[jN] = this.entN;
        this.jEntC[jN] = this.addEntries(nodeOfCell, N, b);
        this.jPark[jN] = parkingOver(st, b);
        this.jObj[jN] = b;
        this.jNoDest[jN] = isStopMode(inf.transit) || DEPOT_DEFS[b.def] !== undefined || GARAGE_DEFS[b.def] !== undefined ? 1 : 0;
        jN++;
      }
      if (inf.fam === Fam.C && inf.dev >= 3 && inf.dev <= 5 && isFunctional(b)) {
        this.sBid[sN] = b.id;
        this.sObj[sN] = b;
        this.sEntS[sN] = this.entN;
        this.sEntC[sN] = this.addEntries(nodeOfCell, N, b);
        sN++;
      }
      if (inf.fam === Fam.I && isFunctional(b)) {
        const k = IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))];
        const trucks = activeJobs(inf, b, jobsUnknown) * FREIGHT_PER_JOB[k];
        if (trucks > 0) {
          this.fBid[fN] = b.id;
          this.fTrucks[fN] = trucks;
          this.fEntS[fN] = this.entN;
          this.fEntC[fN] = this.addEntries(nodeOfCell, N, b);
          fN++;
        }
      }
      // freight sinks: seaports, airports and freight stations whose rail reaches the region (critic item 18)
      if ((inf.transit === Transit.Seaport || inf.transit === Transit.Airport || (inf.transit === Transit.Freight && this.freightLink.get(b.id) === 1))
        && isFunctional(b)) {
        this.kEntS[kN] = this.entN;
        this.kEntC[kN] = this.addEntries(nodeOfCell, N, b);
        this.kLabel[kN] = 1;
        if (inf.transit !== Transit.Airport) { this.sinkIds.push(b.id); this.sinkK.push(kN); }
        kN++;
      }
      if (DEPOT_DEFS[b.def] !== undefined && isFunctional(b)) this.depotB.push(b);
      // parking garages (WP7-7 / WP7-8)
      if (GARAGE_DEFS[b.def] !== undefined && isFunctional(b)) {
        if (gN >= this.gBid.length) { this.gBid = growI32(this.gBid, gN * 2); this.gEntS = growI32(this.gEntS, gN * 2); this.gEntC = growU8(this.gEntC, gN * 2); }
        this.gBid[gN] = b.id;
        this.gEntS[gN] = this.entN;
        this.gEntC[gN] = this.addEntries(nodeOfCell, N, b);
        gN++;
      }
    }
    this.gN = gN;
    this.jB = jN;
    this.jObj.length = jN;
    this.sObj.length = sN;
    // neighbour connections: regional job sources + freight sinks
    const growth = (this.growth = 1 + Math.min(3, st.stats.population / 250000));
    for (const c of conns) {
      if (this.entN + 1 > this.ent.length) this.ent = growI32(this.ent, this.entN * 2 + 16);
      if (c.type === Network.Rail) {
        const rn = this.rail.nodeOfCell[c.cell];
        if (rn < 0) continue;
        this.jBid[jN] = -1;
        this.jSlots[jN] = CONNECTION_JOBS[c.type] * growth;
        this.jBase[jN] = REGIONAL_TIME;
        this.jCell[jN] = c.cell;
        this.jHalf[jN] = 0;
        this.jRailNode[jN] = rn;
        this.jConnType[jN] = c.type;
        this.jEntS[jN] = this.entN;
        this.jEntC[jN] = 0;
        jN++;
        continue;
      }
      const nd = nodeOfCell[c.cell];
      if (nd < 0) continue;
      this.ent[this.entN] = nd;
      this.jBid[jN] = -1;
      this.jSlots[jN] = CONNECTION_JOBS[c.type] * growth;
      this.jBase[jN] = REGIONAL_TIME;
      this.jCell[jN] = c.cell;
      this.jHalf[jN] = 0;
      this.jRailNode[jN] = -1;
      this.jConnType[jN] = c.type;
      this.jEntS[jN] = this.entN;
      this.jEntC[jN] = 1;
      jN++;
      this.kEntS[kN] = this.entN;
      this.kEntC[kN] = 1;
      this.kLabel[kN] = 3;
      kN++;
      this.entN++;
    }
    this.oN = oN; this.jN = jN; this.sN = sN; this.fN = fN; this.kN = kN;
    // global regional caps (scale connection slots)
    let workers = 0, citySlots = 0, connSlots = 0;
    for (let o = 0; o < oN; o++) workers += this.oW[o];
    for (let j = 0; j < this.jB; j++) citySlots += this.jSlots[j];
    for (let j = this.jB; j < jN; j++) { connSlots += this.jSlots[j]; this.jPark[j] = 0; }
    // regional exchange sized like sim-core's employment model (params REGION_* = economy/tuning REGION_COMMUTERS_*),
    // so workerAccess / jobFill agree with stats.unemployment; state.systemData.regionJobs / regionWorkers override
    const sd = st.systemData;
    const regionJobs = typeof sd.regionJobs === 'number' ? (sd.regionJobs as number) : (REGION_JOB_SHARE * workers + REGION_JOB_MIN) * REGION_JOBS_FOR_RESIDENTS;
    if (connSlots > regionJobs && connSlots > 0) {
      const f = regionJobs / connSlots;
      for (let j = this.jB; j < jN; j++) this.jSlots[j] *= f;
    }
    this.regionWorkerCap = typeof sd.regionWorkers === 'number' ? (sd.regionWorkers as number) : REGION_WORKER_SHARE * citySlots + REGION_WORKER_MIN;
    // per-cycle result arrays
    this.oCarNode = growI32(this.oCarNode, oN); this.oBoard = growI32(this.oBoard, oN);
    this.oShC = growF32(this.oShC, oN); this.oShT = growF32(this.oShT, oN); this.oShW = growF32(this.oShW, oN);
    this.oTime = growF32(this.oTime, oN); this.oEmp = growF32(this.oEmp, oN);
    this.oJobT = growI32(this.oJobT, oN);
    this.oU = growF32(this.oU, oN); this.oAsg = growF32(this.oAsg, oN); this.oTimeSum = growF32(this.oTimeSum, oN);
    this.oCarW = growF32(this.oCarW, oN); this.oTrW = growF32(this.oTrW, oN); this.oWalkW = growF32(this.oWalkW, oN);
    this.oTrT = growF32(this.oTrT, oN); this.oBoardStop = growI32(this.oBoardStop, oN);
    this.oLastD = growF32(this.oLastD, oN);
    this.oPrT = growF32(this.oPrT, oN); this.oPrG = growI32(this.oPrG, oN); this.oPrNode = growI32(this.oPrNode, oN);
    this.candKey = this.candKey.length >= oN ? this.candKey : new Float64Array(Math.max(oN, 64) * 2);
    this.candNode = growI32(this.candNode, oN);
    for (let o = 0; o < oN; o++) {
      this.oU[o] = this.oW[o];
      this.oAsg[o] = 0; this.oTimeSum[o] = 0; this.oCarW[o] = 0; this.oTrW[o] = 0; this.oWalkW[o] = 0;
      this.oCarNode[o] = -1;
      this.oLastD[o] = -1;
    }
    // destination noise, matching capacities (proportional share first when jobs are in surplus)
    let slotsAll = 0;
    for (let j = 0; j < jN; j++) {
      this.jNoise[j] = this.rand() * (this.jBid[j] >= 0 ? DEST_NOISE : DEST_NOISE * 0.5);
      this.jAsg[j] = 0;
      this.jPrice[j] = this.jBid[j] >= 0 ? this.priceById[this.jBid[j]] : this.connPrice[this.jCell[j]];
      slotsAll += this.jSlots[j];
    }
    this.propFactor = slotsAll > 0 ? Math.min(1, (MATCH_PROP_SLACK * workers) / slotsAll) : 1;
    for (let j = 0; j < jN; j++) this.jCapP[j] = this.jSlots[j] * this.propFactor;
    this.buildClusters();
    this.round = 0;
    this.tripsCar = this.tripsTransit = this.tripsWalk = 0;
    this.commuteSum = this.commuteW = 0;
    // shopping / freight: recompute every 2nd cycle or after a graph rebuild
    this.sfRecompute = this.sfVersion !== g.version || this.cycles % 2 === 0;
    this.jTimeSum = growF32(this.jTimeSum, jN); this.jTimeSum.fill(0, 0, jN);
    this.jInbound = growF32(this.jInbound, jN); this.jInbound.fill(0, 0, jN);
    this.jCar.fill(0, 0, jN);
    this.sLoad = growF32(this.sLoad, sN);
    if (this.sfRecompute) { this.sLoad.fill(0, 0, sN); this.sCar.fill(0, 0, sN); }
    this.pendingRoutes = [];
    this.prRiders = 0;
  }

  private prepTransit(st: CityState): void {
    const g = this.road, rail = this.rail, sub = this.subway;
    const N = st.size;
    this.refreshAttach(st);
    const stops = collectStops(st, this.stops);
    this.stops = stops;
    // ferry nodes: one per linked terminal (WP7-9)
    this.ferryNodeOf.clear();
    let nFerry = 0;
    for (const f of this.ferryTerms) if ((this.ferryNet.partners.get(f.id)?.length ?? 0) > 0) this.ferryNodeOf.set(f.id, nFerry++);
    const nR = g.n, nRail = rail.n, nSub = sub.n, nGrid = nR + nRail + nSub, total = nGrid + nFerry;
    // depots (WP7-5): fleet, stop ownership by a multi-source road BFS (on road / depot changes only)
    this.collectDepots(st);
    // attach nodes per stop (combined ids)
    this.stAttS = growI32(this.stAttS, stops.n + 1);
    this.stAttC = growU8(this.stAttC, stops.n + 1);
    this.stAtt = growI32(this.stAtt, stops.n * 6 + 8);
    this.stWait = growF32(this.stWait, stops.n + 1);
    this.stLoad = growF32(this.stLoad, stops.n + 1);
    this.stLoad.fill(0, 0, stops.n);
    this.stKey = growI32(this.stKey, stops.n + 1);
    this.stDepot = growI32(this.stDepot, stops.n + 1);
    this.stRho = growF32(this.stRho, stops.n + 1);
    this.stOk = growU8(this.stOk, stops.n + 1);
    this.stIdxById.clear();
    this.nodeStop = growI32(this.nodeStop, total + 1);
    this.nodeStop.fill(-1, 0, total);
    let an = 0;
    const tmp = new Int32Array(6);
    const nD = this.depots.length;
    const dRiders = new Float64Array(nD + 1), dStops = new Int32Array(nD + 1);
    for (let s = 0; s < stops.n; s++) {
      this.stAttS[s] = an;
      const mode = stops.mode[s];
      const bid = stops.bid[s];
      const b = bid >= 0 ? st.buildings.get(bid) : undefined;
      const key = bid >= 0 ? bid : -1 - stops.cell[s];
      this.stKey[s] = key;
      if (bid >= 0) this.stIdxById.set(bid, s);
      // WP7-6: a stop that does not serve (off-road bus stop, lone station, unlinked ferry) gets no attach nodes
      const ok = b ? this.attach.get(bid) === 1 : g.nodeOfCell[stops.cell[s]] >= 0;
      this.stOk[s] = ok ? 1 : 0;
      let c = 0;
      if (ok) {
        if (mode === Transit.Bus) {
          if (!b) {
            const nd = g.nodeOfCell[stops.cell[s]];
            if (nd >= 0) tmp[c++] = nd;
          } else c = perimeterNodes(g.nodeOfCell, N, b, tmp, 0, 2);
        } else if (mode === Transit.Train && b) {
          c = perimeterNodes(rail.nodeOfCell, N, b, tmp, 0, 4);
          for (let q = 0; q < c; q++) tmp[q] += nR;
        } else if (mode === Transit.Subway && b) {
          c = sub.perimeterNodes(b, tmp, 0, 4, true);
          for (let q = 0; q < c; q++) tmp[q] += nR + nRail;
        } else if (mode === Transit.Ferry && b) {
          const k = this.ferryNodeOf.get(bid);
          if (k !== undefined) tmp[c++] = nGrid + k;
        }
      }
      for (let q = 0; q < c; q++) { this.stAtt[an++] = tmp[q]; this.nodeStop[tmp[q]] = s; }
      this.stAttC[s] = c;
      // bus fleet: building bus stops belong to the depot that reaches them first (else the minibus pool)
      let d = -1;
      if (mode === Transit.Bus && b && c > 0) {
        const o = this.depotOwner.length > 0 && tmp[0] < this.depotOwner.length ? this.depotOwner[tmp[0]] : -1;
        d = o >= 0 && o < nD ? o : nD; // nD = minibus pool
        dRiders[d] += this.stLoadPrev.get(key) ?? 0;
        dStops[d]++;
      }
      this.stDepot[s] = d >= 0 && d < nD ? d : -1;
      this.stRho[s] = d >= 0 ? -1 : 1; // filled below for fleet stops
    }
    this.stAttS[stops.n] = an;
    // service ratio per depot / minibus pool: rho = fleet / smoothed needed buses (WP7-5)
    const rhoOf = new Float32Array(nD + 1);
    for (let d = 0; d <= nD; d++) {
      const id = d < nD ? this.depots[d].id : -1;
      const raw = dRiders[d] / RIDERS_PER_BUS;
      const prev = this.busNeed.get(id);
      const need = prev === undefined ? raw : prev + BUS_NEED_SMOOTH * (raw - prev);
      if (dStops[d] > 0 || d < nD) this.busNeed.set(id, need);
      const fleet = d < nD ? this.depots[d].fleet : MINIBUS_FLEET;
      const rho = need > 1e-6 ? Math.max(BUS_RHO_MIN, Math.min(BUS_RHO_MAX, fleet / need)) : BUS_RHO_MAX;
      rhoOf[d] = rho;
      if (d < nD) { const D = this.depots[d]; D.stops = dStops[d]; D.riders = dRiders[d]; D.need = need; D.rho = rho; }
      else { this.minibus.stops = dStops[d]; this.minibus.riders = dRiders[d]; this.minibus.need = need; this.minibus.rho = rho; }
    }
    if (dStops[nD] === 0) this.busNeed.delete(-1);
    if (this.busNeed.size > nD + 1) {
      const live = new Set(this.depots.map((x) => x.id));
      for (const id of [...this.busNeed.keys()]) if (id !== -1 && !live.has(id)) this.busNeed.delete(id);
    }
    for (let s = 0; s < stops.n; s++) {
      const mode = stops.mode[s];
      if (this.stRho[s] < 0) this.stRho[s] = rhoOf[this.stDepot[s] >= 0 ? this.stDepot[s] : nD];
      // wait with crowding from the previous cycle (buses: the base wait shrinks / grows with the fleet)
      const prev = this.stLoadPrev.get(this.stKey[s]) ?? 0;
      const capS = mode === Transit.Bus ? STOP_CAP_BUS : mode === Transit.Subway ? STOP_CAP_SUBWAY : mode === Transit.Ferry ? STOP_CAP_FERRY : STOP_CAP_TRAIN;
      const base = mode === Transit.Bus ? WAIT_BUS / this.stRho[s] : mode === Transit.Subway ? WAIT_SUBWAY : mode === Transit.Ferry ? WAIT_FERRY : WAIT_TRAIN;
      const r = prev / capS;
      this.stWait[s] = base * Math.min(4, 1 + r * r);
    }
    // spatial bins of stops (8x8 cells)
    const BS = 8;
    const nb = Math.ceil(N / BS);
    this.binN = nb;
    this.stopBinStart = growI32(this.stopBinStart, nb * nb + 1);
    this.stopBinStart.fill(0, 0, nb * nb + 1);
    this.stopBins = growI32(this.stopBins, stops.n + 1);
    for (let s = 0; s < stops.n; s++) {
      const c = stops.cell[s], x = c % N, z = (c - x) / N;
      this.stopBinStart[((z / BS) | 0) * nb + ((x / BS) | 0) + 1]++;
    }
    for (let i = 0; i < nb * nb; i++) this.stopBinStart[i + 1] += this.stopBinStart[i];
    const fillp = new Int32Array(nb * nb);
    for (let s = 0; s < stops.n; s++) {
      const c = stops.cell[s], x = c % N, z = (c - x) / N;
      const bi = ((z / BS) | 0) * nb + ((x / BS) | 0);
      this.stopBins[this.stopBinStart[bi] + fillp[bi]++] = s;
    }
    // transfers between stops of different modes within walking distance
    const trFrom: number[] = [], trTo: number[] = [], trCost: number[] = [];
    for (let s = 0; s < stops.n; s++) {
      if (this.stAttC[s] === 0) continue;
      const c = stops.cell[s], x = c % N, z = (c - x) / N;
      const cnt = this.nearStops(N, x, z, STOP_WALK_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const s2 = this.nsIdx[q], d = this.nsDist[q];
        if (s2 <= s || stops.mode[s2] === stops.mode[s] || this.stAttC[s2] === 0) continue;
        const a = this.stAtt[this.stAttS[s]], b = this.stAtt[this.stAttS[s2]];
        const cost = d * STOP_WALK_TIME_PER_CELL + 0.5 * (this.stWait[s] + this.stWait[s2]);
        trFrom.push(a, b); trTo.push(b, a); trCost.push(cost, cost);
      }
    }
    // ferry links (WP7-9): ferry node <-> ferry node, in-vehicle minutes
    for (const l of this.ferryNet.links) {
      const ka = this.ferryNodeOf.get(l.a), kb = this.ferryNodeOf.get(l.b);
      if (ka === undefined || kb === undefined) continue;
      const a = nGrid + ka, b = nGrid + kb, cost = Math.max(FERRY_TIME_PER_CELL, l.minutes);
      trFrom.push(a, b); trTo.push(b, a); trCost.push(cost, cost);
    }
    this.trStartA = growI32(this.trStartA, total + 1);
    const trStart = this.trStartA;
    trStart.fill(0, 0, total + 1);
    for (const f of trFrom) trStart[f + 1]++;
    for (let i = 0; i < total; i++) trStart[i + 1] += trStart[i];
    const to = new Int32Array(trFrom.length), cost = new Float32Array(trFrom.length);
    for (let e = 0; e < trFrom.length; e++) {
      // trStart[f+1] (= end of f's bucket) used as a decrementing cursor
      const f = trFrom[e];
      const p = --trStart[f + 1];
      to[p] = trTo[e];
      cost[p] = trCost[e];
    }
    // now trStart[k] = original start[k-1] for k >= 1: shift back
    for (let i = 1; i < total; i++) trStart[i] = trStart[i + 1];
    trStart[total] = trFrom.length;
    this.busTimeA = growF32(this.busTimeA, nR);
    const busTime = this.busTimeA;
    for (let v = 0; v < nR; v++) busTime[v] = this.nodeTime[v] * BUS_TIME_FACTOR;
    this.tnet = {
      nR, nRail, nSub, nFerry, total, roadAdj: g.rev, busTime, railAdj: rail.adj, subAdj: sub.adj,
      railTime: NET_TIME[Network.Rail], subTime: SUBWAY_TIME, trStart, trTo: to, trCost: cost,
    };
    this.tAcc = growF32(this.tAcc, total);
    // park & ride garages: an attached stop within PR_STOP_RADIUS (+ half the footprint) (WP7-8)
    const gN = this.gN;
    this.gStop = growI32(this.gStop, gN + 1); this.gWalk = growF32(this.gWalk, gN + 1); this.gLabel = growF32(this.gLabel, gN + 1);
    this.gSeed = growF32(this.gSeed, gN + 1); this.gBoard = growI32(this.gBoard, gN + 1); this.gLoad = growF32(this.gLoad, gN + 1);
    this.gRide = growU8(this.gRide, gN + 1); this.gCell = growI32(this.gCell, gN + 1); this.gReach = growU8(this.gReach, gN + 1);
    let prN = 0, key = '';
    for (let q = 0; q < gN; q++) {
      this.gStop[q] = -1; this.gWalk[q] = 0; this.gLoad[q] = 0; this.gBoard[q] = -1; this.gRide[q] = 0;
      const b = st.buildings.get(this.gBid[q]);
      if (!b || this.gEntC[q] === 0) continue;
      const c = centerCell(st, b), x = c % N, z = (c - x) / N;
      const half = Math.max(b.w, b.d) >> 1;
      this.gCell[q] = c;
      this.gReach[q] = GARAGE_WALK_RADIUS + half + 1;
      const cnt = this.nearStops(N, x, z, PR_STOP_RADIUS + half);
      let best = Infinity;
      for (let k = 0; k < cnt; k++) {
        const s = this.nsIdx[k];
        if (this.stAttC[s] === 0) continue;
        const walk = Math.max(0, this.nsDist[k] - half) * STOP_WALK_TIME_PER_CELL;
        if (walk + this.stWait[s] < best) { best = walk + this.stWait[s]; this.gStop[q] = s; this.gWalk[q] = walk; }
      }
      if (this.gStop[q] >= 0) { prN++; key += this.gBid[q] + ':' + this.stKey[this.gStop[q]] + ','; }
    }
    this.gPrN = prN;
    this.prKeyNow = key;
  }

  /** WP7-5: depots of this cycle (fleet) and, on road / depot changes, the stop ownership BFS */
  private collectDepots(st: CityState): void {
    const funding = Math.min(DEPOT_FUNDING_MAX, fundingFactor(st, 'transit'));
    const deps: TrafficSystem['depots'] = [];
    let key = '';
    for (const b of this.depotB) {
      const powered = !infoOf(st, b).usesPower || (b.flags & BF.Powered) !== 0;
      deps.push({ id: b.id, fleet: (DEPOT_DEFS[b.def] ?? DEPOT_BUSES) * funding * (powered ? 1 : DEPOT_UNPOWERED), stops: 0, riders: 0, need: 0, rho: BUS_RHO_MAX });
      key += b.id + '@' + b.x + ',' + b.z + ';';
    }
    this.depots = deps;
    if (key !== this.depotKey || this.depotVer !== this.road.version || this.depotOwner.length < this.road.n) {
      this.depotKey = key;
      this.depotVer = this.road.version;
      this.depotBfs(st);
    }
  }

  /** multi-source BFS (road hops, both directions) from the depots' road entries, at most DEPOT_RANGE hops: owner per node */
  private depotBfs(st: CityState): void {
    const g = this.road, n = g.n, N = st.size;
    if (this.depotOwner.length < n) this.depotOwner = new Int32Array(n + (n >> 3) + 16);
    const owner = this.depotOwner;
    owner.fill(-1, 0, n);
    if (this.depotB.length === 0 || n === 0) return;
    const hop = new Uint16Array(n), q = new Int32Array(n);
    let qh = 0, qt = 0;
    const tmp = new Int32Array(12);
    for (let d = 0; d < this.depotB.length; d++) {
      const c = perimeterNodes(g.nodeOfCell, N, this.depotB[d], tmp, 0, 12);
      for (let k = 0; k < c; k++) { const v = tmp[k]; if (owner[v] >= 0) continue; owner[v] = d; hop[v] = 0; q[qt++] = v; }
    }
    const fwd = g.fwd, rev = g.rev;
    while (qh < qt) {
      const u = q[qh++];
      const h = hop[u];
      if (h >= DEPOT_RANGE) continue;
      for (let k = 0; k < 8; k++) {
        const v = k < 4 ? fwd[u * 4 + k] : rev[u * 4 + k - 4];
        if (v < 0 || owner[v] >= 0) continue;
        owner[v] = owner[u];
        hop[v] = h + 1;
        q[qt++] = v;
      }
    }
  }

  /** stops within radius R of (x,z) -> this.nsIdx / this.nsDist (returns count; no allocation) */
  private nearStops(N: number, x: number, z: number, R: number): number {
    const BS = 8, nb = this.binN;
    const bx0 = Math.max(0, ((x - R) / BS) | 0), bx1 = Math.min(nb - 1, ((x + R) / BS) | 0);
    const bz0 = Math.max(0, ((z - R) / BS) | 0), bz1 = Math.min(nb - 1, ((z + R) / BS) | 0);
    const stops = this.stops;
    const R2 = R * R;
    let c = 0;
    for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) {
      const bi = bz * nb + bx;
      for (let p = this.stopBinStart[bi], p1 = this.stopBinStart[bi + 1]; p < p1; p++) {
        const s = this.stopBins[p];
        const cell = stops.cell[s], sx = cell % N, sz = (cell - sx) / N;
        const dx = sx - x, dz = sz - z;
        const d2 = dx * dx + dz * dz;
        if (d2 > R2) continue;
        if (c >= this.nsIdx.length) {
          const a = new Int32Array(this.nsIdx.length * 2); a.set(this.nsIdx); this.nsIdx = a;
          const b = new Float32Array(this.nsDist.length * 2); b.set(this.nsDist); this.nsDist = b;
        }
        this.nsIdx[c] = s;
        this.nsDist[c] = Math.sqrt(d2);
        c++;
      }
    }
    return c;
  }

  // ------------------------------------------------------------------------------------------ TRANSIT
  private transit(): void {
    const T = this.tnet!;
    const S = this.ST;
    if (this.stops.n === 0) {
      S.reset(T.total);
      this.originTransit();
      this.transitDone = true;
      return;
    }
    this.transitDone = false;
    const seeds = this.seeds;
    seeds.clear();
    const N = this.road.N;
    for (let j = 0; j < this.jN; j++) {
      const label0 = this.jBase[j] + this.jNoise[j];
      if (this.jRailNode[j] >= 0) {
        seeds.push(T.nR + this.jRailNode[j], label0, j);
        continue;
      }
      if (this.jBid[j] < 0) continue;
      // WP7b: no transit destination where nobody can be matched (no road entry) or at a transit facility's own
      // handful of jobs (stops, terminals, depots, garages sit at the stop: every rider would "ride" 0 minutes there)
      if (this.jQ[j] < 0 || this.jNoDest[j] === 1) continue;
      const c = this.jCell[j], x = c % N, z = (c - x) / N;
      const half = this.jHalf[j];
      const cnt = this.nearStops(N, x, z, STOP_WALK_RADIUS + half);
      for (let q = 0; q < cnt; q++) {
        const s = this.nsIdx[q];
        const walk = Math.max(0, this.nsDist[q] - half) * STOP_WALK_TIME_PER_CELL;
        for (let a = this.stAttS[s], a1 = a + this.stAttC[s]; a < a1; a++) seeds.push(this.stAtt[a], label0 + walk, j);
      }
    }
    transitSearch(T, S, this.heap, seeds, MAX_COMMUTE + DEST_NOISE + REGIONAL_TIME);
    // the per-origin options follow in their own step (PH_TRANSIT2)
  }

  /** each origin's best transit option (board node, stop, pure minutes, destination) from the transit forest */
  private originTransit(): void {
    const ST = this.ST;
    const distT = ST.dist, srcT = ST.src, doneT = ST.done;
    const N = this.road.N;
    const hasStops = this.stops.n > 0;
    for (let o = 0; o < this.oN; o++) {
      this.oTrT[o] = Infinity;
      this.oBoard[o] = -1;
      this.oBoardStop[o] = -1;
      this.oJobT[o] = -1;
      // park & ride options come from PH_PARKRIDE (skipped without P&R garages)
      this.oPrT[o] = Infinity;
      this.oPrG[o] = -1;
      this.oPrNode[o] = -1;
      if (!hasStops) continue;
      const c = this.oCell[o], x = c % N, z = (c - x) / N;
      const half = this.oHalf[o];
      const cnt = this.nearStops(N, x, z, STOP_WALK_RADIUS + half);
      let best = Infinity, board = -1, boardStop = -1;
      for (let q = 0; q < cnt; q++) {
        const s = this.nsIdx[q];
        const walk = Math.max(0, this.nsDist[q] - half) * STOP_WALK_TIME_PER_CELL + this.stWait[s];
        for (let a = this.stAttS[s], a1 = a + this.stAttC[s]; a < a1; a++) {
          const v = this.stAtt[a];
          if (doneT[v] !== 1) continue;
          const g = walk + distT[v];
          if (g < best) { best = g; board = v; boardStop = s; }
        }
      }
      if (board < 0) continue;
      const jT = srcT[board];
      const t = best - this.jNoise[jT];
      if (t > MAX_COMMUTE) continue;
      this.oTrT[o] = t;
      this.oBoard[o] = board;
      this.oBoardStop[o] = boardStop;
      this.oJobT[o] = jT;
    }
    this.acc.fill(0, 0, this.road.n);
    this.tAcc.fill(0, 0, this.tnet!.total);
  }

  // ------------------------------------------------------------------------------------------ PARK & RIDE (WP7-8)
  /**
   * P&R garages: label = PR_PARK_MIN + walk to the stop + its wait + transit minutes from the stop (this cycle's transit
   * forest) + crowding of the last assignment. Every 2nd cycle (or when the graph / garages changed) a reverse road
   * search from the garages' road entries gives the car legs; in between the forest is reused (same graph and garages:
   * car legs keep their minutes, the transit part is this cycle's). Origin option = PR_HOME_MIN + car leg + label if
   * the car leg is <= PR_CAR_LEG_MAX. A garage whose stop's best path rides no vehicle (its jobs are a walk away: a
   * downtown garage) is plain parking: its users park and walk (car trips with the car overhead instead of park + wait,
   * no stop riders), so it draws drivers only where the jobs' parking pressure costs more than the walk.
   */
  private parkRide(): void {
    const ST = this.ST, distT = ST.dist, doneT = ST.done, srcT = ST.src;
    const gN = this.gN;
    const st = this.lastState;
    for (let q = 0; q < gN; q++) {
      this.gLabel[q] = Infinity;
      this.gBoard[q] = -1;
      this.gRide[q] = 0;
      const s = this.gStop[q];
      if (s < 0) continue;
      let best = Infinity, board = -1;
      for (let a = this.stAttS[s], a1 = a + this.stAttC[s]; a < a1; a++) {
        const v = this.stAtt[a];
        if (doneT[v] === 1 && distT[v] < best) { best = distT[v]; board = v; }
      }
      if (board < 0) continue;
      const spaces = GARAGE_DEFS[st?.buildings.get(this.gBid[q])?.def ?? ''] ?? GARAGE_SPACES;
      const load = this.garageLoad.get(this.gBid[q]) ?? 0;
      const crowd = GARAGE_CROWD_K * Math.max(0, load / spaces - GARAGE_CROWD_FROM);
      const jT = srcT[board];
      const ride = this.ridesFrom(board);
      this.gRide[q] = ride ? 1 : 0;
      // park & walk (no ride): the car trip's own overhead instead of parking + wait — the garage beats driving to the
      // job only where the job's parking pressure costs more than the walk (PARKING_MIN x parking)
      const park = ride ? PR_PARK_MIN + this.stWait[s] : CAR_OVERHEAD - PR_HOME_MIN;
      this.gLabel[q] = park + this.gWalk[q] + best - (jT >= 0 ? this.jNoise[jT] : 0) + crowd;
      this.gBoard[q] = board;
    }
    const g = this.road, SP = this.SP;
    if (this.prSearchDue()) {
      const seeds = this.seeds;
      seeds.clear();
      let maxL = 0;
      for (let q = 0; q < gN; q++) {
        const L = this.gLabel[q];
        this.gSeed[q] = L;
        if (!(L < PR_LIMIT)) continue;
        for (let e = this.gEntS[q], e1 = e + this.gEntC[q]; e < e1; e++) seeds.push(this.ent[e], L, q);
        if (L > maxL) maxL = L;
      }
      roadSearch(g, g.rev, this.nodeTime, SP, this.heap, seeds, Math.min(PR_LIMIT, maxL + PR_CAR_LEG_MAX), this.rampT);
      this.prKey = this.prKeyNow;
    }
    const dist = SP.dist, src = SP.src, done = SP.done;
    const n = Math.min(g.n, SP.n);
    for (let o = 0; o < this.oN; o++) {
      this.oPrT[o] = Infinity;
      this.oPrG[o] = -1;
      this.oPrNode[o] = -1;
      let best = Infinity, node = -1, gq = -1;
      for (let e = this.oEntS[o], e1 = e + this.oEntC[o]; e < e1; e++) {
        const v = this.ent[e];
        if (v >= n || done[v] !== 1) continue;
        const q = src[v];
        if (q < 0 || q >= gN) continue;
        const seed = this.gSeed[q], lab = this.gLabel[q];
        if (!(lab < Infinity) || !(seed < Infinity)) continue;
        const car = dist[v] - seed;
        if (car > PR_CAR_LEG_MAX) continue;
        const t = PR_HOME_MIN + car + lab;
        if (t < best) { best = t; node = v; gq = q; }
      }
      if (gq < 0 || best > MAX_COMMUTE) continue;
      this.oPrT[o] = best;
      this.oPrG[o] = gq;
      this.oPrNode[o] = node;
    }
  }

  // ------------------------------------------------------------------------------------------ ROUNDS
  /**
   * Job clusters: job sites sharing their primary road entry node (lowest entry node id) are matched as one unit with
   * the summed capacity; results are distributed to the members by slots. Road neighbour connections are their own
   * clusters. Cluster price = slot-weighted mean of the members' persistent prices.
   */
  private buildClusters(): void {
    const g = this.road;
    const jN = this.jN;
    const cap = jN + 1;
    this.qNode = growI32(this.qNode, cap); this.qSlots = growF32(this.qSlots, cap); this.qCapP = growF32(this.qCapP, cap);
    this.qAsg = growF32(this.qAsg, cap); this.qPrice = growF32(this.qPrice, cap); this.qProp = growF32(this.qProp, cap);
    this.qBase = growF32(this.qBase, cap); this.qNoise = growF32(this.qNoise, cap); this.qTimeSum = growF32(this.qTimeSum, cap);
    this.qPark = growF32(this.qPark, cap); this.qCar = growF32(this.qCar, cap);
    if (this.nodeQ.length < g.n) this.nodeQ = new Int32Array(g.n + (g.n >> 3) + 16);
    const nodeQ = this.nodeQ;
    nodeQ.fill(-1, 0, g.n);
    let qN = 0;
    for (let j = 0; j < jN; j++) {
      this.jQ[j] = -1;
      if (this.jEntC[j] === 0) continue;
      let node = this.ent[this.jEntS[j]];
      for (let e = this.jEntS[j] + 1, e1 = this.jEntS[j] + this.jEntC[j]; e < e1; e++) if (this.ent[e] < node) node = this.ent[e];
      const isConn = this.jBid[j] < 0;
      let q = isConn ? -1 : nodeQ[node];
      if (q < 0) {
        q = qN++;
        if (!isConn) nodeQ[node] = q;
        this.qNode[q] = node;
        this.qSlots[q] = 0; this.qCapP[q] = 0; this.qAsg[q] = 0; this.qPrice[q] = 0; this.qProp[q] = 0; this.qTimeSum[q] = 0;
        this.qPark[q] = 0; this.qCar[q] = 0;
        this.qBase[q] = this.jBase[j];
        this.qNoise[q] = this.jNoise[j];
      }
      this.jQ[j] = q;
      this.qSlots[q] += this.jSlots[j];
      this.qCapP[q] += this.jCapP[j];
      this.qPrice[q] += this.jPrice[j] * this.jSlots[j];
      this.qPark[q] += this.jPark[j] * this.jSlots[j];
    }
    for (let q = 0; q < qN; q++) if (this.qSlots[q] > 0) { this.qPrice[q] /= this.qSlots[q]; this.qPark[q] /= this.qSlots[q]; }
    this.qN = qN;
  }

  /** open capacity of job cluster q in the current round */
  private openCap(q: number): number {
    const cap = this.round < MATCH_PROP_ROUNDS ? this.qCapP[q] : this.qSlots[q];
    return cap - this.qAsg[q];
  }

  /** reverse multi-source search from every job cluster with open capacity this round */
  private roundSearch(): void {
    const seeds = this.seeds;
    seeds.clear();
    for (let q = 0; q < this.qN; q++) {
      if (this.openCap(q) < 0.5) continue;
      // prices may be negative (subsidies for unattractive sites): shift all labels by MATCH_PRICE_MAX
      const label = MATCH_PRICE_MAX + this.qBase[q] + this.qNoise[q] + this.qPrice[q];
      seeds.push(this.qNode[q], label, q);
    }
    roadSearch(this.road, this.road.rev, this.nodeTime, this.SA, this.heap, seeds, MAX_COMMUTE + DEST_NOISE + REGIONAL_TIME + 2 * MATCH_PRICE_MAX, this.rampT);
  }

  /** match unassigned workers to their nearest open site (nearest first, up to capacity); returns the next phase */
  private roundMatch(): number {
    const SA = this.SA;
    const dist = SA.dist, src = SA.src, hops = SA.hops, done = SA.done;
    const oN = this.oN;
    // candidates: origins with unassigned workers -> best entry node
    const key = this.candKey, cnode = this.candNode;
    let nc = 0;
    let maxD = 1;
    let noRoad = 0;
    for (let o = 0; o < oN; o++) {
      if (this.oU[o] < 0.01) continue;
      let best = -1, bd = Infinity;
      for (let e = this.oEntS[o], e1 = e + this.oEntC[o]; e < e1; e++) {
        const v = this.ent[e];
        if (done[v] === 1 && dist[v] < bd) { bd = dist[v]; best = v; }
      }
      cnode[o] = best;
      if (best < 0) { if (this.oTrT[o] < Infinity || this.oPrT[o] < Infinity) noRoad++; continue; }
      key[nc++] = o; // packed with the distance below
      if (bd > maxD) maxD = bd;
    }
    // sort candidates by generalized cost (car label minus any transit time advantage: origins with a fast transit
    // option compete on transit time) — pack (quantised cost, origin index) into one float64
    let M = 1;
    while (M < oN) M *= 2;
    const q = Math.max(1, Math.floor(2 ** 50 / (M * (maxD + 1))));
    const qN0 = this.qNoise, qP0 = this.qPrice;
    for (let k = 0; k < nc; k++) {
      const o = key[k];
      const node = cnode[o];
      let g = dist[node];
      const trT = Math.min(this.oTrT[o], this.oPrT[o]);
      if (trT < Infinity) {
        const cq = src[node];
        const carPure = g - MATCH_PRICE_MAX - qN0[cq] - qP0[cq] + CAR_OVERHEAD;
        if (trT < carPure) g -= carPure - trT;
      }
      key[k] = Math.floor(Math.max(0, g) * q) * M + o;
    }
    const sorted = key.subarray(0, nc).sort();
    // accept nearest first
    const fx = this.fx;
    const carPcu = (1 / CAR_OCCUPANCY) * (fx ? fx.trafficCar : 1);
    const trBonus = fx ? 2.5 * Math.log(fx.transitRidership) : 0;
    const acc = this.acc, tAcc = this.tAcc;
    const qAsg = this.qAsg, qBase = this.qBase, qNoise = this.qNoise, qPrice = this.qPrice, qTimeSum = this.qTimeSum;
    const qPark = this.qPark;
    if (this.round === 0) {
      // first round: record unconstrained proposals (excess demand -> shadow prices for the next cycle)
      for (let k = 0; k < nc; k++) {
        const o = sorted[k] % M;
        this.qProp[src[cnode[o]]] += this.oU[o];
      }
    }
    let accepted = 0, carRound = 0;
    const routeCand: number[] = [];
    const routeW: number[] = [];
    for (let k = 0; k < nc; k++) {
      const o = sorted[k] % M;
      const node = cnode[o];
      const q = src[node];
      const d = dist[node] - MATCH_PRICE_MAX - qNoise[q] - qPrice[q];
      this.oLastD[o] = d;
      const open = this.openCap(q);
      if (open < 0.01) continue;
      const take = Math.min(this.oU[o], open);
      // mode split for this piece. WP7b: car commuters pay the site's parking (PARKING_MIN x parking), the transit
      // option is the better of walking to a stop and park & ride, car-less residents pay CARLESS_EXTRA_MIN by car / P&R
      const carT = d + CAR_OVERHEAD + PARKING_MIN * qPark[q];
      const carOk = d <= MAX_COMMUTE;
      const walkT = qBase[q] === 0 && hops[node] <= WALK_MAX_CELLS ? (hops[node] + 1) * WALK_TIME_PER_CELL : Infinity;
      const trT = this.oTrT[o];
      // park & walk (walk-only garage) only for pieces whose job cluster lies within the garage's walk reach
      const prT = this.oPrT[o] < Infinity && !this.prServes(this.oPrG[o], this.qNode[q]) ? Infinity : this.oPrT[o];
      const usePr = prT < trT;
      const tOwn = usePr ? prT : trT;
      const wl = this.oWealth[o] - 1;
      const uc = carOk ? -MODE_BETA * carT + CAR_BIAS[wl] : -Infinity;
      const ut = tOwn < Infinity ? -MODE_BETA * tOwn + TRANSIT_BIAS[wl] + trBonus : -Infinity;
      const uw = walkT < Infinity ? -MODE_BETA * walkT + WALK_BIAS : -Infinity;
      const um = Math.max(uc, ut, uw);
      if (um === -Infinity) continue;
      const ec = uc > -Infinity ? Math.exp(uc - um) : 0;
      const et = ut > -Infinity ? Math.exp(ut - um) : 0;
      const ew = uw > -Infinity ? Math.exp(uw - um) : 0;
      const tot = ec + et + ew;
      let sc = ec / tot, stt = et / tot, sw = ew / tot;
      let time = sc * (sc > 0 ? carT : 0) + stt * (stt > 0 ? tOwn : 0) + sw * (sw > 0 ? walkT : 0);
      // walk-to-stop transit / park & ride shares
      let stW = usePr ? 0 : stt, stP = usePr ? stt : 0;
      const cl = this.oCl[o];
      if (cl > 0) {
        // car-less residents (taxi / lift): car and park & ride cost CARLESS_EXTRA_MIN more
        const ecL = ec * CARLESS_K;
        let etL = et, tL = tOwn, prL = usePr;
        if (usePr) {
          const p2 = prT + CARLESS_EXTRA_MIN;
          if (trT <= p2) { prL = false; tL = trT; etL = Math.exp(-MODE_BETA * trT + TRANSIT_BIAS[wl] + trBonus - um); }
          else { tL = p2; etL = et * CARLESS_K; }
        }
        const totL = ecL + etL + ew;
        const scL = ecL / totL, stL = etL / totL, swL = ew / totL;
        const timeL = scL * (scL > 0 ? carT + CARLESS_EXTRA_MIN : 0) + stL * (stL > 0 ? tL : 0) + swL * (swL > 0 ? walkT : 0);
        const co = 1 - cl;
        stW = co * stW + cl * (prL ? 0 : stL);
        stP = co * stP + cl * (prL ? stL : 0);
        sc = co * sc + cl * scL;
        sw = co * sw + cl * swL;
        stt = stW + stP;
        time = co * time + cl * timeL;
      }
      // commit
      this.oU[o] -= take;
      this.oAsg[o] += take;
      this.oTimeSum[o] += take * time;
      this.oCarW[o] += take * sc;
      this.oTrW[o] += take * stt;
      this.oWalkW[o] += take * sw;
      if (this.oCarNode[o] < 0) this.oCarNode[o] = node;
      qAsg[q] += take;
      qTimeSum[q] += take * time;
      accepted += take;
      if (sc > 0) {
        const f = take * sc;
        acc[node] += f * carPcu;
        carRound += f;
        this.qCar[q] += f;
        if (routeCand.length < 256) { routeCand.push(node); routeW.push(f); }
      }
      if (stW > 0) {
        const board = this.oBoard[o];
        tAcc[board] += take * stW;
        this.stLoad[this.oBoardStop[o]] += take * stW;
      }
      // (park & walk at a walk-only garage: car trips)
      if (stP > 0 && !this.addParkRide(o, take * stP, carPcu)) { this.oTrW[o] -= take * stP; this.oCarW[o] += take * stP; }
    }
    // WP7b: transit-only commuters (no road route to any open job — an island reached by ferry or subway) take the job
    // their transit option reaches, while it has room this round
    if (noRoad > 0) accepted += this.transitOnly(carPcu);
    // car flows of this round along its shortest-path forest
    if (carRound > 0) {
      accumulate(SA, acc);
      this.commit(SA, acc, null, null);
      // sample car routes of this round (weighted by car trips)
      const K = Math.min(10, routeCand.length);
      if (K > 0) {
        const cum = new Float64Array(routeCand.length);
        let sw = 0;
        for (let q = 0; q < routeCand.length; q++) { sw += routeW[q]; cum[q] = sw; }
        const g = this.road;
        for (let r = 0; r < K; r++) {
          const idx = lowerBound(cum, this.rand() * sw);
          const path = this.tracePath(SA, routeCand[idx], (v) => g.cellOf[v], false);
          if (path.length >= 2) this.pendingRoutes.push({ cells: path, kind: 'car', weight: carRound / K });
        }
      }
    }
    this.roundAccepted = accepted;
    // next round?
    let left = 0;
    for (let o = 0; o < oN; o++) left += this.oU[o];
    let next = this.round + 1;
    if (next < MATCH_PROP_ROUNDS && (accepted < 0.5 || this.propFactor >= 1)) next = Math.max(next, accepted < 0.5 ? MATCH_PROP_ROUNDS : next); // proportional caps exhausted
    if (left < 0.5 || next >= MATCH_ROUNDS || (accepted < 0.5 && this.round >= MATCH_PROP_ROUNDS)) return PH_COMMUTE;
    let open = 0;
    const saveRound = this.round;
    this.round = next;
    for (let q = 0; q < this.qN; q++) { const c = this.openCap(q); if (c > 0.5) open += c; }
    if (open < 0.5) { this.round = saveRound; return PH_COMMUTE; }
    return PH_RSEARCH;
  }

  /**
   * Pooled final match: workers still unmatched after the rounds take the remaining open capacity of their road
   * component proportionally (long commutes: 1.3 x distance to the nearest open site seen, at least the city
   * average + 5 min). Their car trips follow the last round's forest toward the nearest open site.
   */
  private poolRemaining(): void {
    const g = this.road;
    const comp = g.comp;
    const nc = g.nComp;
    if (nc === 0) return;
    const U = new Float64Array(nc), O = new Float64Array(nc);
    let any = false;
    for (let o = 0; o < this.oN; o++) {
      if (this.oU[o] < 0.01 || this.oLastD[o] < 0) continue;
      U[comp[this.ent[this.oEntS[o]]]] += this.oU[o];
      any = true;
    }
    if (!any) return;
    const full = MATCH_PROP_ROUNDS; // full-capacity rounds
    const saveRound = this.round;
    this.round = full;
    for (let q = 0; q < this.qN; q++) {
      const c = this.openCap(q);
      if (c > 0.5) O[comp[this.qNode[q]]] += c;
    }
    let tw = 0, tt = 0;
    for (let o = 0; o < this.oN; o++) { tw += this.oAsg[o]; tt += this.oTimeSum[o]; }
    const avgT = tw > 0 ? tt / tw : 15;
    const fx = this.fx;
    const carPcu = (1 / CAR_OCCUPANCY) * (fx ? fx.trafficCar : 1);
    const SA = this.SA, acc = this.acc;
    let flows = false;
    // pooled car commuters per component (parking demand of the sites that take them)
    const tk = new Float64Array(nc), carTk = new Float64Array(nc);
    const logit = (x: number) => 1 / (1 + Math.exp(-x));
    for (let o = 0; o < this.oN; o++) {
      const u = this.oU[o];
      if (u < 0.01 || this.oLastD[o] < 0) continue;
      const c = comp[this.ent[this.oEntS[o]]];
      if (O[c] <= 0) continue;
      const take = u * Math.min(1, O[c] / U[c]);
      const carT = Math.min(MAX_COMMUTE, Math.max(avgT + 5, 1.3 * (this.oLastD[o] + CAR_OVERHEAD)));
      // car / transit split (long pooled car trip vs the origin's transit option: walk to a stop or park & ride;
      // car-less residents pay CARLESS_EXTRA_MIN on car and park & ride)
      const trT = this.oTrT[o];
      // (pooled long commutes go to far jobs: no park & walk)
      const prT = this.oPrG[o] >= 0 && this.gRide[this.oPrG[o]] === 0 ? Infinity : this.oPrT[o];
      const wl = this.oWealth[o] - 1;
      const usePr = prT < trT, tOwn = usePr ? prT : trT;
      const cl = this.oCl[o];
      const uCar = -MODE_BETA * carT + CAR_BIAS[wl];
      let stO = 0, stW = 0, stP = 0, time: number;
      if (tOwn < Infinity) {
        stO = logit(-MODE_BETA * tOwn + TRANSIT_BIAS[wl] - uCar);
        if (usePr) stP = stO; else stW = stO;
      }
      time = (1 - stO) * carT + stO * (tOwn < Infinity ? tOwn : 0);
      if (cl > 0) {
        const tL = Math.min(trT, prT + CARLESS_EXTRA_MIN), prL = prT + CARLESS_EXTRA_MIN < trT;
        const stL = tL < Infinity ? logit(-MODE_BETA * tL + TRANSIT_BIAS[wl] - (uCar - MODE_BETA * CARLESS_EXTRA_MIN)) : 0;
        const timeL = (1 - stL) * (carT + CARLESS_EXTRA_MIN) + stL * (tL < Infinity ? tL : 0);
        const co = 1 - cl;
        stW = co * stW + cl * (prL ? 0 : stL);
        stP = co * stP + cl * (prL ? stL : 0);
        time = co * time + cl * timeL;
      }
      const st = stW + stP;
      const sc = 1 - st;
      this.oU[o] -= take;
      this.oAsg[o] += take;
      this.oTimeSum[o] += take * time;
      this.oCarW[o] += take * sc;
      tk[c] += take;
      carTk[c] += take * sc;
      if (st > 0) {
        this.oTrW[o] += take * st;
        if (stW > 0) {
          this.tAcc[this.oBoard[o]] += take * stW;
          this.stLoad[this.oBoardStop[o]] += take * stW;
        }
        if (stP > 0 && !this.addParkRide(o, take * stP, carPcu)) { this.oTrW[o] -= take * stP; this.oCarW[o] += take * stP; }
      }
      const node = this.candNode[o];
      if (sc > 0 && node >= 0 && node < g.n && SA.done[node] === 1) { acc[node] += take * sc * carPcu; flows = true; }
    }
    for (let q = 0; q < this.qN; q++) {
      const open = this.openCap(q);
      if (open <= 0.5) continue;
      const c = comp[this.qNode[q]];
      if (O[c] <= 0) continue;
      const add = open * Math.min(1, U[c] / O[c]);
      this.qAsg[q] += add;
      this.qTimeSum[q] += add * Math.max(avgT + 5, 20);
      if (tk[c] > 0) this.qCar[q] += add * (carTk[c] / tk[c]);
    }
    this.round = saveRound;
    if (flows) {
      accumulate(SA, acc);
      this.commit(SA, acc, null, null);
    }
  }

  /** roundMatch: origins without a road candidate but with a transit / P&R option -> the job that option reaches */
  private transitOnly(carPcu: number): number {
    const srcT = this.ST.src;
    let accepted = 0;
    for (let o = 0; o < this.oN; o++) {
      if (this.oU[o] < 0.01 || this.candNode[o] >= 0) continue;
      const trT = this.oTrT[o], prT = this.oPrT[o];
      const viaPr = prT < trT;
      const t = viaPr ? prT : trT;
      if (!(t <= MAX_COMMUTE)) continue;
      const jT = viaPr ? srcT[this.gBoard[this.oPrG[o]]] : this.oJobT[o];
      if (jT < 0 || jT >= this.jN) continue;
      const q = this.jQ[jT];
      if (q < 0) continue;
      const open = this.openCap(q);
      if (open < 0.01) continue;
      const take = Math.min(this.oU[o], open);
      this.oU[o] -= take;
      this.oAsg[o] += take;
      this.oTimeSum[o] += take * t;
      this.oTrW[o] += take;
      this.qAsg[q] += take;
      this.qTimeSum[q] += take * t;
      if (viaPr) { if (!this.addParkRide(o, take, carPcu)) { this.oTrW[o] -= take; this.oCarW[o] += take; } } else {
        this.tAcc[this.oBoard[o]] += take;
        this.stLoad[this.oBoardStop[o]] += take;
      }
      accepted += take;
    }
    return accepted;
  }

  /**
   * park & ride piece of origin o: car leg on the P&R forest, riders join the transit forest at the garage's stop.
   * Returns false for a walk-only garage (park and walk): the caller books the piece as car trips.
   */
  private addParkRide(o: number, y: number, carPcu: number): boolean {
    const gq = this.oPrG[o];
    if (gq < 0 || gq >= this.gN) return true;
    const board = this.gBoard[gq], s = this.gStop[gq], node = this.oPrNode[o];
    if (board < 0 || s < 0 || node < 0) return true;
    this.prAcc[node] += y * carPcu;
    this.gLoad[gq] += y / CAR_OCCUPANCY;
    if (this.gRide[gq] === 0) return false; // park & walk: a car trip, no riders
    this.tAcc[board] += y;
    this.stLoad[s] += y;
    this.prRiders += y;
    return true;
  }

  /**
   * is the park & ride option of garage gq usable for a job cluster at road node `node`? Riding garages: always (the
   * transit option is not destination-specific); a park & walk garage: only for jobs within its walk reach
   */
  private prServes(gq: number, node: number): boolean {
    if (gq < 0 || gq >= this.gN || this.gRide[gq] === 1) return true;
    if (node < 0 || node >= this.road.n) return false;
    const N = this.road.N, c = this.road.cellOf[node], g = this.gCell[gq], r = this.gReach[gq];
    const dx = (c % N) - (g % N), dz = ((c - (c % N)) - (g - (g % N))) / N;
    return dx * dx + dz * dz <= r * r;
  }

  /** does the transit forest path from node v ride a vehicle (bus on roads, rail, subway, ferry) before its job? */
  private ridesFrom(v: number): boolean {
    const T = this.tnet!, next = this.ST.next;
    const b1 = T.nR, b2 = b1 + T.nRail, b3 = b2 + T.nSub;
    let u = v, lu = u < b1 ? 0 : u < b2 ? 1 : u < b3 ? 2 : 3;
    for (let k = 0; k < 65536; k++) {
      const w = next[u];
      if (w < 0) return false;
      // same layer = an in-vehicle edge (transfers only join different modes; ferry <-> ferry is a crossing)
      const lw = w < b1 ? 0 : w < b2 ? 1 : w < b3 ? 2 : 3;
      if (lw === lu) return true;
      u = w; lu = lw;
    }
    return false;
  }

  /**
   * add the accumulated per-node flows of forest S (acc after accumulate) to this cycle's volumes, copy them into
   * `copy` (cached volumes) and count highway <-> non-highway moves as ramp flow of the non-highway node (+ `rampCopy`);
   * clears acc on the settled nodes
   */
  private commit(S: Search, acc: Float32Array, copy: Float32Array | null, rampCopy: Float32Array | null): void {
    const volNew = this.volNew, rampNew = this.rampNew, order = S.order, next = S.next, type = this.road.type;
    const HW = Network.Highway;
    for (let k = 0; k < S.settled; k++) {
      const v = order[k];
      const f = acc[v];
      if (f === 0) continue;
      volNew[v] += f;
      if (copy) copy[v] = f;
      acc[v] = 0;
      const nx = next[v];
      if (nx >= 0 && (type[v] === HW) !== (type[nx] === HW)) {
        const r = type[v] === HW ? nx : v;
        rampNew[r] += f;
        if (rampCopy) rampCopy[r] += f;
      }
    }
  }

  /** transit rider flows, per-origin results and stats of the commute matching */
  private commuteEnd(): void {
    this.poolRemaining();
    // shadow prices: tatonnement on first-round excess demand (proposals / proportional capacity), step scaled to
    // the city's commute time scale
    let tw = 0, tt = 0;
    for (let o = 0; o < this.oN; o++) { tw += this.oAsg[o]; tt += this.oTimeSum[o]; }
    const avgT = tw > 0 ? tt / tw - CAR_OVERHEAD : 5;
    const stepP = Math.max(MATCH_PRICE_STEP_MIN, MATCH_PRICE_STEP_REL * avgT);
    // excess demand relative to the city-wide mean (keeps the mean price stable when workers != jobs)
    let propSum = 0, capSum = 0;
    for (let q = 0; q < this.qN; q++) { propSum += this.qProp[q]; capSum += Math.max(1, this.qCapP[q]); }
    const mean = propSum > 0 && capSum > 0 ? propSum / capSum : 1;
    for (let q = 0; q < this.qN; q++) {
      const cap = Math.max(1, this.qCapP[q]);
      const r = Math.max(0.25, Math.min(8, this.qProp[q] / cap / mean));
      let p = this.qPrice[q] + stepP * Math.log(r);
      this.qPrice[q] = p < -MATCH_PRICE_MAX ? -MATCH_PRICE_MAX : p > MATCH_PRICE_MAX ? MATCH_PRICE_MAX : p;
    }
    // distribute cluster results to member job sites (by slots) + persist prices
    for (let j = 0; j < this.jN; j++) {
      const q = this.jQ[j];
      if (q < 0) { this.jAsg[j] = 0; this.jTimeSum[j] = 0; continue; }
      const share = this.qSlots[q] > 0 ? this.jSlots[j] / this.qSlots[q] : 0;
      this.jAsg[j] = this.qAsg[q] * share;
      this.jTimeSum[j] = this.qTimeSum[q] * share;
      this.jCar[j] = this.qCar[q] * share;
      if (this.jBid[j] >= 0) this.priceById[this.jBid[j]] = this.qPrice[q];
      else this.connPrice[this.jCell[j]] = this.qPrice[q];
    }
    // WP7-8 park & ride: car legs along the P&R forest, garage loads (cars) for the next cycle's crowding / reports
    if (this.gPrN > 0 && this.prRiders > 0 && this.SP.graphVersion === this.road.version) {
      accumulate(this.SP, this.prAcc);
      this.commit(this.SP, this.prAcc, null, null);
    } else if (this.prAcc.length > 0) this.prAcc.fill(0, 0, Math.min(this.prAcc.length, this.road.n));
    // smoothed across assignments (the crowding penalty reacts to it: damped, no cobweb oscillation)
    const prevLoad = new Map(this.garageLoad);
    this.garageLoad.clear();
    this.garageRide.clear();
    for (let q = 0; q < this.gN; q++) {
      if (this.gStop[q] < 0) continue;
      const id = this.gBid[q], prev = prevLoad.get(id);
      // a new garage starts at most full (no penalty spike from the unpenalised first assignment)
      const spaces = GARAGE_DEFS[this.lastState?.buildings.get(id)?.def ?? ''] ?? GARAGE_SPACES;
      this.garageLoad.set(id, prev === undefined ? Math.min(this.gLoad[q], spaces) : prev + GARAGE_LOAD_SMOOTH * (this.gLoad[q] - prev));
      if (this.gBoard[q] >= 0) this.garageRide.set(id, this.gRide[q] === 1);
    }
    const ST = this.ST, T = this.tnet!;
    const tAcc = this.tAcc;
    const nR = this.road.n, nRail = T.nRail, nGrid = nR + nRail + T.nSub;
    const nodeStop = this.nodeStop, stLoad = this.stLoad;
    accumulate(ST, tAcc, (_j, f, node) => { const s = nodeStop[node]; if (s >= 0) stLoad[s] += f; });
    const volNew = this.volNew;
    const C = this.road.C;
    if (this.busCell.length !== C) this.busCell = new Float32Array(C);
    this.busCell.fill(0);
    const type = this.road.type, cellOf = this.road.cellOf, next = ST.next, rampNew = this.rampNew, HW = Network.Highway;
    this.ferryRidersBy.clear();
    let ferry = 0;
    for (let k = 0; k < ST.settled; k++) {
      const v = ST.order[k];
      const f = tAcc[v];
      if (f === 0) continue;
      if (v < nR) {
        const pcu = f * BUS_PCU_PER_RIDER;
        volNew[v] += pcu;
        this.busCell[cellOf[v]] = f;
        const nx = next[v];
        if (nx >= 0 && nx < nR && (type[v] === HW) !== (type[nx] === HW)) rampNew[type[v] === HW ? nx : v] += pcu;
      } else if (v < nR + nRail) this.railNew[v - nR] += f;
      else if (v < nGrid) this.subNew[v - nR - nRail] += f;
      else {
        // ferry node: riders through the terminal; flow leaving along a ferry link crossed the water
        const s = nodeStop[v];
        if (s >= 0) this.ferryRidersBy.set(this.stops.bid[s], (this.ferryRidersBy.get(this.stops.bid[s]) ?? 0) + f);
        if (next[v] >= nGrid) ferry += f;
      }
    }
    this.ferryRiders = ferry;
    let tripsC = 0, tripsT = 0, tripsW = 0, cSum = 0, cW = 0;
    for (let o = 0; o < this.oN; o++) {
      const a = this.oAsg[o];
      const W = this.oW[o];
      this.oEmp[o] = W > 0 ? Math.min(1, a / W) : 0;
      if (a > 0) {
        this.oTime[o] = this.oTimeSum[o] / a;
        this.oShC[o] = this.oCarW[o] / a;
        this.oShT[o] = this.oTrW[o] / a;
        this.oShW[o] = this.oWalkW[o] / a;
        cSum += this.oTimeSum[o];
        cW += a;
      } else {
        this.oTime[o] = 0;
        this.oShC[o] = this.oShT[o] = this.oShW[o] = 0;
      }
      tripsC += this.oCarW[o];
      tripsT += this.oTrW[o];
      tripsW += this.oWalkW[o];
    }
    this.tripsCar = tripsC;
    this.tripsTransit = tripsT;
    this.tripsWalk = tripsW;
    this.commuteSum = cSum;
    this.commuteW = cW;
  }

  // ------------------------------------------------------------------------------------------ INBOUND
  private inbound(): void {
    const g = this.road;
    if (!this.sfRecompute) {
      // cached: last inflows by building (capped by this cycle's vacancies) + cached volumes
      let tot = 0;
      for (let j = 0; j < this.jB; j++) {
        const spare = this.jSlots[j] - Math.min(this.jSlots[j], this.jAsg[j]);
        const v = Math.min(spare, this.inboundById[this.jBid[j]]);
        this.jInbound[j] = v > 0 ? v : 0;
        this.jCar[j] += this.jInbound[j];
        tot += this.jInbound[j];
      }
      this.tripsInbound = tot;
      this.addCached(this.volInbound);
      // ramp flows of the cached inbound / shop / freight passes
      if (this.rampSF.length >= g.n) { const rn = this.rampNew, rs = this.rampSF; for (let v = 0; v < g.n; v++) rn[v] += rs[v]; }
      return;
    }
    this.volInbound = growF32(this.volInbound, g.n);
    this.volInbound.fill(0, 0, g.n);
    this.rampSF = growF32(this.rampSF, g.n);
    this.rampSF.fill(0, 0, g.n);
    for (let j = 0; j < this.jB; j++) this.inboundById[this.jBid[j]] = 0;
    const S = this.SB;
    const seeds = this.seeds;
    seeds.clear();
    const conns: number[] = [];
    for (let j = this.jB; j < this.jN; j++) {
      if (this.jEntC[j] === 0) continue;
      const node = this.ent[this.jEntS[j]];
      seeds.push(node, REGIONAL_TIME, conns.length);
      conns.push(j);
    }
    this.tripsInbound = 0;
    if (seeds.n === 0) return;
    roadSearch(g, g.fwd, this.nodeTime, S, this.heap, seeds, REGIONAL_TIME + 90, this.rampT);
    const dist = S.dist, src = S.src, done = S.done;
    const desire = new Float32Array(this.jB);
    const bestNode = new Int32Array(this.jB).fill(-1);
    const connSum = new Float64Array(conns.length);
    for (let j = 0; j < this.jB; j++) {
      const spare = this.jSlots[j] - Math.min(this.jSlots[j], this.jAsg[j]);
      if (spare <= 0) continue;
      let bd = Infinity, bn = -1;
      for (let e = this.jEntS[j], e1 = e + this.jEntC[j]; e < e1; e++) {
        const v = this.ent[e];
        if (done[v] === 1 && dist[v] < bd) { bd = dist[v]; bn = v; }
      }
      if (bn < 0) continue;
      const f = Math.max(0.2, Math.min(1, 1.3 - bd / 60));
      desire[j] = spare * REGIONAL_FILL * f;
      bestNode[j] = bn;
      connSum[src[bn]] += desire[j];
    }
    const scale = new Float32Array(conns.length);
    let capSum = 0;
    for (let k = 0; k < conns.length; k++) capSum += CONNECTION_WORKERS[this.jConnType[conns[k]]] * this.growth;
    const capMul = capSum > this.regionWorkerCap ? this.regionWorkerCap / capSum : 1;
    for (let k = 0; k < conns.length; k++) {
      const j = conns[k];
      const capW = CONNECTION_WORKERS[this.jConnType[j]] * this.growth * capMul;
      scale[k] = connSum[k] > capW ? capW / connSum[k] : 1;
    }
    const acc = this.acc;
    acc.fill(0, 0, g.n);
    const carPcu = 1 / CAR_OCCUPANCY;
    let tot = 0;
    const cand: number[] = [];
    for (let j = 0; j < this.jB; j++) {
      const bn = bestNode[j];
      if (bn < 0) continue;
      const inflow = desire[j] * scale[src[bn]];
      this.jInbound[j] = inflow;
      this.inboundById[this.jBid[j]] = inflow;
      this.jCar[j] += inflow; // regional commuters drive in (parking demand)
      acc[bn] += inflow * carPcu;
      tot += inflow;
      if (inflow > 0) cand.push(j);
    }
    accumulate(S, acc);
    this.commit(S, acc, this.volInbound, this.rampSF);
    this.tripsInbound = tot;
    // sample inbound routes (connection -> job)
    const K = Math.min(12, cand.length);
    for (let q = 0; q < K; q++) {
      const j = cand[Math.floor(this.rand() * cand.length)];
      const path = this.tracePath(S, bestNode[j], (v) => g.cellOf[v], true);
      if (path.length >= 2) this.pendingRoutes.push({ cells: path, kind: 'car', weight: tot / Math.max(1, K) });
    }
  }

  // ------------------------------------------------------------------------------------------ SHOP
  /** add cached per-node volumes into this cycle's volumes (shop / freight skipped this cycle) */
  private addCached(v: Float32Array): void {
    const n = this.road.n, volNew = this.volNew;
    for (let i = 0; i < n; i++) volNew[i] += v[i];
  }

  private shopping(): void {
    const g = this.road;
    if (!this.sfRecompute) { this.addCached(this.volShop); return; }
    this.volShop = growF32(this.volShop, g.n);
    this.volShop.fill(0, 0, g.n);
    const S = this.SB;
    const seeds = this.seeds;
    seeds.clear();
    for (let s = 0; s < this.sN; s++) for (let e = this.sEntS[s], e1 = e + this.sEntC[s]; e < e1; e++) seeds.push(this.ent[e], 0, s);
    this.tripsShop = 0;
    if (seeds.n === 0) return;
    roadSearch(g, g.rev, this.nodeTime, S, this.heap, seeds, 45, this.rampT);
    const dist = S.dist, src = S.src, done = S.done;
    const acc = this.acc;
    acc.fill(0, 0, g.n);
    const pcu = SHOP_PCU_WEIGHT / CAR_OCCUPANCY;
    let tot = 0;
    for (let o = 0; o < this.oN; o++) {
      let bd = Infinity, bn = -1;
      for (let e = this.oEntS[o], e1 = e + this.oEntC[o]; e < e1; e++) {
        const v = this.ent[e];
        if (done[v] === 1 && dist[v] < bd) { bd = dist[v]; bn = v; }
      }
      if (bn < 0) continue;
      const trips = this.oPop[o] * SHOP_TRIPS_PER_RES * Math.exp(-Math.max(0, bd - 8) / 20);
      const carShare = this.oShC[o] + this.oShW[o] + this.oShT[o] > 0 ? this.oShC[o] : 0.7;
      const walkish = bd < 3 ? 0.6 : 0;
      const car = trips * carShare * (1 - walkish);
      acc[bn] += car * pcu;
      this.sLoad[src[bn]] += trips;
      this.sCar[src[bn]] += car;
      tot += trips;
    }
    accumulate(S, acc);
    this.commit(S, acc, this.volShop, this.rampSF);
    this.tripsShop = tot;
  }

  // ------------------------------------------------------------------------------------------ FREIGHT
  private freight(): void {
    const g = this.road;
    if (!this.sfRecompute) { this.addCached(this.volFreight); return; }
    this.volFreight = growF32(this.volFreight, g.n);
    this.volFreight.fill(0, 0, g.n);
    this.sfVersion = g.version;
    this.truckRoutes = [];
    const S = this.SB;
    const seeds = this.seeds;
    seeds.clear();
    for (let k = 0; k < this.kN; k++) for (let e = this.kEntS[k], e1 = e + this.kEntC[k]; e < e1; e++) seeds.push(this.ent[e], this.kLabel[k], k);
    this.tripsFreight = 0;
    if (seeds.n === 0) {
      for (let f = 0; f < this.fN; f++) this.freightById[this.fBid[f]] = 0.15;
      return;
    }
    // trucks prefer highways (WP7-10): truck time x TRUCK_LOCAL_FACTOR off highways, congestion-priced ramps
    const tt = (this.truckTime = growF32(this.truckTime, g.n));
    for (let v = 0, type = g.type; v < g.n; v++) tt[v] = type[v] === Network.Highway ? this.nodeTime[v] : this.nodeTime[v] * TRUCK_LOCAL_FACTOR;
    roadSearch(g, g.rev, tt, S, this.heap, seeds, 150, this.rampT);
    const dist = S.dist, done = S.done;
    const acc = this.acc;
    acc.fill(0, 0, g.n);
    let tot = 0;
    const cand: number[] = [];
    const candNode: number[] = [];
    for (let f = 0; f < this.fN; f++) {
      let bd = Infinity, bn = -1;
      for (let e = this.fEntS[f], e1 = e + this.fEntC[f]; e < e1; e++) {
        const v = this.ent[e];
        if (done[v] === 1 && dist[v] < bd) { bd = dist[v]; bn = v; }
      }
      const bid = this.fBid[f];
      if (bn < 0) { this.freightById[bid] = 0.15; continue; }
      this.freightById[bid] = Math.max(0.3, Math.min(1, 1.25 - bd / 60));
      const trucks = this.fTrucks[f];
      acc[bn] += trucks * TRUCK_PCU;
      tot += trucks;
      cand.push(f);
      candNode.push(bn);
    }
    accumulate(S, acc);
    this.commit(S, acc, this.volFreight, this.rampSF);
    this.tripsFreight = tot;
    // trucks / day per road cell (Traffic overlay "Trucks", roadCellReport)
    if (this.truckCell.length !== g.C) this.truckCell = new Float32Array(g.C);
    this.truckCell.fill(0);
    for (let v = 0; v < g.n; v++) { const f = this.volFreight[v]; if (f > 0) this.truckCell[g.cellOf[v]] = f / TRUCK_PCU; }
    this.hasTruckData = true;
    // sample truck routes weighted by trucks
    const K = Math.min(20, cand.length);
    if (K > 0) {
      const cum = new Float64Array(cand.length);
      let s = 0;
      for (let q = 0; q < cand.length; q++) { s += this.fTrucks[cand[q]]; cum[q] = s; }
      for (let q = 0; q < K; q++) {
        const idx = lowerBound(cum, this.rand() * s);
        const path = this.tracePath(S, candNode[idx], (v) => g.cellOf[v], false);
        if (path.length >= 2) this.truckRoutes.push({ cells: path, kind: 'truck', weight: tot / K });
      }
    }
  }

  // ------------------------------------------------------------------------------------------ FREIGHT SINKS
  /**
   * critic item 18: throughput of each seaport / rail-linked freight station = trucks of the industries within
   * FREIGHT_SINK_MIN (truck time) of it — its own reverse search, so road neighbour connections do not shadow it; an
   * industry counts for its nearest such sink. Every 2nd cycle (with the freight pass).
   */
  private freightSinks(): void {
    const g = this.road, S = this.SB, seeds = this.seeds;
    seeds.clear();
    const K = this.sinkK.length;
    for (let q = 0; q < K; q++) {
      const k = this.sinkK[q];
      for (let e = this.kEntS[k], e1 = e + this.kEntC[k]; e < e1; e++) seeds.push(this.ent[e], 0, q);
    }
    const tot = new Float64Array(K);
    if (seeds.n > 0 && this.truckTime.length >= g.n) {
      roadSearch(g, g.rev, this.truckTime, S, this.heap, seeds, FREIGHT_SINK_MIN, this.rampT);
      const dist = S.dist, done = S.done, src = S.src;
      for (let f = 0; f < this.fN; f++) {
        let bd = Infinity, bn = -1;
        for (let e = this.fEntS[f], e1 = e + this.fEntC[f]; e < e1; e++) {
          const v = this.ent[e];
          if (done[v] === 1 && dist[v] < bd) { bd = dist[v]; bn = v; }
        }
        if (bn >= 0) tot[src[bn]] += this.fTrucks[f];
      }
      S.settled = 0; // scratch
    }
    for (let q = 0; q < K; q++) { const id = this.sinkIds[q]; if (id < this.sinkTrucksById.length) this.sinkTrucksById[id] = tot[q]; }
    this.sinksDone = true;
  }

  // ------------------------------------------------------------------------------------------ PARKING (WP7-7)
  /** parking raster from this cycle's car arrivals (job sites, shops) vs supply (zones, streets, civic lots, garages) */
  private parkingRaster(sim: Simulation): void {
    const st = sim.state, N = st.size, C = st.cells;
    if (this.parkD.length !== C) {
      this.parkD = new Float32Array(C); this.parkS = new Float32Array(C);
      this.parkTmpA = new Float32Array(C); this.parkTmpB = new Float32Array(C);
    }
    const D = this.parkD, S = this.parkS;
    D.fill(0);
    const inv = 1 / CAR_OCCUPANCY;
    for (let j = 0; j < this.jB; j++) { const b = this.jObj[j]; if (b) addFootprint(N, b, this.jCar[j] * inv, D); }
    for (let s = 0; s < this.sN; s++) { const b = this.sObj[s]; if (b) addFootprint(N, b, PARKING_SHOP_W * this.sCar[s] * inv, D); }
    baseSupply(st, S);
    for (let q = 0; q < this.gN; q++) {
      const b = st.buildings.get(this.gBid[q]);
      if (!b) continue;
      const spaces = GARAGE_DEFS[b.def] ?? GARAGE_SPACES;
      addGarageSupply(N, b, spaces - Math.min(spaces, this.gStop[q] >= 0 ? this.gLoad[q] : 0), S);
    }
    this.parkingSummary = computeParking(N, D, S, st.parking, this.parkTmpA, this.parkTmpB);
    sim.events.emit('layerUpdated', 'parking');
  }

  // ------------------------------------------------------------------------------------------ ATTACHMENT (WP7-6)
  /**
   * which stops serve and which freight stations reach the region — at cell level (independent of the assignment
   * cycle and its graphs), recomputed only after transport-building / road / tunnel / water changes:
   *  bus stop       a road cell 4-adjacent to the footprint
   *  subway         the tunnel component it touches (footprint + perimeter) holds >= 2 subway stations
   *  train          the rail component it touches (perimeter) holds >= 2 train stations or reaches the map edge
   *  freight        its rail component reaches the map edge or a seaport (freight train route = BFS path there)
   *  ferry          linked to at least one partner terminal (ferry.ts)
   */
  private refreshAttach(st: CityState): void {
    if (!this.attachDirty && this.attachFor === st) return;
    this.attachDirty = false;
    this.attachFor = st;
    const N = st.size, C = st.cells, net = st.network, flags = st.netFlags, sub = st.subway;
    this.attach.clear();
    this.lineInfo.clear();
    this.freightLink.clear();
    this.freightPaths.clear();
    const bus: Building[] = [], subs: Building[] = [], trains: Building[] = [], freights: Building[] = [], ports: Building[] = [], ferries: Building[] = [];
    // the transit buildings: prep's index (+ building events since); a state prep has not scanned: every building
    if (this.transportFor !== st) {
      this.transportB.clear();
      for (const b of st.buildings.values()) if (infoOf(st, b).transit !== Transit.None) this.transportB.set(b.id, b);
      this.transportFor = st;
    }
    for (const b of this.transportB.values()) {
      if (st.buildings.get(b.id) !== b) continue; // removed / replaced since
      const t = infoOf(st, b).transit;
      if (t === Transit.None) continue;
      if (!isFunctional(b)) { if (isStopMode(t)) this.attach.set(b.id, 0); continue; }
      if (t === Transit.Bus) bus.push(b);
      else if (t === Transit.Subway) subs.push(b);
      else if (t === Transit.Train) trains.push(b);
      else if (t === Transit.Freight) freights.push(b);
      else if (t === Transit.Seaport) ports.push(b);
      else if (t === Transit.Ferry) ferries.push(b);
    }
    const isRoad = (i: number) => net[i] >= Network.Street && net[i] <= Network.Highway;
    for (const b of bus) this.attach.set(b.id, touches(N, b, isRoad, false) >= 0 ? 1 : 0);
    // subway lines
    if (subs.length > 0) {
      if (this.attachSubVer !== this.netVer || this.attachSubwayComp.length !== C) {
        this.attachSubwayComp = labelCells(C, N, (i) => sub[i] !== 0, this.attachSubwayComp);
        this.attachSubVer = this.netVer;
      }
      const comp = this.attachSubwayComp;
      const cnt = new Map<number, number>();
      const compsOf = subs.map((b) => touchedComps(N, b, comp, true));
      for (const cs of compsOf) for (const c of cs) cnt.set(c, (cnt.get(c) ?? 0) + 1);
      subs.forEach((b, k) => {
        const n = compsOf[k].reduce((m, c) => Math.max(m, cnt.get(c) ?? 0), 0);
        this.attach.set(b.id, n >= 2 ? 1 : 0);
        this.lineInfo.set(b.id, { stations: n, edge: false });
      });
    }
    // rail lines (level crossings are rail too); border rail cells lead to the region; rail next to a seaport
    if (trains.length + freights.length > 0) {
      const isRail = (i: number) => net[i] === Network.Rail || (flags[i] & NETFLAG_CROSSING) !== 0;
      if (this.attachRailVer !== this.netVer || this.attachRailComp.length !== C) {
        this.attachRailComp = labelCells(C, N, isRail, this.attachRailComp);
        this.attachRailVer = this.netVer;
      }
      const comp = this.attachRailComp;
      const target = new Uint8Array(C);
      const border = new Set<number>(), port = new Set<number>();
      for (let t = 0; t < N; t++) {
        for (const i of [t, (N - 1) * N + t, t * N, t * N + N - 1]) if (comp[i] >= 0) { border.add(comp[i]); target[i] = 1; }
      }
      for (const c of st.neighborConnections ?? []) {
        if (c.x < 0 || c.z < 0 || c.x >= N || c.z >= N) continue;
        const i = c.z * N + c.x;
        if (comp[i] >= 0) { border.add(comp[i]); target[i] = 1; }
      }
      for (const p of ports) forPerimeter(N, p, (i) => { if (comp[i] >= 0) { port.add(comp[i]); target[i] = 1; } });
      const cnt = new Map<number, number>();
      const compsOf = trains.map((b) => touchedComps(N, b, comp, false));
      for (const cs of compsOf) for (const c of cs) cnt.set(c, (cnt.get(c) ?? 0) + 1);
      trains.forEach((b, k) => {
        const n = compsOf[k].reduce((m, c) => Math.max(m, cnt.get(c) ?? 0), 0);
        const edge = compsOf[k].some((c) => border.has(c));
        this.attach.set(b.id, n >= 2 || edge ? 1 : 0);
        this.lineInfo.set(b.id, { stations: n, edge });
      });
      const cells = new Set<number>();
      for (const b of freights) {
        const cs = touchedComps(N, b, comp, false);
        const ok = cs.some((c) => border.has(c) || port.has(c));
        this.freightLink.set(b.id, ok ? 1 : 0);
        if (!ok) continue;
        const path = railPath(N, b, comp, target);
        if (path) { this.freightPaths.set(b.id, path); for (const c of path) cells.add(c); }
      }
      this.freightRail = Int32Array.from([...cells].sort((a, b) => a - b));
    } else this.freightRail = new Int32Array(0);
    // ferries
    this.ferryTerms = ferries.map((b) => ({ id: b.id, x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot }));
    // (water changes come with terrainChanged / reset: terrainVer)
    const fkey = ferries.length === 0 ? '' : this.ferryTerms.map((f) => `${f.id}@${f.x},${f.z},${f.w},${f.d},${f.rot}`).join(';') + '|' + this.terrainVer;
    if (fkey !== this.ferryKey) {
      this.ferryKey = fkey;
      this.ferryNet = ferries.length === 0 ? { links: [], partners: new Map() } : computeFerryNet(st, this.ferryTerms);
    }
    for (const b of ferries) this.attach.set(b.id, (this.ferryNet.partners.get(b.id)?.length ?? 0) > 0 ? 1 : 0);
  }

  // ------------------------------------------------------------------------------------------ SAVE / LOAD (WP7b)
  /** persisted WP7b state (systemData.infraTransport) so the first post-load assignment continues the saved one */
  private restoreTransport(st: CityState): void {
    this.busNeed.clear();
    this.garageLoad.clear();
    this.stLoadPrev.clear();
    this.rampVolCell = new Float32Array(st.cells);
    const d = st.systemData.infraTransport as TransportSave | undefined;
    if (!d || typeof d !== 'object') return;
    const pairs = (a: unknown, into: Map<number, number>) => {
      if (!Array.isArray(a)) return;
      for (const e of a) if (Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'number' && isFinite(e[1])) into.set(e[0], e[1]);
    };
    pairs(d.busNeed, this.busNeed);
    pairs(d.garageLoad, this.garageLoad);
    pairs(d.stopLoad, this.stLoadPrev);
    const rc = d.rampCells, rv = d.rampVol;
    if (rc && rv && rc.length === rv.length) for (let k = 0; k < rc.length; k++) { const c = rc[k]; if (c >= 0 && c < st.cells) this.rampVolCell[c] = rv[k]; }
    const pq = d.parkingQ;
    if (pq && pq.length === st.cells) for (let i = 0; i < st.cells; i++) st.parking[i] = pq[i] / 255;
  }

  private saveTransport(st: CityState): void {
    const f = Math.fround;
    const rc: number[] = [], rv: number[] = [];
    const rvc = this.rampVolCell, g = this.road;
    // ramp flows live on road cells only: scan the road nodes, not the map
    if (g.N === st.size) for (let v = 0; v < g.n; v++) { const c = g.cellOf[v]; if (rvc[c] > 0.5) { rc.push(c); rv.push(rvc[c]); } }
    const prev = st.systemData.infraTransport as TransportSave | undefined;
    let pq = prev?.parkingQ;
    // the parking raster changes on the cycles that recompute it (every 2nd): re-quantise then only
    if (!(pq instanceof Uint8Array) || pq.length !== st.cells || this.sfRecompute) {
      if (!(pq instanceof Uint8Array) || pq.length !== st.cells) pq = new Uint8Array(st.cells);
      const P = st.parking;
      for (let i = 0; i < st.cells; i++) pq[i] = Math.round(Math.max(0, Math.min(1, P[i])) * 255);
    }
    const save: TransportSave = {
      v: 1,
      busNeed: [...this.busNeed].map(([k, v]) => [k, f(v)]),
      garageLoad: [...this.garageLoad].map(([k, v]) => [k, f(v)]),
      stopLoad: [...this.stLoadPrev].map(([k, v]) => [k, f(v)]),
      rampCells: Int32Array.from(rc),
      rampVol: Float32Array.from(rv),
      parkingQ: pq,
    };
    st.systemData.infraTransport = save;
  }

  // ------------------------------------------------------------------------------------------ FINAL
  private finalize(sim: Simulation): void {
    const st = sim.state;
    const g = this.road;
    const n = g.n;
    const C = st.cells;
    const net = st.network;
    const traffic = st.traffic, congestion = st.congestion;
    // MSA blend with previous volumes (per cell)
    const alpha = Math.max(MSA_MIN_ALPHA, 1 / (this.iter + 1));
    this.iter++;
    const blended = this.acc; // reuse
    for (let v = 0; v < n; v++) {
      const c = g.cellOf[v];
      blended[v] = traffic[c] * (1 - alpha) + this.volNew[v] * alpha;
    }
    const railN = this.rail.n;
    for (let v = 0; v < railN; v++) this.railNew[v] = traffic[this.rail.cellOf[v]] * (1 - alpha) + this.railNew[v] * alpha;
    // interchange (ramp) flows: MSA per cell like the volumes (WP7-10)
    {
      const rv = this.rampVolCell, rn = this.rampNew, cellOf = g.cellOf, type = g.type;
      for (let v = 0; v < n; v++) {
        if (type[v] === Network.Highway) continue;
        const c = cellOf[v];
        const x = rv[c] * (1 - alpha) + rn[v] * alpha;
        rv[c] = x > 1e-3 ? x : 0;
      }
    }
    traffic.fill(0);
    congestion.fill(0);
    let congSum = 0, congN = 0;
    for (let v = 0; v < n; v++) {
      const c = g.cellOf[v];
      if (!(net[c] >= Network.Street && net[c] <= Network.Highway)) continue;
      const vol = blended[v];
      traffic[c] = vol;
      const r = vol / g.cap[v];
      congestion[c] = r;
      if (vol > 1) { congSum += r > 1 ? 1 : r; congN++; }
    }
    // rail riders
    for (let v = 0; v < this.rail.n; v++) {
      const c = this.rail.cellOf[v];
      if (net[c] !== Network.Rail) continue;
      traffic[c] = this.railNew[v];
      congestion[c] = traffic[c] / NET_CAPACITY[Network.Rail];
    }
    if (this.subwayRiders.length !== C) this.subwayRiders = new Float32Array(C);
    this.subwayRiders.fill(0);
    for (let v = 0; v < this.subway.n; v++) this.subwayRiders[this.subway.cellOf[v]] = this.subNew[v];
    // stop loads for crowding
    this.stLoadPrev.clear();
    for (let s = 0; s < this.stops.n; s++) {
      const bid = this.stops.bid[s];
      this.stLoadPrev.set(bid >= 0 ? bid : -1 - this.stops.cell[s], this.stLoad[s]);
    }
    // stats
    const stats = st.stats;
    stats.tripsCar = Math.round(this.tripsCar);
    stats.tripsTransit = Math.round(this.tripsTransit);
    stats.tripsWalk = Math.round(this.tripsWalk);
    stats.avgCommute = this.commuteW > 0 ? this.commuteSum / this.commuteW : 0;
    stats.avgTraffic = congN > 0 ? congSum / congN : 0;
    // WP7b fleet / park & ride / ferries
    const tf = stats.transitFleet;
    let buses = 0, need = 0;
    for (const d of this.depots) { buses += d.fleet; need += d.need; }
    if (this.minibus.stops > 0) { buses += MINIBUS_FLEET; need += this.minibus.need; }
    tf.buses = Math.round(buses);
    tf.busesNeeded = Math.round(need * 10) / 10;
    let spaces = 0;
    // (park & ride spaces: garages whose stop's riders ride; walk-only garages are plain parking)
    for (let q = 0; q < this.gN; q++) if (this.gStop[q] >= 0 && this.gRide[q] === 1) spaces += GARAGE_DEFS[st.buildings.get(this.gBid[q])?.def ?? ''] ?? GARAGE_SPACES;
    tf.parkRide = Math.round(this.prRiders);
    tf.parkRideSpaces = spaces;
    tf.ferryRiders = Math.round(this.ferryRiders);
    tf.ferryLinks = this.ferryNet.links.length;
  }

  /** per-building outputs, flags, commute layer, sample routes */
  private finalize2(sim: Simulation): void {
    const st = sim.state;
    const g = this.road;
    const n = g.n;
    const congestion = st.congestion;
    const commute = st.commute;
    commute.fill(0);
    const changed: Building[] = [];
    for (let o = 0; o < this.oN; o++) {
      const bid = this.oBid[o];
      const b = st.buildings.get(bid);
      if (!b) continue;
      // smooth per-building outputs across assignments (destination noise varies per cycle)
      const prevA = this.accessById[bid];
      const emp = prevA >= 0 && this.cycles > 0 ? prevA + (this.oEmp[o] - prevA) * RESULT_SMOOTH : this.oEmp[o];
      const prevT = this.commuteById[bid];
      const t = prevT > 0 && this.oTime[o] > 0 ? prevT + (this.oTime[o] - prevT) * RESULT_SMOOTH : this.oTime[o];
      this.accessById[bid] = emp;
      this.commuteById[bid] = t;
      this.reachedById[bid] = this.oW[o] * emp;
      const sc = this.oShC[o], stt = this.oShT[o], sw = this.oShW[o];
      this.modeById[bid] = sc + stt + sw <= 0 ? 0 : sc >= stt && sc >= sw ? 1 : stt >= sw ? 2 : 3;
      for (let z: number = b.z; z < b.z + b.d; z++) for (let x: number = b.x; x < b.x + b.w; x++) {
        const i = z * st.size + x;
        if (st.building[i] === bid) commute[i] = t;
      }
      const noJobs = b.pop > 0 && emp < 0.35;
      let f = setFlagQuiet(b, BF.NoJobs, noJobs);
      const cn = this.oCarNode[o];
      const cong = cn >= 0 && cn < n ? congestion[g.cellOf[cn]] : 0;
      f = setFlagQuiet(b, BF.Congested, cong > 1) || f;
      if (f) changed.push(b);
    }
    for (let j = 0; j < this.jB; j++) {
      const bid = this.jBid[j];
      const b = st.buildings.get(bid);
      if (!b) continue;
      const slots = this.jSlots[j];
      const local = Math.min(this.jAsg[j], slots);
      const arriving = local + this.jInbound[j];
      const fill = Math.min(1, arriving / Math.max(1, slots));
      const prevF = this.jobFillById[bid];
      this.jobFillById[bid] = prevF >= 0 && this.cycles > 0 ? prevF + (fill - prevF) * RESULT_SMOOTH : fill;
      this.reachedById[bid] = arriving;
      this.carsById[bid] = this.jCar[j];
      this.commuteById[bid] = this.jAsg[j] > 0 ? this.jTimeSum[j] / this.jAsg[j] : this.jInbound[j] > 0 ? REGIONAL_TIME + 10 : 0;
      this.modeById[bid] = arriving > 0 ? 1 : 0;
      let cong = 0;
      for (let e = this.jEntS[j], e1 = e + this.jEntC[j]; e < e1; e++) {
        const c = congestion[g.cellOf[this.ent[e]]];
        if (c > cong) cong = c;
      }
      if (setFlagQuiet(b, BF.Congested, cong > 1.1)) changed.push(b);
    }
    if (this.sfRecompute) for (let s = 0; s < this.sN; s++) this.customersById[this.sBid[s]] = this.sLoad[s];
    for (const b of changed) sim.events.emit('buildingChanged', b);
    // sample routes
    this.buildSampleRoutes(st);
    this.serviceRoutes = this.serviceRoutes.filter((s) => s.until >= st.day);
    this.cycles++;
    this.saveTransport(st);
    sim.events.emit('layerUpdated', 'traffic');
  }

  private tracePath(S: Search, start: number, cellOf: (v: number) => number, reverse: boolean, stopAt?: (v: number) => boolean): Uint32Array {
    const out: number[] = [];
    let v = start;
    let guard = 0;
    while (v >= 0 && guard++ < 4096) {
      if (stopAt && out.length > 0 && stopAt(v)) break;
      out.push(cellOf(v));
      v = S.next[v];
    }
    if (reverse) out.reverse();
    return Uint32Array.from(out);
  }

  private buildSampleRoutes(st: CityState): void {
    const g = this.road;
    const routes: SampleRoute[] = [];
    // cars (sampled per matching round + inbound) and trucks (from the last freight pass)
    for (const r of this.pendingRoutes) routes.push(r);
    for (const r of this.truckRoutes) routes.push(r);
    // transit: bus segments on roads, train segments on rail
    const T = this.tnet;
    if (T && this.tripsTransit > 0) {
      const cum = new Float64Array(this.oN);
      let s = 0;
      for (let o = 0; o < this.oN; o++) { s += this.oBoard[o] >= 0 ? this.oW[o] * this.oShT[o] : 0; cum[o] = s; }
      const k = Math.min(24, this.oN);
      const railCell = (v: number) => this.rail.cellOf[v - T.nR];
      for (let q = 0; q < k && s > 0; q++) {
        const o = lowerBound(cum, this.rand() * s);
        let v = this.oBoard[o];
        let guard = 0;
        let seg: number[] = [];
        let segKind = -1;
        const flush = () => {
          if (seg.length >= 3 && (segKind === 0 || segKind === 1)) {
            routes.push({ cells: Uint32Array.from(seg), kind: segKind === 0 ? 'bus' : 'train', weight: this.tripsTransit / k });
          }
          seg = [];
        };
        while (v >= 0 && guard++ < 4096) {
          const kind = v < T.nR ? 0 : v < T.nR + T.nRail ? 1 : 2;
          if (kind !== segKind) { flush(); segKind = kind; }
          if (kind === 0) seg.push(g.cellOf[v]);
          else if (kind === 1) seg.push(railCell(v));
          else seg.push(this.subway.cellOf[v - T.nR - T.nRail]);
          v = this.ST.next[v];
        }
        flush();
      }
    }
    // freight trains: freight stations to rail connections (BFS on rail graph)
    this.freightTrainRoutes(st, routes);
    // service patrols (police / garbage) as short random walks from service buildings
    this.patrolRoutes(st, routes);
    this.routes = routes;
    this.pendingRoutes = [];
  }

  private freightTrainRoutes(st: CityState, routes: SampleRoute[]): void {
    const rail = this.rail;
    if (rail.n === 0) return;
    const targets = new Set<number>();
    for (const c of this.conns) if (c.type === Network.Rail) { const rn = rail.nodeOfCell[c.cell]; if (rn >= 0) targets.add(rn); }
    const tmp = new Int32Array(4);
    let count = 0;
    for (const id of this.stationIds) {
      const b = st.buildings.get(id);
      if (count >= 4) break;
      if (!b) continue;
      const inf = infoOf(st, b);
      if (inf.transit !== Transit.Freight && inf.transit !== Transit.Train) continue;
      if (!isFunctional(b)) continue;
      if (inf.transit === Transit.Freight) {
        // WP7-10: freight trains only run from rail-linked stations, along their cached route (freightRailCells)
        const fp = this.freightPaths.get(id);
        if (fp && fp.length >= 3) { routes.push({ cells: fp, kind: 'train', weight: 20 }); count++; }
        continue;
      }
      if (this.attach.get(id) !== 1) continue;
      const c = perimeterNodes(rail.nodeOfCell, st.size, b, tmp, 0, 4);
      if (c === 0) continue;
      const path = this.railBfs(tmp[0], targets, inf.transit === Transit.Train);
      if (path && path.length >= 3) {
        routes.push({ cells: path, kind: 'train', weight: 40 });
        count++;
      }
    }
  }

  /** BFS on rail from node a to any node in targets (or, if toStations, to another station's rail node / longest reach) */
  private railBfs(a: number, targets: Set<number>, _passenger: boolean): Uint32Array | null {
    const rail = this.rail;
    const n = rail.n;
    const par = new Int32Array(n).fill(-2);
    const q = new Int32Array(n);
    let qh = 0, qt = 0;
    q[qt++] = a;
    par[a] = -1;
    let hit = -1;
    let last = a;
    while (qh < qt) {
      const u = q[qh++];
      last = u;
      if (u !== a && targets.has(u)) { hit = u; break; }
      for (let k = 0; k < 4; k++) {
        const v = rail.adj[u * 4 + k];
        if (v < 0 || par[v] !== -2) continue;
        par[v] = u;
        q[qt++] = v;
      }
    }
    const end = hit >= 0 ? hit : last;
    if (end === a) return null;
    const out: number[] = [];
    for (let v = end; v >= 0; v = par[v]) out.push(rail.cellOf[v]);
    out.reverse();
    return Uint32Array.from(out);
  }

  private patrolRoutes(st: CityState, routes: SampleRoute[]): void {
    const g = this.road;
    if (g.n === 0) return;
    const tmp = new Int32Array(4);
    let count = 0;
    // up to 10 patrols from a rotating subset of police / health / garbage buildings
    const ids = this.patrolIds;
    const start = ids.length > 0 ? Math.floor(this.rand() * ids.length) : 0;
    for (let q = 0; q < ids.length && count < 10; q++) {
      const b = st.buildings.get(ids[(start + q) % ids.length]);
      if (!b || !isFunctional(b)) continue;
      if (perimeterNodes(g.nodeOfCell, st.size, b, tmp, 0, 1) === 0) continue;
      let v = tmp[0];
      let prev = -1;
      const cells: number[] = [g.cellOf[v]];
      for (let s = 0; s < 48; s++) {
        let choices = 0;
        let pick = -1;
        for (let k = 0; k < 4; k++) {
          const w = g.fwd[v * 4 + k];
          if (w < 0 || w === prev) continue;
          choices++;
          if (this.rand() * choices < 1) pick = w;
        }
        if (pick < 0) pick = prev;
        if (pick < 0) break;
        prev = v;
        v = pick;
        cells.push(g.cellOf[v]);
      }
      if (cells.length >= 4) {
        // WP7-12 model hints (a pure function of the station's def): police patrols drive police cars, garbage rounds
        // garbage trucks. Health buildings are still walked and counted (the rand() draws stay the same) but push no
        // route: ambulances are WP8's real emergency vehicles.
        const inf = infoOf(st, b);
        const model = inf.cov === 0 ? 'car_police' : inf.garbageCap > 0 ? 'garbage_truck' : '';
        if (model) routes.push({ cells: Uint32Array.from(cells), kind: 'service', weight: 2, model });
        count++;
      }
    }
  }
}

/** persisted WP7b state (systemData.infraTransport) */
interface TransportSave {
  v: number;
  /** smoothed needed buses per depot id (-1 = minibus pool) */
  busNeed: [number, number][];
  /** park & ride cars per garage id */
  garageLoad: [number, number][];
  /** riders per stop key (building id, -1 - cell for road-flag stops) */
  stopLoad: [number, number][];
  /** smoothed ramp flow per ramp cell */
  rampCells: Int32Array;
  rampVol: Float32Array;
  /** parking pressure x 255 per cell */
  parkingQ: Uint8Array;
}

/** traffic system of a city state (transportUseFactor / truckVolumeOf only receive the state; registry in transit.ts) */
export function trafficOfState(st: CityState): TrafficSystem | undefined {
  return TRAFFIC_OF_STATE.get(st) as TrafficSystem | undefined;
}

/** interchange minutes of a non-highway cell next to a highway (class x congestion of its ramp flow) */
export function rampTime(type: number, vol: number): number {
  const base = RAMP_BY_NET[type] ?? RAMP_PENALTY;
  const r = vol / RAMP_CAP;
  const f = 1 + RAMP_ALPHA * r * r * r * r;
  return base * (f < RAMP_MAX_FACTOR ? f : RAMP_MAX_FACTOR);
}

/** calls fn for every map cell 4-adjacent to a footprint (outside it) */
function forPerimeter(N: number, b: Pick<Building, 'x' | 'z' | 'w' | 'd'>, fn: (i: number) => void): void {
  const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d;
  for (let x = x0; x < x1; x++) {
    if (x < 0 || x >= N) continue;
    if (z0 - 1 >= 0) fn((z0 - 1) * N + x);
    if (z1 < N) fn(z1 * N + x);
  }
  for (let z = z0; z < z1; z++) {
    if (z < 0 || z >= N) continue;
    if (x0 - 1 >= 0) fn(z * N + x0 - 1);
    if (x1 < N) fn(z * N + x1);
  }
}

/** first perimeter (or, with `inside`, footprint) cell matching pred; -1 none */
function touches(N: number, b: Pick<Building, 'x' | 'z' | 'w' | 'd'>, pred: (i: number) => boolean, inside: boolean): number {
  let hit = -1;
  forPerimeter(N, b, (i) => { if (hit < 0 && pred(i)) hit = i; });
  if (hit >= 0 || !inside) return hit;
  for (let z = Math.max(0, b.z); z < Math.min(N, b.z + b.d); z++) for (let x = Math.max(0, b.x); x < Math.min(N, b.x + b.w); x++) {
    const i = z * N + x;
    if (pred(i)) return i;
  }
  return -1;
}

/** distinct component ids (comp[i] >= 0) a footprint touches (perimeter, + footprint with `inside`) */
function touchedComps(N: number, b: Pick<Building, 'x' | 'z' | 'w' | 'd'>, comp: Int32Array, inside: boolean): number[] {
  const out: number[] = [];
  const add = (i: number) => { const c = comp[i]; if (c >= 0 && !out.includes(c)) out.push(c); };
  forPerimeter(N, b, add);
  if (inside) for (let z = Math.max(0, b.z); z < Math.min(N, b.z + b.d); z++) for (let x = Math.max(0, b.x); x < Math.min(N, b.x + b.w); x++) add(z * N + x);
  return out;
}

/** 4-connected components of the cells matching pred: out[i] = component id, -1 elsewhere */
function labelCells(C: number, N: number, pred: (i: number) => boolean, out: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> {
  const comp = out.length === C ? out : new Int32Array(C);
  comp.fill(-2);
  const stack = new Int32Array(C);
  let nc = 0;
  for (let s = 0; s < C; s++) {
    if (comp[s] !== -2) continue;
    if (!pred(s)) { comp[s] = -1; continue; }
    let sp = 0;
    stack[sp++] = s;
    comp[s] = nc;
    while (sp > 0) {
      const u = stack[--sp];
      const x = u % N;
      for (let k = 0; k < 4; k++) {
        const v = k === 0 ? (x > 0 ? u - 1 : -1) : k === 1 ? (x < N - 1 ? u + 1 : -1) : k === 2 ? u - N : u + N;
        if (v < 0 || v >= C || comp[v] !== -2) continue;
        if (!pred(v)) { comp[v] = -1; continue; }
        comp[v] = nc;
        stack[sp++] = v;
      }
    }
    nc++;
  }
  return comp;
}

/** BFS over rail cells (comp >= 0) from a station's perimeter rail cells to the nearest target cell: path cells */
function railPath(N: number, b: Pick<Building, 'x' | 'z' | 'w' | 'd'>, comp: Int32Array, target: Uint8Array): Uint32Array | null {
  const C = N * N;
  const par = new Int32Array(C).fill(-2);
  const q = new Int32Array(C);
  let qh = 0, qt = 0;
  forPerimeter(N, b, (i) => { if (comp[i] >= 0 && par[i] === -2) { par[i] = -1; q[qt++] = i; } });
  let hit = -1;
  while (qh < qt) {
    const u = q[qh++];
    if (target[u]) { hit = u; break; }
    const x = u % N;
    for (let k = 0; k < 4; k++) {
      const v = k === 0 ? (x > 0 ? u - 1 : -1) : k === 1 ? (x < N - 1 ? u + 1 : -1) : k === 2 ? u - N : u + N;
      if (v < 0 || v >= C || comp[v] < 0 || par[v] !== -2) continue;
      par[v] = u;
      q[qt++] = v;
    }
  }
  if (hit < 0) return null;
  const out: number[] = [];
  for (let v = hit; v >= 0; v = par[v]) out.push(v);
  out.reverse();
  return Uint32Array.from(out);
}

function lowerBound(cum: Float64Array, x: number): number {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** the traffic system instance of a simulation (or undefined when infra systems are not installed) */
export function getTraffic(sim: Simulation): TrafficSystem | undefined {
  return sim.getSystem<TrafficSystem>('traffic');
}
