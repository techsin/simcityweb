/**
 * Traffic & transit system — commute / shopping / freight trip generation, congestion-aware assignment, mode choice.
 *
 * MODEL (one "cycle" = one full assignment, every TRAFFIC_CYCLE_DAYS days, time-sliced into phases):
 *  PREP     rebuild graphs when the network changed; snapshot origins (R buildings: workers = pop * 0.55), job sites
 *           (C / I capacity, plopped def.jobs, + neighbour connections as regional job sources), stops, node times
 *           from the smoothed volumes (BPR: t = t0 * (1 + 0.15 (v/c)^4)).
 *  COMMUTE  reverse multi-source Dijkstra on the road graph from every job site entry node, seeded with the job's
 *           shadow price (capacity constraint) -> every road node knows its best job + generalized cost + next hop.
 *  TRANSIT  reverse multi-source Dijkstra on the multimodal transit net (bus riding on roads, rail, subway, transfers)
 *           seeded at stops within walking distance of job sites.
 *  MODE     per origin multinomial logit car / transit / walk (wealth biases, ordinances); inject car flows and riders,
 *           accumulate along the shortest-path forests in O(n); job loads -> shadow price update; employment access.
 *  INBOUND  forward Dijkstra from neighbour connections: regional workers fill vacant jobs (connection capacities).
 *  SHOP     reverse Dijkstra from commercial services; residents' shopping trips (off-peak weighted).
 *  FREIGHT  reverse Dijkstra from freight sinks (road connections, freight stations, seaports, airports); trucks.
 *  FINAL    MSA blend of volumes (equilibrium across cycles), write layers / flags / stats, sample routes.
 *
 * OUTPUTS: state.traffic (PCU trips/day per road cell; riders/day on rail cells), state.congestion (v/c),
 *   state.commute (minutes on residential building cells), stats.avgCommute / avgTraffic / tripsCar / tripsTransit /
 *   tripsWalk, BF.NoJobs (residential: < 35 % of workers can reach a job), BF.Congested (entry road v/c > 1).
 * API (TrafficSystem, get via getTraffic(sim)):
 *   getSampleRoutes(max), routeInfo(buildingId), workerAccess(id), jobFill(id), freightAccess(id), customers(id),
 *   commuteOf(id), findPath(fromCell, toCell), pushServiceRoute(cells, weight, days), accessById / jobFillById arrays.
 */
import { Network } from '../../core/types';
import type { Building, CityState } from '../CityState';
import { BF } from '../CityState';
import type { SimSystem, Simulation } from '../Simulation';
import {
  Fam, Transit, activeJobs, centerCell, detectJobsUnknown, ensureIdFloat, infoOf, isFunctional, jobSlots, nowMs,
  readOrdinances, setFlagQuiet, wealthOf, type OrdinanceSet,
} from './common';
import { GridGraph, RoadGraph, findNeighborConnections, perimeterNodes, type NeighborConn } from './graph';
import { MinHeap } from './heap';
import {
  BPR_ALPHA, BPR_MAX_FACTOR, BUS_PCU_PER_RIDER, BUS_TIME_FACTOR, CAR_BIAS, CAR_OCCUPANCY, CAR_OVERHEAD,
  CONNECTION_JOBS, CONNECTION_WORKERS, FREIGHT_PER_JOB, MAX_COMMUTE, MODE_BETA, MSA_MIN_ALPHA, NET_CAPACITY, NET_TIME, PRICE_DOWN,
  PRICE_MAX, PRICE_UP, REGIONAL_FILL, REGIONAL_TIME, SHOP_PCU_WEIGHT, SHOP_TRIPS_PER_RES, STOP_CAP_BUS,
  STOP_CAP_SUBWAY, STOP_CAP_TRAIN, STOP_WALK_RADIUS, STOP_WALK_TIME_PER_CELL, SUBWAY_TIME, TRAFFIC_CYCLE_DAYS,
  TRAFFIC_FRAME_BUDGET_MS, TRANSIT_BIAS, TRUCK_PCU, WAIT_BUS, WAIT_SUBWAY, WAIT_TRAIN, WALK_BIAS, WALK_MAX_CELLS,
  WALK_TIME_PER_CELL, WORKER_SHARE, DEST_NOISE, RESULT_SMOOTH,
} from './params';
import { Search, Seeds, accumulate, roadSearch, transitSearch, type TransitNet } from './search';
import { collectStops, type StopList } from './transit';

export type RouteKind = 'car' | 'bus' | 'truck' | 'train' | 'service';
export interface SampleRoute {
  /** cell indices (i = z*N + x) along a real route, in travel order */
  cells: Uint32Array;
  kind: RouteKind;
  /** trips/day this route represents (spawn vehicles proportionally) */
  weight: number;
}
export interface RouteInfo {
  /** residential: average commute minutes of its workers; job site: average commute of arriving workers */
  commuteMin: number;
  /** dominant mode: 'car' | 'transit' | 'walk' | 'none' */
  mode: string;
  /** residential: workers that reached a job; job site: workers arriving (local + regional) */
  jobsReached: number;
}

const PH_PREP = 0, PH_COMMUTE = 1, PH_TRANSIT = 2, PH_MODE = 3, PH_INBOUND = 4, PH_SHOP = 5, PH_FREIGHT = 6, PH_FINAL = 7;
const PHASES = 8;
const MAX_ENTRIES = 12;
const MODE_NAMES = ['none', 'car', 'transit', 'walk'];
const IND_KEYS = ['IA', 'ID', 'IM', 'IHT'] as const;

/** growable typed arrays helper */
function growI32(a: Int32Array<ArrayBuffer>, n: number): Int32Array<ArrayBuffer> {
  if (a.length >= n) return a;
  const b = new Int32Array(Math.max(n, a.length * 2, 64));
  b.set(a);
  return b;
}
function growF32(a: Float32Array<ArrayBuffer>, n: number): Float32Array<ArrayBuffer> {
  if (a.length >= n) return a;
  const b = new Float32Array(Math.max(n, a.length * 2, 64));
  b.set(a);
  return b;
}
function growU8(a: Uint8Array<ArrayBuffer>, n: number): Uint8Array<ArrayBuffer> {
  if (a.length >= n) return a;
  const b = new Uint8Array(Math.max(n, a.length * 2, 64));
  b.set(a);
  return b;
}

export class TrafficSystem implements SimSystem {
  readonly name = 'traffic';

  // graphs
  readonly road = new RoadGraph();
  readonly rail = new GridGraph();
  readonly subway = new GridGraph();
  private graphDirty = true;
  private unsub: (() => void)[] = [];

  // scheduling
  private phase = -1;
  private lastCycleStart = -1e9;
  private lastFrameMs = -1e9;
  /** cycles since graph rebuild (MSA) */
  private iter = 0;
  /** total completed assignments */
  cycles = 0;
  /** timings (ms) of the last completed cycle per phase */
  readonly phaseMs = new Float64Array(PHASES);
  lastCycleMs = 0;

  // searches
  private heap = new MinHeap(4096);
  private SA = new Search(); // commute (persists until next cycle)
  private ST = new Search(); // transit (persists)
  private SB = new Search(); // scratch (inbound / shop / freight)
  private seeds = new Seeds();
  private tnet: TransitNet | null = null;

  // per road node
  private nodeTime: Float32Array<ArrayBuffer> = new Float32Array(0);
  private volNew: Float32Array<ArrayBuffer> = new Float32Array(0);
  private acc: Float32Array<ArrayBuffer> = new Float32Array(0);
  private tAcc: Float32Array<ArrayBuffer> = new Float32Array(0);
  private railNew: Float32Array<ArrayBuffer> = new Float32Array(0);
  private subNew: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** subway riders per cell (not in state.traffic because subway can run under roads) */
  subwayRiders: Float32Array<ArrayBuffer> = new Float32Array(0);

