/**
 * Final fixes, lane sim-feedback: advisor rules that must say what actually helps (N1 grid / pipe gaps that cut occupied
 * buildings speak at once and count them; N4 demand the empty land can host; F5 brownouts; F8 parks; F10 the city
 * minibuses; N5 a locked treatment plant; N7 the worst jam, found deterministically).
 */
import { describe, expect, it } from 'vitest';
import { BF, type Building, type NeedTier } from '../../src/sim/CityState';
import { Network, Zone } from '../../src/core/types';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { advisorIssues, advisorsSystem, type AdvisorsSystem } from '../../src/sim/economy/advisors';
import { newState, place, roadLine } from '../infra/cityGen';

interface Fakes {
  clusters?: Partial<Record<NeedTier, { x: number; z: number; people: number }[]>>;
  extra?: SimSystem[];
}

/** a city with only the advisors system plus a fake services system (synthetic data, no simulation) */
function city(f: Fakes = {}) {
  const st = newState(64);
  st.systemData.infraVersion = 1; // infra layers "present": services / utilities rules active
  const services: SimSystem & { clustersOf(t: NeedTier, max: number): { x: number; z: number; people: number }[] } = {
    name: 'services',
    clustersOf: (t, max) => (f.clusters?.[t] ?? []).slice(0, max),
  };
  const rt = new EconRuntime();
  const adv = advisorsSystem(rt);
  const systems: SimSystem[] = [services, ...(f.extra ?? []), adv];
  return { st, rt, adv, systems };
}
function start(c: ReturnType<typeof city>) {
  const sim = new Simulation(c.st, c.systems);
  return { sim, adv: c.adv as AdvisorsSystem };
}
function monthTick(sim: Simulation, adv: AdvisorsSystem, d: number) {
  sim.state.day = d;
  adv.monthly!(sim);
}
const issue = (st: Simulation['state'], advisor: string, id: string) => (advisorIssues(st)[advisor] ?? []).find((a) => a.id === id);

/** a powered plant on a road, a stretch of road beyond it and n homes on that stretch (flags as given) */
function grid(st: Simulation['state'], n: number, homeFlags: number, opts: Partial<Building> = {}) {
  roadLine(st, 4, 10, 60, 10, Network.Road);
  place(st, 't_coal', 2, 9, { flags: BF.Plopped | BF.Powered });
  for (let x = 4; x <= 60; x++) st.powered[st.idx(x, 10)] = 1;
  const out: Building[] = [];
  for (let k = 0; k < n; k++) {
    const x = 30 + k;
    st.zone[st.idx(x, 11)] = Zone.ResMed;
    out.push(place(st, 't_r2', x, 11, { pop: 40, flags: homeFlags, ...opts }));
    if (homeFlags & BF.Powered) st.powered[st.idx(x, 11)] = 1;
    if (homeFlags & BF.Watered) st.watered[st.idx(x, 11)] = 1;
  }
  st.stats.powerSupply = 1000;
  st.stats.powerDemand = 100;
  st.stats.waterSupply = 500;
  st.stats.waterDemand = 100;
  st.stats.population = n * 40;
  return out;
}

