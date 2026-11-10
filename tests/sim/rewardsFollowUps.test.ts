/**
 * T093's follow-ups (REVIEW-T093):
 * - decision 2: the Seaport's coastline is counted when asked, so a coast dug in the running game counts at once (it
 *   was cached per city object for the state's life: the running game kept "no" while a loaded game counted again);
 * - P1: the silent check (a new city's first init, an old save without the rank record) unlocks without news and emits
 *   no 'unlocked', which lit the Rewards badge and played the reward sound with nothing announced; the month tick
 *   still emits it once per reward.
 */
import { describe, expect, it } from 'vitest';
import { DevType } from '../../src/core/types';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig, type CityConfigData } from '../../src/sim/config';
import { REWARD_BY_ID, REWARDS, listRewards, rewardConditionsMet, rewardsSystem } from '../../src/sim/economy/rewards';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';

function city(cfg: Partial<CityConfigData> = {}): CityState {
  return new CityState(defaultCityConfig({ size: 16, seed: 7, terrain: 'flat', disasters: false, ...cfg }));
}

/** a dry map whose industry has the Seaport's 6,000 jobs (set again every day, before the rewards system) */
function dryIndustrialTown(): CityState {
  const st = city();
  st.water.fill(0);
  st.stats.jobsByDev[DevType.IA] = 7000;
  return st;
}
const jobs: SimSystem = { name: 'test.jobs', daily({ state }) { state.stats.jobsByDev[DevType.IA] = 7000; } };
/** the population the scripted town holds every day (before the rewards system) */
let residents = 0;
const people: SimSystem = { name: 'test.population', daily({ state }) { state.stats.population = residents; } };

/** dig `n` water cells (what terraforming's water recompute does to the array) */
function dig(st: CityState, n: number): void {
  for (let i = 0; i < n; i++) st.water[i] = 1;
}

const seaport = REWARD_BY_ID.get('seaport')!;

describe('T093 decision 2: the Seaport\'s coastline follows the water', () => {
  it('a coast dug after the first look counts at once, in the conditions and in the Rewards list', () => {
    const st = dryIndustrialTown();
    expect(rewardConditionsMet(st, seaport)).toBe(false);
    expect(listRewards(st).find((r) => r.id === 'seaport')!.progressText).toContain('Coastline: no');
    dig(st, 40);
    expect(rewardConditionsMet(st, seaport)).toBe(false); // 40 cells are no coastline
    dig(st, 41);
    expect(rewardConditionsMet(st, seaport)).toBe(true);
    expect(listRewards(st).find((r) => r.id === 'seaport')!.progressText).toContain('Coastline: yes');
    st.water.fill(0); // filled in again
    expect(rewardConditionsMet(st, seaport)).toBe(false);
  });

  it('the running game unlocks the Seaport at the first month tick after the coast is dug, with its news', () => {
    const st = dryIndustrialTown();
    for (const r of REWARDS) if (r.id !== 'seaport') st.unlocked.add(r.id);
    const sim = new Simulation(st, [jobs, rewardsSystem(new EconRuntime())]);
    const unlocked: string[] = [];
    sim.events.on('unlocked', (id) => unlocked.push(`${st.day}:${id}`));
    sim.runDays(30);
    expect(st.unlocked.has('seaport')).toBe(false);
    dig(st, 60);
    sim.runDays(30);
    expect(st.unlocked.has('seaport')).toBe(true);
    expect(unlocked).toEqual([`${st.day - (st.day % 30)}:seaport`]);
    expect(st.news.filter((n) => n.kind === 'reward').map((n) => n.ref?.reward)).toEqual(['seaport']);
  });
});

describe('T093 P1: the silent check emits no unlocked event', () => {
  it('a new sandbox city unlocks everything without news or an unlocked event', () => {
    const sim = new Simulation(city(), [rewardsSystem(new EconRuntime())]);
    const unlocked: string[] = [];
    sim.events.on('unlocked', (id) => unlocked.push(id));
    const box = city({ difficulty: 'sandbox' });
    expect(box.systemData.cityRanks).toBeUndefined();
    sim.replaceState(box); // the first init of a city without the rank record
    expect(box.unlocked.size).toBe(REWARDS.length);
    expect(unlocked).toEqual([]);
    expect(box.news.filter((n) => n.kind === 'reward')).toEqual([]);
    sim.runDays(60);
    expect(unlocked).toEqual([]);
  });

  it('a new town\'s first check is silent; what it earns later comes at a tick with one event and one news item each', () => {
    residents = 0;
    const sim = new Simulation(city(), [people, rewardsSystem(new EconRuntime())]);
    const unlocked: string[] = [];
    sim.events.on('unlocked', (id) => unlocked.push(id));
    const town = city();
    residents = town.stats.population = 4000; // over the Mayor's House, the Cemetery and the Lighthouse at its first init
    sim.replaceState(town);
    const first = [...town.unlocked];
    expect(first).toEqual(expect.arrayContaining(['mayor_house', 'cemetery', 'lm_lighthouse']));
    expect(first).not.toContain('lm_clock_tower');
    expect(unlocked).toEqual([]);
    residents = 6500; // over the Water Treatment Plant and the Clock Tower before the next tick
    sim.runDays(30);
    const later = [...town.unlocked].filter((id) => !first.includes(id));
    expect(later).toEqual(expect.arrayContaining(['water_treatment', 'lm_clock_tower']));
    expect(unlocked).toEqual(later);
    expect(town.news.filter((n) => n.kind === 'reward').map((n) => n.ref?.reward)).toEqual(later);
  });
});
