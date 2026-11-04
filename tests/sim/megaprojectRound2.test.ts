/** NOTE-056: the live content uses only the round-2 framework and ordinary operating fields. */
import { describe, expect, it } from 'vitest';
import { DAYS_PER_MONTH } from '../../src/core/constants';
import { Network } from '../../src/core/types';
import { lPath } from '../../src/sim/actions';
import { BF } from '../../src/sim/CityState';
import { capReliefOf, getDef } from '../../src/sim/catalog';
import { defaultCityConfig } from '../../src/sim/config';
import { approvalSystem } from '../../src/sim/economy/approval';
import { budgetSystem } from '../../src/sim/economy/budget';
import { expoDrawMultiplier, projectList, projectsSystem } from '../../src/sim/economy/projects';
import { EconRuntime, econData } from '../../src/sim/economy/runtime';
import { ATTRACTIONS, tourismSystem, venueVisits } from '../../src/sim/economy/tourism';
import { createCityState } from '../../src/sim/terrainGen';
import { LocalSimHost } from '../../src/worker/SimHost';
import { makeCity } from './helpers';

describe('round-2 mega-project content scope', () => {
  it('Local Fusion supplies zero MW throughout every construction month, then its catalog output to the connected grid', { timeout: 30_000 }, async () => {
    const st = createCityState(defaultCityConfig({ size: 32, seed: 7, terrain: 'flat', waterAmount: 0,
      treeDensity: 0, disasters: false, sandbox: true }));
    st.heights.fill(5);
    st.water.fill(0);
    const errors: unknown[] = [];
    const host = new LocalSimHost(st, { initialSpeed: 0, errors: { report: (...args) => errors.push(args) } });
    const def = getDef('util_fusion_plant')!;
    const owner = {}, gesture = host.beginGesture(owner);
    try {
      await host.start();
      expect(host.degradedActions).toBe(false);
      expect((await host.act('buildNetwork', [lPath({ x: 2, z: 12 }, { x: 22, z: 12 }), Network.Road],
        { tag: owner, gesture }).done).ok).toBe(true);
      expect((await host.act('plop', ['civ_library', 14, 13, 0], { tag: owner, gesture }).done).ok).toBe(true);
      expect((await host.act('plop', [def.id, 4, 13, 0], { tag: owner, gesture }).done).ok).toBe(true);
      const project = projectList(st)[0], site = st.buildings.get(project.buildingId)!;
      const library = st.buildingAt(14, 13)!;
      const grid = async () => (await host.query('inspectCell', { x: 14, z: 13, sections: ['environment'] }))?.environment?.grid;
      const constructionDays = def.buildMonths! * DAYS_PER_MONTH;
      expect(site.built).toBe(0);
      expect(st.stats.powerSupply).toBe(0);
      for (let day = 1; day < constructionDays; day++) {
        host.sim.runDays(1);
        expect(site.built, `construction day ${day}`).toBeLessThan(1);
        expect(st.stats.powerSupply, `construction day ${day}`).toBe(0);
        if (day % DAYS_PER_MONTH === 0 || day === constructionDays - 1) {
          expect(project.progressDays).toBe(day);
          expect(project.completedDay).toBeUndefined();
          expect(await grid(), `construction day ${day}`).toMatchObject({ supply: 0 });
          expect(library.flags & BF.Powered).toBe(0);
        }
      }
      host.sim.runDays(1);
      expect(site.built).toBe(1);
      expect(site.flags & BF.Constructing).toBe(0);
      expect(project).toMatchObject({ progressDays: constructionDays, completedDay: constructionDays, paid: def.cost });
      // Utilities runs before construction and publishes on its ordinary refresh; do not force a recompute.
      for (let day = 0; day < DAYS_PER_MONTH && (st.stats.powerSupply !== def.powerOut || !(library.flags & BF.Powered)); day++) host.sim.runDays(1);
      expect(st.stats.powerSupply).toBe(def.powerOut);
      expect(await grid()).toMatchObject({ supply: def.powerOut, shortage: false });
      expect(library.flags & BF.Powered).toBe(BF.Powered);
      expect(errors).toEqual([]);
    } finally {
      gesture.end();
      await host.dispose();
    }
  });

  it('Expo only activates the existing draw hook, without its own attraction, other catalog effects or a direct approval bonus', () => {
    const def = getDef('lm_world_expo')!;
    expect(def).toEqual({ id: def.id, name: def.name, model: def.model, footprint: def.footprint,
      category: 'landmark', cost: 3_000_000, buildMonths: 24, unique: true, description: def.description,
      project: { kind: 'expo', population: 800_000, attractiveness: 70 } });
    expect(ATTRACTIONS[def.id]).toBeUndefined();
    expect(capReliefOf(def.id)).toBeUndefined();
    const rt = new EconRuntime();
    const c = makeCity({ sandbox: true }, [projectsSystem(), budgetSystem(rt)]);
    const tourism = tourismSystem(rt), approval = approvalSystem(rt);
    tourism.init?.(c.sim);
    approval.init?.(c.sim);
    expect(c.A.startProject(def.id, 4, 4, 0).ok).toBe(true);
    const project = projectList(c.st)[0];
    c.sim.runDays(def.buildMonths! * DAYS_PER_MONTH - 1);
    expect(expoDrawMultiplier(c.st)).toBe(1);
    const score = () => {
      // Ordinary visitor pride remains valid; hold that input fixed to detect a direct Expo bonus.
      econData(c.st).tourists = 1000;
      approval.monthly?.(c.sim);
      return { raw: econData(c.st).approvalRaw, terms: { ...econData(c.st).approvalTerms } };
    };
    const before = score();
    const approvalBeforeOpening = c.st.stats.approval;
    c.sim.runDays(1);
    expect(project.completedDay).toBe(c.st.day);
    expect(c.st.stats.approval).toBe(approvalBeforeOpening);
    expect(expoDrawMultiplier(c.st)).toBe(1.5);
    tourism.refresh(c.sim);
    expect(venueVisits(c.st, project.buildingId)).toBeNull();
    expect(econData(c.st).tourists).toBe(0);
    expect(c.st.stats.tourists).toBe(0);
    expect(score()).toEqual(before);
  });
});
