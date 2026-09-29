/**
 * Shared data model of the traffic core (the numeric phases of TrafficSystem, src/sim/infra/traffic.ts at commit
 * 24f8609): the table of every per-node / per-origin / per-site / per-cluster / per-stop array, the tuning constants
 * the kernels take, and the counts. Used by
 *   - src/wasm/js/trafficCore.ts   the fair optimised-JS core (plain typed arrays),
 *   - src/wasm/kernels/trafficBind.ts   the WebAssembly core (the same arrays as views of one arena in wasm memory;
 *                                       wasm/sim-kernels/src/traffic.rs),
 *   - src/wasm/kernels/trafficDriver.ts the TrafficSystem driver (the JS parts of the phases; installs a core).
 * No simulation imports: constants are passed in (a frozen JS tree can be bound as well as the live one).
 */

export type ElemType = 'f32' | 'f64' | 'i32' | 'u8' | 'u16' | 'u32' | 'u64';

/**
 * capacity classes: N road nodes, T transit nodes (road + rail + subway), T1 = T + 1, R rail nodes, B subway nodes,
 * O origins, J job sites, Q clusters (J + 1), S shops, F freight sources, K freight sinks, P stops + 1, A stop attach
 * slots, G stop bins + 1, E transfer edges, NT shared entries, SD seeds, C road components, QE bucket-queue entries,
 * L map cells (exact), H bucket heads (fixed), X fixed size (`mult` elements)
 */
export type Cls = 'N' | 'T' | 'T1' | 'R' | 'B' | 'O' | 'J' | 'Q' | 'S' | 'F' | 'K' | 'P' | 'A' | 'G' | 'E' | 'NT' | 'SD' | 'C' | 'QE' | 'L' | 'H' | 'X';

export interface ArrDef {
  name: string;
  type: ElemType;
  cls: Cls;
  /** elements per class unit (4 for adjacency) or the fixed size for class X */
  mult: number;
  /** only the wasm core has it (graph / layer copies, bucket queue, u64 sort keys); the JS core uses the originals */
  wasmOnly: boolean;
}

const d = (name: string, type: ElemType, cls: Cls, mult = 1, wasmOnly = false): ArrDef => ({ name, type, cls, mult, wasmOnly });

/** radix histogram size (traffic.rs HIST_ROWS x 2048) and sampled car pieces per round (traffic.ts routeCand) */
export const HIST_WORDS = 5 * 2048;
export const ROUTE_MAX = 256;

