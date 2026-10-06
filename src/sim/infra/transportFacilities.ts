/**
 * Transport-facility hook (docs/SIM_DEPTH_PART_B.md §4, owner WP7b). Headless: no DOM / three.js.
 *
 * WP7a's facilityReport (facilities.ts) calls transportFacilityReport(sim, b) for every building and merges the part it
 * returns (lines and warnings appended, role used for the transit defs), so WP7a and WP7b never edit the same hunk.
 * Covered defs: tr_bus_stop, civ_bus_depot, tr_subway_station, tr_train_station, tr_freight_station, tr_parking_garage,
 * tr_ferry_terminal (airport / seaport "use" lines are WP7a's; the seaport's throughput comes from freightSinkTrucks).
 *
 * Also the read-only views WP5 renders (critic items 22 / 23): roadCellReport (interchange load, trucks, bus riders on
 * a road cell), stopsNear (garage preview; ride = false marks a downtown stop — a garage there is parking, not park &
 * ride), ferryPartnersFor (ferry preview), ferryLinks (render team: ferry boats), truckVolumeOf (Traffic overlay
 * "Trucks"), transportUseFactor (WP7a's facilityUseFactor: 0 = not connected), and TRANSPORT_EFFECT_METRICS (facilities
 * matrix test). Road-flag bus stops (netFlags bit 4) are legacy: no report.
 * Report rules (r1): a closed (burnt / abandoned) facility says so first; riders are rides (walkers who would board and
 * alight at the same stop are counted apart, with a hint); a long bus wait blames the fleet only when its pool is short
 * (rho < 1), else the stop's crowding; crowded stops / stations / terminals name the fix; a garage names its real state
 * (no road, no stop, a stop without transit, a downtown stop, park & ride with cars / riders / demand of the last
 * assignment — the numbers stats.transitFleet sums).
 * Every function accepts a sim without the traffic system (infra-less tests) and returns the documented stub value.
 */
import type { Building, CityState } from '../CityState';
import type { Simulation } from '../Simulation';
import { BF } from '../CityState';
import { Network } from '../../core/types';
import { getDef } from '../catalog';
import type { FacilityLine } from './facilities';
import { Fam, Transit, centerCell, infoOf, isFunctional } from './common';
import { TRAFFIC_OF_STATE } from './transit';
import type { TrafficSystem } from './traffic';
import {
  BUS_RHO_MAX, CAR_OCCUPANCY, DEPOT_BUSES, DEPOT_RANGE, FERRY_MAX_CELLS, FERRY_PARTNERS, FREIGHT_SINK_MIN, GARAGE_SPACES,
  GARAGE_WALK_RADIUS, MINIBUS_FLEET, PR_CAR_LEG_MAX, PR_STOP_RADIUS, RAMP_BY_NET, RIDERS_PER_BUS, STOP_CAP_BUS, STOP_CAP_FERRY,
  STOP_CAP_SUBWAY, STOP_CAP_TRAIN, STOP_WALK_RADIUS, WAIT_BUS, WAIT_FERRY, WAIT_SUBWAY, WAIT_TRAIN,
} from './params';

export interface TransportFacilityPart {
  /** one-line role when the transport part defines it ("Bus depot: runs the buses of stops within 90 road tiles") */
  role?: string;
  lines: FacilityLine[];
  warnings: string[];
}

/** the 7 transit defs of WP7b (by def id; a mod def with one of these models counts too) */
const TRANSPORT_DEFS = ['tr_bus_stop', 'civ_bus_depot', 'tr_subway_station', 'tr_train_station', 'tr_freight_station', 'tr_parking_garage', 'tr_ferry_terminal'] as const;
type TransportDef = (typeof TRANSPORT_DEFS)[number];
function kindOf(defId: string): TransportDef | null {
  if ((TRANSPORT_DEFS as readonly string[]).includes(defId)) return defId as TransportDef;
  const m = getDef(defId)?.model;
  return m && (TRANSPORT_DEFS as readonly string[]).includes(m) ? (m as TransportDef) : null;
}

function trafficOf(sim: Simulation | null | undefined): TrafficSystem | undefined {
  return (sim?.getSystem('traffic') as unknown as TrafficSystem | undefined) ?? undefined;
}
function trafficOfSt(st: CityState): TrafficSystem | undefined {
  return TRAFFIC_OF_STATE.get(st) as TrafficSystem | undefined;
}

