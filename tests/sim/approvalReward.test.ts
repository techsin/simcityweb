import { describe, expect, it, vi } from 'vitest';
import type { Difficulty } from '../../src/core/types';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { listRewards, REWARD_BY_ID, rewardConditionsMet, rewardsSystem, type ApprovalRewardData } from '../../src/sim/economy/rewards';
import { normalizeReward } from '../../src/game/modules';

function state(difficulty: Difficulty = 'medium', day = 0): CityState {
  const st = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false, difficulty }));
  st.stats.population = 2500;
  st.stats.approval = 55;
  st.day = day;
  return st;
}

function data(st: CityState): ApprovalRewardData {
  return (st.systemData.economy as { approvalReward: ApprovalRewardData }).approvalReward;
}

function fixture(months = 6): CityState {
  const st = state();
  (econData(st) as ReturnType<typeof econData> & { approvalReward: ApprovalRewardData }).approvalReward = { month: 0, months };
  return st;
}

function town(difficulty: Difficulty = 'medium', day = 0) {
  const st = state(difficulty, day);
  const rewards = rewardsSystem(new EconRuntime());
  const sim = new Simulation(st, [rewards]);
  return { st, sim, rewards };
}

describe('FH-26 Statue approval condition', () => {
  it('accepts exactly 2,500 residents, 55 approval and six qualifying months', () => {
    expect(rewardConditionsMet(fixture(), REWARD_BY_ID.get('statue')!)).toBe(true);
  });

  it.each([
    ['population below 2,500', (st: CityState) => { st.stats.population = 2499; }],
    ['approval below 55', (st: CityState) => { st.stats.approval = 54.999; }],
    ['only five qualifying months', (st: CityState) => { data(st).months = 5; }],
    ['65 approval without a six-month streak', (st: CityState) => { st.stats.approval = 65; data(st).months = 0; }],
  ] as const)('refuses %s', (_label, miss) => {
    const st = fixture();
    miss(st);
    expect(rewardConditionsMet(st, REWARD_BY_ID.get('statue')!)).toBe(false);
  });

  it.each(['easy', 'medium', 'hard'] as const)('requires the same six complete months on %s', (difficulty) => {
    const { st, sim, rewards } = town(difficulty);
    const unlocked = vi.fn();
    sim.events.on('unlocked', unlocked);
    const rng = sim.rng.state;
    const draw = vi.spyOn(sim.rng, 'next');
    expect(data(st).months).toBe(0);
    expect(st.unlocked.has('statue')).toBe(false);
    sim.runDays(179);
    expect(data(st).months).toBe(5);
    expect(st.unlocked.has('statue')).toBe(false);
    sim.runDays(1);
    expect(data(st).months).toBe(6);
    expect(st.unlocked.has('statue')).toBe(true);
    expect(st.announced.has('statue')).toBe(true);
    expect(st.news.filter((n) => n.ref?.reward === 'statue')).toHaveLength(1);
    expect(unlocked.mock.calls.filter(([id]) => id === 'statue')).toHaveLength(1);
    rewards.monthly!(sim);
    sim.runDays(30);
    expect(data(st).months).toBe(6);
    expect(st.news.filter((n) => n.ref?.reward === 'statue')).toHaveLength(1);
    expect(draw).not.toHaveBeenCalled();
    expect(sim.rng.state).toBe(rng);
  });

  it('retains sandbox instant unlocks', () => {
    const st = new CityState(defaultCityConfig({ size: 16, difficulty: 'sandbox', sandbox: true }));
    new Simulation(st, [rewardsSystem(new EconRuntime())]);
    expect(st.unlocked.has('statue')).toBe(true);
  });

  it.each([
    ['approval', (st: CityState) => { st.stats.approval = 54.9; }, (st: CityState) => { st.stats.approval = 55; }],
    ['population', (st: CityState) => { st.stats.population = 2499; }, (st: CityState) => { st.stats.population = 2500; }],
  ] as const)('restarts after a daily %s setback even when recovered before month end', (_label, interrupt, recover) => {
    const { st, sim } = town();
    sim.runDays(150);
    interrupt(st);
    sim.runDays(1);
    expect(data(st).months).toBe(0);
    expect(data(st).interrupted).toBe(true);
    recover(st);
    sim.runDays(29);
    expect(data(st).months).toBe(0);
    sim.runDays(150);
    expect(data(st).months).toBe(5);
    expect(st.unlocked.has('statue')).toBe(false);
    sim.runDays(30);
    expect(st.unlocked.has('statue')).toBe(true);
  });

  it('does not count an old save\'s first partial calendar month', () => {
    const { st, sim } = town('medium', 15);
    expect(data(st)).toMatchObject({ month: 1, months: 0 });
    sim.runDays(15);
    expect(data(st).months).toBe(0);
    sim.runDays(150);
    expect(data(st).months).toBe(5);
    expect(st.unlocked.has('statue')).toBe(false);
    sim.runDays(30);
    expect(st.day).toBe(210);
    expect(st.unlocked.has('statue')).toBe(true);
  });

  it('does not count repeated monthly checks or initialization twice', () => {
    const { st, sim, rewards } = town();
    sim.runDays(90);
    const before = structuredClone(data(st));
    rewards.monthly!(sim);
    rewards.monthly!(sim);
    rewards.init!(sim);
    expect(data(st)).toEqual(before);
    sim.runDays(30);
    expect(data(st).months).toBe(4);
  });

  it('does not credit a gap in recorded calendar months', () => {
    const { st, sim, rewards } = town();
    sim.runDays(30);
    st.day = 90;
    rewards.monthly!(sim);
    expect(data(st).months).toBe(1);
  });

  it('continues the streak on the same date through save/load', () => {
    const { st, sim } = town();
    sim.runDays(100);
    const loaded = deserializeCity(serializeCity(st, { copy: true }));
    expect(data(loaded)).toEqual(data(st));
    expect(data(loaded)).not.toBe(data(st));
    const resumed = new Simulation(loaded, [rewardsSystem(new EconRuntime())]);
    expect(data(loaded).months).toBe(3);
    sim.runDays(80);
    resumed.runDays(80);
    expect(data(loaded)).toEqual(data(st));
    expect(loaded.day).toBe(180);
    expect([...loaded.unlocked]).toEqual([...st.unlocked]);
    expect(loaded.news).toEqual(st.news);
    expect(resumed.rng.state).toBe(sim.rng.state);
    expect(loaded.unlocked.has('statue')).toBe(true);
  });

  it('persists a recovered midmonth interruption through save/load', () => {
    const { st, sim } = town();
    sim.runDays(151);
    st.stats.approval = 54;
    sim.runDays(1);
    st.stats.approval = 55;
    const loaded = deserializeCity(serializeCity(st, { copy: true }));
    const resumed = new Simulation(loaded, [rewardsSystem(new EconRuntime())]);
    resumed.runDays(28);
    expect(loaded.day).toBe(180);
    expect(data(loaded).months).toBe(0);
    expect(loaded.unlocked.has('statue')).toBe(false);
  });

  it('preserves a Statue already earned at the old 65% condition', () => {
    const st = state('medium', 5400);
    st.stats.approval = 65;
    st.unlocked.add('statue');
    st.announced.add('statue');
    st.milestones.civ_statue = 1;
    const loaded = deserializeCity(serializeCity(st, { copy: true }));
    const sim = new Simulation(loaded, [rewardsSystem(new EconRuntime())]);
    expect(data(loaded).months).toBe(0);
    loaded.stats.population = 0;
    loaded.stats.approval = 0;
    sim.runDays(180);
    expect(loaded.unlocked.has('statue')).toBe(true);
    expect(loaded.milestones.civ_statue).toBe(1);
    expect(loaded.news.filter((n) => n.ref?.reward === 'statue')).toEqual([]);
    expect(listRewards(loaded).find((r) => r.id === 'statue')).toMatchObject({ unlocked: true, built: true, progress: 1 });
  });

  it('keeps a newly earned Statue permanently after approval falls', () => {
    const { st, sim } = town();
    sim.runDays(180);
    st.stats.approval = 20;
    sim.runDays(30);
    expect(data(st).months).toBe(0);
    expect(st.unlocked.has('statue')).toBe(true);
    expect(st.news.filter((n) => n.ref?.reward === 'statue')).toHaveLength(1);
  });
});

