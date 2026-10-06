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
 * Report rules (r1, r2): a closed (burnt / abandoned) facility says so first; riders are rides (walkers who would board
 * and alight at the same stop are counted apart, with a hint); a long bus wait blames the fleet only when its pool is
 * short (rho < 1), else the stop's crowding, and names the depot's cause (a transit strike, transit funding below 75 %,
 * no power); crowded stops / stations / terminals name the fix; a garage names its real state (no road, no stop — a
 * neutral note where it serves businesses —, a stop without transit, a downtown stop, park & ride with cars / room /
 * riders / demand of the last assignment — the numbers stats.transitFleet sums —, full while more commuters want it than
 * it holds, and the spaces it keeps for a parking-short block, from PR_RESERVE_MIN x its spaces); a full garage says
 * where its overflow parks, that it takes the overflow of full garages nearby, or — commuters turned away with nowhere to
 * go — where another garage would take them (by a stop near their homes); an idle park & ride garage, or one under
 * PR_LOW_USE of its room, says why (transit from its stop takes PR_LIMIT minutes or more, or from its reach: no homes
 * within the drive, or none with commuters, or the garages the commuters near it use — the nearest, full or not — and why
 * this one is not theirs: too many minutes longer, their garages have room, or their overflow parks at a garage that is
 * faster for them); the pressure around a garage credits its own relief ("(X% without it)"), or, where the pressure is at
 * the top of the scale either way, the spaces the block still lacks with and without it; a depot shows its stops' need
 * beside its fleet.
 * Every function accepts a sim without the traffic system (infra-less tests) and returns the documented stub value.
 */
