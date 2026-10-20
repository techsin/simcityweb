/**
 * Final fixes round 2, lane sim-feedback, SF-2 (silent ruins), the advisors part. In a 2000-2041 playtest a tornado
 * flattened the player's only Fire Station without a word, and 55 burnt lots (8% of the zoned land) sat for years while
 * the planner asked for more residential land; nothing ever mentioned the rubble or the Municipal Demolition Crews:
 *  - a ruined service facility (fire, police, health, education, garbage) gets its own advice: what its area lost, that
 *    its upkeep is still charged until it is bulldozed, and "Show me" at the ruin (fire first);
 *  - rubble gets its own advice (bulldoze it or enact the crews; quiet while they are enacted), and the "no room — zone
 *    more" rules count rubble as room and name it first;
 *  - ruined plants / water facilities "lie in ruins" (a tornado flattens; it did not burn) and say their upkeep runs on.
 * Final fixes r3: every other plopped ruin — deals, landmarks, civic buildings, transport, parks — gets its own advice
 * ('ruins': a §2,500/mo Missile Test Range lay in ruins for 55 years without a word): what stopped (deal income,
 * tourists, the demand-cap boost, land value and prestige), the upkeep still charged, "Show me" at the most valuable
 * ruin, the finance advisor when income stopped (else planning).
 */
import { describe, expect, it } from 'vitest';
import { BF, type Building } from '../../src/sim/CityState';
import { Network, Zone } from '../../src/core/types';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { advisorIssues, advisorsSystem, type AdvisorsSystem } from '../../src/sim/economy/advisors';
import { infraSystems, triggerDisaster } from '../../src/sim/systems/infra';
import { formatMoney } from '../../src/sim/economy/format';
import { getDef } from '../../src/sim/catalog';
import { buildingUpkeep } from '../../src/sim/economy/opex';
import { newState, place, roadLine } from '../infra/cityGen';

/** a city with only the advisors system (synthetic data, no simulation; the simulation starts at the first month tick,
 *  after the test placed its buildings) */
function city() {
  const st = newState(64);
  st.systemData.infraVersion = 1; // infra layers "present": services / utilities rules active
  const rt = new EconRuntime();
  const adv = advisorsSystem(rt) as AdvisorsSystem;
  return { st, rt, adv, sim: null as Simulation | null };
}
function start(c: ReturnType<typeof city>): Simulation {
  return (c.sim ??= new Simulation(c.st, [c.adv]));
}
function monthTick(c: ReturnType<typeof city>, d: number) {
  start(c);
  c.st.day = d;
  c.adv.monthly!(c.sim!);
}
const issue = (c: ReturnType<typeof city>, advisor: string, id: string) => (advisorIssues(c.st)[advisor] ?? []).find((a) => a.id === id);
const allIssues = (c: ReturnType<typeof city>) => Object.values(advisorIssues(c.st)).flat();

/** n homes in rubble (2x2 R$$$ towers on high-density residential land along a road at z = 20) */
function rubble(st: ReturnType<typeof newState>, n: number): Building[] {
  roadLine(st, 2, 20, 61, 20, Network.Road);
  const out: Building[] = [];
  for (let k = 0; k < n; k++) {
    const x = 3 + 2 * k;
    for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) st.zone[st.idx(x + dx, 21 + dz)] = Zone.ResHigh;
    out.push(place(st, 't_r3', x, 21, { flags: BF.Burnt }));
  }
  return out;
}

