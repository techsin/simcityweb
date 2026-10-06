/**
 * Overlay support (SIM_DEPTH_SPEC §F, WP5): maps a data view Overlay + variant to the per-cell data behind it, with a
 * normalisation scale and a palette hint, so the terrain renderer, the minimap and the query tool's hover readout all
 * draw and read the SAME numbers (the hover of a variant reads the variant's raster, never a different layer).
 * Headless: no DOM / three.js.
 *
 *  - overlayLayer(st, o, variant = -1): the layer; variant -1 = the overlay's default (for every pre-spec overlay the
 *    default is the direct CityState layer, e.g. Transit -> st.transitCov).
 *  - Derived rasters (Demographics shares / wealth, Emergency response categories, the Families / Seniors / Students
 *    appeal variants of Desirability, tap-water quality, NIMBY prestige - stigma) are built on demand into a per-state
 *    cache keyed by (overlay, variant) and rebuilt only when one of their inputs was recomputed: attachOverlays(sim)
 *    subscribes to the simulation's 'layerUpdated' events (CityScene). Without a subscription (headless callers) an
 *    entry is valid for the sim day it was built on. overlayValue runs on every hover move: it never rebuilds.
 *  - overlayValue(st, o, x, z, variant): the normalised value the renderer draws at a cell; overlayReadout(...): the
 *    player-facing text for the hover tip ("Auto-dispatch · 2.1 min to spare", "Children 18% of 240 residents").
 */
import { DEV_TYPE_COUNT, DEV_TYPE_LABELS, DevType, Network, Overlay, Zone, isRoad } from '../../core/types';
import { RESP_NONE, type Building, type CityState } from '../CityState';
import type { Simulation } from '../Simulation';
import { getDef } from '../catalog';
import { COHORT_BASE, COVERAGE_FALLBACK, TAP_SAFE, WORKFORCE_RATIO } from '../economy/tuning';
import { cohortShares, demographicsSim } from '../economy/demographics';
import { truckVolumeOf } from './transportFacilities';
import type { UtilitiesSystem } from './utilities';
import { emergencyOf } from './emergency';
import { EDU_LEGACY_W, EMERG_RMAX, EMERG_SLOW_MARGIN } from './params';
import { buildingList } from './common';

export type OverlayPalette = 'bad' | 'good' | 'binary' | 'diverging';

export interface OverlayLayer {
  /** per-cell values (i = z*N + x) */
  data: ArrayLike<number>;
  /** value mapped to full intensity (normalised = value / scale, clamp 0..1; diverging: -scale..scale) */
  scale: number;
  /** 'bad': high = bad (red), 'good': high = good (green/blue), 'binary': 0/1 (e.g. power), 'diverging': -1..1 */
  palette: OverlayPalette;
  /** only meaningful on road / rail cells (traffic) */
  roadsOnly?: boolean;
  label: string;
  /** the resolved variant (index into OVERLAY_VARIANTS[o]; 0 for overlays without variants) */
  variant: number;
  /**
   * positive values map to floor + (1 - floor) x clamp01(value / scale) and values <= 0 to 0: "no data" stays
   * transparent while a small real value is still visible (commute minutes: 0 = unknown)
   */
  floor?: number;
  /** simulation 'layerUpdated' names whose recomputation changes this layer (renderer refresh, cache invalidation) */
  deps: readonly string[];
  /** roads / rails and water hold no meaningful value (desirability writes -1 there): they read neutral (0) in the
   *  render and the hover, instead of a red rim along every street */
  maskNet?: boolean;
}

/** variant names per overlay (index = variant); overlays without an entry have the single variant 0 */
export const OVERLAY_VARIANTS: Partial<Record<Overlay, string[]>> = {
  [Overlay.Traffic]: ['Cars', 'Trucks'],
  [Overlay.Garbage]: ['Uncollected piles', 'Landfill fill'],
  [Overlay.Education]: ['All', 'Elementary', 'High school', 'University'],
  [Overlay.Water]: ['Service', 'Tap water quality'],
  [Overlay.Desirability]: [...DEV_TYPE_LABELS, 'Families', 'Seniors', 'Students'],
  [Overlay.Parks]: ['All', 'Play & sports', 'Gardens & parks'],
  [Overlay.Demographics]: ['Children', 'Teens', 'Young adults', 'Seniors', 'Workforce', 'Wealth'],
  [Overlay.Emergency]: ['Fire', 'Police', 'Medical'],
};

/** Desirability appeal variants (after the 12 DevTypes) */
export const DESIR_FAMILIES = DEV_TYPE_COUNT, DESIR_SENIORS = DEV_TYPE_COUNT + 1, DESIR_STUDENTS = DEV_TYPE_COUNT + 2;
/** Demographics variants */
export const DEMO_KIDS = 0, DEMO_TEENS = 1, DEMO_YAD = 2, DEMO_SENIORS = 3, DEMO_WORKFORCE = 4, DEMO_WEALTH = 5;
/** Emergency variants (responder order of the resp* layers) */
export const EMG_FIRE = 0, EMG_POLICE = 1, EMG_MEDICAL = 2;
/** Emergency response slack is drawn continuously within +-EMG_SPAN minutes (categories: >= 0 auto, -3..0 just out of
 *  reach, < -3 manual), RESP_NONE gets its own colour (encoded EMG_NONE_T) */
export const EMG_SPAN = 12;
export const EMG_NONE_T = 0.02;
/** slack (minutes) below which a player dispatch is far off (the "Just out of reach" band is -EMG_NEAR..0) */
export const EMG_NEAR = 3;
/** tap-water quality raster: served cells encode 0.1 + 0.9 x quality (0 = no water service) */
export const TAP_T0 = 0.1;
/** demographics rasters: residential cells encode DEMO_T0 + (1 - DEMO_T0) x clamp01(share / (2 x reference share)) */
export const DEMO_T0 = 0.04;

/** number of variants of an overlay (>= 1) */
export function overlayVariantCount(o: Overlay): number {
  return OVERLAY_VARIANTS[o]?.length ?? 1;
}

/** the variant a request resolves to: -1 / out of range = the overlay's default (Desirability: R$$) */
export function resolveVariant(o: Overlay, variant = -1): number {
  const n = overlayVariantCount(o);
  if (variant >= 0 && variant < n && Number.isInteger(variant)) return variant;
  return o === Overlay.Desirability ? DevType.R2 : 0;
}

/** short name of a variant ('' for overlays without variants) */
export function overlayVariantLabel(o: Overlay, variant = -1): string {
  const v = OVERLAY_VARIANTS[o];
  return v ? v[resolveVariant(o, variant)] : '';
}

