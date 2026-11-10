/**
 * Attraction, tourism, hotels, attractiveness and regional migration (SIM_DEPTH_SPEC WP4). Headless: no DOM / three.js.
 *
 * Schedule (B3; WASM_PLAN B3 / WORKER_DESIGN S4: the month tick carried 12–28 ms of tourism at 1M): 1–3 are the VENUE
 * PASS, which daily() runs on day TOURISM_DAY of the month (after that day's growables slice) and saves as
 * systemData.tourismPass, from which init() restores a loaded city's venue records and visitor raster exactly
 * (st.visitors is a derived layer that is not saved); 4 is the ATTRACT STEP of the month tick (monthly()): only what
 * needs the month's resident survey. refresh(sim) runs both now (tests, tools; init() of a new city or an old save).
 *  1. VENUES (ATTRACTIONS table, no catalog edits): visits V = min(capacity, draw × (A/60)^1.3 × access × op × sizeF ×
 *     ordinance 'tourism.draw'). access = road / freight reach of the block + transit coverage; op = functional ×
 *     powered × road next to the lot × funding (a burnt, unpowered, unfunded, striking or road-less venue gets 0 — and
 *     no cap relief, no income); sizeF grows with the city (nobody flies to a hamlet; parks / plazas / gardens /
 *     marinas are walk-in local leisure: exempt from sizeF and the road rule). BEACHES: clean, road-reachable, unbuilt
 *     shore cells of real water bodies. HISTORIC growables. A bulldozed venue leaves the totals at once.
 *  2. HOTELS: overnight visitors (30 %, +25 % with an international airport, +10 % municipal) need rooms (1.5 per hotel
 *     job of motels / hotels / hotel towers); without rooms 80 % of the overnight visitors stay away
 *     (econData.hotelShortage → WP6 grows hotels). Effective tourists → econData.tourism = CS jobs (50 per 100) that
 *     demand.ts adds to shop demand, a 'tourism' income line (budget.ts) and approval pride.
 *  3. VISITORS raster st.visitors (0..1, Tourism overlay) + rt.coarseVisitors (extra shop customers per block).
 *  4. ATTRACTIVENESS 0..100 (city-wide and per wealth): culture (landmark visits), parks, safety, clean air, quiet,
 *     services (schools / health served), jobs, connections. It feeds visits next month and MIGRATION: the whole
 *     R target of each wealth tier × clamp(1 + .25 (A_w − neutral)/45, .88, 1.12) (attractive cities pull residents,
 *     unattractive ones lose them; neutral 48 for a town → 66 for a metropolis; the pull fades out while unemployment
 *     is high), R$$ / R$$$ × (1 − .08 × unreached pupil share), plus retirees and university students who come
 *     without local jobs (econData.migrants).
 * The system is registered after population and before demand (systems/economy.ts).
 */
import { BF, type Building, type CityState } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import type { FactorTerm } from '../explain';
import { clamp, smoothstep } from '../../core/rng';
import { DAYS_PER_MONTH } from '../../core/constants';
import { DevType, Network } from '../../core/types';
import type { BuildingDef } from '../catalogTypes';
import { type EconRuntime, type InfraFlags, GROWABLE_SLICES, econData, infraFlags } from './runtime';
import { ordinanceEffect } from './ordinances';
import { onStrike, serviceEffectiveness } from './budget';
import { residentSurvey, toxicDumpOperating, type ResidentSurvey } from './approval';
import { lotTouchesRoad } from './buildings';
import { shoreCells } from '../infra/terrainMasks';
import { Transit } from '../infra/common';
import {
  APPROVAL_TERMS, ATTRACT_CITY_WEIGHTS, ATTRACT_CONNECT, ATTRACT_SCALES, ATTRACT_WEIGHTS, COARSE, COVERAGE_FALLBACK, CS_JOBS_PER_VISITOR, MIG_GAIN,
  MIG_BIG_POP, MIG_MAX, MIG_MIN, MIG_NEUTRAL, MIG_NEUTRAL_BIG, MIG_POP, MIG_SCHOOL, MIG_SPAN, MIG_UNEMP_SPAN, RETIREE_SPLIT, RETIREES,
  STUDENT_SPLIT, STUDENTS_PER_SEAT, TOURISM, UNEMP_NEUTRAL,
} from './tuning';

export interface AttractionDef {
  kind: 'landmark' | 'culture' | 'sport' | 'entertainment' | 'nature' | 'business' | 'transport';
  /** visitors / day at attractiveness 60 */
  draw: number;
  /** max visitors / day */
  capacity: number;
}

/** def id -> venue */
export const ATTRACTIONS: Readonly<Record<string, AttractionDef>> = {
  lm_lighthouse: { kind: 'landmark', draw: 400, capacity: 1500 },
  lm_clock_tower: { kind: 'landmark', draw: 600, capacity: 2500 },
  lm_obelisk: { kind: 'landmark', draw: 700, capacity: 3000 },
  lm_arch: { kind: 'landmark', draw: 900, capacity: 4000 },
  lm_observatory: { kind: 'culture', draw: 700, capacity: 3000 },
  lm_cathedral: { kind: 'landmark', draw: 1500, capacity: 6000 },
  lm_castle: { kind: 'landmark', draw: 1800, capacity: 7000 },
  lm_pyramid: { kind: 'landmark', draw: 2000, capacity: 8000 },
  lm_ferris_wheel: { kind: 'entertainment', draw: 2500, capacity: 9000 },
  lm_opera_house: { kind: 'culture', draw: 2500, capacity: 8000 },
  lm_spire_tower: { kind: 'landmark', draw: 3500, capacity: 12000 },
  lm_twin_spires: { kind: 'landmark', draw: 5000, capacity: 20000 },
  // LG-02: reference shop jobs (draw × 0.5) track the legacy C-relief points (C × 0.05).
  lm_central_library: { kind: 'culture', draw: 1000, capacity: 5000 },
  lm_grand_central: { kind: 'transport', draw: 2400, capacity: 12000 },
  lm_stock_exchange: { kind: 'business', draw: 1200, capacity: 6000 },
  lm_botanical_dome: { kind: 'culture', draw: 3500, capacity: 14000 },
  lm_world_trade_center: { kind: 'business', draw: 5000, capacity: 24000 },
  lm_millennium_tower: { kind: 'landmark', draw: 7000, capacity: 28000 },
  lm_metropolis_crown: { kind: 'landmark', draw: 6500, capacity: 32000 },
  civ_museum: { kind: 'culture', draw: 900, capacity: 4000 },
  civ_convention_center: { kind: 'business', draw: 2500, capacity: 6000 },
  civ_city_hall: { kind: 'landmark', draw: 200, capacity: 1000 },
  // (final fixes LD15b: was 3000 / 10000 — ~1,400 tourism shop jobs where the legacy formula counts 400 (cap relief C 8,000
  //  × 0.05), so a city that bought the zoo ran its tourism jobs 30–40 % above the old formula; the zoo is a residential
  //  cap boost first, its visitors are about a museum's)
  park_zoo: { kind: 'entertainment', draw: 900, capacity: 4000 },
  park_stadium: { kind: 'sport', draw: 5000, capacity: 40000 },
  park_amusement: { kind: 'entertainment', draw: 4500, capacity: 15000 },
  park_golf: { kind: 'sport', draw: 400, capacity: 1200 },
  park_marina: { kind: 'nature', draw: 500, capacity: 2000 },
  park_large: { kind: 'nature', draw: 250, capacity: 2000 },
  park_garden: { kind: 'nature', draw: 150, capacity: 800 },
  park_plaza: { kind: 'nature', draw: 100, capacity: 800 },
  rw_casino: { kind: 'entertainment', draw: 3000, capacity: 10000 },
  tr_airport_small: { kind: 'transport', draw: 1200, capacity: 5000 },
  tr_airport_large: { kind: 'transport', draw: 6000, capacity: 30000 },
  tr_seaport: { kind: 'transport', draw: 300, capacity: 2000 },
  tr_train_station: { kind: 'transport', draw: 150, capacity: 1000 },
  tr_ferry_terminal: { kind: 'transport', draw: 150, capacity: 800 },
};

