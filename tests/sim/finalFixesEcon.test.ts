/**
 * Final fixes, lane sim-econ: outages empty homes slowly and register in approval (F7); the toxic waste dump costs the
 * whole city (V7); the monthly resident survey is gathered in daily slices (V5).
 */
import { describe, expect, it } from 'vitest';
import { makeCity, road } from './helpers';
import { Network, Zone } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import type { Simulation } from '../../src/sim/Simulation';
import { getDef } from '../../src/sim/catalog';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { conditionBreakdown, outageDays } from '../../src/sim/economy/population';
import { approvalBreakdown, approvalSystem, residentSurvey } from '../../src/sim/economy/approval';
import { attractivenessBreakdown, tourismSystem } from '../../src/sim/economy/tourism';
import { APPROVAL_TERMS, OUTAGE_EXIT_DAYS } from '../../src/sim/economy/tuning';
import { deserializeCity, serializeCity } from '../../src/save/serialize';
import { Simulation as Sim } from '../../src/sim/Simulation';
import { economySystems } from '../../src/sim/systems/economy';
import { demographicsData, eqHqDaily, updateEqHq } from '../../src/sim/economy/demographics';

let nextId = 3_000_000;
/** 92 apartment blocks (2x2, 130 residents each, ~12k residents) on both sides of an edge-to-edge avenue; the utilities
 *  layer is on, so the BF.Powered / BF.Watered flags decide power and water (economy systems only) */
function town() {
  const c = makeCity({ size: 96 });
  road(c.A, 0, 40, 95, 40, Network.Avenue);
  const def = getDef('res_apartment.r2.4')!;
  const homes: Building[] = [];
  for (const [z, rot] of [[38, 0], [41, 2]] as [number, 0 | 2][]) {
    for (let x = 2; x + 2 <= 94; x += 2) {
      const b: Building = {
        id: nextId++, def: def.id, x, z, w: 2, d: 2, rot, variant: 0, pop: 130, jobs: 0, capacity: 130, wealth: 2, built: 1, age: 400,
        flags: BF.Powered | BF.Watered, baseY: 5, health: 0.8, unhappy: 0,
      };
      c.st.nextBuildingId = Math.max(c.st.nextBuildingId, b.id + 1);
      placeBuilding(c.sim, b);
      for (let zz = z; zz < z + 2; zz++) for (let xx = x; xx < x + 2; xx++) c.st.zone[c.st.idx(xx, zz)] = Zone.ResMed;
      homes.push(b);
    }
  }
  c.st.systemData.infraVersion = 1;
  c.st.systemData.infraLayers = { utilities: true, traffic: false, pollution: false, services: false };
  return { ...c, homes };
}
const pop = (homes: Building[]) => homes.reduce((s, b) => s + b.pop, 0);
const runTo = (sim: Simulation, day: number) => { while (sim.state.day < day) sim.advanceDay(); };
const setPower = (homes: Building[], on: boolean) => { for (const b of homes) { if (on) b.flags |= BF.Powered; else b.flags &= ~BF.Powered; } };

describe('final fixes F7: an outage empties homes over weeks, not days, and approval registers it', () => {
  it('a 10-day blackout costs a few % of the residents (not half) and approval drops; a 60-day one empties most homes', { timeout: 300000 }, () => {
    const A = town(), B = town(), C = town();
    for (const t of [A, B, C]) runTo(t.sim, 41);
    const p0 = pop(A.homes);
    // B: every home dark for 10 days (days 41-50); C: for 60 days
    setPower(B.homes, false);
    setPower(C.homes, false);
    for (const t of [A, B, C]) runTo(t.sim, 51);
    // the inspector says why the residents are still there, and the penalty has only ramped in partly
    const br = conditionBreakdown(B.st, B.homes[5]);
    const term = br.terms.find((t) => t.id === 'power')!;
    expect(term.value).toBeLessThan(0);
    expect(term.value).toBeGreaterThan(-0.2);
    expect(term.detail).toMatch(/out for \d+ days: residents wait for the repair/);
    expect(outageDays(B.st, B.homes[5])).toBeGreaterThanOrEqual(5);
    const lossB = 1 - pop(B.homes) / pop(A.homes);
    console.log(`10-day blackout: ${p0} residents -> ${pop(B.homes)} vs ${pop(A.homes)} without it (−${(lossB * 100).toFixed(1)} %)`);
    // (a few %: residents wait for the repair; it used to be half of them)
    expect(lossB).toBeLessThan(0.08);
    expect(lossB).toBeGreaterThan(0.01);
    setPower(B.homes, true);
    // the month tick of day 60: the sliced survey saw a third of the homes dark — approval registers the blackout
    for (const t of [A, B]) runTo(t.sim, 61);
    const tA = econData(A.st).approvalTerms, tB = econData(B.st).approvalTerms;
    console.log(`approval outage term at the month tick after the blackout: ${tB.outages.toFixed(2)} (no blackout ${tA.outages.toFixed(2)})`);
    expect(tB.outages).toBeLessThan(tA.outages - 3);
    expect(approvalBreakdown(B.st).find((t) => t.id === 'outages')!.detail).toMatch(/residents without power/);
    // the outage records are gone once the power is back
    expect(outageDays(B.st, B.homes[5])).toBe(-1);
    // C: 60 days dark — residents do leave
    runTo(C.sim, 101);
    runTo(A.sim, 101);
    const lossC = 1 - pop(C.homes) / pop(A.homes);
    console.log(`60-day blackout: −${(lossC * 100).toFixed(1)} %`);
    expect(lossC).toBeGreaterThan(0.4);
    // the full penalty after OUTAGE_EXIT_DAYS
    expect(conditionBreakdown(C.st, C.homes[5]).terms.find((t) => t.id === 'power')!.value).toBeCloseTo(-0.55, 1);
    void OUTAGE_EXIT_DAYS;
  });

  it('a home that never had power does not fill up (the slow exit only slows residents who are leaving)', { timeout: 120000 }, () => {
    const t = town();
    for (const b of t.homes) { b.pop = 0; b.flags &= ~BF.Powered; }
    runTo(t.sim, 40);
    // (× 0.25 occupancy cut without power, as before)
    for (const b of t.homes) expect(b.pop).toBeLessThanOrEqual(Math.ceil(0.25 * b.capacity));
  });
});

