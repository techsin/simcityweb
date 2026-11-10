/**
 * T093: a save taken between the day a reward is first earned and the month tick that announces it continues bit for
 * bit like the uninterrupted game (T057's method, tests/save/loadContinuity.test.ts, on a town that earns two rewards).
 *
 * A small SimBot town (48², one year, the economy systems) gets every free cell zoned for homes, so it passes 1,200
 * residents (the Mayor's House) and 2,000 (the Cemetery) within two months. The uninterrupted game unlocks each at
 * its month tick, days 390 and 420, with its news. The game is saved as a file on every day; the saves of days 383
 * and 388 and of days 398 to 418 fall between a reward's earning and its tick. rewardsSystem.init used to unlock the
 * reward silently at such a load (its check ran at every init), and the loaded game then never announced it. Each
 * loaded game must hold the uninterrupted game's rewards record on every day, post the same news at the same tick, and
 * equal it in the whole serialized city, per key. A save from before LG-01 (no rank record) loads as it did.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SimBot } from '../../tools/simbot';
import { Network, Zone } from '../../src/core/types';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import type { CityState } from '../../src/sim/CityState';
import { REWARD_BY_ID, rewardConditionsMet } from '../../src/sim/economy/rewards';
import { CONTINUITY_RECORDS } from '../../src/sim/persist';
import { Simulation } from '../../src/sim/Simulation';
import { economySystems } from '../../src/sim/systems/economy';

// (T057's per-key digest of the whole city as saved: tests/save/loadContinuity.test.ts)
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

/** everything the rewards system keeps: both sets in their order, the rank record and the reward news */
const record = (st: CityState) => ({
  unlocked: [...st.unlocked],
  announced: [...st.announced],
  ranks: { ...(st.systemData.cityRanks as Record<string, boolean> | undefined) },
  news: st.news.filter((n) => n.kind === 'reward').map((n) => ({ day: n.day, text: n.text, advisor: n.advisor, ref: n.ref })),
});
/** rewards whose conditions the city meets today and which are still locked: the month tick has not seen them */
const earned = (st: CityState) => [...REWARD_BY_ID.values()].filter((r) => !st.unlocked.has(r.id) && rewardConditionsMet(st, r)).map((r) => r.id);

const END = 450;
const MAYOR = { day: 390, text: "The citizens have built you a Mayor's House! Place it from Rewards.", advisor: 'planning', ref: { reward: 'mayor_house' } };
const CEMETERY = { day: 420, text: 'Reward unlocked: Cemetery! A quiet resting place.', advisor: 'planning', ref: { reward: 'cemetery' } };

interface Town {
  /** the uninterrupted game by day, from day 360 to END */
  want: Map<number, { digest: Record<string, string>; record: ReturnType<typeof record>; earned: string[]; population: number }>;
  /** its save file of every day */
  saves: Map<number, Uint8Array>;
}
let grown: Town | undefined;
/** the uninterrupted game, played once for the file */
function town(): Town {
  if (grown) return grown;
  const bot = new SimBot({ size: 48, years: 1, seed: 5, difficulty: 'medium', terrain: 'plains', water: 0.1, quiet: true, noInfra: true }, economySystems());
  bot.run(1);
  const sim = bot.sim, st = bot.st;
  // the player zones every free cell for homes
  st.funds += 1e6;
  for (let z = 0; z < st.size; z++) for (let x = 0; x < st.size; x++) {
    const i = st.idx(x, z);
    if (st.zone[i] === Zone.None && st.building[i] < 0 && st.network[i] === Network.None && !st.water[i] && !st.powerLines[i]) bot.A.zone({ x0: x, z0: z, x1: x + 1, z1: z + 1 }, Zone.ResLow);
  }
  const want: Town['want'] = new Map(), saves: Town['saves'] = new Map();
  const keep = () => {
    want.set(st.day, { digest: digest(st), record: record(st), earned: earned(st), population: st.stats.population });
    saves.set(st.day, encodeBundle(serializeCity(st)));
  };
  keep();
  while (st.day < END) { sim.advanceDay(); keep(); }
  return (grown = { want, saves });
}
const load = (bytes: Uint8Array) => deserializeCity(decodeBundle(bytes) as SerializedCity);