/** hotel rooms per filled job of the hotel growables (by model id) */
export const HOTEL_ROOMS_PER_JOB: Readonly<Record<string, number>> = { com_motel: 1.5, com_hotel: 1.5, com_hotel_tower: 1.5 };

/** attractiveness score ids (order of ATTRACT_WEIGHTS columns) */
export const ATTRACT_IDS = ['culture', 'parks', 'safety', 'clean', 'quiet', 'services', 'jobs', 'connect'] as const;
export const ATTRACT_LABELS: Record<(typeof ATTRACT_IDS)[number], string> = {
  culture: 'Landmarks & culture',
  parks: 'Parks near homes',
  safety: 'Safety',
  clean: 'Clean air',
  quiet: 'Quiet streets',
  services: 'Schools & health care',
  jobs: 'Jobs',
  connect: 'Connections (highways, airports, rail)',
};

// ------------------------------------------------------------------------------------------------ derived state
interface VenueRecord {
  id: number;
  def: string;
  kind: AttractionDef['kind'];
  /** effective visits / day (after the hotel limit) */
  visits: number;
  /** visits before the hotel limit */
  gross: number;
  capacity: number;
  draw: number;
  op: number;
}
/** the venue records of the last venue pass, and that pass (the object saved as systemData.tourismPass) */
interface TourismState {
  venues: Map<number, VenueRecord>;
  pass: TourismPass;
}
const states = new WeakMap<CityState, TourismState>();

/**
 * systemData.tourismPass v1 (B3): the last venue pass — what the coming month tick scores (culture, conn, seats), the
 * parts of the totals the summary shows, the venue records (ven) and the visitor splats (spl) a loaded city restores
 * exactly — and what the last tick scored (tc, dump: the attractiveness breakdown's details, which stay with the tick's
 * bars). Plain data with typed arrays; ven and spl are fresh arrays every pass (a save taken without copy aliases
 * systemData). After the pass only onRemoved (culture, conn, tc) and the tick (tc, dump) change it.
 */
