/**
 * WP5 advisors (SIM_DEPTH_SPEC §F table, SIM_DEPTH_AMENDMENTS WP5-4, docs/SIM_DEPTH_PART_B.md item 31): the new rules
 * fire on synthetic stats with a map location (unservedClusters / uncoveredHotspots / the facility), respect their
 * cooldowns, one garbage rule speaks from 300 residents, and advisorIssues lists every open issue unthrottled.
 */
import { describe, expect, it } from 'vitest';
import { BF, type Building, type NeedTier } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { advisorIssues, advisorsSystem, type AdvisorsSystem } from '../../src/sim/economy/advisors';
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
  for (let k = 0; k < n; k++) out.push(place(st, 't_r2', 3 + (k % 50), 21 + Math.floor(k / 50), { pop: 50, ...opts }));
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
