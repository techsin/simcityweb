/**
 * T096 (POLISH_PLAN FEEL-07's producer): the city records its firsts in systemData.firsts and announces each once, on
 * a news item that carries ref.first (src/sim/economy/firsts.ts; the hunks in CityActions.plop / afterNetworkChange).
 *   - the three kinds: a unique building's first opening, the first neighbour connection, the first completed growable
 *     of stage 6, 7 and 8 (one building may be the first of several stages: one news, the highest);
 *   - once: a rebuilt landmark, a second connection and the next tower post no ref; neither does a loaded game for what
 *     its save had, and every saved game continues like the uninterrupted one (the record is plain saved state: no
 *     save hook, not one of T057's continuity records, kept by a lean recovery snapshot);
 *   - a save from before the record gets one at load, with what its map shows marked as had, silently;
 *   - nothing else changes: no random draw, and a bot city plays the same with and without the firsts system.
 * The packet hosts (the replica's copy, the news through the recorder, a resync, a journal's replay, the real worker)
 * are in tests/worker/firsts.test.ts.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SimBot } from '../../tools/simbot';
import { Network, Zone } from '../../src/core/types';
import { CityActions, lPath } from '../../src/sim/actions';
import { BF, type Building, type CityState, type NewsItem } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { FIRST_BEFORE, FIRST_STAGES, claimFirst, firstsOf, firstsSystem, type FirstsData } from '../../src/sim/economy/firsts';
import { CONTINUITY_RECORDS } from '../../src/sim/persist';
import { Simulation } from '../../src/sim/Simulation';
import { economySystems } from '../../src/sim/systems/economy';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';
import { applyCityDelta, encodeCityDelta } from '../../src/save/recoveryCodec';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { makeCity, road } from './helpers';

const OPENS = (name: string, city: string) => `${name} opens in ${city}!`;
const CONNECTED = 'New neighbor connection! Trade with the region boosts demand.';
const STAGE = (stage: number, name: string, city: string) => `${city}'s first stage ${stage} building is complete: ${name}.`;

const firsts = (st: CityState) => st.systemData.firsts as FirstsData | undefined;
/** every news item a simulation posts from now on, and those that announce a first */
function watch(sim: Simulation) {
  const all: NewsItem[] = [];
  sim.events.on('news', (n) => all.push(n));
  return { all, firsts: () => all.filter((n) => n.ref?.first !== undefined) };
}
/** a building's centre cell: where its news and its record point */
const at = (b: Pick<Building, 'x' | 'z' | 'w' | 'd'>) => ({ x: b.x + (b.w >> 1), z: b.z + (b.d >> 1) });
/** a growable as growth creates it (under construction), or as `opts` says */
function site(sim: Simulation, defId: string, x: number, z: number, opts: Partial<Building> = {}): Building {
  const st = sim.state, def = getDef(defId)!;
  const [w, d] = def.footprint;
  const b: Building = {
    id: st.nextBuildingId++, def: defId, x, z, w, d, rot: 0, variant: 0, pop: 0, jobs: 0, capacity: def.capacity ?? 0, wealth: 2,
    built: 0, age: 0, flags: BF.Constructing, baseY: 5, health: 0.6, unhappy: 0,
    kids: undefined, teens: undefined, yad: undefined, srs: undefined, wf: undefined, edu: undefined, hire: undefined, ...opts,
  };
  placeBuilding(sim, b);
  return b;
}
/** the last step of the population system's construction (population.ts) */
function complete(sim: Simulation, b: Building): void {
  b.built = 1;
  b.flags &= ~BF.Constructing;
  sim.events.emit('buildingChanged', b);
}
/** a news list without the firsts' refs */
function plain(news: readonly NewsItem[]): NewsItem[] {
  return news.map((n) => {
    if (n.ref?.first === undefined) return n;
    const { first: _first, ...ref } = n.ref;
    const copy: NewsItem = { ...n };
    if (Object.keys(ref).length) copy.ref = ref; else delete copy.ref;
    return copy;
  });
}

