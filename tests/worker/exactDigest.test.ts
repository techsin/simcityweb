/** NOTE-039: exactDigest hashes every NaN as one canonical NaN; every other float byte (-0 included) as stored */
import { describe, expect, it } from 'vitest';
import { exactDigest } from '../../src/worker/queries';
import { newState } from '../infra/cityGen';

describe('exactDigest float canonicalization (NOTE-039)', () => {
  it('NaNs with different bit patterns hash the same; -0, other values and plain arrays still count', () => {
    const a = newState(8), b = newState(8);
    const bits = (st: ReturnType<typeof newState>, i: number, u32: number) =>
      new DataView(st.heights.buffer, st.heights.byteOffset).setUint32(i * 4, u32, true);
    expect(exactDigest(a)).toBe(exactDigest(b));
    bits(a, 3, 0x7fc00000); bits(b, 3, 0xffc00000); // arithmetic and passed-through NaNs
    expect(Number.isNaN(a.heights[3]) && Number.isNaN(b.heights[3])).toBe(true);
    expect(exactDigest(a)).toBe(exactDigest(b));
    bits(b, 3, 0x7fc00001); // a signalling-style payload is still a NaN
    expect(exactDigest(a)).toBe(exactDigest(b));
    a.heights[5] = 0; b.heights[5] = -0;
    expect(exactDigest(a)).not.toBe(exactDigest(b));
    b.heights[5] = 0; b.heights[6] = a.heights[6] + 1;
    expect(exactDigest(a)).not.toBe(exactDigest(b));
    b.heights[6] = a.heights[6];
    expect(exactDigest(a)).toBe(exactDigest(b));
    b.zone[2] = a.zone[2] + 1; // integer layers hash their bytes unchanged
    expect(exactDigest(a)).not.toBe(exactDigest(b));
  });
});
