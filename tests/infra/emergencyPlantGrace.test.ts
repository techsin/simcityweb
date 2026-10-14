/**
 * WP8 final fixes (emergency lane, lead decisions 4 / 8): the early-game plant grace. No industrial accident at a
 * thermal power plant or incinerator (EMERG_PLANT_P) before the city's first funded fire station, for at most its first
 * EMERG_PLANT_GRACE_DAYS — a new town must not lose its only power plant to an accident nobody could answer. Afterwards
 * (or once a funded fire station existed) plant accidents happen as before. Deterministic and saved.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import type { Simulation } from '../../src/sim/Simulation';
import { EMERG_PLANT_GRACE_DAYS, emergencyOf } from '../../src/sim/infra/emergency';
import { getFire } from '../../src/sim/systems/infra';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { newSim, newState, place, roadLine } from './cityGen';

/** 30 coal plants (2x2, smoky: plant-accident candidates) and, optionally, a fire station; utilities at half funding
 *  (1.5 - 0.5 = 1: an accident rate of 1 % per plant-month) */
function plants(withStation: boolean): { st: CityState; sim: Simulation; ids: Set<number>; accidents: () => number } {
  const st = newState(64);
  roadLine(st, 2, 40, 62, 40, Network.Road);
  if (withStation) place(st, 't_fire', 30, 39);
  const ps: Building[] = [];
  for (let z = 4; z < 34 && ps.length < 30; z += 6) for (let x = 4; x < 60 && ps.length < 30; x += 9) ps.push(place(st, 't_coal', x, z));
  st.budget.funding.utilities = 50;
  const sim = newSim(st);
  getFire(sim)!.riskBoost = 0; // no natural ignitions: the accidents alone
  const ids = new Set(ps.map((b) => b.id));
  let n = 0;
  sim.events.on('emergency', (e) => {
    if (e.type !== 'new' || e.kind !== 'industrial') return;
    const inc = emergencyOf(sim)!.incident(e.id);
    if (inc && ids.has(inc.buildingId)) n++;
  });
  return { st, sim, ids, accidents: () => n };
}

describe('early-game plant grace (lead decisions 4 / 8)', () => {
  it('a town without a fire station keeps its plants through its first three years; accidents resume afterwards', { timeout: 600000 }, () => {
    const t = plants(false);
    expect(EMERG_PLANT_GRACE_DAYS).toBe(3 * 360);
    t.sim.runDays(EMERG_PLANT_GRACE_DAYS - 1);
    expect(t.accidents()).toBe(0);
    for (const id of t.ids) expect(t.st.buildings.get(id)!.flags & (BF.OnFire | BF.Burnt)).toBe(0);
    // the grace ends at the first month start after three years: ~0.3 accidents a month from then on
    t.sim.runDays(720);
    expect(t.accidents()).toBeGreaterThan(2);
  });

  it('with a funded fire station the grace is over from the first month (accidents as before)', { timeout: 600000 }, () => {
    const t = plants(true);
    t.sim.runDays(EMERG_PLANT_GRACE_DAYS - 1);
    expect(t.accidents()).toBeGreaterThan(2);
  });

  it('the grace ends for good once a funded fire station existed (saved: a reload does not restart it)', { timeout: 600000 }, () => {
    const t = plants(true);
    t.sim.runDays(35);
    const P = () => (t.st.systemData.emergency as { plantGraceOver?: boolean }).plantGraceOver;
    expect(P()).toBe(true);
    // the station goes (bulldozed) and the game is saved and reloaded: still over
    const station = [...t.st.buildings.values()].find((b) => b.def === 't_fire')!;
    for (let z = station.z; z < station.z + station.d; z++) for (let x = station.x; x < station.x + station.w; x++) t.st.building[t.st.idx(x, z)] = -1;
    t.st.buildings.delete(station.id);
    t.sim.events.emit('buildingRemoved', station);
    const st2 = deserializeCity(structuredClone(serializeCity(t.st, { copy: true })) as SerializedCity);
    const sim2 = newSim(st2);
    getFire(sim2)!.riskBoost = 0;
    expect((st2.systemData.emergency as { plantGraceOver?: boolean }).plantGraceOver).toBe(true);
    let n = 0;
    sim2.events.on('emergency', (e) => { if (e.type === 'new' && e.kind === 'industrial') n++; });
    sim2.runDays(360);
    expect(n).toBeGreaterThan(0);
  });
});
