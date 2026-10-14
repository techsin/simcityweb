/**
 * WP8 final fixes (emergency lane, item P6 + routed item 47): save / load must not change an emergency's outcome.
 *  - A loaded game decides with the siren link times the original's searches use (saved in systemData.emergency):
 *    its own traffic layer is recomputed at load (traffic's warm start), and a fire 3.92 min from a 3.90-min station
 *    used to become "covered" by a reload and was auto-dispatched.
 *  - A network edit saved before the road graph caught up retries the waiting incidents in the loaded game too (the
 *    loaded graph already has the edit), and a rebuild of the very same network (traffic after a load's 'reset', a
 *    subway edit) is no retry wave at all.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { CityState } from '../../src/sim/CityState';
import { Simulation, type EmergencyEvent } from '../../src/sim/Simulation';
import { EmergencySystem, emergencyOf } from '../../src/sim/infra/emergency';
import { FireSystem } from '../../src/sim/infra/fire';
import { DisastersSystem } from '../../src/sim/infra/disasters';
import { NET_CAPACITY } from '../../src/sim/infra/params';
import { getFire, getTraffic, triggerDisaster } from '../../src/sim/systems/infra';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { newSim, newState, place, roadLine } from './cityGen';

/** fire + emergency only (no traffic system: the test owns the traffic layer the siren times are read from) */
const make = (st: CityState) => new Simulation(st, [new FireSystem(), new EmergencySystem(), new DisastersSystem()]);
const save = (st: CityState) => structuredClone(serializeCity(st, { copy: true })) as SerializedCity;
function log(sim: Simulation): string[] {
  const out: string[] = [];
  sim.events.on('emergency', (e: EmergencyEvent) => out.push(`${sim.state.day}:${e.type}:${e.id}:${e.kind}:${e.reason ?? ''}:${e.manualPossible}:${e.etaMin ?? ''}`));
  return out;
}
const decision = (sim: Simulation) => emergencyOf(sim)!.incidents().map((i) => ({ id: i.id, state: i.state, reason: i.reason, manualPossible: i.manualPossible, canSend: i.canSend, bestEta: i.bestEta, deadline: i.deadline, answered: i.answered }));

