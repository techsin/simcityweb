/**
 * Pollution system: garbage, air (smoke), noise, water, soil. One pass every POLL_PERIOD days, run by the InfraScheduler
 * in 10 small steps (each <= ~2.5 estimated ms on 256²; see stepCost):
 *   0 garbage sources   production per building, facilities (incinerator / recycling / landfill regions with road access)
 *   1 garbage routes    truck-range BFS (GARBAGE_TRUCK_RANGE road cells) from facilities, capacity allocation
 *                       (recycling -> incineration -> landfill), incinerator burn shares, landfill dumping
 *   2 garbage apply     uncollected piles build up / collected piles clear, BF.NoGarbage, landfill fill (stock)
 *   3 building sources  (stageA) every emitter: plants by load, incinerator by burn share, industry, heating, shops,
 *                       nightlife, construction, fires, sewage, emergency spills (WP8 hook), parks, soil sources
 *   4 cell sources      traffic by network type (tunnels / bridges / crossings / congestion / freight rail), landfill
 *                       cells by use and size, garbage smell, soil leaching, treeCover (published) + park buffer
 *   5 air near          small / medium emitters (half resolution blur)
 *   6 air far + wind    large emitters (quarter resolution), prevailing-wind plume (wind.ts), saturation, tree absorption
 *   7 noise             blur, saturation, tree / park buffers and tree belts between the noise and a cell (F4: a
 *                       belt two cells deep beside a busy road shields the homes behind it; noiseBuffer)
 *   8 water             (stageB) ground water blur, diffusion along water bodies, bank coupling (polluted rivers
 *                       contaminate their banks and the pumps drawing from them)
 *   9 flags + stats     soil stock update, BF.Polluted (R / C only), BF.Noisy (R), stats.avg*
 *
 *  Source model: catalog def.pollution.{air,water,noise} = intensity on the 0..1 overlay scale at the source with a
 *  falloff radius (negative = cleaning, e.g. water treatment). Converted to a source strength S = -K ln(1 - I) /
 *  POLL_PEAK_GAIN so an isolated emitter peaks at ~I; emitters are bucketed by radius into blur classes
 *  (air: full / half / quarter resolution, sigma ~2.4 / 4.9 / 9.8 cells; water & noise: half / quarter) and
 *  sources add up (industrial districts saturate). Growables scale with activity (0.3 + 0.7 x occupancy); power plants
 *  with their grid load (0.25 + 0.75 x UtilitiesSystem.plantLoad); the incinerator with its burn share.
 *  Defs without explicit pollution fall back to per-job emission by industry type (AIR_PER_JOB ...).
 *  Ordinances: 'pollution.air' (x 'pollution.air.industry' for industry & plants, x 'pollution.air.power' for plants),
 *  'pollution.water' (x '.industry'), 'pollution.sewage', 'pollution.noise' (C / I / construction),
 *  'pollution.noise.traffic', 'garbage.produced', 'soil.decay'.
 *  GARBAGE: production = def.pollution.garbage (t/month at full occupancy) x activity x 'garbage.produced'. A building
 *  is collected only if road-reachable within GARBAGE_TRUCK_RANGE of a facility and capacity remains (nearest first);
 *  garbageInfo says why not ('capacity', 'range', or 'noRoad' when no road touches the building at all).
 *  Recycling diverts up to RECYCLE_MAX_SHARE, incinerators burn (power output = def MW x burn share, read by utilities),
 *  landfills take the rest and FILL UP (state.landfillFill, LANDFILL_CELL_STOCK t per cell, cells fill in order; a
 *  full cell has no capacity). Unpowered facilities work at GARBAGE_UNPOWERED. state.garbage = uncollected piles on
 *  building cells (smell + crime) and, on landfill cells, a display level (0.35 + 0.3 use + 0.35 fill).
 *  SOIL (stock, saved): industry / landfill / toxic sources contaminate, slow decay; leaches into ground water. A closed
 *  landfill leaves brownfield soil (once, when the cell stops being landfill); its fill stays with the land, so zoning
 *  it again gives no fresh capacity, until a building occupies the cell.
 *  Emits layerUpdated('pollution') after the flags step.
 *
 *  B2 (docs/dev/B2_DESIGN.md §6): each of the ten steps runs as a sequence of small pieces (one scheduler step each, about
 *  half INFRA_PIECE_COLD_MS estimated warm ms, the cell work a quarter): the building stages over chunks of one building
 *  snapshot per pass, the
 *  cell and blur work as small field programs run in row ranges (blur.ts Blur3Run / downsampleRows / upsampleAddRows),
 *  every saved layer built in a private buffer and published by one .set(), the flags from candidate lists applied in one
 *  piece. A pass whose pieces run with nothing in between computes exactly what the pre-B2 steps computed.
 */
import { DevType, Network, Zone, isRoad } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import { Blur3Run, BoxVRun, blurSigma2, boxAverage, boxHRows, downsampleRows, upsampleAddRows } from './blur';
import {
  BuildingSnapshot, DX, DZ, Fam, activeJobs, detectJobsUnknown, ensureIdArray, ensureIdFloat, fundingFactor, infoOf, isFunctional, nowMs,
  readEffects, setFlagQuiet, activity, type DefInfo, type OrdEffects, buildingList, wealthOf,
} from './common';
import { getDef } from '../catalog';
import { ordinanceEffect } from '../economy/ordinances';
import { pieceBudgetUs, pieceUnits, schedulerOf } from './scheduler';
import { windVector, type WindVector } from './wind';
import { emergencyPollution } from './emergency';
import type { UtilitiesSystem } from './utilities';
import {
  AIR_K, AIR_PER_CS_JOB, AIR_PER_JOB, AIR_PER_TRIP, BANK_COUPLING, BANK_DIST, BRIDGE_NOISE, BROWNFIELD_BASE, BROWNFIELD_FILL,
  CONSTRUCTION_AIR, CONSTRUCTION_NOISE, FIRE_SMOKE, GARBAGE_BUILDUP_RATE, GARBAGE_DECAY, GARBAGE_PER_CIVIC_JOB,
  GARBAGE_NEWS_DAYS, GARBAGE_PER_JOB_C, GARBAGE_PER_JOB_I, GARBAGE_PER_RES, GARBAGE_SMELL, GARBAGE_TRUCK_RANGE, GARBAGE_UNPOWERED,
  HEAT_AIR_PER_RES, HEAT_CLIMATE, HEAT_WEALTH, INCIN_IDLE_ACT, INFRA_BLD_SIZING_US, INFRA_CELL_SIZING_US, INFRA_PIECE_COLD_MS, LANDFILL_AIR, LANDFILL_CELL_CAP, LANDFILL_CELL_STOCK,
  LANDFILL_IDLE_EMIT, LANDFILL_SIZE_REF, LANDFILL_WARN_FILL, NET_BASE_NOISE, NOISE_CONG_DAMP, NOISE_CROSSING, NOISE_FREIGHT_RAIL, NOISE_K,
  NOISE_NIGHTLIFE, NOISE_PER_JOB, NOISE_PER_TRIP, NOISE_PER_TRIP_NET, NOISY_THRESHOLD, NO_GARBAGE_THRESHOLD,
  PARK_NOISE_ABSORB, PLANT_IDLE_ACT, POLLUTED_THRESHOLD, POLL_PEAK_GAIN, POLL_RADII, POLL_SMOOTH, RECYCLE_MAX_SHARE,
  SEWAGE_PER_RES, SOIL_DECAY, SOIL_GROUNDWATER, SOIL_RATE, SOIL_SRC_IND, SOIL_SRC_LANDFILL, SOIL_SRC_PLOPPED,
  TREATMENT_DEFAULT_CAP, TREATMENT_RES_PER_KL, TREE_AIR_ABSORB, TREE_BELT_ABSORB, TREE_BELT_CELLS, TREE_BELT_REACH,
  TREE_COVER_RADIUS, TREE_NOISE_ABSORB, TUNNEL_AIR,
  TUNNEL_NOISE, WATER_K, WATER_POLL_PER_JOB, WIND_DRIFT_FAR, WIND_DRIFT_PREVAIL,
} from './params';

/** 1 - exp(-x) lookup table on [0, 16) (x beyond -> 1) */
const SAT_N = 4096, SAT_MAX = 16;
const SAT = new Float32Array(SAT_N + 1);
for (let i = 0; i <= SAT_N; i++) SAT[i] = 1 - Math.exp(-(i / SAT_N) * SAT_MAX);
/**
 * L[i] += (sat(field[i] * invK) x buffer(i) - L[i]) * alpha for i in [i0, i1), skipping cells where mask[i] != 0;
 * buffer(i) = 1 - k1 buf1[i] - k2 buf2[i] (trees / parks absorb after saturation; null = none). Cells are independent:
 * ranges that cover [0, C) once give the whole pass (B2: pre-B2's saturate(…, C, …) = saturateRange(…, 0, C, …)).
 */
function saturateRange(field: Float32Array, L: Float32Array, i0: number, i1: number, invK: number, alpha: number, mask: Uint8Array | null,
  buf1: Float32Array | null = null, k1 = 0, buf2: Float32Array | null = null, k2 = 0): void {
  const scale = (invK * SAT_N) / SAT_MAX;
  for (let i = i0; i < i1; i++) {
    if (mask !== null && mask[i] !== 0) continue;
    const f = field[i];
    let t = 0;
    if (f > 0) {
      const u = f * scale;
      if (u >= SAT_N) t = 1;
      else { const k = u | 0; const a = SAT[k]; t = a + (SAT[k + 1] - a) * (u - k); }
      if (buf1 !== null) {
        let m = 1 - k1 * buf1[i];
        if (buf2 !== null) m -= k2 * buf2[i];
        t *= m > 0 ? m : 0;
      }
    }
    L[i] += (t - L[i]) * alpha;
  }
}

/**
 * per-cell source strength of an AREA source whose uniform district level is L: a uniform field s of class-0 sources
 * blurs to s x (peak gain x 2 pi sigma^2, sigma^2 = 8), so s = -K ln(1 - L) / that gain
 */
function areaSource(L: number, K: number): number {
  return (-Math.log(1 - Math.min(0.95, L)) * K) / (POLL_PEAK_GAIN * 2 * Math.PI * 8);
}

/** source strength per unit of intensity: peak field for intensity I is -K ln(1 - I) (layer = 1 - exp(-f/K)) */
function srcScale(K: number): number {
  return K / POLL_PEAK_GAIN;
}
/** catalog intensity (0..1 at the source, negative = cleaning) -> source strength for the blur model */
function intensityToSource(I: number, scale: number): number {
  if (I === 0) return 0;
  const a = Math.min(0.95, Math.abs(I));
  const v = -Math.log(1 - a) * scale;
  return I < 0 ? -v : v;
}

const IND_KEYS = ['IA', 'ID', 'IM', 'IHT'] as const;
/** share kept per diffusion iteration along water bodies (higher = spreads farther downstream) */
const WATER_DIFFUSE_KEEP = 0.975;
/** days between pollution updates */
export const POLL_PERIOD = 12;
/** steps of one pass */
const S_GARB_SRC = 0, S_GARB_ROUTE = 1, S_GARB_APPLY = 2, S_SRC_BLD = 3, S_SRC_CELLS = 4, S_AIR_NEAR = 5, S_AIR_FAR = 6,
  S_NOISE = 7, S_WATER = 8, S_FLAGS = 9;
const LAST_STEP = S_FLAGS;
/** garbage facility kinds */
const FK_OTHER = 0, FK_INCIN = 1, FK_RECYCLE = 2;

// ---- B2 pieces (docs/dev/B2_DESIGN.md §6): the sub-states of each state (S_*). A stage's field work runs as a small
// program of field operations (OP_*), executed in row / unit ranges by opsPiece().
// garbSrc: the pass start, the snapshot, its chunk plan, the building chunks, the landfill scan setup, the scan (cell
// ranges; one region's flood fill inside one piece), the tail (publish: regions, caps, summary, the brownfield writes)
const GS_START = 0, GS_SNAP = 1, GS_PLAN = 2, GS_BLD = 3, GS_LF0 = 4, GS_LF = 5, GS_END = 6;
// garbRoute: stamps + seed signature, the road checksum (cell ranges), the signature check / BFS start, the BFS (queue
// chunks), the perimeter distances (building chunks), the counting sort's prefix, its scatter (building chunks), the
// nearest-first allocation (order ranges), the publish (shares, region use, summary, stats)
const GR_START = 0, GR_SUM = 1, GR_CHECK = 2, GR_BFS = 3, GR_BLD = 4, GR_SORT = 5, GR_SCAT = 6, GR_ALLOC = 7, GR_PUB = 8;
// garbApply: the private copy, the building chunks, the landfill fill + display (one piece: st.landfillFill), the
// leftover decay (cell ranges), the publish (st.garbage, flags, summary), the events
const GA_START = 0, GA_BLD = 1, GA_LF = 2, GA_LEFT = 3, GA_PUB = 4, GA_EV = 5;
// srcBld (stageA): the clears (field ops), the setup, the building chunks, the end (park signature, emergency spills)
const SB_FILL = 0, SB_SETUP = 1, SB_BLD = 2, SB_END = 3;
// srcCells: the cell loop (field op), traffic's pending attachment refresh, freight rail + landfill cells, the tree
// cover and the park buffer (field ops)
const SC_CELLS = 0, SC_ATTACH = 1, SC_FREIGHT = 2, SC_TREES = 3;
// air near / air far / noise: one program each (OPS); water: the blur, clean and ground program, the water list (when
// invalid), the diffusion program; flags: the soil program (when dt > 0), the building chunks, the publish, the events
const ST_OPS = 0;
const WA_OPS = 0, WA_LIST = 1, WA_DIFF = 2;
const FL_SOIL = 0, FL_BLD = 1, FL_PUB = 2, FL_EV = 3;
// the water list builder (ensureWaterList in pieces): numbering, the cell lists, the bank seeds, the bank BFS, install
const WL_IDX = 0, WL_NB = 1, WL_SEED = 2, WL_BFS = 3;

// field operations (FieldOp.kind): native fill / copy (one unit), blurDown's downsample (fine rows), blur3 (rows of its
// six half passes), the near-air accumulation (coarse rows), upsampleAdd (fine rows), saturate (rows), box rows (H / V),
// and the stage loops: srcCells' cell loop, the tree field, the tree-near count, noiseBuffer, the water cleaning, the
// diffusion's init / sweep / copy / write-back (water cells), land, banks (bank cells), the garbage leftovers, the soil
const OP_FILL = 0, OP_COPY = 1, OP_DOWN = 2, OP_BLUR = 3, OP_ACC = 4, OP_UP = 5, OP_SAT = 6, OP_BOXH = 7, OP_BOXV = 8,
  OP_CELLS = 9, OP_TREES = 10, OP_COUNT = 11, OP_NOISEBUF = 12, OP_CLEAN = 13, OP_WINIT = 14, OP_WDIFF = 15, OP_WCOPY = 16,
  OP_WBACK = 17, OP_LAND = 18, OP_BANK = 19, OP_LEFT = 20, OP_SOIL = 21;
const OP_NAMES = ['fill', 'copy', 'down', 'blur', 'acc', 'up', 'sat', 'boxH', 'boxV', 'cells', 'trees', 'count', 'noiseBuf', 'clean',
  'wInit', 'wDiff', 'wCopy', 'wBack', 'land', 'bank', 'left', 'soil'];
const EMPTY_F32 = new Float32Array(0);

/** B2: one field operation of a stage program (every field set by PollutionSystem.addOp; one shape) */
class FieldOp {
  kind = 0;
  /** work units (rows, cells or list entries) in total; estimated warm µs per unit; sizing µs per unit (cold floor) */
  units = 0;
  us = 0;
  size = 1;
  a: Float32Array = EMPTY_F32;
  b: Float32Array = EMPTY_F32;
  c: Float32Array | null = null;
  d: Float32Array | null = null;
  mask: Uint8Array | null = null;
  /** grid size, factor, radius, gain, shift, the saturate scale / smoothing / buffer weights */
  n = 0;
  f = 1;
  r = 0;
  g = 0;
  dx = 0;
  dz = 0;
  k1 = 0;
  k2 = 0;
}

/**
 * B2 piece budget (design R2): every pollution loop runs once per pass (every POLL_PERIOD days), so it runs cold for many
 * passes after a load (design review 2: pollution's garbApply at up to 24 x, airFar's saturate at 22 x in days 0-20) — half
 * INFRA_PIECE_COLD_MS, like traffic's and services' once-per-pass loops (G1 / G2), with G2's cold cell and Building floors
 * (params INFRA_CELL_SIZING_US / INFRA_BLD_SIZING_US). A whole-layer native fill or copy fits that budget at 256².
 */
const COLD = INFRA_PIECE_COLD_MS / 2;
/**
 * the budget of the cell work (the field programs, the landfill scan, the road checksum, the allocation, the BFS queues):
 * a quarter of INFRA_PIECE_COLD_MS (G3 dense1m from load: on a pass's first executions after a load these loops ran at
 * ~150-300 ns per cell, 30-70 x warm, so a piece at the cold cell floor's ~16,000 cells took 2-5 ms; at ~8,000 about
 * half). With the cold cell floor: about 8,000 cells per piece.
 */
const CELL = INFRA_PIECE_COLD_MS / 4;
/**
 * the absolute scale of the estimates: stepCost = PL_EST x (PC.piece + the piece's units x PC) / 1000. PC sets the relative
 * costs, so (with the budget) the chunk sizes; PL_EST makes the estimate honest warm wall ms without moving a chunk
 * (traffic's TR_EST / services' SV_EST pattern).
 */
