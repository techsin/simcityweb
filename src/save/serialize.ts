/**
 * City (de)serialization — pure functions, headless-safe (used by IndexedDB saves, export files and tests).
 *
 * serializeCity(state) -> SerializedCity: a structured-clone friendly object
 *   - every typed-array layer of CityState as-is (heights, water, trees, zone, network, ..., derived layers,
 *     desirability[] ...) — discovered generically, so layers added later by other systems are saved too
 *   - buildings Map -> struct-of-arrays typed arrays + a def string table (+ generic `extra` for unknown fields)
 *   - Sets -> arrays, other Maps -> entry arrays
 *   - everything else (config, budget, stats, history, news, milestones, neighborConnections, systemData, day,
 *     funds, nextBuildingId, ...) copied as plain data
 * deserializeCity(obj) -> CityState, fully restored including derived layers (first frame renders correctly).
 *
 * Versioned: SerializedCity.version; older saves are upgraded by registered migrations (registerCityMigration).
 */
import { CityState, HISTORY_KEYS, defaultStats, type Building, type CityStats, type HistorySeries } from '../sim/CityState';
import type { CityConfigData } from '../sim/config';

export const CITY_SAVE_FORMAT = 'metropolis-city';
export const CITY_SAVE_VERSION = 1;

export type AnyTypedArray =
  | Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;

export interface SerializedBuildings {
  count: number;
  /** def id string table */
  defs: string[];
  id: Int32Array;
  def: Uint32Array;
  x: Int32Array;
  z: Int32Array;
  w: Uint16Array;
  d: Uint16Array;
  rot: Uint8Array;
  variant: Int32Array;
  pop: Float64Array;
  jobs: Float64Array;
  capacity: Float64Array;
  wealth: Float64Array;
  built: Float64Array;
  age: Float64Array;
  flags: Uint32Array;
  baseY: Float64Array;
  health: Float64Array;
  unhappy: Float64Array;
  /** fields not covered above (added by other systems): field -> [buildingIndex, value] pairs */
  extra: Record<string, [number, unknown][]>;
  /** OPTIONAL_BUILDING_FIELDS columns present in this save (NaN = undefined) */
  opt?: Record<string, Float32Array>;
}

export interface SerializedCity {
  format: typeof CITY_SAVE_FORMAT;
  version: number;
  savedAt: number;
  size: number;
  config: CityConfigData;
  /** primitive own fields (day, funds, nextBuildingId, ...) */
  scalars: Record<string, number | string | boolean | null>;
  /** typed-array layers; arrays of typed arrays (e.g. desirability[dev]) are kept as arrays */
  layers: Record<string, AnyTypedArray | AnyTypedArray[]>;
  buildings: SerializedBuildings;
  /** Set fields (unlocked, announced, ...) */
  sets: Record<string, unknown[]>;
  /** other Map fields */
  maps: Record<string, [unknown, unknown][]>;
  /** remaining plain data (budget, stats, history, news, milestones, neighborConnections, systemData, ...) */
  data: Record<string, unknown>;
}

const SKIP = new Set(['size', 'cells', 'config', 'buildings']);

/**
 * Derived per-cell layers that are NOT saved (neither written nor restored; a loaded city starts with zeros). Their
 * owner system must recompute them synchronously in init() so the first frame / day after a load is correct.
 * Stocks (soil, landfillFill) are state and stay persisted. Keeps a 256² save within ~1 MB of its pre-spec size.
 */
export const DERIVED_LAYERS: ReadonlySet<string> = new Set([
  'eduElemCov', 'eduHighCov', 'eduCollegeCov', 'playCov', 'greenCov', 'shopAccess', 'stigma', 'prestige', 'campus',
  'accessCommute', 'treeCover', 'visitors', 'respFire', 'respPolice', 'respMedical', 'parking',
]);

type NumCtor = { new (n: number): AnyTypedArray };
const BUILDING_FIELDS: [keyof Building & string, NumCtor][] = [
  ['id', Int32Array],
  ['x', Int32Array],
  ['z', Int32Array],
  ['w', Uint16Array],
  ['d', Uint16Array],
  ['rot', Uint8Array],
  ['variant', Int32Array],
  ['pop', Float64Array],
  ['jobs', Float64Array],
  ['capacity', Float64Array],
  ['wealth', Float64Array],
  ['built', Float64Array],
  ['age', Float64Array],
  ['flags', Uint32Array],
  ['baseY', Float64Array],
  ['health', Float64Array],
  ['unhappy', Float64Array],
];
/**
 * Optional numeric building fields (undefined = "derive"): saved as Float32 columns with NaN for undefined, and only
 * when at least one building defines the field. Restored values are Float32 — writers should store Math.fround(v).
 */
