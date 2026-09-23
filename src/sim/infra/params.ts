/**
 * Tunable parameters for the infrastructure simulation (utilities, traffic, transit, pollution, services,
 * crime, fire, disasters). Every magic number used by src/sim/infra/** lives here so balancing is one-stop.
 *
 * Units:
 *  - traffic volume / capacity: trips (passenger-car units) per day through a cell (both directions summed)
 *  - travel times: game minutes (tuned for SC4-like commute numbers, not real-world speeds)
 *  - power: MW, water: kL/day, garbage: tons/month
 */
import { Network } from '../../core/types';
import { REGION_COMMUTERS_BASE, REGION_COMMUTERS_FRAC } from '../economy/tuning';

// ---------------------------------------------------------------------------------------------- traffic
/** Capacity per cell (trips/day) indexed by Network. Rail capacity is for trains (passengers/day). */
export const NET_CAPACITY: readonly number[] = [
  0, // None
  350, // Street
  1200, // Road
  1600, // OneWay
  2600, // Avenue
  7000, // Highway
  12000, // Rail (passengers/day)
];
/** Free-flow time to traverse one cell (minutes) indexed by Network. */
export const NET_TIME: readonly number[] = [
  0,
  0.16, // Street  (~slow residential)
  0.1, // Road
  0.085, // OneWay
  0.075, // Avenue
  0.04, // Highway
  0.035, // Rail (train in-vehicle)
];
/** subway in-vehicle minutes per cell */
export const SUBWAY_TIME = 0.03;
/** bus in-vehicle time multiplier on (congested) road time; buses stop and share roads */
export const BUS_TIME_FACTOR = 1.25;
/** extra minutes when moving between highway and a non-highway road (automatic ramp) */
export const RAMP_PENALTY = 0.35;
/** BPR congestion function t = t0 * (1 + BPR_ALPHA * (v/c)^BPR_BETA), factor capped at BPR_MAX_FACTOR */
export const BPR_ALPHA = 0.15;
export const BPR_BETA = 4;
export const BPR_MAX_FACTOR = 12;
/** minimum MSA blending factor between successive assignments (1 = no smoothing) */
export const MSA_MIN_ALPHA = 0.3;

/** Fixed overhead minutes per mode (parking / walking to car, waiting at stops ...) */
export const CAR_OVERHEAD = 4;
export const WALK_TIME_PER_CELL = 0.8;
/** max walking distance (cells, along the road graph) for walking commutes */
export const WALK_MAX_CELLS = 15;
/** walking radius (cells) to reach a transit stop */
export const STOP_WALK_RADIUS = 5;
export const STOP_WALK_TIME_PER_CELL = 0.5;
/** average wait (minutes) at stops per transit mode */
export const WAIT_BUS = 5;
export const WAIT_SUBWAY = 3.5;
export const WAIT_TRAIN = 6;
/** stop capacity (riders/day) before crowding adds waiting time */
export const STOP_CAP_BUS = 2500;
export const STOP_CAP_SUBWAY = 9000;
export const STOP_CAP_TRAIN = 14000;
/** buses are vehicles on the road: PCU added to the road per rider */
export const BUS_PCU_PER_RIDER = 1 / 12;
/** mode choice (multinomial logit): utility = -BETA * minutes + bias */
export const MODE_BETA = 0.13;
/** bias per wealth level (index wealth-1 : R$, R$$, R$$$) */
export const CAR_BIAS = [-1.2, 0, 0.9];
export const TRANSIT_BIAS = [0.7, 0, -0.7];
export const WALK_BIAS = -0.5;
/**
 * small random job preference (0..DEST_NOISE minutes) per job site per assignment: tie-breaking / route variety.
 * Keep small: it is shared by all origins, so large values would herd everyone to the same site. Spatial spreading
 * of commuters comes from the capacity shadow prices.
 */
export const DEST_NOISE = 0.02;
/** smoothing of per-building outputs across assignments (weight of the new value) */
export const RESULT_SMOOTH = 0.5;

/** share of residents that are commuting workers */
export const WORKER_SHARE = 0.55;
/** shopping trips per resident per day (off-peak -> weighted) */
export const SHOP_TRIPS_PER_RES = 0.25;
export const SHOP_PCU_WEIGHT = 0.4;
/** freight trucks per industrial job per day, and truck PCU */
export const FREIGHT_PER_JOB = { IA: 0.05, ID: 0.12, IM: 0.1, IHT: 0.03 };
export const TRUCK_PCU = 2.5;
/** car occupancy (people per car) -> car PCU per commuter = 1 / occupancy */
export const CAR_OCCUPANCY = 1.15;

/**
 * capacity-constrained job matching: up to MATCH_ROUNDS successive filling rounds; the first MATCH_PROP_ROUNDS cap each
 * job site at its proportional share slots x min(1, MATCH_PROP_SLACK x workers / slots) (surplus jobs -> sites fill
 * proportionally), later rounds allow the full capacity.
 */