const PL_EST = 1;
/**
 * B2 cost model (design §9): estimated warm wall µs per work unit of each kind of piece. Start values: the pollution
 * mapping's in-schedule fits (dense1m / bot256 / vet cities, design §9.2), split over the pieces. G3 refit (dense1m --warm
 * 300 --days 120, the median est / wall per piece label) of the coefficients that size no piece: piece 3 -> 1.5, the
 * pass start (+ one buildingList rebuild per building), the snapshot copy, the building stages (gsB / gsF, grB / grF,
 * scatB, gaB / gaF, sbB / sbF, flB), the downsample (below the cold cell floor). The chunk plan has its own constants
 * (PLAN_B / PLAN_F); fills, copies and the row ops above the floor keep their start values (they size the programs).
 */
const PC = {
  /** per piece (dispatch, cursors) */
  piece: 1.5,
  /** fixed parts: a stage start / setup / end, the garbage publish, the incinerator shares per facility */
  start: 15, setup: 10, end: 5, pub: 10, fac: 0.3,
  /** native fills / copies per cell */
  fill: 0.0004, copy: 0.0004,
  /** the pass start's buildingList rebuild (per building: the first call of the day), the snapshot copy (per building)
   *  and its chunk plan (per building) */
  listB: 0.013, snapTake: 0.009, plan: 0.012,
  /** per building / footprint cell: garbage sources, routes (perimeter), the scatter, apply, sources (stageA), flags */
  gsB: 0.004, gsF: 0.0025, grB: 0.01, grF: 0.002, scatB: 0.002, gaB: 0.012, gaF: 0.006, sbB: 0.008, sbF: 0.026, flB: 0.018, flF: 0.004,
  /** the landfill scan per cell (+ per flooded cell), the seed signature per seed, the road checksum per cell, the BFS per
   *  queue cell, the allocation per order entry, the landfill fill + display per landfill cell, the leftovers per cell */
  lfScan: 0.003, lfFlood: 0.03, seed: 0.002, netSum: 0.00185, bfs: 0.014, alloc: 0.004, lfCell: 0.03, left: 0.0029,
  /** srcCells: the cell loop per cell, freight rail per cell, the landfill emission per landfill cell */
  cells: 0.0076, freight: 0.01,
  /** blurDown's downsample per fine cell, blur3 per coarse cell of a half pass, the accumulation per coarse cell,
   *  upsampleAdd per fine cell, saturate per cell, a box half pass per cell, the tree field / count per cell */
  down: 0.0025, box: 0.0023, acc: 0.0012, up: 0.005, sat: 0.0068, trees: 0.0015, count: 0.001,
  /** noiseBuffer per cell + per cell with a tree within reach (the belt walk) */
  noiseBuf: 0.004, walk: 0.031,
  /** water: the cleaning per cell, the list (numbering per cell, the lists per water cell, the bank BFS per queue cell),
   *  the diffusion per water cell and sweep, its copies, land per cell, the banks per bank cell */
  clean: 0.002, wlIdx: 0.002, wlNb: 0.01, wlBfs: 0.03, diff: 0.008, wcopy: 0.001, land: 0.0015, bank: 0.003,
  /** the soil stock per cell; the flags publish per candidate; per event */
  soil: 0.0032, apply: 0.05, event: 0.4,
} as const;
/** the chunk plan of the pass snapshot: the cold Building floor per building + the costliest per-footprint-cell loop's start
 *  fit (stageA, 41 ns; sizing only — the estimates use each stage's own coefficients) */
const PLAN_B = INFRA_BLD_SIZING_US, PLAN_F = 0.041;
// ---- B2: the field programs' stage loops, one small function each (R10), each over a range of today's loop
/** acc[m] += coarse[m] * g for m in [m0, m1) (stageAirNear's accumulation) */
function accRows(acc: Float32Array, coarse: Float32Array, g: number, m0: number, m1: number): void {
  for (let m = m0; m < m1; m++) acc[m] += coarse[m] * g;
}
/** t[i] = trees[i] * 0.25 (updateTreeCover's tree field) */
function treeRows(t: Float32Array, trees: Uint8Array, i0: number, i1: number): void {
  for (let i = i0; i < i1; i++) t[i] = trees[i] * 0.25;
}
/** the count of cells with near[i] > 0, added to n */
function countNear(near: Float32Array, n: number, i0: number, i1: number): number {
  for (let i = i0; i < i1; i++) if (near[i] > 0) n++;
  return n;
}
/** negative sources (treatment plants) also clean nearby water bodies (stageB's cleaning, on the private layer L) */
function cleanRows(wm: Uint8Array, tmp: Float32Array, L: Float32Array, i0: number, i1: number): void {
  for (let i = i0; i < i1; i++) if (wm[i] && tmp[i] < 0) L[i] = Math.max(0, L[i] + tmp[i] * 0.05);
}
/** cur[q] = L[wc[q]] (the diffusion's init) */
function gatherRange(cur: Float32Array, L: Float32Array, wc: Int32Array, q0: number, q1: number): void {
  for (let q = q0; q < q1; q++) cur[q] = L[wc[q]];
}
/** L[wc[q]] = cur[q] (the diffusion's write-back) */
function scatterRange(L: Float32Array, cur: Float32Array, wc: Int32Array, q0: number, q1: number): void {
  for (let q = q0; q < q1; q++) L[wc[q]] = cur[q];
}
/** land = ground water (stageB, before the banks) */
function landRows(wm: Uint8Array, L: Float32Array, ground: Float32Array, i0: number, i1: number): void {
  for (let i = i0; i < i1; i++) if (!wm[i]) L[i] = ground[i];
}
/** land raised on the banks of polluted water bodies */
function bankRange(L: Float32Array, bank: Int32Array, src: Int32Array, k0: number, k1: number): void {
  for (let k = k0; k < k1; k++) {
    const v = BANK_COUPLING * L[src[k]];
    const i = bank[k];
    if (v > L[i]) L[i] = v;
  }
}
/** other cells (roads, empty lots, demolished buildings): leftovers blow away (garbageApply, on the private layer G) */
function leftRows(bld: Int32Array, lab: Int32Array, G: Float32Array, i0: number, i1: number): void {
  for (let i = i0; i < i1; i++) if (bld[i] < 0 && lab[i] < 0 && G[i] !== 0) G[i] *= 0.5;
}

/** cells of one piece of a once-per-pass cell loop costing `us` per cell (the cold cell floor) */
function cellUnits(us: number, budget = CELL): number {
  return pieceUnits(us > INFRA_CELL_SIZING_US ? us : INFRA_CELL_SIZING_US, 1, budget);
}
/** the traffic system's attachment refresh (a lazy cache freightRailCells triggers) */
interface AttachProbe { attachRefreshMs?(st: CityState): number; stopAttached?(id: number): boolean }

/** WP3 ordinance keys (sim-core ordinanceEffect; multiplicative, default 1) */
interface Wp3Effects { airPower: number; sewage: number; noise: number; noiseTraffic: number; soilDecay: number }
function effect(st: CityState, key: string): number {
  try {
    const v = ordinanceEffect(st, key);
    return typeof v === 'number' && isFinite(v) && v >= 0 ? v : 1;
  } catch {
    return 1;
  }
}
function wp3Effects(st: CityState): Wp3Effects {
  return {
    airPower: effect(st, 'pollution.air.power'),
    sewage: effect(st, 'pollution.sewage'),
    noise: effect(st, 'pollution.noise'),
    noiseTraffic: effect(st, 'pollution.noise.traffic'),
    soilDecay: effect(st, 'soil.decay'),
  };
}

export interface GarbageInfo {
  /** tons / month produced */
  producedT: number;
  collected: boolean;
  /** uncollected pile level 0..1 (max over the footprint) */
  level: number;
  /**
   * why not collected: no capacity left, beyond garbage-truck range of every facility (or on a road network without
   * one), or no road on the building's edge at all (trucks cannot stop there)
   */
  reason?: 'capacity' | 'range' | 'noRoad';
}
export interface LandfillInfo {
  /** landfill cells in this connected landfill */
  cells: number;
  /** mean fill 0..1 */
  fill: number;
  /** tons / month it can take now (cells not full x per-cell capacity x funding) and tons / month dumped */
  capacityT: number;
  usedT: number;
  /** false = no road on its edge: garbage trucks cannot reach it */
  road: boolean;
}
export interface GarbageSummary {
  producedT: number;
  collectedT: number;
  recycledT: number;
  burnedT: number;
  landfilledT: number;
  /** produced by buildings beyond truck range / beyond capacity (t / month) */
  outOfRangeT: number;
  overCapacityT: number;
  outOfRangeBuildings: number;
  /** buildings (and their t / month) with no road on their edge: trucks cannot collect whatever the range */
  noRoadBuildings: number;
  noRoadT: number;
  /** mean landfill fill 0..1 and landfill capacity (t / month) */
  landfillFill: number;
  landfillCapT: number;
}

/*
 * B2 R7 audit — the public queries, what they read, and the piece that publishes it (every other field is pass-private):
 *  garbageInfo(id)         prodById / reasonById (GS / GA building chunks), served / servedStamp (GR_START, GR_ALLOC),
 *                          st.garbage (GA_PUB): inspector-only per-id arrays and stamps, written in place as pre-B2 (R7
 *                          exception, like airById).
 *  landfillInfo(x, z)      lfRegion, nReg, regStart / regCount / regRoad / regCap, lfOrder: GS_END (built privately during
 *                          the scan, swapped in); regUsed: GR_PUB; st.landfillFill: GA_LF.
 *  incineratorShare(id)    incShare (read by utilities): GR_PUB.
 *  garbageSummary()        summary: producedT GS_END, collected .. landfillCapT GR_PUB, outOfRange .. landfillFill GA_PUB
 *                          (three states, as pre-B2).
 *  roadlessGarbage()       roadless: GS_END (built privately during the stage).
 *  emissionOf(id)          airById: stageA's building chunks (inspector-only, R7 exception).
 *  layers                  st.garbage GA_PUB; st.landfillFill GA_LF; st.soil GS_END (brownfield cells) and FL_SOIL's
 *                          publish; st.treeCover the tree program's publish; st.airPollution AF's publish; st.noise NO's
 *                          publish; st.waterPollution WA's publish — each built in a private buffer and published by one
 *                          .set(), so each saved layer changes within one piece per state, as within one step pre-B2 (R9).
 *  stats                   garbage* GR_PUB, landfillFill GA_PUB, sewageTreated SB_SETUP (the stage start, as pre-B2),
 *                          avg* FL_PUB. Flags (NoGarbage, Polluted, Noisy): GA_PUB / FL_PUB, in snapshot order.
 */
export class PollutionSystem implements SimSystem {
  readonly name = 'pollution';
  /** air sources by radius class (full / half / quarter resolution blur) */
  private air: Float32Array<ArrayBuffer>[] = [];
  /** water / noise sources by class (half / quarter resolution blur) */
  private waterS: Float32Array<ArrayBuffer>[] = [];
  private noiseS: Float32Array<ArrayBuffer>[] = [];
  /** non-empty flags: air 0..2, water 3..4, noise 5..6 */
  private usedCls = new Uint8Array(7);
  private tmp = new Float32Array(0);
  private tmp2 = new Float32Array(0);
  private coarse = new Float32Array(0);
  private coarseTmp = new Float32Array(0);
  /** half-resolution accumulator of the near air classes (plume step) */
  private coarseAcc = new Float32Array(0);
  /** ground-water level of land cells before bank coupling (persistent; water cells unused) */
  private ground = new Float32Array(0);
  /** park footprint mask and its blurred buffer; soil source per cell (this pass) */
  private parkMask = new Float32Array(0);
  private parkBuf = new Float32Array(0);
  /** cells with a tree within TREE_BELT_REACH (box average of tree presence; > 0 = some) and the noise buffer of the
   *  last noise step (trees + parks + tree belts, see stageNoise) */
  private treeNear = new Float32Array(0);
  private noiseBuf = new Float32Array(0);
  /** share of the cells with a tree within reach (the noise step's belt walk: its cost estimate) */
  private nearShare = 0;
  private soilSrc = new Float32Array(0);
  private waterCells = new Int32Array(0);
  private waterNb = new Int32Array(0);
  /** bank land cells (within BANK_DIST of water) and the water cell each couples to */
  private bankCells = new Int32Array(0);
  private bankSrc = new Int32Array(0);
  private nWater = -1;
  private waterVersion = -1;
  private queue = new Int32Array(0);
  // ---- garbage (per building id)
  private served = new Int32Array(1024);
  private reach = new Int32Array(1024);
  private prodById = new Float32Array(1024);
  private reasonById = new Uint8Array(1024);
  /** incinerator burn share 0..1 (-1 unknown) */
  private incShare = new Float32Array(1024).fill(-1);
  /** total air source strength per building of the last pass (emissionOf) */
  private airById = new Float32Array(1024);
  private servedStamp = 0;
  private stamp = 0;
  // ---- garbage facilities of the current pass
  private facIds: number[] = [];
  private facCap: number[] = [];
  private facKind: number[] = [];
  private seeds = new Int32Array(0);
  private nSeeds = 0;
  /** truck distance (road cells) from the nearest garbage facility per cell (255 = beyond range); rebuilt on change */
  private roadDist = new Uint8Array(0);
  private routeDirty = true;
  private routeSig = -1;
  private bucketCount = new Int32Array(GARBAGE_TRUCK_RANGE + 1);
  private bDist = new Uint8Array(0);
  /** buildings reached by garbage trucks, nearest first (this pass) */
  private orderIds = new Int32Array(4096);
  // ---- landfill regions (labels of the last pass)
  private lfRegion = new Int32Array(0);
  private lfOrder = new Int32Array(0);
  private regStart: number[] = [];
  private regCount: number[] = [];
  private regRoad: boolean[] = [];
  private regCap: number[] = [];
  private regUsed: number[] = [];
  private nReg = 0;
  /** landfill cells of the last pass (closing a landfill leaves brownfield soil once); invalid until the first pass */
  private lfPrev = new Uint8Array(0);
  private lfPrevValid = false;
  /** incinerator ids of the last pass (their burn share is cleared when they disappear) */
  private incIds: number[] = [];
  private summary: GarbageSummary = {
    producedT: 0, collectedT: 0, recycledT: 0, burnedT: 0, landfilledT: 0, outOfRangeT: 0, overCapacityT: 0,
    outOfRangeBuildings: 0, noRoadBuildings: 0, noRoadT: 0, landfillFill: 0, landfillCapT: 0,
  };
  private capRec = 0;
  private capInc = 0;
  private capLf = 0;
  private lastRun = -1e9;
  private treesDirty = true;
  private parkDirty = true;
  private lastRangeNews = -1e9;
  private lastFillNews = -1e9;
  /** the first garbage facility / landfill of this pass that no road touches (garbage news names it; final fixes P7) */
  private roadless: { what: string; x: number; z: number } | null = null;
  private simRef: Simulation | null = null;
  /** DefInfo per building id (ids are never reused and defs never change in place; known defs only) */
  private infos: DefInfo[] = [];
  /** treatment capacity (residents) found by the garbage-sources step of this pass */
  private treatCapB = 0;
  /** park set signature: the blurred park buffer is only rebuilt when parks change */
  private parkSig = -1;
  lastMs = 0;

  private unsub: (() => void)[] = [];

