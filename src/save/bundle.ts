/**
 * Binary bundle codec for export files (.metropolis) — pure, headless-safe.
 *
 * Layout: "MTRP" | u32 bundleVersion | u32 jsonByteLength | JSON (utf-8) | pad to 8 | binary blob
 * JSON encodes the value tree; typed arrays become {"$ta": ctorName, "o": byteOffset, "n": length} into the blob,
 * Maps {"$map": entries}, Sets {"$set": values}, non-finite numbers {"$num": "NaN"|"Inf"|"-Inf"}, undefined {"$u":1}.
 * The whole bundle can be gzip-compressed (CompressionStream) — decode detects gzip magic automatically.
 */
import { isTypedArray, type AnyTypedArray } from './serialize';

export const BUNDLE_VERSION = 1;
const MAGIC = [0x4d, 0x54, 0x52, 0x50]; // "MTRP"

const CTORS: Record<string, new (buf: ArrayBuffer, off: number, len: number) => AnyTypedArray> = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
};

export function encodeBundle(value: unknown): Uint8Array {
  const blobs: { arr: AnyTypedArray; off: number }[] = [];
  let blobLen = 0;
  const enc = (v: unknown): unknown => {
    if (v === undefined) return { $u: 1 };
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : { $num: Number.isNaN(v) ? 'NaN' : v > 0 ? 'Inf' : '-Inf' };
    if (typeof v === 'bigint') return { $big: v.toString() };
    if (isTypedArray(v)) {
      const align = v.BYTES_PER_ELEMENT;
      blobLen = Math.ceil(blobLen / 8) * 8;
      void align;
      const off = blobLen;
      blobs.push({ arr: v, off });
      blobLen += v.byteLength;
      return { $ta: v.constructor.name, o: off, n: v.length };
    }
    if (v instanceof ArrayBuffer) return enc(new Uint8Array(v));
    if (v instanceof Map) return { $map: [...v.entries()].map(([k, x]) => [enc(k), enc(x)]) };
    if (v instanceof Set) return { $set: [...v].map(enc) };
    if (v instanceof Date) return { $date: v.getTime() };
    if (Array.isArray(v)) return v.map(enc);
    if (typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (typeof x === 'function') continue;
        o[k] = enc(x);
      }
      // escape user keys that collide with markers
      return o;
    }
    return null;
  };
  const tree = enc(value);
  const json = new TextEncoder().encode(JSON.stringify(tree));
  const headLen = 12 + json.length;
  const blobStart = Math.ceil(headLen / 8) * 8;
  const out = new Uint8Array(blobStart + blobLen);
  out.set(MAGIC, 0);
  const dv = new DataView(out.buffer);
  dv.setUint32(4, BUNDLE_VERSION, true);
  dv.setUint32(8, json.length, true);
  out.set(json, 12);
  for (const { arr, off } of blobs) out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), blobStart + off);
  return out;
}

export function decodeBundle(bytes: Uint8Array): unknown {
  if (bytes.length < 12 || MAGIC.some((m, i) => bytes[i] !== m)) throw new Error('Not a Metropolis file');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint32(4, true);
  if (version > BUNDLE_VERSION) throw new Error(`File version ${version} is newer than this game`);
  const jsonLen = dv.getUint32(8, true);
  const tree = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + jsonLen)));
  const blobStart = Math.ceil((12 + jsonLen) / 8) * 8;
  const dec = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(dec);
    const o = v as Record<string, unknown>;
    if ('$ta' in o) {
      const C = CTORS[o.$ta as string];
      if (!C) throw new Error('Unknown array type ' + o.$ta);
      const n = o.n as number;
      const bpe = (C as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
      // copy into a fresh aligned buffer
      const buf = new ArrayBuffer(n * bpe);
      new Uint8Array(buf).set(bytes.subarray(blobStart + (o.o as number), blobStart + (o.o as number) + n * bpe));
      return new C(buf, 0, n);
    }
    if ('$u' in o) return undefined;
    if ('$num' in o) return o.$num === 'NaN' ? NaN : o.$num === 'Inf' ? Infinity : -Infinity;
    if ('$big' in o) return BigInt(o.$big as string);
    if ('$map' in o) return new Map((o.$map as [unknown, unknown][]).map(([k, x]) => [dec(k), dec(x)]));
    if ('$set' in o) return new Set((o.$set as unknown[]).map(dec));
    if ('$date' in o) return new Date(o.$date as number);
    const r: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) {
      const d = dec(x);
      if (d !== undefined || (x as { $u?: number })?.$u) r[k] = d;
    }
    return r;
  };
  return dec(tree);
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function pipe(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** gzip when CompressionStream is available (browsers, node >= 18), otherwise returns the input */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return bytes;
  return pipe(bytes, new CompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(bytes)) return bytes;
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read compressed files');
  return pipe(bytes, new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
}

/** encode + gzip */
export async function packFile(value: unknown, compress = true): Promise<Uint8Array> {
  const raw = encodeBundle(value);
  return compress ? gzip(raw) : raw;
}

/** gunzip (if needed) + decode */
export async function unpackFile(bytes: Uint8Array): Promise<unknown> {
  return decodeBundle(await gunzip(bytes));
}
