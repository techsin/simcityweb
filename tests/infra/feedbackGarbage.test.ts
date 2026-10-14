/**
 * Final fixes P7: a landfill (or incinerator) that exists but no road touches is named in the garbage news — the fix
 * is a road, not "build a landfill".
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { newSim, newState, place, roadLine } from './cityGen';

describe('garbage news names a roadless landfill (final fixes P7)', () => {
  it('"your landfill has no road access" with its place, not "you have no landfill"', () => {
    const st = newState(64);
    roadLine(st, 2, 10, 60, 10, Network.Road);
    for (let x = 4; x < 40; x++) place(st, 't_r2', x, 11, { pop: 60 });
    // a landfill one cell away from every road
    for (let z = 30; z < 36; z++) for (let x = 20; x < 28; x++) st.zone[st.idx(x, z)] = Zone.Landfill;
    const sim = newSim(st);
    st.stats.population = 2160;
    for (let d = 0; d < 40; d++) sim.advanceDay();
    const news = st.news.filter((n) => /^Garbage is piling up/.test(n.text));
    expect(news.length).toBeGreaterThan(0);
    expect(news[0].text).toMatch(/^Garbage is piling up at \d+ buildings: your landfill has no road access, so garbage trucks can't use it — connect it to a road\./);
    expect(news[0].text).not.toMatch(/have no landfill/);
    expect([news[0].x, news[0].z]).toEqual([20, 30]);
  });
});
