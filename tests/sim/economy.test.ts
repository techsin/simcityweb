import { describe, expect, it } from 'vitest';
import { makeCity, road } from './helpers';
import { DevType, Network, Zone } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { econData } from '../../src/sim/economy/runtime';
import { frontHasRoad, placeBuilding } from '../../src/sim/economy/buildings';
import { ordinanceEffect, listOrdinances } from '../../src/sim/economy/ordinances';
import { listRewards } from '../../src/sim/economy/rewards';
import { computeMonthlyBudget } from '../../src/sim/economy/budget';
import { taxFactor } from '../../src/sim/economy/demand';
import { popMaxStage } from '../../src/sim/economy/growth';

const R = (d: number[]) => Math.max(d[0], d[1], d[2]);

/** a small grid town: roads every 9 cells, zones between them */
function town(size = 64) {
  const c = makeCity({ size });
  const { A } = c;
  road(c.A, 0, 31, size - 1, 31, Network.Avenue); // edge-to-edge → neighbor connections
  for (let z = 4; z <= 58; z += 9) road(A, 4, z, 58, z);
  for (let x = 4; x <= 58; x += 9) road(A, x, 4, x, 58);
  return c;
}

describe('demand', () => {
  it('early game: strong residential demand with no jobs, industry wants to come', () => {
    const { st, sim } = makeCity();
    sim.runDays(10);
    expect(R(st.stats.demand)).toBeGreaterThan(0.6);
    expect(Math.max(st.stats.demand[DevType.ID], st.stats.demand[DevType.IM])).toBeGreaterThan(0.3);
    expect(st.stats.demandCap[DevType.R1]).toBeGreaterThan(5000);
  });

  it('jobs raise residential demand; high taxes lower it; tax sensitivity is stronger for the wealthy', () => {
    const a = makeCity();
    a.sim.runDays(20);
    const base = econData(a.st).target[DevType.R1];
    // add industrial job capacity
    for (let k = 0; k < 10; k++) {
      placeBuilding(a.sim, {
        id: a.st.nextBuildingId++, def: 'ind_assembly_plant.im.4', x: 40 + (k % 5) * 4, z: 40 + Math.floor(k / 5) * 4, w: 4, d: 3, rot: 0, variant: 0,
        pop: 0, jobs: 0, capacity: 520, wealth: 2, built: 1, age: 0, flags: 0, baseY: 5, health: 1, unhappy: 0,
      });
    }
    a.sim.runDays(5);
    expect(econData(a.st).target[DevType.R1]).toBeGreaterThan(base + 1000);

    const b = makeCity();
    for (let d = 0; d < 12; d++) b.st.budget.taxRates[d] = 16;
    b.sim.runDays(30);
    expect(econData(b.st).target[DevType.R1]).toBeLessThan(base);
    expect(taxFactor(DevType.R3, 14)).toBeLessThan(taxFactor(DevType.R1, 14));
    expect(taxFactor(DevType.R1, 6)).toBeGreaterThan(1);
  });

  it('parks relieve the residential cap (SC4 style)', () => {
    const { st, sim, A } = makeCity();
    sim.runDays(2);
    const cap0 = st.stats.demandCap[DevType.R1];
    for (let k = 0; k < 4; k++) expect(A.plop('park_large', 4 + k * 5, 4, 0).ok).toBe(true);
    sim.runDays(2);
    expect(st.stats.demandCap[DevType.R1]).toBeGreaterThan(cap0 + 20000);
  });

  it('ordinance effects are exposed to sim-infra', () => {
    const { st } = makeCity();
    expect(ordinanceEffect(st, 'fire.risk')).toBe(1);
    expect(ordinanceEffect(st, 'add.approval')).toBe(0);
    st.budget.ordinances.push('smoke_detectors', 'neighborhood_watch', 'youth_curfew');
    expect(ordinanceEffect(st, 'fire.risk')).toBeCloseTo(0.75);
    expect(ordinanceEffect(st, 'crime.rate')).toBeCloseTo(0.81);
    expect(ordinanceEffect(st, 'add.approval')).toBe(0);
    expect(listOrdinances(st).length).toBeGreaterThanOrEqual(14);
  });
});