/** integer with thousands separators (locale independent) */
function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const n = Math.round(v);
  const s = Math.abs(n).toString();
  let out = '';
  for (let k = 0; k < s.length; k++) {
    if (k > 0 && (s.length - k) % 3 === 0) out += ',';
    out += s[k];
  }
  return n < 0 ? '-' + out : out;
}
const min1 = (v: number) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : '—');
const pct = (v: number) => `${Math.round(v * 100)}%`;
function dist(st: CityState, a: Building, b: Building): number {
  const ca = centerCell(st, a), cb = centerCell(st, b), N = st.size;
  return Math.round(Math.hypot((ca % N) - (cb % N), Math.floor(ca / N) - Math.floor(cb / N)));
}
function nameOf(st: CityState, id: number): string {
  const b = st.buildings.get(id);
  return (b && getDef(b.def)?.name) || 'building';
}
function crowdStatus(riders: number, cap: number): 'ok' | 'warn' | 'bad' {
  return riders > 1.5 * cap ? 'bad' : riders > cap ? 'warn' : 'ok';
}

/** "1 business" / "2 businesses" */
function plural(n: number, one: string, many: string): string {
  return `${fmt(n)} ${Math.round(n) === 1 ? one : many}`;
}
/** compass direction (north = -z, east = +x) from building a to building b */
function compass(st: CityState, a: Building, b: Building): string {
  const ca = centerCell(st, a), cb = centerCell(st, b), N = st.size;
  const dx = (cb % N) - (ca % N), dz = Math.floor(cb / N) - Math.floor(ca / N);
  if (dx === 0 && dz === 0) return '';
  const deg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
}
/**
 * hint for a stop / station / terminal without riders: its nearby residents walk to jobs beside it, or no job is
 * reachable by transit from it at all (reach = false: nothing to ride to)
 */
function walkersHint(walkers: number, kind: 'stop' | 'station' | 'terminal', reach?: boolean): string | undefined {
  if (!(walkers >= 1)) {
    if (reach !== false) return undefined;
    return kind === 'stop' ? 'No jobs reachable by bus from here — buses run between stops: put a stop near the jobs too'
      : kind === 'station' ? 'No jobs within walking distance of any station on its line — add a station near the jobs'
        : 'No jobs within walking distance of the other terminals — add stops or jobs near them';
  }
  return kind === 'stop'
    ? `${plural(walkers, 'worker', 'workers')} nearby walk to jobs beside this stop — riders come from stops near homes farther away`
    : kind === 'station'
      ? `${plural(walkers, 'worker', 'workers')} nearby walk to jobs beside this station — riders come from stations near homes farther along the line`
      : `${plural(walkers, 'worker', 'workers')} nearby walk to jobs beside this terminal — riders come from across the water`;
}

/**
 * why a depot runs fewer buses than it could: transit funding below 75 % (budget) or no power; null = neither (the
 * stops' report names it instead of a generic "not enough buses")
 */
function depotCause(st: CityState, depot: Building, d: { fleet: number } | null): { kind: 'funding' | 'power'; short: string; text: string } | null {
  const f = st.budget?.funding?.transit;
  const fund = typeof f === 'number' && Number.isFinite(f) ? f : 100;
  const fleet = d ? d.fleet : DEPOT_BUSES;
  const name = nameOf(st, depot.id);
  if (fund < 75) {
    return { kind: 'funding', short: `runs ${plural(fleet, 'bus', 'buses')} (transit funding ${Math.round(fund)} %)`,
      text: `${name} runs ${plural(fleet, 'bus', 'buses')} — transit funding is ${Math.round(fund)} %: raise it in the budget` };
  }
  if (infoOf(st, depot).usesPower && (depot.flags & BF.Powered) === 0) {
    return { kind: 'power', short: `no power (${plural(fleet, 'bus', 'buses')} run)`, text: `${name} has no power: half its buses stay in the garage` };
  }
  return null;
}

/**
 * why a park & ride garage carries nobody: no stop is involved — it is nobody's option (no homes within the drive, or
 * the homes there have faster garages), or transit from its stop is slower than driving
 */
function idleGarageHint(sim: Simulation, tr: TrafficSystem, b: Building, catchment: number, stopName: string): string {
  const st = sim.state;
  if (catchment >= 1) return `Nobody switches: transit from ${stopName} is slower than driving — link it to a subway / train line or a better-served stop`;
  const reach = tr.garageReach(b.id);
  if (reach && reach.workers < 1) return `No homes within a ${PR_CAR_LEG_MAX}-minute drive — build garages where commuters live`;
  const via = reach && reach.via >= 0 ? st.buildings.get(reach.via) : undefined;
  if (via) return `Commuters within a ${PR_CAR_LEG_MAX}-minute drive use the ${nameOf(st, via.id)} ${dist(st, b, via)} tiles ${compass(st, b, via)} — it gets them to their jobs faster`;
  return reach ? 'Commuters within reach have faster park & ride options' : 'Not picked yet — next traffic update';
}

