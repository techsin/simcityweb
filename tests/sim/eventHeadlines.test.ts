import { describe, expect, it } from 'vitest';
import { BF, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { advisorData, advisorsSystem } from '../../src/sim/economy/advisors';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { EVENT_HEADLINES, EventHeadlineFeed, headlineHash, queueEventHeadline,
  type EventHeadlineData, type EventHeadlineStore, type EventHeadlineType } from '../../src/sim/economy/eventHeadlines';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { newState, place } from '../infra/cityGen';

const empty = (): EventHeadlineData => ({ pending: [], triggered: {}, shown: {}, firsts: [], parks: 0 });
const eventNews = (st: CityState) => st.news.filter((n) => n.advisor === 'news');

function city(seed = 7, st = newState(64)) {
  st.config.seed = seed;
  const adv = advisorsSystem(new EconRuntime());
  const sim = new Simulation(st, [adv]);
  const run = (from: number, to = from) => {
    for (let day = from; day <= to; day++) { st.day = day; adv.daily!(sim); }
  };
  return { st, sim, adv, run };
}

describe('FEEL-20 event headlines', () => {
  it('posts a landmark opening 1–10 days later in each of ten seeded cities', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const c = city(seed);
      c.st.day = 20;
      const b = place(c.st, 'lm_clock_tower', 10, 11, { flags: BF.Plopped });
      c.sim.events.emit('buildingAdded', b);
      expect(eventNews(c.st)).toEqual([]);
      c.run(21, 30);
      const news = eventNews(c.st).filter((n) => /new postcard view/.test(n.text));
      expect(news, `seed ${seed}`).toHaveLength(1);
      expect(news[0].day).toBeGreaterThan(20);
      expect(news[0].day).toBeLessThanOrEqual(30);
      expect([news[0].x, news[0].z]).toEqual([b.x + (b.w >> 1), b.z + (b.d >> 1)]);
    }
  });

  it('waits for construction to complete, and repeated changes never reopen the same building', () => {
    const c = city();
    const b = place(c.st, 'lm_clock_tower', 10, 10, { built: 0.2, flags: BF.Plopped | BF.Constructing });
    c.sim.events.emit('buildingAdded', b);
    c.run(1, 12);
    expect(eventNews(c.st)).toEqual([]);
    b.built = 1; b.flags &= ~BF.Constructing;
    c.sim.events.emit('buildingChanged', b);
    for (let i = 0; i < 5; i++) c.sim.events.emit('buildingChanged', b);
    c.run(13, 23);
    expect(eventNews(c.st).filter((n) => /new postcard view/.test(n.text))).toHaveLength(1);
    const burnt = place(c.st, 'lm_arch', 20, 20, { flags: BF.Plopped | BF.Burnt });
    c.sim.events.emit('buildingAdded', burnt);
    c.run(24, 34);
    expect(eventNews(c.st).filter((n) => /new postcard view/.test(n.text))).toHaveLength(1);
  });

  it('turns repeated notices of one blackout into exactly one headline, with a rolling-year cooldown', () => {
    const c = city();
    for (let day = 0; day < 30; day++) {
      c.st.day = day;
      c.sim.notify('Blackout: 18 buildings lost power.', 'bad', 12, 13, 'utilities');
      c.adv.daily!(c.sim);
    }
    c.run(30, 359);
    const first = eventNews(c.st).filter((n) => n.text === EVENT_HEADLINES.blackout);
    expect(first).toHaveLength(1);
    expect([first[0].x, first[0].z]).toEqual([12, 13]);
    c.st.day = first[0].day + 360;
    c.sim.notify('Blackout: 5 buildings lost power.', 'bad', 22, 23, 'utilities');
    c.run(c.st.day + 1, c.st.day + 10);
    const both = eventNews(c.st).filter((n) => n.text === EVENT_HEADLINES.blackout);
    expect(both).toHaveLength(2);
    expect(both[1].day - both[0].day).toBeGreaterThanOrEqual(360);
  });

  it('has 26 distinct event types and never repeats their text within 360 days', () => {
    const st = newState(64), sim = new Simulation(st), feed = new EventHeadlineFeed();
    feed.init(sim);
    const data = empty(), store: EventHeadlineStore = { events: data, shown: {} };
    st.systemData.advisors = store;
    const types = Object.keys(EVENT_HEADLINES) as EventHeadlineType[];
    expect(types).toHaveLength(26);
    expect(new Set(Object.values(EVENT_HEADLINES)).size).toBe(26);
    const seen = new Map<string, number>();
    sim.events.on('news', (n) => {
      const previous = seen.get(n.text);
      if (previous !== undefined) expect(n.day - previous, n.text).toBeGreaterThanOrEqual(360);
      seen.set(n.text, n.day);
    });
    for (let day = 0; day < 750; day++) {
      st.day = day;
      for (const type of types) queueEventHeadline(data, day, 7, type, 'City Hall');
      feed.daily(sim, store);
    }
    expect(seen.size).toBe(26);
  });

  it('hashes repeatably and makes no simulation RNG draws while queuing or posting', () => {
    expect(headlineHash(37, 'landmark', 7)).toBe(headlineHash(37, 'landmark', 7));
    expect(headlineHash(37, 'landmark', 7)).not.toBe(headlineHash(37, 'park', 7));
    const c = city();
    const before = c.sim.rng.state;
    const b = place(c.st, 'lm_clock_tower', 10, 10, { flags: BF.Plopped });
    c.sim.events.emit('buildingAdded', b);
    c.sim.notify('Blackout: 2 buildings lost power.', 'bad', undefined, undefined, 'utilities');
    c.run(1, 20);
    expect(c.sim.rng.state).toBe(before);
    expect(eventNews(c.st)).toHaveLength(2);
  });

  it('keeps the normal flavor schedule and its RNG draws with and without event news', () => {
    const a = city(7), b = city(7);
    a.st.stats.population = b.st.stats.population = 1000;
    const landmark = place(a.st, 'lm_clock_tower', 10, 10, { flags: BF.Plopped });
    a.sim.events.emit('buildingAdded', landmark);
    for (let day = 1; day <= 130; day++) {
      a.run(day); b.run(day);
      expect(a.sim.rng.state, `day ${day}`).toBe(b.sim.rng.state);
      expect(advisorData(a.st).nextHeadline, `day ${day}`).toBe(advisorData(b.st).nextHeadline);
    }
  });

  it('persists an opening saved while paused before the first daily advisor pass', () => {
    const live = city();
    expect(live.st.systemData.advisors).toBeUndefined();
    const b = place(live.st, 'lm_clock_tower', 10, 10, { flags: BF.Plopped });
    live.sim.events.emit('buildingAdded', b);
    const partial = live.st.systemData.advisors as Partial<EventHeadlineStore>;
    expect(partial.events?.pending).toHaveLength(1);
    expect((partial as { nextHeadline?: number }).nextHeadline).toBeUndefined();
    const loaded = city(7, deserializeCity(structuredClone(serializeCity(live.st, { copy: true }))));
    live.run(1, 15); loaded.run(1, 15);
    expect(eventNews(loaded.st)).toEqual(eventNews(live.st));
    expect(eventNews(loaded.st)).toHaveLength(1);
    expect(advisorData(loaded.st).events).toEqual(advisorData(live.st).events);
    expect(advisorData(loaded.st).nextHeadline).toBe(45);
  });

  it('preserves pending JSON state and an older city’s original first-headline day', () => {
    const live = city();
    live.st.day = 123;
    const b = place(live.st, 'lm_clock_tower', 10, 10, { flags: BF.Plopped });
    live.sim.events.emit('buildingAdded', b);
    const saved = serializeCity(live.st, { copy: true });
    const loaded = city(7, deserializeCity(structuredClone(saved)));
    live.run(124, 140); loaded.run(124, 140);
    expect(eventNews(loaded.st)).toEqual(eventNews(live.st));
    expect(advisorData(loaded.st).nextHeadline).toBe(154);
    expect(advisorData(loaded.st).events).toEqual(JSON.parse(JSON.stringify(advisorData(live.st).events)));
  });

  it('silently baselines an old save and does not replay completed openings or first homes', () => {
    const st = newState(64);
    const landmark = place(st, 'lm_clock_tower', 10, 10, { flags: BF.Plopped });
    const home = place(st, 't_r1', 20, 20);
    const c = city(7, st);
    c.sim.events.emit('buildingChanged', landmark);
    c.sim.events.emit('buildingChanged', home);
    const secondHome = place(st, 't_r1', 22, 20);
    c.sim.events.emit('buildingAdded', secondHome);
    c.run(1, 20);
    expect(eventNews(st)).toEqual([]);
    expect(advisorData(st).events?.firsts).toContain('firstHome');
  });

  it('announces actual residential/commercial towers independently of their family, never a high-tech campus', () => {
    const c = city();
    const campus = place(c.st, 'ind_tech_campus.iht.6', 4, 4);
    c.sim.events.emit('buildingAdded', campus);
    c.run(1, 12);
    expect(eventNews(c.st).map((n) => n.text)).toEqual([EVENT_HEADLINES.firstFactory]);
    const tower = place(c.st, 'res_tower.r2.6', 20, 20);
    c.sim.events.emit('buildingAdded', tower);
    c.run(13, 25);
    expect(eventNews(c.st).map((n) => n.text)).toEqual(expect.arrayContaining([EVENT_HEADLINES.firstHome, EVENT_HEADLINES.firstTower]));
    const old = newState(64);
    place(old, 'com_office_tower.co2.6', 20, 20);
    const loaded = city(7, old);
    const shop = place(old, 't_cs', 30, 30);
    loaded.sim.events.emit('buildingAdded', shop);
    loaded.run(1, 15);
    expect(eventNews(old)).toEqual([]);
    expect(advisorData(old).events?.firsts).toEqual(expect.arrayContaining(['firstShop', 'firstTower']));
  });

  it('never calls the first farm a factory, and still announces the first actual factory', () => {
    const c = city();
    const farm = place(c.st, 'ind_farm_field.ia.1', 4, 4);
    c.sim.events.emit('buildingAdded', farm);
    c.run(1, 12);
    expect(eventNews(c.st).some((n) => n.text === EVENT_HEADLINES.firstFactory)).toBe(false);
    const factory = place(c.st, 't_id', 20, 20);
    c.sim.events.emit('buildingAdded', factory);
    c.run(13, 24);
    expect(eventNews(c.st).filter((n) => n.text === EVENT_HEADLINES.firstFactory)).toHaveLength(1);
  });

  it('tells Gerald’s repair and plaque stories in order after the original bag story', () => {
    const c = city();
    advisorData(c.st).shown.gerald = 0;
    c.sim.events.emit('networkChanged', { x0: 4, z0: 4, x1: 6, z1: 6 });
    c.sim.events.emit('networkChanged', { x0: 8, z0: 8, x1: 10, z1: 10 });
    c.run(1, 25);
    const news = eventNews(c.st);
    expect(news.map((n) => n.text)).toEqual([EVENT_HEADLINES.geraldRepair, EVENT_HEADLINES.geraldPlaque]);
    expect(news[1].day - news[0].day).toBeGreaterThanOrEqual(1);
    expect(news[1].day - news[0].day).toBeLessThanOrEqual(10);
    c.sim.events.emit('networkChanged', { x0: 12, z0: 12, x1: 14, z1: 14 });
    c.run(26, 40);
    expect(eventNews(c.st)).toHaveLength(2);
  });

  it('counts the 100th park opening across removals and saves, without replaying removed parks', () => {
    const st = newState(64);
    for (let i = 0; i < 99; i++) place(st, 't_park', 2 + i % 20, 2 + Math.floor(i / 20));
    const c = city(7, st);
    c.run(1);
    const removed = st.buildings.values().next().value!;
    st.buildings.delete(removed.id);
    c.sim.events.emit('buildingRemoved', removed);
    const loaded = city(7, deserializeCity(structuredClone(serializeCity(st, { copy: true }))));
    const park = place(loaded.st, 't_park', 40, 40);
    loaded.sim.events.emit('buildingAdded', park);
    loaded.run(2, 15);
    expect(eventNews(loaded.st).filter((n) => n.text === EVENT_HEADLINES.park100)).toHaveLength(1);
    expect(advisorData(loaded.st).events?.parks).toBe(100);
  });
});
