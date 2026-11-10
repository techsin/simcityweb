/**
 * QA round 2 of T070, B7: the inspector showed a red "No power" chip on an honour's plaque, the Eco Plaza and the
 * Firefighters' Memorial when they stood off the grid, though they draw nothing (no powerUse, no jobs: utilities.ts
 * fullUse gives such a building 0 MW). A building with neither shows no power chip, as a park without a power use.
 */
import { describe, expect, it } from 'vitest';
import { Network } from '../../src/core/types';
import type { GameContext } from '../../src/game/context';
import { normalizeReward } from '../../src/game/modules';
import { BF, type Building, type CityState } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { Simulation } from '../../src/sim/Simulation';
import { listRewards } from '../../src/sim/economy/rewards';
import { createSystems } from '../../src/sim/systems/index';
import { InfoPanel } from '../../src/ui/panels/InfoPanel';
import { newState, place, roadLine } from '../infra/cityGen';
import { type FEl, installFakeDom, textOf } from './fakeDom';
import { queryHost } from './queryHost';

installFakeDom();

/** a road with no power plant anywhere: nothing on it is powered */
function town() {
  const st = newState(64);
  roadLine(st, 2, 20, 61, 20, Network.Road);
  const at = (id: string, x: number) => place(st, id, x, 21, { flags: BF.Plopped });
  const b = {
    plaque: at('rw_honour_green_belt_plaque', 4), plaza: at('rw_eco_plaza', 8), memorial: at('rw_firefighters_memorial', 12),
    statue: at('civ_statue', 16), park: at('park_small', 20), cathedral: at('lm_cathedral', 24), base: at('rw_military_base', 34),
  };
  st.funds = 1e6;
  const sim = new Simulation(st, createSystems());
  return { st, sim, b };
}

/** the inspector of building b: its chips, and everything it says */
function inspect(sim: Simulation, b: Building): { chips: string; text: string } {
  const ctx = {
    get state() { return sim.state; },
    sim, host: queryHost(sim), signal: new AbortController().signal,
    mods: { listRewards: (s: CityState) => listRewards(s).map(normalizeReward) },
    actions: { bulldoze: () => ({ ok: true, cost: 30 }) }, objects: { setSelected: () => undefined },
    panels: { close: () => undefined, open: () => undefined }, tools: { select: () => true },
    focusCell: () => undefined, showQuery: () => undefined, sandbox: () => false, sound: () => undefined, toast: () => undefined,
  } as unknown as GameContext;
  const panel = new InfoPanel(ctx);
  panel.mount(() => undefined, () => undefined, () => undefined);
  panel.show({ buildingId: b.id, x: b.x, z: b.z });
  const body = panel.body as unknown as FEl;
  return { chips: body.querySelectorAll('.flags').map(textOf).join(' | '), text: textOf(body) };
}

describe('QA round 2, B7: the inspector\'s power chip', () => {
  it('the fixtures are what the rule is about', () => {
    for (const id of ['rw_honour_green_belt_plaque', 'rw_eco_plaza', 'rw_firefighters_memorial', 'civ_statue']) {
      const def = getDef(id)!;
      expect(def.powerUse ?? 0, id).toBe(0);
      expect(def.jobs ?? 0, id).toBe(0);
      expect(def.category, id).not.toBe('park');
    }
    expect(getDef('lm_cathedral')!.jobs).toBeGreaterThan(0);
    expect(getDef('lm_cathedral')!.powerUse).toBeUndefined();
    expect(getDef('rw_military_base')!.powerUse).toBeGreaterThan(0);
  });

  it('none on a plaque, a memorial garden or a statue off the grid: they use no power', () => {
    const { sim, b } = town();
    for (const building of [b.plaque, b.plaza, b.memorial, b.statue]) {
      expect(building.flags & BF.Powered, building.def).toBe(0);
      const { chips, text } = inspect(sim, building);
      expect(chips, building.def).not.toMatch(/power/i);
      expect(text, building.def).not.toMatch(/No power|Powered/);
    }
  });

  it('"No power" on what does draw it: the chip for staff alone, the facility\'s own warning for an explicit use', () => {
    const { sim, b } = town();
    expect(inspect(sim, b.cathedral).chips).toMatch(/No power/);
    // (a building with a powerUse gets the report's "No power — …" warning, which stands in for the chip)
    const base = inspect(sim, b.base);
    expect(base.text).toMatch(/No power/);
    expect(base.chips).not.toMatch(/Powered/);
  });

  it('a park without a power use: none, as before', () => {
    const { sim, b } = town();
    expect(inspect(sim, b.park).chips).not.toMatch(/power/i);
  });
});
