/**
 * WP7b transport facilities (docs/SIM_DEPTH_AMENDMENTS.md WP7-5 .. WP7-10, docs/SIM_DEPTH_PART_B.md): bus fleet and
 * depots, connected stations, parking pressure, park & ride, ferries, interchanges / trucks, freight sinks, reports.
 * Scripted towns (the bot builds no transit, critic item 24).
 */
import { describe, expect, it } from 'vitest';
import { Network, Zone } from '../../src/core/types';
import { BF, type CityState } from '../../src/sim/CityState';
import type { Simulation } from '../../src/sim/Simulation';
import { getTraffic, type TrafficSystem } from '../../src/sim/systems/infra';
import { CAR_OCCUPANCY, GARAGE_SPACES, GARAGE_WALK_RADIUS, WAIT_BUS } from '../../src/sim/infra/params';
import {
  TRANSPORT_EFFECT_METRICS, ferryLinks, ferryPartnersFor, freightSinkTrucks, roadCellReport, stopsNear, transportDefFacts,
  transportFacilityReport, transportUseFactor, truckVolumeOf,
} from '../../src/sim/infra/transportFacilities';
import { newSim, newState, place, roadLine, stressCity } from './cityGen';
import { schedulerOf } from '../../src/sim/infra/scheduler';
import { deserializeCity, serializeCity, type SerializedCity } from '../../src/save/serialize';
import * as FAC from '../../src/sim/infra/facilities';

function cycles(sim: Simulation, n: number): TrafficSystem {
  const tr = getTraffic(sim)!;
  for (let k = 0; k < n; k++) { tr.invalidate(); tr.runCycleSync(sim); }
  return tr;
}
/** mean of fn over the next n assignments (the assignment is an equilibrium process: read it over several cycles) */
function meanOver(sim: Simulation, n: number, fn: (tr: TrafficSystem) => number): number {
  const tr = getTraffic(sim)!;
  let s = 0;
  for (let k = 0; k < n; k++) { tr.invalidate(); tr.runCycleSync(sim); s += fn(tr); }
  return s / n;
}

/**
 * bus town: R$ homes west, offices east along one road (z = 20), bus stops on the north side of the road near both.
 * ~30k residents -> ~16k workers; buses beat cars for R$ (transit bias), so the stops carry ~18k riders / day.
 * depot: 'none', 'near' (next to the stops) or 'far' (> DEPOT_RANGE road tiles away from every stop). The power plant
 * sits at the far east end: a job site beside the home stops would be every home's nearest transit job (the transit
 * option is not destination-specific) and draw the riders west.
 */
function busTown(depot: 'none' | 'near' | 'far'): { st: CityState; homeStop: number; jobStop: number; depotId: number } {
  const st = newState(192);
  roadLine(st, 2, 20, 186, 20, Network.Road);
  place(st, 't_coal', 184, 18); // power for the depot (conducts along the road)
  for (let x = 6; x <= 30; x++) for (const z of [21, 22]) place(st, 't_r1', x, z, { pop: 600, capacity: 600, wealth: 1 });
  for (let x = 46; x <= 62; x += 2) place(st, 't_co', x, 21, { jobs: 1800, capacity: 2200 });
  let homeStop = -1, jobStop = -1;
  for (const x of [7, 10, 13, 16, 19, 22, 25, 28]) { const b = place(st, 't_bus', x, 19); if (x === 16) homeStop = b.id; }
  for (const x of [47, 52, 57, 62]) { const b = place(st, 't_bus', x, 19); if (x === 47) jobStop = b.id; }
  let depotId = -1;
  if (depot === 'near') depotId = place(st, 'civ_bus_depot', 34, 17).id;
  if (depot === 'far') depotId = place(st, 'civ_bus_depot', 180, 17).id;
  st.stats.population = 25 * 2 * 600;
  return { st, homeStop, jobStop, depotId };
}

