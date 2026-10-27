import { describe, expect, it, vi } from 'vitest';
import { DevType } from '../../src/core/types';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';
import { CITY_RANKS, listMilestones, REWARDS, rewardsSystem } from '../../src/sim/economy/rewards';
import { EconRuntime } from '../../src/sim/economy/runtime';

const RANKS = [
  ['Settlement', 0], ['Village', 1000], ['Town', 5000], ['Small City', 10000],
  ['City', 25000], ['Large City', 50000], ['Metropolis', 100000], ['Major Metropolis', 250000],
  ['Global City', 500000], ['World City', 750000], ['Megacity', 1000000], ['Megalopolis', 1500000],
] as const;

function state(population = 0): CityState {
  const st = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false }));
  st.stats.population = population;
  return st;
}

function leaveLocked(st: CityState, ids: string[]): void {
  for (const r of REWARDS) if (!ids.includes(r.id)) st.unlocked.add(r.id);
}

describe('city ranks', () => {
  it('lists the twelve ranks in the plan, in population order', () => {
    expect(CITY_RANKS.map((r) => [r.name, r.population])).toEqual(RANKS);
    expect(new Set(CITY_RANKS.map((r) => r.id)).size).toBe(12);
  });

  for (const [i, [name, population]] of RANKS.entries()) {
    it.each([
      { label: 'below', offset: -1 }, { label: 'at', offset: 0 }, { label: 'above', offset: 1 },
    ])(`${name}: $label the threshold`, ({ offset }) => {
      const st = state(population + offset);
      const info = listMilestones(st);
      const current = offset < 0 ? Math.max(0, i - 1) : i;
      expect([info.currentRank.name, info.currentRank.population]).toEqual(RANKS[current]);
      expect(info.nextRank ? [info.nextRank.name, info.nextRank.population] : null).toEqual(RANKS[current + 1] ?? null);
    });
  }

  it('keeps the final rank above 1.5M, with no next rank', () => {
    const info = listMilestones(state(2000000));
    expect(info.currentRank.name).toBe('Megalopolis');
    expect(info.nextRank).toBeNull();
  });
});

describe('listMilestones', () => {
  it('chooses the three closest locked rewards across kinds, in descending progress', () => {
    const st = state(9000);
    st.stats.approval = 65;
    for (const id of ['mayor_house', 'cemetery', 'statue', 'lm_lighthouse', 'lm_clock_tower']) st.unlocked.add(id);
    expect(listMilestones(st).nextUnlocks).toEqual([
      { id: 'water_treatment', name: 'Water Treatment Plant', kind: 'unlock', progress: 1 },
      { id: 'recycling_center', name: 'Recycling Center', kind: 'unlock', progress: 1 },
      { id: 'lm_obelisk', name: REWARDS.find((r) => r.id === 'lm_obelisk')!.name, kind: 'landmark', progress: 0.9 },
    ]);
    st.unlocked.add('water_treatment');
    expect(listMilestones(st).nextUnlocks.map((r) => r.id)).toEqual(['recycling_center', 'lm_obelisk', 'museum']);
  });

  it('keeps catalogue order for ties, including the third choice and zero progress', () => {
    const st = state(10000);
    leaveLocked(st, ['museum', 'airport_small', 'desalination', 'city_hall']);
    expect(listMilestones(st).nextUnlocks.map((r) => r.id)).toEqual(['museum', 'airport_small', 'desalination']);
    st.stats.population = 0;
    expect(listMilestones(st).nextUnlocks.map((r) => r.id)).toEqual(['museum', 'airport_small', 'desalination']);
  });

  it('uses the least-complete condition, including education, health, wealth and jobs', () => {
    const st = state(60000);
    st.stats.eq = 55;
    st.stats.hq = 20;
    st.stats.residents[2] = 3000;
    st.stats.jobsByDev[DevType.CS1] = 5000;
    st.stats.jobsByDev[DevType.CO3] = 4000;
    leaveLocked(st, ['nuclear_power', 'research_center', 'medical_center', 'country_club', 'convention_center']);
    const next = listMilestones(st).nextUnlocks;
    expect(next.map((r) => r.id)).toEqual(['country_club', 'nuclear_power', 'convention_center']);
    expect(next.map((r) => r.progress)).toEqual([0.75, 55 / 85, 0.6]);
    st.stats.hq = 90;
    expect(listMilestones(st).nextUnlocks.map((r) => r.id)).toEqual(['medical_center', 'country_club', 'nuclear_power']);
  });

  it('reads built prerequisites from milestones without unlocking anything', () => {
    const st = state(9000);
    leaveLocked(st, ['museum', 'airport_small', 'courthouse', 'airport_large']);
    expect(listMilestones(st).nextUnlocks.map((r) => r.id)).toEqual(['museum', 'airport_small', 'courthouse']);
    expect(listMilestones(st).nextUnlocks[2].progress).toBe(0);
    st.milestones.civ_police_station = 1;
    expect(listMilestones(st).nextUnlocks.map((r) => r.id)).toEqual(['courthouse', 'museum', 'airport_small']);
    expect(listMilestones(st).nextUnlocks[0].progress).toBe(1);
    expect(st.unlocked.has('courthouse')).toBe(false);
  });

  it('returns fewer than three when little remains, clamps progress, and returns none when all are unlocked', () => {
    const st = state(2000000);
    leaveLocked(st, ['country_club', 'airport_large']);
    st.stats.residents[2] = -1;
    st.milestones.tr_airport_small = 1;
    const next = listMilestones(st).nextUnlocks;
    expect(next.map((r) => [r.id, r.progress])).toEqual([['airport_large', 1], ['country_club', 0]]);
    st.unlocked.add('airport_large');
    expect(listMilestones(st).nextUnlocks.map((r) => r.id)).toEqual(['country_club']);
    st.unlocked.add('country_club');
    expect(listMilestones(st).nextUnlocks).toEqual([]);
  });

  it('omits conditions needing ordinances or terrain, even when those conditions are met', () => {
    const st = state(60000);
    st.budget.ordinances.push('legalized_gambling');
    st.water.fill(1);
    st.stats.jobsByDev[DevType.ID] = 6000;
    leaveLocked(st, ['casino', 'seaport']);
    expect(listMilestones(st).nextUnlocks).toEqual([]);
  });

  it('reads only stats, unlocked and milestones, without writes or a live-city cache', () => {
    const st = state(7200);
    st.stats.approval = 65;
    st.milestones.civ_police_station = 1;
    const before = structuredClone({ stats: st.stats, unlocked: st.unlocked, milestones: st.milestones });
    Object.freeze(st.stats);
    Object.freeze(st.stats.residents);
    Object.freeze(st.stats.jobsByDev);
    Object.freeze(st.milestones);
    const restricted = new Proxy(st, {
      get(target, key) {
        if (key !== 'stats' && key !== 'unlocked' && key !== 'milestones') throw new Error(`Unexpected read: ${String(key)}`);
        return Reflect.get(target, key);
      },
      set() { throw new Error('Unexpected write'); },
    });
    const info = listMilestones(restricted);
    expect(info).toEqual(listMilestones(structuredClone(before)));
    expect(listMilestones(restricted)).toEqual(info);
    expect({ stats: st.stats, unlocked: st.unlocked, milestones: st.milestones }).toEqual(before);
    expect(st.systemData).toEqual({});
  });
});