/** transport part of a facility's inspector report; null = not a transport facility */
export function transportFacilityReport(sim: Simulation, b: Building): TransportFacilityPart | null {
  const kind = kindOf(b.def);
  if (!kind) return null;
  const st = sim.state;
  const tr = trafficOf(sim);
  const lines: FacilityLine[] = [];
  const warnings: string[] = [];
  const functional = isFunctional(b);
  const part = (role: string): TransportFacilityPart => ({ role, lines, warnings });
  if (!tr) {
    lines.push({ key: 'status', label: 'Status', value: functional ? 'no traffic data' : 'closed' });
    return part(ROLE[kind]);
  }
  // a burnt / abandoned facility runs nothing: say that, not a missing road or tunnel
  if (!functional) {
    lines.push({ key: 'status', label: 'Status', value: 'closed', status: 'bad', hint: 'Burnt or abandoned — rebuild it (bulldoze and place it again)' });
    warnings.push('Closed (not running)');
    return part(ROLE[kind]);
  }
  const load = tr.stopLoad(b.id);
  const riders = load?.riders ?? 0;
  const walkers = load?.walkers ?? 0;
  const reach = load?.reach;
  switch (kind) {
    case 'tr_bus_stop': {
      if (!tr.stopAttached(b.id)) {
        warnings.push('Not next to a road — buses can\'t stop here');
        lines.push({ key: 'riders', label: 'Riders', value: '0/day', status: 'bad', hint: 'Move it next to a road' });
        break;
      }
      lines.push({ key: 'riders', label: 'Riders', value: `${fmt(riders)}/day`, ratio: riders / STOP_CAP_BUS, status: crowdStatus(riders, STOP_CAP_BUS),
        hint: riders > STOP_CAP_BUS ? 'Crowded — add stops nearby or a second route' : riders < 1 ? walkersHint(walkers, 'stop', reach) : undefined });
      const wait = load?.waitMin ?? WAIT_BUS;
      const depotId = load?.depotId ?? -1;
      const depot = depotId >= 0 ? st.buildings.get(depotId) : undefined;
      // why its depot runs few buses (transit funding, no power) — named on the depot line and in the wait hint
      const cause = depot ? depotCause(st, depot, tr.depotInfo(depotId)) : null;
      // a long wait: too few buses in the stop's pool (rho < 1), else its own crowding
      const short = (load?.rho ?? BUS_RHO_MAX) < 1;
      lines.push({ key: 'wait', label: 'Wait', value: `${min1(wait)} min`, status: wait > 1.7 * WAIT_BUS ? 'bad' : wait > 1.25 * WAIT_BUS ? 'warn' : 'ok',
        hint: wait > 1.25 * WAIT_BUS
          ? (!short ? 'Crowded stop — add another stop nearby'
            : cause ? `Not enough buses — ${cause.text}`
              : depot ? `Not enough buses — its ${nameOf(st, depotId)} runs too few for all its stops: build another depot nearby or raise transit funding`
                : 'Not enough buses — build a Bus Depot nearby or raise transit funding')
          : undefined });
      if (depot) {
        lines.push({ key: 'depot', label: 'Buses from', value: `${nameOf(st, depotId)} · ${dist(st, b, depot)} tiles away${cause ? ` — ${cause.short}` : ''}`,
          status: cause ? 'bad' : undefined, hint: cause?.text });
      } else {
        const mb = tr.minibusInfo;
        lines.push({ key: 'depot', label: 'Buses from', value: `Minibus service only (${MINIBUS_FLEET} buses)`, status: mb.rho < 1 ? 'warn' : 'ok',
          hint: `A Bus Depot within ${DEPOT_RANGE} road tiles runs ${DEPOT_BUSES} buses` });
      }
      break;
    }
    case 'civ_bus_depot': {
      const d = tr.depotInfo(b.id);
      if (!d) { lines.push({ key: 'buses', label: 'Buses', value: 'starting — next traffic update' }); break; }
      // (whole buses: any riders keep at least one bus running)
      const inService = Math.min(d.fleet, d.riders > 0 ? Math.max(1, Math.ceil(d.need)) : 0);
      lines.push({ key: 'buses', label: 'Buses in service', value: `${fmt(inService)} / ${fmt(d.fleet)}`, ratio: d.fleet > 0 ? d.need / d.fleet : 0,
        status: d.need > 1.1 * d.fleet ? 'bad' : d.need > d.fleet ? 'warn' : 'ok' });
      lines.push({ key: 'stops', label: 'Stops served', value: `${fmt(d.stops)} within ${DEPOT_RANGE} road tiles` });
      lines.push({ key: 'riders', label: 'Riders', value: `${fmt(d.riders)}/day` });
      if (d.stops === 0) warnings.push(`No bus stops within ${DEPOT_RANGE} road tiles — place stops next to roads nearby`);
      const cause = depotCause(st, b, d);
      if (cause && cause.kind === 'funding') warnings.push(cause.text.charAt(0).toUpperCase() + cause.text.slice(1));
      else if (d.need > 1.1 * d.fleet) warnings.push(`Its stops need ${fmt(d.need)} buses — build another depot or raise transit funding`);
      if (infoOf(st, b).usesPower && (b.flags & BF.Powered) === 0) warnings.push('No power: half the buses stay in the garage');
      break;
    }
    case 'tr_subway_station':
    case 'tr_train_station': {
      const sub = kind === 'tr_subway_station';
      const line = tr.stationLine(b.id);
      if (!tr.stopAttached(b.id)) {
        warnings.push(sub ? 'Not connected — tunnel it to another subway station' : 'Not connected — its tracks must reach another train station or the map edge');
        lines.push({ key: 'riders', label: 'Riders', value: '0/day', status: 'bad', hint: sub ? 'Build a subway tunnel to a second station' : 'Extend the rail line' });
        break;
      }
      const cap = sub ? STOP_CAP_SUBWAY : STOP_CAP_TRAIN;
      lines.push({ key: 'riders', label: 'Riders', value: `${fmt(riders)}/day`, ratio: riders / cap, status: crowdStatus(riders, cap),
        hint: riders > cap ? 'Crowded — add a parallel line or another station within walking distance' : riders < 1 ? walkersHint(walkers, 'station', reach) : undefined });
      lines.push({ key: 'wait', label: 'Wait', value: `${min1(load?.waitMin ?? (sub ? WAIT_SUBWAY : WAIT_TRAIN))} min` });
      if (line) lines.push({ key: 'line', label: 'Line', value: `${fmt(line.stations)} station${line.stations === 1 ? '' : 's'}${line.edge ? ' · to the region' : ''}` });
      break;
    }
    case 'tr_freight_station': {
      if (!tr.freightLinked(b.id)) {
        warnings.push('No rail link to the region — connect its tracks to the map edge or a seaport');
        lines.push({ key: 'rail', label: 'Rail link', value: 'none', status: 'bad', hint: 'Extend the tracks to the map edge' });
        break;
      }
      lines.push({ key: 'rail', label: 'Rail link', value: 'to the region', status: 'ok' });
      if (!roadNext(st, b)) warnings.push('No road access — trucks can\'t reach it; build a road beside it');
      const t = tr.sinkTrucks(b.id);
      lines.push({ key: 'trucks', label: 'Freight', value: t >= 0 ? `${fmt(t)} trucks/day within ${FREIGHT_SINK_MIN} min` : 'counting — next freight update' });
      break;
    }
    case 'tr_parking_garage': {
      const g = tr.garageInfo(b.id);
      const spaces = g?.spaces ?? GARAGE_SPACES;
      const businesses = businessesNear(st, b, GARAGE_WALK_RADIUS);
      const road = roadNext(st, b);
      const stopName = g && g.stopId >= 0 ? nameOf(st, g.stopId) : 'its stop';
      const parkingOnly = 'Parking for the businesses around it; for park & ride, build garages by stops in residential areas';
      // no stop in reach: parking only — a neutral note where it serves businesses, a warning where it serves nobody
      const noStop = () => {
        if (businesses > 0) {
          lines.push({ key: 'parkRide', label: 'Park & ride', value: `none — no transit stop within ${PR_STOP_RADIUS} tiles`,
            hint: `Parking for the businesses around it; park & ride needs a stop within ${PR_STOP_RADIUS} tiles` });
        } else warnings.push(`No transit stop within ${PR_STOP_RADIUS} tiles and no businesses nearby — it serves nobody here`);
      };
      let prCars = 0;
      if (!road) warnings.push('No road access — drivers can\'t reach it; build a road beside it');
      else if (!g || g.state === 'noRoad') {
        // placed since the last traffic update (or its road is newer than the road graph): what the preview promised
        const near = tr.stopsNear(st, b.x, b.z, b.w, b.d);
        const rider = near.find((s) => s.ride !== false);
        if (rider) lines.push({ key: 'parkRide', label: 'Park & ride', value: `next to ${nameOf(st, rider.id)} — starts with the next traffic update` });
        else if (near.length > 0) {
          lines.push({ key: 'parkRide', label: 'Park & ride', value: `none — ${nameOf(st, near[0].id)} is downtown (its riders walk to jobs beside it)`, hint: parkingOnly });
        } else noStop();
      } else if (g.state === 'noStop') noStop();
      else if (g.state === 'noTransit') {
        lines.push({ key: 'parkRide', label: 'Park & ride', value: `none — transit from ${stopName} reaches no jobs yet`, status: 'warn',
          hint: 'Connect the stop to job areas (a bus stop near the jobs, or a line to a second station)' });
      } else if (g.state === 'downtown') {
        // the stop's riders walk to jobs beside it: nobody would ride from here — parking for the blocks around it
        lines.push({ key: 'parkRide', label: 'Park & ride', value: `none — ${stopName} is downtown (its riders walk to jobs beside it)`, hint: parkingOnly });
      } else {
        // park & ride: the spaces the block around it lacks stay with its businesses (local parkers first), the rest is
        // park & ride room
        const reserve = Math.min(spaces, Math.round(g.reserve ?? 0));
        const room = spaces - reserve;
        prCars = Math.min(g.parkRide, room);
        const pooled = g.pooled ?? 0;
        if (room < 1) {
          lines.push({ key: 'parkRide', label: 'Park & ride', value: `none — all ${fmt(spaces)} spaces kept for the businesses around it`,
            hint: 'Their block is short of parking; for park & ride, build garages by stops in residential areas' });
        } else {
          const ridersG = g.riders ?? prCars * CAR_OCCUPANCY;
          const wantedCars = (g.wanted ?? 0) / CAR_OCCUPANCY;
          // full: at its room and commuters turned away (wanted beyond the room)
          const full = prCars >= 0.97 * room && wantedCars > 1.02 * room;
          lines.push({ key: 'parkRide', label: 'Park & ride', value: `${fmt(prCars)} / ${fmt(room)} cars${pooled > 0 ? ` (shared with ${plural(pooled, 'garage', 'garages')} at ${stopName})` : ''}`,
            ratio: prCars / room, status: full ? 'warn' : 'ok',
            hint: !full ? undefined : reserve >= 1
              ? `Full — ${fmt(wantedCars)} cars wanted; this block needs its own parking: for more park & ride, build garages by stops nearer homes`
              : `Full — ${fmt(wantedCars)} cars wanted: build another garage by a stop` });
          lines.push({ key: 'switched', label: 'Commuters switched', value: `${fmt(ridersG)}/day to ${stopName}`, status: ridersG < 1 ? 'warn' : undefined,
            hint: ridersG < 1 ? idleGarageHint(sim, tr, b, g.catchment ?? 0, stopName) : undefined });
        }
        if (reserve >= 1) {
          lines.push({ key: 'kept', label: 'Kept for the block', value: `${plural(reserve, 'space', 'spaces')} — the businesses around it are short of parking`,
            hint: 'Local parkers come first; park & ride gets the rest' });
        }
      }
      // free spaces (minus the park & ride cars) ease the blocks around it — none while no road reaches it
      const free = Math.max(0, spaces - prCars);
      lines.push({ key: 'parking', label: 'Parking relief', value: road
        ? `${plural(free, 'space', 'spaces')} for ${plural(businesses, 'business', 'businesses')} within ${GARAGE_WALK_RADIUS} tiles`
        : 'none — no road access', status: road ? undefined : 'bad' });
      // the pressure on the lots around it, crediting its own relief (the pressure its walk area would have without its
      // free spaces, last parking update)
      const p = parkingNear(st, b, GARAGE_WALK_RADIUS);
      const rl = road ? g?.relief : undefined;
      const credit = rl && businesses > 0 ? Math.max(0, rl.without - rl.with) : 0;
      lines.push({ key: 'pressure', label: 'Parking pressure around it',
        value: `${p < 0.005 ? 'none' : pct(p)}${credit >= 0.05 ? ` (${pct(Math.min(1, p + credit))} without it)` : ''}`, ratio: p,
        status: p > 0.6 ? 'bad' : p > 0.3 ? 'warn' : 'ok',
        hint: businesses > 0 && p < 0.05
          ? (credit >= 0.05 ? 'Its free spaces keep the businesses around it supplied' : 'No parking shortage around it — shortages appear in dense downtowns')
          : p > 0.6 ? 'Still short of parking: add another garage, or transit to these jobs' : undefined });
      break;
    }
    case 'tr_ferry_terminal': {
      const partners = tr.ferryPartners(b.id);
      if (partners.length === 0) {
        warnings.push(`No partner terminal on this water within ${FERRY_MAX_CELLS} tiles — build a second terminal across the water`);
        lines.push({ key: 'routes', label: 'Routes', value: 'none', status: 'bad' });
        break;
      }
      lines.push({ key: 'routes', label: 'Routes', value: partners.map((q) => {
        const o = st.buildings.get(q.id);
        const where = o ? ` ${dist(st, b, o)} tiles ${compass(st, b, o)}`.trimEnd() : '';
        return `${nameOf(st, q.id)}${where} (${Math.max(1, Math.round(q.minutes))} min)`;
      }).join(' · ') });
      const fr = tr.ferryRidersAt(b.id);
      lines.push({ key: 'riders', label: 'Riders', value: `${fmt(fr)}/day`, ratio: fr / STOP_CAP_FERRY, status: crowdStatus(fr, STOP_CAP_FERRY),
        hint: fr > STOP_CAP_FERRY ? 'Crowded — add another terminal pair' : fr < 1 ? walkersHint(walkers, 'terminal', reach) : undefined });
      lines.push({ key: 'wait', label: 'Wait', value: `${min1(load?.waitMin ?? WAIT_FERRY)} min` });
      break;
    }
  }
  return part(ROLE[kind]);
}