  // ---- B2 piece state (design §6). Every field below is reset at each pass start and end and in init (resetPieces);
  // none is saved (R9). The private buffers (…Next / …Back) only grow.
  /** the piece inside the current state, and its cursor (chunk / cell / row / queue / order index) */
  private sub = 0;
  private cur = 0;
  /** the pass snapshot (R4): every building stage of the pass walks it */
  private snap = new BuildingSnapshot();
  /** the field program of the current stage: the op pool, its length, the current op and its units done */
  private ops: FieldOp[] = [];
  private nOps = 0;
  private opK = 0;
  private opU = 0;
  private blurRun = new Blur3Run();
  private boxRun = new BoxVRun();
  /** garbSrc's pass values (pre-B2 locals of the step) */
  private gsFunding = 0;
  private gsUtil = 0;
  private gsProduced = 0;
  private gsCapRec = 0;
  private gsCapInc = 0;
  private gsCapOther = 0;
  private gsTreatCap = 0;
  private gsRoadless: { what: string; x: number; z: number } | null = null;
  /** the landfill scan: region labels / lists built privately (swapped in at GS_END), cell capacity, tracking, queue tail,
   *  capacity; the brownfield soil writes (cell, value) and the landfill-fill resets, applied at GS_END (review 1 R4c) */
  private lfRegionNext = new Int32Array(0);
  private regStartN: number[] = [];
  private regCountN: number[] = [];
  private regRoadN: boolean[] = [];
  private regCapN: number[] = [];
  private regUsedN: number[] = [];
  private lfCellCap = 0;
  private lfTrack = false;
  private lfNReg = 0;
  private lfQt = 0;
  private lfCapLf = 0;
  private bfCell: number[] = [];
  private bfSoil: number[] = [];
  private fzCell: number[] = [];
  /** garbRoute: the stamps, the signature, the road checksum, the BFS queue, the reach sum, the order, the allocation */
  private grStamp = 0;
  private grSStamp = 0;
  private grSig = 0;
  private grNs = 0;
  private grQh = 0;
  private grQt = 0;
  private grReachProd = 0;
  private grNOrder = 0;
  private grK = 0;
  private grLeft = 0;
  private grCollected = 0;
  private grOverCap = 0;
  /** garbApply: the private garbage layer, the out-of-range / no-road sums and the first position, the landfill sums */
  private gNext = new Float32Array(0);
  private gaOutRange = 0;
  private gaOutRangeN = 0;
  private gaOutRangeX = -1;
  private gaOutRangeZ = -1;
  private gaNoRoad = 0;
  private gaNoRoadN = 0;
  private gaFillSum = 0;
  private gaLfCells = 0;
  /** flag candidates (garbApply, flags): 4 x snapshot index + the wanted bits; the changed list (events) */
  private cand: number[] = [];
  private changed: Building[] = [];
  /** stageA's setup values (pre-B2 locals of the step) */
  private sbUtil = 0;
  private sbSewageMul = 0;
  private sbHeat = 0;
  private sbNightSrc = 0;
  private sbConAir = 0;
  private sbConNoise = 0;
  private sbFireAir = 0;
  private sbParkSig = 0;
  /** srcCells: the any-source ORs; the tree / park decisions of this pass */
  private scAnyA = false;
  private scAnyN = false;
  private scAnyW = false;
  private scTrees = false;
  /** the private layers published by one .set() (tree cover, air, noise, water, soil) */
  private treeNext = new Float32Array(0);
  private airNext = new Float32Array(0);
  private noiseNext = new Float32Array(0);
  private wNext = new Float32Array(0);
  private soilNext = new Float32Array(0);
  /** the tree-near count of the program */
  private nearN = 0;
  /** water: the list this stage uses (captured when built or found valid; a rebuild by another pass replaces the arrays,
   *  so these references stay valid — review 1 R5), and the list builder's state */
  private waCells = new Int32Array(0);
  private waNb = new Int32Array(0);
  private waNW = 0;
  private waBank = new Int32Array(0);
  private waBankSrc = new Int32Array(0);
  private waterEpoch = 0;
  private wlPh = 0;
  private wlEpoch = 0;
  private wlN = 0;
  private wlQ = 0;
  private wlQh = 0;
  private wlQt = 0;
  private wlIdx = new Int32Array(0);
  private wlSrc = new Int32Array(0);
  private wlDist = new Uint8Array(0);
  private wlQueue = new Int32Array(0);
  private wlCells = new Int32Array(0);
  private wlNbN = new Int32Array(0);
  private wlBank: number[] = [];
  private wlBankSrc: number[] = [];
  /** flags: the weighted sums (doubles, list order) */
  private flPolSum = 0;
  private flPolN = 0;
  private flResW = 0;
  private flNSum = 0;
  private flASum = 0;
  private flWSum = 0;

  init(sim: Simulation): void {
    for (const u of this.unsub) u();
    this.simRef = sim;
    // per-id caches do not survive a new city (replaceState: building ids start again from 1)
    this.infos = [];
    this.incShare.fill(-1);
    this.incIds = [];
    this.lfPrevValid = false;
    this.unsub = [
      sim.events.on('terrainChanged', () => this.invalidateWater()),
      sim.events.on('reset', () => { this.invalidateWater(); this.routeDirty = true; }),
      sim.events.on('treesChanged', () => { this.treesDirty = true; }),
      sim.events.on('networkChanged', () => { this.routeDirty = true; }),
    ];
    this.routeDirty = true;
    sim.state.systemData.infraVersion = 1;
    this.lastRun = -1e9;
    this.nWater = -1;
    this.stepIdx = -1;
    this.resetPieces();
    this.compute(sim, true);
    const self = this;
    schedulerOf(sim).register({
      name: 'pollution',
      due: (s) => self.stepIdx >= 0 || s.state.day - self.lastRun >= POLL_PERIOD,
      urgent: () => false,
      cost: (s) => self.stepCost(s),
      step: (s) => self.step(s),
    });
  }

  /** pass progress: -1 idle, else the next step (S_*) */
  private stepIdx = -1;
  private firstPass = false;
  private fxB: OrdEffects | null = null;
  private fx3B: Wp3Effects | null = null;
  private jobsUnknownB = false;
  private dtMonthsB = 0;

  daily(sim: Simulation): void {
    // the tree tool gives immediate feedback on the published treeCover layer (the buffers apply at the next pass)
    if (this.treesDirty && this.stepIdx < 0 && sim.state.treeCover.length === this.tmp.length) {
      this.treesDirty = false;
      this.updateTreeCover(sim.state);
    }
    schedulerOf(sim).tickDay(sim);
  }

  frame(sim: Simulation, _dt: number): void {
    schedulerOf(sim).tickFrame(sim, this);
  }

  /**
   * one step (B2: one piece) of the pollution pass. The state ids and transitions are the pre-B2 ones; a state stays
   * current until its last piece reports completion. A pass whose pieces run with nothing in between computes exactly
   * what the pre-B2 steps computed.
   */
  step(sim: Simulation): void {
    const t0 = nowMs();
    // (B2 review 1 O8: an explicit pass start — a direct stepIdx = -1 (compute, tests) starts with every cursor reset)
    if (this.stepIdx < 0) { this.resetPieces(); this.stepIdx = S_GARB_SRC; }
    const k = this.stepIdx;
    if (this.stagePiece(sim, k)) {
      if (k >= LAST_STEP) {
        this.stepIdx = -1;
        this.firstPass = false;
        this.resetPieces();
      } else this.nextState(k + 1);
    }
    this.lastMs = nowMs() - t0;
  }

  /** full synchronous update (init / tests) */
  compute(sim: Simulation, first: boolean): void {
    const t0 = nowMs();
    this.stepIdx = -1;
    this.firstPass = first;
    do this.step(sim); while (this.stepIdx >= 0);
    this.lastMs = nowMs() - t0;
  }

  /** one piece of state k; true when the state is complete */
  private stagePiece(sim: Simulation, k: number): boolean {
    switch (k) {
      case S_GARB_SRC: return this.garbSrcPiece(sim);
      case S_GARB_ROUTE: return this.garbRoutePiece(sim);
      case S_GARB_APPLY: return this.garbApplyPiece(sim);
      case S_SRC_BLD: return this.srcBldPiece(sim);
      case S_SRC_CELLS: return this.srcCellsPiece(sim);
      case S_AIR_NEAR: return this.airNearPiece(sim);
      case S_AIR_FAR: return this.airFarPiece(sim);
      case S_NOISE: return this.noisePiece(sim);
      case S_WATER: return this.waterPiece(sim);
      default: return this.flagsPiece(sim);
    }
  }

  private nextState(s: number): void {
    this.stepIdx = s;
    this.sub = 0;
    this.cur = 0;
    this.nOps = 0;
    this.opK = 0;
    this.opU = 0;
    this.progBuilt = false;
  }

  /** B2: every piece cursor back to its reset value; the pass's snapshot and runs are released (R9) */
  private resetPieces(): void {
    this.sub = 0;
    this.cur = 0;
    this.snap.release();
    this.nOps = 0; this.opK = 0; this.opU = 0;
    this.progBuilt = false;
    for (const op of this.ops) { op.a = op.b = EMPTY_F32; op.c = op.d = null; op.mask = null; }
    this.blurRun.release();
    this.gsRoadless = null;
    this.bfCell.length = 0; this.bfSoil.length = 0; this.fzCell.length = 0;
    this.lfNReg = 0; this.lfQt = 0; this.lfCapLf = 0;
    this.grQh = 0; this.grQt = 0; this.grReachProd = 0; this.grNOrder = 0;
    this.cand.length = 0;
    this.changed.length = 0;
    this.scAnyA = this.scAnyN = this.scAnyW = this.scTrees = false;
    this.nearN = 0;
    this.waCells = this.waNb = this.waBank = this.waBankSrc = new Int32Array(0);
    this.waNW = 0;
    this.wlPh = 0; this.wlN = 0; this.wlQ = 0; this.wlQh = 0; this.wlQt = 0;
    this.wlCells = this.wlNbN = new Int32Array(0);
    this.wlBank = []; this.wlBankSrc = [];
  }

  /**
   * a whole state in one go outside a pass (pre-B2 stage methods: tests / benches call stageA and stageB directly). The
   * pass cursors are kept; a building stage without a pass snapshot takes one for the call.
   */
  private runStage(sim: Simulation, k: number, first: boolean): void {
    const save = { stepIdx: this.stepIdx, firstPass: this.firstPass, sub: this.sub, cur: this.cur };
    const own = this.snap.n === 0;
    if (own) { this.snap.take(sim.state); this.snap.plan(PLAN_B, PLAN_F, pieceBudgetUs(COLD)); }
    this.stepIdx = k;
    this.firstPass = first;
    this.sub = 0; this.cur = 0; this.nOps = 0; this.opK = 0; this.opU = 0; this.progBuilt = false;
    while (!this.stagePiece(sim, k)) { /* pieces */ }
    if (own) this.snap.release();
    this.stepIdx = save.stepIdx;
    this.firstPass = save.firstPass;
    this.sub = save.sub;
    this.cur = save.cur;
    this.nOps = 0; this.opK = 0; this.opU = 0; this.progBuilt = false;
  }

  // ------------------------------------------------------------------------------------------------ B2 cost model
  /**
   * estimated warm wall ms of the next step (B2 §9: the next piece's own work counts x the PC coefficients, with the
   * piece's own chunk sizes). Pure and O(1) (a field program: O(its ops)): reads the cursors and sizes, never runs a
   * loop over cells or buildings, never sets anything up.
   */
  stepCost(sim: Simulation): number {
    return (PL_EST * (PC.piece + this.pieceUs(sim))) / 1000;
  }

  /** µs of the next piece (stepCost) */
  private pieceUs(sim: Simulation): number {
    const st = sim.state, C = st.cells;
    const snap = this.snap, k = this.cur;
    const cells = (us: number, left: number) => Math.max(0, Math.min(cellUnits(us), left)) * us;
    const chunk = (us: number, left: number) => Math.max(0, Math.min(pieceUnits(us, 1, COLD), left)) * us;
    const ops = () => (this.progBuilt ? this.opsUs() : PC.setup);
    switch (this.stepIdx) {
      case -1: return PC.start + st.buildings.size * PC.listB;
      case S_GARB_SRC:
        switch (this.sub) {
          case GS_START: return PC.start + st.buildings.size * PC.listB;
          case GS_SNAP: return st.buildings.size * PC.snapTake;
          case GS_PLAN: return chunk(PC.plan, snap.n - snap.planned);
          case GS_BLD: return snap.countOf(k) * PC.gsB + snap.cellsOf(k) * PC.gsF;
          case GS_LF0: return C * PC.fill + PC.setup;
          case GS_LF: return cells(PC.lfScan, C - k);
          default: return PC.end + this.lfQt * PC.copy + (this.bfCell.length + this.fzCell.length) * 0.002;
        }
      case S_GARB_ROUTE:
        switch (this.sub) {
          case GR_START: return PC.setup + this.nSeeds * PC.seed;
          case GR_SUM: return cells(PC.netSum, C - k);
          case GR_CHECK: return PC.setup + C * PC.fill + this.nSeeds * PC.seed;
          case GR_BFS: return Math.max(0, Math.min(pieceUnits(PC.bfs, 1, CELL), Math.max(1, this.grQt - this.grQh))) * PC.bfs;
          case GR_BLD: return snap.countOf(k) * PC.grB + snap.cellsOf(k) * PC.grF;
          case GR_SORT: return PC.setup;
          case GR_SCAT: return snap.countOf(k) * PC.scatB;
          case GR_ALLOC: return cells(PC.alloc, this.grNOrder - k);
          default: return PC.pub + this.facIds.length * PC.fac + this.nReg * 0.01;
        }
      case S_GARB_APPLY:
        switch (this.sub) {
          case GA_START: return PC.setup + C * PC.copy;
          case GA_BLD: return snap.countOf(k) * PC.gaB + snap.cellsOf(k) * PC.gaF;
          case GA_LF: return PC.setup + this.lfOrderN() * PC.lfCell;
          case GA_LEFT: return ops();
          case GA_PUB: return PC.pub + C * PC.copy + this.cand.length * PC.apply;
          default: return chunk(PC.event, this.changed.length - k) + PC.end;
        }
      case S_SRC_BLD:
        switch (this.sub) {
          case SB_FILL: return ops();
          case SB_SETUP: return PC.setup;
          case SB_BLD: return snap.countOf(k) * PC.sbB + snap.cellsOf(k) * PC.sbF;
          default: return PC.end;
        }
      case S_SRC_CELLS:
        switch (this.sub) {
          case SC_CELLS: return ops();
          case SC_ATTACH: { const a = this.attachUs(sim); return a > 0 ? a : PC.setup + this.lfOrderN() * PC.lfCell; }
          case SC_FREIGHT: return PC.setup + this.lfOrderN() * PC.lfCell;
          default: return ops();
        }
      case S_WATER:
        switch (this.sub) {
          case WA_LIST: return this.listUs(st);
          default: return ops();
        }
      case S_FLAGS:
        switch (this.sub) {
          case FL_SOIL: return ops();
          case FL_BLD: return snap.countOf(k) * PC.flB + snap.cellsOf(k) * PC.flF;
          case FL_PUB: return PC.pub + this.cand.length * PC.apply;
          default: return chunk(PC.event, this.changed.length - k) + PC.end;
        }
      default: return ops();
    }
  }

  /** landfill cells of the last scan (O(regions)) */
  private lfOrderN(): number {
    const n = this.nReg;
    return n > 0 ? this.regStart[n - 1] + this.regCount[n - 1] : 0;
  }

  /** µs of the next water-list piece: nothing when the list is valid (the capture), else the builder's next chunk */
  private listUs(st: CityState): number {
    if (this.wlPh === 0 && this.cur === 0 && this.nWater >= 0 && this.waterVersion === st.cells) return PC.end;
    const C = st.cells;
    const cells = (us: number, left: number) => Math.max(0, Math.min(cellUnits(us), left)) * us;
    switch (this.wlPh) {
      case WL_IDX: return (this.cur === 0 ? C * PC.fill : 0) + cells(PC.wlIdx, C - this.cur);
      case WL_NB: return cells(PC.wlNb, C - this.cur);
      case WL_SEED: return (this.cur === 0 ? 2 * C * PC.fill : 0) + cells(PC.wlIdx, C - this.cur);
      default: return Math.max(0, Math.min(cellUnits(PC.wlBfs), Math.max(1, this.wlQt - this.wlQh))) * PC.wlBfs + PC.end;
    }
  }

  /** µs of traffic's pending attachment refresh (0 when current) */
  private attachUs(sim: Simulation): number {
    const tr = sim.getSystem('traffic') as unknown as AttachProbe | undefined;
    return tr && typeof tr.attachRefreshMs === 'function' ? tr.attachRefreshMs(sim.state) * 1000 : 0;
  }

  /** B2: the name of the next piece ('garbSrc.bld#3', 'airNear.blur'), for the step tools (b2work cpumap / profile labels) */
  get stepName(): string {
    const op = this.progBuilt && this.opK < this.nOps ? OP_NAMES[this.ops[this.opK].kind] : this.progBuilt ? 'end' : 'prog';
    switch (this.stepIdx) {
      case -1: return 'garbSrc.start';
      case S_GARB_SRC: return 'garbSrc.' + ['start', 'snap', 'plan', 'bld', 'lf0', 'lf', 'end'][this.sub] + (this.sub === GS_BLD ? '#' + this.cur : '');
      case S_GARB_ROUTE: return 'garbRoute.' + ['start', 'sum', 'check', 'bfs', 'bld', 'sort', 'scat', 'alloc', 'publish'][this.sub];
      case S_GARB_APPLY: return 'garbApply.' + ['start', 'bld', 'lf', 'left', 'publish', 'events'][this.sub] + (this.sub === GA_LEFT ? '.' + op : '');
      case S_SRC_BLD: return 'srcBld.' + ['fill', 'setup', 'bld', 'end'][this.sub] + (this.sub === SB_FILL ? '.' + op : '');
      case S_SRC_CELLS: return 'srcCells.' + ['cells', 'attach', 'freight', 'trees'][this.sub] + (this.sub === SC_CELLS || this.sub === SC_TREES ? '.' + op : '');
      case S_AIR_NEAR: return 'airNear.' + op;
      case S_AIR_FAR: return 'airFar.' + op;
      case S_NOISE: return 'noise.' + op;
      case S_WATER: return 'water.' + (this.sub === WA_LIST ? 'list' + this.wlPh : op);
      default: return 'flags.' + ['soil', 'bld', 'publish', 'events'][this.sub] + (this.sub === FL_SOIL ? '.' + op : '');
    }
  }

  // ------------------------------------------------------------------------------------------------ field programs
  /** true once the current sub-state's program is built (its own piece; then op pieces) */
  private progBuilt = false;

