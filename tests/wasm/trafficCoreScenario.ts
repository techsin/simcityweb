/**
 * Synthetic inputs for the traffic core kernels (tests/wasm/trafficCore.test.ts): a random road grid (one-ways,
 * highways, disconnected pieces), rail / subway grids, origins, job sites (buildings, road and rail connections),
 * shops, freight sources and sinks, stops with attach nodes, city layers — plus loaders that put one scenario into a
 * core (fair JS or wasm) or into an original TrafficSystem instance (frozen 24f8609 class, fields assigned directly).
 * No simulation imports: the constants come in as TrafficParams / params-like objects.
 */
import type { Cls, GridGraphLike, LayersLike, RoadGraphLike, TrafficCoreApi, TrafficParams } from '../../src/wasm/kernels/trafficLayout';

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export interface ScenarioOpts {
  N: number;
  roadFill: number;
  origins: number;
  sites: number;
  conns: number;
  railConns: number;
  shops: number;
  fsrc: number;
  sinks: number;
  stops: number;
  railFill: number;
  subFill: number;
  /** extreme values: zero / huge capacities and volumes, subnormals, wealth outside 1..3 */
  extreme: boolean;
}

export interface Scenario {
  opts: ScenarioOpts;
  road: RoadGraphLike;
  rail: GridGraphLike;
  sub: GridGraphLike;
  layers: LayersLike;
  counts: { oN: number; jN: number; jB: number; sN: number; fN: number; kN: number; stopN: number; entN: number };
  /** array contents by core array name (only the inputs the driver's JS writes) */
  arrays: Record<string, Float32Array | Int32Array | Uint8Array>;
  scalars: { propFactor: number; carPcu: number; trBonus: number; growth: number; regionWorkerCap: number; alpha: number };
  /** per-id arrays of the driver (inbound gather) */
  inboundById: Float32Array;
}

const HW = 5;

function gridGraph(N: number, mask: (i: number) => boolean): GridGraphLike & { comp: Int32Array } {
  const nodeOfCell = new Int32Array(N * N).fill(-1);
  let n = 0;
  for (let i = 0; i < N * N; i++) if (mask(i)) nodeOfCell[i] = n++;
  const cellOf = new Int32Array(Math.max(1, n)), adj = new Int32Array(Math.max(4, 4 * n)).fill(-1);
  for (let i = 0, k = 0; i < N * N; i++) if (nodeOfCell[i] >= 0) cellOf[k++] = i;
  const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
  for (let a = 0; a < n; a++) {
    const c = cellOf[a], x = c % N, z = (c - x) / N;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k], nz = z + DZ[k];
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const b = nodeOfCell[nz * N + nx];
      if (b >= 0) adj[a * 4 + k] = b;
    }
  }
  return { n, version: 1, adj, cellOf, nodeOfCell, comp: new Int32Array(Math.max(1, n)) };
}

