/**
 * Transit stops discovery (bus stops, subway / train stations, ferry terminals) and the walking-coverage layer
 * (state.transitCov). Bus stops are tr_bus_stop buildings placed next to roads, or (legacy, no tool creates them) road
 * cells with the netFlags "has bus stop" bit (bit 4): those keep the plain WAIT_BUS service, are not part of the bus
 * fleet model (WP7-5) and get no inspector report.
 *
 * WP7-6 / critic item 17 — coverage means service: a stop only gives transit coverage while traffic reports it attached
 * (TrafficSystem.stopAttached): a bus stop next to a road, a subway / train station whose line holds another station of
 * its mode (a train station may reach the map edge instead), a ferry terminal linked to a partner. Depots and parking
 * garages carry no generic coverage (their effects are the bus fleet and parking / park & ride).
 */
import type { Building, CityState } from '../CityState';
import type { Simulation } from '../Simulation';
import { Transit, centerCell, infoOf, isFunctional, buildingList, type DefInfo } from './common';
import { FERRY_COV_RADIUS, TRANSIT_COV_RADIUS } from './params';

export const NETFLAG_BUS_STOP = 1 << 4;

/** the traffic system of each city state (set in TrafficSystem.init; read by the WP7b hooks that only get the state) */
export const TRAFFIC_OF_STATE = new WeakMap<CityState, object>();

export interface StopList {
  n: number;
  /** building id (or -1 for a road-cell bus stop) */
  bid: Int32Array;
  mode: Uint8Array;
  /** centre cell */
  cell: Int32Array;
}

/** transit roles that are stops (riders board there) */
export function isStopMode(t: Transit): boolean {
  return t === Transit.Bus || t === Transit.Subway || t === Transit.Train || t === Transit.Ferry;
}

/** defs whose catalog coverage (if a mod / old def still declares one) is not a walking coverage (WP7-13, F2) */
const NO_GENERIC_COVERAGE = new Set(['civ_bus_depot', 'tr_parking_garage']);

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
    if (!isStopMode(inf.transit)) continue;
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

interface AttachApi { stopAttached?: (id: number) => boolean }

/** traffic's attachment verdict for a stop building (true while traffic is not installed: legacy behaviour) */
export function stopServes(sim: Simulation | null | undefined, id: number): boolean {
  const tr = sim?.getSystem('traffic') as unknown as AttachApi | undefined;
  return typeof tr?.stopAttached === 'function' ? tr.stopAttached(id) : true;
}

/**
 * services' SLOT_TRANSIT branch: does this building's catalog transit coverage apply? No for depots / garages (no
 * generic coverage) and for stops traffic reports unattached (off-road bus stop, lone station, unlinked ferry).
 */
export function transitCoverageActive(sim: Simulation, b: Building, inf: DefInfo = infoOf(sim.state, b)): boolean {
  if (NO_GENERIC_COVERAGE.has(b.def)) return false;
  if (!isStopMode(inf.transit)) return true;
  return stopServes(sim, b.id);
}

/**
 * transit walking coverage (0..1) from stops into `out` (cleared first). Stops whose building def carries its own
 * coverage (catalog tr_bus_stop / tr_subway_station / tr_train_station / tr_ferry_terminal) are skipped when
 * `skipWithCoverage` — the services system already splats their def.coverage. `active(s)` (stop index) = false skips
 * a stop that does not serve (unattached, WP7-6).
 */
export function computeTransitCoverage(state: CityState, stops: StopList, out: Float32Array, funding: number, skipWithCoverage = true,
  active?: (s: number) => boolean): void {
  out.fill(0);
  const N = state.size;
  for (let s = 0; s < stops.n; s++) {
    if (skipWithCoverage && stops.bid[s] >= 0) {
      const b = state.buildings.get(stops.bid[s]);
      if (b && infoOf(state, b).cov >= 0) continue;
    }
    if (active && !active(s)) continue;
    const mode = stops.mode[s];
    const R = mode === Transit.Bus ? TRANSIT_COV_RADIUS.bus : mode === Transit.Subway ? TRANSIT_COV_RADIUS.subway
      : mode === Transit.Ferry ? FERRY_COV_RADIUS : TRANSIT_COV_RADIUS.train;
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
