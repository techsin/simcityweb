/**
 * Final fixes round 2, lane sim-feedback, SF-2 (silent ruins), the disasters part: a tornado used to end in silence
 * ("Tornado sighted! Take cover!" was the only news) while it flattened the Water Treatment Plant, a school and later the
 * player's only Fire Station. Now it counts what it destroys (persisted with the disaster under way, no random draws)
 * and posts ONE summary when it ends — how many buildings, the city facilities among them, the fix — at the worst spot;
 * the earthquake and meteor summaries name the city facilities they destroy too. The tornado's path and damage are the
 * ones of the code before (the same random draws in the same order: pinned below).
 * Final fixes r3 (silent ruins of landmarks, deals, civic buildings, venues and stations): every plopped kind is named,
 * the services first and then the most valuable (a landmark or deal ahead of a playground; the rest "… and N more"
 * buildings); a ruined deal's or venue's report says its income stopped ("none — in ruins", the inspector header showed
 * the catalog income), in cause-neutral words; a unique building's ruin must be bulldozed before it is built again.
 */
import { describe, expect, it } from 'vitest';
import { BF, type CityState } from '../../src/sim/CityState';
import { Network } from '../../src/core/types';
import type { Simulation } from '../../src/sim/Simulation';
import { activeDisasters, triggerDisaster } from '../../src/sim/systems/infra';
import { facilityListText } from '../../src/sim/infra/disasters';
import { facilityReport } from '../../src/sim/infra/facilities';
import { CityActions } from '../../src/sim/actions';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { newSim, newState, place, roadLine } from './cityGen';

const viaClone = (st: CityState) => deserializeCity(structuredClone(serializeCity(st, { copy: true })) as SerializedCity);

/** streets every 3 rows, a Fire Station at (30, 30) placed first, homes on every other free row cell */
function town() {
  const st = newState(64, true);
  for (let z = 5; z < 60; z += 3) roadLine(st, 2, z, 61, z, Network.Street);
  const station = place(st, 'civ_fire_station', 30, 30, { flags: BF.Plopped | BF.Powered | BF.Watered });
  for (let z = 6; z < 60; z += 3) for (let x = 3; x < 61; x++) if (st.building[st.idx(x, z)] < 0) place(st, 't_r1', x, z, { pop: 10 });
  st.stats.population = 5000;
  return { st, station, sim: newSim(st) };
}
const summaries = (st: CityState) => st.news.filter((n) => /^Tornado: |^The tornado has passed/.test(n.text));
const pathOf = (sim: Simulation) => activeDisasters(sim).map((t) => `${t.kind}@${t.x.toFixed(4)},${t.z.toFixed(4)} h${t.heading.toFixed(5)} left ${t.daysLeft.toFixed(3)}`).join('|');
const burntIds = (st: CityState) => [...st.buildings.values()].filter((b) => b.flags & BF.Burnt).map((b) => b.id).sort((a, b) => a - b).join(',');

