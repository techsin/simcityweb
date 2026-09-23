/**
 * Transit stops discovery (bus stops, subway stations, train stations) and the walking-coverage layer
 * (state.transitCov). Bus stops are either tr_bus_stop buildings placed next to roads or road cells with the
 * netFlags "has bus stop" bit (bit 4).
 */
import type { CityState } from '../CityState';
import { Transit, centerCell, infoOf, isFunctional, buildingList } from './common';
import { TRANSIT_COV_RADIUS } from './params';

export const NETFLAG_BUS_STOP = 1 << 4;

export interface StopList {
  n: number;
  /** building id (or -1 for a road-cell bus stop) */
  bid: Int32Array;
  mode: Uint8Array;
  /** centre cell */
  cell: Int32Array;
}

export function collectStops(state: CityState, out?: StopList): StopList {
  let n = 0;
  const res: StopList = out ?? { n: 0, bid: new Int32Array(64), mode: new Uint8Array(64), cell: new Int32Array(64) };
  const push = (bid: number, mode: number, cell: number) => {
    if (n >= res.bid.length) {
      const cap = res.bid.length * 2;
      const b = new Int32Array(cap); b.set(res.bid); res.bid = b;
      const m = new Uint8Array(cap); m.set(res.mode); res.mode = m;
      const c = new Int32Array(cap); c.set(res.cell); res.cell = c;
    }
    res.bid[n] = bid;
    res.mode[n] = mode;
    res.cell[n] = cell;
    n++;
  };
  for (let bI = 0, bL = buildingList(state); bI < bL.length; bI++) {
      const b = bL[bI];
    const inf = infoOf(state, b);
    if (inf.transit !== Transit.Bus && inf.transit !== Transit.Subway && inf.transit !== Transit.Train) continue;
    if (!isFunctional(b)) continue;
    push(b.id, inf.transit, centerCell(state, b));
  }
  const flags = state.netFlags;
  const net = state.network;
  for (let i = 0; i < state.cells; i++) {
    if ((flags[i] & NETFLAG_BUS_STOP) !== 0 && net[i] >= 1 && net[i] <= 5) push(-1, Transit.Bus, i);
  }
  res.n = n;
  return res;
}

/**
 * transit walking coverage (0..1) from stops into `out` (cleared first). Stops whose building def carries its own
 * coverage (catalog tr_bus_stop / tr_subway_station / tr_train_station) are skipped when `skipWithCoverage` —
 * the services system already splats their def.coverage.
 */
export function computeTransitCoverage(state: CityState, stops: StopList, out: Float32Array, funding: number, skipWithCoverage = true): void {
  out.fill(0);
  const N = state.size;
  for (let s = 0; s < stops.n; s++) {
    if (skipWithCoverage && stops.bid[s] >= 0) {
      const b = state.buildings.get(stops.bid[s]);
      if (b && infoOf(state, b).cov >= 0) continue;
    }
    const mode = stops.mode[s];
    const R = mode === Transit.Bus ? TRANSIT_COV_RADIUS.bus : mode === Transit.Subway ? TRANSIT_COV_RADIUS.subway : TRANSIT_COV_RADIUS.train;
    const c = stops.cell[s];
    const cx = c % N, cz = (c - cx) / N;
    const R2 = (R + 0.5) * (R + 0.5);
    const strength = (mode === Transit.Bus ? 0.75 : 1) * funding;
    for (let z = Math.max(0, cz - R); z <= Math.min(N - 1, cz + R); z++) {
      const dz = z - cz;
      for (let x = Math.max(0, cx - R); x <= Math.min(N - 1, cx + R); x++) {
        const dx = x - cx;
        const d2 = dx * dx + dz * dz;
        if (d2 > R2) continue;
        const d = Math.sqrt(d2) / (R + 0.5);
        const v = strength * (1 - d * d * 0.7);
        const i = z * N + x;
        const cur = out[i];
        out[i] = cur + v * (1 - cur);
      }
    }
  }
}