describe('final fixes V7: the toxic waste dump costs the whole city, wherever it stands', () => {
  it('in an empty corner: §4,000 a month, but approval −3 and a quarter of the clean-air image', { timeout: 120000 }, () => {
    const run = (dump: boolean) => {
      const t = town();
      if (dump) {
        const def = getDef('rw_toxic_dump')!;
        const b: Building = {
          id: nextId++, def: def.id, x: 90, z: 2, w: def.footprint[0], d: def.footprint[1], rot: 0, variant: 0, pop: 0, jobs: 0,
          capacity: def.jobs ?? 0, wealth: 2, built: 1, age: 0, flags: BF.Plopped | BF.Powered | BF.Watered, baseY: 5, health: 1, unhappy: 0,
        };
        t.st.nextBuildingId = Math.max(t.st.nextBuildingId, b.id + 1);
        placeBuilding(t.sim, b);
      }
      runTo(t.sim, 61);
      return t;
    };
    const base = run(false), dump = run(true);
    const T = econData(dump.st).approvalTerms;
    expect(T.toxicDump).toBe(APPROVAL_TERMS.toxicDump);
    expect(econData(base.st).approvalTerms.toxicDump ?? 0).toBe(0);
    expect(approvalBreakdown(dump.st).find((t) => t.id === 'toxicDump')!.label).toBe('Hosting a toxic waste dump');
    expect(dump.st.budget.lastIncome['deal:rw_toxic_dump']).toBe(4000);
    const clean = (st: typeof base.st) => attractivenessBreakdown(st).find((t) => t.id === 'clean')!;
    expect(clean(dump.st).value).toBeLessThan(clean(base.st).value * (1 - APPROVAL_TERMS.dumpImage) + 0.5);
    expect(clean(dump.st).detail).toMatch(/toxic waste dump/);
    expect(econData(dump.st).attractiveness).toBeLessThan(econData(base.st).attractiveness - 2);
    expect(dump.st.stats.approval).toBeLessThan(base.st.stats.approval - 1);
    expect(getDef('rw_toxic_dump')!.description).toMatch(/whole city dislikes hosting it/);
  });
});

