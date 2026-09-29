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
  const n = Math.min(to, a.length, b.length);
  if (to > a.length || to > b.length) {
    // the defined range must exist in both (a shorter array means the other implementation lost data)
    if (Math.min(a.length, b.length) < to && to - from > 0 && (a.length >= to) !== (b.length >= to)) { out.push(`${name}: length ${a.length} vs ${b.length} (need ${to})`); return; }
  }
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
