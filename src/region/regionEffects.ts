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
 *
 * LG-12 (sister cities, the last section of this file): a city founds a neighbour on a free tile next to it and may
 * give it an endowment. The region's ledger (RegionData.endowments) holds each founding; regionContext hands a city the
 * entries it has a side in (RegionContext.endowments), and the budget system books them, once each.
 */
import { MONTH_NAMES, type CityState } from '../sim/CityState';
import { REGION_JOB_MIN, REGION_JOB_SHARE, REGION_WORKER_MIN, REGION_WORKER_SHARE } from '../sim/infra/params';
import { NETWORK_INFO, WORKFORCE_RATIO } from '../sim/economy/tuning';
import { bestConnection, connectedNeighbours, neighbourSurplus } from '../sim/economy/regionLink';
import { CONN_MIN_DEPTH } from '../sim/economy/connections';
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, REGION_UNIT_CELLS } from '../core/constants';
import { Network, isRoad } from '../core/types';
import type { RegionModel } from './RegionModel';
import type { RegionData, RegionTile, SisterEndowment } from './types';

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
  /** LG-12: the sister-city foundings of the region's ledger this city has a side in (absent: none). They reach the
   *  city's save with the rest of the context (systemData.region), and economy/budget.ts books each one once */
  endowments?: EndowmentDue[];
}

/** LG-12: a ledger entry seen from one of its two cities: `out` it founded the sister city (and paid the endowment),
 *  `in` it is the city that was founded */
