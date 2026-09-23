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
import { CityState, type Building } from '../sim/CityState';
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
const KNOWN_BUILDING_KEYS = new Set<string>(['def', ...BUILDING_FIELDS.map((f) => f[0])]);

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
    k++;
  }
  return out;
}

export function deserializeBuildings(sb: SerializedBuildings, copyExtra = true): Map<number, Building> {
  const map = new Map<number, Building>();
  const cols = sb as unknown as Record<string, ArrayLike<number>>;
  const list: Record<string, unknown>[] = [];
  for (let k = 0; k < sb.count; k++) {
    const b = { def: sb.defs[sb.def[k]] } as Record<string, unknown>;
    for (const [name] of BUILDING_FIELDS) b[name] = cols[name] ? cols[name][k] : 0;
    list.push(b);
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

  st.buildings = deserializeBuildings(obj.buildings);
  // guard: rebuild the cell -> building index if it is missing / inconsistent
  if (!obj.layers?.building) rebuildBuildingIndex(st);
  let maxId = 0;
  for (const id of st.buildings.keys()) if (id > maxId) maxId = id;
  if (!(st.nextBuildingId > maxId)) st.nextBuildingId = maxId + 1;
  return st;
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
  return n;
}
