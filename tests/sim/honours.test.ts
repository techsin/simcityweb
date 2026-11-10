import { describe, expect, it, vi } from 'vitest';
import { BF, CityState, type Building, type Loan } from '../../src/sim/CityState';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation } from '../../src/sim/Simulation';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { HONOURS, listMilestones, listRewards, rewardConditionsMet, rewardsSystem, type HonoursData } from '../../src/sim/economy/rewards';
import * as catchments from '../../src/sim/infra/catchments';

function state(): CityState {
  const st = new CityState(defaultCityConfig({ size: 32, seed: 7, terrain: 'flat', disasters: false }));
  Object.assign(st.stats, {
    population: 1500000, eq: 130, hq: 130, avgAir: 0.10, unemployment: 0.03,
    tripsCar: 75, tripsTransit: 25, tripsWalk: 0, tourists: 50000,
  });
  return st;
}

function data(st: CityState): HonoursData {
  return (st.systemData.economy as { honours: HonoursData }).honours;
}

function fixture(): CityState {
  const st = state();
  (econData(st) as ReturnType<typeof econData> & { honours: HonoursData }).honours = {
    month: 0, cleanAir: 12, safeCity: 60, employment: 24, books: 120,
    homes: 10, noisyShare: 0.049999, parkShare: 0.30,
  };
  return st;
}

function home(st: CityState, fields: Partial<Building> = {}): Building {
  const b: Building = {
    id: st.nextBuildingId++, def: 'res_cottage.r1.2', pop: 1, built: 1, flags: 0,
    x: 8, z: 8, w: 1, d: 1, rot: 0, variant: 0, jobs: 0, capacity: 10,
    wealth: 1, age: 1, baseY: 0, health: 1, unhappy: 0, ...fields,
  };
  st.buildings.set(b.id, b);
  st.building[st.idx(b.x, b.z)] = b.id;
  return b;
}

function town(day = 0) {
  const st = state();
  st.stats.population = 500000;
  st.day = day;
  home(st);
  const rewards = rewardsSystem(new EconRuntime());
  const sim = new Simulation(st, [rewards]);
  return { st, sim, rewards };
}

const loan = (): Loan => ({ principal: 10000, remaining: 10000, rate: 0.05, monthlyPayment: 100, monthsLeft: 120 });
const honour = (id: string) => HONOURS.find((r) => r.id === 'honour_' + id)!;
type Miss = [string, (st: CityState) => void];
const CONDITIONS: [string, Miss[]][] = [
  ['clean_air_metropolis', [
    ['population below 250,000', (st) => { st.stats.population = 249999; }],
    ['air above 0.10', (st) => { st.stats.avgAir = 0.100001; }],
    ['only eleven qualifying months', (st) => { data(st).cleanAir = 11; }],
  ]],
  ['transit_capital', [
    ['population below 200,000', (st) => { st.stats.population = 199999; }],
    ['transit below one quarter of all trips', (st) => { st.stats.tripsWalk = 1; }],
    ['no trips', (st) => { st.stats.tripsCar = st.stats.tripsTransit = st.stats.tripsWalk = 0; }],
  ]],
  ['scholar_city', [['EQ below 130', (st) => { st.stats.eq = 129.999; }]]],
  ['healthy_city', [['HQ below 130', (st) => { st.stats.hq = 129.999; }]]],
  ['safe_city', [
    ['population below 100,000', (st) => { st.stats.population = 99999; }],
    ['a failed emergency in the rolled month', (st) => { st.stats.emergency.lastMonth.failed = 1; }],
    ['only 59 safe months', (st) => { data(st).safeCity = 59; }],
  ]],
  ['tourist_capital', [['fewer than 50,000 tourists/day', (st) => { st.stats.tourists = 49999; }]]],
  ['full_employment', [
    ['population below 500,000', (st) => { st.stats.population = 499999; }],
    ['unemployment above 3%', (st) => { st.stats.unemployment = 0.030001; }],
    ['only 23 qualifying months', (st) => { data(st).employment = 23; }],
  ]],
  ['green_belt', [['fewer than 30% of homes in reach', (st) => { data(st).parkShare = 0.299999; }]]],
  ['balanced_books', [
    ['an outstanding loan', (st) => { st.budget.loans.push(loan()); }],
    ['any tax above 9%', (st) => { st.budget.taxRates[11] = 9.1; }],
    ['only 119 loan-free months', (st) => { data(st).books = 119; }],
  ]],
  ['quiet_city', [
    ['population below 250,000', (st) => { st.stats.population = 249999; }],
    ['exactly 5% noisy homes', (st) => { data(st).noisyShare = 0.05; }],
    ['more than 5% noisy homes', (st) => { data(st).noisyShare = 0.050001; }],
  ]],
  ['megacity', [['population below one million', (st) => { st.stats.population = 999999; }]]],
  ['megalopolis', [['population below 1.5 million', (st) => { st.stats.population = 1499999; }]]],
];
const POPULATION: Record<string, number> = {
  clean_air_metropolis: 250000, transit_capital: 200000, safe_city: 100000,
  full_employment: 500000, quiet_city: 250000, megacity: 1000000, megalopolis: 1500000,
};

