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
import { REGION_COMMUTERS_BASE, REGION_COMMUTERS_FRAC, WORKFORCE_RATIO } from '../economy/tuning';

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

/** share of residents that are commuting workers when a building has no b.wf (one source of truth: economy WORKFORCE_RATIO;
 *  per building traffic uses economy/demographics workerShare(b)) */
export const WORKER_SHARE = WORKFORCE_RATIO;
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
export const INFRA_DAY_BUDGET = 2.6 + 0.15 /* WP3 share (P0-15) */ + 0.25 /* WP2 share (P0-15) */;
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
// Catchment tiers (infra/catchments.ts, services.ts), access fields and NIMBY / YIMBY rasters (infra/nimby.ts).
/**
 * reach-kernel step cost (quarter cells) of ENTERING a road cell, indexed by Network [None, Street, Road, Avenue, OneWay,
 * Highway, Rail]; 0 = impassable. Walking: avenues are wide to cross; highways and rail tracks block pedestrians
 * (bridges / tunnels / level crossings keep their road type and pass).
 */
export const WALK_COST: readonly number[] = [0, 4, 4, 5, 4, 0, 0];
/** driving (school buses, ambulances, patrol cars): streets are slow, avenues and highways fast */
export const DRIVE_COST: readonly number[] = [0, 5, 4, 3, 4, 2, 0];
/** extra quarter cells when a drive moves between highway and a non-highway road (ramp) */
export const RAMP_COST = 2;
/** cells around a facility footprint that are always fully reached (Chebyshev distance, capped by the radius) */
export const CATCH_NEAR_FIELD = 3;
/** operating factor of a service building whose def uses power (powerUse > 0) while unpowered */
export const UNPOWERED_SERVICE_EFF = 0.3;
/** operating factor of a clinic / hospital whose def uses water while unwatered */
export const UNWATERED_HEALTH_EFF = 0.6;
/** a facility with utilisation (demand / effective capacity) above this is overcrowded (stats.needs, inspector) */
export const OVERCROWDED_UTIL = 1.15;
/** health need (patient-equivalents) per resident by cohort [kids, teens, young adults, adults, seniors] / norm
 *  (normalised so the reference cohort mix gives 1 per resident) */
export const HEALTH_NEED_W: readonly number[] = [0.6, 0.5, 0.5, 0.9, 3.5];
export const HEALTH_NEED_NORM = 1.183;
/** green need per resident = (GREEN_NEED_BASE + GREEN_NEED_SENIOR x senior share) / GREEN_NEED_NORM */
export const GREEN_NEED_BASE = 0.8;
export const GREEN_NEED_SENIOR = 1.2;
export const GREEN_NEED_NORM = 0.98;
/** play need = kids + PLAY_TEEN_W x teens */
export const PLAY_TEEN_W = 0.7;
/** college need = young adults x CATCH_COLLEGE_WILL[wealth-1] + COLLEGE_ADULT_W x adults (mirrors WP1 COLLEGE_WILL) */
export const CATCH_COLLEGE_WILL: readonly number[] = [0.35, 0.55, 0.75];
export const COLLEGE_ADULT_W = 0.05;
/** legacy st.eduCov = clamp(EDU_LEGACY_W . [elementary, high, college]) (no longer saturates) */
export const EDU_LEGACY_W: readonly number[] = [0.45, 0.35, 0.2];
/** parks without a coverage def: green tier, walk, radius 3 + max(w, d), this strength / capacity (visitors) */
export const PARK_DEFAULT_STRENGTH = 0.7;
export const PARK_DEFAULT_CAPACITY = 2000;
/** unservedClusters: coarse block size (cells); need in cells with coverage below CLUSTER_COV counts as unserved */
export const CLUSTER_BLOCK = 8;
export const CLUSTER_COV = 0.3;
/** access fields (accessCommute, shopAccess) are recomputed every ACCESS_PERIOD days or after a network change */
export const ACCESS_PERIOD = 30;
/** accessCommute seeds: job sites with >= ACCESS_JOB_SLOTS slots start at CAR_OVERHEAD + ACCESS_JOB_EXTRA minutes */
export const ACCESS_JOB_SLOTS = 20;
export const ACCESS_JOB_EXTRA = 2;
/** accessCommute: minutes per land cell away from the road; unreached cells get ACCESS_UNREACHED x average commute */
export const ACCESS_LAND_STEP = 0.3;
export const ACCESS_UNREACHED = 1.5;
/** shopAccess = score x (SHOP_BASE + (1 - SHOP_BASE) x supply ratio); score = 1 - smoothstep(SHOP_NEAR, SHOP_FAR,
 *  drive cells to the nearest CS frontage, searched up to SHOP_CAP_CELLS); supply ratio = min(1, blurred CS job
 *  capacity x RES_PER_CS_JOB / (blurred residents + 1)) per CLUSTER_BLOCK coarse block */
