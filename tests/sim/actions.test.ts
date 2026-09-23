import { describe, expect, it } from 'vitest';
import { makeCity, addWaterRows, road } from './helpers';
import { lPath, NET_BRIDGE, NET_ONEWAY_MASK, NET_ONEWAY_SHIFT } from '../../src/sim/actions';
import { DevType, Network, Zone } from '../../src/core/types';
import { BF, type Building } from '../../src/sim/CityState';
import { placeBuilding } from '../../src/sim/economy/buildings';

function growable(st: ReturnType<typeof makeCity>['st'], def: string, x: number, z: number, w: number, d: number): Building {
  return { id: st.nextBuildingId++, def, x, z, w, d, rot: 0, variant: 0, pop: 5, jobs: 0, capacity: 6, wealth: 1, built: 1, age: 400, flags: 0, baseY: 5, health: 0.8, unhappy: 0 };
}

describe('CityActions: zoning', () => {
  it('charges per cell, skips water / roads, preview does not mutate', () => {
    const { st, A } = makeCity();
    road(A, 0, 10, 20, 10);
    const pre = A.zone({ x0: 0, z0: 8, x1: 10, z1: 12 }, Zone.ResLow, true);
    expect(pre.ok).toBe(true);
    expect(pre.affected).toBe(30); // 40 cells − 10 road cells
    expect(pre.cost).toBe(30 * 5);
    expect(st.zone[8 * st.size]).toBe(Zone.None);
    const funds = st.funds;
    const r = A.zone({ x0: 0, z0: 8, x1: 10, z1: 12 }, Zone.ResLow);
    expect(r.ok).toBe(true);
    expect(st.funds).toBe(funds - 150);
    expect(st.zone[8 * st.size]).toBe(Zone.ResLow);
    expect(st.zone[10 * st.size]).toBe(Zone.None); // road cell
    expect(st.budget.curExpense['oneoff:zoning']).toBe(150);
  });

  it("can't zone water; can't zone over plopped buildings", () => {
    const { st, A } = makeCity();
    addWaterRows(st, 30, 33);
    expect(A.zone({ x0: 0, z0: 31, x1: 5, z1: 32 }, Zone.ResLow).ok).toBe(false);
    expect(A.plop('civ_fire_station', 5, 5, 0).ok).toBe(true);
    const r = A.zone({ x0: 5, z0: 5, x1: 7, z1: 7 }, Zone.ComLow);
    expect(r.ok).toBe(false);
  });

  it('rezoning to another family demolishes growables; density change keeps them', () => {
    const { st, sim, A } = makeCity();
    A.zone({ x0: 0, z0: 0, x1: 4, z1: 4 }, Zone.ResLow);
    const b = growable(st, 'res_shack.r1.1', 1, 1, 1, 1);
    placeBuilding(sim, b);
    expect(A.zone({ x0: 0, z0: 0, x1: 4, z1: 4 }, Zone.ResMed).ok).toBe(true);
    expect(st.buildings.has(b.id)).toBe(true);
    const r = A.zone({ x0: 0, z0: 0, x1: 4, z1: 4 }, Zone.ComLow, true);
    expect(r.reason).toMatch(/demolish/i);
    A.zone({ x0: 0, z0: 0, x1: 4, z1: 4 }, Zone.ComLow);
    expect(st.buildings.has(b.id)).toBe(false);
    expect(st.zone[1 * st.size + 1]).toBe(Zone.ComLow);
  });

  it('dezone only clears empty cells', () => {
    const { st, sim, A } = makeCity();
    A.zone({ x0: 0, z0: 0, x1: 4, z1: 4 }, Zone.ResLow);
    placeBuilding(sim, growable(st, 'res_shack.r1.1', 1, 1, 1, 1));
    const r = A.dezone({ x0: 0, z0: 0, x1: 4, z1: 4 });
    expect(r.affected).toBe(15);
    expect(st.zone[1 * st.size + 1]).toBe(Zone.ResLow);
  });
});