// ================================================================================================ derived-raster cache
interface Entry {
  data: Float32Array;
  /** extra scale computed with the raster (truck volumes) */
  scale: number;
  day: number;
  dirty: boolean;
  deps: readonly string[];
  /** painted per building (Demographics): buildings added / removed / changed since the build (Cache.bver) make it
   *  stale on the next sim day — at most one rebuild a day, however fast the city grows */
  perBuilding: boolean;
  bver: number;
}
interface Cache {
  sim?: Simulation;
  /** a simulation's layerUpdated events invalidate the entries (else: valid for one sim day) */
  subscribed: boolean;
  entries: Map<number, Entry>;
  /** bumped by every buildingAdded / buildingRemoved / buildingChanged event (see Entry.perBuilding) */
  bver: number;
}
const caches = new WeakMap<CityState, Cache>();
function cacheOf(st: CityState): Cache {
  let c = caches.get(st);
  if (!c) caches.set(st, (c = { subscribed: false, entries: new Map(), bver: 0 }));
  return c;
}
/** the cached raster must be rebuilt before it is read (see derived) */
function entryStale(c: Cache, e: Entry, st: CityState): boolean {
  return e.dirty || (!c.subscribed && e.day !== st.day) || (e.perBuilding && e.bver !== c.bver && e.day !== st.day);
}
const keyOf = (o: Overlay, v: number) => o * 64 + v;

/**
 * Bind a simulation to its state for the derived rasters (water quality, emergency readiness) and invalidate them on
 * the simulation's layerUpdated events. Returns the unsubscribe function. Call again after the state is replaced.
 */
export function attachOverlays(sim: Simulation): () => void {
  const c = cacheOf(sim.state);
  c.sim = sim;
  c.subscribed = true;
  const off = sim.events.on('layerUpdated', (name) => markOverlaysDirty(sim.state, name));
  // per-building rasters (Demographics) follow the buildings, not only their 30-day 'demographics' event
  const bump = () => { const cc = caches.get(sim.state); if (cc) cc.bver++; };
  const offB = [sim.events.on('buildingAdded', bump), sim.events.on('buildingRemoved', bump), sim.events.on('buildingChanged', bump)];
  const offReset = sim.events.on('reset', () => {
    const cc = cacheOf(sim.state);
    cc.sim = sim;
    cc.subscribed = true;
    cc.entries.clear();
  });
  return () => {
    off();
    for (const f of offB) f();
    offReset();
    const cc = caches.get(sim.state);
    if (cc && cc.sim === sim) cc.subscribed = false;
  };
}

/** a derived layer was recomputed: rebuild the cached rasters that read it on their next use */
export function markOverlaysDirty(st: CityState, layer?: string): void {
  const c = caches.get(st);
  if (!c) return;
  for (const e of c.entries.values()) if (layer === undefined || e.deps.includes(layer)) e.dirty = true;
}

function simOf(st: CityState): Simulation | undefined {
  const c = caches.get(st);
  if (c?.sim && c.sim.state === st) return c.sim;
  return demographicsSim(st);
}

const NO_RASTER = new Float32Array(0);
/**
 * a cached derived raster of (o, v), (re)built by `build` when missing / invalidated. raster = false: only the value
 * `build` returns is cached (e.g. the truck overlay's scale), no raster is allocated
 */
function derived(st: CityState, o: Overlay, v: number, deps: readonly string[], build: (out: Float32Array) => number | void, raster = true, perBuilding = false): Entry {
  const c = cacheOf(st);
  const k = keyOf(o, v);
  let e = c.entries.get(k);
  const size = raster ? st.cells : 0;
  const stale = !e || e.data.length !== size || entryStale(c, e, st);
  if (stale) {
    let data: Float32Array = NO_RASTER;
    if (raster) {
      data = e && e.data.length === size ? e.data : new Float32Array(size);
      data.fill(0);
    }
    const bver = c.bver;
    const s = build(data);
    e = { data, scale: typeof s === 'number' && s > 0 ? s : 1, day: st.day, dirty: false, deps, perBuilding, bver };
    c.entries.set(k, e);
  }
  return e!;
}

/**
 * The derived raster of an overlay + variant was invalidated since it was last built (its layer was recomputed, or —
 * per-building views — buildings changed and a sim day passed): the renderer refreshes its texture. false for direct
 * layers (they refresh on their layerUpdated event) and rasters not built yet.
 */
export function overlayStale(st: CityState, o: Overlay, variant = -1): boolean {
  const c = caches.get(st);
  const e = c?.entries.get(keyOf(o, resolveVariant(o, variant)));
  return !!c && !!e && e.data.length === st.cells && entryStale(c, e, st);
}

// ================================================================================================ raster builders
/** per state: residential class per building id (0 unknown, 1 residential, 2 other) — ids are never reused and a
 *  building never changes its def, so the raster loop reads a typed array instead of a catalog lookup */
const homeClass = new WeakMap<CityState, Uint8Array>();
/** the class array of a state, sized for every building id handed out so far */
function homeClassOf(st: CityState, id = 0): Uint8Array {
  let a = homeClass.get(st);
  if (!a || id >= a.length || st.nextBuildingId >= a.length) {
    const n = new Uint8Array(Math.max(1024, id + 1, st.nextBuildingId + 1, (a?.length ?? 0) * 2));
    if (a) n.set(a);
    homeClass.set(st, (a = n));
  }
  return a;
}
/** class of b (see homeClass), looked up and cached in `a` (a from homeClassOf) */
function classify(a: Uint8Array, b: Building): number {
  const def = getDef(b.def);
  if (!def) return 0; // (catalog not loaded yet: do not cache)
  return (a[b.id] = def.devType !== undefined && def.devType <= DevType.R3 ? 1 : 2);
}
function isResidential(st: CityState, b: Building): boolean {
  const a = homeClassOf(st, b.id);
  const k = a[b.id];
  return (k === 0 ? classify(a, b) : k) === 1;
}
/** residential buildings with residents (the demographics rasters) */
function isHome(st: CityState, b: Building): boolean {
  return b.pop > 0 && isResidential(st, b);
}

const SHARE = new Float32Array(5);
/** share of a demographics variant in a home (cohort share, workforce share, wealth / 3) and its reference value */
function demoShare(b: Building, variant: number): { share: number; ref: number } {
  if (variant === DEMO_WEALTH) return { share: Math.max(1, Math.min(3, b.wealth)) / 3, ref: 0.5 };
  if (variant === DEMO_WORKFORCE) return { share: b.wf ?? WORKFORCE_RATIO, ref: WORKFORCE_RATIO };
  const s = cohortShares(b, SHARE);
  const c = variant === DEMO_KIDS ? 0 : variant === DEMO_TEENS ? 1 : variant === DEMO_YAD ? 2 : 4;
  return { share: s[c], ref: COHORT_BASE[c] };
}

