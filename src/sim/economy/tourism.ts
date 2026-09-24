/**
 * Attraction, tourism, hotels, attractiveness and regional migration (SIM_DEPTH_SPEC WP4). Headless: no DOM / three.js.
 *
 * Monthly (and synchronously in init(), because st.visitors is a derived layer that is not saved):
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
import { Network } from '../../core/types';
import type { BuildingDef } from '../catalogTypes';
import { type EconRuntime, type InfraFlags, econData, infraFlags } from './runtime';
import { ordinanceEffect } from './ordinances';
import { onStrike, serviceEffectiveness } from './budget';
import { residentSurvey, type ResidentSurvey } from './approval';
import { lotTouchesRoad } from './buildings';
import { shoreCells } from '../infra/terrainMasks';
import {
  ATTRACT_CITY_WEIGHTS, ATTRACT_CONNECT, ATTRACT_SCALES, ATTRACT_WEIGHTS, COARSE, COVERAGE_FALLBACK, CS_JOBS_PER_VISITOR, MIG_GAIN,
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
  civ_museum: { kind: 'culture', draw: 900, capacity: 4000 },
  civ_convention_center: { kind: 'business', draw: 2500, capacity: 6000 },
  civ_city_hall: { kind: 'landmark', draw: 200, capacity: 1000 },
  park_zoo: { kind: 'entertainment', draw: 3000, capacity: 10000 },
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
  access: number;
}
interface TourismState {
  day: number;
  venues: Map<number, VenueRecord>;
  beach: number;
  beachCells: number;
  historic: number;
  culture: number;
  scores: number[][];
}
const states = new WeakMap<CityState, TourismState>();

/** duck-typed optional traffic API (WP7-6: stations / ferries that are not connected give no service) */
interface TrafficApi { stopAttached?: (id: number) => boolean }

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
 * Beach cells and their base visitors (at A = 60): land shore cells, unbuilt, slope < 3 m, a road within 6 cells,
 * next to a water body of ≥ 200 cells whose water pollution is < 0.25. `blocks` (coarse block → visitors) receives
 * the per-block sums for the visitor splat.
 */
