/**
 * WP5 advisors (SIM_DEPTH_SPEC §F table, SIM_DEPTH_AMENDMENTS WP5-4, docs/SIM_DEPTH_PART_B.md item 31): the new rules
 * fire on synthetic stats with a map location (unservedClusters / uncoveredHotspots / the facility), respect their
 * cooldowns, one garbage rule speaks from 300 residents, and advisorIssues lists every open issue unthrottled.
 * Polish FH-03 / LG-05 (end of file): advice posts carry NewsItem.ref; "no room to grow" is a warning below 20,000
 * residents at most once per 180 days; a built-out map gets one card with real options instead of "zone more".
 */
import { describe, expect, it } from 'vitest';
import { BF, type Building, type NeedTier } from '../../src/sim/CityState';
import { Network, Zone } from '../../src/core/types';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { BUILT_OUT_FREE, MONTH_SCAN_DAYS, ZONE_WARN_DAYS, ZONE_WARN_POP, advisorData, advisorIssues, advisorsSystem, type AdvisorsSystem } from '../../src/sim/economy/advisors';
import type { FacilityLoad } from '../../src/sim/infra/catchments';
import { newState, place, roadLine } from '../infra/cityGen';

interface Fakes {
  clusters?: Partial<Record<NeedTier, { x: number; z: number; people: number }[]>>;
  loads?: Record<number, Partial<FacilityLoad>>;
  emergency?: boolean;
}

/** a city with only the advisors system plus fake services / emergency systems (synthetic data, no simulation) */
function city(f: Fakes = {}) {
  const st = newState(64);
  st.systemData.infraVersion = 1; // infra layers "present": services / utilities rules active
  const services: SimSystem & { clustersOf(t: NeedTier, max: number): { x: number; z: number; people: number }[]; facilityLoadOf(s: unknown, id: number): FacilityLoad | null } = {
    name: 'services',
    clustersOf: (t, max) => (f.clusters?.[t] ?? []).slice(0, max),
    facilityLoadOf: (_s, id) => {
      const l = f.loads?.[id];
      return l ? ({ tier: 'elementary', needTier: 'elementary', capacity: 1000, demand: 0, utilization: 0, served: 0, seated: 0, operating: 1, powered: true, radius: 20, metric: 'walk', ...l } as FacilityLoad) : null;
    },
  };
  const systems: SimSystem[] = [services];
  if (f.emergency) systems.push({ name: 'emergency', active: true, layersReady: true } as unknown as SimSystem);
  const rt = new EconRuntime();
  const adv = advisorsSystem(rt);
  systems.push(adv);
  return { st, rt, adv, systems };
}
function start(c: ReturnType<typeof city>) {
  const sim = new Simulation(c.st, c.systems);
  return { sim, adv: c.adv as AdvisorsSystem };
}
/** run the month tick on day d (a multiple of 30) */
function monthTick(sim: Simulation, adv: AdvisorsSystem, d: number) {
  sim.state.day = d;
  adv.monthly!(sim);
}
const newsOf = (sim: Simulation, re: RegExp) => sim.state.news.filter((n) => re.test(n.text));
const homes = (st: ReturnType<typeof newState>, n: number, opts: Partial<Building> = {}) => {
  roadLine(st, 2, 20, 60, 20);
  const out: Building[] = [];
  for (let k = 0; k < n; k++) {
    const x = 3 + (k % 50), z = 21 + Math.floor(k / 50);
    st.zone[st.idx(x, z)] = Zone.ResMed;
    out.push(place(st, 't_r2', x, z, { pop: 50, ...opts }));
  }
  return out;
};

