/**
 * Emergency "unsaved progress" snapshots (used by main.ts on beforeunload / pagehide / tab hide, and periodically
 * while a city has unsaved changes).
 *
 * Why not just save on beforeunload: an IndexedDB write started while the page unloads is aborted when the document
 * is torn down unless the backend has already committed it — a multi-MB city put usually has not (measured in
 * Chromium: 0-4 of 4 survived a reload / tab close). A synchronous localStorage write, and a SMALL IndexedDB write
 * with an explicit commit(), do survive (48/48). So the snapshot is kept small: a DELTA against the last full save of
 * the city (every typed array XOR'ed with the base and zero-run-length coded, so unchanged data costs ~nothing) plus
 * the plain data. It is written synchronously to localStorage (when it fits) and, best effort, to IndexedDB.
 *
 * The base is the SerializedCity of the last completed full save / load of the city (kept in memory: saveCity and
 * loadCity call setRecoveryBase). On the next start findRecoverySnapshot() validates a snapshot against the stored
 * full save (same base, older than the snapshot) and restoreRecoverySnapshot() rebuilds the city and makes it the save.
 *
 * Pure codec (encodeCityDelta / applyCityDelta / packBytes / unpackBytes) is headless and unit-tested.
 */
import { CITY_SAVE_FORMAT, deserializeCity, isTypedArray, serializeCity, type AnyTypedArray, type SerializedBuildings, type SerializedCity } from './serialize';
import { decodeBundle, encodeBundle } from './bundle';
import { openedKV, openKV } from './db';
import { MONTH_NAMES, type CityState } from '../sim/CityState';
import type { CityRecord } from './index';

export const DELTA_KIND = 'metropolis-city-delta';
export const DELTA_VERSION = 1;
const LS_MARKER = 'metropolis.recovery';
const LS_DATA = 'metropolis.recovery.data';
const IDB_KEY = 'current';
/** max payload kept in localStorage (packed 15 bits / char → ~1.15 M chars ≈ 2.3 MB of UTF-16, well inside every browser's quota) */
export const LS_BUDGET_BYTES = 2_150_000;

/**
 * Layers the simulation recomputes from the primary data (traffic, pollution, coverage, land value, desirability,
 * utilities). When a snapshot would not fit the localStorage budget these are left out (largest first) and restored
 * from the base save — an earlier, consistent value that the next monthly pass overwrites.
 */
export const RECOMPUTED_LAYERS: readonly string[] = [
  'desirability', 'traffic', 'congestion', 'commute', 'airPollution', 'waterPollution', 'noise', 'crime', 'landValue',
  'policeCov', 'fireCov', 'healthCov', 'eduCov', 'parkCov', 'transitCov', 'powered', 'watered',
];

