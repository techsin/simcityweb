/**
 * Final fixes round 2, lane sim-feedback, SF-2 (silent ruins), the disasters part: a tornado used to end in silence
 * ("Tornado sighted! Take cover!" was the only news) while it flattened the Water Treatment Plant, a school and later the
 * player's only Fire Station. Now it counts what it destroys (persisted with the disaster under way, no random draws)
 * and posts ONE summary when it ends — how many buildings, the city facilities among them, the fix — at the worst spot;
 * the earthquake and meteor summaries name the city facilities they destroy too. The tornado's path and damage are the
 * ones of the code before (the same random draws in the same order: pinned below).
 */
import { describe, expect, it } from 'vitest';
import { BF, type CityState } from '../../src/sim/CityState';
import { Network } from '../../src/core/types';
import type { Simulation } from '../../src/sim/Simulation';
import { activeDisasters, triggerDisaster } from '../../src/sim/systems/infra';
import { facilityListText } from '../../src/sim/infra/disasters';
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
