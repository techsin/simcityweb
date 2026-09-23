/**
 * ECONOMY TUNING — every balance knob of the sim-core systems lives here (owned by sim-core).
 * Units: money $, time in days unless noted, population in residents, jobs in jobs.
 * Index order of per-DevType arrays: [R$, R$$, R$$$, CS$, CS$$, CS$$$, CO$$, CO$$$, I-Ag, I-D, I-M, I-HT].
 */
import { Network, Zone } from '../../core/types';

// ============================================================================ calendar / slicing
/** land value: full-map refresh period (days); rows are processed in bands */
export const LV_REFRESH_DAYS = 12;
/** full-map static land value (water distance, view) recompute after terrain changes: at most every N days */
export const LV_STATIC_MIN_DAYS = 90;
/** plopped-building land value splat recompute: at most every N days */
export const LV_EFFECTS_MIN_DAYS = 7;
/** desirability: full-map refresh period (days); unzoned land (all DevTypes, for overlays) every DESIR_ALL_SWEEPS sweeps */
export const DESIR_REFRESH_DAYS = 12;
export const DESIR_ALL_SWEEPS = 4;
/** occupancy / building health update period (each growable is updated once per period) */
export const OCC_PERIOD = 4;

// ============================================================================ workforce / employment
/** fraction of residents that are in the workforce */
export const WORKFORCE_RATIO = 0.55;
/** regional commuters that can fill jobs when connected to neighbors: base + fraction of workforce, max share of jobs */
export const REGION_COMMUTERS_BASE = 300;
export const REGION_COMMUTERS_FRAC = 0.05;
export const REGION_COMMUTERS_MAX_SHARE = 0.25;
/** isolated cities (no neighbor connection) get this fraction of regional commuters */
export const REGION_COMMUTERS_ISOLATED = 0.3;
/** residents may also work in the region: employable = local jobs + this × regional commuter volume */
export const REGION_JOBS_FOR_RESIDENTS = 1;
/** with sim-infra traffic: employed × (1 − weight × (1 − avg worker job access)) */
export const TRAFFIC_ACCESS_WEIGHT = 0.15;
/** with sim-infra traffic: job fill = (1 − w) × global fill + w × traffic job fill of the building */
export const TRAFFIC_JOBFILL_WEIGHT = 0.5;

/** worker wealth mix per job DevType: [R$, R$$, R$$$] (who holds those jobs) */
export const JOB_WEALTH_MIX: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [0, 0, 0], [0, 0, 0], // R (unused)
  [0.75, 0.22, 0.03], // CS$
  [0.3, 0.6, 0.1], // CS$$
  [0.1, 0.5, 0.4], // CS$$$
  [0.2, 0.62, 0.18], // CO$$
  [0.05, 0.45, 0.5], // CO$$$
  [0.85, 0.15, 0], // I-Ag
  [0.75, 0.23, 0.02], // I-D
  [0.42, 0.5, 0.08], // I-M
  [0.08, 0.5, 0.42], // I-HT
];
/** civic jobs wealth mix */
export const CIVIC_WEALTH_MIX: readonly [number, number, number] = [0.3, 0.5, 0.2];

// ============================================================================ DEMAND
/**
 * Demand model (economic base, SC4 flavour). Targets are absolute capacity (residents / jobs):
 *  R_w  = (R_BASE_w × connR + Σ jobs_d × JOB_WEALTH_MIX[d][w] / WORKFORCE_RATIO × R_JOB_SLACK) × modifiers
 *  CS_w = (CS_BASE + CS_PER_RES_w × customers_w + tourism) × modifiers
 *  CO   = workforce × coShare(P, EQ) × connC × modifiers
 *  I    = (I_BASE × connI + workforce × iShare(P)) × share_dev(EQ) × modifiers
 * demandAbs = softmin(target, cap) − current capacity (incl. under construction, excl. abandoned).
 * Displayed demand = tanh(demandAbs / norm) smoothed with DEMAND_EMA.
 */
