/**
 * Recovery snapshot codec (src/save/recovery.ts encodeXor / decodeXor) at the edges that broke real recoveries with
 * 'recovery: corrupt delta': byte lengths that are not a multiple of 4 (the Uint8 `rot` and odd-length Uint16 `w` /
 * `d` building columns), bases shorter than / as long as / longer than the current array, changes in the first word,
 * the middle, the last whole word and the tail; a city with 41-45 buildings after one bulldoze + one growth (codec and
 * the write -> find -> restore cycle); and snapshots written by the pre-fix encoder, which must still restore.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCityState } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { Network, Zone } from '../../src/core/types';
import { deserializeCity, isTypedArray, serializeCity, type AnyTypedArray, type SerializedCity } from '../../src/save/serialize';
import { decodeBundle, encodeBundle } from '../../src/save/bundleCodec';
import {
  LS_BUDGET_BYTES,
  RECOMPUTED_LAYERS,
  applyCityDelta,
  clearRecoveryBase,
  decodeXor,
  encodeCityDelta,
  encodeXor,
  findRecoverySnapshot,
  loadCity,
  restoreRecoverySnapshot,
  saveCity,
  saveRegion,
  setKV,
  writeRecoverySnapshot,
  type CityDelta,
} from '../../src/save/index';
import { MemStorage, PersistentMemoryKV, regionData } from './fixtures';

// ------------------------------------------------------------------------------------------------ helpers
/** deterministic PRNG (mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` random bytes in a fresh buffer at byte offset `off` (off % 4 != 0: the codec then works in byte units) */
function randomBytes(n: number, r: () => number, off = 0): Uint8Array {
  const v = new Uint8Array(new ArrayBuffer(n + off + 8), off, n);
  for (let i = 0; i < n; i++) v[i] = (r() * 256) | 0;
  return v;
}

/** a copy of `src` resized to `n` bytes (random bytes past its end) at byte offset `off` */
function resized(src: Uint8Array, n: number, r: () => number, off = 0): Uint8Array {
  const v = randomBytes(n, r, off);
  v.set(src.subarray(0, Math.min(n, src.length)));
  return v;
}

const bytesOf = (a: AnyTypedArray): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** decode the way applyArrayDelta does: start from the base prefix (zeros past it), XOR the stream in */
function decode(x: Uint8Array, u: 1 | 4, n: number, base: Uint8Array | null): Uint8Array {
  const out = new Uint8Array(n);
  if (base) out.set(base.subarray(0, Math.min(base.length, n)));
  decodeXor(out, x, u);
  return out;
}

const diffAt = (a: Uint8Array, b: Uint8Array): number => {
  if (a.length !== b.length) return -2;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
};