describe('SF-2: a ruined city facility gets its own advice', () => {
  it('a Fire Station in ruins: what its area lost, its upkeep still charged, Show me at the ruin', () => {
    const c = city();
    const fs = place(c.st, 'civ_fire_station', 40, 30, { flags: BF.Plopped | BF.Burnt });
    c.st.stats.population = 3000;
    monthTick(c, 30);
    const a = issue(c, 'safety', 'facilityRuins');
    expect(a).toBeDefined();
    const up = buildingUpkeep(c.st, getDef('civ_fire_station')!);
    expect(a!.text).toBe(`Your Fire Station lies in ruins — its area has lost its fire protection and its fire trucks. Bulldoze the rubble and build a new one: its upkeep (§${Math.round(up).toLocaleString('en-US')}/mo) is still charged until you bulldoze it.`);
    expect(a!.priority).toBe(8);
    expect([a!.x, a!.z]).toEqual([fs.x + 1, fs.z + 1]);
    // announced in the news feed (the highest priority advice of the month)
    expect(c.st.news.some((n) => n.text === a!.text)).toBe(true);
    expect(a!.text).not.toMatch(/burn/);
  });

  it('several ruins: the most urgent first, every one named, their upkeep summed', () => {
    const c = city();
    place(c.st, 'civ_elementary_school', 10, 10, { flags: BF.Plopped | BF.Burnt });
    const pol = place(c.st, 'civ_police_station', 30, 10, { flags: BF.Plopped | BF.Burnt });
    c.st.stats.population = 3000;
    monthTick(c, 30);
    const a = issue(c, 'safety', 'facilityRuins')!;
    expect(a.text).toMatch(/^2 city facilities lie in ruins \(your Police Station and Elementary School\) — the Police Station: its area has lost its police patrols and patrol cars\. Bulldoze the rubble and rebuild them: their upkeep \(§[\d,]+\/mo\) is still charged until you bulldoze them\.$/);
    expect([a.x, a.z]).toEqual([pol.x + 1, pol.z + 1]);
    expect(a.priority).toBe(7);
  });

  it('a ruined school alone: its seats are named (health & education advisor)', () => {
    const c = city();
    place(c.st, 'civ_elementary_school', 10, 10, { flags: BF.Plopped | BF.Burnt });
    c.st.stats.population = 3000;
    monthTick(c, 30);
    expect(issue(c, 'health', 'facilityRuins')?.text).toMatch(/^Your Elementary School lies in ruins — its 1,500 pupils have lost their seats\./);
  });

  it('a ruined water plant "lies in ruins" (not "burned down") and says its upkeep runs on', () => {
    const c = city();
    place(c.st, 't_pump', 20, 20, { flags: BF.Plopped | BF.Burnt });
    c.st.stats.population = 3000;
    c.st.stats.waterSupply = 0;
    monthTick(c, 30);
    const w = issue(c, 'utilities', 'waterBurnt')!;
    expect(w.text).toBe('The Water pump lies in ruins — the taps have run dry. Bulldoze the rubble and build a new one — its upkeep is still charged until you do.');
  });

  it('the only Fire Station in ruins: the fire-response advice says "no working fire station (yours lies in ruins)"', () => {
    const c = city();
    roadLine(c.st, 2, 20, 61, 20, Network.Road);
    for (let k = 0; k < 40; k++) { c.st.zone[c.st.idx(3 + k, 21)] = Zone.ResMed; place(c.st, 't_r2', 3 + k, 21, { pop: 50 }); }
    place(c.st, 'civ_fire_station', 50, 30, { flags: BF.Plopped | BF.Burnt });
    c.st.stats.population = 2000;
    c.st.respFire.fill(-5); // every home beyond reach
    // (a fake emergency system: its response layers are "ready")
    c.sim = new Simulation(c.st, [{ name: 'emergency', active: true, layersReady: true } as unknown as SimSystem, c.adv]);
    monthTick(c, 30);
    expect(issue(c, 'safety', 'noFireResponse')?.text).toMatch(/^The city has no working fire station \(yours lies in ruins\): every fire waits for you to act and can spread\. Build a Fire Station near here\.$/);
    expect(issue(c, 'safety', 'facilityRuins')?.text).toMatch(/^Your Fire Station lies in ruins/);
  });

  it('end to end: a tornado over the only Fire Station → its summary in the news, then the ruin advice', () => {
    const st = newState(64, true);
    for (let z = 5; z < 60; z += 3) roadLine(st, 2, z, 61, z, Network.Street);
    const station = place(st, 'civ_fire_station', 30, 30, { flags: BF.Plopped | BF.Powered | BF.Watered });
    for (let z = 6; z < 60; z += 3) for (let x = 3; x < 61; x++) if (st.building[st.idx(x, z)] < 0) place(st, 't_r1', x, z, { pop: 10 });
    st.stats.population = 5000;
    const rt = new EconRuntime();
    const sim = new Simulation(st, [...infraSystems(), advisorsSystem(rt) as SimSystem]);
    expect(triggerDisaster(sim, 'tornado', 31, 31)).toBe(true);
    sim.runDays(30);
    expect(station.flags & BF.Burnt).toBeTruthy();
    expect(st.news.filter((n) => /^Tornado: \d+ buildings destroyed, incl\. your Fire Station — bulldoze the rubble and rebuild\.$/.test(n.text)).length).toBe(1);
    const a = (advisorIssues(st).safety ?? []).find((x) => x.id === 'facilityRuins');
    expect(a?.text).toMatch(/^Your Fire Station lies in ruins/);
    expect([a?.x, a?.z]).toEqual([station.x + 1, station.z + 1]);
  });
});

