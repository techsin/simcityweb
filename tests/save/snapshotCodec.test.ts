import { describe, expect, it } from 'vitest';
import { buildRecoverySnapshot, rebuildRecoveredCity, RECOMPUTED_LAYERS } from '../../src/save/recoveryCodec';
import { deserializeCity } from '../../src/save/serialize';
import { recoveryFixture } from './fixtures';

describe('recovery snapshot builder', () => {
  it('uses the supplied base and timestamp, and owns its encoded bytes', () => {
    const f = recoveryFixture();
    expect(f.marker).toMatchObject({ at: 1010, baseSavedAt: 1000, baseDay: 0, day: 10, bytes: f.payload.length, ls: false });
    f.state.zone[2] = 4; f.state.day++;
    const restored = deserializeCity(rebuildRecoveredCity(f));
    expect(restored.zone[2]).toBe(1); expect(restored.day).toBe(10);
    expect(f.record.city.layers.zone[2]).toBe(0);
  });

  it('keeps primary data in a lean delta, and never uses another city as its base', () => {
    const f = recoveryFixture(), info = { at: 1020, cityName: 'Saved City', population: 0, funds: 0, lean: true };
    f.state.traffic[1] = 50;
    const lean = buildRecoverySnapshot('rtest', '0_0', f.state, f.record, info, 1000);
    expect(lean.dropped).toContain('traffic');
    expect(lean.dropped.every((k) => RECOMPUTED_LAYERS.includes(k))).toBe(true);
    const restored = deserializeCity(rebuildRecoveredCity({ ...lean, record: f.record }));
    expect(restored.traffic[1]).toBe(0); expect(restored.zone[2]).toBe(1);
    const other = buildRecoverySnapshot('rtest', '1_0', f.state, f.record, info);
    expect(other.marker.baseSavedAt).toBe(0); expect(other.dropped).toEqual([]);
    expect(deserializeCity(rebuildRecoveredCity({ ...other, record: null })).traffic[1]).toBe(50);
  });
});
