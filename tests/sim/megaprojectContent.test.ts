/** LG-03: exercise CONTENT's real definitions through the construction and opt-in mayor paths. */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import { BF } from '../../src/sim/CityState';
import { CATALOG, getDef } from '../../src/sim/catalog';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import { lPath } from '../../src/sim/actions';
import { budgetSystem, computeMonthlyBudget, estimateUtilities } from '../../src/sim/economy/budget';
import {
  completedProject, expoDrawMultiplier, firstProjectInstallment, PROJECT_INSTALLMENTS,
  projectAvailable, projectList, projectsSystem,
} from '../../src/sim/economy/projects';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { tourismSystem, venueVisits } from '../../src/sim/economy/tourism';
import { UTIL_FIXED } from '../../src/sim/economy/tuning';
import { UtilitiesSystem } from '../../src/sim/infra/utilities';
import { SimBot, type BotOptions } from '../../tools/simbot';
import { makeCity } from './helpers';

const ids = ['tr_express_metro', 'util_fusion_plant', 'lm_world_expo'] as const;

function definition(id: typeof ids[number]): BuildingDef {
  const def = getDef(id);
  expect(def).toBeDefined();
  return def!;
}

function city() {
  const rt = new EconRuntime();
  return { ...makeCity({ startFunds: 20_000_000 }, [projectsSystem(), budgetSystem(rt)]), rt };
}

function openGates(c: ReturnType<typeof city>) {
  c.st.stats.population = 1_000_000;
  c.st.stats.eq = 125;
  c.st.stats.attractiveness = 80;
}

function addStations(c: Pick<ReturnType<typeof city>, 'A'>, count = 6) {
  const stations = [];
  for (let i = 0; i < count; i++) {
    expect(c.A.plop('tr_subway_station', 40 + i * 2, 4, 0).ok).toBe(true);
    stations.push([40 + i * 2, 4]);
  }
  return stations;
}

function bot(opts: Partial<BotOptions> = {}) {
  const rt = new EconRuntime();
  const b = new SimBot({ size: 96, years: 1, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0,
    quiet: true, noInfra: true, ...opts }, [projectsSystem(), budgetSystem(rt)]);
  b.st.heights.fill(5);
  b.st.water.fill(0);
  b.st.trees.fill(0);
  b.setup();
  b.st.day = 30 * 360;
  b.st.funds = 40_000_000;
  b.st.stats.population = 1_000_000;
  b.st.stats.eq = 125;
  b.st.stats.attractiveness = 80;
  b.st.budget.lastIncome = { 'tax:R$': 20_000 };
  b.st.budget.lastExpense = { 'service:police': 10_000 };
  return b;
}

