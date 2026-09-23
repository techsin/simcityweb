/** Regional play numbers written into a city's systemData from neighbouring founded cities. */
import { describe, expect, it } from 'vitest';
import { createRegionData } from '../../src/region/RegionModel';
import { applyRegionEffects, regionContext } from '../../src/region/regionEffects';
import { CityState } from '../../src/sim/CityState';
import { REGION_JOB_MIN, REGION_JOB_SHARE } from '../../src/sim/infra/params';
import type { RegionCitySummary } from '../../src/region/types';

const summary = (name: string, population: number, c: number, i: number): RegionCitySummary => ({
  name, mayor: 'M', population, r: population, c, i, funds: 0, lastPlayed: 0, founded: 0, difficulty: 'medium',
});

describe('region effects', () => {
  it('finds adjacent tiles on every edge with correct shared segments', () => {
    const { model } = createRegionData({ seed: 3, preset: 'greenvale' });
    const tile = model.data.tiles.find((t) => t.x > 0 && t.z > 0 && t.x + t.size < 16 && t.z + t.size < 16 && t.size === 2)!;
    const ctx = regionContext(model, tile);
    const edges = new Set(ctx.neighbors.map((n) => n.edge));
    expect([...edges].sort()).toEqual(['e', 'n', 's', 'w']);
    // segments along each edge cover the whole edge exactly once
    for (const e of ['n', 's', 'e', 'w'] as const) {
      const segs = ctx.neighbors.filter((n) => n.edge === e).sort((a, b) => a.from - b.from);
      expect(segs[0].from).toBe(0);
      expect(segs[segs.length - 1].to).toBe(tile.size * 64);
      for (let k = 1; k < segs.length; k++) expect(segs[k].from).toBe(segs[k - 1].to);
    }
  });

  it('adds neighbour jobs / workers on top of the sim-infra defaults; isolated cities are unchanged', () => {
    const { model } = createRegionData({ seed: 3, preset: 'greenvale' });
    const tile = model.data.tiles.find((t) => t.x > 0 && t.z > 0 && t.x + t.size < 16 && t.z + t.size < 16)!;
    const st = new CityState(model.cityConfigFor(tile));
    st.stats.population = 10000;
    st.stats.workforce = 5500;
    // isolated: no overrides
    applyRegionEffects(st, regionContext(model, tile));
    expect(st.systemData.regionJobs).toBeUndefined();
    expect((st.systemData.region as { neighbors: unknown[] }).neighbors.length).toBeGreaterThan(0);
    // found a neighbour to the north
    const north = regionContext(model, tile).neighbors.find((n) => n.edge === 'n')!;
    model.tileByKey(north.tileKey)!.city = summary('Northtown', 40000, 8000, 6000);
    const ctx = regionContext(model, tile);
    applyRegionEffects(st, ctx);
    const base = REGION_JOB_SHARE * 5500 + REGION_JOB_MIN;
    expect(st.systemData.regionJobs).toBeGreaterThan(base);
    expect(st.systemData.regionWorkers as number).toBeGreaterThan(1000);
    const reg = st.systemData.region as { adjacentPopulation: number; neighbors: { name: string | null; founded: boolean }[] };
    expect(reg.adjacentPopulation).toBe(40000);
    expect(reg.neighbors.some((n) => n.founded && n.name === 'Northtown')).toBe(true);
    // structured-clone friendly (persists with the save)
    expect(() => structuredClone(st.systemData)).not.toThrow();
  });
});
