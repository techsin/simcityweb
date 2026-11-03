/**
 * B3 A1 (docs/dev/B3_DESIGN.md §3.2): on the second month-scan day (29) the advisors predict the coming month tick's
 * announcements with the tick's own test and look their "Show me" places up then (AdvisorData.scan.places); the tick
 * posts a predicted place without a lookup. The prediction is read-only, saved with the city, and a scan without places
 * is looked up on the tick, as before.
 */
import { describe, expect, it, vi } from 'vitest';
import * as approval from '../../src/sim/economy/approval';
import type { CityState, NeedTier } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { MONTH_SCAN_DAYS, advisorData, advisorsSystem, openAdvice, type AdvisorsSystem } from '../../src/sim/economy/advisors';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { newState } from '../infra/cityGen';

type Clusters = Partial<Record<NeedTier, { x: number; z: number; people: number }[]>>;
/** a city with only the advisors system and a fake services system serving `clusters` (and counting the lookups) */
function game(clusters: Clusters, st?: CityState) {
  if (!st) {
    st = newState(64);
    st.systemData.infraVersion = 1; // infra layers "present": the services rules are on
    st.stats.population = 20000;
    st.stats.needs.elementary = { need: 4000, served: 2500, capacity: 2600, unreached: 800, overcrowded: 0 };
  }
  const calls = { n: 0 };
  const services = {
    name: 'services',
    clustersOf: (t: NeedTier, max: number) => { calls.n++; return (clusters[t] ?? []).slice(0, max); },
    facilityLoadOf: () => null,
  } as unknown as SimSystem;
  const adv = advisorsSystem(new EconRuntime());
  const sim = new Simulation(st, [services, adv]);
  const g = {
    st, sim, adv: adv as AdvisorsSystem, calls,
    /** the advisors' daily of day d */
    day: (d: number) => { st!.day = d; adv.daily!(sim); },
    /** the month tick of day d (a multiple of 30) */
    tick: (d: number) => { st!.day = d; adv.monthly!(sim); },
    /** the news the tick of day d posted */
    posted: (d: number) => st!.news.filter((n) => n.day === d).map((n) => ({ text: n.text, x: n.x, z: n.z })),
  };
  return g;
}
const load = (ser: SerializedCity, clusters: Clusters) => game(clusters, deserializeCity(structuredClone(ser)));
const SCHOOL = /^800 children have no elementary school/;