interface TourismPass {
  v: 1;
  /** the tick this pass feeds: ⌈day / 30⌉ on the pass's day, never monthIndex — written on TOURISM_DAY it equals the
   *  coming tick's monthIndex; written on a tick (its fallback), monthIndex would make every later tick re-run the pass */
  m: number;
  /** Σ gross visits of the landmark / culture venues (onRemoved subtracts; ≥ 0) */
  culture: number;
  /** operating [large airports, small airports, train stations, seaports] (connIndex; onRemoved decrements; ≥ 0) */
  conn: number[];
  /** Σ college seats × op (migrants: students) */
  seats: number;
  /** effective / gross visits after the hotel limit */
  kEff: number;
  /** beach / historic visitors after the hotel limit, beach cells (tourismSummary) */
  beach: number;
  historic: number;
  beachCells: number;
  /** [id, gross, op] per venue record, in pass order (visits = gross × kEff; closed venues included) */
  ven: Float64Array;
  /** [cx, cz, v] per visitor splat (v > 0), in pass order: venues, historic sites, beach blocks */
  spl: Float64Array;
  /** the culture visits the last tick scored (onRemoved subtracts; ≥ 0) */
  tc: number;
  /** a toxic waste dump operated at the last tick (clean-air image × (1 − APPROVAL_TERMS.dumpImage); final fixes V7) */
  dump: boolean;
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** a saved pass a loaded city can restore from (Float64Array: building ids above 2^24 must stay exact). Its m is not
 *  compared with the day: a pass that init() wrote on dom 1–25 legitimately carries monthIndex + 1 */
function validPass(p: unknown): p is TourismPass {
  if (!p || typeof p !== 'object') return false;
  const q = p as Partial<TourismPass>;
  return q.v === 1 && finite(q.m) && finite(q.culture) && finite(q.seats) && finite(q.kEff) && finite(q.beach)
    && finite(q.historic) && finite(q.beachCells) && finite(q.tc) && typeof q.dump === 'boolean'
    && Array.isArray(q.conn) && q.conn.length === 4 && q.conn.every(finite)
    && q.ven instanceof Float64Array && q.ven.length % 3 === 0 && q.spl instanceof Float64Array && q.spl.length % 3 === 0;
}
/** the city's saved venue pass, if it is valid */
function passOf(st: CityState): TourismPass | null {
  const p = st.systemData.tourismPass;
  return validPass(p) ? p : null;
}
/** TourismPass.conn index of a connection venue (the attractiveness 'connect' score; airports: the overnight share), −1 */
function connIndex(def: string): number {
  return def === 'tr_airport_large' ? 0 : def === 'tr_airport_small' ? 1 : def === 'tr_train_station' || def === 'lm_grand_central' ? 2 : def === 'tr_seaport' ? 3 : -1;
}

/** duck-typed optional traffic API (WP7-6: stations / ferries that are not connected give no service) */
interface TrafficApi { stopAttached?: (id: number) => boolean; hubModeAttached?: (id: number, mode: Transit) => boolean }

function isOpen(b: Building): boolean {
  return b.built >= 1 && (b.flags & (BF.Burnt | BF.Abandoned | BF.Constructing)) === 0;
}
function centre(st: CityState, b: Building): number {
  const N = st.size;
  return Math.min(N - 1, b.z + (b.d >> 1)) * N + Math.min(N - 1, b.x + (b.w >> 1));
}
function powered(st: CityState, b: Building, def: BuildingDef, inf: InfraFlags): boolean {
  if (!(def.powerUse && def.powerUse > 0) || !inf.utilities) return true;
  if (b.flags & BF.Powered) return true;
  return st.powered[centre(st, b)] === 1;
}

/** a tourist venue (not walk-in leisure: parks, gardens, plazas, marinas) needs a road next to its lot, like the plop
 *  tool's "no road access" warning says */
function needsRoad(defId: string): boolean {
  const a = ATTRACTIONS[defId];
  return a !== undefined && a.kind !== 'nature';
}

/**
 * Operating factor of a venue / facility for tourism & demand relief: 0 when unbuilt, burnt, abandoned, without the
 * power it needs or — tourist venues — without a road next to the lot; × funding effectiveness of its service (0 on
 * strike), at most `fundMax`.
 */
export function venueOp(st: CityState, b: Building, def: BuildingDef, inf: InfraFlags = infraFlags(st), fundMax = 1): number {
  if (!isOpen(b)) return 0;
  if (!powered(st, b, def, inf)) return 0;
  if (needsRoad(b.def) && !lotTouchesRoad(st, b.x, b.z, b.w, b.d)) return 0;
  return def.service ? Math.min(fundMax, serviceEffectiveness(st, def.service)) : 1;
}

/** why a venue / relief building works below full strength (null = full strength); UI hints (capHints, inspector) */
export type VenueIssue = 'closed' | 'unpowered' | 'noRoad' | 'strike' | 'funding';
export function venueIssue(st: CityState, b: Building, def: BuildingDef, inf: InfraFlags = infraFlags(st)): VenueIssue | null {
  if (!isOpen(b)) return 'closed';
  if (!powered(st, b, def, inf)) return 'unpowered';
  if (needsRoad(b.def) && !lotTouchesRoad(st, b.x, b.z, b.w, b.d)) return 'noRoad';
  if (def.service) {
    if (onStrike(st, def.service)) return 'strike';
    if (serviceEffectiveness(st, def.service) < 1) return 'funding';
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ beaches
interface WaterComp { sum: number; count: number; size: Int32Array }
const waterComps = new WeakMap<CityState, WaterComp>();

/** per water cell: size of its 4-connected water body (0 on land); cached, validated by a water checksum */
function waterBodySize(st: CityState): Int32Array {
  const wm = st.water;
  let sum = 0, count = 0;
  for (let i = 0; i < wm.length; i++) if (wm[i]) { sum += i + 1; count++; }
  const c = waterComps.get(st);
  if (c && c.sum === sum && c.count === count && c.size.length === st.cells) return c.size;
  const N = st.size, C = st.cells;
  const size = new Int32Array(C);
  const seen = new Uint8Array(C);
  const q = new Int32Array(C);
  for (let s = 0; s < C; s++) {
    if (!wm[s] || seen[s]) continue;
    let h = 0, t = 0;
    q[t++] = s; seen[s] = 1;
    while (h < t) {
      const i = q[h++];
      const x = i % N;
      if (x > 0 && wm[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; q[t++] = i - 1; }
      if (x < N - 1 && wm[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; q[t++] = i + 1; }
      if (i >= N && wm[i - N] && !seen[i - N]) { seen[i - N] = 1; q[t++] = i - N; }
      if (i + N < C && wm[i + N] && !seen[i + N]) { seen[i + N] = 1; q[t++] = i + N; }
    }
    for (let k = 0; k < t; k++) size[q[k]] = t;
  }
  waterComps.set(st, { sum, count, size });
  return size;
}

/** per-state scratch buffer of the visitor splat (monthly; no per-month allocation) */
const scratches = new WeakMap<CityState, Float32Array>();
function scratchOf(st: CityState): Float32Array {
  let s = scratches.get(st);
  if (!s || s.length !== st.cells) { s = new Float32Array(st.cells); scratches.set(st, s); }
  return s;
}

/** a road (not rail) within Manhattan distance `d` of cell (x, z) — early exit, ≤ 2d(d+1)+1 cells */
function roadWithin(st: CityState, x: number, z: number, d: number): boolean {
  const N = st.size, net = st.network;
  for (let dz = -d; dz <= d; dz++) {
    const zz = z + dz;
    if (zz < 0 || zz >= N) continue;
    const r = d - Math.abs(dz), row = zz * N;
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= N) continue;
      const n = net[row + xx];
      if (n !== Network.None && n !== Network.Rail) return true;
    }
  }
  return false;
}

/**
 * PERF (WP6a, month-tick spike): the static half of a shore cell's beach test — slope, a big water body next to it, a
 * road within beachRoadDist — only changes with the terrain, the water or the road network, so it is kept per shore
 * array and rebuilt when one of them changed (terrainChanged / networkChanged mark it stale; a new shore array means
 * the water changed). The monthly scan re-checks only the lot (building / road on it) and the water pollution:
 * the same beaches as the full test, without ~85 road probes per shore cell every month.
 */
interface BeachStatic { shore: Int32Array; ok: Uint8Array; stale: boolean; /** coarse blocks holding shore cells */ blk: Uint8Array; cw: number }
const beachStatics = new WeakMap<CityState, BeachStatic>();
/**
 * mark the static beach test of a state stale — only when the changed rect (grown by beachRoadDist + 1: a road that
 * newly reaches a shore cell, a leveled shore lot) touches a coarse block with shore cells: growth levels lots nearly
 * every day, and inland changes used to rebuild the test most months
 */
function beachStale(st: CityState, r?: { x0: number; z0: number; x1: number; z1: number }): void {
  const b = beachStatics.get(st);
  if (!b || b.stale) return;
  if (!r) { b.stale = true; return; }
  const R = TOURISM.beachRoadDist + 1, cw = b.cw;
  const bx0 = Math.max(0, ((r.x0 - R) / COARSE) | 0), bx1 = Math.min(cw - 1, Math.floor((r.x1 - 1 + R) / COARSE));
  const bz0 = Math.max(0, ((r.z0 - R) / COARSE) | 0), bz1 = Math.min(cw - 1, Math.floor((r.z1 - 1 + R) / COARSE));
  for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) if (b.blk[bz * cw + bx]) { b.stale = true; return; }
}
function beachStatic(st: CityState, shore: Int32Array): BeachStatic {
  let b = beachStatics.get(st);
  if (b && b.shore === shore && !b.stale) return b;
  const N = st.size, wm = st.water;
  const body = waterBodySize(st);
  const ok = new Uint8Array(shore.length);
  const cw = Math.ceil(N / COARSE), blk = new Uint8Array(cw * cw);
  for (let k = 0; k < shore.length; k++) {
    const i = shore[k];
    const x = i % N, z = (i - x) / N;
    blk[((z / COARSE) | 0) * cw + ((x / COARSE) | 0)] = 1;
    if (st.cellSlope(x, z) >= TOURISM.beachMaxSlope) continue;
    let big = false;
    if (x > 0 && wm[i - 1] && body[i - 1] >= TOURISM.beachMinWater) big = true;
    if (x < N - 1 && wm[i + 1] && body[i + 1] >= TOURISM.beachMinWater) big = true;
    if (z > 0 && wm[i - N] && body[i - N] >= TOURISM.beachMinWater) big = true;
    if (z < N - 1 && wm[i + N] && body[i + N] >= TOURISM.beachMinWater) big = true;
    if (big && roadWithin(st, x, z, TOURISM.beachRoadDist)) ok[k] = 1;
  }
  b = { shore, ok, stale: false, blk, cw };
  beachStatics.set(st, b);
  return b;
}

/**
 * Beach cells and their base visitors (at A = 60): land shore cells, unbuilt, slope < 3 m, a road within 6 cells,
 * next to a water body of ≥ 200 cells whose water pollution is < 0.25. `blocks` (coarse block → visitors) receives
 * the per-block sums for the visitor splat.
 */
function beaches(st: CityState, blocks: Float64Array, cw: number): { visitors: number; cells: number } {
  const shore = shoreCells(st);
  if (!shore.length) return { visitors: 0, cells: 0 };
  const N = st.size, wm = st.water, wp = st.waterPollution;
  const ok = beachStatic(st, shore).ok;
  let v = 0, cells = 0;
  for (let k = 0; k < shore.length; k++) {
    if (!ok[k]) continue;
    const i = shore[k];
    if (wm[i] || st.building[i] >= 0 || st.network[i] !== Network.None) continue;
    const x = i % N, z = (i - x) / N;
    let poll = wp[i];
    if (x > 0 && wm[i - 1] && wp[i - 1] > poll) poll = wp[i - 1];
    if (x < N - 1 && wm[i + 1] && wp[i + 1] > poll) poll = wp[i + 1];
    if (z > 0 && wm[i - N] && wp[i - N] > poll) poll = wp[i - N];
    if (z < N - 1 && wm[i + N] && wp[i + N] > poll) poll = wp[i + N];
    if (poll >= TOURISM.beachMaxWaterPoll) continue;
    const g = TOURISM.beachPerCell * (1 - TOURISM.beachWpSlope * poll);
    v += g;
    cells++;
    blocks[((z / COARSE) | 0) * cw + ((x / COARSE) | 0)] += g;
  }
  return { visitors: v, cells };
}

// ------------------------------------------------------------------------------------------------ visitors raster
function splat(acc: Float32Array, N: number, cx: number, cz: number, v: number): void {
  if (!(v > 0)) return;
  const u = v / TOURISM.splatUnit;
  const r = Math.min(TOURISM.splatRMax, TOURISM.splatR0 + TOURISM.splatRSqrt * Math.sqrt(u));
  const ri = Math.ceil(r), r2 = r * r;
  const z0 = Math.max(0, Math.floor(cz - ri)), z1 = Math.min(N - 1, Math.ceil(cz + ri));
  const x0 = Math.max(0, Math.floor(cx - ri)), x1 = Math.min(N - 1, Math.ceil(cx + ri));
  for (let z = z0; z <= z1; z++) {
    const dz = z + 0.5 - cz;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const q = (dx * dx + dz * dz) / r2;
      if (q >= 1) continue;
      const f = 1 - q;
      acc[z * N + x] += u * f * f;
    }
  }
}

// ------------------------------------------------------------------------------------------------ venue pass kernels
// (PERF, B3: the per-venue and per-cell loops of the venue pass live in small top-level functions. Inside the big
//  once-a-month update() closure V8 ran them in baseline code while it compiled the whole closure for OSR on a
//  background thread (12-73 ms of compile), so a month tick cost 4-12 ms instead of 1-2 at 1M.)
const byId = (a: Building, b: Building): number => a.id - b.id;
const numAsc = (a: number, b: number): number => a - b;
/**
 * The plopped buildings the venue pass reads — the ATTRACTIONS venues and the colleges — in ascending building id. This
 * is the canonical order of the pass (B3): the runtime swap-removes from rt.plopped while a loaded game rebuilds it in
 * Map order, and the float sums and the splats are not order-free.
 */
function venueList(rt: EconRuntime): Building[] {
  const out: Building[] = [];
  const plopped = rt.plopped;
  for (let k = 0; k < plopped.length; k++) {
    const b = plopped[k];
    if (ATTRACTIONS[b.def]) { out.push(b); continue; }
    const def = rt.defOf(b);
    if (def?.coverage?.tier === 'college' && def.coverage.capacity) out.push(b);
  }
  return out.sort(byId);
}
/** the venue loop of the pass over venueList(): the records (in list order) and their [id, gross, op] (ven), the
 *  operating connection venues (conn), the gross and culture visits and the college seats */
function venueLoop(st: CityState, rt: EconRuntime, inf: InfraFlags, traffic: TrafficApi | undefined, aF: number, sizeF: number, drawMul: number,
  list: readonly Building[], venues: Map<number, VenueRecord>, ven: number[], conn: number[]): { gross: number; culture: number; seats: number } {
  const N = st.size, cw = rt.cw;
  let gross = 0, culture = 0, seats = 0;
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    const def = rt.defOf(b);
    if (!def) continue;
    if (def.coverage?.tier === 'college' && def.coverage.capacity) seats += def.coverage.capacity * venueOp(st, b, def, inf);
    const a = ATTRACTIONS[b.def];
    if (!a) continue;
    let op = venueOp(st, b, def, inf, TOURISM.opFundingMax);
    if (op > 0 && (b.def === 'tr_train_station' || b.def === 'tr_ferry_terminal' || b.def === 'lm_grand_central') && traffic?.stopAttached && !traffic.stopAttached(b.id)) op = 0;
    if (op > 0) {
      const ci = connIndex(b.def);
      if (ci >= 0 && (b.def !== 'lm_grand_central' || !traffic?.hubModeAttached || traffic.hubModeAttached(b.id, Transit.Train))) conn[ci]++;
    }
    const c = centre(st, b);
    const blk = ((((c / N) | 0) / COARSE) | 0) * cw + (((c % N) / COARSE) | 0);
    const access = Math.min(TOURISM.accessMax, TOURISM.accessBase + TOURISM.accessFreight * (rt.coarseFreight[blk] ?? 0)
      + TOURISM.accessTransit * st.transitCov[c]);
    // parks, plazas and gardens are local leisure: residents visit them in any town; far-away tourists need a big city
    const v = op > 0 ? Math.min(a.capacity, a.draw * aF * access * op * (a.kind === 'nature' ? 1 : sizeF) * drawMul) : 0;
    venues.set(b.id, { id: b.id, def: b.def, kind: a.kind, visits: v, gross: v, capacity: a.capacity, draw: a.draw, op });
    ven.push(b.id, v, op);
    gross += v;
    if (a.kind === 'landmark' || a.kind === 'culture') culture += v;
  }
  return { gross, culture, seats };
}
/**
 * The visitor raster of a splat list ([cx, cz, v] …): the splats, 1 − exp(−Σ) per cell (st.visitors) and the coarse
 * visitors (the 3×3 blur of the block sums). The pass and init's restore both build the raster here from the same list,
 * so a loaded city gets the raster of the game it continues bit for bit. floor(cx), floor(cz) of a splat is its
 * building's centre cell (b.x + (b.w >> 1), b.z + (b.d >> 1)) or a cell of its beach block.
 */
