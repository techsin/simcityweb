/**
 * SIM_DEPTH_SPEC WP4: attractions, visits, hotels, tourism jobs / income, visitors raster, attractiveness and migration.
 * Economy-only cities (tests/sim/helpers.ts) unless a test switches single infra layers on via systemData.infraLayers.
 */
import { describe, expect, it } from 'vitest';
import { makeCity, road } from './helpers';
import { computeWater } from '../../src/sim/terrainGen';
import { DevType, Network } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import type { Simulation, SimSystem } from '../../src/sim/Simulation';
import { getDef } from '../../src/sim/catalog';
import { econData } from '../../src/sim/economy/runtime';
import { economyRuntime, economySystems } from '../../src/sim/systems/economy';
import { lotTouchesRoad, placeBuilding } from '../../src/sim/economy/buildings';
import { capHints, demandContext } from '../../src/sim/economy/demand';
import { computeMonthlyBudget, venueIncomeFactor } from '../../src/sim/economy/budget';
import {
  ATTRACTIONS, attractivenessBreakdown, migrationFactor, tourismSummary, tourismTrips, venueVisits,
} from '../../src/sim/economy/tourism';
import { sumTerms } from '../../src/sim/explain';
import { CS_JOBS_PER_VISITOR, MIG_MAX, MIG_MIN, MIG_UNEMP_SPAN, UNEMP_NEUTRAL } from '../../src/sim/economy/tuning';
import { CAP_RELIEF } from '../../src/sim/catalog';
import { Simulation as Sim } from '../../src/sim/Simulation';
import { stressCity } from '../infra/cityGen';

const tourismSys = (sim: Simulation) => sim.systems.find((s) => s.name === 'economy.tourism') as SimSystem;
/** run the monthly tourism update now (the survey / visits of "today") */
const tourismMonth = (sim: Simulation) => tourismSys(sim).monthly!(sim);

/** a flat city with an edge-to-edge highway (neighbour connections, freight access) */
function city(size = 96) {
  const c = makeCity({ size });
  c.st.funds = 1e8;
  road(c.A, 0, 40, size - 1, 40, Network.Highway);
  road(c.A, 10, 30, size - 10, 30, Network.Road);
  road(c.A, 10, 50, size - 10, 50, Network.Road);
  c.sim.runDays(1); // freight access / connections refresh
  return c;
}

/** plop a venue; unless `withRoad` is false, lay a road along a free side of the lot so it has road access */
function plop(c: ReturnType<typeof city>, id: string, x: number, z: number, withRoad = true): Building {
  const def = getDef(id)!;
  if (def.requires) c.st.unlocked.add(def.requires);
  const r = c.A.plop(id, x, z, 0);
  expect(r.ok, `${id}: ${r.reason}`).toBe(true);
  const b = c.st.buildingAt(x, z)!;
  if (withRoad && !lotTouchesRoad(c.st, b.x, b.z, b.w, b.d)) {
    const free = (x0: number, z0: number, x1: number, z1: number) => {
      for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) {
        if (!c.st.inBounds(xx, zz) || c.st.building[c.st.idx(xx, zz)] >= 0 || c.st.water[c.st.idx(xx, zz)]) return false;
      }
      return true;
    };
    const sides: [number, number, number, number][] = [
      [b.x, b.z - 1, b.x + b.w - 1, b.z - 1], [b.x, b.z + b.d, b.x + b.w - 1, b.z + b.d],
      [b.x - 1, b.z, b.x - 1, b.z + b.d - 1], [b.x + b.w, b.z, b.x + b.w, b.z + b.d - 1],
    ];
    const s = sides.find((q) => free(...q));
    expect(s, `${id}: no free side for a road`).toBeDefined();
    const rr = road(c.A, s![0], s![1], s![2], s![3], Network.Road);
    expect(rr.ok, `${id}: road ${s!.join(',')}: ${rr.reason}`).toBe(true);
    expect(lotTouchesRoad(c.st, b.x, b.z, b.w, b.d)).toBe(true);
  }
  return b;
}

