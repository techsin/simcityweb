/**
 * WP5 lot status (routed item 3, docs/SIM_DEPTH_PART_B.md): empty lots deep in a block. Growth's extendInward lets a lot
 * on the road take INFILL_MAX_EXTRA extra rows of yard, and redevelopment keeps those yards — so back cells up to
 * LOT_DEPTH + INFILL_MAX_EXTRA deep are not "No road access": an open strip fills as the back yard of a lot on the road,
 * a cell behind a standing building waits for that lot to be rebuilt (a warning, not the red road blocker). Power and
 * water are judged at the road front the back lot fills from.
 */
import { describe, expect, it } from 'vitest';
import { DevType, Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import {
  BACK_LOT_DEPTH, emptyZoneStatus, frontCellOf, lotAccess, noAccessText, roadAccess, utilityReaches, zonePlanNoAccess, zoneStatusLine,
  zoneStatusTone,
} from '../../src/ui/zoneStatus';
import { CityActions } from '../../src/sim/actions';
import { newSim, newState, place, roadLine } from '../infra/cityGen';

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

  it('frontCellOf: a back lot reads its coverages at the lot cell on the road it fills from', () => {
    const st = strip(3);
    place(st, 't_r1', 5, 12, { pop: 10 });
    expect(frontCellOf(st, 7, 12)).toBe(st.idx(5, 12)); // behind the home: the home's cell on the road
    expect(frontCellOf(st, 5, 11)).toBe(st.idx(5, 11)); // fronts the road itself
    const deep = strip(BACK_LOT_DEPTH + 2);
    expect(frontCellOf(deep, 9, 12)).toBe(deep.idx(5, 12)); // a yard cell: the road-front cell of its row
    const far = 5 + BACK_LOT_DEPTH;
    expect(frontCellOf(deep, far, 12)).toBe(deep.idx(far, 12)); // no access: the cell itself
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

/**
 * Final fixes N3: the zone tool gave no warning for tiles that will never get road access (a 3×3 commercial zone one
 * unzoned column away from the road read "Commercial · Low density §45 3×3 · 9 tiles", then "Not growing: no road
 * access"). zonePlanNoAccess judges every tile of the dragged rectangle with lotAccess as the zoning would leave it.
 */
describe('zone preview: tiles without road access (final fixes N3)', () => {
  /** a street along x = 4 (z 6..20), nothing zoned */
  function street() {
    const st = newState(32);
    roadLine(st, 4, 6, 4, 20, Network.Road);
    return st;
  }

  it('a zone one unzoned column away from the road: every tile is flagged', () => {
    const st = street();
    const rect = { x0: 6, z0: 10, x1: 9, z1: 13 }; // x = 5 stays unzoned
    const na = zonePlanNoAccess(st, rect, Zone.ComLow);
    expect(na.total).toBe(9);
    expect(na.none.length).toBe(9);
    expect(noAccessText(na.none.length, na.total)).toBe(`All 9 tiles have no road access and will never develop — a road must run within ${BACK_LOT_DEPTH} tiles of a lot`);
    // the same rectangle against the road: all of it reaches the street
    expect(zonePlanNoAccess(st, { x0: 5, z0: 10, x1: 8, z1: 13 }, Zone.ComLow).none.length).toBe(0);
  });

  it('a deep rectangle: only the tiles beyond a lot and its yard are flagged', () => {
    const st = street();
    const w = BACK_LOT_DEPTH + 3;
    const na = zonePlanNoAccess(st, { x0: 5, z0: 10, x1: 5 + w, z1: 12 }, Zone.ResLow);
    expect(na.total).toBe(2 * w);
    expect(na.none.length).toBe(2 * 3);
    expect(noAccessText(na.none.length, na.total)).toMatch(/^6 of 18 tiles have no road access/);
    for (const i of na.none) expect(i % st.size).toBeGreaterThanOrEqual(5 + BACK_LOT_DEPTH);
  });

  it('the rectangle counts as zoned: a strip that joins an existing zone to the road gives it access', () => {
    const st = street();
    for (let x = 7; x <= 9; x++) st.zone[st.idx(x, 10)] = Zone.ResLow; // zoned one column off the road: no access yet
    expect(lotAccess(st, 7, 10)).toBe('none');
    // zoning x = 5..6 of the same zone links it: the new tiles and the old ones reach the road (same zone between)
    expect(zonePlanNoAccess(st, { x0: 5, z0: 10, x1: 7, z1: 11 }, Zone.ResLow).none.length).toBe(0);
    const plan = { rect: { x0: 5, z0: 10, x1: 7, z1: 11 }, zone: Zone.ResLow };
    expect(lotAccess(st, 7, 10, plan)).toBe('front');
    // a different zone in between still blocks the walk
    expect(lotAccess(st, 7, 10, { ...plan, zone: Zone.ComLow })).toBe('none');
  });

  it('rezoning over another family: the homes it demolishes stop blocking, kept buildings read as "behind"', () => {
    const st = street();
    st.zone[st.idx(5, 10)] = Zone.ResLow;
    const home = place(st, 't_r1', 5, 10, { pop: 5 });
    const plan = { rect: { x0: 5, z0: 10, x1: 8, z1: 11 }, zone: Zone.ComLow };
    expect(lotAccess(st, 6, 10, plan)).toBe('behind'); // as if the home stood on the new lot
    expect(lotAccess(st, 6, 10, { ...plan, demolished: new Set([home.id]) })).toBe('front');
    // the zone action's preview names the home among the demolished: the tool passes them on
    const sim = newSim(st);
    const pre = new CityActions(sim).zone(plan.rect, Zone.ComLow, true);
    expect(pre.demolished).toEqual([home.id]);
    expect(zonePlanNoAccess(st, plan.rect, Zone.ComLow, pre.demolished).none.length).toBe(0);
  });

  it('only the tiles the zoning zones count (already that zone, roads, water are skipped)', () => {
    const st = street();
    st.zone[st.idx(8, 10)] = Zone.ComLow;
    st.water[st.idx(9, 10)] = 1;
    const na = zonePlanNoAccess(st, { x0: 3, z0: 10, x1: 11, z1: 11 }, Zone.ComLow);
    // x = 3, 5, 6, 7, 10 (x = 4 road, 8 already ComLow, 9 water)
    expect(na.total).toBe(5);
    // x = 10 sits behind the water: no road within reach
    expect(na.none).toEqual([st.idx(10, 10)]);
    // landfill and rects above the cap are not checked
    expect(zonePlanNoAccess(st, { x0: 6, z0: 10, x1: 9, z1: 13 }, Zone.Landfill).total).toBe(0);
    expect(zonePlanNoAccess(st, { x0: 0, z0: 0, x1: 32, z1: 32 }, Zone.ResLow, undefined, 100).total).toBe(0);
  });
});

/**
 * Final fixes N4 (lot part): an empty lot read "✓ Ready to grow — waiting for a builder" when the only type with
 * demand could not live there (lot (52,133): land value 0%, R$ +18 / R$$ −30 / R$$$ −100, demand only R$$$). Only
 * the DevTypes whose desirability clears growth's floor (GROW_MIN_DESIR, −25) count.
 */
describe('lot status: demand only counts for types that can live there (final fixes N4)', () => {
  function lot(zone = Zone.ResLow) {
    const st = strip(3, zone);
    st.powered.fill(1);
    st.watered.fill(1);
    st.stats.demand = st.stats.demand.map(() => 0);
    return st;
  }
  const setDes = (st: ReturnType<typeof lot>, i: number, v: Partial<Record<DevType, number>>) => {
    for (const [d, x] of Object.entries(v)) st.desirability[Number(d)][i] = x as number;
  };

  it('the newplayer lot: demand only for R$$$, which shuns it — a warning, not "Ready"', () => {
    const st = lot();
    const i = st.idx(5, 12);
    st.stats.demand[DevType.R3] = 0.755;
    setDes(st, i, { [DevType.R1]: 0.18, [DevType.R2]: -0.3, [DevType.R3]: -1 });
    st.landValue[i] = 0;
    const s = emptyZoneStatus(st, 5, 12)!;
    expect(s.ready).toBe(false);
    expect(s.blockers.map((b) => b.id)).toEqual(['fit']);
    expect(zoneStatusLine(s)).toBe("Waiting for demand: no R$ demand; R$$$ can't live here (land value 0%)");
    expect(zoneStatusTone(s)).toBe('warn');
    // R$ demand (R$ fits here): ready
    st.stats.demand[DevType.R1] = 0.3;
    const r = emptyZoneStatus(st, 5, 12)!;
    expect(r.ready).toBe(true);
    expect(zoneStatusLine(r)).toBe('Ready to grow — waiting for a builder');
  });

  it('no demand at all is still "no demand"; nothing fits at all is "too unattractive"', () => {
    const st = lot();
    const i = st.idx(5, 12);
    setDes(st, i, { [DevType.R1]: -0.4, [DevType.R2]: -0.5, [DevType.R3]: -0.9 });
    expect(emptyZoneStatus(st, 5, 12)!.blockers.map((b) => b.id)).toEqual(['demand']);
    st.stats.demand[DevType.R2] = 0.4;
    st.stats.demand[DevType.R3] = 0.6;
    st.landValue[i] = 0.05;
    const s = emptyZoneStatus(st, 5, 12)!;
    expect(zoneStatusLine(s)).toBe("Land too unattractive: R$$ / R$$$ can't live here (land value 5%)");
    expect(zoneStatusTone(s)).toBe('warn');
  });

  it('when land value is not what keeps them away the line gives the desirability (commercial wording)', () => {
    const st = lot(Zone.ComLow);
    const i = st.idx(5, 12);
    st.stats.demand[DevType.CS3] = 0.5;
    setDes(st, i, { [DevType.CS1]: 0.1, [DevType.CS2]: 0.05, [DevType.CS3]: -0.6 });
    st.landValue[i] = 0.6; // above CS$$$'s reference: something else (pollution, crime ...) drags it down
    expect(zoneStatusLine(emptyZoneStatus(st, 5, 12)!)).toBe("Waiting for demand: no CS$ / CS$$ demand; CS$$$ won't open here (desirability −60, growth needs above −25)");
  });

  it('a back lot is judged at the road-front cell it fills from', () => {
    const st = lot();
    st.stats.demand[DevType.R3] = 0.5;
    const back = st.idx(7, 12), front = st.idx(5, 12);
    setDes(st, back, { [DevType.R3]: -0.8 }); // its own cell: shunned
    setDes(st, front, { [DevType.R3]: 0.4 }); // the lot it would join on the road: fine
    expect(emptyZoneStatus(st, 7, 12)!.ready).toBe(true);
    setDes(st, front, { [DevType.R3]: -0.5 });
    expect(emptyZoneStatus(st, 7, 12)!.blockers.map((b) => b.id)).toEqual(['fit']);
  });

  it('a lot behind a building with only unfit demand: both are warnings', () => {
    const st = lot();
    place(st, 't_r1', 5, 12, { pop: 10 });
    st.stats.demand[DevType.R3] = 0.5;
    setDes(st, st.idx(5, 12), { [DevType.R1]: 0.2, [DevType.R3]: -0.6 });
    const s = emptyZoneStatus(st, 6, 12)!;
    expect(s.blockers.map((b) => b.id)).toEqual(['behind', 'fit']);
    expect(zoneStatusTone(s)).toBe('warn');
  });
});
