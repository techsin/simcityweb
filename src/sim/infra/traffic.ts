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
 *  REGION   (placeRegional, final fixes F1) the region at large's jobs / workers sit at every connection by capacity; with
 *           the region layer, a founded neighbour's own share only at the connections on the edge segment facing it.
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
 *   tripsWalk, stats.commuteByMode (final fixes F6: each mode's mean commute, what transit saves its riders against
 *   driving), BF.NoJobs (residential: < 35 % of workers matched to a job), BF.Congested (entry road v/c > 1). Homes on a
 *   road component cut off from the city's jobs (routed 43, markCutOff) have no route to work: the longest commute
 *   (MAX_COMMUTE), left out of the city average, routeInfo().cutOff.
 * API (TrafficSystem, get via getTraffic(sim)):
 *   getSampleRoutes(max), routeInfo(buildingId), workerAccess(id), jobFill(id), freightAccess(id), customers(id),
 *   commuteOf(id), findPath(fromCell, toCell), pushServiceRoute(cells, weight, days), accessById / jobFillById arrays;
 *   WP7b: stopAttached(id), stopLoad(id), freightRailCells(), freightLinked(id), sinkTrucks(id), truckVolume(),
 *   depotInfo(id), garageInfo(id), ferryLinks(), ferryPartnersFor(...), stopsNear(...), rampLoad(cell), cellBusRiders(cell),
 *   fleetStats, parkingSummary; connectionReport() (the regional exchange per neighbour connection).
 */
import { Network } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import {
  Fam, Transit, activeJobs, centerCell, detectJobsUnknown, ensureIdFloat, infoOf, isFunctional, jobSlots, nowMs,
  readEffects, setFlagQuiet, wealthOf, type OrdEffects,
  buildingList, fundingFactor, BuildingSnapshot,
} from './common';
import { GraphBuildRun, GridGraph, RoadGraph, findNeighborConnections, perimeterNodes, type NeighborConn } from './graph';
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
import { pieceBudgetUs, pieceUnits, schedulerOf, type InfraTask } from './scheduler';
import { INFRA_PIECE_COLD_MS, INFRA_PIECE_MS, PARKING_BOX_R } from './params';
import { REGION_JOBS_FOR_RESIDENTS } from '../economy/tuning';
import { carlessShare, workerShare } from '../economy/demographics';
import { RoadSearchRun, Search, SearchK, Seeds, TransitSearchRun, accumulateRange, roadSearch, type TransitNet } from './search';
import { StopCollector, TRAFFIC_OF_STATE, copyStopList, isStopMode, type StopList } from './transit';
import { getDef } from '../catalog';
import { computeFerryNet, ferryPartnersAt, type FerryLink, type FerryNet, type FerryPartner, type FerryTerminal } from './ferry';
import {
  addFootprint, addGarageSupply, baseSupplyRange, garageRelief, garageShortage, parkingFromBoxesRange, parkingOver, parkingSummaryOf,
  type ParkingSummary,
} from './parking';
import { BoxVRun, boxHRows } from './blur';
import type { RegionNeighbor } from '../../region/regionEffects';

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
  /** residential (routed 43): its road is cut off from the city's jobs (a road network without a meaningful job pool, no
   *  road to the map edge and no transit option): no commute; reachable = false then (the inspector's "No route to work") */
  cutOff?: boolean;
  reachable?: boolean;
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

/** TrafficSystem.stopLoad: a stop / station / terminal of the last completed assignment */
export interface StopLoad {
  /** riders (boardings + alightings / day, smoothed across assignments), current wait (min), depot (building id, -1 =
   *  none / minibuses) */
  riders: number;
  waitMin: number;
  depotId: number;
  /** residents within walking distance whose nearest jobs are a walk from this stop (they don't ride) */
  walkers?: number;
  /** service ratio of its bus pool (buses / buses needed; bus stops only) */
  rho?: number;
  /** some job is reachable by transit from it (false: no stop / station near any job on its network) */
  reach?: boolean;
  /** P13 (why nobody rides): workers living within a walk of it; those whose best transit trip starts here and the mean
   *  minutes of that trip (to the nearest jobs it reaches; undefined: none); those within a walk whose best trip starts at
   *  another stop */
  near?: number;
  boarders?: number;
  boardMin?: number;
  boardElsewhere?: number;
}

/** TrafficSystem.connectionReport: one neighbour connection of the last completed assignment */
export interface ConnectionReport {
  /** connection cell, map edge, network type (road / rail) */
  cell: number;
  edge: 'n' | 's' | 'e' | 'w';
  type: number;
  /** regional job slots there for our residents, and the residents who took them */
  jobs: number;
  employed: number;
  /** regional workers it may let in (road connections; 0 for rail), and those who came in the last full inbound pass */
  workerCap: number;
  inbound: number;
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
  /** routed 53: the roads changed since the traffic update these choices come from (the reach is still shown: the drive
   *  is searched on today's roads, the choices are the last update's) */
  stale?: boolean;
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
/** B2: a step() handler's "more pieces of this phase follow" (any other value is the next phase) */
const CONT = -100;
const EMPTY_NUMS: number[] = [];
const EMPTY_F64: Float64Array<ArrayBuffer> = new Float64Array(0);
const EMPTY_I32: Int32Array<ArrayBuffer> = new Int32Array(0);
const EMPTY_F32: Float32Array<ArrayBuffer> = new Float32Array(0);
/**
 * traffic's piece budgets (in TC units, see TR_EST): the searches (road, transit, inbound / shop / freight / sinks) at
 * INFRA_PIECE_MS; every other loop at half INFRA_PIECE_COLD_MS. Those loops run once per cycle (or per matching round),
 * so they stay cold for the first 10-15 cycles after a load: 10-37 x their warm cost in days 0-80 at dense1m (G1 runs,
 * and the accept loop's first executions ~45 x). R2's per-loop rule (at most 3 ms at the p99 factor, 5 ms at the max)
 * needs the half budget there.
 */
const COLD = INFRA_PIECE_COLD_MS / 4, WARM = INFRA_PIECE_MS;
/**
 * the sizing floor of the cold loops, in estimated µs per unit (chunk sizes only; the estimates keep the loops' own
 * coefficients): a cold piece holds at most coldUnits(TR_COLD_FLOOR) units (~3,250) however cheap the loop is
 * warm. B2 fix round (the gates' and the verify runs from a load at dense1m): at half INFRA_PIECE_COLD_MS and without a
 * floor, traffic's once-per-cycle loops ran at 50-130 x their warm cost in days 0-80 (traffic runs 2-3 cycles there), so
 * pieces of 13,000 cells or nodes took up to 7.7 ms (parking.2: ~0.6 µs per cell) and the matching's accept, keys and
 * flows pieces 4-7.4 ms; hence a quarter of INFRA_PIECE_COLD_MS and this floor (G2's cold cell floor, x 2.5).
 */
const TR_COLD_FLOOR = 0.01;
/** units of one piece of a cold traffic loop costing `us` per unit (COLD, with the cold sizing floor) */
function coldUnits(us: number): number {
  return pieceUnits(us > TR_COLD_FLOOR ? us : TR_COLD_FLOOR, 1, COLD);
}
/**
 * the absolute scale of the estimates: stepCost = TR_EST x (TC.piece + the piece's units x TC) / 1000. TC sets the
 * relative costs, so (with the budgets above) the chunk sizes; TR_EST turns the estimate into honest warm wall ms without
 * moving a chunk. G1 calibration (Oct 28): the median measured / estimated ms of the traffic pieces in the warm window
 * (days 300-420 after load, dense1m, headless) was 0.79 with TR_EST = 1.
 */
const TR_EST = 0.79;
/**
 * B2 cost model: estimated warm wall µs per work unit of each kind of piece (stepCost = TC.piece + the piece's own work
 * counts x these; chunk sizes = pieceUnits(coefficient, 1, COLD | WARM)). Start values: the trafficfit warm in-schedule
 * fits x ~1.2 (docs/dev/B2_DESIGN.md §9.2); G1 refit (Oct 28): per piece label, the median measured / estimated wall ms
 * of the pieces in days 80-220 after load (dense1m, headless, cpumap, B2 calibration box), applied to the label's
 * dominant coefficient where it was off by more than ~1.3 x. A refit moves the step boundaries, so the headless schedule
 * and the bot — by design. G4 refits on all fixtures.
 */
const TC = {
  /** per piece (dispatch, cursors) */
  piece: 6,
  /** refreshAttach after an edit, per map cell (tunnel / rail component rasters, ferry water paths) */
  attach: 0.0046,
  prepFix: 20,
  nodeTime: 0.058, nodePub: 0.002, rampT: 0.033,
  scanB: 0.14, scanF: 0.035, scanBegin: 0.018, scanPlan: 0.012, scanEnd: 0.003,
  cycleArrays: 0.004, originInit: 0.015, siteNoise: 0.014, clusters: 0.055,
  stopB: 0.03, stopCell: 0.002, depotFix: 10, depotBfs: 0.03,
  stopSetup: 0.003, stopAttach: 0.04, stopRho: 1, stopWait: 0.06, stopBins: 0.01, transfer: 0.21, csr: 0.004, csrCount: 0.004, csrEdge: 0.008,
  garage: 12, publishT: 0.004,
  trSeed: 0.34, trStart: 0.005, trNode: 0.085,
  otFill: 0.002, otOrigin: 0.084, otOriginStop: 0.0052,
  prGarage: 5, prStart: 0.004, prState: 0.23, prRefresh: 0.02, prOption: 0.1,
  // road searches: the matching rounds (SA, ramps + seeds by cluster), the inbound / shop / freight / sinks ones (SB)
  rdStart: 0.005, rdSeed: 0.01, rdNode: 0.080, rdNodeB: 0.052,
  mCand: 0.020, mKey: 0.012, mProp: 0.004, mAccept: 0.068, mNext: 0.004,
  // the candidate radix sort in pieces: the safe-integer scan + max, the histograms, the per-pass prefix sums (per
  // bucket) and scatters (per key)
  sortScan: 0.003, sortHist: 0.009, sortPrefix: 0.002, sortScatter: 0.004,
  accumulate: 0.0065, commit: 0.0062, route: 8,
  poolU: 0.008, poolO: 0.01, poolOrigin: 0.075, poolSite: 0.01,
  ovState: 0.2, ovRec: 0.1, ovPlan: 20,
  commitK: 0.01,
  cePrice: 0.006, ceDist: 0.024, snapGather: 0.015, snapPub: 0.013, garageReport: 3,
  trAccumulate: 0.010, trFlow: 0.010, cutSetup: 0.004, cutOff: 0.005, ceOrigin: 0.019, cutMin: 0.002, byMode: 0.012,
  inCached: 0.01, inDesire: 0.036, inFlow: 0.03, inPost: 2,
  shopOrigin: 0.038, fill: 0.0008,
  frSource: 0.19, truckTime: 0.017, truckCell: 0.0087,
  parkDemand: 0.12, parkSupply: 0.005, parkBox: 0.0033, parkBlend: 0.011, parkGarage: 3,
  finBlend: 0.0043, finRamp: 0.0035, finWrite: 0.0076, finFill: 0.0007, finStop: 0.18, finPub: 0.0008,
  f2Copy: 0.0004, f2Origin: 0.15, f2Site: 0.17, f2Pub: 0.002, event: 0.8,
  saveRamp: 0.004, saveParking: 0.004, savePrice: 0.016, saveAssemble: 0.15, routesTransit: 0.004,
} as const;
/** car-less share: the car / park & ride utility x exp(-MODE_BETA x CARLESS_EXTRA_MIN) */
const CARLESS_K = Math.exp(-MODE_BETA * CARLESS_EXTRA_MIN);
/** transport defs of the WP7b fleet / parking models (per-def data keyed by def id; catalogTypes is read-only) */
const DEPOT_DEFS: Readonly<Record<string, number>> = { civ_bus_depot: DEPOT_BUSES, lm_grand_central: DEPOT_BUSES };
const GARAGE_DEFS: Readonly<Record<string, number>> = { tr_parking_garage: GARAGE_SPACES, lm_grand_central: 2000 };
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
 * of them the fastest such groups within PR_OPTION_MARGIN minutes of their fastest option. Forests are kept (OV_CACHE)
 * and reused by any pass whose groups with room are among a forest's seeds (none of their ranking minutes moved more than
 * PR_SEED_DRIFT, younger than PR_SEARCH_EVERY assignments: its best label of a group with room is the best of those);
 * another pass, with a forest of fewer seeds, while a pass left at least OV_MIN_ROOM people whose node's labels were all
 * full (a group beyond them may have room), at most OV_PASSES per round and OV_SEARCHES fresh searches per assignment —
 * routed 54: beyond them, more passes (up to OV_PASSES_MAX per round, OV_SEARCHES_MAX searches per assignment) while the
 * last pass still placed at least OV_MIN_ROOM riders: every pass reaches about OV_K more groups, so the 4 options + 3
 * passes reached only the 16 nearest groups (25 garages at 4-tile spacing along one line: the last 9 stood empty while
 * the first turned away 7,500 riders at 8x); the extra passes run only while they place riders (steps stay within
 * their estimates — an assignment takes more of them).
 * (OV_K = 4 labels keep most commuters served by the forest of the round's first pass as the nearest groups fill: on
 * a 913k city with 24 garages, 0.6 fresh searches per assignment vs 3.7 with 2 labels, the same riders placed.)
 */
const OV_K = 4;
const OV_PASSES = 3;
const OV_PASSES_MAX = 10;
const OV_MIN_ROOM = 10;
const OV_CACHE = 3;
const OV_SEARCHES = 3;
const OV_SEARCHES_MAX = 8;
const MAX_ENTRIES = 12;
/** routed 43: a road component that is not the one with the most job slots, has no road to the map edge (the region)
 *  and holds fewer job slots than this share of the workers living on it is cut off from the city's jobs — its homes'
 *  few matches (a wind turbine's job on their road) are no commute (markCutOff) */