describe('FH-26 mirrored progress', () => {
  it('normalizes the exact condition and six-month progress for the Rewards panel', () => {
    const st = fixture(3);
    const row = normalizeReward(listRewards(st).find((r) => r.id === 'statue'));
    expect(row).toMatchObject({
      id: 'statue', unlocked: false, progress: 0.5, category: 'reward',
      description: 'Keep 2,500 residents and, for six months, either approval of at least 55% or a recovery of 10 points from its lowest recorded approval.',
      requirement: 'Population 2,500 / 2,500 \u00b7 Approval 55 / 55 \u00b7 Months at approval \u226555% 3 / 6 OR +0.0 / 10 points from lowest 55.0% \u00b7 Recovery months 0 / 6',
      defIds: ['civ_statue'],
    });
  });

  it('lists progress from mirrored state without changing it or consulting buildings', () => {
    const st = fixture(3);
    const before = structuredClone({ stats: st.stats, systemData: st.systemData, unlocked: st.unlocked });
    const mirrored = new Proxy(st, {
      get(target, key, receiver) {
        if (key === 'buildings' || key === 'airPollution' || key === 'noise') throw new Error('Unmirrored read');
        return Reflect.get(target, key, receiver);
      },
      set() { throw new Error('Replica mutation'); },
    });
    expect(listRewards(mirrored)).toEqual(listRewards(st));
    expect({ stats: st.stats, systemData: st.systemData, unlocked: st.unlocked }).toEqual(before);
  });
});