const ROLE: Record<TransportDef, string> = {
  tr_bus_stop: `Bus stop: residents within ${STOP_WALK_RADIUS} tiles ride buses from the nearest depot`,
  civ_bus_depot: `Bus depot: runs ${DEPOT_BUSES} buses for the stops within ${DEPOT_RANGE} road tiles`,
  tr_subway_station: 'Subway station: fast commutes along its tunnels',
  tr_train_station: 'Train station: commuters and visitors along the rail line',
  tr_freight_station: 'Freight station: ships the goods of nearby industry by rail',
  tr_parking_garage: `Parking garage: ${GARAGE_SPACES} spaces, park & ride next to a stop`,
  tr_ferry_terminal: 'Ferry terminal: commuters and visitors cross the water',
};

/** a road cell 4-adjacent to the footprint */
function roadNext(st: CityState, b: Building): boolean {
  const N = st.size, net = st.network;
  const ok = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N && net[z * N + x] >= Network.Street && net[z * N + x] <= Network.Highway;
  for (let x = b.x; x < b.x + b.w; x++) if (ok(x, b.z - 1) || ok(x, b.z + b.d)) return true;
  for (let z = b.z; z < b.z + b.d; z++) if (ok(b.x - 1, z) || ok(b.x + b.w, z)) return true;
  return false;
}

