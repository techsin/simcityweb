/** W0.3b: preserve the build/reward prices and the cursor's distinct marginal upkeep. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameContext } from '../../src/game/context';
import { allDefs, plopSpec, UNIQUE_BUILT_TEXT, UNIQUE_RUINS_TEXT, type ToolSpec } from '../../src/game/toolCatalog';
import { runQuery } from '../../src/worker/queries';
import { getDef } from '../../src/sim/catalog';
import type { BuildingDef } from '../../src/sim/catalogTypes';
import { BF, type Building } from '../../src/sim/CityState';
import { Simulation, type SimSystem } from '../../src/sim/Simulation';
import { money } from '../../src/ui/format';
import { RewardsPanel, type RuinState } from '../../src/ui/panels/ListPanels';
import { Toolbar } from '../../src/ui/Toolbar';
import { upkeepEstimate } from '../../src/ui/upkeepModel';
import { Network } from '../../src/core/types';
import { newState, place, roadLine } from '../infra/cityGen';
import { installFakeDom } from './fakeDom';
import { queryHost } from './queryHost';

vi.mock('../../src/ui/thumbs', () => ({ thumbs: { cached: () => null } }));
installFakeDom();
afterEach(() => vi.restoreAllMocks());

function city() {
  const st = newState(32);
  st.systemData.infraVersion = 1;
  st.stats.needs.elementary.need = 2000;
  st.stats.needs.elementary.served = 1900;
  return st;
}

describe('W0.3b upkeep display values', () => {
  it.each([
    ['civ_elementary_school', '§230', '§972'],
    ['civ_library', '§1,314', '§1,854'],
    ['civ_museum', '§3,555', '§4,995'],
    ['civ_clinic', '§497', '§684'],
    ['civ_police_station', '§915', '§2,211'],
    ['civ_fire_station', '§539', '§749'],
    ['park_small', '§30', '§41'],
  ])('pins hand-derived %s typical and full-use prices', (id, typical, full) => {
    const estimate = upkeepEstimate(city(), getDef(id))!;
    expect(money(estimate.now)).toBe(typical);
    expect(money(estimate.full)).toBe(full);
    expect(estimate.title).toBe(`≈${typical}/mo typical in this city · up to ${full} at full use`);
  });

  it('keeps every ploppable card and reward upkeep chip on the same city-wide or flat values', () => {
    const st = city(), abort = new AbortController();
    const ctx = { state: st, mods: {}, sandbox: () => false, signal: abort.signal } as unknown as GameContext;
    // Exercise the rendered price methods without the toolbar's unrelated layout/listeners.
    const toolbar = Object.assign(Object.create(Toolbar.prototype), { ctx }) as { costLine(spec: ToolSpec): string };
    const rewards = new RewardsPanel(ctx) as unknown as { upkeepChip(def: BuildingDef): HTMLElement | null };
    try {
      for (const def of allDefs().filter((d) => d.category !== 'growable' && !d.hidden && d.upkeep)) {
        const spec = plopSpec(ctx, def), estimate = upkeepEstimate(st, def);
        const price = money(estimate?.now ?? def.upkeep!);
        expect(spec.upkeep, def.id).toBe(def.upkeep);
        expect(toolbar.costLine(spec), def.id).toContain(`${estimate ? '≈' : ''}${price}/mo`);
        const chip = rewards.upkeepChip(def)!;
        expect(chip.textContent, def.id).toBe(estimate ? `≈${price}/mo typical` : `${price}/mo`);
        expect(chip.title, def.id).toBe(estimate ? `Upkeep ${estimate.title}` : 'Upkeep');
      }
    } finally { abort.abort('dispose'); }
  });

  it('pins the old school cursor values with need, partial coverage, funding, no road and no raster', () => {
    const st = city(), sim = new Simulation(st), def = getDef('civ_elementary_school')!;
    roadLine(st, 2, 10, 29, 10, Network.Road);
    const need = new Float32Array(st.cells);
    need[st.idx(10, 11)] = 100;
    const svc = { name: 'services', needRaster: () => need };
    sim.systems.push(svc as unknown as SimSystem);
    const at = (defId = def.id, x = 10, z = 11) => runQuery(sim, 'upkeepContext', { defId, x, z, w: 1, d: 1 }).here;
    const here = () => at();
    expect(here()).toBeCloseTo(132, 8); // building 72 + 100 newly served pupils × 0.6
    st.eduElemCov[st.idx(10, 11)] = 0.5;
    expect(here()).toBeCloseTo(102, 8);
    st.budget.funding.education = 50;
    expect(here()).toBeCloseTo(90.46716620017375, 8);
    expect(at(def.id, 25, 25)).toBe(72);
    sim.systems.length = 0;
    expect(here()).toBeNull();
    expect(at('util_coal_plant')).toBeNull();
    st.systemData.infraVersion = undefined;
    expect(here()).toBeNull();
  });

  it.each([
    ['civ_elementary_school', 132], ['civ_high_school', 252], ['civ_college', 720],
    ['civ_library', 75], ['civ_museum', 210], ['civ_clinic', 66.63], ['civ_hospital', 337.8],
    ['civ_police_station', 56.328], ['civ_fire_station', 52.08], ['park_small', 4.65], ['park_playground', 5.7],
  ])('pins hand-derived %s cursor upkeep for 100 nearby unserved people', (defId, expected) => {
    const st = city(), sim = new Simulation(st);
    roadLine(st, 2, 10, 29, 10, Network.Road);
    const need = new Float32Array(st.cells);
    need[st.idx(10, 11)] = 100;
    sim.systems.push({ name: 'services', needRaster: () => need } as unknown as SimSystem);
    expect(runQuery(sim, 'upkeepContext', { defId, x: 10, z: 11, w: 1, d: 1 }).here).toBeCloseTo(expected, 8);
  });

  it('keeps both ruin checks and their upkeep values current from exact mirrored flags while paused', () => {
    const st = city(), abort = new AbortController(), def = getDef('civ_mayor_house')!;
    const sim = new Simulation(st);
    const b = place(st, def.id, 5, 5, { flags: BF.Plopped });
    st.milestones[def.id] = 1;
    const ctx = {
      state: st, host: queryHost(sim), mods: {}, sandbox: () => false, signal: abort.signal,
      get sim() { throw new Error('ruin display reached into the simulation'); },
    } as unknown as GameContext;
    const rewards = new RewardsPanel(ctx) as unknown as { ruins(): RuinState; upkeepChip(def: BuildingDef): HTMLElement };
    try {
      const upkeep = rewards.upkeepChip(def).textContent;
      expect(upkeep).toBe('§50/mo');
      expect(plopSpec(ctx, def).disabled).toBe(UNIQUE_BUILT_TEXT);
      expect(rewards.ruins().live.has(def.id)).toBe(true);
      // Replica delivery replaces the record; no live system object or economy-runtime list is available.
      st.buildings.set(b.id, { ...b, flags: BF.Plopped | BF.Burnt } as Building);
      sim.events.emit('buildingChanged', st.buildings.get(b.id)!);
      expect(plopSpec(ctx, def).disabled).toBe(UNIQUE_RUINS_TEXT);
      expect(rewards.ruins().ruin.get(def.id)?.id).toBe(b.id);
      expect(rewards.ruins().live.has(def.id)).toBe(false);
      expect(rewards.upkeepChip(def).textContent).toBe(upkeep);
      st.buildings.delete(b.id); st.milestones[def.id] = 0;
      expect(plopSpec(ctx, def).disabled).toBeNull();
      expect(rewards.ruins().ruin.size).toBe(0);
      expect(rewards.upkeepChip(def).textContent).toBe(upkeep);
      expect(st.day).toBe(0);
    } finally { abort.abort('dispose'); }
  });
});