let nextId = 1_000_000;
/** a synthetic growable (hotels, homes) placed directly */
function grow(sim: Simulation, defId: string, x: number, z: number, o: Partial<Building> = {}): Building {
  const def = getDef(defId)!;
  const b: Building = {
    id: nextId++, def: defId, x, z, w: def.footprint[0], d: def.footprint[1], rot: 0, variant: 0, pop: 0, jobs: 0,
    capacity: def.capacity ?? 0, wealth: def.devType !== undefined ? (def.devType % 3) + 1 : 1, built: 1, age: 400, flags: 0,
    baseY: 5, health: 0.8, unhappy: 0, ...o,
  };
  sim.state.nextBuildingId = Math.max(sim.state.nextBuildingId, b.id + 1);
  placeBuilding(sim, b);
  return b;
}
const hotelDef = (model: string) => [...Array(9).keys()].map((s) => `${model}.cs1.${s}`).concat([...Array(9).keys()].map((s) => `${model}.cs2.${s}`))
  .find((id) => getDef(id))!;

describe('tourism: venues and visits', () => {
  it('a landmark draws visitors: tourism CS jobs, visitors raster, trips, breakdown', () => {
    const c = city();
    const castle = plop(c, 'lm_castle', 20, 34);
    c.sim.runDays(30); // crosses a month boundary
    const d = econData(c.st);
    expect(d.tourism).toBeGreaterThan(0);
    const v = venueVisits(c.st, castle.id)!;
    expect(v.visits).toBeGreaterThan(50);
    expect(v.visits).toBeLessThanOrEqual(v.capacity);
    expect(c.st.stats.tourists).toBeGreaterThan(0);
    // visitors raster: high at the venue, 0 far away
    expect(c.st.visitors[c.st.idx(castle.x + 1, castle.z + 1)]).toBeGreaterThan(0.05);
    expect(c.st.visitors[c.st.idx(90, 90)]).toBe(0);
    expect(tourismTrips(c.st).some((t) => t.buildingId === castle.id && t.tripsPerDay > 0)).toBe(true);
    // attractiveness breakdown sums to attractiveness
    const br = attractivenessBreakdown(c.st);
    expect(br.map((t) => t.id)).toEqual(['culture', 'parks', 'safety', 'clean', 'quiet', 'services', 'jobs', 'connect']);
    expect(sumTerms(br)).toBeCloseTo(d.attractiveness, 6);
    expect(br.find((t) => t.id === 'culture')!.value).toBeGreaterThan(0);
    // tourism shows up in CS demand targets
    const s = tourismSummary(c.st)!;
    expect(s.topVenues[0].buildingId).toBe(castle.id);
  });

  it('visits are capped by capacity; promotion raises draw; unpowered / burnt / unfunded venues get 0', () => {
    const c = city();
    const cc = plop(c, 'civ_convention_center', 30, 34);
    const zoo = plop(c, 'park_zoo', 50, 42);
    const d = econData(c.st);
    // big, very attractive city: the convention center hits its capacity
    c.st.stats.population = 400000;
    d.attractiveness = 150;
    tourismMonth(c.sim);
    const v = venueVisits(c.st, cc.id)!;
    expect(v.gross).toBe(ATTRACTIONS.civ_convention_center.capacity);
    // normal city: tourism promotion (tourism.draw 1.2) raises draw by 20 %
    c.st.stats.population = 60000;
    d.attractiveness = 60;
    tourismMonth(c.sim);
    const z0 = venueVisits(c.st, zoo.id)!.gross;
    c.st.budget.ordinances.push('tourism_promotion');
    d.attractiveness = 60;
    tourismMonth(c.sim);
    expect(venueVisits(c.st, zoo.id)!.gross).toBeCloseTo(z0 * 1.2, 3);
    // unpowered (utilities layer on, no power): 0
    c.st.systemData.infraVersion = 1;
    c.st.systemData.infraLayers = { utilities: true, traffic: false, pollution: false, services: false };
    zoo.flags &= ~BF.Powered;
    c.st.powered.fill(0);
    d.attractiveness = 60;
    tourismMonth(c.sim);
    expect(venueVisits(c.st, zoo.id)!.visits).toBe(0);
    zoo.flags |= BF.Powered;
    tourismMonth(c.sim);
    expect(venueVisits(c.st, zoo.id)!.visits).toBeGreaterThan(0);
    // parks on strike / unfunded: the zoo closes; burnt: 0
    econData(c.st).strikes.parks = 2;
    tourismMonth(c.sim);
    expect(venueVisits(c.st, zoo.id)!.visits).toBe(0);
    econData(c.st).strikes.parks = 0;
    zoo.flags |= BF.Burnt;
    tourismMonth(c.sim);
    expect(venueVisits(c.st, zoo.id)!.visits).toBe(0);
  });

  it('a tourist venue needs a road next to its lot: no visits, cap relief or income without one (parks exempt)', () => {
    const c = city();
    const rt = economyRuntime(c.sim.systems)!;
    const castle = plop(c, 'lm_castle', 20, 60, false); // 10 cells south of the z = 50 road
    expect(lotTouchesRoad(c.st, castle.x, castle.z, castle.w, castle.d)).toBe(false);
    c.st.stats.population = 100000;
    econData(c.st).attractiveness = 60;
    tourismMonth(c.sim);
    expect(venueVisits(c.st, castle.id)!.visits).toBe(0);
    expect(venueVisits(c.st, castle.id)!.op).toBe(0);
    expect(econData(c.st).tourists).toBe(0);
    expect(venueIncomeFactor(c.st, castle.id, 'lm_castle')).toBe(0);
    const ctx0 = demandContext(c.st, rt);
    expect(ctx0.reliefLost.R).toBeCloseTo(CAP_RELIEF.lm_castle.R!, 6);
    expect(ctx0.reliefLost.C).toBeCloseTo(CAP_RELIEF.lm_castle.C!, 6);
    expect(ctx0.reliefIssues.R).toEqual({ noRoad: 1 });
    // a capped family names the cause first
    const d = econData(c.st);
    d.capBinding[0] = 1;
    c.st.stats.demand[0] = 0.5;
    const hint = capHints(c.st).find((h) => h.family === 'R')!.hint;
    expect(hint).toMatch(/without road access/);
    expect(hint).toMatch(/15,000/);
    // a street next to the lot opens it
    expect(road(c.A, castle.x, castle.z - 1, castle.x + castle.w - 1, castle.z - 1, Network.Street).ok).toBe(true);
    econData(c.st).attractiveness = 60;
    tourismMonth(c.sim);
    expect(venueVisits(c.st, castle.id)!.visits).toBeGreaterThan(50);
    const ctx1 = demandContext(c.st, rt);
    expect(ctx1.reliefLost.R).toBe(0);
    expect(ctx1.relief.R - ctx0.relief.R).toBeCloseTo(CAP_RELIEF.lm_castle.R!, 6);
    expect(capHints(c.st).find((h) => h.family === 'R')!.hint).not.toMatch(/below strength/);
    // plazas / parks are walk-in leisure: no road needed
    const plaza = plop(c, 'park_plaza', 70, 64, false);
    expect(lotTouchesRoad(c.st, plaza.x, plaza.z, plaza.w, plaza.d)).toBe(false);
    tourismMonth(c.sim);
    expect(venueVisits(c.st, plaza.id)!.visits).toBeGreaterThan(0);
  });

  it('a bulldozed venue leaves the tourism totals and the venue lists at once', () => {
    const c = city();
    const castle = plop(c, 'lm_castle', 20, 34);
    const cathedral = plop(c, 'lm_cathedral', 56, 34);
    c.st.stats.population = 100000;
    econData(c.st).attractiveness = 60;
    tourismMonth(c.sim);
    const d = econData(c.st);
    const t0 = d.tourists;
    const v = venueVisits(c.st, castle.id)!.visits;
    expect(v).toBeGreaterThan(0);
    expect(c.A.bulldoze({ x0: castle.x, z0: castle.z, x1: castle.x + castle.w, z1: castle.z + castle.d }).ok).toBe(true);
    expect(c.st.buildings.has(castle.id)).toBe(false);
    expect(venueVisits(c.st, castle.id)).toBeNull();
    expect(tourismTrips(c.st).map((t) => t.buildingId)).toEqual([cathedral.id]);
    expect(tourismSummary(c.st)!.topVenues.map((t) => t.buildingId)).toEqual([cathedral.id]);
    expect(d.tourists).toBeCloseTo(t0 - v, 6);
    expect(d.tourism).toBeCloseTo(d.tourists * CS_JOBS_PER_VISITOR, 6);
    expect(c.st.stats.tourists).toBe(Math.round(d.tourists));
  });

  it('hotels: overnight visitors without rooms stay away (more with an international airport)', () => {
    const c = city(128);
    plop(c, 'park_stadium', 20, 42);
    plop(c, 'lm_cathedral', 40, 34);
    c.st.stats.population = 150000;
    econData(c.st).attractiveness = 60;
    tourismMonth(c.sim);
    const d = econData(c.st);
    const gross = d.touristsGross!;
    expect(gross).toBeGreaterThan(1000);
    // no hotels: 30 % stay overnight, 80 % of those stay away
    expect(d.hotelShortage).toBeCloseTo(0.3 * gross, 3);
    expect(d.tourists).toBeCloseTo(gross - 0.8 * 0.3 * gross, 3);
    const t0 = d.tourists;
    // enough hotel rooms: every visitor comes
    const hotel = hotelDef('com_hotel');
    for (let k = 0; k < 6; k++) grow(c.sim, hotel, 60 + k * 6, 52, { jobs: 400 });
    econData(c.st).attractiveness = 60;
    tourismMonth(c.sim);
    expect(c.st.stats.hotelRooms).toBe(3600);
    expect(econData(c.st).tourists).toBeGreaterThan(t0);
    expect(econData(c.st).tourists).toBeCloseTo(econData(c.st).touristsGross!, 3);
    // an international airport brings many overnight guests: shortage again
    plop(c, 'tr_airport_large', 80, 20);
    econData(c.st).attractiveness = 60;
    tourismMonth(c.sim);
    const d2 = econData(c.st);
    expect(d2.overnight!).toBeCloseTo(0.55 * d2.touristsGross!, 3);
    expect(d2.hotelShortage).toBeGreaterThan(0);
    expect(d2.tourists).toBeLessThan(d2.touristsGross!);
  });

  it('a synthetic 200k city with airport, spire, convention center, stadium, zoo and 5 landmarks: new tourism jobs within 0.7–1.3× the old formula', () => {
    const c = city(160);
    plop(c, 'tr_airport_small', 10, 20);
    plop(c, 'lm_spire_tower', 30, 36);
    plop(c, 'civ_convention_center', 36, 34);
    plop(c, 'park_stadium', 44, 42);
    plop(c, 'park_zoo', 54, 42);
    plop(c, 'lm_clock_tower', 62, 38);
    plop(c, 'lm_obelisk', 66, 38);
    plop(c, 'lm_arch', 70, 38);
    plop(c, 'lm_cathedral', 76, 34);
    plop(c, 'lm_castle', 84, 34);
    // hotels of a 200k city (≈ 7,500 rooms)
    const hotel = hotelDef('com_hotel_tower');
    for (let k = 0; k < 5; k++) grow(c.sim, hotel, 20 + k * 8, 60, { jobs: 1000 });
    c.sim.runDays(1);
    c.st.stats.population = 200000;
    for (let k = 0; k < 3; k++) tourismMonth(c.sim); // attractiveness ↔ visits converge
    const rt = economyRuntime(c.sim.systems)!;
    const legacy = demandContext(c.st, rt).tourism;
    const jobs = econData(c.st).tourism;
    console.log(`synthetic 200k: legacy tourism ${legacy.toFixed(0)} CS jobs, new ${jobs.toFixed(0)} (${(jobs / legacy).toFixed(2)}×), `
      + `tourists ${econData(c.st).tourists.toFixed(0)} / gross ${econData(c.st).touristsGross!.toFixed(0)}, A ${econData(c.st).attractiveness.toFixed(1)}`);
    expect(jobs / legacy).toBeGreaterThan(0.7);
    expect(jobs / legacy).toBeLessThan(1.3);
    // CS demand uses the new number (split 25 / 45 / 30 over CS$ / CS$$ / CS$$$)
    c.sim.runDays(1);
    expect(econData(c.st).rawTarget[DevType.CS2]).toBeGreaterThan(econData(c.st).rawTarget[DevType.CS3] * 0.5);
  });

  it('beaches: clean, road-reachable, unbuilt shore of a big water body; polluted water closes them', () => {
    const c = makeCity({ size: 64 });
    // a gentle beach: land at +1 m, a lake at −1 m (rows 0..11), the shore row slopes by 2 m
    const N1 = c.st.size + 1;
    for (let z = 0; z <= c.st.size; z++) for (let x = 0; x <= c.st.size; x++) c.st.heights[z * N1 + x] = z <= 12 ? -1 : 1;
    computeWater(c.st);
    road(c.A, 0, 18, 63, 18);
    c.sim.runDays(1);
    c.st.stats.population = 80000;
    econData(c.st).attractiveness = 60;
    tourismMonth(c.sim);
    const s = tourismSummary(c.st)!;
    expect(s.beachCells).toBeGreaterThan(40);
    expect(s.beach).toBeGreaterThan(0);
    // beach visitors appear in the raster along the shore
    let shoreVis = 0;
    for (let x = 0; x < 64; x++) for (let z = 10; z < 16; z++) shoreVis = Math.max(shoreVis, c.st.visitors[c.st.idx(x, z)]);
    expect(shoreVis).toBeGreaterThan(0);
    // polluted water: no beach
    for (let i = 0; i < c.st.cells; i++) if (c.st.water[i]) c.st.waterPollution[i] = 0.4;
    econData(c.st).attractiveness = 60;
    tourismMonth(c.sim);
    expect(tourismSummary(c.st)!.beachCells).toBe(0);
  });

  it('visitors are recomputed in init() (derived layer, not saved)', () => {
    const c = city();
    const castle = plop(c, 'lm_castle', 20, 34);
    c.sim.runDays(30);
    const i = c.st.idx(castle.x + 1, castle.z + 1);
    const v = c.st.visitors[i];
    expect(v).toBeGreaterThan(0);
    c.st.visitors.fill(0);
    const sim2 = new Sim(c.st, economySystems());
    // same venues; visits use the latest attractiveness, so the layer matches up to that month's change
    expect(Math.abs(c.st.visitors[i] - v)).toBeLessThan(0.15 * v);
    expect(venueVisits(sim2.state, castle.id)).not.toBeNull();
  });
});

