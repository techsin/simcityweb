import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF, emptyEmergencyMonth, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { EM_SCAR, REBUILD_SHARE } from '../../src/sim/economy/tuning';
import { EmergencySystem } from '../../src/sim/infra/emergency';
import { FireSystem } from '../../src/sim/infra/fire';
import { rebuildNimby, type EmergencyScar } from '../../src/sim/infra/nimby';
import { ServicesSystem } from '../../src/sim/infra/services';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { newState, place, roadLine } from '../infra/cityGen';

function make(st: CityState, services = false) {
  const fire = new FireSystem(), emergency = new EmergencySystem();
  const sim = new Simulation(st, services ? [new ServicesSystem(), fire, emergency] : [fire, emergency]);
  fire.riskBoost = 0;
  return { st, sim, fire, emergency };
}

function burntSite() {
  const st = newState(32);
  const home = place(st, 't_r2', 10, 10);
  const town = make(st);
  expect(town.fire.ignite(town.sim, home)).toBe(true);
  const incident = town.emergency.incidents()[0];
  town.sim.runDays(6);
  expect(home.flags & BF.Burnt).toBeTruthy();
  return { ...town, home, incident };
}

const scarsOf = (st: CityState) => st.systemData.emergencyScars as EmergencyScar[] | undefined;