function rasterize(st: CityState, rt: EconRuntime, spl: Float64Array): void {
  const N = st.size, cw = rt.cw;
  const acc = scratchOf(st);
  acc.fill(0);
  const raw = new Float64Array(cw * cw);
  for (let k = 0; k + 2 < spl.length; k += 3) {
    const cx = spl[k], cz = spl[k + 1], v = spl[k + 2];
    splat(acc, N, cx, cz, v);
    raw[((Math.floor(cz) / COARSE) | 0) * cw + ((Math.floor(cx) / COARSE) | 0)] += v;
  }
  visitorsLayer(st.visitors, acc, st.cells);
  const cv = rt.coarseVisitors;
  if (cv && cv.length === cw * cw) coarseBlur3(cv, raw, cw);
}
/** the visitors layer of the splat sums: 1 − exp(−Σ) */
function visitorsLayer(vis: Float32Array, acc: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) vis[i] = acc[i] > 0 ? 1 - Math.exp(-acc[i]) : 0;
}
/** coarse visitors: 3×3 blur of the raw block sums (centre 1, neighbours 0.5) */
function coarseBlur3(cv: Float32Array, raw: Float64Array, cw: number): void {
  for (let bz = 0; bz < cw; bz++) {
    for (let bx = 0; bx < cw; bx++) {
      let s = 0;
      for (let dz = -1; dz <= 1; dz++) {
        const z = bz + dz;
        if (z < 0 || z >= cw) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx;
          if (x < 0 || x >= cw) continue;
          s += raw[z * cw + x] * (dx === 0 && dz === 0 ? 1 : 0.5);
        }
      }
      cv[bz * cw + bx] = s;
    }
  }
}