describe('LG-20 honour conditions', () => {
  it('keeps sandbox honours as earned goals while preserving ordinary sandbox unlocks', () => {
    const st = state();
    st.config.sandbox = true;
    st.stats.eq = 129;
    const sim = new Simulation(st, [rewardsSystem(new EconRuntime())]);
    expect(st.unlocked.has('statue')).toBe(true);
    expect(listRewards(st).filter((r) => r.kind === 'honour').every((r) => !r.unlocked)).toBe(true);
    home(st);
    st.stats.eq = 130;
    sim.runDays(30);
    expect(st.unlocked.has('honour_scholar_city')).toBe(true);
  });

  it('defines all twelve honours with distinct commemorative plaques', () => {
    expect(HONOURS).toHaveLength(12);
    expect(HONOURS.map((r) => r.id)).toEqual(CONDITIONS.map(([id]) => 'honour_' + id));
    expect(new Set(HONOURS.map((r) => r.defIds[0])).size).toBe(12);
    for (const r of HONOURS) {
      expect(r.kind).toBe('honour');
      expect(r.defIds[0]).toBe('rw_' + r.id + '_plaque');
    }
    expect(honour('clean_air_metropolis').defIds).toContain('rw_eco_plaza');
    expect(honour('safe_city').defIds).toContain('rw_firefighters_memorial');
  });

  for (const [id, misses] of CONDITIONS) describe(id, () => {
    it('meets its condition at the inclusive thresholds', () => {
      const st = fixture();
      if (POPULATION[id] !== undefined) st.stats.population = POPULATION[id];
      expect(rewardConditionsMet(st, honour(id))).toBe(true);
    });
    it('requires occupied homes rather than empty-map statistics', () => {
      const st = fixture();
      data(st).homes = 0;
      expect(rewardConditionsMet(st, honour(id))).toBe(false);
    });
    for (const [name, miss] of misses) it('misses with ' + name, () => {
      const st = fixture();
      miss(st);
      expect(rewardConditionsMet(st, honour(id))).toBe(false);
    });
  });
});

