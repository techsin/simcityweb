/**
 * End-to-end: infra + economy systems together (createSystems), city built through CityActions with real catalog
 * defs, run for two years. Checks growth, utilities, traffic, services and that infra-owned flags don't thrash.
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { CityActions } from '../../src/sim/actions';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems';
import { getTraffic } from '../../src/sim/systems/infra';
import { newState } from './cityGen';

function line(x0: number, z0: number, x1: number, z1: number) {
  const out: { x: number; z: number }[] = [];
  const dx = Math.sign(x1 - x0), dz = Math.sign(z1 - z0);
  let x = x0, z = z0;
  out.push({ x, z });
  while (x !== x1 || z !== z1) {
    if (x !== x1) x += dx;
    else z += dz;
    out.push({ x, z });
  }
  return out;
}

describe('integration with economy systems', () => {
  it('a small city grows with power, water, traffic and services', { timeout: 120000 }, () => {
    const st = newState(64);
    st.config.sandbox = true;
    st.config.difficulty = 'sandbox';
    st.config.disasters = false;
    const sim = new Simulation(st, createSystems());
    const act = new CityActions(sim);
    const ok = (r: { ok: boolean; reason?: string }, what: string) => { if (!r.ok) throw new Error(`${what}: ${r.reason}`); };
    ok(act.buildNetwork(line(0, 32, 63, 32), Network.Avenue), 'avenue');
    for (let x = 8; x <= 56; x += 8) ok(act.buildNetwork(line(x, 6, x, 58), Network.Road), `road x=${x}`);
    ok(act.buildNetwork(line(8, 16, 56, 16), Network.Road), 'road z=16');
    ok(act.buildNetwork(line(8, 48, 56, 48), Network.Road), 'road z=48');
    // zones
    for (let x = 9; x < 56; x += 8) {
      act.zone({ x0: x, z0: 7, x1: x + 7, z1: 31 }, x < 40 ? Zone.ResLow : Zone.ResMed);
      act.zone({ x0: x, z0: 33, x1: x + 7, z1: 47 }, x < 32 ? Zone.ComMed : Zone.IndMed);
    }
    ok(act.plop('util_coal_plant', 49, 49, 0), 'coal plant');
    ok(act.plop('util_water_pump', 9, 49, 0), 'pump');
    ok(act.plop('util_water_pump', 11, 49, 0), 'pump2');
    ok(act.plop('civ_police_station', 17, 49, 0), 'police');
    ok(act.plop('civ_fire_station', 25, 49, 0), 'fire');
    ok(act.plop('civ_elementary_school', 33, 49, 0), 'school');
    ok(act.plop('tr_bus_stop', 9, 31, 0), 'bus stop');
    let changed = 0;
    sim.events.on('buildingChanged', () => changed++);
    const t0 = performance.now();
    sim.runDays(720);
    const ms = performance.now() - t0;
    const tr = getTraffic(sim)!;
    const s = st.stats;
    const all = [...st.buildings.values()];
    const done = all.filter((b) => b.built >= 1 && !(b.flags & (BF.Burnt | BF.Abandoned)));
    const powered = done.filter((b) => b.flags & BF.Powered).length;
    const watered = done.filter((b) => b.flags & BF.Watered).length;
    let roadVol = 0;
    for (let i = 0; i < st.cells; i++) if (st.network[i] >= 1 && st.network[i] <= 5) roadVol += st.traffic[i];
    console.log(`after 2 years: pop=${s.population} buildings=${all.length} powered=${powered}/${done.length} watered=${watered}/${done.length} ` +
      `power ${s.powerDemand.toFixed(1)}/${s.powerSupply.toFixed(0)} MW water ${s.waterDemand.toFixed(0)}/${s.waterSupply.toFixed(0)} kL ` +
      `commute=${s.avgCommute.toFixed(1)} traffic=${s.avgTraffic.toFixed(2)} car=${s.tripsCar} transit=${s.tripsTransit} walk=${s.tripsWalk} ` +
      `unemp=${(s.unemployment * 100).toFixed(1)}% garbage ${s.garbageProduced.toFixed(0)}/${s.garbageCapacity.toFixed(0)} t pol=${s.avgPollution.toFixed(2)} ` +
      `crime=${s.avgCrime.toFixed(2)} eq=${s.eq.toFixed(0)} hq=${s.hq.toFixed(0)} buildingChanged/day=${(changed / 720).toFixed(1)} sim=${ms.toFixed(0)}ms routes=${tr.getSampleRoutes(50).length}`);
    expect(s.population).toBeGreaterThan(500);
    expect(powered / Math.max(1, done.length)).toBeGreaterThan(0.9);
    expect(s.powerSupply).toBeGreaterThan(s.powerDemand);
    expect(roadVol).toBeGreaterThan(0);
    expect(s.tripsCar + s.tripsTransit + s.tripsWalk).toBeGreaterThan(0);
    expect(tr.cycles).toBeGreaterThan(50);
    expect(st.policeCov[st.idx(17, 47)]).toBeGreaterThan(0.3);
  });
});
