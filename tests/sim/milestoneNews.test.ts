import { describe, expect, it } from 'vitest';
import { CityState } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';
import { advisorData, advisorsSystem } from '../../src/sim/economy/advisors';
import { rewardsSystem } from '../../src/sim/economy/rewards';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { deserializeCity, serializeCity } from '../../src/save/serialize';

function state(population = 0): CityState {
  const st = new CityState(defaultCityConfig({ name: 'Queensbury', size: 64, seed: 7, disasters: false }));
  st.stats.population = population;
  return st;
}

function city(st = state()) {
  const adv = advisorsSystem(new EconRuntime());
  const sim = new Simulation(st, [adv]);
  const population = (pop: number) => {
    st.stats.population = pop;
    adv.daily!(sim);
  };
  return { st, sim, population };
}

const stages = (st: CityState) => st.news.filter((n) => n.text.startsWith('New building stage unlocked:'));
const stagePops = [3000, 12000, 35000, 90000, 220000];

describe('milestone news', () => {
  it('crossing 35,000 posts the first towers once, including after a population drop', () => {
    const c = city(state(34999));
    c.population(35000);
    c.population(36000);
    c.population(0);
    c.population(35000);
    expect(stages(c.st)).toHaveLength(1);
    expect(stages(c.st)[0].text).toMatch(/the first towers.*35,000 residents/);
    expect(stages(c.st)[0]).toMatchObject({ kind: 'good', advisor: 'news' });
  });

  it.each([false, true])('loading a 300k old save is silent (existing advisors: %s)', (existing) => {
    const st = state(300000);
    st.day = 1000;
    if (existing) advisorData(st);
    const loaded = deserializeCity(serializeCity(st, { copy: true }));
    const c = city(loaded);
    expect(c.st.news).toHaveLength(0);
    c.population(300000);
    c.population(0);
    c.population(300000);
    expect(c.st.news).toHaveLength(0);
    expect(advisorData(c.st).stageMilestone).toBe(220000);
  });

  it('save/load keeps an announced stage and announces only the next stage', () => {
    const c = city(state(2999));
    c.population(3000);
    const loaded = deserializeCity(serializeCity(c.st, { copy: true }));
    const resumed = city(loaded);
    resumed.population(2999);
    resumed.population(3000);
    expect(stages(loaded)).toHaveLength(1);
    resumed.population(12000);
    resumed.population(12000);
    expect(stages(loaded)).toHaveLength(2);
    expect(stages(loaded)[1].text).toMatch(/high-rise buildings.*12,000 residents/);
  });

  it('announces all five stages once when a growing city reaches them', () => {
    const c = city();
    for (const pop of stagePops) {
      c.population(pop - 1);
      c.population(pop);
      c.population(pop);
    }
    const news = stages(c.st);
    expect(news).toHaveLength(5);
    for (const pop of stagePops) {
      expect(news.filter((n) => n.text.includes(`(${pop.toLocaleString('en-US')} residents)`))).toHaveLength(1);
    }
    const resumed = city(deserializeCity(serializeCity(c.st, { copy: true })));
    for (const pop of [0, ...stagePops]) resumed.population(pop);
    expect(stages(resumed.st).map((n) => n.text)).toEqual(news.map((n) => n.text));
  });

  it('a first-day population jump announces all passed stages without drawing RNG', () => {
    const c = city();
    const before = c.sim.rng.state;
    c.population(300000);
    expect(stages(c.st)).toHaveLength(5);
    expect(c.sim.rng.state).toBe(before);
    expect(c.st.systemData.simRng).toBeUndefined();
  });

  it('keeps the existing first daily headline schedule for a save without advisors', () => {
    const st = state(300000);
    st.day = 1000;
    const c = city(st);
    expect(st.systemData.advisors).toBeUndefined();
    st.day++;
    c.population(300000);
    expect(advisorData(st).nextHeadline).toBe(1031);
    expect(st.news).toHaveLength(0);
  });

  it('announces 1.25M and 1.5M population milestones once each', () => {
    const c = city(state(1249999));
    c.population(1250000);
    c.population(1500000);
    c.population(1000000);
    c.population(1500000);
    expect(c.st.news.map((n) => n.text)).toEqual([
      'Queensbury reaches 1,250,000 residents!',
      'Queensbury reaches 1,500,000 residents!',
    ]);
  });
});

describe('reward news references', () => {
  it('posts reward ids for rewards and landmarks and preserves them through save/load', () => {
    const st = state();
    const rewards = rewardsSystem(new EconRuntime());
    const sim = new Simulation(st, [rewards]);
    st.stats.population = 3000;
    const before = sim.rng.state;
    rewards.monthly!(sim);
    const refs = st.news.map((n) => n.ref?.reward);
    expect(refs).toContain('mayor_house');
    expect(refs).toContain('lm_lighthouse');
    for (const n of st.news) {
      expect(n.kind).toBe('reward');
      expect(n.ref?.reward).toBeTypeOf('string');
      expect(st.unlocked.has(n.ref!.reward!)).toBe(true);
    }
    rewards.monthly!(sim);
    expect(st.news.map((n) => n.ref?.reward)).toEqual(refs);
    const loaded = deserializeCity(serializeCity(st, { copy: true }));
    expect(loaded.news.map((n) => n.ref?.reward)).toEqual(refs);
    expect(sim.rng.state).toBe(before);
  });
});
