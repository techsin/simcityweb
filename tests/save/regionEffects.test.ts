/** Regional play numbers written into a city's systemData from neighbouring founded cities. */
import { describe, expect, it } from 'vitest';
import { createRegionData } from '../../src/region/RegionModel';
import { ADJ_SHARE, applyRegionEffects, regionContext } from '../../src/region/regionEffects';
import { CityState } from '../../src/sim/CityState';
import { REGION_JOB_MIN, REGION_JOB_SHARE } from '../../src/sim/infra/params';
import { EDGE_CONN, EDGE_NONE, WORKFORCE_RATIO } from '../../src/sim/economy/tuning';
import { Network } from '../../src/core/types';
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
    // found a job centre to the north (50k jobs, 22k workers: a 28k job surplus)
    const north = regionContext(model, tile).neighbors.find((n) => n.edge === 'n')!;
    model.tileByKey(north.tileKey)!.city = summary('Northtown', 40000, 30000, 20000);
    const ctx = regionContext(model, tile);
    applyRegionEffects(st, ctx);
    const base = REGION_JOB_SHARE * 5500 + REGION_JOB_MIN;
    expect(st.systemData.regionJobs).toBeGreaterThan(base);
    const reg = st.systemData.region as { adjacentPopulation: number; jobBonus: number; neighbors: { name: string | null; founded: boolean; jobSlots?: number }[] };
    expect(reg.adjacentPopulation).toBe(40000);
    expect(reg.neighbors.some((n) => n.founded && n.name === 'Northtown')).toBe(true);
    // structured-clone friendly (persists with the save)
    expect(() => structuredClone(st.systemData)).not.toThrow();
  });

  it('final fixes F1: the neighbour bonus is its connected SURPLUS — a bedroom town adds no jobs, an unconnected edge a tenth', () => {
    const { model } = createRegionData({ seed: 3, preset: 'greenvale' });
    const tile = model.data.tiles.find((t) => t.x > 0 && t.z > 0 && t.x + t.size < 16 && t.z + t.size < 16)!;
    const north = regionContext(model, tile).neighbors.find((n) => n.edge === 'n')!;
    const city = () => {
      const st = new CityState(model.cityConfigFor(tile));
      st.stats.population = 10000;
      st.stats.workforce = 5500;
      return st;
    };
    const base = Math.round(REGION_JOB_SHARE * 5500 + REGION_JOB_MIN);
    const highway = { edge: 'n' as const, x: north.from + 3, z: 0, type: Network.Highway };
    // a bedroom town (165k workers, 40k jobs) north: no job surplus -> no regional jobs for our residents, connected or not
    model.tileByKey(north.tileKey)!.city = summary('Sleepyville', 300000, 25000, 15000);
    const bedOpen = city();
    applyRegionEffects(bedOpen, regionContext(model, tile));
    expect(bedOpen.systemData.regionJobs).toBe(base);
    const bedRoad = city();
    bedRoad.neighborConnections = [highway];
    applyRegionEffects(bedRoad, regionContext(model, tile));
    expect(bedRoad.systemData.regionJobs).toBe(base);
    // ... but its workers commute in: the worker surplus x the edge factor (unconnected: EDGE_NONE)
    const surW = Math.round(300000 * WORKFORCE_RATIO) - 40000;
    expect(bedOpen.systemData.regionWorkers as number).toBeGreaterThan(0);
    expect((bedRoad.systemData.regionWorkers as number) - (bedOpen.systemData.regionWorkers as number)).toBeCloseTo(ADJ_SHARE * surW * (1 - EDGE_NONE), -1);
    // a job centre (260k jobs, 33k workers) north: its job surplus x the edge factor
    model.tileByKey(north.tileKey)!.city = summary('Jobsville', 60000, 160000, 100000);
    const surJ = 260000 - Math.round(60000 * WORKFORCE_RATIO);
    const jobOpen = city();
    applyRegionEffects(jobOpen, regionContext(model, tile));
    expect((jobOpen.systemData.regionJobs as number) - base).toBeCloseTo(ADJ_SHARE * surJ * EDGE_NONE, -1);
    const jobRoad = city();
    jobRoad.neighborConnections = [highway];
    applyRegionEffects(jobRoad, regionContext(model, tile));
    expect((jobRoad.systemData.regionJobs as number) - base).toBeCloseTo(ADJ_SHARE * surJ * EDGE_CONN[Network.Highway], -1);
    // a connection on ANOTHER edge does not reach the northern neighbour
    const jobEast = city();
    jobEast.neighborConnections = [{ edge: 'e', x: 127, z: 20, type: Network.Highway }];
    applyRegionEffects(jobEast, regionContext(model, tile));
    expect(jobEast.systemData.regionJobs).toBe(jobOpen.systemData.regionJobs);
    // the stored copy names the slots per neighbour segment (traffic places them on that segment's connections)
    const n = (jobRoad.systemData.region as { neighbors: { tileKey: string; jobSlots?: number; edgeF?: number }[] }).neighbors.find((x) => x.tileKey === north.tileKey)!;
    expect(n.edgeF).toBe(EDGE_CONN[Network.Highway]);
    expect(n.jobSlots).toBe(Math.round(ADJ_SHARE * surJ));
  });
});