/** per state: the residential buildings (the demographics rasters), rebuilt when buildings come or go */
const homesCache = new WeakMap<CityState, { size: number; nextId: number; list: Building[] }>();
function homesOf(st: CityState): Building[] {
  const c = homesCache.get(st);
  if (c && c.size === st.buildings.size && c.nextId === st.nextBuildingId) return c.list;
  const cls = homeClassOf(st);
  const list: Building[] = [];
  const all = buildingList(st);
  for (let k = 0; k < all.length; k++) {
    const b = all[k];
    const kk = cls[b.id];
    if ((kk === 0 ? classify(cls, b) : kk) === 1) list.push(b);
  }
  homesCache.set(st, { size: st.buildings.size, nextId: st.nextBuildingId, list });
  return list;
}

/** PERF (256²: one pass per 'demographics' event and at most once a sim day after buildings change, while shown): the
 *  cached homes list gives one value per home (cohort share inlined: cohortShares reads the profile shares when a
 *  cohort field is unset), painted over its own footprint cells (st.building) — no pass over the whole map (the raster
 *  arrives zeroed) */
function buildDemographics(st: CityState, variant: number, out: Float32Array): void {
  const N = st.size, bld = st.building;
  const c = variant === DEMO_KIDS ? 0 : variant === DEMO_TEENS ? 1 : variant === DEMO_YAD ? 2 : 4;
  const inv = 1 / (2 * (variant === DEMO_WORKFORCE ? WORKFORCE_RATIO : COHORT_BASE[c]));
  const base = COHORT_BASE[c];
  const list = homesOf(st);
  for (let k = 0; k < list.length; k++) {
    const b = list[k];
    if (b.pop <= 0) continue;
    let t: number;
    if (variant === DEMO_WEALTH) t = (b.wealth < 1 ? 1 : b.wealth > 3 ? 3 : b.wealth) / 3;
    else {
      let share: number;
      if (variant === DEMO_WORKFORCE) share = b.wf ?? WORKFORCE_RATIO;
      else {
        const kd = b.kids, tn = b.teens, ya = b.yad, sr = b.srs;
        share = kd === undefined || tn === undefined || ya === undefined || sr === undefined ? base : c === 0 ? kd : c === 1 ? tn : c === 2 ? ya : sr;
      }
      const r = share * inv;
      t = DEMO_T0 + (1 - DEMO_T0) * (r < 0 ? 0 : r > 1 ? 1 : r);
    }
    if (!(t > 0)) continue;
    const id = b.id, x0 = b.x < 0 ? 0 : b.x, x1 = b.x + b.w > N ? N : b.x + b.w, z1 = b.z + b.d > N ? N : b.z + b.d;
    for (let z = b.z < 0 ? 0 : b.z; z < z1; z++) {
      for (let i = z * N + x0, e = z * N + x1; i < e; i++) if (bld[i] === id) out[i] = t;
    }
  }
}

/** Emergency: slack minutes -> 0.08 .. 1 continuously (-EMG_SPAN .. +EMG_SPAN), RESP_NONE -> EMG_NONE_T */
export function encodeSlack(slack: number): number {
  if (slack <= RESP_NONE + 0.5) return EMG_NONE_T;
  const s = slack < -EMG_SPAN ? -EMG_SPAN : slack > EMG_SPAN ? EMG_SPAN : slack;
  return 0.08 + (0.92 * (s + EMG_SPAN)) / (2 * EMG_SPAN);
}

function respLayer(st: CityState, variant: number): Float32Array {
  return variant === EMG_POLICE ? st.respPolice : variant === EMG_MEDICAL ? st.respMedical : st.respFire;
}

/** response layers computed (false while the emergency system has not finished its first pass: no data yet) */
function respReady(st: CityState): boolean {
  const sim = simOf(st);
  if (!sim) return true;
  const em = emergencyOf(sim);
  return !em || !em.active ? false : em.layersReady;
}

/** slack of an encoded Emergency value (encodeSlack's inverse on -EMG_SPAN .. +EMG_SPAN) */
export function decodeSlack(t: number): number {
  return ((t - 0.08) / 0.92) * 2 * EMG_SPAN - EMG_SPAN;
}
/** empty land, water and rail beside no road node read the emergency land fill's floor (-EMERG_RMAX): nothing there
 *  calls for help until a lot is built, and a lot faces its nearest road — such cells show the nearest road / lot's
 *  reach within EMG_DILATE steps (block interiors no longer read "You must dispatch") */
export const EMG_DILATE = 4;
/** the encoded floor (encodeSlack(-EMERG_RMAX)): 6+ min beyond every station, or a building with no road beside it */
export const EMG_FLOOR_T = 0.08;
/**
 * empty land / water / rail that no road reaches within EMG_DILATE steps: drawn exactly like the floor (both encode to
 * the same 8-bit texel in the renderer's colour pass) but read as "No road nearby" by the hover and the inspector —
 * never as "build a station closer"
 */
export const EMG_NOROAD_T = 0.0795;
/** a 4-neighbour tile around the footprint (no corners) is a road: emergency vehicles stop there */
export function roadBeside(st: CityState, b: Pick<Building, 'x' | 'z' | 'w' | 'd'>): boolean {
  const N = st.size, net = st.network;
  for (let x = Math.max(0, b.x); x < Math.min(N, b.x + b.w); x++) {
    if (b.z > 0 && isRoad(net[(b.z - 1) * N + x])) return true;
    if (b.z + b.d < N && isRoad(net[(b.z + b.d) * N + x])) return true;
  }
  for (let z = Math.max(0, b.z); z < Math.min(N, b.z + b.d); z++) {
    if (b.x > 0 && isRoad(net[z * N + b.x - 1])) return true;
    if (b.x + b.w < N && isRoad(net[z * N + b.x + b.w])) return true;
  }
  return false;
}
/**
 * best response slack over a building's footprint: the emergency pass writes one value per building, but a building
 * that grew since the last pass (EMERG_RESP_PERIOD) still holds the land fill of its cells (inner cells: the floor)
 */
function footprintSlack(st: CityState, L: Float32Array, b: Building): number {
  const N = st.size, bld = st.building;
  let best = -Infinity;
  for (let z = Math.max(0, b.z); z < Math.min(N, b.z + b.d); z++) {
    for (let x = Math.max(0, b.x); x < Math.min(N, b.x + b.w); x++) {
      const i = z * N + x;
      if (bld[i] === b.id && L[i] > best) best = L[i];
    }
  }
  return best;
}

/** auto-dispatch reach of one responder at a cell (the Emergency view's value there, and the inspector's) */
export interface EmergencyReach {
  /** minutes to spare: >= 0 a unit is sent automatically in time, < 0 beyond reach (the player dispatches),
   *  RESP_NONE no station of the type; -EMERG_RMAX = the layers' floor (see why) */
  slack: number;
  /**
   * '' as computed · 'noStation' no station of the type · 'noRoad' a building with no road beside it (empty land,
   * water, rail: no road within EMG_DILATE steps) · 'far' more than EMERG_SLOW_MARGIN minutes beyond every station's
   * reach (the floor; empty land: its nearest road is) · 'land' empty land / water / rail beside no road node: the
   * reach of the nearest road / lot within EMG_DILATE steps
   */
  why: '' | 'noStation' | 'noRoad' | 'far' | 'land';
}

