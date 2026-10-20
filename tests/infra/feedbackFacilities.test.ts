/**
 * Final fixes, lane sim-feedback — facility feedback that says what is true:
 *  - P5 / routed 10: the staffing hint blames the road only when the road reaches no homes or the facility fills far
 *    below the city's employers of its size; a labour-short city is the reason for every employer; a new facility is
 *    "still hiring";
 *  - P8 / routed 11: a staffed service without road access does not work at all (op 0, quality factor "no road access",
 *    a placement warning that says so); the Staff line shows the posted jobs;
 *  - P13 / routed 9: an under-used hospital says why (its area's patients are seated by clinics first);
 *  - P3: the def facts quote what one typically costs in this city and the most it can cost (final fixes SF-3, lead
 *    decision 20b: "typical in this city", not "now");
 *  - round 2: SF-3 the inspector's upkeep is its share of the running costs (bulldozing it saves less); SF-4 a staffed
 *    service without road access serves nobody, and its load line says so; SF-9a a big employer without peers of its
 *    size is compared with the city's fill, not told to fix its road.
 *  - round 3: the build-card upkeep fact says "per resident patrolled" (a unit with its own participle takes no
 *    "served"); a station without a road beside it says its units can't leave (no auto-dispatch range) and its Staff
 *    line names the road as the reason, power only as the next step.
 *  - round 4: a roadless, unpowered service leads with the missing road (the inspector's headline is the first warning:
 *    it read a false "No power — works at 30%" for a clinic that serves nobody) and its power / water warnings quote no
 *    share of its work ("No power either — …").
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import type { ServicesSystem } from '../../src/sim/systems/infra';
import { facilityDefFacts, facilityOpFactor, facilityQuality, facilityReport, fullUseUpkeep } from '../../src/sim/infra/facilities';
import { justiceData } from '../../src/sim/infra/justice';
import { facilityLoad } from '../../src/sim/infra/catchments';
import { noRoadWarning } from '../../src/sim/actions';
import { expectedUpkeep } from '../../src/sim/economy/opex';
import { getDef } from '../../src/sim/catalog';
import { mainProblem } from '../../src/ui/inspectorModel';
import { newSim, newState, place, roadLine } from './cityGen';

const staffHintOf = (sim: ReturnType<typeof newSim>, id: number) => facilityReport(sim, id)!.lines.find((l) => l.key === 'staff');

/** a road with homes along it and a staffed school on it (hire known, age 100 days) */
function town(opts: { homes?: boolean; cityFill?: number; schoolJobs?: number; age?: number } = {}) {
  const st = newState(64);
  roadLine(st, 2, 20, 60, 20, Network.Road);
  if (opts.homes !== false) for (let x = 30; x < 50; x++) { st.zone[st.idx(x, 21)] = Zone.ResLow; place(st, 't_r1', x, 21, { pop: 10 }); }
  const school = place(st, 'civ_elementary_school', 5, 21, { flags: BF.Plopped | BF.Powered | BF.Watered, age: opts.age ?? 100 });
  const sim = newSim(st);
  school.hire = 1;
  school.capacity = 40;
  school.jobs = opts.schoolJobs ?? 8;
  school.age = opts.age ?? 100;
  st.stats.workforce = 500;
  justiceData(st).cityFill = opts.cityFill ?? 0.9;
  return { st, sim, school };
}

