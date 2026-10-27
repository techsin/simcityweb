/** Recovery delta and string codecs; no storage or browser APIs. */
import { CITY_SAVE_FORMAT, deserializeCity, isTypedArray, serializeCity, type AnyTypedArray, type SerializedBuildings, type SerializedCity } from './serialize';
import { decodeBundle, encodeBundle } from './bundleCodec';
import { MONTH_NAMES } from '../sim/CityState';
import type { SavableCityState } from './state';
import type { CityRecord } from './cities';
import type { Journal, JournalOp } from '../worker/protocol';

export const DELTA_KIND = 'metropolis-city-delta';
export const DELTA_VERSION = 1;
/** max payload kept in localStorage (packed 15 bits / char → ~1.15 M chars ≈ 2.3 MB of UTF-16, well inside every browser's quota) */
export const LS_BUDGET_BYTES = 2_150_000;
// W1.1b: shared by the authoritative snapshot builder and the page's journal slot.
export const JOURNAL_RESERVE_BYTES = 128 * 1024;

export const JOURNAL_OPS: Readonly<Record<JournalOp, true>> = {
  zone: true, dezone: true, bulldoze: true, buildNetwork: true, buildPowerLine: true, buildSubway: true,
  plop: true, terraform: true, plantTrees: true, setTax: true, setFunding: true, setHistoric: true,
  setOrdinance: true, takeLoan: true, repayLoan: true,
};
export function isJournalOp(op: string): op is JournalOp { return Object.hasOwn(JOURNAL_OPS, op); }

/** This base predates FH-07a's refund fields: keep the bulldoze ack's signed net charge. */
export interface RecoveryJournal extends Journal {
  ops: (Journal['ops'][number] & { cost?: number })[];
}

/** Metadata only; the page never needs the serialized city to bind its journal. */
export interface JournalBase extends RecoveryCity { savedAt: number; snapshot?: RecoveryMarker }

export function journalMatches(journal: RecoveryJournal, base: JournalBase): boolean {
  if (!journal || journal.v !== 1 || journal.regionId !== base.regionId || journal.tileKey !== base.tileKey
    || !Number.isFinite(journal.at) || !Number.isSafeInteger(journal.fromCmd) || !Array.isArray(journal.ops)) return false;
  const b = journal.base, m = base.snapshot;
  if (m) {
    if (m.regionId !== base.regionId || m.tileKey !== base.tileKey || m.baseSavedAt !== base.savedAt || m.at <= base.savedAt
      || b?.kind !== 'snapshot' || b.at !== m.at || b.baseSavedAt !== base.savedAt || journal.at < m.at) return false;
  } else if (b?.kind !== 'save' || b.savedAt !== base.savedAt || journal.at < base.savedAt) return false;
  let seq = journal.fromCmd;
  for (const entry of journal.ops) {
    if (!entry || !Number.isSafeInteger(entry.seq) || entry.seq <= seq || !isJournalOp(entry.op) || !Array.isArray(entry.args)
      || (entry.cost !== undefined && (entry.op !== 'bulldoze' || !Number.isFinite(entry.cost)))) return false;
    seq = entry.seq;
  }
  return true;
}

/**
 * Layers the simulation recomputes from the primary data (traffic, pollution, coverage, land value, desirability,
 * utilities). Periodic background snapshots always leave them out (`lean`); an unload snapshot only when it would not
 * fit the localStorage budget (largest first). A left-out layer is restored from the base save — an earlier,
 * consistent value that the next monthly pass overwrites.
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
 * (varint unchangedUnits, varint literalUnits, literal XOR bytes) until all `floor(n / u)` whole units are covered,
 * then the tail bytes (n % u, always literal). The decoder starts from a copy of the base prefix and XORs the
 * literals in. (Exported for the codec tests.)
 */