/** regional residential attraction (residents that come without local jobs) per wealth */
export const R_BASE: readonly [number, number, number] = [1400, 900, 150];
/** residents wanted per local job (beyond WORKFORCE_RATIO) — >1 keeps R slightly ahead of jobs */
export const R_JOB_SLACK = 1.06;
/** multiplier on job targets (keeps C/I slightly ahead of workforce) */
export const JOB_SLACK = 1.06;
/** base CS jobs per wealth (a few shops even in a hamlet) */
export const CS_BASE: readonly [number, number, number] = [60, 40, 10];
/** CS jobs per customer (resident) of matching wealth */
export const CS_PER_RES: readonly [number, number, number] = [0.13, 0.12, 0.11];
/** which resident wealth shops at which CS tier: CUSTOMER_MIX[residentWealth][csTier] */
export const CUSTOMER_MIX: readonly (readonly [number, number, number])[] = [
  [0.8, 0.2, 0.0],
  [0.25, 0.6, 0.15],
  [0.05, 0.4, 0.55],
];
/** tourism CS jobs per unit of tourism score (landmarks, parks, airports…) */
export const TOURISM_CS_PER_POINT = 1;

/** office share of workforce: CO_SHARE_MIN at tiny pop → CO_SHARE_MAX at CO_SHARE_POP_FULL */
export const CO_SHARE_MIN = 0.1;
export const CO_SHARE_MAX = 0.36;
export const CO_SHARE_POP_START = 2000;
export const CO_SHARE_POP_FULL = 800_000;
/** CO$$$ fraction of office demand as a function of EQ: lerp(CO3_FRAC_MIN, CO3_FRAC_MAX, smoothstep(60,130,EQ)) */
export const CO3_FRAC_MIN = 0.15;
export const CO3_FRAC_MAX = 0.55;

/** industrial: basic (export) jobs from the region/world + workforce share */
export const I_BASE = 900;
/** industrial share of workforce: I_SHARE_MAX at tiny pop → I_SHARE_MIN at CO_SHARE_POP_FULL */
export const I_SHARE_MAX = 0.52;
export const I_SHARE_MIN = 0.36;
/** agriculture: flat regional demand + small per-resident part (farms are a niche) */
export const IA_BASE = 250;
export const IA_PER_RES = 0.004;
/** EQ → industry mix. dirty share falls with EQ, high-tech rises. */
export const ID_SHARE_AT_EQ0 = 0.7;
export const ID_SHARE_EQ_SLOPE = 1 / 160; // share drops by this per EQ point
export const ID_SHARE_MIN = 0.08;
export const IHT_EQ_START = 65; // IHT demand starts above this EQ
export const IHT_SHARE_PER_EQ = 1 / 150;
export const IHT_SHARE_MAX = 0.5;

/** neighbor connection factors (demand multipliers). conn = base + Σ per-connection weights (capped) */
export const CONN_BASE = { R: 0.85, C: 0.85, I: 0.85 };
export const CONN_WEIGHT: Record<number, { R: number; C: number; I: number }> = {
  [Network.Street]: { R: 0.05, C: 0.03, I: 0.05 },
  [Network.Road]: { R: 0.12, C: 0.1, I: 0.15 },
  [Network.OneWay]: { R: 0.08, C: 0.06, I: 0.1 },
  [Network.Avenue]: { R: 0.15, C: 0.14, I: 0.2 },
  [Network.Highway]: { R: 0.2, C: 0.2, I: 0.3 },
  [Network.Rail]: { R: 0.08, C: 0.05, I: 0.2 },
};
export const CONN_MAX = { R: 1.3, C: 1.35, I: 1.5 };
/** freight boosts to industrial target (multiplicative add): per freight station / seaport / airport, with max */
export const FREIGHT_BOOST: Record<string, number> = { tr_freight_station: 0.05, tr_seaport: 0.12, tr_airport_small: 0.03, tr_airport_large: 0.08 };
export const FREIGHT_BOOST_MAX = 0.3;

/** tax sensitivity per DevType: target × clamp(1 − sens × (rate − TAX_NEUTRAL)/TAX_NEUTRAL, TAX_FACTOR_MIN, TAX_FACTOR_MAX) */
export const TAX_NEUTRAL = 9;
export const TAX_SENS: readonly number[] = [0.35, 0.5, 0.8, 0.4, 0.5, 0.7, 0.55, 0.8, 0.3, 0.35, 0.45, 0.75];
export const TAX_FACTOR_MIN = 0.05;
export const TAX_FACTOR_MAX = 1.5;