export const SHOP_CAP_CELLS = 40;
export const SHOP_NEAR = 6;
export const SHOP_FAR = 40;
export const SHOP_BASE = 0.35;
export const RES_PER_CS_JOB = 9;
/** NIMBY / YIMBY sources without a catalog field (amount at the source 0..1, radius in cells) */
export const NIMBY_ID = { amount: 0.12, radius: 4 };
export const NIMBY_IM = { amount: 0.05, radius: 3 };
export const NIMBY_HIGHWAY = { amount: 0.18, radius: 3 };
/** highway bridges / elevated sections (netFlags bit 0); tunnels (bit 1) give no stigma */
export const NIMBY_HIGHWAY_BRIDGE = 0.25;
export const NIMBY_RAIL = { amount: 0.06, radius: 2 };
/** landfill: per 2x2 block of landfill cells, x (NIMBY_LANDFILL_IDLE + (1 - IDLE) x use); use = garbage load / capacity */
export const NIMBY_LANDFILL_IDLE = 0.4;
/** power plant stigma x (NIMBY_PLANT_IDLE + (1 - IDLE) x plant load) when utilities reports plantLoad (WP3) */
export const NIMBY_PLANT_IDLE = 0.5;
/** high-end commercial growables (CS$$$ / CO$$$ at stage >= PRESTIGE_HIGH_C_STAGE) radiate a little prestige */
export const PRESTIGE_HIGH_C = { amount: 0.05, radius: 4 };
export const PRESTIGE_HIGH_C_STAGE = 6;
// §CATCHMENTS end

// ---------------------------------------------------------------------------------------------- §POLLUTION (owner WP3)
// WP3: per-source smoke, wind, bank coupling, NOISE_PER_TRIP_NET / NET_BASE_NOISE, buffers, garbage range / landfill ...
// Intensities are on the 0..1 overlay scale at the source (catalog semantics); "per trip / per resident / per job"
// values are raw source strengths like AIR_PER_TRIP.
/** noise source per trip/day by Network [None, Street, Road, Avenue, OneWay, Highway, Rail]: highway trips are loudest */
export const NOISE_PER_TRIP_NET: readonly number[] = [0, 0.00022, 0.0003, 0.00034, 0.0003, 0.00045, 0];
/**
 * volume-independent noise intensity per network cell (a highway hums even when empty; rail = passing trains). Roads are
 * line sources: a long straight road sums ~6 cells, so the level next to it is ~5x the per-cell value (empty highway
 * ~0.25, avenue ~0.08, road ~0.03).
 */
export const NET_BASE_NOISE: readonly number[] = [0, 0, 0.0015, 0.006, 0.003, 0.045, 0.018];
/** congestion slows traffic and muffles it: noise x (1 - NOISE_CONG_DAMP x clamp(congestion - 1, 0, 1)) */
export const NOISE_CONG_DAMP = 0.25;
/** rail / road level crossing (netFlags 0x20) horns & bells, freight train cells (traffic.freightRailCells, WP7) */
export const NOISE_CROSSING = 0.1;
export const NOISE_FREIGHT_RAIL = 0.12;
/** tunnels (netFlags bit 1) keep most exhaust and noise underground; bridges (bit 0) carry noise farther */
export const TUNNEL_AIR = 0.3;
export const TUNNEL_NOISE = 0.05;
export const BRIDGE_NOISE = 1.25;
/**
 * AREA-CALIBRATED sources (many small emitters side by side add up ~50x more than one isolated emitter): the value is
 * the level a whole district of them reaches; a lone one barely registers.
 * nightlife: CS$$ / CS$$$ in high-density commercial, noise x activity
 */