/** every array of the traffic core, in arena order (names = the U slots of traffic.rs) */
export const TRAFFIC_ARRAYS: readonly ArrDef[] = [
  // road graph copies (per graph version) and rail / subway graphs
  d('rev', 'i32', 'N', 4, true), d('fwd', 'i32', 'N', 4, true), d('typ', 'u8', 'N', 1, true), d('cellOf', 'i32', 'N', 1, true),
  d('cap', 'f32', 'N', 1, true), d('t0', 'f32', 'N', 1, true), d('comp', 'i32', 'N', 1, true),
  d('railAdj', 'i32', 'R', 4, true), d('railCellOf', 'i32', 'R', 1, true), d('subAdj', 'i32', 'B', 4, true), d('subCellOf', 'i32', 'B', 1, true),
  // city layers (the wasm core stages them when they do not live in wasm memory)
  d('traffic', 'f32', 'L', 1, true), d('congestion', 'f32', 'L', 1, true), d('network', 'u8', 'L', 1, true),
  d('subwayRiders', 'f32', 'L'),
  // per road node
  d('nodeTime', 'f32', 'N'), d('volNew', 'f32', 'N'), d('acc', 'f32', 'N'), d('busTime', 'f32', 'N'), d('volInbound', 'f32', 'N'),
  d('volShop', 'f32', 'N'), d('volFreight', 'f32', 'N'), d('nodeQ', 'i32', 'N'),
  // per transit node
  d('tAcc', 'f32', 'T'), d('nodeStop', 'i32', 'T'), d('trStart', 'i32', 'T1'),
  d('railNew', 'f32', 'R'), d('subNew', 'f32', 'B'),
  // searches: SA (matching rounds), ST (transit), SB (inbound / shop / freight)
  d('saDist', 'f64', 'N'), d('saSrc', 'i32', 'N'), d('saNext', 'i32', 'N'), d('saOrder', 'i32', 'N'), d('saHops', 'u16', 'N'), d('saDone', 'u8', 'N'),
  d('stDist', 'f64', 'T'), d('stSrc', 'i32', 'T'), d('stNext', 'i32', 'T'), d('stOrder', 'i32', 'T'), d('stHops', 'u16', 'T'), d('stDone', 'u8', 'T'),
  d('sbDist', 'f64', 'N'), d('sbSrc', 'i32', 'N'), d('sbNext', 'i32', 'N'), d('sbOrder', 'i32', 'N'), d('sbHops', 'u16', 'N'), d('sbDone', 'u8', 'N'),
  // bucket queue scratch (the JS searches keep their own), seeds
  d('head', 'i32', 'H', 1, true), d('qent', 'i32', 'QE', 1, true),
  d('seedNode', 'i32', 'SD'), d('seedLabel', 'f64', 'SD'), d('seedId', 'i32', 'SD'),
  // origins
  d('oBid', 'i32', 'O'), d('oW', 'f32', 'O'), d('oPop', 'f32', 'O'), d('oWealth', 'u8', 'O'), d('oEntS', 'i32', 'O'), d('oEntC', 'u8', 'O'),
  d('oCell', 'i32', 'O'), d('oHalf', 'u8', 'O'), d('oCarNode', 'i32', 'O'), d('oBoard', 'i32', 'O'), d('oShC', 'f32', 'O'), d('oShT', 'f32', 'O'),
  d('oShW', 'f32', 'O'), d('oTime', 'f32', 'O'), d('oEmp', 'f32', 'O'), d('oJobT', 'i32', 'O'), d('oU', 'f32', 'O'), d('oAsg', 'f32', 'O'),
  d('oTimeSum', 'f32', 'O'), d('oCarW', 'f32', 'O'), d('oTrW', 'f32', 'O'), d('oWalkW', 'f32', 'O'), d('oTrT', 'f32', 'O'), d('oBoardStop', 'i32', 'O'),
  d('oLastD', 'f32', 'O'), d('candNode', 'i32', 'O'), d('sortA', 'i32', 'O'), d('sortB', 'i32', 'O'), d('keyA', 'u64', 'O', 1, true), d('keyB', 'u64', 'O', 1, true),
  // job sites (buildings, then neighbour connections)
  d('jBid', 'i32', 'J'), d('jSlots', 'f32', 'J'), d('jNoise', 'f32', 'J'), d('jAsg', 'f32', 'J'), d('jCapP', 'f32', 'J'), d('jPrice', 'f32', 'J'),
  d('jQ', 'i32', 'J'), d('jBase', 'f32', 'J'), d('jEntS', 'i32', 'J'), d('jEntC', 'u8', 'J'), d('jCell', 'i32', 'J'), d('jHalf', 'u8', 'J'),
  d('jRailNode', 'i32', 'J'), d('jConnType', 'u8', 'J'), d('jTimeSum', 'f32', 'J'), d('jInbound', 'f32', 'J'), d('jTmp', 'f32', 'J'),
  d('desire', 'f32', 'J'), d('bestNode', 'i32', 'J'), d('inCand', 'i32', 'J'), d('conns', 'i32', 'J'), d('scale', 'f32', 'J'), d('connSum', 'f64', 'J'),
  // job clusters
  d('qNode', 'i32', 'Q'), d('qSlots', 'f32', 'Q'), d('qCapP', 'f32', 'Q'), d('qAsg', 'f32', 'Q'), d('qPrice', 'f32', 'Q'), d('qProp', 'f32', 'Q'),
  d('qBase', 'f32', 'Q'), d('qNoise', 'f32', 'Q'), d('qTimeSum', 'f32', 'Q'),
  // shops, freight sources, freight sinks
  d('sBid', 'i32', 'S'), d('sEntS', 'i32', 'S'), d('sEntC', 'u8', 'S'), d('sLoad', 'f32', 'S'),
  d('fBid', 'i32', 'F'), d('fTrucks', 'f32', 'F'), d('fEntS', 'i32', 'F'), d('fEntC', 'u8', 'F'), d('fAcc', 'f32', 'F'), d('fNode', 'i32', 'F'),
  d('kEntS', 'i32', 'K'), d('kEntC', 'u8', 'K'), d('kLabel', 'f32', 'K'),
  // stops
  d('stCell', 'i32', 'P'), d('stX', 'i32', 'P'), d('stZ', 'i32', 'P'), d('stMode', 'u8', 'P'), d('stAttS', 'i32', 'P'), d('stAttC', 'u8', 'P'),
  d('stAtt', 'i32', 'A'), d('stWait', 'f32', 'P'), d('stLoad', 'f32', 'P'), d('stopBins', 'i32', 'P'), d('stopBinStart', 'i32', 'G'), d('binFill', 'i32', 'G'),
  d('nsIdx', 'i32', 'P'), d('nsDist', 'f32', 'P'), d('trTo', 'i32', 'E'), d('trCost', 'f32', 'E'),
  // transfer edges in push order (from, to, cost), placed into the CSR afterwards (traffic.ts trFrom / trTo / trCost)
  d('trEFrom', 'i32', 'E'), d('trETo', 'i32', 'E'), d('trECost', 'f32', 'E'),
  // shared entry nodes, pool scratch, radix histograms, sampled car pieces
  d('ent', 'i32', 'NT'), d('poolU', 'f64', 'C'), d('poolO', 'f64', 'C'), d('hist', 'u32', 'X', HIST_WORDS, true),
  d('routeCand', 'i32', 'X', ROUTE_MAX), d('routeW', 'f64', 'X', ROUTE_MAX),
];

