/**
 * City statistics panel model (headless, no DOM): the Park & ride card's line. StatsPanel renders it; tests pin it.
 */
import { compact } from './format';
import { BF } from '../sim/CityState';

/** the parking garage def the traffic system runs park & ride from (traffic.ts GARAGE_DEFS) */
export const GARAGE_DEF = 'tr_parking_garage';

/** parking garages by their state in the last traffic assignment (TrafficSystem.garageInfo(id)) */
export interface GarageCounts {
  /** parking garages standing */
  total: number;
  /** park & ride garages ('parkRide'): a stop within reach whose riders ride a vehicle */
  parkRide: number;
  /** of those, the ones that keep all their spaces for the parking-short block around them (reserve = spaces) */
  kept: number;
  /** by a downtown stop ('downtown': its riders walk to jobs beside it) — parking only */
  downtown: number;
  /** by a stop whose transit reaches no jobs yet ('noTransit') */
  noTransit: number;
  /** standing (not burnt / abandoned) but not seen by a traffic assignment yet: placed since the last one */
  pending: number;
}

/** what countGarages reads from the traffic system (null: a garage no assignment has seen yet) */
export interface GarageStates {
  garageInfo?(id: number): { state?: string; spaces?: number; reserve?: number } | null;
}

/** the garages among `buildings` by their park & ride state (traffic: no system, or not seen yet → only counted) */
export function countGarages(buildings: Iterable<{ id: number; def: string; flags?: number }>, traffic: GarageStates | null | undefined): GarageCounts {
  const out: GarageCounts = { total: 0, parkRide: 0, kept: 0, downtown: 0, noTransit: 0, pending: 0 };
  for (const b of buildings) {
    if (b.def !== GARAGE_DEF) continue;
    out.total++;
    const g = traffic?.garageInfo?.(b.id);
    if (!g) {
      if (traffic?.garageInfo && !((b.flags ?? 0) & (BF.Burnt | BF.Abandoned))) out.pending++;
      continue;
    }
    const state = g.state;
    if (state === 'parkRide') {
      out.parkRide++;
      // (no park & ride room left: what the garage's own report calls "all N spaces kept for the businesses around it")
      const spaces = g.spaces ?? 0;
      if (spaces > 0 && Math.round(g.reserve ?? 0) >= spaces) out.kept++;
    } else if (state === 'downtown') out.downtown++;
    else if (state === 'noTransit') out.noTransit++;
  }
  return out;
}

/**
 * The Park & ride card's line. stats.transitFleet.parkRideSpaces sums the park & ride room of the garages in park &
 * ride service after the last traffic assignment: each one's spaces minus those it keeps for the parking-short block
 * around it (traffic.ts, local parkers first). 0 spaces while park & ride garages stand means every one of them keeps
 * all its spaces for local parking — not "no garages by a stop" —, or (a garage with room the stats do not count yet:
 * placed since that assignment) park & ride starts with the next traffic update. A garage no assignment has seen yet
 * is counted at the next one. Garages by stops that are no park & ride (downtown stops, stops whose transit reaches no
 * jobs) say so, as their facility reports do.
 */
export function parkRideLine(tf: { parkRideSpaces: number } | null | undefined, g: GarageCounts): string {
  if (tf && tf.parkRideSpaces > 0) return `a day · ${compact(tf.parkRideSpaces)} spaces`;
  if (g.parkRide > 0) return g.kept >= g.parkRide ? 'all spaces kept for local parking' : 'starts with the next traffic update';
  if (g.pending > 0) return 'new garage: counted at the next traffic update';
  if (g.noTransit > 0) return 'transit from their stops reaches no jobs yet';
  if (g.downtown > 0) return 'garages by downtown stops: parking only';
  return 'no garages by a stop';
}