describe('LG-20 occupied-home survey', () => {
  it('does not count a touched reach cell whose service weight is zero', () => {
    const st = state();
    home(st);
    home(st, { x: 30, z: 30 });
    home(st, { def: 'park_large', x: 8, z: 10, w: 4, d: 4, pop: 0, flags: BF.Plopped });
    const near = st.idx(8, 8), distant = st.idx(30, 30);
    const best = new Float32Array(st.cells);
    best[near] = 1;
    const reach = vi.spyOn(catchments, 'reachRaw').mockReturnValue(2);
    const result = vi.spyOn(catchments, 'reachResult').mockReturnValue({ touched: new Int32Array([near, distant]), best });
    try {
      new Simulation(st, [rewardsSystem(new EconRuntime())]);
      expect(data(st).homes).toBe(2);
      expect(data(st).parkShare).toBe(0.5);
    } finally {
      reach.mockRestore();
      result.mockRestore();
    }
  });

  it.each([[20, false], [21, true]] as const)('counts one noisy home among %i homes independently of household size', (count, earned) => {
    const st = state();
    st.stats.population = 250000;
    for (let i = 0; i < count; i++) home(st, { x: 2 + i, z: 4, pop: i ? 100 : 1, flags: i ? 0 : BF.Noisy });
    home(st, { x: 2, z: 8, flags: BF.Abandoned | BF.Noisy });
    home(st, { x: 3, z: 8, flags: BF.Burnt | BF.Noisy });
    home(st, { x: 4, z: 8, built: 0.5, flags: BF.Noisy });
    home(st, { x: 5, z: 8, pop: 0, flags: BF.Noisy });
    new Simulation(st, [rewardsSystem(new EconRuntime())]);
    expect(data(st).homes).toBe(count);
    expect(data(st).noisyShare).toBe(1 / count);
    expect(st.unlocked.has('honour_quiet_city')).toBe(earned);
  });

  it.each([
    ['park_large', 1, 0, 0.5],
    ['park_small', 1, 0, 0],
    ['park_large', 0.5, 0, 0],
    ['park_large', 1, BF.Burnt, 0],
    ['park_large', 1, BF.Abandoned, 0],
  ] as const)('surveys %s at completion %s and flags %i', (def, built, flags, share) => {
    const st = state();
    home(st);
    home(st, { x: 30, z: 30 });
    home(st, { def, x: 8, z: 10, w: 4, d: 4, pop: 0, built, flags: flags | BF.Plopped });
    new Simulation(st, [rewardsSystem(new EconRuntime())]);
    expect(data(st).homes).toBe(2);
    expect(data(st).parkShare).toBe(share);
    expect(st.unlocked.has('honour_green_belt')).toBe(share >= 0.3);
  });
});

const STREAKS = [
  ['clean_air_metropolis', 'cleanAir', 12],
  ['safe_city', 'safeCity', 60],
  ['full_employment', 'employment', 24],
  ['balanced_books', 'books', 120],
] as const;

