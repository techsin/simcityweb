/**
 * EM-1 (final-fix round 2, lead decision 20d): a Dispatch prompt rests on a unit that is free at the moment of the
 * decision. A disaster's burst dispatches its incidents one after the other (spawn -> tryDispatch at once), so a later
 * incident used to take the very unit an earlier prompt counted on: the earlier one kept manualPossible / canSend with
 * no free unit ("Send nearest 3.9 min" that fails, LIVE held for days, the urgent pause never ending) and its failure
 * scored as an IGNORED prompt (approval −8 after a quake). Now
 *  - a dispatch (automatic or the player's) that takes a station's last free unit re-validates the waiting incidents
 *    that counted on it: no free unit left -> the prompt ends at once with an honest note; the named unit gone but
 *    another one free -> decided again by the next dispatch pass;
 *  - dispatchBest failing for lack of a free unit ends the prompt at once;
 *  - a prompt counts (prompted; ignored when nobody answers) only at a settle point: the end of a day's dispatch work.
 * (The earthquake in a bot town and the normal-play prompt count: emergencyBot.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { CityState, Building } from '../../src/sim/CityState';
import type { EmergencyEvent, Simulation } from '../../src/sim/Simulation';
import { emergencyOf, type EmergencySystem } from '../../src/sim/infra/emergency';
import { getFire, triggerDisaster } from '../../src/sim/systems/infra';
import { newSim, newState, place, roadLine } from './cityGen';

/** a street along z = 20 (x 2..size-3) with a fire station (2 trucks, 2.6-min reach) at x = 4 */
function town(size = 96): { st: CityState; sim: Simulation; em: EmergencySystem; station: Building } {
  const st = newState(size);
  roadLine(st, 2, 20, size - 3, 20, Network.Road);
  const station = place(st, 't_fire', 4, 19);
  const sim = newSim(st);
  getFire(sim)!.riskBoost = 0; // no random ignitions
  return { st, sim, em: emergencyOf(sim)!, station };
}

