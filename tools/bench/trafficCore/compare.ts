/**
 * Exact comparison of two TrafficSystems (24f8609) and their cities. Arrays are compared on their defined ranges
 * (counts of system A; capacities legitimately differ between the original's growth policy and the cores' arenas),
 * floats as values with NaN == NaN (never by bit pattern), -0 !== +0. Searches: dist / src / next / done on [0, n),
 * hops where reached, order on [0, settled). Scratch that only exists in one implementation (candKey, seeds, heap,
 * nsIdx / nsDist) is not compared.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const same = (x: number, y: number) => Object.is(x, y) || (x !== x && y !== y);

function arr(out: string[], name: string, a: ArrayLike<number> | undefined, b: ArrayLike<number> | undefined, from: number, to: number): void {
  if (out.length >= 24) return;
  if (!a || !b) { if (a !== b) out.push(`${name}: missing`); return; }
  // common range: right after a graph rebuild the original's per-node arrays still have the old graph's length (the
  // next prep grows them), while a core may already have the capacity
  const n = Math.min(to, a.length, b.length);
  for (let i = from; i < n; i++) if (!same(a[i], b[i])) { out.push(`${name}[${i}]: ${a[i]} vs ${b[i]}`); return; }
}

function search(out: string[], name: string, a: Any, b: Any): void {
  if (a.n !== b.n || a.settled !== b.settled || a.graphVersion !== b.graphVersion) {
    out.push(`${name}: n ${a.n}/${b.n} settled ${a.settled}/${b.settled} version ${a.graphVersion}/${b.graphVersion}`);
    return;
  }
  arr(out, `${name}.dist`, a.dist, b.dist, 0, a.n);
  arr(out, `${name}.src`, a.src, b.src, 0, a.n);
  arr(out, `${name}.next`, a.next, b.next, 0, a.n);
  arr(out, `${name}.done`, a.done, b.done, 0, a.n);
  arr(out, `${name}.order`, a.order, b.order, 0, a.settled);
  for (let v = 0; v < a.n && out.length < 24; v++) if (a.dist[v] < Infinity && a.hops[v] !== b.hops[v]) { out.push(`${name}.hops[${v}]`); break; }
}

function routes(out: string[], name: string, a: Any[], b: Any[]): void {
  if (a.length !== b.length) { out.push(`${name}: ${a.length} vs ${b.length} routes`); return; }
  for (let i = 0; i < a.length && out.length < 24; i++) {
    if (a[i].kind !== b[i].kind || !same(a[i].weight, b[i].weight)) { out.push(`${name}[${i}]: ${a[i].kind}/${a[i].weight} vs ${b[i].kind}/${b[i].weight}`); return; }
    arr(out, `${name}[${i}].cells`, a[i].cells, b[i].cells, 0, Math.max(a[i].cells.length, b[i].cells.length));
  }
}

const SCALARS = [
  'oN', 'jN', 'jB', 'sN', 'fN', 'kN', 'qN', 'entN', 'binN', 'round', 'propFactor', 'roundAccepted', 'tripsCar', 'tripsTransit', 'tripsWalk',
  'tripsInbound', 'tripsShop', 'tripsFreight', 'commuteSum', 'commuteW', 'iter', 'cycles', 'growth', 'regionWorkerCap', 'sfVersion', 'sfRecompute',
  'rngState', 'phase', 'graphDirty',
];

/** differences between two traffic systems (empty = identical) */
export function diffTraffic(a: Any, b: Any): string[] {
  const out: string[] = [];
  for (const k of SCALARS) if (!same(Number(a[k]), Number(b[k]))) out.push(`${k}: ${a[k]} vs ${b[k]}`);
  const n = a.road.n, total = n + a.rail.n + a.subway.n;
  const { oN, jN, qN, sN, fN, kN, entN } = a;
  const sn = a.stops.n;
  for (const k of ['nodeTime', 'volNew', 'acc', 'volInbound', 'volShop', 'volFreight', 'nodeQ']) arr(out, k, a[k], b[k], 0, n);
  arr(out, 'busTimeA', a.busTimeA, b.busTimeA, 0, a.tnet ? n : 0);
  for (const k of ['tAcc', 'nodeStop']) arr(out, k, a[k], b[k], 0, total);
  arr(out, 'trStartA', a.trStartA, b.trStartA, 0, a.tnet ? total + 1 : 0);
  arr(out, 'railNew', a.railNew, b.railNew, 0, a.rail.n);
  arr(out, 'subNew', a.subNew, b.subNew, 0, a.subway.n);
  const O = ['oBid', 'oW', 'oPop', 'oWealth', 'oEntS', 'oEntC', 'oCell', 'oHalf', 'oCarNode', 'oBoard', 'oShC', 'oShT', 'oShW', 'oTime', 'oEmp', 'oJobT',
    'oU', 'oAsg', 'oTimeSum', 'oCarW', 'oTrW', 'oWalkW', 'oTrT', 'oBoardStop', 'oLastD', 'candNode'];
  for (const k of O) arr(out, k, a[k], b[k], 0, oN);
  const J = ['jBid', 'jSlots', 'jNoise', 'jAsg', 'jCapP', 'jPrice', 'jQ', 'jBase', 'jEntS', 'jEntC', 'jCell', 'jHalf', 'jRailNode', 'jConnType', 'jTimeSum', 'jInbound'];
  for (const k of J) arr(out, k, a[k], b[k], 0, jN);
  for (const k of ['qNode', 'qSlots', 'qCapP', 'qAsg', 'qPrice', 'qProp', 'qBase', 'qNoise', 'qTimeSum']) arr(out, k, a[k], b[k], 0, qN);
  for (const k of ['sBid', 'sEntS', 'sEntC', 'sLoad']) arr(out, k, a[k], b[k], 0, sN);
  for (const k of ['fBid', 'fTrucks', 'fEntS', 'fEntC']) arr(out, k, a[k], b[k], 0, fN);
  for (const k of ['kEntS', 'kEntC', 'kLabel']) arr(out, k, a[k], b[k], 0, kN);
  arr(out, 'ent', a.ent, b.ent, 0, entN);
  for (const k of ['stAttC', 'stWait', 'stLoad', 'stopBins']) arr(out, k, a[k], b[k], 0, sn);
  arr(out, 'stAttS', a.stAttS, b.stAttS, 0, sn + 1);
  arr(out, 'stAtt', a.stAtt, b.stAtt, 0, a.stAttS[sn] ?? 0);
  arr(out, 'stopBinStart', a.stopBinStart, b.stopBinStart, 0, a.binN * a.binN + 1);
  if (a.tnet && b.tnet) {
    const nTr = a.tnet.trStart[a.tnet.total];
    arr(out, 'tnet.trTo', a.tnet.trTo, b.tnet.trTo, 0, nTr);
    arr(out, 'tnet.trCost', a.tnet.trCost, b.tnet.trCost, 0, nTr);
    if (a.tnet.total !== b.tnet.total || a.tnet.nR !== b.tnet.nR) out.push('tnet sizes');
  } else if (!!a.tnet !== !!b.tnet) out.push('tnet presence');
  if (a.subwayRiders.length > 0 || b.subwayRiders.length > 0) arr(out, 'subwayRiders', a.subwayRiders, b.subwayRiders, 0, Math.max(a.subwayRiders.length, b.subwayRiders.length));
  search(out, 'SA', a.SA, b.SA);
  search(out, 'ST', a.ST, b.ST);
  search(out, 'SB', a.SB, b.SB);
  for (const k of ['priceById', 'connPrice', 'accessById', 'jobFillById', 'freightById', 'customersById', 'commuteById', 'reachedById', 'inboundById', 'modeById']) {
    if (a[k].length !== b[k].length) out.push(`${k}: length ${a[k].length} vs ${b[k].length}`);
    else arr(out, k, a[k], b[k], 0, a[k].length);
  }
  if (a.stLoadPrev.size !== b.stLoadPrev.size) out.push(`stLoadPrev size ${a.stLoadPrev.size} vs ${b.stLoadPrev.size}`);
  else for (const [k, v] of a.stLoadPrev) if (!same(v, b.stLoadPrev.get(k))) { out.push(`stLoadPrev<${k}>`); break; }
  routes(out, 'routes', a.routes, b.routes);
  routes(out, 'pendingRoutes', a.pendingRoutes, b.pendingRoutes);
  routes(out, 'truckRoutes', a.truckRoutes, b.truckRoutes);
  if (a.patrolIds.join() !== b.patrolIds.join() || a.stationIds.join() !== b.stationIds.join()) out.push('patrol / station ids');
  return out;
}