// ============================================================================================ byte codec
class ByteWriter {
  buf = new Uint8Array(1 << 12);
  len = 0;
  ensure(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const b = new Uint8Array(cap);
    b.set(this.buf.subarray(0, this.len));
    this.buf = b;
  }
  varint(v: number): void {
    this.ensure(10);
    while (v >= 0x80) {
      this.buf[this.len++] = (v & 0x7f) | 0x80;
      v = Math.floor(v / 128);
    }
    this.buf[this.len++] = v;
  }
  /** a[from..to) XOR b (b only below `covered`) */
  xorBytes(a: Uint8Array, b: Uint8Array | null, from: number, to: number, covered: number): void {
    this.ensure(to - from);
    const o = this.buf, at = this.len - from;
    const mid = b ? Math.max(from, Math.min(to, covered)) : from;
    for (let i = from; i < mid; i++) o[at + i] = a[i] ^ b![i];
    if (to > mid) o.set(a.subarray(mid, to), at + mid);
    this.len += to - from;
  }
  out(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

function readVarint(src: Uint8Array, p: { i: number }): number {
  let v = 0, mul = 1, b: number;
  do {
    if (p.i >= src.length) throw new Error('recovery: truncated delta');
    b = src[p.i++];
    v += (b & 0x7f) * mul;
    mul *= 128;
  } while (b & 0x80);
  return v;
}

const bytesOf = (a: AnyTypedArray): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** sampled FNV-1a of a byte view (length + every 61st byte + the last 64) — detects a wrong base cheaply */
function sampleHash(b: Uint8Array): number {
  let h = 0x811c9dc5 ^ b.length;
  const step = 61;
  for (let i = 0; i < b.length; i += step) h = Math.imul(h ^ b[i], 16777619);
  for (let i = Math.max(0, b.length - 64); i < b.length; i++) h = Math.imul(h ^ b[i], 16777619);
  return h >>> 0;
}

/**
 * XOR `cur` with `base` (over their common prefix; bytes past the base are XOR'ed with 0) and run-length code the
 * zero runs. Units are 32-bit words when both views are 4-byte aligned, else bytes. Stream: repeated
 * (varint unchangedUnits, varint literalUnits, literal XOR bytes) until all units are covered, then the tail bytes.
 * The decoder starts from a copy of the base prefix and XORs the literals in.
 */
function encodeXor(cur: Uint8Array, base: Uint8Array | null): { u: 1 | 4; x: Uint8Array } {
  const n = cur.length;
  const u: 1 | 4 = cur.byteOffset % 4 === 0 && (!base || base.byteOffset % 4 === 0) ? 4 : 1;
  const units = Math.floor(n / u);
  const covered = base ? Math.min(base.length, n) : 0; // bytes the decoder pre-fills from the base
  const mFull = Math.floor(covered / u); // units entirely inside the base prefix: compare with the base
  const mZero = Math.ceil(covered / u); // units entirely past it: compare with 0 (a straddling unit is always literal)
  const c = u === 4 ? new Uint32Array(cur.buffer, cur.byteOffset, units) : cur;
  const b = base ? (u === 4 ? new Uint32Array(base.buffer, base.byteOffset, Math.floor(base.length / 4)) : base) : null;
  // unit i is unchanged when it equals the base (i < mFull) or 0 (i >= mZero); a straddling unit is always literal
  const bb = b ?? c;
  /** first unit >= i that changed (or `units`) */
  const nextChanged = (i: number): number => {
    while (i < mFull && c[i] === bb[i]) i++;
    if (i < mFull || i < mZero) return i;
    while (i < units && c[i] === 0) i++;
    return i;
  };
  /** first unit >= i that is unchanged (or `units`) */
  const nextSame = (i: number): number => {
    while (i < mFull && c[i] !== bb[i]) i++;
    if (i < mFull) return i;
    if (i < mZero) i = mZero;
    while (i < units && c[i] !== 0) i++;
    return i;
  };
  const w = new ByteWriter();
  let i = 0;
  while (i < units) {
    const z0 = i;
    i = nextChanged(i);
    const l0 = i;
    // literal: runs to the next stretch of >= 3 unchanged units (or the end); shorter stretches stay inline
    while (i < units) {
      i = nextSame(i);
      if (i >= units) break;
      const j = nextChanged(i);
      if (j - i >= 3 || j >= units) break;
      i = j;
    }
    w.varint(l0 - z0);
    w.varint(i - l0);
    if (i > l0) w.xorBytes(cur, base, l0 * u, i * u, covered);
  }
  if (n > units * u) w.xorBytes(cur, base, units * u, n, covered);
  return { u, x: w.out() };
}

function decodeXor(out: Uint8Array, x: Uint8Array, u: 1 | 4): void {
  const n = out.length;
  const units = Math.floor(n / u);
  const p = { i: 0 };
  let pos = 0; // in units
  while (pos < units) {
    pos += readVarint(x, p);
    const lit = readVarint(x, p);
    if (pos + lit > units) throw new Error('recovery: corrupt delta');
    const from = pos * u, len = lit * u;
    if (p.i + len > x.length) throw new Error('recovery: truncated delta');
    for (let k = 0; k < len; k++) out[from + k] ^= x[p.i + k];
    p.i += len;
    pos += lit;
  }
  const tail = n - units * u;
  for (let k = 0; k < tail; k++) out[units * u + k] ^= x[p.i + k];
}

// ============================================================================================ city delta
const CTORS: Record<string, new (n: number) => AnyTypedArray> = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
};

export interface ArrayDelta {
  /** typed array constructor name */
  t: string;
  /** element count */
  n: number;
  /** base byte length the XOR used (-1 = none) */
  bb: number;
  u: 1 | 4;
  x: Uint8Array;
  /** sampled hash of the result bytes */
  h: number;
}

export interface CityDelta {
  kind: typeof DELTA_KIND;
  v: number;
  /** savedAt of the full save this is a delta of (0 = none: every array is XOR'ed with zeros) */
  baseSavedAt: number;
  head: Pick<SerializedCity, 'format' | 'version' | 'savedAt' | 'size' | 'config'>;
  scalars: SerializedCity['scalars'];
  sets: SerializedCity['sets'];
  maps: SerializedCity['maps'];
  data: SerializedCity['data'];
  layers: Record<string, ArrayDelta | ArrayDelta[]>;
  /** layers left out for size: taken from the base on restore */
  dropped: string[];
  buildings: { count: number; defs: string[]; extra: SerializedBuildings['extra']; cols: Record<string, ArrayDelta>; opt?: Record<string, ArrayDelta> };
}

function arrayDelta(cur: AnyTypedArray, base: AnyTypedArray | undefined | null): ArrayDelta {
  const cb = bytesOf(cur);
  const bb = base && base.constructor === cur.constructor ? bytesOf(base) : null;
  const { u, x } = encodeXor(cb, bb);
  return { t: cur.constructor.name, n: cur.length, bb: bb ? bb.length : -1, u, x, h: sampleHash(cb) };
}

function applyArrayDelta(d: ArrayDelta, base: AnyTypedArray | undefined | null, what: string): AnyTypedArray {
  const C = CTORS[d.t];
  if (!C) throw new Error(`recovery: unknown array type ${d.t} (${what})`);
  const out = new C(d.n);
  const ob = bytesOf(out);
  if (d.bb >= 0) {
    if (!base || base.constructor !== C || base.byteLength !== d.bb) throw new Error(`recovery: base mismatch (${what})`);
    const bb = bytesOf(base);
    ob.set(bb.subarray(0, Math.min(bb.length, ob.length)));
  }
  decodeXor(ob, d.x, d.u);
  if (sampleHash(ob) !== d.h) throw new Error(`recovery: checksum mismatch (${what})`);
  return out;
}

const deltaBytes = (d: ArrayDelta | ArrayDelta[]): number => (Array.isArray(d) ? d.reduce((a, x) => a + x.x.length, 0) : d.x.length);

/**
 * Delta of `cur` against `base` (null = no base). With `budget` (bytes), recomputed layers are dropped largest-first
 * until the typed-array payload fits (primary data is never dropped).
 */
export function encodeCityDelta(cur: SerializedCity, base: SerializedCity | null, baseSavedAt: number, opts: { budget?: number } = {}): CityDelta {
  const layers: Record<string, ArrayDelta | ArrayDelta[]> = {};
  for (const [k, v] of Object.entries(cur.layers)) {
    const bv = base?.layers[k];
    if (Array.isArray(v)) layers[k] = v.map((a, i) => arrayDelta(a, Array.isArray(bv) ? bv[i] : null));
    else layers[k] = arrayDelta(v, bv && !Array.isArray(bv) ? bv : null);
  }
  const cols: Record<string, ArrayDelta> = {};
  const bcols = (base?.buildings ?? {}) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(cur.buildings)) {
    if (!isTypedArray(v)) continue;
    const bv = bcols[k];
    cols[k] = arrayDelta(v, isTypedArray(bv) ? bv : null);
  }
  let opt: Record<string, ArrayDelta> | undefined;
  for (const [k, v] of Object.entries(cur.buildings.opt ?? {})) (opt ??= {})[k] = arrayDelta(v, base?.buildings.opt?.[k] ?? null);
  const dropped: string[] = [];
  if (opts.budget !== undefined && base) {
    let total = Object.values(layers).reduce((a, d) => a + deltaBytes(d), 0) + Object.values(cols).reduce((a, d) => a + d.x.length, 0);
    const cands = RECOMPUTED_LAYERS.filter((k) => layers[k] && base.layers[k]).sort((a, b) => deltaBytes(layers[b]) - deltaBytes(layers[a]));
    for (const k of cands) {
      if (total <= opts.budget) break;
      const bv = base.layers[k];
      const cv = cur.layers[k];
      // only when the base layer has the same shape (it replaces the current one on restore)
      const shapeOk = Array.isArray(cv) ? Array.isArray(bv) && bv.length === cv.length && bv.every((a, i) => a.length === cv[i].length) : !Array.isArray(bv) && bv.length === (cv as AnyTypedArray).length;
      if (!shapeOk) continue;
      total -= deltaBytes(layers[k]);
      delete layers[k];
      dropped.push(k);
    }
  }
  return {
    kind: DELTA_KIND,
    v: DELTA_VERSION,
    baseSavedAt: base ? baseSavedAt : 0,
    head: { format: cur.format, version: cur.version, savedAt: cur.savedAt, size: cur.size, config: cur.config },
    scalars: cur.scalars,
    sets: cur.sets,
    maps: cur.maps,
    data: cur.data,
    layers,
    dropped,
    buildings: { count: cur.buildings.count, defs: cur.buildings.defs, extra: cur.buildings.extra, cols, opt },
  };
}

