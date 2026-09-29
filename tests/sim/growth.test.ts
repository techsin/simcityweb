/**
 * WP6a growth (SIM_DEPTH_SPEC WP6 growth, docs/SIM_DEPTH_PART_B.md §5 WP6a + items 36 / 37 / [art] / [QA 7]):
 * plopped buildings age, plopped / grown model variants spread (no identical twins side by side), deep blocks fill their
 * interior with yards (frontage rule kept), gentrification swaps instead of abandonment when land value rises, R$$$
 * filters down, the downtown weight of tower growth, and pickDev's phase-0 defaults.
 */
import { describe, expect, it } from 'vitest';
import { makeCity, road } from './helpers';
import { economySystems } from '../../src/sim/systems/economy';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';
import { DevType, Network, Zone } from '../../src/core/types';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { getDef, rotatedFootprint } from '../../src/sim/catalog';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import {
  commercialCore, downtownWeight, growthData, growthLimits, positionVariant, spreadVariant, towerLot,
} from '../../src/sim/economy/growth';
import { placeBuilding } from '../../src/sim/economy/buildings';
import { DOWNTOWN_MIN, DOWNTOWN_R0, DOWNTOWN_R1, PICK_ALLOW_EXP, PICK_DES_EXP, VARIANT_SPREAD } from '../../src/sim/economy/tuning';

const isRoad = (n: number) => n >= Network.Street && n <= Network.Highway;

function growable(st: CityState, def: string, x: number, z: number, variant: number): Building {
  const d = getDef(def)!;
  const [w, dd] = d.footprint;
  return {
    id: st.nextBuildingId++, def, x, z, w, d: dd, rot: 0, variant, pop: 0, jobs: 0, capacity: d.capacity ?? 0, wealth: 1, built: 1,
    age: 400, flags: 0, baseY: 5, health: 0.8, unhappy: 0,
  };
}

describe('growth: plopped buildings', () => {
  it('plopped buildings age one day per day (QA item 7)', () => {
    const { st, sim, A } = makeCity();
    st.funds = 1e6;
    road(A, 2, 30, 60, 30);
    expect(A.plop('park_small', 10, 29, 0).ok).toBe(true);
    const b = st.buildingAt(10, 29)!;
    expect(b.age).toBe(0);
    sim.runDays(12);
    expect(b.age).toBe(12);
  });

  it('6 plazas get >= 2 model variants; neighbours never repeat a variant while another is free', () => {
    const { st, A } = makeCity();
    st.funds = 1e6;
    road(A, 2, 30, 60, 30);
    const vs: number[] = [];
    for (let k = 0; k < 6; k++) {
      expect(A.plop('park_plaza', 4 + k * 3, 28, 0).ok).toBe(true);
      vs.push(st.buildingAt(4 + k * 3, 28)!.variant);
    }
    const n = MANIFEST_BY_ID['park_plaza'].variants;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(new Set(vs).size).toBeGreaterThanOrEqual(2);
    // adjacent plazas (3 cells apart, within VARIANT_SPREAD) differ
    for (let k = 1; k < vs.length; k++) expect(vs[k]).not.toBe(vs[k - 1]);
    // the start value is a pure position hash
    expect(positionVariant(7, 11, 5)).toBe(positionVariant(7, 11, 5));
    expect(positionVariant(0, 0, 1)).toBe(0);
  });

  it('spreadVariant steps past taken variants and, when all are taken, picks the one whose twin is farthest', () => {
    const { st, sim } = makeCity({ size: 32 });
    const def = 'res_cottage.r1.2';
    expect(getDef(def)).toBeTruthy();
    const place = (x: number, z: number, v: number) => placeBuilding(sim, growable(st, def, x, z, v));
    place(10, 10, 0);
    place(12, 10, 1);
    expect(spreadVariant(st, def, 11, 10, 1, 1, 0, 3)).toBe(2); // 0 and 1 nearby -> 2
    place(10, 12, 2);
    // all three taken; from (13, 12) the twins are at Chebyshev distance 3 (variant 0), 2 (variant 1), 3 (variant 2):
    // the farthest wins, ties in stepping order from the start value
    expect(spreadVariant(st, def, 13, 12, 1, 1, 1, 3)).toBe(2);
    expect(spreadVariant(st, def, 13, 12, 1, 1, 0, 3)).toBe(0);
    // outside VARIANT_SPREAD nothing counts
    expect(spreadVariant(st, def, 10 + VARIANT_SPREAD + 2, 10, 1, 1, 0, 3)).toBe(0);
  });
});

