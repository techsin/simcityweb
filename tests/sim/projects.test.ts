import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOG, rebuildCatalogIndex } from '../../src/sim/catalog';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import { BF } from '../../src/sim/CityState';
import { Simulation } from '../../src/sim/Simulation';
import { CityActions } from '../../src/sim/actions';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import { decodeBundle, encodeBundle } from '../../src/save/bundle';
import { computeMonthlyBudget, estimateUtilities, budgetSystem } from '../../src/sim/economy/budget';
import { EconRuntime } from '../../src/sim/economy/runtime';
import { lvSplatFactor } from '../../src/sim/economy/landValue';
import { removeBuilding } from '../../src/sim/economy/buildings';
import {
  cancelProject, completedProject, nextProjectInstallment, PROJECT_INSTALLMENTS, projectAvailable,
  payProjectInstallments, projectList, projectPauseReason, projectsSystem,
} from '../../src/sim/economy/projects';
import { economySystems } from '../../src/sim/systems/economy';
import { makeCity } from './helpers';
import { UTIL_FIXED } from '../../src/sim/economy/tuning';

const def: BuildingDef = {
  id: 'test_project_fusion', name: 'Test Fusion', model: 'pwr_nuclear', category: 'power', footprint: [2, 2],
  cost: 1001, buildMonths: 3, upkeep: 400, jobs: 600, powerOut: 4000, unique: true,
  landValue: { amount: 0.2, radius: 3 }, project: { kind: 'fusion', population: 0 },
};
const otherDef: BuildingDef = { ...def, id: 'test_project_expo', project: { kind: 'expo', population: 0 } };
beforeAll(() => { CATALOG.push(def, otherDef); rebuildCatalogIndex(); });
afterAll(() => {
  CATALOG.splice(CATALOG.indexOf(def), 1);
  CATALOG.splice(CATALOG.indexOf(otherDef), 1);
  rebuildCatalogIndex();
});

function city() {
  const rt = new EconRuntime();
  const c = makeCity({ startFunds: 10000 }, [projectsSystem(), budgetSystem(rt)]);
  return { ...c, rt };
}
function start(c: ReturnType<typeof city>, day = 0) {
  c.st.day = day;
  expect(c.A.startProject(def.id, 4, 4, 0).ok).toBe(true);
  return [...c.st.buildings.values()][0];
}

function snapshot(st: Simulation['state']) {
  return { ...serializeCity(st, { copy: true }), savedAt: 0 };
}

