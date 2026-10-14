/**
 * Final fixes (save / load drift, routed 42 / 45): a loaded game continues the random streams where the save left them
 * instead of re-seeding — the simulation's own (growth, budget strikes, headlines, plop variants: systemData.simRng) and
 * the disasters' (monthly rolls, tornado paths: systemData.infraDisasters), and the disasters under way (a tornado on its
 * path, a quake's active days) go on after the load. Saves from before load as they did (re-seeded from the seed).
 */
import { describe, expect, it } from 'vitest';
import { RNG } from '../../src/core/rng';
import { BF, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';
import { activeDisasters, triggerDisaster } from '../../src/sim/systems/infra';
import { DisastersSystem } from '../../src/sim/infra/disasters';
import { Network } from '../../src/core/types';
import { newSim, newState, place, roadLine } from '../infra/cityGen';

const viaClone = (st: CityState) => deserializeCity(structuredClone(serializeCity(st, { copy: true })) as SerializedCity);
const viaFile = (st: CityState) => deserializeCity(decodeBundle(encodeBundle(serializeCity(st))) as SerializedCity);

describe('save / load: the random streams continue', () => {
  it('the simulation RNG continues after a load (structured clone and file); an old save re-seeds as before', () => {
    const st = newState(32);
    const sim = new Simulation(st, []);
    for (let k = 0; k < 7; k++) sim.rng.next();
    sim.rng.int(0, 9);
    for (const load of [viaClone, viaFile]) {
      const copy = load(st);
      const sim2 = new Simulation(copy, []);
      const a = new Simulation(viaClone(st), []);
      const want = [a.rng.next(), a.rng.next(), a.rng.next()];
      expect([sim2.rng.next(), sim2.rng.next(), sim2.rng.next()]).toEqual(want);
      // (the live game draws the same three next)
      const live = new RNG(1);
      live.state = sim.rng.state;
      expect([live.next(), live.next(), live.next()]).toEqual(want);
    }
    // an old save (no simRng): the stream starts from the seed, as before
    const old = viaClone(st);
    delete old.systemData.simRng;
    const sim3 = new Simulation(old, []);
    const seeded = new RNG((st.config.seed ^ 0x9e3779b9) >>> 0);
    expect(sim3.rng.next()).toBe(seeded.next());
  });

  it('a tornado on its path and the disasters RNG survive a load: same path, same damage, same next rolls', { timeout: 300000 }, () => {
    const st = newState(64, true);
    roadLine(st, 2, 30, 61, 30, Network.Road);
    for (let x = 4; x <= 60; x += 2) for (const z of [26, 28, 32, 34]) place(st, 't_r1', x, z, { pop: 10, capacity: 12 });
    st.stats.population = 5000;
    const sim = newSim(st);
    expect(triggerDisaster(sim, 'tornado', 30, 30)).toBe(true);
    expect(triggerDisaster(sim, 'earthquake', 12, 20)).toBe(true);
    sim.runDays(1);
    expect(activeDisasters(sim).some((d) => d.kind === 'tornado')).toBe(true);
    const copy = viaClone(st);
    const sim2 = newSim(copy);
    const show = (s: Simulation) => activeDisasters(s).map((d) => `${d.kind}@${d.x.toFixed(3)},${d.z.toFixed(3)} h${d.heading.toFixed(4)} left ${d.daysLeft.toFixed(3)}`).join(' | ');
    expect(show(sim2)).toBe(show(sim));
    const ended: string[][] = [[], []];
    sim.events.on('disaster', (e) => { if (!e.active) ended[0].push(`${e.kind}@${sim.state.day}`); });
    sim2.events.on('disaster', (e) => { if (!e.active) ended[1].push(`${e.kind}@${sim2.state.day}`); });
    const burnt = (s: CityState) => [...s.buildings.values()].filter((b) => b.flags & BF.Burnt).map((b) => b.id).sort((a, b) => a - b).join(',');
    for (let d = 0; d < 4; d++) {
      sim.runDays(1);
      sim2.runDays(1);
      expect(show(sim2), `day ${d + 1}`).toBe(show(sim));
    }
    expect(burnt(copy)).toBe(burnt(st));
    expect(burnt(st).length).toBeGreaterThan(0);
    expect(ended[1]).toEqual(ended[0]);
    expect(ended[0].some((e) => e.startsWith('tornado'))).toBe(true);
    // the monthly rolls go on from the same stream
    const rng = (s: Simulation) => (s.state.systemData.infraDisasters as { rng: number }).rng;
    expect(rng(sim2)).toBe(rng(sim));
    sim.runDays(60);
    sim2.runDays(60);
    expect(rng(sim2)).toBe(rng(sim));
    // an old save without the record: no disasters under way, the stream from seed + day (as before)
    const old = viaClone(st);
    delete old.systemData.infraDisasters;
    const sim3 = newSim(old);
    expect(activeDisasters(sim3).length).toBe(0);
    expect(sim3.getSystem<DisastersSystem>('disasters')).toBeTruthy();
  });
});
