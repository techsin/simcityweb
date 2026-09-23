/**
 * WP1 demographics core (docs/SIM_DEPTH_SPEC.md §A): household profiles, cohort dynamics (life cycle, amenity pull),
 * workforce share, education stock -> EQ, HQ, needs penalty / NeedsUnmet, and the full-simulation aggregates.
 */
import { describe, expect, it } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { Simulation } from '../../src/sim/Simulation';
import { createSystems } from '../../src/sim/systems/index';
import { economyRuntime } from '../../src/sim/systems/economy';
import {
  COHORT_LABELS, cohortShares, carlessShare, evaluateNeeds, householdForm, hqTarget, needsExpectation, needsOf, needsPenalty,
  profileShares,
  updateDemographics, updateEqHq, workerShare, workforceShare,
} from '../../src/sim/economy/demographics';
import { conditionBreakdown } from '../../src/sim/economy/population';
import { COHORT_BASE, NEEDS_PENALTY_MAX, OCC_PERIOD } from '../../src/sim/economy/tuning';
import { sumTerms } from '../../src/sim/explain';
import { newState, place, roadLine } from '../infra/cityGen';

/** a bare state whose coverage layers count as written by sim-infra services (tests set them by hand) */
function svcState(size = 32): CityState {
  const st = newState(size);
  st.systemData.infraVersion = 1;
  st.systemData.infraLayers = { utilities: false, traffic: false, pollution: false, services: true };
  st.stats.population = 100000; // a city whose residents fully expect their needs to be met (needsExpectation = 1)
  return st;
}
function cellOf(st: CityState, b: Building): number {
  return (b.z + (b.d >> 1)) * st.size + b.x + (b.w >> 1);
}
function setCov(st: CityState, i: number, c: Partial<Record<'elem' | 'high' | 'college' | 'health' | 'play' | 'green' | 'shop' | 'transit', number>>) {
  st.eduElemCov[i] = c.elem ?? 0; st.eduHighCov[i] = c.high ?? 0; st.eduCollegeCov[i] = c.college ?? 0; st.healthCov[i] = c.health ?? 0;
  st.playCov[i] = c.play ?? 0; st.greenCov[i] = c.green ?? 0; st.shopAccess[i] = c.shop ?? 0; st.transitCov[i] = c.transit ?? 0;
}
/** advance the per-building update like the occupancy slice: dt = OCC_PERIOD, building age grows */
function age(st: CityState, bs: Building[], days: number, monthly = false) {
  for (let d = 0; d < days; d += OCC_PERIOD) {
    for (const b of bs) {
      b.age += OCC_PERIOD;
      updateDemographics(st, b, getDef(b.def)!, cellOf(st, b), OCC_PERIOD);
    }
    if (monthly && (d / OCC_PERIOD) % 8 === 7) updateEqHq(st, bs, OCC_PERIOD * 8);
  }
}