// ------------------------------------------------------------------------------------------------ monthly slices
/**
 * The hotel rooms and historic buildings the venue pass reads are gathered in daily slices (growables with id %
 * TOURISM_SLICES === day % TOURISM_SLICES; final fixes V5: one pass over every growable with its def lookup sat on the
 * month tick) into systemData.tourismAcc, over the 30 days up to and with the pass's day TOURISM_DAY. A window with slices
 * missing (a new or loaded city before its first full window) and every pass outside the daily (init, the tick's
 * fallback, refresh) take one full pass.
 */
export const TOURISM_SLICES = DAYS_PER_MONTH;
/**
 * The day of the month of the venue pass (B3): 4 days before the tick it feeds. Even, so population's odd sample days
 * never coincide with it, and clear of the other month work (EQ / HQ on 25, the commercial core on 20, the advisors'
 * scans on 28 and 29).
 */
export const TOURISM_DAY = 26;
const TOURISM_ALL = (2 ** TOURISM_SLICES) - 1;
/** systemData.tourismAcc v2 (B3; v1's window ended on the month tick): the window's sums so far, its window
 *  m = tourismWindow(day) and the slices done (bit k = slice k) */
interface TourismAcc { v: 2; m: number; done: number; rooms: number; hist: number[] }
/** the window of `day`: the days after one TOURISM_DAY up to and with the next (as demographics.ts' eqHqMonth). (+ 0:
 *  the days before a city's first TOURISM_DAY would give −0, which a save stores as 0) */
const tourismWindow = (day: number): number => Math.ceil((day - TOURISM_DAY) / TOURISM_SLICES) + 0;
/** add the hotel rooms (Σ hotel jobs × HOTEL_ROOMS_PER_JOB) and historic building ids of a slice (−1 = all) */
function growablesSlice(rt: EconRuntime, slice: number, out: { rooms: number; hist: number[] }): void {
  // (a slice: only its bucket, in list order — the same buildings and sums as the filtered full list; final fixes SE-3)
  const bucket = slice >= 0 && TOURISM_SLICES === GROWABLE_SLICES;
  const growList = bucket ? rt.growablesOfSlice(slice) : rt.growables;
  for (let k = 0; k < growList.length; k++) {
    const b = growList[k];
    if (slice >= 0 && !bucket && b.id % TOURISM_SLICES !== slice) continue;
    const hist = (b.flags & BF.Historic) !== 0;
    if (!hist && b.jobs <= 0) continue;
    const def = rt.defOf(b);
    if (!def || !isOpen(b)) continue;
    if (hist) out.hist.push(b.id);
    // (PERF, WP6a: only shops can be hotels — skip the model lookup for everything else)
    const dv = def.devType;
    if (dv === undefined || dv < DevType.CS1 || dv > DevType.CS3) continue;
    const r = HOTEL_ROOMS_PER_JOB[def.model];
    if (r !== undefined && b.jobs > 0) out.rooms += b.jobs * r;
  }
}