export interface EndowmentDue {
  id: string;
  dir: 'out' | 'in';
  /** § of the endowment (0: founded without one) */
  amount: number;
  /** the parent's game day at the founding */
  day: number;
  /** the other city's name (null: its tile holds another city, or none, now) */
  city: string | null;
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
  const endowments = dueEndowments(model.data, tile);
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
    // (only with an entry: a city without a sister keeps the context, and so its save, as it was)
    ...(endowments.length ? { endowments } : {}),
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

// ---------------------------------------------------------------------------------------------------------------
// LG-12: sister cities
// ---------------------------------------------------------------------------------------------------------------
/**
 * FOUNDING A SISTER CITY. From inside a city ("Found a sister city": the pause menu, the built-out advice) the app
 *  1. reads what the founding needs from the open city (sisterParent: name, mayor, funds, date, its roads at the edges);
 *  2. saves and leaves the city, and plans the founding on the best free tile next to it (planSisterCity → sisterTile:
 *     the tile whose shared edge holds the most of the city's edge roads): the endowment limit, the 10-year rule and
 *     the road stub;
 *  3. opens the New City dialog with the plan (NewCityDialog.ts: the mayor filled in, the endowment slider and its
 *     confirmation). Cancelling changes nothing anywhere;
 *  4. on "Found City" generates the new city with its road stub and its parent's name (prepareSisterCity), stores it,
 *     and stores the region with the new tile AND the founding's ledger entry in one write (commitSisterCity).
 * MONEY. Step 4 pays nothing: the ledger entry is the transfer. regionContext gives each of the two cities its side of
 * the entry whenever it is opened, and economy/budget.ts books it exactly once per city (the parent −amount on the
 * "Sister city endowment" line, the new city +amount), keeping the entry's id in the city's save. A tab killed before
 * the region write leaves no transfer: the new city's record, if stored, is on no tile and holds its start funds only.
 * A tab killed after it leaves exactly one: a city opened from a save older than its booking books it again from the
 * ledger, once, because that save does not hold the id.
 */
/** the most a city may give a sister city: this share of its funds, at most ENDOWMENT_MAX, once per ENDOWMENT_YEARS */
export const ENDOWMENT_SHARE = 0.25;
export const ENDOWMENT_MAX = 5_000_000;
export const ENDOWMENT_YEARS = 10;
/** below this no endowment is offered */
export const ENDOWMENT_MIN = 1_000;
const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
/**
 * cells of the road stub, from the shared edge inward: as deep as a network may reach without being a neighbour
 * connection (connections.ts: an edge run counts once it reaches CONN_MIN_DEPTH cells in). The stub alone is therefore
 * no connection — no demand-cap relief, no connection weight, no "New neighbor connection!" — until the new city's
 * roads join it (veteran finding 6: dead-end stubs at the map edge used to stack cap relief).
 */
export const SISTER_STUB_CELLS = CONN_MIN_DEPTH;
/** netFlags bits 2-3: a one-way road's direction (CityState.netFlags) */
const ONEWAY_BITS = 0b1100;
const EDGES: readonly Edge[] = ['n', 's', 'e', 'w'];

/** a road cell on a map edge */
export interface EdgeRoad {
  /** the cell along the edge: x on the n / s edges, z on the e / w edges */
  a: number;
  type: Network;
  /** its one-way direction bits (netFlags), 0 for the other road types */
  dir: number;
  /** the cell behind it is a road too: the road reaches the edge from inside the city */
  inward: boolean;
}

/** the parent city as the founding needs it: plain data read from the host's state while the city is still open */
export interface SisterParent {
  tileKey: string;
  name: string;
  mayor: string;
  funds: number;
  /** its game day and start year: the 10-year rule's dates are in the parent's calendar */
  day: number;
  startYear: number;
  sandbox: boolean;
  edgeRoads: Record<Edge, EdgeRoad[]>;
}

/** one cell of the stub in the new city */
export interface StubCell { x: number; z: number; type: Network; dir: number }

/** a planned founding: what the New City dialog shows and what the save chain writes */
export interface SisterPlan {
  /** the ledger id of this founding (a retried save keeps it) */
  id: string;
  from: RegionTile;
  to: RegionTile;
  parent: SisterParent;
  /** the most the parent may give now (endowmentLimit, a multiple of `step`); 0 with `blocked` */
  limit: number;
  /** the slider's step */
  step: number;
  /** why the parent can give nothing now: the 10-year rule with its dates, a sandbox parent, an empty treasury */
  blocked?: string;
  /** the endowment the player confirmed in the New City dialog (0: none) */
  amount: number;
  /** the stub: one column of cells per continued road, each from the shared edge inward */
  stub: StubCell[][];
}

/** read the founding's inputs from an open city (`st` may be a host's replica: every field read here is mirrored) */
export function sisterParent(st: Pick<CityState, 'size' | 'network' | 'netFlags' | 'funds' | 'day' | 'config'>, tileKey: string): SisterParent {
  const N = st.size;
  const edgeRoads: Record<Edge, EdgeRoad[]> = { n: [], s: [], e: [], w: [] };
  for (const edge of EDGES) {
    for (let a = 0; a < N; a++) {
      const x = edge === 'w' ? 0 : edge === 'e' ? N - 1 : a, z = edge === 'n' ? 0 : edge === 's' ? N - 1 : a;
      const type = st.network[z * N + x] as Network;
      if (!isRoad(type)) continue;
      const bx = edge === 'w' ? 1 : edge === 'e' ? N - 2 : a, bz = edge === 'n' ? 1 : edge === 's' ? N - 2 : a;
      edgeRoads[edge].push({ a, type, dir: type === Network.OneWay ? st.netFlags[z * N + x] & ONEWAY_BITS : 0, inward: isRoad(st.network[bz * N + bx] as Network) });
    }
  }
  const c = st.config;
  return { tileKey, name: c.name, mayor: c.mayor, funds: st.funds, day: st.day, startYear: c.startYear, sandbox: !!c.sandbox || c.difficulty === 'sandbox', edgeRoads };
}

/** the most a city with `funds` may give: ENDOWMENT_SHARE of them, at most ENDOWMENT_MAX */
export function endowmentLimit(funds: number): number {
  return Number.isFinite(funds) ? Math.max(0, Math.min(ENDOWMENT_MAX, Math.floor(funds * ENDOWMENT_SHARE))) : 0;
}

/** "Apr 2053": a game day in a city's calendar */
export function gameMonthLabel(day: number, startYear: number): string {
  return `${MONTH_NAMES[Math.floor(day / DAYS_PER_MONTH) % MONTHS_PER_YEAR]} ${startYear + Math.floor(day / DAYS_PER_YEAR)}`;
}

/** the game day of the last endowment the city on `tile` gave (not a founding without one); undefined: none */
export function lastEndowmentDay(data: RegionData, tile: RegionTile): number | undefined {
  let last: number | undefined;
  for (const e of data.endowments ?? []) {
    if (e.from !== tile.key || e.fromFounded !== tile.city?.founded || !(e.amount > 0)) continue;
    if (last === undefined || e.day > last) last = e.day;
  }
  return last;
}

/** why `parent` can give no endowment now (shown in place of the slider); undefined: it can */
export function endowmentBlock(data: RegionData, from: RegionTile, parent: SisterParent): string | undefined {
  if (parent.sandbox) return 'A sandbox city has unlimited money, so it cannot endow a sister city.';
  const last = lastEndowmentDay(data, from);
  if (last !== undefined && parent.day < last + ENDOWMENT_YEARS * DAYS_PER_YEAR) {
    return `${parent.name} endowed a sister city in ${gameMonthLabel(last, parent.startYear)}. It can endow another from ${gameMonthLabel(last + ENDOWMENT_YEARS * DAYS_PER_YEAR, parent.startYear)} (once every ${ENDOWMENT_YEARS} years).`;
  }
  if (endowmentLimit(parent.funds) < ENDOWMENT_MIN) return `${parent.name} has too little money to endow a sister city.`;
  return undefined;
}

/**
 * The best free tile for a sister city: the unfounded neighbour whose shared edge holds the most of the parent's edge
 * roads, then the one with the longest shared edge, then the one with the least water. null: every bordering tile is
 * founded (or the city fills the region's edge).
 */
export function sisterTile(model: RegionModel, from: RegionTile, parent: SisterParent): { tile: RegionTile; seg: RegionNeighbor } | null {
  let best: { tile: RegionTile; seg: RegionNeighbor } | null = null;
  let bestRoads = -1, bestLen = -1, bestWater = Infinity;
  for (const seg of regionContext(model, from).neighbors) {
    if (seg.founded) continue;
    const tile = model.tileByKey(seg.tileKey);
    if (!tile || tile.city) continue;
    let roads = 0;
    for (const r of parent.edgeRoads[seg.edge]) if (r.a >= seg.from && r.a < seg.to) roads++;
    const len = seg.to - seg.from;
    if (roads < bestRoads || (roads === bestRoads && len < bestLen)) continue;
    const water = model.tileWaterFraction(tile);
    if (roads === bestRoads && len === bestLen && water >= bestWater) continue;
    best = { tile, seg };
    bestRoads = roads; bestLen = len; bestWater = water;
  }
  return best;
}

/**
 * The stub's cells in the new city `to`: every road of the parent that reaches the shared edge segment `seg` from inside
 * is continued SISTER_STUB_CELLS cells into the new tile, with its type (and a one-way's direction). A run of edge road
 * none of whose cells is reached from inside — a road along the border — is continued at its middle cell.
 */
export function sisterStub(from: RegionTile, to: RegionTile, seg: Pick<RegionNeighbor, 'edge' | 'from' | 'to'>, parent: SisterParent): StubCell[][] {
  const roads = parent.edgeRoads[seg.edge].filter((r) => r.a >= seg.from && r.a < seg.to).sort((p, q) => p.a - q.a);
  const ends: EdgeRoad[] = [];
  for (let k = 0; k < roads.length;) {
    let e = k;
    while (e + 1 < roads.length && roads[e + 1].a === roads[e].a + 1) e++;
    const run = roads.slice(k, e + 1), inward = run.filter((r) => r.inward);
    if (inward.length) ends.push(...inward);
    else ends.push(run[run.length >> 1]);
    k = e + 1;
  }
  const along = seg.edge === 'n' || seg.edge === 's';
  const N = to.size * REGION_UNIT_CELLS;
  const out: StubCell[][] = [];
  for (const r of ends) {
    // the same place on the shared edge, in the new city's cells
    const a = ((along ? from.x : from.z) - (along ? to.x : to.z)) * REGION_UNIT_CELLS + r.a;
    if (a < 0 || a >= N) continue;
    const col: StubCell[] = [];
    for (let d = 0; d < SISTER_STUB_CELLS; d++) {
      // (the parent's east edge is the new city's west edge, and so on)
      const x = seg.edge === 'e' ? d : seg.edge === 'w' ? N - 1 - d : a;
      const z = seg.edge === 's' ? d : seg.edge === 'n' ? N - 1 - d : a;
      col.push({ x, z, type: r.type, dir: r.dir });
    }
    out.push(col);
  }
  return out;
}

/** plan a sister city of the city on `from` (step 2 above); null: no free tile borders it */
export function planSisterCity(model: RegionModel, from: RegionTile, parent: SisterParent): SisterPlan | null {
  const pick = sisterTile(model, from, parent);
  if (!pick) return null;
  const blocked = endowmentBlock(model.data, from, parent);
  const raw = blocked ? 0 : endowmentLimit(parent.funds);
  const step = raw >= 200_000 ? 10_000 : raw >= 20_000 ? 1_000 : 100;
  return {
    id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`,
    from, to: pick.tile, parent,
    limit: Math.floor(raw / step) * step, step,
    ...(blocked ? { blocked } : {}),
    amount: 0,
    stub: sisterStub(from, pick.tile, pick.seg, parent),
  };
}

/** lay the stub on the new city's land: free of charge, under the rules of a built road (dry, unbuilt, no steeper than
 *  the road type allows: actions.ts buildNetwork); a column ends at its first cell that breaks them. Returns the first
 *  cell laid (null: none could be) */
function layStub(st: CityState, stub: readonly StubCell[][]): StubCell | null {
  const N = st.size;
  let first: StubCell | null = null;
  for (const col of stub) {
    let prev: StubCell | null = null;
    for (const c of col) {
      if (!st.inBounds(c.x, c.z)) break;
      const i = c.z * N + c.x;
      const lim = NETWORK_INFO[c.type]?.maxSlope ?? 0;
      if (st.water[i] || st.network[i] !== Network.None || st.building[i] >= 0 || st.cellSlope(c.x, c.z) > lim * 1.6) break;
      if (prev && Math.abs(st.cellHeight(c.x, c.z) - st.cellHeight(prev.x, prev.z)) > lim) break;
      st.network[i] = c.type;
      st.netFlags[i] = c.type === Network.OneWay ? c.dir & ONEWAY_BITS : 0;
      st.trees[i] = 0;
      prev = c;
      first ??= c;
    }
  }
  return first;
}

/** systemData.sisterOf of a city founded as a sister city: the founding's ledger id, its parent, and where the road
 *  stub starts at the shared edge (absent: no stub could be laid) */
export interface SisterOrigin { v: 1; id: string; tile: string; name: string; at?: { x: number; z: number } }

/** step 4, before the new city's first save: its parent's name and ledger id (the budget system credits the endowment
 *  only to the city that carries the id) and its road stub */
export function prepareSisterCity(st: CityState, plan: SisterPlan): void {
  const origin: SisterOrigin = { v: 1, id: plan.id, tile: plan.from.key, name: plan.parent.name };
  const first = layStub(st, plan.stub);
  if (first) origin.at = { x: first.x, z: first.z };
  st.systemData.sisterOf = origin;
}

/**
 * Step 4's region write. The founding's ledger entry joins the region data, `write` stores the region (with the new
 * city's tile summary, which the caller has set), and a write that fails takes the entry out again: a later founding on
 * that tile must not inherit it. A retry — the same plan, so the same id — replaces its own entry. The two tile
 * summaries show the money as it will stand once both cities have booked the entry.
 */
export async function commitSisterCity(data: RegionData, plan: SisterPlan, write: () => Promise<void>): Promise<void> {
  const from = plan.from.city, to = plan.to.city;
  if (!from || !to) throw new Error('A sister city needs its parent and its own tile summary');
  const amount = plan.blocked ? 0 : Math.max(0, Math.min(plan.limit, Math.round(plan.amount) || 0));
  const entry: SisterEndowment = { id: plan.id, from: plan.from.key, to: plan.to.key, amount, day: plan.parent.day, fromFounded: from.founded, toFounded: to.founded };
  const list = (data.endowments ??= []);
  const at = list.findIndex((e) => e.id === plan.id);
  const fresh = at < 0;
  if (fresh) { list.push(entry); from.funds -= amount; }
  else list[at] = entry;
  to.funds += amount;
  try {
    await write();
  } catch (e) {
    const k = list.indexOf(entry);
    if (k >= 0) list.splice(k, 1);
    if (!list.length) delete data.endowments;
    if (fresh) from.funds += amount;
    to.funds -= amount;
    throw e;
  }
}

/** the region's sister links: each city founded as a sister city whose parent still stands on its tile */
export function sisterLinks(data: RegionData): { parent: RegionTile; city: RegionTile }[] {
  const out: { parent: RegionTile; city: RegionTile }[] = [];
  for (const city of data.tiles) {
    const key = city.city?.sisterOf;
    if (!key) continue;
    const parent = data.tiles.find((t) => t.key === key);
    if (!parent?.city) continue;
    // (the ledger knows which city founded it: not one founded later on the parent's tile)
    const e = data.endowments?.find((x) => x.to === city.key && x.from === key && x.toFounded === city.city!.founded);
    if (e && e.fromFounded !== parent.city.founded) continue;
    out.push({ parent, city });
  }
  return out;
}

/** the region card's lines, one per parent: "Queensbury → Fairland, Eastport" */
export function sisterLines(data: RegionData): string[] {
  const by = new Map<RegionTile, string[]>();
  for (const l of sisterLinks(data)) by.set(l.parent, [...(by.get(l.parent) ?? []), l.city.city!.name]);
  return [...by].map(([p, names]) => `${p.city!.name} → ${names.join(', ')}`);
}

/** a tile card's words about its city's sister links ("sister city of Queensbury", "sister city: Fairland"); '' none */
export function sisterNote(data: RegionData, tile: RegionTile): string {
  const links = sisterLinks(data);
  const parent = links.find((l) => l.city === tile)?.parent.city!.name;
  const founded = links.filter((l) => l.parent === tile).map((l) => l.city.city!.name);
  const parts: string[] = [];
  if (parent) parts.push(`sister city of ${parent}`);
  if (founded.length) parts.push(`${founded.length > 1 ? 'sister cities' : 'sister city'}: ${founded.join(', ')}`);
  return parts.join(' · ');
}

/** the ledger entries the city on `tile` has a side in (RegionContext.endowments) */
function dueEndowments(data: RegionData, tile: RegionTile): EndowmentDue[] {
  const out: EndowmentDue[] = [];
  const c = tile.city;
  if (!c || !data.endowments?.length) return out;
  const nameAt = (key: string, founded: number): string | null => {
    const o = data.tiles.find((t) => t.key === key)?.city;
    return o && o.founded === founded ? o.name : null;
  };
  for (const e of data.endowments) {
    // out: only the city that founded it pays, not one founded later on its tile. in: the entry is offered to whatever
    // stands on the new city's tile, and the budget system books it only for the city whose save carries its id
    if (e.from === tile.key && e.fromFounded === c.founded) out.push({ id: e.id, dir: 'out', amount: e.amount, day: e.day, city: nameAt(e.to, e.toFounded) });
    else if (e.to === tile.key) out.push({ id: e.id, dir: 'in', amount: e.amount, day: e.day, city: nameAt(e.from, e.fromFounded) });
  }
  return out;
}