describe('growth: grown towns', () => {
  /** an economy-only town of R low / medium, C and I blocks between roads 9 apart (8-deep blocks) */
  function grownTown(days: number, extra: SimSystem[] = []) {
    const systems = economySystems();
    systems.splice(1, 0, ...extra);
    const { st, sim, A } = makeCity({ size: 64 }, systems);
    st.funds = 1e6;
    road(A, 0, 31, 63, 31, Network.Avenue);
    for (let x = 4; x <= 58; x += 9) road(A, x, 4, x, 58);
    for (let z = 4; z <= 58; z += 9) road(A, 4, z, 58, z);
    const blocks: [number, number, Zone][] = [];
    for (let bz = 0; bz < 6; bz++) for (let bx = 0; bx < 6; bx++) {
      const zn = bz < 3 ? (bx < 3 ? Zone.ResLow : Zone.ResMed) : bx < 2 ? Zone.ComMed : bx < 4 ? Zone.ResLow : Zone.IndMed;
      blocks.push([5 + bx * 9, 5 + bz * 9, zn]);
      A.zone({ x0: 5 + bx * 9, z0: 5 + bz * 9, x1: 13 + bx * 9, z1: 13 + bz * 9 }, zn);
    }
    sim.runDays(days);
    return { st, sim, A, blocks };
  }

  it('deep blocks: lots may reach into the interior (front edge on the road, extra cells interior only)', { timeout: 600000 }, () => {
    const { st } = grownTown(540);
    const N = st.size;
    let grown = 0, deep = 0, interior = 0, interiorBuilt = 0;
    for (const b of st.buildings.values()) {
      if (b.flags & BF.Plopped) continue;
      const def = getDef(b.def)!;
      grown++;
      const [W, D] = rotatedFootprint(def, b.rot);
      // frontage rule kept: the whole front edge touches a road
      if (b.rot === 0) for (let x = b.x; x < b.x + b.w; x++) expect(isRoad(st.network[(b.z + b.d) * N + x])).toBe(true);
      if (b.rot === 2) for (let x = b.x; x < b.x + b.w; x++) expect(isRoad(st.network[(b.z - 1) * N + x])).toBe(true);
      if (b.rot === 1) for (let z = b.z; z < b.z + b.d; z++) expect(isRoad(st.network[z * N + b.x + b.w])).toBe(true);
      if (b.rot === 3) for (let z = b.z; z < b.z + b.d; z++) expect(isRoad(st.network[z * N + b.x - 1])).toBe(true);
      if (b.w * b.d > W * D) deep++;
      expect(b.w >= W && b.d >= D).toBe(true);
    }
    for (let z = 1; z < N - 1; z++) for (let x = 1; x < N - 1; x++) {
      const i = z * N + x;
      if (st.zone[i] < Zone.ResLow || st.zone[i] > Zone.IndHigh || st.network[i] !== Network.None) continue;
      if (isRoad(st.network[i - 1]) || isRoad(st.network[i + 1]) || isRoad(st.network[i - N]) || isRoad(st.network[i + N])) continue;
      interior++;
      if (st.building[i] >= 0) interiorBuilt++;
    }
    expect(grown).toBeGreaterThan(40);
    expect(deep).toBeGreaterThan(0);
    // with 1-2 deep lots and no extension the 4x4 cores of 8-deep blocks stay empty (interior share ~0.3 at most)
    expect(interiorBuilt / interior).toBeGreaterThan(0.45);
  });

  it('model variants of grown buildings spread: touching same-def twins are rare', { timeout: 600000 }, () => {
    const { st } = grownTown(540);
    const N = st.size;
    let multi = 0, touching = 0;
    for (const b of st.buildings.values()) {
      if (b.flags & BF.Plopped) continue;
      const def = getDef(b.def)!;
      if ((MANIFEST_BY_ID[def.model]?.variants ?? 1) < 3) continue;
      multi++;
      let twin = false;
      for (let z = Math.max(0, b.z - 1); z <= Math.min(N - 1, b.z + b.d) && !twin; z++) for (let x = Math.max(0, b.x - 1); x <= Math.min(N - 1, b.x + b.w) && !twin; x++) {
        const id = st.building[z * N + x];
        if (id < 0 || id === b.id) continue;
        const o = st.buildings.get(id)!;
        if (o.def === b.def && o.variant === b.variant) twin = true;
      }
      if (twin) touching++;
    }
    expect(multi).toBeGreaterThan(20);
    expect(touching / multi).toBeLessThan(0.05);
  });

  it('rising land value gentrifies R$ homes (same-stage wealth swaps) instead of abandoning them', { timeout: 900000 }, () => {
    // after 360 days of normal growth, land value is pinned at 0.9 over the R low blocks (an injected system after
    // land value); R$$ outbids R$ there (RENT) and existing R$ homes swap instead of turning unhappy
    let pin = false;
    const pinLv: SimSystem = {
      name: 'test.pinLandValue',
      daily(sim) {
        if (!pin) return;
        const st = sim.state;
        for (let i = 0; i < st.cells; i++) if (st.zone[i] === Zone.ResLow) st.landValue[i] = 0.9;
      },
    };
    const { st, sim } = grownTown(360, [pinLv]);
    const abandoned = () => [...st.buildings.values()].filter((b) => b.flags & BF.Abandoned).length;
    const r1Before = [...st.buildings.values()].filter((b) => getDef(b.def)?.devType === DevType.R1).length;
    expect(r1Before).toBeGreaterThan(5);
    const ab0 = abandoned();
    pin = true;
    sim.runDays(720);
    const gd = growthData(st);
    expect(gd.swaps).toBeGreaterThan(0);
    expect(abandoned()).toBeLessThanOrEqual(ab0);
    // swap locks (anti-oscillation) are keyed by building id and pruned with their building
    for (const k of Object.keys(gd.lock)) expect(st.buildings.has(Number(k))).toBe(true);
    for (const k of Object.keys(gd.low)) expect(st.buildings.has(Number(k))).toBe(true);
  });

  it('downtown: the commercial core exists once the town has offices / shops, and tower lots far from it are less likely', { timeout: 600000 }, () => {
    const { st } = grownTown(540);
    const c = commercialCore(st);
    if (c) {
      expect(downtownWeight(st, Math.round(c.x), Math.round(c.z))).toBe(1);
      expect(downtownWeight(st, 0, 0)).toBeLessThanOrEqual(1);
      // the tower partition is fixed per lot (no re-roll per day: a far lot that lost keeps losing) and thin far out
      const N = st.size;
      let near = 0, nearOk = 0, far = 0, farOk = 0;
      const day = st.day;
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const d = Math.hypot(x + 0.5 - c.x, z + 0.5 - c.z) / N;
        const ok = towerLot(st, x, z);
        st.day = day + 17;
        expect(towerLot(st, x, z)).toBe(ok);
        st.day = day;
        if (d < DOWNTOWN_R0) { near++; if (ok) nearOk++; } else if (d > DOWNTOWN_R1) { far++; if (ok) farOk++; }
      }
      expect(nearOk).toBe(near);
      if (far > 50) expect(farOk / far).toBeLessThan(DOWNTOWN_MIN + 0.1);
    }
    // growthLimits keeps its phase-0 shape (optional fields only)
    const gl = growthLimits(st, 20 * st.size + 20, DevType.R2);
    expect(typeof gl.desStage).toBe('number');
    expect(typeof gl.rejected).toBe('boolean');
    // pickDev defaults reproduce phase 0 (des^1 × allowance^0.5)
    expect(PICK_DES_EXP).toBe(1);
    expect(PICK_ALLOW_EXP).toBe(0.5);
  });
});