describe('advisors: WP5 rules with locations', () => {
  it('noElementary: children without a school in walking distance, at the biggest unserved cluster', () => {
    const c = city({ clusters: { elementary: [{ x: 40, z: 44, people: 900 }] } });
    c.st.stats.population = 20000;
    c.st.stats.needs.elementary = { need: 4000, served: 2500, capacity: 2600, unreached: 800, overcrowded: 0 };
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const n = newsOf(sim, /800 children have no elementary school/);
    expect(n.length).toBe(1);
    expect([n[0].x, n[0].z, n[0].advisor]).toEqual([40, 44, 'health']);
    // (FH-03: every advice post names its rule, for its button)
    expect(n[0].ref).toEqual({ advice: 'noElementary' });
    // below max(300, 5 %) it stays quiet
    const c2 = city();
    c2.st.stats.population = 20000;
    c2.st.stats.needs.elementary = { need: 4000, served: 3700, capacity: 4000, unreached: 150, overcrowded: 0 };
    const s2 = start(c2);
    monthTick(s2.sim, s2.adv, 30);
    expect(advisorIssues(c2.st).health?.some((a) => a.id === 'noElementary') ?? false).toBe(false);
  });

  it('schoolOvercrowded: names the school and points at it', () => {
    const c = city();
    const school = place(c.st, 'civ_elementary_school', 30, 30, { flags: BF.Plopped });
    c.systems[0] = { ...c.systems[0], facilityLoadOf: (_s: unknown, id: number) => (id === school.id ? { tier: 'elementary', needTier: 'elementary', capacity: 1000, demand: 1420, utilization: 1.42, served: 900, seated: 1000, operating: 1, powered: true, radius: 20, metric: 'walk' } : null) } as SimSystem;
    c.st.stats.population = 8000;
    c.st.stats.needs.elementary = { need: 1500, served: 1000, capacity: 1000, unreached: 0, overcrowded: 1 };
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    // (ADVICE_PER_MONTH may hold the news back behind louder advice; the issue list is unthrottled)
    const n = (advisorIssues(c.st).health ?? []).filter((a) => a.id === 'schoolOvercrowded');
    expect(n.length).toBe(1);
    expect(n[0].text).toMatch(/Elementary School is at 142% capacity/);
    expect(n[0].x).toBe(school.x + (school.w >> 1));
    expect(n[0].z).toBe(school.z + (school.d >> 1));
  });

  it('sewage: untreated sewage in a city over 20k', () => {
    const c = city();
    c.st.stats.population = 25000;
    c.st.stats.sewageTreated = 0.3;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const issue = advisorIssues(c.st).environment?.find((a) => a.id === 'sewage');
    expect(issue?.text).toMatch(/Only 30% of our sewage is treated/);
    c.st.stats.sewageTreated = 0.8;
    monthTick(sim, adv, 60);
    expect(advisorIssues(c.st).environment?.some((a) => a.id === 'sewage') ?? false).toBe(false);
  });

  it('busFleetShort: at the depot', () => {
    const c = city();
    const depot = place(c.st, 'civ_bus_depot', 10, 50, { flags: BF.Plopped });
    c.st.stats.population = 30000;
    c.st.stats.transitFleet.buses = 2;
    c.st.stats.transitFleet.busesNeeded = 5;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const n = (advisorIssues(c.st).transport ?? []).filter((a) => a.id === 'busFleetShort');
    expect(n.length).toBe(1);
    expect(n[0].text).toMatch(/Bus stops need 5 buses but the depots run 2/);
    expect([n[0].x, n[0].z]).toEqual([depot.x + (depot.w >> 1), depot.z + (depot.d >> 1)]);
  });

  it('noFireResponse: residents beyond every fire station, located by uncoveredHotspots; one fire advisor at a time', () => {
    const c = city({ emergency: true });
    const hs = homes(c.st, 60);
    place(c.st, 'civ_fire_station', 60, 60, { flags: BF.Plopped });
    for (const b of hs) c.st.respFire[b.z * c.st.size + b.x] = b.x < 30 ? -6 : 3;
    c.st.stats.population = 3000;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const n = newsOf(sim, /live beyond the reach of a fire station/);
    expect(n.length).toBe(1);
    expect(n[0].x).toBeLessThan(32);
    expect(n[0].z).toBeGreaterThanOrEqual(16);
    const ids = (advisorIssues(c.st).safety ?? []).map((a) => a.id);
    expect(ids).toContain('noFireResponse');
    expect(ids).not.toContain('noFire');
  });

  it('respects cooldowns (a persistent issue speaks once, still listed every month)', () => {
    const c = city({ clusters: { elementary: [{ x: 10, z: 12, people: 900 }] } });
    c.st.stats.population = 20000;
    c.st.stats.needs.elementary = { need: 4000, served: 2500, capacity: 2600, unreached: 800, overcrowded: 0 };
    const { sim, adv } = start(c);
    for (let m = 1; m <= 8; m++) monthTick(sim, adv, 30 * m);
    // spoken on day 30; the 120-day cooldown doubles while the problem persists (240 days): not again before day 270
    expect(newsOf(sim, /children have no elementary school/).length).toBe(1);
    expect(advisorIssues(c.st).health?.map((a) => a.id)).toContain('noElementary');
    monthTick(sim, adv, 30 * 9);
    expect(newsOf(sim, /children have no elementary school/).length).toBe(2);
  });

  it('garbage: one rule from 300 residents when ≥ 20 % of homes lack pickup, with the place', () => {
    const c = city();
    const hs = homes(c.st, 20, { pop: 20 });
    for (const b of hs.slice(0, 6)) b.flags |= BF.NoGarbage;
    c.st.garbage[hs[3].z * c.st.size + hs[3].x] = 0.7;
    c.st.stats.population = 400;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const g = (advisorIssues(c.st).utilities ?? []).filter((a) => a.id === 'garbage');
    expect(g.length).toBe(1);
    expect(g[0].text).toMatch(/Garbage is piling up at the homes of 30% of residents/);
    expect(g[0].text).toMatch(/from 2,000 residents/);
    expect([g[0].x, g[0].z]).toEqual([hs[3].x, hs[3].z]);
    // a hamlet below 300 residents is left alone
    c.st.stats.population = 250;
    monthTick(sim, adv, 60);
    expect((advisorIssues(c.st).utilities ?? []).some((a) => a.id === 'garbage')).toBe(false);
  });
});