describe('tourism: income', () => {
  it('venue income scales with visits; tourist spending is a budget line', () => {
    const c = city();
    const zoo = plop(c, 'park_zoo', 50, 42);
    const rt = economyRuntime(c.sim.systems)!;
    c.st.stats.population = 150000;
    const income = (A: number) => {
      econData(c.st).attractiveness = A;
      tourismMonth(c.sim);
      econData(c.st).attractiveness = A;
      return computeMonthlyBudget(c.st, rt).income['facility:park_zoo'] ?? 0;
    };
    const lo = income(30), hi = income(90);
    expect(hi).toBeGreaterThan(lo * 1.3);
    expect(venueIncomeFactor(c.st, zoo.id, 'park_zoo')).toBeGreaterThan(0.35);
    expect(computeMonthlyBudget(c.st, rt).income.tourism).toBeGreaterThan(0);
    // recycled material sales (WP3 writes stats.garbageRecycled, t / month)
    c.st.stats.garbageRecycled = 1000;
    expect(computeMonthlyBudget(c.st, rt).income.recycling).toBe(500);
    // a closed venue (parks on strike: op 0) earns nothing, not even the base share
    econData(c.st).strikes.parks = 2;
    tourismMonth(c.sim);
    expect(venueVisits(c.st, zoo.id)!.op).toBe(0);
    expect(venueIncomeFactor(c.st, zoo.id, 'park_zoo')).toBe(0);
    expect(computeMonthlyBudget(c.st, rt).income['facility:park_zoo'] ?? 0).toBe(0);
    econData(c.st).strikes.parks = 0;
    tourismMonth(c.sim);
    expect(computeMonthlyBudget(c.st, rt).income['facility:park_zoo'] ?? 0).toBeGreaterThan(0);
    // burnt: nothing
    zoo.flags |= BF.Burnt;
    expect(computeMonthlyBudget(c.st, rt).income['facility:park_zoo'] ?? 0).toBe(0);
  });
});