  /** a new op of the stage program (from the pool: every field reset; one shape) */
  private addOp(kind: number, units: number, us: number, size = us): FieldOp {
    let op = this.ops[this.nOps];
    if (op === undefined) { op = new FieldOp(); this.ops.push(op); }
    this.nOps++;
    op.kind = kind; op.units = units; op.us = us; op.size = size > 1e-9 ? size : 1e-9;
    op.a = op.b = EMPTY_F32; op.c = op.d = null; op.mask = null;
    op.n = 0; op.f = 1; op.r = 0; op.g = 0; op.dx = 0; op.dz = 0; op.k1 = 0; op.k2 = 0;
    return op;
  }
  /** a row op over N x N cells costing `usCell` per cell (sized with the cold cell floor) */
  private rowOp(kind: number, N: number, usCell: number): FieldOp {
    const op = this.addOp(kind, N, usCell * N, Math.max(usCell, INFRA_CELL_SIZING_US) * N);
    op.n = N;
    return op;
  }
  /** a list op over `n` entries costing `us` each (sized with the cold cell floor) */
  private listOp(kind: number, n: number, us: number): FieldOp {
    return this.addOp(kind, n, us, Math.max(us, INFRA_CELL_SIZING_US));
  }
  private opFill(a: Float32Array, n: number): void {
    const op = this.addOp(OP_FILL, 1, n * PC.fill);
    op.a = a; op.n = n;
  }
  private opCopy(dst: Float32Array, src: Float32Array, n: number): void {
    const op = this.addOp(OP_COPY, 1, n * PC.copy);
    op.a = dst; op.b = src; op.n = n;
  }
  /** blurDown(src, N, f, r, coarse, coarseTmp) as ops: the downsample by fine rows, blur3 by rows */
  private opBlurDown(src: Float32Array, N: number, f: number, r: number): void {
    const d = this.rowOp(OP_DOWN, N, PC.down);
    d.a = src; d.b = this.coarse; d.f = f;
    const M = Math.ceil(N / f);
    const b = this.addOp(OP_BLUR, Blur3Run.rowsOf(M, r), PC.box * M, Math.max(PC.box, INFRA_CELL_SIZING_US) * M);
    b.a = this.coarse; b.b = this.coarseTmp; b.n = M; b.r = r;
  }
  /** upsampleAdd(coarse, dst, N, f, gain, dx, dz) as an op by fine rows */
  private opUp(coarse: Float32Array, dst: Float32Array, N: number, f: number, gain: number, dx: number, dz: number): void {
    const op = this.rowOp(OP_UP, N, PC.up);
    op.a = coarse; op.b = dst; op.f = f; op.g = gain; op.dx = dx; op.dz = dz;
  }
  /** saturate(field, L, C, invK, alpha, mask, buf1, k1, buf2, k2) as an op by rows */
  private opSat(field: Float32Array, L: Float32Array, N: number, invK: number, alpha: number, mask: Uint8Array | null,
    buf1: Float32Array | null, k1: number, buf2: Float32Array | null, k2: number): void {
    const op = this.rowOp(OP_SAT, N, PC.sat);
    op.a = field; op.b = L; op.g = invK; op.dx = alpha; op.mask = mask; op.c = buf1; op.k1 = k1; op.d = buf2; op.k2 = k2;
  }
  /** boxAverage(src, dst, tmp, N, r) as ops: boxH rows src -> tmp, boxV rows tmp -> dst */
  private opBoxAverage(src: Float32Array, dst: Float32Array, tmp: Float32Array, N: number, r: number): void {
    const h = this.rowOp(OP_BOXH, N, PC.box);
    h.a = src; h.b = tmp; h.r = r;
    const v = this.rowOp(OP_BOXV, N, PC.box);
    v.a = tmp; v.b = dst; v.r = r;
  }

  /**
   * one piece of the stage program: ops in order from the cursor, each over a range of its units, while the piece's
   * sizing stays within the budget (at least one unit). Deterministic: the ranges depend only on the program and the
   * budget. True when the program is done.
   */
  private opsPiece(sim: Simulation): boolean {
    const budget = pieceBudgetUs(CELL);
    let used = 0;
    while (this.opK < this.nOps) {
      const op = this.ops[this.opK];
      const left = op.units - this.opU;
      if (left <= 0) { this.opK++; this.opU = 0; continue; }
      let take = Math.floor((budget - used) / op.size);
      if (take < 1) { if (used > 0) break; take = 1; }
      if (take > left) take = left;
      this.execOp(sim, op, this.opU, this.opU + take);
      used += take * op.size;
      this.opU += take;
      if (this.opU >= op.units) { this.opK++; this.opU = 0; }
    }
    return this.opK >= this.nOps;
  }

  /** µs of the next program piece (the same walk as opsPiece, without running anything) */
  private opsUs(): number {
    const budget = pieceBudgetUs(CELL);
    let used = 0, est = 0, k = this.opK, u = this.opU;
    while (k < this.nOps) {
      const op = this.ops[k];
      const left = op.units - u;
      if (left <= 0) { k++; u = 0; continue; }
      let take = Math.floor((budget - used) / op.size);
      if (take < 1) { if (used > 0) break; take = 1; }
      if (take > left) take = left;
      used += take * op.size;
      est += take * op.us;
      u += take;
      if (u >= op.units) { k++; u = 0; }
    }
    return est;
  }

  /** units [u0, u1) of op (rows, cells or list entries: see OP_*); a thin dispatcher, one method per loop (R10) */
  private execOp(sim: Simulation, op: FieldOp, u0: number, u1: number): void {
    const N = op.n;
    switch (op.kind) {
      case OP_FILL: op.a.fill(0, 0, op.n); return;
      case OP_COPY: op.a.set(op.b.subarray(0, op.n)); return;
      case OP_DOWN:
        if (u0 === 0) { const M = Math.ceil(N / op.f); op.b.fill(0, 0, M * M); }
        downsampleRows(op.a, N, op.f, op.b, u0, u1);
        return;
      case OP_BLUR:
        if (u0 === 0) this.blurRun.begin(op.a, op.b, N, op.r);
        this.blurRun.run(u1 - u0);
        return;
      case OP_ACC: accRows(op.a, op.b, op.g, u0 * N, u1 * N); return;
      case OP_UP: upsampleAddRows(op.a, op.b, N, op.f, op.g, op.dx, op.dz, u0, u1); return;
      case OP_SAT: saturateRange(op.a, op.b, u0 * N, u1 * N, op.g, op.dx, op.mask, op.c, op.k1, op.d, op.k2); return;
      case OP_BOXH: boxHRows(op.a, op.b, N, op.r, u0, u1); return;
      case OP_BOXV:
        if (u0 === 0) this.boxRun.begin(op.a, op.b, N, op.r);
        this.boxRun.run(u1 - u0);
        return;
      case OP_CELLS: this.cellRows(sim, u0 * N, u1 * N); return;
      case OP_TREES: treeRows(this.tmp, sim.state.trees, u0 * N, u1 * N); return;
      case OP_COUNT:
        this.nearN = countNear(this.treeNear, this.nearN, u0 * N, u1 * N);
        if (u1 >= op.units) this.nearShare = N * N > 0 ? this.nearN / (N * N) : 0;
        return;
      case OP_NOISEBUF: { const st = sim.state; noiseBuffer(this.tmp, st.trees, this.treeNear, st.treeCover, this.parkBuf, this.noiseBuf, N, u0, u1); return; }
      case OP_CLEAN: cleanRows(sim.state.water, this.tmp, this.wNext, u0 * N, u1 * N); return;
      case OP_WINIT: gatherRange(this.tmp2, this.wNext, this.waCells, u0, u1); return;
      case OP_WDIFF: this.diffuseRange(u0, u1); return;
      case OP_WCOPY: this.tmp2.set(this.tmp.subarray(u0, u1), u0); return;
      case OP_WBACK: scatterRange(this.wNext, this.tmp2, this.waCells, u0, u1); return;
      case OP_LAND: landRows(sim.state.water, this.wNext, this.ground, u0 * N, u1 * N); return;
      case OP_BANK: bankRange(this.wNext, this.waBank, this.waBankSrc, u0, u1); return;
      case OP_LEFT: leftRows(sim.state.building, this.lfRegion, this.gNext, u0 * N, u1 * N); return;
      default: this.soilRows(sim.state, u0 * N, u1 * N); return;
    }
  }