/** job buildings (C / I / civic with jobs) within r cells of a building (garage report) */
function businessesNear(st: CityState, b: Building, r: number): number {
  const N = st.size, R = r + (Math.max(b.w, b.d) >> 1);
  const c = centerCell(st, b), cx = c % N, cz = (c - cx) / N;
  const seen = new Set<number>();
  for (let z = Math.max(0, cz - R); z <= Math.min(N - 1, cz + R); z++) for (let x = Math.max(0, cx - R); x <= Math.min(N - 1, cx + R); x++) {
    const id = st.building[z * N + x];
    if (id < 0 || id === b.id || seen.has(id)) continue;
    const o = st.buildings.get(id);
    if (!o) continue;
    const inf = infoOf(st, o);
    if (inf.fam === Fam.C || inf.fam === Fam.I || (inf.fam === Fam.Plop && inf.civicJobs > 0)) seen.add(id);
  }
  return seen.size;
}

/** mean parking pressure on the lots of the businesses within r cells (+ half the footprint) of a building (what its
 *  spaces relieve; the garage's own cells hold its supply) — 0 when there are none */
function parkingNear(st: CityState, b: Building, r: number): number {
  const N = st.size, p = st.parking, R = r + (Math.max(b.w, b.d) >> 1);
  const c = centerCell(st, b), cx = c % N, cz = (c - cx) / N;
  let s = 0, n = 0;
  for (let z = Math.max(0, cz - R); z <= Math.min(N - 1, cz + R); z++) for (let x = Math.max(0, cx - R); x <= Math.min(N - 1, cx + R); x++) {
    if ((x - cx) * (x - cx) + (z - cz) * (z - cz) > (R + 0.5) * (R + 0.5)) continue;
    const id = st.building[z * N + x];
    if (id < 0 || id === b.id) continue;
    const o = st.buildings.get(id);
    if (!o) continue;
    const inf = infoOf(st, o);
    if (!(inf.fam === Fam.C || inf.fam === Fam.I || (inf.fam === Fam.Plop && inf.civicJobs > 0))) continue;
    s += p[z * N + x]; n++;
  }
  return n > 0 ? s / n : 0;
}