describe('attractiveness and migration', () => {
  /** homes with residents + manual layers (services layer on so parkCov counts) */
  function town() {
    const c = city();
    const homes: Building[] = [];
    for (let k = 0; k < 8; k++) homes.push(grow(c.sim, 'res_apartment.r2.4', 20 + k * 5, 44, { pop: 1500, wealth: 2 }));
    c.st.systemData.infraVersion = 1;
    c.st.systemData.infraLayers = { utilities: false, traffic: false, pollution: false, services: true };
    c.st.stats.population = 12000;
    return { ...c, homes };
  }
  const A = (c: ReturnType<typeof town>) => {
    c.st.day++; // fresh resident survey
    tourismMonth(c.sim);
    return econData(c.st).attractiveness;
  };
  const setAtHomes = (c: ReturnType<typeof town>, layer: Float32Array, v: number) => {
    for (const b of c.homes) for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) layer[c.st.idx(x, z)] = v;
  };

  it('rises with parks and landmarks, falls with crime and pollution', () => {
    const c = town();
    const a0 = A(c);
    setAtHomes(c, c.st.parkCov, 0.9);
    const aParks = A(c);
    expect(aParks).toBeGreaterThan(a0 + 5);
    plop(c, 'lm_cathedral', 40, 34);
    plop(c, 'lm_castle', 60, 34);
    const aLm = A(c);
    expect(aLm).toBeGreaterThan(aParks + 3);
    setAtHomes(c, c.st.crime, 0.4);
    const aCrime = A(c);
    expect(aCrime).toBeLessThan(aLm - 5);
    setAtHomes(c, c.st.airPollution, 0.5);
    expect(A(c)).toBeLessThan(aCrime - 5);
    // per wealth: R$$$ weighs crime and pollution more than R$
    const aw = econData(c.st).attractByWealth;
    expect(aw[2]).toBeLessThan(aw[0]);
  });

  it('migration: monotone in attractiveness, bounded at ±12 %, applied to the whole R target', () => {
    let prev = 0;
    for (let a = 0; a <= 100; a += 5) {
      const m = migrationFactor(a, 100000);
      expect(m).toBeGreaterThanOrEqual(prev);
      expect(m).toBeGreaterThanOrEqual(MIG_MIN);
      expect(m).toBeLessThanOrEqual(MIG_MAX);
      prev = m;
    }
    expect(migrationFactor(100, 100000)).toBe(MIG_MAX);
    expect(migrationFactor(0, 100000)).toBe(MIG_MIN);
    // a hamlet has no reputation yet
    expect(migrationFactor(100, 0)).toBe(1);
    // no work, no pull: the gain fades out above UNEMP_NEUTRAL; the loss of an unattractive city stays
    expect(migrationFactor(100, 100000, 0, UNEMP_NEUTRAL)).toBe(MIG_MAX);
    expect(migrationFactor(100, 100000, 0, UNEMP_NEUTRAL + MIG_UNEMP_SPAN / 2)).toBeCloseTo(1 + (MIG_MAX - 1) / 2, 9);
    expect(migrationFactor(100, 100000, 0, 0.2)).toBe(1);
    expect(migrationFactor(0, 100000, 0, 0.2)).toBe(MIG_MIN);
    let prevU = Infinity;
    for (let u = 0; u <= 0.3; u += 0.01) {
      const m = migrationFactor(80, 200000, 0, u);
      expect(m).toBeLessThanOrEqual(prevU);
      prevU = m;
    }
    // the R target follows the multiplier exactly
    const c = city();
    c.sim.runDays(3);
    const d = econData(c.st);
    d.migration = [1, 1, 1];
    c.sim.advanceDay();
    const r0 = d.rawTarget.slice(0, 3);
    d.migration = [MIG_MAX, MIG_MAX, MIG_MAX];
    c.sim.advanceDay();
    for (let w = 0; w < 3; w++) expect(d.rawTarget[w] / r0[w]).toBeCloseTo(MIG_MAX, 2);
    d.migration = [MIG_MIN, MIG_MIN, MIG_MIN];
    c.sim.advanceDay();
    for (let w = 0; w < 3; w++) expect(d.rawTarget[w] / r0[w]).toBeCloseTo(MIG_MIN, 2);
  });

  it('a university brings students; unreached pupils keep families away', () => {
    const c = town();
    A(c);
    expect(econData(c.st).migrants![0]).toBe(0);
    plop(c, 'civ_college', 60, 44);
    A(c);
    const m = econData(c.st).migrants!;
    expect(m[0]).toBeGreaterThan(1000); // 0.5 × 6,000 seats × 60 %
    expect(m[1]).toBeGreaterThan(700);
    const mig0 = econData(c.st).migration.slice();
    c.st.stats.needs.elementary.need = 2000;
    c.st.stats.needs.elementary.unreached = 2000;
    A(c);
    const mig1 = econData(c.st).migration;
    expect(mig1[0]).toBeCloseTo(mig0[0], 6);
    expect(mig1[1]).toBeLessThan(mig0[1] * 0.95);
    expect(mig1[2]).toBeLessThan(mig0[2] * 0.95);
  });
});


