/**
 * Final fixes P7: a landfill (or incinerator) that exists but no road touches is named in the garbage news — the fix
 * is a road, not "build a landfill". Final fixes r4 (playtest polish 6): the Utilities advisor's open-issue card, which
 * outranks that news, says the same (it read "the city has nowhere to take it. Zone a landfill …").
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { advisorIssues, advisorsSystem } from '../../src/sim/economy/advisors';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { facilityReport } from '../../src/sim/infra/facilities';
import { RECYCLE_MAX_SHARE } from '../../src/sim/infra/params';
import type { PollutionSystem } from '../../src/sim/infra/pollution';
import { infraSystems } from '../../src/sim/systems/infra';
import { newSim, newState, place, registerTestDefs, roadLine } from './cityGen';

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

/**
 * Final fixes r4 (playtest polish 6; the PB-GARBAGE wording of docs/POLISH_PLAN.md): the garbage card of a city whose
 * only landfill no road touches said "the city has nowhere to take it. Zone a landfill (or build an incinerator) and
 * connect it by road" — the pollution pass gives that landfill no capacity and records it (roadlessGarbage), its own
 * news names it, and now the card does too, with the landfill as the place to act.
 */
describe('the garbage card names a roadless landfill (final fixes r4)', () => {
  /** 36 homes along a road at z = 10 and a landfill zone at x 20..27, z 30..35, one cell or more from every road */
  function town(roadToLandfill: boolean): { st: CityState; sim: Simulation } {
    registerTestDefs();
    const st = newState(64);
    roadLine(st, 2, 10, 60, 10, Network.Road);
    for (let x = 4; x < 40; x++) { st.zone[st.idx(x, 11)] = Zone.ResMed; place(st, 't_r2', x, 11, { pop: 60 }); }
    for (let z = 30; z < 36; z++) for (let x = 20; x < 28; x++) st.zone[st.idx(x, z)] = Zone.Landfill;
    if (roadToLandfill) roadLine(st, 19, 10, 19, 36, Network.Road);
    st.stats.population = 2160;
    const sim = new Simulation(st, [...infraSystems(), advisorsSystem(new EconRuntime()) as SimSystem]);
    sim.runDays(121); // uncollected piles pass the pickup threshold after about 2.5 months; the card is a month tick's
    return { st, sim };
  }
  const card = (st: CityState) => (advisorIssues(st).utilities ?? []).find((a) => a.id === 'garbage');

  it('nothing takes the garbage but a landfill with no road: the card asks for a road to it, at the landfill', () => {
    const { st, sim } = town(false);
    expect(sim.getSystem<PollutionSystem>('pollution')!.roadlessGarbage()).toEqual({ what: 'landfill', x: 20, z: 30 });
    const g = card(st);
    expect(g?.text).toMatch(/^Garbage is piling up at the homes of 100% of residents: your landfill has no road access, so garbage trucks can't use it — connect it to a road\. Uncollected garbage costs approval/);
    expect(g!.text).not.toMatch(/nowhere to take it|Zone a landfill/);
    expect([g!.x, g!.z]).toEqual([20, 30]);
    expect(g!.kind).toBe('bad');
  });

  it('a road to it: the landfill takes the garbage, nothing is roadless and the card is gone', () => {
    const { st, sim } = town(true);
    expect(sim.getSystem<PollutionSystem>('pollution')!.roadlessGarbage()).toBeNull();
    expect(sim.getSystem<PollutionSystem>('pollution')!.garbageSummary().landfillCapT).toBeGreaterThan(0);
    expect(card(st)).toBeUndefined();
  });
});