  // ------------------------------------------------------------------------------------------ public queries
  /** garbage state of a building (last pass), null if unknown */
  garbageInfo(id: number): GarbageInfo | null {
    const st = this.simRef?.state;
    const b = st?.buildings.get(id);
    if (!st || !b || id >= this.prodById.length) return null;
    const producedT = this.prodById[id];
    const collected = producedT === 0 || this.served[id] === this.servedStamp;
    const N = st.size;
    let level = 0;
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const v = st.garbage[z * N + x];
      if (v > level) level = v;
    }
    const r = this.reasonById[id];
    return { producedT, collected, level, reason: collected ? undefined : r === 3 ? 'noRoad' : r === 2 ? 'range' : r === 1 ? 'capacity' : undefined };
  }

  /** landfill at a landfill-zoned cell (last pass), null if the cell is not landfill */
  landfillInfo(x: number, z: number): LandfillInfo | null {
    const st = this.simRef?.state;
    if (!st || !st.inBounds(x, z) || this.lfRegion.length !== st.cells) return null;
    const r = this.lfRegion[z * st.size + x];
    if (r < 0 || r >= this.nReg) return null;
    const s = this.regStart[r], n = this.regCount[r];
    let f = 0;
    for (let q = 0; q < n; q++) f += st.landfillFill[this.lfOrder[s + q]];
    return { cells: n, fill: n > 0 ? f / n : 0, capacityT: this.regCap[r], usedT: this.regUsed[r], road: this.regRoad[r] };
  }

  /** incinerator burn share 0..1 of its nominal capacity (last pass; -1 unknown / not an incinerator) */
  incineratorShare(id: number): number {
    return id >= 0 && id < this.incShare.length ? this.incShare[id] : -1;
  }

  /** city garbage balance of the last pass (advisors / stats panel) */
  garbageSummary(): Readonly<GarbageSummary> {
    return this.summary;
  }

  /** the first garbage facility / landfill of the last pass that no road touches (it takes no garbage), or null — the
   *  garbage news and the advisors' garbage card name it (final fixes r4; derived each pass, not saved) */
  roadlessGarbage(): Readonly<{ what: string; x: number; z: number }> | null {
    return this.roadless;
  }

  /** total air source strength of a building in the last pass (0 = none; for tests and the inspector) */
  emissionOf(id: number): number {
    return id >= 0 && id < this.airById.length ? this.airById[id] : 0;
  }

  private info(st: CityState, b: Building): DefInfo {
    let inf = this.infos[b.id];
    if (inf === undefined) {
      inf = infoOf(st, b);
      if (inf.known) this.infos[b.id] = inf;
    }
    return inf;
  }

  // ------------------------------------------------------------------------------------------ allocation
  private ensureCells(st: CityState): void {
    const N = st.size, C = st.cells;
    if (this.tmp.length !== C) {
      this.air = [new Float32Array(C), new Float32Array(C), new Float32Array(C)];
      this.waterS = [new Float32Array(C), new Float32Array(C)];
      this.noiseS = [new Float32Array(C), new Float32Array(C)];
      this.tmp = new Float32Array(C);
      this.tmp2 = new Float32Array(C);
      this.ground = new Float32Array(C);
      this.parkMask = new Float32Array(C);
      this.parkBuf = new Float32Array(C);
      this.soilSrc = new Float32Array(C);
      this.queue = new Int32Array(C);
      this.lfRegion = new Int32Array(C).fill(-1);
      this.lfPrev = new Uint8Array(C);
      this.lfPrevValid = false;
      this.seeds = new Int32Array(Math.max(1024, C >> 2));
      this.nWater = -1;
      // ground water of land cells starts from the saved layer
      const L = st.waterPollution, wm = st.water;
      for (let i = 0; i < C; i++) this.ground[i] = wm[i] ? 0 : L[i];
      // (B2: the private buffers of the pieces)
      this.lfRegionNext = new Int32Array(C).fill(-1);
      this.gNext = new Float32Array(C);
      this.treeNext = new Float32Array(C);
      this.airNext = new Float32Array(C);
      this.noiseNext = new Float32Array(C);
      this.wNext = new Float32Array(C);
      this.soilNext = new Float32Array(C);
    }
    const M2 = Math.ceil(N / 2);
    if (this.coarse.length < M2 * M2) { this.coarse = new Float32Array(M2 * M2); this.coarseTmp = new Float32Array(M2 * M2); }
  }

  private ensureIds(st: CityState): void {
    this.served = ensureIdArray(this.served, st);
    this.reach = ensureIdArray(this.reach, st);
    this.prodById = ensureIdFloat(this.prodById, st);
    this.airById = ensureIdFloat(this.airById, st);
    this.incShare = ensureIdFloat(this.incShare, st, -1);
    if (this.reasonById.length < this.served.length) {
      const r = new Uint8Array(this.served.length);
      r.set(this.reasonById);
      this.reasonById = r;
    }
  }

  private pushSeed(i: number): void {
    if (this.nSeeds >= this.seeds.length) {
      const s = new Int32Array(this.seeds.length * 2);
      s.set(this.seeds);
      this.seeds = s;
    }
    this.seeds[this.nSeeds++] = i;
  }

  // ------------------------------------------------------------------------------------------ garbage
  /** step 0: pass start, garbage production, facilities, landfill regions (the whole state in one go: pre-B2 method) */
  private garbageSources(sim: Simulation, first: boolean): void {
    this.runStage(sim, S_GARB_SRC, first);
  }

  /** one piece of step 0; true when the state is complete */
  private garbSrcPiece(sim: Simulation): boolean {
    const st = sim.state;
    switch (this.sub) {
      case GS_START: this.gsStart(sim, this.firstPass); this.sub = GS_SNAP; return false;
      case GS_SNAP:
        // (the pass snapshot, R4: every building stage of this pass walks it; the per-id arrays cover its ids)
        this.snap.take(st);
        this.ensureIds(st);
        this.snap.planBegin(PLAN_B, PLAN_F, pieceBudgetUs(COLD));
        this.sub = GS_PLAN;
        return false;
      case GS_PLAN:
        if (this.snap.planRun(pieceUnits(PC.plan, 1, COLD))) { this.sub = GS_BLD; this.cur = 0; }
        return false;
      case GS_BLD:
        if (this.cur < this.snap.chunks) this.gsBuildings(st, this.cur++);
        if (this.cur >= this.snap.chunks) this.sub = GS_LF0;
        return false;
      case GS_LF0: this.gsLandfillStart(); this.sub = GS_LF; this.cur = 0; return false;
      case GS_LF:
        if (this.gsLandfillScan(st)) this.sub = GS_END;
        return false;
      default: this.gsEnd(st); return true;
    }
  }

  /** the pass start (pre-B2's step-0 prologue): buffers, dtMonths, the pass effects, funding, the facility lists */
  private gsStart(sim: Simulation, first: boolean): void {
    const st = sim.state;
    this.ensureCells(st);
    this.ensureIds(st);
    const dtMonths = first ? 0 : Math.min(2, (st.day - this.lastRun) / 30);
    this.lastRun = st.day;
    this.fxB = readEffects(st);
    this.fx3B = wp3Effects(st);
    this.jobsUnknownB = detectJobsUnknown(st);
    this.dtMonthsB = dtMonths;
    this.gsFunding = Math.min(1.2, fundingFactor(st, 'utilities'));
    this.nSeeds = 0;
    this.facIds.length = 0; this.facCap.length = 0; this.facKind.length = 0;
    this.gsProduced = 0; this.gsCapRec = 0; this.gsCapInc = 0; this.gsCapOther = 0; this.gsTreatCap = 0;
    this.gsRoadless = null;
    this.gsUtil = Math.min(1, fundingFactor(st, 'utilities'));
  }

  /** chunk k of the snapshot: garbage production, treatment capacity, the facilities (pre-B2's loop body) */
  private gsBuildings(st: CityState, k: number): void {
    const fx = this.fxB!, jobsUnknown = this.jobsUnknownB, funding = this.gsFunding, util = this.gsUtil;
    const prod = this.prodById, list = this.snap.list;
    let produced = this.gsProduced, capRec = this.gsCapRec, capInc = this.gsCapInc, capOther = this.gsCapOther, treatCap = this.gsTreatCap;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
      const b = list[bI];
      const inf = this.info(st, b);
      prod[b.id] = 0;
      // treatment capacity -> sewage reduction (stageA)
      if (inf.isTreatment && isFunctional(b)) {
        treatCap += (inf.capacity > 0 ? inf.capacity : inf.waterOut > 0 ? inf.waterOut * TREATMENT_RES_PER_KL : TREATMENT_DEFAULT_CAP) * util;
      }
      if (inf.garbageCap > 0) {
        if (!isFunctional(b)) continue;
        const n0 = this.nSeeds;
        this.seedPerimeter(st, b);
        // a facility needs a road on its perimeter (trucks) and power (x GARBAGE_UNPOWERED without)
        const cap = this.nSeeds > n0 ? inf.garbageCap * funding * ((b.flags & BF.Powered) !== 0 ? 1 : GARBAGE_UNPOWERED) : 0;
        if (this.nSeeds === n0 && !this.gsRoadless) this.gsRoadless = { what: getDef(b.def)?.name ?? 'garbage facility', x: b.x + (b.w >> 1), z: b.z + (b.d >> 1) };
        const kind = inf.isRecycling ? FK_RECYCLE : inf.isIncinerator ? FK_INCIN : FK_OTHER;
        this.facIds.push(b.id); this.facCap.push(cap); this.facKind.push(kind);
        if (kind === FK_RECYCLE) capRec += cap;
        else if (kind === FK_INCIN) capInc += cap;
        else capOther += cap;
        continue;
      }
      if (!isFunctional(b)) continue;
      let p = 0;
      if (inf.garbage > 0) p = inf.garbage * (inf.fam === Fam.Plop ? 1 : activity(inf, b, jobsUnknown)); // catalog: t/month at full occupancy
      else if (inf.fam === Fam.R) p = b.pop * GARBAGE_PER_RES;
      else if (inf.fam === Fam.C) p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_JOB_C;
      else if (inf.fam === Fam.I) p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_JOB_I[IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))]];
      else p = activeJobs(inf, b, jobsUnknown) * GARBAGE_PER_CIVIC_JOB;
      p *= fx.garbage;
      if (p > 0) { prod[b.id] = p; produced += p; }
    }
    this.gsProduced = produced; this.gsCapRec = capRec; this.gsCapInc = capInc; this.gsCapOther = capOther; this.gsTreatCap = treatCap;
  }

  /** the landfill scan setup: labels and region lists (private until GS_END), cell capacity, tracking */
  private gsLandfillStart(): void {
    this.lfRegionNext.fill(-1);
    this.regStartN.length = 0; this.regCountN.length = 0; this.regRoadN.length = 0; this.regCapN.length = 0; this.regUsedN.length = 0;
    this.lfCellCap = (getDef('util_landfill_tile')?.garbageCapacity ?? LANDFILL_CELL_CAP) * Math.max(0.5, Math.min(1, this.gsFunding));
    this.lfNReg = 0; this.lfQt = 0; this.lfCapLf = 0;
    this.lfTrack = this.lfPrevValid;
    this.bfCell.length = 0; this.bfSoil.length = 0; this.fzCell.length = 0;
  }

  /**
   * landfill regions (flood fill of empty landfill-zoned cells; usable if a road touches the region) over the cells of
   * one piece (pre-B2's scan body; a region's flood fill and its seed rollback run inside the piece that meets its first
   * cell). The brownfield soil and landfill-fill writes are collected in scan order and applied at GS_END. True when done.
   */
  private gsLandfillScan(st: CityState): boolean {
    const N = st.size, C = st.cells;
    const zone = st.zone, bld = st.building, net = st.network, fill = st.landfillFill;
    const lab = this.lfRegionNext, order = this.queue, lfPrev = this.lfPrev;
    const lfCellCap = this.lfCellCap, track = this.lfTrack;
    let nReg = this.lfNReg, qt = this.lfQt, capLf = this.lfCapLf;
    const s1 = Math.min(C, this.cur + cellUnits(PC.lfScan));
    for (let s = this.cur; s < s1; s++) {
      if (zone[s] !== Zone.Landfill || bld[s] >= 0) {
        // a landfill cell closed since the last pass (dezoned / rezoned / built over) leaves contaminated brownfield
        // soil, once. Its fill stays (zoning it as landfill again carries on from there, no free capacity) until a
        // building occupies the cell.
        if (lfPrev[s] !== 0) {
          lfPrev[s] = 0;
          if (track && fill[s] > 0.05) { this.bfCell.push(s); this.bfSoil.push(Math.max(st.soil[s], Math.min(1, BROWNFIELD_BASE + BROWNFIELD_FILL * fill[s]))); }
        }
        if (bld[s] >= 0 && fill[s] !== 0) this.fzCell.push(s);
        continue;
      }
      lfPrev[s] = 1;
      if (lab[s] >= 0) continue;
      const r = nReg++;
      const start = qt;
      let qh = qt;
      order[qt++] = s;
      lab[s] = r;
      let road = false;
      const seedMark = this.nSeeds;
      while (qh < qt) {
        const i = order[qh++];
        const x = i % N, z = (i - x) / N;
        for (let k = 0; k < 4; k++) {
          const nx = x + DX[k], nz = z + DZ[k];
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          const j = nz * N + nx;
          if (isRoad(net[j] as Network)) { road = true; this.pushSeed(j); }
          if (zone[j] === Zone.Landfill && bld[j] < 0 && lab[j] < 0) { lab[j] = r; order[qt++] = j; }
        }
      }
      let cap = 0;
      if (road) { for (let q = start; q < qt; q++) if (fill[order[q]] < 1) cap += lfCellCap; }
      else {
        this.nSeeds = seedMark;
        if (!this.gsRoadless) this.gsRoadless = { what: 'landfill', x: s % N, z: (s / N) | 0 };
      }
      this.regStartN.push(start); this.regCountN.push(qt - start); this.regRoadN.push(road); this.regCapN.push(cap); this.regUsedN.push(0);
      capLf += cap;
    }
    this.lfNReg = nReg; this.lfQt = qt; this.lfCapLf = capLf;
    this.cur = s1;
    return s1 >= C;
  }

  /** the tail of step 0 (publish): the scan's regions and labels swapped in, the stock writes, caps, summary */
  private gsEnd(st: CityState): void {
    const fill = st.landfillFill, soil = st.soil;
    for (let k = 0; k < this.bfCell.length; k++) soil[this.bfCell[k]] = this.bfSoil[k];
    for (let k = 0; k < this.fzCell.length; k++) fill[this.fzCell[k]] = 0;
    const qt = this.lfQt;
    const lab = this.lfRegion;
    this.lfRegion = this.lfRegionNext;
    this.lfRegionNext = lab;
    let t: unknown[] = this.regStart; this.regStart = this.regStartN; this.regStartN = t as number[];
    t = this.regCount; this.regCount = this.regCountN; this.regCountN = t as number[];
    t = this.regRoad; this.regRoad = this.regRoadN; this.regRoadN = t as boolean[];
    t = this.regCap; this.regCap = this.regCapN; this.regCapN = t as number[];
    t = this.regUsed; this.regUsed = this.regUsedN; this.regUsedN = t as number[];
    if (this.lfOrder.length < qt) this.lfOrder = new Int32Array(Math.max(qt, 256) * 2);
    this.lfOrder.set(this.queue.subarray(0, qt));
    this.nReg = this.lfNReg;
    this.lfPrevValid = true;
    this.roadless = this.gsRoadless;
    // other disposal facilities (mods / test defs without a kind) count as landfill capacity
    this.capRec = this.gsCapRec;
    this.capInc = this.gsCapInc;
    this.capLf = this.lfCapLf + this.gsCapOther;
    this.summary.producedT = this.gsProduced;
    this.treatCapB = this.gsTreatCap;
  }

  /** step 1: truck-range BFS from the facilities, nearest-first capacity allocation, burn / landfill shares (one go) */
  private garbageRoutes(sim: Simulation): void {
    this.runStage(sim, S_GARB_ROUTE, this.firstPass);
  }

  /** one piece of step 1; true when the state is complete */
  private garbRoutePiece(sim: Simulation): boolean {
    const st = sim.state;
    switch (this.sub) {
      case GR_START: this.grStart(st); this.sub = GR_SUM; this.cur = 0; this.grNs = 0; return false;
      case GR_SUM:
        if (this.grNetSum(st)) this.sub = GR_CHECK;
        return false;
      case GR_CHECK: {
        const sig = (this.grSig * 7 + this.grNs) % 2147483647;
        if (this.routeDirty || sig !== this.routeSig || this.roadDist.length !== st.cells) {
          this.routeDirty = false;
          this.routeSig = sig;
          this.truckBfsStart(st);
          this.sub = GR_BFS;
        } else this.sub = GR_BLD;
        this.cur = 0;
        return false;
      }
      case GR_BFS:
        if (this.truckBfsRun(st, pieceUnits(PC.bfs, 1, CELL))) { this.sub = GR_BLD; this.cur = 0; }
        return false;
      case GR_BLD:
        if (this.cur === 0) {
          this.bucketCount.fill(0);
          this.grReachProd = 0;
          if (this.bDist.length < this.snap.n) this.bDist = new Uint8Array(this.snap.n * 2 + 64);
        }
        if (this.cur < this.snap.chunks) this.grBuildings(st, this.cur++);
        if (this.cur >= this.snap.chunks) this.sub = GR_SORT;
        return false;
      case GR_SORT: {
        const R = GARBAGE_TRUCK_RANGE, bucket = this.bucketCount;
        let acc = 0;
        for (let d = 0; d <= R; d++) { const c = bucket[d]; bucket[d] = acc; acc += c; }
        this.grNOrder = acc;
        if (this.orderIds.length < acc) this.orderIds = new Int32Array(acc * 2);
        this.sub = GR_SCAT;
        this.cur = 0;
        return false;
      }
      case GR_SCAT:
        if (this.cur < this.snap.chunks) this.grScatter(this.cur++);
        if (this.cur >= this.snap.chunks) { this.grAllocStart(); this.sub = GR_ALLOC; this.cur = 0; }
        return false;
      case GR_ALLOC:
        if (this.grAlloc()) this.sub = GR_PUB;
        return false;
      default: this.grPublish(st); return true;
    }
  }

  /** the road checksum by cell ranges (a sequential mod sum in index order); true when done */
  private grNetSum(st: CityState): boolean {
    // cheap road checksum too, so direct layer edits (tests, sandbox tools) without networkChanged are picked up
    const C = st.cells, net = st.network;
    const i1 = Math.min(C, this.cur + cellUnits(PC.netSum));
    let ns = this.grNs;
    for (let i = this.cur; i < i1; i++) if (net[i] !== 0) ns = (ns + (i + 1) * net[i]) % 2147483647;
    this.grNs = ns;
    this.cur = i1;
    return i1 >= C;
  }

  /** chunk k of the counting sort's scatter (buildings nearest first, list order within a distance) */
  private grScatter(k: number): void {
    const R = GARBAGE_TRUCK_RANGE, bucket = this.bucketCount, orderIds = this.orderIds, bd = this.bDist, list = this.snap.list;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
      const m = bd[bI];
      if (m <= R) orderIds[bucket[m]++] = list[bI].id;
    }
  }

  /** the stamps and the facility-entrance signature (pre-B2's step-1 prologue) */
  private grStart(st: CityState): void {
    // buildings may have appeared since the sources step (a later scheduler slot): per-id arrays must cover their ids
    // (a read past the end gives undefined -> NaN production / recycling -> NaN funds)
    this.ensureIds(st);
    this.grStamp = ++this.stamp;
    const sStamp = ++this.stamp;
    this.grSStamp = sStamp;
    this.servedStamp = sStamp;
    // truck distance (road cells) from the nearest facility: multi-source BFS over roads, rerun only when the road
    // network or the facility entrances change
    const seeds = this.seeds;
    let sig = this.nSeeds;
    for (let q = 0; q < this.nSeeds; q++) sig = (sig * 31 + seeds[q]) % 2147483647;
    this.grSig = sig;
  }

  /** chunk k: buildings by truck distance of their best perimeter road cell (bucket counts, reach stamps, reach sum) */
  private grBuildings(st: CityState, k: number): void {
    const N = st.size;
    const rd = this.roadDist, bucket = this.bucketCount, reach = this.reach, prod = this.prodById, bd = this.bDist, list = this.snap.list;
    const R = GARBAGE_TRUCK_RANGE, stamp = this.grStamp;
    let reachProd = this.grReachProd;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
      const b = list[bI];
      let m = 255;
      const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d;
      for (let x = x0; x < x1; x++) {
        if (z0 > 0) { const v = rd[(z0 - 1) * N + x]; if (v < m) m = v; }
        if (z1 < N) { const v = rd[z1 * N + x]; if (v < m) m = v; }
      }
      for (let z = z0; z < z1; z++) {
        if (x0 > 0) { const v = rd[z * N + x0 - 1]; if (v < m) m = v; }
        if (x1 < N) { const v = rd[z * N + x1]; if (v < m) m = v; }
      }
      bd[bI] = m;
      if (m <= R) { bucket[m]++; reach[b.id] = stamp; reachProd += prod[b.id]; }
    }
    this.grReachProd = reachProd;
  }

  /** the allocation's start: capacity, recycling (at most RECYCLE_MAX_SHARE of what is collected) + incineration + landfill */
  private grAllocStart(): void {
    const capRecUse = Math.min(this.capRec, RECYCLE_MAX_SHARE * this.grReachProd);
    this.grK = capRecUse + this.capInc + this.capLf;
    this.grLeft = this.grK;
    this.grCollected = 0;
    this.grOverCap = 0;
  }

  /** nearest first over the order (ranges); true when done */
  private grAlloc(): boolean {
    const prod = this.prodById, served = this.served, reason = this.reasonById, ord = this.orderIds, sStamp = this.grSStamp;
    let left = this.grLeft, collected = this.grCollected, overCap = this.grOverCap;
    const q1 = Math.min(this.grNOrder, this.cur + cellUnits(PC.alloc));
    for (let q = this.cur; q < q1; q++) {
      const bid = ord[q];
      const p = prod[bid];
      if (p === 0) { served[bid] = sStamp; reason[bid] = 0; continue; }
      if (left > 0) { left -= p; collected += p; served[bid] = sStamp; reason[bid] = 0; }
      else { reason[bid] = 1; overCap += p; }
    }
    this.grLeft = left; this.grCollected = collected; this.grOverCap = overCap;
    this.cur = q1;
    return q1 >= this.grNOrder;
  }

  /** the publish of step 1: the shares (incShare is read by utilities), region use, summary, stats */
  private grPublish(st: CityState): void {
    const K = this.grK, collected = this.grCollected, overCap = this.grOverCap;
    const handled = Math.min(collected, K);
    const recycled = Math.min(this.capRec, RECYCLE_MAX_SHARE * handled);
    const burned = Math.min(this.capInc, handled - recycled);
    const landfilled = Math.max(0, Math.min(this.capLf, handled - recycled - burned));
    // per facility use (incinerators that disappeared since the last pass lose their share)
    const incShare = this.incShare;
    for (const id of this.incIds) if (id < incShare.length) incShare[id] = -1;
    this.incIds.length = 0;
    for (let f = 0; f < this.facIds.length; f++) {
      const id = this.facIds[f];
      if (this.facKind[f] !== FK_INCIN) continue;
      const b = st.buildings.get(id);
      const nominal = b ? infoOf(st, b).garbageCap : 0;
      incShare[id] = nominal > 0 && this.capInc > 0 ? Math.min(1, (burned * this.facCap[f]) / this.capInc / nominal) : 0;
      this.incIds.push(id);
    }
    const lfTotal = this.capLf;
    for (let r = 0; r < this.nReg; r++) this.regUsed[r] = lfTotal > 0 ? (landfilled * this.regCap[r]) / lfTotal : 0;
    const sm = this.summary;
    sm.collectedT = handled;
    sm.recycledT = recycled;
    sm.burnedT = burned;
    sm.landfilledT = landfilled;
    sm.overCapacityT = overCap;
    sm.landfillCapT = this.capLf;
    st.stats.garbageProduced = sm.producedT;
    st.stats.garbageCapacity = Math.min(this.capRec, RECYCLE_MAX_SHARE * sm.producedT) + this.capInc + this.capLf;
    st.stats.garbageRecycled = recycled;
  }

  /** step 2: piles build up / clear, BF.NoGarbage, landfill fill (stock) and display (one go) */
  private garbageApply(sim: Simulation): void {
    this.runStage(sim, S_GARB_APPLY, this.firstPass);
  }

  /** one piece of step 2; true when the state is complete */
  private garbApplyPiece(sim: Simulation): boolean {
    const st = sim.state;
    switch (this.sub) {
      case GA_START:
        this.ensureIds(st);
        // (the piles, the landfill display and the leftovers are built on a private copy, published at GA_PUB: R7 / R9)
        this.gNext.set(st.garbage);
        this.gaOutRange = 0; this.gaOutRangeN = 0; this.gaOutRangeX = -1; this.gaOutRangeZ = -1; this.gaNoRoad = 0; this.gaNoRoadN = 0;
        this.cand.length = 0;
        this.sub = GA_BLD;
        this.cur = 0;
        return false;
      case GA_BLD:
        if (this.cur < this.snap.chunks) this.gaBuildings(st, this.cur++);
        if (this.cur >= this.snap.chunks) this.sub = GA_LF;
        return false;
      case GA_LF: this.gaLandfill(st); this.sub = GA_LEFT; this.progBuilt = false; return false;
      case GA_LEFT:
        if (!this.progBuilt) { this.nOps = 0; this.opK = 0; this.opU = 0; this.rowOp(OP_LEFT, st.size, PC.left); this.progBuilt = true; return false; }
        if (this.opsPiece(sim)) { this.sub = GA_PUB; this.progBuilt = false; }
        return false;
      case GA_PUB: {
        st.garbage.set(this.gNext.subarray(0, st.cells));
        const list = this.snap.list, changed = this.changed;
        changed.length = 0;
        for (let k = 0; k < this.cand.length; k++) {
          const q = this.cand[k];
          const b = list[q >> 2];
          if (setFlagQuiet(b, BF.NoGarbage, (q & 1) !== 0)) changed.push(b);
        }
        const sm = this.summary;
        sm.outOfRangeT = this.gaOutRange;
        sm.outOfRangeBuildings = this.gaOutRangeN;
        sm.noRoadT = this.gaNoRoad;
        sm.noRoadBuildings = this.gaNoRoadN;
        sm.landfillFill = this.gaLfCells > 0 ? this.gaFillSum / this.gaLfCells : 0;
        st.stats.landfillFill = sm.landfillFill;
        this.sub = GA_EV;
        this.cur = 0;
        return false;
      }
      default: {
        const changed = this.changed;
        const k1 = Math.min(changed.length, this.cur + pieceUnits(PC.event, 1, COLD));
        for (let k = this.cur; k < k1; k++) {
          const b = changed[k];
          // (R4: a snapshot building removed since gets no event; in an uninterrupted pass every one is live)
          if (st.buildings.get(b.id) === b) sim.events.emit('buildingChanged', b);
        }
        this.cur = k1;
        if (k1 < changed.length) return false;
        this.garbageNews(sim, this.gaOutRangeN, this.gaOutRangeX, this.gaOutRangeZ);
        return true;
      }
    }
  }

  /** chunk k: reasons, piles (on the private copy), the wanted NoGarbage bit, the out-of-range sums (pre-B2's body) */
  private gaBuildings(st: CityState, k: number): void {
    const N = st.size;
    const bld = st.building;
    const G = this.gNext;
    const dtMonths = this.dtMonthsB;
    const prod = this.prodById, served = this.served, reach = this.reach, reason = this.reasonById;
    const sStamp = this.servedStamp, rStamp = sStamp - 1;
    const list = this.snap.list, cand = this.cand;
    let outRange = this.gaOutRange, outRangeN = this.gaOutRangeN, outRangeX = this.gaOutRangeX, outRangeZ = this.gaOutRangeZ;
    let noRoad = this.gaNoRoad, noRoadN = this.gaNoRoadN;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
      const b = list[bI];
      const p = prod[b.id];
      const ok = p === 0 || served[b.id] === sStamp;
      if (!ok && reach[b.id] !== rStamp) {
        if (roadOnEdge(st, b)) {
          reason[b.id] = 2; outRange += p;
          if (outRangeN++ === 0) { outRangeX = b.x; outRangeZ = b.z; }
        } else { reason[b.id] = 3; noRoad += p; noRoadN++; }
      }
      const area = b.w * b.d;
      const rate = GARBAGE_BUILDUP_RATE * dtMonths * (0.6 + 0.4 * Math.min(1, p / area / 0.3));
      let level = 0;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        if (bld[i] !== b.id) continue;
        let g = G[i];
        if (ok) g *= 1 - GARBAGE_DECAY;
        else g = Math.min(1, g + rate);
        G[i] = g;
        if (g > level) level = g;
      }
      const on = level > NO_GARBAGE_THRESHOLD;
      if (((b.flags & BF.NoGarbage) !== 0) !== on) cand.push(bI * 4 + (on ? 1 : 0));
    }
    this.gaOutRange = outRange; this.gaOutRangeN = outRangeN; this.gaOutRangeX = outRangeX; this.gaOutRangeZ = outRangeZ;
    this.gaNoRoad = noRoad; this.gaNoRoadN = noRoadN;
  }

  /** landfill: dumped tons fill the region's cells in order (st.landfillFill: one piece); display level on the copy */
  private gaLandfill(st: CityState): void {
    const G = this.gNext, fill = st.landfillFill, lfOrder = this.lfOrder;
    const dtMonths = this.dtMonthsB;
    let fillSum = 0, lfCells = 0;
    for (let r = 0; r < this.nReg; r++) {
      const s = this.regStart[r], n = this.regCount[r];
      let tons = this.regUsed[r] * dtMonths;
      for (let q = 0; q < n && tons > 0; q++) {
        const i = lfOrder[s + q];
        const f = fill[i];
        if (f >= 1) continue;
        const add = Math.min(tons, (1 - f) * LANDFILL_CELL_STOCK);
        fill[i] = Math.min(1, f + add / LANDFILL_CELL_STOCK);
        tons -= add;
      }
      const use = this.regCap[r] > 0 ? Math.min(1, this.regUsed[r] / this.regCap[r]) : 0;
      for (let q = 0; q < n; q++) {
        const i = lfOrder[s + q];
        G[i] = Math.min(1, 0.35 + 0.3 * use + 0.35 * fill[i]);
        fillSum += fill[i];
      }
      lfCells += n;
    }
    this.gaFillSum = fillSum;
    this.gaLfCells = lfCells;
  }

  /** legible feedback for the new garbage rules: out-of-range districts and filling landfills (news, with cooldowns) */
  private garbageNews(sim: Simulation, outRangeN: number, x: number, z: number): void {
    const st = sim.state;
    if (this.dtMonthsB <= 0 || st.stats.population < 1000) return;
    const sm = this.summary;
    if (outRangeN >= 10 && sm.outOfRangeT > 0.05 * sm.producedT && st.day - this.lastRangeNews >= GARBAGE_NEWS_DAYS) {
      this.lastRangeNews = st.day;
      const any = this.capInc + this.capRec + this.capLf > 0;
      const rl = this.roadless;
      // (final fixes P7: a landfill / incinerator that exists but no road touches is named — the fix is a road, not one)
      const n = outRangeN.toLocaleString('en-US');
      const nr = sm.noRoadBuildings > 0 ? ` ${sm.noRoadBuildings.toLocaleString('en-US')} more have no road for the trucks at all.` : '';
      if (!any && rl) {
        sim.notify(`Garbage is piling up at ${n} buildings: your ${rl.what} has no road access, so garbage trucks can't use it — connect it to a road.${nr}`, 'warning', rl.x, rl.z, 'utilities');
      } else {
        const why = any
          ? `are more than ${GARBAGE_TRUCK_RANGE} road tiles from a landfill, incinerator or recycling center (or not connected to one)`
          : 'have no landfill, incinerator or recycling center to take their garbage';
        const also = any && rl ? ` Your ${rl.what} has no road access — connect it to a road.` : '';
        sim.notify(`Garbage is piling up: trucks can't reach ${n} buildings — they ${why}.${also}${nr}`, 'warning', x, z, 'utilities');
      }
    }
    if (sm.landfillCapT > 0 && sm.landfillFill >= LANDFILL_WARN_FILL && st.day - this.lastFillNews >= GARBAGE_NEWS_DAYS * 2) {
      this.lastFillNews = st.day;
      sim.notify(`Landfills are ${Math.round(sm.landfillFill * 100)}% full. Zone more landfill or build an incinerator / recycling center before they close.`, 'warning', undefined, undefined, 'utilities');
    }
  }

  /** distance-limited multi-source BFS over road cells from the facility entrances (seeds) into roadDist: the start */
  private truckBfsStart(st: CityState): void {
    const C = st.cells;
    if (this.roadDist.length !== C) this.roadDist = new Uint8Array(C);
    const rd = this.roadDist, queue = this.queue;
    rd.fill(255);
    let qt = 0;
    for (let q = 0; q < this.nSeeds; q++) {
      const s = this.seeds[q];
      if (rd[s] === 0) continue;
      rd[s] = 0;
      queue[qt++] = s;
    }
    this.grQh = 0;
    this.grQt = qt;
  }

  /** the BFS's next `max` queue cells (pre-B2's loop; qh / qt in fields); true when the queue is empty */
  private truckBfsRun(st: CityState, max: number): boolean {
    const N = st.size, C = st.cells, net = st.network;
    const rd = this.roadDist, queue = this.queue;
    let qh = this.grQh, qt = this.grQt;
    const qEnd = qh + max;
    const R = GARBAGE_TRUCK_RANGE;
    while (qh < qt && qh < qEnd) {
      const i = queue[qh++];
      const d = rd[i] + 1;
      if (d > R) continue;
      const x = i % N;
      let j = i + 1;
      if (x < N - 1 && rd[j] === 255 && net[j] >= Network.Street && net[j] <= Network.Highway) { rd[j] = d; queue[qt++] = j; }
      j = i - 1;
      if (x > 0 && rd[j] === 255 && net[j] >= Network.Street && net[j] <= Network.Highway) { rd[j] = d; queue[qt++] = j; }
      j = i + N;
      if (j < C && rd[j] === 255 && net[j] >= Network.Street && net[j] <= Network.Highway) { rd[j] = d; queue[qt++] = j; }
      j = i - N;
      if (j >= 0 && rd[j] === 255 && net[j] >= Network.Street && net[j] <= Network.Highway) { rd[j] = d; queue[qt++] = j; }
    }
    this.grQh = qh;
    this.grQt = qt;
    return qh >= qt;
  }

  private seedPerimeter(st: CityState, b: Building): void {
    const N = st.size;
    for (let z = b.z - 1; z <= b.z + b.d; z++) for (let x = b.x - 1; x <= b.x + b.w; x++) {
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      if (x >= b.x && x < b.x + b.w && z >= b.z && z < b.z + b.d) continue;
      const i = z * N + x;
      if (isRoad(st.network[i] as Network)) this.pushSeed(i);
    }
  }

  // ------------------------------------------------------------------------------------------ sources
  /** step 3 (stageA): sources of every building (the whole state in one go: pre-B2 method; tests / benches call it) */
  private stageA(sim: Simulation, first: boolean): void {
    this.runStage(sim, S_SRC_BLD, first);
  }

  /** one piece of step 3; true when the state is complete */
  private srcBldPiece(sim: Simulation): boolean {
    const st = sim.state;
    switch (this.sub) {
      case SB_FILL:
        if (!this.progBuilt) {
          this.ensureCells(st);
          this.ensureIds(st);
          this.nOps = 0; this.opK = 0; this.opU = 0;
          const C = st.cells;
          for (const a of this.air) this.opFill(a, C);
          for (const a of this.waterS) this.opFill(a, C);
          for (const a of this.noiseS) this.opFill(a, C);
          this.opFill(this.parkMask, C);
          this.opFill(this.soilSrc, C);
          this.progBuilt = true;
          return false;
        }
        if (this.opsPiece(sim)) { this.usedCls.fill(0); this.sub = SB_SETUP; this.progBuilt = false; }
        return false;
      case SB_SETUP: this.sbSetup(sim); this.sub = SB_BLD; this.cur = 0; return false;
      case SB_BLD:
        if (this.cur < this.snap.chunks) this.sbBuildings(sim, this.cur++);
        if (this.cur >= this.snap.chunks) this.sub = SB_END;
        return false;
      default: this.sbEnd(sim); return true;
    }
  }

  /** stageA's setup (pre-B2's prologue after the clears): sewage treatment (published), heating, the area sources */
  private sbSetup(sim: Simulation): void {
    const st = sim.state;
    const fx = this.fxB ?? readEffects(st);
    const fx3 = this.fx3B ?? wp3Effects(st);
    // treatment capacity (garbage-sources step) -> sewage reduction (published: stats.sewageTreated, read by utilities)
    this.sbUtil = Math.min(1, fundingFactor(st, 'utilities'));
    const treatCap = this.treatCapB;
    const pop = Math.max(1, st.stats.population || 0);
    const treated = Math.min(1, treatCap / pop);
    st.stats.sewageTreated = treatCap > 0 ? treated : 0;
    this.sbSewageMul = (1 - 0.9 * treated) * fx.water * fx3.sewage;
    const airK = srcScale(AIR_K);
    // residential heating: winter peak (day-of-year), climate
    const winter = 0.5 + 0.5 * Math.cos((2 * Math.PI * ((st.day % 360) + 15)) / 360);
    this.sbHeat = HEAT_AIR_PER_RES * (0.6 + 0.8 * winter) * (HEAT_CLIMATE[st.config.climate] ?? 1) * fx.air;
    // area-calibrated per-cell sources (x footprint area below): district level L -> -ln(1 - L) K / uniform class-0 gain
    this.sbNightSrc = areaSource(NOISE_NIGHTLIFE, NOISE_K) * fx3.noise;
    this.sbConAir = areaSource(CONSTRUCTION_AIR, AIR_K) * fx.air;
    this.sbConNoise = areaSource(CONSTRUCTION_NOISE, NOISE_K) * fx3.noise;
    this.sbFireAir = intensityToSource(FIRE_SMOKE, airK);
    this.sbParkSig = 0;
  }

  /** chunk k: the sources of every building (pre-B2's stageA loop body) */
  private sbBuildings(sim: Simulation, k: number): void {
    const st = sim.state;
    const N = st.size;
    const fx = this.fxB ?? readEffects(st);
    const fx3 = this.fx3B ?? wp3Effects(st);
    const jobsUnknown = this.jobsUnknownB;
    const air = this.air, waterS = this.waterS, noiseS = this.noiseS;
    const park = this.parkMask, soilSrc = this.soilSrc;
    const used = this.usedCls;
    const list = this.snap.list;
    const util = this.sbUtil, sewageMul = this.sbSewageMul;
    const airK = srcScale(AIR_K), waterK = srcScale(WATER_K), noiseK = srcScale(NOISE_K);
    const utilities = sim.getSystem<UtilitiesSystem>('utilities');
    const heat = this.sbHeat, nightSrc = this.sbNightSrc, conAir = this.sbConAir, conNoise = this.sbConNoise, fireAir = this.sbFireAir;
    const zone = st.zone;
    const airById = this.airById, incShare = this.incShare;
    let parkSig = this.sbParkSig;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
      const b = list[bI];
      const inf = this.info(st, b);
      const flags = b.flags;
      const onFire = (flags & BF.OnFire) !== 0;
      const functional = isFunctional(b);
      const constructing = !functional && (flags & BF.Constructing) !== 0 && (flags & (BF.Burnt | BF.Abandoned)) === 0;
      airById[b.id] = 0;
      if (!functional && !onFire && !constructing) continue;
      const area = b.w * b.d;
      // def-class sources (a, w, nz in class ca / cw / cn) + small-radius extras (class 0)
      let a = 0, w = 0, nz = 0, aS = 0, wS = 0, nS = 0;
      let ca = 1, cw = 0, cn = 0;
      if (functional) {
        const act0 = activity(inf, b, jobsUnknown);
        let act = 0.3 + 0.7 * act0;
        if (inf.powerOut > 0 && !inf.isIncinerator) {
          const load = utilities ? utilities.plantLoad(b.id) : -1;
          if (load >= 0) act = PLANT_IDLE_ACT + (1 - PLANT_IDLE_ACT) * load;
          // a plant delivering nothing (shut down by the nuclear-free zone) neither smokes nor hums
          if (utilities && utilities.producerInfo(b.id)?.output === 0) act = 0;
        } else if (inf.isIncinerator) {
          const s = incShare[b.id];
          if (s >= 0) act = INCIN_IDLE_ACT + (1 - INCIN_IDLE_ACT) * s;
        }
        const industrial = inf.fam === Fam.I || inf.powerOut > 0;
        const airMul = fx.air * (industrial ? fx.airIndustry : 1) * (inf.category === 'power' ? fx3.airPower : 1);
        const waterMul = fx.water * (inf.fam === Fam.I ? fx.waterIndustry : 1);
        const noiseMul = inf.fam === Fam.C || inf.fam === Fam.I ? fx3.noise : 1;
        if (inf.air !== 0 || inf.waterPoll !== 0 || inf.noise !== 0) {
          // catalog semantics: intensity (0..1 overlay scale) at the source, falling off to 0 at radius
          const R = inf.pollRadius > 0 ? inf.pollRadius : 3;
          ca = R <= 6 ? 0 : R <= 13 ? 1 : 2;
          cw = cn = R <= 8 ? 0 : 1;
          a = intensityToSource(inf.air, airK) * act * airMul;
          w = intensityToSource(inf.waterPoll, waterK) * (inf.waterPoll > 0 ? act * waterMul : util);
          nz = intensityToSource(inf.noise, noiseK) * act * noiseMul;
          if (inf.waterPoll > 0 && inf.fam === Fam.Plop) {
            const sv = SOIL_SRC_PLOPPED * inf.waterPoll * act;
            for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if (x < N && z < N) soilSrc[z * N + x] += sv;
          }
        } else if (inf.fam === Fam.I) {
          // fallback when the def carries no explicit pollution: per active job by industry type
          const k = IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))];
          const j = activeJobs(inf, b, jobsUnknown);
          a = j * AIR_PER_JOB[k] * airMul;
          w = j * WATER_POLL_PER_JOB[k] * waterMul;
          nz = j * NOISE_PER_JOB[k] * noiseMul;
        }
        if (inf.fam === Fam.I) {
          const sv = SOIL_SRC_IND[IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))]] * act0;
          if (sv > 0) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if (x < N && z < N) soilSrc[z * N + x] += sv;
        } else if (inf.fam === Fam.R) {
          wS += b.pop * SEWAGE_PER_RES * sewageMul;
          aS += b.pop * heat * HEAT_WEALTH[wealthOf(inf, b) - 1];
        } else if (inf.fam === Fam.C) {
          if (inf.dev >= DevType.CS1 && inf.dev <= DevType.CS3) aS += activeJobs(inf, b, jobsUnknown) * AIR_PER_CS_JOB * fx.air;
          if ((inf.dev === DevType.CS2 || inf.dev === DevType.CS3) && zone[b.z * N + b.x] === Zone.ComHigh) nS += nightSrc * act0 * area;
        }
        if (inf.isPark) {
          parkSig = (parkSig * 31 + b.id * 7 + b.x * 3 + b.z) % 1000000007;
          for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if (x < N && z < N) park[z * N + x] = 1;
        }
      } else if (constructing) {
        aS += conAir * area;
        nS += conNoise * area;
      }
      if (onFire) aS += fireAir * Math.sqrt(area);
      if (a === 0 && w === 0 && nz === 0 && aS === 0 && wS === 0 && nS === 0) continue;
      airById[b.id] = a + aS;
      const inv = 1 / area;
      const ia = a * inv, iw = w * inv, inz = nz * inv, iaS = aS * inv, iwS = wS * inv, inS = nS * inv;
      const A = air[ca], W = waterS[cw], Nz = noiseS[cn], A0 = air[0], W0 = waterS[0], N0 = noiseS[0];
      if (ia !== 0) used[ca] = 1;
      if (iw !== 0) used[3 + cw] = 1;
      if (inz !== 0) used[5 + cn] = 1;
      if (iaS !== 0) used[0] = 1;
      if (iwS !== 0) used[3] = 1;
      if (inS !== 0) used[5] = 1;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        if (x < 0 || z < 0 || x >= N || z >= N) continue;
        const i = z * N + x;
        A[i] += ia; W[i] += iw; Nz[i] += inz;
        A0[i] += iaS; W0[i] += iwS; N0[i] += inS;
      }
    }
    this.sbParkSig = parkSig;
  }

  /** stageA's end: the park signature, emergency incidents (WP8): spills / industrial fires, splatted like plopped emitters */
  private sbEnd(sim: Simulation): void {
    const st = sim.state;
    const N = st.size;
    const fx = this.fxB ?? readEffects(st);
    const air = this.air, waterS = this.waterS, used = this.usedCls;
    const airK = srcScale(AIR_K), waterK = srcScale(WATER_K);
    const parkSig = this.sbParkSig;
    if (parkSig !== this.parkSig) { this.parkSig = parkSig; this.parkDirty = true; }
    const em = emergencyPollution(sim);
    for (let k = 0; k < em.length; k++) {
      const e = em[k];
      if (!st.inBounds(e.x, e.z)) continue;
      const i = e.z * N + e.x;
      const R = e.radius > 0 ? e.radius : 3;
      const cA = R <= 6 ? 0 : R <= 13 ? 1 : 2, cW = R <= 8 ? 0 : 1;
      if (e.air) { air[cA][i] += intensityToSource(e.air, airK) * fx.air; used[cA] = 1; }
      if (e.water) { waterS[cW][i] += intensityToSource(e.water, waterK) * fx.water; used[3 + cW] = 1; }
    }
  }

  /** step 4: traffic / network / landfill / pile / soil cell sources, tree cover + park buffer (one go) */
  private stageCells(sim: Simulation): void {
    this.runStage(sim, S_SRC_CELLS, this.firstPass);
  }

  /** one piece of step 4; true when the state is complete */
  private srcCellsPiece(sim: Simulation): boolean {
    const st = sim.state;
    switch (this.sub) {
      case SC_CELLS:
        if (!this.progBuilt) {
          this.nOps = 0; this.opK = 0; this.opU = 0;
          this.scAnyA = this.scAnyN = this.scAnyW = false;
          this.rowOp(OP_CELLS, st.size, PC.cells);
          this.progBuilt = true;
          return false;
        }
        if (this.opsPiece(sim)) { this.sub = SC_ATTACH; this.progBuilt = false; }
        return false;
      case SC_ATTACH:
        // traffic's pending attachment refresh (a lazy cache freightRailCells would trigger) in a piece of its own (review
        // 2 item 5e, as services G2); no piece when it is current. A pure function of the state: no result moves.
        this.sub = SC_FREIGHT;
        if (this.attachUs(sim) > 0) {
          const tr = sim.getSystem('traffic') as unknown as AttachProbe | undefined;
          tr?.stopAttached?.(-1);
          return false;
        }
        return this.srcCellsPiece(sim);
      case SC_FREIGHT: this.scFreight(sim); this.sub = SC_TREES; this.progBuilt = false; return false;
      default:
        if (!this.progBuilt) { this.scTreesProgram(st); this.progBuilt = true; return false; }
        if (!this.opsPiece(sim)) return false;
        if (this.scTrees) st.treeCover.set(this.treeNext.subarray(0, st.cells));
        return true;
    }
  }

  /** srcCells' cell loop over [i0, i1) (pre-B2's body; the any-source ORs in fields) */
  private cellRows(sim: Simulation, i0: number, i1: number): void {
    const st = sim.state;
    const fx = this.fxB ?? readEffects(st);
    const fx3 = this.fx3B ?? wp3Effects(st);
    const waterK = srcScale(WATER_K), noiseK = srcScale(NOISE_K);
    const traffic = st.traffic, cong = st.congestion, net = st.network, nf = st.netFlags, bld = st.building;
    const A0 = this.air[0], W0 = this.waterS[0], N0 = this.noiseS[0];
    const trafficAir = AIR_PER_TRIP * fx.air;
    const tn = fx3.noiseTraffic;
    const perTrip = NOISE_PER_TRIP_NET, base = baseNoiseSources(noiseK);
    const crossing = intensityToSource(NOISE_CROSSING, noiseK) * tn;
    let anyA = this.scAnyA, anyN = this.scAnyN, anyW = this.scAnyW;
    // uncollected garbage piles smell; contaminated soil leaches into ground water
    const G = st.garbage, soil = st.soil;
    const smell = areaSource(GARBAGE_SMELL, AIR_K) * fx.air;
    for (let i = i0; i < i1; i++) {
      const g = G[i];
      if (g > 0.02 && bld[i] >= 0) { A0[i] += smell * g; anyA = true; }
      const so = soil[i];
      if (so > 0.005) { W0[i] += intensityToSource(SOIL_GROUNDWATER * so, waterK); anyW = true; }
      const n = net[i];
      if (n === 0) continue;
      const t = traffic[i];
      const f = nf[i];
      let nz = 0;
      if (n <= Network.Highway) {
        if (t > 0) {
          const c = cong[i];
          A0[i] += t * trafficAir * (1 + (c < 2 ? c : 2)) * ((f & 2) !== 0 ? TUNNEL_AIR : 1);
          anyA = true;
          const damp = c > 1 ? 1 - NOISE_CONG_DAMP * (c < 2 ? c - 1 : 1) : 1;
          nz = t * perTrip[n] * damp;
        }
        nz += base[n];
        if ((f & 0x20) !== 0) nz += crossing;
      } else if (n === Network.Rail) nz = t * NOISE_PER_TRIP * 0.2 + base[Network.Rail];
      if (nz > 0) {
        if ((f & 2) !== 0) nz *= TUNNEL_NOISE;
        else if ((f & 1) !== 0) nz *= BRIDGE_NOISE;
        N0[i] += nz * tn;
        anyN = true;
      }
    }
    this.scAnyA = anyA; this.scAnyN = anyN; this.scAnyW = anyW;
  }

  /** freight trains, the used flags, landfill cells (pre-B2's stageCells after the cell loop) */
  private scFreight(sim: Simulation): void {
    const st = sim.state;
    const C = st.cells;
    const fx = this.fxB ?? readEffects(st);
    const fx3 = this.fx3B ?? wp3Effects(st);
    const airK = srcScale(AIR_K), waterK = srcScale(WATER_K), noiseK = srcScale(NOISE_K);
    const A0 = this.air[0], W0 = this.waterS[0], N0 = this.noiseS[0];
    const used = this.usedCls;
    const tn = fx3.noiseTraffic;
    let anyN = this.scAnyN;
    // freight trains (WP7 exposes the cells of freight routes; skipped until then)
    const tr = sim.getSystem('traffic') as unknown as { freightRailCells?: () => ArrayLike<number> } | undefined;
    const fr = typeof tr?.freightRailCells === 'function' ? tr.freightRailCells() : null;
    if (fr && fr.length > 0) {
      const s = intensityToSource(NOISE_FREIGHT_RAIL, noiseK) * tn;
      for (let k = 0; k < fr.length; k++) { const i = fr[k]; if (i >= 0 && i < C) N0[i] += s; }
      anyN = true;
    }
    if (this.scAnyA) used[0] = 1;
    if (anyN) used[5] = 1;
    if (this.scAnyW) used[3] = 1;
    // landfill cells: emission by use, damped for big landfills (sources do not add up without bound)
    const lf = getDef('util_landfill_tile')?.pollution;
    const lfAir = lf ? intensityToSource(lf.air ?? 0, airK) * fx.air : LANDFILL_AIR;
    const lfWater = lf ? intensityToSource(lf.water ?? 0, waterK) * fx.water : 0;
    const lfNoise = lf ? intensityToSource(lf.noise ?? 0, noiseK) : 0;
    const soilSrc = this.soilSrc;
    for (let r = 0; r < this.nReg; r++) {
      const s = this.regStart[r], n = this.regCount[r];
      const use = this.regCap[r] > 0 ? Math.min(1, this.regUsed[r] / this.regCap[r]) : 0;
      const act = LANDFILL_IDLE_EMIT + (1 - LANDFILL_IDLE_EMIT) * use;
      const m = act / Math.sqrt(Math.max(1, n / LANDFILL_SIZE_REF));
      for (let q = 0; q < n; q++) {
        const i = this.lfOrder[s + q];
        A0[i] += lfAir * m; W0[i] += lfWater * m; N0[i] += lfNoise * m;
        soilSrc[i] += SOIL_SRC_LANDFILL * act;
      }
      if (n > 0) { used[0] = 1; used[3] = 1; used[5] = 1; }
    }
  }

  /**
   * tree cover (published) and the park buffer only change with trees / parks: their program (updateTreeCover into the
   * private treeNext, published by one .set() at the program's end; then the park buffer). Each dirty flag is cleared
   * here, in the piece that decides on it, as pre-B2.
   */
  private scTreesProgram(st: CityState): void {
    const N = st.size, C = st.cells;
    this.nOps = 0; this.opK = 0; this.opU = 0;
    this.scTrees = this.treesDirty || this.firstPass;
    if (this.scTrees) {
      this.treesDirty = false;
      if (this.treeNear.length !== C) this.treeNear = new Float32Array(C);
      this.nearN = 0;
      this.rowOp(OP_TREES, N, PC.trees);
      this.opBoxAverage(this.tmp, this.treeNext, this.tmp2, N, TREE_COVER_RADIUS);
      this.opBoxAverage(this.tmp, this.treeNear, this.tmp2, N, TREE_BELT_REACH);
      this.rowOp(OP_COUNT, N, PC.count);
    }
    if (this.parkDirty || this.firstPass) {
      this.parkDirty = false;
      this.opBoxAverage(this.parkMask, this.parkBuf, this.tmp2, N, TREE_COVER_RADIUS);
    }
  }

  /** treeCover = (2r+1)^2 box average of trees / 4 (published, derived: also computed in init); treeNear (tree belts) */
  private updateTreeCover(st: CityState): void {
    const C = st.cells, trees = st.trees, t = this.tmp;
    for (let i = 0; i < C; i++) t[i] = trees[i] * 0.25;
    boxAverage(t, st.treeCover, this.tmp2, st.size, TREE_COVER_RADIUS);
    if (this.treeNear.length !== C) this.treeNear = new Float32Array(C);
    const near = this.treeNear;
    boxAverage(t, near, this.tmp2, st.size, TREE_BELT_REACH);
    let n = 0;
    for (let i = 0; i < C; i++) if (near[i] > 0) n++;
    this.nearShare = C > 0 ? n / C : 0;
  }

  /** step 5: small / medium emitter classes (half resolution) into the air field (this.tmp2) (one go) */
  private stageAirNear(sim: Simulation): void {
    this.runStage(sim, S_AIR_NEAR, this.firstPass);
  }

  /** one piece of step 5 (its program: pre-B2's stageAirNear as field ops) */
  private airNearPiece(sim: Simulation): boolean {
    const st = sim.state;
    if (!this.progBuilt) {
      const N = st.size, air = this.air, used = this.usedCls;
      this.nOps = 0; this.opK = 0; this.opU = 0;
      const field = this.tmp2;
      this.opFill(field, st.cells);
      if (used[0] || used[1]) {
        // both classes blur at half resolution into one coarse field (class 0: radius 1 -> sigma^2 = 4 * 2 = 8 cells^2,
        // ~ full-res radius 2), then the plume: the average of two copies drifted d/2 and d downwind (as for the far class)
        const M = Math.ceil(N / 2), MM = M * M;
        if (this.coarseAcc.length < MM) this.coarseAcc = new Float32Array(MM);
        const acc = this.coarseAcc;
        this.opFill(acc, MM);
        if (used[0]) {
          this.opBlurDown(air[0], N, 2, 1);
          this.opAcc(acc, M, POLL_PEAK_GAIN * 2 * Math.PI * 8);
        }
        if (used[1]) {
          const rr = Math.max(1, Math.round(POLL_RADII[1] / 2));
          this.opBlurDown(air[1], N, 2, rr);
          this.opAcc(acc, M, POLL_PEAK_GAIN * 2 * Math.PI * 4 * blurSigma2(rr));
        }
        const w = windVector(st), d = WIND_DRIFT_PREVAIL;
        this.opUp(acc, field, N, 2, 0.5, w.x * d * 0.5, w.z * d * 0.5);
        this.opUp(acc, field, N, 2, 0.5, w.x * d, w.z * d);
      }
      this.progBuilt = true;
      return false;
    }
    return this.opsPiece(sim);
  }

  /** acc[m] += coarse[m] * g over the M x M coarse cells, by coarse rows */
  private opAcc(acc: Float32Array, M: number, g: number): void {
    const op = this.addOp(OP_ACC, M, PC.acc * M, Math.max(PC.acc, INFRA_CELL_SIZING_US) * M);
    op.a = acc; op.b = this.coarse; op.n = M; op.g = g;
  }

  /** step 6: large emitters (quarter resolution, long plumes), saturation + tree absorption + smoothing (one go) */
  private stageAir(sim: Simulation, first: boolean): void {
    this.runStage(sim, S_AIR_FAR, first);
  }

  /** one piece of step 6: the plume ops, saturate into the private airNext, its publish (one .set() of st.airPollution) */
  private airFarPiece(sim: Simulation): boolean {
    const st = sim.state;
    if (!this.progBuilt) {
      const N = st.size, C = st.cells, used = this.usedCls;
      this.nOps = 0; this.opK = 0; this.opU = 0;
      const field = this.tmp2;
      if (used[2]) {
        const rr = Math.max(1, Math.round(POLL_RADII[2] / 4));
        // (plume(): blurDown f = 4, then the average of two copies drifted d/2 and d downwind)
        const gain = POLL_PEAK_GAIN * 2 * Math.PI * 16 * blurSigma2(rr), w = windVector(st), d = WIND_DRIFT_FAR;
        this.opBlurDown(this.air[2], N, 4, rr);
        this.opUp(this.coarse, field, N, 4, gain * 0.5, w.x * d * 0.5, w.z * d * 0.5);
        this.opUp(this.coarse, field, N, 4, gain * 0.5, w.x * d, w.z * d);
      }
      this.opCopy(this.airNext, st.airPollution, C);
      this.opSat(field, this.airNext, N, 1 / AIR_K, this.firstPass ? 1 : POLL_SMOOTH, null, st.treeCover, TREE_AIR_ABSORB, null, 0);
      this.opCopy(st.airPollution, this.airNext, C);
      this.progBuilt = true;
      return false;
    }
    return this.opsPiece(sim);
  }

  /** step 7: noise layer (trees, parks and tree belts between the noise and a cell buffer it) (one go) */
  private stageNoise(sim: Simulation, first: boolean): void {
    this.runStage(sim, S_NOISE, first);
  }

  /** one piece of step 7: blurPair as ops, noiseBuffer by rows, saturate into the private noiseNext, its publish */
  private noisePiece(sim: Simulation): boolean {
    const st = sim.state;
    if (!this.progBuilt) {
      const N = st.size, C = st.cells;
      if (this.treeNear.length !== C) this.updateTreeCover(st); // (uses tmp: before the blur below)
      this.nOps = 0; this.opK = 0; this.opU = 0;
      this.opBlurPair(this.noiseS, 5, this.tmp, N);
      if (this.noiseBuf.length !== C) this.noiseBuf = new Float32Array(C);
      const nb = this.addOp(OP_NOISEBUF, N, (PC.noiseBuf + PC.walk * this.nearShare) * N, Math.max(PC.noiseBuf + PC.walk * this.nearShare, INFRA_CELL_SIZING_US) * N);
      nb.n = N;
      this.opCopy(this.noiseNext, st.noise, C);
      this.opSat(this.tmp, this.noiseNext, N, 1 / NOISE_K, this.firstPass ? 1 : POLL_SMOOTH, null, this.noiseBuf, 1, null, 0);
      this.opCopy(st.noise, this.noiseNext, C);
      this.progBuilt = true;
      return false;
    }
    return this.opsPiece(sim);
  }

  /** blurPair(src, usedBase, out, N) as ops: out cleared; class 0 half res r = 1 (sigma^2 = 8), class 1 quarter res r = 2 */
  private opBlurPair(src: Float32Array[], usedBase: number, out: Float32Array, N: number): void {
    this.opFill(out, N * N);
    if (this.usedCls[usedBase]) {
      this.opBlurDown(src[0], N, 2, 1);
      this.opUp(this.coarse, out, N, 2, POLL_PEAK_GAIN * 2 * Math.PI * 8, 0, 0);
    }
    if (this.usedCls[usedBase + 1]) {
      this.opBlurDown(src[1], N, 4, 2);
      this.opUp(this.coarse, out, N, 4, POLL_PEAK_GAIN * 2 * Math.PI * 96, 0, 0);
    }
  }

  /** step 8 (stageB): water pollution (ground water + diffusion along water bodies + bank coupling) (one go; tests call it) */
  private stageB(sim: Simulation, first: boolean): void {
    this.runStage(sim, S_WATER, first);
  }

  /**
   * one piece of step 8: the blur, cleaning and ground program; the water list (only here: a rebuild replaces the
   * arrays, and this stage keeps its references — review 1 R5; a terrain change during the stage is picked up by the next
   * pass); the diffusion program on the private wNext, published by one .set() of st.waterPollution
   */
  private waterPiece(sim: Simulation): boolean {
    const st = sim.state;
    const N = st.size, C = st.cells;
    switch (this.sub) {
      case WA_OPS:
        if (!this.progBuilt) {
          this.ensureCells(st);
          this.nOps = 0; this.opK = 0; this.opU = 0;
          const alpha = this.firstPass ? 1 : POLL_SMOOTH;
          this.opBlurPair(this.waterS, 3, this.tmp, N);
          this.opCopy(this.wNext, st.waterPollution, C);
          this.rowOp(OP_CLEAN, N, PC.clean);
          // ground water of land cells (kept separately so bank coupling does not feed back into the water bodies)
          this.opSat(this.tmp, this.ground, N, 1 / WATER_K, alpha, st.water, null, 0, null, 0);
          this.progBuilt = true;
          return false;
        }
        if (this.opsPiece(sim)) { this.sub = WA_LIST; this.cur = 0; this.wlPh = 0; this.progBuilt = false; }
        return false;
      case WA_LIST:
        if (this.waterListPiece(st)) { this.sub = WA_DIFF; this.progBuilt = false; }
        return false;
      default:
        if (!this.progBuilt) {
          this.nOps = 0; this.opK = 0; this.opU = 0;
          // diffusion over water cells (precomputed list + 4 neighbour slots: water idx or -(land cell)-1)
          const nW = this.waNW;
          this.listOp(OP_WINIT, nW, PC.wcopy);
          const iters = 8;
          for (let it = 0; it < iters; it++) {
            this.listOp(OP_WDIFF, nW, PC.diff);
            this.listOp(OP_WCOPY, nW, PC.wcopy);
          }
          this.listOp(OP_WBACK, nW, PC.wcopy);
          this.rowOp(OP_LAND, N, PC.land);
          this.listOp(OP_BANK, this.waBank.length, PC.bank);
          this.opCopy(st.waterPollution, this.wNext, C);
          this.progBuilt = true;
          return false;
        }
        return this.opsPiece(sim);
    }
  }

  /** one sweep of the diffusion over the water cells [q0, q1): cur (tmp2) is fixed during a sweep, nxt (tmp) is written */
  private diffuseRange(q0: number, q1: number): void {
    const cur = this.tmp2, nxt = this.tmp, wnb = this.waNb, ground = this.ground;
    for (let q = q0; q < q1; q++) {
      let s = cur[q], n = 1, inflow = 0;
      const b = q * 4;
      for (let k = 0; k < 4; k++) {
        const t = wnb[b + k];
        if (t === 0x7fffffff) continue;
        if (t >= 0) { s += cur[t]; n++; }
        else { const lv = ground[-t - 1]; if (lv > inflow) inflow = lv; }
      }
      const v = (s / n) * WATER_DIFFUSE_KEEP + inflow * 0.12;
      nxt[q] = v > 1 ? 1 : v;
    }
  }

  /**
   * the water list for this stage: when valid, its references; else ensureWaterList in pieces (the numbering, the cell
   * lists, the bank seeds and the bank BFS by ranges, into private buffers; installed at the end exactly as the whole
   * build). True when the stage's references are set.
   */
  private waterListPiece(st: CityState): boolean {
    const N = st.size, C = st.cells, wm = st.water;
    if (this.wlPh === WL_IDX && this.cur === 0) {
      if (this.nWater >= 0 && this.waterVersion === st.cells) { this.captureWater(); return true; }
      this.wlEpoch = this.waterEpoch;
      if (this.wlIdx.length !== C) { this.wlIdx = new Int32Array(C); this.wlSrc = new Int32Array(C); this.wlDist = new Uint8Array(C); this.wlQueue = new Int32Array(C); }
      this.wlIdx.fill(-1);
      this.wlN = 0;
    }
    const i1 = (us: number) => Math.min(C, this.cur + cellUnits(us));
    switch (this.wlPh) {
      case WL_IDX: {
        const idx = this.wlIdx, e = i1(PC.wlIdx);
        let n = this.wlN;
        for (let i = this.cur; i < e; i++) if (wm[i]) idx[i] = n++;
        this.wlN = n;
        this.cur = e;
        if (e >= C) {
          this.wlCells = new Int32Array(n);
          this.wlNbN = new Int32Array(n * 4);
          this.wlPh = WL_NB; this.cur = 0; this.wlQ = 0;
        }
        return false;
      }
      case WL_NB: {
        const idx = this.wlIdx, cells = this.wlCells, nbs = this.wlNbN, e = i1(PC.wlNb);
        let q = this.wlQ;
        for (let i = this.cur; i < e; i++) {
          if (!wm[i]) continue;
          cells[q] = i;
          const x = i % N, z = (i - x) / N;
          for (let k = 0; k < 4; k++) {
            const nx = x + DX[k], nz = z + DZ[k];
            let t = 0x7fffffff;
            if (nx >= 0 && nz >= 0 && nx < N && nz < N) {
              const j = nz * N + nx;
              t = wm[j] ? idx[j] : -j - 1;
            }
            nbs[q * 4 + k] = t;
          }
          q++;
        }
        this.wlQ = q;
        this.cur = e;
        if (e >= C) {
          // bank cells: land within BANK_DIST (4-neighbour steps) of water, each coupled to the water cell it was reached from
          this.wlSrc.fill(-1);
          this.wlDist.fill(0);
          this.wlQh = 0; this.wlQt = 0;
          this.wlBank = []; this.wlBankSrc = [];
          this.wlPh = WL_SEED; this.cur = 0;
        }
        return false;
      }
      case WL_SEED: {
        const src = this.wlSrc, queue = this.wlQueue, e = i1(PC.wlIdx);
        let qt = this.wlQt;
        for (let i = this.cur; i < e; i++) if (wm[i]) { src[i] = i; queue[qt++] = i; }
        this.wlQt = qt;
        this.cur = e;
        if (e >= C) { this.wlPh = WL_BFS; this.cur = 0; }
        return false;
      }
      default: {
        const src = this.wlSrc, dist = this.wlDist, queue = this.wlQueue, bank = this.wlBank, bankSrc = this.wlBankSrc;
        let qh = this.wlQh, qt = this.wlQt;
        const qEnd = qh + cellUnits(PC.wlBfs);
        while (qh < qt && qh < qEnd) {
          const i = queue[qh++];
          const d = dist[i];
          if (d >= BANK_DIST) continue;
          const x = i % N;
          // (pre-B2's neighbour order: left, right, up, down)
          for (let k = 0; k < 4; k++) {
            const j = k === 0 ? (x > 0 ? i - 1 : -1) : k === 1 ? (x < N - 1 ? i + 1 : -1) : k === 2 ? (i >= N ? i - N : -1) : (i + N < C ? i + N : -1);
            if (j < 0 || src[j] >= 0) continue;
            src[j] = src[i];
            dist[j] = d + 1;
            queue[qt++] = j;
            bank.push(j);
            bankSrc.push(src[i]);
          }
        }
        this.wlQh = qh; this.wlQt = qt;
        if (qh < qt) return false;
        // install (ensureWaterList's results; a terrain change since this build started keeps the list invalid, so the
        // next pass rebuilds it — this stage uses the list it built)
        this.waterCells = this.wlCells;
        this.waterNb = this.wlNbN;
        this.nWater = this.wlEpoch === this.waterEpoch ? this.wlN : -1;
        this.waterVersion = C;
        this.bankCells = Int32Array.from(bank);
        this.bankSrc = Int32Array.from(bankSrc);
        this.wlCells = this.wlNbN = new Int32Array(0);
        this.wlBank = []; this.wlBankSrc = [];
        this.captureWater();
        this.waNW = this.wlN;
        return true;
      }
    }
  }

  /** the stage's references to the current water list */
  private captureWater(): void {
    this.waCells = this.waterCells;
    this.waNb = this.waterNb;
    this.waNW = this.nWater;
    this.waBank = this.bankCells;
    this.waBankSrc = this.bankSrc;
  }

  /** step 9: soil stock, flags & stats (one go) */
  private stageFlags(sim: Simulation): void {
    this.runStage(sim, S_FLAGS, this.firstPass);
  }

  /** one piece of step 9; true when the pass is complete */
  private flagsPiece(sim: Simulation): boolean {
    const st = sim.state;
    switch (this.sub) {
      case FL_SOIL:
        if (!this.progBuilt) {
          this.nOps = 0; this.opK = 0; this.opU = 0;
          // soil contamination (stock): builds up under sources, decays slowly (brownfield cleanup speeds it up) — on the
          // private soilNext, published by one .set() (st.soil is saved: R9)
          if (this.dtMonthsB > 0) {
            this.opCopy(this.soilNext, st.soil, st.cells);
            this.rowOp(OP_SOIL, st.size, PC.soil);
            this.opCopy(st.soil, this.soilNext, st.cells);
          }
          this.flPolSum = 0; this.flPolN = 0; this.flResW = 0; this.flNSum = 0; this.flASum = 0; this.flWSum = 0;
          this.cand.length = 0;
          this.progBuilt = true;
          return false;
        }
        if (this.opsPiece(sim)) { this.sub = FL_BLD; this.cur = 0; this.progBuilt = false; }
        return false;
      case FL_BLD:
        if (this.cur < this.snap.chunks) this.flBuildings(st, this.cur++);
        if (this.cur >= this.snap.chunks) this.sub = FL_PUB;
        return false;
      case FL_PUB: {
        // (the publish piece: the flags in snapshot order — pre-B2's changed list — and stats.avg*)
        const list = this.snap.list, changed = this.changed;
        changed.length = 0;
        for (let k = 0; k < this.cand.length; k++) {
          const q = this.cand[k];
          const b = list[q >> 2];
          let f = setFlagQuiet(b, BF.Polluted, (q & 1) !== 0);
          if (setFlagQuiet(b, BF.Noisy, (q & 2) !== 0)) f = true;
          if (f) changed.push(b);
        }
        const s = st.stats;
        s.avgPollution = this.flPolN > 0 ? this.flPolSum / this.flPolN : 0;
        s.avgNoise = this.flResW > 0 ? this.flNSum / this.flResW : 0;
        s.avgAir = this.flResW > 0 ? this.flASum / this.flResW : 0;
        s.avgWaterPollution = this.flResW > 0 ? this.flWSum / this.flResW : 0;
        this.sub = FL_EV;
        this.cur = 0;
        return false;
      }
      default: {
        const changed = this.changed;
        const k1 = Math.min(changed.length, this.cur + pieceUnits(PC.event, 1, COLD));
        for (let k = this.cur; k < k1; k++) {
          const b = changed[k];
          // (R4: a snapshot building removed since gets no event; in an uninterrupted pass every one is live)
          if (st.buildings.get(b.id) === b) sim.events.emit('buildingChanged', b);
        }
        this.cur = k1;
        if (k1 < changed.length) return false;
        sim.events.emit('layerUpdated', 'pollution');
        return true;
      }
    }
  }

  /** the soil stock over cells [i0, i1) of soilNext (pre-B2's loop body) */
  private soilRows(st: CityState, i0: number, i1: number): void {
    const fx3 = this.fx3B ?? wp3Effects(st);
    const dt = this.dtMonthsB;
    const soil = this.soilNext, src = this.soilSrc;
    const grow = SOIL_RATE * dt, keep = Math.max(0, 1 - SOIL_DECAY * dt * fx3.soilDecay);
    for (let i = i0; i < i1; i++) {
      let s = soil[i];
      const q = src[i];
      if (s === 0 && q === 0) continue;
      if (q > 0) s += grow * Math.min(1, q) * (1 - s);
      s *= keep;
      soil[i] = s < 1e-4 ? 0 : s;
    }
  }

  /** chunk k: the weighted sums (doubles, list order) and the buildings whose Polluted / Noisy bits flip */
  private flBuildings(st: CityState, k: number): void {
    const N = st.size;
    const airL = st.airPollution, waterL = st.waterPollution, noiseL = st.noise;
    const list = this.snap.list, cand = this.cand;
    let polSum = this.flPolSum, polN = this.flPolN, resW = this.flResW, nSum = this.flNSum, aSum = this.flASum, wSum = this.flWSum;
    for (let bI = this.snap.bounds[k], b1 = this.snap.bounds[k + 1]; bI < b1; bI++) {
      const b = list[bI];
      const cx = Math.min(N - 1, b.x + (b.w >> 1)), cz = Math.min(N - 1, b.z + (b.d >> 1));
      const i = cz * N + cx;
      const a = airL[i], w = waterL[i], nz = noiseL[i];
      const weight = b.pop > 0 ? b.pop : Math.max(1, b.jobs * 0.5);
      polSum += (0.75 * a + 0.25 * w) * weight;
      polN += weight;
      const fam = this.info(st, b).fam;
      const isR = fam === Fam.R;
      if (isR && b.pop > 0) { resW += b.pop; nSum += nz * b.pop; aSum += a * b.pop; wSum += w * b.pop; }
      // the Polluted chip matters to people living / shopping there, not to factories and plants
      const pol = (isR || fam === Fam.C) && (a > POLLUTED_THRESHOLD || w > 0.6);
      const noisy = isR && nz > NOISY_THRESHOLD;
      if (((b.flags & BF.Polluted) !== 0) !== pol || ((b.flags & BF.Noisy) !== 0) !== noisy) cand.push(bI * 4 + (pol ? 1 : 0) + (noisy ? 2 : 0));
    }
    this.flPolSum = polSum; this.flPolN = polN; this.flResW = resW; this.flNSum = nSum; this.flASum = aSum; this.flWSum = wSum;
  }

  /** mark water topology dirty (terrain changed) */
  invalidateWater(): void {
    this.nWater = -1;
    this.waterEpoch++;
  }
}