export const MATCH_ROUNDS = 4;
export const MATCH_PROP_ROUNDS = 3;
export const MATCH_PROP_SLACK = 1.15;
/**
 * shadow price per job site: p += step x ln(first-round proposals / capacity) each cycle, clamped to [0, MAX] minutes;
 * step = max(MATCH_PRICE_STEP_MIN, MATCH_PRICE_STEP_REL x average commute) so it matches the city's time scale.
 */
export const MATCH_PRICE_STEP_REL = 0.12;
export const MATCH_PRICE_STEP_MIN = 0.15;
export const MATCH_PRICE_MAX = 30;

/** neighbor connection regional job / worker capacities (per connection cell), indexed by Network */
export const CONNECTION_JOBS: readonly number[] = [0, 400, 2000, 2000, 5000, 16000, 6000];
export const CONNECTION_WORKERS: readonly number[] = [0, 300, 1500, 1500, 4000, 12000, 5000];
/** regional travel time (minutes) added when commuting to / from a neighbor city */
export const REGIONAL_TIME = 16;
/** fraction of vacant jobs the region is willing to fill */
export const REGIONAL_FILL = 0.55;
/**
 * Default regional exchange totals (no region data): regional job slots for residents =
 * REGION_JOB_SHARE x workers + REGION_JOB_MIN, inbound regional workers = REGION_WORKER_SHARE x city job slots +
 * REGION_WORKER_MIN. Values follow sim-core's employment model (economy/tuning.ts REGION_COMMUTERS_FRAC / _BASE) so
 * traffic's workerAccess / jobFill agree with stats.unemployment. The region layer (src/region/regionEffects.ts)
 * overrides the totals via state.systemData.regionJobs / regionWorkers (numbers) using the same formulas + bonus.
 */
export const REGION_JOB_SHARE = REGION_COMMUTERS_FRAC;
export const REGION_JOB_MIN = REGION_COMMUTERS_BASE;
export const REGION_WORKER_SHARE = REGION_COMMUTERS_FRAC;
export const REGION_WORKER_MIN = REGION_COMMUTERS_BASE;

/** full assignment cadence (days between cycle starts) */
export const TRAFFIC_CYCLE_DAYS = 2;
/** with a live renderer, start a new assignment at most this often (real ms) */
export const TRAFFIC_MIN_CYCLE_MS = 1000;

// ---------------------------------------------------------------------------------------------- scheduler
/** headless: estimated ms of infra steps per sim day (at least one step always runs; step estimates ~ ms on a busy 4-core CI box) */
export const INFRA_DAY_BUDGET = 2.6;
/** headless: unused budget (next step did not fit) carried to the next day, at most this much */
export const INFRA_DAY_CARRY = 0.6;
/** with a live renderer: real ms of infra steps per frame (at least one step when due) */
export const INFRA_FRAME_BUDGET_MS = 3;
/** commute above this (min) counts as unreachable for employment purposes */
export const MAX_COMMUTE = 110;

// ---------------------------------------------------------------------------------------------- utilities
/**
 * FALLBACK utility use when a def has no powerUse / waterUse (the catalog normally provides them; units follow the
 * catalog's unit system: ~1 kW and 0.25 kL/day per resident). Per unit of capacity at full occupancy.
 */
export const POWER_PER_RES = 0.001;
export const POWER_PER_JOB_C = 0.0017;
export const POWER_PER_JOB_I = { IA: 0.001, ID: 0.004, IM: 0.003, IHT: 0.0025 };
export const POWER_PER_CIVIC_JOB = 0.005;
export const POWER_MIN_PLOPPED = 0;
export const WATER_PER_RES = 0.25;
export const WATER_PER_JOB_C = 0.05;
export const WATER_PER_JOB_I = { IA: 3, ID: 0.4, IM: 0.25, IHT: 0.15 };
export const WATER_PER_CIVIC_JOB = 0.3;
/** consumption at zero occupancy as share of full-occupancy use */
export const UTIL_BASE_SHARE = 0.25;
/** pumps within this many cells of water produce +PUMP_WATER_BONUS */
export const PUMP_WATER_DIST = 2;
export const PUMP_WATER_BONUS = 0.5;
/** utilities refresh cadence (days): soft refresh at least every UTIL_REFRESH_DAYS, within UTIL_SOFT_DAYS of growth
 * changes; full relabel every UTIL_FULL_DAYS (player edits trigger an urgent full pass immediately) */
export const UTIL_REFRESH_DAYS = 6;
export const UTIL_SOFT_DAYS = 2;
export const UTIL_FULL_DAYS = 24;