/** rebuild the SerializedCity a delta was made from (throws when `base` is not the base it was made against) */
export function applyCityDelta(d: CityDelta, base: SerializedCity | null): SerializedCity {
  if (!d || d.kind !== DELTA_KIND) throw new Error('recovery: not a city delta');
  if (d.v > DELTA_VERSION) throw new Error('recovery: snapshot from a newer version');
  if (d.baseSavedAt && !base) throw new Error('recovery: base save missing');
  const b = d.baseSavedAt ? base : null;
  const layers: SerializedCity['layers'] = {};
  for (const [k, v] of Object.entries(d.layers)) {
    const bv = b?.layers[k];
    if (Array.isArray(v)) layers[k] = v.map((x, i) => applyArrayDelta(x, Array.isArray(bv) ? bv[i] : null, `${k}[${i}]`));
    else layers[k] = applyArrayDelta(v, bv && !Array.isArray(bv) ? bv : null, k);
  }
  for (const k of d.dropped) {
    const bv = b?.layers[k];
    if (!bv) throw new Error(`recovery: base layer ${k} missing`);
    layers[k] = Array.isArray(bv) ? bv.map((a) => a.slice()) : bv.slice();
  }
  const bcols = (b?.buildings ?? {}) as unknown as Record<string, unknown>;
  const buildings = { count: d.buildings.count, defs: d.buildings.defs, extra: d.buildings.extra } as SerializedBuildings;
  const out = buildings as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(d.buildings.cols)) {
    const bv = bcols[k];
    out[k] = applyArrayDelta(v, isTypedArray(bv) ? bv : null, `buildings.${k}`);
  }
  if (d.buildings.opt) {
    buildings.opt = {};
    for (const [k, v] of Object.entries(d.buildings.opt)) buildings.opt[k] = applyArrayDelta(v, b?.buildings.opt?.[k] ?? null, `buildings.opt.${k}`) as Float32Array;
  }
  return { ...d.head, scalars: d.scalars, layers, buildings, sets: d.sets, maps: d.maps, data: d.data };
}