  // snapshot: shared entry storage
  private ent: Int32Array<ArrayBuffer> = new Int32Array(4096);
  private entN = 0;
  // origins (residential)
  private oN = 0;
  private oBid: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oW: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oPop: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oWealth: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private oEntS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oEntC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private oCell: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oHalf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private oCarNode: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oBoard: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oShC: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oShT: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oShW: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oTime: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oEmp: Float32Array<ArrayBuffer> = new Float32Array(0);
  private oJobA: Int32Array<ArrayBuffer> = new Int32Array(0);
  private oJobT: Int32Array<ArrayBuffer> = new Int32Array(0);
  // job sites (buildings then connections)
  private jN = 0;
  private jB = 0; // number of building job sites (connections follow)
  private jBid: Int32Array<ArrayBuffer> = new Int32Array(0);
  private jSlots: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jPrice: Float32Array<ArrayBuffer> = new Float32Array(0);
  /** price + destination preference noise used for this cycle's seeds */
  private jPen: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jBase: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jEntS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private jEntC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private jCell: Int32Array<ArrayBuffer> = new Int32Array(0);
  private jHalf: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private jLoad: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jTimeSum: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jInbound: Float32Array<ArrayBuffer> = new Float32Array(0);
  private jRailNode: Int32Array<ArrayBuffer> = new Int32Array(0);
  // shops
  private sN = 0;
  private sBid: Int32Array<ArrayBuffer> = new Int32Array(0);
  private sEntS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private sEntC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private sLoad: Float32Array<ArrayBuffer> = new Float32Array(0);
  // freight sources
  private fN = 0;
  private fBid: Int32Array<ArrayBuffer> = new Int32Array(0);
  private fTrucks: Float32Array<ArrayBuffer> = new Float32Array(0);
  private fEntS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private fEntC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  // freight sinks (seeds kept as building entries)
  private kN = 0;
  private kEntS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private kEntC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private kLabel: Float32Array<ArrayBuffer> = new Float32Array(0);
  // connections
  private conns: NeighborConn[] = [];
  private connPrice: Float32Array<ArrayBuffer> = new Float32Array(0);
  // stops
  private stops: StopList = { n: 0, bid: new Int32Array(64), mode: new Uint8Array(64), cell: new Int32Array(64) };
  private stAttS: Int32Array<ArrayBuffer> = new Int32Array(0);
  private stAttC: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private stAtt: Int32Array<ArrayBuffer> = new Int32Array(0);
  private stWait: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stLoad: Float32Array<ArrayBuffer> = new Float32Array(0);
  private stLoadPrev = new Map<number, number>();
  private stopBins: Int32Array<ArrayBuffer> = new Int32Array(0);
  private stopBinStart: Int32Array<ArrayBuffer> = new Int32Array(0);
  private binN = 0;
  private nodeStop: Int32Array<ArrayBuffer> = new Int32Array(0);
  private nsIdx: Int32Array<ArrayBuffer> = new Int32Array(64);
  private nsDist: Float32Array<ArrayBuffer> = new Float32Array(64);
  private jConnType: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private growth = 1;

  // persistent by building id
  private priceById: Float32Array<ArrayBuffer> = new Float32Array(1024);
  /** residential: share of workers reaching a job (0..1); -1 = unknown. Index = building id. */
  accessById: Float32Array<ArrayBuffer> = new Float32Array(1024).fill(-1);
  /** job sites: filled share of job slots by reachable workers (local + regional), 0..1; -1 unknown */
  jobFillById: Float32Array<ArrayBuffer> = new Float32Array(1024).fill(-1);
  /** industry: freight access 0..1; -1 unknown */
  freightById: Float32Array<ArrayBuffer> = new Float32Array(1024).fill(-1);
  /** commercial: customers/day */
  customersById: Float32Array<ArrayBuffer> = new Float32Array(1024);
  /** residential: commute minutes; job sites: average arriving commute */
  commuteById: Float32Array<ArrayBuffer> = new Float32Array(1024);
  /** workers reached (R) / workers arriving (jobs) */
  reachedById: Float32Array<ArrayBuffer> = new Float32Array(1024);
  private modeById: Uint8Array<ArrayBuffer> = new Uint8Array(1024);

  // stats of the cycle
  private tripsCar = 0;
  private tripsTransit = 0;
  private tripsWalk = 0;
  private tripsInbound = 0;
  private tripsShop = 0;
  private tripsFreight = 0;
  private commuteSum = 0;
  private commuteW = 0;

  // sample routes
  private routes: SampleRoute[] = [];
  private pendingRoutes: SampleRoute[] = [];
  private serviceRoutes: { r: SampleRoute; until: number }[] = [];
  private rngState = 12345;

  // cycle-level flags
  private ords: OrdinanceSet = new Set();
  private jobsUnknown = false;

