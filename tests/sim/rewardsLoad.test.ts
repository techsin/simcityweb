/**
 * T093: a load restores the rewards state exactly as saved (the rewards system alone, on a scripted population).
 *
 * The month tick unlocks a reward and announces it. The system's init used to run the same check silently, so a save
 * taken between the day a reward was first earned and that tick loaded with the reward unlocked, and its news never
 * came; a rank crossed in mid-month was recorded at the load the same way. Here the population follows a script that
 * passes several thresholds in mid-month and falls back under two of them before the tick. The game is saved on days
 * inside those windows, and every loaded game must hold the uninterrupted game's rewards record right after the load
 * and on every day after it. A city without the system's record (a save from before LG-01) is still checked silently
 * at the load, and a sandbox city has everything unlocked from its start.
 *
 * tests/save/rewardsLoadContinuity.test.ts runs the same on a grown town with the economy systems, the whole city
 * compared per key.
 */
import { describe, expect, it } from 'vitest';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig, type CityConfigData } from '../../src/sim/config';
import { REWARDS, rewardsSystem, type RewardDef } from '../../src/sim/economy/rewards';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';

/**
 * Residents by day. 900 at first; 5,200 from day 371, which passes Village, the Mayor's House, the Cemetery, the
 * Lighthouse, Town and the Clock Tower in mid-month; 4,000 from day 385, back under Town and the Clock Tower before
 * the tick on day 390; 6,500 from day 401, which passes Town, the Clock Tower and the Water Treatment Plant before the
 * tick on day 420.
 */
const residents = (day: number) => (day <= 370 ? 900 : day <= 384 ? 5200 : day <= 400 ? 4000 : 6500);
const script: SimSystem = { name: 'test.population', daily({ state }) { state.stats.population = residents(state.day); } };
const END = 450;

const systems = () => [script, rewardsSystem(new EconRuntime())];
function city(cfg: Partial<CityConfigData> = {}): { st: CityState; sim: Simulation } {
  const st = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false, ...cfg }));
  return { st, sim: new Simulation(st, systems()) };
}

/** everything the rewards system keeps: both sets in their order, the rank record and the reward news */
const record = (st: CityState) => ({
  unlocked: [...st.unlocked],
  announced: [...st.announced],
  ranks: { ...(st.systemData.cityRanks as Record<string, boolean> | undefined) },
  news: st.news.filter((n) => n.kind === 'reward').map((n) => `${n.day}:${n.ref?.reward}`),
});
type Rewards = ReturnType<typeof record>;

/** the uninterrupted game to day END: its record on every day, and a save file of every day */
function uninterrupted(cfg: Partial<CityConfigData> = {}) {
  const { st, sim } = city(cfg);
  const want = new Map<number, Rewards>([[0, record(st)]]), saves = new Map<number, Uint8Array>();
  while (st.day < END) {
    sim.advanceDay();
    want.set(st.day, record(st));
    saves.set(st.day, encodeBundle(serializeCity(st)));
  }
  return { st, want, saves };
}
const load = (bytes: Uint8Array) => deserializeCity(decodeBundle(bytes) as SerializedCity);

/** load the save of `day` and follow it to day END: the same record as the uninterrupted game on every day */
function expectContinues(game: ReturnType<typeof uninterrupted>, day: number): void {
  const copy = load(game.saves.get(day)!);
  const sim = new Simulation(copy, systems());
  expect(record(copy), `save on day ${day}: right after the load`).toEqual(game.want.get(day));
  while (copy.day < END) {
    sim.advanceDay();
    expect(record(copy), `save on day ${day}: day ${copy.day}`).toEqual(game.want.get(copy.day));
  }
}

const AT_390 = ['mayor_house', 'cemetery', 'lm_lighthouse'];
const AT_420 = ['water_treatment', 'lm_clock_tower'];