// ------------------------------------------------------------------------------------------------ the system
export function tourismSystem(rt: EconRuntime): SimSystem & { rt: EconRuntime; refresh(sim: Simulation): void } {
  /**
   * The VENUE PASS (1–3 of the header): venues, historic sites, hotel rooms, beaches, hotels, the totals, the venue
   * records and the visitor raster, in ascending building id. `acc`: the window's sums (the daily on TOURISM_DAY, every
   * slice in); null: one full growables pass. systemData.tourismPass is written last: a throw on the way leaves the old
   * pass, whose stale m sends the tick to its fallback instead of a half-written pass. It emits nothing: every caller
   * emits layerUpdated 'tourism' as its own last statement (as the base's update did), so a listener that throws cannot
   * leave the saved pass, the slice window or the attract step behind the state in memory.
   */
  const venuePass = (sim: Simulation, acc: { rooms: number; hist: readonly number[] } | null): TourismPass => {
    const st = sim.state;
    rt.ensureLists();
    const t0 = performance.now();
    let tp = t0;
    const data = econData(st);
    const inf = infraFlags(st);
    const cw = rt.cw;
    const pop = st.stats.population;
    // attractiveness drives this month's visits: the last tick's value (a fresh city starts from a neutral guess)
    const A = data.attractiveness > 0 ? data.attractiveness : MIG_NEUTRAL;
    const aF = Math.pow(Math.max(0, A) / TOURISM.aRef, TOURISM.aExp);
    const sizeF = TOURISM.sizeMin + (1 - TOURISM.sizeMin) * smoothstep(0, TOURISM.sizePop, pop);
    const drawMul = ordinanceEffect(st, 'tourism.draw');
    const traffic = sim.getSystem<SimSystem & TrafficApi>('traffic');
    const venues = new Map<number, VenueRecord>();
    const ven: number[] = [];
    const conn = [0, 0, 0, 0];
    const vp = venueLoop(st, rt, inf, traffic, aF, sizeF, drawMul, venueList(rt), venues, ven, conn);
    let gross = vp.gross;
    // historic districts + hotel rooms: the window's daily slices, else one pass over the growables (final fixes V5);
    // the historic sites in ascending id (a slice lists its bucket in the runtime's order, which a loaded game rebuilds)
    let rooms: number, hist: number[];
    if (acc) {
      rooms = acc.rooms;
      hist = acc.hist.slice();
    } else {
      const sums = { rooms: 0, hist: [] as number[] };
      growablesSlice(rt, -1, sums);
      rooms = sums.rooms;
      hist = sums.hist;
    }
    hist.sort(numAsc);
    let historicBase = 0;
    const historicB: Building[] = [];
    for (const id of hist) {
      const b = st.buildings.get(id);
      if (!b || !(b.flags & BF.Historic) || !isOpen(b)) continue;
      historicBase += TOURISM.historicPerStage * (rt.defOf(b)?.stage ?? 1);
      historicB.push(b);
    }
    const historic = Math.min(TOURISM.historicMax, historicBase * aF * sizeF * drawMul);
    rt.timing['tourism.venues'] = performance.now() - tp; tp = performance.now();
    // beaches
    const blocks = new Float64Array(cw * cw);
    const bch = beaches(st, blocks, cw);
    rt.timing['tourism.beach'] = performance.now() - tp; tp = performance.now();
    const beachScale = bch.visitors > 0 ? Math.min(TOURISM.beachMax, bch.visitors * aF * sizeF * drawMul) / bch.visitors : 0;
    const beach = bch.visitors * beachScale;
    gross += historic + beach;
    // hotels (an operating airport raises the overnight share)
    const overnight = gross * (TOURISM.overnightBase + TOURISM.overnightAirportLarge * (conn[0] > 0 ? 1 : 0)
      + TOURISM.overnightAirportSmall * (conn[1] > 0 ? 1 : 0));
    const shortage = Math.max(0, overnight - rooms);
    const eff = Math.max(0, gross - TOURISM.hotelLoss * shortage);
    const kEff = gross > 0 ? eff / gross : 0;
    for (const r of venues.values()) r.visits = r.gross * kEff;
    data.touristsGross = gross;
    data.tourists = eff;
    data.overnight = overnight;
    data.hotelShortage = shortage;
    data.tourism = eff * CS_JOBS_PER_VISITOR;
    st.stats.tourists = Math.round(eff);
    st.stats.hotelRooms = Math.round(rooms);
    rt.timing['tourism.hotels'] = performance.now() - tp; tp = performance.now();
    // ---- the visitor splats (venues, historic sites, beach blocks; v > 0: splat() skips the others, and adding 0 to a
    //      block sum changes nothing) and the raster
    const spl: number[] = [];
    for (const r of venues.values()) {
      const b = st.buildings.get(r.id);
      if (b && r.visits > 0) spl.push(b.x + b.w / 2, b.z + b.d / 2, r.visits);
    }
    if (historic > 0 && historicBase > 0) {
      const k = (historic * kEff) / historicBase;
      for (const b of historicB) {
        const v = TOURISM.historicPerStage * (rt.defOf(b)?.stage ?? 1) * k;
        if (v > 0) spl.push(b.x + b.w / 2, b.z + b.d / 2, v);
      }
    }
    if (beach > 0) {
      const k = beachScale * kEff;
      for (let blk = 0; blk < blocks.length; blk++) {
        if (!blocks[blk]) continue;
        const v = blocks[blk] * k;
        if (v > 0) spl.push((blk % cw) * COARSE + COARSE / 2, ((blk / cw) | 0) * COARSE + COARSE / 2, v);
      }
    }
    // (what the last tick scored stays with the new pass until the next tick)
    const prev = states.get(st)?.pass ?? passOf(st);
    const p: TourismPass = {
      v: 1, m: Math.ceil(st.day / DAYS_PER_MONTH), culture: vp.culture, conn, seats: vp.seats, kEff,
      beach: beach * kEff, historic: historic * kEff, beachCells: bch.cells, ven: new Float64Array(ven), spl: new Float64Array(spl),
      tc: prev ? prev.tc : 0, dump: prev ? prev.dump : false,
    };
    rasterize(st, rt, p.spl);
    rt.timing['tourism.splat'] = performance.now() - tp;
    states.set(st, { venues, pass: p });
    st.systemData.tourismPass = p;
    rt.timing['tourism.pass'] = performance.now() - t0;
    return p;
  };

  /**
   * The ATTRACT STEP of the month tick (4 of the header): attractiveness and migration from this month's resident survey
   * (tourism is its first monthly caller: this completes approval's slices) and the pass `p` that feeds this tick (its
   * culture visits, connections and college seats). What it scored goes into p.tc / p.dump (the breakdown's details).
   */
  const attract = (sim: Simulation, p: TourismPass) => {
    const st = sim.state;
    rt.ensureLists();
    const data = econData(st);
    const inf = infraFlags(st);
    const pop = st.stats.population;
    let tp = performance.now();
    const sv = residentSurvey(st, rt, inf);
    rt.timing['tourism.survey'] = performance.now() - tp; tp = performance.now();
    const dump = toxicDumpOperating(rt);
    const c = p.conn;
    const scores = attractScores(st, sv, inf, p.culture, { large: c[0] > 0 ? 1 : 0, small: c[1] > 0 ? 1 : 0, train: c[2] > 0 ? 1 : 0, seaport: c[3] > 0 ? 1 : 0 },
      dump ? 1 - APPROVAL_TERMS.dumpImage : 1);
    const aw: number[] = [0, 0, 0];
    for (let w = 0; w < 3; w++) {
      let a = 0;
      for (let k = 0; k < 8; k++) a += ATTRACT_WEIGHTS[w][k] * scores[w][k];
      aw[w] = 100 * a;
    }
    const terms: Record<string, number> = {};
    let aCity = 0;
    for (let k = 0; k < 8; k++) {
      const v = 100 * ATTRACT_CITY_WEIGHTS[k] * scores[3][k];
      terms[ATTRACT_IDS[k]] = v;
      aCity += v;
    }
    data.attractiveness = aCity;
    data.attractByWealth = aw;
    data.attractTerms = terms;
    st.stats.attractiveness = Math.round(aCity * 10) / 10;
    st.stats.attractByWealth = [Math.round(aw[0] * 10) / 10, Math.round(aw[1] * 10) / 10, Math.round(aw[2] * 10) / 10];
    // ---- migration
    const nd = st.stats.needs;
    const pupils = (nd?.elementary?.need ?? 0) + (nd?.high?.need ?? 0);
    const unreached = pupils > 0 ? clamp(((nd?.elementary?.unreached ?? 0) + (nd?.high?.unreached ?? 0)) / pupils, 0, 1) : 0;
    const unemp = st.stats.unemployment;
    data.migration = [0, 1, 2].map((w) => migrationFactor(aw[w], pop, w >= 1 ? unreached : 0, unemp));
    const green = sv.green > 0 ? sv.green : sv.park[3];
    const retirees = pop > 0 ? RETIREES * (0.5 + Math.min(1, st.stats.hq / 150)) * (0.5 + clamp(green, 0, 1)) : 0;
    const students = STUDENTS_PER_SEAT * p.seats;
    data.migrants = [0, 1, 2].map((w) => retirees * RETIREE_SPLIT[w] + students * STUDENT_SPLIT[w]);
    p.tc = p.culture;
    p.dump = dump;
    rt.timing['tourism.attract'] = performance.now() - tp;
  };

  /** a loaded city's venue records and visitor raster from its saved pass (B3): those of the game it continues. Ids that
   *  no longer stand (bulldozed since the pass) or are no longer venues are skipped; the totals in econData are saved */
  const restore = (sim: Simulation, p: TourismPass) => {
    const st = sim.state;
    const venues = new Map<number, VenueRecord>();
    const ven = p.ven;
    for (let k = 0; k + 2 < ven.length; k += 3) {
      const id = ven[k];
      const b = st.buildings.get(id);
      const a = b ? ATTRACTIONS[b.def] : undefined;
      if (!b || !a) continue;
      const gross = ven[k + 1];
      venues.set(id, { id, def: b.def, kind: a.kind, visits: gross * p.kEff, gross, capacity: a.capacity, draw: a.draw, op: ven[k + 2] });
    }
    rasterize(st, rt, p.spl);
    states.set(st, { venues, pass: p });
    sim.events.emit('layerUpdated', 'tourism');
  };

  /** a bulldozed (or otherwise removed) venue leaves the tourism totals at once — its visits stop feeding CS demand,
   *  approval and the tourism income line — and the coming tick's culture and connection scores (the pass); the visitor
   *  raster keeps its splat until the next venue pass */
  const onRemoved = (st: CityState, b: Building) => {
    const ts = states.get(st);
    const r = ts?.venues.get(b.id);
    if (!ts || !r) return;
    ts.venues.delete(b.id);
    const data = econData(st);
    data.tourists = Math.max(0, data.tourists - r.visits);
    data.touristsGross = Math.max(0, (data.touristsGross ?? 0) - r.gross);
    data.tourism = data.tourists * CS_JOBS_PER_VISITOR;
    st.stats.tourists = Math.round(data.tourists);
    const p = ts.pass;
    if (r.kind === 'landmark' || r.kind === 'culture') {
      p.culture = Math.max(0, p.culture - r.gross);
      p.tc = Math.max(0, p.tc - r.gross);
    }
    const ci = connIndex(r.def);
    if (r.def === 'lm_grand_central') {
      // A bus-only hub never contributed a train connection; retain the other stations' saved contributions.
      p.conn[2] = 0;
      for (const v of ts.venues.values()) if (v.def === 'tr_train_station' && v.op > 0) p.conn[2]++;
    } else if (ci >= 0 && r.op > 0) p.conn[ci] = Math.max(0, p.conn[ci] - 1);
  };
  let subscribedTo: Simulation | null = null;
  let unsub: (() => void) | null = null;

  return {
    name: 'economy.tourism',
    rt,
    /** the whole update now — a venue pass with one full growables pass, then the attract step (tests, tools) */
    refresh(sim) {
      attract(sim, venuePass(sim, null));
      sim.events.emit('layerUpdated', 'tourism');
    },
    daily(sim) {
      // the window's hotel rooms / historic buildings in daily slices; the venue pass on TOURISM_DAY (after that day's
      // slice: also when the slice is already done)
      const st = sim.state;
      rt.ensureLists();
      let a = st.systemData.tourismAcc as TourismAcc | undefined;
      if (!a || a.v !== 2 || !finite(a.m) || !finite(a.done) || !finite(a.rooms) || !Array.isArray(a.hist)) {
        st.systemData.tourismAcc = a = { v: 2, m: -1, done: 0, rooms: 0, hist: [] };
      }
      // (a window whose pass did not read the sums starts over: no slice counts twice)
      const m = tourismWindow(st.day);
      if (a.m !== m) { a.m = m; a.done = 0; a.rooms = 0; a.hist = []; }
      const k = st.day % TOURISM_SLICES;
      if (!(a.done & (1 << k))) {
        growablesSlice(rt, k, a);
        a.done |= 1 << k;
      }
      if (k !== TOURISM_DAY) return;
      // the window's sums go to the pass and the next window starts with the day after it, before the pass runs; its
      // layer event goes out last (a listener that throws leaves the record and the saved pass complete)
      const win = a.done === TOURISM_ALL ? { rooms: a.rooms, hist: a.hist } : null;
      a.m = m + 1; a.done = 0; a.rooms = 0; a.hist = [];
      venuePass(sim, win);
      sim.events.emit('layerUpdated', 'tourism');
    },
    init(sim) {
      rt.attach(sim);
      if (subscribedTo !== sim) {
        unsub?.();
        const offs = [
          sim.events.on('buildingRemoved', (b) => onRemoved(sim.state, b)),
          // (the static beach test follows roads and terrain)
          sim.events.on('networkChanged', (r) => beachStale(sim.state, r)),
          sim.events.on('terrainChanged', (r) => beachStale(sim.state, r)),
        ];
        unsub = () => { for (const f of offs) f(); };
        subscribedTo = sim;
      }
      // the venue records and the visitor raster are derived (st.visitors is not saved). A city with a saved venue pass
      // restores both exactly from it (B3: a save on any day of the month continues the game it was taken from).
      // Otherwise (a new city, a save from before B3) they are built now, with the attract step; a loaded city keeps its
      // saved outputs: the attract outputs until its next tick, the totals until its next venue pass — which on dom
      // 26–29 is this one, since it feeds the coming tick
      const st = sim.state;
      const p = passOf(st);
      if (p) { restore(sim, p); return; }
      const d = econData(st);
      const keep = st.day > 0 && Object.keys(d.attractTerms).length > 0 ? savedOutputs(st) : null;
      attract(sim, venuePass(sim, null));
      if (keep) restoreOutputs(st, keep, st.day % DAYS_PER_MONTH < TOURISM_DAY);
      sim.events.emit('layerUpdated', 'tourism');
    },
    monthly(sim) {
      const t0 = performance.now();
      const st = sim.state;
      // the pass of day TOURISM_DAY feeds this tick. A missing, invalid or stale one (its daily threw; a direct call on
      // another day) is recomputed first. Fresh: m === ⌈day / 30⌉, which is monthIndex on a tick
      const p = passOf(st);
      const fresh = p !== null && p.m === Math.ceil(st.day / DAYS_PER_MONTH) && states.get(st)?.pass === p;
      attract(sim, fresh ? p : venuePass(sim, null));
      rt.timing.tourism = performance.now() - t0;
      // (a pass of its own: the layer event after the attract step)
      if (!fresh) sim.events.emit('layerUpdated', 'tourism');
    },
  };
}