describe('demographics: profiles, cohorts and workforce', () => {
  it('household forms by model / stage; profiles sum to 1 for every form x wealth', () => {
    expect(householdForm(getDef('res_cottage.r1.2'))).toBe('house');
    expect(householdForm(getDef('res_walkup.r1.3'))).toBe('apartment');
    expect(householdForm(getDef('res_tower.r2.6'))).toBe('tower');
    expect(householdForm({ id: 'x', name: 'x', model: 'x', category: 'growable', footprint: [1, 1], stage: 5 })).toBe('apartment');
    expect(householdForm(undefined, Zone.ResHigh)).toBe('tower');
    for (const f of ['house', 'apartment', 'tower'] as const) {
      for (let w = 1; w <= 3; w++) {
        const s = profileShares(f, w);
        expect(s.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 5);
        for (const v of s) expect(v).toBeGreaterThan(0);
      }
    }
    expect(COHORT_LABELS.length).toBe(5);
    // wealthy households: fewer young adults, more seniors
    expect(profileShares('apartment', 3)[2]).toBeLessThan(profileShares('apartment', 1)[2]);
    expect(profileShares('apartment', 3)[4]).toBeGreaterThan(profileShares('apartment', 1)[4]);
  });

  it('workforce share: reference mix 0.55 +- 0.02; houses < apartments < towers; students work less', () => {
    const ref = workforceShare(COHORT_BASE, 2, 0, 100);
    expect(ref).toBeGreaterThan(0.53);
    expect(ref).toBeLessThan(0.57);
    const house = workforceShare(profileShares('house', 2), 2, 0, 100);
    const apt = workforceShare(profileShares('apartment', 2), 2, 0, 100);
    const tower = workforceShare(profileShares('tower', 2), 2, 0, 100);
    console.log(`workforce share: reference ${ref.toFixed(3)} house ${house.toFixed(3)} apartment ${apt.toFixed(3)} tower ${tower.toFixed(3)}`);
    expect(house).toBeLessThan(apt);
    expect(apt).toBeLessThan(tower);
    expect(house).toBeGreaterThan(0.45);
    expect(tower).toBeLessThan(0.64);
    expect(workforceShare(COHORT_BASE, 2, 1, 100)).toBeLessThan(ref); // college in reach -> young adults study
    expect(workforceShare(COHORT_BASE, 2, 0, 20)).toBeLessThan(ref); // poor health care -> lower participation
  });

  it('a new house is full of children; 30 years later seniors are up; schools attract families', () => {
    const st = svcState(32);
    const a = place(st, 't_r1', 4, 4, { pop: 12, age: 0, wealth: 1 });
    const b = place(st, 't_r1', 20, 20, { pop: 12, age: 0, wealth: 1 });
    setCov(st, cellOf(st, a), { elem: 1, high: 1, play: 1, health: 0.5, green: 0.5, shop: 0.5 });
    setCov(st, cellOf(st, b), { health: 0.5, green: 0.5, shop: 0.5 });
    age(st, [a, b], OCC_PERIOD);
    const kids0 = a.kids!, srs0 = a.srs!;
    console.log(`new house: kids ${kids0.toFixed(3)} teens ${a.teens!.toFixed(3)} yad ${a.yad!.toFixed(3)} seniors ${srs0.toFixed(3)} wf ${a.wf!.toFixed(3)}; no-school twin kids ${b.kids!.toFixed(3)}`);
    expect(kids0).toBeGreaterThan(0.16);
    expect(a.kids!).toBeGreaterThan(b.kids!);
    const sum = cohortShares(a).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1, 5);
    age(st, [a, b], 360 * 30);
    console.log(`after 30 years: kids ${a.kids!.toFixed(3)} seniors ${a.srs!.toFixed(3)}`);
    expect(a.srs!).toBeGreaterThan(srs0 * 1.3);
    expect(a.kids!).toBeLessThan(kids0);
    expect(a.kids!).toBeGreaterThan(b.kids!); // pull persists
    // fields are Float32-exact (save / load)
    for (const v of [a.kids!, a.teens!, a.yad!, a.srs!, a.wf!, a.edu!]) expect(Math.fround(v)).toBe(v);
  });

  it('car-less share is highest for poor young / old households', () => {
    const st = newState(16);
    const poor = place(st, 't_r1', 1, 1, { pop: 10, wealth: 1, yad: 0.2, srs: 0.3, kids: 0.1, teens: 0.05 });
    const rich = place(st, 't_r3', 4, 4, { pop: 10, wealth: 3, yad: 0.2, srs: 0.3, kids: 0.1, teens: 0.05 });
    expect(carlessShare(poor)).toBeCloseTo(0.2, 5);
    expect(carlessShare(rich)).toBe(0);
  });
});

