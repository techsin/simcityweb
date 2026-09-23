/**
 * SIM_DEPTH_SPEC Phase 0 contract: new state / stats / history / flags / enums exist with neutral defaults, stubs
 * return legacy or neutral values, the system order is fixed, and the new Simulation timing API is headless-neutral.
 */
import { describe, expect, it } from 'vitest';
import { Overlay } from '../../src/core/types';
import { SECONDS_PER_DAY } from '../../src/core/constants';
import {
  BF, HISTORY_KEYS, INCIDENT_KINDS, NEED_TIERS, RESPONDERS, defaultStats, emptyEmergencyMonth, emptyHistory, padHistory,
} from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { ordinanceEffect } from '../../src/sim/economy/ordinances';
import { COHORT_BASE, WORKFORCE_RATIO } from '../../src/sim/economy/tuning';
import { cohortShares, householdForm, needsOf, needsPenalty, profileShares, waterRequired, workerShare } from '../../src/sim/economy/demographics';
import { ATTRACTIONS, attractivenessBreakdown, tourismTrips, venueVisits } from '../../src/sim/economy/tourism';
import { conditionBreakdown } from '../../src/sim/economy/population';
import { approvalBreakdown } from '../../src/sim/economy/approval';
import { econData } from '../../src/sim/economy/runtime';
import { facilityLoad, reachCells, newReachScratch, tierLayer, unservedClusters } from '../../src/sim/infra/catchments';
import { facilityOpFactor, facilityReport, facilityUseFactor } from '../../src/sim/infra/facilities';
import { justiceFactors } from '../../src/sim/infra/justice';
import { FLEET, emergencyCrimeBoosts, emergencyOf, emergencyPollution, responseAt, uncoveredHotspots } from '../../src/sim/infra/emergency';
import { waterQualityAt } from '../../src/sim/infra/utilities';
import { getTraffic } from '../../src/sim/systems/infra';
import { createSystems } from '../../src/sim/systems/index';
import { economySystems } from '../../src/sim/systems/economy';
import { newSim, newState, place, roadLine } from '../infra/cityGen';

describe('Phase 0 contract: state', () => {
  it('BF flags are distinct single bits', () => {
    const vals = Object.values(BF);
    expect(new Set(vals).size).toBe(vals.length);
    for (const v of vals) expect(v & (v - 1)).toBe(0);
    expect([BF.Noisy, BF.NeedsUnmet, BF.Incident, BF.Understaffed]).toEqual([1 << 14, 1 << 15, 1 << 16, 1 << 17]);
  });

  it('Overlay enum appends the new data views', () => {
    expect([Overlay.Parks, Overlay.Commute, Overlay.Shops, Overlay.Demographics, Overlay.Tourism, Overlay.Nimby, Overlay.Soil, Overlay.Emergency, Overlay.Parking])
      .toEqual([17, 18, 19, 20, 21, 22, 23, 24, 25]);
  });

  it('new layers are zeroed Float32 arrays', () => {
    const st = newState(32);
    for (const k of ['eduElemCov', 'eduHighCov', 'eduCollegeCov', 'playCov', 'greenCov', 'shopAccess', 'stigma', 'prestige', 'campus',
      'accessCommute', 'treeCover', 'soil', 'landfillFill', 'visitors', 'respFire', 'respPolice', 'respMedical', 'parking']) {
      const a = (st as unknown as Record<string, Float32Array>)[k];
      expect(a, k).toBeInstanceOf(Float32Array);
      expect(a.length).toBe(st.cells);
      expect(a.every((v) => v === 0)).toBe(true);
    }
  });

  it('defaultStats has neutral defaults for every new field', () => {
    const s = defaultStats();
    expect(s.workforceRatio).toBe(WORKFORCE_RATIO);
    expect(s.tapWater).toBe(1);
    expect(s.cohorts).toEqual([0, 0, 0, 0, 0]);
    expect(s.cohortsByWealth.length).toBe(15);
    for (const t of NEED_TIERS) expect(s.needs[t]).toEqual({ need: 0, served: 0, capacity: 0, unreached: 0, overcrowded: 0 });
    expect(s.emergency.medScore).toBe(1);
    expect(s.emergency.month).toEqual(emptyEmergencyMonth());
    for (const k of INCIDENT_KINDS) expect(s.emergency.lastMonth.count[k]).toBe(0);
    for (const r of RESPONDERS) expect(s.emergency.year.responses[r]).toBe(0);
    expect(s.justice.policeMul).toBe(1);
    expect(s.justice.crimeMul).toBe(1);
    expect(s.transitFleet.buses).toBe(0);
    // independent instances
    const s2 = defaultStats();
    s2.needs.elementary.need = 5;
    s2.emergency.month.deaths = 3;
    expect(s.needs.elementary.need).toBe(0);
    expect(s.emergency.month.deaths).toBe(0);
  });

  it('history: every key exists and padHistory aligns short series with t', () => {
    const h = emptyHistory();
    for (const k of HISTORY_KEYS) expect(h[k]).toEqual([]);
    h.t.push(1, 2, 3);
    h.pop.push(10, 20, 30);
    padHistory(h);
    for (const k of HISTORY_KEYS) expect(h[k].length).toBe(3);
    expect(h.pop).toEqual([10, 20, 30]);
    expect(h.incidents).toEqual([0, 0, 0]);
  });

  it('econData defaults the new fields (also on old saves)', () => {
    const st = newState(16);
    const d = econData(st);
    expect(d.migration).toEqual([1, 1, 1]);
    expect(d.approvalTerms).toEqual({});
    const old = d as unknown as Record<string, unknown>;
    delete old.migration;
    delete old.attractTerms;
    const d2 = econData(st);
    expect(d2.migration).toEqual([1, 1, 1]);
    expect(d2.attractTerms).toEqual({});
  });
});

