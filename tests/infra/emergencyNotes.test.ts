/**
 * Final fixes r3 (playtest, newplayer #8, factors #2): the emergency notes count right. A single-unit station read "All 1
 * ambulance of Medical Clinic #15 are busy" (the dispatch refusal and the busy note of a site in its reach), and a site
 * beyond every station's reach read "All ambulances are busy (Medical Clinic #1 and others)" in a city with one clinic.
 * Now one unit is "the only ambulance … is busy" (allBusyNote's singular form), and "and others" needs other stations:
 * one station is named with its units, two by name, three or more as "… and N others". The plural texts the EM-1 tests
 * pin stay as they were.
 * Final fixes r4 (playtest polish 9 + 11): two units are "both" — "Both fire trucks of Fire Station #1 are busy", "both
 * fire trucks (that can reach it) are busy", "Both ambulances are busy (Medical Clinic #1 and Medical Clinic #2)" — not
 * "All 2 …"; three or more stay "All N …". The only unit that can reach a site comes back as "it", not "one". The
 * "uncovered" news no longer sends the player to the Dispatch tool, which is not on the toolbar: it points at the
 * incident's alert ("Send nearest, or Choose station…").
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { Building, CityState } from '../../src/sim/CityState';
import type { Simulation } from '../../src/sim/Simulation';
import { emergencyOf, type EmergencySystem } from '../../src/sim/infra/emergency';
import { getFire, triggerDisaster } from '../../src/sim/systems/infra';
import { newSim, newState, place, roadLine } from './cityGen';

/** a road along z = 20 (x 2..size-3); stations placed on its north side at the given x (catalog defs: real names) */
function town(stations: { def: string; x: number }[], size = 160): { st: CityState; sim: Simulation; em: EmergencySystem; at: Building[] } {
  const st = newState(size);
  roadLine(st, 2, 20, size - 3, 20, Network.Road);
  const at = stations.map((s) => place(st, s.def, s.x, 18));
  const sim = newSim(st);
  getFire(sim)!.riskBoost = 0; // no random ignitions
  return { st, sim, em: emergencyOf(sim)!, at };
}
/** a spill at a factory next to the road at x (one fire truck, in the reach of a station a few cells away) */
const spillAt = (t: ReturnType<typeof town>, x: number) => {
  const f = place(t.st, 't_id', x, 21, { jobs: 40 });
  return t.em.incident(t.em.spawn(t.sim, 'spill', f.x, f.z, { buildingId: f.id }))!;
};