describe('CityActions: networks', () => {
  it('per-cell costs by type, upgrade costs the difference', () => {
    const { st, A } = makeCity();
    expect(road(A, 5, 5, 14, 5, Network.Road).cost).toBe(200);
    const up = A.buildNetwork(lPath({ x: 5, z: 5 }, { x: 14, z: 5 }), Network.Avenue, true);
    expect(up.ok).toBe(true);
    expect(up.cost).toBe(200); // (40 − 20) × 10
    expect(road(A, 5, 7, 14, 7, Network.Street).cost).toBe(100);
    expect(road(A, 5, 9, 14, 9, Network.Rail).cost).toBe(300);
    expect(road(A, 5, 11, 14, 11, Network.Highway).cost).toBe(1200);
    expect(st.network[5 * st.size + 5]).toBe(Network.Road);
  });

  it('building a road clears zones and trees', () => {
    const { st, A } = makeCity();
    A.zone({ x0: 0, z0: 0, x1: 10, z1: 10 }, Zone.ResLow);
    st.trees[5 * st.size + 3] = 3;
    road(A, 0, 5, 9, 5);
    expect(st.zone[5 * st.size + 3]).toBe(Zone.None);
    expect(st.trees[5 * st.size + 3]).toBe(0);
  });

  it('bridges: 10× cost, flagged, max span, streets cannot cross, must end on land', () => {
    const { st, A } = makeCity();
    addWaterRows(st, 20, 24); // water cells z = 20..23 (4 rows)
    const r = A.buildNetwork(lPath({ x: 10, z: 18 }, { x: 10, z: 26 }), Network.Road, true);
    expect(r.ok).toBe(true);
    const waterCells = [18, 19, 20, 21, 22, 23, 24, 25, 26].filter((z) => st.water[z * st.size + 10]).length;
    expect(r.cost).toBe(20 * (9 - waterCells) + 200 * waterCells);
    A.buildNetwork(lPath({ x: 10, z: 18 }, { x: 10, z: 26 }), Network.Road);
    expect(st.netFlags[21 * st.size + 10] & NET_BRIDGE).toBe(NET_BRIDGE);
    expect(A.buildNetwork(lPath({ x: 12, z: 18 }, { x: 12, z: 26 }), Network.Street).ok).toBe(false);
    expect(A.buildNetwork(lPath({ x: 14, z: 18 }, { x: 14, z: 21 }), Network.Road).ok).toBe(false);
    const { st: st2, A: A2 } = makeCity();
    addWaterRows(st2, 10, 30);
    const long = A2.buildNetwork(lPath({ x: 5, z: 5 }, { x: 5, z: 40 }), Network.Road);
    expect(long.ok).toBe(false);
    expect(long.reason).toMatch(/too long/i);
  });

  it('highways cannot connect to streets', () => {
    const { A } = makeCity();
    road(A, 0, 10, 20, 10, Network.Highway);
    const r = A.buildNetwork(lPath({ x: 10, z: 11 }, { x: 10, z: 20 }), Network.Street);
    expect(r.ok).toBe(false);
    expect(A.buildNetwork(lPath({ x: 12, z: 11 }, { x: 12, z: 20 }), Network.Road).ok).toBe(true);
  });

  it('one-way direction comes from the drag direction', () => {
    const { st, A } = makeCity();
    A.buildNetwork(lPath({ x: 10, z: 5 }, { x: 3, z: 5 }), Network.OneWay);
    const dir = (st.netFlags[5 * st.size + 6] & NET_ONEWAY_MASK) >> NET_ONEWAY_SHIFT;
    expect(dir).toBe(2); // -x
  });

  it('neighbor connections are tracked at the map edge', () => {
    const { st, A } = makeCity();
    expect(st.neighborConnections.length).toBe(0);
    road(A, 0, 30, 10, 30, Network.Road);
    expect(st.neighborConnections.length).toBe(1);
    expect(st.neighborConnections[0].edge).toBe('w');
    road(A, 30, 0, 30, 10, Network.Highway);
    expect(st.neighborConnections.map((c) => c.type)).toContain(Network.Highway);
  });

  it('rejects non-contiguous paths and steep slopes', () => {
    const { st, A } = makeCity();
    expect(A.buildNetwork([{ x: 1, z: 1 }, { x: 3, z: 1 }], Network.Road).ok).toBe(false);
    const N1 = st.size + 1;
    for (let z = 40; z <= 64; z++) for (let x = 0; x <= 64; x++) st.heights[z * N1 + x] = 5 + (z - 40) * 12;
    expect(A.buildNetwork(lPath({ x: 5, z: 42 }, { x: 5, z: 50 }), Network.Road).reason).toMatch(/steep/i);
  });
});

