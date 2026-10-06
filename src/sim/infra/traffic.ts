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
 *  riders     an origin boards only at a stop whose transit-forest path rides a vehicle (bus on roads, rail, subway,
 *             ferry crossing): a stop whose best path is "walk to a job beside it" carries no riders (its residents
 *             walk or drive; stopLoad().walkers counts them for the report). Riders / bus need / tripsTransit are rides.
 *  buses      depots run DEPOT_BUSES each for the stops within DEPOT_RANGE road tiles (multi-source BFS on road / depot
 *             change); stops no depot reaches share MINIBUS_FLEET minibuses; rho = fleet / (riders / RIDERS_PER_BUS)
 *             in [BUS_RHO_MIN, BUS_RHO_MAX] divides the bus base wait (prepTransit). Stop loads are smoothed across
 *             assignments (STOP_LOAD_SMOOTH): the crowding wait reads them. stats.transitFleet counts the fleets that
 *             serve stops; busesShort = sum over the pools (depots, minibuses) of max(0, need - fleet).
 *  ferries    ferry nodes in the transit net (links = transfer edges, steps x FERRY_TIME_PER_CELL minutes).
 *  P&R        PH_PARKRIDE: K-label reverse road search (search.ts SearchK, K = PR_OPTIONS) from park & ride garages
 *             (garage within PR_STOP_RADIUS of an attached stop whose path rides; it keeps that stop unless another is
 *             clearly faster, PR_STOP_KEEP, and stays park & ride while under PR_DOWNTOWN_SHARE of its recent assignments
 *             ride nothing — a walk within PR_DOWNTOWN_TIE minutes of its last ride counts as a ride) labelled with
 *             the stop's transit minutes (no price: the option sets do not move with the prices): every origin gets
 *             its PR_OPTIONS fastest garage groups within PR_CAR_LEG_MAX free-flow minutes and PR_OPTION_MARGIN minutes
 *             of its fastest. The transit option is min(walk to a stop, the best park &
 *             ride option by minutes + price); its park & ride riders split over the options (logit on minutes +
 *             price, PR_GARAGE_BETA), each part takes its group's free room and the rest fills the other options' free
 *             room, fastest first; what still does not fit re-splits without park & ride. Car legs flow on the K-label
 *             forest, riders join the transit forest at the garage's stop. The price per group (a choice weight, not
 *             travel time) follows the logit demand (tatonnement), so loads settle at the room. Garages at the same
 *             stop within GARAGE_GROUP_CELLS pool their room and price. Room = spaces minus the reserve for the
 *             businesses around the garage (spaces x min(1, the parking pressure they feel without park & ride
 *             garages / PR_RESERVE_FULL), at most PR_RESERVE_SPREAD x the cars they lack, none below PR_RESERVE_MIN x
 *             spaces; parkingRaster): local parkers first. A garage by a downtown stop (riders walk to jobs nearby) is
 *             parking only: its spaces ease the blocks around it (parking.ts).
 *  car-less   carlessShare(b) of each origin pays CARLESS_EXTRA_MIN more by car and park & ride (taxi / lift);
 *             routeInfo().carless / carlessMin show it.
 *  parking    PH_PARKING (every 2nd cycle): parking.ts raster from car arrivals vs supply, blended with the previous
 *             raster (PARKING_BLEND); car commuters to a site pay PARKING_MIN x parking(site).
 *  ramps      traffic's searches charge RAMP_BY_NET x congestion of the interchange (ramp flow per non-highway cell next
 *             to a highway, MSA smoothed with floor RAMP_MSA_MIN) instead of the flat RAMP_PENALTY; roadCellReport shows
 *             the interchange load.
 *  trucks     truck time x TRUCK_LOCAL_FACTOR off highways; trucks / day per road cell (truckVolume); PH_SINKS: trucks
 *             within FREIGHT_SINK_MIN of a seaport / rail-linked freight station (sinkTrucks) — every 2nd cycle one sink's
 *             own reverse search (unknown sinks first, then round-robin), so each counts every industry within reach;
 *             freight trains run from rail-linked freight stations to the map edge / a seaport (freightRailCells).
 * Persistent (systemData.infraTransport): smoothed bus need per depot, stop loads, garage loads, prices, reserves and
 * stops, ramp flows, parking (u8), the job-matching prices, the matching RNG, the assignment count and the MSA
 * iteration, so the first post-load assignment continues where the save left off.
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
  DEPOT_UNPOWERED, FERRY_TIME_PER_CELL, FREIGHT_SINK_MIN, GARAGE_SPACES, MINIBUS_FLEET,
  PARKING_BLEND, PARKING_MIN, PARKING_SHOP_W, PR_CAR_LEG_MAX, PR_HOME_MIN, PR_LEG_SEARCH, PR_LIMIT, PR_PARK_MIN, PR_PRICE_MAX,
  PR_PRICE_STEP, PR_STOP_RADIUS, GARAGE_GROUP_CELLS, RAMP_ALPHA, RAMP_BY_NET, RAMP_CAP, RAMP_MAX_FACTOR, RAMP_MSA_MIN, RIDERS_PER_BUS,
  STOP_CAP_FERRY, STOP_LOAD_SMOOTH, TRUCK_LOCAL_FACTOR, WAIT_FERRY, PR_GARAGE_BETA, PR_RESERVE_FULL, PR_RESERVE_SMOOTH, PR_RESERVE_SPREAD, PR_STOP_KEEP,
  PR_DOWNTOWN_SHARE, PR_DOWNTOWN_SMOOTH, PR_DOWNTOWN_TIE, PR_OPTIONS, PR_OPTION_MARGIN, PR_OPTION_TAPER, PR_RESERVE_MIN,
} from './params';
import { schedulerOf, type InfraTask } from './scheduler';
import { REGION_JOBS_FOR_RESIDENTS } from '../economy/tuning';
import { carlessShare, workerShare } from '../economy/demographics';
import { Search, SearchK, Seeds, accumulate, roadSearch, transitSearch, type TransitNet } from './search';
import { TRAFFIC_OF_STATE, collectStops, isStopMode, type StopList } from './transit';
import { getDef } from '../catalog';
import { computeFerryNet, ferryPartnersAt, type FerryLink, type FerryNet, type FerryPartner, type FerryTerminal } from './ferry';
import {
  addFootprint, addGarageSupply, baseSupply, garageRelief, garageShortage, parkingBox, parkingFromBoxes, parkingOver, type ParkingSummary,
} from './parking';

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
  /** residential (WP7-8): share of the workers without a car (demographics carlessShare) — they pay CARLESS_EXTRA_MIN
   *  by car / park & ride (taxi, lift) */
  carless?: number;
  /** residential: extra commute minutes of those car-less workers vs their car-owning neighbours (last assignments) */
  carlessMin?: number;
}

/** stats.transitFleet with the optional WP7b field (CityState's TransitFleetStats plus busesShort) */
export interface TransitFleetStatsX {
  buses: number;
  busesNeeded: number;
  parkRide: number;
  parkRideSpaces: number;
  ferryRiders: number;
  ferryLinks: number;
  /** sum over the bus pools (each depot, the minibus pool) of max(0, buses needed - buses): a shortage a surplus
   *  elsewhere does not hide (the bot's depot rule, the busFleetShort advisor) */
  busesShort?: number;
}

/** TrafficSystem.garageReach: the park & ride choices of the homes nearest to a garage (its idle hint) */
export interface GarageReach {
  /** workers within a PR_CAR_LEG_MAX drive of it, and the homes there (with residents or not: "no commuters") */
  workers: number;
  homes: number;
  /** r4: the garage that took most of their overflow in the last assignment (another group; -1 none), and the share of
   *  their workers whose riders overflowed anywhere */
  ovTo: number;
  ovShare: number;
  /** the garage id the nearest half of them pick first (another group; -1 none), and one of their options with room */
  via: number;
  viaRoom: number;
  /** minutes park & ride from here would add for them vs their first pick */
  slower: number;
  /** their mean number of park & ride options, and of those in other groups than this garage's; the share for which this
   *  garage's group is a full-weight option; the share whose options are all full */
  options: number;
  others: number;
  own: number;
  full: number;
  /** their options of other groups (ids, the most picked first, each picked by >= 10 % of the top one's workers), and
   *  those of them with room — the inspector names the one nearest to the garage */
  opts: number[];
  optsRoom: number[];
}

const PH_PREP = 0, PH_PREP2 = 1, PH_TRANSIT = 2, PH_RSEARCH = 3, PH_RMATCH = 4, PH_COMMUTE = 5, PH_INBOUND = 6, PH_SHOP = 7,
  PH_FREIGHT = 8, PH_FINAL = 9, PH_FINAL2 = 10,
  // WP7b (appended so the indices of the phases above stay stable): per-origin transit options (split from TRANSIT),
  // park & ride search, freight sink throughput, parking raster
  PH_TRANSIT2 = 11, PH_PARKRIDE = 12, PH_SINKS = 13, PH_PARKING = 14,
  // r4: park & ride overflow of a matching round (entered from roundMatch when riders were turned away by all their
  // options; it returns to the round's successor)
  PH_PROVER = 15;
const PHASES = 16;
/** phase order (the matching rounds PH_RSEARCH <-> PH_RMATCH choose their successor in roundMatch, PH_PROVER returns
 *  to it) */
const NEXT_PHASE: readonly number[] = [
  PH_PREP2, PH_TRANSIT, PH_TRANSIT2, PH_RMATCH, -2, PH_INBOUND, PH_SHOP, PH_FREIGHT, PH_SINKS, PH_FINAL2, -1,
  PH_PARKRIDE, PH_RSEARCH, PH_PARKING, PH_FINAL, -2,
];
/**
 * estimated ms per phase on the reference 256² stress city (scaled by graph / building counts). WP7b phases calibrated
 * by step-wise CPU on stressCity(256) + 853 facilities + 40 garages / 6 terminals / 2 depots (CPU per estimated ms of
 * the cycle unchanged: 3.31 vs 3.35 without WP7b)
 */
const PHASE_COST = [1.9, 0.9, 2.3, 1.2, 1.2, 1.5, 2.4, 2.8, 2.4, 0.4, 1.6, 0.6, 1.6, 1.2, 1.8, 0.6];
/** car-less share: the car / park & ride utility x exp(-MODE_BETA x CARLESS_EXTRA_MIN) */
const CARLESS_K = Math.exp(-MODE_BETA * CARLESS_EXTRA_MIN);
/** transport defs of the WP7b fleet / parking models (per-def data keyed by def id; catalogTypes is read-only) */
const DEPOT_DEFS: Readonly<Record<string, number>> = { civ_bus_depot: DEPOT_BUSES };
const GARAGE_DEFS: Readonly<Record<string, number>> = { tr_parking_garage: GARAGE_SPACES };
/** estimated ms of a road / rail / subway graph rebuild on a 256² map */
const REBUILD_COST = 2.5;
/** P&R two-label search: states settled per scheduler step, and the estimated ms of such a step (calibrated like
 *  PHASE_COST: stressTransit, CPU per estimated ms of the utilities task) */
const PR_CHUNK_STATES = 16000;
const PR_CHUNK_COST = 1.7;
/** P&R: estimated ms per kept-forest state of a car-leg refresh (refreshAlt; calibrated like PHASE_COST) */
const PR_REFRESH_COST = 1.2e-5;
/** P&R: a fresh K-label search at least every this many assignments, or when a garage's minutes moved more than
 *  PR_SEED_DRIFT since the last one (see prSearchDue) */
const PR_SEARCH_EVERY = 8;
const PR_SEED_DRIFT = 2;
/** weight of the new label when a garage's ranking minutes are smoothed (per assignment) */
const PR_RANK_SMOOTH = 0.25;
/**
 * park & ride overflow (r4): riders turned away by every one of their PR_OPTIONS options are re-decided at the end of
 * the matching round with the garage groups that still have room — an overflow search (OV_K labels per node, seeded
 * only at the groups with room for OV_MIN_ROOM riders or more, ranking minutes, the PR_CAR_LEG_MAX car leg) gives each
 * of them the fastest such group within PR_OPTION_MARGIN minutes of their fastest option; passes repeat (re-seeded at
 * the groups that still have room) while riders are left over and a pass filled a group, at most OV_PASSES per round.
 * Forests are kept (OV_CACHE, keyed by the seed set) and reused while their seeds have not moved (PR_SEED_DRIFT,
 * PR_SEARCH_EVERY); at most OV_SEARCHES fresh searches per assignment.
 */
const OV_K = 2;
const OV_PASSES = 3;
const OV_MIN_ROOM = 10;
const OV_CACHE = 3;
const OV_SEARCHES = 6;
/** overflow records re-decided per scheduler step (each: a mode split per option tried); estimated ms per record, of a
 *  step and of the round's car flows (accumulate + commit over its forest: they move from roundMatch's step to the
 *  overflow's last one) on the reference city; states of an overflow search per step at PR_CHUNK_COST (two labels per
 *  node: about a third of the K-label search's ms per state). Calibrated like PHASE_COST (the scheduler-cost driver on
 *  stressCity(256) + facilities + the transport set: CPU per estimated ms of these steps ~ the matching rounds') */
const OV_CHUNK = 3000;
const OV_REC_COST = 1e-4;
const OV_STEP_COST = 0.02;
const OV_FLOW_COST = 0.15;
const OV_CHUNK_STATES = 40000;
const MAX_ENTRIES = 12;
/** job matching: a proportional round (round < MATCH_PROP_ROUNDS) that matched under this share of the waiting workers
 *  is starved and does not count toward MATCH_ROUNDS (at most MATCH_EXTRA_ROUNDS such rounds per assignment); starved
 *  full-capacity rounds count as before (the pooled match takes the rest) */
const MATCH_STARVED = 0.02;
const MATCH_EXTRA_ROUNDS = MATCH_PROP_ROUNDS;
const MODE_NAMES = ['none', 'car', 'transit', 'walk'];
/** garage state of a cycle: no road entry, no attached stop within PR_STOP_RADIUS, a stop without a transit path to any
 *  job, a downtown stop (its best path rides nothing: jobs a walk away — parking only), park & ride */