describe('P5 / routed 10: staffing hints', () => {
  it('a labour-short city: every under-staffed employer hears that the city has too few workers', () => {
    const { sim, school } = town({ cityFill: 0.3, schoolJobs: 6 });
    expect(staffHintOf(sim, school.id)?.hint).toMatch(/^The city has too few workers \(all employers 30% staffed\) — zone more homes/);
  });
  it('a facility in its first month is still hiring', () => {
    const { sim, school } = town({ age: 10 });
    expect(staffHintOf(sim, school.id)?.hint).toMatch(/^Still hiring/);
  });
  it('the road is blamed when it reaches no homes', () => {
    const { sim, school } = town({ homes: false });
    expect(staffHintOf(sim, school.id)?.hint).toMatch(/its road doesn't connect to any homes/);
  });
  it('connected to homes and filling like other employers of its size: not a road problem', () => {
    const { st, sim, school } = town({ schoolJobs: 8 });
    // three shops of a similar size, as (un)filled as the school
    for (let k = 0; k < 3; k++) place(st, 't_cs', 52 + k, 21, { capacity: 40, jobs: 9, hire: 1, flags: BF.Powered | BF.Watered });
    const hint = staffHintOf(sim, school.id)?.hint ?? '';
    expect(hint).toMatch(/^Big employers fill last/);
    expect(hint).not.toMatch(/road/);
    // ... while far below them, a better road link is the advice
    for (const b of st.buildings.values()) if (b.def === 't_cs') b.jobs = 38;
    sim.advanceDay(); // (the peer fill is memoised per day)
    school.jobs = 8;
    expect(staffHintOf(sim, school.id)?.hint).toMatch(/road link/);
  });
});

describe('P8 / routed 11: no road, no staff', () => {
  it('a staffed school without road access does not work, and says so; the Staff line shows the posted jobs', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    for (let x = 30; x < 50; x++) place(st, 't_r1', x, 21, { pop: 10 });
    const school = place(st, 'civ_elementary_school', 10, 40, { flags: BF.Plopped | BF.Powered | BF.Watered, age: 100 });
    const sim = newSim(st);
    school.hire = 1; school.capacity = 40; school.jobs = 0;
    st.stats.workforce = 500;
    justiceData(st).cityFill = 0.9;
    expect(facilityOpFactor(st, school)).toBe(0);
    const q = facilityQuality(st, school);
    expect(q.total).toBe(0);
    expect(q.factors.map((f) => f.label)).toContain('no road access');
    sim.getSystem<ServicesSystem>('services')!.compute(sim, false);
    expect(facilityLoad(sim, school.id)?.operating ?? 0).toBe(0);
    const rep = facilityReport(sim, school.id)!;
    expect(rep.warnings).toContain('No road access — build a road beside it');
    expect(rep.lines.find((l) => l.key === 'staff')!.value).toMatch(/^0 \/ 40/);
    expect(noRoadWarning(getDef('civ_elementary_school')!)).toBe("Warning: no road access — staff can't reach it, so it won't work until a road touches it");
    expect(noRoadWarning(getDef('park_small') ?? { category: 'park' })).toBe('Warning: no road access');
  });
  it('an unpowered school: the Staff line still shows the posted jobs, and says it hires fewer without power', () => {
    const { sim, school } = town({ schoolJobs: 8 });
    school.flags &= ~BF.Powered;
    school.hire = 0.25;
    const line = staffHintOf(sim, school.id)!;
    expect(line.value).toMatch(/^8 \/ 40/);
    expect(line.hint ?? '').toMatch(/Without power it hires only 10 of them/);
  });
});

describe('P13 / routed 9: an under-used hospital says why', () => {
  it('clinics seat its area first: "Beds 21 / 200" with thousands in reach names the clinics', () => {
    const st = newState(64);
    for (let z = 4; z < 60; z += 4) roadLine(st, 2, z, 61, z, Network.Road);
    roadLine(st, 2, 4, 2, 56, Network.Road);
    roadLine(st, 61, 4, 61, 56, Network.Road);
    for (let z = 5; z < 57; z += 4) for (let x = 4; x < 60; x++) {
      if (st.network[st.idx(x, z)] !== 0 || st.building[st.idx(x, z)] >= 0) continue;
      st.zone[st.idx(x, z)] = Zone.ResMed;
      place(st, 't_r2', x, z, { pop: 50, flags: BF.Powered | BF.Watered });
    }
    // two clinics first (older ids: they seat first), then the hospital
    for (const x of [14, 44]) place(st, 'civ_clinic', x, 30, { flags: BF.Plopped | BF.Powered | BF.Watered, age: 400 });
    const hospital = place(st, 'civ_hospital', 28, 30, { flags: BF.Plopped | BF.Powered | BF.Watered, age: 400 });
    const sim = newSim(st);
    sim.getSystem<ServicesSystem>('services')!.compute(sim, false);
    const L = facilityLoad(sim, hospital.id)!;
    const rep = facilityReport(sim, hospital.id)!;
    const reach = rep.lines.find((l) => l.key === 'reach');
    console.log(`hospital: utilisation ${(L.utilization * 100).toFixed(1)}% demand ${L.demand.toFixed(0)} seated ${L.seated.toFixed(0)} · ${reach?.value} — ${reach?.hint}`);
    expect(L.utilization).toBeLessThan(0.15);
    expect(reach?.value).toBe('its area is mostly served by others');
    expect(reach?.hint).toMatch(/already get care at clinics nearby — a hospital takes the patients they cannot seat/);
  });
});