describe('CityActions: bulldoze / plop / terraform / trees', () => {
  it('bulldoze refunds 25% of networks, charges a growable demolition fee, civic free', () => {
    const { st, sim, A } = makeCity();
    road(A, 0, 5, 9, 5);
    const r = A.bulldoze({ x0: 0, z0: 5, x1: 10, z1: 6 }, true);
    expect(r.cost).toBeCloseTo(-50);
    A.zone({ x0: 0, z0: 0, x1: 4, z1: 4 }, Zone.ResLow);
    placeBuilding(sim, growable(st, 'res_shack.r1.1', 1, 1, 1, 1));
    expect(A.bulldoze({ x0: 1, z0: 1, x1: 2, z1: 2 }).cost).toBeGreaterThan(0);
    A.plop('civ_police_station', 20, 20, 0);
    const civ = A.bulldoze({ x0: 20, z0: 20, x1: 22, z1: 22 });
    expect(civ.ok).toBe(true);
    expect(civ.cost).toBe(0);
    expect(st.buildingAt(20, 20)).toBeUndefined();
    expect(A.bulldoze({ x0: 40, z0: 40, x1: 42, z1: 42 }).ok).toBe(false);
  });

  it('plop: free footprint, cost, unique, unlock, levels lot, emits events', () => {
    const { st, sim, A } = makeCity();
    const events: string[] = [];
    sim.events.on('buildingAdded', () => events.push('added'));
    sim.events.on('terrainChanged', () => events.push('terrain'));
    // bump one corner so leveling happens
    st.heights[11 * (st.size + 1) + 11] = 7;
    const funds = st.funds;
    const r = A.plop('civ_fire_station', 10, 10, 0);
    expect(r.ok).toBe(true);
    expect(st.funds).toBe(funds - 1400);
    const b = st.buildingAt(11, 11)!;
    expect(b.flags & BF.Plopped).toBeTruthy();
    expect(b.built).toBe(1);
    expect(st.heights[11 * (st.size + 1) + 11]).toBeCloseTo(b.baseY);
    expect(events).toEqual(['added', 'terrain']);
    expect(st.milestones.civ_fire_station).toBe(1);
    // overlap
    expect(A.plop('civ_fire_station', 11, 11, 0).ok).toBe(false);
    // road in the way
    road(A, 30, 30, 40, 30);
    expect(A.plop('civ_clinic', 30, 29, 0).ok).toBe(false);
    // locked + unique
    expect(A.plop('civ_city_hall', 40, 40, 0).ok).toBe(false);
    st.unlocked.add('city_hall');
    expect(A.plop('civ_city_hall', 40, 40, 0).ok).toBe(true);
    expect(A.plop('civ_city_hall', 20, 40, 0).reason).toMatch(/only one/i);
    // growables are not ploppable
    expect(A.plop('res_shack.r1.1', 50, 50, 0).ok).toBe(false);
  });

  it('plop: insufficient funds, sandbox bypass, rotation footprint, shore placement', () => {
    const { st, A } = makeCity({ difficulty: 'hard', startFunds: 1000 });
    expect(A.plop('util_coal_plant', 10, 10, 0).ok).toBe(false);
    const sb = makeCity({ difficulty: 'sandbox', sandbox: true });
    expect(sb.A.plop('util_nuclear_plant', 10, 10, 0).ok).toBe(true);
    expect(sb.A.plop('tr_train_station', 30, 30, 1).ok).toBe(true);
    const tb = sb.st.buildingAt(30, 30)!;
    expect([tb.w, tb.d]).toEqual([2, 4]);
    // shore: marina (2x2) with front (+Z) facing water
    st.funds = 100000;
    addWaterRows(st, 40, 44);
    let firstWater = 0;
    for (let z = 30; z < 50; z++) if (st.water[z * st.size + 5]) { firstWater = z; break; }
    expect(A.plop('park_marina', 5, firstWater - 2, 0, true).ok).toBe(true);
    expect(A.plop('park_marina', 5, 10, 0, true).ok).toBe(false);
  });

  it('terraform raises terrain with a cost, not under roads', () => {
    const { st, A } = makeCity();
    const h0 = st.cornerHeight(20, 20);
    const pre = A.terraform('raise', 20, 20, 3, 2, true);
    expect(pre.ok).toBe(true);
    expect(pre.cost).toBeGreaterThan(0);
    expect(st.cornerHeight(20, 20)).toBe(h0);
    A.terraform('raise', 20, 20, 3, 2);
    expect(st.cellHeight(20, 20)).toBeGreaterThan(h0 + 0.5);
    road(A, 40, 40, 44, 40);
    const hr = st.cornerHeight(42, 40);
    A.terraform('raise', 42, 40, 1, 3);
    expect(st.cornerHeight(42, 40)).toBe(hr);
    // lowering below sea level makes water
    A.terraform('lower', 10, 50, 3, 12);
    expect(st.water[50 * st.size + 10]).toBe(1);
  });

  it('plantTrees', () => {
    const { st, A } = makeCity();
    const r = A.plantTrees({ x0: 0, z0: 0, x1: 4, z1: 4 });
    expect(r.affected).toBe(16);
    expect(r.cost).toBe(48);
    expect(st.trees[0]).toBeGreaterThanOrEqual(3);
  });
});