/**
 * a fixed-shape object holding one (empty) array per table entry: created as ONE object literal (constant keys, in
 * table order) so V8 keeps fast properties; the cores only ever REPLACE these properties (same typed-array class), so
 * `A.x` loads in the driver's loops stay monomorphic
 */
export function newArraysObject(): TrafficArrays {
  const o = {
    rev: new Int32Array(0), fwd: new Int32Array(0), typ: new Uint8Array(0), cellOf: new Int32Array(0), cap: new Float32Array(0), t0: new Float32Array(0),
    comp: new Int32Array(0), railAdj: new Int32Array(0), railCellOf: new Int32Array(0), subAdj: new Int32Array(0), subCellOf: new Int32Array(0),
    traffic: new Float32Array(0), congestion: new Float32Array(0), network: new Uint8Array(0), subwayRiders: new Float32Array(0),
    nodeTime: new Float32Array(0), volNew: new Float32Array(0), acc: new Float32Array(0), busTime: new Float32Array(0), volInbound: new Float32Array(0),
    volShop: new Float32Array(0), volFreight: new Float32Array(0), nodeQ: new Int32Array(0),
    tAcc: new Float32Array(0), nodeStop: new Int32Array(0), trStart: new Int32Array(0), railNew: new Float32Array(0), subNew: new Float32Array(0),
    saDist: new Float64Array(0), saSrc: new Int32Array(0), saNext: new Int32Array(0), saOrder: new Int32Array(0), saHops: new Uint16Array(0), saDone: new Uint8Array(0),
    stDist: new Float64Array(0), stSrc: new Int32Array(0), stNext: new Int32Array(0), stOrder: new Int32Array(0), stHops: new Uint16Array(0), stDone: new Uint8Array(0),
    sbDist: new Float64Array(0), sbSrc: new Int32Array(0), sbNext: new Int32Array(0), sbOrder: new Int32Array(0), sbHops: new Uint16Array(0), sbDone: new Uint8Array(0),
    head: new Int32Array(0), qent: new Int32Array(0), seedNode: new Int32Array(0), seedLabel: new Float64Array(0), seedId: new Int32Array(0),
    oBid: new Int32Array(0), oW: new Float32Array(0), oPop: new Float32Array(0), oWealth: new Uint8Array(0), oEntS: new Int32Array(0), oEntC: new Uint8Array(0),
    oCell: new Int32Array(0), oHalf: new Uint8Array(0), oCarNode: new Int32Array(0), oBoard: new Int32Array(0), oShC: new Float32Array(0), oShT: new Float32Array(0),
    oShW: new Float32Array(0), oTime: new Float32Array(0), oEmp: new Float32Array(0), oJobT: new Int32Array(0), oU: new Float32Array(0), oAsg: new Float32Array(0),
    oTimeSum: new Float32Array(0), oCarW: new Float32Array(0), oTrW: new Float32Array(0), oWalkW: new Float32Array(0), oTrT: new Float32Array(0), oBoardStop: new Int32Array(0),
    oLastD: new Float32Array(0), candNode: new Int32Array(0), sortA: new Int32Array(0), sortB: new Int32Array(0), keyA: new BigUint64Array(0), keyB: new BigUint64Array(0),
    jBid: new Int32Array(0), jSlots: new Float32Array(0), jNoise: new Float32Array(0), jAsg: new Float32Array(0), jCapP: new Float32Array(0), jPrice: new Float32Array(0),
    jQ: new Int32Array(0), jBase: new Float32Array(0), jEntS: new Int32Array(0), jEntC: new Uint8Array(0), jCell: new Int32Array(0), jHalf: new Uint8Array(0),
    jRailNode: new Int32Array(0), jConnType: new Uint8Array(0), jTimeSum: new Float32Array(0), jInbound: new Float32Array(0), jTmp: new Float32Array(0),
    desire: new Float32Array(0), bestNode: new Int32Array(0), inCand: new Int32Array(0), conns: new Int32Array(0), scale: new Float32Array(0), connSum: new Float64Array(0),
    qNode: new Int32Array(0), qSlots: new Float32Array(0), qCapP: new Float32Array(0), qAsg: new Float32Array(0), qPrice: new Float32Array(0), qProp: new Float32Array(0),
    qBase: new Float32Array(0), qNoise: new Float32Array(0), qTimeSum: new Float32Array(0),
    sBid: new Int32Array(0), sEntS: new Int32Array(0), sEntC: new Uint8Array(0), sLoad: new Float32Array(0),
    fBid: new Int32Array(0), fTrucks: new Float32Array(0), fEntS: new Int32Array(0), fEntC: new Uint8Array(0), fAcc: new Float32Array(0), fNode: new Int32Array(0),
    kEntS: new Int32Array(0), kEntC: new Uint8Array(0), kLabel: new Float32Array(0),
    stCell: new Int32Array(0), stX: new Int32Array(0), stZ: new Int32Array(0), stMode: new Uint8Array(0), stAttS: new Int32Array(0), stAttC: new Uint8Array(0),
    stAtt: new Int32Array(0), stWait: new Float32Array(0), stLoad: new Float32Array(0), stopBins: new Int32Array(0), stopBinStart: new Int32Array(0), binFill: new Int32Array(0),
    nsIdx: new Int32Array(0), nsDist: new Float32Array(0), trTo: new Int32Array(0), trCost: new Float32Array(0),
    trEFrom: new Int32Array(0), trETo: new Int32Array(0), trECost: new Float32Array(0),
    ent: new Int32Array(0), poolU: new Float64Array(0), poolO: new Float64Array(0), hist: new Uint32Array(0),
    routeCand: new Int32Array(0), routeW: new Float64Array(0),
  };
  return o as unknown as TrafficArrays;
}