describe('final fixes V5: the monthly resident survey is gathered in daily slices', () => {
  it('a steady city: the sliced month survey equals one full pass; a save mid-month continues the same sums', { timeout: 120000 }, () => {
    const t = town();
    runTo(t.sim, 20);
    // a second simulation of the same state that runs only the approval system: nothing moves the homes, so the slices
    // and a full pass see the same city
    const rt = new EconRuntime();
    const solo = new Sim(t.st, [approvalSystem(rt)]);
    t.homes[3].flags &= ~BF.Powered; // one dark home: the outage shares are sampled too
    let sliced: ReturnType<typeof residentSurvey> | null = null;
    const off = solo.events.on('month', () => { sliced = residentSurvey(t.st, rt); });
    runTo(solo, 90);
    off();
    expect(sliced).not.toBeNull();
    t.st.day++;
    const full = residentSurvey(t.st, rt);
    t.st.day--;
    const s = sliced!;
    expect(s.pop[3]).toBe(full.pop[3]);
    expect(s.unpowered[3]).toBeGreaterThan(0);
    for (const k of ['noise', 'crime', 'air', 'park', 'unpowered', 'unwatered'] as const) expect(Math.abs(s[k][3] - full[k][3])).toBeLessThan(1e-9);
    expect(Math.abs(s.commute - full.commute)).toBeLessThan(1e-9);
    // save on day 75 of a running city, load, continue: the day-90 approval terms equal the uninterrupted run's
    const u = town();
    runTo(u.sim, 75);
    const st2 = deserializeCity(serializeCity(u.st, { copy: true }));
    const sim2 = new Sim(st2, economySystems());
    runTo(u.sim, 90);
    runTo(sim2, 90);
    const a = econData(u.st).approvalTerms, b = econData(st2).approvalTerms;
    for (const k of ['noise', 'outages', 'garbage', 'crime', 'pollution']) expect(b[k] ?? 0).toBeCloseTo(a[k] ?? 0, 9);
  });

  it('EQ / HQ: the homes read in daily slices give the step of one full pass, across a save mid-month', { timeout: 120000 }, () => {
    const make = () => {
      const t = town();
      t.homes.forEach((b, k) => { b.edu = 0.2 + 0.01 * (k % 50); });
      for (let i = 0; i < t.st.cells; i++) { t.st.healthCov[i] = (i % 7) / 7; t.st.airPollution[i] = (i % 5) / 10; t.st.noise[i] = (i % 3) / 6; }
      t.st.stats.eq = 50; t.st.stats.hq = 60;
      return t;
    };
    // full pass on day 55 (the step day 25 + 30)
    const F = make();
    F.st.day = 55;
    expect(updateEqHq(F.st, F.homes, 30)).toBe(true);
    // daily slices from day 26: nothing moves until the step day, then the same step
    const S = make();
    let st = S.st;
    for (let day = 26; day <= 55; day++) {
      st.day = day;
      if (day === 40) st = deserializeCity(serializeCity(st, { copy: true })); // a save mid-month continues the sums
      const homes = S.homes.map((b) => st.buildings.get(b.id)!);
      const r = eqHqDaily(st, homes, 25, 30);
      if (day < 55) { expect(r).toBeNull(); expect(st.stats.eq).toBe(50); }
      else expect(r).toBe(true);
    }
    expect(st.stats.eq).not.toBe(50);
    // (a save stores b.edu in float32: the sums of the loaded half differ in the 8th digit)
    expect(st.stats.eq).toBeCloseTo(F.st.stats.eq, 6);
    expect(st.stats.hq).toBeCloseTo(F.st.stats.hq, 6);
    expect(demographicsData(st).eqhq!.done).toBe(0);
    // a city whose slices are incomplete on the step day (new / loaded) takes the full pass
    const L = make();
    L.st.day = 55;
    expect(eqHqDaily(L.st, L.homes, 25, 30)).toBe(true);
    expect(L.st.stats.eq).toBe(F.st.stats.eq);
    expect(L.st.stats.hq).toBe(F.st.stats.hq);
  });

  it('tourism: the hotel rooms and historic sites gathered in daily slices equal one full pass', { timeout: 120000 }, () => {
    // two copies of a steady city (only the tourism system runs); B loses its slices on day 59, so its day-60 month
    // tick takes the full pass
    const make = () => {
      const t = town();
      const hdef = getDef('com_hotel.cs1.5')!;
      for (let k = 0; k < 6; k++) {
        const b: Building = {
          id: nextId++, def: hdef.id, x: 4 + k * 10, z: 60, w: hdef.footprint[0], d: hdef.footprint[1], rot: 0, variant: 0, pop: 0,
          jobs: 150 + k, capacity: hdef.capacity ?? 200, wealth: 2, built: 1, age: 400, flags: BF.Powered | BF.Watered, baseY: 5,
          health: 1, unhappy: 0,
        };
        t.st.nextBuildingId = Math.max(t.st.nextBuildingId, b.id + 1);
        placeBuilding(t.sim, b);
      }
      for (const k of [7, 30, 61]) t.homes[k].flags |= BF.Historic;
      const solo = new Sim(t.st, [tourismSystem(new EconRuntime())]);
      return { ...t, solo };
    };
    const A = make(), B = make();
    runTo(A.solo, 60);
    runTo(B.solo, 59);
    delete B.st.systemData.tourismAcc;
    runTo(B.solo, 60);
    expect(A.st.stats.hotelRooms).toBe(Math.round(1.5 * (150 + 151 + 152 + 153 + 154 + 155)));
    expect(B.st.stats.hotelRooms).toBe(A.st.stats.hotelRooms);
    const dA = econData(A.st), dB = econData(B.st);
    expect(dA.touristsGross).toBeGreaterThan(0);
    expect(dB.touristsGross).toBeCloseTo(dA.touristsGross ?? 0, 9);
    expect(dB.tourists).toBeCloseTo(dA.tourists, 9);
    // the visitor raster around a historic home matches too
    const i = (A.homes[30].z + 1) * A.st.size + A.homes[30].x + 1;
    expect(A.st.visitors[i]).toBeGreaterThan(0);
    expect(B.st.visitors[i]).toBeCloseTo(A.st.visitors[i], 6);
    // the slices start over after the tick
    expect((A.st.systemData.tourismAcc as { done: number }).done).toBe(0);
  });
});
