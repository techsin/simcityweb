/**
 * Regional play (SC4 style): neighbouring founded cities provide jobs for this city's residents and workers for its
 * jobs. Headless-safe (no DOM / three).
 *
 * Written into the city state on entry and refreshed every simulated month:
 *   state.systemData.regionJobs    number — total regional job slots our residents may commute to
 *   state.systemData.regionWorkers number — total regional workers that may commute in to fill our jobs
 *     (both read by sim-infra traffic; they REPLACE its defaults REGION_JOB_SHARE × workers + REGION_JOB_MIN and
 *      REGION_WORKER_SHARE × jobSlots + REGION_WORKER_MIN, so we keep those defaults and add the neighbour bonus)
 *   state.systemData.region        RegionContext — full regional picture for sim-core demand (not consumed yet)
 */
import type { CityState } from '../sim/CityState';
import { REGION_JOB_MIN, REGION_JOB_SHARE, REGION_WORKER_MIN, REGION_WORKER_SHARE } from '../sim/infra/params';
import { WORKFORCE_RATIO } from '../sim/economy/tuning';
import { REGION_UNIT_CELLS } from '../core/constants';
import type { RegionModel } from './RegionModel';
import type { RegionTile } from './types';

export type Edge = 'n' | 's' | 'e' | 'w';

export interface RegionNeighbor {
  edge: Edge;
  tileKey: string;
  name: string | null;
  founded: boolean;
  population: number;
  /** neighbour's filled C + I jobs */
  jobs: number;
  /** neighbour's workforce (residents × WORKFORCE_RATIO) */
  workers: number;
  r: number;
  c: number;
  i: number;
  /** shared edge segment in THIS city's cells along the edge axis: [from, to) */
  from: number;
  to: number;
}

export interface RegionContext {
  regionId: string;
  tileKey: string;
  /** whole region excluding this city */
  population: number;
  jobs: number;
  workers: number;
  /** adjacent tiles (founded or not), one entry per shared edge segment */
  neighbors: RegionNeighbor[];
  /** sums over founded adjacent neighbours */
  adjacentPopulation: number;
  adjacentJobs: number;
  adjacentWorkers: number;
  /** regional job / worker bonus added on top of sim-infra's defaults (see applyRegionEffects) */
  jobBonus: number;
  workerBonus: number;
}

/** share of adjacent neighbours' jobs / workers available to this city; far cities count much less */
export const ADJ_SHARE = 0.3;
export const FAR_SHARE = 0.06;

export function regionContext(model: RegionModel, tile: RegionTile): RegionContext {
  const neighbors: RegionNeighbor[] = [];
  const cellsPerUnit = REGION_UNIT_CELLS;
  const add = (edge: Edge, t: RegionTile, a0: number, a1: number, b0: number, b1: number) => {
    const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
    if (hi <= lo) return;
    const c = t.city;
    neighbors.push({
      edge,
      tileKey: t.key,
      name: c?.name ?? null,
      founded: !!c,
      population: c?.population ?? 0,
      jobs: (c?.c ?? 0) + (c?.i ?? 0),
      workers: Math.round((c?.r ?? c?.population ?? 0) * WORKFORCE_RATIO),
      r: c?.r ?? 0,
      c: c?.c ?? 0,
      i: c?.i ?? 0,
      from: (lo - a0) * cellsPerUnit,
      to: (hi - a0) * cellsPerUnit,
    });
  };
  for (const t of model.data.tiles) {
    if (t === tile) continue;
    if (t.z + t.size === tile.z) add('n', t, tile.x, tile.x + tile.size, t.x, t.x + t.size);
    else if (t.z === tile.z + tile.size) add('s', t, tile.x, tile.x + tile.size, t.x, t.x + t.size);
    if (t.x + t.size === tile.x) add('w', t, tile.z, tile.z + tile.size, t.z, t.z + t.size);
    else if (t.x === tile.x + tile.size) add('e', t, tile.z, tile.z + tile.size, t.z, t.z + t.size);
  }
  const adjKeys = new Set(neighbors.map((n) => n.tileKey));
  let population = 0, jobs = 0, workers = 0, farJobs = 0, farWorkers = 0;
  for (const t of model.data.tiles) {
    if (t === tile || !t.city) continue;
    const j = t.city.c + t.city.i, w = (t.city.r || t.city.population) * WORKFORCE_RATIO;
    population += t.city.population;
    jobs += j;
    workers += w;
    if (!adjKeys.has(t.key)) {
      farJobs += j;
      farWorkers += w;
    }
  }
  const seen = new Set<string>();
  let adjacentPopulation = 0, adjacentJobs = 0, adjacentWorkers = 0;
  for (const n of neighbors) {
    if (!n.founded || seen.has(n.tileKey)) continue;
    seen.add(n.tileKey);
    adjacentPopulation += n.population;
    adjacentJobs += n.jobs;
    adjacentWorkers += n.workers;
  }
  return {
    regionId: model.data.id,
    tileKey: tile.key,
    population,
    jobs,
    workers: Math.round(workers),
    neighbors,
    adjacentPopulation,
    adjacentJobs,
    adjacentWorkers,
    jobBonus: Math.round(ADJ_SHARE * adjacentJobs + FAR_SHARE * farJobs),
    workerBonus: Math.round(ADJ_SHARE * adjacentWorkers + FAR_SHARE * farWorkers),
  };
}

/**
 * Write the regional numbers into the state (call on entry and monthly). The totals follow the city's own size
 * (sim-infra's default formulas) plus the neighbour bonus, so an isolated city behaves exactly as before.
 */
export function applyRegionEffects(st: CityState, ctx: RegionContext): void {
  const sd = st.systemData;
  const workers = st.stats.workforce || st.stats.population * WORKFORCE_RATIO;
  let slots = 0;
  for (const v of st.stats.jobCapByDev ?? []) slots += v;
  sd.region = { ...ctx, neighbors: ctx.neighbors.map((n) => ({ ...n })) };
  if (ctx.jobBonus > 0 || ctx.workerBonus > 0) {
    sd.regionJobs = Math.round(REGION_JOB_SHARE * workers + REGION_JOB_MIN + ctx.jobBonus);
    sd.regionWorkers = Math.round(REGION_WORKER_SHARE * slots + REGION_WORKER_MIN + ctx.workerBonus);
  } else {
    delete sd.regionJobs;
    delete sd.regionWorkers;
  }
}

/** subscribe to monthly refreshes; returns an unsubscribe function */
export function trackRegionEffects(sim: { state: CityState; events: { on(type: 'month', fn: (m: number) => void): () => void } }, ctx: RegionContext): () => void {
  applyRegionEffects(sim.state, ctx);
  return sim.events.on('month', () => applyRegionEffects(sim.state, ctx));
}
