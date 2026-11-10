/** LG-02: late-game rewards, working services and tourism calibrated to the legacy cap-relief formula. */
import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { CAP_RELIEF, getDef } from '../../src/sim/catalog';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { approvalSystem } from '../../src/sim/economy/approval';
import { computeMonthlyBudget } from '../../src/sim/economy/budget';
import { demandContext } from '../../src/sim/economy/demand';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { listMilestones, listRewards, REWARD_BY_ID, rewardsSystem } from '../../src/sim/economy/rewards';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { ATTRACTIONS, tourismSystem, venueVisits } from '../../src/sim/economy/tourism';
import { facilityLoad } from '../../src/sim/infra/catchments';
import { ServicesSystem } from '../../src/sim/infra/services';
import { newState, place, roadLine } from '../infra/cityGen';
import { makeCity, road } from './helpers';

const LATE = [
  ['lm_central_library', 200000], ['lm_grand_central', 300000], ['lm_stock_exchange', 400000],
  ['lm_botanical_dome', 650000], ['lm_world_trade_center', 800000], ['lm_millennium_tower', 1000000],
  ['lm_metropolis_crown', 1500000],
] as const;

function fixture() {
  const rt = new EconRuntime(), rewards = rewardsSystem(rt), tourism = tourismSystem(rt), approval = approvalSystem(rt);
  const c = makeCity({ size: 160 }, [rewards, tourism, approval]);
  c.st.funds = 1e8;
  return { ...c, rt, rewards, tourism, approval };
}

function plop(c: ReturnType<typeof fixture>, id: string, x: number, z: number): Building {
  c.st.unlocked.add(getDef(id)!.requires ?? id);
  expect(road(c.A, x, z - 1, x + getDef(id)!.footprint[0] - 1, z - 1).ok).toBe(true);
  const result = c.A.plop(id, x, z, 0);
  expect(result.ok, `${id}: ${result.reason}`).toBe(true);
  return c.st.buildingAt(x, z)!;
}

describe('LG-02 population unlocks', () => {
  it.each(LATE)('%s unlocks exactly at %i residents, announces once and survives a population drop', (id, population) => {
    const c = fixture(), unlocked: string[] = [];
    c.sim.events.on('unlocked', (reward) => unlocked.push(reward));
    c.st.stats.population = population - 1;
    c.rewards.monthly!(c.sim);
    expect(c.st.unlocked.has(id)).toBe(false);
    expect(listRewards(c.st).find((r) => r.id === id)!.progress).toBeLessThan(1);
    c.st.stats.population++;
    c.rewards.monthly!(c.sim);
    expect(c.st.unlocked.has(id)).toBe(true);
    expect(c.st.news.filter((n) => n.ref?.reward === id)).toHaveLength(1);
    expect(unlocked.filter((reward) => reward === id)).toHaveLength(1);
    c.st.stats.population = 0;
    c.rewards.monthly!(c.sim);
    expect(c.st.unlocked.has(id)).toBe(true);
    expect(c.st.news.filter((n) => n.ref?.reward === id)).toHaveLength(1);
    expect(REWARD_BY_ID.get(id)!.defIds).toEqual([id]);
  });

  it('leaves the 192,899-resident baseline below every new unlock', () => {
    const c = fixture();
    c.st.stats.population = 192899;
    c.rewards.monthly!(c.sim);
    expect(LATE.filter(([id]) => c.st.unlocked.has(id))).toEqual([]);
  });

  it('silently fills missing late unlocks on an old save without new systemData and grants the existing Megalopolis title', () => {
    const c = fixture();
    c.st.day = 20160;
    c.st.stats.population = 1500000;
    const saved = serializeCity(c.st, { copy: true });
    saved.data.systemData = {};
    const loaded = deserializeCity(saved);
    const rt = new EconRuntime();
    const sim = new Simulation(loaded, [rewardsSystem(rt)]);
    expect(LATE.every(([id]) => loaded.unlocked.has(id))).toBe(true);
    expect(loaded.news).toEqual([]);
    expect(listMilestones(loaded).currentRank.name).toBe('Megalopolis');
    sim.runDays(30);
    expect(loaded.news).toEqual([]);
    const again = deserializeCity(serializeCity(loaded, { copy: true }));
    expect([...again.unlocked]).toEqual([...loaded.unlocked]);
  });
});

