import { describe, expect, it, vi } from 'vitest';
import { DevType } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import { CATALOG, getDef } from '../../src/sim/catalog';
import { DistrictSmog } from '../../src/render/world/WorldView';
import { newState, place } from '../infra/cityGen';

function advance(smog: DistrictSmog, state: CityState, seconds: number): number {
  for (let left = seconds; left > 1e-9; left -= 0.25) smog.update(state, Math.min(0.25, left), 24, 24);
  return smog.value;
}

/** Air history at one makes the signal equal the district share before easing. */
function districtShare(state: CityState): number {
  state.history.air.push(1);
  const smog = new DistrictSmog();
  smog.update(state, 0, 24, 24);
  return advance(smog, state, 3) / (1 - Math.exp(-3));
}

describe('NOTE-071 smog emitters and district denominator', () => {
  it('counts emitting factories and plants without Polluted flags, together with flagged homes', () => {
    const st = newState(64);
    const factory = CATALOG.find((d) => d.category === 'growable' && d.devType === DevType.ID && (d.pollution?.air ?? 0) > 0);
    expect(factory).toBeDefined();
    place(st, factory!.id, 20, 20);
    place(st, 't_coal', 24, 20);
    place(st, 't_r1', 28, 20, { flags: BF.Polluted });
    place(st, 't_r1', 30, 20);
    expect(districtShare(st)).toBeCloseTo(3 / 4, 12);
  });

  it.each([0, BF.Polluted])('excludes park and civic categories from both counts (flags: %s)', (flags) => {
    const st = newState(64);
    place(st, 't_r1', 20, 20, { flags: BF.Polluted });
    place(st, 't_r1', 22, 20);
    place(st, 't_park', 24, 20, { flags });
    place(st, 'civ_city_hall', 26, 20, { flags });
    expect(districtShare(st)).toBeCloseTo(1 / 2, 12);
  });

  it('leaves a district containing only parks and civic buildings exactly neutral', () => {
    const st = newState(64);
    place(st, 't_park', 20, 20, { flags: BF.Polluted });
    place(st, 'civ_city_hall', 24, 20, { flags: BF.Polluted });
    st.history.air.push(1);
    const smog = new DistrictSmog();
    expect(advance(smog, st, 3)).toBe(0);
    expect(smog.tint).toBe(0);
  });

  it.each([
    { air: undefined, share: 0.5 },
    { air: 0, share: 0.5 },
    { air: -0.5, share: 0.5 },
    { air: 0.1, share: 1 },
  ])('counts only positive air emissions, not noise ($air)', ({ air, share }) => {
    const st = newState(64);
    const def = getDef('t_small_plant')!;
    const previous = def.pollution;
    try {
      def.pollution = { air, noise: 1, radius: 3 };
      place(st, 't_small_plant', 20, 20);
      place(st, 't_r1', 24, 20, { flags: BF.Polluted });
      expect(districtShare(st)).toBeCloseTo(share, 12);
    } finally { def.pollution = previous; }
  });

  it.each([0, BF.Polluted])('uses flags safely when a definition is missing (flags: %s)', (flags) => {
    const st = newState(64);
    const unknown = place(st, 't_r1', 20, 20, { flags });
    unknown.def = 'smog_missing_definition';
    place(st, 't_r1', 24, 20, { flags: BF.Polluted });
    expect(districtShare(st)).toBeCloseTo(flags ? 1 : 0.5, 12);
  });

  it('caches emitter decisions until the dirty snapshot refreshes in a later month', () => {
    const st = newState(64);
    const b = place(st, 't_small_plant', 20, 20);
    st.history.air.push(1);
    const scans = vi.spyOn(st.buildings, 'values');
    try {
      const smog = new DistrictSmog();
      smog.update(st, 0, 24, 24);
      b.def = 't_coal';
      smog.invalidate();
      expect(advance(smog, st, 1)).toBe(0);
      expect(scans).toHaveBeenCalledTimes(1);
      st.day = 30;
      expect(advance(smog, st, 0.5)).toBeCloseTo(1 - Math.exp(-0.25), 12);
      expect(scans).toHaveBeenCalledTimes(2);
      advance(smog, st, 1);
      expect(scans, 'frames and nearby samples reuse the monthly metadata snapshot').toHaveBeenCalledTimes(2);
    } finally { scans.mockRestore(); }
  });
});