const GARAGE_NO_ROAD = 0, GARAGE_NO_STOP = 1, GARAGE_NO_TRANSIT = 2, GARAGE_DOWNTOWN = 3, GARAGE_PR = 4;
const GARAGE_STATE = ['noRoad', 'noStop', 'noTransit', 'downtown', 'parkRide'];
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
function growF64(a: Float64Array<ArrayBuffer>, n: number): Float64Array<ArrayBuffer> {
  if (a.length >= n) return a;
  const b = new Float64Array(Math.max(n, a.length * 2, 64));
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
  /** the saved MSA iteration, taken by the first graph build after a load */
  private iterLoad = 0;
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
  /** park & ride boardings per stop this assignment, the wait park & ride choices see (crowding from the stop's other
   *  riders only: a garage's own riders would otherwise deter themselves next time — a full garage, an empty one, ...;
   *  their limit is the garage's spaces), and the smoothed boardings per stop key [persisted] */
  private stPr: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stWaitPr: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stPrPrev = new Map<number, number>();
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
  /** starved matching rounds this cycle (each allows one round beyond MATCH_ROUNDS, at most MATCH_EXTRA_ROUNDS) */
  private extraRounds = 0;
  /** PH_COMMUTE step: 0 = the pooled match (poolRemaining), 1 = flows and results (commuteEnd) */
  private commuteStage = 0;
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
  /** park & ride car legs: K-label reverse road search from the P&R garages (PR_OPTIONS garage options per node + the
   *  next one, the cutoff the last option fades against; kept across a cycle, reused every 2nd cycle) */
  private SPK = new SearchK(PR_OPTIONS + 1);
  /** P&R phase stage of this cycle: 0 = garages (+ search start), 1 = search chunks, 3 = car legs refreshed on the kept
   *  forest, 2 = per-origin options */
  private prStage = 0;
  /** assignment of the last completed P&R search (cycles) */
  private prSearched = -1e9;
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
  private subVer = 0;
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
  /** 1 = the garage seeded the last search (its seed label gSeed) */
  private gSeeded: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** the garage's minutes the options are ranked by: its label smoothed across assignments (PR_RANK_SMOOTH; the label
   *  itself moves with the buses' congestion and the stop's crowding every assignment — the choices see it, the ranking
   *  of which garages a commuter weighs should not) */
  private gRank: Float32Array<ArrayBuffer> = new Float32Array(0);
  private garageRank = new Map<number, number>();
  private gBoard: Int32Array<ArrayBuffer> = new Int32Array(0);
  /** GARAGE_* state of the garage this cycle (no stop / stop without transit / downtown stop / park & ride) */
  private gState: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** garage centre cell and half footprint (its stop candidates are the attached stops within PR_STOP_RADIUS + half) */
  private gCell: Int32Array<ArrayBuffer> = new Int32Array(0);
  private gHalf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** 1 = park & ride this cycle (its stop's best transit path rides a vehicle) */
  private gRide: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** spaces, cars parked (this assignment), riders, workers whose park & ride option it is (at the group root; + the
   *  workers whose overflow it took), price (minutes), wanted (report: riders choosing it, incl. those that came over
   *  from a full option and the overflow), spaces kept for the block around it (reserve, from the last parking raster) */
  private gSpaces: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gLoad: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gRiders: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** riders choosing it (the logit over their options: the price signal) */
  private gWant: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gCatch: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gPrice: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gWantR: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gRes: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** r4, per group root: riders turned away with no room at any option (the overflow included), attributed to the
   *  options they wanted (logit weights), the worker-weighted sums of their homes' x / z and x² + z² (report: where
   *  another garage would take them, when they live close together), and the riders it took as other groups' overflow */
  private gUnpl: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gUnplX: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gUnplZ: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gUnplQ: Float64Array<ArrayBuffer> = new Float64Array(0);
  private gOvIn: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** riders turned away by a full group that another group took this assignment — spilled to another option (prRest, by
   *  the riders each option turned away) or as the overflow (PH_PROVER, by their logit weights over their options) — by
   *  (root of the full group) x (gN + 1) + (root that took them): the report names a full garage's main taker */
  private ovTo = new Map<number, number>();
  /** overflow riders per origin x (gN + 1) + root this assignment (the group's catchment counts the origin's workers once,
   *  the origin's main overflow group) */
  private ovSeen = new Map<number, number>();
  /** park & ride groups (garages at the same stop within GARAGE_GROUP_CELLS pool their room and share one price): root
   *  garage index per garage, room (spaces - reserve) per root; gLoad / gRiders / gWant / gWantR / gCatch / gUnpl / gOvIn
   *  accumulate at the root during the assignment, commuteEnd shares them out by room into the per-garage gCars /
   *  gRidersM (reports, parking supply) */
  private gGrp: Int32Array<ArrayBuffer> = new Int32Array(0);
  private gGSp: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gCars: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gRidersM: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gPrN = 0;
  /** park & ride cars per garage id of the last completed assignment [persisted] */
  private garageLoad = new Map<number, number>();
  /** park & ride price (minutes) per garage id [persisted] */
  private garagePrice = new Map<number, number>();
  /** spaces a park & ride garage keeps for the businesses around it (by the pressure they feel; parkingRaster) [persisted] */
  private garageReserve = new Map<number, number>();
  /** the stop (stop key: building id, or -1 - cell) a park & ride garage used last (stop hysteresis) [persisted] */
  private garageStop = new Map<number, number>();
  /** park & ride garages whose stop's best path rode nothing lately: the smoothed share of such assignments
   *  (PR_DOWNTOWN_SMOOTH; it stays park & ride below PR_DOWNTOWN_SHARE) [persisted] */
  private garageDown = new Map<number, number>();
  /** a park & ride garage's minutes from its stop on its last riding path (the downtown near-tie test, PR_DOWNTOWN_TIE;
   *  not persisted: after a load the first walk-only assignment counts as one) */
  private garageRideT = new Map<number, number>();
  /** last completed assignment per garage id (report): riders, wanted (its share of its group's), catchment workers,
   *  state, garages pooled with it, spaces kept for the block, minutes from parking to the job by transit (Infinity:
   *  no park & ride), the overflow (r4) */
  private garageLast = new Map<number, {
    riders: number; want: number; catchment: number; state: number; pooled: number; reserve: number; transit: number;
    /** r4: riders it took as other groups' overflow; the garage that took most of its commuters' overflow (-1 none) and
     *  those riders; its commuters' riders turned away with nowhere to go, the cell at the centre of their homes and their
     *  spread around it (tiles, rms) */
    ovIn: number; ovTo: number; ovToRiders: number; unplaced: number; unplacedHome: number; unplacedSpread: number;
  }>();
  /** free spaces per garage id in the last parking update (report: the pressure around it with and without them) */
  private garageFree = new Map<number, number>();
  /** riders placed per option by the last prAlloc (scratch, PR_OPTIONS), their logit weights, and their extra minutes
   *  over the mode split's option (sum of riders x (t_k - t_ref)) */
  private prAk = new Float64Array(PR_OPTIONS);
  private prWk = new Float64Array(PR_OPTIONS);
  /** riders each option of the last prAlloc turned away (full): their spill, attributed to the options that take it (r4,
   *  the report names a full garage's main taker) */
  private prRj = new Float64Array(PR_OPTIONS);
  private prDT = 0;
  /** the split arguments of the piece prRest re-decides (car minutes / car possible, walk, walk-to-stop transit, the
   *  ordinance's transit bonus; pcPool: poolRemaining's binary split) */
  private pcCarT = 0; private pcCarOk = false; private pcWalkT = Infinity; private pcTrT = Infinity; private pcBonus = 0;
  private pcPool = false;
  /** prOptions scratch: an origin's options while collected (free-flow minutes, congested minutes, garage, state, group;
   *  PR_OPTIONS + 1: the next one is the cutoff) */
  private poT = new Float64Array(PR_OPTIONS + 1);
  private poC = new Float64Array(PR_OPTIONS + 1);
  private poQ = new Int32Array(PR_OPTIONS + 1);
  private poS = new Int32Array(PR_OPTIONS + 1);
  private poR = new Int32Array(PR_OPTIONS + 1);
  /** road graph version of the origin snapshot (prep): the reach snapshot's entry nodes are node ids of that graph */
  private prepVer = -1;
  /** garageReach per garage id, computed from the reach snapshot `cycle` (= its tick) */
  private reachCache = new Map<number, GarageReach & { cycle: number }>();
  private SR: Search | null = null;
  // per origin: park & ride options k = 0 .. oPrN - 1 at o x PR_OPTIONS + k, fastest first (total minutes, availability
  // cost — minutes of choice as it nears the cutoff, PR_OPTION_TAPER —, garage index, car-leg state of SPK), car-less share
  private oPrN: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private oPrT: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oPrA: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oPrG: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oPrNode: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oCl: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** car-less extra minutes (sum over the assigned pieces of take x car-less share x extra) */
  private oClX: Float32Array<ArrayBuffer> = new Float32Array(0);
  private prRiders = 0;
  /** r4, per origin: free-flow ranking minutes of its fastest option (the overflow's PR_OPTION_MARGIN), and the group
   *  root that took most of its overflow this assignment (-1 none) with those riders */
  private oPrF0: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oOvG: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oOvY: Float32Array<ArrayBuffer> = new Float32Array(0);
  // r4 overflow records: the people of a round's pieces whose park & ride riders found no room at any of their options
  // (prRest); their mode is decided at the end of the round with the groups that still have room (PH_PROVER). Origin,
  // job cluster, car node of the round's forest, people, the split's car minutes / car possible / walk minutes /
  // walk-to-stop transit minutes, and the park & ride share of their last split (riders that found no room)
  private pnN = 0;
  private pnO: Int32Array<ArrayBuffer> = new Int32Array(64);
  private pnQ: Int32Array<ArrayBuffer> = new Int32Array(64);
  private pnNode: Int32Array<ArrayBuffer> = new Int32Array(64);
  private pnY: Float64Array<ArrayBuffer> = new Float64Array(64);
  private pnCarT: Float64Array<ArrayBuffer> = new Float64Array(64);
  private pnCarOk: Uint8Array<ArrayBuffer> = new Uint8Array(64);
  private pnWalkT: Float64Array<ArrayBuffer> = new Float64Array(64);
  private pnTrT: Float64Array<ArrayBuffer> = new Float64Array(64);
  private pnTP: Float64Array<ArrayBuffer> = new Float64Array(64);
  /** overflow phase: stage (0 seeds, 1 search chunks, 2 car-leg minutes of a kept forest, 3 re-decide records, 4 the
   *  rest without park & ride, 5 flows), pass, record cursor, the round's successor, the cache slot of the pass's forest,
   *  fresh searches this assignment, the pass filled a group (another pass can place more) */
  private ovStage = 0;
  private ovPass = 0;
  private ovCur = 0;
  private ovNext = -1;
  private ovSlot = -1;
  private ovSearches = 0;
  private ovFilled = false;
  /** use counter of the overflow forest cache (least recently used goes first); the cache slot of the first forest this
   *  assignment used (its seeds are a superset of every later pass's — room only shrinks within an assignment —, so an
   *  origin it leaves without an option in reach has none later: ovReachable; -1 none yet) */
  private ovTick = 0;
  private ovFilt = -1;
  /** the round's car commuters and sample-route candidates (flows committed after the overflow), its transit bonus and
   *  car PCU */
  private ovCarRound = 0;
  private ovRouteCand: number[] = [];
  private ovRouteW: number[] = [];
  private ovBonus = 0;
  private ovCarPcu = 1;
  /** overflow forests, least recently used first out (OV_CACHE) */
  private ov: OvForest[] = [];
  /** the pooled match (poolRemaining) of this assignment: workers / car commuters per road component, the sites that
   *  took pooled workers (cluster, workers; their parking demand follows once the overflow records are decided), and
   *  car flows on the last round's forest to commit */
  private poolTk: Float64Array<ArrayBuffer> = new Float64Array(0);
  private poolCarTk: Float64Array<ArrayBuffer> = new Float64Array(0);
  private poolQ: number[] = [];
  private poolFlows = false;
  /** prRest: records allowed for this piece (roundMatch), and its results: the undecided share of the piece (a record),
   *  the park & ride share of the last split tried */
  private prDefer = false;
  private prPend = 0;
  private prLastTP = 0;
  /** r4 (idle hint): the origins, their options and overflow, and the garages of the last completed assignment — the
   *  hint reads this snapshot at any time (the live arrays are rebuilt from the next assignment's prep on) */
  private rs: ReachSnap | null = null;
  /** transit forest memo per node this cycle: 1 = the path rides a vehicle, -1 = walk only (a stop next to its job) */
  private rideMemo: Int8Array<ArrayBuffer> = new Int8Array(0);
  /** workers per stop (this cycle) whose best stop path rides nothing (jobs a walk away): no riders, report hint */
  private stWalk: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** last completed assignment per stop building id: walkers (see stWalk), a path from the stop rides (stopsNear) */
  private stopWalkers = new Map<number, number>();
  private stopRide = new Map<number, boolean>();
  /** stop building id -> the transit search reached it (a job is reachable by transit from it) in the last assignment */
  private stopReach = new Map<number, boolean>();
  /** mode-split result of the last split() call (shares car / walk to a stop / park & ride / walk, minutes, car-less
   *  extra minutes x share) */
  private mC = 0; private mTW = 0; private mTP = 0; private mW = 0; private mT = 0; private mX = 0;
  /** car-less share and extra minutes per residential building id (smoothed like the commute) */
  carlessById: Float32Array<ArrayBuffer> = new Float32Array(1024);
  carlessMinById: Float32Array<ArrayBuffer> = new Float32Array(1024);
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
  /** box means of the demand / supply of the last parking update (the raster's ratio; garage reports: relief) */
  private parkBoxD: Float32Array<ArrayBuffer> = new Float32Array(0);
  private parkBoxS: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** previous raster (blend) and whether st.parking holds one (a restored save or an earlier recompute) */
  private parkPrev: Float32Array<ArrayBuffer> = new Float32Array(0);
  private parkHas = false;
  /** last parking raster summary (demand-weighted pressure, share of demand cells above 0.6, supply / demand) */
  parkingSummary: ParkingSummary = { demandWeighted: 0, highShare: 0, supply: 0, demand: 0 };
  // freight sinks (seaports + rail-linked freight stations): trucks / day within FREIGHT_SINK_MIN, by building id
  private sinkIds: number[] = [];
  private sinkTrucksById: Float32Array<ArrayBuffer> = new Float32Array(1024).fill(-1);
  /** the sink whose throughput was searched last (round-robin over the sinks, unknown ones first) */
  private sinkLast = -1;
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
      // (a road / rail edit re-labels the rail components only, a tunnel edit the subway ones, a terrain edit the ferry
      // water paths only, reset all. The graphs and the rail / tunnel components read the network / tunnel grids only,
      // so a terrain edit leaves them as they are: growth levels a lot most days, and a rebuild would bump the graph
      // version, which restarts the convergence and the park & ride search every cycle. An edit that also cuts a road
      // — a meteor — sends networkChanged as well.)
      ev.on('networkChanged', () => { this.graphDirty = true; this.attachDirty = true; this.netVer++; }),
      ev.on('subwayChanged', () => { this.graphDirty = true; this.attachDirty = true; this.subVer++; }),
      ev.on('terrainChanged', () => { this.attachDirty = true; this.terrainVer++; }),
      // (a reset follows replaceState's init, whose warm start built this same network: the MSA keeps its iteration)
      ev.on('reset', () => { this.iterLoad = Math.max(this.iterLoad, this.iter); this.graphDirty = true; this.attachDirty = true; this.netVer++; this.subVer++; this.terrainVer++; }),
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
    this.prStage = 0;
    this.prSearched = -1e9;
    this.SPK.graphVersion = -1;
    this.garageFree.clear();
    this.reachCache.clear();
    this.rs = null;
    this.ov = [];
    this.pnN = 0;
    this.ovStage = 0;
    this.sinkTrucksById.fill(-1);
    this.sinkLast = -1;
    this.sinksDone = false;
    this.hasTruckData = false;
    this.garageLast.clear();
    this.stopWalkers.clear();
    this.stopRide.clear();
    this.stopReach.clear();
    this.carlessById.fill(0);
    this.carlessMinById.fill(0);
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
    this.iterLoad = 0;
    this.restoreMatching(sim.state);
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
    // (two steps: the pooled match — park & ride choices of the pooled workers with garages —, then the flows; the P&R
    // car legs on the K-label forest: a pass over its states)
    if (ph === PH_COMMUTE) {
      if (this.commuteStage === 0) return 0.6 * base * (0.3 * road + 0.7 * bld) + (this.gPrN > 0 ? 0.3 * bld : 0);
      return 0.5 * base * (0.3 * road + 0.7 * bld) + (this.gPrN > 0 ? 0.1 + PR_REFRESH_COST * this.SPK.settled : 0);
    }
    // WP7b prep extras: car-less shares, parking over job footprints, sink / garage / depot lists
    if (ph === PH_PREP) return base * (0.3 * road + 0.7 * bld) + 0.3 * bld + attach;
    if (ph === PH_TRANSIT2) return base * (0.3 * road + 0.7 * bld);
    if ((ph === PH_SHOP || ph === PH_FREIGHT || ph === PH_INBOUND) && !this.sfRecompute) return 0.15;
    // freight: + truck times and trucks per cell (WP7-10)
    if (ph === PH_FREIGHT) return base * (0.8 * road + 0.2 * bld) + 0.15 * road + 0.05 * (size * size / 65536);
    // WP7b: depot BFS on change; P&R search every 2nd cycle (options only in between); parking raster O(cells)
    if (ph === PH_PREP2) return base * (0.3 * road + 0.7 * bld);
    // P&R: garages + per-origin options (reused forest), or a two-label search chunk (the first step also places the
    // garages and seeds the search), then the options in their own step
    if (ph === PH_PARKRIDE) {
      if (this.prStage === 1) return PR_CHUNK_COST * Math.min(1, 3 * road);
      // (refresh: one pass over the kept forest's states; options: per origin; garages + a search's seeding)
      if (this.prStage === 3) return 0.1 + PR_REFRESH_COST * this.SPK.settled;
      if (this.prStage === 2) return 0.2 + 1.0 * bld;
      return 0.1 + 0.15 * road;
    }
    // (+ the park & ride garages' reserves: box(supply without them), the pressure over their walk areas)
    if (ph === PH_PARKING) return 0.3 * bld + (base + (this.gPrN > 0 ? 0.4 : 0)) * (size * size / 65536);
    // r4 park & ride overflow of a round: an overflow search chunk / a chunk of records re-decided with the groups that
    // have room (a kept forest's car-leg minutes refreshed first) / a chunk of the rest without park & ride, the last one
    // with the overflow car legs (a pass over each forest used) and the round's car flows
    if (ph === PH_PROVER) {
      const recs = Math.min(OV_CHUNK, Math.max(0, this.pnN - this.ovCur));
      if (this.ovStage === 1) return PR_CHUNK_COST * Math.min(1, 3 * road);
      if (this.ovStage === 3) {
        const f = this.ovSlot >= 0 && this.ovSlot < this.ov.length ? this.ov[this.ovSlot] : null;
        return OV_STEP_COST + OV_REC_COST * recs + (f && f.alt !== this.cycles ? PR_REFRESH_COST * f.S.settled : 0);
      }
      if (this.ovCur + OV_CHUNK < this.pnN) return OV_STEP_COST + OV_REC_COST * recs;
      let states = 0;
      for (const f of this.ov) if (f.dirty) states += f.S.settled;
      return OV_STEP_COST + OV_REC_COST * recs + 0.3 * PR_REFRESH_COST * states + OV_FLOW_COST * (0.8 * road + 0.2 * bld);
    }
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
    const r: RouteInfo = { commuteMin: this.commuteById[buildingId], mode: MODE_NAMES[m] ?? 'none', jobsReached: Math.round(this.reachedById[buildingId]) };
    const cl = buildingId < this.carlessById.length ? this.carlessById[buildingId] : 0;
    if (cl > 0) { r.carless = Math.round(cl * 1000) / 1000; r.carlessMin = Math.round(this.carlessMinById[buildingId] * 10) / 10; }
    return r;
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
  /**
   * riders (boardings + alightings / day, smoothed across assignments), current wait (min), the depot (building id, -1 =
   * none / minibuses) of a stop building, walkers = residents within walking distance whose nearest jobs are a walk from
   * this stop (they don't ride: last assignment), rho = the service ratio of its bus pool (buses / buses needed; bus
   * stops only) and reach = some job is reachable by transit from it (false: no stop / station near any job on its
   * network); null = not a stop (or not seen by an assignment yet)
   */
  stopLoad(id: number): { riders: number; waitMin: number; depotId: number; walkers?: number; rho?: number; reach?: boolean } | null {
    const s = this.stIdxById.get(id);
    if (s === undefined || s >= this.stops.n || this.stops.bid[s] !== id) return null;
    const d = this.stDepot[s];
    const out: { riders: number; waitMin: number; depotId: number; walkers?: number; rho?: number; reach?: boolean } = {
      riders: this.stLoadPrev.get(id) ?? 0, waitMin: this.stWait[s], depotId: d >= 0 && d < this.depots.length ? this.depots[d].id : -1,
      walkers: this.stopWalkers.get(id) ?? 0, reach: this.stopReach.get(id),
    };
    if (this.stops.mode[s] === Transit.Bus && this.stRho[s] > 0) out.rho = this.stRho[s];
    return out;
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
  /** bus stops run by depots (sum over the depots of the stops within their range) */
  get depotStopsServed(): number {
    let n = 0;
    for (const d of this.depots) n += d.stops;
    return n;
  }
  /** buses in the city's depots, serving stops or idle (TRANSPORT_EFFECT_METRICS; stats.transitFleet counts serving ones) */
  get depotFleet(): number {
    let n = 0;
    for (const d of this.depots) n += d.fleet;
    return n;
  }
  /** stops without a depot in range: minibus pool (MINIBUS_FLEET) */
  get minibusInfo(): { stops: number; riders: number; need: number; rho: number } {
    return { ...this.minibus };
  }
  /**
   * parking garage (last completed assignment): its stop (building id, -1 none), park & ride cars parked (<= room),
   * spaces, walk to the stop; ride = its stop's transit path rides a vehicle (park & ride; false: a downtown stop whose
   * riders walk to jobs nearby, or no stop — the garage is parking only). riders = commuters who switched (the same
   * number stats.transitFleet.parkRide sums), wanted = park & ride demand (their choice, incl. commuters turned away when
   * full) + the riders who came over from a full option, catchment = workers within a PR_CAR_LEG_MAX free-flow drive for
   * whom it is one of their PR_OPTIONS park & ride options, price = its rationing price (minutes; > 0 while the demand
   * exceeds its room), state = GARAGE_STATE ('noRoad' |
   * 'noStop' | 'noTransit' | 'downtown' | 'parkRide'), pooled = other park & ride garages at its stop sharing its room
   * (cars / riders / wanted are its share of the group's), reserve = spaces it keeps for the businesses around it (their
   * block is short of parking: park & ride gets spaces - reserve), relief = the parking pressure over its walk area
   * with and without its free spaces, and the cars arriving there beyond the parking around them (short / shortWithout;
   * last parking update; undefined before one), transitMin = minutes from parking
   * here to the job by transit (park, walk to the stop, wait, ride; undefined: no park & ride — a park & ride garage
   * whose transitMin >= PR_LIMIT is no option for anybody); r4: overflowIn = riders it took as the overflow of full
   * garages, overflowTo / overflowToRiders = the garage that took most of its own commuters' overflow (-1 none),
   * unplaced = its commuters' riders that found no room at any garage (its share), unplacedHome = the cell at the centre of
   * their homes (-1 none), unplacedSpread = their homes' spread around it (tiles, rms); null = not seen by an assignment yet
   */
  garageInfo(id: number): {
    stopId: number; parkRide: number; spaces: number; walkMin: number; ride: boolean;
    riders?: number; wanted?: number; catchment?: number; price?: number; state?: string; pooled?: number;
    reserve?: number; relief?: { with: number; without: number; short: number; shortWithout: number }; transitMin?: number;
    overflowIn?: number; overflowTo?: number; overflowToRiders?: number; unplaced?: number; unplacedHome?: number; unplacedSpread?: number;
  } | null {
    for (let g = 0; g < this.gN; g++) {
      if (this.gBid[g] !== id) continue;
      const s = this.gStop[g];
      const last = this.garageLast.get(id);
      const state = last ? last.state : this.gState[g];
      const free = this.garageFree.get(id), st = this.lastState, b = st?.buildings.get(id);
      const relief = free !== undefined && st && b && this.parkBoxS.length === st.cells && this.parkD.length === st.cells
        ? garageRelief(st.size, b, free, this.parkD, this.parkBoxD, this.parkBoxS) : undefined;
      return {
        stopId: s >= 0 ? this.stops.bid[s] : -1, parkRide: this.garageLoad.get(id) ?? 0, spaces: this.gSpaces[g], walkMin: this.gWalk[g],
        ride: state === GARAGE_PR, riders: last?.riders ?? 0, wanted: last?.want ?? 0, catchment: last?.catchment ?? 0,
        price: this.garagePrice.get(id) ?? 0, state: GARAGE_STATE[state] ?? 'noStop', pooled: last?.pooled ?? 0,
        reserve: last?.reserve ?? 0,
        relief,
        transitMin: last && Number.isFinite(last.transit) ? last.transit : undefined,
        overflowIn: last?.ovIn ?? 0, overflowTo: last?.ovTo ?? -1, overflowToRiders: last?.ovToRiders ?? 0,
        unplaced: last?.unplaced ?? 0, unplacedHome: last?.unplacedHome ?? -1, unplacedSpread: last?.unplacedSpread ?? 0,
      };
    }
    return null;
  }
  /**
   * homes within a PR_CAR_LEG_MAX free-flow drive of a garage (its reach, whether they pick it or not): workers, homes
   * (with residents or not: "no commuters" when they hold no workers); and, over the homes nearest to it (the closer half
   * of those workers by drive): own = the share of their workers for whom it is a park & ride option (availability >=
   * 0.5), via = the garage most of them use as their fastest option (building id, -1 none / its own group), slower = how
   * many minutes longer park & ride via this garage takes them than via their fastest option (worker-weighted, free-flow
   * car legs + ranking minutes; PR_OPTION_MARGIN or more: beyond the overflow too), options = their mean number of
   * options, full = the share of their workers whose options were all full in the last assignment, viaRoom = the option
   * with room most of them have (-1 none), opts / optsRoom = their options of other groups / those with room, ovTo / ovShare
   * = the garage that took most of their overflow / the share of them whose riders overflowed (r4; see GarageReach).
   * Reads the snapshot of the last completed assignment (r4: valid while the next one rebuilds its options; a free-flow
   * reverse search from the garage's road entries, cached per snapshot); null = unknown (not a park & ride garage of that
   * assignment and nothing cached, or the road graph was rebuilt since and nothing is cached)
   */
  garageReach(id: number): GarageReach | null {
    const c = this.reachCache.get(id);
    const copy = (c: GarageReach): GarageReach => ({
      workers: c.workers, homes: c.homes, ovTo: c.ovTo, ovShare: c.ovShare, via: c.via, viaRoom: c.viaRoom, slower: c.slower, options: c.options,
      others: c.others, own: c.own, full: c.full, opts: c.opts.slice(), optsRoom: c.optsRoom.slice(),
    });
    const rs = this.rs;
    if (!rs) return c ? copy(c) : null;
    if (c && c.cycle === rs.tick) return copy(c);
    let q = -1;
    for (let k = 0; k < rs.gN; k++) if (rs.gBid[k] === id) { q = k; break; }
    const g = this.road;
    // (a garage newer than the snapshot, or not park & ride then, or node ids of an older graph: what was known)
    if (q < 0 || !(rs.gRank[q] < Infinity) || g.version !== rs.ver) return c ? copy(c) : null;
    let workers = 0, homes = 0, via = -1, slower = 0, options = 0, others = 0, own = 0, full = 0, viaRoom = -1, ovTo = -1, ovShare = 0;
    let opts: number[] = [], optsRoom: number[] = [];
    if (rs.gEntC[q] > 0 && g.n > 0) {
      const S = (this.SR ??= new Search()), seeds = new Seeds();
      for (let e = rs.gEntS[q], e1 = e + rs.gEntC[q]; e < e1; e++) seeds.push(rs.gEnt[e], 0, 0);
      roadSearch(g, g.rev, g.t0, S, this.heap, seeds, PR_CAR_LEG_MAX, null);
      const ownG = rs.gGrp[q], K = PR_OPTIONS, mine = rs.gRank[q];
      const near: { d: number; o: number }[] = [];
      for (let o = 0; o < rs.n; o++) {
        let d = Infinity;
        for (let e: number = rs.entS[o], e1: number = e + rs.entC[o]; e < e1; e++) {
          const v = rs.ent[e];
          if (v < S.n && S.done[v] === 1 && S.dist[v] < d) d = S.dist[v];
        }
        if (!(d < Infinity)) continue;
        homes++;
        workers += rs.w[o];
        near.push({ d, o });
      }
      // (homes whose residents are gone hold no commuters: they count as homes, not workers)
      if (workers < 1 && this.lastState) homes += this.emptyHomesNear(this.lastState, S);
      near.sort((x, y) => x.d - y.d || x.o - y.o);
      // (a garage of the last completed assignment is full: its cars at its room — spaces minus the block's reserve)
      const fullQ = (u: number): boolean => rs.gRoom[u] < 1 || (this.garageLoad.get(rs.gBid[u]) ?? 0) >= 0.97 * rs.gRoom[u];
      const by = new Map<number, number>(), byRoom = new Map<number, number>(), byAll = new Map<number, number>(), byOv = new Map<number, number>();
      let w = 0, ws = 0;
      for (const { d, o } of near) {
        if (w > 0 && w >= 0.5 * workers) break;
        const W = rs.w[o];
        w += W;
        const n = rs.prN[o];
        options += W * n;
        const og = rs.ovG[o];
        if (og >= 0) { ovShare += W; if (og !== ownG) byOv.set(og, (byOv.get(og) ?? 0) + W); }
        if (n === 0) continue;
        let allFull = true;
        for (let k = 0; k < n; k++) {
          const u = rs.prG[o * K + k];
          if (rs.gGrp[u] === ownG && Math.exp(-PR_GARAGE_BETA * rs.prA[o * K + k]) >= 0.5) own += W;
          if (rs.gGrp[u] !== ownG) { others += W; byAll.set(u, (byAll.get(u) ?? 0) + W); }
          if (!fullQ(u)) { allFull = false; if (rs.gGrp[u] !== ownG) byRoom.set(u, (byRoom.get(u) ?? 0) + W); }
        }
        if (allFull) full += W;
        const u = rs.prG[o * K];
        if (rs.gGrp[u] !== ownG) by.set(u, (by.get(u) ?? 0) + W);
        // minutes via this garage vs via their fastest option (free-flow car legs + ranking minutes on both sides)
        if (Number.isFinite(mine) && Number.isFinite(rs.f0[o])) { slower += W * ((d + mine) - rs.f0[o]); ws += W; }
      }
      options = w > 0 ? options / w : 0;
      others = w > 0 ? others / w : 0;
      own = w > 0 ? own / w : 0;
      full = w > 0 ? full / w : 0;
      ovShare = w > 0 ? ovShare / w : 0;
      slower = ws > 0 ? slower / ws : 0;
      let bw = 0;
      for (const [u, x] of by) if (x > bw) { bw = x; via = rs.gBid[u]; }
      bw = 0;
      for (const [u, x] of byRoom) if (x > bw) { bw = x; viaRoom = rs.gBid[u]; }
      bw = 0;
      for (const [u, x] of byOv) if (x > bw) { bw = x; ovTo = rs.gBid[u]; }
      // (the options picked by >= 10 % of the top one's workers, most picked first: an example the inspector can name
      // without pointing at a garage one household weighs)
      const top = (m: Map<number, number>): number[] => {
        let mx = 0;
        for (const x of m.values()) if (x > mx) mx = x;
        return [...m].filter(([, x]) => x >= 0.1 * mx).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8).map(([u]) => rs.gBid[u]);
      };
      opts = top(byAll);
      optsRoom = top(byRoom);
    }
    const out: GarageReach = { workers, homes, ovTo, ovShare, via, viaRoom, slower, options, others, own, full, opts, optsRoom };
    this.reachCache.set(id, { ...out, cycle: rs.tick });
    if (this.reachCache.size > 4 * rs.gN + 64) for (const k of [...this.reachCache.keys()]) if (this.reachCache.get(k)!.cycle !== rs.tick) this.reachCache.delete(k);
    return copy(out);
  }

  /** residential buildings without workers (no residents) whose road entries the search S reached (garageReach) */
  private emptyHomesNear(st: CityState, S: Search): number {
    const g = this.road, N = st.size, tmp = new Int32Array(MAX_ENTRIES);
    let n = 0;
    for (const b of st.buildings.values()) {
      if ((infoOf(st, b).fam !== Fam.R) || (b.pop > 0 && (b.flags & BF.Burnt) === 0)) continue;
      const c = perimeterNodes(g.nodeOfCell, N, b, tmp, 0, MAX_ENTRIES);
      for (let k = 0; k < c; k++) { const v = tmp[k]; if (v < S.n && S.done[v] === 1) { n++; break; } }
    }
    return n;
  }

  /** r4: the reach snapshot (ReachSnap) of the assignment just completed (commuteEnd) */
  private snapReach(): void {
    const oN = this.oN, gN = this.gN, K = PR_OPTIONS, ent = this.ent;
    const rs: ReachSnap = this.rs ?? (this.rs = {
      tick: 0, ver: -1, n: 0, entS: new Int32Array(0), entC: new Uint8Array(0), ent: new Int32Array(0), w: new Float32Array(0),
      prN: new Uint8Array(0), prG: new Int32Array(0), prA: new Float32Array(0), f0: new Float32Array(0), ovG: new Int32Array(0),
      gN: 0, gBid: new Int32Array(0), gGrp: new Int32Array(0), gRank: new Float32Array(0), gRoom: new Float32Array(0),
      gEntS: new Int32Array(0), gEntC: new Uint8Array(0), gEnt: new Int32Array(0),
    });
    let E = 0;
    for (let o = 0; o < oN; o++) E += this.oEntC[o];
    rs.entS = growI32(rs.entS, oN); rs.entC = growU8(rs.entC, oN); rs.ent = growI32(rs.ent, E);
    rs.w = growF32(rs.w, oN); rs.prN = growU8(rs.prN, oN); rs.f0 = growF32(rs.f0, oN); rs.ovG = growI32(rs.ovG, oN);
    rs.prG = growI32(rs.prG, oN * K); rs.prA = growF32(rs.prA, oN * K);
    let e = 0;
    for (let o = 0; o < oN; o++) {
      const c = this.oEntC[o];
      rs.entS[o] = e;
      rs.entC[o] = c;
      for (let x = this.oEntS[o], x1 = x + c; x < x1; x++) rs.ent[e++] = ent[x];
    }
    rs.w.set(this.oW.subarray(0, oN)); rs.prN.set(this.oPrN.subarray(0, oN)); rs.f0.set(this.oPrF0.subarray(0, oN));
    rs.ovG.set(this.oOvG.subarray(0, oN)); rs.prG.set(this.oPrG.subarray(0, oN * K)); rs.prA.set(this.oPrA.subarray(0, oN * K));
    let GE = 0;
    for (let q = 0; q < gN; q++) GE += this.gEntC[q];
    rs.gBid = growI32(rs.gBid, gN); rs.gGrp = growI32(rs.gGrp, gN); rs.gRank = growF32(rs.gRank, gN); rs.gRoom = growF32(rs.gRoom, gN);
    rs.gEntS = growI32(rs.gEntS, gN); rs.gEntC = growU8(rs.gEntC, gN); rs.gEnt = growI32(rs.gEnt, GE);
    e = 0;
    for (let q = 0; q < gN; q++) {
      const c = this.gEntC[q];
      rs.gBid[q] = this.gBid[q];
      rs.gGrp[q] = this.gGrp[q];
      rs.gRank[q] = this.gState[q] === GARAGE_PR ? this.gRank[q] : Infinity;
      rs.gRoom[q] = Math.max(0, this.gSpaces[q] - this.gRes[q]);
      rs.gEntS[q] = e;
      rs.gEntC[q] = c;
      for (let x = this.gEntS[q], x1 = x + c; x < x1; x++) rs.gEnt[e++] = ent[x];
    }
    rs.n = oN;
    rs.gN = gN;
    rs.ver = this.prepVer;
    rs.tick++;
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
  /**
   * attached stops within r cells (+ half the footprint) of a footprint (garage preview), nearest first; ride = a
   * transit path from the stop rides a vehicle in the last assignment (false: its riders walk to jobs beside it — a
   * garage there is parking only, no park & ride; undefined: not assessed yet)
   */
  stopsNear(st: CityState, x: number, z: number, w: number, d: number, r = PR_STOP_RADIUS): { id: number; mode: number; dist: number; ride?: boolean }[] {
    this.refreshAttach(st);
    const cx = x + (w >> 1), cz = z + (d >> 1), R = r + (Math.max(w, d) >> 1);
    const out: { id: number; mode: number; dist: number; ride?: boolean }[] = [];
    // stops of the last assignment (a stop placed since shows after the next one; previews run on every mouse move)
    const S = this.stops, N = st.size;
    for (let s = 0; s < S.n; s++) {
      const id = S.bid[s];
      if (id < 0 || this.attach.get(id) !== 1 || !st.buildings.has(id)) continue;
      const c = S.cell[s], sx = c % N, sz = (c - sx) / N;
      const dd = Math.hypot(sx - cx, sz - cz);
      if (dd <= R) out.push({ id, mode: S.mode[s], dist: dd, ride: this.stopRide.get(id) });
    }
    return out.sort((a, b) => a.dist - b.dist || a.id - b.id);
  }
  /** fleet / park & ride / ferry totals of the last assignment (also in stats.transitFleet, + busesShort) */
  get fleetStats(): TransitFleetStatsX {
    const st = this.lastState;
    return st ? { ...(st.stats.transitFleet as TransitFleetStatsX) } : { buses: 0, busesNeeded: 0, parkRide: 0, parkRideSpaces: 0, ferryRiders: 0, ferryLinks: 0, busesShort: 0 };
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
      case PH_PARKRIDE: next = this.parkRide(); break;
      case PH_PROVER: next = this.overflow(); break;
      case PH_RSEARCH: this.roundSearch(); break;
      case PH_RMATCH: next = this.roundMatch(); break;
      case PH_COMMUTE:
        // two steps: the pooled match of the workers the rounds left, then the flows / results of the matching (r4: the
        // overflow records of the pooled match in between — PH_PROVER commits the pooled car flows then)
        if (this.commuteStage === 0) {
          this.poolRemaining();
          next = PH_COMMUTE;
          if (this.pnN > 0) {
            this.ovBegin(PH_COMMUTE, this.poolFlows ? 1 : 0, [], []);
            next = PH_PROVER;
          } else if (this.poolFlows) {
            accumulate(this.SA, this.acc);
            this.commit(this.SA, this.acc, null, null);
          }
          this.commuteStage = 1;
        } else { this.poolCars(); this.commuteEnd(); this.commuteStage = 0; }
        break;
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

  /**
   * P&R: a fresh search this cycle? (after prGarages) The forest is ranked by free-flow minutes, so only the garages and
   * their transit minutes move it: a search when the forest does not match the graph / garages / candidate stops, a
   * garage is a seed now that was not one then (or the reverse), a seed's minutes moved more than PR_SEED_DRIFT since,
   * or PR_SEARCH_EVERY assignments have passed; in between the congested car legs along it are refreshed (stage 3)
   */
  private prSearchDue(): boolean {
    if (this.SPK.graphVersion !== this.road.version || this.prKey !== this.prKeyNow || this.cycles - this.prSearched >= PR_SEARCH_EVERY) return true;
    const room = this.gGSp, grp = this.gGrp;
    for (let q = 0; q < this.gN; q++) {
      const seeded = this.gSeeded[q] === 1, now = this.gLabel[q] < PR_LIMIT && room[grp[q]] >= 1;
      if (now !== seeded) return true;
      if (now && Math.abs(this.gRank[q] - this.gSeed[q]) > PR_SEED_DRIFT) return true;
    }
    return false;
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
    // (a load's first build: the saved volumes are of this same network, so the MSA continues the saved iteration)
    this.iter = this.iterLoad;
    this.iterLoad = 0;
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
    this.carlessById = ensureIdFloat(this.carlessById, st);
    this.carlessMinById = ensureIdFloat(this.carlessMinById, st);

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
    // (park & ride car legs per K-label search state: SPK.K per node)
    this.prAcc = growF32(this.prAcc, this.SPK.K * n);
    this.prAcc.fill(0, 0, this.SPK.K * n);
    this.prepVer = g.version;
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
    this.oPrN = growU8(this.oPrN, oN);
    this.oPrT = growF32(this.oPrT, oN * PR_OPTIONS); this.oPrG = growI32(this.oPrG, oN * PR_OPTIONS); this.oPrNode = growI32(this.oPrNode, oN * PR_OPTIONS);
    this.oPrA = growF32(this.oPrA, oN * PR_OPTIONS);
    this.oPrF0 = growF32(this.oPrF0, oN); this.oOvG = growI32(this.oOvG, oN); this.oOvY = growF32(this.oOvY, oN);
    this.oOvG.fill(-1, 0, oN); this.oOvY.fill(0, 0, oN);
    // (r4: no park & ride options for these origins until PH_PARKRIDE builds them; overflow state of the assignment)
    this.oPrN.fill(0, 0, oN);
    this.pnN = 0;
    this.ovSearches = 0;
    this.ovFilt = -1;
    this.ovTo.clear();
    this.ovSeen.clear();
    this.oClX = growF32(this.oClX, oN);
    this.candKey = this.candKey.length >= oN ? this.candKey : new Float64Array(Math.max(oN, 64) * 2);
    this.candNode = growI32(this.candNode, oN);
    for (let o = 0; o < oN; o++) {
      this.oU[o] = this.oW[o];
      this.oAsg[o] = 0; this.oTimeSum[o] = 0; this.oCarW[o] = 0; this.oTrW[o] = 0; this.oWalkW[o] = 0; this.oClX[o] = 0;
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
    this.extraRounds = 0;
    this.commuteStage = 0;
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
    this.prStage = 0;
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
    this.stPr = growF32(this.stPr, stops.n + 1);
    this.stPr.fill(0, 0, stops.n);
    this.stWaitPr = growF32(this.stWaitPr, stops.n + 1);
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
      const rx = Math.max(0, prev - (this.stPrPrev.get(this.stKey[s]) ?? 0)) / capS;
      this.stWaitPr[s] = base * Math.min(4, 1 + rx * rx);
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
    this.gSeeded = growU8(this.gSeeded, gN + 1); this.gRank = growF32(this.gRank, gN + 1);
    this.gRide = growU8(this.gRide, gN + 1); this.gState = growU8(this.gState, gN + 1); this.gSpaces = growF32(this.gSpaces, gN + 1);
    this.gRiders = growF32(this.gRiders, gN + 1); this.gWant = growF32(this.gWant, gN + 1); this.gCatch = growF32(this.gCatch, gN + 1);
    this.gUnpl = growF32(this.gUnpl, gN + 1); this.gUnplX = growF32(this.gUnplX, gN + 1); this.gUnplZ = growF32(this.gUnplZ, gN + 1);
    this.gUnplQ = growF64(this.gUnplQ, gN + 1);
    this.gOvIn = growF32(this.gOvIn, gN + 1);
    this.gPrice = growF32(this.gPrice, gN + 1); this.gCell = growI32(this.gCell, gN + 1); this.gHalf = growU8(this.gHalf, gN + 1);
    this.gGrp = growI32(this.gGrp, gN + 1); this.gGSp = growF32(this.gGSp, gN + 1); this.gCars = growF32(this.gCars, gN + 1);
    this.gRidersM = growF32(this.gRidersM, gN + 1); this.gWantR = growF32(this.gWantR, gN + 1); this.gRes = growF32(this.gRes, gN + 1);
    let prN = 0, key = '';
    for (let q = 0; q < gN; q++) {
      this.gStop[q] = -1; this.gWalk[q] = 0; this.gLoad[q] = 0; this.gBoard[q] = -1; this.gRide[q] = 0;
      this.gRiders[q] = 0; this.gWant[q] = 0; this.gWantR[q] = 0; this.gCatch[q] = 0; this.gLabel[q] = Infinity;
      this.gUnpl[q] = 0; this.gUnplX[q] = 0; this.gUnplZ[q] = 0; this.gUnplQ[q] = 0; this.gOvIn[q] = 0;
      this.gGrp[q] = q; this.gGSp[q] = 0; this.gCars[q] = 0; this.gRidersM[q] = 0;
      const id = this.gBid[q];
      const b = st.buildings.get(id);
      this.gSpaces[q] = (b && GARAGE_DEFS[b.def]) || GARAGE_SPACES;
      this.gPrice[q] = this.garagePrice.get(id) ?? 0;
      // spaces kept for the block around it (local parkers first; park & ride gets the rest; a block barely short of
      // parking keeps none: below PR_RESERVE_MIN x spaces)
      const res = Math.max(0, Math.min(this.gSpaces[q], this.garageReserve.get(id) ?? 0));
      this.gRes[q] = res >= PR_RESERVE_MIN * this.gSpaces[q] ? res : 0;
      this.gState[q] = GARAGE_NO_ROAD;
      if (!b || this.gEntC[q] === 0) { this.garageStop.delete(id); this.garageDown.delete(id); this.garageRideT.delete(id); continue; }
      this.gState[q] = GARAGE_NO_STOP;
      const c = centerCell(st, b), x = c % N, z = (c - x) / N;
      const half = Math.max(b.w, b.d) >> 1;
      this.gCell[q] = c;
      this.gHalf[q] = half;
      // candidate stops: every attached stop within reach; the nearest (walk + wait) until PH_PARKRIDE picks the stop
      // whose transit path rides (the P&R search key covers the candidates, so it is known before that step)
      const cnt = this.nearStops(N, x, z, PR_STOP_RADIUS + half);
      let best = Infinity, cand = '';
      for (let k = 0; k < cnt; k++) {
        const s = this.nsIdx[k];
        if (this.stAttC[s] === 0) continue;
        const walk = Math.max(0, this.nsDist[k] - half) * STOP_WALK_TIME_PER_CELL;
        cand += this.stKey[s] + ' ';
        if (walk + this.stWait[s] < best) { best = walk + this.stWait[s]; this.gStop[q] = s; this.gWalk[q] = walk; }
      }
      if (this.gStop[q] >= 0) { prN++; key += id + ':' + cand + ','; this.gState[q] = GARAGE_NO_TRANSIT; }
      // (no stop within reach: no park & ride stop to keep — PH_PARKRIDE, which drops it otherwise, is skipped when no
      // garage has a stop)
      else { this.garageStop.delete(id); this.garageDown.delete(id); this.garageRideT.delete(id); }
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

  /** wait (minutes) at stop s without crowding: the mode's wait, buses / the service ratio of the stop's bus pool */
  private baseWait(s: number): number {
    const m = this.stops.mode[s];
    return m === Transit.Bus ? WAIT_BUS / (this.stRho[s] > 0 ? this.stRho[s] : 1) : m === Transit.Subway ? WAIT_SUBWAY : m === Transit.Ferry ? WAIT_FERRY : WAIT_TRAIN;
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

  /** pure transit minutes of the transit-forest label d reaching job site j (without the seed's noise) */
  private transitPure(d: number, j: number): number {
    return j >= 0 && j < this.jN ? d - this.jNoise[j] : d;
  }

  /**
   * each origin's best transit option (board node, stop, pure minutes, destination) from the transit forest. Only board
   * nodes whose path rides a vehicle count: a stop whose best path is "walk to the job beside it" is no transit trip
   * (it would count the walker twice as a rider — boarding and alighting at the same stop — and size buses for them);
   * those workers are counted per stop (stWalk: the report explains the empty stop)
   */
  private originTransit(): void {
    const ST = this.ST;
    const distT = ST.dist, srcT = ST.src, doneT = ST.done;
    const N = this.road.N;
    const hasStops = this.stops.n > 0;
    const total = this.tnet ? this.tnet.total : 0;
    if (this.rideMemo.length < total) this.rideMemo = new Int8Array(total + (total >> 3) + 16);
    this.rideMemo.fill(0, 0, total);
    this.stWalk = growF32(this.stWalk, this.stops.n + 1);
    this.stWalk.fill(0, 0, this.stops.n + 1);
    for (let o = 0; o < this.oN; o++) {
      this.oTrT[o] = Infinity;
      this.oBoard[o] = -1;
      this.oBoardStop[o] = -1;
      this.oJobT[o] = -1;
      // park & ride options come from PH_PARKRIDE (skipped without P&R garages)
      this.oPrN[o] = 0;
      if (!hasStops) continue;
      const c = this.oCell[o], x = c % N, z = (c - x) / N;
      const half = this.oHalf[o];
      const cnt = this.nearStops(N, x, z, STOP_WALK_RADIUS + half);
      let best = Infinity, board = -1, boardStop = -1, bestWalkOnly = Infinity, walkStop = -1;
      for (let q = 0; q < cnt; q++) {
        const s = this.nsIdx[q];
        const walk = Math.max(0, this.nsDist[q] - half) * STOP_WALK_TIME_PER_CELL + this.stWait[s];
        for (let a = this.stAttS[s], a1 = a + this.stAttC[s]; a < a1; a++) {
          const v = this.stAtt[a];
          if (doneT[v] !== 1) continue;
          const g = walk + distT[v];
          if (!(g < best)) continue;
          if (this.rides(v)) { best = g; board = v; boardStop = s; } else if (g < bestWalkOnly) { bestWalkOnly = g; walkStop = s; }
        }
      }
      // (nearest option walk-only: these workers walk / drive; the stop's report says why it carries nobody)
      if (walkStop >= 0 && bestWalkOnly < best) this.stWalk[walkStop] += this.oW[o];
      if (board < 0) continue;
      const jT = srcT[board];
      const t = this.transitPure(best, jT);
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
   * P&R garages: among the attached stops within reach, the one whose transit path rides a vehicle with the least walk
   * + wait + transit minutes (this cycle's transit forest; the stop of the last assignment is kept unless another is
   * faster by more than PR_STOP_KEEP / 10 %); label = PR_PARK_MIN + that (pure minutes: the garage's price is a choice
   * weight added in the choices, see commuteEnd). A garage whose stops' paths all ride nothing (jobs a walk away:
   * downtown) is parking only (its spaces ease the blocks around it, parking.ts) — a park & ride garage stays one
   * while under PR_DOWNTOWN_SHARE of its recent assignments ride nothing (its last label). Groups: garages at the same stop within
   * GARAGE_GROUP_CELLS pool their room (spaces minus the reserve for the block around each) and one price. Every 2nd
   * cycle (or when the graph / garages / candidate stops changed) a K-label reverse road search from the garages' road
   * entries gives every node its PR_OPTIONS fastest garage groups within PR_CAR_LEG_MAX free-flow minutes (car legs) and
   * PR_OPTION_MARGIN minutes of its fastest; in between the forest is reused (car legs keep their minutes, the transit
   * part is this cycle's). Origin options (distinct groups, fastest first) = PR_HOME_MIN + congested car leg + label; a
   * group without room is no option. The options do not depend on the prices, so a price change moves riders between
   * an origin's options (logit) but never takes a garage out of anybody's choice set.
   */
  private parkRide(): number {
    // stage 0: stops and groups, then a fresh search (seeded here, run in stage 1: chunks of at most PR_CHUNK_STATES
    // states per step) or the kept forest (stage 3: this cycle's congested car legs along it, every 2nd cycle); stage 2:
    // the options per origin. Each its own step (estimated apart in stepCost)
    switch (this.prStage) {
      case 0:
        this.prGarages();
        if (this.prSearchDue()) { this.prStart(); this.prStage = 1; }
        else this.prStage = this.cycles % 2 === 0 ? 3 : 2;
        return PH_PARKRIDE;
      case 1:
        if (!this.SPK.run(PR_CHUNK_STATES)) return PH_PARKRIDE;
        this.prKey = this.prKeyNow;
        this.prSearched = this.cycles;
        this.prStage = 2;
        return PH_PARKRIDE;
      case 3:
        this.SPK.refreshAlt(this.nodeTime, this.rampT);
        this.prStage = 2;
        return PH_PARKRIDE;
      default:
        this.prOptions();
        this.prStage = 0;
        return NEXT_PHASE[PH_PARKRIDE];
    }
  }

  /** P&R: each garage's stop (hysteresis) and state, groups at the same stop (room, price) */
  private prGarages(): void {
    const ST = this.ST, distT = ST.dist, doneT = ST.done, srcT = ST.src;
    const gN = this.gN, N = this.road.N;
    for (let q = 0; q < gN; q++) {
      this.gLabel[q] = Infinity;
      this.gBoard[q] = -1;
      this.gRide[q] = 0;
      const id = this.gBid[q];
      if (this.gState[q] < GARAGE_NO_TRANSIT) { this.garageStop.delete(id); this.garageDown.delete(id); this.garageRideT.delete(id); continue; } // no road entry / no stop within reach
      const c = this.gCell[q], x = c % N, z = (c - x) / N, half = this.gHalf[q];
      const cnt = this.nearStops(N, x, z, PR_STOP_RADIUS + half);
      const keep = this.garageStop.get(id);
      let best = Infinity, board = -1, bs = -1, bw = 0, wo = -1, woBest = Infinity, woWalk = 0, woBoard = -1;
      let kT = Infinity, kBoard = -1, kS = -1, kW = 0, kwT = Infinity, kwS = -1, kwW = 0, kwBoard = -1;
      // (the stop is chosen by its base wait — without crowding: the garage's own riders crowd whichever stop it picks,
      // so crowding would make it hop between two stops — and kept unless another is clearly faster; the label below
      // uses the chosen stop's real wait)
      for (let k = 0; k < cnt; k++) {
        const s = this.nsIdx[k];
        if (this.stAttC[s] === 0) continue;
        const walk = Math.max(0, this.nsDist[k] - half) * STOP_WALK_TIME_PER_CELL;
        const w0 = this.baseWait(s);
        for (let a = this.stAttS[s], a1 = a + this.stAttC[s]; a < a1; a++) {
          const v = this.stAtt[a];
          if (doneT[v] !== 1) continue;
          const t = walk + w0 + this.transitPure(distT[v], srcT[v]);
          if (this.rides(v)) {
            if (t < best) { best = t; board = v; bs = s; bw = walk; }
            if (this.stKey[s] === keep && t < kT) { kT = t; kBoard = v; kS = s; kW = walk; }
          } else {
            if (t < woBest) { woBest = t; wo = s; woWalk = walk; woBoard = v; }
            if (this.stKey[s] === keep && t < kwT) { kwT = t; kwS = s; kwW = walk; kwBoard = v; }
          }
        }
      }
      if (kS >= 0 && kS !== bs && kT <= best + Math.max(PR_STOP_KEEP, 0.1 * best)) { best = kT; board = kBoard; bs = kS; bw = kW; }
      if (board < 0) {
        // no stop path rides this assignment. A park & ride garage stays one while under PR_DOWNTOWN_SHARE of its recent
        // assignments ride nothing (smoothed; a stop beside a few jobs: its best path flips between a short ride and a
        // walk with congestion) at its stop, with its last label (riders board there and walk on); then — or a garage
        // that was not park & ride — downtown: the stop's riders walk to jobs beside it (no park & ride); else its transit
        // reaches no job. A walk not PR_DOWNTOWN_TIE minutes faster than its last ride from there is a near tie: it
        // counts as a ride (the share decays)
        const rt = this.garageRideT.get(id);
        const tie = keep !== undefined && rt !== undefined && woBest >= rt - PR_DOWNTOWN_TIE;
        const w0 = this.garageDown.get(id) ?? 0, down = tie ? w0 * (1 - PR_DOWNTOWN_SMOOTH) : w0 + PR_DOWNTOWN_SMOOTH * (1 - w0);
        const ks = kwS >= 0 ? kwS : wo, kb = kwS >= 0 ? kwBoard : woBoard;
        // (its last label; right after a load — no last assignment — its smoothed ranking minutes)
        const last = this.garageLast.get(id);
        const lastT = last ? (last.state === GARAGE_PR ? last.transit : NaN) : this.garageRank.get(id) ?? NaN;
        if (keep !== undefined && down < PR_DOWNTOWN_SHARE && ks >= 0 && Number.isFinite(lastT)) {
          if (down > 0.01) this.garageDown.set(id, down); else this.garageDown.delete(id);
          this.gState[q] = GARAGE_PR;
          this.gRide[q] = 1;
          this.gStop[q] = ks;
          this.gWalk[q] = kwS >= 0 ? kwW : woWalk;
          this.gLabel[q] = lastT;
          this.gBoard[q] = kb;
          this.garageStop.set(id, this.stKey[ks]);
          continue;
        }
        if (wo >= 0) { this.gState[q] = GARAGE_DOWNTOWN; this.gStop[q] = wo; this.gWalk[q] = woWalk; }
        this.garageStop.delete(id);
        this.garageDown.delete(id);
        this.garageRideT.delete(id);
        continue;
      }
      // (a ride this assignment: the walk-only share decays; its minutes are the reference of the near-tie test)
      const wd = (this.garageDown.get(id) ?? 0) * (1 - PR_DOWNTOWN_SMOOTH);
      if (wd > 0.01) this.garageDown.set(id, wd); else this.garageDown.delete(id);
      this.garageRideT.set(id, best);
      this.gState[q] = GARAGE_PR;
      this.gRide[q] = 1;
      this.gStop[q] = bs;
      this.gWalk[q] = bw;
      // pure minutes with the stop's wait as its other riders crowd it (stWaitPr); the price only steers choices, it is
      // no travel time
      this.gLabel[q] = PR_PARK_MIN + best - this.baseWait(bs) + this.stWaitPr[bs];
      this.gBoard[q] = board;
      this.garageStop.set(id, this.stKey[bs]);
    }
    // the ranking minutes: the labels smoothed across assignments (a new park & ride garage starts at its label)
    for (let q = 0; q < gN; q++) {
      const id = this.gBid[q], L = this.gLabel[q];
      if (!(L < Infinity)) { this.gRank[q] = Infinity; this.garageRank.delete(id); continue; }
      const o = this.garageRank.get(id);
      const r = o === undefined || !Number.isFinite(o) ? L : o + PR_RANK_SMOOTH * (L - o);
      this.gRank[q] = r;
      this.garageRank.set(id, r);
    }
    // groups: park & ride garages at the same stop (within GARAGE_GROUP_CELLS) pool their room and share one price —
    // their labels differ by a few steps of walking, so they would otherwise take turns; garages at different stops are
    // each other's other options (K-label search) instead
    {
      const grp = this.gGrp, R2 = GARAGE_GROUP_CELLS * GARAGE_GROUP_CELLS;
      const find = (q: number): number => { while (grp[q] !== q) { grp[q] = grp[grp[q]]; q = grp[q]; } return q; };
      for (let q = 0; q < gN; q++) grp[q] = q;
      for (let q = 0; q < gN; q++) {
        if (this.gState[q] !== GARAGE_PR) continue;
        const cq = this.gCell[q], xq = cq % N, zq = (cq - xq) / N;
        for (let r = 0; r < q; r++) {
          if (this.gState[r] !== GARAGE_PR || this.gStop[r] !== this.gStop[q]) continue;
          const cr = this.gCell[r], dx = xq - (cr % N), dz = zq - (cr - (cr % N)) / N;
          if (dx * dx + dz * dz > R2) continue;
          const a = find(q), b = find(r);
          if (a !== b) grp[a > b ? a : b] = a > b ? b : a; // root = the lowest index
        }
      }
      const gp = this.gGSp;
      for (let q = 0; q < gN; q++) { gp[q] = 0; this.gRiders[q] = 0; }
      // (gRiders doubles as the group's price scratch here: the max of the members' stored prices)
      for (let q = 0; q < gN; q++) {
        const r = find(q);
        grp[q] = r;
        gp[r] += Math.max(0, this.gSpaces[q] - this.gRes[q]);
        if (this.gPrice[q] > this.gRiders[r]) this.gRiders[r] = this.gPrice[q];
      }
      for (let q = 0; q < gN; q++) this.gPrice[q] = this.gRiders[grp[q]];
      for (let q = 0; q < gN; q++) this.gRiders[q] = 0;
    }
  }

  /** P&R: seed the K-label search from the garages' road entries (run in chunks by parkRide) */
  private prStart(): void {
    const gN = this.gN, g = this.road, grp = this.gGrp, room = this.gGSp;
    const seeds = this.seeds;
    seeds.clear();
    let maxL = 0;
    for (let q = 0; q < gN; q++) {
      // seed = the garage's minutes (no price: which garages are a commuter's options must not depend on the prices —
      // a garage pushed out of everybody's options by its own price would lose its demand, its price would collapse and
      // it would take the options back: garages taking turns). A group whose spaces all stay with its block is no
      // option.
      const L = this.gRank[q];
      this.gSeed[q] = L;
      this.gSeeded[q] = 0;
      if (!(this.gLabel[q] < PR_LIMIT) || !(room[grp[q]] >= 1)) continue;
      this.gSeeded[q] = 1;
      for (let e = this.gEntS[q], e1 = e + this.gEntC[q]; e < e1; e++) seeds.push(this.ent[e], L, q);
      if (L > maxL) maxL = L;
    }
    // (ranked by free-flow minutes — the options are where the garages are, not where today's jam is — with this cycle's
    // congested car legs along the same paths (alt) for the choices: a jam slows park & ride, it does not remove it; a
    // node beyond PR_CAR_LEG_MAX free-flow minutes of a garage gets no label from it)
    this.SPK.start(g, g.rev, g.t0, seeds, grp, Math.min(MAX_COMMUTE, maxL + PR_CAR_LEG_MAX), null, PR_CAR_LEG_MAX, PR_OPTION_MARGIN, this.nodeTime, this.rampT);
  }

  /**
   * P&R: every origin's options — its PR_OPTIONS fastest garage groups (free-flow car leg + the garage's minutes) — with
   * their minutes for the choices (congested car leg) and an availability cost: an option fades out (PR_OPTION_TAPER)
   * as it nears the cutoff — PR_OPTION_MARGIN minutes behind the fastest, or the next garage group beyond PR_OPTIONS (the
   * search keeps one more) — so a garage drifting across it loses riders gradually; and the catchments (workers whose
   * option a group is, weighted by how available). Current groups (a reused forest may hold two members of a group
   * merged since) and labels (the transit part is this cycle's).
   */
  private prOptions(): void {
    const K = PR_OPTIONS, gN = this.gN, g = this.road, SP = this.SPK, KS = SP.K, grp = this.gGrp, room = this.gGSp;
    const dist = SP.dist, src = SP.src, alt = SP.alt, cntS = SP.cnt;
    const n = Math.min(g.n, SP.n);
    // (scratch per option: free-flow minutes F, congested minutes, garage, state, group)
    const F = this.poT, T = this.poC, Q = this.poQ, S = this.poS, R = this.poR;
    const M = KS; // options collected: PR_OPTIONS + the cutoff
    for (let o = 0; o < this.oN; o++) {
      let m = 0;
      // (from its road entry with the fastest label: the entries of one lot see the same garages within a step or two)
      let v = -1, bd = Infinity;
      for (let e = this.oEntS[o], e1 = e + this.oEntC[o]; e < e1; e++) {
        const u = this.ent[e];
        if (u < n && cntS[u] > 0 && dist[KS * u] < bd) { bd = dist[KS * u]; v = u; }
      }
      if (v >= 0) {
        for (let k = 0, kn = cntS[v]; k < kn; k++) {
          const s = KS * v + k, q = src[s];
          if (q < 0 || q >= gN) continue;
          const seed = this.gSeed[q], lab = this.gLabel[q], r = grp[q];
          if (!(lab < Infinity) || !(seed < Infinity) || !(room[r] >= 1)) continue;
          const f = (dist[s] - seed) + this.gRank[q];
          // the group's best over the entries / states, the M fastest groups, sorted by free-flow minutes
          let i = 0;
          while (i < m && R[i] !== r) i++;
          if (i < m) {
            if (!(f < F[i])) continue;
            for (let j = i; j < m - 1; j++) { F[j] = F[j + 1]; T[j] = T[j + 1]; Q[j] = Q[j + 1]; S[j] = S[j + 1]; R[j] = R[j + 1]; }
            m--;
          } else if (m === M && !(f < F[M - 1])) continue;
          let j = m < M ? m : M - 1;
          while (j > 0 && F[j - 1] > f) { F[j] = F[j - 1]; T[j] = T[j - 1]; Q[j] = Q[j - 1]; S[j] = S[j - 1]; R[j] = R[j - 1]; j--; }
          F[j] = f; T[j] = PR_HOME_MIN + alt[s] + lab; Q[j] = q; S[j] = s; R[j] = r;
          if (m < M) m++;
        }
      }
      let c = 0;
      const base = o * K;
      // (the overflow takes groups within PR_OPTION_MARGIN of the fastest: r4)
      this.oPrF0[o] = m > 0 ? F[0] : Infinity;
      if (m > 0) {
        const cut = Math.min(F[0] + PR_OPTION_MARGIN, m > K ? F[K] : Infinity);
        for (let i = 0; i < m && i < K; i++) {
          const gap = cut - F[i];
          if (!(gap > 1e-3)) break;
          if (!(T[i] <= MAX_COMMUTE)) continue;
          const av = gap >= PR_OPTION_TAPER ? 1 : gap / PR_OPTION_TAPER;
          this.oPrT[base + c] = T[i]; // pure minutes; the group's price (+ availability) is added to the utility in split() / prAlloc()
          this.oPrA[base + c] = av < 1 ? -Math.log(av) / PR_GARAGE_BETA : 0;
          this.oPrG[base + c] = Q[i];
          this.oPrNode[base + c] = S[i];
          this.gCatch[R[i]] += this.oW[o] * av;
          c++;
        }
      }
      this.oPrN[o] = c;
    }
  }

  /**
   * the option of origin o the mode choice sees: the least minutes + availability cost (-1 = none). r4: no price — the
   * rationing price only splits the park & ride riders over their options (prAlloc). A price in the mode choice priced
   * the commuters near a garage with room out of park & ride (the full garages' prices rise with the demand of
   * commuters elsewhere who have nowhere else to go), so nobody spilled over to it and it stood empty; a full option's
   * riders now overflow to the groups with room (PH_PROVER) and those that find none re-decide without park & ride
   */
  private prPick(o: number): number {
    const n = this.oPrN[o], base = o * PR_OPTIONS;
    let best = -1, bc = Infinity;
    for (let k = 0; k < n; k++) {
      const c = this.prMinOf(base + k);
      if (c < bc) { bc = c; best = k; }
    }
    return best;
  }

  /** choice cost of option i (o x PR_OPTIONS + k) among the origin's options (logit): minutes + the group's price + its
   *  availability cost */
  private prCostOf(i: number): number {
    return this.oPrT[i] + this.gPrice[this.oPrG[i]] + this.oPrA[i];
  }

  /** the mode choice's minutes of option i: minutes + availability cost (no price, see prPick) */
  private prMinOf(i: number): number {
    return this.oPrT[i] + this.oPrA[i];
  }

  /** the choice weight beyond the minutes of option i the mode choice sees: its availability cost (split()'s prCost) */
  private prExtra(i: number): number {
    return this.oPrA[i];
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
      if (best < 0) { if (this.oTrT[o] < Infinity || this.oPrN[o] > 0) noRoad++; continue; }
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
      const trT = this.oPrN[o] > 0 ? Math.min(this.oTrT[o], this.oPrT[o * PR_OPTIONS]) : this.oTrT[o];
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
    // (r4: riders turned away by all their options become overflow records only while some group has room)
    const ovOn = this.gPrN > 0 && this.ovAnyRoom();
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
      let take = Math.min(this.oU[o], open);
      // mode split for this piece. WP7b: car commuters pay the site's parking (PARKING_MIN x parking), the transit
      // option is the better of walking to a stop and park & ride, car-less residents pay CARLESS_EXTRA_MIN by car / P&R
      const carT = d + CAR_OVERHEAD + PARKING_MIN * qPark[q];
      const carOk = d <= MAX_COMMUTE;
      const walkT = qBase[q] === 0 && hops[node] <= WALK_MAX_CELLS ? (hops[node] + 1) * WALK_TIME_PER_CELL : Infinity;
      // (park & ride: the origin's option with the least minutes + price)
      const pk = this.prPick(o), pq = pk >= 0 ? o * PR_OPTIONS + pk : -1;
      const trT = this.oTrT[o], prT = pq >= 0 ? this.oPrT[pq] : Infinity, prCost = pq >= 0 ? this.prExtra(pq) : 0;
      if (!this.split(o, carT, carOk, walkT, trT, prT, prCost, trBonus)) continue;
      let sc = this.mC, stW = this.mTW, stP = this.mTP, sw = this.mW, time = this.mT, ext = this.mX;
      if (stP > 0) {
        // park & ride capacity: the riders split over the origin's garage options and each part takes its group's free
        // room (prAlloc); the riders that do not fit re-decide with the options that still have room (prRest), and
        // those that find no room at any of them are an overflow record: matched to this job now, their mode decided at
        // the end of the round with the garage groups that still have room (PH_PROVER, r4), else without park & ride
        const want = take * stP;
        const placed = this.prAlloc(o, want, prT);
        if (placed < want - 1e-9) {
          this.pcPool = false; this.pcCarT = carT; this.pcCarOk = carOk; this.pcWalkT = walkT; this.pcTrT = trT; this.pcBonus = trBonus;
          this.prDefer = ovOn && this.ovReachable(o);
          const m = this.prRest(o, take, placed / want);
          this.prDefer = false;
          sc = this.mC; stW = this.mTW; stP = this.mTP; sw = this.mW; time = this.mT; ext = this.mX;
          if (this.prPend > 0) {
            const y = take * this.prPend;
            this.ovRecord(o, q, node, y, carT, carOk, walkT, trT, this.prLastTP);
            this.oU[o] -= y; this.oAsg[o] += y; qAsg[q] += y; accepted += y;
            if (this.oCarNode[o] < 0) this.oCarNode[o] = node;
            take -= y;
          } else take *= m; // (no other mode: only the part that fits is matched)
          if (!(take > 1e-9)) continue;
        }
        time += this.prDT / take; // riders at another option than the split's: its minutes
      }
      const stt = stW + stP;
      // commit
      this.oU[o] -= take;
      this.oAsg[o] += take;
      this.oTimeSum[o] += take * time;
      this.oClX[o] += take * ext;
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
      if (stP > 0) this.addParkRides(o, carPcu);
    }
    // WP7b: transit-only commuters (no road route to any open job — an island reached by ferry or subway) take the job
    // their transit option reaches, while it has room this round
    if (noRoad > 0) accepted += this.transitOnly(carPcu);
    this.roundAccepted = accepted;
    const next = this.nextRound(accepted);
    // r4: riders turned away by all their options: the overflow decides their mode (its drivers join this round's car
    // flows), then the round's car flows; else the car flows now
    if (this.pnN > 0) {
      this.ovBonus = trBonus; this.ovCarPcu = carPcu;
      this.ovBegin(next, carRound, routeCand, routeW);
      return PH_PROVER;
    }
    this.roundFlows(carRound, routeCand, routeW);
    return next;
  }

  /** the car flows of a matching round along its shortest-path forest (SA), and sample car routes of it */
  private roundFlows(carRound: number, routeCand: number[], routeW: number[]): void {
    if (!(carRound > 0)) return;
    const SA = this.SA, acc = this.acc;
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

  /** the phase after a matching round that accepted `accepted` workers: another round, or the commute results */
  private nextRound(accepted: number): number {
    const oN = this.oN;
    let left = 0;
    for (let o = 0; o < oN; o++) left += this.oU[o];
    // (a starved proportional round — every waiting worker's nearest open site was a handful of jobs, e.g. a garage's
    // attendants or a small plant between the homes and a jammed job centre — matched under MATCH_STARVED of them: it
    // does not use up one of the MATCH_ROUNDS, else no full-capacity round is left and the pooled match times their
    // commutes from that small site. Starved full-capacity rounds still count: in a town of many small sites every
    // round peels off a few, and more rounds there would only trade the pool's even spread for the round order — a
    // newly linked school then fills slower)
    if (this.round < MATCH_PROP_ROUNDS && left >= 0.5 && accepted < MATCH_STARVED * (left + accepted) && this.extraRounds < MATCH_EXTRA_ROUNDS) this.extraRounds++;
    let next = this.round + 1;
    if (next < MATCH_PROP_ROUNDS && (accepted < 0.5 || this.propFactor >= 1)) next = Math.max(next, accepted < 0.5 ? MATCH_PROP_ROUNDS : next); // proportional caps exhausted
    if (left < 0.5 || next >= MATCH_ROUNDS + this.extraRounds || (accepted < 0.5 && this.round >= MATCH_PROP_ROUNDS)) return PH_COMMUTE;
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
    this.poolFlows = false;
    this.poolQ.length = 0;
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
    const ovOn = this.gPrN > 0 && this.ovAnyRoom();
    let flows = false;
    // pooled car commuters per component (parking demand of the sites that take them; the overflow records' drivers
    // are added when PH_PROVER decides them: poolCars)
    const tk = (this.poolTk = new Float64Array(nc)), carTk = (this.poolCarTk = new Float64Array(nc));
    for (let o = 0; o < this.oN; o++) {
      const u = this.oU[o];
      if (u < 0.01 || this.oLastD[o] < 0) continue;
      const c = comp[this.ent[this.oEntS[o]]];
      if (O[c] <= 0) continue;
      const take = u * Math.min(1, O[c] / U[c]);
      const carT = Math.min(MAX_COMMUTE, Math.max(avgT + 5, 1.3 * (this.oLastD[o] + CAR_OVERHEAD)));
      const nd = this.candNode[o];
      const node = nd >= 0 && nd < g.n && SA.done[nd] === 1 ? nd : -1;
      // car / transit split (long pooled car trip vs the origin's transit option: walk to a stop or park & ride;
      // car-less residents pay CARLESS_EXTRA_MIN on car and park & ride)
      const pk = this.prPick(o), pq = pk >= 0 ? o * PR_OPTIONS + pk : -1;
      const trT = this.oTrT[o], prT = pq >= 0 ? this.oPrT[pq] : Infinity;
      this.splitPool(o, carT, trT, prT, pq >= 0 ? this.prExtra(pq) : 0);
      let stW = this.mTW, stP = this.mTP, time = this.mT, ext = this.mX;
      let takeD = take;
      this.oU[o] -= take;
      this.oAsg[o] += take;
      tk[c] += take;
      if (stP > 0) {
        // park & ride capacity (as in roundMatch): the options with room, then the overflow (a record, r4), then
        // without park & ride
        const want = take * stP;
        const placed = this.prAlloc(o, want, prT);
        if (placed < want - 1e-9) {
          this.pcPool = true; this.pcCarT = carT; this.pcTrT = trT;
          this.prDefer = ovOn && this.ovReachable(o);
          this.prRest(o, take, placed / want);
          this.prDefer = false;
          stW = this.mTW; stP = this.mTP; time = this.mT; ext = this.mX;
          if (this.prPend > 0) {
            const y = take * this.prPend;
            // (a pooled record: its job is the component's open capacity, -1 - component)
            this.ovRecord(o, -1 - c, node, y, carT, true, Infinity, trT, this.prLastTP);
            takeD -= y;
          }
        }
        if (takeD > 1e-9) time += this.prDT / takeD;
      }
      if (!(takeD > 1e-9)) continue;
      const st = stW + stP;
      const sc = 1 - st;
      this.oTimeSum[o] += takeD * time;
      this.oClX[o] += takeD * ext;
      this.oCarW[o] += takeD * sc;
      carTk[c] += takeD * sc;
      if (st > 0) {
        this.oTrW[o] += takeD * st;
        if (stW > 0) {
          this.tAcc[this.oBoard[o]] += takeD * stW;
          this.stLoad[this.oBoardStop[o]] += takeD * stW;
        }
        if (stP > 0) this.addParkRides(o, carPcu);
      }
      if (sc > 0 && node >= 0) { acc[node] += takeD * sc * carPcu; flows = true; }
    }
    // the sites with open capacity take the pooled workers of their component (their parking demand: poolCars)
    for (let q = 0; q < this.qN; q++) {
      const open = this.openCap(q);
      if (open <= 0.5) continue;
      const c = comp[this.qNode[q]];
      if (O[c] <= 0) continue;
      const add = open * Math.min(1, U[c] / O[c]);
      this.qAsg[q] += add;
      this.qTimeSum[q] += add * Math.max(avgT + 5, 20);
      this.poolQ.push(q, add);
    }
    this.round = saveRound;
    this.poolFlows = flows;
    this.ovCarPcu = carPcu;
  }

  /** the pooled workers' parking demand at the sites that took them (car share of their component; after the overflow
   *  records are decided) */
  private poolCars(): void {
    const comp = this.road.comp, P = this.poolQ, tk = this.poolTk, carTk = this.poolCarTk;
    for (let k = 0; k < P.length; k += 2) {
      const q = P[k], c = comp[this.qNode[q]];
      if (c < tk.length && tk[c] > 0) this.qCar[q] += P[k + 1] * (carTk[c] / tk[c]);
    }
    this.poolQ.length = 0;
  }

  /**
   * roundMatch: origins without a road candidate but with a transit / P&R option -> the job that option reaches (park &
   * ride only while its garage has room: the rest waits for the walk-to-stop option or stays unmatched)
   */
  private transitOnly(carPcu: number): number {
    const srcT = this.ST.src;
    let accepted = 0;
    for (let o = 0; o < this.oN; o++) {
      if (this.oU[o] < 0.01 || this.candNode[o] >= 0) continue;
      // (park & ride: the option with the least minutes + availability whose group has room)
      const base = o * PR_OPTIONS;
      let opt = -1, bc = Infinity;
      for (let k = 0, n = this.oPrN[o]; k < n; k++) {
        const q = this.oPrG[base + k];
        if (!(this.prRoom(q) > 0.01)) continue;
        const c = this.prMinOf(base + k);
        if (c < bc) { bc = c; opt = k; }
      }
      const gq = opt >= 0 ? this.oPrG[base + opt] : -1;
      const trT = this.oTrT[o], prT = opt >= 0 ? this.oPrT[base + opt] : Infinity;
      const viaPr = bc < trT;
      const t = viaPr ? prT : trT;
      if (!(t <= MAX_COMMUTE)) continue;
      const jT = viaPr ? srcT[this.gBoard[gq]] : this.oJobT[o];
      if (jT < 0 || jT >= this.jN) continue;
      const q = this.jQ[jT];
      if (q < 0) continue;
      const open = this.openCap(q);
      if (open < 0.01) continue;
      let take = Math.min(this.oU[o], open);
      if (viaPr) {
        this.gWant[this.gGrp[gq]] += take;
        this.gWantR[this.gGrp[gq]] += take;
        const room = this.prRoom(gq);
        if (take > room) { this.prUnplacedAt(gq, o, take - room); take = room; }
      }
      this.oU[o] -= take;
      this.oAsg[o] += take;
      this.oTimeSum[o] += take * t;
      this.oTrW[o] += take;
      this.qAsg[q] += take;
      this.qTimeSum[q] += take * t;
      if (viaPr) this.addParkRide(o, take, carPcu, opt);
      else {
        this.tAcc[this.oBoard[o]] += take;
        this.stLoad[this.oBoardStop[o]] += take;
      }
      accepted += take;
    }
    return accepted;
  }

  /**
   * park & ride riders `want` of origin o: they split over its garage options by a logit on minutes + price
   * (PR_GARAGE_BETA; the price signal gWant counts this choice) and each part takes its group's free room (gWantR: the
   * report's demand = the choice + the riders that came over from a full option, prRest, or as the overflow, PH_PROVER).
   * Returns the riders placed
   * (<= want); prAk = riders per option, prDT = their extra minutes over tRef (the minutes of the option the mode split
   * saw). Nothing is committed: the caller re-decides the riders that did not fit (prRest) and adds the placed ones
   * (addParkRides) with the rest of the piece.
   */
  private prAlloc(o: number, want: number, tRef: number): number {
    this.prDT = 0;
    const n = this.oPrN[o], base = o * PR_OPTIONS, a = this.prAk, w = this.prWk;
    a.fill(0);
    if (n === 0 || !(want > 0)) return 0;
    let cmin = Infinity;
    for (let k = 0; k < n; k++) { const c = this.prCostOf(base + k); w[k] = c; if (c < cmin) cmin = c; }
    let ws = 0;
    for (let k = 0; k < n; k++) { const x = Math.exp(-PR_GARAGE_BETA * (w[k] - cmin)); w[k] = x; ws += x; }
    // (the options are distinct groups: each one's room is its own; prRj = the riders each turned away: their spill)
    let placed = 0, dT = 0;
    const rj = this.prRj;
    for (let k = 0; k < n; k++) {
      const q = this.oPrG[base + k], r = this.gGrp[q];
      const y = want * w[k] / ws;
      this.gWant[r] += y;
      this.gWantR[r] += y;
      const room = this.prRoom(q);
      const t = y < room ? y : room;
      a[k] = t;
      rj[k] = y - t;
      placed += t;
      dT += t * (this.oPrT[base + k] - tRef);
    }
    this.prDT = dT;
    return placed;
  }

  /**
   * the park & ride riders of a piece that did not fit their garage choice (prAlloc placed a share f of them) re-decide:
   * a share f of the piece keeps the split in m* (its riders are placed), the rest re-splits with the park & ride options
   * that still have room — the mode choice sees the best of them (least minutes + price + availability), its riders split
   * over all of them by the same logit as prAlloc (no single garage takes every turned-away rider), each part takes its
   * room, and those that find it full re-decide again with what is left — then (r4) with prDefer the share whose riders
   * found no room at any option stays undecided (prPend: roundMatch makes it an overflow record, re-decided at the end of
   * the round with the groups that still have room), else without park & ride (the split's arguments: pc*; its riders
   * are the unplaced demand of the options they wanted: prUnplaced). Leaves the decided share's mixed shares in m*
   * (normalised to it), adds the placed riders to prAk and their extra minutes to prDT, the park & ride share of the
   * last split in prLastTP; returns the share of the piece that has a mode (< 1 only when nothing but park & ride
   * reaches a job; then nothing is deferred)
   */
  private prRest(o: number, take: number, f: number): number {
    let aC = f * this.mC, aW = f * this.mTW, aP = f * this.mTP, aK = f * this.mW, aT = f * this.mT, aX = f * this.mX;
    let rest = 1 - f;
    // (the park & ride share of the split whose riders did not all fit: prAlloc's, then each level's)
    let lastTP = this.mTP;
    const base = o * PR_OPTIONS, n = this.oPrN[o], a = this.prAk, w = this.prWk;
    for (let lvl = 0; lvl < n && rest > 1e-9; lvl++) {
      // (the mode choice sees the option with room with the least minutes + availability; its riders split over the
      // options with room by the price-weighted logit)
      let kr = -1, bc = Infinity, bm = Infinity;
      for (let k = 0; k < n; k++) {
        w[k] = -1;
        if (!(this.prRoom(this.oPrG[base + k]) - a[k] > 1e-6)) continue;
        const c = this.prCostOf(base + k), cm = this.prMinOf(base + k);
        w[k] = c;
        if (c < bc) bc = c;
        if (cm < bm) { bm = cm; kr = k; }
      }
      if (kr < 0) break;
      const tr = this.oPrT[base + kr];
      if (!this.splitFor(o, tr, this.prExtra(base + kr))) break;
      lastTP = this.mTP;
      const want = take * rest * this.mTP;
      let ws = 0;
      for (let k = 0; k < n; k++) if (w[k] >= 0) { const x = Math.exp(-PR_GARAGE_BETA * (w[k] - bc)); w[k] = x; ws += x; } else w[k] = 0;
      let placed = 0;
      for (let k = 0; k < n; k++) {
        if (!(w[k] > 0)) continue;
        const q = this.oPrG[base + k];
        const y = want * w[k] / ws, free = this.prRoom(q) - a[k];
        const fit = y < free ? y : free;
        this.gWantR[this.gGrp[q]] += y;
        a[k] += fit;
        placed += fit;
        this.prDT += fit * (this.oPrT[base + k] - tr);
        if (fit > 0) this.spillTo(o, n, fit, this.gGrp[q]);
      }
      const ww = rest * (want > 1e-12 ? Math.min(1, placed / want) : 1);
      aC += ww * this.mC; aW += ww * this.mTW; aP += ww * this.mTP; aK += ww * this.mW; aT += ww * this.mT; aX += ww * this.mX;
      rest -= ww;
    }
    let matched = 1;
    this.prPend = 0;
    this.prLastTP = lastTP;
    if (rest > 1e-9) {
      if (this.splitFor(o, Infinity, 0)) {
        if (this.prDefer) this.prPend = rest;
        else {
          aC += rest * this.mC; aW += rest * this.mTW; aK += rest * this.mW; aT += rest * this.mT; aX += rest * this.mX;
          this.prUnplaced(o, take * rest * lastTP);
        }
      } else {
        matched = 1 - rest;
        this.prUnplaced(o, take * rest * lastTP);
      }
    }
    // (shares of the decided part of the piece)
    const dec = matched - this.prPend;
    if (dec < 1 && dec > 1e-9) { const r = 1 / dec; aC *= r; aW *= r; aP *= r; aK *= r; aT *= r; aX *= r; }
    this.mC = aC; this.mTW = aW; this.mTP = aP; this.mW = aK; this.mT = aT; this.mX = aX;
    return matched;
  }

  /** logit weights (sum 1) of origin o's park & ride options by minutes + price + availability into prWk; their count */
  private prWeights(o: number): number {
    const n = this.oPrN[o], base = o * PR_OPTIONS, w = this.prWk;
    let cmin = Infinity;
    for (let k = 0; k < n; k++) { const c = this.prCostOf(base + k); w[k] = c; if (c < cmin) cmin = c; }
    let ws = 0;
    for (let k = 0; k < n; k++) { const x = Math.exp(-PR_GARAGE_BETA * (w[k] - cmin)); w[k] = x; ws += x; }
    if (ws > 0) for (let k = 0; k < n; k++) w[k] /= ws;
    return n;
  }

  /**
   * r4: u park & ride riders of origin o found no room at any option (the overflow included): the unplaced demand of
   * the options they wanted (by their logit weights) and the centre of their homes (report: where another garage would
   * take them)
   */
  private prUnplaced(o: number, u: number): void {
    if (!(u > 1e-9)) return;
    const n = this.prWeights(o), base = o * PR_OPTIONS, w = this.prWk;
    for (let k = 0; k < n; k++) this.prUnplacedAt(this.oPrG[base + k], o, u * w[k]);
  }

  /** fit riders of origin o turned away by its full options (prRj of the last prAlloc) took group r: the full options'
   *  spill destinations (report) */
  private spillTo(o: number, n: number, fit: number, r: number): void {
    const rj = this.prRj, base = o * PR_OPTIONS, M = this.gN + 1;
    let sum = 0;
    for (let k = 0; k < n; k++) sum += rj[k];
    if (!(sum > 1e-9)) return;
    for (let k = 0; k < n; k++) {
      if (!(rj[k] > 0)) continue;
      const a = this.gGrp[this.oPrG[base + k]];
      if (a === r) continue;
      const key = a * M + r;
      this.ovTo.set(key, (this.ovTo.get(key) ?? 0) + fit * rj[k] / sum);
    }
  }

  /** u riders of origin o that wanted garage gq's group found no room (see prUnplaced) */
  private prUnplacedAt(gq: number, o: number, u: number): void {
    if (!(u > 1e-12) || gq < 0 || gq >= this.gN) return;
    const r = this.gGrp[gq], N = this.road.N, c = this.oCell[o], x = c % N, z = (c - x) / N;
    this.gUnpl[r] += u;
    this.gUnplX[r] += u * x;
    this.gUnplZ[r] += u * z;
    this.gUnplQ[r] += u * (x * x + z * z);
  }

  /** split (roundMatch) or splitPool (poolRemaining) of the current piece with park & ride option (prT, prCost) */
  private splitFor(o: number, prT: number, prCost: number): boolean {
    if (this.pcPool) { this.splitPool(o, this.pcCarT, this.pcTrT, prT, prCost); return true; }
    return this.split(o, this.pcCarT, this.pcCarOk, this.pcWalkT, this.pcTrT, prT, prCost, this.pcBonus);
  }

  /** the riders of the last prAlloc of origin o at each of its options */
  private addParkRides(o: number, carPcu: number): void {
    for (let k = 0, n = this.oPrN[o]; k < n; k++) if (this.prAk[k] > 0) this.addParkRide(o, this.prAk[k], carPcu, k);
  }

  /**
   * park & ride piece of origin o at its option k (y riders within the garage group's free room — the callers cap it):
   * car leg on the K-label P&R forest, riders join the transit forest at the garage's stop
   */
  private addParkRide(o: number, y: number, carPcu: number, k: number): void {
    if (!(y > 0) || k < 0 || k >= this.oPrN[o]) return;
    const i = o * PR_OPTIONS + k, gq = this.oPrG[i];
    if (gq < 0 || gq >= this.gN) return;
    const board = this.gBoard[gq], s = this.gStop[gq], node = this.oPrNode[i];
    if (board < 0 || s < 0 || node < 0) return;
    this.prAcc[node] += y * carPcu;
    const r = this.gGrp[gq];
    this.gLoad[r] += y / CAR_OCCUPANCY;
    this.gRiders[r] += y;
    this.tAcc[board] += y;
    this.stLoad[s] += y;
    this.stPr[s] += y;
    this.prRiders += y;
  }

  /** free park & ride room of garage gq's group this assignment (riders: room — spaces minus the reserve for the block —
   *  not yet taken, x CAR_OCCUPANCY) */
  private prRoom(gq: number): number {
    const g = this.gGrp[gq];
    const r = (this.gGSp[g] - this.gLoad[g]) * CAR_OCCUPANCY;
    return r > 1e-6 ? r : 0;
  }

  // ------------------------------------------------------------------------------------------ PARK & RIDE OVERFLOW (r4)
  /** an overflow record (see pnN): y people of origin o matched to job cluster q this round (pooled: -1 - their road
   *  component), their mode undecided */
  private ovRecord(o: number, q: number, node: number, y: number, carT: number, carOk: boolean, walkT: number, trT: number, tp: number): void {
    const i = this.pnN++;
    if (i >= this.pnO.length) {
      const c = this.pnO.length * 2;
      this.pnO = growI32(this.pnO, c); this.pnQ = growI32(this.pnQ, c); this.pnNode = growI32(this.pnNode, c);
      this.pnY = growF64(this.pnY, c); this.pnCarT = growF64(this.pnCarT, c); this.pnCarOk = growU8(this.pnCarOk, c);
      this.pnWalkT = growF64(this.pnWalkT, c); this.pnTrT = growF64(this.pnTrT, c); this.pnTP = growF64(this.pnTP, c);
    }
    this.pnO[i] = o; this.pnQ[i] = q; this.pnNode[i] = node; this.pnY[i] = y;
    this.pnCarT[i] = carT; this.pnCarOk[i] = carOk ? 1 : 0; this.pnWalkT[i] = walkT; this.pnTrT[i] = trT; this.pnTP[i] = tp;
  }

  /**
   * PH_PROVER: the overflow records of a matching round (or of the pooled match) re-decide with the park & ride groups
   * that still have room, pass by pass — each planned by ovPlan (seeds, a kept forest or a fresh overflow search, whose
   * chunks stage 1 runs) — in stage 3 (records in chunks; a kept forest's car-leg minutes of this assignment refreshed
   * first), then stage 4: what is left without park & ride (chunks), and with the last chunk the overflow car legs and
   * the round's car flows. Returns the next phase (the round's successor when done)
   */
  private overflow(): number {
    if (this.ovStage === 1) {
      if (this.ov[this.ovSlot].S.run(OV_CHUNK_STATES)) this.ovStartPass();
      return PH_PROVER;
    }
    if (this.ovStage === 3) {
      const f = this.ov[this.ovSlot];
      if (f.alt !== this.cycles) { f.S.refreshAlt(this.nodeTime, this.rampT); f.alt = this.cycles; }
      const end = Math.min(this.pnN, this.ovCur + OV_CHUNK);
      this.ovAlloc(this.ovCur, end);
      this.ovCur = end;
      if (end < this.pnN) return PH_PROVER;
      // another pass while riders are left over and this one filled a group: they try the groups that still have room
      this.ovPass++;
      if (this.ovFilled && this.ovPass < OV_PASSES && this.ovLeft()) this.ovPlan();
      else { this.ovStage = 4; this.ovCur = 0; }
      return PH_PROVER;
    }
    const end = Math.min(this.pnN, this.ovCur + OV_CHUNK);
    this.ovRest(this.ovCur, end);
    this.ovCur = end;
    if (end < this.pnN) return PH_PROVER;
    for (const f of this.ov) if (f.dirty) { this.commitK(f.S, f.acc); f.dirty = false; }
    this.roundFlows(this.ovCarRound, this.ovRouteCand, this.ovRouteW);
    this.ovRouteCand = []; this.ovRouteW = [];
    this.pnN = 0;
    return this.ovNext;
  }

  /** the records of a round / the pooled match are complete: plan the overflow's first pass (PH_PROVER follows) */
  private ovBegin(next: number, carRound: number, routeCand: number[], routeW: number[]): void {
    this.ovNext = next;
    this.ovCarRound = carRound;
    this.ovRouteCand = routeCand;
    this.ovRouteW = routeW;
    this.ovPass = 0;
    this.ovPlan();
  }

  private ovStartPass(): void {
    this.ovStage = 3;
    this.ovCur = 0;
    this.ovFilled = false;
  }

  /** any overflow record with people left */
  private ovLeft(): boolean {
    for (let i = 0; i < this.pnN; i++) if (this.pnY[i] > 1e-9) return true;
    return false;
  }

  /** garage q seeds an overflow pass: park & ride (transit under PR_LIMIT, a road entry), its group with room for
   *  OV_MIN_ROOM riders and 1 % of its room */
  private ovSeedOk(q: number): boolean {
    if (this.gState[q] !== GARAGE_PR || !(this.gLabel[q] < PR_LIMIT) || !(this.gRank[q] < Infinity) || this.gBoard[q] < 0 || this.gEntC[q] === 0) return false;
    return this.prRoom(q) >= Math.max(OV_MIN_ROOM, 0.01 * this.gGSp[this.gGrp[q]] * CAR_OCCUPANCY);
  }

  /** some park & ride group has room for an overflow pass (records are made only then: prDefer) */
  private ovAnyRoom(): boolean {
    for (let q = 0; q < this.gN; q++) if (this.ovSeedOk(q)) return true;
    return false;
  }

  /** origin o may still find a group with room in reach (else its riders are decided at once, without a record): the
   *  first forest of this assignment (ovFilt) gives it a group within PR_OPTION_MARGIN of its fastest option */
  private ovReachable(o: number): boolean {
    if (this.ovFilt < 0) return true;
    const f = this.ov[this.ovFilt], S = f.S, KS = S.K;
    if (S.running) return true;
    const lim = this.oPrF0[o] + PR_OPTION_MARGIN, n = Math.min(S.n, this.road.n);
    for (let e = this.oEntS[o], e1 = e + this.oEntC[o]; e < e1; e++) {
      const u = this.ent[e];
      if (u >= n) continue;
      for (let k = 0, kn = S.cnt[u]; k < kn; k++) {
        const s = KS * u + k, q = S.src[s];
        if (q >= 0 && q < this.gN && S.dist[s] - f.seed[q] + this.gRank[q] <= lim) return true;
      }
    }
    return false;
  }

  /**
   * plan an overflow pass: the seeds (ovSeedOk) — none, or no record left: stage 4 (the rest without park & ride); a
   * kept forest of the same seeds (the same garages and graph, no seed's ranking minutes moved more than PR_SEED_DRIFT,
   * younger than PR_SEARCH_EVERY assignments): stage 3; else a fresh OV_K-label search from their road entries (ranking
   * minutes, free-flow car legs within PR_CAR_LEG_MAX, the congested ones along them for the choices) in a free or the
   * least recently used cache slot, at most OV_SEARCHES per assignment: stage 1 runs it
   */
  private ovPlan(): void {
    const g = this.road, gN = this.gN;
    this.ovCur = 0;
    let key = this.prKeyNow + '|' + g.version + '|', any = false;
    for (let q = 0; q < gN; q++) if (this.ovSeedOk(q)) { key += q + ','; any = true; }
    if (!any || !this.ovLeft()) { this.ovStage = 4; return; }
    let slot = -1;
    for (let i = 0; i < this.ov.length && slot < 0; i++) {
      const f = this.ov[i];
      if (f.key !== key || f.S.graphVersion !== g.version || f.S.running || this.cycles - f.built >= PR_SEARCH_EVERY) continue;
      let ok = true;
      for (let q = 0; q < gN && ok; q++) if (this.ovSeedOk(q) && Math.abs(this.gRank[q] - f.seed[q]) > PR_SEED_DRIFT) ok = false;
      if (ok) slot = i;
    }
    if (slot >= 0) {
      this.ov[slot].used = ++this.ovTick;
      this.ovSlot = slot;
      if (this.ovFilt < 0) this.ovFilt = slot;
      this.ovStartPass();
      return;
    }
    if (this.ovSearches >= OV_SEARCHES) { this.ovStage = 4; return; }
    if (this.ov.length < OV_CACHE) {
      this.ov.push({ S: new SearchK(OV_K), key: '', seed: new Float32Array(0), built: -1, alt: -1, used: 0, acc: new Float32Array(0), dirty: false });
      slot = this.ov.length - 1;
    } else {
      slot = 0;
      for (let i = 1; i < this.ov.length; i++) if (this.ov[i].used < this.ov[slot].used) slot = i;
    }
    const f = this.ov[slot];
    // (the car legs it carried earlier in this assignment first: the forest is replaced)
    if (f.dirty) { this.commitK(f.S, f.acc); f.dirty = false; }
    // (a forest replacing the filter's: its seeds are those of now, a superset of every later pass's too)
    if (this.ovFilt < 0 || this.ovFilt === slot) this.ovFilt = slot;
    const seeds = this.seeds;
    seeds.clear();
    if (f.seed.length < gN) f.seed = new Float32Array(gN + 16);
    let maxL = 0;
    for (let q = 0; q < gN; q++) {
      if (!this.ovSeedOk(q)) continue;
      const L = this.gRank[q];
      f.seed[q] = L;
      for (let e = this.gEntS[q], e1 = e + this.gEntC[q]; e < e1; e++) seeds.push(this.ent[e], L, q);
      if (L > maxL) maxL = L;
    }
    f.S.start(g, g.rev, g.t0, seeds, this.gGrp, Math.min(MAX_COMMUTE, maxL + PR_CAR_LEG_MAX), null, PR_CAR_LEG_MAX, PR_OPTION_MARGIN, this.nodeTime, this.rampT);
    f.key = key; f.built = f.alt = this.cycles; f.used = ++this.ovTick;
    if (f.acc.length < OV_K * g.n) f.acc = new Float32Array(OV_K * g.n + 64);
    else f.acc.fill(0, 0, OV_K * g.n);
    this.ovSearches++;
    this.ovSlot = slot;
    this.ovStage = 1;
  }

  /**
   * overflow records [from, to) with the current pass's forest: at the origin's road entry with the fastest label, its
   * groups (fastest first) that still have room, within PR_OPTION_MARGIN of the origin's fastest option and transit
   * under PR_LIMIT — a mode split with that option, like prRest's levels: the people whose riders fit are decided
   * (ovCommit), the rest try the next group, the next pass, then go without park & ride (ovRest)
   */
  private ovAlloc(from: number, to: number): void {
    const f = this.ov[this.ovSlot], S = f.S, KS = S.K, gN = this.gN, grp = this.gGrp, ent = this.ent;
    const dist = S.dist, src = S.src, alt = S.alt, cnt = S.cnt;
    const n = Math.min(S.n, this.road.n);
    for (let i = from; i < to; i++) {
      let y = this.pnY[i];
      if (!(y > 1e-9)) continue;
      const o = this.pnO[i];
      let v = -1, bd = Infinity;
      for (let e = this.oEntS[o], e1 = e + this.oEntC[o]; e < e1; e++) {
        const u = ent[e];
        if (u < n && cnt[u] > 0 && dist[KS * u] < bd) { bd = dist[KS * u]; v = u; }
      }
      if (v < 0) continue;
      const lim = this.oPrF0[o] + PR_OPTION_MARGIN;
      this.ovArgs(i);
      for (let k = 0, kn = cnt[v]; k < kn && y > 1e-9; k++) {
        const s = KS * v + k, q = src[s];
        if (q < 0 || q >= gN || !(dist[s] - f.seed[q] + this.gRank[q] <= lim)) continue;
        const room = this.prRoom(q);
        if (!(room > 1e-6) || !(this.gLabel[q] < PR_LIMIT) || this.gBoard[q] < 0 || this.gStop[q] < 0) continue;
        const T = PR_HOME_MIN + alt[s] + this.gLabel[q];
        if (!(T <= MAX_COMMUTE) || !this.splitFor(o, T, 0)) continue;
        const want = y * this.mTP;
        const fit = want < room ? want : room;
        const p = want > 1e-12 ? y * Math.min(1, fit / want) : y;
        this.gWantR[grp[q]] += want;
        this.pnTP[i] = this.mTP;
        this.ovCommit(i, p, fit, q, s, f);
        y -= p;
        if (fit > 0 && !this.ovSeedOk(q)) this.ovFilled = true;
      }
      this.pnY[i] = y;
    }
  }

  /** the people of overflow records [from, to) whose riders found no room in the overflow either: without park & ride
   *  (the riders that wanted it are the unplaced demand of their options) */
  private ovRest(from: number, to: number): void {
    for (let i = from; i < to; i++) {
      const y = this.pnY[i];
      if (!(y > 1e-9)) continue;
      const o = this.pnO[i];
      this.ovArgs(i);
      if (this.splitFor(o, Infinity, 0)) this.ovCommit(i, y, 0, -1, -1, null);
      this.prUnplaced(o, y * this.pnTP[i]);
      this.pnY[i] = 0;
    }
  }

  /** the split arguments (pc*) of overflow record i (a pooled record: the pooled match's binary split) */
  private ovArgs(i: number): void {
    this.pcPool = this.pnQ[i] < 0;
    this.pcCarT = this.pnCarT[i]; this.pcCarOk = this.pnCarOk[i] === 1; this.pcWalkT = this.pnWalkT[i]; this.pcTrT = this.pnTrT[i];
    this.pcBonus = this.ovBonus;
  }

  /** p people of overflow record i decided with the split in m* (like a piece's commit in roundMatch); `fit` of them park
   *  & ride at garage q (state s of the overflow forest f) */
  private ovCommit(i: number, p: number, fit: number, q: number, s: number, f: OvForest | null): void {
    if (!(p > 0)) return;
    const o = this.pnO[i], cq = this.pnQ[i], node = this.pnNode[i];
    const sc = this.mC, stW = this.mTW, time = this.mT;
    this.oTimeSum[o] += p * time;
    this.oClX[o] += p * this.mX;
    this.oCarW[o] += p * sc;
    this.oTrW[o] += p * (stW + this.mTP);
    this.oWalkW[o] += p * this.mW;
    // (a round's record: its job cluster; a pooled one: its road component's car commuters, poolCars)
    if (cq >= 0) this.qTimeSum[cq] += p * time;
    if (sc > 0) {
      const c = p * sc;
      if (node >= 0) this.acc[node] += c * this.ovCarPcu;
      if (cq >= 0) this.qCar[cq] += c; else this.poolCarTk[-1 - cq] += c;
      this.ovCarRound += c;
    }
    if (stW > 0) { this.tAcc[this.oBoard[o]] += p * stW; this.stLoad[this.oBoardStop[o]] += p * stW; }
    if (fit > 0 && f) this.addParkRideOv(o, fit, q, s, f);
  }

  /**
   * y riders of origin o park & ride at garage q as overflow: car leg on the overflow forest f (state s, committed at the
   * end of the overflow phase), riders join the transit forest at the garage's stop; the group's catchment (the origin's
   * workers, once), the origin's main overflow group, and the full options the riders came from (by their logit
   * weights: the report names a full garage's main taker)
   */
  private addParkRideOv(o: number, y: number, q: number, s: number, f: OvForest): void {
    const board = this.gBoard[q], st = this.gStop[q], r = this.gGrp[q];
    f.acc[s] += y * this.ovCarPcu;
    f.dirty = true;
    this.gLoad[r] += y / CAR_OCCUPANCY;
    this.gRiders[r] += y;
    this.gOvIn[r] += y;
    this.tAcc[board] += y;
    this.stLoad[st] += y;
    this.stPr[st] += y;
    this.prRiders += y;
    const M = this.gN + 1, key = o * M + r;
    const prev = this.ovSeen.get(key);
    if (prev === undefined) this.gCatch[r] += this.oW[o];
    const tot = (prev ?? 0) + y;
    this.ovSeen.set(key, tot);
    if (tot > this.oOvY[o]) { this.oOvY[o] = tot; this.oOvG[o] = r; }
    const n = this.prWeights(o), base = o * PR_OPTIONS, w = this.prWk;
    for (let k = 0; k < n; k++) {
      const kk = this.gGrp[this.oPrG[base + k]] * M + r;
      this.ovTo.set(kk, (this.ovTo.get(kk) ?? 0) + y * w[k]);
    }
  }

  /**
   * mode split of one matched piece of origin o (shares sum to 1; written to mC / mTW / mTP / mW, time mT, car-less
   * extra minutes x share mX): car (carT, when carOk), transit = the faster of walk to a stop (trT) and park & ride (prT),
   * walk (walkT); car-less residents (share oCl) pay CARLESS_EXTRA_MIN by car / park & ride (taxi, lift). prCost = the
   * garage's rationing price: in the utility only (minutes of choice, not of travel). false = no mode
   */
  private split(o: number, carT: number, carOk: boolean, walkT: number, trT: number, prT: number, prCost: number, trBonus: number): boolean {
    const usePr = prT + prCost < trT;
    const tOwn = usePr ? prT : trT;
    const cOwn = usePr ? prT + prCost : trT;
    const wl = this.oWealth[o] - 1;
    const uc = carOk ? -MODE_BETA * carT + CAR_BIAS[wl] : -Infinity;
    const ut = tOwn < Infinity ? -MODE_BETA * cOwn + TRANSIT_BIAS[wl] + trBonus : -Infinity;
    const uw = walkT < Infinity ? -MODE_BETA * walkT + WALK_BIAS : -Infinity;
    const um = Math.max(uc, ut, uw);
    if (um === -Infinity) return false;
    const ec = uc > -Infinity ? Math.exp(uc - um) : 0;
    const et = ut > -Infinity ? Math.exp(ut - um) : 0;
    const ew = uw > -Infinity ? Math.exp(uw - um) : 0;
    const tot = ec + et + ew;
    let sc = ec / tot, stt = et / tot, sw = ew / tot;
    let time = sc * (sc > 0 ? carT : 0) + stt * (stt > 0 ? tOwn : 0) + sw * (sw > 0 ? walkT : 0);
    // walk-to-stop transit / park & ride shares
    let stW = usePr ? 0 : stt, stP = usePr ? stt : 0;
    let extra = 0;
    const cl = this.oCl[o];
    if (cl > 0) {
      // car-less residents (taxi / lift): car and park & ride cost CARLESS_EXTRA_MIN more
      const ecL = ec * CARLESS_K;
      let etL = et, tL = tOwn, prL = usePr;
      if (usePr) {
        const p2 = prT + CARLESS_EXTRA_MIN;
        if (trT <= p2 + prCost) { prL = false; tL = trT; etL = Math.exp(-MODE_BETA * trT + TRANSIT_BIAS[wl] + trBonus - um); }
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
      extra = cl * (timeL - time);
      time = co * time + cl * timeL;
    }
    this.mC = sc; this.mTW = stW; this.mTP = stP; this.mW = sw; this.mT = time; this.mX = extra;
    return true;
  }

  /**
   * pooled long commute (poolRemaining): binary car / transit split (walk to a stop or park & ride: the faster) with the
   * car-less adjustment -> mC / mTW / mTP / mW (= 0) / mT / mX
   */
  private splitPool(o: number, carT: number, trT: number, prT: number, prCost: number): void {
    const logit = (x: number) => 1 / (1 + Math.exp(-x));
    const wl = this.oWealth[o] - 1;
    const usePr = prT + prCost < trT, tOwn = usePr ? prT : trT, cOwn = usePr ? prT + prCost : trT;
    const cl = this.oCl[o];
    const uCar = -MODE_BETA * carT + CAR_BIAS[wl];
    let stO = 0, stW = 0, stP = 0, time: number;
    if (tOwn < Infinity) {
      stO = logit(-MODE_BETA * cOwn + TRANSIT_BIAS[wl] - uCar);
      if (usePr) stP = stO; else stW = stO;
    }
    time = (1 - stO) * carT + stO * (tOwn < Infinity ? tOwn : 0);
    let extra = 0;
    if (cl > 0) {
      const prL = prT + prCost + CARLESS_EXTRA_MIN < trT;
      const tL = prL ? prT + CARLESS_EXTRA_MIN : trT, cL = prL ? tL + prCost : trT;
      const stL = tL < Infinity ? logit(-MODE_BETA * cL + TRANSIT_BIAS[wl] - (uCar - MODE_BETA * CARLESS_EXTRA_MIN)) : 0;
      const timeL = (1 - stL) * (carT + CARLESS_EXTRA_MIN) + stL * (tL < Infinity ? tL : 0);
      const co = 1 - cl;
      stW = co * stW + cl * (prL ? 0 : stL);
      stP = co * stP + cl * (prL ? stL : 0);
      extra = cl * (timeL - time);
      time = co * time + cl * timeL;
    }
    this.mTW = stW; this.mTP = stP; this.mW = 0; this.mC = 1 - stW - stP; this.mT = time; this.mX = extra;
  }

  /** memoised ridesFrom (per transit-forest node, reset every cycle in originTransit) */
  private rides(v: number): boolean {
    const m = this.rideMemo[v];
    if (m !== 0) return m > 0;
    const r = this.ridesFrom(v);
    this.rideMemo[v] = r ? 1 : -1;
    return r;
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

  /**
   * park & ride car legs on the K-label forest S (acc per state, injected at the origins' car-leg states): flows
   * accumulated toward the garages (children settle after their parents: one backward pass), added to this cycle's
   * volumes per node, highway <-> non-highway moves counted as ramp flow of the non-highway node; clears acc
   */
  private commitK(S: SearchK, acc: Float32Array): void {
    const order = S.order, next = S.next, snode = S.node, volNew = this.volNew, rampNew = this.rampNew, type = this.road.type;
    const HW = Network.Highway;
    for (let k = S.settled - 1; k >= 0; k--) {
      const s = order[k];
      const f = acc[s];
      if (f === 0) continue;
      acc[s] = 0;
      const v = snode[s];
      volNew[v] += f;
      const p = next[s];
      if (p < 0) continue;
      acc[p] += f;
      const nx = snode[p];
      if ((type[v] === HW) !== (type[nx] === HW)) rampNew[type[v] === HW ? nx : v] += f;
    }
  }

  /** transit rider flows, per-origin results and stats of the commute matching */
  private commuteEnd(): void {
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
    // WP7-8 park & ride: car legs along the K-label P&R forest (the overflow's were committed by PH_PROVER); per garage
    // the cars / riders / demand of this assignment (the reports and stats.transitFleet.parkRide read the same numbers)
    // and the rationing price for the next one: tatonnement on wanted (the logit choice) / room (demand beyond the room
    // raises it, idle room lowers it to 0; a group that is nobody's option has no demand to ration: 0). The price only
    // splits the riders over their options (r4: the mode choice does not see it, see prPick)
    if (this.gPrN > 0 && this.prRiders > 0 && this.SPK.graphVersion === this.road.version) this.commitK(this.SPK, this.prAcc);
    else if (this.prAcc.length > 0) this.prAcc.fill(0, 0, Math.min(this.prAcc.length, this.SPK.K * this.road.n));
    this.garageLoad.clear();
    this.garageLast.clear();
    const members = new Int32Array(this.gN + 1);
    for (let q = 0; q < this.gN; q++) members[this.gGrp[q]]++;
    // (r4: per group root, the group that took most of its commuters' overflow)
    const M = this.gN + 1, toG = new Int32Array(M).fill(-1), toY = new Float64Array(M);
    for (const [k, y] of this.ovTo) { const a = Math.floor(k / M), b = k - a * M; if (a !== b && y > toY[a]) { toY[a] = y; toG[a] = b; } }
    const N = this.road.N;
    for (let q = 0; q < this.gN; q++) {
      const id = this.gBid[q], r = this.gGrp[q];
      const pr = this.gState[q] === GARAGE_PR;
      // the group's cars / riders / demand shared out by room (a pooled garage shows its share)
      const room = Math.max(0, this.gSpaces[q] - this.gRes[q]);
      const share = this.gGSp[r] > 0 ? room / this.gGSp[r] : 0;
      this.gCars[q] = this.gLoad[r] * share;
      this.gRidersM[q] = this.gRiders[r] * share;
      const un = this.gUnpl[r], ux = un > 1e-9 ? this.gUnplX[r] / un : 0, uz = un > 1e-9 ? this.gUnplZ[r] / un : 0;
      this.garageLast.set(id, {
        riders: this.gRidersM[q], want: this.gWantR[r] * share, catchment: this.gCatch[r], state: this.gState[q], pooled: members[r] - 1,
        reserve: pr ? this.gRes[q] : 0, transit: pr ? this.gLabel[q] : Infinity,
        ovIn: this.gOvIn[r] * share, ovTo: toG[r] >= 0 ? this.gBid[toG[r]] : -1, ovToRiders: toY[r] * share, unplaced: un * share,
        unplacedHome: un > 1e-9 ? Math.round(uz) * N + Math.round(ux) : -1,
        unplacedSpread: un > 1e-9 ? Math.sqrt(Math.max(0, this.gUnplQ[r] / un - ux * ux - uz * uz)) : 0,
      });
      if (!pr) { this.garagePrice.delete(id); continue; }
      this.garageLoad.set(id, this.gCars[q]);
      if (!(this.gCatch[r] >= 1)) { this.garagePrice.delete(id); continue; }
      const x = this.gWant[r] / CAR_OCCUPANCY / Math.max(1, this.gGSp[r]);
      const p = this.gPrice[q] + PR_PRICE_STEP * Math.log(x < 0.25 ? 0.25 : x > 4 ? 4 : x);
      const pc = p < 0.01 ? 0 : p > PR_PRICE_MAX ? PR_PRICE_MAX : p;
      if (pc > 0) this.garagePrice.set(id, pc); else this.garagePrice.delete(id);
    }
    if (this.garagePrice.size > this.gN || this.garageReserve.size > this.gN || this.garageStop.size > this.gN || this.garageDown.size > this.gN
      || this.garageRank.size > this.gN || this.garageRideT.size > this.gN) {
      const live = new Set<number>();
      for (let q = 0; q < this.gN; q++) live.add(this.gBid[q]);
      for (const m of [this.garagePrice, this.garageReserve, this.garageStop, this.garageDown, this.garageRank, this.garageRideT]) for (const id of [...m.keys()]) if (!live.has(id)) m.delete(id);
    }
    // (r4: what the idle hint reads of this assignment)
    this.snapReach();
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
   * critic item 18: throughput of a seaport / rail-linked freight station = trucks of all industries within
   * FREIGHT_SINK_MIN (truck time) of it — its own reverse search seeded at that sink only, so neither road neighbour
   * connections nor a second sink nearby shadow it. One sink per 2nd cycle (with the freight pass): sinks without a
   * value first, then round-robin in building order; the others keep their last value.
   */
  private freightSinks(): void {
    const g = this.road, S = this.SB, seeds = this.seeds;
    const K = this.sinkK.length;
    if (K === 0 || this.truckTime.length < g.n) { this.sinksDone = true; return; }
    // pick: the first sink without a value, else the one after the last searched (round-robin)
    let pick = -1;
    for (let q = 0; q < K; q++) { const id = this.sinkIds[q]; if (!(id < this.sinkTrucksById.length) || this.sinkTrucksById[id] < 0) { pick = q; break; } }
    if (pick < 0) {
      const last = this.sinkIds.indexOf(this.sinkLast);
      pick = last >= 0 ? (last + 1) % K : 0;
    }
    seeds.clear();
    const k = this.sinkK[pick];
    for (let e = this.kEntS[k], e1 = e + this.kEntC[k]; e < e1; e++) seeds.push(this.ent[e], 0, 0);
    let tot = 0;
    if (seeds.n > 0) {
      roadSearch(g, g.rev, this.truckTime, S, this.heap, seeds, FREIGHT_SINK_MIN, this.rampT);
      const done = S.done;
      for (let f = 0; f < this.fN; f++) {
        for (let e = this.fEntS[f], e1 = e + this.fEntC[f]; e < e1; e++) if (done[this.ent[e]] === 1) { tot += this.fTrucks[f]; break; }
      }
      S.settled = 0; // scratch
    }
    const id = this.sinkIds[pick];
    if (id < this.sinkTrucksById.length) this.sinkTrucksById[id] = tot;
    this.sinkLast = id;
    this.sinksDone = true;
  }

  // ------------------------------------------------------------------------------------------ PARKING (WP7-7)
  /** parking raster from this cycle's car arrivals (job sites, shops) vs supply (zones, streets, civic lots, garages) */
  private parkingRaster(sim: Simulation): void {
    const st = sim.state, N = st.size, C = st.cells;
    if (this.parkD.length !== C) {
      this.parkD = new Float32Array(C); this.parkS = new Float32Array(C);
      this.parkTmpA = new Float32Array(C); this.parkTmpB = new Float32Array(C);
      this.parkBoxD = new Float32Array(C); this.parkBoxS = new Float32Array(C);
    }
    const D = this.parkD, S = this.parkS;
    D.fill(0);
    const inv = 1 / CAR_OCCUPANCY;
    for (let j = 0; j < this.jB; j++) { const b = this.jObj[j]; if (b) addFootprint(N, b, this.jCar[j] * inv, D); }
    for (let s = 0; s < this.sN; s++) { const b = this.sObj[s]; if (b) addFootprint(N, b, PARKING_SHOP_W * this.sCar[s] * inv, D); }
    baseSupply(st, S);
    // garages: their free spaces ease the blocks around them; one without a road beside it gives none (drivers can't
    // reach it — what its report says). Parking-only garages (no park & ride) free all their spaces. Every park & ride
    // garage keeps spaces for the businesses around it: spaces x min(1, the pressure they feel without the park & ride
    // garages / PR_RESERVE_FULL), at most PR_RESERVE_SPREAD x the cars they lack (garageShortage: a small strip of shops
    // does not take a whole garage; PR_RESERVE_SMOOTH-blended, persisted: park & ride gets spaces - reserve from the
    // next assignment on — local parkers first), and frees its spaces minus this assignment's park & ride cars
    const prB: Building[] = [], prQ: number[] = [];
    this.garageFree.clear();
    for (let q = 0; q < this.gN; q++) {
      const id = this.gBid[q], pr = this.gState[q] === GARAGE_PR;
      if (!pr) this.garageReserve.delete(id);
      if (this.gState[q] === GARAGE_NO_ROAD) continue;
      const b = st.buildings.get(id);
      if (!b) continue;
      if (pr) { prB.push(b); prQ.push(q); continue; }
      addGarageSupply(N, b, this.gSpaces[q], S);
      this.garageFree.set(id, this.gSpaces[q]);
    }
    parkingBox(N, D, this.parkBoxD, this.parkTmpA);
    if (prB.length > 0) {
      parkingBox(N, S, this.parkTmpB, this.parkTmpA);
      for (let k = 0; k < prB.length; k++) {
        const q = prQ[k], id = this.gBid[q], spaces = this.gSpaces[q];
        const sh = garageShortage(N, prB[k], D, this.parkBoxD, this.parkTmpB);
        const raw = Math.min(spaces * Math.min(1, sh.p / PR_RESERVE_FULL), PR_RESERVE_SPREAD * sh.unmet);
        const old = this.garageReserve.get(id);
        const res = old === undefined ? raw : old + PR_RESERVE_SMOOTH * (raw - old);
        if (res >= 0.5) this.garageReserve.set(id, res); else this.garageReserve.delete(id);
        const free = spaces - Math.min(spaces, this.gCars[q]);
        addGarageSupply(N, prB[k], free, S);
        this.garageFree.set(id, free);
      }
    }
    parkingBox(N, S, this.parkBoxS, this.parkTmpA);
    // blended with the previous raster (one assignment's arrivals are noisy); a fresh city / old save starts unblended
    let prev: Float32Array | null = null;
    if (this.parkHas) {
      if (this.parkPrev.length !== C) this.parkPrev = new Float32Array(C);
      this.parkPrev.set(st.parking);
      prev = this.parkPrev;
    }
    this.parkingSummary = parkingFromBoxes(N, D, S, this.parkBoxD, this.parkBoxS, st.parking, prev, PARKING_BLEND);
    this.parkHas = true;
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
      if (this.attachSubVer !== this.subVer || this.attachSubwayComp.length !== C) {
        this.attachSubwayComp = labelCells(C, N, sub, null, this.attachSubwayComp);
        this.attachSubVer = this.subVer;
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
      if (this.attachRailVer !== this.netVer || this.attachRailComp.length !== C) {
        this.attachRailComp = labelCells(C, N, net, flags, this.attachRailComp);
        this.attachRailVer = this.netVer;
      }
      const comp = this.attachRailComp;
      if (railTarget.length !== C) railTarget = new Uint8Array(C); else railTarget.fill(0);
      const target = railTarget;
      const border = new Set<number>(), port = new Set<number>();
      const edge = (i: number) => { if (comp[i] >= 0) { border.add(comp[i]); target[i] = 1; } };
      for (let t = 0; t < N; t++) { edge(t); edge((N - 1) * N + t); edge(t * N); edge(t * N + N - 1); }
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
    this.garagePrice.clear();
    this.garageReserve.clear();
    this.garageStop.clear();
    this.garageDown.clear();
    this.garageRideT.clear();
    this.garageRank.clear();
    this.stLoadPrev.clear();
    this.stPrPrev.clear();
    this.parkHas = false;
    this.rampVolCell = new Float32Array(st.cells);
    const d = st.systemData.infraTransport as TransportSave | undefined;
    if (!d || typeof d !== 'object') return;
    const pairs = (a: unknown, into: Map<number, number>) => {
      if (!Array.isArray(a)) return;
      for (const e of a) if (Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'number' && isFinite(e[1])) into.set(e[0], e[1]);
    };
    pairs(d.busNeed, this.busNeed);
    pairs(d.garageLoad, this.garageLoad);
    pairs(d.garagePrice, this.garagePrice);
    pairs(d.garageReserve, this.garageReserve);
    pairs(d.garageStop, this.garageStop);
    pairs(d.garageDown, this.garageDown);
    pairs(d.garageRank, this.garageRank);
    pairs(d.stopLoad, this.stLoadPrev);
    pairs(d.stopPr, this.stPrPrev);
    const sinks = new Map<number, number>();
    pairs(d.sinkTrucks, sinks);
    if (sinks.size > 0) {
      this.sinkTrucksById = ensureIdFloat(this.sinkTrucksById, st, -1);
      for (const [id, v] of sinks) if (id >= 0 && id < this.sinkTrucksById.length) this.sinkTrucksById[id] = v;
    }
    if (typeof d.sinkLast === 'number') this.sinkLast = d.sinkLast;
    const rc = d.rampCells, rv = d.rampVol;
    if (rc && rv && rc.length === rv.length) for (let k = 0; k < rc.length; k++) { const c = rc[k]; if (c >= 0 && c < st.cells) this.rampVolCell[c] = rv[k]; }
    const pq = d.parkingQ;
    if (pq && pq.length === st.cells) { for (let i = 0; i < st.cells; i++) st.parking[i] = pq[i] / 255; this.parkHas = true; }
  }

  /** the saved job-matching state (after init's reset of the prices / RNG): prices per job site, the RNG, the
   *  assignment count and the MSA iteration — the matching continues the saved one instead of re-converging */
  private restoreMatching(st: CityState): void {
    const d = st.systemData.infraTransport as TransportSave | undefined;
    if (!d || typeof d !== 'object') return;
    const ji = d.jobIds, jp = d.jobPrice, ci = d.connCells, cp = d.connPrice;
    if (ji && jp && ji.length === jp.length && ji.length > 0) {
      this.priceById = ensureIdFloat(this.priceById, st);
      const P = this.priceById;
      for (let k = 0; k < ji.length; k++) { const id = ji[k], p = jp[k]; if (id >= 0 && id < P.length && isFinite(p)) P[id] = p; }
    }
    if (ci && cp && ci.length === cp.length) {
      const P = this.connPrice;
      for (let k = 0; k < ci.length; k++) { const c = ci[k], p = cp[k]; if (c >= 0 && c < P.length && isFinite(p)) P[c] = p; }
    }
    if (typeof d.rng === 'number' && isFinite(d.rng) && d.rng > 0) this.rngState = d.rng >>> 0;
    if (typeof d.cycles === 'number' && isFinite(d.cycles) && d.cycles > 0) this.cycles = Math.floor(d.cycles);
    if (typeof d.iter === 'number' && isFinite(d.iter) && d.iter > 0) this.iterLoad = Math.floor(d.iter);
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
    const sinks: [number, number][] = [];
    for (const id of this.sinkIds) if (id < this.sinkTrucksById.length && this.sinkTrucksById[id] >= 0) sinks.push([id, f(this.sinkTrucksById[id])]);
    // job-matching prices of this assignment's job sites (exact Float32: the prices converge over many assignments, and
    // a load without them re-matches the city from zero prices)
    let nj = 0, nc = 0;
    for (let j = 0; j < this.jN; j++) {
      if (this.jBid[j] >= 0) { if (this.priceById[this.jBid[j]] !== 0) nj++; } else if (this.connPrice[this.jCell[j]] !== 0) nc++;
    }
    const jobIds = new Int32Array(nj), jobPrice = new Float32Array(nj), connCells = new Int32Array(nc), connPrice = new Float32Array(nc);
    nj = nc = 0;
    for (let j = 0; j < this.jN; j++) {
      const id = this.jBid[j];
      if (id >= 0) { const p = this.priceById[id]; if (p !== 0) { jobIds[nj] = id; jobPrice[nj++] = p; } }
      else { const c = this.jCell[j], p = this.connPrice[c]; if (p !== 0) { connCells[nc] = c; connPrice[nc++] = p; } }
    }
    const save: TransportSave = {
      v: 1,
      busNeed: [...this.busNeed].map(([k, v]) => [k, f(v)]),
      garageLoad: [...this.garageLoad].map(([k, v]) => [k, f(v)]),
      // (prices and reserves at full precision: the rationing feeds back on itself, a rounded value drifts after a load)
      garagePrice: [...this.garagePrice],
      garageReserve: [...this.garageReserve],
      garageStop: [...this.garageStop],
      garageDown: [...this.garageDown],
      garageRank: [...this.garageRank],
      stopLoad: [...this.stLoadPrev].map(([k, v]) => [k, f(v)]),
      stopPr: [...this.stPrPrev].map(([k, v]) => [k, f(v)]),
      sinkTrucks: sinks,
      sinkLast: this.sinkLast,
      rampCells: Int32Array.from(rc),
      rampVol: Float32Array.from(rv),
      parkingQ: pq,
      jobIds, jobPrice, connCells, connPrice,
      rng: this.rngState,
      cycles: this.cycles,
      iter: this.iter,
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
    // interchange (ramp) flows: MSA per cell like the volumes (WP7-10), with a lower floor (RAMP_MSA_MIN): each commuter
    // picks one ramp, so two interchanges would otherwise trade the load every cycle
    {
      const rv = this.rampVolCell, rn = this.rampNew, cellOf = g.cellOf, type = g.type;
      const ra = Math.max(RAMP_MSA_MIN, 1 / this.iter);
      for (let v = 0; v < n; v++) {
        if (type[v] === Network.Highway) continue;
        const c = cellOf[v];
        const x = rv[c] * (1 - ra) + rn[v] * ra;
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
    // stop loads for crowding / bus need: smoothed across assignments (STOP_LOAD_SMOOTH; a new stop starts at its load)
    // — the next assignment's crowding wait reads them, and an undamped load would alternate full / empty; walkers and
    // whether a path from the stop rides (reports, garage preview) of this assignment
    {
      const old = this.stLoadPrev, oldPr = this.stPrPrev;
      const next = new Map<number, number>(), nextPr = new Map<number, number>();
      this.stopWalkers.clear();
      this.stopRide.clear();
      this.stopReach.clear();
      const doneT = this.ST.done;
      for (let s = 0; s < this.stops.n; s++) {
        const bid = this.stops.bid[s];
        const key = bid >= 0 ? bid : -1 - this.stops.cell[s];
        const o = old.get(key);
        next.set(key, o === undefined ? this.stLoad[s] : o + STOP_LOAD_SMOOTH * (this.stLoad[s] - o));
        const op = oldPr.get(key), np = op === undefined ? this.stPr[s] : op + STOP_LOAD_SMOOTH * (this.stPr[s] - op);
        if (np > 0.5) nextPr.set(key, np);
        if (bid < 0) continue;
        if (this.stWalk[s] > 0) this.stopWalkers.set(bid, this.stWalk[s]);
        let ride = false, reach = false;
        for (let a = this.stAttS[s], a1 = a + this.stAttC[s]; a < a1 && !ride; a++) {
          const v = this.stAtt[a];
          if (doneT[v] !== 1) continue;
          reach = true;
          if (this.rides(v)) ride = true;
        }
        this.stopRide.set(bid, ride);
        this.stopReach.set(bid, reach);
      }
      this.stLoadPrev = next;
      this.stPrPrev = nextPr;
    }
    // stats
    const stats = st.stats;
    stats.tripsCar = Math.round(this.tripsCar);
    stats.tripsTransit = Math.round(this.tripsTransit);
    stats.tripsWalk = Math.round(this.tripsWalk);
    stats.avgCommute = this.commuteW > 0 ? this.commuteSum / this.commuteW : 0;
    stats.avgTraffic = congN > 0 ? congSum / congN : 0;
    // WP7b fleet / park & ride / ferries: only fleets that serve stops count (a depot out of range of every stop runs
    // no route), and busesShort sums the shortfall per pool so one depot's spare buses do not hide another's stops
    const tf = stats.transitFleet as TransitFleetStatsX;
    let buses = 0, need = 0, short = 0;
    for (const d of this.depots) {
      need += d.need;
      if (d.stops <= 0) continue;
      buses += d.fleet;
      short += Math.max(0, d.need - d.fleet);
    }
    if (this.minibus.stops > 0) { buses += MINIBUS_FLEET; need += this.minibus.need; short += Math.max(0, this.minibus.need - MINIBUS_FLEET); }
    tf.buses = Math.round(buses);
    tf.busesNeeded = Math.round(need * 10) / 10;
    tf.busesShort = Math.round(short * 10) / 10;
    let spaces = 0;
    // (park & ride spaces: garages whose stop's riders ride, minus what each keeps for the block around it; downtown
    // garages are plain parking)
    for (let q = 0; q < this.gN; q++) if (this.gState[q] === GARAGE_PR) spaces += Math.max(0, this.gSpaces[q] - this.gRes[q]);
    tf.parkRide = Math.round(this.prRiders);
    tf.parkRideSpaces = Math.round(spaces);
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
      // car-less workers: share and their mean extra minutes (taxi / lift) vs car owners (routeInfo, WP5's inspector)
      {
        const cl = this.oCl[o], a = this.oAsg[o];
        const x = a > 0 && cl > 0 ? Math.max(0, this.oClX[o] / (a * cl)) : 0;
        const px = this.carlessMinById[bid];
        this.carlessById[bid] = cl;
        this.carlessMinById[bid] = px > 0 && this.cycles > 0 ? px + (x - px) * RESULT_SMOOTH : x;
      }
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

/** a cached park & ride overflow forest (r4): an OV_K-label search seeded at the groups that had room */
interface OvForest {
  S: SearchK;
  /** the seed garages (indices) and the road graph version; each garage's ranking minutes at the search (its labels
   *  include them: options use dist - seed + the current ranking minutes) */
  key: string;
  seed: Float32Array<ArrayBuffer>;
  /** assignment of the search, of the last car-leg refresh (alt), of the last use (least recently used goes first) */
  built: number;
  alt: number;
  used: number;
  /** overflow car legs of this assignment per state (committed by the overflow phase), any to commit */
  acc: Float32Array<ArrayBuffer>;
  dirty: boolean;
}

/** r4: the last completed assignment as the idle hint (garageReach) reads it — the live per-origin / per-garage arrays
 *  are rebuilt from the next assignment's prep on */
interface ReachSnap {
  /** snapshot count (the reach cache's key), road graph version of its node ids */
  tick: number;
  ver: number;
  /** origins: road entries (CSR), workers, park & ride options (garage index, availability cost; PR_OPTIONS stride),
   *  free-flow ranking minutes of the fastest option, the group root that took most of their overflow (-1 none) */
  n: number;
  entS: Int32Array<ArrayBuffer>;
  entC: Uint8Array<ArrayBuffer>;
  ent: Int32Array<ArrayBuffer>;
  w: Float32Array<ArrayBuffer>;
  prN: Uint8Array<ArrayBuffer>;
  prG: Int32Array<ArrayBuffer>;
  prA: Float32Array<ArrayBuffer>;
  f0: Float32Array<ArrayBuffer>;
  ovG: Int32Array<ArrayBuffer>;
  /** garages: ids, group roots, ranking minutes (Infinity: no park & ride), room (spaces - reserve), road entries (CSR) */
  gN: number;
  gBid: Int32Array<ArrayBuffer>;
  gGrp: Int32Array<ArrayBuffer>;
  gRank: Float32Array<ArrayBuffer>;
  gRoom: Float32Array<ArrayBuffer>;
  gEntS: Int32Array<ArrayBuffer>;
  gEntC: Uint8Array<ArrayBuffer>;
  gEnt: Int32Array<ArrayBuffer>;
}

/** persisted WP7b state (systemData.infraTransport) */
interface TransportSave {
  v: number;
  /** smoothed needed buses per depot id (-1 = minibus pool) */
  busNeed: [number, number][];
  /** park & ride cars per garage id (last assignment) */
  garageLoad: [number, number][];
  /** park & ride rationing price (minutes) per garage id (optional: saves before r1 have none) */
  garagePrice?: [number, number][];
  /** spaces a park & ride garage keeps for its block, and its stop key (optional: saves before r2 have none) */
  garageReserve?: [number, number][];
  garageStop?: [number, number][];
  /** park & ride garages whose stop path rode nothing lately: the smoothed share of such assignments (optional: r3) */
  garageDown?: [number, number][];
  /** a park & ride garage's smoothed ranking minutes (optional: r3) */
  garageRank?: [number, number][];
  /** riders per stop key (building id, -1 - cell for road-flag stops), smoothed */
  stopLoad: [number, number][];
  /** park & ride boardings per stop key, smoothed (optional: r3) */
  stopPr?: [number, number][];
  /** trucks within FREIGHT_SINK_MIN per sink id and the sink searched last (round-robin; optional) */
  sinkTrucks?: [number, number][];
  sinkLast?: number;
  /** smoothed ramp flow per ramp cell */
  rampCells: Int32Array;
  rampVol: Float32Array;
  /** parking pressure x 255 per cell */
  parkingQ: Uint8Array;
  /** job-matching prices (minutes) per job building id and per neighbour-connection cell, the matching RNG state, the
   *  assignment count and the MSA iteration (optional: saves before r3 have none — their matching restarts from zero
   *  prices and drifts for several assignments) */
  jobIds?: Int32Array;
  jobPrice?: Float32Array;
  connCells?: Int32Array;
  connPrice?: Float32Array;
  rng?: number;
  cycles?: number;
  iter?: number;
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

let labelStack: Int32Array<ArrayBuffer> = new Int32Array(0);
/**
 * 4-connected components: out[i] = component id, -1 elsewhere. Cells: layer[i] !== 0 (subway tunnels) when `flags` is
 * null, else rail cells (layer[i] === Network.Rail or a level crossing in flags). No closures, reused stack (the lazy
 * attachment refresh runs in whichever system asks first)
 */
function labelCells(C: number, N: number, layer: Uint8Array, flags: Uint8Array | null, out: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> {
  const comp = out.length === C ? out : new Int32Array(C);
  const RAIL = Network.Rail;
  if (flags) for (let i = 0; i < C; i++) comp[i] = layer[i] === RAIL || (flags[i] & NETFLAG_CROSSING) !== 0 ? -2 : -1;
  else for (let i = 0; i < C; i++) comp[i] = layer[i] !== 0 ? -2 : -1;
  if (labelStack.length < C) labelStack = new Int32Array(C);
  const stack = labelStack;
  let nc = 0;
  for (let s = 0; s < C; s++) {
    if (comp[s] !== -2) continue;
    let sp = 0;
    stack[sp++] = s;
    comp[s] = nc;
    while (sp > 0) {
      const u = stack[--sp];
      const x = u % N;
      if (x > 0 && comp[u - 1] === -2) { comp[u - 1] = nc; stack[sp++] = u - 1; }
      if (x < N - 1 && comp[u + 1] === -2) { comp[u + 1] = nc; stack[sp++] = u + 1; }
      if (u >= N && comp[u - N] === -2) { comp[u - N] = nc; stack[sp++] = u - N; }
      if (u + N < C && comp[u + N] === -2) { comp[u + N] = nc; stack[sp++] = u + N; }
    }
    nc++;
  }
  return comp;
}

/** freight rail target raster (map edge / neighbour connection / seaport rail cells) and railPath's BFS scratch */
let railTarget: Uint8Array<ArrayBuffer> = new Uint8Array(0);
let railPar: Int32Array<ArrayBuffer> = new Int32Array(0);
let railQ: Int32Array<ArrayBuffer> = new Int32Array(0);
/** BFS over rail cells (comp >= 0) from a station's perimeter rail cells to the nearest target cell: path cells */
function railPath(N: number, b: Pick<Building, 'x' | 'z' | 'w' | 'd'>, comp: Int32Array, target: Uint8Array): Uint32Array | null {
  const C = N * N;
  if (railPar.length !== C) { railPar = new Int32Array(C); railQ = new Int32Array(C); }
  const par = railPar.fill(-2);
  const q = railQ;
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
