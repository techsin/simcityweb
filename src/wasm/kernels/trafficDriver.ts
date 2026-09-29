/**
 * TrafficSystem driver: runs the traffic cycle of a TrafficSystem instance (src/sim/infra/traffic.ts at commit 24f8609)
 * on a traffic core — the fair optimised-JS core (src/wasm/js/trafficCore.ts) or the WebAssembly core (trafficBind.ts)
 * — by INSTANCE-LEVEL method overrides (no sim file is edited): prep, prepTransit, transit, roundSearch, roundMatch,
 * commuteEnd (+ poolRemaining), inbound, shopping, freight, finalize; finalize2 / findPath are wrapped only to refresh
 * the array views first. step(), the scheduler cadence and every public query stay the original code.
 *
 * What stays JS here (identical for both cores, so an A/B of the cores isolates the kernels): the building walk
 * (Building objects -> o* / j* / s* / f* / k* arrays), findNeighborConnections, collectStops and the stop attachment,
 * every RNG draw in the original order (jNoise, route sampling), tracePath, the per-building-id arrays (priceById,
 * connPrice, inboundById, freightById: gathered / scattered around the kernels), the round control flow, stLoadPrev,
 * the stats, finalize2 and the sample routes.
 *
 * The TrafficSystem's typed-array fields (nodeTime, volNew, o*, j*, q*, st*, ...) and its Search objects' arrays are
 * re-pointed at the core's arrays (views into wasm memory for the wasm core) at every phase and whenever the core
 * reports that its arrays moved (reallocation / memory growth), so the original JS that still reads them (finalize2,
 * buildSampleRoutes, findPath, nodeTimes, tests) is unchanged.
 */
import type { Arrs } from '../js/trafficCore';
import { TRAFFIC_ARRAYS, type Cls, type NetworkEnum, type TrafficCoreApi, type TrafficParamsModule } from './trafficLayout';

/** phase ids of traffic.ts 24f8609 */
const PH_RSEARCH = 3, PH_COMMUTE = 5;
/** traffic.ts MAX_ENTRIES: entry nodes per building and role */
const MAX_ENTRIES_24F8609 = 12;
const IND_KEYS = ['IA', 'ID', 'IM', 'IHT'] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/** the modules traffic.ts imports, from the tree the TrafficSystem comes from (structural) */
export interface TrafficDriverDeps {
  Network: NetworkEnum;
  params: TrafficParamsModule & {
    DEST_NOISE: number; CONNECTION_JOBS: readonly number[]; REGION_JOB_SHARE: number; REGION_JOB_MIN: number; REGION_WORKER_SHARE: number;
    REGION_WORKER_MIN: number; MATCH_PROP_SLACK: number; MATCH_ROUNDS: number; MSA_MIN_ALPHA: number; FREIGHT_PER_JOB: Record<string, number>;
    STOP_CAP_BUS: number; STOP_CAP_SUBWAY: number; STOP_CAP_TRAIN: number; WAIT_BUS: number; WAIT_SUBWAY: number; WAIT_TRAIN: number;
  };
  common: {
    Fam: { R: number; C: number; I: number; Plop: number };
    Transit: { Bus: number; Subway: number; Train: number; Freight: number; Seaport: number; Airport: number };
    activeJobs(inf: Any, b: Any, jobsUnknown: boolean): number;
    centerCell(st: Any, b: Any): number;
    detectJobsUnknown(st: Any): boolean;
    ensureIdFloat(arr: Float32Array, st: Any, fill?: number): Float32Array;
    infoOf(st: Any, b: Any): Any;
    isFunctional(b: Any): boolean;
    jobSlots(inf: Any, b: Any): number;
    readEffects(st: Any): Any;
    wealthOf(inf: Any, b: Any): number;
    buildingList(st: Any): Any[];
  };
  graph: {
    findNeighborConnections(st: Any): { cell: number; type: number }[];
    perimeterNodes(nodeOfCell: Int32Array, N: number, b: Any, out: Int32Array, offset: number, max: number): number;
  };
  transit: { collectStops(st: Any, out?: Any): { n: number; bid: Int32Array; mode: Uint8Array; cell: Int32Array } };
  workerShare(b: Any): number;
  REGION_JOBS_FOR_RESIDENTS: number;
  BF: { Burnt: number };
}