describe('B3 A1: the coming tick\'s announcements predicted on day 29, their places looked up then', () => {
  it('day 29 stores the predicted place of a lazy-place rule; the tick posts it without a lookup', () => {
    const clusters: Clusters = { elementary: [{ x: 40, z: 44, people: 900 }] };
    const g = game(clusters);
    g.day(MONTH_SCAN_DAYS[0]);
    expect(advisorData(g.st).scan?.places).toBeUndefined();
    g.day(MONTH_SCAN_DAYS[1]);
    expect(advisorData(g.st).scan?.places).toEqual({ noElementary: [40, 44] });
    expect(g.calls.n).toBe(1);
    // the cluster moves before the tick: the tick posts the place of day 29, and looks nothing up
    clusters.elementary = [{ x: 10, z: 12, people: 900 }];
    g.calls.n = 0;
    g.tick(30);
    const n = g.posted(30).filter((p) => SCHOOL.test(p.text));
    expect(n).toEqual([{ text: n[0].text, x: 40, z: 44 }]);
    expect(g.calls.n).toBe(0);
    expect(advisorData(g.st).scan).toBeUndefined();
    // a predicted "nowhere" ([-1, -1]) posts no place, as a lookup that finds nothing; the Advisors panel looks it up
    const h = game({});
    h.day(MONTH_SCAN_DAYS[0]);
    h.day(MONTH_SCAN_DAYS[1]);
    expect(advisorData(h.st).scan?.places).toEqual({ noElementary: [-1, -1] });
    h.tick(30);
    const m = h.posted(30).filter((p) => SCHOOL.test(p.text));
    expect(m.length).toBe(1);
    expect([m[0].x, m[0].z]).toEqual([undefined, undefined]);
  });

  it('the prediction is read-only: city data, news and the random stream unchanged, no resident survey; none without a zone scan', () => {
    const g = game({ elementary: [{ x: 40, z: 44, people: 900 }] });
    g.day(MONTH_SCAN_DAYS[0]);
    g.day(MONTH_SCAN_DAYS[1]);
    g.sim.rng.next(); // (a random stream with a saved state)
    const before = structuredClone({ sd: g.st.systemData, news: g.st.news, stats: g.st.stats, budget: g.st.budget, day: g.st.day });
    const spy = vi.spyOn(approval, 'residentSurvey');
    try {
      // (the spy sees the advisors' survey: the Advisors panel's gather takes it)
      openAdvice(g.sim);
      expect(spy).toHaveBeenCalled();
      spy.mockClear();
      const s1 = structuredClone({ sd: g.st.systemData, news: g.st.news, stats: g.st.stats, budget: g.st.budget, day: g.st.day });
      expect(g.adv.predictPlaces(g.st)).toEqual({ noElementary: [40, 44] });
      expect(spy).not.toHaveBeenCalled();
      expect(structuredClone({ sd: g.st.systemData, news: g.st.news, stats: g.st.stats, budget: g.st.budget, day: g.st.day })).toStrictEqual(s1);
      expect(s1).toStrictEqual(before);
    } finally {
      spy.mockRestore();
    }
    // without the day-28 zone scan (an older save loaded after day 28) nothing is predicted: no scan on day 29
    delete advisorData(g.st).scan!.zone;
    expect(g.adv.predictPlaces(g.st)).toEqual({});
    // the tick posts the same news either way
    g.tick(30);
    expect(g.posted(30).filter((p) => SCHOOL.test(p.text)).map((p) => [p.x, p.z])).toEqual([[40, 44]]);
  });

  it('saves on day 28 and day 29 post the uninterrupted game\'s news on the tick; without places the tick looks them up', () => {
    const clusters: Clusters = { elementary: [{ x: 40, z: 44, people: 900 }] };
    const a = game(clusters);
    a.day(MONTH_SCAN_DAYS[0]);
    const s28 = serializeCity(a.st, { copy: true });
    a.day(MONTH_SCAN_DAYS[1]);
    const s29 = serializeCity(a.st, { copy: true });
    const places = structuredClone(advisorData(a.st).scan!.places);
    a.tick(30);
    const ref = a.posted(30);
    expect(ref.some((p) => SCHOOL.test(p.text) && p.x === 40 && p.z === 44)).toBe(true);
    // the day-28 save predicts on day 29 itself; the day-29 save carries the places
    const b = load(s28, clusters);
    b.day(MONTH_SCAN_DAYS[1]);
    expect(advisorData(b.st).scan!.places).toEqual(places);
    b.tick(30);
    expect(b.posted(30)).toEqual(ref);
    const c = load(s29, clusters);
    expect(advisorData(c.st).scan!.places).toEqual(places);
    c.calls.n = 0;
    c.tick(30);
    expect(c.posted(30)).toEqual(ref);
    expect(c.calls.n).toBe(0);
    // a save without places (an older version): the tick looks the place up — in a steady city, the same one
    const d = load(s29, clusters);
    delete advisorData(d.st).scan!.places;
    d.calls.n = 0;
    d.tick(30);
    expect(d.posted(30)).toEqual(ref);
    expect(d.calls.n).toBe(1);
    // a corrupt record is looked up too
    const e = load(s29, clusters);
    (advisorData(e.st).scan!.places as Record<string, unknown>).noElementary = 'here';
    e.tick(30);
    expect(e.posted(30)).toEqual(ref);
  });
});