// ---------------------------------------------------------------------------------------------- pollution
/** air emission per active job by industry type */
export const AIR_PER_JOB = { IA: 0.004, ID: 0.035, IM: 0.009, IHT: 0.0008 };
export const WATER_POLL_PER_JOB = { IA: 0.006, ID: 0.02, IM: 0.008, IHT: 0.0005 };
export const NOISE_PER_JOB = { IA: 0.002, ID: 0.012, IM: 0.008, IHT: 0.001 };
/** traffic: emission per trip/day through a cell (scaled by congestion) */
export const AIR_PER_TRIP = 0.00004;
export const NOISE_PER_TRIP = 0.0003;
/** sewage per resident (water pollution) */
export const SEWAGE_PER_RES = 0.0012;
/** residents served by a treatment plant when def.capacity is missing */
export const TREATMENT_DEFAULT_CAP = 80000;
/** saturation constants: layer = 1 - exp(-field / K) */
export const AIR_K = 3;
export const WATER_K = 2;
export const NOISE_K = 3;
/** isolated point source of strength S yields a peak field of POLL_PEAK_GAIN * S (blur gain = gain * 2*pi*sigma^2) */
export const POLL_PEAK_GAIN = 0.35;
/** blur radii (box radius, 3 passes) for small / medium / large emitters */
export const POLL_RADII = [2, 4, 7];
/** air pollution drifts with the wind by up to this many cells per update */
export const WIND_DRIFT = 1.2;
/** landfill smell (air source per landfill cell) */
export const LANDFILL_AIR = 0.25;
export const POLL_SMOOTH = 0.35;
/** FALLBACK garbage production (tons / month per unit at full occupancy) when a def has no pollution.garbage */
export const GARBAGE_PER_RES = 0.04;
export const GARBAGE_PER_JOB_C = 0.035;
export const GARBAGE_PER_JOB_I = { IA: 0.03, ID: 0.12, IM: 0.08, IHT: 0.03 };
export const GARBAGE_PER_CIVIC_JOB = 0.03;
/** landfill zone cell throughput (tons / month) when the util_landfill_tile def is missing */
export const LANDFILL_CELL_CAP = 300;
/** residents whose sewage one treatment plant handles, per kL/day of its waterOut (50,000 kL -> 200k residents) */
export const TREATMENT_RES_PER_KL = 4;
/** uncollected garbage level added per ton per cell per update and decay when collected */
export const GARBAGE_BUILDUP = 0.02;
export const GARBAGE_DECAY = 0.35;
export const NO_GARBAGE_THRESHOLD = 0.35;
export const POLLUTED_THRESHOLD = 0.45;

// ---------------------------------------------------------------------------------------------- services
/** road distance is ~Manhattan: coverage radius along roads = def.radius * ROAD_RADIUS_FACTOR */
export const ROAD_RADIUS_FACTOR = 1.3;
/** people per resident counted against def.coverage.capacity (catalog: capacity = residents served) */
export const COVERAGE_DEMAND: Record<string, number> = { education: 1, health: 1, police: 1, fire: 1, park: 1, transit: 1, garbage: 1 };
/** EQ / HQ first-order lag time constants (years): EQ changes over a generation, HQ over a few years */
export const EQ_TAU_YEARS = 10;
export const HQ_TAU_YEARS = 4;
/** transit stop walking coverage radius (cells) */
export const TRANSIT_COV_RADIUS = { bus: 5, subway: 7, train: 8 };

// ---------------------------------------------------------------------------------------------- crime
export const CRIME_THRESHOLD = 0.55;

// ---------------------------------------------------------------------------------------------- fire
/** base daily ignition probability per building (scaled by risk) */
export const FIRE_BASE_P = 1 / 250000;
export const FIRE_SPREAD_P = 0.02;
export const FIRE_BURN_DAYS = 6;

/** networks helper */
export const HIGHWAY = Network.Highway;

// ============================================================================================================
// SIM_DEPTH_SPEC sections — each package appends ONLY inside its own section (between its start and end markers).
// ============================================================================================================

// ---------------------------------------------------------------------------------------------- §CATCHMENTS (owner WP2)
// WP2: tier table defaults, WALK_COST / DRIVE_COST / RAMP_COST, ACCESS_PERIOD, RES_PER_CS_JOB, UNPOWERED_SERVICE_EFF ...
// §CATCHMENTS end

// ---------------------------------------------------------------------------------------------- §POLLUTION (owner WP3)
// WP3: per-source smoke, wind, bank coupling, NOISE_PER_TRIP_NET / NET_BASE_NOISE, buffers, garbage range / landfill ...
// §POLLUTION end

// ---------------------------------------------------------------------------------------------- §UTILITIES (owner WP3)
// WP3: thermal-plant water, wind / solar factors, brownout priority, water-tower storage ...
// §UTILITIES end

// ---------------------------------------------------------------------------------------------- §CRIME (owner WP3)
// WP3: youth component, local unemployment, CRIME_SPILL ...
// §CRIME end

// ---------------------------------------------------------------------------------------------- §EMERGENCY (owner WP8)
// WP8: EMERG_DAYS_PER_MIN, RMAX, grace / deadline table, incident rates, dispatch limits ...
// §EMERGENCY end

// ---------------------------------------------------------------------------------------------- §FACILITIES (owner WP7)
// WP7: POLICE_CAP, justice (ARREST_K, SENTENCE_MONTHS, JAIL_BEDS), bus fleet, parking, park & ride, ferry, ramps ...
// §FACILITIES end