describe('LG-02 landmark effects', () => {
  it('supplies the library and green service tiers and the specified cap and prestige amounts', () => {
    expect(getDef('lm_central_library')!.coverage).toMatchObject({ kind: 'education', tier: 'library', capacity: 20000 });
    expect(getDef('lm_botanical_dome')!.coverage).toMatchObject({ kind: 'park', tier: 'green' });
    expect(getDef('lm_grand_central')!.footprint).toEqual([4, 3]);
    expect(getDef('lm_grand_central')!.coverage).toMatchObject({ kind: 'transit', radius: 18 });
    expect(CAP_RELIEF.lm_grand_central).toEqual({ R: 30000, C: 30000 });
    expect(CAP_RELIEF.lm_stock_exchange.CO3).toBe(40000);
    expect(getDef('lm_stock_exchange')!.prestige).toEqual({ amount: 0.5, radius: 18 });
    expect(CAP_RELIEF.lm_world_trade_center.C).toBe(60000);
    expect(getDef('lm_world_trade_center')!.jobs).toBe(8000);
    expect(getDef('lm_millennium_tower')!.prestige).toEqual({ amount: 0.7, radius: 26 });
    expect(ATTRACTIONS.lm_botanical_dome.draw).toBe(3500);
    expect(ATTRACTIONS.lm_millennium_tower.draw).toBe(7000);
    for (const [id] of LATE) expect(getDef(id)!.unique, id).toBe(true);
  });

  it('the actual service pass delivers library learning and green coverage with the new capacities', () => {
    const st = newState(96);
    roadLine(st, 10, 40, 85, 40);
    const home = place(st, 't_r2', 30, 41, { pop: 20000, capacity: 20000, flags: BF.Powered | BF.Watered });
    const library = place(st, 'lm_central_library', 26, 37, { flags: BF.Powered | BF.Watered });
    const dome = place(st, 'lm_botanical_dome', 34, 36, { flags: BF.Powered | BF.Watered });
    const sim = new Simulation(st, [new ServicesSystem()]);
    expect(facilityLoad(sim, library.id)).toMatchObject({ tier: 'library', capacity: 20000 });
    expect(facilityLoad(sim, dome.id)).toMatchObject({ tier: 'green', capacity: 80000 });
    expect(st.eduCollegeCov[st.idx(home.x, home.z)]).toBeGreaterThan(0);
    expect(st.greenCov[st.idx(home.x, home.z)]).toBeGreaterThan(0);
    expect(st.eduElemCov[st.idx(home.x, home.z)]).toBe(0);
  });

  it('Grand Central keeps its cap relief in economy-only simulations without utility flags', () => {
    const c = fixture();
    plop(c, 'lm_grand_central', 20, 20);
    expect(demandContext(c.st, c.rt).relief).toMatchObject({ R: 30000, C: 30000 });
  });

  it('adds exactly three civic approval for an intact Crown and removes it when ruined or bulldozed', () => {
    const c = fixture();
    const civic = () => { c.st.day++; c.approval.monthly!(c.sim); return econData(c.st).approvalTerms.civic; };
    const before = civic();
    const crown = plop(c, 'lm_metropolis_crown', 20, 20);
    expect(civic()).toBe(before + 3);
    crown.flags |= BF.Constructing;
    expect(civic()).toBe(before);
    crown.flags &= ~BF.Constructing;
    crown.flags |= BF.Burnt;
    expect(civic()).toBe(before);
    crown.flags &= ~BF.Burnt;
    expect(civic()).toBe(before + 3);
    expect(c.A.bulldoze({ x0: crown.x, z0: crown.z, x1: crown.x + crown.w, z1: crown.z + crown.d }).ok).toBe(true);
    expect(civic()).toBe(before);
  });

  it('Millennium Tower earns visit-based income and stops earning without power or a road', () => {
    const c = fixture();
    const tower = plop(c, 'lm_millennium_tower', 20, 20);
    c.st.stats.population = 1000000;
    const income = (attractiveness: number) => {
      econData(c.st).attractiveness = attractiveness;
      c.tourism.refresh(c.sim);
      return computeMonthlyBudget(c.st, c.rt).income['facility:lm_millennium_tower'] ?? 0;
    };
    const low = income(30), high = income(90);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
    c.st.systemData.infraVersion = 1;
    c.st.systemData.infraLayers = { utilities: true, traffic: false, services: false, pollution: false };
    expect(income(90)).toBe(0);
    tower.flags |= BF.Powered;
    expect(income(90)).toBeGreaterThan(0);
    for (let x = tower.x; x < tower.x + tower.w; x++) c.st.network[c.st.idx(x, tower.z - 1)] = Network.None;
    expect(income(90)).toBe(0);
  });

  it('removing a bus-only Grand Central keeps the other train stations in the saved tourism connection count', () => {
    const c = fixture();
    plop(c, 'tr_train_station', 20, 20);
    const hub = plop(c, 'lm_grand_central', 40, 20);
    const traffic = { name: 'traffic', stopAttached: () => true, hubModeAttached: () => false };
    c.sim.systems.push(traffic);
    c.tourism.refresh(c.sim);
    const pass = c.st.systemData.tourismPass as { conn: number[] };
    expect(pass.conn[2]).toBe(1);
    expect(c.A.bulldoze({ x0: hub.x, z0: hub.z, x1: hub.x + hub.w, z1: hub.z + hub.d }).ok).toBe(true);
    expect(pass.conn[2]).toBe(1);
  });
});