/** load the save of `day` and follow it to day END: the rewards record of the uninterrupted game on every day */
function expectRecordContinues(t: Town, day: number): void {
  const copy = load(t.saves.get(day)!);
  const sim = new Simulation(copy, economySystems());
  expect(record(copy), `save on day ${day}: right after the load`).toEqual(t.want.get(day)!.record);
  while (copy.day < END) {
    sim.advanceDay();
    expect(record(copy), `save on day ${day}: day ${copy.day}`).toEqual(t.want.get(copy.day)!.record);
  }
}

describe('T093: a mid-month load keeps a reward\'s announcement', () => {
  it('the uninterrupted town earns the Mayor\'s House and the Cemetery in mid-month and gets each at its tick, with its news', { timeout: 300_000 }, () => {
    const { want } = town();
    const at = (day: number) => want.get(day)!;
    const newsOf = (id: string) => at(END).record.news.filter((n) => n.ref?.reward === id);
    expect(at(360).population).toBeLessThan(1200);
    expect(at(360).record.ranks).toEqual({ settlement: true, village: true });
    // earned and still locked: the Mayor's House on days 383 and 388, the Cemetery from day 398 to day 418
    for (const day of [383, 388]) expect(at(day).earned, `day ${day}`).toContain('mayor_house');
    expect(at(389).record.unlocked).not.toContain('mayor_house');
    expect(at(390).record.unlocked).toContain('mayor_house');
    for (const day of [398, 403, 408, 413, 418]) expect(at(day).earned, `day ${day}`).toContain('cemetery');
    expect(at(419).record.unlocked).not.toContain('cemetery');
    expect(at(420).record.unlocked).toContain('cemetery');
    // each announced once, at its tick
    expect(newsOf('mayor_house')).toEqual([MAYOR]);
    expect(newsOf('cemetery')).toEqual([CEMETERY]);
    // (each window lasts to the day before its tick)
    const lastEarned = (id: string) => Math.max(...[...want.keys()].filter((day) => at(day).earned.includes(id)));
    expect(lastEarned('mayor_house')).toBe(389);
    expect(lastEarned('cemetery')).toBe(419);
  });

  it('loads on day 383 and on day 388 leave the Mayor\'s House locked, and its news arrives at the tick on day 390', { timeout: 300_000 }, () => {
    const t = town();
    for (const day of [383, 388]) {
      const copy = load(t.saves.get(day)!);
      const sim = new Simulation(copy, economySystems());
      expect(copy.stats.population, `save on day ${day}`).toBeGreaterThanOrEqual(1200);
      expect(copy.unlocked.has('mayor_house'), `save on day ${day}: right after the load`).toBe(false);
      expect(copy.announced.has('mayor_house'), `save on day ${day}: right after the load`).toBe(false);
      const posted: unknown[] = [], unlocked: string[] = [];
      sim.events.on('news', (n) => { if (n.ref?.reward === 'mayor_house') posted.push({ day: n.day, text: n.text, advisor: n.advisor, ref: n.ref }); });
      sim.events.on('unlocked', (id) => { if (id === 'mayor_house') unlocked.push(`${copy.day}:${id}`); });
      sim.runDays(389 - day);
      expect(copy.unlocked.has('mayor_house'), `save on day ${day}: day 389`).toBe(false);
      expect(posted, `save on day ${day}: day 389`).toEqual([]);
      sim.runDays(1);
      expect(copy.day).toBe(390);
      expect(posted, `save on day ${day}: the tick`).toEqual([MAYOR]);
      expect(unlocked, `save on day ${day}: the tick`).toEqual(['390:mayor_house']);
      // and the same rewards record as the uninterrupted game on every day, through the Cemetery's tick too
      expectRecordContinues(t, day);
    }
  });

  it('the Cemetery window: loads from day 398 to day 418 leave it locked, and its news arrives at the tick on day 420', { timeout: 300_000 }, () => {
    const t = town();
    for (const day of [398, 403, 408, 413, 418]) {
      const copy = load(t.saves.get(day)!);
      const sim = new Simulation(copy, economySystems());
      expect(copy.stats.population, `save on day ${day}`).toBeGreaterThanOrEqual(2000);
      expect(copy.unlocked.has('cemetery'), `save on day ${day}: right after the load`).toBe(false);
      const posted: unknown[] = [];
      sim.events.on('news', (n) => { if (n.ref?.reward === 'cemetery') posted.push({ day: n.day, text: n.text, advisor: n.advisor, ref: n.ref }); });
      sim.runDays(419 - day);
      expect(copy.unlocked.has('cemetery'), `save on day ${day}: day 419`).toBe(false);
      expect(posted, `save on day ${day}: day 419`).toEqual([]);
      sim.runDays(1);
      expect(posted, `save on day ${day}: the tick`).toEqual([CEMETERY]);
      expectRecordContinues(t, day);
    }
  });

  it('every day\'s save, from day 360 to day 449, equals the uninterrupted game right after its load: the rewards record and the whole city per key', { timeout: 300_000 }, () => {
    const t = town();
    let inWindow = 0;
    for (let day = 360; day < END; day++) {
      const copy = load(t.saves.get(day)!);
      new Simulation(copy, economySystems());
      expect(record(copy), `save on day ${day}: right after the load`).toEqual(t.want.get(day)!.record);
      expect(differing(t.want.get(day)!.digest, digest(copy)), `save on day ${day} (dom ${day % 30}): right after the load`).toEqual([]);
      if (t.want.get(day)!.earned.length) inWindow++;
    }
    // (the saves that used to load with a reward unlocked: 8 days for the Mayor's House, 22 for the Cemetery)
    expect(inWindow).toBeGreaterThanOrEqual(30);
  });

  it('the whole city, per key: a save inside a reward\'s window continues bit-exact through its tick (economy systems)', { timeout: 300_000 }, () => {
    const t = town();
    for (const day of [383, 388, 398, 403, 408, 413, 418]) {
      const copy = load(t.saves.get(day)!);
      const sim = new Simulation(copy, economySystems());
      expect(differing(t.want.get(day)!.digest, digest(copy)), `save on day ${day} (dom ${day % 30}): right after the load`).toEqual([]);
      while (copy.day < END) {
        sim.advanceDay();
        expect(differing(t.want.get(copy.day)!.digest, digest(copy)), `save on day ${day} (dom ${day % 30}): day ${copy.day}`).toEqual([]);
      }
    }
  });

  it('an old save without the newer fields (the rank record, T057\'s records) loads, and is checked silently as before', { timeout: 300_000 }, () => {
    const t = town();
    const old = decodeBundle(t.saves.get(383)!) as SerializedCity;
    const sd = old.data.systemData as Record<string, unknown>;
    delete sd.cityRanks;
    for (const k of CONTINUITY_RECORDS) delete sd[k];
    const st = deserializeCity(old);
    expect(st.unlocked.has('mayor_house')).toBe(false);
    const sim = new Simulation(st, economySystems());
    // nothing in such a save says what its last month tick saw: the Mayor's House its residents have earned comes at
    // the load, without news, and the ranks they have passed are recorded
    expect(st.unlocked.has('mayor_house')).toBe(true);
    expect(st.announced.has('mayor_house')).toBe(true);
    expect(st.systemData.cityRanks).toEqual({ settlement: true, village: true });
    expect(record(st).news).toEqual([]);
    sim.runDays(390 - st.day);
    expect(record(st).news.map((n) => n.ref?.reward)).not.toContain('mayor_house');
    // from here on it is a city with the record: the Cemetery is announced at its tick, also across another save
    sim.runDays(18);
    expect(st.day).toBe(408);
    expect(earned(st)).toContain('cemetery');
    const copy = load(encodeBundle(serializeCity(st)));
    const sim2 = new Simulation(copy, economySystems());
    expect(copy.unlocked.has('cemetery')).toBe(false);
    expect(record(copy)).toEqual(record(st));
    for (const s of [sim, sim2]) s.runDays(12);
    expect(record(copy)).toEqual(record(st));
    expect(record(copy).news.filter((n) => n.ref?.reward === 'cemetery').map((n) => n.day)).toEqual([420]);
  });
});