describe('SF-2: rubble is room once cleared — and the advisors say so', () => {
  it('10 homes in rubble: the rubble advice, and no "zone more" while the rubble would give room', () => {
    const c = city();
    const homes = rubble(c.st, 10);
    c.st.stats.population = 5000;
    c.st.stats.demand[0] = 0.8; c.st.stats.demand[1] = 0.8;
    monthTick(c, 30);
    const r = issue(c, 'planning', 'rubble');
    expect(r?.text).toBe('10 lots (10 homes) lie in rubble — bulldoze them or enact Municipal Demolition Crews (Ordinances) so they can rebuild.');
    expect([r?.x, r?.z]).toEqual([homes[0].x + 1, homes[0].z + 1]);
    // (the zone rule does not ask for more land: 40 tiles of rubble are room once cleared)
    expect(issue(c, 'planning', 'zoneR')).toBeUndefined();
    expect(allIssues(c).some((a) => /zone more residential land/.test(a.text))).toBe(false);
  });

  it('rubble is not counted as abandoned buildings ("check power, water, road access …")', () => {
    const c = city();
    rubble(c.st, 10);
    c.st.stats.population = 5000;
    start(c);
    c.rt.totals.abandoned = 25; // (the population totals count rubble too: 15 abandoned + 10 ruins)
    monthTick(c, 30);
    expect(issue(c, 'planning', 'abandoned')).toBeUndefined();
    const c2 = city();
    rubble(c2.st, 10);
    c2.st.stats.population = 5000;
    start(c2);
    c2.rt.totals.abandoned = 35;
    monthTick(c2, 30);
    expect(issue(c2, 'planning', 'abandoned')?.text).toBe('25 buildings stand abandoned. Check power, water, road access, crime, pollution and demand.');
  });

  it('quiet while the Municipal Demolition Crews are enacted (they clear rubble within a month)', () => {
    const c = city();
    rubble(c.st, 10);
    c.st.stats.population = 5000;
    c.st.stats.demand[0] = 0.8;
    c.st.budget.ordinances.push('rubble_cleanup');
    monthTick(c, 30);
    expect(issue(c, 'planning', 'rubble')).toBeUndefined();
    expect(issue(c, 'planning', 'zoneR')).toBeUndefined();
  });

  it('a few rubble lots that block room: the zone rule names them first (and asks for land only when they are not enough)', () => {
    const c = city();
    rubble(c.st, 3); // 12 tiles: enough room once cleared
    c.st.stats.population = 5000;
    c.st.stats.demand[0] = 0.8;
    monthTick(c, 30);
    expect(issue(c, 'planning', 'rubble')).toBeUndefined();
    expect(issue(c, 'planning', 'zoneR')?.text).toBe('Residential demand is strong, but there is no room: 3 residential lots lie in rubble — bulldoze them or enact Municipal Demolition Crews (Ordinances) so homes can rebuild there.');
    const c2 = city();
    rubble(c2.st, 1); // 4 tiles: not enough
    c2.st.stats.population = 5000;
    c2.st.stats.demand[0] = 0.8;
    monthTick(c2, 30);
    expect(issue(c2, 'planning', 'zoneR')?.text).toBe('Residential demand is strong, but there is no room: 1 residential lot lies in rubble — bulldoze it or enact Municipal Demolition Crews (Ordinances) so homes can rebuild there, and zone more residential land along roads.');
  });

  it('before the crews unlock (1,000 residents) the advice says when they come', () => {
    const c = city();
    rubble(c.st, 8);
    c.st.stats.population = 600;
    monthTick(c, 30);
    expect(issue(c, 'planning', 'rubble')?.text).toBe('8 lots (8 homes) lie in rubble — bulldoze them (Municipal Demolition Crews, who clear rubble automatically, come with 1,000 residents) so they can rebuild.');
  });
});