describe('CityActions: budget & policy', () => {
  it('taxes and funding are clamped', () => {
    const { st, A } = makeCity();
    A.setTax(DevType.R1, 30);
    expect(st.budget.taxRates[DevType.R1]).toBe(20);
    A.setTax(DevType.R1, -3);
    expect(st.budget.taxRates[DevType.R1]).toBe(0);
    A.setFunding('police', 200);
    expect(st.budget.funding.police).toBe(150);
  });

  it('loans: take, repay, limits', () => {
    const { st, A } = makeCity();
    const f0 = st.funds;
    const r = A.takeLoan(50000);
    expect(r.ok).toBe(true);
    expect(st.funds).toBe(f0 + 50000);
    expect(st.budget.loans[0].rate).toBeGreaterThanOrEqual(0.05);
    expect(st.budget.loans[0].rate).toBeLessThanOrEqual(0.1);
    expect(st.budget.loans[0].monthsLeft).toBe(120);
    expect(A.takeLoan(10_000_000).ok).toBe(false);
    expect(A.repayLoan(0).ok).toBe(true);
    expect(st.budget.loans.length).toBe(0);
  });

  it('ordinances need population unless sandbox', () => {
    const { st, A } = makeCity();
    expect(A.setOrdinance('clean_air_act', true).ok).toBe(false);
    st.stats.population = 25000;
    expect(A.setOrdinance('clean_air_act', true).ok).toBe(true);
    expect(st.budget.ordinances).toContain('clean_air_act');
    expect(A.setOrdinance('clean_air_act', false).ok).toBe(true);
    expect(st.budget.ordinances).not.toContain('clean_air_act');
    expect(A.setOrdinance('nope', true).ok).toBe(false);
  });

  it('historic toggle', () => {
    const { st, sim, A } = makeCity();
    const b = growable(st, 'res_shack.r1.1', 1, 1, 1, 1);
    placeBuilding(sim, b);
    A.toggleHistoric(b.id);
    expect(b.flags & BF.Historic).toBeTruthy();
  });

  it('preview is fast on a big drag', () => {
    const { A } = makeCity({ size: 256 });
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) A.zone({ x0: 0, z0: 0, x1: 120, z1: 120 }, Zone.ResMed, true);
    const per = (performance.now() - t0) / 20;
    expect(per).toBeLessThan(40);
  });
});