/** the arrays by name (typed per element type; u64 arrays are only views in the wasm core) */
export interface TrafficArrays {
  [name: string]: Float32Array | Float64Array | Int32Array | Uint8Array | Uint16Array | Uint32Array | BigUint64Array;
}
/** typed accessors for the kernels (the table fixes each array's type) */
export type TA = {
  f32: Record<string, Float32Array>;
  f64: Record<string, Float64Array>;
  i32: Record<string, Int32Array>;
  u8: Record<string, Uint8Array>;
  u16: Record<string, Uint16Array>;
};

export const CTOR = {
  f32: Float32Array, f64: Float64Array, i32: Int32Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, u64: BigUint64Array,
} as const;
export const BYTES: Record<ElemType, number> = { f32: 4, f64: 8, i32: 4, u8: 1, u16: 2, u32: 4, u64: 8 };

/** counts / per-call integers shared with the kernels (U slots of traffic.rs) */
export interface TrafficCounts {
  n: number; nRail: number; nSub: number; total: number; mapN: number; cells: number; nComp: number;
  oN: number; jN: number; jB: number; sN: number; fN: number; kN: number; qN: number; stopN: number; binN: number; entN: number; nTr: number;
  saSettled: number; stSettled: number; sbSettled: number;
  outNc: number; outRoutes: number; outCand: number; outNeed: number;
}
export const COUNT_NAMES: readonly (keyof TrafficCounts)[] = [
  'n', 'nRail', 'nSub', 'total', 'mapN', 'cells', 'nComp', 'oN', 'jN', 'jB', 'sN', 'fN', 'kN', 'qN', 'stopN', 'binN', 'entN', 'nTr',
  'saSettled', 'stSettled', 'sbSettled', 'outNc', 'outRoutes', 'outCand', 'outNeed',
];
export function newCounts(): TrafficCounts {
  const c = {} as TrafficCounts;
  for (const k of COUNT_NAMES) c[k] = 0;
  return c;
}

