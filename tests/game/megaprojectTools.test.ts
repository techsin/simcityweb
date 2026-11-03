import { describe, expect, it } from 'vitest';
import { CATEGORIES, categoryOfTool, findToolSpec, plopSpec, UNIQUE_BUILT_TEXT, UNIQUE_RUINS_TEXT } from '../../src/game/toolCatalog';
import type { GameContext } from '../../src/game/context';
import { BF } from '../../src/sim/CityState';
import { getDef } from '../../src/sim/catalog';
import { projectAvailable } from '../../src/sim/economy/projects';
import { makeCity } from '../sim/helpers';

const IDS = ['tr_express_metro', 'lm_world_expo', 'util_fusion_plant'];
function town(sandbox = false) {
  const c = makeCity({ sandbox, startFunds: 1000000 }, []);
  const ctx = { state: c.st, host: { state: c.st, events: c.sim.events }, mods: {},
    signal: new AbortController().signal, sandbox: () => sandbox } as unknown as GameContext;
  return { ...c, ctx };
}

describe('mega-project toolbar', () => {
  it('offers each live project exactly once in Rewards, preserving its full price and duration', () => {
    const { ctx } = town();
    const rewards = CATEGORIES.find((c) => c.id === 'landmarks')!.groups!(ctx);
    const projects = rewards.find((g) => g.label === 'Mega-projects')!;
    expect(projects.items.map((s) => s.def!.id)).toEqual(IDS);
    const all = CATEGORIES.flatMap((c) => c.groups?.(ctx).flatMap((g) => g.items) ?? []);
    for (const id of IDS) {
      expect(all.filter((s) => s.id === `plop:${id}`)).toHaveLength(1);
      expect(categoryOfTool(ctx, `plop:${id}`)).toBe('landmarks');
      expect(findToolSpec(ctx, `plop:${id}`)?.cost).toBe(getDef(id)!.cost);
      expect(findToolSpec(ctx, `plop:${id}`)?.def?.buildMonths).toBe(getDef(id)!.buildMonths);
    }
    expect(all.some((s) => s.id === 'plop:rw_space_center' || s.id === 'plop:lm_expo_tower')).toBe(false);
    expect(categoryOfTool(ctx, 'plop:tr_subway_station')).toBe('transport');
    expect(categoryOfTool(ctx, 'plop:util_nuclear_plant')).toBe('utilities');
    expect(categoryOfTool(ctx, 'plop:lm_clock_tower')).toBe('landmarks');
  });

  it('shows the real population and quality gates at their exact boundaries', () => {
    const { st, ctx } = town();
    for (const id of IDS) {
      const d = getDef(id)!;
      st.stats.population = d.project!.population - 1;
      expect(plopSpec(ctx, d).locked?.hint).toBe(projectAvailable(st, d));
      st.stats.population++;
      if (d.project!.education !== undefined) {
        st.stats.eq = d.project!.education - 0.01;
        expect(plopSpec(ctx, d).locked?.hint).toBe('Needs EQ 120');
        st.stats.eq = d.project!.education;
        expect(plopSpec(ctx, d).locked).toBeNull();
      } else if (d.project!.attractiveness !== undefined) {
        st.stats.attractiveness = d.project!.attractiveness - 0.01;
        expect(plopSpec(ctx, d).locked?.hint).toBe('Needs attractiveness 70');
        st.stats.attractiveness = d.project!.attractiveness;
        expect(plopSpec(ctx, d).locked).toBeNull();
      } else expect(plopSpec(ctx, d).locked?.hint).toBe('Needs 6 subway stations');
    }
  });

  it('counts only completed, usable subway stations and reads project gates through the host', () => {
    const { st, ctx, A } = town();
    st.stats.population = 300000;
    const d = getDef('tr_express_metro')!;
    for (let x = 1; x <= 6; x++) expect(A.plop('tr_subway_station', x, 1, 0).ok).toBe(true);
    const stations = [...st.buildings.values()];
    expect(plopSpec(ctx, d).locked).toBeNull();
    for (const flags of [BF.Constructing, BF.Burnt, BF.Abandoned]) {
      const b = stations[0], before = b.flags;
      b.flags |= flags;
      expect(plopSpec(ctx, d).locked).toEqual({ hint: projectAvailable(st, d), progress: 5 / 6 });
      b.flags = before;
    }
    stations[0].built = 0.999;
    expect(plopSpec(ctx, d).locked?.hint).toBe('Needs 6 subway stations');
    stations[0].built = 1;
    // The legacy context accessor can be stale; the new project gate reads the host's current replica.
    const legacy = { ...ctx, state: { ...st, stats: { ...st.stats, population: 0 } } } as GameContext;
    expect(plopSpec(legacy, d).locked).toBeNull();
  });

  it('bypasses project quality gates in sandbox and keeps unique-building/ruin disabling', () => {
    const { st, ctx, A } = town(true);
    for (const id of IDS) expect(plopSpec(ctx, getDef(id)!).locked).toBeNull();
    expect(A.plop('util_fusion_plant', 4, 4, 0).ok).toBe(true);
    expect(plopSpec(ctx, getDef('util_fusion_plant')!).disabled).toBe(UNIQUE_BUILT_TEXT);
    const b = [...st.buildings.values()][0];
    b.flags |= BF.Burnt;
    ctx.host.events.emit('buildingChanged', b);
    expect(plopSpec(ctx, getDef('util_fusion_plant')!).disabled).toBe(UNIQUE_RUINS_TEXT);
  });
});
