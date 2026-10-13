/**
 * Regional play (SC4 style): neighbouring founded cities provide jobs for this city's residents and workers for its
 * jobs. Headless-safe (no DOM / three).
 *
 * Written into the city state on entry and refreshed every simulated month:
 *   state.systemData.regionJobs    number — total regional job slots our residents may commute to
 *   state.systemData.regionWorkers number — total regional workers that may commute in to fill our jobs
 *     (both read by sim-infra traffic and the employment ledger; they REPLACE its defaults REGION_JOB_SHARE × workers +
 *      REGION_JOB_MIN and REGION_WORKER_SHARE × jobSlots + REGION_WORKER_MIN, so we keep those defaults and add the
 *      neighbour bonus)
 *   state.systemData.region        RegionContext — full regional picture for sim-core demand (demand.ts regionInputs)
 * The neighbour bonus follows what the demand model reads (regionLink.ts): a neighbour adds jobs for our residents only
 * from its job SURPLUS (jobs its own workers leave open) and workers for our jobs only from its worker surplus, each ×
 * how well the shared edge is connected (EDGE_CONN: highway 1 … street .3, unconnected EDGE_NONE .1). A bedroom town
 * next door therefore employs nobody here, and a job centre beyond an unconnected edge only a tenth of what a highway
 * gives (SIM_DEPTH final fixes F1: any founded neighbour used to remove the city's unemployment).
 */
import type { CityState } from '../sim/CityState';
import { REGION_JOB_MIN, REGION_JOB_SHARE, REGION_WORKER_MIN, REGION_WORKER_SHARE } from '../sim/infra/params';
import { WORKFORCE_RATIO } from '../sim/economy/tuning';
import { bestConnection, connectedNeighbours, neighbourSurplus } from '../sim/economy/regionLink';
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
  /**
   * written by applyRegionEffects into systemData.region (the stored copy) on the tile's best-connected segment: its
   * edge factor and the regional job slots / inbound workers this neighbour adds (ADJ_SHARE × surplus × edgeF) —
   * so traffic can place the bonus on the connections of that segment
   */
  edgeF?: number;
  jobSlots?: number;
  workerSlots?: number;
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
  /**
   * regional job / worker bonus added on top of sim-infra's defaults: regionContext gives the bonus at full connection
   * (edge factor 1 everywhere — an upper bound); applyRegionEffects stores the bonus for the city's current neighbour
   * connections in systemData.region (and ignores the field of the context it is given)
   */
  jobBonus: number;
  workerBonus: number;
  /** Σ over founded cities beyond the neighbours of max(0, jobs − workers) / max(0, workers − jobs) (absent: derived
   *  from the totals) */
  farJobSurplus?: number;
  farWorkerSurplus?: number;
}

/** share of an adjacent neighbour's job / worker SURPLUS available to this city (× the shared edge's connection factor;
 *  = the demand model's RG_R / RG_CI: the residents regional demand brings for a neighbour's open jobs find them); far
 *  cities count much less (× the city's best connection: their commuters pass a neighbour's tile) */
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
      farJobs += Math.max(0, j - w);
      farWorkers += Math.max(0, w - j);
    }
  }
  const seen = new Set<string>();
  let adjacentPopulation = 0, adjacentJobs = 0, adjacentWorkers = 0, adjJobSurplus = 0, adjWorkerSurplus = 0;
  for (const n of neighbors) {
    if (!n.founded || seen.has(n.tileKey)) continue;
    seen.add(n.tileKey);
    adjacentPopulation += n.population;
    adjacentJobs += n.jobs;
    adjacentWorkers += n.workers;
    const sur = neighbourSurplus(n);
    adjJobSurplus += sur.jobs;
    adjWorkerSurplus += sur.workers;
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
    jobBonus: Math.round(ADJ_SHARE * adjJobSurplus + FAR_SHARE * farJobs),
    workerBonus: Math.round(ADJ_SHARE * adjWorkerSurplus + FAR_SHARE * farWorkers),
    farJobSurplus: Math.round(farJobs),
    farWorkerSurplus: Math.round(farWorkers),
  };
}

/**
 * The regional job / worker bonus for the city's current neighbour connections: ADJ_SHARE × Σ over founded neighbours
 * of the surplus × the shared edge's connection factor (each tile once, its best-connected segment: the inputs of the
 * demand model's regional terms) + FAR_SHARE × the far cities' surplus × the city's best connection. Per neighbour
 * entry of `stored` (the systemData copy) its edgeF / jobSlots / workerSlots are written.
 */
export function regionBonus(st: CityState, ctx: RegionContext, stored?: RegionNeighbor[]): { jobs: number; workers: number } {
  let jobs = 0, workers = 0;
  for (const { n, f } of connectedNeighbours(st, ctx.neighbors)) {
    const sur = neighbourSurplus(n);
    const j = ADJ_SHARE * sur.jobs * f, w = ADJ_SHARE * sur.workers * f;
    jobs += j;
    workers += w;
    const k = stored ? ctx.neighbors.indexOf(n) : -1;
    if (stored && k >= 0 && stored[k]) { stored[k].edgeF = f; stored[k].jobSlots = Math.round(j); stored[k].workerSlots = Math.round(w); }
  }
  const farJ = ctx.farJobSurplus ?? Math.max(0, (ctx.jobs - ctx.adjacentJobs) - (ctx.workers - ctx.adjacentWorkers));
  const farW = ctx.farWorkerSurplus ?? Math.max(0, (ctx.workers - ctx.adjacentWorkers) - (ctx.jobs - ctx.adjacentJobs));
  if (farJ > 0 || farW > 0) {
    const f = bestConnection(st);
    jobs += FAR_SHARE * Math.max(0, farJ) * f;
    workers += FAR_SHARE * Math.max(0, farW) * f;
  }
  return { jobs: Math.round(jobs), workers: Math.round(workers) };
}

/**
 * Write the regional numbers into the state (call on entry and monthly: neighbour connections change). The totals
 * follow the city's own size (sim-infra's default formulas) plus the neighbour bonus for the current connections
 * (regionBonus), so an isolated city — or one whose neighbours have no surplus to offer — behaves exactly as before.
 */
export function applyRegionEffects(st: CityState, ctx: RegionContext): void {
  const sd = st.systemData;
  const workers = st.stats.workforce || st.stats.population * WORKFORCE_RATIO;
  let slots = 0;
  for (const v of st.stats.jobCapByDev ?? []) slots += v;
  const neighbors = ctx.neighbors.map((n) => ({ ...n }));
  const bonus = regionBonus(st, ctx, neighbors);
  sd.region = { ...ctx, neighbors, jobBonus: bonus.jobs, workerBonus: bonus.workers };
  if (bonus.jobs > 0 || bonus.workers > 0) {
    sd.regionJobs = Math.round(REGION_JOB_SHARE * workers + REGION_JOB_MIN + bonus.jobs);
    sd.regionWorkers = Math.round(REGION_WORKER_SHARE * slots + REGION_WORKER_MIN + bonus.workers);
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