/**
 * Emergency response at cell i for an Emergency variant (EMG_FIRE / EMG_POLICE / EMG_MEDICAL): buildings read the best
 * slack over their footprint, empty land / water / rail the nearest road / lot's (the raster's EMG_DILATE fill), and
 * the layers' floor is told apart (no road beside the building, or none within EMG_DILATE steps of the land, vs 6+ min
 * beyond every station). null while the layers are not computed. overlayReadout and the inspector both read it, so
 * hover and inspector never disagree.
 */
export function emergencyReachAt(st: CityState, i: number, variant = -1): EmergencyReach | null {
  if (i < 0 || i >= st.cells || !respReady(st)) return null;
  const v = resolveVariant(Overlay.Emergency, variant);
  const L = respLayer(st, v);
  const bid = st.building[i];
  const b = bid >= 0 ? st.buildings.get(bid) : undefined;
  const s = b ? footprintSlack(st, L, b) : L[i];
  if (s <= RESP_NONE + 0.5) return { slack: RESP_NONE, why: 'noStation' };
  const floor = -EMERG_RMAX + 1e-3;
  if (b) return s <= floor ? { slack: -EMERG_RMAX, why: roadBeside(st, b) ? 'far' : 'noRoad' } : { slack: s, why: '' };
  if (s > floor) return { slack: s, why: '' };
  // a road at the floor is itself 6+ min beyond every station
  if (isRoad(st.network[i])) return { slack: -EMERG_RMAX, why: 'far' };
  // land / water / rail beside no road node: the raster's fill from the nearest road / lot (buildEmergency)
  const raw = overlayLayer(st, Overlay.Emergency, v)!.data[i];
  if (raw < EMG_FLOOR_T - 2e-4) return { slack: -EMERG_RMAX, why: 'noRoad' };
  const d = decodeSlack(raw);
  return d > floor ? { slack: d, why: 'land' } : { slack: -EMERG_RMAX, why: 'far' };
}

let emgQueue = new Int32Array(0);
let emgQx = new Uint16Array(0);
let emgDepth = new Uint8Array(0);
let emgOpen = new Int32Array(0);
let emgOpenX = new Uint16Array(0);
/** per building id: the best footprint slack of a building met at the floor (stamped per build: emgPass) */
let emgBest = new Float32Array(0);
let emgBestPass = new Uint32Array(0);
let emgPass = 0;
/** depth mark of an inert cell: neither a fill source nor a fill target */
const EMG_INERT = 255;
/** the best footprint slack of building id, memoised for the current build */
function buildingBest(st: CityState, L: Float32Array, id: number): number {
  if (id >= emgBestPass.length) {
    const n = Math.max(1024, id + 1, st.nextBuildingId + 1, emgBestPass.length * 2);
    const best = new Float32Array(n), pass = new Uint32Array(n);
    best.set(emgBest);
    pass.set(emgBestPass);
    emgBest = best;
    emgBestPass = pass;
  }
  if (emgBestPass[id] === emgPass) return emgBest[id];
  const b = st.buildings.get(id);
  const s = b ? footprintSlack(st, L, b) : -EMERG_RMAX;
  emgBestPass[id] = emgPass;
  emgBest[id] = s;
  return s;
}
/**
 * The Emergency raster. The cells are
 *  - sources: road cells (their own reach — a road at the floor is itself 6+ min out) and every other cell above the
 *    floor (land / rail beside a road node, a building with a road; a building that grew since the last emergency pass
 *    reads its footprint's best cell, as emergencyReachAt does — its inner cells still hold the land fill's floor);
 *  - targets: land, water and rail at the floor (beside no road node) take the nearest source's value within
 *    EMG_DILATE steps (a lot there would face that road), else EMG_NOROAD_T ("No road nearby");
 *  - inert: buildings at the floor (no road beside them, or 6+ min out) and RESP_NONE cells keep their own value, and
 *    the fill neither starts from nor passes through them — land beside a roadless plaza reads the road, not the plaza.
 * PERF (one build per 'emergency' event while shown, 256²): (1) one pass encodes the sources / inert cells and lists
 * the targets, (2) the sources beside a target are queued in target order (left, right, up, down: deterministic
 * ties), (3) a multi-source BFS through targets only (x kept in the queue: no modulo per step).
 */
function buildEmergency(st: CityState, variant: number, out: Float32Array): void {
  if (!respReady(st)) return;
  const L = respLayer(st, variant);
  const C = st.cells, N = st.size, bld = st.building, net = st.network;
  if (emgQueue.length < C) {
    emgQueue = new Int32Array(C); emgQx = new Uint16Array(C); emgDepth = new Uint8Array(C);
    emgOpen = new Int32Array(C); emgOpenX = new Uint16Array(C);
  }
  const q = emgQueue, qx = emgQx, dep = emgDepth, openList = emgOpen, openX = emgOpenX;
  dep.fill(0, 0, C);
  emgPass = (emgPass % 0xfffffff0) + 1;
  const floor = -EMERG_RMAX + 1e-3, none = RESP_NONE + 0.5, k0 = 0.92 / (2 * EMG_SPAN);
  // (1) encode sources and inert cells (encodeSlack inlined), list the targets
  let open = 0;
  for (let z = 0, i = 0; z < N; z++) {
    for (let x = 0; x < N; x++, i++) {
      let s = L[i];
      if (s <= floor) {
        if (s <= none) { out[i] = EMG_NONE_T; dep[i] = EMG_INERT; continue; }
        const id = bld[i];
        if (id >= 0) {
          s = buildingBest(st, L, id);
          if (s <= floor) { out[i] = s <= none ? EMG_NONE_T : EMG_FLOOR_T; dep[i] = EMG_INERT; continue; }
        } else {
          const n = net[i];
          if (n < Network.Street || n > Network.Highway) { out[i] = -1; openList[open] = i; openX[open++] = x; continue; }
        }
      }
      out[i] = 0.08 + k0 * ((s < -EMG_SPAN ? -EMG_SPAN : s > EMG_SPAN ? EMG_SPAN : s) + EMG_SPAN);
    }
  }
  if (open === 0) return;
  // (2) the sources beside a target (dep 1); inert cells (dep EMG_INERT) and targets (out -1) are not
  let tail = 0;
  for (let k = 0; k < open; k++) {
    const i = openList[k], x = openX[k];
    if (x > 0 && dep[i - 1] === 0 && out[i - 1] >= 0) { dep[i - 1] = 1; q[tail] = i - 1; qx[tail++] = x - 1; }
    if (x < N - 1 && dep[i + 1] === 0 && out[i + 1] >= 0) { dep[i + 1] = 1; q[tail] = i + 1; qx[tail++] = x + 1; }
    if (i >= N && dep[i - N] === 0 && out[i - N] >= 0) { dep[i - N] = 1; q[tail] = i - N; qx[tail++] = x; }
    if (i + N < C && dep[i + N] === 0 && out[i + N] >= 0) { dep[i + N] = 1; q[tail] = i + N; qx[tail++] = x; }
  }
  // (3) BFS through targets, at most EMG_DILATE steps (depth stored +1: sources 1; the last ring is not queued)
  const last = EMG_DILATE + 1;
  for (let head = 0; head < tail; head++) {
    const i = q[head], x = qx[head];
    const d = dep[i] + 1, more = d < last, v = out[i];
    if (x > 0 && out[i - 1] < 0) { out[i - 1] = v; dep[i - 1] = d; if (more) { q[tail] = i - 1; qx[tail++] = x - 1; } }
    if (x < N - 1 && out[i + 1] < 0) { out[i + 1] = v; dep[i + 1] = d; if (more) { q[tail] = i + 1; qx[tail++] = x + 1; } }
    if (i >= N && out[i - N] < 0) { out[i - N] = v; dep[i - N] = d; if (more) { q[tail] = i - N; qx[tail++] = x; } }
    if (i + N < C && out[i + N] < 0) { out[i + N] = v; dep[i + N] = d; if (more) { q[tail] = i + N; qx[tail++] = x; } }
  }
  // no road within EMG_DILATE steps: drawn like the floor, read as "No road nearby"
  for (let k = 0; k < open; k++) { const i = openList[k]; if (out[i] < 0) out[i] = EMG_NOROAD_T; }
}

