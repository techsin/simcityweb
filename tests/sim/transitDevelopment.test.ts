/** LG-08: connected stations create tower sites and a small, named appeal bonus. */
import { describe, expect, it } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { getDef, ZONE_DEVTYPES } from '../../src/sim/catalog';
import { approvalSystem, residentSurvey } from '../../src/sim/economy/approval';
import { placeBuilding, removeBuilding } from '../../src/sim/economy/buildings';
import { desirabilityBreakdown, desirabilitySystem, NT } from '../../src/sim/economy/desirability';
import { growthData, growthLimits, growthSystem, stationLotMask, stationTowerLots, towerLot } from '../../src/sim/economy/growth';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { APPROVAL, APPROVAL_TERMS, DOWNTOWN_STAGE, TOD } from '../../src/sim/economy/tuning';
import { centerCell } from '../../src/sim/infra/common';
import { TrafficSystem } from '../../src/sim/infra/traffic';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { makeCity } from './helpers';

function put(sim: Simulation, defId: string, x: number, z: number, opts: Partial<Building> = {}): Building {
  const def = getDef(defId)!;
  const b: Building = {
    id: sim.state.nextBuildingId++, def: defId, x, z, w: def.footprint[0], d: def.footprint[1], rot: 0, variant: 0,
    pop: 0, jobs: 0, capacity: def.capacity ?? def.jobs ?? 0, wealth: 2, built: 1, age: 400,
    flags: (def.category === 'growable' ? 0 : BF.Plopped) | BF.Powered | BF.Watered,
    baseY: 5, health: 1, unhappy: 0, ...opts,
  };
  placeBuilding(sim, b);
  return b;
}

function city(st?: CityState, system: 'both' | 'growth' | 'desirability' = 'both', traffic = true) {
  st ??= makeCity({ size: 64 }, []).st;
  const rt = new EconRuntime(), tr = new TrafficSystem();
  const growth = growthSystem(rt), des = desirabilitySystem(rt);
  const sim = new Simulation(st, [
    ...(traffic ? [tr] : []), ...(system !== 'growth' ? [des] : []), ...(system !== 'desirability' ? [growth] : []),
  ]);
  return { st, sim, rt, tr, growth, des };
}

function subway(sim: Simulation, x0 = 10, x1 = 40, z = 21): void {
  for (let x = x0; x <= x1; x++) sim.state.subway[sim.state.idx(x, z)] = 1;
  sim.events.emit('subwayChanged', { x0, z0: z, x1: x1 + 1, z1: z + 1 });
}

function rail(sim: Simulation, x0: number, x1: number, z = 30): void {
  for (let x = x0; x <= x1; x++) sim.state.network[sim.state.idx(x, z)] = Network.Rail;
  sim.events.emit('networkChanged', { x0, z0: z, x1: x1 + 1, z1: z + 1 });
}