describe('P3 / SF-3: def facts quote this city\'s typical cost and the full-use cost', () => {
  it('city-aware estimate + "up to" at full use (the same numbers the build menu and plop tool show)', () => {
    const def = getDef('civ_elementary_school')!;
    expect(fullUseUpkeep(def)).toBeCloseTo(240 * 0.3 + 1500 * 0.6, 6);
    const plain = facilityDefFacts('civ_elementary_school').find((f) => f.key === 'upkeep')!;
    expect(plain.hint).toBe('up to §972 at full use a month');
    const st = newState(32);
    st.stats.needs.elementary = { need: 300, served: 100, capacity: 0, unreached: 200, overcrowded: 0 };
    const now = expectedUpkeep(st, def);
    const city = facilityDefFacts('civ_elementary_school', st).find((f) => f.key === 'upkeep')!;
    // (final fixes SF-3, lead decision 20b: the city-wide figure says it is typical for the city, not "now")
    expect(city.hint).toBe(`≈§${Math.round(now).toLocaleString('en-US')}/mo typical in this city · up to §972 at full use`);
    expect(now).toBeLessThan(fullUseUpkeep(def));
  });
});

describe('final fixes round 2 (SF-3 / SF-4 / SF-9): facility lines that send the player to the right fix', () => {
  /** a dense grid of homes with two clinics placed first (they seat their area) — the P13 town */
  function clinicGrid() {
    const st = newState(64);
    for (let z = 4; z < 60; z += 4) roadLine(st, 2, z, 61, z, Network.Road);
    roadLine(st, 2, 4, 2, 56, Network.Road);
    roadLine(st, 61, 4, 61, 56, Network.Road);
    const clinics = [14, 44].map((x) => place(st, 'civ_clinic', x, 30, { flags: BF.Plopped | BF.Powered | BF.Watered, age: 400 }));
    for (let z = 5; z < 57; z += 4) for (let x = 4; x < 60; x++) {
      if (st.network[st.idx(x, z)] !== 0 || st.building[st.idx(x, z)] >= 0) continue;
      st.zone[st.idx(x, z)] = Zone.ResMed;
      place(st, 't_r2', x, z, { pop: 50, flags: BF.Powered | BF.Watered });
    }
    return { st, clinics };
  }

  it('SF-3: the inspector\'s upkeep is its share of the running costs, and says bulldozing it saves less', () => {
    const { st, clinics } = clinicGrid();
    const sim = newSim(st);
    sim.getSystem<ServicesSystem>('services')!.compute(sim, false);
    const up = facilityReport(sim, clinics[0].id)!.lines.find((l) => l.key === 'upkeep')!;
    // (the value keeps the "§X / month" form: the inspector header parses it)
    expect(up.value).toMatch(/^§[\d,]+ \/ month$/);
    expect(up.hint).toMatch(/^Its share of the city's running costs: the building §[\d,]+ \+ §[\d,]+ for the people it serves \(§[\d.]+ a month for each of the city's [\d,]+ patients\); bulldozing it saves less when nearby facilities take over its users$/);
  });

  it('SF-4: a staffed clinic without road access serves nobody — its load line says so and shows 0 seated', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    // a clinic one row behind the homes on the road: next to them, but no road touches it
    const clinic = place(st, 'civ_clinic', 38, 22, { flags: BF.Plopped | BF.Powered | BF.Watered, age: 100 });
    for (let x = 4; x < 60; x++) { st.zone[st.idx(x, 21)] = Zone.ResMed; place(st, 't_r2', x, 21, { pop: 50, flags: BF.Powered | BF.Watered }); }
    const sim = newSim(st);
    clinic.hire = 1; clinic.jobs = 0;
    st.stats.workforce = 2000;
    justiceData(st).cityFill = 0.9;
    expect(facilityOpFactor(st, clinic)).toBe(0);
    // (before any services pass has assessed it, too: it serves nobody either way)
    const before = facilityReport(sim, clinic.id)!.lines.find((l) => l.key === 'seats')!;
    expect([before.value, before.hint]).toEqual(['0 / 8,000 (0%)', "Serves nobody — no road access (staff can't reach it)"]);
    sim.getSystem<ServicesSystem>('services')!.compute(sim, false);
    const L = facilityLoad(sim, clinic.id)!;
    console.log(`roadless clinic: services load seated ${L.seated.toFixed(0)} demand ${L.demand.toFixed(0)} operating ${L.operating}`);
    const rep = facilityReport(sim, clinic.id)!;
    const seats = rep.lines.find((l) => l.key === 'seats')!;
    expect(seats.label).toBe('Patients');
    expect(seats.value).toBe('0 / 8,000 (0%)');
    expect(seats.status).toBe('bad');
    expect(seats.hint).toBe("Serves nobody — no road access (staff can't reach it)");
    expect(rep.lines.some((l) => l.key === 'demand')).toBe(false);
    expect(rep.warnings).toContain('No road access — build a road beside it');
    // a clinic on the road works as before: its real load
    const ok = place(st, 'civ_clinic', 20, 18, { flags: BF.Plopped | BF.Powered | BF.Watered, age: 100 });
    ok.hire = 1; ok.jobs = 30;
    sim.getSystem<ServicesSystem>('services')!.compute(sim, false);
    expect(facilityReport(sim, ok.id)!.lines.find((l) => l.key === 'seats')!.hint ?? '').not.toMatch(/Serves nobody/);
  });

  it('SF-9a: a hospital with no employers of its size to compare with and a road to homes is not told to fix its road', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    for (let x = 30; x < 50; x++) { st.zone[st.idx(x, 21)] = Zone.ResLow; place(st, 't_r1', x, 21, { pop: 10 }); }
    const hospital = place(st, 'civ_hospital', 5, 21, { flags: BF.Plopped | BF.Powered | BF.Watered, age: 300 });
    const sim = newSim(st);
    hospital.hire = 1; hospital.capacity = 250; hospital.jobs = 102;
    st.stats.workforce = 5000;
    justiceData(st).cityFill = 0.5;
    const line = facilityReport(sim, hospital.id)!.lines.find((l) => l.key === 'staff')!;
    expect(line.value).toMatch(/^102 \/ 250/);
    expect(line.hint).toBe("Big employers fill last: the city's employers are 50% staffed — more homes nearby help");
    expect(line.hint).not.toMatch(/road/);
  });
});