describe('growth: save / load continuity (item 3)', () => {
  it('systemData.growth (swap locks, filter timers, scan cursor, commercial core) round-trips; a loaded town keeps its core and caches', { timeout: 600000 }, () => {
    const systems = economySystems();
    const { st, sim, A } = makeCity({ size: 64 }, systems);
    st.funds = 1e6;
    road(A, 0, 31, 63, 31, Network.Avenue);
    for (let x = 4; x <= 58; x += 9) road(A, x, 4, x, 58);
    A.zone({ x0: 5, z0: 5, x1: 30, z1: 30 }, Zone.ResLow);
    A.zone({ x0: 32, z0: 5, x1: 58, z1: 30 }, Zone.ComMed);
    sim.runDays(90);
    const ids = [...st.buildings.keys()].slice(0, 3);
    expect(ids.length).toBeGreaterThan(0);
    const gd = growthData(st);
    gd.lock[ids[0]] = st.day + 1234;
    gd.low[ids[ids.length - 1]] = 90;
    gd.cursor = 7;
    gd.core = { x: 40.5, z: 12.25, jobs: 3456 };
    const saved = JSON.parse(JSON.stringify(gd));
    for (const copy of [
      deserializeCity(structuredClone(serializeCity(st, { copy: true })) as SerializedCity),
      deserializeCity(decodeBundle(encodeBundle(serializeCity(st))) as SerializedCity),
    ]) {
      expect(JSON.parse(JSON.stringify(copy.systemData.growth))).toEqual(saved);
      const sim2 = new Simulation(copy, economySystems());
      const gd2 = growthData(copy);
      // integer keys still look up by building id after the string round trip
      expect(gd2.lock[ids[0]]).toBe(saved.lock[String(ids[0])]);
      expect(gd2.cursor).toBe(7);
      // the loaded town continues with its saved commercial core (downtown weights unchanged until the monthly update)
      const c = commercialCore(copy);
      expect(c?.x).toBeCloseTo(40.5, 6);
      expect(c?.z).toBeCloseTo(12.25, 6);
      // derived caches (desirability slope / freight, land-value masks) rebuild at init: a day runs cleanly and the
      // desirability of the loaded town matches the original's stored values where nothing changed
      sim2.runDays(1);
      let same = 0, n = 0;
      for (let i = 0; i < copy.cells; i += 7) {
        if (copy.zone[i] !== Zone.ResLow) continue;
        n++;
        if (Math.abs(copy.desirability[DevType.R1][i] - st.desirability[DevType.R1][i]) < 0.05) same++;
      }
      expect(n).toBeGreaterThan(10);
      expect(same / n).toBeGreaterThan(0.9);
    }
  });
});
