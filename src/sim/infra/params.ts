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
/** destination dispersion: random job preference (0..DEST_NOISE minutes) per job site per assignment */
export const DEST_NOISE = 12;
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

/** job capacity shadow price update (minutes) */
export const PRICE_UP = 5;
export const PRICE_DOWN = 2.5;
export const PRICE_MAX = 70;

/** neighbor connection regional job / worker capacities (per connection cell), indexed by Network */
export const CONNECTION_JOBS: readonly number[] = [0, 400, 2000, 2000, 5000, 16000, 6000];
export const CONNECTION_WORKERS: readonly number[] = [0, 300, 1500, 1500, 4000, 12000, 5000];
/** regional travel time (minutes) added when commuting to / from a neighbor city */
export const REGIONAL_TIME = 16;
/** fraction of vacant jobs the region is willing to fill */
export const REGIONAL_FILL = 0.55;
/**
 * Global caps on regional exchange (no region data yet): total regional job slots <= REGION_JOB_SHARE x city workers
 * + REGION_JOB_MIN; inbound regional workers <= REGION_WORKER_SHARE x city job slots + REGION_WORKER_MIN.
 * The region layer can override the totals via state.systemData.regionJobs / state.systemData.regionWorkers (numbers).
 */
export const REGION_JOB_SHARE = 0.3;
export const REGION_JOB_MIN = 1500;
export const REGION_WORKER_SHARE = 0.3;
export const REGION_WORKER_MIN = 1000;

/** full assignment cadence (days between cycle starts) */
export const TRAFFIC_CYCLE_DAYS = 2;
/** per-frame time budget (ms) for time-sliced traffic phases */
export const TRAFFIC_FRAME_BUDGET_MS = 5;
/** commute above this (min) counts as unreachable for employment purposes */
export const MAX_COMMUTE = 110;

// ---------------------------------------------------------------------------------------------- utilities
/** derived power use (MW) per unit of capacity at full occupancy (when def.powerUse is missing) */
export const POWER_PER_RES = 0.05;
export const POWER_PER_JOB_C = 0.08;
export const POWER_PER_JOB_I = { IA: 0.04, ID: 0.22, IM: 0.16, IHT: 0.2 };
export const POWER_PER_CIVIC_JOB = 0.1;
export const POWER_MIN_PLOPPED = 1;
/** derived water use (kL/day) per unit of capacity at full occupancy */
export const WATER_PER_RES = 0.2;
export const WATER_PER_JOB_C = 0.12;
export const WATER_PER_JOB_I = { IA: 0.5, ID: 0.35, IM: 0.25, IHT: 0.18 };
export const WATER_PER_CIVIC_JOB = 0.1;
/** consumption at zero occupancy as share of full-occupancy use */
export const UTIL_BASE_SHARE = 0.25;
/** pumps within this many cells of water produce +PUMP_WATER_BONUS */
export const PUMP_WATER_DIST = 2;
export const PUMP_WATER_BONUS = 0.5;
export const CONSERVATION_CUT = 0.15;
/** recompute utilities at least every N days (demand drifts with population) */
export const UTIL_REFRESH_DAYS = 3;

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
/** garbage (tons / month) */
export const GARBAGE_PER_RES = 0.04;
export const GARBAGE_PER_JOB_C = 0.03;
export const GARBAGE_PER_JOB_I = { IA: 0.02, ID: 0.06, IM: 0.045, IHT: 0.02 };
export const GARBAGE_PER_CIVIC_JOB = 0.02;
/** landfill zone cell throughput (tons / month) */
export const LANDFILL_CELL_CAP = 160;
export const RECYCLING_CUT = 0.2;
/** uncollected garbage level added per ton per cell per update and decay when collected */
export const GARBAGE_BUILDUP = 0.02;
export const GARBAGE_DECAY = 0.35;
export const NO_GARBAGE_THRESHOLD = 0.35;
export const POLLUTED_THRESHOLD = 0.45;

// ---------------------------------------------------------------------------------------------- services
/** road distance is ~Manhattan: coverage radius along roads = def.radius * ROAD_RADIUS_FACTOR */
export const ROAD_RADIUS_FACTOR = 1.3;
/** coverage demand ratio (people per resident needing the service) used against def.coverage.capacity */
export const COVERAGE_DEMAND: Record<string, number> = { education: 0.22, health: 0.12, police: 1, fire: 1, park: 1, transit: 1, garbage: 1 };
/** EQ / HQ convergence per services update (fraction of gap) */
export const EQ_RATE = 0.012;
export const HQ_RATE = 0.02;
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