/** unemployment above this pushes R down and C/I up */
export const UNEMP_NEUTRAL = 0.08;
export const UNEMP_R_PENALTY = 1.2; // R target × (1 − penalty × excess)
export const UNEMP_CI_BOOST = 0.8; // C/I target × (1 + boost × excess)
/** approval effect on R: target × (1 + APPROVAL_R × (approval − 50)/50) */
export const APPROVAL_R = 0.06;

/** demand normalisation: norm = NORM_MIN[family] + NORM_FRAC × max(current, target) */
export const DEMAND_NORM_MIN = { R: 900, C: 450, I: 450 };
export const DEMAND_NORM_FRAC = 0.12;
/** per-day EMA factor of the displayed demand and of the absolute demand used by growth */
export const DEMAND_EMA = 0.12;
export const DEMAND_ABS_EMA = 0.25;

// ============================================================================ DEMAND CAPS
/** base caps per DevType (no relief) — residents for R, jobs for C / I */
export const BASE_CAP: readonly number[] = [14000, 9000, 2500, 3000, 2500, 900, 2500, 900, 1500, 5000, 4000, 1200];
/** how family relief (CAP_RELIEF R/C/I in catalog) is distributed over sub-types (sums > 1 = flexible mix) */
export const CAP_WEIGHT: readonly number[] = [0.5, 0.42, 0.18, 0.22, 0.22, 0.12, 0.4, 0.26, 0.06, 0.35, 0.5, 0.3];
/** neighbor connection cap relief by network type */
export const CONN_CAP_RELIEF: Record<number, { R: number; C: number; I: number }> = {
  [Network.Street]: { R: 800, C: 400, I: 800 },
  [Network.Road]: { R: 2500, C: 1500, I: 3000 },
  [Network.OneWay]: { R: 1500, C: 1000, I: 2000 },
  [Network.Avenue]: { R: 4000, C: 3000, I: 8000 },
  [Network.Highway]: { R: 8000, C: 6000, I: 20000 },
  [Network.Rail]: { R: 3000, C: 2000, I: 12000 },
};
/** caps also grow with the city itself (agglomeration): + CAP_POP_FRAC × population per family */
export const CAP_POP_FRAC = { R: 0.12, C: 0.06, I: 0.04 };
/** softmin exponent (higher = sharper cap) */
export const CAP_SOFTMIN_K = 4;
/** a cap counts as "binding" (advisor + UI) when target > this × cap */
export const CAP_BINDING = 0.92;

// ============================================================================ GROWTH
/** per-day fraction of positive absolute demand that may start construction */
export const GROWTH_RESPONSE = 0.06;
/** always allow at least this much capacity per day when demand is positive */
export const GROWTH_MIN_ALLOW = { R: 25, C: 10, I: 10 };
/**
 * hard throughput cap per family (capacity started per day): base + frac × cap / sqrt(1 + cap / scale).
 * Growth slows relatively as the city grows (≈ 120%/yr max at 10k, 30% at 100k, 10% at 1M) — the realized
 * rate is lower (demand, caps, zoning, stage milestones). This is the main "pace of the game" knob.
 */
