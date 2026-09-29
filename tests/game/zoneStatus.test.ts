/**
 * WP5 lot status (routed item 3, docs/SIM_DEPTH_PART_B.md): empty lots deep in a block. Growth's extendInward lets a lot
 * on the road take INFILL_MAX_EXTRA extra rows of yard, and redevelopment keeps those yards — so back cells up to
 * LOT_DEPTH + INFILL_MAX_EXTRA deep are not "No road access": an open strip fills as the back yard of a lot on the road,
 * a cell behind a standing building waits for that lot to be rebuilt (a warning, not the red road blocker). Power and
 * water are judged at the road front the back lot fills from.
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { BACK_LOT_DEPTH, emptyZoneStatus, lotAccess, roadAccess, utilityReaches, zoneStatusLine, zoneStatusTone } from '../../src/ui/zoneStatus';
import { newState, place, roadLine } from '../infra/cityGen';

/** a residential strip x = 5 .. 5 + depth - 1 (rows z = 10 .. 14) with a street along x = 4 */
function strip(depth: number, zone = Zone.ResLow) {
  const st = newState(32);
  st.systemData.infraVersion = 1; // utilities layer "present": power / water are judged
  st.stats.demand = st.stats.demand.map(() => 0.5);
  roadLine(st, 4, 6, 4, 20, Network.Road);
  for (let z = 10; z <= 14; z++) for (let x = 5; x < 5 + depth; x++) st.zone[st.idx(x, z)] = zone;
  return st;
}

describe('lot status: deep blocks (routed item 3)', () => {
  it('a cell behind a 1×1 home that fronts the road gets no road blocker: it waits for the lot in front', () => {
    const st = strip(3);
    st.powered.fill(1);
    place(st, 't_r1', 5, 12, { pop: 10 });
    const s = emptyZoneStatus(st, 6, 12)!;
    expect(s.access).toBe('behind');
    expect(s.blockers.some((b) => b.id === 'road')).toBe(false);
    expect(s.blockers[0].id).toBe('behind');
    expect(zoneStatusTone(s)).toBe('warn');
    expect(zoneStatusLine(s)).toMatch(/^Behind the buildings on the road/);
    expect(roadAccess(st, 6, 12)).toBe(false);
  });

  it('an open strip deeper than a lot fills as the back yard of a lot on the road (no blocker)', () => {
    const st = strip(BACK_LOT_DEPTH + 2);
    st.powered.fill(1);
    st.watered.fill(1);
    expect(lotAccess(st, 5, 12)).toBe('front');
    expect(lotAccess(st, 8, 12)).toBe('front'); // row 4: a 4-deep lot
    expect(lotAccess(st, 9, 12)).toBe('yard'); // rows 5-6: the yard of a lot on the road
    expect(lotAccess(st, 4 + BACK_LOT_DEPTH, 12)).toBe('yard');
    expect(lotAccess(st, 5 + BACK_LOT_DEPTH, 12)).toBe('none'); // deeper than any lot + yard
    const s = emptyZoneStatus(st, 9, 12)!;
    expect(s.ready).toBe(true);
    expect(s.note).toMatch(/back yard/);
    expect(zoneStatusLine(s)).toMatch(/^Ready — fills as the back yard/);
    const far = emptyZoneStatus(st, 5 + BACK_LOT_DEPTH, 12)!;
    expect(far.blockers[0].id).toBe('road');
    expect(zoneStatusTone(far)).toBe('bad');
  });

  it('power and water of a back lot are judged at the road it fills from', () => {
    const st = strip(3, Zone.ResMed);
    place(st, 't_r2', 5, 12, { pop: 40 });
    // only the road is served (the home's and the back cell's own flags are off)
    for (let z = 6; z <= 20; z++) { st.powered[st.idx(4, z)] = 1; st.watered[st.idx(4, z)] = 1; }
    const i = st.idx(7, 12);
    expect(utilityReaches(st, st.powered, i, 'power')).toBe(true);
    expect(utilityReaches(st, st.watered, i, 'water')).toBe(true);
    const s = emptyZoneStatus(st, 7, 12)!;
    expect(s.blockers.map((b) => b.id)).toEqual(['behind']);
    // an unserved road: the back lot has no power either
    st.powered.fill(0);
    expect(emptyZoneStatus(st, 7, 12)!.blockers.map((b) => b.id)).toContain('power');
  });

  it('a different zone or a plopped building in between blocks the walk', () => {
    const st = strip(4);
    st.zone[st.idx(5, 11)] = Zone.ComLow;
    expect(lotAccess(st, 6, 11)).toBe('none');
    // a plopped building (not a lot that redevelops) in front: the cell behind it is not waiting on a rebuild
    const st2 = strip(4);
    const fs = place(st2, 't_r1', 5, 10, { flags: BF.Plopped });
    expect(fs.flags & BF.Plopped).toBeTruthy();
    expect(lotAccess(st2, 6, 10)).toBe('none');
  });
});