/** blurred noise field below which a cell is quiet enough for a belt not to matter (layer 1 - exp(-f / NOISE_K) < 0.2):
 *  no tree-belt walk there (PERF: a wooded city has trees near most cells) */
const BELT_MIN_FIELD = -NOISE_K * Math.log(1 - 0.2);
/** tan(22.5°): a gradient component below this share of the other one does not step along its axis (8 directions) */
const OCT = 0.4142;
/**
 * the noise buffer per cell (after saturation the layer is x (1 - buf)): TREE_NOISE_ABSORB x treeCover + PARK_NOISE_ABSORB
 * x park buffer + TREE_BELT_ABSORB x belt. Belt (final fixes F4): the tree density on the cells up to TREE_BELT_REACH
 * steps toward the noise — up the gradient of the blurred field in one of 8 directions, stopping where the field stops
 * rising (past the source, so trees on the far side of the road do not count) — as a share of a full belt of
 * TREE_BELT_CELLS wooded cells. Only cells with a tree within reach (treeNear > 0) and some noise are walked.
 */
function noiseBuffer(field: Float32Array, trees: Uint8Array, near: Float32Array, cover: Float32Array, park: Float32Array, out: Float32Array, N: number, z0 = 0, z1 = N): void {
  const R = TREE_BELT_REACH, inv = 0.25 / TREE_BELT_CELLS, kT = TREE_NOISE_ABSORB, kP = PARK_NOISE_ABSORB, kB = TREE_BELT_ABSORB;
  // (B2: rows [z0, z1) only — every cell reads the finished field; rows that cover [0, N) once give the whole buffer)
  for (let z = z0, i = z0 * N; z < z1; z++) {
    for (let x = 0; x < N; x++, i++) {
      let b = kT * cover[i] + kP * park[i];
      const f = field[i];
      if (f > BELT_MIN_FIELD && near[i] > 0) {
        const gx = (x + 1 < N ? field[i + 1] : f) - (x > 0 ? field[i - 1] : f);
        const gz = (z + 1 < N ? field[i + N] : f) - (z > 0 ? field[i - N] : f);
        const ax = gx < 0 ? -gx : gx, az = gz < 0 ? -gz : gz;
        if (ax + az > 1e-6) {
          const sx = ax > OCT * az ? (gx > 0 ? 1 : -1) : 0;
          const sz = az > OCT * ax ? (gz > 0 ? 1 : -1) : 0;
          const step = sz * N + sx;
          let xx = x, zz = z, j = i, prev = f, sum = 0;
          for (let k = 0; k < R; k++) {
            xx += sx; zz += sz;
            if (xx < 0 || zz < 0 || xx >= N || zz >= N) break;
            j += step;
            const fj = field[j];
            if (fj < prev) break;
            prev = fj;
            sum += trees[j];
          }
          if (sum > 0) b += kB * (sum * inv < 1 ? sum * inv : 1);
        }
      }
      out[i] = b;
    }
  }
}

