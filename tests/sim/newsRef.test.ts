import { describe, expect, it } from 'vitest';
import { CityState, type NewsItem } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';

function city(): CityState {
  return new CityState(defaultCityConfig({ size: 16, seed: 7 }));
}

describe('news refs', () => {
  it('emits the stored advice and reward refs independently of the headline', () => {
    const st = city(), sim = new Simulation(st);
    st.day = 30;
    const received: NewsItem[] = [];
    const off = sim.events.on('news', (n) => received.push(n));
    try {
      sim.notify('Original wording', 'warning', 0, 4, 'planning', { advice: 'zoneR' });
      sim.notify('Reworded advice', 'warning', 0, 4, 'planning', { advice: 'zoneR' });
      sim.notify('A gift from the citizens', 'reward', undefined, undefined, undefined, { reward: 'mayor_house' });
    } finally { off(); }
    expect(received).toStrictEqual([
      { day: 30, text: 'Original wording', kind: 'warning', x: 0, z: 4, advisor: 'planning', ref: { advice: 'zoneR' } },
      { day: 30, text: 'Reworded advice', kind: 'warning', x: 0, z: 4, advisor: 'planning', ref: { advice: 'zoneR' } },
      { day: 30, text: 'A gift from the citizens', kind: 'reward', x: undefined, z: undefined, advisor: undefined, ref: { reward: 'mayor_house' } },
    ]);
    received.forEach((n, i) => expect(n).toBe(st.news[i]));
  });

  it('keeps legacy calls unchanged, including absent ref keys and the RNG state', () => {
    const st = city(), sim = new Simulation(st);
    const rng = sim.rng.state;
    const systemData = structuredClone(st.systemData);
    st.notify('Default news');
    sim.notify('Located news', 'advisor', 2, 3, 'utilities');
    sim.notify('Explicitly absent', 'good', undefined, undefined, undefined, undefined);
    expect(st.news).toStrictEqual([
      { day: 0, text: 'Default news', kind: 'info', x: undefined, z: undefined, advisor: undefined },
      { day: 0, text: 'Located news', kind: 'advisor', x: 2, z: 3, advisor: 'utilities' },
      { day: 0, text: 'Explicitly absent', kind: 'good', x: undefined, z: undefined, advisor: undefined },
    ]);
    for (const n of st.news) expect(Object.hasOwn(n, 'ref')).toBe(false);
    sim.notify('With metadata', 'info', undefined, undefined, undefined, { advice: 'zoneR' });
    expect(sim.rng.state).toBe(rng);
    expect(st.systemData).toStrictEqual(systemData);
    expect(st.day).toBe(0);
  });

  it('keeps posted refs stable when the caller reuses its metadata', () => {
    const st = city();
    const ref = { advice: 'zoneR', reward: 'mayor_house' };
    const first = st.notify('First item', 'info', undefined, undefined, undefined, ref);
    ref.advice = 'zoneC';
    ref.reward = 'statue';
    const second = st.notify('Next item', 'info', undefined, undefined, undefined, ref);
    expect(first.ref).toStrictEqual({ advice: 'zoneR', reward: 'mayor_house' });
    expect(second.ref).toStrictEqual({ advice: 'zoneC', reward: 'statue' });
  });
});