const CUTOFF_JOB_SHARE = 0.2;
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
  /** routed 43: 1 = the origin's road is cut off from the city's jobs this assignment (markCutOff) */
  private oCut: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** residential building ids cut off in the last completed assignment (routeInfo) */
  private cutIds = new Set<number>();
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
  private stopBinFill: Int32Array<ArrayBuffer> = new Int32Array(0);
  /** stop x / z, parallel to this.stops as of the last stop-bin build (prepTransit); only nearStops and the transfer
   *  pass read them, and every cycle rebuilds the bins before either runs */
  private stX: Float64Array<ArrayBuffer> = new Float64Array(0);
  private stZ: Float64Array<ArrayBuffer> = new Float64Array(0);
  private binN = 0;
  private nodeStop: Int32Array<ArrayBuffer> = new Int32Array(0);
  private nsIdx: Int32Array<ArrayBuffer> = new Int32Array(64);
  private nsDist: Float32Array<ArrayBuffer> = new Float32Array(64);
  private jConnType: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** neighbour connection job sites (jB .. jN - 1): index of their connection in this.conns, and the regional workers
   *  the connection lets in (road connections; placeRegional) */
  private jConnK: Int32Array<ArrayBuffer> = new Int32Array(0);
  private jConnW: Float64Array<ArrayBuffer> = new Float64Array(0);
  private growth = 1;
  private trStartA: Int32Array<ArrayBuffer> = new Int32Array(0);
  // B2: the transfer CSR in pieces (stage, edge cursor, the new edge arrays until they are published in tnet)
  private csrStage = 0;
  private csrCur = 0;
  private csrTo: Int32Array<ArrayBuffer> = EMPTY_I32;
  private csrCost: Float32Array<ArrayBuffer> = EMPTY_F32;
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
  /** F6, per origin this assignment: commuter-minutes by car / transit / walk (their sum = oTimeSum), and of the transit
   *  riders with a car alternative: its car minutes, their transit minutes, those riders (stats.commuteByMode) */
  private oMc: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oMt: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oMw: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oAc: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oAt: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oAw: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** F6: stats.commuteByMode of the assignment (commuteEnd; written with the other stats) */
  private byMode = { car: 0, transit: 0, walk: 0, transitSaved: 0 };
  /** distance (pure minutes) to the nearest open job cluster in the last round the origin took part in */
  private oLastD: Float32Array<ArrayBuffer> = new Float32Array(0);
  private candKey: Float64Array<ArrayBuffer> = new Float64Array(0);
  private candNode: Int32Array<ArrayBuffer> = new Int32Array(0);
  private candSort: Float64Array<ArrayBuffer> = new Float64Array(0);
  private candHist = new Uint32Array(5 * 2048);
  // B2: the radix sort's cursor (sortPiece): stage (0 idle / start, 1 scan, 2 histograms, 3 pass prefix, 4 pass scatter),
  // key cursor, max key, passes, current pass, source / target buffers of the pass
  private srtStage = 0;
  // B2: buildClusters' cursor (clusterPiece: stage, job-site cursor, clusters so far)
  private clStage = 0;
  private clCur = 0;
  private clQN = 0;
  /** B2: prep's per-cycle origin arrays are grown in their own piece (prepPiece8) */
  private pArr = false;
  private srtCur = 0;
  private srtMax = 0;
  private srtPasses = 0;
  private srtP = 0;
  private srtFrom: Float64Array<ArrayBuffer> = EMPTY_F64;
  private srtTo: Float64Array<ArrayBuffer> = EMPTY_F64;
  private routeCand: number[] = [];
  private routeW: number[] = [];
  private routeCum: Float64Array<ArrayBuffer> = new Float64Array(0);
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
  private inDesire: Float32Array<ArrayBuffer> = new Float32Array(0);
  private inBestNode: Int32Array<ArrayBuffer> = new Int32Array(0);
  private inConnSum: Float64Array<ArrayBuffer> = new Float64Array(0);
  private inScale: Float32Array<ArrayBuffer> = new Float32Array(0);
  private inConn: Float64Array<ArrayBuffer> = new Float64Array(0);
  /** regional workers that came in through each road connection (by cell) in the last full inbound pass, and the neighbour
   *  connections of the last completed assignment (connectionReport) */
  private connInbound = new Map<number, number>();
  private connLast: ConnectionReport[] = [];
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
  /** Grand Central keeps one stop/load key, with a separate attachment verdict for each mode. */
  private hubModes = new Map<number, number>();
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
  /** overflow phase: stage (1 overflow search chunks, 3 records re-decided with the pass's forest — a kept forest's
   *  car-leg minutes renewed on demand —, 4 the rest without park & ride, its last chunk with the round's car flows; 0
   *  before the first overflow), pass, record cursor, the round's successor, the cache slot of the
   *  pass's forest, fresh searches this assignment, and the people the pass left that its forest could not serve (all
   *  its labels at their node full, the last within the margin: a group beyond them may have room — another pass) */
  private ovStage = 0;
  private ovPass = 0;
  private ovCur = 0;
  private ovNext = -1;
  private ovSlot = -1;
  private ovSearches = 0;
  private ovExh = 0;
  /** riders the current overflow pass placed at a garage (routed 54: passes beyond OV_PASSES continue while they place) */
  private ovPlaced = 0;
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
  private poolU: Float64Array<ArrayBuffer> = new Float64Array(0);
  private poolO: Float64Array<ArrayBuffer> = new Float64Array(0);
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
  /** per stop this cycle (P13: why a stop carries nobody): workers living within a walk of it, those whose best transit
   *  trip starts there and their transit minutes, those within a walk whose best trip starts at another stop */
  private stNearW: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stBoardW: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stBoardT: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stElseW: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** last completed assignment per stop building id: walkers (see stWalk), a path from the stop rides (stopsNear) */
  private stopWalkers = new Map<number, number>();
  /** last completed assignment per stop building id: workers within a walk, workers whose best transit trip boards there
   *  and their mean transit minutes, workers within a walk who board at another stop (stopLoad: a zero-riders reason) */
  private stopNear = new Map<number, { near: number; board: number; boardMin: number; other: number }>();
  private stopRide = new Map<number, boolean>();
  /** stop building id -> the transit search reached it (a job is reachable by transit from it) in the last assignment */
  private stopReach = new Map<number, boolean>();
  /** mode-split result of the last split() call (shares car / walk to a stop / park & ride / walk, minutes, car-less
   *  extra minutes x share) */
  private mC = 0; private mTW = 0; private mTP = 0; private mW = 0; private mT = 0; private mX = 0;
  /** F6 (stats.commuteByMode): mT by mode — car / transit / walk minutes x share (sum = mT) — and, for the transit share
   *  that has a car alternative, its car minutes, its transit minutes and that share (what transit saves them) */
  private mMc = 0; private mMt = 0; private mMw = 0; private mAc = 0; private mAt = 0; private mAw = 0;
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

  // ---- B2 piece state (docs/dev/B2_DESIGN.md §3). Nothing here is saved (R9): a save never holds a cycle in progress;
  // init() and every cycle end reset the cursors (endCycle), and each stage's first piece sets up its own.
  /** PH_PREP: 0 = the cycle's first PH_PREP piece (decides the rebuild once), 1 = graph rebuild pieces, 2 = prep pieces */
  private rbStage = 0;
  private readonly gb = new GraphBuildRun();
  /** the pass snapshot (R4): taken by prep's scan, walked by the stop collector, released at the cycle end */
  private readonly snap = new BuildingSnapshot();
  private snapOk = false;
  // prep
  private pSub = 0;
  private pCur = 0;
  private pWorkers = 0;
  private nodeTimeB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private scO = 0; private scJ = 0; private scS = 0; private scF = 0; private scK = 0;
  private gScBid: number[] = [];
  private gScEntS: number[] = [];
  private gScEntC: number[] = [];
  /** the scan's transit index (installed as transportB at the scan end; markT / dropT keep it current meanwhile: R2) */
  private transportScan = new Map<number, Building>();
  private scanOpen = false;
  // prepTransit
  private tSub = 0;
  private tCur = 0;
  private readonly stopCol = new StopCollector();
  private stopsB: StopList = { n: 0, bid: new Int32Array(64), mode: new Uint8Array(64), cell: new Int32Array(64) };
  private depotsB: TrafficSystem['depots'] = [];
  private minibusB = { stops: 0, riders: 0, need: 0, rho: BUS_RHO_MAX };
  private stIdxByIdB = new Map<number, number>();
  private stDepotB: Int32Array<ArrayBuffer> = new Int32Array(0);
  private stRhoB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stWaitB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gStopB: Int32Array<ArrayBuffer> = new Int32Array(0);
  private gWalkB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gSpacesB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private gStateB: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private tDRiders: Float64Array<ArrayBuffer> = new Float64Array(0);
  private tDStops: Int32Array<ArrayBuffer> = new Int32Array(0);
  private tRhoOf: Float32Array<ArrayBuffer> = new Float32Array(0);
  private readonly tTmp6 = new Int32Array(6);
  /** LG-02 Grand Central: the attach scratch while a hub exists (2 bus + 4 rail + 4 subway nodes), and this pass's hub
   *  stops with two or more attach nodes, in stop order (their transfers between modes: prepTransitPiece12) */
  private readonly tTmp10 = new Int32Array(10);
  private readonly tHubS: number[] = [];
  private tAn = 0;
  private tNR = 0; private tNRail = 0; private tNSub = 0; private tNFerry = 0; private tNGrid = 0; private tTotal = 0;
  private trFrom: number[] = [];
  private trTo: number[] = [];
  private trCost: number[] = [];
  private tPrN = 0;
  private tPrKey = '';
  private dbHop: Uint16Array<ArrayBuffer> = new Uint16Array(0);
  private dbQ: Int32Array<ArrayBuffer> = new Int32Array(0);
  private dbQh = 0;
  private dbQt = 0;
  // transit / transit2 / park & ride / rounds
  private trSub = 0;
  private trCur = 0;
  private otSub = 0;
  private otCur = 0;
  private prSub = 0;
  private prCur = 0;
  private rsSub = 0;
  private readonly runA = new RoadSearchRun();
  private readonly runT = new TransitSearchRun();
  private readonly runB = new RoadSearchRun();
  private mSub = 0;
  private mCur = 0;
  private mNc = 0; private mMaxD = 1; private mNoRoad = 0; private mM = 1; private mQ = 1;
  private mCarPcu = 1; private mTrBonus = 0; private mOvOn = false;
  private mAccepted = 0; private mCarRound = 0; private mNext = 0;
  // a round's car flows (rfBegin / rfPiece) and a forest's flows (flowBegin / flowPiece)
  private rfStage = 2;
  private rfCar = 0;
  private rfCand: number[] = [];
  private rfW: number[] = [];
  private flS: Search | null = null;
  private flAcc: Float32Array = new Float32Array(0);
  private flCopy: Float32Array | null = null;
  private flRamp: Float32Array | null = null;
  private flPhase = 2;
  private flCur = 0;
  // overflow / commute
  private ovFlow = 0;
  private cmSub = 0;
  private cmCur = 0;
  private cmSaveRound = 0; private cmAvgT = 0; private cmCarPcu = 1; private cmOvOn = false; private cmFlows = false;
  private cmFlowing = false;
  private olF: OvForest | null = null;
  private olCur = 0;
  private ceSub = 0;
  private ceCur = 0;
  private ceE = 0;
  private ceFerry = 0;
  private ceTripsC = 0; private ceTripsT = 0; private ceTripsW = 0; private ceCSum = 0; private ceCW = 0;
  private bmMc = 0; private bmMt = 0; private bmMw = 0; private bmAc = 0; private bmAt = 0; private bmAw = 0; private bmNC = 0; private bmNT = 0; private bmNW = 0;
  private rsEntSB: Int32Array<ArrayBuffer> = new Int32Array(0);
  private rsEntB: Int32Array<ArrayBuffer> = new Int32Array(0);
  private busCellB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private ferryRidersByB = new Map<number, number>();
  private cutComp: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** the transit accumulation's sink calls: stop loads (commuteEnd; created once, not per call) */
  private readonly stopSink = (_j: number, f: number, node: number): void => {
    const s = this.nodeStop[node];
    if (s >= 0) this.stLoad[s] += f;
  };
  // inbound / shop / freight / sinks
  private sfSub = 0;
  private sfCur = 0;
  private sfTot = 0;
  private sfPick = 0;
  private sfSearched = false;
  private inConns: number[] = [];
  private inCand: number[] = [];
  private frCand: number[] = [];
  private frCandNode: number[] = [];
  private truckCellB: Float32Array<ArrayBuffer> = new Float32Array(0);
  // parking
  private pkSub = 0;
  private pkCur = 0;
  private pkPrB: Building[] = [];
  private pkPrQ: number[] = [];
  private readonly pkSums = { wSum: 0, pSum: 0, dCells: 0, high: 0, sTot: 0, dTot: 0 };
  private parkDB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private parkBoxDB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private parkBoxSB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private parkNext: Float32Array<ArrayBuffer> = new Float32Array(0);
  private garageFreeB = new Map<number, number>();
  private bxSrc: Float32Array = new Float32Array(0);
  private bxDst: Float32Array = new Float32Array(0);
  private bxStage = 0;
  private bxRow = 0;
  private readonly boxV = new BoxVRun();
  // final / final2 / save
  private fiSub = 0;
  private fiCur = 0;
  private fiAlpha = 0;
  private fiRa = 0;
  private fiCongSum = 0;
  private fiCongN = 0;
  private rampVolB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private trafficB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private congestionB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private subwayRidersB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stLoadPrevB = new Map<number, number>();
  private stPrPrevB = new Map<number, number>();
  private stopWalkersB = new Map<number, number>();
  private stopNearB = new Map<number, { near: number; board: number; boardMin: number; other: number }>();
  private stopRideB = new Map<number, boolean>();
  private stopReachB = new Map<number, boolean>();
  private f2Sub = 0;
  private f2Cur = 0;
  private commuteB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private cutIdsB = new Set<number>();
  private accessB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private commuteIdB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private reachedB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private carlessB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private carlessMinB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jobFillB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private carsB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private customersB: Float32Array<ArrayBuffer> = new Float32Array(0);
  private modeB: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private f2OFlag: number[] = [];
  private f2JFlag: number[] = [];
  private f2Changed: Building[] = [];
  private f2Cr: ConnectionReport[] = [];
  private svRc: number[] = [];
  private svRv: number[] = [];
  private svPq: Uint8Array<ArrayBuffer> | null = null;
  private svSinks: [number, number][] = [];
  /** the transport save built in final2's piece 11, installed by its last piece (R9: the cycle's last write) */
  private svSave: TransportSave | null = null;
  private svJobIds: Int32Array<ArrayBuffer> = new Int32Array(0);
  private svJobPrice: Float32Array<ArrayBuffer> = new Float32Array(0);
  private svConnCells: Int32Array<ArrayBuffer> = new Int32Array(0);
  private svConnPrice: Float32Array<ArrayBuffer> = new Float32Array(0);
  private srNext: SampleRoute[] = [];
  /** findPath's BFS scratch (pre-B2 it used SB, the inbound / shop / freight search a resumable run now holds) */
  private SP = new Search();

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
    // B2: a cycle in progress is dropped with every piece cursor (replaceState / reload: R3 d)
    this.endCycle();
    const ev = sim.events;
    // WP7b: stop attachment / freight rail links / ferry links depend on transport buildings, roads, tunnels, water (B2:
    // while prep's scan rebuilds the index privately, its copy too — R2)
    const markT = (b: Building) => {
      if (getDef(b.def)?.category !== 'transport' && b.def !== 'lm_grand_central') return;
      this.attachDirty = true;
      this.transportB.set(b.id, b);
      if (this.scanOpen) this.transportScan.set(b.id, b);
    };
    const dropT = (b: Building) => {
      if (this.transportB.delete(b.id) || getDef(b.def)?.category === 'transport') this.attachDirty = true;
      if (this.scanOpen) this.transportScan.delete(b.id);
    };
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
    this.stopNear.clear();
    this.stopRide.clear();
    this.stopReach.clear();
    this.connInbound.clear();
    this.connLast = [];
    this.cutIds.clear();
    this.carlessById.fill(0);
    this.carlessMinById.fill(0);
    this.restoreTransport(sim.state);
    sim.state.systemData.infraVersion = 1;
    this.graphDirty = true;
    this.phase = -1;
    this.iter = 0;
    this.cycles = 0;
    this.accessById.fill(-1);
    this.commuteById.fill(0);
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

  /**
   * estimated warm wall ms of the next step (B2 §9: the next piece's own work counts x the TC coefficients; the same
   * chunk sizes as the piece). Pure and O(1): it reads the cursors and sizes, never runs a loop, never sets anything up.
   */
  stepCost(sim: Simulation): number {
    return (TR_EST * (TC.piece + this.pieceUs(sim))) / 1000;
  }

  /** µs of the next piece (stepCost) */
  private pieceUs(sim: Simulation): number {
    const st = sim.state, g = this.road, n = g.n, C = st.cells;
    const ph = this.phase < 0 ? PH_PREP : this.phase;
    const attachUs = this.attachDirty || this.attachFor !== st ? TC.attach * C : 0;
    const chunk = (us: number, left: number, budget = COLD) => Math.max(0, Math.min(budget === COLD ? coldUnits(us) : pieceUnits(us, 1, budget), left)) * us;
    switch (ph) {
      case PH_PREP: {
        if (this.phase < 0 || this.rbStage === 0) {
          if (this.graphDirty || g.N !== st.size) return TC.fill * 3 * C;
          return attachUs > 0 ? attachUs : TC.prepFix;
        }
        if (this.rbStage === 1) {
          if (this.gb.stage >= 10) return this.gb.publishUs();
          if (this.gb.active) return Math.min(pieceBudgetUs(COLD), this.gb.remainingUs());
        }
        switch (this.rbStage === 1 ? 0 : this.pSub) {
          case 0: return attachUs > 0 ? attachUs : TC.prepFix;
          case 1: return TC.prepFix;
          case 2: return chunk(TC.nodeTime, n - this.pCur);
          case 3: return n * TC.nodePub + this.SPK.K * n * TC.fill;
          case 4: return chunk(TC.rampT, n - this.pCur) + (this.rail.n + this.subway.n) * TC.fill;
          case 5: return this.pCur === 0 ? st.buildings.size * TC.scanBegin : chunk(TC.scanPlan, this.snap.n - this.snap.planned);
          case 6: return this.snap.countOf(this.pCur) * TC.scanB + this.snap.cellsOf(this.pCur) * TC.scanF;
          case 7: return (this.scO + this.scJ) * TC.scanEnd + this.conns.length * 0.5;
          case 8: return this.pCur === 0 && !this.pArr ? this.oN * TC.cycleArrays + 20 : chunk(TC.originInit, this.oN - this.pCur);
          case 9: return this.jN * TC.siteNoise;
          default: return this.clStage === 0 ? n * TC.fill + 20 : chunk(TC.clusters, this.jN - this.clCur) + (this.clCur + coldUnits(TC.clusters) >= this.jN ? this.jN * TC.fill * 8 + 10 : 0);
        }
      }
      case PH_PREP2: {
        const stB = this.stopsB.n;
        switch (this.tSub) {
          case 0: return attachUs > 0 ? attachUs : chunk(TC.stopB, this.snapOk ? this.snap.n : st.buildings.size);
          case 1: case 2: return chunk(TC.stopB, (this.snapOk ? this.snap.n : st.buildings.size) - this.stopCol.bi);
          case 3: return chunk(TC.stopCell, C - this.stopCol.ci);
          case 4: return TC.depotFix + this.depotB.length * 2;
          case 5: return n * TC.fill + this.depotB.length * 5;
          case 6: return chunk(TC.depotBfs, Math.max(1, this.dbQt - this.dbQh));
          case 7: return (stB + this.tTotal) * TC.stopSetup;
          case 8: return chunk(TC.stopAttach, stB - this.tCur);
          case 9: return (this.depotsB.length + 1) * TC.stopRho;
          case 10: return chunk(TC.stopWait, stB - this.tCur);
          case 11: return stB * TC.stopBins + (C >> 6) * TC.fill;
          case 12: return chunk(TC.transfer, stB - this.tCur);
          case 13: return this.csrStage === 0 ? this.tTotal * TC.csr + this.trFrom.length * TC.csrCount : this.csrStage === 1 ? chunk(TC.csrEdge, this.trFrom.length - this.csrCur) : this.tTotal * TC.csr + this.tNR * TC.fill * 2;
          case 14: return this.gN * TC.garage;
          default: return stB * TC.publishT + this.gN;
        }
      }
      case PH_TRANSIT: {
        const total = this.tnet ? this.tnet.total : n;
        switch (this.trSub) {
          case 0: return this.stops.n === 0 ? total * TC.trStart : chunk(TC.trSeed, this.jN, WARM);
          case 1: return chunk(TC.trSeed, this.jN - this.trCur, WARM);
          case 2: return total * TC.trStart + this.seeds.n * TC.rdSeed;
          case 3: return chunk(TC.trNode, total - this.runT.settled, WARM);
          default: return this.otPieceUs();
        }
      }
      case PH_TRANSIT2: return this.otPieceUs();
      case PH_PARKRIDE: {
        switch (this.prStage) {
          case 0: return this.prSub === 0 ? this.gN * TC.prGarage : this.SPK.K * n * TC.prStart + this.gN * 2;
          case 1: return chunk(TC.prState, Math.max(1, this.SPK.K * n - this.SPK.settled));
          case 3: return chunk(TC.prRefresh, Math.max(1, this.SPK.settled - (this.prSub === 1 ? this.prCur : 0)));
          default: return chunk(TC.prOption, this.oN - this.prCur);
        }
      }
      case PH_RSEARCH:
        return this.rsSub === 0 ? n * TC.rdStart + this.qN * TC.rdSeed : chunk(TC.rdNode, n - this.runA.settled, WARM);
      case PH_RMATCH: {
        const nc = this.mNc;
        switch (this.mSub) {
          case 0: return chunk(TC.mCand, this.oN - this.mCur);
          case 1: return chunk(TC.mKey, nc - this.mCur);
          case 2: return this.sortPieceUs(nc);
          case 3: return (this.round === 0 ? nc * TC.mProp : 0) + this.gN;
          case 4: return chunk(TC.mAccept, nc - this.mCur);
          case 5: return this.oN * TC.mNext * (this.mNoRoad > 0 ? 2 : 1) + this.qN * TC.mNext + (this.pnN > 0 ? TC.ovPlan : 0);
          default: return this.rfPieceUs();
        }
      }
      case PH_PROVER: {
        if (this.ovFlow === 1) return this.rfPieceUs();
        if (this.ovStage === 1) {
          const S = this.ov[this.ovSlot]?.S;
          return chunk(TC.ovState, S ? Math.max(1, S.K * n - S.settled) : coldUnits(TC.ovState));
        }
        return chunk(TC.ovRec, this.pnN - this.ovCur) + (this.ovCur + coldUnits(TC.ovRec) >= this.pnN ? TC.ovPlan : 0);
      }
      case PH_COMMUTE: {
        if (this.commuteStage === 0) {
          if (this.cmFlowing) return this.flowPieceUs();
          switch (this.cmSub) {
            case 0: return this.oN * TC.poolU;
            case 1: return this.qN * TC.poolO + this.oN * TC.poolU;
            case 2: return chunk(TC.poolOrigin, this.oN - this.cmCur);
            default: return this.qN * TC.poolSite;
          }
        }
        if (this.ceSub === 0) {
          const f = this.olF ?? this.ov.find((x) => x.dirty);
          if (f) return chunk(TC.commitK, this.olF ? this.olCur : f.S.settled);
        }
        switch (this.ceSub) {
          case 0: return this.oN * TC.cePrice + this.qN * TC.cePrice * 4;
          case 1: return this.jN * TC.ceDist;
          case 2: return chunk(TC.commitK, this.ceCur);
          case 3: return chunk(TC.snapGather, this.oN - this.ceCur);
          case 4: return this.gN * TC.garageReport + this.oN * TC.snapPub;
          case 5: return chunk(TC.trAccumulate, this.ceCur);
          case 6: return C * TC.fill;
          case 7: return chunk(TC.trFlow, this.ST.settled - this.ceCur);
          case 8: return (this.oN + this.qN + this.jN) * TC.cutSetup;
          case 9: return chunk(TC.cutOff, this.oN - this.ceCur);
          case 10: return chunk(TC.ceOrigin, this.oN - this.ceCur);
          case 11: return chunk(TC.cutMin, this.oN - this.ceCur);
          default: return chunk(TC.byMode, this.oN - this.ceCur);
        }
      }
      case PH_INBOUND: {
        switch (this.sfSub) {
          case 0: return !this.sfRecompute ? this.inCachedUs() : this.sfCur === 0 ? n * 2 * TC.fill + this.jB * TC.fill * 4 : n * TC.rdStart + (this.jN - this.jB) * TC.rdSeed;
          case 1: return chunk(TC.rdNodeB, n - this.runB.settled, WARM);
          case 2: return this.jB * TC.inDesire;
          case 3: return n * TC.fill + this.jB * TC.inFlow;
          case 4: return this.flowPieceUs();
          default: return TC.inPost + Math.min(12, this.inCand.length) * TC.route;
        }
      }
      case PH_SHOP: {
        switch (this.sfSub) {
          case 0: return this.sfRecompute ? n * (TC.fill + TC.rdStart) + this.sN * 0.02 : chunk(TC.fill * 2, n - this.sfCur);
          case 1: return chunk(TC.rdNodeB, n - this.runB.settled, WARM) + n * TC.fill;
          case 2: return chunk(TC.shopOrigin, this.oN - this.sfCur);
          default: return this.flowPieceUs();
        }
      }
      case PH_FREIGHT: {
        switch (this.sfSub) {
          case 0: return this.sfRecompute ? n * TC.fill + this.kN * 0.02 + this.fN * TC.fill : chunk(TC.fill * 2, n - this.sfCur);
          case 1: return this.sfCur < 0 ? n * TC.rdStart + this.seeds.n * TC.rdSeed : chunk(TC.truckTime, n - this.sfCur);
          case 2: return chunk(TC.rdNodeB, n - this.runB.settled, WARM);
          case 3: return n * TC.fill + this.fN * TC.frSource;
          case 4: return this.flowPieceUs() + C * TC.fill;
          case 5: return chunk(TC.truckCell, n - this.sfCur, WARM);
          default: return Math.min(20, this.frCand.length) * TC.route + this.frCand.length * TC.fill;
        }
      }
      case PH_SINKS:
        return this.sfSub === 0 ? this.sinkK.length * 0.05 + n * TC.rdStart : this.sfSub === 1 ? chunk(TC.rdNodeB, n - this.runB.settled, WARM) : this.fN * 0.02;
      case PH_PARKING: {
        switch (this.pkSub) {
          case 0: return C * TC.fill * (this.parkDB.length !== C ? 4 : 1);
          case 1: return chunk(TC.parkDemand, this.jB + this.sN - this.pkCur);
          case 2: return chunk(TC.parkSupply, C - this.pkCur);
          case 3: return this.gN * TC.parkGarage;
          case 4: case 5: case 7: {
            const N = st.size, rows = Math.max(1, Math.floor(coldUnits(TC.parkBox) / Math.max(1, N)));
            const done = this.bxStage === 0 ? this.bxRow : this.boxV.z;
            return Math.max(1, Math.min(rows, N - done)) * N * TC.parkBox + (this.pkSub === 7 && this.bxStage === 1 && done + rows >= N ? C * TC.fill * 2 : 0);
          }
          case 6: return this.pkPrB.length * 30;
          case 8: return chunk(TC.parkBlend, C - this.pkCur);
          default: return C * TC.finPub;
        }
      }
      case PH_FINAL: {
        switch (this.fiSub) {
          case 0: case 1: return chunk(TC.finBlend, n - (this.fiSub === 1 ? this.fiCur : 0));
          case 2: return chunk(TC.finBlend, this.rail.n - this.fiCur) + C * TC.fill;
          case 3: return chunk(TC.finRamp, n - this.fiCur) + C * TC.fill * 2;
          case 4: return chunk(TC.finWrite, n - this.fiCur);
          case 5: return chunk(TC.finWrite, this.rail.n - this.fiCur) + C * TC.fill + this.subway.n * TC.fill;
          case 6: return chunk(TC.finStop, this.stops.n - this.fiCur);
          default: return 2 * C * TC.finPub + this.depots.length + this.gN;
        }
      }
      case PH_FINAL2: {
        switch (this.f2Sub) {
          case 0: return 9 * this.accessById.length * TC.f2Copy + C * TC.fill;
          case 1: return chunk(TC.f2Origin, this.oN - this.f2Cur);
          case 2: return chunk(TC.f2Site, this.jB - this.f2Cur);
          case 3: return this.sN * TC.fill * 4 + (this.jN - this.jB) * 2;
          // (the publish piece also emits the flags' events: one per candidate pair)
          case 4: return C * TC.finPub + (this.f2OFlag.length + this.f2JFlag.length) * (0.05 + TC.event / 2);
          case 6: return chunk(TC.saveRamp, n - this.f2Cur);
          case 7: return this.svPq ? chunk(TC.saveParking, C - this.f2Cur) : 1;
          case 8: return this.jN * TC.savePrice + this.sinkIds.length;
          case 9: return this.oN * TC.routesTransit + 24 * TC.route;
          case 10: return (this.stationIds.length > 0 ? 4 * this.rail.n * TC.fill * 4 : 0) + 10 * TC.route;
          case 11: return (this.stLoadPrev.size + this.stPrPrev.size + this.busNeed.size + this.garageLoad.size) * TC.saveAssemble + this.svRc.length * TC.fill * 2 + 20;
          default: return 10;
        }
      }
      default: return 50;
    }
  }

  private otPieceUs(): number {
    const total = this.tnet ? this.tnet.total : this.road.n;
    switch (this.otSub) {
      case 0: return total * TC.otFill + this.stops.n * TC.fill * 5;
      case 1: { const us = this.otOriginUs(); return Math.max(0, Math.min(coldUnits(us), this.oN - this.otCur)) * us; }
      default: return (this.road.n + total) * TC.fill;
    }
  }

  /** the cached inbound piece's estimate (inboundCachedPiece: the job sites, the cached volumes, the ramp flows) */
  private inCachedUs(): number {
    const n = this.road.n, jB = this.jB, c = this.sfCur;
    if (c < jB) return Math.min(coldUnits(TC.inCached), jB - c) * TC.inCached;
    const end = jB + n + (this.rampSF.length >= n ? n : 0);
    const e = Math.min(end, c + coldUnits(TC.fill * 2));
    return (c - jB < n ? Math.min(e, jB + n) - c : e - c) * TC.fill * 2;
  }

  private flowPieceUs(): number {
    const S = this.flS;
    if (!S) return 0;
    if (this.flPhase === 0) return Math.min(coldUnits(TC.accumulate), this.flCur) * TC.accumulate;
    return Math.min(coldUnits(TC.commit), Math.max(0, S.settled - this.flCur)) * TC.commit;
  }

  private rfPieceUs(): number {
    if (this.rfStage === 0) return this.flowPieceUs();
    return Math.min(10, this.rfCand.length) * TC.route + this.rfCand.length * TC.fill;
  }

  /** B2: the name of the next piece ('prep.scan#3'), for the step tools (b2work cpumap / profile labels) */
  get stepName(): string {
    const ph = this.phase;
    if (ph < 0) return 'idle';
    switch (ph) {
      case PH_PREP:
        if (this.rbStage === 0) return this.graphDirty || this.road.N !== this.lastState?.size ? 'prep.rb0' : 'prep.p0';
        if (this.rbStage === 1) return this.gb.stage >= 10 ? 'prep.rbPublish' : `prep.rb${this.gb.stage}`;
        return ['prep.attach', 'prep.p0b', 'prep.nodeTime', 'prep.nodePub', 'prep.ramp', 'prep.scanBegin', 'prep.scan', 'prep.scanEnd', 'prep.origins', 'prep.noise', 'prep.clusters'][this.pSub] + (this.pSub === 6 ? '#' + this.pCur : this.pSub === 5 && this.pCur === 1 ? 'Plan' : '');
      case PH_PREP2:
        return 'prepTransit.' + (['attach', 'begin', 'stopsB', 'stopsC', 'depots', 'depotBfs0', 'depotBfs', 'stopSetup', 'stopAttach', 'rho', 'waits', 'bins', 'transfers', 'csr', 'garages', 'publish'][this.tSub] ?? this.tSub);
      case PH_TRANSIT: return 'transit.' + (['start', 'seeds', 'searchStart', 'search', 'options'][this.trSub] ?? this.trSub);
      case PH_TRANSIT2: return 'transit2.' + (['fills', 'origins', 'end'][this.otSub] ?? this.otSub);
      case PH_PARKRIDE: return 'parkRide.' + (this.prStage === 0 ? (this.prSub === 0 ? 'garages' : 'start') : this.prStage === 1 ? 'search' : this.prStage === 3 ? 'refresh' : 'options');
      case PH_RSEARCH: return this.rsSub === 0 ? 'roundSearch.start' : 'roundSearch.search';
      case PH_RMATCH: return 'roundMatch.' + (['candidates', 'keys', 'sort', 'proposals', 'accept', 'next', 'flows'][this.mSub] ?? this.mSub) + (this.mSub === 2 ? String(this.srtStage) : '');
      case PH_PROVER: return 'overflow.' + (this.ovFlow === 1 ? 'flows' : this.ovStage === 1 ? 'search' : this.ovStage === 3 ? 'alloc' : 'rest');
      case PH_COMMUTE:
        if (this.commuteStage === 0) return this.cmFlowing ? 'commute.poolFlows' : 'commute.pool' + this.cmSub;
        if (this.ceSub === 0 && (this.olF || this.ov.some((x) => x.dirty))) return 'commute.ovLegs';
        return 'commute.end' + this.ceSub;
      case PH_INBOUND: return this.sfSub === 0 && !this.sfRecompute ? (this.sfCur < this.jB ? 'inbound.cachedSites' : this.sfCur < this.jB + this.road.n ? 'inbound.cachedVol' : 'inbound.cachedRamp') : 'inbound.' + this.sfSub;
      case PH_SHOP: return this.sfSub === 0 && !this.sfRecompute ? 'shop.cached' : 'shop.' + this.sfSub;
      case PH_FREIGHT: return this.sfSub === 0 && !this.sfRecompute ? 'freight.cached' : 'freight.' + this.sfSub;
      case PH_SINKS: return 'sinks.' + this.sfSub;
      case PH_PARKING: return 'parking.' + this.pkSub;
      case PH_FINAL: return 'final.' + this.fiSub;
      case PH_FINAL2: return 'final2.' + this.f2Sub;
      default: return String(ph);
    }
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
    const cut = this.cutIds.has(buildingId);
    if (m === 0 && this.reachedById[buildingId] === 0 && this.commuteById[buildingId] === 0 && !cut) return null;
    const r: RouteInfo = { commuteMin: this.commuteById[buildingId], mode: MODE_NAMES[m] ?? 'none', jobsReached: Math.round(this.reachedById[buildingId]) };
    if (cut) { r.cutOff = true; r.reachable = false; r.mode = 'none'; r.commuteMin = 0; }
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
  /** the neighbour connections of the last completed assignment and the regional exchange through each (final fixes
   *  F1: a founded neighbour's jobs / workers come only through the connections facing it — placeRegional) */
  connectionReport(): ConnectionReport[] {
    return this.connLast.map((c) => ({ ...c }));
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
  /** Grand Central's connected modes; a road does not activate its lone rail or subway line. */
  hubModeAttached(id: number, mode: Transit): boolean {
    const st = this.lastState;
    if (st) this.refreshAttach(st);
    return ((this.hubModes.get(id) ?? 0) & (1 << mode)) !== 0;
  }
  /**
   * B2 (G2, design review 2 item 5e): estimated warm ms of the lazy attachment refresh the next stopAttached /
   * freightRailCells call would run (0 when it is current). Other tasks run it in a piece of their own while it is
   * pending (stopAttached(-1)), so it never lands inside one of their loop pieces. Pure.
   */
  attachRefreshMs(st: CityState): number {
    const cur = this.lastState;
    if (!cur) return 0;
    return this.attachDirty || this.attachFor !== cur ? (TR_EST * (TC.piece + TC.attach * st.cells)) / 1000 : 0;
  }
  /**
   * riders (boardings + alightings / day, smoothed across assignments), current wait (min), the depot (building id, -1 =
   * none / minibuses) of a stop building, walkers = residents within walking distance whose nearest jobs are a walk from
   * this stop (they don't ride: last assignment), rho = the service ratio of its bus pool (buses / buses needed; bus
   * stops only) and reach = some job is reachable by transit from it (false: no stop / station near any job on its
   * network); null = not a stop (or not seen by an assignment yet)
   */
  stopLoad(id: number): StopLoad | null {
    const s = this.stIdxById.get(id);
    if (s === undefined || s >= this.stops.n || this.stops.bid[s] !== id) return null;
    const d = this.stDepot[s];
    const nb = this.stopNear.get(id);
    const out: StopLoad = {
      riders: this.stLoadPrev.get(id) ?? 0, waitMin: this.stWait[s], depotId: d >= 0 && d < this.depots.length ? this.depots[d].id : -1,
      walkers: this.stopWalkers.get(id) ?? 0, reach: this.stopReach.get(id),
      near: nb?.near ?? 0, boarders: nb?.board ?? 0, boardMin: nb && nb.board > 0 ? nb.boardMin : undefined, boardElsewhere: nb?.other ?? 0,
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
    const g = this.road;
    const rs = this.rs;
    const copy = (c: GarageReach): GarageReach => ({
      workers: c.workers, homes: c.homes, ovTo: c.ovTo, ovShare: c.ovShare, via: c.via, viaRoom: c.viaRoom, slower: c.slower, options: c.options,
      others: c.others, own: c.own, full: c.full, opts: c.opts.slice(), optsRoom: c.optsRoom.slice(), stale: !!rs && g.version !== rs.ver,
    });
    if (!rs) return c ? copy(c) : null;
    if (c && c.cycle === rs.tick) return copy(c);
    let q = -1;
    for (let k = 0; k < rs.gN; k++) if (rs.gBid[k] === id) { q = k; break; }
    // (a garage newer than the snapshot, or not park & ride then: what was known). Routed 53: the snapshot keeps road
    // cells, not node ids, so a road / tunnel edit since — a graph rebuild — still finds the drive on today's roads
    // (it used to read "Not picked yet" until the next update completed)
    if (q < 0 || !(rs.gRank[q] < Infinity)) return c ? copy(c) : null;
    let workers = 0, homes = 0, via = -1, slower = 0, options = 0, others = 0, own = 0, full = 0, viaRoom = -1, ovTo = -1, ovShare = 0;
    let opts: number[] = [], optsRoom: number[] = [];
    const nodeOf = g.nodeOfCell, nCells = nodeOf.length;
    let gSeeds = 0;
    const seeds = new Seeds();
    if (g.n > 0) {
      for (let e = rs.gEntS[q], e1 = e + rs.gEntC[q]; e < e1; e++) {
        const c0 = rs.gEnt[e], v = c0 >= 0 && c0 < nCells ? nodeOf[c0] : -1;
        if (v >= 0) { seeds.push(v, 0, 0); gSeeds++; }
      }
    }
    if (gSeeds > 0) {
      const S = (this.SR ??= new Search());
      roadSearch(g, g.rev, g.t0, S, this.heap, seeds, PR_CAR_LEG_MAX, null);
      const ownG = rs.gGrp[q], K = PR_OPTIONS, mine = rs.gRank[q];
      const near: { d: number; o: number }[] = [];
      for (let o = 0; o < rs.n; o++) {
        let d = Infinity;
        for (let e: number = rs.entS[o], e1: number = e + rs.entC[o]; e < e1; e++) {
          const c0: number = rs.ent[e], v: number = c0 >= 0 && c0 < nCells ? nodeOf[c0] : -1;
          if (v >= 0 && v < S.n && S.done[v] === 1 && S.dist[v] < d) d = S.dist[v];
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
    const out: GarageReach = { workers, homes, ovTo, ovShare, via, viaRoom, slower, options, others, own, full, opts, optsRoom, stale: g.version !== rs.ver };
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

  /** r4: the reach snapshot (ReachSnap) of the assignment just completed (commuteEnd; whole state: gather + publish) */
  private snapReach(): void {
    this.ceCur = 0;
    this.ceE = 0;
    this.ceSub = 3;
    while (this.ceSub === 3) this.commuteEndPiece();
    this.snapReachPublish();
  }

  /** the reach snapshot written from the gathered cells (rsEntSB / rsEntB) and the live per-origin / garage arrays: the
   *  pre-B2 snapReach's writes (same growth, same values; the copies are .set()) */
  private snapReachPublish(): void {
    const oN = this.oN, gN = this.gN, K = PR_OPTIONS, ent = this.ent, E = this.ceE;
    const rs: ReachSnap = this.rs ?? (this.rs = {
      tick: 0, ver: -1, n: 0, entS: new Int32Array(0), entC: new Uint8Array(0), ent: new Int32Array(0), w: new Float32Array(0),
      prN: new Uint8Array(0), prG: new Int32Array(0), prA: new Float32Array(0), f0: new Float32Array(0), ovG: new Int32Array(0),
      gN: 0, gBid: new Int32Array(0), gGrp: new Int32Array(0), gRank: new Float32Array(0), gRoom: new Float32Array(0),
      gEntS: new Int32Array(0), gEntC: new Uint8Array(0), gEnt: new Int32Array(0),
    });
    rs.entS = growI32(rs.entS, oN); rs.entC = growU8(rs.entC, oN); rs.ent = growI32(rs.ent, E);
    rs.w = growF32(rs.w, oN); rs.prN = growU8(rs.prN, oN); rs.f0 = growF32(rs.f0, oN); rs.ovG = growI32(rs.ovG, oN);
    rs.prG = growI32(rs.prG, oN * K); rs.prA = growF32(rs.prA, oN * K);
    // (road cells, not node ids: the hint still finds them after a graph rebuild — routed 53)
    const cellOf = this.road.cellOf;
    rs.entS.set(this.rsEntSB.subarray(0, oN));
    rs.entC.set(this.oEntC.subarray(0, oN));
    rs.ent.set(this.rsEntB.subarray(0, E));
    rs.w.set(this.oW.subarray(0, oN)); rs.prN.set(this.oPrN.subarray(0, oN)); rs.f0.set(this.oPrF0.subarray(0, oN));
    rs.ovG.set(this.oOvG.subarray(0, oN)); rs.prG.set(this.oPrG.subarray(0, oN * K)); rs.prA.set(this.oPrA.subarray(0, oN * K));
    let GE = 0;
    for (let q = 0; q < gN; q++) GE += this.gEntC[q];
    rs.gBid = growI32(rs.gBid, gN); rs.gGrp = growI32(rs.gGrp, gN); rs.gRank = growF32(rs.gRank, gN); rs.gRoom = growF32(rs.gRoom, gN);
    rs.gEntS = growI32(rs.gEntS, gN); rs.gEntC = growU8(rs.gEntC, gN); rs.gEnt = growI32(rs.gEnt, GE);
    let e = 0;
    for (let q = 0; q < gN; q++) {
      const c = this.gEntC[q];
      rs.gBid[q] = this.gBid[q];
      rs.gGrp[q] = this.gGrp[q];
      rs.gRank[q] = this.gState[q] === GARAGE_PR ? this.gRank[q] : Infinity;
      rs.gRoom[q] = Math.max(0, this.gSpaces[q] - this.gRes[q]);
      rs.gEntS[q] = e;
      rs.gEntC[q] = c;
      for (let x = this.gEntS[q], x1 = x + c; x < x1; x++) rs.gEnt[e++] = cellOf[ent[x]];
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
  /**
   * plop preview: partners a ferry terminal at (x, z, w, d, rot) would link to. `refresh: false` (queries and previews)
   * reads the last refresh's terminals: a read must not move when this system recomputes its attachments, or the
   * simulation's own later passes would depend on when the player looked (W1.1b querySideEffects)
   */
  ferryPartnersFor(st: CityState, x: number, z: number, w: number, d: number, rot: number, refresh = true): FerryPartner[] {
    if (refresh) this.refreshAttach(st);
    return ferryPartnersAt(st, this.ferryTerms, x, z, w, d, rot);
  }
  /**
   * attached stops within r cells (+ half the footprint) of a footprint (garage preview), nearest first; ride = a
   * transit path from the stop rides a vehicle in the last assignment (false: its riders walk to jobs beside it — a
   * garage there is parking only, no park & ride; undefined: not assessed yet). `refresh: false` (queries and previews):
   * the attachments of the last refresh, as ferryPartnersFor
   */
  stopsNear(st: CityState, x: number, z: number, w: number, d: number, r = PR_STOP_RADIUS, refresh = true): { id: number; mode: number; dist: number; ride?: boolean }[] {
    if (refresh) this.refreshAttach(st);
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
    // (its own scratch: fire dispatch calls it between two pieces of a resumable search on SB — R8)
    const S = this.SP;
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
  /**
   * run one step ("piece", B2) of the current cycle (no-op when idle). Every phase id and transition is the pre-B2 one; a
   * phase's work is a sequence of pieces (docs/dev/B2_DESIGN.md §3), one per step, each of about INFRA_PIECE_COLD_MS /
   * INFRA_PIECE_MS estimated ms (stepCost). The phase moves on when its stage reports completion. A phase run in one go
   * (runCycleSync, a whole-state method, or pieces with nothing in between) computes exactly what the pre-B2 step did.
   */
  step(sim: Simulation): void {
    const ph = this.phase;
    if (ph < 0) return;
    const t0 = nowMs();
    let next: number;
    switch (ph) {
      case PH_PREP: next = this.prepStep(sim); break;
      case PH_PREP2: next = this.prepTransitPiece(sim.state) ? NEXT_PHASE[ph] : CONT; break;
      case PH_TRANSIT: next = this.transitPiece() ? NEXT_PHASE[ph] : CONT; break;
      case PH_TRANSIT2: next = this.otPiece() ? NEXT_PHASE[ph] : CONT; break;
      case PH_PARKRIDE: next = this.parkRidePiece(); break;
      case PH_PROVER: next = this.overflowPiece(); break;
      case PH_RSEARCH: next = this.roundSearchPiece() ? NEXT_PHASE[ph] : CONT; break;
      case PH_RMATCH: next = this.roundMatchPiece(); break;
      case PH_COMMUTE: next = this.commutePiece(); break;
      case PH_INBOUND: next = this.inboundPiece() ? NEXT_PHASE[ph] : CONT; break;
      case PH_SHOP: next = this.shopPiece() ? NEXT_PHASE[ph] : CONT; break;
      case PH_FREIGHT: next = this.freightPiece() ? NEXT_PHASE[ph] : CONT; break;
      case PH_SINKS: next = this.sinksPiece() ? NEXT_PHASE[ph] : CONT; break;
      case PH_PARKING: next = this.parkingPiece(sim) ? NEXT_PHASE[ph] : CONT; break;
      case PH_FINAL: next = this.finalPiece(sim) ? NEXT_PHASE[ph] : CONT; break;
      case PH_FINAL2: next = this.final2Piece(sim) ? NEXT_PHASE[ph] : CONT; break;
      default: next = NEXT_PHASE[ph];
    }
    this.phaseMs[ph] += nowMs() - t0;
    if (next === CONT) return;
    // WP7b phases without work this cycle are skipped (no empty scheduler steps)
    while (next >= 0 && this.skipPhase(next)) next = NEXT_PHASE[next];
    this.phase = next;
    if (this.phase < 0) {
      let s = 0;
      for (let i = 0; i < PHASES; i++) s += this.phaseMs[i];
      this.lastCycleMs = s;
      this.endCycle();
    }
  }

  /** B2: the cycle ended (or init / a reload drops it): every piece cursor back to its reset value (R3 d, R9) */
  private endCycle(): void {
    this.rbStage = 0;
    this.pSub = 0; this.pCur = 0;
    this.tSub = 0; this.tCur = 0;
    this.trSub = 0; this.trCur = 0;
    this.otSub = 0; this.otCur = 0;
    this.prSub = 0; this.prCur = 0;
    this.rsSub = 0;
    this.mSub = 0; this.mCur = 0;
    this.srtStage = 0; this.srtFrom = this.srtTo = EMPTY_F64;
    this.clStage = 0; this.pArr = false;
    this.csrStage = 0; this.csrTo = EMPTY_I32; this.csrCost = EMPTY_F32;
    // (cmFlowing too: a replaceState in the middle of the pool's car flows must not carry it into the new city's first
    // cycle, where it would skip the pooled match — fix round, verify-code; an uninterrupted cycle ends with it false)
    this.cmSub = 0; this.cmCur = 0; this.cmFlowing = false;
    this.ceSub = 0; this.ceCur = 0;
    this.olF = null; this.olCur = 0;
    this.ovFlow = 0;
    this.sfSub = 0; this.sfCur = 0;
    this.pkSub = 0; this.pkCur = 0;
    this.fiSub = 0; this.fiCur = 0;
    this.f2Sub = 0; this.f2Cur = 0; this.svSave = null;
    this.flPhase = 2; this.flS = null;
    this.scanOpen = false;
    this.transportScan.clear();
    this.snap.release();
    this.snapOk = false;
    if (this.gb.active) this.gb.cancel();
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

  /** the graphs rebuilt synchronously (findPath on a new map, whole-state prep / tests). A piecewise rebuild of the running
   *  cycle is dropped: these graphs are current (it never re-enters the cycle's pieces — review R3 c) */
  private rebuildGraphs(st: CityState): void {
    if (this.gb.active) this.gb.cancel();
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
  /**
   * PH_PREP (B2 §3 "Rebuild" + "Prep"). The cycle's first PH_PREP piece (rbStage 0) resets phaseMs and decides ONCE
   * whether the graphs are rebuilt (graphDirty or a new map size): a graphDirty set after that waits for the next cycle
   * (R3 a; interrupted mode only — pre-B2 a second rebuild step caught an edit between the rebuild and the prep step).
   * Rebuild: RB0 copies the grids (graphDirty = false), GraphBuildRun pieces build private graphs, RBP publishes them
   * (+ the MSA iteration of a load, as rebuildGraphs). Then the prep pieces (prepPiece).
   */
  private prepStep(sim: Simulation): number {
    const st = sim.state;
    if (this.rbStage === 0) {
      this.phaseMs.fill(0);
      if (this.graphDirty || this.road.N !== st.size) {
        this.rbStage = 1;
        this.gb.begin(st);
        this.graphDirty = false;
        return CONT;
      }
      this.rbStage = 2;
      this.pSub = 0;
    }
    if (this.rbStage === 1) {
      if (this.gb.stage >= 10) {
        this.gb.publish(this.road, this.rail, this.subway);
        // (a load's first build: the saved volumes are of this same network, so the MSA continues the saved iteration)
        this.iter = this.iterLoad;
        this.iterLoad = 0;
        this.rebuiltInCycle = true;
        this.rbStage = 2;
        this.pSub = 0;
        return CONT;
      }
      if (this.gb.active) {
        this.gb.run(pieceBudgetUs(COLD));
        return CONT;
      }
      // (a synchronous rebuildGraphs since — findPath on a new map — dropped the pieces: the graphs are current)
      this.rbStage = 2;
      this.pSub = 0;
    }
    if (this.pSub === 0) this.rebuiltInCycle = false;
    return this.prepPiece(sim) ? NEXT_PHASE[PH_PREP] : CONT;
  }

  /** whole-state prep (tests): a synchronous rebuild when needed, then every prep piece */
  private prep(sim: Simulation): void {
    const st = sim.state;
    if (this.graphDirty || this.road.N !== st.size) this.rebuildGraphs(st);
    this.pSub = 0;
    while (!this.prepPiece(sim)) { /* next piece */ }
  }

  /**
   * one prep piece; true when prep is complete. P0 (lastState, attachment refresh after an edit: its own piece), P0b
   * (ordinances, jobs-unknown, per-id arrays), P1 (BPR node times into a back buffer by node ranges, then published
   * by .set() with the volume fills: nodeTimes is read by other systems), P2 (ramp minutes by node ranges + fills), P3
   * (scan begin: the pass snapshot and its chunk plan, array growth, connections, list resets), the scan chunks (the
   * pre-B2 loop body over the snapshot; garages into a back list, the transit index into a private map), Pz1 (scan end:
   * garages + transit index installed, connections, the regional exchange), Pz2 (per-cycle arrays, origin init by
   * ranges), Pz3a (destination noise — rand() in j order — and capacities), Pz3b (clusters, round / trip resets).
   */
  private prepPiece(sim: Simulation): boolean {
    const st = sim.state;
    if (this.pSub === 0) {
      this.lastState = st;
      this.pSub = 1;
      if (this.attachDirty || this.attachFor !== st) { this.refreshAttach(st); return false; }
    }
    switch (this.pSub) {
      case 1: return this.prepPiece1(sim);
      case 2: return this.prepPiece2(sim);
      case 3: return this.prepPiece3(sim);
      case 4: return this.prepPiece4(sim);
      case 5: return this.prepPiece5(sim);
      case 6: return this.prepPiece6(sim);
      case 7: return this.prepPiece7(sim);
      case 8: return this.prepPiece8(sim);
      case 9: return this.prepPiece9(sim);
      default: return this.prepPieceEnd(sim);
    }
  }

  /** prepPiece, sub-state 1 (B2 R10: one small method per piece kind) */
  private prepPiece1(sim: Simulation): boolean {
    const st = sim.state;
    const g = this.road;
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
    if (this.nodeTimeB.length < g.n) this.nodeTimeB = new Float32Array(g.n + (g.n >> 3) + 16);
    this.pSub = 2;
    this.pCur = 0;
    return false;
  }

  /** prepPiece, sub-state 2 (B2 R10: one small method per piece kind) */
  private prepPiece2(sim: Simulation): boolean {
    const st = sim.state;
    const g = this.road;
    // node times from smoothed volumes (state.traffic per cell), into the back buffer
    const n = g.n, traffic = st.traffic, cellOf = g.cellOf, cap = g.cap, t0 = g.t0, nt = this.nodeTimeB;
    const v0 = this.pCur, v1 = Math.min(n, v0 + coldUnits(TC.nodeTime));
    for (let v = v0; v < v1; v++) {
      const r = traffic[cellOf[v]] / cap[v];
      let f = 1 + BPR_ALPHA * r * r * r * r;
      if (f > BPR_MAX_FACTOR) f = BPR_MAX_FACTOR;
      nt[v] = t0[v] * f;
    }
    this.pCur = v1;
    if (v1 >= n) this.pSub = 3;
    return false;
  }

  /** prepPiece, sub-state 3 (B2 R10: one small method per piece kind) */
  private prepPiece3(sim: Simulation): boolean {
    const st = sim.state;
    const g = this.road;
    const n = g.n;
    this.nodeTime = growF32(this.nodeTime, n);
    this.nodeTime.set(this.nodeTimeB.subarray(0, n));
    this.volNew = growF32(this.volNew, n);
    this.acc = growF32(this.acc, n);
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
    this.pSub = 4;
    this.pCur = 0;
    return false;
  }

  /** prepPiece, sub-state 4 (B2 R10: one small method per piece kind) */
  private prepPiece4(sim: Simulation): boolean {
    const g = this.road;
    const n = g.n, type = g.type, rv = this.rampVolCell, cellOf = g.cellOf, rt = this.rampT;
    const v0 = this.pCur, v1 = Math.min(n, v0 + coldUnits(TC.rampT));
    for (let v = v0; v < v1; v++) rt[v] = type[v] === Network.Highway ? RAMP_PENALTY : rampTime(type[v], rv[cellOf[v]]);
    this.pCur = v1;
    if (v1 < n) return false;
    this.railNew = growF32(this.railNew, this.rail.n);
    this.railNew.fill(0, 0, this.rail.n);
    this.subNew = growF32(this.subNew, this.subway.n);
    this.subNew.fill(0, 0, this.subway.n);
    this.pSub = 5;
    this.pCur = 0;
    return false;
  }

  /** prepPiece, sub-state 5 (B2 R10: one small method per piece kind) */
  private prepPiece5(sim: Simulation): boolean {
    const st = sim.state;
    // P3a the snapshot + growth + list resets, P3b.. the snapshot's chunk plan by building ranges (both O(B))
    if (this.pCur === 0) {
      this.prepScanBegin(st);
      this.snap.planBegin(TC.scanB, TC.scanF, pieceBudgetUs(COLD));
      this.pCur = 1;
      return false;
    }
    if (!this.snap.planRun(coldUnits(TC.scanPlan))) return false;
    this.pSub = this.snap.chunks > 0 ? 6 : 7;
    this.pCur = 0;
    return false;
  }

  /** prepPiece, sub-state 6 (B2 R10: one small method per piece kind) */
  private prepPiece6(sim: Simulation): boolean {
    const st = sim.state;
    this.prepScan(st, this.pCur);
    this.pCur++;
    if (this.pCur >= this.snap.chunks) this.pSub = 7;
    return false;
  }

  /** prepPiece, sub-state 7 (B2 R10: one small method per piece kind) */
  private prepPiece7(sim: Simulation): boolean {
    const st = sim.state;
    this.prepScanEnd(st);
    this.pSub = 8;
    this.pCur = 0;
    return false;
  }

  /** prepPiece, sub-state 8 (B2 R10: one small method per piece kind) */
  private prepPiece8(sim: Simulation): boolean {
    if (this.pCur === 0 && !this.pArr) { this.prepCycleArrays(); this.pArr = true; return false; }
    const oN = this.oN, o0 = this.pCur, o1 = Math.min(oN, o0 + coldUnits(TC.originInit));
    for (let o = o0; o < o1; o++) {
      this.oU[o] = this.oW[o];
      this.oAsg[o] = 0; this.oTimeSum[o] = 0; this.oCarW[o] = 0; this.oTrW[o] = 0; this.oWalkW[o] = 0; this.oClX[o] = 0;
      this.oCarNode[o] = -1;
      this.oLastD[o] = -1;
    }
    this.pCur = o1;
    if (o1 >= oN) { this.pSub = 9; this.pArr = false; }
    return false;
  }

  /** prepPiece, sub-state 9 (B2 R10: one small method per piece kind) */
  private prepPiece9(sim: Simulation): boolean {
    // destination noise, matching capacities (proportional share first when jobs are in surplus)
    const jN = this.jN;
    let slotsAll = 0;
    for (let j = 0; j < jN; j++) {
      this.jNoise[j] = this.rand() * (this.jBid[j] >= 0 ? DEST_NOISE : DEST_NOISE * 0.5);
      this.jAsg[j] = 0;
      this.jPrice[j] = this.jBid[j] >= 0 ? this.priceById[this.jBid[j]] : this.connPrice[this.jCell[j]];
      slotsAll += this.jSlots[j];
    }
    this.propFactor = slotsAll > 0 ? Math.min(1, (MATCH_PROP_SLACK * this.pWorkers) / slotsAll) : 1;
    for (let j = 0; j < jN; j++) this.jCapP[j] = this.jSlots[j] * this.propFactor;
    this.pSub = 10;
    return false;
  }

  /** prepPiece, sub-state default (B2 R10: one small method per piece kind) */
  private prepPieceEnd(sim: Simulation): boolean {
    const g = this.road;
    const jN = this.jN, sN = this.sN;
    if (!this.clusterPiece()) return false;
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
    this.pSub = 0;
    this.pCur = 0;
    return true;
  }

  /** P3a: the pass snapshot (R4), the arrays grown to the snapshot, connections, list resets (P3b plans its chunks) */
  private prepScanBegin(st: CityState): void {
    const snap = this.snap;
    snap.take(st);
    this.snapOk = true;
    this.entN = 0;
    this.scO = this.scJ = this.scS = this.scF = this.scK = 0;
    const cap = snap.n + 16;
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
    this.jConnType = growU8(this.jConnType, jcap); this.jConnK = growI32(this.jConnK, jcap);
    this.sBid = growI32(this.sBid, cap); this.sEntS = growI32(this.sEntS, cap); this.sEntC = growU8(this.sEntC, cap);
    this.fBid = growI32(this.fBid, cap); this.fTrucks = growF32(this.fTrucks, cap); this.fEntS = growI32(this.fEntS, cap);
    this.fEntC = growU8(this.fEntC, cap);
    this.kEntS = growI32(this.kEntS, cap + conns.length); this.kEntC = growU8(this.kEntC, cap + conns.length);
    this.kLabel = growF32(this.kLabel, cap + conns.length);
    this.oCl = growF32(this.oCl, cap); this.jPark = growF32(this.jPark, jcap); this.jCar = growF32(this.jCar, jcap);
    this.jNoDest = growU8(this.jNoDest, jcap);
    this.sCar = growF32(this.sCar, cap);
    this.patrolIds.length = 0;
    this.stationIds.length = 0;
    this.sinkIds.length = 0;
    this.sinkK.length = 0;
    this.depotB.length = 0;
    // (the transit index is rebuilt in a private map, installed at the scan end: an attachment refresh between two scan
    // pieces reads the complete previous one — R2)
    this.transportScan.clear();
    this.scanOpen = true;
    this.gScBid.length = 0; this.gScEntS.length = 0; this.gScEntC.length = 0;
  }

  /** a scan chunk: the pre-B2 building loop over snapshot chunk k */
  private prepScan(st: CityState, k: number): void {
    const snap = this.snap, bL = snap.list, i0 = snap.bounds[k], i1 = snap.bounds[k + 1];
    const N = st.size, nodeOfCell = this.road.nodeOfCell, jobsUnknown = this.jobsUnknown, tB = this.transportScan;
    let oN = this.scO, jN = this.scJ, sN = this.scS, fN = this.scF, kN = this.scK;
    for (let bI = i0; bI < i1; bI++) {
      const b = bL[bI];
      const inf = infoOf(st, b);
      if (inf.transit !== Transit.None) tB.set(b.id, b);
      if (inf.fam === Fam.Plop && isFunctional(b)) {
        if (inf.cov === 0 || inf.cov === 2 || inf.garbageCap > 0) this.patrolIds.push(b.id);
        if (inf.transit === Transit.Freight || inf.transit === Transit.Train || inf.transit === Transit.Hub) this.stationIds.push(b.id);
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
      if (DEPOT_DEFS[b.def] !== undefined && isFunctional(b) && (inf.transit !== Transit.Hub || ((this.hubModes.get(b.id) ?? 0) & (1 << Transit.Bus)) !== 0)) this.depotB.push(b);
      // parking garages (WP7-7 / WP7-8): into the back list (garageInfo reads gN / gBid: they change at the scan end)
      if (GARAGE_DEFS[b.def] !== undefined && isFunctional(b) && (inf.transit !== Transit.Hub || this.attach.get(b.id) === 1)) {
        const e0 = this.entN, c = this.addEntries(nodeOfCell, N, b);
        this.gScBid.push(b.id); this.gScEntS.push(e0); this.gScEntC.push(c);
      }
    }
    this.scO = oN; this.scJ = jN; this.scS = sN; this.scF = fN; this.scK = kN;
  }

  /** Pz1: the scan's garages and transit index installed, connections, counts, the regional exchange */
  private prepScanEnd(st: CityState): void {
    const N = st.size, nodeOfCell = this.road.nodeOfCell;
    // (the pre-B2 garage writes, replayed: the same growth and values as during the scan)
    this.gBid = growI32(this.gBid, 16); this.gEntS = growI32(this.gEntS, 16); this.gEntC = growU8(this.gEntC, 16);
    const gN = this.gScBid.length;
    for (let q = 0; q < gN; q++) {
      if (q >= this.gBid.length) { this.gBid = growI32(this.gBid, q * 2); this.gEntS = growI32(this.gEntS, q * 2); this.gEntC = growU8(this.gEntC, q * 2); }
      this.gBid[q] = this.gScBid[q];
      this.gEntS[q] = this.gScEntS[q];
      this.gEntC[q] = this.gScEntC[q];
    }
    this.gN = gN;
    let jN = this.scJ, kN = this.scK;
    const oN = this.scO, sN = this.scS, fN = this.scF;
    this.jB = jN;
    this.jObj.length = jN;
    this.sObj.length = sN;
    const tb = this.transportB;
    this.transportB = this.transportScan;
    this.transportScan = tb;
    tb.clear();
    this.transportFor = st;
    this.scanOpen = false;
    // neighbour connections: regional job sources + freight sinks
    const conns = this.conns;
    const growth = (this.growth = 1 + Math.min(3, st.stats.population / 250000));
    for (let ci = 0; ci < conns.length; ci++) {
      const c = conns[ci];
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
        this.jConnK[jN] = ci;
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
      this.jConnK[jN] = ci;
      this.jEntS[jN] = this.entN;
      this.jEntC[jN] = 1;
      jN++;
      this.kEntS[kN] = this.entN;
      this.kEntC[kN] = 1;
      this.kLabel[kN] = 3;
      kN++;
      this.entN++;
    }
    void N;
    this.oN = oN; this.jN = jN; this.sN = sN; this.fN = fN; this.kN = kN;
    // regional exchange on the connections (job slots for our residents, workers coming in)
    let workers = 0, citySlots = 0;
    for (let o = 0; o < oN; o++) workers += this.oW[o];
    for (let j = 0; j < this.jB; j++) citySlots += this.jSlots[j];
    for (let j = this.jB; j < jN; j++) this.jPark[j] = 0;
    this.pWorkers = workers;
    this.placeRegional(st, workers, citySlots);
  }

  /** Pz2 (first piece): the per-cycle result arrays and the assignment's overflow state */
  private prepCycleArrays(): void {
    const oN = this.oN;
    this.oCarNode = growI32(this.oCarNode, oN); this.oBoard = growI32(this.oBoard, oN);
    this.oShC = growF32(this.oShC, oN); this.oShT = growF32(this.oShT, oN); this.oShW = growF32(this.oShW, oN);
    this.oTime = growF32(this.oTime, oN); this.oEmp = growF32(this.oEmp, oN);
    this.oJobT = growI32(this.oJobT, oN);
    this.oU = growF32(this.oU, oN); this.oAsg = growF32(this.oAsg, oN); this.oTimeSum = growF32(this.oTimeSum, oN);
    this.oCarW = growF32(this.oCarW, oN); this.oTrW = growF32(this.oTrW, oN); this.oWalkW = growF32(this.oWalkW, oN);
    this.oTrT = growF32(this.oTrT, oN); this.oBoardStop = growI32(this.oBoardStop, oN);
    this.oMc = growF32(this.oMc, oN); this.oMt = growF32(this.oMt, oN); this.oMw = growF32(this.oMw, oN);
    this.oAc = growF32(this.oAc, oN); this.oAt = growF32(this.oAt, oN); this.oAw = growF32(this.oAw, oN);
    this.oMc.fill(0, 0, oN); this.oMt.fill(0, 0, oN); this.oMw.fill(0, 0, oN); this.oAc.fill(0, 0, oN); this.oAt.fill(0, 0, oN); this.oAw.fill(0, 0, oN);
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
  }

  /**
   * The regional exchange on the neighbour connections (job sites jB .. jN - 1): the regional job slots they offer our
   * residents (jSlots; the scan set CONNECTION_JOBS x growth) and the regional workers each road connection lets in
   * (jConnW, the inbound pass). Totals follow sim-core's employment model (params REGION_* = economy/tuning
   * REGION_COMMUTERS_*), so workerAccess / jobFill agree with stats.unemployment; state.systemData.regionJobs /
   * regionWorkers (the region layer) override them. The region at large (the default formulas; with the region layer
   * its totals minus the founded neighbours' own shares) is spread over every connection by capacity (CONNECTION_JOBS /
   * _WORKERS x growth), scaled down to its total, never up. Final fixes F1: a founded neighbour's own share
   * (systemData.region.neighbors[k].jobSlots / workerSlots, which applyRegionEffects writes for the neighbour's
   * best-connected shared edge segment) sits only at the connections on that segment, by capacity: residents reach a
   * neighbour's jobs — and its workers ours — only by a road or rail line that leads there, and a neighbour beyond an
   * edge without one adds nothing here. Without region data nothing changes.
   */
  private placeRegional(st: CityState, workers: number, citySlots: number): void {
    const jB = this.jB, jN = this.jN, growth = this.growth, conns = this.conns, sd = st.systemData;
    const hasJ = typeof sd.regionJobs === 'number', hasW = typeof sd.regionWorkers === 'number';
    let poolJ = hasJ ? Math.max(0, sd.regionJobs as number) : (REGION_JOB_SHARE * workers + REGION_JOB_MIN) * REGION_JOBS_FOR_RESIDENTS;
    let poolW = hasW ? Math.max(0, sd.regionWorkers as number) : REGION_WORKER_SHARE * citySlots + REGION_WORKER_MIN;
    const nC = Math.max(0, jN - jB);
    const nbJ = new Float64Array(nC), nbW = new Float64Array(nC);
    // founded neighbours' own shares, at the connections on their shared edge segment
    const reg = sd.region as { neighbors?: unknown } | undefined;
    const list = (hasJ || hasW) && reg && Array.isArray(reg.neighbors) ? (reg.neighbors as Partial<RegionNeighbor>[]) : null;
    if (list) for (const n of list) {
      if (!n || !n.founded) continue;
      const js = hasJ && typeof n.jobSlots === 'number' && n.jobSlots > 0 ? n.jobSlots : 0;
      const ws = hasW && typeof n.workerSlots === 'number' && n.workerSlots > 0 ? n.workerSlots : 0;
      if (!(js > 0) && !(ws > 0)) continue;
      poolJ -= js;
      poolW -= ws;
      let sJ = 0, sW = 0;
      for (let j = jB; j < jN; j++) {
        if (!onSegment(conns[this.jConnK[j]], n)) continue;
        sJ += CONNECTION_JOBS[this.jConnType[j]];
        if (this.jEntC[j] > 0) sW += CONNECTION_WORKERS[this.jConnType[j]];
      }
      for (let j = jB; j < jN; j++) {
        if ((sJ <= 0 && sW <= 0) || !onSegment(conns[this.jConnK[j]], n)) continue;
        if (sJ > 0) nbJ[j - jB] += js * CONNECTION_JOBS[this.jConnType[j]] / sJ;
        if (sW > 0 && this.jEntC[j] > 0) nbW[j - jB] += ws * CONNECTION_WORKERS[this.jConnType[j]] / sW;
      }
    }
    if (poolJ < 0) poolJ = 0;
    if (poolW < 0) poolW = 0;
    this.regionWorkerCap = poolW;
    // the region at large at every connection by capacity (scaled down to its total)
    let capJ = 0, capW = 0;
    for (let j = jB; j < jN; j++) {
      capJ += this.jSlots[j];
      if (this.jEntC[j] > 0) capW += CONNECTION_WORKERS[this.jConnType[j]] * growth;
    }
    const fJ = capJ > poolJ && capJ > 0 ? poolJ / capJ : 1;
    const fW = capW > poolW ? poolW / capW : 1;
    const cw = (this.jConnW = growF64(this.jConnW, jN));
    for (let j = jB; j < jN; j++) {
      if (fJ !== 1) this.jSlots[j] *= fJ;
      if (nbJ[j - jB] > 0) this.jSlots[j] += nbJ[j - jB];
      cw[j] = this.jEntC[j] > 0 ? CONNECTION_WORKERS[this.jConnType[j]] * growth * fW + nbW[j - jB] : 0;
    }
  }

  /** whole-state prepTransit (tests): every PH_PREP2 piece */
  private prepTransit(st: CityState): void {
    this.tSub = 0;
    while (!this.prepTransitPiece(st)) { /* next piece */ }
  }

  /**
   * one PH_PREP2 piece (B2 §3 "PrepTransit"); true when done. T0 attachment refresh (own piece after an edit), the stop
   * collector over the pass snapshot (buildings, then road-cell rows) into a private list, ferry nodes and the depots
   * (into a back list; the depot BFS in its own pieces when roads or depots changed), the per-stop attach loop by stop
   * ranges, the pool service ratios, the waits by stop ranges, the stop bins, the transfers by stop ranges, ferry links +
   * CSR + bus times + tnet, the garages' stops, then ONE publish piece: the stop list, stIdxById, depots, minibus pool,
   * stDepot / stRho / stWait and the garages' gStop / gWalk / gSpaces / gState (everything stopLoad, depotInfo,
   * depotFleet, minibusInfo, stopsNear and garageInfo read) change together, so no query pairs a new stop list with old
   * indices or a depot list without its stops. Internal per-stop arrays are written in place by the earlier pieces.
   */
  private prepTransitPiece(st: CityState): boolean {
    if (this.tSub === 0) {
      this.tSub = 1;
      if (this.attachDirty || this.attachFor !== st) { this.refreshAttach(st); return false; }
    }
    if (this.tSub === 1) {
      // (the pass snapshot of prep's scan; a standalone call — tests — takes one)
      if (!this.snapOk) { this.snap.take(st); this.snapOk = true; }
      this.stopCol.begin(this.stopsB);
      this.tSub = 2;
    }
    switch (this.tSub) {
      case 2: return this.prepTransitPiece2(st);
      case 3: return this.prepTransitPiece3(st);
      case 4: return this.prepTransitPiece4(st);
      case 5: return this.prepTransitPiece5(st);
      case 6: return this.prepTransitPiece6(st);
      case 7: return this.prepTransitPiece7(st);
      case 8: return this.prepTransitPiece8(st);
      case 9: return this.prepTransitPiece9(st);
      case 10: return this.prepTransitPiece10(st);
      case 11: return this.prepTransitPiece11(st);
      case 12: return this.prepTransitPiece12(st);
      case 13: return this.prepTransitPiece13(st);
      case 14: return this.prepTransitPiece14(st);
      default: return this.prepTransitPieceEnd(st);
    }
  }

  /** prepTransitPiece, sub-state 2 (B2 R10: one small method per piece kind) */
  private prepTransitPiece2(st: CityState): boolean {
    if (this.stopCol.buildings(st, this.snap.list, coldUnits(TC.stopB))) this.tSub = 3;
    return false;
  }

  /** prepTransitPiece, sub-state 3 (B2 R10: one small method per piece kind) */
  private prepTransitPiece3(st: CityState): boolean {
    if (!this.stopCol.cells(st, coldUnits(TC.stopCell))) return false;
    this.stopCol.end();
    this.tSub = 4;
    return false;
  }

  /** prepTransitPiece, sub-state 4 (B2 R10: one small method per piece kind) */
  private prepTransitPiece4(st: CityState): boolean {
    const g = this.road, N = st.size;
    // ferry nodes: one per linked terminal (WP7-9)
    this.ferryNodeOf.clear();
    let nFerry = 0;
    for (const f of this.ferryTerms) if ((this.ferryNet.partners.get(f.id)?.length ?? 0) > 0) this.ferryNodeOf.set(f.id, nFerry++);
    this.tNR = g.n; this.tNRail = this.rail.n; this.tNSub = this.subway.n; this.tNFerry = nFerry;
    this.tNGrid = this.tNR + this.tNRail + this.tNSub; this.tTotal = this.tNGrid + nFerry;
    // depots (WP7-5): fleet, stop ownership by a multi-source road BFS (on road / depot changes only)
    this.tSub = this.collectDepots(st) ? 5 : 7;
    return false;
  }

  /** prepTransitPiece, sub-state 5 (B2 R10: one small method per piece kind) */
  private prepTransitPiece5(st: CityState): boolean {
    this.depotBfsBegin(st);
    this.tSub = 6;
    return false;
  }

  /** prepTransitPiece, sub-state 6 (B2 R10: one small method per piece kind) */
  private prepTransitPiece6(st: CityState): boolean {
    if (this.depotBfsRun(coldUnits(TC.depotBfs))) this.tSub = 7;
    return false;
  }

  /** prepTransitPiece, sub-state 7 (B2 R10: one small method per piece kind) */
  private prepTransitPiece7(st: CityState): boolean {
    // attach nodes per stop (combined ids)
    const stops = this.stopsB, total = this.tTotal;
    this.stAttS = growI32(this.stAttS, stops.n + 1);
    this.stAttC = growU8(this.stAttC, stops.n + 1);
    this.stAtt = growI32(this.stAtt, stops.n * 6 + 8);
    this.stWaitB = growF32(this.stWaitB, stops.n + 1);
    this.stLoad = growF32(this.stLoad, stops.n + 1);
    this.stLoad.fill(0, 0, stops.n);
    this.stPr = growF32(this.stPr, stops.n + 1);
    this.stPr.fill(0, 0, stops.n);
    this.stWaitPr = growF32(this.stWaitPr, stops.n + 1);
    this.stKey = growI32(this.stKey, stops.n + 1);
    this.stDepotB = growI32(this.stDepotB, stops.n + 1);
    this.stRhoB = growF32(this.stRhoB, stops.n + 1);
    this.stOk = growU8(this.stOk, stops.n + 1);
    this.stIdxByIdB.clear();
    this.nodeStop = growI32(this.nodeStop, total + 1);
    this.nodeStop.fill(-1, 0, total);
    const nD = this.depotsB.length;
    if (this.tDRiders.length < nD + 1) { this.tDRiders = new Float64Array(nD + 9); this.tDStops = new Int32Array(nD + 9); }
    this.tDRiders.fill(0, 0, nD + 1);
    this.tDStops.fill(0, 0, nD + 1);
    this.tAn = 0;
    this.tCur = 0;
    this.tHubS.length = 0;
    this.tSub = 8;
    return false;
  }

  /** prepTransitPiece, sub-state 8 (B2 R10: one small method per piece kind) */
  private prepTransitPiece8(st: CityState): boolean {
    const g = this.road, N = st.size;
    const stops = this.stopsB, nR = this.tNR, nRail = this.tNRail, nGrid = this.tNGrid;
    // (LG-02: ten scratch entries while a Grand Central exists — its 2 bus + 4 rail + 4 subway nodes)
    const tmp = this.hubModes.size ? this.tTmp10 : this.tTmp6, nD = this.depotsB.length, dRiders = this.tDRiders, dStops = this.tDStops;
    const s0 = this.tCur, s1 = Math.min(stops.n, s0 + coldUnits(TC.stopAttach));
    let an = this.tAn;
    for (let s = s0; s < s1; s++) {
      this.stAttS[s] = an;
      const mode = stops.mode[s];
      const bid = stops.bid[s];
      const b = bid >= 0 ? st.buildings.get(bid) : undefined;
      const key = bid >= 0 ? bid : -1 - stops.cell[s];
      this.stKey[s] = key;
      if (bid >= 0) this.stIdxByIdB.set(bid, s);
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
          c = perimeterNodes(this.rail.nodeOfCell, N, b, tmp, 0, 4);
          for (let q = 0; q < c; q++) tmp[q] += nR;
        } else if (mode === Transit.Subway && b) {
          c = this.subway.perimeterNodes(b, tmp, 0, 4, true);
          for (let q = 0; q < c; q++) tmp[q] += nR + nRail;
        } else if (mode === Transit.Ferry && b) {
          const k = this.ferryNodeOf.get(bid);
          if (k !== undefined) tmp[c++] = nGrid + k;
        } else if (mode === Transit.Hub && b) {
          const modes = this.hubModes.get(bid) ?? 0;
          if (modes & (1 << Transit.Bus)) c = perimeterNodes(g.nodeOfCell, N, b, tmp, 0, 2);
          if (modes & (1 << Transit.Train)) {
            const first = c;
            c += perimeterNodes(this.rail.nodeOfCell, N, b, tmp, c, 4);
            for (let q = first; q < c; q++) tmp[q] += nR;
          }
          if (modes & (1 << Transit.Subway)) {
            const first = c;
            c += this.subway.perimeterNodes(b, tmp, c, 4, true);
            for (let q = first; q < c; q++) tmp[q] += nR + nRail;
          }
          // (its internal transfers between modes: prepTransitPiece12)
          if (c > 1) this.tHubS.push(s);
        }
      }
      if (an + c > this.stAtt.length) this.stAtt = growI32(this.stAtt, an + c);
      for (let q = 0; q < c; q++) { this.stAtt[an++] = tmp[q]; this.nodeStop[tmp[q]] = s; }
      this.stAttC[s] = c;
      // bus fleet: building bus stops belong to the depot that reaches them first (else the minibus pool)
      let d = -1;
      if ((mode === Transit.Bus || (mode === Transit.Hub && tmp[0] < nR)) && b && c > 0) {
        const o = this.depotOwner.length > 0 && tmp[0] < this.depotOwner.length ? this.depotOwner[tmp[0]] : -1;
        d = o >= 0 && o < nD ? o : nD; // nD = minibus pool
        dRiders[d] += this.stLoadPrev.get(key) ?? 0;
        dStops[d]++;
      }
      this.stDepotB[s] = d >= 0 && d < nD ? d : -1;
      this.stRhoB[s] = d >= 0 ? -1 : 1; // filled below for fleet stops
    }
    this.tAn = an;
    this.tCur = s1;
    if (s1 < stops.n) return false;
    this.stAttS[stops.n] = an;
    this.tSub = 9;
    return false;
  }

  /** prepTransitPiece, sub-state 9 (B2 R10: one small method per piece kind) */
  private prepTransitPiece9(st: CityState): boolean {
    // service ratio per depot / minibus pool: rho = fleet / smoothed needed buses (WP7-5)
    const deps = this.depotsB, nD = deps.length, dRiders = this.tDRiders, dStops = this.tDStops, mb = this.minibusB;
    if (this.tRhoOf.length < nD + 1) this.tRhoOf = new Float32Array(nD + 9);
    const rhoOf = this.tRhoOf;
    for (let d = 0; d <= nD; d++) {
      const id = d < nD ? deps[d].id : -1;
      const raw = dRiders[d] / RIDERS_PER_BUS;
      const prev = this.busNeed.get(id);
      const need = prev === undefined ? raw : prev + BUS_NEED_SMOOTH * (raw - prev);
      if (dStops[d] > 0 || d < nD) this.busNeed.set(id, need);
      const fleet = d < nD ? deps[d].fleet : MINIBUS_FLEET;
      const rho = need > 1e-6 ? Math.max(BUS_RHO_MIN, Math.min(BUS_RHO_MAX, fleet / need)) : BUS_RHO_MAX;
      rhoOf[d] = rho;
      if (d < nD) { const D = deps[d]; D.stops = dStops[d]; D.riders = dRiders[d]; D.need = need; D.rho = rho; }
      else { mb.stops = dStops[d]; mb.riders = dRiders[d]; mb.need = need; mb.rho = rho; }
    }
    if (dStops[nD] === 0) this.busNeed.delete(-1);
    if (this.busNeed.size > nD + 1) {
      const live = new Set(deps.map((x) => x.id));
      for (const id of [...this.busNeed.keys()]) if (id !== -1 && !live.has(id)) this.busNeed.delete(id);
    }
    this.tCur = 0;
    this.tSub = 10;
    return false;
  }

  /** prepTransitPiece, sub-state 10 (B2 R10: one small method per piece kind) */
  private prepTransitPiece10(st: CityState): boolean {
    const stops = this.stopsB, nD = this.depotsB.length, rhoOf = this.tRhoOf;
    const s0 = this.tCur, s1 = Math.min(stops.n, s0 + coldUnits(TC.stopWait));
    for (let s = s0; s < s1; s++) {
      const mode = stops.mode[s];
      if (this.stRhoB[s] < 0) this.stRhoB[s] = rhoOf[this.stDepotB[s] >= 0 ? this.stDepotB[s] : nD];
      // wait with crowding from the previous cycle (buses: the base wait shrinks / grows with the fleet)
      const prev = this.stLoadPrev.get(this.stKey[s]) ?? 0;
      const capS = mode === Transit.Bus ? STOP_CAP_BUS : mode === Transit.Subway ? STOP_CAP_SUBWAY : mode === Transit.Ferry ? STOP_CAP_FERRY : STOP_CAP_TRAIN;
      const base = mode === Transit.Bus ? WAIT_BUS / this.stRhoB[s] : mode === Transit.Subway ? WAIT_SUBWAY : mode === Transit.Ferry ? WAIT_FERRY
        : mode === Transit.Hub ? this.hubWaitOf(stops.bid[s], this.stRhoB[s]) : WAIT_TRAIN;
      const r = prev / capS;
      this.stWaitB[s] = base * Math.min(4, 1 + r * r);
      const rx = Math.max(0, prev - (this.stPrPrev.get(this.stKey[s]) ?? 0)) / capS;
      this.stWaitPr[s] = base * Math.min(4, 1 + rx * rx);
    }
    this.tCur = s1;
    if (s1 >= stops.n) this.tSub = 11;
    return false;
  }

  /** prepTransitPiece, sub-state 11 (B2 R10: one small method per piece kind) */
  private prepTransitPiece11(st: CityState): boolean {
    const g = this.road, N = st.size;
    // spatial bins of stops (8x8 cells)
    const stops = this.stopsB;
    const BS = 8;
    const nb = Math.ceil(N / BS);
    this.binN = nb;
    this.stopBinStart = growI32(this.stopBinStart, nb * nb + 1);
    this.stopBinStart.fill(0, 0, nb * nb + 1);
    this.stopBins = growI32(this.stopBins, stops.n + 1);
    this.stX = growF64(this.stX, stops.n);
    this.stZ = growF64(this.stZ, stops.n);
    for (let s = 0; s < stops.n; s++) {
      const c = stops.cell[s], x = c % N, z = (c - x) / N;
      this.stX[s] = x; this.stZ[s] = z;
      this.stopBinStart[((z / BS) | 0) * nb + ((x / BS) | 0) + 1]++;
    }
    for (let i = 0; i < nb * nb; i++) this.stopBinStart[i + 1] += this.stopBinStart[i];
    this.stopBinFill = growI32(this.stopBinFill, nb * nb);
    const fillp = this.stopBinFill.subarray(0, nb * nb).fill(0);
    for (let s = 0; s < stops.n; s++) {
      const x = this.stX[s], z = this.stZ[s];
      const bi = ((z / BS) | 0) * nb + ((x / BS) | 0);
      this.stopBins[this.stopBinStart[bi] + fillp[bi]++] = s;
    }
    this.trFrom.length = 0; this.trTo.length = 0; this.trCost.length = 0;
    this.tCur = 0;
    this.tSub = 12;
    return false;
  }

  /** prepTransitPiece, sub-state 12 (B2 R10: one small method per piece kind) */
  private prepTransitPiece12(st: CityState): boolean {
    const g = this.road, N = st.size;
    // transfers between stops of different modes within walking distance
    const stops = this.stopsB, trFrom = this.trFrom, trTo = this.trTo, trCost = this.trCost, wait = this.stWaitB;
    const s0 = this.tCur, s1 = Math.min(stops.n, s0 + coldUnits(TC.transfer));
    // Transfers inside Grand Central join its connected bus, rail and subway nodes (LG-02: in the first piece, before
    // the walking transfers, over the hub stops piece 8 attached, in stop order — the pre-B2 pass's order).
    if (s0 === 0 && this.tHubS.length > 0) {
      const nR = this.tNR, nRail = this.tNRail;
      const modeOf = (v: number) => v < nR ? Transit.Bus : v < nR + nRail ? Transit.Train : Transit.Subway;
      for (const s of this.tHubS) {
        const first = this.stAttS[s], end = first + this.stAttC[s];
        for (let a = first; a < end; a++) for (let b = a + 1; b < end; b++) {
          const u = this.stAtt[a], v = this.stAtt[b];
          if (modeOf(u) === modeOf(v)) continue;
          trFrom.push(u, v); trTo.push(v, u); trCost.push(wait[s], wait[s]);
        }
      }
    }
    for (let s = s0; s < s1; s++) {
      if (this.stAttC[s] === 0) continue;
      const x = this.stX[s], z = this.stZ[s];
      const cnt = this.nearStops(N, x, z, STOP_WALK_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const s2 = this.nsIdx[q], d = this.nsDist[q];
        if (s2 <= s || stops.mode[s2] === stops.mode[s] || this.stAttC[s2] === 0) continue;
        const a = this.stAtt[this.stAttS[s]], b = this.stAtt[this.stAttS[s2]];
        const cost = d * STOP_WALK_TIME_PER_CELL + 0.5 * (wait[s] + wait[s2]);
        trFrom.push(a, b); trTo.push(b, a); trCost.push(cost, cost);
      }
    }
    this.tCur = s1;
    if (s1 >= stops.n) this.tSub = 13;
    return false;
  }

  /** prepTransitPiece, sub-state 13 (B2 R10: one small method per piece kind) */
  private prepTransitPiece13(st: CityState): boolean {
    const g = this.road;
    const trFrom = this.trFrom, trTo = this.trTo, trCost = this.trCost;
    const nR = this.tNR, nRail = this.tNRail, nSub = this.tNSub, nFerry = this.tNFerry, nGrid = this.tNGrid, total = this.tTotal;
    // (three pieces: the ferry links + the bucket counts, the edge scatter by edge ranges, the start offsets + bus times +
    // the network; the transit search reads tnet only from PH_TRANSIT on, and nothing outside traffic reads it)
    if (this.csrStage === 0) {
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
      this.csrTo = new Int32Array(trFrom.length);
      this.csrCost = new Float32Array(trFrom.length);
      this.csrCur = 0;
      this.csrStage = 1;
      return false;
    }
    const trStart = this.trStartA;
    if (this.csrStage === 1) {
      const to = this.csrTo, cost = this.csrCost;
      const e0 = this.csrCur, e1 = Math.min(trFrom.length, e0 + coldUnits(TC.csrEdge));
      for (let e = e0; e < e1; e++) {
        // trStart[f+1] (= end of f's bucket) used as a decrementing cursor
        const f = trFrom[e];
        const p = --trStart[f + 1];
        to[p] = trTo[e];
        cost[p] = trCost[e];
      }
      this.csrCur = e1;
      if (e1 < trFrom.length) return false;
      this.csrStage = 2;
      return false;
    }
    // now trStart[k] = original start[k-1] for k >= 1: shift back
    for (let i = 1; i < total; i++) trStart[i] = trStart[i + 1];
    trStart[total] = trFrom.length;
    this.busTimeA = growF32(this.busTimeA, nR);
    const busTime = this.busTimeA;
    for (let v = 0; v < nR; v++) busTime[v] = this.nodeTime[v] * BUS_TIME_FACTOR;
    this.tnet = {
      nR, nRail, nSub, nFerry, total, roadAdj: g.rev, busTime, railAdj: this.rail.adj, subAdj: this.subway.adj,
      railTime: NET_TIME[Network.Rail], subTime: SUBWAY_TIME, trStart, trTo: this.csrTo, trCost: this.csrCost,
    };
    this.csrTo = EMPTY_I32;
    this.csrCost = EMPTY_F32;
    this.csrStage = 0;
    this.tAcc = growF32(this.tAcc, total);
    this.tSub = 14;
    return false;
  }

  /** prepTransitPiece, sub-state 14 (B2 R10: one small method per piece kind) */
  private prepTransitPiece14(st: CityState): boolean {
    this.prepTransitGarages(st);
    this.tSub = 15;
    return false;
  }

  /** prepTransitPiece, sub-state default (B2 R10: one small method per piece kind) */
  private prepTransitPieceEnd(st: CityState): boolean {
    // publish: the stop list and everything the stop / depot / garage queries read, together
    copyStopList(this.stops, this.stopsB);
    const n = this.stops.n, gN = this.gN;
    const m = this.stIdxById;
    this.stIdxById = this.stIdxByIdB;
    this.stIdxByIdB = m;
    this.depots = this.depotsB;
    this.depotsB = [];
    const mb = this.minibus, B = this.minibusB;
    mb.stops = B.stops; mb.riders = B.riders; mb.need = B.need; mb.rho = B.rho;
    this.stDepot = growI32(this.stDepot, n + 1); this.stDepot.set(this.stDepotB.subarray(0, n));
    this.stRho = growF32(this.stRho, n + 1); this.stRho.set(this.stRhoB.subarray(0, n));
    this.stWait = growF32(this.stWait, n + 1); this.stWait.set(this.stWaitB.subarray(0, n));
    this.gStop = growI32(this.gStop, gN + 1); this.gStop.set(this.gStopB.subarray(0, gN));
    this.gWalk = growF32(this.gWalk, gN + 1); this.gWalk.set(this.gWalkB.subarray(0, gN));
    this.gSpaces = growF32(this.gSpaces, gN + 1); this.gSpaces.set(this.gSpacesB.subarray(0, gN));
    this.gState = growU8(this.gState, gN + 1); this.gState.set(this.gStateB.subarray(0, gN));
    this.gPrN = this.tPrN;
    this.prKeyNow = this.tPrKey;
    this.tSub = 0;
    this.tCur = 0;
    return true;
  }

  /** prepTransit's park & ride garages: an attached stop within PR_STOP_RADIUS (+ half the footprint) (WP7-8); the
   *  arrays garageInfo reads into back buffers (published with the stop list) */
  private prepTransitGarages(st: CityState): void {
    const N = st.size, gN = this.gN, wait = this.stWaitB;
    this.gStopB = growI32(this.gStopB, gN + 1); this.gWalkB = growF32(this.gWalkB, gN + 1);
    this.gSpacesB = growF32(this.gSpacesB, gN + 1); this.gStateB = growU8(this.gStateB, gN + 1);
    const gStop = this.gStopB, gWalk = this.gWalkB, gSpaces = this.gSpacesB, gState = this.gStateB;
    this.gLabel = growF32(this.gLabel, gN + 1);
    this.gSeed = growF32(this.gSeed, gN + 1); this.gBoard = growI32(this.gBoard, gN + 1); this.gLoad = growF32(this.gLoad, gN + 1);
    this.gSeeded = growU8(this.gSeeded, gN + 1); this.gRank = growF32(this.gRank, gN + 1);
    this.gRide = growU8(this.gRide, gN + 1);
    this.gRiders = growF32(this.gRiders, gN + 1); this.gWant = growF32(this.gWant, gN + 1); this.gCatch = growF32(this.gCatch, gN + 1);
    this.gUnpl = growF32(this.gUnpl, gN + 1); this.gUnplX = growF32(this.gUnplX, gN + 1); this.gUnplZ = growF32(this.gUnplZ, gN + 1);
    this.gUnplQ = growF64(this.gUnplQ, gN + 1);
    this.gOvIn = growF32(this.gOvIn, gN + 1);
    this.gPrice = growF32(this.gPrice, gN + 1); this.gCell = growI32(this.gCell, gN + 1); this.gHalf = growU8(this.gHalf, gN + 1);
    this.gGrp = growI32(this.gGrp, gN + 1); this.gGSp = growF32(this.gGSp, gN + 1); this.gCars = growF32(this.gCars, gN + 1);
    this.gRidersM = growF32(this.gRidersM, gN + 1); this.gWantR = growF32(this.gWantR, gN + 1); this.gRes = growF32(this.gRes, gN + 1);
    let prN = 0, key = '';
    for (let q = 0; q < gN; q++) {
      gStop[q] = -1; gWalk[q] = 0; this.gLoad[q] = 0; this.gBoard[q] = -1; this.gRide[q] = 0;
      this.gRiders[q] = 0; this.gWant[q] = 0; this.gWantR[q] = 0; this.gCatch[q] = 0; this.gLabel[q] = Infinity;
      this.gUnpl[q] = 0; this.gUnplX[q] = 0; this.gUnplZ[q] = 0; this.gUnplQ[q] = 0; this.gOvIn[q] = 0;
      this.gGrp[q] = q; this.gGSp[q] = 0; this.gCars[q] = 0; this.gRidersM[q] = 0;
      const id = this.gBid[q];
      // (every garage in order: the searches' seed ids are these indices — a garage without a stop shifts them too)
      key += id + ';';
      const b = st.buildings.get(id);
      gSpaces[q] = (b && GARAGE_DEFS[b.def]) || GARAGE_SPACES;
      this.gPrice[q] = this.garagePrice.get(id) ?? 0;
      // spaces kept for the block around it (local parkers first; park & ride gets the rest; a block barely short of
      // parking keeps none: below PR_RESERVE_MIN x spaces)
      const res = Math.max(0, Math.min(gSpaces[q], this.garageReserve.get(id) ?? 0));
      this.gRes[q] = res >= PR_RESERVE_MIN * gSpaces[q] ? res : 0;
      gState[q] = GARAGE_NO_ROAD;
      if (!b || this.gEntC[q] === 0) { this.garageStop.delete(id); this.garageDown.delete(id); this.garageRideT.delete(id); continue; }
      gState[q] = GARAGE_NO_STOP;
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
        if (walk + wait[s] < best) { best = walk + wait[s]; gStop[q] = s; gWalk[q] = walk; }
      }
      if (gStop[q] >= 0) { prN++; key += id + ':' + cand + ','; gState[q] = GARAGE_NO_TRANSIT; }
      // (no stop within reach: no park & ride stop to keep — PH_PARKRIDE, which drops it otherwise, is skipped when no
      // garage has a stop)
      else { this.garageStop.delete(id); this.garageDown.delete(id); this.garageRideT.delete(id); }
    }
    this.tPrN = prN;
    this.tPrKey = key;
  }

  /** WP7-5: depots of this cycle (fleet) into the back list; true when the stop ownership BFS must run (road / depot
   *  changes) */
  private collectDepots(st: CityState): boolean {
    const funding = Math.min(DEPOT_FUNDING_MAX, fundingFactor(st, 'transit'));
    const deps: TrafficSystem['depots'] = [];
    let key = '';
    for (const b of this.depotB) {
      const powered = !infoOf(st, b).usesPower || (b.flags & BF.Powered) !== 0;
      deps.push({ id: b.id, fleet: (DEPOT_DEFS[b.def] ?? DEPOT_BUSES) * funding * (powered ? 1 : DEPOT_UNPOWERED), stops: 0, riders: 0, need: 0, rho: BUS_RHO_MAX });
      key += b.id + '@' + b.x + ',' + b.z + ';';
    }
    this.depotsB = deps;
    if (key !== this.depotKey || this.depotVer !== this.road.version || this.depotOwner.length < this.road.n) {
      this.depotKey = key;
      this.depotVer = this.road.version;
      return true;
    }
    return false;
  }

  /** multi-source BFS (road hops, both directions) from the depots' road entries, at most DEPOT_RANGE hops: owner per
   *  node — begin (owner reset, seeds), then depotBfsRun by queue chunks (FIFO order: the same owners as one pass) */
  private depotBfsBegin(st: CityState): void {
    const g = this.road, n = g.n, N = st.size;
    if (this.depotOwner.length < n) this.depotOwner = new Int32Array(n + (n >> 3) + 16);
    const owner = this.depotOwner;
    owner.fill(-1, 0, n);
    this.dbQh = this.dbQt = 0;
    if (this.depotB.length === 0 || n === 0) return;
    if (this.dbHop.length < n) { this.dbHop = new Uint16Array(n + (n >> 3) + 16); this.dbQ = new Int32Array(n + (n >> 3) + 16); }
    const hop = this.dbHop, q = this.dbQ;
    let qt = 0;
    const tmp = new Int32Array(12);
    for (let d = 0; d < this.depotB.length; d++) {
      const c = perimeterNodes(g.nodeOfCell, N, this.depotB[d], tmp, 0, 12);
      for (let k = 0; k < c; k++) { const v = tmp[k]; if (owner[v] >= 0) continue; owner[v] = d; hop[v] = 0; q[qt++] = v; }
    }
    this.dbQt = qt;
  }

  private depotBfsRun(maxNodes: number): boolean {
    const g = this.road, owner = this.depotOwner, hop = this.dbHop, q = this.dbQ, fwd = g.fwd, rev = g.rev;
    let qh = this.dbQh, qt = this.dbQt;
    const stop = qh + maxNodes;
    while (qh < qt && qh < stop) {
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
    this.dbQh = qh;
    this.dbQt = qt;
    return qh >= qt;
  }

  /** wait (minutes) at stop s without crowding: the mode's wait, buses / the service ratio of the stop's bus pool */
  private baseWait(s: number): number {
    const m = this.stops.mode[s];
    return m === Transit.Bus ? WAIT_BUS / (this.stRho[s] > 0 ? this.stRho[s] : 1) : m === Transit.Subway ? WAIT_SUBWAY : m === Transit.Ferry ? WAIT_FERRY
      : m === Transit.Hub ? this.hubWait(s) : WAIT_TRAIN;
  }

  private hubWait(s: number): number {
    return this.hubWaitOf(this.stops.bid[s], this.stRho[s]);
  }

  /** a Grand Central's wait without crowding: its shortest connected mode's, buses at the service ratio rho of its pool
   *  (B2: prepTransit's waits piece passes the pass's stopsB / stRhoB, baseWait the published stop list) */
  private hubWaitOf(bid: number, rho: number): number {
    const modes = this.hubModes.get(bid) ?? 0;
    return Math.min(modes & (1 << Transit.Bus) ? WAIT_BUS / (rho > 0 ? rho : 1) : Infinity,
      modes & (1 << Transit.Subway) ? WAIT_SUBWAY : Infinity, modes & (1 << Transit.Train) ? WAIT_TRAIN : Infinity);
  }

  /** stops within radius R of (x,z) -> this.nsIdx / this.nsDist (returns count; no allocation) */
  private nearStops(_N: number, x: number, z: number, R: number): number {
    const BS = 8, nb = this.binN;
    const bx0 = Math.max(0, ((x - R) / BS) | 0), bx1 = Math.min(nb - 1, ((x + R) / BS) | 0);
    const bz0 = Math.max(0, ((z - R) / BS) | 0), bz1 = Math.min(nb - 1, ((z + R) / BS) | 0);
    const R2 = R * R;
    let c = 0;
    for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) {
      const bi = bz * nb + bx;
      for (let p = this.stopBinStart[bi], p1 = this.stopBinStart[bi + 1]; p < p1; p++) {
        const s = this.stopBins[p];
        const sx = this.stX[s], sz = this.stZ[s];
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
  /** whole-state transit (tests) */
  private transit(): void {
    this.trSub = 0;
    while (!this.transitPiece()) { /* next piece */ }
  }

  /**
   * one PH_TRANSIT piece; true when done. Without stops: the reset, then the per-origin options' pieces (transitDone,
   * PH_TRANSIT2 is skipped). Else the seeds by job-site ranges (seeds grow in j order), the search start, then the
   * resumable transit search in chunks (TransitSearchRun: exact, §2.4).
   */
  private transitPiece(): boolean {
    const T = this.tnet!;
    if (this.trSub === 0) {
      if (this.stops.n === 0) {
        this.ST.reset(T.total);
        this.otSub = 0;
        this.trSub = 4;
        return false;
      }
      this.transitDone = false;
      this.seeds.clear();
      this.trCur = 0;
      this.trSub = 1;
    }
    switch (this.trSub) {
      case 1: {
        const seeds = this.seeds, N = this.road.N;
        const j0 = this.trCur, j1 = Math.min(this.jN, j0 + pieceUnits(TC.trSeed, 1, WARM));
        for (let j = j0; j < j1; j++) {
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
        this.trCur = j1;
        if (j1 >= this.jN) this.trSub = 2;
        return false;
      }
      case 2: {
        this.runT.start(T, this.ST, this.seeds, MAX_COMMUTE + DEST_NOISE + REGIONAL_TIME);
        this.trSub = 3;
        return false;
      }
      case 3: {
        if (!this.runT.run(pieceUnits(TC.trNode, 1, WARM))) return false;
        // the per-origin options follow in their own step (PH_TRANSIT2)
        this.trSub = 0;
        return true;
      }
      default: {
        if (!this.otPiece()) return false;
        this.transitDone = true;
        this.trSub = 0;
        return true;
      }
    }
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
    this.otSub = 0;
    while (!this.otPiece()) { /* next piece */ }
  }

  /** one piece of originTransit: the fills, the origins by ranges (per-stop sums in origin order), the acc fills */
  private otPiece(): boolean {
    switch (this.otSub) {
      case 0: {
        const total = this.tnet ? this.tnet.total : 0;
        if (this.rideMemo.length < total) this.rideMemo = new Int8Array(total + (total >> 3) + 16);
        this.rideMemo.fill(0, 0, total);
        this.stWalk = growF32(this.stWalk, this.stops.n + 1);
        this.stWalk.fill(0, 0, this.stops.n + 1);
        const nS = this.stops.n + 1;
        const nearW = (this.stNearW = growF32(this.stNearW, nS)), boardW = (this.stBoardW = growF32(this.stBoardW, nS));
        const boardT = (this.stBoardT = growF32(this.stBoardT, nS)), elseW = (this.stElseW = growF32(this.stElseW, nS));
        nearW.fill(0, 0, nS); boardW.fill(0, 0, nS); boardT.fill(0, 0, nS); elseW.fill(0, 0, nS);
        this.otCur = 0;
        this.otSub = 1;
        return false;
      }
      case 1: {
        const o0 = this.otCur, o1 = Math.min(this.oN, o0 + coldUnits(this.otOriginUs()));
        this.originTransitRange(o0, o1);
        this.otCur = o1;
        if (o1 >= this.oN) this.otSub = 2;
        return false;
      }
      default: {
        this.acc.fill(0, 0, this.road.n);
        this.tAcc.fill(0, 0, this.tnet!.total);
        this.otSub = 0;
        return true;
      }
    }
  }

  /**
   * each origin's best transit option (board node, stop, pure minutes, destination) from the transit forest, origins
   * [o0, o1). Only board nodes whose path rides a vehicle count: a stop whose best path is "walk to the job beside it"
   * is no transit trip (it would count the walker twice as a rider — boarding and alighting at the same stop — and size
   * buses for them); those workers are counted per stop (stWalk: the report explains the empty stop)
   */
  private originTransitRange(o0: number, o1: number): void {
    const ST = this.ST;
    const distT = ST.dist, srcT = ST.src, doneT = ST.done;
    const N = this.road.N;
    const hasStops = this.stops.n > 0;
    const nearW = this.stNearW, boardW = this.stBoardW, boardT = this.stBoardT, elseW = this.stElseW;
    for (let o = o0; o < o1; o++) {
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
        nearW[s] += this.oW[o];
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
      boardW[boardStop] += this.oW[o];
      boardT[boardStop] += this.oW[o] * t;
      for (let q = 0; q < cnt; q++) if (this.nsIdx[q] !== boardStop) elseW[this.nsIdx[q]] += this.oW[o];
    }
  }

  /** estimated µs per origin of originTransit (scales with the stops per 1,000 cells near it) */
  private otOriginUs(): number {
    const C = Math.max(1, this.road.C);
    return TC.otOrigin + TC.otOriginStop * (this.stops.n * 1000 / C);
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
    this.prSub = 0;
    for (;;) { const r = this.parkRidePiece(); if (r !== CONT) return r; }
  }

  /**
   * one PH_PARKRIDE piece (CONT while more follow). Stage 0: the garages (prGarages), then the search decision and its
   * seeding (prStart) in the next piece; stage 1: K-label search chunks; stage 3: the kept forest's car legs refreshed by
   * settle-order ranges (parents before children: the same sums as refreshAlt); stage 2: the per-origin options by ranges
   */
  private parkRidePiece(): number {
    switch (this.prStage) {
      case 0:
        if (this.prSub === 0) {
          this.prGarages();
          this.prSub = 1;
          return CONT;
        }
        this.prSub = 0;
        if (this.prSearchDue()) { this.prStart(); this.prStage = 1; }
        else this.prStage = this.cycles % 2 === 0 ? 3 : 2;
        this.prCur = 0;
        return CONT;
      case 1:
        if (!this.SPK.run(coldUnits(TC.prState))) return CONT;
        this.prKey = this.prKeyNow;
        this.prSearched = this.cycles;
        this.prStage = 2;
        this.prCur = 0;
        return CONT;
      case 3: {
        if (this.prSub === 0) {
          this.prSub = this.SPK.refreshAltBegin(this.nodeTime, this.rampT) ? 1 : 2;
          this.prCur = 0;
        }
        if (this.prSub === 1) {
          const k0 = this.prCur, k1 = Math.min(this.SPK.settled, k0 + coldUnits(TC.prRefresh));
          this.SPK.refreshAltRange(k0, k1);
          this.prCur = k1;
          if (k1 < this.SPK.settled) return CONT;
        }
        this.prSub = 0;
        this.prStage = 2;
        this.prCur = 0;
        return CONT;
      }
      default: {
        const o0 = this.prCur, o1 = Math.min(this.oN, o0 + coldUnits(TC.prOption));
        this.prOptions(o0, o1);
        this.prCur = o1;
        if (o1 < this.oN) return CONT;
        this.prStage = 0;
        this.prCur = 0;
        return NEXT_PHASE[PH_PARKRIDE];
      }
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
  private prOptions(o0: number, o1: number): void {
    const K = PR_OPTIONS, gN = this.gN, g = this.road, SP = this.SPK, KS = SP.K, grp = this.gGrp, room = this.gGSp;
    const dist = SP.dist, src = SP.src, alt = SP.alt, cntS = SP.cnt;
    const n = Math.min(g.n, SP.n);
    // (scratch per option: free-flow minutes F, congested minutes, garage, state, group)
    const F = this.poT, T = this.poC, Q = this.poQ, S = this.poS, R = this.poR;
    const M = KS; // options collected: PR_OPTIONS + the cutoff
    for (let o = o0; o < o1; o++) {
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
    this.clStage = 0;
    while (!this.clusterPiece()) { /* next piece */ }
  }

  /** buildClusters in pieces (B2): the growth + node map fill, the job sites by ranges (qN in a field), the per-cluster
   *  averages; the same operations in the same order for any cut. True when the clusters are built. */
  private clusterPiece(): boolean {
    const g = this.road;
    const jN = this.jN;
    if (this.clStage === 0) {
      const cap = jN + 1;
      this.qNode = growI32(this.qNode, cap); this.qSlots = growF32(this.qSlots, cap); this.qCapP = growF32(this.qCapP, cap);
      this.qAsg = growF32(this.qAsg, cap); this.qPrice = growF32(this.qPrice, cap); this.qProp = growF32(this.qProp, cap);
      this.qBase = growF32(this.qBase, cap); this.qNoise = growF32(this.qNoise, cap); this.qTimeSum = growF32(this.qTimeSum, cap);
      this.qPark = growF32(this.qPark, cap); this.qCar = growF32(this.qCar, cap);
      if (this.nodeQ.length < g.n) this.nodeQ = new Int32Array(g.n + (g.n >> 3) + 16);
      this.nodeQ.fill(-1, 0, g.n);
      this.clQN = 0;
      this.clCur = 0;
      this.clStage = 1;
      return false;
    }
    const nodeQ = this.nodeQ;
    let qN = this.clQN;
    const j0 = this.clCur, j1 = Math.min(jN, j0 + coldUnits(TC.clusters));
    for (let j = j0; j < j1; j++) {
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
    this.clQN = qN;
    this.clCur = j1;
    if (j1 < jN) return false;
    for (let q = 0; q < qN; q++) if (this.qSlots[q] > 0) { this.qPrice[q] /= this.qSlots[q]; this.qPark[q] /= this.qSlots[q]; }
    this.qN = qN;
    this.clStage = 0;
    return true;
  }

  /** open capacity of job cluster q in the current round */
  private openCap(q: number): number {
    const cap = this.round < MATCH_PROP_ROUNDS ? this.qCapP[q] : this.qSlots[q];
    return cap - this.qAsg[q];
  }

  /** reverse multi-source search from every job cluster with open capacity this round (whole state: tests) */
  private roundSearch(): void {
    this.rsSub = 0;
    while (!this.roundSearchPiece()) { /* next piece */ }
  }

  /** one PH_RSEARCH piece: the seeds + the search start, then resumable search chunks (SA persists, as pre-B2) */
  private roundSearchPiece(): boolean {
    if (this.rsSub === 0) {
      const seeds = this.seeds;
      seeds.clear();
      for (let q = 0; q < this.qN; q++) {
        if (this.openCap(q) < 0.5) continue;
        // prices may be negative (subsidies for unattractive sites): shift all labels by MATCH_PRICE_MAX
        const label = MATCH_PRICE_MAX + this.qBase[q] + this.qNoise[q] + this.qPrice[q];
        seeds.push(this.qNode[q], label, q);
      }
      this.runA.start(this.road, this.road.rev, this.nodeTime, this.SA, seeds, MAX_COMMUTE + DEST_NOISE + REGIONAL_TIME + 2 * MATCH_PRICE_MAX, this.rampT);
      this.rsSub = 1;
      return false;
    }
    if (!this.runA.run(pieceUnits(TC.rdNode, 1, WARM))) return false;
    this.rsSub = 0;
    return true;
  }

  /** Stable 11-bit LSD radix sort of the packed (cost, origin) keys; keep the native order outside safe integers.
   *  Below 1024 keys the native sort is faster: the radix path pays up to 5 × 2048 histogram clears and prefix sums
   *  per call (measured crossover 700-1024 keys); both paths give the same bytes.
   *  (whole call: tests; the matching runs it piece by piece, sortPiece) */
  private sortCandidates(nc: number): Float64Array {
    this.srtStage = 0;
    while (!this.sortPiece(nc)) { /* next piece */ }
    return this.candKey.subarray(0, nc);
  }

  /**
   * one piece of the candidate sort (B2): the safe-integer scan + max by key ranges (an unsafe key falls back to the
   * native sort, as pre-B2), the histograms by key ranges, then per radix pass its skip test + prefix sums (one piece)
   * and its scatter by key ranges (index order: stable), and the copy back. The same operations in the same order as
   * the one-call sort, so any cut gives the same permutation. Returns true when the keys are sorted.
   */
  private sortPiece(nc: number): boolean {
    const key = this.candKey, hist = this.candHist;
    if (this.srtStage === 0) {
      if (nc < 1024) { key.subarray(0, nc).sort(); return true; }
      this.srtMax = 0;
      this.srtCur = 0;
      this.srtStage = 1;
    }
    if (this.srtStage === 1) {
      const k0 = this.srtCur, k1 = Math.min(nc, k0 + coldUnits(TC.sortScan));
      let max = this.srtMax;
      for (let k = k0; k < k1; k++) {
        const v = key[k];
        if (!Number.isSafeInteger(v) || v < 0 || Object.is(v, -0)) { key.subarray(0, nc).sort(); this.srtStage = 0; return true; }
        if (v > max) max = v;
      }
      this.srtMax = max;
      this.srtCur = k1;
      if (k1 < nc) return false;
      const hi = Math.floor(max / 4294967296);
      const bits = hi > 0 ? 64 - Math.clz32(hi) : 32 - Math.clz32(max >>> 0);
      this.srtPasses = Math.ceil(bits / 11);
      hist.fill(0, 0, this.srtPasses * 2048);
      this.srtCur = 0;
      this.srtStage = 2;
      return false;
    }
    if (this.srtStage === 2) {
      const passes = this.srtPasses;
      const k0 = this.srtCur, k1 = Math.min(nc, k0 + coldUnits(TC.sortHist));
      for (let k = k0; k < k1; k++) {
        const v = key[k], l = v >>> 0, h = Math.floor(v / 4294967296);
        hist[l & 2047]++;
        if (passes > 1) hist[2048 + ((l >>> 11) & 2047)]++;
        if (passes > 2) hist[4096 + (((l >>> 22) | (h << 10)) & 2047)]++;
        if (passes > 3) hist[6144 + ((h >>> 1) & 2047)]++;
        if (passes > 4) hist[8192 + ((h >>> 12) & 2047)]++;
      }
      this.srtCur = k1;
      if (k1 < nc) return false;
      this.candSort = growF64(this.candSort, nc);
      this.srtFrom = key;
      this.srtTo = this.candSort;
      this.srtP = 0;
      this.srtStage = 3;
      return false;
    }
    if (this.srtStage === 3) {
      // the next pass that moves a key: its prefix sums (skip passes whose digit is the same for every key)
      for (; this.srtP < this.srtPasses; this.srtP++) {
        const row = this.srtP * 2048, div = 2 ** (11 * this.srtP);
        if (hist[row + (((this.srtFrom[0] / div) >>> 0) & 2047)] === nc) continue;
        let sum = 0;
        for (let b = 0; b < 2048; b++) { const n = hist[row + b]; hist[row + b] = sum; sum += n; }
        this.srtCur = 0;
        this.srtStage = 4;
        return false;
      }
      if (this.srtFrom !== key) key.subarray(0, nc).set(this.srtFrom.subarray(0, nc));
      this.srtFrom = this.srtTo = EMPTY_F64;
      this.srtStage = 0;
      return true;
    }
    // stage 4: the scatter of pass srtP by key ranges
    const from = this.srtFrom, to = this.srtTo, row = this.srtP * 2048, div = 2 ** (11 * this.srtP);
    const k0 = this.srtCur, k1 = Math.min(nc, k0 + coldUnits(TC.sortScatter));
    for (let k = k0; k < k1; k++) {
      const v = from[k];
      to[hist[row + (((v / div) >>> 0) & 2047)]++] = v;
    }
    this.srtCur = k1;
    if (k1 < nc) return false;
    this.srtFrom = to;
    this.srtTo = from;
    this.srtP++;
    this.srtStage = 3;
    return false;
  }

  /** µs of the next sort piece (stepCost) */
  private sortPieceUs(nc: number): number {
    const chunk = (us: number, left: number) => Math.max(0, Math.min(coldUnits(us), left)) * us;
    switch (this.srtStage) {
      case 0: return nc < 1024 ? nc * 0.05 : chunk(TC.sortScan, nc);
      case 1: return chunk(TC.sortScan, nc - this.srtCur);
      case 2: return chunk(TC.sortHist, nc - this.srtCur);
      case 3: return 2048 * TC.sortPrefix + (this.srtP + 1 >= this.srtPasses ? nc * TC.fill : 0);
      default: return chunk(TC.sortScatter, nc - this.srtCur);
    }
  }

  /** match unassigned workers to their nearest open site (nearest first, up to capacity); returns the next phase
   *  (whole state: tests) */
  private roundMatch(): number {
    this.mSub = 0;
    for (;;) { const r = this.roundMatchPiece(); if (r !== CONT) return r; }
  }

  /**
   * one PH_RMATCH piece (CONT while more follow): M0 the candidates by origin ranges, M1 the packed keys by candidate
   * ranges, M2 the sort in pieces (sortPiece), M3 round 0's proposals + the round constants (carPcu, trBonus, ovOn = room for the
   * overflow — fixed before the accept loop consumes room, as pre-B2), M4 the accept loop by candidate ranges
   * (nearest first; capacity and park & ride room consumed in the same order), M5 transit-only + the next round (or
   * the overflow: PH_PROVER), M6 the round's car flows (accumulate, commit) and sample routes (the rand() draws).
   */
  private roundMatchPiece(): number {
    switch (this.mSub) {
      case 0: return this.roundMatchPiece0();
      case 1: return this.roundMatchPiece1();
      case 2: return this.roundMatchPiece2();
      case 3: return this.roundMatchPiece3();
      case 4: return this.roundMatchPiece4();
      case 5: return this.roundMatchPiece5();
      default: return this.roundMatchPieceEnd();
    }
  }

  /** roundMatchPiece, sub-state 0 (B2 R10: one small method per piece kind) */
  private roundMatchPiece0(): number {
    const SA = this.SA, oN = this.oN;
    if (this.mCur === 0) { this.mNc = 0; this.mMaxD = 1; this.mNoRoad = 0; }
    // candidates: origins with unassigned workers -> best entry node
    const dist = SA.dist, done = SA.done, key = this.candKey, cnode = this.candNode;
    let nc = this.mNc, maxD = this.mMaxD, noRoad = this.mNoRoad;
    const o0 = this.mCur, o1 = Math.min(oN, o0 + coldUnits(TC.mCand));
    for (let o = o0; o < o1; o++) {
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
    this.mNc = nc; this.mMaxD = maxD; this.mNoRoad = noRoad;
    this.mCur = o1;
    if (o1 >= oN) { this.mSub = 1; this.mCur = 0; }
    return CONT;
  }

  /** roundMatchPiece, sub-state 1 (B2 R10: one small method per piece kind) */
  private roundMatchPiece1(): number {
    const SA = this.SA, oN = this.oN;
    // sort candidates by generalized cost (car label minus any transit time advantage: origins with a fast transit
    // option compete on transit time) — pack (quantised cost, origin index) into one float64
    if (this.mCur === 0) {
      let M = 1;
      while (M < oN) M *= 2;
      this.mM = M;
      this.mQ = Math.max(1, Math.floor(2 ** 50 / (M * (this.mMaxD + 1))));
    }
    const dist = SA.dist, src = SA.src, key = this.candKey, cnode = this.candNode, M = this.mM, q = this.mQ;
    const qN0 = this.qNoise, qP0 = this.qPrice, nc = this.mNc;
    const k0 = this.mCur, k1 = Math.min(nc, k0 + coldUnits(TC.mKey));
    for (let k = k0; k < k1; k++) {
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
    this.mCur = k1;
    if (k1 >= nc) { this.mSub = 2; this.mCur = 0; }
    return CONT;
  }

  /** roundMatchPiece, sub-state 2 (B2 R10: one small method per piece kind) */
  private roundMatchPiece2(): number {
    if (this.sortPiece(this.mNc)) this.mSub = 3;
    return CONT;
  }

  /** roundMatchPiece, sub-state 3 (B2 R10: one small method per piece kind) */
  private roundMatchPiece3(): number {
    const SA = this.SA, oN = this.oN;
    // accept nearest first (the round's constants, fixed before the loop)
    const fx = this.fx;
    this.mCarPcu = (1 / CAR_OCCUPANCY) * (fx ? fx.trafficCar : 1);
    this.mTrBonus = fx ? 2.5 * Math.log(fx.transitRidership) : 0;
    // (r4: riders turned away by all their options become overflow records only while some group has room)
    this.mOvOn = this.gPrN > 0 && this.ovAnyRoom();
    if (this.round === 0) {
      // first round: record unconstrained proposals (excess demand -> shadow prices for the next cycle)
      const sorted = this.candKey, src = SA.src, cnode = this.candNode, M = this.mM;
      for (let k = 0, nc = this.mNc; k < nc; k++) {
        const o = sorted[k] % M;
        this.qProp[src[cnode[o]]] += this.oU[o];
      }
    }
    this.mAccepted = 0;
    this.mCarRound = 0;
    // An interrupted cycle can still hold the previous round's arrays in the overflow records.
    if (this.routeCand === this.ovRouteCand) this.routeCand = [];
    if (this.routeW === this.ovRouteW) this.routeW = [];
    this.routeCand.length = 0; this.routeW.length = 0;
    this.mSub = 4;
    this.mCur = 0;
    return CONT;
  }

  /** roundMatchPiece, sub-state 4 (B2 R10: one small method per piece kind) */
  private roundMatchPiece4(): number {
    const k0 = this.mCur, k1 = Math.min(this.mNc, k0 + coldUnits(TC.mAccept));
    this.acceptRange(k0, k1);
    this.mCur = k1;
    if (k1 >= this.mNc) { this.mSub = 5; this.mCur = 0; }
    return CONT;
  }

  /** roundMatchPiece, sub-state 5 (B2 R10: one small method per piece kind) */
  private roundMatchPiece5(): number {
    let accepted = this.mAccepted;
    // WP7b: transit-only commuters (no road route to any open job — an island reached by ferry or subway) take the job
    // their transit option reaches, while it has room this round
    if (this.mNoRoad > 0) accepted += this.transitOnly(this.mCarPcu);
    this.mAccepted = accepted;
    this.roundAccepted = accepted;
    const next = this.nextRound(accepted);
    // r4: riders turned away by all their options: the overflow decides their mode (its drivers join this round's car
    // flows), then the round's car flows; else the car flows now
    if (this.pnN > 0) {
      this.ovBonus = this.mTrBonus; this.ovCarPcu = this.mCarPcu;
      this.ovBegin(next, this.mCarRound, this.routeCand, this.routeW);
      this.mSub = 0;
      return PH_PROVER;
    }
    this.mNext = next;
    this.mSub = 6;
    this.rfBegin(this.mCarRound, this.routeCand, this.routeW);
    return CONT;
  }

  /** roundMatchPiece, sub-state default (B2 R10: one small method per piece kind) */
  private roundMatchPieceEnd(): number {
    if (!this.rfPiece()) return CONT;
    this.mSub = 0;
    return this.mNext;
  }

  /** the accept loop of roundMatch over the sorted candidates [k0, k1) (the pre-B2 loop body; its running sums in fields) */
  private acceptRange(k0: number, k1: number): void {
    const SA = this.SA;
    const dist = SA.dist, src = SA.src, hops = SA.hops;
    const sorted = this.candKey, cnode = this.candNode, M = this.mM;
    const carPcu = this.mCarPcu, trBonus = this.mTrBonus, ovOn = this.mOvOn;
    const acc = this.acc, tAcc = this.tAcc;
    const qAsg = this.qAsg, qBase = this.qBase, qNoise = this.qNoise, qPrice = this.qPrice, qTimeSum = this.qTimeSum;
    const qPark = this.qPark;
    const routeCand = this.routeCand, routeW = this.routeW;
    let accepted = this.mAccepted, carRound = this.mCarRound;
    for (let k = k0; k < k1; k++) {
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
      this.byModeAdd(o, take, stP > 0 ? this.prDT : 0, carOk);
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
    this.mAccepted = accepted;
    this.mCarRound = carRound;
  }

  /**
   * F6: a committed piece of origin o (`take` people, split in m*; `prDT` = its park & ride riders' extra minutes at
   * another option than the split's — transit minutes) into the per-origin minutes by mode and the transit riders' car
   * alternative (`carOk`: the piece could drive)
   */
  private byModeAdd(o: number, take: number, prDT: number, carOk: boolean): void {
    this.oMc[o] += take * this.mMc;
    this.oMt[o] += take * this.mMt + prDT;
    this.oMw[o] += take * this.mMw;
    this.oAc[o] += take * this.mAc;
    this.oAt[o] += take * this.mAt + (carOk ? prDT : 0);
    this.oAw[o] += take * this.mAw;
  }

  /** the car flows of a matching round along its shortest-path forest (SA), and sample car routes of it (whole state) */
  private roundFlows(carRound: number, routeCand: number[], routeW: number[]): void {
    this.rfBegin(carRound, routeCand, routeW);
    while (!this.rfPiece()) { /* next piece */ }
  }

  /** B2: a round's car flows in pieces — accumulate and commit on SA by settle-order ranges (flowPiece), then the routes */
  private rfBegin(carRound: number, routeCand: number[], routeW: number[]): void {
    this.rfCar = carRound;
    this.rfCand = routeCand;
    this.rfW = routeW;
    this.rfStage = carRound > 0 ? 0 : 2;
    if (carRound > 0) this.flowBegin(this.SA, this.acc, null, null);
  }

  private rfPiece(): boolean {
    if (this.rfStage === 0) {
      if (!this.flowPiece()) return false;
      this.rfStage = 1;
      return false;
    }
    if (this.rfStage === 1) {
      const routeCand = this.rfCand, routeW = this.rfW, carRound = this.rfCar, SA = this.SA;
      // sample car routes of this round (weighted by car trips)
      const K = Math.min(10, routeCand.length);
      if (K > 0) {
        this.routeCum = growF64(this.routeCum, routeCand.length);
        const cum = this.routeCum.subarray(0, routeCand.length);
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
    this.rfStage = 2;
    this.rfCand = this.rfW = EMPTY_NUMS;
    return true;
  }

  /**
   * B2: flows of a forest in pieces — accumulate(S, acc) by settle-order ranges from the end, then commit(S, acc, copy,
   * rampCopy) by ranges from the start; the same operations in the same order as accumulate + commit
   */
  private flowBegin(S: Search, acc: Float32Array, copy: Float32Array | null, rampCopy: Float32Array | null): void {
    this.flS = S;
    this.flAcc = acc;
    this.flCopy = copy;
    this.flRamp = rampCopy;
    this.flPhase = 0;
    this.flCur = S.settled;
  }

  /** one flow piece; true when the commit is complete */
  private flowPiece(): boolean {
    const S = this.flS!;
    if (this.flPhase === 0) {
      const k1 = this.flCur, k0 = Math.max(0, k1 - coldUnits(TC.accumulate));
      accumulateRange(S, this.flAcc, k0, k1);
      this.flCur = k0;
      if (k0 > 0) return false;
      this.flPhase = 1;
      this.flCur = 0;
      return false;
    }
    if (this.flPhase === 1) {
      const k0 = this.flCur, k1 = Math.min(S.settled, k0 + coldUnits(TC.commit));
      this.commitRange(S, this.flAcc, this.flCopy, this.flRamp, k0, k1);
      this.flCur = k1;
      if (k1 < S.settled) return false;
      this.flPhase = 2;
    }
    this.flS = null;
    return true;
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
    this.cmSub = 0;
    while (!this.poolPiece()) { /* next piece */ }
  }

  /**
   * one piece of the pooled match (poolRemaining, B2 §3 "Commute" stage 0); true when done: C0 the per-component
   * workers, C0b the open capacity and the average commute (and the constants of the loop: carPcu, ovOn — fixed before
   * the loop consumes room), C1 the main loop by origin ranges (the pre-B2 body), C2 the sites
   */
  private poolPiece(): boolean {
    switch (this.cmSub) {
      case 0: return this.poolPiece0();
      case 1: return this.poolPiece1();
      case 2: return this.poolPiece2();
      default: return this.poolPieceEnd();
    }
  }

  /** poolPiece, sub-state 0 (B2 R10: one small method per piece kind) */
  private poolPiece0(): boolean {
    const g = this.road, comp = g.comp, nc = g.nComp;
    this.poolFlows = false;
    this.poolQ.length = 0;
    if (nc === 0) return true;
    this.poolU = growF64(this.poolU, nc); this.poolO = growF64(this.poolO, nc);
    const U = this.poolU.subarray(0, nc).fill(0);
    this.poolO.subarray(0, nc).fill(0);
    let any = false;
    for (let o = 0; o < this.oN; o++) {
      if (this.oU[o] < 0.01 || this.oLastD[o] < 0) continue;
      U[comp[this.ent[this.oEntS[o]]]] += this.oU[o];
      any = true;
    }
    if (!any) return true;
    this.cmSub = 1;
    return false;
  }

  /** poolPiece, sub-state 1 (B2 R10: one small method per piece kind) */
  private poolPiece1(): boolean {
    const g = this.road, comp = g.comp, nc = g.nComp;
    const O = this.poolO;
    const full = MATCH_PROP_ROUNDS; // full-capacity rounds
    this.cmSaveRound = this.round;
    this.round = full;
    for (let q = 0; q < this.qN; q++) {
      const c = this.openCap(q);
      if (c > 0.5) O[comp[this.qNode[q]]] += c;
    }
    let tw = 0, tt = 0;
    for (let o = 0; o < this.oN; o++) { tw += this.oAsg[o]; tt += this.oTimeSum[o]; }
    this.cmAvgT = tw > 0 ? tt / tw : 15;
    const fx = this.fx;
    this.cmCarPcu = (1 / CAR_OCCUPANCY) * (fx ? fx.trafficCar : 1);
    this.cmOvOn = this.gPrN > 0 && this.ovAnyRoom();
    this.cmFlows = false;
    // pooled car commuters per component (parking demand of the sites that take them; the overflow records' drivers
    // are added when PH_PROVER decides them: poolCars)
    if (this.poolTk.length !== nc) this.poolTk = new Float64Array(nc);
    if (this.poolCarTk.length !== nc) this.poolCarTk = new Float64Array(nc);
    this.poolTk.fill(0); this.poolCarTk.fill(0);
    this.cmSub = 2;
    this.cmCur = 0;
    return false;
  }

  /** poolPiece, sub-state 2 (B2 R10: one small method per piece kind) */
  private poolPiece2(): boolean {
    const o0 = this.cmCur, o1 = Math.min(this.oN, o0 + coldUnits(TC.poolOrigin));
    this.poolRange(o0, o1);
    this.cmCur = o1;
    if (o1 >= this.oN) this.cmSub = 3;
    return false;
  }

  /** poolPiece, sub-state default (B2 R10: one small method per piece kind) */
  private poolPieceEnd(): boolean {
    const g = this.road, comp = g.comp, nc = g.nComp;
    // the sites with open capacity take the pooled workers of their component (their parking demand: poolCars)
    const U = this.poolU, O = this.poolO, avgT = this.cmAvgT;
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
    this.round = this.cmSaveRound;
    this.poolFlows = this.cmFlows;
    this.ovCarPcu = this.cmCarPcu;
    this.cmSub = 0;
    this.cmCur = 0;
    return true;
  }

  /** the pooled match's main loop over origins [o0, o1) (the pre-B2 body; flows in cmFlows) */
  private poolRange(o0: number, o1: number): void {
    const g = this.road, comp = g.comp;
    const U = this.poolU, O = this.poolO, tk = this.poolTk, carTk = this.poolCarTk;
    const avgT = this.cmAvgT, carPcu = this.cmCarPcu, ovOn = this.cmOvOn;
    const SA = this.SA, acc = this.acc;
    let flows = this.cmFlows;
    for (let o = o0; o < o1; o++) {
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
      this.byModeAdd(o, takeD, stP > 0 ? this.prDT : 0, true);
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
    this.cmFlows = flows;
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
      this.oMt[o] += take * t; // (F6: transit only — no car alternative)
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
    let bMc = f * this.mMc, bMt = f * this.mMt, bMw = f * this.mMw, bAc = f * this.mAc, bAt = f * this.mAt, bAw = f * this.mAw;
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
      bMc += ww * this.mMc; bMt += ww * this.mMt; bMw += ww * this.mMw; bAc += ww * this.mAc; bAt += ww * this.mAt; bAw += ww * this.mAw;
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
          bMc += rest * this.mMc; bMt += rest * this.mMt; bMw += rest * this.mMw; bAc += rest * this.mAc; bAt += rest * this.mAt; bAw += rest * this.mAw;
          this.prUnplaced(o, take * rest * lastTP);
        }
      } else {
        matched = 1 - rest;
        this.prUnplaced(o, take * rest * lastTP);
      }
    }
    // (shares of the decided part of the piece)
    const dec = matched - this.prPend;
    if (dec < 1 && dec > 1e-9) {
      const r = 1 / dec;
      aC *= r; aW *= r; aP *= r; aK *= r; aT *= r; aX *= r;
      bMc *= r; bMt *= r; bMw *= r; bAc *= r; bAt *= r; bAw *= r;
    }
    this.mC = aC; this.mTW = aW; this.mTP = aP; this.mW = aK; this.mT = aT; this.mX = aX;
    this.mMc = bMc; this.mMt = bMt; this.mMw = bMw; this.mAc = bAc; this.mAt = bAt; this.mAw = bAw;
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
   * chunks stage 1 runs) — in stage 3 (records in chunks; a kept forest's car-leg minutes of this assignment renewed along
   * the labels read), then stage 4: what is left without park & ride (chunks), and with the last chunk the round's car flows (the
   * overflow car legs: PH_COMMUTE, before commuteEnd). Returns the next phase (the round's successor when done)
   */
  private overflowPiece(): number {
    // (the last pieces: the round's car flows and routes, as roundFlows)
    if (this.ovFlow === 1) {
      if (!this.rfPiece()) return CONT;
      this.ovFlow = 0;
      this.ovRouteCand = []; this.ovRouteW = [];
      this.pnN = 0;
      return this.ovNext;
    }
    if (this.ovStage === 1) {
      const S = this.ov[this.ovSlot].S;
      // (a cached forest keeps its result only)
      if (S.run(coldUnits(TC.ovState))) { S.releaseScratch(); this.ovStartPass(); }
      return CONT;
    }
    if (this.ovStage === 3) {
      const f = this.ov[this.ovSlot];
      // (a kept forest's car-leg minutes of this assignment: renewed along the labels the records read, altAt)
      if (f.alt !== this.cycles) { f.S.markAlt(this.nodeTime, this.rampT); f.alt = this.cycles; }
      const end = Math.min(this.pnN, this.ovCur + coldUnits(TC.ovRec));
      this.ovAlloc(this.ovCur, end);
      this.ovCur = end;
      if (end < this.pnN) return CONT;
      // another pass while people are left that this pass's forest could not serve: a forest with fewer seeds
      this.ovPass++;
      const more = this.ovPass < OV_PASSES || (this.ovPass < OV_PASSES_MAX && this.ovPlaced >= OV_MIN_ROOM);
      if (this.ovExh >= OV_MIN_ROOM && more && this.ovLeft()) this.ovPlan(true);
      else { this.ovStage = 4; this.ovCur = 0; }
      return CONT;
    }
    const end = Math.min(this.pnN, this.ovCur + coldUnits(TC.ovRec));
    this.ovRest(this.ovCur, end);
    this.ovCur = end;
    if (end < this.pnN) return CONT;
    // (the overflow car legs stay on their forests until PH_COMMUTE's last steps: one pass per forest and assignment)
    this.rfBegin(this.ovCarRound, this.ovRouteCand, this.ovRouteW);
    this.ovFlow = 1;
    return CONT;
  }

  /** the records of a round / the pooled match are complete: plan the overflow's first pass (PH_PROVER follows) */
  private ovBegin(next: number, carRound: number, routeCand: number[], routeW: number[]): void {
    this.ovNext = next;
    this.ovCarRound = carRound;
    this.ovRouteCand = routeCand;
    this.ovRouteW = routeW;
    this.ovPass = 0;
    this.ovPlan(false);
  }

  /** the pass's forest is ready: re-decide the records with it (stage 3) */
  private ovStartPass(): void {
    this.ovStage = 3;
    this.ovCur = 0;
    this.ovExh = 0;
    this.ovPlaced = 0;
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
   * plan an overflow pass: the seeds (ovSeedOk) — none, or no record left: stage 4 (the rest without park & ride); a kept
   * forest seeded at a superset of them (the same garages and graph, younger than PR_SEARCH_EVERY assignments, none of
   * their ranking minutes moved more than PR_SEED_DRIFT since): its best label at a node of a group with room is the best
   * of the groups with room there (they are among its seeds), so it serves every record whose node has such a label —
   * the one with the fewest seeds; `again` (the last pass left people its forest could not serve, ovExh): only one with
   * fewer seeds than that forest, and a fresh search only when groups filled since (else nothing new: stage 4). Stage 3;
   * else a fresh OV_K-label search from the seeds' road entries (ranking minutes, free-flow car legs within
   * PR_CAR_LEG_MAX, the congested ones along them for the choices) in a free or the least recently used cache slot, at
   * most OV_SEARCHES per assignment: stage 1 runs it. (Rooms only shrink within an assignment: a forest of this
   * assignment is seeded at a superset of every later pass's groups.)
   */
  private ovPlan(again: boolean): void {
    const g = this.road, gN = this.gN;
    this.ovCur = 0;
    let nSeed = 0;
    for (let q = 0; q < gN; q++) if (this.ovSeedOk(q)) nSeed++;
    if (nSeed === 0 || !this.ovLeft()) { this.ovStage = 4; return; }
    const key = this.prKeyNow + '|' + g.version;
    const below = again && this.ovSlot >= 0 && this.ovSlot < this.ov.length ? this.ov[this.ovSlot].nSeed : Infinity;
    let slot = -1;
    for (let i = 0; i < this.ov.length; i++) {
      const f = this.ov[i];
      if (f.key !== key || f.S.graphVersion !== g.version || f.S.running || this.cycles - f.built >= PR_SEARCH_EVERY) continue;
      if (f.nSeed >= below || (slot >= 0 && f.nSeed >= this.ov[slot].nSeed) || f.inS.length < gN) continue;
      let ok = true;
      for (let q = 0; q < gN && ok; q++) if (this.ovSeedOk(q) && (f.inS[q] !== 1 || Math.abs(this.gRank[q] - f.seed[q]) > PR_SEED_DRIFT)) ok = false;
      if (ok) slot = i;
    }
    if (slot >= 0) {
      this.ov[slot].used = ++this.ovTick;
      this.ovSlot = slot;
      if (this.ovFilt < 0) this.ovFilt = slot;
      this.ovStartPass();
      return;
    }
    // (a fresh search of the same seeds as the forest that left them would find nothing new)
    if (this.ovSearches >= (this.ovPass >= OV_PASSES ? OV_SEARCHES_MAX : OV_SEARCHES) || nSeed >= below) { this.ovStage = 4; return; }
    if (this.ov.length < OV_CACHE) {
      this.ov.push({ S: new SearchK(OV_K, true), key: '', seed: new Float32Array(0), inS: new Uint8Array(0), nSeed: 0, built: -1, alt: -1, used: 0, acc: new Float32Array(0), dirty: false });
      slot = this.ov.length - 1;
    } else {
      // (the least recently used; one without car legs of this assignment to commit first)
      slot = 0;
      for (let i = 1; i < this.ov.length; i++) {
        const a = this.ov[i], b = this.ov[slot];
        if (a.dirty !== b.dirty ? !a.dirty : a.used < b.used) slot = i;
      }
    }
    const f = this.ov[slot];
    // (the car legs it carried earlier in this assignment first: the forest is replaced)
    if (f.dirty) { this.commitK(f.S, f.acc); f.dirty = false; }
    // (a forest replacing the filter's: its seeds are those of now, a superset of every later pass's too)
    if (this.ovFilt < 0 || this.ovFilt === slot) this.ovFilt = slot;
    const seeds = this.seeds;
    seeds.clear();
    if (f.seed.length < gN) f.seed = new Float32Array(gN + 16);
    if (f.inS.length < gN) f.inS = new Uint8Array(gN + 16);
    else f.inS.fill(0);
    let maxL = 0;
    for (let q = 0; q < gN; q++) {
      if (!this.ovSeedOk(q)) continue;
      const L = this.gRank[q];
      f.seed[q] = L;
      f.inS[q] = 1;
      for (let e = this.gEntS[q], e1 = e + this.gEntC[q]; e < e1; e++) seeds.push(this.ent[e], L, q);
      if (L > maxL) maxL = L;
    }
    f.S.start(g, g.rev, g.t0, seeds, this.gGrp, Math.min(MAX_COMMUTE, maxL + PR_CAR_LEG_MAX), null, PR_CAR_LEG_MAX, PR_OPTION_MARGIN, this.nodeTime, this.rampT);
    f.key = key; f.nSeed = nSeed; f.built = f.alt = this.cycles; f.used = ++this.ovTick;
    if (f.acc.length < OV_K * g.n) f.acc = new Float32Array(OV_K * g.n + 64);
    else f.acc.fill(0, 0, OV_K * g.n);
    this.ovSearches++;
    this.ovSlot = slot;
    this.ovStage = 1;
  }

  /**
   * overflow records [from, to) with the current pass's forest: at the origin's road entry whose fastest label of a group
   * with room is the fastest (none: the entry with the fastest label), its groups (fastest first) that still have room,
   * within PR_OPTION_MARGIN of the origin's fastest option and transit under PR_LIMIT — a mode split with that option,
   * like prRest's levels: the people whose riders fit are decided (ovCommit), the rest try the next group, then (ovExh:
   * the node's labels all within the margin, a group beyond them may have room) a pass with fewer seeds, then go without
   * park & ride (ovRest)
   */
  private ovAlloc(from: number, to: number): void {
    const f = this.ov[this.ovSlot], S = f.S, KS = S.K, gN = this.gN, grp = this.gGrp, ent = this.ent;
    const dist = S.dist, src = S.src, cnt = S.cnt;
    const n = Math.min(S.n, this.road.n);
    for (let i = from; i < to; i++) {
      let y = this.pnY[i];
      if (!(y > 1e-9)) continue;
      const o = this.pnO[i];
      let v = -1, bd = Infinity, v0 = -1, b0 = Infinity;
      for (let e = this.oEntS[o], e1 = e + this.oEntC[o]; e < e1; e++) {
        const u = ent[e];
        if (u >= n) continue;
        for (let k = 0, kn = cnt[u]; k < kn; k++) {
          const s = KS * u + k, q = src[s];
          if (k === 0 && dist[s] < b0) { b0 = dist[s]; v0 = u; }
          if (q >= 0 && q < gN && this.prRoom(q) > 1e-6) { if (dist[s] < bd) { bd = dist[s]; v = u; } break; }
        }
      }
      if (v < 0) v = v0;
      if (v < 0) continue;
      const lim = this.oPrF0[o] + PR_OPTION_MARGIN;
      this.ovArgs(i);
      for (let k = 0, kn = cnt[v]; k < kn && y > 1e-9; k++) {
        const s = KS * v + k, q = src[s];
        if (q < 0 || q >= gN || !(dist[s] - f.seed[q] + this.gRank[q] <= lim)) continue;
        const room = this.prRoom(q);
        if (!(room > 1e-6) || !(this.gLabel[q] < PR_LIMIT) || this.gBoard[q] < 0 || this.gStop[q] < 0) continue;
        const T = PR_HOME_MIN + S.altAt(s) + this.gLabel[q];
        if (!(T <= MAX_COMMUTE) || !this.splitFor(o, T, 0)) continue;
        const want = y * this.mTP;
        const fit = want < room ? want : room;
        const p = want > 1e-12 ? y * Math.min(1, fit / want) : y;
        this.gWantR[grp[q]] += want;
        this.pnTP[i] = this.mTP;
        this.ovCommit(i, p, fit, q, s, f);
        this.ovPlaced += fit;
        y -= p;
      }
      this.pnY[i] = y;
      if (y > 1e-9 && cnt[v] === KS) {
        const s = KS * v + KS - 1, q = src[s];
        if (q >= 0 && q < gN && dist[s] - f.seed[q] + this.gRank[q] <= lim) this.ovExh += y;
      }
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
    this.byModeAdd(o, p, 0, true);
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
    // (F6: the minutes by mode; transit riders with a car alternative: its minutes)
    let mc = sc > 0 ? sc * carT : 0, mt = stt > 0 ? stt * tOwn : 0, mw = sw > 0 ? sw * walkT : 0;
    let ac = carOk && stt > 0 ? stt * carT : 0, at = carOk ? mt : 0, aw = carOk ? stt : 0;
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
      const mtL = stL > 0 ? stL * tL : 0;
      mc = co * mc + cl * (scL > 0 ? scL * (carT + CARLESS_EXTRA_MIN) : 0);
      mt = co * mt + cl * mtL;
      mw = co * mw + cl * (swL > 0 ? swL * walkT : 0);
      ac = co * ac + cl * (carOk && stL > 0 ? stL * (carT + CARLESS_EXTRA_MIN) : 0);
      at = co * at + cl * (carOk ? mtL : 0);
      aw = co * aw + cl * (carOk ? stL : 0);
    }
    this.mC = sc; this.mTW = stW; this.mTP = stP; this.mW = sw; this.mT = time; this.mX = extra;
    this.mMc = mc; this.mMt = mt; this.mMw = mw; this.mAc = ac; this.mAt = at; this.mAw = aw;
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
    let mc = (1 - stO) * carT, mt = stO > 0 ? stO * tOwn : 0, ac = stO * carT, aw = stO;
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
      mc = co * mc + cl * (1 - stL) * (carT + CARLESS_EXTRA_MIN);
      mt = co * mt + cl * (stL > 0 ? stL * tL : 0);
      ac = co * ac + cl * stL * (carT + CARLESS_EXTRA_MIN);
      aw = co * aw + cl * stL;
    }
    this.mTW = stW; this.mTP = stP; this.mW = 0; this.mC = 1 - stW - stP; this.mT = time; this.mX = extra;
    this.mMc = mc; this.mMt = mt; this.mMw = 0; this.mAc = ac; this.mAt = mt; this.mAw = aw;
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
   * clears acc on the settled nodes — B2: over the settle-order range [k0, k1) (ranges in order from 0 to S.settled give
   * the pre-B2 commit over the whole forest exactly)
   */
  private commitRange(S: Search, acc: Float32Array, copy: Float32Array | null, rampCopy: Float32Array | null, k0: number, k1: number): void {
    const volNew = this.volNew, rampNew = this.rampNew, order = S.order, next = S.next, type = this.road.type;
    const HW = Network.Highway;
    for (let k = k0; k < k1; k++) {
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

  /** B2: commitK over the settle-order range [k0, k1), walked backwards (ranges from the end of order to its start give
   *  commitK exactly: a state's flow moves to its parent, settled earlier) */
  private commitKRange(S: SearchK, acc: Float32Array, k0: number, k1: number): void {
    const order = S.order, next = S.next, snode = S.node, volNew = this.volNew, rampNew = this.rampNew, type = this.road.type;
    const HW = Network.Highway;
    for (let k = k1 - 1; k >= k0; k--) {
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

  /**
   * PH_COMMUTE (B2 §3 "Commute"): stage 0 the pooled match (poolPiece) — then the overflow of its records (PH_PROVER)
   * or its car flows in pieces; stage 1 the overflow car legs of this assignment (one forest at a time, its backward
   * walk by settle-order ranges), then commuteEnd's pieces
   */
  private commutePiece(): number {
    if (this.commuteStage === 0) {
      if (this.cmFlowing) {
        if (!this.flowPiece()) return CONT;
        this.cmFlowing = false;
        this.commuteStage = 1;
        return CONT;
      }
      if (!this.poolPiece()) return CONT;
      if (this.pnN > 0) {
        this.ovBegin(PH_COMMUTE, this.poolFlows ? 1 : 0, [], []);
        this.commuteStage = 1;
        return PH_PROVER;
      }
      if (this.poolFlows) {
        this.flowBegin(this.SA, this.acc, null, null);
        this.cmFlowing = true;
        return CONT;
      }
      this.commuteStage = 1;
      return CONT;
    }
    // (r4: the overflow car legs of this assignment first, one forest at a time)
    if (this.ceSub === 0) {
      if (this.olF === null) {
        const f = this.ov.find((x) => x.dirty);
        if (f) { this.olF = f; this.olCur = f.S.settled; }
      }
      const f = this.olF;
      if (f !== null) {
        const k1 = this.olCur, k0 = Math.max(0, k1 - coldUnits(TC.commitK));
        this.commitKRange(f.S, f.acc, k0, k1);
        this.olCur = k0;
        if (k0 > 0) return CONT;
        f.dirty = false;
        this.olF = null;
        return CONT;
      }
    }
    if (!this.commuteEndPiece()) return CONT;
    this.commuteStage = 0;
    return NEXT_PHASE[PH_COMMUTE];
  }

  /** transit rider flows, per-origin results and stats of the commute matching (whole state; with poolCars first) */
  private commuteEnd(): void {
    this.ceSub = 0;
    while (!this.commuteEndPiece()) { /* next piece */ }
  }

  /**
   * one piece of the commute end (poolCars + the pre-B2 commuteEnd); true when done. E0 the pooled parking demand and the
   * shadow prices; E1 the per-site distribution + persisted prices; E2 the park & ride car legs (backward ranges); E3 the
   * reach snapshot's road cells gathered by origin ranges (into back arrays); E4 PUBLISH the garage reports, prices and
   * the reach snapshot (garageInfo / garageReach read them together); E5 the transit forest's accumulation (backward
   * ranges; the stop loads' sink calls in walk order); E6/E7 the transit flows by settle-order ranges into the back bus
   * raster and ferry map, swapped in at the end (cellBusRiders / ferryRidersAt); E8/E9 markCutOff; E10 the per-origin
   * results by ranges (sums as doubles in fields); E11 the cut-off minutes; E12 the commute by mode.
   */
  private commuteEndPiece(): boolean {
    switch (this.ceSub) {
      case 0: return this.commuteEndPiece0();
      case 1: return this.commuteEndPiece1();
      case 2: return this.commuteEndPiece2();
      case 3: return this.commuteEndPiece3();
      case 4: return this.commuteEndPiece4();
      case 5: return this.commuteEndPiece5();
      case 6: return this.commuteEndPiece6();
      case 7: return this.commuteEndPiece7();
      case 8: return this.commuteEndPiece8();
      case 9: return this.commuteEndPiece9();
      case 10: return this.commuteEndPiece10();
      case 11: return this.commuteEndPiece11();
      default: return this.commuteEndPieceEnd();
    }
  }

  /** commuteEndPiece, sub-state 0 (B2 R10: one small method per piece kind) */
  private commuteEndPiece0(): boolean {
    this.poolCars();
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
      const p = this.qPrice[q] + stepP * Math.log(r);
      this.qPrice[q] = p < -MATCH_PRICE_MAX ? -MATCH_PRICE_MAX : p > MATCH_PRICE_MAX ? MATCH_PRICE_MAX : p;
    }
    this.ceSub = 1;
    return false;
  }

  /** commuteEndPiece, sub-state 1 (B2 R10: one small method per piece kind) */
  private commuteEndPiece1(): boolean {
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
    // WP7-8 park & ride: car legs along the K-label P&R forest (the overflow's were committed by PH_PROVER)
    if (this.gPrN > 0 && this.prRiders > 0 && this.SPK.graphVersion === this.road.version) {
      this.ceCur = this.SPK.settled;
      this.ceSub = 2;
    } else {
      if (this.prAcc.length > 0) this.prAcc.fill(0, 0, Math.min(this.prAcc.length, this.SPK.K * this.road.n));
      this.ceSub = 3;
      this.ceCur = 0;
      this.ceE = 0;
    }
    return false;
  }

  /** commuteEndPiece, sub-state 2 (B2 R10: one small method per piece kind) */
  private commuteEndPiece2(): boolean {
    const k1 = this.ceCur, k0 = Math.max(0, k1 - coldUnits(TC.commitK));
    this.commitKRange(this.SPK, this.prAcc, k0, k1);
    this.ceCur = k0;
    if (k0 > 0) return false;
    this.ceSub = 3;
    this.ceCur = 0;
    this.ceE = 0;
    return false;
  }

  /** commuteEndPiece, sub-state 3 (B2 R10: one small method per piece kind) */
  private commuteEndPiece3(): boolean {
    // (the reach snapshot's road cells — not node ids: the hint still finds them after a graph rebuild, routed 53)
    const oN = this.oN, o0 = this.ceCur, o1 = Math.min(oN, o0 + coldUnits(TC.snapGather));
    let E = this.ceE;
    for (let o = o0; o < o1; o++) E += this.oEntC[o];
    this.rsEntSB = growI32(this.rsEntSB, oN);
    this.rsEntB = growI32(this.rsEntB, E);
    const cellOf = this.road.cellOf, ent = this.ent, entS = this.rsEntSB, outE = this.rsEntB;
    let e = this.ceE;
    for (let o = o0; o < o1; o++) {
      const c = this.oEntC[o];
      entS[o] = e;
      for (let x = this.oEntS[o], x1 = x + c; x < x1; x++) outE[e++] = cellOf[ent[x]];
    }
    this.ceE = e;
    this.ceCur = o1;
    if (o1 >= oN) this.ceSub = 4;
    return false;
  }

  /** commuteEndPiece, sub-state 4 (B2 R10: one small method per piece kind) */
  private commuteEndPiece4(): boolean {
    this.garageReports();
    this.snapReachPublish();
    this.ceSub = 5;
    this.ceCur = this.ST.settled;
    return false;
  }

  /** commuteEndPiece, sub-state 5 (B2 R10: one small method per piece kind) */
  private commuteEndPiece5(): boolean {
    const k1 = this.ceCur, k0 = Math.max(0, k1 - coldUnits(TC.trAccumulate));
    accumulateRange(this.ST, this.tAcc, k0, k1, this.stopSink);
    this.ceCur = k0;
    if (k0 > 0) return false;
    this.ceSub = 6;
    return false;
  }

  /** commuteEndPiece, sub-state 6 (B2 R10: one small method per piece kind) */
  private commuteEndPiece6(): boolean {
    const C = this.road.C;
    if (this.busCellB.length !== C) this.busCellB = new Float32Array(C);
    this.busCellB.fill(0);
    this.ferryRidersByB.clear();
    this.ceFerry = 0;
    this.ceCur = 0;
    this.ceSub = 7;
    return false;
  }

  /** commuteEndPiece, sub-state 7 (B2 R10: one small method per piece kind) */
  private commuteEndPiece7(): boolean {
    const ST = this.ST, T = this.tnet!, tAcc = this.tAcc;
    const nR = this.road.n, nRail = T.nRail, nGrid = nR + nRail + T.nSub;
    const nodeStop = this.nodeStop, volNew = this.volNew, busCell = this.busCellB, ferryBy = this.ferryRidersByB;
    const type = this.road.type, cellOf = this.road.cellOf, next = ST.next, rampNew = this.rampNew, HW = Network.Highway;
    const k0 = this.ceCur, k1 = Math.min(ST.settled, k0 + coldUnits(TC.trFlow));
    let ferry = this.ceFerry;
    for (let k = k0; k < k1; k++) {
      const v = ST.order[k];
      const f = tAcc[v];
      if (f === 0) continue;
      if (v < nR) {
        const pcu = f * BUS_PCU_PER_RIDER;
        volNew[v] += pcu;
        busCell[cellOf[v]] = f;
        const nx = next[v];
        if (nx >= 0 && nx < nR && (type[v] === HW) !== (type[nx] === HW)) rampNew[type[v] === HW ? nx : v] += pcu;
      } else if (v < nR + nRail) this.railNew[v - nR] += f;
      else if (v < nGrid) this.subNew[v - nR - nRail] += f;
      else {
        // ferry node: riders through the terminal; flow leaving along a ferry link crossed the water
        const s = nodeStop[v];
        if (s >= 0) ferryBy.set(this.stops.bid[s], (ferryBy.get(this.stops.bid[s]) ?? 0) + f);
        if (next[v] >= nGrid) ferry += f;
      }
    }
    this.ceFerry = ferry;
    this.ceCur = k1;
    if (k1 < ST.settled) return false;
    // (published together: cellBusRiders / ferryRidersAt never see a half-filled raster)
    const b = this.busCell;
    this.busCell = this.busCellB;
    this.busCellB = b;
    const m = this.ferryRidersBy;
    this.ferryRidersBy = this.ferryRidersByB;
    this.ferryRidersByB = m;
    this.ferryRiders = ferry;
    this.ceSub = 8;
    return false;
  }

  /** commuteEndPiece, sub-state 8 (B2 R10: one small method per piece kind) */
  private commuteEndPiece8(): boolean {
    this.ceTripsC = this.ceTripsT = this.ceTripsW = this.ceCSum = this.ceCW = 0;
    this.ceSub = this.markCutOffBegin() ? 9 : 10;
    this.ceCur = 0;
    return false;
  }

  /** commuteEndPiece, sub-state 9 (B2 R10: one small method per piece kind) */
  private commuteEndPiece9(): boolean {
    const o0 = this.ceCur, o1 = Math.min(this.oN, o0 + coldUnits(TC.cutOff));
    this.markCutOffRange(o0, o1);
    this.ceCur = o1;
    if (o1 >= this.oN) { this.ceSub = 10; this.ceCur = 0; }
    return false;
  }

  /** commuteEndPiece, sub-state 10 (B2 R10: one small method per piece kind) */
  private commuteEndPiece10(): boolean {
    const cut = this.oCut;
    const o0 = this.ceCur, o1 = Math.min(this.oN, o0 + coldUnits(TC.ceOrigin));
    let tripsC = this.ceTripsC, tripsT = this.ceTripsT, tripsW = this.ceTripsW, cSum = this.ceCSum, cW = this.ceCW;
    for (let o = o0; o < o1; o++) {
      const a = this.oAsg[o];
      const W = this.oW[o];
      this.oEmp[o] = W > 0 ? Math.min(1, a / W) : 0;
      // (routed 43: a cut-off home's few matches are no commute — not in the city average; its minutes are the
      // unreached ones below; the share matched stays, BF.NoJobs follows it)
      if (a > 0 && cut[o] === 1) {
        this.oTime[o] = 0;
        this.oShC[o] = this.oCarW[o] / a;
        this.oShT[o] = this.oTrW[o] / a;
        this.oShW[o] = this.oWalkW[o] / a;
      } else if (a > 0) {
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
    this.ceTripsC = tripsC; this.ceTripsT = tripsT; this.ceTripsW = tripsW; this.ceCSum = cSum; this.ceCW = cW;
    this.ceCur = o1;
    if (o1 < this.oN) return false;
    this.tripsCar = tripsC;
    this.tripsTransit = tripsT;
    this.tripsWalk = tripsW;
    this.commuteSum = cSum;
    this.commuteW = cW;
    this.ceSub = 11;
    this.ceCur = 0;
    return false;
  }

  /** commuteEndPiece, sub-state 11 (B2 R10: one small method per piece kind) */
  private commuteEndPiece11(): boolean {
    // routed 43: every cut-off home reads the longest commute (MAX_COMMUTE: no trip to work) — the commute layer, the
    // access field it seeds, desirability's and land value's commute terms and approval see "no route to work", not
    // the 5 minutes to the one job on their road (nor services' milder unreached-cell minutes, ACCESS_UNREACHED x the
    // city average, which still scores as a fair commute next to the inspector's "No route to work")
    const cut = this.oCut;
    const o0 = this.ceCur, o1 = Math.min(this.oN, o0 + coldUnits(TC.cutMin));
    for (let o = o0; o < o1; o++) if (cut[o] === 1) this.oTime[o] = MAX_COMMUTE;
    this.ceCur = o1;
    if (o1 < this.oN) return false;
    this.bmMc = this.bmMt = this.bmMw = this.bmAc = this.bmAt = this.bmAw = this.bmNC = this.bmNT = this.bmNW = 0;
    this.ceSub = 12;
    this.ceCur = 0;
    return false;
  }

  /** commuteEndPiece, sub-state default (B2 R10: one small method per piece kind) */
  private commuteEndPieceEnd(): boolean {
    // F6: the mean commute of each mode's commuters (cut-off homes left out, like the city average) and what transit
    // saves its riders against driving the same trip (stats.commuteByMode)
    const cut = this.oCut;
    const o0 = this.ceCur, o1 = Math.min(this.oN, o0 + coldUnits(TC.byMode));
    let mc = this.bmMc, mt = this.bmMt, mw = this.bmMw, ac = this.bmAc, at = this.bmAt, aw = this.bmAw, nC = this.bmNC, nT = this.bmNT, nW = this.bmNW;
    for (let o = o0; o < o1; o++) {
      if (cut[o] === 1 || !(this.oAsg[o] > 0)) continue;
      mc += this.oMc[o]; mt += this.oMt[o]; mw += this.oMw[o]; ac += this.oAc[o]; at += this.oAt[o]; aw += this.oAw[o];
      nC += this.oCarW[o]; nT += this.oTrW[o]; nW += this.oWalkW[o];
    }
    this.bmMc = mc; this.bmMt = mt; this.bmMw = mw; this.bmAc = ac; this.bmAt = at; this.bmAw = aw; this.bmNC = nC; this.bmNT = nT; this.bmNW = nW;
    this.ceCur = o1;
    if (o1 < this.oN) return false;
    const bm = this.byMode;
    bm.car = nC >= 0.5 ? mc / nC : 0;
    bm.transit = nT >= 0.5 ? mt / nT : 0;
    bm.walk = nW >= 0.5 ? mw / nW : 0;
    bm.transitSaved = aw >= 0.5 ? (ac - at) / aw : 0;
    this.ceSub = 0;
    this.ceCur = 0;
    return true;
  }

  /**
   * commuteEnd's garage part (published with the reach snapshot): per garage the cars / riders / demand of this
   * assignment (the reports and stats.transitFleet.parkRide read the same numbers) and the rationing price for the next
   * one: tatonnement on wanted (the logit choice) / room (demand beyond the room raises it, idle room lowers it to 0; a
   * group that is nobody's option has no demand to ration: 0). The price only splits the riders over their options (r4:
   * the mode choice does not see it, see prPick)
   */
  private garageReports(): void {
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
  }

  /**
   * routed 43: origins whose road is cut off from the city's jobs (oCut): every road component of their entries is
   * not the one with the most job slots (regional connections included) and holds fewer than CUTOFF_JOB_SHARE job slots
   * per worker living on it; an origin with a transit option (walk to a stop, park & ride) is never cut off (an island
   * town with a ferry or a subway commutes for real), nor is a component with a road to the map edge (its residents
   * commute to the region: a second town on a highway is not cut off however few jobs it has). Whole state (begin + the
   * origins).
   */
  private markCutOff(): void {
    if (this.markCutOffBegin()) this.markCutOffRange(0, this.oN);
  }

  /** markCutOff's components (slots, workers, edge, the cut components); false = nobody is cut off (no origin loop) */
  private markCutOffBegin(): boolean {
    const g = this.road, comp = g.comp, nc = g.nComp, oN = this.oN;
    const cut = (this.oCut = growU8(this.oCut, oN));
    cut.fill(0, 0, oN);
    if (nc <= 1 || oN === 0) return false;
    const slots = new Float64Array(nc), workers = new Float64Array(nc);
    for (let q = 0; q < this.qN; q++) { const v = this.qNode[q]; if (v >= 0 && v < g.n) slots[comp[v]] += this.qSlots[q]; }
    for (let o = 0; o < oN; o++) if (this.oEntC[o] > 0) workers[comp[this.ent[this.oEntS[o]]]] += this.oW[o];
    const edge = new Uint8Array(nc);
    for (let j = this.jB; j < this.jN; j++) if (this.jEntC[j] > 0) { const v = this.ent[this.jEntS[j]]; if (v >= 0 && v < g.n) edge[comp[v]] = 1; }
    let main = -1, best = -1;
    for (let c = 0; c < nc; c++) if (slots[c] > best) { best = slots[c]; main = c; }
    // (no job pool anywhere yet — a new town: nobody is "cut off" from it)
    if (!(best >= 1)) return false;
    const cc = (this.cutComp = new Uint8Array(nc));
    for (let c = 0; c < nc; c++) cc[c] = c !== main && edge[c] === 0 && workers[c] > 0 && slots[c] < CUTOFF_JOB_SHARE * workers[c] ? 1 : 0;
    return true;
  }

  private markCutOffRange(o0: number, o1: number): void {
    const comp = this.road.comp, cut = this.oCut, cc = this.cutComp;
    for (let o = o0; o < o1; o++) {
      if (this.oEntC[o] === 0 || this.oTrT[o] < Infinity || this.oPrN[o] > 0) continue;
      let all = true;
      for (let e = this.oEntS[o], e1 = e + this.oEntC[o]; e < e1; e++) if (cc[comp[this.ent[e]]] === 0) { all = false; break; }
      if (all) cut[o] = 1;
    }
  }

  // ------------------------------------------------------------------------------------------ INBOUND
  /** whole-state inbound (tests) */
  private inbound(): void {
    this.sfSub = 0;
    this.sfCur = 0;
    while (!this.inboundPiece()) { /* next piece */ }
  }

  /**
   * one PH_INBOUND piece; true when done. Cached cycles: one piece. Recompute: the fills + seeds + search start, the
   * forward search in chunks (RoadSearchRun on SB), the desire / scale, the inflows, the flows (accumulate + commit
   * by ranges), then tripsInbound (inboundTotal: changes in this one piece), the connection inflows and the routes
   */
  private inboundPiece(): boolean {
    switch (this.sfSub) {
      case 0: return this.inboundPiece0();
      case 1: return this.inboundPiece1();
      case 2: return this.inboundPiece2();
      case 3: return this.inboundPiece3();
      case 4: return this.inboundPiece4();
      default: return this.inboundPieceEnd();
    }
  }

  /** inboundPiece, sub-state 0 (B2 R10: one small method per piece kind) */
  private inboundPiece0(): boolean {
    const g = this.road;
    if (!this.sfRecompute) return this.inboundCachedPiece();
    // (two pieces: the fills, then the seeds + the search start; sfCur = -1 between them)
    if (this.sfCur === 0) {
      this.volInbound = growF32(this.volInbound, g.n);
      this.volInbound.fill(0, 0, g.n);
      this.rampSF = growF32(this.rampSF, g.n);
      this.rampSF.fill(0, 0, g.n);
      for (let j = 0; j < this.jB; j++) this.inboundById[this.jBid[j]] = 0;
      this.sfCur = -1;
      return false;
    }
    this.sfCur = 0;
    const seeds = this.seeds;
    seeds.clear();
    const conns = this.inConns;
    conns.length = 0;
    for (let j = this.jB; j < this.jN; j++) {
      if (this.jEntC[j] === 0) continue;
      const node = this.ent[this.jEntS[j]];
      seeds.push(node, REGIONAL_TIME, conns.length);
      conns.push(j);
    }
    if (seeds.n === 0) { this.tripsInbound = 0; return true; }
    this.runB.start(g, g.fwd, this.nodeTime, this.SB, seeds, REGIONAL_TIME + 90, this.rampT);
    this.sfSub = 1;
    return false;
  }

  /**
   * inboundPiece, sub-state 0 of a cached cycle, by ranges (B2 fix round: in one piece it ran 2.2-5.8 ms on its first
   * executions after a load, cached cycles being every other one): sfCur walks the job sites [0, jB) — the last inflows
   * by building, capped by this cycle's vacancies; the sum in sfTot, a double as pre-B2's local; tripsInbound in the
   * range's last piece — then the cached volumes [jB, jB + n), then the ramp flows of the cached inbound / shop / freight
   * passes [jB + n, jB + 2n) when they exist. Element-wise loops in pre-B2's order: a whole stage = pre-B2's piece.
   */
  private inboundCachedPiece(): boolean {
    const n = this.road.n, jB = this.jB, c0 = this.sfCur;
    // (no job sites: pre-B2's empty loop still set tripsInbound = 0)
    if (c0 === 0 && jB === 0) this.tripsInbound = 0;
    if (c0 < jB) {
      if (c0 === 0) this.sfTot = 0;
      const j1 = Math.min(jB, c0 + coldUnits(TC.inCached));
      let tot = this.sfTot;
      for (let j = c0; j < j1; j++) {
        const spare = this.jSlots[j] - Math.min(this.jSlots[j], this.jAsg[j]);
        const v = Math.min(spare, this.inboundById[this.jBid[j]]);
        this.jInbound[j] = v > 0 ? v : 0;
        this.jCar[j] += this.jInbound[j];
        tot += this.jInbound[j];
      }
      this.sfTot = tot;
      this.sfCur = j1;
      if (j1 === jB) this.tripsInbound = tot;
      if (j1 < jB || n > 0) return false;
      this.sfCur = 0;
      return true;
    }
    const ramp = this.rampSF.length >= n;
    const end = jB + n + (ramp ? n : 0);
    const v0 = c0 - jB, v1 = Math.min(end, c0 + coldUnits(TC.fill * 2)) - jB;
    if (v0 < n) {
      const v1c = Math.min(n, v1);
      this.addCachedRange(this.volInbound, v0, v1c);
      this.sfCur = jB + v1c;
    } else {
      const rn = this.rampNew, rs = this.rampSF;
      for (let v = v0 - n, e = v1 - n; v < e; v++) rn[v] += rs[v];
      this.sfCur = jB + v1;
    }
    if (this.sfCur < end) return false;
    this.sfCur = 0;
    return true;
  }

  /** shop / freight, sub-state 0 of a cached cycle: the cached volumes by node ranges (B2 fix round; sfCur) */
  private cachedVolPiece(v: Float32Array): boolean {
    const n = this.road.n, v0 = this.sfCur, v1 = Math.min(n, v0 + coldUnits(TC.fill * 2));
    this.addCachedRange(v, v0, v1);
    if (v1 < n) { this.sfCur = v1; return false; }
    this.sfCur = 0;
    return true;
  }

  /** inboundPiece, sub-state 1 (B2 R10: one small method per piece kind) */
  private inboundPiece1(): boolean {
    if (this.runB.run(pieceUnits(TC.rdNodeB, 1, WARM))) this.sfSub = 2;
    return false;
  }

  /** inboundPiece, sub-state 2 (B2 R10: one small method per piece kind) */
  private inboundPiece2(): boolean {
    const S = this.SB, conns = this.inConns;
    const dist = S.dist, src = S.src, done = S.done;
    this.inDesire = growF32(this.inDesire, this.jB); this.inBestNode = growI32(this.inBestNode, this.jB);
    this.inConnSum = growF64(this.inConnSum, conns.length);
    const desire = this.inDesire.subarray(0, this.jB).fill(0);
    const bestNode = this.inBestNode.subarray(0, this.jB).fill(-1);
    const connSum = this.inConnSum.subarray(0, conns.length).fill(0);
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
    // (the regional workers each connection lets in: placeRegional — the region at large at every connection, a founded
    // neighbour's own workers at the connections facing it)
    this.inScale = growF32(this.inScale, conns.length);
    const scale = this.inScale.subarray(0, conns.length);
    for (let k = 0; k < conns.length; k++) {
      const capW = this.jConnW[conns[k]];
      scale[k] = connSum[k] > capW ? capW / connSum[k] : 1;
    }
    this.sfSub = 3;
    return false;
  }

  /** inboundPiece, sub-state 3 (B2 R10: one small method per piece kind) */
  private inboundPiece3(): boolean {
    const g = this.road;
    const S = this.SB, src = S.src, conns = this.inConns;
    const desire = this.inDesire, bestNode = this.inBestNode, scale = this.inScale;
    const acc = this.acc;
    acc.fill(0, 0, g.n);
    const carPcu = 1 / CAR_OCCUPANCY;
    let tot = 0;
    const cand = this.inCand;
    cand.length = 0;
    this.inConn = growF64(this.inConn, conns.length);
    const connIn = this.inConn.subarray(0, conns.length).fill(0);
    for (let j = 0; j < this.jB; j++) {
      const bn = bestNode[j];
      if (bn < 0) continue;
      const inflow = desire[j] * scale[src[bn]];
      this.jInbound[j] = inflow;
      this.inboundById[this.jBid[j]] = inflow;
      this.jCar[j] += inflow; // regional commuters drive in (parking demand)
      acc[bn] += inflow * carPcu;
      tot += inflow;
      connIn[src[bn]] += inflow;
      if (inflow > 0) cand.push(j);
    }
    this.sfTot = tot;
    this.flowBegin(S, acc, this.volInbound, this.rampSF);
    this.sfSub = 4;
    return false;
  }

  /** inboundPiece, sub-state 4 (B2 R10: one small method per piece kind) */
  private inboundPiece4(): boolean {
    if (this.flowPiece()) this.sfSub = 5;
    return false;
  }

  /** inboundPiece, sub-state default (B2 R10: one small method per piece kind) */
  private inboundPieceEnd(): boolean {
    const g = this.road;
    const S = this.SB, conns = this.inConns, cand = this.inCand, bestNode = this.inBestNode, tot = this.sfTot;
    this.tripsInbound = tot;
    this.connInbound.clear();
    for (let k = 0; k < conns.length; k++) this.connInbound.set(this.jCell[conns[k]], this.inConn[k]);
    // sample inbound routes (connection -> job)
    const K = Math.min(12, cand.length);
    for (let q = 0; q < K; q++) {
      const j = cand[Math.floor(this.rand() * cand.length)];
      const path = this.tracePath(S, bestNode[j], (v) => g.cellOf[v], true);
      if (path.length >= 2) this.pendingRoutes.push({ cells: path, kind: 'car', weight: tot / Math.max(1, K) });
    }
    this.sfSub = 0;
    this.sfCur = 0;
    return true;
  }

  // ------------------------------------------------------------------------------------------ SHOP
  /** add cached per-node volumes into this cycle's volumes (shop / freight skipped this cycle) */
  private addCached(v: Float32Array): void {
    this.addCachedRange(v, 0, this.road.n);
  }

  /** addCached over the nodes [i0, i1) (B2 fix round: the cached pieces by ranges; element-wise, so exact) */
  private addCachedRange(v: Float32Array, i0: number, i1: number): void {
    const volNew = this.volNew;
    for (let i = i0; i < i1; i++) volNew[i] += v[i];
  }

  private shopping(): void {
    this.sfSub = 0;
    this.sfCur = 0;
    while (!this.shopPiece()) { /* next piece */ }
  }

  /** one PH_SHOP piece: cached (one piece), or seeds + start, search chunks, the origins' trips by ranges, the flows */
  private shopPiece(): boolean {
    switch (this.sfSub) {
      case 0: return this.shopPiece0();
      case 1: return this.shopPiece1();
      case 2: return this.shopPiece2();
      default: return this.shopPieceEnd();
    }
  }

  /** shopPiece, sub-state 0 (B2 R10: one small method per piece kind) */
  private shopPiece0(): boolean {
    const g = this.road;
    if (!this.sfRecompute) return this.cachedVolPiece(this.volShop);
    this.volShop = growF32(this.volShop, g.n);
    this.volShop.fill(0, 0, g.n);
    const seeds = this.seeds;
    seeds.clear();
    for (let s = 0; s < this.sN; s++) for (let e = this.sEntS[s], e1 = e + this.sEntC[s]; e < e1; e++) seeds.push(this.ent[e], 0, s);
    if (seeds.n === 0) { this.tripsShop = 0; return true; }
    this.runB.start(g, g.rev, this.nodeTime, this.SB, seeds, 45, this.rampT);
    this.sfSub = 1;
    return false;
  }

  /** shopPiece, sub-state 1 (B2 R10: one small method per piece kind) */
  private shopPiece1(): boolean {
    const g = this.road;
    if (this.runB.run(pieceUnits(TC.rdNodeB, 1, WARM))) { this.sfSub = 2; this.sfCur = 0; this.sfTot = 0; this.acc.fill(0, 0, g.n); }
    return false;
  }

  /** shopPiece, sub-state 2 (B2 R10: one small method per piece kind) */
  private shopPiece2(): boolean {
    const S = this.SB, dist = S.dist, src = S.src, done = S.done, acc = this.acc;
    const pcu = SHOP_PCU_WEIGHT / CAR_OCCUPANCY;
    let tot = this.sfTot;
    const o0 = this.sfCur, o1 = Math.min(this.oN, o0 + coldUnits(TC.shopOrigin));
    for (let o = o0; o < o1; o++) {
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
    this.sfTot = tot;
    this.sfCur = o1;
    if (o1 >= this.oN) { this.flowBegin(S, acc, this.volShop, this.rampSF); this.sfSub = 3; }
    return false;
  }

  /** shopPiece, sub-state default (B2 R10: one small method per piece kind) */
  private shopPieceEnd(): boolean {
    if (!this.flowPiece()) return false;
    this.tripsShop = this.sfTot;
    this.sfSub = 0;
    this.sfCur = 0;
    return true;
  }

  // ------------------------------------------------------------------------------------------ FREIGHT
  private freight(): void {
    this.sfSub = 0;
    this.sfCur = 0;
    while (!this.freightPiece()) { /* next piece */ }
  }

  /**
   * one PH_FREIGHT piece: cached (one piece), or the fills + seeds, the truck times + search start, search chunks, the
   * sources (freightById: one piece), the flows, the trucks per cell (a back raster swapped in: truckVolume), routes
   */
  private freightPiece(): boolean {
    switch (this.sfSub) {
      case 0: return this.freightPiece0();
      case 1: return this.freightPiece1();
      case 2: return this.freightPiece2();
      case 3: return this.freightPiece3();
      case 4: return this.freightPiece4();
      case 5: return this.freightPiece5();
      default: return this.freightPieceEnd();
    }
  }

  /** freightPiece, sub-state 0 (B2 R10: one small method per piece kind) */
  private freightPiece0(): boolean {
    const g = this.road;
    if (!this.sfRecompute) return this.cachedVolPiece(this.volFreight);
    this.volFreight = growF32(this.volFreight, g.n);
    this.volFreight.fill(0, 0, g.n);
    this.sfVersion = g.version;
    this.truckRoutes = [];
    const seeds = this.seeds;
    seeds.clear();
    for (let k = 0; k < this.kN; k++) for (let e = this.kEntS[k], e1 = e + this.kEntC[k]; e < e1; e++) seeds.push(this.ent[e], this.kLabel[k], k);
    if (seeds.n === 0) {
      this.tripsFreight = 0;
      for (let f = 0; f < this.fN; f++) this.freightById[this.fBid[f]] = 0.15;
      return true;
    }
    this.sfSub = 1;
    this.sfCur = 0;
    return false;
  }

  /** freightPiece, sub-state 1 (B2 R10: one small method per piece kind) */
  private freightPiece1(): boolean {
    const g = this.road;
    // (the truck times by node ranges, then the search start in its own piece: sfCur = -1)
    if (this.sfCur < 0) {
      this.runB.start(g, g.rev, this.truckTime, this.SB, this.seeds, 150, this.rampT);
      this.sfSub = 2;
      this.sfCur = 0;
      return false;
    }
    // trucks prefer highways (WP7-10): truck time x TRUCK_LOCAL_FACTOR off highways, congestion-priced ramps
    if (this.sfCur === 0) this.truckTime = growF32(this.truckTime, g.n);
    const tt = this.truckTime, type = g.type, nt = this.nodeTime;
    const v0 = this.sfCur, v1 = Math.min(g.n, v0 + coldUnits(TC.truckTime));
    for (let v = v0; v < v1; v++) tt[v] = type[v] === Network.Highway ? nt[v] : nt[v] * TRUCK_LOCAL_FACTOR;
    this.sfCur = v1 < g.n ? v1 : -1;
    return false;
  }

  /** freightPiece, sub-state 2 (B2 R10: one small method per piece kind) */
  private freightPiece2(): boolean {
    if (this.runB.run(pieceUnits(TC.rdNodeB, 1, WARM))) this.sfSub = 3;
    return false;
  }

  /** freightPiece, sub-state 3 (B2 R10: one small method per piece kind) */
  private freightPiece3(): boolean {
    const g = this.road;
    const S = this.SB, dist = S.dist, done = S.done;
    const acc = this.acc;
    acc.fill(0, 0, g.n);
    let tot = 0;
    const cand = this.frCand, candNode = this.frCandNode;
    cand.length = 0; candNode.length = 0;
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
    this.sfTot = tot;
    this.flowBegin(S, acc, this.volFreight, this.rampSF);
    this.sfSub = 4;
    return false;
  }

  /** freightPiece, sub-state 4 (B2 R10: one small method per piece kind) */
  private freightPiece4(): boolean {
    const g = this.road;
    if (!this.flowPiece()) return false;
    this.tripsFreight = this.sfTot;
    // trucks / day per road cell (Traffic overlay "Trucks", roadCellReport): a back raster, swapped in when complete
    if (this.truckCellB.length !== g.C) this.truckCellB = new Float32Array(g.C);
    this.truckCellB.fill(0);
    this.sfCur = 0;
    this.sfSub = 5;
    return false;
  }

  /** freightPiece, sub-state 5 (B2 R10: one small method per piece kind) */
  private freightPiece5(): boolean {
    const g = this.road;
    const tc = this.truckCellB, vf = this.volFreight, cellOf = g.cellOf;
    const v0 = this.sfCur, v1 = Math.min(g.n, v0 + pieceUnits(TC.truckCell, 1, WARM));
    for (let v = v0; v < v1; v++) { const f = vf[v]; if (f > 0) tc[cellOf[v]] = f / TRUCK_PCU; }
    this.sfCur = v1;
    if (v1 < g.n) return false;
    const t = this.truckCell;
    this.truckCell = this.truckCellB;
    this.truckCellB = t;
    this.hasTruckData = true;
    this.sfSub = 6;
    return false;
  }

  /** freightPiece, sub-state default (B2 R10: one small method per piece kind) */
  private freightPieceEnd(): boolean {
    const g = this.road;
    // sample truck routes weighted by trucks
    const S = this.SB, cand = this.frCand, candNode = this.frCandNode, tot = this.sfTot;
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
    this.sfSub = 0;
    this.sfCur = 0;
    return true;
  }

  // ------------------------------------------------------------------------------------------ FREIGHT SINKS
  /**
   * critic item 18: throughput of a seaport / rail-linked freight station = trucks of all industries within
   * FREIGHT_SINK_MIN (truck time) of it — its own reverse search seeded at that sink only, so neither road neighbour
   * connections nor a second sink nearby shadow it. One sink per 2nd cycle (with the freight pass): sinks without a
   * value first, then round-robin in building order; the others keep their last value.
   */
  private freightSinks(): void {
    this.sfSub = 0;
    this.sfCur = 0;
    while (!this.sinksPiece()) { /* next piece */ }
  }

  /** one PH_SINKS piece: the pick + seeds + search start, search chunks, the sources reached (sinkTrucks: one piece) */
  private sinksPiece(): boolean {
    const g = this.road, seeds = this.seeds;
    switch (this.sfSub) {
      case 0: {
        const K = this.sinkK.length;
        if (K === 0 || this.truckTime.length < g.n) { this.sinksDone = true; return true; }
        // pick: the first sink without a value, else the one after the last searched (round-robin)
        let pick = -1;
        for (let q = 0; q < K; q++) { const id = this.sinkIds[q]; if (!(id < this.sinkTrucksById.length) || this.sinkTrucksById[id] < 0) { pick = q; break; } }
        if (pick < 0) {
          const last = this.sinkIds.indexOf(this.sinkLast);
          pick = last >= 0 ? (last + 1) % K : 0;
        }
        this.sfPick = pick;
        seeds.clear();
        const k = this.sinkK[pick];
        for (let e = this.kEntS[k], e1 = e + this.kEntC[k]; e < e1; e++) seeds.push(this.ent[e], 0, 0);
        this.sfSearched = seeds.n > 0;
        if (this.sfSearched) {
          this.runB.start(g, g.rev, this.truckTime, this.SB, seeds, FREIGHT_SINK_MIN, this.rampT);
          this.sfSub = 1;
        } else this.sfSub = 2;
        return false;
      }
      case 1: {
        if (this.runB.run(pieceUnits(TC.rdNodeB, 1, WARM))) this.sfSub = 2;
        return false;
      }
      default: {
        let tot = 0;
        if (this.sfSearched) {
          const S = this.SB, done = S.done;
          for (let f = 0; f < this.fN; f++) {
            for (let e = this.fEntS[f], e1 = e + this.fEntC[f]; e < e1; e++) if (done[this.ent[e]] === 1) { tot += this.fTrucks[f]; break; }
          }
          S.settled = 0; // scratch
        }
        const id = this.sinkIds[this.sfPick];
        if (id < this.sinkTrucksById.length) this.sinkTrucksById[id] = tot;
        this.sinkLast = id;
        this.sinksDone = true;
        this.sfSub = 0;
        this.sfCur = 0;
        return true;
      }
    }
  }

  // ------------------------------------------------------------------------------------------ PARKING (WP7-7)
  /** parking raster from this cycle's car arrivals (job sites, shops) vs supply (zones, streets, civic lots, garages) */
  private parkingRaster(sim: Simulation): void {
    this.pkSub = 0;
    while (!this.parkingPiece(sim)) { /* next piece */ }
  }

  /**
   * one PH_PARKING piece; true when done. The demand footprints by job-site / shop ranges and the box filters work on a
   * back set of the arrays garageInfo's relief reads (parkD, parkBoxD, parkBoxS, garageFree): K1 demand, K2 base supply
   * by rows, K3 the plain garages' supply, K4 box(D) (rows, then the vertical pass resumed by rows), K5 the park & ride
   * reserves (box of the supply without them, then the reserve loop), K6 box(S), K7 the blend into a back raster by
   * cell ranges (the summary's sums in fields), K8 PUBLISH: st.parking, the back set swapped in, the summary, the event.
   * The same operations in the same order as the pre-B2 parkingRaster.
   */
  private parkingPiece(sim: Simulation): boolean {
    switch (this.pkSub) {
      case 0: return this.parkingPiece0(sim);
      case 1: return this.parkingPiece1(sim);
      case 2: return this.parkingPiece2(sim);
      case 3: return this.parkingPiece3(sim);
      case 4: return this.parkingPiece4(sim);
      case 5: return this.parkingPiece5(sim);
      case 6: return this.parkingPiece6(sim);
      case 7: return this.parkingPiece7(sim);
      case 8: return this.parkingPiece8(sim);
      default: return this.parkingPieceEnd(sim);
    }
  }

  /** parkingPiece, sub-state 0 (B2 R10: one small method per piece kind) */
  private parkingPiece0(sim: Simulation): boolean {
    const st = sim.state, N = st.size, C = st.cells;
    if (this.parkD.length !== C) {
      this.parkD = new Float32Array(C); this.parkS = new Float32Array(C);
      this.parkTmpA = new Float32Array(C); this.parkTmpB = new Float32Array(C);
      this.parkBoxD = new Float32Array(C); this.parkBoxS = new Float32Array(C);
    }
    if (this.parkDB.length !== C) { this.parkDB = new Float32Array(C); this.parkBoxDB = new Float32Array(C); this.parkBoxSB = new Float32Array(C); }
    this.parkDB.fill(0);
    this.pkCur = 0;
    this.pkSub = 1;
    return false;
  }

  /** parkingPiece, sub-state 1 (B2 R10: one small method per piece kind) */
  private parkingPiece1(sim: Simulation): boolean {
    const st = sim.state, N = st.size, C = st.cells;
    // demand: job sites, then shops
    const D = this.parkDB, inv = 1 / CAR_OCCUPANCY, jB = this.jB, sN = this.sN;
    const u0 = this.pkCur, u1 = Math.min(jB + sN, u0 + coldUnits(TC.parkDemand));
    for (let u = u0; u < u1; u++) {
      if (u < jB) { const b = this.jObj[u]; if (b) addFootprint(N, b, this.jCar[u] * inv, D); }
      else { const s = u - jB, b = this.sObj[s]; if (b) addFootprint(N, b, PARKING_SHOP_W * this.sCar[s] * inv, D); }
    }
    this.pkCur = u1;
    if (u1 >= jB + sN) { this.pkSub = 2; this.pkCur = 0; }
    return false;
  }

  /** parkingPiece, sub-state 2 (B2 R10: one small method per piece kind) */
  private parkingPiece2(sim: Simulation): boolean {
    const st = sim.state, N = st.size, C = st.cells;
    const i0 = this.pkCur, i1 = Math.min(C, i0 + coldUnits(TC.parkSupply));
    baseSupplyRange(st, this.parkS, i0, i1);
    this.pkCur = i1;
    if (i1 >= C) this.pkSub = 3;
    return false;
  }

  /** parkingPiece, sub-state 3 (B2 R10: one small method per piece kind) */
  private parkingPiece3(sim: Simulation): boolean {
    const st = sim.state, N = st.size, C = st.cells;
    // garages: their free spaces ease the blocks around them; one without a road beside it gives none (drivers can't
    // reach it — what its report says). Parking-only garages (no park & ride) free all their spaces. Every park & ride
    // garage keeps spaces for the businesses around it: spaces x min(1, the pressure they feel without the park & ride
    // garages / PR_RESERVE_FULL), at most PR_RESERVE_SPREAD x the cars they lack (garageShortage: a small strip of shops
    // does not take a whole garage; PR_RESERVE_SMOOTH-blended, persisted: park & ride gets spaces - reserve from the
    // next assignment on — local parkers first), and frees its spaces minus this assignment's park & ride cars
    const S = this.parkS, prB = this.pkPrB, prQ = this.pkPrQ;
    prB.length = 0; prQ.length = 0;
    this.garageFreeB.clear();
    for (let q = 0; q < this.gN; q++) {
      const id = this.gBid[q], pr = this.gState[q] === GARAGE_PR;
      if (!pr) this.garageReserve.delete(id);
      if (this.gState[q] === GARAGE_NO_ROAD) continue;
      const b = st.buildings.get(id);
      if (!b) continue;
      if (pr) { prB.push(b); prQ.push(q); continue; }
      addGarageSupply(N, b, this.gSpaces[q], S);
      this.garageFreeB.set(id, this.gSpaces[q]);
    }
    this.boxBegin(this.parkDB, this.parkBoxDB);
    this.pkSub = 4;
    return false;
  }

  /** parkingPiece, sub-state 4 (B2 R10: one small method per piece kind) */
  private parkingPiece4(sim: Simulation): boolean {
    const st = sim.state, N = st.size, C = st.cells;
    if (!this.boxPiece(N)) return false;
    if (this.pkPrB.length > 0) { this.boxBegin(this.parkS, this.parkTmpB); this.pkSub = 5; }
    else { this.boxBegin(this.parkS, this.parkBoxSB); this.pkSub = 7; }
    return false;
  }

  /** parkingPiece, sub-state 5 (B2 R10: one small method per piece kind) */
  private parkingPiece5(sim: Simulation): boolean {
    const st = sim.state, N = st.size, C = st.cells;
    if (this.boxPiece(N)) this.pkSub = 6;
    return false;
  }

  /** parkingPiece, sub-state 6 (B2 R10: one small method per piece kind) */
  private parkingPiece6(sim: Simulation): boolean {
    const st = sim.state, N = st.size, C = st.cells;
    const D = this.parkDB, S = this.parkS, prB = this.pkPrB, prQ = this.pkPrQ;
    for (let k = 0; k < prB.length; k++) {
      const q = prQ[k], id = this.gBid[q], spaces = this.gSpaces[q];
      const sh = garageShortage(N, prB[k], D, this.parkBoxDB, this.parkTmpB);
      const raw = Math.min(spaces * Math.min(1, sh.p / PR_RESERVE_FULL), PR_RESERVE_SPREAD * sh.unmet);
      const old = this.garageReserve.get(id);
      const res = old === undefined ? raw : old + PR_RESERVE_SMOOTH * (raw - old);
      if (res >= 0.5) this.garageReserve.set(id, res); else this.garageReserve.delete(id);
      const free = spaces - Math.min(spaces, this.gCars[q]);
      addGarageSupply(N, prB[k], free, S);
      this.garageFreeB.set(id, free);
    }
    this.boxBegin(this.parkS, this.parkBoxSB);
    this.pkSub = 7;
    return false;
  }

  /** parkingPiece, sub-state 7 (B2 R10: one small method per piece kind) */
  private parkingPiece7(sim: Simulation): boolean {
    const st = sim.state, N = st.size, C = st.cells;
    if (!this.boxPiece(N)) return false;
    // blended with the previous raster (one assignment's arrivals are noisy); a fresh city / old save starts unblended
    if (this.parkHas) {
      if (this.parkPrev.length !== C) this.parkPrev = new Float32Array(C);
      this.parkPrev.set(st.parking);
    }
    if (this.parkNext.length !== C) this.parkNext = new Float32Array(C);
    const a = this.pkSums;
    a.wSum = 0; a.pSum = 0; a.dCells = 0; a.high = 0; a.sTot = 0; a.dTot = 0;
    this.pkCur = 0;
    this.pkSub = 8;
    return false;
  }

  /** parkingPiece, sub-state 8 (B2 R10: one small method per piece kind) */
  private parkingPiece8(sim: Simulation): boolean {
    const st = sim.state, N = st.size, C = st.cells;
    const prev = this.parkHas ? this.parkPrev : null;
    const i0 = this.pkCur, i1 = Math.min(C, i0 + coldUnits(TC.parkBlend));
    parkingFromBoxesRange(N, this.parkDB, this.parkS, this.parkBoxDB, this.parkBoxSB, this.parkNext, prev, PARKING_BLEND, i0, i1, this.pkSums);
    this.pkCur = i1;
    if (i1 >= C) this.pkSub = 9;
    return false;
  }

  /** parkingPiece, sub-state default (B2 R10: one small method per piece kind) */
  private parkingPieceEnd(sim: Simulation): boolean {
    const st = sim.state, N = st.size, C = st.cells;
    st.parking.set(this.parkNext);
    let t = this.parkD; this.parkD = this.parkDB; this.parkDB = t;
    t = this.parkBoxD; this.parkBoxD = this.parkBoxDB; this.parkBoxDB = t;
    t = this.parkBoxS; this.parkBoxS = this.parkBoxSB; this.parkBoxSB = t;
    const m = this.garageFree; this.garageFree = this.garageFreeB; this.garageFreeB = m;
    this.parkingSummary = parkingSummaryOf(this.pkSums);
    this.parkHas = true;
    this.pkSub = 0;
    this.pkCur = 0;
    sim.events.emit('layerUpdated', 'parking');
    return true;
  }

  /** parkingBox(N, src, dst, parkTmpA) in pieces: boxH by row ranges, then boxV resumed by rows (BoxVRun) */
  private boxBegin(src: Float32Array, dst: Float32Array): void {
    this.bxSrc = src;
    this.bxDst = dst;
    this.bxStage = 0;
    this.bxRow = 0;
  }

  private boxPiece(N: number): boolean {
    const rows = Math.max(1, Math.floor(coldUnits(TC.parkBox) / Math.max(1, N)));
    if (this.bxStage === 0) {
      const z0 = this.bxRow, z1 = Math.min(N, z0 + rows);
      boxHRows(this.bxSrc, this.parkTmpA, N, PARKING_BOX_R, z0, z1);
      this.bxRow = z1;
      if (z1 < N) return false;
      this.boxV.begin(this.parkTmpA, this.bxDst, N, PARKING_BOX_R);
      this.bxStage = 1;
      return false;
    }
    return this.boxV.run(rows);
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
    this.hubModes.clear();
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
      const inf = infoOf(st, b), t = inf.transit;
      if (t === Transit.None) continue;
      if (!isFunctional(b)) { if (isStopMode(t)) this.attach.set(b.id, 0); continue; }
      if (t === Transit.Hub) {
        this.attach.set(b.id, 0);
        this.hubModes.set(b.id, 0);
        if ((inf.usesPower && (b.flags & BF.Powered) === 0) || (inf.usesWater && (b.flags & BF.Watered) === 0)) continue;
        bus.push(b); subs.push(b); trains.push(b);
      } else if (t === Transit.Bus) bus.push(b);
      else if (t === Transit.Subway) subs.push(b);
      else if (t === Transit.Train) trains.push(b);
      else if (t === Transit.Freight) freights.push(b);
      else if (t === Transit.Seaport) ports.push(b);
      else if (t === Transit.Ferry) ferries.push(b);
    }
    const attachMode = (b: Building, mode: Transit, ok: boolean) => {
      if (this.hubModes.has(b.id)) {
        if (ok) { this.hubModes.set(b.id, this.hubModes.get(b.id)! | (1 << mode)); this.attach.set(b.id, 1); }
      } else this.attach.set(b.id, ok ? 1 : 0);
    };
    const isRoad = (i: number) => net[i] >= Network.Street && net[i] <= Network.Highway;
    for (const b of bus) attachMode(b, Transit.Bus, touches(N, b, isRoad, false) >= 0);
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
        attachMode(b, Transit.Subway, n >= 2);
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
        attachMode(b, Transit.Train, n >= 2 || edge);
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

  /** the transport save of the assignment (whole state: the precompute pieces + the assembly) */
  private saveTransport(st: CityState): void {
    this.f2Sub = 6;
    this.f2Cur = 0;
    while (this.f2Sub < 9) this.savePrecomputePiece(st);
    this.saveAssemble(st);
  }

  /**
   * the save precompute in pieces (GS1, before the assembly): the ramp cells by road-node ranges, the parking raster
   * quantised into a NEW buffer by cell ranges on the cycles that recompute it (R4 b: pre-B2 re-quantised the previous
   * save's array in place — the live save would hold the new raster before its new transport state), the sinks and the
   * job-matching prices; f2Sub 6 -> 9
   */
  private savePrecomputePiece(st: CityState): void {
    const g = this.road;
    switch (this.f2Sub) {
      case 6: {
        if (this.f2Cur === 0) { this.svRc = []; this.svRv = []; }
        // ramp flows live on road cells only: scan the road nodes, not the map
        const rc = this.svRc, rv = this.svRv, rvc = this.rampVolCell;
        if (g.N === st.size) {
          const v0 = this.f2Cur, v1 = Math.min(g.n, v0 + coldUnits(TC.saveRamp));
          for (let v = v0; v < v1; v++) { const c = g.cellOf[v]; if (rvc[c] > 0.5) { rc.push(c); rv.push(rvc[c]); } }
          this.f2Cur = v1;
          if (v1 < g.n) return;
        }
        const prev = st.systemData.infraTransport as TransportSave | undefined;
        const pq = prev?.parkingQ;
        // the parking raster changes on the cycles that recompute it (every 2nd): re-quantise then only
        this.svPq = !(pq instanceof Uint8Array) || pq.length !== st.cells || this.sfRecompute ? new Uint8Array(st.cells) : null;
        this.f2Sub = 7;
        this.f2Cur = 0;
        return;
      }
      case 7: {
        const pq = this.svPq;
        if (pq) {
          const P = st.parking, C = st.cells;
          const i0 = this.f2Cur, i1 = Math.min(C, i0 + coldUnits(TC.saveParking));
          for (let i = i0; i < i1; i++) pq[i] = Math.round(Math.max(0, Math.min(1, P[i])) * 255);
          this.f2Cur = i1;
          if (i1 < C) return;
        }
        this.f2Sub = 8;
        return;
      }
      default: {
        const f = Math.fround;
        const sinks: [number, number][] = [];
        for (const id of this.sinkIds) if (id < this.sinkTrucksById.length && this.sinkTrucksById[id] >= 0) sinks.push([id, f(this.sinkTrucksById[id])]);
        this.svSinks = sinks;
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
        this.svJobIds = jobIds; this.svJobPrice = jobPrice; this.svConnCells = connCells; this.svConnPrice = connPrice;
        this.f2Sub = 9;
        return;
      }
    }
  }

  /** the transport save assembled from the precompute (the cycle's last write: one piece, R4) */
  private saveAssemble(st: CityState): void {
    this.svSave = this.saveBuild(st);
    this.saveInstall(st);
  }

  /** the transport save object of the assignment (private until saveInstall; the precompute pieces filled sv*) */
  private saveBuild(st: CityState): TransportSave {
    const f = Math.fround;
    const prev = st.systemData.infraTransport as TransportSave | undefined;
    const pq = this.svPq ?? (prev?.parkingQ as Uint8Array);
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
      sinkTrucks: this.svSinks,
      sinkLast: this.sinkLast,
      rampCells: Int32Array.from(this.svRc),
      rampVol: Float32Array.from(this.svRv),
      parkingQ: pq,
      jobIds: this.svJobIds, jobPrice: this.svJobPrice, connCells: this.svConnCells, connPrice: this.svConnPrice,
      rng: this.rngState,
      cycles: this.cycles,
      iter: this.iter,
    };
    this.svPq = null;
    this.svRc = this.svRv = EMPTY_NUMS;
    this.svSinks = [];
    return save;
  }

  /** install the built transport save: the cycle's last write (R9); the RNG state, cycle count and MSA iteration are
   *  taken now, as pre-B2 took them in the same step */
  private saveInstall(st: CityState): void {
    const save = this.svSave!;
    save.rng = this.rngState;
    save.cycles = this.cycles;
    save.iter = this.iter;
    st.systemData.infraTransport = save;
    this.svSave = null;
  }

  // ------------------------------------------------------------------------------------------ FINAL
  private finalize(sim: Simulation): void {
    this.fiSub = 0;
    while (!this.finalPiece(sim)) { /* next piece */ }
  }

  /**
   * one PH_FINAL piece (B2 §3 "Final", review R1); true when done. F1: alpha, iter++ and the ramp alpha (1 / the
   * incremented iter) exactly where pre-B2 computed them, then the road blend, the rail blend (both from the old
   * st.traffic) and the ramp MSA (into a copy of rampVolCell) by node ranges; F2 the traffic / congestion values and the
   * rail riders into back rasters (sums as doubles in fields), the subway riders into a back raster; F4 the smoothed
   * stop loads and the stop reports into back maps by stop ranges; then ONE publish piece: st.traffic / st.congestion
   * (.set: saved, the MSA state a load continues), rampVolCell, subwayRiders and the six stop maps swapped in, and the
   * stats (also saved) — everything pre-B2's finalize changed in one step, changed in one piece.
   */
  private finalPiece(sim: Simulation): boolean {
    if (this.fiSub === 0) {
      // MSA blend with previous volumes (per cell)
      this.fiAlpha = Math.max(MSA_MIN_ALPHA, 1 / (this.iter + 1));
      this.iter++;
      // (interchange flows: the floor RAMP_MSA_MIN, 1 / the iteration after the increment — as pre-B2)
      this.fiRa = Math.max(RAMP_MSA_MIN, 1 / this.iter);
      this.fiCur = 0;
      this.fiSub = 1;
    }
    switch (this.fiSub) {
      case 1: return this.finalPiece1(sim);
      case 2: return this.finalPiece2(sim);
      case 3: return this.finalPiece3(sim);
      case 4: return this.finalPiece4(sim);
      case 5: return this.finalPiece5(sim);
      case 6: return this.finalPiece6(sim);
      default: return this.finalPieceEnd(sim);
    }
  }

  /** finalPiece, sub-state 1 (B2 R10: one small method per piece kind) */
  private finalPiece1(sim: Simulation): boolean {
    const st = sim.state;
    const g = this.road;
    const n = g.n;
    const traffic = st.traffic;
    const alpha = this.fiAlpha, blended = this.acc, cellOf = g.cellOf, volNew = this.volNew; // (acc reused)
    const v0 = this.fiCur, v1 = Math.min(n, v0 + coldUnits(TC.finBlend));
    for (let v = v0; v < v1; v++) {
      const c = cellOf[v];
      blended[v] = traffic[c] * (1 - alpha) + volNew[v] * alpha;
    }
    this.fiCur = v1;
    if (v1 >= n) { this.fiSub = 2; this.fiCur = 0; }
    return false;
  }

  /** finalPiece, sub-state 2 (B2 R10: one small method per piece kind) */
  private finalPiece2(sim: Simulation): boolean {
    const st = sim.state;
    const traffic = st.traffic;
    const alpha = this.fiAlpha, railN = this.rail.n, rcell = this.rail.cellOf, railNew = this.railNew;
    const v0 = this.fiCur, v1 = Math.min(railN, v0 + coldUnits(TC.finBlend));
    for (let v = v0; v < v1; v++) railNew[v] = traffic[rcell[v]] * (1 - alpha) + railNew[v] * alpha;
    this.fiCur = v1;
    if (v1 >= railN) {
      // interchange (ramp) flows: MSA per cell like the volumes (WP7-10), with a lower floor (RAMP_MSA_MIN): each
      // commuter picks one ramp, so two interchanges would otherwise trade the load every cycle (into a copy:
      // rampLoad / the save read rampVolCell, published below)
      if (this.rampVolB.length !== this.rampVolCell.length) this.rampVolB = new Float32Array(this.rampVolCell.length);
      this.rampVolB.set(this.rampVolCell);
      this.fiSub = 3;
      this.fiCur = 0;
    }
    return false;
  }

  /** finalPiece, sub-state 3 (B2 R10: one small method per piece kind) */
  private finalPiece3(sim: Simulation): boolean {
    const st = sim.state;
    const g = this.road;
    const n = g.n;
    const C = st.cells;
    const rv = this.rampVolB, rn = this.rampNew, cellOf = g.cellOf, type = g.type, ra = this.fiRa;
    const v0 = this.fiCur, v1 = Math.min(n, v0 + coldUnits(TC.finRamp));
    for (let v = v0; v < v1; v++) {
      if (type[v] === Network.Highway) continue;
      const c = cellOf[v];
      const x = rv[c] * (1 - ra) + rn[v] * ra;
      rv[c] = x > 1e-3 ? x : 0;
    }
    this.fiCur = v1;
    if (v1 < n) return false;
    if (this.trafficB.length !== C) { this.trafficB = new Float32Array(C); this.congestionB = new Float32Array(C); }
    this.trafficB.fill(0);
    this.congestionB.fill(0);
    this.fiCongSum = 0;
    this.fiCongN = 0;
    this.fiSub = 4;
    this.fiCur = 0;
    return false;
  }

  /** finalPiece, sub-state 4 (B2 R10: one small method per piece kind) */
  private finalPiece4(sim: Simulation): boolean {
    const st = sim.state;
    const g = this.road;
    const n = g.n;
    const net = st.network;
    const blended = this.acc, cellOf = g.cellOf, cap = g.cap, tB = this.trafficB, cB = this.congestionB;
    let congSum = this.fiCongSum, congN = this.fiCongN;
    const v0 = this.fiCur, v1 = Math.min(n, v0 + coldUnits(TC.finWrite));
    for (let v = v0; v < v1; v++) {
      const c = cellOf[v];
      if (!(net[c] >= Network.Street && net[c] <= Network.Highway)) continue;
      const vol = blended[v];
      tB[c] = vol;
      const r = vol / cap[v];
      cB[c] = r;
      if (vol > 1) { congSum += r > 1 ? 1 : r; congN++; }
    }
    this.fiCongSum = congSum;
    this.fiCongN = congN;
    this.fiCur = v1;
    if (v1 >= n) { this.fiSub = 5; this.fiCur = 0; }
    return false;
  }

  /** finalPiece, sub-state 5 (B2 R10: one small method per piece kind) */
  private finalPiece5(sim: Simulation): boolean {
    const st = sim.state;
    const C = st.cells;
    const net = st.network;
    // rail riders
    const tB = this.trafficB, cB = this.congestionB, railNew = this.railNew, rcell = this.rail.cellOf, railN = this.rail.n;
    const v0 = this.fiCur, v1 = Math.min(railN, v0 + coldUnits(TC.finWrite));
    for (let v = v0; v < v1; v++) {
      const c = rcell[v];
      if (net[c] !== Network.Rail) continue;
      tB[c] = railNew[v];
      cB[c] = tB[c] / NET_CAPACITY[Network.Rail];
    }
    this.fiCur = v1;
    if (v1 < railN) return false;
    if (this.subwayRidersB.length !== C) this.subwayRidersB = new Float32Array(C);
    const sr = this.subwayRidersB;
    sr.fill(0);
    for (let v = 0; v < this.subway.n; v++) sr[this.subway.cellOf[v]] = this.subNew[v];
    // stop loads for crowding / bus need: smoothed across assignments (STOP_LOAD_SMOOTH; a new stop starts at its
    // load) — the next assignment's crowding wait reads them, and an undamped load would alternate full / empty;
    // walkers and whether a path from the stop rides (reports, garage preview) of this assignment (back maps)
    this.stLoadPrevB.clear(); this.stPrPrevB.clear();
    this.stopWalkersB.clear(); this.stopNearB.clear(); this.stopRideB.clear(); this.stopReachB.clear();
    this.fiSub = 6;
    this.fiCur = 0;
    return false;
  }

  /** finalPiece, sub-state 6 (B2 R10: one small method per piece kind) */
  private finalPiece6(sim: Simulation): boolean {
    const old = this.stLoadPrev, oldPr = this.stPrPrev, next = this.stLoadPrevB, nextPr = this.stPrPrevB;
    const doneT = this.ST.done;
    const sN = this.stops.n, hasN = this.stNearW.length > sN;
    const s0 = this.fiCur, s1 = Math.min(sN, s0 + coldUnits(TC.finStop));
    for (let s = s0; s < s1; s++) {
      const bid = this.stops.bid[s];
      const key = bid >= 0 ? bid : -1 - this.stops.cell[s];
      const o = old.get(key);
      next.set(key, o === undefined ? this.stLoad[s] : o + STOP_LOAD_SMOOTH * (this.stLoad[s] - o));
      const op = oldPr.get(key), np = op === undefined ? this.stPr[s] : op + STOP_LOAD_SMOOTH * (this.stPr[s] - op);
      if (np > 0.5) nextPr.set(key, np);
      if (bid < 0) continue;
      if (this.stWalk[s] > 0) this.stopWalkersB.set(bid, this.stWalk[s]);
      if (hasN && (this.stNearW[s] > 0 || this.stElseW[s] > 0)) {
        const bw = this.stBoardW[s];
        this.stopNearB.set(bid, { near: this.stNearW[s], board: bw, boardMin: bw > 0 ? this.stBoardT[s] / bw : 0, other: this.stElseW[s] });
      }
      let ride = false, reach = false;
      for (let a = this.stAttS[s], a1 = a + this.stAttC[s]; a < a1 && !ride; a++) {
        const v = this.stAtt[a];
        if (doneT[v] !== 1) continue;
        reach = true;
        if (this.rides(v)) ride = true;
      }
      this.stopRideB.set(bid, ride);
      this.stopReachB.set(bid, reach);
    }
    this.fiCur = s1;
    if (s1 >= sN) this.fiSub = 7;
    return false;
  }

  /** finalPiece, sub-state default (B2 R10: one small method per piece kind) */
  private finalPieceEnd(sim: Simulation): boolean {
    const st = sim.state;
    const traffic = st.traffic;
    // publish
    traffic.set(this.trafficB);
    st.congestion.set(this.congestionB);
    let t = this.rampVolCell; this.rampVolCell = this.rampVolB; this.rampVolB = t;
    t = this.subwayRiders; this.subwayRiders = this.subwayRidersB; this.subwayRidersB = t;
    let m: Map<number, number> = this.stLoadPrev; this.stLoadPrev = this.stLoadPrevB; this.stLoadPrevB = m;
    m = this.stPrPrev; this.stPrPrev = this.stPrPrevB; this.stPrPrevB = m;
    m = this.stopWalkers; this.stopWalkers = this.stopWalkersB; this.stopWalkersB = m;
    const nb = this.stopNear; this.stopNear = this.stopNearB; this.stopNearB = nb;
    let mb = this.stopRide; this.stopRide = this.stopRideB; this.stopRideB = mb;
    mb = this.stopReach; this.stopReach = this.stopReachB; this.stopReachB = mb;
    this.finalStats(st);
    this.fiSub = 0;
    this.fiCur = 0;
    return true;
  }

  /** finalize's stats (published with the layers) */
  private finalStats(st: CityState): void {
    const stats = st.stats;
    stats.tripsCar = Math.round(this.tripsCar);
    stats.tripsTransit = Math.round(this.tripsTransit);
    stats.tripsWalk = Math.round(this.tripsWalk);
    stats.avgCommute = this.commuteW > 0 ? this.commuteSum / this.commuteW : 0;
    {
      const r1 = (v: number) => Math.round(v * 10) / 10, bm = this.byMode;
      stats.commuteByMode = { car: r1(bm.car), transit: r1(bm.transit), walk: r1(bm.walk), transitSaved: r1(bm.transitSaved) };
    }
    stats.avgTraffic = this.fiCongN > 0 ? this.fiCongSum / this.fiCongN : 0;
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

  /** per-building outputs, flags, commute layer, sample routes (whole state) */
  private finalize2(sim: Simulation): void {
    this.f2Sub = 0;
    while (!this.final2Piece(sim)) { /* next piece */ }
  }

  /**
   * one PH_FINAL2 piece (B2 §3 "Final2"); true when done. G0 the per-id arrays it writes copied into back buffers (one
   * builtin copy each); G1 origins by ranges — smoothing reads the front and writes the back (each id is written once
   * per cycle: origins and job sites are disjoint buildings), the commute footprint into a back raster, the buildings
   * whose NoJobs / Congested flag flips listed with their new bits; GJ the job sites likewise; customers + the
   * connection report; GP PUBLISH: the per-id buffers, st.commute, cutIds and connLast swapped in, the flags applied in
   * the pre-B2 order (origins, then job sites: the same `changed` list), then their buildingChanged events in the same
   * piece (only for buildings still in the city — interrupted mode; a flag must never be visible between pieces without
   * its event, or the worker's replica (W1.1, EXACT_FIELDS) would miss it at a packet boundary); GS1 the save precompute; GR the sample routes; GS2 cycles++
   * and the transport save (the cycle's last write).
   */
  private final2Piece(sim: Simulation): boolean {
    switch (this.f2Sub) {
      case 0: return this.final2Piece0(sim);
      case 1: return this.final2Piece1(sim);
      case 2: return this.final2Piece2(sim);
      case 3: return this.final2Piece3(sim);
      case 4: return this.final2Piece4(sim);
      case 6: case 7: case 8: return this.final2Piece6(sim);
      case 9: return this.final2Piece9(sim);
      case 10: return this.final2Piece10(sim);
      case 11: return this.final2Piece11(sim);
      default: return this.final2PieceEnd(sim);
    }
  }

  /** final2Piece, sub-state 0 (B2 R10: one small method per piece kind) */
  private final2Piece0(sim: Simulation): boolean {
    const st = sim.state;
    const C = st.cells;
    if (this.commuteB.length !== C) this.commuteB = new Float32Array(C);
    this.commuteB.fill(0);
    this.cutIdsB.clear();
    const cp = (a: Float32Array<ArrayBuffer>, b: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> => {
      if (b.length !== a.length) b = new Float32Array(a.length);
      b.set(a);
      return b;
    };
    this.accessB = cp(this.accessById, this.accessB);
    this.commuteIdB = cp(this.commuteById, this.commuteIdB);
    this.reachedB = cp(this.reachedById, this.reachedB);
    this.carlessB = cp(this.carlessById, this.carlessB);
    this.carlessMinB = cp(this.carlessMinById, this.carlessMinB);
    this.jobFillB = cp(this.jobFillById, this.jobFillB);
    this.carsB = cp(this.carsById, this.carsB);
    if (this.sfRecompute) this.customersB = cp(this.customersById, this.customersB);
    if (this.modeB.length !== this.modeById.length) this.modeB = new Uint8Array(this.modeById.length);
    this.modeB.set(this.modeById);
    this.f2OFlag.length = 0;
    this.f2JFlag.length = 0;
    this.f2Cur = 0;
    this.f2Sub = 1;
    return false;
  }

  /** final2Piece, sub-state 1 (B2 R10: one small method per piece kind) */
  private final2Piece1(sim: Simulation): boolean {
    const st = sim.state;
    const g = this.road;
    const n = g.n, N = st.size, congestion = st.congestion, commute = this.commuteB;
    const accessB = this.accessB, commuteB = this.commuteIdB, reachedB = this.reachedB, carlessB = this.carlessB, carlessMinB = this.carlessMinB, modeB = this.modeB;
    const o0 = this.f2Cur, o1 = Math.min(this.oN, o0 + coldUnits(TC.f2Origin));
    for (let o = o0; o < o1; o++) {
      const bid = this.oBid[o];
      const b = st.buildings.get(bid);
      if (!b) continue;
      // smooth per-building outputs across assignments (destination noise varies per cycle)
      const prevA = this.accessById[bid];
      const emp = prevA >= 0 && this.cycles > 0 ? prevA + (this.oEmp[o] - prevA) * RESULT_SMOOTH : this.oEmp[o];
      const prevT = this.commuteById[bid];
      const t = prevT > 0 && this.oTime[o] > 0 ? prevT + (this.oTime[o] - prevT) * RESULT_SMOOTH : this.oTime[o];
      accessB[bid] = emp;
      commuteB[bid] = t;
      reachedB[bid] = this.oW[o] * emp;
      // car-less workers: share and their mean extra minutes (taxi / lift) vs car owners (routeInfo, WP5's inspector)
      {
        const cl = this.oCl[o], a = this.oAsg[o];
        const x = a > 0 && cl > 0 ? Math.max(0, this.oClX[o] / (a * cl)) : 0;
        const px = this.carlessMinById[bid];
        carlessB[bid] = cl;
        carlessMinB[bid] = px > 0 && this.cycles > 0 ? px + (x - px) * RESULT_SMOOTH : x;
      }
      const sc = this.oShC[o], stt = this.oShT[o], sw = this.oShW[o];
      modeB[bid] = sc + stt + sw <= 0 ? 0 : sc >= stt && sc >= sw ? 1 : stt >= sw ? 2 : 3;
      // (routed 43: no road to the city's jobs — no commute, routeInfo says so)
      if (o < this.oCut.length && this.oCut[o] === 1) { this.cutIdsB.add(bid); modeB[bid] = 0; }
      for (let z: number = b.z; z < b.z + b.d; z++) for (let x: number = b.x; x < b.x + b.w; x++) {
        const i = z * N + x;
        if (st.building[i] === bid) commute[i] = t;
      }
      const noJobs = b.pop > 0 && emp < 0.35;
      const cn = this.oCarNode[o];
      const cong = (cn >= 0 && cn < n ? congestion[g.cellOf[cn]] : 0) > 1;
      // (the flags flip in the publish piece: listed here with their new bits)
      if (((b.flags & BF.NoJobs) !== 0) !== noJobs || ((b.flags & BF.Congested) !== 0) !== cong) this.f2OFlag.push(o, (noJobs ? 1 : 0) | (cong ? 2 : 0));
    }
    this.f2Cur = o1;
    if (o1 >= this.oN) { this.f2Sub = 2; this.f2Cur = 0; }
    return false;
  }

  /** final2Piece, sub-state 2 (B2 R10: one small method per piece kind) */
  private final2Piece2(sim: Simulation): boolean {
    const st = sim.state;
    const g = this.road;
    const congestion = st.congestion, jobFillB = this.jobFillB, reachedB = this.reachedB, carsB = this.carsB, commuteB = this.commuteIdB, modeB = this.modeB;
    const j0 = this.f2Cur, j1 = Math.min(this.jB, j0 + coldUnits(TC.f2Site));
    for (let j = j0; j < j1; j++) {
      const bid = this.jBid[j];
      const b = st.buildings.get(bid);
      if (!b) continue;
      const slots = this.jSlots[j];
      const local = Math.min(this.jAsg[j], slots);
      const arriving = local + this.jInbound[j];
      const fill = Math.min(1, arriving / Math.max(1, slots));
      const prevF = this.jobFillById[bid];
      jobFillB[bid] = prevF >= 0 && this.cycles > 0 ? prevF + (fill - prevF) * RESULT_SMOOTH : fill;
      reachedB[bid] = arriving;
      carsB[bid] = this.jCar[j];
      commuteB[bid] = this.jAsg[j] > 0 ? this.jTimeSum[j] / this.jAsg[j] : this.jInbound[j] > 0 ? REGIONAL_TIME + 10 : 0;
      modeB[bid] = arriving > 0 ? 1 : 0;
      let cong = 0;
      for (let e = this.jEntS[j], e1 = e + this.jEntC[j]; e < e1; e++) {
        const c = congestion[g.cellOf[this.ent[e]]];
        if (c > cong) cong = c;
      }
      if (((b.flags & BF.Congested) !== 0) !== (cong > 1.1)) this.f2JFlag.push(j, cong > 1.1 ? 2 : 0);
    }
    this.f2Cur = j1;
    if (j1 >= this.jB) this.f2Sub = 3;
    return false;
  }

  /** final2Piece, sub-state 3 (B2 R10: one small method per piece kind) */
  private final2Piece3(sim: Simulation): boolean {
    if (this.sfRecompute) for (let s = 0; s < this.sN; s++) this.customersB[this.sBid[s]] = this.sLoad[s];
    // (the neighbour connections of this assignment: connectionReport)
    const cr: ConnectionReport[] = [];
    for (let j = this.jB; j < this.jN; j++) {
      const c = this.conns[this.jConnK[j]];
      if (!c) continue;
      cr.push({
        cell: c.cell, edge: c.edge, type: c.type, jobs: this.jSlots[j], employed: Math.min(this.jAsg[j], this.jSlots[j]),
        workerCap: this.jEntC[j] > 0 ? this.jConnW[j] : 0, inbound: this.connInbound.get(c.cell) ?? 0,
      });
    }
    this.f2Cr = cr;
    this.f2Sub = 4;
    return false;
  }

  /** final2Piece, sub-state 4 (B2 R10: one small method per piece kind) */
  private final2Piece4(sim: Simulation): boolean {
    const st = sim.state;
    // publish: the per-id results, the commute layer, the cut-off ids, the connection report, the flags
    let t = this.accessById; this.accessById = this.accessB; this.accessB = t;
    t = this.commuteById; this.commuteById = this.commuteIdB; this.commuteIdB = t;
    t = this.reachedById; this.reachedById = this.reachedB; this.reachedB = t;
    t = this.carlessById; this.carlessById = this.carlessB; this.carlessB = t;
    t = this.carlessMinById; this.carlessMinById = this.carlessMinB; this.carlessMinB = t;
    t = this.jobFillById; this.jobFillById = this.jobFillB; this.jobFillB = t;
    t = this.carsById; this.carsById = this.carsB; this.carsB = t;
    if (this.sfRecompute) { t = this.customersById; this.customersById = this.customersB; this.customersB = t; }
    const mo = this.modeById; this.modeById = this.modeB; this.modeB = mo;
    st.commute.set(this.commuteB);
    const ci = this.cutIds; this.cutIds = this.cutIdsB; this.cutIdsB = ci;
    this.connLast = this.f2Cr;
    this.f2Cr = [];
    const changed = this.f2Changed;
    changed.length = 0;
    const OF = this.f2OFlag, JF = this.f2JFlag;
    for (let k = 0; k < OF.length; k += 2) {
      const b = st.buildings.get(this.oBid[OF[k]]);
      if (!b) continue;
      const bits = OF[k + 1];
      let f = setFlagQuiet(b, BF.NoJobs, (bits & 1) !== 0);
      f = setFlagQuiet(b, BF.Congested, (bits & 2) !== 0) || f;
      if (f) changed.push(b);
    }
    for (let k = 0; k < JF.length; k += 2) {
      const b = st.buildings.get(this.jBid[JF[k]]);
      if (!b) continue;
      if (setFlagQuiet(b, BF.Congested, (JF[k + 1] & 2) !== 0)) changed.push(b);
    }
    // the events, after every flag they announce (sub-state 5 is gone: see final2Piece)
    for (let k = 0; k < changed.length; k++) {
      const b = changed[k];
      // (a building removed since the snapshot gets no event — interrupted mode only)
      if (st.buildings.get(b.id) === b) sim.events.emit('buildingChanged', b);
    }
    changed.length = 0;
    this.f2Cur = 0;
    this.f2Sub = 6;
    return false;
  }

  /** final2Piece, sub-state 6, 7, 8 (B2 R10: one small method per piece kind) */
  private final2Piece6(sim: Simulation): boolean {
    const st = sim.state;
    this.savePrecomputePiece(st);
    return false;
  }

  /** final2Piece, sub-state 9 (B2 R10: one small method per piece kind) */
  private final2Piece9(sim: Simulation): boolean {
    // sample routes (cars, trucks, transit)
    this.sampleRoutesA();
    this.f2Sub = 10;
    return false;
  }

  /** final2Piece, sub-state 10 (B2 R10: one small method per piece kind) */
  private final2Piece10(sim: Simulation): boolean {
    const st = sim.state;
    // (freight trains, patrols; published)
    this.sampleRoutesB(st);
    this.serviceRoutes = this.serviceRoutes.filter((s) => s.until >= st.day);
    this.f2Sub = 11;
    return false;
  }

  /** final2Piece, sub-state 11: the transport save object, built privately (its arrays from the maps: the O(stops) part) */
  private final2Piece11(sim: Simulation): boolean {
    this.svSave = this.saveBuild(sim.state);
    this.f2Sub = 12;
    return false;
  }

  /** final2Piece, sub-state default (B2 R10: one small method per piece kind) */
  private final2PieceEnd(sim: Simulation): boolean {
    const st = sim.state;
    this.cycles++;
    this.saveInstall(st);
    this.f2Sub = 0;
    this.f2Cur = 0;
    sim.events.emit('layerUpdated', 'traffic');
    return true;
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
    this.sampleRoutesA();
    this.sampleRoutesB(st);
  }

  /** B2: the sample routes in two pieces — the cars / trucks and the transit samples (rand() in order), then the
   *  freight trains and the patrols (rand()); `routes` (getSampleRoutes) changes in the second */
  private sampleRoutesA(): void {
    const g = this.road;
    const routes: SampleRoute[] = (this.srNext = []);
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
  }

  private sampleRoutesB(st: CityState): void {
    const routes = this.srNext;
    // freight trains: freight stations to rail connections (BFS on rail graph)
    this.freightTrainRoutes(st, routes);
    // service patrols (police / garbage) as short random walks from service buildings
    this.patrolRoutes(st, routes);
    this.routes = routes;
    this.pendingRoutes = [];
    this.srNext = [];
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
      if (inf.transit !== Transit.Freight && inf.transit !== Transit.Train && inf.transit !== Transit.Hub) continue;
      if (!isFunctional(b)) continue;
      if (inf.transit === Transit.Freight) {
        // WP7-10: freight trains only run from rail-linked stations, along their cached route (freightRailCells)
        const fp = this.freightPaths.get(id);
        if (fp && fp.length >= 3) { routes.push({ cells: fp, kind: 'train', weight: 20 }); count++; }
        continue;
      }
      if (this.attach.get(id) !== 1) continue;
      if (inf.transit === Transit.Hub && !this.hubModeAttached(id, Transit.Train)) continue;
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
  /** the garages (prKeyNow: their indices) and the road graph version of the search; each seed garage's ranking minutes
   *  at the search (its labels include them: options use dist - seed + the current ranking minutes), the seeds (1) and
   *  their count */
  key: string;
  seed: Float32Array<ArrayBuffer>;
  inS: Uint8Array<ArrayBuffer>;
  nSeed: number;
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
  /** origins: road entries (CSR; road cells — routed 53: valid across graph rebuilds), workers, park & ride options
   *  (garage index, availability cost; PR_OPTIONS stride),
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
  /** garages: ids, group roots, ranking minutes (Infinity: no park & ride), room (spaces - reserve), road entries (CSR,
   *  road cells) */
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

/** interchange minutes of a non-highway cell next to a highway (class x congestion of its ramp flow) */
export function rampTime(type: number, vol: number): number {
  const base = RAMP_BY_NET[type] ?? RAMP_PENALTY;
  const r = vol / RAMP_CAP;
  const f = 1 + RAMP_ALPHA * r * r * r * r;
  return base * (f < RAMP_MAX_FACTOR ? f : RAMP_MAX_FACTOR);
}

/** a neighbour connection lies on a region neighbour's shared edge segment (its edge; the along-edge coordinate — x on
 *  the n / s edges, z on e / w — in [from, to), as regionLink's edgeFactor reads it) */
function onSegment(c: NeighborConn | undefined, n: Partial<Pick<RegionNeighbor, 'edge' | 'from' | 'to'>>): boolean {
  if (!c || c.edge !== n.edge || typeof n.from !== 'number' || typeof n.to !== 'number') return false;
  const a = c.edge === 'n' || c.edge === 's' ? c.x : c.z;
  return a >= n.from && a < n.to;
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