describe('SF-2: a tornado posts one summary of what it destroyed', () => {
  it('over a Fire Station: one summary naming it, at the ruin; the path and damage are the ones before (pinned)', () => {
    const { st, station, sim } = town();
    expect(triggerDisaster(sim, 'tornado', 31, 31)).toBe(true);
    const path: string[] = [];
    for (let d = 0; d < 6; d++) {
      sim.runDays(1);
      path.push(pathOf(sim));
    }
    // (pinned with the code before SF-2: the same random draws in the same order — same path, same buildings)
    expect(path).toEqual(PINNED.path);
    expect(burntIds(st)).toBe(PINNED.burnt);
    expect((st.systemData.infraDisasters as { rng: number }).rng).toBe(PINNED.rng);
    expect(station.flags & BF.Burnt).toBeTruthy();
    const n = burntIds(st).split(',').length;
    const s = summaries(st);
    expect(s.length).toBe(1);
    expect(s[0].text).toBe(`Tornado: ${n} buildings destroyed, incl. your Fire Station — bulldoze the rubble and rebuild.`);
    expect([s[0].x, s[0].z]).toEqual([station.x + 1, station.z + 1]);
    expect(s[0].kind).toBe('disaster');
    expect(st.news.filter((x) => x.text === 'Tornado sighted! Take cover!').length).toBe(1);
  });

  it('a save on its path keeps the tally: the loaded game posts the same summary', () => {
    const { st, sim } = town();
    expect(triggerDisaster(sim, 'tornado', 31, 31)).toBe(true);
    sim.runDays(1);
    const t = activeDisasters(sim).find((d) => d.kind === 'tornado')!;
    expect(t.destroyed).toBeGreaterThan(0);
    const copy = viaClone(st);
    const sim2 = newSim(copy);
    const t2 = activeDisasters(sim2).find((d) => d.kind === 'tornado')!;
    expect([t2.destroyed, t2.facilities, t2.worst]).toEqual([t.destroyed, t.facilities, t.worst]);
    sim.runDays(5);
    sim2.runDays(5);
    expect(summaries(copy).map((n) => [n.text, n.x, n.z])).toEqual(summaries(st).map((n) => [n.text, n.x, n.z]));
    expect(summaries(st).length).toBe(1);
  });

  it('a tornado over open land says it passed without damage', () => {
    const st = newState(64, true);
    const sim = newSim(st);
    expect(triggerDisaster(sim, 'tornado', 32, 32)).toBe(true);
    sim.runDays(6);
    expect(summaries(st).map((n) => n.text)).toEqual(['The tornado has passed — no buildings were destroyed.']);
  });

  it('a meteor (and a quake) name the city facilities they destroy', () => {
    const { st, station, sim } = town();
    expect(triggerDisaster(sim, 'meteor', 31, 31)).toBe(true);
    expect(st.buildings.has(station.id)).toBe(false); // (in the crater)
    expect(st.news.find((n) => n.text.startsWith('Meteor strike!'))!.text).toMatch(/^Meteor strike! \d+ buildings destroyed, incl\. your Fire Station\.$/);
    const q = town();
    const school = place(q.st, 'civ_elementary_school', 40, 40, { flags: BF.Plopped | BF.Powered | BF.Watered });
    expect(triggerDisaster(q.sim, 'earthquake', 35, 35)).toBe(true);
    const text = q.st.news.find((n) => n.text.startsWith('Earthquake!'))!.text;
    const named: string[] = [];
    if (q.station.flags & BF.Burnt) named.push('civ_fire_station');
    if (school.flags & BF.Burnt) named.push('civ_elementary_school');
    if (named.length) expect(text).toContain(`(incl. ${facilityListText(named)})`);
    else expect(text).not.toMatch(/incl\./);
  });

  it('the facility list reads naturally', () => {
    expect(facilityListText(['civ_fire_station'])).toBe('your Fire Station');
    expect(facilityListText(['civ_fire_station', 'civ_elementary_school'])).toBe('your Fire Station and Elementary School');
    expect(facilityListText(['civ_elementary_school', 'civ_fire_station', 'civ_elementary_school'])).toBe('your 2 Elementary Schools and Fire Station');
    expect(facilityListText(['civ_police_hq', 'civ_police_hq'])).toBe('your 2 Police Headquarters');
    expect(facilityListText(['civ_fire_station', 'civ_police_station', 'civ_clinic', 'civ_elementary_school', 'civ_high_school'])).toBe('your Fire Station, Police Station, Medical Clinic and 2 more');
    // (r3: "N more" counts the buildings left out, not their kinds)
    expect(facilityListText(['civ_fire_station', 'civ_police_station', 'civ_clinic', 'park_playground', 'park_playground', 'tr_bus_stop'])).toBe('your Fire Station, Police Station, Medical Clinic and 3 more');
  });
});

/** streets every 3 rows; both rows between them filled with playgrounds, a Clock Tower every 5th cell (place() does not
 *  check uniqueness: many towers, so any disaster's damage holds both kinds), placed row by row — a playground first */
function venueTown(seed: number) {
  const st = newState(64, true);
  st.config.seed = seed;
  for (let z = 5; z < 60; z += 3) roadLine(st, 2, z, 61, z, Network.Street);
  for (let z = 6; z < 60; z += 3) for (const zz of [z, z + 1]) for (let x = 3; x < 61; x++) {
    if (zz >= 60 || st.building[st.idx(x, zz)] >= 0 || st.network[st.idx(x, zz)] !== 0) continue;
    place(st, x % 5 === 2 ? 'lm_clock_tower' : 'park_playground', x, zz, { flags: BF.Plopped });
  }
  st.stats.population = 5000;
  return { st, sim: newSim(st) };
}
/** the facility list of a summary ("… incl. your 3 Clock Towers and 12 Playgrounds …") */
const inclOf = (text: string) => /incl\. (your [^—).]*)/.exec(text)?.[1] ?? '';