describe('final fixes round 3: no "patrolled served"; a station without a road says its units cannot leave', () => {
  it('the upkeep fact: "per resident patrolled" / "per resident protected", "per pupil served"', () => {
    const v = (id: string) => facilityDefFacts(id).find((f) => f.key === 'upkeep')!.value;
    expect(v('civ_police_station')).toMatch(/^§[\d,]+ \/ month \+ §0\.\d+ per resident patrolled$/);
    expect(v('civ_fire_station')).toMatch(/^§[\d,]+ \/ month \+ §0\.\d+ per resident protected$/);
    expect(v('civ_elementary_school')).toMatch(/^§[\d,]+ \/ month \+ §0\.\d+ per pupil served$/);
    expect(v('park_playground')).toMatch(/per young visitor served$/);
    expect(v('civ_clinic')).toMatch(/per patient served$/);
  });

  it("a clinic without a road beside it: its ambulance can't leave, no auto-dispatch range, the Staff line blames the road", () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    for (let x = 30; x < 50; x++) place(st, 't_r1', x, 21, { pop: 10 });
    const clinic = place(st, 'civ_clinic', 10, 40, { flags: BF.Plopped, age: 100 });
    const sim = newSim(st);
    sim.runDays(2);
    // (no power either: the population system hires a quarter of its 30 jobs)
    clinic.hire = 0.25; clinic.capacity = 30; clinic.jobs = 0;
    st.stats.workforce = 500;
    justiceData(st).cityFill = 0.9;
    const rep = facilityReport(sim, clinic.id)!;
    expect(rep.lines.find((l) => l.key === 'fleet')).toMatchObject({ label: 'Ambulances', value: "1 — can't leave: no road beside it", status: 'bad' });
    expect(rep.lines.find((l) => l.key === 'fleet')!.hint).toBe("Build a road beside it: its ambulance can't drive out to a call");
    expect(rep.lines.some((l) => l.key === 'range')).toBe(false);
    expect(rep.lines.find((l) => l.key === 'staff')!.hint).toBe("No road access — its staff can't get to work: build a road beside it. It also needs power: without it, it hires only 8 of them");
    expect(rep.lines.find((l) => l.key === 'seats')!.hint).toBe("Serves nobody — no road access (staff can't reach it)");
    // a road beside it: the fleet line and the auto-dispatch range are back, the Staff line as before
    roadLine(st, 9, 39, 12, 39, Network.Road);
    sim.events.emit('networkChanged', { x0: 9, z0: 39, x1: 13, z1: 40 });
    const rep2 = facilityReport(sim, clinic.id)!;
    expect(rep2.lines.find((l) => l.key === 'fleet')!.value).toBe('1 (0 out)');
    expect(rep2.lines.find((l) => l.key === 'range')!.value).toMatch(/^\d+\.\d min by road$/);
    expect(rep2.lines.find((l) => l.key === 'staff')!.hint ?? '').not.toMatch(/^No road access/);
  });

  it('a fire station without a road: "2 — can\'t leave" (its fire trucks)', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    const fs = place(st, 'civ_fire_station', 10, 40, { flags: BF.Plopped | BF.Powered | BF.Watered, age: 100 });
    const sim = newSim(st);
    sim.runDays(2);
    const fleet = facilityReport(sim, fs.id)!.lines.find((l) => l.key === 'fleet')!;
    expect([fleet.label, fleet.value, fleet.status, fleet.hint]).toEqual(['Fire trucks', "2 — can't leave: no road beside it", 'bad', "Build a road beside it: its fire trucks can't drive out to a call"]);
  });
});