/** true when a road cell (street .. highway) touches the building's edge (corners excluded): trucks can stop there */
function roadOnEdge(st: CityState, b: Building): boolean {
  const N = st.size, net = st.network;
  const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d;
  for (let x = x0; x < x1; x++) {
    if (x < 0 || x >= N) continue;
    if (z0 > 0 && isRoad(net[(z0 - 1) * N + x] as Network)) return true;
    if (z1 < N && isRoad(net[z1 * N + x] as Network)) return true;
  }
  for (let z = z0; z < z1; z++) {
    if (z < 0 || z >= N) continue;
    if (x0 > 0 && isRoad(net[z * N + x0 - 1] as Network)) return true;
    if (x1 < N && isRoad(net[z * N + x1] as Network)) return true;
  }
  return false;
}

let baseSrcKey = -1;
let baseSrc: Float32Array = new Float32Array(0);
/** per-network base noise source strengths (cached for the noise scale) */
function baseNoiseSources(noiseK: number): Float32Array {
  if (noiseK === baseSrcKey) return baseSrc;
  baseSrcKey = noiseK;
  baseSrc = Float32Array.from(NET_BASE_NOISE, (I) => intensityToSource(I, noiseK));
  return baseSrc;
}

/** the pollution system of a simulation */
export function getPollution(sim: Simulation): PollutionSystem | undefined {
  return sim.getSystem<PollutionSystem>('pollution');
}