describe('WP7-5 bus fleet and depots', () => {
  it('without a depot 8 minibuses cannot serve a big town; a depot within range brings the wait back', { timeout: 300000 }, () => {
    const res: Record<string, { wait: number; waitMin: number; waitMax: number; riders: number; buses: number; need: number; short: number; transit: number }> = {};
    for (const mode of ['none', 'near', 'far'] as const) {
      const { st, homeStop, depotId } = busTown(mode);
      const sim = newSim(st);
      const tr = cycles(sim, 10);
      // read over 5 consecutive assignments (the stop loads are smoothed; one cycle alone is one sample)
      const waits: number[] = [];
      const riders = meanOver(sim, 5, (t) => { const l = t.stopLoad(homeStop)!; waits.push(l.waitMin); return l.riders; });
      const l = tr.stopLoad(homeStop)!;
      const tf = tr.fleetStats;
      res[mode] = { wait: waits.reduce((a, b) => a + b, 0) / waits.length, waitMin: Math.min(...waits), waitMax: Math.max(...waits), riders, buses: tf.buses, need: tf.busesNeeded, short: tf.busesShort ?? -1, transit: st.stats.tripsTransit };
      if (mode === 'near') {
        expect(l.depotId).toBe(depotId);
        // the depot report and the road between the stops (bus riders on the cell)
        const rep = transportFacilityReport(sim, st.buildings.get(depotId)!)!;
        expect(rep.lines.find((x) => x.key === 'buses')!.value).toMatch(/\/ 40$/);
        expect(roadCellReport(sim, st.idx(35, 20)).some((x) => x.key === 'bus')).toBe(true);
        expect(tf.buses).toBe(40); // the minibus pool serves no stop: not counted
      } else {
        expect(l.depotId).toBe(-1);
        // a depot that reaches no stop runs no route: only the minibuses count, and the shortfall shows
        expect(tf.buses).toBe(8);
        expect(tf.busesShort!).toBeGreaterThan(5);
      }
      if (mode === 'none') {
        const rep = transportFacilityReport(sim, st.buildings.get(homeStop)!)!;
        expect(rep.lines.find((x) => x.key === 'depot')!.value).toMatch(/Minibus/);
        expect(rep.lines.find((x) => x.key === 'wait')!.hint).toMatch(/Not enough buses/);
      }
      if (mode !== 'none') expect(st.buildings.get(depotId)!.flags & BF.Powered).toBeTruthy();
    }
    console.log(`bus fleet (mean of cycles 11-15): ${Object.entries(res).map(([k, v]) => `${k}: wait ${v.wait.toFixed(2)} (${v.waitMin.toFixed(2)}-${v.waitMax.toFixed(2)}) min riders ${v.riders.toFixed(0)} buses ${v.buses} need ${v.need} short ${v.short} transit ${v.transit}`).join(' | ')}`);
    expect(res.none.wait).toBeGreaterThanOrEqual(1.7 * WAIT_BUS);
    expect(res.near.wait).toBeLessThanOrEqual(1.25 * WAIT_BUS);
    expect(res.near.waitMax).toBeLessThanOrEqual(1.35 * WAIT_BUS);
    expect(res.near.short).toBe(0);
    // a depot beyond DEPOT_RANGE road tiles serves none of the stops: the stops' service is the minibus pool's
    // (the far depot's 50 jobs are a job site of their own, so the assignment differs a little)
    expect(Math.abs(res.far.wait - res.none.wait)).toBeLessThanOrEqual(0.05 * res.none.wait);
    expect(res.near.transit).toBeGreaterThan(res.none.transit);
  });

  it('a stop whose only jobs are a walk away carries no riders and needs no buses (walkers are not riders)', () => {
    // homes and shops around one bus stop, nothing else: everyone who "takes transit" would board and alight here
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    place(st, 't_coal', 56, 18);
    for (let x = 20; x <= 26; x++) place(st, 't_r1', x, 21, { pop: 40, capacity: 40, wealth: 1 });
    for (let x = 27; x <= 30; x++) place(st, 't_cs', x, 21, { jobs: 30, capacity: 40 });
    const stop = place(st, 'tr_bus_stop', 25, 19);
    st.stats.population = 7 * 40;
    const sim = newSim(st);
    const tr = cycles(sim, 6);
    const l = tr.stopLoad(stop.id)!;
    expect(l.riders).toBe(0);
    expect(l.walkers!).toBeGreaterThan(50);
    expect(st.stats.transitFleet.busesNeeded).toBe(0);
    expect(st.stats.tripsTransit).toBe(0);
    expect(st.stats.tripsWalk + st.stats.tripsCar).toBeGreaterThan(100);
    const rep = transportFacilityReport(sim, stop)!;
    expect(rep.lines.find((x) => x.key === 'riders')!.hint).toMatch(/walk to jobs beside this stop/);
    // the garage preview knows the stop is no park & ride stop
    expect(tr.stopsNear(st, 23, 17, 2, 2).find((x) => x.id === stop.id)!.ride).toBe(false);
  });

  it('an unfunded depot runs no buses: its stops and the depot name the cause', () => {
    const { st, homeStop, depotId } = busTown('near');
    (st.budget.funding as Record<string, number>).transit = 0;
    const sim = newSim(st);
    cycles(sim, 8);
    const stop = transportFacilityReport(sim, st.buildings.get(homeStop)!)!;
    expect(stop.lines.find((l) => l.key === 'depot')!.value).toMatch(/Bus Depot · \d+ tiles away — runs 0 buses \(transit funding 0 %\)/);
    expect(stop.lines.find((l) => l.key === 'wait')!.hint).toMatch(/Not enough buses: Bus Depot runs 0 buses \(transit funding 0 %\)/);
    expect(transportFacilityReport(sim, st.buildings.get(depotId)!)!.warnings.join()).toMatch(/transit funding 0 %/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
function services(sim: Simulation): { compute(sim: Simulation, first: boolean): void } {
  return sim.getSystem('services') as unknown as { compute(sim: Simulation, first: boolean): void };
}
function covNear(st: CityState, x: number, z: number): number {
  return st.transitCov[st.idx(x, z)];
}

describe('WP7-6 stations must be connected (critic item 17)', () => {
  it('a lone subway station gives no coverage and warns; a second station on the tunnel connects both', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    place(st, 't_coal', 2, 18); // power (stations use a little)
    for (let x = 10; x <= 14; x++) st.subway[st.idx(x, 21)] = 1; // stub tunnel
    const a = place(st, 'tr_subway_station', 10, 21);
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    expect(tr.stopAttached(a.id)).toBe(false);
    expect(covNear(st, 10, 23)).toBe(0);
    const rep = transportFacilityReport(sim, a)!;
    expect(rep.warnings.some((w) => /not connected/i.test(w))).toBe(true);
    expect(transportUseFactor(st, a)).toBe(0);
    // extend the tunnel to a second station
    for (let x = 15; x <= 40; x++) st.subway[st.idx(x, 21)] = 1;
    const b = place(st, 'tr_subway_station', 40, 21);
    sim.events.emit('buildingAdded', b);
    sim.events.emit('subwayChanged', { x0: 10, z0: 21, x1: 41, z1: 22 });
    expect(tr.stopAttached(a.id)).toBe(true);
    expect(tr.stopAttached(b.id)).toBe(true);
    expect(tr.stationLine(a.id)).toEqual({ stations: 2, edge: false });
    services(sim).compute(sim, false);
    expect(covNear(st, 10, 23)).toBeGreaterThan(0.4);
    expect(transportUseFactor(st, a)).toBe(1);
  });

  it('a train station needs a second station or rail to the map edge; an off-road bus stop gives nothing', () => {
    const st = newState(64);
    roadLine(st, 2, 20, 60, 20, Network.Road);
    for (let x = 10; x <= 30; x++) st.network[st.idx(x, 30)] = Network.Rail;
    const t = place(st, 'tr_train_station', 12, 31); // 4x2, touches the rail at z = 30
    const offRoad = place(st, 'tr_bus_stop', 40, 40);
    const onRoad = place(st, 'tr_bus_stop', 20, 21);
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    expect(tr.stopAttached(t.id)).toBe(false);
    expect(tr.stopAttached(offRoad.id)).toBe(false);
    expect(tr.stopAttached(onRoad.id)).toBe(true);
    expect(covNear(st, 40, 41)).toBe(0);
    expect(covNear(st, 20, 22)).toBeGreaterThan(0.3);
    expect(transportFacilityReport(sim, offRoad)!.warnings.join()).toMatch(/road/i);
    // rail to the west map edge: a regional line
    for (let x = 0; x < 10; x++) st.network[st.idx(x, 30)] = Network.Rail;
    sim.events.emit('networkChanged', { x0: 0, z0: 30, x1: 10, z1: 31 });
    expect(tr.stopAttached(t.id)).toBe(true);
    expect(tr.stationLine(t.id)!.edge).toBe(true);
  });

  it('freight stations are sinks (and run freight trains) only with rail to the region', () => {
    const st = newState(64);
    roadLine(st, 2, 33, 60, 33, Network.Road);
    for (let x = 20; x <= 40; x++) st.network[st.idx(x, 30)] = Network.Rail;
    const f = place(st, 'tr_freight_station', 24, 31); // 4x2: rail on its north side, the road on its south side
    for (let x = 22; x <= 40; x += 2) place(st, 't_id', x, 34, { jobs: 40 });
    const sim = newSim(st);
    const tr = cycles(sim, 2);
    expect(tr.freightLinked(f.id)).toBe(false);
    expect(tr.freightRailCells().length).toBe(0);
    expect(freightSinkTrucks(sim, f.id)).toBe(0);
    expect(transportFacilityReport(sim, f)!.warnings.join()).toMatch(/rail link/i);
    for (let x = 41; x < 64; x++) st.network[st.idx(x, 30)] = Network.Rail;
    sim.events.emit('networkChanged', { x0: 41, z0: 30, x1: 64, z1: 31 });
    cycles(sim, 2);
    expect(tr.freightLinked(f.id)).toBe(true);
    const rail = tr.freightRailCells();
    expect(rail.length).toBeGreaterThan(10);
    for (let k = 0; k < rail.length; k++) expect(st.network[rail[k]]).toBe(Network.Rail);
    expect(freightSinkTrucks(sim, f.id)).toBeGreaterThan(0);
    expect(tr.getSampleRoutes(200).some((r) => r.kind === 'train')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
function zoneRect(st: CityState, x0: number, z0: number, x1: number, z1: number, zone: Zone): void {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (st.network[st.idx(x, z)] === Network.None) st.zone[st.idx(x, z)] = zone;
}

/**
 * park & ride town: R$$ suburb on side roads north-west (no station within walking distance), an avenue (z = 70) to a
 * dense downtown office strip in the east (5 towers x 840 jobs on a commercial zone: little parking), a subway under the
 * avenue from a suburban station (x = 46) to downtown (x = 162, 168). garages: top-left corners (48, 68 = next to the
 * suburban station); mul scales homes and jobs (2 = a jammed town where park & ride is wanted far beyond its spaces)
 */
function prTown(garages: [number, number][], mul = 1): { st: CityState; offices: number[]; ids: number[] } {
  const st = newState(192);
  roadLine(st, 5, 70, 186, 70, Network.Avenue);
  for (const x of [10, 40]) roadLine(st, x, 40, x, 69, Network.Avenue);
  for (const z of [40, 44, 48]) roadLine(st, 11, z, 39, z, Network.Road);
  place(st, 't_coal', 5, 68);
  for (let x = 12; x <= 38; x++) for (const z of [41, 43, 45, 47]) place(st, 't_r2', x, z, { pop: 70 * mul, capacity: 70 * mul, wealth: 2 });
  const offices: number[] = [];
  for (let x = 160; x <= 168; x += 2) offices.push(place(st, 't_co', x, 71, { jobs: 840 * mul, capacity: 920 * mul }).id);
  zoneRect(st, 158, 66, 181, 76, Zone.ComHigh);
  for (let x = 45; x <= 178; x++) st.subway[st.idx(x, 70)] = 1;
  place(st, 'tr_subway_station', 46, 69);
  place(st, 'tr_subway_station', 162, 69);
  place(st, 'tr_subway_station', 168, 69);
  // (a garage's own 4 attendant jobs are no transit destination: riders go downtown)
  const ids = garages.map(([x, z]) => place(st, 'tr_parking_garage', x, z).id);
  st.stats.population = 27 * 4 * 70 * mul;
  return { st, offices, ids };
}

function downtown(st: CityState, tr: TrafficSystem, offices: number[]): { cars: number; parking: number } {
  let cars = 0, p = 0, n = 0;
  for (const id of offices) {
    cars += tr.carsArriving(id);
    const b = st.buildings.get(id)!;
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) { p += st.parking[st.idx(x, z)]; n++; }
  }
  return { cars, parking: p / Math.max(1, n) };
}

/**
 * busy downtown block (28 offices x 600 jobs on a commercial high-density zone, little parking) + a subway pair; homes
 * far west. probe = the office cells within the garage's walk radius (what its report's "Parking relief" line counts)
 */
function denseBlock(garage: boolean): { st: CityState; probe: number[]; garageId: number } {
  const st = newState(96);
  roadLine(st, 2, 40, 93, 40, Network.Avenue);
  for (const z of [34, 46]) roadLine(st, 50, z, 80, z, Network.Road);
  for (const x of [50, 65, 80]) roadLine(st, x, 34, x, 46, Network.Road);
  place(st, 't_coal', 2, 38);
  for (let x = 4; x <= 40; x++) place(st, 't_r2', x, 41, { pop: 830, capacity: 830, wealth: 2 });
  const offices: number[] = [];
  for (let x = 51; x <= 63; x += 2) for (const z of [35, 37, 42, 44]) offices.push(place(st, 't_co', x, z, { jobs: 600, capacity: 640 }).id);
  zoneRect(st, 50, 34, 80, 46, Zone.ComHigh);
  for (let x = 10; x <= 60; x++) st.subway[st.idx(x, 39)] = 1;
  place(st, 'tr_subway_station', 12, 39);
  place(st, 'tr_subway_station', 58, 39);
  const garageId = garage ? place(st, 'tr_parking_garage', 56, 38).id : -1; // beside the downtown station (2x2: centre 57, 39)
  st.stats.population = 37 * 830;
  const probe: number[] = [];
  for (const id of offices) {
    const b = st.buildings.get(id)!;
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if (Math.hypot(x - 57, z - 39) <= GARAGE_WALK_RADIUS + 1) probe.push(st.idx(x, z));
  }
  return { st, probe, garageId };
}

/**
 * a parking-short office block (28 offices x 520 jobs on a commercial high-density zone) east of an avenue; homes far
 * west. Bus stops by the homes, in the block, and stop A west of the block with no office within its walk radius (its
 * riders ride into the block: a park & ride stop); a depot. garage: 'ride' beside stop A (offices within its walk
 * radius), 'nostop' south of the block (no stop within 5 tiles). probe = office cells within its walk radius (+ 1.5)
 */
function shortBlock(garage: 'none' | 'ride' | 'nostop'): { st: CityState; probe: number[]; garageId: number } {
  const st = newState(96);
  roadLine(st, 2, 40, 93, 40, Network.Avenue);
  for (const z of [34, 46]) roadLine(st, 58, z, 82, z, Network.Road);
  for (const x of [58, 82]) roadLine(st, x, 34, x, 46, Network.Road);
  place(st, 't_coal', 2, 38);
  for (let x = 4; x <= 34; x++) place(st, 't_r2', x, 41, { pop: 700, capacity: 700, wealth: 2 });
  const offices: number[] = [];
  for (let x = 59; x <= 71; x += 2) for (const z of [35, 37, 42, 44]) offices.push(place(st, 't_co', x, z, { jobs: 520, capacity: 560 }).id);
  zoneRect(st, 58, 34, 82, 46, Zone.ComHigh);
  for (const x of [16, 66, 50]) place(st, 'tr_bus_stop', x, 39);
  place(st, 'civ_bus_depot', 40, 36);
  const garageId = garage === 'ride' ? place(st, 'tr_parking_garage', 53, 38).id : garage === 'nostop' ? place(st, 'tr_parking_garage', 70, 47).id : -1;
  st.stats.population = 31 * 700;
  const [cx, cz] = garage === 'nostop' ? [71, 48] : [54, 39];
  const probe: number[] = [];
  for (const id of offices) {
    const b = st.buildings.get(id)!;
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) if (Math.hypot(x - cx, z - cz) <= GARAGE_WALK_RADIUS + 1.5) probe.push(st.idx(x, z));
  }
  return { st, probe, garageId };
}

describe('WP7-7 parking and WP7-8 park & ride', () => {
  it('a garage beside a downtown stop eases its block (mean of 6 parking updates)', { timeout: 300000 }, () => {
    const res: number[] = [];
    for (const g of [false, true]) {
      const { st, probe, garageId } = denseBlock(g);
      expect(probe.length).toBeGreaterThan(40);
      const sim = newSim(st);
      const tr = cycles(sim, 4);
      // the raster is recomputed every 2nd assignment (blended with the previous one): 12 cycles = 6 updates
      res.push(meanOver(sim, 12, () => probe.reduce((a, i) => a + st.parking[i], 0) / probe.length));
      if (g) {
        // the downtown station's riders walk to jobs beside it: no park & ride — its 900 spaces ease the block
        const info = tr.garageInfo(garageId)!;
        expect(info.stopId).toBeGreaterThan(0);
        expect(info.state).toBe('downtown');
        expect(info.ride).toBe(false);
        expect(info.parkRide).toBe(0);
        expect(st.stats.transitFleet.parkRide).toBe(0);
        expect(st.stats.transitFleet.parkRideSpaces).toBe(0);
        const rep = transportFacilityReport(sim, st.buildings.get(garageId)!)!;
        expect(rep.lines.find((l) => l.key === 'parkRide')!.value).toMatch(/downtown/);
        expect(rep.lines.find((l) => l.key === 'parking')!.value).toMatch(/^900 spaces for \d+ businesses/);
        expect(rep.warnings.join()).not.toMatch(/No transit stop/);
      }
    }
    console.log(`garage block (mean of 6 updates): parking ${res[0].toFixed(3)} -> ${res[1].toFixed(3)}`);
    expect(res[0]).toBeGreaterThan(0.5);
    expect(res[0] - res[1]).toBeGreaterThanOrEqual(0.2);
  });

  it('a garage beside a subway stop takes cars off downtown, steadily; a garage without a stop is parking only', { timeout: 300000 }, () => {
    const out: Record<string, { cars: number; parking: number; pr: number; prMin: number; prMax: number; commute: number }> = {};
    for (const g of ['none', 'station', 'lonely'] as const) {
      const { st, offices, ids } = prTown(g === 'station' ? [[48, 68]] : g === 'lonely' ? [[100, 68]] : []);
      const garageId = ids[0] ?? -1;
      const sim = newSim(st);
      const tr = cycles(sim, 7);
      // cycles 8-20: park & ride per assignment, the garage never holds more cars than its spaces
      const prs: number[] = [];
      let cars = 0, parking = 0, commute = 0;
      for (let k = 0; k < 13; k++) {
        tr.invalidate(); tr.runCycleSync(sim);
        prs.push(st.stats.transitFleet.parkRide);
        const d = downtown(st, tr, offices);
        cars += d.cars / 13; parking += d.parking / 13; commute += st.stats.avgCommute / 13;
        if (g === 'station') {
          const info = tr.garageInfo(garageId)!;
          expect(info.parkRide).toBeLessThanOrEqual(1.03 * info.spaces);
          // the report and stats.transitFleet read the same number
          expect(Math.abs(info.riders! - st.stats.transitFleet.parkRide)).toBeLessThanOrEqual(1);
        }
      }
      const mean = prs.reduce((a, b) => a + b, 0) / prs.length;
      out[g] = { cars, parking, pr: mean, prMin: Math.min(...prs), prMax: Math.max(...prs), commute };
      if (g === 'lonely') {
        const info = tr.garageInfo(garageId)!;
        expect(info.stopId).toBe(-1);
        expect(info.parkRide).toBe(0);
        const rep = transportFacilityReport(sim, st.buildings.get(garageId)!)!;
        expect(rep.warnings.join()).toMatch(/No transit stop within 5 tiles/);
      }
      if (g === 'station') {
        const info = tr.garageInfo(garageId)!;
        expect(info.stopId).toBeGreaterThan(0);
        expect(info.state).toBe('parkRide');
        const rep = transportFacilityReport(sim, st.buildings.get(garageId)!)!;
        expect(rep.lines.find((l) => l.key === 'parkRide')!.value).toMatch(/\/ 900 cars/);
        expect(rep.lines.find((l) => l.key === 'switched')!.value).toMatch(/^[\d,]+\/day to Subway Station/);
        // garage plop preview: the suburban station is within 5 tiles, and its riders ride (a park & ride stop)
        const near = stopsNear(sim, 48, 68, 2, 2);
        expect(near.map((x) => x.mode)).toContain('subway');
        expect(near.find((x) => x.mode === 'subway')!.ride).toBe(true);
      }
    }
    console.log(`park & ride (cycles 8-20): ${Object.entries(out).map(([k, v]) => `${k}: downtown cars ${v.cars.toFixed(0)} parking ${v.parking.toFixed(2)} P&R ${v.pr.toFixed(0)} (${v.prMin}-${v.prMax}) commute ${v.commute.toFixed(1)}`).join(' | ')}`);
    expect(out.none.pr).toBe(0);
    expect(out.lonely.pr).toBe(0);
    expect(out.station.pr).toBeGreaterThan(0);
    expect((out.station.prMax - out.station.prMin) / out.station.pr).toBeLessThanOrEqual(0.2);
    expect(out.station.cars).toBeLessThanOrEqual(0.9 * out.none.cars);
    expect(out.station.parking).toBeLessThan(out.none.parking);
    expect(out.none.parking).toBeGreaterThan(0.2);
  });

  it('a full garage turns commuters away (capacity, rationing price); two garages at one station fill together', { timeout: 300000 }, () => {
    // a jammed town (2 x homes / jobs): park & ride is wanted far beyond one garage's spaces
    {
      const { st, ids } = prTown([[48, 68]], 2);
      const sim = newSim(st);
      const tr = getTraffic(sim)!;
      for (let k = 0; k < 16; k++) {
        tr.invalidate(); tr.runCycleSync(sim);
        expect(st.stats.transitFleet.parkRide).toBeLessThanOrEqual(1.05 * GARAGE_SPACES * CAR_OCCUPANCY);
      }
      const info = tr.garageInfo(ids[0])!;
      expect(info.wanted!).toBeGreaterThan(2 * GARAGE_SPACES * CAR_OCCUPANCY);
      expect(info.price!).toBeGreaterThan(1);
      const rep = transportFacilityReport(sim, st.buildings.get(ids[0])!)!;
      expect(rep.lines.find((l) => l.key === 'parkRide')!.hint).toMatch(/Full — [\d,]+ cars wanted/);
    }
    // two garages side by side at the suburban station: they pool their spaces (one would otherwise take the whole
    // catchment every other cycle while the other idles)
    const one = (() => { const { st } = prTown([[48, 68]]); const sim = newSim(st); return meanOver(sim, 12, () => st.stats.transitFleet.parkRide); })();
    const { st, ids } = prTown([[48, 68], [50, 68]]);
    const sim = newSim(st);
    const tr = cycles(sim, 8);
    const loads = [0, 0];
    const two = meanOver(sim, 8, (t) => { ids.forEach((id, q) => { loads[q] += t.garageInfo(id)!.parkRide / 8; }); return st.stats.transitFleet.parkRide; });
    console.log(`two garages: P&R ${two.toFixed(0)} vs one ${one.toFixed(0)}; cars ${loads.map((v) => v.toFixed(0)).join(' / ')}`);
    for (const v of loads) expect(v).toBeGreaterThan(0.5 * GARAGE_SPACES);
    expect(two).toBeGreaterThan(1.5 * one);
    expect(tr.garageInfo(ids[1])!.pooled).toBe(1);
  });

  it('garage report: before its first traffic update and without a road it names the real state', () => {
    const { st } = prTown([]);
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    // placed next to the suburban station after the last assignment: what the preview promised, no false warning
    const g = place(st, 'tr_parking_garage', 48, 68);
    sim.events.emit('buildingAdded', g);
    expect(tr.garageInfo(g.id)).toBeNull();
    const rep = transportFacilityReport(sim, g)!;
    expect(rep.warnings.join()).not.toMatch(/No transit stop/);
    expect(rep.lines.find((l) => l.key === 'parkRide')!.value).toMatch(/next to Subway Station — starts with the next traffic update/);
    // off the road (two cells north of the avenue, beside the station): the road is what is missing
    const off = place(st, 'tr_parking_garage', 50, 66);
    sim.events.emit('buildingAdded', off);
    cycles(sim, 1);
    const rep2 = transportFacilityReport(sim, off)!;
    expect(rep2.warnings.join()).toMatch(/No road access/);
    expect(rep2.warnings.join()).not.toMatch(/No transit stop/);
    // ... and it eases no parking (drivers can't reach it): relief 'none', no supply in the parking raster
    expect(rep2.lines.find((l) => l.key === 'parking')!.value).toBe('none — no road access');
    const supplyWith = () => { cycles(sim, 2); return tr.parkingSummary.supply; };
    const s1 = supplyWith();
    st.buildings.get(off.id)!.flags |= BF.Burnt; // (a burnt garage is not collected: the supply without it)
    sim.events.emit('buildingChanged', st.buildings.get(off.id)!);
    const s0 = supplyWith();
    console.log(`off-road garage: supply ${s1.toFixed(0)} with it, ${s0.toFixed(0)} burnt`);
    expect(Math.abs(s1 - s0)).toBeLessThan(0.25 * GARAGE_SPACES);
    // the one by the station is park & ride now
    expect(tr.garageInfo(g.id)!.state).toBe('parkRide');
  });

  it('two garages at two stations of one line share the demand: both full, steadily (cycles 10-30)', { timeout: 300000 }, () => {
    // a jammed town (2 x homes / jobs): park & ride is wanted beyond both garages; they are 24 cells apart (two groups):
    // every commuter has both as options, so a full one overflows to the other instead of the two taking turns
    const { st } = prTown([], 2);
    place(st, 'tr_subway_station', 70, 69);
    const ids = [place(st, 'tr_parking_garage', 48, 68).id, place(st, 'tr_parking_garage', 72, 68).id];
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    const cars: number[][] = [[], []], city: number[] = [];
    for (let k = 0; k < 30; k++) {
      tr.invalidate(); tr.runCycleSync(sim);
      if (k < 9) continue;
      ids.forEach((id, q) => cars[q].push(tr.garageInfo(id)!.parkRide));
      city.push(st.stats.transitFleet.parkRide);
    }
    const spread = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return (Math.max(...a) - Math.min(...a)) / m; };
    console.log(`two stations: cars ${cars.map((c) => `${Math.min(...c).toFixed(0)}-${Math.max(...c).toFixed(0)}`).join(' / ')}, city P&R ${Math.min(...city)}-${Math.max(...city)}`);
    for (const c of cars) {
      expect(Math.min(...c)).toBeGreaterThanOrEqual(0.8 * GARAGE_SPACES);
      expect(spread(c)).toBeLessThanOrEqual(0.2);
    }
    expect(spread(city)).toBeLessThanOrEqual(0.2);
    expect(tr.garageInfo(ids[0])!.pooled).toBe(0);
  });

  it('a garage by a ride stop in a parking-short block keeps its spaces for the block first; one off the stops is parking', { timeout: 300000 }, () => {
    const res: Record<string, number> = {};
    for (const g of ['none', 'ride', 'nostop'] as const) {
      const { st, probe, garageId } = shortBlock(g);
      const sim = newSim(st);
      const tr = cycles(sim, 6);
      // mean of 6 parking updates over the office cells within its walk radius
      res[g] = meanOver(sim, 12, () => probe.reduce((a, i) => a + st.parking[i], 0) / probe.length);
      if (g === 'none') continue;
      const info = tr.garageInfo(garageId)!;
      const rep = transportFacilityReport(sim, st.buildings.get(garageId)!)!;
      const text = rep.lines.map((l) => `${l.value} ${l.hint ?? ''}`).join(' | ') + rep.warnings.join(' | ');
      console.log(`${g} garage: ${text}`);
      // what the report says about its own relief: the pressure around it with and without its free spaces
      expect(info.relief!.without).toBeGreaterThan(info.relief!.with + 0.05);
      expect(rep.lines.find((l) => l.key === 'pressure')!.value).toMatch(/without it/);
      expect(text).not.toMatch(/build another garage by a stop/);
      expect(rep.warnings).toEqual([]);
      if (g === 'ride') {
        // its stop's riders ride (park & ride), but the businesses around it are short of parking: they come first
        expect(info.state).toBe('parkRide');
        expect(info.reserve!).toBeGreaterThan(0.9 * GARAGE_SPACES);
        expect(rep.lines.find((l) => l.key === 'kept')!.value).toMatch(/spaces — the businesses around it are short of parking/);
      } else {
        expect(info.state).toBe('noStop');
        expect(rep.lines.find((l) => l.key === 'parkRide')!.value).toMatch(/none — no transit stop within 5 tiles/);
      }
    }
    console.log(`short block parking: none ${res.none.toFixed(3)} · ride-stop garage ${res.ride.toFixed(3)} · off-stop garage ${res.nostop.toFixed(3)}`);
    expect(res.none).toBeGreaterThan(0.6);
    expect(res.none - res.ride).toBeGreaterThanOrEqual(0.15);
    expect(res.none - res.nostop).toBeGreaterThanOrEqual(0.15);
  });

  it('an idle garage says why: the homes within reach use a faster garage, or no homes within a 12-minute drive', { timeout: 300000 }, () => {
    const { st } = prTown([]);
    // a slow bus stop west of the homes (minibuses, a long ride downtown): its garage is nobody's option; and a bus stop
    // east of downtown, more than a 12-minute drive from every home
    for (const x of [20, 164, 178]) place(st, 'tr_bus_stop', x, 69);
    const g0 = place(st, 'tr_parking_garage', 48, 68).id;
    const west = place(st, 'tr_parking_garage', 21, 68).id;
    const east = place(st, 'tr_parking_garage', 179, 68).id;
    const sim = newSim(st);
    const tr = cycles(sim, 8);
    expect(tr.garageInfo(g0)!.parkRide).toBeGreaterThan(0.9 * GARAGE_SPACES);
    const hint = (id: number) => transportFacilityReport(sim, st.buildings.get(id)!)!.lines.find((l) => l.key === 'switched')!.hint ?? '';
    expect(tr.garageInfo(west)!.state).toBe('parkRide');
    expect(tr.garageInfo(west)!.riders).toBe(0);
    expect(tr.garageReach(west)!.workers).toBeGreaterThan(1000);
    expect(tr.garageReach(west)!.via).toBe(g0);
    expect(hint(west)).toMatch(/Commuters within a 12-minute drive use the Parking Garage 27 tiles E/);
    expect(tr.garageReach(east)!.workers).toBe(0);
    expect(hint(east)).toMatch(/No homes within a 12-minute drive/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
/**
 * lake town: a lake (x 40..55) splits the map, no bridge; R$ homes on the west shore, offices on the east shore; ferry
 * terminals face the lake on both shores (+ a pond in the south-west with a terminal of its own)
 */
function lakeTown(ferries: boolean): { st: CityState; west: number; east: number; pond: number; homes: number[] } {
  const st = newState(96);
  for (let z = 0; z < 96; z++) for (let x = 40; x <= 55; x++) st.water[st.idx(x, z)] = 1;
  for (let z = 80; z <= 86; z++) for (let x = 8; x <= 14; x++) st.water[st.idx(x, z)] = 1; // pond
  roadLine(st, 4, 30, 38, 30, Network.Road);
  roadLine(st, 57, 30, 90, 30, Network.Road);
  roadLine(st, 16, 31, 16, 84, Network.Road);
  place(st, 't_coal', 4, 28);
  place(st, 't_coal', 88, 28);
  const homes: number[] = [];
  for (let x = 28; x <= 37; x++) for (const z of [31, 32]) homes.push(place(st, 't_r1', x, z, { pop: 60, capacity: 60, wealth: 1 }).id);
  for (let x = 58; x <= 68; x += 2) place(st, 't_co', x, 31, { jobs: 150, capacity: 200 });
  let west = -1, east = -1, pond = -1;
  if (ferries) {
    west = place(st, 'tr_ferry_terminal', 38, 27, { rot: 1 }).id; // front (+X) at x = 40: water
    east = place(st, 'tr_ferry_terminal', 56, 27, { rot: 3 }).id; // front (-X) at x = 55: water
    pond = place(st, 'tr_ferry_terminal', 15, 82, { rot: 3 }).id; // front at x = 14: the pond
  }
  st.stats.population = homes.length * 60;
  return { st, west, east, pond, homes };
}

describe('WP7-9 ferries', () => {
  it('ferries carry commuters across a lake without a bridge; a terminal on another water body stays unlinked', { timeout: 120000 }, () => {
    const res: Record<string, { access: number; transit: number; ferry: number; links: number }> = {};
    for (const f of [false, true]) {
      const { st, west, east, pond, homes } = lakeTown(f);
      const sim = newSim(st);
      const tr = cycles(sim, 10);
      let acc = 0;
      for (const id of homes) acc += Math.max(0, tr.workerAccess(id));
      res[f ? 'ferry' : 'none'] = { access: acc / homes.length, transit: st.stats.tripsTransit, ferry: st.stats.transitFleet.ferryRiders, links: st.stats.transitFleet.ferryLinks };
      if (!f) continue;
      expect(tr.stopAttached(west)).toBe(true);
      expect(tr.stopAttached(east)).toBe(true);
      expect(tr.stopAttached(pond)).toBe(false);
      expect(tr.ferryPartners(west).map((p) => p.id)).toEqual([east]);
      const links = ferryLinks(sim);
      expect(links.length).toBe(1);
      for (const c of links[0].cells) expect(st.water[c]).toBe(1);
      const rep = transportFacilityReport(sim, st.buildings.get(west)!)!;
      // (partners are told apart by distance and direction)
      expect(rep.lines.find((l) => l.key === 'routes')!.value).toMatch(/^Ferry Terminal \d+ tiles E \(\d+ min\)$/);
      // riders are crossings: nobody "rides" a terminal to walk to a job beside it
      expect(tr.ferryRidersAt(west)).toBeGreaterThan(100);
      expect(transportFacilityReport(sim, st.buildings.get(pond)!)!.warnings.join()).toMatch(/No partner terminal/);
      expect(transportUseFactor(st, st.buildings.get(pond)!)).toBe(0);
      // plop preview: a terminal on the east shore further south links to both lake terminals, none on the pond
      expect(ferryPartnersFor(sim, 56, 50, 2, 2, 3).map((p) => p.id).sort()).toEqual([west, east].sort());
    }
    console.log(`ferries: ${JSON.stringify(res)}`);
    expect(res.none.transit).toBe(0);
    expect(res.ferry.transit).toBeGreaterThan(100);
    expect(res.ferry.ferry).toBeGreaterThan(100);
    // only the homes within walking distance of the terminal (no bus stops here) reach the jobs across the lake
    expect(res.ferry.access).toBeGreaterThan(res.none.access + 0.1);
    expect(res.ferry.links).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
/**
 * highway town: homes north-west, offices south-east, joined only by a highway (z = 64, x 5..120); each district
 * meets the highway at interchange(s) — a connector road whose last cell touches the highway (the ramp cell)
 */
function hwyTown(opts: { ramps: number; ramp: Network }): { st: CityState; rampCells: number[] } {
  const st = newState(128);
  roadLine(st, 5, 64, 120, 64, Network.Highway);
  // residential grid
  for (const z of [36, 42, 48, 54]) roadLine(st, 10, z, 50, z, Network.Road);
  for (const x of [10, 30, 50]) roadLine(st, x, 36, x, 58, Network.Road);
  // job grid
  for (const z of [70, 76, 82]) roadLine(st, 80, z, 116, z, Network.Road);
  for (const x of [80, 98, 116]) roadLine(st, x, 70, x, 82, Network.Road);
  roadLine(st, 98, 65, 98, 69, Network.Avenue); // job-side interchange (avenue, not the bottleneck)
  const rampCells: number[] = [];
  const xs = [30, 50, 10].slice(0, opts.ramps);
  for (const x of xs) { roadLine(st, x, 59, x, 63, opts.ramp); rampCells.push(st.idx(x, 63)); }
  place(st, 't_coal', 5, 62);
  for (const z of [37, 43, 49]) for (let x = 11; x <= 49; x++) if (x !== 30) place(st, 't_r2', x, z, { pop: 90, capacity: 90, wealth: 2 });
  for (const z of [71, 77]) for (let x = 81; x <= 114; x += 2) place(st, 't_co', x, z, { jobs: 110, capacity: 140 });
  st.stats.population = 38 * 3 * 90;
  return { st, rampCells };
}

describe('WP7-10 interchanges and trucks', () => {
  it('a saturated interchange slows commutes; a second one relieves it; an avenue ramp beats a road ramp', { timeout: 300000 }, () => {
    const run = (ramps: number, ramp: Network) => {
      const { st, rampCells } = hwyTown({ ramps, ramp });
      const sim = newSim(st);
      const tr = cycles(sim, 12);
      // the ramp load over 6 more cycles: steady (commuters pick one ramp each — the flows are smoothed harder)
      const loads: number[] = [];
      const commute = meanOver(sim, 6, (t) => { loads.push(t.rampLoad(rampCells[0])); return st.stats.avgCommute; });
      const rep = roadCellReport(sim, rampCells[0]);
      return { commute, load: loads[loads.length - 1], loadMin: Math.min(...loads), loadMax: Math.max(...loads), minutes: tr.rampMinutes(rampCells[0]), rep };
    };
    const one = run(1, Network.Road), two = run(2, Network.Road), ave = run(1, Network.Avenue);
    console.log(`interchanges: one road ramp: commute ${one.commute.toFixed(2)} load ${one.load.toFixed(2)} ramp ${one.minutes.toFixed(2)} min | two: ${two.commute.toFixed(2)} load ${two.loadMin.toFixed(2)}-${two.loadMax.toFixed(2)} | avenue ramp: ${ave.commute.toFixed(2)} load ${ave.load.toFixed(2)} ramp ${ave.minutes.toFixed(2)} min`);
    expect(one.load).toBeGreaterThan(1);
    expect(one.minutes).toBeGreaterThan(0.45 * 1.5);
    const line = one.rep.find((l) => l.key === 'interchange')!;
    expect(line.value).toMatch(/%/);
    // a road ramp that adds >= 2x its free ramp time says what to do (incl. "ramp from an avenue")
    if (one.minutes >= 2 * 0.45) expect(line.hint).toMatch(/avenue/);
    // an avenue ramp never suggests ramping from an avenue
    expect(ave.rep.find((l) => l.key === 'interchange')?.hint ?? '').not.toMatch(/from an avenue/);
    expect((two.loadMax - two.loadMin) / Math.max(0.05, two.loadMax)).toBeLessThanOrEqual(0.25);
    expect(two.commute).toBeLessThanOrEqual(0.95 * one.commute);
    expect(ave.commute).toBeLessThan(one.commute);
  });

  it('freight sinks count every industry within reach: a freight station beside a seaport does not take its trucks', { timeout: 120000 }, () => {
    const res: Record<string, { port: number; station: number }> = {};
    for (const withStation of [false, true]) {
      const st = newState(96);
      roadLine(st, 0, 40, 95, 40, Network.Highway);
      roadLine(st, 20, 20, 20, 39, Network.Road);
      roadLine(st, 20, 20, 70, 20, Network.Road);
      roadLine(st, 70, 20, 70, 39, Network.Road);
      for (let x = 22; x <= 68; x += 2) place(st, 't_id', x, 21, { jobs: 40 });
      const port = place(st, 'tr_seaport', 44, 13);
      roadLine(st, 44, 19, 49, 19, Network.Road);
      let fs = -1;
      if (withStation) {
        for (let x = 0; x <= 30; x++) st.network[st.idx(x, 17)] = Network.Rail; // rail to the west map edge
        fs = place(st, 'tr_freight_station', 24, 18).id; // 4x2: z 18..19, rail at z = 17, road at z = 20
      }
      const sim = newSim(st);
      const tr = cycles(sim, 5); // one sink per 2nd assignment: both searched by now
      if (fs >= 0) expect(tr.freightLinked(fs)).toBe(true);
      res[withStation ? 'both' : 'port'] = { port: freightSinkTrucks(sim, port.id), station: fs >= 0 ? freightSinkTrucks(sim, fs) : -1 };
    }
    console.log(`freight sinks: ${JSON.stringify(res)}`);
    expect(res.port.port).toBeGreaterThan(100);
    expect(res.both.port).toBeCloseTo(res.port.port, 0);
    expect(res.both.station).toBeGreaterThan(50);
  });

  it('trucks: volume per road cell; an unused seaport has 0 trucks, one next to industry many', { timeout: 120000 }, () => {
    const st = newState(96);
    roadLine(st, 0, 40, 95, 40, Network.Highway); // edge to edge: regional freight sinks
    roadLine(st, 20, 20, 20, 39, Network.Road);
    roadLine(st, 20, 20, 70, 20, Network.Road);
    roadLine(st, 70, 20, 70, 39, Network.Road);
    for (let x = 22; x <= 68; x += 2) place(st, 't_id', x, 21, { jobs: 40 });
    const port = place(st, 'tr_seaport', 44, 13); // 6x6 at z 13..18: road at z = 20? no: z 19 gap
    roadLine(st, 44, 19, 49, 19, Network.Road);
    const far = place(st, 'tr_seaport', 80, 60); // no industry within reach? (industry is ~30 min away at most)
    const sim = newSim(st);
    const tr = cycles(sim, 4);
    const trucks = truckVolumeOf(st)!;
    expect(trucks).not.toBeNull();
    let road = 0;
    for (let x = 20; x <= 70; x++) road = Math.max(road, trucks[st.idx(x, 20)]);
    expect(road).toBeGreaterThan(10);
    expect(roadCellReport(sim, st.idx(46, 20)).some((l) => l.key === 'trucks')).toBe(true);
    expect(freightSinkTrucks(sim, port.id)).toBeGreaterThan(100);
    expect(freightSinkTrucks(sim, far.id)).toBe(0);
    // WP7-11 (WP7a's use factor reads freightSinkTrucks): an unused seaport runs at 0.6, a busy one higher
    const F = FAC as unknown as { updateUseFactors?: (s: Simulation) => void; facilityUseFactor?: (s: CityState, b: unknown) => number };
    if (typeof F.updateUseFactors === 'function' && typeof F.facilityUseFactor === 'function') {
      F.updateUseFactors(sim);
      expect(F.facilityUseFactor(st, far)).toBeCloseTo(0.6, 3);
      expect(F.facilityUseFactor(st, port)).toBeGreaterThan(0.6);
    }
    void tr;
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('WP7-8 car-less residents (WP1-4)', () => {
  it('residents without a car pay extra on car trips (taxi / lift), with or without garages', () => {
    const st = newState(96);
    roadLine(st, 2, 20, 90, 20, Network.Road);
    const low: number[] = [], high: number[] = [];
    for (let x = 4; x <= 24; x++) {
      // alternate neighbours: the same trip, different car-less shares (R$: 0.2 x (0.5 + young adults + seniors))
      const b = place(st, 't_r1', x, 21, { pop: 30, capacity: 30, wealth: 1 });
      if (x % 2 === 0) { b.yad = 0; b.srs = 0; low.push(b.id); } else { b.yad = 0.4; b.srs = 0.4; high.push(b.id); }
    }
    for (let x = 60; x <= 80; x += 2) place(st, 't_co', x, 21, { jobs: 60, capacity: 80 });
    st.stats.population = 21 * 30;
    const sim = newSim(st);
    const tr = cycles(sim, 8);
    const avg = (ids: number[]) => ids.reduce((s, id) => s + tr.commuteOf(id), 0) / ids.length;
    const a = avg(low), b = avg(high);
    console.log(`car-less: commute ${a.toFixed(2)} min (car-less 10 %) vs ${b.toFixed(2)} min (26 %)`);
    expect(b - a).toBeGreaterThan(1);
    expect(b - a).toBeLessThan(0.2 * 12 + 0.5);
    // the inspector's reader: the car-less share and their extra minutes (taxi / lift)
    const r = tr.routeInfo(high[0])!;
    expect(r.carless!).toBeGreaterThan(0.2);
    expect(r.carlessMin!).toBeGreaterThan(3);
    expect(r.carlessMin!).toBeLessThanOrEqual(12.01);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('WP7b save / load', () => {
  it('fleet need, stop / garage loads, ramp flows and parking are persisted: the first post-load cycle continues', { timeout: 300000 }, () => {
    const { st, homeStop } = busTown('near');
    place(st, 'tr_parking_garage', 30, 18); // beside the home stop at x = 28 (park & ride: a price to persist)
    const sim = newSim(st);
    cycles(sim, 6);
    const save = serializeCity(st, { copy: true });
    const restored = deserializeCity(structuredClone(save) as SerializedCity);
    const d0 = st.systemData.infraTransport as Record<string, unknown>;
    const d1 = restored.systemData.infraTransport as Record<string, unknown>;
    expect(d1).toBeTruthy();
    for (const k of ['busNeed', 'garageLoad', 'garagePrice', 'garageReserve', 'garageStop', 'stopLoad', 'sinkTrucks', 'sinkLast']) expect(d1[k]).toEqual(d0[k]);
    expect((d0.garageStop as unknown[]).length).toBe(1);
    expect(Array.from(d1.parkingQ as Uint8Array)).toEqual(Array.from(d0.parkingQ as Uint8Array));
    expect(Array.from(d1.rampVol as Float32Array)).toEqual(Array.from(d0.rampVol as Float32Array));
    // the restored city's warm assignment uses the saved loads / fleet need: same waits as the original's next cycle
    const sim2 = newSim(restored);
    const tr2 = getTraffic(sim2)!;
    const tr = cycles(sim, 1);
    expect(tr2.stopLoad(homeStop)!.waitMin).toBeCloseTo(tr.stopLoad(homeStop)!.waitMin, 4);
    expect(restored.stats.transitFleet.buses).toBe(st.stats.transitFleet.buses);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
/** a small connected town for the 7 transit defs: roads, power, homes, offices, a lone subway station on a tunnel, rail
 *  to the west map edge, a lake in the east with one ferry terminal, two bus stops */
function transitBase(): CityState {
  const st = newState(96);
  for (let z = 0; z < 96; z++) for (let x = 84; x < 96; x++) st.water[st.idx(x, z)] = 1;
  roadLine(st, 4, 30, 82, 30, Network.Road);
  roadLine(st, 40, 31, 40, 70, Network.Road);
  place(st, 't_coal', 4, 28);
  for (let x = 10; x <= 36; x++) place(st, 't_r1', x, 31, { pop: 40, capacity: 40, wealth: 1 });
  for (let x = 44; x <= 76; x += 2) place(st, 't_co', x, 31, { jobs: 40, capacity: 60 });
  for (const x of [12, 30]) place(st, 'tr_bus_stop', x, 29);
  for (let x = 20; x <= 60; x++) st.subway[st.idx(x, 29)] = 1;
  place(st, 'tr_subway_station', 20, 29);
  for (let x = 0; x <= 39; x++) st.network[st.idx(x, 60)] = Network.Rail;
  place(st, 'tr_ferry_terminal', 82, 40, { rot: 1 });
  st.stats.population = 27 * 40;
  return st;
}
const PLACE: Record<string, (st: CityState) => number> = {
  tr_bus_stop: (st) => place(st, 'tr_bus_stop', 22, 29).id,
  civ_bus_depot: (st) => place(st, 'civ_bus_depot', 41, 34).id, // 3x3 beside the x = 40 road
  tr_subway_station: (st) => place(st, 'tr_subway_station', 58, 29).id,
  tr_train_station: (st) => place(st, 'tr_train_station', 20, 61).id,
  tr_freight_station: (st) => place(st, 'tr_freight_station', 30, 61).id,
  tr_parking_garage: (st) => place(st, 'tr_parking_garage', 32, 28).id,
  tr_ferry_terminal: (st) => place(st, 'tr_ferry_terminal', 82, 60, { rot: 1 }).id,
};

describe('WP7b reports, facts and effect metrics of the 7 transit defs', () => {
  it('every transit def has a report with a role and lines, tooltip facts, and a causal effect metric', { timeout: 300000 }, () => {
    const measure = (defId: string | null) => {
      const st = transitBase();
      if (defId === 'tr_train_station' || defId === 'tr_freight_station') roadLine(st, 18, 63, 40, 63, Network.Road);
      const id = defId ? PLACE[defId](st) : -1;
      const sim = newSim(st);
      cycles(sim, 4);
      services(sim).compute(sim, false);
      const metric = defId ? TRANSPORT_EFFECT_METRICS[defId](sim) : 0;
      // (the depot's service: both bus stops of the town are in its range)
      if (defId === 'civ_bus_depot') expect(getTraffic(sim)!.depotStopsServed).toBe(2);
      return { sim, st, id, metric };
    };
    const base = measure(null);
    for (const defId of Object.keys(PLACE)) {
      const r = measure(defId);
      const b = r.st.buildings.get(r.id)!;
      const rep = transportFacilityReport(r.sim, b)!;
      expect(rep, defId).not.toBeNull();
      expect(rep.role, defId).toBeTruthy();
      expect(rep.lines.length, defId).toBeGreaterThan(0);
      expect(transportDefFacts(defId).length, defId).toBeGreaterThan(0);
      expect(transportUseFactor(r.st, b), defId).toBe(1);
      const m0 = TRANSPORT_EFFECT_METRICS[defId](base.sim);
      console.log(`${defId}: metric ${m0.toFixed(1)} -> ${r.metric.toFixed(1)} · ${rep.lines.map((l) => `${l.label}: ${l.value}`).join(' · ')}${rep.warnings.length ? ' ! ' + rep.warnings.join(' ! ') : ''}`);
      expect(r.metric, defId).not.toBe(m0);
      // a burnt copy has no effect
      b.flags |= BF.Burnt;
      r.sim.events.emit('buildingChanged', b);
      cycles(r.sim, 2);
      services(r.sim).compute(r.sim, false);
      if (defId !== 'tr_parking_garage') expect(TRANSPORT_EFFECT_METRICS[defId](r.sim), `${defId} burnt`).toBeCloseTo(m0, 3);
    }
    // not a transport def
    expect(transportFacilityReport(base.sim, base.st.buildings.get(base.st.building[base.st.idx(10, 31)])!)).toBeNull();
    expect(transportDefFacts('civ_police_station')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
/**
 * critic item 21: the 256² stress city + 40 garages beside stops, 6 ferry terminals on a carved lake, 2 depots with
 * 30 bus stops — every traffic step estimated <= 3.0 ms (deterministic cost()); real time is logged (noisy box)
 */
export function stressTransit(): CityState {
  const city = stressCity(256);
  const st = city.st;
  const N = 256;
  const clear = (x: number, z: number) => {
    const id = st.building[z * N + x];
    if (id < 0) return;
    const b = st.buildings.get(id)!;
    for (let zz = b.z; zz < b.z + b.d; zz++) for (let xx = b.x; xx < b.x + b.w; xx++) st.building[zz * N + xx] = -1;
    st.buildings.delete(id);
  };
  // lake: x 100..130, z 170..200 (roads / buildings removed), 6 terminals on its shores
  for (let z = 170; z <= 200; z++) for (let x = 100; x <= 130; x++) { clear(x, z); st.network[z * N + x] = 0; st.netFlags[z * N + x] = 0; st.water[z * N + x] = 1; st.zone[z * N + x] = 0; }
  const term = (x: number, z: number, rot: 0 | 1 | 2 | 3) => { for (let zz = z; zz < z + 2; zz++) for (let xx = x; xx < x + 2; xx++) clear(xx, zz); place(st, 'tr_ferry_terminal', x, z, { rot }); };
  term(98, 175, 1); term(98, 190, 1); term(131, 175, 3); term(131, 190, 3); term(110, 168, 1 /* front +X: land */); term(115, 201, 2);
  // 30 bus stops (on block cells next to roads) and 2 depots
  let k = 0;
  for (let z = 26; z < 250 && k < 30; z += 24) for (let x = 20; x < 250 && k < 30; x += 48) { clear(x, z); place(st, 'tr_bus_stop', x, z); k++; }
  for (const [x, z] of [[62, 62], [182, 182]] as const) { for (let zz = z; zz < z + 3; zz++) for (let xx = x; xx < x + 3; xx++) clear(xx, zz); place(st, 'civ_bus_depot', x, z); }
  // 40 garages beside stops (road-flag stops every 12 cells; subway stations)
  let g = 0;
  for (let z = 1; z < N && g < 40; z += 12) for (let x = 1; x < N && g < 40; x += 36) {
    const bx = x + 2 - ((x + 2) % 3) + 2, bz = z - (z % 3) + 2;
    if (bx + 1 >= N || bz + 1 >= N || st.water[bz * N + bx]) continue;
    for (let zz = bz; zz < bz + 2; zz++) for (let xx = bx; xx < bx + 2; xx++) clear(xx, zz);
    place(st, 'tr_parking_garage', bx, bz);
    g++;
  }
  return st;
}

describe('WP7b perf (stress city + transport facilities)', () => {
  it('every traffic step stays <= 3.0 ms estimated', { timeout: 600000 }, () => {
    const st = stressTransit();
    const sim = newSim(st);
    const tr = getTraffic(sim)!;
    const sch = schedulerOf(sim);
    const maxEst = new Map<string, number>();
    for (const t of sch.tasks) {
      const cost = t.cost.bind(t);
      t.cost = (s2) => { const c = cost(s2); if (c > (maxEst.get(t.name) ?? 0)) maxEst.set(t.name, c); return c; };
    }
    const t0 = performance.now();
    for (let d = 0; d < 40; d++) sim.advanceDay();
    const ms = performance.now() - t0;
    const tf = st.stats.transitFleet;
    console.log(`stress transit: ${(ms / 40).toFixed(1)} ms/day, traffic cycles ${tr.cycles}, max est. ${[...maxEst].map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ')}, fleet ${JSON.stringify(tf)}, parking ${JSON.stringify(tr.parkingSummary)}`);
    expect(maxEst.get('traffic')!).toBeLessThanOrEqual(3.0);
    expect(tf.ferryLinks).toBeGreaterThan(0);
    expect(tf.parkRideSpaces).toBeGreaterThan(0);
  });
});
