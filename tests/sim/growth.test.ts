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
import { econData } from '../../src/sim/economy/runtime';
import { lotCell } from '../../src/sim/economy/factors';
import {
  DOWNTOWN_MIN, DOWNTOWN_R0, DOWNTOWN_R1, DOWNTOWN_STAGE, PICK_ALLOW_EXP, PICK_DES_EXP, SWAP_SCAN_DAYS, VARIANT_SPREAD,
} from '../../src/sim/economy/tuning';

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

  it('twins are matched by model: two defs sharing a model and variant look identical, so they count', () => {
    // the stage-3 and stage-4 walk-ups (and the R$ stage-2 / R$$ stage-1 cottages) are one model each
    const s3 = getDef('res_walkup.r1.3')!, s4 = getDef('res_walkup.r1.4')!;
    expect(s3.model).toBe(s4.model);
    expect(getDef('res_cottage.r1.2')!.model).toBe(getDef('res_cottage.r2.1')!.model);
    {
      const { st, sim } = makeCity({ size: 32 });
      placeBuilding(sim, growable(st, s4.id, 10, 10, 0));
      placeBuilding(sim, growable(st, s4.id, 12, 10, 1));
      // a stage-3 walk-up next to them steps past the variants its stage-4 neighbours show
      expect(spreadVariant(st, s3.id, 11, 10, 1, 1, 0, 4)).toBe(2);
      // another model is no twin: a cottage keeps its start variant
      expect(spreadVariant(st, 'res_cottage.r1.2', 11, 12, 1, 1, 0, 4)).toBe(0);
    }
    {
      // every variant shows nearby (2 variants): variant 0 on a stage-4 walk-up 1 cell away, variant 1 on a stage-3 one
      // 2 cells away — a same-def twin is avoided first (the contract's "no same def + variant within 6 cells"): a
      // stage-3 lot takes variant 0, a stage-4 lot variant 1
      const { st, sim } = makeCity({ size: 32 });
      placeBuilding(sim, growable(st, s4.id, 10, 10, 0));
      placeBuilding(sim, growable(st, s3.id, 13, 10, 1));
      expect(spreadVariant(st, s3.id, 11, 10, 1, 1, 0, 2)).toBe(0);
      expect(spreadVariant(st, s3.id, 11, 10, 1, 1, 1, 2)).toBe(0);
      expect(spreadVariant(st, s4.id, 11, 10, 1, 1, 0, 2)).toBe(1);
      // with a same-def twin on every variant: the farthest one (variant 0's stage-3 twin 3 cells off, variant 1's 2)
      placeBuilding(sim, growable(st, s3.id, 11, 13, 0));
      expect(spreadVariant(st, s3.id, 11, 10, 1, 1, 1, 2)).toBe(0);
    }
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

describe('growth: wealth swaps and the inspector rows', () => {
  it('gentrification tries the richer DevTypes best gain first: an R$ row with no R$$$ model of its size goes R$$', () => {
    const { st, sim, A } = makeCity({ size: 32 });
    st.funds = 1e6;
    road(A, 2, 20, 30, 20);
    A.zone({ x0: 4, z0: 18, x1: 12, z1: 20 }, Zone.ResMed);
    const def = getDef('res_townhouse_row.r1.3')!;
    const [w, d] = def.footprint;
    const b: Building = {
      id: st.nextBuildingId++, def: def.id, x: 6, z: 20 - d, w, d, rot: 0, variant: 0, pop: 20, jobs: 0, capacity: def.capacity ?? 0,
      wealth: 1, built: 1, age: 1000, flags: BF.Powered | BF.Watered, baseY: 5, health: 0.8, unhappy: 0,
    };
    placeBuilding(sim, b);
    const i = lotCell(b, st.size);
    st.desirability[DevType.R1][i] = -0.1;
    st.desirability[DevType.R2][i] = 0.3;
    st.desirability[DevType.R3][i] = 0.5; // the best gain — but no stage-3 R$$$ model of this lot's size keeps 60 % of 30
    st.stats.demand[DevType.R2] = st.stats.demand[DevType.R3] = 0.5;
    const carry = econData(st).carry;
    carry[DevType.R2] = carry[DevType.R3] = 100;
    const gl = growthLimits(st, b.z * st.size + b.x, DevType.R1);
    expect(gl.wealth).toMatch(/^gentrifying: \$\$ outbid \$ here \(\+40\)/);
    // the same gates as the swap scan: without allowance for R$$ nothing is announced
    carry[DevType.R2] = 0;
    expect(growthLimits(st, i, DevType.R1).wealth).toBeUndefined();
  });

  it('filtering down counts only established R$$$ homes (a new one gets SWAP_MIN_AGE days to settle)', { timeout: 300000 }, () => {
    const pinned: Building[] = [];
    const pin: SimSystem = {
      name: 'test.pinR3',
      // (every R DevType: no redevelopment picks these lots either)
      daily(sim) { for (const b of pinned) for (const dv of [DevType.R1, DevType.R2, DevType.R3]) sim.state.desirability[dv][lotCell(b, sim.state.size)] = -0.5; },
    };
    const systems = economySystems();
    systems.splice(systems.findIndex((x) => x.name === 'economy.desirability') + 1, 0, pin);
    const { st, sim, A } = makeCity({ size: 32 }, systems);
    st.funds = 1e6;
    road(A, 2, 20, 30, 20);
    A.zone({ x0: 4, z0: 16, x1: 20, z1: 20 }, Zone.ResLow);
    const def = getDef('res_villa.r3.1')!;
    const [w, d] = def.footprint;
    for (const [x, age] of [[6, 0], [12, 1000]] as const) {
      const b: Building = {
        id: st.nextBuildingId++, def: def.id, x, z: 20 - d, w, d, rot: 0, variant: 0, pop: 4, jobs: 0, capacity: def.capacity ?? 0,
        wealth: 3, built: 1, age, flags: BF.Powered | BF.Watered, baseY: 5, health: 0.8, unhappy: 0,
      };
      placeBuilding(sim, b);
      pinned.push(b);
    }
    sim.runDays(SWAP_SCAN_DAYS + 2);
    const gd = growthData(st);
    const [young, old] = pinned;
    expect(st.buildings.has(old.id) && st.buildings.has(young.id)).toBe(true);
    expect(gd.low[old.id]).toBeGreaterThanOrEqual(SWAP_SCAN_DAYS);
    // one scan cycle per SWAP_SCAN_DAYS, however small the town (every visit counts SWAP_SCAN_DAYS low days)
    expect(gd.low[old.id]).toBeLessThanOrEqual(2 * SWAP_SCAN_DAYS);
    expect(gd.low[young.id]).toBeUndefined();
    expect(gd.filtered).toBe(0);
    // the inspector counts down for the old one
    expect(growthLimits(st, old.z * st.size + old.x, DevType.R3).wealth).toMatch(/^declining: the wealthy leave in ~\d+ days unless desirability tops −10/);
  });

  it('growthLimits: an empty lot no road can reach is rejected; a far lot that is no tower site says so and caps the stage', () => {
    const { st, sim, A } = makeCity({ size: 64 });
    st.funds = 1e6;
    road(A, 2, 10, 60, 10);
    A.zone({ x0: 2, z0: 11, x1: 60, z1: 40 }, Zone.ResHigh);
    const N = st.size;
    // 20 rows in from the road: beyond any lot's reach (its footprint + INFILL_MAX_EXTRA yard rows)
    const deep = 31 * N + 30;
    st.desirability[DevType.R2][deep] = 0.5;
    const g0 = growthLimits(st, deep, DevType.R2);
    expect(g0.rejected).toBe(true);
    expect(g0.reason).toMatch(/^No road access/);
    // the front row can grow; with a commercial core far away and every other limit above tower height, a lot that lost
    // the fixed tower draw is capped below DOWNTOWN_STAGE — in a non-enumerable field (generic row lists skip it)
    const gd = growthData(st);
    gd.core = { x: 60.5, z: 60.5, jobs: 50000 };
    st.day = 30;
    sim.getSystem('economy.growth')!.init!(sim);
    st.stats.population = 5e6;
    let found = false;
    for (let x = 2; x < 60 && !found; x++) {
      const i = 11 * N + x;
      st.desirability[DevType.R2][i] = 1;
      const g = growthLimits(st, i, DevType.R2);
      expect(g.rejected).toBe(false);
      if (g.downtownStage === undefined) continue;
      found = true;
      expect(g.downtownStage).toBe(DOWNTOWN_STAGE - 1);
      expect(Object.keys(g)).not.toContain('downtownStage');
      expect(g.downtown).toMatch(/^stage 5 max: not a tower site \(\d+% of lots this far are\); core \d+ tiles (N|NE|E|SE|S|SW|W|NW)$/);
      expect(g.downtown!.length).toBeLessThan(80);
    }
    expect(found).toBe(true);
    // a standing building is judged where its redevelopment is (lotCell, the middle of its road-side row): on a deep lot
    // whose centre lost the tower draw but whose front cell won it (or the other way round), the inspector follows lotCell
    expect(getDef('res_apartment.r2.4')?.devType).toBe(DevType.R2);
    let checked = 0;
    for (let x = 2; x + 2 <= 60 && checked < 4; x++) {
      // a deep lot fronting the road at z = 10 (rot 2: its road-side row is z = 11, its centre z = 14)
      const ci = 11 * N + x + 1, centre = 14 * N + x + 1;
      if (towerLot(st, ci % N, (ci / N) | 0) === towerLot(st, centre % N, (centre / N) | 0)) continue;
      placeBuilding(sim, { ...growable(st, 'res_apartment.r2.4', x, 11, 0), w: 2, d: 6, rot: 2 });
      expect(lotCell(st.buildingAt(x, 11)!, N)).toBe(ci);
      st.desirability[DevType.R2][ci] = 1;
      const g = growthLimits(st, centre, DevType.R2);
      expect(g.downtownStage === undefined, `tower site at the lot cell of ${x},11`).toBe(towerLot(st, ci % N, (ci / N) | 0));
      checked++;
      x += 2;
    }
    expect(checked).toBeGreaterThan(0);
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