describe('LG-20 duration timers', () => {
  it.each(STREAKS)('%s reaches %s after exactly %i full qualifying months', (id, key, months) => {
    const { st, sim, rewards } = town();
    const unlocked = vi.fn();
    sim.events.on('unlocked', unlocked);
    const rng = sim.rng.state;
    const draw = vi.spyOn(sim.rng, 'next');
    expect(data(st)[key]).toBe(0);
    sim.runDays((months - 1) * 30);
    expect(data(st)[key]).toBe(months - 1);
    expect(st.unlocked.has('honour_' + id)).toBe(false);
    sim.runDays(30);
    expect(data(st)[key]).toBe(months);
    expect(st.unlocked.has('honour_' + id)).toBe(true);
    expect(st.announced.has('honour_' + id)).toBe(true);
    expect(st.news.filter((n) => n.ref?.reward === 'honour_' + id)).toHaveLength(1);
    expect(unlocked.mock.calls.filter(([value]) => value === 'honour_' + id)).toHaveLength(1);
    rewards.monthly!(sim);
    sim.runDays(30);
    expect(data(st)[key]).toBe(months);
    expect(st.news.filter((n) => n.ref?.reward === 'honour_' + id)).toHaveLength(1);
    expect(draw).not.toHaveBeenCalled();
    expect(sim.rng.state).toBe(rng);
  });

  it('does not count the same month twice through monthly checks or reinitialization', () => {
    const { st, sim, rewards } = town();
    sim.runDays(30);
    const before = structuredClone(data(st));
    rewards.monthly!(sim);
    rewards.monthly!(sim);
    rewards.init!(sim);
    expect(data(st)).toEqual(before);
    sim.runDays(30);
    for (const [, key] of STREAKS) expect(data(st)[key]).toBe(2);
  });

  it('starts old saves at zero and does not credit their first partial calendar month', () => {
    const { st, sim } = town(15);
    expect(data(st).month).toBe(1);
    sim.runDays(15);
    for (const [, key] of STREAKS) expect(data(st)[key]).toBe(0);
    sim.runDays(30);
    for (const [, key] of STREAKS) expect(data(st)[key]).toBe(1);
  });

  it('does not turn a skipped month into consecutive duration credit', () => {
    const { st, sim, rewards } = town();
    sim.runDays(30);
    st.day = 90;
    rewards.monthly!(sim);
    for (const [, key] of STREAKS) expect(data(st)[key]).toBe(1);
  });

  it('round-trips an eleven-month streak and earns on the same date after loading', () => {
    const { st, sim } = town();
    sim.runDays(11 * 30 + 12);
    const saved = serializeCity(st, { copy: true });
    const loaded = deserializeCity(saved);
    expect(data(loaded)).toEqual(data(st));
    expect(data(loaded)).not.toBe(data(st));
    const resumed = new Simulation(loaded, [rewardsSystem(new EconRuntime())]);
    expect(data(loaded).cleanAir).toBe(11);
    sim.runDays(18);
    resumed.runDays(18);
    expect(loaded.day).toBe(360);
    expect(data(loaded)).toEqual(data(st));
    expect([...loaded.unlocked]).toEqual([...st.unlocked]);
    expect(loaded.news).toEqual(st.news);
    expect(resumed.rng.state).toBe(sim.rng.state);
    expect(loaded.unlocked.has('honour_clean_air_metropolis')).toBe(true);
  });

  it.each([
    ['cleanAir', (st: CityState) => { st.stats.avgAir = 0.100001; }, (st: CityState) => { st.stats.avgAir = 0.10; }],
    ['safeCity', (st: CityState) => { st.stats.emergency.month.failed = 1; }, (st: CityState) => { st.stats.emergency.month.failed = 0; }],
    ['employment', (st: CityState) => { st.stats.unemployment = 0.030001; }, (st: CityState) => { st.stats.unemployment = 0.03; }],
    ['books', (st: CityState) => { st.budget.taxRates[0] = 9.1; }, (st: CityState) => { st.budget.taxRates[0] = 9; }],
  ] as const)('remembers a daily %s interruption even when recovered before month end', (key, interrupt, recover) => {
    const { st, sim } = town();
    sim.runDays(5 * 30);
    expect(data(st)[key]).toBe(5);
    interrupt(st);
    sim.runDays(1);
    expect(data(st)[key]).toBe(0);
    recover(st);
    sim.runDays(29);
    expect(data(st)[key]).toBe(0);
    sim.runDays(30);
    expect(data(st)[key]).toBe(1);
  });

  it.each([
    ['cleanAir', 249999], ['safeCity', 99999], ['employment', 499999],
  ] as const)('resets %s when population falls below its own threshold', (key, population) => {
    const { st, sim } = town();
    sim.runDays(5 * 30);
    st.stats.population = population;
    sim.runDays(1);
    expect(data(st)[key]).toBe(0);
  });

  it('uses the rolled emergency month and requires another full five years after a failure', () => {
    const { st, sim } = town();
    sim.runDays(59 * 30);
    st.stats.emergency.lastMonth.failed = 1;
    sim.runDays(30);
    expect(data(st).safeCity).toBe(0);
    expect(st.unlocked.has('honour_safe_city')).toBe(false);
    st.stats.emergency.lastMonth.failed = 0;
    sim.runDays(59 * 30);
    expect(st.unlocked.has('honour_safe_city')).toBe(false);
    sim.runDays(30);
    expect(st.unlocked.has('honour_safe_city')).toBe(true);
  });

  it.each([
    ['outstanding loan', (st: CityState) => { st.budget.loans.push(loan()); }],
    ['loan borrowed and repaid before the daily check', (st: CityState) => { st.budget.curIncome['oneoff:loan'] = 10000; }],
    ['loan proceeds rolled by the budget', (st: CityState) => { st.budget.lastIncome['oneoff:loan'] = 10000; }],
    ['a final amortization payment', (st: CityState) => { st.budget.lastExpense.loan = 100; }],
  ] as const)('interrupts Balanced Books after %s', (_name, interrupt) => {
    const { st, sim } = town();
    sim.runDays(119 * 30);
    interrupt(st);
    sim.runDays(30);
    expect(data(st).books).toBe(0);
    expect(st.unlocked.has('honour_balanced_books')).toBe(false);
  });

  it('keeps earned honours and plaques after their conditions deteriorate', () => {
    const { st, sim } = town();
    sim.runDays(120 * 30);
    const earned = STREAKS.map(([id]) => 'honour_' + id);
    const news = st.news.length;
    Object.assign(st.stats, { population: 0, avgAir: 1, unemployment: 1 });
    st.stats.emergency.month.failed = 1;
    st.budget.taxRates.fill(20);
    sim.runDays(30);
    for (const id of earned) {
      expect(st.unlocked.has(id)).toBe(true);
      expect(listRewards(st).find((r) => r.id === id)).toMatchObject({ unlocked: true, progress: 1 });
    }
    expect(st.news).toHaveLength(news);
  });
});

