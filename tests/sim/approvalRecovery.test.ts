import { describe, expect, it, vi } from 'vitest';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { listRewards, REWARD_BY_ID, rewardConditionsMet, rewardsSystem, type ApprovalRewardData } from '../../src/sim/economy/rewards';

function state(approval = 40.125, population = 2500, day = 0): CityState {
  const st = new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false }));
  st.stats.approval = approval;
  st.stats.population = population;
  st.day = day;
  return st;
}

function data(st: CityState): ApprovalRewardData {
  return (st.systemData.economy as { approvalReward: ApprovalRewardData }).approvalReward;
}

function start(st = state()) {
  const rewards = rewardsSystem(new EconRuntime());
  const sim = new Simulation(st, [rewards]);
  return { st, sim, rewards };
}

function recovering(lowest = 40.125) {
  const town = start(state(lowest));
  town.sim.runDays(30);
  town.st.stats.approval = lowest + 10;
  return town;
}

describe('FH-26 approval recovery alternative', () => {
  it('earns the Statue below 55 after six full months exactly ten points above the raw lowest approval', () => {
    const { st, sim, rewards } = recovering();
    const rng = sim.rng.state;
    const draw = vi.spyOn(sim.rng, 'next');
    const unlocked = vi.fn();
    sim.events.on('unlocked', unlocked);
    expect(data(st).lowestApproval).toBe(40.125);
    sim.runDays(179);
    expect(data(st).months).toBe(0);
    expect(data(st).recoveryMonths).toBe(5);
    expect(st.unlocked.has('statue')).toBe(false);
    sim.runDays(1);
    expect(st.day).toBe(210);
    expect(data(st).recoveryMonths).toBe(6);
    expect(st.unlocked.has('statue')).toBe(true);
    rewards.monthly!(sim);
    sim.runDays(30);
    expect(st.news.filter((n) => n.ref?.reward === 'statue')).toHaveLength(1);
    expect(unlocked.mock.calls.filter(([id]) => id === 'statue')).toHaveLength(1);
    expect(draw).not.toHaveBeenCalled();
    expect(sim.rng.state).toBe(rng);
  });

  it('does not round a recovery just short of ten points up to the threshold', () => {
    const { st, sim } = recovering();
    st.stats.approval = 50.124999;
    sim.runDays(180);
    expect(data(st).lowestApproval).toBe(40.125);
    expect(data(st).recoveryMonths).toBe(0);
    expect(st.unlocked.has('statue')).toBe(false);
    st.stats.approval = 50.125;
    sim.runDays(180);
    expect(data(st).recoveryMonths).toBe(6);
    expect(st.unlocked.has('statue')).toBe(true);
  });

  it('records a lower approval before reaching 2,500 residents but credits no under-population months', () => {
    const { st, sim } = start(state(42.75, 0));
    sim.runDays(30);
    st.stats.approval = 36.25;
    sim.runDays(1);
    expect(data(st).lowestApproval).toBe(36.25);
    st.stats.approval = 46.25;
    st.stats.population = 2499;
    sim.runDays(29);
    expect(data(st).recoveryMonths).toBe(0);
    st.stats.population = 2500;
    sim.runDays(180);
    expect(data(st).lowestApproval).toBe(36.25);
    expect(st.unlocked.has('statue')).toBe(true);
  });

  it('restarts recovery after a daily setback even if approval recovers before month end', () => {
    const { st, sim } = recovering();
    sim.runDays(150);
    expect(data(st).recoveryMonths).toBe(5);
    st.stats.approval = 50;
    sim.runDays(1);
    expect(data(st).recoveryMonths).toBe(0);
    expect(data(st).recoveryInterrupted).toBe(true);
    st.stats.approval = 50.125;
    sim.runDays(29);
    expect(data(st).recoveryMonths).toBe(0);
    sim.runDays(150);
    expect(data(st).recoveryMonths).toBe(5);
    expect(st.unlocked.has('statue')).toBe(false);
    sim.runDays(30);
    expect(st.unlocked.has('statue')).toBe(true);
  });

  it('restarts both approval routes after a daily population setback', () => {
    const { st, sim } = recovering(46);
    sim.runDays(150);
    expect(data(st)).toMatchObject({ months: 5, recoveryMonths: 5 });
    st.stats.population = 2499;
    sim.runDays(1);
    expect(data(st)).toMatchObject({ months: 0, recoveryMonths: 0, interrupted: true, recoveryInterrupted: true });
    st.stats.population = 2500;
    sim.runDays(29);
    expect(data(st)).toMatchObject({ months: 0, recoveryMonths: 0 });
    sim.runDays(180);
    expect(st.unlocked.has('statue')).toBe(true);
  });

  it('requires a completed route rather than adding progress from separate routes', () => {
    const { st } = recovering();
    Object.assign(data(st), { months: 3, recoveryMonths: 3 });
    expect(rewardConditionsMet(st, REWARD_BY_ID.get('statue')!)).toBe(false);
    expect(listRewards(st).find((r) => r.id === 'statue')?.progress).toBe(0.5);
  });

  it('keeps the original 55% route available without a ten-point recovery', () => {
    const { st, sim } = start(state(55));
    sim.runDays(179);
    expect(data(st)).toMatchObject({ lowestApproval: 55, months: 5, recoveryMonths: 0 });
    expect(st.unlocked.has('statue')).toBe(false);
    sim.runDays(1);
    expect(st.unlocked.has('statue')).toBe(true);
  });
});