/** the monthly outputs of the tourism system as saved (econData + stats) */
function savedOutputs(st: CityState) {
  const d = econData(st), s = st.stats;
  return {
    tourists: d.tourists, touristsGross: d.touristsGross, overnight: d.overnight, hotelShortage: d.hotelShortage, tourism: d.tourism,
    attractiveness: d.attractiveness, attractByWealth: d.attractByWealth.slice(), attractTerms: { ...d.attractTerms },
    migration: d.migration.slice(), migrants: d.migrants?.slice(),
    sTourists: s.tourists, sRooms: s.hotelRooms, sAttract: s.attractiveness, sAttractW: [...s.attractByWealth] as typeof s.attractByWealth,
  };
}
/** put an old save's outputs back after init's pass: the attract outputs; the totals unless that pass feeds the coming
 *  tick (`totals` false on dom 26–29: they stay next to the pass's records, as in a game from after B3) */
function restoreOutputs(st: CityState, o: ReturnType<typeof savedOutputs>, totals: boolean): void {
  const d = econData(st), s = st.stats;
  if (totals) {
    d.tourists = o.tourists; d.touristsGross = o.touristsGross; d.overnight = o.overnight; d.hotelShortage = o.hotelShortage; d.tourism = o.tourism;
    s.tourists = o.sTourists; s.hotelRooms = o.sRooms;
  }
  d.attractiveness = o.attractiveness; d.attractByWealth = o.attractByWealth; d.attractTerms = o.attractTerms;
  d.migration = o.migration; d.migrants = o.migrants;
  s.attractiveness = o.sAttract; s.attractByWealth = o.sAttractW;
}

/** attractiveness at which migration is neutral for a city of this size (UI: "cities your size average N") */
export function migrationNeutral(population: number): number {
  return MIG_NEUTRAL + MIG_NEUTRAL_BIG * smoothstep(0, MIG_BIG_POP, population);
}

/**
 * Migration multiplier of a wealth tier's R target: clamp(1 + MIG_GAIN × (A − neutral(pop)) / MIG_SPAN, MIG_MIN, MIG_MAX)
 * × (1 − MIG_SCHOOL × unreached pupil share) (pass 0 for R$), faded in by smoothstep(0, MIG_POP, population).
 * The pull of an attractive city (m > 1) fades out while unemployment is above UNEMP_NEUTRAL (gone MIG_UNEMP_SPAN above
 * it): newcomers come for jobs too, so a city without work stops importing job seekers; losses (m < 1) are kept.
 */