/** differences between two cities' traffic outputs (layers, stats, building flags) */
export function diffCity(a: Any, b: Any): string[] {
  const out: string[] = [];
  for (const k of ['traffic', 'congestion', 'commute']) arr(out, `state.${k}`, a[k], b[k], 0, a[k].length);
  for (const k of ['tripsCar', 'tripsTransit', 'tripsWalk', 'avgCommute', 'avgTraffic', 'population']) if (!same(a.stats[k], b.stats[k])) out.push(`stats.${k}: ${a.stats[k]} vs ${b.stats[k]}`);
  if (a.buildings.size !== b.buildings.size) out.push('buildings size');
  else for (const [id, x] of a.buildings) { const y = b.buildings.get(id); if (!y || x.flags !== y.flags) { out.push(`building ${id} flags`); break; } }
  return out;
}

// ------------------------------------------------------------------------------------------------ digests
/** FNV-1a over the bytes of a[from, to) (typed arrays; floats by bit pattern after canonicalising NaN) */
function fnv(h: number, a: ArrayLike<number> & { BYTES_PER_ELEMENT?: number }, from: number, to: number): number {
  const n = Math.min(to, a.length);
  const f = new Float64Array(1), b = new Uint8Array(f.buffer);
  for (let i = from; i < n; i++) {
    let v = a[i];
    if (v !== v) v = NaN;
    f[0] = v;
    for (let k = 0; k < 8; k++) { h ^= b[k]; h = Math.imul(h, 16777619) >>> 0; }
  }
  return h;
}