describe('LG-20 mirrored progress', () => {
  it('reads stored surveys without buildings, derived layers or state mutation', () => {
    const st = fixture();
    const before = structuredClone({ systemData: st.systemData, stats: st.stats, budget: st.budget, unlocked: st.unlocked, milestones: st.milestones });
    const forbidden = new Set(['buildings', 'airPollution', 'noise', 'parkCov', 'greenCov', 'eduCov', 'healthCov']);
    const mirrored = new Proxy(st, {
      get(target, key, receiver) {
        if (forbidden.has(String(key))) throw new Error('Unmirrored read: ' + String(key));
        return Reflect.get(target, key, receiver);
      },
      set() { throw new Error('Reward listing wrote into the replica'); },
    });
    expect(listRewards(mirrored)).toEqual(listRewards(st));
    expect(listRewards(mirrored)).toEqual(listRewards(st));
    expect({ systemData: st.systemData, stats: st.stats, budget: st.budget, unlocked: st.unlocked, milestones: st.milestones }).toEqual(before);
  });

  it('shows precise air and duration progress with the statistic holding the honour back', () => {
    const st = fixture();
    st.stats.population = 250000;
    st.stats.avgAir = 0.14;
    data(st).cleanAir = 5;
    const row = listRewards(st).find((r) => r.id === 'honour_clean_air_metropolis')!;
    expect(row.progress).toBe(5 / 12);
    expect(row.progressText).toBe('Population 250,000 / 250,000 \u00b7 Air at homes 0.14; needs \u2264 0.10 \u00b7 Clean-air months 5 / 12');
  });

  it('shows under-five-percent noise as a strict unmet boundary', () => {
    const st = fixture();
    data(st).noisyShare = 0.05;
    const row = listRewards(st).find((r) => r.id === 'honour_quiet_city')!;
    expect(row.unlocked).toBe(false);
    expect(row.progress).toBeLessThan(1);
    expect(row.progressText).toContain('Noisy homes 5.0%; needs < 5.0%');
  });

  it('keeps honours out of the population ladder and reports awarded plaques', () => {
    const st = fixture();
    expect(listMilestones(st).nextUnlocks.every((r) => r.kind !== 'honour')).toBe(true);
    st.unlocked.add('honour_scholar_city');
    expect(listRewards(st).find((r) => r.id === 'honour_scholar_city')).toMatchObject({
      kind: 'honour', unlocked: true, progress: 1,
      progressText: 'Earned \u00b7 Commemorative plaque awarded',
      defIds: ['rw_honour_scholar_city_plaque'],
    });
  });

  it('treats an old save without an honour survey as zero progress until surveyed', () => {
    const st = state();
    const before = structuredClone(st.systemData);
    for (const row of listRewards(st).filter((r) => r.kind === 'honour')) {
      expect(row.unlocked).toBe(false);
      expect(row.progress).toBe(0);
      expect(row.progressText).toContain('Occupied homes: no');
    }
    expect(st.systemData).toEqual(before);
  });
});