/** static tooltip facts of a transit def (buses, spaces, routes ...), appended by WP7a's facilityDefFacts */
export function transportDefFacts(defId: string): FacilityLine[] {
  switch (kindOf(defId)) {
    case 'tr_bus_stop': return [
      { key: 'walk', label: 'Walk radius', value: `${STOP_WALK_RADIUS} tiles` },
      { key: 'wait', label: 'Wait', value: `${WAIT_BUS} min with enough buses` },
      { key: 'buses', label: 'Buses', value: `from a depot within ${DEPOT_RANGE} road tiles (else ${MINIBUS_FLEET} minibuses city-wide)` },
    ];
    case 'civ_bus_depot': return [
      { key: 'buses', label: 'Buses', value: `${DEPOT_BUSES} (x funding, half without power)` },
      { key: 'range', label: 'Serves stops within', value: `${DEPOT_RANGE} road tiles` },
      { key: 'riders', label: 'Carries', value: `~${fmt(DEPOT_BUSES * RIDERS_PER_BUS)} riders/day at best (${BUS_RHO_MAX}x service)` },
    ];
    case 'tr_subway_station': return [
      { key: 'wait', label: 'Wait', value: `${WAIT_SUBWAY} min` },
      { key: 'capacity', label: 'Crowded above', value: `${fmt(STOP_CAP_SUBWAY)} riders/day` },
      { key: 'needs', label: 'Needs', value: 'a tunnel to another subway station' },
    ];
    case 'tr_train_station': return [
      { key: 'wait', label: 'Wait', value: `${WAIT_TRAIN} min` },
      { key: 'capacity', label: 'Crowded above', value: `${fmt(STOP_CAP_TRAIN)} riders/day` },
      { key: 'needs', label: 'Needs', value: 'rails to another train station or the map edge' },
    ];
    case 'tr_freight_station': return [
      { key: 'reach', label: 'Serves industry within', value: `${FREIGHT_SINK_MIN} min by truck` },
      { key: 'needs', label: 'Needs', value: 'rails to the map edge or a seaport' },
    ];
    case 'tr_parking_garage': return [
      { key: 'spaces', label: 'Spaces', value: fmt(GARAGE_SPACES) },
      { key: 'relief', label: 'Parking relief', value: `within ${GARAGE_WALK_RADIUS} tiles` },
      { key: 'parkRide', label: 'Park & ride', value: `with a transit stop within ${PR_STOP_RADIUS} tiles` },
    ];
    case 'tr_ferry_terminal': return [
      { key: 'routes', label: 'Routes', value: `up to ${FERRY_PARTNERS} terminals within ${FERRY_MAX_CELLS} tiles on the same water` },
      { key: 'wait', label: 'Wait', value: `${WAIT_FERRY} min` },
      { key: 'capacity', label: 'Crowded above', value: `${fmt(STOP_CAP_FERRY)} riders/day` },
    ];
    default: return [];
  }
}