describe('Phase 0 contract: stubs are neutral', () => {
  it('demographics', () => {
    const st = newState(32);
    const b = place(st, 't_r2', 4, 4, { pop: 40, wealth: 2 });
    expect(Array.from(cohortShares(b))).toEqual(Array.from(new Float32Array(COHORT_BASE)));
    expect(Array.from(profileShares('tower', 3))).toEqual(Array.from(new Float32Array(COHORT_BASE)));
    expect(workerShare(b)).toBe(WORKFORCE_RATIO);
    expect(workerShare({ ...b, wf: 0.6 })).toBe(0.6);
    expect(needsOf(st, b)).toEqual([]);
    expect(needsPenalty(st, b, 0)).toBe(0);
    expect(householdForm(undefined, undefined)).toBe('house');
    expect(householdForm({ id: 'x', name: 'x', model: 'x', category: 'growable', footprint: [1, 1], stage: 7 })).toBe('tower');
    expect(typeof waterRequired(st, b)).toBe('boolean');
  });

  it('catchments / facilities / tourism / breakdowns', () => {
    const st = newState(32);
    const sim = newSim(st);
    const b = place(st, 't_school', 4, 4);
    expect(tierLayer(st, 'elementary')).toBe(st.eduElemCov);
    expect(tierLayer(st, 'health')).toBe(st.healthCov);
    expect(tierLayer(st, 'police')).toBe(st.policeCov);
    expect(facilityLoad(sim, b.id)).toBeNull();
    expect(unservedClusters(sim, 'elementary')).toEqual([]);
    expect(reachCells(st, 4, 4, 1, 1, 10, 'walk', newReachScratch(st.cells))).toBe(0);
    expect(facilityReport(sim, b.id)).toBeNull();
    expect(facilityOpFactor(st, b)).toBe(1);
    expect(facilityUseFactor(st, b)).toBe(1);
    expect(Object.keys(ATTRACTIONS).length).toBe(0);
    expect(venueVisits(st, b.id)).toBeNull();
    expect(attractivenessBreakdown(st)).toEqual([]);
    expect(tourismTrips(st)).toEqual([]);
    expect(approvalBreakdown(st)).toEqual([]);
    expect(conditionBreakdown(st, b)).toEqual({ terms: [], target: b.health, abandonInDays: null });
    expect(waterQualityAt(sim, 0)).toBe(1);
  });

  it('justiceFactors reproduces the legacy jail rule', () => {
    const st = newState(32);
    st.stats.population = 20000;
    expect(justiceFactors(st)).toEqual({ policeMul: 1, crimeMul: 1 });
    st.stats.population = 30000;
    expect(justiceFactors(st).policeMul).toBe(0.75);
    place(st, 'civ_jail', 10, 10);
    expect(justiceFactors(st).policeMul).toBe(1);
  });

  it('emergency stub is inert and fire keeps the legacy path', () => {
    const st = newState(32);
    const sim = newSim(st);
    const em = emergencyOf(sim)!;
    expect(em).toBeDefined();
    expect(em.active).toBe(false);
    const b = place(st, 't_r1', 5, 5);
    expect(em.onFire(sim, b, false)).toBe(false);
    expect(em.incidents()).toEqual([]);
    expect(em.vehicles()).toEqual([]);
    expect(em.spawn(sim, 'medical', 5, 5)).toBe(-1);
    expect(em.dispatch(sim, 1, b.id).ok).toBe(false);
    expect(responseAt(sim, 0, 'fire')).toBeNull();
    expect(uncoveredHotspots(sim, 'fire')).toEqual([]);
    expect(emergencyPollution(sim)).toEqual([]);
    expect(emergencyCrimeBoosts(sim)).toEqual([]);
    expect(FLEET.civ_fire_station).toEqual({ responder: 'fire', units: 2 });
    expect(em.stats(sim)).toBe(st.stats.emergency);
  });

  it('new ordinance keys are inert multipliers until consumed', () => {
    const st = newState(16);
    expect(ordinanceEffect(st, 'tourism.draw')).toBe(1);
    expect(ordinanceEffect(st, 'power.nuclear')).toBe(1);
    st.budget.ordinances.push('tourism_promotion', 'nuclear_free_zone');
    expect(ordinanceEffect(st, 'tourism.draw')).toBe(1.2);
    expect(ordinanceEffect(st, 'power.nuclear')).toBe(0);
  });
});