describe('r3: every plopped kind is named, the services first, then the most valuable', () => {
  it('a meteor names a deal and a landmark ahead of a playground (the playground destroyed first)', () => {
    const st = newState(64, true);
    for (let z = 5; z < 60; z += 6) roadLine(st, 2, z, 61, z, Network.Street);
    place(st, 'park_playground', 30, 30, { flags: BF.Plopped });
    place(st, 'lm_clock_tower', 34, 31, { flags: BF.Plopped });
    place(st, 'rw_casino', 35, 27, { flags: BF.Plopped });
    st.stats.population = 5000;
    const sim = newSim(st);
    expect(triggerDisaster(sim, 'meteor', 31, 31)).toBe(true);
    expect(st.news.find((n) => n.text.startsWith('Meteor strike!'))!.text).toMatch(/^Meteor strike! \d+ buildings destroyed, incl\. your Casino Resort, Clock Tower and Playground\.$/);
  });

  it('a quake and a tornado name a landmark ahead of the playgrounds they destroyed (seeds 1-12)', () => {
    let quakes = 0, tornadoes = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const q = venueTown(seed);
      expect(triggerDisaster(q.sim, 'earthquake', 32, 32)).toBe(true);
      const qi = inclOf(q.st.news.find((n) => n.text.startsWith('Earthquake!'))!.text);
      if (/Clock Tower/.test(qi) && /Playground/.test(qi)) {
        quakes++;
        expect(qi, `quake seed ${seed}`).toMatch(/^your (\d+ )?Clock Towers? and \d+ Playgrounds?$|^your (\d+ )?Clock Towers? and Playground$/);
      }
      const t = venueTown(seed);
      expect(triggerDisaster(t.sim, 'tornado', 31, 31)).toBe(true);
      t.sim.runDays(6);
      const s = t.st.news.find((n) => n.text.startsWith('Tornado: '));
      const ti = s ? inclOf(s.text) : '';
      if (/Clock Tower/.test(ti) && /Playground/.test(ti)) {
        tornadoes++;
        expect(ti.indexOf('Clock Tower'), `tornado seed ${seed}: ${ti}`).toBeLessThan(ti.indexOf('Playground'));
        // (the worst spot: the most valuable facility it destroyed — a Clock Tower)
        expect(t.st.buildingAt(s!.x!, s!.z!)?.def).toBe('lm_clock_tower');
      }
    }
    expect(quakes).toBeGreaterThan(0);
    expect(tornadoes).toBeGreaterThan(0);
  });

  it('the services stay first: a Fire Station destroyed last is named ahead of a landmark and a playground', () => {
    const st = newState(64, true);
    for (let z = 5; z < 60; z += 6) roadLine(st, 2, z, 61, z, Network.Street);
    place(st, 'park_playground', 30, 30, { flags: BF.Plopped });
    place(st, 'lm_clock_tower', 34, 31, { flags: BF.Plopped });
    place(st, 'civ_fire_station', 28, 33, { flags: BF.Plopped });
    st.stats.population = 5000;
    const sim = newSim(st);
    expect(triggerDisaster(sim, 'meteor', 31, 31)).toBe(true);
    expect(inclOf(st.news.find((n) => n.text.startsWith('Meteor strike!'))!.text)).toBe('your Fire Station, Clock Tower and Playground');
  });
});

describe('r3: a ruined deal or venue says its income stopped; a unique ruin is bulldozed before it is built again', () => {
  function ruin(defId: string) {
    const st = newState(64);
    st.config.sandbox = true;
    roadLine(st, 2, 20, 60, 20, Network.Road);
    const sim = newSim(st);
    const A = new CityActions(sim);
    expect(A.plop(defId, 10, 21, 0).ok).toBe(true);
    const b = st.buildingAt(10, 21)!;
    sim.runDays(2);
    b.flags |= BF.Burnt;
    sim.events.emit('buildingChanged', b);
    return { st, sim, A, b };
  }

  it('a burnt deal: "Deal income: none — in ruins" (bad), cause-neutral status and warning', () => {
    const { sim, b } = ruin('rw_missile_range');
    const rep = facilityReport(sim, b.id)!;
    expect(rep.warnings).toEqual(['In ruins — bulldoze it and build it again']);
    expect(rep.lines.find((l) => l.key === 'status')).toMatchObject({ value: 'in ruins — no service until rebuilt', status: 'bad' });
    expect(rep.lines.find((l) => l.key === 'income')).toMatchObject({ label: 'Deal income', value: 'none — in ruins', status: 'bad' });
    expect(JSON.stringify(rep)).not.toMatch(/[Bb]urnt/);
  });

  it('a ruined venue: "Income: none — in ruins"; a ruin without income has no income row', () => {
    const v = ruin('lm_ferris_wheel');
    expect(facilityReport(v.sim, v.b.id)!.lines.find((l) => l.key === 'income')).toMatchObject({ label: 'Income', value: 'none — in ruins', status: 'bad' });
    const p = ruin('lm_clock_tower');
    expect(facilityReport(p.sim, p.b.id)!.lines.map((l) => l.key)).toEqual(['status', 'upkeep']);
  });

  it('plopping a second unique building while the first lies in ruins: "bulldoze its ruins first"', () => {
    const { st, A, b } = ruin('rw_missile_range');
    expect(A.plop('rw_missile_range', 30, 30, 0, true).reason).toBe('Only one Missile Test Range allowed — bulldoze its ruins first');
    // (a standing one: the plain rule)
    b.flags &= ~BF.Burnt;
    expect(A.plop('rw_missile_range', 30, 30, 0, true).reason).toBe('Only one Missile Test Range allowed');
    // bulldozed: it can be built again
    expect(A.bulldoze({ x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d }).ok).toBe(true);
    expect(st.buildings.has(b.id)).toBe(false);
    expect(A.plop('rw_missile_range', 30, 30, 0, true).ok).toBe(true);
  });
});

/** the tornado of the first test with the code before SF-2 (recorded by running the same body on the tree before it) */
const PINNED = {
  path: [
    'tornado@22.4253,35.2677 h2.92235 left 3.000',
    'tornado@12.5865,35.1353 h2.78318 left 2.000',
    'tornado@3.5232,38.9612 h2.79533 left 1.000',
    '',
    '',
    '',
  ],
  burnt: '1,543,544,545,546,547,583,584,585,586,595,596,597,598,638,639',
  rng: 2831950729,
};
