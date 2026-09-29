/**
 * WP5 history (SIM_DEPTH_SPEC §F, docs/SIM_DEPTH_PART_B.md item 32): every new series is written monthly with the
 * documented definition, series stay aligned with t (old saves are zero-padded), and the cap drops months evenly.
 */
import { describe, expect, it } from 'vitest';
import { HISTORY_KEYS, emptyHistory, type HistorySeries } from '../../src/sim/CityState';
import { HISTORY_CAP, recordHistory, servedShare, utilityMargin } from '../../src/sim/economy/history';
import { newState } from '../infra/cityGen';

function statsCity() {
  const st = newState(16);
  const s = st.stats;
  s.population = 700;
  s.cohorts = [100, 50, 60, 400, 90];
  s.unemployment = 0.07;
  s.avgCommute = 22.5;
  s.avgNoise = 0.2;
  s.avgAir = 0.3;
  s.avgWaterPollution = 0.1;
  s.garbageProduced = 800;
  s.garbageCapacity = 1000;
  s.powerSupply = 120;
  s.powerDemand = 100;
  s.waterSupply = 50;
  s.waterDemand = 100;
  s.tourists = 1234;
  s.attractiveness = 56.7;
  s.needs.elementary = { need: 1000, served: 850, capacity: 900, unreached: 60, overcrowded: 0 };
  s.needs.high = { need: 0, served: 0, capacity: 0, unreached: 0, overcrowded: 0 };
  s.needs.college = { need: 400, served: 100, capacity: 100, unreached: 200, overcrowded: 0 };
  s.needs.health = { need: 800, served: 800, capacity: 2000, unreached: 0, overcrowded: 0 };
  const lm = s.emergency.lastMonth;
  lm.count.fire = 3;
  lm.count.medical = 2;
  lm.responseMin.fire = 12;
  lm.responses.fire = 3;
  lm.responseMin.medical = 8;
  lm.responses.medical = 2;
  lm.deaths = 1;
  s.justice.occupancy = 0.9;
  s.transitFleet.buses = 4;
  s.transitFleet.busesNeeded = 6;
  s.transitFleet.parkRide = 320;
  return st;
}

const last = (h: HistorySeries, k: keyof HistorySeries) => h[k][h[k].length - 1];

describe('history: SIM_DEPTH_SPEC series', () => {
  it('writes every new series with its definition', () => {
    const st = statsCity();
    recordHistory(st);
    const h = st.history;
    for (const k of HISTORY_KEYS) expect(h[k].length, k).toBe(1);
    expect([last(h, 'kids'), last(h, 'teens'), last(h, 'youngAdults'), last(h, 'adults'), last(h, 'seniors')]).toEqual([100, 50, 60, 400, 90]);
    expect(last(h, 'unemployment')).toBe(0.07);
    expect(last(h, 'commute')).toBe(22.5);
    expect([last(h, 'noise'), last(h, 'air'), last(h, 'waterPoll')]).toEqual([0.2, 0.3, 0.1]);
    expect(last(h, 'garbageLoad')).toBe(0.8);
    expect(last(h, 'powerMargin')).toBe(0.2);
    expect(last(h, 'waterMargin')).toBe(-0.5);
    expect(last(h, 'tourists')).toBe(1234);
    expect(last(h, 'attractiveness')).toBe(56.7);
    expect(last(h, 'enrolElem')).toBe(0.85);
    expect(last(h, 'enrolHigh')).toBe(0); // no need -> 0
    expect(last(h, 'enrolCollege')).toBe(0.25);
    expect(last(h, 'healthServed')).toBe(1);
    expect(last(h, 'incidents')).toBe(5);
    expect(last(h, 'responseMin')).toBe(4); // (12 + 8) / (3 + 2)
    expect(last(h, 'emergencyDeaths')).toBe(1);
    expect(last(h, 'jailOccupancy')).toBe(0.9);
    expect(last(h, 'busLoad')).toBe(1.5);
    expect(last(h, 'parkRide')).toBe(320);
  });

  it('pure helpers: margins clamp to -1..1, served share is 0 without need', () => {
    expect(utilityMargin(0, 0)).toBe(0);
    expect(utilityMargin(500, 100)).toBe(1);
    expect(utilityMargin(0, 100)).toBe(-1);
    expect(utilityMargin(NaN, 100)).toBe(-1);
    expect(servedShare(undefined)).toBe(0);
    expect(servedShare({ need: 0, served: 5, capacity: 0, unreached: 0, overcrowded: 0 })).toBe(0);
    expect(servedShare({ need: 10, served: 12, capacity: 20, unreached: 0, overcrowded: 0 })).toBe(1);
  });

  it('old saves: missing series are zero-padded to t, then continue with real values', () => {
    const st = statsCity();
    const h = emptyHistory();
    // a pre-spec save: only the legacy series, 3 months long
    const legacy = ['t', 'pop', 'funds', 'income', 'expense', 'r', 'c', 'i', 'landValue', 'crime', 'pollution', 'traffic', 'eq', 'hq', 'approval'] as const;
    for (const k of legacy) h[k].push(1, 2, 3);
    const rec = h as unknown as Record<string, number[] | undefined>;
    for (const k of HISTORY_KEYS) if (!(legacy as readonly string[]).includes(k)) delete rec[k];
    st.history = h;
    recordHistory(st);
    for (const k of HISTORY_KEYS) expect(st.history[k].length, k).toBe(4);
    expect(st.history.kids).toEqual([0, 0, 0, 100]);
    expect(st.history.incidents).toEqual([0, 0, 0, 5]);
    expect(st.history.pop[3]).toBe(700);
  });

  it('the cap drops the oldest months of every series alike', () => {
    const st = statsCity();
    for (let m = 0; m < HISTORY_CAP + 5; m++) {
      st.day = m * 30;
      st.stats.tourists = m;
      recordHistory(st);
    }
    for (const k of HISTORY_KEYS) expect(st.history[k].length, k).toBe(HISTORY_CAP);
    expect(st.history.tourists[0]).toBe(5);
    expect(st.history.t[0]).toBe(5);
  });
});
