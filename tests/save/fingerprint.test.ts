import { describe, expect, it } from 'vitest';
import { cityFingerprint } from '../../src/save/fingerprint';
import { BF, type Building } from '../../src/sim/CityState';
import { smallCity } from './fixtures';

describe('cityFingerprint', () => {
  it('detects paused plain-data edits and historic flags', () => {
    const st = smallCity();
    const b: Building = { id: 1, def: 'res_cottage', x: 1, z: 1, w: 1, d: 1, rot: 0, variant: 0, pop: 5, jobs: 0, capacity: 6, wealth: 1, built: 1, age: 10, flags: 0, baseY: 0, health: 1, unhappy: 0 };
    st.buildings.set(b.id, b);
    for (const edit of [() => { st.day++; }, () => { st.funds++; }, () => { st.config.name += '!'; },
      () => { st.budget.taxRates[0]++; }, () => { st.budget.funding.fire++; }, () => { st.budget.ordinances.push('test'); },
      () => { st.unlocked.add('new'); }, () => { b.flags |= BF.Historic; }, () => { st.nextBuildingId++; }]) {
      const before = cityFingerprint(st); edit(); expect(cityFingerprint(st)).not.toBe(before);
    }
  });

  it('ignores camera and derived layers without changing them', () => {
    const st = smallCity(), before = cityFingerprint(st);
    st.systemData.camera = { x: 4, z: 8, distance: 600 };
    st.traffic[3] = 100; st.desirability[0][3] = 0.6;
    const data = structuredClone(st.systemData), traffic = st.traffic.slice();
    expect(cityFingerprint(st)).toBe(before);
    expect(st.systemData).toEqual(data); expect(st.traffic).toEqual(traffic);
  });
});