describe('r3: every other ruin — deals, landmarks, civic buildings, transport, parks — gets its own advice', () => {
  const upkeepOf = (c: ReturnType<typeof city>, ids: string[]) => ids.reduce((t, id) => {
    const d = getDef(id)!;
    return t + buildingUpkeep(c.st, d) * (d.service ? (c.st.budget.funding[d.service] ?? 100) / 100 : 1);
  }, 0);

  it('a ruined deal: its deal income named (finance), Show me at the ruin, it costs nothing to rebuild', () => {
    const c = city();
    const b = place(c.st, 'rw_missile_range', 20, 20, { flags: BF.Plopped | BF.Burnt });
    c.st.stats.population = 30000;
    monthTick(c, 30);
    const a = issue(c, 'finance', 'ruins');
    expect(a?.text).toBe('Your Missile Test Range lies in ruins — its §2,500/mo deal income is gone. Bulldoze the rubble and build it again — it costs nothing.');
    expect(a!.priority).toBe(6);
    expect([a!.x, a!.z]).toEqual([b.x + 3, b.z + 3]);
    expect(c.st.news.some((n) => n.text === a!.text)).toBe(true);
  });

  it('a ruined landmark: its tourists, demand-cap boost, land value and prestige (planning), its upkeep still charged', () => {
    const c = city();
    place(c.st, 'lm_clock_tower', 20, 20, { flags: BF.Plopped | BF.Burnt });
    c.st.stats.population = 30000;
    monthTick(c, 30);
    const a = issue(c, 'planning', 'ruins');
    expect(a?.text).toBe(`Your Clock Tower lies in ruins — its tourists, its residential and commercial demand-cap boost and the land value and prestige around it are gone. Bulldoze the rubble and build it again: its upkeep (${formatMoney(upkeepOf(c, ['lm_clock_tower']))}/mo) is still charged until you bulldoze it.`);
    expect(a!.priority).toBe(5);
  });

  it('several ruins: the most valuable first and at Show me, every one named, their upkeep summed', () => {
    const c = city();
    place(c.st, 'park_playground', 4, 4, { flags: BF.Plopped | BF.Burnt });
    place(c.st, 'lm_clock_tower', 10, 4, { flags: BF.Plopped | BF.Burnt });
    const casino = place(c.st, 'rw_casino', 30, 30, { flags: BF.Plopped | BF.Burnt });
    place(c.st, 'tr_bus_stop', 12, 4, { flags: BF.Plopped | BF.Burnt });
    place(c.st, 'park_small', 14, 4, { flags: BF.Plopped | BF.Burnt });
    c.st.stats.population = 30000;
    monthTick(c, 30);
    const a = issue(c, 'finance', 'ruins')!;
    const up = upkeepOf(c, ['park_playground', 'lm_clock_tower', 'rw_casino', 'tr_bus_stop', 'park_small']);
    expect(a.text).toBe(`5 of your buildings lie in ruins (your Casino Resort, Clock Tower, Playground and 2 more) — the Casino Resort: its §3,000/mo deal income, its tourists and its commercial demand-cap boost are gone. Bulldoze the rubble and rebuild them: their upkeep (${formatMoney(up)}/mo) is still charged until you bulldoze them.`);
    expect([a.x, a.z]).toEqual([casino.x + 1, casino.z + 1]);
    expect(a.priority).toBe(6);
  });

  it('only small parks and bus stops: a low-priority planning note; transport says what stopped', () => {
    const c = city();
    place(c.st, 'park_playground', 4, 4, { flags: BF.Plopped | BF.Burnt });
    place(c.st, 'tr_bus_stop', 8, 4, { flags: BF.Plopped | BF.Burnt });
    c.st.stats.population = 3000;
    monthTick(c, 30);
    const a = issue(c, 'planning', 'ruins')!;
    expect(a.priority).toBe(3);
    expect(a.text).toMatch(/^2 of your buildings lie in ruins \(your Playground and Bus Stop\) — the Playground: play space for 700 kids and teens, its residential demand-cap boost and the land value around it are gone\./);
    const d = city();
    place(d.st, 'civ_bus_depot', 4, 4, { flags: BF.Plopped | BF.Burnt });
    d.st.stats.population = 3000;
    monthTick(d, 30);
    expect(issue(d, 'planning', 'ruins')?.text).toMatch(/^Your Bus Depot lies in ruins — its buses are gone\. Bulldoze the rubble and build it again: its upkeep \(§[\d,]+\/mo\) is still charged until you bulldoze it\.$/);
  });

  it('nothing left to charge (its budget at 0 %): no "still charged" clause', () => {
    const c = city();
    place(c.st, 'civ_fire_station', 40, 30, { flags: BF.Plopped | BF.Burnt });
    c.st.budget.funding.fire = 0;
    c.st.stats.population = 3000;
    monthTick(c, 30);
    expect(issue(c, 'safety', 'facilityRuins')?.text).toBe('Your Fire Station lies in ruins — its area has lost its fire protection and its fire trucks. Bulldoze the rubble and build a new one.');
  });

  it('service ruins keep their own card; the other ruins get theirs next to it', () => {
    const c = city();
    place(c.st, 'civ_police_station', 30, 10, { flags: BF.Plopped | BF.Burnt });
    place(c.st, 'rw_military_base', 40, 40, { flags: BF.Plopped | BF.Burnt });
    c.st.stats.population = 30000;
    monthTick(c, 30);
    expect(issue(c, 'safety', 'facilityRuins')?.text).toMatch(/^Your Police Station lies in ruins/);
    expect(issue(c, 'finance', 'ruins')?.text).toBe('Your Military Base lies in ruins — its §1,500/mo deal income and its industrial demand-cap boost are gone. Bulldoze the rubble and build it again — it costs nothing.');
  });

  it('end to end: a meteor ruins a deal → the summary names it, then the advice names its income', () => {
    const st = newState(64, true);
    for (let z = 5; z < 60; z += 6) roadLine(st, 2, z, 61, z, Network.Street);
    const deal = place(st, 'rw_missile_range', 34, 25, { flags: BF.Plopped | BF.Powered | BF.Watered });
    st.stats.population = 30000;
    const rt = new EconRuntime();
    const sim = new Simulation(st, [...infraSystems(), advisorsSystem(rt) as SimSystem]);
    expect(triggerDisaster(sim, 'meteor', 31, 31)).toBe(true);
    expect(deal.flags & BF.Burnt).toBeTruthy();
    expect(st.news.find((n) => n.text.startsWith('Meteor strike!'))!.text).toMatch(/incl\. your Missile Test Range\.$/);
    sim.runDays(30);
    const a = (advisorIssues(st).finance ?? []).find((x) => x.id === 'ruins');
    expect(a?.text).toMatch(/^Your Missile Test Range lies in ruins — its §2,500\/mo deal income is gone\./);
  });
});