describe('mega-project construction and financing', () => {
  it('previews without writes or RNG, charges only the first installment, and leaves a non-operating site', () => {
    const c = city(), rng = c.sim.rng.state;
    const before = structuredClone(snapshot(c.st));
    expect(c.A.startProject(def.id, 4, 4, 0, true)).toMatchObject({ ok: true, cost: 334 });
    expect(snapshot(c.st)).toEqual(before);
    const b = start(c);
    expect(c.st.funds).toBe(9666);
    expect(b).toMatchObject({ built: 0, capacity: 0, jobs: 0 });
    expect(b.flags & BF.Constructing).toBeTruthy();
    expect(projectList(c.st)[0]).toMatchObject({ totalDays: 90, progressDays: 0, paid: 334, paidDays: 30 });
    expect(c.st.budget.curExpense[PROJECT_INSTALLMENTS]).toBe(334);
    expect(c.sim.rng.state).toBe(rng);
    expect(computeMonthlyBudget(c.st, c.rt).expense['service:civic']).toBeUndefined();
    estimateUtilities(c.st, c.rt);
    expect(c.st.stats.powerSupply).toBe(0);
    expect(lvSplatFactor(c.st, b)).toBe(0);
    expect(completedProject(c.st, 'fusion')).toBe(false);
  });

  it('pays the exact price with rounded installments and opens on the exact funded day', () => {
    const c = city(), b = start(c);
    c.sim.runDays(30);
    expect(projectList(c.st)[0]).toMatchObject({ progressDays: 30, paid: 667, paidDays: 60 });
    expect(c.st.budget.lastExpense[PROJECT_INSTALLMENTS]).toBe(667); // first payment plus month-end payment
    c.sim.runDays(59);
    expect(b.built).toBeLessThan(1);
    expect(projectList(c.st)[0].paid).toBe(1001);
    c.sim.runDays(1);
    expect(b).toMatchObject({ built: 1, capacity: 600 });
    expect(b.flags & BF.Constructing).toBe(0);
    expect(projectList(c.st)[0]).toMatchObject({ progressDays: 90, completedDay: 90, paid: 1001 });
    expect(completedProject(c.st, 'fusion')).toBe(true);
    expect(nextProjectInstallment(c.st)).toBe(0);
    expect(c.st.funds).toBe(10000 - 1001 - 400 * UTIL_FIXED);
    estimateUtilities(c.st, c.rt);
    expect(c.st.stats.powerSupply).toBe(4000);
  });

  it('a start between month boundaries still takes exactly buildMonths times 30 days', () => {
    const c = city(), b = start(c, 17);
    c.sim.runDays(89);
    expect(b.built).toBeLessThan(1);
    c.sim.runDays(1);
    expect(projectList(c.st)[0].completedDay).toBe(107);
    expect(projectList(c.st)[0].paid).toBe(1001);
  });

  it('pauses before an unaffordable installment, never overdraws, and resumes only on a funded month', () => {
    const c = city(), b = start(c);
    c.st.funds = 332; // second installment is 333
    c.sim.runDays(30);
    expect(c.st.funds).toBe(332);
    expect(c.st.budget.lastExpense[PROJECT_INSTALLMENTS]).toBe(334); // placement payment only
    expect(projectList(c.st)[0]).toMatchObject({ progressDays: 30, paid: 334, paused: true });
    expect(projectPauseReason(c.st, b.id)).toBe('Paused: needs §333 this month');
    c.sim.runDays(29);
    expect(projectList(c.st)[0].progressDays).toBe(30);
    c.st.funds = 333;
    c.sim.runDays(1);
    expect(c.st.funds).toBe(0);
    expect(projectList(c.st)[0]).toMatchObject({ progressDays: 30, paid: 667, paused: false });
    c.sim.runDays(1);
    expect(projectList(c.st)[0].progressDays).toBe(31);
    expect(b.built).toBe(Math.fround(31 / 90));
  });

  it('gives ordinary city expenses priority over installments, and forecasts without changing progress', () => {
    const c = city();
    start(c);
    expect(c.A.plop('park_small', 10, 10, 0).ok).toBe(true);
    const normal = computeMonthlyBudget(c.st, c.rt).totalExpense - nextProjectInstallment(c.st);
    const snapshot = structuredClone(projectList(c.st));
    expect(computeMonthlyBudget(c.st, c.rt).expense[PROJECT_INSTALLMENTS]).toBe(333);
    expect(projectList(c.st)).toEqual(snapshot);
    c.st.funds = 333 + normal - 1;
    c.sim.runDays(30);
    expect(c.st.funds).toBe(332);
    expect(projectList(c.st)[0].paused).toBe(true);
  });

  it('stops prepaid work as soon as a calendar installment is missed, including a late-month start', () => {
    const c = city();
    start(c, 29);
    c.st.funds = 332;
    c.sim.runDays(10);
    expect(projectList(c.st)[0]).toMatchObject({ progressDays: 1, paidDays: 30, paused: true });
    expect(c.st.funds).toBe(332);
  });

  it('settles concurrent contracts in order without overdrawing or paying twice in one month', () => {
    const c = city();
    start(c);
    expect(c.A.startProject(otherDef.id, 10, 10, 0).ok).toBe(true);
    c.st.funds = 500;
    c.sim.runDays(30);
    expect(c.st.funds).toBe(167);
    expect(projectList(c.st).map((p) => [p.paid, p.paused])).toEqual([[667, false], [334, true]]);
    expect(payProjectInstallments(c.sim)).toBe(0);
    expect(c.st.funds).toBe(167);
  });

  it('reserves the first installment and refuses locked, invalid, or duplicate projects without writes', () => {
    const c = city();
    c.st.funds = 333;
    expect(c.A.startProject(def.id, 4, 4, 0).ok).toBe(false);
    expect(c.st.systemData.projects).toBeUndefined();
    expect(c.A.startProject('park_small', 4, 4, 0).ok).toBe(false);
    const gated = { ...def, project: { kind: 'fusion' as const, population: 750000, education: 120 } };
    expect(projectAvailable(c.st, gated)).toMatch(/750,000/);
    c.st.stats.population = 750000;
    expect(projectAvailable(c.st, gated)).toBe('Needs EQ 120');
    c.st.stats.eq = 120;
    expect(projectAvailable(c.st, gated)).toBeUndefined();
    expect(projectAvailable(c.st, { ...def, buildMonths: 0 })).toMatch(/Invalid/);
    c.st.funds = 10000;
    start(c);
    expect(c.A.startProject(def.id, 12, 12, 0).reason).toMatch(/Only one/);
  });

  it('cancel and bulldoze both refund half paid money, with no full-price or repeated-refund exploit', () => {
    for (const bulldoze of [false, true]) {
      const c = city(), b = start(c);
      const funds = c.st.funds;
      expect(cancelProject(c.sim, b.id, true)).toMatchObject({ cost: -167, refund: 167 });
      expect(c.st.funds).toBe(funds);
      const r = bulldoze ? c.A.bulldoze({ x0: 4, z0: 4, x1: 6, z1: 6 }) : c.A.cancelProject(b.id);
      expect(r).toMatchObject({ ok: true, cost: -167, refund: 167 });
      expect(c.st.funds).toBe(funds + 167);
      expect(c.st.buildingAt(4, 4)).toBeUndefined();
      expect(projectList(c.st)).toHaveLength(0);
      expect(c.A.cancelProject(b.id).ok).toBe(false);
      expect(c.st.budget.curIncome['oneoff:refund']).toBe(167);
    }
  });

  it('cancel after later installments refunds half the actual paid amount, including fractional money', () => {
    const c = city(), b = start(c);
    c.sim.runDays(30);
    expect(c.A.cancelProject(b.id)).toMatchObject({ cost: -333.5, refund: 333.5 });
    expect(nextProjectInstallment(c.st)).toBe(0);
  });

  it('completed projects cannot be cancelled; only Expo is once per city after demolition', () => {
    const c = city(), b = start(c);
    c.sim.runDays(90);
    expect(c.A.cancelProject(b.id).ok).toBe(false);
    c.A.bulldoze({ x0: 4, z0: 4, x1: 6, z1: 6 });
    expect(completedProject(c.st, 'fusion')).toBe(false);
    expect(projectList(c.st)[0].completedDay).toBe(90);
    expect(c.A.startProject(def.id, 4, 4, 0).ok).toBe(true);
    expect(c.A.startProject(otherDef.id, 10, 10, 0).ok).toBe(true);
    c.sim.runDays(90);
    c.A.bulldoze({ x0: 10, z0: 10, x1: 12, z1: 12 });
    expect(c.A.startProject(otherDef.id, 10, 10, 0).reason).toMatch(/commissioned/);
  });

  it('prunes externally removed unfinished contracts and allows another site without a refund', () => {
    const c = city(), b = start(c), funds = c.st.funds;
    removeBuilding(c.sim, b);
    c.sim.runDays(1);
    expect(projectList(c.st)).toHaveLength(0);
    expect(c.st.funds).toBe(funds);
    expect(c.A.startProject(def.id, 14, 14, 0).ok).toBe(true);
  });

  it('sandbox construction advances without changing funds, and cancellation cannot mint money', () => {
    const c = city();
    c.st.config.sandbox = true;
    const funds = c.st.funds, b = start(c);
    c.sim.runDays(60);
    expect(projectList(c.st)[0].paid).toBe(1001);
    expect(c.st.funds).toBe(funds);
    c.A.cancelProject(b.id);
    expect(c.st.funds).toBe(funds);
  });
});

