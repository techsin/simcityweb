/**
 * Plop tool placement helpers (src/game/tools/placement.ts):
 *  - P14: a shore building's auto rotation faces the water (actions.ts plop's countFront rule), preferring a side whose
 *    lot touches a road — the playtest's ferry terminal / marina with the road behind and water in front first read
 *    "Must be placed on the shore with its front facing water" because auto-facing picked the road;
 *  - P8: staffed service buildings (coverage + staff) are the ones a missing road stops;
 *  - P3: the upkeep at the cursor is the building share plus the running costs of the unserved need in reach (capped at
 *    a typical load), not the typical-load figure that ignored the city.
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { getDef } from '../../src/sim/catalog';
import { CityActions } from '../../src/sim/actions';
import { expectedUpkeep } from '../../src/sim/economy/opex';
import { OPEX_BUILDING_SHARE, OPEX_PER_SERVED, OPEX_TYPICAL_LOAD } from '../../src/sim/economy/tuning';
import { shoreFacesWater, shoreRotation, staffedService, upkeepHere, type Rot } from '../../src/game/tools/placement';
import { newSim, newState, place, roadLine } from '../infra/cityGen';

/** water from x = 20 eastward, a road along x = 17 */
function coast() {
  const st = newState(32);
  for (let z = 0; z < 32; z++) for (let x = 20; x < 32; x++) st.water[st.idx(x, z)] = 1;
  roadLine(st, 17, 0, 17, 31, Network.Road);
  return st;
}

describe('shore buildings face the water (final fixes P14)', () => {
  it('the playtest ferry terminal: road behind, water in front — the auto rotation picks the water side (rot 1)', () => {
    const st = coast();
    const sq = (_r: Rot) => ({ x: 18, z: 15, w: 2, d: 2 });
    expect(shoreFacesWater(st, 18, 15, 2, 2, 3)).toBe(false); // the road side
    expect(shoreFacesWater(st, 18, 15, 2, 2, 0)).toBe(false);
    expect(shoreFacesWater(st, 18, 15, 2, 2, 1)).toBe(true);
    // whatever the current rotation, the water side wins
    for (const cur of [0, 1, 2, 3] as Rot[]) expect(shoreRotation(st, sq, cur)).toEqual({ x: 18, z: 15, rot: 1 });
    // ...and the action agrees
    const sim = newSim(st);
    st.config.sandbox = true;
    const A = new CityActions(sim);
    expect(A.plop('tr_ferry_terminal', 18, 15, 3, true).reason).toBe('Must be placed on the shore with its front facing water');
    expect(A.plop('tr_ferry_terminal', 18, 15, 1, true).ok).toBe(true);
  });

  it('a non-square footprint: the origin and dims follow the rotation; on the water or inland: no water side', () => {
    const st = coast();
    // 3 × 2 centred on (19, 15): rot 1 / 3 swap to 2 × 3
    const place3 = (r: Rot) => (r % 2 ? { x: 18, z: 14, w: 2, d: 3 } : { x: 17, z: 15, w: 3, d: 2 });
    expect(shoreRotation(st, place3, 0)).toEqual({ x: 18, z: 14, rot: 1 });
    // one cell further east the 3-wide rotations stand in the water, the 2-wide one faces it
    expect(shoreRotation(st, (r) => (r % 2 ? { x: 19, z: 14, w: 2, d: 3 } : { x: 18, z: 15, w: 3, d: 2 }), 0)).toBeNull();
    expect(shoreRotation(st, () => ({ x: 4, z: 4, w: 2, d: 2 }), 0)).toBeNull();
  });

  it('two sides face water: the one whose lot touches a road wins', () => {
    const st = newState(32);
    // a pier of land x 10..11 into water on its west (x < 10) and north (z < 10); a road on its south (z = 12)
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) if (x < 10 || z < 10) st.water[st.idx(x, z)] = 1;
    roadLine(st, 10, 12, 20, 12, Network.Road);
    const at = () => ({ x: 10, z: 10, w: 2, d: 2 });
    expect(shoreFacesWater(st, 10, 10, 2, 2, 2)).toBe(true); // north
    expect(shoreFacesWater(st, 10, 10, 2, 2, 3)).toBe(true); // west
    expect(shoreRotation(st, at, 3)?.rot).toBe(3); // both touch the road (south side): the current one stays
    // the same pier with the road moved off the lot: still a water side, and the current rotation when equal
    const st2 = newState(32);
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) if (x < 10 || z < 10) st2.water[st2.idx(x, z)] = 1;
    expect(shoreRotation(st2, at, 2)?.rot).toBe(2);
    // a 3 × 2 lot: its north-facing (3 wide) and west-facing (2 wide, 3 deep) placements differ — a road touches only
    // the second, which wins over the current rotation
    const st3 = newState(32);
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) if (x < 10 || z < 10) st3.water[st3.idx(x, z)] = 1;
    st3.network[st3.idx(11, 13)] = Network.Road; // south of the 2 × 3 lot (z 10..12), off the 3 × 2 one (z 10..11)
    const place3 = (r: Rot) => (r % 2 ? { x: 10, z: 10, w: 2, d: 3 } : { x: 10, z: 10, w: 3, d: 2 });
    expect(shoreFacesWater(st3, 10, 10, 3, 2, 2)).toBe(true);
    expect(shoreFacesWater(st3, 10, 10, 2, 3, 3)).toBe(true);
    expect(shoreRotation(st3, place3, 2)).toEqual({ x: 10, z: 10, rot: 3 });
  });
});