/** the random scenario of `seed` */
export function makeScenario(seed: number, o: Partial<ScenarioOpts> = {}, P?: { NET_TIME: readonly number[]; NET_CAPACITY: readonly number[]; REGIONAL_TIME: number }): Scenario {
  const r = rng(seed);
  const opts: ScenarioOpts = {
    N: 24 + Math.floor(r() * 40), roadFill: 0.35 + r() * 0.4, origins: Math.floor(r() * 300), sites: Math.floor(r() * 120), conns: Math.floor(r() * 5),
    railConns: Math.floor(r() * 3), shops: Math.floor(r() * 40), fsrc: Math.floor(r() * 30), sinks: Math.floor(r() * 4), stops: Math.floor(r() * 60),
    railFill: r() * 0.08, subFill: r() * 0.06, extreme: false, ...o,
  };
  const NET_TIME = P?.NET_TIME ?? [0, 0.16, 0.1, 0.085, 0.075, 0.04, 0.035];
  const NET_CAP = P?.NET_CAPACITY ?? [0, 350, 1200, 1600, 2600, 7000, 12000];
  const REGIONAL_TIME = P?.REGIONAL_TIME ?? 16;
  const N = opts.N, C = N * N;
  // cell types: road (1..5), rail (6) or nothing; subway independent
  const net = new Uint8Array(C);
  for (let i = 0; i < C; i++) {
    const q = r();
    if (q < opts.roadFill) net[i] = 1 + Math.floor(r() * 5);
    else if (q < opts.roadFill + opts.railFill) net[i] = 6;
  }
  const subMask = new Uint8Array(C);
  for (let i = 0; i < C; i++) if (r() < opts.subFill) subMask[i] = 1;
  // road graph: grid moves between road cells; Highway <-> Street not connected; some directed edges dropped (one-ways)
  const g0 = gridGraph(N, (i) => net[i] >= 1 && net[i] <= 5);
  const n = g0.n;
  const type = new Uint8Array(Math.max(1, n)), cap = new Float32Array(Math.max(1, n)), t0 = new Float32Array(Math.max(1, n));
  for (let v = 0; v < n; v++) {
    const t = net[g0.cellOf[v]];
    type[v] = t;
    cap[v] = opts.extreme && r() < 0.03 ? (r() < 0.5 ? 0 : 1e30) : NET_CAP[t];
    t0[v] = NET_TIME[t];
  }
  const fwd = new Int32Array(Math.max(4, 4 * n)).fill(-1), rev = new Int32Array(Math.max(4, 4 * n)).fill(-1);
  for (let a = 0; a < n; a++) for (let k = 0; k < 4; k++) {
    const b = g0.adj[a * 4 + k];
    if (b < 0) continue;
    const ta = type[a], tb = type[b];
    if ((ta === HW && tb === 1) || (tb === HW && ta === 1)) continue;
    if (r() < 0.06) continue; // one-way
    fwd[a * 4 + k] = b;
    rev[b * 4 + ((k + 2) & 3)] = a;
  }
  // weakly connected components
  const comp = new Int32Array(Math.max(1, n)).fill(-1);
  let nComp = 0;
  const stack = new Int32Array(Math.max(1, n));
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    let sp = 0;
    stack[sp++] = s;
    comp[s] = nComp;
    while (sp > 0) {
      const a = stack[--sp];
      for (let k = 0; k < 4; k++) {
        let b = fwd[a * 4 + k];
        if (b >= 0 && comp[b] < 0) { comp[b] = nComp; stack[sp++] = b; }
        b = rev[a * 4 + k];
        if (b >= 0 && comp[b] < 0) { comp[b] = nComp; stack[sp++] = b; }
      }
    }
    nComp++;
  }
  const road: RoadGraphLike = { N, n, version: seed * 7 + 3, nComp, fwd, rev, type, cellOf: g0.cellOf, cap, t0, comp, nodeOfCell: g0.nodeOfCell };
  const railG = gridGraph(N, (i) => net[i] === 6);
  const subG = gridGraph(N, (i) => subMask[i] === 1);
  const rail: GridGraphLike = { n: railG.n, version: seed + 11, adj: railG.adj, cellOf: railG.cellOf, nodeOfCell: railG.nodeOfCell };
  const sub: GridGraphLike = { n: subG.n, version: seed + 13, adj: subG.adj, cellOf: subG.cellOf, nodeOfCell: subG.nodeOfCell };
  const traffic = new Float32Array(C), congestion = new Float32Array(C);
  for (let i = 0; i < C; i++) {
    if (net[i] === 0) continue;
    const q = r();
    traffic[i] = q < 0.2 ? 0 : opts.extreme && q > 0.97 ? (q > 0.985 ? 1e-40 : 3e7) : r() * 9000;
  }
  const layers: LayersLike = { traffic, congestion, network: net, cells: C, size: N };
  // entities; entries = random road nodes (<= 12)
  const ents: number[] = [];
  const entries = (max: number) => {
    const s = ents.length;
    const c = n === 0 ? 0 : Math.floor(r() * (max + 1));
    for (let k = 0; k < c; k++) ents.push(Math.floor(r() * n));
    return [s, c] as const;
  };
  const A: Record<string, number[]> = {};
  const put = (k: string, v: number) => (A[k] ??= []).push(v);
  const cellR = () => Math.floor(r() * C);
  for (let o = 0; o < opts.origins; o++) {
    const pop = r() < 0.05 ? 0 : 1 + r() * (opts.extreme ? 1e6 : 3000);
    put('oBid', 1 + o); put('oPop', pop); put('oW', pop * 0.55);
    put('oWealth', opts.extreme && r() < 0.05 ? (r() < 0.5 ? 0 : 4) : 1 + Math.floor(r() * 3));
    put('oCell', cellR()); put('oHalf', Math.floor(r() * 4));
    const [s, c] = entries(12);
    put('oEntS', s); put('oEntC', c);
  }
  const jB = opts.sites;
  for (let j = 0; j < jB; j++) {
    put('jBid', 10000 + j); put('jSlots', r() < 0.05 ? 0 : 1 + r() * (opts.extreme ? 1e6 : 4000)); put('jBase', 0); put('jCell', cellR());
    put('jHalf', Math.floor(r() * 4)); put('jRailNode', -1); put('jConnType', 0);
    const [s, c] = entries(12);
    put('jEntS', s); put('jEntC', c);
  }
  let jN = jB, kN = 0;
  const kS: number[] = [], kC: number[] = [], kL: number[] = [];
  for (let q = 0; q < opts.conns && n > 0; q++) {
    const nd = Math.floor(r() * n);
    const s = ents.length;
    ents.push(nd);
    put('jBid', -1); put('jSlots', 2000 * (1 + r())); put('jBase', REGIONAL_TIME); put('jCell', road.cellOf[nd]); put('jHalf', 0); put('jRailNode', -1);
    put('jConnType', 1 + Math.floor(r() * 5)); put('jEntS', s); put('jEntC', 1);
    jN++;
    kS.push(s); kC.push(1); kL.push(3); kN++;
  }
  for (let q = 0; q < opts.railConns && rail.n > 0; q++) {
    const rn = Math.floor(r() * rail.n);
    put('jBid', -1); put('jSlots', 6000 * (1 + r())); put('jBase', REGIONAL_TIME); put('jCell', rail.cellOf[rn]); put('jHalf', 0); put('jRailNode', rn);
    put('jConnType', 6); put('jEntS', ents.length); put('jEntC', 0);
    jN++;
  }
  for (let s2 = 0; s2 < opts.shops; s2++) { put('sBid', 20000 + s2); const [s, c] = entries(6); put('sEntS', s); put('sEntC', c); }
  for (let f = 0; f < opts.fsrc; f++) { put('fBid', 30000 + f); put('fTrucks', r() * 50); const [s, c] = entries(6); put('fEntS', s); put('fEntC', c); }
  for (let k = 0; k < opts.sinks; k++) { const [s, c] = entries(4); kS.push(s); kC.push(c); kL.push(1); kN++; }
  A.kEntS = kS; A.kEntC = kC; A.kLabel = kL;
  // stops: cell, mode (1 bus / 2 subway / 3 train), attach nodes in the combined id space, wait
  const total = n + rail.n + sub.n;
  const stAtt: number[] = [], stAttS: number[] = [], stAttC: number[] = [];
  for (let s = 0; s < opts.stops; s++) {
    const mode = 1 + Math.floor(r() * 3);
    put('stCell', cellR()); put('stMode', mode); put('stWait', 3 + r() * 12);
    stAttS.push(stAtt.length);
    const lo = mode === 1 ? 0 : mode === 3 ? n : n + rail.n, cnt = mode === 1 ? n : mode === 3 ? rail.n : sub.n;
    const c = cnt === 0 ? 0 : Math.floor(r() * (mode === 1 ? 3 : 5));
    for (let k = 0; k < c; k++) stAtt.push(lo + Math.floor(r() * cnt));
    stAttC.push(c);
  }
  stAttS.push(stAtt.length);
  A.stAtt = stAtt; A.stAttS = stAttS; A.stAttC = stAttC;
  const I = (k: string) => Int32Array.from(A[k] ?? []), F = (k: string) => Float32Array.from(A[k] ?? []), B = (k: string) => Uint8Array.from(A[k] ?? []);
  const arrays: Scenario['arrays'] = {
    oBid: I('oBid'), oPop: F('oPop'), oW: F('oW'), oWealth: B('oWealth'), oCell: I('oCell'), oHalf: B('oHalf'), oEntS: I('oEntS'), oEntC: B('oEntC'),
    jBid: I('jBid'), jSlots: F('jSlots'), jBase: F('jBase'), jCell: I('jCell'), jHalf: B('jHalf'), jRailNode: I('jRailNode'), jConnType: B('jConnType'),
    jEntS: I('jEntS'), jEntC: B('jEntC'), sBid: I('sBid'), sEntS: I('sEntS'), sEntC: B('sEntC'), fBid: I('fBid'), fTrucks: F('fTrucks'),
    fEntS: I('fEntS'), fEntC: B('fEntC'), kEntS: I('kEntS'), kEntC: B('kEntC'), kLabel: F('kLabel'), stCell: I('stCell'), stMode: B('stMode'),
    stWait: F('stWait'), stAtt: I('stAtt'), stAttS: I('stAttS'), stAttC: B('stAttC'), ent: Int32Array.from(ents),
    // the RNG-drawn / per-id inputs the driver's JS writes: noise, prices (incl. negative subsidies)
    jNoise: Float32Array.from({ length: jN }, () => r() * 0.02), jPrice: Float32Array.from({ length: jN }, () => (r() < 0.3 ? 0 : (r() - 0.4) * 50)),
  };
  // nodeStop: last stop attached at a node (JS prepTransit)
  const nodeStop = new Int32Array(total).fill(-1);
  for (let s = 0; s < opts.stops; s++) for (let a = stAttS[s]; a < stAttS[s + 1]; a++) nodeStop[stAtt[a]] = s;
  arrays.nodeStop = nodeStop;
  const inboundById = new Float32Array(40000);
  for (let i = 0; i < inboundById.length; i++) if (r() < 0.2) inboundById[i] = r() * 300;
  return {
    opts, road, rail, sub, layers,
    counts: { oN: opts.origins, jN, jB, sN: opts.shops, fN: opts.fsrc, kN, stopN: opts.stops, entN: ents.length },
    arrays,
    scalars: { propFactor: r() < 0.5 ? 1 : 0.3 + r() * 0.7, carPcu: 1 / 1.15 * (0.8 + r() * 0.4), trBonus: r() < 0.5 ? 0 : 2.5 * Math.log(0.8 + r()), growth: 1 + r() * 3, regionWorkerCap: r() * 20000, alpha: Math.max(0.3, 1 / (1 + Math.floor(r() * 5))) },
    inboundById,
  };
}