// ---- T057's whole-city comparison (tests/save/loadContinuity.test.ts): the city as saved, key by key (savedAt aside)
function canonical(v: unknown): unknown {
  if (ArrayBuffer.isView(v)) {
    const b = new Uint8Array((v as ArrayBufferView).buffer, (v as ArrayBufferView).byteOffset, (v as ArrayBufferView).byteLength);
    return `${v.constructor.name}:${createHash('sha256').update(b).digest('hex')}`;
  }
  if (v instanceof Map) return ['$map', ...[...v.entries()].map(([k, x]) => [canonical(k), canonical(x)])];
  if (Array.isArray(v)) return v.map(canonical);
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : Number.isNaN(v) ? 'NaN' : v;
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  return v;
}
function digest(st: CityState): Record<string, string> {
  const s = serializeCity(st, { copy: true }) as unknown as Record<string, unknown>;
  const out: Record<string, string> = {};
  const add = (k: string, v: unknown) => { out[k] = createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex').slice(0, 16); };
  for (const k of Object.keys(s)) if (k !== 'savedAt' && k !== 'data') add(k, s[k]);
  const data = s.data as Record<string, unknown>;
  for (const k of Object.keys(data)) if (k !== 'systemData' && k !== 'stats') add(`data.${k}`, data[k]);
  const stats = data.stats as Record<string, unknown>;
  for (const k of Object.keys(stats)) add(`stats.${k}`, stats[k]);
  const sd = data.systemData as Record<string, unknown>;
  for (const k of Object.keys(sd)) add(`sd.${k}`, sd[k]);
  return out;
}
const differing = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();

describe('T096: the record', () => {
  it('a new city starts an empty record; a simulation without the firsts system keeps none and posts its news as before', () => {
    const kept = makeCity({ sandbox: true }, [firstsSystem()]);
    expect(kept.st.systemData).toStrictEqual({ firsts: {} });
    expect(firstsOf(kept.st)).toBe(kept.st.systemData.firsts);
    expect(FIRST_STAGES).toEqual([6, 7, 8]);
    // ordinary systemData: no save hook writes it, and it is not one of the records a lean snapshot may leave out
    expect(CONTINUITY_RECORDS).not.toContain('firsts');
    expect((serializeCity(kept.st, { copy: true }).data.systemData as Record<string, unknown>).firsts).toStrictEqual({});

    const bare = makeCity({ sandbox: true }, []);
    expect(bare.A.plop('civ_mayor_house', 10, 10, 0).ok).toBe(true);
    expect(road(bare.A, 0, 30, 10, 30).ok).toBe(true);
    expect(bare.st.news.map((n) => n.text)).toEqual([OPENS("Mayor's House", 'New City'), CONNECTED]);
    for (const n of bare.st.news) expect(Object.hasOwn(n, 'ref')).toBe(false);
    expect(bare.st.systemData).toStrictEqual({});
    expect(firstsOf(bare.st)).toBeUndefined();
    expect(claimFirst(bare.st, 'neighbor', 0, 30)).toBeUndefined();
    expect(bare.st.systemData).toStrictEqual({});
  });

  it('claimFirst records a kind once, with the day, the place and the building it is given', () => {
    const { st } = makeCity({}, [firstsSystem()]);
    st.day = 12;
    expect(claimFirst(st, 'unique:lm_obelisk', 4, 5, 77)).toStrictEqual({ first: 'unique:lm_obelisk' });
    expect(claimFirst(st, 'neighbor', 0, 9)).toStrictEqual({ first: 'neighbor' });
    expect(claimFirst(st, 'stage:6')).toStrictEqual({ first: 'stage:6' });
    st.day = 99;
    expect(claimFirst(st, 'unique:lm_obelisk', 8, 8, 78)).toBeUndefined();
    expect(claimFirst(st, 'neighbor', 1, 1)).toBeUndefined();
    expect(claimFirst(st, 'stage:6', 2, 2, 3)).toBeUndefined();
    expect(firsts(st)).toStrictEqual({ 'unique:lm_obelisk': { day: 12, x: 4, z: 5, id: 77 }, neighbor: { day: 12, x: 0, z: 9 }, 'stage:6': { day: 12 } });
    // a kind named like an Object.prototype member is a kind like any other
    expect(claimFirst(st, 'constructor', 1, 2)).toStrictEqual({ first: 'constructor' });
    expect(claimFirst(st, 'constructor', 1, 2)).toBeUndefined();
  });
});

describe('T096: the firsts the player makes', () => {
  it('the first opening of each unique building carries ref.first at its place, once: a rebuilt one posts the plain news', () => {
    const { st, sim, A } = makeCity({ sandbox: true, name: 'Queensbury' }, [firstsSystem()]);
    const news = watch(sim), rng = sim.rng.state;
    // (the record is written before the item is posted: a listener of the news finds it)
    const seenAtNews: unknown[] = [];
    sim.events.on('news', (n) => { if (n.ref?.first) seenAtNews.push(structuredClone(firsts(st)![n.ref.first])); });
    st.day = 42;
    expect(A.plop('civ_mayor_house', 10, 10, 0, true).ok).toBe(true); // (a preview claims nothing)
    expect(firsts(st)).toStrictEqual({});
    expect(A.plop('civ_mayor_house', 10, 10, 0).ok).toBe(true);
    const house = st.buildingAt(10, 10)!;
    expect(at(house)).toEqual({ x: 11, z: 11 });
    expect(news.all).toStrictEqual([
      { day: 42, text: OPENS("Mayor's House", 'Queensbury'), kind: 'good', x: 11, z: 11, advisor: 'planning', ref: { first: 'unique:civ_mayor_house' } },
    ]);
    const record = { 'unique:civ_mayor_house': { day: 42, x: 11, z: 11, id: house.id } };
    expect(firsts(st)).toStrictEqual(record);
    expect(seenAtNews).toStrictEqual([record['unique:civ_mayor_house']]);

    // demolished and built again elsewhere: the opening news as it always was, and the record keeps the first
    st.day = 50;
    expect(A.bulldoze({ x0: 10, z0: 10, x1: 12, z1: 12 }).ok).toBe(true);
    expect(A.plop('civ_mayor_house', 20, 20, 1).ok).toBe(true);
    expect(news.all[1]).toStrictEqual({ day: 50, text: OPENS("Mayor's House", 'Queensbury'), kind: 'good', x: 21, z: 21, advisor: 'planning' });
    expect(Object.hasOwn(news.all[1], 'ref')).toBe(false);
    expect(firsts(st)).toStrictEqual(record);

    // another unique building is its own first
    st.day = 60;
    expect(A.plop('lm_clock_tower', 30, 30, 0).ok).toBe(true);
    expect(news.all[2]).toStrictEqual({ day: 60, text: OPENS('Clock Tower', 'Queensbury'), kind: 'good', x: 30, z: 30, advisor: 'planning', ref: { first: 'unique:lm_clock_tower' } });
    // a unique building that has no opening news (a park: the stadium) and a civic one that is not unique (the cemetery)
    // post nothing, as before, and are no firsts
    expect(A.plop('park_stadium', 40, 4, 0).ok).toBe(true);
    expect(A.plop('civ_cemetery', 4, 40, 0).ok).toBe(true);
    expect(news.all).toHaveLength(3);
    expect(firsts(st)).toStrictEqual({ ...record, 'unique:lm_clock_tower': { day: 60, x: 30, z: 30, id: st.buildingAt(30, 30)!.id } });
    expect(seenAtNews).toHaveLength(2);
    // no random draw, and nothing else written
    expect(sim.rng.state).toBe(rng);
    expect(Object.keys(st.systemData)).toEqual(['firsts']);
  });

  it('the first neighbour connection carries ref.first at the connection, once', () => {
    const { st, sim, A } = makeCity({ sandbox: true }, [firstsSystem()]);
    const news = watch(sim), rng = sim.rng.state;
    st.day = 7;
    expect(A.buildNetwork(lPath({ x: 0, z: 30 }, { x: 10, z: 30 }), Network.Road, true).ok).toBe(true); // (a preview claims nothing)
    expect(firsts(st)).toStrictEqual({});
    expect(road(A, 0, 30, 10, 30).ok).toBe(true);
    expect(st.neighborConnections).toHaveLength(1);
    const c = st.neighborConnections[0];
    expect([c.edge, c.x, c.z]).toEqual(['w', 0, 30]);
    expect(news.all).toStrictEqual([{ day: 7, text: CONNECTED, kind: 'good', x: 0, z: 30, advisor: 'transport', ref: { first: 'neighbor' } }]);
    expect(firsts(st)).toStrictEqual({ neighbor: { day: 7, x: 0, z: 30 } });

    // a second connection: the news as it always was
    st.day = 9;
    expect(road(A, 30, 0, 30, 10, Network.Highway).ok).toBe(true);
    expect(st.neighborConnections).toHaveLength(2);
    expect(news.all).toHaveLength(2);
    expect(news.all[1]).toStrictEqual({ day: 9, text: CONNECTED, kind: 'good', x: st.neighborConnections.at(-1)!.x, z: st.neighborConnections.at(-1)!.z, advisor: 'transport' });
    // the city loses every connection and connects again: it had its first
    st.day = 20;
    expect(A.bulldoze({ x0: 0, z0: 30, x1: 1, z1: 31 }).ok).toBe(true);
    expect(A.bulldoze({ x0: 30, z0: 0, x1: 31, z1: 1 }).ok).toBe(true);
    expect(st.neighborConnections).toHaveLength(0);
    expect(road(A, 0, 30, 1, 30).ok).toBe(true);
    expect(st.neighborConnections).toHaveLength(1);
    expect(news.all).toHaveLength(3);
    expect(Object.hasOwn(news.all[2], 'ref')).toBe(false);
    expect(firsts(st)).toStrictEqual({ neighbor: { day: 7, x: 0, z: 30 } });
    expect(sim.rng.state).toBe(rng);
    expect(Object.keys(st.systemData)).toEqual(['firsts']);
  });
});

describe('T096: the firsts the city grows', () => {
  it('the first completed growable of stage 6, 7 and 8 is announced at the building, once per stage', () => {
    const { st, sim } = makeCity({ name: 'Queensbury' }, [firstsSystem()]);
    const news = watch(sim), rng = sim.rng.state;
    // a stage 5 block completes: no first
    st.day = 10;
    complete(sim, site(sim, 'res_tenement.r1.5', 2, 2));
    // a stage 6 tower rises: nothing until it is complete
    const a = site(sim, 'res_tower.r2.6', 10, 2);
    a.built = 0.5;
    sim.events.emit('buildingChanged', a);
    expect(news.all).toEqual([]);
    expect(firsts(st)).toStrictEqual({});
    st.day = 33;
    complete(sim, a);
    expect(news.all).toStrictEqual([
      { day: 33, text: STAGE(6, 'Residential Tower', 'Queensbury'), kind: 'good', x: 11, z: 3, advisor: 'news', ref: { first: 'stage:6' } },
    ]);
    expect(firsts(st)).toStrictEqual({ 'stage:6': { day: 33, x: 11, z: 3, id: a.id } });
    // what happens to that tower later, and the next stage 6 buildings, are no news
    a.flags |= BF.Abandoned;
    sim.events.emit('buildingChanged', a);
    st.day = 40;
    complete(sim, site(sim, 'com_mall.cs2.6', 20, 2));
    expect(news.all).toHaveLength(1);
    // stage 7, then stage 8
    st.day = 80;
    const b = site(sim, 'com_skyscraper.co3.7', 30, 2);
    complete(sim, b);
    st.day = 200;
    const c = site(sim, 'com_megatower.co3.8', 40, 2);
    complete(sim, c);
    expect(news.all.slice(1)).toStrictEqual([
      { day: 80, text: STAGE(7, 'Skyscraper', 'Queensbury'), kind: 'good', ...at(b), advisor: 'news', ref: { first: 'stage:7' } },
      { day: 200, text: STAGE(8, 'Megatower', 'Queensbury'), kind: 'good', ...at(c), advisor: 'news', ref: { first: 'stage:8' } },
    ]);
    expect(firsts(st)).toStrictEqual({
      'stage:6': { day: 33, x: 11, z: 3, id: a.id }, 'stage:7': { day: 80, ...at(b), id: b.id }, 'stage:8': { day: 200, ...at(c), id: c.id },
    });
    // every stage had: the next towers are no news
    st.day = 300;
    complete(sim, site(sim, 'res_supertall.r3.8', 2, 20));
    complete(sim, site(sim, 'res_tower.r2.7', 10, 20));
    expect(news.all).toHaveLength(3);
    expect(sim.rng.state).toBe(rng);
    expect(Object.keys(st.systemData)).toEqual(['firsts']);
  });

  it('a building that is the first of several stages records them all and announces the highest', () => {
    // a city whose first tower is a stage 7 one (high-density land zoned after 90,000 residents)
    const seven = makeCity({ name: 'Queensbury' }, [firstsSystem()]);
    const news7 = watch(seven.sim);
    seven.st.day = 500;
    const b = site(seven.sim, 'res_tower.r2.7', 10, 10);
    complete(seven.sim, b);
    expect(news7.all).toStrictEqual([
      { day: 500, text: STAGE(7, 'Residential Tower', 'Queensbury'), kind: 'good', x: 11, z: 11, advisor: 'news', ref: { first: 'stage:7' } },
    ]);
    const rec = { day: 500, x: 11, z: 11, id: b.id };
    expect(firsts(seven.st)).toStrictEqual({ 'stage:6': rec, 'stage:7': rec });
    // a stage 6 building after it is no first; a stage 8 one is
    seven.st.day = 600;
    complete(seven.sim, site(seven.sim, 'res_tower.r2.6', 20, 10));
    expect(news7.all).toHaveLength(1);
    const c = site(seven.sim, 'res_twin_towers.r2.8', 30, 10);
    complete(seven.sim, c);
    expect(news7.firsts().map((n) => n.ref!.first)).toEqual(['stage:7', 'stage:8']);
    expect(firsts(seven.st)).toStrictEqual({ 'stage:6': rec, 'stage:7': rec, 'stage:8': { day: 600, ...at(c), id: c.id } });

    // ... and one whose first is a supertall: one news for the three
    const eight = makeCity({ name: 'Queensbury' }, [firstsSystem()]);
    const news8 = watch(eight.sim);
    const d = site(eight.sim, 'res_supertall.r3.8', 10, 10);
    complete(eight.sim, d);
    expect(news8.all.map((n) => [n.text, n.ref])).toEqual([[STAGE(8, 'Supertall Residences', 'Queensbury'), { first: 'stage:8' }]]);
    expect(Object.keys(firsts(eight.st)!)).toEqual(['stage:6', 'stage:7', 'stage:8']);
    for (const k of ['stage:6', 'stage:7', 'stage:8']) expect(firsts(eight.st)![k]).toStrictEqual({ day: 0, ...at(d), id: d.id });
  });

  it('rubble, a building placed by the player and one still under construction are no stage firsts', () => {
    const { st, sim } = makeCity({ sandbox: true }, [firstsSystem()]);
    const news = watch(sim);
    // a tower that burnt down while it was built
    const burnt = site(sim, 'res_tower.r2.6', 4, 4);
    burnt.flags |= BF.Burnt;
    complete(sim, burnt);
    // (no growable def can be plopped: a plopped building with a stage does not exist in the game; the flag alone tells)
    site(sim, 'res_tower.r2.7', 10, 4, { built: 1, flags: BF.Plopped });
    const rising = site(sim, 'res_tower.r2.6', 16, 4);
    rising.built = 0.75;
    sim.events.emit('buildingChanged', rising);
    expect(news.all).toEqual([]);
    expect(firsts(st)).toStrictEqual({});
    // a growable added complete (no construction) counts at once
    const whole = site(sim, 'res_luxury_tower.r3.6', 24, 4, { built: 1, flags: 0 });
    expect(news.firsts().map((n) => [n.ref!.first, n.x, n.z])).toEqual([['stage:6', at(whole).x, at(whole).z]]);
    expect(firsts(st)).toStrictEqual({ 'stage:6': { day: 0, ...at(whole), id: whole.id } });
  });

  it('through the population system: a stage 6 tower it completes is announced on that day, and only then', () => {
    const { st, sim, A } = makeCity({ name: 'Queensbury' });
    expect(sim.systems.map((s) => s.name)).toContain('economy.firsts');
    expect(firsts(st)).toStrictEqual({});
    st.funds = 1e6;
    expect(road(A, 4, 12, 24, 12).ok).toBe(true);
    expect(A.zone({ x0: 4, z0: 8, x1: 24, z1: 12 }, Zone.ResHigh).ok).toBe(true);
    const news = watch(sim);
    const b = site(sim, 'res_tower.r2.6', 8, 10); // (its front row z = 11 faces the road)
    let done = -1;
    for (let k = 0; k < 60 && done < 0; k++) {
      expect(news.firsts(), `day ${st.day}`).toEqual([]);
      sim.advanceDay();
      if (b.built >= 1) done = st.day;
    }
    // (construction: 8 + 4 a stage + 0..5 days, population.ts constructionDays)
    expect(done).toBeGreaterThanOrEqual(32);
    expect(done).toBeLessThanOrEqual(38);
    expect(news.firsts()).toStrictEqual([
      { day: done, text: STAGE(6, 'Residential Tower', 'Queensbury'), kind: 'good', x: 9, z: 11, advisor: 'news', ref: { first: 'stage:6' } },
    ]);
    expect(firsts(st)).toStrictEqual({ 'stage:6': { day: done, x: 9, z: 11, id: b.id } });
    sim.runDays(90);
    expect(news.firsts()).toHaveLength(1);
    expect(firsts(st)).toStrictEqual({ 'stage:6': { day: done, x: 9, z: 11, id: b.id } });
  });
});

describe('T096: saves', () => {
  it('a save from before the record: what its map shows is marked as had, silently, and the rest is still announced', () => {
    // an old city (no firsts system ran): a stage 7 tower and the ruin of a stage 6 one, a stage 6 and a stage 8 tower
    // under construction, a City Hall, a road to the map edge
    const old = makeCity({ sandbox: true, name: 'Queensbury' }, []);
    site(old.sim, 'res_tower.r2.7', 4, 4, { built: 1, flags: BF.Abandoned, age: 900 });
    site(old.sim, 'res_tower.r2.6', 8, 4, { built: 1, flags: BF.Burnt, age: 900 });
    const rising6 = site(old.sim, 'res_tower.r2.6', 12, 4, { built: 0.4 });
    const rising8 = site(old.sim, 'res_supertall.r3.8', 16, 4, { built: 0.4 });
    expect(old.A.plop('civ_city_hall', 30, 30, 0).ok).toBe(true);
    expect(old.A.plop('park_stadium', 40, 4, 0).ok).toBe(true);
    expect(road(old.A, 0, 50, 10, 50).ok).toBe(true);
    old.st.day = 3000;
    old.sim.rng.next();
    const saved = serializeCity(old.st, { copy: true });
    expect(Object.keys(saved.data.systemData as object)).toEqual(['simRng']);
    const had = { day: FIRST_BEFORE };

    for (const how of ['a new simulation', 'replaceState'] as const) {
      const st = deserializeCity(structuredClone(saved));
      let sim: Simulation;
      if (how === 'a new simulation') sim = new Simulation(st, [firstsSystem()]);
      else {
        // (the simulation played another city before: its record is that city's own)
        const other = makeCity({ sandbox: true }, [firstsSystem()]);
        expect(road(other.A, 0, 20, 10, 20).ok).toBe(true);
        expect(firsts(other.st)).toStrictEqual({ neighbor: { day: 0, x: 0, z: 20 } });
        sim = other.sim;
        sim.replaceState(st);
        expect(firsts(other.st)).toStrictEqual({ neighbor: { day: 0, x: 0, z: 20 } });
      }
      // every unique building on the map (the stadium has no opening news: marked all the same), the stages up to the
      // highest completed tower (rubble counts: the city had it), the connection
      expect(firsts(st), how).toStrictEqual({
        'unique:civ_city_hall': had, 'unique:park_stadium': had, 'stage:6': had, 'stage:7': had, neighbor: had,
      });
      // silently: no news, no random draw, nothing else written
      expect(st.news, how).toStrictEqual(saved.data.news);
      expect(st.systemData.simRng, how).toBe((saved.data.systemData as Record<string, unknown>).simRng);
      expect(Object.keys(st.systemData).sort(), how).toEqual(['firsts', 'simRng']);

      const news = watch(sim), A = new CityActions(sim);
      const b6 = st.buildings.get(rising6.id)!, b8 = st.buildings.get(rising8.id)!;
      // what the city had is not announced: the stage 6 tower completes, the City Hall is rebuilt, a second road reaches
      // the edge
      st.day = 3010;
      complete(sim, b6);
      expect(A.bulldoze({ x0: 30, z0: 30, x1: 34, z1: 34 }).ok).toBe(true);
      expect(A.plop('civ_city_hall', 30, 30, 0).ok).toBe(true);
      expect(road(A, 50, 0, 50, 10).ok).toBe(true);
      expect(news.all.map((n) => n.text), how).toEqual([OPENS('City Hall', 'Queensbury'), CONNECTED]);
      expect(news.firsts(), how).toEqual([]);
      // what it had not is: its first supertall, its first Obelisk
      st.day = 3020;
      complete(sim, b8);
      expect(A.plop('lm_obelisk', 40, 40, 0).ok).toBe(true);
      expect(news.firsts().map((n) => [n.day, n.ref!.first, n.x, n.z, n.text]), how).toEqual([
        [3020, 'stage:8', at(b8).x, at(b8).z, STAGE(8, 'Supertall Residences', 'Queensbury')],
        [3020, 'unique:lm_obelisk', 40, 40, OPENS('Obelisk', 'Queensbury')],
      ]);
      expect(firsts(st), how).toStrictEqual({
        'unique:civ_city_hall': had, 'unique:park_stadium': had, 'stage:6': had, 'stage:7': had, neighbor: had,
        'stage:8': { day: 3020, ...at(b8), id: b8.id }, 'unique:lm_obelisk': { day: 3020, x: 40, z: 40, id: st.buildingAt(40, 40)!.id },
      });
    }
  });

  it('a first is announced once across saves: every saved game continues like the uninterrupted one and never repeats what its save had', { timeout: 240_000 }, () => {
    // 95 days of one small city, the same in every game: the player's edits and the towers the growth would start
    const END = 95;
    const script = (s: Simulation): void => {
      const c = s.state, A = new CityActions(s);
      const ok = (r: { ok: boolean; reason?: string }) => expect(r.ok, `day ${c.day}: ${r.reason}`).toBe(true);
      switch (c.day) {
        case 2: site(s, 'res_tower.r2.6', 8, 10); break; // tower A: complete on day 34..39
        case 10: ok(A.plop('civ_mayor_house', 30, 30, 0)); break; // the first opening
        case 20: ok(road(A, 0, 40, 8, 40)); break; // the first connection
        case 45: site(s, 'res_tower.r2.7', 12, 10); site(s, 'res_tower.r2.6', 16, 10); break; // B (day 81..86), C
        case 50: ok(A.bulldoze({ x0: 30, z0: 30, x1: 32, z1: 32 })); ok(A.plop('civ_mayor_house', 34, 30, 0)); break; // rebuilt
        case 60: ok(road(A, 40, 0, 40, 8)); break; // a second connection
        default:
      }
    };
    // (without the rewards system, as T054b's continuity test: its init unlocks at once, and silently, a reward whose
    // conditions were first met since the last month tick, where the uninterrupted game unlocks it at the tick with its
    // news; the towers' residents reach the Cemetery's 2,000 here. docs/dev/reports/local-T054b-builtout-producer.md,
    // finding 1; not this lane's)
    const economy = () => economySystems().filter((s) => s.name !== 'economy.rewards');
    const start = (): { st: CityState; sim: Simulation } => {
      const { st, sim, A } = makeCity({ name: 'Queensbury' }, economy());
      st.funds = 1e6;
      st.unlocked.add('mayor_house');
      expect(road(A, 4, 12, 24, 12).ok).toBe(true);
      expect(A.zone({ x0: 4, z0: 8, x1: 24, z1: 12 }, Zone.ResHigh).ok).toBe(true);
      return { st, sim };
    };
    const view = (st: CityState) => JSON.stringify([st.systemData.firsts, st.news]);
    // Two differences right after a load that are not this lane's (a brand-new city's first weeks, on the base tree too:
    // docs/dev/reports/local-T096-firsts.md): the save of the day the first building appears (popRun's record cache), and
    // the saves between the first residents and the first education sample (demographics.eduMean still -1 in the game,
    // set by the population system's init at a load; some of these games stay different to the end). The whole city is
    // compared for saves outside both; the record and the news log for every save.
    const eduPending = (st: CityState) => st.stats.population > 0 && ((st.systemData.demographics as { eduMean?: number } | undefined)?.eduMean ?? 0) < 0;

    // the uninterrupted game, saved as a file at the end of every day
    const game = start();
    const posted = watch(game.sim);
    const saves = new Map<number, Uint8Array>(), want = new Map<number, string>(), wantAll = new Map<number, Record<string, string>>();
    const pending = new Set<number>();
    while (game.st.day < END) {
      game.sim.advanceDay();
      script(game.sim);
      saves.set(game.st.day, encodeBundle(serializeCity(game.st)));
      want.set(game.st.day, view(game.st));
      wantAll.set(game.st.day, digest(game.st));
      if (eduPending(game.st)) pending.add(game.st.day);
    }
    const record = firsts(game.st)!;
    const days = Object.fromEntries(Object.entries(record).map(([k, r]) => [k, r.day]));
    expect(Object.keys(record)).toEqual(['unique:civ_mayor_house', 'neighbor', 'stage:6', 'stage:7']);
    expect([days['unique:civ_mayor_house'], days.neighbor]).toEqual([10, 20]);
    expect(days['stage:6']).toBeGreaterThanOrEqual(34);
    expect(days['stage:6']).toBeLessThanOrEqual(39);
    expect(days['stage:7']).toBeGreaterThanOrEqual(81);
    expect(days['stage:7']).toBeLessThanOrEqual(86);
    // each kind once, on its day, although each thing happened twice (two stage 6 towers, the house rebuilt, two roads)
    expect(posted.firsts().map((n) => [n.ref!.first, n.day])).toEqual(Object.entries(days));
    expect(posted.all.filter((n) => n.text === OPENS("Mayor's House", 'Queensbury')).map((n) => n.day)).toEqual([10, 50]);
    expect(posted.all.filter((n) => n.text === CONNECTED).map((n) => n.day)).toEqual([20, 60]);
    expect([...game.st.buildings.values()].filter((b) => getDef(b.def)?.stage === 6 && b.built >= 1)).toHaveLength(2);

    // every day's save, loaded: the record and the news log equal the uninterrupted game's on each later day, and the
    // loaded game announces exactly the firsts that came after its save. The whole city too (T057), right after the load
    // and at the end, for the saves around the player's firsts and around the stage 7 tower's completion (and around the
    // stage 6 tower's, where that is outside the education window)
    const must = [9, 10, 11, 19, 20, 21, 50, 51, 60, 61, days['stage:7'] - 1, days['stage:7'], days['stage:7'] + 1, END - 1];
    for (const d of must) expect(pending.has(d), `day ${d}`).toBe(false);
    const whole = new Set([...must, days['stage:6'] - 1, days['stage:6'], days['stage:6'] + 1].filter((d) => !pending.has(d)));
    for (const [day, bytes] of saves) {
      const st = deserializeCity(decodeBundle(bytes) as SerializedCity);
      expect(view(st), `save of day ${day}: as saved`).toBe(want.get(day));
      const sim = new Simulation(st, economy());
      expect(view(st), `save of day ${day}: right after the load`).toBe(want.get(day));
      if (whole.has(day)) expect(differing(wantAll.get(day)!, digest(st)), `save of day ${day}: the whole city after the load`).toEqual([]);
      const again = watch(sim);
      while (st.day < END) {
        sim.advanceDay();
        script(sim);
        expect(view(st), `save of day ${day}: day ${st.day}`).toBe(want.get(st.day));
      }
      expect(again.firsts().map((n) => [n.ref!.first, n.day]), `save of day ${day}`).toEqual(Object.entries(days).filter(([, d]) => d > day));
      if (whole.has(day)) expect(differing(wantAll.get(END)!, digest(st)), `save of day ${day}: the whole city on day ${END}`).toEqual([]);
    }

    // a recovery snapshot keeps the record, lean or over its budget (it is no continuity record)
    const base = decodeBundle(saves.get(5)!) as SerializedCity, cur = decodeBundle(saves.get(90)!) as SerializedCity;
    const sd = (s: SerializedCity) => s.data.systemData as Record<string, unknown>;
    expect(sd(base).firsts).toStrictEqual({});
    expect(sd(cur).firsts).toStrictEqual(record);
    for (const opts of [{ lean: true }, { budget: 1 }, {}]) {
      const back = applyCityDelta(structuredClone(encodeCityDelta(cur, base, 1, opts)), base);
      expect(sd(back).firsts, JSON.stringify(opts)).toStrictEqual(record);
      expect(back.data.news, JSON.stringify(opts)).toStrictEqual(cur.data.news);
    }
  });
});

describe('T096: nothing else changes', () => {
  it('a bot city plays the same with and without the firsts system: only the record and the refs on its news differ', { timeout: 240_000 }, () => {
    const opts = { size: 48, years: 2, seed: 5, difficulty: 'medium', terrain: 'plains', water: 0.1, quiet: true, noInfra: true } as const;
    const kept = new SimBot({ ...opts }, economySystems());
    const bare = new SimBot({ ...opts }, economySystems().filter((s) => s.name !== 'economy.firsts'));
    const announced = watch(kept.sim);
    kept.run(2);
    bare.run(2);
    expect(kept.st.stats.population).toBeGreaterThan(500);
    expect(bare.st.systemData.firsts).toBeUndefined();
    // the whole saved city, key by key: the record is new, the news differ by the refs alone
    const diff = differing(digest(kept.st), digest(bare.st));
    expect(diff).toContain('sd.firsts');
    expect(diff.filter((k) => k !== 'sd.firsts' && k !== 'data.news')).toEqual([]);
    expect(plain(kept.st.news)).toStrictEqual(bare.st.news);
    expect(kept.st.systemData.simRng).toBe(bare.st.systemData.simRng);
    expect(kept.st.stats.residents).toEqual(bare.st.stats.residents);
    // the record holds what was announced, each kind once, where and when its news says
    const record = firsts(kept.st)!;
    expect(announced.firsts().length).toBeGreaterThan(0);
    expect(Object.keys(record)).toEqual(announced.firsts().map((n) => n.ref!.first));
    for (const n of announced.firsts()) expect(record[n.ref!.first!]).toMatchObject({ day: n.day, x: n.x, z: n.z });
    expect(new Set(Object.keys(record)).size).toBe(Object.keys(record).length);
    if (kept.st.neighborConnections.length) expect(record.neighbor?.day).toBeGreaterThanOrEqual(0);
  });
});