describe('advisors: review round 1 (one fire advisor, Prison wording, shared stats, saved scans)', () => {
  it('no fire station at all: ONE fire advisor that also names the power plant (plantNoFire stays quiet)', () => {
    const c = city({ emergency: true });
    const hs = homes(c.st, 60);
    for (const b of hs) c.st.respFire[b.z * c.st.size + b.x] = -99; // RESP_NONE: no station of the type
    place(c.st, 'util_coal_plant', 40, 40, { flags: BF.Plopped });
    c.st.stats.population = 3000;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const ids = Object.values(advisorIssues(c.st)).flat().map((a) => a.id);
    expect(ids).toContain('noFireResponse');
    expect(ids).not.toContain('plantNoFire');
    const t = Object.values(advisorIssues(c.st)).flat().find((a) => a.id === 'noFireResponse')!.text;
    expect(t).toMatch(/no fire station/);
    expect(t).toMatch(/power plant/);
  });

  it('justice: "Prison" wording; before the Prison unlocks the advice points at police holding cells', () => {
    const c = city();
    c.st.stats.population = 9000;
    c.st.stats.justice = { inmates: 900, beds: 0, holding: 500, arrestsMonth: 100, releasesMonth: 120, occupancy: 1.8, overflow: 0.45, policeMul: 0.9, crimeMul: 1.12 };
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const j = advisorIssues(c.st).safety!.find((a) => a.id === 'jailOvercrowded')!;
    expect(j.text).toMatch(/holding cells are full/);
    expect(j.text).toMatch(/Prison unlocks at 15,000/);
    expect(j.text).not.toMatch(/\bjail\b/i);
    c.st.unlocked.add('jail');
    monthTick(sim, adv, 60);
    expect(advisorIssues(c.st).safety!.find((a) => a.id === 'jailOvercrowded')!.text).toMatch(/^The city has no Prison/);
    // a Prison that just opened is not in the justice stats yet: no "overcrowded" in its first month
    const p = place(c.st, 'civ_jail', 20, 40, { flags: BF.Plopped, age: 10 });
    sim.events.emit('buildingAdded', p);
    monthTick(sim, adv, 90);
    expect((advisorIssues(c.st).safety ?? []).some((a) => a.id === 'jailOvercrowded')).toBe(false);
    p.age = 200;
    monthTick(sim, adv, 120);
    expect(advisorIssues(c.st).safety!.find((a) => a.id === 'jailOvercrowded')!.text).toMatch(/^The Prison is overcrowded/);
  });

  it('seniors / playgrounds read the services pass (stats.needs), "None of" instead of "Only 0%"', () => {
    const c = city({ clusters: { health: [{ x: 12, z: 30, people: 600 }] } });
    c.st.stats.population = 30000;
    c.st.stats.cohorts = [4000, 2000, 3000, 17000, 4000];
    c.st.stats.needs.health = { need: 40000, served: 30000, capacity: 30000, unreached: 8000, overcrowded: 0 };
    c.st.stats.needs.play = { need: 5400, served: 1000, capacity: 1200, unreached: 3000, overcrowded: 0 };
    c.st.stats.sewageTreated = 0;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const all = Object.values(advisorIssues(c.st)).flat();
    const sh = all.find((a) => a.id === 'seniorsHealth')!;
    expect(sh.text).toMatch(/About 800 seniors have no clinic or hospital in reach/);
    expect([sh.x, sh.z]).toEqual([12, 30]);
    expect(all.find((a) => a.id === 'playgrounds')!.text).toMatch(/^56% of our children/);
    expect(all.find((a) => a.id === 'sewage')!.text).toMatch(/^None of our sewage is treated/);
  });

  it('noise: Noisy homes are counted from building events (no monthly scan)', () => {
    const c = city();
    const hs = homes(c.st, 40);
    c.st.stats.population = 3000;
    const { sim, adv } = start(c);
    (c.rt.totals.countByDev as number[])[1] = hs.length; // (the population system counts the homes)
    for (const b of hs.slice(0, 8)) { b.flags |= BF.Noisy; c.st.noise[c.st.idx(b.x, b.z)] = 0.6; sim.events.emit('buildingChanged', b); }
    c.st.noise[c.st.idx(hs[5].x, hs[5].z)] = 0.8;
    monthTick(sim, adv, 30);
    const n = (advisorIssues(c.st).environment ?? []).find((a) => a.id === 'noise')!;
    expect(n.text).toMatch(/^20% of homes are too noisy/);
    expect([n.x, n.z]).toEqual([hs[5].x, hs[5].z]); // the noisiest home
    // quiet again: the rule clears
    for (const b of hs.slice(0, 8)) { b.flags &= ~BF.Noisy; sim.events.emit('buildingChanged', b); }
    monthTick(sim, adv, 60);
    expect((advisorIssues(c.st).environment ?? []).some((a) => a.id === 'noise')).toBe(false);
  });

  it('the month scans are saved with the city (a game loaded between the scan days and the month tick gives the same advice)', () => {
    const c = city();
    c.st.stats.population = 500;
    const { sim, adv } = start(c);
    for (const d of MONTH_SCAN_DAYS) { c.st.day = 30 + d; adv.daily!(sim); }
    const a = advisorData(c.st);
    expect(a.scan?.month).toBe(c.st.monthIndex);
    expect(a.scan?.zone).toBeDefined();
    expect(a.scan?.fac).toBeDefined();
    // plain data (structured-clone safe: it is saved in systemData)
    expect(structuredClone(a.scan)).toEqual(a.scan);
    c.st.day = 60;
    expect(c.st.monthIndex).toBe(a.scan!.month + 1);
    adv.monthly!(sim);
    expect(advisorData(c.st).scan).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------ polish FH-03 / LG-05
const zonePosts = (st: Simulation['state'], id = 'zoneR') => st.news.filter((n) => n.ref?.advice === id);
const planning = (st: Simulation['state'], id: string) => (advisorIssues(st).planning ?? []).find((a) => a.id === id);

describe('FH-03: "no room to grow" a young town cannot miss', () => {
  /** strong residential demand, 4 residential tiles zoned along a road, of them 4 empty (rt.emptyFront: the room growth
   *  sees) */
  function noRoom(pop: number) {
    const c = city();
    roadLine(c.st, 2, 20, 60, 20, Network.Road);
    for (let x = 3; x < 7; x++) c.st.zone[c.st.idx(x, 21)] = Zone.ResLow;
    c.st.stats.population = pop;
    c.st.stats.demand[0] = 0.7;
    const s = start(c);
    c.rt.emptyFront[Zone.ResLow] = 4;
    return { c, ...s };
  }

  it(`below ${ZONE_WARN_POP} residents: a warning with ref zoneR at the first month tick, then not again within ${ZONE_WARN_DAYS} days`, () => {
    const { c, sim, adv } = noRoom(5000);
    monthTick(sim, adv, 30);
    const p = zonePosts(c.st);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: 'warning', advisor: 'planning', ref: { advice: 'zoneR' },
      text: 'Residential demand is strong but there is no room to grow — zone more residential land along roads.' });
    expect(planning(c.st, 'zoneR')?.kind).toBe('warning');
    // still no room: quiet for 180 days, and backing off while it lasts (the second time after 360)
    for (let m = 2; m <= 12; m++) monthTick(sim, adv, 30 * m);
    expect(zonePosts(c.st)).toHaveLength(1);
    expect(planning(c.st, 'zoneR'), 'listed every month').toBeDefined();
    monthTick(sim, adv, 30 + 2 * ZONE_WARN_DAYS);
    expect(zonePosts(c.st)).toHaveLength(2);
  });

  it('room comes back, then runs out again: the warning returns 180 days after the last one, not sooner', () => {
    const { c, sim, adv } = noRoom(3000);
    monthTick(sim, adv, 30);
    c.rt.emptyFront[Zone.ResLow] = 20; // room came back without new zoning (buildings were bulldozed)
    monthTick(sim, adv, 60);
    expect(planning(c.st, 'zoneR')).toBeUndefined();
    c.rt.emptyFront[Zone.ResLow] = 3; // and the town filled it
    for (let d = 90; d < 30 + ZONE_WARN_DAYS; d += 30) monthTick(sim, adv, d);
    expect(zonePosts(c.st)).toHaveLength(1);
    monthTick(sim, adv, 30 + ZONE_WARN_DAYS);
    expect(zonePosts(c.st)).toHaveLength(2);
  });

  it(`from ${ZONE_WARN_POP} residents the rule stays the quieter info (an advisor news item)`, () => {
    const { c, sim, adv } = noRoom(25000);
    monthTick(sim, adv, 30);
    const p = zonePosts(c.st);
    expect(p).toHaveLength(1);
    expect(p[0].kind).toBe('advisor');
    expect(planning(c.st, 'zoneR')?.kind).toBe('info');
    expect(planning(c.st, 'zoneR')?.ref).toBeUndefined();
  });

  it('commercial and industrial too: zoneC / zoneI warnings with their own refs', () => {
    const c = city();
    roadLine(c.st, 2, 20, 60, 20, Network.Road);
    for (let x = 3; x < 7; x++) {
      c.st.zone[c.st.idx(x, 21)] = Zone.ComLow;
      c.st.zone[c.st.idx(x + 10, 21)] = Zone.IndMed;
    }
    c.st.stats.population = 4000;
    c.st.stats.demand[3] = 0.8;
    c.st.stats.demand[9] = 0.8;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    expect(planning(c.st, 'zoneC')?.kind).toBe('warning');
    expect(planning(c.st, 'zoneI')?.kind).toBe('warning');
    // (two advice a month at most, the louder "no water" first: one family speaks in each of the first two months)
    monthTick(sim, adv, 60);
    expect(zonePosts(c.st, 'zoneC')).toHaveLength(1);
    expect(zonePosts(c.st, 'zoneI')).toHaveLength(1);
  });

  it('a family with no zoned land yet has no stall to warn about, so the first real stall is announced at once', () => {
    // a new city with strong residential and industrial demand at founding and nothing zoned (Play pressed first)
    const c = city();
    roadLine(c.st, 2, 20, 60, 20, Network.Road);
    c.st.stats.demand[0] = 0.82;
    c.st.stats.demand[9] = 0.8;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    expect(planning(c.st, 'zoneR')).toBeUndefined();
    expect(planning(c.st, 'zoneI')).toBeUndefined();
    expect(zonePosts(c.st)).toHaveLength(0);
    // the player zones homes along the road on day 31; by the next month tick every lot is built on
    for (let x = 3; x < 13; x++) {
      c.st.zone[c.st.idx(x, 21)] = Zone.ResLow;
      place(c.st, 't_r1', x, 21, { pop: 10 });
    }
    c.st.stats.population = 100;
    monthTick(sim, adv, 60);
    const p = zonePosts(c.st);
    expect(p, 'the cooldown was not spent on the empty city').toHaveLength(1);
    expect(p[0].kind).toBe('warning');
    // (industry still has no land of its own)
    expect(planning(c.st, 'zoneI')).toBeUndefined();
  });

  it('the advice followed (more of the family zoned) starts the cooldown and back-off over: the newcomer bot\'s next cue comes as soon as its new patch is full', () => {
    // the newcomer profile's founding (tools/simbot.ts): 4 × 4 patches of homes, shops and industry zoned on day 90
    const c = city();
    c.st.day = 90;
    const patch = (x0: number, z0: number, zn: Zone) => {
      roadLine(c.st, x0 - 1, z0 - 1, x0 + 4, z0 - 1, Network.Road);
      for (let z = z0; z < z0 + 4; z++) for (let x = x0; x < x0 + 4; x++) {
        c.st.zone[c.st.idx(x, z)] = zn;
        place(c.st, 't_r1', x, z, { pop: 5 });
      }
    };
    patch(10, 10, Zone.ResLow);
    patch(20, 10, Zone.ResLow);
    patch(30, 10, Zone.ComLow);
    patch(40, 10, Zone.IndMed);
    c.st.stats.population = 160;
    c.st.stats.demand[0] = 0.8;
    const { sim, adv } = start(c);
    // the homes are full: the cue at the first month tick
    monthTick(sim, adv, 120);
    expect(zonePosts(c.st)).toHaveLength(1);
    // still full, nothing zoned: the cooldown holds
    monthTick(sim, adv, 150);
    expect(zonePosts(c.st)).toHaveLength(1);
    // the cue answered with one more patch, full by the next month tick: the next cue then, not 360 days on
    patch(10, 20, Zone.ResLow);
    monthTick(sim, adv, 180);
    expect(zonePosts(c.st)).toHaveLength(2);
    expect(econData(c.st).streak?.zoneR).toBe(1);
  });

  it('a variant whose fix is not more land names that fix: roadless zones → noRoadAccess (the Road tool)', () => {
    const c = city();
    for (let x = 10; x < 20; x++) c.st.zone[c.st.idx(x, 40)] = Zone.ResLow; // 10 tiles no road reaches
    c.st.stats.population = 3000;
    c.st.stats.demand[0] = 0.8;
    const { sim, adv } = start(c);
    monthTick(sim, adv, 30);
    const z = planning(c.st, 'zoneR');
    expect(z?.text).toBe('Residential demand is strong, but 10 residential tiles have no road access, so nothing can be built there — run roads into those zones.');
    expect(z?.kind).toBe('warning');
    expect(z?.ref).toBe('noRoadAccess');
    expect(c.st.news.find((n) => n.text === z?.text)?.ref).toEqual({ advice: 'noRoadAccess' });
  });

  /** n empty residential lots on a road with the given desirability per DevType (only R$$$ wants in) */
  function wealthyOnly(des: Partial<Record<number, number>>, best?: number) {
    const c = city();
    roadLine(c.st, 2, 40, 62, 40, Network.Road);
    for (let x = 2; x < 6; x++) {
      const i = c.st.idx(x, 41);
      c.st.zone[i] = Zone.ResLow;
      c.st.powered[i] = 1;
      for (const [d, v] of Object.entries(des)) c.st.desirability[+d][i] = v!;
    }
    if (best !== undefined) c.st.desirability[2][c.st.idx(4, 41)] = best;
    c.st.stats.population = 10900;
    c.st.stats.demand[2] = 0.8;
    const s = start(c);
    c.rt.emptyFront[Zone.ResLow] = 4;
    monthTick(s.sim, s.adv, 30);
    return planning(c.st, 'zoneR');
  }

  it('only wealthy residents want in: land they cannot use → zoneDev2 (no zoning button); a desirable spot → zoneR', () => {
    const unfit = wealthyOnly({ 0: 0.3, 1: 0.1, 2: -0.8 });
    expect(unfit?.text).toMatch(/^Wealthy residents want to move in but need land value/);
    expect(unfit?.ref).toBe('zoneDev2');
    const room = wealthyOnly({ 0: 0.3, 1: 0.1, 2: -0.8 }, 0.4);
    expect(room?.text).toMatch(/^Wealthy residents are looking for homes, but there is no room — zone residential land next to/);
    expect(room?.ref).toBeUndefined();
    expect([room?.x, room?.z]).toEqual([4, 41]);
  });
});

describe('LG-05: a built-out city hears options that exist', () => {
  /** strip k's land value (rows 8k+1 … 8k+7): strips 3, 1 and 5 are the cheapest */
  const LV = [0.6, 0.25, 0.7, 0.1, 0.8, 0.3, 0.9, 0.5];
  /**
   * a 64 × 64 map with a road on every eighth row and zoning on every other tile (commercial unless `zones` says otherwise
   * for strip k; one shop per strip): no free land. `freeStrip`: leave the last strip unzoned (448 free tiles, 11% of the
   * map: room to zone). Strong commercial demand and 9% unemployment unless `demand` / `unemployment` say otherwise
   */
  function town(opts: { freeStrip?: boolean; neighbour?: boolean; zones?: Partial<Record<number, Zone>>; demand?: Partial<Record<number, number>>; unemployment?: number } = {}) {
    const c = city();
    const st = c.st;
    for (let z = 0; z < 64; z += 8) roadLine(st, 0, z, 63, z, Network.Road);
    for (let k = 0; k < 8; k++) {
      if (opts.freeStrip && k === 7) continue;
      for (let z = 8 * k + 1; z < 8 * k + 8; z++) for (let x = 0; x < 64; x++) {
        st.zone[st.idx(x, z)] = opts.zones?.[k] ?? Zone.ComLow;
        st.landValue[st.idx(x, z)] = LV[k];
      }
      place(st, 't_cs', 5, 8 * k + 1, { jobs: 10 });
    }
    if (opts.neighbour) {
      st.systemData.region = { neighbors: [{ edge: 'e', tileKey: 'nb', name: 'Fooville', founded: true, population: 100000, jobs: 80000, workers: 50000, r: 0, c: 0, i: 0, from: 0, to: 64 }] };
    }
    st.stats.population = 50000;
    for (const [d, v] of Object.entries(opts.demand ?? { 3: 0.8 })) st.stats.demand[+d] = v!;
    st.stats.unemployment = opts.unemployment ?? 0.09;
    return { c, ...start(c) };
  }

  it('free land under 1%: the built-out card (Planning, priority 7) names the three lowest-value blocks; no zoneC, no "zone more" unemployment', () => {
    const { c, sim, adv } = town();
    monthTick(sim, adv, 30);
    const b = planning(c.st, 'builtOut')!;
    expect(b).toMatchObject({ kind: 'warning', priority: 7, x: 32, z: 28 });
    expect(b.text).toBe('Unemployment is at 9% and commercial demand is strong, but the city is built out: no free land is left. Rezone the lowest-value blocks (around (32, 28), (32, 12) and (32, 44)) to denser shops and offices.');
    expect(b.options).toEqual([{ id: 'rezone', x: 32, z: 28 }]);
    expect(planning(c.st, 'zoneC')).toBeUndefined();
    expect(planning(c.st, 'unemployment')).toBeUndefined();
    expect(Object.values(advisorIssues(c.st)).flat().some((a) => /zone more/i.test(a.text))).toBe(false);
    expect(zonePosts(c.st, 'builtOut')).toHaveLength(1);
  });

  it('a founded neighbour with spare jobs and no highway to it: "connect" is listed, with the middle of the shared edge', () => {
    const { c, sim, adv } = town({ neighbour: true });
    monthTick(sim, adv, 30);
    const b = planning(c.st, 'builtOut')!;
    expect(b.text).toMatch(/to denser shops and offices, or connect a highway to Fooville on the east edge, which has 30,000 jobs to spare\.$/);
    expect(b.options).toEqual([{ id: 'rezone', x: 32, z: 28 }, { id: 'connect', x: 63, z: 32 }]);
  });

  it('each candidate block is rezoned to what it is not: an industrial strip to housing or denser industry, never to industry', () => {
    const { c, sim, adv } = town({ zones: { 3: Zone.IndMed, 5: Zone.ResLow }, demand: { 0: 0.8, 9: 0.8 }, unemployment: 0 });
    monthTick(sim, adv, 30);
    expect(planning(c.st, 'builtOut')?.text).toBe('Residential and industrial demand is strong, but the city is built out: no free land is left. Rezone the lowest-value blocks (around (32, 28) to housing or denser industry; around (32, 12) to housing or industrial land; around (32, 44) to denser housing or industrial land).');
  });

  it('a block with nothing to become is passed over (high-density homes when only homes are wanted); blocks with the same targets are named together', () => {
    const { c, sim, adv } = town({ zones: { 3: Zone.ResHigh, 5: Zone.ResLow }, demand: { 0: 0.8 }, unemployment: 0 });
    monthTick(sim, adv, 30);
    const b = planning(c.st, 'builtOut')!;
    expect(b.text).toBe('Residential demand is strong, but the city is built out: no free land is left. Rezone the lowest-value blocks (around (32, 12) and (32, 60) to housing; around (32, 44) to denser housing).');
    expect(b.options).toEqual([{ id: 'rezone', x: 32, z: 12 }]);
    expect([b.x, b.z]).toEqual([32, 12]);
  });

  it('room left to zone (the y15 case): no built-out card, the zone rule as before; the scan counts the free land', () => {
    const { c, sim, adv } = town({ freeStrip: true });
    const st = c.st;
    // free land: the unzoned strip less a power line, a water tile and a plopped 2 × 2
    st.powerLines[st.idx(10, 60)] = 1;
    st.water[st.idx(11, 60)] = 1;
    place(st, 't_coal', 20, 60, { flags: BF.Plopped });
    for (const d of MONTH_SCAN_DAYS) { st.day = d; adv.daily!(sim); }
    expect(advisorData(st).scan?.zone?.free).toBe(448 - 1 - 1 - 4);
    expect(448 - 6).toBeGreaterThan(BUILT_OUT_FREE * st.cells);
    monthTick(sim, adv, 30);
    expect(planning(st, 'builtOut')).toBeUndefined();
    expect(planning(st, 'zoneC')?.text).toBe('Businesses want to open shops and offices — zone more commercial land.');
    expect(planning(st, 'unemployment')?.text).toBe('Unemployment is at 9%. Zone more commercial and industrial land.');
  });

  it('a scan saved before LG-05 (no free count) is never built out', () => {
    const { c, sim, adv } = town();
    for (const d of MONTH_SCAN_DAYS) { c.st.day = d; adv.daily!(sim); }
    delete advisorData(c.st).scan!.zone!.free;
    monthTick(sim, adv, 30);
    expect(planning(c.st, 'builtOut')).toBeUndefined();
    expect(planning(c.st, 'zoneC')).toBeDefined();
  });
});