describe('LG-02 synthetic tourism gate (extends tourism.test.ts 200k case)', () => {
  it.each([false, true])('stays within 0.7–1.3 through all seven purchases (hotel shortage: %s)', (shortage) => {
    const c = fixture();
    c.rt.coarseFreight.fill(1);
    const existing = ['tr_airport_small', 'lm_spire_tower', 'civ_convention_center', 'park_stadium', 'park_zoo',
      'lm_clock_tower', 'lm_obelisk', 'lm_arch', 'lm_cathedral', 'lm_castle'];
    existing.forEach((id, k) => plop(c, id, 4 + k * 14, 20));
    const def = getDef('com_hotel_tower.cs2.7')!;
    for (let k = 0; k < 10; k++) {
      const b: Building = {
        id: c.st.nextBuildingId++, def: def.id, x: 4 + k * 12, z: 100, w: def.footprint[0], d: def.footprint[1],
        rot: 0, variant: 0, pop: 0, jobs: shortage ? 500 : 5000, capacity: 5000, wealth: 2,
        built: 1, age: 400, flags: 0, baseY: 5, health: 0.8, unhappy: 0,
      };
      placeBuilding(c.sim, b);
    }
    for (const [k, [id, population]] of LATE.entries()) {
      const b = plop(c, id, 4 + k * 18, 60);
      c.st.stats.population = population;
      for (let month = 0; month < 12; month++) c.tourism.refresh(c.sim);
      const legacy = demandContext(c.st, c.rt).tourism;
      const ratio = econData(c.st).tourism / legacy;
      const diagnostic = { id, population, shortage, legacy, jobs: econData(c.st).tourism, ratio };
      if (process.env.LG02_DIAGNOSTICS) appendFileSync(process.env.LG02_DIAGNOSTICS, JSON.stringify(diagnostic) + '\n');
      expect(ratio, JSON.stringify(diagnostic)).toBeGreaterThanOrEqual(0.7);
      expect(ratio, JSON.stringify(diagnostic)).toBeLessThanOrEqual(1.3);
      expect(venueVisits(c.st, b.id)!.visits, id).toBeGreaterThan(0);
    }
  });
});