describe('EM-1: a prompt never outlives the free unit it rests on', () => {
  it('two out-of-range fires and then an in-range incident, one free truck: the prompts end at once, nothing scores as ignored', () => {
    const { st, sim, em, station } = town();
    const f1 = place(st, 't_id', 8, 21, { jobs: 40 });
    const f2 = place(st, 't_id', 12, 21, { jobs: 40 });
    const h1 = place(st, 't_r2', 40, 21, { pop: 60 });
    const h2 = place(st, 't_r2', 46, 21, { pop: 60 });
    const ev: EmergencyEvent[] = [];
    sim.events.on('emergency', (e) => ev.push(e));
    // one truck busy with a spill in range (4 days of work)
    const s1 = em.spawn(sim, 'spill', f1.x, f1.z, { buildingId: f1.id });
    expect(em.incident(s1)!.state).toBe('dispatched');
    expect(em.stationFleet(station.id)!.free).toBe(1);
    // two fires beyond the station's reach that the free truck could still reach in time: Dispatch prompts
    triggerDisaster(sim, 'fire', h1.x, h1.z);
    triggerDisaster(sim, 'fire', h2.x, h2.z);
    const fires = em.incidents().filter((i) => i.kind === 'fire');
    expect(fires.length).toBe(2);
    for (const f of fires) {
      expect([f.state, f.reason, f.manualPossible, f.canSend]).toEqual(['uncovered', 'outOfRange', true, true]);
      expect(f.bestFrom).toBe(station.id);
    }
    expect(st.stats.emergency.manualActive).toBe(2);
    // the same day an in-range incident takes the last free truck automatically
    const s2 = em.spawn(sim, 'spill', f2.x, f2.z, { buildingId: f2.id });
    expect(em.incident(s2)!.state).toBe('dispatched');
    expect(em.stationFleet(station.id)!.free).toBe(0);
    // both prompts are over: nothing can be sent, the note says why and what happens next, the banner hears of it
    for (const f of fires) {
      expect([f.state, f.manualPossible, f.canSend, f.bestEta]).toEqual(['uncovered', false, false, undefined]);
      expect(f.note).toBe('Outside fire coverage and all 2 fire trucks are busy — you can send one once one is back');
      expect(ev.filter((e) => e.id === f.id && e.type === 'uncovered').at(-1)!.manualPossible).toBe(false);
      expect(em.dispatchBest(sim, f.id).ok).toBe(false);
    }
    expect(st.stats.emergency.manualActive).toBe(0);
    // the spills keep both trucks out until the fires can no longer be reached in time: they burn down — failed, but
    // no prompt was ever answerable at a settle point, so nothing counts as ignored
    for (let d = 0; d < 10 && fires.some((f) => em.incident(f.id)); d++) {
      sim.runDays(1);
      for (const f of fires) if (em.incident(f.id)) expect(f.prompted).toBeFalsy();
    }
    const m = st.stats.emergency.month;
    expect(fires.every((f) => !em.incident(f.id))).toBe(true);
    expect(m.failed).toBeGreaterThanOrEqual(2);
    expect(m.ignored ?? 0).toBe(0);
  });

  it('an in-range station with busy trucks: "one is sent as soon as one is back" — and it is', () => {
    const { st, sim, em, station } = town();
    const f1 = place(st, 't_id', 8, 21, { jobs: 40 });
    const f2 = place(st, 't_id', 12, 21, { jobs: 40 });
    // a second station far right with 2 free trucks: beyond the home's reach from there, but they could still go
    const far = place(st, 't_fire', 80, 19);
    sim.events.emit('buildingAdded', far);
    const home = place(st, 't_r2', 22, 21, { pop: 60 });
    // both trucks of the near station busy with industrial accidents in its reach (1.5 days of work each)
    const s1 = em.spawn(sim, 'industrial', f1.x, f1.z, { buildingId: f1.id });
    const s2 = em.spawn(sim, 'industrial', f2.x, f2.z, { buildingId: f2.id });
    expect([em.incident(s1)!.state, em.incident(s2)!.state]).toEqual(['dispatched', 'dispatched']);
    expect(em.stationFleet(station.id)!.free).toBe(0);
    triggerDisaster(sim, 'fire', home.x, home.z);
    const fire = em.incidents().find((i) => i.kind === 'fire')!;
    // in reach of the busy station (reason busy); the far station's free trucks are the player's option
    expect([fire.state, fire.reason, fire.manualPossible]).toEqual(['uncovered', 'busy', true]);
    expect(fire.bestFrom).toBe(far.id);
    // the player sends both far trucks elsewhere (a fire next to their station): nothing can go to the home any more
    const other = place(st, 't_r2', 78, 21, { pop: 60 });
    triggerDisaster(sim, 'fire', other.x, other.z);
    const o = em.incidents().find((i) => i.kind === 'fire' && i.buildingId === other.id)!;
    expect(o.state).toBe('dispatched'); // in range of the far station: automatic
    expect(em.dispatch(sim, o.id, far.id, 1).ok).toBe(true); // + its second truck, by the player
    expect(em.stationFleet(far.id)!.free).toBe(0);
    expect([fire.manualPossible, fire.canSend]).toEqual([false, false]);
    expect(fire.note).toBe('All 4 fire trucks are busy — one is sent as soon as one is back');
    // a truck comes back: it is sent automatically (the busy station is in range) — no prompt in between
    for (let d = 0; d < 12 && fire.state === 'uncovered'; d++) {
      sim.runDays(1);
      if (fire.state === 'uncovered') expect(fire.prompted).toBeFalsy();
    }
    expect(['dispatched', 'onScene']).toContain(fire.state);
    expect(fire.answered).toBe(1);
    expect(em.vehicles().find((v) => v.incidentId === fire.id)!.stationId).toBe(station.id);
    // the coverage promise holds for it: saved
    sim.runDays(10);
    expect(em.incident(fire.id)).toBeUndefined();
    expect(fire.state).toBe('resolved');
    expect(st.stats.emergency.month.ignored ?? 0).toBe(0);
  });

  it('the unit a prompt named is taken but another one is still free: decided again by the next pass (no stale ETA)', () => {
    const { st, sim, em, station } = town();
    // a second station 30 cells left of the home (3.0 min: beyond its 2.6-min reach) and the home's own block
    const mid = place(st, 't_fire', 34, 19);
    sim.events.emit('buildingAdded', mid);
    const home = place(st, 't_r2', 64, 21, { pop: 60 });
    triggerDisaster(sim, 'fire', home.x, home.z);
    const fire = em.incidents()[0];
    expect([fire.state, fire.reason, fire.manualPossible]).toEqual(['uncovered', 'outOfRange', true]);
    expect(fire.bestFrom).toBe(mid.id);
    expect(fire.bestEta).toBeCloseTo(3.0, 1);
    // both trucks of that station go elsewhere (two spills in its reach)
    for (const x of [30, 38]) {
      const f = place(st, 't_id', x, 21, { jobs: 40 });
      expect(em.incident(em.spawn(sim, 'spill', f.x, f.z, { buildingId: f.id }))!.state).toBe('dispatched');
    }
    expect(em.stationFleet(mid.id)!.free).toBe(0);
    // the station at x = 4 still has its trucks (6.0 min away): the prompt is decided again at the next dispatch pass
    expect(fire.retry).toBeLessThanOrEqual(st.day);
    sim.runDays(1);
    // 6.0 min (the station at x = 4) to a fire that burns down in 5 more days: nobody can make it — no prompt (canSend
    // only: the banner still offers it, "too far?"), not prompted
    expect([fire.state, fire.manualPossible, fire.canSend, fire.bestEta, fire.bestFrom]).toEqual(['uncovered', false, true, undefined, undefined]);
    expect(fire.prompted).toBeFalsy();
    const best = em.dispatchOptions(sim, fire.id).find((o) => o.free > 0)!;
    expect(best.stationId).toBe(station.id);
    expect(best.etaMin).toBeCloseTo(6.0, 1);
  });

  it('"Send nearest" that finds no free unit ends the prompt at once (not at the next day tick)', () => {
    const { st, sim, em, station } = town();
    const home = place(st, 't_r2', 40, 21, { pop: 60 });
    triggerDisaster(sim, 'fire', home.x, home.z);
    const fire = em.incidents()[0];
    expect(fire.manualPossible).toBe(true);
    // (both trucks out behind the system's back — e.g. a stale decision of an older save: the case dispatchBest guards)
    (em as unknown as { out: Map<number, number> }).out.set(station.id, 2);
    const r = em.dispatchBest(sim, fire.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('No free fire truck can reach this place');
    expect([fire.manualPossible, fire.canSend, fire.bestEta]).toEqual([false, false, undefined]);
    expect(fire.note).toMatch(/all 2 fire trucks are busy/);
    expect(st.stats.emergency.manualActive).toBe(0);
  });

  it('a prompt counts at the settle point only while the unit it rests on is free (taken after its decision: decided again first)', () => {
    const { st, sim, em, station } = town();
    const home = place(st, 't_r2', 40, 21, { pop: 60 });
    triggerDisaster(sim, 'fire', home.x, home.z);
    const fire = em.incidents()[0];
    expect([fire.state, fire.reason, fire.manualPossible, fire.bestFrom]).toEqual(['uncovered', 'outOfRange', true, station.id]);
    // both trucks out after the decision, with nothing to re-decide it before the day's settle point (as when the
    // second round of a day's dispatch passes takes the unit, or tomorrow's search budget is gone)
    const out = (em as unknown as { out: Map<number, number> }).out;
    out.set(station.id, 2);
    sim.runDays(1);
    expect(fire.manualPossible).toBe(true);
    expect(fire.prompted).toBeFalsy();
    // the truck is free again: the prompt holds at the next settle point and counts
    out.delete(station.id);
    sim.runDays(1);
    expect(fire.prompted).toBe(true);
  });

  it('a prompt that is answerable at the day\'s settle point counts: ignored when nobody answers and it fails', () => {
    const { st, sim, em } = town();
    const home = place(st, 't_r2', 40, 21, { pop: 60 });
    triggerDisaster(sim, 'fire', home.x, home.z);
    const fire = em.incidents()[0];
    expect(fire.manualPossible).toBe(true);
    expect(fire.prompted).toBeFalsy();
    sim.runDays(1);
    expect(fire.prompted).toBe(true);
    sim.runDays(8);
    expect(em.incident(fire.id)).toBeUndefined();
    expect(st.stats.emergency.month.failed).toBe(1);
    expect(st.stats.emergency.month.ignored).toBe(1);
  });
});