export function encodeXor(cur: Uint8Array, base: Uint8Array | null): { u: 1 | 4; x: Uint8Array } {
  const n = cur.length;
  const u: 1 | 4 = cur.byteOffset % 4 === 0 && (!base || base.byteOffset % 4 === 0) ? 4 : 1;
  const units = Math.floor(n / u);
  const covered = base ? Math.min(base.length, n) : 0; // bytes the decoder pre-fills from the base
  const mFull = Math.floor(covered / u); // units entirely inside the base prefix: compare with the base
  // units from here on lie entirely past it: compare with 0. The unit straddling `covered` is always literal, unless it
  // is the partial unit after the last whole one (n % u bytes: a Uint8 or odd-length Uint16 building column), which is
  // the tail. Hence the clamp: without it a literal reaching the last whole unit ran one unit further, past `units`,
  // and the decoder rejected the snapshot ('corrupt delta').
  const mZero = Math.min(units, Math.ceil(covered / u));
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

/** XOR an encodeXor stream into `out` (pre-filled with the base prefix, zeros past it). (Exported for the codec tests.) */
export function decodeXor(out: Uint8Array, x: Uint8Array, u: 1 | 4): void {
  const n = out.length;
  const units = Math.floor(n / u);
  const tail = n - units * u;
  const p = { i: 0 };
  let pos = 0; // in units
  while (pos < units) {
    pos += readVarint(x, p);
    const lit = readVarint(x, p);
    const len = lit * u;
    if (p.i + len > x.length) throw new Error('recovery: truncated delta');
    let use = len;
    if (pos + lit > units) {
      // Snapshots written before the encoder fix (mZero above): the literal that reached the last whole unit could run
      // one unit further, over the partial tail unit, whose bytes the tail repeats after it. Apply the whole units of
      // that literal and skip the rest; the tail below then restores those bytes (the sampled hash still checks all).
      if (pos >= units || pos + lit !== units + 1 || tail === 0) throw new Error('recovery: corrupt delta');
      use = len - u;
    }
    const from = pos * u;
    for (let k = 0; k < use; k++) out[from + k] ^= x[p.i + k];
    p.i += len;
    pos += lit;
  }
  if (p.i + tail > x.length) throw new Error('recovery: truncated delta');
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

type Layer = SerializedCity['layers'][string];
/** a base layer can stand in for the current one on restore (same shape) */
const sameShape = (cv: Layer, bv: Layer | undefined): boolean =>
  !!bv && (Array.isArray(cv) ? Array.isArray(bv) && bv.length === cv.length && bv.every((a, i) => a.length === cv[i].length) : !Array.isArray(bv) && bv.length === cv.length);
const RECOMPUTED = new Set(RECOMPUTED_LAYERS);

/**
 * Delta of `cur` against `base` (null = no base). With `budget` (bytes), recomputed layers are dropped largest-first
 * until the typed-array payload fits (primary data is never dropped). `lean`: every recomputed layer is left out up
 * front, not even encoded (periodic background snapshots: far cheaper on a big city; restored from the base).
 */
export function encodeCityDelta(cur: SerializedCity, base: SerializedCity | null, baseSavedAt: number, opts: { budget?: number; lean?: boolean } = {}): CityDelta {
  const layers: Record<string, ArrayDelta | ArrayDelta[]> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(cur.layers)) {
    const bv = base?.layers[k];
    if (opts.lean && RECOMPUTED.has(k) && sameShape(v, bv)) {
      dropped.push(k);
      continue;
    }
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
  if (opts.budget !== undefined && base) {
    let total = Object.values(layers).reduce((a, d) => a + deltaBytes(d), 0) + Object.values(cols).reduce((a, d) => a + d.x.length, 0);
    const cands = RECOMPUTED_LAYERS.filter((k) => layers[k] && base.layers[k]).sort((a, b) => deltaBytes(layers[b]) - deltaBytes(layers[a]));
    for (const k of cands) {
      if (total <= opts.budget) break;
      // only when the base layer has the same shape (it replaces the current one on restore)
      if (!sameShape(cur.layers[k], base.layers[k])) continue;
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
  /** Absent on legacy snapshots; journal-only markers have no payload. */
  kind?: 'snapshot' | 'journal';
  journalIdbOnly?: boolean;
}

export interface WriteResult {
  ok: boolean;
  bytes: number;
  ls: boolean;
  idb: boolean;
  ms: number;
  dropped: string[];
}

/** a city (region id + tile key) */
export interface RecoveryCity {
  regionId: string;
  tileKey: string;
}

export type SnapshotInfo = Omit<RecoveryInfo, 'day' | 'baseDay' | 'date' | 'baseDate'> & { why?: string; lean?: boolean };
export interface RecoverySnapshot { marker: RecoveryMarker; payload: Uint8Array; dropped: string[] }

/** Encode against an explicit base and timestamp, without consulting storage or changing the base. */
export function buildRecoverySnapshot(regionId: string, tileKey: string, state: SavableCityState, base: CityRecord | null, info: SnapshotInfo & { at: number }, budget = LS_BUDGET_BYTES): RecoverySnapshot {
  const b = base?.regionId === regionId && base.tileKey === tileKey ? base : null;
  const cur = serializeCity(state);
  cur.savedAt = info.at;
  const delta = encodeCityDelta(cur, b?.city ?? null, b?.savedAt ?? 0, { budget, lean: info.lean });
  const payload = encodeBundle(delta);
  const baseDay = b ? Number(b.city.scalars.day ?? 0) : undefined;
  const startYear = Number(state.config.startYear ?? 2000);
  const marker: RecoveryMarker = {
    v: DELTA_VERSION, regionId, tileKey, at: info.at, baseSavedAt: delta.baseSavedAt,
    bytes: payload.length, ls: false, dropped: delta.dropped,
    cityName: info.cityName, regionName: info.regionName, day: Number(state.day ?? 0), baseDay,
    date: gameDateLabel(Number(state.day ?? 0), startYear),
    baseDate: baseDay !== undefined ? gameDateLabel(baseDay, startYear) : undefined,
    population: info.population, funds: info.funds, why: info.why,
  };
  return { marker, payload, dropped: delta.dropped };
}

export interface PendingRecovery {
  marker: RecoveryMarker;
  payload: Uint8Array;
  /** the full save the snapshot is a delta of */
  record: CityRecord | null;
}

/** Rebuild and validate with a full deserialize; the stored base is never mutated. */
export function rebuildRecoveredCity(p: PendingRecovery): SerializedCity {
  const delta = decodeBundle(p.payload) as CityDelta;
  const city = applyCityDelta(delta, p.record?.city ?? null);
  if (city.format !== CITY_SAVE_FORMAT) throw new Error('recovery: bad snapshot');
  deserializeCity(city);
  return city;
}