/** copy of the scenario's layers (each core / system mutates its own) */
export function cloneLayers(L: LayersLike): LayersLike {
  return { traffic: L.traffic.slice(), congestion: L.congestion.slice(), network: L.network.slice(), cells: L.cells, size: L.size };
}

/** load a scenario into a core (sizes, graphs, layers, input arrays, counts, scalars) */
export function loadCore(core: TrafficCoreApi, sc: Scenario, layers: LayersLike): void {
  const { road, rail, sub, counts: k } = sc;
  const total = road.n + rail.n + sub.n;
  const need: Partial<Record<Cls, number>> = {
    N: road.n, R: rail.n, B: sub.n, T: total, C: road.nComp, O: k.oN, J: k.jN, S: k.sN, F: k.fN, K: k.kN, NT: k.entN, L: layers.cells,
    P: k.stopN + 1, A: k.stopN * 6 + 8, G: Math.ceil(road.N / 8) ** 2 + 1, SD: 64,
  };
  core.ensure(need);
  core.bindGraphs(road, rail, sub);
  core.bindLayers(layers);
  const A = core.A as unknown as Record<string, Float32Array>;
  for (const [name, v] of Object.entries(sc.arrays)) {
    if (!A[name]) throw new Error(`no core array ${name}`);
    A[name].set(v as unknown as Float32Array);
  }
  const c = core.c;
  c.oN = k.oN; c.jN = k.jN; c.jB = k.jB; c.sN = k.sN; c.fN = k.fN; c.kN = k.kN; c.stopN = k.stopN; c.entN = k.entN;
  c.total = total;
  Object.assign(core.s, sc.scalars);
}