/**
 * per-field digests of everything diffTraffic compares (same defined ranges) + the city's traffic outputs: two arms
 * in different isolates are identical iff every digest matches
 */
export function digestTraffic(a: Any, st: Any): Record<string, number> {
  const d: Record<string, number> = {};
  const h = (name: string, arrA: ArrayLike<number> | undefined, from: number, to: number) => { d[name] = arrA ? fnv(2166136261, arrA, from, to) : -1; };
  for (const k of SCALARS) d[k] = fnv(2166136261, [Number(a[k])], 0, 1);
  const n = a.road.n, total = n + a.rail.n + a.subway.n;
  for (const k of ['nodeTime', 'volNew', 'acc', 'volInbound', 'volShop', 'volFreight', 'nodeQ']) h(k, a[k], 0, n);
  h('busTimeA', a.busTimeA, 0, a.tnet ? n : 0);
  for (const k of ['tAcc', 'nodeStop']) h(k, a[k], 0, total);
  h('trStartA', a.trStartA, 0, a.tnet ? total + 1 : 0);
  h('railNew', a.railNew, 0, a.rail.n);
  h('subNew', a.subNew, 0, a.subway.n);
  for (const k of ['oBid', 'oW', 'oPop', 'oWealth', 'oEntS', 'oEntC', 'oCell', 'oHalf', 'oCarNode', 'oBoard', 'oShC', 'oShT', 'oShW', 'oTime', 'oEmp', 'oJobT',
    'oU', 'oAsg', 'oTimeSum', 'oCarW', 'oTrW', 'oWalkW', 'oTrT', 'oBoardStop', 'oLastD', 'candNode']) h(k, a[k], 0, a.oN);
  for (const k of ['jBid', 'jSlots', 'jNoise', 'jAsg', 'jCapP', 'jPrice', 'jQ', 'jBase', 'jEntS', 'jEntC', 'jCell', 'jHalf', 'jRailNode', 'jConnType', 'jTimeSum', 'jInbound']) h(k, a[k], 0, a.jN);
  for (const k of ['qNode', 'qSlots', 'qCapP', 'qAsg', 'qPrice', 'qProp', 'qBase', 'qNoise', 'qTimeSum']) h(k, a[k], 0, a.qN);
  for (const k of ['sBid', 'sEntS', 'sEntC', 'sLoad']) h(k, a[k], 0, a.sN);
  for (const k of ['fBid', 'fTrucks', 'fEntS', 'fEntC']) h(k, a[k], 0, a.fN);
  for (const k of ['kEntS', 'kEntC', 'kLabel']) h(k, a[k], 0, a.kN);
  h('ent', a.ent, 0, a.entN);
  const sn = a.stops.n;
  for (const k of ['stAttC', 'stWait', 'stLoad', 'stopBins']) h(k, a[k], 0, sn);
  h('stAttS', a.stAttS, 0, sn + 1);
  h('stAtt', a.stAtt, 0, a.stAttS[sn] ?? 0);
  h('stopBinStart', a.stopBinStart, 0, a.binN * a.binN + 1);
  if (a.tnet) { const nTr = a.tnet.trStart[a.tnet.total]; h('tnet.trTo', a.tnet.trTo, 0, nTr); h('tnet.trCost', a.tnet.trCost, 0, nTr); }
  h('subwayRiders', a.subwayRiders, 0, a.subwayRiders.length);
  for (const S of ['SA', 'ST', 'SB']) {
    const s = a[S];
    d[S + '.meta'] = fnv(2166136261, [s.n, s.settled, s.graphVersion], 0, 3);
    for (const k of ['dist', 'src', 'next', 'done']) h(`${S}.${k}`, s[k], 0, s.n);
    h(`${S}.order`, s.order, 0, s.settled);
    const hops: number[] = [];
    for (let v = 0; v < s.n; v++) if (s.dist[v] < Infinity) hops.push(s.hops[v]);
    h(`${S}.hops`, hops, 0, hops.length);
  }
  for (const k of ['priceById', 'connPrice', 'accessById', 'jobFillById', 'freightById', 'customersById', 'commuteById', 'reachedById', 'inboundById', 'modeById']) h(k, a[k], 0, a[k].length);
  d.stLoadPrev = fnv(2166136261, [...a.stLoadPrev.entries()].flat() as number[], 0, a.stLoadPrev.size * 2);
  for (const r of ['routes', 'pendingRoutes', 'truckRoutes']) d[r] = fnv(2166136261, (a[r] as Any[]).flatMap((x) => [x.kind.length, x.weight, ...Array.from(x.cells as Uint32Array)]), 0, Infinity);
  for (const k of ['traffic', 'congestion', 'commute']) h(`state.${k}`, st[k], 0, st[k].length);
  d['state.stats'] = fnv(2166136261, ['tripsCar', 'tripsTransit', 'tripsWalk', 'avgCommute', 'avgTraffic', 'population'].map((k) => st.stats[k]), 0, 6);
  const flags: number[] = [];
  for (const [id, b] of st.buildings) flags.push(id, b.flags);
  d['state.flags'] = fnv(2166136261, flags, 0, flags.length);
  return d;
}

/** fields whose digests differ */
export function diffDigests(a: Record<string, number>, b: Record<string, number>): string[] {
  return Object.keys(a).filter((k) => a[k] !== b[k]);
}
