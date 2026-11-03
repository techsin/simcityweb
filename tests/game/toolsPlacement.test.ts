/**
 * Plop tool placement helpers (src/game/tools/placement.ts):
 *  - P14: a shore building's auto rotation faces the water (actions.ts plop's countFront rule), preferring a side whose
 *    lot touches a road — the playtest's ferry terminal / marina with the road behind and water in front first read
 *    "Must be placed on the shore with its front facing water" because auto-facing picked the road;
 *  - P8: staffed service buildings (coverage + staff) are the ones a missing road stops;
 *  - P3: the upkeep at the cursor is the building share plus the running costs of the people it would newly serve
 *    there, not the typical-load figure that ignored the city;
 *  - UI-1: ...counted the way the services pass counts them (claims of the unseated share, deep lots served as a whole,
 *    the facility's quality, its capacity): the cursor read 1.4-2.8x under the real budget change in a 312k city.
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF, type NeedTier } from '../../src/sim/CityState';
import { getDef, rotatedFootprint } from '../../src/sim/catalog';
import { CityActions } from '../../src/sim/actions';
import { expectedUpkeep, opexTierOf } from '../../src/sim/economy/opex';
import { OPEX_BUILDING_SHARE, OPEX_PER_SERVED } from '../../src/sim/economy/tuning';
import type { Simulation } from '../../src/sim/Simulation';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import type { ServicesSystem } from '../../src/sim/infra/services';
import { servedHere, shoreFacesWater, shoreRotation, staffedService, type Rot } from '../../src/game/tools/placement';
import { runQuery } from '../../src/worker/queries';
import { newSim, newState, place, roadLine } from '../infra/cityGen';

function upkeepHere(sim: Simulation, def: BuildingDef, x: number, z: number, w: number, d: number): number | null {
  return runQuery(sim, 'upkeepContext', { defId: def.id, x, z, w, d }).here;
}

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
    // (bounded by its own seats at its quality — 100 % here — not by the build card's typical load)
    expect(near).toBeLessThanOrEqual(building + def.coverage!.capacity! * OPEX_PER_SERVED.elementary + 1e-6);
    expect(far).toBeLessThan(near);
    expect(roadless).toBeCloseTo(building, 6);
    // (the city-wide figure, the build menu's: at least a quarter of a typical load)
    expect(expectedUpkeep(st, def)).toBeGreaterThanOrEqual(building);
  });

  /**
   * streets every 5 cells (x = 2, 7, 12, ...; a cross street at z = 1), 2×2 towers on both sides of each street: every
   * tower's back column is two cells from its street, out of every reach (served with its front door, services'
   * footprint max), and an elementary school at the west end already seats part of the town (claims of the unseated
   * share)
   */
  function deepTown() {
    const st = newState(64);
    st.funds = 1e7;
    roadLine(st, 2, 1, 62, 1, Network.Road);
    for (let x = 2; x <= 62; x += 5) roadLine(st, x, 1, x, 62, Network.Road);
    for (let x = 2; x + 5 <= 62; x += 5) for (let z = 3; z + 2 <= 60; z += 2) {
      for (const bx of [x + 1, x + 3]) {
        for (let k = 0; k < 4; k++) st.zone[st.idx(bx + (k & 1), z + (k >> 1))] = Zone.ResHigh;
        place(st, 't_r3', bx, z, { pop: 320 });
      }
    }
    return st;
  }
  /** the budget change of plopping `id` at (x, z): its building share + the running costs of its tier's Δ served */
  function realChange(sim: Simulation, id: string, x: number, z: number): { here: number; real: number; served: number } {
    const st = sim.state;
    const def = getDef(id)!;
    const tier = opexTierOf(def) as NeedTier;
    const svc = sim.getSystem('services') as unknown as { compute(s: Simulation, first: boolean): void };
    svc.compute(sim, false);
    const before = st.stats.needs[tier].served;
    const [w, d] = rotatedFootprint(def, 0);
    const here = upkeepHere(sim, def, x, z, w, d)!;
    const served = servedHere(st, def, x, z, w, d, sim.getSystem<ServicesSystem>('services')!.needRaster(tier))!;
    const r = new CityActions(sim).plop(id, x, z, 0);
    expect(r.ok, `${id} at ${x},${z}: ${r.reason}`).toBe(true);
    const b = st.buildings.get(st.building[st.idx(x, z)])!;
    b.flags |= BF.Powered | BF.Watered;
    svc.compute(sim, false);
    const real = (def.upkeep ?? 0) * OPEX_BUILDING_SHARE + OPEX_PER_SERVED[tier] * (st.stats.needs[tier].served - before);
    return { here, real, served };
  }

  it('final fixes UI-1: the figure at the cursor is the budget change the facility then makes (deep lots, shared seats)', () => {
    const st = deepTown();
    const sim = newSim(st);
    const A = new CityActions(sim);
    // (each site's own lot: its towers make way first)
    const clear = (id: string, x: number, z: number) => { const [w, d] = rotatedFootprint(getDef(id)!, 0); A.bulldoze({ x0: x, z0: z, x1: x + w, z1: z + d }); };
    clear('civ_elementary_school', 3, 3);
    expect(A.plop('civ_elementary_school', 3, 3, 0).ok).toBe(true); // seats the west end first
    for (const [id, x, z] of [['civ_elementary_school', 28, 40], ['civ_elementary_school', 13, 9], ['civ_clinic', 33, 30], ['civ_police_station', 43, 21], ['civ_fire_station', 53, 46]] as const) {
      clear(id, x, z);
      const { here, real, served } = realChange(sim, id, x, z);
      expect(served, id).toBeGreaterThan(50);
      expect(here / real, `${id}: here §${here.toFixed(0)} vs real §${real.toFixed(0)}`).toBeGreaterThan(0.95);
      expect(here / real, `${id}: here §${here.toFixed(0)} vs real §${real.toFixed(0)}`).toBeLessThan(1.05);
    }
  });

  it('a deep lot is served as a whole: its back rows count with the reached front row', () => {
    const st = newState(32);
    roadLine(st, 2, 2, 2, 28, Network.Road);
    // one 2×2 tower east of the street (x 3..4): only its front column (x = 3) is in any reach
    for (let k = 0; k < 4; k++) st.zone[st.idx(3 + (k & 1), 14 + (k >> 1))] = Zone.ResHigh;
    place(st, 't_r3', 3, 14, { pop: 400 });
    const sim = newSim(st);
    const def = getDef('civ_police_station')!;
    // across the street 8 tiles up (out of its near field, in full reach): the police tier's need of the whole tower
    // (residents x (0.5 + crime)) at the station's strength — not just the front column's half (the cursor's old count)
    const s = def.coverage!.strength;
    const p = servedHere(st, def, 0, 22, 2, 2, sim.getSystem<ServicesSystem>('services')!.needRaster('police'))!;
    expect(p).toBeGreaterThan(0.97 * 400 * 0.5 * s);
    expect(p).toBeLessThanOrEqual(400 * 0.5 * s * 1.0001);
    // ...which the services pass then counts as served
    const r = realChange(sim, 'civ_police_station', 0, 22);
    expect(r.here / r.real).toBeGreaterThan(0.97);
    expect(r.here / r.real).toBeLessThan(1.03);
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
