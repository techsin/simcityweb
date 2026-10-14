/**
 * Final fixes P7: a landfill (or incinerator) that exists but no road touches is named in the garbage news — the fix
 * is a road, not "build a landfill".
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { facilityReport } from '../../src/sim/infra/facilities';
import { RECYCLE_MAX_SHARE } from '../../src/sim/infra/params';
import type { PollutionSystem } from '../../src/sim/infra/pollution';
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

/**
 * Final fixes round 2, SF-9c: a Recycling Center recycling its 35% share of the collected garbage told the player, in
 * its own inspector, to "build a recycling center" when the landfills were full — recycling is capped at
 * RECYCLE_MAX_SHARE, so another one does not help: the line now says so and asks for landfill or an incinerator.
 */
describe('a recycling center at the recycling cap does not ask for another one (final fixes SF-9c)', () => {
  it('over capacity with recycling capped: "zone more landfill or build an incinerator", and why', () => {
    const st = newState(64);
    roadLine(st, 2, 10, 60, 10, Network.Road);
    for (let x = 4; x < 60; x++) place(st, 't_r2', x, 11, { pop: 60 });
    const rc = place(st, 'util_recycling_center', 20, 7, { flags: BF.Plopped | BF.Powered });
    const sim = newSim(st);
    st.stats.population = 3360;
    for (let d = 0; d < 40; d++) sim.advanceDay();
    const sm = sim.getSystem<PollutionSystem>('pollution')!.garbageSummary();
    expect(sm.overCapacityT).toBeGreaterThan(1);
    expect(sm.recycledT).toBeCloseTo(RECYCLE_MAX_SHARE * sm.collectedT, 3);
    const line = facilityReport(sim, rc.id)!.lines.find((l) => l.key === 'city')!;
    expect(line.hint).toBe('Over capacity — zone more landfill or build an incinerator (recycling already takes the most it can: 35% of the collected garbage)');
  });
});
