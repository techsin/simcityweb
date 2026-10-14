/**
 * Final fixes round 2, lane sim-feedback, SF-1: the facility report's memos (does the road reach homes, the fill of
 * employers of a size, the people in a facility's reach) are keyed by the city itself. Before, peerMemo held the
 * CityState strongly — a city the player left stayed in memory with its whole simulation (≈130 MB at 1M) — and the
 * homes / reach memos were keyed by building id only, so a second city with the same building id and day read the first
 * city's answer.
 */
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import { facilityReport } from '../../src/sim/infra/facilities';
import { justiceData } from '../../src/sim/infra/justice';
import { newSim, newState, place, roadLine } from './cityGen';

/** a road along z = 20 with a staffed school at (5, 21) placed FIRST (so it has the same id in every test city) */
function schoolTown(opts: { homes: number; shopJobs?: number }) {
  const st = newState(64);
  roadLine(st, 2, 20, 60, 20, Network.Road);
  const school = place(st, 'civ_elementary_school', 5, 21, { flags: BF.Plopped | BF.Powered | BF.Watered, age: 100 });
  for (let k = 0; k < opts.homes; k++) { st.zone[st.idx(30 + k, 21)] = Zone.ResLow; place(st, 't_r1', 30 + k, 21, { pop: 10 }); }
  // three shops of the school's size (the peers of its staffing)
  if (opts.shopJobs !== undefined) for (let k = 0; k < 3; k++) place(st, 't_cs', 52 + k, 21, { capacity: 40, jobs: opts.shopJobs, hire: 1, flags: BF.Powered | BF.Watered });
  const sim = newSim(st);
  school.hire = 1;
  school.capacity = 40;
  school.jobs = 8;
  st.stats.workforce = 500;
  justiceData(st).cityFill = 0.9;
  return { st, sim, school };
}
const staffHint = (t: ReturnType<typeof schoolTown>) => facilityReport(t.sim, t.school.id)!.lines.find((l) => l.key === 'staff')?.hint ?? '';

/** a clinic at (10, 21) placed FIRST, `homes` homes of 10 residents along the road next to it */
function clinicTown(homes: number) {
  const st = newState(64);
  roadLine(st, 2, 20, 60, 20, Network.Road);
  const clinic = place(st, 'civ_clinic', 10, 21, { flags: BF.Plopped | BF.Powered | BF.Watered, age: 100 });
  for (let k = 0; k < homes; k++) { st.zone[st.idx(12 + k, 21)] = Zone.ResLow; place(st, 't_r1', 12 + k, 21, { pop: 10 }); }
  return { st, sim: newSim(st), clinic };
}

describe('SF-1: the report memos belong to their city', () => {
  it('two cities with the same building id and day get their own "road reaches homes" answer', () => {
    const a = schoolTown({ homes: 20 });
    const b = schoolTown({ homes: 0 });
    expect(a.school.id).toBe(b.school.id);
    expect(a.st.day).toBe(b.st.day);
    expect(staffHint(a)).not.toMatch(/doesn't connect to any homes/);
    // (city a's memo for this building id and day must not answer for city b)
    expect(staffHint(b)).toMatch(/its road doesn't connect to any homes/);
    expect(staffHint(a)).not.toMatch(/doesn't connect to any homes/);
  });

  it('two cities with the same day get their own peer fill (employers of the same size)', () => {
    const a = schoolTown({ homes: 20, shopJobs: 9 }); // peers as (un)filled as the school: big employers fill last
    const b = schoolTown({ homes: 20, shopJobs: 38 }); // peers nearly full: the school falls behind them
    expect(staffHint(a)).toMatch(/^Big employers fill last/);
    expect(staffHint(b)).toMatch(/road link/);
    expect(staffHint(a)).toMatch(/^Big employers fill last/);
  });

  it('two cities with the same building id and day get their own catchment (people in reach)', () => {
    const a = clinicTown(20);
    const b = clinicTown(4);
    expect(a.clinic.id).toBe(b.clinic.id);
    // "≈ 22 of 145 residents": the residents within its walk (weighted by distance)
    const residents = (t: ReturnType<typeof clinicTown>) => {
      const v = facilityReport(t.sim, t.clinic.id)!.lines.find((l) => l.key === 'seniors')?.value ?? '';
      return Number(/of ([\d,]+) residents$/.exec(v)?.[1].replace(/,/g, '') ?? NaN);
    };
    const ra = residents(a), rb = residents(b);
    expect(ra).toBeGreaterThan(0);
    expect(rb).toBeGreaterThan(0);
    // (city a's memo for this building id, key and day must not answer for city b, nor b's overwrite a's)
    expect(rb).toBeLessThan(ra / 2);
    expect(residents(a)).toBe(ra);
    expect(residents(b)).toBe(rb);
  });
});

/** a full garbage collection: global.gc when node runs with --expose-gc, else V8's flag set at runtime (the same
 *  trick jest's leak detector uses); null when neither works (the test is skipped) */
function getGc(): (() => void) | null {
  const g = (globalThis as { gc?: () => void }).gc;
  if (typeof g === 'function') return g;
  try {
    setFlagsFromString('--expose-gc');
    const f = runInNewContext('gc') as unknown;
    return typeof f === 'function' ? (f as () => void) : null;
  } catch {
    return null;
  }
}
const gc = getGc();

describe('SF-1: a city the player left is released', () => {
  it.skipIf(!gc)('inspecting part-staffed facilities does not keep a dropped city (and its simulation) alive', async () => {
    let ref: WeakRef<CityState> | null = null;
    let reports = 0;
    (() => {
      // every memo path: the road-to-homes search, the peer fill (part-staffed, road to homes, city at 90% fill) and
      // a clinic's catchment
      const t = schoolTown({ homes: 20, shopJobs: 9 });
      expect(staffHint(t)).toMatch(/^Big employers fill last/);
      const clinic = place(t.st, 'civ_clinic', 56, 21, { flags: BF.Plopped | BF.Powered | BF.Watered, age: 100 });
      if (facilityReport(t.sim, clinic.id)) reports++;
      t.sim.advanceDay();
      if (facilityReport(t.sim, t.school.id)) reports++;
      ref = new WeakRef(t.st);
    })();
    expect(reports).toBe(2);
    for (let k = 0; k < 6 && ref!.deref() !== undefined; k++) {
      await new Promise((r) => setTimeout(r, 10));
      gc!();
    }
    expect(ref!.deref()).toBeUndefined();
  });
});