describe('growth', () => {
  it('zoned land next to roads develops within weeks; buildings face the road; construction completes', () => {
    const { st, sim, A } = town();
    A.zone({ x0: 5, z0: 5, x1: 31, z1: 31 }, Zone.ResLow);
    A.zone({ x0: 32, z0: 32, x1: 58, z1: 40 }, Zone.IndMed);
    A.zone({ x0: 5, z0: 32, x1: 31, z1: 40 }, Zone.ComLow);
    const added: number[] = [];
    sim.events.on('buildingAdded', (b) => added.push(b.id));
    sim.runDays(90);
    expect(added.length).toBeGreaterThan(40);
    let facing = 0, total = 0, done = 0;
    for (const b of st.buildings.values()) {
      if (b.flags & BF.Plopped) continue;
      total++;
      if (frontHasRoad(st, b)) facing++;
      if (b.built >= 1 && !(b.flags & BF.Constructing)) done++;
      const def = getDef(b.def)!;
      for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
        expect(def.zones).toContain(st.zone[z * st.size + x]);
        expect(st.building[z * st.size + x]).toBe(b.id);
      }
      expect(def.stage!).toBeLessThanOrEqual(3); // low density
    }
    expect(facing).toBe(total);
    expect(done).toBeGreaterThan(total * 0.5);
    expect(st.stats.population).toBeGreaterThan(200);
    expect(st.stats.jobsByDev[DevType.ID] + st.stats.jobsByDev[DevType.IM]).toBeGreaterThan(20);
  });

  it('no road → no growth', () => {
    const { st, sim, A } = makeCity();
    A.zone({ x0: 10, z0: 10, x1: 30, z1: 30 }, Zone.ResLow);
    sim.runDays(60);
    expect(st.buildings.size).toBe(0);
  });

  it('town grows into thousands within a few years and taxes pay (medium difficulty)', () => {
    const { st, sim, A } = town();
    A.zone({ x0: 5, z0: 5, x1: 58, z1: 30 }, Zone.ResLow);
    A.zone({ x0: 5, z0: 32, x1: 31, z1: 58 }, Zone.ComLow);
    A.zone({ x0: 32, z0: 32, x1: 58, z1: 58 }, Zone.IndMed);
    sim.runDays(360 * 2);
    expect(st.stats.population).toBeGreaterThan(1500);
    const bd = computeMonthlyBudget(st, null);
    expect(bd.income['tax:R$'] + bd.income['tax:R$$']).toBeGreaterThan(0);
    expect(st.history.pop.length).toBe(24);
    // rewards progress
    const mh = listRewards(st).find((r) => r.id === 'mayor_house')!;
    expect(mh.unlocked).toBe(st.stats.population >= 1200);
  });

  it('population milestones gate tower stages', () => {
    expect(popMaxStage(0)).toBe(3);
    expect(popMaxStage(1e6)).toBe(8);
    expect(popMaxStage(20000)).toBeLessThan(popMaxStage(300000));
  });
});

describe('budget', () => {
  it('monthly settlement: stable keys, funds change = Σ income − Σ expense', () => {
    const { st, sim, A } = town();
    A.plop('civ_police_station', 6, 6, 0);
    A.zone({ x0: 5, z0: 14, x1: 31, z1: 30 }, Zone.ResLow);
    sim.runDays(29);
    const f0 = st.funds;
    sim.runDays(1); // day 30 → monthly budget
    const inc = st.budget.lastIncome, exp = st.budget.lastExpense;
    let sum = 0;
    for (const k in inc) if (!k.startsWith('oneoff:')) sum += inc[k];
    for (const k in exp) if (!k.startsWith('oneoff:')) sum -= exp[k];
    expect(st.funds - f0).toBeCloseTo(sum, 0);
    expect(exp['service:police']).toBe(getDef('civ_police_station')!.upkeep);
    expect(exp['transport:roads']).toBeGreaterThan(0);
    expect(exp['transport:avenues']).toBeGreaterThan(0);
    // funding scales upkeep
    A.setFunding('police', 50);
    expect(computeMonthlyBudget(st, null).expense['service:police']).toBe(Math.round(getDef('civ_police_station')!.upkeep! / 2));
  });

  it('bankruptcy warnings when broke', () => {
    const { st, sim } = makeCity();
    st.funds = -1000;
    sim.runDays(30 * 4);
    expect(econData(st).monthsNegative).toBeGreaterThanOrEqual(3);
    expect(st.news.some((n) => n.advisor === 'finance')).toBe(true);
  });
});

describe('public economy API (src/sim/economy/index.ts)', () => {
  it('demandInfo / listRewards / listOrdinances / budget forecast work on a fresh city', async () => {
    const api = await import('../../src/sim/economy/index');
    const { st, sim } = makeCity();
    sim.runDays(5);
    const di = api.demandInfo(st);
    expect(di.demand.length).toBe(12);
    expect(di.cap.every((c) => c > 0)).toBe(true);
    expect(api.listRewards(st).length).toBeGreaterThan(30);
    expect(api.listOrdinances(st).every((o) => typeof o.monthly === 'number')).toBe(true);
    expect(api.computeMonthlyBudget(st, null).totalExpense).toBeGreaterThanOrEqual(0);
    expect(api.loanOffer(st, 20000).ok).toBe(true);
    expect(api.serviceEffectiveness(st, 'police')).toBeCloseTo(1);
  });
});

describe('advisors', () => {
  it('a persistent problem backs off instead of repeating every cooldown', () => {
    const { st, sim, A } = makeCity();
    A.zone({ x0: 5, z0: 5, x1: 30, z1: 30 }, Zone.ResLow); // zoned land but no power plant → "Nothing will grow without power!"
    sim.runDays(360 * 3);
    const n = st.news.filter((x) => x.text.startsWith('Nothing will grow without power')).length;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(5); // 60, 120, 240, 480 day back-off → ≤ 5 in 3 years
  });
});