describe('N1: grid / pipe gaps that cut occupied buildings', () => {
  it('gridGap names the occupied homes and speaks at the first month tick (no confirm delay)', () => {
    const c = city();
    grid(c.st, 2, BF.Watered);
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const g = issue(c.st, 'utilities', 'gridGap');
    expect(g, 'listed at once').toBeDefined();
    expect(g!.text).toMatch(/^2 occupied buildings \(80 residents\) have no power/);
    expect(g!.kind).toBe('bad');
    expect([g!.x, g!.z]).toEqual([30, 11]);
    // announced in the news feed on that same tick
    expect(c.st.news.some((n) => n.text.startsWith('2 occupied buildings (80 residents) have no power'))).toBe(true);
  });

  it('a gap of empty zoned tiles only still waits for the confirm', () => {
    const c = city();
    grid(c.st, 0, 0);
    for (let x = 30; x < 40; x++) c.st.zone[c.st.idx(x, 11)] = Zone.ResLow; // 10 unpowered empty lots (the road beside them is powered, the lots are not)
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    expect(issue(c.st, 'utilities', 'gridGap'), 'not before the confirm').toBeUndefined();
    monthTick(sim, adv, 60);
    const g = issue(c.st, 'utilities', 'gridGap');
    expect(g?.text).toMatch(/but 10 zoned tiles aren't connected to the grid, so nothing can grow there/);
  });

  it('waterGap names the occupied buildings without water and speaks at once', () => {
    const c = city();
    grid(c.st, 3, BF.Powered);
    place(c.st, 't_pump', 6, 11, { flags: BF.Plopped | BF.Powered });
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const w = issue(c.st, 'utilities', 'waterGap');
    expect(w).toBeDefined();
    expect(w!.text).toMatch(/^Water is flowing, but 3 occupied buildings \(120 residents\) have none/);
    expect(w!.kind).toBe('bad');
  });
});

/** n empty residential lots facing a powered road (ResLow: no piped water needed) with the given desirability */
function lots(st: Simulation['state'], n: number, des: Partial<Record<number, number>>) {
  roadLine(st, 2, 40, 62, 40, Network.Road);
  for (let k = 0; k < n; k++) {
    const x = 2 + (k % 60), z = 41 + Math.floor(k / 60) * 2;
    if (z > 41) roadLine(st, 2, z - 1, 62, z - 1, Network.Road);
    const i = st.idx(x, z);
    st.zone[i] = Zone.ResLow;
    st.powered[i] = 1;
    for (const [d, v] of Object.entries(des)) st.desirability[+d][i] = v!;
  }
}

describe('N4: residential demand the empty land can host', () => {
  it('R$$$-only demand with ready lots that do not suit it: says why (no "zone more"), after the confirm', () => {
    const c = city();
    lots(c.st, 93, { 0: 0.18, 1: -0.3, 2: -1 });
    c.st.stats.population = 10900;
    c.st.stats.demand[0] = -0.003; c.st.stats.demand[1] = -0.001; c.st.stats.demand[2] = 0.755;
    const { sim, adv } = start(c);
    c.rt.emptyFront[Zone.ResLow] = 93;
    monthTick(sim, adv, 30);
    expect(issue(c.st, 'planning', 'zoneR')).toBeUndefined();
    monthTick(sim, adv, 60);
    const nf = issue(c.st, 'planning', 'zoneNoFitR');
    expect(nf?.text).toMatch(/^Only wealthy residents \(R\$\$\$\) want to move in, and none of your 93 empty residential lots suit them — they need land value/);
    expect(c.st.news.some((n) => /zone more residential land/.test(n.text))).toBe(false);
  });

  it('no room and only R$$$ wants in: land value advice where it does not fit anywhere, "zone next to" where it does', () => {
    const c = city();
    lots(c.st, 4, { 0: 0.3, 1: 0.1, 2: -0.8 });
    c.st.stats.population = 10900;
    c.st.stats.demand[2] = 0.8;
    const { sim, adv } = start(c);
    c.rt.emptyFront[Zone.ResLow] = 4;
    monthTick(sim, adv, 30);
    expect(issue(c.st, 'planning', 'zoneR')?.text).toMatch(/^Wealthy residents want to move in but need land value/);
    // one desirable spot: zone more next to it (and "Show me" goes there)
    const c2 = city();
    lots(c2.st, 4, { 0: 0.3, 1: 0.1, 2: -0.8 });
    c2.st.desirability[2][c2.st.idx(4, 41)] = 0.4;
    c2.st.stats.population = 10900;
    c2.st.stats.demand[2] = 0.8;
    const s2 = start(c2);
    c2.rt.emptyFront[Zone.ResLow] = 4;
    monthTick(s2.sim, s2.adv, 30);
    const z = issue(c2.st, 'planning', 'zoneR');
    expect(z?.text).toMatch(/^Wealthy residents are looking for homes, but there is no room — zone residential land next to your most desirable homes/);
    expect([z?.x, z?.z]).toEqual([4, 41]);
  });

  it('ordinary residential demand without room still asks for more zones', () => {
    const c = city();
    lots(c.st, 4, { 0: 0.3, 1: 0.1, 2: -0.8 });
    c.st.stats.population = 5000;
    c.st.stats.demand[0] = 0.7;
    const { sim, adv } = start(c);
    c.rt.emptyFront[Zone.ResLow] = 4;
    monthTick(sim, adv, 30);
    expect(issue(c.st, 'planning', 'zoneR')?.text).toBe('Residential demand is strong but there is no room to grow — zone more residential land along roads.');
  });

  it('growthStalled: ready lots wait a year with demand while the family does not grow (in a city with buildings)', () => {
    const c = city();
    lots(c.st, 20, { 0: 0.2, 1: 0.1, 2: -0.5 });
    c.st.stats.population = 4000;
    c.st.stats.demand[0] = 0.4;
    const { sim, adv } = start(c);
    const setTotals = (cap: number) => { c.rt.totals.growables = 50; c.rt.totals.abandoned = 0; c.rt.totals.resCapAll = [cap, 0, 0]; };
    setTotals(4000);
    for (let m = 1; m <= 11; m++) {
      monthTick(sim, adv, 30 * m);
      expect(issue(c.st, 'planning', 'growthStalled'), `month ${m}`).toBeUndefined();
    }
    monthTick(sim, adv, 30 * 12);
    const g = issue(c.st, 'planning', 'growthStalled');
    expect(g?.text).toMatch(/^No new homes for a year although there is demand and 20 ready residential lots wait/);
    // the family grows: the window starts over
    setTotals(4012);
    monthTick(sim, adv, 30 * 13);
    expect(issue(c.st, 'planning', 'growthStalled')).toBeUndefined();
  });

  /** 20 empty, powered and watered farm tiles facing a road, `deep` rows deep (farms need 2 × 2 tiles: the test catalog
   *  adds 1 × 1 factories to the other industrial zones, none to agriculture) */
  function farmland(st: Simulation['state'], deep: number) {
    roadLine(st, 2, 40, 62, 40, Network.Road);
    for (let z = 41; z < 41 + deep; z++) for (let x = 10; x < 30; x++) {
      const i = st.idx(x, z);
      st.zone[i] = Zone.IndAg;
      st.powered[i] = 1;
      st.watered[i] = 1;
      st.desirability[8][i] = 0.5;
    }
    st.stats.population = 20000;
    st.stats.demand[8] = 0.35;
  }

  it('ready lots no building fits (odd single tiles) are not room: the advice says so, not "the land is unattractive"', () => {
    // (the bot city of 2013: 80 "ready" industrial tiles, every one a single tile left between factories, no industrial
    // growth for three years — growthStalled blamed desirability, which was +0.5)
    const c = city();
    farmland(c.st, 1);
    const { sim, adv } = start(c);
    c.rt.totals.growables = 50; c.rt.totals.abandoned = 0;
    monthTick(sim, adv, 30);
    expect(issue(c.st, 'planning', 'lotsSmallI'), 'after the confirm').toBeUndefined();
    monthTick(sim, adv, 60);
    const a = issue(c.st, 'planning', 'lotsSmallI');
    expect(a?.text).toBe('Industry wants to move in, but your 20 empty industrial lots are odd tiles left between buildings and roads — too small for farms, which need at least 2×2 tiles along a road. Zone new industrial land along roads.');
    expect(a?.z).toBe(41);
    expect(issue(c.st, 'planning', 'zoneNoFitI')).toBeUndefined();
    // a year on: still that advice, and no "the land may be too unattractive" stall
    for (let m = 3; m <= 14; m++) monthTick(sim, adv, 30 * m);
    expect(issue(c.st, 'planning', 'growthStalled')).toBeUndefined();
    expect(issue(c.st, 'planning', 'lotsSmallI')).toBeDefined();
  });

  it('two rows deep a farm fits: no lot advice; on a steep slope: the steep-lot advice', () => {
    const c = city();
    farmland(c.st, 2);
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    monthTick(sim, adv, 60);
    expect(issue(c.st, 'planning', 'lotsSmallI')).toBeUndefined();
    expect(issue(c.st, 'planning', 'lotsSteepI')).toBeUndefined();
    // 10 m steps between neighbouring corners (growth allows 5 + 1.5 × 2 = 8 m on a 2 × 2 lot)
    const c2 = city();
    farmland(c2.st, 2);
    const N1 = c2.st.size + 1;
    for (let z = 41; z <= 43; z++) for (let x = 8; x <= 32; x++) c2.st.heights[z * N1 + x] = (x + z) % 2 ? 10 : 0;
    const s2 = start(c2);
    monthTick(s2.sim, s2.adv, 30);
    monthTick(s2.sim, s2.adv, 60);
    expect(issue(c2.st, 'planning', 'lotsSteepI')?.text).toBe('Industry wants to move in, but your 20 empty industrial lots are too steep to build on. Level them with the terrain tool, or zone flatter industrial land.');
  });
});

describe('F5 / F8 / F10 / N5 / N7: advice that names the real problem', () => {
  it('F5: an active brownout with the utilities layer is "Brownouts" with the dark homes and businesses, not "plan a plant soon"', () => {
    const c = city();
    grid(c.st, 3, BF.Watered);
    for (let k = 0; k < 2; k++) place(c.st, 't_cs', 40 + k, 11, { jobs: 10, capacity: 20, flags: BF.Watered });
    c.st.stats.powerSupply = 268;
    c.st.stats.powerDemand = 423;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const u = advisorIssues(c.st).utilities ?? [];
    const b = u.find((a) => a.id === 'powerShortage');
    expect(b?.text).toMatch(/^Brownouts: 3 homes and 2 businesses have no power — demand of 423 MW exceeds our 268 MW supply/);
    expect(b?.kind).toBe('bad');
    expect(u.some((a) => a.id === 'powerTight')).toBe(false);
    expect(u.some((a) => a.id === 'gridGap')).toBe(false); // a brownout is not a grid gap
  });

  it('F8: residents without a park within a walk get a parks advice at the biggest unserved cluster', () => {
    const c = city({ clusters: { green: [{ x: 20, z: 30, people: 2000 }] } });
    c.st.stats.population = 20000;
    c.st.stats.needs.green = { need: 18000, served: 9000, capacity: 9000, unreached: 6000, overcrowded: 0 };
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const p = issue(c.st, 'environment', 'parks');
    expect(p?.text).toMatch(/^6,000 residents have no park within a walk — build a park near here/);
    expect([p?.x, p?.z]).toEqual([20, 30]);
    // well served: quiet
    const c2 = city();
    c2.st.stats.population = 20000;
    c2.st.stats.needs.green = { need: 18000, served: 17000, capacity: 20000, unreached: 1000, overcrowded: 0 };
    const s2 = start(c2);
    monthTick(s2.sim, s2.adv, 30);
    expect(issue(c2.st, 'environment', 'parks')).toBeUndefined();
  });

  it('F10: without a depot the 8 buses are the city minibuses', () => {
    const c = city();
    const stop = place(c.st, 'tr_bus_stop', 12, 12, { flags: BF.Plopped });
    c.st.stats.population = 30000;
    c.st.stats.transitFleet.buses = 8;
    c.st.stats.transitFleet.busesNeeded = 37.2;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const f = issue(c.st, 'transport', 'busFleetShort');
    expect(f?.text).toBe('Only 8 city minibuses serve your bus stops, which need 37 buses — riders wait and drive instead. Build a Bus Depot near them.');
    expect([f?.x, f?.z]).toEqual([stop.x, stop.z]);
  });

  it('N5: before the Water Treatment Plant unlocks, tap-water advice moves the pump and says when it unlocks', () => {
    const c = city();
    c.st.stats.population = 5126;
    c.st.stats.tapWater = 0.55;
    c.st.stats.waterSupply = 1000;
    c.st.stats.waterDemand = 500;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const t = issue(c.st, 'utilities', 'tapWater');
    expect(t?.text).toMatch(/Move your pumps upstream, away from industry, farms and landfills \(Data views → Water → Tap water quality\) — the Water Treatment Plant unlocks at 6,000 residents\.$/);
    expect(t?.text).not.toMatch(/build a Water Treatment Plant/);
    // unlocked: build one
    c.st.unlocked.add('water_treatment');
    monthTick(sim, adv, 60);
    expect(issue(c.st, 'utilities', 'tapWater')?.text).toMatch(/build a Water Treatment Plant, or move pumps away from pollution/);
  });

  it('N7: the worst jammed road cell is found every month (not a day-dependent 1 / 16 sample), with its load', () => {
    const c = city();
    roadLine(c.st, 2, 50, 60, 50, Network.Road);
    c.st.stats.population = 9000;
    for (let x = 2; x <= 60; x++) c.st.congestion[c.st.idx(x, 50)] = 0.9;
    c.st.congestion[c.st.idx(23, 50)] = 2.32;
    c.st.congestion[c.st.idx(24, 50)] = 1.6;
    c.st.congestion[c.st.idx(25, 50)] = 1.1;
    const { sim, adv } = start(c);
    for (const d of [30, 60, 90, 120]) {
      monthTick(sim, adv, d);
      const g = issue(c.st, 'transport', 'gridlock');
      expect(g?.text, `month ${d / 30}`).toBe("Traffic is gridlocked here (232% of the road's capacity; 3 road tiles are over capacity). Upgrade to avenues, add alternate routes or build transit.");
      expect([g?.x, g?.z]).toEqual([23, 50]);
    }
  });
});

/**
 * Final fixes r4 (playtest polish 6): a landfill / incinerator that no road touches takes no garbage (the pollution pass
 * records it: roadlessGarbage) — the garbage card names it and asks for a road, as its news does, instead of "the city
 * has nowhere to take it. Zone a landfill". When other capacity exists the card's own reason stays first and the road
 * comes after it. (End to end with the real pollution pass: tests/infra/feedbackGarbage.test.ts.)
 */
describe('r4: the garbage card names a facility no road touches', () => {
  /** 20 homes, 6 of them without pickup (30%), and a fake pollution system (garbage summary + the roadless one) */
  function garbageCity(sum: Record<string, number>, roadless: { what: string; x: number; z: number } | null, capacity: number) {
    const g = { producedT: 100, collectedT: 0, recycledT: 0, burnedT: 0, landfilledT: 0, outOfRangeT: 0, overCapacityT: 0, outOfRangeBuildings: 0, noRoadBuildings: 0, noRoadT: 0, landfillFill: 0, landfillCapT: 0, ...sum };
    const c = city({ extra: [{ name: 'pollution', garbageSummary: () => g, roadlessGarbage: () => roadless } as unknown as SimSystem] });
    roadLine(c.st, 2, 20, 60, 20, Network.Road);
    for (let k = 0; k < 20; k++) {
      c.st.zone[c.st.idx(3 + k, 21)] = Zone.ResMed;
      place(c.st, 't_r2', 3 + k, 21, { pop: 20, flags: k < 6 ? BF.NoGarbage : 0 });
    }
    c.st.garbage[c.st.idx(6, 21)] = 0.7; // the worst pile
    c.st.stats.population = 400;
    c.st.stats.garbageProduced = 100;
    c.st.stats.garbageCapacity = capacity;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    return issue(c.st, 'utilities', 'garbage');
  }

  it('nothing else takes garbage: "your Incinerator has no road access … connect it to a road", at the incinerator', () => {
    const g = garbageCity({ outOfRangeT: 100 }, { what: 'Incinerator', x: 40, z: 40 }, 0);
    expect(g?.text).toBe("Garbage is piling up at the homes of 30% of residents: your Incinerator has no road access, so garbage trucks can't use it — connect it to a road. Uncollected garbage costs approval from 2,000 residents (full effect at 20,000).");
    expect([g?.x, g?.z]).toEqual([40, 40]);
  });

  it('no roadless facility: still "the city has nowhere to take it"', () => {
    expect(garbageCity({ outOfRangeT: 100 }, null, 0)?.text).toMatch(/^Garbage is piling up at the homes of 30% of residents: the city has nowhere to take it\. Zone a landfill \(or build an incinerator\) and connect it by road\./);
  });

  it('other capacity, homes out of range: the range advice first, then the roadless landfill', () => {
    const g = garbageCity({ outOfRangeT: 60, collectedT: 40, landfilledT: 40, landfillCapT: 50 }, { what: 'landfill', x: 30, z: 40 }, 50);
    expect(g?.text).toMatch(/^Garbage trucks can't reach the homes of 30% of residents — they are more than \d+ road tiles from a landfill, incinerator or recycling center\. Build one closer \(Garbage data view\)\. Your landfill has no road access, so garbage trucks can't use it — connect it to a road\. Uncollected garbage/);
    // (the place stays the worst home: the card's first reason is theirs)
    expect([g?.x, g?.z]).toEqual([6, 21]);
  });
});
