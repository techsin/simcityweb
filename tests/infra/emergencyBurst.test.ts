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
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { CityState, Building } from '../../src/sim/CityState';
import type { EmergencyEvent, Simulation } from '../../src/sim/Simulation';
import { INCIDENT_RESPONDERS, emergencyOf, type EmergencySystem } from '../../src/sim/infra/emergency';
import { getFire, triggerDisaster } from '../../src/sim/systems/infra';
import { newSim, newState, place, roadLine } from './cityGen';
import { SimBot, botSystems } from '../../tools/simbot';

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
      expect(f.note).toBe('Outside fire coverage and all 2 fire trucks are busy — send one when one is back');
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

describe('EM-1: an earthquake in a bot town with an attentive player (verify-factors r2 vf_burst2 setup)', () => {
  it('magnitude 7 in a 3-station town: every prompt the player sees can be dispatched, nothing scores as ignored', { timeout: 900000 }, async () => {
    const bot = new SimBot({ size: 128, years: 2, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: true, noInfra: false }, await botSystems(false));
    bot.run(2);
    bot.sim.advanceDay();
    bot.sim.advanceDay();
    const sim = bot.sim, st = bot.st;
    const em = emergencyOf(sim)!;
    const fireStations = [...st.buildings.values()].filter((b) => b.def.startsWith('civ_fire'));
    expect(fireStations.length).toBeGreaterThanOrEqual(3);
    let sx = 0, sz = 0, n = 0;
    for (const b of st.buildings.values()) if (b.pop + b.jobs > 0) { sx += b.x; sz += b.z; n++; }
    const y0 = { ...st.stats.emergency.year };
    const failed: number[] = [];
    sim.events.on('emergency', (e) => { if (e.type === 'failed') failed.push(e.id); });
    (sim.getSystem('disasters') as unknown as { earthquake(s: Simulation, x: number, z: number, mag: number): void }).earthquake(sim, Math.round(sx / n), Math.round(sz / n), 7);
    expect(em.incidents().length).toBeGreaterThan(10);
    /** waiting major prompts with no free unit of their primary responder among the dispatch options */
    const stale = () => em.incidents().filter((i) => (i.state === 'uncovered' || i.state === 'queued') && i.major && i.manualPossible
      && !em.dispatchOptions(sim, i.id).some((o) => o.free > 0 && Number.isFinite(o.etaMin) && o.responder === INCIDENT_RESPONDERS[i.kind][0]));
    expect(stale()).toEqual([]);
    expect(st.stats.emergency.manualActive).toBe(em.incidents().filter((i) => i.state === 'uncovered' && i.major && i.manualPossible).length);
    // the attentive player: every waiting major prompt, at once and then every day
    let tries = 0, fails = 0;
    const attempt = () => {
      for (const i of em.incidents()) {
        if (!(i.state === 'uncovered' || i.state === 'queued') || !i.major || !i.manualPossible) continue;
        tries++;
        if (!em.dispatchBest(sim, i.id).ok) fails++;
      }
      expect(stale()).toEqual([]);
    };
    attempt();
    for (let d = 1; d <= 40; d++) {
      sim.advanceDay();
      attempt();
    }
    const y = st.stats.emergency.year;
    console.log(`EM-1 quake: ${em.incidents().length} still active, ${failed.length} failed, ${tries} prompts tried, ${fails} failed attempts, ignored ${(y.ignored ?? 0) - (y0.ignored ?? 0)}`);
    expect(fails).toBe(0);
    expect((y.ignored ?? 0) - (y0.ignored ?? 0)).toBe(0);
  });
});

describe('EM-1: normal play keeps its prompts', () => {
  it('a bot town over 4 years (no disasters, nobody answers): the prompts counted at settle points are the prompts raised', { timeout: 900000 }, async () => {
    const bot = new SimBot({ size: 128, years: 4, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0.2, quiet: true, noInfra: false, neglect: true }, await botSystems(false));
    const sim = bot.sim;
    // raised: an 'uncovered' event of a major incident with manualPossible (the old rule set prompted right then)
    const raised = new Set<number>(), counted = new Set<number>();
    sim.events.on('emergency', (e) => { if (e.type === 'uncovered' && e.major && e.manualPossible) raised.add(e.id); });
    sim.events.on('day', () => { for (const i of emergencyOf(sim)!.incidents()) if (i.prompted) counted.add(i.id); });
    bot.run(4);
    const y = bot.st.stats.emergency.year;
    console.log(`EM-1 normal play: ${raised.size} prompts raised, ${counted.size} counted, ignored (12 months) ${y.ignored ?? 0}`);
    expect(raised.size).toBeGreaterThanOrEqual(2);
    for (const id of counted) expect(raised.has(id)).toBe(true);
    // without a disaster's burst a prompt loses its unit before the day ends at most rarely (a unit coming back the
    // same day, or another incident taking it): normal play is unaffected
    expect(raised.size - counted.size).toBeLessThanOrEqual(1);
  });
});
