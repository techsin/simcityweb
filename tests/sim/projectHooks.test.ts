import { describe, expect, it } from 'vitest';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import type { ProjectKind } from '../../src/sim/catalogTypes';
import { completedProject, expoDrawMultiplier, type ProjectProgress, type ProjectsData } from '../../src/sim/economy/projects';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { tourismSystem, venueVisits } from '../../src/sim/economy/tourism';
import { STOP_CAP_SUBWAY, SUBWAY_TIME, WAIT_SUBWAY } from '../../src/sim/infra/params';
import { Transit } from '../../src/sim/infra/common';
import { TrafficSystem } from '../../src/sim/infra/traffic';
import { newState, place } from '../infra/cityGen';

function project(st: CityState, kind: ProjectKind, completedDay?: number): { b: Building; p: ProjectProgress } {
  const b = place(st, 't_park', 24, 24, { flags: BF.Plopped });
  const p: ProjectProgress = {
    buildingId: b.id, def: b.def, kind, totalCost: 1_500_000, totalDays: 540,
    progressDays: 540, paid: 1_500_000, paidDays: 540, lastPaymentMonth: st.monthIndex,
    paused: false, startedDay: 0, completedDay,
  };
  st.systemData.projects = { v: 1, items: [p] } satisfies ProjectsData;
  return { b, p };
}

interface TransitFields {
  rebuildGraphs(st: CityState): void;
  prepTransit(st: CityState): void;
  baseWait(s: number): number;
  tnet: { subTime: number };
  stops: { n: number; mode: Uint8Array; bid: Int32Array };
  stWait: Float32Array;
  stWaitPr: Float32Array;
  stLoadPrev: Map<number, number>;
  stPrPrev: Map<number, number>;
}

function metro() {
  const st = newState(32);
  for (let x = 2; x <= 28; x++) st.subway[st.idx(x, 16)] = 1;
  const a = place(st, 't_subway', 2, 16), b = place(st, 't_subway', 28, 16);
  // Read the actual assignment snapshot: time, base wait, and the crowding calculation used by both transit paths.
  const t = new TrafficSystem() as unknown as TransitFields;
  for (const station of [a, b]) {
    t.stLoadPrev.set(station.id, STOP_CAP_SUBWAY);
    t.stPrPrev.set(station.id, 3000);
  }
  t.rebuildGraphs(st);
  const snapshot = () => {
    t.prepTransit(st);
    const s = Array.from(t.stops.mode.subarray(0, t.stops.n)).findIndex((m) => m === Transit.Subway);
    expect(s).toBeGreaterThanOrEqual(0);
    return { time: t.tnet.subTime, wait: t.baseWait(s), crowded: t.stWait[s], parkRide: t.stWaitPr[s] };
  };
  return { st, snapshot };
}

describe('mega-project infrastructure hooks', () => {
  it('Express Metro changes all three subway parameters only after the project opens', () => {
    const m = metro();
    const normal = m.snapshot();
    expect(normal.time).toBe(SUBWAY_TIME);
    expect(normal.wait).toBe(WAIT_SUBWAY);
    expect(normal.crowded).toBe(7);
    const { b, p } = project(m.st, 'expressMetro');
    expect(m.snapshot()).toEqual(normal);
    p.completedDay = 540;
    b.built = Math.fround(539 / 540);
    b.flags |= BF.Constructing;
    expect(m.snapshot()).toEqual(normal);
    b.built = 1;
    b.flags &= ~BF.Constructing;
    const express = m.snapshot();
    expect(express.time).toBe(SUBWAY_TIME * 0.7);
    expect(express.wait).toBe(2.5);
    expect(express.crowded).toBeCloseTo(2.5 * (1 + (9000 / 13500) ** 2), 6);
    expect(express.parkRide).toBeCloseTo(2.5 * (1 + (6000 / 13500) ** 2), 6);
    b.flags |= BF.Burnt;
    expect(m.snapshot()).toEqual(normal);
  });

  it('keeps the Express Metro benefit in its city and drops it when its building is removed', () => {
    const a = metro(), b = metro();
    const normal = b.snapshot();
    const done = project(a.st, 'expressMetro', 540);
    expect(a.snapshot().wait).toBe(2.5);
    expect(b.snapshot()).toEqual(normal);
    expect(completedProject(a.st, 'expressMetro')).toBe(true);
    a.st.buildings.delete(done.b.id);
    expect(a.snapshot()).toEqual(normal);
    expect(b.snapshot()).toEqual(normal);
    expect(b.st.systemData.projects).toBeUndefined();
  });
});

describe('World Expo tourism hook', () => {
  it('multiplies citywide venue draw for exactly twelve months after opening', () => {
    const st = newState(32);
    const venue = place(st, 'park_plaza', 4, 4, { flags: BF.Plopped });
    const done = project(st, 'expo', 100);
    const tourism = tourismSystem(new EconRuntime());
    const sim = new Simulation(st, [tourism]);
    st.stats.population = 100_000;
    const gross = (day: number) => {
      st.day = day;
      econData(st).attractiveness = 60;
      tourism.refresh(sim);
      return venueVisits(st, venue.id)!.gross;
    };
    const normal = gross(99);
    expect(normal).toBeGreaterThan(0);
    expect(expoDrawMultiplier(st)).toBe(1);
    expect(gross(100)).toBeCloseTo(normal * 1.5, 10);
    expect(gross(459)).toBeCloseTo(normal * 1.5, 10);
    expect(gross(460)).toBe(normal);
    st.day = 200;
    done.b.flags |= BF.Constructing;
    expect(expoDrawMultiplier(st)).toBe(1);
    done.b.flags &= ~BF.Constructing;
    st.buildings.delete(done.b.id);
    expect(expoDrawMultiplier(st)).toBe(1);
  });

  it('does not create project state while reading an old city', () => {
    const st = newState(16);
    expect(completedProject(st, 'expressMetro')).toBe(false);
    expect(expoDrawMultiplier(st)).toBe(1);
    expect(st.systemData.projects).toBeUndefined();
  });
});