export const NOISE_NIGHTLIFE = 0.08;
/** construction sites (BF.Constructing): dust and noise of a district under construction */
export const CONSTRUCTION_AIR = 0.1;
export const CONSTRUCTION_NOISE = 0.25;
/** burning buildings: smoke intensity (radius 2) */
export const FIRE_SMOKE = 0.25;
/** residential heating: air per resident x wealth factor [R$, R$$, R$$$] x (0.6 + 0.8 winter) x climate */
export const HEAT_AIR_PER_RES = 0.00015;
export const HEAT_WEALTH: readonly number[] = [1.3, 1, 0.8];
export const HEAT_CLIMATE: Readonly<Record<string, number>> = { temperate: 1, desert: 0.5, tropical: 0.25, alpine: 1.4 };
/** commercial (CS) air per active job (deliveries, kitchens) */
export const AIR_PER_CS_JOB = 0.0002;
/** power plant activity = PLANT_IDLE_ACT + (1 - PLANT_IDLE_ACT) x load; incinerator = INCIN_IDLE_ACT + ... x burn share */
export const PLANT_IDLE_ACT = 0.25;
export const INCIN_IDLE_ACT = 0.2;
/** prevailing wind: plume drift (cells) x strength; the plume averages copies shifted by 0.5 d and 1 d */
export const WIND_DRIFT_PREVAIL = 2.5;
/** plume drift of large emitters (tall stacks: coal / oil plants, airports ...; quarter-resolution class) */
export const WIND_DRIFT_FAR = 6;
/** buffers after saturation: noise x (1 - TREE_NOISE x treeCover - PARK_NOISE x park), air x (1 - TREE_AIR x treeCover) */
export const TREE_NOISE_ABSORB = 0.25;
export const PARK_NOISE_ABSORB = 0.15;
export const TREE_AIR_ABSORB = 0.12;
/** treeCover = box average of trees / 4 over (2 r + 1)^2 cells */
export const TREE_COVER_RADIUS = 2;
/** R buildings with noise above this get BF.Noisy */
export const NOISY_THRESHOLD = 0.5;
/** land cells within BANK_DIST of a water body take max(ground, BANK_COUPLING x water-body pollution) */
export const BANK_COUPLING = 0.6;
export const BANK_DIST = 2;
/** sewage per resident is SEWAGE_PER_RES (above); the treated share cleans TAP_TREATMENT_CLEAN of tap-water pollution */
export const TAP_TREATMENT_CLEAN = 0.7;
/** garbage trucks: a building is collected only within this many road cells of a facility (landfill / incinerator / recycling) */
export const GARBAGE_TRUCK_RANGE = 90;
/** uncollected garbage level per month: GARBAGE_BUILDUP_RATE x (0.6 + 0.4 min(1, t/month/cell / 0.3)) -> flags in ~3-4 months */
export const GARBAGE_BUILDUP_RATE = 0.14;
/** tons one landfill cell holds before it is full (300 t/month for 10 years) */
export const LANDFILL_CELL_STOCK = 36000;
/** landfill emission per cell x (LANDFILL_IDLE_EMIT + (1 - ..) x use) / sqrt(max(1, regionCells / LANDFILL_SIZE_REF)) */
export const LANDFILL_IDLE_EMIT = 0.25;
export const LANDFILL_SIZE_REF = 16;
/** garbage news cooldown (days; out of truck range) and the mean landfill fill that triggers a "landfill filling up" warning */
export const GARBAGE_NEWS_DAYS = 90;
export const LANDFILL_WARN_FILL = 0.8;
/** recycling diverts at most this share of collected garbage (before incineration / landfill) */
export const RECYCLE_MAX_SHARE = 0.35;
/** garbage facility capacity without power */
export const GARBAGE_UNPOWERED = 0.3;
/**
 * uncollected piles smell: air level of a whole neighbourhood of full piles (area source: a single pile barely registers,
 * a district where nothing is collected stinks; per-cell source = the uniform-area equivalent x pile level)
 */
export const GARBAGE_SMELL = 0.12;
/** soil contamination (stock): soil += SOIL_RATE x dtMonths x src x (1 - soil); decay x (1 - SOIL_DECAY x dtMonths x 'soil.decay') */
export const SOIL_RATE = 0.015;
export const SOIL_DECAY = 0.002;
/** soil source per active industry cell by type, per landfill cell (x activity), and x def water intensity for plopped emitters */
export const SOIL_SRC_IND = { IA: 0.08, ID: 0.3, IM: 0.12, IHT: 0.02 };
export const SOIL_SRC_LANDFILL = 0.35;
export const SOIL_SRC_PLOPPED = 0.5;
/** contaminated soil leaches into ground water: water intensity SOIL_GROUNDWATER x soil */
export const SOIL_GROUNDWATER = 0.3;
/** a closed landfill cell (zone removed) leaves brownfield soil >= BROWNFIELD_BASE + BROWNFIELD_FILL x fill */
export const BROWNFIELD_BASE = 0.3;
export const BROWNFIELD_FILL = 0.5;
// §POLLUTION end

