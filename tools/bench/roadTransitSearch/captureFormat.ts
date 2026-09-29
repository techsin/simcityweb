/**
 * Capture of every search.ts call of one or more traffic cycles (recorded by plugins.mjs in 'capture' mode) and its
 * binary encoding: [u32 header bytes][header JSON][pad to 8][blob]; typed arrays in the JSON are {"$ta": ctor, off, len}
 * references into the blob. Environment-agnostic (node and browser replays read the same file).
 */

export interface CapGraph {
  n: number;
  version: number;
  fwd: Int32Array;
  rev: Int32Array;
  type: Uint8Array;
}
export interface CapSeeds {
  n: number;
  node: Int32Array;
  label: Float64Array;
  id: Int32Array;
}
export interface CapNet {
  nR: number;
  nRail: number;
  nSub: number;
  nFerry: number;
  total: number;
  railTime: number;
  subTime: number;
  roadAdj: Int32Array;
  busTime: Float32Array;
  railAdj: Int32Array;
  subAdj: Int32Array;
  trStart: Int32Array;
  trTo: Int32Array;
  trCost: Float32Array;
}
export type CapCall =
  | { kind: 'road'; graph: string; dir: 'fwd' | 'rev' | 'other'; adj: Int32Array | null; time: Float32Array; S: number; seeds: CapSeeds; limit: number; ramp: Float32Array | null; settled: number }
  | { kind: 'transit'; S: number; seeds: CapSeeds; limit: number; T: CapNet; settled: number }
  | { kind: 'acc'; S: number; acc: Float32Array | Float64Array; f64: boolean; sink: boolean; settled: number };

export interface Capture {
  meta: Record<string, unknown>;
  graphs: Record<string, CapGraph>;
  calls: CapCall[];
}

type TA = Int32Array | Uint8Array | Float32Array | Float64Array | Uint16Array;
const CTORS: Record<string, new (b: ArrayBuffer, o: number, l: number) => TA> = {
  Int32Array, Uint8Array, Float32Array, Float64Array, Uint16Array,
};

export function encodeCapture(c: Capture): Uint8Array {
  const parts: TA[] = [];
  let off = 0;
  const header = JSON.stringify(c, (_k, v: unknown) => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const a = v as TA;
      off = Math.ceil(off / 8) * 8;
      const ref = { $ta: a.constructor.name, off, len: a.length };
      parts.push(a);
      (a as unknown as { __off: number }).__off = off;
      off += a.byteLength;
      return ref;
    }
    return v;
  });
  const hb = new TextEncoder().encode(header);
  const start = Math.ceil((4 + hb.length) / 8) * 8;
  const out = new Uint8Array(start + off);
  new DataView(out.buffer).setUint32(0, hb.length, true);
  out.set(hb, 4);
  for (const a of parts) {
    const o = (a as unknown as { __off: number }).__off;
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), start + o);
    delete (a as unknown as { __off?: number }).__off;
  }
  return out;
}

export function decodeCapture(bytes: Uint8Array): Capture {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hl = dv.getUint32(0, true);
  const header = new TextDecoder().decode(bytes.subarray(4, 4 + hl));
  const start = Math.ceil((4 + hl) / 8) * 8;
  // own, aligned copy of the blob
  const blob = bytes.slice(start).buffer;
  return JSON.parse(header, (_k, v: unknown) => {
    if (v && typeof v === 'object' && '$ta' in (v as Record<string, unknown>)) {
      const r = v as { $ta: string; off: number; len: number };
      const C = CTORS[r.$ta];
      const bpe = (C as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
      return new C(blob.slice(r.off, r.off + r.len * bpe), 0, r.len);
    }
    return v;
  }) as Capture;
}

/** human-readable call kind: road searches are told apart by direction and limit (traffic.ts call sites) */
export function callLabel(c: CapCall): string {
  if (c.kind === 'transit') return 'transit';
  if (c.kind === 'acc') return c.sink ? 'accumulate+sink' : 'accumulate';
  if (c.dir === 'fwd') return 'road:inbound';
  if (c.limit === 45) return 'road:shop';
  if (c.limit === 150) return 'road:freight';
  if (c.limit > 180) return 'road:round';
  return `road:${c.limit}`;
}