describe('demographics: education stock -> EQ, HQ', () => {
  function town(cov: Parameters<typeof setCov>[2]) {
    const st = svcState(32);
    const bs: Building[] = [];
    for (let k = 0; k < 10; k++) bs.push(place(st, 't_r2', 2 + 2 * k, 10, { pop: 50, wealth: 2, age: 0 }));
    for (const b of bs) setCov(st, cellOf(st, b), cov);
    st.stats.eq = 50;
    return { st, bs };
  }

  it('full elementary + high school coverage -> EQ >= 110 by year 20; no schools <= 45; closing schools fades over years', () => {
    const full = town({ elem: 1, high: 1, health: 1 });
    age(full.st, full.bs, 360 * 20, true);
    const eq20 = full.st.stats.eq;
    const none = town({ health: 1 });
    age(none.st, none.bs, 360 * 20, true);
    console.log(`EQ after 20 years: full elementary + high ${eq20.toFixed(1)}, no schools ${none.st.stats.eq.toFixed(1)}`);
    expect(eq20).toBeGreaterThanOrEqual(110);
    expect(none.st.stats.eq).toBeLessThanOrEqual(45);
    // close every school: two years later EQ is still >= 80 % of before
    for (const b of full.bs) setCov(full.st, cellOf(full.st, b), { health: 1 });
    age(full.st, full.bs, 360 * 2, true);
    console.log(`EQ two years after closing all schools: ${full.st.stats.eq.toFixed(1)} (${(full.st.stats.eq / eq20 * 100).toFixed(0)} %)`);
    expect(full.st.stats.eq).toBeGreaterThanOrEqual(0.8 * eq20);
    expect(full.st.stats.eq).toBeLessThan(eq20);
  });

  it('HQ target: health access, pollution, tap water and emergency medicine', () => {
    const base = { patientAccess: 1, air: 0, noise: 0, tapWater: 1, medScore: 1 };
    expect(hqTarget(base)).toBeCloseTo(150, 5);
    expect(hqTarget({ ...base, patientAccess: 0 })).toBeCloseTo(30, 5);
    expect(hqTarget({ ...base, air: 0.5 })).toBeLessThan(hqTarget(base) * 0.85);
    expect(hqTarget({ ...base, tapWater: 0.2 })).toBeLessThan(hqTarget(base) * 0.85);
    expect(hqTarget({ ...base, medScore: 0 })).toBeCloseTo(150 * 0.85, 5);
    // monthly step moves HQ toward the target with a multi-year lag
    const { st, bs } = town({ health: 1 });
    age(st, bs, OCC_PERIOD);
    st.stats.hq = 50;
    expect(updateEqHq(st, bs, 30)).toBe(true);
    expect(st.stats.hq).toBeGreaterThan(50);
    expect(st.stats.hq).toBeLessThan(55);
  });
});