// ============================================================================================ string packing
/** bytes -> string of 15-bit units (chars U+1000..U+8FFF: no surrogates / controls, safe in localStorage) */
export function packBytes(b: Uint8Array): string {
  const out = new Uint16Array(Math.ceil((b.length * 8) / 15));
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < b.length; i++) {
    acc = (acc << 8) | b[i];
    bits += 8;
    if (bits >= 15) {
      bits -= 15;
      out[o++] = 0x1000 + ((acc >>> bits) & 0x7fff);
      acc &= (1 << bits) - 1;
    }
  }
  if (bits > 0) out[o++] = 0x1000 + ((acc << (15 - bits)) & 0x7fff);
  if (typeof TextDecoder !== 'undefined') {
    try {
      // one native call (the code units are plain BMP characters, so UTF-16LE decoding is the identity)
      return new TextDecoder('utf-16le').decode(out.subarray(0, o));
    } catch {
      /* no utf-16le decoder: fall through */
    }
  }
  let s = '';
  for (let i = 0; i < o; i += 8192) s += String.fromCharCode.apply(null, out.subarray(i, Math.min(o, i + 8192)) as unknown as number[]);
  return s;
}

export function unpackBytes(s: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < s.length && o < length; i++) {
    const v = s.charCodeAt(i) - 0x1000;
    if (v < 0 || v > 0x7fff) throw new Error('recovery: corrupt packed data');
    acc = (acc << 15) | v;
    bits += 15;
    while (bits >= 8 && o < length) {
      bits -= 8;
      out[o++] = (acc >>> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  if (o < length) throw new Error('recovery: truncated packed data');
  return out;
}

// ============================================================================================ base tracking
let base: { key: string; savedAt: number; city: SerializedCity } | null = null;
const keyOf = (regionId: string, tileKey: string) => `${regionId}:${tileKey}`;

/** the full save a city's snapshots are deltas of (called by saveCity / loadCity; `city` must not alias live state) */
export function setRecoveryBase(regionId: string, tileKey: string, savedAt: number, city: SerializedCity): void {
  base = { key: keyOf(regionId, tileKey), savedAt, city };
}
export function clearRecoveryBase(): void {
  base = null;
}
export function recoveryBaseSavedAt(regionId: string, tileKey: string): number {
  return base && base.key === keyOf(regionId, tileKey) ? base.savedAt : 0;
}

// ============================================================================================ snapshots
export interface RecoveryInfo {
  cityName: string;
  regionName?: string;
  /** game day of the snapshot / of the base save */
  day: number;
  baseDay?: number;
  /** game dates, e.g. "Mar 14, 2003" */
  date?: string;
  baseDate?: string;
  population: number;
  funds: number;
}

/** "Mar 14, 2003" for an absolute game day (30-day months, 360-day years) */
export function gameDateLabel(day: number, startYear: number): string {
  return `${MONTH_NAMES[Math.floor(day / 30) % 12]} ${(day % 30) + 1}, ${startYear + Math.floor(day / 360)}`;
}

export interface RecoveryMarker extends RecoveryInfo {
  v: number;
  regionId: string;
  tileKey: string;
  /** wall-clock time of the snapshot */
  at: number;
  baseSavedAt: number;
  /** payload bytes (packed into LS_DATA when `ls`) */
  bytes: number;
  ls: boolean;
  dropped: string[];
  why?: string;
}

interface IdbRecoveryRecord {
  marker: RecoveryMarker;
  payload: Uint8Array;
}

export interface WriteResult {
  ok: boolean;
  bytes: number;
  ls: boolean;
  idb: boolean;
  ms: number;
  dropped: string[];
}

/**
 * Synchronously snapshot a city (safe inside beforeunload / pagehide / visibilitychange): serialize, delta against
 * the tracked base, write localStorage (if it fits) and start an IndexedDB write with an explicit commit.
 */
export function writeRecoverySnapshot(regionId: string, tileKey: string, state: CityState, info: Omit<RecoveryInfo, 'day' | 'baseDay' | 'date' | 'baseDate'> & { why?: string }): WriteResult {
  const t0 = performance.now();
  const key = keyOf(regionId, tileKey);
  const b = base && base.key === key ? base : null;
  const cur = serializeCity(state);
  const delta = encodeCityDelta(cur, b?.city ?? null, b?.savedAt ?? 0, { budget: LS_BUDGET_BYTES });
  const payload = encodeBundle(delta);
  const baseDay = b ? Number(b.city.scalars.day ?? 0) : undefined;
  const startYear = Number(state.config.startYear ?? 2000);
  const marker: RecoveryMarker = {
    v: DELTA_VERSION,
    regionId,
    tileKey,
    at: Date.now(),
    baseSavedAt: delta.baseSavedAt,
    bytes: payload.length,
    ls: false,
    dropped: delta.dropped,
    cityName: info.cityName,
    regionName: info.regionName,
    day: Number(state.day ?? 0),
    baseDay,
    date: gameDateLabel(Number(state.day ?? 0), startYear),
    baseDate: baseDay !== undefined ? gameDateLabel(baseDay, startYear) : undefined,
    population: info.population,
    funds: info.funds,
    why: info.why,
  };
  let ls = false;
  if (payload.length <= LS_BUDGET_BYTES) {
    try {
      localStorage.setItem(LS_DATA, packBytes(payload));
      ls = true;
    } catch {
      try {
        localStorage.removeItem(LS_DATA);
      } catch {
        /* storage unavailable */
      }
    }
  } else {
    try {
      localStorage.removeItem(LS_DATA);
    } catch {
      /* storage unavailable */
    }
  }
  marker.ls = ls;
  try {
    localStorage.setItem(LS_MARKER, JSON.stringify(marker));
  } catch {
    /* storage unavailable */
  }
  let idb = false;
  const kv = openedKV();
  if (kv?.persistent) {
    try {
      const rec: IdbRecoveryRecord = { marker, payload };
      // put() issues the request + commit synchronously; the returned promise is irrelevant during unload
      kv.put('recovery', rec, IDB_KEY).catch(() => undefined);
      idb = true;
    } catch {
      /* e.g. DataCloneError */
    }
  }
  return { ok: ls || idb, bytes: payload.length, ls, idb, ms: performance.now() - t0, dropped: delta.dropped };
}

export interface PendingRecovery {
  marker: RecoveryMarker;
  payload: Uint8Array;
  /** the full save the snapshot is a delta of */
  record: CityRecord | null;
}

function readLsSnapshot(): { marker: RecoveryMarker; payload: Uint8Array | null } | null {
  try {
    const raw = localStorage.getItem(LS_MARKER);
    if (!raw) return null;
    const marker = JSON.parse(raw) as RecoveryMarker;
    if (!marker || typeof marker.at !== 'number' || !marker.regionId) return null;
    let payload: Uint8Array | null = null;
    if (marker.ls) {
      const s = localStorage.getItem(LS_DATA);
      if (s) {
        try {
          payload = unpackBytes(s, marker.bytes);
        } catch {
          payload = null;
        }
      }
    }
    return { marker, payload };
  } catch {
    return null;
  }
}

/** a quick synchronous "is there a pending snapshot?" (localStorage marker only) */
export function peekRecoveryMarker(): RecoveryMarker | null {
  return readLsSnapshot()?.marker ?? null;
}

/**
 * The pending snapshot, if it is newer than the stored full save it was made against. Stale / orphaned / mismatched
 * snapshots are discarded here.
 */
export async function findRecoverySnapshot(): Promise<PendingRecovery | null> {
  const kv = await openKV();
  if (!kv.persistent) return null;
  const fromLs = readLsSnapshot();
  let fromIdb: IdbRecoveryRecord | undefined;
  try {
    fromIdb = await kv.get<IdbRecoveryRecord>('recovery', IDB_KEY);
  } catch {
    fromIdb = undefined;
  }
  const cands: { marker: RecoveryMarker; payload: Uint8Array }[] = [];
  if (fromLs?.payload) cands.push({ marker: fromLs.marker, payload: fromLs.payload });
  if (fromIdb?.marker && fromIdb.payload) cands.push(fromIdb);
  if (!cands.length) {
    if (fromLs) await discardRecoverySnapshot();
    return null;
  }
  cands.sort((a, b) => b.marker.at - a.marker.at);
  const snap = cands[0];
  const m = snap.marker;
  const record = (await kv.get<CityRecord>('cities', keyOf(m.regionId, m.tileKey))) ?? null;
  const region = await kv.get<{ id: string; name: string }>('regions', m.regionId);
  // valid only if the stored full save is the snapshot's base (or, without a base, older than the snapshot)
  let stale = !region || (!!record && record.savedAt >= m.at);
  if (m.baseSavedAt && (!record || record.savedAt !== m.baseSavedAt)) stale = true;
  if (stale) {
    await discardRecoverySnapshot();
    return null;
  }
  if (!m.regionName) m.regionName = region!.name;
  return { marker: m, payload: snap.payload, record };
}

/** rebuild the snapshot's city (validated by a full deserialize) — throws when it cannot be restored */
export function rebuildRecoveredCity(p: PendingRecovery): SerializedCity {
  const delta = decodeBundle(p.payload) as CityDelta;
  const city = applyCityDelta(delta, p.record?.city ?? null);
  if (city.format !== CITY_SAVE_FORMAT) throw new Error('recovery: bad snapshot');
  deserializeCity(city); // must load (migrates a copy)
  return city;
}

/** make the snapshot the city's save (the previous full save is replaced) and clear it */
export async function restoreRecoverySnapshot(p: PendingRecovery): Promise<void> {
  const city = rebuildRecoveredCity(p);
  const kv = await openKV();
  const key = keyOf(p.marker.regionId, p.marker.tileKey);
  city.savedAt = Date.now();
  const rec: CityRecord = { key, regionId: p.marker.regionId, tileKey: p.marker.tileKey, savedAt: city.savedAt, city };
  await kv.put('cities', rec, key);
  await discardRecoverySnapshot();
}

export async function discardRecoverySnapshot(): Promise<void> {
  try {
    localStorage.removeItem(LS_MARKER);
    localStorage.removeItem(LS_DATA);
  } catch {
    /* storage unavailable */
  }
  try {
    const kv = openedKV() ?? (await openKV());
    await kv.delete('recovery', IDB_KEY);
  } catch {
    /* ignore */
  }
}

/** drop a snapshot once a full save of the same city made it obsolete (cheap, synchronous localStorage part) */
export function clearRecoveryAfterSave(regionId: string, tileKey: string, savedAt: number): void {
  const m = peekRecoveryMarker();
  if (m && (m.regionId !== regionId || m.tileKey !== tileKey || m.at > savedAt)) return;
  void discardRecoverySnapshot();
}