export function migrationFactor(attractiveness: number, population: number, unreachedPupilShare = 0, unemployment = 0): number {
  const fade = smoothstep(0, MIG_POP, population);
  let m = clamp(1 + MIG_GAIN * (attractiveness - migrationNeutral(population)) / MIG_SPAN, MIG_MIN, MIG_MAX);
  if (m > 1 && unemployment > UNEMP_NEUTRAL) m = 1 + (m - 1) * clamp(1 - (unemployment - UNEMP_NEUTRAL) / MIG_UNEMP_SPAN, 0, 1);
  let f = fade >= 1 ? m : 1 + (m - 1) * fade;
  if (unreachedPupilShare > 0) f *= 1 - MIG_SCHOOL * clamp(unreachedPupilShare, 0, 1) * fade;
  return f;
}

/** scores 0..1 [culture, parks, safety, clean, quiet, services, jobs, connect] per wealth (0..2) and city-wide (3);
 *  `image` scales the clean-air score (a toxic waste dump: 1 − APPROVAL_TERMS.dumpImage) */
function attractScores(
  st: CityState, sv: ResidentSurvey, inf: InfraFlags, culture: number,
  conn: { large: number; small: number; train: number; seaport: number }, image = 1,
): number[][] {
  const s = st.stats;
  const cult = 1 - Math.exp(-culture / TOURISM.cultureRef);
  const nd = s.needs;
  const need = (nd?.elementary?.need ?? 0) + (nd?.high?.need ?? 0) + (nd?.health?.need ?? 0);
  let served: number;
  if (need > 0) served = ((nd?.elementary?.served ?? 0) + (nd?.high?.served ?? 0) + (nd?.health?.served ?? 0)) / need;
  else if (inf.services && sv.pop[3] > 0) served = (sv.edu + sv.health) / 2;
  else served = COVERAGE_FALLBACK * (serviceEffectiveness(st, 'education') + serviceEffectiveness(st, 'health')) / 2;
  const services = clamp(served, 0, 1) * (0.8 + 0.2 * Math.min(1, s.hq / ATTRACT_SCALES.hqRef));
  const jobs = clamp(1 - ATTRACT_SCALES.unemp * Math.max(0, s.unemployment - ATTRACT_SCALES.unempFree), 0, 1);
  const C = ATTRACT_CONNECT;
  const connect = Math.min(1, C.perConnection * st.neighborConnections.length + C.airportLarge * conn.large + C.airportSmall * conn.small
    + C.trainStation * conn.train + C.seaport * conn.seaport);
  const res = (k: number) => {
    const safety = clamp(1 - ATTRACT_SCALES.crime * sv.crime[k], 0, 1);
    const clean = clamp(1 - ATTRACT_SCALES.air * sv.air[k], 0, 1) * image;
    const quiet = clamp(1 - ATTRACT_SCALES.noise * sv.noise[k], 0, 1);
    const parks = clamp(inf.services ? sv.park[k] : 0.3, 0, 1);
    return { parks, safety, clean, quiet };
  };
  const city = res(3);
  const out: number[][] = [];
  for (let w = 0; w < 3; w++) {
    // tiers with few residents are judged by the city-wide experience
    const t = sv.pop[w] / (sv.pop[w] + 300);
    const r = res(w);
    const mix = (a: number, b: number) => b + (a - b) * t;
    const c = w === 2 ? Math.max(cult, clamp(sv.prestige[2], 0, 1) * t) : cult;
    out.push([c, mix(r.parks, city.parks), mix(r.safety, city.safety), mix(r.clean, city.clean), mix(r.quiet, city.quiet), services, jobs, connect]);
  }
  out.push([cult, city.parks, city.safety, city.clean, city.quiet, services, jobs, connect]);
  return out;
}

/**
 * visits / capacity of a venue building (visits = effective visitors per day after the hotel limit; gross = before it;
 * draw = reference visitors at attractiveness 60; op = operating factor 0 (closed) .. 1.1); null if not a venue
 */
export function venueVisits(st: CityState, buildingId: number): { visits: number; capacity: number; gross: number; draw: number; op: number } | null {
  const r = states.get(st)?.venues.get(buildingId);
  return r && live(st, r) ? { visits: r.visits, capacity: r.capacity, gross: r.gross, draw: r.draw, op: r.op } : null;
}

/** the venue of a record still stands (records live until the next venue pass; building ids are never reused) */
function live(st: CityState, r: VenueRecord): boolean {
  return st.buildings.get(r.id)?.def === r.def;
}

/** attractiveness terms (culture, parks, safety, clean, quiet, services, jobs, connect) in points; sum = attractiveness.
 *  The details are those of the last tick, like the terms (the pass's tc / dump) */
export function attractivenessBreakdown(st: CityState): FactorTerm[] {
  const d = st.systemData.economy as { attractTerms?: Record<string, number> } | undefined;
  const T = d?.attractTerms;
  if (!T) return [];
  const p = states.get(st)?.pass;
  const out: FactorTerm[] = [];
  for (const id of ATTRACT_IDS) {
    if (T[id] === undefined) continue;
    let detail: string | undefined;
    if (id === 'culture' && p) detail = `${Math.round(p.tc).toLocaleString('en-US')} landmark & culture visits / day`;
    if (id === 'clean' && p?.dump) detail = `the toxic waste dump costs ${Math.round(APPROVAL_TERMS.dumpImage * 100)}% of the city's clean-air image`;
    out.push({ id, label: ATTRACT_LABELS[id], value: T[id], detail });
  }
  return out;
}

/** visitor trips per venue per day (P2 hook for a traffic VISIT phase; beaches / historic buildings excluded) */
export function tourismTrips(st: CityState): { buildingId: number; tripsPerDay: number }[] {
  const ts = states.get(st);
  if (!ts) return [];
  const out: { buildingId: number; tripsPerDay: number }[] = [];
  for (const r of ts.venues.values()) if (r.visits > 0 && live(st, r)) out.push({ buildingId: r.id, tripsPerDay: r.visits });
  return out;
}

/** tourism summary for panels / advisors (null until the tourism system ran) */
export function tourismSummary(st: CityState): {
  tourists: number; gross: number; overnight: number; rooms: number; hotelShortage: number; beach: number; beachCells: number; historic: number;
  topVenues: { buildingId: number; def: string; visits: number; capacity: number }[];
} | null {
  const ts = states.get(st);
  if (!ts) return null;
  const d = econData(st);
  const top = [...ts.venues.values()].filter((r) => r.visits > 0 && live(st, r)).sort((a, b) => b.visits - a.visits).slice(0, 8)
    .map((r) => ({ buildingId: r.id, def: r.def, visits: r.visits, capacity: r.capacity }));
  const p = ts.pass;
  return {
    tourists: d.tourists, gross: d.touristsGross ?? d.tourists, overnight: d.overnight ?? 0, rooms: st.stats.hotelRooms,
    hotelShortage: d.hotelShortage, beach: p.beach, beachCells: p.beachCells, historic: p.historic, topVenues: top,
  };
}