  // ------------------------------------------------------------------------------------------ SimSystem
  init(sim: Simulation): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    const ev = sim.events;
    this.unsub.push(
      ev.on('networkChanged', () => { this.graphDirty = true; }),
      ev.on('subwayChanged', () => { this.graphDirty = true; }),
      ev.on('terrainChanged', () => { this.graphDirty = true; }),
      ev.on('reset', () => { this.graphDirty = true; }),
    );
    sim.state.systemData.infraVersion = 1;
    this.graphDirty = true;
    this.phase = -1;
    this.iter = 0;
    this.cycles = 0;
    this.priceById.fill(0);
    this.accessById.fill(-1);
    this.jobFillById.fill(-1);
    this.freightById.fill(-1);
    this.stLoadPrev.clear();
    this.serviceRoutes = [];
    this.routes = [];
    this.connPrice = new Float32Array(sim.state.cells);
    this.rngState = (sim.state.config.seed ^ 0x51ed27) >>> 0 || 1;
    // warm start so layers exist right after load / new city
    if (sim.state.buildings.size > 0 || sim.state.network.some((v) => v !== 0)) this.runCycleSync(sim);
  }

  daily(sim: Simulation): void {
    const st = sim.state;
    const framesActive = nowMs() - this.lastFrameMs < 750;
    if (this.phase < 0 && st.day - this.lastCycleStart >= TRAFFIC_CYCLE_DAYS) {
      this.phase = PH_PREP;
      this.lastCycleStart = st.day;
    }
    if (this.phase < 0) return;
    if (!framesActive) this.step(sim);
    else if (st.day - this.lastCycleStart > TRAFFIC_CYCLE_DAYS * 4) while (this.phase >= 0) this.step(sim);
  }

  frame(sim: Simulation, _dt: number): void {
    this.lastFrameMs = nowMs();
    if (this.phase < 0) return;
    const t0 = this.lastFrameMs;
    do this.step(sim); while (this.phase >= 0 && nowMs() - t0 < TRAFFIC_FRAME_BUDGET_MS * 0.5);
  }

  /** run one full assignment synchronously (tests / load) */
  runCycleSync(sim: Simulation): void {
    if (this.phase < 0) {
      this.phase = PH_PREP;
      this.lastCycleStart = sim.state.day;
    }
    while (this.phase >= 0) this.step(sim);
  }

  /** request a new assignment as soon as possible */
  invalidate(): void {
    this.lastCycleStart = -1e9;
  }

  // ------------------------------------------------------------------------------------------ public queries
  getSampleRoutes(max: number): SampleRoute[] {
    const out = this.routes.length <= max ? this.routes.slice() : this.routes.slice(0, max);
    for (const s of this.serviceRoutes) {
      if (out.length >= max + 8) break;
      out.push(s.r);
    }
    return out;
  }

  routeInfo(buildingId: number): RouteInfo | null {
    if (buildingId < 0 || buildingId >= this.modeById.length) return null;
    const m = this.modeById[buildingId];
    if (m === 0 && this.reachedById[buildingId] === 0 && this.commuteById[buildingId] === 0) return null;
    return { commuteMin: this.commuteById[buildingId], mode: MODE_NAMES[m] ?? 'none', jobsReached: Math.round(this.reachedById[buildingId]) };
  }
  /** residential: 0..1 share of workers that can reach a job (-1 = not assessed yet) */
  workerAccess(id: number): number {
    return id >= 0 && id < this.accessById.length ? this.accessById[id] : -1;
  }
  /** job site: 0..1 share of job slots reachable workers fill (-1 = not assessed yet) */
  jobFill(id: number): number {
    return id >= 0 && id < this.jobFillById.length ? this.jobFillById[id] : -1;
  }
  /** industry: 0..1 freight access (-1 = not assessed) */
  freightAccess(id: number): number {
    return id >= 0 && id < this.freightById.length ? this.freightById[id] : -1;
  }
  /** commercial: shopping trips/day arriving */
  customers(id: number): number {
    return id >= 0 && id < this.customersById.length ? this.customersById[id] : 0;
  }
  commuteOf(id: number): number {
    return id >= 0 && id < this.commuteById.length ? this.commuteById[id] : 0;
  }

  /** a transient service-vehicle route (fire trucks etc.) shown for `days` sim days */
  pushServiceRoute(sim: Simulation, cells: Uint32Array, weight = 1, days = 2): void {
    this.serviceRoutes.push({ r: { cells, kind: 'service', weight }, until: sim.state.day + days });
    if (this.serviceRoutes.length > 32) this.serviceRoutes.shift();
  }

  /** shortest road path (BFS over allowed moves) between two cells next to / on roads; null if none */
  findPath(sim: Simulation, fromCell: number, toCell: number, maxNodes = 20000): Uint32Array | null {
    const st = sim.state;
    // never rebuild mid-cycle (searches hold node ids of the current graph)
    if ((this.graphDirty && this.phase < 0) || this.road.N !== st.size) this.rebuildGraphs(st);
    const g = this.road;
    const a = this.nearestRoadNode(st, fromCell), b = this.nearestRoadNode(st, toCell);
    if (a < 0 || b < 0) return null;
    if (g.comp[a] !== g.comp[b]) return null;
    const n = g.n;
    const S = this.SB;
    S.ensure(n);
    const parent = S.next, done = S.done, q = S.order;
    done.fill(0, 0, n);
    let qh = 0, qt = 0;
    q[qt++] = a;
    done[a] = 1;
    parent[a] = -1;
    let found = a === b;
    while (qh < qt && !found && qt < maxNodes) {
      const u = q[qh++];
      for (let k = 0; k < 4; k++) {
        const v = g.fwd[u * 4 + k];
        if (v < 0 || done[v]) continue;
        done[v] = 1;
        parent[v] = u;
        if (v === b) { found = true; break; }
        q[qt++] = v;
      }
    }
    S.settled = 0; // scratch invalidated
    if (!found) return null;
    const path: number[] = [];
    for (let v = b; v >= 0; v = parent[v]) path.push(g.cellOf[v]);
    path.reverse();
    return Uint32Array.from(path);
  }

  private nearestRoadNode(st: CityState, cell: number): number {
    const g = this.road;
    if (cell < 0 || cell >= st.cells) return -1;
    const nd = g.nodeOfCell[cell];
    if (nd >= 0) return nd;
    const b = st.building[cell] >= 0 ? st.buildings.get(st.building[cell]) : undefined;
    if (b) {
      const tmp = new Int32Array(4);
      if (perimeterNodes(g.nodeOfCell, st.size, b, tmp, 0, 4) > 0) return tmp[0];
    }
    const N = st.size, x = cell % N, z = (cell - x) / N;
    for (let r = 1; r <= 3; r++)
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const m = g.nodeOfCell[nz * N + nx];
        if (m >= 0) return m;
      }
    return -1;
  }

  // ------------------------------------------------------------------------------------------ scheduling
  private step(sim: Simulation): void {
    const t0 = nowMs();
    const ph = this.phase;
    switch (ph) {
      case PH_PREP: this.prep(sim); break;
      case PH_COMMUTE: this.commute(); break;
      case PH_TRANSIT: this.transit(); break;
      case PH_MODE: this.modeChoice(); break;
      case PH_INBOUND: this.inbound(); break;
      case PH_SHOP: this.shopping(); break;
      case PH_FREIGHT: this.freight(); break;
      case PH_FINAL: this.finalize(sim); break;
    }
    this.phaseMs[ph] = nowMs() - t0;
    this.phase = ph + 1 >= PHASES ? -1 : ph + 1;
    if (this.phase < 0) {
      let s = 0;
      for (let i = 0; i < PHASES; i++) s += this.phaseMs[i];
      this.lastCycleMs = s;
    }
  }

  private rand(): number {
    let t = (this.rngState = (this.rngState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private rebuildGraphs(st: CityState): void {
    this.road.build(st);
    const net = st.network;
    this.rail.build(st.size, (i) => net[i] === Network.Rail);
    const sub = st.subway;
    this.subway.build(st.size, (i) => sub[i] !== 0);
    this.graphDirty = false;
    this.iter = 0;
    if (this.connPrice.length !== st.cells) this.connPrice = new Float32Array(st.cells);
  }

  private addEntries(nodeOfCell: Int32Array, N: number, b: Building): number {
    if (this.entN + MAX_ENTRIES > this.ent.length) this.ent = growI32(this.ent, (this.entN + MAX_ENTRIES) * 2);
    const c = perimeterNodes(nodeOfCell, N, b, this.ent, this.entN, MAX_ENTRIES);
    this.entN += c;
    return c;
  }

  // ------------------------------------------------------------------------------------------ PREP
  private prep(sim: Simulation): void {
    const st = sim.state;
    if (this.graphDirty || this.road.N !== st.size) this.rebuildGraphs(st);
    const g = this.road;
    const N = st.size;
    this.ords = readOrdinances(st);
    this.jobsUnknown = detectJobsUnknown(st);
    // per-id arrays
    this.priceById = ensureIdFloat(this.priceById, st);
    this.accessById = ensureIdFloat(this.accessById, st, -1);
    this.jobFillById = ensureIdFloat(this.jobFillById, st, -1);
    this.freightById = ensureIdFloat(this.freightById, st, -1);
    this.customersById = ensureIdFloat(this.customersById, st);
    this.commuteById = ensureIdFloat(this.commuteById, st);
    this.reachedById = ensureIdFloat(this.reachedById, st);
    this.modeById = growU8(this.modeById, st.nextBuildingId + 1);

    // node times from smoothed volumes (state.traffic per cell)
    const n = g.n;
    this.nodeTime = growF32(this.nodeTime, n);
    this.volNew = growF32(this.volNew, n);
    this.acc = growF32(this.acc, n);
    const traffic = st.traffic;
    for (let v = 0; v < n; v++) {
      const r = traffic[g.cellOf[v]] / g.cap[v];
      let f = 1 + BPR_ALPHA * r * r * r * r;
      if (f > BPR_MAX_FACTOR) f = BPR_MAX_FACTOR;
      this.nodeTime[v] = g.t0[v] * f;
    }
    this.volNew.fill(0, 0, n);
    this.railNew = growF32(this.railNew, this.rail.n);
    this.railNew.fill(0, 0, this.rail.n);
    this.subNew = growF32(this.subNew, this.subway.n);
    this.subNew.fill(0, 0, this.subway.n);

    // snapshot buildings
    this.entN = 0;
    let oN = 0, jN = 0, sN = 0, fN = 0, kN = 0;
    const cap = st.buildings.size + 16;
    this.oBid = growI32(this.oBid, cap); this.oW = growF32(this.oW, cap); this.oPop = growF32(this.oPop, cap);
    this.oWealth = growU8(this.oWealth, cap); this.oEntS = growI32(this.oEntS, cap); this.oEntC = growU8(this.oEntC, cap);
    this.oCell = growI32(this.oCell, cap); this.oHalf = growU8(this.oHalf, cap);
    const conns = (this.conns = findNeighborConnections(st));
    const jcap = cap + conns.length;
    this.jBid = growI32(this.jBid, jcap); this.jSlots = growF32(this.jSlots, jcap); this.jPrice = growF32(this.jPrice, jcap);
    this.jPen = growF32(this.jPen, jcap);
    this.jBase = growF32(this.jBase, jcap); this.jEntS = growI32(this.jEntS, jcap); this.jEntC = growU8(this.jEntC, jcap);
    this.jCell = growI32(this.jCell, jcap); this.jHalf = growU8(this.jHalf, jcap); this.jRailNode = growI32(this.jRailNode, jcap);
    this.jConnType = growU8(this.jConnType, jcap);
    this.sBid = growI32(this.sBid, cap); this.sEntS = growI32(this.sEntS, cap); this.sEntC = growU8(this.sEntC, cap);
    this.fBid = growI32(this.fBid, cap); this.fTrucks = growF32(this.fTrucks, cap); this.fEntS = growI32(this.fEntS, cap);
    this.fEntC = growU8(this.fEntC, cap);
    this.kEntS = growI32(this.kEntS, cap + conns.length); this.kEntC = growU8(this.kEntC, cap + conns.length);
    this.kLabel = growF32(this.kLabel, cap + conns.length);
    const nodeOfCell = g.nodeOfCell;
    const jobsUnknown = this.jobsUnknown;
    for (const b of st.buildings.values()) {
      const inf = infoOf(st, b);
      if (inf.fam === Fam.R) {
        if (b.pop <= 0 || (b.flags & BF.Burnt) !== 0) continue;
        this.oBid[oN] = b.id;
        this.oPop[oN] = b.pop;
        this.oW[oN] = b.pop * WORKER_SHARE;
        this.oWealth[oN] = wealthOf(inf, b);
        this.oCell[oN] = centerCell(st, b);
        this.oHalf[oN] = Math.max(b.w, b.d) >> 1;
        this.oEntS[oN] = this.entN;
        this.oEntC[oN] = this.addEntries(nodeOfCell, N, b);
        oN++;
        continue;
      }
      const slots = jobSlots(inf, b);
      if (slots > 0) {
        this.jBid[jN] = b.id;
        this.jSlots[jN] = slots;
        this.jPrice[jN] = this.priceById[b.id];
        this.jBase[jN] = 0;
        this.jCell[jN] = centerCell(st, b);
        this.jHalf[jN] = Math.max(b.w, b.d) >> 1;
        this.jRailNode[jN] = -1;
        this.jEntS[jN] = this.entN;
        this.jEntC[jN] = this.addEntries(nodeOfCell, N, b);
        jN++;
      }
      if (inf.fam === Fam.C && inf.dev >= 3 && inf.dev <= 5 && isFunctional(b)) {
        this.sBid[sN] = b.id;
        this.sEntS[sN] = this.entN;
        this.sEntC[sN] = this.addEntries(nodeOfCell, N, b);
        sN++;
      }
      if (inf.fam === Fam.I && isFunctional(b)) {
        const k = IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))];
        const trucks = activeJobs(inf, b, jobsUnknown) * FREIGHT_PER_JOB[k];
        if (trucks > 0) {
          this.fBid[fN] = b.id;
          this.fTrucks[fN] = trucks;
          this.fEntS[fN] = this.entN;
          this.fEntC[fN] = this.addEntries(nodeOfCell, N, b);
          fN++;
        }
      }
      if ((inf.transit === Transit.Freight || inf.transit === Transit.Seaport || inf.transit === Transit.Airport) && isFunctional(b)) {
        this.kEntS[kN] = this.entN;
        this.kEntC[kN] = this.addEntries(nodeOfCell, N, b);
        this.kLabel[kN] = 1;
        kN++;
      }
    }
    this.jB = jN;
    // neighbour connections: regional job sources + freight sinks
    const growth = (this.growth = 1 + Math.min(3, st.stats.population / 250000));
    for (const c of conns) {
      if (this.entN + 1 > this.ent.length) this.ent = growI32(this.ent, this.entN * 2 + 16);
      if (c.type === Network.Rail) {
        const rn = this.rail.nodeOfCell[c.cell];
        if (rn < 0) continue;
        this.jBid[jN] = -1;
        this.jSlots[jN] = CONNECTION_JOBS[c.type] * growth;
        this.jPrice[jN] = this.connPrice[c.cell];
        this.jBase[jN] = REGIONAL_TIME;
        this.jCell[jN] = c.cell;
        this.jHalf[jN] = 0;
        this.jRailNode[jN] = rn;
        this.jConnType[jN] = c.type;
        this.jEntS[jN] = this.entN;
        this.jEntC[jN] = 0;
        jN++;
        continue;
      }
      const nd = nodeOfCell[c.cell];
      if (nd < 0) continue;
      this.ent[this.entN] = nd;
      this.jBid[jN] = -1;
      this.jSlots[jN] = CONNECTION_JOBS[c.type] * growth;
      this.jPrice[jN] = this.connPrice[c.cell];
      this.jBase[jN] = REGIONAL_TIME;
      this.jCell[jN] = c.cell;
      this.jHalf[jN] = 0;
      this.jRailNode[jN] = -1;
      this.jConnType[jN] = c.type;
      this.jEntS[jN] = this.entN;
      this.jEntC[jN] = 1;
      jN++;
      this.kEntS[kN] = this.entN;
      this.kEntC[kN] = 1;
      this.kLabel[kN] = 3;
      kN++;
      this.entN++;
    }
    this.oN = oN; this.jN = jN; this.sN = sN; this.fN = fN; this.kN = kN;
    // per-cycle result arrays
    this.oCarNode = growI32(this.oCarNode, oN); this.oBoard = growI32(this.oBoard, oN);
    this.oShC = growF32(this.oShC, oN); this.oShT = growF32(this.oShT, oN); this.oShW = growF32(this.oShW, oN);
    this.oTime = growF32(this.oTime, oN); this.oEmp = growF32(this.oEmp, oN);
    this.oJobA = growI32(this.oJobA, oN); this.oJobT = growI32(this.oJobT, oN);
    this.jLoad = growF32(this.jLoad, jN); this.jLoad.fill(0, 0, jN);
    this.jTimeSum = growF32(this.jTimeSum, jN); this.jTimeSum.fill(0, 0, jN);
    this.jInbound = growF32(this.jInbound, jN); this.jInbound.fill(0, 0, jN);
    this.sLoad = growF32(this.sLoad, sN); this.sLoad.fill(0, 0, sN);
    this.pendingRoutes = [];
    this.prepTransit(st);
  }

  private prepTransit(st: CityState): void {
    const g = this.road, rail = this.rail, sub = this.subway;
    const N = st.size;
    const stops = collectStops(st, this.stops);
    this.stops = stops;
    const nR = g.n, nRail = rail.n, nSub = sub.n, total = nR + nRail + nSub;
    // attach nodes per stop (combined ids)
    this.stAttS = growI32(this.stAttS, stops.n + 1);
    this.stAttC = growU8(this.stAttC, stops.n + 1);
    this.stAtt = growI32(this.stAtt, stops.n * 6 + 8);
    this.stWait = growF32(this.stWait, stops.n + 1);
    this.stLoad = growF32(this.stLoad, stops.n + 1);
    this.stLoad.fill(0, 0, stops.n);
    this.nodeStop = growI32(this.nodeStop, total + 1);
    this.nodeStop.fill(-1, 0, total);
    let an = 0;
    const tmp = new Int32Array(6);
    for (let s = 0; s < stops.n; s++) {
      this.stAttS[s] = an;
      const mode = stops.mode[s];
      const bid = stops.bid[s];
      const b = bid >= 0 ? st.buildings.get(bid) : undefined;
      let c = 0;
      if (mode === Transit.Bus) {
        if (!b) {
          const nd = g.nodeOfCell[stops.cell[s]];
          if (nd >= 0) tmp[c++] = nd;
        } else c = perimeterNodes(g.nodeOfCell, N, b, tmp, 0, 2);
      } else if (mode === Transit.Train && b) {
        c = perimeterNodes(rail.nodeOfCell, N, b, tmp, 0, 4);
        for (let q = 0; q < c; q++) tmp[q] += nR;
      } else if (mode === Transit.Subway && b) {
        c = sub.perimeterNodes(b, tmp, 0, 4, true);
        for (let q = 0; q < c; q++) tmp[q] += nR + nRail;
      }
      for (let q = 0; q < c; q++) { this.stAtt[an++] = tmp[q]; this.nodeStop[tmp[q]] = s; }
      this.stAttC[s] = c;
      // wait with crowding from the previous cycle
      const key = bid >= 0 ? bid : -1 - stops.cell[s];
      const prev = this.stLoadPrev.get(key) ?? 0;
      const capS = mode === Transit.Bus ? STOP_CAP_BUS : mode === Transit.Subway ? STOP_CAP_SUBWAY : STOP_CAP_TRAIN;
      const base = mode === Transit.Bus ? WAIT_BUS : mode === Transit.Subway ? WAIT_SUBWAY : WAIT_TRAIN;
      const r = prev / capS;
      this.stWait[s] = base * Math.min(4, 1 + r * r);
    }
    this.stAttS[stops.n] = an;
    // spatial bins of stops (8x8 cells)
    const BS = 8;
    const nb = Math.ceil(N / BS);
    this.binN = nb;
    this.stopBinStart = growI32(this.stopBinStart, nb * nb + 1);
    this.stopBinStart.fill(0, 0, nb * nb + 1);
    this.stopBins = growI32(this.stopBins, stops.n + 1);
    for (let s = 0; s < stops.n; s++) {
      const c = stops.cell[s], x = c % N, z = (c - x) / N;
      this.stopBinStart[((z / BS) | 0) * nb + ((x / BS) | 0) + 1]++;
    }
    for (let i = 0; i < nb * nb; i++) this.stopBinStart[i + 1] += this.stopBinStart[i];
    const fillp = new Int32Array(nb * nb);
    for (let s = 0; s < stops.n; s++) {
      const c = stops.cell[s], x = c % N, z = (c - x) / N;
      const bi = ((z / BS) | 0) * nb + ((x / BS) | 0);
      this.stopBins[this.stopBinStart[bi] + fillp[bi]++] = s;
    }
    // transfers between stops of different modes within walking distance
    const trFrom: number[] = [], trTo: number[] = [], trCost: number[] = [];
    for (let s = 0; s < stops.n; s++) {
      if (this.stAttC[s] === 0) continue;
      const c = stops.cell[s], x = c % N, z = (c - x) / N;
      const cnt = this.nearStops(N, x, z, STOP_WALK_RADIUS);
      for (let q = 0; q < cnt; q++) {
        const s2 = this.nsIdx[q], d = this.nsDist[q];
        if (s2 <= s || stops.mode[s2] === stops.mode[s] || this.stAttC[s2] === 0) continue;
        const a = this.stAtt[this.stAttS[s]], b = this.stAtt[this.stAttS[s2]];
        const cost = d * STOP_WALK_TIME_PER_CELL + 0.5 * (this.stWait[s] + this.stWait[s2]);
        trFrom.push(a, b); trTo.push(b, a); trCost.push(cost, cost);
      }
    }
    const trStart = new Int32Array(total + 1);
    for (const f of trFrom) trStart[f + 1]++;
    for (let i = 0; i < total; i++) trStart[i + 1] += trStart[i];
    const to = new Int32Array(trFrom.length), cost = new Float32Array(trFrom.length);
    const fp = new Int32Array(total);
    for (let e = 0; e < trFrom.length; e++) {
      const f = trFrom[e];
      const p = trStart[f] + fp[f]++;
      to[p] = trTo[e];
      cost[p] = trCost[e];
    }
    const busTime = new Float32Array(nR);
    for (let v = 0; v < nR; v++) busTime[v] = this.nodeTime[v] * BUS_TIME_FACTOR;
    this.tnet = {
      nR, nRail, nSub, total, roadAdj: g.rev, busTime, railAdj: rail.adj, subAdj: sub.adj,
      railTime: NET_TIME[Network.Rail], subTime: SUBWAY_TIME, trStart, trTo: to, trCost: cost,
    };
    this.tAcc = growF32(this.tAcc, total);
  }

  /** stops within radius R of (x,z) -> this.nsIdx / this.nsDist (returns count; no allocation) */
  private nearStops(N: number, x: number, z: number, R: number): number {
    const BS = 8, nb = this.binN;
    const bx0 = Math.max(0, ((x - R) / BS) | 0), bx1 = Math.min(nb - 1, ((x + R) / BS) | 0);
    const bz0 = Math.max(0, ((z - R) / BS) | 0), bz1 = Math.min(nb - 1, ((z + R) / BS) | 0);
    const stops = this.stops;
    const R2 = R * R;
    let c = 0;
    for (let bz = bz0; bz <= bz1; bz++) for (let bx = bx0; bx <= bx1; bx++) {
      const bi = bz * nb + bx;
      for (let p = this.stopBinStart[bi], p1 = this.stopBinStart[bi + 1]; p < p1; p++) {
        const s = this.stopBins[p];
        const cell = stops.cell[s], sx = cell % N, sz = (cell - sx) / N;
        const dx = sx - x, dz = sz - z;
        const d2 = dx * dx + dz * dz;
        if (d2 > R2) continue;
        if (c >= this.nsIdx.length) {
          const a = new Int32Array(this.nsIdx.length * 2); a.set(this.nsIdx); this.nsIdx = a;
          const b = new Float32Array(this.nsDist.length * 2); b.set(this.nsDist); this.nsDist = b;
        }
        this.nsIdx[c] = s;
        this.nsDist[c] = Math.sqrt(d2);
        c++;
      }
    }
    return c;
  }

  // ------------------------------------------------------------------------------------------ COMMUTE
  private commute(): void {
    const seeds = this.seeds;
    seeds.clear();
    for (let j = 0; j < this.jN; j++) {
      // destination dispersion: idiosyncratic job preference (Monte-Carlo logit destination choice, MSA-averaged)
      this.jPen[j] = this.jPrice[j] + (this.jBid[j] >= 0 ? this.rand() * DEST_NOISE : this.rand() * DEST_NOISE * 0.5);
      const label = this.jBase[j] + this.jPen[j];
      for (let e = this.jEntS[j], e1 = e + this.jEntC[j]; e < e1; e++) seeds.push(this.ent[e], label, j);
    }
    roadSearch(this.road, this.road.rev, this.nodeTime, this.SA, this.heap, seeds, MAX_COMMUTE + PRICE_MAX + REGIONAL_TIME);
  }

  // ------------------------------------------------------------------------------------------ TRANSIT
  private transit(): void {
    const T = this.tnet!;
    const S = this.ST;
    if (this.stops.n === 0) {
      S.reset(T.total);
      return;
    }
    const seeds = this.seeds;
    seeds.clear();
    const N = this.road.N;
    for (let j = 0; j < this.jN; j++) {
      const label0 = this.jBase[j] + this.jPen[j];
      if (this.jRailNode[j] >= 0) {
        seeds.push(T.nR + this.jRailNode[j], label0, j);
        continue;
      }
      if (this.jBid[j] < 0) continue;
      const c = this.jCell[j], x = c % N, z = (c - x) / N;
      const half = this.jHalf[j];
      const cnt = this.nearStops(N, x, z, STOP_WALK_RADIUS + half);
      for (let q = 0; q < cnt; q++) {
        const s = this.nsIdx[q];
        const walk = Math.max(0, this.nsDist[q] - half) * STOP_WALK_TIME_PER_CELL;
        for (let a = this.stAttS[s], a1 = a + this.stAttC[s]; a < a1; a++) seeds.push(this.stAtt[a], label0 + walk, j);
      }
    }
    transitSearch(T, S, this.heap, seeds, MAX_COMMUTE + PRICE_MAX + REGIONAL_TIME);
  }

  // ------------------------------------------------------------------------------------------ MODE
  private modeChoice(): void {
    const SA = this.SA, ST = this.ST, T = this.tnet!;
    const distA = SA.dist, srcA = SA.src, hopsA = SA.hops, doneA = SA.done;
    const distT = ST.dist, srcT = ST.src, doneT = ST.done;
    const N = this.road.N;
    const ords = this.ords;
    const carpool = ords.has('carpool'), shuttle = ords.has('commuterShuttle');
    const carPcu = (1 / CAR_OCCUPANCY) * (carpool ? 0.88 : 1) * (shuttle ? 0.94 : 1);
    const trBonus = shuttle ? 0.4 : 0;
    const acc = this.acc, tAcc = this.tAcc;
    const nR = this.road.n;
    acc.fill(0, 0, nR);
    tAcc.fill(0, 0, T.total);
    const jLoad = this.jLoad, jPrice = this.jPrice, jPen = this.jPen, jBase = this.jBase, jTimeSum = this.jTimeSum;
    let tripsC = 0, tripsT = 0, tripsW = 0, cSum = 0, cW = 0;
    const hasStops = this.stops.n > 0;
    for (let o = 0; o < this.oN; o++) {
      const W = this.oW[o];
      // car: best entry node
      let best = -1, bd = Infinity;
      for (let e = this.oEntS[o], e1 = e + this.oEntC[o]; e < e1; e++) {
        const v = this.ent[e];
        if (doneA[v] === 1 && distA[v] < bd) { bd = distA[v]; best = v; }
      }
      let carG = Infinity, carT = Infinity, walkT = Infinity, jA = -1;
      if (best >= 0) {
        jA = srcA[best];
        carT = CAR_OVERHEAD + bd - jPen[jA];
        carG = CAR_OVERHEAD + bd;
        if (carT > MAX_COMMUTE) { carT = Infinity; carG = Infinity; }
        else if (jBase[jA] === 0 && hopsA[best] <= WALK_MAX_CELLS) walkT = (hopsA[best] + 1) * WALK_TIME_PER_CELL;
      }
      // transit
      let trG = Infinity, trT = Infinity, board = -1, boardStop = -1, jT = -1;
      if (hasStops) {
        const c = this.oCell[o], x = c % N, z = (c - x) / N;
        const half = this.oHalf[o];
        const cnt = this.nearStops(N, x, z, STOP_WALK_RADIUS + half);
        for (let q = 0; q < cnt; q++) {
          const s = this.nsIdx[q];
          const walk = Math.max(0, this.nsDist[q] - half) * STOP_WALK_TIME_PER_CELL + this.stWait[s];
          for (let a = this.stAttS[s], a1 = a + this.stAttC[s]; a < a1; a++) {
            const v = this.stAtt[a];
            if (doneT[v] !== 1) continue;
            const gcost = walk + distT[v];
            if (gcost < trG) { trG = gcost; board = v; boardStop = s; }
          }
        }
        if (board >= 0) {
          jT = srcT[board];
          trT = trG - jPen[jT];
          if (trT > MAX_COMMUTE) { trT = Infinity; trG = Infinity; board = -1; jT = -1; }
        }
      }
      // logit
      const wl = this.oWealth[o] - 1;
      const uc = carG < Infinity ? -MODE_BETA * carG + CAR_BIAS[wl] : -Infinity;
      const ut = trG < Infinity ? -MODE_BETA * trG + TRANSIT_BIAS[wl] + trBonus : -Infinity;
      const uw = walkT < Infinity ? -MODE_BETA * (walkT + (jA >= 0 ? jPen[jA] : 0)) + WALK_BIAS : -Infinity;
      const um = Math.max(uc, ut, uw);
      let sc = 0, st = 0, sw = 0;
      if (um > -Infinity) {
        const ec = uc > -Infinity ? Math.exp(uc - um) : 0;
        const et = ut > -Infinity ? Math.exp(ut - um) : 0;
        const ew = uw > -Infinity ? Math.exp(uw - um) : 0;
        const tot = ec + et + ew;
        sc = ec / tot; st = et / tot; sw = ew / tot;
      }
      this.oShC[o] = sc; this.oShT[o] = st; this.oShW[o] = sw;
      this.oCarNode[o] = best;
      this.oBoard[o] = board;
      this.oJobA[o] = jA;
      this.oJobT[o] = jT;
      const time = sc * (sc > 0 ? carT : 0) + st * (st > 0 ? trT : 0) + sw * (sw > 0 ? walkT : 0);
      this.oTime[o] = sc + st + sw > 0 ? time : 0;
      if (W <= 0) continue;
      if (sc > 0) { acc[best] += W * sc * carPcu; tripsC += W * sc; }
      if (sw > 0) tripsW += W * sw;
      if (jA >= 0) {
        jLoad[jA] += W * (sc + sw);
        jTimeSum[jA] += W * (sc * (sc > 0 ? carT : 0) + sw * (sw > 0 ? walkT : 0));
      }
      if (st > 0 && board >= 0) {
        tAcc[board] += W * st;
        tripsT += W * st;
        this.stLoad[boardStop] += W * st;
        jLoad[jT] += W * st;
        jTimeSum[jT] += W * st * trT;
      }
      if (sc + st + sw > 0) { cSum += W * this.oTime[o]; cW += W; }
    }
    // accumulate car flows
    const volNew = this.volNew;
    accumulate(SA, acc);
    for (let k = 0; k < SA.settled; k++) { const v = SA.order[k]; volNew[v] += acc[v]; }
    // accumulate riders (bus PCU on roads, rail & subway riders)
    const nodeStop = this.nodeStop, stLoad = this.stLoad;
    accumulate(ST, tAcc, (_j, f, node) => { const s = nodeStop[node]; if (s >= 0) stLoad[s] += f; });
    const nRail = T.nRail;
    for (let k = 0; k < ST.settled; k++) {
      const v = ST.order[k];
      const f = tAcc[v];
      if (f === 0) continue;
      if (v < nR) volNew[v] += f * BUS_PCU_PER_RIDER;
      else if (v < nR + nRail) this.railNew[v - nR] += f;
      else this.subNew[v - nR - nRail] += f;
    }
    // employment access per origin (using this cycle's loads)
    for (let o = 0; o < this.oN; o++) {
      let e = 0;
      const jA = this.oJobA[o], jT = this.oJobT[o];
      if (jA >= 0) e += (this.oShC[o] + this.oShW[o]) * Math.min(1, this.jSlots[jA] / Math.max(1e-6, jLoad[jA]));
      if (jT >= 0) e += this.oShT[o] * Math.min(1, this.jSlots[jT] / Math.max(1e-6, jLoad[jT]));
      this.oEmp[o] = e;
    }
    // shadow prices (capacity constraint), persisted per building / connection cell
    for (let j = 0; j < this.jN; j++) {
      const slots = this.jSlots[j];
      const ratio = jLoad[j] / Math.max(1, slots);
      let p = jPrice[j];
      if (ratio > 1) p += PRICE_UP * Math.min(2, ratio - 1);
      else p -= PRICE_DOWN * (1 - ratio);
      p = p < 0 ? 0 : p > PRICE_MAX ? PRICE_MAX : p;
      const bid = this.jBid[j];
      if (bid >= 0) this.priceById[bid] = p;
      else this.connPrice[this.jCell[j]] = p;
    }
    this.tripsCar = tripsC;
    this.tripsTransit = tripsT;
    this.tripsWalk = tripsW;
    this.commuteSum = cSum;
    this.commuteW = cW;
  }

  // ------------------------------------------------------------------------------------------ INBOUND
  private inbound(): void {
    const S = this.SB;
    const seeds = this.seeds;
    seeds.clear();
    const g = this.road;
    const conns: number[] = [];
    for (let j = this.jB; j < this.jN; j++) {
      if (this.jEntC[j] === 0) continue;
      const node = this.ent[this.jEntS[j]];
      seeds.push(node, REGIONAL_TIME, conns.length);
      conns.push(j);
    }
    this.tripsInbound = 0;
    if (seeds.n === 0) return;
    roadSearch(g, g.fwd, this.nodeTime, S, this.heap, seeds, REGIONAL_TIME + 90);
    const dist = S.dist, src = S.src, done = S.done;
    const desire = new Float32Array(this.jB);
    const bestNode = new Int32Array(this.jB).fill(-1);
    const connSum = new Float64Array(conns.length);
    for (let j = 0; j < this.jB; j++) {
      const spare = this.jSlots[j] - Math.min(this.jSlots[j], this.jLoad[j]);
      if (spare <= 0) continue;
      let bd = Infinity, bn = -1;
      for (let e = this.jEntS[j], e1 = e + this.jEntC[j]; e < e1; e++) {
        const v = this.ent[e];
        if (done[v] === 1 && dist[v] < bd) { bd = dist[v]; bn = v; }
      }
      if (bn < 0) continue;
      const f = Math.max(0.2, Math.min(1, 1.3 - bd / 60));
      desire[j] = spare * REGIONAL_FILL * f;
      bestNode[j] = bn;
      connSum[src[bn]] += desire[j];
    }
    const scale = new Float32Array(conns.length);
    for (let k = 0; k < conns.length; k++) {
      const j = conns[k];
      const capW = CONNECTION_WORKERS[this.jConnType[j]] * this.growth;
      scale[k] = connSum[k] > capW ? capW / connSum[k] : 1;
    }
    const acc = this.acc;
    acc.fill(0, 0, g.n);
    const carPcu = 1 / CAR_OCCUPANCY;
    let tot = 0;
    const cand: number[] = [];
    for (let j = 0; j < this.jB; j++) {
      const bn = bestNode[j];
      if (bn < 0) continue;
      const inflow = desire[j] * scale[src[bn]];
      this.jInbound[j] = inflow;
      acc[bn] += inflow * carPcu;
      tot += inflow;
      if (inflow > 0) cand.push(j);
    }
    accumulate(S, acc);
    for (let k = 0; k < S.settled; k++) { const v = S.order[k]; this.volNew[v] += acc[v]; }
    this.tripsInbound = tot;
    // sample inbound routes (connection -> job)
    const K = Math.min(12, cand.length);
    for (let q = 0; q < K; q++) {
      const j = cand[Math.floor(this.rand() * cand.length)];
      const path = this.tracePath(S, bestNode[j], (v) => g.cellOf[v], true);
      if (path.length >= 2) this.pendingRoutes.push({ cells: path, kind: 'car', weight: tot / Math.max(1, K) });
    }
  }

  // ------------------------------------------------------------------------------------------ SHOP
  private shopping(): void {
    const S = this.SB;
    const seeds = this.seeds;
    seeds.clear();
    const g = this.road;
    for (let s = 0; s < this.sN; s++) for (let e = this.sEntS[s], e1 = e + this.sEntC[s]; e < e1; e++) seeds.push(this.ent[e], 0, s);
    this.tripsShop = 0;
    if (seeds.n === 0) return;
    roadSearch(g, g.rev, this.nodeTime, S, this.heap, seeds, 45);
    const dist = S.dist, src = S.src, done = S.done;
    const acc = this.acc;
    acc.fill(0, 0, g.n);
    const pcu = SHOP_PCU_WEIGHT / CAR_OCCUPANCY;
    let tot = 0;
    for (let o = 0; o < this.oN; o++) {
      let bd = Infinity, bn = -1;
      for (let e = this.oEntS[o], e1 = e + this.oEntC[o]; e < e1; e++) {
        const v = this.ent[e];
        if (done[v] === 1 && dist[v] < bd) { bd = dist[v]; bn = v; }
      }
      if (bn < 0) continue;
      const trips = this.oPop[o] * SHOP_TRIPS_PER_RES * Math.exp(-Math.max(0, bd - 8) / 20);
      const carShare = this.oShC[o] + this.oShW[o] + this.oShT[o] > 0 ? this.oShC[o] : 0.7;
      const walkish = bd < 3 ? 0.6 : 0;
      acc[bn] += trips * carShare * (1 - walkish) * pcu;
      this.sLoad[src[bn]] += trips;
      tot += trips;
    }
    accumulate(S, acc);
    for (let k = 0; k < S.settled; k++) { const v = S.order[k]; this.volNew[v] += acc[v]; }
    this.tripsShop = tot;
  }

  // ------------------------------------------------------------------------------------------ FREIGHT
  private freight(): void {
    const S = this.SB;
    const seeds = this.seeds;
    seeds.clear();
    const g = this.road;
    for (let k = 0; k < this.kN; k++) for (let e = this.kEntS[k], e1 = e + this.kEntC[k]; e < e1; e++) seeds.push(this.ent[e], this.kLabel[k], k);
    this.tripsFreight = 0;
    if (seeds.n === 0) {
      for (let f = 0; f < this.fN; f++) this.freightById[this.fBid[f]] = 0.15;
      return;
    }
    roadSearch(g, g.rev, this.nodeTime, S, this.heap, seeds, 150);
    const dist = S.dist, done = S.done;
    const acc = this.acc;
    acc.fill(0, 0, g.n);
    let tot = 0;
    const cand: number[] = [];
    const candNode: number[] = [];
    for (let f = 0; f < this.fN; f++) {
      let bd = Infinity, bn = -1;
      for (let e = this.fEntS[f], e1 = e + this.fEntC[f]; e < e1; e++) {
        const v = this.ent[e];
        if (done[v] === 1 && dist[v] < bd) { bd = dist[v]; bn = v; }
      }
      const bid = this.fBid[f];
      if (bn < 0) { this.freightById[bid] = 0.15; continue; }
      this.freightById[bid] = Math.max(0.3, Math.min(1, 1.25 - bd / 60));
      const trucks = this.fTrucks[f];
      acc[bn] += trucks * TRUCK_PCU;
      tot += trucks;
      cand.push(f);
      candNode.push(bn);
    }
    accumulate(S, acc);
    for (let k = 0; k < S.settled; k++) { const v = S.order[k]; this.volNew[v] += acc[v]; }
    this.tripsFreight = tot;
    // sample truck routes weighted by trucks
    const K = Math.min(20, cand.length);
    if (K > 0) {
      const cum = new Float64Array(cand.length);
      let s = 0;
      for (let q = 0; q < cand.length; q++) { s += this.fTrucks[cand[q]]; cum[q] = s; }
      for (let q = 0; q < K; q++) {
        const idx = lowerBound(cum, this.rand() * s);
        const path = this.tracePath(S, candNode[idx], (v) => g.cellOf[v], false);
        if (path.length >= 2) this.pendingRoutes.push({ cells: path, kind: 'truck', weight: tot / K });
      }
    }
  }

  // ------------------------------------------------------------------------------------------ FINAL
  private finalize(sim: Simulation): void {
    const st = sim.state;
    const g = this.road;
    const n = g.n;
    const C = st.cells;
    const net = st.network;
    const traffic = st.traffic, congestion = st.congestion;
    // MSA blend with previous volumes (per cell)
    const alpha = Math.max(MSA_MIN_ALPHA, 1 / (this.iter + 1));
    this.iter++;
    const blended = this.acc; // reuse
    for (let v = 0; v < n; v++) {
      const c = g.cellOf[v];
      blended[v] = traffic[c] * (1 - alpha) + this.volNew[v] * alpha;
    }
    const railN = this.rail.n;
    for (let v = 0; v < railN; v++) this.railNew[v] = traffic[this.rail.cellOf[v]] * (1 - alpha) + this.railNew[v] * alpha;
    traffic.fill(0);
    congestion.fill(0);
    let congSum = 0, congN = 0;
    for (let v = 0; v < n; v++) {
      const c = g.cellOf[v];
      if (!(net[c] >= Network.Street && net[c] <= Network.Highway)) continue;
      const vol = blended[v];
      traffic[c] = vol;
      const r = vol / g.cap[v];
      congestion[c] = r;
      if (vol > 1) { congSum += r > 1 ? 1 : r; congN++; }
    }
    // rail riders
    for (let v = 0; v < this.rail.n; v++) {
      const c = this.rail.cellOf[v];
      if (net[c] !== Network.Rail) continue;
      traffic[c] = this.railNew[v];
      congestion[c] = traffic[c] / NET_CAPACITY[Network.Rail];
    }
    if (this.subwayRiders.length !== C) this.subwayRiders = new Float32Array(C);
    this.subwayRiders.fill(0);
    for (let v = 0; v < this.subway.n; v++) this.subwayRiders[this.subway.cellOf[v]] = this.subNew[v];
    // commute layer, per-building outputs & flags
    const commute = st.commute;
    commute.fill(0);
    const changed: Building[] = [];
    for (let o = 0; o < this.oN; o++) {
      const bid = this.oBid[o];
      const b = st.buildings.get(bid);
      if (!b) continue;
      // smooth per-building outputs across assignments (destination noise varies per cycle)
      const prevA = this.accessById[bid];
      const emp = prevA >= 0 && this.cycles > 0 ? prevA + (this.oEmp[o] - prevA) * RESULT_SMOOTH : this.oEmp[o];
      const prevT = this.commuteById[bid];
      const t = prevT > 0 && this.oTime[o] > 0 ? prevT + (this.oTime[o] - prevT) * RESULT_SMOOTH : this.oTime[o];
      this.accessById[bid] = emp;
      this.commuteById[bid] = t;
      this.reachedById[bid] = this.oW[o] * emp;
      const sc = this.oShC[o], stt = this.oShT[o], sw = this.oShW[o];
      this.modeById[bid] = sc + stt + sw <= 0 ? 0 : sc >= stt && sc >= sw ? 1 : stt >= sw ? 2 : 3;
      for (let z: number = b.z; z < b.z + b.d; z++) for (let x: number = b.x; x < b.x + b.w; x++) {
        const i = z * st.size + x;
        if (st.building[i] === bid) commute[i] = t;
      }
      const noJobs = b.pop > 0 && emp < 0.35;
      let f = setFlagQuiet(b, BF.NoJobs, noJobs);
      const cn = this.oCarNode[o];
      const cong = cn >= 0 && cn < n ? congestion[g.cellOf[cn]] : 0;
      f = setFlagQuiet(b, BF.Congested, cong > 1) || f;
      if (f) changed.push(b);
    }
    for (let j = 0; j < this.jB; j++) {
      const bid = this.jBid[j];
      const b = st.buildings.get(bid);
      if (!b) continue;
      const slots = this.jSlots[j];
      const local = Math.min(this.jLoad[j], slots);
      const arriving = local + this.jInbound[j];
      const fill = Math.min(1, arriving / Math.max(1, slots));
      const prevF = this.jobFillById[bid];
      this.jobFillById[bid] = prevF >= 0 && this.cycles > 0 ? prevF + (fill - prevF) * RESULT_SMOOTH : fill;
      this.reachedById[bid] = arriving;
      this.commuteById[bid] = this.jLoad[j] > 0 ? this.jTimeSum[j] / this.jLoad[j] : this.jInbound[j] > 0 ? REGIONAL_TIME + 10 : 0;
      this.modeById[bid] = arriving > 0 ? 1 : 0;
      let cong = 0;
      for (let e = this.jEntS[j], e1 = e + this.jEntC[j]; e < e1; e++) {
        const c = congestion[g.cellOf[this.ent[e]]];
        if (c > cong) cong = c;
      }
      if (setFlagQuiet(b, BF.Congested, cong > 1.1)) changed.push(b);
    }
    for (let s = 0; s < this.sN; s++) this.customersById[this.sBid[s]] = this.sLoad[s];
    for (const b of changed) sim.events.emit('buildingChanged', b);
    // stop loads for crowding
    this.stLoadPrev.clear();
    for (let s = 0; s < this.stops.n; s++) {
      const bid = this.stops.bid[s];
      this.stLoadPrev.set(bid >= 0 ? bid : -1 - this.stops.cell[s], this.stLoad[s]);
    }
    // stats
    const stats = st.stats;
    stats.tripsCar = Math.round(this.tripsCar);
    stats.tripsTransit = Math.round(this.tripsTransit);
    stats.tripsWalk = Math.round(this.tripsWalk);
    stats.avgCommute = this.commuteW > 0 ? this.commuteSum / this.commuteW : 0;
    stats.avgTraffic = congN > 0 ? congSum / congN : 0;
    // sample routes
    this.buildSampleRoutes(st);
    this.serviceRoutes = this.serviceRoutes.filter((s) => s.until >= st.day);
    this.cycles++;
    sim.events.emit('layerUpdated', 'traffic');
  }

  private tracePath(S: Search, start: number, cellOf: (v: number) => number, reverse: boolean, stopAt?: (v: number) => boolean): Uint32Array {
    const out: number[] = [];
    let v = start;
    let guard = 0;
    while (v >= 0 && guard++ < 4096) {
      if (stopAt && out.length > 0 && stopAt(v)) break;
      out.push(cellOf(v));
      v = S.next[v];
    }
    if (reverse) out.reverse();
    return Uint32Array.from(out);
  }

  private buildSampleRoutes(st: CityState): void {
    const g = this.road;
    const routes: SampleRoute[] = [];
    // cars: origins weighted by car trips
    const K = 60;
    if (this.oN > 0 && this.tripsCar > 0) {
      const cum = new Float64Array(this.oN);
      let s = 0;
      for (let o = 0; o < this.oN; o++) { s += this.oW[o] * this.oShC[o]; cum[o] = s; }
      const k = Math.min(K, this.oN);
      for (let q = 0; q < k && s > 0; q++) {
        const o = lowerBound(cum, this.rand() * s);
        const start = this.oCarNode[o];
        if (start < 0 || this.SA.done[start] !== 1) continue;
        const path = this.tracePath(this.SA, start, (v) => g.cellOf[v], false);
        if (path.length >= 2) routes.push({ cells: path, kind: 'car', weight: this.tripsCar / k });
      }
    }
    for (const r of this.pendingRoutes) routes.push(r);
    // transit: bus segments on roads, train segments on rail
    const T = this.tnet;
    if (T && this.tripsTransit > 0) {
      const cum = new Float64Array(this.oN);
      let s = 0;
      for (let o = 0; o < this.oN; o++) { s += this.oBoard[o] >= 0 ? this.oW[o] * this.oShT[o] : 0; cum[o] = s; }
      const k = Math.min(24, this.oN);
      const railCell = (v: number) => this.rail.cellOf[v - T.nR];
      for (let q = 0; q < k && s > 0; q++) {
        const o = lowerBound(cum, this.rand() * s);
        let v = this.oBoard[o];
        let guard = 0;
        let seg: number[] = [];
        let segKind = -1;
        const flush = () => {
          if (seg.length >= 3 && (segKind === 0 || segKind === 1)) {
            routes.push({ cells: Uint32Array.from(seg), kind: segKind === 0 ? 'bus' : 'train', weight: this.tripsTransit / k });
          }
          seg = [];
        };
        while (v >= 0 && guard++ < 4096) {
          const kind = v < T.nR ? 0 : v < T.nR + T.nRail ? 1 : 2;
          if (kind !== segKind) { flush(); segKind = kind; }
          if (kind === 0) seg.push(g.cellOf[v]);
          else if (kind === 1) seg.push(railCell(v));
          else seg.push(this.subway.cellOf[v - T.nR - T.nRail]);
          v = this.ST.next[v];
        }
        flush();
      }
    }
    // freight trains: freight stations to rail connections (BFS on rail graph)
    this.freightTrainRoutes(st, routes);
    // service patrols (police / garbage) as short random walks from service buildings
    this.patrolRoutes(st, routes);
    this.routes = routes;
    this.pendingRoutes = [];
  }

  private freightTrainRoutes(st: CityState, routes: SampleRoute[]): void {
    const rail = this.rail;
    if (rail.n === 0) return;
    const targets = new Set<number>();
    for (const c of this.conns) if (c.type === Network.Rail) { const rn = rail.nodeOfCell[c.cell]; if (rn >= 0) targets.add(rn); }
    const tmp = new Int32Array(4);
    let count = 0;
    for (const b of st.buildings.values()) {
      if (count >= 4) break;
      const inf = infoOf(st, b);
      if (inf.transit !== Transit.Freight && inf.transit !== Transit.Train) continue;
      if (!isFunctional(b)) continue;
      const c = perimeterNodes(rail.nodeOfCell, st.size, b, tmp, 0, 4);
      if (c === 0) continue;
      const path = this.railBfs(tmp[0], targets, inf.transit === Transit.Train);
      if (path && path.length >= 3) {
        routes.push({ cells: path, kind: 'train', weight: inf.transit === Transit.Freight ? 20 : 40 });
        count++;
      }
    }
  }

  /** BFS on rail from node a to any node in targets (or, if toStations, to another station's rail node / longest reach) */
  private railBfs(a: number, targets: Set<number>, _passenger: boolean): Uint32Array | null {
    const rail = this.rail;
    const n = rail.n;
    const par = new Int32Array(n).fill(-2);
    const q = new Int32Array(n);
    let qh = 0, qt = 0;
    q[qt++] = a;
    par[a] = -1;
    let hit = -1;
    let last = a;
    while (qh < qt) {
      const u = q[qh++];
      last = u;
      if (u !== a && targets.has(u)) { hit = u; break; }
      for (let k = 0; k < 4; k++) {
        const v = rail.adj[u * 4 + k];
        if (v < 0 || par[v] !== -2) continue;
        par[v] = u;
        q[qt++] = v;
      }
    }
    const end = hit >= 0 ? hit : last;
    if (end === a) return null;
    const out: number[] = [];
    for (let v = end; v >= 0; v = par[v]) out.push(rail.cellOf[v]);
    out.reverse();
    return Uint32Array.from(out);
  }

  private patrolRoutes(st: CityState, routes: SampleRoute[]): void {
    const g = this.road;
    if (g.n === 0) return;
    const tmp = new Int32Array(4);
    let count = 0;
    for (const b of st.buildings.values()) {
      if (count >= 10) break;
      const inf = infoOf(st, b);
      const isService = inf.cov === 0 /* police */ || inf.garbageCap > 0 || inf.cov === 2 /* health */;
      if (!isService || !isFunctional(b)) continue;
      if (perimeterNodes(g.nodeOfCell, st.size, b, tmp, 0, 1) === 0) continue;
      let v = tmp[0];
      let prev = -1;
      const cells: number[] = [g.cellOf[v]];
      for (let s = 0; s < 48; s++) {
        let choices = 0;
        let pick = -1;
        for (let k = 0; k < 4; k++) {
          const w = g.fwd[v * 4 + k];
          if (w < 0 || w === prev) continue;
          choices++;
          if (this.rand() * choices < 1) pick = w;
        }
        if (pick < 0) pick = prev;
        if (pick < 0) break;
        prev = v;
        v = pick;
        cells.push(g.cellOf[v]);
      }
      if (cells.length >= 4) {
        routes.push({ cells: Uint32Array.from(cells), kind: 'service', weight: 2 });
        count++;
      }
    }
  }
}

function lowerBound(cum: Float64Array, x: number): number {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** the traffic system instance of a simulation (or undefined when infra systems are not installed) */
export function getTraffic(sim: Simulation): TrafficSystem | undefined {
  return sim.getSystem<TrafficSystem>('traffic');
}