describe('T093: a load restores the rewards state as saved', () => {
  it('the uninterrupted game unlocks and announces at the month ticks only, what the city holds on that day', () => {
    const { want } = uninterrupted();
    expect(want.get(0)).toEqual({ unlocked: [], announced: [], ranks: { settlement: true }, news: [] });
    // (5,200 residents from day 371 to 384: nothing happens before the tick)
    expect(want.get(389)).toEqual(want.get(0));
    // the tick on day 390, at 4,000 residents: no Town, no Clock Tower
    expect(want.get(390)).toEqual({
      unlocked: AT_390, announced: AT_390, ranks: { settlement: true, village: true }, news: AT_390.map((id) => `390:${id}`),
    });
    expect(want.get(419)).toEqual(want.get(390));
    expect(want.get(END)).toEqual({
      unlocked: [...AT_390, ...AT_420], announced: [...AT_390, ...AT_420], ranks: { settlement: true, village: true, town: true },
      news: [...AT_390.map((id) => `390:${id}`), ...AT_420.map((id) => `420:${id}`)],
    });
  });

  it('a save between the day a reward is earned and its tick: nothing is unlocked at the load, the tick announces it', () => {
    const game = uninterrupted();
    // days 371 to 384: the Mayor's House, the Cemetery, the Lighthouse and the Clock Tower are earned and locked, and the
    // Clock Tower is lost again on day 385; days 401 to 419: the Clock Tower and the Water Treatment Plant
    for (const day of [371, 380, 384, 385, 389, 395, 401, 410, 419]) expectContinues(game, day);
    // (saves on a tick, before anything is earned, and in the new city's first month)
    for (const day of [1, 29, 30, 360, 370, 390, 420]) expectContinues(game, day);
    const copy = load(game.saves.get(380)!);
    const sim = new Simulation(copy, systems());
    expect(copy.stats.population).toBe(5200);
    expect([...copy.unlocked]).toEqual([]);
    sim.runDays(10);
    expect([...copy.unlocked]).toEqual(AT_390);
    // one news item per reward, with its reference (the toast's "Place it" reads it)
    expect(copy.news.map((n) => [n.day, n.kind, n.ref?.reward])).toEqual(AT_390.map((id) => [390, 'reward', id]));
  });

  it('a rank crossed since the last tick is recorded at the next tick, and one lost again before it is not recorded', () => {
    const game = uninterrupted();
    // day 380: 5,200 residents, a Village and a Town by population, neither recorded yet
    const copy = load(game.saves.get(380)!);
    const sim = new Simulation(copy, systems());
    expect(copy.systemData.cityRanks).toEqual({ settlement: true });
    sim.runDays(10);
    expect(copy.systemData.cityRanks).toEqual({ settlement: true, village: true });
    sim.runDays(30);
    expect(copy.systemData.cityRanks).toEqual({ settlement: true, village: true, town: true });
    expect(copy.systemData.cityRanks).toEqual(game.want.get(420)!.ranks);
  });

  it('a load emits no unlocked event and posts no news; the tick emits both, once per reward', () => {
    const game = uninterrupted();
    // (replaceState: the load path that keeps the listeners)
    const { sim } = city();
    const unlocked: string[] = [], news: string[] = [];
    sim.events.on('unlocked', (id) => unlocked.push(`${sim.state.day}:${id}`));
    sim.events.on('news', (n) => news.push(`${n.day}:${n.ref?.reward}`));
    sim.replaceState(load(game.saves.get(380)!));
    expect(unlocked).toEqual([]);
    expect(news).toEqual([]);
    sim.runDays(9);
    expect(unlocked).toEqual([]);
    sim.runDays(1);
    expect(unlocked).toEqual(AT_390.map((id) => `390:${id}`));
    expect(news).toEqual(unlocked);
    sim.runDays(30);
    expect(unlocked).toEqual([...AT_390.map((id) => `390:${id}`), ...AT_420.map((id) => `420:${id}`)]);
    expect(news).toEqual(unlocked);
  });

  it('an old save without the rank record (from before LG-01) is checked silently at the load, as before', () => {
    const game = uninterrupted();
    const old = decodeBundle(game.saves.get(380)!) as SerializedCity;
    delete (old.data.systemData as Record<string, unknown>).cityRanks;
    delete old.sets.announced; // (and without the announced set)
    const st = deserializeCity(old);
    expect(st.systemData.cityRanks).toBeUndefined();
    expect(st.announced.size).toBe(0);
    const sim = new Simulation(st, systems());
    // what its 5,200 residents have reached, at once and without news: nothing in the save says what a tick has seen
    const held = ['mayor_house', 'cemetery', 'lm_lighthouse', 'lm_clock_tower'];
    expect(record(st)).toEqual({ unlocked: held, announced: held, ranks: { settlement: true, village: true, town: true }, news: [] });
    sim.runDays(10);
    expect(record(st).news).toEqual([]);
    // what it reaches from here on is announced at its tick
    sim.runDays(30);
    expect(record(st)).toEqual({
      unlocked: [...held, 'water_treatment'], announced: [...held, 'water_treatment'],
      ranks: { settlement: true, village: true, town: true }, news: ['420:water_treatment'],
    });
    // and it carries the record from its first load on: its own saves load as saved
    const again = deserializeCity(old);
    const sim2 = new Simulation(again, systems());
    sim2.runDays(25);
    expect(again.stats.population).toBe(6500);
    const copy = load(encodeBundle(serializeCity(again)));
    const sim3 = new Simulation(copy, systems());
    expect(record(copy)).toEqual({ unlocked: held, announced: held, ranks: { settlement: true, village: true, town: true }, news: [] });
    sim3.runDays(15);
    expect(record(copy).news).toEqual(['420:water_treatment']);
  });

  it('a reward added to the game after a save: the next tick brings it with its news; a save without the record gets it at the load', () => {
    const game = uninterrupted(), sandbox = uninterrupted({ difficulty: 'sandbox' });
    // (the game gets a reward that the saves of day 380 were never checked for; their 5,200 residents hold it already)
    const added: RewardDef = {
      id: 't093_added', name: 'Added Later', kind: 'landmark', defIds: [], description: '',
      conds: [{ label: 'Population', value: (s) => s.stats.population, need: 3000 }],
    };
    REWARDS.push(added);
    try {
      const copy = load(game.saves.get(380)!);
      const sim = new Simulation(copy, systems());
      expect(record(copy)).toEqual(game.want.get(380));
      sim.runDays(10);
      expect([...copy.unlocked]).toEqual([...AT_390, added.id]);
      expect(copy.news.map((n) => [n.day, n.text, n.ref?.reward]).at(-1)).toEqual([390, 'New landmark available: Added Later!', added.id]);
      // sandbox: unlocked whatever the city holds, and announced like any other at that tick
      const box = load(sandbox.saves.get(380)!);
      const sim2 = new Simulation(box, systems());
      expect(box.unlocked.has(added.id)).toBe(false);
      sim2.runDays(10);
      expect(box.unlocked.has(added.id)).toBe(true);
      expect(record(box).news).toEqual([`390:${added.id}`]);
      // a save without the record (from before LG-01): at the load, without news
      const old = decodeBundle(game.saves.get(380)!) as SerializedCity;
      delete (old.data.systemData as Record<string, unknown>).cityRanks;
      const st = deserializeCity(old);
      new Simulation(st, systems()).runDays(10);
      expect(st.unlocked.has(added.id)).toBe(true);
      expect(record(st).news).toEqual([]);
    } finally {
      REWARDS.splice(REWARDS.indexOf(added), 1);
    }
    expect(REWARDS.includes(added)).toBe(false);
  });

  it('a sandbox city has everything unlocked from its start, without news, and a load changes nothing', () => {
    const game = uninterrupted({ difficulty: 'sandbox' });
    // (the catalogue's unlocks, rewards, landmarks and deals: what sandbox opens whatever the city holds)
    const all = REWARDS.filter((r) => ['unlock', 'reward', 'landmark', 'deal'].includes(r.kind)).map((r) => r.id);
    expect(all.length).toBeGreaterThanOrEqual(43);
    expect(game.st.config.sandbox).toBe(true);
    expect(game.want.get(0)).toEqual({ unlocked: all, announced: all, ranks: { settlement: true }, news: [] });
    // its ranks follow the population at the ticks, like any city's
    expect(game.want.get(389)).toEqual(game.want.get(0));
    expect(game.want.get(390)).toEqual({ unlocked: all, announced: all, ranks: { settlement: true, village: true }, news: [] });
    expect(game.want.get(END)).toEqual({ unlocked: all, announced: all, ranks: { settlement: true, village: true, town: true }, news: [] });
    for (const day of [372, 380, 385, 389, 390, 405, 419]) expectContinues(game, day);
    // (an old sandbox save without the record: checked at the load, silently)
    const old = decodeBundle(game.saves.get(380)!) as SerializedCity;
    delete (old.data.systemData as Record<string, unknown>).cityRanks;
    old.sets.unlocked = [];
    old.sets.announced = [];
    const st = deserializeCity(old);
    new Simulation(st, systems()).runDays(40);
    expect(record(st)).toEqual({ unlocked: all, announced: all, ranks: { settlement: true, village: true, town: true }, news: [] });
  });
});