describe('production mega-project definitions', () => {
  it('uses the settled prices, durations and gates, with only implemented operating fields', () => {
    expect(definition('tr_express_metro')).toMatchObject({ category: 'transport', service: 'transit',
      cost: 1_500_000, buildMonths: 18, unique: true,
      project: { kind: 'expressMetro', population: 300_000, stations: 6 } });
    expect(definition('util_fusion_plant')).toMatchObject({ category: 'power', service: 'utilities',
      cost: 4_000_000, buildMonths: 30, unique: true, powerOut: 4_000, jobs: 600, upkeep: 40_000,
      project: { kind: 'fusion', population: 750_000, education: 120 } });
    expect(definition('util_fusion_plant').pollution?.air ?? 0).toBe(0);
    expect(definition('lm_world_expo')).toMatchObject({ category: 'landmark',
      cost: 3_000_000, buildMonths: 24, unique: true,
      project: { kind: 'expo', population: 800_000, attractiveness: 70 } });
    for (const id of ['tr_express_metro', 'lm_world_expo'] as const) {
      expect(definition(id).jobs).toBeUndefined();
      expect(definition(id).upkeep).toBeUndefined();
    }
    expect(CATALOG.filter((d) => d.project).map((d) => d.id).sort()).toEqual([...ids].sort());
    expect(CATALOG.some((d) => d.project?.kind === 'spaceCenter')).toBe(false);
  });

  it.each(ids)('%s enforces its exact population boundary through the real placement action', (id) => {
    const c = city(), def = definition(id);
    openGates(c);
    addStations(c);
    c.st.stats.population = def.project!.population - 1;
    const funds = c.st.funds, buildings = c.st.buildings.size;
    expect(projectAvailable(c.st, def)).toMatch(/residents/);
    expect(c.A.startProject(id, 4, 20, 0)).toMatchObject({ ok: false, reason: expect.stringContaining('residents') });
    expect(c.st.funds).toBe(funds);
    expect(c.st.buildings.size).toBe(buildings);
    expect(c.st.systemData.projects).toBeUndefined();
    c.st.stats.population++;
    expect(projectAvailable(c.st, def)).toBeUndefined();
    expect(c.A.startProject(id, 4, 20, 0, true)).toMatchObject({ ok: true, cost: firstProjectInstallment(def) });
    expect(c.st.systemData.projects).toBeUndefined();
  });

  it('Express Metro requires six completed, operating subway stations', () => {
    const c = city(), def = definition('tr_express_metro');
    openGates(c);
    addStations(c, 5);
    expect(c.A.startProject(def.id, 4, 20, 0).reason).toBe('Needs 6 subway stations');
    expect(c.A.plop('tr_subway_station', 50, 4, 0).ok).toBe(true);
    const sixth = c.st.buildingAt(50, 4)!;
    for (const flag of [BF.Constructing, BF.Burnt, BF.Abandoned]) {
      sixth.flags |= flag;
      expect(projectAvailable(c.st, def)).toBe('Needs 6 subway stations');
      sixth.flags &= ~flag;
    }
    sixth.built = 0.99;
    expect(projectAvailable(c.st, def)).toBe('Needs 6 subway stations');
    sixth.built = 1;
    expect(c.A.startProject(def.id, 4, 20, 0).ok).toBe(true);
    expect(c.A.startProject(def.id, 20, 20, 0).reason).toMatch(/Only one/);
  });

  it('Fusion and Expo enforce their quality boundaries without an unrelated reward unlock', () => {
    for (const [id, stat, threshold, reason] of [
      ['util_fusion_plant', 'eq', 120, 'Needs EQ 120'],
      ['lm_world_expo', 'attractiveness', 70, 'Needs attractiveness 70'],
    ] as const) {
      const c = city(), def = definition(id);
      openGates(c);
      c.st.stats[stat] = threshold - 0.01;
      expect(projectAvailable(c.st, def)).toBe(reason);
      expect(c.A.startProject(id, 4, 20, 0)).toMatchObject({ ok: false, reason });
      c.st.stats[stat] = threshold;
      expect(projectAvailable(c.st, def)).toBeUndefined();
      expect(c.A.startProject(id, 4, 20, 0).ok).toBe(true);
      expect(c.A.startProject(id, 20, 20, 0).ok).toBe(false);
    }
  });
});

describe('production mega-project effects', () => {
  it('Fusion charges the real first installment and starts its 4,000 MW, 600 job places and upkeep only on opening', () => {
    const c = city(), def = definition('util_fusion_plant');
    const utilities = new UtilitiesSystem();
    utilities.init(c.sim);
    openGates(c);
    const funds = c.st.funds;
    expect(c.A.startProject(def.id, 4, 4, 0)).toMatchObject({ ok: true, cost: 133_333 });
    const p = projectList(c.st)[0], b = c.st.buildings.get(p.buildingId)!;
    expect(c.st.funds).toBe(funds - 133_333);
    expect(b).toMatchObject({ built: 0, capacity: 0, jobs: 0 });
    expect(c.st.budget.curExpense[PROJECT_INSTALLMENTS]).toBe(133_333);
    estimateUtilities(c.st, c.rt);
    expect(c.st.stats.powerSupply).toBe(0);
    utilities.compute(c.sim);
    expect(c.st.stats.powerSupply).toBe(0);
    expect(computeMonthlyBudget(c.st, c.rt).expense['service:utilities']).toBeUndefined();
    c.sim.runDays(899);
    expect(b.built).toBeLessThan(1);
    expect(b.capacity).toBe(0);
    expect(completedProject(c.st, 'fusion')).toBe(false);
    estimateUtilities(c.st, c.rt);
    expect(c.st.stats.powerSupply).toBe(0);
    utilities.compute(c.sim);
    expect(c.st.stats.powerSupply).toBe(0);
    expect(computeMonthlyBudget(c.st, c.rt).expense['service:utilities']).toBeUndefined();
    c.sim.runDays(1);
    expect(b).toMatchObject({ built: 1, capacity: 600 });
    expect(b.flags & BF.Constructing).toBe(0);
    expect(p).toMatchObject({ progressDays: 900, paid: 4_000_000, completedDay: 900 });
    expect(completedProject(c.st, 'fusion')).toBe(true);
    estimateUtilities(c.st, c.rt);
    expect(c.st.stats.powerSupply).toBe(4_000);
    utilities.compute(c.sim);
    expect(c.st.stats.powerSupply).toBe(4_000);
    expect(c.st.stats.powerDemand).toBe(0);
    expect(computeMonthlyBudget(c.st, c.rt).expense['service:utilities']).toBe(40_000 * UTIL_FIXED);
  });

  it('the real Expo opens a twelve-month citywide draw window and keeps its once-per-city history after demolition', () => {
    const c = city(), def = definition('lm_world_expo');
    const tourism = tourismSystem(c.rt);
    tourism.init?.(c.sim);
    openGates(c);
    expect(c.A.plop('park_plaza', 4, 4, 0).ok).toBe(true);
    const venue = c.st.buildingAt(4, 4)!;
    expect(c.A.startProject(def.id, 12, 12, 0).ok).toBe(true);
    const p = projectList(c.st)[0], b = c.st.buildings.get(p.buildingId)!;
    const gross = (day: number) => {
      c.st.day = day;
      econData(c.st).attractiveness = 60;
      tourism.refresh(c.sim);
      return venueVisits(c.st, venue.id)!.gross;
    };
    c.sim.runDays(719);
    const normal = gross(c.st.day);
    expect(normal).toBeGreaterThan(0);
    expect(expoDrawMultiplier(c.st)).toBe(1);
    c.sim.runDays(1);
    expect(p).toMatchObject({ completedDay: 720, paid: 3_000_000 });
    expect(gross(720)).toBeCloseTo(normal * 1.5, 10);
    expect(gross(1079)).toBeCloseTo(normal * 1.5, 10);
    expect(gross(1080)).toBe(normal);
    expect(expoDrawMultiplier(c.st)).toBe(1);
    expect(c.A.bulldoze({ x0: b.x, z0: b.z, x1: b.x + b.w, z1: b.z + b.d }).ok).toBe(true);
    expect(c.st.buildings.has(b.id)).toBe(false);
    expect(projectList(c.st)[0].completedDay).toBe(720);
    expect(c.A.startProject(def.id, b.x, b.z, 0).reason).toMatch(/commissioned/);
  });
});