import type { Building, CityState } from '../CityState';
import type { Simulation } from '../Simulation';
import { BF } from '../CityState';
import { Network } from '../../core/types';
import { getDef } from '../catalog';
import { onStrike } from '../economy/budget';
import type { FacilityLine } from './facilities';
import { Fam, Transit, centerCell, infoOf, isFunctional } from './common';
import { TRAFFIC_OF_STATE } from './transit';
import type { TrafficSystem } from './traffic';
import {
  BUS_RHO_MAX, CAR_OCCUPANCY, DEPOT_BUSES, DEPOT_RANGE, FERRY_MAX_CELLS, FERRY_PARTNERS, FREIGHT_SINK_MIN, GARAGE_SPACES,
  GARAGE_WALK_RADIUS, MINIBUS_FLEET, PR_CAR_LEG_MAX, PR_LIMIT, PR_OPTION_MARGIN, PR_RESERVE_MIN, PR_STOP_RADIUS, RAMP_BY_NET,
  RIDERS_PER_BUS, STOP_CAP_BUS, STOP_CAP_FERRY, STOP_CAP_SUBWAY, STOP_CAP_TRAIN, STOP_WALK_RADIUS, WAIT_BUS, WAIT_FERRY, WAIT_SUBWAY,
  WAIT_TRAIN,
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
 * why a depot runs fewer buses than it could: a transit strike (budget cuts), transit funding below 75 % (budget) or no
 * power; null = none (the stops' report names it instead of a generic "not enough buses")
 */
function depotCause(st: CityState, depot: Building, d: { fleet: number } | null): { kind: 'strike' | 'funding' | 'power'; short: string; fix: string; text: string } | null {
  const f = st.budget?.funding?.transit;
  const fund = typeof f === 'number' && Number.isFinite(f) ? f : 100;
  const fleet = d ? d.fleet : DEPOT_BUSES;
  const name = nameOf(st, depot.id);
  if (onStrike(st, 'transit')) {
    return { kind: 'strike', short: `on strike — no buses run (transit funding ${Math.round(fund)} %)`, fix: 'Raise transit funding in the budget to end the strike',
      text: `${name} is on strike over budget cuts — no buses run until it ends; raise transit funding` };
  }
  if (fund < 75) {
    const short = `runs ${plural(fleet, 'bus', 'buses')} (transit funding ${Math.round(fund)} %)`;
    return { kind: 'funding', short, fix: 'Raise transit funding in the budget', text: `${name} ${short} — raise it in the budget` };
  }
  if (infoOf(st, depot).usesPower && (depot.flags & BF.Powered) === 0) {
    return { kind: 'power', short: `no power (${plural(fleet, 'bus', 'buses')} run)`, fix: 'Connect it to the power grid',
      text: `${name} has no power: half its buses stay in the garage` };
  }
  return null;
}

/** a park & ride garage's rationing price (minutes of choice) from which its report calls it full even when the demand
 *  it gets at that price is just its room (the price is holding the rest off) */
const PR_FULL_PRICE = 0.5;

/** a park & ride garage of the last assignment is full: at its room and more commuters want it than it holds (their
 *  demand beyond the room, or a rationing price) */
function garageFull(g: { parkRide: number; spaces: number; reserve?: number; wanted?: number; price?: number; state?: string }): boolean {
  if (g.state !== 'parkRide') return false;
  const room = g.spaces - Math.min(g.spaces, Math.round(g.reserve ?? 0));
  if (room < 1) return false;
  return Math.min(g.parkRide, room) >= 0.97 * room && ((g.wanted ?? 0) / CAR_OCCUPANCY > 1.02 * room || (g.price ?? 0) >= PR_FULL_PRICE);
}

/** a park & ride garage carrying fewer riders than this share of its room says why (review r3: 17-160 / 900 read "ok"
 *  with no reason) */
const PR_LOW_USE = 0.2;

/** the garage nearest to b among ids (a hint's example the player finds on the map; reviews r2 / r3: hints named garages
 *  79-148 tiles away) */
function nearestOf(st: CityState, b: Building, ids: readonly number[]): Building | undefined {
  let best: Building | undefined, bd = Infinity;
  for (const id of ids) {
    const g = st.buildings.get(id);
    if (!g) continue;
    const d = dist(st, b, g);
    if (d < bd) { bd = d; best = g; }
  }
  return best;
}

/**
 * why a park & ride garage carries nobody (or, low, few riders: under PR_LOW_USE of its room): transit from its stop
 * takes PR_LIMIT minutes or more (no option for anybody), or — from the homes nearest to it (TrafficSystem.garageReach,
 * the last completed traffic update) — no homes within the drive, or none with commuters, it is their option but
 * driving (or, low, their faster options with room) wins, or it is not their option: park & ride from here takes them
 * PR_OPTION_MARGIN or more minutes longer than via the nearest of their options (beyond the overflow too), their
 * options have room, or those are full and their overflow parks at a garage that is faster for them (r4: the overflow
 * takes the next garage with room, so a garage within the margin is never left out by the count of faster ones)
 */
function garageUseHint(sim: Simulation, tr: TrafficSystem, b: Building, stopName: string, transitMin: number | undefined, low: boolean): string {
  const st = sim.state;
  const fix = 'link it to a subway / train line or a better-served stop';
  const lead = low ? 'Few commuters switch' : 'Nobody switches';
  if (transitMin !== undefined && transitMin >= PR_LIMIT) return `${lead}: transit from ${stopName} takes ${fmt(transitMin)} min to the jobs — too slow to beat driving; ${fix}`;
  const reach = tr.garageReach(b.id);
  if (!reach) return 'Not picked yet — next traffic update';
  if (reach.workers < 1) {
    return reach.homes > 0 ? `No commuters within a ${PR_CAR_LEG_MAX}-minute drive — the homes there are empty`
      : `No homes within a ${PR_CAR_LEG_MAX}-minute drive — build garages where commuters live`;
  }
  const at = (g: Building) => `the ${nameOf(st, g.id)} ${dist(st, b, g)} tiles ${compass(st, b, g)}`;
  const isFull = (g: Building) => { const gi = tr.garageInfo(g.id); return gi ? garageFull(gi) : false; };
  // (their options in other groups: this garage may be one of theirs, faded near its cutoff)
  const k = Math.max(1, Math.round(reach.others));
  const faster = `${k} faster park & ride garage${k === 1 ? '' : 's'}`;
  const via = reach.via >= 0 ? st.buildings.get(reach.via) : undefined;
  if (reach.own >= 0.5) {
    // (one of their options: the faster ones with room take most of their riders, or driving wins)
    const vr = low && reach.full < 0.5 ? nearestOf(st, b, reach.optsRoom) : undefined;
    if (vr) return `${lead}: commuters near here have faster garages with room, e.g. ${at(vr)}`;
    return `${lead}: transit from ${stopName} is ${low ? 'barely faster than' : 'slower than'} driving — ${fix}`;
  }
  const ex = nearestOf(st, b, reach.opts) ?? via;
  if (!ex) return `${lead}: the drive here plus transit from ${stopName} takes longer than driving to work — ${fix}`;
  if (reach.slower >= PR_OPTION_MARGIN - 0.25) {
    const full = isFull(ex);
    return `Commuters near here use ${at(ex)}${full ? ' (full)' : ''}: park & ride from here would take them ${fmt(reach.slower)} min longer${full ? ', so when it is full they drive or ride from home instead' : ''} — ${fix}`;
  }
  if (reach.full < 0.5) {
    const vr = nearestOf(st, b, reach.optsRoom) ?? (reach.viaRoom >= 0 ? st.buildings.get(reach.viaRoom) : undefined) ?? ex;
    return `Commuters near here have ${faster} with room, e.g. ${at(vr)} — ${low ? 'few come this far' : 'this one is not needed here'}`;
  }
  // (their options are full: the overflow takes the garages with room, the fastest for them first)
  const ov = reach.ovTo >= 0 ? st.buildings.get(reach.ovTo) : undefined;
  if (ov) return `Commuters near here fill their ${faster}, and their overflow parks at ${at(ov)}, which is faster for them${low ? '' : ' — this one is next in line'}`;
  return `Commuters near here fill their ${faster}, e.g. ${at(ex)}; few of them overflow this far — park & ride from here takes them ${fmt(Math.max(0, reach.slower))} min longer`;
}

/** " (about N tiles DIR)" from building b to a map cell: homes centred there within `spread` tiles (rms) — none when
 *  they are closer than 4 tiles or spread wider than half the way there (a centre of scattered homes points nowhere) */
function towards(st: CityState, b: Building, cell: number, spread: number): string {
  const N = st.size, c = centerCell(st, b), dx = (cell % N) - (c % N), dz = Math.floor(cell / N) - Math.floor(c / N);
  const d = Math.round(Math.hypot(dx, dz));
  if (d < 4 || spread > Math.max(8, 0.5 * d)) return '';
  const deg = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
  return ` (about ${d} tiles ${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]})`;
}

/**
 * hint of a full park & ride garage (r4, review r3: "build another garage" while a neighbouring option had room): the
 * block around it keeps spaces; it takes the overflow of full garages nearby; its commuters were turned away with nowhere
 * to go — another garage helps by a stop near their homes (the centre of those homes); its overflow parks at a garage
 * with room (named: no shortage)
 */
function fullGarageHint(st: CityState, b: Building, g: NonNullable<ReturnType<TrafficSystem['garageInfo']>>, wanted: string, reserve: number, room: number): string {
  if (reserve >= 1) return `Full — ${wanted}; this block needs its own parking: for more park & ride, build garages by stops nearer homes`;
  const riders = g.riders ?? 0, ovIn = g.overflowIn ?? 0, unpl = g.unplaced ?? 0;
  const short = unpl >= Math.max(10, 0.02 * room * CAR_OCCUPANCY);
  if (short) return `Full — ${wanted}: build another garage by a stop near their homes${(g.unplacedHome ?? -1) >= 0 ? towards(st, b, g.unplacedHome!, g.unplacedSpread ?? 0) : ''}`;
  const to = (g.overflowTo ?? -1) >= 0 ? st.buildings.get(g.overflowTo!) : undefined;
  if (to && to.id !== b.id && (g.overflowToRiders ?? 0) >= 1) return `Full — ${wanted}; the overflow parks at the ${nameOf(st, to.id)} ${dist(st, b, to)} tiles ${compass(st, b, to)}`;
  if (ovIn >= 0.5 * riders && ovIn >= 1) return `Full — it takes the overflow of the full garages nearby`;
  return `Full — ${wanted}: build another garage by a stop`;
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
            : cause ? `Not enough buses: ${cause.text}`
              : depot ? `Not enough buses — its ${nameOf(st, depotId)} runs too few for all its stops: build another depot nearby or raise transit funding`
                : 'Not enough buses — build a Bus Depot nearby or raise transit funding')
          : undefined });
      if (depot) {
        lines.push({ key: 'depot', label: 'Buses from', value: `${nameOf(st, depotId)} · ${dist(st, b, depot)} tiles away${cause ? ` — ${cause.short}` : ''}`,
          status: cause ? 'bad' : undefined, hint: cause?.fix });
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
      // (the stops' need beside the fleet when it is short: a cut budget hides it otherwise — every bus runs)
      const need = Math.ceil(d.need - 1e-6);
      lines.push({ key: 'buses', label: 'Buses in service', value: `${fmt(inService)} / ${fmt(d.fleet)}${need > d.fleet ? ` · its stops need ${fmt(need)}` : ''}`,
        ratio: d.fleet > 0 ? d.need / d.fleet : 0, status: d.need > 1.1 * d.fleet ? 'bad' : d.need > d.fleet ? 'warn' : 'ok' });
      lines.push({ key: 'stops', label: 'Stops served', value: `${fmt(d.stops)} within ${DEPOT_RANGE} road tiles` });
      lines.push({ key: 'riders', label: 'Riders', value: `${fmt(d.riders)}/day` });
      if (d.stops === 0) warnings.push(`No bus stops within ${DEPOT_RANGE} road tiles — place stops next to roads nearby`);
      const cause = depotCause(st, b, d);
      if (cause && cause.kind !== 'power') warnings.push(`${cause.text}${d.need > 1.1 * d.fleet ? ` (its stops need ${fmt(need)} buses)` : ''}`);
      else if (d.need > 1.1 * d.fleet) warnings.push(`Its stops need ${fmt(need)} buses — build another depot or raise transit funding`);
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
        // park & ride room (the sim keeps none below PR_RESERVE_MIN x spaces: a block barely short of parking)
        const kept = Math.min(spaces, Math.round(g.reserve ?? 0));
        const reserve = kept >= Math.max(1, PR_RESERVE_MIN * spaces) ? kept : 0;
        const room = spaces - reserve;
        prCars = Math.min(g.parkRide, room);
        const pooled = g.pooled ?? 0;
        if (room < 1) {
          lines.push({ key: 'parkRide', label: 'Park & ride', value: `none — all ${fmt(spaces)} spaces kept for the businesses around it`,
            hint: 'Their block is short of parking; for park & ride, build garages by stops in residential areas' });
        } else {
          const ridersG = g.riders ?? prCars * CAR_OCCUPANCY;
          const wantedCars = (g.wanted ?? 0) / CAR_OCCUPANCY;
          // full: at its room and more commuters want it (demand beyond the room, or a price holding them off)
          const full = garageFull(g);
          const wanted = wantedCars > 1.1 * room ? `${fmt(wantedCars)} cars wanted` : 'more commuters want its spaces than it has';
          lines.push({ key: 'parkRide', label: 'Park & ride', value: `${fmt(prCars)} / ${fmt(room)} cars${pooled > 0 ? ` (shared with ${plural(pooled, 'garage', 'garages')} at ${stopName})` : ''}`,
            ratio: prCars / room, status: full ? 'warn' : 'ok', hint: full ? fullGarageHint(st, b, g, wanted, reserve, room) : undefined });
          // (idle — or few riders: under PR_LOW_USE of its room — says why)
          const low = !full && ridersG < PR_LOW_USE * room * CAR_OCCUPANCY;
          lines.push({ key: 'switched', label: 'Commuters switched', value: `${fmt(ridersG)}/day to ${stopName}`, status: ridersG < 1 ? 'warn' : undefined,
            hint: low ? garageUseHint(sim, tr, b, stopName, g.transitMin, ridersG >= 1) : undefined });
        }
        if (reserve >= 1) {
          lines.push({ key: 'kept', label: 'Kept for the block', value: `${plural(reserve, 'space', 'spaces')} — it is short of parking`,
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
      // (a block far beyond its parking stays near the top of the scale with or without the garage: then the spaces it
      // still lacks, and what it would lack without this garage, show the garage's part)
      const short = rl && businesses > 0 && p > 0.3 && credit < 0.05 && rl.shortWithout - rl.short >= 1
        ? `Still short of about ${plural(rl.short, 'space', 'spaces')} (${fmt(rl.shortWithout)} without it): add another garage, or transit to these jobs`
        : undefined;
      lines.push({ key: 'pressure', label: 'Parking pressure around it',
        value: `${p < 0.005 ? 'none' : pct(p)}${credit >= 0.05 ? ` (${pct(Math.min(1, p + credit))} without it)` : ''}`, ratio: p,
        status: p > 0.6 ? 'bad' : p > 0.3 ? 'warn' : 'ok',
        hint: businesses > 0 && p < 0.05
          ? (credit >= 0.05 ? 'Its free spaces keep the businesses around it supplied' : 'No parking shortage around it — shortages appear in dense downtowns')
          : short ?? (p > 0.6 ? 'Still short of parking: add another garage, or transit to these jobs' : undefined) });
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
