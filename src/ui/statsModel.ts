/**
 * City statistics panel model (headless, no DOM): the Park & ride card's line. StatsPanel renders it; tests pin it.
 */
import { compact } from './format';

/** the parking garage def the traffic system runs park & ride from (traffic.ts GARAGE_DEFS) */
export const GARAGE_DEF = 'tr_parking_garage';

/** parking garages by their state in the last traffic assignment (TrafficSystem.garageInfo(id).state) */
export interface GarageCounts {
  /** parking garages standing */
  total: number;
  /** park & ride garages ('parkRide'): a stop within reach whose riders ride a vehicle */
  parkRide: number;
  /** by a downtown stop ('downtown': its riders walk to jobs beside it) — parking only */
  downtown: number;
  /** by a stop whose transit reaches no jobs yet ('noTransit') */
  noTransit: number;
}

/** what countGarages reads from the traffic system (null: a garage no assignment has seen yet) */
export interface GarageStates {
  garageInfo?(id: number): { state?: string } | null;
}

/** the garages among `buildings` by their park & ride state (traffic: no system, or not seen yet → only counted) */
export function countGarages(buildings: Iterable<{ id: number; def: string }>, traffic: GarageStates | null | undefined): GarageCounts {
  const out: GarageCounts = { total: 0, parkRide: 0, downtown: 0, noTransit: 0 };
  for (const b of buildings) {
    if (b.def !== GARAGE_DEF) continue;
    out.total++;
    const state = traffic?.garageInfo?.(b.id)?.state;
    if (state === 'parkRide') out.parkRide++;
    else if (state === 'downtown') out.downtown++;
    else if (state === 'noTransit') out.noTransit++;
  }
  return out;
}

/**
 * The Park & ride card's line. stats.transitFleet.parkRideSpaces sums the park & ride room of the garages in park &
 * ride service: each one's spaces minus those it keeps for the parking-short block around it (traffic.ts, local
 * parkers first). So 0 spaces while park & ride garages stand means every one of them keeps all its spaces for local
 * parking — it is not "no garages by a stop". Garages by stops that are no park & ride (downtown stops, stops whose
 * transit reaches no jobs) say so, as their facility reports do.
 */
export function parkRideLine(tf: { parkRideSpaces: number } | null | undefined, g: GarageCounts): string {
  if (tf && tf.parkRideSpaces > 0) return `a day · ${compact(tf.parkRideSpaces)} spaces`;
  if (g.parkRide > 0) return 'all spaces kept for local parking';
  if (g.noTransit > 0) return 'transit from their stops reaches no jobs yet';
  if (g.downtown > 0) return 'garages by downtown stops: parking only';
  return 'no garages by a stop';
}