/** the tuning constants the kernels read (never hard-coded in Rust; computed here exactly like traffic.ts does) */
export interface TrafficParams {
  bprAlpha: number; bprMax: number; busTimeFactor: number; stopWalkT: number; priceMax: number; maxCommute: number; carOverhead: number;
  walkT: number; modeBeta: number; carBias: readonly number[]; trBias: readonly number[]; walkBias: number; busPcu: number; stepMin: number;
  stepRel: number; regionalTime: number; regionalFill: number; connWorkers: readonly number[]; invCarOcc: number; shopPcu: number;
  shopTrips: number; truckPcu: number; railCap: number; limTransit: number; limRound: number; limInbound: number; limShop: number;
  limFreight: number; invQ: number; invQT: number; headLen: number; rampPen: number; railTime: number; subTime: number;
  hw: number; street: number; rail: number; stopR: number; walkMax: number; propRounds: number;
}

/** the params.ts constants traffic.ts and search.ts use (a structural subset of the module) */
export interface TrafficParamsModule {
  BPR_ALPHA: number; BPR_MAX_FACTOR: number; BUS_TIME_FACTOR: number; STOP_WALK_TIME_PER_CELL: number; MATCH_PRICE_MAX: number;
  MAX_COMMUTE: number; CAR_OVERHEAD: number; WALK_TIME_PER_CELL: number; MODE_BETA: number; CAR_BIAS: readonly number[];
  TRANSIT_BIAS: readonly number[]; WALK_BIAS: number; BUS_PCU_PER_RIDER: number; MATCH_PRICE_STEP_MIN: number; MATCH_PRICE_STEP_REL: number;
  REGIONAL_TIME: number; REGIONAL_FILL: number; CONNECTION_WORKERS: readonly number[]; CAR_OCCUPANCY: number; SHOP_PCU_WEIGHT: number;
  SHOP_TRIPS_PER_RES: number; TRUCK_PCU: number; NET_CAPACITY: readonly number[]; DEST_NOISE: number; NET_TIME: readonly number[];
  SUBWAY_TIME: number; RAMP_PENALTY: number; STOP_WALK_RADIUS: number; WALK_MAX_CELLS: number; MATCH_PROP_ROUNDS: number;
}

export interface NetworkEnum {
  Street: number; Road: number; Avenue: number; OneWay: number; Highway: number; Rail: number;
}

