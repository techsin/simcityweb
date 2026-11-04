import { describe, expect, it } from 'vitest';
import { decodeBundle, encodeBundle } from '../../src/save/bundleCodec';
import * as fileBundle from '../../src/save/bundle';

describe('bundleCodec', () => {
  it('keeps the version-1 byte format and the browser module re-exports', () => {
    // An existing version-1 bundle: header, JSON {"n":3}, then padding to 8 bytes.
    const bytes = new Uint8Array([77, 84, 82, 80, 1, 0, 0, 0, 7, 0, 0, 0, 123, 34, 110, 34, 58, 51, 125, 0, 0, 0, 0, 0]);
    expect(decodeBundle(bytes)).toEqual({ n: 3 });
    expect(encodeBundle({ n: 3 })).toEqual(bytes);
    expect(fileBundle.encodeBundle).toBe(encodeBundle);
    expect(fileBundle.decodeBundle).toBe(decodeBundle);
  });

  it('round-trips typed views, maps, sets and special values without aliasing buffers', () => {
    const original = { a: new Uint16Array([9, 10, 11]).subarray(1), m: new Map([[1, new Float32Array([NaN, Infinity])]]),
      s: new Set(['x']), u: undefined, big: 9n, date: new Date(1234), n: -Infinity };
    const bytes = encodeBundle(original);
    const back = decodeBundle(bytes) as typeof original;
    expect(back).toEqual(original);
    original.a[0] = 44;
    bytes.fill(0);
    expect([...back.a]).toEqual([10, 11]);
    expect(back.a.byteOffset).toBe(0);
    expect(back.a.buffer.byteLength).toBe(back.a.byteLength);
  });
});
