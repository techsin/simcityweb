import { describe, expect, it } from 'vitest';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';
import { CITY_SAVE_VERSION, deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { CityState, type NewsItem } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';

function city(): CityState {
  return new CityState(defaultCityConfig({ size: 16, seed: 7 }));
}

describe('saved news refs', () => {
  it.each(['direct', 'copy', 'structured clone', 'bundle'] as const)('round-trips optional refs through %s saves', (path) => {
    const st = city(), sim = new Simulation(st);
    st.day = 90;
    sim.notify('Zone homes', 'warning', 0, 3, 'planning', { advice: 'zoneR' });
    sim.notify('Place it', 'reward', undefined, undefined, undefined, { reward: 'mayor_house' });
    sim.notify('Both keys', 'info', undefined, undefined, undefined, { advice: 'zoneC', reward: 'statue' });
    sim.notify('Empty metadata', 'info', undefined, undefined, undefined, {});
    sim.notify('Legacy news');
    let saved = serializeCity(st, { copy: path === 'copy' });
    if (path === 'structured clone') saved = structuredClone(saved);
    if (path === 'bundle') saved = decodeBundle(encodeBundle(saved)) as SerializedCity;
    expect(saved.version).toBe(CITY_SAVE_VERSION);
    expect(saved.data.news).toStrictEqual(st.news);
    const loaded = deserializeCity(saved);
    expect(loaded.news).toStrictEqual(st.news);
    expect(Object.hasOwn(loaded.news[4], 'ref')).toBe(false);
    loaded.news[0].ref!.advice = 'changed after load';
    expect((saved.data.news as NewsItem[])[0].ref).toStrictEqual({ advice: 'zoneR' });
    expect(st.news[0].ref).toStrictEqual({ advice: 'zoneR' });
  });

  it('snapshots nested refs independently of later live changes', () => {
    const st = city();
    const n = st.notify('Advice', 'advisor', undefined, undefined, 'planning', { advice: 'zoneR' });
    const saved = serializeCity(st, { copy: true });
    n.ref!.advice = 'zoneC';
    st.notify('Later news');
    const loaded = deserializeCity(saved);
    expect(loaded.news).toHaveLength(1);
    expect(loaded.news[0].ref).toStrictEqual({ advice: 'zoneR' });
  });

  it('loads and re-saves old news without adding refs or changing the format version', () => {
    const saved = serializeCity(city());
    saved.version = 1;
    const legacy: NewsItem[] = [
      { day: 12, text: 'Old advice', kind: 'advisor', x: 0, z: 2, advisor: 'planning' },
      { day: 13, text: 'Old reward', kind: 'reward' },
    ];
    saved.data.news = legacy;
    const loaded = deserializeCity(saved);
    expect(loaded.news).toStrictEqual(legacy);
    for (const n of loaded.news) expect(Object.hasOwn(n, 'ref')).toBe(false);
    const again = serializeCity(loaded, { copy: true });
    expect(again.version).toBe(1);
    expect(again.data.news).toStrictEqual(legacy);
  });
});