export function trafficParams(P: TrafficParamsModule, Network: NetworkEnum): TrafficParams {
  const T = P.NET_TIME;
  // exactly search.ts: Q = MIN_ROAD_T * 0.999, QT likewise
  const MIN_ROAD_T = Math.min(T[1], T[2], T[3], T[4], T[5]);
  const invQ = 1 / (MIN_ROAD_T * 0.999);
  const invQT = 1 / (Math.min(P.SUBWAY_TIME, T[6], MIN_ROAD_T * P.BUS_TIME_FACTOR) * 0.999);
  return {
    bprAlpha: P.BPR_ALPHA, bprMax: P.BPR_MAX_FACTOR, busTimeFactor: P.BUS_TIME_FACTOR, stopWalkT: P.STOP_WALK_TIME_PER_CELL,
    priceMax: P.MATCH_PRICE_MAX, maxCommute: P.MAX_COMMUTE, carOverhead: P.CAR_OVERHEAD, walkT: P.WALK_TIME_PER_CELL, modeBeta: P.MODE_BETA,
    carBias: P.CAR_BIAS, trBias: P.TRANSIT_BIAS, walkBias: P.WALK_BIAS, busPcu: P.BUS_PCU_PER_RIDER, stepMin: P.MATCH_PRICE_STEP_MIN,
    stepRel: P.MATCH_PRICE_STEP_REL, regionalTime: P.REGIONAL_TIME, regionalFill: P.REGIONAL_FILL, connWorkers: P.CONNECTION_WORKERS,
    invCarOcc: 1 / P.CAR_OCCUPANCY, shopPcu: P.SHOP_PCU_WEIGHT / P.CAR_OCCUPANCY, shopTrips: P.SHOP_TRIPS_PER_RES, truckPcu: P.TRUCK_PCU,
    railCap: P.NET_CAPACITY[Network.Rail],
    // traffic.ts search limits, same expressions (left-to-right f64 sums)
    limTransit: P.MAX_COMMUTE + P.DEST_NOISE + P.REGIONAL_TIME,
    limRound: P.MAX_COMMUTE + P.DEST_NOISE + P.REGIONAL_TIME + 2 * P.MATCH_PRICE_MAX,
    limInbound: P.REGIONAL_TIME + 90, limShop: 45, limFreight: 150,
    invQ, invQT, headLen: Math.max(Math.ceil(2000 * invQ), Math.ceil(2000 * invQT)) + 8,
    rampPen: P.RAMP_PENALTY, railTime: T[Network.Rail], subTime: P.SUBWAY_TIME,
    hw: Network.Highway, street: Network.Street, rail: Network.Rail, stopR: P.STOP_WALK_RADIUS, walkMax: P.WALK_MAX_CELLS,
    propRounds: P.MATCH_PROP_ROUNDS,
  };
}

/** the graphs the kernels read (RoadGraph / GridGraph of src/sim/infra/graph.ts, structurally) */
export interface RoadGraphLike {
  N: number; n: number; version: number; nComp: number;
  fwd: Int32Array; rev: Int32Array; type: Uint8Array; cellOf: Int32Array; cap: Float32Array; t0: Float32Array; comp: Int32Array;
  nodeOfCell: Int32Array;
}
export interface GridGraphLike {
  n: number; version: number; adj: Int32Array; cellOf: Int32Array; nodeOfCell: Int32Array;
}
export interface LayersLike {
  traffic: Float32Array; congestion: Float32Array; network: Uint8Array; cells: number; size: number;
}

/** per-call scalars (F slots) */
export interface TrafficScalars {
  propFactor: number; carPcu: number; trBonus: number; alpha: number; growth: number; regionWorkerCap: number;
}

/** the kernel set both cores implement (JS: src/wasm/js/trafficCore.ts; wasm: trafficBind.ts) */
export interface TrafficCoreApi {
  /** 'fair' (optimised JS) or 'wasm' (plus the binary label) */
  readonly kind: string;
  /** arrays (views into wasm memory for the wasm core; re-read after ensure() / memory growth) */
  readonly A: TrafficArrays;
  readonly c: TrafficCounts;
  readonly s: TrafficScalars;
  /** kernel outputs (F out0..out7) */
  readonly out: Float64Array;
  readonly P: TrafficParams;
  /** grow capacity classes to at least `need` (contents kept); returns true when arrays moved */
  ensure(need: Partial<Record<Cls, number>>): boolean;
  /** called after arrays moved (reallocation or wasm memory growth): the driver re-points its fields */
  onMove(cb: () => void): void;
  /** graphs of this cycle (the wasm core copies them into wasm memory once per version) */
  bindGraphs(road: RoadGraphLike, rail: GridGraphLike, sub: GridGraphLike): void;
  /** city layers read / written by prepNodes and finalize (wasm: zero-copy when they live in wasm memory) */
  bindLayers(st: LayersLike): void;
  prepNodes(): void;
  prepOrigins(): void;
  clusters(): void;
  prepStops(): void;
  transfers(): void;
  transit(): void;
  roundSearch(round: number): void;
  roundMatch(round: number): void;
  commute(): void;
  inboundCached(): void;
  /** returns 1 when a search ran (route sampling follows), 0 otherwise */
  inbound(): number;
  shop(): number;
  /** returns 0 when there are no freight sinks (every source 0.15) */
  freight(): number;
  addCached(which: 0 | 1 | 2): void;
  finalize(): void;
  /** calls per path (wasm / JS fallback) since creation */
  readonly calls: Record<string, number>;
}