describe('final fixes round 4: a roadless service leads with its road, not a false "works at 30%"', () => {
  it('a roadless, unpowered, dry clinic: "No road access" first (the inspector headline), then power and water "either"', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    for (let x = 30; x < 50; x++) { st.zone[st.idx(x, 21)] = Zone.ResMed; place(st, 't_r2', x, 21, { pop: 50, flags: BF.Powered | BF.Watered }); }
    const clinic = place(st, 'civ_clinic', 10, 40, { flags: BF.Plopped, age: 100 });
    const sim = newSim(st);
    sim.runDays(2);
    // (no power: the population system hires a quarter of its 30 jobs; nobody reaches it)
    clinic.hire = 0.25; clinic.capacity = 30; clinic.jobs = 0;
    st.stats.workforce = 500;
    justiceData(st).cityFill = 0.9;
    sim.getSystem<ServicesSystem>('services')!.compute(sim, false);
    expect(facilityOpFactor(st, clinic)).toBe(0);
    const rep = facilityReport(sim, clinic.id)!;
    expect(rep.warnings).toEqual([
      'No road access — build a road beside it',
      'No power either — connect it to a power line or powered road',
      'No water either — connect it to a water network',
    ]);
    expect(mainProblem({ warnings: rep.warnings })).toEqual({ text: 'No road access', hint: 'build a road beside it', tone: 'bad' });
    expect(rep.lines.find((l) => l.key === 'seats')!.hint).toBe("Serves nobody — no road access (staff can't reach it)");
    // a road beside it: it works again, at the unpowered share — the power warning quotes it and leads
    roadLine(st, 9, 39, 12, 39, Network.Road);
    sim.events.emit('networkChanged', { x0: 9, z0: 39, x1: 13, z1: 40 });
    clinic.jobs = 7;
    expect(facilityOpFactor(st, clinic)).toBeGreaterThan(0);
    const rep2 = facilityReport(sim, clinic.id)!;
    expect(rep2.warnings[0]).toBe('No power — works at 30%; connect it to a power line or powered road');
    expect(rep2.warnings).not.toContain('No road access — build a road beside it');
    expect(rep2.warnings.some((w) => /^No water — treatment at \d+%/.test(w))).toBe(true);
  });
});