describe('project persistence and idle compatibility', () => {
  it.each([false, true])('restores exact progress and resumes the same payments, paused=%s', (paused) => {
    const c = city();
    start(c, 17);
    c.sim.runDays(paused ? 43 : 37);
    if (paused) { c.st.funds = 0; c.sim.runDays(30); }
    const saved = structuredClone(projectList(c.st));
    const copy = deserializeCity(decodeBundle(encodeBundle(serializeCity(c.st))) as SerializedCity);
    const rt = new EconRuntime();
    const sim = new Simulation(copy, [projectsSystem(), budgetSystem(rt)]);
    expect(projectList(copy)).toEqual(saved);
    const id = saved[0].buildingId;
    expect(copy.buildings.get(id)!.built).toBe(c.st.buildings.get(id)!.built);
    c.st.funds = copy.funds = 10000;
    for (let i = 0; i < 120; i++) {
      c.sim.advanceDay(); sim.advanceDay();
      expect(projectList(copy)).toEqual(projectList(c.st));
      expect(copy.funds).toBe(c.st.funds);
      expect(copy.buildings.get(id)!.built).toBe(c.st.buildings.get(id)!.built);
    }
  });

  it.each(['medium', 'hard'] as const)('idle projects leave old %s saves, RNG and default economy state identical', (difficulty) => {
    const c = makeCity({ difficulty }, []);
    const saved = serializeCity(c.st, { copy: true });
    const a = new Simulation(deserializeCity(structuredClone(saved)), economySystems());
    const b = new Simulation(deserializeCity(structuredClone(saved)), economySystems().filter((s) => s.name !== 'economy.projects'));
    a.runDays(61); b.runDays(61);
    expect(a.state.systemData.projects).toBeUndefined();
    expect(a.rng.state).toBe(b.rng.state);
    expect(snapshot(a.state)).toEqual(snapshot(b.state));
  });

  it('stays in the real economy installation without ordinary population construction advancing it', () => {
    const c = makeCity({ startFunds: 10000 }, economySystems());
    const b = start(c as ReturnType<typeof city>);
    c.sim.runDays(12);
    expect(projectList(c.st)[0].progressDays).toBe(12);
    expect(b.built).toBe(Math.fround(12 / 90));
    expect(b.jobs).toBe(0);
    expect(b.capacity).toBe(0);
  });
});