describe('staffed services (final fixes P8)', () => {
  it('coverage + staff: schools, clinics, stations, libraries, museums; not parks or garages', () => {
    for (const id of ['civ_elementary_school', 'civ_clinic', 'civ_hospital', 'civ_police_kiosk', 'civ_library', 'civ_museum']) {
      expect(staffedService(getDef(id)!), id).toBe(true);
    }
    expect(staffedService(getDef('tr_parking_garage')!)).toBe(false);
    expect(staffedService(getDef('park_marina')!)).toBe(false);
  });
});

describe('upkeep at the cursor (final fixes P3)', () => {
  /** a street (x = 5, z 2..60) with homes on both sides (z 2..30) and an empty stretch (z 40..60) */
  function town() {
    const st = newState(64);
    roadLine(st, 5, 2, 5, 60, Network.Road);
    for (let z = 2; z <= 30; z++) for (const x of [4, 6]) {
      st.zone[st.idx(x, z)] = Zone.ResMed;
      place(st, 't_r2', x, z, { pop: 50 });
    }
    return st;
  }

  it('next to unserved homes it costs more than in the empty stretch; without a road only the building', () => {
    const st = town();
    const sim = newSim(st);
    const def = getDef('civ_elementary_school')!;
    const building = (def.upkeep ?? 0) * OPEX_BUILDING_SHARE;
    const near = upkeepHere(sim, def, 6, 31, 1, 1)!;
    const far = upkeepHere(sim, def, 6, 58, 1, 1)!;
    const roadless = upkeepHere(sim, def, 20, 20, 1, 1)!;
    expect(near).not.toBeNull();
    expect(near).toBeGreaterThan(building + 1);
    expect(near).toBeLessThanOrEqual(building + (def.coverage!.capacity! * OPEX_TYPICAL_LOAD) * OPEX_PER_SERVED.elementary + 1e-6);
    expect(far).toBeLessThan(near);
    expect(roadless).toBeCloseTo(building, 6);
    // (the city-wide figure, the build menu's: at least a quarter of a typical load)
    expect(expectedUpkeep(st, def)).toBeGreaterThanOrEqual(building);
  });

  it('a flat-upkeep def or an economy-only city: no estimate here (the tool shows the catalog upkeep)', () => {
    const st = town();
    const sim = newSim(st);
    expect(upkeepHere(sim, getDef('tr_parking_garage')!, 6, 31, 1, 1)).toBeNull();
    const st2 = town();
    st2.systemData.infraVersion = undefined;
    expect(upkeepHere({ state: st2, getSystem: () => undefined } as unknown as Parameters<typeof upkeepHere>[0], getDef('civ_elementary_school')!, 6, 31, 1, 1)).toBeNull();
  });
});