describe('transit development: tower-lot geometry', () => {
  it('uses exact six- and eight-tile circles, clips map edges, and unions overlapping stations', () => {
    const N = 32, cell = 15 * N + 15;
    const mask = stationLotMask(N, [{ cell, radius: 6 }]);
    expect(mask).toHaveLength(N * N);
    expect(mask[cell]).toBe(1);
    for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6], [4, 4]]) expect(mask[cell + dz * N + dx]).toBe(1);
    for (const [dx, dz] of [[7, 0], [6, 1], [5, 4]]) expect(mask[cell + dz * N + dx]).toBe(0);
    const grand = stationLotMask(N, [{ cell, radius: 8 }]);
    expect(grand[cell + 8]).toBe(1);
    expect(grand[cell + 8 + N]).toBe(0);
    expect(grand[cell + 9]).toBe(0);
    const corner = stationLotMask(N, [{ cell: 0, radius: 6 }]);
    expect(corner[6]).toBe(1);
    expect(corner[6 * N]).toBe(1);
    expect(corner[N - 1]).toBe(0); // no wrapping across a row
    expect(corner[N * N - 1]).toBe(0);
    const stations = [{ cell, radius: 6 }, { cell: cell + 2, radius: 8 }];
    const union = stationLotMask(N, stations);
    expect(stationLotMask(N, [...stations].reverse())).toEqual(union);
    expect(stationLotMask(N, [...stations, stations[0]])).toEqual(union);
    expect(union.every((v) => v === 0 || v === 1)).toBe(true);
    expect(stationLotMask(N, []).some(Boolean)).toBe(false);
    expect(TOD.stationRadius).toBe(6);
    expect(TOD.grandCentralRadius).toBe(8);
    expect(TOD.desirability).toBe(0.04);
  });

  it.each(['growth', 'desirability'] as const)('%s alone initializes station discovery and edit invalidation', (system) => {
    const c = city(undefined, system);
    subway(c.sim);
    const a = put(c.sim, 'tr_subway_station', 10, 21);
    expect(c.tr.stopAttached(a.id)).toBe(false);
    expect(stationTowerLots(c.st).some(Boolean)).toBe(false);
    put(c.sim, 'tr_subway_station', 40, 21);
    expect(c.tr.stopAttached(a.id)).toBe(true);
    const mask = stationTowerLots(c.st);
    expect(mask[centerCell(c.st, a)]).toBe(1);
    expect(stationTowerLots(c.st)).toBe(mask);
  });

  it('counts a train pair or rail to the edge, and applies rail edits before the next graph rebuild', () => {
    const c = city();
    rail(c.sim, 10, 45);
    const a = put(c.sim, 'tr_train_station', 12, 31);
    const ci = centerCell(c.st, a), version = c.tr.graphVersion;
    expect(c.tr.stopAttached(a.id)).toBe(false);
    expect(stationTowerLots(c.st)[ci]).toBe(0);
    const b = put(c.sim, 'tr_train_station', 36, 31);
    expect(c.tr.stopAttached(a.id)).toBe(true);
    expect(stationTowerLots(c.st)[ci]).toBe(1);
    removeBuilding(c.sim, b);
    expect(stationTowerLots(c.st)[ci]).toBe(0);
    rail(c.sim, 0, 9);
    expect(c.tr.stationLine(a.id)).toEqual({ stations: 1, edge: true });
    expect(stationTowerLots(c.st)[ci]).toBe(1);
    c.st.network[c.st.idx(5, 30)] = Network.None;
    c.sim.events.emit('networkChanged', { x0: 5, z0: 30, x1: 6, z1: 31 });
    expect(stationTowerLots(c.st)[ci]).toBe(0);
    expect(c.tr.graphVersion).toBe(version);
  });

  it('drops burnt or constructing stations, restores completed stations, and keeps its cache for unrelated buildings', () => {
    const c = city();
    subway(c.sim);
    const a = put(c.sim, 'tr_subway_station', 10, 21);
    const b = put(c.sim, 'tr_subway_station', 40, 21);
    const ci = centerCell(c.st, a), first = stationTowerLots(c.st);
    expect(first[ci]).toBe(1);
    const home = put(c.sim, 'res_cottage.r2.1', 50, 50);
    c.sim.events.emit('buildingChanged', home);
    expect(stationTowerLots(c.st)).toBe(first);
    for (const flag of [BF.Burnt, BF.Constructing, BF.Abandoned]) {
      b.flags |= flag;
      if (flag === BF.Constructing) b.built = 0;
      c.sim.events.emit('buildingChanged', b);
      expect(stationTowerLots(c.st)[ci]).toBe(0);
      b.flags &= ~flag;
      b.built = 1;
      c.sim.events.emit('buildingChanged', b);
      expect(stationTowerLots(c.st)[ci]).toBe(1);
    }
    c.st.subway[c.st.idx(25, 21)] = 0;
    c.sim.events.emit('subwayChanged', { x0: 25, z0: 21, x1: 26, z1: 22 });
    expect(stationTowerLots(c.st)[ci]).toBe(0);
    subway(c.sim, 25, 25);
    expect(stationTowerLots(c.st)[ci]).toBe(1);
    removeBuilding(c.sim, a);
    expect(stationTowerLots(c.st).some(Boolean)).toBe(false);
  });

  it('does not grant tower lots for buses, freight stations, or stations without traffic attachment data', () => {
    const c = city();
    rail(c.sim, 0, 45);
    put(c.sim, 'tr_freight_station', 12, 31);
    c.st.network[c.st.idx(40, 40)] = Network.Road;
    put(c.sim, 'tr_bus_stop', 40, 41);
    expect(stationTowerLots(c.st).some(Boolean)).toBe(false);
    const without = city(undefined, 'both', false);
    subway(without.sim);
    put(without.sim, 'tr_subway_station', 10, 21);
    put(without.sim, 'tr_subway_station', 40, 21);
    expect(stationTowerLots(without.st).some(Boolean)).toBe(false);
  });

  it('refreshes attachment when a station changes mode without moving its centre', () => {
    const c = city();
    subway(c.sim);
    const a = put(c.sim, 'tr_subway_station', 10, 21);
    put(c.sim, 'tr_subway_station', 40, 21);
    const ci = centerCell(c.st, a);
    expect(stationTowerLots(c.st)[ci]).toBe(1);
    a.def = 'tr_train_station';
    c.sim.events.emit('buildingChanged', a);
    expect(centerCell(c.st, a)).toBe(ci);
    expect(stationTowerLots(c.st).some(Boolean)).toBe(false);
    a.def = 'tr_subway_station';
    c.sim.events.emit('buildingChanged', a);
    expect(stationTowerLots(c.st)[ci]).toBe(1);
  });

  it('rebuilds derived tower lots from an old save without adding a persisted key', () => {
    const c = city();
    subway(c.sim);
    put(c.sim, 'tr_subway_station', 10, 21);
    put(c.sim, 'tr_subway_station', 40, 21);
    const expected = stationTowerLots(c.st).slice();
    const copy = deserializeCity(structuredClone(serializeCity(c.st, { copy: true })) as SerializedCity);
    const loaded = city(copy);
    const keys = Object.keys(copy.systemData).sort();
    expect(stationTowerLots(loaded.st)).toEqual(expected);
    expect(Object.keys(copy.systemData).sort()).toEqual(keys);
  });

  it('keeps saved state and the RNG unchanged while querying station growth and appeal', () => {
    const c = city();
    subway(c.sim);
    const a = put(c.sim, 'tr_subway_station', 10, 21);
    put(c.sim, 'tr_subway_station', 40, 21);
    const i = centerCell(c.st, a) + 3;
    c.st.zone[i] = Zone.ResHigh;
    const snapshot = () => { const data = serializeCity(c.st, { copy: true }); data.savedAt = 0; return JSON.stringify(data); };
    const before = snapshot();
    for (let k = 0; k < 3; k++) {
      stationTowerLots(c.st);
      towerLot(c.st, i % c.st.size, (i / c.st.size) | 0);
      desirabilityBreakdown(c.st, c.rt, DevType.R2, i);
    }
    expect(snapshot() === before).toBe(true);
  });

  it('makes a rejected off-core tower site eligible while preserving the other stage limits', () => {
    const c = city();
    subway(c.sim);
    const a = put(c.sim, 'tr_subway_station', 10, 21);
    growthData(c.st).core = { x: 60.5, z: 60.5, jobs: 50000 };
    c.growth.init!(c.sim);
    c.st.stats.population = 5e6;
    const centre = centerCell(c.st, a), cx = centre % c.st.size, cz = (centre / c.st.size) | 0;
    let target = -1;
    for (let x = cx - 4; x <= cx + 4; x++) {
      const z = cz + 3, i = c.st.idx(x, z);
      c.st.zone[i] = Zone.ResHigh;
      c.st.network[c.st.idx(x, z + 1)] = Network.Road;
      c.st.desirability[DevType.R2][i] = 1;
      if (!towerLot(c.st, x, z)) { target = i; break; }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    const before = growthLimits(c.st, target, DevType.R2);
    expect(before.rejected).toBe(false);
    expect(before.downtownStage).toBe(DOWNTOWN_STAGE - 1);
    expect(before.stationTower).toBe(false);
    put(c.sim, 'tr_subway_station', 40, 21);
    expect(towerLot(c.st, target % c.st.size, (target / c.st.size) | 0)).toBe(true);
    const after = growthLimits(c.st, target, DevType.R2);
    expect(after.downtownStage).toBeUndefined();
    expect(after.stationTower).toBe(true);
    expect(structuredClone(after).stationTower).toBe(true);
    expect([after.desStage, after.popStage, after.zoneStage]).toEqual([before.desStage, before.popStage, before.zoneStage]);
  });
});