export const OPTIONAL_BUILDING_FIELDS: readonly (keyof Building & string)[] = ['kids', 'teens', 'yad', 'srs', 'wf', 'edu', 'hire'];
const KNOWN_BUILDING_KEYS = new Set<string>(['def', ...BUILDING_FIELDS.map((f) => f[0]), ...OPTIONAL_BUILDING_FIELDS]);

export function isTypedArray(v: unknown): v is AnyTypedArray {
  return ArrayBuffer.isView(v) && !(v instanceof DataView);
}

function cloneTA<T extends AnyTypedArray>(a: T): T {
  return a.slice() as T;
}

/** deep copy of plain data (structured clone when available, JSON-free) */
function deepCopy<T>(v: T): T {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return v;
}

export interface SerializeOptions {
  /** copy typed arrays / data (snapshot independent of the live state). Default false: IndexedDB clones on put. */
  copy?: boolean;
}

export function serializeBuildings(map: Map<number, Building>): SerializedBuildings {
  const n = map.size;
  const defs: string[] = [];
  const defIdx = new Map<string, number>();
  const out = { count: n, defs, def: new Uint32Array(n), extra: {} as Record<string, [number, unknown][]> } as SerializedBuildings;
  const cols = out as unknown as Record<string, AnyTypedArray>;
  for (const [name, C] of BUILDING_FIELDS) cols[name] = new C(n);
  let k = 0;
  for (const b of map.values()) {
    let di = defIdx.get(b.def);
    if (di === undefined) {
      di = defs.length;
      defs.push(b.def);
      defIdx.set(b.def, di);
    }
    out.def[k] = di;
    const rec = b as unknown as Record<string, unknown>;
    for (const [name] of BUILDING_FIELDS) cols[name][k] = Number(rec[name] ?? 0);
    for (const key of Object.keys(rec)) {
      if (KNOWN_BUILDING_KEYS.has(key)) continue;
      const v = rec[key];
      if (v === undefined) continue;
      (out.extra[key] ??= []).push([k, v]);
    }
    for (const name of OPTIONAL_BUILDING_FIELDS) {
      const v = rec[name];
      if (v === undefined || v === null) continue;
      let col = out.opt?.[name];
      if (!col) {
        col = new Float32Array(n).fill(NaN);
        (out.opt ??= {})[name] = col;
      }
      col[k] = Number(v);
    }
    k++;
  }
  return out;
}

/**
 * A restored building: every BUILDING_FIELDS column as a named property of one object literal, in the key order of the
 * growth / plop literals. V8 then keeps fast properties and the hidden class of new buildings; an object built from
 * `{ def }` by ~18 keyed stores falls into dictionary mode, and every property access of every system on every loaded
 * building becomes a hash lookup (measured on a loaded 128² bot city: the whole simulated day ~2.7x slower, the
 * population system ~3-4x).
 */
function restoredBuilding(cols: Record<string, ArrayLike<number> | undefined>, k: number, def: string): Record<string, unknown> {
  const v = (name: string): number => { const c = cols[name]; return c ? c[k] : 0; };
  return {
    id: v('id'), def, x: v('x'), z: v('z'), w: v('w'), d: v('d'), rot: v('rot'), variant: v('variant'), pop: v('pop'),
    jobs: v('jobs'), capacity: v('capacity'), wealth: v('wealth'), built: v('built'), age: v('age'), flags: v('flags'),
    baseY: v('baseY'), health: v('health'), unhappy: v('unhappy'),
  };
}