function beaches(st: CityState, blocks: Float64Array, cw: number): { visitors: number; cells: number } {
  const shore = shoreCells(st);
  if (!shore.length) return { visitors: 0, cells: 0 };
  const N = st.size, wm = st.water, wp = st.waterPollution;
  const body = waterBodySize(st);
  let v = 0, cells = 0;
  for (let k = 0; k < shore.length; k++) {
    const i = shore[k];
    if (wm[i] || st.building[i] >= 0 || st.network[i] !== Network.None) continue;
    const x = i % N, z = (i - x) / N;
    if (st.cellSlope(x, z) >= TOURISM.beachMaxSlope) continue;
    let big = false, poll = wp[i];
    const look = (j: number) => {
      if (!wm[j]) return;
      if (body[j] >= TOURISM.beachMinWater) big = true;
      if (wp[j] > poll) poll = wp[j];
    };
    if (x > 0) look(i - 1);
    if (x < N - 1) look(i + 1);
    if (z > 0) look(i - N);
    if (z < N - 1) look(i + N);
    if (!big || poll >= TOURISM.beachMaxWaterPoll || !roadWithin(st, x, z, TOURISM.beachRoadDist)) continue;
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

// ------------------------------------------------------------------------------------------------ the system
export function tourismSystem(rt: EconRuntime): SimSystem & { rt: EconRuntime } {
  const update = (sim: Simulation) => {
    const st = sim.state;
    rt.ensureLists();
    const data = econData(st);
    const inf = infraFlags(st);
    const N = st.size, cw = rt.cw;
    const pop = st.stats.population;
    let tp = performance.now();
    const sv = residentSurvey(st, rt, inf);
    rt.timing['tourism.survey'] = performance.now() - tp; tp = performance.now();
    // attractiveness drives this month's visits: last month's value (a fresh city starts from a neutral guess)
    const A = data.attractiveness > 0 ? data.attractiveness : MIG_NEUTRAL;
    const aF = Math.pow(Math.max(0, A) / TOURISM.aRef, TOURISM.aExp);
    const sizeF = TOURISM.sizeMin + (1 - TOURISM.sizeMin) * smoothstep(0, TOURISM.sizePop, pop);
    const drawMul = ordinanceEffect(st, 'tourism.draw');
    const traffic = sim.getSystem<SimSystem & TrafficApi>('traffic');
    const venues = new Map<number, VenueRecord>();
    const blocks = new Float64Array(cw * cw);
    let gross = 0, culture = 0;
    let airportLarge = 0, airportSmall = 0, train = 0, seaport = 0, collegeSeats = 0;
    for (const b of rt.plopped) {
      const def = rt.defOf(b);
      if (!def) continue;
      if (def.coverage?.tier === 'college' && def.coverage.capacity) collegeSeats += def.coverage.capacity * venueOp(st, b, def, inf);
      const a = ATTRACTIONS[b.def];
      if (!a) continue;
      let op = venueOp(st, b, def, inf, TOURISM.opFundingMax);
      if (op > 0 && (b.def === 'tr_train_station' || b.def === 'tr_ferry_terminal') && traffic?.stopAttached && !traffic.stopAttached(b.id)) op = 0;
      if (op > 0) {
        if (b.def === 'tr_airport_large') airportLarge = 1;
        else if (b.def === 'tr_airport_small') airportSmall = 1;
        else if (b.def === 'tr_train_station') train = 1;
        else if (b.def === 'tr_seaport') seaport = 1;
      }
      const c = centre(st, b);
      const blk = ((((c / N) | 0) / COARSE) | 0) * cw + (((c % N) / COARSE) | 0);
      const access = Math.min(TOURISM.accessMax, TOURISM.accessBase + TOURISM.accessFreight * (rt.coarseFreight[blk] ?? 0)
        + TOURISM.accessTransit * st.transitCov[c]);
      // parks, plazas and gardens are local leisure: residents visit them in any town; far-away tourists need a big city
      const v = op > 0 ? Math.min(a.capacity, a.draw * aF * access * op * (a.kind === 'nature' ? 1 : sizeF) * drawMul) : 0;
      venues.set(b.id, { id: b.id, def: b.def, kind: a.kind, visits: v, gross: v, capacity: a.capacity, draw: a.draw, op, access });
      gross += v;
      if (a.kind === 'landmark' || a.kind === 'culture') culture += v;
    }
    // historic districts + hotel rooms (one pass over the growables)
    let historicBase = 0, rooms = 0;
    const historicB: Building[] = [];
    for (const b of rt.growables) {
      const hist = (b.flags & BF.Historic) !== 0;
      if (!hist && b.jobs <= 0) continue;
      const def = rt.defOf(b);
      if (!def || !isOpen(b)) continue;
      if (hist) { historicBase += TOURISM.historicPerStage * (def.stage ?? 1); historicB.push(b); }
      const r = HOTEL_ROOMS_PER_JOB[def.model];
      if (r !== undefined && b.jobs > 0) rooms += b.jobs * r;
    }
    const historic = Math.min(TOURISM.historicMax, historicBase * aF * sizeF * drawMul);
    // beaches
    rt.timing['tourism.venues'] = performance.now() - tp; tp = performance.now();
    const bch = beaches(st, blocks, cw);
    rt.timing['tourism.beach'] = performance.now() - tp; tp = performance.now();
    const beachScale = bch.visitors > 0 ? Math.min(TOURISM.beachMax, bch.visitors * aF * sizeF * drawMul) / bch.visitors : 0;
    const beach = bch.visitors * beachScale;
    gross += historic + beach;
    // hotels
    const overnight = gross * (TOURISM.overnightBase + TOURISM.overnightAirportLarge * airportLarge + TOURISM.overnightAirportSmall * airportSmall);
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
    // ---- visitors raster + coarse visitors
    const acc = scratchOf(st);
    acc.fill(0);
    const cv = rt.coarseVisitors;
    const raw = new Float64Array(cw * cw);
    for (const r of venues.values()) {
      const b = st.buildings.get(r.id);
      if (!b) continue;
      splat(acc, N, b.x + b.w / 2, b.z + b.d / 2, r.visits);
      raw[(((b.z + (b.d >> 1)) / COARSE) | 0) * cw + (((b.x + (b.w >> 1)) / COARSE) | 0)] += r.visits;
    }
    if (historic > 0 && historicBase > 0) {
      const k = (historic * kEff) / historicBase;
      for (const b of historicB) {
        const v = TOURISM.historicPerStage * (rt.defOf(b)?.stage ?? 1) * k;
        splat(acc, N, b.x + b.w / 2, b.z + b.d / 2, v);
        raw[(((b.z + (b.d >> 1)) / COARSE) | 0) * cw + (((b.x + (b.w >> 1)) / COARSE) | 0)] += v;
      }
    }
    if (beach > 0) {
      const k = beachScale * kEff;
      for (let blk = 0; blk < blocks.length; blk++) {
        if (!blocks[blk]) continue;
        const v = blocks[blk] * k;
        splat(acc, N, (blk % cw) * COARSE + COARSE / 2, ((blk / cw) | 0) * COARSE + COARSE / 2, v);
        raw[blk] += v;
      }
    }
    const vis = st.visitors;
    for (let i = 0; i < st.cells; i++) vis[i] = acc[i] > 0 ? 1 - Math.exp(-acc[i]) : 0;
    if (cv && cv.length === cw * cw) {
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
    rt.timing['tourism.splat'] = performance.now() - tp; tp = performance.now();
    // ---- attractiveness
    const scores = attractScores(st, sv, inf, culture, { large: airportLarge, small: airportSmall, train, seaport });
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
    const students = STUDENTS_PER_SEAT * collegeSeats;
    data.migrants = [0, 1, 2].map((w) => retirees * RETIREE_SPLIT[w] + students * STUDENT_SPLIT[w]);
    states.set(st, { day: st.day, venues, beach: beach * kEff, beachCells: bch.cells, historic: historic * kEff, culture, scores });
    rt.timing['tourism.attract'] = performance.now() - tp;
    sim.events.emit('layerUpdated', 'tourism');
  };

  /** a bulldozed (or otherwise removed) venue leaves the tourism totals at once: its visits stop feeding CS demand,
   *  approval and the tourism income line; the visitor raster refreshes with the next monthly update */
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
    if (r.kind === 'landmark' || r.kind === 'culture') ts.culture = Math.max(0, ts.culture - r.gross);
  };
  let subscribedTo: Simulation | null = null;
  let unsub: (() => void) | null = null;

  return {
    name: 'economy.tourism',
    rt,
    init(sim) {
      rt.attach(sim);
      if (subscribedTo !== sim) {
        unsub?.();
        unsub = sim.events.on('buildingRemoved', (b) => onRemoved(sim.state, b));
        subscribedTo = sim;
      }
      // the visitor raster and venue records are derived (not saved): rebuild them now (WP4-5). A loaded city keeps
      // last month's saved totals, attractiveness and migration until its next monthly update (save / load continuity).
      const st = sim.state;
      const d = econData(st);
      const keep = st.day > 0 && Object.keys(d.attractTerms).length > 0 ? savedOutputs(st) : null;
      update(sim);
      if (keep) restoreOutputs(st, keep);
    },
    monthly(sim) {
      const t0 = performance.now();
      update(sim);
      rt.timing.tourism = performance.now() - t0;
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
function restoreOutputs(st: CityState, o: ReturnType<typeof savedOutputs>): void {
  const d = econData(st), s = st.stats;
  d.tourists = o.tourists; d.touristsGross = o.touristsGross; d.overnight = o.overnight; d.hotelShortage = o.hotelShortage; d.tourism = o.tourism;
  d.attractiveness = o.attractiveness; d.attractByWealth = o.attractByWealth; d.attractTerms = o.attractTerms;
  d.migration = o.migration; d.migrants = o.migrants;
  s.tourists = o.sTourists; s.hotelRooms = o.sRooms; s.attractiveness = o.sAttract; s.attractByWealth = o.sAttractW;
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

/** scores 0..1 [culture, parks, safety, clean, quiet, services, jobs, connect] per wealth (0..2) and city-wide (3) */
function attractScores(
  st: CityState, sv: ResidentSurvey, inf: InfraFlags, culture: number,
  conn: { large: number; small: number; train: number; seaport: number },
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
    const clean = clamp(1 - ATTRACT_SCALES.air * sv.air[k], 0, 1);
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

/** the venue of a record still stands (records live until the next monthly update; building ids are never reused) */
function live(st: CityState, r: VenueRecord): boolean {
  return st.buildings.get(r.id)?.def === r.def;
}

/** attractiveness terms (culture, parks, safety, clean, quiet, services, jobs, connect) in points; sum = attractiveness */
export function attractivenessBreakdown(st: CityState): FactorTerm[] {
  const d = st.systemData.economy as { attractTerms?: Record<string, number> } | undefined;
  const T = d?.attractTerms;
  if (!T) return [];
  const ts = states.get(st);
  const out: FactorTerm[] = [];
  for (const id of ATTRACT_IDS) {
    if (T[id] === undefined) continue;
    let detail: string | undefined;
    if (id === 'culture' && ts) detail = `${Math.round(ts.culture).toLocaleString('en-US')} landmark & culture visits / day`;
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
  return {
    tourists: d.tourists, gross: d.touristsGross ?? d.tourists, overnight: d.overnight ?? 0, rooms: st.stats.hotelRooms,
    hotelShortage: d.hotelShortage, beach: ts.beach, beachCells: ts.beachCells, historic: ts.historic, topVenues: top,
  };
}