describe('r3: a single unit is "the only one"', () => {
  it('a clinic with its one ambulance out: the busy note and the dispatch refusal say "the only ambulance … is busy"', () => {
    const t = town([{ def: 'civ_clinic', x: 4 }]);
    const [clinic] = t.at;
    const h1 = place(t.st, 't_r2', 8, 21, { pop: 60 }), h2 = place(t.st, 't_r2', 12, 21, { pop: 60 });
    const a = t.em.incident(t.em.spawn(t.sim, 'medical', h1.x, h1.z, { buildingId: h1.id, major: true, severity: 3 }))!;
    expect(a.state).toBe('dispatched');
    expect(t.em.stationFleet(clinic.id)).toMatchObject({ total: 1, free: 0 });
    const b = t.em.incident(t.em.spawn(t.sim, 'medical', h2.x, h2.z, { buildingId: h2.id, major: true, severity: 3 }))!;
    expect([b.state, b.reason]).toEqual(['uncovered', 'busy']);
    expect(b.note).toBe('The only ambulance of Medical Clinic #1 is busy — it is sent as soon as it is back');
    const r = t.em.dispatch(t.sim, b.id, clinic.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('The only ambulance of Medical Clinic #1 is busy');
  });

  it('a station with 2 trucks: "Both fire trucks of Fire Station #1 are busy" (final fixes r4: "All 2 fire trucks")', () => {
    const t = town([{ def: 'civ_fire_station', x: 4 }]);
    spillAt(t, 8);
    spillAt(t, 12);
    const home = place(t.st, 't_r2', 16, 21, { pop: 60 });
    triggerDisaster(t.sim, 'fire', home.x, home.z);
    const fire = t.em.incidents().find((i) => i.kind === 'fire')!;
    expect(fire.note).toBe('Both fire trucks of Fire Station #1 are busy — one is sent as soon as one is back');
    expect(t.em.dispatch(t.sim, fire.id, t.at[0].id).reason).toBe('Both fire trucks of Fire Station #1 are busy');
  });
});

describe('r3: beyond every station\'s reach with every unit busy: "and others" only with other stations', () => {
  /** stations every 40 cells from x = 4, both trucks of each out at spills next to it, a fire at x far beyond them all */
  function farFire(n: number, x: number): string {
    const t = town(Array.from({ length: n }, (_, k) => ({ def: 'civ_fire_station', x: 4 + 40 * k })));
    for (let k = 0; k < n; k++) { spillAt(t, 8 + 40 * k); spillAt(t, 12 + 40 * k); }
    for (const s of t.at) expect(t.em.stationFleet(s.id)!.free).toBe(0);
    const home = place(t.st, 't_r2', x, 21, { pop: 60 });
    triggerDisaster(t.sim, 'fire', home.x, home.z);
    const fire = t.em.incidents().find((i) => i.kind === 'fire')!;
    expect([fire.state, fire.reason, fire.manualPossible, !!fire.canSend]).toEqual(['uncovered', 'busy', false, false]);
    return fire.note;
  }
  it('one fire station: named with its trucks, no "and others"', () => {
    expect(farFire(1, 80)).toBe('Both fire trucks of Fire Station #1 are busy — you can send one once one is back');
  });
  it('two stations: both named', () => {
    expect(farFire(2, 130)).toBe('All 4 fire trucks are busy (Fire Station #1 and Fire Station #2) — you can send one once one is back');
  });
  it('three stations: "… and 2 others"', () => {
    expect(farFire(3, 150)).toBe('All 6 fire trucks are busy (Fire Station #1 and 2 others) — you can send one once one is back');
  });
});

describe('r4: two units are "both", the only one comes back as "it"', () => {
  /** a medical call at a home next to the road at x (major: it is announced; 3 injured) */
  const call = (t: ReturnType<typeof town>, x: number) => {
    const h = place(t.st, 't_r2', x, 21, { pop: 60 });
    return t.em.incident(t.em.spawn(t.sim, 'medical', h.x, h.z, { buildingId: h.id, major: true, severity: 3 }))!;
  };

  it('two clinics with their one ambulance each out, a call beyond both: "Both ambulances are busy (… and …)"', () => {
    const t = town([{ def: 'civ_clinic', x: 4 }, { def: 'civ_clinic', x: 44 }]);
    expect([call(t, 8).state, call(t, 48).state]).toEqual(['dispatched', 'dispatched']);
    const m = call(t, 140);
    expect([m.state, m.reason, m.manualPossible, !!m.canSend]).toEqual(['uncovered', 'busy', false, false]);
    expect(m.note).toBe('Both ambulances are busy (Medical Clinic #1 and Medical Clinic #2) — you can send one once one is back');
  });

  it('a prompt outside coverage whose only ambulance an in-range call takes: "the only ambulance is busy — you can send it once it is back"', () => {
    const t = town([{ def: 'civ_clinic', x: 4 }]);
    const far = call(t, 40);
    expect([far.state, far.reason, far.manualPossible]).toEqual(['uncovered', 'outOfRange', true]);
    expect(call(t, 8).state).toBe('dispatched');
    expect([far.state, far.manualPossible, !!far.canSend]).toEqual(['uncovered', false, false]);
    expect(far.note).toBe('Outside medical coverage and the only ambulance is busy — you can send it once it is back');
  });
});

describe('r4: the "uncovered" news points at the alert, not at the Dispatch tool (not on the toolbar)', () => {
  /** a fire at a home x cells along the street from a fire station at x = 4 (beyond its reach from 50) */
  function fireAt(x: number) {
    const t = town([{ def: 'civ_fire_station', x: 4 }]);
    const home = place(t.st, 't_r2', x, 21, { pop: 60 });
    triggerDisaster(t.sim, 'fire', home.x, home.z);
    const fire = t.em.incidents().find((i) => i.kind === 'fire')!;
    expect([fire.state, fire.reason, fire.major]).toEqual(['uncovered', 'outOfRange', true]);
    t.sim.runDays(1); // the news goes out at the day's settle point
    return { fire, news: t.st.news.filter((n) => n.text.startsWith('Fire at')) };
  }

  it('a free truck can still make it: "… Send help from its alert: Send nearest, or Choose station…"', () => {
    const { fire, news } = fireAt(50);
    expect(news.map((n) => n.text)).toEqual([`Fire at ${fire.place} — Outside fire coverage — nearest free fire truck: Fire Station #1. Send help from its alert: Send nearest, or Choose station…`]);
    expect(news[0].text).not.toMatch(/Dispatch tool/);
  });

  it('nobody can make it in time any more: the news only says why (no call to send help)', () => {
    const { fire, news } = fireAt(60);
    expect(fire.manualPossible).toBe(false);
    expect(news.map((n) => n.text)).toEqual([`Fire at ${fire.place} — Outside fire coverage — nearest free fire truck: Fire Station #1 (too far to make it in time).`]);
  });
});