export function deserializeBuildings(sb: SerializedBuildings, copyExtra = true): Map<number, Building> {
  const map = new Map<number, Building>();
  const cols = sb as unknown as Record<string, ArrayLike<number>>;
  const list: Record<string, unknown>[] = [];
  for (let k = 0; k < sb.count; k++) {
    const b = restoredBuilding(cols, k, sb.defs[sb.def[k]]);
    for (const [name] of BUILDING_FIELDS) if (!(name in b)) b[name] = cols[name] ? cols[name][k] : 0; // (a column added later)
    list.push(b);
  }
  // optional fields: a building with any of them set gets all of them (undefined where unset) as named stores in
  // OPTIONAL_BUILDING_FIELDS order — the order the population system gives every building, so homes, businesses and
  // new buildings share one hidden class; a building with none set gets none. Then any unknown optional column.
  const opt = sb.opt ?? {};
  const cK = opt.kids, cT = opt.teens, cY = opt.yad, cS = opt.srs, cW = opt.wf, cE = opt.edu, cH = opt.hire;
  const val = (c: Float32Array | undefined, k: number): number | undefined => {
    const v = c && k < c.length ? c[k] : NaN;
    return Number.isNaN(v) ? undefined : v;
  };
  for (let k = 0; k < list.length; k++) {
    const kids = val(cK, k), teens = val(cT, k), yad = val(cY, k), srs = val(cS, k), wf = val(cW, k), edu = val(cE, k), hire = val(cH, k);
    if (kids === undefined && teens === undefined && yad === undefined && srs === undefined && wf === undefined
      && edu === undefined && hire === undefined) continue;
    const b = list[k] as Partial<Building>;
    b.kids = kids; b.teens = teens; b.yad = yad; b.srs = srs; b.wf = wf; b.edu = edu; b.hire = hire;
  }
  for (const [key, col] of Object.entries(opt)) {
    if ((OPTIONAL_BUILDING_FIELDS as readonly string[]).includes(key)) continue;
    for (let k = 0; k < list.length && k < col.length; k++) { const v = col[k]; if (!Number.isNaN(v)) list[k][key] = v; }
  }
  for (const [key, pairs] of Object.entries(sb.extra ?? {})) {
    for (const [k, v] of pairs) if (list[k]) list[k][key] = copyExtra ? deepCopy(v) : v;
  }
  for (const b of list) map.set(b.id as number, b as unknown as Building);
  return map;
}

export function serializeCity(state: CityState, opts: SerializeOptions = {}): SerializedCity {
  const copy = !!opts.copy;
  const out: SerializedCity = {
    format: CITY_SAVE_FORMAT,
    version: CITY_SAVE_VERSION,
    savedAt: Date.now(),
    size: state.size,
    config: { ...state.config },
    scalars: {},
    layers: {},
    buildings: serializeBuildings(state.buildings),
    sets: {},
    maps: {},
    data: {},
  };
  const rec = state as unknown as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (SKIP.has(key)) continue;
    const v = rec[key];
    if (typeof v === 'function' || v === undefined) continue;
    if (DERIVED_LAYERS.has(key)) continue;
    if (isTypedArray(v)) out.layers[key] = copy ? cloneTA(v) : v;
    else if (Array.isArray(v) && v.length > 0 && v.every(isTypedArray)) out.layers[key] = copy ? (v as AnyTypedArray[]).map(cloneTA) : (v as AnyTypedArray[]).slice();
    else if (v instanceof Set) out.sets[key] = [...v];
    else if (v instanceof Map) out.maps[key] = [...v.entries()];
    else if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out.scalars[key] = v;
    else out.data[key] = copy ? deepCopy(v) : v;
  }
  return out;
}

export class SaveFormatError extends Error {}

export type CityMigration = (obj: SerializedCity) => SerializedCity;
const migrations = new Map<number, CityMigration>();

/** register a migration from `fromVersion` to fromVersion+1 */
export function registerCityMigration(fromVersion: number, fn: CityMigration): void {
  migrations.set(fromVersion, fn);
}

export function migrateCity(obj: SerializedCity): SerializedCity {
  if (!obj || obj.format !== CITY_SAVE_FORMAT) throw new SaveFormatError('Not a Metropolis city save');
  let cur = obj;
  while (cur.version < CITY_SAVE_VERSION) {
    const m = migrations.get(cur.version);
    if (!m) throw new SaveFormatError(`No migration from city save version ${cur.version}`);
    const from = cur.version;
    cur = m(cur);
    if (cur.version <= from) cur.version = from + 1;
  }
  if (cur.version > CITY_SAVE_VERSION) throw new SaveFormatError(`City save version ${cur.version} is newer than this game (${CITY_SAVE_VERSION})`);
  return cur;
}