describe('tourism: cost', () => {
  it('monthly update on a 256² stress city (20k buildings, beaches, venues) stays cheap', { timeout: 120000 }, () => {
    const city = stressCity(256);
    const st = city.st;
    // a lake along the south edge (beaches) and a handful of venues
    const N1 = st.size + 1;
    for (let z = 236; z <= st.size; z++) for (let x = 0; x <= st.size; x++) st.heights[z * N1 + x] = -1;
    for (let z = 230; z < 236; z++) for (let x = 0; x <= st.size; x++) st.heights[z * N1 + x] = 1;
    computeWater(st);
    for (let i = 230 * st.size; i < st.cells; i++) if (st.water[i] || i < 236 * st.size) { st.network[i] = 0; const id = st.building[i]; if (id >= 0) st.buildings.delete(id); st.building[i] = -1; }
    const sim = new Sim(st, economySystems());
    const venues = ['lm_castle', 'park_zoo', 'park_stadium', 'lm_opera_house', 'civ_museum', 'park_large', 'park_plaza'];
    let k = 0;
    for (const b of st.buildings.values()) {
      if (k >= 60) break;
      if (!(b.flags & BF.Plopped) && b.w === 2 && b.pop > 0 && (b.x * 7 + b.z) % 13 === 0) { b.def = venues[k % venues.length]; b.flags |= BF.Plopped; b.pop = 0; k++; }
    }
    const rt = economyRuntime(sim.systems)!;
    rt.ensureLists();
    (rt as unknown as { rebuildBuildingLists(): void }).rebuildBuildingLists();
    st.stats.population = 600000;
    for (let w = 0; w < 3; w++) tourismMonth(sim);
    let best = Infinity;
    const phase: Record<string, number> = {};
    for (let r = 0; r < 12; r++) {
      st.day++;
      const t0 = performance.now();
      tourismMonth(sim);
      best = Math.min(best, performance.now() - t0);
      for (const [key, v] of Object.entries(rt.timing)) if (key.startsWith('tourism.')) phase[key] = Math.min(phase[key] ?? Infinity, v);
      if (process.env.TOURISM_PERF) console.log(`run ${r}: ${(performance.now() - t0).toFixed(2)} ms: ` + Object.entries(rt.timing).filter(([k]) => k.startsWith('tourism.')).map(([k, v]) => `${k.slice(8)} ${v.toFixed(1)}`).join(' '));
    }
    const s = tourismSummary(st)!;
    console.log(Object.entries(phase).map(([key, v]) => `${key} ${v.toFixed(2)}`).join(' · '));
    console.log(`tourism monthly (incl. resident survey): ${best.toFixed(2)} ms · ${rt.growables.length} growables, ${s.beachCells} beach cells, `
      + `${Math.round(s.tourists)} tourists ≈ ${(best / 30).toFixed(3)} ms/day`);
    expect(s.beachCells).toBeGreaterThan(100);
    // wall-clock budgets only with PERF_STRICT=1 (like tests/infra/perf.test.ts): the shared CI box spikes 10–200 ms
    // under load, while an unloaded run measures ≈ 1.5–3 ms per month
    if (process.env.PERF_STRICT) expect(best).toBeLessThan(6);
  });
});