describe('save / load keeps an emergency\'s dispatch decision (P6, routed 47)', () => {
  /** a street along z = 20, a fire station at x = 4 (2.6-min reach) and a home at x = 28: 2.4 min in free flow, 2.95
   *  min with the congested street the test lays on (v/c 1.5 between them) */
  function town(): { st: CityState; sim: Simulation } {
    const st = newState(96);
    roadLine(st, 2, 20, 93, 20, Network.Road);
    place(st, 't_fire', 4, 19);
    place(st, 't_r2', 28, 21, { pop: 60 });
    for (let x = 2; x <= 40; x++) st.traffic[st.idx(x, 20)] = 1.5 * NET_CAPACITY[Network.Road];
    const sim = make(st);
    getFire(sim)!.riskBoost = 0;
    return { st, sim };
  }

  it('a loaded game decides with the saved siren times, not with its own (recomputed) traffic layer', () => {
    const a = town();
    expect(triggerDisaster(a.sim, 'fire', 28, 21)).toBe(true);
    const inc = emergencyOf(a.sim)!.incidents()[0];
    expect(inc.state).toBe('uncovered');
    expect(inc.reason).toBe('outOfRange');
    expect(inc.manualPossible).toBe(true);
    expect(inc.bestEta!).toBeGreaterThan(2.6);
    const saved = save(a.st);
    expect((saved.data.systemData as { emergency: { siren?: { t?: Float32Array } } }).emergency.siren?.t).toBeInstanceOf(Float32Array);
    const run = (s: SerializedCity) => {
      const st2 = deserializeCity(structuredClone(s));
      // the loaded game's traffic layer is not the original's: traffic's warm start (it inits before the emergency
      // system) recomputes it — here free flow
      st2.traffic.fill(0);
      const sim2 = make(st2);
      getFire(sim2)!.riskBoost = 0;
      expect(decision(sim2)).toEqual(decision(a.sim));
      return sim2;
    };
    const b = run(saved);
    // without the saved times the reload turns the same fire into a covered one (the old behaviour)
    const old = structuredClone(saved);
    delete (old.data.systemData as { emergency: { siren?: unknown } }).emergency.siren;
    const c = run(old);
    const la = log(a.sim), lb = log(b), lc = log(c);
    for (let d = 0; d < 8; d++) {
      a.sim.runDays(1);
      b.runDays(1);
      c.runDays(1);
      expect(decision(b), `day ${a.st.day}`).toEqual(decision(a.sim));
    }
    expect(la.length).toBeGreaterThan(0);
    expect(lb).toEqual(la);
    expect(lc).not.toEqual(la);
    expect(lc.some((e) => /:dispatched:/.test(e))).toBe(true);
    expect(b.state.stats.emergency.month).toEqual(a.st.stats.emergency.month);
  });

  it('routed 47: a network edit saved before the next day retries the waiting incidents in the loaded game as in the original', () => {
    // a far clinic (outside its reach, a far manual dispatch possible); its road is cut right before the save
    const st = newState(96);
    roadLine(st, 2, 20, 93, 20, Network.Road);
    place(st, 't_clinic', 4, 19);
    const home = place(st, 't_r2', 40, 21, { pop: 60 });
    const sim = make(st);
    getFire(sim)!.riskBoost = 0;
    const em = emergencyOf(sim)!;
    const id = em.spawn(sim, 'medical', home.x, home.z, { buildingId: home.id, major: true, severity: 3 });
    expect(em.incident(id)!.reason).toBe('outOfRange');
    expect(em.incident(id)!.manualPossible).toBe(true);
    sim.runDays(1);
    st.network[st.idx(20, 20)] = 0;
    sim.events.emit('networkChanged', { x0: 20, z0: 20, x1: 21, z1: 21 });
    const st2 = deserializeCity(save(st));
    const sim2 = make(st2);
    getFire(sim2)!.riskBoost = 0;
    const l1 = log(sim), l2 = log(sim2);
    for (let d = 0; d < 6; d++) {
      sim.runDays(1);
      sim2.runDays(1);
      expect(decision(sim2), `day ${st.day}`).toEqual(decision(sim));
    }
    // both noticed the cut the next day: no ambulance can reach the home any more
    expect(em.incident(id)!.reason).toBe('noStation');
    expect(l1.length).toBeGreaterThan(0);
    expect(l2).toEqual(l1);
  });

  it('a rebuild of the very same road network (subway edit, a load\'s reset) is no retry wave; a real road edit is', { timeout: 120000 }, () => {
    const st = newState(64);
    roadLine(st, 2, 20, 62, 20, Network.Road);
    place(st, 't_clinic', 4, 19);
    const home = place(st, 't_r2', 40, 21, { pop: 60 });
    for (let x = 8; x < 60; x += 3) place(st, 't_r2', x, 19, { pop: 40 });
    const sim = newSim(st);
    getFire(sim)!.riskBoost = 0;
    const em = emergencyOf(sim)!;
    const tr = getTraffic(sim)!;
    sim.runDays(3);
    const id = em.spawn(sim, 'medical', home.x, home.z, { buildingId: home.id, major: true, severity: 3 });
    const inc = em.incident(id)!;
    expect(inc.state).toBe('uncovered');
    const P = em as unknown as { stVer: number };
    const ver = P.stVer, retry = inc.retry, gv = tr.road.version;
    sim.events.emit('subwayChanged', undefined as never);
    sim.events.emit('reset', undefined);
    for (let d = 0; d < 3 && tr.road.version === gv; d++) sim.runDays(1);
    expect(tr.road.version).not.toBe(gv); // traffic did rebuild its graph
    expect(P.stVer).toBe(ver);
    expect(inc.stVer).toBe(ver);
    expect(inc.retry).toBe(retry);
    // a real road edit: the incident retries on the new graph
    roadLine(st, 30, 21, 30, 30, Network.Road);
    sim.events.emit('networkChanged', { x0: 30, z0: 21, x1: 31, z1: 31 });
    const gv2 = tr.road.version;
    for (let d = 0; d < 6 && tr.road.version === gv2; d++) sim.runDays(1);
    expect(tr.road.version).not.toBe(gv2);
    sim.runDays(1);
    expect(P.stVer).toBeGreaterThan(ver);
    if (em.incident(id)) expect(em.incident(id)!.stVer).toBe(P.stVer);
  });
});