describe('transit development: desirability', () => {
  it.each([Zone.ResHigh, Zone.ComHigh, Zone.IndHigh, Zone.None])('adds the named bonus only to R$$ and offices on zone %s', (zone) => {
    const c = city();
    subway(c.sim);
    const a = put(c.sim, 'tr_subway_station', 10, 21);
    const i = centerCell(c.st, a) + 3;
    c.st.zone[i] = zone;
    c.st.landValue[i] = 0.35;
    c.des.init!(c.sim);
    const baseline = Array.from({ length: 12 }, (_, d) => desirabilityBreakdown(c.st, c.rt, d, i));
    put(c.sim, 'tr_subway_station', 40, 21);
    c.des.init!(c.sim);
    const devs = zone === Zone.None ? Array.from({ length: 12 }, (_, d) => d) : ZONE_DEVTYPES[zone];
    for (let d = 0; d < 12; d++) {
      const br = desirabilityBreakdown(c.st, c.rt, d, i);
      const bonus = d === DevType.R2 || d === DevType.CO2 || d === DevType.CO3 ? 0.04 : 0;
      expect(br.raw - baseline[d].raw, `DevType ${d}`).toBeCloseTo(bonus, 12);
      expect(br.terms.reduce((s, t) => s + t.value, 0)).toBeCloseTo(br.raw, 12);
      const term = br.terms.find((t) => t.id === 'station');
      if (bonus) expect(term).toMatchObject({ label: 'Near a station', value: bonus });
      else expect(term).toBeUndefined();
      if (devs.includes(d)) expect(c.st.desirability[d][i]).toBeCloseTo(Math.max(-1, Math.min(1, br.raw)), 6);
    }
    expect(NT).toBe(33);
  });

  it('applies the bonus before clamping and removes its Why? term immediately when the line is cut', () => {
    const c = city();
    subway(c.sim);
    const a = put(c.sim, 'tr_subway_station', 10, 21);
    put(c.sim, 'tr_subway_station', 40, 21);
    const i = centerCell(c.st, a) + 3;
    c.st.zone[i] = Zone.ResHigh;
    c.st.landValue[i] = 1;
    for (const layer of [c.st.policeCov, c.st.fireCov, c.st.healthCov, c.st.eduElemCov, c.st.eduHighCov, c.st.eduCollegeCov,
      c.st.playCov, c.st.greenCov, c.st.shopAccess, c.st.transitCov, c.st.prestige, c.st.treeCover]) layer[i] = 1;
    c.des.init!(c.sim);
    const br = desirabilityBreakdown(c.st, c.rt, DevType.R2, i);
    expect(br.raw).toBeGreaterThan(1);
    expect(c.st.desirability[DevType.R2][i]).toBe(1);
    c.st.subway[c.st.idx(25, 21)] = 0;
    c.sim.events.emit('subwayChanged', { x0: 25, z0: 21, x1: 26, z1: 22 });
    const cut = desirabilityBreakdown(c.st, c.rt, DevType.R2, i);
    expect(cut.terms.some((t) => t.id === 'station')).toBe(false);
    expect(br.raw - cut.raw).toBeCloseTo(0.04, 12);
  });
});