describe('LG-06 scars after unanswered fires', () => {
  it('records each burnt footprint once and exposes its rebuild cost without adding random draws', () => {
    const st = newState(32);
    const home = place(st, 't_r2', 10, 10);
    const { sim, fire, emergency } = make(st);
    fire.ignite(sim, home);
    const incident = emergency.incidents()[0];
    const cityRng = sim.rng.state, fireRng = st.systemData.infraFireRng;
    const emergencyRng = (st.systemData.emergency as { rng: number }).rng;
    sim.runDays(6);
    rebuildNimby(sim);
    expect(scarsOf(st)).toEqual([{ x: 10, z: 10, w: 1, d: 1, expires: st.day + EM_SCAR.days }]);
    expect(incident.rebuildCost).toBe(60 * 40 * REBUILD_SHARE);
    expect(incident.rebuildCost).toBe(st.stats.emergency.month.damage * REBUILD_SHARE);
    expect(st.stats.emergency.month.unansweredDamage).toBe(st.stats.emergency.month.damage);
    expect(sim.rng.state).toBe(cityRng);
    expect(st.systemData.infraFireRng).toBe(fireRng);
    expect((st.systemData.emergency as { rng: number }).rng).toBe(emergencyRng);
    sim.runDays(2);
    expect(scarsOf(st)).toHaveLength(1);
  });

  it('charges a building lost after a late answer, with no scar for an answered call', () => {
    const st = newState(96);
    roadLine(st, 2, 20, 93, 20, Network.Road);
    const station = place(st, 't_fire', 4, 19);
    const home = place(st, 't_r2', 65, 21);
    const { sim, fire, emergency } = make(st);
    fire.ignite(sim, home);
    const incident = emergency.incidents()[0];
    expect(incident.answered).toBe(0);
    sim.runDays(5);
    expect(emergency.dispatch(sim, incident.id, station.id).ok).toBe(true);
    expect(incident.answered).toBe(2);
    sim.runDays(1);
    expect(home.flags & BF.Burnt).toBeTruthy();
    expect(incident.rebuildCost).toBeGreaterThan(0);
    expect(st.stats.emergency.month.unansweredDamage ?? 0).toBe(0);
    emergency.monthly(sim);
    expect(st.stats.emergency.lastMonth.rebuildCost).toBe(Math.round(incident.rebuildCost!));
    expect(st.stats.emergency.lastMonth.unansweredRebuildCost).toBe(0);
    expect(scarsOf(st)).toBeUndefined();
  });

  it('sums the actual rounded monthly charges over 12 months without billing old saved damage', () => {
    const st = newState(16);
    const old = emptyEmergencyMonth();
    old.damage = 1000;
    st.systemData.emergency = { v: 1, months: [old] };
    const { sim, emergency } = make(st);
    const roll = (damage = 0, unansweredDamage = 0) => {
      st.stats.emergency.month.damage = damage;
      st.stats.emergency.month.unansweredDamage = unansweredDamage;
      st.day += 30;
      emergency.monthly(sim);
    };
    roll(10, 10);
    expect(st.stats.emergency.lastMonth.rebuildCost).toBe(2);
    expect(st.stats.emergency.lastMonth.unansweredRebuildCost).toBe(2);
    expect(st.stats.emergency.year.rebuildCost).toBe(2);
    expect(st.stats.emergency.year.damage).toBe(1010);
    roll(10, 5);
    expect(st.stats.emergency.lastMonth.unansweredRebuildCost).toBe(1);
    expect(st.stats.emergency.year.rebuildCost).toBe(4);
    expect(st.stats.emergency.year.unansweredRebuildCost).toBe(3);
    expect(st.stats.emergency.year.unansweredDamage).toBe(15);
    for (let month = 0; month < 10; month++) roll();
    expect(st.stats.emergency.year.damage).toBe(20);
    expect(st.stats.emergency.year.rebuildCost).toBe(4);
    roll();
    expect(st.stats.emergency.year.rebuildCost).toBe(2);
    expect(st.stats.emergency.year.unansweredRebuildCost).toBe(1);
    roll();
    expect(st.stats.emergency.year.rebuildCost).toBe(0);
    expect(st.stats.emergency.year.unansweredRebuildCost).toBe(0);
    expect(st.stats.emergency.year.unansweredDamage).toBe(0);
  });

  it('splats 0.15 at the core with radius 3 and removes the scar exactly at 18 months', () => {
    const { st, sim } = burntSite();
    rebuildNimby(sim);
    expect(st.stigma[st.idx(10, 10)]).toBeCloseTo(0.15, 7);
    expect(st.stigma[st.idx(11, 10)]).toBeCloseTo(0.15, 7);
    expect(st.stigma[st.idx(12, 10)]).toBeGreaterThan(0);
    expect(st.stigma[st.idx(12, 10)]).toBeLessThan(0.15);
    expect(st.stigma[st.idx(14, 10)]).toBe(0);
    const expires = scarsOf(st)![0].expires;
    st.day = expires - 1;
    rebuildNimby(sim);
    expect(st.stigma[st.idx(10, 10)]).toBeCloseTo(0.15, 7);
    st.day = expires;
    rebuildNimby(sim);
    expect(scarsOf(st)).toEqual([]);
    expect(st.stigma.every((value) => value === 0)).toBe(true);
  });

  it('restores the exact list and derived stigma on a mid-scar load and continues to the same expiry', () => {
    const original = burntSite();
    original.st.day += Math.floor(EM_SCAR.days / 2);
    rebuildNimby(original.sim);
    const saved = serializeCity(original.st, { copy: true });
    const restored = make(deserializeCity(structuredClone(saved)), true);
    expect(scarsOf(restored.st)).toEqual(scarsOf(original.st));
    expect(restored.st.stigma).toEqual(original.st.stigma);
    const expires = scarsOf(original.st)![0].expires;
    for (const day of [expires - 1, expires]) {
      original.st.day = restored.st.day = day;
      rebuildNimby(original.sim);
      rebuildNimby(restored.sim);
      expect(scarsOf(restored.st)).toEqual(scarsOf(original.st));
      expect(restored.st.stigma).toEqual(original.st.stigma);
    }
  });

  it('loads an old save without the optional scar list and leaves its NIMBY raster unchanged', () => {
    const st = newState(16);
    const saved = serializeCity(st, { copy: true });
    expect((saved.data.systemData as Record<string, unknown>).emergencyScars).toBeUndefined();
    const restored = make(deserializeCity(structuredClone(saved)), true);
    expect(scarsOf(restored.st)).toBeUndefined();
    expect(restored.st.stigma.every((value) => value === 0)).toBe(true);
  });
});
