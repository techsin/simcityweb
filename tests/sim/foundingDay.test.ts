/**
 * FEEL-05: a player's city is founded on day 90 (1 April) with systemData.foundedDay = 90 (src/main.ts startNewCity); the
 * CityState constructor, the bot and old saves keep day 0.
 * - Every "day > 0 means a resumed city" check also needs stored data, which a fresh city lacks, so a day-90 founding
 *   takes the same first-day paths as a day-0 one: approval, demand, desirability, land value, tourism, population and
 *   growth's core (POLISH_PLAN "Where the drafts were wrong", point 4).
 * - The advisors count from foundedDay: the first headline 45 days after founding, "nothing is growing" and the stall
 *   advice no earlier than for a day-0 city.
 * - The calendar: the city opens on Apr 1 of its start year and its first New Year is 1 January of the next.
 */
import { describe, expect, it } from 'vitest';
import { createCityState, computeWater } from '../../src/sim/terrainGen';
import { defaultCityConfig } from '../../src/sim/config';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { economySystems } from '../../src/sim/systems/economy';
import { CityActions } from '../../src/sim/actions';
import { Network, Zone } from '../../src/core/types';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { advisorData, advisorIssues, advisorsSystem, type AdvisorsSystem } from '../../src/sim/economy/advisors';
import { dayLabel } from '../../src/ui/format';
import { road } from './helpers';
import { newState } from '../infra/cityGen';

const FOUNDING = 90;

/** a flat 64-cell town with roads and R/C/I zones (nothing built yet), founded on `day`, run with the economy systems */
function town(day: number) {
  const st = createCityState(defaultCityConfig({ size: 64, seed: 1234, terrain: 'flat', treeDensity: 0, waterAmount: 0, disasters: false }));
  st.heights.fill(5);
  computeWater(st);
  st.trees.fill(0);
  // founded as main.ts does it: before the simulation (and its systems' init) exists. The roads and zones are laid
  // before the systems' init too, so the first-day checks see a town (and stored-data checks see none of it)
  st.day = day;
  if (day) st.systemData.foundedDay = day;
  const A = new CityActions(new Simulation(st, []));
  road(A, 0, 32, 63, 32, Network.Road);
  road(A, 20, 10, 20, 54, Network.Road);
  A.zone({ x0: 21, z0: 26, x1: 40, z1: 31 }, Zone.ResLow);
  A.zone({ x0: 21, z0: 33, x1: 32, z1: 36 }, Zone.ComLow);
  A.zone({ x0: 33, z0: 33, x1: 44, z1: 38 }, Zone.IndMed);
  const sim = new Simulation(st, economySystems());
  return { st, sim };
}

/** what the six systems and growth's core leave after the city's first day (everything that must match a day-0 founding) */
function firstDay(day: number) {
  const { st, sim } = town(day);
  sim.advanceDay();
  const s = st.stats;
  const sum = (a: ArrayLike<number>) => { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return Math.round(t * 1e4) / 1e4; };
  return {
    approval: s.approval, demand: [...s.demand], population: s.population, tourists: s.tourists ?? 0, attractiveness: s.attractiveness ?? 0,
    desirability: st.desirability.map((layer) => sum(layer)), landValue: sum(st.landValue),
    buildings: st.buildings.size, funds: st.funds,
    growthCore: (st.systemData.growth as { core?: unknown } | undefined)?.core ?? null,
  };
}

describe('FEEL-05: a city founded on day 90 is a fresh city', () => {
  it('opens on Apr 1 of its start year, and its first New Year is 1 January of the next year', () => {
    const { st, sim } = town(FOUNDING);
    expect(st.month).toBe(3);
    expect(st.dayOfMonth).toBe(0);
    expect(st.year).toBe(st.config.startYear);
    expect(dayLabel(st.day, st.config.startYear)).toBe(`Apr 1, ${st.config.startYear}`);
    const years: number[] = [];
    let firstYearDay = -1;
    sim.events.on('year', (y) => {
      years.push(y);
      if (firstYearDay < 0) firstYearDay = st.day;
    });
    sim.runDays(360 - FOUNDING);
    expect(years).toEqual([st.config.startYear + 1]);
    expect(firstYearDay).toBe(360);
    expect(dayLabel(st.day, st.config.startYear)).toBe(`Jan 1, ${st.config.startYear + 1}`);
  });

  it('takes the fresh-city path of approval, demand, desirability, land value, tourism, population and growth', () => {
    const fresh = firstDay(0);
    const spring = firstDay(FOUNDING);
    expect(spring).toEqual(fresh);
    // (the comparison has substance: zoned land has desirability and land value on the first day)
    expect(fresh.desirability.some((v) => v !== 0)).toBe(true);
    expect(fresh.landValue).toBeGreaterThan(0);
  });

  it('the advisors schedule the first headline 45 days after founding (an older save: a calm month)', () => {
    for (const day of [0, FOUNDING]) {
      const { st, sim } = town(day);
      sim.advanceDay();
      expect(advisorData(st).nextHeadline, `founded on day ${day}`).toBe(day + 45);
      sim.runDays(43);
      expect(advisorData(st).nextHeadline, 'not drawn before the 45th day').toBe(day + 45);
      sim.runDays(1);
      expect(advisorData(st).nextHeadline, 'drawn on the 45th day').toBeGreaterThan(day + 45);
    }
    // an old save without the advisors record, opened on day 400 (no foundedDay: founded on day 0)
    const old = town(0);
    old.st.day = 400;
    delete old.st.systemData.advisors;
    expect(advisorData(old.st).nextHeadline).toBe(430);
  });
});

/** the advisors system alone on ready lots with no demand (advisorsFeedback.test.ts's harness), founded on `day` */
function readyLots(day: number) {
  const st = newState(64);
  st.systemData.infraVersion = 1;
  if (day) st.systemData.foundedDay = day;
  st.day = day;
  const rt = new EconRuntime();
  const adv = advisorsSystem(rt) as AdvisorsSystem;
  const sim = new Simulation(st, [adv as SimSystem]);
  for (let x = 4; x < 60; x++) {
    st.network[st.idx(x, 20)] = Network.Road;
    for (let z = 21; z < 23; z++) {
      const i = st.idx(x, z);
      st.zone[i] = Zone.ResLow;
      st.powered[i] = 1;
      st.watered[i] = 1;
    }
  }
  rt.totals.growables = 0;
  rt.totals.abandoned = 0;
  return { st, sim, adv };
}

describe('FEEL-05: the advisors count from the founding day', () => {
  /** days after founding until the planning advice `id` is first listed (-1: not within 10 months) */
  const firstListed = (day: number, id: string, demand = 0) => {
    const { st, sim, adv } = readyLots(day);
    st.stats.demand[0] = demand;
    for (let m = 1; m <= 10; m++) {
      st.day = day + 30 * m;
      adv.monthly!(sim);
      if ((advisorIssues(st).planning ?? []).some((a) => a.id === id)) return st.day - day;
    }
    return -1;
  };

  it('"Nothing is growing" (no demand) first speaks as long after founding as in a day-0 city, never before 60 days', () => {
    const fresh = firstListed(0, 'noDemand');
    expect(fresh).toBeGreaterThanOrEqual(60);
    expect(firstListed(FOUNDING, 'noDemand')).toBe(fresh);
  });

  it('the stall advice (demand, ready lots, nothing built) waits as long after founding as in a day-0 city', () => {
    const fresh = firstListed(0, 'growthStalled', 0.4);
    expect(fresh).toBeGreaterThanOrEqual(150);
    expect(firstListed(FOUNDING, 'growthStalled', 0.4)).toBe(fresh);
  });
});