// ---------------------------------------------------------------------------------------------- §UTILITIES (owner WP3)
// WP3: thermal-plant water, wind / solar factors, brownout priority, water-tower storage ...
/** thermal plants (category power with waterUse > 0) without water run at this share of their output */
export const THERMAL_UNWATERED = 0.5;
/** wind turbine output x (WIND_TURBINE_BASE + WIND_TURBINE_GAIN x smoothstep(H0, H1, height - local mean height (m))) */
export const WIND_TURBINE_BASE = 0.6;
export const WIND_TURBINE_GAIN = 0.8;
export const WIND_TURBINE_H0 = 10;
export const WIND_TURBINE_H1 = 60;
/** radius (cells) of the local mean height around a turbine */
export const WIND_TURBINE_RADIUS = 16;
/** solar output x season (winter .. summer) x climate */
export const SOLAR_WINTER = 0.8;
export const SOLAR_SUMMER = 1.15;
export const SOLAR_CLIMATE: Readonly<Record<string, number>> = { temperate: 1, desert: 1.2, tropical: 1.05, alpine: 0.85 };
/** pumps: output x (1 - PUMP_POLL_LOSS x intake pollution x (treatment plant in city ? PUMP_TREATED_LOSS : 1)) */
export const PUMP_POLL_LOSS = 0.6;
export const PUMP_TREATED_LOSS = 0.35;
/** sea = water component touching the map edge, > SEA_MIN_SHARE of the map, with a cell >= SEA_MIN_DEPTH from land */
export const SEA_MIN_SHARE = 0.02;
export const SEA_MIN_DEPTH = 6;
/** pumps drawing only sea water are brackish (no fresh-water bonus); desalination away from the sea barely works */
export const SEA_PUMP_OUT = 0.6;
export const DESAL_INLAND_OUT = 0.2;
/** days between shortage news (power / water) */
export const SHORTAGE_NEWS_DAYS = 30;
// §UTILITIES end

// ---------------------------------------------------------------------------------------------- §CRIME (owner WP3)
// WP3: youth component, local unemployment, CRIME_SPILL ...
/** youth crime (R): min(YOUTH_CRIME_MAX, YOUTH_CRIME x (teens / YOUTH_REF_TEENS) x (1 - high school) x (1 - YOUTH_PLAY x play)) */
export const YOUTH_CRIME = 0.08;
export const YOUTH_CRIME_MAX = 0.15;
export const YOUTH_REF_TEENS = 0.07;
export const YOUTH_PLAY = 0.6;
/** R unemployment term: LOCAL_UNEMP_R x (0.5 city unemployment + 0.5 (1 - worker access)); C / I: LOCAL_UNEMP_CI x city */
export const LOCAL_UNEMP_R = 0.5;
export const LOCAL_UNEMP_CI = 0.2;
/** crime spill around nuisance venues (raw crime added with linear falloff to 0 at radius cells) */
export const CRIME_SPILL: Readonly<Record<string, { amount: number; radius: number }>> = {
  rw_casino: { amount: 0.2, radius: 8 },
  civ_jail: { amount: 0.06, radius: 6 },
  park_stadium: { amount: 0.05, radius: 8 },
};
/** CS$$$ in high-density commercial (nightlife, pickpockets) */
export const CRIME_NIGHTLIFE = 0.02;
/** uncollected garbage: + CRIME_GARBAGE x pile level */
export const CRIME_GARBAGE = 0.08;
// §CRIME end

// ---------------------------------------------------------------------------------------------- §EMERGENCY (owner WP8)
// WP8: EMERG_DAYS_PER_MIN, RMAX, grace / deadline table, incident rates, dispatch limits ...
// §EMERGENCY end

// ---------------------------------------------------------------------------------------------- §FACILITIES (owner WP7)
// WP7: POLICE_CAP, justice (ARREST_K, SENTENCE_MONTHS, JAIL_BEDS), bus fleet, parking, park & ride, ferry, ramps ...
// §FACILITIES end