export const GROWTH_MAX_BASE = { R: 18, C: 7, I: 8 };
export const GROWTH_MAX_FRAC = 0.001;
export const GROWTH_MAX_SCALE = 25000;
/** growth attempts (candidate lots) per day: base + per 100 candidates, capped */
export const GROWTH_ATTEMPTS_BASE = 30;
export const GROWTH_ATTEMPTS_PER100 = 4;
export const GROWTH_ATTEMPTS_MAX = 260;
/** redevelopment checks per day (existing buildings considered for replacement by a higher stage) */
export const REDEVELOP_CHECKS = 24;
/** new building capacity must be ≥ this × replaced capacity */
export const REDEVELOP_MIN_GAIN = 1.6;
/** minimum age (days) before a growable may redevelop */
export const REDEVELOP_MIN_AGE = 240;
/** allowance is banked per DevType up to this many days of daily allowance (persisted in systemData.economy.carry) */
export const GROWTH_BANK_DAYS = 60;
/** a building may start when the bank covers this fraction of its capacity (the bank then goes negative) */
export const GROWTH_BANK_MIN_FRAC = 0.3;
/** a new building's capacity must be ≤ absolute demand × this (min GROWTH_OVERSHOOT_SLACK) — no towers on tiny demand */
export const GROWTH_SIZE_DEMAND = 1.2;
export const GROWTH_OVERSHOOT_SLACK = 60;
/** stage allowed by desirability: stage = 1 + floor(7 × clamp((des − D0)/(D1 − D0))) */
export const STAGE_DES_D0 = 0.02;
export const STAGE_DES_D1 = 0.8;
/** max stage by zone density (index = density 0..3) */
export const ZONE_MAX_STAGE: readonly number[] = [0, 3, 5, 8];
/** population milestones → max stage (SC4: towers need a big city) */
export const STAGE_POP: readonly { pop: number; stage: number }[] = [
  { pop: 0, stage: 3 },
  { pop: 3000, stage: 4 },
  { pop: 12000, stage: 5 },
  { pop: 35000, stage: 6 },
  { pop: 90000, stage: 7 },
  { pop: 220000, stage: 8 },
];
/** prefer the highest allowed stage: weight = exp(STAGE_PREF × (stage − maxStage)) */
export const STAGE_PREF = 1.1;
/** growth needs desirability above this for the DevType (else lot rejected) */
export const GROW_MIN_DESIR = -0.25;
/** max corner height difference (m) on a lot for growth: base + per lot cell side */
export const GROW_MAX_SLOPE = 5;
export const GROW_MAX_SLOPE_PER_CELL = 1.5;
/** construction days: base + per stage (+ random 0..CONSTRUCT_RAND) */
export const CONSTRUCT_DAYS_BASE = 8;
export const CONSTRUCT_DAYS_PER_STAGE = 4;
export const CONSTRUCT_RAND = 6;
/** a lot requires water when stage ≥ this or zone density ≥ 2 */
export const WATER_REQUIRED_STAGE = 3;

// ============================================================================ OCCUPANCY / HEALTH / ABANDONMENT
/** fraction of the gap to target occupancy closed per day */
export const FILL_RATE = 0.07;
/** building health smoothing per update */
export const HEALTH_SMOOTH = 0.35;
/** health penalties (subtracted from 0.5 + 0.5 × desirability) */
export const PENALTY_NO_POWER = 0.55;
export const PENALTY_NO_WATER = 0.4;
export const PENALTY_NO_ROAD = 0.6;
export const PENALTY_NO_GARBAGE = 0.12;
/** residential: health −= (0.5 − share of workers reaching a job) × this (traffic workerAccess) */
export const PENALTY_NO_JOB_ACCESS = 0.5;
/** unhappy (days) threshold for abandonment; health below this counts as unhappy */
export const ABANDON_DAYS = 150;
export const UNHAPPY_HEALTH = 0.22;
/** demand below this counts as unhappy (no reason to stay) — only together with health < UNHAPPY_DEMAND_HEALTH */
export const UNHAPPY_DEMAND = -0.55;
export const UNHAPPY_DEMAND_HEALTH = 0.45;
/** vacancy from negative demand: occupancy × clamp(1 + VACANCY_K × min(0, demand − VACANCY_START), VACANCY_MIN, 1) */
export const VACANCY_START = -0.25;
export const VACANCY_K = 0.3;
export const VACANCY_MIN = 0.6;
/** abandoned buildings recover when unhappy decays to 0 (decay = RECOVER_RATE × days while healthy) */
export const RECOVER_RATE = 2;
/** with the rubble-cleanup ordinance, burnt rubble is cleared after this many days */
export const RUBBLE_CLEAR_DAYS = 30;

// ============================================================================ LAND VALUE
export const LV = {
  base: 0.22,
  /** waterfront bonus at distance 0, fading to 0 at waterDist cells */
  waterfront: 0.26,
  waterDist: 8,
  /** view: elevation above local mean (m) mapped by smoothstep(viewH0, viewH1) */
  view: 0.1,
  viewH0: 4,
  viewH1: 35,
  /** services coverage (avg of police, fire, health, edu) */
  services: 0.14,
  parks: 0.12,
  transit: 0.04,
  /** commute accessibility: commuteScore − 0.5 */
  commute: 0.14,
  airPollution: 0.45,
  waterPollution: 0.2,
  garbage: 0.25,
  crime: 0.35,
  noise: 0.18,
  /** neighborhood wealth (avg wealth tier of nearby buildings, −1..1) */
  wealth: 0.1,
  /** temporal smoothing per band update and spatial 4-neighbour blend */
  temporal: 0.45,
  spatial: 0.35,
};