/**
 * Restore a CityState. Typed arrays are copied into the fresh state's arrays (the input object is not aliased),
 * so the same SerializedCity can be deserialized repeatedly.
 */
export function deserializeCity(input: SerializedCity): CityState {
  const obj = migrateCity(input);
  const cfg: CityConfigData = { ...obj.config, size: obj.size ?? obj.config.size };
  const st = new CityState(cfg);
  const rec = st as unknown as Record<string, unknown>;

  for (const [key, v] of Object.entries(obj.layers ?? {})) {
    if (DERIVED_LAYERS.has(key)) continue;
    const cur = rec[key];
    if (Array.isArray(v)) {
      const arr = Array.isArray(cur) ? (cur as AnyTypedArray[]) : [];
      const res = v.map((src, k) => {
        const dst = arr[k];
        if (dst && dst.constructor === src.constructor && dst.length === src.length) {
          dst.set(src as never);
          return dst;
        }
        return cloneTA(src);
      });
      rec[key] = res;
    } else if (isTypedArray(cur) && cur.constructor === v.constructor && cur.length === v.length) {
      cur.set(v as never);
    } else if (isTypedArray(cur) && cur.length === v.length) {
      for (let i = 0; i < v.length; i++) cur[i] = v[i];
    } else {
      rec[key] = cloneTA(v);
    }
  }
  for (const [key, v] of Object.entries(obj.scalars ?? {})) rec[key] = v;
  for (const [key, v] of Object.entries(obj.sets ?? {})) rec[key] = new Set(deepCopy(v));
  for (const [key, v] of Object.entries(obj.maps ?? {})) rec[key] = new Map(deepCopy(v));
  for (const [key, v] of Object.entries(obj.data ?? {})) rec[key] = deepCopy(v);
  upgradeStatsAndHistory(st);

  st.buildings = deserializeBuildings(obj.buildings);
  // guard: rebuild the cell -> building index if it is missing / inconsistent
  if (!obj.layers?.building) rebuildBuildingIndex(st);
  let maxId = 0;
  for (const id of st.buildings.keys()) if (id > maxId) maxId = id;
  if (!(st.nextBuildingId > maxId)) st.nextBuildingId = maxId + 1;
  return st;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v) && Object.getPrototypeOf(v) === Object.prototype;

/** fill keys missing in `target` from `defaults`, recursing into nested plain objects (saved values always win) */
function fillDefaults(target: Record<string, unknown>, defaults: Record<string, unknown>): void {
  for (const k of Object.keys(defaults)) {
    const t = target[k], d = defaults[k];
    if (t === undefined) target[k] = d;
    else if (isPlainObject(t) && isPlainObject(d)) fillDefaults(t, d);
  }
}

/**
 * Older saves: stats fields added later get their defaults (deep fill of missing keys; saved values win), and history
 * series added later are created and zero-padded to h.t.length (existing series are left untouched).
 */
export function upgradeStatsAndHistory(st: CityState): void {
  const saved = (isPlainObject(st.stats) ? st.stats : {}) as unknown as Record<string, unknown>;
  fillDefaults(saved, defaultStats() as unknown as Record<string, unknown>);
  st.stats = saved as unknown as CityStats;
  const h = (st.history ?? {}) as Partial<Record<keyof HistorySeries, number[]>>;
  const n = Array.isArray(h.t) ? h.t.length : 0;
  for (const k of HISTORY_KEYS) if (!Array.isArray(h[k])) h[k] = new Array(n).fill(0);
  st.history = h as HistorySeries;
}

export function rebuildBuildingIndex(st: CityState): void {
  st.building.fill(-1);
  for (const b of st.buildings.values()) {
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if (st.inBounds(x, z)) st.building[st.idx(x, z)] = b.id;
  }
}

/** rough in-memory size of a serialized city (bytes) — for UI display */
export function estimateSize(obj: SerializedCity): number {
  let n = 0;
  for (const v of Object.values(obj.layers)) {
    if (Array.isArray(v)) for (const a of v) n += a.byteLength;
    else n += v.byteLength;
  }
  for (const v of Object.values(obj.buildings)) if (isTypedArray(v)) n += v.byteLength;
  for (const v of Object.values(obj.buildings.opt ?? {})) n += v.byteLength;
  return n;
}