/** trucks per day reaching a freight sink building (seaport, freight station); -1 = unknown (no traffic data) */
export function freightSinkTrucks(sim: Simulation, buildingId: number): number {
  const tr = trafficOf(sim);
  if (!tr) return -1;
  const b = sim.state.buildings.get(buildingId);
  if (!b) return -1;
  const t = infoOf(sim.state, b).transit;
  if (t === Transit.Freight && !tr.freightLinked(buildingId)) return 0;
  return tr.sinkTrucks(buildingId);
}

/** trucks per day per road cell of the last traffic cycle (Traffic overlay "Trucks" variant, WP5); null = no data */
export function truckVolumeOf(st: CityState): Float32Array | null {
  return trafficOfSt(st)?.truckVolume() ?? null;
}

/**
 * use factor of a transit def (critic item 12; WP7a's facilityUseFactor multiplies cap relief, freight boost and income
 * by it): -1 = not a transport def, 0 = not connected / not running (lone station, unlinked ferry, freight station
 * without a rail link, off-road stop, depot without stops), 1 = connected. 1 while traffic is not running (unknown).
 */
export function transportUseFactor(st: CityState, b: Building): number {
  const kind = kindOf(b.def);
  if (!kind) return -1;
  if (!isFunctional(b)) return 0;
  const tr = trafficOfSt(st);
  if (!tr) return 1;
  switch (kind) {
    case 'tr_bus_stop': case 'tr_subway_station': case 'tr_train_station': case 'tr_ferry_terminal':
      return tr.stopAttached(b.id) ? 1 : 0;
    case 'tr_freight_station': return tr.freightLinked(b.id) ? 1 : 0;
    case 'civ_bus_depot': { const d = tr.depotInfo(b.id); return d === null ? 1 : d.stops > 0 ? 1 : 0; }
    default: return 1;
  }
}

/** inspector lines of a road / rail cell: traffic, trucks, bus riders, interchange load (WP7-10) */
export function roadCellReport(sim: Simulation, cell: number): FacilityLine[] {
  const st = sim.state;
  if (cell < 0 || cell >= st.cells) return [];
  const t = st.network[cell];
  if (t === Network.None) return [];
  const tr = trafficOf(sim);
  const out: FacilityLine[] = [];
  if (t === Network.Rail) {
    out.push({ key: 'riders', label: 'Train riders', value: `${fmt(st.traffic[cell])}/day` });
    if (tr) {
      const fr = tr.freightRailCells();
      let freight = false;
      for (let k = 0; k < fr.length; k++) if (fr[k] === cell) { freight = true; break; }
      if (freight) out.push({ key: 'freight', label: 'Freight trains', value: 'yes (noisy)' });
    }
    return out;
  }
  const v = st.traffic[cell], c = st.congestion[cell];
  out.push({ key: 'traffic', label: 'Traffic', value: `${fmt(v)} trips/day (${pct(Math.min(9.99, c))} of capacity)`, ratio: c, status: c > 1.2 ? 'bad' : c > 0.9 ? 'warn' : 'ok' });
  if (!tr) return out;
  const trucks = tr.truckVolume();
  if (trucks && trucks[cell] > 0.5) out.push({ key: 'trucks', label: 'Trucks', value: `${fmt(trucks[cell])}/day` });
  const bus = tr.cellBusRiders(cell);
  if (bus > 0.5) out.push({ key: 'bus', label: 'Bus riders', value: `${fmt(bus)}/day` });
  const ramp = tr.rampLoad(cell);
  if (ramp >= 0) {
    // judged by the delay it adds (ramp minutes vs the free ramp of its road class), not by the load alone: an avenue
    // ramp at 150 % costs +0.2 min per car, a road ramp at 250 % several minutes
    const m = tr.rampMinutes(cell), base = RAMP_BY_NET[t] ?? 0.45;
    const f = base > 0 ? m / base : 1;
    const jam = f >= 2;
    out.push({ key: 'interchange', label: 'Interchange load', value: `${pct(ramp)} · ramp ${min1(m)} min`, ratio: ramp,
      status: f >= 4 ? 'bad' : jam ? 'warn' : 'ok',
      hint: jam ? (t === Network.Avenue ? 'Jammed ramp — add another interchange nearby' : 'Jammed ramp — add another interchange, or ramp from an avenue') : undefined });
  }
  return out;
}