// ============================================================================ DESIRABILITY
/**
 * desirability[dev][i] = bias + Σ weight × term, clamped to [-1, 1]. Terms (all ~0..1):
 *  lv (landValue − lvRef), air, water, garbage, crime, noise (negatives), commute (score − 0.5),
 *  police, fire, health, edu, park, transit (coverage), traffic (adjacent road volume), popNear (customers),
 *  freight (freight access), slope penalty, tax shift.
 */
export interface DesirWeights {
  bias: number; lv: number; lvRef: number; air: number; water: number; garbage: number; crime: number; noise: number;
  commute: number; police: number; fire: number; health: number; edu: number; park: number; transit: number;
  traffic: number; popNear: number; freight: number; slope: number;
}
const W = (o: Partial<DesirWeights>): DesirWeights => ({
  bias: 0, lv: 0, lvRef: 0.25, air: 0, water: 0, garbage: 0, crime: 0, noise: 0, commute: 0, police: 0, fire: 0, health: 0, edu: 0,
  park: 0, transit: 0, traffic: 0, popNear: 0, freight: 0, slope: 0, ...o,
});
export const DESIR_WEIGHTS: readonly DesirWeights[] = [
  // R$: tolerant of pollution, likes transit & short commutes
  W({ bias: 0.1, lv: 0.35, lvRef: 0.1, air: -0.3, water: -0.2, garbage: -0.3, crime: -0.2, noise: -0.12, commute: 0.45, police: 0.08, fire: 0.08, health: 0.14, edu: 0.08, park: 0.12, transit: 0.18, slope: -0.3 }),
  // R$$
  W({ bias: 0.0, lv: 0.7, lvRef: 0.25, air: -0.75, water: -0.3, garbage: -0.4, crime: -0.55, noise: -0.28, commute: 0.5, police: 0.16, fire: 0.12, health: 0.16, edu: 0.22, park: 0.24, transit: 0.08, slope: -0.3 }),
  // R$$$: needs high land value, low crime, parks, schools
  W({ bias: -0.1, lv: 1.1, lvRef: 0.42, air: -1.1, water: -0.4, garbage: -0.6, crime: -1.0, noise: -0.45, commute: 0.4, police: 0.22, fire: 0.12, health: 0.2, edu: 0.3, park: 0.36, slope: -0.2 }),
  // CS$: likes traffic & customers
  W({ bias: 0.1, lv: 0.25, lvRef: 0.1, air: -0.2, garbage: -0.2, crime: -0.3, commute: 0.2, traffic: 0.35, popNear: 0.4, police: 0.06, fire: 0.06, slope: -0.4 }),
  // CS$$
  W({ bias: 0.05, lv: 0.45, lvRef: 0.22, air: -0.3, garbage: -0.25, crime: -0.45, commute: 0.2, traffic: 0.35, popNear: 0.4, police: 0.1, fire: 0.08, park: 0.05, slope: -0.4 }),
  // CS$$$
  W({ bias: -0.05, lv: 0.8, lvRef: 0.4, air: -0.5, garbage: -0.35, crime: -0.7, noise: -0.1, commute: 0.2, traffic: 0.28, popNear: 0.35, police: 0.14, fire: 0.08, park: 0.1, slope: -0.4 }),
  // CO$$: commute + some EQ
  W({ bias: 0.05, lv: 0.55, lvRef: 0.25, air: -0.4, garbage: -0.25, crime: -0.5, commute: 0.6, edu: 0.2, traffic: 0.1, transit: 0.12, police: 0.1, fire: 0.1, slope: -0.4 }),
  // CO$$$: land value, EQ, short commute
  W({ bias: -0.05, lv: 0.9, lvRef: 0.42, air: -0.6, garbage: -0.3, crime: -0.7, noise: -0.1, commute: 0.7, edu: 0.3, transit: 0.18, traffic: 0.08, police: 0.12, fire: 0.1, slope: -0.4 }),
  // I-Ag: flat cheap land, hurt by pollution
  W({ bias: 0.42, lv: -0.3, lvRef: 0.2, air: -0.6, water: -0.6, garbage: -0.3, crime: -0.1, commute: 0.1, slope: -0.9 }),
  // I-D: tolerates pollution, likes freight, cheap land
  W({ bias: 0.25, lv: -0.15, lvRef: 0.2, crime: -0.2, commute: 0.2, freight: 0.35, fire: 0.08, slope: -0.5 }),
  // I-M: needs freight access
  W({ bias: 0.15, lv: 0.05, lvRef: 0.2, air: -0.1, crime: -0.3, commute: 0.3, freight: 0.55, fire: 0.1, police: 0.06, slope: -0.5 }),
  // I-HT: EQ + clean air
  W({ bias: 0.0, lv: 0.45, lvRef: 0.3, air: -0.8, water: -0.3, garbage: -0.3, crime: -0.4, noise: -0.1, commute: 0.4, edu: 0.4, freight: 0.15, police: 0.08, fire: 0.08, slope: -0.4 }),
];
/** tax shift on desirability per point above neutral (× TAX_SENS[dev]) */
export const DESIR_TAX = 0.02;
/** commute (minutes) → score 1 at ≤ COMMUTE_GOOD, 0 at ≥ COMMUTE_BAD */
export const COMMUTE_GOOD = 12;
export const COMMUTE_BAD = 80;
/** commute assumed when the traffic system is absent */
export const COMMUTE_FALLBACK = 25;
/** coverage assumed when the services system is absent */
export const COVERAGE_FALLBACK = 0.45;
/** adjacent road volume (trips/day) that counts as "busy" for commercial */
export const TRAFFIC_BUSY = 1800;
/** customers within the coarse neighbourhood at which popNear saturates */
export const POP_NEAR_FULL = 6000;
/** slope penalty smoothstep (m) */
export const SLOPE_P0 = 2;
export const SLOPE_P1 = 12;
/** coarse grid block size (cells) for neighbourhood population / freight access */
export const COARSE = 8;
/** freight access falls to 0 at this many coarse blocks from a freight source (highway, rail, freight station, port, edge connection) */
export const FREIGHT_BLOCKS = 7;