describe('demographics: needs', () => {
  it('penalty is capped; a house without a school is penalised, a senior tower without a school is not', () => {
    const st = svcState(32);
    const house = place(st, 't_r1', 4, 4, { pop: 24, capacity: 24, wealth: 1, age: 0 });
    const senior = place(st, 't_r3', 10, 10, { pop: 300, wealth: 3, kids: 0, teens: 0, yad: 0.05, srs: 0.6 });
    const bare = place(st, 't_r3', 20, 20, { pop: 300, wealth: 3, age: 0 });
    // everything but schools
    const most = { college: 1, health: 1, play: 1, green: 1, shop: 1, transit: 1 };
    setCov(st, cellOf(st, house), most);
    setCov(st, cellOf(st, senior), most);
    setCov(st, cellOf(st, bare), {});
    age(st, [house, bare], OCC_PERIOD);
    const pHouse = needsPenalty(st, house, cellOf(st, house));
    const pSenior = needsPenalty(st, senior, cellOf(st, senior));
    const ev = evaluateNeeds(st, bare, cellOf(st, bare));
    console.log(`needs penalty: house w/o school ${pHouse.toFixed(3)}, senior tower w/o school ${pSenior.toFixed(3)}, nothing at all raw ${ev.raw.toFixed(3)} -> ${ev.penalty}`);
    expect(pHouse).toBeGreaterThan(0.02);
    expect(pSenior).toBe(0);
    expect(ev.raw).toBeGreaterThan(NEEDS_PENALTY_MAX);
    expect(ev.penalty).toBe(NEEDS_PENALTY_MAX);
    expect(ev.unmet).toBe(true);
    expect(evaluateNeeds(st, senior, cellOf(st, senior)).unmet).toBe(false);
    // a school fixes the house
    setCov(st, cellOf(st, house), { ...most, elem: 1, high: 1 });
    expect(needsPenalty(st, house, cellOf(st, house))).toBe(0);
    // needsOf: every need with people / access / met
    setCov(st, cellOf(st, house), most);
    const needs = needsOf(st, house);
    const elem = needs.find((n) => n.kind === 'elementary')!;
    expect(elem.cohort).toBe(0);
    expect(elem.met).toBe(false);
    expect(elem.people).toBeGreaterThan(0);
    expect(needs.find((n) => n.kind === 'health')!.met).toBe(true);
    expect(needsOf(st, senior).some((n) => n.kind === 'elementary')).toBe(false);
    // noisy streets: seniors lose sleep
    st.noise[cellOf(st, senior)] = 0.8;
    expect(needsPenalty(st, senior, cellOf(st, senior))).toBeGreaterThan(0);
    expect(needsOf(st, senior).find((n) => n.kind === 'quiet')!.met).toBe(false);
    // expectations grow with the city: a hamlet does not mind, a 20k town halfway
    st.stats.population = 1000;
    expect(needsPenalty(st, house, cellOf(st, house))).toBe(0);
    expect(evaluateNeeds(st, house, cellOf(st, house)).unmet).toBe(true); // the chip still tells the player
    st.stats.population = 20000;
    const half = needsPenalty(st, house, cellOf(st, house));
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(pHouse);
    st.stats.population = 100000;
    // no services system -> coverage unknown -> no penalty / no report
    const st2 = newState(16);
    const h2 = place(st2, 't_r1', 2, 2, { pop: 12, wealth: 1 });
    expect(needsPenalty(st2, h2, cellOf(st2, h2))).toBe(0);
    expect(needsOf(st2, h2)).toEqual([]);
  });
});

