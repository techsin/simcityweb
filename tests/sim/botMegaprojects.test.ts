/** LG-03: the project mayor is opt-in; CONTENT definitions in these strategy tests are fixtures only. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimBot, USAGE, parseArgs, type BotOptions } from '../../tools/simbot';
import { CATALOG, getDef, rebuildCatalogIndex } from '../../src/sim/catalog';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import { PROJECT_INSTALLMENTS, projectList, nextProjectInstallment } from '../../src/sim/economy/projects';
import { lPath, type Cell } from '../../src/sim/actions';
import { Network } from '../../src/core/types';

const added: BuildingDef[] = [];
const productionProjects: { def: BuildingDef; index: number }[] = [];
beforeEach(() => {
  for (let index = CATALOG.length - 1; index >= 0; index--) {
    const def = CATALOG[index];
    if (def.buildMonths === undefined && !def.project) continue;
    productionProjects.unshift({ def, index });
    CATALOG.splice(index, 1);
  }
  rebuildCatalogIndex();
});
afterEach(() => {
  for (const def of added.splice(0)) CATALOG.splice(CATALOG.indexOf(def), 1);
  for (const { def, index } of productionProjects.splice(0)) CATALOG.splice(index, 0, def);
  rebuildCatalogIndex();
  vi.restoreAllMocks();
});

function project(kind: NonNullable<BuildingDef['project']>['kind'] = 'fusion', cost = 180000, population = 100): BuildingDef {
  const def: BuildingDef = { ...getDef('park_small')!, id: `test_bot_project_${kind}`, name: `Test ${kind}`,
    cost, upkeep: 0, requires: undefined, unique: true, buildMonths: 18, project: { kind, population } };
  CATALOG.push(def); added.push(def); rebuildCatalogIndex();
  return def;
}

function bot(opts: Partial<BotOptions> = {}) {
  const b = new SimBot({ size: 96, years: 1, seed: 7, difficulty: 'medium', terrain: 'plains', water: 0,
    quiet: true, noInfra: true, megaprojects: true, ...opts }, []);
  b.setup();
  b.st.day = 30 * 360;
  b.st.funds = 120000;
  b.st.stats.population = 1000000;
  b.st.stats.eq = 150;
  b.st.stats.attractiveness = 80;
  b.st.budget.lastIncome = { 'tax:R$': 20000 };
  b.st.budget.lastExpense = { 'service:police': 10000, 'oneoff:construction': 500000 };
  return b;
}

describe('bot: mega-project strategy', () => {
  it('accepts the opt-in flag, documents its thresholds and leaves default options unchanged', () => {
    expect(parseArgs([]).megaprojects).toBeUndefined();
    expect(parseArgs(['--megaprojects', '--quiet', '--skip', 'transit'])).toMatchObject({ megaprojects: true, quiet: true, skip: ['transit'] });
    expect(USAGE).toContain('--megaprojects');
    expect(USAGE).toContain('12 months of expenses');
    expect(USAGE).toContain('at least 8 % while saving');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    expect(() => parseArgs(['--profile', 'newcomer', '--megaprojects'])).toThrow('exit');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('newcomer has its own'));
  });

  it('waits for twelve recurring expense months, then saves through the construction months', () => {
    project();
    const b = bot();
    b.st.funds--;
    b.saveForProjects(); b.megaprojects();
    expect(b.projectReport.saving).toBe(false);
    expect(projectList(b.st)).toHaveLength(0);
    b.st.funds++;
    b.saveForProjects(); b.megaprojects();
    expect(b.projectReport.saving).toBe(true);
    expect(projectList(b.st)).toHaveLength(1);
    const first = projectList(b.st)[0];
    expect(first.paid).toBe(10000);
    expect(b.st.buildings.get(first.buildingId)?.built).toBeLessThan(1);
    b.st.funds = 50000;
    b.saveForProjects(); b.megaprojects();
    expect(b.projectReport.saving).toBe(true);
    expect(projectList(b.st)).toHaveLength(1);
    expect(projectList(b.st)[0].paid).toBe(first.paid);
  });

  it('keeps all managed tax rates at least 8 % while saving, without changing a fixed tax experiment', () => {
    project();
    const b = bot();
    b.st.funds = 1e7;
    b.st.budget.taxRates.fill(7);
    b.saveForProjects(); b.finance();
    expect(b.st.budget.taxRates).toEqual(Array(12).fill(8));
    b.daily();
    expect(b.projectReport.lowestSavingTax).toBe(8);
    const fixed = bot({ tax: 7 });
    fixed.saveForProjects(); fixed.finance(); fixed.daily();
    expect(fixed.st.budget.taxRates).toEqual(Array(12).fill(7));
    expect(fixed.projectReport.lowestSavingTax).toBe(7);
  });

  it('leaves the next installment alone during optional purchases and starts only one project at a time', () => {
    project('fusion', 180000); project('expo', 360000);
    const b = bot();
    b.saveForProjects(); b.megaprojects(); b.saveForProjects();
    const next = nextProjectInstallment(b.st);
    expect(next).toBeGreaterThan(0);
    b.venueFund = 5000;
    b.st.funds = b.reserve() + b.venueFund + next + 500;
    expect(b.canSpend(1000)).toBe(true);
    expect(b.canSpendOpt(1000)).toBe(false);
    b.megaprojects();
    expect(projectList(b.st)).toHaveLength(1);
    expect(projectList(b.st)[0].kind).toBe('fusion');
  });

  it('skips locked definitions and retries a site failure without fabricating a project', () => {
    project('fusion', 100000, 1000001);
    const expo = project('expo', 180000);
    const b = bot();
    const plop = vi.spyOn(b.A, 'plop').mockReturnValue({ ok: false, cost: 10000, reason: 'No site' });
    b.saveForProjects(); b.megaprojects();
    expect(projectList(b.st)).toHaveLength(0);
    expect(plop).toHaveBeenCalled();
    expect(plop.mock.calls.every(([id]) => id === expo.id)).toBe(true);
    const attempts = plop.mock.calls.length;
    b.st.day += 30; b.megaprojects();
    expect(plop).toHaveBeenCalledTimes(attempts);
    plop.mockRestore();
    b.st.day += 360; b.megaprojects();
    expect(projectList(b.st).map((p) => p.kind)).toEqual(['expo']);
  });

  it('reports missing CONTENT definitions and daily acceptance inputs without inventing catalog entries', () => {
    const b = bot({ neglect: true });
    const definitions = CATALOG.slice();
    const expectedMissing = ['expressMetro', 'fusion', 'expo', 'spaceCenter'].filter((kind) => !definitions.some((d) => d.project?.kind === kind && d.buildMonths));
    b.st.budget.lastExpense[PROJECT_INSTALLMENTS] = 2000;
    expect(b.projectReport).toMatchObject({ bankMonths: 10, operatingBankMonths: 12 });
    b.st.funds = 123;
    b.st.stats.approval = 61;
    b.daily();
    b.st.funds = 456;
    b.st.stats.approval = 55;
    b.daily();
    expect(b.projectReport).toMatchObject({ completed: 0, completed2030To2060: 0, active: 0,
      lowestDailyBalance: 123, lowestApprovalFromYear30: 55, bestEqByYear30: 150, missingKinds: expectedMissing });
    expect(CATALOG).toEqual(definitions);
  });

  it('uses exact year-30 EQ and 2030–2060 completion boundaries', () => {
    project();
    const b = bot({ neglect: true });
    b.saveForProjects(); b.megaprojects();
    b.daily();
    b.st.day++;
    b.st.stats.eq = 200;
    b.daily();
    expect(b.projectReport.bestEqByYear30).toBe(150);
    const progress = projectList(b.st)[0];
    for (const day of [30 * 360, 60 * 360]) {
      progress.completedDay = day;
      expect(b.projectReport.completed2030To2060).toBe(1);
    }
    for (const day of [30 * 360 - 1, 60 * 360 + 1]) {
      progress.completedDay = day;
      expect(b.projectReport.completed2030To2060).toBe(0);
    }
  });

  it('finishes a line with fewer than six entrances only for mega-projects, respecting reserves and transit skips', () => {
    project('expressMetro');
    const lineTown = (opts: Partial<BotOptions> = {}) => {
      const b = bot(opts);
      b.st.funds = 1e6;
      expect(b.A.buildNetwork(lPath({ x: 10, z: 4 }, { x: 70, z: 4 }), Network.Road).ok).toBe(true);
      const path = lPath({ x: 10, z: 5 }, { x: 70, z: 5 });
      expect(b.A.buildSubway(path).ok).toBe(true);
      expect(b.A.plop('tr_subway_station', 10, 5, 0).ok).toBe(true);
      (b as unknown as { subwayLine: { paths: Cell[][]; stops: Cell[] } }).subwayLine = { paths: [path], stops: [] };
      return b;
    };
    const b = lineTown();
    b.st.funds = b.reserve();
    b.ensureProjectStations();
    expect(b.count('tr_subway_station')).toBe(1);
    b.st.funds = 1e6;
    b.ensureProjectStations();
    expect(b.count('tr_subway_station')).toBe(6);
    for (const station of b.st.buildings.values()) if (station.def === 'tr_subway_station') {
      expect(b.st.subway[station.z * b.N + station.x]).toBe(1);
      expect(b.walkableLot(station.x, station.z, station.w, station.d)).toBe(true);
    }
    const funds = b.st.funds;
    b.ensureProjectStations();
    expect(b.st.funds).toBe(funds);
    const ordinary = lineTown({ megaprojects: false, subway: true });
    ordinary.ensureProjectStations();
    expect(ordinary.count('tr_subway_station')).toBe(1);
    const skipped = lineTown({ skip: ['transit'] });
    skipped.ensureProjectStations();
    expect(skipped.count('tr_subway_station')).toBe(1);
  });

  it('leaves flags-off and newcomer direct calls free of catalog strategy scans, writes and RNG draws', () => {
    for (const opts of [{ megaprojects: false }, { profile: 'newcomer' as const }]) {
      const b = bot(opts);
      const values = vi.spyOn(b.st.buildings, 'values');
      const rng = vi.spyOn(b.sim.rng, 'next');
      const funds = b.st.funds, keys = Object.keys(b.st.systemData);
      b.saveForProjects(); b.megaprojects(); b.ensureProjectStations();
      expect(b.projectCandidates()).toEqual([]);
      expect(values).not.toHaveBeenCalled();
      expect(rng).not.toHaveBeenCalled();
      expect(b.st.funds).toBe(funds);
      expect(Object.keys(b.st.systemData)).toEqual(keys);
      values.mockRestore(); rng.mockRestore();
    }
  });
});