describe('transit development: commute approval', () => {
  const town = (difficulty: 'medium' | 'hard' = 'medium') => {
    const { st } = makeCity({ size: 32, difficulty }, []);
    const rt = new EconRuntime(), approval = approvalSystem(rt);
    const sim = new Simulation(st, [approval]);
    expect(econData(st).approvalTerms.commute).toBe(0); // an empty city's fallback is not anybody's commute
    const a = put(sim, 'res_apartment.r2.4', 4, 4, { pop: 3000 });
    const b = put(sim, 'res_apartment.r2.4', 12, 4, { pop: 9000 });
    st.stats.population = 12000;
    st.stats.residents = [0, 12000, 0];
    st.systemData.infraVersion = 1;
    st.systemData.infraLayers = { traffic: true, utilities: false, pollution: false, services: false };
    const month = (aMinutes: number, bMinutes = aMinutes) => {
      st.day++;
      st.commute[centerCell(st, a)] = aMinutes;
      st.commute[centerCell(st, b)] = bMinutes;
      approval.monthly!(sim);
      return econData(st).approvalTerms.commute;
    };
    return { st, rt, a, b, month };
  };

  it.each(['medium', 'hard'] as const)('fades commute pressure in with sampled residents on %s', (difficulty) => {
    const c = town(difficulty);
    const mid = (APPROVAL_TERMS.needsPop0 + APPROVAL_TERMS.needsPop1) / 2;
    for (const [pop, expected] of [[0, 0], [1200, 0], [APPROVAL_TERMS.needsPop0, 0], [mid, -1.25],
      [APPROVAL_TERMS.needsPop1, -2.5], [12000, -2.5]]) {
      c.a.pop = pop / 4;
      c.b.pop = pop * 3 / 4;
      // The survey, rather than the lagging displayed population, controls the grace period.
      c.st.stats.population = pop === mid ? 12000 : pop;
      c.st.stats.residents = [0, c.st.stats.population, 0];
      expect(c.month(25), `${pop} sampled residents`).toBeCloseTo(expected, 12);
      expect(residentSurvey(c.st, c.rt).pop[3]).toBe(pop);
    }
  });

  it('starts charging above the resident-weighted mean of 15 minutes in a full-size town', () => {
    const c = town();
    expect(APPROVAL.commuteStart).toBe(15);
    for (const [minutes, expected] of [[15, 0], [16, -0.25], [25, -2.5]]) {
      // At mean 15, the 12/16-minute homes cost nothing; the threshold applies after averaging.
      expect(c.month(minutes - 3, minutes + 1)).toBeCloseTo(expected, 12);
      expect(residentSurvey(c.st, c.rt).commute).toBe(minutes);
    }
    expect(c.month(25)).toBeCloseTo(-2.5, 12); // a genuine measurement equal to the fallback is still charged
  });

  it('keeps the measured cut-off penalty on Hard even when the city average is zero', () => {
    const c = town('hard');
    c.st.stats.avgCommute = 0;
    expect(c.month(120)).toBeCloseTo(-26.25, 12);
    expect(residentSurvey(c.st, c.rt).commute).toBe(120);
    expect(c.st.stats.avgCommute).toBe(0);
  });
});