function servicesOn(st: CityState): boolean {
  if (st.systemData.infraVersion === undefined) return false;
  const l = st.systemData.infraLayers as { services?: boolean } | undefined;
  return l?.services ?? true;
}

/**
 * Families / Seniors / Students appeal (demographics.ts familyScoreAt / seniorScoreAt / studentScoreAt) in one typed-array
 * loop — the same weights; tests/infra/overlays.test.ts pins it to the demographics functions cell by cell.
 */
function buildAppeal(st: CityState, variant: number, out: Float32Array): void {
  const C = st.cells, f = COVERAGE_FALLBACK;
  const crime = st.crime, noise = st.noise, water = st.water;
  if (!servicesOn(st)) {
    // no services system: every coverage reads COVERAGE_FALLBACK (demographics.ts accessAt)
    for (let i = 0; i < C; i++) {
      if (water[i]) continue;
      let v: number;
      if (variant === DESIR_FAMILIES) { const nz = noise[i]; v = 0.85 * f + 0.15 * (1 - crime[i]) - 0.1 * (nz > 0.3 ? nz - 0.3 : 0); }
      else if (variant === DESIR_SENIORS) v = 0.85 * f + 0.15 * (1 - noise[i]);
      else v = f;
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    return;
  }
  if (variant === DESIR_FAMILIES) {
    const E = st.eduElemCov, H = st.eduHighCov, P = st.playCov;
    for (let i = 0; i < C; i++) {
      if (water[i]) continue;
      const nz = noise[i];
      const v = 0.45 * E[i] + 0.2 * H[i] + 0.2 * P[i] + 0.15 * (1 - crime[i]) - 0.1 * (nz > 0.3 ? nz - 0.3 : 0);
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  } else if (variant === DESIR_SENIORS) {
    const Hc = st.healthCov, G = st.greenCov, S = st.shopAccess;
    for (let i = 0; i < C; i++) {
      if (water[i]) continue;
      const v = 0.45 * Hc[i] + 0.2 * G[i] + 0.2 * S[i] + 0.15 * (1 - noise[i]);
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  } else {
    const Co = st.eduCollegeCov, T = st.transitCov, S = st.shopAccess;
    for (let i = 0; i < C; i++) {
      if (water[i]) continue;
      const v = 0.6 * Co[i] + 0.2 * T[i] + 0.2 * S[i];
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
}

/**
 * tap-water quality per served cell: TAP_T0 + (1 - TAP_T0) x quality (utilities per-network quality), 0 = no water.
 * PERF: one quality lookup per building (utilities keeps one network per building: the first cell of a footprint
 * answers for all of it) and per run of road cells (4-adjacent road cells are one pipe network: a road cell next to
 * an already known one copies it — left / up flags instead of re-testing the neighbours); the per-cell lookup is left
 * for the few other served cells.
 */
const tapIds = new WeakMap<CityState, { val: Float32Array; stamp: Uint32Array; pass: number; up: Uint8Array }>();
function buildTapWater(st: CityState, out: Float32Array): void {
  const sim = simOf(st);
  const w = st.watered, C = st.cells, N = st.size, bld = st.building, net = st.network;
  const A = TAP_T0, B = 1 - TAP_T0;
  const u = sim?.getSystem<UtilitiesSystem>('utilities');
  if (!sim || !u) {
    // no per-network quality: every served cell reads the city mean
    const t = A + B * clamp01(st.stats.tapWater ?? 1);
    for (let i = 0; i < C; i++) if (w[i]) out[i] = t;
    return;
  }
  let ids = tapIds.get(st);
  if (!ids || ids.val.length < st.nextBuildingId || ids.up.length < N) {
    const n = Math.max(1024, st.nextBuildingId * 2);
    tapIds.set(st, (ids = { val: new Float32Array(n), stamp: new Uint32Array(n), pass: 0, up: new Uint8Array(N) }));
  }
  const pass = (ids.pass = (ids.pass % 0xfffffff0) + 1), val = ids.val, stamp = ids.stamp, up = ids.up;
  // up[x]: (x, z - 1) is a served road cell (no building); left: (x - 1, z) is
  up.fill(0, 0, N);
  for (let z = 0, i = 0; z < N; z++) {
    let left = false;
    for (let x = 0; x < N; x++, i++) {
      if (!w[i]) { left = false; up[x] = 0; continue; }
      const id = bld[i];
      if (id >= 0) {
        if (stamp[id] !== pass) {
          stamp[id] = pass;
          const q = u.waterQualityAt(sim, i);
          val[id] = A + B * (q < 0 ? 0 : q > 1 ? 1 : q);
        }
        out[i] = val[id];
        left = false; up[x] = 0;
        continue;
      }
      const n = net[i];
      if (n >= Network.Street && n <= Network.Highway) {
        if (left) out[i] = out[i - 1];
        else if (up[x]) out[i] = out[i - N];
        else { const q = u.waterQualityAt(sim, i); out[i] = A + B * (q < 0 ? 0 : q > 1 ? 1 : q); }
        left = true; up[x] = 1;
        continue;
      }
      const q = u.waterQualityAt(sim, i);
      out[i] = A + B * (q < 0 ? 0 : q > 1 ? 1 : q);
      left = false; up[x] = 0;
    }
  }
}

function buildNimby(st: CityState, out: Float32Array): void {
  const P = st.prestige, S = st.stigma, C = st.cells;
  for (let i = 0; i < C; i++) out[i] = P[i] - S[i];
}

/** truck volumes: the traffic array itself (no copy) plus a scale = the ~98th percentile of the busy road cells (a
 *  64-bin histogram over 0..max: O(cells), no sort) */
const TRUCK_BINS = new Uint32Array(64);
function truckScale(st: CityState, T: Float32Array): number {
  const net = st.network, n = Math.min(T.length, net.length);
  let mx = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const v = T[i];
    if (v > 0.5 && net[i] !== Network.None && net[i] !== Network.Rail) { cnt++; if (v > mx) mx = v; }
  }
  if (cnt === 0) return 100;
  TRUCK_BINS.fill(0);
  const k = 63.999 / mx;
  for (let i = 0; i < n; i++) {
    const v = T[i];
    if (v > 0.5 && net[i] !== Network.None && net[i] !== Network.Rail) TRUCK_BINS[(v * k) | 0]++;
  }
  const want = Math.ceil(cnt * 0.98);
  let acc = 0, b = 0;
  for (; b < 64; b++) { acc += TRUCK_BINS[b]; if (acc >= want) break; }
  return Math.max(50, ((b + 1) / 64) * mx);
}

/** Trucks raster: sqrt(trucks / scale) clamped to 0..1 (scale = truckScale) */
function buildTrucks(st: CityState, T: Float32Array, out: Float32Array): number {
  const sc = truckScale(st, T);
  const inv = 1 / sc, n = Math.min(T.length, out.length);
  for (let i = 0; i < n; i++) {
    const v = T[i];
    if (v > 0) { const r = v * inv; out[i] = r >= 1 ? 1 : Math.sqrt(r); }
  }
  return sc;
}

// ================================================================================================ the layers
const L = (data: ArrayLike<number>, scale: number, palette: OverlayPalette, label: string, variant: number, deps: readonly string[], extra: Partial<OverlayLayer> = {}): OverlayLayer =>
  ({ data, scale, palette, label, variant, deps, ...extra });

const EDU_LABELS = ['Education coverage (all school tiers)', 'Elementary schools', 'High schools', 'Colleges & universities'];
const DEMO_LABELS = ['Children (0–11) share', 'Teens (12–17) share', 'Young adults (18–24) share', 'Seniors (65+) share', 'Workforce share', 'Household wealth'];
const EMG_LABELS = ['Fire response', 'Police response', 'Ambulance response'];

const D_SVC: readonly string[] = ['services'];
const D_CATCH: readonly string[] = ['catchments', 'services'];
const D_POLL: readonly string[] = ['pollution'];
const D_TRAFFIC: readonly string[] = ['traffic'];
const D_APPEAL: readonly string[] = ['services', 'catchments', 'crime', 'pollution'];

/**
 * simulation 'layerUpdated' names that change an overlay + variant (the terrain renderer refreshes on them, the derived
 * rasters are rebuilt after them); [] = static data (None / Zones)
 */
export function overlayDeps(o: Overlay, variant = -1): readonly string[] {
  const v = resolveVariant(o, variant);
  switch (o) {
    case Overlay.Traffic: return D_TRAFFIC;
    case Overlay.AirPollution: case Overlay.WaterPollution: case Overlay.Garbage: case Overlay.Soil: return D_POLL;
    case Overlay.LandValue: return ['landValue', 'desirability'];
    case Overlay.Crime: return ['crime', 'services'];
    case Overlay.Police: case Overlay.Fire: case Overlay.Health: return D_SVC;
    case Overlay.Education: case Overlay.Parks: case Overlay.Shops: case Overlay.Nimby: return D_CATCH;
    case Overlay.Power: return ['utilities'];
    case Overlay.Water: return v === 1 ? ['utilities', 'pollution'] : ['utilities'];
    case Overlay.Desirability: return v >= DEV_TYPE_COUNT ? D_APPEAL : ['desirability'];
    case Overlay.Noise: return ['pollution', 'traffic'];
    case Overlay.Transit: return ['services', 'traffic'];
    case Overlay.Commute: return ['catchments', 'traffic'];
    case Overlay.Demographics: return ['demographics'];
    case Overlay.Tourism: return ['tourism'];
    case Overlay.Emergency: return ['emergency'];
    case Overlay.Parking: return ['parking', 'traffic'];
    default: return [];
  }
}

/** the layer behind an overlay + variant, or null (None / Zones are drawn by the renderer from zone data) */
export function overlayLayer(st: CityState, o: Overlay, variant = -1): OverlayLayer | null {
  const v = resolveVariant(o, variant);
  const deps = overlayDeps(o, v);
  switch (o) {
    case Overlay.Traffic: {
      if (v === 1) {
        const T = truckVolumeOf(st);
        // (no freight data yet: one cached zero raster — overlayValue runs on every hover move)
        if (!T || T.length !== st.cells) return L(derived(st, o, 63, deps, () => undefined).data, 1, 'bad', 'Trucks per day (no freight data yet)', v, deps, { roadsOnly: true });
        // sqrt of volume / the busy roads' ~98th percentile: mid-volume freight shows, not only the trunk routes
        const e = derived(st, o, v, deps, (out) => buildTrucks(st, T, out));
        return L(e.data, 1, 'bad', 'Trucks per day', v, deps, { roadsOnly: true });
      }
      return L(st.congestion, 1.2, 'bad', 'Traffic (volume / capacity)', v, deps, { roadsOnly: true });
    }
    case Overlay.AirPollution: return L(st.airPollution, 1, 'bad', 'Air pollution', v, deps);
    case Overlay.WaterPollution: return L(st.waterPollution, 1, 'bad', 'Water pollution', v, deps);
    case Overlay.Garbage:
      return v === 1 ? L(st.landfillFill, 1, 'bad', 'Landfill fill', v, deps) : L(st.garbage, 1, 'bad', 'Uncollected garbage', v, deps);
    case Overlay.LandValue: return L(st.landValue, 1, 'good', 'Land value', v, deps);
    case Overlay.Crime: return L(st.crime, 1, 'bad', 'Crime', v, deps);
    case Overlay.Police: return L(st.policeCov, 1, 'good', 'Police patrol coverage', v, deps);
    case Overlay.Fire: return L(st.fireCov, 1, 'good', 'Fire prevention coverage', v, deps);
    case Overlay.Health: return L(st.healthCov, 1, 'good', 'Care access (clinics & hospitals)', v, deps);
    case Overlay.Education: {
      const d = v === 1 ? st.eduElemCov : v === 2 ? st.eduHighCov : v === 3 ? st.eduCollegeCov : st.eduCov;
      // 'All': st.eduCov weighs the tiers 45 / 35 / 20 % — scaled to the tiers the city can build, so a town without a
      // university yet still reaches full colour with elementary + high schools nearby
      return L(d, v === 0 ? educationScale(st) : 1, 'good', EDU_LABELS[v], v, deps);
    }
    case Overlay.Power: return L(st.powered, 1, 'binary', 'Power', v, deps);
    case Overlay.Water: {
      if (v === 1) {
        const e = derived(st, o, v, deps, (out) => buildTapWater(st, out));
        return L(e.data, 1, 'good', 'Tap water quality', v, deps);
      }
      return L(st.watered, 1, 'binary', 'Water', v, deps);
    }
    case Overlay.Desirability: {
      if (v >= DEV_TYPE_COUNT) {
        const e = derived(st, o, v, deps, (out) => buildAppeal(st, v, out));
        const who = v === DESIR_FAMILIES ? 'families' : v === DESIR_SENIORS ? 'seniors' : 'students';
        // appeal 0..1 (0.5 = neutral: the renderer draws it on the desirability colours)
        return L(e.data, 1, 'good', `Appeal for ${who}`, v, deps);
      }
      return L(st.desirability[v], 1, 'diverging', `Desirability (${DEV_TYPE_LABELS[v]})`, v, deps, { maskNet: true });
    }
    case Overlay.Noise: return L(st.noise, 1, 'bad', 'Noise', v, deps);
    case Overlay.Transit: return L(st.transitCov, 1, 'good', 'Transit coverage', v, deps);
    case Overlay.Parks: {
      const d = v === 1 ? st.playCov : v === 2 ? st.greenCov : st.parkCov;
      return L(d, 1, 'good', v === 1 ? 'Playgrounds & sports' : v === 2 ? 'Gardens & parks' : 'Parks & recreation', v, deps);
    }
    case Overlay.Commute: return L(st.accessCommute, commuteScale(st), 'bad', 'Commute time (minutes)', v, deps, { floor: 0.06 });
    case Overlay.Shops: return L(st.shopAccess, 1, 'good', 'Shops within reach', v, deps);
    case Overlay.Demographics: {
      const e = derived(st, o, v, deps, (out) => buildDemographics(st, v, out), true, true);
      return L(e.data, 1, 'good', DEMO_LABELS[v], v, deps);
    }
    case Overlay.Tourism: return L(st.visitors, 1, 'good', 'Tourist visitors', v, deps);
    case Overlay.Nimby: {
      const e = derived(st, o, v, deps, (out) => buildNimby(st, out));
      return L(e.data, NIMBY_SCALE, 'diverging', 'Neighbourhood image (prestige − stigma)', v, deps);
    }
    case Overlay.Soil: return L(st.soil, 1, 'bad', 'Soil contamination', v, deps);
    case Overlay.Emergency: {
      const e = derived(st, o, v, deps, (out) => buildEmergency(st, v, out));
      return L(e.data, 1, 'good', EMG_LABELS[v], v, deps);
    }
    case Overlay.Parking: return L(st.parking, 1, 'bad', 'Parking pressure', v, deps);
    default: return null;
  }
}

/** Education 'All' scale: the EDU_LEGACY_W weights of the school tiers the city can build (elementary + high school
 *  always; university / library once unlocked) */
export function educationScale(st: CityState): number {
  const [we, wh, wc] = EDU_LEGACY_W;
  return we + wh + (collegeUnlocked(st) ? wc : 0);
}
/** a university or library can be built (unlocked, or needs no unlock / sandbox) */
export function collegeUnlocked(st: CityState): boolean {
  for (const id of ['civ_college', 'civ_library']) {
    const def = getDef(id);
    if (def && (!def.requires || st.unlocked.has(def.requires) || st.config.sandbox)) return true;
  }
  return false;
}

/** Commute overlay scale: 3 x the city's average commute (minutes), at least 15 */
export function commuteScale(st: CityState): number {
  const avg = st.stats.avgCommute > 0 ? st.stats.avgCommute : 15;
  return Math.max(15, 3 * avg);
}
/** NIMBY overlay: prestige - stigma of +-NIMBY_SCALE is drawn at full intensity */
export const NIMBY_SCALE = 0.6;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** normalised value of a layer's raw value (the renderer's mapping before the ramp; diverging: -1..1) */
export function normaliseOverlay(Lr: OverlayLayer, raw: number): number {
  const s = raw / (Lr.scale || 1);
  if (Lr.palette === 'diverging') return s < -1 ? -1 : s > 1 ? 1 : s;
  if (Lr.floor !== undefined) return raw > 0 ? Lr.floor + (1 - Lr.floor) * clamp01(s) : 0;
  return clamp01(s);
}

/** normalised overlay value at a cell (0..1; diverging overlays return -1..1), 0 when out of bounds / no layer */
export function overlayValue(st: CityState, o: Overlay, x: number, z: number, variant = -1): number {
  if (!st.inBounds(x, z)) return 0;
  const Lr = overlayLayer(st, o, variant);
  if (!Lr) return 0;
  const i = z * st.size + x;
  if (Lr.maskNet && (st.network[i] !== Network.None || st.water[i])) return 0;
  return normaliseOverlay(Lr, Lr.data[i]);
}

// ================================================================================================ hover readout
export interface OverlayReadout {
  /** value text ("+34", "18%", "Auto-dispatch · 2.1 min to spare") */
  text: string;
  /** 'good' | 'warn' | 'bad' | '' (neutral) */
  tone: 'good' | 'warn' | 'bad' | '';
  /** optional second line ("of 240 residents") */
  sub?: string;
}

const pctS = (v: number) => `${Math.round(v * 100)}%`;
const toneGood = (g: number): OverlayReadout['tone'] => (g >= 0.66 ? 'good' : g >= 0.33 ? 'warn' : 'bad');
const RESPONDER_NOUN = ['fire station', 'police station', 'clinic or hospital'];

/** player-facing readout of an overlay at a cell (the value the renderer draws there), null = nothing to say */
export function overlayReadout(st: CityState, o: Overlay, x: number, z: number, variant = -1): OverlayReadout | null {
  if (!st.inBounds(x, z)) return null;
  const Lr = overlayLayer(st, o, variant);
  if (!Lr) return null;
  const i = z * st.size + x, v = Lr.variant;
  const raw = Lr.data[i];
  switch (o) {
    case Overlay.Emergency: {
      const r = emergencyReachAt(st, i, v);
      if (!r) return { text: 'Not computed yet', tone: '' };
      if (r.why === 'noStation') return { text: `No ${RESPONDER_NOUN[v]}`, tone: 'bad', sub: 'Build one: nothing is sent automatically' };
      // rail and water hold no lots (nothing there calls for help): they show the nearest road's reach
      const net = st.network[i];
      const noLots = st.building[i] >= 0 ? '' : net === Network.Rail ? 'Rail' : st.water[i] && net === Network.None ? 'Water' : '';
      if (r.why === 'noRoad') {
        return st.building[i] >= 0
          ? { text: 'Unreachable — no road beside it', tone: 'bad', sub: 'Trucks drive on roads: build a road next to it' }
          : { text: 'No road nearby', tone: 'bad', sub: noLots ? `${noLots}: no lots here` : 'Empty land: lots here need a road first' };
      }
      const s = r.slack;
      if (noLots) {
        const sub = `${noLots}: no lots here — the nearest road's reach`;
        if (s >= 0) return { text: `Auto-dispatch · ${s.toFixed(1)} min to spare`, tone: 'good', sub };
        if (r.why === 'far') return { text: `Out of reach by ${EMERG_SLOW_MARGIN}+ min`, tone: 'bad', sub };
        return s >= -EMG_NEAR ? { text: `Just out of reach by ${(-s).toFixed(1)} min`, tone: 'warn', sub } : { text: `Out of reach by ${(-s).toFixed(1)} min`, tone: 'bad', sub };
      }
      // empty land beside no road: the drawn value is the nearest road / lot's reach (EMG_DILATE), say so
      const empty = r.why === 'land';
      const land = empty ? 'Empty land — a lot here: ' : '';
      if (s >= 0) return { text: `Auto-dispatch · ${s.toFixed(1)} min to spare`, tone: 'good', sub: `${land}${empty ? 'incidents' : 'Incidents'} here become statistics` };
      if (r.why === 'far') return { text: `Out of reach by ${EMERG_SLOW_MARGIN}+ min`, tone: 'bad', sub: 'Major emergencies here wait for you to dispatch — build a station closer' };
      if (s >= -EMG_NEAR) return { text: `Just out of reach by ${(-s).toFixed(1)} min`, tone: 'warn', sub: `${land}${empty ? 'major' : 'Major'} emergencies wait for your dispatch; minor ones get a slower unit` };
      return { text: `Out of reach by ${(-s).toFixed(1)} min`, tone: 'bad', sub: `${land}${empty ? 'you' : 'You'} dispatch — build a station closer` };
    }
    case Overlay.Demographics: {
      const bid = st.building[i];
      const b = bid >= 0 ? st.buildings.get(bid) : undefined;
      if (!b || !isHome(st, b)) return { text: 'No residents', tone: '' };
      if (v === DEMO_WEALTH) return { text: `${'$'.repeat(Math.max(1, Math.min(3, b.wealth)))} homes`, tone: '', sub: `${b.pop.toLocaleString('en-US')} residents` };
      const { share, ref } = demoShare(b, v);
      const rel = share / ref;
      return { text: pctS(share), tone: rel > 1.3 ? 'good' : rel < 0.7 ? 'warn' : '', sub: `of ${b.pop.toLocaleString('en-US')} residents · city typical ${pctS(ref)}` };
    }
    case Overlay.Water: {
      if (v === 1) {
        if (raw <= 0) return { text: 'No water service', tone: 'bad' };
        const q = (raw - TAP_T0) / (1 - TAP_T0);
        return { text: `${pctS(q)} ${q >= TAP_SAFE ? '· safe' : '· unsafe'}`, tone: q >= 0.85 ? 'good' : q >= TAP_SAFE ? 'warn' : 'bad', sub: q >= TAP_SAFE ? undefined : 'Treat the water or move the pumps upstream of pollution' };
      }
      return raw > 0.5 ? { text: 'Water service', tone: 'good' } : { text: 'No water', tone: 'bad' };
    }
    case Overlay.Power: return raw > 0.5 ? { text: 'Powered', tone: 'good' } : { text: 'No power', tone: 'bad' };
    case Overlay.Commute:
      return raw > 0 ? { text: `${Math.round(raw)} min`, tone: raw <= 20 ? 'good' : raw <= 40 ? 'warn' : 'bad', sub: 'to jobs' } : { text: 'No route', tone: '' };
    case Overlay.Traffic:
      if (v === 1) {
        // (the raster is sqrt(volume / scale): read the volume itself)
        const T = truckVolumeOf(st);
        const n = T && T.length === st.cells ? T[i] : 0;
        if (n < 0.5) return { text: 'No trucks', tone: '' };
        return { text: `${Math.round(n).toLocaleString('en-US')} trucks/day`, tone: raw > 0.77 ? 'bad' : raw > 0.5 ? 'warn' : '', sub: `${pctS(raw * raw)} of a busy freight route` };
      }
      return { text: pctS(raw), tone: raw > 1 ? 'bad' : raw > 0.7 ? 'warn' : 'good', sub: `${Math.round(st.traffic[i]).toLocaleString('en-US')} trips/day` };
    case Overlay.Nimby: {
      const p = st.prestige[i], s = st.stigma[i];
      if (Math.abs(raw) < 0.02) return { text: 'Neutral', tone: '' };
      return raw > 0 ? { text: `Prestige +${Math.round(raw * 100)}`, tone: 'good', sub: s > 0.02 ? `stigma −${Math.round(s * 100)} offsets it` : undefined }
        : { text: `Stigma −${Math.round(-raw * 100)}`, tone: 'bad', sub: p > 0.02 ? `prestige +${Math.round(p * 100)} offsets it` : 'Unwanted neighbours nearby' };
    }
    case Overlay.Desirability: {
      if (v >= DEV_TYPE_COUNT) return { text: pctS(raw), tone: toneGood(raw) };
      if (st.network[i] !== Network.None || st.water[i]) return { text: '—', tone: '', sub: st.water[i] ? 'Water: no lots here' : 'Road: no lots here' };
      return { text: `${raw > 0 ? '+' : ''}${Math.round(raw * 100)}`, tone: raw > 0.15 ? 'good' : raw < -0.15 ? 'bad' : 'warn' };
    }
    case Overlay.Garbage:
      if (v === 1) return st.zone[i] === Zone.Landfill ? { text: `${pctS(raw)} full`, tone: raw > 0.8 ? 'bad' : raw > 0.5 ? 'warn' : 'good' } : { text: 'Not a landfill', tone: '' };
      return { text: pctS(raw), tone: raw > 0.5 ? 'bad' : raw > 0.2 ? 'warn' : 'good' };
    case Overlay.Tourism:
      if (raw < 0.02) return { text: 'No tourists', tone: '' };
      return { text: raw >= 0.5 ? 'Crowded' : raw >= 0.15 ? 'Busy' : 'Few visitors', tone: raw >= 0.15 ? 'good' : '', sub: `visitor intensity ${pctS(raw)} · landmarks, parks, beaches and hotels draw them` };
    case Overlay.AirPollution: case Overlay.WaterPollution: case Overlay.Crime: case Overlay.Noise: case Overlay.Soil: case Overlay.Parking:
      return { text: pctS(raw), tone: raw > 0.6 ? 'bad' : raw > 0.3 ? 'warn' : 'good' };
    default: {
      const n = normaliseOverlay(Lr, raw);
      return { text: pctS(n), tone: Lr.palette === 'bad' ? toneGood(1 - n) : toneGood(n) };
    }
  }
}