/** the end (in units) of every (skip, literal) pair of a stream, and where the tail starts — parsed strictly */
function streamShape(x: Uint8Array, u: 1 | 4, n: number): { ends: number[]; tailAt: number } {
  const units = Math.floor(n / u);
  const p = { i: 0 };
  const varint = (): number => {
    let v = 0, mul = 1, b: number;
    do {
      if (p.i >= x.length) throw new Error('stream: truncated varint');
      b = x[p.i++];
      v += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return v;
  };
  const ends: number[] = [];
  let pos = 0;
  while (pos < units) {
    pos += varint();
    const lit = varint();
    p.i += lit * u;
    pos += lit;
    ends.push(pos);
  }
  return { ends, tailAt: p.i };
}

/** encode -> (strict shape check) -> decode; a failure description, or null */
function roundTrip(cur: Uint8Array, base: Uint8Array | null, label: string): string | null {
  const { u, x } = encodeXor(cur, base);
  const n = cur.length, units = Math.floor(n / u);
  try {
    const { ends, tailAt } = streamShape(x, u, n);
    // the fixed encoder never needs the decoder's leniency for pre-fix snapshots: no literal runs past the whole units
    if (ends.some((e) => e > units)) return `${label}: a literal runs past the ${units} whole units (${ends.join(',')})`;
    if (tailAt + (n - units * u) !== x.length) return `${label}: stream length ${x.length}, expected ${tailAt + n - units * u}`;
    const back = decode(x, u, n, base);
    const d = diffAt(back, cur);
    return d === -1 ? null : `${label}: byte ${d} differs after the round trip`;
  } catch (e) {
    return `${label}: ${(e as Error).message}`;
  }
}

/**
 * The PRE-FIX encoder, verbatim (git 4b3d074, src/save/recovery.ts encodeXor + ByteWriter): snapshots already
 * written by it must keep restoring. Its only flaw: mZero = ceil(covered / u) could be units + 1.
 */
class OldByteWriter {
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
function oldEncodeXor(cur: Uint8Array, base: Uint8Array | null): { u: 1 | 4; x: Uint8Array } {
  const n = cur.length;
  const u: 1 | 4 = cur.byteOffset % 4 === 0 && (!base || base.byteOffset % 4 === 0) ? 4 : 1;
  const units = Math.floor(n / u);
  const covered = base ? Math.min(base.length, n) : 0;
  const mFull = Math.floor(covered / u);
  const mZero = Math.ceil(covered / u);
  const c = u === 4 ? new Uint32Array(cur.buffer, cur.byteOffset, units) : cur;
  const b = base ? (u === 4 ? new Uint32Array(base.buffer, base.byteOffset, Math.floor(base.length / 4)) : base) : null;
  const bb = b ?? c;
  const nextChanged = (i: number): number => {
    while (i < mFull && c[i] === bb[i]) i++;
    if (i < mFull || i < mZero) return i;
    while (i < units && c[i] === 0) i++;
    return i;
  };
  const nextSame = (i: number): number => {
    while (i < mFull && c[i] !== bb[i]) i++;
    if (i < mFull) return i;
    if (i < mZero) i = mZero;
    while (i < units && c[i] !== 0) i++;
    return i;
  };
  const w = new OldByteWriter();
  let i = 0;
  while (i < units) {
    const z0 = i;
    i = nextChanged(i);
    const l0 = i;
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
/** the pre-fix stream overruns (a literal ends at units + 1: the old decoder threw 'corrupt delta') */
const overruns = (x: Uint8Array, u: 1 | 4, n: number): boolean => streamShape(x, u, n).ends.some((e) => e > Math.floor(n / u));

/**
 * Edits of `base` into `cur`: which words / bytes change. Positions are bytes; `lastWord` is the last whole 4-byte
 * word of `cur`, `tail` the n % 4 bytes after it.
 */
const PATTERNS = ['none', 'first', 'middle', 'lastWord', 'tail', 'lastWord+tail', 'first+middle+lastWord+tail', 'all'] as const;
function edit(cur: Uint8Array, pattern: (typeof PATTERNS)[number], r: () => number): void {
  const n = cur.length, whole = Math.floor(n / 4) * 4;
  const flip = (i: number) => {
    if (i >= 0 && i < n) cur[i] ^= 1 + ((r() * 255) | 0);
  };
  const has = (k: string) => pattern.split('+').includes(k);
  if (pattern === 'all') {
    for (let i = 0; i < n; i++) flip(i);
    return;
  }
  if (has('first')) flip(0);
  if (has('middle')) flip(Math.floor(n / 2));
  if (has('lastWord') && whole > 0) flip(whole - 1 - ((r() * 4) | 0));
  if (has('tail')) for (let i = whole; i < n; i++) flip(i);
}

// ------------------------------------------------------------------------------------------------ codec
describe('recovery codec: lengths that are not a multiple of 4', () => {
  it('Uint8 arrays of 10, 11, 13, 242, 243 and 1001 bytes round-trip (changes in the first word, middle, last whole word, tail)', () => {
    const r = rng(1);
    const fails: string[] = [];
    let cases = 0;
    for (const n of [10, 11, 13, 242, 243, 1001]) {
      const whole = Math.floor(n / 4) * 4;
      // base shorter than cur (ending inside / before the tail, and inside a whole word), as long, and longer
      const baseLens = [...new Set([0, 1, n - 5, whole - 2, whole, whole + 1, n - 1, n, n + 1, n + 3, n + 4, n + 7])].filter((b) => b >= 0);
      for (const bl of baseLens) {
        for (const pattern of PATTERNS) {
          const base = randomBytes(bl, r);
          const cur = resized(base, n, r);
          edit(cur, pattern, r);
          cases++;
          const f = roundTrip(cur, base, `n=${n} base=${bl} ${pattern}`);
          if (f) fails.push(f);
        }
      }
      // no base at all (a full snapshot): zero runs against 0
      const cur = randomBytes(n, r);
      cur.fill(0, 2, Math.max(2, n - 3));
      const f = roundTrip(cur, null, `n=${n} no base`);
      if (f) fails.push(f);
    }
    expect(cases).toBeGreaterThan(400);
    expect(fails).toEqual([]);
  });

  it('odd-length Uint16 arrays (the w / d building columns) round-trip, base shorter / as long / longer', () => {
    const r = rng(2);
    const fails: string[] = [];
    for (const len of [1, 3, 5, 41, 43, 121, 243]) {
      for (const baseLen of [len - 2, len - 1, len, len + 1, len + 2].filter((b) => b >= 0)) {
        for (const pattern of PATTERNS) {
          const base = new Uint16Array(baseLen);
          for (let i = 0; i < baseLen; i++) base[i] = (r() * 65536) | 0;
          const cur = new Uint16Array(len);
          cur.set(base.subarray(0, Math.min(len, baseLen)));
          for (let i = baseLen; i < len; i++) cur[i] = (r() * 4) | 0; // small values, like widths / depths
          const cb = bytesOf(cur);
          edit(cb, pattern, r);
          const f = roundTrip(cb, bytesOf(base), `u16 len=${len} base=${baseLen} ${pattern}`);
          if (f) fails.push(f);
        }
      }
    }
    expect(fails).toEqual([]);
  });

  it('every length 0..40 x every base length 0..44 (and none) x every edit pattern, aligned and unaligned views', () => {
    const r = rng(3);
    const fails: string[] = [];
    // byte offsets of (cur, base): both aligned -> 32-bit units; either unaligned -> byte units
    for (const [offCur, offBase] of [[0, 0], [1, 1], [0, 2], [3, 0]]) {
      for (let n = 0; n <= 40; n++) {
        for (let bl = -1; bl <= 44; bl++) {
          for (const pattern of PATTERNS) {
            const base = bl < 0 ? null : randomBytes(bl, r, offBase);
            const cur = base ? resized(base, n, r, offCur) : randomBytes(n, r, offCur);
            if (!base) cur.fill(0, 0, (n * r()) | 0);
            edit(cur, pattern, r);
            const f = roundTrip(cur, base, `off=${offCur}/${offBase} n=${n} base=${bl} ${pattern}`);
            if (f && fails.length < 20) fails.push(f);
          }
        }
      }
    }
    expect(fails).toEqual([]);
  });

  it('snapshots written by the pre-fix encoder still decode exactly (including its one-unit overrun into the tail)', () => {
    const r = rng(4);
    const fails: string[] = [];
    let overrunCases = 0;
    for (let n = 0; n <= 40; n++) {
      for (let bl = -1; bl <= 44; bl++) {
        for (const pattern of PATTERNS) {
          const base = bl < 0 ? null : randomBytes(bl, r);
          const cur = base ? resized(base, n, r) : randomBytes(n, r);
          edit(cur, pattern, r);
          const { u, x } = oldEncodeXor(cur, base);
          if (overruns(x, u, n)) overrunCases++;
          try {
            const d = diffAt(decode(x, u, n, base), cur);
            if (d !== -1) fails.push(`n=${n} base=${bl} ${pattern}: byte ${d} differs`);
          } catch (e) {
            fails.push(`n=${n} base=${bl} ${pattern}: ${(e as Error).message}`);
          }
        }
      }
    }
    // (the case the old decoder rejected is common: any change in the last whole word with n % 4 != 0)
    expect(overrunCases).toBeGreaterThan(500);
    expect(fails).toEqual([]);
  });

  it('still rejects malformed streams', () => {
    const r = rng(5);
    const base = randomBytes(11, r);
    const cur = resized(base, 11, r);
    edit(cur, 'first+middle+lastWord+tail', r);
    const { u, x } = encodeXor(cur, base);
    expect(u).toBe(4);
    // a literal two units past the whole units / one unit past them with no tail / a cut-off literal or tail
    const twoPast = new Uint8Array([0, 4, ...new Array(16).fill(1), 1, 2, 3]);
    expect(() => decode(twoPast, 4, 11, base)).toThrow(/corrupt delta/);
    const noTail = new Uint8Array([0, 3, ...new Array(12).fill(1)]);
    expect(() => decode(noTail, 4, 8, base)).toThrow(/corrupt delta/);
    expect(() => decode(x.subarray(0, 5), 4, 11, base)).toThrow(/truncated delta/);
    expect(() => decode(x.subarray(0, x.length - 1), 4, 11, base)).toThrow(/truncated delta/);
    expect(() => decode(new Uint8Array([0x80]), 4, 11, base)).toThrow(/truncated delta/);
  });
});

// ------------------------------------------------------------------------------------------------ cities
function bld(id: number, x: number, z: number, extra: Partial<Building> = {}): Building {
  return { id, def: 'res_cottage', x, z, w: 1, d: 1, rot: 0, variant: 0, pop: 5, jobs: 0, capacity: 6, wealth: 1, built: 1, age: 10, flags: BF.Powered, baseY: 0, health: 1, unhappy: 0, ...extra };
}

/** a 64-map city with `n` small homes (varied rot / variant / size) along a road */
function cityWith(n: number): CityState {
  const st = createCityState(defaultCityConfig({ name: 'Evergreen', mayor: 'Ada', size: 64, seed: 99, terrain: 'river' }));
  st.day = 400;
  st.funds = 50_000;
  for (let x = 2; x < 62; x++) {
    st.network[st.idx(x, 20)] = Network.Road;
    st.zone[st.idx(x, 21)] = Zone.ResLow;
  }
  for (let k = 0; k < n; k++) {
    const b = bld(k + 1, 2 + (k % 58), 21 + Math.floor(k / 58), { rot: (k % 4) as Building['rot'], variant: k % 3, w: 1 + (k % 2), d: 1 + (k % 3) });
    st.buildings.set(b.id, b);
    st.building[st.idx(b.x, b.z)] = b.id;
  }
  st.nextBuildingId = n + 1;
  return st;
}

/** the playtest edit: bulldoze house #3, one new home grows elsewhere; returns the new building's id */
function bulldozeAndGrow(st: CityState): number {
  const b3 = st.buildings.get(3)!;
  st.building[st.idx(b3.x, b3.z)] = 0;
  st.buildings.delete(3);
  const nb = bld(st.nextBuildingId++, 2, 40, { def: 'res_suburban', rot: 3, w: 2, d: 3, variant: 2, flags: BF.Constructing });
  st.buildings.set(nb.id, nb);
  st.building[st.idx(nb.x, nb.z)] = nb.id;
  st.day += 4;
  st.funds -= 5;
  return nb.id;
}

/** path of the first difference between two values (typed arrays compared element-wise) */
function firstDiff(a: unknown, b: unknown, path = '$'): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b) return `${path}: type ${typeof a} vs ${typeof b}`;
  if (a === null || b === null || typeof a !== 'object') return `${path}: ${String(a)} vs ${String(b)}`;
  if (a.constructor !== (b as object).constructor) return `${path}: ctor ${a.constructor?.name} vs ${(b as object).constructor?.name}`;
  if (ArrayBuffer.isView(a)) {
    const x = a as unknown as ArrayLike<number>, y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return `${path}: length ${x.length} vs ${y.length}`;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return `${path}[${i}]: ${x[i]} vs ${y[i]}`;
    return null;
  }
  if (a instanceof Map) return firstDiff([...a.entries()], [...(b as Map<unknown, unknown>).entries()], path);
  if (a instanceof Set) return firstDiff([...a], [...(b as Set<unknown>)], path);
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return `${path}: keys ${ka.sort().join(',')} vs ${kb.sort().join(',')}`;
  for (const k of ka) {
    const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

/** the restored city equals `cur` (lean: the recomputed layers it left out come from the base) */
function expectRestored(back: SerializedCity, cur: SerializedCity, base: SerializedCity, lean: boolean): void {
  const strip = (c: SerializedCity) => ({ ...c, savedAt: 0, layers: {} });
  expect(firstDiff(strip(back), strip(cur))).toBeNull();
  for (const k of Object.keys(cur.layers)) {
    const want = lean && RECOMPUTED_LAYERS.includes(k) ? base.layers[k] : cur.layers[k];
    expect(firstDiff(back.layers[k], want, `layers.${k}`)).toBeNull();
  }
}

const SIZES = [40, 41, 42, 43, 44, 45, 50, 241, 242, 243];

describe('recovery: a city whose building count is not a multiple of 4', { timeout: 600_000 }, () => {
  it('bulldoze one + grow one round-trips for 40-45, 50, 241-243 buildings (full and lean deltas, through the bundle)', () => {
    for (const n of SIZES) {
      const st = cityWith(n);
      const base = serializeCity(st, { copy: true });
      const newId = bulldozeAndGrow(st);
      const cur = serializeCity(st, { copy: true });
      for (const lean of [false, true]) {
        const delta = encodeCityDelta(cur, base, 1, { budget: LS_BUDGET_BYTES, lean });
        let back: SerializedCity;
        try {
          back = applyCityDelta(decodeBundle(encodeBundle(delta)) as CityDelta, base);
        } catch (e) {
          throw new Error(`${n} buildings, lean=${lean}: ${(e as Error).message}`);
        }
        expectRestored(back, cur, base, lean);
        const st2 = deserializeCity(back);
        expect(st2.buildings.size).toBe(n);
        expect(st2.buildings.has(3)).toBe(false);
        const nb = st2.buildings.get(newId)!;
        expect([nb.def, nb.rot, nb.w, nb.d, nb.variant]).toEqual(['res_suburban', 3, 2, 3, 2]);
      }
    }
  });

  it('a snapshot written by the pre-fix encoder (the one that failed in play) still restores the exact city', () => {
    for (const n of [41, 42, 43, 242]) {
      const st = cityWith(n);
      const base = serializeCity(st, { copy: true });
      bulldozeAndGrow(st);
      const cur = serializeCity(st, { copy: true });
      const delta = encodeCityDelta(cur, base, 1, { budget: LS_BUDGET_BYTES, lean: true });
      // re-encode every building column the way the pre-fix encoder did
      const curCols = cur.buildings as unknown as Record<string, unknown>;
      const baseCols = base.buildings as unknown as Record<string, unknown>;
      let overrun = 0;
      for (const [k, d] of Object.entries(delta.buildings.cols)) {
        const cv = curCols[k], bv = baseCols[k];
        if (!isTypedArray(cv) || !isTypedArray(bv)) continue;
        const old = oldEncodeXor(bytesOf(cv), bytesOf(bv));
        expect(old.u).toBe(d.u);
        if (overruns(old.x, old.u, cv.byteLength)) overrun++;
        d.x = old.x;
      }
      // the rot column (n bytes) overruns for every n here; w / d (2n bytes) when n is odd
      expect(overrun).toBeGreaterThanOrEqual(n % 2 ? 3 : 1);
      const back = applyCityDelta(decodeBundle(encodeBundle(delta)) as CityDelta, base);
      expectRestored(back, cur, base, true);
    }
  });
});

// ------------------------------------------------------------------------------------------------ write -> find -> restore
describe('recovery: periodic snapshot after a bulldoze, then the tab is killed', () => {
  let now: number;
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); clearRecoveryBase(); });
  beforeEach(() => {
    now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.stubGlobal('localStorage', new MemStorage());
    setKV(new PersistentMemoryKV());
    clearRecoveryBase();
  });

  it('Recover restores the bulldozed state for 41, 42 and 43 buildings', async () => {
    const data = regionData('rcodec', 'Codec Region');
    await saveRegion(data);
    for (const [i, n] of [41, 42, 43].entries()) {
      const tileKey = data.tiles[i].key;
      const st = cityWith(n);
      await saveCity('rcodec', tileKey, st); // the last full save (the snapshot's base)
      now += 10; // (a snapshot is only offered when it is newer than the save)
      const newId = bulldozeAndGrow(st);
      const w = writeRecoverySnapshot('rcodec', tileKey, st, { cityName: 'Evergreen', population: 100, funds: st.funds, why: 'periodic', lean: true });
      expect(w.ok).toBe(true);
      // (next start) the offer finds it ...
      const p = await findRecoverySnapshot({ regionId: 'rcodec', tileKey });
      expect(p?.marker.day).toBe(st.day);
      // ... and Recover restores it
      await restoreRecoverySnapshot(p!);
      const back = (await loadCity('rcodec', tileKey))!;
      expect(back.day).toBe(st.day);
      expect(back.funds).toBe(st.funds);
      expect(back.buildings.size).toBe(n);
      expect(back.buildings.has(3)).toBe(false);
      expect(back.building[back.idx(st.buildings.get(4)!.x, st.buildings.get(4)!.z)]).toBe(4);
      expect(back.buildings.get(newId)?.rot).toBe(3);
      expect(firstDiff(serializeCity(back).buildings, serializeCity(st).buildings, `${n}.buildings`)).toBeNull();
      expect(await findRecoverySnapshot({ regionId: 'rcodec', tileKey })).toBeNull();
    }
  });
});