// ============================================================================ EQ / HQ
/** EQ target = EQ_BASE + EQ_SPAN × pop-weighted education coverage × edu effect; moves EQ_RATE of the gap per month */
export const EQ_BASE = 22;
export const EQ_SPAN = 120;
export const EQ_RATE = 0.06;
export const HQ_BASE = 25;
export const HQ_SPAN = 115;
export const HQ_RATE = 0.08;

// ============================================================================ BUDGET
/** monthly residential tax per resident per 1% rate */
export const TAX_PER_RES: readonly [number, number, number] = [0.018, 0.034, 0.066];
/** monthly tax per filled job per 1% rate (index = DevType; R entries unused) */
export const TAX_PER_JOB: readonly number[] = [0, 0, 0, 0.022, 0.03, 0.042, 0.034, 0.05, 0.012, 0.022, 0.03, 0.05];
/** difficulty multiplier on tax income */
export const DIFFICULTY_INCOME: Record<string, number> = { easy: 1.2, medium: 1.0, hard: 0.85, sandbox: 1.0 };
/** network maintenance $ per cell per month (× roads funding for road types, × transit funding for rail/subway) */
export const NETWORK_UPKEEP: Record<number, number> = {
  [Network.Street]: 0.2,
  [Network.Road]: 0.4,
  [Network.OneWay]: 0.45,
  [Network.Avenue]: 0.8,
  [Network.Highway]: 2.0,
  [Network.Rail]: 0.5,
};
export const BRIDGE_UPKEEP_MUL = 5;
export const POWERLINE_UPKEEP = 0.1;
export const SUBWAY_UPKEEP = 1.2;
/** landfill upkeep per cell per month */
export const LANDFILL_UPKEEP = 1;
/** power / water plant upkeep = upkeep × (UTIL_FIXED + (1 − UTIL_FIXED) × utilisation) — fuel scales with output */
export const UTIL_FIXED = 0.35;
/** funding below this → strike risk (services stop working) */
export const STRIKE_FUNDING = 50;
/** months of negative funds before the bankruptcy warning escalates / the game-over state */
export const BANKRUPT_WARN_MONTHS = [1, 3, 6];
export const BANKRUPT_MONTHS = 12;

