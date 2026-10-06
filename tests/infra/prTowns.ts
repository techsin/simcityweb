/**
 * Shared park & ride test towns (WP7b): tests/infra/transitFacilities.test.ts and parkRideOverflow.test.ts.
 */
import { Network, Zone } from '../../src/core/types';
import type { CityState } from '../../src/sim/CityState';
import { newState, place, roadLine } from './cityGen';

/** zone the non-road cells of a rectangle */
export function zoneRect(st: CityState, x0: number, z0: number, x1: number, z1: number, zone: Zone): void {
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (st.network[st.idx(x, z)] === Network.None) st.zone[st.idx(x, z)] = zone;
}

/**
 * park & ride town: R$$ suburb on side roads north-west (no station within walking distance), an avenue (z = 70) to a
 * dense downtown office strip in the east (5 towers x 840 jobs on a commercial zone: little parking), a subway under the
 * avenue from a suburban station (x = 46) to downtown (x = 162, 168). garages: top-left corners (48, 68 = next to the
 * suburban station); mul scales homes and jobs (2 = a jammed town where park & ride is wanted far beyond its spaces)
 */
export function prTown(garages: [number, number][], mul = 1): { st: CityState; offices: number[]; ids: number[] } {
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

/** the park & ride town with a subway station and a garage at each x of `xs` along the line (a station at x - 2 beside
 *  each garage; 48 has the suburban one): the garages' ids, west to east */
export function lineTown(xs: readonly number[], mul: number): { st: CityState; ids: number[] } {
  const { st } = prTown([], mul);
  for (const x of xs) if (x !== 48) place(st, 'tr_subway_station', x - 2, 69);
  const ids = xs.map((x) => place(st, 'tr_parking_garage', x, 68).id);
  return { st, ids };
}