describe('demographics: full simulation', () => {
  /** a small serviced town: road, homes, shops, a school, clinic, plant, pump — economy + infra systems */
  function serviced(withSchool: boolean) {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    roadLine(st, 2, 30, 60, 30, Network.Road);
    roadLine(st, 2, 20, 2, 30, Network.Road);
    roadLine(st, 61, 20, 61, 30, Network.Road);
    const homes: Building[] = [];
    for (let x = 4; x <= 56; x += 2) {
      homes.push(place(st, 't_r1', x, 21, { pop: 10, wealth: 1, age: 0, rot: 2 }));
      homes.push(place(st, 't_r2', x, 19, { pop: 50, wealth: 2, age: 0 }));
    }
    for (let x = 4; x <= 56; x += 2) place(st, 't_cs', x, 29, { jobs: 10 });
    for (const b of st.buildings.values()) {
      const z = b.def === 't_r1' ? Zone.ResLow : b.def === 't_r2' ? Zone.ResMed : Zone.ComLow;
      for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) st.zone[st.idx(xx, zz)] = z;
    }
    if (withSchool) { for (let x = 9; x <= 53; x += 11) place(st, 't_school', x, 21, { flags: BF.Plopped, rot: 2 }); }
    place(st, 't_clinic', 31, 21, { flags: BF.Plopped, rot: 2 });
    place(st, 't_coal', 58, 31, { flags: BF.Plopped, rot: 2 });
    for (let x = 44; x <= 54; x += 2) place(st, 't_tower', x, 31, { flags: BF.Plopped, rot: 2 });
    for (let i = 0; i < st.cells; i++) for (let d = 0; d <= DevType.R3 + 1; d++) st.desirability[d][i] = 0.4;
    const sim = new Simulation(st, createSystems());
    return { st, sim, homes };
  }

  it('fields on every home, workforce = sum pop x wf, cohorts sum to population, NeedsUnmet without schools', { timeout: 120000 }, () => {
    const { st, sim, homes } = serviced(true);
    sim.runDays(40);
    const rt = economyRuntime(sim.systems)!;
    let pop = 0, wf = 0;
    for (const b of st.buildings.values()) {
      const def = getDef(b.def)!;
      if (def.devType === undefined || def.devType > DevType.R3 || b.pop <= 0) continue;
      expect(b.kids).toBeDefined(); expect(b.srs).toBeDefined(); expect(b.wf).toBeDefined(); expect(b.edu).toBeDefined();
      pop += b.pop;
      wf += b.pop * workerShare(b);
    }
    const s = st.stats;
    console.log(`town: pop ${s.population} workforce ${s.workforce} (sum ${wf.toFixed(0)}) ratio ${s.workforceRatio.toFixed(3)} rt ${rt.workforceRatio.toFixed(3)} cohorts ${s.cohorts.join('/')} unemployment ${(s.unemployment * 100).toFixed(1)}%`);
    expect(pop).toBe(s.population);
    expect(Math.abs(s.workforce - wf)).toBeLessThanOrEqual(Math.max(1, wf * 0.01));
    expect(Math.abs(s.cohorts.reduce((a, v) => a + v, 0) - s.population)).toBeLessThanOrEqual(3);
    expect(s.cohortsByWealth.reduce((a, v) => a + v, 0)).toBeGreaterThan(s.population - 10);
    expect(s.workforceRatio).toBeGreaterThan(0.45);
    expect(s.workforceRatio).toBeLessThan(0.65);
    expect(rt.workforceRatio).toBeGreaterThanOrEqual(0.46);
    // businesses post their hiring factor
    const shop = [...st.buildings.values()].find((b) => b.def === 't_cs')!;
    expect(shop.hire).toBeGreaterThan(0.5);
    expect(shop.hire).toBeLessThanOrEqual(1);
    // condition breakdown: terms sum to the (clamped) health target
    const h = homes[3];
    const br = conditionBreakdown(st, h);
    expect(br.terms.length).toBeGreaterThan(0);
    expect(Math.max(0, Math.min(1, sumTerms(br.terms)))).toBeCloseTo(br.target, 5);
    // kids near the schools: NeedsUnmet only where no school reaches
    const flagged = homes.filter((b) => b.flags & BF.NeedsUnmet).length;
    const noSchool = serviced(false);
    noSchool.sim.runDays(40);
    const flagged2 = noSchool.homes.filter((b) => b.flags & BF.NeedsUnmet).length;
    console.log(`NeedsUnmet homes: with schools ${flagged}/${homes.length}, without ${flagged2}/${noSchool.homes.length}`);
    // every apartment block (6+ children) is flagged without a school; houses (2 children) stay below the 3-people bar;
    // with the (elementary) schools only the teens' missing high school still flags some blocks
    expect(flagged2).toBeGreaterThan(flagged);
    expect(flagged2).toBeGreaterThanOrEqual(noSchool.homes.filter((b) => b.def === 't_r2' && b.pop >= 30).length);
    expect(noSchool.homes.filter((b) => b.def === 't_r1' && b.flags & BF.NeedsUnmet).length).toBe(0);
    // a 1,500-resident town does not expect schools yet: no needs penalty in the condition breakdown
    expect(needsExpectation(noSchool.st)).toBe(0);
    expect(conditionBreakdown(noSchool.st, noSchool.homes[3]).terms.some((t) => t.id === 'needs')).toBe(false);
  });
});