// ============================================================================ LOANS
export const LOAN_TERM_MONTHS = 120;
export const LOAN_RATE_MIN = 0.05;
export const LOAN_RATE_MAX = 0.1;
/** +rate per existing loan, + when funds are negative */
export const LOAN_RATE_PER_LOAN = 0.01;
export const LOAN_RATE_NEG_FUNDS = 0.015;
/** max outstanding principal = LOAN_MAX_BASE + LOAN_MAX_PER_CAPITA × population */
export const LOAN_MAX_BASE = 60_000;
export const LOAN_MAX_PER_CAPITA = 25;
export const LOAN_MAX_COUNT = 5;
export const LOAN_MIN = 5_000;

// ============================================================================ ACTION COSTS
export interface NetworkInfo { name: string; cost: number; maxSlope: number; bridge: boolean; rank: number }
/** per-cell build cost, max height delta (m) between consecutive cells, bridgeable, upgrade rank */
export const NETWORK_INFO: Record<number, NetworkInfo> = {
  [Network.Street]: { name: 'Street', cost: 10, maxSlope: 7, bridge: false, rank: 1 },
  [Network.Road]: { name: 'Road', cost: 20, maxSlope: 6, bridge: true, rank: 2 },
  [Network.OneWay]: { name: 'One-way Road', cost: 25, maxSlope: 6, bridge: true, rank: 2 },
  [Network.Avenue]: { name: 'Avenue', cost: 40, maxSlope: 5, bridge: true, rank: 3 },
  [Network.Highway]: { name: 'Highway', cost: 120, maxSlope: 4.5, bridge: true, rank: 4 },
  [Network.Rail]: { name: 'Rail', cost: 30, maxSlope: 3, bridge: true, rank: 1 },
};
export const BRIDGE_COST_MUL = 10;
export const MAX_BRIDGE_SPAN = 12;
export const POWERLINE_COST = 5;
export const POWERLINE_WATER_MUL = 4;
export const POWERLINE_MAX_SPAN = 12;
export const SUBWAY_COST = 100;
/** bulldoze refunds / fees */
export const NETWORK_REFUND = 0.25;
export const DEMOLISH_FEE_BASE = 5;
export const DEMOLISH_FEE_PER_CELL_STAGE = 3;
export const RUBBLE_FEE_PER_CELL = 5;
export const TREE_CLEAR_COST = 2;
export const TREE_PLANT_COST = 3;
/** zoning cost per cell (index = Zone) */
export const ZONE_COST: readonly number[] = [0, 5, 10, 20, 5, 10, 20, 2, 10, 20, 15];
/** plop: max corner height difference (m) over the footprint (it is leveled) */
export const PLOP_MAX_SLOPE = 14;
/** terraform cost per m³ moved */
export const TERRAFORM_COST_M3 = 0.02;
export const TERRAFORM_MIN_H = -40;
export const TERRAFORM_MAX_H = 250;

// ============================================================================ APPROVAL
export const APPROVAL = {
  base: 55,
  /** per point of (R-weighted) tax above neutral */
  taxPerPoint: -3.5,
  /** per point below neutral */
  taxLowPerPoint: 1.5,
  services: 22, // × (avg coverage at homes − 0.4)
  pollution: -30,
  crime: -35,
  commute: -0.25, // per minute above 30
  unemployment: -70,
  parks: 10, // × (park coverage at homes − 0.3)
  strike: -8,
  deficit: -6,
  ema: 0.3,
};

// ============================================================================ helpers
export const ZONE_FAMILY_OF: readonly (('R' | 'C' | 'I' | null))[] = [null, 'R', 'R', 'R', 'C', 'C', 'C', 'I', 'I', 'I', null];
export function isGrowZone(z: number): boolean {
  return z >= Zone.ResLow && z <= Zone.IndHigh;
}