describe('bot with production mega-project content', () => {
  it('discovers no candidates by default and all three live production projects when opted in', () => {
    const ordinary = bot();
    expect(ordinary.projectCandidates()).toEqual([]);
    ordinary.saveForProjects(); ordinary.megaprojects();
    expect(ordinary.st.systemData.projects).toBeUndefined();
    const opted = bot({ megaprojects: true });
    expect(opted.projectCandidates().map((d) => d.id)).toEqual(['tr_express_metro', 'lm_world_expo', 'util_fusion_plant']);
    expect(opted.projectReport.missingKinds).toEqual(['spaceCenter']);
  });

  it('places and finishes all three real projects on a funded developed map with their actual gates', () => {
    const b = bot({ megaprojects: true });
    expect(b.A.buildNetwork(lPath({ x: 10, z: 4 }, { x: 70, z: 4 }), Network.Road).ok).toBe(true);
    expect(b.A.buildSubway(lPath({ x: 10, z: 5 }, { x: 70, z: 5 })).ok).toBe(true);
    for (let x = 10; x <= 60; x += 10) expect(b.A.plop('tr_subway_station', x, 5, 0).ok).toBe(true);
    for (const [index, id] of ['tr_express_metro', 'lm_world_expo', 'util_fusion_plant'].entries()) {
      const def = getDef(id)!;
      expect(projectAvailable(b.st, def)).toBeUndefined();
      b.saveForProjects(); b.megaprojects();
      expect(projectList(b.st)).toHaveLength(index + 1);
      const p = projectList(b.st)[index], site = b.st.buildings.get(p.buildingId)!;
      expect(p.def).toBe(id);
      expect(p.paid).toBe(firstProjectInstallment(def));
      expect(b.walkableLot(site.x, site.z, site.w, site.d)).toBe(true);
      expect(site.built).toBe(0);
      b.megaprojects();
      expect(projectList(b.st)).toHaveLength(index + 1);
      b.sim.runDays(def.buildMonths! * 30);
      expect(site.built).toBe(1);
      expect(p.paid).toBe(def.cost);
      expect(p.completedDay).toBe(b.st.day);
      expect(b.st.funds).toBeGreaterThanOrEqual(0);
    }
    b.saveForProjects();
    expect(b.projectCandidates()).toEqual([]);
    expect(b.projectReport).toMatchObject({ completed: 3, completed2030To2060: 3, active: 0,
      saving: false, missingKinds: ['spaceCenter'] });
    expect(projectList(b.st).reduce((paid, p) => paid + p.paid, 0)).toBe(8_500_000);
  });
});
