import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { getUtilities } from '../../src/sim/systems/infra';
import { newSim, newState, place, roadLine } from './cityGen';

describe('power', () => {
  it('propagates through roads, power lines and buildings; empty zones next to conductors are powered', () => {
    const st = newState(64);
    roadLine(st, 5, 10, 30, 10, Network.Road);
    const plant = place(st, 't_coal', 3, 9); // 2x2 at x 3..4 touching road at x=5
    const house = place(st, 't_r1', 20, 11, { pop: 10 });
    const far = place(st, 't_r1', 50, 50, { pop: 10 }); // isolated
    // a power line bridging to a second cluster
    for (let x = 31; x <= 40; x++) st.powerLines[st.idx(x, 10)] = 1;
    const viaLine = place(st, 't_r1', 41, 10, { pop: 10 });
    st.zone[st.idx(25, 11)] = Zone.ResLow; // empty zoned cell next to the road
    st.zone[st.idx(25, 13)] = Zone.ResLow; // not adjacent
    const sim = newSim(st);
    expect(plant.flags & BF.Powered).toBeTruthy();
    expect(house.flags & BF.Powered).toBeTruthy();
    expect(viaLine.flags & BF.Powered).toBeTruthy();
    expect(far.flags & BF.Powered).toBeFalsy();
    expect(st.powered[st.idx(25, 11)]).toBe(1);
    expect(st.powered[st.idx(25, 13)]).toBe(0);
    expect(st.stats.powerSupply).toBeCloseTo(1000, 3);
    expect(st.stats.powerDemand).toBeGreaterThan(0);
    void sim;
  });

  it('brownout: consumers farthest from the plant lose power first', () => {
    const st = newState(64);
    roadLine(st, 2, 5, 60, 5, Network.Road);
    place(st, 't_small_plant', 1, 5); // 10 MW at the west end
    const houses = [];
    for (let x = 3; x <= 60; x += 1) houses.push(place(st, 't_r2', x, 6, { pop: 60 })); // ~3 MW each (60 * 0.05)
    const sim = newSim(st);
    const powered = houses.map((h) => (h.flags & BF.Powered) !== 0);
    expect(st.stats.powerDemand).toBeGreaterThan(st.stats.powerSupply);
    expect(powered[0]).toBe(true);
    expect(powered[powered.length - 1]).toBe(false);
    // monotone: once unpowered, everything farther is unpowered
    const firstOff = powered.indexOf(false);
    expect(firstOff).toBeGreaterThan(0);
    expect(powered.slice(firstOff).every((p) => !p)).toBe(true);
    // served demand <= supply
    const served = houses.filter((h) => h.flags & BF.Powered).length * 3;
    expect(served).toBeLessThanOrEqual(10.0001);
    void sim;
  });

  it('power conservation ordinance cuts demand and emits buildingChanged when power flips', () => {
    const st = newState(64);
    roadLine(st, 2, 5, 40, 5, Network.Road);
    place(st, 't_small_plant', 1, 5);
    for (let x = 3; x <= 6; x++) place(st, 't_r2', x, 6, { pop: 55 }); // 4 x 2.8125 MW = 11.25 MW > 10
    const sim = newSim(st);
    const u = getUtilities(sim)!;
    const d0 = st.stats.powerDemand;
    expect(d0).toBeCloseTo(11.25, 3);
    expect([...st.buildings.values()].filter((b) => b.def === 't_r2').every((b) => b.flags & BF.Powered)).toBe(false);
    let changed = 0;
    sim.events.on('buildingChanged', () => changed++);
    st.budget.ordinances.push('power_conservation');
    u.compute(sim);
    expect(st.stats.powerDemand).toBeCloseTo(11.25 * 0.85, 3);
    expect(changed).toBeGreaterThan(0); // the last house regained power
    expect([...st.buildings.values()].every((b) => b.flags & BF.Powered)).toBe(true);
  });

  it('recomputes after networkChanged (incremental dirty flag)', () => {
    const st = newState(64);
    roadLine(st, 2, 5, 20, 5, Network.Road);
    place(st, 't_coal', 0, 4);
    const h = place(st, 't_r1', 30, 6, { pop: 10 });
    const sim = newSim(st);
    expect(h.flags & BF.Powered).toBeFalsy();
    roadLine(st, 21, 5, 30, 5, Network.Road);
    sim.events.emit('networkChanged', { x0: 21, z0: 5, x1: 31, z1: 6 });
    sim.advanceDay();
    expect(h.flags & BF.Powered).toBeTruthy();
  });
});

describe('water', () => {
  it('pipes follow roads; producers feed their road component; buildings next to watered roads get water', () => {
    const st = newState(64);
    roadLine(st, 5, 20, 40, 20, Network.Street);
    place(st, 't_tower', 4, 20); // touches road at x=5
    const a = place(st, 't_r1', 10, 21, { pop: 10 });
    const b = place(st, 't_r1', 10, 23, { pop: 10 }); // 2 cells from road -> no water
    roadLine(st, 50, 40, 60, 40, Network.Street); // separate network without producer
    const c = place(st, 't_r1', 55, 41, { pop: 10 });
    st.zone[st.idx(20, 21)] = Zone.ResLow;
    newSim(st);
    expect(a.flags & BF.Watered).toBeTruthy();
    expect(b.flags & BF.Watered).toBeFalsy();
    expect(c.flags & BF.Watered).toBeFalsy();
    expect(st.watered[st.idx(20, 21)]).toBe(1);
    expect(st.watered[st.idx(20, 20)]).toBe(1); // the road (pipe) itself
    expect(st.stats.waterSupply).toBeCloseTo(100, 3);
  });

  it('pumps near fresh water produce +50 %; shortage cuts the farthest consumers', () => {
    const st = newState(64);
    for (let z = 0; z < 64; z++) for (let x = 0; x < 3; x++) st.water[st.idx(x, z)] = 1;
    roadLine(st, 4, 10, 60, 10, Network.Road);
    place(st, 't_pump', 4, 11); // 2 cells from water at x<=2 -> 150
    const houses = [];
    for (let x = 5; x <= 60; x++) houses.push(place(st, 't_r2', x, 11, { pop: 60 })); // 12 kL each
    newSim(st);
    expect(st.stats.waterSupply).toBeCloseTo(150, 3);
    const w = houses.map((h) => (h.flags & BF.Watered) !== 0);
    expect(w[0]).toBe(true);
    expect(w[w.length - 1]).toBe(false);
    const firstOff = w.indexOf(false);
    expect(w.slice(firstOff).every((v) => !v)).toBe(true);
  });
});