/**
 * attached stops within r cells (+ half the footprint) of a footprint, nearest first (garage plop preview). ride = a
 * transit path from the stop rides a vehicle in the last traffic update (false: a downtown stop — its riders walk to jobs
 * beside it, so a garage there is parking, not park & ride; undefined: not assessed yet)
 */
export function stopsNear(sim: Simulation, x: number, z: number, w: number, d: number, r = PR_STOP_RADIUS): { id: number; name: string; mode: string; dist: number; ride?: boolean }[] {
  const tr = trafficOf(sim);
  if (!tr) return [];
  const MODE: Record<number, string> = { [Transit.Bus]: 'bus', [Transit.Subway]: 'subway', [Transit.Train]: 'train', [Transit.Ferry]: 'ferry' };
  return tr.stopsNear(sim.state, x, z, w, d, r).map((s) => ({ id: s.id, name: nameOf(sim.state, s.id), mode: MODE[s.mode] ?? 'transit', dist: Math.round(s.dist * 10) / 10, ride: s.ride }));
}

/** partners (and crossing minutes) a ferry terminal placed at (x, z, w, d, rot) would link to (ferry plop preview) */
export function ferryPartnersFor(sim: Simulation, x: number, z: number, w: number, d: number, rot: number): { id: number; name: string; minutes: number }[] {
  const tr = trafficOf(sim);
  if (!tr) return [];
  return tr.ferryPartnersFor(sim.state, x, z, w, d, rot).map((p) => ({ id: p.id, name: nameOf(sim.state, p.id), minutes: Math.round(p.minutes * 10) / 10 }));
}

/** ferry links (terminal ids a < b, water path cells a -> b, crossing minutes) — "[render] ferry boats on ferry links" */
export function ferryLinks(sim: Simulation): { a: number; b: number; cells: Uint32Array; minutes: number }[] {
  const tr = trafficOf(sim);
  if (!tr) return [];
  return tr.ferryLinks().map((l) => ({ a: l.a, b: l.b, cells: l.cells, minutes: l.minutes }));
}

function transitCovSum(sim: Simulation): number {
  const T = sim.state.transitCov;
  let s = 0;
  for (let i = 0; i < T.length; i++) s += T[i];
  return s;
}
function attachedCount(sim: Simulation, t: Transit): number {
  const tr = trafficOf(sim);
  if (!tr) return 0;
  let n = 0;
  for (const b of sim.state.buildings.values()) if (infoOf(sim.state, b).transit === t && tr.stopAttached(b.id)) n++;
  return n;
}

/**
 * Effect metric per transport def for the facilities matrix test (tests/infra/facilities.test.ts, WP7a): the value
 * after 60 days with the facility must differ from the same city without it. Each reads the facility's own effect:
 *  bus stop            transit coverage (sum of transitCov)
 *  depot               buses in the city's depots (x funding, half without power; burnt: none) — its own product. The
 *                      service they give needs stops in range: stats.transitFleet counts only fleets that serve stops,
 *                      busesShort / the stop waits show it (tests/infra/transitFacilities.test.ts); WP7a's matrix town
 *                      has no bus stops, so a service metric could not change there
 *  subway / train      attached stations of the mode (a station needs a partner station or rail to the edge: place
 *                      two / extend the rails — a lone station genuinely does nothing)
 *  freight station     freight rail cells (needs rails to the map edge or a seaport)
 *  parking garage      total parking supply (parkingSummary.supply, cars / day)
 *  ferry terminal      ferry links (needs a partner terminal on the same water)
 */
export const TRANSPORT_EFFECT_METRICS: Readonly<Record<string, (sim: Simulation) => number>> = {
  tr_bus_stop: (sim) => transitCovSum(sim),
  civ_bus_depot: (sim) => trafficOf(sim)?.depotFleet ?? 0,
  tr_subway_station: (sim) => attachedCount(sim, Transit.Subway),
  tr_train_station: (sim) => attachedCount(sim, Transit.Train),
  tr_freight_station: (sim) => trafficOf(sim)?.freightRailCells().length ?? 0,
  tr_parking_garage: (sim) => trafficOf(sim)?.parkingSummary.supply ?? 0,
  tr_ferry_terminal: (sim) => sim.state.stats.transitFleet.ferryLinks,
};
