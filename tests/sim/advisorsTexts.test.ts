/**
 * Final fixes round 2, lane sim-feedback: advisor texts that send the player to the right fix (SF-9) and the advisors
 * module staying out of the lazily loaded rewards chunk (SF-7):
 *  - SF-9b: an overcrowded University said "every pupil learns less. Build another school nearby" — the advice now names
 *    the kind to build (elementary school, high school, university; a library for the library tier);
 *  - SF-9c: with recycling at its 35% cap (a Recycling Center recycling 838 of 4,000 t), "full landfills" no longer asks
 *    for a recycling center;
 *  - SF-7: the tap-water advice's unlock threshold is a constant pinned to the 'water_treatment' reward (advisors.ts no
 *    longer imports economy/rewards.ts).
 */
import { describe, expect, it } from 'vitest';
import { BF, type NeedTier } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { WATER_TREATMENT_UNLOCK_POP, advisorIssues, advisorsSystem, type AdvisorsSystem } from '../../src/sim/economy/advisors';
import { REWARDS } from '../../src/sim/economy/rewards';
import type { FacilityLoad } from '../../src/sim/infra/catchments';
import { RECYCLE_MAX_SHARE } from '../../src/sim/infra/params';
import { Zone } from '../../src/core/types';
import { newState, place, roadLine } from '../infra/cityGen';

/** advisors + a fake services system (facility loads) and an optional fake pollution system (garbage summary) */
function city(opts: { loads?: Record<number, Partial<FacilityLoad>>; garbage?: Record<string, number> } = {}) {
  const st = newState(64);
  st.systemData.infraVersion = 1;
  const services: SimSystem & { facilityLoadOf(s: unknown, id: number): FacilityLoad | null; clustersOf(t: NeedTier, max: number): never[] } = {
    name: 'services',
    clustersOf: () => [],
    facilityLoadOf: (_s, id) => {
      const l = opts.loads?.[id];
      return l ? ({ tier: 'elementary', needTier: 'elementary', capacity: 1000, demand: 0, utilization: 0, served: 0, seated: 0, operating: 1, powered: true, radius: 20, metric: 'walk', ...l } as FacilityLoad) : null;
    },
  };
  const systems: SimSystem[] = [services];
  if (opts.garbage) {
    const g = { producedT: 0, collectedT: 0, recycledT: 0, burnedT: 0, landfilledT: 0, outOfRangeT: 0, overCapacityT: 0, outOfRangeBuildings: 0, noRoadBuildings: 0, noRoadT: 0, landfillFill: 0, landfillCapT: 0, ...opts.garbage };
    systems.push({ name: 'pollution', garbageSummary: () => g } as unknown as SimSystem);
  }
  const adv = advisorsSystem(new EconRuntime()) as AdvisorsSystem;
  systems.push(adv);
  return { st, systems, adv, sim: null as Simulation | null };
}
function monthTick(c: ReturnType<typeof city>, d: number) {
  c.sim ??= new Simulation(c.st, c.systems);
  c.st.day = d;
  c.adv.monthly!(c.sim);
}
const issue = (c: ReturnType<typeof city>, advisor: string, id: string) => (advisorIssues(c.st)[advisor] ?? []).find((a) => a.id === id);

describe('SF-9b: an overcrowded school names the kind to build', () => {
  const crowded = (defId: string, tier: string, needTier: NeedTier) => {
    const c = city();
    const b = place(c.st, defId, 30, 30, { flags: BF.Plopped });
    (c.systems[0] as SimSystem & { facilityLoadOf: unknown }).facilityLoadOf = (_s: unknown, id: number) =>
      (id === b.id ? { tier, needTier, capacity: 6000, demand: 8100, utilization: 1.35, served: 6000, seated: 6000, operating: 1, powered: true, radius: 60, metric: 'drive' } : null);
    c.st.stats.population = 80000;
    c.st.stats.needs[needTier] = { need: 9000, served: 6000, capacity: 6000, unreached: 0, overcrowded: 1 };
    monthTick(c, 30);
    return issue(c, 'health', 'schoolOvercrowded')?.text;
  };
  it('a University at 135%: "Build another university nearby", students not pupils', () => {
    expect(crowded('civ_college', 'college', 'college')).toBe('University is at 135% capacity — every student learns less. Build another university nearby.');
  });
  it('an elementary school and a high school name their own kind', () => {
    expect(crowded('civ_elementary_school', 'elementary', 'elementary')).toBe('Elementary School is at 135% capacity — every pupil learns less. Build another elementary school nearby.');
    expect(crowded('civ_high_school', 'high', 'high')).toBe('High School is at 135% capacity — every student learns less. Build another high school nearby.');
  });
});

describe('SF-9c: full landfills with recycling at its cap do not ask for a recycling center', () => {
  /** 20 homes, 6 of them without pickup (30%) */
  const homes = (st: ReturnType<typeof newState>) => {
    roadLine(st, 2, 20, 60, 20);
    for (let k = 0; k < 20; k++) {
      st.zone[st.idx(3 + k, 21)] = Zone.ResMed;
      place(st, 't_r2', 3 + k, 21, { pop: 20, flags: k < 6 ? BF.NoGarbage : 0 });
    }
    st.stats.population = 400;
    st.stats.garbageProduced = 2552;
    st.stats.garbageCapacity = 2393;
  };
  const text = (g: Record<string, number>) => {
    const c = city({ garbage: g });
    homes(c.st);
    monthTick(c, 30);
    return (advisorIssues(c.st).utilities ?? []).find((a) => a.id === 'garbage')?.text ?? '';
  };
  it('recycling at its 35% cap: zone landfill or build an incinerator, and why not recycling', () => {
    const t = text({ producedT: 2552, collectedT: 2393, recycledT: 2393 * RECYCLE_MAX_SHARE, overCapacityT: 159 });
    expect(t).toMatch(/landfills and incinerators are full \(2,552 t a month made, 2,393 t taken\)\. Zone more landfill or build an incinerator — recycling already takes the most it can \(35% of the collected garbage\)\./);
    expect(t).not.toMatch(/recycling center/);
  });
  it('a recycling center below its cap: "another recycling center" still helps; none at all: the old advice', () => {
    expect(text({ producedT: 2552, collectedT: 2393, recycledT: 300, overCapacityT: 159 })).toMatch(/Zone more landfill, or build an incinerator or another recycling center\./);
    expect(text({ producedT: 2552, collectedT: 2393, recycledT: 0, overCapacityT: 159 })).toMatch(/Zone more landfill or build an incinerator \/ recycling center\./);
  });
});

describe('SF-7: the advisors module does not import the rewards chunk', () => {
  it('the Water Treatment Plant unlock threshold matches its reward', () => {
    const r = REWARDS.find((x) => x.id === 'water_treatment');
    expect(r?.conds.find((x) => x.label === 'Population')?.need).toBe(WATER_TREATMENT_UNLOCK_POP);
  });
  it('the tap-water advice before the unlock names it', () => {
    const c = city();
    place(c.st, 't_pump', 10, 10, { flags: BF.Plopped | BF.Powered });
    c.st.stats.population = 2000;
    c.st.stats.tapWater = 0.5;
    c.st.stats.waterSupply = 100;
    c.st.stats.waterDemand = 50;
    monthTick(c, 30);
    expect(issue(c, 'utilities', 'tapWater')?.text).toMatch(/the Water Treatment Plant unlocks at 6,000 residents\.$/);
  });
});