describe('FH-26 recovery persistence and migration', () => {
  it('initializes old saves from current exact approval without inventing a minimum or past hold from rounded history', () => {
    const st = state(54.25, 2500, 3615);
    st.history.t = [119];
    st.history.approval = [40];
    const { sim } = start(st);
    expect(data(st)).toMatchObject({ lowestApproval: 54.25, months: 0, recoveryMonths: 0 });
    expect(st.unlocked.has('statue')).toBe(false);
    sim.runDays(15);
    expect(data(st).recoveryMonths).toBe(0);
    st.stats.approval = 64.25;
    sim.runDays(179);
    expect(data(st).recoveryMonths).toBe(5);
    sim.runDays(1);
    expect(st.unlocked.has('statue')).toBe(true);
  });

  it('preserves the existing 55% timer when migrating optional recovery fields', () => {
    const st = state(55, 2500, 90);
    (econData(st) as ReturnType<typeof econData> & { approvalReward: ApprovalRewardData }).approvalReward = { month: 3, months: 3 };
    const { sim } = start(st);
    expect(data(st)).toMatchObject({ lowestApproval: 55, months: 3, recoveryMonths: 0 });
    sim.runDays(90);
    expect(st.unlocked.has('statue')).toBe(true);
  });

  it('does not credit the partial load month when migrating an existing approval timer', () => {
    const st = state(40, 2500, 100);
    (econData(st) as ReturnType<typeof econData> & { approvalReward: ApprovalRewardData }).approvalReward = { month: 3, months: 2 };
    const { sim } = start(st);
    expect(data(st)).toMatchObject({ lowestApproval: 40, recoveryMonths: 0, recoveryInterrupted: true });
    st.stats.approval = 50;
    sim.runDays(20);
    expect(st.day).toBe(120);
    expect(data(st).recoveryMonths).toBe(0);
    sim.runDays(30);
    expect(st.day).toBe(150);
    expect(data(st).recoveryMonths).toBe(1);
  });

  it('continues the exact saved minimum and recovery timer on the same date through save/load', () => {
    const { st, sim, rewards } = recovering();
    sim.runDays(80);
    st.history.t = [1];
    st.history.approval = [40];
    const loaded = deserializeCity(serializeCity(st, { copy: true }));
    const resumed = start(loaded);
    expect(data(loaded)).toEqual(data(st));
    expect(data(loaded).lowestApproval).toBe(40.125);
    rewards.init!(sim);
    resumed.rewards.init!(resumed.sim);
    expect(data(loaded)).toEqual(data(st));
    sim.runDays(100);
    resumed.sim.runDays(100);
    expect(st.day).toBe(210);
    expect(data(loaded)).toEqual(data(st));
    expect([...loaded.unlocked]).toEqual([...st.unlocked]);
    expect(loaded.news).toEqual(st.news);
    expect(resumed.sim.rng.state).toBe(sim.rng.state);
    expect(loaded.unlocked.has('statue')).toBe(true);
  });

  it('persists a recovered midmonth interruption and later updates the exact minimum', () => {
    const { st, sim } = recovering();
    sim.runDays(151);
    st.stats.approval = 50;
    sim.runDays(1);
    st.stats.approval = 50.125;
    const loaded = deserializeCity(serializeCity(st, { copy: true }));
    const resumed = start(loaded);
    resumed.sim.runDays(28);
    expect(loaded.day).toBe(210);
    expect(data(loaded).recoveryMonths).toBe(0);
    expect(loaded.unlocked.has('statue')).toBe(false);
    loaded.stats.approval = 39.9875;
    resumed.sim.runDays(1);
    expect(data(loaded).lowestApproval).toBe(39.9875);
  });

  it('lists recovery progress purely from the mirrored state', () => {
    const { st, sim } = recovering();
    sim.runDays(90);
    const before = structuredClone({ stats: st.stats, systemData: st.systemData, unlocked: st.unlocked });
    const mirrored = new Proxy(st, {
      get(target, key, receiver) {
        if (key === 'buildings' || key === 'history' || key === 'airPollution' || key === 'noise') throw new Error('Unmirrored read');
        return Reflect.get(target, key, receiver);
      },
      set() { throw new Error('Replica mutation'); },
    });
    const row = listRewards(mirrored).find((r) => r.id === 'statue')!;
    expect(row.progress).toBe(0.5);
    expect(row.progressText).toMatch(/or/i);
    expect(row.progressText).toContain('+10.0');
    expect(row.progressText).toContain('40.1');
    expect(row.progressText).toMatch(/Recovery months 3 \/ 6/i);
    expect(listRewards(mirrored)).toEqual(listRewards(st));
    expect({ stats: st.stats, systemData: st.systemData, unlocked: st.unlocked }).toEqual(before);
  });
});