describe('rank persistence', () => {
  it('loads an old save without rank flags silently, without re-granting rewards or changing sim data', () => {
    const st = state(300000);
    st.day = 5400;
    const sim = new Simulation(st, [rewardsSystem(new EconRuntime())]);
    st.notify('Saved headline', 'good');
    sim.rng.next();
    const saved = serializeCity(st, { copy: true });
    delete (saved.data.systemData as Record<string, unknown>).cityRanks;
    const loaded = deserializeCity(saved);
    expect(loaded.systemData.cityRanks).toBeUndefined();
    const notify = vi.spyOn(sim, 'notify');
    const news = vi.fn(), unlocked = vi.fn();
    sim.events.on('news', news);
    sim.events.on('unlocked', unlocked);
    sim.replaceState(loaded);
    expect(loaded.systemData.cityRanks).toEqual({
      settlement: true, village: true, town: true, small_city: true, city: true,
      large_city: true, metropolis: true, major_metropolis: true,
    });
    sim.runDays(30);
    expect(notify).not.toHaveBeenCalled();
    expect(news).not.toHaveBeenCalled();
    expect(unlocked).not.toHaveBeenCalled();
    expect([...loaded.unlocked]).toEqual(saved.sets.unlocked);
    expect([...loaded.announced]).toEqual(saved.sets.announced);
    expect(loaded.milestones).toEqual(saved.data.milestones);
    expect(loaded.news).toEqual(saved.data.news);
    expect(loaded.stats).toEqual(saved.data.stats);
    expect(loaded.budget).toEqual(saved.data.budget);
    expect(loaded.funds).toBe(saved.scalars.funds);
    expect(loaded.systemData.simRng).toBe((saved.data.systemData as Record<string, unknown>).simRng);
    expect((saved.data.systemData as Record<string, unknown>).cityRanks).toBeUndefined();
  });

  it('initializes an old save through the constructor and records new ranks at monthly checks', () => {
    const st = deserializeCity(serializeCity(state(999), { copy: true }));
    const sim = new Simulation(st, [rewardsSystem(new EconRuntime())]);
    expect(st.systemData.cityRanks).toEqual({ settlement: true });
    st.stats.population = 1000;
    sim.runDays(30);
    expect(st.systemData.cityRanks).toEqual({ settlement: true, village: true });
    expect(st.news).toEqual([]);
    expect(st.unlocked.size).toBe(0);
  });

  it('round-trips reached ranks through a save/load and retains them after a population drop', () => {
    const st = state(750000);
    const sim = new Simulation(st, [rewardsSystem(new EconRuntime())]);
    const ranks = {
      settlement: true, village: true, town: true, small_city: true, city: true,
      large_city: true, metropolis: true, major_metropolis: true, global_city: true, world_city: true,
    };
    expect(st.systemData.cityRanks).toEqual(ranks);
    st.stats.population = 9000;
    sim.runDays(30);
    const saved = serializeCity(st, { copy: true });
    const loaded = deserializeCity(saved);
    expect(loaded.systemData.cityRanks).toEqual(ranks);
    expect(loaded.systemData.cityRanks).not.toBe(st.systemData.cityRanks);
    const sim2 = new Simulation(loaded, [rewardsSystem(new EconRuntime())]);
    expect(loaded.systemData.cityRanks).toEqual(ranks);
    expect(listMilestones(loaded).currentRank.name).toBe('Town');
    expect(listMilestones(loaded).nextRank?.name).toBe('Small City');
    loaded.stats.population = 1000000;
    sim2.runDays(30);
    expect(loaded.systemData.cityRanks).toEqual({ ...ranks, megacity: true });
    expect(loaded.news).toEqual(st.news);
    expect(st.systemData.cityRanks).toEqual(ranks);
  });
});