export interface TrafficCoreHandle {
  readonly core: TrafficCoreApi;
  /** re-point the TrafficSystem fields at the core's arrays */
  mirror(): void;
  /** remove the overrides (the fields keep the core's arrays) */
  uninstall(): void;
}

function growU8(a: Uint8Array, n: number): Uint8Array {
  if (a.length >= n) return a;
  const b = new Uint8Array(Math.max(n, a.length * 2, 64));
  b.set(a);
  return b;
}

/** traffic.ts lowerBound over cum[0, n) */
function lowerBound(cum: Float64Array, n: number, x: number): number {
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** TrafficSystem fields that hold core arrays: [field, core array] */
const FIELD_MAP: readonly [string, string][] = [
  ['nodeTime', 'nodeTime'], ['volNew', 'volNew'], ['acc', 'acc'], ['tAcc', 'tAcc'], ['railNew', 'railNew'], ['subNew', 'subNew'],
  ['ent', 'ent'], ['oBid', 'oBid'], ['oW', 'oW'], ['oPop', 'oPop'], ['oWealth', 'oWealth'], ['oEntS', 'oEntS'], ['oEntC', 'oEntC'],
  ['oCell', 'oCell'], ['oHalf', 'oHalf'], ['oCarNode', 'oCarNode'], ['oBoard', 'oBoard'], ['oShC', 'oShC'], ['oShT', 'oShT'], ['oShW', 'oShW'],
  ['oTime', 'oTime'], ['oEmp', 'oEmp'], ['oJobT', 'oJobT'], ['jBid', 'jBid'], ['jSlots', 'jSlots'], ['jNoise', 'jNoise'], ['jAsg', 'jAsg'],
  ['jCapP', 'jCapP'], ['jPrice', 'jPrice'], ['jQ', 'jQ'], ['qNode', 'qNode'], ['qSlots', 'qSlots'], ['qCapP', 'qCapP'], ['qAsg', 'qAsg'],
  ['qPrice', 'qPrice'], ['qProp', 'qProp'], ['qBase', 'qBase'], ['qNoise', 'qNoise'], ['qTimeSum', 'qTimeSum'], ['nodeQ', 'nodeQ'],
  ['jBase', 'jBase'], ['jEntS', 'jEntS'], ['jEntC', 'jEntC'], ['jCell', 'jCell'], ['jHalf', 'jHalf'], ['jTimeSum', 'jTimeSum'],
  ['jInbound', 'jInbound'], ['jRailNode', 'jRailNode'], ['jConnType', 'jConnType'], ['sBid', 'sBid'], ['sEntS', 'sEntS'], ['sEntC', 'sEntC'],
  ['sLoad', 'sLoad'], ['fBid', 'fBid'], ['fTrucks', 'fTrucks'], ['fEntS', 'fEntS'], ['fEntC', 'fEntC'], ['kEntS', 'kEntS'], ['kEntC', 'kEntC'],
  ['kLabel', 'kLabel'], ['stAttS', 'stAttS'], ['stAttC', 'stAttC'], ['stAtt', 'stAtt'], ['stWait', 'stWait'], ['stLoad', 'stLoad'],
  ['stopBins', 'stopBins'], ['stopBinStart', 'stopBinStart'], ['nodeStop', 'nodeStop'], ['nsIdx', 'nsIdx'], ['nsDist', 'nsDist'],
  ['trStartA', 'trStart'], ['busTimeA', 'busTime'], ['oU', 'oU'], ['oAsg', 'oAsg'], ['oTimeSum', 'oTimeSum'], ['oCarW', 'oCarW'],
  ['oTrW', 'oTrW'], ['oWalkW', 'oWalkW'], ['oTrT', 'oTrT'], ['oBoardStop', 'oBoardStop'], ['oLastD', 'oLastD'], ['candNode', 'candNode'],
  ['volShop', 'volShop'], ['volFreight', 'volFreight'], ['volInbound', 'volInbound'],
];
const SEARCH_MAP: readonly [string, string][] = [['SA', 'sa'], ['ST', 'st'], ['SB', 'sb']];

/**
 * install `core` on the TrafficSystem instance `trObj` (24f8609). The core's arrays replace the system's arrays from
 * the next prep on; call on a fresh system (before its first cycle) or between cycles (phase < 0).
 */
export function installTrafficCore(trObj: object, deps: TrafficDriverDeps, core: TrafficCoreApi): TrafficCoreHandle {
  const tr = trObj as Any;
  const proto = Object.getPrototypeOf(tr) as Any;
  const { Network, params: PM, common: C, graph: G, transit: TR, BF } = deps;
  const { Fam, Transit } = C;
  const A = core.A as unknown as Arrs;
  const c = core.c, s = core.s, out = core.out;
  const routeCum = new Float64Array(256);
  let truckCum = new Float64Array(64);
  const tmp6 = new Int32Array(6);
  let active = false;
  /** finalize produced subwayRiders (the original keeps its empty array until the first finalize) */
  let ridersOut = false;

  function mirror(): void {
    if (!active) return;
    const a = A as unknown as Record<string, unknown>;
    for (const [f, k] of FIELD_MAP) tr[f] = a[k];
    for (const [f, p] of SEARCH_MAP) {
      const S = tr[f];
      S.dist = a[p + 'Dist']; S.src = a[p + 'Src']; S.next = a[p + 'Next']; S.hops = a[p + 'Hops']; S.order = a[p + 'Order']; S.done = a[p + 'Done'];
    }
    if (tr.tnet) {
      tr.tnet.busTime = A.busTime; tr.tnet.trStart = A.trStart; tr.tnet.trTo = A.trTo; tr.tnet.trCost = A.trCost;
    }
    if (ridersOut) tr.subwayRiders = A.subwayRiders;
  }
  core.onMove(mirror);

  const layersOf = (st: Any) => ({ traffic: st.traffic, congestion: st.congestion, network: st.network, cells: st.cells, size: st.size });
  const carPcuOf = (fx: Any) => (1 / PM.CAR_OCCUPANCY) * (fx ? fx.trafficCar : 1);

  const o: Record<string, (...a: Any[]) => Any> = {};

  // ------------------------------------------------------------------------------------------ PREP
  o.prep = function prep(this: Any, sim: Any): void {
    const st = sim.state;
    if (this.graphDirty || this.road.N !== st.size) this.rebuildGraphs(st);
    const g = this.road, rail = this.rail, sub = this.subway;
    const N = st.size;
    this.fx = C.readEffects(st);
    this.jobsUnknown = C.detectJobsUnknown(st);
    this.priceById = C.ensureIdFloat(this.priceById, st);
    if (this.connPrice.length !== st.cells) this.connPrice = new Float32Array(st.cells);
    this.accessById = C.ensureIdFloat(this.accessById, st, -1);
    this.jobFillById = C.ensureIdFloat(this.jobFillById, st, -1);
    this.freightById = C.ensureIdFloat(this.freightById, st, -1);
    this.customersById = C.ensureIdFloat(this.customersById, st);
    this.commuteById = C.ensureIdFloat(this.commuteById, st);
    this.reachedById = C.ensureIdFloat(this.reachedById, st);
    this.inboundById = C.ensureIdFloat(this.inboundById, st);
    this.modeById = growU8(this.modeById, st.nextBuildingId + 1);
    const conns = (this.conns = G.findNeighborConnections(st));
    const cap = st.buildings.size + 16;
    core.bindGraphs(g, rail, sub);
    core.bindLayers(layersOf(st));
    core.ensure({
      N: g.n, R: rail.n, B: sub.n, T: g.n + rail.n + sub.n, C: g.nComp, O: cap, J: cap + conns.length, S: cap, F: cap, K: cap + conns.length,
      NT: Math.max(c.entN + (c.entN >> 2) + 64, 256), L: st.cells,
    });
    mirror();
    core.prepNodes();
    // snapshot buildings (JS). Values are computed before an entry list can grow the arrays, and every array access
    // goes through A (re-pointed on growth): never hold a view across addEntries.
    let entN = 0;
    const nodeOfCell = g.nodeOfCell;
    const jobsUnknown = this.jobsUnknown;
    const addEntries = (b: Any): number => {
      if (entN + MAX_ENTRIES_24F8609 > A.ent.length) core.ensure({ NT: (entN + MAX_ENTRIES_24F8609) * 2 });
      const k = G.perimeterNodes(nodeOfCell, N, b, A.ent, entN, MAX_ENTRIES_24F8609);
      entN += k;
      return k;
    };
    let oN = 0, jN = 0, sN = 0, fN = 0, kN = 0;
    this.patrolIds.length = 0;
    this.stationIds.length = 0;
    for (let bI = 0, bL = C.buildingList(st); bI < bL.length; bI++) {
      const b = bL[bI];
      const inf = C.infoOf(st, b);
      if (inf.fam === Fam.Plop && C.isFunctional(b)) {
        if (inf.cov === 0 || inf.cov === 2 || inf.garbageCap > 0) this.patrolIds.push(b.id);
        if (inf.transit === Transit.Freight || inf.transit === Transit.Train) this.stationIds.push(b.id);
      }
      if (inf.fam === Fam.R) {
        if (b.pop <= 0 || (b.flags & BF.Burnt) !== 0) continue;
        const w = b.pop * deps.workerShare(b), wealth = C.wealthOf(inf, b), cell = C.centerCell(st, b), half = Math.max(b.w, b.d) >> 1, s0 = entN;
        const k = addEntries(b);
        A.oBid[oN] = b.id; A.oPop[oN] = b.pop; A.oW[oN] = w; A.oWealth[oN] = wealth; A.oCell[oN] = cell; A.oHalf[oN] = half;
        A.oEntS[oN] = s0; A.oEntC[oN] = k;
        oN++;
        continue;
      }
      const slots = C.jobSlots(inf, b);
      if (slots > 0) {
        const cell = C.centerCell(st, b), half = Math.max(b.w, b.d) >> 1, s0 = entN;
        const k = addEntries(b);
        A.jBid[jN] = b.id; A.jSlots[jN] = slots; A.jBase[jN] = 0; A.jCell[jN] = cell; A.jHalf[jN] = half; A.jRailNode[jN] = -1;
        A.jEntS[jN] = s0; A.jEntC[jN] = k;
        jN++;
      }
      if (inf.fam === Fam.C && inf.dev >= 3 && inf.dev <= 5 && C.isFunctional(b)) {
        const s0 = entN;
        const k = addEntries(b);
        A.sBid[sN] = b.id; A.sEntS[sN] = s0; A.sEntC[sN] = k;
        sN++;
      }
      if (inf.fam === Fam.I && C.isFunctional(b)) {
        const key = IND_KEYS[Math.max(0, Math.min(3, inf.dev - 8))];
        const trucks = C.activeJobs(inf, b, jobsUnknown) * PM.FREIGHT_PER_JOB[key];
        if (trucks > 0) {
          const s0 = entN;
          const k = addEntries(b);
          A.fBid[fN] = b.id; A.fTrucks[fN] = trucks; A.fEntS[fN] = s0; A.fEntC[fN] = k;
          fN++;
        }
      }
      if ((inf.transit === Transit.Freight || inf.transit === Transit.Seaport || inf.transit === Transit.Airport) && C.isFunctional(b)) {
        const s0 = entN;
        const k = addEntries(b);
        A.kEntS[kN] = s0; A.kEntC[kN] = k; A.kLabel[kN] = 1;
        kN++;
      }
    }
    this.jB = jN;
    // neighbour connections: regional job sources + freight sinks
    const growth = (this.growth = 1 + Math.min(3, st.stats.population / 250000));
    for (const cn of conns) {
      if (entN + 1 > A.ent.length) core.ensure({ NT: entN * 2 + 16 });
      if (cn.type === Network.Rail) {
        const rn = rail.nodeOfCell[cn.cell];
        if (rn < 0) continue;
        A.jBid[jN] = -1; A.jSlots[jN] = PM.CONNECTION_JOBS[cn.type] * growth; A.jBase[jN] = PM.REGIONAL_TIME; A.jCell[jN] = cn.cell; A.jHalf[jN] = 0;
        A.jRailNode[jN] = rn; A.jConnType[jN] = cn.type; A.jEntS[jN] = entN; A.jEntC[jN] = 0;
        jN++;
        continue;
      }
      const nd = nodeOfCell[cn.cell];
      if (nd < 0) continue;
      A.ent[entN] = nd;
      A.jBid[jN] = -1; A.jSlots[jN] = PM.CONNECTION_JOBS[cn.type] * growth; A.jBase[jN] = PM.REGIONAL_TIME; A.jCell[jN] = cn.cell; A.jHalf[jN] = 0;
      A.jRailNode[jN] = -1; A.jConnType[jN] = cn.type; A.jEntS[jN] = entN; A.jEntC[jN] = 1;
      jN++;
      A.kEntS[kN] = entN; A.kEntC[kN] = 1; A.kLabel[kN] = 3;
      kN++;
      entN++;
    }
    this.oN = oN; this.jN = jN; this.sN = sN; this.fN = fN; this.kN = kN; this.entN = entN;
    c.oN = oN; c.jN = jN; c.jB = this.jB; c.sN = sN; c.fN = fN; c.kN = kN; c.entN = entN;
    // regional sums + per-cycle origin initialisation (kernel), regional caps (JS)
    core.prepOrigins();
    const workers = out[0], citySlots = out[1], connSlots = out[2];
    const sd = st.systemData;
    const regionJobs = typeof sd.regionJobs === 'number' ? (sd.regionJobs as number) : (PM.REGION_JOB_SHARE * workers + PM.REGION_JOB_MIN) * deps.REGION_JOBS_FOR_RESIDENTS;
    if (connSlots > regionJobs && connSlots > 0) {
      const f = regionJobs / connSlots;
      for (let j = this.jB; j < jN; j++) A.jSlots[j] *= f;
    }
    this.regionWorkerCap = typeof sd.regionWorkers === 'number' ? (sd.regionWorkers as number) : PM.REGION_WORKER_SHARE * citySlots + PM.REGION_WORKER_MIN;
    // destination noise (RNG, JS), matching capacities, prices from the per-id arrays
    let slotsAll = 0;
    const jNoise = A.jNoise, jAsg = A.jAsg, jPrice = A.jPrice, jBid = A.jBid, jCell = A.jCell, jSlots = A.jSlots;
    const priceById = this.priceById, connPrice = this.connPrice, DN = PM.DEST_NOISE;
    for (let j = 0; j < jN; j++) {
      jNoise[j] = this.rand() * (jBid[j] >= 0 ? DN : DN * 0.5);
      jAsg[j] = 0;
      jPrice[j] = jBid[j] >= 0 ? priceById[jBid[j]] : connPrice[jCell[j]];
      slotsAll += jSlots[j];
    }
    this.propFactor = slotsAll > 0 ? Math.min(1, (PM.MATCH_PROP_SLACK * workers) / slotsAll) : 1;
    s.propFactor = this.propFactor;
    core.clusters();
    this.qN = c.qN;
    this.round = 0;
    this.tripsCar = this.tripsTransit = this.tripsWalk = 0;
    this.commuteSum = this.commuteW = 0;
    // shopping / freight: recompute every 2nd cycle or after a graph rebuild
    this.sfRecompute = this.sfVersion !== g.version || this.cycles % 2 === 0;
    A.jTimeSum.fill(0, 0, jN);
    A.jInbound.fill(0, 0, jN);
    if (this.sfRecompute) A.sLoad.fill(0, 0, sN);
    this.pendingRoutes = [];
    mirror();
  };

  o.prepTransit = function prepTransit(this: Any, st: Any): void {
    const g = this.road, rail = this.rail, sub = this.subway;
    const N = st.size;
    const stops = TR.collectStops(st, this.stops);
    this.stops = stops;
    const nR = g.n, nRail = rail.n, nSub = sub.n, total = nR + nRail + nSub;
    const nb = Math.ceil(N / 8);
    core.ensure({ P: stops.n + 1, A: stops.n * 6 + 8, T: total, G: nb * nb + 1 });
    c.total = total;
    c.stopN = stops.n;
    A.stLoad.fill(0, 0, stops.n);
    A.nodeStop.fill(-1, 0, total);
    let an = 0;
    const tmp = tmp6;
    const stAttS = A.stAttS, stAttC = A.stAttC, stAtt = A.stAtt, nodeStop = A.nodeStop, stWait = A.stWait;
    for (let q = 0; q < stops.n; q++) {
      stAttS[q] = an;
      const mode = stops.mode[q];
      const bid = stops.bid[q];
      const b = bid >= 0 ? st.buildings.get(bid) : undefined;
      let cnt = 0;
      if (mode === Transit.Bus) {
        if (!b) {
          const nd = g.nodeOfCell[stops.cell[q]];
          if (nd >= 0) tmp[cnt++] = nd;
        } else cnt = G.perimeterNodes(g.nodeOfCell, N, b, tmp, 0, 2);
      } else if (mode === Transit.Train && b) {
        cnt = G.perimeterNodes(rail.nodeOfCell, N, b, tmp, 0, 4);
        for (let k = 0; k < cnt; k++) tmp[k] += nR;
      } else if (mode === Transit.Subway && b) {
        cnt = sub.perimeterNodes(b, tmp, 0, 4, true);
        for (let k = 0; k < cnt; k++) tmp[k] += nR + nRail;
      }
      for (let k = 0; k < cnt; k++) { stAtt[an++] = tmp[k]; nodeStop[tmp[k]] = q; }
      stAttC[q] = cnt;
      // wait with crowding from the previous cycle
      const key = bid >= 0 ? bid : -1 - stops.cell[q];
      const prev = this.stLoadPrev.get(key) ?? 0;
      const capS = mode === Transit.Bus ? PM.STOP_CAP_BUS : mode === Transit.Subway ? PM.STOP_CAP_SUBWAY : PM.STOP_CAP_TRAIN;
      const base = mode === Transit.Bus ? PM.WAIT_BUS : mode === Transit.Subway ? PM.WAIT_SUBWAY : PM.WAIT_TRAIN;
      const r = prev / capS;
      stWait[q] = base * Math.min(4, 1 + r * r);
    }
    stAttS[stops.n] = an;
    A.stCell.set(stops.cell.subarray(0, stops.n));
    A.stMode.set(stops.mode.subarray(0, stops.n));
    core.prepStops();
    this.binN = c.binN;
    core.transfers();
    this.tnet = {
      nR, nRail, nSub, total, roadAdj: g.rev, busTime: A.busTime, railAdj: rail.adj, subAdj: sub.adj,
      railTime: PM.NET_TIME[Network.Rail], subTime: PM.SUBWAY_TIME, trStart: A.trStart, trTo: A.trTo, trCost: A.trCost,
    };
    mirror();
  };

  // ------------------------------------------------------------------------------------------ TRANSIT / ROUNDS
  o.transit = function transit(this: Any): void {
    mirror();
    core.transit();
    this.ST.n = c.total;
    this.ST.settled = c.stSettled;
    mirror();
  };

  o.roundSearch = function roundSearch(this: Any): void {
    mirror();
    core.roundSearch(this.round);
    const SA = this.SA;
    SA.n = c.n;
    SA.settled = c.saSettled;
    SA.graphVersion = this.road.version;
    mirror();
  };

  o.roundMatch = function roundMatch(this: Any): number {
    mirror();
    const fx = this.fx;
    s.carPcu = carPcuOf(fx);
    s.trBonus = fx ? 2.5 * Math.log(fx.transitRidership) : 0;
    core.roundMatch(this.round);
    mirror();
    const accepted = out[0], carRound = out[1], left = out[2], nr = c.outRoutes;
    if (carRound > 0) {
      // sample car routes of this round (weighted by car trips)
      const K = Math.min(10, nr);
      if (K > 0) {
        const cum = routeCum, rw = A.routeW, rc = A.routeCand;
        let sw = 0;
        for (let q = 0; q < nr; q++) { sw += rw[q]; cum[q] = sw; }
        const g = this.road;
        for (let r = 0; r < K; r++) {
          const idx = lowerBound(cum, nr, this.rand() * sw);
          const path = this.tracePath(this.SA, rc[idx], (v: number) => g.cellOf[v], false);
          if (path.length >= 2) this.pendingRoutes.push({ cells: path, kind: 'car', weight: carRound / K });
        }
      }
    }
    this.roundAccepted = accepted;
    // next round? (the original control flow)
    let next = this.round + 1;
    const PROP = PM.MATCH_PROP_ROUNDS;
    if (next < PROP && (accepted < 0.5 || this.propFactor >= 1)) next = Math.max(next, accepted < 0.5 ? PROP : next);
    if (left < 0.5 || next >= PM.MATCH_ROUNDS || (accepted < 0.5 && this.round >= PROP)) return PH_COMMUTE;
    let open = 0;
    const saveRound = this.round;
    this.round = next;
    for (let q = 0; q < this.qN; q++) { const cc = this.openCap(q); if (cc > 0.5) open += cc; }
    if (open < 0.5) { this.round = saveRound; return PH_COMMUTE; }
    return PH_RSEARCH;
  };

  // ------------------------------------------------------------------------------------------ COMMUTE
  o.commuteEnd = function commuteEnd(this: Any): void {
    mirror();
    s.carPcu = carPcuOf(this.fx);
    core.commute();
    mirror();
    // persist prices by building id / connection cell (the original distribution loop's second half)
    const jN = c.jN, jQ = A.jQ, jBid = A.jBid, jCell = A.jCell, qPrice = A.qPrice, priceById = this.priceById, connPrice = this.connPrice;
    for (let j = 0; j < jN; j++) {
      const q = jQ[j];
      if (q < 0) continue;
      if (jBid[j] >= 0) priceById[jBid[j]] = qPrice[q];
      else connPrice[jCell[j]] = qPrice[q];
    }
    this.tripsCar = out[0];
    this.tripsTransit = out[1];
    this.tripsWalk = out[2];
    this.commuteSum = out[3];
    this.commuteW = out[4];
  };
  o.poolRemaining = function poolRemaining(): void {
    throw new Error('trafficDriver: poolRemaining runs inside commuteEnd');
  };

  // ------------------------------------------------------------------------------------------ INBOUND / SHOP / FREIGHT
  o.inbound = function inbound(this: Any): void {
    mirror();
    const jB = this.jB;
    if (!this.sfRecompute) {
      const tmp = A.jTmp, jBid = A.jBid, inb = this.inboundById;
      for (let j = 0; j < jB; j++) tmp[j] = inb[jBid[j]];
      core.inboundCached();
      this.tripsInbound = out[0];
      return;
    }
    s.growth = this.growth;
    s.regionWorkerCap = this.regionWorkerCap;
    const searched = core.inbound();
    mirror();
    {
      const jBid = A.jBid, jIn = A.jInbound, inb = this.inboundById;
      for (let j = 0; j < jB; j++) inb[jBid[j]] = jIn[j];
    }
    this.tripsInbound = out[0];
    if (!searched) return;
    const SB = this.SB;
    SB.n = c.n; SB.settled = c.sbSettled; SB.graphVersion = this.road.version;
    const nc = c.outCand, tot = out[0];
    const K = Math.min(12, nc);
    const g = this.road;
    for (let q = 0; q < K; q++) {
      const j = A.inCand[Math.floor(this.rand() * nc)];
      const path = this.tracePath(SB, A.bestNode[j], (v: number) => g.cellOf[v], true);
      if (path.length >= 2) this.pendingRoutes.push({ cells: path, kind: 'car', weight: tot / Math.max(1, K) });
    }
  };

  o.addCached = function addCached(): void {
    throw new Error('trafficDriver: addCached runs inside the kernels');
  };

  o.shopping = function shopping(this: Any): void {
    mirror();
    if (!this.sfRecompute) { core.addCached(1); return; }
    const searched = core.shop();
    mirror();
    this.tripsShop = out[0];
    if (searched) { const SB = this.SB; SB.n = c.n; SB.settled = c.sbSettled; SB.graphVersion = this.road.version; }
  };

  o.freight = function freight(this: Any): void {
    mirror();
    const g = this.road;
    if (!this.sfRecompute) { core.addCached(2); return; }
    this.sfVersion = g.version;
    this.truckRoutes = [];
    const searched = core.freight();
    mirror();
    const fN = c.fN, fBid = A.fBid, fAcc = A.fAcc, fr = this.freightById;
    for (let f = 0; f < fN; f++) fr[fBid[f]] = fAcc[f];
    this.tripsFreight = out[0];
    if (!searched) return;
    const SB = this.SB;
    SB.n = c.n; SB.settled = c.sbSettled; SB.graphVersion = g.version;
    // sample truck routes weighted by trucks
    const fNode = A.fNode, fTrucks = A.fTrucks;
    const cand: number[] = [], candNode: number[] = [];
    for (let f = 0; f < fN; f++) if (fNode[f] >= 0) { cand.push(f); candNode.push(fNode[f]); }
    const K = Math.min(20, cand.length);
    const tot = out[0];
    if (K > 0) {
      if (truckCum.length < cand.length) truckCum = new Float64Array(cand.length * 2);
      const cum = truckCum;
      let sAcc = 0;
      for (let q = 0; q < cand.length; q++) { sAcc += fTrucks[cand[q]]; cum[q] = sAcc; }
      for (let q = 0; q < K; q++) {
        const idx = lowerBound(cum, cand.length, this.rand() * sAcc);
        const path = this.tracePath(SB, candNode[idx], (v: number) => g.cellOf[v], false);
        if (path.length >= 2) this.truckRoutes.push({ cells: path, kind: 'truck', weight: tot / K });
      }
    }
  };

  // ------------------------------------------------------------------------------------------ FINAL
  o.finalize = function finalize(this: Any, sim: Any): void {
    mirror();
    const st = sim.state;
    const alpha = Math.max(PM.MSA_MIN_ALPHA, 1 / (this.iter + 1));
    this.iter++;
    s.alpha = alpha;
    core.bindLayers(layersOf(st));
    core.finalize();
    ridersOut = true;
    this.subwayRiders = A.subwayRiders;
    // stop loads for crowding
    this.stLoadPrev.clear();
    const stops = this.stops, stLoad = A.stLoad;
    for (let q = 0; q < stops.n; q++) {
      const bid = stops.bid[q];
      this.stLoadPrev.set(bid >= 0 ? bid : -1 - stops.cell[q], stLoad[q]);
    }
    const stats = st.stats;
    stats.tripsCar = Math.round(this.tripsCar);
    stats.tripsTransit = Math.round(this.tripsTransit);
    stats.tripsWalk = Math.round(this.tripsWalk);
    stats.avgCommute = this.commuteW > 0 ? this.commuteSum / this.commuteW : 0;
    stats.avgTraffic = out[1] > 0 ? out[0] / out[1] : 0;
    mirror();
  };

  o.finalize2 = function finalize2(this: Any, sim: Any): void {
    mirror();
    return proto.finalize2.call(this, sim);
  };
  o.findPath = function findPath(this: Any, ...args: Any[]): Any {
    mirror();
    return proto.findPath.apply(this, args);
  };

  /**
   * take over the system's current state: every mapped array (and the searches' arrays, the transfer arrays of the
   * transit net) copied into the core, capacities at least the system's array lengths (stale tails included), counts
   * from the system. Makes installing on a running system (warm-start cycle already done, mid-game A/B switch) exact.
   */
  function adopt(): void {
    const defs = new Map(TRAFFIC_ARRAYS.map((d) => [d.name, d]));
    const need: Partial<Record<Cls, number>> = {};
    const want = (name: string, len: number) => {
      const d = defs.get(name)!;
      if (d.cls === 'X' || d.cls === 'L' || d.cls === 'H') return;
      const units = Math.ceil(len / d.mult);
      if (units > (need[d.cls] ?? 0)) need[d.cls] = units;
    };
    const pairs: [Float32Array, string][] = [];
    for (const [f, k] of FIELD_MAP) if (tr[f] && ArrayBuffer.isView(tr[f])) pairs.push([tr[f] as Float32Array, k]);
    for (const [f, p] of SEARCH_MAP) {
      const S = tr[f];
      for (const [x, y] of [['dist', 'Dist'], ['src', 'Src'], ['next', 'Next'], ['hops', 'Hops'], ['order', 'Order'], ['done', 'Done']]) pairs.push([S[x], p + y]);
    }
    if (tr.tnet) { pairs.push([tr.tnet.trTo, 'trTo'], [tr.tnet.trCost, 'trCost']); }
    for (const [src, k] of pairs) want(k, src.length);
    core.ensure(need);
    const a = A as unknown as Record<string, Float32Array>;
    for (const [src, k] of pairs) {
      const dst = a[k];
      const m = Math.min(src.length, dst.length);
      if (m > 0) dst.set(src.subarray(0, m));
    }
    c.n = tr.road.n; c.nRail = tr.rail.n; c.nSub = tr.subway.n; c.nComp = tr.road.nComp; c.mapN = tr.road.N;
    c.total = c.n + c.nRail + c.nSub;
    c.oN = tr.oN; c.jN = tr.jN; c.jB = tr.jB; c.sN = tr.sN; c.fN = tr.fN; c.kN = tr.kN; c.qN = tr.qN; c.entN = tr.entN; c.binN = tr.binN;
    c.stopN = tr.stops?.n ?? 0;
    c.nTr = tr.tnet ? tr.tnet.trStart[tr.tnet.total] : 0;
    c.saSettled = tr.SA.settled; c.stSettled = tr.ST.settled; c.sbSettled = tr.SB.settled;
    if (tr.subwayRiders.length > 0) {
      core.ensure({ L: tr.subwayRiders.length });
      A.subwayRiders.set(tr.subwayRiders);
      ridersOut = true;
    }
  }

  active = true;
  adopt();
  mirror();
  for (const [k, f] of Object.entries(o)) tr[k] = f;
  return {
    core,
    mirror,
    uninstall() {
      active = false;
      for (const k of Object.keys(o)) delete tr[k];
    },
  };
}
