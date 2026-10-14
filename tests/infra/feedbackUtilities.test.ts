/**
 * Final fixes N1 (sim part): an edit that cuts occupied buildings off their grid / pipes is news the same day, with
 * counts and a location; the brownout's deliberate farthest-first cut and the load pass are not.
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { getUtilities } from '../../src/sim/systems/infra';
import { newSim, newState, place, roadLine } from './cityGen';

const cutNews = (st: { news: { text: string; day: number; x?: number; z?: number }[] }) => st.news.filter((n) => /^(Power|Water|Power and water) cut/.test(n.text));

describe('utility cut news (final fixes N1)', () => {
  it('cutting the only road between a plant and homes is news the same day, with counts and a place', () => {
    const st = newState(64);
    roadLine(st, 4, 10, 40, 10, Network.Road);
    place(st, 't_coal', 2, 9); // 2x2 at x 2..3 touching the road at x = 4
    const a = place(st, 't_r1', 30, 11, { pop: 10 });
    const b2 = place(st, 't_r1', 32, 11, { pop: 12 });
    const near = place(st, 't_r1', 8, 11, { pop: 9 });
    const sim = newSim(st);
    expect(a.flags & BF.Powered).toBeTruthy();
    expect(cutNews(st)).toHaveLength(0); // the first (load) pass is never news
    // bulldoze the road cell at x = 20: the homes east of it lose the plant
    st.network[st.idx(20, 10)] = Network.None;
    sim.events.emit('networkChanged', { x0: 20, z0: 10, x1: 21, z1: 11 });
    const day = st.day + 1;
    sim.advanceDay();
    expect(a.flags & BF.Powered).toBeFalsy();
    expect(b2.flags & BF.Powered).toBeFalsy();
    expect(near.flags & BF.Powered).toBeTruthy();
    const news = cutNews(st);
    expect(news).toHaveLength(1);
    expect(news[0].day).toBe(day);
    expect(news[0].text).toMatch(/^Power cut: 2 buildings \(22 residents\) lost power/);
    expect(news[0].text).toMatch(/Power data view/);
    expect(news[0].x).toBe(b2.x);
    expect(news[0].z).toBe(b2.z);
    // nothing new while the cut persists
    for (let d = 0; d < 20; d++) sim.advanceDay();
    expect(cutNews(st)).toHaveLength(1);
  });

  it('a pump cut off its homes: water cut news for the buildings that need piped water', () => {
    const st = newState(64);
    roadLine(st, 4, 20, 40, 20, Network.Road);
    place(st, 't_coal', 2, 19);
    place(st, 't_pump', 5, 21);
    const apt = place(st, 't_r2', 30, 21, { pop: 40 });
    st.zone[st.idx(30, 21)] = Zone.ResMed;
    const house = place(st, 't_r1', 31, 21, { pop: 8 }); // low density: no piped water needed
    for (let x = 4; x <= 40; x++) st.powerLines[st.idx(x, 22)] = 1; // power reaches past the cut
    const sim = newSim(st);
    expect(apt.flags & BF.Watered).toBeTruthy();
    st.network[st.idx(20, 20)] = Network.None;
    sim.events.emit('networkChanged', { x0: 20, z0: 20, x1: 21, z1: 21 });
    sim.advanceDay();
    expect(apt.flags & BF.Watered).toBeFalsy();
    expect(apt.flags & BF.Powered).toBeTruthy();
    void house;
    const news = cutNews(st);
    expect(news).toHaveLength(1);
    expect(news[0].text).toMatch(/^Water cut: 1 building \(40 residents\) lost water/);
  });

  it('a brownout is not a cut: the farthest homes lose power with the shortage news only', () => {
    const st = newState(64);
    roadLine(st, 2, 5, 60, 5, Network.Road);
    place(st, 't_small_plant', 1, 5); // 10 MW
    for (let x = 3; x <= 5; x++) place(st, 't_r2', x, 6, { pop: 55 }); // 3 x 2.8 MW
    const sim = newSim(st);
    const u = getUtilities(sim)!;
    expect(st.stats.powerDemand).toBeLessThan(st.stats.powerSupply);
    // more homes move in: demand exceeds the plant, the farthest are cut on purpose
    for (let x = 6; x <= 8; x++) place(st, 't_r2', x, 6, { pop: 55, flags: BF.Powered });
    u.invalidate();
    sim.advanceDay();
    expect(st.stats.powerDemand).toBeGreaterThan(st.stats.powerSupply);
    expect(cutNews(st)).toHaveLength(0);
  });
});