describe('Phase 0 contract: systems and simulation', () => {
  it('system order: infra (emergency after fire, justice last) then economy (tourism after population)', () => {
    const names = createSystems().map((s) => s.name);
    expect(names.slice(0, 9)).toEqual(['utilities', 'traffic', 'pollution', 'services', 'crime', 'fire', 'emergency', 'disasters', 'justice']);
    const eco = economySystems().map((s) => s.name);
    expect(eco.indexOf('economy.tourism')).toBe(eco.indexOf('economy.population') + 1);
    expect(eco.indexOf('economy.demand')).toBe(eco.indexOf('economy.tourism') + 1);
  });

  it('liveSlowdown only slows real-time pacing at speed 1; dayFraction / simTime interpolate', () => {
    const st = newState(16);
    const sim = new Simulation(st, []);
    sim.speed = 1;
    const spd = SECONDS_PER_DAY[1]; // 0.5 s
    sim.update(0.2);
    expect(st.day).toBe(0);
    expect(sim.dayFraction).toBeCloseTo(0.2 / spd, 5);
    expect(sim.simTime()).toBeCloseTo(0.2 / spd, 5);
    sim.update(0.2);
    sim.update(0.2); // 0.6 s >= 0.5 s: one day, 0.1 s carried
    expect(st.day).toBe(1);
    sim.liveSlowdown = 3;
    expect(sim.secondsPerDay()).toBeCloseTo(spd * 3, 9);
    for (let k = 0; k < 6; k++) sim.update(0.2); // 0.1 + 1.2 s < 1.5 s: still day 1
    expect(st.day).toBe(1);
    expect(sim.dayFraction).toBeCloseTo(1.3 / 1.5, 4);
    sim.update(0.2);
    expect(st.day).toBe(2);
    const d0 = st.day;
    sim.speed = 2;
    expect(sim.secondsPerDay()).toBe(SECONDS_PER_DAY[2]);
    sim.speed = 0;
    expect(sim.dayFraction).toBe(0);
    sim.runDays(5); // headless: unaffected
    expect(st.day).toBe(d0 + 5);
  });

  it('traffic exposes nodeTimes / graphVersion for other systems\' road searches', () => {
    const st = newState(32);
    roadLine(st, 2, 10, 28, 10);
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    tr.invalidate();
    tr.runCycleSync(sim);
    expect(tr.graphVersion).toBe(tr.road.version);
    expect(tr.nodeTimes.length).toBe(tr.road.n);
    expect(tr.nodeTimes[0]).toBeGreaterThan(0);
  });
});
