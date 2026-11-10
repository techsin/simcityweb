import { describe, expect, it } from 'vitest';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { honourPerks } from '../../src/sim/economy/rewards';
import { readEffects } from '../../src/sim/infra/common';

function state(): CityState {
  return new CityState(defaultCityConfig({ size: 16, terrain: 'flat', disasters: false }));
}

describe('honour infrastructure perks', () => {
  it('keeps the legacy defaults exactly before an honour is earned', () => {
    const st = state();
    expect(honourPerks(st)).toEqual({ education: 1, ridership: 1 });
    for (const value of Object.values(readEffects(st))) expect(value).toBe(1);
    expect(st.systemData).toEqual({});
  });

  it.each([
    ['honour_scholar_city', 'eduEffect', 'transitRidership'],
    ['honour_transit_capital', 'transitRidership', 'eduEffect'],
  ] as const)('applies %s only to its own infrastructure effect', (id, boosted, unchanged) => {
    const st = state();
    const before = readEffects(st);
    st.unlocked.add(id);
    const after = readEffects(st);
    expect(after[boosted]).toBe(1.05);
    expect(after[unchanged]).toBe(1);
    expect({ ...after, [boosted]: before[boosted] }).toEqual(before);
  });

  it('multiplies existing ordinance effects once and caps each honour contribution at five percent', () => {
    const st = state();
    st.budget.ordinances.push('pro_reading', 'commuter_shuttle');
    const before = readEffects(st);
    expect(before.eduEffect).toBe(1.1);
    expect(before.transitRidership).toBe(1.1);
    for (let i = 0; i < 3; i++) {
      st.unlocked.add('honour_scholar_city');
      st.unlocked.add('honour_transit_capital');
    }
    st.unlocked.add('honour_megalopolis');
    const after = readEffects(st);
    expect(after.eduEffect).toBe(before.eduEffect * 1.05);
    expect(after.transitRidership).toBe(before.transitRidership * 1.05);
    expect(honourPerks(st)).toEqual({ education: 1.05, ridership: 1.05 });
    expect({ ...after, eduEffect: before.eduEffect, transitRidership: before.transitRidership }).toEqual(before);
  });

  it('keeps earned perks after population, education and transit use fall', () => {
    const st = state();
    st.unlocked.add('honour_scholar_city');
    st.unlocked.add('honour_transit_capital');
    st.stats.population = 0;
    st.stats.eq = 0;
    st.stats.tripsTransit = 0;
    expect(readEffects(st).eduEffect).toBe(1.05);
    expect(readEffects(st).transitRidership).toBe(1.05);
  });
});
